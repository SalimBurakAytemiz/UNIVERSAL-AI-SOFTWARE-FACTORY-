// //TR: Bu görünüm Ayarlar alanıdır (UX WP-SETTINGS): referans-sınıf premium, yalnız gerçek veriye bağlı dürüst bölümler — (1) Claude bağlantı durumu (iki ayrı UASCO profili: uygulayıcı + salt-okunur denetçi; CONNECTED yalnız gerçek giriş sinyalinden, K-1; aksi NOT_CONNECTED/NOT_VERIFIED), (2) Otonomi/yönetişim politikası SALT-OKUNUR gösterimi (Global Stop otonomi anahtarı ve fail-closed yürütme kapısı gerçek sinyallerden; korumalı politika Founder yönetiminde, burada DÜZENLENEMEZ), (3) Uygulama/sürüm + güvenlik duruşu (imzasız geliştirme yapısı, fail-closed kapı). Ayrıca mevcut dil/kısayol/AI yürütücüleri/yerel kimlik panelleri korunur. WP2 token/bileşenleri yeniden kullanılır; yalnız h()/textContent; durum/politika değeri asla uydurulmaz; hiçbir korumalı/yönetilen dosyayı yazan kontrol yoktur.
import {h,panel,stateNote,emptyNote,badge,statePill} from "../components.js";
import {LANGS} from "../i18n.js";
import {executorsPanel} from "./executors-panel.js";

const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
// //TR: Bağlantı durumu türetimi (SBX-8 profil durumundan): yalnız READY gerçek giriş sinyalidir -> CONNECTED (K-1); LOGIN_REQUIRED/REFUSED -> NOT_CONNECTED; bilinmeyen/eksik -> NOT_VERIFIED. Asla gerçek giriş sinyali olmadan CONNECTED gösterilmez.
export const CLAUDE_CONN=Object.freeze({CONNECTED:"CONNECTED",NOT_CONNECTED:"NOT_CONNECTED",NOT_VERIFIED:"NOT_VERIFIED"});
export function claudeConnectionState(profile){
  if(!isObj(profile))return CLAUDE_CONN.NOT_VERIFIED;
  if(profile.state==="READY")return CLAUDE_CONN.CONNECTED;
  if(profile.state==="LOGIN_REQUIRED"||profile.state==="REFUSED")return CLAUDE_CONN.NOT_CONNECTED;
  return CLAUDE_CONN.NOT_VERIFIED;
}
// //TR: Bağlantı durumuna göre ayrık durum rozeti türü; CONNECTED için olumlu (VERIFIED) rozet + özel etiket, diğerleri kendi rozetleri (yeni token yok).
const connPillKind=conn=>conn===CLAUDE_CONN.CONNECTED?"VERIFIED":conn;

function connectionCard(ctx,p){
  const doc=ctx.doc,conn=claudeConnectionState(p);
  const label=conn===CLAUDE_CONN.CONNECTED?ctx.t("settings.conn.CONNECTED"):ctx.t(`pill.${conn}`);
  const roleKey=`exec.profile.role.${p.role}`,roleName=ctx.t(roleKey)===roleKey?p.role:ctx.t(roleKey);
  const stKey=`exec.profile.state.${p.state}`,stText=p.state&&ctx.t(stKey)!==stKey?ctx.t(stKey):(p.state??ctx.t("exec.state.UNKNOWN"));
  const hintKey=`exec.profile.hint.${p.state}`,hint=p.state&&ctx.t(hintKey)!==hintKey?ctx.t(hintKey):null;
  return h(doc,"li",{class:"card",dataset:{connProfile:p.role,conn,state:p.state??"UNKNOWN"}},
    h(doc,"h3",{text:roleName}),
    h(doc,"p",{},statePill(ctx,connPillKind(conn),{label})),
    h(doc,"p",{class:"note",text:ctx.t("settings.conn.serverState",{state:stText})}),
    hint?h(doc,"p",{class:"note",text:hint}):null);
}
/** //TR: Claude bağlantı durumu paneli; profiller GET /v1/system/executors claudeProfiles'tan gelir (yalnız implementer/reviewer). Arka uç yok/doğrulanmamışsa dürüst UNAVAILABLE; profil yoksa dürüst boş. */
function connectionPanel(ctx,exec){
  const doc=ctx.doc;
  if(!exec||exec.state!=="VERIFIED")
    return panel(ctx,{titleKey:"settings.conn.title",id:"settings-connection"},
      h(doc,"p",{class:"note",text:ctx.t("settings.conn.lead")}),
      stateNote(ctx,exec&&exec.state?exec.state:"UNAVAILABLE"));
  const profiles=Array.isArray(exec.profiles)?exec.profiles:[];
  const body=profiles.length?h(doc,"ul",{class:"cards conn-list"},profiles.map(p=>connectionCard(ctx,p))):emptyNote(ctx,"settings.conn.none");
  return panel(ctx,{titleKey:"settings.conn.title",id:"settings-connection"},
    h(doc,"p",{class:"note",text:ctx.t("settings.conn.lead")}),
    body,
    h(doc,"p",{class:"note",text:ctx.t("settings.conn.guidance")}),
    h(doc,"p",{class:"note",text:ctx.t("settings.conn.costNote")}),
    h(doc,"p",{class:"note",text:ctx.t("settings.conn.personalNote")}));
}

