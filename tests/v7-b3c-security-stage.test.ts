// //TR: Bu test V7 B3C mission pipeline güvenlik aşamasını doğrular: araç keşfi (PATH -> mutlak yol, sürüm, sha256), SECURITY adımı (taze klonlarda gitleaks + trivy çevrimdışı; SAST dürüstçe NOT_AVAILABLE), politika (SECRET_DETECTED / VULNERABLE_DEPENDENCY BLOCKED, DB yok -> PARTIAL, araç yok -> NOT_INSTALLED), taze klon (workspace .gitattributes/.git/config gizleyemez), secret sızıntısı yok, GLOBAL_STOP ve idempotent yeniden giriş. Testler host araçlarına bağlı değildir (sahte tarayıcı enjekte edilir); host'ta gitleaks kuruluysa bir GERÇEK gitleaks çalıştırması da vardır. Gerçek sağlayıcı çağrılmaz.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {activateGlobalStop} from "../automation/lib/global-stop.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {FakeScript, ImplementerAdapter} from "../core/workos/executors.js";
import {GITLEAKS_ERROR_LINE, buildAddedLineStream, evaluateSecurityPolicy, fakeSecurity, gitRangeProblem, resolveOnPath, runGitleaks, sha256File, trivyDbState, verifyTool} from "../core/workos/security-tools.js";
import type {FakeSecurityDirective, SecurityOptions} from "../core/workos/security-tools.js";
import {buildServer} from "../apps/control-api/src/server.js";
import type {WorkRun} from "../core/workos/types.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b3c-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const TEST_SCRIPT = `import fs from "node:fs";\nconst v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";\nprocess.exit(v === "ok" ? 0 : 1);\n`;
// Planted test secret'ları çalışma anında parçalardan ve rastgele baytlardan kurulur; repoda gerçek veya sabit değer yoktur.
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", LOWNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const rnd = (alphabet: string, n: number) => [...crypto.randomBytes(n)].map(b => alphabet[b % alphabet.length]).join("");
const fakeAws = () => ["AK", "IA"].join("") + rnd(ALNUM, 16);
const fakeStripe = () => ["sk", "_li", "ve_"].join("") + rnd(LOWNUM, 24);

interface Ctx { store: WorkOsStore; dataDir: string; stopFile: string; repo: string; head: string; missionId: string }
function setup(): Ctx {
  const id = crypto.randomBytes(4).toString("hex"), repo = path.join(tmp, `src-${id}`);
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
  return {store, dataDir, stopFile: path.join(runtime, "GLOBAL_STOP.json"), repo, head: git(repo, ["rev-parse", "HEAD"]), missionId: m.missionId};
}
const okScript = (): FakeScript => ({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
function engine(c: Ctx, fake: FakeExecutors, security: SecurityOptions, extra: Partial<RunnerOptions> = {}): MissionRunner {
  return new MissionRunner({store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: fake.pair(), retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security, ...extra});
}
function startRun(c: Ctx, fake: FakeExecutors) {
  const p = fake.pair();
  return c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
}
const runOf = (c: Ctx, id: string) => c.store.getRun({tenantId: "tA"}, id)!;
const missionStatus = (c: Ctx) => c.store.getMission({tenantId: "tA"}, c.missionId)!.status;
const kinds = (r: WorkRun) => r.evidence.map(e => e.kind);
const secEv = (r: WorkRun) => [...r.evidence].reverse().find(e => e.kind === "SECURITY_REPORT")!;
async function drive(directive: FakeSecurityDirective, script: FakeScript = okScript()) {
  const c = setup(), fake = new FakeExecutors(script), sec = fakeSecurity(path.join(tmp, `sec-${crypto.randomBytes(3).toString("hex")}`), directive);
  const r = startRun(c, fake);
  await engine(c, fake, sec.options).tick();
  return {c, fake, sec, run: runOf(c, r.runId)};
}
function allFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === ".git" || e.name.endsWith(".git") || e.name === "work" || e.name.startsWith("security-c") || e.name.startsWith("review-c") || e.name.startsWith("scan-c")) continue; allFiles(p, out); } else out.push(p);
  }
  return out;
}

describe("tool discovery", () => {
  it("resolves tools once to an absolute path with version and sha256; null/missing is NOT_INSTALLED; a broken tool is ERROR", { timeout: T }, () => {
    const sec = fakeSecurity(path.join(tmp, "d1"), {trivy: {installed: false}});
    const c = setup(), fake = new FakeExecutors(okScript());
    const eng = engine(c, fake, sec.options);
    const t = eng.securityTools;
    expect(t.gitleaks.status).toBe("INSTALLED");
    expect(path.isAbsolute(t.gitleaks.path!)).toBe(true);
    expect(t.gitleaks.version).toBe("gitleaks fake 0.0.0-test");
    expect(t.gitleaks.sha256).toBe(sha256File(process.execPath));
    expect(t.trivy).toEqual(expect.objectContaining({tool: "trivy", status: "NOT_INSTALLED", path: null, version: null, sha256: null, reason: "TOOL_NOT_INSTALLED"}));
    expect(t.semgrep.status).toBe("NOT_INSTALLED");
    const exit3 = path.join(tmp, "exit3.mjs"); fs.writeFileSync(exit3, "process.exit(3);\n");
    const bad = new MissionRunner({store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: fake.pair(), security: {tools: {gitleaks: {path: process.execPath, prefixArgs: [exit3]}, trivy: null, semgrep: null}}});
    expect(bad.securityTools.gitleaks).toEqual(expect.objectContaining({status: "ERROR", reason: "VERSION_CHECK_FAILED"}));
  });

  it("PATH lookup uses absolute PATH entries only and never .cmd/.bat shims on Windows", { timeout: T }, () => {
    const dir = path.join(tmp, "bin"); fs.mkdirSync(dir);
    const exe = process.platform === "win32" ? "mytool.exe" : "mytool";
    fs.writeFileSync(path.join(dir, exe), "x"); if (process.platform !== "win32") fs.chmodSync(path.join(dir, exe), 0o755);
    fs.writeFileSync(path.join(dir, "shim.cmd"), "x");
    const sep = process.platform === "win32" ? ";" : ":";
    expect(resolveOnPath("mytool", `relative${sep}${dir}`)).toBe(path.join(dir, exe));
    expect(resolveOnPath("mytool", "relative")).toBeNull();
    expect(resolveOnPath("../mytool", dir)).toBeNull();
    if (process.platform === "win32") expect(resolveOnPath("shim", dir, "win32")).toBeNull();
  });

  it("verifyTool detects a binary that changed after discovery", { timeout: T }, () => {
    const f = path.join(tmp, "tool.bin"); fs.writeFileSync(f, "one");
    const t = {tool: "gitleaks" as const, status: "INSTALLED" as const, path: f, version: "v", sha256: sha256File(f), prefixArgs: []};
    expect(verifyTool(t)).toBeNull();
    fs.writeFileSync(f, "two");
    expect(verifyTool(t)).toBe("TOOL_BINARY_CHANGED");
    expect(verifyTool({...t, status: "NOT_INSTALLED"})).toBe("TOOL_NOT_USABLE");
  });
});

describe("SECURITY step with stub scanners", () => {
  it("CLEAN: PASSED, honest SAST gap, evidence kinds, report.json, mission REPORTING, offline/redacted/range-limited flags", { timeout: T }, async () => {
    const {c, run, sec} = await drive({});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toBe("DELIVERY_DECISION_PENDING_FOUNDER");
    expect(missionStatus(c)).toBe("REPORTING");
    expect(run.checkpoints.map(x => x.step)).toEqual(["WORKSPACE", "IMPLEMENT", "VERIFY", "SECURITY", "REVIEW", "REGRESSION", "REPORT"]);
    expect(kinds(run)).toEqual(["WORKSPACE", "IMPLEMENT", "SECRET_SCAN", "VERIFY_TESTS", "SECURITY_GITLEAKS", "SECURITY_GITLEAKS_ADDED_LINES", "SECURITY_TRIVY", "SECURITY_REPORT", "REVIEW", "REGRESSION_TESTS", "REPORT"]);
    const ev = secEv(run), s = ev.security!;
    expect(s.status).toBe("PASSED");
    expect(s.blockReason).toBeNull();
    expect(s.secrets.builtin).toEqual({status: "CLEAN", hits: 0});
    expect(s.secrets.gitleaks.status).toBe("CLEAN");
    expect(s.sca.status).toBe("CLEAN");
    expect(s.sast).toEqual({status: "NOT_AVAILABLE", reason: "TOOL_NOT_INSTALLED", tool: "semgrep"});
    expect(s.sbom.status).toBe("NOT_AVAILABLE");
    expect(s.gaps).toEqual(expect.arrayContaining(["SAST:TOOL_NOT_INSTALLED"]));
    expect(s.tools.map(x => `${x.tool}:${x.status}`)).toEqual(["gitleaks:INSTALLED", "trivy:INSTALLED", "semgrep:NOT_INSTALLED"]);
    expect(ev.commitSha).toBe(run.headSha);
    expect(ev.logSha256).toBe(crypto.createHash("sha256").update(fs.readFileSync(path.join(c.dataDir, ev.logPath!))).digest("hex"));
    const report = JSON.parse(fs.readFileSync(path.join(c.dataDir, "runs", run.runId, "report.json"), "utf8"));
    expect(report.security.status).toBe("PASSED");
    expect(report.security.sast.status).toBe("NOT_AVAILABLE");
    expect(JSON.parse(fs.readFileSync(path.join(c.dataDir, ev.logPath!), "utf8")).summary.status).toBe("PASSED");
    // Aracın aldığı argv: yalnız base..head, redakte, repo içi config/ignore/allow etkisiz, ağsız trivy.
    const calls = sec.calls();
    const gl = calls.find(x => x.tool === "gitleaks")!.argv, tv = calls.find(x => x.tool === "trivy")!.argv;
    const val = (a: string[], flag: string) => a[a.indexOf(flag) + 1];
    expect(val(gl, "--log-opts")).toBe(`--text --no-textconv --no-ext-diff --diff-merges=first-parent ${run.baseSha}..${run.headSha}`);
    expect(gl).toEqual(expect.arrayContaining(["--redact", "--ignore-gitleaks-allow"]));
    // B3C-C2-F1: ikinci geçiş aynı motor config/ignore ile yolsuz stdin kipinde çalışır.
    const glStdin = calls.filter(x => x.tool === "gitleaks")[1].argv;
    expect(glStdin[0]).toBe("stdin");
    expect(glStdin).toEqual(expect.arrayContaining(["--redact", "--ignore-gitleaks-allow"]));
    expect(val(glStdin, "--config")).toBe(val(gl, "--config"));
    expect(s.secrets.gitleaks.passes).toEqual({git: expect.objectContaining({status: "CLEAN"}), addedLines: expect.objectContaining({status: "CLEAN"})});
    const runDir = path.join(c.dataDir, "runs", run.runId);
    for (const f of ["--config", "--gitleaks-ignore-path", "--report-path"]) expect(path.resolve(val(gl, f)).startsWith(runDir + path.sep)).toBe(true);
    expect(tv).toEqual(expect.arrayContaining(["--skip-db-update", "--skip-java-db-update", "--offline-scan", "--scanners", "vuln"]));
    expect(tv.join(" ")).not.toMatch(/--download|--db-repository|--server/);
    expect(val(tv, "--scanners")).toBe("vuln");
    // Ham gitleaks raporu saklanmaz.
    expect(fs.readdirSync(path.join(runDir, "security")).filter(f => f.startsWith("gitleaks-raw"))).toEqual([]);
  });

  it("gitleaks finding -> run BLOCKED SECRET_DETECTED, mission BLOCKED, review never runs; findings carry rule/file/line/commit only", { timeout: T }, async () => {
    const planted = fakeAws();
    const {c, fake, run} = await drive({gitleaks: {findings: [{ruleId: "aws-access-token", file: "cfg.txt", line: 3, commit: "a".repeat(40)}], plantedSecret: planted}});
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_DETECTED");
    expect(missionStatus(c)).toBe("BLOCKED");
    expect(fake.calls.review).toBe(0);
    const s = secEv(run).security!;
    expect(s.status).toBe("BLOCKED");
    expect(s.blockReason).toBe("SECRET_DETECTED");
    expect(s.secrets.gitleaks.status).toBe("FINDINGS");
    expect(s.secrets.gitleaks.items).toEqual([{ruleId: "aws-access-token", file: "cfg.txt", line: 3, commit: "a".repeat(40)}]);
    expect(JSON.stringify(run)).not.toContain(planted);
  });

  it("HIGH/CRITICAL vulnerabilities -> BLOCKED VULNERABLE_DEPENDENCY with package/version/CVE/severity/fixed version; MEDIUM/LOW are recorded but not blocking", { timeout: T }, async () => {
    const vulns = [{id: "CVE-2099-0001", pkg: "lodash", version: "4.17.15", severity: "HIGH", fixed: "4.17.21"}, {id: "CVE-2099-0002", pkg: "minimist", version: "0.0.8", severity: "CRITICAL"}, {id: "CVE-2099-0003", pkg: "semver", version: "5.0.0", severity: "MEDIUM", fixed: "5.7.2"}];
    const {c, fake, run} = await drive({trivy: {vulns}});
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("VULNERABLE_DEPENDENCY");
    expect(missionStatus(c)).toBe("BLOCKED");
    expect(fake.calls.review).toBe(0);
    const s = secEv(run).security!;
    expect(s.blockReason).toBe("VULNERABLE_DEPENDENCY");
    expect(s.sca.counts).toEqual({CRITICAL: 1, HIGH: 1, MEDIUM: 1});
    expect(s.sca.blocking).toBe(2);
    expect(s.sca.findings[0]).toEqual({package: "minimist", version: "0.0.8", id: "CVE-2099-0002", severity: "CRITICAL", fixedVersion: null, target: "package-lock.json"});
    expect(s.sca.findings[1]).toEqual({package: "lodash", version: "4.17.15", id: "CVE-2099-0001", severity: "HIGH", fixedVersion: "4.17.21", target: "package-lock.json"});

    const soft = await drive({trivy: {vulns: [{id: "CVE-2099-0004", pkg: "a", version: "1.0.0", severity: "MEDIUM"}, {id: "CVE-2099-0005", pkg: "b", version: "1.0.0", severity: "LOW"}]}});
    expect(soft.run.status).toBe("AWAITING_APPROVAL");
    const ss = secEv(soft.run).security!;
    expect(ss.status).toBe("PASSED");
    expect(ss.sca.status).toBe("FINDINGS");
    expect(ss.sca.counts).toEqual({MEDIUM: 1, LOW: 1});
    expect(ss.sca.blocking).toBe(0);
  });

  it("trivy DB missing -> PARTIAL (TRIVY_DB_UNAVAILABLE), trivy is never started, run still reaches Founder decision with an explicit partial notice", { timeout: T }, async () => {
    const {c, run, sec} = await drive({trivy: {dbState: "MISSING"}});
    expect(sec.calls().some(x => x.tool === "trivy")).toBe(false);
    const s = secEv(run).security!;
    expect(s.status).toBe("PARTIAL");
    expect(s.sca).toEqual(expect.objectContaining({status: "PARTIAL", reason: "TRIVY_DB_UNAVAILABLE", dbState: "MISSING"}));
    expect(s.gaps).toContain("SCA:TRIVY_DB_UNAVAILABLE");
    expect(s.founderNote).toMatch(/PARTIAL/);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toBe("DELIVERY_DECISION_PENDING_FOUNDER; SECURITY_COVERAGE_PARTIAL");
    expect(missionStatus(c)).toBe("REPORTING");
    expect(kinds(run)).not.toContain("SECURITY_TRIVY");
    const report = JSON.parse(fs.readFileSync(path.join(c.dataDir, "runs", run.runId, "report.json"), "utf8"));
    expect(report.security.status).toBe("PARTIAL");
    expect(report.security.founderNotice).toMatch(/Security coverage is PARTIAL.*TRIVY_DB_UNAVAILABLE/);
    expect(report.security.sca.reason).toBe("TRIVY_DB_UNAVAILABLE");
    expect(run.evidence.find(e => e.kind === "REPORT")!.note).toBe("security=PARTIAL");
  });

  it("trivy DB stale -> scan still runs but result is PARTIAL; DB error at run time -> PARTIAL; HIGH findings on a stale DB still block", { timeout: T }, async () => {
    const stale = await drive({trivy: {dbState: "STALE"}});
    expect(stale.sec.calls().some(x => x.tool === "trivy")).toBe(true);
    expect(secEv(stale.run).security!.sca).toEqual(expect.objectContaining({status: "PARTIAL", reason: "TRIVY_DB_UNAVAILABLE", dbState: "STALE"}));
    expect(stale.run.status).toBe("AWAITING_APPROVAL");
    const err = await drive({trivy: {dbError: true}});
    expect(secEv(err.run).security!.sca).toEqual(expect.objectContaining({status: "PARTIAL", reason: "TRIVY_DB_UNAVAILABLE", dbState: "RUN_FAILED"}));
    expect(err.run.status).toBe("AWAITING_APPROVAL");
    const hi = await drive({trivy: {dbState: "STALE", vulns: [{id: "CVE-2099-1", pkg: "p", version: "1", severity: "HIGH"}]}});
    expect(hi.run.reason).toBe("VULNERABLE_DEPENDENCY");
  });

  it("trivy not installed -> NOT_INSTALLED (PARTIAL); gitleaks not installed -> NOT_INSTALLED but the built-in scan stays enforced; semgrep present is still not integrated", { timeout: T }, async () => {
    const noTrivy = await drive({trivy: {installed: false}});
    const s1 = secEv(noTrivy.run).security!;
    expect(s1.sca).toEqual(expect.objectContaining({status: "NOT_INSTALLED", reason: "TOOL_NOT_INSTALLED"}));
    expect(s1.status).toBe("PARTIAL");
    expect(s1.gaps).toContain("SCA:TOOL_NOT_INSTALLED");
    expect(noTrivy.run.reason).toMatch(/SECURITY_COVERAGE_PARTIAL/);

    const noGl = await drive({gitleaks: {installed: false}});
    const s2 = secEv(noGl.run).security!;
    expect(s2.secrets.gitleaks).toEqual(expect.objectContaining({status: "NOT_INSTALLED", reason: "TOOL_NOT_INSTALLED"}));
    expect(s2.status).toBe("PARTIAL");
    expect(s2.secrets.builtin.status).toBe("CLEAN");

    const both = await drive({gitleaks: {installed: false}, trivy: {installed: false}});
    expect(secEv(both.run).security!.gaps).toEqual(expect.arrayContaining(["SECRETS_GITLEAKS:TOOL_NOT_INSTALLED", "SCA:TOOL_NOT_INSTALLED", "SAST:TOOL_NOT_INSTALLED"]));

    const withSemgrep = await drive({semgrep: {installed: true}});
    expect(secEv(withSemgrep.run).security!.sast).toEqual({status: "NOT_AVAILABLE", reason: "TOOL_INSTALLED_NOT_INTEGRATED", tool: "semgrep"});
  });

  it("scanner failures are fail-closed: unparsable trivy report or a gitleaks crash -> BLOCKED SECURITY_TOOL_ERROR, never a clean result", { timeout: T }, async () => {
    const badTrivy = await drive({trivy: {raw: "this is not json"}});
    expect(badTrivy.run.status).toBe("BLOCKED");
    expect(badTrivy.run.reason).toBe("SECURITY_TOOL_ERROR");
    expect(secEv(badTrivy.run).security!.sca.status).toBe("ERROR");
    const crash = await drive({gitleaks: {exitCode: 7}});
    expect(crash.run.reason).toBe("SECURITY_TOOL_ERROR");
    expect(secEv(crash.run).security!.secrets.gitleaks).toEqual(expect.objectContaining({status: "ERROR", reason: "UNEXPECTED_EXIT_7"}));
  });

  it("a builder-supplied tool name or repo-controlled value cannot reach a command line: base/head are validated SHAs and package strings are redacted", () => {
    const s = evaluateSecurityPolicy({baseSha: "a".repeat(40), headSha: "b".repeat(40), cycle: 0, tools: [], builtinHits: 1,
      gitleaks: {status: "NOT_INSTALLED", reason: "TOOL_NOT_INSTALLED", count: 0, items: [], rawReportSha256: null},
      trivy: {status: "NOT_INSTALLED", reason: "TOOL_NOT_INSTALLED", counts: {}, blocking: 0, findings: [], truncated: false, rawReportSha256: null},
      semgrep: {tool: "semgrep", status: "NOT_INSTALLED", path: null, version: null, sha256: null}});
    expect(s.blockReason).toBe("SECRET_DETECTED");
    expect(s.founderNote).toMatch(/built-in scan 1/);
    expect(trivyDbState(path.join(tmp, "nope"), Date.now(), 1000).state).toBe("MISSING");
  });
});

// Implementer workspace'inde .gitattributes (-diff) ve .git/config (textconv) ile içeriği gizlemeye çalışır.
function hidingImplementer(files: Record<string, string>): ImplementerAdapter {
  return {
    identity: "FAKE_HIDING_IMPLEMENTER",
    async implement(ws) {
      const at = new Date().toISOString();
      fs.appendFileSync(path.join(ws, ".git", "config"), "\n[diff \"hide\"]\n\ttextconv = true\n");
      for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(ws, rel), content);
      git(ws, ["add", "-A"]);
      git(ws, ["-c", "user.name=FAKE", "-c", "user.email=fake@local.invalid", "commit", "-q", "-m", "hide"]);
      return {exitCode: 0, log: "hiding implementer\n", argv: ["in-process"], startedAt: at, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false};
    }
  };
}
async function driveWith(implementer: ImplementerAdapter, security: SecurityOptions) {
  const c = setup(), fake = new FakeExecutors(okScript());
  const pair = {kind: "FAKE" as const, implementer, reviewer: fake.pair().reviewer};
  const r = c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  await new MissionRunner({store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security}).tick();
  return {c, run: runOf(c, r.runId)};
}

// Implementer geçmişe "evil merge" sokar: main2 ve side commit'leri, ardından --no-commit merge + yalnız merge commit'inde görünen evil.cfg (B3C-C1-F1).
function evilMergeImplementer(secret: string): ImplementerAdapter {
  return {
    identity: "FAKE_EVIL_MERGE_IMPLEMENTER",
    async implement(ws) {
      const at = new Date().toISOString(), id = ["-c", "user.name=FAKE", "-c", "user.email=fake@local.invalid"];
      const main = git(ws, ["rev-parse", "--abbrev-ref", "HEAD"]);
      git(ws, ["checkout", "-q", "-b", "side"]);
      fs.writeFileSync(path.join(ws, "side.txt"), "side\n");
      git(ws, ["add", "-A"]); git(ws, [...id, "commit", "-q", "-m", "side"]);
      git(ws, ["checkout", "-q", main]);
      fs.writeFileSync(path.join(ws, "feature.txt"), "ok\n"); fs.writeFileSync(path.join(ws, "main2.txt"), "main2\n");
      git(ws, ["add", "-A"]); git(ws, [...id, "commit", "-q", "-m", "main2"]);
      git(ws, [...id, "merge", "-q", "--no-ff", "--no-commit", "side"]);
      fs.writeFileSync(path.join(ws, "evil.cfg"), `payment_key = ${secret}\n`);
      git(ws, ["add", "-A"]); git(ws, [...id, "commit", "-q", "-m", "merge side"]);
      return {exitCode: 0, log: "evil merge implementer\n", argv: ["in-process"], startedAt: at, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false};
    }
  };
}

describe("merge commits in base..head are scanned (B3C-C1-F1)", () => {
  it("stub: the gitleaks argv carries --diff-merges=first-parent when the range contains a merge commit that adds content", { timeout: T }, async () => {
    const sec = fakeSecurity(path.join(tmp, "sec-merge"));
    const {c, run} = await driveWith(evilMergeImplementer(fakeStripe()), sec.options);
    expect(run.status).toBe("AWAITING_APPROVAL");
    const merges = git(path.join(c.dataDir, "runs", run.runId, "work"), ["rev-list", "--merges", `${run.baseSha}..${run.headSha}`]);
    expect(merges).toContain(run.headSha!); // aralıkta gerçekten bir merge commit var
    const gl = sec.calls().find(x => x.tool === "gitleaks")!.argv;
    const opts = gl[gl.indexOf("--log-opts") + 1];
    expect(opts).toBe(`--text --no-textconv --no-ext-diff --diff-merges=first-parent ${run.baseSha}..${run.headSha}`);
  });
});

describe("scans run in fresh clones, not in the implementer workspace", () => {
  it("gitleaks targets a bare fresh clone and trivy a checked-out fresh clone; workspace .git/config textconv and .gitattributes do not carry over", { timeout: T }, async () => {
    const sec = fakeSecurity(path.join(tmp, "sec-c"));
    const {c, run} = await driveWith(hidingImplementer({"feature.txt": "ok\n", ".gitattributes": "* -diff\n* diff=hide\n"}), sec.options);
    expect(run.status).toBe("AWAITING_APPROVAL");
    const runDir = path.join(c.dataDir, "runs", run.runId), work = path.join(runDir, "work");
    expect(fs.readFileSync(path.join(work, ".git", "config"), "utf8")).toMatch(/textconv/);
    const calls = sec.calls();
    const glTarget = calls.find(x => x.tool === "gitleaks")!.argv.at(-1)!, tvTarget = calls.find(x => x.tool === "trivy")!.argv.at(-1)!;
    expect(path.resolve(glTarget)).not.toBe(path.resolve(work));
    expect(path.resolve(tvTarget)).not.toBe(path.resolve(work));
    expect(path.basename(glTarget)).toBe("security-gl-c0.git");
    expect(path.basename(tvTarget)).toBe("security-c0");
    expect(git(glTarget, ["rev-parse", "--is-bare-repository"])).toBe("true");
    expect(fs.readFileSync(path.join(tvTarget, ".git", "config"), "utf8")).not.toMatch(/textconv/);
    expect(git(tvTarget, ["rev-parse", "HEAD"])).toBe(run.headSha);
    // Hiçbir tarayıcı çocuk süreci implementer workspace'inde veya klon içinde çalışmaz.
    for (const call of calls) expect(path.resolve(call.cwd).startsWith(path.join(runDir, "security") + path.sep)).toBe(true);
  });
});

describe("no secret value leaks into the journal, evidence or logs", () => {
  it("a planted secret in scanner report, message and stderr never reaches any persisted output", { timeout: T }, async () => {
    const planted = fakeAws();
    const {c, run} = await drive({gitleaks: {findings: [{ruleId: "aws-access-token", file: "x.txt", line: 1}], plantedSecret: planted}});
    expect(run.reason).toBe("SECRET_DETECTED");
    const files = [path.join(c.dataDir, "journal.jsonl"), ...allFiles(path.join(c.dataDir, "runs", run.runId))].filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(fs.readFileSync(f, "utf8"), f).not.toContain(planted);
    const log = fs.readFileSync(path.join(c.dataDir, run.evidence.find(e => e.kind === "SECURITY_GITLEAKS")!.logPath!), "utf8");
    expect(log).toContain("[REDACTED:AWS_ACCESS_KEY]");
  });
});

describe("GLOBAL_STOP and re-entry", () => {
  it("GLOBAL_STOP while the scanner child runs kills it and cancels the run (mission BLOCKED, no security report)", { timeout: T }, async () => {
    const c = setup(), fake = new FakeExecutors(okScript()), sec = fakeSecurity(path.join(tmp, "sec-stop"), {gitleaks: {sleepMs: 60_000}});
    const r = startRun(c, fake);
    const eng = engine(c, fake, sec.options);
    const ticking = eng.tick();
    const deadline = Date.now() + 90_000;
    while (!fs.existsSync(sec.startedFlag) && Date.now() < deadline) await new Promise(res => setTimeout(res, 100));
    expect(fs.existsSync(sec.startedFlag)).toBe(true);
    activateGlobalStop(c.stopFile, "scanner stop test", "TEST");
    const t0 = Date.now();
    const rep = await ticking;
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(rep.advanced).toContain(r.runId);
    const run = runOf(c, r.runId);
    expect(run.status).toBe("CANCELLED");
    expect(run.reason).toMatch(/^GLOBAL_STOP_ACTIVE: scanner stop test/);
    expect(missionStatus(c)).toBe("BLOCKED");
    expect(kinds(run)).not.toContain("SECURITY_REPORT");
    expect(kinds(run)).not.toContain("REVIEW");
    expect(fake.calls.review).toBe(0);
  });

  it("re-entry after a transient scanner failure rebuilds the clones and finishes with exactly one SECURITY checkpoint; crash-resume at SECURITY works", { timeout: T }, async () => {
    const c = setup(), fake = new FakeExecutors(okScript()), sec = fakeSecurity(path.join(tmp, "sec-retry"), {trivy: {sleepMs: 20_000}});
    const r = startRun(c, fake);
    let skew = 0;
    const eng = engine(c, fake, {...sec.options, timeoutMs: 1_500}, {maxRetries: 2, retryBackoffMs: [60_000], now: () => Date.now() + skew});
    await eng.tick();
    let run = runOf(c, r.runId);
    expect([run.status, run.reason]).toEqual(["RETRY_SCHEDULED", "SECURITY_TOOL_TRANSIENT_FAILURE"]);
    expect(run.step).toBe("SECURITY");
    expect(run.reason).toBe("SECURITY_TOOL_TRANSIENT_FAILURE");
    sec.set({});
    skew = 120_000; // geri çekilme süresi doldu
    await eng.tick();
    run = runOf(c, r.runId);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.checkpoints.filter(x => x.step === "SECURITY")).toHaveLength(1);
    expect(kinds(run).filter(k => k === "SECURITY_REPORT")).toHaveLength(1);
    expect(kinds(run).filter(k => k === "SECURITY_GITLEAKS")).toHaveLength(2);

    // Crash-resume: SECURITY tamamlanmadan düşen motorun yerine yeni motor adımı baştan, idempotent çalıştırır.
    const c2 = setup(), fake2 = new FakeExecutors(okScript()), sec2 = fakeSecurity(path.join(tmp, "sec-crash"));
    const r2 = startRun(c2, fake2);
    await engine(c2, fake2, sec2.options, {maxStepsPerTick: 3}).tick(); // WORKSPACE + IMPLEMENT + VERIFY, sonra "crash"
    const mid = runOf(c2, r2.runId);
    expect(mid.step).toBe("SECURITY");
    expect(mid.status).toBe("CHECKPOINTING");
    const later = Date.now() + 10 * 60_000;
    const storeB = new WorkOsStore(c2.dataDir, {now: () => later});
    const rep = await new MissionRunner({store: storeB, dataDir: c2.dataDir, globalStopFile: c2.stopFile, envPolicyFile: ENV_POLICY, executors: fake2.pair(), retryBackoffMs: [0, 0], now: () => later, security: sec2.options}).tick();
    expect(rep.recovered).toEqual([r2.runId]);
    const done = runOf(c2, r2.runId);
    expect(done.status).toBe("AWAITING_APPROVAL");
    expect(done.evidence.find(e => e.kind === "RECOVERY")!.note).toMatch(/resume step SECURITY/);
    expect(done.checkpoints.map(x => x.step)).toEqual(["WORKSPACE", "IMPLEMENT", "VERIFY", "SECURITY", "REVIEW", "REGRESSION", "REPORT"]);
  });

  it("GET /v1/work-runs/:id exposes the security stage summary through the run evidence", { timeout: T }, async () => {
    const {c, run} = await drive({trivy: {dbState: "MISSING"}});
    const token = crypto.randomBytes(24).toString("hex");
    fs.mkdirSync(path.join(tmp, "config"), {recursive: true});
    fs.copyFileSync(ENV_POLICY, path.join(tmp, "config", "environment-policy.json"));
    const app = buildServer({controlToken: token, runtime: path.dirname(c.stopFile), repoRoot: tmp, dataDir: c.dataDir, tenantId: "tA", port: 3210, logger: false});
    const res = await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: {"x-uasco-control-token": token, host: "127.0.0.1:3210"}});
    expect(res.statusCode).toBe(200);
    const ev = (res.json().run as WorkRun).evidence.find(e => e.kind === "SECURITY_REPORT")!;
    expect(ev.security!.status).toBe("PARTIAL");
    expect(ev.security!.founderNote).toMatch(/PARTIAL/);
    expect(ev.security!.sca.reason).toBe("TRIVY_DB_UNAVAILABLE");
    expect(ev.security!.sast.status).toBe("NOT_AVAILABLE");
    await app.close();
  });
});

// ---- Gerçek gitleaks (host'ta kuruluysa) ----
const REAL_GITLEAKS = resolveOnPath("gitleaks", process.env.PATH ?? process.env.Path ?? "");
const realGl = REAL_GITLEAKS ? it : it.skip;
describe("real gitleaks (skipped with an explicit reason when not installed)", () => {
  if (!REAL_GITLEAKS) it("SKIPPED(B3C-real-gitleaks): TOOL_NOT_INSTALLED on this host; real-binary cases below are skipped", () => { expect(REAL_GITLEAKS).toBeNull(); });
  realGl("detects a runtime-built fake key despite -diff attribute, repo .gitleaks.toml allowlist, .gitleaksignore and an inline gitleaks:allow; no value is persisted", { timeout: T }, async () => {
    const k1 = fakeStripe(), k2 = fakeStripe();
    const sec = fakeSecurity(path.join(tmp, "sec-real"));
    const options: SecurityOptions = {...sec.options, tools: {...sec.options.tools, gitleaks: undefined}};
    const files = {
      "feature.txt": "ok\n", ".gitattributes": "* -diff\n", ".gitleaks.toml": "[allowlist]\npaths = ['''.*''']\n", ".gitleaksignore": "a.txt:stripe-access-token:1\nb.txt:stripe-access-token:1\n",
      "a.txt": `payment_key = ${k1}\n`, "b.txt": `payment_key = ${k2} # gitleaks:allow\n`
    };
    const {c, run} = await driveWith(hidingImplementer(files), options);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_DETECTED");
    expect(missionStatus(c)).toBe("BLOCKED");
    const s = secEv(run).security!;
    expect(s.tools[0]).toEqual(expect.objectContaining({tool: "gitleaks", status: "INSTALLED", path: REAL_GITLEAKS}));
    expect(s.tools[0].version).toMatch(/\d+\.\d+/);
    expect(s.tools[0].sha256).toBe(sha256File(REAL_GITLEAKS!));
    expect(s.secrets.gitleaks.status).toBe("FINDINGS");
    expect(s.secrets.gitleaks.items.map(i => i.file).sort()).toEqual(["a.txt", "b.txt"]);
    expect(s.secrets.gitleaks.items.every(i => i.ruleId === "stripe-access-token" && i.commit === run.headSha)).toBe(true);
    expect(s.secrets.builtin.hits).toBe(0); // yerleşik tarama bu türü tanımaz: tespiti gerçek gitleaks yapmıştır
    const persisted = [path.join(c.dataDir, "journal.jsonl"), ...allFiles(path.join(c.dataDir, "runs", run.runId))].filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
    for (const f of persisted) { const text = fs.readFileSync(f, "utf8"); expect(text, f).not.toContain(k1); expect(text, f).not.toContain(k2); }
    expect(fs.readdirSync(path.join(c.dataDir, "runs", run.runId, "security")).filter(f => f.startsWith("gitleaks-raw"))).toEqual([]);
  });

  realGl("an evil merge (secret only in the merge commit) is detected by real gitleaks; the type is outside the built-in scan", { timeout: T }, async () => {
    const k = fakeStripe();
    const sec = fakeSecurity(path.join(tmp, "sec-real-merge"));
    const {c, run} = await driveWith(evilMergeImplementer(k), {...sec.options, tools: {...sec.options.tools, gitleaks: undefined}});
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_DETECTED");
    expect(missionStatus(c)).toBe("BLOCKED");
    const s = secEv(run).security!;
    expect(s.secrets.gitleaks.status).toBe("FINDINGS");
    expect(s.secrets.gitleaks.items.some(i => i.file === "evil.cfg" && i.ruleId === "stripe-access-token" && i.commit === run.headSha)).toBe(true);
    expect(s.secrets.builtin.hits).toBe(0);
    const persisted = [path.join(c.dataDir, "journal.jsonl"), ...allFiles(path.join(c.dataDir, "runs", run.runId))].filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
    for (const f of persisted) expect(fs.readFileSync(f, "utf8"), f).not.toContain(k);
  });

  realGl("a clean commit passes real gitleaks (exit 0) and records the real version and sha256", { timeout: T }, async () => {
    const sec = fakeSecurity(path.join(tmp, "sec-real-clean"));
    const c = setup(), fake = new FakeExecutors(okScript());
    const r = startRun(c, fake);
    await engine(c, fake, {...sec.options, tools: {...sec.options.tools, gitleaks: undefined}}).tick();
    const run = runOf(c, r.runId);
    expect(run.status).toBe("AWAITING_APPROVAL");
    const s = secEv(run).security!;
    expect(s.secrets.gitleaks).toEqual(expect.objectContaining({status: "CLEAN", findings: 0}));
    expect(run.evidence.find(e => e.kind === "SECURITY_GITLEAKS")!.exitCode).toBe(0);
  });
});

