// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0004 bulut Control API kapısının çalışma zamanı yokken fail-closed davrandığını, https zorunluluğunu, oturum imzasını, tenant çapraz erişim reddini, en az yetkiyi, secret redaksiyonunu ve bütçe sınırlı model çağrısını doğrular.
import {describe, it, expect} from "vitest";
import {createHmac} from "node:crypto";
import {
  CloudGateway, TenantBudget, authorize, issueSession, resolveCloudRuntimeConfig, verifySession,
  type GatewayAuditRecord, type ModelProvider,
} from "../../apps/control-api/src/cloud/remote-gateway.js";

const KEY = "session-fixture-key-".repeat(3);
const keys = new Map([["sk-1", KEY]]);
const t0 = new Date("2026-11-03T12:00:00Z");
const ENV = {UASCO_CLOUD_ENDPOINT: "https://cloud.example.invalid/api", UASCO_CLOUD_ENVIRONMENT: "staging"};
const PROVIDER_SECRET = "provider-fixture-credential-0123456789";
const tok = (tenantId = "tenant-001", roles: ("FOUNDER" | "OPERATOR" | "VIEWER")[] = ["OPERATOR"], ttl = 3_600_000, now = t0) =>
  issueSession({subject: "user-001", tenantId, roles}, ttl, "sk-1", KEY, now);
const req = {model: "claude-sonnet-5-5", prompt: "hello", maxOutputTokens: 100, maxCostUsd: 0.5};

function fakeProvider(behaviour: "ok" | "throw" | "hang" | "overrun" = "ok"): ModelProvider & {calls: number} {
  const p = {name: "fake", calls: 0, async invoke(_r: unknown, signal: AbortSignal) {
    p.calls++;
    if (behaviour === "throw") throw new Error(`upstream rejected key ${PROVIDER_SECRET} sk-ant-${"x".repeat(24)}`);
    if (behaviour === "hang") return new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    return {text: "hi", inputTokens: 5, outputTokens: 2, costUsd: behaviour === "overrun" ? 0.9 : 0.01};
  }};
  return p;
}
function gw(over: Partial<ConstructorParameters<typeof CloudGateway>[0]> = {}) {
  const audit: GatewayAuditRecord[] = [];
  const g = new CloudGateway({env: ENV, sessionKeys: keys, budget: new TenantBudget(new Map([["tenant-001", 1], ["tenant-002", 1]])), provider: fakeProvider(),
    audit: r => audit.push(r), knownSecrets: [PROVIDER_SECRET], now: () => t0, providerTimeoutMs: 50, ...over});
  return {g, audit};
}

