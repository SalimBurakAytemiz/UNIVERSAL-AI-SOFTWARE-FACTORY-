// //TR: Factory V2 deterministik dispatch: kanonik backlog'tan bağımlılıkları tamamlanmış, seçilebilir, başka oturumun (V4.1) sahip olmadığı ve dosya kapsamı uçuştaki işlerle çakışmayan görevleri seçer; boş Builder slotlarına önce tercih edilen alana, sonra herhangi bir boş slota atar. Model çağrısı yoktur.
import {domainOfTask} from "./topology.mjs";

export const DONE_STATUSES = Object.freeze(["ASSET_DONE", "DONE_OBSERVED"]);
export const NOT_PICKABLE = Object.freeze(["ASSET_DONE", "DONE_OBSERVED", "SPLIT", "BLOCKED", "DEFERRED", "UNVERIFIABLE", "VERIFY_PENDING"]);

const norm = p => String(p).replaceAll("\\", "/").replace(/^\.\//, "");
/** Two declared scopes overlap when one path is a prefix of the other (directory scopes end with "/"). */
export function scopesOverlap(a = [], b = []) {
  for (const x of a.map(norm)) for (const y of b.map(norm)) {
    if (x === y) return true;
    if (x.endsWith("/") && y.startsWith(x)) return true;
    if (y.endsWith("/") && x.startsWith(y)) return true;
  }
  return false;
}

/**
 * Ready tasks in deterministic order (wave, tier, id). `excluded` = task ids owned elsewhere (live V4.1 in-flight, open PRs,
 * other claims) — the coexistence guard. `inFlight` = tasks this factory is already running (with declared paths).
 */
export function readyTasks(backlog, {done = new Set(), excluded = new Set(), inFlight = [], allowedTiers = null} = {}) {
  const doneIds = new Set([...done, ...backlog.filter(t => DONE_STATUSES.includes(t.status)).map(t => t.id)]);
  const busy = new Set(inFlight.map(t => t.id));
  return backlog
    .filter(t => !NOT_PICKABLE.includes(t.status) && !doneIds.has(t.id) && !excluded.has(t.id) && !busy.has(t.id))
    .filter(t => !allowedTiers || allowedTiers.includes(t.tier))
    .filter(t => (t.deps ?? []).every(d => doneIds.has(d)))
    .filter(t => (t.startGates ?? []).length === 0) // a start gate is a Founder/infra decision, never auto-dispatched
    .sort((a, b) => String(a.wave ?? "").localeCompare(String(b.wave ?? "")) || String(a.tier ?? "").localeCompare(String(b.tier ?? "")) || a.id.localeCompare(b.id));
}

/**
 * Assign up to `capacity` ready tasks to idle builder slots. Domain-preferred slot first; idle builders may take other eligible tasks.
 * File-scope conflicts with in-flight work (and among the new assignments) are skipped, not queued behind.
 */
export function assign(ready, idleBuilders, {inFlight = [], capacity = idleBuilders.length} = {}) {
  const out = [], taken = new Set(), scopes = inFlight.map(t => t.paths ?? []);
  const free = [...idleBuilders];
  for (const task of ready) {
    if (out.length >= capacity || free.length === 0) break;
    const p = task.paths ?? [];
    if (p.length && scopes.some(s => scopesOverlap(s, p))) continue;
    const domain = task.domain ?? domainOfTask(task);
    let i = free.findIndex(b => b.domain === domain);
    const preferred = i >= 0;
    if (i < 0) i = 0;
    const [slot] = free.splice(i, 1);
    out.push({taskId: task.id, slotId: slot.id, domain, preferred, paths: p});
    taken.add(task.id); if (p.length) scopes.push(p);
  }
  return out;
}

/** Coexistence: task ids the live (V4.1) runtime owns — STATE.json inFlight + tasks named by open PRs (UASCO-TASK lines). */
export function liveOwnedTasks({autonomyState = null, openPrs = []} = {}) {
  const s = new Set();
  for (const f of autonomyState?.inFlight ?? []) if (f?.task) s.add(f.task);
  for (const f of autonomyState?.founderRequired ?? autonomyState?.awaitingFounder ?? []) if (f?.task) s.add(f.task);
  const re = /^UASCO-TASK: ([A-Z0-9]+-T\d{4}(?:\.[a-z0-9]+)?)\s*$/m;
  for (const pr of openPrs) { const m = re.exec(pr?.body ?? ""); if (m) s.add(m[1]); }
  return s;
}
