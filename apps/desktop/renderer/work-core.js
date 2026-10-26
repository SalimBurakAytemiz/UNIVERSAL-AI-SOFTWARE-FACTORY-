// //TR: Bu modül B5 iş ekranlarının saf (DOM'suz) çekirdeğidir: mission durum makinesinin salt-okunur kopyası (core/mission/state-machine.ts ile test eşleşir), yalnız izinli sonraki geçişler, yüksek riskli geçiş onayı, proje/mission/geçiş/koşu istek gövdesi kurucuları (argv dizisi, idempotency anahtarı, doğrulama), POST sonuç sınıflandırması, work-run/evidence eşleyicileri ve Gelen Kutusu türetimi; eksik veri asla uydurulmaz.
import {MISSING,safeCount} from "./model.js";
import {mapDelivery} from "./delivery-core.js";

/** core/mission/state-machine.ts içindeki transitions tablosunun kopyası; tests/v7-b5-work-screens.test.ts eşitliği doğrular. */
export const MISSION_TRANSITIONS=Object.freeze({
  DRAFT:Object.freeze(["PREFLIGHT","BLOCKED"]),
  PREFLIGHT:Object.freeze(["AUTHORIZED","BLOCKED","FOUNDER_ATTENTION_REQUIRED"]),
  AUTHORIZED:Object.freeze(["PLANNED","BLOCKED"]),
  PLANNED:Object.freeze(["EXECUTING","BLOCKED"]),
  EXECUTING:Object.freeze(["VERIFYING","BLOCKED","FOUNDER_ATTENTION_REQUIRED"]),
  VERIFYING:Object.freeze(["REVIEWING","REMEDIATING","BLOCKED"]),
  REVIEWING:Object.freeze(["REMEDIATING","REGRESSION","BLOCKED","FOUNDER_ATTENTION_REQUIRED"]),
  REMEDIATING:Object.freeze(["VERIFYING","BLOCKED","FOUNDER_ATTENTION_REQUIRED"]),
  REGRESSION:Object.freeze(["REPORTING","REMEDIATING","BLOCKED"]),
  REPORTING:Object.freeze(["COMPLETE","BLOCKED"]),
  COMPLETE:Object.freeze([]),
  BLOCKED:Object.freeze(["PREFLIGHT","FOUNDER_ATTENTION_REQUIRED"]),
  FOUNDER_ATTENTION_REQUIRED:Object.freeze(["PREFLIGHT","BLOCKED"])
});
export const MISSION_STATUSES=Object.freeze(Object.keys(MISSION_TRANSITIONS));
/** Mutlu yol sırası (zaman çizelgesi gösterimi); yol dışı durumlar ayrı gösterilir. */
export const MISSION_PATH=Object.freeze(["DRAFT","PREFLIGHT","AUTHORIZED","PLANNED","EXECUTING","VERIFYING","REVIEWING","REGRESSION","REPORTING","COMPLETE"]);
export const HIGH_RISK_TARGETS=Object.freeze(["AUTHORIZED","COMPLETE"]);
export const REASON_REQUIRED_TARGETS=Object.freeze(["BLOCKED","REMEDIATING","FOUNDER_ATTENTION_REQUIRED"]);
export const RISK_LEVELS=Object.freeze(["R0","R1","R2","R3","R4"]);
export const RUN_START_STATUSES=Object.freeze(["AUTHORIZED","PLANNED"]);
export const RUN_ACTIVE_STATES=Object.freeze(["QUEUED","LEASED","STARTING","RUNNING","VERIFYING","REVIEWING"]);
export const VERIFICATION_STATES=Object.freeze(["VERIFIED","MISMATCH","MISSING","UNVERIFIABLE"]);

export const MISSION_ID_RE=/^msn_[0-9a-f]{24}$/;
export const PROJECT_ID_RE=/^prj_[0-9a-f]{24}$/;
export const SAFE_ID_RE=/^[A-Za-z0-9_-]{6,64}$/;
export const SHA256_RE=/^[0-9a-f]{64}$/i;
export const IDEMPOTENCY_KEY_RE=/^[A-Za-z0-9._:-]{1,128}$/;
export const ENVIRONMENT_ID_RE=/^[A-Za-z0-9._-]{1,100}$/;
export const MAX_BODY_BYTES=32768;
export const MAX_ARGV_TOKENS=32;
export const MAX_ARGV_TOKEN_LENGTH=500;
export const MAX_CRITERIA=50;

export const isMissionStatus=s=>typeof s==="string"&&Object.prototype.hasOwnProperty.call(MISSION_TRANSITIONS,s);
/** Verilen durumdan yalnız durum makinesinin izin verdiği sonraki durumlar; bilinmeyen durum için boş liste. */
export function allowedNext(status){return isMissionStatus(status)?[...MISSION_TRANSITIONS[status]]:[]}
export const requiresConfirm=to=>HIGH_RISK_TARGETS.includes(to);
export const reasonRequired=to=>REASON_REQUIRED_TARGETS.includes(to);
export const canStartRun=status=>RUN_START_STATUSES.includes(status);

