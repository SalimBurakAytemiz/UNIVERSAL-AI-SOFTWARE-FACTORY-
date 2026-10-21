//TR: Bu dosya bir görevi (task) o görevin mission'ına ait gerçek bir koşuya (run) bağlar; bağlar yan JSONL kaydında tutulur, koşu ve görev Work OS store'dan doğrulanır, aynı çift tekrarında idempotenttir.
import path from "node:path";
import type {Scope, WorkRun} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {readJsonlRecords, appendJsonlRecord} from "./jsonl-tail.js";

export type LinkErrorCode = "TASK_NOT_FOUND" | "RUN_NOT_FOUND" | "RUN_MISSION_MISMATCH" | "TASK_NOT_LINKABLE" | "LINK_STORE_CORRUPT";
export class LinkError extends Error { constructor(readonly code: LinkErrorCode) { super(code); this.name = "LinkError"; } }
export interface TaskRunLink { taskId: string; runId: string; missionId: string; tenantId: string; linkedAt: string; linkedBy: string }

const file = (dir: string) => path.join(dir, "task-run-links.jsonl");
// Kaydın JSON.stringify başlangıcı (anahtar sırası TaskRunLink literalindeki gibi): yırtık son satır yalnız bunun önekiyse tolere edilir (jsonl-tail.ts).
const RECORD_START = '{"taskId":"';
function readLinks(dir: string): TaskRunLink[] {
  try { return readJsonlRecords<TaskRunLink>(file(dir), RECORD_START); } catch { throw new LinkError("LINK_STORE_CORRUPT"); }
}

export function linkTaskRun(store: WorkOsStore, scope: Scope, actor: string, taskId: string, runId: string): {link: TaskRunLink; replayed: boolean} {
  const task = store.getTask(scope, taskId);
  if (!task) throw new LinkError("TASK_NOT_FOUND");
  const run = store.getRun(scope, runId);
  if (!run) throw new LinkError("RUN_NOT_FOUND");
  if (run.missionId !== task.missionId) throw new LinkError("RUN_MISSION_MISMATCH");
  const prior = readLinks(store.dataDir).find(l => l.tenantId === scope.tenantId && l.taskId === taskId && l.runId === runId);
  if (prior) return {link: prior, replayed: true};
  // Tamamlanmış görev yeni koşuya bağlanmaz; durum doğrulanmış store kaydından okunur.
  if (task.status === "DONE") throw new LinkError("TASK_NOT_LINKABLE");
  const link: TaskRunLink = {taskId, runId, missionId: task.missionId, tenantId: scope.tenantId, linkedAt: new Date().toISOString(), linkedBy: actor};
  appendJsonlRecord(file(store.dataDir), link, RECORD_START);
  return {link, replayed: false};
}

export function runsForTask(store: WorkOsStore, scope: Scope, taskId: string): {link: TaskRunLink; run: WorkRun | null}[] | undefined {
  if (!store.getTask(scope, taskId)) return undefined;
  return readLinks(store.dataDir).filter(l => l.tenantId === scope.tenantId && l.taskId === taskId).map(link => ({link, run: store.getRun(scope, link.runId) ?? null}));
}
export function tasksForRun(store: WorkOsStore, scope: Scope, runId: string): TaskRunLink[] | undefined {
  if (!store.getRun(scope, runId)) return undefined;
  return readLinks(store.dataDir).filter(l => l.tenantId === scope.tenantId && l.runId === runId);
}
