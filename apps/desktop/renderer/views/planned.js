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

const REAL=Object.freeze({company,delivery,academy,journey,executive,queue,readiness,posture,matrix,operations,install,audit});
export async function render(ctx,route){
  const real=REAL[route.component];
  if(real)return real.render(ctx,route);
  return h(ctx.doc,"div",{class:"view"},h(ctx.doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t(`area.${route.id}.title`)}),h(ctx.doc,"p",{class:"hero-sub",text:ctx.t(`area.${route.id}.desc`)}),plannedPanel(ctx,route));
}
