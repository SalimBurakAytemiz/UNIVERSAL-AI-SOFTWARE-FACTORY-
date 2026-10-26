// //TR: Bu görünüm parçası Proje Yolculuğu'ndaki "Analiz" adımıdır (A-FLOW-5): "Analiz et" POST /v1/missions/:id/analysis/step ile mevcut analiz fazının taslağını ürettirir (BusinessAnalysis, Requirements, Plan, Architecture); taslaklar aşağıdaki mevcut Pre-dev kararları bölümünde Founder tarafından onaylanır ya da reddedilir. BLOCKED durumunda sunucunun kesin engelleri ve Founder'ın kendi giriş komutu (yalnız metin) gösterilir. "Analiz tamam" YALNIZ dört fazın da onaylandığı COMPLETE sonucunda yazılır; ardından "Plan oluştur" POST .../analysis/plan ile onaylı plandan görev planını kurar ve görev -> gereksinim -> kabul kriteri izlenebilirliğini gösterir. Uç noktalar masaüstü allow-list'inde yoksa dürüst "etkin değil" yazılır; hiçbir sonuç uydurulmaz.
import {h,badge} from "../components.js";
import {drafts,statusBlock,setStatus,focusResult} from "../forms.js";
import {selection} from "../forms.js";
import {buildAnalysisStepRequest,buildAnalysisPlanRequest,classifyAnalysisStep,classifyAnalysisPlan,analysisStatusKey,ANALYSIS_KINDS} from "../analysis-core.js";

export const ANALYSIS_STEP_FORM="analysis-step";
export const ANALYSIS_PLAN_FORM="analysis-plan";
export const analysisUi={missionId:null,step:null,plan:null};
/** Mission değişince eski sonuçlar ve durumlar silinir (başka mission'a ait "tamam" gösterilmesin). */
export function resetAnalysis(missionId=null){
  analysisUi.missionId=missionId;analysisUi.step=null;analysisUi.plan=null;
  delete drafts.status[ANALYSIS_STEP_FORM];delete drafts.status[ANALYSIS_PLAN_FORM];
}
const tOr=(ctx,k,fallback)=>{const v=ctx.t(k);return v===k?fallback:v};

export async function submitAnalysisStep(ctx,missionId){
  const req=buildAnalysisStepRequest({missionId});
  if(!req.ok){setStatus(ANALYSIS_STEP_FORM,{ok:false,errors:req.errors});await ctx.rerender();return {ok:false,validation:true}}
  if(analysisUi.missionId!==missionId)resetAnalysis(missionId);
  drafts.busy[ANALYSIS_STEP_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[ANALYSIS_STEP_FORM]=false}
  const c=classifyAnalysisStep(res),k=analysisStatusKey(c,res,"step");
  // Bir denetim başarısız olursa eski sonuç gösterilmez (bayat "tamam" kalmasın): Plan oluştur kapısı da kapanır.
  analysisUi.step=c.kind==="STEP"?c.step:null;
  setStatus(ANALYSIS_STEP_FORM,{ok:k.ok,key:k.key,vars:k.vars,errors:null});
  await ctx.rerender();focusResult(ctx,ANALYSIS_STEP_FORM,["id:analysis-step-submit"]);
  return {ok:k.ok,kind:c.kind,status:res?.status??null};
}
export async function submitAnalysisPlan(ctx,missionId){
  // "Plan oluştur" yalnız bu oturumda bu mission için COMPLETE görülmüşse gönderilir; aksi halde hiçbir şey gitmez.
  if(analysisUi.missionId!==missionId||!analysisUi.step||analysisUi.step.status!=="COMPLETE"){
    setStatus(ANALYSIS_PLAN_FORM,{ok:false,key:"analysis.err.notComplete",vars:{},errors:null});await ctx.rerender();return {ok:false,validation:true};
  }
  const req=buildAnalysisPlanRequest({missionId});
  if(!req.ok){setStatus(ANALYSIS_PLAN_FORM,{ok:false,errors:req.errors});await ctx.rerender();return {ok:false,validation:true}}
  drafts.busy[ANALYSIS_PLAN_FORM]=true;
  let res;try{res=await ctx.api.post(req.path,req.body)}finally{drafts.busy[ANALYSIS_PLAN_FORM]=false}
  const c=classifyAnalysisPlan(res),k=analysisStatusKey(c,res,"plan");
  if(c.kind==="PLAN")analysisUi.plan=c.plan;
  setStatus(ANALYSIS_PLAN_FORM,{ok:k.ok,key:k.key,vars:k.vars,errors:null});
  await ctx.rerender();focusResult(ctx,ANALYSIS_PLAN_FORM,["id:analysis-plan-submit"]);
  return {ok:k.ok,kind:c.kind,status:res?.status??null};
}

