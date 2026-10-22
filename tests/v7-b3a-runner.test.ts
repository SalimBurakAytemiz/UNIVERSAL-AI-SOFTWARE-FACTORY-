// //TR: Bu test B3a mission runner engine'ini gerçek geçici git deposu ve deterministik FAKE executor ile doğrular: mutlu yol (mission REPORTING + run AWAITING_APPROVAL + tam kanıt), test hatası/reviewer BLOCKED sınırlı remediation, diff'te secret, aynı kimlik reddi, GLOBAL_STOP, lease fencing, crash-resume, tenant izolasyonu, path traversal ve cockpit activeWorkerRuns. Gerçek sağlayıcı çağrılmaz.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./support/test-sandbox.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (tamper testi için geçerli hash zinciri üretir)
import {sha256 as sha256Untyped} from "../automation/lib/atomic-json.mjs";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {activateGlobalStop} from "../automation/lib/global-stop.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner, effectiveTestCommand, repositoryPrecondition} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors, executorsFromEnv, parseReviewOutput} from "../core/workos/executors.js";
import type {ExecutorPair, FakeScript, MissionSpec} from "../core/workos/executors.js";
import {RUN_STATUSES, TERMINAL_RUN_STATUSES, canRunTransition} from "../core/workos/run-state.js";
import {effectiveLimits} from "../core/agents/role-execution.js";
import {ProjectStudio} from "../core/workos/project-studio.js";
import {RunWorkspaceArchiver, retentionMsFromEnv, recordedCommitSet, hasSecretFinding, RUN_ARCHIVE_RECORD} from "../core/workos/run-archive.js";
import type {ArchiveStudioPort, ArchiveStorePort} from "../core/workos/run-archive.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import {scanDiffForSecrets, redactSecrets} from "../core/workos/secret-scan.js";
import {buildServer} from "../apps/control-api/src/server.js";
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

describe("B3a run state table", () => {
  it("is an explicit allow-list: terminal states have no exits and illegal jumps are refused", () => {
    expect(RUN_STATUSES).toHaveLength(18);
    for (const s of TERMINAL_RUN_STATUSES) for (const t of RUN_STATUSES) expect(canRunTransition(s, t)).toBe(false);
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual(["BLOCKED", "CANCELLED", "FAILED", "QUARANTINED", "RECOVERY_FAILED", "SUCCEEDED"]);
    for (const [a, b] of [["CREATED", "RUNNING"], ["QUEUED", "SUCCEEDED"], ["RUNNING", "SUCCEEDED"], ["AWAITING_APPROVAL", "RUNNING"], ["CANCELLING", "RUNNING"], ["VERIFYING", "AWAITING_APPROVAL"]] as const) expect(canRunTransition(a, b)).toBe(false);
    for (const [a, b] of [["CREATED", "QUEUED"], ["QUEUED", "LEASED"], ["LEASED", "RUNNING"], ["RUNNING", "CHECKPOINTING"], ["CHECKPOINTING", "AWAITING_APPROVAL"], ["RECOVERING", "RECOVERY_FAILED"], ["CANCELLING", "CANCELLED"], ["AWAITING_APPROVAL", "SUCCEEDED"]] as const) expect(canRunTransition(a, b)).toBe(true);
    expect(canRunTransition("NOPE" as never, "QUEUED")).toBe(false);
  });

  it("replaying an illegal run transition (valid hash chain) marks the journal tampered", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    start(c, fake);
    const file = path.join(c.dataDir, "journal.jsonl");
    const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const idx = entries.findIndex(e => e.type === "RUN_TRANSITION");
    entries[idx].payload.to = "SUCCEEDED";
    let prev = entries[idx - 1].hash;
    for (let i = idx; i < entries.length; i++) { const {hash: _h, ...body} = entries[i]; body.prevHash = prev; entries[i] = {...body, hash: sha256(body)}; prev = entries[i].hash; }
    fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    const s2 = new WorkOsStore(c.dataDir);
    expect(s2.isTampered).toBe(true);
    expect(() => s2.listRuns({tenantId: "tA"})).toThrow(/RUN_TRANSITION_ILLEGAL/);
  });
});

