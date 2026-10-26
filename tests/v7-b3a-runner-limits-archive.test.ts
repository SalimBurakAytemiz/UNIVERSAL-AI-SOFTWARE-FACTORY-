// //TR: Bu test B3a mission runner'ının ikinci yarısıdır (2/2; ilk yarısı v7-b3a-runner.test.ts): atanmış rolün TaskLimits'inin runner tarafından uygulanması, run workspace arşiv + prune (varsayılan KAPALI) ve runner dışa aktarımları (effectiveTestCommand/repositoryPrecondition). Yardımcılar (setup/makeRepo/runner...) bölmeyi mekanik tutmak için ilk dosyadan kasıtlı olarak kopyalanmıştır; iki dosya Windows'ta paralel koşar (~215 sn her biri, bölmeden önce tek dosya 411-428 sn).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate} from "./support/test-sandbox.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (tamper testi için geçerli hash zinciri üretir)
import {sha256 as sha256Untyped} from "../automation/lib/atomic-json.mjs";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner, effectiveTestCommand, repositoryPrecondition} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {FakeScript, MissionSpec} from "../core/workos/executors.js";
import {RUN_STATUSES, TERMINAL_RUN_STATUSES} from "../core/workos/run-state.js";
import {effectiveLimits} from "../core/agents/role-execution.js";
import {ProjectStudio} from "../core/workos/project-studio.js";
import {RunWorkspaceArchiver, retentionMsFromEnv, recordedCommitSet, hasSecretFinding, RUN_ARCHIVE_RECORD} from "../core/workos/run-archive.js";
import type {ArchiveStudioPort, ArchiveStorePort} from "../core/workos/run-archive.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import type {WorkRun} from "../core/workos/types.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const sha256 = sha256Untyped as (v: unknown) => string;
const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 120_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b3a-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const TEST_SCRIPT = `import fs from "node:fs";\nconst v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";\nconsole.log("feature=" + v);\nprocess.exit(v === "ok" ? 0 : 1);\n`;
function makeRepo(id: string): {repo: string; head: string} {
  const repo = path.join(tmp, `src-${id}`);
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
  fs.writeFileSync(path.join(repo, "README.txt"), "base\n");
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  return {repo, head: git(repo, ["rev-parse", "HEAD"])};
}
// Gerçek bir secret dosyası repo'da bulunmasın diye değer çalışma anında parçalardan kurulur.
const FAKE_AWS = ["AK", "IA", "Q7ZX3MPLW2RT5VB9"].join("");

