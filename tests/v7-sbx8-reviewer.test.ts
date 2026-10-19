// //TR: Bu test SBX-8 D'yi doğrular: LOCAL_CLAUDE reviewer'ı yalnız okuma araçları ve builder ile aynı yalıtım bayraklarıyla, ayrı reviewer profiliyle (CLAUDE_CONFIG_DIR) çalışır; profil oturum açılmamışsa review geçersizdir (BLOCKED CLAUDE_PROFILE_LOGIN_REQUIRED, süreç başlamaz);
// //TR: review sonrası çalışma alanı bayt düzeyinde aynı değilse (dosya, yok sayılan dosya, .git, HEAD) review GEÇERSİZ olur ve asla CLEAN sayılmaz; runner bu nedenleri ve implementer profil reddini BLOCK nedeni olarak korur. Gerçek Claude CLI çalıştırılmaz (enjekte edilen sahte reviewer süreci).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {EditOnlyImplementer, FakeExecutors, LocalClaudeExecutors, REVIEWER_DISALLOWED_TOOLS, reviewerArgv} from "../core/workos/executors.js";
import type {ExecutorPair, MissionSpec, ProcOptions, ProcResult, ReviewerAdapter} from "../core/workos/executors.js";
import {CLAUDE_CREDENTIAL_STORE_FILE, CLAUDE_ISOLATION_FLAGS, claudeProfileDir} from "../core/workos/claude-profiles.js";
import {BROKER_ISOLATION_FLAGS} from "../scripts/claude-builder-broker.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {testExecutionGate} from "./support/test-sandbox.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx8-rv-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const SPEC: MissionSpec = {runId: "run_" + "0".repeat(24), missionId: "msn_" + "1".repeat(24), projectId: "prj_" + "2".repeat(24), title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", cycle: 0, baseSha: ""};
function cleanClone(): string {
  const src = path.join(tmp, "src"), clone = path.join(tmp, "review-clone");
  fs.mkdirSync(src, {recursive: true});
  git(src, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(src, "README.txt"), "base\n");
  fs.writeFileSync(path.join(src, ".gitignore"), "*.tmp\n");
  git(src, ["add", "-A"]);
  git(src, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  git(tmp, ["clone", "-q", "--no-hardlinks", src, clone]);
  return clone;
}
function controlRoot(): string {
  const c = path.join(tmp, "userdata", "control"), sha = crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");
  fs.mkdirSync(path.join(c, ".ai", "runtime"), {recursive: true});
  fs.writeFileSync(path.join(c, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: process.execPath, launcherSha256: sha, version: "fake"}}));
  return c;
}
const login = (control: string, role: "implementer" | "reviewer") => { fs.mkdirSync(claudeProfileDir(control, role), {recursive: true}); fs.writeFileSync(path.join(claudeProfileDir(control, role), CLAUDE_CREDENTIAL_STORE_FILE), ""); };
// Sahte reviewer süreci: argv/env'i kaydeder, isteğe bağlı olarak çalışma alanını bozar ve CLEAN yazar (geçersizlik kontrolü bunu yakalamalı).
function fakeReviewer(calls: Array<{argv: string[]; opts: ProcOptions}>, mutate?: (cwd: string) => void) {
  return async (argv: string[], opts: ProcOptions): Promise<ProcResult> => {
    calls.push({argv, opts});
    mutate?.(opts.cwd);
    const at = new Date().toISOString();
    return {argv, exitCode: 0, stdout: '{"verdict":"CLEAN","findings":[]}\n', stderr: "", startedAt: at, endedAt: at, timedOut: false, aborted: false, spawnError: false};
  };
}

