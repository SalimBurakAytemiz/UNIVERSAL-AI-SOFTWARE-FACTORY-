// //TR: Bu modül Analiz adımının (A-FLOW-5) saf, DOM'suz çekirdeğidir: POST /v1/missions/:id/analysis/step (mevcut aşamanın taslağını üretir) ve POST .../analysis/plan (onaylı plandan görev planı) isteklerini kurar, yanıtlarını katı biçimde eşler ve sınıflar. Sonuçlar Lane C AnalysisFlow sözleşmesidir: BLOCKED | DRAFT_READY | AWAITING_APPROVAL | REJECTED | BUILDER_FAILED | COMPLETE. "Analiz tamam" YALNIZ dört analiz fazının da onaylandığı COMPLETE sonucunda söylenir; bozuk ya da çelişkili yanıt INVALID olur ve hiçbir olumlu durum uydurulmaz.
import {MISSION_ID_RE} from "./journey-core.js";
import {describePostResult} from "./work-core.js";
import {ARTIFACT_ID_RE,buildApproveRequest,classifyPredevPost,predevStatusKey} from "./predev-decisions-core.js";

export const ANALYSIS_KINDS=Object.freeze(["BusinessAnalysis","Requirements","Plan","Architecture"]);
export const ANALYSIS_STATUSES=Object.freeze(["BLOCKED","DRAFT_READY","AWAITING_APPROVAL","REJECTED","BUILDER_FAILED","COMPLETE"]);
export const MAX_PLAN_TASKS=50;
export const STUCK_BLOCKER="ANALYSIS_PHASE_NOT_ADVANCED";
export const analysisStepPath=id=>typeof id==="string"&&MISSION_ID_RE.test(id)?`/v1/missions/${id}/analysis/step`:null;
export const analysisPlanPath=id=>typeof id==="string"&&MISSION_ID_RE.test(id)?`/v1/missions/${id}/analysis/plan`:null;
const result=(path,errors)=>Object.keys(errors).length?{ok:false,path:null,body:null,errors}:{ok:true,path,body:{},errors:{}};
export const buildAnalysisStepRequest=({missionId})=>{const p=analysisStepPath(missionId);return result(p,p?{}:{mission:"analysis.err.mission"})};
export const buildAnalysisPlanRequest=({missionId})=>{const p=analysisPlanPath(missionId);return result(p,p?{}:{mission:"analysis.err.mission"})};

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
// //TR: Sunucunun "bu kayıt yok" yanıtları (route VAR ve istek gönderildi): WORKOS_NOT_FOUND ve AnalysisFlow'un kendi kodları. Bunların dışındaki 404 (route yok / kod yok) "bu sürümde açık değil"dir.
export const NOT_FOUND_CODES=Object.freeze(["WORKOS_NOT_FOUND","ANALYSIS_MISSION_NOT_FOUND","ANALYSIS_PROJECT_NOT_FOUND"]);
const notFoundBody=b=>isObj(b)&&typeof b.error==="string"&&NOT_FOUND_CODES.includes(b.error);
const CONTROL_RE=/[\u0000-\u001f\u007f]+/g;
// //TR: Sunucu doğrulayıcıları (core/workos/predev/validators.ts) kimlik, ifade, tahmin ve kriter için yalnız "boş olmayan metin" ister; uzunluk ya da karakter sınırı yoktur ve LLM çıktısı satır sonu içerebilir. Bu yüzden görüntü metni REDDEDİLMEZ: denetim karakterleri boşluğa çevrilir ve ekran için kısaltılır (metin yalnız textContent ile yazılır, etkisizdir). Boş ya da metin olmayan değer ise hâlâ geçersizdir.
const text=(x,max)=>{
  if(typeof x!=="string"||x.trim().length===0)return null;
  const t=x.replace(CONTROL_RE," ").trim();
  return t.length?t.slice(0,max):null;
};
const ROLE_RE=/^[A-Za-z0-9_.-]{1,64}$/;
const kindOf=x=>ANALYSIS_KINDS.includes(x)?x:null;

