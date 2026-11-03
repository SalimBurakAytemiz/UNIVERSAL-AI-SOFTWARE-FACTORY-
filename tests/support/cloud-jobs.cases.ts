// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) CLOUD-T0003 bulut iş kuyruğunun worker entegrasyonunu, iptal edilen işin çıktı üretmemesini, çift yürütme engelini, lease süresi/yeniden deneme/zaman aşımını, global STOP'u, worker kimlik doğrulamasını ve journal'dan dayanıklı geri yüklemeyi doğrular.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CloudJobQueue, pidAlive, signWorkerAuth, type JobResult, type WorkerAuth} from "../../apps/control-api/src/cloud/jobs.js";
import {CLOUD_CONTRACT_VERSION, signScope, sha256Hex, verifyEventStream, type CloudJobRequest, type UnsignedScope} from "../../core/cloud/contracts.js";

const SCOPE_FIXTURE = "scope-fixture-key-".repeat(3);
const WORKER_FIXTURE = "worker-fixture-key-".repeat(3);
let clock = new Date("2026-11-03T12:00:00Z");
const now = () => clock;
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
const unsigned: UnsignedScope = {tenantId: "tenant-001", projectId: "proj-001", environment: "staging", jobKinds: ["BUILD", "TEST"], allowNetwork: false, maxCostUsd: 5,
  issuedAt: "2026-11-03T11:00:00Z", expiresAt: "2026-11-03T19:00:00Z", keyId: "k-1"};
const art = {name: "out/app.zip", sha256: sha256Hex("bytes"), sizeBytes: 5};
let n = 0;
function req(over: Partial<CloudJobRequest> = {}): CloudJobRequest {
  n++;
  return {contractVersion: CLOUD_CONTRACT_VERSION, jobId: `job-${String(n).padStart(4, "0")}`, tenantId: "tenant-001", projectId: "proj-001", environment: "staging", kind: "BUILD",
    idempotencyKey: `idem-${String(n).padStart(4, "0")}`, timeoutMs: 60 * 60 * 1000, retry: {maxAttempts: 2, backoffMs: 1000}, needsNetwork: false, estimatedCostUsd: 1,
    inputArtifacts: [], scope: signScope(unsigned, SCOPE_FIXTURE), requestedAt: "2026-11-03T11:59:00Z", ...over};
}
const auth = (action: WorkerAuth["action"], jobId: string, workerId = "worker-a", key = WORKER_FIXTURE, body: unknown = {}): WorkerAuth =>
  signWorkerAuth({workerId, action, jobId, at: clock.toISOString(), nonce: randomUUID()}, key, body);
const hb = (q: CloudJobQueue, jobId: string, leaseId: string, w = "worker-a", k = WORKER_FIXTURE) => q.heartbeat(auth("heartbeat", jobId, w, k, {leaseId}), jobId, leaseId);
const done = (q: CloudJobQueue, jobId: string, leaseId: string, result: JobResult, w = "worker-a", k = WORKER_FIXTURE) =>
  q.complete(auth("complete", jobId, w, k, {leaseId, result}), jobId, leaseId, result);

let dir: string;
const open: CloudJobQueue[] = [];
const opts = (leaseMs: number) => ({dir, scopeKeys: new Map([["k-1", SCOPE_FIXTURE]]), workerKeys: new Map([["worker-a", WORKER_FIXTURE], ["worker-b", WORKER_FIXTURE + "b"]]), now, leaseMs});
/** Yeni örnek = süreç yeniden başlatması: önceki örnek kapatılır (tek yazıcı kilidi). */
const mkQueue = (leaseMs = 60_000) => { while (open.length) open.pop()!.close(); const q = new CloudJobQueue(opts(leaseMs)); open.push(q); return q; };

