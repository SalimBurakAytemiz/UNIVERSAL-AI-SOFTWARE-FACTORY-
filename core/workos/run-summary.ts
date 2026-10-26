//TR: Bu dosya Work OS koşularının hafif, sayfalanmış özetini yalnız store kayıtlarından türetir (tam evidence/checkpoint dizileri, lease kimliği ve yol göndermeden); en yeni önce sıralı, opak imleçle sayfalar ve tenant kapsamlıdır.
import type {Scope, WorkRun, RunStatus, RunStep} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {RUN_STATUSES} from "./run-state.js";
import {redactSecrets} from "./secret-scan.js";

export const RUN_SUMMARY_DEFAULT_LIMIT = 25;
export const RUN_SUMMARY_MAX_LIMIT = 100;
export interface RunSummary {
  runId: string; missionId: string; projectId: string; status: RunStatus; step: RunStep; attempt: number; retryCount: number; remediationCycle: number;
  reason: string | null; headSha: string | null; executor: { implementer: string; reviewer: string };
  evidenceCount: number; checkpointCount: number; createdAt: string; updatedAt: string;
  delivery: { artifactPrepared: boolean; sourceAccepted: boolean; productVerified: boolean };
}
export interface RunSummaryPage { runs: RunSummary[]; nextCursor: string | null; total: number }
export interface RunSummaryQuery { projectId?: string; missionId?: string; status?: RunStatus; limit?: number; cursor?: string }
export class RunSummaryError extends Error { constructor(readonly code: "INVALID_CURSOR" | "INVALID_LIMIT" | "INVALID_STATUS") { super(code); this.name = "RunSummaryError"; } }

export const summarizeRun = (r: WorkRun): RunSummary => ({
  runId: r.runId, missionId: r.missionId, projectId: r.projectId, status: r.status, step: r.step, attempt: r.attempt, retryCount: r.retryCount, remediationCycle: r.remediationCycle,
  reason: typeof r.reason === "string" && r.reason.trim() ? redactSecrets(r.reason).slice(0, 200) : null, headSha: r.headSha, executor: {implementer: r.executor.implementer, reviewer: r.executor.reviewer},
  evidenceCount: r.evidence.length, checkpointCount: r.checkpoints.length, createdAt: r.createdAt, updatedAt: r.updatedAt,
  delivery: {artifactPrepared: r.deliveryArtifact !== undefined, sourceAccepted: r.sourceDelivery !== undefined, productVerified: r.completion !== undefined}
});

// İmleç: son öğenin (createdAt, runId) çifti; sıralama createdAt azalan, eşitlikte runId azalan. İmleç yalnız bu iki alanı taşır, başka veri açmaz.
const encode = (r: { createdAt: string; runId: string }) => Buffer.from(JSON.stringify({c: r.createdAt, r: r.runId}), "utf8").toString("base64url");
function decode(cursor: string): { c: string; r: string } {
  try {
    const j = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (j && typeof j.c === "string" && typeof j.r === "string" && /^run_[0-9a-f]{24}$/.test(j.r) && j.c.length <= 40 && Object.keys(j).length === 2) return j;
  } catch { /* geçersiz */ }
  throw new RunSummaryError("INVALID_CURSOR");
}
const before = (a: { createdAt: string; runId: string }, c: { c: string; r: string }) => a.createdAt < c.c || (a.createdAt === c.c && a.runId < c.r);

export function listRunSummaries(store: WorkOsStore, scope: Scope, q: RunSummaryQuery = {}): RunSummaryPage {
  const limit = q.limit ?? RUN_SUMMARY_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > RUN_SUMMARY_MAX_LIMIT) throw new RunSummaryError("INVALID_LIMIT");
  if (q.status !== undefined && !(RUN_STATUSES as readonly string[]).includes(q.status)) throw new RunSummaryError("INVALID_STATUS");
  const cur = q.cursor === undefined ? null : decode(q.cursor);
  const all = store.listRuns(scope, q.missionId).filter(r => (q.projectId === undefined || r.projectId === q.projectId) && (q.status === undefined || r.status === q.status))
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.runId < b.runId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  const rest = cur ? all.filter(r => before(r, cur)) : all;
  const page = rest.slice(0, limit);
  return {runs: page.map(summarizeRun), nextCursor: rest.length > limit ? encode(page[page.length - 1]) : null, total: all.length};
}