export function registerCloudGatewayCases(): void {
  describe("CLOUD-T0004 cloud Control API gateway", () => {
    it("no cloud endpoint -> CLOUD_RUNTIME_NOT_CONFIGURED for every call; the provider is never reached (no local fallback)", async () => {
      const p = fakeProvider(); const {g, audit} = gw({env: {}, provider: p});
      expect(g.status()).toEqual({status: "CLOUD_RUNTIME_NOT_CONFIGURED"});
      expect(await g.invokeModel(tok(), "tenant-001", req)).toEqual({ok: false, reason: "CLOUD_RUNTIME_NOT_CONFIGURED"});
      expect(g.gate(tok(), "job.read", "tenant-001")).toEqual({ok: false, reason: "CLOUD_RUNTIME_NOT_CONFIGURED"});
      expect(p.calls).toBe(0); expect(audit.every(a => a.decision === "DENIED")).toBe(true);
    });

    it("endpoint must be https without credentials/query; loopback refused in production", () => {
      for (const e of ["http://cloud.example.invalid", "https://u:p@cloud.example.invalid", "https://cloud.example.invalid/?k=v", "not a url", "file:///etc/x"])
        expect(resolveCloudRuntimeConfig({UASCO_CLOUD_ENDPOINT: e})).toEqual({ok: false, reason: "ENDPOINT_INSECURE"});
      expect(resolveCloudRuntimeConfig({UASCO_CLOUD_ENDPOINT: "https://localhost:8443", UASCO_CLOUD_ENVIRONMENT: "production"})).toEqual({ok: false, reason: "ENDPOINT_INSECURE"});
      expect(resolveCloudRuntimeConfig({UASCO_CLOUD_ENDPOINT: "https://cloud.example.invalid", UASCO_CLOUD_ENVIRONMENT: "prod"})).toEqual({ok: false, reason: "CLOUD_RUNTIME_NOT_CONFIGURED"});
      expect(resolveCloudRuntimeConfig(ENV)).toMatchObject({ok: true});
    });

    it("sessions: signed, expiring, revocable; tampering and unknown keys are invalid", () => {
      const t = tok();
      expect(verifySession(t, keys, t0)).toMatchObject({ok: true, session: {tenantId: "tenant-001", roles: ["OPERATOR"]}});
      const [v, k, body, sig] = t.split(".");
      const forged = JSON.parse(Buffer.from(body!, "base64url").toString()); forged.roles = ["FOUNDER"]; forged.tenantId = "tenant-002";
      expect(verifySession(`${v}.${k}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, keys, t0)).toEqual({ok: false, reason: "SESSION_INVALID"});
      expect(verifySession(t, new Map([["sk-1", "other-session-key-".repeat(3)]]), t0)).toEqual({ok: false, reason: "SESSION_INVALID"});
      expect(verifySession(t, keys, new Date(t0.getTime() + 3_600_000))).toEqual({ok: false, reason: "SESSION_EXPIRED"});
      const sid = (verifySession(t, keys, t0) as {session: {sid: string}}).session.sid;
      expect(verifySession(t, keys, t0, new Set([sid]))).toEqual({ok: false, reason: "SESSION_INVALID"});
      for (const x of [undefined, "", "v1.sk-1.e30.00", "v2." + t.slice(3), 42]) expect(verifySession(x, keys, t0)).toMatchObject({ok: false});
      expect(() => tok("tenant-001", ["OPERATOR"], 13 * 3_600_000)).toThrow(/TTL/);
      expect(() => issueSession({subject: "u-1", tenantId: "t-1", roles: ["ADMIN" as "VIEWER"]}, 1000, "sk-1", KEY, t0)).toThrow(/ROLES/);
    });

    it("cross-tenant access is denied even for FOUNDER; least privilege per role", () => {
      const s = (verifySession(tok("tenant-001", ["FOUNDER"]), keys, t0) as {session: Parameters<typeof authorize>[0]}).session;
      expect(authorize(s, "job.read", "tenant-002")).toEqual({ok: false, reason: "TENANT_DENIED"});
      const {g} = gw();
      expect(g.gate(tok("tenant-001", ["VIEWER"]), "job.submit", "tenant-001")).toEqual({ok: false, reason: "ROLE_DENIED"});
      expect(g.gate(tok("tenant-001", ["OPERATOR"]), "system.stop", "tenant-001")).toEqual({ok: false, reason: "ROLE_DENIED"});
      expect(g.gate(tok("tenant-001", ["FOUNDER"]), "system.stop", "tenant-001")).toMatchObject({ok: true});
      expect(g.gate(tok("tenant-001", ["VIEWER"]), "artifact.download", "tenant-001")).toMatchObject({ok: true});
    });

    it("model invocation: allowed call is bounded by the tenant budget and audited with its cost", async () => {
      const p = fakeProvider(); const {g, audit} = gw({provider: p});
      expect(await g.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: true, response: {text: "hi"}});
      expect(await g.invokeModel(tok("tenant-002"), "tenant-001", req)).toEqual({ok: false, reason: "TENANT_DENIED"});
      expect(await g.invokeModel(tok(), "tenant-001", {...req, maxCostUsd: 5})).toEqual({ok: false, reason: "BUDGET_EXCEEDED"});
      expect(await g.invokeModel(tok(), "tenant-001", {...req, maxCostUsd: 0})).toEqual({ok: false, reason: "COST_INVALID"});
      expect(await g.invokeModel(tok(), "tenant-001", {...req, model: "../x"})).toEqual({ok: false, reason: "REQUEST_INVALID"});
      expect(p.calls).toBe(1);
      expect(audit.find(a => a.decision === "ALLOWED")).toMatchObject({costUsd: 0.01, overrun: false, tenantId: "tenant-001"});
    });

    it("no provider or no budget -> refused before any call (fail-closed)", async () => {
      expect(await gw({provider: null}).g.invokeModel(tok(), "tenant-001", req)).toEqual({ok: false, reason: "PROVIDER_NOT_CONFIGURED"});
      expect(await gw({budget: null}).g.invokeModel(tok(), "tenant-001", req)).toEqual({ok: false, reason: "BUDGET_NOT_CONFIGURED"});
      expect(await gw({budget: new TenantBudget(new Map())}).g.invokeModel(tok(), "tenant-001", req)).toEqual({ok: false, reason: "BUDGET_NOT_CONFIGURED"});
    });

    it("provider error text is redacted (known secret, key patterns, session tokens) and its cost is charged at the reserved cap", async () => {
      const budget = new TenantBudget(new Map([["tenant-001", 1]]));
      const {g, audit} = gw({provider: fakeProvider("throw"), budget});
      const t = tok();
      const r = await g.invokeModel(t, "tenant-001", req);
      expect(r).toMatchObject({ok: false, reason: "PROVIDER_ERROR"});
      const all = JSON.stringify([r, audit]);
      expect(all).not.toContain(PROVIDER_SECRET); expect(all).not.toMatch(/sk-ant-x{20}/);
      expect(g.redact(`token ${t}`)).toBe("token [REDACTED_SESSION]");
      expect(budget.committed("tenant-001")).toBeCloseTo(0.5);
    });

    it("provider timeout aborts the call and is reported; overrun is recorded at the real cost", async () => {
      expect(await gw({provider: fakeProvider("hang")}).g.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: false, reason: "PROVIDER_TIMEOUT"});
      const budget = new TenantBudget(new Map([["tenant-001", 1]]));
      const {g, audit} = gw({provider: fakeProvider("overrun"), budget});
      expect(await g.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: true});
      expect(audit.at(-1)).toMatchObject({overrun: true, costUsd: 0.9});
      expect(await g.invokeModel(tok(), "tenant-001", req)).toEqual({ok: false, reason: "BUDGET_EXCEEDED"});
    });
      it("BLOCKING fix: a known secret that contains a key pattern is fully redacted (known secrets first, longest first)", async () => {
      const secret = "sk-ant-api03-" + "Z".repeat(30) + ".PRIVATE/tail+value=Q9xT7wLm";
      const aws = ["AKIA", "ABCDEFGHIJKLMNOP", ":wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"].join("");   // örnek değer; çalışma anında birleştirilir
      const prov: ModelProvider = {name: "leaky", async invoke() { throw new Error(`denied for ${secret} and ${aws}`); }};
      const {g, audit} = gw({provider: prov, knownSecrets: [aws, secret]});
      const r = await g.invokeModel(tok(), "tenant-001", req);
      const all = JSON.stringify([r, audit]);
      for (const leak of ["PRIVATE/tail", "Q9xT7wLm", "wJalrXUtnFEMI", "EXAMPLEKEY"]) expect(all).not.toContain(leak);
    });

    it("L-2: prototype names are never roles (issue and verify), a bad role is a deny not a throw", () => {
      expect(() => issueSession({subject: "user-001", tenantId: "tenant-001", roles: ["constructor" as "VIEWER"]}, 1000, "sk-1", KEY, t0)).toThrow(/ROLES/);
      for (const roles of [["constructor"], ["toString"], ["ADMIN"], []]) {
        const body = Buffer.from(JSON.stringify({sid: "s-1", subject: "user-001", tenantId: "tenant-001", roles, issuedAt: t0.getTime(), expiresAt: t0.getTime() + 60_000})).toString("base64url");
        const t = `v1.sk-1.${body}.${createHmac("sha256", KEY).update(`v1.sk-1.${body}`).digest("hex")}`;   // geçerli imzalı ama bozuk rol
        expect(verifySession(t, keys, t0)).toEqual({ok: false, reason: "SESSION_INVALID"});
        expect(gw().g.gate(t, "job.read", "tenant-001")).toEqual({ok: false, reason: "SESSION_INVALID"});
      }
    });

    it("GW6: a session issued in the future is invalid", () => {
      expect(verifySession(tok("tenant-001", ["OPERATOR"], 3_600_000, new Date(t0.getTime() + 5 * 60_000)), keys, t0)).toEqual({ok: false, reason: "SESSION_INVALID"});
    });

    it("L-3: production refuses every loopback form", () => {
      for (const host of ["localhost.", "foo.localhost", "LOCALHOST", "[::ffff:127.0.0.1]", "[::1]", "[::]", "127.1.2.3", "0.0.0.0"])
        expect(resolveCloudRuntimeConfig({UASCO_CLOUD_ENDPOINT: `https://${host}:8443/`, UASCO_CLOUD_ENVIRONMENT: "production"})).toEqual({ok: false, reason: "ENDPOINT_INSECURE"});
      expect(resolveCloudRuntimeConfig({UASCO_CLOUD_ENDPOINT: "https://cloud.example.invalid/", UASCO_CLOUD_ENVIRONMENT: "production"})).toMatchObject({ok: true});
    });

    it("L-4/L-5: an audit sink failure never changes the result or double-settles; an invalid provider cost is charged at the cap and audited", async () => {
      const budget = new TenantBudget(new Map([["tenant-001", 1]]));
      const g1 = gw({budget, audit: () => { throw new Error("sink down"); }}).g;
      expect(await g1.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: true});
      expect(budget.committed("tenant-001")).toBeCloseTo(0.01);
      const neg: ModelProvider = {name: "neg", async invoke() { return {text: "x", inputTokens: 1, outputTokens: 1, costUsd: -5}; }};
      const {g, audit} = gw({provider: neg});
      expect(await g.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: true, response: {costUsd: 0.5}});
      expect(audit.at(-1)).toMatchObject({decision: "ALLOWED", costUsd: 0.5, reason: "PROVIDER_COST_INVALID"});
      for (const t of [Number.NaN, 0, Number.POSITIVE_INFINITY, 5]) expect(() => gw({providerTimeoutMs: t})).toThrow(/PROVIDER_TIMEOUT_INVALID/);
    });

    it("GW10/GW13: on timeout the provider's signal is aborted; after success no timer is left running", async () => {
      let seen: AbortSignal | undefined;
      const hang: ModelProvider = {name: "hang", invoke: (_r, signal) => { seen = signal; return new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))); }};
      expect(await gw({provider: hang}).g.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: false, reason: "PROVIDER_TIMEOUT"});
      expect(seen?.aborted).toBe(true);
      let fast: AbortSignal | undefined;
      const quick: ModelProvider = {name: "quick", async invoke(_r, signal) { fast = signal; return {text: "ok", inputTokens: 1, outputTokens: 1, costUsd: 0.01}; }};
      expect(await gw({provider: quick, providerTimeoutMs: 20}).g.invokeModel(tok(), "tenant-001", req)).toMatchObject({ok: true});
      await new Promise(r => setTimeout(r, 60));
      expect(fast?.aborted).toBe(false);   // zamanlayıcı temizlendi: başarılı çağrının sinyali sonradan abort edilmez
    });
      it("N-1/G2: overlapping and nested known secrets are fully redacted, in any configuration order", () => {
      const C = "AAAAAAAA11111111", D = "11111111BBBBBBBB", outer = "PREFIX-" + C + "-SUFFIX";
      for (const order of [[C, D, outer], [outer, D, C], [D, C, outer]]) {
        const {g} = gw({knownSecrets: order});
        expect(g.redact(`x AAAAAAAA11111111BBBBBBBB y`)).toBe("x [REDACTED] y");
        expect(g.redact(`x ${outer} y`)).toBe("x [REDACTED] y");
        expect(g.redact(`${C} ${D}`)).toBe("[REDACTED] [REDACTED]");
      }
    });

    it("N-2/G12: an audit-sink failure on the FAILED path still returns the redacted failure", async () => {
      const prov: ModelProvider = {name: "fail", async invoke() { throw new Error(`boom ${PROVIDER_SECRET}`); }};
      const budget = new TenantBudget(new Map([["tenant-001", 1]]));
      const r = await gw({provider: prov, budget, audit: () => { throw new Error("sink down"); }}).g.invokeModel(tok(), "tenant-001", req);
      expect(r).toMatchObject({ok: false, reason: "PROVIDER_ERROR"});
      expect(JSON.stringify(r)).not.toContain(PROVIDER_SECRET);
      expect(budget.committed("tenant-001")).toBeCloseTo(0.5);
    });

    it("N-2/G15: tenant isolation is decided before roles (cross-tenant VIEWER asking for STOP -> TENANT_DENIED)", () => {
      expect(gw().g.gate(tok("tenant-002", ["VIEWER"]), "system.stop", "tenant-001")).toEqual({ok: false, reason: "TENANT_DENIED"});
    });
  });
}
