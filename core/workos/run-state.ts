// //TR: Bu dosya worker run durumlarının (Master §06) açık allowlist geçiş tablosunu tanımlar; tabloda olmayan her geçiş fail-closed reddedilir ve journal replay'inde tamper sayılır.
import type {RunCheckpoint, RunStatus, RunStep} from "./types.js";
import type {MissionStatus} from "../mission/types.js";

const transitions: Record<RunStatus, readonly RunStatus[]> = {
  CREATED: ["QUEUED", "BLOCKED", "CANCELLING"],
  QUEUED: ["LEASED", "BLOCKED", "CANCELLING"],
  LEASED: ["RUNNING", "VERIFYING", "BLOCKED", "CANCELLING", "RECOVERING", "FAILED"],
  RUNNING: ["CHECKPOINTING", "RETRY_SCHEDULED", "DEGRADED", "HANDOFF_PENDING", "BLOCKED", "QUARANTINED", "CANCELLING", "RECOVERING", "FAILED"],
  VERIFYING: ["CHECKPOINTING", "RETRY_SCHEDULED", "BLOCKED", "QUARANTINED", "CANCELLING", "RECOVERING", "FAILED"],
  CHECKPOINTING: ["RUNNING", "VERIFYING", "AWAITING_APPROVAL", "BLOCKED", "CANCELLING", "RECOVERING", "FAILED"],
  RETRY_SCHEDULED: ["RUNNING", "VERIFYING", "BLOCKED", "CANCELLING", "RECOVERING", "FAILED"],
  DEGRADED: ["RUNNING", "BLOCKED", "CANCELLING", "FAILED"],
  HANDOFF_PENDING: ["QUEUED", "BLOCKED", "CANCELLING"],
  AWAITING_APPROVAL: ["SUCCEEDED", "BLOCKED", "CANCELLING"],
  RECOVERING: ["RUNNING", "VERIFYING", "RECOVERY_FAILED", "BLOCKED", "CANCELLING", "FAILED"],
  CANCELLING: ["CANCELLED"],
  SUCCEEDED: [], BLOCKED: [], QUARANTINED: [], CANCELLED: [], RECOVERY_FAILED: [], FAILED: []
};
export const RUN_STATUSES = Object.keys(transitions) as RunStatus[];
export const RUN_STEPS: readonly RunStep[] = ["WORKSPACE", "IMPLEMENT", "VERIFY", "SECURITY", "REVIEW", "REGRESSION", "REPORT"];
// Engine'in sahiplendiği (lease taşıyan) durumlar; lease süresi dolarsa recovery devralır.
export const LEASED_RUN_STATUSES: readonly RunStatus[] = ["LEASED", "RUNNING", "VERIFYING", "CHECKPOINTING", "RETRY_SCHEDULED", "DEGRADED", "RECOVERING", "CANCELLING"];
// Cockpit workforce.activeWorkerRuns sayımı yalnız bu durumları sayar.
export const ACTIVE_WORKER_STATUSES: readonly RunStatus[] = ["LEASED", "RUNNING", "CHECKPOINTING", "VERIFYING"];
// Terminal veya Founder kararı bekleyen (artık yürütülmeyen) durumlar; lease bu durumlara girişte bırakılır.
export const UNLEASED_RUN_STATUSES: readonly RunStatus[] = ["CREATED", "QUEUED", "HANDOFF_PENDING", "AWAITING_APPROVAL", "SUCCEEDED", "BLOCKED", "QUARANTINED", "CANCELLED", "RECOVERY_FAILED", "FAILED"];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = RUN_STATUSES.filter(s => transitions[s].length === 0);

const statusSet = new Set<string>(RUN_STATUSES);
const stepSet = new Set<string>(RUN_STEPS);
export const isRunStatus = (x: unknown): x is RunStatus => typeof x === "string" && statusSet.has(x);
export const isRunStep = (x: unknown): x is RunStep => typeof x === "string" && stepSet.has(x);
export function canRunTransition(from: RunStatus, to: RunStatus): boolean {
  return isRunStatus(from) && isRunStatus(to) && transitions[from].includes(to);
}
export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canRunTransition(from, to)) throw new Error(`Invalid run transition: ${String(from)} -> ${String(to)}`);
}
// Bir run hâlâ yürütülebilir/aktif mi (aynı mission için ikinci run başlatılamaz).
export const isOpenRun = (s: RunStatus) => !TERMINAL_RUN_STATUSES.includes(s) && s !== "AWAITING_APPROVAL";

