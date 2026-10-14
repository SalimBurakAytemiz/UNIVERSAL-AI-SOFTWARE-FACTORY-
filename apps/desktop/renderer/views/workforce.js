// //TR: Bu görünüm AI İş Gücü alanıdır: kayıtlı roller (katalog/registry) ile aktif çalışan koşuları görsel olarak ayrı gösterilir; aktif çalışan sayısı mission runner (B3) gelene kadar "—" kalır ve 599 ajan çalışıyormuş izlenimi verilmez.
import {h,panel,chip,plannedPanel} from "../components.js";
import {formatCount,MISSING} from "../model.js";

export async function render(ctx,route){
  const doc=ctx.doc,[cockpit,agents]=await Promise.all([ctx.api.cockpit(),ctx.api.raw("/v1/agents")]),w=cockpit.data.workforce;
  const legacyCount=agents.ok&&Number.isSafeInteger(agents.data?.count)&&agents.data.count>=0?agents.data.count:null;
  const activeBlock={...w,value:w.activeWorkerRuns,state:w.activeWorkerRuns===null?"UNAVAILABLE":w.state};
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.workforce.title")}),h(doc,"p",{class:"hero-sub",text:ctx.t("area.workforce.desc")}),
    h(doc,"div",{class:"two-col"},
      panel(ctx,{titleKey:"workforce.registered",id:"wf-reg",className:"panel-registered"},
        h(doc,"p",{class:"kpi-value",text:formatCount(w.registeredRoles)}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.target",{n:w.targetRoles===null?MISSING:formatCount(w.targetRoles)})}),chip(ctx,w),
        h(doc,"p",{class:"note",text:ctx.t("workforce.registryLegacy",{n:formatCount(legacyCount)})})),
      panel(ctx,{titleKey:"workforce.active",id:"wf-act",className:"panel-active"},
        h(doc,"p",{class:"kpi-value",text:formatCount(w.activeWorkerRuns)}),h(doc,"p",{class:"duo-sub",text:ctx.t("workforce.activeNote")}),chip(ctx,activeBlock))),
    plannedPanel(ctx,route,{partial:true}));
}
