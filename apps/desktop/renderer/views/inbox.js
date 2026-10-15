// //TR: Bu görünüm Gelen Kutusu / Onaylar alanıdır: Founder kararı bekleyen işler mission + work-run verisinden türetilir (REPORTING ve AWAITING_APPROVAL koşusu = teslim kararı; FOUNDER_ATTENTION_REQUIRED), karar yalnız kullanıcı tıklamasıyla durum geçişi olarak gider (kabul = COMPLETE onaylı, ret = gerekçeli), hiçbir şey otomatik onaylanmaz; cockpit onay listesi ve legacy blocker listesi korunur.
import {h,panel,stateNote,emptyNote,chip,badge,statusPill,statusLabel} from "../components.js";
import {deriveInbox} from "../work-core.js";
import {drafts,selection,field,statusBlock} from "../forms.js";
import {performTransition,actionStatusId} from "../work-actions.js";
import {notVerifiedBadge,runNotVerified} from "../m1a.js";
import {canOfferComplete} from "../delivery-core.js";
import {completeNotOffered} from "./work.js";

function actionLabel(ctx,a){
  if(a.type==="accept")return ctx.t("inbox.action.accept");
  if(a.type==="retry")return ctx.t("inbox.action.retry",{to:statusLabel(ctx,a.to)});
  return ctx.t("inbox.action.reject",{to:statusLabel(ctx,a.to)});
}
// M1a c2: teslim kararı kartı koşunun test yürütme kanıtına göre NOT_VERIFIED rozetini gösterir; "kabul" (COMPLETE) yalnız PRODUCT_VERIFIED koşuda sunulur,
// aksi halde iki eksen ve kaynak tesliminin Proje Stüdyosu > Teslim'de olduğu açıklaması gösterilir (onay kutusu ile COMPLETE yoktur).
function decisionCard(ctx,it,run){
  const doc=ctx.doc,sid=actionStatusId(it.missionId),busy=drafts.busy[sid]===true,rid=`ib-reason-${it.missionId}`;
  const actions=it.actions.filter(a=>a.to!=="COMPLETE"||canOfferComplete(run)),hidden=actions.length!==it.actions.length;
  const buttons=actions.map(a=>h(doc,"button",{type:"button",class:`btn${a.type==="accept"?" btn-primary":""}`,id:`ib-${a.to}-${it.missionId}`,dataset:{focusKey:`ib-${a.to}-${it.missionId}`,action:a.type,to:a.to},disabled:busy,
    on:{click:()=>performTransition(ctx,{missionId:it.missionId,title:it.title,from:it.status,to:a.to,reason:drafts.reasons[it.missionId]??"",statusId:sid})},text:actionLabel(ctx,a)}));
  return h(doc,"li",{class:"card decision-card",dataset:{decision:it.kind,decisionMission:it.missionId}},
    h(doc,"h3",{text:it.title}),
    h(doc,"p",{class:"panel-meta"},statusPill(ctx,it.status),badge(ctx,it.riskLevel,"badge-risk"),h(doc,"span",{class:"mono",text:it.missionId}),it.kind==="DELIVERY_DECISION"&&runNotVerified(run)?notVerifiedBadge(ctx,"delivery"):null),
    h(doc,"p",{class:"note",text:ctx.t(it.kind==="DELIVERY_DECISION"?"inbox.kind.delivery":"inbox.kind.attention",{run:it.runId??""})}),
    field(ctx,{id:rid,labelKey:"work.transition.reason",value:drafts.reasons[it.missionId]??"",onInput:v=>{drafts.reasons[it.missionId]=v},hintKey:"inbox.reasonHint"}),
    hidden?completeNotOffered(ctx,run,`ib-complete-na-${it.missionId}`):null,
    h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("inbox.actions",{title:it.title})},buttons,
      h(doc,"button",{type:"button",class:"btn",id:`ib-open-${it.missionId}`,dataset:{focusKey:`ib-open-${it.missionId}`},on:{click:()=>{selection.missionId=it.missionId;ctx.navigate("work")}},text:ctx.t("inbox.open")})),
    statusBlock(ctx,sid));
}
function decisionsBody(ctx,missions,runs,runDetails){
  const doc=ctx.doc;
  if(missions.state!=="VERIFIED")return stateNote(ctx,missions.state);
  const items=deriveInbox(missions.items,runs.state==="VERIFIED"?runs.items:[]);
  const nodes=[];
  if(runs.state!=="VERIFIED")nodes.push(h(doc,"p",{class:`note note-${runs.state.toLowerCase()}`,role:"status",text:ctx.t("inbox.runsUnavailable")}));
  if(!items.length)nodes.push(emptyNote(ctx,"inbox.decisions.empty"));
  else nodes.push(h(doc,"ul",{class:"cards"},items.map(it=>decisionCard(ctx,it,runDetails.get(it.runId)??(runs.state==="VERIFIED"?runs.items.find(r=>r.runId===it.runId):null)??null))));
  return h(doc,"div",{},nodes);
}

export async function render(ctx){
  const doc=ctx.doc,[c,att,missions,runs]=await Promise.all([ctx.api.cockpit(),ctx.api.attention(),ctx.api.allMissions(),ctx.api.workRuns()]),a=c.data.approvals;
  let approvals;
  if(a.state==="UNAVAILABLE"||a.state==="ERROR"||c.state!=="OK")approvals=stateNote(ctx,c.state==="OK"?a.state:c.state);
  else if(!a.items.length)approvals=emptyNote(ctx,"inbox.empty");
  else approvals=h(doc,"ul",{class:"cards"},a.items.map(x=>h(doc,"li",{class:"card",dataset:{approval:x.missionId}},h(doc,"h3",{text:x.title??x.missionId}),badge(ctx,x.riskLevel??"—","badge-risk"),h(doc,"p",{class:"mono",text:x.missionId}),
    h(doc,"button",{type:"button",class:"btn",dataset:{focusKey:`ap-open-${x.missionId}`},id:`ap-open-${x.missionId}`,on:{click:()=>{selection.missionId=x.missionId;ctx.navigate("work")}},text:ctx.t("inbox.open")}))));
  const legacy=h(doc,"div",{id:"inbox-attention"});ctx.renderAttention(legacy,att);
  // M1a c2: teslim kararı bekleyen koşuların ayrıntısı (iki eksen + teslim görünümü) yalnız sunucudan okunur.
  const runDetails=new Map();
  if(missions.state==="VERIFIED"&&runs.state==="VERIFIED")await Promise.all(deriveInbox(missions.items,runs.items).filter(it=>it.runId).slice(0,10).map(async it=>{const d=await ctx.api.workRunDetail(it.runId);if(d.state==="VERIFIED"&&d.run)runDetails.set(it.runId,d.run)}));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.inbox.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("inbox.noAuto")}),
    panel(ctx,{titleKey:"inbox.decisions",id:"inbox-decisions"},decisionsBody(ctx,missions,runs,runDetails)),
    panel(ctx,{titleKey:"inbox.approvals",id:"inbox-approvals"},h(doc,"p",{class:"panel-meta"},chip(ctx,a)),approvals),
    panel(ctx,{titleKey:"inbox.legacy",id:"inbox-legacy-p"},h(doc,"p",{class:"note",text:ctx.t("inbox.legacyNote")}),legacy));
}
