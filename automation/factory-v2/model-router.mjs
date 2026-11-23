// //TR: Factory V2 Claude-yerel uyarlanabilir model yönlendiricisi: her işçi oturumu için görev karmaşıklığı ve riskine göre model sınıfı seçer (MECHANICAL→Haiku, ROUTINE→Sonnet, CRITICAL→Opus), core/policy/model-routing.ts sözleşmesine uyar (sınıflar yalnız yukarı tırmanır, CRITICAL asla düşürülmez, REVIEWER builder oturumunu paylaşamaz). Seçim create_session'ın gerçek `model` alanıyla uygulanır; hesabın gerçek erişimi platformun bildirdiği hizmet veren modelden (get_session last_served_model) gözlemlenip kaydedilir. Kota, erişim ve yetkilendirme hataları ayrı sınıflanır; yükseltme sınırlıdır, model değişimi döngüye girmez ve bir modelin erişilemezliği diğer bağımsız işleri durdurmaz.
import {riskOf} from "./review.mjs";

export const MODEL_CLASSES = Object.freeze(["CHEAP", "STANDARD", "SENIOR"]); // same order as core/policy/model-routing.ts MODEL_CLASS_ORDER
export const COMPLEXITY_CLASS = Object.freeze({MECHANICAL: "CHEAP", ROUTINE: "STANDARD", CRITICAL: "SENIOR"});
/**
 * Default catalog: Claude Code model aliases first (they track the current release of each family), then current full ids as fallbacks.
 * Overridable per deployment (config `models`). Nothing here is pinned to one release.
 */
export const DEFAULT_MODELS = Object.freeze({CHEAP: ["haiku", "claude-haiku-5-5"], STANDARD: ["sonnet", "claude-sonnet-5-5"], SENIOR: ["opus", "claude-opus-5-5"]});
const FAMILY = {CHEAP: /haiku/i, STANDARD: /sonnet/i, SENIOR: /opus/i};
export const classOfModel = id => (Object.keys(FAMILY).find(c => FAMILY[c].test(String(id ?? ""))) ?? null);
const rank = c => MODEL_CLASSES.indexOf(c);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;

export class RoutingError extends Error { constructor(code, detail) { super(`${code}${detail ? ":" + detail : ""}`); this.code = code; this.detail = detail; } }

/** Model-access failures, kept apart from task failures: QUOTA waits, ACCESS/AUTH never silently downgrade a class. */
export function classifyModelError(text) {
  const t = String(text ?? "");
  // QUOTA first: "rate limit exceeded for this OAuth token" is a quota condition (it resets), not an authorisation failure
  if (/\b429\b|rate.?limit|usage limit|quota|overloaded|five_hour|weekly limit|limit reached/i.test(t)) return "QUOTA";
  if (/\b401\b|unauthori[sz]ed|authentication|invalid (api )?(key|token)|oauth/i.test(t)) return "AUTH";
  if (/\b403\b|not (available|permitted|allowed|enabled)|no access|model.*(unavailable|not found|unsupported)|forbidden/i.test(t)) return "ACCESS";
  return null;
}

/**
 * Complexity of one worker job. Builders: from the task's risk (security / cross-system / high -> CRITICAL; T0 docs-only -> MECHANICAL).
 * Reviewers: never below the class the change needs; security / adversarial focus is CRITICAL.
 */
export function complexityOf(job) {
  const paths = job.paths ?? [];
  const risk = riskOf({paths, tier: job.tier ?? "T1", domain: job.area ?? null});
  if (job.role === "REVIEWER" && /SECURITY|ADVERSARIAL/.test(String(job.focus ?? ""))) return "CRITICAL";
  if (risk.level === "HIGH" || risk.security || risk.crossSystem) return "CRITICAL";
  if (job.tier === "T0" && paths.length && paths.every(p => /^docs\/|\.md$/i.test(p))) return "MECHANICAL";
  return "ROUTINE";
}

/**
 * Availability per model id, from platform observations recorded in the ledger:
 * OK (a session was served by it), ACCESS / AUTH (refused), QUOTA (until `until`). Unknown = not yet observed (allowed: first use is the probe).
 */
