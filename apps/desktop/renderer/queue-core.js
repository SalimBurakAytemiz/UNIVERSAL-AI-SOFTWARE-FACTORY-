// //TR: Bu modül İnsan Onayı Bekleyen İş Kuyruğu görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-211): yalnız üç salt-okunur ve zaten izinli GET (GET /v1/founder-attention, GET /v1/missions, GET /v1/work-runs) yanıtını güvenli, sınırlı alanlara eşler ve bunlardan kuyruk türetir. HİÇBİR veri uydurulmaz: kimlik/enum/biçim/zaman damgası bozuksa okuma KISMEN değil tümden ERROR olur (fail-closed), eksik alan tahmin edilmez, durumlar kayıttan AYNEN taşınır (yükseltme yok). Kuyruk öğesi YALNIZ kayıtlı bir duruma dayanır: FOUNDER_ATTENTION_REQUIRED ve PREFLIGHT mission'ları (kontrol düzleminin kokpitte "onay bekliyor" saydığı durumlar), AWAITING_APPROVAL koşuları ve Founder dikkati engelli paketleri. Öncelik kayıtlı bir alan DEĞİLDİR; yalnız öğe türünden türetilen, açıkça belgelenmiş bir sıralama düzeyidir. Bekleme süresi YALNIZ gerçek zaman damgasından (engel zamanı / koşu güncelleme / mission oluşturma) hesaplanır; kontrol düzleminde SLA hedefi kaydı YOKTUR, bu yüzden SLA değeri uydurulmaz ve bekleme bantları yalnız geçen sürenin görüntü gruplamasıdır (son tarih değildir). Bir kaynak okunamıyorsa toplam/öncelik sayıları gösterilmez (eksik kuyruk "boş" ya da sayılı gösterilmez). Ürün doğrulaması bu modülde hiçbir yerde üretilmez ve ilgili sabit değer bu dosyada hiç yer almaz.
import {MISSION_STATUSES,RISK_LEVELS,MISSION_ID_RE,PROJECT_ID_RE} from "./work-core.js";
import {RUN_STATUSES,RUN_STEPS,MISSIONS_PATH,WORK_RUNS_PATH,ATTENTION_PATH} from "./executive-core.js";

export {MISSIONS_PATH,WORK_RUNS_PATH,ATTENTION_PATH};
/** Görünümün okuyabildiği TÜM kaynaklar (sıra sabit); üçü de salt-okunur ve önceden izinlidir, yeni uç nokta yoktur. */
export const QUEUE_SOURCES=Object.freeze(["attention","missions","workRuns"]);
export const QUEUE_SOURCE_PATHS=Object.freeze({attention:ATTENTION_PATH,missions:MISSIONS_PATH,workRuns:WORK_RUNS_PATH});
/** Kuyruk öğesi türleri (sıra sabit). Her tür YALNIZ kayıtlı bir durumdan türetilir. */
export const QUEUE_KINDS=Object.freeze(["FOUNDER_ATTENTION","BLOCKED_PACKAGE","DELIVERY_DECISION","RUN_GATE","AUTHORIZATION"]);
/** Sıralama düzeyi (1 en önde): kayıtlı bir alan değil, türden türetilen belgelenmiş görüntü sırasıdır. 1 = iş engelli ve Founder'ı bekliyor, 2 = teslim/koşu kapısı kararı, 3 = başlatma yetkisi (PREFLIGHT). */
export const PRIORITY_OF_KIND=Object.freeze({FOUNDER_ATTENTION:1,BLOCKED_PACKAGE:1,DELIVERY_DECISION:2,RUN_GATE:2,AUTHORIZATION:3});
export const PRIORITIES=Object.freeze([1,2,3]);
/** Bekleme bantları: YALNIZ geçen sürenin görüntü gruplamasıdır (hedef/son tarih/SLA değildir). */
export const WAIT_BANDS=Object.freeze([
  Object.freeze({id:"UNDER_1H",below:3600000}),Object.freeze({id:"UNDER_1D",below:86400000}),Object.freeze({id:"UNDER_7D",below:604800000}),Object.freeze({id:"OVER_7D",below:Infinity})]);
