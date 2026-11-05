// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0012 staging/production ayrımını, örtüşen keyId ile oturum anahtarı rotasyonunu, sağlık durumunu ve yalnız yetkili production terfi kapısını ağsız, sahte secret'larla doğrular.
import {describe, it, expect} from "vitest";
import {createHmac} from "node:crypto";
import {issueSession, MAX_SESSION_TTL_MS} from "../../apps/control-api/src/cloud/remote-gateway.js";
import {
  SessionKeyRing, checkEnvironmentSeparation, evaluateHealth, evaluatePromotion, issueDeployApproval, secretsEqual, MAX_STAGING_EVIDENCE_AGE_MS, MAX_DEPLOY_APPROVAL_TTL_MS,
  MAX_CLOCK_SKEW_MS, canonicalHost, isNonPublicHost, InMemoryDeployApprovalLedger, type DeployApprovalLedger,
  type HealthProbe, type HealthReport,
} from "../../apps/control-api/src/cloud/deployment.js";

const S1 = "staging-fixture-key-a-".repeat(2), S2 = "staging-fixture-key-b-".repeat(2);
const P1 = "production-fixture-key-a-".repeat(2), P2 = "production-fixture-key-b-".repeat(2);
const STG_ENV = {UASCO_CLOUD_ENDPOINT: "https://staging.example.invalid/api", UASCO_CLOUD_ENVIRONMENT: "staging"};
const PRD_ENV = {UASCO_CLOUD_ENDPOINT: "https://prod.example.invalid/api", UASCO_CLOUD_ENVIRONMENT: "production"};
const t0 = new Date("2026-11-03T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
// Production halkaları güvenilen saat ister: testlerde denetlenebilir sahte duvar saati (gerçek saat/ağ yok).
let wallMs = t0.getTime();
const wall = () => wallMs;
const prod = (keyId: string, secret: string) => SessionKeyRing.create("production", keyId, secret, {clock: wall});
const SHA = "a".repeat(64);
const probe = (name: string, ok: boolean | "throw" | "hang", critical = true): HealthProbe => ({name, critical, async check(signal) {
  if (ok === "throw") throw new Error("db password=hunter2-should-not-leak");
  if (ok === "hang") return new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  return {ok};
}});
const deps = () => (wallMs = t0.getTime(), {staging: {env: STG_ENV, keys: SessionKeyRing.create("staging", "stg-k1", S1)}, production: {env: PRD_ENV, keys: prod("prd-k1", P1)}});
const healthy: HealthReport = {environment: "staging", state: "HEALTHY", checkedAt: t0.toISOString(), artifactSha256: SHA, probes: [{name: "api", ok: true, critical: true}]};
const evidence = (over: Record<string, unknown> = {}) => ({artifactSha256: SHA, stagingHealth: healthy, smokePassed: true, smokeAt: t0.toISOString(), ...over});
const founder = (ring: SessionKeyRing, roles: ("FOUNDER" | "OPERATOR" | "VIEWER")[] = ["FOUNDER"], now = t0, tenantId = "platform-001", subject = "founder-01") => {
  const k = ring.signingKey(); return issueSession({subject, tenantId, roles}, 3_600_000, k.keyId, k.secret, now);
};
const sidOf = (token: string) => (JSON.parse(Buffer.from(token.split(".")[2]!, "base64url").toString("utf8")) as {sid: string}).sid;
const policy = {platformTenantId: "platform-001"};

export function registerCloudDeployCases(): void {
  describe("CLOUD-T0012 session key rotation", () => {
    it("rotation keeps old sessions valid through the overlap, then they fail closed", () => {
      const ring = SessionKeyRing.create("staging", "stg-k1", S1);
      const old = founder(ring);
      const r = ring.rotate("stg-k2", S2, t0);
      expect(r).toEqual({ok: true, retiredKeyId: "stg-k1", verifyUntil: at(MAX_SESSION_TTL_MS).toISOString()});
      expect(ring.signingKey().keyId).toBe("stg-k2");
      expect(ring.verify(old, at(1000)).ok).toBe(true);                       // overlap: old key still verifies
      expect(ring.verify(founder(ring, ["FOUNDER"], at(1000)), at(2000)).ok).toBe(true);
      expect([...ring.verificationKeys(at(MAX_SESSION_TTL_MS)).keys()]).toEqual(["stg-k2"]);   // boundary: old key gone
      expect(ring.verify(old, at(MAX_SESSION_TTL_MS - 1)).ok).toBe(false);    // token itself expired (1h)
      expect(ring.describe(at(1))).toEqual([{keyId: "stg-k1", state: "VERIFY_ONLY", verifyUntil: at(MAX_SESSION_TTL_MS).toISOString()}, {keyId: "stg-k2", state: "ACTIVE"}]);
    });
    it("refuses key-id reuse, secret reuse, short secrets, bad ids and bad overlap", () => {
      const ring = SessionKeyRing.create("staging", "stg-k1", S1);
      expect(ring.rotate("stg-k1", S2, t0)).toEqual({ok: false, reason: "KEY_ID_REUSED"});
      expect(ring.rotate("stg-k2", S1, t0)).toEqual({ok: false, reason: "KEY_REUSED"});
      expect(ring.rotate("stg-k2", "short", t0)).toEqual({ok: false, reason: "KEY_TOO_SHORT"});
      expect(ring.rotate("x", S2, t0)).toEqual({ok: false, reason: "KEY_ID_INVALID"});
      expect(ring.rotate("stg-k2", S2, t0, 1000)).toEqual({ok: false, reason: "OVERLAP_INVALID"});
      expect(ring.rotate("stg-k2", S2, t0, 3 * MAX_SESSION_TTL_MS)).toEqual({ok: false, reason: "OVERLAP_INVALID"});
      expect(ring.signingKey().keyId).toBe("stg-k1");                          // failed rotations change nothing
      expect(ring.rotate("stg-k2", S2, t0).ok).toBe(true);
      expect(ring.rotate("stg-k3", S1, t0)).toEqual({ok: false, reason: "KEY_REUSED"});   // rollback to an old secret refused
      expect(() => SessionKeyRing.create("staging", "stg-k1", "short")).toThrow("KEY_TOO_SHORT");
    });
    it("emergency revoke drops a verify-only key immediately; the active key cannot be revoked", () => {
      const ring = SessionKeyRing.create("staging", "stg-k1", S1);
      const old = founder(ring); ring.rotate("stg-k2", S2, t0);
      expect(ring.revoke("stg-k2")).toBe(false);
      expect(ring.revoke("stg-k1")).toBe(true);
      expect(ring.verify(old, at(1000))).toEqual({ok: false, reason: "SESSION_INVALID"});
    });
    it("secretsEqual is digest based and exact", () => {
      expect(secretsEqual(S1, S1)).toBe(true); expect(secretsEqual(S1, S2)).toBe(false); expect(secretsEqual(S1, Buffer.from(S1))).toBe(true);
    });
    it("Buffer secrets are copied on admit: later mutation by the caller does not change the ring (LOW-6)", () => {
      const buf = Buffer.from(S1); const ring = SessionKeyRing.create("staging", "stg-k1", buf);
      const tok = founder(ring); buf.fill(0);
      expect(ring.verify(tok, at(1000)).ok).toBe(true);
      expect(ring.rotate("stg-k2", S1, t0)).toEqual({ok: false, reason: "KEY_REUSED"});
    });
    it("describe() never exposes secret material", () => {
      const ring = prod("prd-k1", P1); ring.rotate("prd-k2", P2, t0);
      expect(JSON.stringify(ring.describe(t0))).not.toMatch(/production-fixture/);
    });
  });

  describe("CLOUD-T0012 staging/production separation", () => {
    it("accepts fully separated environments", () => {
      const d = deps(); const r = checkEnvironmentSeparation(d.staging, d.production);
      expect(r.ok).toBe(true);
    });
    it("fails closed on missing config, mislabel, shared host, shared key id, shared secret, wrong ring", () => {
      const d = deps();
      expect(checkEnvironmentSeparation({...d.staging, env: {}}, d.production)).toEqual({ok: false, reason: "STAGING_NOT_CONFIGURED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, env: {}})).toEqual({ok: false, reason: "PRODUCTION_NOT_CONFIGURED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, env: {UASCO_CLOUD_ENDPOINT: PRD_ENV.UASCO_CLOUD_ENDPOINT}})).toEqual({ok: false, reason: "ENVIRONMENT_MISLABELLED"});
      expect(checkEnvironmentSeparation({...d.staging, env: PRD_ENV}, d.production)).toEqual({ok: false, reason: "ENVIRONMENT_MISLABELLED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, env: {...PRD_ENV, UASCO_CLOUD_ENDPOINT: "https://STAGING.example.invalid./other"}})).toEqual({ok: false, reason: "ENDPOINT_SHARED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: prod("stg-k1", P1)})).toEqual({ok: false, reason: "KEY_ID_SHARED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: prod("prd-k1", S1)})).toEqual({ok: false, reason: "SECRET_SHARED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: SessionKeyRing.create("staging", "prd-k1", P1)})).toEqual({ok: false, reason: "KEYRING_ENVIRONMENT_MISMATCH"});
    });
    it("a staging secret that was rotated out still counts as shared (history is checked)", () => {
      const d = deps(); const p = prod("prd-k1", P1); p.rotate("prd-k2", S1.toUpperCase() + "x", t0);
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: p}).ok).toBe(true);
      const p2 = prod("prd-k1", S1); p2.rotate("prd-k2", P2, t0);
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: p2})).toEqual({ok: false, reason: "SECRET_SHARED"});
    });
  });

  describe("CLOUD-T0012 health", () => {
    const keys = () => SessionKeyRing.create("staging", "stg-k1", S1);
    it("no runtime config -> UNHEALTHY; no probes -> UNKNOWN (never healthy by default)", async () => {
      expect((await evaluateHealth({env: {}, keys: keys(), probes: [probe("api", true)], now: t0})).state).toBe("UNHEALTHY");
      expect((await evaluateHealth({env: STG_ENV, keys: keys(), probes: [], now: t0})).state).toBe("UNKNOWN");
      expect((await evaluateHealth({env: STG_ENV, keys: prod("prd-k1", P1), probes: [probe("api", true)], now: t0})).state).toBe("UNHEALTHY");
    });
    it("aggregates critical/non-critical probes; errors and timeouts are failures with redacted detail", async () => {
      expect((await evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", true), probe("db", true)], now: t0})).state).toBe("HEALTHY");
      expect((await evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", true), probe("metrics", false, false)], now: t0})).state).toBe("DEGRADED");
      const r = await evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", true), probe("db", "throw")], now: t0});
      expect(r.state).toBe("UNHEALTHY"); expect(JSON.stringify(r)).not.toMatch(/hunter2/);
      const h = await evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", "hang")], now: t0, timeoutMs: 20, redact: s => s});
      expect(h.state).toBe("UNHEALTHY"); expect(h.probes[0]!.detail).toBe("HEALTH_PROBE_TIMEOUT");
      expect(h.environment).toBe("staging");
    });
    it("a probe returning a non-boolean ok is a failure", async () => {
      const weird: HealthProbe = {name: "api", critical: true, check: async () => ({ok: "yes" as unknown as boolean})};
      expect((await evaluateHealth({env: STG_ENV, keys: keys(), probes: [weird], now: t0})).state).toBe("UNHEALTHY");
    });
    it("carries the artifact sha in the report; a throwing redactor still yields a report (NB-4, NB-5)", async () => {
      const r = await evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", true), probe("db", "throw")], now: t0, artifactSha256: SHA,
        redact: () => { throw new Error("unbound redactor"); }});
      expect(r.artifactSha256).toBe(SHA); expect(r.state).toBe("UNHEALTHY"); expect(r.probes[1]!.detail).toBe("[REDACTED]");
      expect((await evaluateHealth({env: {}, keys: keys(), probes: [], now: t0, artifactSha256: SHA})).artifactSha256).toBe(SHA);
      await expect(evaluateHealth({env: STG_ENV, keys: keys(), probes: [], now: t0, artifactSha256: "bad"})).rejects.toThrow("HEALTH_ARTIFACT_INVALID");
    });
    it("rejects an out-of-range probe timeout", async () => {
      await expect(evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", true)], now: t0, timeoutMs: 1})).rejects.toThrow("HEALTH_TIMEOUT_INVALID");
    });
  });

  describe("CLOUD-T0012 promotion gate (production only via authorised deploy)", () => {
    const setup = () => {
      const d = deps(); const tok = founder(d.production.keys);
      const approval = issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(500));
      return {d, tok, approval, base: {...d, artifactSha256: SHA, evidence: evidence(), deployToken: tok, deployApproval: approval, policy, now: at(1000)}};
    };
    type P = Parameters<typeof evaluatePromotion>[0];
    /** Her çağrı kendi tüketim kaydıyla (over ile paylaşılan kayıt verilebilir); duvar saati `now`a eşitlenir, sonra geri alınır. */
    const evalP = (base: Omit<P, "approvals">, over: Record<string, unknown> = {}) => {
      const m = {approvals: new InMemoryDeployApprovalLedger(), ...base, ...over} as P;
      const prev = wallMs; wallMs = m.now instanceof Date ? m.now.getTime() : prev;
      try { return evaluatePromotion(m); } finally { wallMs = prev; }
    };
    const run = (base: Omit<P, "approvals">, over: Record<string, unknown> = {}) => { const x = evalP(base, over); return x.ok ? "OK" : x.reason; };
    it("allows promotion with matching healthy staging evidence, a platform FOUNDER session and an artifact-bound approval", () => {
      const {base} = setup();
      expect(evalP(base)).toEqual({ok: true, approvedBy: "founder-01", artifactSha256: SHA});
      expect(run(base, {policy: {platformTenantId: "platform-001", founderSubjects: new Set(["founder-01"])}})).toBe("OK");
    });
    it("denies every missing precondition (fail-closed)", () => {
      const {d, base} = setup(); const r = (over: Record<string, unknown>) => run(base, over);
      expect(r({artifactSha256: "nope"})).toBe("ARTIFACT_INVALID");
      expect(r({evidence: evidence({artifactSha256: "b".repeat(64)})})).toBe("STAGING_EVIDENCE_MISMATCH");
      expect(r({evidence: evidence({stagingHealth: {...healthy, state: "DEGRADED"}})})).toBe("STAGING_UNHEALTHY");
      expect(r({evidence: evidence({stagingHealth: {...healthy, environment: "production"}})})).toBe("STAGING_UNHEALTHY");
      expect(r({evidence: evidence({stagingHealth: {...healthy, artifactSha256: "b".repeat(64)}})})).toBe("STAGING_UNHEALTHY");   // health for another artifact
      expect(r({evidence: evidence({stagingHealth: {...healthy, artifactSha256: undefined}})})).toBe("STAGING_UNHEALTHY");
      expect(r({evidence: evidence({smokePassed: false})})).toBe("STAGING_SMOKE_FAILED");
      expect(r({now: at(MAX_STAGING_EVIDENCE_AGE_MS + 1)})).toBe("STAGING_EVIDENCE_STALE");
      expect(r({evidence: evidence({smokeAt: "garbage"})})).toBe("STAGING_EVIDENCE_STALE");
      expect(r({evidence: evidence({smokeAt: at(120_000).toISOString()})})).toBe("STAGING_EVIDENCE_STALE");
      expect(r({deployToken: founder(d.staging.keys)})).toBe("DEPLOY_SESSION_INVALID");     // staging session never deploys to production
      expect(r({deployToken: founder(d.production.keys, ["OPERATOR"])})).toBe("DEPLOY_NOT_FOUNDER");
      expect(r({deployToken: undefined})).toBe("DEPLOY_SESSION_INVALID");
      expect(r({now: at(3_600_000)})).toBe("DEPLOY_SESSION_EXPIRED");
      expect(r({production: {...d.production, keys: prod("prd-k9", S1)}})).toBe("SECRET_SHARED");
    });
    it("binds approval to the platform tenant and the founder allow-list (NB-2)", () => {
      const {d, base} = setup();
      const tenantFounder = founder(d.production.keys, ["FOUNDER"], t0, "tenant-001");
      expect(run(base, {deployToken: tenantFounder, deployApproval: issueDeployApproval(d.production.keys, sidOf(tenantFounder), SHA, at(500))})).toBe("DEPLOY_TENANT_DENIED");
      expect(run(base, {policy: {platformTenantId: "platform-001", founderSubjects: new Set(["founder-02"])}})).toBe("DEPLOY_SUBJECT_DENIED");
      expect(run(base, {policy: undefined})).toBe("DEPLOY_POLICY_INVALID");
      expect(run(base, {policy: {platformTenantId: ""}})).toBe("DEPLOY_POLICY_INVALID");
      expect(run(base, {policy: {platformTenantId: "platform-001", founderSubjects: new Set()}})).toBe("DEPLOY_POLICY_INVALID");
    });
    it("binds approval to the session and the artifact sha, short-lived, signed by production (NB-3)", () => {
      const {d, tok, approval, base} = setup();
      expect(run(base, {deployApproval: undefined})).toBe("DEPLOY_APPROVAL_INVALID");          // a stolen session alone is not deploy authority
      const otherSha = "c".repeat(64);
      expect(run(base, {deployApproval: issueDeployApproval(d.production.keys, sidOf(tok), otherSha, at(500))})).toBe("DEPLOY_APPROVAL_INVALID");
      const other = founder(d.production.keys);
      expect(run(base, {deployApproval: issueDeployApproval(d.production.keys, sidOf(other), SHA, at(500))})).toBe("DEPLOY_APPROVAL_INVALID");
      expect(run(base, {deployApproval: approval.replace(SHA, otherSha)})).toBe("DEPLOY_APPROVAL_INVALID");   // tampered sha
      expect(run(base, {deployApproval: approval.slice(0, -1) + (approval.endsWith("0") ? "1" : "0")})).toBe("DEPLOY_APPROVAL_INVALID");
      expect(run(base, {now: at(500 + MAX_DEPLOY_APPROVAL_TTL_MS)})).toBe("DEPLOY_APPROVAL_EXPIRED");
      const p = approval.split("."); const ei = p.length - 2; p[ei] = String(Number(p[ei]) + 3_600_000);   // da2 layout: exp is the field before the mac
      expect(run(base, {deployApproval: p.join(".")})).toBe("DEPLOY_APPROVAL_INVALID");          // extending expiry breaks the mac
      // //TR: #349 B-1: süre MAC kapsamında olmalı; kısa ömürlü bir onayın süresi 15 dk tavanının İÇİNDE uzatılsa bile reddedilir (TTL sınırı değil MAC yakalar).
      const short = issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(500), 60_000);
      expect(run(base, {deployApproval: short})).toBe("OK");
      const q = short.split("."); const qi = q.length - 2; q[qi] = String(Number(q[qi]) + 300_000);
      expect(run(base, {deployApproval: q.join(".")})).toBe("DEPLOY_APPROVAL_INVALID");
      wallMs = at(3_600_000).getTime();   // issuer whose trusted clock itself runs an hour ahead: the gate still refuses
      const ahead = issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(3_600_000)); wallMs = t0.getTime();
      expect(run(base, {deployApproval: ahead})).toBe("DEPLOY_APPROVAL_INVALID");
      expect(() => issueDeployApproval(d.staging.keys, sidOf(tok), SHA, t0)).toThrow("DEPLOY_APPROVAL_RING_NOT_PRODUCTION");
      expect(() => issueDeployApproval(d.production.keys, sidOf(tok), SHA, t0, MAX_DEPLOY_APPROVAL_TTL_MS + 1)).toThrow("DEPLOY_APPROVAL_TTL_INVALID");
      expect(() => issueDeployApproval(d.production.keys, sidOf(tok), "x", t0)).toThrow("DEPLOY_APPROVAL_FIELDS_INVALID");
    });
    it("a deploy token and approval signed before a production key rotation work during overlap, not after revoke", () => {
      const {d, base} = setup();
      d.production.keys.rotate("prd-k2", P2, at(600));
      expect(run(base)).toBe("OK");
      d.production.keys.revoke("prd-k1");
      expect(run(base)).toBe("DEPLOY_SESSION_INVALID");
    });
  });
  describe("CLOUD-T0012 review follow-up: host/IP separation (LOW-7) and trusted clock (LOW-8)", () => {
    const prd = (endpoint: string) => ({...deps().production, env: {...PRD_ENV, UASCO_CLOUD_ENDPOINT: endpoint}});
    it("IPv4-mapped IPv6 and dotted IPv4 of the same address count as one host", () => {
      expect(canonicalHost("[::ffff:cb00:7101]")).toBe("203.0.113.1");
      expect(canonicalHost("203.0.113.1.")).toBe("203.0.113.1");
      const stg = {...deps().staging, env: {...STG_ENV, UASCO_CLOUD_ENDPOINT: "https://8.8.4.4/api"}};
      expect(checkEnvironmentSeparation(stg, prd("https://[::ffff:808:404]/api"))).toEqual({ok: false, reason: "ENDPOINT_SHARED"});
      expect(checkEnvironmentSeparation(stg, prd("https://8.8.8.8/api")).ok).toBe(true);
    });
    it("production endpoint on private, link-local, CGNAT, metadata or internal names is refused", () => {
      for (const ep of ["https://10.1.2.3/", "https://172.16.0.1/", "https://172.31.255.255/", "https://192.168.1.1/", "https://169.254.169.254/",
        "https://100.64.0.1/", "https://0.0.0.1/", "https://224.0.0.1/", "https://[fd00::1]/", "https://[fe80::1]/", "https://[ff02::1]/", "https://[::ffff:a00:1]/",
        "https://[2001:db8::1]/", "https://metadata.google.internal/", "https://api.corp/", "https://printer.local/", "https://intranet-host/"]) {
        expect(isNonPublicHost(new URL(ep).hostname), ep).toBe(true);
        expect(checkEnvironmentSeparation(deps().staging, prd(ep)), ep).toEqual({ok: false, reason: "ENDPOINT_NON_PUBLIC"});
      }
      for (const ep of ["https://172.15.255.255/", "https://172.32.0.1/", "https://100.128.0.1/", "https://8.8.8.8/", "https://[2606:4700::1111]/", "https://prod.example.invalid/"])
        expect(isNonPublicHost(new URL(ep).hostname), ep).toBe(false);
    });
    it("staging may stay on a private address; only production is restricted", () => {
      const stg = {...deps().staging, env: {...STG_ENV, UASCO_CLOUD_ENDPOINT: "https://10.0.0.5/api"}};
      expect(checkEnvironmentSeparation(stg, deps().production).ok).toBe(true);
    });
    it("with a trusted clock, a skewed caller `now` cannot rotate or verify", () => {
      let wall = t0.getTime();
      const ring = SessionKeyRing.create("staging", "stg-k1", S1, {clock: () => wall});
      const tok = founder(ring);
      expect(ring.rotate("stg-k2", S2, at(MAX_CLOCK_SKEW_MS + 1))).toEqual({ok: false, reason: "CLOCK_SKEW"});
      expect(ring.rotate("stg-k2", S2, at(-MAX_CLOCK_SKEW_MS - 1))).toEqual({ok: false, reason: "CLOCK_SKEW"});
      expect(ring.signingKey().keyId).toBe("stg-k1");                          // failed rotation is a no-op
      expect(ring.verify(tok, at(MAX_CLOCK_SKEW_MS + 1)).ok).toBe(false);       // skewed verify: no keys
      expect(ring.verificationKeys(at(-MAX_CLOCK_SKEW_MS - 1)).size).toBe(0);
      expect(ring.verify(tok, at(MAX_CLOCK_SKEW_MS)).ok).toBe(true);            // boundary is inclusive
      expect(ring.rotate("stg-k2", S2, at(MAX_CLOCK_SKEW_MS))).toMatchObject({ok: true, retiredKeyId: "stg-k1"});
      wall = Number.NaN;
      expect(ring.verificationKeys(t0).size).toBe(0);                          // unreadable clock fails closed
      const throwing = SessionKeyRing.create("staging", "stg-k9", S1, {clock: () => { throw new Error("ntp down"); }});
      expect(throwing.rotate("stg-k10", S2, t0)).toEqual({ok: false, reason: "CLOCK_SKEW"});
      expect(() => SessionKeyRing.create("staging", "stg-k8", S1, {clock: 5 as unknown as () => number})).toThrow("CLOCK_INVALID");
    });
    it("rotation refuses a `now` earlier than the previous rotation (CLOCK_REGRESSED), even without a trusted clock", () => {
      const ring = SessionKeyRing.create("staging", "stg-k1", S1);
      expect(ring.rotate("stg-k2", S2, at(10_000)).ok).toBe(true);
      expect(ring.rotate("stg-k3", S1 + "-3", at(9_999))).toEqual({ok: false, reason: "CLOCK_REGRESSED"});
      expect(ring.signingKey().keyId).toBe("stg-k2");
      expect(ring.rotate("stg-k3", S1 + "-3", at(10_000)).ok).toBe(true);     // same instant is allowed
      expect(ring.rotate("stg-k4", S1 + "-4", new Date(Number.NaN))).toEqual({ok: false, reason: "CLOCK_SKEW"});
    });
  });
  describe("CLOUD-T0012 hardening: single-use approvals, mandatory production clock, issue-side skew", () => {
    const ready = () => {
      const d = deps(); const tok = founder(d.production.keys);
      const approval = issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(500));
      const base = {...d, artifactSha256: SHA, evidence: evidence(), deployToken: tok, deployApproval: approval, policy, now: at(1000)};
      const go = (approvals: unknown, over: Record<string, unknown> = {}) => {
        const r = evaluatePromotion({...base, approvals, ...over} as Parameters<typeof evaluatePromotion>[0]); return r.ok ? "OK" : r.reason;
      };
      return {d, tok, approval, go};
    };
    it("an approval is single-use: replay within its TTL is refused, a fresh approval works", () => {
      const {d, tok, go} = ready(); const ledger = new InMemoryDeployApprovalLedger();
      expect(go(ledger)).toBe("OK");
      expect(go(ledger)).toBe("DEPLOY_APPROVAL_REPLAYED");
      expect(go(ledger, {now: at(60_000)})).toBe("DEPLOY_APPROVAL_REPLAYED");             // still inside the 15-min TTL
      expect(go(ledger, {deployApproval: issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(700))})).toBe("OK");
    });
    it("a failed attempt does not consume the approval (consumed only on full success)", () => {
      const {go} = ready(); const ledger = new InMemoryDeployApprovalLedger();
      expect(go(ledger, {evidence: evidence({smokePassed: false})})).toBe("STAGING_SMOKE_FAILED");
      expect(go(ledger, {policy: {platformTenantId: "platform-001", founderSubjects: new Set(["founder-02"])}})).toBe("DEPLOY_SUBJECT_DENIED");
      expect(go(ledger)).toBe("OK");
    });
    it("two approvals issued at the same instant are distinct (nonce) and each is usable once", () => {
      const {d, tok, go} = ready(); const ledger = new InMemoryDeployApprovalLedger();
      const a1 = issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(500)), a2 = issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(500));
      expect(a1).not.toBe(a2);
      expect(go(ledger, {deployApproval: a1})).toBe("OK");
      expect(go(ledger, {deployApproval: a2})).toBe("OK");
      expect(go(ledger, {deployApproval: a1})).toBe("DEPLOY_APPROVAL_REPLAYED");
    });
    it("unknown ledger state fails closed", () => {
      const {go} = ready();
      expect(go(undefined)).toBe("DEPLOY_APPROVAL_LEDGER_UNAVAILABLE");
      expect(go({consume: () => { throw new Error("store down"); }})).toBe("DEPLOY_APPROVAL_LEDGER_UNAVAILABLE");
      expect(go({consume: () => "maybe"} as unknown as DeployApprovalLedger)).toBe("DEPLOY_APPROVAL_LEDGER_UNAVAILABLE");
      const full = new InMemoryDeployApprovalLedger(1); full.consume("other:1", at(60_000).getTime(), at(1000).getTime());
      expect(go(full)).toBe("DEPLOY_APPROVAL_LEDGER_UNAVAILABLE");                          // capacity reached: refuse, never evict live entries
      const later = new InMemoryDeployApprovalLedger(1); later.consume("other:1", at(900).getTime(), at(0).getTime());
      expect(go(later)).toBe("OK");                                                          // expired entries are pruned first
      expect(() => new InMemoryDeployApprovalLedger(0)).toThrow("LEDGER_CAPACITY_INVALID");
    });
    it("the old nonce-less da1 approval format is refused", () => {
      const {approval, go} = ready();
      const p = approval.split("."); p[0] = "da1"; p.splice(2, 1);
      expect(go(new InMemoryDeployApprovalLedger(), {deployApproval: p.join(".")})).toBe("DEPLOY_APPROVAL_INVALID");
      const q = approval.split("."); q[2] = "z".repeat(32);
      expect(go(new InMemoryDeployApprovalLedger(), {deployApproval: q.join(".")})).toBe("DEPLOY_APPROVAL_INVALID");   // malformed nonce
      const r = approval.split("."); r[0] = "da1";                                          // only the version tag changed
      expect(go(new InMemoryDeployApprovalLedger(), {deployApproval: r.join(".")})).toBe("DEPLOY_APPROVAL_INVALID");
    });
    it("a correctly signed approval with a non-hex nonce is still refused (format checked, not only the mac)", () => {
      const {tok, go} = ready();
      const nonce = "Z".repeat(32), exp = at(500 + 60_000).getTime(), sid = sidOf(tok);
      const mac = createHmac("sha256", P1).update(`da2.prd-k1.${nonce}.${sid}.${SHA}.${exp}`).digest("hex");
      expect(go(new InMemoryDeployApprovalLedger(), {deployApproval: `da2.prd-k1.${nonce}.${sid}.${SHA}.${exp}.${mac}`})).toBe("DEPLOY_APPROVAL_INVALID");
    });
    it("re-writing the nonce of a used approval does not mint a fresh one (nonce is under the mac)", () => {
      const {approval, go} = ready(); const ledger = new InMemoryDeployApprovalLedger();
      expect(go(ledger)).toBe("OK");
      const p = approval.split("."); p[2] = (p[2]!.startsWith("0") ? "1" : "0") + p[2]!.slice(1);
      expect(go(ledger, {deployApproval: p.join(".")})).toBe("DEPLOY_APPROVAL_INVALID");
    });
    it("a production key ring cannot be created without a trusted clock (no local-time fallback)", () => {
      expect(() => SessionKeyRing.create("production", "prd-k1", P1)).toThrow("PRODUCTION_CLOCK_REQUIRED");
      expect(() => SessionKeyRing.create("production", "prd-k1", P1, {})).toThrow("PRODUCTION_CLOCK_REQUIRED");
      expect(SessionKeyRing.create("staging", "stg-k1", S1).environment).toBe("staging");   // staging may still omit it
      expect(prod("prd-k1", P1).environment).toBe("production");
    });
    it("issuing an approval with a `now` skewed from the trusted clock is refused, in both directions", () => {
      const {d, tok} = ready();
      expect(() => issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(MAX_CLOCK_SKEW_MS + 1))).toThrow("DEPLOY_APPROVAL_CLOCK_SKEW");
      expect(() => issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(-MAX_CLOCK_SKEW_MS - 1))).toThrow("DEPLOY_APPROVAL_CLOCK_SKEW");
      expect(() => issueDeployApproval(d.production.keys, sidOf(tok), SHA, new Date(Number.NaN))).toThrow("DEPLOY_APPROVAL_CLOCK_SKEW");
      expect(issueDeployApproval(d.production.keys, sidOf(tok), SHA, at(MAX_CLOCK_SKEW_MS))).toMatch(/^da2\./);   // boundary inclusive
      wallMs = Number.NaN;
      expect(() => issueDeployApproval(d.production.keys, sidOf(tok), SHA, t0)).toThrow("DEPLOY_APPROVAL_CLOCK_SKEW");   // unreadable clock
      wallMs = t0.getTime();
    });
  });
}
