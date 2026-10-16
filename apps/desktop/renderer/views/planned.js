// //TR: Bu modül app.js VIEWS tablosundaki "planned" anahtarının ev sahibidir: rotada `component` varsa (Company OS, UX WP3) gerçek görünüme devreder; yoksa henüz uygulanmamış alan (Teslimat & SRE) için sessizce devre dışı bırakmak yerine planlı paketi ve alanın içereceklerini listeleyen dürüst paneli gösterir.
import {h,plannedPanel} from "../components.js";
import * as company from "./company.js";

const REAL=Object.freeze({company});
export async function render(ctx,route){
  const real=REAL[route.component];
  if(real)return real.render(ctx,route);
  return h(ctx.doc,"div",{class:"view"},h(ctx.doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t(`area.${route.id}.title`)}),h(ctx.doc,"p",{class:"hero-sub",text:ctx.t(`area.${route.id}.desc`)}),plannedPanel(ctx,route));
}
