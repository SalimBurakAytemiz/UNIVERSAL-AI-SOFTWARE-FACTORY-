// //TR: Bu modül Kurucu Yönetim Özeti ve İcra Defteri görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-236): yalnız dört salt-okunur GET (GET /v1/cockpit, GET /v1/missions, GET /v1/work-runs, GET /v1/attention; dördü de zaten izinlidir) yanıtını güvenli, sınırlı alanlara eşler. HİÇBİR veri uydurulmaz: kimlik/enum/biçim/sayı bozuksa okuma KISMEN değil tümden ERROR olur (fail-closed), eksik alan tahmin edilmez, durumlar kayıttan AYNEN taşınır (yükseltme yok). Teslim yalnız kaynak düzeyindedir; ürün doğrulaması bu modülde hiçbir yerde üretilmez ve ilgili sabit değer bu dosyada hiç yer almaz.
import {ATTENTION_PATH as ATTENTION_PATH_WORKOS,mapAttentionQueue} from "./attention-core.js";
import {MISSION_STATUSES,RISK_LEVELS,MISSION_ID_RE,PROJECT_ID_RE} from "./work-core.js";

export const COCKPIT_PATH="/v1/cockpit",MISSIONS_PATH="/v1/missions",WORK_RUNS_PATH="/v1/work-runs",ATTENTION_PATH=ATTENTION_PATH_WORKOS;
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); hepsi salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. */
export const EXECUTIVE_SOURCES=Object.freeze(["cockpit","missions","workRuns","attention"]);
export const EXECUTIVE_SOURCE_PATHS=Object.freeze({cockpit:COCKPIT_PATH,missions:MISSIONS_PATH,workRuns:WORK_RUNS_PATH,attention:ATTENTION_PATH});

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const int=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const ts=x=>{const t=Date.parse(x);return Number.isNaN(t)?0:t};
const RUN_RE=/^run_[0-9a-f]{24}$/,SHA_RE=/^[0-9a-f]{40}$/,HASH_RE=/^[0-9a-f]{64}$/,STATUS_KEY_RE=/^[A-Z][A-Z0-9_]{0,39}$/,KIND_RE=/^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;

/** GET /v1/cockpit blok durumları (sunucu sözleşmesi); bunun dışındaki her değer okumayı ERROR yapar. */
export const BLOCK_STATES=Object.freeze(["VERIFIED","STALE","UNAVAILABLE","ERROR"]);
const live=s=>s==="VERIFIED"||s==="STALE";
/** core/workos/run-state.ts içindeki RUN_STATUSES/RUN_STEPS kopyası; testler eşitliği doğrular. */
export const RUN_STATUSES=Object.freeze(["CREATED","QUEUED","LEASED","RUNNING","CHECKPOINTING","VERIFYING","SUCCEEDED","RETRY_SCHEDULED","DEGRADED","HANDOFF_PENDING","AWAITING_APPROVAL","BLOCKED","QUARANTINED","CANCELLING","CANCELLED","RECOVERING","RECOVERY_FAILED","FAILED"]);
export const RUN_STEPS=Object.freeze(["WORKSPACE","IMPLEMENT","VERIFY","SECURITY","REVIEW","REGRESSION","REPORT"]);
/** Artık yürütülmeyen (terminal) durumlar ve Founder kararı bekleyen durum; geri kalanı "açık" koşudur. */
export const TERMINAL_RUN_STATUSES=Object.freeze(["SUCCEEDED","BLOCKED","QUARANTINED","CANCELLED","RECOVERY_FAILED","FAILED"]);
export const AWAITING_RUN_STATUS="AWAITING_APPROVAL";
/** //TR: Durdurulmuş/başarısız koşu durumları (sunucu nedenini gösterir); readiness run kapısı FAIL kümesiyle aynıdır. */
export const RUN_STOPPED_STATUSES=Object.freeze(["FAILED","RECOVERY_FAILED","BLOCKED","QUARANTINED","CANCELLING","CANCELLED"]);
/** Yürütme hattında olan mission durumları (taslak/ön kontrol/engelli/Founder-dikkat/tamamlandı hariç). */
export const IN_PROGRESS_MISSION_STATUSES=Object.freeze(["AUTHORIZED","PLANNED","EXECUTING","VERIFYING","REVIEWING","REMEDIATING","REGRESSION","REPORTING"]);
export const REVIEW_VERDICTS=Object.freeze(["CLEAN","BLOCKED"]);
export const DELIVERY_STATES=Object.freeze(["NOT_PREPARED","ARTIFACT_PREPARED","SOURCE_ACCEPTED"]);
/** //TR: Koşu durumundan durum rozeti türü (renk tek başına anlam taşımaz; etiket ham durum kodudur). SUCCEEDED yalnız sunucunun kaydıdır, bu görünüm onu yeniden doğrulamaz. */
export const PILL_FOR_RUN_STATUS=Object.freeze({CREATED:"IDLE",QUEUED:"IDLE",HANDOFF_PENDING:"IDLE",LEASED:"ACTIVE",RUNNING:"ACTIVE",CHECKPOINTING:"ACTIVE",VERIFYING:"ACTIVE",RETRY_SCHEDULED:"ACTIVE",DEGRADED:"ATTENTION",RECOVERING:"RECOVERING",
  AWAITING_APPROVAL:"WAITING",SUCCEEDED:"DONE",BLOCKED:"BLOCKED",QUARANTINED:"BLOCKED",FAILED:"FAILED",RECOVERY_FAILED:"FAILED",CANCELLING:"STOPPED",CANCELLED:"STOPPED"});
