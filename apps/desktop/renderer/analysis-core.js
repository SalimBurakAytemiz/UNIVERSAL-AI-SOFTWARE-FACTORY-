// //TR: Bu modül Analiz adımının (A-FLOW-5) saf, DOM'suz çekirdeğidir: POST /v1/missions/:id/analysis/step (mevcut aşamanın taslağını üretir) ve POST .../analysis/plan (onaylı plandan görev planı) isteklerini kurar, yanıtlarını katı biçimde eşler ve sınıflar. Sonuçlar Lane C AnalysisFlow sözleşmesidir: BLOCKED | DRAFT_READY | AWAITING_APPROVAL | REJECTED | BUILDER_FAILED | COMPLETE. "Analiz tamam" YALNIZ dört analiz fazının da onaylandığı COMPLETE sonucunda söylenir; bozuk ya da çelişkili yanıt INVALID olur ve hiçbir olumlu durum uydurulmaz.
import {MISSION_ID_RE} from "./journey-core.js";
import {describePostResult} from "./work-core.js";
import {ARTIFACT_ID_RE} from "./predev-decisions-core.js";

export const ANALYSIS_KINDS=Object.freeze(["BusinessAnalysis","Requirements","Plan","Architecture"]);
export const ANALYSIS_STATUSES=Object.freeze(["BLOCKED","DRAFT_READY","AWAITING_APPROVAL","REJECTED","BUILDER_FAILED","COMPLETE"]);
export const MAX_PLAN_TASKS=50;
export const analysisStepPath=id=>typeof id==="string"&&MISSION_ID_RE.test(id)?`/v1/missions/${id}/analysis/step`:null;
export const analysisPlanPath=id=>typeof id==="string"&&MISSION_ID_RE.test(id)?`/v1/missions/${id}/analysis/plan`:null;
const result=(path,errors)=>Object.keys(errors).length?{ok:false,path:null,body:null,errors}:{ok:true,path,body:{},errors:{}};
export const buildAnalysisStepRequest=({missionId})=>{const p=analysisStepPath(missionId);return result(p,p?{}:{mission:"analysis.err.mission"})};
export const buildAnalysisPlanRequest=({missionId})=>{const p=analysisPlanPath(missionId);return result(p,p?{}:{mission:"analysis.err.mission"})};

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const CONTROL_RE=/[\u0000-\u001f\u007f]/;
const text=(x,max)=>typeof x==="string"&&x.length>0&&x.length<=max&&!CONTROL_RE.test(x)?x:null;
const ROLE_RE=/^[A-Za-z0-9_.-]{1,64}$/;
const kindOf=x=>ANALYSIS_KINDS.includes(x)?x:null;