describe("SBX-8 D: reviewer argv, profile and read-only enforcement", () => {
  it("argv: read-only tools only, write/command/network/agent/skill/MCP tools denied, same isolation flags as the builder broker", () => {
    const a = reviewerArgv("C:/x/claude.exe");
    expect(a.slice(0, 6)).toEqual(["C:/x/claude.exe", "-p", "--permission-mode", "dontAsk", "--tools", "Read,Grep,Glob"]);
    const deny = a[a.indexOf("--disallowedTools") + 1].split(",");
    for (const t of ["Edit", "Write", "MultiEdit", "Bash", "PowerShell", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "Skill", "mcp__*"]) expect(deny).toContain(t);
    expect(deny).toEqual([...REVIEWER_DISALLOWED_TOOLS]);
    expect([...CLAUDE_ISOLATION_FLAGS]).toEqual(BROKER_ISOLATION_FLAGS);
    for (const f of BROKER_ISOLATION_FLAGS) expect(a).toContain(f);
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("user");
    expect(a).not.toContain("acceptEdits");
  });
  it("reviewer profile not logged in -> invalid review CLAUDE_PROFILE_LOGIN_REQUIRED, reviewer process never started, never CLEAN", async () => {
    const control = controlRoot(), clone = cleanClone(), calls: Array<{argv: string[]; opts: ProcOptions}> = [];
    login(control, "implementer"); // implementer login must not satisfy the reviewer
    const r = await new LocalClaudeExecutors(REPO, control, {runReviewer: fakeReviewer(calls)}).pair().reviewer.review(clone, SPEC, "", {timeoutMs: 10_000});
    expect(r).toMatchObject({verdict: "BLOCKED", valid: false, invalidReason: "CLAUDE_PROFILE_LOGIN_REQUIRED", exitCode: null, transient: false});
    expect(calls).toHaveLength(0);
    expect(fs.readdirSync(claudeProfileDir(control, "reviewer"))).toEqual(["settings.json"]);
  });
  it("logged-in reviewer profile: CLAUDE_CONFIG_DIR is the reviewer profile (not the implementer's, inherited value dropped); untouched workspace -> valid CLEAN", async () => {
    const control = controlRoot(), clone = cleanClone(), calls: Array<{argv: string[]; opts: ProcOptions}> = [];
    login(control, "reviewer");
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "personal-like", ".claude");
    let r;
    try { r = await new LocalClaudeExecutors(REPO, control, {runReviewer: fakeReviewer(calls)}).pair().reviewer.review(clone, SPEC, "diff", {timeoutMs: 10_000}); }
    finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(reviewerArgv(process.execPath));
    expect(calls[0].opts.cwd).toBe(clone);
    expect(calls[0].opts.env.CLAUDE_CONFIG_DIR).toBe(claudeProfileDir(control, "reviewer"));
    expect(calls[0].opts.env.CLAUDE_CONFIG_DIR).not.toBe(claudeProfileDir(control, "implementer"));
    expect(Object.keys(calls[0].opts.env).filter(k => k.toUpperCase() === "CLAUDE_CONFIG_DIR")).toEqual(["CLAUDE_CONFIG_DIR"]);
    expect(r).toMatchObject({verdict: "CLEAN", valid: true});
    expect(r!.invalidReason).toBeUndefined();
  });
  const mutations: Array<[string, (cwd: string) => void, string]> = [
    ["writes a new file", cwd => fs.writeFileSync(path.join(cwd, "notes.md"), "x"), "REVIEW_WORKSPACE_MODIFIED"],
    ["edits a tracked file", cwd => fs.appendFileSync(path.join(cwd, "README.txt"), "x"), "REVIEW_WORKSPACE_MODIFIED"],
    ["writes a git-ignored file", cwd => fs.writeFileSync(path.join(cwd, "scratch.tmp"), "x"), "REVIEW_WORKSPACE_MODIFIED"],
    ["writes agent config", cwd => { fs.mkdirSync(path.join(cwd, ".claude"), {recursive: true}); fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), "{}"); }, "REVIEW_WORKSPACE_MODIFIED"],
    ["changes .git/config", cwd => fs.appendFileSync(path.join(cwd, ".git", "config"), "\n[core]\n\tfsmonitor = x\n"), "REVIEW_WORKSPACE_GIT_CHANGED"],
    ["commits (HEAD moves)", cwd => { fs.writeFileSync(path.join(cwd, "c.txt"), "x"); git(cwd, ["add", "-A"]); git(cwd, ["-c", "user.name=R", "-c", "user.email=r@local.invalid", "commit", "-q", "-m", "x"]); }, "REVIEW_WORKSPACE_HEAD_CHANGED"]
  ];
  for (const [name, mutate, reason] of mutations) {
    it(`reviewer that ${name} -> review INVALID (${reason}) even though it printed CLEAN`, async () => {
      const control = controlRoot(), clone = cleanClone(), calls: Array<{argv: string[]; opts: ProcOptions}> = [];
      login(control, "reviewer");
      const r = await new LocalClaudeExecutors(REPO, control, {runReviewer: fakeReviewer(calls, mutate)}).pair().reviewer.review(clone, SPEC, "", {timeoutMs: 10_000});
      expect(calls).toHaveLength(1);
      expect(r).toMatchObject({verdict: "BLOCKED", valid: false, invalidReason: reason, findings: []});
      expect(r.log).toContain(`REVIEW_INVALID: ${reason}`);
    });
  }
});