export const MAX_LEDGER_ROWS=200;

// ---------- GET /v1/cockpit ----------
/** Sayaç alanı: canlı blokta geçerli tamsayı ŞARTTIR (yoksa okuma ERROR); canlı değilse sunucunun sayısı yok sayılır (null). */
const count=(isLive,v)=>isLive?int(v):null;
/** {durum:sayı} sözlüğü: canlıda her anahtar izinli ve her değer tamsayı olmalı; toplam, verilen toplamla eşit olmalı; aksi halde null (bozuk). */
function statusCounts(isLive,v,total,allowed){
  if(!isLive)return {};
  if(!isObj(v))return null;
  const out={};let sum=0;
  for(const [k,n] of Object.entries(v)){
    if(!STATUS_KEY_RE.test(k)||(allowed&&!allowed.includes(k))||int(n)===null)return null;
    out[k]=n;sum+=n;
  }
  return sum===total?out:null;
}
/**
 * GET /v1/cockpit -> {state:"VERIFIED",cockpit} | {state:"ERROR",cockpit:null}.
 * Sunucunun kendi blok durumları (UNAVAILABLE/ERROR) dürüst veridir ve sayısız taşınır; ama bilinmeyen durum, canlı blokta eksik/geçersiz sayı veya tutarsız toplam TÜM okumayı ERROR yapar.
 */
export function mapExecCockpit(raw){
  const bad={state:"ERROR",cockpit:null};
  if(!isObj(raw)||iso(raw.generatedAt)===null||!isObj(raw.globalStop)||typeof raw.globalStop.active!=="boolean")return bad;
  for(const k of ["projects","missions","awaitingApproval","orchestrator","workforce","evidence"])if(!isObj(raw[k])||!BLOCK_STATES.includes(raw[k].state))return bad;
  const gsReason=raw.globalStop.reason===undefined||raw.globalStop.reason===null?null:typeof raw.globalStop.reason==="string"?raw.globalStop.reason.slice(0,1000):undefined;
  if(gsReason===undefined)return bad;

  const pj=raw.projects,pjLive=live(pj.state),pjCount=count(pjLive,pj.count);
  if(pjLive&&pjCount===null)return bad;

  const ms=raw.missions,msLive=live(ms.state),msTotal=count(msLive,ms.total);
  if(msLive&&msTotal===null)return bad;
  const msBy=statusCounts(msLive,ms.byStatus,msTotal,MISSION_STATUSES);
  if(msBy===null)return bad;

  const aw=raw.awaitingApproval,awLive=live(aw.state);
  let awCount=null;
  if(awLive){
    if(!Array.isArray(aw.items))return bad;
    for(const x of aw.items)if(!isObj(x)||!MISSION_ID_RE.test(String(x.missionId)))return bad;
    awCount=aw.items.length;
  }

  const or=raw.orchestrator,orLive=live(or.state);
  const pk=isObj(or.packages)?or.packages:null;
  if(orLive&&!pk)return bad;
  const orTotal=count(orLive,pk?pk.total:null);
  if(orLive&&orTotal===null)return bad;
  const orBy=statusCounts(orLive,pk?pk.byStatus:null,orTotal,null);
  if(orBy===null)return bad;
  const orAsOf=or.asOf===null||or.asOf===undefined?null:iso(or.asOf);
  if(or.asOf!==null&&or.asOf!==undefined&&orAsOf===null)return bad;

  const wf=raw.workforce,wfLive=live(wf.state);
  // Kayıtlı rol sayısı yalnız kanonik alandan okunur (eski "registeredRoles" yalnız legacy referanstır ve burada kullanılmaz).
  const roles=wfLive&&wf.canonicalRegisteredRoles!==null&&wf.canonicalRegisteredRoles!==undefined?int(wf.canonicalRegisteredRoles):null;
  if(wfLive&&wf.canonicalRegisteredRoles!==null&&wf.canonicalRegisteredRoles!==undefined&&roles===null)return bad;
  const workers=count(wfLive,wf.activeWorkerRuns);
  if(wfLive&&workers===null)return bad;

  const ev=raw.evidence,evLive=live(ev.state);
  const evN=k=>count(evLive,ev[k]);
  const evidence={state:ev.state,total:evN("total"),verified:evN("verified"),mismatch:evN("mismatch"),missing:evN("missing"),unverifiable:evN("unverifiable")};
  if(evLive&&Object.entries(evidence).some(([k,v])=>k!=="state"&&v===null))return bad;

  return {state:"VERIFIED",cockpit:{
    generatedAt:raw.generatedAt,globalStop:{active:raw.globalStop.active,reason:gsReason},
    projects:{state:pj.state,count:pjCount},
    missions:{state:ms.state,total:msTotal,byStatus:msBy},
    awaiting:{state:aw.state,count:awCount},
    orchestrator:{state:or.state,asOf:orAsOf,total:orTotal,byStatus:orBy},
    workforce:{state:wf.state,registeredRoles:roles,activeWorkerRuns:workers},
    evidence}};
}

