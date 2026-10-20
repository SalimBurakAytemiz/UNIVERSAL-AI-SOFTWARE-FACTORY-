// //TR: Bu modül UX WP-FIRSTRUN ilk-açılış kurulum/onboarding sihirbazıdır (modal dialog): adımlar (1) Hoş geldiniz, (2) Claude bağlantısı — iki ayrı UASCO profili (uygulayıcı + salt-okunur denetçi) gerçek bağlantı durumu (WP-SETTINGS claudeConnectionState / GET /v1/system/executors yeniden kullanılır), Founder'ın kendi çalıştıracağı giriş adımları, sağlayıcı kota/abonelik notu ve kişisel profilin ASLA otomatik kullanılmadığı, (3) Doğrulama — gerçek durum yeniden okunur ve CONNECTED yalnız profil state===READY iken gösterilir, aksi NOT_CONNECTED/NOT_VERIFIED, (4) Hazır. HARD (K-1 + güvenlik): sihirbaz gerçek Claude girişini KENDİSİ yapmaz, bağlı/doğrulanmış durumu ASLA uydurmaz (yalnız gerçek sunucu sinyalinden), kapı değildir (atlanır/başarısız olursa uygulama yine açılır ve AI özellikleri dürüstçe BLOCKED/NOT_CONNECTED kalır), parola/token saklamaz, korumalı/yönetilen dosya yazmaz. "İlk-kurulum görüldü" bayrağı yalnız güvenli bir per-user localStorage tercihidir. Yalnız h()/textContent; WP2 token/bileşenleri yeniden kullanılır, yeni token/palet yoktur.
import {h,statePill,stateNote} from "../components.js";
import {claudeConnectionState,CLAUDE_CONN} from "./settings.js";
import {MISSING} from "../model.js";
import {buildInstall} from "../install-core.js";

// //TR: Güvenli per-user tercih anahtarı (korumalı/yönetilen durum DEĞİL; yalnız bu kullanıcının tarayıcı deposundaki tek bayrak).
export const FIRSTRUN_STORAGE_KEY="uasco.firstRunSeen";
export const FIRSTRUN_STEPS=Object.freeze(["welcome","connection","verify","ready"]);

// //TR: Depo okunamazsa (gizli pencere, kapalı depolama) false döner; emin olunamayınca sihirbaz yine açılabilir, veri asla uydurulmaz.
export function firstRunSeen(storage){try{return storage?.getItem(FIRSTRUN_STORAGE_KEY)==="1"}catch{return false}}
export function markFirstRunSeen(storage){try{storage?.setItem(FIRSTRUN_STORAGE_KEY,"1");return true}catch{return false}}
// //TR: Otomatik açılış kapısı: yalnız güvenli tercih "görüldü" değilse. Bu bir kapı DEĞİLDİR; yalnız sihirbazın ilk açılışta bir kez görünmesini sağlar.
export function shouldAutoOpenFirstRun(storage){return !firstRunSeen(storage)}

