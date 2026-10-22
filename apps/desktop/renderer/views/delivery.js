// //TR: Bu görünüm Teslimat & SRE alanıdır (UX WP-DELIVERY): yalnız allow-list'li salt-okunur GET verisine bağlanır ve hiçbir veriyi uydurmaz. Operasyonel sağlık (GET /health, /v1/control/status, /v1/founder-attention) ve yayın hazırlığı (GET /v1/work-runs) gerçek kaynaklardan okunur; üretilen kaynağın teslim/dışa aktarımı gerçek olarak (Project Studio > Teslim köprüsü uasco.exportDelivery) belirtilir. GERÇEK ÜRETİM DEPLOY eylemleri ve CANLI SRE izleme Founder kapılıdır (gerçek-deploy yetkisi + FD-REL-1): bunlar sahte buton veya uydurma uptime/SLO metriği olarak değil, kapıyı açıkça anan BLOCKED/NOT_CONNECTED durumları olarak gösterilir. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,statusPill,stateNote,emptyNote,badge} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime,isProductVerified} from "../work-core.js";

/** Gerçek, allow-list'li okuma kaynakları (hepsi main.mjs izin listesinde zaten var; yeni yetki eklenmez). */
const SOURCES=Object.freeze(["health","control","attention","runs"]);
/** Okuma hatasının ayrık dürüst durumu (api katmanı classifyFailure ile OFFLINE/UNAVAILABLE/ERROR verir); uydurma yok. */
function failKind(state){return state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED"}
function healthKind(r){return r.state==="VERIFIED"?"VERIFIED":failKind(r.state)}
function controlKind(r){return r.state==="VERIFIED"?(r.active?"STOPPED":"VERIFIED"):failKind(r.state)}
function attentionKind(r){return r.state==="VERIFIED"?(r.blocked.length?"ATTENTION":"VERIFIED"):failKind(r.state)}
function runsKind(r){return r.state==="VERIFIED"?"VERIFIED":failKind(r.state)}

const nonEmpty=v=>typeof v==="string"&&v.length>0;
function validHealth(d){return d!==null&&typeof d==="object"&&nonEmpty(d.status)&&nonEmpty(d.system)&&nonEmpty(d.serverIdentity)}

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("delivery.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.delivery.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.delivery.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("delivery.readonly")}));
}

/** Kaynak şeridi: her gerçek okuma kaynağının ayrık durum rozeti (renk tek başına anlam taşımaz). */
function sourceStrip(ctx,kinds){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources","aria-label":ctx.t("delivery.sources")},SOURCES.map(k=>
    h(doc,"li",{dataset:{source:k,sourceState:kinds[k]}},h(doc,"span",{class:"company-src-name",text:ctx.t(`delivery.src.${k}`)}),statePill(ctx,kinds[k]))));
}

/** Operasyonel sağlık paneli: GET /health + /v1/control/status + /v1/founder-attention; yalnız gerçek durumlar, uydurma yok. */
function healthPanel(ctx,health,control,attention,kinds){
  const doc=ctx.doc;
  const healthLine=health.state==="VERIFIED"
    ?h(doc,"p",{id:"delivery-health-status",dataset:{health:"VERIFIED"}},statePill(ctx,"VERIFIED"),h(doc,"span",{class:"mono",text:`${health.data.status} · ${health.data.system} · ${health.data.serverIdentity}`}))
    :h(doc,"p",{id:"delivery-health-status",dataset:{health:kinds.health}},statePill(ctx,kinds.health),h(doc,"span",{text:ctx.t("delivery.health.unavailable")}));
  const controlLine=control.state==="VERIFIED"
    ?h(doc,"p",{id:"delivery-control-status",dataset:{control:control.active?"STOPPED":"RUNNING"}},statePill(ctx,controlKind(control)),h(doc,"span",{text:control.active?ctx.t("delivery.control.active",{reason:control.reason??MISSING}):ctx.t("delivery.control.running")}))
    :h(doc,"p",{id:"delivery-control-status",dataset:{control:kinds.control}},statePill(ctx,kinds.control),h(doc,"span",{text:ctx.t("delivery.control.unavailable")}));
  const attentionLine=attention.state==="VERIFIED"
    ?h(doc,"p",{id:"delivery-attention-status",dataset:{attention:String(attention.blocked.length)}},statePill(ctx,attentionKind(attention)),h(doc,"span",{text:attention.blocked.length?ctx.t("delivery.attention.count",{n:attention.blocked.length}):ctx.t("delivery.attention.none")}))
    :h(doc,"p",{id:"delivery-attention-status",dataset:{attention:kinds.attention}},statePill(ctx,kinds.attention),h(doc,"span",{text:ctx.t("delivery.attention.unavailable")}));
  return panel(ctx,{titleKey:"delivery.health.title",id:"delivery-health",className:"delivery-section"},
    h(doc,"p",{class:"note",text:ctx.t("delivery.health.lead")}),
    sourceStrip(ctx,kinds),
    h(doc,"div",{class:"facts delivery-health-facts"},
      h(doc,"div",{class:"fact",dataset:{fact:"health"}},h(doc,"span",{class:"fact-label",text:ctx.t("delivery.src.health")}),healthLine),
      h(doc,"div",{class:"fact",dataset:{fact:"control"}},h(doc,"span",{class:"fact-label",text:ctx.t("delivery.src.control")}),controlLine),
      h(doc,"div",{class:"fact",dataset:{fact:"attention"}},h(doc,"span",{class:"fact-label",text:ctx.t("delivery.src.attention")}),attentionLine)));
}

