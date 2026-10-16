// //TR: Bu modül Proje Yolculuğu görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT): salt-okunur GET /v1/predev/:missionId ve GET /v1/crew/:missionId okuma-modellerini güvenli, sınırlı alanlara eşler. HİÇBİR veri uydurulmaz: kimlik/enum/biçim bozuksa okuma KISMEN değil tümden ERROR olur (fail-closed), eksik alan tahmin edilmez; durumlar kayıttan AYNEN taşınır (yükseltme yok). PRODUCT_VERIFIED hiçbir yerde üretilmez; teslim yalnız kaynak düzeyindedir.
export const MISSION_ID_RE=/^msn_[0-9a-f]{24}$/;
export const predevPath=id=>MISSION_ID_RE.test(String(id))?`/v1/predev/${id}`:null;
export const crewPath=id=>MISSION_ID_RE.test(String(id))?`/v1/crew/${id}`:null;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const int=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const iso=x=>typeof x==="string"&&!Number.isNaN(new Date(x).getTime())?x:null;
const ROLE_RE=/^UASCO-\d{4}$/,SHA_RE=/^[0-9a-f]{7,64}$/,RUN_RE=/^[A-Za-z0-9_-]{6,64}$/,HASH_RE=/^[0-9a-f]{64}$/;

/** Pre-dev artefakt türleri, zincirdeki sabit sırayla (BusinessAnalysis -> Requirements -> Plan -> Architecture -> UxSpec). */
export const PREDEV_KINDS=Object.freeze(["BusinessAnalysis","Requirements","Plan","Architecture","UxSpec"]);
export const PREDEV_PHASES=Object.freeze(["AUTHORIZED","BUSINESS_ANALYSIS","REQUIREMENTS","PLANNING","ARCHITECTURE","UX_DESIGN","PRE_DEV_COMPLETE"]);
/** Fazın "şu an üzerinde çalışılan" artefakt türü; AUTHORIZED/PRE_DEV_COMPLETE bir artefakta eşlenmez. */
export const PHASE_KIND=Object.freeze({BUSINESS_ANALYSIS:"BusinessAnalysis",REQUIREMENTS:"Requirements",PLANNING:"Plan",ARCHITECTURE:"Architecture",UX_DESIGN:"UxSpec"});
export const ARTIFACT_STATES=Object.freeze(["NOT_STARTED","DRAFT","SUBMITTED","APPROVED","REJECTED"]);
export const ASSIGNMENT_STATES=Object.freeze(["ASSIGNED","IN_PROGRESS","SUBMITTED","APPROVED","REWORK_REQUESTED"]);
export const LEDGER_EVENT_TYPES=Object.freeze(["RECORDED","SUBMITTED","APPROVED","REWORK_REQUESTED"]);
export const REVIEW_VERDICTS=Object.freeze(["REVIEW_CLEAN","REWORK_REQUESTED","NONE"]);
export const FINAL_VERDICTS=Object.freeze([...REVIEW_VERDICTS,"REVIEW_REWORK_LIMIT_EXCEEDED"]);

/** //TR: Artefakt/atama durumundan durum rozeti türü (renk tek başına anlam taşımaz; etiket ham durum kodudur). REJECTED başarısızlık değil rework talebidir (ATTENTION). */
export const PILL_FOR_STATE=Object.freeze({NOT_STARTED:"NOT_EXECUTED",ASSIGNED:"NOT_EXECUTED",DRAFT:"ACTIVE",IN_PROGRESS:"ACTIVE",SUBMITTED:"WAITING",APPROVED:"DONE",REJECTED:"ATTENTION",REWORK_REQUESTED:"ATTENTION"});

const roleOrNull=x=>ROLE_RE.test(String(x))?x:null;
/** GET /v1/predev/:missionId -> {state:"VERIFIED",predev} | {state:"ERROR",predev:null}. Beş artefakt türünün hepsi geçerli durumla gelmelidir; aksi halde kısmi görünüm yerine ERROR. */
export function mapPredev(raw){
  const bad={state:"ERROR",predev:null};
  const p=isObj(raw)?raw.predev:null;
  if(!isObj(p)||!MISSION_ID_RE.test(String(p.missionId))||typeof p.active!=="boolean")return bad;
  const phase=p.phase==="NOT_STARTED"||PREDEV_PHASES.includes(p.phase)?p.phase:null;
  if(phase===null||!isObj(p.artifacts))return bad;
  const artifacts=[];
  for(const kind of PREDEV_KINDS){
    const a=p.artifacts[kind];
    if(!isObj(a)||!ARTIFACT_STATES.includes(a.state))return bad;
    artifacts.push({
      kind,state:a.state,artifactId:text(a.artifactId,80),version:int(a.version),authorRoleId:roleOrNull(a.authorRoleId),
      // Onay yalnız kayıtlı durumdan türetilir; sunucunun ayrı "approved" bayrağına güvenilmez.
      approved:a.state==="APPROVED",
      evidenceCount:Array.isArray(a.evidenceRefs)?Math.min(a.evidenceRefs.length,500):0,
      mappedRoleIds:Array.isArray(a.mappedRoleIds)?a.mappedRoleIds.filter(r=>ROLE_RE.test(String(r))).slice(0,12):[]
    });
  }
  return {state:"VERIFIED",predev:{missionId:p.missionId,active:p.active,phase,preDevId:text(p.preDevId,80),artifacts}};
}