// ---------- GET /v1/missions ----------
function mapMissionRow(m){
  if(!isObj(m)||!MISSION_ID_RE.test(String(m.missionId))||!PROJECT_ID_RE.test(String(m.projectId))||!MISSION_STATUSES.includes(m.status)||!RISK_LEVELS.includes(m.riskLevel)||iso(m.createdAt)===null)return null;
  const title=text(m.title,200);if(title===null)return null;
  return {missionId:m.missionId,projectId:m.projectId,title,status:m.status,riskLevel:m.riskLevel,createdAt:m.createdAt};
}
/** GET /v1/missions -> {state:"VERIFIED",missions:{total,inProgress,byStatus,items}} | {state:"ERROR",missions:null}. Tek bozuk satır tüm okumayı ERROR yapar. */
export function mapExecMissions(raw){
  const bad={state:"ERROR",missions:null};
  if(!isObj(raw)||!Array.isArray(raw.missions))return bad;
  const items=[],seen=new Set(),byStatus={};
  for(const m of raw.missions){
    const row=mapMissionRow(m);
    if(row===null||seen.has(row.missionId))return bad;
    seen.add(row.missionId);items.push(row);byStatus[row.status]=(byStatus[row.status]??0)+1;
  }
  items.sort((a,b)=>ts(b.createdAt)-ts(a.createdAt)||b.missionId.localeCompare(a.missionId));
  return {state:"VERIFIED",missions:{total:items.length,inProgress:items.filter(m=>IN_PROGRESS_MISSION_STATUSES.includes(m.status)).length,byStatus,items}};
}

