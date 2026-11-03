// //TR: Bu dosya CLOUD-T0015 bulut model sağlayıcı yönlendirmesini uygular: yetenek/veri politikası ile aday seçimi, tenant ve sağlayıcı başına pencereli kota, deterministik fallback (politika reddi ve tenant ihlalinde fallback yok), tek bütçe ayırımı ile çift faturalamasız deneme, devre kesici geri çekilme ve redakte edilmiş denetim kaydı. Gerçek sağlayıcı istemcisi yoktur (D-08: 0 USD).
import {redactSecrets} from "../../core/workos/secret-scan.js";
import {canRouteData, type CostTier} from "../../core/policy/data-routing.js";
import type {DataClass} from "../../core/mission/types.js";
import type {ModelProvider, ModelRequest, ModelResponse, TenantBudget} from "../../apps/control-api/src/cloud/remote-gateway.js";

// ---------- types ----------
export interface QuotaLimits {windowMs: number; maxRequests: number; maxTokens: number; maxCostUsd: number}
export interface BreakerOptions {failureThreshold: number; baseCooldownMs: number; maxCooldownMs: number}
export interface ProviderRoute {
  id: string;
  provider: ModelProvider;
  tier: CostTier;
  /** Yetenek → sağlayıcıya özgü model kimliği (ör. "code.review" → "sonnet-x"). Görev başına model seçimi buradan gelir. */
  models: Readonly<Record<string, string>>;
  /** Küçük değer önce denenir; eşitlikte maliyet katmanı, sonra id (deterministik sıra). */
  priority: number;
  quota: QuotaLimits;
}
export interface RoutingContext {
  /** Doğrulanmış oturumun tenant'ı (CloudGateway.gate sonucu). */
  sessionTenantId: string;
  /** İsteğin hedeflediği kaynak tenant'ı. Eşleşmezse TENANT_DENIED; fallback yok. */
  tenantId: string;
  subject: string;
  /** PAID katmanı yalnız açık onayla (ör. Founder D-03/D-29 kapısı) seçilebilir. */
  /** NB-2: gateway entegrasyonu bunu doğrulanabilir bir Founder onayından türetmelidir; istek gövdesinden ASLA kabul edilmez. */
  paidApproved?: boolean;
  signal?: AbortSignal;
}
export interface RoutedRequest {
  capability: string;
  dataClass: DataClass;
  prompt: string;
  maxOutputTokens: number;
  /** Tek bir denemenin maliyet tavanı. */
  maxCostUsd: number;
  /** Tüm denemelerin toplam tavanı (tek TenantBudget ayırımı). Verilmezse maxCostUsd. */
  maxTotalCostUsd?: number;
}
export type RouteDeny =
  | "REQUEST_INVALID" | "TENANT_DENIED" | "NO_PROVIDER_PERMITTED" | "TENANT_QUOTA_NOT_CONFIGURED" | "TENANT_QUOTA_EXCEEDED" | "BUDGET_NOT_CONFIGURED" | "BUDGET_EXCEEDED"
  | "COST_INVALID" | "POLICY_REFUSAL" | "ALL_PROVIDERS_FAILED" | "BUDGET_EXHAUSTED_BY_FAILURES" | "ABORTED";
export type AttemptOutcome = "OK" | "PROVIDER_ERROR" | "PROVIDER_TIMEOUT" | "PROVIDER_AUTH_FAILED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_RESPONSE_INVALID"
  | "POLICY_REFUSAL" | "SKIPPED_QUOTA" | "SKIPPED_CIRCUIT_OPEN";
export interface AttemptRecord {providerId: string; model: string; outcome: AttemptOutcome; chargedUsd: number}
export interface RoutingAuditRecord {
  at: string; tenantId: string | null; subject: string | null; capability: string | null;
  decision: "ROUTED" | "DENIED" | "FAILED" | "ATTEMPT"; providerId?: string; outcome?: AttemptOutcome; reason?: string; costUsd?: number;
}
export type RouteResult =
  | {ok: true; providerId: string; model: string; response: ModelResponse; attempts: AttemptRecord[]; chargedUsd: number}
  | {ok: false; reason: RouteDeny; attempts: AttemptRecord[]; chargedUsd: number; detail?: string; overrun?: true};

