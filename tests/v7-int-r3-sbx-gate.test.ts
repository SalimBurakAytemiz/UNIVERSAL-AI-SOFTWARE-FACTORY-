// //TR: Bu test SBX-GATE'i (Founder kararı FD-REL-1-REJECT-HOST-EXEC-2026-10-15) doğrular: doğrulanmış sandbox sağlayıcısı yoksa runner VERIFY/REGRESSION test komutu hiç çalışmaz (kanıt NOT_EXECUTED SANDBOX_UNAVAILABLE, yeniden deneme/remediation bütçesi tüketilmez; V7-PKG-M1A-MODE / D-SBX1-PATH-2026-10-15 ile run BLOCKED olmak yerine statik güvenlik + bağımsız review ile AWAITING_APPROVAL'a sürer, functionalAcceptance NOT_EXECUTED), Studio dev-run start 409 SANDBOX_UNAVAILABLE döner ve süreç başlatılmaz; env değişkeni, API gövdesi, journal kaydı veya düz nesne sağlayıcı kaydedemez/taklit edemez; öz-testi geçmeyen sağlayıcı reddedilir. Yürütülen tek kod testin kendi sabit fikstürüdür ve yalnız enjekte edilen TEST sağlayıcısıyla çalışır.
import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {ExecutionGate, PROJECT_EXECUTION_KINDS, SANDBOX_UNAVAILABLE} from "../core/workos/execution-gate.js";
import {LinuxUnshareSandboxProvider, LINUX_SANDBOX_ID, hostHasProcess, nodeToolchainRoots, readOnlyRootProblem} from "../core/agents/linux-unshare-sandbox.js";
import {runProcess} from "../core/workos/executors.js";
import net from "node:net";
import cp from "node:child_process";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import type {GateDecision, SandboxProvider} from "../core/workos/execution-gate.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {deriveOutcomes} from "../core/workos/outcomes.js";
import {TEST_HOST_PASSTHROUGH_SANDBOX, testExecutionGate} from "./support/test-sandbox.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
const TOKEN = `tok-${crypto.randomBytes(16).toString("hex")}`;
const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
const apps: Array<ReturnType<typeof buildServer>> = [];
const SANDBOX_ENV = ["UASCO_SANDBOX", "UASCO_SANDBOX_PROVIDER", "UASCO_SANDBOX_VERIFIED", "UASCO_EXECUTION_GATE", "UASCO_ALLOW_HOST_EXECUTION"];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-")); });
afterEach(async () => {
  for (const k of SANDBOX_ENV) delete process.env[k];
  for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ }
});

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
// Test komutu çalışırsa işaret dosyası bırakır: dosyanın YOKLUĞU komutun hiç çalışmadığının kanıtıdır.
const markerScript = (marker: string) => `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "EXECUTED");\nprocess.exit(0);\n`;
function setup(marker: string) {
  const id = crypto.randomBytes(4).toString("hex"), repo = path.join(tmp, `src-${id}`);
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), markerScript(marker));
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `runtime-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "Add feature", objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
  return {store, dataDir, runtime, stopFile: path.join(runtime, "GLOBAL_STOP.json"), missionId: m.missionId};
}
const fake = () => new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
function startRun(c: ReturnType<typeof setup>, f: FakeExecutors) {
  const p = f.pair();
  return c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
}
const mkRunner = (c: ReturnType<typeof setup>, f: FakeExecutors, extra: Partial<RunnerOptions> = {}) =>
  new MissionRunner({store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: f.pair(), retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${c.dataDir}-sec`).options, ...extra});
// yorum satırları ve satır içi // yorumları çıkarılmış kaynak (yalnız çalışan kod denetlenir)
const code = (src: string) => src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, "")).join("\n");
const provider = (over: Partial<SandboxProvider> = {}): SandboxProvider => ({...TEST_HOST_PASSTHROUGH_SANDBOX, id: "TEST_PROVIDER", ...over});