/** Lane C AnalysisStep -> güvenli alanlar ya da null (kısmi sonuç yok). */
export function mapAnalysisStep(x){
  if(!isObj(x)||!ANALYSIS_STATUSES.includes(x.status))return null;
  switch(x.status){
    case "BLOCKED":{
      const blocker=text(x.blocker,200);
      if(blocker===null||!Array.isArray(x.blockers)||x.blockers.length>20)return null;
      const blockers=x.blockers.map(b=>text(b,200));
      if(blockers.includes(null)||(blockers.length>0&&blockers[0]!==blocker))return null;
      return {status:"BLOCKED",blocker,blockers};
    }
    case "DRAFT_READY":{
      const kind=kindOf(x.kind);
      if(kind===null||typeof x.artifactId!=="string"||!ARTIFACT_ID_RE.test(x.artifactId)||!Number.isSafeInteger(x.version)||x.version<1||typeof x.roleId!=="string"||!ROLE_RE.test(x.roleId)||x.next!=="FOUNDER_APPROVAL")return null;
      return {status:"DRAFT_READY",kind,artifactId:x.artifactId,version:x.version,roleId:x.roleId};
    }
    case "AWAITING_APPROVAL":{
      const kind=kindOf(x.kind);
      if(kind===null||typeof x.artifactId!=="string"||!ARTIFACT_ID_RE.test(x.artifactId)||!(x.artifactState==="DRAFT"||x.artifactState==="SUBMITTED")||x.next!=="FOUNDER_APPROVAL")return null;
      return {status:"AWAITING_APPROVAL",kind,artifactId:x.artifactId,artifactState:x.artifactState};
    }
    case "REJECTED":{
      const kind=kindOf(x.kind),reason=text(x.reason,300);
      return kind===null||reason===null?null:{status:"REJECTED",kind,reason};
    }
    case "BUILDER_FAILED":{
      const kind=kindOf(x.kind),code=text(x.code,120);
      return kind===null||code===null?null:{status:"BUILDER_FAILED",kind,code};
    }
    default:{ // COMPLETE: dört fazın hepsi tam olarak bir kez onaylı olmadıkça "tamam" denmez
      if(!Array.isArray(x.approved)||x.approved.length!==ANALYSIS_KINDS.length||new Set(x.approved).size!==ANALYSIS_KINDS.length||!ANALYSIS_KINDS.every(k=>x.approved.includes(k)))return null;
      return {status:"COMPLETE",approved:ANALYSIS_KINDS.filter(k=>x.approved.includes(k))};
    }
  }
}
/** Adım yanıtı -> {kind:"STEP",step} | {kind:"NOT_ENABLED"|"INVALID"|"FAILED"|"DENIED"|"STOPPED"|"NOT_FOUND"}. HTTP durumu sonuçla uyumlu olmalıdır: BLOCKED yalnız 200/409, REJECTED/BUILDER_FAILED yalnız 200/502, diğerleri yalnız 2xx. */
export function classifyAnalysisStep(res){
  if(!res)return {kind:"FAILED"};
  if(res.thrown&&/INVALID_API_PATH/.test(String(res.message??"")))return {kind:"NOT_ENABLED"};
  if(res.thrown)return {kind:"FAILED"};
  const s=res.status,body=res.body;
  if(isObj(body)&&typeof body.status==="string"&&ANALYSIS_STATUSES.includes(body.status)){
    const step=mapAnalysisStep(body);
    if(step===null)return {kind:"INVALID"};
    const ok2xx=s>=200&&s<300,allowed=step.status==="BLOCKED"?(ok2xx||s===409):step.status==="REJECTED"||step.status==="BUILDER_FAILED"?(ok2xx||s===502):ok2xx;
    return allowed?{kind:"STEP",step}:{kind:"INVALID"};
  }
  if(s===409&&isObj(body)&&body.error==="ANALYSIS_BLOCKED"){
    const step=mapAnalysisStep({status:"BLOCKED",blocker:body.blocker,blockers:body.blockers});
    return step===null?{kind:"INVALID"}:{kind:"STEP",step};
  }
  if(s>=200&&s<300)return {kind:"INVALID"};
  if(s===423)return {kind:"STOPPED"};
  if(s===403)return {kind:"DENIED"};
  if(s===404&&isObj(body)&&body.error==="WORKOS_NOT_FOUND")return {kind:"NOT_FOUND"};
  if(s===404||s===501)return {kind:"NOT_ENABLED"};
  return {kind:"FAILED"};
}

