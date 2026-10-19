// //TR: UI-251 Recovery Center bileşeni: recovery-core modelini erişilebilir bir panele çevirir (role=alert, etiketli bölge). Neyin başarısız olduğunu söyler, "Yeniden dene" düğmesi mevcut ctx.rerender/ctx.refreshAll mekanizmasını, "Ana sayfaya git" bağlantısı mevcut rota hash'ini kullanır; tanılama yalnız rota kimliği ve sağlık durumudur. Yeni uç nokta/yetki yoktur; yalnız h()/textContent kullanılır.
import {h,statePill} from "./components.js";
import {ROUTES,routeById} from "./routes.js";
import {recoveryModel} from "./recovery-core.js";

const KNOWN=ROUTES.map(r=>r.id);
/** opts: {routeId, health, reason, titleId?} — titleId verilirse başlık görünüm başlığı olur (odak hedefi). */
export function recoveryPanel(ctx,{routeId,health,reason,titleId}={}){
  const doc=ctx.doc,t=ctx.t,m=recoveryModel({reason,routeId,health,knownRouteIds:KNOWN}),uid=`recovery-${m.reason}`;
  const retry=()=>m.reason==="VIEW_FAILED"&&typeof ctx.rerender==="function"?ctx.rerender():ctx.refreshAll({force:true});
  const home=routeById("home"),title=h(doc,"h2",{id:titleId??`${uid}-title`,tabindex:"-1",text:t(`recovery.title.${m.reason}`)});
  return h(doc,"section",{class:"note note-error recovery-panel",role:"alert","aria-labelledby":title.getAttribute("id"),dataset:{recovery:m.reason}},
    title,
    h(doc,"p",{text:t(`recovery.desc.${m.reason}`)}),
    h(doc,"dl",{class:"kv"},
      h(doc,"dt",{text:t("recovery.diag.route")}),h(doc,"dd",{text:m.routeId}),
      h(doc,"dt",{text:t("recovery.diag.health")}),h(doc,"dd",{},statePill(ctx,m.pill,{label:t(`recovery.health.${m.health}`)}))),
    h(doc,"div",{class:"row"},
      h(doc,"button",{type:"button",class:"btn",dataset:{recovery:"retry"},on:{click:retry}},t("recovery.retry")),
      h(doc,"a",{class:"link-more",href:home?.hash??"#/home",dataset:{recovery:"home",focusKey:"recovery-home"},text:t("recovery.home")})));
}