describe("SBX-GATE ExecutionGate: single decision point", () => {
  it("refuses every project execution kind without a registered provider (production default)", async () => {
    const g = new ExecutionGate();
    for (const k of PROJECT_EXECUTION_KINDS) expect(await g.authorize(k)).toEqual({allowed: false, kind: k, reason: SANDBOX_UNAVAILABLE, detail: "NO_VERIFIED_PROVIDER"});
    expect(await g.status()).toEqual({state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null});
    await expect(g.authorize("HOST_SHELL" as never)).rejects.toThrow(/UNKNOWN_EXECUTION_KIND/);
  });
  it("treats malformed provider objects as no provider", async () => {
    for (const bad of [{}, {id: "x"}, {id: "", selfTest: async () => ({ok: true}), run: async () => null, spawn: () => null}, {id: "x", selfTest: async () => ({ok: true}), run: async () => null}, "WINDOWS_SANDBOX", 1, true])
      expect((await new ExecutionGate(bad as never).authorize("STUDIO_DEVRUN")).allowed).toBe(false);
  });
  it("allows only after an explicit {ok: true} self-test, runs the self-test once per gate and fails closed on failure, throw or truthy non-true", async () => {
    let calls = 0;
    const ok = new ExecutionGate(provider({selfTest: async () => { calls++; return {ok: true}; }}));
    for (const k of PROJECT_EXECUTION_KINDS) expect(await ok.authorize(k)).toMatchObject({allowed: true, kind: k, providerId: "TEST_PROVIDER"});
    expect(calls).toBe(1);
    expect(await new ExecutionGate(provider({selfTest: async () => ({ok: false})})).authorize("RUNNER_VERIFY_TESTS")).toMatchObject({allowed: false, reason: SANDBOX_UNAVAILABLE, detail: "SELF_TEST_FAILED"});
    expect(await new ExecutionGate(provider({selfTest: async () => ({ok: "true" as unknown as boolean})})).authorize("RUNNER_VERIFY_TESTS")).toMatchObject({allowed: false, detail: "SELF_TEST_FAILED"});
    expect(await new ExecutionGate(provider({selfTest: async () => { throw new Error("vm missing"); }})).authorize("RUNNER_VERIFY_TESTS")).toMatchObject({allowed: false, detail: "SELF_TEST_ERROR"});
  });
  it("production code never imports the test-only provider and never spawns the dev command or test command directly", () => {
    const prod = ["core/workos/runner.ts", "core/workos/devrun.ts", "core/workos/execution-gate.ts", "apps/control-api/src/server.ts", "apps/control-api/src/packaged-entry.ts"].map(f => fs.readFileSync(path.join(REPO, f), "utf8"));
    for (const s of prod) { expect(s).not.toContain("test-sandbox"); expect(s).not.toContain("TEST_ONLY_HOST_PASSTHROUGH"); }
    const [runner, devrun, , server, entry] = prod;
    expect(runner).not.toMatch(/\brunProcess\(/);
    expect(devrun).not.toMatch(/cp\.spawn\(exe/);
    expect(devrun).toContain("gate.provider.spawn(exe");
    // tek kayıt yolu: buildServer opts.sandbox (programatik); packaged/CLI girişleri sağlayıcı vermez, env okunmaz
    expect(server).toContain("new ExecutionGate(opts.sandbox??null)");
    expect(server).not.toMatch(/process\.env\.[A-Z_]*SANDBOX/);
    // packaged entry never passes a sandbox option (comments may mention it); no env var is read for one
    expect(code(entry)).not.toMatch(/\bsandbox\s*:/i);
    expect(code(entry)).not.toMatch(/SANDBOX/);
  });
});

describe("SBX-GATE runner: VERIFY without a verified sandbox", () => {
  it("M1a: records NOT_EXECUTED (SANDBOX_UNAVAILABLE) evidence, never runs the test command, uses no retry/remediation budget and continues to AWAITING_APPROVAL with functionalAcceptance NOT_EXECUTED", { timeout: T }, async () => {
    const marker = path.join(tmp, "verify-executed.flag"), c = setup(marker), f = fake();
    for (const k of SANDBOX_ENV) process.env[k] = "1";
    process.env.UASCO_SANDBOX_PROVIDER = "windows-sandbox";
    const created = startRun(c, f);
    // düz nesne "kapı" (izin taklidi) yok sayılır -> sağlayıcısız kapı
    const forged = {authorize: async (kind: string) => ({allowed: true, kind, providerId: "FORGED", provider: TEST_HOST_PASSTHROUGH_SANDBOX})} as unknown as ExecutionGate;
    await mkRunner(c, f, {executionGate: forged}).tick();
    const run = c.store.getRun({tenantId: "tA"}, created.runId)!;
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toContain("TESTS_NOT_EXECUTED_SANDBOX_UNAVAILABLE");
    expect(run.step).toBe("REPORT");
    expect(run.retryCount).toBe(0);
    expect(run.remediationCycle).toBe(0);
    expect(c.store.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("REPORTING");
    expect(fs.existsSync(marker)).toBe(false);
    const ev = run.evidence.map(e => e.kind);
    expect(ev).toContain("VERIFY_TESTS_NOT_EXECUTED");
    expect(ev).toContain("REGRESSION_TESTS_NOT_EXECUTED");
    expect(ev).not.toContain("VERIFY_TESTS");
    expect(ev).not.toContain("REGRESSION_TESTS");
    expect(run.evidence.find(e => e.kind === "TEST_SURFACE")!.testSurface!.functionalAcceptance).toBe("NOT_EXECUTED");
    const ne = run.evidence.find(e => e.kind === "VERIFY_TESTS_NOT_EXECUTED")!;
    expect(ne.exitCode).toBeNull();
    expect(ne.note).toMatch(/^NOT_EXECUTED: SANDBOX_UNAVAILABLE \(NO_VERIFIED_PROVIDER\)/);
    expect(fs.readFileSync(path.join(c.dataDir, ne.logPath!), "utf8")).toContain("NOT_EXECUTED");
    // awaiting the Founder: a later tick does nothing and still never executes
    await mkRunner(c, f).tick();
    expect(c.store.getRun({tenantId: "tA"}, created.runId)!.status).toBe("AWAITING_APPROVAL");
    expect(fs.existsSync(marker)).toBe(false);
  });
  it("a provider whose self-test fails is refused the same way; a verified (test) provider runs the command through the provider", { timeout: T }, async () => {
    const m1 = path.join(tmp, "selftest-failed.flag"), c1 = setup(m1), f1 = fake(), r1 = startRun(c1, f1);
    let runCalls = 0;
    const failing = new ExecutionGate(provider({selfTest: async () => ({ok: false, detail: "NETWORK_NOT_ISOLATED"}), run: async (a, o) => { runCalls++; return TEST_HOST_PASSTHROUGH_SANDBOX.run(a, o); }}));
    await mkRunner(c1, f1, {executionGate: failing}).tick();
    const run1 = c1.store.getRun({tenantId: "tA"}, r1.runId)!;
    expect(run1.status).toBe("AWAITING_APPROVAL");
    expect(run1.evidence.find(e => e.kind === "VERIFY_TESTS_NOT_EXECUTED")!.note).toMatch(/^NOT_EXECUTED: SANDBOX_UNAVAILABLE \(SELF_TEST_FAILED\)/);
    expect(runCalls).toBe(0);
    expect(fs.existsSync(m1)).toBe(false);
    const m2 = path.join(tmp, "provider-ran.flag"), c2 = setup(m2), f2 = fake(), r2 = startRun(c2, f2);
    const seen: string[] = [];
    const counting = new ExecutionGate(provider({run: async (a, o) => { seen.push(a.slice(1).join(" ")); return TEST_HOST_PASSTHROUGH_SANDBOX.run(a, o); }}));
    await mkRunner(c2, f2, {executionGate: counting}).tick();
    expect(c2.store.getRun({tenantId: "tA"}, r2.runId)!.status).toBe("AWAITING_APPROVAL");
    expect(seen).toEqual(["test.mjs", "test.mjs"]); // VERIFY + REGRESSION, both via the provider
    expect(fs.readFileSync(m2, "utf8")).toBe("EXECUTED");
  });
});

describe("SBX-GATE control API (production wiring: no sandbox option)", () => {
  const mk = (extra: Record<string, unknown> = {}) => {
    const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
    fs.mkdirSync(runtime, {recursive: true});
    const app = buildServer({controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, port: 3210, logger: false, tenantId: "tA", ...extra});
    apps.push(app);
    return {app, dataDir};
  };
  const call = (app: ReturnType<typeof buildServer>, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({method, url, headers: HDR, ...(payload !== undefined ? {payload: payload as object} : {})});
  it("dev-run start of a template project -> 409 SANDBOX_UNAVAILABLE, nothing spawned, honest BLOCKED state; env vars and request bodies cannot register a provider", { timeout: T }, async () => {
    for (const k of SANDBOX_ENV) process.env[k] = "1";
    process.env.UASCO_SANDBOX_PROVIDER = "windows-sandbox";
    const {app} = mk();
    const created = await call(app, "POST", "/v1/projects", {name: "Shop", environmentId: "dev", template: "web-node", idempotencyKey: "sbx-1"});
    expect(created.statusCode).toBe(201);
    const pid = created.json().project.projectId;
    const sys = (await call(app, "GET", "/v1/system/executors")).json();
    expect(sys.sandbox).toEqual({state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null});
    const before = Date.now();
    const r = await call(app, "POST", `/v1/projects/${pid}/devrun/start`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({error: "SANDBOX_UNAVAILABLE", reason: "NO_VERIFIED_PROVIDER"});
    expect(Date.now() - before).toBeLessThan(10_000);
    const view = (await call(app, "GET", `/v1/projects/${pid}/devrun`)).json().devrun;
    expect(view).toMatchObject({status: "BLOCKED", reason: "SANDBOX_UNAVAILABLE", pid: null, port: null});
    // a body trying to smuggle a provider is not an empty body -> 400, and the follow-up start is still refused
    expect((await call(app, "POST", `/v1/projects/${pid}/devrun/start`, {sandbox: {id: "x"}})).statusCode).toBe(400);
    expect((await call(app, "POST", `/v1/projects/${pid}/devrun/restart`, {})).json()).toMatchObject({error: "SANDBOX_UNAVAILABLE"});
  });
  it("M1a: a mission run passes VERIFY with NOT_EXECUTED SANDBOX_UNAVAILABLE and reaches AWAITING_APPROVAL through the API (FAKE executors, no sandbox)", { timeout: T }, async () => {
    const marker = path.join(tmp, "api-executed.flag"), c = setup(marker), f = fake();
    const app = buildServer({controlToken: TOKEN, runtime: c.runtime, repoRoot: REPO, dataDir: c.dataDir, tenantId: "tA", port: 3210, logger: false, executors: f.pair(), runner: {enabled: true, intervalMs: 250, security: fakeSecurity(`${c.dataDir}-sec`).options}});
    apps.push(app);
    await app.ready();
    const started = await call(app, "POST", `/v1/missions/${c.missionId}/runs`, {idempotencyKey: "sbx-run-1"});
    expect(started.statusCode).toBe(201);
    const runId = started.json().run.runId;
    let run: any = null;
    for (let i = 0; i < 400 && (!run || !["BLOCKED", "FAILED", "AWAITING_APPROVAL"].includes(run.status)); i++) { await new Promise(r => setTimeout(r, 250)); run = (await call(app, "GET", `/v1/work-runs/${runId}`)).json().run; }
    expect(run).toMatchObject({status: "AWAITING_APPROVAL", step: "REPORT"});
    expect(run.evidence.map((e: any) => e.kind)).toContain("VERIFY_TESTS_NOT_EXECUTED");
    expect((await call(app, "GET", `/v1/work-runs/${runId}`)).json().outcomes.functionalAcceptance).toBe("NOT_EXECUTED");
    expect(fs.existsSync(marker)).toBe(false);
  });
  it("with a TEST provider injected programmatically the same dev-run start is admitted past the gate and spawned only through the provider (the template server itself is not run)", { timeout: T }, async () => {
    // Sağlayıcı şablonun dev komutunu ÇALIŞTIRMAZ; yalnız çağrıyı kaydeder ve testin kendi zararsız bekleyen node sürecini başlatır.
    const spawned: string[][] = [];
    const recording = provider({id: "TEST_RECORDING_PROVIDER", spawn: (command, args, o) => { spawned.push([path.basename(command), ...args]); return TEST_HOST_PASSTHROUGH_SANDBOX.spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], o); }});
    const {app} = mk({sandbox: recording, studio: {devrun: {probeIntervalMs: 150, stopPollMs: 150, startWaitMs: 1000}}});
    const pid = (await call(app, "POST", "/v1/projects", {name: "Shop2", environmentId: "dev", template: "web-node", idempotencyKey: "sbx-2"})).json().project.projectId;
    expect((await call(app, "GET", "/v1/system/executors")).json().sandbox).toMatchObject({state: "AVAILABLE", providerId: "TEST_RECORDING_PROVIDER"});
    const r = await call(app, "POST", `/v1/projects/${pid}/devrun/start`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().devrun.status).not.toBe("BLOCKED");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].slice(1)).toEqual(["server.js"]);
    expect((await call(app, "POST", `/v1/projects/${pid}/devrun/stop`, {})).statusCode).toBe(200);
    expect(testExecutionGate()).toBeInstanceOf(ExecutionGate);
  });
});

// //TR: SBX-8 F (RV-INT-R3-C1-F2): REGRESSION reddi yolu için kalıcı test. Kapı yalnız VERIFY'a izin verir (TEST sağlayıcısı testin kendi sabit fikstürünü çalıştırır); REGRESSION'da sandbox yoktur: kanıt REGRESSION_TESTS_NOT_EXECUTED ve regresyon komutu hiç çalışmaz (M1a: run REPORT -> AWAITING_APPROVAL ile sürer, functionalAcceptance NOT_EXECUTED).
describe("SBX-GATE runner: REGRESSION without a verified sandbox (RV-INT-R3-C1-F2)", () => {
  it("records REGRESSION_TESTS_NOT_EXECUTED (SANDBOX_UNAVAILABLE) at REGRESSION; the regression command never runs; M1a continues to AWAITING_APPROVAL with functionalAcceptance NOT_EXECUTED", { timeout: T }, async () => {
    const marker = path.join(tmp, "regression.flag"), c = setup(marker), f = fake(), created = startRun(c, f);
    const seen: string[] = [];
    class VerifyOnlyGate extends ExecutionGate {
      override async authorize(kind: Parameters<ExecutionGate["authorize"]>[0]): Promise<GateDecision> {
        if (kind === "RUNNER_REGRESSION_TESTS") return {allowed: false as const, kind, reason: SANDBOX_UNAVAILABLE, detail: "NO_VERIFIED_PROVIDER" as const};
        return super.authorize(kind);
      }
    }
    const gate = new VerifyOnlyGate(provider({run: async (a, o) => { seen.push(a.slice(1).join(" ")); return TEST_HOST_PASSTHROUGH_SANDBOX.run(a, o); }}));
    await mkRunner(c, f, {executionGate: gate}).tick();
    const run = c.store.getRun({tenantId: "tA"}, created.runId)!;
    expect(run).toMatchObject({status: "AWAITING_APPROVAL", step: "REPORT"});
    expect(run.retryCount).toBe(0);
    expect(run.remediationCycle).toBe(0);
    expect(seen).toEqual(["test.mjs"]); // VERIFY only; REGRESSION never reached the provider
    const kinds = run.evidence.map(e => e.kind);
    expect(kinds).toContain("VERIFY_TESTS");
    expect(kinds).toContain("REVIEW");
    expect(kinds).toContain("REGRESSION_TESTS_NOT_EXECUTED");
    expect(kinds).not.toContain("REGRESSION_TESTS");
    const ne = run.evidence.find(e => e.kind === "REGRESSION_TESTS_NOT_EXECUTED")!;
    expect(ne.exitCode).toBeNull();
    expect(ne.note).toMatch(/^NOT_EXECUTED: SANDBOX_UNAVAILABLE \(NO_VERIFIED_PROVIDER\)/);
    expect(ne.commitSha).toBe(run.headSha);
    expect(fs.readFileSync(path.join(c.dataDir, ne.logPath!), "utf8")).toContain("NOT_EXECUTED");
    expect(c.store.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("REPORTING");
    expect(deriveOutcomes(run).functionalAcceptance).toBe("NOT_EXECUTED");
    // awaiting the Founder: a later tick with the same gate still never runs the regression command
    await mkRunner(c, f, {executionGate: gate}).tick();
    expect(seen).toEqual(["test.mjs"]);
  });
});

// //TR: LANE-C: ücretsiz Linux unshare sağlayıcısı (v2, bağımsız saldırgan incelemesi sonrası). Host-exec reddi her ortamda deterministik; yalıtım kanıtları (kanarya dosya/soket/shm, /proc/sys, pid1 gözetmeni, mount denetimi, iç içe userns, düşman çocuk) ilkelleri olan ortamda KOŞAR, olmayan ortamda sağlayıcının dürüstçe doğrulanmamış kaldığını ve hiçbir şey çalıştırmadığını doğrular.
describe("LANE-C Linux unshare sandbox provider v2 (SandboxProvider contract)", () => {
  const T2 = 120_000;
  const mkws = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-t-"));
  const env = () => ({PATH: process.env.PATH ?? "/usr/bin:/bin"});
  // F3: RLIMIT_NPROC gilt for kuid 0 (init user) is NOT enforced by the kernel, so a root supervisor must opt in explicitly (acceptUnenforcedProcessLimit); a non-root supervisor is verified with the limit proven.
  const isRoot = (process.getuid?.() ?? 0) === 0;
  const procOpts = isRoot ? {acceptUnenforcedProcessLimit: true} : {};
  let provider: LinuxUnshareSandboxProvider, st: {ok: boolean; detail?: string};
  // Ana makine gerçekten user+net+pid+mount namespace kurabiliyor mu (sağlayıcıdan BAĞIMSIZ ölçüm): kurabiliyorsa sağlayıcı DOGRULANMIŞ olmak ZORUNDA (bozuk sağlayıcı sessizce geçemez).
  const hostCanIsolate = (() => {
    if (process.platform !== "linux") return false;
    const a = cp.spawnSync("unshare", ["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL", "true"], {stdio: "ignore"});
    return a.status === 0 && ["setpriv", "pivot_root", "mount", "umount"].every(t => cp.spawnSync("sh", ["-c", `command -v ${t}`], {stdio: "ignore", env: {PATH: "/usr/sbin:/usr/bin:/sbin:/bin"}}).status === 0);
  })();
  beforeAll(async () => { provider = new LinuxUnshareSandboxProvider(procOpts); st = await provider.selfTest(); }, T2);

  it("host-exec refusal: missing primitives / wrong platform / not self-tested -> nothing runs on the host", { timeout: T2 }, async () => {
    const ws = mkws(); const marker = path.join(ws, "HOST_EXEC_MARKER");
    try {
      for (const p of [new LinuxUnshareSandboxProvider({unshareBinary: "/nonexistent/unshare"}), new LinuxUnshareSandboxProvider({platform: "win32"}), new LinuxUnshareSandboxProvider()]) {
        const probe = p as any;
        if (probe.o?.unshareBinary || probe.o?.platform) {
          const r = await p.selfTest();
          expect(r.ok).toBe(false);
          expect(r.detail).toMatch(/^(UNSHARE_MISSING|PLATFORM_NOT_LINUX_NOT_IMPLEMENTED)$/);
        }
        const res = await p.run(["sh", "-c", `touch ${marker}`], {cwd: ws, env: env(), timeoutMs: 5000});
        expect(res).toMatchObject({exitCode: null, spawnError: true});
        expect(res.stderr).toContain("SANDBOX_NOT_VERIFIED");
        expect(() => p.spawn("sh", ["-c", `touch ${marker}`], {cwd: ws, env: env()})).toThrow("SANDBOX_NOT_VERIFIED");
        expect(fs.existsSync(marker)).toBe(false);
      }
      const gate = new ExecutionGate(new LinuxUnshareSandboxProvider({unshareBinary: "/nonexistent/unshare"}));
      expect(await gate.authorize("RUNNER_VERIFY_TESTS")).toMatchObject({allowed: false, reason: SANDBOX_UNAVAILABLE, detail: "SELF_TEST_FAILED"});
    } finally { fs.rmSync(ws, {recursive: true, force: true}); }
  });

  it("is verified only when every isolation proof passes; otherwise it stays unverified and refuses", { timeout: T2 }, async () => {
    if (hostCanIsolate) {
      expect(st).toEqual(isRoot ? {ok: true, detail: "PROCESS_LIMIT_NOT_ENFORCED_ACCEPTED"} : {ok: true}); // the host can isolate, so a failing proof means a broken provider
      const gate = new ExecutionGate(provider);
      expect(await gate.authorize("RUNNER_VERIFY_TESTS")).toMatchObject({allowed: true, providerId: LINUX_SANDBOX_ID});
      expect(LINUX_SANDBOX_ID).toBe("linux-unshare-v2");
    } else {
      expect(st.ok).toBe(false);
      expect(st.detail).toMatch(/^(SELFTEST_[A-Z_]+|UNSHARE_[A-Z_]+|REQUIRED_TOOL_MISSING_[A-Z_]+|PLATFORM_[A-Z_]+)$/);
      const ws = mkws();
      try { expect((await provider.run(["sh", "-c", "true"], {cwd: ws, env: env(), timeoutMs: 5000})).spawnError).toBe(true); } finally { fs.rmSync(ws, {recursive: true, force: true}); }
    }
  });

  it("positive: a project test command runs inside the sandbox; exit codes and stdin are forwarded; scratch is the working directory", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const ws = mkws();
    try {
      fs.writeFileSync(path.join(ws, "ok.mjs"), "import fs from 'node:fs'; fs.writeFileSync('built.txt','1'); console.log('TESTS_PASSED ' + process.cwd());\n");
      fs.writeFileSync(path.join(ws, "bad.mjs"), "process.exit(3);\n");
      const ok = await provider.run([process.execPath, "ok.mjs"], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(ok).toMatchObject({exitCode: 0, timedOut: false, spawnError: false});
      expect(ok.stdout).toContain("TESTS_PASSED /work");
      expect(fs.readFileSync(path.join(ws, "built.txt"), "utf8")).toBe("1");
      expect((await provider.run([process.execPath, "bad.mjs"], {cwd: ws, env: env(), timeoutMs: 30_000})).exitCode).toBe(3);
      const sin = await provider.run(["sh", "-c", "read -r l; echo got=$l"], {cwd: ws, env: env(), timeoutMs: 30_000, input: "PIPED\n"});
      expect(sin.stdout).toContain("got=PIPED");
    } finally { fs.rmSync(ws, {recursive: true, force: true}); }
  });

  it("negative: the host filesystem is invisible (canary file, home dirs, host sockets, host /dev/shm, /sys)", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const ws = mkws(), outside = mkws(), hostShm = path.join("/dev/shm", `uasco-test-canary-${process.pid}`);
    let hits = 0;
    const canary = path.join(outside, "canary.txt"); fs.writeFileSync(canary, "HOST-SECRET", {mode: 0o644});
    const sock = path.join(outside, "s.sock");
    const server = net.createServer(sk => { hits++; sk.destroy(); });
    await new Promise<void>(r => server.listen(sock, () => r()));
    try { fs.writeFileSync(hostShm, "HOST-SHM"); } catch { /* yok */ }
    try {
      fs.writeFileSync(path.join(ws, "peek.mjs"), `import fs from 'node:fs'; import net from 'node:net'; const out = [];
        for (const f of [${JSON.stringify(canary)}, ${JSON.stringify(hostShm)}, '/root', '/home', '/run', '/var', '/sys', '/mnt', '/etc/shadow']) { try { fs.readFileSync(f); out.push('READ ' + f); } catch (e) { try { fs.readdirSync(f); out.push('LIST ' + f); } catch { out.push('NO ' + (e.code ?? 'ERR')); } } }
        console.log(out.join('|'));
        const c = net.connect(${JSON.stringify(sock)}); c.on('connect', () => { console.log('SOCK_CONNECTED'); process.exit(0); }); c.on('error', e => { console.log('SOCK_' + e.code); process.exit(0); });\n`);
      const r = await provider.run([process.execPath, "peek.mjs"], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toMatch(/READ |LIST /);
      expect(r.stdout).toContain("SOCK_ENOENT");
      expect(r.stdout).not.toContain("SOCK_CONNECTED");
      expect(hits).toBe(0);
    } finally { server.close(); fs.rmSync(ws, {recursive: true, force: true}); fs.rmSync(outside, {recursive: true, force: true}); fs.rmSync(hostShm, {force: true}); }
  });

  it("negative: network blocked; writes only to scratch/private tmp/private shm; /proc/sys read-only; capabilities dropped; nested userns blocked; host env and PATH shims not trusted", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const ws = mkws(), outside = path.join(os.tmpdir(), `uasco-sbx-outside-${process.pid}`);
    const shimDir = path.join(ws, "shimbin"); fs.mkdirSync(shimDir);
    for (const t of ["setpriv", "mount", "umount", "pivot_root", "unshare"]) { fs.writeFileSync(path.join(shimDir, t), `#!/bin/sh\n: > ${path.join(ws, "SHIM_RAN_" + t)}\nexec /usr/bin/${t} "$@"\n`, {mode: 0o755}); }
    process.env.UASCO_SBX_SECRET_PROBE = "leak";
    try {
      fs.writeFileSync(path.join(ws, "w.mjs"), `import fs from 'node:fs'; const out = [];
        for (const f of ['/usr/.sbx', '/etc/.sbx', '/.sbx', '/dev/.sbx', '/proc/sys/vm/swappiness', '/proc/sys/kernel/core_pattern', ${JSON.stringify(outside)}]) { try { fs.writeFileSync(f, f.startsWith('/proc') ? '60' : 'x'); out.push('WROTE ' + f); } catch (e) { out.push('DENIED ' + e.code); } }
        console.log(out.join('|')); console.log('SECRET=' + (process.env.UASCO_SBX_SECRET_PROBE ?? 'unset'));
        for (const f of ['/tmp/ok', '/dev/shm/ok', '/work/ok']) { try { fs.writeFileSync(f, '1'); console.log('OK ' + f); } catch { console.log('FAIL ' + f); } }\n`);
      const r = await provider.run([process.execPath, "w.mjs"], {cwd: ws, env: {PATH: `${shimDir}:${process.env.PATH ?? "/usr/bin:/bin"}`}, timeoutMs: 30_000});
      expect(r.exitCode).toBe(0);
      const line = r.stdout.split("\n")[0].split("|");
      expect(line).toHaveLength(7);
      for (const x of line.slice(0, 6)) expect(x).toMatch(/^DENIED /);                // /usr /etc / /dev /proc/sys x2 are not writable
      expect(line[6]).toMatch(/WROTE|DENIED/);                                        // private /tmp may accept it, but only inside the sandbox:
      expect(fs.existsSync(outside)).toBe(false);                                     // ...it is never visible on the host
      expect(r.stdout).toContain("SECRET=unset");
      for (const f of ["/tmp/ok", "/dev/shm/ok", "/work/ok"]) expect(r.stdout).toContain("OK " + f);
      expect(fs.existsSync(path.join(ws, "ok"))).toBe(true);                          // /work is the host scratch
      expect(fs.existsSync("/dev/shm/ok")).toBe(false);                               // /dev/shm is private
      expect(fs.readdirSync(ws).filter(n => n.startsWith("SHIM_RAN_"))).toEqual([]);  // caller PATH never reaches the privileged setup phase
      const probes = await provider.run(["sh", "-c", "awk '/^(CapInh|CapPrm|CapEff|CapBnd|CapAmb):/{print $2}' /proc/self/status | sort -u; grep '^NoNewPrivs' /proc/self/status; unshare -U true 2>&1; echo nested_rc=$?; mount -o remount,rw / 2>&1; echo mount_rc=$?; ls /sys 2>&1 | head -1"], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(probes.stdout).toContain("0000000000000000");
      expect(probes.stdout).toMatch(/NoNewPrivs:\s+1/);
      expect(probes.stdout).not.toContain("nested_rc=0");
      expect(probes.stdout).not.toContain("mount_rc=0");
      expect(probes.stdout).toContain("No such file");
      const netp = await provider.run(["sh", "-c", `[ -z "$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' ' | grep -v '^lo$')" ] && echo NET_NONE`], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(netp.stdout).toContain("NET_NONE");
    } finally { delete process.env.UASCO_SBX_SECRET_PROBE; fs.rmSync(ws, {recursive: true, force: true}); fs.rmSync(outside, {force: true}); }
  });

  it("negative: a caller PATH with sandbox-internal, relative or empty entries (/work, shims, '::') never reaches the privileged setup phase (setpriv/prlimit/sh are resolved with the fixed helper PATH)", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const ws = mkws();
    try {
      const shims = path.join(ws, "shims"); fs.mkdirSync(shims);
      for (const t of ["setpriv", "prlimit", "sh", "awk", "mount", "pivot_root"]) {
        // each planted binary records, from inside the sandbox, the capability sets it was given; they must never run
        fs.writeFileSync(path.join(shims, t), `#!/usr/bin/env sh\ngrep -E '^CapEff:' /proc/self/status > /work/SHIM_RAN_${t}\nexec /usr/bin/${t} "$@"\n`, {mode: 0o755});
      }
      fs.writeFileSync(path.join(ws, "caps.mjs"), "import fs from 'node:fs'; console.log(fs.readFileSync('/proc/self/status', 'utf8').split('\\n').filter(l => /^CapEff:/.test(l)).join('') + ' pid1=' + (process.ppid === 1));\n");
      for (const callerPath of ["/work/shims:/usr/bin:/bin", "shims:/usr/bin:/bin", "/usr/bin::/bin", ":/usr/bin:/bin", "/usr/bin:/bin:"]) {
        const r = await provider.run([process.execPath, "caps.mjs"], {cwd: ws, env: {PATH: callerPath}, timeoutMs: 30_000});
        expect([callerPath, r.exitCode]).toEqual([callerPath, 0]);
        expect(r.stdout).toMatch(/CapEff:\s+0000000000000000 pid1=true/);
        expect([callerPath, fs.readdirSync(ws).filter(n => n.startsWith("SHIM_RAN_"))]).toEqual([callerPath, []]);
      }
    } finally { fs.rmSync(ws, {recursive: true, force: true}); }
  });

  it("process count: maxProcesses is applied as RLIMIT_NPROC to the project (best effort); where the kernel enforces it (supervisor not kuid 0) forks beyond it fail", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const capped = new LinuxUnshareSandboxProvider({maxProcesses: 40, ...procOpts});
    expect((await capped.selfTest()).ok).toBe(true);
    const ws = mkws();
    try {
      const lim = await capped.run(["sh", "-c", "grep 'Max processes' /proc/self/limits | tr -s ' '"], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(lim.stdout).toContain("Max processes 40 40 processes");
      if ((process.getuid?.() ?? 0) !== 0) { // the kernel exempts kuid 0 (init user) from RLIMIT_NPROC, so enforcement can only be shown for a non-root supervisor
        const loop = 'ok=0; fail=0; i=0; while [ $i -lt 100 ]; do if (sleep 20 &) 2>/dev/null; then ok=$((ok+1)); else fail=$((fail+1)); fi; i=$((i+1)); done; echo ok=$ok fail=$fail';
        const r = await capped.run(["sh", "-c", loop], {cwd: ws, env: env(), timeoutMs: 30_000});
        const [ok, fail] = [/ok=(\d+)/.exec(r.stdout)?.[1], /fail=(\d+)/.exec(r.stdout)?.[1]].map(Number);
        expect(fail).toBeGreaterThan(0);
        expect(ok).toBeLessThanOrEqual(40);
      }
    } finally { fs.rmSync(ws, {recursive: true, force: true}); }
  });

  const isLinux = process.platform === "linux";
  const mkbase = (): string | null => { try { return fs.mkdtempSync("/var/tmp/uasco-sbx-f1-"); } catch { return null; } }; // outside /tmp: /tmp is replaced by a private tmpfs inside the sandbox

  it("F3: the kernel exempts kuid 0 from RLIMIT_NPROC, so the default provider stays UNVERIFIED for a root supervisor (fail closed) unless the operator accepts it explicitly; a non-root supervisor is verified with the limit proven", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const strict = new LinuxUnshareSandboxProvider();
    const r = await strict.selfTest();
    if (isRoot) {
      expect(r).toEqual({ok: false, detail: "SELFTEST_PROCESS_LIMIT_NOT_ENFORCED"});
      const ws = mkws();
      try { expect((await strict.run(["sh", "-c", "true"], {cwd: ws, env: env(), timeoutMs: 5000})).spawnError).toBe(true); } finally { fs.rmSync(ws, {recursive: true, force: true}); }
    } else expect(r).toEqual({ok: true});
  });

  it.skipIf(!isLinux)("F1: read-only toolchain roots are validated: broad roots, home directories, roots containing a home or sensitive entries (.ssh, .claude, ...) are refused; only the node prefix bin/lib are bound", () => {
    const base = mkbase(); expect(base).not.toBeNull();
    try {
      const mk = (rel: string, file = false) => { const f = path.join(base!, rel); fs.mkdirSync(file ? path.dirname(f) : f, {recursive: true}); if (file) fs.writeFileSync(f, "#!/bin/sh\n", {mode: 0o755}); return f; };
      const nodeAt = (prefix: string) => mk(`${prefix}/bin/node`, true);
      // a proper node prefix (npm layout): only bin and lib are bound, never the prefix itself
      const ok = nodeAt("ok"); mk("ok/lib/node_modules"); mk("ok/share/secret-docs");
      expect(nodeToolchainRoots(ok, [])).toEqual({roots: [path.join(base!, "ok/bin"), path.join(base!, "ok/lib")]});
      // nvm style prefix under the user's home is fine because it is neither the home nor an ancestor of it
      const nvm = nodeAt("home/u/.nvm/node/v24"); mk("home/u/.nvm/node/v24/lib/node_modules");
      expect(nodeToolchainRoots(nvm, [path.join(base!, "home/u")]).roots).toHaveLength(2);
      // the prefix IS a home, or contains one -> nothing is bound
      expect(nodeToolchainRoots(ok, [path.join(base!, "ok")])).toEqual({roots: [], problem: "NODE_PREFIX_ROOT_CONTAINS_HOME"});
      expect(nodeToolchainRoots(ok, [path.join(base!, "ok/home")])).toEqual({roots: [], problem: "NODE_PREFIX_ROOT_CONTAINS_HOME"});
      // node at ~/bin/node style layout with credentials next to it
      const homey = nodeAt("homey"); mk("homey/lib/node_modules"); mk("homey/.ssh");
      expect(nodeToolchainRoots(homey, [])).toEqual({roots: [], problem: "NODE_PREFIX_ROOT_HAS_SENSITIVE_ENTRY"});
      const claude = nodeAt("claudey"); mk("claudey/include/node"); mk("claudey/.claude");
      expect(nodeToolchainRoots(claude, []).problem).toBe("NODE_PREFIX_ROOT_HAS_SENSITIVE_ENTRY");
      // unrecognised layouts and unresolvable paths bind nothing
      expect(nodeToolchainRoots(nodeAt("nolayout"), [])).toEqual({roots: [], problem: "NODE_PREFIX_LAYOUT_UNRECOGNIZED"});
      expect(nodeToolchainRoots(mk("flat/node", true), [])).toEqual({roots: [], problem: "NODE_NOT_IN_BIN_DIRECTORY"});
      expect(nodeToolchainRoots(path.join(base!, "missing/bin/node"), [])).toEqual({roots: [], problem: "NODE_PATH_UNRESOLVABLE"});
      if (fs.existsSync("/usr/bin/env")) expect(nodeToolchainRoots("/usr/bin/env", [])).toEqual({roots: []}); // already bound read-only through /usr
      // explicit roots
      for (const bad of ["/", "/opt", "/home", "/home/alice", "/root", "/usr/local", "/var", "/etc", "/proc/1", "/dev/shm", "opt/x", "/opt/x y", "/opt//x", "/opt/x/", "/opt/a:b", "/tmp/x", "/work/x"]) expect([bad, readOnlyRootProblem(bad, [])]).toEqual([bad, expect.any(String)]);
      expect(readOnlyRootProblem(path.join(base!, "ok/bin"), [])).toBeNull();
      expect(readOnlyRootProblem(path.join(base!, "homey"), [])).toBe("ROOT_HAS_SENSITIVE_ENTRY");
      expect(readOnlyRootProblem(path.join(base!, "ok"), [path.join(base!, "ok/home")])).toBe("ROOT_CONTAINS_HOME");
      expect(new LinuxUnshareSandboxProvider({readOnlyRoots: ["/", "/home", "/root", path.join(base!, "homey"), os.homedir() === "/" ? "/home" : os.homedir()]}).toolchain().roots).toEqual([]);
    } finally { fs.rmSync(base!, {recursive: true, force: true}); }
  });

  it("F1: a bound toolchain root exposes nothing else from its parent directories (canary file, .ssh next to it); the selfTest proves the same listing", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const base = mkbase(); if (!base) return;
    const ws = mkws();
    try {
      const prefix = path.join(base, "prefix"); fs.mkdirSync(prefix); fs.writeFileSync(path.join(prefix, "tool"), "TOOL\n");
      fs.writeFileSync(path.join(base, "CANARY.txt"), "HOST-SECRET"); fs.mkdirSync(path.join(base, ".ssh")); fs.writeFileSync(path.join(base, ".ssh", "id_rsa"), "KEY");
      const p = new LinuxUnshareSandboxProvider({readOnlyRoots: [prefix], ...procOpts});
      expect(p.toolchain()).toEqual({roots: [prefix]});
      expect((await p.selfTest()).ok).toBe(true); // includes the ancestor-listing probe for this root
      const r = await p.run(["sh", "-c", `echo "LIST=$(ls -A ${base} | tr '\n' ',')"; cat ${base}/CANARY.txt 2>&1 | head -c 40; test ! -e ${base}/.ssh && echo SSH_HIDDEN; cat ${prefix}/tool; touch ${prefix}/x 2>&1; echo touch_rc=$?`], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(r.stdout).toContain("LIST=prefix,");
      expect(r.stdout).not.toContain("HOST-SECRET");
      expect(r.stdout).toContain("SSH_HIDDEN");
      expect(r.stdout).toContain("TOOL");
      expect(r.stdout).not.toContain("touch_rc=0");
      // a root that contains sensitive entries is refused outright, so its parent never becomes visible
      expect(new LinuxUnshareSandboxProvider({readOnlyRoots: [base]}).toolchain().roots).toEqual([]);
    } finally { fs.rmSync(base, {recursive: true, force: true}); fs.rmSync(ws, {recursive: true, force: true}); }
  });

  it("F2: with a controlling terminal on the host (pty), the sandbox gets no controlling terminal (tty_nr 0) and no /dev/tty node, so TIOCSTI injection into the parent shell is impossible", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    expect(cp.spawnSync("sh", ["-c", "command -v script"], {stdio: "ignore"}).status).toBe(0); // util-linux `script` allocates the pty; without it the probe would be vacuous
    const r = cp.spawnSync("script", ["-qec", `${process.execPath} --import tsx tests/support/sbx-tty-driver.mts`, "/dev/null"], {cwd: REPO, encoding: "utf8", env: {...process.env, UASCO_SBX_ACCEPT_UNENFORCED: isRoot ? "1" : "0"}, timeout: 120_000});
    const line = /RESULT .*/.exec(String(r.stdout))?.[0] ?? `NO_RESULT ${String(r.stdout).slice(-300)} ${String(r.stderr).slice(-300)}`;
    expect(line).toContain("selftest_ok=true");
    expect(Number(/host_tty_nr=(\d+)/.exec(line)?.[1] ?? 0)).toBeGreaterThan(0); // the host process really had a controlling terminal
    expect(line).toContain("sandbox_tty_nr=0");
    expect(line).toContain("dev_tty_absent");
  });

  it.skipIf(!isLinux)("F5: on timeout the whole process GROUP is killed (the namespace init and background grandchildren), not just the direct child", { timeout: T2 }, async () => {
    const t0 = Date.now();
    const r = await runProcess(["sh", "-c", "sleep 61.77 & sleep 61.77"], {cwd: os.tmpdir(), env: {PATH: process.env.PATH ?? "/usr/bin:/bin"}, timeoutMs: 800, newSession: true});
    expect(r.timedOut).toBe(true);
    for (let i = 0; i < 30 && hostHasProcess("61.77"); i++) await new Promise(x => setTimeout(x, 150));
    expect(hostHasProcess("61.77")).toBe(false);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });

  it("negative: the project is never pid 1 and cannot outlive a timeout (clears pdeathsig, setsid, ignores TERM); unsafe cwd, env-less and invalid argv are refused", { timeout: T2 }, async () => {
    if (!hostCanIsolate) return;
    const ws = mkws();
    try {
      const evil = `if command -v perl >/dev/null 2>&1; then perl -e 'syscall(157,1,0); syscall(101,16,1,0,0); $SIG{TERM}="IGNORE"; setpgrp; sleep 3; open(F,">late.txt"); print F 1; close F; exec("sleep","62.41")' & exec sleep 62.41; else trap "" TERM; (sleep 3; : > late.txt; exec sleep 62.41) & exec sleep 62.41; fi`;
      const pid = await provider.run(["sh", "-c", 'echo ppid=$PPID pid=$$'], {cwd: ws, env: env(), timeoutMs: 30_000});
      expect(pid.stdout).toContain("ppid=1 ");
      expect(pid.stdout).not.toContain("pid=1\n");
      const t0 = Date.now();
      const r = await provider.run(["sh", "-c", evil], {cwd: ws, env: env(), timeoutMs: 1200});
      expect(r.timedOut).toBe(true);
      expect(Date.now() - t0).toBeLessThan(20_000);
      await new Promise(x => setTimeout(x, 4500));
      expect(fs.existsSync(path.join(ws, "late.txt"))).toBe(false);
      for (let i = 0; i < 30 && hostHasProcess("62.41"); i++) await new Promise(x => setTimeout(x, 150));
      expect(hostHasProcess("62.41")).toBe(false);
      for (const cwd of ["relative/dir", "/", path.join(ws, "with space"), path.join(ws, "missing")]) {
        const res = await provider.run(["sh", "-c", "true"], {cwd, env: env(), timeoutMs: 5000});
        expect(res).toMatchObject({exitCode: null, spawnError: true});
      }
      expect((await provider.run([], {cwd: ws, env: env(), timeoutMs: 5000})).spawnError).toBe(true);
      expect((await provider.run(["sh", "-c", "true"], {cwd: ws, env: undefined as any, timeoutMs: 5000})).stderr).toContain("ENV_REQUIRED");
      expect(() => provider.spawn("sh", ["-c", "true"], {cwd: ws})).toThrow("ENV_REQUIRED");
    } finally { fs.rmSync(ws, {recursive: true, force: true}); }
  });
});

