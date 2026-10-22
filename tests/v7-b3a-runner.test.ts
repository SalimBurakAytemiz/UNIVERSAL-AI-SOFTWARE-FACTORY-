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
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors, executorsFromEnv, parseReviewOutput} from "../core/workos/executors.js";
import type {FakeScript, MissionSpec} from "../core/workos/executors.js";
import {RUN_STATUSES, TERMINAL_RUN_STATUSES, canRunTransition} from "../core/workos/run-state.js";
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
function setup(tenantId = "tA", opts: {url?: boolean; testCommand?: string[] | null} = {}): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const {repo, head} = makeRepo(id);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `runtime-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir);
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