// ---------- Kimlik ve idempotency ----------
let fallbackCounter=0;
export function randomToken(){
  const c=globalThis.crypto;
  if(c&&typeof c.randomUUID==="function")return c.randomUUID();
  if(c&&typeof c.getRandomValues==="function"){const a=new Uint8Array(16);c.getRandomValues(a);return Array.from(a,b=>b.toString(16).padStart(2,"0")).join("")}
  fallbackCounter+=1;return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
export function newIdempotencyKey(rand=randomToken){return `ui-${rand()}`.slice(0,128)}
/** Aynı gövde için aynı anahtarı (yeniden deneme güvenli), gövde değişince yeni anahtarı verir; başarıda reset() çağrılır. */
export function createIdempotencyTracker(rand=randomToken){
  let fingerprint=null,key=null;
  return {
    keyFor(body){const fp=JSON.stringify(body);if(fp!==fingerprint||!key){fingerprint=fp;key=newIdempotencyKey(rand)}return key},
    reset(){fingerprint=null;key=null}
  };
}

// ---------- Doğrulama ve istek kurucuları ----------
const trim=v=>typeof v==="string"?v.trim():"";
const CONTROL_RE=/[\u0000-\u001f\u007f]/;
const bodyBytes=body=>{try{return new TextEncoder().encode(JSON.stringify(body)).length}catch{return Infinity}};
const result=(path,body,errors)=>Object.keys(errors).length?{ok:false,errors}:{ok:true,path,body};

/** argv belirteç listesi: boş satırlar atılır; kabuk dizgesi, kontrol karakteri, aşırı uzunluk reddedilir. Hata anahtarı veya null döner. */
export function normalizeArgv(tokens){
  if(tokens===undefined||tokens===null)return {ok:true,argv:[]};
  if(!Array.isArray(tokens))return {ok:false,error:"err.argvInvalid"};
  const argv=[];
  for(const raw of tokens){
    if(typeof raw!=="string")return {ok:false,error:"err.argvInvalid"};
    const tk=raw.trim();if(!tk)continue;
    if(CONTROL_RE.test(tk))return {ok:false,error:"err.argvControl"};
    if(tk.length>MAX_ARGV_TOKEN_LENGTH)return {ok:false,error:"err.argvLong"};
    argv.push(tk);
  }
  if(argv.length>MAX_ARGV_TOKENS)return {ok:false,error:"err.argvMany"};
  // İlk belirteç yürütülebilir dosyadır; boşluk içeren tek dizge yalnız bayraksız mutlak yol ise kabul edilir ("node --test", "/usr/bin/node -x" kabuk komutu sayılır).
  if(argv.length&&/\s/.test(argv[0])){
    const abs=/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(argv[0]);
    if(!abs||/\s-{1,2}[A-Za-z0-9]/.test(argv[0])||/["']/.test(argv[0]))return {ok:false,error:"err.argvShellString"};
  }
  return {ok:true,argv};
}
const ABSOLUTE_PATH_RE=/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/)/;
export function validatePath(p){
  if(!p)return "err.pathRequired";
  if(p.length>1000)return "err.pathLong";
  if(CONTROL_RE.test(p))return "err.pathInvalid";
  if(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(p))return "err.pathUrl";
  if(!ABSOLUTE_PATH_RE.test(p))return "err.pathAbsolute";
  if(p.split(/[\\/]+/).includes(".."))return "err.pathTraversal";
  return null;
}
/** Yeni proje isteği: {name, repositoryPath, environmentId?, testCommand?: string[]} -> POST /v1/projects gövdesi. */
export function buildProjectRequest(input,{key}={}){
  const errors={},name=trim(input?.name),repo=trim(input?.repositoryPath),env=trim(input?.environmentId),argv=normalizeArgv(input?.testCommand);
  if(!name)errors.name="err.nameRequired";else if(name.length>200)errors.name="err.nameLong";
  const pe=validatePath(repo);if(pe)errors.repositoryPath=pe;
  if(env&&!ENVIRONMENT_ID_RE.test(env))errors.environmentId="err.envInvalid";
  if(!argv.ok)errors.testCommand=argv.error;
  if(key!==undefined&&!IDEMPOTENCY_KEY_RE.test(String(key)))errors.idempotencyKey="err.idempotencyKey";
  const body={name,repository:{path:repo}};
  if(env)body.environmentId=env;
  if(argv.ok&&argv.argv.length)body.testCommand=argv.argv;
  if(key!==undefined)body.idempotencyKey=String(key);
  if(!Object.keys(errors).length&&bodyBytes(body)>MAX_BODY_BYTES)errors.form="err.tooLarge";
  return result("/v1/projects",body,errors);
}
/** Yeni mission isteği: {projectId,title,objective,acceptanceCriteria:string[],riskLevel,testCommand?} -> POST /v1/missions gövdesi. */
export function buildMissionRequest(input,{key}={}){
  const errors={},title=trim(input?.title),objective=trim(input?.objective),projectId=trim(input?.projectId),risk=trim(input?.riskLevel),argv=normalizeArgv(input?.testCommand);
  const crit=Array.isArray(input?.acceptanceCriteria)?input.acceptanceCriteria.map(trim).filter(Boolean):[];
  if(!PROJECT_ID_RE.test(projectId))errors.projectId="err.projectRequired";
  if(!title)errors.title="err.titleRequired";else if(title.length>200)errors.title="err.titleLong";
  if(!objective)errors.objective="err.objectiveRequired";else if(objective.length>4000)errors.objective="err.objectiveLong";
  if(!crit.length)errors.acceptanceCriteria="err.criteriaRequired";
  else if(crit.length>MAX_CRITERIA)errors.acceptanceCriteria="err.criteriaMany";
  else if(crit.some(c=>c.length>4000))errors.acceptanceCriteria="err.criteriaLong";
  if(!RISK_LEVELS.includes(risk))errors.riskLevel="err.riskRequired";
  if(!argv.ok)errors.testCommand=argv.error;
  if(key!==undefined&&!IDEMPOTENCY_KEY_RE.test(String(key)))errors.idempotencyKey="err.idempotencyKey";
  const body={projectId,title,objective,acceptanceCriteria:crit,riskLevel:risk};
  if(argv.ok&&argv.argv.length)body.testCommand=argv.argv;
  if(key!==undefined)body.idempotencyKey=String(key);
  if(!Object.keys(errors).length&&bodyBytes(body)>MAX_BODY_BYTES)errors.form="err.tooLarge";
  return result("/v1/missions",body,errors);
}
// ---------- Görev planı (POST /v1/missions/:id/plan, Lane B) ----------
// //TR: LANE-A: Kurucunun elle girdiği görev planı: her satır bir başlık ve isteğe bağlı bağımlılık (yalnız ÖNCEKİ satır numaraları, 1 tabanlı). Sunucu şeması: tasks[{title<=200,dependsOn[0 tabanlı önceki indeksler]}], en çok 50, gövdede başka alan yoktur.
export const PLANNABLE_STATUSES=Object.freeze(["DRAFT","PREFLIGHT","AUTHORIZED","PLANNED"]);
export const PLAN_MAX_TASKS=50;
export const planPath=id=>MISSION_ID_RE.test(String(id))?`/v1/missions/${id}/plan`:null;
/** Plan yalnız planlanabilir durumdaki ve henüz görevi olmayan mission için sunulur. */
export const canPlan=(status,taskCount)=>PLANNABLE_STATUSES.includes(status)&&taskCount===0;
export function buildPlanRequest({missionId,rows}){
  const errors={},rowErrors={};
  if(!planPath(missionId))errors.mission="err.missionInvalid";
  const list=Array.isArray(rows)?rows.map(r=>({title:trim(r?.title),deps:trim(r?.deps)})):[];
  while(list.length&&!list[list.length-1].title&&!list[list.length-1].deps)list.pop();
  if(!list.length)errors.tasks="plan.err.none";
  else if(list.length>PLAN_MAX_TASKS)errors.tasks="plan.err.many";
  const tasks=[];
  list.forEach((r,i)=>{
    if(!r.title){rowErrors[i]="plan.err.title";return}
    if(r.title.length>200){rowErrors[i]="plan.err.titleLong";return}
    let deps=[];
    if(r.deps){
      const parts=r.deps.split(/[\s,;]+/).filter(Boolean);
      if(parts.some(x=>!/^[1-9][0-9]{0,2}$/.test(x)))rowErrors[i]="plan.err.deps";
      else{
        const nums=parts.map(Number);
        if(new Set(nums).size!==nums.length||nums.some(n=>n>=i+1))rowErrors[i]="plan.err.deps";
        else deps=nums.map(n=>n-1);
      }
    }
    if(rowErrors[i]===undefined){const t={title:r.title};if(deps.length)t.dependsOn=deps;tasks.push(t)}
  });
  if(Object.keys(rowErrors).length)errors.tasks=errors.tasks??"plan.err.rows";
  const ok=!Object.keys(errors).length;
  return {ok,path:planPath(missionId),body:ok?{tasks}:null,errors,rowErrors};
}
// ---------- Görev durumu (POST /v1/tasks/:id/transition, COORD-TASK-STATUS) ----------
// //TR: COORD-TASK-UI: core/workos/types.ts TASK_TRANSITIONS'ın birebir aynası; yalnız hangi düğmenin sunulacağını belirler, karar sunucudadır. IN_PROGRESS yalnız tüm bağımlılıklar DONE iken sunulur; COMPLETE mission'ın görevleri donuktur. Gövde sunucu şemasıyla aynıdır: {to, reason(1..1000)}.
export const TASK_TRANSITIONS=Object.freeze({PENDING:Object.freeze(["IN_PROGRESS","BLOCKED"]),IN_PROGRESS:Object.freeze(["DONE","BLOCKED","PENDING"]),BLOCKED:Object.freeze(["PENDING"]),DONE:Object.freeze([])});
export const TASK_ID_RE=/^tsk_[0-9a-f]{24}$/;
export const TASK_REASON_MAX=1000;
export const isTaskStatus=s=>typeof s==="string"&&Object.prototype.hasOwnProperty.call(TASK_TRANSITIONS,s);
export const taskTransitionPath=id=>TASK_ID_RE.test(String(id))?`/v1/tasks/${id}/transition`:null;
/** Görevin DONE olmayan (veya listede bulunamayan) bağımlılıkları; dependsOn okunamadıysa (null) boş liste döner ve karar sunucuya kalır. */
export function pendingTaskDeps(task,tasks){
  const byId=new Map((Array.isArray(tasks)?tasks:[]).map(t=>[t?.taskId,t]));
  return (Array.isArray(task?.dependsOn)?task.dependsOn:[]).filter(d=>byId.get(d)?.status!=="DONE");
}
/** {targets, blockedBy}: sunulabilecek hedef durumlar ve IN_PROGRESS'i bekleten bağımlılıklar. */
export function allowedTaskTargets(task,tasks,missionStatus){
  if(!task||!isTaskStatus(task.status)||missionStatus==="COMPLETE")return {targets:[],blockedBy:[]};
  const all=TASK_TRANSITIONS[task.status],blockedBy=all.includes("IN_PROGRESS")?pendingTaskDeps(task,tasks):[];
  return {targets:all.filter(to=>to!=="IN_PROGRESS"||!blockedBy.length),blockedBy};
}
/** Görev durum geçişi isteği: yalnız izin verilen hedefler; BLOCKED gerekçe ister, boş gerekçe diğer hedeflerde "FROM -> TO (UASCO Desktop)" olur. */
export function buildTaskTransitionRequest({task,tasks,missionStatus,to,reason}){
  const errors={},r=trim(reason),path=taskTransitionPath(task?.taskId);
  if(!path)errors.task="taskst.err.task";
  else{
    const {targets,blockedBy}=allowedTaskTargets(task,tasks,missionStatus);
    if(!targets.includes(to))errors.to=to==="IN_PROGRESS"&&blockedBy.length?"taskst.err.deps":missionStatus==="COMPLETE"?"taskst.err.frozen":"err.transitionNotAllowed";
  }
  if(to==="BLOCKED"&&!r)errors.reason="err.reasonRequired";
  if(r.length>TASK_REASON_MAX)errors.reason="taskst.err.reasonLong";
  return result(path,{to,reason:r||`${task?.status} -> ${to} (UASCO Desktop)`},errors);
}
// ---------- Görev-koşu bağı (GET/POST /v1/tasks/:id/runs, Lane B) ----------
// //TR: LANE-A: Koşu bir mission'a açılır; hangi görevi yürüttüğü bu bağla kaydedilir. GET {runs:[{link:{taskId,runId,missionId,linkedAt,...},run|null}]}; POST gövdesi yalnız {runId}. Bozuk kayıt tüm okumayı ERROR yapar; koşu kaydı yoksa durum null kalır (uydurulmaz).
export const RUN_ID_RE=/^run_[0-9a-f]{24}$/;
export const taskRunsPath=id=>TASK_ID_RE.test(String(id))?`/v1/tasks/${id}/runs`:null;
export function mapTaskRuns(raw){
  const bad={state:"ERROR",items:[]};
  const list=isObj(raw)?raw.runs:null;if(!Array.isArray(list)||list.length>500)return bad;
  const items=[];
  for(const x of list){
    const l=isObj(x)?x.link:null;
    if(!isObj(l)||!TASK_ID_RE.test(String(l.taskId))||!RUN_ID_RE.test(String(l.runId))||!MISSION_ID_RE.test(String(l.missionId)))return bad;
    items.push({taskId:l.taskId,runId:l.runId,missionId:l.missionId,linkedAt:iso(l.linkedAt),status:isObj(x.run)?statusStr(x.run.status):null});
  }
  return {state:"VERIFIED",items};
}
// //TR: "Görev durumunu koşudan güncelle" (POST /v1/work-runs/:id/tasks/reconcile, gövde BOŞ; sunucu durumu yalnız koşunun gerçek sonucundan türetir, istemci durum gönderemez). Ana süreç izin listesi henüz yoksa ya da sunucu 403/404 verirse sonuç "etkin değil"dir ve hiçbir sonuç uydurulmaz; geçerli yanıt yalnız sıkı eşlemeden geçerse gösterilir.
export const reconcilePath=runId=>typeof runId==="string"&&RUN_ID_RE.test(runId)?`/v1/work-runs/${runId}/tasks/reconcile`:null;
export function buildReconcileRequest({runId}){
  const path=reconcilePath(runId);
  return path?{ok:true,path,body:{},errors:{}}:{ok:false,path:null,body:null,errors:{runId:"taskruns.err.run"}};
}
const RECON_ACTIONS=Object.freeze(["TRANSITIONED","UNCHANGED","SKIPPED"]);
const RECON_TASK_STATUSES=Object.freeze(["PENDING","IN_PROGRESS","DONE","BLOCKED"]);
export const RECON_SKIP_REASONS=Object.freeze(["SUPERSEDED_BY_NEWER_RUN","TASK_ALREADY_DONE","NO_ALLOWED_PATH","TASK_DEPENDENCIES_NOT_DONE","MISSION_COMPLETE"]);
/** Sunucu uzlaştırma yanıtı -> {state:"VERIFIED",runId,runStatus,results,mine,othersTransitioned} | {state:"ERROR"}; tek bozuk satır tüm yanıtı ERROR yapar. */
export function mapReconcile(raw,taskId){
  const bad={state:"ERROR"};
  if(!isObj(raw)||!RUN_ID_RE.test(String(raw.runId))||statusStr(raw.runStatus)===null||!Array.isArray(raw.results)||raw.results.length>500)return bad;
  const results=[];
  for(const x of raw.results){
    if(!isObj(x)||!TASK_ID_RE.test(String(x.taskId))||!RECON_TASK_STATUSES.includes(x.from)||!RECON_TASK_STATUSES.includes(x.to)||!RECON_ACTIONS.includes(x.action))return bad;
    if(x.reason!==null&&statusStr(x.reason)===null)return bad;
    results.push({taskId:x.taskId,from:x.from,to:x.to,action:x.action,reason:x.reason});
  }
  const mine=results.find(r=>r.taskId===taskId)??null;
  return {state:"VERIFIED",runId:raw.runId,runStatus:raw.runStatus,results,mine,othersTransitioned:results.filter(r=>r.action==="TRANSITIONED"&&r.taskId!==taskId).length};
}
/** POST sonucunu sınıflar: NOT_ENABLED (izin listesi/rota yok), RESULT (sıkı eşlemeden geçti), INVALID (2xx ama bozuk), FAILED (diğer; describePostResult anahtarı kullanılır). */
export function classifyReconcile(res,taskId){
  if(!res)return {kind:"FAILED"};
  const err=typeof res.body?.error==="string"?res.body.error:"";
  if(res.thrown&&/INVALID_API_PATH/.test(String(res.message??"")))return {kind:"NOT_ENABLED"};
  if(res.thrown)return {kind:"FAILED"};
  const s=res.status;
  if((s===404||s===501)&&err!=="OUTCOME_RUN_NOT_FOUND"&&err!=="RUN_NOT_FOUND")return {kind:"NOT_ENABLED"};
  if(s===403&&err!=="ACTION_DENIED")return {kind:"NOT_ENABLED"};
  if(s>=200&&s<300){const m=mapReconcile(res.body,taskId);return m.state==="VERIFIED"?{kind:"RESULT",...m}:{kind:"INVALID"}}
  return {kind:"FAILED"};
}
/** Göreve bağlı koşu sonucu -> durum bloğu anahtarı ve değişkenleri (yalnız sunucunun bildirdiği sonuç). */
export function reconcileStatusKey(c){
  const o=c.othersTransitioned,m=c.mine;
  if(!m)return {key:"taskruns.recon.noMine",vars:{others:o}};
  if(m.action==="TRANSITIONED")return {key:"taskruns.recon.transitioned",vars:{from:m.from,to:m.to,others:o}};
  if(m.action==="UNCHANGED")return {key:"taskruns.recon.unchanged",vars:{reason:m.reason??MISSING,others:o}};
  return RECON_SKIP_REASONS.includes(m.reason)?{key:`taskruns.recon.skipped.${m.reason}`,vars:{others:o}}:{key:"taskruns.recon.skipped",vars:{reason:m.reason??MISSING,others:o}};
}
// //TR: core/workos/task-outcome.ts targetForRun kuralının birebir yansıması: görev, ona EN SON bağlanan koşunun gerçek sonucunu izler (SUCCEEDED -> DONE; FAILED/RECOVERY_FAILED/CANCELLED/QUARANTINED/BLOCKED -> BLOCKED; CREATED/QUEUED -> değişmez; diğer bilinen durumlar -> IN_PROGRESS). Bu yalnız KURALI gösterir, bir geçişin yapıldığını iddia etmez; kaydedilen görev durumu ayrıca okunur. Bilinmeyen/okunamayan koşu durumu için hedef null'dır (tahmin yok).
export const RUN_TASK_STATUSES=Object.freeze(["CREATED","QUEUED","LEASED","RUNNING","CHECKPOINTING","VERIFYING","SUCCEEDED","RETRY_SCHEDULED","DEGRADED","HANDOFF_PENDING","AWAITING_APPROVAL","BLOCKED","QUARANTINED","CANCELLING","CANCELLED","RECOVERING","RECOVERY_FAILED","FAILED"]);
const RUN_FAILED_FOR_TASK=Object.freeze(["FAILED","RECOVERY_FAILED","CANCELLED","QUARANTINED","BLOCKED"]);
export function taskTargetForRun(status){
  if(typeof status!=="string"||!RUN_TASK_STATUSES.includes(status))return null;
  if(status==="SUCCEEDED")return "DONE";
  if(RUN_FAILED_FOR_TASK.includes(status))return "BLOCKED";
  if(status==="CREATED"||status==="QUEUED")return "NONE";
  return "IN_PROGRESS";
}
/** mapTaskRuns öğeleri (bağlanma sırasıyla) -> her öğe için {governing,target}; yönetici koşu son bağlanandır, eskiler "SUPERSEDED" sayılır. */
export function taskFollowsRun(items){
  const list=Array.isArray(items)?items:[];
  return list.map((l,i)=>({runId:l.runId,governing:i===list.length-1,target:taskTargetForRun(l.status)}));
}
/** Göreve henüz bağlı olmayan, kanonik kimlikli mission koşuları (kimlik tekrarı elenir). */
export function linkableRuns(runItems,linkedItems){
  const linked=new Set((Array.isArray(linkedItems)?linkedItems:[]).map(l=>l.runId)),seen=new Set(),out=[];
  for(const r of Array.isArray(runItems)?runItems:[]){
    if(!r||!RUN_ID_RE.test(String(r.runId))||linked.has(r.runId)||seen.has(r.runId))continue;
    seen.add(r.runId);out.push(r);
  }
  return out;
}
export function buildLinkRunRequest({taskId,runId,taskStatus}){
  const errors={},path=taskRunsPath(taskId);
  if(!path)errors.taskId="taskruns.err.task";
  if(!RUN_ID_RE.test(String(runId??"")))errors.runId="taskruns.err.run";
  if(taskStatus==="DONE")errors.taskId="taskruns.err.done";
  const ok=!Object.keys(errors).length;
  return {ok,path,body:ok?{runId}:null,errors};
}

// ---------- Koşu başlatıldıktan sonra "koşuyu görevlere bağla" adımı (LANE-A A-RUN-TASK-LINK) ----------
// //TR: Koşu başlatma yanıtı (201/200 {run:{runId,missionId,...}}) YALNIZ kimliği şemaya uyan ve istenen mission'a ait bir koşu taşıyorsa okunur; aksi halde bağ adımı sunulmaz (kimlik uydurulmaz). Bağlanacak görevleri Founder seçer; hiçbir görev çıkarım yoluyla seçilmez ve DONE görevler hiç sunulmaz.
export function parseStartedRun(res,missionId){
  if(!res||res.thrown||!Number.isSafeInteger(res.status)||res.status<200||res.status>=300)return null;
  const r=isObj(res.body)?res.body.run:null;
  return isObj(r)&&typeof r.runId==="string"&&RUN_ID_RE.test(r.runId)&&r.missionId===missionId?r.runId:null;
}
/** Mission görevlerinden bağlanabilir olanlar: geçerli kimlikli ve DONE olmayanlar (durumu okunamayan görev DONE sayılmaz, olduğu gibi gösterilir). */
export function linkableTasks(tasks){
  return (Array.isArray(tasks)?tasks:[]).filter(t=>isObj(t)&&TASK_ID_RE.test(String(t.taskId))&&t.status!=="DONE").map(t=>({taskId:t.taskId,title:typeof t.title==="string"?t.title:MISSING,status:typeof t.status==="string"?t.status:MISSING}));
}
export const LINK_CODE_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
/**
 * POST /v1/tasks/:id/runs sonucunu görev başına sınıflar: LINKED (201), ALREADY_LINKED (200 yeniden oynatma), REFUSED ({code,status}: sunucunun sabit hata kodu AYNEN),
 * DENIED ({reason}), STOPPED (423 Global Stop), NOT_ENABLED (izin listesi/rota yok), INVALID (2xx ama bağ bu görev/koşu değil), FAILED ({key,vars}: describePostResult).
 */
export function classifyLinkResult(res,taskId,runId){
  if(!res)return {kind:"FAILED",key:"post.err.generic",vars:{status:MISSING}};
  if(res.thrown&&/INVALID_API_PATH/.test(String(res.message??"")))return {kind:"NOT_ENABLED"};
  if(res.thrown){const d=describePostResult(res);return {kind:"FAILED",key:d.key,vars:d.vars}}
  const s=res.status,err=typeof res.body?.error==="string"?res.body.error:"";
  if(s===200||s===201){
    const l=isObj(res.body)?res.body.link:null;
    return isObj(l)&&l.taskId===taskId&&l.runId===runId?{kind:s===201?"LINKED":"ALREADY_LINKED"}:{kind:"INVALID"};
  }
  if(s===423)return {kind:"STOPPED"};
  if(s===403&&err==="ACTION_DENIED"){const reason=denialReason(res.body?.reason);if(reason)return {kind:"DENIED",reason}}
  if(Number.isSafeInteger(s)&&s>=400&&LINK_CODE_RE.test(err)&&err!=="ACTION_DENIED"&&err!=="GLOBAL_STOP_ACTIVE")return {kind:"REFUSED",code:err,status:s};
  const d=describePostResult(res);return {kind:"FAILED",key:d.key,vars:d.vars};
}

// ---------- Koşuya bağlı görevler (LANE-A A-FLOW-2) ----------
// //TR: GET /v1/work-runs/:id/tasks {links:[{taskId,runId,missionId,linkedAt,...}]} yanıtı SIKI eşlenir: her bağ istenen koşuya ait, kimlikler kanonik, görev tekrarsız olmalıdır; tek bozuk satır tüm okumayı ERROR yapar. Uç nokta masaüstü allow-list'inde henüz yoksa (INVALID_API_PATH) okuma UNAVAILABLE olur ve "bağlı görev yok" ASLA söylenmez.
export const runTasksPath=id=>typeof id==="string"&&RUN_ID_RE.test(id)?`/v1/work-runs/${id}/tasks`:null;
export function mapRunTasks(raw,runId){
  const bad={state:"ERROR",links:[]};
  const list=isObj(raw)?raw.links:null;if(!Array.isArray(list)||list.length>500)return bad;
  const seen=new Set(),links=[];
  for(const l of list){
    if(!isObj(l)||typeof l.taskId!=="string"||!TASK_ID_RE.test(l.taskId)||l.runId!==runId||typeof l.missionId!=="string"||!MISSION_ID_RE.test(l.missionId)||seen.has(l.taskId))return bad;
    seen.add(l.taskId);links.push({taskId:l.taskId,runId,missionId:l.missionId,linkedAt:iso(l.linkedAt)});
  }
  return {state:"VERIFIED",links};
}

// ---------- Koşu hazırlığı ve bloklu koşu nedenleri (LANE-A first-delivery) ----------
// //TR: Koşu başlamadan önce kayıtlardan okunabilen eksikler: depo yoksa runner REPOSITORY_NOT_CONFIGURED (uzak URL ise REMOTE_REPO_NOT_SUPPORTED_YET), mission ve proje kaydında test komutu yoksa TEST_COMMAND_NOT_CONFIGURED ile BLOK verir. "Kayıtlı" bir test komutu kabul edileceğini vaat etmez (runner komutu ayrıca izin listesinden geçirir); bu yüzden yalnız EKSİK durumlar kesin uyarıdır. Kayıt okunamadıysa UNKNOWN: olumlu bir hazırlık iddiası yok.
export function runReadiness({project,mission}){
  const repository=!project?"UNKNOWN":project.repositoryPath?"RECORDED":project.remoteRepository===true?"REMOTE":"MISSING";
  const testCommand=!mission?"UNKNOWN":(mission.testCommandSet===true||project?.testCommandSet===true)?"RECORDED":(project?"MISSING":"UNKNOWN");
  const blockers=[];
  if(repository==="MISSING")blockers.push("REPOSITORY_NOT_CONFIGURED");
  if(repository==="REMOTE")blockers.push("REMOTE_REPO_NOT_SUPPORTED_YET");
  if(testCommand==="MISSING")blockers.push("TEST_COMMAND_NOT_CONFIGURED");
  return {repository,testCommand,blockers};
}
/** Bilinen koşu BLOK nedenleri -> açıklama anahtarı; bilinmeyen neden aynen ham kalır. SANDBOX_UNAVAILABLE'ın mevcut açıklaması korunur. */
export const RUN_REASON_HINTS=Object.freeze(["CLAUDE_PROFILE_LOGIN_REQUIRED","CLAUDE_PROFILE_LOGIN_EXPIRED","CLAUDE_PROFILE_REFUSED","CLAUDE_CLI_NOT_FOUND","CLAUDE_CLI_SHIM_UNSUPPORTED","CLI_SHIM_UNSUPPORTED","PROVIDER_PROVENANCE_NOT_READY","CLAUDE_PACKAGE_PROVENANCE_REQUIRED","CLAUDE_LAUNCHER_PROVENANCE_CHANGED","EXECUTOR_NOT_CONFIGURED","REPOSITORY_NOT_CONFIGURED","TEST_COMMAND_NOT_CONFIGURED","REMOTE_REPO_NOT_SUPPORTED_YET","PROJECT_NOT_FOUND","MISSION_NOT_FOUND"]);
export const runReasonHintKey=reason=>typeof reason==="string"&&RUN_REASON_HINTS.includes(reason)?`run.reason.${reason}`:null;

/** Durum geçişi isteği; yalnız durum makinesinin izin verdiği hedefler, yüksek riskli hedeflerde confirmed===true şart.
 *  D-M1A-STATE-MODEL-2026-10-15: geçiş gövdesi hiçbir onay alanı taşımaz (COMPLETE yalnız PRODUCT_VERIFIED kanıtıyla olur); onay verilmeye çalışılırsa istek kurulmaz. */
export function buildTransitionRequest({missionId,from,to,reason,confirmed,acknowledgements}){
  const errors={},r=trim(reason);
  if(!MISSION_ID_RE.test(String(missionId??"")))errors.missionId="err.missionInvalid";
  if(!allowedNext(from).includes(to))errors.to="err.transitionNotAllowed";
  if(!errors.to&&requiresConfirm(to)&&confirmed!==true)errors.confirm="err.confirmRequired";
  if(reasonRequired(to)&&!r)errors.reason="err.reasonRequired";
  if(r.length>4000)errors.reason="err.reasonLong";
  if(acknowledgements!==undefined)errors.acknowledgement="err.ackNotForTransition";
  const body={to,reason:r||`${from} -> ${to} (UASCO Desktop)`};
  return result(`/v1/missions/${missionId}/transition`,body,errors);
}
// //TR: COORD-RUN-EXPERT: core/agents/first-delivery-bindings.ts içindeki developer bağlamalarının aynası (rol TANIMI; çalışan ajan veya sertifika DEĞİL). Seçilen roleId koşu gövdesine yazılır ve sunucuda runner kapısı (assertRoleExecutes(roleId,"developer")) onu yeniden denetler; burada listede olmayan rol hiç gönderilmez. "" = rol atanmadan (eski davranış).
export const RUN_EXPERTS=Object.freeze([Object.freeze({roleId:"UASCO-0085",function:"developer",capabilities:Object.freeze(["source-generation","backend-implementation"])})]);
export const RUN_EXPERT_NONE="";
export const isRunExpert=id=>RUN_EXPERTS.some(e=>e.roleId===id);
/** Koşu başlatma isteği: mission AUTHORIZED veya PLANNED olmalı; roleId verilmişse yalnız RUN_EXPERTS'teki bir rol olabilir. */
export function buildRunRequest({missionId,status,roleId}){
  const errors={};
  if(!MISSION_ID_RE.test(String(missionId??"")))errors.missionId="err.missionInvalid";
  if(!canStartRun(status))errors.status="err.runNotStartable";
  if(roleId!==undefined&&roleId!==RUN_EXPERT_NONE&&!isRunExpert(roleId))errors.roleId="err.roleNotExecutable";
  return result(`/v1/missions/${missionId}/runs`,isRunExpert(roleId)?{roleId}:{},errors);
}

// ---------- POST sonucu ----------
// //TR: SBX-GATE: SANDBOX_UNAVAILABLE dürüst bir ret nedenidir (doğrulanmış sandbox yok, proje kodu çalıştırılmadı); genel 409 yerine açık ileti gösterilir.
// //TR: M1a c2: teslim artefaktı retleri ({error:<kod>}) da açık iletiyle gösterilir (NO_GENERATED_SOURCE, hash uyuşmazlığı vb.).
const KNOWN_409=new Set(["EXECUTOR_NOT_CONFIGURED","SANDBOX_UNAVAILABLE","NO_GENERATED_SOURCE","SOURCE_GENERATION_NOT_COMPLETE","DELIVERY_ALREADY_ACCEPTED","DELIVERY_ARTIFACT_HASH_MISMATCH","DELIVERY_ARTIFACT_MISSING","DELIVERY_ARTIFACT_NOT_PREPARED","DELIVERY_SOURCE_UNAVAILABLE","EXPORT_BLOCKED_SECRET","PLAN_ALREADY_EXISTS","MISSION_NOT_PLANNABLE"]);
// //TR: M1a + FX-1: COMPLETE kanıt kapısı reddi {error:"WORKOS_CONFLICT", reason:<sabit kod>} olarak gelir; onay gerektiren nedenler açık iletiyle gösterilir.
// D-M1A-STATE-MODEL-2026-10-15: COMPLETE PRODUCT_VERIFIED ister; kaynak teslimi kabul kapısı da {error:"WORKOS_CONFLICT", reason} ile reddeder.
const KNOWN_COMPLETION_409=new Set(["COMPLETION_PRODUCT_NOT_VERIFIED","COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED","SOURCE_GENERATION_NOT_COMPLETE","NO_GENERATED_SOURCE","DELIVERY_ACCEPTANCE_MISMATCH","DELIVERY_ALREADY_ACCEPTED",
  "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT","DELIVERY_ARTIFACT_NOT_PREPARED","DELIVERY_NOT_LATEST_RUN","DELIVERY_MISSION_NOT_REPORTING","DELIVERY_RUN_NOT_AWAITING_APPROVAL","DELIVERY_PRODUCT_VERIFIED_USE_COMPLETE",
  // //TR: COORD-TASK-UI: görev geçişi retleri (bağımlılık bitmedi, mission tamamlandı) aynı {error:"WORKOS_CONFLICT", reason} biçimiyle gelir.
  "TASK_DEPENDENCIES_NOT_DONE","MISSION_COMPLETE"]);
/** //TR: UI-109: ACTION_DENIED nedeni ilk ':' öncesine kesilir; yalnız sabit kod biçimine uyuyorsa gösterilir, yoksa "" (neden uydurulmaz). */
function denialReason(raw){
  if(typeof raw!=="string")return "";
  const code=raw.split(":")[0];
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(code)?code:"";
}
/** Köprü POST yanıtını {ok, key, vars} olarak sınıflar; key bir sözlük anahtarıdır (post.*). */
// //TR: LANE-A A-FLOW-4 (B-RUN-1): ürün başlat/durdur reddi gövdesi {error:<kod>, reason?:<kesin neden>}; neden yalnız güvenli desenliyse aktarılır (ham metin gösterilmez).
const PRODUCT_409=new Set(["DEVRUN_SANDBOX_UNAVAILABLE","PRODUCT_RUN_NOT_DELIVERABLE","PRODUCT_RUN_NOT_THIS_DELIVERY","DEVRUN_ALREADY_RUNNING","DEVRUN_BLOCKED","DEVRUN_LOCKED","DEVRUN_DELIVERY_HEAD_MISSING"]);
const SAFE_REASON_RE=/^[A-Z][A-Z0-9_]{0,63}(?::[A-Za-z0-9_.:-]{1,80})?$/;
export function describePostResult(res){
  if(!res)return {ok:false,key:"post.err.generic",vars:{status:MISSING}};
  if(res.thrown)return {ok:false,key:res.state==="OFFLINE"?"post.err.offline":"post.err.generic",vars:{status:MISSING}};
  const s=res.status,err=typeof res.body?.error==="string"?res.body.error:"";
  if(s>=200&&s<300)return {ok:true,key:"post.ok",vars:{}};
  if(s===400)return {ok:false,key:"post.err.400",vars:{status:s}};
  if(s===403&&err==="ACTION_DENIED"){const reason=denialReason(res.body?.reason);if(reason)return {ok:false,key:"post.err.denied",vars:{status:s,reason}}}
  if(s===401||s===403)return {ok:false,key:"post.err.auth",vars:{status:s}};
  if(s===404||s===501)return {ok:false,key:"post.err.unavailable",vars:{status:s}};
  if(s===409&&err==="WORKOS_CONFLICT"&&KNOWN_COMPLETION_409.has(res.body?.reason))return {ok:false,key:`post.err.409.${res.body.reason}`,vars:{status:s}};
  if(s===409&&PRODUCT_409.has(err)){const r=res.body?.reason;return {ok:false,key:`post.err.409.${err}`,vars:{status:s,reason:typeof r==="string"&&r.length<=160&&SAFE_REASON_RE.test(r)?r:"UNKNOWN"}}}
  if(s===409)return KNOWN_409.has(err)?{ok:false,key:`post.err.409.${err}`,vars:{status:s}}:{ok:false,key:"post.err.409",vars:{status:s}};
  if(s===423)return {ok:false,key:"post.err.423",vars:{status:s}};
  if(s===503)return {ok:false,key:"post.err.503",vars:{status:s}};
  return {ok:false,key:"post.err.generic",vars:{status:Number.isSafeInteger(s)?s:MISSING}};
}

// ---------- Eşleyiciler ----------
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&!Number.isNaN(new Date(x).getTime())?x:null;
const pick=(...v)=>v.find(x=>x!==undefined&&x!==null);
const statusStr=x=>typeof x==="string"&&/^[A-Z][A-Z0-9_]{0,39}$/.test(x)?x:null;
const arr=(x,max=100)=>Array.isArray(x)?x.slice(0,max):[];
export function formatDateTime(isoString,lang="tr"){
  if(typeof isoString!=="string"||!isoString)return MISSING;const d=new Date(isoString);if(Number.isNaN(d.getTime()))return MISSING;
  try{return new Intl.DateTimeFormat(lang==="en"?"en-GB":"tr-TR",{dateStyle:"short",timeStyle:"medium",hour12:false}).format(d)}catch{return MISSING}
}
export function mapMissionDetail(raw){
  const m=isObj(raw)&&isObj(raw.mission)?raw.mission:null;
  if(!m||!MISSION_ID_RE.test(String(m.missionId??"")))return {state:"ERROR",mission:null};
  // //TR: COORD-TASK-UI: dependsOn yalnız sunucu dizi döndürdüyse ve geçerli görev kimlikleri içeriyorsa okunur; alan yoksa null (bilinmiyor) kalır, uydurulmaz.
  const tasks=arr(raw.tasks,200).filter(isObj).map(t=>({taskId:str(t.taskId,80),title:str(t.title,200)??MISSING,status:statusStr(t.status)??MISSING,
    dependsOn:Array.isArray(t.dependsOn)?t.dependsOn.slice(0,50).filter(d=>typeof d==="string"&&TASK_ID_RE.test(d)):null})).filter(t=>t.taskId);
  return {state:"VERIFIED",mission:{
    missionId:m.missionId,projectId:str(m.projectId,80),title:str(m.title,200)??MISSING,objective:str(m.objective,4000)??MISSING,
    acceptanceCriteria:arr(m.acceptanceCriteria,50).filter(c=>typeof c==="string").map(c=>c.slice(0,4000)),
    status:statusStr(m.status)??MISSING,riskLevel:str(m.riskLevel,8)??MISSING,createdAt:iso(m.createdAt),testCommandSet:Array.isArray(m.testCommand)&&m.testCommand.length>0,tasks}};
}
function mapRunEvidence(list){
  return arr(list,100).map(e=>{
    if(typeof e==="string")return SAFE_ID_RE.test(e)?{evidenceId:e,kind:null,verification:null}:null;
    if(!isObj(e))return null;
    const id=pick(e.evidenceId,e.id);
    return {evidenceId:typeof id==="string"&&SAFE_ID_RE.test(id)?id:null,kind:str(e.kind,40),verification:normalizeVerification(e.verification),
      // //TR: LANE-A: koşu adımı tablosu için sunucunun kaydettiği olgular (RunEvidence): adım, döngü, çıkış kodu, süre ve zaman aşımı. Geçersiz tür null kalır; 0 veya "başarılı" uydurulmaz.
      step:/^[A-Z][A-Z_]{0,19}$/.test(String(e.step))?e.step:null,cycle:safeCount(e.cycle),exitCode:Number.isSafeInteger(e.exitCode)?e.exitCode:null,timedOut:e.timedOut===true,startedAt:iso(e.startedAt),endedAt:iso(e.endedAt)};
  }).filter(Boolean);
}
/** Kanıt kaydından süre (ms); iki zaman da geçerli ve bitiş >= başlangıç değilse null (uydurulmaz). */
export function evidenceDurationMs(e){
  const a=Date.parse(e?.startedAt??""),b=Date.parse(e?.endedAt??"");
  return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
}
/** Koşu adımı tablosu satırları: yalnız adım bilgisi taşıyan (nesne biçimli ve step/startedAt'ı olan) kanıt kayıtları, kayıt sırasıyla. */
export function runStepRows(evidence){
  return (Array.isArray(evidence)?evidence:[]).filter(e=>e&&(e.step||e.startedAt)).map(e=>({evidenceId:e.evidenceId,kind:e.kind,step:e.step,cycle:e.cycle,exitCode:e.exitCode,timedOut:e.timedOut===true,startedAt:e.startedAt,durationMs:evidenceDurationMs(e)}));
}
/** En son REVIEW kanıt kaydı (en yüksek cycle, eşitlikte dizideki son); yoksa null. */
function latestReviewEvidence(list){
  let best=null,bestCycle=-1;
  for(const e of arr(list,100)){
    if(!isObj(e)||e.step!=="REVIEW"||(typeof e.reviewerIdentity!=="string"&&typeof e.verdict!=="string"))continue;
    const cyc=Number.isSafeInteger(e.cycle)?e.cycle:0;if(cyc>=bestCycle){best=e;bestCycle=cyc}
  }
  return best;
}
/** Kontrol noktası adı: düz ad alanları, yoksa Lane B {step, cycle} biçimi ("REVIEW #1"). */
function checkpointName(c){
  const n=str(pick(c.name,c.id,c.label),120);if(n)return n;
  const st=str(c.step,60);return st?`${st}${Number.isSafeInteger(c.cycle)?` #${c.cycle}`:""}`:null;
}
// //TR: core/workos/outcomes.ts productVerificationOf'un birebir yansıması (yalnız kanıttan): PRODUCT_VERIFIED için run.headSha'ya bağlı VERIFY_TESTS VE REGRESSION_TESTS, ikisi exit 0, ikisi de sandbox tanıklı, TEST_SURFACE'te yürütülen test sayısı > 0, BLOCKED test yüzeyi ve onay gerektiren test değişikliği yok. Sıfır çıkışsız kanıt FAILED, eksik/başka-SHA/kısmi kanıt NOT_VERIFIED.
const HEAD_SHA_RE=/^[0-9a-f]{40}$/,SANDBOX_ID_RE=/^[A-Za-z0-9._:@/-]{1,200}$/;
const latestEv=(list,pred)=>{for(let i=list.length-1;i>=0;i--)if(isObj(list[i])&&pred(list[i]))return list[i];return undefined};
const nonEmpty=a=>Array.isArray(a)&&a.length>0;
export function productVerificationOf(head,evidence){
  const pv=(state,reason)=>({state,reason});
  const ev=Array.isArray(evidence)?evidence:[];
  if(typeof head!=="string"||!HEAD_SHA_RE.test(head))return pv("NOT_VERIFIED","NOT_EXECUTED:NO_HEAD_COMMIT");
  const ts=latestEv(ev,e=>e.kind==="TEST_SURFACE"&&e.commitSha===head&&isObj(e.testSurface)),surf=ts?.testSurface;
  if(surf?.functionalAcceptance==="BLOCKED")return pv("NOT_VERIFIED","TEST_SURFACE_BLOCKED");
  if(ev.some(e=>isObj(e)&&(e.kind==="VERIFY_TESTS_NOT_EXECUTED"||e.kind==="REGRESSION_TESTS_NOT_EXECUTED")&&e.commitSha===head))return pv("NOT_VERIFIED","NOT_EXECUTED:SANDBOX_UNAVAILABLE");
  const v=latestEv(ev,e=>e.kind==="VERIFY_TESTS"&&e.commitSha===head),g=latestEv(ev,e=>e.kind==="REGRESSION_TESTS"&&e.commitSha===head);
  if((v&&v.exitCode!==0)||(g&&g.exitCode!==0))return pv("FAILED","TESTS_FAILED");
  if(!v||!g)return pv("NOT_VERIFIED","NOT_EXECUTED:TESTS_NOT_REACHED");
  const attested=e=>typeof e.sandboxProviderId==="string"&&SANDBOX_ID_RE.test(e.sandboxProviderId);
  if(!attested(v)||!attested(g))return pv("NOT_VERIFIED","SANDBOX_ATTESTATION_MISSING");
  const n=surf?.executedTests;
  if(!ts||typeof n!=="number"||!Number.isSafeInteger(n)||n<=0)return pv("NOT_VERIFIED",n===0?"ZERO_TESTS_EXECUTED":"EXECUTED_TEST_COUNT_UNKNOWN");
  if(nonEmpty(surf.modified)||nonEmpty(surf.deleted)||nonEmpty(surf.renamed)||nonEmpty(surf.harness)||nonEmpty(surf.weakened))return pv("NOT_VERIFIED","TEST_CHANGES_REQUIRE_INDEPENDENT_VERIFICATION");
  return pv("PRODUCT_VERIFIED","TESTS_EXECUTED_IN_VERIFIED_SANDBOX");
}
/** Eşlenmiş koşu yalnız sunucunun kesin kuralıyla PRODUCT_VERIFIED ise true; tek başına testsExecuted asla yeterli değildir. */
export const isProductVerified=run=>run?.evidenceVerification?.state==="PRODUCT_VERIFIED";
export function mapWorkRun(x){
  if(!isObj(x))return null;
  const idv=pick(x.runId,x.workRunId,x.id);if(typeof idv!=="string"||!SAFE_ID_RE.test(idv))return null;
  const stepRaw=x.step,step=typeof stepRaw==="string"?{name:str(stepRaw,120),index:null,total:null}:isObj(stepRaw)?{name:str(pick(stepRaw.name,stepRaw.label,stepRaw.id),120),index:Number.isSafeInteger(stepRaw.index)?stepRaw.index:null,total:Number.isSafeInteger(stepRaw.total)?stepRaw.total:null}:null;
  // //TR: B5-C1-001: Lane B WorkRun biçimi (core/workos/types.ts): reviewer kimliği run.executor.reviewer ve REVIEW kanıt kaydında reviewerIdentity, karar o kayıtta verdict:'CLEAN'|'BLOCKED'. Alan gerçekten yoksa null kalır; arayüz bunu "sunucu bildirmedi" diye gösterir, "atanmadı" diye uydurmaz.
  const rv=isObj(x.reviewer)?x.reviewer:{},rev=latestReviewEvidence(x.evidence),exec=isObj(x.executor)?x.executor:{};
  const identity=str(pick(rv.identity,rv.id,rv.name,x.reviewerIdentity,typeof x.reviewer==="string"?x.reviewer:undefined,rev?.reviewerIdentity,exec.reviewer),120),verdict=statusStr(pick(rv.verdict,x.reviewerVerdict,rev?.verdict,x.verdict));
  const lease=isObj(x.lease)?x.lease:{};
  return {
    runId:idv,missionId:typeof x.missionId==="string"&&MISSION_ID_RE.test(x.missionId)?x.missionId:null,
    status:statusStr(x.status)??MISSING,step:step&&(step.name||step.index!==null)?step:null,
    role:str(pick(x.role,x.roleId,x.agentRole,isObj(x.worker)?x.worker.role:undefined),120),
    leaseExpiresAt:iso(pick(lease.expiresAt,x.leaseExpiresAt)),heartbeatAt:iso(pick(x.heartbeatAt,x.lastHeartbeatAt,lease.heartbeatAt)),
    startedAt:iso(pick(x.startedAt,x.createdAt)),
    checkpoints:arr(x.checkpoints,50).map(c=>typeof c==="string"?{name:c.slice(0,120),status:null,at:null}:isObj(c)?{name:checkpointName(c),status:statusStr(c.status),at:iso(pick(c.at,c.createdAt,c.time))}:null).filter(c=>c&&c.name),
    checkpointsReported:Array.isArray(x.checkpoints),
    // SBX-GATE: koşunun durma/engellenme nedeni (ör. SANDBOX_UNAVAILABLE) sunucunun verdiği haliyle, kısaltılmış metin olarak taşınır.
    reason:str(x.reason,300),
    // UI-111: sunucunun kaydettiği yeniden deneme olguları (core/workos/types.ts WorkRun); geçersiz tür null kalır, 0 uydurulmaz. retryCount adım içindir, remediationCycle/attempt koşu boyuncadır.
    retryCount:safeCount(x.retryCount),remediationCycle:safeCount(x.remediationCycle),attempt:safeCount(x.attempt),retryAt:iso(x.retryAt),
    // M1a: test yürütme kanıtı (VERIFY_TESTS/REGRESSION_TESTS) yalnız doğrulanmış sandbox'ta oluşur; yoksa koşu NOT_VERIFIED rozetini taşır.
    testsExecuted:arr(x.evidence,100).some(e=>isObj(e)&&(e.kind==="VERIFY_TESTS"||e.kind==="REGRESSION_TESTS")),
    testsNotExecuted:arr(x.evidence,100).some(e=>isObj(e)&&(e.kind==="VERIFY_TESTS_NOT_EXECUTED"||e.kind==="REGRESSION_TESTS_NOT_EXECUTED")),
    headSha:typeof x.headSha==="string"&&/^[0-9a-f]{40}$/.test(x.headSha)?x.headSha:null,
    evidenceVerification:productVerificationOf(x.headSha,arr(x.evidence,100)),
    evidence:mapRunEvidence(x.evidence),reviewer:identity||verdict?{identity,verdict}:null
  };
}
export function mapWorkRuns(raw){
  if(!isObj(raw))return {state:"ERROR",items:[]};
  const list=pick(raw.workRuns,raw.runs,raw.items);if(!Array.isArray(list))return {state:"ERROR",items:[]};
  return {state:"VERIFIED",items:list.slice(0,500).map(mapWorkRun).filter(Boolean)};
}
export function mapWorkRunDetail(raw){
  const inner=isObj(raw)?pick(raw.workRun,raw.run,raw):null,run=mapWorkRun(inner);
  if(!run)return {state:"ERROR",run:null};
  const o=isObj(raw?.outcomes)?raw.outcomes:null;
  run.outcomes=o?{functionalAcceptance:statusStr(o.functionalAcceptance),completionMode:statusStr(o.completionMode)}:null;
  // M1a c2: iki ayrı eksen ve teslim görünümü yalnız sunucudan okunur; bilinmeyen değer asla PRODUCT_VERIFIED sayılmaz.
  run.delivery=mapDelivery(raw?.delivery);
  run.sourceGeneration=run.delivery?.sourceGeneration?.state??null;
  run.productVerification=run.delivery?.productVerification?.state??null;
  return {state:"VERIFIED",run};
}
export function normalizeVerification(v){return VERIFICATION_STATES.includes(v)?v:null}
/** Doğrulama durumu -> DSK-061-08 çip türü; yalnız tam "VERIFIED" doğrulanmış gösterilir, bilinmeyen değer UNVERIFIED olur. */
export function verificationChipKind(v){
  switch(normalizeVerification(v)){case "VERIFIED":return "VERIFIED";case "MISMATCH":return "ERROR";case "MISSING":return "STALE";default:return "UNVERIFIED"}
}
export function mapEvidenceItem(x){
  if(!isObj(x))return null;
  const idv=pick(x.evidenceId,x.id);if(typeof idv!=="string"||!SAFE_ID_RE.test(idv))return null;
  const sha=str(x.sha256,80);
  return {
    evidenceId:idv,missionId:typeof x.missionId==="string"&&MISSION_ID_RE.test(x.missionId)?x.missionId:null,runId:typeof x.runId==="string"&&SAFE_ID_RE.test(x.runId)?x.runId:null,
    kind:str(x.kind,40),verification:normalizeVerification(x.verification),sourcePath:str(pick(x.sourcePath,x.path,x.source),1000),
    sha256:sha&&SHA256_RE.test(sha)?sha.toLowerCase():null,logTail:str(pick(x.logTail,x.redactedLogTail,x.tail),20000),createdAt:iso(pick(x.createdAt,x.at))
  };
}
export function mapEvidenceList(raw){
  if(!isObj(raw))return {state:"ERROR",items:[],nextCursor:null};
  const list=pick(raw.evidence,raw.items);if(!Array.isArray(list))return {state:"ERROR",items:[],nextCursor:null};
  const next=str(pick(raw.nextCursor,raw.cursor,raw.next),128);
  return {state:"VERIFIED",items:list.slice(0,500).map(mapEvidenceItem).filter(Boolean),nextCursor:next&&/^[A-Za-z0-9_.=:-]{1,128}$/.test(next)?next:null};
}
export function mapEvidenceDetail(raw){
  const item=mapEvidenceItem(isObj(raw)?pick(raw.evidence,raw):null);return item?{state:"VERIFIED",item}:{state:"ERROR",item:null};
}
export function filterEvidence(items,{verification="ALL",kind="ALL"}={}){
  return items.filter(e=>(verification==="ALL"||(verification==="NONE"?e.verification===null:e.verification===verification))&&(kind==="ALL"||e.kind===kind));
}

// ---------- Gelen Kutusu türetimi ----------
/** Founder kararı bekleyen işler: REPORTING + AWAITING_APPROVAL koşusu (teslim kararı) ve FOUNDER_ATTENTION_REQUIRED; hiçbir şey otomatik onaylanmaz, yalnız eylem tanımları üretilir. */
export function deriveInbox(missions,runs){
  const items=[],byMission=new Map();
  for(const r of runs??[])if(r.missionId&&r.status==="AWAITING_APPROVAL"&&!byMission.has(r.missionId))byMission.set(r.missionId,r);
  for(const m of missions??[]){
    if(!isObj(m)||!MISSION_ID_RE.test(String(m.missionId??"")))continue;
    const next=allowedNext(m.status);
    if(m.status==="REPORTING"&&byMission.has(m.missionId)){
      const actions=[];
      if(next.includes("COMPLETE"))actions.push({type:"accept",to:"COMPLETE"});
      for(const to of ["REMEDIATING","BLOCKED"])if(next.includes(to))actions.push({type:"reject",to});
      items.push({kind:"DELIVERY_DECISION",missionId:m.missionId,projectId:m.projectId??null,title:m.title??m.missionId,riskLevel:m.riskLevel??MISSING,status:m.status,runId:byMission.get(m.missionId).runId,actions});
    }else if(m.status==="FOUNDER_ATTENTION_REQUIRED"){
      const actions=[];
      for(const to of ["PREFLIGHT","BLOCKED"])if(next.includes(to))actions.push({type:to==="BLOCKED"?"reject":"retry",to});
      items.push({kind:"FOUNDER_ATTENTION",missionId:m.missionId,projectId:m.projectId??null,title:m.title??m.missionId,riskLevel:m.riskLevel??MISSING,status:m.status,runId:null,actions});
    }
  }
  return items;
}
export function filterMissions(items,status){return status==="ALL"||!status?items:items.filter(m=>m.status===status)}
export function liveRuns(runs){return (runs??[]).filter(r=>RUN_ACTIVE_STATES.includes(r.status))}

// //TR: UI-026 salt-okunur görev denetçisi: yalnız GET /v1/missions/:id (görevler) ve GET /v1/work-runs okumalarından türetilir. Okuma VERIFIED değilse (STALE dahil) olumlu değer yoktur → UNKNOWN; API'nin vermediği alanlar (atanan, bitiş, bağımlılık, açıklama) asla uydurulmaz ve koşu-görev bağı sunucuda olmadığından bağ UNKNOWN kalır.
export const TASK_UNKNOWN_FIELDS=Object.freeze(["assignee","dueAt","dependencies","description"]);
export function deriveTaskInspector(detailRes,runsRes,taskId){
  if(detailRes?.state!=="VERIFIED"||!detailRes.mission)return {state:"UNKNOWN",task:null};
  const m=detailRes.mission,t=(m.tasks??[]).find(x=>x.taskId===taskId);
  if(!t)return {state:"EMPTY",task:null};
  const runsKnown=runsRes?.state==="VERIFIED"&&Array.isArray(runsRes.items),byStatus={};
  if(runsKnown)for(const r of runsRes.items)byStatus[r.status]=(byStatus[r.status]??0)+1;
  return {state:"VERIFIED",task:{taskId:t.taskId,title:t.title,status:t.status,missionId:m.missionId,missionTitle:m.title,missionStatus:m.status,riskLevel:m.riskLevel,
    // //TR: COORD-TASK-UI: bağımlılıklar yalnız okumada dependsOn dizisi varsa gösterilir (başlık/durum aynı mission'ın görevlerinden); yoksa alan UNKNOWN kalır.
    dependencies:Array.isArray(t.dependsOn)?t.dependsOn.map(id=>{const d=(m.tasks??[]).find(x=>x.taskId===id);return {taskId:id,title:d?.title??null,status:d?.status??null}}):null,
    runs:runsKnown?{known:true,count:runsRes.items.length,byStatus}:{known:false,count:null,byStatus:{}},unknownFields:TASK_UNKNOWN_FIELDS.filter(k=>k!=="dependencies"||!Array.isArray(t.dependsOn))}};
}

// //TR: UI-025 salt-okunur görev/koşu zaman çizelgesi: yalnız GET /v1/missions/:id ve GET /v1/work-runs okumalarından türetilir. Zaman damgası olmayan olay UNKNOWN sırada sona konur, zaman uydurulmaz; mission okuması VERIFIED değilse (STALE dahil) UNKNOWN; koşu okuması VERIFIED değilse koşu olayları yoktur ve runsKnown=false döner.
export function deriveWorkTimeline(detailRes,runsRes){
  if(detailRes?.state!=="VERIFIED"||!detailRes.mission)return {state:"UNKNOWN",runsKnown:false,events:[]};
  const m=detailRes.mission,runsKnown=runsRes?.state==="VERIFIED"&&Array.isArray(runsRes.items);
  const ev=[{kind:"mission",id:m.missionId,label:m.title,at:m.createdAt??null,status:m.status}];
  if(runsKnown)for(const r of runsRes.items){
    ev.push({kind:"run",id:r.runId,label:r.runId,at:r.startedAt??null,status:r.status});
    for(const c of r.checkpoints??[])ev.push({kind:"checkpoint",id:r.runId,label:c.name,at:c.at??null,status:c.status??null});
  }
  const key=e=>e.at===null?Infinity:Date.parse(e.at);
  const sorted=ev.map((e,i)=>({e,i})).sort((a,b)=>{const ka=key(a.e),kb=key(b.e);return ka===kb?a.i-b.i:ka<kb?-1:1}).map(x=>x.e);
  return {state:"VERIFIED",runsKnown,events:sorted};
}
