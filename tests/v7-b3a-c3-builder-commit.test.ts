// //TR: Bu test V7 B3a cycle-3 remediation'ını doğrular: F-B3A-C2-001 (yalnız dosya düzenleyen, commit edemeyen broker benzeri builder'ın çıktısını engine commit eder, üretilen SHA VERIFY'a akar, değişiklik yoksa BLOCKED, .git'e dokunan builder reddedilir) ve F-B3A-C2-002 (secret taraması taze klonda --text --no-textconv ile; workspace textconv / -diff attribute atlatması, commit mesajı ve hunk içi "+++" içerik satırı yakalanır). Gerçek sağlayıcı çağrılmaz.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./support/test-sandbox.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {EditOnlyImplementer, FAKE_EXECUTOR_SCRIPT, FakeExecutors} from "../core/workos/executors.js";
import type {ExecutorPair, ImplementerAdapter} from "../core/workos/executors.js";
import {BUILDER_GIT_IDENTITY, forbiddenChange} from "../core/workos/builder-output.js";
import {findSecretKinds, scanCommitMessagesForSecrets, scanDiffForSecrets} from "../core/workos/secret-scan.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 120_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b3a-c3-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
// Test token'ı her çalışmada crypto.randomBytes ile üretilir; repo'da gerçek değer yok.
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const fakeAws = () => ["AK", "IA"].join("") + [...crypto.randomBytes(16)].map(b => ALNUM[b % 32]).join("");
const childEnv = (): NodeJS.ProcessEnv => ({PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "", TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? ""});
const TEST_SCRIPT = `import fs from "node:fs";\nconst v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";\nprocess.exit(v === "ok" ? 0 : 1);\n`;

interface Ctx { store: WorkOsStore; dataDir: string; stopFile: string; head: string; missionId: string }
function setup(): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const repo = path.join(tmp, `src-${id}`);
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
  fs.writeFileSync(path.join(repo, "README.txt"), "base\n");
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `runtime-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "Add feature", objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
  return {store, dataDir, stopFile: path.join(runtime, "GLOBAL_STOP.json"), head: git(repo, ["rev-parse", "HEAD"]), missionId: m.missionId};
}
// Broker benzeri builder: fake-executor.mjs yalnız dosya yazar (noCommit), commit'i EditOnlyImplementer (engine) atar.
function editOnlyPair(directive: unknown, argv?: (ws: string) => string[]): {pair: ExecutorPair; fake: FakeExecutors} {
  const fake = new FakeExecutors({implement: () => ({}), review: () => ({verdict: "CLEAN"})});
  const implementer = new EditOnlyImplementer("FAKE_EDIT_ONLY_BUILDER", ENV_POLICY, ws => ({argv: argv ? argv(ws) : [process.execPath, FAKE_EXECUTOR_SCRIPT, "implement", ws], env: childEnv(), input: JSON.stringify(directive)}));
  return {pair: {kind: "FAKE", implementer, reviewer: fake.pair().reviewer}, fake};
}
async function drive(c: Ctx, pair: ExecutorPair) {
  const r = c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  await new MissionRunner({executionGate: testExecutionGate(), store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${c.dataDir}-sec`).options}).tick();
  return c.store.getRun({tenantId: "tA"}, r.runId)!;
}
const missionStatus = (c: Ctx) => c.store.getMission({tenantId: "tA"}, c.missionId)!.status;
const work = (c: Ctx, runId: string) => path.join(c.dataDir, "runs", runId, "work");

