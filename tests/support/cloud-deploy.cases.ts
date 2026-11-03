// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0012 staging/production ayrımını, örtüşen keyId ile oturum anahtarı rotasyonunu, sağlık durumunu ve yalnız yetkili production terfi kapısını ağsız, sahte secret'larla doğrular.
import {describe, it, expect} from "vitest";
import {issueSession, MAX_SESSION_TTL_MS} from "../../apps/control-api/src/cloud/remote-gateway.js";
import {
  SessionKeyRing, checkEnvironmentSeparation, evaluateHealth, evaluatePromotion, secretsEqual, MAX_STAGING_EVIDENCE_AGE_MS,
  type HealthProbe, type HealthReport,
} from "../../apps/control-api/src/cloud/deployment.js";

const S1 = "staging-fixture-key-a-".repeat(2), S2 = "staging-fixture-key-b-".repeat(2);
const P1 = "production-fixture-key-a-".repeat(2), P2 = "production-fixture-key-b-".repeat(2);
const STG_ENV = {UASCO_CLOUD_ENDPOINT: "https://staging.example.invalid/api", UASCO_CLOUD_ENVIRONMENT: "staging"};
const PRD_ENV = {UASCO_CLOUD_ENDPOINT: "https://prod.example.invalid/api", UASCO_CLOUD_ENVIRONMENT: "production"};
const t0 = new Date("2026-11-03T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const SHA = "a".repeat(64);
const probe = (name: string, ok: boolean | "throw" | "hang", critical = true): HealthProbe => ({name, critical, async check(signal) {
  if (ok === "throw") throw new Error("db password=hunter2-should-not-leak");
  if (ok === "hang") return new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  return {ok};
}});
const deps = () => ({staging: {env: STG_ENV, keys: SessionKeyRing.create("staging", "stg-k1", S1)}, production: {env: PRD_ENV, keys: SessionKeyRing.create("production", "prd-k1", P1)}});
const healthy: HealthReport = {environment: "staging", state: "HEALTHY", checkedAt: t0.toISOString(), probes: [{name: "api", ok: true, critical: true}]};
const evidence = (over: Record<string, unknown> = {}) => ({artifactSha256: SHA, stagingHealth: healthy, smokePassed: true, smokeAt: t0.toISOString(), ...over});
const founder = (ring: SessionKeyRing, roles: ("FOUNDER" | "OPERATOR" | "VIEWER")[] = ["FOUNDER"], now = t0) => {
  const k = ring.signingKey(); return issueSession({subject: "founder-01", tenantId: "tenant-001", roles}, 3_600_000, k.keyId, k.secret, now);
};

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
    it("describe() never exposes secret material", () => {
      const ring = SessionKeyRing.create("production", "prd-k1", P1); ring.rotate("prd-k2", P2, t0);
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
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: SessionKeyRing.create("production", "stg-k1", P1)})).toEqual({ok: false, reason: "KEY_ID_SHARED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: SessionKeyRing.create("production", "prd-k1", S1)})).toEqual({ok: false, reason: "SECRET_SHARED"});
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: SessionKeyRing.create("staging", "prd-k1", P1)})).toEqual({ok: false, reason: "KEYRING_ENVIRONMENT_MISMATCH"});
    });
    it("a staging secret that was rotated out still counts as shared (history is checked)", () => {
      const d = deps(); const p = SessionKeyRing.create("production", "prd-k1", P1); p.rotate("prd-k2", S1.toUpperCase() + "x", t0);
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: p}).ok).toBe(true);
      const p2 = SessionKeyRing.create("production", "prd-k1", S1); p2.rotate("prd-k2", P2, t0);
      expect(checkEnvironmentSeparation(d.staging, {...d.production, keys: p2})).toEqual({ok: false, reason: "SECRET_SHARED"});
    });
  });

  describe("CLOUD-T0012 health", () => {
    const keys = () => SessionKeyRing.create("staging", "stg-k1", S1);
    it("no runtime config -> UNHEALTHY; no probes -> UNKNOWN (never healthy by default)", async () => {
      expect((await evaluateHealth({env: {}, keys: keys(), probes: [probe("api", true)], now: t0})).state).toBe("UNHEALTHY");
      expect((await evaluateHealth({env: STG_ENV, keys: keys(), probes: [], now: t0})).state).toBe("UNKNOWN");
      expect((await evaluateHealth({env: STG_ENV, keys: SessionKeyRing.create("production", "prd-k1", P1), probes: [probe("api", true)], now: t0})).state).toBe("UNHEALTHY");
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
    it("rejects an out-of-range probe timeout", async () => {
      await expect(evaluateHealth({env: STG_ENV, keys: keys(), probes: [probe("api", true)], now: t0, timeoutMs: 1})).rejects.toThrow("HEALTH_TIMEOUT_INVALID");
    });
  });

  describe("CLOUD-T0012 promotion gate (production only via authorised deploy)", () => {
    it("allows promotion with matching healthy staging evidence and a production FOUNDER session", () => {
      const d = deps();
      expect(evaluatePromotion({...d, artifactSha256: SHA, evidence: evidence(), deployToken: founder(d.production.keys), now: at(1000)}))
        .toEqual({ok: true, approvedBy: "founder-01", artifactSha256: SHA});
    });
    it("denies every missing precondition (fail-closed)", () => {
      const d = deps(); const tok = founder(d.production.keys); const base = {...d, artifactSha256: SHA, evidence: evidence(), deployToken: tok, now: at(1000)};
      const r = (over: Record<string, unknown>) => { const x = evaluatePromotion({...base, ...over} as Parameters<typeof evaluatePromotion>[0]); return x.ok ? "OK" : x.reason; };
      expect(r({artifactSha256: "nope"})).toBe("ARTIFACT_INVALID");
      expect(r({evidence: evidence({artifactSha256: "b".repeat(64)})})).toBe("STAGING_EVIDENCE_MISMATCH");
      expect(r({evidence: evidence({stagingHealth: {...healthy, state: "DEGRADED"}})})).toBe("STAGING_UNHEALTHY");
      expect(r({evidence: evidence({stagingHealth: {...healthy, environment: "production"}})})).toBe("STAGING_UNHEALTHY");
      expect(r({evidence: evidence({smokePassed: false})})).toBe("STAGING_SMOKE_FAILED");
      expect(r({now: at(MAX_STAGING_EVIDENCE_AGE_MS + 1)})).toBe("STAGING_EVIDENCE_STALE");
      expect(r({evidence: evidence({smokeAt: "garbage"})})).toBe("STAGING_EVIDENCE_STALE");
      expect(r({evidence: evidence({smokeAt: at(120_000).toISOString()})})).toBe("STAGING_EVIDENCE_STALE");
      expect(r({deployToken: founder(d.staging.keys)})).toBe("DEPLOY_SESSION_INVALID");     // staging session never deploys to production
      expect(r({deployToken: founder(d.production.keys, ["OPERATOR"])})).toBe("DEPLOY_NOT_FOUNDER");
      expect(r({deployToken: undefined})).toBe("DEPLOY_SESSION_INVALID");
      expect(r({now: at(3_600_000)})).toBe("DEPLOY_SESSION_EXPIRED");
      expect(r({production: {...d.production, keys: SessionKeyRing.create("production", "prd-k9", S1)}})).toBe("SECRET_SHARED");
    });
    it("a deploy token signed before a production key rotation still works during overlap, not after revoke", () => {
      const d = deps(); const tok = founder(d.production.keys);
      d.production.keys.rotate("prd-k2", P2, at(500));
      expect(evaluatePromotion({...d, artifactSha256: SHA, evidence: evidence(), deployToken: tok, now: at(1000)}).ok).toBe(true);
      d.production.keys.revoke("prd-k1");
      expect(evaluatePromotion({...d, artifactSha256: SHA, evidence: evidence(), deployToken: tok, now: at(1000)})).toEqual({ok: false, reason: "DEPLOY_SESSION_INVALID"});
    });
  });
}
