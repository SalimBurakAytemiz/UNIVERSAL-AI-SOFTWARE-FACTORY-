// //TR: Bu görünüm AI İş Gücü alanıdır: kayıtlı roller (GET /v1/agents sayısı), hedef roller ve aktif çalışan koşular (GET /v1/cockpit) görsel olarak ayrı gösterilir, canlı koşular /v1/work-runs verisinden rol ve kalp atışı ile listelenir; "599 hedef rol kataloğu ≠ çalışan ajan" notu açıktır, tam katalog gezintisi sonraki pakettir ve 599 ajan çalışıyormuş izlenimi verilmez.
import {h,panel,chip,stateNote,emptyNote,statusPill,plannedPanel} from "../components.js";
import {formatCount,MISSING} from "../model.js";
import {liveRuns,formatDateTime} from "../work-core.js";
import {selection} from "../forms.js";

function liveRunsBody(ctx,runs){
  const doc=ctx.doc;
  if(runs.state!=="VERIFIED")return stateNote(ctx,runs.state,runs.state==="UNAVAILABLE"?"run.unavailable":undefined);
  const live=liveRuns(runs.items);
  if(!live.length)return emptyNote(ctx,"workforce.live.none");
  return h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("workforce.live.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["workforce.live.run","workforce.live.role","workforce.live.status","workforce.live.heartbeat","workforce.live.mission"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},live.map(r=>h(doc,"tr",{dataset:{runId:r.runId}},
      h(doc,"td",{class:"mono",text:r.runId}),h(doc,"td",{text:r.role??MISSING}),h(doc,"td",{},statusPill(ctx,r.status)),h(doc,"td",{text:formatDateTime(r.heartbeatAt,ctx.i18n.lang)}),
      h(doc,"td",{},r.missionId?h(doc,"button",{type:"button",class:"link-btn",id:`wf-open-${r.runId}`,dataset:{focusKey:`wf-open-${r.runId}`},on:{click:()=>{selection.missionId=r.missionId;ctx.navigate("work")}},text:ctx.t("workforce.live.open")}):MISSING))))));
}

export async function render(ctx,route){
  const doc=ctx.doc,[cockpit,agents,runs]=await Promise.all([ctx.api.cockpit(),ctx.api.agentCount(),ctx.api.workRuns()]),w=cockpit.data.workforce;
  // //TR: INT-R3 D-M1-07: kayıtlı rol = kanonik sayı (GET /v1/agents registeredRoles, yoksa cockpit kanonik sayısı); sertifikalı sayı ayrı, eski kayıt yalnız LEGACY_REFERENCE_ONLY notu olarak.
  const registered=agents.registeredRoles!==null?agents.registeredRoles:w.registeredRoles;
  const regBlock=agents.registeredRoles!==null?{state:"VERIFIED",value:agents.registeredRoles}:w;
  const legacy=agents.legacyRoles!==null?agents.legacyRoles:w.legacyRoles??null;
  const activeBlock={...w,value:w.activeWorkerRuns,state:w.activeWorkerRuns===null?"UNAVAILABLE":w.state};
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.workforce.title")}),h(doc,"p",{class:"hero-sub",text:ctx.t("area.workforce.desc")}),
    h(doc,"p",{class:"note note-catalog",role:"note",text:ctx.t("workforce.catalogNote")}),
    h(doc,"div",{class:"two-col"},
      panel(ctx,{titleKey:"workforce.registered",id:"wf-reg",className:"panel-registered"},
        h(doc,"p",{class:"kpi-value",text:formatCount(registered)}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.target",{n:w.targetRoles===null?MISSING:formatCount(w.targetRoles)})}),chip(ctx,regBlock),
        agents.certified!==null?h(doc,"p",{class:"duo-sub",dataset:{certified:String(agents.certified)},text:ctx.t("workforce.certified",{n:formatCount(agents.certified)})}):null,
        h(doc,"p",{class:"note",text:ctx.t("workforce.registrySource")}),
        legacy!==null?h(doc,"p",{class:"note",dataset:{legacyReference:"LEGACY_REFERENCE_ONLY"},text:ctx.t("workforce.registryLegacy",{n:formatCount(legacy)})}):null),
      panel(ctx,{titleKey:"workforce.active",id:"wf-act",className:"panel-active"},
        h(doc,"p",{class:"kpi-value",text:formatCount(w.activeWorkerRuns)}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.activeNote")}),chip(ctx,activeBlock))),
    panel(ctx,{titleKey:"workforce.live.title",id:"wf-live"},liveRunsBody(ctx,runs)),
    plannedPanel(ctx,route,{partial:true}));
}