function mapEvent(e){
  if(!isObj(e)||!LEDGER_EVENT_TYPES.includes(e.type)||!PREDEV_KINDS.includes(e.kind)||!ROLE_RE.test(String(e.roleId))||int(e.version)===null)return null;
  return {type:e.type,kind:e.kind,roleId:e.roleId,version:e.version,at:iso(e.at),actor:text(e.actor,120),reason:e.type==="REWORK_REQUESTED"?text(e.reason,300):null,evidenceCount:Array.isArray(e.evidenceRefs)?Math.min(e.evidenceRefs.length,500):0};
}
function mapExpert(x){
  if(!isObj(x)||!ROLE_RE.test(String(x.roleId))||!PREDEV_KINDS.includes(x.kind)||!ASSIGNMENT_STATES.includes(x.assignmentState)||int(x.reworkCount)===null||int(x.currentVersion)===null||!Array.isArray(x.events))return null;
  const events=x.events.map(mapEvent);if(events.some(e=>e===null))return null;
  return {roleId:x.roleId,kind:x.kind,phase:PREDEV_PHASES.includes(x.phase)?x.phase:null,assignmentState:x.assignmentState,reworkCount:x.reworkCount,currentVersion:x.currentVersion,events};
}
function mapVersion(v){
  if(!isObj(v)||int(v.cycle)===null||!REVIEW_VERDICTS.includes(v.reviewVerdict))return null;
  const sc=v.sourceCommit===null||v.sourceCommit===undefined?null:(SHA_RE.test(String(v.sourceCommit))?v.sourceCommit:undefined);
  if(sc===undefined)return null;
  return {cycle:v.cycle,sourceCommit:sc,developerRoleId:roleOrNull(v.developerRoleId),reviewerRoleId:roleOrNull(v.reviewerRoleId),reviewVerdict:v.reviewVerdict,reviewReason:text(v.reviewReason,300)};
}
function mapRun(r){
  if(!isObj(r)||!RUN_RE.test(String(r.runId))||!FINAL_VERDICTS.includes(r.finalVerdict)||!Array.isArray(r.versions))return null;
  const versions=r.versions.map(mapVersion);if(versions.some(v=>v===null))return null;
  let delivery=null;
  if(r.delivery!==null&&r.delivery!==undefined){
    const d=r.delivery;
    if(!isObj(d)||!SHA_RE.test(String(d.sourceCommit))||!SHA_RE.test(String(d.treeSha))||!HASH_RE.test(String(d.exportArtifactHash)))return null;
    delivery={sourceCommit:d.sourceCommit,treeSha:d.treeSha,exportArtifactHash:d.exportArtifactHash};
  }
  return {runId:r.runId,developerRoleId:roleOrNull(r.developerRoleId),reviewerRoleId:roleOrNull(r.reviewerRoleId),versions:versions.sort((a,b)=>a.cycle-b.cycle),finalVerdict:r.finalVerdict,delivery};
}
/** GET /v1/crew/:missionId -> {state:"VERIFIED",crew:{missionId,preDevId,experts,events,runs}} | {state:"ERROR",crew:null}. Tek bir bozuk uzman/olay/koşu tüm okumayı ERROR yapar (kısmi görünüm yok). */
export function mapCrew(raw){
  const bad={state:"ERROR",crew:null};
  const c=isObj(raw)?raw.crew:null;
  if(!isObj(c)||!MISSION_ID_RE.test(String(c.missionId))||!isObj(c.coordination)||!Array.isArray(c.coordination.experts)||!Array.isArray(c.devReview))return bad;
  const experts=c.coordination.experts.slice(0,50).map(mapExpert);if(experts.some(e=>e===null))return bad;
  const runs=c.devReview.slice(0,50).map(mapRun);if(runs.some(r=>r===null))return bad;
  // Düz olay listesi sunucunun sırasıyla (kayıt zamanı, sürüm, tür) KORUNUR.
  const flat=Array.isArray(c.coordination.events)?c.coordination.events.slice(0,500).map(mapEvent):[];if(flat.some(e=>e===null))return bad;
  return {state:"VERIFIED",crew:{missionId:c.missionId,preDevId:text(c.preDevId,80),experts,events:flat,runs}};
}
/** //TR: Zincirin aşağı akış (geliştirme -> inceleme -> teslim) düğümleri YALNIZ listelenen son koşunun gerçek kaydından türetilir; koşu yoksa null (düğümler NOT_STARTED). Teslim varsa yalnız "kaynak teslimi hazır" denir, ürün doğrulandı ASLA denmez. */
export function downstreamOf(runs){
  const run=Array.isArray(runs)&&runs.length?runs[runs.length-1]:null;
  if(!run)return null;
  return {runId:run.runId,developed:run.versions.some(v=>v.sourceCommit!==null),finalVerdict:run.finalVerdict,sourceDelivered:run.delivery!==null,runCount:runs.length};
}