const CODE_RE=/^[A-Z][A-Z0-9_]{0,63}$/;
const ID_RE=/^[A-Za-z0-9_.-]{1,64}$/;
/** createPlan sonucu {tasks,replayed,trace,summary} -> sayı ve izlenebilirlik (görev -> gereksinim -> kabul kriteri). Biçim bozuksa null. */
export function mapAnalysisPlan(x){
  if(!isObj(x)||!Array.isArray(x.tasks)||x.tasks.length<1||x.tasks.length>MAX_PLAN_TASKS||typeof x.replayed!=="boolean"||!Array.isArray(x.trace)||x.trace.length!==x.tasks.length)return null;
  const trace=[];
  for(const [i,t] of x.trace.entries()){
    if(!isObj(t)||t.index!==i||typeof t.workPackageId!=="string"||!ID_RE.test(t.workPackageId)||text(t.estimate,40)===null||!Array.isArray(t.satisfies)||t.satisfies.length>50||!t.satisfies.every(s=>typeof s==="string"&&ID_RE.test(s))||!Array.isArray(t.requirements)||t.requirements.length>50)return null;
    const reqs=[];
    for(const r of t.requirements){
      if(!isObj(r)||typeof r.id!=="string"||!ID_RE.test(r.id)||text(r.statement,500)===null||!Array.isArray(r.acceptanceCriteria)||r.acceptanceCriteria.length>20||!r.acceptanceCriteria.every(c=>text(c,500)!==null))return null;
      reqs.push({id:r.id,statement:r.statement,acceptanceCriteria:[...r.acceptanceCriteria]});
    }
    trace.push({index:i,workPackageId:t.workPackageId,estimate:t.estimate,satisfies:[...t.satisfies],requirements:reqs});
  }
  return {taskCount:x.tasks.length,replayed:x.replayed,trace};
}
/** Plan yanıtı -> {kind:"PLAN",plan} | {kind:"REFUSED",code} | NOT_ENABLED | INVALID | FAILED | DENIED | STOPPED | NOT_FOUND. */
export function classifyAnalysisPlan(res){
  if(!res)return {kind:"FAILED"};
  if(res.thrown&&/INVALID_API_PATH/.test(String(res.message??"")))return {kind:"NOT_ENABLED"};
  if(res.thrown)return {kind:"FAILED"};
  const s=res.status,body=res.body;
  if(s>=200&&s<300){const plan=mapAnalysisPlan(body);return plan===null?{kind:"INVALID"}:{kind:"PLAN",plan}}
  if(s===409&&isObj(body)){
    const e=typeof body.error==="string"?body.error:typeof body.code==="string"?body.code:"";
    return CODE_RE.test(e)?{kind:"REFUSED",code:e}:{kind:"FAILED"};
  }
  if(s===423)return {kind:"STOPPED"};
  if(s===403)return {kind:"DENIED"};
  if(s===404&&isObj(body)&&body.error==="WORKOS_NOT_FOUND")return {kind:"NOT_FOUND"};
  if(s===404||s===501)return {kind:"NOT_ENABLED"};
  return {kind:"FAILED"};
}
/** Sınıf -> form durum anahtarı {ok,key,vars}; `verb` step|plan. */
export function analysisStatusKey(c,res,verb){
  // BLOCKED / REJECTED / BUILDER_FAILED sunucuyu doğru yanıtlamış olsa da Founder açısından başarı DEĞİLDİR: ok:false.
  if(c.kind==="PLAN")return {ok:true,key:c.plan.replayed?"analysis.plan.replayed":"analysis.plan.created",vars:{n:String(c.plan.taskCount)}};
  if(c.kind==="STEP")return {ok:["DRAFT_READY","AWAITING_APPROVAL","COMPLETE"].includes(c.step.status),key:`analysis.step.${c.step.status}`,vars:{kind:c.step.kind??""}};
  if(c.kind==="REFUSED")return {ok:false,key:"analysis.plan.refused",vars:{code:c.code}};
  if(c.kind==="NOT_ENABLED")return {ok:false,key:"analysis.notEnabled",vars:{}};
  if(c.kind==="NOT_FOUND")return {ok:false,key:"analysis.notFound",vars:{}};
  if(c.kind==="INVALID")return {ok:false,key:"analysis.invalid",vars:{}};
  if(c.kind==="STOPPED")return {ok:false,key:"post.err.423",vars:{status:423}};
  if(c.kind==="DENIED")return {ok:false,key:"post.err.auth",vars:{status:403}};
  const d=describePostResult(res);return {ok:false,key:d.key,vars:d.vars};
}
