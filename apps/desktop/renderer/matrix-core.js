// //TR: Bu modül Çoklu Proje Komuta Matrisi görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-205): yalnız dört salt-okunur ve zaten izinli GET (GET /v1/projects, GET /v1/missions, GET /v1/work-runs, GET /v1/cockpit) yanıtını güvenli, sınırlı alanlara eşler ve proje başına tek satırlık bir matris türetir. Mission ve koşu eşleyicileri Yönetim Özeti ile AYNI katı, fail-closed eşleyicilerdir (executive-core.js; tek sahiplik, iki ekran farklı yorum üretemez): tek bozuk kayıt KISMEN değil tümden ERROR olur. HİÇBİR veri uydurulmaz: durumlar kayıttan AYNEN taşınır (yükseltme yok), bir sayı yalnız bağlı olduğu kaynak okunabiliyorsa vardır (okunamayan kaynağın sayısı null'dır, asla 0 değil), karar (CLEAN/BLOCKED) sunucudan AYNEN gelir. Proje "durumu" sağlık iddiası DEĞİL, kayıtlı etkinliğin dürüst bir sınıflandırmasıdır: ATTENTION_NEEDED (kayıtlı engelli / onay bekleyen iş var), UNKNOWN (dikkat sinyali yok ama bir kaynak okunamadı), ACTIVE (açık iş var), IDLE (kayıt var, açık iş yok), NO_ACTIVITY (hiç mission/koşu yok). "Sağlıklı", "doğrulanmış" ya da "yeşil" diye bir proje durumu YOKTUR; teslim yalnız kaynak düzeyindedir ve daima NOT_VERIFIED kalır; bağımsızlık kanıtı bu modülde yeniden türetilmez (Kalite Kapısı ekranı GET /v1/reviews ile denetler). Ürün doğrulaması bu modülde hiçbir yerde üretilmez ve ilgili sabit değer bu dosyada hiç yer almaz.
import {PROJECT_ID_RE} from "./work-core.js";
import {COCKPIT_PATH,MISSIONS_PATH,WORK_RUNS_PATH,TERMINAL_RUN_STATUSES,AWAITING_RUN_STATUS,IN_PROGRESS_MISSION_STATUSES,PILL_FOR_RUN_STATUS,mapExecCockpit,mapExecMissions,mapExecWorkRuns,shortSha} from "./executive-core.js";

export {COCKPIT_PATH,MISSIONS_PATH,WORK_RUNS_PATH,PILL_FOR_RUN_STATUS,shortSha};
export const PROJECTS_PATH="/v1/projects";
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); dördü de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. */
export const MATRIX_SOURCES=Object.freeze(["projects","missions","workRuns","cockpit"]);
export const MATRIX_SOURCE_PATHS=Object.freeze({projects:PROJECTS_PATH,missions:MISSIONS_PATH,workRuns:WORK_RUNS_PATH,cockpit:COCKPIT_PATH});
/** Matris sütunları (sıra sabit; görünüm başlık hücrelerini bu sırayla kurar). */
export const MATRIX_COLUMNS=Object.freeze(["project","status","missions","runs","blocked","awaiting","review","delivery","open"]);
/**
 * Proje durumları (grup sırası = "önce dikkat gerektirenler"). Hiçbiri sağlık/doğrulama iddiası değildir:
 * ATTENTION_NEEDED kayıtlı engelli ya da onay bekleyen iş var; UNKNOWN dikkat sinyali yok ama mission/koşu kaynağı okunamadı; ACTIVE açık iş var; IDLE kayıt var açık iş yok; NO_ACTIVITY hiç kayıt yok.
 */
