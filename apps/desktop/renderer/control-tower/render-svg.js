// //TR: Bu modül kampüs modelini lacivert/camgöbeği neon dilinde SVG metnine çevirir; tüm metin kaçışlanır, yalnız sunum öznitelikleri kullanılır (CSP style-src 'self'), reducedMotion için animasyon elemanı üretilmez, her binada title ve aria-label vardır.
import { esc, tr, truncate } from "./locales.js";

const C = {
  bg0: "#07142c",
  bg1: "#030814",
  plate: "#0a1a36",
  plateStroke: "#22d3ee",
  building: "#0d2748",
  text: "#e6f7ff",
  muted: "#7fa6c4",
  cyan: "#22d3ee",
  live: "#34d399",
  off: "#64748b",
  stop: "#ff4d6d"
};
const FONT = "Segoe UI, system-ui, sans-serif";

function stateLabel(locale, state) {
  return tr(locale, state === "STOPPED" ? "stateStopped" : state === "RUNNING" ? "stateRunning" : "stateUnavailable");
}

function phase(t) {
  const n = Number.isFinite(t) ? t : 0;
  return Math.round((((n % 4) + 4) % 4) * 1000) / 1000;
}

function buildingSvg(b, locale, model, animate, p) {
  const ok = b.state === "VERIFIED";
  const live = ok && b.activeRuns !== null && b.activeRuns > 0;
  const n = ok ? b.targetRoles : "na";
  const m = ok && b.activeRuns !== null ? b.activeRuns : "na";
  const stroke = ok ? (live ? C.live : C.cyan) : C.off;
  const dash = ok ? "" : ' stroke-dasharray="4 3"';
  const aria = ok
    ? tr(locale, "buildingAria", { name: b.name, n: b.targetRoles, m: b.activeRuns ?? tr(locale, "na"), state: tr(locale, "verified") })
    : tr(locale, "buildingAriaUnavailable", { name: b.name });
  const title = ok
    ? tr(locale, "buildingTitle", { name: b.name, n: b.targetRoles, m: b.activeRuns ?? tr(locale, "na") })
    : tr(locale, "buildingTitleUnavailable", { name: b.name });
  const countText = ok && b.activeRuns !== null ? tr(locale, "countLine", { n: b.targetRoles, m: b.activeRuns }) : tr(locale, "countUnavailable");
  const cx = b.x + b.width / 2;
  const roof = `<path d="M${b.x} ${b.y + 6} L${b.x + 8} ${b.y} H${b.x + b.width - 8} L${b.x + b.width} ${b.y + 6}" fill="none" stroke="${stroke}" stroke-opacity="0.9" stroke-width="1.5"/>`;
  const beacon = live ? `<circle cx="${b.x + b.width - 8}" cy="${b.y + 10}" r="3" fill="${C.live}"${animate ? `><animate attributeName="opacity" values="1;0.3;1" dur="2s" begin="${-p}s" repeatCount="indefinite"/></circle>` : "/>"}` : "";
  return (
    `<g class="building" role="img" aria-label="${esc(aria)}" data-guild-id="${esc(b.guildId)}" data-cluster-id="${esc(b.clusterId)}" data-target-roles="${n}" data-active-runs="${m}" data-state="${esc(b.state)}">` +
    `<title>${esc(title)}</title>` +
    `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="5" fill="${C.building}" fill-opacity="0.95" stroke="${stroke}" stroke-width="1.2"${dash}${ok ? ' filter="url(#ct-glow)"' : ""}/>` +
    roof +
    beacon +
    `<text x="${cx}" y="${b.y + 18}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="600" fill="${C.text}">${esc(truncate(b.name, 20))}</text>` +
    `<text class="count" x="${cx}" y="${b.y + 32}" text-anchor="middle" font-family="${FONT}" font-size="9" fill="${ok ? C.muted : C.off}">${esc(countText)}</text>` +
    `</g>`
  );
}