// //TR: Fail-closed yürütme kapısı durumu sandbox'tan türetilir: AVAILABLE -> doğrulanmış, UNAVAILABLE -> fail-closed (doğrulanmadı), bilinmeyen -> UNAVAILABLE. Durum uydurulmaz.
export function gatePillKind(sandbox){
  if(isObj(sandbox)&&sandbox.state==="AVAILABLE")return "VERIFIED";
  if(isObj(sandbox)&&sandbox.state==="UNAVAILABLE")return "NOT_VERIFIED";
  return "UNAVAILABLE";
}
/** //TR: Otonomi/yönetişim SALT-OKUNUR gösterimi. Gerçek gözlemlenebilir otonomi sınırları: Global Stop otonomi anahtarı (GET /v1/control/status) ve fail-closed yürütme kapısı (sandbox). Korumalı politika (trust-root, protected-paths, otonomi limitleri, execution-gate, builder/environment policy) Founder yönetimindedir; bu yüzeye açılmaz ve burada DÜZENLENEMEZ. Hiçbir düzenleme kontrolü yoktur. */
function governancePanel(ctx,control,sandbox){
  const doc=ctx.doc;
  const autoKind=control&&control.state==="VERIFIED"?(control.active?"STOPPED":"ACTIVE"):"UNAVAILABLE";
  const autoCell=h(doc,"div",{dataset:{autonomy:autoKind}},statePill(ctx,autoKind),
    autoKind==="STOPPED"&&control&&control.reason?h(doc,"span",{class:"note",text:` ${control.reason}`}):null);
  const gateKind=gatePillKind(sandbox);
  const gateNote=gateKind==="VERIFIED"?ctx.t("settings.gov.gateAvailable"):ctx.t("settings.gov.gateFailClosed");
  const gateCell=h(doc,"div",{dataset:{gate:gateKind}},statePill(ctx,gateKind),h(doc,"span",{class:"note",text:` ${gateNote}`}));
  return panel(ctx,{titleKey:"settings.gov.title",id:"settings-governance"},
    h(doc,"p",{class:"note",role:"note",text:ctx.t("settings.gov.readonly")}),
    h(doc,"dl",{class:"kv gov-kv"},
      h(doc,"dt",{text:ctx.t("settings.gov.autonomy")}),h(doc,"dd",{},autoCell),
      h(doc,"dt",{text:ctx.t("settings.gov.gate")}),h(doc,"dd",{},gateCell)),
    h(doc,"p",{class:"note",text:ctx.t("settings.gov.policyNote")}),
    h(doc,"p",{class:"note",text:ctx.t("settings.gov.founderNote")}));
}

