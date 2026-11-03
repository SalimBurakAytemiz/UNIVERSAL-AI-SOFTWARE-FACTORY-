// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0015 sağlayıcı yönlendirmesinin yetenek/politika seçimini, tenant ve sağlayıcı kotasını, deterministik fallback'i, politika reddinde ve tenant ihlalinde fallback yapılmadığını, tek bütçe ayırımıyla çift faturalama olmadığını, devre kesiciyi ve redaksiyonu sahte sağlayıcılarla doğrular.
import {describe, it, expect} from "vitest";
import {TenantBudget, type ModelProvider, type ModelRequest, type ModelResponse} from "../../apps/control-api/src/cloud/remote-gateway.js";
import {ProviderRouter, type ProviderRoute, type QuotaLimits, type RoutingAuditRecord, type RoutedRequest, type RoutingContext} from "../../models/cloud-router/provider-routing.js";

const PROVIDER_SECRET = "provider-fixture-credential-0123456789";
const Q: QuotaLimits = {windowMs: 60_000, maxRequests: 100, maxTokens: 1_000_000, maxCostUsd: 100};
type Behaviour = (req: ModelRequest, signal: AbortSignal) => Promise<ModelResponse>;
const ok = (costUsd = 0.1): Behaviour => async () => ({text: "fine", inputTokens: 10, outputTokens: 20, costUsd});
const fail = (code?: string, billedUsd?: number, msg = "upstream 503"): Behaviour => async () => { throw Object.assign(new Error(msg), code ? {code} : {}, billedUsd === undefined ? {} : {billedUsd}); };
const hang: Behaviour = (_r, signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted by signal"))));

function fake(name: string, b: Behaviour): ModelProvider & {calls: ModelRequest[]} {
  const calls: ModelRequest[] = [];
  return {name, calls, invoke: (req, signal) => { calls.push(req); return b(req, signal); }};
}
const route = (id: string, provider: ModelProvider, over: Partial<ProviderRoute> = {}): ProviderRoute =>
  ({id, provider, tier: "SUBSCRIPTION", models: {"code.build": `${id}-sonnet`, "code.triage": `${id}-haiku`}, priority: 10, quota: Q, ...over});

function setup(routes: ProviderRoute[], o: {limit?: number; tenantQuota?: QuotaLimits | null; clock?: {t: number}; breaker?: {failureThreshold: number; baseCooldownMs: number; maxCooldownMs: number}} = {}) {
  const audit: RoutingAuditRecord[] = [];
  const budget = new TenantBudget(new Map([["tenant-001", o.limit ?? 10], ["tenant-002", 10]]));
  const clock = o.clock ?? {t: Date.parse("2026-11-03T12:00:00Z")};
  const tq = o.tenantQuota === null ? new Map<string, QuotaLimits>() : new Map([["tenant-001", o.tenantQuota ?? Q]]);
  const router = new ProviderRouter({routes, budget, tenantQuotas: tq, audit: r => audit.push(r), knownSecrets: [PROVIDER_SECRET], now: () => clock.t, attemptTimeoutMs: 30, breaker: o.breaker});
  return {router, budget, audit, clock};
}
const CTX: RoutingContext = {sessionTenantId: "tenant-001", tenantId: "tenant-001", subject: "user-001"};
const REQ: RoutedRequest = {capability: "code.build", dataClass: "INTERNAL", prompt: "build the thing", maxOutputTokens: 100, maxCostUsd: 1, maxTotalCostUsd: 3};

export function registerCloudProviderRoutingCases(): void {
  describe("cloud provider routing (CLOUD-T0015): selection and policy", () => {
    it("routes to the first permitted provider and picks the per-capability model", async () => {
      const a = fake("a", ok()), b = fake("b", ok());
      const {router, budget} = setup([route("prov-b", b, {priority: 20}), route("prov-a", a)]);
      const r = await router.route(CTX, {...REQ, capability: "code.triage"});
      expect(r).toMatchObject({ok: true, providerId: "prov-a", model: "prov-a-haiku", chargedUsd: 0.1});
      expect(a.calls[0]).toMatchObject({model: "prov-a-haiku", maxCostUsd: 1});
      expect(b.calls).toHaveLength(0);
      expect(budget.committed("tenant-001")).toBeCloseTo(0.1);
    });
    it("orders deterministically: priority, then tier, then id", () => {
      const p = fake("x", ok());
      const {router} = setup([route("zeta", p, {tier: "FREE"}), route("alpha", p, {tier: "SUBSCRIPTION"}), route("beta", p, {tier: "FREE"}), route("first", p, {priority: 1, tier: "PAID"})]);
      expect(router.candidates("code.build", "PUBLIC", true).map(c => c.route.id)).toEqual(["first", "beta", "zeta", "alpha"]);
    });
    it("fails closed when no provider is permitted (capability, data class, unapproved paid)", async () => {
      const p = fake("p", ok());
      const {router, budget, audit} = setup([route("free-1", p, {tier: "FREE"}), route("paid-1", p, {tier: "PAID"})]);
      expect(await router.route(CTX, {...REQ, capability: "image.gen"})).toMatchObject({ok: false, reason: "NO_PROVIDER_PERMITTED"});
      // INTERNAL data may not go to FREE; PAID needs explicit approval
      expect(await router.route(CTX, REQ)).toMatchObject({ok: false, reason: "NO_PROVIDER_PERMITTED"});
      expect(await router.route(CTX, {...REQ, dataClass: "SECRET"})).toMatchObject({ok: false, reason: "NO_PROVIDER_PERMITTED"});
      expect(p.calls).toHaveLength(0);
      expect(budget.committed("tenant-001")).toBe(0);
      expect(audit.at(-1)).toMatchObject({decision: "DENIED", reason: "NO_PROVIDER_PERMITTED"});
      expect(await router.route({...CTX, paidApproved: true}, REQ)).toMatchObject({ok: true, providerId: "paid-1"});
    });
    it("denies cross-tenant routing before any provider or budget is touched", async () => {
      const p = fake("p", ok());
      const {router, budget} = setup([route("prov-a", p)]);
      expect(await router.route({...CTX, tenantId: "tenant-002"}, REQ)).toMatchObject({ok: false, reason: "TENANT_DENIED", attempts: []});
      expect(p.calls).toHaveLength(0);
      expect(budget.committed("tenant-002")).toBe(0);
    });
    it("rejects invalid requests, costs, and missing tenant quota / budget", async () => {
      const p = fake("p", ok());
      const {router} = setup([route("prov-a", p)]);
      expect(await router.route(CTX, {...REQ, prompt: ""})).toMatchObject({reason: "REQUEST_INVALID"});
      expect(await router.route(CTX, {...REQ, maxOutputTokens: 0})).toMatchObject({reason: "REQUEST_INVALID"});
      expect(await router.route(CTX, {...REQ, maxCostUsd: Number.NaN})).toMatchObject({reason: "COST_INVALID"});
      expect(await router.route(CTX, {...REQ, maxTotalCostUsd: 0.5})).toMatchObject({reason: "COST_INVALID"});
      expect(await setup([route("prov-a", p)], {tenantQuota: null}).router.route(CTX, REQ)).toMatchObject({reason: "TENANT_QUOTA_NOT_CONFIGURED"});
      expect(await setup([route("prov-a", p)], {limit: 1}).router.route(CTX, REQ)).toMatchObject({reason: "BUDGET_EXCEEDED"});
      expect(p.calls).toHaveLength(0);
      expect(() => setup([route("dup", p), route("dup", p)])).toThrow("ROUTE_ID_INVALID");
      expect(() => setup([route("q", p, {quota: {...Q, maxCostUsd: -1}})])).toThrow("ROUTE_QUOTA_INVALID");
    });
  });

  describe("cloud provider routing (CLOUD-T0015): fallback and billing", () => {
    it("falls back on error, timeout and provider rate limit in fixed order, charging each attempt once", async () => {
      const e = fake("e", fail(undefined, 0)), t = fake("t", hang), l = fake("l", fail("RATE_LIMITED", 0)), g = fake("g", ok(0.2));
      const {router, budget} = setup([route("p1", e, {priority: 1}), route("p2", t, {priority: 2}), route("p3", l, {priority: 3}), route("p4", g, {priority: 4})]);
      const r = await router.route(CTX, {...REQ, maxTotalCostUsd: 5});
      expect(r.ok).toBe(true);
      expect(r.attempts.map(a => a.outcome)).toEqual(["PROVIDER_ERROR", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "OK"]);
      // the timed-out attempt has unknown cost → charged its cap (1); others reported 0; success 0.2
      expect(r.chargedUsd).toBeCloseTo(1.2);
      expect(budget.committed("tenant-001")).toBeCloseTo(1.2);
      // second attempt cap respects remaining total
      expect(g.calls[0]!.maxCostUsd).toBe(1);
    });
    it("never falls back on a policy refusal", async () => {
      const a = fake("a", fail("POLICY_REFUSAL", 0, "content refused")), b = fake("b", ok());
      const {router, budget} = setup([route("p1", a, {priority: 1}), route("p2", b, {priority: 2})]);
      const r = await router.route(CTX, REQ);
      expect(r).toMatchObject({ok: false, reason: "POLICY_REFUSAL", chargedUsd: 0});
      expect(b.calls).toHaveLength(0);
      expect(budget.committed("tenant-001")).toBe(0);
      expect(router.breakerState("p1").failures).toBe(0);
    });
    it("stops when failures exhaust the single total reservation (no over-charge)", async () => {
      const a = fake("a", fail()), b = fake("b", fail()), c = fake("c", ok());
      const {router, budget} = setup([route("p1", a, {priority: 1}), route("p2", b, {priority: 2}), route("p3", c, {priority: 3})]);
      const r = await router.route(CTX, {...REQ, maxTotalCostUsd: 1.5});
      expect(r).toMatchObject({ok: false, reason: "BUDGET_EXHAUSTED_BY_FAILURES"});
      expect(b.calls[0]!.maxCostUsd).toBeCloseTo(0.5);
      expect(c.calls).toHaveLength(0);
      expect(r.chargedUsd).toBeCloseTo(1.5);
      expect(budget.committed("tenant-001")).toBeCloseTo(1.5);   // reservation fully settled, nothing still held
    });
    it("reports ALL_PROVIDERS_FAILED and treats invalid responses as failures", async () => {
      const bad = fake("bad", async () => ({text: 42, inputTokens: -1, outputTokens: 0, costUsd: 0}) as unknown as ModelResponse);
      const {router, budget} = setup([route("p1", bad, {priority: 1}), route("p2", fake("x", fail(undefined, 0)), {priority: 2})]);
      const r = await router.route(CTX, {...REQ, maxTotalCostUsd: 3});
      expect(r).toMatchObject({ok: false, reason: "ALL_PROVIDERS_FAILED"});
      expect(r.attempts.map(a => a.outcome)).toEqual(["PROVIDER_RESPONSE_INVALID", "PROVIDER_ERROR"]);
      expect(budget.committed("tenant-001")).toBeCloseTo(1);
    });
    it("charges the attempt cap when a successful response reports invalid cost", async () => {
      const {router, audit} = setup([route("p1", fake("a", async () => ({text: "x", inputTokens: 1, outputTokens: 1, costUsd: Number.NaN})))]);
      const r = await router.route(CTX, REQ);
      expect(r).toMatchObject({ok: true, chargedUsd: 1});
      expect(audit.at(-1)).toMatchObject({decision: "ROUTED", reason: "PROVIDER_COST_INVALID"});
    });
    it("propagates caller abort without further fallback", async () => {
      const ctl = new AbortController();
      const a = fake("a", (_r, s) => { setTimeout(() => ctl.abort(), 1); return hang(_r, s); }), b = fake("b", ok());
      const {router} = setup([route("p1", a, {priority: 1}), route("p2", b, {priority: 2})]);
      const r = await router.route({...CTX, signal: ctl.signal}, REQ);
      expect(r).toMatchObject({ok: false, reason: "ABORTED"});
      expect(b.calls).toHaveLength(0);
      expect(router.breakerState("p1").failures).toBe(0);   // caller abort is not a provider fault
    });
  });

  describe("cloud provider routing (CLOUD-T0015): quotas and circuit breaker", () => {
    it("skips a provider whose window quota is exhausted, and recovers after the window", async () => {
      const a = fake("a", ok()), b = fake("b", ok());
      const {router, clock} = setup([route("p1", a, {priority: 1, quota: {...Q, maxRequests: 1}}), route("p2", b, {priority: 2})]);
      expect(await router.route(CTX, REQ)).toMatchObject({providerId: "p1"});
      const r = await router.route(CTX, REQ);
      expect(r).toMatchObject({ok: true, providerId: "p2"});
      expect(r.attempts[0]).toMatchObject({providerId: "p1", outcome: "SKIPPED_QUOTA", chargedUsd: 0});
      expect(router.quotaUsage({providerId: "p1"})).toMatchObject({requests: 1, tokens: 30});
      clock.t += 60_000;
      expect(await router.route(CTX, REQ)).toMatchObject({providerId: "p1"});
    });
    it("enforces per-provider token and cost windows", async () => {
      const a = fake("a", ok()), b = fake("b", ok());
      const {router} = setup([route("p1", a, {priority: 1, quota: {...Q, maxTokens: 50}}), route("p2", b, {priority: 2, quota: {...Q, maxCostUsd: 0.5}})]);
      // projected tokens = ceil(15/4)+100 = 104 > 50; projected cost cap 1 > 0.5
      expect(await router.route(CTX, REQ)).toMatchObject({ok: false, reason: "ALL_PROVIDERS_FAILED"});
      expect(a.calls.length + b.calls.length).toBe(0);
    });
    it("tenant quota exhaustion fails closed without trying other providers", async () => {
      const a = fake("a", ok()), b = fake("b", ok());
      const {router, budget} = setup([route("p1", a, {priority: 1}), route("p2", b, {priority: 2})], {tenantQuota: {...Q, maxRequests: 1}});
      expect(await router.route(CTX, REQ)).toMatchObject({ok: true});
      expect(await router.route(CTX, REQ)).toMatchObject({ok: false, reason: "TENANT_QUOTA_EXCEEDED"});
      expect(a.calls.length + b.calls.length).toBe(1);
      expect(budget.committed("tenant-001")).toBeCloseTo(0.1);   // second reservation released at zero cost
      expect(router.quotaUsage({tenantId: "tenant-001"})).toMatchObject({requests: 1});
    });
    it("opens the breaker after repeated failures, backs off exponentially, and closes after a successful probe", async () => {
      let mode: "fail" | "ok" = "fail";
      const a = fake("a", (r, s) => (mode === "fail" ? fail(undefined, 0) : ok())(r, s)), b = fake("b", ok());
      const {router, clock} = setup([route("p1", a, {priority: 1}), route("p2", b, {priority: 2})], {breaker: {failureThreshold: 2, baseCooldownMs: 1000, maxCooldownMs: 5000}});
      await router.route(CTX, REQ); await router.route(CTX, REQ);
      expect(router.breakerState("p1").state).toBe("OPEN");
      const r = await router.route(CTX, REQ);
      expect(r.attempts[0]).toMatchObject({outcome: "SKIPPED_CIRCUIT_OPEN"});
      expect(a.calls).toHaveLength(2);
      clock.t += 1000;                                  // half-open: one probe, fails → cooldown doubles
      expect(router.breakerState("p1").state).toBe("HALF_OPEN");
      await router.route(CTX, REQ);
      expect(router.breakerState("p1")).toMatchObject({state: "OPEN", openUntil: clock.t + 2000});
      clock.t += 2000; mode = "ok";
      expect(await router.route(CTX, REQ)).toMatchObject({providerId: "p1"});
      expect(router.breakerState("p1")).toMatchObject({state: "CLOSED", failures: 0});
    });
    it("fails closed when every candidate's breaker is open", async () => {
      const a = fake("a", fail(undefined, 0));
      const {router} = setup([route("p1", a)], {breaker: {failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 1000}});
      await router.route(CTX, REQ);
      expect(await router.route(CTX, REQ)).toMatchObject({ok: false, reason: "ALL_PROVIDERS_FAILED", chargedUsd: 0});
      expect(a.calls).toHaveLength(1);
    });
  });

  describe("cloud provider routing (CLOUD-T0015): redaction", () => {
    it("redacts provider secrets from errors and audit records", async () => {
      const a = fake("a", fail(undefined, 0, `401 bad key ${PROVIDER_SECRET} Bearer ${PROVIDER_SECRET}`)), b = fake("b", fail("POLICY_REFUSAL", 0, `refused for ${PROVIDER_SECRET}`));
      const {router, audit} = setup([route("p1", a, {priority: 1}), route("p2", b, {priority: 2})]);
      const r = await router.route(CTX, REQ);
      expect(r).toMatchObject({ok: false, reason: "POLICY_REFUSAL"});
      const all = JSON.stringify([r, audit]);
      expect(all).not.toContain(PROVIDER_SECRET);
      expect(all).toContain("[REDACTED]");
      // audit sink failures never change the outcome
      const bad = new ProviderRouter({routes: [route("p1", fake("c", ok()))], budget: new TenantBudget(new Map([["tenant-001", 5]])), tenantQuotas: new Map([["tenant-001", Q]]), audit: () => { throw new Error("sink down"); }});
      expect(await bad.route(CTX, REQ)).toMatchObject({ok: true});
    });
  });
}