export const MATRIX_STATUSES=Object.freeze(["ATTENTION_NEEDED","UNKNOWN","ACTIVE","IDLE","NO_ACTIVITY"]);
/** Dikkat sinyalleri (sıra sabit) ve her birinin dayandığı tek kaynak. Her sinyal YALNIZ kayıtlı bir durumdan türer. */
export const SIGNAL_CODES=Object.freeze(["MISSION_BLOCKED","MISSION_FOUNDER_ATTENTION","MISSION_PREFLIGHT","RUN_AWAITING_APPROVAL","RUN_BLOCKED","RUN_DEGRADED"]);
export const SIGNAL_SOURCE=Object.freeze({MISSION_BLOCKED:"missions",MISSION_FOUNDER_ATTENTION:"missions",MISSION_PREFLIGHT:"missions",RUN_AWAITING_APPROVAL:"workRuns",RUN_BLOCKED:"workRuns",RUN_DEGRADED:"workRuns"});
/** Engelli sayılan koşu durumları (kayıttan AYNEN) ve bozulmuş (degraded) durum. */
export const BLOCKED_RUN_STATUSES=Object.freeze(["BLOCKED","QUARANTINED"]);
export const DEGRADED_RUN_STATUS="DEGRADED";
/** Son inceleme türleri (sunucu kararı AYNEN + ondan türeyen bağlam): yalnız CLEAN_AT_HEAD başarı rozetini hak eder (karar güncel head'e bağlı). */
export const REVIEW_KINDS=Object.freeze(["CLEAN_AT_HEAD","CLEAN_STALE","BLOCKED","NO_VALID_VERDICT","NONE"]);
/** Teslim özeti: NO_RUNS koşu yok demektir; hiçbiri ürün doğrulaması değildir (kaynak düzeyi). */
export const DELIVERY_BEST=Object.freeze(["NO_RUNS","NOT_PREPARED","ARTIFACT_PREPARED","SOURCE_ACCEPTED"]);
export const UNKNOWN_DETAILS=Object.freeze(["OFFLINE","UNAVAILABLE","ERROR"]);
export const MAX_MATRIX_ROWS=200;

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const ts=x=>{const t=Date.parse(x);return Number.isNaN(t)?0:t};
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const live=s=>s==="VERIFIED"||s==="STALE";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
/** Okunamayan kaynakların en kötüsü: OFFLINE > ERROR > UNAVAILABLE (birleşik dürüst durum). */
const worstState=states=>states.includes("OFFLINE")?"OFFLINE":states.includes("ERROR")?"ERROR":states.length?"UNAVAILABLE":null;
const cmp=(a,b)=>a<b?-1:a>b?1:0;

// ---------- Eşleyiciler ----------
function mapProjectRow(p){
  if(!isObj(p)||typeof p.projectId!=="string"||!PROJECT_ID_RE.test(p.projectId)||iso(p.createdAt)===null)return null;
  const name=text(p.name,200);if(name===null)return null;
  // environmentId isteğe bağlıdır; verilmişse geçerli metin olmalıdır (bozuk değer tahmin edilmez, okuma reddedilir).
  let environmentId=null;
  if(p.environmentId!==undefined&&p.environmentId!==null){environmentId=text(p.environmentId,100);if(environmentId===null)return null}
  return {projectId:p.projectId,name,environmentId,createdAt:p.createdAt};
}
/** GET /v1/projects -> {state:"VERIFIED",projects:{total,items}} | {state:"ERROR",projects:null}. Tek bozuk satır (ya da yinelenen kimlik) tüm okumayı ERROR yapar. Depo yolu gibi alanlar bilerek taşınmaz. */
export function mapMatrixProjects(raw){
  const bad={state:"ERROR",projects:null};
  if(!isObj(raw)||!Array.isArray(raw.projects))return bad;
  const items=[],seen=new Set();
  for(const p of raw.projects){
    const row=mapProjectRow(p);
    if(row===null||seen.has(row.projectId))return bad;
    seen.add(row.projectId);items.push(row);
  }
  return {state:"VERIFIED",projects:{total:items.length,items}};
}
/** Mission, koşu ve kokpit okumaları Yönetim Özeti ile AYNI katı sözleşmeyi kullanır (bozuk/çelişkili tek kayıt TÜM okumayı ERROR yapar). */
export function mapMatrixMissions(raw){return mapExecMissions(raw)}
export function mapMatrixWorkRuns(raw){return mapExecWorkRuns(raw)}
export function mapMatrixCockpit(raw){return mapExecCockpit(raw)}

