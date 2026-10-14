// //TR: Bu giriş modülü renderer'ı başlatır: i18n/store/api/shell bağlantısı, hash yönlendirme, periyodik yenileme, ACİL DURDUR/Devam IPC çağrıları ve legacy blocker listesi; API verisi HTML olarak yorumlanmadan yalnız createElement/textContent/replaceChildren ile render edilir.
import {createI18n} from "./i18n.js";
import {createStore} from "./state.js";
import {createApi} from "./api.js";
import {createShell,PRINCIPAL} from "./shell.js";
import {routeById,routeFromHash} from "./routes.js";
import {h,statusLabel} from "./components.js";
import {captureFocus,restoreFocus,isInteractive} from "./focus.js";
import * as home from "./views/home.js";
import * as projects from "./views/projects.js";
import * as work from "./views/work.js";
import * as workforce from "./views/workforce.js";
import * as assurance from "./views/assurance.js";
import * as planned from "./views/planned.js";
import * as tower from "./views/tower.js";
import * as inbox from "./views/inbox.js";
import * as settings from "./views/settings.js";

const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};
const REFRESH_MS=15000;
const doc=document;
let storage=null;try{storage=window.localStorage}catch{storage=null}
const i18n=createI18n(storage),store=createStore(storage),api=createApi({bridge:window.uasco,store});
const main=doc.getElementById("main");let renderToken=0,shell=null;

const ctx={doc,i18n,store,api,principal:PRINCIPAL,t:(k,v)=>i18n.t(k,v),
  currentRouteId:()=>routeFromHash(window.location.hash),
  navigate(id){const r=routeById(id);if(r&&window.location.hash!==r.hash)window.location.hash=r.hash;else renderRoute({focus:true,force:true})},
  selectProject(id){if(store.selectProject(id))shell.announce(ctx.t("ctx.projectChanged"))},
  requestStop(){shell.openStopDialog()},
  async stop(){shell.clearStopError();try{await window.uasco.stop("Founder requested from UASCO Desktop")}catch{shell.showStopError(ctx.t("stop.failed"))}await ctx.refreshAll({force:true})},
  async resume(){shell.clearStopError();try{await window.uasco.resume()}catch{shell.showStopError(ctx.t("stop.failed"))}await ctx.refreshAll({force:true})},
  async refreshAll({force=false}={}){if(force)store.cache.clear();const ok=await shell.refresh();if(ok===false)return;await renderRoute({force})},
  renderAttention,
  rerender(){return renderRoute({force:true})},
  confirm:confirmAction
};

/** Yüksek riskli eylemler için erişilebilir onay penceresi: eylem ve hedef adıyla açılır, varsayılan odak "Vazgeç"tir, Esc veya Vazgeç false döndürür; yalnız açıkça "Onayla" true döndürür. */
function confirmAction({title,body,action,target,confirmLabel}){
  const d=doc.getElementById("confirmDialog");
  if(!d)return Promise.resolve(false);
  return new Promise(resolve=>{
    const set=(id,v)=>{const n=doc.getElementById(id);if(n)n.textContent=String(v??"")};
    set("confirmDialogTitle",title);set("confirmDialogDesc",body);set("confirmAction",action);set("confirmTarget",target);set("confirmOk",confirmLabel??ctx.t("confirm.ok"));
    const ok=doc.getElementById("confirmOk"),cancel=doc.getElementById("confirmCancel");
    let done=false;
    const finish=value=>{
      if(done)return;done=true;
      ok.removeEventListener("click",onOk);cancel.removeEventListener("click",onCancel);d.removeEventListener("cancel",onEsc);d.removeEventListener("keydown",onKey);
      if(typeof d.close==="function"){if(d.open)d.close()}else d.removeAttribute("open");
      resolve(value);
    };
    const onOk=()=>finish(true),onCancel=()=>finish(false),onEsc=e=>{e.preventDefault();finish(false)},onKey=e=>{if(e.key==="Escape"){e.preventDefault();finish(false)}};
    ok.addEventListener("click",onOk);cancel.addEventListener("click",onCancel);d.addEventListener("cancel",onEsc);d.addEventListener("keydown",onKey);
    if(typeof d.showModal==="function"&&!d.open)d.showModal();else d.setAttribute("open","");
    cancel.focus();
  });
}

