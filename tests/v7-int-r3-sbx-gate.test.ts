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
  const GOOD_PROBE = "MNT_C=absent\nDRVFS=0\nUNIX_PATH_SOCKETS=0\nWSL_RUNTIME_DIRS=absent\nRW_usr=ro\nRW_etc=ro\nRW_bin=ro\nWORK=writable\nNET_IFACES=0\nCAPS_DROPPED=ok\nNO_CTTY=ok\nNESTED_USERNS=blocked\nPID_NS_PRIVATE=ok\nVSOCK=blocked\nIO_URING=blocked\nSUPERVISOR=ok\nHOST_DIRS=hidden\nPROC_SYS_RO=ok\nHOST_CANARY=hidden\nDONE=1\n";
  interface Cfg { status?: number; spawnError?: boolean; distros?: string; version?: string; interop?: string | string[]; peRc?: number; peNoexec?: string; tools?: string; roots?: string[]; probe?: string; probeRc?: number; mktempFails?: boolean; runOut?: string; runRc?: number; runDelayMs?: number;
    forkOut?: string; timeoutRc?: number; late?: boolean; stdinOut?: string; pkillRc?: number; pgrepAlive?: boolean; scratchRemains?: boolean; duOut?: string; truncated?: boolean; runBytes?: Buffer; outerRc?: number; reject?: boolean; nodePath?: string; noTarget?: boolean; abortIgnored?: boolean; pgrepRc?: number; pgidAlive?: boolean; rcFile?: string; duRc?: number; abortLate?: boolean; late2?: boolean; noPgid?: boolean; netns?: string; netnsRc?: number }
  const u16 = (t: string) => Buffer.from("﻿" + t, "utf16le");
  const mkRunner = (cfg: Cfg = {}) => {
    const calls: {args: string[]; input?: Buffer | string}[] = []; const files = new Map<string, string>();
    let tarIn: Buffer | null = null, outerN = 0;
    const runner = async (args: string[], o: {timeoutMs: number; input?: Buffer | string; shouldAbort?: () => boolean}) => {
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
      if (cmd[0] === "/bin/cat") return R(0, cmd[1].endsWith("/rc") ? `${cfg.rcFile ?? "0"}\n` : "4242\n");
      if (cmd[0] === "/bin/sh" && cmd[1] === "-s") { files.set("SWEEP", String(o.input)); return R(0); }
      if (cmd[0] === "/bin/sh" && cmd[1].endsWith("/ctl/kill.sh")) return R(0, cfg.noPgid ? "PGID=none\n" : "PGID=4242\n");
      if (cmd[0] === "/bin/tar") { tarIn = Buffer.from(o.input as Buffer); return R(0); }
      if (cmd[0] === "/usr/bin/du") return R(cfg.duRc ?? 0, cfg.duOut ?? "120\t/tmp/uasco-sbx-AbC123/work\n");
      if (cmd[0] === "/usr/bin/pkill") return R(cfg.pkillRc ?? 1);
      if (cmd[0] === "/usr/bin/readlink") return R(cfg.netnsRc ?? 0, cfg.netns ?? "net:[4026532999]\n");
      if (cmd[0] === "/usr/bin/pgrep" && cmd[1] === "-P") return cfg.noTarget ? R(1) : R(0, "777\n");
      if (cmd[0] === "/usr/bin/pgrep" && cmd[1] === "-g") return R(cfg.pgidAlive ? 0 : 1);
      if (cmd[0] === "/usr/bin/pgrep") return R(cfg.pgrepAlive ? 0 : cfg.pgrepRc ?? 1);
      if (cmd[0] === "/usr/bin/test" && cmd[1] === "!") return R(cmd[3].endsWith("abort-late.txt") || cmd[3].endsWith("abort-late2.txt") ? (cfg.abortLate ? 1 : 0) : cmd[3].endsWith("late2.txt") ? (cfg.late2 ? 1 : 0) : cmd[3].endsWith("late.txt") ? (cfg.late ? 1 : 0) : (cfg.scratchRemains ? 1 : 0));
      if (cmd[0] === "/usr/bin/test") return R(cfg.roots ? (cfg.roots.includes(cmd[2]) ? 0 : 1) : (cmd[2] === "/srv" ? 0 : 1));
      if (cmd[0] === "/bin/sh" && cmd[1].endsWith("/ctl/outer.sh")) {
        const seq = Array.isArray(cfg.interop) ? cfg.interop : [cfg.interop ?? "absent"]; const ip = seq[Math.min(outerN++, seq.length - 1)];
        return R(cfg.outerRc ?? 0, `INTEROP=${ip}\nTOOLS=${cfg.tools ?? "ok"}\nPE_EXEC_RC=${cfg.peRc ?? 126}\nPE_ENOEXEC=${cfg.peNoexec ?? "yes"}\nNODE=${cfg.nodePath ?? "/usr/bin/node"}\nDONE=1\n`);
      }
      if (cmd[0] === "/bin/sh" && cmd[1].endsWith("/ctl/run.sh")) {
        const sh = files.get(cmd[1]) ?? "";
        if (sh.includes("MNT_C=")) return R(cfg.probeRc ?? 0, cfg.probe ?? GOOD_PROBE);
        if (sh.includes("fail=$fail")) return R(0, cfg.forkOut ?? "ok=47 fail=103\n");
        if (sh.includes("abort-late.txt")) { for (let i = 0; i < 80; i++) { if (o.shouldAbort?.()) return {...R(null), aborted: !cfg.abortIgnored}; await new Promise(r => setTimeout(r, 25)); } return R(0); }
        if (sh.includes("late.txt")) return R(cfg.timeoutRc ?? 137, "", {timedOut: (cfg.timeoutRc ?? 137) !== 0});
        if (sh.includes("got=$l")) return R(0, cfg.stdinOut ?? `got=${String(o.input).trim()}\n`);
        if (cfg.runDelayMs) { for (let i = 0; i < Math.ceil(cfg.runDelayMs / 25); i++) { if (o.shouldAbort?.()) break; await new Promise(r => setTimeout(r, 25)); } }
        calls.push({args: ["-d", "x", "--exec", "__run_returned__"]});
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
      expect(tail).toEqual(["/bin/sh /tmp/uasco-sbx-AbC123/ctl/kill.sh", "/usr/bin/pkill -KILL -f -- /tmp/uasco-sbx-AbC123", "/usr/bin/pgrep -f -- /tmp/uasco-sbx-AbC123", "/usr/bin/pgrep -g 4242", "/bin/chmod -R u+rwX -- /tmp/uasco-sbx-AbC123", "/bin/rm -rf -- /tmp/uasco-sbx-AbC123", "/usr/bin/test ! -e /tmp/uasco-sbx-AbC123"]);
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
    ["INTEROP_PROBE_INCONCLUSIVE", {peRc: 127}, {}],
    ["INTEROP_ENABLED", {peRc: 2}, {}],
    ["INTEROP_ENABLED", {peRc: 0}, {}],
    ["INTEROP_PROBE_INCONCLUSIVE", {peNoexec: "no"}, {}],
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

  it.each([["MNT_C", "present"], ["DRVFS", "2"], ["UNIX_PATH_SOCKETS", "1"], ["CAPS_DROPPED", "no"], ["NO_CTTY", "no"], ["NESTED_USERNS", "allowed"], ["PID_NS_PRIVATE", "no"], ["VSOCK", "open"], ["VSOCK", "unknown"], ["IO_URING", "open"], ["IO_URING", "unknown"], ["SUPERVISOR", "no"], ["HOST_DIRS", "present"], ["PROC_SYS_RO", "no"], ["HOST_CANARY", "visible"], ["WSL_RUNTIME_DIRS", "present"], ["RW_usr", "writable"], ["RW_etc", "writable"], ["RW_bin", "writable"], ["WORK", "ro"], ["NET_IFACES", "1"], ["DONE", "0"]])(
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

    it("LC-4/LC-3: cleanup failures are never swallowed - the run fails (exit 1 even if the test passed), the note names the code, and the provider de-verifies; pgrep errors fail CLOSED; survivors are looked up by pgid too; du/rc problems fail the run", async () => {
      const dir = ws();
      try {
        for (const [patch, code] of [[{scratchRemains: true}, "SCRATCH_NOT_REMOVED"], [{pkillRc: 2}, "PKILL_FAILED"], [{pgrepRc: 2}, "PGREP_FAILED"], [{pgrepRc: 127}, "PGREP_FAILED"], [{pgrepAlive: true}, "PROCESS_SURVIVED"], [{pgidAlive: true}, "PROCESS_SURVIVED"]] as const) {
          const cfg: Cfg = {}; const m = await mk(cfg); expect(await m.p.selfTest()).toEqual({ok: true});
          Object.assign(cfg, patch);
          const r = await m.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000});
          expect(r.stderr, code).toContain(`CLEANUP_FAILED: ${code}`); expect(r.exitCode).toBe(1);
          expect(m.p.isVerified()).toBe(false); expect(m.p.lastSelfTest).toEqual({ok: false, detail: `CLEANUP_${code}`});
        }
        const big = await mk({duOut: "99999999\t/x\n"}); await big.p.selfTest();
        const rb = await big.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000}); expect(rb.exitCode).toBe(1); expect(rb.stderr).toContain("WORK_SIZE_EXCEEDED_OR_UNKNOWN");
        const unk = await mk({duOut: "du: error\n"}); await unk.p.selfTest();
        expect((await unk.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000})).exitCode).toBe(1);
        // du çıkış kodu: eksik toplam (okunamayan alt dizin) geçerli bir sayı yazsa bile BİLİNMİYOR sayılır
        const partial = await mk({duRc: 1, duOut: "10\t/x\n"}); await partial.p.selfTest();
        const rp = await partial.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000}); expect(rp.exitCode).toBe(1); expect(rp.stderr).toContain("WORK_SIZE_EXCEEDED_OR_UNKNOWN");
        // rc dosyası: wsl.exe 0 dedi ama Linux rc 0 değil -> RC_MISMATCH
        const rc = await mk({rcFile: "1"}); await rc.p.selfTest();
        const rr = await rc.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000}); expect(rr.exitCode).toBe(1); expect(rr.stderr).toContain("RC_MISMATCH");
        const rcOk = await mk({rcFile: "0"}); await rcOk.p.selfTest(); expect((await rcOk.p.run(["node", "test.js"], {cwd: dir, env: {}, timeoutMs: 5000})).exitCode).toBe(0);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("selfTest proves its own teardown: a failing cleanup after the probes makes the provider unavailable (PROBE_CLEANUP_<code>)", async () => {
      expect(await (await mk({scratchRemains: true})).p.selfTest()).toEqual({ok: false, detail: "PROBE_CLEANUP_SCRATCH_NOT_REMOVED"});
      expect(await (await mk({pgrepRc: 2})).p.selfTest()).toMatchObject({ok: false});
    });

    it("SELFTEST_ERROR: a probe that throws resolves {ok:false, SELFTEST_ERROR}, is recorded, and the gate refuses (pins the fail-closed branch)", async () => {
      const {p} = await mk({reject: true});
      expect(await p.selfTest()).toEqual({ok: false, detail: "SELFTEST_ERROR"}); expect(p.lastSelfTest).toEqual({ok: false, detail: "SELFTEST_ERROR"});
      expect((await new ExecutionGate(p as any).authorize("RUNNER_VERIFY_TESTS")).allowed).toBe(false);
    });

    it("stale scratch sweep: one `sh -s` script, threshold above the longest run (>= 2 h dev lifetime + margin), skips directories with a live process", async () => {
      const {f, p} = await mk(); await p.selfTest();
      const sweep = f.files.get("SWEEP")!; expect(sweep).toContain("-mmin +"); expect(sweep).toContain("pgrep -f"); expect(sweep).toContain("continue");
      const min = Number(/-mmin \+(\d+)/.exec(sweep)![1]); expect(min).toBeGreaterThanOrEqual(6 * 60 + 30);
      expect(f.calls.some(c => c.args[3] === "/usr/bin/find")).toBe(false);
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
      const spawner = (args: string[], stdio: unknown) => { const isRelay = args.includes("relay.sh") || String(args[args.length - 4]).endsWith("relay.sh"); const c: any = fakeChild(); if (isRelay) { c.stdin = new PassThrough(); c.stdout = c.stdin; } spawned.push({args, stdio, child: c}); return c; };
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
        // C-7: WSL relay boş ortam + no_new_privs/yetkisiz + seccomp sarmalayıcısıyla çalışır
        expect(relaySh).toContain("exec /usr/bin/env -i /usr/bin/nsenter"); expect(relaySh).toContain("/usr/bin/setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/perl '/tmp/uasco-sbx-AbC123/ctl/seccomp.pl' '/usr/bin/node' '/tmp/uasco-sbx-AbC123/ctl/relay.js'");
        expect(f.files.get("/tmp/uasco-sbx-AbC123/ctl/seccomp.pl")).toContain("SECCOMP_INSTALL_FAILED");
        for (const c of f.calls) { const all = c.args.join(" "); expect(all).not.toContain(dir); expect(all).not.toMatch(/[A-Za-z]:\\/); }
        const mark = f.calls.length;
        child.emit("exit", 0, null);
        await child.sandboxTeardown;
        expect(f.calls.slice(mark).map(c => c.args.slice(3).join(" "))).toEqual(["/bin/sh /tmp/uasco-sbx-AbC123/ctl/kill.sh", "/usr/bin/pkill -KILL -f -- /tmp/uasco-sbx-AbC123", "/usr/bin/pgrep -f -- /tmp/uasco-sbx-AbC123", "/usr/bin/pgrep -g 4242", "/bin/chmod -R u+rwX -- /tmp/uasco-sbx-AbC123", "/bin/rm -rf -- /tmp/uasco-sbx-AbC123", "/usr/bin/test ! -e /tmp/uasco-sbx-AbC123"]);
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
        expect(spawned.length).toBe(before + 1); expect(spawned[before].args).toEqual(["-d", "Ubuntu", "--exec", "/bin/sh", "/tmp/uasco-sbx-AbC123/ctl/relay.sh", "777", String(port), "net:[4026532999]"]); expect(spawned[before].stdio).toEqual(["pipe", "pipe", "ignore"]);
        // yalnız loopback: 127.0.0.1 dışı adrese bağlanılamaz (IPv6 ::1 ve 0.0.0.0 dinleyici yok)
        await expect(new Promise((res, rej) => { const s = net.connect(port, "::1"); s.once("connect", res); s.once("error", rej); })).rejects.toBeTruthy();
        const ext = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === "IPv4" && !i.internal)?.address;
        if (ext) await expect(new Promise((res, rej) => { const s = net.connect(port, ext); s.once("connect", res); s.once("error", rej); })).rejects.toBeTruthy();
        // C-1: sağlayıcı doğrulanmamış olunca köprü yeni bağlantıyı REDDEDER ve relay başlatmaz
        const n0 = spawned.length; (p as any).verified = false; expect(p.isVerified()).toBe(false);
        const c2 = net.connect(port, "127.0.0.1"); expect(await new Promise<boolean>(r => { c2.once("close", () => r(true)); c2.on("error", () => undefined); setTimeout(() => r(false), 1000); })).toBe(true); expect(spawned.length).toBe(n0);
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
        const badNs = await mk({netns: "garbage\n"}, {spawner: () => fakeChild()}); await badNs.p.selfTest();
        await expect(badNs.p.bridge(await badNs.p.spawnAsync("node", ["x"], opts(dir)), 40002)).rejects.toThrow("BRIDGE_NETNS_UNKNOWN");
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
      for (const c of ["exit 98", "exit 96", "exit 97", "exit 94", "exit 95"]) expect(sh).toContain(c);
      // Gerçek sh ile: geçersiz pid -> 98, geçersiz ns -> 98, var olmayan pid -> 96, kayıtlı ns'den FARKLI -> 94, KENDİ ağ ad alanı -> 97 (nsenter hiç çalışmaz)
      const tmp2 = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-relay-")); const f = path.join(tmp2, "relay.sh");
      try {
        fs.writeFileSync(f, sh);
        if (process.platform === "linux") {
          const rc = (a: string[], script = f) => cp.spawnSync("/bin/sh", [script, ...a], {timeout: 8000}).status;
          const own = cp.spawnSync("readlink", ["/proc/self/ns/net"], {encoding: "utf8"}).stdout.trim();
          expect(rc(["x1", "80", own])).toBe(98); expect(rc([String(process.pid), "80", "garbage"])).toBe(98); expect(rc(["2999999", "80", own])).toBe(96);
          expect(rc([String(process.pid), "80", "net:[1]"])).toBe(94); expect(rc([String(process.pid), "80", own])).toBe(97);
          // C-6: ayrı ağ ad alanındaki gerçek hedef; relay yalnız kayıtlı ns + pid dosyasındaki ebeveyn (cmdline'ında S) ile devam eder
          const S = path.join(tmp2, "scratch"); fs.mkdirSync(path.join(S, "ctl"), {recursive: true});
          const sh2 = path.join(tmp2, "relay2.sh"); fs.writeFileSync(sh2, relayScript(S, "/nonexistent-node"));
          const parent = cp.spawn("/bin/sh", ["-c", "unshare -Urn sleep 30 & wait", "uasco-test", S], {stdio: "ignore"});
          try {
            let kid = ""; for (let i = 0; i < 40 && !kid; i++) { kid = cp.spawnSync("pgrep", ["-P", String(parent.pid)], {encoding: "utf8"}).stdout.trim().split(/\s+/)[0]; if (!kid) cp.spawnSync("sleep", ["0.1"]); }
            const ns = kid ? cp.spawnSync("readlink", [`/proc/${kid}/ns/net`], {encoding: "utf8"}).stdout.trim() : "";
            if (/^net:\[\d+\]$/.test(ns) && ns !== own) {
              expect(rc([kid, "80", ns], sh2)).toBe(95); // pid dosyası yok
              fs.writeFileSync(path.join(S, "ctl", "pid"), "1\n"); expect(rc([kid, "80", ns], sh2)).toBe(95); // ebeveyn eşleşmiyor
              fs.writeFileSync(path.join(S, "ctl", "pid"), `${process.pid}\n`); expect(rc([kid, "80", ns], sh2)).toBe(95); // ebeveyn doğru ama cmdline'da S yok
              fs.writeFileSync(path.join(S, "ctl", "pid"), `${parent.pid}\n`); expect([94, 95, 96, 97, 98]).not.toContain(rc([kid, "80", ns], sh2)); // tüm denetimler geçer (nsenter'a ulaşılır)
            }
          } finally { cp.spawnSync("pkill", ["-P", String(parent.pid)]); parent.kill("SIGKILL"); }
        }
      } finally { fs.rmSync(tmp2, {recursive: true, force: true}); }
    });

    const realWsl2 = process.platform === "win32" && !!process.env.UASCO_WSL_DISTRO && cp.spawnSync("wsl.exe", ["--status"], {windowsHide: true}).status === 0;
    it.skipIf(!realWsl2)("REAL WSL (win32 + UASCO_WSL_DISTRO): the generated web-node product starts in the sandbox, the bridged 127.0.0.1 port answers 200, stop tears the Linux tree down (SKIPPED elsewhere, never counted as PASS)", async () => {
      const {WslUnshareSandboxProvider} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const {freeLoopbackPort} = await import("../core/workos/devrun.js");
      const {renderTemplate} = await import("../core/workos/project-templates.js");
      const p = new WslUnshareSandboxProvider(); const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-wsl-prod-"));
      const spec = renderTemplate("web-node", "Acceptance App");
      for (const [name, text] of Object.entries(spec.files)) { fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true}); fs.writeFileSync(path.join(dir, name), text); }
      const st = await p.selfTest(); expect(st, JSON.stringify(st)).toEqual({ok: true});
      const port = await freeLoopbackPort();
      const child = await p.spawnAsync(spec.devCommand![0], spec.devCommand!.slice(1), {cwd: dir, env: {PORT: String(port), HOST: "127.0.0.1"}, shell: false, stdio: ["ignore", "pipe", "pipe"]});
      try {
        const h = await p.bridge(child, port); let ok = 0;
        for (let i = 0; i < 40 && !ok; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); ok = r.status; } catch { await new Promise(r => setTimeout(r, 500)); } }
        expect(ok).toBe(200); h.close();
        // C-3: Linux tarafı kapatma kanıtı (taskkill Windows tarafını bitirir; sandbox ağacı ve scratch Linux'ta kapatılmalıdır)
        const S = (child as any).sandboxScratch as string; expect(S).toMatch(/^\/tmp\/uasco-sbx-[A-Za-z0-9]{6}$/);
        if (child.pid) cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true});
        expect(await (child as any).sandboxTeardown).toBeNull(); expect(p.isVerified()).toBe(true);
        const wslx = (a: string[]) => cp.spawnSync("wsl.exe", ["-d", process.env.UASCO_WSL_DISTRO!, "--exec", ...a], {windowsHide: true}).status;
        expect(wslx(["/usr/bin/pgrep", "-f", "uasco-sbx"])).toBe(1); expect(wslx(["/usr/bin/test", "!", "-e", S])).toBe(0);
      } finally { if (child.pid) cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true}); await child.sandboxTeardown; fs.rmSync(dir, {recursive: true, force: true}); }
    });
  });

  // //TR: LANE-B B-SBX-WIN-3 (yeniden inceleme e5f4933): her düzeltme için, düzeltme olmadan KIRILAN test. Gerçek çalıştıran testler Linux'ta sahte "wsl.exe" ile (--exec komutlarını yerel çalıştırır) PROBE_SCRIPT ve seccomp sarmalayıcısını GERÇEKTEN koşturur (weak.mts yöntemi); gerçek WSL çıktıları UNVERIFIED_WSL kalır.
  describe("B-SBX-WIN-3 review fixes", () => {
    const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms));
    const dropUid = typeof process.getuid === "function" && process.getuid() === 0 ? 65534 : undefined;
    const LIN_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    /** Linux'ta "wsl.exe" yerine: -d X --exec <cmd> yerel çalıştırılır (root ise uid 65534'e düşer: root RLIMIT_NPROC'tan muaftır). */
    const localWsl = (extraEnv: Record<string, string> = {}, asRoot = false) => async (args: string[], o: {timeoutMs: number; input?: Buffer | string; shouldAbort?: () => boolean}) => {
      const R = (exitCode: number | null, out: Buffer | string = "", extra: any = {}) => ({exitCode, stdout: Buffer.from(out), stderr: Buffer.alloc(0), timedOut: false, aborted: false, spawnError: false, ...extra});
      if (args[0] === "--status") return R(0);
      if (args[0] === "-l" && args[1] === "-q") return R(0, Buffer.from("﻿Ubuntu\r\n", "utf16le"));
      if (args[0] === "-l" && args[1] === "-v") return R(0, Buffer.from("﻿  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n", "utf16le"));
      const cmd = args.slice(3);
      return await new Promise<any>(resolve => {
        const c = cp.spawn(cmd[0], cmd.slice(1), {cwd: "/", env: {PATH: LIN_PATH, HOME: "/tmp", LANG: "C", ...extraEnv}, stdio: ["pipe", "pipe", "pipe"], ...(dropUid !== undefined && !asRoot ? {uid: dropUid, gid: dropUid} : {})});
        const out: Buffer[] = []; let aborted = false, timedOut = false, done = false;
        const err: Buffer[] = []; c.stdout.on("data", d => out.push(d)); c.stderr.on("data", d => err.push(d)); c.stdin.on("error", () => undefined);
        const fin = (code: number | null) => { if (done) return; done = true; clearInterval(poll); clearTimeout(t); resolve(R(code, Buffer.concat(out), {aborted, timedOut, stderr: Buffer.concat(err)})); };
        const poll = setInterval(() => { if (o.shouldAbort?.()) { aborted = true; try { c.kill("SIGKILL"); } catch { /* çıkmış */ } setTimeout(() => fin(null), 200); } }, 50);
        const t = setTimeout(() => { timedOut = true; try { c.kill("SIGKILL"); } catch { /* çıkmış */ } setTimeout(() => fin(null), 200); }, o.timeoutMs + 3000);
        c.on("error", () => fin(null)); c.on("close", code => fin(code));
        if (o.input !== undefined) c.stdin.end(o.input); else c.stdin.end();
      });
    };
    const lin = async () => (await import("../core/sandbox/wsl-unshare-sandbox.js")).linuxIsolationFromModule();
    const canReal = process.platform === "linux" && cp.spawnSync("sh", ["-c", "command -v unshare setpriv perl nsenter >/dev/null && unshare --user --map-root-user true"]).status === 0;

    it("NEW-GATE-STALE-AVAILABLE: ONE gate follows the provider - after the WSL provider de-verifies itself (interop turned on) status() is UNAVAILABLE and authorize() refuses; other providers keep the once-per-gate selfTest", async () => {
      const dir = ws();
      try {
        const {p} = await mk({interop: ["absent", "absent", "enabled"]});
        const gate = new ExecutionGate(p as any);
        expect(await gate.status()).toMatchObject({state: "AVAILABLE"}); expect((await gate.authorize("RUNNER_VERIFY_TESTS")).allowed).toBe(true);
        expect((await p.run(["node", "x"], {cwd: dir, env: {}, timeoutMs: 5000})).exitCode).toBe(0); // run #1 interopCheck ('absent')
        const r = await p.run(["node", "x"], {cwd: dir, env: {}, timeoutMs: 5000}); expect(r.stderr).toContain("INTEROP_ENABLED");
        expect(await gate.status()).toMatchObject({state: "UNAVAILABLE", reason: SANDBOX_UNAVAILABLE});
        expect(await gate.authorize("RUNNER_VERIFY_TESTS")).toMatchObject({allowed: false, reason: SANDBOX_UNAVAILABLE});
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
      let calls = 0; const plain = new ExecutionGate({id: "P", selfTest: async () => { calls++; return {ok: true}; }, run: async () => ({}) as any, spawn: () => ({}) as any} as any);
      await plain.status(); await plain.authorize("RUNNER_VERIFY_TESTS"); expect(calls).toBe(1);
    });

    it("LC-1(c) abort probe: selfTest requires run() to return aborted within the bound, the Linux tree to be killed (no late markers) and no survivors; NEW-ABORT-WAITS: the tree is killed the moment shouldAbort fires, while run.sh is still pending", async () => {
      expect(await (await mk({abortIgnored: true})).p.selfTest()).toEqual({ok: false, detail: "PROBE_ABORT_NOT_ENFORCED"});
      expect(await (await mk({abortLate: true})).p.selfTest()).toEqual({ok: false, detail: "PROBE_ABORT_TREE_SURVIVED"});
      expect(await (await mk({late2: true})).p.selfTest()).toEqual({ok: false, detail: "PROBE_TIMEOUT_TREE_SURVIVED"});
      const dir = ws();
      try {
        const {p, f} = await mk({runDelayMs: 600}); await p.selfTest();
        const mark = f.calls.length; const t0 = Date.now();
        const r = await p.run(["node", "x"], {cwd: dir, env: {}, timeoutMs: 20_000, shouldAbort: () => Date.now() - t0 > 100});
        const seq = f.calls.slice(mark).map(c => c.args.slice(3).join(" "));
        const firstKill = seq.findIndex(a => a === "/bin/sh /tmp/uasco-sbx-AbC123/ctl/kill.sh"), runReturned = seq.indexOf("__run_returned__");
        expect(firstKill).toBeGreaterThan(-1); expect(runReturned).toBeGreaterThan(-1); expect(firstKill).toBeLessThan(runReturned);
        void r;
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });

    it("the runner resolves soon after an abort even when a grandchild keeps the stdio pipes open (the 32 s reproduction); kill happens once", async () => {
      const {spawnWslRunner} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const t0 = Date.now();
      const r = await spawnWslRunner(process.execPath, 400)(["-e", "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'inherit'}); setInterval(()=>{},1000)"], {timeoutMs: 60_000, shouldAbort: () => Date.now() - t0 > 300});
      expect(r.aborted).toBe(true); expect(Date.now() - t0).toBeLessThan(8000);
    });

    it.skipIf(process.platform !== "linux" || cp.spawnSync("sh", ["-c", "command -v perl"]).status !== 0)("NEW-VSOCK-NETNS-BYPASS: the perl seccomp wrapper (real) makes socket()/socketpair(AF_VSOCK) fail with EAFNOSUPPORT, keeps AF_INET/AF_UNIX working and passes the command's exit code; the probe sees `open` without it", async () => {
      const {SECCOMP_PL, PROBE_SCRIPT, evaluateProbe} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const vs = "if (socket(S,40,1,0)) {print 'open'} else {print 'blocked'.($!+0)}; print(socketpair(A,B,40,1,0)?' pair-open':' pair-blocked'); print(socket(T,2,1,0)?' inet-ok':' inet-fail'); print(socketpair(C,D,1,1,0)?' unix-ok':' unix-fail');";
      const bare = cp.spawnSync("perl", ["-e", vs], {encoding: "utf8"}).stdout;
      if (!bare.startsWith("open")) return; // bu çekirdekte vsock zaten yok: kanıtlanacak bir şey yok
      const wrapped = cp.spawnSync("perl", ["-e", SECCOMP_PL, "--", "perl", "-e", vs], {encoding: "utf8"});
      expect(wrapped.stdout).toBe("blocked97 pair-blocked inet-ok unix-ok");
      expect(cp.spawnSync("perl", ["-e", SECCOMP_PL, "--", "sh", "-c", "exit 7"]).status).toBe(7);
      expect(cp.spawnSync("perl", ["-e", SECCOMP_PL, "--", "definitely-not-a-command"], {encoding: "utf8"}).status).toBe(127);
      const probe = (wrap: boolean) => cp.spawnSync(wrap ? "perl" : "sh", wrap ? ["-e", SECCOMP_PL, "--", "sh", "-c", PROBE_SCRIPT, "sh", "/nonexistent/canary"] : ["-c", PROBE_SCRIPT, "sh", "/nonexistent/canary"], {encoding: "utf8"}).stdout;
      expect(probe(false)).toContain("VSOCK=open"); expect(probe(true)).toContain("VSOCK=blocked");
      expect(evaluateProbe(probe(false).replace(/VSOCK=.*/, "VSOCK=open"))).toMatchObject({ok: false});
    });

    it("VSOCK-IOURING-BYPASS: the seccomp program (JS BPF evaluator, both archs) denies io_uring_setup/enter/register with EPERM, kills x32-ABI and wrong-arch calls, answers socket/socketpair(40) with EAFNOSUPPORT and allows the rest", async () => {
      const {seccompProgram, evalSeccomp, SECCOMP_ARCHS, SECCOMP_PL} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const ALLOW = 0x7fff0000, KILL = 0x80000000, EPERM = 0x00050001, AFNO = 0x00050000 | 97;
      for (const a of ["x86_64", "aarch64"] as const) {
        const c = SECCOMP_ARCHS[a], prog = seccompProgram(a), ev = (nr: number, arg0 = 0, arch: number = c.audit) => evalSeccomp(prog, {nr, arch, arg0});
        expect(prog.length).toBe(15);
        for (const nr of [425, 426, 427]) { expect(ev(nr)).toBe(EPERM); expect(ev(nr | 0x40000000)).toBe(KILL); }
        expect(ev(c.socket, 40)).toBe(AFNO); expect(ev(c.socketpair, 40)).toBe(AFNO);
        expect(ev(c.socket, 2)).toBe(ALLOW); expect(ev(c.socketpair, 1)).toBe(ALLOW);
        expect(ev(0)).toBe(ALLOW); expect(ev(1)).toBe(ALLOW); expect(ev(c.prctl)).toBe(ALLOW);
        expect(ev(0x40000000 | c.socket, 2)).toBe(KILL); expect(ev(1, 0, 0x40000003)).toBe(KILL); expect(ev(1, 0, 0)).toBe(KILL);
      }
      expect(SECCOMP_PL).toContain("x86_64"); expect(SECCOMP_PL).toContain("aarch64");
    });

    it.skipIf(process.platform !== "linux" || cp.spawnSync("sh", ["-c", "command -v perl"]).status !== 0 || !["x86_64", "aarch64"].includes(os.arch() === "x64" ? "x86_64" : os.arch() === "arm64" ? "aarch64" : ""))("VSOCK-IOURING-BYPASS (real kernel): io_uring_setup works bare but is EPERM under the wrapper; a raw io_uring IORING_OP_SOCKET(AF_VSOCK) program cannot get a socket fd under the wrapper; the probe reports IO_URING=blocked only wrapped", async () => {
      const {SECCOMP_PL, PROBE_SCRIPT, evaluateProbe} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const setup = "my $p=pack('x120'); my $r=syscall(425,4,$p); print(($r>=0)?'open':'blocked'.($!+0));";
      const bare = cp.spawnSync("perl", ["-e", setup], {encoding: "utf8"}).stdout;
      if (bare !== "open") return; // bu çekirdekte io_uring zaten kapalı: kanıtlanacak bir şey yok
      expect(cp.spawnSync("perl", ["-e", SECCOMP_PL, "--", "perl", "-e", setup], {encoding: "utf8"}).stdout).toBe("blocked1");
      const probe = (wrap: boolean) => cp.spawnSync(wrap ? "perl" : "sh", wrap ? ["-e", SECCOMP_PL, "--", "sh", "-c", PROBE_SCRIPT, "sh", "/nonexistent/canary"] : ["-c", PROBE_SCRIPT, "sh", "/nonexistent/canary"], {encoding: "utf8"}).stdout;
      expect(probe(false)).toContain("IO_URING=open"); expect(probe(true)).toContain("IO_URING=blocked");
      const good = "MNT_C=absent\nDRVFS=0\nUNIX_PATH_SOCKETS=0\nWSL_RUNTIME_DIRS=absent\nRW_usr=ro\nRW_etc=ro\nRW_bin=ro\nWORK=writable\nNET_IFACES=0\nCAPS_DROPPED=ok\nNO_CTTY=ok\nNESTED_USERNS=blocked\nPID_NS_PRIVATE=ok\nVSOCK=blocked\nSUPERVISOR=ok\nHOST_DIRS=hidden\nPROC_SYS_RO=ok\nHOST_CANARY=hidden\nDONE=1\n";
      expect(evaluateProbe(good + probe(true).match(/IO_URING=.*/)![0])).toMatchObject({ok: true});
      expect(evaluateProbe(good + probe(false).match(/IO_URING=.*/)![0])).toMatchObject({ok: false, reason: "PROBE_IO_URING"});
      if (cp.spawnSync("sh", ["-c", "command -v cc"]).status !== 0) return;
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "uring-")); const src = path.join(d, "u.c"), bin = path.join(d, "u");
      fs.writeFileSync(src, `#include <linux/io_uring.h>
#include <sys/syscall.h>
#include <sys/mman.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
int main(void){struct io_uring_params p;memset(&p,0,sizeof p);long fd=syscall(425,4,&p);if(fd<0){puts("setup-denied");return 3;}
size_t sq=p.sq_off.array+p.sq_entries*4,cq=p.cq_off.cqes+p.cq_entries*sizeof(struct io_uring_cqe);
char*sqp=mmap(0,sq,PROT_READ|PROT_WRITE,MAP_SHARED|MAP_POPULATE,fd,IORING_OFF_SQ_RING);char*cqp=mmap(0,cq,PROT_READ|PROT_WRITE,MAP_SHARED|MAP_POPULATE,fd,IORING_OFF_CQ_RING);
struct io_uring_sqe*sqe=mmap(0,p.sq_entries*sizeof(struct io_uring_sqe),PROT_READ|PROT_WRITE,MAP_SHARED|MAP_POPULATE,fd,IORING_OFF_SQES);
if(sqp==MAP_FAILED||cqp==MAP_FAILED||sqe==MAP_FAILED){puts("mmap-failed");return 4;}
memset(&sqe[0],0,sizeof sqe[0]);sqe[0].opcode=45;sqe[0].fd=40;sqe[0].off=1;sqe[0].len=0;sqe[0].user_data=7;
((unsigned*)(sqp+p.sq_off.array))[0]=0;__atomic_store_n((unsigned*)(sqp+p.sq_off.tail),1,__ATOMIC_RELEASE);
long n=syscall(426,fd,1,1,IORING_ENTER_GETEVENTS,0,0);if(n<0){puts("enter-denied");return 5;}
struct io_uring_cqe*c=(struct io_uring_cqe*)(cqp+p.cq_off.cqes);printf("socket-res=%d\\n",c[0].res);return c[0].res>=0?0:6;}
`);
      try {
        const cc = cp.spawnSync("cc", ["-O0", "-o", bin, src], {encoding: "utf8"}); expect(cc.status).toBe(0);
        const bareRun = cp.spawnSync(bin, {encoding: "utf8"});
        const wrapped = cp.spawnSync("perl", ["-e", SECCOMP_PL, "--", bin], {encoding: "utf8"});
        expect(wrapped.stdout).toBe("setup-denied\n"); expect(wrapped.status).toBe(3);
        if (bareRun.status === 0) expect(bareRun.stdout).toMatch(/socket-res=\d+/); // çıplak: AF_VSOCK fd'si gerçekten oluştu (bypass kanıtı)
      } finally { fs.rmSync(d, {recursive: true, force: true}); }
    });

    it("run.sh wraps EVERY sandboxed command (probes, runs, dev-run) in the seccomp wrapper and stages kill.sh; the probe script has the parity invariants (supervisor, host dirs, /proc/sys ro, host canary) and the PE probe is locale-independent", async () => {
      const {p, f} = await mk(); await p.selfTest();
      const runs = [...f.files.entries()].filter(([k]) => k.endsWith("/ctl/run.sh")); expect(runs.length).toBeGreaterThan(0);
      const runSh = runs.pop()![1]; expect(runSh).toContain("'/usr/bin/perl' '-e'"); expect(runSh).toContain("SECCOMP_ARCH_UNSUPPORTED"); expect(runSh).toMatch(/'--' 'node'|'--' '\/bin\/sh'/);
      const {OUTER_SCRIPT, PROBE_SCRIPT} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      expect(OUTER_SCRIPT).toContain("LC_ALL=C"); for (const k of ["VSOCK=", "SUPERVISOR=", "HOST_DIRS=", "PROC_SYS_RO=", "HOST_CANARY="]) expect(PROBE_SCRIPT).toContain(k);
      expect(f.files.get("/tmp/uasco-sbx-AbC123/ctl/kill.sh")).toContain("grep -qF");
    });

    it.skipIf(process.platform !== "linux")("kill.sh (real): kills the recorded process group only while it is still OURS (cmdline contains the scratch dir); a dead leader, a foreign pid and junk are left alone", async () => {
      const {killScript} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const S = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-")); fs.mkdirSync(path.join(S, "ctl"));
      const ours = cp.spawn("sleep", ["120"], {detached: true, stdio: "ignore"}); const foreign = cp.spawn("sleep", ["121"], {detached: true, stdio: "ignore"});
      try {
        await sleepMs(150);
        // lider sh'nin argv'si S'yi taşır (çocuk sleep ile birlikte aynı grupta)
        const ours2 = cp.spawn("sh", ["-c", "sleep 122; :", "sh", S], {detached: true, stdio: "ignore"});
        const run = (pid: string) => { fs.writeFileSync(path.join(S, "ctl", "pid"), pid); fs.writeFileSync(path.join(S, "ctl", "kill.sh"), killScript(S)); return cp.spawnSync("sh", [path.join(S, "ctl", "kill.sh")], {encoding: "utf8"}).stdout.trim(); };
        const alive = (c: cp.ChildProcess) => { try { process.kill(c.pid!, 0); return true; } catch { return false; } };
        expect(run("abc")).toBe("PGID=none"); expect(run(String(foreign.pid))).toBe(`PGID=${foreign.pid}`); await sleepMs(100); expect(alive(foreign)).toBe(true);
        expect(run(String(ours2.pid))).toBe(`PGID=${ours2.pid}`); await sleepMs(300); expect(alive(ours2)).toBe(false);
        expect(run("999999")).toBe("PGID=999999");
      } finally { for (const c of [ours, foreign]) { try { process.kill(-c.pid!, "SIGKILL"); } catch { /* çıkmış */ } } fs.rmSync(S, {recursive: true, force: true}); }
    });

    it.skipIf(process.platform !== "linux")("sweepScript (real): removes only OLD directories with no live process; a young dir and an old dir whose path is in a live argv survive", async () => {
      const {sweepScript} = await import("../core/sandbox/wsl-unshare-sandbox.js");
      const mkd = (name: string, ageMin: number) => { const d = path.join("/tmp", `uasco-sbx-${name}`); fs.mkdirSync(d, {recursive: true}); const t = new Date(Date.now() - ageMin * 60_000); fs.utimesSync(d, t, t); return d; };
      const tag = crypto.randomBytes(3).toString("hex"); const old = mkd(tag, 500), young = mkd(tag.replace(/./, "Y"), 1), live = mkd(tag.replace(/./, "L"), 500);
      const holder = cp.spawn("sh", ["-c", "sleep 130; :", "sh", live], {stdio: "ignore"});
      try {
        await sleepMs(100);
        cp.spawnSync("sh", ["-s"], {input: sweepScript(60)});
        expect(fs.existsSync(old)).toBe(false); expect(fs.existsSync(young)).toBe(true); expect(fs.existsSync(live)).toBe(true);
      } finally { holder.kill("SIGKILL"); for (const d of [old, young, live]) fs.rmSync(d, {recursive: true, force: true}); }
    });

    // Gerçek PROBE_SCRIPT + lifecycle sondaları + seccomp sarmalayıcısı, yerel "wsl" ile (weak.mts yöntemi).
    it.skipIf(!canReal)("REAL probes on Linux (needs the Linux provider's isolation exports; skipped when absent): unmodified isolation passes selfTest as a non-root exec user; a root exec user fails closed (process limit); each weakened control fails with its PROBE_<KEY>", async ctx => {
      const mod = await import("../core/sandbox/wsl-unshare-sandbox.js"); const iso = await lin();
      if (!iso) return ctx.skip();
      const nodeRoot = path.dirname(path.dirname(fs.realpathSync(process.execPath)));
      const make = (isolation: any, asRoot = false) => new mod.WslUnshareSandboxProvider({platform: "win32", distro: "Ubuntu", runner: localWsl({PATH: `${nodeRoot}/bin:${LIN_PATH}`}, asRoot) as any, isolation, extraReadOnlyRoots: /^\/(usr|bin|sbin)\//.test(process.execPath) ? [] : [nodeRoot]});
      // zayıflatılmış izolasyonlar (hızlı başarısız olur)
      const weak = async (label: string, mut: (i: NonNullable<typeof iso>) => NonNullable<typeof iso>, accept: string[]) => { const w = await make(mut(iso)).selfTest(); expect(w.ok, label).toBe(false); expect(accept, `${label}: ${JSON.stringify(w)}`).toContain(w.detail); };
      await weak("caps kept", i => ({...i, setup: i.setup.replaceAll("--bounding-set=-all --inh-caps=-all", "")}), ["PROBE_CAPS_DROPPED"]);
      await weak("nested userns allowed", i => ({...i, setup: i.setup.replace('echo 0 > /proc/sys/user/max_user_namespaces 2>/dev/null || true', "true")}), ["PROBE_NESTED_USERNS"]);
      await weak("host network shared", i => ({...i, nsFlags: i.nsFlags.filter(f => f !== "--net")}), ["PROBE_UNIX_PATH_SOCKETS", "PROBE_NET_IFACES"]);
      // root exec kullanıcısı: RLIMIT_NPROC muaf -> fail-closed
      expect(await make(iso, true).selfTest()).toEqual({ok: false, detail: "PROBE_PROCESS_LIMIT_NOT_ENFORCED"});
      if (dropUid === undefined && process.getuid?.() === 0) return;
      const good = make(iso); const r = await good.selfTest(); expect(r, JSON.stringify(r)).toEqual({ok: true});
      // gerçek koşu: vsock sandbox içinde de engelli, rc geri okunur, temizlik sonrası kalıntı yok
      const dir = ws(); fs.writeFileSync(path.join(dir, "v.js"), "console.log('rc-ok')");
      try { const run = await good.run(["sh", "-c", "echo rc-ok"], {cwd: dir, env: {}, timeoutMs: 30_000}); expect(run, JSON.stringify(run)).toMatchObject({exitCode: 0, timedOut: false}); expect(run.stdout).toContain("rc-ok"); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    }, 180_000);

    // C-3: ürün koşusunun Linux tarafı kapatma kanıtı (gerçek WSL testiyle AYNI doğrulamalar, yerel "wsl" ile): kök kill edilince sandboxTeardown temiz (null) döner, sağlayıcı doğrulanmış kalır, hiçbir uasco-sbx süreci kalmaz, scratch silinir.
    it.skipIf(!canReal)("C-3 (Linux stand-in of the WSL product test): after the sandboxed process is killed, sandboxTeardown resolves clean, the provider stays verified, no uasco-sbx process survives (pgrep exit 1) and the scratch is gone", async ctx => {
      const mod = await import("../core/sandbox/wsl-unshare-sandbox.js"); const iso = await lin();
      if (!iso) return ctx.skip();
      if (dropUid === undefined && process.getuid?.() === 0) return;
      const nodeRoot = path.dirname(path.dirname(fs.realpathSync(process.execPath)));
      const spawner = (args: string[], stdio: any) => cp.spawn(args[3], args.slice(4), {cwd: "/", env: {PATH: `${nodeRoot}/bin:${LIN_PATH}`, HOME: "/tmp", LANG: "C"}, stdio, ...(dropUid !== undefined ? {uid: dropUid, gid: dropUid} : {})});
      const p = new mod.WslUnshareSandboxProvider({platform: "win32", distro: "Ubuntu", runner: localWsl({PATH: `${nodeRoot}/bin:${LIN_PATH}`}) as any, isolation: iso, spawner, extraReadOnlyRoots: /^\/(usr|bin|sbin)\//.test(process.execPath) ? [] : [nodeRoot]});
      expect(await p.selfTest()).toEqual({ok: true});
      const dir = ws();
      try {
        const child: any = await p.spawnAsync("sleep", ["120"], {cwd: dir, env: {}, shell: false, stdio: ["ignore", "pipe", "pipe"]});
        const S = child.sandboxScratch as string; expect(S).toMatch(/^\/tmp\/uasco-sbx-[A-Za-z0-9]{6}$/);
        for (let i = 0; i < 40 && cp.spawnSync("pgrep", ["-f", "--", S]).status !== 0; i++) await sleepMs(100);
        expect(cp.spawnSync("pgrep", ["-f", "--", S]).status).toBe(0); // sandbox içindeki süreç gerçekten çalışıyor
        child.kill("SIGKILL");
        expect(await child.sandboxTeardown).toBeNull();
        expect(p.isVerified()).toBe(true);
        expect(cp.spawnSync("pgrep", ["-f", "uasco-sbx"]).status).toBe(1); expect(fs.existsSync(S)).toBe(false);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    }, 180_000);
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

// //TR: LANE-B B-ACCEPT-WIN-1: Founder'ın Windows kabul kiti (docs/acceptance/windows/founder-acceptance.mjs). Linux'ta sahte wsl/CLI/profil/vitest bağımlılıklarıyla ayrıştırma, her ön koşul reddi + tam düzeltme komutu, SKIP≠PASS, SHA'ya bağlı kanıt ve salt-okunur wsl çağrıları doğrulanır; gerçek koşu yalnız Founder'ın makinesindedir.
describe("LANE-B Windows acceptance kit (injected fakes)", () => {
  const u16 = (t: string) => Buffer.from("\uFEFF" + t, "utf16le");
  const GOOD_CONF = "[interop]\nenabled=false\nappendWindowsPath=false\n";
  type W = {code: number | null; stdout: Buffer};
  const mkDeps = (o: Record<string, any> = {}) => {
    const calls: string[][] = []; const inputs: string[] = [];
    const wsl = async (args: string[], input?: string): Promise<W> => {
      calls.push(args); if (args.join(" ") === "-d Ubuntu --exec /bin/sh -s") inputs.push(String(input));
      const j = args.join(" ");
      if (j === "--status") return {code: o.status ?? 0, stdout: Buffer.from("ok")};
      if (j === "-l -q") return {code: 0, stdout: u16(o.distros ?? "Ubuntu\r\n")};
      if (j === "-l -v") return {code: 0, stdout: u16(o.verbose ?? "  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n")};
      if (j.endsWith("/bin/cat /etc/wsl.conf")) return o.conf === null ? {code: 1, stdout: Buffer.alloc(0)} : {code: 0, stdout: Buffer.from(o.conf ?? GOOD_CONF)};
      if (j === "-d Ubuntu --exec /bin/sh -s") {
        const rt = o.interopRt ?? "off", st = (n: string) => rt === "enabled" && n === "WSLInterop" || rt === "late" && n === "WSLInterop-late" ? "enabled" : rt === "disabled" ? "disabled" : "absent";
        if (rt === "error") return {code: 1, stdout: Buffer.alloc(0)};
        if (rt === "garbage") return {code: 0, stdout: Buffer.from("DONE=1\n")};
        return {code: 0, stdout: Buffer.from(`WSLInterop=${st("WSLInterop")}\nWSLInterop-late=${st("WSLInterop-late")}\nDONE=1\n`)};
      }
      if (j.endsWith("/usr/bin/env node --version")) return o.node === null ? {code: 127, stdout: Buffer.alloc(0)} : {code: 0, stdout: Buffer.from("v24.1.0\n")};
      return {code: 1, stdout: Buffer.alloc(0)};
    };
    const prof = (state: string) => ({state, reason: state === "READY" ? undefined : state === "REFUSED" ? "PROFILE_PATH_INSIDE_GIT_WORKTREE" : "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: state === "LOGIN_REQUIRED" ? "$env:CLAUDE_CONFIG_DIR='C:\\x'; claude" : null});
    let vitestRuns = 0;
    const deps: any = {platform: o.platform ?? "win32", controlRoot: "C:\\data", wsl, now: () => "2026-10-31T10:00:00.000Z", scriptSha256: "s".repeat(64), testSha256: "t".repeat(64),
      git: () => o.git ?? {headSha: "a".repeat(40), dirty: false},
      detectClaudeCli: o.cli === null ? null : () => o.cli ?? {state: "FOUND", path: "C:\\Users\\f\\.local\\bin\\claude.exe"},
      claudeProfileStatus: o.noProfiles ? null : (_r: string, role: string) => prof(o.profiles?.[role] ?? "READY"),
      runVitest: async () => { vitestRuns++; return o.vitest ?? vitestOk(); }};
    return {deps, calls, inputs, runs: () => vitestRuns};
  };
  const vitestOk = (st: Record<string, string> = {}) => ({testResults: [{assertionResults: [
    {fullName: "x REAL WSL (win32 + UASCO_WSL_DISTRO): selfTest passes its negative probes and a node test runs inside the sandbox (SKIPPED elsewhere)", status: st.a ?? "passed", failureMessages: []},
    {fullName: "x REAL WSL (win32 + UASCO_WSL_DISTRO): the generated web-node product starts in the sandbox, the bridged", status: st.b ?? "passed", failureMessages: []}]}]});
  const byId = (r: any) => Object.fromEntries(r.checks.map((c: any) => [c.id, c]));
  const load = () => import("../docs/acceptance/windows/founder-acceptance.mjs") as Promise<any>;

  it("parsers: wsl.conf (defaults ON, sections, comments, case, other sections ignored), UTF-16 list output, verbose table", async () => {
    const k = await load();
    expect(k.parseWslConf(GOOD_CONF)).toMatchObject({interopEnabled: false, appendWindowsPath: false});
    expect(k.parseWslConf("")).toMatchObject({interopEnabled: true, appendWindowsPath: true, interopExplicit: false});
    expect(k.parseWslConf("[interop]\n enabled = FALSE  # x\nappendWindowsPath=False\n")).toMatchObject({interopEnabled: false, appendWindowsPath: false});
    expect(k.parseWslConf("[boot]\nenabled=false\nappendWindowsPath=false\n")).toMatchObject({interopEnabled: true, appendWindowsPath: true});
    expect(k.parseWslConf("[interop]\nenabled=false\n")).toMatchObject({interopEnabled: false, appendWindowsPath: true});
    expect(k.parseWslConf("[interop]\nenabled=maybe\n")).toMatchObject({interopEnabled: true});
    expect(k.parseWslList(k.decodeWslText(u16("Ubuntu\r\nDebian\r\n")))).toEqual(["Ubuntu", "Debian"]);
    expect(k.parseWslVerbose("  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n  Debian Stopped 1\r\n")).toEqual([{name: "Ubuntu", version: 2}, {name: "Debian", version: 1}]);
  });

  it("all good on Windows: every check PASS, ACCEPTED, bound to the git SHA, evidence hash is reproducible, and only READ-ONLY wsl commands were issued", async () => {
    const k = await load(); const {deps, calls, inputs, runs} = mkDeps();
    const r = await k.runAcceptance({distro: "Ubuntu"}, deps);
    expect(r.verdict).toBe("ACCEPTED"); expect(r.fail).toBe(0); expect(r.skip).toBe(0); expect(r.pass).toBe(r.checks.length); expect(r.repo).toEqual({headSha: "a".repeat(40), shaSource: "GIT", dirty: false}); expect(runs()).toBe(1);
    const {evidenceSha256, ...body} = r; expect(evidenceSha256).toBe(crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    const allowed = [/^--status$/, /^-l -q$/, /^-l -v$/, /^-d Ubuntu --exec \/bin\/cat \/etc\/wsl\.conf$/, /^-d Ubuntu --exec \/bin\/sh -s$/, /^-d Ubuntu --exec \/usr\/bin\/env node --version$/];
    for (const c of calls) expect(allowed.some(a => a.test(c.join(" "))), c.join(" ")).toBe(true);
    expect(inputs).toEqual([k.INTEROP_SCRIPT]);
  });

  it.skipIf(process.platform !== "linux")("C-4: INTEROP_SCRIPT (real sh, binfmt dir redirected) reports absent/disabled/enabled for WSLInterop and WSLInterop-late separately", async () => {
    const k = await load(); const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-bm-"));
    try {
      const run = () => cp.spawnSync("/bin/sh", ["-s"], {input: k.INTEROP_SCRIPT.replaceAll("/proc/sys/fs/binfmt_misc", d), encoding: "utf8"}).stdout;
      expect(run()).toBe("WSLInterop=absent\nWSLInterop-late=absent\nDONE=1\n");
      fs.writeFileSync(path.join(d, "WSLInterop"), "disabled\n"); fs.writeFileSync(path.join(d, "WSLInterop-late"), "enabled\ninterpreter /init\n");
      expect(run()).toBe("WSLInterop=disabled\nWSLInterop-late=enabled\nDONE=1\n");
      fs.writeFileSync(path.join(d, "WSLInterop"), "enabled\n"); fs.writeFileSync(path.join(d, "WSLInterop-late"), "disabled\n");
      expect(run()).toBe("WSLInterop=enabled\nWSLInterop-late=disabled\nDONE=1\n");
    } finally { fs.rmSync(d, {recursive: true, force: true}); }
  });

  it("each failed precondition is FAIL with the exact Founder fix command; the report never changes settings", async () => {
    const k = await load();
    const run = async (o: any) => byId(await k.runAcceptance({distro: "Ubuntu"}, mkDeps(o).deps));
    expect((await run({status: 1})).WSL_EXE).toMatchObject({status: "FAIL", fix: expect.stringContaining("wsl --install")});
    const nd = await run({distros: "Debian\r\n"}); expect(nd.WSL_DISTRO).toMatchObject({status: "FAIL", fix: "wsl --install -d Ubuntu"});
    expect((await run({verbose: "  NAME STATE VERSION\r\n* Ubuntu Running 1\r\n"})).WSL_VERSION_2).toMatchObject({status: "FAIL", fix: "wsl --set-version Ubuntu 2"});
    const cf = await run({conf: "[interop]\nenabled=true\n"}); expect(cf.WSL_CONF.status).toBe("FAIL"); expect(cf.WSL_CONF.detail).toContain("interop.enabled"); expect(cf.WSL_CONF.detail).toContain("appendWindowsPath"); expect(cf.WSL_CONF.fix).toContain("enabled=false"); expect(cf.WSL_CONF.fix).toContain("appendWindowsPath=false"); expect(cf.WSL_CONF.fix).toContain("wsl --shutdown");
    expect((await run({conf: null})).WSL_CONF.status).toBe("FAIL");
    expect((await run({interopRt: "enabled"})).WSL_INTEROP_RUNTIME).toMatchObject({status: "FAIL"});
    // C-4: yalnız AÇIK absent/disabled kanıtı PASS; -late kaydı, wsl hatası ve eksik satırlar FAIL
    expect((await run({interopRt: "late"})).WSL_INTEROP_RUNTIME).toMatchObject({status: "FAIL", detail: expect.stringContaining("WSLInterop-late=enabled")});
    expect((await run({interopRt: "error"})).WSL_INTEROP_RUNTIME.status).toBe("FAIL"); expect((await run({interopRt: "garbage"})).WSL_INTEROP_RUNTIME).toMatchObject({status: "FAIL", detail: expect.stringContaining("missing")});
    expect((await run({interopRt: "disabled"})).WSL_INTEROP_RUNTIME).toMatchObject({status: "PASS"}); expect((await run({})).WSL_INTEROP_RUNTIME).toMatchObject({status: "PASS", detail: "WSLInterop=absent; WSLInterop-late=absent"});
    expect((await run({node: null})).WSL_NODE).toMatchObject({status: "FAIL", fix: expect.stringContaining("apt-get install")});
    expect((await run({cli: {state: "SHIM_UNSUPPORTED", path: "C:\\npm\\claude.cmd", founderAction: "Install the native Claude Code (claude.exe)"}})).CLAUDE_CLI).toMatchObject({status: "FAIL", fix: "Install the native Claude Code (claude.exe)"});
    expect((await run({cli: {state: "NOT_FOUND", path: null, founderAction: null}})).CLAUDE_CLI.fix).toContain("claude.ai/install.ps1");
    const pr = await run({profiles: {implementer: "LOGIN_REQUIRED", reviewer: "REFUSED"}});
    expect(pr.CLAUDE_PROFILE_IMPLEMENTER).toMatchObject({status: "FAIL", fix: expect.stringContaining("CLAUDE_CONFIG_DIR")}); expect(pr.CLAUDE_PROFILE_REVIEWER.fix).toContain("--control-root");
    const none = await k.runAcceptance({distro: null}, mkDeps().deps); expect(byId(none).WSL_DISTRO).toMatchObject({status: "FAIL"});
  });

  it("SKIP is never PASS: not-Windows, missing Lane C module, skipped vitest tests and unfound tests all prevent ACCEPTED; blocking WSL preconditions skip the tests without running vitest; unknown SHA prevents ACCEPTED", async () => {
    const k = await load();
    const lin = mkDeps({platform: "linux"}); const rl = await k.runAcceptance({distro: "Ubuntu"}, lin.deps);
    expect(rl.verdict).toBe("NOT_ACCEPTED"); expect(lin.runs()).toBe(0); expect(lin.calls).toEqual([]); expect(byId(rl).WSL_SELFTEST_AND_RUN.status).toBe("SKIP"); expect(rl.pass).toBe(3);
    const nocli = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({cli: null}).deps); expect(byId(nocli).CLAUDE_CLI.status).toBe("SKIP"); expect(nocli.verdict).toBe("NOT_ACCEPTED"); expect(nocli.reasons).toContain("SKIP:CLAUDE_CLI");
    const sk = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({vitest: vitestOk({a: "skipped", b: "pending"})}).deps); expect(byId(sk).WSL_SELFTEST_AND_RUN.status).toBe("SKIP"); expect(byId(sk).WSL_PRODUCT_BRIDGE.status).toBe("SKIP"); expect(sk.verdict).toBe("NOT_ACCEPTED");
    const nf = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({vitest: {testResults: []}}).deps); expect(byId(nf).WSL_PRODUCT_BRIDGE).toMatchObject({status: "FAIL", detail: expect.stringContaining("TEST_NOT_FOUND")});
    const fl = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({vitest: vitestOk({b: "failed"})}).deps); expect(byId(fl).WSL_PRODUCT_BRIDGE.status).toBe("FAIL");
    const blocked = mkDeps({distros: "Debian\r\n"}); const rb = await k.runAcceptance({distro: "Ubuntu"}, blocked.deps); expect(byId(rb).WSL_SELFTEST_AND_RUN.detail).toContain("PRECONDITION_FAILED: WSL_DISTRO"); expect(blocked.runs()).toBe(0);
    const nosha = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({git: {headSha: null, dirty: null}}).deps); expect(nosha.verdict).toBe("NOT_ACCEPTED"); expect(nosha.reasons).toEqual(["HEAD_SHA_UNKNOWN", "DIRTY_UNKNOWN"]); expect(nosha.repo.shaSource).toBe("UNKNOWN");
    const arg = await k.runAcceptance({distro: "Ubuntu", shaArg: "b".repeat(40)}, mkDeps({git: {headSha: null, dirty: null}}).deps); expect(arg.verdict).toBe("NOT_ACCEPTED"); expect(arg.reasons).toEqual(["SHA_UNVERIFIED", "DIRTY_UNKNOWN"]); expect(arg.repo).toMatchObject({shaSource: "ARGUMENT", headSha: "b".repeat(40)});
    // C-2: kirli ağaç, bilinmeyen kirlilik ve --sha ile temiz-bilinmeyen = ACCEPTED OLAMAZ; yalnız GIT + temiz ACCEPTED
    const dirty = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({git: {headSha: "a".repeat(40), dirty: true}}).deps); expect(dirty.verdict).toBe("NOT_ACCEPTED"); expect(dirty.reasons).toEqual(["DIRTY_TREE"]);
    const unk = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({git: {headSha: "a".repeat(40), dirty: null}}).deps); expect(unk.verdict).toBe("NOT_ACCEPTED"); expect(unk.reasons).toEqual(["DIRTY_UNKNOWN"]);
    const clean = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({git: {headSha: "a".repeat(40), dirty: false}}).deps); expect(clean.verdict).toBe("ACCEPTED"); expect(clean.reasons).toEqual([]);
  });

  it("table: one line per check, the fix block, and the SKIP-is-never-PASS verdict line; argument parsing is strict", async () => {
    const k = await load();
    const r = await k.runAcceptance({distro: "Ubuntu"}, mkDeps({conf: "", vitest: vitestOk({b: "skipped"})}).deps); const t = k.renderTable(r);
    expect(t).toContain("FAIL  WSL_CONF"); expect(t).toContain("WHAT TO DO"); expect(t).toContain("appendWindowsPath=false"); expect(t).toContain("RESULT: NOT_ACCEPTED"); expect(t).toContain("SKIP is never PASS"); expect(t.split("\n").filter((l: string) => /^(PASS|FAIL|SKIP) /.test(l))).toHaveLength(r.checks.length);
    expect(k.parseArgs(["--distro", "Ubuntu", "--sha", "a".repeat(40)], {}).distro).toBe("Ubuntu");
    expect(k.parseArgs(["--distro", "bad name"], {}).error).toBeTruthy(); expect(k.parseArgs(["--sha", "xyz"], {}).error).toBeTruthy(); expect(k.parseArgs(["--nope"], {}).error).toContain("unknown argument");
    expect(k.parseArgs([], {UASCO_WSL_DISTRO: "Debian"}).distro).toBe("Debian");
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "acceptance", "windows", "founder-acceptance.mjs"), "utf8");
    expect(src).not.toMatch(/\bsetx\b|Set-ItemProperty|reg add|writeFileSync\([^)]*wsl\.conf/);
  });
});