export const WAIT_BAND_IDS=Object.freeze(WAIT_BANDS.map(b=>b.id));
/** Zaman damgasının dayanağı: bekleme süresi bu kayıtlı alandan başlar. */
export const WAIT_BASES=Object.freeze(["BLOCKED_AT","RUN_UPDATED","MISSION_CREATED"]);
export const AWAITING_RUN_STATUS="AWAITING_APPROVAL";
export const MAX_QUEUE_ROWS=200;

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const text=(x,max=300)=>typeof x==="string"&&x.length?x.slice(0,max):null;
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const matches=(re,x)=>typeof x==="string"&&re.test(x);
const RUN_RE=/^run_[0-9a-f]{24}$/,PKG_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/,KIND_RE=/^[A-Za-z][A-Za-z0-9_.-]{0,59}$/,VERIFICATION_RE=/^[A-Z][A-Z0-9_]{0,29}$/;
const RISK_RANK=Object.freeze({R0:0,R1:1,R2:2,R3:3,R4:4});

// ---------- GET /v1/missions ----------
function mapMissionRow(m){
  if(!isObj(m)||!matches(MISSION_ID_RE,m.missionId)||!matches(PROJECT_ID_RE,m.projectId)||!MISSION_STATUSES.includes(m.status)||!RISK_LEVELS.includes(m.riskLevel)||iso(m.createdAt)===null)return null;
  const title=text(m.title,200);if(title===null)return null;
  return {missionId:m.missionId,projectId:m.projectId,title,status:m.status,riskLevel:m.riskLevel,createdAt:m.createdAt};
}
/** GET /v1/missions -> {state:"VERIFIED",missions:{total,items}} | {state:"ERROR",missions:null}. Tek bozuk satır (ya da yinelenen kimlik) tüm okumayı ERROR yapar. */
export function mapQueueMissions(raw){
  const bad={state:"ERROR",missions:null};
  if(!isObj(raw)||!Array.isArray(raw.missions))return bad;
  const items=[],seen=new Set();
  for(const m of raw.missions){
    const row=mapMissionRow(m);
    if(row===null||seen.has(row.missionId))return bad;
    seen.add(row.missionId);items.push(row);
  }
  return {state:"VERIFIED",missions:{total:items.length,items}};
}

// ---------- GET /v1/work-runs ----------
function mapRunRow(r){
  if(!isObj(r)||!matches(RUN_RE,r.runId)||!matches(MISSION_ID_RE,r.missionId)||!matches(PROJECT_ID_RE,r.projectId)||!RUN_STATUSES.includes(r.status)||!RUN_STEPS.includes(r.step)||iso(r.createdAt)===null||iso(r.updatedAt)===null)return null;
  return {runId:r.runId,missionId:r.missionId,projectId:r.projectId,status:r.status,step:r.step,createdAt:r.createdAt,updatedAt:r.updatedAt};
}
/** GET /v1/work-runs -> {state:"VERIFIED",runs:{total,awaiting,items}} | {state:"ERROR",runs:null}. Tek bozuk koşu (ya da yinelenen kimlik) tüm okumayı ERROR yapar. */
export function mapQueueWorkRuns(raw){
  const bad={state:"ERROR",runs:null};
  if(!isObj(raw)||!Array.isArray(raw.runs))return bad;
  const items=[],seen=new Set();
  for(const r of raw.runs){
    const row=mapRunRow(r);
    if(row===null||seen.has(row.runId))return bad;
    seen.add(row.runId);items.push(row);
  }
  return {state:"VERIFIED",runs:{total:items.length,awaiting:items.filter(r=>r.status===AWAITING_RUN_STATUS).length,items}};
}

