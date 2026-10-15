// //TR: Bu modül Control Tower 2B haritasını kabuğa bağlar: kampüs modelinden (gerçek okuma girdisi) hem SVG haritayı hem eşdeğer erişilebilir listeyi aynı modelle üretir, HTML dizgesi enjekte etmeden DOM'a çevirir, klavye (Tab, Enter/Boşluk) ile lonca seçimi ve mevcut ekranlara (AI İş Gücü, Görevler) geçiş verir; hareket/parıltı animasyonu yoktur (reducedMotion her zaman açık), 3B yoktur ve 3B çalışıyormuş gibi gösterilmez.
import { h } from "../components.js";
import { buildCampusModel } from "./model.js";
import { renderCampusSvg } from "./render-svg.js";
import { renderCampusList } from "./list-view.js";
import { markupToNodes } from "./markup.js";
import { tr as campusTr } from "./locales.js";

/** Seçili lonca kimliği (yenilemeler arasında korunur); modelde yoksa yok sayılır. */
export const campusSelection = { guildId: null };

const walk = (n, fn) => {
  fn(n);
  for (const c of Array.from(n.children ?? [])) walk(c, fn);
};
const attr = (n, k) => (typeof n.getAttribute === "function" ? n.getAttribute(k) : null);

export function mountCampus(ctx, input) {
  const doc = ctx.doc;
  const locale = ctx.i18n.lang === "en" ? "en" : "tr";
  const model = buildCampusModel(input);
  const na = campusTr(locale, "na");
  const num = (v) => (v === null || v === undefined ? na : String(v));
  const byGuild = new Map(model.buildings.map((b) => [b.guildId, b]));
  if (campusSelection.guildId && !byGuild.has(campusSelection.guildId)) campusSelection.guildId = null;

  // Reduce-motion: harita her zaman durağandır (animate elemanı yok); parıltı yalnız sabit filtredir.
  const svgNodes = markupToNodes(doc, renderCampusSvg(model, { locale, reducedMotion: true, t: 0 }));
  const listNodes = markupToNodes(doc, renderCampusList(model, { locale }));
  const root = h(doc, "div", { class: "ct-campus", dataset: { globalState: model.globalState, campusState: model.campusState, districts: model.districts.length, buildings: model.buildings.length } });
  if (!svgNodes || !listNodes) {
    root.append(h(doc, "p", { class: "note note-error", role: "alert", text: ctx.t("state.ERROR") }));
    return root;
  }

  const t = model.totals;
  const summary = h(doc, "p", { class: "ct-summary", dataset: { ctSummary: "1" },
    text: model.dataState.catalog ? ctx.t("tower.map.summary", { districts: t.districts, buildings: t.buildings, roles: num(t.targetRoles), active: num(t.activeRuns) }) : ctx.t("tower.map.summaryNone") });
  const feeds = h(doc, "p", { class: "note ct-feeds", dataset: { catalog: String(model.dataState.catalog), cockpit: String(model.dataState.cockpit), runs: String(model.dataState.runs) },
    text: ctx.t("tower.map.feeds", {
      status: ctx.t(model.dataState.cockpit ? "tower.map.feedOk" : "tower.map.feedNone"),
      catalog: ctx.t(model.dataState.catalog ? "tower.map.feedOk" : "tower.map.feedNone"),
      runs: ctx.t(model.dataState.runs ? "tower.map.feedOk" : "tower.map.feedNone")
    }) });

  const targets = [];
  const detail = h(doc, "div", { class: "ct-detail", id: "ct-detail", "aria-live": "polite" });

  function renderDetail() {
    const b = campusSelection.guildId ? byGuild.get(campusSelection.guildId) : null;
    if (!b) {
      detail.replaceChildren(h(doc, "p", { class: "note", text: ctx.t("tower.map.pick") }));
      return;
    }
    const ok = b.state === "VERIFIED";
    const fact = (k, v) => h(doc, "div", { class: "fact", dataset: { fact: k } }, h(doc, "span", { class: "fact-label", text: ctx.t(k) }), h(doc, "strong", { class: "fact-value", text: v }));
    detail.replaceChildren(
      h(doc, "h3", { text: ctx.t("tower.map.selected", { name: b.name }) }),
      h(doc, "div", { class: "facts" },
        fact("tower.map.cluster", b.clusterId),
        fact("tower.map.targetRoles", ok ? String(b.targetRoles) : na),
        fact("tower.map.activeRuns", ok && b.activeRuns !== null ? String(b.activeRuns) : na),
        fact("tower.map.state", campusTr(locale, ok ? "verified" : "unavailable"))),
      h(doc, "p", { class: "note", text: campusTr(locale, "capacityNote") }),
      h(doc, "div", { class: "btn-row" },
        h(doc, "button", { type: "button", class: "btn", id: "ct-open-workforce", on: { click: () => ctx.navigate("workforce") }, text: ctx.t("tower.map.openWorkforce") }),
        h(doc, "button", { type: "button", class: "btn", id: "ct-open-work", on: { click: () => ctx.navigate("work") }, text: ctx.t("tower.map.openWork") })));
  }
  function sync() {
    for (const x of targets) {
      const on = x.guildId === campusSelection.guildId;
      x.node.setAttribute("aria-pressed", on ? "true" : "false");
      x.node.setAttribute("data-selected", on ? "true" : "false");
    }
    renderDetail();
  }
  function select(guildId) {
    campusSelection.guildId = guildId;
    sync();
  }

  // Harita: her bina Tab ile odaklanır; Enter veya Boşluk seçer (fare ile aynı).
  for (const svg of svgNodes) {
    walk(svg, (n) => {
      if (attr(n, "class") === "building" && attr(n, "data-guild-id")) {
        const id = attr(n, "data-guild-id");
        n.setAttribute("role", "button");
        n.setAttribute("tabindex", "0");
        n.setAttribute("data-focus-key", `ct-b-${id}`);
        n.addEventListener("click", () => select(id));
        n.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            select(id);
          }
        });
        targets.push({ guildId: id, node: n });
      }
    });
  }
  // Liste: lonca adı düğmeye dönüşür (aynı seçim); tablo biçimlendirme sınıfı alır.
  for (const sec of listNodes) {
    walk(sec, (n) => {
      if (String(n.tagName).toLowerCase() === "table") n.setAttribute("class", "table");
      if (String(n.tagName).toLowerCase() === "tr" && attr(n, "data-guild-id")) {
        const id = attr(n, "data-guild-id");
        const cell = Array.from(n.children)[1];
        if (!cell) return;
        const btn = h(doc, "button", { type: "button", class: "link-btn", dataset: { focusKey: `ct-l-${id}`, ctGuild: id }, "aria-pressed": "false", on: { click: () => select(id) }, text: cell.textContent });
        cell.replaceChildren(btn);
        targets.push({ guildId: id, node: btn });
      }
    });
  }
  sync();

  root.append(summary, feeds,
    h(doc, "p", { class: "note ct-no3d", dataset: { ct3d: "none" }, text: ctx.t("tower.map.no3d") }),
    h(doc, "div", { class: "ct-map", role: "region", tabindex: "0", "aria-label": ctx.t("tower.map.mapLabel") }, ...svgNodes),
    detail,
    h(doc, "div", { class: "table-wrap ct-list", role: "region", "aria-label": ctx.t("tower.map.listLabel") }, ...listNodes));
  return root;
}
