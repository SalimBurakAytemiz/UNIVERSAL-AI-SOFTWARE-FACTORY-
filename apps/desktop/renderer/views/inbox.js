// //TR: Bu görünüm Gelen Kutusu / Onaylar alanıdır (UX WP-INBOX-APPROVAL): Founder kararı bekleyen işler yalnız gerçek, allow-list'li okumalardan türetilir ve hiçbir veri uydurulmaz. Üç gerçek kaynak birleştirilir: (1) teslim/dikkat kararları mission + work-run verisinden (REPORTING + AWAITING_APPROVAL koşusu = teslim kararı; FOUNDER_ATTENTION_REQUIRED), karar yalnız kullanıcı tıklamasıyla ve yüksek riskli/geri alınamaz geçişte açık onay penceresiyle durum geçişi olarak gider (performTransition; kabul = COMPLETE yalnız PRODUCT_VERIFIED koşuda sunulur, ret gerekçeli), hiçbir şey otomatik onaylanmaz ve bu görünüm doğrudan POST yapmaz; (2) onay bekleyen mission listesi GET /v1/cockpit awaitingApproval bloğundan; (3) Founder dikkati kuyruğu GET /v1/founder-attention'dan (salt-okunur, paket/faz/engel türü/gerekçe/zaman/teknik-yeniden-deneme bağlamıyla) okunur. Uyarılar/bildirimler yalnız cockpit alerts bloğundan ve ACİL DURDUR durumundan gelir; sayı yoksa "—" ve ayrık dürüst durum (EMPTY/UNAVAILABLE/OFFLINE/FAILED) gösterilir. Legacy blocker listesi (yeniden deneme eylemiyle) değişmeden korunur. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,stateNote,emptyNote,chip,badge,statusPill,statusLabel} from "../components.js";
import {deriveInbox,formatDateTime} from "../work-core.js";
import {formatCount,MISSING} from "../model.js";
import {drafts,selection,field,statusBlock} from "../forms.js";
import {performTransition,actionStatusId} from "../work-actions.js";
import {notVerifiedBadge,runNotVerified} from "../m1a.js";
import {canOfferComplete} from "../delivery-core.js";
import {completeNotOffered} from "./work.js";

// //TR: Metin alanlarını güvenli biçimde sınırlar (API verisi asla sayı/HTML'e dönüştürülmez; boş/geçersiz => null, görünüm "—" veya dürüst durum gösterir).
const str=(v,max=300)=>typeof v==="string"&&v.length?v.slice(0,max):null;
// //TR: Okuma hatasının ayrık dürüst durumu (api katmanı classifyFailure ile OFFLINE/UNAVAILABLE/ERROR verir); uydurma yok.
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
// //TR: Founder dikkati kuyruğunun ayrık durumu: canlı ve dolu => ATTENTION, canlı ve boş => VERIFIED, aksi halde dürüst hata durumu.
function attentionKind(att){return att.state==="VERIFIED"?(att.blocked.length?"ATTENTION":"VERIFIED"):failKind(att.state)}
// //TR: Karar kuyruğunun durumu mission + koşu okumasından türetilir; okuma başarısızsa dürüst hata durumu, boşsa VERIFIED, bekleyen karar varsa WAITING.
function decisionsKind(missions,runs){
  if(missions.state!=="VERIFIED")return failKind(missions.state);
  return deriveInbox(missions.items,runs.state==="VERIFIED"?runs.items:[]).length?"WAITING":"VERIFIED";
}
// //TR: Onay bekleyen mission kuyruğunun durumu cockpit awaitingApproval bloğundan; canlı ve dolu => WAITING, canlı ve boş => VERIFIED.
function approvalsKind(c,a){
  if(c.state!=="OK")return failKind(c.state);
  return a.state==="VERIFIED"||a.state==="STALE"?(a.items.length?"WAITING":"VERIFIED"):failKind(a.state);
}
// //TR: Uyarı kuyruğunun durumu cockpit alerts bloğundan; canlı ve >0 => ATTENTION, canlı ve 0 => VERIFIED. Sayı yalnız geçerli tamsayıysa alınır.
function alertsKind(c){
  if(c.state!=="OK")return failKind(c.state);
  const al=c.data.alerts;
  return al.state==="VERIFIED"||al.state==="STALE"?(Number.isSafeInteger(al.value)&&al.value>0?"ATTENTION":"VERIFIED"):failKind(al.state);
}

