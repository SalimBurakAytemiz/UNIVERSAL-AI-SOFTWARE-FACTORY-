// //TR: Bu modül Derleme Zamanlayıcı (Build Scheduler) görünümünün saf (DOM'suz) çekirdeğidir (FA-V2-PRODUCT, UI-BUILD-SCHEDULER): yalnız salt-okunur ve zaten izinli GET /v1/scheduler (sorgusuz sabit yol) yanıtını güvenli, sınırlı alanlara eşler. Sunucunun `verification` değeri (VERIFIED/PENDING/REJECTED) AYNEN taşınır: yalnız VERIFIED ise faz satırları gösterilir; NOT_INITIALIZED/INVALID/REJECTED durumunda faz, sayı ya da ilerleme UYDURULMAZ. COMPLETED bir fazın kaydıdır, ürün doğrulaması ya da teslim değildir. Okunamayan ya da bozuk kaynağın sayıları 0 değil null'dır. Yeni uç nokta, yeniden deneme/engel kaldırma eylemi veya POST yoktur.
export const SCHEDULER_PATH="/v1/scheduler";
export const MAX_PHASES=2000;
export const PHASE_STATUSES=Object.freeze(["PENDING","ACTIVE","COMPLETED","RETRY_WAIT","RETRY_READY","BLOCKED"]);
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ENUM_RE=/^[A-Z][A-Z0-9_]{0,39}$/;
const RUN_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
// completedCommit: a git sha, or the literal baseline marker automation/lib/scheduler.mjs writes for phase 0 (markPhase0Complete: phase0Commit??"PHASE0_INSTALL_BASELINE").
const SHA_RE=/^(?:[0-9a-f]{7,64}|PHASE0_INSTALL_BASELINE)$/;
// evidenceRefs: repo-relative POSIX paths as the supervisor writes them (automation/factory-supervisor.mjs), e.g.
// ".ai/runtime/evidence-ledger/packages/<pkg>/<sha>.json" or ".ai/runtime/runs/<runId>/events.jsonl", plus plain ids ("evd_abc").
// A segment may start with a single "." (".ai"); "", "." and ".." segments, absolute paths, backslashes and ":" are rejected.
const REF_SEG_RE=/^\.?[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const REF_RE={test:v=>typeof v==="string"&&v.length>0&&v.length<=160&&v.split("/").every(seg=>REF_SEG_RE.test(seg)&&!seg.includes(".."))};
const ISO_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const iso=x=>typeof x==="string"&&ISO_RE.test(x)&&Number.isFinite(Date.parse(x))?x:null;
const failState=s=>s==="OFFLINE"||s==="UNAVAILABLE"?s:"ERROR";
const optional=(v,test)=>v===undefined||v===null?{ok:true,v:null}:test(v)?{ok:true,v}:{ok:false};
function mapPhase(x){
  if(!isObj(x)||!Number.isSafeInteger(x.phase)||x.phase<0||typeof x.status!=="string"||!ENUM_RE.test(x.status))return null;
  if(!Number.isSafeInteger(x.attempts)||x.attempts<0)return null;
  const run=optional(x.lastRunId,v=>typeof v==="string"&&RUN_RE.test(v)),sha=optional(x.completedCommit,v=>typeof v==="string"&&SHA_RE.test(v));
  if(!run.ok||!sha.ok)return null;
  let refs=[];
  if(x.evidenceRefs!==undefined&&x.evidenceRefs!==null){
    if(!Array.isArray(x.evidenceRefs)||x.evidenceRefs.length>50||!x.evidenceRefs.every(r=>typeof r==="string"&&REF_RE.test(r)))return null;
    refs=x.evidenceRefs.slice();
  }
  const retryAt=x.retryAt===undefined||x.retryAt===null?null:iso(x.retryAt);
  if(x.retryAt!==undefined&&x.retryAt!==null&&retryAt===null)return null;
  const failure=typeof x.lastFailure==="string"&&x.lastFailure.length?x.lastFailure.slice(0,300):null;
  return {phase:x.phase,status:x.status,attempts:x.attempts,lastRunId:run.v,completedCommit:sha.v,evidenceRefs:refs,retryAt,lastFailure:failure};
}
const tally=items=>{const m=new Map();for(const it of items)m.set(it.status,(m.get(it.status)??0)+1);return [...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([value,count])=>({value,count}))};
/**
 * GET /v1/scheduler yanıtı ->
 *  {state:"VERIFIED",scheduler:{verification:"VERIFIED",schemaVersion,updatedAt,phases,byStatus,activeCount,blockedCount,completed,total}}
 *  | {state:"PENDING",scheduler:{verification:"PENDING",status}}      (NOT_INITIALIZED/PENDING: sunucu henüz doğrulanmış durum üretmedi)
 *  | {state:"REJECTED",scheduler:null}                                 (sunucu durumu reddetti: INVALID/REJECTED)
 *  | {state:"ERROR",scheduler:null}                                    (bozuk ya da çelişkili yanıt).
 * Faz satırları yalnız verification==="VERIFIED" ise okunur; yinelenen faz, bozuk satır ya da MAX_PHASES aşımı TÜM okumayı ERROR yapar.
 */
export function mapScheduler(raw){
  const bad={state:"ERROR",scheduler:null};
  if(!isObj(raw)||typeof raw.verification!=="string")return bad;
  if(raw.verification==="REJECTED")return {state:"REJECTED",scheduler:null};
  if(raw.verification==="PENDING")return {state:"PENDING",scheduler:{verification:"PENDING",status:typeof raw.status==="string"&&ENUM_RE.test(raw.status)?raw.status:null}};
  if(raw.verification!=="VERIFIED"||!Array.isArray(raw.phases)||raw.phases.length>MAX_PHASES)return bad;
  const phases=[],seen=new Set();
  for(const x of raw.phases){const p=mapPhase(x);if(p===null||seen.has(p.phase))return bad;seen.add(p.phase);phases.push(p)}
  if(raw.active!==undefined&&!Array.isArray(raw.active))return bad;
  if(raw.blocked!==undefined&&!Array.isArray(raw.blocked))return bad;
  const updatedAt=raw.updatedAt===undefined||raw.updatedAt===null?null:iso(raw.updatedAt);
  if(raw.updatedAt!==undefined&&raw.updatedAt!==null&&updatedAt===null)return bad;
  const schemaVersion=typeof raw.schemaVersion==="string"&&raw.schemaVersion.length<=20?raw.schemaVersion:null;
  phases.sort((a,b)=>a.phase-b.phase);
  return {state:"VERIFIED",scheduler:{verification:"VERIFIED",schemaVersion,updatedAt,phases,byStatus:tally(phases),activeCount:(raw.active??[]).length,blockedCount:(raw.blocked??[]).length,completed:phases.filter(p=>p.status==="COMPLETED").length,total:phases.length}};
}
/** res = mapScheduler sonucu; okunamayan/doğrulanmamış kaynak için sayılar null'dır (0 değil). Hiçbir değer yükseltilmez. */
export function buildScheduler(res){
  const ok=Boolean(res)&&res.state==="VERIFIED"&&Boolean(res.scheduler);
  const state=ok?"VERIFIED":res&&(res.state==="PENDING"||res.state==="REJECTED")?res.state:failState(res?.state);
  const s=ok?res.scheduler:null;
  return {state,scheduler:s,pendingStatus:state==="PENDING"?res.scheduler?.status??null:null,total:s?s.total:null,completed:s?s.completed:null,activeCount:s?s.activeCount:null,blockedCount:s?s.blockedCount:null};
}
