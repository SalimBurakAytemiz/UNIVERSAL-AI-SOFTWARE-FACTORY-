// //TR: Bu vaka dosyası (kayıtlı tests/v7-cloud-contracts.test.ts tarafından içe aktarılır) CLOUD-T0010 bulut görev kırılımının deterministik görev kimliklerini, döngü ve bilinmeyen girdi reddini, kapsam/bütçe ön kontrolünü, Founder kapısını, bağımlılık sıralı ve sınırlı dağıtımı, gerçek CLOUD-T0003 kuyruğuna idempotent yeniden gönderimi ve sahte ModelProvider ile güvenilmez plan çıktısının doğrulanmasını sınar.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CloudJobQueue, signWorkerAuth, type WorkerAuth} from "../../apps/control-api/src/cloud/jobs.js";
import type {ModelProvider} from "../../apps/control-api/src/cloud/remote-gateway.js";
import {signScope, type UnsignedScope} from "../../core/cloud/contracts.js";
import {
  ROLE_REGISTRY, TaskOrchestrator, buildTaskDag, decomposeIntent, type TaskDag, type TaskPlan, type TaskSpec,
} from "../../core/cloud/task-orchestrator.js";

const SCOPE_FIXTURE = "orch-scope-fixture-".repeat(3);
const WORKER_FIXTURE = "orch-worker-fixture-".repeat(3);
const clock = new Date("2026-11-03T12:00:00Z");
const now = () => clock;
const unsigned: UnsignedScope = {tenantId: "tenant-001", projectId: "proj-001", environment: "staging", jobKinds: ["BUILD", "TEST", "SECURITY_SCAN", "PACKAGE", "DELIVERY"],
  allowNetwork: false, maxCostUsd: 10, issuedAt: "2026-11-03T11:00:00Z", expiresAt: "2026-11-03T19:00:00Z", keyId: "k-1"};
const scope = signScope(unsigned, SCOPE_FIXTURE);
const t = (key: string, deps: string[] = [], over: Partial<TaskSpec> = {}): TaskSpec =>
  ({key, kind: "BUILD", title: `task ${key}`, deps, needsNetwork: false, estimatedCostUsd: 1, timeoutMs: 60_000, retry: {maxAttempts: 1, backoffMs: 0}, ...over});
const plan = (tasks: TaskSpec[], over: Partial<TaskPlan> = {}): TaskPlan =>
  ({namespace: "feat-001", tenantId: "tenant-001", projectId: "proj-001", environment: "staging", tasks, ...over});
/** build -> {test, scan} -> package -> deliver (elmas + Founder kapılı teslim) */
const diamond = () => plan([
  t("deliver", ["package"], {kind: "DELIVERY"}), t("package", ["test", "scan"], {kind: "PACKAGE"}),
  t("test", ["build"], {kind: "TEST"}), t("scan", ["build"], {kind: "SECURITY_SCAN"}), t("build"),
]);
const dagOf = (p: unknown, s = scope as typeof scope | undefined): TaskDag => { const d = buildTaskDag(p, s); if (!d.ok) throw new Error(d.reason); return d.dag; };
const reasonOf = (p: unknown, s = scope as typeof scope | undefined) => { const d = buildTaskDag(p, s); return d.ok ? "OK" : d.reason; };
const idOf = (dag: TaskDag, key: string) => [...dag.tasks.values()].find(x => x.key === key)!.taskId;

let dir: string;
const open: CloudJobQueue[] = [];
const mkQueue = () => { while (open.length) open.pop()!.close(); const q = new CloudJobQueue({dir, scopeKeys: new Map([["k-1", SCOPE_FIXTURE]]), workerKeys: new Map([["w-1", WORKER_FIXTURE]]), now}); open.push(q); return q; };
const auth = (action: WorkerAuth["action"], jobId: string, body: unknown = {}) => signWorkerAuth({workerId: "w-1", action, jobId, at: clock.toISOString(), nonce: randomUUID()}, WORKER_FIXTURE, body);
/** Worker taklidi: kuyruktan bir iş alır ve verilen sonuçla bitirir. */
function runOne(q: CloudJobQueue, status: "SUCCEEDED" | "FAILED" = "SUCCEEDED"): string {
  const c = q.claim(auth("claim", "*")); if (!c.ok) throw new Error(c.reason);
  const result = {status}; const r = q.complete(auth("complete", c.job.jobId, {leaseId: c.lease.leaseId, result}), c.job.jobId, c.lease.leaseId, result);
  if (!r.ok) throw new Error(r.reason);
  return c.job.jobId;
}
const plannerFake = (text: string | (() => never)): ModelProvider & {prompts: string[]} => {
  const p = {name: "fake-planner", prompts: [] as string[], async invoke(r: {prompt: string}) {
    p.prompts.push(r.prompt); if (typeof text === "function") text();
    return {text: text as string, inputTokens: 10, outputTokens: 10, costUsd: 0.02};
  }};
  return p;
};
const dOpts = {namespace: "feat-001", scope, model: "fake-model", maxOutputTokens: 2000, maxCostUsd: 0.1};

