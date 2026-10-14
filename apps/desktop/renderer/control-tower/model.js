// //TR: Bu modül cockpit/katalog/run girdisinden deterministik, saf (DOM'suz) kampüs modeli üretir: 10 bölge, 51 bina, merkez kule; eksik veri için sayı uydurmaz (UNAVAILABLE + null), GLOBAL_STOP tüm kampüsü STOPPED yapar.
import { LIVE_STATUSES } from "./locales.js";

export const MODEL_SCHEMA = "uasco.control-tower.campus/1";

const LIVE = new Set(LIVE_STATUSES);
const PLATE_W = 270;
const PAD = 13;
const BLD_W = 118;
const BLD_H = 40;
const BLD_GAP_X = 8;
const BLD_STEP_Y = 46;
const HEADER_H = 30;
const MARGIN = 20;
const MID_GAP = 80;
const COL_STEP = 360;
const COL_X0 = 60;
const MIN_ROWS = 4;

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const r2 = (n) => Math.round(n * 100) / 100;

function readCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.clusters) || !Array.isArray(catalog.guilds)) return null;
  const clusters = new Map();
  for (const c of catalog.clusters) {
    const id = str(c?.clusterId);
    if (id && !clusters.has(id)) clusters.set(id, { clusterId: id, name: str(c?.name) ?? id });
  }
  const guilds = new Map();
  const orphanGuildIds = [];
  for (const g of catalog.guilds) {
    const id = str(g?.guildId);
    if (!id || guilds.has(id)) continue;
    const clusterId = str(g?.clusterId);
    if (!clusterId || !clusters.has(clusterId)) {
      orphanGuildIds.push(id);
      continue;
    }
    guilds.set(id, { guildId: id, clusterId, name: str(g?.name) ?? id });
  }
  const roles = catalog.roles && typeof catalog.roles === "object" && !Array.isArray(catalog.roles) ? catalog.roles : null;
  return { clusters, guilds, roles, orphanGuildIds: orphanGuildIds.sort(byId) };
}

function readLiveRuns(runs) {
  if (!Array.isArray(runs)) return null;
  const seen = new Set();
  const live = [];
  for (const r of runs) {
    const runId = str(r?.runId);
    const status = str(r?.status)?.toUpperCase() ?? null;
    if (!runId || seen.has(runId) || !status || !LIVE.has(status)) continue;
    seen.add(runId);
    live.push({ runId, guildId: str(r?.guildId) });
  }
  return live;
}

// Slots run clockwise from the top-left: 4 top, 1 right, 4 bottom (right to left), 1 left; extras go to overflow rows.
function districtSlot(i, H, baseH) {
  const topY = MARGIN;
  const midY = r2((baseH - H) / 2);
  const botY = MARGIN + H + H + MID_GAP;
  if (i < 4) return { x: COL_X0 + i * COL_STEP, y: topY };
  if (i === 4) return { x: COL_X0 + 3 * COL_STEP, y: midY };
  if (i < 9) return { x: COL_X0 + (8 - i) * COL_STEP, y: botY };
  if (i === 9) return { x: COL_X0, y: midY };
  const k = i - 10;
  return { x: COL_X0 + (k % 4) * COL_STEP, y: botY + (1 + Math.floor(k / 4)) * (H + MARGIN) };
}

