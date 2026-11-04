// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0005 gerçek bulut iş durumunu doğrular: CloudJobQueue.list() redaksiyon güvenli ve tenant'a bağlı, GET /v1/cloud/jobs gerçek buildServer belirteç kancasından geçer, masaüstü paneli gerçek route verisini ya da dürüst NOT_CONFIGURED/UNAVAILABLE/ERROR gösterir (asla örnek veri yok).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {CloudJobQueue, signWorkerAuth, redactJobMessage, JOB_MESSAGE_MAX, type WorkerAuth} from "../../apps/control-api/src/cloud/jobs.js";
import {registerCloudJobRoutes, CLOUD_JOBS_PATH, CLOUD_JOB_ID_RE} from "../../apps/control-api/src/routes/cloud-jobs.js";
import {buildServer} from "../../apps/control-api/src/server.js";
import {CLOUD_CONTRACT_VERSION, signScope, sha256Hex, type CloudJobRequest, type UnsignedScope} from "../../core/cloud/contracts.js";
import {controlChallengeProof, desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32);
const SCOPE_KEY = "scope-status-key-".repeat(3), WORKER_KEY = "worker-status-key-".repeat(3);
const clock = new Date("2026-11-03T12:00:00Z");
const TENANT = "tenant-001", OTHER = "tenant-002";
const scopeFor = (tenantId: string): UnsignedScope => ({tenantId, projectId: "proj-001", environment: "staging", jobKinds: ["BUILD", "TEST"], allowNetwork: false, maxCostUsd: 5,
  issuedAt: "2026-11-03T11:00:00Z", expiresAt: "2026-11-03T19:00:00Z", keyId: "k-1"});
let n = 0;
const req = (tenantId = TENANT, over: Partial<CloudJobRequest> = {}): CloudJobRequest => {
  n++;
  return {contractVersion: CLOUD_CONTRACT_VERSION, jobId: `job-st-${String(n).padStart(4, "0")}`, tenantId, projectId: "proj-001", environment: "staging", kind: "BUILD",
    idempotencyKey: `idem-st-${String(n).padStart(4, "0")}`, timeoutMs: 3_600_000, retry: {maxAttempts: 1, backoffMs: 1000}, needsNetwork: false, estimatedCostUsd: 1,
    inputArtifacts: [], scope: signScope(scopeFor(tenantId), SCOPE_KEY), requestedAt: "2026-11-03T11:59:00Z", ...over};
};
const auth = (action: WorkerAuth["action"], jobId: string, body: unknown = {}): WorkerAuth =>
  signWorkerAuth({workerId: "worker-a", action, jobId, at: clock.toISOString(), nonce: crypto.randomUUID()}, WORKER_KEY, body);
const ART = {name: "out/app.zip", sha256: sha256Hex("bytes"), sizeBytes: 5};
/** ALLOWED: JobSummary'nin kapalı alan listesi. Lease/worker/imza/idempotency alanı eklenirse test kırmızı olur. */
const ALLOWED = ["artifacts", "attempt", "environment", "jobId", "kind", "lastEventType", "maxAttempts", "message", "projectId", "requestedAt", "status", "updatedAt"];

