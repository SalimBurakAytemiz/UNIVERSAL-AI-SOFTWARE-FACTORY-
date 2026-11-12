// //TR: Bu modül ACİL DURDUR onay penceresindeki canlı etki sayılarının saf (DOM'suz) çekirdeğidir (DSK-T0005, UI-124): Founder durdurmayı onaylamadan önce durdurmanın etkileyeceği koşu, görev ve bekleyen onay sayısını YALNIZ mevcut salt-okunur GET'lerden (GET /v1/work-runs ve koşu başına GET /v1/work-runs/:id/tasks) türetir. Durdurma davranışını değiştirmez; okunamayan kaynak "bilinmiyor" olarak söylenir, hiçbir sayı uydurulmaz veya sıfıra yuvarlanmaz.
import {RUN_STATUSES} from "./executive-core.js";

/** Kayıtlı koşu durumu -> durdurmanın etkisi. Lease altındaki koşular güvenli noktada durur; henüz başlamamış olanlar başlamaz; onay bekleyenler beklemede kalır. Diğer durumlar (bitmiş, engelli, iptal, karantina, başarısız) etkilenmez. */
export const HALTS=Object.freeze(["LEASED","RUNNING","CHECKPOINTING","VERIFYING","RETRY_SCHEDULED","DEGRADED","RECOVERING","CANCELLING"]);
export const WONT_START=Object.freeze(["CREATED","QUEUED","HANDOFF_PENDING"]);
export const AWAITING="AWAITING_APPROVAL";
/** Görev bağları en çok bu kadar etkilenen koşu için okunur (her biri bir GET); fazlası "en az" olarak gösterilir. */
export const MAX_TASK_LOOKUPS=20;
export const IMPACT_STATES=Object.freeze(["LOADING","VERIFIED","EMPTY","ERROR"]);
export const TASK_STATES=Object.freeze(["VERIFIED","PARTIAL","UNKNOWN"]);

/** Koşu listesinden durdurma etkisi grupları; bilinmeyen durum (sözleşme dışı) okumayı ERROR yapar, sessizce "etkilenmez" sayılmaz. */
export function groupRuns(items){
  if(!Array.isArray(items))return null;
  const halts=[],wontStart=[],awaiting=[];
  for(const r of items){
    if(!r||typeof r.runId!=="string"||!RUN_STATUSES.includes(r.status))return null;
    if(HALTS.includes(r.status))halts.push(r.runId);else if(WONT_START.includes(r.status))wontStart.push(r.runId);else if(r.status===AWAITING)awaiting.push(r.runId);
  }
  return {halts,wontStart,awaiting};
}

/**
 * Etki özeti. runsResult: api.queueWorkRuns() sonucu ({state,runs:{items}}); taskResults: koşu kimliği -> api.runTasks() sonucu (yalnız okunanlar).
 * -> {state:"ERROR"} | {state:"EMPTY"|"VERIFIED", runsHalting, runsNotStarting, approvals, tasks:{state,count,checked,affected}}.
 * Görev sayısı: okunan her VERIFIED bağ listesindeki benzersiz görevler. Okunamayan/denenmeyen koşu varsa durum PARTIAL ("en az"), hiçbiri okunamadıysa UNKNOWN.
 */
export function buildStopImpact(runsResult,taskResults={}){
  if(!runsResult||runsResult.state!=="VERIFIED"||!runsResult.runs)return {state:"ERROR"};
  const g=groupRuns(runsResult.runs.items);
  if(g===null)return {state:"ERROR"};
  const affected=[...g.halts,...g.wontStart];
  const tasks=new Set();let ok=0;
  for(const id of affected){const t=taskResults[id];if(t&&t.state==="VERIFIED"&&Array.isArray(t.links)){ok+=1;for(const l of t.links)tasks.add(l.taskId)}}
  const taskState=affected.length===0||ok===affected.length?"VERIFIED":ok===0?"UNKNOWN":"PARTIAL";
  const out={runsHalting:g.halts.length,runsNotStarting:g.wontStart.length,approvals:g.awaiting.length,tasks:{state:taskState,count:taskState==="UNKNOWN"?null:tasks.size,checked:ok,affected:affected.length}};
  return {state:affected.length===0&&g.awaiting.length===0?"EMPTY":"VERIFIED",...out};
}

/** Kaynakları okur (yalnız GET): önce koşu listesi, sonra etkilenen ilk MAX_TASK_LOOKUPS koşunun görev bağları. Hiçbir yazma veya durdurma çağrısı yapmaz. */
export async function loadStopImpact(api){
  let runs;
  try{runs=await api.queueWorkRuns()}catch{return {state:"ERROR"}}
  if(!runs||runs.state!=="VERIFIED")return {state:"ERROR"};
  const g=groupRuns(runs.runs?.items);
  if(g===null)return {state:"ERROR"};
  const ids=[...g.halts,...g.wontStart].slice(0,MAX_TASK_LOOKUPS),taskResults={};
  await Promise.all(ids.map(async id=>{try{taskResults[id]=await api.runTasks(id)}catch{taskResults[id]={state:"ERROR",links:[]}}}));
  return buildStopImpact(runs,taskResults);
}
