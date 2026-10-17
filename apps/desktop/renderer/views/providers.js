// //TR: Bu görünüm Provider Hub'dır (FA-V2-PRODUCT, UI-074): YALNIZ iki salt-okunur ve zaten izinli GET'ten okunur — GET /v1/system/executors (yerel Claude yürütücüsü, etkin yönlendirme nedeni ve ayrı UASCO Claude profilleri) ve GET /v1/control/status (yönlendirme kapısı olarak global stop). Sağlayıcı sağlığı, yönlendirme ve GERÇEK duruma yansıyan bir bulgu listesi gösterilir. Genel durum DÜRÜSTTÜR: READY yalnız TÜM beklenen sağlayıcılar gerçek olumlu kanıt taşırken, etkin yönlendirme gerçek yerel Claude iken ve global stop doğrulanmış-pasifken görünür; okunamayan, doğrulanamayan, reddedilen ya da bilinmeyen sağlayıcı asla "hazır/bağlı" görünmez ve eksik olan adıyla listelenir. Kota, yük devri (failover), maliyet ve diğer sağlayıcılar denetim düzlemi tarafından RAPOR EDİLMEZ; bu yüzden hiçbiri gösterilmez ya da uydurulmaz. Bu ekran hiçbir şeyi bağlamaz, etkinleştirmez, sağlayıcı değiştirmez ve kimlik bilgisi okumaz; gizli bilgi (anahtar/token/kimlik deposu içeriği/profil yolu/giriş komutu) hiçbir yerde gösterilmez, yalnız varlık/yokluk gösterilir. Kişisel Claude profiline otomatik erişim ve geri düşme YOKTUR. Başarısız bir sağlayıcı bağlantısı ekranın açılmasını engellemez: her kaynak bağımsız okunur ve düşen kaynak dürüst durumunu taşır. Ürün doğrulaması bu görünümde ASLA iddia edilmez ve ilgili sabit değer hiçbir yerde üretilmez. API verisi HTML olarak yorumlanmaz; yalnız h()/textContent kullanılır.
import {h,panel,statePill,kpiTile} from "../components.js";
import {MISSING} from "../model.js";
import {formatDateTime} from "../work-core.js";
import {PROVIDER_SOURCES,PROVIDER_SOURCE_PATHS,KNOWN_REASON_CODES,buildProviders} from "../providers-core.js";

/** Okuma hatasının ayrık dürüst durumu; uydurma yok. */
const failKind=state=>state==="OFFLINE"?"OFFLINE":state==="UNAVAILABLE"?"UNAVAILABLE":"FAILED";
const stateRes=res=>res&&typeof res.state==="string"?res:{state:"UNAVAILABLE"};
const mono=(doc,t)=>t!==null&&t!==undefined&&t!==""?h(doc,"span",{class:"mono",text:String(t)}):MISSING;
/** Sağlayıcı durumu -> rozet türü (renk tek başına anlam taşımaz; her rozet metin taşır). Yalnız READY olumlu rozet alır. */
const STATUS_PILL=Object.freeze({READY:"VERIFIED",NOT_CONNECTED:"NOT_CONNECTED",NOT_VERIFIED:"NOT_VERIFIED",NOT_INSTALLED:"UNAVAILABLE",UNSUPPORTED:"UNAVAILABLE",LICENSE_REQUIRED:"DENIED",REFUSED:"BLOCKED",TEST_ONLY:"NEUTRAL",UNKNOWN:"NOT_VERIFIED"});
const SEVERITY_PILL=Object.freeze({BLOCKED:"BLOCKED",HALTED:"STOPPED",NOT_READY:"ATTENTION",UNVERIFIED:"NOT_VERIFIED"});
const TIER_PILL=Object.freeze({BLOCKED:"BLOCKED",HALTED:"STOPPED",NOT_READY:"ATTENTION",UNVERIFIED:"NOT_VERIFIED",READY:"VERIFIED"});
const MODE_PILL=Object.freeze({LOCAL_CLAUDE:"ACTIVE",TEST_ONLY:"ATTENTION",NONE:"NOT_CONNECTED",UNKNOWN:"NOT_VERIFIED",NOT_REPORTED:"NOT_VERIFIED"});