/** "rol:KOD" ya da "KOD:ayrıntı" -> okunur metin; bilinmeyen kod ham ve "tanınmadı" notuyla. */
export function blockerText(ctx,code){
  const m=/^(implementer|reviewer):(.+)$/.exec(code),role=m?m[1]:null,c=m?m[2]:code,i=c.indexOf(":"),head=i<0?c:c.slice(0,i),detail=i<0?null:c.slice(i+1);
  const v=tOr(ctx,`run.reason.${head}`,null)??tOr(ctx,`analysis.blocker.${head}`,null);
  const base=v===null?`${c} (${ctx.t("analysis.unrecognised")})`:detail?`${v} (${detail.slice(0,80)})`:v;
  return role?`${ctx.t(`exec.profile.role.${role}`)}: ${base}`:base;
}
const LOGIN_RE=/^(implementer|reviewer):CLAUDE_PROFILE_LOGIN_(REQUIRED|EXPIRED)$/;
function loginCommands(exec,blockers){
  const out=[];
  for(const b of blockers){
    const m=LOGIN_RE.exec(b);if(!m||out.some(o=>o.role===m[1]))continue;
    const p=exec&&exec.state==="VERIFIED"&&Array.isArray(exec.profiles)?exec.profiles.find(x=>x&&x.role===m[1]):null;
    const r=exec&&exec.readiness&&exec.readiness[m[1]]?exec.readiness[m[1]]:null;
    out.push({role:m[1],command:(p&&p.loginCommand)||(r&&r.loginCommand)||null});
  }
  return out;
}
function stepBlock(ctx,step,exec){
  const doc=ctx.doc,kindName=k=>ctx.t(`journey.kind.${k}`);
  switch(step.status){
    case "BLOCKED":{
      const logins=loginCommands(exec,step.blockers);
      return h(doc,"div",{class:"note",role:"status",dataset:{analysisStatus:"BLOCKED"}},
        h(doc,"p",{text:ctx.t("analysis.blocked.head")}),
        h(doc,"ul",{dataset:{analysisBlockers:"1"}},(step.blockers.length?step.blockers:[step.blocker]).map(b=>h(doc,"li",{dataset:{analysisBlocker:b},text:blockerText(ctx,b)}))),
        ...logins.flatMap(l=>l.command?[h(doc,"p",{text:ctx.t("exec.profile.loginHint")}),h(doc,"pre",{class:"code",dataset:{analysisLogin:l.role}},h(doc,"code",{text:l.command}))]:[h(doc,"p",{class:"note",dataset:{analysisLoginMissing:l.role},text:ctx.t("analysis.blocked.noCommand",{role:ctx.t(`exec.profile.role.${l.role}`)})})]));
    }
    case "DRAFT_READY":
      return h(doc,"p",{class:"note",role:"status",dataset:{analysisStatus:"DRAFT_READY",artifact:step.artifactId}},ctx.t("analysis.draft.ready",{kind:kindName(step.kind),version:String(step.version),role:step.roleId}));
    case "AWAITING_APPROVAL":
      return h(doc,"p",{class:"note",role:"status",dataset:{analysisStatus:"AWAITING_APPROVAL",artifact:step.artifactId}},ctx.t("analysis.awaiting",{kind:kindName(step.kind),state:step.artifactState}));
    case "REJECTED":
      return h(doc,"p",{class:"note",role:"status",dataset:{analysisStatus:"REJECTED"}},ctx.t("analysis.rejected",{kind:kindName(step.kind),reason:step.reason}));
    case "BUILDER_FAILED":
      return h(doc,"p",{class:"note",role:"status",dataset:{analysisStatus:"BUILDER_FAILED"}},ctx.t("analysis.builderFailed",{kind:kindName(step.kind),code:step.code}));
    default:
      return h(doc,"p",{class:"note",role:"status",dataset:{analysisStatus:"COMPLETE"}},ctx.t("analysis.complete",{kinds:step.approved.map(kindName).join(", ")}));
  }
}
function planBlock(ctx,plan){
  const doc=ctx.doc;
  return h(doc,"div",{class:"note",id:"analysis-plan-result",dataset:{analysisPlan:"CREATED",tasks:String(plan.taskCount)}},
    h(doc,"p",{text:ctx.t(plan.replayed?"analysis.plan.replayed":"analysis.plan.created",{n:String(plan.taskCount)})}),
    h(doc,"ol",{"aria-label":ctx.t("analysis.trace.title"),class:"analysis-trace"},plan.trace.map(t=>h(doc,"li",{dataset:{traceTask:t.workPackageId}},
      h(doc,"strong",{class:"mono",text:t.workPackageId})," ",h(doc,"span",{class:"note",text:ctx.t("analysis.trace.estimate",{estimate:t.estimate})}),
      t.requirements.length?h(doc,"ul",{},t.requirements.map(r=>h(doc,"li",{dataset:{traceReq:r.id}},h(doc,"span",{class:"mono",text:r.id})," ",h(doc,"span",{text:r.statement}),
        r.acceptanceCriteria.length?h(doc,"ul",{},r.acceptanceCriteria.map(c=>h(doc,"li",{dataset:{traceCriterion:"1"},text:c}))):null))):h(doc,"p",{class:"note",dataset:{traceNone:"1"},text:ctx.t("analysis.trace.none")})))));
}
/** exec: ctx.api.executors() sonucu (giriş komutu için); null olabilir. */
export function analysisPanel(ctx,{missionId,exec}){
  const doc=ctx.doc;
  if(analysisUi.missionId!==missionId)resetAnalysis(missionId);
  const busyS=drafts.busy[ANALYSIS_STEP_FORM]===true,busyP=drafts.busy[ANALYSIS_PLAN_FORM]===true,step=analysisUi.step,complete=step&&step.status==="COMPLETE";
  return h(doc,"div",{class:"analysis-step",id:"analysis-step",role:"region","aria-label":ctx.t("analysis.title"),dataset:{analysisMission:missionId}},
    h(doc,"h3",{text:ctx.t("analysis.title")}),
    h(doc,"p",{class:"note",text:ctx.t("analysis.lead")}),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn btn-primary",id:"analysis-step-submit",dataset:{focusKey:"analysis-step-submit"},disabled:busyS,text:ctx.t("analysis.step.button"),
      on:{click:()=>{if(!drafts.busy[ANALYSIS_STEP_FORM])submitAnalysisStep(ctx,missionId)}}})),
    step?stepBlock(ctx,step,exec):h(doc,"p",{class:"note",dataset:{analysisStatus:"NONE"},text:ctx.t("analysis.none")}),
    statusBlock(ctx,ANALYSIS_STEP_FORM),
    complete?h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn btn-primary",id:"analysis-plan-submit",dataset:{focusKey:"analysis-plan-submit"},disabled:busyP,text:ctx.t("analysis.plan.button"),
      on:{click:()=>{if(!drafts.busy[ANALYSIS_PLAN_FORM])submitAnalysisPlan(ctx,missionId)}}})):h(doc,"p",{class:"note",dataset:{analysisPlanGate:"CLOSED"},text:ctx.t("analysis.plan.gate")}),
    statusBlock(ctx,ANALYSIS_PLAN_FORM),
    analysisUi.plan?planBlock(ctx,analysisUi.plan):null,
    analysisUi.plan?h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"analysis-open-plan",dataset:{focusKey:"analysis-open-plan"},text:ctx.t("analysis.plan.open"),on:{click:()=>{selection.missionId=missionId;ctx.navigate("work")}}})):null);
}
