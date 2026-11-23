// //TR: DSK-T0002 (UI-014): Proje Yolculuğu'nda mission başına okunur analiz raporu. Karar durumu her çizimde canlı pre-dev okuma modelinden (GET /v1/predev/:id) gelir; rapor içeriği (özet, önerilen işler + kabul kriterleri, riskler ve açık sorular) Founder "Raporu göster"e bastığında salt-okunur GET /v1/missions/:id/analysis/report ile okunur. Uç nokta masaüstü izin listesinde yoksa dürüst "etkin değil", okuma hatasında dürüst hata ve yeniden dene gösterilir; hiçbir içerik uydurulmaz. Onay/ret akışına dokunmaz.
import {h} from "../components.js";
import {analysisReportPath,mapAnalysisReport,buildReportModel,REPORT_KINDS} from "../analysis-report-core.js";

export const reportUi={missionId:null,loading:false,res:null};
export function resetAnalysisReport(missionId=null){reportUi.missionId=missionId;reportUi.loading=false;reportUi.res=null}

/** Raporu okur; sonuç {state:VERIFIED|UNAVAILABLE|OFFLINE|ERROR,...}. İstek sürerken başka mission seçilirse cevap yazılmaz. */
export async function loadAnalysisReport(ctx,missionId){
  if(reportUi.missionId!==missionId)resetAnalysisReport(missionId);
  if(reportUi.loading)return {state:"BUSY"};
  const p=analysisReportPath(missionId);
  if(!p){reportUi.res={state:"ERROR",report:null};await ctx.rerender();return reportUi.res}
  reportUi.loading=true;
  let res;try{await ctx.rerender();const r=await ctx.api.get(p,{force:true});res=r.ok?mapAnalysisReport(r.data):{state:r.state==="UNAVAILABLE"?"UNAVAILABLE":r.state==="OFFLINE"?"OFFLINE":"ERROR",report:null,status:r.status??null}}
  catch{res={state:"ERROR",report:null}}
  finally{if(reportUi.missionId===missionId)reportUi.loading=false}
  if(reportUi.missionId!==missionId)return {state:"STALE"};
  reportUi.res=res;await ctx.rerender();return res;
}

