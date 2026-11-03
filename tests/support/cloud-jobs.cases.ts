// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) CLOUD-T0003 bulut iş kuyruğunun worker entegrasyonunu, iptal edilen işin çıktı üretmemesini, çift yürütme engelini, lease süresi/yeniden deneme/zaman aşımını, global STOP'u, worker kimlik doğrulamasını ve journal'dan dayanıklı geri yüklemeyi doğrular.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CloudJobQueue, signWorkerAuth, type WorkerAuth} from "../../apps/control-api/src/cloud/jobs.js";
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
const auth = (action: WorkerAuth["action"], jobId: string, workerId = "worker-a", key = WORKER_FIXTURE): WorkerAuth =>
  signWorkerAuth({workerId, action, jobId, at: clock.toISOString(), nonce: randomUUID()}, key);

let dir: string;
const mkQueue = (leaseMs = 60_000) => new CloudJobQueue({dir, scopeKeys: new Map([["k-1", SCOPE_FIXTURE]]), workerKeys: new Map([["worker-a", WORKER_FIXTURE], ["worker-b", WORKER_FIXTURE + "b"]]), now, leaseMs});

export function registerCloudJobQueueCases(): void {
describe("CLOUD-T0003 cloud job queue", () => {
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-cloud-jobs-")); clock = new Date("2026-11-03T12:00:00Z"); });
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));
  it("worker integration: submit -> claim -> heartbeat -> complete with artifacts; stream is valid", () => {
    const q = mkQueue();
    const r = req(); expect(q.submit(r)).toEqual({ok: true, jobId: r.jobId, replay: false});
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    expect(c.job.jobId).toBe(r.jobId);
    advance(10_000); expect(q.heartbeat(auth("heartbeat", r.jobId), r.jobId, c.lease.leaseId)).toEqual({ok: true});
    expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: true, status: "SUCCEEDED"});
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
    expect(q.heartbeat(auth("heartbeat", r.jobId), r.jobId, c.lease.leaseId)).toEqual({ok: false, reason: "JOB_CANCELLED"});
    expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: false, reason: "JOB_CANCELLED"});
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
    expect(q.complete(auth("complete", r.jobId, "worker-b", WORKER_FIXTURE + "b"), r.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_MISMATCH"});
    expect(q.complete(auth("complete", r.jobId), r.jobId, "other-lease", {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_MISMATCH"});
    expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: true, status: "SUCCEEDED"});
    expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "JOB_TERMINAL"});
  });

  it("lease expiry: retried after backoff, then TIMED_OUT when attempts are exhausted; the stale worker's result is refused", () => {
    const q = mkQueue(60_000); const r = req(); q.submit(r);
    const c1 = q.claim(auth("claim", "*")); if (!c1.ok) throw new Error(c1.reason);
    advance(61_000); q.reap();
    expect(q.get(r.jobId)!.status).toBe("QUEUED");
    expect(q.complete(auth("complete", r.jobId), r.jobId, c1.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_MISMATCH"});
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
      expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "FAILED", message: "exit 1"})).toMatchObject({ok: true});
      expect(q.get(r.jobId)!.events.at(-1)!.type).toBe(expected);
    }
  });

  it("job timeoutMs bounds the whole run even with heartbeats", () => {
    const q = mkQueue(); const r = req({timeoutMs: 120_000}); q.submit(r);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    for (let i = 0; i < 3; i++) { advance(50_000); q.heartbeat(auth("heartbeat", r.jobId), r.jobId, c.lease.leaseId); }
    q.reap();
    expect(q.get(r.jobId)!.status).toBe("TIMED_OUT");
  });

  it("GLOBAL STOP: running and queued jobs STOPPED, no new submit or claim, and it survives a restart", () => {
    const q = mkQueue(); const a = req(), b = req(); q.submit(a); q.submit(b);
    const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
    q.stopAll();
    expect(q.get(a.jobId)!.status).toBe("STOPPED"); expect(q.get(b.jobId)!.status).toBe("STOPPED");
    expect(q.complete(auth("complete", a.jobId), a.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art]})).toEqual({ok: false, reason: "GLOBAL_STOP_ACTIVE"});
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
    expect(q2.complete(auth("complete", a.jobId), a.jobId, c.lease.leaseId, {status: "SUCCEEDED"})).toEqual({ok: false, reason: "LEASE_EXPIRED"});
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
    expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "DONE" as "SUCCEEDED"})).toEqual({ok: false, reason: "RESULT_INVALID"});
    expect(q.complete(auth("complete", r.jobId), r.jobId, c.lease.leaseId, {status: "SUCCEEDED", artifacts: [art, {...art, name: "../x"}]})).toEqual({ok: false, reason: "RESULT_INVALID"});
    expect(q.get(r.jobId)!.events.length).toBe(before);
  });
});
}