interface Ctx { store: WorkOsStore; dataDir: string; runtime: string; stopFile: string; repo: string; head: string; missionId: string; projectId: string }
function setup(tenantId = "tA", opts: {url?: boolean; testCommand?: string[] | null; clock?: {skewMs: number}; virtualClock?: {ms: number}} = {}): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const {repo, head} = makeRepo(id);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `runtime-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  // //TR: virtualClock: store saati YALNIZ testin ilerlettiği sanal zamandır (gerçek süre/yavaş runner lease süresini etkilemez); clock: gerçek zaman + sabit kayma.
  const store = new WorkOsStore(dataDir, opts.virtualClock ? {now: () => opts.virtualClock!.ms} : opts.clock ? {now: () => Date.now() + opts.clock!.skewMs} : {});
  const tc = opts.testCommand === null ? undefined : (opts.testCommand ?? ["node", "test.mjs"]);
  const p = store.createProject({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: opts.url ? {url: "https://example.invalid/r.git"} : {path: repo}, ...(tc ? {testCommand: tc} : {})});
  const m = store.createMission({tenantId, projectId: p.projectId, title: "Add feature", objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId}, m.missionId, to, "test", "FOUNDER_LOCAL");
  return {store, dataDir, runtime, stopFile: path.join(runtime, "GLOBAL_STOP.json"), repo, head, missionId: m.missionId, projectId: p.projectId};
}
const okScript = (extra: Partial<FakeScript> = {}): FakeScript => ({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"}), ...extra});
function runner(c: Ctx, fake: FakeExecutors, extra: Partial<RunnerOptions> = {}): MissionRunner {
  return new MissionRunner({executionGate: testExecutionGate(), store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: fake.pair(), retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${c.dataDir}-sec`).options, ...extra});
}
const start = (c: Ctx, fake: FakeExecutors, tenantId = "tA") => {
  const p = fake.pair();
  return c.store.createRun({tenantId, missionId: c.missionId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
};
const runOf = (c: Ctx, id: string, tenantId = "tA") => c.store.getRun({tenantId}, id)!;
const missionOf = (c: Ctx, tenantId = "tA") => c.store.getMission({tenantId}, c.missionId)!;
const journal = (c: Ctx) => fs.readFileSync(path.join(c.dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const kinds = (r: WorkRun) => r.evidence.map(e => e.kind);

describe("LANE-C bound role TaskLimits are enforced by the runner (never loosened, role-less runs unchanged)", () => {
  const roleRun = (c: Ctx, fake: FakeExecutors, roleId: string | null) => { const p = fake.pair(); return c.store.createRun({tenantId: "tA", missionId: c.missionId, roleId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}); };
  const manyFiles = (n: number, tag = "f") => Object.fromEntries(Array.from({length: n}, (_, i) => [`gen/${tag}-${i}.txt`, "x\n"]));
  const seenTimeouts = (fake: FakeExecutors, seen: number[]) => { const p = fake.pair(); return {...p, implementer: {...p.implementer, implement: (w: string, s: MissionSpec, ctx: {timeoutMs: number; shouldAbort?: () => boolean}) => { seen.push(ctx.timeoutMs); return p.implementer.implement(w, s, ctx); }}}; };

  it("effectiveLimits only tightens: lowest of run default and role limit; null limits change nothing", () => {
    const l = {maxCycles: 2, timeoutMs: 3_600_000, maxFilesWritten: 100};
    expect(effectiveLimits(null, {maxRemediations: 2, executorTimeoutMs: 7})).toEqual({maxRemediations: 2, executorTimeoutMs: 7, maxFilesWritten: null, cycleCapped: false});
    expect(effectiveLimits(l, {maxRemediations: 2, executorTimeoutMs: 9_000_000})).toEqual({maxRemediations: 1, executorTimeoutMs: 3_600_000, maxFilesWritten: 100, cycleCapped: true});
    expect(effectiveLimits(l, {maxRemediations: 0, executorTimeoutMs: 60_000})).toEqual({maxRemediations: 0, executorTimeoutMs: 60_000, maxFilesWritten: 100, cycleCapped: false});
    expect(effectiveLimits({...l, maxCycles: 3}, {maxRemediations: 2, executorTimeoutMs: 1_000})).toMatchObject({maxRemediations: 2, cycleCapped: false});
  });

  it("the bound implementer limits equal the runner's 60 min executor default, so enforcement does not shorten real runs", () => {
    for (const id of ["UASCO-0085", "UASCO-0313"]) expect(FIRST_DELIVERY_BINDINGS.find(b => b.roleId === id)!.limits.timeoutMs).toBe(60 * 60_000);
  });

  it("maxCycles: tester (2 cycles) is stopped after 1 remediation as TASK_LIMIT_MAX_CYCLES; developer (3) and role-less keep the run budget; a lower run budget is never raised", { timeout: T }, async () => {
    const bad = () => new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "bad\n"}})}));
    const cases: Array<[string | null, number, string, number]> = [
      ["UASCO-0313", 2, "TESTS_FAILED_TASK_LIMIT_MAX_CYCLES_EXHAUSTED", 2],
      ["UASCO-0085", 2, "TESTS_FAILED_REMEDIATION_EXHAUSTED", 3],
      [null, 2, "TESTS_FAILED_REMEDIATION_EXHAUSTED", 3],
      ["UASCO-0085", 0, "TESTS_FAILED_REMEDIATION_EXHAUSTED", 1],
      ["UASCO-0313", 0, "TESTS_FAILED_REMEDIATION_EXHAUSTED", 1]
    ];
    for (const [roleId, maxRemediations, reason, implementCalls] of cases) {
      const c = setup(); const fake = bad();
      const r = roleRun(c, fake, roleId);
      await runner(c, fake, {maxRemediations}).tick();
      const run = runOf(c, r.runId);
      expect([roleId, maxRemediations, run.status, run.reason, fake.calls.implement]).toEqual([roleId, maxRemediations, "BLOCKED", reason, implementCalls]);
    }
  });

  it("timeoutMs: the executor gets min(run default, role limit): a role cannot raise a lower run timeout; role-less runs get the run default", { timeout: T }, async () => {
    for (const [roleId, runTimeout, expected] of [["UASCO-0085", 9_000_000, 3_600_000], ["UASCO-0313", 9_000_000, 3_600_000], ["UASCO-0085", 60_000, 60_000], [null, 9_000_000, 9_000_000]] as const) {
      const c = setup(); const fake = new FakeExecutors(okScript()); const seen: number[] = [];
      const r = roleRun(c, fake, roleId);
      await runner(c, fake, {executorTimeoutMs: runTimeout, executors: seenTimeouts(fake, seen)}).tick();
      expect(runOf(c, r.runId).status).toBe("AWAITING_APPROVAL");
      expect([roleId, runTimeout, seen]).toEqual([roleId, runTimeout, [expected]]);
    }
  });

  it("REVIEW timeoutMs: bound security-reviewer gets min(run default, 60 min limit); a role cannot raise a lower run timeout; role-less runs get the run default; the reviewer stays read-only", { timeout: T }, async () => {
    expect(FIRST_DELIVERY_BINDINGS.find(b => b.roleId === "UASCO-0252")!.limits).toEqual({maxCycles: 1, timeoutMs: 60 * 60_000, maxFilesWritten: 0});
    for (const [roleId, runTimeout, expected] of [["UASCO-0085", 9_000_000, 3_600_000], ["UASCO-0085", 60_000, 60_000], [null, 9_000_000, 9_000_000]] as const) {
      const c = setup(); const fake = new FakeExecutors(okScript()); const seen: number[] = [];
      const p = fake.pair();
      const executors = {...p, reviewer: {...p.reviewer, review: (clone: string, s: MissionSpec, d: string, ctx: {timeoutMs: number; shouldAbort?: () => boolean}) => { seen.push(ctx.timeoutMs); return p.reviewer.review(clone, s, d, ctx); }}};
      const r = roleRun(c, fake, roleId);
      await runner(c, fake, {executorTimeoutMs: runTimeout, executors}).tick();
      expect(runOf(c, r.runId).status).toBe("AWAITING_APPROVAL");
      expect([roleId, runTimeout, seen]).toEqual([roleId, runTimeout, [expected]]);
    }
  });

  it("REVIEW maxCycles 1: a BLOCKED review is one pass per REVIEW step; the remediation loop stays bounded by the implementer's role limit", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript({review: () => ({verdict: "BLOCKED", findings: [{severity: "HIGH", title: "x"}]})}));
    const r = roleRun(c, fake, "UASCO-0313");
    await runner(c, fake, {maxRemediations: 5}).tick();
    const run = runOf(c, r.runId);
    // tester maxCycles 2 -> 1 remediation: 2 implement passes, exactly 1 review per pass
    expect([run.status, fake.calls.implement, fake.calls.review]).toEqual(["BLOCKED", 2, 2]);
  });

  it("maxFilesWritten: exactly the limit passes, one more is BLOCKED before VERIFY/REVIEW; the count is cumulative from the base across remediation cycles; role-less runs have no file limit", { timeout: T }, async () => {
    // tester limit = 100: feature.txt + 99 files = 100 passes, + 100 files = 101 is blocked
    for (const [n, ok] of [[99, true], [100, false]] as const) {
      const c = setup(); const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n", ...manyFiles(n)}})}));
      const r = roleRun(c, fake, "UASCO-0313");
      await runner(c, fake).tick();
      const run = runOf(c, r.runId);
      if (ok) expect(run.status).toBe("AWAITING_APPROVAL");
      else {
        expect(run.status).toBe("BLOCKED");
        expect(run.reason).toBe("TASK_LIMIT_FILES_EXCEEDED:101>100");
        expect(run.step).toBe("IMPLEMENT"); // blocked by the IMPLEMENT gate itself, not at the start of a later step
        expect(kinds(run)).toEqual(expect.arrayContaining(["IMPLEMENT", "AGENT_TRACE"]));
        expect(kinds(run)).not.toContain("VERIFY_TESTS");
        expect(fake.calls.review).toBe(0);
        expect(missionOf(c).status).toBe("BLOCKED");
      }
    }
    // cumulative: cycle 0 writes 60 files with a failing test, cycle 1 fixes it with 60 more -> 121 from the base > 100
    const c = setup(); const fake = new FakeExecutors(okScript({implement: n => ({files: {"feature.txt": n === 1 ? "bad\n" : "ok\n", ...manyFiles(60, `c${n}`)}})}));
    const r = roleRun(c, fake, "UASCO-0313");
    await runner(c, fake).tick();
    const run = runOf(c, r.runId);
    expect([run.status, run.reason, fake.calls.implement]).toEqual(["BLOCKED", "TASK_LIMIT_FILES_EXCEEDED:121>100", 2]);
    // role-less: no limit applies
    const c2 = setup(); const fake2 = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n", ...manyFiles(150)}})}));
    const r2 = roleRun(c2, fake2, null);
    await runner(c2, fake2).tick();
    expect(runOf(c2, r2.runId).status).toBe("AWAITING_APPROVAL");
  });
});