// ---------- Proje başına özetler ----------
const tallyEntries=(items,pick)=>{
  const m=new Map();for(const x of items){const k=pick(x);m.set(k,(m.get(k)??0)+1)}
  return [...m.entries()].sort((a,b)=>b[1]-a[1]||cmp(a[0],b[0]));
};
const countOf=(entries,keys)=>entries.reduce((n,[k,v])=>keys.includes(k)?n+v:n,0);
function missionSummary(items){
  const by=tallyEntries(items,m=>m.status);
  return {total:items.length,byStatus:by,inProgress:items.filter(m=>IN_PROGRESS_MISSION_STATUSES.includes(m.status)).length,
    blocked:countOf(by,["BLOCKED"]),attention:countOf(by,["FOUNDER_ATTENTION_REQUIRED"]),preflight:countOf(by,["PREFLIGHT"]),complete:countOf(by,["COMPLETE"])};
}
function runSummary(items){
  const by=tallyEntries(items,r=>r.status);
  const ended=items.filter(r=>TERMINAL_RUN_STATUSES.includes(r.status)).length,awaiting=countOf(by,[AWAITING_RUN_STATUS]);
  return {total:items.length,byStatus:by,open:items.length-ended-awaiting,awaiting,ended,
    blocked:countOf(by,BLOCKED_RUN_STATUSES),degraded:countOf(by,[DEGRADED_RUN_STATUS]),failed:countOf(by,["FAILED","RECOVERY_FAILED"])};
}
const newestFirst=(a,b)=>ts(b.updatedAt)-ts(a.updatedAt)||ts(b.createdAt)-ts(a.createdAt)||cmp(b.runId,a.runId);
/** Son bağımsız inceleme: projenin en yeni etkinlikli koşularından İNCELEME kaydı olan ilki; karar AYNEN taşınır, geçerli karar yoksa verdict null (uydurma "temiz" yok), güncel head'e bağlı değilse CLEAN başarı sayılmaz. */
function reviewSummary(items){
  let reviewedRuns=0,hit=null;
  for(const r of [...items].sort(newestFirst))if(r.review!==null){reviewedRuns+=1;if(hit===null)hit=r}
  if(hit===null)return {reviewedRuns,latest:null,kind:"NONE"};
  const rv=hit.review;
  const kind=rv.verdict===null?"NO_VALID_VERDICT":rv.verdict==="BLOCKED"?"BLOCKED":rv.atHead?"CLEAN_AT_HEAD":"CLEAN_STALE";
  return {reviewedRuns,kind,latest:{runId:hit.runId,missionId:hit.missionId,verdict:rv.verdict,reviewer:rv.reviewer,cycle:rv.cycle,atHead:rv.atHead,updatedAt:hit.updatedAt}};
}
/** Teslim: koşuların kayıtlı teslim durumları; yalnız kaynak düzeyi. best = en ileri kayıtlı durum; ürün doğrulaması bu modülde yoktur. */
function deliverySummary(items){
  const counts={NOT_PREPARED:0,ARTIFACT_PREPARED:0,SOURCE_ACCEPTED:0};
  for(const r of items)counts[r.delivery.state]+=1;
  const best=items.length===0?"NO_RUNS":counts.SOURCE_ACCEPTED>0?"SOURCE_ACCEPTED":counts.ARTIFACT_PREPARED>0?"ARTIFACT_PREPARED":"NOT_PREPARED";
  return {best,counts,runs:items.length};
}
function signalsOf(m,r){
  const out=[];
  const add=(code,n)=>{if(n>0)out.push({code,n,source:SIGNAL_SOURCE[code]})};
  if(m){add("MISSION_BLOCKED",m.blocked);add("MISSION_FOUNDER_ATTENTION",m.attention);add("MISSION_PREFLIGHT",m.preflight)}
  if(r){add("RUN_AWAITING_APPROVAL",r.awaiting);add("RUN_BLOCKED",r.blocked);add("RUN_DEGRADED",r.degraded)}
  return out;
}
const latestOf=(a,b)=>a===null?b:b===null?a:ts(b)>ts(a)?b:a;

