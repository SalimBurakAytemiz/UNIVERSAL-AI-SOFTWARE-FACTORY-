// //TR: Bu görünüm Ayarlar alanıdır: PS-1B ile "AI Yürütücüleri" paneli eklendi; dil seçimi (Türkçe varsayılan, İngilizce; localStorage'da kalıcı), klavye kısayolları ve yerel kimlik bilgisi; hiçbir gizli bilgi veya token gösterilmez.
import {h,panel} from "../components.js";
import {LANGS} from "../i18n.js";
import {executorsPanel} from "./executors-panel.js";

export async function render(ctx){
  const doc=ctx.doc;
  const langs=h(doc,"div",{class:"btn-row",role:"group","aria-label":ctx.t("settings.language")},LANGS.map(l=>h(doc,"button",{type:"button",class:"btn",dataset:{lang:l},"aria-pressed":ctx.i18n.lang===l?"true":"false",on:{click:()=>ctx.i18n.setLang(l)},text:ctx.t(`lang.${l}`)})));
  return h(doc,"div",{class:"view"},h(doc,"h1",{id:"view-title",tabindex:"-1",text:ctx.t("area.settings.title")}),
    panel(ctx,{titleKey:"settings.language",id:"settings-lang"},langs,h(doc,"p",{class:"note",text:ctx.t("settings.languageNote")})),
    panel(ctx,{titleKey:"settings.shortcuts",id:"settings-keys"},h(doc,"dl",{class:"kv"},h(doc,"dt",{},h(doc,"kbd",{text:"Ctrl+K"})),h(doc,"dd",{text:ctx.t("shortcut.search")}),h(doc,"dt",{},h(doc,"kbd",{text:"Esc"})),h(doc,"dd",{text:ctx.t("shortcut.esc")}),h(doc,"dt",{},h(doc,"kbd",{text:"Tab"})),h(doc,"dd",{text:ctx.t("shortcut.tab")}))),
    await executorsPanel(ctx),
    panel(ctx,{titleKey:"settings.principal",id:"settings-principal"},h(doc,"p",{class:"mono",text:ctx.principal}),h(doc,"p",{class:"note",text:ctx.t("settings.principalNote")})));
}