/** Yayın hazırlığı tablosu: GET /v1/work-runs gerçek koşuları; ürün yalnız test yürütme kanıtı varsa PRODUCT_VERIFIED, aksi halde NOT_VERIFIED (sahte COMPLETE/PASS yok). Teslim/dışa aktarım Project Studio'daki gerçek köprüdedir. */
function releasePanel(ctx,runs,kinds){
  const doc=ctx.doc;
  let body;
  if(runs.state!=="VERIFIED")body=stateNote(ctx,kinds.runs);
  else if(!runs.items.length)body=emptyNote(ctx,"delivery.release.none");
  else{
    const cols=["delivery.release.col.run","delivery.release.col.status","delivery.release.col.product","delivery.release.col.started"];
    body=h(doc,"div",{class:"table-wrap"},h(doc,"table",{class:"table",id:"delivery-runs-table",dataset:{deliveryTable:"runs"}},
      h(doc,"caption",{class:"sr-only",text:ctx.t("delivery.release.title")}),
      h(doc,"thead",{},h(doc,"tr",{},cols.map(k=>h(doc,"th",{scope:"col",text:ctx.t(k)})))),
      h(doc,"tbody",{},runs.items.slice(0,100).map(r=>{
        const verified=isProductVerified(r);
        return h(doc,"tr",{dataset:{deliveryRun:r.runId,product:verified?"PRODUCT_VERIFIED":"NOT_VERIFIED"}},
          h(doc,"td",{class:"mono",text:r.runId}),
          h(doc,"td",{},r.status&&r.status!==MISSING?statusPill(ctx,r.status):MISSING),
          h(doc,"td",{},verified?statePill(ctx,"PRODUCT_VERIFIED"):h(doc,"span",{},statePill(ctx,"NOT_VERIFIED"),badge(ctx,ctx.t("delivery.release.notVerified"),"badge-notverified"))),
          h(doc,"td",{class:"mono",text:r.startedAt?formatDateTime(r.startedAt,ctx.i18n.lang):MISSING}));
      }))));
  }
  return panel(ctx,{titleKey:"delivery.release.title",id:"delivery-release",className:"delivery-section"},
    h(doc,"p",{class:"note",text:ctx.t("delivery.release.lead")}),
    body,
    h(doc,"p",{class:"note",dataset:{note:"studio-export"},text:ctx.t("delivery.release.studioNote")}));
}

/** Gerçek üretim deploy: Founder kapılı (gerçek-deploy yetkisi). Sahte "çalışıyormuş gibi" buton YOK; yalnız BLOCKED durumu ve kapının gerekçesi. */
function deployPanel(ctx){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"delivery.deploy.title",id:"delivery-deploy",className:"delivery-section delivery-gated"},
    h(doc,"p",{class:"delivery-gate-head",dataset:{gate:"deploy",gateState:"BLOCKED"}},statePill(ctx,"BLOCKED"),h(doc,"strong",{text:ctx.t("delivery.deploy.state")})),
    h(doc,"p",{class:"note",text:ctx.t("delivery.deploy.gate")}),
    h(doc,"p",{class:"note mono",dataset:{citation:"deploy"},text:ctx.t("delivery.deploy.authority")}));
}

/** Canlı SRE izleme (uptime/SLO/olay): Founder kapılı (FD-REL-1 yürütme). Uydurma metrik YOK; yalnız NOT_CONNECTED durumu ve kapının gerekçesi. */
function srePanel(ctx){
  const doc=ctx.doc;
  return panel(ctx,{titleKey:"delivery.sre.title",id:"delivery-sre",className:"delivery-section delivery-gated"},
    h(doc,"p",{class:"delivery-gate-head",dataset:{gate:"sre",gateState:"NOT_CONNECTED"}},statePill(ctx,"NOT_CONNECTED"),h(doc,"strong",{text:ctx.t("delivery.sre.state")})),
    h(doc,"p",{class:"note",text:ctx.t("delivery.sre.gate")}),
    h(doc,"p",{class:"note mono",dataset:{citation:"sre"},text:ctx.t("delivery.sre.authority")}),
    h(doc,"p",{class:"note",dataset:{note:"no-metrics"},text:ctx.t("delivery.sre.noMetrics")}));
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  const [healthRaw,control,attention,runs]=await Promise.all([api.health(),api.control(),api.attention(),api.workRuns()]);
  // //TR: api.health() her başarılı HTTP yanıtını VERIFIED sayar; gövde beklenen biçimde değilse ("undefined · undefined" gibi) sağlıklı gösterilmez, dürüstçe FAILED olur.
  const health=healthRaw&&healthRaw.state==="VERIFIED"&&!validHealth(healthRaw.data)?{state:"ERROR",data:null,message:"HEALTH_PAYLOAD_INVALID"}:healthRaw;
  const kinds={health:healthKind(health),control:controlKind(control),attention:attentionKind(attention),runs:runsKind(runs)};
  return h(doc,"div",{class:"view view-delivery"},
    header(ctx),
    healthPanel(ctx,health,control,attention,kinds),
    releasePanel(ctx,runs,kinds),
    deployPanel(ctx),
    srePanel(ctx));
}