const when=(ctx,iso)=>typeof iso==="string"&&iso?formatDateTime(iso,ctx.i18n.lang):MISSING;
/** Sağlayıcı kimliğinin yerelleştirilmiş adı; bilinmeyen kimlik ham gösterilir (ad uydurulmaz). */
const nameOf=(ctx,id)=>{const k=`prov.name.${id}`,v=ctx.t(k);return v===k?String(id):v};
const reasonText=(ctx,code)=>code&&KNOWN_REASON_CODES.includes(code)?ctx.t(`prov.reason.${code}`):null;
const yesNo=(ctx,v)=>v===true?ctx.t("prov.yes"):v===false?ctx.t("prov.no"):MISSING;

function header(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"hero"},
    h(doc,"p",{class:"hero-eyebrow",text:ctx.t("prov.eyebrow")}),
    h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.providers.title")}),
    h(doc,"p",{class:"hero-sub",text:ctx.t("area.providers.desc")}),
    h(doc,"p",{class:"hero-hint",dataset:{readonly:"1"},text:ctx.t("prov.readonly")}),
    // Dürüstlük uyarısı: durum yalnız bildirilen kayıttan türer; canlı bağlantı/kota yoklaması ve ürün doğrulaması değildir.
    h(doc,"p",{class:"hero-hint",dataset:{honesty:"1"},role:"note",text:ctx.t("prov.honesty")}));
}
function stateBlock(ctx,state,source){
  const doc=ctx.doc;
  return h(doc,"div",{class:`prov-state state-${state.toLowerCase()}`,role:"status",dataset:{provState:state,source}},
    h(doc,"p",{class:"prov-state-head"},statePill(ctx,failKind(state)),h(doc,"strong",{text:ctx.t(`prov.state.${state}`)})),
    h(doc,"p",{class:"note",text:ctx.t(`prov.hint.${state}`,{source:`GET ${PROVIDER_SOURCE_PATHS[source]}`})}));
}
function sourcesList(ctx,a){
  const doc=ctx.doc;
  return h(doc,"ul",{class:"company-sources prov-sources","aria-label":ctx.t("prov.sources.aria")},PROVIDER_SOURCES.map(k=>{
    const st=a.sources[k].state,okState=st==="VERIFIED";
    return h(doc,"li",{dataset:{source:k,sourceState:st}},
      h(doc,"span",{class:"company-src-name",text:ctx.t(`prov.src.${k}`)}),
      statePill(ctx,okState?"VERIFIED":failKind(st),{label:okState?ctx.t("prov.src.ok"):undefined}));
  }));
}

