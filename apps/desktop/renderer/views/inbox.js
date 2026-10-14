// //TR: Bu görünüm Gelen Kutusu / Onaylar alanıdır: onay bekleyen mission'lar GET /v1/cockpit'ten, legacy blocker listesi (retry yetkisi sunucudan) mevcut founder-attention'dan gösterilir; onay verme eylemleri henüz uygulanmadığı için dürüstçe planlı paket olarak belirtilir.
import {h,panel,stateNote,emptyNote,chip,badge,plannedPanel} from "../components.js";

export async function render(ctx,route){
  const doc=ctx.doc,[c,att]=await Promise.all([ctx.api.cockpit(),ctx.api.attention()]),a=c.data.approvals;
  let approvals;
  if(a.state==="UNAVAILABLE"||a.state==="ERROR"||c.state!=="OK")approvals=stateNote(ctx,c.state==="OK"?a.state:c.state);
  else if(!a.items.length)approvals=emptyNote(ctx,"inbox.empty");
  else approvals=h(doc,"ul",{class:"cards"},a.items.map(x=>h(doc,"li",{class:"card",dataset:{missionId:x.missionId}},h(doc,"h3",{text:x.title??x.missionId}),badge(ctx,x.riskLevel??"—","badge-risk"),h(doc,"p",{class:"mono",text:x.missionId}))));
  const legacy=h(doc,"div",{id:"inbox-attention"});ctx.renderAttention(legacy,att);
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.inbox.title")}),
    panel(ctx,{titleKey:"inbox.approvals",id:"inbox-approvals"},h(doc,"p",{class:"panel-meta"},chip(ctx,a)),approvals),
    panel(ctx,{titleKey:"inbox.legacy",id:"inbox-legacy-p"},h(doc,"p",{class:"note",text:ctx.t("inbox.legacyNote")}),legacy),
    plannedPanel(ctx,route,{partial:true}));
}