export function renderCampusSvg(model, opts = {}) {
  const locale = opts.locale === "en" ? "en" : "tr";
  const stopped = model.globalState === "STOPPED";
  const animate = !opts.reducedMotion && !stopped;
  const p = phase(opts.t);
  const { width, height } = model.canvas;
  const tw = model.tower;
  const out = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="group" aria-label="${esc(tr(locale, "svgLabel"))}" data-global-state="${esc(model.globalState)}" data-campus-state="${esc(model.campusState)}" data-districts="${model.districts.length}" data-buildings="${model.buildings.length}">`
  );
  out.push(`<title>${esc(tr(locale, "svgLabel"))}</title><desc>${esc(tr(locale, "capacityNote"))}</desc>`);
  out.push(
    `<defs><radialGradient id="ct-bg" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></radialGradient>` +
      `<radialGradient id="ct-core" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#7be9ff"/><stop offset="0.55" stop-color="#1a6fb4"/><stop offset="1" stop-color="#0a2a55"/></radialGradient>` +
      `<filter id="ct-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
  );
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="url(#ct-bg)"/>`);

  // Connection lines under the plates; dashed + flowing only for buildings with live runs.
  out.push(`<g class="links" aria-hidden="true">`);
  for (const b of model.buildings) {
    const live = b.state === "VERIFIED" && b.activeRuns !== null && b.activeRuns > 0;
    const stroke = b.state === "VERIFIED" ? (live ? C.live : C.cyan) : C.off;
    const flow = live && animate ? `><animate attributeName="stroke-dashoffset" from="0" to="-24" dur="1.5s" begin="${-p}s" repeatCount="indefinite"/></line>` : "/>";
    out.push(
      `<line x1="${tw.x}" y1="${tw.y}" x2="${b.x + b.width / 2}" y2="${b.y + b.height / 2}" stroke="${stroke}" stroke-opacity="${live ? 0.7 : 0.22}" stroke-width="${live ? 1.6 : 1}"${live ? ' stroke-dasharray="8 4"' : ""}${flow}`
    );
  }
  out.push(`</g>`);

  for (const d of model.districts) {
    const ariaD = tr(locale, "districtAria", { name: d.name, count: d.buildingCount });
    out.push(
      `<g class="district" role="group" aria-label="${esc(ariaD)}" data-cluster-id="${esc(d.clusterId)}" data-state="${esc(d.state)}">` +
        `<title>${esc(d.name)}</title>` +
        `<rect x="${d.x}" y="${d.y}" width="${d.width}" height="${d.height}" rx="12" fill="${C.plate}" fill-opacity="0.94" stroke="${d.state === "VERIFIED" ? C.plateStroke : C.off}" stroke-opacity="0.8" stroke-width="1.4"${d.state === "VERIFIED" ? ' filter="url(#ct-glow)"' : ' stroke-dasharray="6 4"'}/>` +
        `<text x="${d.x + 13}" y="${d.y + 20}" font-family="${FONT}" font-size="12" font-weight="700" fill="${C.cyan}">${esc(truncate(d.name, 34))}</text>`
    );
    for (const b of model.buildings) if (b.clusterId === d.clusterId) out.push(buildingSvg(b, locale, model, animate, p));
    out.push(`</g>`);
  }

  const stateColor = model.globalState === "RUNNING" ? C.live : model.globalState === "STOPPED" ? C.stop : C.off;
  out.push(
    `<g class="tower" role="img" aria-label="${esc(tr(locale, "towerName") + " — " + stateLabel(locale, model.globalState))}" data-state="${esc(model.globalState)}">` +
      `<title>${esc(tr(locale, "towerName"))}</title>` +
      `<circle cx="${tw.x}" cy="${tw.y}" r="${tw.r}" fill="none" stroke="${C.cyan}" stroke-opacity="0.35" stroke-width="1.5"/>` +
      (animate ? `<circle cx="${tw.x}" cy="${tw.y}" r="${tw.r - 10}" fill="none" stroke="${C.cyan}" stroke-opacity="0.5" stroke-width="2"><animate attributeName="r" values="${tw.r - 14};${tw.r + 6};${tw.r - 14}" dur="4s" begin="${-p}s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.6;0;0.6" dur="4s" begin="${-p}s" repeatCount="indefinite"/></circle>` : "") +
      `<circle cx="${tw.x}" cy="${tw.y}" r="${tw.r - 22}" fill="url(#ct-core)" stroke="${C.cyan}" stroke-width="2" filter="url(#ct-glow)"/>` +
      `<text x="${tw.x}" y="${tw.y - 2}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="${C.text}">${esc(tr(locale, "towerLine1"))}</text>` +
      `<text x="${tw.x}" y="${tw.y + 14}" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="${C.text}">${esc(tr(locale, "towerLine2"))}</text>` +
      `<text class="tower-state" x="${tw.x}" y="${tw.y + tw.r + 18}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${stateColor}">${esc(stateLabel(locale, model.globalState))}</text>` +
      `</g>`
  );

  if (!model.dataState.catalog) {
    out.push(`<text class="notice" role="status" x="${tw.x}" y="${tw.y + tw.r + 40}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${C.muted}">${esc(tr(locale, "noCatalog"))}</text>`);
  }
  out.push(`<text class="capacity-note" x="${width / 2}" y="${height - 6}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${C.muted}">${esc(tr(locale, "capacityNote"))}</text>`);

  if (stopped) {
    const reason = model.stopReason ? tr(locale, "stoppedReason", { reason: model.stopReason }) : "";
    out.push(
      `<g class="stopped-overlay" role="alert" pointer-events="none">` +
        `<rect x="0" y="0" width="${width}" height="${height}" fill="${C.stop}" fill-opacity="0.18"/>` +
        `<rect x="${width / 2 - 300}" y="${tw.y - 38}" width="600" height="${reason ? 76 : 56}" rx="10" fill="#1a0610" fill-opacity="0.92" stroke="${C.stop}" stroke-width="2"/>` +
        `<text x="${width / 2}" y="${tw.y - 8}" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="800" fill="${C.stop}">${esc(tr(locale, "stoppedOverlay"))}</text>` +
        (reason ? `<text x="${width / 2}" y="${tw.y + 20}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${C.text}">${esc(truncate(reason, 90))}</text>` : "") +
        `</g>`
    );
  }
  out.push(`</svg>`);
  return out.join("");
}