describe("SBX-8 D: runner keeps the profile / invalid-review reasons", () => {
  function setup() {
    const repo = path.join(tmp, "proj");
    fs.mkdirSync(repo, {recursive: true});
    git(repo, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "test.mjs"), "process.exit(0);\n");
    git(repo, ["add", "-A"]);
    git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
    const dataDir = path.join(tmp, "data"), runtime = path.join(tmp, "runtime");
    fs.mkdirSync(runtime, {recursive: true});
    const store = new WorkOsStore(dataDir);
    const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "Add feature", objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    return {store, dataDir, stopFile: path.join(runtime, "GLOBAL_STOP.json"), missionId: m.missionId};
  }
  const runWith = async (pair: ExecutorPair) => {
    const c = setup();
    const created = c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    // TEST sağlayıcısı yalnız testin kendi sabit fikstürünü (process.exit(0)) çalıştırır.
    await new MissionRunner({store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, executionGate: testExecutionGate(), security: fakeSecurity(`${c.dataDir}-sec`).options}).tick();
    return c.store.getRun({tenantId: "tA"}, created.runId)!;
  };
  it("implementer profile not logged in -> run BLOCKED CLAUDE_PROFILE_LOGIN_REQUIRED at IMPLEMENT, builder never started (NOT_EXECUTED evidence, exit null)", { timeout: T }, async () => {
    let started = 0;
    const fake = new FakeExecutors({implement: () => ({}), review: () => ({verdict: "CLEAN"})}).pair();
    const implementer = new EditOnlyImplementer("CLAUDE_BUILDER_TEST", ENV_POLICY, () => { started++; return {refuse: "CLAUDE_PROFILE_LOGIN_REQUIRED"}; });
    const run = await runWith({kind: "FAKE", implementer, reviewer: fake.reviewer});
    expect(run).toMatchObject({status: "BLOCKED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", step: "IMPLEMENT"});
    expect(started).toBe(1);
    const ev = run.evidence.find(e => e.kind === "IMPLEMENT")!;
    expect(ev.exitCode).toBeNull();
    expect(ev.note).toBe("CLAUDE_PROFILE_LOGIN_REQUIRED");
    expect(run.evidence.some(e => e.kind === "REVIEW")).toBe(false);
  });
  it("invalid review reasons reach the run: profile -> BLOCKED, workspace change -> FAILED; never CLEAN, never REGRESSION", { timeout: T }, async () => {
    for (const [reason, status] of [["CLAUDE_PROFILE_LOGIN_REQUIRED", "BLOCKED"], ["REVIEW_WORKSPACE_GIT_CHANGED", "FAILED"]] as const) {
      const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})}).pair();
      const reviewer: ReviewerAdapter = {identity: "INVALID_REVIEWER_TEST", async review() { const at = new Date().toISOString(); return {verdict: "BLOCKED", findings: [], valid: false, invalidReason: reason, exitCode: 0, log: "x", argv: ["claude"], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false}; }};
      const run = await runWith({kind: "FAKE", implementer: fake.implementer, reviewer});
      expect(run, reason).toMatchObject({status, reason, step: "REVIEW"});
      expect(run.evidence.find(e => e.kind === "REVIEW")!.note).toBe(`REVIEW_INVALID ${reason}`);
      expect(run.evidence.some(e => e.kind === "REGRESSION_TESTS")).toBe(false);
      fs.rmSync(path.join(tmp, "proj"), {recursive: true, force: true}); fs.rmSync(path.join(tmp, "data"), {recursive: true, force: true}); fs.rmSync(path.join(tmp, "runtime"), {recursive: true, force: true});
    }
  });
});