// //TR: Bağlantı rozeti: CONNECTED olumlu (VERIFIED) rozeti + özel etiket, diğerleri kendi rozetleri (yeni token yok, WP-SETTINGS ile aynı türetim).
function connPill(ctx,conn){
  const kind=conn===CLAUDE_CONN.CONNECTED?"VERIFIED":conn;
  const label=conn===CLAUDE_CONN.CONNECTED?ctx.t("settings.conn.CONNECTED"):ctx.t(`pill.${conn}`);
  return statePill(ctx,kind,{label});
}
// //TR: Tek profil kartı; bağlantı durumu yalnız claudeConnectionState'ten (gerçek giriş sinyali) gelir. showLogin true ise Founder'ın KENDİSİNİN çalıştıracağı giriş komutu yalnız METİN olarak gösterilir (renderer asla çalıştırmaz).
function profileCard(ctx,p,{showLogin}){
  const doc=ctx.doc,conn=claudeConnectionState(p);
  const roleKey=`exec.profile.role.${p.role}`,roleName=ctx.t(roleKey)===roleKey?p.role:ctx.t(roleKey);
  const stKey=`exec.profile.state.${p.state}`,stText=p.state&&ctx.t(stKey)!==stKey?ctx.t(stKey):(p.state??ctx.t("exec.state.UNKNOWN"));
  const hintKey=`exec.profile.hint.${p.state}`,hint=p.state&&ctx.t(hintKey)!==hintKey?ctx.t(hintKey):null;
  return h(doc,"li",{class:"card",dataset:{frProfile:p.role,conn,state:p.state??"UNKNOWN"}},
    h(doc,"h4",{text:roleName}),
    h(doc,"p",{},connPill(ctx,conn)),
    h(doc,"p",{class:"note",text:ctx.t("settings.conn.serverState",{state:stText})}),
    hint?h(doc,"p",{class:"note",text:hint}):null,
    showLogin&&p.loginCommand?h(doc,"p",{class:"note",text:ctx.t("exec.profile.loginHint")}):null,
    showLogin&&p.loginCommand?h(doc,"pre",{class:"code",dataset:{frLogin:p.role}},h(doc,"code",{text:p.loginCommand})):null);
}
// //TR: Profil listesi; arka uç yok/doğrulanmamışsa dürüst durum notu (UNAVAILABLE), profil yoksa dürüst boş. Asla "bağlı" uydurulmaz.
function profilesList(ctx,exec,{showLogin}){
  const doc=ctx.doc;
  if(!exec||exec.state!=="VERIFIED")return stateNote(ctx,exec&&exec.state?exec.state:"UNAVAILABLE");
  const profiles=Array.isArray(exec.profiles)?exec.profiles:[];
  if(!profiles.length)return h(doc,"p",{class:"note",text:ctx.t("settings.conn.none")});
  return h(doc,"ul",{class:"cards conn-list"},profiles.map(p=>profileCard(ctx,p,{showLogin})));
}
// //TR: Doğrulama özeti: CONNECTED yalnız TÜM profiller gerçek giriş sinyaliyle (state===READY) bağlıysa; aksi NOT_CONNECTED. Arka uç yoksa dürüst UNAVAILABLE.
function verifySummary(ctx,exec){
  const doc=ctx.doc;
  if(!exec||exec.state!=="VERIFIED")return h(doc,"p",{class:"note note-unavailable",role:"status",dataset:{frVerify:"UNAVAILABLE"},text:ctx.t("firstrun.verify.unavailable")});
  const profiles=Array.isArray(exec.profiles)?exec.profiles:[];
  const allConnected=profiles.length>0&&profiles.every(p=>claudeConnectionState(p)===CLAUDE_CONN.CONNECTED);
  return h(doc,"p",{class:"note",role:"status",dataset:{frVerify:allConnected?"CONNECTED":"NOT_CONNECTED"},text:ctx.t(allConnected?"firstrun.verify.allConnected":"firstrun.verify.notConnected")});
}

// //TR: Kurulum kontrolü satırı: sunucu kararı (VERIFIED/PENDING/REJECTED) ve Phase-0 sonucu AYNEN; VERIFIED rozeti yalnız okuma kullanılabilir VE karar VERIFIED iken. Okunamayan kaynak ayrık durumunu + MISSING gösterir (asla VERIFIED/0).
const INSTALL_VERIFY_PILL=Object.freeze({VERIFIED:"VERIFIED",PENDING:"WAITING",REJECTED:"BLOCKED"});
function installRow(ctx,rowKey,srcState,rec,finalValue){
  const doc=ctx.doc,usable=srcState==="VERIFIED"&&rec;
  if(!usable){
    const kind=srcState==="OFFLINE"||srcState==="UNAVAILABLE"?srcState:"FAILED";
    return h(doc,"li",{class:"card",dataset:{frInstallRow:rowKey,frInstallState:srcState}},
      h(doc,"h4",{text:ctx.t(`firstrun.install.row.${rowKey}`)}),
      h(doc,"p",{},statePill(ctx,kind)," ",h(doc,"span",{class:"mono",text:MISSING})));
  }
  const v=rec.verification;
  return h(doc,"li",{class:"card",dataset:{frInstallRow:rowKey,frInstallState:"VERIFIED",frInstallVerdict:String(v)}},
    h(doc,"h4",{text:ctx.t(`firstrun.install.row.${rowKey}`)}),
    h(doc,"p",{},statePill(ctx,INSTALL_VERIFY_PILL[v]??"NEUTRAL",{label:String(v)})),
    h(doc,"p",{class:"note",text:ctx.t("firstrun.install.final",{value:finalValue??MISSING})}));
}
// //TR: "Kurulum kontrolü" bloğu; yalnız GET /v1/install + GET /v1/phase0 (mevcut erişimciler) okumasından, install-core buildInstall ile türetilir. Uyuşmazlık düzeltilmeden iki değerle bildirilir.
function installBlock(ctx,reads,onOpen){
  const doc=ctx.doc;
  const head=[h(doc,"h4",{class:"wiz-sub",text:ctx.t("firstrun.install.title")}),h(doc,"p",{class:"note",text:ctx.t("firstrun.install.lead")})];
  const open=h(doc,"button",{type:"button",class:"btn",id:"firstRunOpenInstall",dataset:{focusKey:"firstRunOpenInstall",frInstallOpen:"1"},text:ctx.t("firstrun.install.open"),on:{click:onOpen}});
  if(!reads)return h(doc,"div",{dataset:{frInstall:"LOADING"}},head,h(doc,"p",{class:"note",role:"status",text:ctx.t("state.LOADING")}),open);
  const a=buildInstall({install:reads.install,phase0:reads.phase0});
  const rc=a.reconcile;
  return h(doc,"div",{dataset:{frInstall:"READY"}},head,
    h(doc,"ul",{class:"cards"},
      installRow(ctx,"install",a.sources.install.state,a.install,a.install&&a.install.phase0Final),
      installRow(ctx,"phase0",a.sources.phase0.state,a.phase0,a.phase0&&a.phase0.final)),
    rc&&!rc.agree?h(doc,"p",{class:"note",role:"status",dataset:{frInstallMismatch:"1"},text:ctx.t("firstrun.install.mismatch",{install:rc.install??MISSING,phase0:rc.phase0??MISSING})}):null,
    open);
}