function buildRow(p,missionItems,runItems,sources){
  const mOk=missionItems!==null,rOk=runItems!==null;
  const m=mOk?missionSummary(missionItems):null,r=rOk?runSummary(runItems):null;
  const signals=signalsOf(m,r),score=signals.reduce((n,s)=>n+s.n,0);
  const unreadable=[...(mOk?[]:["missions"]),...(rOk?[]:["workRuns"])];
  const unknownState=worstState(unreadable.map(k=>sources[k].state));
  let status;
  if(signals.length)status="ATTENTION_NEEDED";
  else if(unreadable.length)status="UNKNOWN";
  else if(m.total===0&&r.total===0)status="NO_ACTIVITY";
  else if(r.open>0||m.inProgress>0)status="ACTIVE";
  else status="IDLE";
  let lastActivityAt=null;
  if(mOk)for(const x of missionItems)lastActivityAt=latestOf(lastActivityAt,x.createdAt);
  if(rOk)for(const x of runItems)lastActivityAt=latestOf(lastActivityAt,x.updatedAt);
  // Son mission (yeni oluşturulan önce) gezinme içindir; mission listesi okunamadıysa null (tahmin yok).
  const latestMission=mOk&&missionItems.length?[...missionItems].sort((a,b)=>ts(b.createdAt)-ts(a.createdAt)||cmp(b.missionId,a.missionId))[0]:null;
  return {
    projectId:p.projectId,name:p.name,environmentId:p.environmentId,createdAt:p.createdAt,
    missions:m,runs:r,
    // Birleşik sayılar yalnız İKİ kaynak da okunabiliyorsa verilir (aksi halde null: eksik toplam sayı gibi gösterilmez).
    blocked:m&&r?{total:m.blocked+r.blocked,missions:m.blocked,runs:r.blocked}:null,
    awaiting:m&&r?{total:m.attention+m.preflight+r.awaiting,missions:m.attention+m.preflight,runs:r.awaiting}:null,
    signals,score,partial:signals.length>0&&unreadable.length>0,
    status,unreadable,unknownState,
    review:r?reviewSummary(runItems):null,
    delivery:r?deliverySummary(runItems):null,
    lastActivityAt,latestMissionId:latestMission?latestMission.missionId:null};
}
/** Grup içi sıra: kayıtlı dikkat sinyali toplamı çok olan önce, sonra en yeni etkinlik, sonra ad, sonra kimlik (kararlı). */
const byRow=(a,b)=>b.score-a.score||ts(b.lastActivityAt)-ts(a.lastActivityAt)||cmp(a.name,b.name)||cmp(a.projectId,b.projectId);

// ---------- Portföy özeti (kokpit) ----------
const blk=(state,value,source,asOf=null,detail=null)=>({state,value:live(state)?value:null,source,asOf,detail:live(state)?detail:null});
function rollupOf(C,cockpitState,rows,attentionComplete,attentionState){
  const cp=`GET ${COCKPIT_PATH}`,down=()=>blk(failState(cockpitState),null,cp);
  const tiles={
    projects:C?blk(C.projects.state,C.projects.count,cp,C.generatedAt):down(),
    missions:C?blk(C.missions.state,C.missions.total,cp,C.generatedAt,{byStatus:C.missions.byStatus}):down(),
    awaiting:C?blk(C.awaiting.state,C.awaiting.count,cp,C.generatedAt):down(),
    workers:C?blk(C.workforce.state,C.workforce.activeWorkerRuns,cp,C.generatedAt):down(),
    evidence:C?blk(C.evidence.state,C.evidence.verified,cp,C.generatedAt,{total:C.evidence.total,mismatch:C.evidence.mismatch,missing:C.evidence.missing,unverifiable:C.evidence.unverifiable}):down(),
    // Dikkat gerektiren proje sayısı kokpitten değil satırlardan türer ve yalnız üç kaynak da okunduysa verilir (eksik sayı alt sınırdır, sayı gibi gösterilmez).
    attention:attentionComplete?blk("VERIFIED",rows.filter(r=>r.status==="ATTENTION_NEEDED").length,`GET ${PROJECTS_PATH} + GET ${MISSIONS_PATH} + GET ${WORK_RUNS_PATH}`):blk(attentionState,null,`GET ${PROJECTS_PATH} + GET ${MISSIONS_PATH} + GET ${WORK_RUNS_PATH}`)};
  return {state:C?"VERIFIED":failState(cockpitState),generatedAt:C?C.generatedAt:null,globalStop:C?{...C.globalStop}:null,tiles};
}