// ---------- GET /v1/founder-attention ----------
function mapBlockedRow(x){
  if(!isObj(x)||!matches(KIND_RE,x.kind))return null;
  const optional=(v,ok)=>v===undefined||v===null?null:ok(v)?v:undefined;
  const packageId=optional(x.packageId,v=>matches(PKG_RE,v));
  const phase=optional(x.phase,v=>(Number.isSafeInteger(v)&&v>=0)||matches(PKG_RE,v));
  const at=optional(x.at,v=>iso(v)!==null);
  const reason=optional(x.reason,v=>typeof v==="string");
  const retryable=optional(x.retryable,v=>typeof v==="boolean");
  // Kimliksiz öğe (ne paket ne faz) "neyin onay beklediğini" söyleyemez: tahmin edilmez, okuma reddedilir.
  if([packageId,phase,at,reason,retryable].includes(undefined)||(packageId===null&&phase===null))return null;
  return {packageId,phase,kind:x.kind,at,reason:reason===null?null:text(reason,1000),retryable};
}
/**
 * GET /v1/founder-attention -> {state:"VERIFIED",attention:{total,items,schedulerVerification}} | {state:"UNAVAILABLE"} (sunucu zamanlayıcı doğrulamasını REDDETTİYSE) | {state:"ERROR"}.
 * Tek bozuk öğe (geçersiz tür/kimlik/zaman/boolean ya da yinelenen paket+faz) tüm okumayı ERROR yapar.
 */
export function mapQueueAttention(raw){
  const bad={state:"ERROR",attention:null};
  if(!isObj(raw))return bad;
  if(raw.schedulerVerification==="REJECTED")return {state:"UNAVAILABLE",attention:null};
  if(!Array.isArray(raw.blocked))return bad;
  let verification=null;
  if(raw.schedulerVerification!==undefined&&raw.schedulerVerification!==null){if(!matches(VERIFICATION_RE,raw.schedulerVerification))return bad;verification=raw.schedulerVerification}
  const items=[],seen=new Set();
  for(const x of raw.blocked){
    const row=mapBlockedRow(x);if(row===null)return bad;
    const key=`${row.packageId??""}|${row.phase??""}`;
    if(seen.has(key))return bad;
    seen.add(key);items.push(row);
  }
  return {state:"VERIFIED",attention:{total:items.length,items,schedulerVerification:verification}};
}

// ---------- Bekleme süresi ----------
/** Geçen süreye karşılık gelen bant kimliği (yalnız görüntü gruplaması). */
export const bandOf=ms=>Number.isFinite(ms)&&ms>=0?WAIT_BANDS.find(b=>ms<b.below).id:null;
/** Gerçek zaman damgasından geçen süre; damga yok/geçersiz/gelecekte ise (saat kayması) null — süre uydurulmaz. */
export function waitSince(since,nowMs){
  if(typeof since!=="string"||!Number.isFinite(nowMs))return {waitMs:null,band:null};
  const t=Date.parse(since);
  if(Number.isNaN(t)||t>nowMs)return {waitMs:null,band:null};
  const waitMs=nowMs-t;return {waitMs,band:bandOf(waitMs)};
}
/** Süreyi tam sayı parçalara böler (gün/saat/dakika); görünüm bunları yerelleştirir. Negatif/geçersiz için null. */
export function waitParts(ms){
  if(!Number.isFinite(ms)||ms<0)return null;
  const mins=Math.floor(ms/60000);
  return {d:Math.floor(mins/1440),h:Math.floor((mins%1440)/60),m:mins%60,totalMinutes:mins};
}

// ---------- Kuyruk türetimi ----------
const ok=res=>Boolean(res)&&res.state==="VERIFIED";
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
function mk(over){
  return {key:"",kind:"",priority:0,title:null,missionId:null,projectId:null,riskLevel:null,missionStatus:null,missionKnown:false,runId:null,runStatus:null,step:null,
    packageId:null,phase:null,blockerKind:null,reason:null,retryable:null,since:null,basis:null,waitMs:null,band:null,...over};
}
const byQueueOrder=(a,b)=>{
  if(a.priority!==b.priority)return a.priority-b.priority;
  // Önce en uzun bekleyen; süresi bilinmeyenler öbür sona gider (uydurma süre yok).
  if(a.waitMs!==b.waitMs){if(a.waitMs===null)return 1;if(b.waitMs===null)return -1;return b.waitMs-a.waitMs}
  const ra=a.riskLevel===null?-1:RISK_RANK[a.riskLevel],rb=b.riskLevel===null?-1:RISK_RANK[b.riskLevel];
  if(ra!==rb)return rb-ra;
  return a.key<b.key?-1:a.key>b.key?1:0;
};
/**
 * Üç okuma sonucundan (mapQueue* çıktıları) kuyruğu türetir. Öğe türleri:
 * FOUNDER_ATTENTION (mission FOUNDER_ATTENTION_REQUIRED), AUTHORIZATION (mission PREFLIGHT), DELIVERY_DECISION (mission REPORTING + AWAITING_APPROVAL koşusu),
 * RUN_GATE (AWAITING_APPROVAL koşusu; mission REPORTING değil ya da mission listesinde yok), BLOCKED_PACKAGE (founder-attention engelli paket/faz).
 * Bir kaynak okunamıyorsa kuyruk EKSİKTİR (complete=false): o kaynağa bağlı öğeler listelenmez ve toplam/öncelik/bant sayıları null olur — eksik kuyruk ne "boş" ne de sayılı gösterilir.
 */