describe("LANE-C run workspace archive + prune (default OFF; archive first, verify, then prune after retention)", () => {
  interface MCtx { store: WorkOsStore; studio: ProjectStudio; dataDir: string; stopFile: string; projectId: string; missionId: string }
  const BASE_PROJECT = {tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", testCommand: ["node", "test.mjs"]};
  function addMission(c: MCtx): string {
    const m = c.store.createMission({tenantId: "tA", projectId: c.projectId, title: "Add feature", objective: "feature.txt must say ok", acceptanceCriteria: ["x"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) c.store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    return m.missionId;
  }
  function managedSetup(kind: "managed" | "external" = "managed"): MCtx {
    const id = crypto.randomBytes(4).toString("hex");
    const dataDir = path.join(tmp, `adata-${id}`), runtime = path.join(tmp, `art-${id}`);
    fs.mkdirSync(runtime, {recursive: true});
    const studio = new ProjectStudio({dataDir, envPolicyFile: ENV_POLICY});
    const store = new WorkOsStore(dataDir);
    const p = kind === "managed" ? store.createProject({...BASE_PROJECT, prepareManagedRepository: pid => studio.createTemplateRepository(pid, "empty", "P")}) : store.createProject({...BASE_PROJECT, repository: {path: makeRepo(id).repo}});
    const c = {store, studio, dataDir, stopFile: path.join(runtime, "GLOBAL_STOP.json"), projectId: p.projectId, missionId: ""};
    c.missionId = addMission(c);
    return c;
  }
  interface RunOpts { implement?: (n: number) => {files: Record<string, string>}; review?: "CLEAN" | "BLOCKED"; roleId?: string; maxRemediations?: number; missionId?: string }
  const okFiles = (extra: Record<string, string> = {}) => ({files: {"feature.txt": "ok\n", "test.mjs": "process.exit(0);\n", ...extra}});
  async function runWith(c: MCtx, o: RunOpts = {}): Promise<WorkRun> {
    const fake = new FakeExecutors(okScript({implement: o.implement ?? (() => okFiles()), review: () => (o.review ?? "BLOCKED") === "CLEAN" ? ({verdict: "CLEAN"}) : ({verdict: "BLOCKED", findings: [{severity: "P1", title: "x"}]})}));
    const pr = fake.pair();
    const created = c.store.createRun({tenantId: "tA", missionId: o.missionId ?? c.missionId, ...(o.roleId ? {roleId: o.roleId} : {}), executor: {implementer: pr.implementer.identity, reviewer: pr.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    await new MissionRunner({executionGate: testExecutionGate(), store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: pr, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, maxRemediations: o.maxRemediations ?? 0, security: fakeSecurity(`${c.dataDir}-sec`).options}).tick();
    return c.store.getRun({tenantId: "tA"}, created.runId)!;
  }
  const blockedWithCommit = (c: MCtx) => runWith(c, {review: "BLOCKED"});
  const runDir = (c: MCtx, r: WorkRun) => path.join(c.dataDir, "runs", r.runId);
  const workDir = (c: MCtx, r: WorkRun) => path.join(runDir(c, r), "work");
  const archiver = (c: MCtx, retentionMs: number, over: Partial<ConstructorParameters<typeof RunWorkspaceArchiver>[0]> = {}) => new RunWorkspaceArchiver({dataDir: c.dataDir, store: c.store, studio: c.studio, retentionMs, ...over});
  const repoOf = (c: MCtx) => c.studio.managedRepoRoot(c.store.getProject({tenantId: "tA"}, c.projectId)!);
  const refList = (c: MCtx) => git(repoOf(c), ["for-each-ref", "--format=%(refname) %(objectname)", "refs/uasco"]);
  const projectOf = (c: MCtx) => c.store.getProject({tenantId: "tA"}, c.projectId)!;

  it("a terminal managed run is archived (delivery ref + per-commit ref), every archive is verified, then derived clones and runs/<id>/work are removed; logs, security reports, record and the Studio git view survive", { timeout: T }, async () => {
    const c = managedSetup(); const run = await blockedWithCommit(c);
    expect(run.status).toBe("BLOCKED");
    expect(run.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.existsSync(workDir(c, run))).toBe(true);
    const clones = fs.readdirSync(runDir(c, run)).filter(n => /^(scan|review|security)-c\d+$/.test(n));
    expect(clones.length).toBeGreaterThan(0); // the runner leaves full derived clones behind
    const rep = archiver(c, 0).sweep();
    expect(rep).toEqual({results: [{runId: run.runId, status: "PRUNED", archiveRef: `refs/uasco/runs/${run.runId}`}], deferred: 0});
    expect(fs.existsSync(workDir(c, run))).toBe(false);
    expect(fs.readdirSync(runDir(c, run)).filter(n => /^(scan|review|security)-c\d+$/.test(n))).toEqual([]);
    expect(fs.existsSync(path.join(runDir(c, run), "logs"))).toBe(true); // evidence logs are never pruned
    expect(fs.existsSync(path.join(runDir(c, run), "security"))).toBe(true); // security reports are never pruned
    const sha = run.headSha!;
    expect(refList(c).split("\n").sort()).toEqual([`refs/uasco/run-commits/${run.runId}/${sha} ${sha}`, `refs/uasco/runs/${run.runId} ${sha}`].sort());
    expect(git(repoOf(c), ["show", `${sha}:feature.txt`])).toBe("ok"); // the commit's content is readable from the managed repo alone
    const rec = JSON.parse(fs.readFileSync(path.join(runDir(c, run), RUN_ARCHIVE_RECORD), "utf8"));
    const {digest, ...body} = rec;
    expect(rec).toMatchObject({schemaVersion: 1, runId: run.runId, status: "BLOCKED", headSha: sha});
    expect(rec.commits).toEqual([{sha, ref: `refs/uasco/run-commits/${run.runId}/${sha}`}, {sha, ref: `refs/uasco/runs/${run.runId}`}]);
    expect(typeof rec.archivedAt).toBe("string"); expect(typeof rec.prunedAt).toBe("string");
    expect(digest).toBe(crypto.createHash("sha256").update(JSON.stringify(body, null, 2)).digest("hex"));
    expect(JSON.stringify(c.studio.gitLog(projectOf(c), [run], 5, run.runId))).toContain(sha); // the run's commits still resolve after the workspace is gone
    expect(archiver(c, 0).sweep()).toEqual({results: [], deferred: 0}); // idempotent: nothing left to do
  });

  it("commits that only the run's evidence names are archived too (headSha is NOT the only commit): a file-limit block leaves headSha null and a failed second cycle leaves headSha behind", { timeout: T }, async () => {
    const many = (n: number, tag: string) => Object.fromEntries(Array.from({length: n}, (_, i) => [`gen/${tag}-${i}.txt`, `${i}\n`]));
    // (1) tester limit is 100 files: 101 files => BLOCKED TASK_LIMIT_FILES_EXCEEDED with headSha null, but IMPLEMENT evidence names the commit
    const c1 = managedSetup(); const r1 = await runWith(c1, {roleId: "UASCO-0313", review: "CLEAN", implement: () => okFiles(many(100, "f"))});
    expect([r1.status, r1.reason, r1.headSha]).toEqual(["BLOCKED", "TASK_LIMIT_FILES_EXCEEDED:102>100", null]);
    const produced1 = recordedCommitSet(r1);
    expect(produced1).toHaveLength(1);
    expect(git(workDir(c1, r1), ["rev-parse", "HEAD"])).toBe(produced1[0]);
    expect(() => git(repoOf(c1), ["cat-file", "-e", `${produced1[0]}^{commit}`])).toThrow(); // the commit exists ONLY in the workspace
    expect(archiver(c1, 0).sweep().results.map(r => r.status)).toEqual(["PRUNED"]);
    expect(fs.existsSync(workDir(c1, r1))).toBe(false);
    expect(git(repoOf(c1), ["cat-file", "-t", produced1[0]])).toBe("commit"); // ... and now in the managed repo
    expect(refList(c1)).toBe(`refs/uasco/run-commits/${r1.runId}/${produced1[0]} ${produced1[0]}`);
    // (2) cycle 0 fails its tests (headSha = cycle-0 commit), cycle 1 is blocked by the cumulative file limit: both commits are in the evidence
    const c2 = managedSetup(); const r2 = await runWith(c2, {roleId: "UASCO-0313", review: "CLEAN", maxRemediations: 2, implement: n => ({files: {"feature.txt": "ok\n", "test.mjs": n === 1 ? "process.exit(1);\n" : "process.exit(0);\n", ...many(60, `c${n}`)}})});
    expect(r2.status).toBe("BLOCKED");
    expect(r2.reason).toMatch(/^TASK_LIMIT_FILES_EXCEEDED/);
    const set2 = recordedCommitSet(r2);
    expect(set2).toHaveLength(2);
    expect(git(workDir(c2, r2), ["rev-parse", "HEAD"])).toBe(set2[1] === r2.headSha ? set2[0] : set2[1]); // workspace HEAD is the newer commit, headSha is not
    archiver(c2, 0).sweep();
    expect(fs.existsSync(workDir(c2, r2))).toBe(false);
    for (const sha of set2) expect(git(repoOf(c2), ["cat-file", "-t", sha])).toBe("commit");
  });

  it("retention: nothing is archived or removed before the retention period; after it the same run is pruned", { timeout: T }, async () => {
    const c = managedSetup(); const run = await blockedWithCommit(c);
    expect(archiver(c, 3_600_000).sweep().results).toEqual([{runId: run.runId, status: "KEPT_RETENTION"}]);
    expect(fs.existsSync(workDir(c, run))).toBe(true);
    expect(refList(c)).toBe(""); // not even archived yet
    expect(archiver(c, 3_600_000, {now: () => Date.now() + 2 * 3_600_000}).sweep().results.map(r => r.status)).toEqual(["PRUNED"]);
    expect(fs.existsSync(workDir(c, run))).toBe(false);
  });

  it("never touches a run that is still open, a user-owned repository, or a project that is unknown; a mixed project prunes only its terminal run", { timeout: T }, async () => {
    const c = managedSetup();
    const terminal = await blockedWithCommit(c);
    const awaiting = await runWith(c, {review: "CLEAN", missionId: addMission(c)});
    expect([terminal.status, awaiting.status]).toEqual(["BLOCKED", "AWAITING_APPROVAL"]);
    const rep = archiver(c, 0).sweep();
    expect(rep.results.sort((a, b) => a.runId.localeCompare(b.runId))).toEqual([{runId: terminal.runId, status: "PRUNED", archiveRef: `refs/uasco/runs/${terminal.runId}`}, {runId: awaiting.runId, status: "KEPT_NOT_TERMINAL", detail: "AWAITING_APPROVAL"}].sort((a, b) => a.runId.localeCompare(b.runId)));
    expect(fs.existsSync(workDir(c, terminal))).toBe(false);
    expect(fs.existsSync(workDir(c, awaiting))).toBe(true);
    expect(refList(c)).not.toContain(awaiting.runId);
    // a user-owned repository is never written and its workspace is never removed
    const x = managedSetup("external"); const ext = await blockedWithCommit(x);
    const userRepo = x.store.getProject({tenantId: "tA"}, x.projectId)!.repository!.path!;
    const before = git(userRepo, ["for-each-ref"]) + git(userRepo, ["count-objects", "-v"]);
    expect(archiver(x, 0).sweep().results).toEqual([{runId: ext.runId, status: "KEPT_NOT_MANAGED"}]);
    expect(fs.existsSync(workDir(x, ext))).toBe(true);
    expect(git(userRepo, ["for-each-ref"]) + git(userRepo, ["count-objects", "-v"])).toBe(before);
    // unknown project (store returns nothing) keeps the workspace
    const stubStore: ArchiveStorePort = {engineListRuns: () => [terminal], getProject: () => undefined};
    fs.mkdirSync(workDir(c, terminal), {recursive: true});
    expect(archiver(c, 0, {store: stubStore}).sweep().results).toEqual([{runId: terminal.runId, status: "KEPT_PROJECT_UNKNOWN"}]);
    expect(fs.existsSync(workDir(c, terminal))).toBe(true);
  });

  it("only terminal statuses ever reach the archive/prune step: a table over every run status", { timeout: T }, async () => {
    const c = managedSetup(); const base = await blockedWithCommit(c);
    const { RUN_STATUSES, TERMINAL_RUN_STATUSES } = await import("../core/workos/run-state.js");
    const calls: string[] = [];
    const studio: ArchiveStudioPort = {managedRepoRoot: () => "/managed", archiveRunCommit: (_p, r) => { calls.push(r.runId); }, isRunCommitArchived: () => true};
    const runs: WorkRun[] = RUN_STATUSES.map((status, i) => ({...base, runId: `run_${i.toString(16).padStart(24, "0")}`, status}));
    for (const r of runs) fs.mkdirSync(path.join(c.dataDir, "runs", r.runId, "work"), {recursive: true});
    const stub: ArchiveStorePort = {engineListRuns: () => runs, getProject: () => projectOf(c)};
    const rep = new RunWorkspaceArchiver({dataDir: c.dataDir, store: stub, studio, retentionMs: 0, maxRunsPerSweep: 100}).sweep();
    const terminalIds = runs.filter(r => TERMINAL_RUN_STATUSES.includes(r.status)).map(r => r.runId);
    expect(terminalIds.length).toBeGreaterThan(3);
    expect([...new Set(calls)].sort()).toEqual([...terminalIds].sort()); // archive is attempted for terminal runs only (two refs per run)
    expect(calls).toHaveLength(terminalIds.length * 2);
    for (const r of runs) {
      const terminal = terminalIds.includes(r.runId);
      expect([r.status, fs.existsSync(path.join(c.dataDir, "runs", r.runId, "work"))]).toEqual([r.status, !terminal]);
    }
    expect(rep.results.filter(r => r.status === "KEPT_NOT_TERMINAL")).toHaveLength(runs.length - terminalIds.length);
  });

  it("an archive that fails or cannot be verified keeps the workspace and writes no record; failures back off instead of being retried every sweep", { timeout: T }, async () => {
    const c = managedSetup(); const run = await blockedWithCommit(c);
    let archiveCalls = 0;
    const failing: ArchiveStudioPort = {managedRepoRoot: p => c.studio.managedRepoRoot(p), archiveRunCommit: () => { archiveCalls += 1; throw Object.assign(new Error("boom"), {code: "DELIVERY_SOURCE_UNAVAILABLE"}); }, isRunCommitArchived: () => true};
    let clock = Date.now();
    const a = archiver(c, 0, {studio: failing, now: () => clock, retryBackoffMs: 60_000});
    expect(a.sweep().results).toEqual([{runId: run.runId, status: "KEPT_ARCHIVE_FAILED", detail: "DELIVERY_SOURCE_UNAVAILABLE"}]);
    expect(a.sweep().results).toEqual([{runId: run.runId, status: "KEPT_BACKOFF"}]);
    expect(archiveCalls).toBe(1); // not retried inside the backoff window
    clock += 61_000;
    expect(a.sweep().results[0].status).toBe("KEPT_ARCHIVE_FAILED");
    expect(archiveCalls).toBe(2);
    const unverified: ArchiveStudioPort = {managedRepoRoot: p => c.studio.managedRepoRoot(p), archiveRunCommit: (p, r, s, ref) => c.studio.archiveRunCommit(p, r, s, ref), isRunCommitArchived: () => false};
    expect(archiver(c, 0, {studio: unverified}).sweep().results.map(r => r.status)).toEqual(["KEPT_ARCHIVE_UNVERIFIED"]);
    expect(fs.existsSync(workDir(c, run))).toBe(true);
    expect(fs.existsSync(path.join(runDir(c, run), RUN_ARCHIVE_RECORD))).toBe(false);
  });

  it("the real verification (isRunCommitArchived) rejects: ref absent, ref at another commit, invalid sha/ref, wrong project, and a commit whose tree is missing from the managed repo", { timeout: T }, async () => {
    const c = managedSetup(); const run = await blockedWithCommit(c); const sha = run.headSha!; const project = projectOf(c);
    const ref = `refs/uasco/run-commits/${run.runId}/${sha}`;
    expect(c.studio.isRunCommitArchived(project, run, sha, ref)).toBe(false); // ref absent
    c.studio.archiveRunCommit(project, run, sha, ref);
    expect(c.studio.isRunCommitArchived(project, run, sha, ref)).toBe(true);
    const root = repoOf(c), head = git(root, ["rev-parse", "HEAD"]);
    git(root, ["update-ref", ref, head]);
    expect(c.studio.isRunCommitArchived(project, run, sha, ref)).toBe(false); // ref points at another commit
    for (const bad of [{sha: "abc", ref}, {sha: "z".repeat(40), ref}, {sha, ref: "refs/heads/main"}, {sha, ref: `refs/uasco/run-commits/${run.runId}/${"0".repeat(40)}`}, {sha, ref: `refs/uasco/runs/other`}]) {
      expect(c.studio.isRunCommitArchived(project, run, bad.sha, bad.ref)).toBe(false);
      expect(() => c.studio.archiveRunCommit(project, run, bad.sha, bad.ref)).toThrow("ARCHIVE_SOURCE_UNAVAILABLE");
    }
    expect(c.studio.isRunCommitArchived(project, {...run, projectId: "prj_other"}, sha, ref)).toBe(false);
    expect(() => c.studio.archiveRunCommit(project, {...run, projectId: "prj_other"}, sha, ref)).toThrow("ARCHIVE_SOURCE_UNAVAILABLE");
    // a loose commit object whose tree does not exist: the ref resolves to it but connectivity fails
    const orphan = String(spawnGitSync(root, ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], {input: `tree ${"1".repeat(40)}\nauthor A <a@x.invalid> 1 +0000\ncommitter A <a@x.invalid> 1 +0000\n\nm\n`}).stdout).trim();
    expect(orphan).toMatch(/^[0-9a-f]{40}$/);
    const oref = `refs/uasco/run-commits/${run.runId}/${orphan}`;
    git(root, ["update-ref", oref, orphan]);
    expect(c.studio.isRunCommitArchived(project, run, orphan, oref)).toBe(false);
  });

  it("a run with a secret finding is never archived and its workspace is never pruned (its objects must not reach later workspace clones)", { timeout: T }, async () => {
    const c = managedSetup();
    const key = ["AK", "IA", "Q7ZX3MPLW2RT5VB9"].join("");
    const run = await runWith(c, {implement: () => okFiles({"secrets.env": `aws=${key}\n`})});
    expect([run.status, run.reason]).toEqual(["BLOCKED", "SECRET_IN_DIFF"]);
    expect(hasSecretFinding(run)).toBe(true);
    expect(archiver(c, 0).sweep().results).toEqual([{runId: run.runId, status: "KEPT_SECRET_FINDING"}]);
    expect(fs.existsSync(workDir(c, run))).toBe(true);
    expect(refList(c)).toBe("");
    expect(() => git(repoOf(c), ["cat-file", "-e", `${run.headSha}^{commit}`])).toThrow(); // the secret-bearing commit never entered the managed repo
    expect(hasSecretFinding({...run, reason: "TESTS_FAILED", evidence: []})).toBe(false);
    expect(hasSecretFinding({...run, reason: "X", evidence: [{...run.evidence[0], secretHits: [{kind: "AWS_ACCESS_KEY", file: "a", line: 1}]}]})).toBe(true);
  });

  it.skipIf(process.platform === "win32")("a work path or derived clone that is a symlink is never followed or removed (targets outside the run stay intact)", { timeout: T }, async () => {
    const c = managedSetup(); const run = await blockedWithCommit(c);
    const outside = path.join(tmp, `outside-${run.runId}`); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "canary.txt"), "KEEP");
    const w = workDir(c, run); fs.renameSync(w, `${w}-real`); fs.symlinkSync(outside, w);
    expect(archiver(c, 0).sweep().results).toEqual([{runId: run.runId, status: "KEPT_UNSAFE_PATH"}]);
    expect(fs.readFileSync(path.join(outside, "canary.txt"), "utf8")).toBe("KEEP");
    expect(fs.lstatSync(w).isSymbolicLink()).toBe(true);
    // a derived clone replaced by a symlink: the prune refuses before touching work
    fs.unlinkSync(w); fs.renameSync(`${w}-real`, w);
    const clone = fs.readdirSync(runDir(c, run)).find(n => /^scan-c\d+$/.test(n))!;
    fs.rmSync(path.join(runDir(c, run), clone), {recursive: true, force: true}); fs.symlinkSync(outside, path.join(runDir(c, run), clone));
    expect(archiver(c, 0).sweep().results.map(r => r.status)).toEqual(["KEPT_PRUNE_FAILED"]);
    expect(fs.existsSync(w)).toBe(true);
    expect(fs.readFileSync(path.join(outside, "canary.txt"), "utf8")).toBe("KEEP");
  });

  it("a terminal run whose evidence names no commit has nothing to archive: its workspace is pruned after retention and the record says so", { timeout: T }, async () => {
    const c = managedSetup(); const run = await runWith(c, {roleId: "UASCO-0252"});
    expect([run.status, run.headSha, recordedCommitSet(run)]).toEqual(["BLOCKED", null, []]);
    expect(archiver(c, 0).sweep().results).toEqual([{runId: run.runId, status: "PRUNED_NO_COMMIT"}]);
    expect(fs.existsSync(workDir(c, run))).toBe(false);
    expect(refList(c)).toBe("");
    expect(JSON.parse(fs.readFileSync(path.join(runDir(c, run), RUN_ARCHIVE_RECORD), "utf8"))).toMatchObject({headSha: null, commits: [], archivedAt: null});
  });

  it("a failure after the workspace was removed does not leave a wrong record or a wrong report: the sweep reports PRUNED and the next sweep finalizes the record; a store failure never throws", { timeout: T }, async () => {
    const c = managedSetup(); const run = await blockedWithCommit(c);
    let calls = 0, broken = true;
    const now = () => { calls += 1; if (broken && calls === 3) throw new Error("clock failure after prune"); return Date.now() + 1000; }; // call 1 archivedAt, 2 retention check precedes; the third read is prunedAt
    const a = archiver(c, 0, {now});
    // calls: retention (1), archivedAt (2), prunedAt (3 -> throws after the workspace is gone)
    const rep = a.sweep();
    expect(rep.results.map(r => [r.status, r.detail])).toEqual([["PRUNED", "RECORD_FINALIZE_PENDING"]]);
    expect(fs.existsSync(workDir(c, run))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(runDir(c, run), RUN_ARCHIVE_RECORD), "utf8")).prunedAt).toBeNull();
    broken = false;
    expect(a.sweep().results).toEqual([{runId: run.runId, status: "RECORD_FINALIZED"}]);
    expect(typeof JSON.parse(fs.readFileSync(path.join(runDir(c, run), RUN_ARCHIVE_RECORD), "utf8")).prunedAt).toBe("string");
    expect(a.sweep().results).toEqual([]);
    const throwing: ArchiveStorePort = {engineListRuns: () => { throw new Error("store tampered"); }, getProject: () => undefined};
    expect(archiver(c, 0, {store: throwing}).sweep()).toEqual({results: [], deferred: 0, error: "STORE_UNAVAILABLE:store tampered"});
  });

  it("a sweep does bounded work: at most maxRunsPerSweep runs are archived/pruned per pass; the rest are deferred and picked up by the next pass", { timeout: T }, async () => {
    const c = managedSetup();
    const r1 = await blockedWithCommit(c); const r2 = await runWith(c, {review: "BLOCKED", missionId: addMission(c)});
    const a = archiver(c, 0, {maxRunsPerSweep: 1});
    const first = a.sweep();
    expect(first.results.filter(r => r.status === "PRUNED")).toHaveLength(1);
    expect(first.deferred).toBe(1);
    const second = a.sweep();
    expect(second.results.filter(r => r.status === "PRUNED")).toHaveLength(1);
    expect(second.deferred).toBe(0);
    for (const r of [r1, r2]) expect(fs.existsSync(workDir(c, r))).toBe(false);
    expect(() => archiver(c, 0, {maxRunsPerSweep: 0})).toThrow("RUN_ARCHIVE_LIMITS_INVALID");
  });

  it("configuration is OFF unless UASCO_RUN_WORKSPACE_RETENTION_HOURS is an integer 1..8760; an invalid retention is a construction error", () => {
    expect(retentionMsFromEnv({})).toEqual({enabled: false, reason: "NOT_CONFIGURED"});
    expect(retentionMsFromEnv({UASCO_RUN_WORKSPACE_RETENTION_HOURS: ""})).toEqual({enabled: false, reason: "NOT_CONFIGURED"});
    expect(retentionMsFromEnv({UASCO_RUN_WORKSPACE_RETENTION_HOURS: "24"})).toEqual({enabled: true, retentionMs: 24 * 3_600_000});
    expect(retentionMsFromEnv({UASCO_RUN_WORKSPACE_RETENTION_HOURS: "8760"})).toEqual({enabled: true, retentionMs: 8760 * 3_600_000});
    for (const bad of ["0", "-1", "1.5", "abc", "08", "8761", "99999", " 5", "5h"]) expect([bad, retentionMsFromEnv({UASCO_RUN_WORKSPACE_RETENTION_HOURS: bad})]).toEqual([bad, {enabled: false, reason: "INVALID"}]);
    const c = managedSetup();
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => archiver(c, bad)).toThrow("RUN_ARCHIVE_RETENTION_INVALID");
  });
});

