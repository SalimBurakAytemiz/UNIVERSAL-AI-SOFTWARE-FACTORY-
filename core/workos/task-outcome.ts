//TR: Bu dosya bağlı koşunun GERÇEK sonucundan (run.status) görev durumunu türetir ve yalnız Work OS store'un transitionTask yöntemiyle yazar; elle durum verilmez, koşu sonucu belirsizse görev değişmez. Çalışan süreç değil, idempotent bir uzlaştırma geçişidir.
import type {Scope, TaskStatus, WorkRun, WorkTask} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {WorkOsError} from "./types.js";
import {listLinks} from "./task-run-link.js";

export type TaskOutcomeAction = "TRANSITIONED" | "UNCHANGED" | "SKIPPED";
export interface TaskOutcomeResult { taskId: string; from: TaskStatus; to: TaskStatus; action: TaskOutcomeAction; reason: string | null }
export interface RunTaskOutcome { runId: string; runStatus: WorkRun["status"]; results: TaskOutcomeResult[] }
export class OutcomeError extends Error { constructor(readonly code: "OUTCOME_RUN_NOT_FOUND") { super(code); this.name = "OutcomeError"; } }

const FAILED = new Set<WorkRun["status"]>(["FAILED", "RECOVERY_FAILED", "CANCELLED", "QUARANTINED", "BLOCKED"]);
const NOT_STARTED = new Set<WorkRun["status"]>(["CREATED", "QUEUED"]);

/** Koşu durumundan hedef görev durumu; henüz başlamamış koşu için null (görev değişmez). Founder kararı bekleyen koşu hâlâ IN_PROGRESS'tir (DONE yalnız SUCCEEDED). */
export function targetForRun(status: WorkRun["status"]): TaskStatus | null {
  if (status === "SUCCEEDED") return "DONE";
  if (FAILED.has(status)) return "BLOCKED";
  if (NOT_STARTED.has(status)) return null;
  return "IN_PROGRESS";
}

// Mevcut durumdan hedefe izin verilen geçiş yolu (TASK_TRANSITIONS); DONE'dan geri dönüş yoktur, BLOCKED'a bir kez girilince yeniden denemede önce PENDING'e dönülür.
function pathTo(from: TaskStatus, to: TaskStatus): TaskStatus[] | null {
  if (from === to) return [];
  if (from === "DONE") return null;
  if (to === "BLOCKED") return ["BLOCKED"];
  if (from === "PENDING") return to === "IN_PROGRESS" ? ["IN_PROGRESS"] : ["IN_PROGRESS", "DONE"];
  if (from === "IN_PROGRESS") return to === "DONE" ? ["DONE"] : null;
  return to === "IN_PROGRESS" ? ["PENDING", "IN_PROGRESS"] : ["PENDING", "IN_PROGRESS", "DONE"];
}

export function reconcileRunTasks(store: WorkOsStore, scope: Scope, actor: string, runId: string): RunTaskOutcome {
  const run = store.getRun(scope, runId);
  if (!run) throw new OutcomeError("OUTCOME_RUN_NOT_FOUND");
  const links = listLinks(store.dataDir, scope);
  const target = targetForRun(run.status);
  const mine = links.filter(l => l.runId === runId);
  const results = new Map<string, TaskOutcomeResult>();
  const note = (t: WorkTask, to: TaskStatus, action: TaskOutcomeAction, reason: string | null) => results.set(t.taskId, {taskId: t.taskId, from: t.status, to, action, reason});
  // Görevi yöneten koşu, ona en son bağlanan koşudur; eski bir koşunun sonucu yeni koşunun görevini ezmez.
  const governing = (taskId: string) => [...links].reverse().find(l => l.taskId === taskId)?.runId;
  let pending = mine.map(l => l.taskId).filter((id, i, a) => a.indexOf(id) === i);
  for (let pass = 0; pass <= pending.length && pending.length > 0; pass++) {
    const next: string[] = [];
    let progressed = false;
    for (const id of pending) {
      const t = store.getTask(scope, id);
      if (!t) continue;
      if (target === null) { note(t, t.status, "UNCHANGED", `RUN_${run.status}`); continue; }
      if (governing(id) !== runId) { note(t, t.status, "SKIPPED", "SUPERSEDED_BY_NEWER_RUN"); continue; }
      const steps = pathTo(t.status, target);
      if (steps === null) { note(t, target, "SKIPPED", t.status === "DONE" ? "TASK_ALREADY_DONE" : "NO_ALLOWED_PATH"); continue; }
      if (steps.length === 0) { note(t, target, "UNCHANGED", null); continue; }
      try {
        let cur = t;
        for (const s of steps) cur = store.transitionTask(scope, id, s, `run ${runId} ${run.status}`.slice(0, 1000), actor);
        results.set(id, {taskId: id, from: t.status, to: cur.status, action: "TRANSITIONED", reason: null});
        progressed = true;
      } catch (e) {
        // Bağımlılıkları henüz DONE olmayan görev, bağımlılığı bu geçişte DONE olursa sonraki turda yeniden denenir.
        if (e instanceof WorkOsError && e.code === "WORKOS_CONFLICT" && /TASK_DEPENDENCIES_NOT_DONE/.test(e.message)) { next.push(id); note(t, target, "SKIPPED", "TASK_DEPENDENCIES_NOT_DONE"); }
        else if (e instanceof WorkOsError && e.code === "WORKOS_CONFLICT" && /MISSION_COMPLETE/.test(e.message)) note(t, target, "SKIPPED", "MISSION_COMPLETE");
        else throw e;
      }
    }
    if (!progressed) break;
    pending = next;
  }
  return {runId, runStatus: run.status, results: [...results.values()]};
}

/** Sunucu döngüsü için: bu tenant'ta bağı olan her koşuyu uzlaştırır; yalnız gerçekten geçiş yapılan görevleri döndürür. */
export function reconcileAllLinkedTasks(store: WorkOsStore, scope: Scope, actor: string): TaskOutcomeResult[] {
  const runIds = [...new Set(listLinks(store.dataDir, scope).map(l => l.runId))];
  return runIds.flatMap(id => reconcileRunTasks(store, scope, actor, id).results.filter(r => r.action === "TRANSITIONED"));
}