// ---------- (A) Özet ----------
function overallBlock(ctx,a){
  const doc=ctx.doc,kind=a.tier==="UNKNOWN"?failKind(a.unknownState):TIER_PILL[a.tier];
  return h(doc,"p",{class:"prov-overall panel-meta",dataset:{overall:a.tier}},
    statePill(ctx,kind,{label:ctx.t(`prov.tier.${a.tier}`)}),
    h(doc,"span",{class:"note",text:ctx.t(`prov.tierDesc.${a.tier}`)}));
}
function kpiRow(ctx,a){
  const doc=ctx.doc,src=a.sources,C=a.counts;
  // Her sayı yalnız yürütücü kaynağı okunduysa gösterilir; aksi halde değer null ("—") ve rozet dürüst durumdur (asla 0).
  const blockOf=value=>({state:src.executors.state,value:src.executors.state==="VERIFIED"?value:null,loading:false,source:`GET ${PROVIDER_SOURCE_PATHS.executors}`,asOf:null});
  const tile=(id,iconName,value,extra={})=>kpiTile(ctx,{id:`prov-${id}`,iconName,labelKey:`prov.kpi.${id}`,block:blockOf(value),qualifier:ctx.t(`prov.kpi.q.${id}`),...extra});
  const notReady=C===null?null:C.notReady+C.refused;
  return h(doc,"div",{class:"kpi-row prov-kpis",role:"group","aria-label":ctx.t("prov.kpi.group")},
    tile("total","plug",C?C.total:null),
    tile("ready","check",C?C.ready:null),
    tile("notReady","alert",notReady,notReady>0?{pillKind:"ATTENTION",risk:true}:{}),
    tile("unverified","help",C?C.unverified:null,C&&C.unverified>0?{pillKind:"NOT_VERIFIED"}:{}));
}
function summaryPanel(ctx,a){
  const doc=ctx.doc,c=a.bySeverity;
  const failures=PROVIDER_SOURCES.filter(k=>a.sources[k].state!=="VERIFIED").map(k=>stateBlock(ctx,a.sources[k].state,k));
  return panel(ctx,{titleKey:"prov.summary.title",id:"prov-summary",className:"prov-section"},
    h(doc,"p",{class:"note",text:ctx.t("prov.summary.lead")}),
    h(doc,"h3",{class:"prov-sub",text:ctx.t("prov.sources.title")}),
    sourcesList(ctx,a),
    failures,
    a.unreadable.length?h(doc,"p",{class:"note",role:"status",dataset:{provPartial:a.unreadable.join(",")},text:ctx.t("prov.partial",{sources:a.unreadable.map(k=>ctx.t(`prov.srcShort.${k}`)).join(", ")})}):null,
    h(doc,"h3",{class:"prov-sub",text:ctx.t("prov.overall.title")}),
    overallBlock(ctx,a),
    h(doc,"p",{class:"note",dataset:{note:"finding-counts"},text:ctx.t("prov.counts",{blocked:c.BLOCKED,halted:c.HALTED,unknown:c.UNKNOWN,notReady:c.NOT_READY,unverified:c.UNVERIFIED})}),
    h(doc,"p",{class:"note",dataset:{note:"not-live-probe"},text:ctx.t("prov.notProbe")}),
    h(doc,"p",{class:"note",dataset:{note:"not-product-verification"},text:ctx.t("prov.notProduct")}),
    h(doc,"h3",{class:"prov-sub",text:ctx.t("prov.kpi.title")}),
    kpiRow(ctx,a));
}

// ---------- (B) Bulgu listesi ----------
/** Bulgu başlık/ayrıntı metinleri: tüm yer tutucular tek kümeden verilir (kullanılmayan yer tutucu yok sayılır); eksik değer "—". */
function findingVars(ctx,f){
  const p=f.params,t=ctx.t;
  return {provider:p.providerId?nameOf(ctx,p.providerId):MISSING,serverState:p.serverState??MISSING,reason:p.reason??MISSING,
    source:p.source?t(`prov.srcShort.${p.source}`):MISSING,state:p.state?t(`prov.state.${p.state}`):MISSING};
}
function findingCard(ctx,a,f,idx){
  const doc=ctx.doc,vars=findingVars(ctx,f);
  const kind=f.severity==="UNKNOWN"?failKind(a.sources[f.params.source]?.state):SEVERITY_PILL[f.severity];
  return h(doc,"li",{class:"card prov-finding",dataset:{finding:f.id,findingSeverity:f.severity,findingKey:f.key,findingIndex:String(idx)}},
    h(doc,"h3",{text:ctx.t(`prov.finding.${f.id}.title`,vars)}),
    h(doc,"p",{class:"prov-finding-head panel-meta"},statePill(ctx,kind,{label:ctx.t(`prov.severity.${f.severity}`)})),
    h(doc,"p",{class:"note",dataset:{field:"detail"},text:ctx.t(`prov.finding.${f.id}.detail`,vars)}),
    f.route?h(doc,"p",{class:"note",dataset:{field:"where"},text:ctx.t(`prov.where.${f.route}`)}):null);
}
function findingsPanel(ctx,a){
  const doc=ctx.doc;
  let body;
  if(!a.findings.length)body=h(doc,"p",{class:"note",role:"status",dataset:{provEmpty:a.tier==="READY"?"ready":"unverified"},text:ctx.t(a.tier==="READY"?"prov.findings.none":"prov.findings.noneUnverified")});
  else body=h(doc,"ol",{class:"cards prov-list prov-findings","aria-label":ctx.t("prov.findings.aria"),dataset:{provFindings:String(a.findings.length)}},a.findings.map((f,i)=>findingCard(ctx,a,f,i)));
  return panel(ctx,{titleKey:"prov.findings.title",id:"prov-findings",className:"prov-section"},
    h(doc,"p",{class:"note",text:ctx.t("prov.findings.lead")}),
    body);
}

