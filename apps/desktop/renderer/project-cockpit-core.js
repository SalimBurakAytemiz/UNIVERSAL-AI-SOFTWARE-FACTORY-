// //TR: Bu modül V3-T1027 proje bazlı cockpit panelinin saf, DOM'suz mantığıdır: koşu durumu ve engeller yalnız kayıtlı GET /v1/run-summaries (izin listesinde limit sorgusuyla) verisinden, bekleyen onaylar yalnız GET /v1/cockpit awaitingApproval öğelerinden türetilir; harcama için kayıtlı uç nokta YOKTUR, bu yüzden harcama her zaman dürüst UNAVAILABLE'dır ve hiçbir sayı uydurulmaz.
import {redactText} from "./project-core.js";

export const RUN_SUMMARIES_PATH="/v1/run-summaries?limit=100";
export const RUN_SUMMARIES_LIMIT=100;
/** Koşuyu ilerletmeyen, insan/onarım gerektiren durumlar (core/workos/types.ts RunStatus alt kümesi). */
export const BLOCKER_RUN_STATUSES=Object.freeze(["BLOCKED","QUARANTINED","RECOVERY_FAILED"]);
const RUN_STATUSES=new Set(["CREATED","QUEUED","LEASED","RUNNING","CHECKPOINTING","VERIFYING","SUCCEEDED","RETRY_SCHEDULED","DEGRADED","HANDOFF_PENDING","AWAITING_APPROVAL","BLOCKED","QUARANTINED","CANCELLING","CANCELLED","RECOVERING","RECOVERY_FAILED","FAILED"]);
/** Harcama için kayıtlı bir Control API uç noktası yok: bu sabit bir Kurucu katmanı takip açığıdır, veri değil. */
export const SPEND_GAP=Object.freeze({state:"UNAVAILABLE",reason:"NO_SPEND_ENDPOINT"});
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const str=(x,max)=>typeof x==="string"&&x.length>0?x.slice(0,max):null;
const LIVE=new Set(["VERIFIED","STALE"]);

/** GET /v1/run-summaries gövdesini sıkı eşler: {page:{runs,nextCursor,total}}; bozuk gövde ERROR'dur (boş liste ile karışmaz). */
export function mapRunSummaries(raw){
  const p=isObj(raw)?raw.page:null;
  if(!isObj(p)||!Array.isArray(p.runs)||!Number.isSafeInteger(p.total)||p.total<0||!(p.nextCursor===null||typeof p.nextCursor==="string"))return {state:"ERROR",runs:[],total:null,partial:false};
  const runs=p.runs.filter(isObj).slice(0,RUN_SUMMARIES_LIMIT).map(r=>({runId:str(r.runId,80),projectId:str(r.projectId,80),status:RUN_STATUSES.has(r.status)?r.status:"UNKNOWN",reason:str(r.reason,200)})).filter(r=>r.runId&&r.projectId);
  return {state:"VERIFIED",runs,total:p.total,partial:p.nextCursor!==null||p.total>runs.length};
}

/** Projeler + onaylar + koşular -> proje başına satır. Kaynak canlı değilse ilgili hücre o kaynağın dürüst durumunu taşır; sayı uydurulmaz. */
export function buildProjectCockpit({projects,approvals,runs}){
  if(projects?.state!=="VERIFIED")return {state:projects?.state??"ERROR",rows:[]};
  const runsLive=runs?.state==="VERIFIED",apprLive=LIVE.has(approvals?.state);
  const rows=projects.items.filter(p=>p.projectId).map(p=>{
    const mine=runsLive?runs.runs.filter(r=>r.projectId===p.projectId):[];
    const byStatus={};for(const r of mine)byStatus[r.status]=(byStatus[r.status]??0)+1;
    const blocked=mine.filter(r=>BLOCKER_RUN_STATUSES.includes(r.status));
    const pending=apprLive?(approvals.items??[]).filter(a=>a.projectId===p.projectId):[];
    return {
      projectId:p.projectId,name:p.name,
      runs:runsLive?{state:"VERIFIED",count:mine.length,byStatus,partial:runs.partial,shown:runs.runs.length,total:runs.total}:{state:runs?.state??"ERROR"},
      blockers:runsLive?{state:"VERIFIED",count:blocked.length,partial:runs.partial,items:blocked.slice(0,3).map(r=>({runId:r.runId,status:r.status,reason:r.reason===null?null:redactText(r.reason).slice(0,200)}))}:{state:runs?.state??"ERROR"},
      approvals:apprLive?{state:approvals.state,count:pending.length,items:pending.slice(0,3).map(a=>({missionId:a.missionId,title:a.title,riskLevel:a.riskLevel}))}:{state:approvals?.state??"ERROR"},
      spend:{...SPEND_GAP},
    };
  });
  return {state:rows.length?"VERIFIED":"EMPTY",rows};
}