/**
 * Dört okuma sonucundan ({projects,missions,workRuns,cockpit}: mapMatrix* çıktıları) matrisi türetir.
 * Satırlar yalnız proje listesi okunabiliyorsa vardır; mission/koşu sayıları yalnız ilgili kaynak okunabiliyorsa vardır (aksi halde null). Bir kaynak yalnız eşleyici çıktısı eksiksizse kullanılır (VERIFIED ama gövdesi eksik okuma ERROR sayılır).
 */
export function buildMatrix(res){
  const usable={
    projects:ok(res.projects)&&Boolean(res.projects.projects),
    missions:ok(res.missions)&&Boolean(res.missions.missions),
    workRuns:ok(res.workRuns)&&Boolean(res.workRuns.runs),
    cockpit:ok(res.cockpit)&&Boolean(res.cockpit.cockpit)};
  const sources=Object.fromEntries(MATRIX_SOURCES.map(k=>[k,{state:usable[k]?"VERIFIED":ok(res[k])?"ERROR":failState(res[k]?.state)}]));
  const unreadable=MATRIX_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const incompleteState=worstState(unreadable.map(k=>sources[k].state));
  const P=usable.projects?res.projects.projects:null,M=usable.missions?res.missions.missions:null,R=usable.workRuns?res.workRuns.runs:null,C=usable.cockpit?res.cockpit.cockpit:null;

  const group=(items)=>{const by=new Map();for(const x of items){if(!by.has(x.projectId))by.set(x.projectId,[]);by.get(x.projectId).push(x)}return by};
  const mBy=M?group(M.items):null,rBy=R?group(R.items):null;
  const rows=P?P.items.map(p=>buildRow(p,mBy?mBy.get(p.projectId)??[]:null,rBy?rBy.get(p.projectId)??[]:null,sources)).sort((a,b)=>{
    const ga=MATRIX_STATUSES.indexOf(a.status),gb=MATRIX_STATUSES.indexOf(b.status);
    return ga-gb||byRow(a,b);
  }):[];
  const groups=MATRIX_STATUSES.map(status=>({status,items:rows.filter(r=>r.status===status)}));

  // Mission/koşu bir projeye bağlanamıyorsa (proje listesinde yok) satıra eklenmez ve gizlenmez: sayısı ayrıca bildirilir. Kaynak okunamadıysa null (0 değil).
  const known=P?new Set(P.items.map(p=>p.projectId)):null;
  const unlisted={missions:known&&M?M.items.filter(x=>!known.has(x.projectId)).length:null,runs:known&&R?R.items.filter(x=>!known.has(x.projectId)).length:null};

  // Çapraz denetim: kokpit toplamı VERIFIED iken proje/mission listeleriyle karşılaştırılır; uyuşmazlık düzeltilmez, iki değer de olduğu gibi gösterilir.
  const reconcile=[];
  if(C&&C.projects.state==="VERIFIED"&&P)reconcile.push({key:"projects",cockpit:C.projects.count,matrix:P.total});
  if(C&&C.missions.state==="VERIFIED"&&M)reconcile.push({key:"missions",cockpit:C.missions.total,matrix:M.total});
  if(C&&C.awaiting.state==="VERIFIED"&&M)reconcile.push({key:"awaiting",cockpit:C.awaiting.count,matrix:M.items.filter(x=>x.status==="PREFLIGHT"||x.status==="FOUNDER_ATTENTION_REQUIRED").length});
  for(const x of reconcile)x.agree=x.cockpit===x.matrix;

  const attentionSources=["projects","missions","workRuns"];
  const attentionComplete=attentionSources.every(k=>usable[k]);
  const attentionState=worstState(attentionSources.filter(k=>!usable[k]).map(k=>sources[k].state));
  return {sources,unreadable,incompleteState,complete:unreadable.length===0,projects:P?P.total:null,rows,groups,
    totals:{projects:P?P.total:null,byStatus:P?Object.fromEntries(MATRIX_STATUSES.map(s=>[s,groups.find(g=>g.status===s).items.length])):null},
    unlisted,reconcile,rollup:rollupOf(C,sources.cockpit.state,rows,attentionComplete,attentionState)};
}
