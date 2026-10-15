// //TR: Bu modül Control Tower kampüs modülünün tr/en metin sözlüğünü, değişken yerleştirmeyi ve tek HTML/SVG kaçış fonksiyonunu verir; kabuk bu sözlüğü sonra kendi sözlüğüyle birleştirir.
export const LIVE_STATUSES = Object.freeze(["LEASED", "RUNNING", "CHECKPOINTING", "VERIFYING"]);

export const STRINGS = Object.freeze({
  tr: Object.freeze({
    svgLabel: "UASCO Control Tower 2B kampüs haritası",
    towerName: "UASCO Control Tower",
    towerLine1: "UASCO",
    towerLine2: "CONTROL TOWER",
    countLine: "{n} hedef rol · {m} aktif",
    countUnavailable: "VERİ YOK",
    buildingAria: "{name}: {n} hedef rol, {m} aktif run, durum {state}",
    buildingAriaUnavailable: "{name}: veri yok",
    buildingTitle: "{name} · {n} hedef rol (katalog kapasitesi) · {m} aktif run",
    buildingTitleUnavailable: "{name} — veri yok",
    districtAria: "{name} bölgesi, {count} bina",
    stateRunning: "ÇALIŞIYOR",
    stateStopped: "DURDURULDU",
    stateUnavailable: "VERİ YOK",
    stoppedOverlay: "DURDURULDU · GLOBAL STOP aktif",
    stoppedReason: "Sebep: {reason}",
    noCatalog: "Katalog verisi yok; kampüs çizilemiyor.",
    capacityNote: "Hedef roller katalog kapasitesidir; çalışan ajan değildir.",
    verified: "Doğrulandı",
    unavailable: "Veri yok",
    listCaption: "Kampüs listesi (2B eşdeğer görünüm)",
    colCluster: "Küme",
    colGuild: "Lonca",
    colTarget: "Hedef rol",
    colActive: "Aktif run",
    colState: "Durum",
    globalStateLabel: "Genel durum",
    unattributedRuns: "Binaya atanamayan aktif run: {n}",
    na: "veri yok"
  }),
  en: Object.freeze({
    svgLabel: "UASCO Control Tower 2D campus map",
    towerName: "UASCO Control Tower",
    towerLine1: "UASCO",
    towerLine2: "CONTROL TOWER",
    countLine: "{n} target roles · {m} active",
    countUnavailable: "NO DATA",
    buildingAria: "{name}: {n} target roles, {m} active runs, state {state}",
    buildingAriaUnavailable: "{name}: no data",
    buildingTitle: "{name} · {n} target roles (catalog capacity) · {m} active runs",
    buildingTitleUnavailable: "{name} — no data",
    districtAria: "{name} district, {count} buildings",
    stateRunning: "RUNNING",
    stateStopped: "STOPPED",
    stateUnavailable: "NO DATA",
    stoppedOverlay: "STOPPED · GLOBAL STOP active",
    stoppedReason: "Reason: {reason}",
    noCatalog: "No catalog data; the campus cannot be drawn.",
    capacityNote: "Target roles are catalog capacity, not running agents.",
    verified: "Verified",
    unavailable: "No data",
    listCaption: "Campus list (2D equivalent view)",
    colCluster: "Cluster",
    colGuild: "Guild",
    colTarget: "Target roles",
    colActive: "Active runs",
    colState: "State",
    globalStateLabel: "Global state",
    unattributedRuns: "Active runs not attributable to a building: {n}",
    na: "no data"
  })
});

export function pickLocale(locale) {
  return locale === "en" ? "en" : "tr";
}

export function tr(locale, key, vars = {}) {
  const dict = STRINGS[pickLocale(locale)];
  const raw = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  return raw.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function truncate(value, max) {
  const chars = Array.from(String(value));
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}