// ---------- (C) Sağlayıcılar ----------
function factRows(ctx,rows){
  const doc=ctx.doc;
  return h(doc,"dl",{class:"prov-facts"},rows.flatMap(([key,label,attrs,...dd])=>[h(doc,"dt",{text:label}),h(doc,"dd",{dataset:{field:key,...attrs}},...dd)]));
}
function providerCard(ctx,p){
  const doc=ctx.doc,t=ctx.t;
  const rows=[["kind",t("prov.field.kind"),{},t(`prov.kind.${p.kind}`)],
    ["serverState",t("prov.field.serverState"),{value:p.serverState??""},mono(doc,p.serverState)]];
  if(p.reason)rows.push(["reason",t("prov.field.reason"),{value:p.reason},mono(doc,p.reason),reasonText(ctx,p.reason)?[" · ",reasonText(ctx,p.reason)]:null]);
  if(p.kind==="EXECUTOR"){
    rows.push(["enabled",t("prov.field.enabled"),{value:p.enabled===null?"":String(p.enabled)},yesNo(ctx,p.enabled)]);
    rows.push(["source",t("prov.field.source"),{value:p.source??""},mono(doc,p.source)]);
    rows.push(["version",t("prov.field.version"),{},mono(doc,p.version)]);
    rows.push(["captured",t("prov.field.captured"),{},p.capturedAt?h(doc,"time",{datetime:p.capturedAt,text:when(ctx,p.capturedAt)}):MISSING]);
  }else if(p.kind==="PROFILE"){
    // Yalnız varlık/yokluk gösterilir; kimlik deposunun içeriği asla okunmaz ve gösterilmez.
    rows.push(["credential",t("prov.field.credential"),{value:p.credentialStore??""},p.credentialStore?t(`prov.credential.${p.credentialStore}`):MISSING]);
    rows.push(["settings",t("prov.field.settings"),{value:p.settings??""},p.settings?t(`prov.settings.${p.settings}`):MISSING]);
  }
  return h(doc,"li",{class:"card prov-item",dataset:{provider:p.id,providerStatus:p.status,providerKind:p.kind,positive:p.positive?"1":"0"}},
    h(doc,"h3",{text:nameOf(ctx,p.id)}),
    h(doc,"p",{class:"prov-item-head panel-meta"},statePill(ctx,STATUS_PILL[p.status]??"NOT_VERIFIED",{label:t(`prov.status.${p.status}`)})),
    factRows(ctx,rows),
    h(doc,"p",{class:"note",dataset:{field:"next"},text:t(`prov.next.${p.status}`)}));
}
function withheld(ctx,source,state){
  return h(ctx.doc,"p",{class:"note",role:"status",dataset:{withheld:"1",reason:state,source},text:ctx.t("prov.withheld",{source:`GET ${PROVIDER_SOURCE_PATHS[source]}`,reason:ctx.t(`prov.why.${state}`)})});
}
function providersPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t;
  let body;
  if(a.providers===null)body=[withheld(ctx,"executors",a.sources.executors.state),h(doc,"p",{class:"note",role:"status",dataset:{provEmpty:"unknown"},text:t("prov.providers.unknown")})];
  else body=[
    h(doc,"ul",{class:"cards prov-list prov-providers","aria-label":t("prov.providers.aria"),dataset:{provProviders:String(a.providers.length)}},a.providers.map(p=>providerCard(ctx,p))),
    a.testOnly.length?h(doc,"h3",{class:"prov-sub",text:t("prov.test.title")}):null,
    a.testOnly.length?h(doc,"p",{class:"note",dataset:{note:"test-only"},text:t("prov.test.lead")}):null,
    a.testOnly.length?h(doc,"ul",{class:"cards prov-list prov-test","aria-label":t("prov.test.aria"),dataset:{provTest:String(a.testOnly.length)}},a.testOnly.map(p=>providerCard(ctx,p))):null];
  return panel(ctx,{titleKey:"prov.providers.title",id:"prov-providers",className:"prov-section"},
    h(doc,"p",{class:"note",text:t("prov.providers.lead")}),
    body,
    h(doc,"p",{class:"note",dataset:{note:"unreported"},text:t("prov.providers.unreported")}));
}

