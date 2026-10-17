// //TR: Bu görünüm İlk Çalıştırma Kurulum Doğrulaması'dır (FA-V2-PRODUCT, UI-248; uygulama sürüyor): salt-okunur ve zaten izinli GET /v1/install, GET /v1/phase0 ve GET /v1/system/executors okur. Bu taslak yalnız dürüst bir "bilinmiyor" paneli gösterir; hiçbir doğrulama uydurulmaz.
import {h,panel,statePill} from "../components.js";

export async function render(ctx){
  const doc=ctx.doc;
  return h(doc,"div",{class:"view view-install"},
    h(doc,"div",{class:"hero"},h(doc,"p",{class:"hero-eyebrow",text:ctx.t("install.eyebrow")}),h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.install.title")}),h(doc,"p",{class:"hero-sub",text:ctx.t("area.install.desc")})),
    panel(ctx,{titleKey:"area.install.title",id:"install-pending"},statePill(ctx,"NEUTRAL"),h(doc,"p",{class:"note",role:"status",text:ctx.t("install.loading")})));
}