// ---------- GET /v1/work-runs ----------
function mapEvidenceRef(e){
  if(!isObj(e)||!KIND_RE.test(String(e.kind))||int(e.cycle)===null)return null;
  let commit=null;
  if(e.commitSha!==undefined&&e.commitSha!==null){if(!SHA_RE.test(String(e.commitSha)))return null;commit=e.commitSha}
  let verdict=null;
  if(e.verdict!==undefined&&e.verdict!==null){if(!REVIEW_VERDICTS.includes(e.verdict))return null;verdict=e.verdict}
  return {kind:e.kind,cycle:e.cycle,commitSha:commit,verdict,reviewer:text(e.reviewerIdentity,120),at:iso(e.endedAt)};
}
/** Üretilen kaynak sürümleri: yalnız IMPLEMENT kanıtının kayıtlı commit'i; (cycle,commit) tekrarı tek sayılır, cycle sırasındadır. */
function sourceVersions(evidence){
  const out=[],seen=new Set();
  for(const e of evidence)if(e.kind==="IMPLEMENT"&&e.commitSha!==null){const k=`${e.cycle}:${e.commitSha}`;if(!seen.has(k)){seen.add(k);out.push({cycle:e.cycle,commitSha:e.commitSha,at:e.at})}}
  return out.sort((a,b)=>a.cycle-b.cycle).slice(0,50);
}
/** Bağımsız inceleme: EN SON REVIEW kanıtı (en yüksek cycle, eşitlikte dizideki son). Geçerli karar yoksa verdict null (uydurma "temiz" yok). atHead: karar, koşunun güncel head commit'ine mi ait. */
function reviewOf(evidence,headSha){
  let best=null;
  for(const e of evidence)if(e.kind==="REVIEW"&&(best===null||e.cycle>=best.cycle))best=e;
  if(best===null)return null;
  return {verdict:best.verdict,reviewer:best.reviewer,cycle:best.cycle,commitSha:best.commitSha,atHead:best.commitSha!==null&&headSha!==null&&best.commitSha===headSha};
}
function deliveryOf(r){
  let artifact=null,accepted=null;
  if(r.deliveryArtifact!==undefined&&r.deliveryArtifact!==null){
    const a=r.deliveryArtifact;
    if(!isObj(a)||a.runId!==r.runId||a.missionId!==r.missionId||!SHA_RE.test(String(a.sourceCommit))||!SHA_RE.test(String(a.treeSha))||!HASH_RE.test(String(a.exportArtifactHash)))return null;
    artifact={sourceCommit:a.sourceCommit,treeSha:a.treeSha,exportArtifactHash:a.exportArtifactHash};
  }
  if(r.sourceDelivery!==undefined&&r.sourceDelivery!==null){
    const s=r.sourceDelivery;
    if(!isObj(s)||s.runId!==r.runId||s.missionId!==r.missionId||!SHA_RE.test(String(s.sourceCommit))||!HASH_RE.test(String(s.exportArtifactHash))||iso(s.acceptedAt)===null)return null;
    accepted={sourceCommit:s.sourceCommit,exportArtifactHash:s.exportArtifactHash,acceptedAt:s.acceptedAt};
  }
  return {state:accepted?"SOURCE_ACCEPTED":artifact?"ARTIFACT_PREPARED":"NOT_PREPARED",artifact,accepted};
}
function mapRunRow(r){
  if(!isObj(r)||!RUN_RE.test(String(r.runId))||!MISSION_ID_RE.test(String(r.missionId))||!PROJECT_ID_RE.test(String(r.projectId))||!RUN_STATUSES.includes(r.status)||!RUN_STEPS.includes(r.step)||iso(r.createdAt)===null||iso(r.updatedAt)===null||!Array.isArray(r.evidence))return null;
  if(int(r.remediationCycle)===null)return null;
  for(const k of ["baseSha","headSha"])if(r[k]!==null&&r[k]!==undefined&&!SHA_RE.test(String(r[k])))return null;
  const baseSha=r.baseSha??null,headSha=r.headSha??null;
  const ev=r.evidence.map(mapEvidenceRef);if(ev.some(e=>e===null))return null;
  const delivery=deliveryOf(r);if(delivery===null)return null;
  if(r.reason!==undefined&&r.reason!==null&&typeof r.reason!=="string")return null;
  // Tamamlanma kaydı yalnız SUCCEEDED koşuda bulunabilir (sunucu değişmezi); aksi halde kayıt bozuk sayılır. İçeriği burada yorumlanmaz, yalnız varlığı taşınır.
  let completionRecorded=false;
  if(r.completion!==undefined&&r.completion!==null){
    if(!isObj(r.completion)||!SHA_RE.test(String(r.completion.headSha))||!isObj(r.completion.productVerification)||r.status!=="SUCCEEDED")return null;
    completionRecorded=true;
  }
  return {runId:r.runId,missionId:r.missionId,projectId:r.projectId,status:r.status,step:r.step,cycle:r.remediationCycle,createdAt:r.createdAt,updatedAt:r.updatedAt,baseSha,headSha,
    versions:sourceVersions(ev),review:reviewOf(ev,headSha),delivery,completionRecorded,reason:text(r.reason)};
}
/** GET /v1/work-runs -> {state:"VERIFIED",runs:{items(newest activity first),total,open,awaiting,ended,prepared,accepted}} | {state:"ERROR",runs:null}. Tek bozuk koşu tüm okumayı ERROR yapar. */
export function mapExecWorkRuns(raw){
  const bad={state:"ERROR",runs:null};
  if(!isObj(raw)||!Array.isArray(raw.runs))return bad;
  const items=[],seen=new Set();
  for(const r of raw.runs){
    const row=mapRunRow(r);
    if(row===null||seen.has(row.runId))return bad;
    seen.add(row.runId);items.push(row);
  }
  // Yeni etkinlik önce: updatedAt, eşitlikte createdAt, sonra kimlik (kararlı).
  items.sort((a,b)=>ts(b.updatedAt)-ts(a.updatedAt)||ts(b.createdAt)-ts(a.createdAt)||b.runId.localeCompare(a.runId));
  const ended=items.filter(r=>TERMINAL_RUN_STATUSES.includes(r.status)).length,awaiting=items.filter(r=>r.status===AWAITING_RUN_STATUS).length;
  return {state:"VERIFIED",runs:{items,total:items.length,open:items.length-ended-awaiting,awaiting,ended,
    prepared:items.filter(r=>r.delivery.state==="ARTIFACT_PREPARED").length,accepted:items.filter(r=>r.delivery.state==="SOURCE_ACCEPTED").length}};
}