// //TR: LANE-C C-RUNNER-EXPORTS: runner'ın test-komutu önceliği ve depo/workspace önkoşulu saf fonksiyonlardır (readiness aynı kuralı içe aktarır). Davranış değişmedi: runner aynı fonksiyonları aynı noktada çağırır; her neden kodu hem saf fonksiyonda hem run BLOCK nedeninde doğrulanır.
describe("LANE-C runner exports: effectiveTestCommand and repositoryPrecondition (pure; the runner uses the very same functions)", () => {
  const PID = "prj_" + "a".repeat(24), OTHER = "prj_" + "b".repeat(24);
  const mkdir = (...p: string[]) => { const d = path.join(...p); fs.mkdirSync(d, {recursive: true}); return d; };

  it("effectiveTestCommand: the mission's command beats the project's (?? not ||: an empty mission array still wins); a missing side falls through; both missing is undefined; inputs are never mutated or copied", () => {
    const m = ["node", "m.mjs"], p = ["node", "p.mjs"];
    const table: Array<[string, {testCommand?: string[]} | undefined, {testCommand?: string[]} | undefined, string[] | undefined]> = [
      ["mission wins", {testCommand: m}, {testCommand: p}, m], ["mission only", {testCommand: m}, {}, m], ["project only", {}, {testCommand: p}, p],
      ["project when mission command absent", {testCommand: undefined}, {testCommand: p}, p], ["project when mission undefined", undefined, {testCommand: p}, p],
      ["mission when project undefined", {testCommand: m}, undefined, m], ["both empty objects", {}, {}, undefined], ["both undefined", undefined, undefined, undefined],
      ["empty mission array still wins", {testCommand: []}, {testCommand: p}, []], ["empty project array is returned when mission has none", {}, {testCommand: []}, []]
    ];
    for (const [label, mi, pr, expected] of table) expect([label, effectiveTestCommand(mi, pr)]).toEqual([label, expected]);
    expect(effectiveTestCommand({testCommand: m}, {testCommand: p})).toBe(m); // same reference: no copy
    expect(m).toEqual(["node", "m.mjs"]); expect(p).toEqual(["node", "p.mjs"]);
  });

  it("repositoryPrecondition: every reason code, in the runner's order, plus both ok paths; it is pure (writes nothing under the data dir)", () => {
    const dataDir = mkdir(tmp, "data"), outside = mkdir(tmp, "outside-repo"), managedDir = mkdir(dataDir, "projects", PID, "repo"), otherManaged = mkdir(dataDir, "projects", OTHER, "repo");
    const file = path.join(tmp, "a-file.txt"); fs.writeFileSync(file, "x");
    const before = fs.readdirSync(dataDir, {recursive: true}).map(String).sort();
    // //TR: Windows'ta tmp yolu 8.3 kısa ad (RUNNER~1) olabilir; fonksiyon kanonik yolu döndürür, beklenen değer de gerçek yoldan (native) kurulur.
    const real = (x: string) => fs.realpathSync.native(x);
    const cases: Array<[string, Parameters<typeof repositoryPrecondition>[0], ReturnType<typeof repositoryPrecondition>]> = [
      ["no repository at all", {projectId: PID}, {ok: false, reason: "REPOSITORY_NOT_CONFIGURED"}],
      ["empty repository object", {projectId: PID, repository: {}}, {ok: false, reason: "REPOSITORY_NOT_CONFIGURED"}],
      ["empty path, no url", {projectId: PID, repository: {path: ""}}, {ok: false, reason: "REPOSITORY_NOT_CONFIGURED"}],
      ["url only", {projectId: PID, repository: {url: "https://example.invalid/r.git"}}, {ok: false, reason: "REMOTE_REPO_NOT_SUPPORTED_YET"}],
      ["empty path with a url", {projectId: PID, repository: {path: "", url: "https://example.invalid/r.git"}}, {ok: false, reason: "REMOTE_REPO_NOT_SUPPORTED_YET"}],
      ["managed flag but a foreign path", {projectId: PID, repository: {path: outside, managed: true}}, {ok: false, reason: "REPOSITORY_NOT_MANAGED"}],
      ["managed flag pointing at another project's managed repo", {projectId: PID, repository: {path: otherManaged, managed: true}}, {ok: false, reason: "REPOSITORY_NOT_MANAGED"}],
      ["managed flag with a malformed project id", {projectId: "prj_x", repository: {path: managedDir, managed: true}}, {ok: false, reason: "REPOSITORY_NOT_MANAGED"}],
      ["unmanaged path inside the data dir", {projectId: PID, repository: {path: managedDir}}, {ok: false, reason: "REPOSITORY_PATH_FORBIDDEN"}],
      ["unmanaged path that contains the data dir", {projectId: PID, repository: {path: tmp}}, {ok: false, reason: "REPOSITORY_PATH_FORBIDDEN"}],
      ["unmanaged path equal to the data dir", {projectId: PID, repository: {path: dataDir}}, {ok: false, reason: "REPOSITORY_PATH_FORBIDDEN"}],
      ["unmanaged path that does not exist", {projectId: PID, repository: {path: path.join(outside, "missing")}}, {ok: false, reason: "REPOSITORY_PATH_NOT_FOUND"}],
      ["unmanaged path that is a file", {projectId: PID, repository: {path: file}}, {ok: false, reason: "REPOSITORY_PATH_NOT_FOUND"}],
      ["managed repo whose directory is missing", {projectId: "prj_" + "c".repeat(24), repository: {path: path.join(dataDir, "projects", "prj_" + "c".repeat(24), "repo"), managed: true}}, {ok: false, reason: "REPOSITORY_PATH_NOT_FOUND"}],
      ["ok: unmanaged directory outside the data dir", {projectId: PID, repository: {path: outside}}, {ok: true, src: real(outside)}],
      ["ok: managed repo at its canonical place", {projectId: PID, repository: {path: managedDir, managed: true}}, {ok: true, src: real(managedDir)}],
      ["ok: unmanaged path with dot-dot segments returns the CANONICAL src", {projectId: PID, repository: {path: `${outside}${path.sep}x${path.sep}..`}}, {ok: true, src: real(outside)}],
      ["ok: managed path with dot-dot segments returns the CANONICAL src", {projectId: PID, repository: {path: `${managedDir}${path.sep}..${path.sep}repo`, managed: true}}, {ok: true, src: real(managedDir)}],
      ["a url never overrides a usable path", {projectId: PID, repository: {path: outside, url: "https://example.invalid/r.git"}}, {ok: true, src: real(outside)}]
    ];
    for (const [label, project, expected] of cases) expect([label, repositoryPrecondition(project, dataDir)]).toEqual([label, expected]);
    expect(fs.readdirSync(dataDir, {recursive: true}).map(String).sort()).toEqual(before);
  });

  it("the runner blocks a run with exactly the function's reason for each failure, before any executor starts; a usable repository goes on to IMPLEMENT", { timeout: T }, async () => {
    const mkCtx = (repository: Record<string, unknown> | undefined): {c: Ctx; fake: FakeExecutors} => {
      const base = setup("tA"), dataDir = path.join(tmp, `data-x-${crypto.randomBytes(3).toString("hex")}`);
      const store = new WorkOsStore(dataDir);
      const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", testCommand: ["node", "test.mjs"], ...(repository ? {repository: repository as never} : {})});
      const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      return {c: {...base, store, dataDir, missionId: m.missionId, projectId: p.projectId}, fake: new FakeExecutors(okScript())};
    };
    const outside = fs.mkdtempSync(path.join(tmp, "plain-")), missing = path.join(outside, "missing");
    const cases: Array<[string, Record<string, unknown> | undefined, string]> = [
      ["no repository", undefined, "REPOSITORY_NOT_CONFIGURED"], ["url", {url: "https://example.invalid/r.git"}, "REMOTE_REPO_NOT_SUPPORTED_YET"],
      ["managed flag, foreign path", {path: outside, managed: true}, "REPOSITORY_NOT_MANAGED"], ["missing directory", {path: missing}, "REPOSITORY_PATH_NOT_FOUND"]
    ];
    for (const [label, repository, reason] of cases) {
      const {c, fake} = mkCtx(repository);
      expect([label, repositoryPrecondition(c.store.getProject({tenantId: "tA"}, c.projectId)!, c.dataDir)]).toEqual([label, {ok: false, reason}]);
      const r = start(c, fake);
      await runner(c, fake).tick();
      expect([label, runOf(c, r.runId).status, runOf(c, r.runId).reason, fake.calls.implement]).toEqual([label, "BLOCKED", reason, 0]);
    }
    // forbidden: the unmanaged path lies inside the run's own data dir
    const f = mkCtx(undefined);
    const inside = path.join(f.c.dataDir, "inside-repo"); fs.mkdirSync(inside, {recursive: true});
    const fp = f.c.store.createProject({tenantId: "tA", orgId: "o1", name: "F", environmentId: "dev", createdBy: "FOUNDER_LOCAL", testCommand: ["node", "test.mjs"], repository: {path: inside}});
    const fm = f.c.store.createMission({tenantId: "tA", projectId: fp.projectId, title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) f.c.store.transitionMission({tenantId: "tA"}, fm.missionId, to, "test", "FOUNDER_LOCAL");
    const fr = f.c.store.createRun({tenantId: "tA", missionId: fm.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "FOUNDER_LOCAL"});
    await runner(f.c, f.fake).tick();
    expect([f.c.store.getRun({tenantId: "tA"}, fr.runId)!.reason, f.fake.calls.implement]).toEqual(["REPOSITORY_PATH_FORBIDDEN", 0]);
    // a usable repository passes the precondition and reaches the executor
    const ok = setup("tA"), okFake = new FakeExecutors(okScript());
    expect(repositoryPrecondition(ok.store.getProject({tenantId: "tA"}, ok.projectId)!, ok.dataDir)).toEqual({ok: true, src: fs.realpathSync.native(ok.repo)});
    const okRun = start(ok, okFake);
    await runner(ok, okFake).tick();
    expect(okFake.calls.implement).toBeGreaterThanOrEqual(1);
    expect(runOf(ok, okRun.runId).status).toBe("AWAITING_APPROVAL");
  });

  it("the runner verifies with the mission's testCommand when both are set, and with the project's when the mission has none", { timeout: T }, async () => {
    const dataDir = path.join(tmp, `data-tc-${crypto.randomBytes(3).toString("hex")}`), { repo } = makeRepo(crypto.randomBytes(4).toString("hex"));
    for (const [label, projectCmd, missionCmd, expected] of [["mission passes, project would fail", ["node", "never.mjs"], ["node", "test.mjs"], "AWAITING_APPROVAL"], ["mission would fail, project passes", ["node", "test.mjs"], ["node", "never.mjs"], "BLOCKED"], ["mission none, project passes", ["node", "test.mjs"], undefined, "AWAITING_APPROVAL"]] as const) {
      const store = new WorkOsStore(path.join(dataDir, label.replace(/\W+/g, "-"))), runtime = path.join(tmp, `rt-${crypto.randomBytes(3).toString("hex")}`);
      fs.mkdirSync(runtime, {recursive: true});
      const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: [...projectCmd]});
      const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL", ...(missionCmd ? {testCommand: [...missionCmd]} : {})});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      const c: Ctx = {store, dataDir: path.join(dataDir, label.replace(/\W+/g, "-")), runtime, stopFile: path.join(runtime, "GLOBAL_STOP.json"), repo, head: "", missionId: m.missionId, projectId: p.projectId};
      const fake = new FakeExecutors(okScript());
      const r = start(c, fake);
      await runner(c, fake, {maxRemediations: 0}).tick();
      expect([label, runOf(c, r.runId).status]).toEqual([label, expected]);
    }
  });
});
