// //TR: Bu görünüm henüz uygulanmamış alanlar (Güvence, Teslimat & SRE, Company OS) için sessizce devre dışı bırakmak yerine planlı paketi ve alanın içereceklerini listeleyen dürüst paneli gösterir.
import {h,plannedPanel} from "../components.js";

export async function render(ctx,route){
  return h(ctx.doc,"div",{class:"view"},h(ctx.doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t(`area.${route.id}.title`)}),h(ctx.doc,"p",{class:"hero-sub",text:ctx.t(`area.${route.id}.desc`)}),plannedPanel(ctx,route));
}