/** Legacy founder-attention blocker listesi; yeniden deneme yetkisi yalnız sunucunun retryable alanından gelir. */
function renderAttention(container,att){
  if(!att||att.state!=="VERIFIED"){container.replaceChildren(h(doc,"p",{class:"note",text:ctx.t(`state.${att?.state??"UNAVAILABLE"}`)}));return}
  const attNodes=att.blocked.map(x=>{
    const row=doc.createElement("div"),strong=doc.createElement("strong");row.className="attention-row";strong.textContent=String(x.packageId??ctx.t("attention.phase",{n:x.phase}));
    row.append(strong,doc.createTextNode(` · ${statusLabel(ctx,x.kind??"BLOCKED")} · ${x.reason??""} `));
    if(x.retryable===true){const b=h(doc,"button",{type:"button",class:"btn",dataset:{retry:x.packageId??""},text:ctx.t("attention.retry")});b.addEventListener("click",async()=>{if(b.dataset.retry){await window.uasco.retryBlocked(b.dataset.retry);await ctx.refreshAll({force:true})}});row.appendChild(b)}
    return row;
  });
  container.replaceChildren(...(attNodes.length?attNodes:[doc.createTextNode(ctx.t("attention.none"))]));
}

async function renderRoute({focus=false,force=false}={}){
  const token=++renderToken,epoch=store.epoch,route=routeById(ctx.currentRouteId()),view=VIEWS[route.view];
  const sameRoute=main.dataset.route===route.id;
  if(sameRoute&&!force&&!focus){
    // Periyodik yenileme yalnız odak etkileşimli bir denetimdeyse (düğme, bağlantı, alan, log) veya onay penceresi açıkken atlanır; aksi halde (ör. KPI karosu) yeniden kurulur ve odak anahtarla geri verilir (KPI değerleri bayatlamaz).
    if(main.contains(doc.activeElement)&&isInteractive(doc.activeElement)){renderToken-=1;return}
    if(doc.getElementById("stopDialog")?.open||doc.getElementById("confirmDialog")?.open){renderToken-=1;return}
  }
  if(!sameRoute){main.dataset.route=route.id;main.setAttribute("aria-busy","true");main.replaceChildren(typeof view.skeleton==="function"?view.skeleton(ctx,route):h(doc,"p",{class:"note",role:"status",text:ctx.t("state.LOADING")}))}
  let node;
  try{node=await view.render(ctx,route)}catch{node=h(doc,"p",{class:"note note-error",role:"alert",text:ctx.t("state.ERROR")})}
  if(token!==renderToken||epoch!==store.epoch)return;
  if(sameRoute&&!force&&!focus&&main.contains(doc.activeElement)&&isInteractive(doc.activeElement))return;
  const saved=focus?null:captureFocus(doc,main);
  main.replaceChildren(node);main.removeAttribute("aria-busy");shell.renderNav();restoreFocus(doc,main,saved);
  if(focus){const title=node.querySelector?.("#view-title");if(title)title.focus();shell.announce(ctx.t("route.announce",{title:ctx.t(`area.${route.id}.title`)}))}
}

function boot(){
  shell=createShell(ctx);i18n.applyStatic(doc);shell.wireStatic();shell.renderAll();
  window.addEventListener("hashchange",()=>{shell.renderNav();renderRoute({focus:true,force:true})});
  store.onChange(()=>{shell.renderContext();ctx.refreshAll({force:true})});
  i18n.onChange(()=>{i18n.applyStatic(doc);shell.renderAll();main.dataset.route="";renderRoute({force:true})});
  ctx.refreshAll({});
  window.setInterval(()=>{ctx.refreshAll({})},REFRESH_MS);
}
boot();