// ---- Cycle 3: B3C-C2-F1 (varsayılan global yol allowlist'i) ve B3C-C2-F2 (gitleaks iç git hatası -> sahte temiz) ----
const MIXED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const fakeGitlab = () => ["gl", "pat-"].join("") + rnd(MIXED, 20);
// Implementer node_modules/ altına (.gitignore'a rağmen -f ile) ve metin içerikli *.png dosyasına secret koyar: gitleaks varsayılan global allowlist'inin yol desenleri.
function forceAddImplementer(files: Record<string, string>): ImplementerAdapter {
  return {
    identity: "FAKE_FORCE_ADD_IMPLEMENTER",
    async implement(ws) {
      const at = new Date().toISOString();
      fs.writeFileSync(path.join(ws, ".gitignore"), "node_modules/\n");
      for (const [rel, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(ws, rel)), {recursive: true}); fs.writeFileSync(path.join(ws, rel), content); }
      git(ws, ["add", "-A"]);
      git(ws, ["add", "-f", ...Object.keys(files)]);
      git(ws, ["-c", "user.name=FAKE", "-c", "user.email=fake@local.invalid", "commit", "-q", "-m", "force add"]);
      return {exitCode: 0, log: "force-add implementer\n", argv: ["in-process"], startedAt: at, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false};
    }
  };
}
// Implementer base'den kopuk (orphan) bir head üretir: base..head aralığı geçersizdir (base, head'in atası değildir).
function orphanImplementer(): ImplementerAdapter {
  return {
    identity: "FAKE_ORPHAN_IMPLEMENTER",
    async implement(ws) {
      const at = new Date().toISOString();
      git(ws, ["checkout", "-q", "--orphan", "detached-history"]);
      fs.writeFileSync(path.join(ws, "feature.txt"), "ok\n");
      git(ws, ["add", "-A"]);
      git(ws, ["-c", "user.name=FAKE", "-c", "user.email=fake@local.invalid", "commit", "-q", "-m", "orphan"]);
      return {exitCode: 0, log: "orphan implementer\n", argv: ["in-process"], startedAt: at, endedAt: new Date().toISOString(), timedOut: false, aborted: false, transient: false};
    }
  };
}

