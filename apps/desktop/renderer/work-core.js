// //TR: Bu modül B5 iş ekranlarının saf (DOM'suz) çekirdeğidir: mission durum makinesinin salt-okunur kopyası (core/mission/state-machine.ts ile test eşleşir), yalnız izinli sonraki geçişler, yüksek riskli geçiş onayı, proje/mission/geçiş/koşu istek gövdesi kurucuları (argv dizisi, idempotency anahtarı, doğrulama), POST sonuç sınıflandırması, work-run/evidence eşleyicileri ve Gelen Kutusu türetimi; eksik veri asla uydurulmaz.
import {MISSING} from "./model.js";
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
/** Koşu başlatma isteği: mission AUTHORIZED veya PLANNED olmalı. */
export function buildRunRequest({missionId,status}){
  const errors={};
  if(!MISSION_ID_RE.test(String(missionId??"")))errors.missionId="err.missionInvalid";
  if(!canStartRun(status))errors.status="err.runNotStartable";
  return result(`/v1/missions/${missionId}/runs`,{},errors);
}

// ---------- POST sonucu ----------
// //TR: SBX-GATE: SANDBOX_UNAVAILABLE dürüst bir ret nedenidir (doğrulanmış sandbox yok, proje kodu çalıştırılmadı); genel 409 yerine açık ileti gösterilir.
// //TR: M1a c2: teslim artefaktı retleri ({error:<kod>}) da açık iletiyle gösterilir (NO_GENERATED_SOURCE, hash uyuşmazlığı vb.).
const KNOWN_409=new Set(["EXECUTOR_NOT_CONFIGURED","SANDBOX_UNAVAILABLE","NO_GENERATED_SOURCE","SOURCE_GENERATION_NOT_COMPLETE","DELIVERY_ALREADY_ACCEPTED","DELIVERY_ARTIFACT_HASH_MISMATCH","DELIVERY_ARTIFACT_MISSING","DELIVERY_ARTIFACT_NOT_PREPARED","DELIVERY_SOURCE_UNAVAILABLE","EXPORT_BLOCKED_SECRET"]);
// //TR: M1a + FX-1: COMPLETE kanıt kapısı reddi {error:"WORKOS_CONFLICT", reason:<sabit kod>} olarak gelir; onay gerektiren nedenler açık iletiyle gösterilir.
// D-M1A-STATE-MODEL-2026-10-15: COMPLETE PRODUCT_VERIFIED ister; kaynak teslimi kabul kapısı da {error:"WORKOS_CONFLICT", reason} ile reddeder.
const KNOWN_COMPLETION_409=new Set(["COMPLETION_PRODUCT_NOT_VERIFIED","COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED","SOURCE_GENERATION_NOT_COMPLETE","NO_GENERATED_SOURCE","DELIVERY_ACCEPTANCE_MISMATCH","DELIVERY_ALREADY_ACCEPTED",
  "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT","DELIVERY_ARTIFACT_NOT_PREPARED","DELIVERY_NOT_LATEST_RUN","DELIVERY_MISSION_NOT_REPORTING","DELIVERY_RUN_NOT_AWAITING_APPROVAL","DELIVERY_PRODUCT_VERIFIED_USE_COMPLETE"]);
/** Köprü POST yanıtını {ok, key, vars} olarak sınıflar; key bir sözlük anahtarıdır (post.*). */
export function describePostResult(res){
  if(!res)return {ok:false,key:"post.err.generic",vars:{status:MISSING}};
  if(res.thrown)return {ok:false,key:res.state==="OFFLINE"?"post.err.offline":"post.err.generic",vars:{status:MISSING}};
  const s=res.status,err=typeof res.body?.error==="string"?res.body.error:"";
  if(s>=200&&s<300)return {ok:true,key:"post.ok",vars:{}};
  if(s===400)return {ok:false,key:"post.err.400",vars:{status:s}};
  if(s===401||s===403)return {ok:false,key:"post.err.auth",vars:{status:s}};
  if(s===404||s===501)return {ok:false,key:"post.err.unavailable",vars:{status:s}};
  if(s===409&&err==="WORKOS_CONFLICT"&&KNOWN_COMPLETION_409.has(res.body?.reason))return {ok:false,key:`post.err.409.${res.body.reason}`,vars:{status:s}};
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
  const tasks=arr(raw.tasks,200).filter(isObj).map(t=>({taskId:str(t.taskId,80),title:str(t.title,200)??MISSING,status:statusStr(t.status)??MISSING})).filter(t=>t.taskId);
  return {state:"VERIFIED",mission:{
    missionId:m.missionId,projectId:str(m.projectId,80),title:str(m.title,200)??MISSING,objective:str(m.objective,4000)??MISSING,
    acceptanceCriteria:arr(m.acceptanceCriteria,50).filter(c=>typeof c==="string").map(c=>c.slice(0,4000)),
    status:statusStr(m.status)??MISSING,riskLevel:str(m.riskLevel,8)??MISSING,createdAt:iso(m.createdAt),tasks}};
}
function mapRunEvidence(list){
  return arr(list,100).map(e=>{
    if(typeof e==="string")return SAFE_ID_RE.test(e)?{evidenceId:e,kind:null,verification:null}:null;
    if(!isObj(e))return null;
    const id=pick(e.evidenceId,e.id);
    return {evidenceId:typeof id==="string"&&SAFE_ID_RE.test(id)?id:null,kind:str(e.kind,40),verification:normalizeVerification(e.verification)};
  }).filter(Boolean);
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
    // M1a: test yürütme kanıtı (VERIFY_TESTS/REGRESSION_TESTS) yalnız doğrulanmış sandbox'ta oluşur; yoksa koşu NOT_VERIFIED rozetini taşır.
    testsExecuted:arr(x.evidence,100).some(e=>isObj(e)&&(e.kind==="VERIFY_TESTS"||e.kind==="REGRESSION_TESTS")),
    testsNotExecuted:arr(x.evidence,100).some(e=>isObj(e)&&(e.kind==="VERIFY_TESTS_NOT_EXECUTED"||e.kind==="REGRESSION_TESTS_NOT_EXECUTED")),
    headSha:typeof x.headSha==="string"&&/^[0-9a-f]{40}$/.test(x.headSha)?x.headSha:null,
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
    runs:runsKnown?{known:true,count:runsRes.items.length,byStatus}:{known:false,count:null,byStatus:{}},unknownFields:[...TASK_UNKNOWN_FIELDS]}};
}
