// //TR: Bu görünüm Görevler / Work OS alanıdır: GET /v1/missions (seçili projeye göre) gerçek mission listesini durum ve risk bilgisiyle gösterir; veri yoksa dürüst boş/çevrimdışı durum gösterilir.
import {h,panel,stateNote,emptyNote,chip,statusPill} from "../components.js";
import {formatTime} from "../model.js";

export async function render(ctx){
  const doc=ctx.doc,res=await ctx.api.missions();
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"work.empty");
  else body=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table"},
    h(doc,"caption",{class:"sr-only",text:ctx.t("work.caption")}),
    h(doc,"thead",{},h(doc,"tr",{},["work.col.title","work.col.status","work.col.risk","work.col.created"].map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
    h(doc,"tbody",{},res.items.map(m=>h(doc,"tr",{dataset:{missionId:m.missionId}},h(doc,"td",{text:m.title}),h(doc,"td",{},statusPill(ctx,m.status)),h(doc,"td",{text:m.riskLevel}),h(doc,"td",{text:formatTime(m.createdAt,ctx.i18n.lang)}))))));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.work.title")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.store.projectId?ctx.t("work.scopeProject"):ctx.t("work.scopeAll")})),
    panel(ctx,{titleKey:"work.list",id:"work-list"},body));
}