export interface ProviderRouterOptions {
  routes: readonly ProviderRoute[];
  budget: TenantBudget | null;
  tenantQuotas: ReadonlyMap<string, QuotaLimits>;
  audit: (r: RoutingAuditRecord) => void;
  breaker?: BreakerOptions;
  knownSecrets?: readonly string[];
  now?: () => number;
  attemptTimeoutMs?: number;
}

// ---------- validation helpers ----------
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TIER_RANK: Record<CostTier, number> = {LOCAL: 0, FREE: 1, SUBSCRIPTION: 2, PAID: 3};
const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const posNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const nonNeg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
function validQuota(q: QuotaLimits | undefined): boolean {
  return !!q && posInt(q.windowMs) && posInt(q.maxRequests) && posInt(q.maxTokens) && posNum(q.maxCostUsd);
}
/** Kaba ama sabit giriş token tahmini; kota ön kontrolü için (gerçek kullanım yanıt sonrası yazılır). */
export const estimateInputTokens = (prompt: string): number => Math.ceil(prompt.length / 4);

// ---------- sliding-window quota ----------
interface QuotaEntry {at: number; tokens: number; costUsd: number}
/** Anahtar başına kayan pencere. Ön kontrolde girdi hemen yazılır (eşzamanlı aşım yok), sonra gerçek değerle düzeltilir. */
export class QuotaTracker {
  private readonly entries = new Map<string, QuotaEntry[]>();
  private live(key: string, windowMs: number, now: number): QuotaEntry[] {
    const list = (this.entries.get(key) ?? []).filter(e => now - e.at < windowMs);
    this.entries.set(key, list); return list;
  }
  tryReserve(key: string, q: QuotaLimits, now: number, tokens: number, costUsd: number): QuotaEntry | null {
    const list = this.live(key, q.windowMs, now);
    const t = list.reduce((s, e) => s + e.tokens, 0), c = list.reduce((s, e) => s + e.costUsd, 0);
    if (list.length + 1 > q.maxRequests || t + tokens > q.maxTokens || c + costUsd > q.maxCostUsd + 1e-9) return null;
    const e = {at: now, tokens, costUsd}; list.push(e); return e;
  }
  usage(key: string, windowMs: number, now: number): {requests: number; tokens: number; costUsd: number} {
    const list = this.live(key, windowMs, now);
    return {requests: list.length, tokens: list.reduce((s, e) => s + e.tokens, 0), costUsd: list.reduce((s, e) => s + e.costUsd, 0)};
  }
}

// ---------- circuit breaker ----------
interface BreakerState {failures: number; trips: number; openUntil: number; probing: boolean}
const DEFAULT_BREAKER: BreakerOptions = {failureThreshold: 3, baseCooldownMs: 30_000, maxCooldownMs: 15 * 60_000};

// ---------- provider error classification ----------
/** Sağlayıcı hatası `code` taşıyabilir. `billedUsd` sağlayıcının bildirdiği gerçek ücrettir; yoksa deneme tavanı yazılır (eksik faturalama yok). */
export interface ProviderFailure extends Error {code?: string; billedUsd?: number}
function classify(e: unknown): Exclude<AttemptOutcome, "OK" | "SKIPPED_QUOTA" | "SKIPPED_CIRCUIT_OPEN" | "PROVIDER_RESPONSE_INVALID"> {
  switch ((e as {code?: unknown})?.code) {
    case "PROVIDER_TIMEOUT": return "PROVIDER_TIMEOUT";
    case "POLICY_REFUSAL": return "POLICY_REFUSAL";
    case "AUTH_FAILED": return "PROVIDER_AUTH_FAILED";
    case "RATE_LIMITED": case "QUOTA_EXCEEDED": return "PROVIDER_RATE_LIMITED";
    default: return "PROVIDER_ERROR";
  }
}
function validResponse(r: unknown): r is ModelResponse {
  const x = r as ModelResponse;
  return !!x && typeof x === "object" && typeof x.text === "string" && Number.isSafeInteger(x.inputTokens) && x.inputTokens >= 0
    && Number.isSafeInteger(x.outputTokens) && x.outputTokens >= 0;
}