// ---------- (D) Yönlendirme ----------
function routingPanel(ctx,a){
  const doc=ctx.doc,t=ctx.t,R=a.routing,G=a.gate;
  const route=R===null?withheld(ctx,"executors",a.sources.executors.state)
    :factRows(ctx,[["route",t("prov.field.route"),{value:R.mode},statePill(ctx,MODE_PILL[R.mode],{label:t(`prov.route.${R.mode}`)})," ",mono(doc,R.reason)]]);
  const gate=G===null?withheld(ctx,"control",a.sources.control.state)
    :factRows(ctx,[["gate",t("prov.field.gate"),{value:G.state==="ACTIVE"?(G.failClosed?"failClosed":"active"):"inactive"},
      statePill(ctx,G.state==="ACTIVE"?"STOPPED":"VERIFIED",{label:t(G.state==="ACTIVE"?(G.failClosed?"prov.gate.failClosed":"prov.gate.active"):"prov.gate.inactive")})]]);
  return panel(ctx,{titleKey:"prov.routing.title",id:"prov-routing",className:"prov-section"},
    h(doc,"p",{class:"note",text:t("prov.routing.lead")}),
    h(doc,"h3",{class:"prov-sub",text:t("prov.routing.route")}),
    route,
    R?h(doc,"p",{class:"note",dataset:{note:"route-explain"},text:t(`prov.route.explain.${R.mode}`)}):null,
    h(doc,"h3",{class:"prov-sub",text:t("prov.routing.gate")}),
    gate,
    h(doc,"p",{class:"note",dataset:{note:"gate-explain"},text:t("prov.gate.explain")}),
    // Kota/yük devri/maliyet/diğer sağlayıcılar rapor edilmez: dürüst "raporlanmadı" notu (sayı/sıra uydurulmaz).
    h(doc,"h3",{class:"prov-sub",text:t("prov.unreported.title")}),
    h(doc,"p",{class:"prov-unreported panel-meta",dataset:{unreported:"1"}},statePill(ctx,"UNAVAILABLE",{label:t("prov.unreported.pill")}),h(doc,"span",{class:"note",text:t("prov.unreported.body")})));
}

// ---------- (E) Sınırlar ----------
function boundaryPanel(ctx){
  const doc=ctx.doc,t=ctx.t;
  const btn=(route,key)=>h(doc,"button",{type:"button",class:"btn",id:`prov-open-${route}`,dataset:{focusKey:`prov-open-${route}`,navigate:route},on:{click:()=>ctx.navigate(route)},text:t(key)});
  return panel(ctx,{titleKey:"prov.boundary.title",id:"prov-boundary",className:"prov-section"},
    h(doc,"ul",{class:"prov-boundary-list","aria-label":t("prov.boundary.aria")},
      ["noAction","noSecrets","noPersonal","noBlock"].map(k=>h(doc,"li",{dataset:{boundary:k},text:t(`prov.boundary.${k}`)}))),
    h(doc,"div",{class:"btn-row",role:"group","aria-label":t("prov.actions.aria")},btn("settings","prov.action.settings"),btn("operations","prov.action.operations"),btn("tower","prov.action.tower")));
}

export async function render(ctx){
  const doc=ctx.doc,api=ctx.api;
  // Her kaynak bağımsız okunur; biri düşerse (başarısız sağlayıcı bağlantısı dahil) diğerleri ve ekranın kendisi etkilenmez, düşen kaynak dürüst durumunu taşır (uydurma yok).
  const read=(fn,empty)=>Promise.resolve().then(fn).then(stateRes,()=>({state:"ERROR",...empty}));
  const [executors,control]=await Promise.all([
    read(()=>api.providersExecutors(),{providers:null}),
    read(()=>api.operationsControl(),{control:null})
  ]);
  let a;
  try{a=buildProviders({executors,control})}
  catch{a=buildProviders({executors:{state:"ERROR"},control:{state:"ERROR"}})}
  return h(doc,"div",{class:"view view-providers"},header(ctx),summaryPanel(ctx,a),findingsPanel(ctx,a),providersPanel(ctx,a),routingPanel(ctx,a),boundaryPanel(ctx));
}