describe("F-B3A-C2-001: engine commits the output of an edit-only builder", () => {
  it("a builder that only edits files (no commit) still yields a commit by the builder identity; its SHA flows into VERIFY/REVIEW/REPORT", { timeout: T }, async () => {
    const c = setup();
    const {pair, fake} = editOnlyPair({files: {"feature.txt": "ok\n", "src/new.txt": "x\n"}, noCommit: true});
    const run = await drive(c, pair);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(missionStatus(c)).toBe("REPORTING");
    const impl = run.evidence.find(e => e.kind === "IMPLEMENT")!;
    expect(impl.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(run.headSha).toBe(impl.commitSha);
    expect(run.evidence.find(e => e.kind === "SECRET_SCAN")!.commitSha).toBe(impl.commitSha);
    expect(run.evidence.find(e => e.kind === "VERIFY_TESTS")!.commitSha).toBe(impl.commitSha);
    expect(run.evidence.find(e => e.kind === "REVIEW")!.commitSha).toBe(impl.commitSha);
    expect(fake.calls.review).toBe(1);
    const ws = work(c, run.runId);
    const [author, committer, parent] = git(ws, ["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%P", impl.commitSha!]).split("\n");
    expect(author).toBe(`${BUILDER_GIT_IDENTITY.name} <${BUILDER_GIT_IDENTITY.email}>`);
    expect(committer).toBe(author);
    expect(parent).toBe(c.head);
    expect(git(ws, ["show", "--name-only", "--format=", impl.commitSha!]).split("\n").sort()).toEqual(["feature.txt", "src/new.txt"]);
    expect(git(ws, ["status", "--porcelain"])).toBe("");
    const log = fs.readFileSync(path.join(c.dataDir, impl.logPath!), "utf8");
    expect(log).toContain(`BUILDER_COMMIT ${impl.commitSha}`);
  });

  it("an edit-only builder that changes nothing -> run BLOCKED BUILDER_PRODUCED_NO_CHANGE, no VERIFY", { timeout: T }, async () => {
    const c = setup();
    const {pair, fake} = editOnlyPair({files: {}, noCommit: true});
    const run = await drive(c, pair);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("BUILDER_PRODUCED_NO_CHANGE");
    expect(missionStatus(c)).toBe("BLOCKED");
    expect(run.headSha).toBeNull();
    expect(run.evidence.map(e => e.kind)).toEqual(["WORKSPACE", "IMPLEMENT"]);
    expect(run.evidence[1].note).toBe("BUILDER_PRODUCED_NO_CHANGE");
    expect(fake.calls.review).toBe(0);
  });

  it("an edit-only builder that writes into .git (config textconv) is refused before any engine git command", { timeout: T }, async () => {
    const c = setup();
    const script = `require("fs").appendFileSync(".git/config", "\\n[diff \\"hide\\"]\\n\\ttextconv = true\\n"); require("fs").writeFileSync("feature.txt", "ok\\n");`;
    const {pair} = editOnlyPair({}, () => [process.execPath, "-e", script]);
    const run = await drive(c, pair);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("BUILDER_TOUCHED_GIT_INTERNALS");
    expect(git(work(c, run.runId), ["rev-parse", "HEAD"])).toBe(c.head);
  });

  it("classifies forbidden builder paths (.git internals, escapes, embedded repos)", () => {
    const ws = fs.mkdtempSync(path.join(tmp, "ws-"));
    fs.mkdirSync(path.join(ws, "src"));
    expect(forbiddenChange(ws, "src/a.ts")).toBeNull();
    expect(forbiddenChange(ws, "README.md")).toBeNull();
    expect(forbiddenChange(ws, ".git/config")).toBe("GIT_INTERNALS");
    expect(forbiddenChange(ws, "sub/.GIT/HEAD")).toBe("GIT_INTERNALS");
    expect(forbiddenChange(ws, ".git./config")).toBe("GIT_INTERNALS");
    expect(forbiddenChange(ws, "GIT~1/config")).toBe("GIT_INTERNALS");
    expect(forbiddenChange(ws, "../outside.txt")).toBe("OUTSIDE_WORKSPACE");
    expect(forbiddenChange(ws, "nested/")).toBe("EMBEDDED_REPOSITORY");
  });
});

// Kendi commit'ini atan (eski fake gibi) ama workspace .git/config ve .gitattributes ile taramayı gizlemeye çalışan implementer.
function hidingImplementer(secret: string, mode: "textconv" | "binary"): ImplementerAdapter {
  return {
    identity: "FAKE_HIDING_IMPLEMENTER",
    async implement(ws) {
      const at = new Date().toISOString();
      if (mode === "textconv") {
        fs.appendFileSync(path.join(ws, ".git", "config"), "\n[diff \"hide\"]\n\ttextconv = true\n");
        fs.writeFileSync(path.join(ws, ".gitattributes"), "* diff=hide\n");
      } else fs.writeFileSync(path.join(ws, ".gitattributes"), "*.txt -diff\n");
      fs.writeFileSync(path.join(ws, "feature.txt"), "ok\n");
      fs.writeFileSync(path.join(ws, "config.txt"), `aws=${secret}\n`);
      git(ws, ["add", "-A"]);
      git(ws, ["-c", "user.name=FAKE", "-c", "user.email=fake@local.invalid", "commit", "-q", "-m", "hide"]);
      return {exitCode: 0, log: "hiding implementer\n", argv: ["in-process"], startedAt: at, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false};
    }
  };
}

describe("F-B3A-C2-002: VERIFY secret scan cannot be bypassed by the implementer workspace", () => {
  it("workspace .git/config textconv + '* diff=hide' (demonstrated bypass) -> SECRET_IN_DIFF", { timeout: T }, async () => {
    const c = setup(), secret = fakeAws();
    const fake = new FakeExecutors({implement: () => ({}), review: () => ({verdict: "CLEAN"})});
    const run = await drive(c, {kind: "FAKE", implementer: hidingImplementer(secret, "textconv"), reviewer: fake.pair().reviewer});
    // Önkoşul: workspace'te textconv'a uyan düz bir diff secret'ı gerçekten gizliyor (eski davranış).
    const ws = work(c, run.runId);
    expect(findSecretKinds(git(ws, ["diff", c.head, run.headSha!]))).toEqual([]);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_IN_DIFF");
    const scan = run.evidence.find(e => e.kind === "SECRET_SCAN")!;
    expect(scan.secretHits).toEqual([{kind: "AWS_ACCESS_KEY", file: "config.txt", line: 1}]);
    expect(fake.calls.review).toBe(0);
    expect(fs.readFileSync(path.join(c.dataDir, "journal.jsonl"), "utf8")).not.toContain(secret);
  });

  it("checked-in '-diff' attribute (binary hiding) -> SECRET_IN_DIFF", { timeout: T }, async () => {
    const c = setup(), secret = fakeAws();
    const fake = new FakeExecutors({implement: () => ({}), review: () => ({verdict: "CLEAN"})});
    const run = await drive(c, {kind: "FAKE", implementer: hidingImplementer(secret, "binary"), reviewer: fake.pair().reviewer});
    expect(run.reason).toBe("SECRET_IN_DIFF");
    expect(run.evidence.find(e => e.kind === "SECRET_SCAN")!.secretHits).toEqual([{kind: "AWS_ACCESS_KEY", file: "config.txt", line: 1}]);
  });

  it("a secret only in the commit message -> SECRET_IN_DIFF (commit-message hit, value not journaled)", { timeout: T }, async () => {
    const c = setup(), secret = fakeAws();
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}, message: `add feature\n\nkey ${secret}`}), review: () => ({verdict: "CLEAN"})});
    const run = await drive(c, fake.pair());
    expect(run.reason).toBe("SECRET_IN_DIFF");
    const hits = run.evidence.find(e => e.kind === "SECRET_SCAN")!.secretHits!;
    expect(hits).toEqual([{kind: "AWS_ACCESS_KEY", file: `commit-message:${run.headSha}`, line: 3}]);
    expect(fs.readFileSync(path.join(c.dataDir, "journal.jsonl"), "utf8")).not.toContain(secret);
  });

  it("an added line starting with '++ ' (shown as '+++ ' inside a hunk) is content and is scanned", { timeout: T }, async () => {
    const secret = fakeAws();
    const diff = ["diff --git a/f.txt b/f.txt", "index 1111111..2222222 100644", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " base", "--- removed", `+++ ${secret}`, ""].join("\n");
    expect(scanDiffForSecrets(diff)).toEqual([{kind: "AWS_ACCESS_KEY", file: "f.txt", line: 2}]);
    const c = setup();
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n", "notes.txt": `++ ${secret}\n`}}), review: () => ({verdict: "CLEAN"})});
    const run = await drive(c, fake.pair());
    expect(run.reason).toBe("SECRET_IN_DIFF");
    expect(run.evidence.find(e => e.kind === "SECRET_SCAN")!.secretHits).toEqual([{kind: "AWS_ACCESS_KEY", file: "notes.txt", line: 1}]);
  });

  it("commit message scanner attributes hits per commit and line", () => {
    const sha = "a".repeat(40), secret = fakeAws();
    expect(scanCommitMessagesForSecrets(`commit ${sha}\nsubject\n\nbody ${secret}\n`)).toEqual([{kind: "AWS_ACCESS_KEY", file: `commit-message:${sha}`, line: 3}]);
    expect(scanCommitMessagesForSecrets(`commit ${sha}\nclean\n`)).toEqual([]);
  });
});