describe("cycle 3: added-lines stream and range pre-validation (unit)", () => {
  it("buildAddedLineStream keeps only added lines with commit/file/line refs; hunk-internal '+++'/'commit' lines are content; hunks are separated", () => {
    const c1 = "1".repeat(40), c2 = "2".repeat(40);
    const log = [`commit ${c1}`, "", "diff --git a/node_modules/x/c.js b/node_modules/x/c.js", "new file mode 100644", "--- /dev/null", "+++ b/node_modules/x/c.js", "@@ -0,0 +1,3 @@", "+alpha", "++++ inner", "+commit " + "3".repeat(40),
      `commit ${c2}`, "", "diff --git a/img.png b/img.png", "--- a/img.png", "+++ b/img.png", "@@ -2,2 +2,2 @@", " keep", "-old", "+beta", "@@ -9 +9 @@", "-x", "+gamma", ""].join("\n");
    const s = buildAddedLineStream(log);
    expect(s.text.split("\n").slice(0, -1)).toEqual(["alpha", "+++ inner", "commit " + "3".repeat(40), "", "beta", "", "gamma"]);
    expect(s.refs).toEqual([
      {commit: c1, file: "node_modules/x/c.js", line: 1}, {commit: c1, file: "node_modules/x/c.js", line: 2}, {commit: c1, file: "node_modules/x/c.js", line: 3}, null,
      {commit: c2, file: "img.png", line: 3}, null, {commit: c2, file: "img.png", line: 9}
    ]);
    expect(buildAddedLineStream("").text).toBe("");
  });

  it("gitRangeProblem (real git): valid range -> null; unknown commit, non-ancestor base and malformed SHA are problems", { timeout: T }, () => {
    const r = path.join(tmp, "range-repo"), id = ["-c", "user.name=A", "-c", "user.email=a@local.invalid"];
    fs.mkdirSync(r); git(r, ["init", "-q", "-b", "main"]);
    git(r, [...id, "commit", "-q", "--allow-empty", "-m", "base"]); const base = git(r, ["rev-parse", "HEAD"]);
    git(r, [...id, "commit", "-q", "--allow-empty", "-m", "head"]); const head = git(r, ["rev-parse", "HEAD"]);
    git(r, ["checkout", "-q", "-b", "side", base]); git(r, [...id, "commit", "-q", "--allow-empty", "-m", "side"]); const side = git(r, ["rev-parse", "HEAD"]);
    const run = (args: string[]) => spawnGitSync(r, args);
    expect(gitRangeProblem(run, base, head)).toBeNull();
    expect(gitRangeProblem(run, base, base)).toBeNull();
    expect(gitRangeProblem(run, "f".repeat(40), head)).toBe("RANGE_COMMIT_MISSING");
    expect(gitRangeProblem(run, side, head)).toBe("RANGE_BASE_NOT_ANCESTOR");
    expect(gitRangeProblem(run, "HEAD~1", head)).toBe("RANGE_INVALID_SHA");
  });

  it("GITLEAKS_ERROR_LINE matches the observed gitleaks 8.30.1 git-failure log lines but not a normal 'leaks found' warning", () => {
    expect(GITLEAKS_ERROR_LINE.test("1:46AM ERR [git] fatal: Invalid revision range 1111..2222")).toBe(true);
    expect(GITLEAKS_ERROR_LINE.test('1:46AM ERR error="stderr is not empty"')).toBe(true);
    expect(GITLEAKS_ERROR_LINE.test("1:46AM WRN leaks found: 3")).toBe(false);
    expect(GITLEAKS_ERROR_LINE.test("")).toBe(false);
  });
});