// //TR: Uygulama kimliği /health'ten (sistem adı + sunucu kimliği doğrulaması), build durumu kanonik /v1/factory (MASTER_STATE) alanlarından SIKI doğrulamayla okunur; uyumsuz/eksik değer "—" olur, asla uydurulmaz. "Sürüm" olarak pazarlama sürümü iddia edilmez; yalnız gerçek build/state alanları gösterilir.
export function sanitizeAppFacts(health,factory){
  const ident=health&&health.state==="VERIFIED"&&isObj(health.data)?health.data:null;
  const system=ident&&typeof ident.system==="string"&&/^[A-Z0-9-]{1,64}$/.test(ident.system)?ident.system:null;
  const serverVerified=Boolean(ident&&ident.serverIdentity==="VERIFIED");
  const fb=factory&&factory.ok===true&&isObj(factory.data)?factory.data:null;
  const schemaVersion=fb&&typeof fb.schemaVersion==="string"&&/^\d+\.\d+\.\d+$/.test(fb.schemaVersion)?fb.schemaVersion:null;
  const state=fb&&typeof fb.state==="string"&&/^[A-Z0-9_]{1,64}$/.test(fb.state)?fb.state:null;
  return {system,serverVerified,schemaVersion,state,available:Boolean(ident)};
}
/** //TR: Uygulama/sürüm + güvenlik duruşu paneli. Güvenlik duruşu dürüst bilinen model olarak sunulur: imzasız geliştirme yapısı (risk) ve fail-closed yürütme kapısı (sandbox'a bağlı). Gerçek kimlik yoksa dürüst UNAVAILABLE. */
function appPanel(ctx,health,factory,sandbox){
  const doc=ctx.doc,f=sanitizeAppFacts(health,factory),dash="—";
  const facts=h(doc,"dl",{class:"kv app-kv"},
    h(doc,"dt",{text:ctx.t("settings.app.system")}),h(doc,"dd",{class:"mono",text:f.system??dash}),
    h(doc,"dt",{text:ctx.t("settings.app.serverIdentity")}),h(doc,"dd",{},statePill(ctx,f.available?(f.serverVerified?"VERIFIED":"NOT_VERIFIED"):"UNAVAILABLE")),
    h(doc,"dt",{text:ctx.t("settings.app.buildState")}),h(doc,"dd",{class:"mono",text:f.state??dash}),
    h(doc,"dt",{text:ctx.t("settings.app.schema")}),h(doc,"dd",{class:"mono",text:f.schemaVersion??dash}));
  const gateKind=gatePillKind(sandbox);
  const posture=h(doc,"ul",{class:"cards posture-list"},
    h(doc,"li",{class:"card",dataset:{posture:"unsigned"}},
      h(doc,"h3",{text:ctx.t("settings.app.unsignedTitle")}),
      h(doc,"p",{},badge(ctx,ctx.t("settings.app.unsignedBadge"),"badge-risk")),
      h(doc,"p",{class:"note",text:ctx.t("settings.app.unsignedNote")})),
    h(doc,"li",{class:"card",dataset:{posture:"gate",gate:gateKind}},
      h(doc,"h3",{text:ctx.t("settings.app.gateTitle")}),
      h(doc,"p",{},statePill(ctx,gateKind)),
      h(doc,"p",{class:"note",text:ctx.t("settings.app.gateNote")})));
  return panel(ctx,{titleKey:"settings.app.title",id:"settings-app"},
    f.available?facts:stateNote(ctx,health&&health.state?health.state:"UNAVAILABLE"),
    h(doc,"h3",{class:"sub",text:ctx.t("settings.app.postureTitle")}),
    posture);
}

export async function render(ctx){
  const doc=ctx.doc;
  const [exec,control,health,factory]=await Promise.all([ctx.api.executors(),ctx.api.control(),ctx.api.health(),ctx.api.raw("/v1/factory")]);
  const sandbox=exec&&exec.state==="VERIFIED"?exec.sandbox:null;
  const langs=h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("settings.language")},LANGS.map(l=>h(doc,"button",{type:"button",class:"btn",dataset:{lang:l},"aria-pressed":ctx.i18n.lang===l?"true":"false",on:{click:()=>ctx.i18n.setLang(l)},text:ctx.t(`lang.${l}`)})));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.settings.title")}),
    connectionPanel(ctx,exec),
    await executorsPanel(ctx),
    governancePanel(ctx,control,sandbox),
    appPanel(ctx,health,factory,sandbox),
    panel(ctx,{titleKey:"settings.language",id:"settings-lang"},langs,h(doc,"p",{class:"note",text:ctx.t("settings.languageNote")})),
    panel(ctx,{titleKey:"settings.shortcuts",id:"settings-keys"},h(doc,"dl",{class:"kv"},h(doc,"dt",{},h(doc,"kbd",{text:"Ctrl+K"})),h(doc,"dd",{text:ctx.t("shortcut.search")}),h(doc,"dt",{},h(doc,"kbd",{text:"Esc"})),h(doc,"dd",{text:ctx.t("shortcut.esc")}),h(doc,"dt",{},h(doc,"kbd",{text:"Tab"})),h(doc,"dd",{text:ctx.t("shortcut.tab")}))),
    panel(ctx,{titleKey:"settings.principal",id:"settings-principal"},h(doc,"p",{class:"mono",text:ctx.principal}),h(doc,"p",{class:"note",text:ctx.t("settings.principalNote")})));
}