/** Lane C AnalysisStep -> güvenli alanlar ya da null (kısmi sonuç yok). */
export function mapAnalysisStep(x){
  if(!isObj(x)||!ANALYSIS_STATUSES.includes(x.status))return null;
  switch(x.status){
    case "BLOCKED":{
      const blocker=text(x.blocker,200);
      if(blocker===null||!Array.isArray(x.blockers)||x.blockers.length>50)return null;
      const blockers=x.blockers.map(b=>text(b,200));
      if(blockers.includes(null)||(blockers.length>0&&blockers[0]!==blocker))return null;
      // //TR: A-ANALYSIS-STUCK-1: kind/artifactId sunucunun YAPILANDIRILMIŞ alanlarıdır ve yalnız ANALYSIS_PHASE_NOT_ADVANCED cevabında anlamlıdır; founderAction düzyazısı ASLA ayrıştırılmaz (yalnız metin olarak gösterilir). Alan eksik/bozuksa target:null ve düğme yoktur.
      const phaseStuck=blocker===STUCK_BLOCKER,kind=kindOf(x.kind);
      const target=phaseStuck&&kind!==null&&typeof x.artifactId==="string"&&ARTIFACT_ID_RE.test(x.artifactId)?{kind,artifactId:x.artifactId}:null;
      return {status:"BLOCKED",blocker,blockers,phaseStuck,target,founderAction:phaseStuck&&target===null?text(x.founderAction,600):null}; // düzyazı yalnız hedefsiz takılma cevabında, yalnız metin olarak taşınır; diğer engellerde serbest metin atılır
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
export const ANALYSIS_CONFLICT_REASONS=Object.freeze(["MISSION_NOT_PREDEV_ELIGIBLE"]);
const CONFLICT_REASON_RE=/^[A-Z][A-Z0-9_]{0,63}$/;
/** Adım yanıtı -> {kind:"STEP",step} | {kind:"NOT_ENABLED"|"INVALID"|"FAILED"|"DENIED"|"STOPPED"|"NOT_FOUND"|"BUSY"}| {kind:"CONFLICT",reason}. HTTP durumu sonuçla uyumlu olmalıdır: BLOCKED yalnız 200/409, REJECTED/BUILDER_FAILED yalnız 200/502, diğerleri yalnız 2xx. */
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
  // //TR: Ortak ücretli üretim kilidi: aynı mission zaten üretiliyor (PREDEV_PRODUCE_IN_PROGRESS) ya da başka bir mission üretiyor (PREDEV_PRODUCE_BUSY); bu bir idempotency çakışması DEĞİLDİR, sonuç da iddia edilmez.
  if(s===409&&isObj(body)&&(body.error==="PREDEV_PRODUCE_IN_PROGRESS"||body.error==="PREDEV_PRODUCE_BUSY"))return {kind:"BUSY",scope:body.error==="PREDEV_PRODUCE_BUSY"?"OTHER":"SAME"};
  // //TR: A-ANALYSIS-L10N (F2): 409 WORKOS_CONFLICT + reason (ör. MISSION_NOT_PREDEV_ELIGIBLE) sunucunun NEDEN söylediği koşuldur ve köprü onu korur; genel "idempotency anahtarı" 409 metnine düşürülmez.
  if(s===409&&isObj(body)&&body.error==="WORKOS_CONFLICT"&&typeof body.reason==="string"&&CONFLICT_REASON_RE.test(body.reason))return {kind:"CONFLICT",reason:body.reason};
  if(s===423)return {kind:"STOPPED"};
  if(s===403)return {kind:"DENIED"};
  if(s===404&&notFoundBody(body))return {kind:"NOT_FOUND"};
  if(s===404||s===501)return {kind:"NOT_ENABLED"};
  return {kind:"FAILED"};
}

const CODE_RE=/^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_SHOWN=200;
/** createPlan sonucu {tasks,replayed,trace,summary} -> sayı ve izlenebilirlik (görev -> gereksinim -> kabul kriteri). Sunucu doğrulayıcılarının kabul ettiği her plan okunur: kimlik/ifade/kriter uzunluğu ve sayısı sınırlanmaz, yalnız ekran için kısaltılır (gizlenen sayısı taşınır). Biçim gerçekten bozuksa null. */
export function mapAnalysisPlan(x){
  if(!isObj(x)||!Array.isArray(x.tasks)||x.tasks.length<1||x.tasks.length>MAX_PLAN_TASKS||typeof x.replayed!=="boolean"||!Array.isArray(x.trace)||x.trace.length!==x.tasks.length)return null;
  const trace=[];
  for(const [i,t] of x.trace.entries()){
    const wp=isObj(t)?text(t.workPackageId,200):null,est=isObj(t)?text(t.estimate,100):null;
    if(!isObj(t)||t.index!==i||wp===null||est===null||!Array.isArray(t.satisfies)||!Array.isArray(t.requirements))return null;
    const satisfies=t.satisfies.map(s=>text(s,200));
    if(satisfies.includes(null))return null;
    const reqs=[];
    for(const r of t.requirements){
      const id=isObj(r)?text(r.id,200):null,statement=isObj(r)?text(r.statement,2000):null;
      if(id===null||statement===null||!Array.isArray(r.acceptanceCriteria))return null;
      const crit=r.acceptanceCriteria.map(c=>text(c,2000));
      if(crit.includes(null))return null;
      reqs.push({id,statement,acceptanceCriteria:crit.slice(0,MAX_SHOWN),hiddenCriteria:Math.max(0,crit.length-MAX_SHOWN)});
    }
    trace.push({index:i,workPackageId:wp,estimate:est,satisfies:satisfies.slice(0,MAX_SHOWN),requirements:reqs.slice(0,MAX_SHOWN),hiddenRequirements:Math.max(0,reqs.length-MAX_SHOWN)});
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
  if(s===404&&notFoundBody(body))return {kind:"NOT_FOUND"};
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
  if(c.kind==="BUSY")return {ok:false,key:`analysis.busy.${c.scope}`,vars:{}};
  if(c.kind==="STOPPED")return {ok:false,key:"post.err.423",vars:{status:423}};
  if(c.kind==="CONFLICT")return ANALYSIS_CONFLICT_REASONS.includes(c.reason)?{ok:false,key:`analysis.conflict.${c.reason}`,vars:{}}:{ok:false,key:"analysis.conflict.other",vars:{reason:c.reason}};
  // 403: sunucunun ACTION_DENIED nedeni (varsa) ya da yetki hatası; describePostResult ikisini de doğru ayırır.
  const d=describePostResult(res);return {ok:false,key:d.key,vars:d.vars};
}

/** //TR: A-ANALYSIS-STUCK-1: "Yeniden onayla" isteği yalnız sunucunun yapılandırılmış hedefinden (step.target) kurulur; hedef yoksa istek yoktur. Onay kanıtı Founder'ın kendi girdisidir (uydurulmaz); yol mevcut pre-dev onay yoludur. */
export function buildReapproveRequest({missionId,step,evidenceText}){
  const t=step&&step.status==="BLOCKED"&&step.phaseStuck?step.target:null;
  if(!t)return {ok:false,path:null,body:null,errors:{artifact:"analysis.err.noTarget"}};
  return buildApproveRequest({missionId,artifactId:t.artifactId,evidenceText});
}
/** Yeniden onay yanıtı -> {ok,key,vars,kind}; başarıda "aşama ilerledi" DEĞİL yalnız sunucunun bildirdiği aşama söylenir, hiçbir şey üretilmediği belirtilir. */
export function reapproveOutcome(res,missionId){
  const c=classifyPredevPost(res,missionId);
  if(c.kind==="RESULT")return {ok:true,key:"analysis.reapprove.done",vars:{phase:c.predev.phase},kind:c.kind};
  const k=predevStatusKey(c,res,"approve");return {ok:false,key:k.key,vars:k.vars,kind:c.kind};
}
