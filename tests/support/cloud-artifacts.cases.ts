// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0008 bulut artifact deposunun tenant izolasyonunu, put/get sha doğrulamasını, boyut ve ad sınırlarını, durağanda şifrelemeyi, değiştirilemez provenance'ı, secret reddini ve imzalı süreli teslim URL'inin fail-closed davranışını doğrular.
import {describe, it, expect, afterAll} from "vitest";
import {mkdtemp, rm, readdir, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
  CloudArtifactStore, FileSystemArtifactBackend, InMemoryArtifactBackend, MAX_DELIVERY_TTL_MS, isSafeArtifactName,
  type ArtifactAuditRecord, type ArtifactBlobBackend, type CloudArtifactStoreOptions,
} from "../../core/cloud/artifacts.js";
import {canonicalJson, sha256Hex} from "../../core/cloud/contracts.js";
import {createCipheriv, hkdfSync, randomBytes} from "node:crypto";

const MASTER = Buffer.from("artifact-master-fixture-key-".repeat(2));
const DKEY = "delivery-fixture-key-".repeat(3);
const KNOWN = "known-fixture-credential-0123456789";
const BASE = "https://cloud.example.invalid/api";
const A = {tenantId: "tenant-001", subject: "user-001"};
const B = {tenantId: "tenant-002", subject: "user-002"};

function mkStore(over: Partial<CloudArtifactStoreOptions> = {}) {
  let t = new Date("2026-11-03T12:00:00Z").getTime();
  const audit: ArtifactAuditRecord[] = [];
  const backend = (over.backend ?? new InMemoryArtifactBackend());
  const store = new CloudArtifactStore({backend, masterKey: MASTER, deliveryKeys: new Map([["dk-1", DKEY]]), activeDeliveryKeyId: "dk-1",
    deliveryBaseUrl: BASE, knownSecrets: [KNOWN], audit: r => audit.push(r), now: () => new Date(t), ...over});
  return {store, backend, audit, advance: (ms: number) => { t += ms; }};
}
const body = (s: string) => Buffer.from(s, "utf8");
const putIn = (tenantId: string, projectId: string, name: string, content: Buffer, extra: Record<string, unknown> = {}) =>
  ({tenantId, projectId, name, content, sha256: sha256Hex(content), sizeBytes: content.byteLength, ...extra});