export function registerCloudTaskOrchestratorCases(): void {
describe("CLOUD-T0010 cloud task DAG orchestrator", () => {
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-cloud-dag-")); });
  afterEach(() => { while (open.length) open.pop()!.close(); fs.rmSync(dir, {recursive: true, force: true}); });

  it("task ids are deterministic content hashes, independent of task/key order; upstream changes propagate downstream", () => {
    const a = dagOf(diamond()), b = dagOf(plan([...diamond().tasks].reverse()));
    expect(b.dagId).toBe(a.dagId); expect(b.order).toEqual(a.order);
    expect(a.order.map(id => a.tasks.get(id)!.key)).toEqual(["build", "scan", "test", "package", "deliver"]);
    for (const id of a.order) expect(id).toMatch(/^task-[0-9a-f]{40}$/);
    const changed = dagOf(plan(diamond().tasks.map(x => x.key === "build" ? {...x, timeoutMs: 120_000} : x)));
    for (const k of ["build", "test", "scan", "package", "deliver"]) expect(idOf(changed, k)).not.toBe(idOf(a, k));
    expect(idOf(dagOf(plan(diamond().tasks, {namespace: "feat-002"})), "build")).not.toBe(idOf(a, "build"));
    expect(a.tasks.get(idOf(a, "scan"))!.role).toBe(ROLE_REGISTRY.SECURITY_SCAN);
  });

  it("detects cycles, self deps, unknown deps and duplicate keys", () => {
    expect(buildTaskDag(plan([t("a", ["c"]), t("b", ["a"]), t("c", ["b"]), t("d")]), scope)).toEqual({ok: false, reason: "CYCLE_DETECTED", detail: "a,b,c"});
    expect(reasonOf(plan([t("a", ["a"])]))).toBe("SELF_DEPENDENCY");
    expect(reasonOf(plan([t("a", ["ghost"])]))).toBe("UNKNOWN_DEPENDENCY");
    expect(reasonOf(plan([t("a"), t("a")]))).toBe("DUPLICATE_KEY");
    expect(reasonOf(plan([t("a"), t("b", ["a", "a"])]))).toBe("TOO_MANY_DEPS");
  });

  it("fails closed on unknown or invalid input", () => {
    expect(reasonOf(null)).toBe("PLAN_MALFORMED");
    expect(reasonOf({...plan([t("a")]), extra: 1})).toBe("PLAN_MALFORMED");
    expect(reasonOf(plan([{...t("a"), role: "delivery"} as TaskSpec]))).toBe("PLAN_MALFORMED");   // model rol seçemez
    expect(reasonOf(plan([]))).toBe("PLAN_EMPTY");
    expect(reasonOf(plan(Array.from({length: 129}, (_, i) => t(`t${i}`, [], {estimatedCostUsd: 0}))))).toBe("PLAN_TOO_LARGE");
    expect(reasonOf(plan([t("a", [], {kind: "DEPLOY" as TaskSpec["kind"]})]))).toBe("INVALID_KIND");
    expect(reasonOf(plan([t("A b")]))).toBe("INVALID_ID");
    expect(reasonOf(plan([t("a")], {namespace: "x"}))).toBe("INVALID_ID");
    for (const bad of [{timeoutMs: 10}, {estimatedCostUsd: Number.NaN}, {retry: {maxAttempts: 9, backoffMs: 0}}, {title: ""}, {founderGate: "yes" as unknown as boolean},
      {inputArtifacts: [{name: "../x", sha256: "0".repeat(64), sizeBytes: 1}]}]) expect(reasonOf(plan([t("a", [], bad)]))).toBe("INVALID_TASK");
  });

  it("preflights the signed scope: tenant/kind/network/aggregate cost", () => {
    expect(reasonOf(plan([t("a")], {tenantId: "tenant-002"}))).toBe("SCOPE_MISMATCH");
    expect(reasonOf(plan([t("a", [], {kind: "MODEL_CALL"})]))).toBe("KIND_NOT_IN_SCOPE");
    expect(reasonOf(plan([t("a", [], {needsNetwork: true})]))).toBe("NETWORK_NOT_IN_SCOPE");
    expect(reasonOf(plan([t("a", [], {estimatedCostUsd: 6}), t("b", [], {estimatedCostUsd: 6})]))).toBe("PLAN_COST_EXCEEDS_SCOPE");   // tek tek < tavan, toplam > tavan
    expect(buildTaskDag(plan([t("a", [], {needsNetwork: true})])).ok).toBe(true);   // kapsamsız yapı doğrulaması: ön kontrol yok
  });

  it("E2E with the real CLOUD-T0003 queue: dependency-ordered dispatch, Founder gate, completion", () => {
    const q = mkQueue(); const dag = dagOf(diamond()); const o = new TaskOrchestrator({queue: q, scope, now});
    const id = (k: string) => idOf(dag, k);
    let r = o.dispatch(dag); if (!r.ok) throw new Error(r.reason);
    expect(r.report.submitted).toEqual([id("build")]);
    expect(r.report.statuses).toMatchObject({[id("test")]: "WAITING_DEPS", [id("deliver")]: "WAITING_DEPS"});
    expect(runOne(q)).toBe(id("build"));
    r = o.dispatch(dag); if (!r.ok) throw new Error(r.reason);
    expect(r.report.submitted).toEqual([id("scan"), id("test")]);
    runOne(q); runOne(q);
    r = o.dispatch(dag); if (!r.ok) throw new Error(r.reason);
    expect(r.report.submitted).toEqual([id("package")]); runOne(q);
    r = o.dispatch(dag); if (!r.ok) throw new Error(r.reason);
    expect(r.report.statuses[id("deliver")]).toBe("BLOCKED_FOUNDER_GATE"); expect(r.report.submitted).toEqual([]);
    expect(q.claim(auth("claim", "*"))).toEqual({ok: false, reason: "NO_JOB"});   // kapı açılmadan hiçbir şey kuyrukta değil
    r = o.dispatch(dag, new Set([id("deliver")])); if (!r.ok) throw new Error(r.reason);
    expect(r.report.submitted).toEqual([id("deliver")]); runOne(q);
    r = o.dispatch(dag); if (!r.ok) throw new Error(r.reason);
    expect(r.report).toMatchObject({complete: true, failed: false, submitted: []});
    expect(q.get(id("build"))!.job).toMatchObject({jobId: id("build"), idempotencyKey: id("build"), kind: "BUILD"});
  });

  it("re-submission is idempotent, also across a queue restart and a fresh orchestrator", () => {
    let q = mkQueue(); const dag = dagOf(diamond());
    const r1 = new TaskOrchestrator({queue: q, scope, now}).dispatch(dag); if (!r1.ok) throw new Error(r1.reason);
    const r2 = new TaskOrchestrator({queue: q, scope, now}).dispatch(dagOf(diamond())); if (!r2.ok) throw new Error(r2.reason);
    expect(r2.report.submitted).toEqual([]); expect(r2.report.statuses).toEqual(r1.report.statuses);
    q = mkQueue();   // süreç yeniden başlatması: journal'dan geri yüklenir
    const r3 = new TaskOrchestrator({queue: q, scope, now}).dispatch(dag); if (!r3.ok) throw new Error(r3.reason);
    expect(r3.report.submitted).toEqual([]);
    runOne(q); expect(q.claim(auth("claim", "*"))).toEqual({ok: false, reason: "NO_JOB"});   // build yalnızca bir kez kuyruğa girdi
  });

  it("a failed upstream blocks everything downstream; nothing is dispatched after it", () => {
    const q = mkQueue(); const dag = dagOf(diamond()); const o = new TaskOrchestrator({queue: q, scope, now});
    o.dispatch(dag); runOne(q, "FAILED");
    const r = o.dispatch(dag, new Set(dag.order)); if (!r.ok) throw new Error(r.reason);
    expect(r.report.failed).toBe(true); expect(r.report.submitted).toEqual([]);
    for (const k of ["test", "scan", "package", "deliver"]) expect(r.report.statuses[idOf(dag, k)]).toBe("BLOCKED_UPSTREAM");
  });

  it("bounded in-flight dispatch defers extra ready tasks", () => {
    const q = mkQueue(); const dag = dagOf(plan(["a", "b", "c"].map(k => t(k, [], {estimatedCostUsd: 0}))));
    const o = new TaskOrchestrator({queue: q, scope, now, maxInFlight: 2});
    const r = o.dispatch(dag); if (!r.ok) throw new Error(r.reason);
    expect(r.report.submitted).toHaveLength(2); expect(Object.values(r.report.statuses).filter(v => v === "DEFERRED_CAPACITY")).toHaveLength(1);
    expect(() => new TaskOrchestrator({queue: q, scope, maxInFlight: 0})).toThrow();
  });

  it("production plans and DELIVERY tasks are always Founder-gated, whatever the plan says", () => {
    const pScope = signScope({...unsigned, environment: "production"}, SCOPE_FIXTURE);
    const dag = dagOf(plan([t("a", [], {founderGate: false})], {environment: "production"}), pScope);
    expect(dag.tasks.get(dag.order[0])!.founderGate).toBe(true);
    expect(dagOf(plan([t("d", [], {kind: "DELIVERY", founderGate: false})])).tasks.values().next().value!.founderGate).toBe(true);
  });

  it("fails closed on queue denial, scope/DAG mismatch and tampered DAGs", () => {
    const q = mkQueue(); const dag = dagOf(diamond());
    q.stopAll();
    expect(new TaskOrchestrator({queue: q, scope, now}).dispatch(dag)).toMatchObject({ok: false, reason: "SUBMIT_DENIED", detail: "GLOBAL_STOP_ACTIVE"});
    const other = signScope({...unsigned, tenantId: "tenant-002"}, SCOPE_FIXTURE);
    expect(new TaskOrchestrator({queue: q, scope: other, now}).dispatch(dag)).toMatchObject({ok: false, reason: "DAG_INVALID"});
    const o = new TaskOrchestrator({queue: q, scope, now});
    expect(o.dispatch({...dag, order: [...dag.order].reverse()})).toMatchObject({ok: false, reason: "DAG_INVALID"});
    expect(o.dispatch({...dag, order: dag.order.slice(1)})).toMatchObject({ok: false, reason: "DAG_INVALID"});
    expect(o.dispatch(null as unknown as TaskDag)).toMatchObject({ok: false, reason: "DAG_INVALID"});
  });

  it("an existing job under a task id with different content is a JOB_MISMATCH, never silently reused", () => {
    const q = mkQueue(); const dag = dagOf(plan([t("a")])); const id = dag.order[0];
    const forged = new Map(dag.tasks); forged.set(id, {...dag.tasks.get(id)!, timeoutMs: 120_000});
    new TaskOrchestrator({queue: q, scope, now}).dispatch({...dag, tasks: forged});
    expect(new TaskOrchestrator({queue: q, scope, now}).dispatch(dag)).toEqual({ok: false, reason: "JOB_MISMATCH", taskId: id});
  });

  it("decomposes an intent through a fake ModelProvider; untrusted output is validated, context comes from the signed scope", async () => {
    const good = plannerFake(JSON.stringify({tasks: diamond().tasks}));
    const r = await decomposeIntent("Build and ship the invoice feature", good, dOpts);
    if (!r.ok) throw new Error(r.reason);
    expect(r.dag.dagId).toBe(dagOf(diamond()).dagId); expect(r.costUsd).toBe(0.02);
    expect(good.prompts[0]).toContain("<<<INTENT\nBuild and ship the invoice feature\nINTENT>>>");
    expect((await decomposeIntent("x", plannerFake("not json"), dOpts))).toEqual({ok: false, reason: "PLAN_UNPARSEABLE"});
    expect((await decomposeIntent("x", plannerFake(JSON.stringify({tasks: [], tenantId: "tenant-002"})), dOpts))).toEqual({ok: false, reason: "PLAN_UNPARSEABLE"});
    expect((await decomposeIntent("x", plannerFake(JSON.stringify({tasks: [t("a", ["b"]), t("b", ["a"])]})), dOpts))).toMatchObject({ok: false, reason: "CYCLE_DETECTED"});
    expect((await decomposeIntent("x", plannerFake(JSON.stringify({tasks: [t("a", [], {needsNetwork: true})]})), dOpts))).toMatchObject({ok: false, reason: "NETWORK_NOT_IN_SCOPE"});
    const boom = plannerFake(() => { throw new Error("upstream failure detail must-not-leak"); });
    expect(await decomposeIntent("x", boom, dOpts)).toEqual({ok: false, reason: "PLANNER_FAILED"});
    for (const bad of ["", "   ", 42, "x".repeat(20_001)]) expect(await decomposeIntent(bad, good, dOpts)).toEqual({ok: false, reason: "INTENT_INVALID"});
  });
});
}