let dir = "";
const open: CloudJobQueue[] = [];
const apps: any[] = [];
function seeded() {
  const q = new CloudJobQueue({dir, scopeKeys: new Map([["k-1", SCOPE_KEY]]), workerKeys: new Map([["worker-a", WORKER_KEY]]), now: () => clock, leaseMs: 60_000});
  open.push(q);
  const a = req(), b = req(), c = req(), x = req(OTHER);
  for (const j of [a, b, c, x]) expect(q.submit(j)).toMatchObject({ok: true});
  // a: SUCCEEDED + artifact; b: FAILED with reason; c: RUNNING (lease); x: other tenant
  const ca = q.claim(auth("claim", "*")); if (!ca.ok || ca.job.jobId !== a.jobId) throw new Error("claim a");
  const resA = {status: "SUCCEEDED" as const, artifacts: [ART]};
  expect(q.complete(auth("complete", a.jobId, {leaseId: ca.lease.leaseId, result: resA}), a.jobId, ca.lease.leaseId, resA)).toMatchObject({ok: true});
  const cb = q.claim(auth("claim", "*")); if (!cb.ok || cb.job.jobId !== b.jobId) throw new Error("claim b");
  const resB = {status: "FAILED" as const, message: "compile error in step 2"};
  expect(q.complete(auth("complete", b.jobId, {leaseId: cb.lease.leaseId, result: resB}), b.jobId, cb.lease.leaseId, resB)).toMatchObject({ok: true});
  const cc = q.claim(auth("claim", "*")); if (!cc.ok || cc.job.jobId !== c.jobId) throw new Error("claim c");
  return {q, a, b, c, x, lease: cc.lease.leaseId};
}
type QueueLike = Pick<CloudJobQueue, "list" | "summary" | "isStopped">;
/** Kurucu PR'ından önce server.ts route'u kaydetmez: test modülü kaydeder. Sonra server.ts `registerCloudJobRoutes(app,{queue:()=>opts.cloudJobQueue??null,scope})`
 *  ile kaydeder; test aynı kuyruğu buildServer seçeneğiyle verir. İki durumda da aynı gerçek belirteç kancası ve aynı route kodu sınanır. */
function mkServer(queue: QueueLike | null, tenantId = TENANT) {
  const runtime = path.join(dir, "runtime"); fs.mkdirSync(runtime, {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir: path.join(dir, "data"), tenantId, port: 3210, logger: false, cloudJobQueue: queue} as any);
  if (!app.hasRoute({method: "GET", url: CLOUD_JOBS_PATH})) registerCloudJobRoutes(app, {queue: () => queue as CloudJobQueue | null, scope: {tenantId}});
  apps.push(app); return app;
}
const throwingQueue = (): QueueLike => ({list: () => { throw new Error("disk gone /home/x/secret"); }, summary: () => { throw new Error("boom"); }, isStopped: false});
const get = (app: any, url: string, token: string | null = TOKEN) => app.inject({method: "GET", url, headers: {...(token ? {"x-uasco-control-token": token} : {}), host: "127.0.0.1:3210"}});

