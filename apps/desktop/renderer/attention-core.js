// //TR: Bu modül Founder dikkat kuyruğunun (GET /v1/attention, Lane B: yalnız Work OS kayıtlarından türetilir, emekli scheduler kaynağı /v1/founder-attention DEĞİL) saf, DOM'suz sıkı eşleyicisidir. Bilinmeyen tür, tür-eylem çifti uyuşmayan ya da bozuk öğeler ATILIR ama sayılır (dropped) ve arayüzde söylenir; sayaçlar (altı tür) ve truncated sıkı doğrulanır, bozuk yanıt (sayaç/truncated/source) TÜM okumayı ERROR yapar. Öğeler önem sırasıyla (sunucu sırası eşitlikte korunur) gösterilir; her öğenin sonraki eylemi sunucunun bildirdiği değerdir.
export const ATTENTION_PATH="/v1/attention";
/** Önem sırası (sunucudaki RANK ile aynı): Founder'ın şimdi eylemi gereken öğeler önce. */
export const ATTENTION_KINDS=Object.freeze(["RUN_AWAITING_APPROVAL","MISSION_FOUNDER_ATTENTION","RUN_NEEDS_DECISION","MISSION_AUTHORIZATION_PENDING","MISSION_BLOCKED","TASK_BLOCKED"]);
export const NEXT_ACTIONS=Object.freeze(["PREPARE_DELIVERY","ACCEPT_DELIVERY","REVIEW_RUN","REVIEW_MISSION","AUTHORIZE_MISSION","UNBLOCK_TASK"]);
/** Türe göre geçerli sonraki eylemler (sunucu kuralı yansıması); eşleşmeyen öğe bozuk sayılır. */
export const ACTIONS_FOR_KIND=Object.freeze({RUN_AWAITING_APPROVAL:["PREPARE_DELIVERY","ACCEPT_DELIVERY"],MISSION_FOUNDER_ATTENTION:["REVIEW_MISSION"],RUN_NEEDS_DECISION:["REVIEW_RUN"],MISSION_AUTHORIZATION_PENDING:["AUTHORIZE_MISSION"],MISSION_BLOCKED:["REVIEW_MISSION"],TASK_BLOCKED:["UNBLOCK_TASK"]});
export const ATTENTION_MAX_ITEMS=200;
const MAX_COUNT=1000000;
const PROJECT_RE=/^prj_[0-9a-f]{24}$/,MISSION_RE=/^msn_[0-9a-f]{24}$/,TASK_RE=/^tsk_[0-9a-f]{24}$/,RUN_RE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const ISO_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const cnt=x=>Number.isSafeInteger(x)&&x>=0&&x<=MAX_COUNT;
const iso=x=>{if(typeof x!=="string"||!ISO_RE.test(x))return null;const t=Date.parse(x);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x.slice(0,10)?x:null};
const text=(x,max)=>typeof x==="string"&&x.trim().length>0&&x.length<=max?x:null;
function mapItem(x){
  if(!isObj(x)||!ATTENTION_KINDS.includes(x.kind)||!ACTIONS_FOR_KIND[x.kind].includes(x.nextAction))return null;
  if(typeof x.projectId!=="string"||!PROJECT_RE.test(x.projectId)||typeof x.missionId!=="string"||!MISSION_RE.test(x.missionId))return null;
  if(x.runId!==null&&(typeof x.runId!=="string"||!RUN_RE.test(x.runId)))return null;
  if(x.taskId!==null&&(typeof x.taskId!=="string"||!TASK_RE.test(x.taskId)))return null;
  if(x.kind==="TASK_BLOCKED"&&x.taskId===null)return null;
  if((x.kind==="RUN_AWAITING_APPROVAL"||x.kind==="RUN_NEEDS_DECISION")&&x.runId===null)return null;
  const title=text(x.title,200);if(title===null)return null;
  if(x.reason!==null&&text(x.reason,300)===null)return null;
  const since=x.since===null?null:iso(x.since);if(x.since!==null&&since===null)return null;
  return {kind:x.kind,nextAction:x.nextAction,projectId:x.projectId,missionId:x.missionId,runId:x.runId,taskId:x.taskId,title,reason:x.reason,since};
}
/** GET /v1/attention yanıtı -> {state:"VERIFIED",queue:{items(önem sırası),counts,truncated,dropped,shownCounts}} | {state:"ERROR",queue:null}. */
export function mapAttentionQueue(raw){
  const bad={state:"ERROR",queue:null};
  const a=isObj(raw)?raw.attention:null;
  if(!isObj(a)||a.source!=="WORKOS"||typeof a.truncated!=="boolean"||!Array.isArray(a.items)||a.items.length>ATTENTION_MAX_ITEMS||!isObj(a.counts)||Object.keys(a.counts).length!==ATTENTION_KINDS.length)return bad;
  const counts={};let total=0;
  for(const k of ATTENTION_KINDS){if(!cnt(a.counts[k]))return bad;counts[k]=a.counts[k];total+=a.counts[k]}
  const items=[];let dropped=0;
  for(const x of a.items){const m=mapItem(x);if(m===null)dropped++;else items.push(m)}
  const shownCounts=Object.fromEntries(ATTENTION_KINDS.map(k=>[k,items.filter(i=>i.kind===k).length]));
  for(const k of ATTENTION_KINDS)if(shownCounts[k]>counts[k])return bad;
  if(dropped===0){
    if(a.truncated){if(items.length!==ATTENTION_MAX_ITEMS||total<=ATTENTION_MAX_ITEMS)return bad}
    else if(total!==items.length||ATTENTION_KINDS.some(k=>shownCounts[k]!==counts[k]))return bad;
  }
  const rank=Object.fromEntries(ATTENTION_KINDS.map((k,i)=>[k,i]));
  const sorted=items.map((it,i)=>({it,i})).sort((p,q)=>rank[p.it.kind]-rank[q.it.kind]||p.i-q.i).map(p=>p.it);
  return {state:"VERIFIED",queue:{items:sorted,counts,total,truncated:a.truncated,dropped,shownCounts}};
}
/** //TR: Kuyruğun dürüst özeti: sayaçlar SUNUCUNUN sayılarıdır; kesilmiş ya da okunamayan öğe varsa kuyruk ASLA boş/VERIFIED sayılmaz (kind ATTENTION kalır). Okunamayan kaynak {kind:"UNREADABLE"}. */
export function attentionSummary(att){
  if(!att||att.state!=="VERIFIED"||!att.queue)return {kind:"UNREADABLE",total:null,shown:0,truncated:false,dropped:0};
  const q=att.queue;
  return {kind:q.total>0||q.dropped>0?"ATTENTION":"VERIFIED",total:q.total,shown:q.items.length,truncated:q.truncated,dropped:q.dropped};
}
/** Eski tüketiciler (kabuk rozeti, Teslimat, Kule) yalnız {state,blocked[]} bilir; yeni öğe, eski satır biçimine KAYIPSIZ çevrilir (tür ve gerekçe aynen, yeniden deneme yetkisi yok). */
export function attentionAsBlocked(item){
  return {packageId:item.taskId??item.runId??item.missionId,kind:item.kind,reason:item.reason,at:item.since,retryable:false,nextAction:item.nextAction,missionId:item.missionId};
}
