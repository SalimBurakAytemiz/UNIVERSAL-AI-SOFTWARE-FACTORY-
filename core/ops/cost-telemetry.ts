// //TR: UASCO-T0111 Bu dosya geliştirme düzlemi maliyet telemetrisinin SAF çekirdeğidir: get_session biçimli ham oturum kaydını fail-closed ayrıştırır (eksik maliyet UNKNOWN'dır, asla 0 sayılmaz; negatif/sayı olmayan değer reddedilir), günlük anlık görüntüyü toplar ve bütçe kararını verir (UNKNOWN hiçbir zaman CONTINUE'ya eşlenmez). G/Ç, HTTP, ücretli çağrı yoktur; controller/ledger bağlantısı korunan yolların sahibine bırakılmış bir takip işidir.
//
// Input shape: the fields read from a get_session-shaped record are listed in COST_SOURCE_FIELDS. Their exact location in a real
// get_session response is an ASSUMPTION of this slice and must be checked against a real response before the protected-owner wiring.
// cost_usd is API-equivalent (what the same tokens would cost on the API), not money charged; basis is always "API_EQUIVALENT".

export const COST_TELEMETRY_SCHEMA = "uasco.cost-telemetry.daily/v1" as const;
export const COST_SOURCE_FIELDS = Object.freeze({
  sessionId: "id",
  model: "external_metadata.last_served_model | session_context.model",
  costUsd: "external_metadata.cost_usd",
  tokens: "external_metadata.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}",
  routineFire: "trigger_id (non-empty string => ROUTINE_FIRE)",
} as const);

export type CostKind = "SESSION" | "ROUTINE_FIRE";
export type CostState = "KNOWN" | "UNKNOWN";
export interface TokenCounts { input: number | null; output: number | null; cacheRead: number | null; cacheCreation: number | null }
export interface CostRecord {
  sessionId: string;
  kind: CostKind;
  model: string | null;
  capturedAt: string;
  day: string;
  costState: CostState;
  costUsd: number | null;
  tokens: TokenCounts;
  basis: "API_EQUIVALENT";
}
export type ParseResult = {ok: true; record: CostRecord} | {ok: false; code: string};

const SESSION_ID = /^session_[A-Za-z0-9]{1,128}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_KEYS: ReadonlyArray<[keyof TokenCounts, string]> = [["input", "input_tokens"], ["output", "output_tokens"], ["cacheRead", "cache_read_input_tokens"], ["cacheCreation", "cache_creation_input_tokens"]];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function isoInstant(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_UTC.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === v.slice(0, 19) ? v : null;   // rejects 2026-02-30 style rollovers
}
function modelOf(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const m = v.trim();
  return m.length > 0 && m.length <= 200 ? m : undefined;
}

/** Parses one get_session-shaped record. Fail-closed: anything malformed is rejected; a missing cost is UNKNOWN, never 0. */
export function parseSessionCost(raw: unknown, capturedAt: string): ParseResult {
  const fail = (code: string): ParseResult => ({ok: false, code});
  if (!isObj(raw)) return fail("NOT_OBJECT");
  if (typeof raw.id !== "string" || !SESSION_ID.test(raw.id)) return fail("SESSION_ID_INVALID");
  const at = isoInstant(capturedAt);
  if (at === null) return fail("CAPTURED_AT_INVALID");
  const meta = raw.external_metadata;
  if (meta !== undefined && meta !== null && !isObj(meta)) return fail("METADATA_INVALID");
  const m = isObj(meta) ? meta : {};
  const ctx = isObj(raw.session_context) ? raw.session_context : {};

  let costUsd: number | null = null;
  if (m.cost_usd !== undefined && m.cost_usd !== null) {
    if (typeof m.cost_usd !== "number" || !Number.isFinite(m.cost_usd) || m.cost_usd < 0) return fail("COST_INVALID");
    costUsd = m.cost_usd;
  }
  const tokens: TokenCounts = {input: null, output: null, cacheRead: null, cacheCreation: null};
  if (m.usage !== undefined && m.usage !== null) {
    if (!isObj(m.usage)) return fail("TOKENS_INVALID");
    for (const [k, src] of TOKEN_KEYS) {
      const v = m.usage[src];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return fail("TOKENS_INVALID");
      tokens[k] = v;
    }
  }
  const served = modelOf(m.last_served_model);
  const configured = modelOf(ctx.model);
  if (served === undefined || configured === undefined) return fail("MODEL_INVALID");
  const trig = raw.trigger_id;
  if (trig !== undefined && trig !== null && typeof trig !== "string") return fail("TRIGGER_INVALID");
  return {ok: true, record: {
    sessionId: raw.id, kind: typeof trig === "string" && trig.length > 0 ? "ROUTINE_FIRE" : "SESSION", model: served ?? configured,
    capturedAt: at, day: at.slice(0, 10), costState: costUsd === null ? "UNKNOWN" : "KNOWN", costUsd, tokens, basis: "API_EQUIVALENT",
  }};
}