function actionLabel(ctx,a){
  if(a.type==="accept")return ctx.t("inbox.action.accept");
  if(a.type==="retry")return ctx.t("inbox.action.retry",{to:statusLabel(ctx,a.to)});
  return ctx.t("inbox.action.reject",{to:statusLabel(ctx,a.to)});
}
// M1a c2: teslim kararı kartı koşunun test yürütme kanıtına göre NOT_VERIFIED rozetini gösterir; "kabul" (COMPLETE) yalnız PRODUCT_VERIFIED koşuda sunulur,
// aksi halde iki eksen ve kaynak tesliminin Proje Stüdyosu > Teslim'de olduğu açıklaması gösterilir (onay kutusu ile COMPLETE yoktur).
// //TR: UX WP-INBOX-APPROVAL: yüksek riskli/geri alınamaz onay (COMPLETE) performTransition içinde açık onay penceresi gerektirir; bu görünüm doğrudan POST yapmaz, yalnız tıklama işleyicisi performTransition'ı çağırır.
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

// //TR: Premium başlık (hero): alan rozeti + başlık + "hiçbir şey otomatik onaylanmaz" ilkesi + kuyruğun yalnız gerçek arka uçlardan türetildiği ipucu.
function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("inbox.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.inbox.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("inbox.noAuto")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("inbox.readonly")}));
}
// //TR: Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz; ikon+metin).
const SOURCES=Object.freeze(["decisions","approvals","attention","alerts"]);
function sourceStrip(ctx,kinds){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources","aria-label":ctx.t("inbox.sources")},SOURCES.map(k=>
    h(doc,"li",{dataset:{source:k,sourceState:kinds[k]}},h(doc,"span",{class:"company-src-name",text:ctx.t(`inbox.src.${k}`)}),statePill(ctx,kinds[k]))));
}
// //TR: Tek gerçek (fact) kutusu: etiket + (düğüm ya da metin) değer; değer yoksa "—".
function factRow(ctx,key,labelKey,value){
  const doc=ctx.doc;
  return h(doc,"div",{class:"fact",dataset:{fact:key}},h(doc,"span",{class:"fact-label",text:ctx.t(labelKey)}),
    h(doc,"p",{},typeof value==="string"?value:value??MISSING));
}
// //TR: Uyarılar/bildirimler paneli: yalnız cockpit alerts bloğu + ACİL DURDUR durumu. Sayılar yalnız canlı (VERIFIED/STALE) blokta ve geçerli tamsayıysa gösterilir; aksi halde "—" ve dürüst durum. Uydurma yok.
function alertsPanel(ctx,c){
  const doc=ctx.doc,kind=alertsKind(c);
  let body;
  if(c.state!=="OK")body=h(doc,"p",{id:"inbox-alerts-status",dataset:{alerts:kind},role:"status"},statePill(ctx,kind),h(doc,"span",{text:ctx.t("inbox.alerts.unavailable")}));
  else{
    const al=c.data.alerts,gs=c.data.globalStop,live=al.state==="VERIFIED"||al.state==="STALE",det=al.detail??{};
    const summary=h(doc,"p",{id:"inbox-alerts-status",class:"panel-meta",dataset:{alerts:kind,alertsTotal:live&&Number.isSafeInteger(al.value)?String(al.value):MISSING},role:"status"},
      statePill(ctx,kind),h(doc,"span",{text:live?(Number.isSafeInteger(al.value)&&al.value>0?ctx.t("inbox.alerts.count",{n:al.value}):ctx.t("inbox.alerts.none")):ctx.t("inbox.alerts.unavailable")}));
    const stopText=gs.known?(gs.active?ctx.t("inbox.alerts.stopActive",{reason:gs.reason??MISSING}):ctx.t("inbox.alerts.stopInactive")):MISSING;
    body=h(doc,"div",{},summary,
      live?h(doc,"div",{class:"facts"},
        factRow(ctx,"blocked","inbox.alerts.blocked",formatCount(det.blockedMissions)),
        factRow(ctx,"attention","inbox.alerts.attention",formatCount(det.attentionMissions)),
        factRow(ctx,"stop","inbox.alerts.stop",gs.known?h(doc,"span",{},statePill(ctx,gs.active?"STOPPED":"VERIFIED"),h(doc,"span",{text:` ${stopText}`})):MISSING)):null);
  }
  return panel(ctx,{titleKey:"inbox.alerts",id:"inbox-alerts",className:"inbox-section"},
    h(doc,"p",{class:"note",text:ctx.t("inbox.alerts.lead")}),body);
}
// //TR: Founder dikkati kuyruğu öğesi (SALT-OKUNUR premium kart): paket/faz + engel türü (ATTENTION rozeti + ham tür etiketi) + teknik yeniden-deneme bağlamı (rozet) + gerekçe + zaman. Hiçbir yazma denetimi yoktur; yeniden deneme eylemi yalnız aşağıdaki legacy panelde korunur.
function attentionItem(ctx,x){
  const doc=ctx.doc;
  const pkg=str(x.packageId),phase=x.phase===0||typeof x.phase==="number"?String(x.phase):str(x.phase),kind=str(x.kind),reason=str(x.reason,1000),at=str(x.at),retryable=x.retryable===true;
  const heading=pkg??(phase!=null?ctx.t("attention.phase",{n:phase}):ctx.t("inbox.attention.item.unknown"));
  return h(doc,"li",{class:"card",dataset:{attentionItem:pkg??(phase!=null?`phase-${phase}`:"item"),retryable:retryable?"1":"0"}},
    h(doc,"h3",{text:heading}),
    h(doc,"p",{class:"panel-meta"},
      kind?statePill(ctx,"ATTENTION",{label:kind}):statePill(ctx,"ATTENTION"),
      badge(ctx,retryable?ctx.t("inbox.attention.retryable"):ctx.t("inbox.attention.notRetryable"),retryable?"":"badge-risk"),
      pkg&&phase!=null?h(doc,"span",{class:"mono",text:ctx.t("inbox.attention.item.phase",{phase})}):null),
    reason?h(doc,"p",{class:"note",text:ctx.t("inbox.attention.item.reason",{reason})}):null,
    at?h(doc,"p",{class:"note mono",text:ctx.t("inbox.attention.item.when",{when:formatDateTime(at,ctx.i18n.lang)})}):null);
}
// //TR: Founder dikkati kuyruğu paneli: GET /v1/founder-attention'dan SALT-OKUNUR; dürüst boş/UNAVAILABLE/OFFLINE/FAILED durumları, uydurma yok.
function attentionPanel(ctx,att){
  const doc=ctx.doc;
  let body;
  if(att.state!=="VERIFIED")body=stateNote(ctx,failKind(att.state),"inbox.attention.unavailable");
  else if(!att.blocked.length)body=emptyNote(ctx,"inbox.attention.none");
  else body=h(doc,"div",{},
    h(doc,"p",{class:"panel-meta",dataset:{attentionCount:String(att.blocked.length)},role:"status"},statePill(ctx,"ATTENTION"),h(doc,"span",{text:ctx.t("inbox.attention.count",{n:att.blocked.length})})),
    h(doc,"ul",{class:"cards"},att.blocked.slice(0,100).map(x=>attentionItem(ctx,x))));
  return panel(ctx,{titleKey:"inbox.attention",id:"inbox-attention-queue",className:"inbox-section"},
    h(doc,"p",{class:"note",text:ctx.t("inbox.attention.lead")}),body);
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
  const kinds={decisions:decisionsKind(missions,runs),approvals:approvalsKind(c,a),attention:attentionKind(att),alerts:alertsKind(c)};
  return h(doc,"div",{class:"view view-inbox"},
    header(ctx),
    sourceStrip(ctx,kinds),
    alertsPanel(ctx,c),
    panel(ctx,{titleKey:"inbox.decisions",id:"inbox-decisions",className:"inbox-section"},decisionsBody(ctx,missions,runs,runDetails)),
    panel(ctx,{titleKey:"inbox.approvals",id:"inbox-approvals",className:"inbox-section"},h(doc,"p",{class:"panel-meta"},chip(ctx,a)),approvals),
    attentionPanel(ctx,att),
    panel(ctx,{titleKey:"inbox.legacy",id:"inbox-legacy-p",className:"inbox-section"},h(doc,"p",{class:"note",text:ctx.t("inbox.legacyNote")}),legacy));
}
