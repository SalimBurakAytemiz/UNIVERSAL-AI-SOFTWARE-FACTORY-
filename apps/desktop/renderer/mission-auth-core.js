// //TR: Bu modül görev başı kapsamlı yetkilendirme formunun saf (DOM'suz) çekirdeğidir (DSK-T0008, Founder kararı Q4): Founder bir mission başlarken kapsamı (mission, izin verilen en yüksek risk), sınırları (en çok koşu, en çok eşzamanlı koşu) ve bitiş zamanını belirler. Bu modül doğrular, önizleme ve sunucuya gidecek tam isteği üretir; yerelde hiçbir yetki kaydı tutmaz. Kayıt sunucuda (P-B) journal'a yazılır ve runner tarafından uygulanır; gönderim yalnız geçerli önizlemeden ve onaydan sonra yapılır. Sınırlar Founder politikasını aşamaz (20 koşu, 2 eşzamanlı, en çok 7 gün); kapsam genişletme, harcama ve riskli eylemler bu formla verilemez, ayrı onay ister.
import {MISSION_ID_RE,RISK_LEVELS} from "./work-core.js";
import {USAGE_POLICY} from "./usage-core.js";

export const AUTH_LIMITS=Object.freeze({maxRuns:USAGE_POLICY.runsPerDay,maxConcurrent:USAGE_POLICY.concurrentRealRuns,maxDays:7});
/** Sunucu kaydı yokken gönderim durumu; P-B gelene kadar sabit. */
export const AUTH_SUBMIT="READY";
/** DSK-T0008 P-B: the exact request the server accepts (exactly maxRisk, maxRuns, expiresAt; concurrency is fixed by policy). Only from a valid preview. */
export const buildAuthorizationRequest=v=>v&&v.ok&&v.preview?{path:`/v1/missions/${v.preview.missionId}/authorization`,body:{maxRisk:v.preview.maxRisk,maxRuns:v.preview.maxRuns,expiresAt:v.preview.expiresAt}}:null;
const DAY_MS=86400000;
const int=x=>typeof x==="string"&&/^[0-9]{1,4}$/.test(x.trim())?Number(x.trim()):(Number.isSafeInteger(x)?x:null);

/**
 * input: {missionId, maxRisk, maxRuns, maxConcurrent, expiresAt} (form değerleri, metin olabilir); mission: {missionId, riskLevel} | null; now: Date.
 * -> {ok, errors:[{field,code}], preview|null, submit:"RECORDING_UNAVAILABLE"}. Hata kodları sabittir; önizleme yalnız tüm alanlar geçerliyken üretilir.
 */
export function validateMissionAuthorization(input,mission,now=new Date()){
  const errors=[],err=(field,code)=>errors.push({field,code}),x=input&&typeof input==="object"?input:{};
  const missionId=typeof x.missionId==="string"&&MISSION_ID_RE.test(x.missionId)?x.missionId:null;
  if(!missionId)err("missionId","INVALID_MISSION");
  else if(!mission||mission.missionId!==missionId)err("missionId","MISSION_NOT_SELECTED");
  const mRisk=mission&&RISK_LEVELS.includes(mission.riskLevel)?mission.riskLevel:null;
  const maxRisk=RISK_LEVELS.includes(x.maxRisk)?x.maxRisk:null;
  if(!maxRisk)err("maxRisk","INVALID_RISK");
  else if(mRisk===null)err("maxRisk","MISSION_RISK_UNKNOWN");
  else if(RISK_LEVELS.indexOf(maxRisk)>RISK_LEVELS.indexOf(mRisk))err("maxRisk","ABOVE_MISSION_RISK");
  const maxRuns=int(x.maxRuns),maxConcurrent=int(x.maxConcurrent);
  if(maxRuns===null||maxRuns<1)err("maxRuns","INVALID_NUMBER");else if(maxRuns>AUTH_LIMITS.maxRuns)err("maxRuns","ABOVE_POLICY");
  if(maxConcurrent===null||maxConcurrent<1)err("maxConcurrent","INVALID_NUMBER");else if(maxConcurrent>AUTH_LIMITS.maxConcurrent)err("maxConcurrent","ABOVE_POLICY");
  const exp=typeof x.expiresAt==="string"&&/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(x.expiresAt)?new Date(x.expiresAt):null;
  if(!exp||Number.isNaN(exp.getTime()))err("expiresAt","INVALID_DATE");
  else if(exp.getTime()<=now.getTime())err("expiresAt","IN_PAST");
  else if(exp.getTime()-now.getTime()>AUTH_LIMITS.maxDays*DAY_MS)err("expiresAt","ABOVE_POLICY");
  const ok=errors.length===0;
  return {ok,errors,submit:ok?AUTH_SUBMIT:"INVALID",preview:ok?{missionId,maxRisk,maxRuns,maxConcurrent,expiresAt:exp.toISOString(),excludes:["SCOPE_WIDENING","SPEND","RISKY_ACTIONS"]}:null};
}
