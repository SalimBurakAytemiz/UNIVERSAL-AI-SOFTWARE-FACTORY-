// //TR: Bu modül app.js VIEWS tablosundaki "planned" anahtarının ev sahibidir: rotada `component` varsa (Company OS, UX WP3; Teslimat & SRE, UX WP-DELIVERY; Skill Academy, Proje Yolculuğu, Kurucu Yönetim Özeti, İnsan Onayı Kuyruğu, Kalite Kapısı/Release Readiness, Güvence Komuta Merkezi/Güvenlik Duruşu, Çoklu Proje Komuta Matrisi ve Operasyon ve Kurtarma, FA-V2-PRODUCT) gerçek görünüme devreder; yoksa henüz uygulanmamış alan için sessizce devre dışı bırakmak yerine planlı paketi ve alanın içereceklerini listeleyen dürüst paneli gösterir.
import {h,plannedPanel} from "../components.js";
import * as company from "./company.js";
import * as delivery from "./delivery.js";
import * as academy from "./academy.js";
import * as journey from "./journey.js";
import * as executive from "./executive.js";
import * as queue from "./queue.js";
import * as readiness from "./readiness.js";
import * as posture from "./posture.js";
import * as matrix from "./matrix.js";
import * as operations from "./operations.js";
import * as install from "./install.js";
import * as audit from "./audit.js";
import * as domains from "./domains.js";
import * as integrations from "./integrations.js";
import {recoveryPanel} from "../recovery-panel.js";

const REAL=Object.freeze({company,delivery,academy,journey,executive,queue,readiness,posture,matrix,operations,install,audit,domains,integrations});
export async function render(ctx,route){
  const real=REAL[route.component];
  // //TR: UI-251: yerel görünüm render hatası app.js'te yalnız düz bir hata notuna iner; bu sınır, hata mesajı/yığın izi göstermeden Recovery Center panelini (yeniden dene + ana sayfa) gösterir. Sağlık durumu yalnız GET /health okumasıdır.
  if(real){
    try{return await real.render(ctx,route)}catch{
      let health="UNKNOWN";try{health=(await ctx.api.health()).state}catch{/* sağlık okunamadı: UNKNOWN (fail-closed) */}
      return h(ctx.doc,"div",{class:"view"},recoveryPanel(ctx,{routeId:route.id,health,reason:"VIEW_FAILED",titleId:"view-title"}));
    }
  }
  return h(ctx.doc,"div",{class:"view"},h(ctx.doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t(`area.${route.id}.title`)}),h(ctx.doc,"p",{class:"hero-sub",text:ctx.t(`area.${route.id}.desc`)}),plannedPanel(ctx,route));
}