// ---------- router ----------
export class ProviderRouter {
  private readonly routes: readonly ProviderRoute[];
  private readonly breakerOpts: BreakerOptions;
  private readonly breakers = new Map<string, BreakerState>();
  private readonly quotas = new QuotaTracker();
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly o: ProviderRouterOptions) {
    const seen = new Set<string>();
    for (const r of o.routes) {
      if (!r || !ID_RE.test(r.id) || seen.has(r.id)) throw new Error("ROUTE_ID_INVALID");
      seen.add(r.id);
      if (!r.provider || typeof r.provider.invoke !== "function") throw new Error("ROUTE_PROVIDER_INVALID");
      if (!Object.hasOwn(TIER_RANK, r.tier)) throw new Error("ROUTE_TIER_INVALID");
      if (!Number.isSafeInteger(r.priority)) throw new Error("ROUTE_PRIORITY_INVALID");
      if (!validQuota(r.quota)) throw new Error("ROUTE_QUOTA_INVALID");
      const entries = r.models && typeof r.models === "object" ? Object.entries(r.models) : [];
      if (entries.length === 0 || entries.some(([c, m]) => !ID_RE.test(c) || typeof m !== "string" || !ID_RE.test(m))) throw new Error("ROUTE_MODELS_INVALID");
    }
    for (const q of o.tenantQuotas.values()) if (!validQuota(q)) throw new Error("TENANT_QUOTA_INVALID");
    const b = o.breaker ?? DEFAULT_BREAKER;
    if (!posInt(b.failureThreshold) || !posInt(b.baseCooldownMs) || !posInt(b.maxCooldownMs) || b.maxCooldownMs < b.baseCooldownMs) throw new Error("BREAKER_INVALID");
    const t = o.attemptTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(t) || t < 10 || t > 600_000) throw new Error("ATTEMPT_TIMEOUT_INVALID");
    // deterministik fallback sırası: öncelik → maliyet katmanı → id
    this.routes = [...o.routes].sort((a, b) => a.priority - b.priority || TIER_RANK[a.tier] - TIER_RANK[b.tier] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.breakerOpts = b; this.timeoutMs = t; this.now = o.now ?? Date.now;
  }

  /** CloudGateway.redact ile aynı sıra: önce bilinen secret'lar (uzundan kısaya), sonra kalıplar. */
  redact(text: string): string {
    let out = String(text);
    const known = [...(this.o.knownSecrets ?? [])].filter(s => typeof s === "string" && s.length >= 8).sort((a, b) => b.length - a.length);
    for (const s of known) out = out.split(s).join("[REDACTED]");
    out = redactSecrets(out);
    return out.replace(/v1\.[A-Za-z0-9._:-]{3,128}\.[A-Za-z0-9_-]+\.[0-9a-f]{64}/g, "[REDACTED_SESSION]").slice(0, 2000);
  }

  private log(r: Omit<RoutingAuditRecord, "at">): void {
    try { this.o.audit({at: new Date(this.now()).toISOString(), ...r, ...(r.reason ? {reason: this.redact(r.reason)} : {})}); } catch { /* denetim hatası sonucu değiştirmez */ }
  }

  /** Politika + yetenek süzgecinden geçen adaylar, deterministik sırada. Devre/kota burada değil, deneme anında değerlendirilir. */
  candidates(capability: string, dataClass: DataClass, paidApproved: boolean): {route: ProviderRoute; model: string}[] {
    return this.routes
      .filter(r => Object.hasOwn(r.models, capability) && canRouteData(dataClass, r.tier) && (r.tier !== "PAID" || paidApproved === true))
      .map(route => ({route, model: route.models[capability]!}));
  }

  breakerState(providerId: string): {state: "CLOSED" | "OPEN" | "HALF_OPEN"; failures: number; openUntil: number} {
    const b = this.breakers.get(providerId);
    if (!b || b.openUntil === 0) return {state: "CLOSED", failures: b?.failures ?? 0, openUntil: 0};
    return {state: this.now() >= b.openUntil ? "HALF_OPEN" : "OPEN", failures: b.failures, openUntil: b.openUntil};
  }

  quotaUsage(key: {tenantId: string} | {providerId: string}): {requests: number; tokens: number; costUsd: number} | null {
    const [k, q] = "tenantId" in key ? [`t:${key.tenantId}`, this.o.tenantQuotas.get(key.tenantId)] : [`p:${key.providerId}`, this.routes.find(r => r.id === key.providerId)?.quota];
    return q ? this.quotas.usage(k, q.windowMs, this.now()) : null;
  }

  /** Devre açıkken atla; soğuma bittiyse tek bir deneme (half-open) geçer. */
  private admit(id: string): boolean {
    const b = this.breakers.get(id);
    if (!b || b.openUntil === 0) return true;
    if (this.now() < b.openUntil || b.probing) return false;
    b.probing = true; return true;
  }
  private onSuccess(id: string): void { this.breakers.set(id, {failures: 0, trips: 0, openUntil: 0, probing: false}); }
  private onFailure(id: string): void {
    const b = this.breakers.get(id) ?? {failures: 0, trips: 0, openUntil: 0, probing: false};
    b.failures += 1;
    if (b.probing || b.failures >= this.breakerOpts.failureThreshold) {
      b.trips += 1;
      const cool = Math.min(this.breakerOpts.maxCooldownMs, this.breakerOpts.baseCooldownMs * 2 ** Math.min(b.trips - 1, 30));
      b.openUntil = this.now() + cool;
    }
    b.probing = false; this.breakers.set(id, b);
  }
  /** Devreyi etkilemeyen sonuç (politika reddi): half-open sondası serbest kalır. */
  private onNeutral(id: string): void { const b = this.breakers.get(id); if (b) b.probing = false; }

  async route(ctx: RoutingContext, req: RoutedRequest): Promise<RouteResult> {
    const attempts: AttemptRecord[] = [];
    const tenantOk = typeof ctx?.tenantId === "string" && ID_RE.test(ctx.tenantId);
    const capOk = typeof req?.capability === "string" && ID_RE.test(req.capability);
    const base = {tenantId: tenantOk ? ctx.tenantId : null, subject: typeof ctx?.subject === "string" && ID_RE.test(ctx.subject) ? ctx.subject : null, capability: capOk ? req.capability : null};
    let overrun = false;   // settle, bildirilen gerçek ücret toplam tavanı aştıysa işaretler (eksik faturalama yok)
    const deny = (reason: RouteDeny, chargedUsd = 0, detail?: string): RouteResult => {
      const why = (detail ? `${reason}: ${detail}` : reason) + (overrun ? " [BUDGET_OVERRUN]" : "");
      this.log({...base, decision: reason === "ALL_PROVIDERS_FAILED" || reason === "BUDGET_EXHAUSTED_BY_FAILURES" || reason === "POLICY_REFUSAL" ? "FAILED" : "DENIED", reason: why, costUsd: chargedUsd});
      return {ok: false, reason, attempts, chargedUsd, ...(detail ? {detail} : {}), ...(overrun ? {overrun: true as const} : {})};
    };

    // 1) tenant izolasyonu önce: başka tenant'a yönelik istek hiçbir sağlayıcıya ulaşmaz
    if (!tenantOk || typeof ctx.sessionTenantId !== "string" || ctx.sessionTenantId !== ctx.tenantId) return deny("TENANT_DENIED");
    // 2) istek şekli
    const total = req?.maxTotalCostUsd ?? req?.maxCostUsd;
    if (!capOk || typeof req.prompt !== "string" || req.prompt.length === 0 || req.prompt.length > 1_000_000
      || !Number.isSafeInteger(req.maxOutputTokens) || req.maxOutputTokens < 1 || req.maxOutputTokens > 64_000) return deny("REQUEST_INVALID");
    if (!posNum(req.maxCostUsd) || !posNum(total) || total < req.maxCostUsd) return deny("COST_INVALID");
    // 3) politika: izinli aday yoksa fail-closed
    const cands = this.candidates(req.capability, req.dataClass, ctx.paidApproved === true);
    if (cands.length === 0) return deny("NO_PROVIDER_PERMITTED");
    // 4) tenant kotası tanımlı olmalı
    const tq = this.o.tenantQuotas.get(ctx.tenantId);
    if (!tq) return deny("TENANT_QUOTA_NOT_CONFIGURED");
    // 5) bütçe: tüm denemeler için TEK ayırım, sonda TEK uzlaşma (çift faturalama yok)
    if (!this.o.budget) return deny("BUDGET_NOT_CONFIGURED");
    const res = this.o.budget.reserve(ctx.tenantId, total);
    if (!res.ok) return deny(res.reason);

    let consumed = 0, settled = false;
    const settle = (extraUsd = 0): {chargedUsd: number; overrun: boolean} => {
      settled = true; const r = this.o.budget!.settle(res.id, consumed + extraUsd); overrun = r.overrun; return r;
    };
    try {
      const estIn = estimateInputTokens(req.prompt);
      let lastDetail = "";
      for (const {route, model} of cands) {
        if (ctx.signal?.aborted) { const s = settle(); return deny("ABORTED", s.chargedUsd); }
        const remaining = total - consumed;
        const cap = Math.min(req.maxCostUsd, remaining);
        if (!(cap > 1e-9)) { const s = settle(); return deny("BUDGET_EXHAUSTED_BY_FAILURES", s.chargedUsd, lastDetail || undefined); }
        if (!this.admit(route.id)) {
          attempts.push({providerId: route.id, model, outcome: "SKIPPED_CIRCUIT_OPEN", chargedUsd: 0});
          this.log({...base, decision: "ATTEMPT", providerId: route.id, outcome: "SKIPPED_CIRCUIT_OPEN"}); continue;
        }
        const projTokens = estIn + req.maxOutputTokens;
        // tenant kotası tüm tenant için geçerlidir: aşılırsa fallback yok
        const tEntry = this.quotas.tryReserve(`t:${ctx.tenantId}`, tq, this.now(), projTokens, cap);
        if (!tEntry) { this.onNeutral(route.id); const s = settle(); return deny("TENANT_QUOTA_EXCEEDED", s.chargedUsd); }
        const pEntry = this.quotas.tryReserve(`p:${route.id}`, route.quota, this.now(), projTokens, cap);
        if (!pEntry) {
          tEntry.tokens = 0; tEntry.costUsd = 0; tEntry.at = -Infinity;   // kullanılmayan tenant girdisi geri alınır
          this.onNeutral(route.id);
          attempts.push({providerId: route.id, model, outcome: "SKIPPED_QUOTA", chargedUsd: 0});
          this.log({...base, decision: "ATTEMPT", providerId: route.id, outcome: "SKIPPED_QUOTA"}); continue;
        }
        const fix = (tokens: number, usd: number) => { for (const e of [tEntry, pEntry]) { e.tokens = tokens; e.costUsd = usd; } };

        const r = await this.attempt(route.provider, {model, prompt: req.prompt, maxOutputTokens: req.maxOutputTokens, maxCostUsd: cap}, ctx.signal);
        if (r.kind === "ok") {
          const costOk = nonNeg(r.response.costUsd);
          const usd = costOk ? r.response.costUsd : cap;   // ölçülemeyen maliyet: deneme tavanı
          consumed += usd;
          fix(r.response.inputTokens + r.response.outputTokens, usd);
          this.onSuccess(route.id);
          attempts.push({providerId: route.id, model, outcome: "OK", chargedUsd: usd});
          const s = settle();
          this.log({...base, decision: "ROUTED", providerId: route.id, outcome: "OK", costUsd: s.chargedUsd, ...(costOk ? {} : {reason: "PROVIDER_COST_INVALID"}), ...(s.overrun ? {reason: "BUDGET_OVERRUN"} : {})});
          return {ok: true, providerId: route.id, model, response: {...r.response, costUsd: usd}, attempts, chargedUsd: s.chargedUsd};
        }
        // başarısız deneme: sağlayıcının bildirdiği gerçek ücret olduğu gibi (tavanı aşsa da; overrun settle'da işaretlenir), yoksa tavan
        const usd = nonNeg(r.billedUsd) ? r.billedUsd : cap;
        consumed += usd; fix(projTokens, usd);
        const detail = this.redact(r.message);
        lastDetail = `${route.id}: ${r.outcome}`;
        attempts.push({providerId: route.id, model, outcome: r.outcome, chargedUsd: usd});
        this.log({...base, decision: "ATTEMPT", providerId: route.id, outcome: r.outcome, reason: detail, costUsd: usd});
        if (r.outcome === "POLICY_REFUSAL") {
          // içerik politikası reddi başka sağlayıcıyla aşılmaz
          this.onNeutral(route.id); const s = settle(); return deny("POLICY_REFUSAL", s.chargedUsd, `${route.id}: ${detail}`);
        }
        if (r.aborted) { this.onNeutral(route.id); const s = settle(); return deny("ABORTED", s.chargedUsd); }
        this.onFailure(route.id);
      }
      const s = settle();
      return deny("ALL_PROVIDERS_FAILED", s.chargedUsd, attempts.map(a => `${a.providerId}:${a.outcome}`).join(","));
    } finally {
      if (!settled) this.o.budget.settle(res.id, Number.isFinite(total) ? total : Number.NaN);   // beklenmeyen istisna: tam tavan (eksik faturalama yok)
    }
  }

  private async attempt(provider: ModelProvider, req: ModelRequest, parent?: AbortSignal):
    Promise<{kind: "ok"; response: ModelResponse} | {kind: "fail"; outcome: Exclude<AttemptOutcome, "OK" | "SKIPPED_QUOTA" | "SKIPPED_CIRCUIT_OPEN">; message: string; billedUsd?: number; aborted: boolean}> {
    const ctl = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const onParent = () => ctl.abort();
    let onAbortReject: (() => void) | undefined;
    parent?.addEventListener("abort", onParent, {once: true});
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { rej(Object.assign(new Error("timeout"), {code: "PROVIDER_TIMEOUT"})); ctl.abort(); }, this.timeoutMs); });
      const aborted = new Promise<never>((_, rej) => {
        if (!parent) return;
        onAbortReject = () => rej(Object.assign(new Error("aborted"), {code: "ABORTED"}));
        if (parent.aborted) onAbortReject(); else parent.addEventListener("abort", onAbortReject, {once: true});
      });
      const response = await Promise.race([Promise.resolve().then(() => provider.invoke(req, ctl.signal)), timeout, aborted]);
      if (!validResponse(response)) return {kind: "fail", outcome: "PROVIDER_RESPONSE_INVALID", message: "provider response invalid", aborted: false};
      return {kind: "ok", response};
    } catch (e) {
      const code = (e as {code?: unknown})?.code;
      const billed = (e as ProviderFailure)?.billedUsd;
      return {kind: "fail", outcome: code === "ABORTED" ? "PROVIDER_ERROR" : classify(e), message: e instanceof Error ? e.message : String(e),
        ...(typeof billed === "number" ? {billedUsd: billed} : {}), aborted: code === "ABORTED" || parent?.aborted === true};
    } finally {
      if (timer) clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
      if (onAbortReject) parent?.removeEventListener("abort", onAbortReject);   // uzun ömürlü sinyalde dinleyici birikmez (LOW-4)
    }
  }
}