export function registerCloudArtifactsCases(): void {
  describe("cloud artifacts: content addressing and integrity (CLOUD-T0008)", () => {
    it("stores two projects and downloads both via signed URLs with matching sha", async () => {
      const {store} = mkStore();
      const p1 = body("project one build output"), p2 = body("project two build output");
      expect((await store.put(putIn("tenant-001", "proj-001", "dist/app.zip", p1, {jobId: "job-0001", producer: "worker-01"}))).ok).toBe(true);
      expect((await store.put(putIn("tenant-001", "proj-002", "dist/app.zip", p2))).ok).toBe(true);
      for (const [proj, content] of [["proj-001", p1], ["proj-002", p2]] as const) {
        const d = await store.issueDeliveryUrl(A, {tenantId: "tenant-001", projectId: proj, name: "dist/app.zip"});
        expect(d.ok).toBe(true); if (!d.ok) return;
        expect(d.sha256).toBe(sha256Hex(content));
        const got = await store.redeemDeliveryUrl(d.url);
        expect(got.ok && got.content.equals(content)).toBe(true);
      }
    });
    it("records immutable provenance; same sha replays, different sha is denied", async () => {
      const {store} = mkStore();
      const c = body("v1");
      const first = await store.put(putIn("tenant-001", "proj-001", "out.bin", c, {jobId: "job-0001", producer: "worker-01"}));
      expect(first).toMatchObject({ok: true, replay: false, manifest: {jobId: "job-0001", producer: "worker-01", sha256: sha256Hex(c)}});
      expect(await store.put(putIn("tenant-001", "proj-001", "out.bin", c, {jobId: "job-0009"}))).toMatchObject({ok: true, replay: true, manifest: {jobId: "job-0001"}});
      expect(await store.put(putIn("tenant-001", "proj-001", "out.bin", body("v2")))).toMatchObject({ok: false, reason: "ARTIFACT_IMMUTABLE"});
    });
    it("verifies sha and size on put", async () => {
      const {store} = mkStore();
      const c = body("payload");
      expect(await store.put({...putIn("tenant-001", "proj-001", "a.txt", c), sha256: sha256Hex("other")})).toMatchObject({ok: false, reason: "HASH_MISMATCH"});
      expect(await store.put({...putIn("tenant-001", "proj-001", "a.txt", c), sha256: "ABC"})).toMatchObject({ok: false, reason: "HASH_MISMATCH"});
      expect(await store.put({...putIn("tenant-001", "proj-001", "a.txt", c), sizeBytes: 3})).toMatchObject({ok: false, reason: "SIZE_MISMATCH"});
      expect(await store.put({...putIn("tenant-001", "proj-001", "a.txt", c), content: "payload" as unknown as Buffer})).toMatchObject({ok: false, reason: "INVALID_CONTENT"});
    });
    it("enforces size limits (configured and hard ceiling)", async () => {
      const {store} = mkStore({maxArtifactBytes: 8});
      expect(await store.put(putIn("tenant-001", "proj-001", "big.bin", Buffer.alloc(9)))).toMatchObject({ok: false, reason: "TOO_LARGE"});
      expect((await store.put(putIn("tenant-001", "proj-001", "ok.bin", Buffer.alloc(8)))).ok).toBe(true);
      expect(() => mkStore({maxArtifactBytes: 3 * 1024 ** 3})).toThrow("ARTIFACT_MAX_BYTES_INVALID");
    });
    it("rejects unsafe names and ids", async () => {
      for (const n of ["../x", "/etc/passwd", "a//b", "a/./b", "a/", "a\\b", "", "x".repeat(256), "a b"]) expect(isSafeArtifactName(n)).toBe(false);
      expect(isSafeArtifactName("dist/app-1.0.zip")).toBe(true);
      const {store} = mkStore();
      expect(await store.put(putIn("tenant-001", "proj-001", "../escape", body("x")))).toMatchObject({ok: false, reason: "INVALID_NAME"});
      expect(await store.put(putIn("t/../x", "proj-001", "a", body("x")))).toMatchObject({ok: false, reason: "INVALID_ID"});
    });
    it("denies tampered ciphertext, tampered manifest and swapped blobs on get", async () => {
      const backend = new InMemoryArtifactBackend();
      const {store} = mkStore({backend});
      await store.put(putIn("tenant-001", "proj-001", "a.bin", body("aaaa")));
      await store.put(putIn("tenant-001", "proj-001", "b.bin", body("bbbb")));
      const loc = {tenantId: "tenant-001", projectId: "proj-001", name: "a.bin"};
      expect((await store.get(A, loc)).ok).toBe(true);
      const blobA = backend.keys().find(k => k.endsWith(sha256Hex("aaaa")))!;
      const blobB = backend.keys().find(k => k.endsWith(sha256Hex("bbbb")))!;
      // swap: put B's (validly encrypted) bytes under A's key -> AAD binds sha, so GCM fails
      const bBytes = (await backend.get(blobB))!;
      backend.tamper(blobA, () => bBytes);
      expect(await store.get(A, loc)).toMatchObject({ok: false, reason: "BLOB_TAMPERED"});
      backend.tamper(blobB, b => { b[b.length - 1] ^= 1; return b; });
      expect(await store.get(A, {...loc, name: "b.bin"})).toMatchObject({ok: false, reason: "BLOB_TAMPERED"});
      const mKey = backend.keys().find(k => k.includes("/manifest/") && k.endsWith(sha256Hex("a.bin")))!;
      backend.tamper(mKey, b => Buffer.from(b.toString("utf8").replace(sha256Hex("aaaa"), sha256Hex("bbbb"))));
      expect(await store.get(A, loc)).toMatchObject({ok: false, reason: "MANIFEST_TAMPERED"});
    });
    it("re-verifies sha on get even if a key-holding writer stores validly encrypted wrong content", async () => {
      const backend = new InMemoryArtifactBackend();
      const {store} = mkStore({backend});
      const real = body("real"), sha = sha256Hex(real);
      await store.put(putIn("tenant-001", "proj-001", "x.bin", real));
      const key = Buffer.from(hkdfSync("sha256", MASTER, "uasco.cloud.artifacts.v1", "enc:tenant-001", 32));
      const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(canonicalJson({v: "uasco.cloud.artifacts.v1", tenantId: "tenant-001", projectId: "proj-001", sha256: sha})));
      const ct = Buffer.concat([c.update(body("evil")), c.final()]);
      backend.tamper(`t/tenant-001/p/proj-001/blob/${sha}`, () => Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]));
      expect(await store.get(A, {tenantId: "tenant-001", projectId: "proj-001", name: "x.bin"})).toMatchObject({ok: false, reason: "HASH_MISMATCH"});
    });
    it("a forged sha claim in the delivery token is denied (tampered hash)", async () => {
      const {store} = mkStore();
      await store.put(putIn("tenant-001", "proj-001", "x.bin", body("real")));
      const r = await store.issueDeliveryUrl(A, {tenantId: "tenant-001", projectId: "proj-001", name: "x.bin"});
      expect(r.ok).toBe(true); if (!r.ok) return;
      const u = new URL(r.url); const [p, s] = u.searchParams.get("token")!.split(".");
      const claims = JSON.parse(Buffer.from(p!, "base64url").toString()); claims.s = sha256Hex("fake");
      u.searchParams.set("token", `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${s}`);
      expect(await store.redeemDeliveryUrl(u.href)).toMatchObject({ok: false, reason: "TOKEN_SIGNATURE_INVALID"});
    });
  });

  describe("cloud artifacts: tenant isolation and encryption at rest", () => {
    const dirs: string[] = [];
    afterAll(async () => { for (const d of dirs) await rm(d, {recursive: true, force: true}); });
    it("another tenant cannot read, issue for, or see the artifact; same content is stored per tenant", async () => {
      const {store, backend} = mkStore();
      const c = body("shared content");
      await store.put(putIn("tenant-001", "proj-001", "a.bin", c));
      const loc = {tenantId: "tenant-001", projectId: "proj-001", name: "a.bin"};
      expect(await store.get(B, loc)).toMatchObject({ok: false, reason: "TENANT_DENIED"});
      expect(await store.issueDeliveryUrl(B, loc)).toMatchObject({ok: false, reason: "TENANT_DENIED"});
      expect(await store.get(B, {...loc, tenantId: "tenant-002"})).toMatchObject({ok: false, reason: "NOT_FOUND"});
      await store.put(putIn("tenant-002", "proj-001", "a.bin", c));
      const blobs = (backend as InMemoryArtifactBackend).keys().filter(k => k.includes("/blob/"));
      expect(blobs.map(k => k.split("/")[1]).sort()).toEqual(["tenant-001", "tenant-002"]);
      const [b1, b2] = await Promise.all(blobs.map(k => backend.get(k)));
      expect(b1!.equals(b2!)).toBe(false);   // tenant-specific key + random IV
    });
    it("a manifest relocated to another tenant's key is denied", async () => {
      const backend = new InMemoryArtifactBackend();
      const {store} = mkStore({backend});
      await store.put(putIn("tenant-001", "proj-001", "a.bin", body("t1")));
      const m1 = backend.keys().find(k => k.startsWith("t/tenant-001/") && k.includes("/manifest/"))!;
      const evil: ArtifactBlobBackend = {name: "evil", putIfAbsent: (k, d) => backend.putIfAbsent(k, d),
        get: k => backend.get(k.startsWith("t/tenant-002/") ? k.replace("t/tenant-002/", "t/tenant-001/") : k)};
      const s2 = mkStore({backend: evil}).store;
      expect(await s2.get(B, {tenantId: "tenant-002", projectId: "proj-001", name: "a.bin"})).toMatchObject({ok: false, reason: "MANIFEST_TAMPERED"});
      expect(m1).toBeTruthy();
    });
    it("filesystem backend stores only ciphertext, is write-once and survives a restart", async () => {
      const dir = await mkdtemp(join(tmpdir(), "uasco-art-")); dirs.push(dir);
      const plain = "plaintext marker 0xC0FFEE";
      const s1 = mkStore({backend: new FileSystemArtifactBackend(dir)}).store;
      expect((await s1.put(putIn("tenant-001", "proj-001", "dist/a.txt", body(plain)))).ok).toBe(true);
      const files = (await readdir(dir, {recursive: true, withFileTypes: true})).filter(f => f.isFile());
      expect(files.some(f => f.name.endsWith(".tmp"))).toBe(false);
      for (const f of files) expect((await readFile(join(f.parentPath, f.name))).includes(Buffer.from(plain))).toBe(false);
      const s2 = mkStore({backend: new FileSystemArtifactBackend(dir)}).store;
      const got = await s2.get(A, {tenantId: "tenant-001", projectId: "proj-001", name: "dist/a.txt"});
      expect(got.ok && got.content.toString()).toBe(plain);
      const fsb = new FileSystemArtifactBackend(dir);
      expect(await fsb.putIfAbsent("t/x/blob", body("1"))).toBe(true);
      expect(await fsb.putIfAbsent("t/x/blob", body("2"))).toBe(false);
      expect((await fsb.get("t/x/blob"))!.toString()).toBe("1");
      await expect(fsb.get("t/../../etc/passwd")).rejects.toThrow("ARTIFACT_BACKEND_KEY_INVALID");
    });
    it("a different master key cannot decrypt (fail-closed)", async () => {
      const backend = new InMemoryArtifactBackend();
      await mkStore({backend}).store.put(putIn("tenant-001", "proj-001", "a.bin", body("x")));
      const other = mkStore({backend, masterKey: Buffer.from("other-master-fixture-key-".repeat(2))}).store;
      expect(await other.get(A, {tenantId: "tenant-001", projectId: "proj-001", name: "a.bin"})).toMatchObject({ok: false, reason: "MANIFEST_TAMPERED"});
    });
    it("rejects short keys", () => {
      expect(() => mkStore({masterKey: Buffer.alloc(8)})).toThrow("ARTIFACT_MASTER_KEY_TOO_SHORT");
      expect(() => mkStore({deliveryKeys: new Map([["dk-1", "short"]])})).toThrow("ARTIFACT_DELIVERY_KEY_INVALID");
    });
  });

  describe("cloud artifacts: signed delivery URL", () => {
    const loc = {tenantId: "tenant-001", projectId: "proj-001", name: "dist/app.zip"};
    async function issued(over: Partial<CloudArtifactStoreOptions> = {}, ttl?: number) {
      const s = mkStore(over);
      await s.store.put(putIn("tenant-001", "proj-001", "dist/app.zip", body("zipbytes")));
      const d = await s.store.issueDeliveryUrl(A, loc, ttl);
      if (!d.ok) throw new Error(d.reason);
      return {...s, url: d.url};
    }
    it("URL is https, bound to tenant/project/name/sha, and carries no key material", async () => {
      const {url} = await issued();
      const u = new URL(url);
      expect(u.protocol).toBe("https:");
      expect(u.pathname).toBe("/api/artifacts/tenant-001/proj-001/dist/app.zip");
      expect([...u.searchParams.keys()]).toEqual(["token"]);
      for (const secret of [DKEY, MASTER.toString(), KNOWN]) expect(url.includes(secret)).toBe(false);
      const claims = JSON.parse(Buffer.from(u.searchParams.get("token")!.split(".")[0]!, "base64url").toString());
      expect(claims).toMatchObject({t: "tenant-001", p: "proj-001", n: "dist/app.zip", s: sha256Hex("zipbytes"), kid: "dk-1"});
    });
    it("expires; TTL is bounded", async () => {
      const {store, url, advance} = await issued({}, 60_000);
      expect((await store.redeemDeliveryUrl(url)).ok).toBe(true);
      advance(60_000);
      expect(await store.redeemDeliveryUrl(url)).toMatchObject({ok: false, reason: "TOKEN_EXPIRED"});
      expect(await store.issueDeliveryUrl(A, loc, MAX_DELIVERY_TTL_MS + 1)).toMatchObject({ok: false, reason: "TTL_OUT_OF_RANGE"});
      expect(await store.issueDeliveryUrl(A, loc, 0)).toMatchObject({ok: false, reason: "TTL_OUT_OF_RANGE"});
    });
    it("path/tenant/project rebinding, signature edits and foreign origins are denied", async () => {
      const s = await issued();
      await s.store.put(putIn("tenant-001", "proj-001", "other.zip", body("other")));
      await s.store.put(putIn("tenant-002", "proj-001", "dist/app.zip", body("zipbytes")));
      const u = new URL(s.url);
      const re = (path: string) => { const x = new URL(u.href); x.pathname = path; return x.href; };
      expect(await s.store.redeemDeliveryUrl(re("/api/artifacts/tenant-001/proj-001/other.zip"))).toMatchObject({ok: false, reason: "TOKEN_SCOPE_MISMATCH"});
      expect(await s.store.redeemDeliveryUrl(re("/api/artifacts/tenant-002/proj-001/dist/app.zip"))).toMatchObject({ok: false, reason: "TOKEN_SCOPE_MISMATCH"});
      expect(await s.store.redeemDeliveryUrl(re("/api/artifacts/tenant-001/proj-002/dist/app.zip"))).toMatchObject({ok: false, reason: "TOKEN_SCOPE_MISMATCH"});
      const tok = u.searchParams.get("token")!;
      const flipped = tok.slice(0, -1) + (tok.endsWith("0") ? "1" : "0");
      const x = new URL(u.href); x.searchParams.set("token", flipped);
      expect(await s.store.redeemDeliveryUrl(x.href)).toMatchObject({ok: false, reason: "TOKEN_SIGNATURE_INVALID"});
      expect(await s.store.redeemDeliveryUrl(s.url.replace("cloud.example.invalid", "evil.example.invalid"))).toMatchObject({ok: false, reason: "TOKEN_SCOPE_MISMATCH"});
      expect(await s.store.redeemDeliveryUrl(s.url.replace("https:", "http:"))).toMatchObject({ok: false, reason: "TOKEN_SCOPE_MISMATCH"});
      expect(await s.store.redeemDeliveryUrl(`${s.url}&token=x`)).toMatchObject({ok: false, reason: "TOKEN_MALFORMED"});
      expect(await s.store.redeemDeliveryUrl("not a url")).toMatchObject({ok: false, reason: "TOKEN_MALFORMED"});
    });
    it("unknown/rotated-out key, revoked jti and an insecure base URL are denied", async () => {
      const s = await issued();
      const rotated = mkStore({backend: s.backend, deliveryKeys: new Map([["dk-2", DKEY]]), activeDeliveryKeyId: "dk-2"}).store;
      expect(await rotated.redeemDeliveryUrl(s.url)).toMatchObject({ok: false, reason: "TOKEN_KEY_UNKNOWN"});
      const otherSecret = mkStore({backend: s.backend, deliveryKeys: new Map([["dk-1", "another-delivery-key-".repeat(3)]])}).store;
      expect(await otherSecret.redeemDeliveryUrl(s.url)).toMatchObject({ok: false, reason: "TOKEN_SIGNATURE_INVALID"});
      const jti = JSON.parse(Buffer.from(new URL(s.url).searchParams.get("token")!.split(".")[0]!, "base64url").toString()).jti;
      const revoked = mkStore({backend: s.backend, revokedTokenIds: new Set([jti])}).store;
      expect(await revoked.redeemDeliveryUrl(s.url)).toMatchObject({ok: false, reason: "TOKEN_REVOKED"});
      const insecure = mkStore({backend: s.backend, deliveryBaseUrl: "http://cloud.example.invalid"}).store;
      expect(await insecure.issueDeliveryUrl(A, loc)).toMatchObject({ok: false, reason: "BASE_URL_INSECURE"});
      expect(await mkStore({backend: s.backend, deliveryKeys: new Map()}).store.issueDeliveryUrl(A, loc)).toMatchObject({ok: false, reason: "TOKEN_KEY_UNKNOWN"});
    });
    it("a tampered stored artifact is denied at redeem time even with a valid URL", async () => {
      const backend = new InMemoryArtifactBackend();
      const s = await issued({backend});
      const blob = backend.keys().find(k => k.includes("/blob/"))!;
      backend.tamper(blob, b => { b[30] ^= 0xff; return b; });
      expect(await s.store.redeemDeliveryUrl(s.url)).toMatchObject({ok: false, reason: "BLOB_TAMPERED"});
      expect(await s.store.issueDeliveryUrl(A, loc)).toMatchObject({ok: false, reason: "BLOB_TAMPERED"});
    });
  });

  describe("cloud artifacts: secret refusal and audit", () => {
    it("refuses artifacts containing secrets; audit names only the kind", async () => {
      const {store, audit} = mkStore();
      const leaked = body(`config: token=${KNOWN}\n`);
      expect(await store.put(putIn("tenant-001", "proj-001", "cfg.txt", leaked))).toMatchObject({ok: false, reason: "SECRET_DETECTED"});
      const pattern = body(`AWS=AKIA${"A".repeat(16)}\n`);
      expect(await store.put(putIn("tenant-001", "proj-001", "cfg2.txt", pattern))).toMatchObject({ok: false, reason: "SECRET_DETECTED"});
      expect(audit.filter(a => a.reason === "SECRET_DETECTED").every(a => (a.secretKinds?.length ?? 0) > 0)).toBe(true);
      expect(JSON.stringify(audit)).not.toContain(KNOWN);
    });
    it("audit records never include tokens, signatures, keys or content", async () => {
      const {store, audit} = mkStore();
      await store.put(putIn("tenant-001", "proj-001", "a.bin", body("secret-free content")));
      const d = await store.issueDeliveryUrl(A, {tenantId: "tenant-001", projectId: "proj-001", name: "a.bin"});
      if (!d.ok) throw new Error(d.reason);
      await store.redeemDeliveryUrl(d.url);
      await store.redeemDeliveryUrl(d.url + "0");
      await store.get(B, {tenantId: "tenant-001", projectId: "proj-001", name: "a.bin"});
      const text = JSON.stringify(audit);
      const token = new URL(d.url).searchParams.get("token")!;
      for (const s of [token, token.split(".")[1]!, DKEY, MASTER.toString(), "secret-free content"]) expect(text).not.toContain(s);
      expect(audit.map(a => `${a.action}:${a.decision}`)).toEqual(["PUT:ALLOWED", "ISSUE_DELIVERY:ALLOWED", "REDEEM_DELIVERY:ALLOWED", "REDEEM_DELIVERY:DENIED", "GET:DENIED"]);
    });
    it("backend failures are denials, not throws", async () => {
      const broken: ArtifactBlobBackend = {name: "broken", putIfAbsent: async () => { throw new Error("disk"); }, get: async () => { throw new Error("disk"); }};
      const {store} = mkStore({backend: broken});
      expect(await store.put(putIn("tenant-001", "proj-001", "a.bin", body("x")))).toMatchObject({ok: false, reason: "BACKEND_ERROR"});
      expect(await store.get(A, {tenantId: "tenant-001", projectId: "proj-001", name: "a.bin"})).toMatchObject({ok: false, reason: "BACKEND_ERROR"});
    });
  });
}