export function buildCampusModel(input) {
  const cockpit = input && typeof input === "object" ? input.cockpit ?? null : null;
  const cat = readCatalog(input?.catalog);
  const liveRuns = readLiveRuns(input?.runs);

  const stopActive = cockpit && typeof cockpit === "object" && typeof cockpit.globalStop?.active === "boolean" ? cockpit.globalStop.active : null;
  const cockpitOk = stopActive !== null;
  const globalState = !cockpitOk ? "UNAVAILABLE" : stopActive ? "STOPPED" : "RUNNING";
  const stopReason = stopActive ? str(cockpit.globalStop.reason) : null;

  const clusterList = cat ? [...cat.clusters.values()].sort((a, b) => byId(a.clusterId, b.clusterId)) : [];
  const guildsByCluster = new Map(clusterList.map((c) => [c.clusterId, []]));
  if (cat) for (const g of [...cat.guilds.values()].sort((a, b) => byId(a.guildId, b.guildId))) guildsByCluster.get(g.clusterId).push(g);

  const maxRows = Math.max(MIN_ROWS, ...clusterList.map((c) => Math.ceil(guildsByCluster.get(c.clusterId).length / 2)));
  const H = HEADER_H + maxRows * BLD_STEP_Y + 8;
  const width = COL_X0 * 2 + 3 * COL_STEP + PLATE_W;
  const baseH = MARGIN * 2 + H * 3 + MID_GAP;
  const extraRows = Math.max(0, Math.ceil((clusterList.length - 10) / 4));
  const height = baseH + extraRows * (H + MARGIN);

  const activeBy = new Map();
  let unattributed = 0;
  if (liveRuns) {
    for (const r of liveRuns) {
      if (r.guildId && cat?.guilds.has(r.guildId)) activeBy.set(r.guildId, (activeBy.get(r.guildId) ?? 0) + 1);
      else unattributed += 1;
    }
  }

  const districts = [];
  const buildings = [];
  clusterList.forEach((c, i) => {
    const slot = districtSlot(i, H, baseH);
    const blds = guildsByCluster.get(c.clusterId).map((g, j) => {
      const target = cat.roles ? count(cat.roles[g.guildId]) : null;
      const verified = cockpitOk && target !== null;
      return {
        guildId: g.guildId,
        clusterId: g.clusterId,
        name: g.name,
        x: r2(slot.x + PAD + (j % 2) * (BLD_W + BLD_GAP_X)),
        y: r2(slot.y + HEADER_H + Math.floor(j / 2) * BLD_STEP_Y),
        width: BLD_W,
        height: BLD_H,
        targetRoles: verified ? target : null,
        activeRuns: verified && liveRuns ? activeBy.get(g.guildId) ?? 0 : null,
        state: verified ? "VERIFIED" : "UNAVAILABLE"
      };
    });
    buildings.push(...blds);
    const known = blds.length > 0 && blds.every((b) => b.state === "VERIFIED");
    districts.push({
      clusterId: c.clusterId,
      name: c.name,
      x: slot.x,
      y: slot.y,
      width: PLATE_W,
      height: H,
      buildingCount: blds.length,
      targetRoles: known ? blds.reduce((s, b) => s + b.targetRoles, 0) : null,
      activeRuns: known && liveRuns ? blds.reduce((s, b) => s + b.activeRuns, 0) : null,
      state: known ? "VERIFIED" : "UNAVAILABLE"
    });
  });

  const allKnown = buildings.length > 0 && buildings.every((b) => b.state === "VERIFIED");
  return {
    schema: MODEL_SCHEMA,
    globalState,
    stopReason,
    dataState: { cockpit: cockpitOk, catalog: cat !== null, runs: liveRuns !== null },
    campusState: allKnown ? "VERIFIED" : "UNAVAILABLE",
    canvas: { width, height },
    tower: { id: "TOWER", name: "UASCO Control Tower", x: width / 2, y: r2(baseH / 2), r: 90 },
    districts,
    buildings,
    totals: {
      districts: districts.length,
      buildings: buildings.length,
      targetRoles: allKnown ? buildings.reduce((s, b) => s + b.targetRoles, 0) : null,
      activeRuns: allKnown && liveRuns ? buildings.reduce((s, b) => s + b.activeRuns, 0) : null,
      unattributedActiveRuns: allKnown && liveRuns ? unattributed : null
    },
    diagnostics: { orphanGuildIds: cat ? cat.orphanGuildIds : [] }
  };
}