export function registerCloudJobQueueCases(): void {
describe("CLOUD-T0003 cloud job queue", () => {
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-cloud-jobs-")); clock = new Date("2026-11-03T12:00:00Z"); });
  afterEach(() => { while (open.length) open.pop()!.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  it("worker integration: submit -> claim -> heartbeat -> complete with artifacts; stream is valid", () => {
    const q = mkQueue();
    const r = req(); expect(q.submit(r)).toEqual({ok: true, jobId: r.jobId, replay: false});
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    expect(c.job.jobId).toBe(r.jobId);
    advance(10_000); expect(hb(q, r.jobId, c.lease.leaseId)).toEqual({ok: true});
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: true, status: "SUCCEEDED"});
    const s = q.get(r.jobId)!;
    expect(s.events.map(e => e.type)).toEqual(["QUEUED", "STARTED", "HEARTBEAT", "ARTIFACT", "SUCCEEDED"]);
    expect(verifyEventStream(s.events, s.job)).toEqual({ok: true, terminal: "SUCCEEDED"});
    expect(fs.readFileSync(path.join(dir, "jobs.journal.jsonl"), "utf8")).not.toContain(r.scope.signature);   // imza diske yazılmaz
  });

  it("rejects unsigned/invalid requests and replays idempotent ones without a second job", () => {
    const q = mkQueue(); const r = req();
    expect(q.submit({...r, scope: {...r.scope, maxCostUsd: 99}})).toEqual({ok: false, reason: "SCOPE_SIGNATURE_INVALID"});
    expect(q.submit(r)).toMatchObject({ok: true, replay: false});
    expect(q.submit(r)).toEqual({ok: true, jobId: r.jobId, replay: true});
    expect(q.submit({...r, timeoutMs: 120_000})).toEqual({ok: false, reason: "IDEMPOTENCY_CONFLICT"});
    expect(q.submit({...req(), jobId: r.jobId})).toEqual({ok: false, reason: "JOB_ID_REUSED"});
  });

  it("NEGATIVE: a cancelled running job yields no output; its heartbeat and result are refused", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    expect(q.cancel(r.jobId)).toEqual({ok: true});
    expect(hb(q, r.jobId, c.lease.leaseId)).toEqual({ok: false, reason: "JOB_CANCELLED"});
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: false, reason: "JOB_CANCELLED"});
    const s = q.get(r.jobId)!;
    expect(s.events.some(e => e.type === "ARTIFACT" || e.type === "SUCCEEDED")).toBe(false);
    expect(s.status).toBe("CANCELLED");
    expect(q.cancel(r.jobId)).toEqual({ok: false, reason: "JOB_TERMINAL"});
  });

  it("NEGATIVE: a cancelled queued job is never claimed", () => {
    const q = mkQueue(); const r = req(); q.submit(r); q.cancel(r.jobId);
    expect(q.claim(auth("claim", "*"))).toEqual({ok: false, reason: "NO_JOB"});
  });

  it("no duplicate execution: one lease per job; another worker or a stale lease cannot complete", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    expect(q.claim(auth("claim", "*", "worker-b", WORKER_FIXTURE + "b"))).toEqual({ok: false, reason: "NO_JOB"});
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED"}, "worker-b", WORKER_FIXTURE + "b")).toEqual({ok: false, reason: "LEASE_MISMATCH"});
    expect(done(q, r.jobId, "other-lease", {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_MISMATCH"});
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: true, status: "SUCCEEDED"});
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "JOB_TERMINAL"});
  });

  it("lease expiry: retried after backoff, then TIMED_OUT when attempts are exhausted; the stale worker's result is refused", () => {
    const q = mkQueue(60_000); const r = req(); q.submit(r);
    const c1 = q.claim(auth("claim", "*")); if (!c1.ok) throw new Error(c1.reason);
    advance(61_000); q.reap();
    expect(q.get(r.jobId)!.status).toBe("QUEUED");
    expect(done(q, r.jobId, c1.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_MISMATCH"});
    expect(q.claim(auth("claim", "*"))).toEqual({ok: false, reason: "NO_JOB"});   // backoff 1 s
    advance(1_000);
    const c2 = q.claim(auth("claim", "*")); if (!c2.ok) throw new Error(c2.reason);
    expect(c2.attempt).toBe(2);
    advance(61_000); q.reap();
    expect(q.get(r.jobId)!.status).toBe("TIMED_OUT");
    expect(verifyEventStream(q.get(r.jobId)!.events, r)).toEqual({ok: true, terminal: "TIMED_OUT"});
  });

  it("a FAILED result is retried while attempts remain, then FAILED", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    for (const expected of ["RETRYING", "FAILED"]) {
      advance(1_000);
      const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
      expect(done(q, r.jobId, c.lease.leaseId, {status: "FAILED", message: "exit 1"})).toMatchObject({ok: true});
      expect(q.get(r.jobId)!.events.at(-1)!.type).toBe(expected);
    }
  });

  it("job timeoutMs bounds the whole run even with heartbeats", () => {
    const q = mkQueue(); const r = req({timeoutMs: 120_000}); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    for (let i = 0; i < 3; i++) { advance(50_000); hb(q, r.jobId, c.lease.leaseId); }
    q.reap();
    expect(q.get(r.jobId)!.status).toBe("TIMED_OUT");
  });

  it("GLOBAL STOP: running and queued jobs STOPPED, no new submit or claim, and it survives a restart", () => {
    const q = mkQueue(); const a = req(), b = req(); q.submit(a); q.submit(b);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    q.stopAll();
    expect(q.get(a.jobId)!.status).toBe("STOPPED"); expect(q.get(b.jobId)!.status).toBe("STOPPED");
    expect(done(q, a.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: false, reason: "GLOBAL_STOP_ACTIVE"});
    expect(q.submit(req())).toEqual({ok: false, reason: "GLOBAL_STOP_ACTIVE"});
    expect(q.claim(auth("claim", "*"))).toEqual({ok: false, reason: "GLOBAL_STOP_ACTIVE"});
    expect(mkQueue().isStopped).toBe(true);
  });

  it("worker authentication: unknown worker, wrong key, wrong action/job, stale time and nonce replay are denied and audited", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    expect(q.claim(auth("claim", "*", "worker-x"))).toEqual({ok: false, reason: "WORKER_AUTH_INVALID"});
    expect(q.claim(auth("claim", "*", "worker-a", "wrong-key-".repeat(4)))).toEqual({ok: false, reason: "WORKER_AUTH_INVALID"});
    expect(q.claim(auth("heartbeat", "*"))).toEqual({ok: false, reason: "WORKER_AUTH_INVALID"});
    const old = auth("claim", "*"); advance(3 * 60 * 1000);
    expect(q.claim(old)).toEqual({ok: false, reason: "WORKER_AUTH_INVALID"});
    const once = auth("claim", "*");
    expect(q.claim(once)).toMatchObject({ok: true});
    expect(q.claim(once)).toEqual({ok: false, reason: "WORKER_AUTH_REPLAYED"});
    const audit = fs.readFileSync(path.join(dir, "jobs.audit.jsonl"), "utf8");
    expect(audit).toContain("WORKER_DENIED"); expect(audit).not.toContain(WORKER_FIXTURE);
  });

  it("durability: a restart rebuilds state from the journal; a running lease is not trusted after restart", () => {
    const q1 = mkQueue(); const a = req(), b = req(); q1.submit(a); q1.submit(b);
    const c = q1.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    const q2 = mkQueue();
    expect(q2.get(b.jobId)!.status).toBe("QUEUED");
    expect(done(q2, a.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_EXPIRED"});
    q2.reap(); expect(q2.get(a.jobId)!.status).toBe("QUEUED");
    expect(q2.submit(a)).toEqual({ok: true, jobId: a.jobId, replay: true});   // idempotency persists
  });

  it("fail-closed on a corrupt journal", () => {
    const q = mkQueue(); q.submit(req());
    fs.appendFileSync(path.join(dir, "jobs.journal.jsonl"), JSON.stringify({kind: "event", event: {jobId: "job-ghost", seq: 0, type: "QUEUED", at: clock.toISOString(), attempt: 1}}) + "\n");
    expect(() => mkQueue()).toThrow(/JOURNAL_CORRUPT/);
  });

  it("rejects malformed results and corrupt artifacts without recording anything", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    const before = q.get(r.jobId)!.events.length;
    expect(done(q, r.jobId, c.lease.leaseId, {status: "DONE" as "SUCCEEDED"})).toEqual({ok: false, reason: "RESULT_INVALID"});
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art, {...art, name: "../x"}]})).toEqual({ok: false, reason: "RESULT_INVALID"});
    expect(q.get(r.jobId)!.events.length).toBe(before);
  });
  it("B-1: after timeoutMs, heartbeat and complete are refused and no output is recorded; heartbeats cannot extend the lease past the bound", () => {
    const q = mkQueue(60_000); const r = req({timeoutMs: 120_000}); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    advance(50_000); expect(hb(q, r.jobId, c.lease.leaseId)).toEqual({ok: true});
    advance(50_000); expect(hb(q, r.jobId, c.lease.leaseId)).toEqual({ok: true});
    expect(q.get(r.jobId)!.lease!.expiresAt).toBe(Date.parse("2026-11-03T12:00:00Z") + 120_000);   // 100 s + 60 s lease, bound 120 s
    advance(100_000);
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: false, reason: "JOB_TIMED_OUT"});
    const s = q.get(r.jobId)!;
    expect(s.status).toBe("TIMED_OUT"); expect(s.events.some(e => e.type === "ARTIFACT" || e.type === "SUCCEEDED")).toBe(false);
    expect(hb(q, r.jobId, c.lease.leaseId)).toEqual({ok: false, reason: "JOB_TERMINAL"});
  });

  it("B-2: a used worker proof is refused after a restart (nonces are persisted)", () => {
    const q1 = mkQueue(); q1.submit(req()); q1.submit(req());
    const proof = auth("claim", "*");
    expect(q1.claim(proof)).toMatchObject({ok: true});
    const q2 = mkQueue();
    expect(q2.claim(proof)).toEqual({ok: false, reason: "WORKER_AUTH_REPLAYED"});
    expect(q2.claim(auth("claim", "*"))).toMatchObject({ok: true});
  });

  it("N-1: the worker MAC binds the lease and the result body; a changed lease or result is refused", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    const signedFor = {status: "FAILED" as const};
    const proof = auth("complete", r.jobId, "worker-a", WORKER_FIXTURE, {leaseId: c.lease.leaseId, result: signedFor});
    expect(q.complete(proof, r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: false, reason: "WORKER_AUTH_INVALID"});
    const hbProof = auth("heartbeat", r.jobId, "worker-a", WORKER_FIXTURE, {leaseId: "other-lease"});
    expect(q.heartbeat(hbProof, r.jobId, c.lease.leaseId)).toEqual({ok: false, reason: "WORKER_AUTH_INVALID"});
    expect(q.get(r.jobId)!.status).toBe("RUNNING");
  });

  it("N-2: submit writes its two journal lines atomically; a torn tail is a typed JOURNAL_CORRUPT", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const j = path.join(dir, "jobs.journal.jsonl");
    expect(fs.readFileSync(j, "utf8").trim().split("\n").map(l => JSON.parse(l).kind)).toEqual(["submit", "event"]);
    fs.appendFileSync(j, '{"kind":"event","event":{"jobId"');
    expect(() => mkQueue()).toThrow(/JOURNAL_CORRUPT: torn trailing line/);
  });

  it("N-3: rejected results and job id reuse are audited", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    done(q, r.jobId, c.lease.leaseId, {status: "DONE" as "SUCCEEDED"});
    q.submit({...req(), jobId: r.jobId});
    const audit = fs.readFileSync(path.join(dir, "jobs.audit.jsonl"), "utf8");
    expect(audit).toContain('"reason":"RESULT_INVALID"'); expect(audit).toContain('"reason":"JOB_ID_REUSED"');
  });
  it("L-1/L-2: a non-string FAILED message is RESULT_INVALID (no throw); extra artifact fields are not journaled", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    expect(done(q, r.jobId, c.lease.leaseId, {status: "FAILED", message: 42 as unknown as string})).toEqual({ok: false, reason: "RESULT_INVALID"});
    expect(q.get(r.jobId)!.status).toBe("RUNNING");
    const blob = {...art, blob: "x".repeat(1000)};
    expect(done(q, r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [blob]})).toEqual({ok: true, status: "SUCCEEDED"});
    expect(fs.readFileSync(path.join(dir, "jobs.journal.jsonl"), "utf8")).not.toContain("x".repeat(100));
  });

  it("L-3: a second queue instance on the same directory is refused while the first is open", () => {
    mkQueue();
    expect(() => new CloudJobQueue(opts(60_000))).toThrow(/QUEUE_LOCKED/);
  });

  it("T-1: a future-dated proof (inside the skew window) is still refused after a restart", () => {
    const q1 = mkQueue(); q1.submit(req()); q1.submit(req());
    const future = signWorkerAuth({workerId: "worker-a", action: "claim", jobId: "*", at: new Date(clock.getTime() + 119_000).toISOString(), nonce: randomUUID()}, WORKER_FIXTURE);
    expect(q1.claim(future)).toMatchObject({ok: true});
    advance(200_000);   // kanıt hâlâ ±2 dk penceresinde (+119 s tarihli); nonce süresi bunu kapsamalı
    expect(mkQueue().claim(future)).toEqual({ok: false, reason: "WORKER_AUTH_REPLAYED"});
  });

  it("T-2: timeoutMs bounds the whole run across retries (the run clock is not reset by a new claim); claim lease is capped", () => {
    const q = mkQueue(60_000); const r = req({timeoutMs: 90_000}); q.submit(r);
    const c1 = q.claim(auth("claim", "*")); if (!c1.ok) throw new Error(c1.reason);
    advance(61_000); q.reap(); advance(1_000);
    const c2 = q.claim(auth("claim", "*")); if (!c2.ok) throw new Error(c2.reason);
    expect(c2.lease.expiresAt).toBe(Date.parse("2026-11-03T12:00:00Z") + 90_000);
    advance(29_000);
    expect(done(q, r.jobId, c2.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "JOB_TIMED_OUT"});
  });
  it("N-3: a dead owner's lock (and an empty lock file) is taken over; a live owner's is not", () => {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, "jobs.lock"), "999999999");   // böyle bir süreç yok
    expect(() => mkQueue()).not.toThrow();
    while (open.length) open.pop()!.close();
    fs.writeFileSync(path.join(dir, "jobs.lock"), "");             // yazma sırasında çökmüş kilit
    expect(() => mkQueue()).not.toThrow();
    while (open.length) open.pop()!.close();
    fs.writeFileSync(path.join(dir, "jobs.lock"), String(process.pid));
    expect(() => new CloudJobQueue(opts(60_000))).toThrow(/QUEUE_LOCKED/);
    expect(fs.readdirSync(dir).filter(f => f.includes(".stale-"))).toEqual([]);
  });

  it("N-3: EPERM means alive, ESRCH means dead", () => {
    const err = (code: string) => () => { throw Object.assign(new Error(code), {code}); };
    expect(pidAlive(1, err("EPERM"))).toBe(true);
    expect(pidAlive(1, err("ESRCH"))).toBe(false);
    expect(pidAlive(1, () => {})).toBe(true);
  });

  it("N-2/N-3: a failing constructor never leaves the lock behind", () => {
    expect(() => new CloudJobQueue(opts(5))).toThrow(/leaseMs/);
    expect(fs.existsSync(path.join(dir, "jobs.lock"))).toBe(false);
    const q = mkQueue(); q.submit(req()); q.close(); open.length = 0;
    fs.appendFileSync(path.join(dir, "jobs.journal.jsonl"), "{not json}\n");
    expect(() => new CloudJobQueue(opts(60_000))).toThrow(/JOURNAL_CORRUPT/);
    expect(fs.existsSync(path.join(dir, "jobs.lock"))).toBe(false);
  });

  it("N-4: a closed instance is fenced", () => {
    const q = mkQueue(); q.close(); open.length = 0;
    expect(() => q.submit(req())).toThrow(/QUEUE_CLOSED/);
    expect(() => q.stopAll()).toThrow(/QUEUE_CLOSED/);
    expect(() => q.claim(auth("claim", "*"))).toThrow(/QUEUE_CLOSED/);
  });

  it("N-5: post-authentication denials are audited", () => {
    const q = mkQueue(); const r = req(); q.submit(r);
    expect(q.cancel("job-none")).toMatchObject({ok: false});
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    expect(q.claim(auth("claim", "*"))).toEqual({ok: false, reason: "NO_JOB"});
    expect(hb(q, r.jobId, "other-lease")).toEqual({ok: false, reason: "LEASE_MISMATCH"});
    const audit = fs.readFileSync(path.join(dir, "jobs.audit.jsonl"), "utf8");
    for (const d of ["CANCEL_REJECTED", "NO_JOB", "HEARTBEAT_REJECTED"]) expect(audit).toContain(`"decision":"${d}"`);
  });
});
}