// ---------- renderer köprüsü: main.mjs uasco:api-get + verifyServerIdentity + api() sözleşmesi ----------
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const allowBlock = (() => { const m = /\/\/ B4-ALLOWLIST-BEGIN\n([\s\S]*?)\/\/ B4-ALLOWLIST-END/.exec(MAIN_SRC); if (!m) throw new Error("B4-ALLOWLIST block"); return m[1]; })();
const extraGet = new Function(`${allowBlock}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const mainAllows = (p: string) => desktopGetPathAllowed(p) || extraGet(p);
/** Kurucu kapılı main.mjs B4-ALLOWLIST'e önerilen giriş (rapordaki satırla birebir). Mutlu yol bu öneriyle sınanır; gerçek main.mjs bugün reddeder (ayrı test). */
const PROPOSED_GET = [/^\/v1\/cloud\/jobs$/, /^\/v1\/cloud\/jobs\/[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/];
const proposedAllows = (p: string) => mainAllows(p) || PROPOSED_GET.some(re => re.test(p));

class N {
  tagName: string; children: N[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<() => unknown>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string>) { for (const c of n) this.children.push(typeof c === "string" ? this.doc.createTextNode(c) : c); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  addEventListener(ev: string, fn: () => unknown) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class D {
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const x = new N(this, "#text"); x._text = s; return x; }
}

async function renderPanel(app: any, allow: (p: string) => boolean) {
  const apiMod = await load("api.js"), st = await load("state.js"), view = await load("views", "cloud-connection.js");
  const seen: Array<{path: string; status: number | null; error?: string}> = [];
  const verify = async () => {
    const challenge = crypto.randomBytes(32).toString("hex"), expected = controlChallengeProof(TOKEN, challenge);
    const r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    const h = r.json();
    if (r.statusCode !== 200 || h.status !== "HEALTHY" || h.bindHost !== "127.0.0.1" || Number(h.port) !== 3210 || String(h.controlProof ?? "") !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const bridge = {apiGet: async (p: string) => {
    try {
      if (!allow(p)) throw new Error("INVALID_API_PATH");
      await verify();
      const r = await get(app, p);
      seen.push({path: p, status: r.statusCode});
      if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    } catch (e) { if (!seen.some(s => s.path === p)) seen.push({path: p, status: null, error: (e as Error).message}); throw e; }
  }};
  const api = apiMod.createApi({bridge, store: st.createStore(null)});
  const loaded = await view.loadCloudJobs(api);
  const root: N = view.cloudJobsPanel({doc: new D(), t: (k: string) => k}, loaded);
  return {loaded, root, seen, state: root.dataset.cloudJobsState, cards: root.all().filter(x => x.dataset.cloudJob !== undefined)};
}

export function registerCloudJobsStatusCases(): void {
  describe("CLOUD-T0005 real cloud job status (CloudJobQueue.list + GET /v1/cloud/jobs + desktop panel)", () => {
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-cloud-status-")); });
    afterEach(async () => { for (const a of apps.splice(0)) await a.close(); while (open.length) open.pop()!.close(); fs.rmSync(dir, {recursive: true, force: true}); });

    it("list() is tenant-scoped, newest first, and exposes only the closed field set (no lease, worker, scope, signature or idempotency data)", () => {
      const {q, a, b, c, x, lease} = seeded();
      const rows = q.list(TENANT);
      expect(rows.map(r => r.jobId)).toEqual([c.jobId, b.jobId, a.jobId]);
      expect(rows.some(r => r.jobId === x.jobId)).toBe(false);
      expect(q.list(OTHER).map(r => r.jobId)).toEqual([x.jobId]);
      for (const r of rows) expect(Object.keys(r).sort()).toEqual(ALLOWED);
      expect(rows.find(r => r.jobId === a.jobId)).toMatchObject({status: "SUCCEEDED", artifacts: [ART], message: null});
      expect(rows.find(r => r.jobId === b.jobId)).toMatchObject({status: "FAILED", message: "compile error in step 2"});
      expect(rows.find(r => r.jobId === c.jobId)).toMatchObject({status: "RUNNING", lastEventType: "STARTED", message: null});
      const blob = JSON.stringify(rows);
      for (const bad of [lease, "worker-a", "leaseId", "workerId", "expiresAt", "signature", "idempotencyKey", "idem-st-", "[stored-verified]", "scope", SCOPE_KEY, WORKER_KEY, "tenantId"]) expect(blob, bad).not.toContain(bad);
      expect(q.list(TENANT, 2)).toHaveLength(2);
      expect(q.list("")).toEqual([]);
      expect(q.summary(OTHER, a.jobId)).toBeNull();
      expect(q.summary(TENANT, a.jobId)?.jobId).toBe(a.jobId);
    });

    it("GET /v1/cloud/jobs goes through the real buildServer token hook, is tenant-scoped, read-only, and fails closed", async () => {
      const {q, a, x} = seeded();
      const app = mkServer(q);
      expect((await get(app, CLOUD_JOBS_PATH, null)).statusCode).toBe(403);
      expect((await get(app, CLOUD_JOBS_PATH, "w".repeat(32))).statusCode).toBe(403);
      const ok = await get(app, CLOUD_JOBS_PATH);
      expect(ok.statusCode).toBe(200);
      const body = ok.json();
      expect(body).toMatchObject({state: "OK", stopped: false});
      expect(body.jobs.map((j: any) => j.jobId)).not.toContain(x.jobId);
      expect(body.jobs).toHaveLength(3);
      expect((await get(app, `${CLOUD_JOBS_PATH}/${a.jobId}`)).json()).toMatchObject({job: {jobId: a.jobId, status: "SUCCEEDED"}});
      // cross-tenant: başka tenant'ın işi bulunmamış gibi 404 (varlık sızmaz)
      const cross = await get(app, `${CLOUD_JOBS_PATH}/${x.jobId}`);
      expect([cross.statusCode, cross.json()]).toEqual([404, {error: "JOB_NOT_FOUND"}]);
      expect((await get(app, `${CLOUD_JOBS_PATH}/job-nope-0000`)).statusCode).toBe(404);
      for (const bad of ["-abc", "a", "a b c", "job%2Fx"]) expect((await get(app, `${CLOUD_JOBS_PATH}/${encodeURIComponent(bad)}`)).statusCode, bad).toBe(400);
      // Fastify maxParamLength (varsayılan 100) uzun parametreyi route öncesi 414 ile reddeder; her iki durumda da veri dönmez
      expect([400, 414]).toContain((await get(app, `${CLOUD_JOBS_PATH}/${"x".repeat(129)}`)).statusCode);
      expect((await get(app, `${CLOUD_JOBS_PATH}/..`)).statusCode).toBe(404);   // yönlendirici çözer; hiçbir iş verisi dönmez
      for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
        const r = await app.inject({method, url: CLOUD_JOBS_PATH, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, payload: {}});
        expect(r.statusCode, method).toBe(404);
      }
      // aynı kuyruk, diğer tenant'ın sunucusu yalnız kendi işini görür
      const otherApp = mkServer(q, OTHER);
      expect((await get(otherApp, CLOUD_JOBS_PATH)).json().jobs.map((j: any) => j.jobId)).toEqual([x.jobId]);
    });

    it("no queue -> honest NOT_CONFIGURED (list) and 503 (item); a throwing queue -> 500 CLOUD_JOBS_UNAVAILABLE", async () => {
      const none = mkServer(null);
      expect((await get(none, CLOUD_JOBS_PATH)).json()).toEqual({state: "NOT_CONFIGURED", jobs: []});
      const item = await get(none, `${CLOUD_JOBS_PATH}/job-st-0001`);
      expect([item.statusCode, item.json()]).toEqual([503, {error: "CLOUD_RUNTIME_NOT_CONFIGURED"}]);
      const boom = mkServer(throwingQueue());
      const r = await get(boom, CLOUD_JOBS_PATH);
      expect([r.statusCode, r.json()]).toEqual([500, {error: "CLOUD_JOBS_UNAVAILABLE"}]);
    });

    it("desktop panel renders the REAL route data through a bridge mirroring main.mjs (proposed allow-list entry)", async () => {
      const {q, a, b, c} = seeded();
      const app = mkServer(q);
      const r = await renderPanel(app, proposedAllows);
      expect(r.seen).toEqual([{path: CLOUD_JOBS_PATH, status: 200}]);
      expect(r.state).toBe("OK");
      expect(r.cards.map(x => [x.dataset.cloudJob, x.dataset.cloudJobStatus])).toEqual([[c.jobId, "RUNNING"], [b.jobId, "FAILED"], [a.jobId, "SUCCEEDED"]]);
      expect(r.root.textContent).toContain("compile error in step 2");
      expect(r.root.textContent).toContain(ART.name);
      expect(r.root.all().some(x => x.tagName === "BUTTON")).toBe(false);   // salt-okunur
      q.stopAll();
      const s = await renderPanel(app, proposedAllows);
      expect(s.root.all().find(x => x.dataset.cloudJobsStopped === "true")).toBeDefined();
      expect(s.cards.every(x => x.dataset.cloudJobStatus === "STOPPED" || x.dataset.cloudJobStatus === "SUCCEEDED" || x.dataset.cloudJobStatus === "FAILED")).toBe(true);
    });

    it("desktop panel is honest on every failure: server 500 -> ERROR, no queue -> NOT_CONFIGURED, today's main.mjs allow-list -> UNAVAILABLE; never a fake card", async () => {
      const boom = mkServer(throwingQueue());
      const e = await renderPanel(boom, proposedAllows);
      expect([e.state, e.cards.length, e.seen]).toEqual(["ERROR", 0, [{path: CLOUD_JOBS_PATH, status: 500}]]);
      expect(e.loaded.code).toBe(`${CLOUD_JOBS_PATH}: HTTP 500`);
      const none = mkServer(null);
      const nc = await renderPanel(none, proposedAllows);
      expect([nc.state, nc.cards.length]).toEqual(["NOT_CONFIGURED", 0]);
      const {q} = seeded();
      const real = await renderPanel(mkServer(q), mainAllows);
      if (mainAllows(CLOUD_JOBS_PATH)) {
        expect(real.state).toBe("OK");   // Kurucu PR'ı main.mjs'e girişi ekledikten sonra
      } else {
        expect([real.state, real.cards.length, real.seen]).toEqual(["UNAVAILABLE", 0, [{path: CLOUD_JOBS_PATH, status: null, error: "INVALID_API_PATH"}]]);
      }
    });

    it("the loader rejects malformed or unknown-status payloads as ERROR instead of drawing them", async () => {
      const view = await load("views", "cloud-connection.js");
      const api = (data: unknown) => ({get: async () => ({ok: true, data})});
      for (const data of [null, {}, {state: "OK"}, {state: "OK", jobs: [{jobId: "job-x-1", status: "HACKED", attempt: 1, maxAttempts: 1}]},
        {state: "OK", jobs: [{jobId: "../x", status: "QUEUED", attempt: 1, maxAttempts: 1}]}, {state: "WEIRD", jobs: []}]) {
        expect((await view.loadCloudJobs(api(data))).state, JSON.stringify(data)).toBe("ERROR");
      }
      expect((await view.loadCloudJobs({get: async () => ({ok: false, state: "OFFLINE", message: "fetch failed"})})).state).toBe("OFFLINE");
      const sec = await view.loadCloudJobs(api({state: "OK", jobs: [{jobId: "job-x-1", status: "FAILED", attempt: 1, maxAttempts: 1, kind: "BUILD", message: "token=abcdef1234567890"}]}));
      expect(sec.jobs[0].message).toBe("token=[REDACTED]");
      // proposed allow-list entries are exact (anchored)
      for (const p of [`${CLOUD_JOBS_PATH}/`, `${CLOUD_JOBS_PATH}?x`, `${CLOUD_JOBS_PATH}x`, `${CLOUD_JOBS_PATH}/a/b`, `${CLOUD_JOBS_PATH}/..`]) expect(PROPOSED_GET.some(re => re.test(p)), p).toBe(false);
    });

    // ---------- Kurucu yönlendirmeli sertleştirme (#335 takibi) ----------
    it("server-side redaction: a planted secret in a worker FAILED/RETRYING message never leaves the API (not relying on the desktop sanitizer)", async () => {
      const q = new CloudJobQueue({dir, scopeKeys: new Map([["k-1", SCOPE_KEY]]), workerKeys: new Map([["worker-a", WORKER_KEY]]), now: () => clock, leaseMs: 60_000});
      open.push(q);
      // test içinde birleştirilen sahte secret'lar (depoda düz literal yok)
      const planted = {
        kv: ["tok", "en=", "pl4nted-T0k3n-value"].join(""), bearer: ["Bear", "er abc.def.ghi"].join(""), url: ["https://ci-user:", "s3cr3tPW", "@git.example.com/r.git"].join(""),
        key: ["AKIA", "PLANTED0123456789", "abcdefghij0123"].join(""), path: "/home/runner/.config/app/credentials.json", win: "C:\\Users\\builder\\secrets\\id.txt",
      };
      const raw = `step failed ${planted.kv} ${planted.bearer} clone ${planted.url} using ${planted.key} at ${planted.path} or ${planted.win}`;
      const j = req(TENANT, {retry: {maxAttempts: 2, backoffMs: 1000}});
      expect(q.submit(j)).toMatchObject({ok: true});
      const c1 = q.claim(auth("claim", "*")); if (!c1.ok) throw new Error("claim");
      const res = {status: "FAILED" as const, message: raw};
      expect(q.complete(auth("complete", j.jobId, {leaseId: c1.lease.leaseId, result: res}), j.jobId, c1.lease.leaseId, res)).toMatchObject({ok: true});   // attempt 1 -> RETRYING
      const app = mkServer(q);
      const listBody = (await get(app, CLOUD_JOBS_PATH)).body, itemBody = (await get(app, `${CLOUD_JOBS_PATH}/${j.jobId}`)).body;
      const row = q.summary(TENANT, j.jobId)!;
      expect(row.status).toBe("QUEUED");
      expect(row.lastEventType).toBe("RETRYING");
      for (const blob of [listBody, itemBody, JSON.stringify(row)]) {
        for (const secret of ["pl4nted-T0k3n-value", "abc.def.ghi", "s3cr3tPW", "ci-user", planted.key, "/home/runner", "credentials.json", "C:\\\\Users", "builder"]) expect(blob, secret).not.toContain(secret);
      }
      expect(row.message).toContain("step failed");
      expect(row.message).toMatch(/\[REDACTED:KEY_VALUE\]|\[REDACTED:/);
      expect(row.message!.length).toBeLessThanOrEqual(JOB_MESSAGE_MAX);
      // redactor units: each class on its own; benign text untouched
      expect(redactJobMessage(planted.kv)).toBe("token=[REDACTED:KEY_VALUE]");
      expect(redactJobMessage(`auth: ${planted.bearer}`)).not.toContain("abc.def.ghi");
      expect(redactJobMessage(`Authorization ${planted.bearer}`)).not.toContain("abc.def.ghi");
      expect(redactJobMessage(planted.url)).toBe("https://[REDACTED:URL_CREDENTIALS]@git.example.com/r.git");
      expect(redactJobMessage(planted.key)).toBe("[REDACTED:KEY_SHAPED]");
      expect(redactJobMessage(`at ${planted.path}:12`)).toBe("at [path]");
      expect(redactJobMessage(planted.win)).toBe("[path]");
      for (const benign of ["compile error in step 2", "LEASE_EXPIRED", "see https://example.com/docs/a for help", "missing Bearer token"]) expect(redactJobMessage(benign), benign).toBe(benign);
      expect(redactJobMessage("x".repeat(5000))).toHaveLength(JOB_MESSAGE_MAX);
      expect(redactJobMessage(`ok\u0000\u0007done`)).toBe("okdone");
    });

    it("forged tenant headers and query parameters never change the tenant: only RouteDeps.scope applies", async () => {
      const {q, x} = seeded();
      const app = mkServer(q);
      const mine = (await get(app, CLOUD_JOBS_PATH)).json().jobs.map((j: any) => j.jobId).sort();
      expect(mine).toHaveLength(3);
      const forge = (url: string, extra: Record<string, string>) => app.inject({method: "GET", url, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210", ...extra}});
      for (const h of [{"x-uasco-tenant": OTHER}, {"x-tenant-id": OTHER}, {"x-uasco-tenant": OTHER, "x-tenant-id": OTHER}, {tenant: OTHER}] as Array<Record<string, string>>) {
        const r = await forge(CLOUD_JOBS_PATH, h);
        expect([JSON.stringify(h), r.statusCode, r.json().jobs.map((j: any) => j.jobId).sort()]).toEqual([JSON.stringify(h), 200, mine]);
        const it2 = await forge(`${CLOUD_JOBS_PATH}/${x.jobId}`, h);
        expect([JSON.stringify(h), it2.statusCode]).toEqual([JSON.stringify(h), 404]);
      }
      for (const qs of [`?tenantId=${OTHER}`, `?tenant=${OTHER}`, `?tenantId=${OTHER}&tenant=${OTHER}`, `?scope=${OTHER}`]) {
        const r = await forge(`${CLOUD_JOBS_PATH}${qs}`, {});
        expect([qs, r.statusCode, r.json().jobs.map((j: any) => j.jobId).sort()]).toEqual([qs, 200, mine]);
        expect((await forge(`${CLOUD_JOBS_PATH}/${x.jobId}${qs}`, {})).statusCode, qs).toBe(404);
      }
    });

    it("boundaries: job id 3 / 128 / 129 chars, status enum, message cap 200, list limit 0 / 1 / 100 / 101 / NaN", async () => {
      expect([CLOUD_JOB_ID_RE.test("abc"), CLOUD_JOB_ID_RE.test("ab"), CLOUD_JOB_ID_RE.test("a".repeat(128)), CLOUD_JOB_ID_RE.test("a".repeat(129))]).toEqual([true, false, true, false]);
      const q = new CloudJobQueue({dir, scopeKeys: new Map([["k-1", SCOPE_KEY]]), workerKeys: new Map([["worker-a", WORKER_KEY]]), now: () => clock, leaseMs: 60_000});
      open.push(q);
      const id3 = "abc", id128 = "j" + "0".repeat(127);
      for (const id of [id3, id128]) expect(q.submit(req(TENANT, {jobId: id})), id).toMatchObject({ok: true});
      expect(q.summary(TENANT, id3)?.jobId).toBe(id3);
      expect(q.summary(TENANT, id128)?.jobId).toBe(id128);
      const app = mkServer(q);
      expect((await get(app, `${CLOUD_JOBS_PATH}/${id3}`)).json()).toMatchObject({job: {jobId: id3, status: "QUEUED"}});
      expect((await get(app, `${CLOUD_JOBS_PATH}/ab`)).statusCode).toBe(400);
      // 128: route kabul eder; Fastify maxParamLength varsayılanı (100) Kurucu PR'ında >=128 yapılana kadar 414 ile önce reddeder
      const maxParam = Number(app.initialConfig?.maxParamLength ?? 100);
      const r128 = await get(app, `${CLOUD_JOBS_PATH}/${id128}`);
      if (maxParam >= 128) expect(r128.json()).toMatchObject({job: {jobId: id128}}); else expect(r128.statusCode).toBe(414);
      expect([400, 414]).toContain((await get(app, `${CLOUD_JOBS_PATH}/${"j".repeat(129)}`)).statusCode);
      // status enum: her durum kapalı kümeden
      const ENUM = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT", "STOPPED"];
      const cj = req(); q.submit(cj); expect(q.cancel(cj.jobId)).toEqual({ok: true});
      const fj = req(); q.submit(fj);
      const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error("claim");
      const long = {status: "FAILED" as const, message: "E".repeat(1500)};
      expect(q.complete(auth("complete", c.job.jobId, {leaseId: c.lease.leaseId, result: long}), c.job.jobId, c.lease.leaseId, long)).toMatchObject({ok: true});
      const failed = q.summary(TENANT, c.job.jobId)!;
      expect(failed.status).toBe("FAILED");
      expect(failed.message).toHaveLength(JOB_MESSAGE_MAX);
      q.stopAll();
      const statuses = q.list(TENANT).map(r => r.status);
      expect(statuses).toContain("CANCELLED"); expect(statuses).toContain("STOPPED"); expect(statuses).toContain("FAILED");
      for (const st of statuses) expect(ENUM, st).toContain(st);
    });

    it("list limit clamps to 1..100 (0 -> 1, 1, 100, 101 -> 100, NaN / non-integer -> 100)", () => {
      const q = new CloudJobQueue({dir, scopeKeys: new Map([["k-1", SCOPE_KEY]]), workerKeys: new Map([["worker-a", WORKER_KEY]]), now: () => clock, leaseMs: 60_000});
      open.push(q);
      for (let i = 0; i < 102; i++) expect(q.submit(req()).ok).toBe(true);
      expect([0, 1, 100, 101, Number.NaN, 2.5, -5, Number.POSITIVE_INFINITY].map(l => q.list(TENANT, l).length)).toEqual([1, 1, 100, 100, 100, 100, 1, 100]);
      expect(q.list(TENANT).length).toBe(100);
    });
  });
}