/**
 * //TR: Sihirbaz denetleyicisi. dialog düğümünü kurar, adım durumunu tutar ve her adımı yerinde boyar. Bağlantı/doğrulama verisi yalnız ctx.api.executors() ile gerçek sunucudan okunur; doğrulama adımı force okur. finish/skip/Esc -> güvenli tercih "görüldü" yazılır ve kapatılır (uygulamayı engellemez). onDone(reason) çağrılır.
 */
export function createFirstRunController(ctx,{storage=null,onDone=null}={}){
  const doc=ctx.doc;
  const total=FIRSTRUN_STEPS.length;
  let step=0,exec=null,loaded=false,stepTitleNode=null,instReads=null;
  const dialog=h(doc,"dialog",{class:"dialog wizard",id:"firstRunDialog",role:"dialog","aria-modal":"true","aria-labelledby":"firstRunTitle","aria-describedby":"firstRunLead"});
  const head=h(doc,"div",{class:"wiz-head"}),body=h(doc,"div",{class:"wiz-body",id:"firstRunBody"}),foot=h(doc,"div",{class:"wiz-foot btn-row"});
  dialog.append(head,body,foot);
  // //TR: Esc = atla; uygulama yine açık kalır (sihirbaz kapı değildir).
  dialog.addEventListener("cancel",e=>{if(e&&typeof e.preventDefault==="function")e.preventDefault();skip()});
  dialog.addEventListener("keydown",e=>{if(e&&e.key==="Escape"){if(typeof e.preventDefault==="function")e.preventDefault();skip()}});

  function close(){
    try{if(typeof dialog.close==="function"&&dialog.open)dialog.close();else dialog.removeAttribute("open")}catch{/* yoksay */}
    try{if(typeof dialog.remove==="function")dialog.remove()}catch{/* yoksay */}
  }
  function done(reason){markFirstRunSeen(storage);if(typeof onDone==="function")onDone(reason);close()}
  function finish(){done("finish")}
  function skip(){done("skip")}
  function goTo(n){step=Math.max(0,Math.min(total-1,n));paint(true);if(FIRSTRUN_STEPS[step]==="verify")void loadInstall()}
  async function load(force){
    if(force){try{ctx.store&&ctx.store.cache&&ctx.store.cache.clear()}catch{/* yoksay */}}
    try{exec=await ctx.api.executors()}catch{exec={state:"ERROR",items:[]}}
    loaded=true;paint(false);
  }
  // //TR: Kurulum raporu + Phase-0 okuması yalnız doğrulama adımında (tembel); her okuma ayrı try/catch ile yalıtılır, biri düşerse executors özeti değişmez.
  async function loadInstall(){
    const rd=async fn=>{try{const r=await fn();return r&&typeof r.state==="string"?r:{state:"UNAVAILABLE"}}catch{return {state:"ERROR"}}};
    const [install,phase0]=await Promise.all([rd(()=>ctx.api.installInstall()),rd(()=>ctx.api.installPhase0())]);
    instReads={install,phase0};
    if(FIRSTRUN_STEPS[step]==="verify")paint(false);
  }
  async function verify(){await Promise.all([load(true),loadInstall()])}
  function openInstall(){done("install");if(typeof ctx.navigate==="function")ctx.navigate("install")}

  function stepNode(key){
    const title=h(doc,"h3",{id:"firstRunStepTitle",class:"wiz-step-title",tabindex:"-1",dataset:{focusFirst:"1"},text:ctx.t(`firstrun.step.${key}.title`)});
    stepTitleNode=title;
    const wrap=h(doc,"section",{class:"wiz-step",dataset:{frStep:key},"aria-labelledby":"firstRunStepTitle"},title,
      h(doc,"p",{class:"note",text:ctx.t(`firstrun.step.${key}.body`)}));
    if(key==="welcome")wrap.append(h(doc,"p",{class:"note",text:ctx.t("firstrun.notGate")}));
    else if(key==="connection")wrap.append(
      h(doc,"h4",{class:"wiz-sub",text:ctx.t("firstrun.conn.profilesTitle")}),
      loaded?profilesList(ctx,exec,{showLogin:true}):h(doc,"p",{class:"note",role:"status",text:ctx.t("state.LOADING")}),
      h(doc,"p",{class:"note",text:ctx.t("settings.conn.guidance")}),
      h(doc,"p",{class:"note",text:ctx.t("settings.conn.costNote")}),
      h(doc,"p",{class:"note",text:ctx.t("settings.conn.personalNote")}));
    else if(key==="verify")wrap.append(
      loaded?verifySummary(ctx,exec):h(doc,"p",{class:"note",role:"status",text:ctx.t("state.LOADING")}),
      loaded?profilesList(ctx,exec,{showLogin:false}):null,
      installBlock(ctx,instReads,openInstall),
      h(doc,"p",{class:"note",text:ctx.t("firstrun.verify.lead")}));
    else wrap.append(h(doc,"p",{class:"note",text:ctx.t("firstrun.ready.note")}));
    return wrap;
  }
  function footButtons(key){
    const btns=[];
    if(step>0)btns.push(h(doc,"button",{type:"button",class:"btn",id:"firstRunBack",dataset:{focusKey:"firstRunBack"},text:ctx.t("firstrun.back"),on:{click:()=>goTo(step-1)}}));
    if(key==="verify")btns.push(h(doc,"button",{type:"button",class:"btn",id:"firstRunVerify",dataset:{focusKey:"firstRunVerify"},text:ctx.t("firstrun.verify.button"),on:{click:()=>{void verify()}}}));
    if(step<total-1)btns.push(h(doc,"button",{type:"button",class:"btn btn-primary",id:"firstRunNext",dataset:{focusKey:"firstRunNext"},text:ctx.t("firstrun.next"),on:{click:()=>goTo(step+1)}}));
    else btns.push(h(doc,"button",{type:"button",class:"btn btn-primary",id:"firstRunFinish",dataset:{focusKey:"firstRunFinish"},text:ctx.t("firstrun.finish"),on:{click:()=>finish()}}));
    if(key!=="ready")btns.push(h(doc,"button",{type:"button",class:"btn",id:"firstRunSkip",dataset:{focusKey:"firstRunSkip"},text:ctx.t("firstrun.skip"),on:{click:()=>skip()}}));
    return btns;
  }
  function paint(moveFocus){
    const key=FIRSTRUN_STEPS[step];
    head.replaceChildren(
      h(doc,"h2",{id:"firstRunTitle",class:"wiz-title",text:ctx.t("firstrun.title")}),
      h(doc,"p",{id:"firstRunLead",class:"note",text:ctx.t("firstrun.lead")}),
      h(doc,"p",{class:"wiz-steps",dataset:{step:String(step+1),total:String(total)},"aria-hidden":"true",text:ctx.t("firstrun.stepIndicator",{n:step+1,total})}));
    body.replaceChildren(stepNode(key));
    foot.replaceChildren(...footButtons(key));
    if(moveFocus&&stepTitleNode&&typeof stepTitleNode.focus==="function")stepTitleNode.focus();
  }
  async function start(){paint(true);await load(false)}
  return {dialog,start,goTo,verify,finish,skip,load,get step(){return step},get exec(){return exec}};
}

// //TR: Güvenli per-user depo (tarayıcı localStorage); erişilemezse null (sihirbaz çalışır, bayrak kalıcı olmaz).
function firstRunStorage(){try{return window.localStorage}catch{return null}}
/** //TR: Sihirbazı modal olarak açar (yalnız gerçek pencere/DOM ortamında); veriyi start() yükler. */
export function openFirstRunWizard(ctx,storage){
  const doc=ctx&&ctx.doc;if(!doc||!doc.body)return null;
  const c=createFirstRunController(ctx,{storage});
  doc.body.append(c.dialog);
  try{if(typeof c.dialog.showModal==="function")c.dialog.showModal();else c.dialog.setAttribute("open","")}catch{try{c.dialog.setAttribute("open","")}catch{/* yoksay */}}
  void c.start();
  return c;
}
/** //TR: shell boot'unda bir kez çağrılır: güvenli tercih görülmemişse sihirbazı açar; her hata yutulur (uygulama yine açılır). */
export function maybeOpenFirstRun(ctx){
  const storage=firstRunStorage();
  if(!shouldAutoOpenFirstRun(storage))return null;
  return openFirstRunWizard(ctx,storage);
}