describe("cycle 3: gitleaks failure is never a clean result (B3C-C2-F2, stub)", () => {
  it("exit 0 + '[]' report + 'ERR [git] fatal' on stderr -> BLOCKED SECURITY_TOOL_ERROR; the added-lines pass is skipped", { timeout: T }, async () => {
    const {c, run, sec} = await drive({gitleaks: {stderr: "1:46AM ERR [git] fatal: Invalid revision range", exitCode: 0}});
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECURITY_TOOL_ERROR");
    expect(missionStatus(c)).toBe("BLOCKED");
    const g = secEv(run).security!.secrets.gitleaks;
    expect(g).toEqual(expect.objectContaining({status: "ERROR", reason: "TOOL_REPORTED_ERROR", findings: 0}));
    expect(g.passes).toEqual({git: expect.objectContaining({status: "ERROR", reason: "TOOL_REPORTED_ERROR"}), addedLines: expect.objectContaining({status: "SKIPPED"})});
    expect(sec.calls().filter(x => x.tool === "gitleaks").length).toBe(1);
  });

  it("exit 0 without a report file -> REPORT_MISSING (fail-closed); an error line in the added-lines pass -> ADDED_LINES_TOOL_REPORTED_ERROR", { timeout: T }, async () => {
    const noRep = await drive({gitleaks: {noReport: true, exitCode: 0}});
    expect(noRep.run.reason).toBe("SECURITY_TOOL_ERROR");
    expect(secEv(noRep.run).security!.secrets.gitleaks).toEqual(expect.objectContaining({status: "ERROR", reason: "REPORT_MISSING"}));
    const stdinErr = await drive({gitleaks: {stdin: {stderr: "ERR error=\"read failed\"", exitCode: 0}}});
    expect(stdinErr.run.reason).toBe("SECURITY_TOOL_ERROR");
    expect(secEv(stdinErr.run).security!.secrets.gitleaks).toEqual(expect.objectContaining({status: "ERROR", reason: "ADDED_LINES_TOOL_REPORTED_ERROR"}));
    const stdinNoRep = await drive({gitleaks: {stdin: {noReport: true, exitCode: 0}}});
    expect(secEv(stdinNoRep.run).security!.secrets.gitleaks).toEqual(expect.objectContaining({status: "ERROR", reason: "ADDED_LINES_REPORT_MISSING"}));
  });

  // Katmanlı savunma: base'den kopuk bir head runner tarafından IMPLEMENT'te zaten reddedilir; SECURITY'deki gitRangeProblem ön doğrulaması (yukarıdaki birim testi) ikinci katmandır.
  it("a head that does not descend from base never reaches a scanner: rejected upstream (IMPLEMENT_HISTORY_REWRITTEN), no gitleaks call, no clean security result", { timeout: T }, async () => {
    const sec = fakeSecurity(path.join(tmp, "sec-orphan"));
    const {run} = await driveWith(orphanImplementer(), sec.options);
    expect([run.status, run.reason]).toEqual(["FAILED", "IMPLEMENT_HISTORY_REWRITTEN"]);
    expect(kinds(run)).not.toContain("SECURITY_REPORT");
    expect(sec.calls().filter(x => x.tool === "gitleaks")).toEqual([]);
  });
});

