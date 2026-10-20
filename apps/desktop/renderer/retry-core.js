// //TR: Bu modül SUPERVISOR_RETRY.json kaydının (GET /v1/retry ve GET /v1/founder-attention içindeki retry) saf, DOM'suz doğrulama ve evre sınıflama çekirdeğidir (UI-194): Operasyon ve Control Tower AYNI işlevleri kullanır, ikinci bir türetim yoktur. Ağ, depolama ve DOM yoktur; geçersiz kayıt null döner (fail-closed), kalan/geçen süre yalnız retryAt ile verilen şimdi arasındaki farktan gelir.
export const RETRY_OVERDUE_AFTER_MS=10*60000;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const matches=(re,x)=>typeof x==="string"&&re.test(x);
const iso=x=>typeof x==="string"&&x.length>0&&!Number.isNaN(new Date(x).getTime())?x:null;
const PKG_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const opt=(v,ok)=>v===undefined||v===null?null:ok(v)?v:undefined;
const optText=(v,max)=>{const r=opt(v,x=>typeof x==="string");return r===null||r===undefined?r:r.length?r.slice(0,max):null};
const optIso=v=>opt(v,x=>iso(x)!==null);
/** UI-194: yeniden deneme kaydının (SUPERVISOR_RETRY.json) doğrulaması; Operasyon ve Control Tower AYNI işlevi kullanır. Geçersizse null. */
export function validateRetryRecord(r){
  if(!isObj(r)||iso(r.retryAt)===null)return null;
  const pk=opt(r.packageId,v=>matches(PKG_RE,v)),reason=optText(r.reason,300),secs=opt(r.retryAfterSeconds,v=>Number.isSafeInteger(v)&&v>=0),upd=optIso(r.updatedAt);
  const phases=opt(r.phaseIds,v=>Array.isArray(v)&&v.length<=200&&v.every(n=>Number.isSafeInteger(n)&&n>=0));
  if([pk,reason,secs,upd,phases].includes(undefined))return null;
  return {packageId:pk,phaseIds:phases??[],reason,retryAfterSeconds:secs,retryAt:r.retryAt,updatedAt:upd};
}
/** UI-194: doğrulanmış kayıt için WAITING/DUE/OVERDUE/UNDETERMINED sınıflaması; kalan/geçen süre yalnız retryAt ile nowMs farkından gelir. */
export function classifyRetryPhase(retry,nowMs){
  const t=Date.parse(retry.retryAt),finite=Number.isFinite(nowMs)&&!Number.isNaN(t);
  const phase=!finite?"UNDETERMINED":t>nowMs?"WAITING":nowMs-t<=RETRY_OVERDUE_AFTER_MS?"DUE":"OVERDUE";
  return {...retry,phase,remainingMs:finite&&t>nowMs?t-nowMs:null,overdueMs:finite&&t<=nowMs?nowMs-t:null};
}
