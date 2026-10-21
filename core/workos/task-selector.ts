// //TR: Bu modül üretim kuyruğundaki sıradaki uygun görevi seçen SAF ve deterministik çekirdektir (G/Ç yok, saat yok: "now" gözlemle gelir): capacityRule birebir uygulanır (ACTIVE >= builderCap ise NO_ACTION), yalnız QUEUED/HOLD_CAPACITY ve tabanı sağlanmış görevler seçilir, yetki/kurucu bayraklı görev asla seçilmez, hat dengesi en az aktif işli hattı, eşitlikte kuyruk sırasını tercih eder; eksik/bozuk alan seçim değil kodlu BLOCKED üretir (fail-closed). dispatch.mjs'e bağlı DEĞİLDİR.

export const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const HOLDING_STATUSES = new Set(["IN_PROGRESS", "CLAIMED"]);
const SELECTABLE_STATUSES = new Set(["QUEUED", "HOLD_CAPACITY"]);
const SATISFIED_DEP_STATUSES = new Set(["TESTED", "INTEGRATED", "PRODUCT_ACCEPTED"]);
const KNOWN_STATUSES = new Set(["QUEUED", "HOLD_CAPACITY", "WAITING_BASE", "CLAIMED", "IN_PROGRESS", "CODE_IMPLEMENTED", "TESTED", "INTEGRATED", "PRODUCT_ACCEPTED", "BLOCKED", "FOUNDER_QUEUE", "REVIEW_REJECTED", "REPAIR_QUEUED"]);
const TASK_ID_RE = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;
const LANE_RE = /^([A-Z])(?:\s|$)/;
const INTEGRATION_BASE_RE = /^(?:v7\/integration(?:@[0-9a-f]{7,40})?|[0-9a-f]{7,40})$/;
const AFTER_BASE_RE = /^after ([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)(?:\s|$)/;
const BRANCH_BASE_RE = /^(claude\/[A-Za-z0-9._\/-]+?)(?:@[0-9a-f]{7,40})?(?:\s|$)/;

export interface QueueTask {
  id: string;
  status: string;
  base?: string;
  lane?: string;
  branch?: string | null;
  startedAt?: string | null;
  authority?: string | null;
  founderOnly?: boolean;
}
export interface TaskQueue { builderCap: number; tasks: QueueTask[] }
export interface ClaimBranch { branch: string; headAt: number }
/** Gözlem: açık PR dalları, canlı claim dalları (baş commit zamanıyla) ve şimdiki zaman (ms); hepsi çağıran tarafından verilir. */
export interface Observed { now: number; openPrBranches: string[]; claimBranches: ClaimBranch[] }

export type BlockedCode =
  | "QUEUE_INVALID" | "BUILDER_CAP_INVALID" | "OBSERVED_INVALID" | "TASK_INVALID" | "TASK_ID_DUPLICATE"
  | "TASK_STATUS_UNKNOWN" | "TASK_STARTED_AT_INVALID" | "TASK_LANE_INVALID" | "TASK_BASE_INVALID";
export type Selection =
  | {action: "SELECT"; taskId: string; lane: string; active: number; builderCap: number}
  | {action: "NO_ACTION"; reason: "CAPACITY" | "NO_ELIGIBLE_TASK"; active: number; builderCap: number}
  | {action: "BLOCKED"; code: BlockedCode; taskId: string | null};

const blocked = (code: BlockedCode, taskId: string | null = null): Selection => ({action: "BLOCKED", code, taskId});
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const isTime = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const hasText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** Yetki/kurucu işaretli görev (serbest metin authority alanı dolu, founderOnly true veya FOUNDER_QUEUE) asla seçilmez. */
const needsAuthority = (t: QueueTask): boolean => hasText(t.authority) || t.founderOnly === true || t.status === "FOUNDER_QUEUE";

/**
 * Sıradaki görevi seçer. Saf fonksiyon: aynı (queue, observed) her zaman aynı sonucu verir.
 * ACTIVE = (IN_PROGRESS/CLAIMED, açık PR'ı olmayan ve startedAt'ı 6 saatten genç görevler) + (açık PR'ı olmayan, 6 saatten genç, henüz sayılmamış claim dalları).
 */
export function selectNextTask(queue: TaskQueue, observed: Observed): Selection {
  if (!isObj(queue) || !Array.isArray(queue.tasks)) return blocked("QUEUE_INVALID");
  const cap = queue.builderCap;
  if (!Number.isSafeInteger(cap) || cap < 1) return blocked("BUILDER_CAP_INVALID");
  if (!isObj(observed) || !isTime(observed.now) || !Array.isArray(observed.openPrBranches) || !Array.isArray(observed.claimBranches)
    || observed.openPrBranches.some(b => !hasText(b)) || observed.claimBranches.some(c => !isObj(c) || !hasText(c.branch) || !isTime(c.headAt))) return blocked("OBSERVED_INVALID");
  const now = observed.now, openPr = new Set(observed.openPrBranches);

  const ids = new Set<string>();
  for (const t of queue.tasks) {
    if (!isObj(t) || !hasText(t.id) || !TASK_ID_RE.test(t.id) || !hasText(t.status)) return blocked("TASK_INVALID", isObj(t) && typeof t.id === "string" ? t.id : null);
    if (ids.has(t.id)) return blocked("TASK_ID_DUPLICATE", t.id);
    ids.add(t.id);
    if (!KNOWN_STATUSES.has(t.status)) return blocked("TASK_STATUS_UNKNOWN", t.id);
  }
  const byId = new Map(queue.tasks.map(t => [t.id, t]));

  // ACTIVE sayımı (capacityRule): görev tutanlar + görevce sayılmayan canlı claim dalları.
  const counted = new Set<string>();
  const laneActive = new Map<string, number>();
  let active = 0;
  for (const t of queue.tasks) {
    if (!HOLDING_STATUSES.has(t.status)) continue;
    const start = typeof t.startedAt === "string" ? Date.parse(t.startedAt) : NaN;
    if (!Number.isFinite(start)) return blocked("TASK_STARTED_AT_INVALID", t.id);
    if (hasText(t.branch)) { counted.add(t.branch); if (openPr.has(t.branch)) continue; }
    if (now - start >= ACTIVE_WINDOW_MS) continue;
    active++;
    const lane = hasText(t.lane) ? LANE_RE.exec(t.lane)?.[1] : undefined;
    if (lane) laneActive.set(lane, (laneActive.get(lane) ?? 0) + 1);
  }
  const seenClaim = new Set<string>();
  for (const c of observed.claimBranches) {
    if (counted.has(c.branch) || seenClaim.has(c.branch) || openPr.has(c.branch) || now - c.headAt >= ACTIVE_WINDOW_MS) continue;
    seenClaim.add(c.branch);
    active++;
  }
  if (active >= cap) return {action: "NO_ACTION", reason: "CAPACITY", active, builderCap: cap};

  const baseSatisfied = (t: QueueTask): boolean | null => {
    if (!hasText(t.base)) return null;
    const base = t.base.trim();
    if (INTEGRATION_BASE_RE.test(base)) return true;
    const after = AFTER_BASE_RE.exec(base);
    if (after) { const dep = byId.get(after[1]); return dep !== undefined && SATISFIED_DEP_STATUSES.has(dep.status); }
    const br = BRANCH_BASE_RE.exec(base);
    if (br) return openPr.has(br[1]) || observed.claimBranches.some(c => c.branch === br[1]);
    return null;
  };

  const candidates: Array<{t: QueueTask; lane: string; index: number}> = [];
  for (const [index, t] of queue.tasks.entries()) {
    if (!SELECTABLE_STATUSES.has(t.status) || needsAuthority(t)) continue;
    const lane = hasText(t.lane) ? LANE_RE.exec(t.lane)?.[1] : undefined;
    if (!lane) return blocked("TASK_LANE_INVALID", t.id);
    const ok = baseSatisfied(t);
    if (ok === null) return blocked("TASK_BASE_INVALID", t.id);
    if (ok) candidates.push({t, lane, index});
  }
  if (!candidates.length) return {action: "NO_ACTION", reason: "NO_ELIGIBLE_TASK", active, builderCap: cap};
  candidates.sort((a, b) => (laneActive.get(a.lane) ?? 0) - (laneActive.get(b.lane) ?? 0) || a.index - b.index);
  const pick = candidates[0];
  return {action: "SELECT", taskId: pick.t.id, lane: pick.lane, active, builderCap: cap};
}