const kindName=(ctx,k)=>ctx.t(`journey.kind.${k}`);
function list(doc,items,attr,render){return h(doc,"ul",{dataset:{[attr]:"1"}},items.map(render))}
function section(doc,id,title,...body){return h(doc,"section",{class:"analysis-report-section",dataset:{reportSection:id}},h(doc,"h4",{text:title}),...body)}
function decisionSection(ctx,pre,model){
  const doc=ctx.doc;
  // Canlı karar durumu önceliklidir (her çizimde okunur); okuma yoksa yüklenen raporun durumları kullanılır.
  const live=pre&&pre.state==="VERIFIED"&&pre.predev?REPORT_KINDS.map(kind=>{const a=pre.predev.artifacts.find(x=>x.kind===kind);return {kind,state:a?a.state:"NOT_STARTED",version:a?a.version:null}}):null;
  const rows=live??(model?model.decisions:null);
  if(!rows)return section(doc,"decisions",ctx.t("analysisReport.decisions"),h(doc,"p",{class:"note",dataset:{reportDecisions:"UNKNOWN"},text:ctx.t("analysisReport.decisions.unknown")}));
  const approved=rows.filter(r=>r.state==="APPROVED").length;
  return section(doc,"decisions",ctx.t("analysisReport.decisions"),
    h(doc,"p",{class:"note",dataset:{reportApproved:String(approved),reportTotal:String(rows.length)},text:ctx.t("analysisReport.decisions.count",{n:String(approved),total:String(rows.length)})}),
    list(doc,rows,"reportDecisionList",r=>h(doc,"li",{dataset:{reportDecision:r.kind,reportState:r.state}},h(doc,"strong",{text:kindName(ctx,r.kind)}),": ",h(doc,"span",{text:ctx.t(`journey.artState.${r.state}`)}))));
}
function contentSections(ctx,model){
  const doc=ctx.doc,none=k=>h(doc,"p",{class:"note",dataset:{reportEmpty:k},text:ctx.t(`analysisReport.empty.${k}`)});
  const sm=model.summary;
  const summary=section(doc,"summary",ctx.t("analysisReport.summary"),
    sm?[sm.problem?h(doc,"p",{dataset:{reportProblem:"1"},text:sm.problem}):none("summary"),
      sm.goals.length?h(doc,"div",{},h(doc,"p",{class:"note",text:ctx.t("analysisReport.goals")}),list(doc,sm.goals,"reportGoals",g=>h(doc,"li",{},g.id?h(doc,"span",{class:"mono",text:g.id}):null," ",g.statement))):null,
      sm.successMetrics.length?h(doc,"div",{},h(doc,"p",{class:"note",text:ctx.t("analysisReport.metrics")}),list(doc,sm.successMetrics,"reportMetrics",m=>h(doc,"li",{text:m}))):null]:none("summary"));
  const tasks=section(doc,"tasks",ctx.t("analysisReport.tasks"),
    model.tasks&&model.tasks.length?h(doc,"ol",{class:"analysis-report-tasks"},model.tasks.map(t=>h(doc,"li",{dataset:{reportTask:t.id}},
      h(doc,"strong",{class:"mono",text:t.id})," ",h(doc,"span",{text:t.title??""}),t.estimate?h(doc,"span",{class:"note",text:` (${ctx.t("analysis.trace.estimate",{estimate:t.estimate})})`}):null,
      t.requirements.length?h(doc,"ul",{},t.requirements.map(r=>h(doc,"li",{dataset:{reportReq:r.id}},h(doc,"span",{class:"mono",text:r.id})," ",
        r.unknown?h(doc,"span",{class:"note",dataset:{reportReqUnknown:"1"},text:ctx.t("analysisReport.reqUnknown")}):h(doc,"span",{text:r.statement??""}),
        r.acceptanceCriteria.length?h(doc,"ul",{},r.acceptanceCriteria.map(c=>h(doc,"li",{dataset:{reportCriterion:"1"},text:c}))):(r.unknown?null:h(doc,"p",{class:"note",dataset:{reportNoCriteria:"1"},text:ctx.t("analysisReport.noCriteria")}))))):h(doc,"p",{class:"note",dataset:{reportNoReqs:"1"},text:ctx.t("analysis.trace.none")})))):none("tasks"),
    model.createdTasks.length?h(doc,"p",{class:"note",dataset:{reportCreatedTasks:String(model.createdTasks.length)},text:ctx.t("analysisReport.createdTasks",{n:String(model.createdTasks.length)})}):h(doc,"p",{class:"note",dataset:{reportCreatedTasks:"0"},text:ctx.t("analysisReport.noCreatedTasks")}));
  const risks=section(doc,"risks",ctx.t("analysisReport.risks"),
    model.risks.length?list(doc,model.risks,"reportRisks",r=>h(doc,"li",{dataset:{reportRisk:r.source}},h(doc,"span",{class:"note",text:`${kindName(ctx,r.source)}: `}),r.text)):none("risks"),
    h(doc,"p",{class:"note",text:ctx.t("analysisReport.questions")}),
    model.questions.length?list(doc,model.questions,"reportQuestions",q=>h(doc,"li",{dataset:{reportQuestion:q.source}},h(doc,"span",{class:"note",text:`${ctx.t(`analysisReport.q.${q.source}`)}: `}),q.text)):none("questions"));
  return [summary,tasks,risks];
}
/** pre: journey'nin canlı pre-dev okuması (mapPredev sonucu); null olabilir. */
export function analysisReportPanel(ctx,{missionId,pre}){
  const doc=ctx.doc;
  if(reportUi.missionId!==missionId)resetAnalysisReport(missionId);
  const res=reportUi.res,model=res&&res.state==="VERIFIED"?buildReportModel(res.report):null;
  let body;
  if(reportUi.loading)body=h(doc,"p",{class:"note",role:"status",dataset:{reportView:"LOADING"},text:ctx.t("analysisReport.loading")});
  else if(!res)body=h(doc,"p",{class:"note",dataset:{reportView:"NOT_LOADED"},text:ctx.t("analysisReport.notLoaded")});
  else if(res.state==="UNAVAILABLE")body=h(doc,"p",{class:"note",role:"status",dataset:{reportView:"UNAVAILABLE"},text:ctx.t("analysisReport.unavailable")});
  else if(res.state!=="VERIFIED")body=h(doc,"p",{class:"note",role:"alert",dataset:{reportView:res.state},text:ctx.t(res.state==="OFFLINE"?"analysisReport.offline":"analysisReport.error")});
  else if(!res.report.active||!model.hasContent)body=h(doc,"p",{class:"note",dataset:{reportView:"EMPTY"},text:ctx.t("analysisReport.none")});
  else body=h(doc,"div",{dataset:{reportView:"VERIFIED"}},contentSections(ctx,model));
  return h(doc,"div",{class:"analysis-report",id:"analysis-report",role:"region","aria-label":ctx.t("analysisReport.title"),dataset:{reportMission:missionId}},
    h(doc,"h3",{text:ctx.t("analysisReport.title")}),
    h(doc,"p",{class:"note",text:ctx.t("analysisReport.lead")}),
    decisionSection(ctx,pre,model),
    h(doc,"div",{class:"btn-row"},h(doc,"button",{type:"button",class:"btn",id:"analysis-report-load",dataset:{focusKey:"analysis-report-load"},disabled:reportUi.loading,
      text:ctx.t(res?"analysisReport.reload":"analysisReport.load"),on:{click:()=>{if(!reportUi.loading)loadAnalysisReport(ctx,missionId)}}})),
    body);
}
