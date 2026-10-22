// //TR: Bu test MissionRunner'ın sahiplik (claim) sınırını doğrular: varsayılan sınır 1 iken kuyruktaki ikinci run'a lease ALINMAZ (uzun birinci run sırasında lease'i dolup sahte fence/recovery yaşamaz), sonraki tick onu alır; sınır 2 iken iki run gerçekten birlikte yürür; geçersiz sınır kurulumda reddedilir. Gerçek geçici git deposu ve FAKE executor kullanılır.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {testExecutionGate} from "./support/test-sandbox.js";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {ExecutorPair, FakeScript, MissionSpec} from "../core/workos/executors.js";

vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 120_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lanec-claims-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const TEST_SCRIPT = `import fs from "node:fs";\nprocess.exit(fs.existsSync("feature.txt") ? 0 : 1);\n`;
interface Ctx { store: WorkOsStore; dataDir: string; stopFile: string; missionIds: string[]; clock: {skewMs: number} }
function setup(missions: number): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const repo = path.join(tmp, `src-${id}`); fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT); fs.writeFileSync(path.join(repo, "README.txt"), "base\n");
  git(repo, ["add", "-A"]); git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `rt-${id}`); fs.mkdirSync(runtime, {recursive: true});
  const clock = {skewMs: 0}, store = new WorkOsStore(dataDir, {now: () => Date.now() + clock.skewMs});
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const missionIds: string[] = [];
  for (let i = 0; i < missions; i++) {
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: `Add feature ${i}`, objective: "feature.txt must exist", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    missionIds.push(m.missionId);
  }
  return {store, dataDir, stopFile: path.join(runtime, "GLOBAL_STOP.json"), missionIds, clock};
}
const script = (sleepFirstMs = 0): FakeScript => ({implement: n => ({files: {"feature.txt": "ok\n"}, ...(n === 1 && sleepFirstMs ? {sleepMs: sleepFirstMs} : {})}), review: () => ({verdict: "CLEAN"})});
const mkRunner = (c: Ctx, executors: ExecutorPair, extra: Partial<RunnerOptions> = {}) => new MissionRunner({executionGate: testExecutionGate(), store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${c.dataDir}-sec`).options, ...extra});
const queueRuns = (c: Ctx, pair: ExecutorPair) => c.missionIds.map(missionId => c.store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}));
const get = (c: Ctx, runId: string) => c.store.getRun({tenantId: "tA"}, runId)!;
// implementer sarmalayıcı: aynı anda içerideki çağrı sayısını izler; barrier>0 ise o kadar çağrı birlikte içeri girene kadar bekler (deterministik eşzamanlılık kanıtı, süre tahmini yok).
function tracked(pair: ExecutorPair, barrier = 0) {
  const st = {active: 0, maxActive: 0, arrived: 0, barrierTimedOut: false}; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const implement = async (w: string, s: MissionSpec, ctx: {timeoutMs: number; shouldAbort?: () => boolean}) => {
    st.active += 1; st.maxActive = Math.max(st.maxActive, st.active); st.arrived += 1;
    if (barrier > 0) { if (st.arrived >= barrier) release(); await Promise.race([gate, new Promise<void>(r => setTimeout(() => { st.barrierTimedOut = true; r(); }, 20_000))]); }
    try { return await pair.implementer.implement(w, s, ctx); } finally { st.active -= 1; }
  };
  return {st, pair: {...pair, implementer: {...pair.implementer, implement}} as ExecutorPair};
}

describe("LANE-C MissionRunner claim cap (maxConcurrentRuns)", () => {
  it("default cap 1: a queued second run gets NO lease while the first runs longer than the lease TTL, so it is never fenced or recovered; the next tick claims it", { timeout: T }, async () => {
    const c = setup(2); const fake = new FakeExecutors(script(2500)); const pair = fake.pair();
    const [r1, r2] = queueRuns(c, pair);
    const runner = mkRunner(c, pair, {leaseTtlMs: 1000});
    const t1 = await runner.tick();
    expect(t1.claimed).toEqual([r1.runId]);
    expect(t1.deferred).toEqual([r2.runId]);
    expect(t1.fenced).toEqual([]);
    expect(t1.recovered).toEqual([]);
    expect(get(c, r1.runId).status).toBe("AWAITING_APPROVAL");
    expect(get(c, r2.runId)).toMatchObject({status: "QUEUED", leaseId: null, attempt: 0});
    expect(fake.calls.implement).toBe(1);
    const t2 = await runner.tick();
    expect(t2).toMatchObject({claimed: [r2.runId], deferred: [], fenced: [], recovered: []});
    expect(get(c, r2.runId).status).toBe("AWAITING_APPROVAL");
    expect(fake.calls).toEqual({implement: 2, review: 2});
  });

  it("cap 2: two queued runs really run together (both implementer calls in flight at once); a third waits; cap 1 never overlaps", { timeout: T }, async () => {
    const c = setup(3); const fake = new FakeExecutors(script()); const t = tracked(fake.pair(), 2);
    const runs = queueRuns(c, t.pair);
    const t1 = await mkRunner(c, t.pair, {maxConcurrentRuns: 2}).tick();
    expect(t1.claimed).toHaveLength(2);
    expect(t1.deferred).toEqual([runs[2].runId]);
    expect(t.st.barrierTimedOut).toBe(false);
    expect(t.st.maxActive).toBe(2);
    expect(runs.slice(0, 2).map(r => get(c, r.runId).status)).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
    expect(get(c, runs[2].runId).status).toBe("QUEUED");

    const c1 = setup(2); const f1 = new FakeExecutors(script()); const t1b = tracked(f1.pair());
    queueRuns(c1, t1b.pair);
    const runner1 = mkRunner(c1, t1b.pair);
    await runner1.tick(); await runner1.tick();
    expect(t1b.st.maxActive).toBe(1);
    expect(f1.calls.implement).toBe(2);
  });

  it("stale-lease recovery respects the cap as well: with two expired leases and cap 1, one run is taken over and the other is deferred", { timeout: T }, async () => {
    const c = setup(2); const fake = new FakeExecutors(script()); const pair = fake.pair();
    const [r1, r2] = queueRuns(c, pair);
    const first = await mkRunner(c, pair, {maxConcurrentRuns: 2, maxStepsPerTick: 0}).tick(); // both leased, no step executed
    expect(first.claimed).toEqual([r1.runId, r2.runId]);
    expect([get(c, r1.runId).status, get(c, r2.runId).status]).toEqual(["LEASED", "LEASED"]);
    c.clock.skewMs = 3_600_000; // one hour later (store and runner clock): both leases are expired
    const later = await mkRunner(c, pair, {maxConcurrentRuns: 1, maxStepsPerTick: 0, now: () => Date.now() + c.clock.skewMs}).tick();
    expect(later.recovered).toEqual([r1.runId]);
    expect(later.deferred).toEqual([r2.runId]);
  });

  it("an invalid cap is a construction error (never silently 1); the default is 1", () => {
    const c = setup(0); const pair = new FakeExecutors(script()).pair();
    for (const bad of [0, -1, 1.5, 17, Number.NaN, "2" as unknown as number]) expect(() => mkRunner(c, pair, {maxConcurrentRuns: bad})).toThrow("RUNNER_MAX_CONCURRENT_RUNS_INVALID");
    expect(() => mkRunner(c, pair)).not.toThrow();
    expect(() => mkRunner(c, pair, {maxConcurrentRuns: 16})).not.toThrow();
  });
});