describe("cycle 3: added-lines pass (B3C-C2-F1, stub)", () => {
  it("a finding in the stdin pass is mapped back to commit/file/line of the added line and blocks the run", { timeout: T }, async () => {
    const {run, sec} = await drive({gitleaks: {stdin: {findings: [{ruleId: "gitlab-pat", line: 1}]}}});
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_DETECTED");
    const g = secEv(run).security!.secrets.gitleaks;
    expect(g.items).toEqual([{ruleId: "gitlab-pat", file: "feature.txt", line: 1, commit: run.headSha}]);
    expect(g.passes).toEqual({git: expect.objectContaining({status: "CLEAN", findings: 0}), addedLines: expect.objectContaining({status: "FINDINGS", findings: 1})});
    expect(sec.calls().find(x => x.tool === "gitleaks-stdin-meta")).toEqual(expect.objectContaining({lines: 1}));
  });
});

describe("cycle 3: real gitleaks default path allowlist and git failure (skipped with an explicit reason when not installed)", () => {
  if (!REAL_GITLEAKS) it("SKIPPED(B3C-C3-real-gitleaks): TOOL_NOT_INSTALLED on this host; real-binary cases below are skipped", () => { expect(REAL_GITLEAKS).toBeNull(); });
  realGl("GitLab token force-added under node_modules/ and in a text *.png: the git pass misses both (default global path allowlist), the added-lines pass detects both -> BLOCKED", { timeout: T }, async () => {
    const k1 = fakeGitlab(), k2 = fakeGitlab();
    const sec = fakeSecurity(path.join(tmp, "sec-real-allowlist"));
    const {c, run} = await driveWith(forceAddImplementer({"feature.txt": "ok\n", "node_modules/x/c.js": `const t = "${k1}";\n`, "assets/img.png": `token = "${k2}"\n`}), {...sec.options, tools: {...sec.options.tools, gitleaks: undefined}});
    const work = path.join(c.dataDir, "runs", run.runId, "work");
    expect(git(work, ["ls-tree", "-r", "--name-only", run.headSha!]).split("\n")).toEqual(expect.arrayContaining(["node_modules/x/c.js", "assets/img.png"]));
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SECRET_DETECTED");
    const s = secEv(run).security!;
    expect(s.status).not.toBe("PASSED");
    expect(s.secrets.gitleaks.status).toBe("FINDINGS");
    expect(s.secrets.gitleaks.items.filter(i => i.ruleId === "gitlab-pat").map(i => `${i.file}:${i.line}:${i.commit}`).sort()).toEqual([`assets/img.png:1:${run.headSha}`, `node_modules/x/c.js:1:${run.headSha}`]);
    // Gözlenen davranış (gitleaks 8.30.1): git geçişi bu iki yolu varsayılan global allowlist yüzünden görmez; tespit yolsuz stdin geçişindendir.
    expect(s.secrets.gitleaks.passes!.git).toEqual(expect.objectContaining({status: "CLEAN", findings: 0}));
    expect(s.secrets.gitleaks.passes!.addedLines).toEqual(expect.objectContaining({status: "FINDINGS", findings: 2}));
    expect(s.secrets.builtin.hits).toBe(0); // yerleşik tarama bu türü tanımaz
    const persisted = [path.join(c.dataDir, "journal.jsonl"), ...allFiles(path.join(c.dataDir, "runs", run.runId))].filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
    for (const f of persisted) { const text = fs.readFileSync(f, "utf8"); expect(text, f).not.toContain(k1); expect(text, f).not.toContain(k2); }
    expect(fs.readdirSync(path.join(c.dataDir, "runs", run.runId, "security")).filter(f => f.startsWith("gitleaks-raw"))).toEqual([]);
  });

  realGl("real gitleaks on an invalid revision range exits 0 with '[]' but logs 'ERR [git] fatal'; runGitleaks reports ERROR (TOOL_REPORTED_ERROR), never CLEAN", { timeout: T }, async () => {
    const r = path.join(tmp, "gl-range"), id = ["-c", "user.name=A", "-c", "user.email=a@local.invalid"];
    fs.mkdirSync(r); git(r, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(r, "a.txt"), "a\n"); git(r, ["add", "-A"]); git(r, [...id, "commit", "-q", "-m", "a"]);
    const head = git(r, ["rev-parse", "HEAD"]), missingBase = crypto.randomBytes(20).toString("hex");
    const dir = path.join(tmp, "gl-range-sec"); fs.mkdirSync(path.join(dir, "cwd"), {recursive: true});
    fs.writeFileSync(path.join(dir, "gl.toml"), "[extend]\nuseDefault = true\n"); fs.writeFileSync(path.join(dir, "gl.ignore"), "");
    const tool = {tool: "gitleaks" as const, status: "INSTALLED" as const, path: REAL_GITLEAKS, version: null, sha256: null, prefixArgs: []};
    const g = await runGitleaks(tool, {bareRepo: r, base: missingBase, head, configFile: path.join(dir, "gl.toml"), ignoreFile: path.join(dir, "gl.ignore"), reportFile: path.join(dir, "rep.json"), cwd: path.join(dir, "cwd")},
      {env: process.env, timeoutMs: 120_000, maxReportBytes: 1024 * 1024, abort: () => false});
    expect(g.proc.exitCode).toBe(0); // gitleaks'in kendi sonucu "temiz" görünür
    expect(g.proc.stderr).toMatch(/fatal/);
    expect(g).toEqual(expect.objectContaining({status: "ERROR", reason: "TOOL_REPORTED_ERROR", count: 0}));
    expect(fs.existsSync(path.join(dir, "rep.json"))).toBe(false);
  });
});