// //TR: V3-T1016 kota olay modeli: sağlayıcı kotası/hız sınırı (PROVIDER_QUOTA) run'ı BLOCKED yapar ama bu engel DEVAM ETTİRİLEBİLİR (BLOCKED_RESUMABLE) sınıftadır;
// diğer her BLOCKED terminaldir (BLOCKED_TERMINAL). Engel noktasında şemalı bir checkpoint kaydı yazılır (adım, deneme, son kanıt ref'i, biliniyorsa resumeAfter).
// Devam ettirilebilir engel ASLA kendiliğinden (devralma/crash-resume/zamanlayıcı) sürdürülmez; yalnız açık bir resume çağrısı (P2, bu pakette yok) sürdürebilir.
// //TR: UASCO-T0049 (2): Founder duraklatması (PAUSED) da devam ettirilebilir engeldir; neden/limit çifti sabittir: PROVIDER_QUOTA <-> QUOTA_EXHAUSTED|RATE_LIMIT, PAUSED <-> FOUNDER_PAUSE.
export const RESUMABLE_BLOCK_REASONS = ["PROVIDER_QUOTA", "PAUSED"] as const;
export type ResumableBlockReason = (typeof RESUMABLE_BLOCK_REASONS)[number];
export const isResumableBlockReason = (x: unknown): x is ResumableBlockReason => typeof x === "string" && (RESUMABLE_BLOCK_REASONS as readonly string[]).includes(x);
export type ProviderLimitKind = "QUOTA_EXHAUSTED" | "RATE_LIMIT";
export type BlockLimitKind = ProviderLimitKind | "FOUNDER_PAUSE";
const limitFits = (reason: unknown, limit: unknown): boolean => reason === "PAUSED" ? limit === "FOUNDER_PAUSE" : reason === "PROVIDER_QUOTA" && (limit === "QUOTA_EXHAUSTED" || limit === "RATE_LIMIT");
/** Engel noktasında yazılan checkpoint verisi (RunCheckpoint.data). schema sürümlüdür; alanlar kesin doğrulanır. */
export interface ResumableBlockCheckpoint {
  outcome: "BLOCKED_RESUMABLE"; schema: 1; reason: ResumableBlockReason; limit: BlockLimitKind;
  step: RunStep; attempt: number; retryCount: number; lastEvidenceRef: string | null; resumeAfter: string | null; blockedAt: string; resume: "EXPLICIT_ONLY";
}
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const EVIDENCE_REF_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RESUMABLE_KEYS = ["attempt", "blockedAt", "lastEvidenceRef", "limit", "outcome", "reason", "resume", "resumeAfter", "retryCount", "schema", "step"];
const isIso = (x: unknown): x is string => typeof x === "string" && ISO_UTC_RE.test(x) && Number.isFinite(Date.parse(x));
const isCount = (x: unknown, min: number): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= min;
export function isResumableBlockCheckpoint(x: unknown): x is ResumableBlockCheckpoint {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== RESUMABLE_KEYS.join(",")) return false;
  return o.outcome === "BLOCKED_RESUMABLE" && o.schema === 1 && isResumableBlockReason(o.reason) && limitFits(o.reason, o.limit)
    && isRunStep(o.step) && isCount(o.attempt, 1) && isCount(o.retryCount, 0)
    && (o.lastEvidenceRef === null || (typeof o.lastEvidenceRef === "string" && EVIDENCE_REF_RE.test(o.lastEvidenceRef)))
    && (o.resumeAfter === null || isIso(o.resumeAfter)) && isIso(o.blockedAt) && o.resume === "EXPLICIT_ONLY";
}
/** Doğrulanmış kayıt üretir; geçersiz girdi hata fırlatır (fail-closed: bozuk kayıt yazılmaz). */
export function resumableBlockCheckpoint(i: Omit<ResumableBlockCheckpoint, "outcome" | "schema" | "resume">): ResumableBlockCheckpoint {
  const c: ResumableBlockCheckpoint = {outcome: "BLOCKED_RESUMABLE", schema: 1, reason: i.reason, limit: i.limit, step: i.step, attempt: i.attempt, retryCount: i.retryCount,
    lastEvidenceRef: i.lastEvidenceRef, resumeAfter: i.resumeAfter, blockedAt: i.blockedAt, resume: "EXPLICIT_ONLY"};
  if (!isResumableBlockCheckpoint(c)) throw new Error("INVALID_RESUMABLE_BLOCK_CHECKPOINT");
  return c;
}
type RunView = {status: RunStatus; reason: string | null; step: RunStep; checkpoints: readonly RunCheckpoint[]};
/** Son checkpoint geçerli bir devam-ettirilebilir engel kaydıysa onu döndürür (sonraki bir checkpoint onu geçersiz kılar). */
export function pendingResumableBlock(run: Pick<RunView, "step" | "checkpoints">): ResumableBlockCheckpoint | null {
  const last = run.checkpoints[run.checkpoints.length - 1];
  return last && last.step === run.step && isResumableBlockCheckpoint(last.data) && last.data.step === run.step ? last.data : null;
}
/** BLOCKED bir run'ın sınıfı: kayıtlı ve nedeni eşleşen kota engeli BLOCKED_RESUMABLE; diğer her BLOCKED BLOCKED_TERMINAL; BLOCKED değilse null. */
export function blockClass(run: RunView): "BLOCKED_RESUMABLE" | "BLOCKED_TERMINAL" | null {
  if (run.status !== "BLOCKED") return null;
  const p = pendingResumableBlock(run);
  return p && run.reason === p.reason ? "BLOCKED_RESUMABLE" : "BLOCKED_TERMINAL";
}
/** Kendiliğinden devam (devralma, crash-resume, zamanlayıcı) yasağı: bekleyen devam-ettirilebilir engel varsa adım yeniden yürütülmez. */
export const autoResumeAllowed = (run: Pick<RunView, "step" | "checkpoints">): boolean => pendingResumableBlock(run) === null;
export type ResumeRequest = {explicit: true; requestedBy: string};
export type ResumeGateResult = {ok: true; checkpoint: ResumableBlockCheckpoint} | {ok: false; reason: "RESUME_REQUIRES_EXPLICIT_CALL" | "NOT_RESUMABLE" | "RESUME_NOT_YET_DUE"};
// //TR: UASCO-T0049: devam ettirilen run'ın mission'ı, engellendiği adımın çalıştığı mission durumuna geri alınır (adım -> mission durumu eşlemesi runner'ın MISSION_AFTER/startMission kurallarıyla aynıdır).
export function resumeMissionStatus(step: RunStep, remediationCycle: number): MissionStatus {
  switch (step) {
    case "WORKSPACE": return "PLANNED";
    case "IMPLEMENT": return remediationCycle === 0 ? "EXECUTING" : "REMEDIATING";
    case "VERIFY": case "SECURITY": return "VERIFYING";
    case "REVIEW": return "REVIEWING";
    case "REGRESSION": return "REGRESSION";
    case "REPORT": return "REPORTING";
  }
}
/** Açık resume kapısı (P2 sürdürme bunu kullanacak; bu paket sürdürmez): yalnız açık istek + BLOCKED_RESUMABLE + resumeAfter geçmiş. */
export function resumeGate(run: RunView, request: unknown, nowMs: number): ResumeGateResult {
  const r = request as Partial<ResumeRequest> | null | undefined;
  if (!r || typeof r !== "object" || r.explicit !== true || typeof r.requestedBy !== "string" || r.requestedBy.trim().length === 0) return {ok: false, reason: "RESUME_REQUIRES_EXPLICIT_CALL"};
  if (blockClass(run) !== "BLOCKED_RESUMABLE") return {ok: false, reason: "NOT_RESUMABLE"};
  const c = pendingResumableBlock(run)!;
  if (c.resumeAfter !== null && !(nowMs >= Date.parse(c.resumeAfter))) return {ok: false, reason: "RESUME_NOT_YET_DUE"};
  return {ok: true, checkpoint: c};
}