export const ACCESS_REPROBE_MS = 6 * 3600_000; // an ACCESS / AUTH refusal is re-probed after this, so it never pins routing forever
export function availabilityFrom(observations, now = Date.now(), reprobeMs = ACCESS_REPROBE_MS) {
  const m = new Map();
  for (const o of observations) {
    if (!o?.model) continue;
    if (o.outcome === "OK") m.set(o.model, {state: "OK", at: o.at});
    else if (o.outcome === "QUOTA") m.set(o.model, {state: (o.until ?? 0) > now ? "QUOTA" : "UNKNOWN", until: o.until});
    else if (["ACCESS", "AUTH"].includes(o.outcome)) m.set(o.model, (o.at ?? 0) + reprobeMs > now ? {state: o.outcome, at: o.at} : {state: "UNKNOWN", at: o.at});
  }
  return m;
}

/**
 * Route one job. Mirrors core/policy/model-routing.ts: start at the complexity's class, only climb, never below it; a REVIEWER must not
 * share the builder's session. `escalate` (bounded by the caller) raises the floor by one class after a capability failure.
 * Returns {decision: ROUTE|WAIT|REFUSE, code, complexity, modelClass, model, reasons}.
 */
export function routeJob(job, {models = DEFAULT_MODELS, availability = new Map(), escalate = 0} = {}) {
  if (!["BUILDER", "REVIEWER"].includes(job.role)) return {decision: "REFUSE", code: "INVALID_ROLE", reasons: [`role ${job.role}`]};
  if (job.role === "REVIEWER" && job.builderSession && job.reviewerSession && job.builderSession === job.reviewerSession) return {decision: "REFUSE", code: "REVIEWER_NOT_INDEPENDENT", reasons: ["reviewer shares the builder session"]};
  const complexity = job.complexity ?? complexityOf(job);
  const base = COMPLEXITY_CLASS[complexity];
  if (!base) return {decision: "REFUSE", code: "INVALID_COMPLEXITY", reasons: [String(complexity)]};
  const floor = MODEL_CLASSES[Math.min(MODEL_CLASSES.length - 1, rank(base) + Math.max(0, Math.min(escalate, 2)))];
  const reasons = [`${job.role} complexity ${complexity} -> ${base}`];
  if (floor !== base) reasons.push(`escalated ${base} -> ${floor} after ${escalate} capability failure(s)`);
  let waitingOnQuota = false;
  for (const modelClass of MODEL_CLASSES.slice(rank(floor))) {
    for (const model of models[modelClass] ?? []) {
      if (!SAFE_ID.test(model) || classOfModel(model) !== modelClass) continue; // a catalog entry that is not really of this class is ignored
      const a = availability.get(model)?.state ?? "UNKNOWN";
      if (a === "OK" || a === "UNKNOWN") {
        if (modelClass !== floor) reasons.push(`no usable ${floor} model: using ${modelClass} (never below the required class)`);
        reasons.push(`model ${model} (${a === "OK" ? "served before" : "first use: verified from the platform after spawn"})`);
        return {decision: "ROUTE", code: "ROUTED", complexity, requiredClass: floor, modelClass, model, reasons};
      }
      if (a === "QUOTA") waitingOnQuota = true;
      reasons.push(`${model} ${a}`);
    }
    // a class that is only rate-limited WAITS (its quota resets); climbing would spend a more expensive model's quota on cheaper work.
    // Climbing happens only past a class that is not accessible at all (ACCESS / AUTH), never below the required class.
    if (waitingOnQuota) return {decision: "WAIT", code: "MODEL_QUOTA_WAIT", complexity, requiredClass: floor, reasons};
  }
  // CRITICAL is never routed below SENIOR; a required class with no usable model waits (QUOTA) or is refused (ACCESS/AUTH) - no silent downgrade.
  return {decision: "REFUSE", code: "NO_PERMITTED_MODEL", complexity, requiredClass: floor, reasons};
}

/** The served model satisfies the routed requirement (family at or above the required class). */
export function servedSatisfies(requiredClass, servedModel) {
  const c = classOfModel(servedModel);
  return !!c && rank(c) >= rank(requiredClass);
}

/**
 * Fields the platform reports for a session (get_session): the model it was created with, the model it is set to run, the model that served
 * its latest turn, and the platform-reported cost. Unknown fields stay null: nothing is estimated here.
 */
export function sessionModelFacts(info) {
  const c = info?.ccr ?? info ?? {};
  const em = c.external_metadata ?? {};
  const cost = em.usage?.cost_usd;
  return {sessionId: c.id ?? null, configuredModel: c.configured_model ?? null, sessionModel: c.session_context?.model ?? null, servedModel: em.last_served_model ?? null,
    costUsdReported: typeof cost === "number" ? cost : null, rateLimit: em.rate_limit_info ? {status: em.rate_limit_info.status ?? null, type: em.rate_limit_info.rateLimitType ?? null, resetsAt: em.rate_limit_info.resetsAt ?? null} : null};
}
