// //TR: Bu modül kampüs modelinin erişilebilir 2B tablo eşdeğerini üretir (klavye/ekran okuyucu ve düşük GPU yedeği); SVG ile aynı id ve sayıları aynı data-* özniteliklerinde taşır, tüm metin kaçışlıdır.
import { esc, tr } from "./locales.js";

function stateLabel(locale, state) {
  return tr(locale, state === "STOPPED" ? "stateStopped" : state === "RUNNING" ? "stateRunning" : "stateUnavailable");
}

export function renderCampusList(model, opts = {}) {
  const locale = opts.locale === "en" ? "en" : "tr";
  const out = [];
  const stopped = model.globalState === "STOPPED";
  out.push(`<section class="ct-list" aria-label="${esc(tr(locale, "listCaption"))}" data-global-state="${esc(model.globalState)}" data-districts="${model.districts.length}" data-buildings="${model.buildings.length}">`);
  out.push(`<p class="ct-global"${stopped ? ' role="alert"' : ' role="status"'}>${esc(tr(locale, "globalStateLabel"))}: <strong>${esc(stateLabel(locale, model.globalState))}</strong>${stopped && model.stopReason ? " · " + esc(tr(locale, "stoppedReason", { reason: model.stopReason })) : ""}</p>`);
  out.push(`<p class="ct-note">${esc(tr(locale, "capacityNote"))}</p>`);
  if (!model.dataState.catalog) out.push(`<p class="ct-notice" role="status">${esc(tr(locale, "noCatalog"))}</p>`);
  if (model.totals.unattributedActiveRuns) out.push(`<p class="ct-note">${esc(tr(locale, "unattributedRuns", { n: model.totals.unattributedActiveRuns }))}</p>`);
  out.push(`<table><caption>${esc(tr(locale, "listCaption"))}</caption><thead><tr>`);
  for (const k of ["colCluster", "colGuild", "colTarget", "colActive", "colState"]) out.push(`<th scope="col">${esc(tr(locale, k))}</th>`);
  out.push(`</tr></thead>`);
  for (const d of model.districts) {
    out.push(`<tbody data-cluster-id="${esc(d.clusterId)}" data-state="${esc(d.state)}">`);
    for (const b of model.buildings) {
      if (b.clusterId !== d.clusterId) continue;
      const ok = b.state === "VERIFIED";
      const na = tr(locale, "na");
      out.push(
        `<tr data-guild-id="${esc(b.guildId)}" data-cluster-id="${esc(b.clusterId)}" data-target-roles="${ok ? b.targetRoles : "na"}" data-active-runs="${ok && b.activeRuns !== null ? b.activeRuns : "na"}" data-state="${esc(b.state)}">` +
          `<th scope="row">${esc(d.name)}</th><td>${esc(b.name)}</td>` +
          `<td>${ok ? esc(b.targetRoles) : esc(na)}</td><td>${ok && b.activeRuns !== null ? esc(b.activeRuns) : esc(na)}</td>` +
          `<td>${esc(ok ? tr(locale, "verified") : tr(locale, "unavailable"))}</td></tr>`
      );
    }
    out.push(`</tbody>`);
  }
  out.push(`</table></section>`);
  return out.join("");
}