export interface DailyAggregate {
  day: string;
  sessions: number;
  routineFires: number;
  knownCostUsd: number;
  unknownCostCount: number;
  completeness: "COMPLETE" | "INCOMPLETE";
  tokens: {input: number; output: number; cacheRead: number; cacheCreation: number; unknownTokenFields: number};
}
export class CostTelemetryError extends Error { constructor(readonly code: string) { super(code); this.name = "CostTelemetryError"; } }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Latest snapshot per session for one UTC day (cost_usd is cumulative per session, so a later capture supersedes an earlier one).
 * Records of other days are ignored. Two captures of one session at the same instant that disagree are a conflict (thrown).
 */
export function latestPerSession(records: readonly CostRecord[], day: string): CostRecord[] {
  if (!DAY.test(day)) throw new CostTelemetryError("DAY_INVALID");
  const by = new Map<string, CostRecord>();
  for (const r of records) {
    if (r.day !== day) continue;
    const prev = by.get(r.sessionId);
    if (!prev || r.capturedAt > prev.capturedAt) { by.set(r.sessionId, r); continue; }
    if (r.capturedAt === prev.capturedAt && JSON.stringify(r) !== JSON.stringify(prev)) throw new CostTelemetryError(`DUPLICATE_CONFLICT:${r.sessionId}`);
  }
  return [...by.values()].sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

export function aggregateDaily(records: readonly CostRecord[], day: string): DailyAggregate {
  const latest = latestPerSession(records, day);
  const agg: DailyAggregate = {day, sessions: 0, routineFires: 0, knownCostUsd: 0, unknownCostCount: 0, completeness: "COMPLETE",
    tokens: {input: 0, output: 0, cacheRead: 0, cacheCreation: 0, unknownTokenFields: 0}};
  for (const r of latest) {
    if (r.kind === "ROUTINE_FIRE") agg.routineFires++; else agg.sessions++;
    if (r.costState === "KNOWN" && r.costUsd !== null) agg.knownCostUsd += r.costUsd; else agg.unknownCostCount++;
    for (const [k] of TOKEN_KEYS) { const v = r.tokens[k]; if (v === null) agg.tokens.unknownTokenFields++; else agg.tokens[k] += v; }
  }
  agg.knownCostUsd = round6(agg.knownCostUsd);
  agg.completeness = agg.unknownCostCount === 0 ? "COMPLETE" : "INCOMPLETE";
  return agg;
}

export type BudgetDecision = "CONTINUE" | "STOP" | "UNKNOWN";
export interface BudgetVerdict { decision: BudgetDecision; reason: string; spentKnownUsd: number; thresholdUsd: number | null; remainingKnownUsd: number | null }

/**
 * STOP when the known spend alone reaches the threshold (unknown costs can only add to it).
 * Otherwise UNKNOWN while any session's cost is unknown, and CONTINUE only when every cost is known and below the threshold.
 * An invalid threshold is UNKNOWN. UNKNOWN never maps to CONTINUE (see mayContinue).
 */
export function decideBudget(agg: DailyAggregate, thresholdUsd: number): BudgetVerdict {
  const spent = agg.knownCostUsd;
  if (typeof thresholdUsd !== "number" || !Number.isFinite(thresholdUsd) || thresholdUsd <= 0) return {decision: "UNKNOWN", reason: "THRESHOLD_INVALID", spentKnownUsd: spent, thresholdUsd: null, remainingKnownUsd: null};
  const remaining = round6(thresholdUsd - spent);
  if (spent >= thresholdUsd) return {decision: "STOP", reason: "THRESHOLD_REACHED", spentKnownUsd: spent, thresholdUsd, remainingKnownUsd: remaining};
  if (agg.unknownCostCount > 0 || agg.completeness !== "COMPLETE") return {decision: "UNKNOWN", reason: `COST_UNKNOWN:${agg.unknownCostCount}`, spentKnownUsd: spent, thresholdUsd, remainingKnownUsd: remaining};
  return {decision: "CONTINUE", reason: "UNDER_THRESHOLD", spentKnownUsd: spent, thresholdUsd, remainingKnownUsd: remaining};
}
/** The only gate a caller may use to keep going: true for CONTINUE, false for STOP and UNKNOWN. */
export const mayContinue = (v: BudgetVerdict): boolean => v.decision === "CONTINUE";

export interface DailySnapshot { schema: typeof COST_TELEMETRY_SCHEMA; day: string; basis: "API_EQUIVALENT"; source: "get_session"; aggregate: DailyAggregate; records: CostRecord[] }

export function buildDailySnapshot(records: readonly CostRecord[], day: string): DailySnapshot {
  return {schema: COST_TELEMETRY_SCHEMA, day, basis: "API_EQUIVALENT", source: "get_session", aggregate: aggregateDaily(records, day), records: latestPerSession(records, day)};
}

/** Validates a stored daily snapshot (e.g. read back from a repo JSON file): shape, per-record invariants, and that the aggregate recomputes exactly. */
export function validateDailySnapshot(raw: unknown): {ok: true; snapshot: DailySnapshot} | {ok: false; code: string} {
  const fail = (code: string) => ({ok: false as const, code});
  if (!isObj(raw)) return fail("NOT_OBJECT");
  const allowed = new Set(["schema", "day", "basis", "source", "aggregate", "records"]);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) return fail(`UNKNOWN_KEY:${k}`);
  if (raw.schema !== COST_TELEMETRY_SCHEMA) return fail("SCHEMA_MISMATCH");
  if (typeof raw.day !== "string" || !DAY.test(raw.day)) return fail("DAY_INVALID");
  if (raw.basis !== "API_EQUIVALENT") return fail("BASIS_INVALID");
  if (raw.source !== "get_session") return fail("SOURCE_INVALID");
  if (!Array.isArray(raw.records)) return fail("RECORDS_INVALID");
  const seen = new Set<string>();
  for (const r of raw.records as unknown[]) {
    if (!isObj(r) || typeof r.sessionId !== "string" || !SESSION_ID.test(r.sessionId)) return fail("RECORD_INVALID");
    if (seen.has(r.sessionId)) return fail(`RECORD_DUPLICATE:${r.sessionId}`);
    seen.add(r.sessionId);
    if (r.day !== raw.day || isoInstant(r.capturedAt) === null || (r.capturedAt as string).slice(0, 10) !== raw.day) return fail(`RECORD_DAY:${r.sessionId}`);
    if (r.basis !== "API_EQUIVALENT" || (r.kind !== "SESSION" && r.kind !== "ROUTINE_FIRE")) return fail(`RECORD_INVALID:${r.sessionId}`);
    const known = r.costState === "KNOWN", unknown = r.costState === "UNKNOWN";
    const costOk = known ? typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0 : unknown && r.costUsd === null;
    if (!costOk) return fail(`RECORD_COST:${r.sessionId}`);
    if (!isObj(r.tokens)) return fail(`RECORD_TOKENS:${r.sessionId}`);
    for (const [k] of TOKEN_KEYS) { const v = r.tokens[k]; if (!(v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0))) return fail(`RECORD_TOKENS:${r.sessionId}`); }
  }
  const records = raw.records as CostRecord[];
  let recomputed: DailyAggregate;
  try { recomputed = aggregateDaily(records, raw.day); } catch (e) { return fail(e instanceof CostTelemetryError ? e.code : "AGGREGATE_FAILED"); }
  if (JSON.stringify(recomputed) !== JSON.stringify(raw.aggregate)) return fail("AGGREGATE_MISMATCH");
  return {ok: true, snapshot: raw as unknown as DailySnapshot};
}
