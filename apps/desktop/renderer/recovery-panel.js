// //TR: UI-251 Recovery Center bileşeni: recovery-core modelini erişilebilir bir panele çevirir (role=alert, etiketli bölge). Neyin başarısız olduğunu söyler, "Yeniden dene" düğmesi mevcut ctx.rerender/ctx.refreshAll mekanizmasını, "Ana sayfaya git" bağlantısı mevcut rota hash'ini kullanır; tanılama yalnız rota kimliği ve sağlık durumudur. Yeni uç nokta/yetki yoktur; yalnız h()/textContent kullanılır.
import {h,statePill} from "./components.js";
import {ROUTES,routeById} from "./routes.js";
import {recoveryModel,createReconnector} from "./recovery-core.js";

const KNOWN=ROUTES.map(r=>r.id);
// //TR: UASCO-T0004.A metinleri: önce ctx.t (locale anahtarı eklenince o kullanılır), yoksa bu modülün en/tr yedeği; locale dosyaları açık PR'larla paylaşıldığından şimdilik burada tutulur.
const FALLBACK=Object.freeze({
  en:{"recovery.auto.next":"Automatic retry {n} in {s} s","recovery.auto.running":"Retrying now…","recovery.auto.lead":"The Control API is retried automatically with growing waits (2, 4, 8, 16 s, then every 30 s) until it is reachable again.","recovery.reconnected":"Control API reachable again; data refreshed."},
  tr:{"recovery.auto.next":"Otomatik yeniden deneme {n}, {s} sn içinde","recovery.auto.running":"Şimdi yeniden deneniyor…","recovery.auto.lead":"Control API, yeniden erişilebilir olana kadar artan aralıklarla (2, 4, 8, 16 sn, sonra her 30 sn) otomatik olarak yeniden denenir.","recovery.reconnected":"Control API yeniden erişilebilir; veriler yenilendi."}
});
export function recoveryText(ctx,key,vars){
  const s=typeof ctx.t==="function"?ctx.t(key,vars):key;
  if(s!==key)return s;
  const d=FALLBACK[ctx.i18n?.lang==="tr"?"tr":"en"],raw=d[key]??key;
  return String(raw).replace(/\{(\w+)\}/g,(m,k)=>vars&&Object.prototype.hasOwnProperty.call(vars,k)?String(vars[k]):m);
}
// Belge başına tek denetleyici: panel her yenilemede yeniden çizilir, döngü ise çizimden bağımsız sürer (kullanıcı akış sekmesine geçse bile).
const RECONNECTORS=new WeakMap();
export function reconnectorFor(ctx){
  const doc=ctx.doc;let r=RECONNECTORS.get(doc);
  if(r)return r;
  const w=doc.defaultView??globalThis;
  r=createReconnector({
    schedule:(fn,ms)=>(w.setTimeout??globalThis.setTimeout)(fn,ms),
    cancel:h=>(w.clearTimeout??globalThis.clearTimeout)(h),
    now:()=>typeof ctx.now==="function"?ctx.now():Date.now(),
    attemptOnce:()=>typeof ctx.refreshAll==="function"?ctx.refreshAll({force:true}):Promise.resolve(),
    isHealthy:async()=>{const hres=typeof ctx.api?.health==="function"?await ctx.api.health():null;return hres?.state==="VERIFIED"},
    onRecovered:()=>{const n=typeof doc.getElementById==="function"?doc.getElementById("status"):null;if(n)n.textContent=recoveryText(ctx,"recovery.reconnected")}
  });
  RECONNECTORS.set(doc,r);return r;
}
/** opts: {routeId, health, reason, titleId?} — titleId verilirse başlık görünüm başlığı olur (odak hedefi). API_DOWN'da otomatik yeniden bağlanma planlanır ve durumu gösterilir. */
export function recoveryPanel(ctx,{routeId,health,reason,titleId}={}){
  const doc=ctx.doc,t=ctx.t,m=recoveryModel({reason,routeId,health,knownRouteIds:KNOWN}),uid=`recovery-${m.reason}`;
  const auto=m.reason==="API_DOWN"&&m.apiDown?reconnectorFor(ctx):null;
  if(auto)auto.noteDown();
  const retry=()=>m.reason==="VIEW_FAILED"&&typeof ctx.rerender==="function"?ctx.rerender():auto?auto.retryNow():ctx.refreshAll({force:true});
  const home=routeById("home"),title=h(doc,"h2",{id:titleId??`${uid}-title`,tabindex:"-1",text:t(`recovery.title.${m.reason}`)});
  let autoNode=null;
  if(auto){
    const sn=auto.snapshot(),nowMs=typeof ctx.now==="function"?ctx.now():Date.now();
    const secs=sn.nextAt===null?null:Math.max(0,Math.ceil((sn.nextAt-nowMs)/1000));
    autoNode=h(doc,"div",{class:"recovery-auto",dataset:{recoveryAuto:sn.running?"running":"scheduled",recoveryAttempt:String(sn.attempt+1),...(secs===null?{}:{recoveryInSeconds:String(secs)})}},
      h(doc,"p",{class:"note",text:recoveryText(ctx,"recovery.auto.lead")}),
      h(doc,"p",{class:"note mono","aria-live":"off",text:sn.running||secs===null?recoveryText(ctx,"recovery.auto.running"):recoveryText(ctx,"recovery.auto.next",{n:String(sn.attempt+1),s:String(secs)})}));
  }
  return h(doc,"section",{class:"note note-error recovery-panel",role:"alert","aria-labelledby":title.getAttribute("id"),dataset:{recovery:m.reason}},
    title,
    h(doc,"p",{text:t(`recovery.desc.${m.reason}`)}),
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:t("recovery.diag.route")}),h(doc,"dd",{text:m.routeId}),
      h(doc,"dt",{text:t("recovery.diag.health")}),h(doc,"dd",{},statePill(ctx,m.pill,{label:t(`recovery.health.${m.health}`)}))),
    autoNode,
    h(doc,"div",{class:"row"},
      h(doc,"button",{type:"button",class:"btn",dataset:{recovery:"retry"},on:{click:retry}},t("recovery.retry")),
      h(doc,"a",{class:"link-more",href:home?.hash??"#/home",dataset:{recovery:"home",focusKey:"recovery-home"},text:t("recovery.home")})));
}
