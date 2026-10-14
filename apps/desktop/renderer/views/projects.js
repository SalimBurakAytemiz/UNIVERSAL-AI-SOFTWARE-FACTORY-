// //TR: Bu görünüm GET /v1/projects verisini gerçek proje listesi olarak gösterir; proje seçimi store.selectProject ile önbelleği geçersiz kılar (DSK-061-06), veri yoksa dürüst boş/çevrimdışı durum gösterilir.
import {h,panel,stateNote,emptyNote,chip} from "../components.js";
import {formatTime} from "../model.js";

export async function render(ctx){
  const doc=ctx.doc,res=await ctx.api.projects();
  let body;
  if(res.state!=="VERIFIED")body=stateNote(ctx,res.state);
  else if(!res.items.length)body=emptyNote(ctx,"projects.empty");
  else body=h(doc,"ul",{class:"cards"},res.items.map(p=>{
    const active=ctx.store.projectId===p.projectId;
    return h(doc,"li",{class:`card${active?" card-active":""}`,dataset:{projectId:p.projectId}},
      h(doc,"h3",{text:p.name}),
      h(doc,"dl",{class:"kv"},h(doc,"dt",{text:ctx.t("projects.env")}),h(doc,"dd",{text:p.environmentId??"—"}),h(doc,"dt",{text:ctx.t("projects.tenant")}),h(doc,"dd",{text:p.tenantId??"—"}),h(doc,"dt",{text:ctx.t("projects.created")}),h(doc,"dd",{text:formatTime(p.createdAt,ctx.i18n.lang)}),h(doc,"dt",{text:ctx.t("projects.id")}),h(doc,"dd",{class:"mono",text:p.projectId})),
      h(doc,"button",{type:"button",class:"btn",disabled:active,"aria-pressed":active?"true":"false",on:{click:()=>ctx.selectProject(p.projectId)},text:ctx.t(active?"projects.selected":"projects.select")}));
  }));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.projects.title")}),
    h(doc,"p",{class:"panel-meta"},chip(ctx,{state:res.state==="VERIFIED"?"VERIFIED":res.state,value:res.items?.length??null}),h(doc,"span",{text:ctx.t("projects.source")})),
    panel(ctx,{titleKey:"projects.list",id:"projects-list"},body));
}