export function buildQueue({missions,runs,attention},nowMs){
  const m=ok(missions)&&missions.missions?missions.missions:null,r=ok(runs)&&runs.runs?runs.runs:null,a=ok(attention)&&attention.attention?attention.attention:null;
  const complete=m!==null&&r!==null&&a!==null;
  const sources={
    attention:{state:a?"VERIFIED":failState(attention?.state)},
    missions:{state:m?"VERIFIED":failState(missions?.state)},
    workRuns:{state:r?"VERIFIED":failState(runs?.state)}};
  const unreadable=QUEUE_SOURCES.filter(k=>sources[k].state!=="VERIFIED");
  const byId=new Map(m?m.items.map(x=>[x.missionId,x]):[]);
  const items=[];
  const push=over=>{const w=waitSince(over.since,nowMs);items.push(mk({...over,priority:PRIORITY_OF_KIND[over.kind],waitMs:w.waitMs,band:w.band}))};
  const fromMission=(kind,x)=>({kind,key:`mission:${x.missionId}`,title:x.title,missionId:x.missionId,projectId:x.projectId,riskLevel:x.riskLevel,missionStatus:x.status,missionKnown:true,since:x.createdAt,basis:"MISSION_CREATED"});
  if(m)for(const x of m.items){
    if(x.status==="FOUNDER_ATTENTION_REQUIRED")push(fromMission("FOUNDER_ATTENTION",x));
    else if(x.status==="PREFLIGHT")push(fromMission("AUTHORIZATION",x));
  }
  if(r)for(const x of r.items){
    if(x.status!==AWAITING_RUN_STATUS)continue;
    const ms=byId.get(x.missionId)??null;
    push({kind:ms&&ms.status==="REPORTING"?"DELIVERY_DECISION":"RUN_GATE",key:`run:${x.runId}`,title:ms?ms.title:null,missionId:x.missionId,projectId:x.projectId,riskLevel:ms?ms.riskLevel:null,
      missionStatus:ms?ms.status:null,missionKnown:ms!==null,runId:x.runId,runStatus:x.status,step:x.step,since:x.updatedAt,basis:"RUN_UPDATED"});
  }
  if(a)for(const x of a.items)push({kind:"BLOCKED_PACKAGE",key:`attention:${x.packageId??""}|${x.phase??""}`,packageId:x.packageId,phase:x.phase,blockerKind:x.kind,reason:x.reason,retryable:x.retryable,since:x.at,basis:x.at?"BLOCKED_AT":null});
  items.sort(byQueueOrder);
  const groups=PRIORITIES.map(p=>({priority:p,items:items.filter(i=>i.priority===p)}));
  // Sayılar yalnız kuyruk TAMAMSA verilir; aksi halde null (eksik kuyruğun toplamı bilinmez).
  const counts=complete?{
    total:items.length,
    byPriority:Object.fromEntries(PRIORITIES.map(p=>[p,groups[p-1].items.length])),
    byBand:{...Object.fromEntries(WAIT_BAND_IDS.map(id=>[id,items.filter(i=>i.band===id).length])),UNKNOWN:items.filter(i=>i.band===null).length},
    longestWaitMs:items.reduce((mx,i)=>i.waitMs!==null&&(mx===null||i.waitMs>mx)?i.waitMs:mx,null)
  }:null;
  const incompleteState=unreadable.some(k=>sources[k].state==="OFFLINE")?"OFFLINE":unreadable.some(k=>sources[k].state==="ERROR")?"ERROR":"UNAVAILABLE";
  return {complete,sources,unreadable,incompleteState:complete?null:incompleteState,items,groups,counts,schedulerVerification:a?a.schedulerVerification:null};
}