// ---------- GET /v1/attention ----------
/** GET /v1/attention -> {state:"VERIFIED",attention:{total,counts,truncated,dropped}} | {state:"ERROR"}; toplam sunucunun doğrulanmış sayaçlarının toplamıdır (liste kesilse bile). Emekli scheduler kaynağı (/v1/founder-attention) ve onun retry/checkpoint olguları artık yoktur. */
export function mapExecAttention(raw){
  const m=mapAttentionQueue(raw);
  return m.state==="VERIFIED"?{state:"VERIFIED",attention:{total:m.queue.total,counts:m.queue.counts,truncated:m.queue.truncated,dropped:m.queue.dropped}}:{state:"ERROR",attention:null};
}

// ---------- Özet (KPI) türetimi ----------
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const blk=(state,value,source,asOf=null,detail=null)=>({state,value:live(state)?value:null,source,asOf,detail});
const isOk=res=>Boolean(res)&&res.state==="VERIFIED";
/**
 * Dört okuma sonucundan başlık göstergeleri üretir. Okunamayan kaynağın göstergesi 0 DEĞİL, o kaynağın dürüst durumudur (OFFLINE/UNAVAILABLE/ERROR) ve değeri null'dır;
 * kokpit alt bloğu UNAVAILABLE/ERROR ise o gösterge de aynı durumu taşır. Hiçbir şirket/gelir/müşteri/uptime metriği yoktur.
 */
export function executiveSummary({cockpit,missions,runs,attention}){
  const cp=`GET ${COCKPIT_PATH}`,mp=`GET ${MISSIONS_PATH}`,rp=`GET ${WORK_RUNS_PATH}`,ap=`GET ${ATTENTION_PATH}`;
  const fromCockpit=(pick)=>{
    if(!isOk(cockpit)||!cockpit.cockpit)return blk(failState(cockpit?.state),null,cp);
    const p=pick(cockpit.cockpit);return blk(p.state,p.value,cp,cockpit.cockpit.generatedAt,p.detail??null);
  };
  const c=isOk(cockpit)?cockpit.cockpit:null;
  const kpis={
    projects:fromCockpit(x=>({state:x.projects.state,value:x.projects.count})),
    missions:fromCockpit(x=>({state:x.missions.state,value:x.missions.total,detail:{byStatus:x.missions.byStatus}})),
    approvals:fromCockpit(x=>({state:x.awaiting.state,value:x.awaiting.count})),
    evidence:fromCockpit(x=>({state:x.evidence.state,value:x.evidence.verified,detail:{total:x.evidence.total,mismatch:x.evidence.mismatch,missing:x.evidence.missing,unverifiable:x.evidence.unverifiable}})),
    inProgress:isOk(missions)&&missions.missions?blk("VERIFIED",missions.missions.inProgress,mp,null,{total:missions.missions.total}):blk(failState(missions?.state),null,mp),
    runs:isOk(runs)&&runs.runs?blk("VERIFIED",runs.runs.total,rp,null,{open:runs.runs.open,awaiting:runs.runs.awaiting,ended:runs.runs.ended}):blk(failState(runs?.state),null,rp),
    deliveries:isOk(runs)&&runs.runs?blk("VERIFIED",runs.runs.accepted,rp,null,{prepared:runs.runs.prepared,accepted:runs.runs.accepted}):blk(failState(runs?.state),null,rp),
    attention:isOk(attention)&&attention.attention?blk("VERIFIED",attention.attention.total,ap,null,{truncated:attention.attention.truncated,dropped:attention.attention.dropped}):blk(failState(attention?.state),null,ap)
  };
  const platform={
    globalStop:c?{...c.globalStop}:null,
    orchestrator:c?{...c.orchestrator}:null,
    workforce:c?{...c.workforce}:null,
    failState:c?null:failState(cockpit?.state)
  };
  return {kpis,platform};
}
export const shortSha=s=>typeof s==="string"&&s?s.slice(0,12):null;