describe("B3a mission runner engine", () => {
  it("LANE-C: a run whose role has no executable implementer (developer/tester) binding is BLOCKED before any builder call; bound developer, tester and role-less runs proceed", { timeout: T }, async () => {
    for (const [roleId, blocked] of [["UASCO-0001", true], ["UASCO-0252", true], ["UASCO-0019", true], ["UASCO-0232", true], ["UASCO-0085", false], ["UASCO-0313", false], [null, false]] as const) {
      const c = setup(); const fake = new FakeExecutors(okScript());
      const p = fake.pair();
      const created = c.store.createRun({tenantId: "tA", missionId: c.missionId, roleId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
      await runner(c, fake).tick();
      const run = runOf(c, created.runId);
      if (blocked) {
        expect(run.status).toBe("BLOCKED");
        expect(JSON.stringify(journal(c))).toContain("ROLE_NOT_EXECUTABLE:");
        expect(fake.calls.implement).toBe(0);
      } else {
        expect(run.status).toBe("AWAITING_APPROVAL");
        expect(fake.calls.implement).toBe(1);
        const trace = run.evidence.filter(e => e.kind === "AGENT_TRACE");
        if (roleId === null) expect(trace).toHaveLength(0);
        else {
          expect(trace.map(e => e.step)).toEqual(["IMPLEMENT", "REVIEW"]);
          expect(trace[0].note).toBe(`agent=agent-${run.runId}-implement-c0 role=${roleId} state=COMPLETED`);
          expect(trace[1].note).toBe(`agent=agent-${run.runId}-review-c0 role=UASCO-0252 state=COMPLETED verdict=CLEAN`);
          expect(trace[1].executorIdentity).toBe("FAKE_REVIEWER");
          const body = JSON.parse(fs.readFileSync(path.join(c.dataDir, trace[0].logPath!), "utf8"));
          expect(body).toMatchObject({roleId, runId: run.runId, providerRoute: "CLAUDE_IMPLEMENTER", state: "COMPLETED", certification: "NOT_CERTIFIED", perCallToolTrace: "NOT_OBSERVABLE_FROM_ADAPTER"});
          expect(body.agentInstanceId).not.toBe(body.roleId);
          const rbody = JSON.parse(fs.readFileSync(path.join(c.dataDir, trace[1].logPath!), "utf8"));
          expect(rbody).toMatchObject({roleId: "UASCO-0252", providerRoute: "CLAUDE_REVIEWER", allowedTools: ["Read", "Glob", "Grep"], state: "COMPLETED"});
        }
      }
    }
  });

  it("happy path: mission ends REPORTING, run AWAITING_APPROVAL with complete evidence; nothing merged or pushed", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const created = start(c, fake);
    expect(created.status).toBe("QUEUED");
    expect(missionOf(c).status).toBe("PLANNED");
    const rep = await runner(c, fake).tick();
    expect(rep.claimed).toEqual([created.runId]);
    const run = runOf(c, created.runId);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toBe("DELIVERY_DECISION_PENDING_FOUNDER");
    expect(run.leaseId).toBeNull();
    expect(missionOf(c).status).toBe("REPORTING");
    expect(run.baseSha).toBe(c.head);
    expect(run.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(run.headSha).not.toBe(c.head);
    expect(run.checkpoints.map(x => x.step)).toEqual(["WORKSPACE", "IMPLEMENT", "VERIFY", "SECURITY", "REVIEW", "REGRESSION", "REPORT"]);
    expect(kinds(run)).toEqual(["WORKSPACE", "IMPLEMENT", "SECRET_SCAN", "VERIFY_TESTS", "TEST_SURFACE", "SECURITY_GITLEAKS", "SECURITY_GITLEAKS_ADDED_LINES", "SECURITY_TRIVY", "SECURITY_REPORT", "REVIEW", "REGRESSION_TESTS", "REPORT"]);
    for (const e of run.evidence) {
      expect(e.startedAt <= e.endedAt).toBe(true);
      expect(e.exitCode).toBe(0);
      expect(e.logPath).toBeTruthy();
      const bytes = fs.readFileSync(path.join(c.dataDir, e.logPath!));
      expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(e.logSha256);
    }
    const impl = run.evidence.find(e => e.kind === "IMPLEMENT")!;
    expect(impl.commitSha).toBe(run.headSha);
    expect(impl.executorIdentity).toBe("FAKE_IMPLEMENTER");
    expect(impl.argv[1]).toMatch(/fake-executor\.mjs$/);
    const rev = run.evidence.find(e => e.kind === "REVIEW")!;
    expect(rev).toEqual(expect.objectContaining({reviewerIdentity: "FAKE_REVIEWER", verdict: "CLEAN", findingsCount: 0, commitSha: run.headSha}));
    const report = JSON.parse(fs.readFileSync(path.join(c.dataDir, run.evidence.at(-1)!.logPath!), "utf8"));
    expect(report).toEqual(expect.objectContaining({deliveryDecision: "PENDING_FOUNDER", delivered: false, headSha: run.headSha, baseSha: c.head}));
    // source repository untouched: no merge/push back
    expect(git(c.repo, ["rev-parse", "HEAD"])).toBe(c.head);
    expect(git(c.repo, ["branch", "--list"])).not.toMatch(/uasco/);
    // workspace commit is on the run branch inside the workspace
    const work = path.join(c.dataDir, "runs", run.runId, "work");
    expect(git(work, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(`uasco/run/${run.runId}`);
    // single authority: everything is in the same hash-chained journal and replays identically
    const types = new Set(journal(c).map(e => e.type));
    for (const t of ["RUN_CREATED", "RUN_LEASE", "RUN_TRANSITION", "RUN_CHECKPOINT", "RUN_EVIDENCE"]) expect(types.has(t)).toBe(true);
    expect(fs.existsSync(path.join(c.dataDir, "runs.jsonl"))).toBe(false);
    const fresh = new WorkOsStore(c.dataDir);
    expect(fresh.isTampered).toBe(false);
    expect(fresh.getRun({tenantId: "tA"}, run.runId)).toEqual(run);
    expect(fresh.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("REPORTING");
    // a second tick does nothing to a run awaiting approval
    const again = await runner(c, fake).tick();
    expect(again.advanced).toEqual([]);
    expect(runOf(c, run.runId).status).toBe("AWAITING_APPROVAL");
    expect(fake.calls).toEqual({implement: 1, review: 1});
  });

  it("failing tests: VERIFYING fails -> REMEDIATING (bounded) -> BLOCKED; a later fix within budget succeeds", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "bad\n"}})}));
    const r = start(c, fake);
    await runner(c, fake, {maxRemediations: 2}).tick();
    const run = runOf(c, r.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("TESTS_FAILED_REMEDIATION_EXHAUSTED");
    expect(missionOf(c).status).toBe("BLOCKED");
    expect(fake.calls.implement).toBe(3);
    expect(fake.calls.review).toBe(0);
    const moves = journal(c).filter(e => e.payload.mission).map(e => e.payload.mission.to);
    expect(moves).toEqual(["PLANNED", "EXECUTING", "VERIFYING", "REMEDIATING", "VERIFYING", "REMEDIATING", "VERIFYING", "BLOCKED"]);
    expect(run.evidence.filter(e => e.kind === "VERIFY_TESTS").map(e => e.exitCode)).toEqual([1, 1, 1]);

    // second mission: first attempt fails, remediation fixes it
    const c2 = setup("tB");
    const specs: MissionSpec[] = [];
    const fake2 = new FakeExecutors(okScript({implement: (n, spec) => { specs.push(spec); return {files: {"feature.txt": n === 1 ? "bad\n" : "ok\n"}}; }}));
    const r2 = c2.store.createRun({tenantId: "tB", missionId: c2.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "F"});
    await runner(c2, fake2).tick();
    const done = c2.store.getRun({tenantId: "tB"}, r2.runId)!;
    expect(done.status).toBe("AWAITING_APPROVAL");
    expect(done.remediationCycle).toBe(1);
    expect(c2.store.getMission({tenantId: "tB"}, c2.missionId)!.status).toBe("REPORTING");
    expect(specs[1].remediation).toEqual({reason: "TESTS_FAILED", findings: ["test command exited 1"]});
  });

  it("secret in the produced diff -> BLOCKED before tests run; the value is never journaled or logged", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n", "config.txt": `aws=${FAKE_AWS}\n`}})}));
    const r = start(c, fake);
    await runner(c, fake).tick();
    const run = runOf(c, r.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_IN_DIFF");
    expect(missionOf(c).status).toBe("BLOCKED");
    const scan = run.evidence.find(e => e.kind === "SECRET_SCAN")!;
    expect(scan.exitCode).toBe(1);
    expect(scan.secretHits).toEqual([{kind: "AWS_ACCESS_KEY", file: "config.txt", line: 1}]);
    expect(kinds(run)).not.toContain("VERIFY_TESTS");
    expect(fake.calls.review).toBe(0);
    expect(fs.readFileSync(path.join(c.dataDir, "journal.jsonl"), "utf8")).not.toContain(FAKE_AWS);
    const logs = path.join(c.dataDir, "runs", run.runId, "logs");
    for (const f of fs.readdirSync(logs)) expect(fs.readFileSync(path.join(logs, f), "utf8")).not.toContain(FAKE_AWS);
  });

  it("secret scanner covers the conservative pattern set and only added lines", () => {
    const pk = ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("");
    const gh = ["gh", "p_", "A".repeat(36)].join(""), an = ["sk-", "ant-", "b".repeat(24)].join(""), oa = ["sk-", "proj-", "c".repeat(24)].join("");
    const diff = ["+++ b/a.txt", "@@ -0,0 +1,5 @@", `+${pk}`, `+${gh}`, `+${an}`, `+${oa}`, "+harmless", "--- a/b.txt", "+++ b/b.txt", "@@ -1,1 +1,1 @@", `-${FAKE_AWS}`, " context"].join("\n");
    const hits = scanDiffForSecrets(diff);
    expect(hits.map(h => h.kind)).toEqual(["PRIVATE_KEY", "GITHUB_TOKEN", "ANTHROPIC_KEY", "OPENAI_STYLE_KEY"]);
    expect(hits.map(h => h.line)).toEqual([1, 2, 3, 4]);
    expect(redactSecrets(`x ${FAKE_AWS} y`)).toBe("x [REDACTED:AWS_ACCESS_KEY] y");
  });

  it("reviewer BLOCKED -> REMEDIATING with findings passed to the implementer, bounded -> BLOCKED", { timeout: T }, async () => {
    const c = setup();
    const specs: MissionSpec[] = [];
    const fake = new FakeExecutors(okScript({implement: (_n, spec) => { specs.push(spec); return {files: {"feature.txt": "ok\n"}}; }, review: () => ({verdict: "BLOCKED", findings: [{severity: "P1", title: "missing edge case"}]})}));
    const r = start(c, fake);
    await runner(c, fake, {maxRemediations: 1}).tick();
    const run = runOf(c, r.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("REVIEW_BLOCKED_REMEDIATION_EXHAUSTED");
    expect(missionOf(c).status).toBe("BLOCKED");
    expect(fake.calls).toEqual({implement: 2, review: 2});
    expect(specs[1].remediation).toEqual({reason: "REVIEW_BLOCKED", findings: ["P1: missing edge case"]});
    expect(run.evidence.filter(e => e.kind === "REVIEW").map(e => e.verdict)).toEqual(["BLOCKED", "BLOCKED"]);
    expect(journal(c).filter(e => e.payload.mission?.to === "REMEDIATING").map(e => e.payload.mission.from)).toEqual(["REVIEWING"]);
  });

  it("reviewer output that is invalid or mutates its clone never counts as CLEAN", { timeout: T }, async () => {
    expect(parseReviewOutput("noise\n{\"verdict\":\"CLEAN\",\"findings\":[{\"title\":\"x\"}]}")?.verdict).toBe("BLOCKED");
    expect(parseReviewOutput("{\"verdict\":\"MAYBE\",\"findings\":[]}")).toBeNull();
    const c = setup(); const fake = new FakeExecutors(okScript({review: () => ({verdict: "CLEAN", mutate: true})}));
    const r = start(c, fake);
    await runner(c, fake).tick();
    expect(runOf(c, r.runId).reason).toBe("REVIEWER_MUTATED_CLONE");
    expect(missionOf(c).status).toBe("BLOCKED");
    const c2 = setup("tB"); const fake2 = new FakeExecutors(okScript({review: () => ({raw: "LGTM"})}));
    const r2 = c2.store.createRun({tenantId: "tB", missionId: c2.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "F"});
    await runner(c2, fake2).tick();
    expect(c2.store.getRun({tenantId: "tB"}, r2.runId)).toEqual(expect.objectContaining({status: "FAILED", reason: "REVIEW_FAILED"}));
  });

  it("refuses a configuration where implementer identity equals reviewer identity", { timeout: T }, async () => {
    const c = setup();
    const same = new FakeExecutors(okScript(), {implementer: "SAME", reviewer: "SAME"});
    expect(() => runner(c, same)).toThrow(/EXECUTOR_CONFIG_REFUSED/);
    expect(() => c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: "X", reviewer: "X"}, createdBy: "F"})).toThrow(/EXECUTOR_IDENTITY_NOT_INDEPENDENT/);
    const before = journal(c).length;
    const app = buildServer({sandbox: TEST_HOST_PASSTHROUGH_SANDBOX, controlToken: "t".repeat(32), runtime: c.runtime, repoRoot: tmp, dataDir: c.dataDir, tenantId: "tA", port: 3210, logger: false, executors: same.pair()});
    const res = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/runs`, headers: {"x-uasco-control-token": "t".repeat(32), host: "127.0.0.1:3210"}, payload: {}});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({error: "EXECUTOR_CONFIG_REFUSED"});
    expect(journal(c).length).toBe(before);
    await app.close();
  });

  it("transient executor failures retry with a bounded budget; exhausted -> FAILED, mission BLOCKED", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript({implement: n => (n <= 2 ? {exitCode: 75} : {files: {"feature.txt": "ok\n"}})}));
    const r = start(c, fake);
    await runner(c, fake).tick();
    expect(runOf(c, r.runId).status).toBe("AWAITING_APPROVAL");
    expect(fake.calls.implement).toBe(3);
    expect(journal(c).filter(e => e.type === "RUN_TRANSITION" && e.payload.to === "RETRY_SCHEDULED")).toHaveLength(2);
    const c2 = setup("tB"); const fake2 = new FakeExecutors(okScript({implement: () => ({exitCode: 75})}));
    const r2 = c2.store.createRun({tenantId: "tB", missionId: c2.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "F"});
    await runner(c2, fake2).tick();
    expect(c2.store.getRun({tenantId: "tB"}, r2.runId)).toEqual(expect.objectContaining({status: "FAILED", reason: "IMPLEMENT_TRANSIENT_FAILURE_RETRY_EXHAUSTED"}));
    expect(c2.store.getMission({tenantId: "tB"}, c2.missionId)!.status).toBe("BLOCKED");
    expect(fake2.calls.implement).toBe(3);
    // a non-transient implementer failure is never blindly retried
    const c3 = setup("tC"); const fake3 = new FakeExecutors(okScript({implement: () => ({exitCode: 1})}));
    const r3 = c3.store.createRun({tenantId: "tC", missionId: c3.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "F"});
    await runner(c3, fake3).tick();
    expect(c3.store.getRun({tenantId: "tC"}, r3.runId)).toEqual(expect.objectContaining({status: "FAILED", reason: "IMPLEMENT_FAILED"}));
    expect(fake3.calls.implement).toBe(1);
  });

  it("remote (url) repositories are BLOCKED with REMOTE_REPO_NOT_SUPPORTED_YET; missing test command is BLOCKED", { timeout: T }, async () => {
    const c = setup("tA", {url: true}); const fake = new FakeExecutors(okScript());
    const r = start(c, fake);
    await runner(c, fake).tick();
    expect(runOf(c, r.runId)).toEqual(expect.objectContaining({status: "BLOCKED", reason: "REMOTE_REPO_NOT_SUPPORTED_YET"}));
    expect(missionOf(c).status).toBe("BLOCKED");
    expect(fake.calls.implement).toBe(0);
    const c2 = setup("tB", {testCommand: null}); const fake2 = new FakeExecutors(okScript());
    const r2 = c2.store.createRun({tenantId: "tB", missionId: c2.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "F"});
    await runner(c2, fake2).tick();
    expect(c2.store.getRun({tenantId: "tB"}, r2.runId)).toEqual(expect.objectContaining({status: "BLOCKED", reason: "TEST_COMMAND_NOT_CONFIGURED"}));
  });

  it("GLOBAL_STOP between steps -> run CANCELLING -> CANCELLED and mission BLOCKED with reason", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const r = start(c, fake);
    const eng = runner(c, fake, {maxStepsPerTick: 2});
    await eng.tick();
    expect(runOf(c, r.runId).status).toBe("CHECKPOINTING");
    activateGlobalStop(c.stopFile, "founder stop test", "TEST");
    const rep = await eng.tick();
    expect(rep.cancelled).toContain(r.runId);
    const run = runOf(c, r.runId);
    expect(run.status).toBe("CANCELLED");
    expect(run.reason).toMatch(/^GLOBAL_STOP_ACTIVE: founder stop test/);
    expect(kinds(run).at(-1)).toBe("CANCEL");
    const m = missionOf(c);
    expect(m.status).toBe("BLOCKED");
    const last = journal(c).filter(e => e.payload.mission).at(-1);
    expect(last.payload.mission).toEqual(expect.objectContaining({from: "VERIFYING", to: "BLOCKED", reason: expect.stringMatching(/^GLOBAL_STOP_ACTIVE/)}));
    expect(journal(c).filter(e => e.type === "RUN_TRANSITION").slice(-2).map(e => e.payload.to)).toEqual(["CANCELLING", "CANCELLED"]);
    expect(fake.calls.review).toBe(0);
  });

  it("GLOBAL_STOP during a running step aborts the child process; queued runs are cancelled without a lease", { timeout: T }, async () => {
    const c = setup();
    const fake = new FakeExecutors(okScript({implement: () => { activateGlobalStop(c.stopFile, "stop mid step", "TEST"); return {files: {"feature.txt": "ok\n"}, sleepMs: 30_000}; }}));
    const r = start(c, fake);
    const t0 = Date.now();
    await runner(c, fake).tick();
    expect(Date.now() - t0).toBeLessThan(25_000);
    const run = runOf(c, r.runId);
    expect(run.status).toBe("CANCELLED");
    expect(run.evidence.find(e => e.kind === "IMPLEMENT")!.commitSha).toBeUndefined();
    expect(missionOf(c).status).toBe("BLOCKED");
    // queued run while stop active
    const c2 = setup("tB");
    const r2 = c2.store.createRun({tenantId: "tB", missionId: c2.missionId, executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}, createdBy: "F"});
    const fake2 = new FakeExecutors(okScript());
    activateGlobalStop(c2.stopFile, "stop before claim", "TEST");
    await runner(c2, fake2).tick();
    expect(c2.store.getRun({tenantId: "tB"}, r2.runId)).toEqual(expect.objectContaining({status: "CANCELLED", leaseId: null}));
    expect(c2.store.getMission({tenantId: "tB"}, c2.missionId)!.status).toBe("BLOCKED");
    expect(fake2.calls.implement).toBe(0);
  });

  it("fencing: a write with a stale or expired leaseId is refused and writes nothing", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const r = start(c, fake);
    let t = Date.now();
    const clockStore = new WorkOsStore(c.dataDir, {now: () => t});
    const leased = clockStore.acquireRunLease(r.runId, 1_000, "ENGINE_A");
    t += 5_000; // lease expired, nobody took over yet
    const n0 = journal(c).length;
    expect(() => clockStore.transitionRun(r.runId, leased.leaseId!, "RUNNING", "late", "ENGINE_A")).toThrow(/WORKOS_LEASE_FENCED/);
    expect(() => clockStore.renewRunLease(r.runId, leased.leaseId!, 1_000, "ENGINE_A")).toThrow(/WORKOS_LEASE_FENCED/);
    const taken = clockStore.takeoverRunLease(r.runId, 60_000, "ENGINE_B");
    expect(taken.status).toBe("RECOVERING");
    expect(taken.attempt).toBe(2);
    const n1 = journal(c).length;
    expect(n1).toBe(n0 + 1);
    // the old holder is fenced for every write kind, even with a fresh clock
    for (const f of [
      () => c.store.transitionRun(r.runId, leased.leaseId!, "RUNNING", "stale", "ENGINE_A"),
      () => c.store.addRunEvidence(r.runId, leased.leaseId!, {step: "IMPLEMENT", cycle: 0, kind: "X", argv: [], startedAt: "a", endedAt: "b", exitCode: 0, logPath: null, logSha256: null}, "ENGINE_A"),
      () => c.store.renewRunLease(r.runId, leased.leaseId!, 60_000, "ENGINE_A"),
      () => c.store.transitionRun(r.runId, null, "RUNNING", "no lease", "ENGINE_A"),
      () => c.store.takeoverRunLease(r.runId, 60_000, "ENGINE_C")
    ]) expect(f).toThrow(/WORKOS_LEASE_FENCED/);
    expect(journal(c).length).toBe(n1);
  });

  it("an engine that lost its lease mid-run does not write when it ticks again", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const r = start(c, fake);
    const a = runner(c, fake, {maxStepsPerTick: 1});
    await a.tick();
    const later = Date.now() + 10 * 60_000;
    const storeB = new WorkOsStore(c.dataDir, {now: () => later});
    storeB.takeoverRunLease(r.runId, 60 * 60_000, "ENGINE_B");
    const n = journal(c).length;
    const rep = await a.tick();
    expect(rep.advanced).toEqual([]);
    expect(journal(c).length).toBe(n);
    expect(runOf(c, r.runId).status).toBe("RECOVERING");
  });

  it("crash-resume: a new engine with an expired lease resumes from the last checkpoint without redoing completed steps", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const r = start(c, fake);
    await runner(c, fake, {maxStepsPerTick: 2}).tick(); // WORKSPACE + IMPLEMENT done, then "crash"
    const mid = runOf(c, r.runId);
    expect(mid.status).toBe("CHECKPOINTING");
    expect(mid.step).toBe("VERIFY");
    expect(fake.calls.implement).toBe(1);
    const later = Date.now() + 10 * 60_000;
    const storeB = new WorkOsStore(c.dataDir, {now: () => later});
    const b = new MissionRunner({executionGate: testExecutionGate(), store: storeB, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: fake.pair(), retryBackoffMs: [0, 0], now: () => later, security: fakeSecurity(`${c.dataDir}-sec`).options});
    const rep = await b.tick();
    expect(rep.recovered).toEqual([r.runId]);
    const run = runOf(c, r.runId);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.attempt).toBe(2);
    expect(fake.calls.implement).toBe(1);
    expect(run.checkpoints.map(x => x.step)).toEqual(["WORKSPACE", "IMPLEMENT", "VERIFY", "SECURITY", "REVIEW", "REGRESSION", "REPORT"]);
    expect(kinds(run).filter(k => k === "IMPLEMENT" || k === "WORKSPACE")).toEqual(["WORKSPACE", "IMPLEMENT"]);
    const recovery = run.evidence.find(e => e.kind === "RECOVERY")!;
    expect(recovery.exitCode).toBe(0);
    expect(recovery.note).toMatch(/resume step VERIFY/);
    expect(missionOf(c).status).toBe("REPORTING");
  });

  it("crash-resume with a lost workspace -> RECOVERY_FAILED with evidence, mission BLOCKED", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const r = start(c, fake);
    await runner(c, fake, {maxStepsPerTick: 2}).tick();
    fs.rmSync(path.join(c.dataDir, "runs", r.runId, "work"), {recursive: true, force: true});
    const later = Date.now() + 10 * 60_000;
    const storeB = new WorkOsStore(c.dataDir, {now: () => later});
    await new MissionRunner({executionGate: testExecutionGate(), store: storeB, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: fake.pair(), now: () => later, security: fakeSecurity(`${c.dataDir}-sec`).options}).tick();
    const run = runOf(c, r.runId);
    expect(run.status).toBe("RECOVERY_FAILED");
    expect(run.reason).toMatch(/WORKSPACE_MISSING/);
    expect(run.evidence.find(e => e.kind === "RECOVERY")).toEqual(expect.objectContaining({exitCode: 1, note: expect.stringMatching(/WORKSPACE_MISSING/)}));
    expect(missionOf(c).status).toBe("BLOCKED");
    expect(fake.calls.implement).toBe(1);
  });

  it("engine path helpers reject traversal run ids", () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    const e = runner(c, fake) as unknown as {runDir: (id: string) => string};
    for (const bad of ["../x", "run_../../etc", "run_ABC", `run_${"0".repeat(24)}/..`, ""]) expect(() => e.runDir(bad)).toThrow(/WORKOS_INVALID_INPUT/);
    expect(e.runDir(`run_${"a".repeat(24)}`)).toBe(path.join(c.dataDir, "runs", `run_${"a".repeat(24)}`));
  });

  it("real LOCAL_CLAUDE executors are off by default and selected only by explicit env (never invoked here)", () => {
    expect(executorsFromEnv(REPO, {})).toEqual({pair: null, reason: "EXECUTOR_NOT_CONFIGURED"});
    expect(executorsFromEnv(REPO, {UASCO_WORKOS_EXECUTOR: "fake"})).toEqual({pair: null, reason: "EXECUTOR_UNKNOWN"});
    const lc = executorsFromEnv(REPO, {UASCO_WORKOS_EXECUTOR: "local-claude"});
    expect(lc.pair?.kind).toBe("LOCAL_CLAUDE");
    expect(lc.pair?.implementer.identity).toBe("CLAUDE_BUILDER");
    expect(lc.pair?.reviewer.identity).toBe("CLAUDE_REVIEWER");
  });
});

describe("LANE-C MissionRunner claim cap (maxConcurrentRuns)", () => {
  const addMission = (c: Ctx, i: number) => {
    const m = c.store.createMission({tenantId: "tA", projectId: c.projectId, title: `Add feature ${i}`, objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) c.store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    return m.missionId;
  };
  const queueRuns = (c: Ctx, pair: ExecutorPair, n: number) => [c.missionId, ...Array.from({length: n - 1}, (_, i) => addMission(c, i + 1))]
    .map(missionId => c.store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}));
  // implementer sarmalayıcı: aynı anda içerideki çağrı sayısını izler; barrier>0 ise o kadar çağrı birlikte içeri girene kadar bekler (deterministik eşzamanlılık kanıtı, süre tahmini yok).
  function tracked(pair: ExecutorPair, barrier = 0) {
    const st = {active: 0, maxActive: 0, arrived: 0, barrierTimedOut: false}; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const implement = async (w: string, spec: MissionSpec, ctx: {timeoutMs: number; shouldAbort?: () => boolean}) => {
      st.active += 1; st.maxActive = Math.max(st.maxActive, st.active); st.arrived += 1;
      if (barrier > 0) { if (st.arrived >= barrier) release(); await Promise.race([gate, new Promise<void>(r => setTimeout(() => { st.barrierTimedOut = true; r(); }, 20_000))]); }
      try { return await pair.implementer.implement(w, spec, ctx); } finally { st.active -= 1; }
    };
    return {st, pair: {...pair, implementer: {...pair.implementer, implement}} as ExecutorPair};
  }

  // //TR: Sanal saatli testlerde HİÇBİR bekleme sınırsız değildir: sanal saat donukken zamana bağlı bir yola (RETRY_SCHEDULED/retryAt, lease devri) girilirse tick ilerlemez. Sınır (gerçek süre) aşılırsa test, run durumu / adım / retryAt / leaseExpiresAt / sanal saat ile saniyeler içinde YÜKSEK SESLE düşer (600 s'lik adım zaman aşımı olarak değil); sınır gevşetilmez, test atlanmaz.
  const runDiag = (c: Ctx, ids: string[], extra: Record<string, unknown> = {}) => JSON.stringify({...extra, runs: ids.map(id => { const r = c.store.engineGetRun(id); return r ? {id: id.slice(0, 12), status: r.status, step: r.step, retryCount: r.retryCount, retryAt: r.retryAt, leaseExpiresAt: r.leaseExpiresAt, hasLease: r.leaseId !== null, attempt: r.attempt} : null; })});
  const boundedTick = async (mr: MissionRunner, c: Ctx, ids: string[], label: string, ctx: () => Record<string, unknown>, ms = 30_000) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`BOUNDED_TICK_TIMEOUT ${label}: no result after ${ms} ms of real time (virtual clock frozen?) ${runDiag(c, ids, ctx())}`)), ms); });
    try { return await Promise.race([mr.tick(), timeout]); } finally { clearTimeout(timer); }
  };
  // run geçişlerini kaydeder: sanal saat donukken RETRY_SCHEDULED'a girilmemeli (girilirse retryAt sanal saatle geçmez).
  const watchTransitions = (c: Ctx) => { const seen: string[] = [], orig = c.store.transitionRun.bind(c.store); c.store.transitionRun = (...a: Parameters<typeof orig>) => { seen.push(String(a[2])); return orig(...a); }; return seen; };

  // //TR: Deterministik: lease süresi SANAL saate bağlıdır (store ve runner aynı saati kullanır); gerçek süre, yavaş senkron git adımları veya yüklü runner sonucu değiştirmez. r1'in "TTL'den uzun" çalışması, implementer içinde sanal saatin TTL'den küçük adımlarla ilerletilmesi ve lease'in her adımda RUNNER'IN KENDİ heartbeat'i (executeStep içindeki setInterval) tarafından yenilenmesi beklenerek kurulur (sınırlı gerçek bekleme; sanal zaman bekleme sırasında donuktur, yani bekleme lease'i yarıştıramaz). Test lease'i KENDİSİ yenilemez: heartbeat bozulursa test düşer.
  it("default cap 1: a queued second run gets NO lease while the first runs longer than the lease TTL (virtual clock), so it is never fenced or recovered; the next tick claims it", { timeout: T }, async () => {
    const TTL = 1000, clock = {ms: Date.UTC(2026, 9, 22, 12, 0, 0)};
    const c = setup("tA", {virtualClock: clock}); const fake = new FakeExecutors(okScript()); const pair = fake.pair();
    const [r1, r2] = queueRuns(c, pair, 2);
    const seen: Array<{status: string; leaseId: string | null; attempt: number}> = [];
    let virtualElapsed = 0, firstCall = true;
    const hbRenewed: boolean[] = [];
    let hbFailure = "";
    const transitions = watchTransitions(c), vctx = () => ({virtualNow: new Date(clock.ms).toISOString(), virtualElapsed, hbRenewed, transitions: transitions.slice(-12)});
    const longRunning: ExecutorPair = {...pair, implementer: {...pair.implementer, async implement(w, spec, ctx) {
      if (!firstCall) return pair.implementer.implement(w, spec, ctx); // second tick: r2's own (normal) implementer call
      firstCall = false;
      for (let i = 0; i < 4; i++) { // 4 x 900 virtual ms = 3600 > 3 x TTL; after each step the RUNNER's own heartbeat must renew r1's lease (the test never renews it)
        clock.ms += 900; virtualElapsed += 900;
        // the clock only moves in this loop and nothing awaits between the increment and `want`, so every renewal after this line (heartbeat or step) writes exactly `want`; the bound only caps the wait (heartbeat period is TTL/3 real ms)
        const want = new Date(clock.ms + TTL).toISOString(), deadline = Date.now() + 10_000;
        while (c.store.engineGetRun(r1.runId)!.leaseExpiresAt !== want && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
        hbRenewed.push(c.store.engineGetRun(r1.runId)!.leaseExpiresAt === want);
        if (!hbRenewed[hbRenewed.length - 1]) { hbFailure = `heartbeat did not write ${want} within 10 s: ${runDiag(c, [r1.runId, r2.runId], vctx())}`; break; }
        const x = runOf(c, r2.runId); seen.push({status: x.status, leaseId: x.leaseId, attempt: x.attempt});
      }
      return pair.implementer.implement(w, spec, ctx);
    }}};
    const mr = runner(c, fake, {leaseTtlMs: TTL, executors: longRunning, now: () => clock.ms});
    const t1 = await boundedTick(mr, c, [r1.runId, r2.runId], "cap-1 tick 1", vctx);
    expect(hbRenewed, hbFailure).toEqual([true, true, true, true]); // the runner's own heartbeat renewed the lease after every 900 virtual ms
    expect(transitions, runDiag(c, [r1.runId, r2.runId], vctx())).not.toContain("RETRY_SCHEDULED"); // no time-based retry path while the virtual clock is frozen
    expect(virtualElapsed).toBeGreaterThan(TTL * 3);
    expect(t1.claimed).toEqual([r1.runId]);
    expect(t1.deferred).toEqual([r2.runId]);
    expect(t1.fenced).toEqual([]);
    expect(t1.recovered).toEqual([]);
    expect(seen).toEqual(Array(4).fill({status: "QUEUED", leaseId: null, attempt: 0})); // r2 held no lease at any point while r1 outlived the TTL
    expect(runOf(c, r1.runId).status, runDiag(c, [r1.runId], vctx())).toBe("AWAITING_APPROVAL");
    expect(runOf(c, r2.runId)).toMatchObject({status: "QUEUED", leaseId: null, attempt: 0});
    expect(fake.calls.implement).toBe(1);
    clock.ms += 5 * TTL; // virtual time passes between ticks: nothing of r2 can expire because r2 has no lease
    const t2 = await boundedTick(mr, c, [r1.runId, r2.runId], "cap-1 tick 2", vctx);
    expect(t2).toMatchObject({claimed: [r2.runId], deferred: [], fenced: [], recovered: []});
    expect(runOf(c, r2.runId).status, runDiag(c, [r2.runId], vctx())).toBe("AWAITING_APPROVAL");
    expect(fake.calls).toEqual({implement: 2, review: 2});
    expect(transitions, runDiag(c, [r1.runId, r2.runId], vctx())).not.toContain("RETRY_SCHEDULED");
  });

  // //TR: renew() (adım başında ve uzun senkron işten önce) lease'i uzatır. TTL gerçek heartbeat aralığından (TTL/3 gerçek ms) çok uzun seçilir: heartbeat devreye giremez, lease'i YALNIZ renew() tutar. Her uzun çağrı TTL'nin 0.9'u kadar sanal zaman harcar (toplam 1.8 x TTL): renew() çağrıları olmasaydı lease dolar ve run fence edilirdi.
  it("renew() keeps the lease alive across long synchronous work: two long calls of 0.9 x TTL each (1.8 x TTL in total, the heartbeat cannot fire) never fence the run (virtual clock)", { timeout: T }, async () => {
    const TTL = 600_000, clock = {ms: Date.UTC(2026, 9, 22, 12, 0, 0)}, segment = 540_000;
    const c = setup("tA", {virtualClock: clock}); const fake = new FakeExecutors(okScript()); const pair = fake.pair();
    const [r1] = queueRuns(c, pair, 1);
    let advanced = 0;
    const slow: ExecutorPair = {...pair,
      implementer: {...pair.implementer, async implement(w, spec, ctx) { clock.ms += segment; advanced += segment; return pair.implementer.implement(w, spec, ctx); }},
      reviewer: {...pair.reviewer, async review(w, spec, diff, ctx) { clock.ms += segment; advanced += segment; return pair.reviewer.review(w, spec, diff, ctx); }}};
    const transitions = watchTransitions(c), vctx = () => ({virtualNow: new Date(clock.ms).toISOString(), advanced, transitions: transitions.slice(-12)});
    const t1 = await boundedTick(runner(c, fake, {leaseTtlMs: TTL, executors: slow, now: () => clock.ms}), c, [r1.runId], "liveness tick", vctx);
    expect(advanced).toBe(2 * segment);
    expect(t1, runDiag(c, [r1.runId], vctx())).toMatchObject({claimed: [r1.runId], fenced: [], recovered: []});
    expect(runOf(c, r1.runId).status, runDiag(c, [r1.runId], vctx())).toBe("AWAITING_APPROVAL");
    expect(fake.calls).toEqual({implement: 1, review: 1});
    expect(transitions).not.toContain("RETRY_SCHEDULED");
  });

  // //TR: Lease, bir renew() çağrısı gelmeden önce dolmuşsa (uzun senkron iş) renew() WORKOS_LEASE_FENCED fırlatır ve paralı implementer çağrısı HİÇ yapılmaz. Sanal saat, IMPLEMENT adımındaki İKİNCİ renewRunLease çağrısında (workspace sıfırlamasından sonra, paralı executor çağrısından hemen önceki renew()) TTL'den fazla ilerletilir; heartbeat (TTL/3 gerçek ms) bu sürede çalışamaz.
  it("renew() fences an already expired lease before the paid implementer call: the run is reported fenced, the implementer is never called, and the next tick takes the expired lease over and recovers the run to AWAITING_APPROVAL (virtual clock)", { timeout: T }, async () => {
    const TTL = 600_000, clock = {ms: Date.UTC(2026, 9, 22, 12, 0, 0)};
    const c = setup("tA", {virtualClock: clock}); const fake = new FakeExecutors(okScript()); const pair = fake.pair();
    const [r1] = queueRuns(c, pair, 1);
    const original = c.store.renewRunLease.bind(c.store);
    let implementRenews = 0, jumped = 0;
    c.store.renewRunLease = (runId, leaseId, ttlMs, actor) => {
      // IMPLEMENT's renewals: 1st = step start (drive loop), 2nd = the renew() right after the workspace reset and right before the paid executor call
      if (c.store.engineGetRun(runId)?.step === "IMPLEMENT" && ++implementRenews === 2) { jumped += 1; clock.ms += TTL + TTL / 2; } // the long synchronous work (git) that happened before this renew()
      return original(runId, leaseId, ttlMs, actor);
    };
    const mr = runner(c, fake, {leaseTtlMs: TTL, executors: pair, now: () => clock.ms});
    const vctx = () => ({virtualNow: new Date(clock.ms).toISOString(), jumped, implementRenews});
    const t1 = await boundedTick(mr, c, [r1.runId], "fence tick", vctx);
    expect(jumped, runDiag(c, [r1.runId], vctx())).toBe(1);
    expect(t1, runDiag(c, [r1.runId], vctx())).toMatchObject({claimed: [r1.runId], fenced: [r1.runId], recovered: []});
    expect(fake.calls).toEqual({implement: 0, review: 0}); // fenced BEFORE the paid call
    // what the next tick sees (runner.ts: a leased, non-terminal run whose lease expiry is <= now is taken over)
    const left = c.store.engineGetRun(r1.runId)!;
    expect(left.status).toBe("RUNNING");
    expect(left.step).toBe("IMPLEMENT");
    expect(left.leaseId).not.toBeNull();
    expect(Date.parse(left.leaseExpiresAt ?? "")).toBeLessThanOrEqual(clock.ms);
    // the recovery path from exactly this state ("fenced right before the paid call"): taken over, workspace re-entered, implementer called ONCE, run reaches AWAITING_APPROVAL
    const t2 = await boundedTick(mr, c, [r1.runId], "fence recovery tick", vctx);
    expect(t2.recovered, runDiag(c, [r1.runId], vctx())).toEqual([r1.runId]);
    expect(runOf(c, r1.runId).status, runDiag(c, [r1.runId], vctx())).toBe("AWAITING_APPROVAL");
    expect(fake.calls).toEqual({implement: 1, review: 1});
  });

  it("cap 2: two queued runs really run together (both implementer calls in flight at once); a third waits; cap 1 never overlaps", { timeout: T }, async () => {
    const c = setup(); const fake = new FakeExecutors(okScript()); const t = tracked(fake.pair(), 2);
    const runs = queueRuns(c, t.pair, 3);
    const t1 = await runner(c, fake, {maxConcurrentRuns: 2, executors: t.pair}).tick();
    expect(t1.claimed).toHaveLength(2);
    expect(t1.deferred).toEqual([runs[2].runId]);
    expect(t.st.barrierTimedOut).toBe(false);
    expect(t.st.maxActive).toBe(2);
    expect(runs.slice(0, 2).map(r => runOf(c, r.runId).status)).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
    expect(runOf(c, runs[2].runId).status).toBe("QUEUED");

    const c1 = setup("tA"); const f1 = new FakeExecutors(okScript()); const t1b = tracked(f1.pair());
    queueRuns(c1, t1b.pair, 2);
    const runner1 = runner(c1, f1, {executors: t1b.pair});
    await runner1.tick(); await runner1.tick();
    expect(t1b.st.maxActive).toBe(1);
    expect(f1.calls.implement).toBe(2);
  });

  it("stale-lease recovery respects the cap as well: with two expired leases and cap 1, one run is taken over and the other is deferred", { timeout: T }, async () => {
    const clock = {skewMs: 0}; const c = setup("tA", {clock}); const fake = new FakeExecutors(okScript()); const pair = fake.pair();
    const [r1, r2] = queueRuns(c, pair, 2);
    const first = await runner(c, fake, {maxConcurrentRuns: 2, maxStepsPerTick: 0}).tick(); // both leased, no step executed
    expect(first.claimed).toEqual([r1.runId, r2.runId]);
    expect([runOf(c, r1.runId).status, runOf(c, r2.runId).status]).toEqual(["LEASED", "LEASED"]);
    clock.skewMs = 3_600_000; // one hour later (store and runner clock): both leases are expired
    const later = await runner(c, fake, {maxConcurrentRuns: 1, maxStepsPerTick: 0, now: () => Date.now() + clock.skewMs}).tick();
    expect(later.recovered).toEqual([r1.runId]);
    expect(later.deferred).toEqual([r2.runId]);
  });

  it("an invalid cap is a construction error (never silently 1); the default is 1", () => {
    const c = setup(); const fake = new FakeExecutors(okScript());
    for (const bad of [0, -1, 1.5, 17, Number.NaN, "2" as unknown as number]) expect(() => runner(c, fake, {maxConcurrentRuns: bad})).toThrow("RUNNER_MAX_CONCURRENT_RUNS_INVALID");
    expect(() => runner(c, fake)).not.toThrow();
    expect(() => runner(c, fake, {maxConcurrentRuns: 16})).not.toThrow();
  });
});

describe("B3a control API", () => {
  const token = crypto.randomBytes(24).toString("hex");
  const hdr = {"x-uasco-control-token": token, host: "127.0.0.1:3210"};
  // repoRoot geçici dizindir (cockpit gerçek registry okumaz); runner'ın env policy dosyası oraya kopyalanır.
  const mk = (c: {runtime: string; dataDir: string}, tenantId: string, extra: Record<string, unknown> = {}) =>
    (fs.mkdirSync(path.join(tmp, "config"), {recursive: true}), fs.copyFileSync(ENV_POLICY, path.join(tmp, "config", "environment-policy.json")),
    buildServer({sandbox: TEST_HOST_PASSTHROUGH_SANDBOX, controlToken: token, runtime: c.runtime, repoRoot: tmp, dataDir: c.dataDir, tenantId, port: 3210, logger: false, ...extra}));

  it("POST /v1/missions/:id/runs gate order, GET /v1/work-runs and tenant isolation", { timeout: T }, async () => {
    const c = setup("tA"); const fake = new FakeExecutors(okScript());
    const a = mk(c, "tA", {executors: fake.pair()}), b = mk(c, "tB", {executors: fake.pair()});
    const url = `/v1/missions/${c.missionId}/runs`;
    // stop -> 423 even with a bad body
    activateGlobalStop(c.stopFile, "x", "TEST");
    expect((await a.inject({method: "POST", url, headers: hdr, payload: {bogus: 1}})).statusCode).toBe(423);
    fs.rmSync(c.stopFile, {force: true});
    // policy deny -> 403 before schema
    const denied = mk(c, "tA", {executors: fake.pair(), policyContext: {scopeAllowed: false}});
    expect((await denied.inject({method: "POST", url, headers: hdr, payload: {bogus: 1}})).statusCode).toBe(403);
    await denied.close();
    expect((await a.inject({method: "POST", url, headers: hdr, payload: {bogus: 1}})).statusCode).toBe(400);
    expect((await a.inject({method: "POST", url, headers: {host: "127.0.0.1:3210"}, payload: {}})).statusCode).toBe(403);
    // no executor configured -> 409, nothing written
    const none = mk(c, "tA");
    expect((await none.inject({method: "POST", url, headers: hdr, payload: {}})).json()).toEqual({error: "EXECUTOR_NOT_CONFIGURED", reason: "EXECUTOR_NOT_CONFIGURED"});
    await none.close();
    // other tenant cannot start a run on tA's mission
    expect((await b.inject({method: "POST", url, headers: hdr, payload: {}})).statusCode).toBe(404);
    const res = await a.inject({method: "POST", url, headers: hdr, payload: {idempotencyKey: "k1"}});
    expect(res.statusCode).toBe(201);
    const run = res.json().run;
    expect(run).toEqual(expect.objectContaining({status: "QUEUED", tenantId: "tA", executor: {implementer: "FAKE_IMPLEMENTER", reviewer: "FAKE_REVIEWER"}}));
    expect((await a.inject({method: "POST", url, headers: hdr, payload: {idempotencyKey: "k1"}})).statusCode).toBe(200);
    const dup = await a.inject({method: "POST", url, headers: hdr, payload: {}});
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({error: "WORKOS_CONFLICT", reason: "RUN_ALREADY_ACTIVE"});
    expect((await a.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: hdr})).json().run.runId).toBe(run.runId);
    expect((await a.inject({method: "GET", url: `/v1/work-runs?missionId=${c.missionId}`, headers: hdr})).json().runs).toHaveLength(1);
    expect((await b.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: hdr})).statusCode).toBe(404);
    expect((await b.inject({method: "GET", url: "/v1/work-runs", headers: hdr})).json()).toEqual({runs: []});
    expect((await b.inject({method: "GET", url: `/v1/work-runs?missionId=${c.missionId}`, headers: hdr})).json()).toEqual({runs: []});
    // a mission that is not AUTHORIZED/PLANNED cannot be started
    const m2 = c.store.createMission({tenantId: "tA", projectId: c.projectId, title: "draft", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "F"});
    const nr = await a.inject({method: "POST", url: `/v1/missions/${m2.missionId}/runs`, headers: hdr, payload: {}});
    expect(nr.statusCode).toBe(409);
    expect(nr.json()).toEqual({error: "WORKOS_CONFLICT", reason: "MISSION_NOT_RUNNABLE"});
    // legacy /v1/runs keeps its own shape and does not list work runs
    expect((await a.inject({method: "GET", url: "/v1/runs", headers: hdr})).json()).toEqual({count: 0, runs: []});
    await a.close(); await b.close();
  });

  it("path traversal ids are rejected", { timeout: T }, async () => {
    const c = setup("tA"); const app = mk(c, "tA", {executors: new FakeExecutors(okScript()).pair()});
    for (const u of ["/v1/work-runs/..%2F..%2Fjournal.jsonl", "/v1/work-runs/run_..%2F..%2Fx", `/v1/work-runs/run_${"0".repeat(23)}`, "/v1/work-runs?missionId=..%2Fmsn_x"]) {
      const r = await app.inject({method: "GET", url: u, headers: hdr});
      expect(r.statusCode).toBe(400);
    }
    expect((await app.inject({method: "POST", url: "/v1/missions/..%2F..%2Fx/runs", headers: hdr, payload: {}})).statusCode).toBe(400);
    await app.close();
  });

  it("project/mission testCommand must be an allow-listed argv array", { timeout: T }, async () => {
    const c = setup("tA"); const app = mk(c, "tA");
    const post = (payload: unknown) => app.inject({method: "POST", url: "/v1/projects", headers: hdr, payload: payload as object});
    expect((await post({name: "x", environmentId: "dev", testCommand: ["node", "t.mjs"]})).statusCode).toBe(201);
    for (const bad of [["bash", "-c", "rm -rf /"], "node t.mjs", [], ["C:/node.exe"], ["node", "a\nb"]]) expect((await post({name: "x", environmentId: "dev", testCommand: bad})).statusCode).toBe(400);
    expect((await app.inject({method: "POST", url: "/v1/missions", headers: hdr, payload: {projectId: c.projectId, title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", testCommand: ["sh", "x"]}})).statusCode).toBe(400);
    await app.close();
  });

  it("cockpit workforce.activeWorkerRuns counts LEASED/RUNNING/CHECKPOINTING/VERIFYING runs per tenant", { timeout: T }, async () => {
    const c = setup("tA"); const fake = new FakeExecutors(okScript());
    const a = mk(c, "tA", {executors: fake.pair()}), b = mk(c, "tB");
    const wf = async (app: ReturnType<typeof buildServer>) => (await app.inject({method: "GET", url: "/v1/cockpit", headers: hdr})).json().workforce;
    expect(await wf(a)).toEqual(expect.objectContaining({state: "VERIFIED", activeWorkerRuns: 0}));
    const run = (await a.inject({method: "POST", url: `/v1/missions/${c.missionId}/runs`, headers: hdr, payload: {}})).json().run;
    expect((await wf(a)).activeWorkerRuns).toBe(0); // QUEUED is not an active worker
    const eng = runner(c, fake, {maxStepsPerTick: 1});
    await eng.tick();
    expect(runOf(c, run.runId).status).toBe("CHECKPOINTING");
    const w = await wf(a);
    expect(w).toEqual(expect.objectContaining({state: "VERIFIED", activeWorkerRuns: 1}));
    expect(Object.keys(w).sort()).toEqual(["activeWorkerRuns", "canonicalRegisteredRoles", "registeredRoles", "registeredRolesAuthority", "source", "state", "targetRoles"]);
    expect((await wf(b)).activeWorkerRuns).toBe(0);
    for (let i = 0; i < 20 && runOf(c, run.runId).status !== "AWAITING_APPROVAL"; i++) await eng.tick();
    expect(runOf(c, run.runId).status).toBe("AWAITING_APPROVAL");
    expect((await wf(a)).activeWorkerRuns).toBe(0);
    await a.close(); await b.close();
  });

  it("LANE-C: the REVIEW step of a role-assigned run goes through the bound reviewer role; a BLOCKED verdict is recorded in the trace; unbound reviewer role BLOCKS before any review call", { timeout: T }, async () => {
    // BLOCKED verdict (remediation cycle 0) is recorded as a COMPLETED agent with verdict=BLOCKED
    const c = setup(); const fake = new FakeExecutors(okScript({review: call => ({verdict: call === 1 ? "BLOCKED" : "CLEAN", findings: call === 1 ? [{severity: "HIGH", title: "x"}] : []})}));
    const p = fake.pair();
    const created = c.store.createRun({tenantId: "tA", missionId: c.missionId, roleId: "UASCO-0085", executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    await runner(c, fake).tick();
    const run = runOf(c, created.runId);
    const reviewTraces = run.evidence.filter(e => e.kind === "AGENT_TRACE" && e.step === "REVIEW");
    expect(reviewTraces.length).toBeGreaterThanOrEqual(2);
    expect(reviewTraces[0].note).toContain("verdict=BLOCKED");
    expect(reviewTraces[reviewTraces.length - 1].note).toContain("verdict=CLEAN");
    // an unbound/mismatched configured reviewer role BLOCKS before the reviewer adapter is called
    for (const bad of ["UASCO-0085", "UASCO-0001"]) {
      const c2 = setup(); const f2 = new FakeExecutors(okScript()); const p2 = f2.pair();
      const cr = c2.store.createRun({tenantId: "tA", missionId: c2.missionId, roleId: "UASCO-0085", executor: {implementer: p2.implementer.identity, reviewer: p2.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
      await runner(c2, f2, {reviewerRoleId: bad}).tick();
      const r2 = runOf(c2, cr.runId);
      expect(r2.status).toBe("BLOCKED");
      expect(f2.calls.review).toBe(0);
      expect(JSON.stringify(journal(c2))).toContain("ROLE_NOT_EXECUTABLE:");
    }
    // role-less runs: no AGENT_TRACE at all (unchanged behaviour)
    const c3 = setup(); const f3 = new FakeExecutors(okScript()); const created3 = start(c3, f3);
    await runner(c3, f3).tick();
    expect(runOf(c3, created3.runId).evidence.some(e => e.kind === "AGENT_TRACE")).toBe(false);
  });

  it("LANE-C: a product run started over HTTP with the bound developer role executes through the runner, writes AGENT_TRACE evidence visible via GET; a non-implementer role is BLOCKED visibly", { timeout: T }, async () => {
    const c = setup("tA"); const fake = new FakeExecutors(okScript());
    const app = mk(c, "tA", {executors: fake.pair(), runner: {enabled: true, intervalMs: 250, retryBackoffMs: [0, 0], security: fakeSecurity(`${c.dataDir}-sec`).options}});
    await app.ready();
    const wait = async (runId: string, done: (s: string) => boolean) => {
      const deadline = Date.now() + 90_000; let r: any;
      while (Date.now() < deadline) { r = (await app.inject({method: "GET", url: `/v1/work-runs/${runId}`, headers: hdr})).json().run; if (done(r.status)) break; await new Promise(x => setTimeout(x, 200)); }
      return r;
    };
    const started = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/runs`, headers: hdr, payload: {roleId: "UASCO-0085"}});
    expect(started.statusCode).toBe(201);
    expect(started.json().run.roleId).toBe("UASCO-0085");
    const done = await wait(started.json().run.runId, s => s === "AWAITING_APPROVAL");
    expect(done.status).toBe("AWAITING_APPROVAL");
    expect(fake.calls.implement).toBe(1);
    const trace = done.evidence.filter((e: any) => e.kind === "AGENT_TRACE");
    expect(trace.map((e: any) => e.step)).toEqual(["IMPLEMENT", "REVIEW"]);
    expect(trace[0].note).toBe(`agent=agent-${done.runId}-implement-c0 role=UASCO-0085 state=COMPLETED`);
    expect(trace[1].note).toBe(`agent=agent-${done.runId}-review-c0 role=UASCO-0252 state=COMPLETED verdict=CLEAN`);
    expect(done.evidence.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["IMPLEMENT", "AGENT_TRACE", "REVIEW"]));
    // a second run with a reviewer-route role never reaches the builder
    const c2 = setup("tB"); const fake2 = new FakeExecutors(okScript());
    const app2 = mk(c2, "tB", {executors: fake2.pair(), runner: {enabled: true, intervalMs: 250, retryBackoffMs: [0, 0], security: fakeSecurity(`${c2.dataDir}-sec`).options}});
    await app2.ready();
    const bad = (await app2.inject({method: "POST", url: `/v1/missions/${c2.missionId}/runs`, headers: hdr, payload: {roleId: "UASCO-0252"}})).json().run;
    const deadline = Date.now() + 90_000; let blocked: any;
    while (Date.now() < deadline) { blocked = (await app2.inject({method: "GET", url: `/v1/work-runs/${bad.runId}`, headers: hdr})).json().run; if (blocked.status === "BLOCKED") break; await new Promise(x => setTimeout(x, 200)); }
    expect(blocked.status).toBe("BLOCKED");
    expect(fake2.calls.implement).toBe(0);
    expect(blocked.evidence.some((e: any) => e.kind === "AGENT_TRACE")).toBe(false);
    await app.close(); await app2.close();
  });

  it("the in-process runner starts only when enabled and drives runs to AWAITING_APPROVAL", { timeout: T }, async () => {
    const c = setup("tA"); const fake = new FakeExecutors(okScript());
    const app = mk(c, "tA", {executors: fake.pair(), runner: {enabled: true, intervalMs: 250, retryBackoffMs: [0, 0], security: fakeSecurity(`${c.dataDir}-sec`).options}});
    await app.ready();
    const run = (await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/runs`, headers: hdr, payload: {}})).json().run;
    const deadline = Date.now() + 90_000;
    let status = "";
    while (Date.now() < deadline) {
      status = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: hdr})).json().run.status;
      if (status === "AWAITING_APPROVAL") break;
      await new Promise(r => setTimeout(r, 200));
    }
    expect(status).toBe("AWAITING_APPROVAL");
    expect((await app.inject({method: "GET", url: `/v1/missions/${c.missionId}`, headers: hdr})).json().mission.status).toBe("REPORTING");
    await app.close();
    // disabled by default: a run stays QUEUED
    const c2 = setup("tB"); const off = mk(c2, "tB", {executors: new FakeExecutors(okScript()).pair()});
    await off.ready();
    const r2 = (await off.inject({method: "POST", url: `/v1/missions/${c2.missionId}/runs`, headers: hdr, payload: {}})).json().run;
    await new Promise(r => setTimeout(r, 600));
    expect((await off.inject({method: "GET", url: `/v1/work-runs/${r2.runId}`, headers: hdr})).json().run.status).toBe("QUEUED");
    await off.close();
  });
});

describe("LANE-C bound role TaskLimits are enforced by the runner (never loosened, role-less runs unchanged)", () => {
  const roleRun = (c: Ctx, fake: FakeExecutors, roleId: string | null) => { const p = fake.pair(); return c.store.createRun({tenantId: "tA", missionId: c.missionId, roleId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}); };
  const manyFiles = (n: number, tag = "f") => Object.fromEntries(Array.from({length: n}, (_, i) => [`gen/${tag}-${i}.txt`, `${i}\n`]));
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
