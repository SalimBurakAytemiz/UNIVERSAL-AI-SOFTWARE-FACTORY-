//TR: Bu dosya bir projenin ilk-teslim akışı durumunu (görev planı, koşu, review, teslim) yalnız Work OS store'daki doğrulanmış kayıtlardan türetir; kayıt yoksa NOT_STARTED, bilinmeyende UNKNOWN yazar, hiçbir olumlu durum uydurmaz.
import type {Scope, WorkRun} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {linkedTaskIds} from "./task-run-link.js";

export type FlowStageName = "MISSION" | "PLAN" | "RUN" | "REVIEW" | "DELIVERY";
export type FlowState = "NOT_STARTED" | "ACTIVE" | "DONE" | "BLOCKED" | "FAILED" | "UNKNOWN";
export interface FlowStage { stage: FlowStageName; state: FlowState; detail: string | null }
export interface ProjectFlow { projectId: string; stages: FlowStage[]; missionCount: number; taskCount: number; latestRunId: string | null;
  // Görev-koşu bağı özeti (LANE-B task-run-link): bağ dosyası okunamazsa null (UNKNOWN), 0 uydurulmaz.
  taskRuns: { tasksWithRuns: number; tasks: number } | null }

const RUN_FAILED = new Set(["FAILED", "RECOVERY_FAILED", "CANCELLED", "QUARANTINED"]);
const RUN_BLOCKED = new Set(["BLOCKED", "AWAITING_APPROVAL", "HANDOFF_PENDING", "DEGRADED"]);
const REVIEW_STEPS = new Set(["REVIEW", "REGRESSION", "REPORT"]);

function runState(r: WorkRun): FlowState {
  if (r.status === "SUCCEEDED") return "DONE";
  if (RUN_FAILED.has(r.status)) return "FAILED";
  if (RUN_BLOCKED.has(r.status)) return "BLOCKED";
  return "ACTIVE";
}

export function deriveProjectFlow(store: WorkOsStore, scope: Scope, projectId: string): ProjectFlow | undefined {
  if (!store.getProject(scope, projectId)) return undefined;
  const missions = store.listMissions(scope, projectId);
  const tasks = missions.flatMap(m => store.listTasks(scope, m.missionId));
  const runs = store.listRuns(scope).filter(r => r.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = runs[runs.length - 1];

  const mission: FlowStage = missions.length === 0 ? {stage: "MISSION", state: "NOT_STARTED", detail: null}
    : missions.every(m => m.status === "COMPLETE") ? {stage: "MISSION", state: "DONE", detail: "COMPLETE"}
    : missions.some(m => m.status === "BLOCKED") ? {stage: "MISSION", state: "BLOCKED", detail: "BLOCKED"}
    : {stage: "MISSION", state: "ACTIVE", detail: missions[missions.length - 1].status};
  const done = tasks.filter(t => t.status === "DONE").length;
  const plan: FlowStage = tasks.length === 0 ? {stage: "PLAN", state: "NOT_STARTED", detail: null}
    : tasks.some(t => t.status === "BLOCKED") ? {stage: "PLAN", state: "BLOCKED", detail: `${done}/${tasks.length} DONE`}
    : {stage: "PLAN", state: done === tasks.length ? "DONE" : "ACTIVE", detail: `${done}/${tasks.length} DONE`};
  const run: FlowStage = latest ? {stage: "RUN", state: runState(latest), detail: `${latest.status}/${latest.step}`} : {stage: "RUN", state: "NOT_STARTED", detail: null};
  // REVIEW: SUCCEEDED koşu DONE'dır (SUCCEEDED yazısı CLEAN review kanıtını gerektirir). SUCCEEDED olmayan koşuda DONE yalnız koşunun GÜNCEL headSha'sına bağlı CLEAN bir REVIEW kanıtı kaydı varsa yazılır
  // (ör. Founder kararı bekleyen AWAITING_APPROVAL/REPORT koşusu); yoksa inceleme aşamasına ulaşmış aktif koşu ACTIVE; başarısız koşuda review sonucu bilinmez.
  const headReview = latest?.headSha ? [...(latest.evidence ?? [])].reverse().find(e => e.kind === "REVIEW" && e.commitSha === latest.headSha) : undefined;
  const review: FlowStage = !latest ? {stage: "REVIEW", state: "NOT_STARTED", detail: null}
    : latest.status === "SUCCEEDED" ? {stage: "REVIEW", state: "DONE", detail: "CLEAN_REVIEW_GATE_PASSED"}
    : RUN_FAILED.has(latest.status) ? {stage: "REVIEW", state: "UNKNOWN", detail: "RUN_NOT_SUCCEEDED"}
    : headReview?.verdict === "CLEAN" ? {stage: "REVIEW", state: "DONE", detail: "CLEAN_REVIEW_FOR_HEAD"}
    : REVIEW_STEPS.has(latest.step) ? {stage: "REVIEW", state: "ACTIVE", detail: latest.step} : {stage: "REVIEW", state: "NOT_STARTED", detail: null};
  // DELIVERY: DONE yalnız PRODUCT_VERIFIED completion kaydıyla. Teslim artefaktı veya Founder'ın kabul ettiği NOT_VERIFIED kaynak teslimi kaydı varsa NOT_STARTED yazılmaz ama DONE da yazılmaz (ürün doğrulanmadı): ACTIVE + açık sebep.
  const delivery: FlowStage = !latest ? {stage: "DELIVERY", state: "NOT_STARTED", detail: null}
    : latest.completion ? {stage: "DELIVERY", state: "DONE", detail: latest.completion.productVerification.state}
    : latest.sourceDelivery ? {stage: "DELIVERY", state: "ACTIVE", detail: "SOURCE_DELIVERY_ACCEPTED_NOT_VERIFIED"}
    : latest.deliveryArtifact ? {stage: "DELIVERY", state: "ACTIVE", detail: "ARTIFACT_PREPARED_NOT_VERIFIED"} : {stage: "DELIVERY", state: "NOT_STARTED", detail: null};
  return {projectId, stages: [mission, plan, run, review, delivery], missionCount: missions.length, taskCount: tasks.length, latestRunId: latest?.runId ?? null, taskRuns: taskRuns(store, scope, tasks.map(t => t.taskId))};
}

function taskRuns(store: WorkOsStore, scope: Scope, taskIds: string[]): { tasksWithRuns: number; tasks: number } | null {
  if (typeof store.dataDir !== "string") return null;
  const linked = linkedTaskIds(store.dataDir, scope);
  return linked ? { tasksWithRuns: taskIds.filter(id => linked.has(id)).length, tasks: taskIds.length } : null;
}