// //TR: LANE-B B-SBX-WIN-1: Windows için WSL2 tabanlı sandbox sağlayıcısı. Linux CI'da sahte bir wsl çalıştırıcısı enjekte edilir (her ret nedeni, argüman kurulumu, kopyalama, ortam/argv çevirisi, temizlik); GERÇEK WSL selfTest'i yalnız win32 + WSL + UASCO_WSL_DISTRO varsa çalışır, aksi halde SKIP olarak görünür ve ASLA PASS sayılmaz.
describe("LANE-B WSL unshare sandbox provider (fake wsl runner; real WSL only on win32 with WSL)", () => {
  const ISO = {nsFlags: ["--user", "--map-root-user", "--net", "--pid", "--mount", "--fork", "--kill-child=SIGKILL"], setup: "set -eu\n# isolation setup (test double)\n", helperPath: "/usr/sbin:/usr/bin:/sbin:/bin"};
  const GOOD_PROBE = "MNT_C=absent\nDRVFS=0\nUNIX_PATH_SOCKETS=0\nWSL_RUNTIME_DIRS=absent\nRW_usr=ro\nRW_etc=ro\nRW_bin=ro\nWORK=writable\nNET_IFACES=0\nCAPS_DROPPED=ok\nNO_CTTY=ok\nNESTED_USERNS=blocked\nPID_NS_PRIVATE=ok\nDONE=1\n";
  interface Cfg { status?: number; spawnError?: boolean; distros?: string; version?: string; interop?: string | string[]; peRc?: number; peNoexec?: string; tools?: string; roots?: string[]; probe?: string; probeRc?: number; mktempFails?: boolean; runOut?: string; runRc?: number; runDelayMs?: number;
    forkOut?: string; timeoutRc?: number; late?: boolean; stdinOut?: string; pkillRc?: number; pgrepAlive?: boolean; scratchRemains?: boolean; duOut?: string; truncated?: boolean; runBytes?: Buffer; outerRc?: number; reject?: boolean; nodePath?: string; noTarget?: boolean }
  const u16 = (t: string) => Buffer.from("﻿" + t, "utf16le");
  const mkRunner = (cfg: Cfg = {}) => {
    const calls: {args: string[]; input?: Buffer | string}[] = []; const files = new Map<string, string>();
    let tarIn: Buffer | null = null, outerN = 0;
    const runner = async (args: string[], o: {timeoutMs: number; input?: Buffer | string}) => {
      calls.push({args, input: o.input});
      if (cfg.reject && args[0] === "--status") throw new Error("boom");
      const R = (exitCode: number | null, out = "", extra: Partial<{spawnError: boolean; timedOut: boolean; truncated: boolean}> = {}) => ({exitCode, stdout: Buffer.from(out), stderr: Buffer.alloc(0), timedOut: false, aborted: false, spawnError: false, ...extra});
      if (args[0] === "--status") return cfg.spawnError ? R(null, "", {spawnError: true}) : R(cfg.status ?? 0);
      if (args[0] === "-l" && args[1] === "-q") return {...R(0), stdout: u16(cfg.distros ?? "Ubuntu\r\nDebian\r\n")};
      if (args[0] === "-l" && args[1] === "-v") return {...R(0), stdout: u16(cfg.version ?? "  NAME      STATE           VERSION\r\n* Ubuntu    Running         2\r\n  Debian    Stopped         2\r\n")};
      const cmd = args.slice(3);   // ["-d", distro, "--exec", ...]
      if (cmd[0] === "/usr/bin/mktemp") return cfg.mktempFails ? R(1) : R(0, "/tmp/uasco-sbx-AbC123\n");
      if (cmd[0] === "/bin/mkdir" || cmd[0] === "/bin/chmod" || cmd[0] === "/bin/kill" || cmd[0] === "/usr/bin/find" || cmd[0] === "/bin/rm") return R(0);
      if (cmd[0] === "/usr/bin/tee") { files.set(cmd[1], String(o.input)); return R(0); }
      if (cmd[0] === "/bin/cat") return R(0, "4242\n");
      if (cmd[0] === "/bin/tar") { tarIn = Buffer.from(o.input as Buffer); return R(0); }
      if (cmd[0] === "/usr/bin/du") return R(0, cfg.duOut ?? "120\t/tmp/uasco-sbx-AbC123/work\n");
      if (cmd[0] === "/usr/bin/pkill") return R(cfg.pkillRc ?? 1);
      if (cmd[0] === "/usr/bin/pgrep" && cmd[1] === "-P") return cfg.noTarget ? R(1) : R(0, "777\n");
      if (cmd[0] === "/usr/bin/pgrep") return R(cfg.pgrepAlive ? 0 : 1);
      if (cmd[0] === "/usr/bin/test" && cmd[1] === "!") return R(cmd[3].endsWith("late.txt") ? (cfg.late ? 1 : 0) : (cfg.scratchRemains ? 1 : 0));
      if (cmd[0] === "/usr/bin/test") return R(cfg.roots ? (cfg.roots.includes(cmd[2]) ? 0 : 1) : (cmd[2] === "/srv" ? 0 : 1));
      if (cmd[0] === "/bin/sh" && cmd[1].endsWith("/ctl/outer.sh")) {
        const seq = Array.isArray(cfg.interop) ? cfg.interop : [cfg.interop ?? "absent"]; const ip = seq[Math.min(outerN++, seq.length - 1)];
        return R(cfg.outerRc ?? 0, `INTEROP=${ip}\nTOOLS=${cfg.tools ?? "ok"}\nPE_EXEC_RC=${cfg.peRc ?? 126}\nPE_ENOEXEC=${cfg.peNoexec ?? "yes"}\nNODE=${cfg.nodePath ?? "/usr/bin/node"}\nDONE=1\n`);
      }
      if (cmd[0] === "/bin/sh" && cmd[1].endsWith("/ctl/run.sh")) {
        const sh = files.get(cmd[1]) ?? "";
        if (sh.includes("MNT_C=")) return R(cfg.probeRc ?? 0, cfg.probe ?? GOOD_PROBE);
        if (sh.includes("fail=$fail")) return R(0, cfg.forkOut ?? "ok=47 fail=103\n");
        if (sh.includes("late.txt")) return R(cfg.timeoutRc ?? 137, "", {timedOut: (cfg.timeoutRc ?? 137) !== 0});
        if (sh.includes("got=$l")) return R(0, cfg.stdinOut ?? `got=${String(o.input).trim()}\n`);
        if (cfg.runDelayMs) await new Promise(r => setTimeout(r, cfg.runDelayMs));
        return {...R(cfg.runRc ?? 0, cfg.runOut ?? "tests ok\n", {truncated: cfg.truncated}), stdout: cfg.runBytes ?? Buffer.from(cfg.runOut ?? "tests ok\n")};
      }
      return R(1);
    };
    return {runner, calls, files, tar: () => tarIn};
  };
  const mk = async (cfg: Cfg = {}, o: Record<string, unknown> = {}) => {
    const mod = await import("../core/sandbox/wsl-unshare-sandbox.js"); const f = mkRunner(cfg);
    return {mod, f, p: new mod.WslUnshareSandboxProvider({platform: "win32", distro: "Ubuntu", runner: f.runner as any, isolation: ISO, settleMs: 0, ...o})};
  };
  const ws = () => { const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-wsl-")); fs.writeFileSync(path.join(d, "test.js"), "console.log('t')\n"); fs.mkdirSync(path.join(d, "sub")); fs.writeFileSync(path.join(d, "sub", "a.txt"), "A"); return d; };

  it("a fully isolated WSL passes selfTest; the gate authorizes; run copies the project in, runs inside the sandbox script and cleans up; no host path is ever passed to wsl.exe", async () => {
    const {mod, f, p} = await mk(); const dir = ws();
    try {
      expect(await p.selfTest()).toEqual({ok: true});
      const gate = new ExecutionGate(p as any);
      const d = await gate.authorize("RUNNER_VERIFY_TESTS");
      expect(d.allowed).toBe(true);
      const r = await p.run([process.execPath, "test.js"], {cwd: dir, env: {PATH: "C:\\Windows", USERPROFILE: "C:\\Users\\x", FOO: "bar baz", BAD: "C:\\secret"}, timeoutMs: 20_000});
      expect(r).toMatchObject({exitCode: 0, stdout: "tests ok\n", timedOut: false, spawnError: false});
      const runSh = [...f.files.entries()].filter(([k]) => k.endsWith("run.sh")).map(([, v]) => v).pop()!;
      expect(runSh).toContain("'--map-root-user'"); expect(runSh).toContain("/usr/bin/timeout --signal=KILL"); expect(runSh.split("\n")[1].startsWith("exec ")).toBe(false); expect(runSh).toContain("/ctl/pid"); expect(runSh).toContain("/ctl/rc"); expect(runSh).toContain("'FOO=bar baz'");
      expect(runSh).not.toContain("USERPROFILE"); expect(runSh).not.toContain("C:\\\\"); expect(runSh).toContain("'node' 'test.js'"); expect(runSh).toContain("'/srv'");
      for (const c of f.calls) { const all = c.args.join(" "); expect(all).not.toContain(dir); expect(all).not.toContain("/mnt/"); expect(all).not.toMatch(/[A-Za-z]:\\/); }
      const tail = f.calls.slice(-7).map(c => c.args.slice(3).join(" "));
      expect(tail).toEqual(["/bin/cat /tmp/uasco-sbx-AbC123/ctl/pid", "/bin/kill -KILL -- -4242", "/usr/bin/pkill -KILL -f -- /tmp/uasco-sbx-AbC123", "/usr/bin/pgrep -f -- /tmp/uasco-sbx-AbC123", "/bin/chmod -R u+rwX -- /tmp/uasco-sbx-AbC123", "/bin/rm -rf -- /tmp/uasco-sbx-AbC123", "/usr/bin/test ! -e /tmp/uasco-sbx-AbC123"]);
      const tar = f.tar()!; expect(tar.length % 512).toBe(0);
      const names = []; for (let o = 0; o + 512 <= tar.length && tar[o] !== 0; ) { const sz = parseInt(tar.subarray(o + 124, o + 135).toString().trim() || "0", 8); names.push(tar.subarray(o, o + 100).toString().replace(/\0.*$/, "")); o += 512 + Math.ceil(sz / 512) * 512; }
      expect(names).toEqual(["sub/", "sub/a.txt", "test.js"]);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

  it.each([
    ["PLATFORM_NOT_WIN32", {}, {platform: "linux"}],
    ["WSL_EXE_MISSING", {spawnError: true}, {}],
    ["WSL_NOT_AVAILABLE", {status: 1}, {}],
    ["WSL_DISTRO_NOT_CONFIGURED", {}, {distro: ""}],
    ["WSL_DISTRO_MISSING", {distros: "Debian\r\n"}, {}],
    ["WSL_VERSION_NOT_2", {version: "  NAME STATE VERSION\r\n* Ubuntu Running 1\r\n"}, {}],
    ["LINUX_ISOLATION_EXPORTS_MISSING", {}, {isolation: null}],
    ["INTEROP_ENABLED", {interop: "enabled"}, {}],
    ["INTEROP_ENABLED", {interop: "unknown"}, {}],
    ["INTEROP_ENABLED", {peRc: 127}, {}],
    ["INTEROP_ENABLED", {peRc: 0}, {}],
    ["INTEROP_ENABLED", {peNoexec: "no"}, {}],
    ["PROBE_PROCESS_LIMIT_NOT_ENFORCED", {forkOut: "ok=150 fail=0\n"}, {}],
    ["PROBE_PROCESS_LIMIT_NOT_ENFORCED", {forkOut: "garbage"}, {}],
    ["PROBE_TIMEOUT_NOT_ENFORCED", {timeoutRc: 0}, {}],
    ["PROBE_TIMEOUT_TREE_SURVIVED", {late: true}, {}],
    ["PROBE_TIMEOUT_TREE_SURVIVED", {pgrepAlive: true}, {}],
    ["PROBE_STDIN_NOT_FORWARDED", {stdinOut: "nothing\n"}, {}],
    ["WSL_TOOLS_MISSING", {tools: "missing"}, {}],
    ["NO_NEW_ROOT_MOUNTPOINT", {roots: ["/mnt"]}, {}],
    ["SCRATCH_CREATE_FAILED", {mktempFails: true}, {}],
    ["PROBE_FAILED", {probeRc: 3}, {}]
  ])("%s -> SANDBOX_UNAVAILABLE, nothing runs", async (reason, cfg, o) => {
    const {f, p} = await mk(cfg as Cfg, o as any); const dir = ws();
    try {
      const st = await p.selfTest();
      expect(st).toEqual({ok: false, detail: reason});
      expect(p.lastSelfTest).toEqual(st);
      const gate = new ExecutionGate(p as any);
      expect((await gate.authorize("RUNNER_VERIFY_TESTS")).allowed).toBe(false);
      const before = f.calls.length;
      const r = await p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000});
      expect(r).toMatchObject({spawnError: true, exitCode: null}); expect(r.stderr).toContain("SANDBOX_NOT_VERIFIED");
      expect(f.calls.length).toBe(before);
      expect(() => p.spawn("node", ["x"], {cwd: dir, env: {}})).toThrow("SANDBOX_NOT_VERIFIED");
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

  it.each([["MNT_C", "present"], ["DRVFS", "2"], ["UNIX_PATH_SOCKETS", "1"], ["CAPS_DROPPED", "no"], ["NO_CTTY", "no"], ["NESTED_USERNS", "allowed"], ["PID_NS_PRIVATE", "no"], ["WSL_RUNTIME_DIRS", "present"], ["RW_usr", "writable"], ["RW_etc", "writable"], ["RW_bin", "writable"], ["WORK", "ro"], ["NET_IFACES", "1"], ["DONE", "0"]])(
    "the negative probe %s=%s makes the provider unavailable (PROBE_<KEY>), and a missing key does too", async (key, bad) => {
      const probe = GOOD_PROBE.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${bad}`);
      expect((await (await mk({probe})).p.selfTest())).toEqual({ok: false, detail: `PROBE_${key.toUpperCase()}`});
      const missing = GOOD_PROBE.split("\n").filter(l => !l.startsWith(key + "=")).join("\n");
      expect((await (await mk({probe: missing})).p.selfTest())).toEqual({ok: false, detail: `PROBE_${key.toUpperCase()}`});
    });

  it("run() translates the host node path, refuses other Windows paths and unsafe working directories, skips symlinks, and refuses oversized or unsafe-named projects", async () => {
    const {mod, f, p} = await mk({}, {tarLimits: {maxFiles: 2, maxTotalBytes: 1 << 20, maxFileBytes: 1 << 20, maxDepth: 5}}); const dir = ws();
    try {
      await p.selfTest();
      expect(mod.translateArgv([process.execPath, "a.js"])).toEqual(["node", "a.js"]);
      expect(mod.translateArgv(["C:\\Tools\\node.exe", "a.js"])).toEqual(["node", "a.js"]);
      expect(mod.translateArgv(["C:\\Tools\\evil.exe"])).toBeNull(); expect(mod.translateArgv([])).toBeNull(); expect(mod.translateArgv(["npm", "test"])).toEqual(["npm", "test"]);
      const env = {};
      expect((await p.run(["C:\\Tools\\evil.exe"], {cwd: dir, env, timeoutMs: 5000})).stderr).toContain("ARGV_INVALID_OR_HOST_PATH");
      expect((await p.run(["node"], {cwd: path.parse(dir).root, env, timeoutMs: 5000})).stderr).toContain("CWD_NOT_ABSOLUTE_OR_ROOT");
      expect((await p.run(["node"], {cwd: os.homedir(), env, timeoutMs: 5000})).stderr).toContain("CWD_IS_HOME_OR_ANCESTOR");
      expect((await p.run(["node"], {cwd: path.join(dir, "missing"), env, timeoutMs: 5000})).stderr).toContain("CWD_MISSING");
      expect((await p.run(["node"], {cwd: dir, env: undefined as any, timeoutMs: 5000})).stderr).toContain("ENV_REQUIRED");
      fs.writeFileSync(path.join(dir, "b.txt"), "B");
      expect((await p.run(["node"], {cwd: dir, env, timeoutMs: 5000})).stderr).toContain("COPY_TOO_MANY_FILES");
      fs.rmSync(path.join(dir, "b.txt"));
      if (process.platform !== "win32") {
        fs.symlinkSync("/etc/passwd", path.join(dir, "link"));
        const r = await p.run(["node", "test.js"], {cwd: dir, env, timeoutMs: 5000});
        expect(r.exitCode).toBe(0); expect(r.stderr).toContain("1 symbolic link(s)/special file(s) were not copied");
        expect(f.tar()!.toString("latin1")).not.toContain("passwd");
        fs.writeFileSync(path.join(dir, "a:b.txt"), "x");
        expect((await p.run(["node", "test.js"], {cwd: dir, env, timeoutMs: 5000})).stderr).toContain("COPY_UNSAFE_NAME");
      }
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

  it("a hung run is reported as timed out, a failing copy-in refuses, and the scratch directory is removed in every case", async () => {
    const dir = ws();
    try {
      const slow = await mk({runDelayMs: 80, runRc: 137}); await slow.p.selfTest();
      const t = await slow.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 50});
      expect(t).toMatchObject({timedOut: true, exitCode: null});
      expect(slow.f.calls.slice(-2)[0].args.slice(3)).toEqual(["/bin/rm", "-rf", "--", "/tmp/uasco-sbx-AbC123"]);
      const ok = await mk({runRc: 1, runOut: ""}); await ok.p.selfTest();
      expect((await ok.p.run(["node", "x"], {cwd: dir, env: {}, timeoutMs: 5000})).exitCode).toBe(1);
      expect(ok.f.calls.slice(-2)[0].args.slice(3)).toEqual(["/bin/rm", "-rf", "--", "/tmp/uasco-sbx-AbC123"]);
      expect(() => ok.p.spawn("node", [], {cwd: dir, env: {}})).toThrow("SPAWN_NOT_SUPPORTED_IN_WSL_V1");
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });

  it("shell quoting, env filtering and WSL text decoding are exact", async () => {
    const {shq, wslEnv, decodeWslText} = await import("../core/sandbox/wsl-unshare-sandbox.js");
    expect(shq("a b")).toBe("'a b'"); expect(shq("it's")).toBe("'it'\\''s'"); expect(shq("$(x);`y`")).toBe("'$(x);`y`'");
    expect(wslEnv({PATH: "C:\\x", Path: "C:\\y", USERPROFILE: "C:\\u", A_B: "1", "bad-key": "x", NUL: "a\0b", NL: "a\nb", DRIVE: "x=C:\\z", OK: "yes sir", WSLENV: "x"})).toEqual(["A_B=1", "OK=yes sir"]);
    expect(decodeWslText(Buffer.from("\uFEFFUbuntu\r\nDebian\r\n", "utf16le"))).toBe("Ubuntu\r\nDebian\r\n"); expect(decodeWslText(Buffer.from("abc"))).toBe("abc");
  });

  it("the default Linux isolation comes from the Linux provider module exports; until Lane C exports them the WSL provider refuses with LINUX_ISOLATION_EXPORTS_MISSING (never a fork of the script)", async () => {
    const {linuxIsolationFromModule, WslUnshareSandboxProvider} = await import("../core/sandbox/wsl-unshare-sandbox.js");
    expect(linuxIsolationFromModule({})).toBeNull(); expect(linuxIsolationFromModule({LINUX_SANDBOX_NS_FLAGS: ["--user"], LINUX_SANDBOX_SETUP: "x", LINUX_SANDBOX_HELPER_PATH: "/bin"})).not.toBeNull();
    expect(linuxIsolationFromModule({LINUX_SANDBOX_NS_FLAGS: [1], LINUX_SANDBOX_SETUP: "x", LINUX_SANDBOX_HELPER_PATH: "/bin"})).toBeNull();
    const f = mkRunner();
    const st = await new WslUnshareSandboxProvider({platform: "win32", distro: "Ubuntu", runner: f.runner as any}).selfTest();
    if (linuxIsolationFromModule() === null) expect(st).toEqual({ok: false, detail: "LINUX_ISOLATION_EXPORTS_MISSING"});
    else expect(st.detail).not.toBe("LINUX_ISOLATION_EXPORTS_MISSING");
  });

  // //TR: B-SBX-WIN-2 (güvenlik incelemesi 4a80a18): her düzeltme için, düzeltme olmadan KIRILAN test.
  describe("B-SBX-WIN-2 review fixes", () => {
    it("WSL-INTEROP-STALE-SELFTEST: interop is re-checked on EVERY run; if it became active after selfTest the run is refused before anything is copied or executed and the provider becomes unverified", async () => {
      const {f, p} = await mk({interop: ["absent", "enabled"]}); const dir = ws();
      try {
        expect(await p.selfTest()).toEqual({ok: true});
        const before = f.calls.length;
        const r = await p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000});
        expect(r).toMatchObject({spawnError: true, exitCode: null}); expect(r.stderr).toContain("INTEROP_ENABLED");
        const after = f.calls.slice(before).map(c => c.args[3]);
        expect(after).not.toContain("/bin/tar"); expect(f.files.get("/tmp/uasco-sbx-AbC123/ctl/run.sh")?.includes("test.js") ?? false).toBe(false);
        expect(p.lastSelfTest).toEqual({ok: false, detail: "INTEROP_ENABLED"});
        expect((await p.run(["node", "x"], {cwd: dir, env: {}, timeoutMs: 5000})).stderr).toContain("SANDBOX_NOT_VERIFIED");
        expect((await new ExecutionGate(p as any).authorize("RUNNER_VERIFY_TESTS")).allowed).toBe(false);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("the valid probe PE is written to WSL and the OUTER script really fails closed: unreadable/unknown binfmt entry = enabled; only a clean 'disabled' passes; a real PE exec on this host yields ENOEXEC (126)", async () => {
      const {mod, f, p} = await mk(); await p.selfTest();
      const pe = mod.minimalPe(); expect(pe.subarray(0, 2).toString("latin1")).toBe("MZ"); expect(pe.subarray(pe.readUInt32LE(0x3c), pe.readUInt32LE(0x3c) + 4).toString("latin1")).toBe("PE\0\0"); expect(pe.length).toBeGreaterThan(0x200);
      const put = f.calls.find(c => c.args[3] === "/usr/bin/tee" && c.args[4].endsWith("/probe.exe"))!; expect(Buffer.isBuffer(put.input) && (put.input as Buffer).equals(pe)).toBe(true);
      expect(f.calls.some(c => c.args[3] === "/bin/chmod" && c.args[4] === "+x")).toBe(true);
      const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-binfmt-")); const ctl = path.join(tmp, "ctl"); fs.mkdirSync(ctl);
      try {
        fs.writeFileSync(path.join(ctl, "probe.exe"), pe); fs.chmodSync(path.join(ctl, "probe.exe"), 0o755);
        fs.writeFileSync(path.join(ctl, "outer.sh"), mod.OUTER_SCRIPT.replaceAll("/proc/sys/fs/binfmt_misc", path.join(tmp, "bm")));
        const run = () => cp.spawnSync("/bin/sh", [path.join(ctl, "outer.sh")], {encoding: "utf8"}).stdout;
        expect(run()).toContain("INTEROP=absent");
        fs.mkdirSync(path.join(tmp, "bm")); fs.writeFileSync(path.join(tmp, "bm", "WSLInterop"), "disabled\n"); expect(run()).toContain("INTEROP=disabled");
        fs.writeFileSync(path.join(tmp, "bm", "WSLInterop"), "enabled\ninterpreter /init\n"); expect(run()).toContain("INTEROP=enabled");
        fs.writeFileSync(path.join(tmp, "bm", "WSLInterop"), "weird\n"); expect(run()).toContain("INTEROP=enabled");
        fs.rmSync(path.join(tmp, "bm", "WSLInterop")); fs.mkdirSync(path.join(tmp, "bm", "WSLInterop")); expect(run()).toContain("INTEROP=enabled");
        const out = run(); expect(out).toContain("PE_EXEC_RC=126"); expect(out).toContain("PE_ENOEXEC=yes");
      } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
    });

    it("captured output is bounded (LC-2): BoundedCapture keeps at most the cap, keeps accepting (draining) afterwards and marks truncated; the real runner returns the capped buffer with truncated=true and the provider says so", async () => {
      const {BoundedCapture, spawnWslRunner} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const c = new BoundedCapture(10); c.push(Buffer.alloc(6, 97)); expect(c.truncated).toBe(false); c.push(Buffer.alloc(6, 98)); c.push(Buffer.alloc(1000, 99));
      expect(c.buffer.length).toBe(10); expect(c.truncated).toBe(true); expect(c.buffer.toString()).toBe("aaaaaabbbb");
      const r = await spawnWslRunner(process.execPath, 100, 1024)(["-e", "process.stdout.write('x'.repeat(300000));process.stderr.write('y'.repeat(2000))"], {timeoutMs: 20_000});
      expect(r.exitCode).toBe(0); expect(r.stdout.length).toBe(1024); expect(r.stderr.length).toBe(1024); expect(r.truncated).toBe(true);
      const {p} = await mk({truncated: true}); await p.selfTest(); const dir = ws();
      try { expect((await p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000})).stderr).toContain("output truncated"); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("LC-6: untrusted test output is decoded as UTF-8 (a NUL byte cannot flip the stream to UTF-16 and corrupt the evidence)", async () => {
      const {p} = await mk({runBytes: Buffer.from("Tests  12 passed (12)\n\0\n")}); await p.selfTest(); const dir = ws();
      try { expect((await p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000})).stdout).toBe("Tests  12 passed (12)\n\0\n"); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("LC-4/LC-3: cleanup failures are reported, never swallowed (scratch not removed, process survived, pkill error); a /work over the size cap or of unknown size fails the run", async () => {
      const dir = ws();
      try {
        for (const [cfg, code] of [[{scratchRemains: true}, "SCRATCH_NOT_REMOVED"], [{pgrepAlive: false, pkillRc: 2}, "PKILL_FAILED"]] as const) {
          const m = await mk(cfg as Cfg); await m.p.selfTest(); // selfTest cleanup failures never change the verdict
          if (!m.p.lastSelfTest?.ok) { expect(code).toBe("never"); }
          expect((await m.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000})).stderr).toContain(`CLEANUP_FAILED: ${code}`);
        }
        const surv2 = await mk({pgrepAlive: true}); await surv2.p.selfTest();
        expect(surv2.p.lastSelfTest).toEqual({ok: false, detail: "PROBE_TIMEOUT_TREE_SURVIVED"});
        const big = await mk({duOut: "99999999\t/x\n"}); await big.p.selfTest();
        const rb = await big.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000}); expect(rb.exitCode).toBe(1); expect(rb.stderr).toContain("WORK_SIZE_EXCEEDED_OR_UNKNOWN");
        const unk = await mk({duOut: "du: error\n"}); await unk.p.selfTest();
        expect((await unk.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000})).exitCode).toBe(1);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("SELFTEST_ERROR: a probe that throws resolves {ok:false, SELFTEST_ERROR}, is recorded, and the gate refuses (pins the fail-closed branch)", async () => {
      const {p} = await mk({reject: true});
      expect(await p.selfTest()).toEqual({ok: false, detail: "SELFTEST_ERROR"}); expect(p.lastSelfTest).toEqual({ok: false, detail: "SELFTEST_ERROR"});
      expect((await new ExecutionGate(p as any).authorize("RUNNER_VERIFY_TESTS")).allowed).toBe(false);
    });

    it("stale uasco-sbx-* scratch directories are swept at selfTest (find with chmod then rm, -mmin +20, depth 1)", async () => {
      const {f, p} = await mk(); await p.selfTest();
      const finds = f.calls.map(c => c.args.slice(3)).filter(a => a[0] === "/usr/bin/find");
      expect(finds).toHaveLength(2); for (const a of finds) { expect(a).toContain("-maxdepth"); expect(a).toContain("uasco-sbx-??????"); expect(a).toContain("+20"); }
      expect(finds[0]).toContain("/bin/chmod"); expect(finds[1]).toContain("/bin/rm");
    });

    it("NTFS hardlinks are not copied into WSL (LOW: host-file exfiltration via a link to a secret)", async () => {
      if (process.platform === "win32") return;
      const {buildTar} = await import("../core/sandbox/wsl-tar.js"); const dir = ws(), out = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-hl-"));
      try {
        fs.writeFileSync(path.join(out, "secret.txt"), "TOP-SECRET"); fs.linkSync(path.join(out, "secret.txt"), path.join(dir, "hard.txt"));
        const t = buildTar(dir); expect(t.skippedLinks).toBe(1); expect(t.archive.toString("latin1")).not.toContain("TOP-SECRET"); expect(t.archive.toString("latin1")).not.toContain("hard.txt");
      } finally { fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(out, {recursive: true, force: true}); }
    });
  });

  // //TR: LANE-B B-RUN-WIN-1: Windows'ta çalışan ürün. spawnAsync = run() ile aynı izolasyon ama süreç çalışır kalır; köprü = Windows'ta YALNIZ 127.0.0.1 dinleyici + wsl.exe --exec stdio + WSL içi nsenter rölesi. Sahte wsl çalıştırıcı/başlatıcı ile her ret ve argüman kurulumu doğrulanır; gerçek WSL testi yalnız win32 + WSL'de çalışır (başka yerde SKIP, PASS sayılmaz). UNVERIFIED_WSL: gerçek wsl.exe/nsenter davranışı Founder koşusunu bekler.
  describe("B-RUN-WIN-1 dev-run on WSL (spawnAsync + bridge)", () => {
    const fakeChild = (pid: number | null = 5555) => {
      const e = new EventEmitter() as any; e.pid = pid ?? undefined; e.exitCode = null; e.signalCode = null; e.stdout = new PassThrough(); e.stderr = new PassThrough(); e.stdin = null;
      e.kill = () => { e.exitCode = 137; e.emit("exit", 137, null); e.emit("close", 137); return true; }; return e;
    };
    const mkS = async (cfg: Cfg = {}) => {
      const spawned: {args: string[]; stdio: unknown; child: any}[] = [];
      const spawner = (args: string[], stdio: unknown) => { const isRelay = args.includes("relay.sh") || String(args[args.length - 3]).endsWith("relay.sh"); const c: any = fakeChild(); if (isRelay) { c.stdin = new PassThrough(); c.stdout = c.stdin; } spawned.push({args, stdio, child: c}); return c; };
      const m = await mk(cfg, {spawner}); await m.p.selfTest();
      return {...m, spawned};
    };
    const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms));
    const opts = (dir: string, env: any = {FOO: "bar"}) => ({cwd: dir, env, shell: false, stdio: ["ignore", "pipe", "pipe"]}) as any;

    it("refusals: unverified, bad argv/env/cwd, unsafe project, scratch failure, copy failure - nothing is spawned and scratch is never left behind", async () => {
      const dir = ws();
      try {
        const un = await mk({probeRc: 3}); await un.p.selfTest();
        await expect(un.p.spawnAsync("node", ["server.js"], opts(dir))).rejects.toThrow("SANDBOX_NOT_VERIFIED");
        const {p, f, spawned} = await mkS();
        await expect(p.spawnAsync("C:\\Tools\\evil.exe", [], opts(dir))).rejects.toThrow("ARGV_INVALID_OR_HOST_PATH");
        await expect(p.spawnAsync("node", [], {...opts(dir), env: undefined})).rejects.toThrow("ENV_REQUIRED");
        await expect(p.spawnAsync("node", [], opts(path.parse(dir).root))).rejects.toThrow("CWD_NOT_ABSOLUTE_OR_ROOT");
        await expect(p.spawnAsync("node", [], opts(path.join(dir, "missing")))).rejects.toThrow("CWD_MISSING");
        await expect(p.spawnAsync("node", [], opts(os.homedir()))).rejects.toThrow("CWD_IS_HOME_OR_ANCESTOR");
        expect(spawned).toHaveLength(0); expect(f.calls.some(c => c.args[3] === "/bin/tar")).toBe(false);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
      const dir2 = ws();
      try {
        const tarFail = await mk({}, {tarLimits: {maxFiles: 1, maxTotalBytes: 1 << 20, maxFileBytes: 1 << 20, maxDepth: 5}, spawner: () => { throw new Error("unexpected"); }}); await tarFail.p.selfTest();
        await expect(tarFail.p.spawnAsync("node", ["server.js"], opts(dir2))).rejects.toThrow("COPY_TOO_MANY_FILES");
      } finally { fs.rmSync(dir2, {recursive: true, force: true}); }
    });

    it("interop turned on after selfTest: spawnAsync refuses INTEROP_ENABLED before copying anything or spawning, cleans the scratch dir and un-verifies the provider", async () => {
      const {p, f, spawned} = await mkS({interop: ["absent", "enabled"]}); const dir = ws();
      try {
        await expect(p.spawnAsync("node", ["server.js"], opts(dir))).rejects.toThrow("INTEROP_ENABLED");
        expect(spawned).toHaveLength(0); expect(f.calls.some(c => c.args[3] === "/bin/tar")).toBe(false);
        expect(f.calls.slice(-1)[0].args.slice(3)).toEqual(["/usr/bin/test", "!", "-e", "/tmp/uasco-sbx-AbC123"]);
        expect(p.lastSelfTest).toEqual({ok: false, detail: "INTEROP_ENABLED"});
        await expect(p.spawnAsync("node", [], opts(dir))).rejects.toThrow("SANDBOX_NOT_VERIFIED");
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("happy path: exact wsl.exe argv (no values, no host path), run.sh keeps the same isolation as run() with a bounded dev lifetime, relay files are staged, the child is returned, and on exit the Linux tree + scratch are torn down (pgid kill) before sandboxTeardown resolves", async () => {
      const {p, f, spawned} = await mkS(); const dir = ws();
      try {
        expect(p.network).toBe("ISOLATED");
        const child: any = await p.spawnAsync(process.execPath, ["server.js"], opts(dir, {FOO: "bar", PORT: "4321"}));
        expect(spawned).toHaveLength(1); expect(spawned[0].args).toEqual(["-d", "Ubuntu", "--exec", "/bin/sh", "/tmp/uasco-sbx-AbC123/ctl/run.sh"]); expect(spawned[0].stdio).toEqual(["ignore", "pipe", "pipe"]);
        const runSh = f.files.get("/tmp/uasco-sbx-AbC123/ctl/run.sh")!;
        expect(runSh).toContain("'--map-root-user'"); expect(runSh).toContain("'PORT=4321'"); expect(runSh).toContain("'node' 'server.js'"); expect(runSh).toContain("--signal=KILL"); expect(runSh).toContain("21600"); expect(runSh).not.toContain("USERPROFILE");
        const relaySh = f.files.get("/tmp/uasco-sbx-AbC123/ctl/relay.sh")!;
        expect(relaySh).toContain("/usr/bin/nsenter -U --preserve-credentials -n -t"); expect(relaySh).toContain("'/usr/bin/node' '/tmp/uasco-sbx-AbC123/ctl/relay.js'"); expect(relaySh).toContain("ns/net"); expect(relaySh).toContain("exit 97");
        expect(f.files.get("/tmp/uasco-sbx-AbC123/ctl/relay.js")).toContain("127.0.0.1");
        for (const c of f.calls) { const all = c.args.join(" "); expect(all).not.toContain(dir); expect(all).not.toMatch(/[A-Za-z]:\\/); }
        const mark = f.calls.length;
        child.emit("exit", 0, null);
        await child.sandboxTeardown;
        expect(f.calls.slice(mark).map(c => c.args.slice(3).join(" "))).toEqual(["/bin/cat /tmp/uasco-sbx-AbC123/ctl/pid", "/bin/kill -KILL -- -4242", "/usr/bin/pkill -KILL -f -- /tmp/uasco-sbx-AbC123", "/usr/bin/pgrep -f -- /tmp/uasco-sbx-AbC123", "/bin/chmod -R u+rwX -- /tmp/uasco-sbx-AbC123", "/bin/rm -rf -- /tmp/uasco-sbx-AbC123", "/usr/bin/test ! -e /tmp/uasco-sbx-AbC123"]);
        child.emit("error", new Error("again")); await child.sandboxTeardown; expect(f.calls.length).toBe(mark + 7); // teardown yalnız bir kez
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("a spawner that throws or yields no process cleans the scratch dir; sync spawn() stays unsupported", async () => {
      const dir = ws();
      try {
        const t = await mk({}, {spawner: () => { throw new Error("no wsl"); }}); await t.p.selfTest();
        await expect(t.p.spawnAsync("node", ["x"], opts(dir))).rejects.toThrow("SPAWN_FAILED");
        expect(t.f.calls.slice(-1)[0].args.slice(3)).toEqual(["/usr/bin/test", "!", "-e", "/tmp/uasco-sbx-AbC123"]);
        const np = await mk({}, {spawner: () => fakeChild(null)}); await np.p.selfTest();
        const c: any = await np.p.spawnAsync("node", ["x"], opts(dir)); expect(c.pid).toBeUndefined();
        const mark = np.f.calls.length; c.emit("error", new Error("spawn")); await c.sandboxTeardown; expect(np.f.calls.length).toBeGreaterThan(mark);
        expect(() => np.p.spawn("node", ["x"], opts(dir))).toThrow("SPAWN_NOT_SUPPORTED_IN_WSL_V1");
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("bridge: binds ONLY 127.0.0.1, resolves the netns holder via pgrep -P, forwards each connection through a per-connection wsl.exe relay (fixed argv, numeric pid/port), caps connections, and close() tears down listener and relays", async () => {
      const {p, spawned} = await mkS({}); const dir = ws();
      const { freeLoopbackPort } = await import("../core/workos/devrun.js");
      try {
        const child: any = await p.spawnAsync("node", ["server.js"], opts(dir)); const before = spawned.length;
        const port = await freeLoopbackPort();
        await expect(p.bridge({} as any, port)).rejects.toThrow("BRIDGE_TARGET_UNKNOWN");
        await expect(p.bridge(child, 0)).rejects.toThrow("BRIDGE_PORT_INVALID");
        const h = await p.bridge(child, port); expect(h.port).toBe(port);
        const c1 = net.connect(port, "127.0.0.1"); const got = await new Promise<string>((res, rej) => { c1.once("error", rej); c1.on("data", d => res(String(d))); c1.write("ping"); });
        expect(got).toBe("ping");
        expect(spawned.length).toBe(before + 1); expect(spawned[before].args).toEqual(["-d", "Ubuntu", "--exec", "/bin/sh", "/tmp/uasco-sbx-AbC123/ctl/relay.sh", "777", String(port)]); expect(spawned[before].stdio).toEqual(["pipe", "pipe", "ignore"]);
        // yalnız loopback: 127.0.0.1 dışı adrese bağlanılamaz (IPv6 ::1 ve 0.0.0.0 dinleyici yok)
        await expect(new Promise((res, rej) => { const s = net.connect(port, "::1"); s.once("connect", res); s.once("error", rej); })).rejects.toBeTruthy();
        const ext = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === "IPv4" && !i.internal)?.address;
        if (ext) await expect(new Promise((res, rej) => { const s = net.connect(port, ext); s.once("connect", res); s.once("error", rej); })).rejects.toBeTruthy();
        c1.destroy(); h.close();
        await expect(new Promise((res, rej) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", res); s.once("error", rej); })).rejects.toBeTruthy();
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("bridge refuses when no netns holder appears (BRIDGE_TARGET_MISSING) and caps concurrent connections", async () => {
      const dir = ws();
      try {
        const none = await mk({noTarget: true}, {bridgeTargetWaitMs: 300, spawner: () => fakeChild()}); await none.p.selfTest();
        const c: any = await none.p.spawnAsync("node", ["x"], opts(dir));
        await expect(none.p.bridge(c, 40001)).rejects.toThrow("BRIDGE_TARGET_MISSING");
        const { freeLoopbackPort } = await import("../core/workos/devrun.js");
        const capped = await mkS({}); const cc: any = await capped.p.spawnAsync("node", ["x"], opts(dir));
        const cp2 = await mk({}, {maxBridgeConnections: 1, spawner: (a: string[]) => { const x: any = fakeChild(); if (a.includes("/tmp/uasco-sbx-AbC123/ctl/relay.sh")) { x.stdin = new PassThrough(); x.stdout = x.stdin; } return x; }}); await cp2.p.selfTest();
        const k: any = await cp2.p.spawnAsync("node", ["x"], opts(dir)); const port = await freeLoopbackPort(); const h = await cp2.p.bridge(k, port);
        const a = net.connect(port, "127.0.0.1"); await new Promise(r => a.once("connect", r)); await sleepMs(50);
        const b = net.connect(port, "127.0.0.1"); const closed = await new Promise<boolean>(r => { b.once("close", () => r(true)); setTimeout(() => r(false), 1000); });
        expect(closed).toBe(true); a.destroy(); h.close(); void cc;
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("a Linux-side node that is relative or under /mnt (Windows node.exe) makes the provider unavailable; relayScript validates pid/port, refuses a shared netns and quotes the node path", async () => {
      expect(await (await mk({nodePath: "/mnt/c/nodejs/node"})).p.selfTest()).toEqual({ok: false, detail: "WSL_TOOLS_MISSING"});
      expect(await (await mk({nodePath: "node"})).p.selfTest()).toEqual({ok: false, detail: "WSL_TOOLS_MISSING"});
      const {relayScript} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const sh = relayScript("/tmp/uasco-sbx-AbC123", "/usr/bin/node");
      expect(sh).toContain("exit 98"); expect(sh).toContain("exit 96"); expect(sh).toContain("exit 97");
      // Gerçek sh ile: geçersiz pid -> 98, var olmayan pid -> 96, KENDİ ağ ad alanı (pid=$$) -> 97 (nsenter hiç çalışmaz)
      const tmp2 = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-relay-")); const f = path.join(tmp2, "relay.sh");
      try {
        fs.writeFileSync(f, sh);
        if (process.platform === "linux") {
          const rc = (a: string[]) => cp.spawnSync("/bin/sh", [f, ...a]).status;
          expect(rc(["x1", "80"])).toBe(98); expect(rc(["2999999", "80"])).toBe(96); expect(rc([String(process.pid), "80"])).toBe(97);
        }
      } finally { fs.rmSync(tmp2, {recursive: true, force: true}); }
    });

    const realWsl2 = process.platform === "win32" && !!process.env.UASCO_WSL_DISTRO && cp.spawnSync("wsl.exe", ["--status"], {windowsHide: true}).status === 0;
    it.skipIf(!realWsl2)("REAL WSL (win32 + UASCO_WSL_DISTRO): the web-node product starts in the sandbox, the bridged 127.0.0.1 port answers 200, stop tears the Linux tree down (SKIPPED elsewhere, never counted as PASS)", async () => {
      const {WslUnshareSandboxProvider} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const {freeLoopbackPort} = await import("../core/workos/devrun.js");
      const p = new WslUnshareSandboxProvider(); const dir = ws(); fs.writeFileSync(path.join(dir, "server.js"), "require('http').createServer((q,r)=>r.end('ok')).listen(+process.env.PORT,'127.0.0.1')");
      const st = await p.selfTest(); expect(st, JSON.stringify(st)).toEqual({ok: true});
      const port = await freeLoopbackPort();
      const child = await p.spawnAsync("node", ["server.js"], {cwd: dir, env: {PORT: String(port)}, shell: false, stdio: ["ignore", "pipe", "pipe"]});
      try {
        const h = await p.bridge(child, port); let ok = 0;
        for (let i = 0; i < 40 && !ok; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); ok = r.status; } catch { await new Promise(r => setTimeout(r, 500)); } }
        expect(ok).toBe(200); h.close();
      } finally { if (child.pid) cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true}); await child.sandboxTeardown; fs.rmSync(dir, {recursive: true, force: true}); }
    });
  });

  const realWsl = process.platform === "win32" && !!process.env.UASCO_WSL_DISTRO && cp.spawnSync("wsl.exe", ["--status"], {windowsHide: true}).status === 0;
  it.skipIf(!realWsl)("REAL WSL (win32 + UASCO_WSL_DISTRO): selfTest passes its negative probes and a node test runs inside the sandbox (SKIPPED elsewhere, never counted as PASS)", async () => {
    const {WslUnshareSandboxProvider} = await import("../core/sandbox/wsl-unshare-sandbox.js");
    const p = new WslUnshareSandboxProvider(); const dir = ws();
    try {
      const st = await p.selfTest(); expect(st, JSON.stringify(st)).toEqual({ok: true});
      const r = await p.run(["node", "-e", "console.log(40+2)"], {cwd: dir, env: {}, timeoutMs: 60_000});
      expect(r.stdout.trim()).toBe("42"); expect(r.exitCode).toBe(0);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });
});
