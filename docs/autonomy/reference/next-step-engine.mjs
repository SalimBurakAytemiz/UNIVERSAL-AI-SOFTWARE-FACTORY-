// UASCO next-step engine: REFERENCE / PROPOSAL (not wired into the orchestrator; wiring is protected-core, FA-LEASE2).
//
// selectNext(backlog, {store, owner, now, ttlMs, headSha?}) decides what the autonomous worker does next and ALWAYS returns a
// classified outcome (it never hangs, never waits on a Local hand-off, and never crashes on a store failure):
//
//   {action:"START", task, lease}                 the first selectable task was atomically claimed (lease = GRANTED record)
//   {action:"NO_READY_WORK", held, skipped, reason} nothing this worker may start now (AWAITING_LOCAL/DONE/BLOCKED/DRAFT, LOCAL-owned,
//                                                  or every selectable task is leased to someone else)
//   {action:"AUTHORITY_REQUIRED", tasks, blocked} remaining work needs a human: FOUNDER-owned, or CLOUD-owned with no authorizedBy
//   {action:"BLOCKED", tasks}                     every remaining READY CLOUD task is waiting on an unfinished dependency
//   {action:"RECOVERABLE_FAILURE", reason, ...}   the lease store threw; retry later (transient), nothing was claimed
//
// Selectable  <=>  status==="READY" && owner==="CLOUD" && authorizedBy (truthy) && every dependsOn id is DONE in the backlog
//                  && not currently leased to another owner.
// Priority    =   `priority` ascending when present (tasks without it come after), then backlog array order.
// Atomicity   =   comes ONLY from the lease store (git ref create-if-absent / CAS) through task-lease.mjs `claim`; this module
//                  holds no lock and keeps no state. The store.read pre-check is an optimisation / "currently held" filter, never the
//                  arbiter: if another owner wins the race between read and claim, `claim` returns HELD and we move on.
// Classification precedence when nothing starts:
//   1. a selectable task exists but is leased elsewhere -> NO_READY_WORK (work exists, it is owned; this worker has nothing to do)
//   2. any READY task needing authority (FOUNDER-owned / unauthorised CLOUD) -> AUTHORITY_REQUIRED (a human must act; dep-blocked
//      tasks are listed under `blocked` for context)
//   3. any READY authorised CLOUD task with an unfinished dependency -> BLOCKED
//   4. otherwise -> NO_READY_WORK
//
// On wiring into automation/lib this import becomes "./task-lease.mjs"; here it is the absolute path of the merged module.
import {claim, reclaimableBy} from "../../../automation/lib/task-lease.mjs";

const STORE_METHODS = ["createIfAbsent", "read", "cas", "remove"];
const OWNER_KEYS = ["environment", "workerId", "sessionId"];

const sameOwner = (record, owner) =>
  record.environment === owner.environment && record.workerId === owner.workerId && record.sessionId === owner.sessionId;

// Deterministic per-task data errors (a malformed task id) are skipped, not retried forever and not allowed to starve
// independent tasks. Any other thrown error is a store failure and is treated as recoverable.
const isTaskDataError = (e) => typeof e?.message === "string" && e.message.startsWith("LEASE_TASK_ID_INVALID");

function assertArgs(backlog, store, owner, now, ttlMs) {
  const bad = (what) => {
    throw new TypeError(`NEXTSTEP_ARG_INVALID:${what}`);
  };
  if (!Array.isArray(backlog)) bad("backlog");
  if (!store || STORE_METHODS.some((m) => typeof store[m] !== "function")) bad("store");
  for (const k of OWNER_KEYS) if (typeof owner?.[k] !== "string" || owner[k] === "") bad(`owner.${k}`);
  if (!Number.isFinite(now)) bad("now");
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) bad("ttlMs");
}

export function selectNext(backlog, {store, owner, now = Date.now(), ttlMs, headSha} = {}) {
  assertArgs(backlog, store, owner, now, ttlMs);

  const tasks = backlog.filter((t) => t && typeof t === "object");

  // A dependency is satisfied only if the id exists in the backlog and no entry with that id is unfinished.
  const doneIds = new Set(tasks.filter((t) => t.status === "DONE").map((t) => t.id));
  for (const t of tasks) if (t.status !== "DONE") doneIds.delete(t.id);
  const depsDone = (t) => Array.isArray(t.dependsOn ?? []) && (t.dependsOn ?? []).every((id) => doneIds.has(id));

  const ordered = tasks
    .map((task, index) => ({task, index}))
    .sort((a, b) => (Number.isFinite(a.task.priority) ? a.task.priority : Infinity) - (Number.isFinite(b.task.priority) ? b.task.priority : Infinity) || a.index - b.index)
    .map((x) => x.task);

  const held = [], skipped = [], authority = [], depBlocked = [];

  for (const task of ordered) {
    // AWAITING_LOCAL / DONE / BLOCKED / DRAFT_NOT_READY are simply not candidates: they never block independent READY tasks.
    if (task.status !== "READY") continue;
    if (task.owner === "FOUNDER" || (task.owner === "CLOUD" && !task.authorizedBy)) { authority.push(task); continue; }
    if (task.owner !== "CLOUD") continue; // LOCAL-owned (or unknown owner): not this worker's work
    if (!depsDone(task)) { depBlocked.push(task); continue; }
    if (typeof task.id !== "string" || task.id === "") { skipped.push({id: task.id ?? null, reason: "TASK_ID_INVALID"}); continue; }

    // Selectable. Ask the lease; the first GRANTED wins, HELD means owned elsewhere.
    try {
      const current = store.read(task.id);
      if (current && !reclaimableBy(current, now) && !sameOwner(current, owner)) { held.push(task); continue; }
      const r = claim(store, {...owner, taskId: task.id, headSha, now, ttlMs});
      if (r.status === "GRANTED") return {action: "START", task, lease: r.record, ...(r.previous ? {previous: r.previous} : {})};
      held.push(task);
    } catch (e) {
      if (isTaskDataError(e)) { skipped.push({id: task.id, reason: String(e.message)}); continue; }
      return {action: "RECOVERABLE_FAILURE", reason: `STORE_ERROR:${e?.message ?? String(e)}`, taskId: task.id, retryable: true};
    }
  }

  if (held.length) return {action: "NO_READY_WORK", reason: "ALL_SELECTABLE_HELD", held, skipped};
  if (authority.length) return {action: "AUTHORITY_REQUIRED", tasks: authority, blocked: depBlocked};
  if (depBlocked.length) return {action: "BLOCKED", tasks: depBlocked};
  return {action: "NO_READY_WORK", reason: "NO_SELECTABLE_TASK", held, skipped};
}
