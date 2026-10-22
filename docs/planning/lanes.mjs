// //TR: Bu modül A-Z 26 üretim hattının canonical kaydını (docs/planning/LANES.json) fail-closed doğrular ve mevcut dispatcher'ın (dispatch.mjs) seçilebilir görevlerini uzmanlık (sahip olunan yol), dosya çakışması, hat/küresel kota ve CI kapasitesine göre hatlara ve dalgalara (wave) yönlendirir. İkinci bir orkestratör değildir: durum yazmaz, claim yapmaz; claim yalnız dispatch.mjs --claim --lane ile yapılır.
// Usage: node docs/planning/lanes.mjs --report [--backlog <path>] [--lanes <path>]   (read-only; prints exactly one JSON line; exit 0 OK, 2 BLOCKED)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PROTECTED_FLOOR, PROTECTED_FLOOR_EXACT, CI_EXECUTED_FLOOR, normPath} from "./merge-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
export const LANE_IDS = Object.freeze([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
export const LANE_STATUSES = Object.freeze(["ACTIVE", "STANDBY"]);
export const DONE_STATUSES = Object.freeze(["DONE", "CLOSED"]);
const OWNER_KINDS = new Set(["LANE_BUILDER", "COORDINATOR", "UNSTAFFED"]);
const MODELS = new Set(["haiku", "sonnet", "opus"]);
const IN_FLIGHT_STATUSES = new Set(["IN_PROGRESS", "IN_REVIEW", "CLAIMED"]);
const TYPE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const PKG_RE = /^[A-Z][A-Z0-9-]{0,63}$/;
const SESSION_RE = /^session_[A-Za-z0-9]{8,64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class LaneError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new LaneError(code); };
const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const safeTaskId = id => isStr(id) && ID_RE.test(id) ? id : "?";

// A registry path must already be in normal form: relative, "/" separators, no "." or ".." segments, no doubled "/".
const okPath = p => isStr(p) && p.length > 0 && p.length <= 200 && p === p.trim() && !p.includes("\\") && !p.includes("\0")
  && normPath(p) !== null && normPath(p) === p.toLowerCase();
// An entry ending in "/" or "-" is a prefix; any other entry is one exact file. A task may name a directory ("apps/mobile/src"): it is covered by "apps/mobile/src/".
export const covers = (entry, file) => (entry.endsWith("/") || entry.endsWith("-")) ? (file.startsWith(entry) || `${file}/` === entry) : file === entry;
// Two task paths overlap when they are equal or one is a directory of the other.
export const pathsOverlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

// Protected trust-root, CI-executed and supervisor-owned paths are never granted to a lane and never routed. pp = config/protected-paths.json.
export function protectedMatcher(pp) {
  if (!isObj(pp) || !Array.isArray(pp.exactPaths) || !Array.isArray(pp.protectedPrefixes)) fail("PROTECTED_PATHS_INVALID");
  const exact = new Set([...PROTECTED_FLOOR_EXACT, ...pp.exactPaths.map(normPath).filter(Boolean)]);
  const prefixes = [...PROTECTED_FLOOR, ...pp.protectedPrefixes].map(normPath).filter(Boolean);
  const state = (Array.isArray(pp.stateOwnedBySupervisor) ? pp.stateOwnedBySupervisor : []).map(normPath).filter(Boolean);
  const ciExact = new Set(), ciPrefix = [];
  for (const [m, , isPrefix] of CI_EXECUTED_FLOOR) (isPrefix ? ciPrefix.push(normPath(m)) : ciExact.add(normPath(m)));
  return n => {
    if (exact.has(n) || prefixes.some(p => n.startsWith(p))) return "PROTECTED_PATH";
    if (ciExact.has(n) || ciPrefix.some(p => n.startsWith(p))) return "CI_EXECUTED_PATH";
    if (state.some(p => n.startsWith(p))) return "SUPERVISOR_STATE_PATH";
    return null;
  };
}
// The protected list is read from THIS module's own repository (import.meta.url), never from the caller's cwd.
let repoMatcher = null;
export function repoProtectedMatcher() {
  if (repoMatcher) return repoMatcher;
  let pp;
  try { pp = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config/protected-paths.json"), "utf8")); } catch { fail("PROTECTED_PATHS_UNAVAILABLE"); }
  return (repoMatcher = protectedMatcher(pp));
}

export function loadLaneRegistry(file, opts = {}) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { fail("LANES_MISSING"); }
  let doc;
  try { doc = JSON.parse(raw); } catch { fail("LANES_UNPARSEABLE"); }
  return validateLaneRegistry(doc, opts);
}

// Fail-closed: any structural problem throws LaneError(code); a valid registry is returned frozen and normalised (paths lower case).
export function validateLaneRegistry(doc, {matcher = repoProtectedMatcher()} = {}) {
  if (!isObj(doc)) fail("LANES_SCHEMA_INVALID:root");
  if (doc.schemaVersion !== "1.0.0") fail("LANES_SCHEMA_INVALID:schemaVersion");
  const cap = doc.capacity;
  if (!isObj(cap) || !intIn(cap.builderCap, 1, 26) || !intIn(cap.ciSlots, 1, 26)) fail("LANES_SCHEMA_INVALID:capacity");
  const shared = doc.sharedPaths ?? [];
  if (!Array.isArray(shared) || !shared.every(p => okPath(p) && p.endsWith("/"))) fail("LANES_SCHEMA_INVALID:sharedPaths");
  if (!Array.isArray(doc.lanes) || doc.lanes.length !== LANE_IDS.length) fail("LANES_COUNT_NOT_26");
  const owners = new Map();
  const lanes = doc.lanes.map((l, i) => {
    const id = LANE_IDS[i];
    if (!isObj(l) || l.id !== id) fail(`LANES_ORDER_INVALID:${id}`);
    const bad = f => fail(`LANE_INVALID:${id}:${f}`);
    if (!isStr(l.name) || !l.name.trim() || l.name.length > 80) bad("name");
    if (!LANE_STATUSES.includes(l.status)) bad("status");
    const o = l.ownership;
    if (!isObj(o) || !OWNER_KINDS.has(o.owner)) bad("ownership");
    const staffed = o.owner !== "UNSTAFFED";
    if (staffed ? !(isStr(o.session) && SESSION_RE.test(o.session)) : o.session !== null) bad("ownership.session");
    if ((l.status === "ACTIVE") !== staffed) bad("status/ownership");
    if (!MODELS.has(l.model)) bad("model");
    if (!Array.isArray(l.taskTypes) || !l.taskTypes.length || !l.taskTypes.every(t => isStr(t) && TYPE_RE.test(t))) bad("taskTypes");
    if (!Array.isArray(l.packages) || !l.packages.every(p => isStr(p) && PKG_RE.test(p))) bad("packages");
    if (!Array.isArray(l.allowedPaths) || !l.allowedPaths.length || !l.allowedPaths.every(okPath)) bad("allowedPaths");
    const paths = l.allowedPaths.map(p => p.toLowerCase());
    for (const p of paths) {
      const hit = matcher(p);
      if (hit) fail(`LANE_${hit}:${id}`);
      if (owners.has(p)) fail(`LANE_PATH_DUPLICATE:${owners.get(p)}+${id}`);
      owners.set(p, id);
    }
    if (!Array.isArray(l.dependsOnLanes) || new Set(l.dependsOnLanes).size !== l.dependsOnLanes.length
      || !l.dependsOnLanes.every(d => LANE_IDS.includes(d) && d !== id)) bad("dependsOnLanes");
    if (!intIn(l.maxActive, 1, 4)) bad("maxActive");
    if (!intIn(l.maxOpenPrs, 1, 10)) bad("maxOpenPrs");
    if (!isStr(l.workSource) || !l.workSource.trim()) bad("workSource");
    if (!Array.isArray(l.authorityGaps) || !l.authorityGaps.every(g => isStr(g) && g.length <= 400)) bad("authorityGaps");
    return Object.freeze({id, name: l.name, status: l.status, owner: o.owner, session: o.session, model: l.model, taskTypes: Object.freeze([...l.taskTypes]),
      packages: Object.freeze([...l.packages]), paths: Object.freeze(paths), dependsOnLanes: Object.freeze([...l.dependsOnLanes]), maxActive: l.maxActive,
      maxOpenPrs: l.maxOpenPrs, authorityGaps: Object.freeze([...l.authorityGaps])});
  });
  // dependsOnLanes must be acyclic; depth = length of the longest upstream chain (upstream lanes are planned first).
  const byId = new Map(lanes.map(l => [l.id, l]));
  const depth = new Map();
  const visit = (id, stack) => {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) fail(`LANES_DEPENDENCY_CYCLE:${id}`);
    stack.add(id);
    const deps = byId.get(id).dependsOnLanes;
    const d = deps.length ? 1 + Math.max(...deps.map(x => visit(x, stack))) : 0;
    stack.delete(id); depth.set(id, d);
    return d;
  };
  for (const l of lanes) visit(l.id, new Set());
  return Object.freeze({capacity: Object.freeze({builderCap: cap.builderCap, ciSlots: cap.ciSlots}), shared: Object.freeze(shared.map(p => p.toLowerCase())),
    lanes: Object.freeze(lanes), byId, depth});
}

// The lane owning one file: the longest covering allowedPaths entry (entries are unique, so the longest match is unique).
export function ownerOf(reg, file) {
  let best = null, len = -1;
  for (const l of reg.lanes) for (const e of l.paths) if (e.length > len && covers(e, file)) { best = l; len = e.length; }
  return best;
}

// Route one task to exactly one lane, or return {error}. Never throws on hostile task data.
export function routeTask(t, reg, matcher = repoProtectedMatcher()) {
  if (!isObj(t)) return {error: "MALFORMED_TASK", files: []};
  const raw = t.files === undefined ? [] : t.files;
  if (!Array.isArray(raw) || raw.length > 500) return {error: "MALFORMED_FILES", files: []};
  const files = [];
  for (const f of raw) { const n = normPath(f); if (n === null) return {error: "MALFORMED_FILES", files: []}; files.push(n); }
  for (const n of files) { const hit = matcher(n); if (hit) return {error: hit, files}; }
  const owned = files.filter(n => !reg.shared.some(s => covers(s, n)));
  const routing = owned.length ? owned : files;
  if (t.lane !== undefined) {
    if (!LANE_IDS.includes(t.lane)) return {error: "MALFORMED_LANE", files};
    const lane = reg.byId.get(t.lane);
    if (!routing.every(n => ownerOf(reg, n) === lane)) return {error: `LANE_PIN_PATH_MISMATCH:${t.lane}`, files};
    return {lane, files};
  }
  if (routing.length) {
    const ids = new Set();
    for (const n of routing) { const o = ownerOf(reg, n); if (!o) return {error: "NO_LANE_FOR_PATH", files}; ids.add(o.id); }
    if (ids.size > 1) return {error: `CROSS_LANE:${[...ids].sort().join("+")}`, files};
    return {lane: reg.byId.get([...ids][0]), files};
  }
  const byType = isStr(t.type) ? reg.lanes.filter(l => l.taskTypes.includes(t.type)) : [];
  const byPkg = isStr(t.package) ? reg.lanes.filter(l => l.packages.some(p => t.package.startsWith(p))) : [];
  const cands = byType.length ? byType : byPkg;
  if (cands.length !== 1) return {error: cands.length ? `AMBIGUOUS_LANE:${cands.map(l => l.id).join("+")}` : "NO_LANE_MATCH", files};
  return {lane: cands[0], files};
}

// Two units of work conflict when their files overlap. A unit without files conflicts with all other work of its own lane (it cannot be proven disjoint).
const conflicts = (a, b) => (a.laneId === b.laneId && (!a.files.length || !b.files.length))
  || a.files.some(x => b.files.some(y => pathsOverlap(x, y)));

// Pure planner. tasks: backlog order. eligible: Set of task ids the dispatcher found selectable. inFlight: [{id, laneId, files, building, prOpen, ciBusy}].
// Returns wave assignments: wave 0 may start now; a task waits for every overlapping task placed before it (after[]), and for capacity.
export function planLanes({tasks, eligible, inFlight = [], registry: reg, matcher = repoProtectedMatcher()}) {
  const lane0 = new Map(reg.lanes.map(l => [l.id, {active: 0, prs: 0}]));
  let building = 0, ciBusy = 0;
  for (const f of inFlight) {
    const s = f.laneId ? lane0.get(f.laneId) : null;
    if (f.building) { building++; if (s) s.active++; }
    if (f.prOpen && s) s.prs++;
    if (f.ciBusy) ciBusy++;
  }
  const routed = [], deferred = [];
  tasks.forEach((t, idx) => {
    if (!isObj(t) || !isStr(t.id) || !eligible.has(t.id)) return;
    const r = routeTask(t, reg, matcher);
    if (r.error) { deferred.push({taskId: safeTaskId(t.id), lane: null, reason: r.error}); return; }
    if (r.lane.status !== "ACTIVE") { deferred.push({taskId: safeTaskId(t.id), lane: r.lane.id, reason: `LANE_STANDBY:${r.lane.id}`}); return; }
    routed.push({id: t.id, idx, laneId: r.lane.id, lane: r.lane, files: r.files});
  });
  routed.sort((a, b) => (reg.depth.get(a.laneId) - reg.depth.get(b.laneId)) || (a.idx - b.idx));
  const waves = [];
  const slot = w => (waves[w] ??= {lanes: new Map(), total: 0});
  const fits = (x, w) => {
    const s = slot(w), here = s.lanes.get(x.laneId) ?? 0, base = w === 0 ? lane0.get(x.laneId) : {active: 0, prs: 0};
    return here + base.active < x.lane.maxActive && here + base.prs < x.lane.maxOpenPrs
      && s.total + (w === 0 ? building : 0) < reg.capacity.builderCap && s.total + (w === 0 ? ciBusy : 0) < reg.capacity.ciSlots;
  };
  const placed = [], assignments = [];
  for (const x of routed) {
    const after = new Set();
    let minWave = 0;
    for (const f of inFlight) if (conflicts(x, f)) { after.add(safeTaskId(f.id)); minWave = Math.max(minWave, 1); }
    for (const p of placed) if (conflicts(x, p)) { after.add(p.id); minWave = Math.max(minWave, p.wave + 1); }
    let w = minWave;
    while (!fits(x, w)) w++; // terminates: a wave with no load fits one task, since every cap is >= 1
    const s = slot(w); s.lanes.set(x.laneId, (s.lanes.get(x.laneId) ?? 0) + 1); s.total++;
    placed.push({...x, wave: w});
    assignments.push({taskId: x.id, lane: x.laneId, wave: w, after: [...after].sort(), reason: w === 0 ? "START" : w === minWave ? "AFTER_CONFLICT" : "CAPACITY"});
  }
  assignments.sort((a, b) => a.wave - b.wave || routed.findIndex(r => r.id === a.taskId) - routed.findIndex(r => r.id === b.taskId));
  const laneSummary = reg.lanes.map(l => ({lane: l.id, status: l.status, active: lane0.get(l.id).active, openPrs: lane0.get(l.id).prs,
    startNow: assignments.filter(a => a.lane === l.id && a.wave === 0).map(a => a.taskId)}));
  return {capacity: reg.capacity, inFlight: {building, ciBusy, tasks: inFlight.map(f => ({taskId: safeTaskId(f.id), lane: f.laneId}))},
    startNow: assignments.filter(a => a.wave === 0).map(a => ({taskId: a.taskId, lane: a.lane})), assignments, deferred, lanes: laneSummary};
}

// Dispatcher bridge: eligibility comes from dispatch.mjs evaluateTask (passed in, so there is no import cycle); in-flight work = not DONE/CLOSED
// tasks with a claim head, an open PR, or an IN_PROGRESS/IN_REVIEW/CLAIMED status.
export function planDispatch({tasks, env, registry, evaluate, claimBranchOf, matcher = repoProtectedMatcher()}) {
  const eligible = new Set(), inFlight = [];
  for (const t of tasks) {
    if (!isObj(t) || !isStr(t.id)) continue;
    if (evaluate(t, env).length === 0) { eligible.add(t.id); continue; }
    if (DONE_STATUSES.includes(t.status)) continue;
    const cb = claimBranchOf(t.id);
    const claimed = env.claimedHeads.has(cb);
    const prOpen = env.openPrs.has(cb) || (isStr(t.branch) && env.openPrs.has(t.branch.trim()));
    if (!(claimed || prOpen || IN_FLIGHT_STATUSES.has(t.status))) continue;
    const r = routeTask(t, registry, matcher);
    inFlight.push({id: t.id, laneId: r.lane ? r.lane.id : null, files: r.files, building: (claimed && !prOpen) || t.status === "IN_PROGRESS",
      prOpen: prOpen || t.status === "IN_REVIEW", ciBusy: prOpen || t.status === "IN_REVIEW"});
  }
  return planLanes({tasks, eligible, inFlight, registry, matcher});
}

// Per-task skip reasons for a dispatcher run restricted to one lane: only that lane's wave-0 tasks stay selectable.
export function laneSkips(plan, laneId) {
  const m = new Map();
  for (const a of plan.assignments) {
    if (a.lane !== laneId) m.set(a.taskId, `LANE:${a.lane}`);
    else if (a.wave > 0) m.set(a.taskId, a.reason === "AFTER_CONFLICT" ? `LANE_WAIT:AFTER:${a.after.join("+")}` : "LANE_WAIT:CAPACITY");
  }
  for (const d of plan.deferred) if (d.taskId !== "?") m.set(d.taskId, d.reason);
  return m;
}

// Read-only per-lane work-source report over the WHOLE backlog (every status), so missing work and authority gaps are visible per lane.
export function laneReport(tasks, reg, matcher = repoProtectedMatcher()) {
  const per = new Map(reg.lanes.map(l => [l.id, {}]));
  const unrouted = {};
  for (const t of tasks) {
    if (!isObj(t) || !isStr(t.id)) continue;
    const st = isStr(t.status) && /^[A-Z_]{1,40}$/.test(t.status) ? t.status : "MALFORMED";
    const r = routeTask(t, reg, matcher);
    if (r.error) { const k = r.error.split(":")[0]; (unrouted[k] ??= []).push(safeTaskId(t.id)); continue; }
    const c = per.get(r.lane.id); c[st] = (c[st] ?? 0) + 1;
  }
  const lanes = reg.lanes.map(l => {
    const c = per.get(l.id), ready = c.READY ?? 0, open = Object.entries(c).filter(([s]) => !DONE_STATUSES.includes(s)).reduce((n, [, v]) => n + v, 0);
    const gaps = [];
    if (l.status !== "ACTIVE") gaps.push("BUILDER_MISSING");
    if (ready === 0) gaps.push(open ? "NO_READY_TASK" : "WORK_SOURCE_MISSING");
    if ((c.AUTHORITY_REQUIRED ?? 0) > 0) gaps.push(`AUTHORITY_REQUIRED:${c.AUTHORITY_REQUIRED}`);
    return {lane: l.id, name: l.name, status: l.status, session: l.session, model: l.model, tasks: c, gaps};
  });
  return {lanes, unrouted};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  try {
    if (!argv.includes("--report")) fail("ARG_MISSING:--report");
    const reg = loadLaneRegistry(path.resolve(opt("--lanes", "docs/planning/LANES.json")));
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.resolve(opt("--backlog", "docs/planning/BACKLOG_CHECKPOINT.json")), "utf8")); } catch { fail("BACKLOG_UNREADABLE"); }
    if (!isObj(doc) || !Array.isArray(doc.tasks)) fail("BACKLOG_SCHEMA_INVALID:tasks");
    process.stdout.write(JSON.stringify({outcome: "REPORT", ...laneReport(doc.tasks, reg)}) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({outcome: "BLOCKED", reasons: [e instanceof LaneError ? e.code : "INTERNAL_ERROR"]}) + "\n");
    process.exitCode = 2;
  }
}
