// //TR: Bu dosya worker run durumlarının (Master §06) açık allowlist geçiş tablosunu tanımlar; tabloda olmayan her geçiş fail-closed reddedilir ve journal replay'inde tamper sayılır.
import type {RunStatus, RunStep} from "./types.js";

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
