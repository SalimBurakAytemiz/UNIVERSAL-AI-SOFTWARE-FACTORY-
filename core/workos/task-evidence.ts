// //TR: V3-T1032 (B): görev başına SALT OKUNUR kanıt görünümü. Runner görevleri tek tek yürütmez (bir mission = bir koşu); bu yüzden kanıt GÖREV'e değil, görevin bağlı olduğu KOŞUNUN tamamına aittir ve böyle etiketlenir (coverage: WHOLE_RUN). Yeni durum yazılmaz; yalnız task-run-link bağları ve Work OS store kayıtları okunur. Tenant/proje/mission uyuşmazlığı reddedilir.
import type {RunEvidence, RunStatus, Scope} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {LinkError, runsForTask} from "./task-run-link.js";

export interface TaskEvidenceEntry {
  readonly evidenceId: string; readonly kind: string; readonly step: RunEvidence["step"]; readonly cycle: number; readonly logSha256: string | null;
}
export interface TaskEvidenceRun {
  readonly runId: string; readonly status: RunStatus; readonly attempt: number; readonly linkedAt: string;
  /** The run's evidence chain in journal order. It covers the WHOLE run (every task linked to it), not this task alone. */
  readonly evidence: readonly TaskEvidenceEntry[];
}
export type TaskEvidenceResult =
  | {readonly ok: true; readonly taskId: string; readonly missionId: string; readonly projectId: string; readonly coverage: "WHOLE_RUN"; readonly runs: readonly TaskEvidenceRun[]}
  | {readonly ok: false; readonly reason: "TASK_NOT_FOUND" | "SCOPE_MISMATCH" | "RUN_NOT_FOUND" | "LINK_STORE_CORRUPT"};

/** Optional caller expectation: when given, the task must belong to exactly this project/mission. */
export interface TaskEvidenceExpect { readonly projectId?: string; readonly missionId?: string }

/**
 * Read-only per-task evidence view. For every run linked to the task (link order), returns runId, status, attempt and that run's ordered evidence
 * chain (evidenceId, kind, step, cycle, logSha256). No per-task execution is claimed: coverage is WHOLE_RUN.
 * Fail-closed: unknown task (or another tenant's) -> TASK_NOT_FOUND; project/mission expectation or a linked run of another mission/project -> SCOPE_MISMATCH;
 * a link to a run that no longer resolves -> RUN_NOT_FOUND; unreadable link store -> LINK_STORE_CORRUPT.
 */
export function taskEvidence(store: WorkOsStore, scope: Scope, taskId: string, expect: TaskEvidenceExpect = {}): TaskEvidenceResult {
  const task = store.getTask(scope, taskId);
  if (!task) return {ok: false, reason: "TASK_NOT_FOUND"};
  if ((expect.projectId !== undefined && expect.projectId !== task.projectId) || (expect.missionId !== undefined && expect.missionId !== task.missionId)) return {ok: false, reason: "SCOPE_MISMATCH"};
  let linked: ReturnType<typeof runsForTask>;
  try { linked = runsForTask(store, scope, taskId); }
  catch (e) { if (e instanceof LinkError && e.code === "LINK_STORE_CORRUPT") return {ok: false, reason: "LINK_STORE_CORRUPT"}; throw e; }
  if (!linked) return {ok: false, reason: "TASK_NOT_FOUND"};
  const runs: TaskEvidenceRun[] = [];
  for (const {link, run} of linked) {
    if (!run) return {ok: false, reason: "RUN_NOT_FOUND"};
    if (run.tenantId !== scope.tenantId || run.missionId !== task.missionId || run.projectId !== task.projectId || link.missionId !== task.missionId) return {ok: false, reason: "SCOPE_MISMATCH"};
    runs.push({runId: run.runId, status: run.status, attempt: run.attempt, linkedAt: link.linkedAt,
      evidence: run.evidence.map(e => ({evidenceId: e.evidenceId, kind: e.kind, step: e.step, cycle: e.cycle, logSha256: e.logSha256}))});
  }
  return {ok: true, taskId: task.taskId, missionId: task.missionId, projectId: task.projectId, coverage: "WHOLE_RUN", runs};
}
