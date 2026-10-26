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
import type {GateDecision, SandboxProvider} from "../core/workos/execution-gate.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {deriveOutcomes} from "../core/workos/outcomes.js";
import {TEST_HOST_PASSTHROUGH_SANDBOX, testExecutionGate} from "./support/test-sandbox.js";
import {LINUX_SANDBOX_HELPER_PATH, LINUX_SANDBOX_NS_FLAGS, LINUX_SANDBOX_SETUP} from "../core/agents/linux-unshare-sandbox.js";
import {LINUX_SANDBOX_LOOPBACK_PROBE, loopbackVerdict, netnsProblemOf, networkRouteProblem} from "../core/agents/linux-unshare-sandbox.js";

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
    expect(server).toContain("new ExecutionGate(\"sandbox\" in opts?(opts.sandbox??null):defaultSandboxProvider());");
    // Batch 4a: the default provider is Linux-only, and a constructor throw degrades to "no provider" (never a startup crash).
    expect(server).toContain("const defaultSandboxProvider=():SandboxProvider|null=>{if(process.platform!==\"linux\")return null;try{return new LinuxUnshareSandboxProvider()}catch{return null}};");
    expect(code(server)).not.toMatch(/acceptUnenforcedProcessLimit/);
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

describe("SBX-GATE control API (explicit no provider: sandbox null)", () => {
  const mk = (extra: Record<string, unknown> = {sandbox: null}) => {
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
describe("SBX-GATE control API (production default: no sandbox option)", () => {
  // //TR: Batch 4a: seçenek hiç verilmezse Linux'ta gerçek sağlayıcı denenir; selfTest geçmezse SANDBOX_UNAVAILABLE ve hiçbir şey başlatılmaz. Diğer platformlarda sağlayıcı yoktur.
  it("Linux tries the real provider (never NO_VERIFIED_PROVIDER there); other platforms have none; an unverified provider still refuses dev-run with 409", { timeout: T }, async () => {
    const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
    fs.mkdirSync(runtime, {recursive: true});
    const app = buildServer({controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, port: 3210, logger: false, tenantId: "tA"});
    apps.push(app);
    const sys = (await app.inject({method: "GET", url: "/v1/system/executors", headers: HDR})).json();
    if (process.platform !== "linux") { expect(sys.sandbox).toEqual({state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null}); return; }
    if (sys.sandbox.state === "AVAILABLE") { expect(sys.sandbox.providerId).toBe("linux-unshare-v2"); return; }
    expect(sys.sandbox.state).toBe("UNAVAILABLE");
    expect(sys.sandbox.detail).not.toBe("NO_VERIFIED_PROVIDER");
    const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "Shop", environmentId: "dev", template: "web-node", idempotencyKey: "sbx-default-1"}});
    expect(created.statusCode).toBe(201);
    const dev = await app.inject({method: "POST", url: `/v1/projects/${created.json().project.projectId}/devrun/start`, headers: HDR, payload: {}});
    expect(dev.statusCode).toBe(409);
    expect(dev.json().error).toBe("SANDBOX_UNAVAILABLE");
    expect(dev.json().reason).not.toBe("NO_VERIFIED_PROVIDER");
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

// //TR: C-LINUX-SANDBOX-EXPORTS (test birleştirme): dışa aktarılan Linux izolasyon sabitlerinin sağlayıcının kullandığı değerler olduğunu kanıtlayan testler kayıtlı bir dosyaya taşındı (yeni test dosyası config/validation.json kaydı gerektirirdi).
describe("C-LINUX-SANDBOX-EXPORTS: the exported isolation constants are the values the provider runs with", () => {
  it("exports the unchanged values (isolation flags frozen, helper PATH, setup script)", () => {
    expect([...LINUX_SANDBOX_NS_FLAGS]).toEqual(["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL"]);
    expect(Object.isFrozen(LINUX_SANDBOX_NS_FLAGS)).toBe(true);
    expect(() => (LINUX_SANDBOX_NS_FLAGS as string[]).push("--evil")).toThrow(TypeError); // a consumer cannot change the provider's flags
    expect(LINUX_SANDBOX_HELPER_PATH).toBe("/usr/sbin:/usr/bin:/sbin:/bin");
    expect(typeof LINUX_SANDBOX_SETUP).toBe("string");
    expect(LINUX_SANDBOX_SETUP).toContain(`PATH=${LINUX_SANDBOX_HELPER_PATH}`); // the script resolves privileged helpers with the exported HELPER_PATH
    expect(LINUX_SANDBOX_SETUP.startsWith("set -eu; set -f\n")).toBe(true);
  });

  // The provider's own argv builder (private) must embed exactly the exported flags and script. It needs a host directory that can serve as the new root (/mnt, /srv or /media); a host without one cannot build argv at all, which is reported (not silently passed).
  it("the provider's argv is [...exported flags, shell, -c, exported setup, ...] for the same inputs", () => {
    const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-"));
    try {
      const p = new LinuxUnshareSandboxProvider({platform: "linux", readOnlyRoots: []}) as unknown as {args(cwd: string, timeoutMs: number, command: string[]): string[] | null};
      const argv = p.args(cwd, 1000, ["true"]);
      if (argv === null) { expect(["/mnt", "/srv", "/media"].some(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })).toBe(false); return; } // null only when no new-root mount point exists on this host
      expect(argv.slice(0, LINUX_SANDBOX_NS_FLAGS.length)).toEqual([...LINUX_SANDBOX_NS_FLAGS]);
      expect(argv[LINUX_SANDBOX_NS_FLAGS.length + 1]).toBe("-c");
      expect(argv[LINUX_SANDBOX_NS_FLAGS.length + 2]).toBe(LINUX_SANDBOX_SETUP);
    } finally { fs.rmSync(cwd, {recursive: true, force: true}); }
  });
});

// //TR: C-SBX-LO-1 (test birleştirme): Linux sandbox içinde loopback testleri kayıtlı bir dosyaya taşındı (yeni test dosyası config/validation.json kaydı gerektirirdi).
describe("C-SBX-LO-1: loopback inside the Linux sandbox, no way out", () => {
  const T2 = 180_000;
  const isRoot = (process.getuid?.() ?? 0) === 0;
  const procOpts = isRoot ? {acceptUnenforcedProcessLimit: true} : {};
  const hostCanIsolate = process.platform === "linux" && cp.spawnSync("unshare", ["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL", "true"], {stdio: "ignore"}).status === 0
    && ["setpriv", "pivot_root", "mount", "umount"].every(t => cp.spawnSync("sh", ["-c", `command -v ${t}`], {stdio: "ignore", env: {PATH: LINUX_SANDBOX_HELPER_PATH}}).status === 0);
  const hostHasIp = LINUX_SANDBOX_HELPER_PATH.split(":").some(d => { try { fs.accessSync(path.join(d, "ip"), fs.constants.X_OK); return true; } catch { return false; } });
  const PERL_STUB = '#!/usr/bin/perl\nuse Socket;\nexit 2 unless "@ARGV" eq "link set lo up";\nsocket(S, AF_INET, SOCK_DGRAM, 0) or exit 3;\nmy $ifr = pack("a16 s", "lo", 0x41);\nioctl(S, 0x8914, $ifr) or exit 4;\nexit 0;\n';
  const canStub = process.platform === "linux" && isRoot && hostCanIsolate && !hostHasIp && cp.spawnSync("sh", ["-c", "command -v perl"], {stdio: "ignore"}).status === 0 && (() => { try { fs.accessSync("/usr/sbin", fs.constants.W_OK); return true; } catch { return false; } })();
  const withStubIp = async <R,>(script: string, fn: () => Promise<R>): Promise<R> => {
    fs.writeFileSync("/usr/sbin/ip", script, {mode: 0o755, flag: "wx"}); // wx: an existing (real) ip is never overwritten
    try { return await fn(); } finally { fs.rmSync("/usr/sbin/ip", {force: true}); }
  };
  const hostListener = async () => {
    let connections = 0;
    const srv = net.createServer(s => { connections++; s.destroy(); });
    const port = await new Promise<number>((res, rej) => { srv.once("error", rej); srv.listen(0, "127.0.0.1", () => res((srv.address() as net.AddressInfo).port)); });
    return {port, srv, connections: () => connections};
  };

  it("SETUP brings lo up right after the prlimit lines: ip resolved with the fixed helper PATH before the capabilities are dropped, never any other tool", () => {
    const L = LINUX_SANDBOX_SETUP.split("\n");
    const at = (pred: (l: string) => boolean) => L.findIndex(pred);
    const iPath = at(l => l.startsWith('CALLER_PATH="$PATH"; PATH=')), iPrl = at(l => l.startsWith('if [ -n "$PRL" ] && ! "$PRL"'));
    const iIpb = L.indexOf('IPB=$(command -v ip 2>/dev/null) || IPB=""'), iUp = L.indexOf('if [ -n "$IPB" ]; then "$IPB" link set lo up 2>/dev/null || true; fi');
    const iRpriv = at(l => l.startsWith("mount --make-rprivate")), iDrop = at(l => l.startsWith('exec "$SETPRIV"'));
    expect([iPath >= 0, iPath < iPrl, iIpb === iPrl + 1, iUp === iIpb + 1, iRpriv === iUp + 1, iUp < iDrop]).toEqual([true, true, true, true, true, true]);
    expect(LINUX_SANDBOX_SETUP.split("link set lo up")).toHaveLength(2); // exactly one place brings an interface up
    expect(LINUX_SANDBOX_SETUP.toLowerCase()).not.toContain("python");
    expect(LINUX_SANDBOX_SETUP).not.toContain('PATH="$CALLER_PATH" command'); // the caller's PATH never resolves a privileged helper
  });

  it("the in-sandbox probe covers loopback and every outbound target, and names its host-loopback port", () => {
    for (const piece of ['"1.1.1.1", 53', '"8.8.8.8", 53', '"93.184.216.34", 80', 'targets.push(["127.0.0.1", hostPort])', "probe_started", "loopback_ok", "outbound_connected", "outbound_blocked", 'got === "pong"']) expect(LINUX_SANDBOX_LOOPBACK_PROBE).toContain(piece);
  });

  it("the probe script itself: loopback works, a reachable target is reported as outbound_connected, and a dead loopback is reported as loopback_failed", { timeout: 60_000 }, async () => {
    const l = await hostListener();
    try {
      const host = cp.spawnSync(process.execPath, ["-e", LINUX_SANDBOX_LOOPBACK_PROBE, String(l.port)], {encoding: "utf8", timeout: 30_000});
      const lines = String(host.stdout).split("\n").map(s => s.trim());
      expect([lines.includes("probe_started"), lines.includes("loopback_ok"), lines.includes("outbound_connected")]).toEqual([true, true, true]); // the host listener is a reachable "outside"
      await new Promise(r => setTimeout(r, 100)); // spawnSync blocked this process's event loop: let the accepted connection be delivered
      expect(l.connections()).toBeGreaterThan(0);
      if (hostCanIsolate) { // a fresh net namespace has lo DOWN: no listen, nothing reachable
        const ns = cp.spawnSync("unshare", ["--user", "--map-root-user", "--net", process.execPath, "-e", LINUX_SANDBOX_LOOPBACK_PROBE, String(l.port)], {encoding: "utf8", timeout: 30_000});
        const nl = String(ns.stdout).split("\n").map(s => s.trim());
        expect([nl.includes("probe_started"), nl.includes("loopback_failed"), nl.includes("outbound_blocked")]).toEqual([true, true, true]);
      }
    } finally { l.srv.close(); }
  });

  it("loopbackVerdict: every outcome (host loopback reached, outbound connected or unverified, no loopback with and without ip, node unavailable)", () => {
    const V = (o: {ipPresent: boolean; stdout: string; hostConnections: number; exitCode?: number | null; timedOut?: boolean}) => loopbackVerdict({exitCode: 0, timedOut: false, ...o});
    const out = (...t: string[]) => t.join("\n") + "\n";
    const ok = (lo: boolean, reason: string | null) => ({ok: true, capabilities: {loopback: lo, loopbackReason: reason}});
    const full = out("probe_started", "loopback_ok", "outbound_blocked");
    expect(V({ipPresent: true, stdout: full, hostConnections: 1})).toEqual({ok: false, detail: "SELFTEST_HOST_LOOPBACK_REACHED"});
    expect(V({ipPresent: false, stdout: "", hostConnections: 2})).toEqual({ok: false, detail: "SELFTEST_HOST_LOOPBACK_REACHED"});
    for (const ip of [true, false]) expect(V({ipPresent: ip, stdout: out("probe_started", "loopback_ok", "outbound_connected"), hostConnections: 0})).toEqual({ok: false, detail: "SELFTEST_OUTBOUND_CONNECT_SUCCEEDED"});
    expect(V({ipPresent: true, stdout: out("probe_started", "loopback_ok"), hostConnections: 0})).toEqual({ok: false, detail: "SELFTEST_OUTBOUND_NOT_VERIFIED"}); // probe died before its verdict: fail closed
    expect(V({ipPresent: true, stdout: out("probe_started", "loopback_failed", "outbound_blocked"), hostConnections: 0})).toEqual({ok: false, detail: "SELFTEST_LOOPBACK_NOT_AVAILABLE"});
    expect(V({ipPresent: true, stdout: full, hostConnections: 0})).toEqual(ok(true, null));
    expect(V({ipPresent: false, stdout: out("probe_started", "loopback_failed", "outbound_blocked"), hostConnections: 0})).toEqual(ok(false, "LOOPBACK_TOOL_MISSING")); // no ip: still verified, loopback not claimed
    expect(V({ipPresent: false, stdout: full, hostConnections: 0})).toEqual(ok(true, null)); // the truth wins if lo is up some other way
    expect(V({ipPresent: true, stdout: "node: not found\n", hostConnections: 0, exitCode: 127})).toEqual(ok(false, "LOOPBACK_PROBE_NODE_UNAVAILABLE"));
    expect(V({ipPresent: false, stdout: "", hostConnections: 0, exitCode: 127})).toEqual(ok(false, "LOOPBACK_TOOL_MISSING"));
    expect(V({ipPresent: true, stdout: "xprobe_started\nloopback_ok\noutbound_blocked\n", hostConnections: 0, exitCode: 127})).toEqual(ok(false, "LOOPBACK_PROBE_NODE_UNAVAILABLE")); // tokens match whole lines only
    // LC-LO-01: a probe that printed nothing counts as "node unavailable" ONLY for exit 127 without a timeout; every other silent result is not proven and fails closed
    for (const silent of [{exitCode: 1, timedOut: false}, {exitCode: null, timedOut: true}, {exitCode: 127, timedOut: true}, {exitCode: 0, timedOut: false}, {exitCode: null, timedOut: false}, {exitCode: 137, timedOut: false}])
      for (const ip of [true, false]) expect([silent, V({ipPresent: ip, stdout: "", hostConnections: 0, ...silent})]).toEqual([silent, {ok: false, detail: "SELFTEST_LOOPBACK_PROBE_FAILED"}]);
    expect(netnsProblemOf("x\nnetns=net:[4026539999]\n", "net:[4026531840]")).toBeNull(); // differs from the host's
    expect(netnsProblemOf("netns=net:[4026531840]\n", "net:[4026531840]")).toBe("SELFTEST_NETNS_SHARED");
    for (const bad of ["", "no netns line\n", "netns=\n"]) expect(netnsProblemOf(bad, "net:[4026531840]")).toBe("SELFTEST_NETNS_NOT_VERIFIED");
    expect(netnsProblemOf("netns=net:[1]\n", null)).toBe("SELFTEST_NETNS_NOT_VERIFIED"); // the host's own link unreadable: nothing to compare with
    expect(networkRouteProblem("a\nno_route_out\n")).toBeNull();
    expect(networkRouteProblem("a\nno_route_out_not\n")).toBe("SELFTEST_ROUTE_OUT_EXISTS");
    expect(networkRouteProblem("")).toBe("SELFTEST_ROUTE_OUT_EXISTS");
  });

  // LC-LO-03: selfTest's WIRING (host-loopback listener count, route check, netns check, port handed to the probe, the capability publish only after EVERY step) with a scripted `exec`: the real sandbox is not needed, only the pre-flight tools (an environment without them skips, it does not pass).
  describe("selfTest wiring (scripted sandbox exec)", () => {
    const TOKENS = ["supervisor_ok", "host_fs_hidden", "host_dirs_hidden", "root_ro_ok", "scratch_ok", "proc_sys_ro_ok", "mount_audit_ok", "caps_dropped_all", "net_none", "no_ctty", "extra_roots_isolated", "nested_userns_blocked", "pid_ns_private"];
    type Script = {route?: boolean; netns?: string | null; lp?: {stdout?: string; exitCode?: number | null; timedOut?: boolean; reachHost?: boolean}; stdin?: string};
    const run = async (script: Script) => {
      const p = new LinuxUnshareSandboxProvider(procOpts);
      const seen = {probePort: 0, probeCwd: "", calls: [] as string[]};
      const res = (argv: string[], over: Record<string, unknown> = {}) => ({argv, exitCode: 0, stdout: "", stderr: "", startedAt: "t", endedAt: "t", timedOut: false, aborted: false, spawnError: false, ...over});
      vi.spyOn(p as unknown as {exec: (...a: unknown[]) => unknown}, "exec").mockImplementation((async (argv: string[], opts: {cwd: string}) => {
        const cmd = argv.join(" "), body = argv[0] === "sh" ? String(argv[2] ?? "") : "";
        seen.calls.push(argv[0] === process.execPath ? "node-probe" : body.slice(0, 24) || cmd.slice(0, 24));
        if (cmd === "sh -c echo sandbox_ok") return res(argv, {stdout: "sandbox_ok\n"});
        if (body.includes("supervisor_ok")) { fs.writeFileSync(path.join(opts.cwd, "p"), ""); return res(argv, {stdout: TOKENS.join("\n") + "\n" + (script.route === false ? "" : "no_route_out\n") + (script.netns === null ? "" : `netns=${script.netns ?? "net:[4026539999]"}\n`)}); } // the probe's `touch p` lands in the host-visible scratch directory
        if (argv[0] === process.execPath) {
          seen.probePort = Number(argv[argv.length - 1]); seen.probeCwd = opts.cwd;
          if (script.lp?.reachHost) await new Promise<void>(r => { const c = net.connect({host: "127.0.0.1", port: seen.probePort}, () => { c.destroy(); setTimeout(r, 50); }); c.once("error", () => r()); }); // "the sandbox reached the host's loopback listener"
          return res(argv, {stdout: script.lp?.stdout ?? "probe_started\nloopback_ok\noutbound_blocked\n", exitCode: script.lp?.exitCode ?? 0, timedOut: script.lp?.timedOut ?? false});
        }
        if (body.includes("ok=0; fail=0")) return res(argv, {stdout: "ok=48 fail=102\n"});
        if (body.includes("command -v perl")) return res(argv, {timedOut: true, exitCode: null});
        if (body.includes("read -r l")) return res(argv, {stdout: script.stdin ?? "got=PIPED\n"});
        throw new Error(`unscripted sandbox call: ${cmd.slice(0, 80)}`);
      }) as never);
      const st = await p.selfTest();
      return {p, st, seen};
    };
    const PRE = /^(PLATFORM_NOT_LINUX|UNSHARE_|REQUIRED_TOOL_MISSING)/;
    const T = 120_000;

    it.skipIf(process.platform !== "linux")("a fully proven run publishes the capabilities (frozen), hands the probe the host listener's port and runs it in the scratch workspace", { timeout: T }, async (ctx) => {
      const {p, st, seen} = await run({});
      if (!st.ok && PRE.test(st.detail ?? "")) return ctx.skip();
      expect(st, JSON.stringify(st)).toMatchObject({ok: true});
      expect(p.capabilities).toEqual({loopback: true, loopbackReason: null});
      expect(Object.isFrozen(p.capabilities)).toBe(true);
      expect(() => { (p.capabilities as {loopback: boolean}).loopback = false; }).toThrow(); // LC-LO-02: nothing can flip a published capability through the getter
      const a = p.capabilities, b = p.capabilities;
      expect(a).not.toBe(b); expect(a).toEqual(b); // a fresh frozen copy per read: the provider's own record is never handed out
      expect(seen.probePort, "the probe must be given the host listener's port").toBeGreaterThan(0);
      expect(seen.probeCwd).toContain("uasco-sbx-selftest-");
    });

    it.skipIf(process.platform !== "linux")("every refusal leaves the capabilities NOT_PROBED and names the exact reason: host loopback reached, route out exists, netns shared or unproven, silent probe, a later stdin failure", { timeout: 6 * T }, async (ctx) => {
      const cases: Array<[string, Script, string]> = [
        ["host loopback reached", {lp: {reachHost: true}}, "SELFTEST_HOST_LOOPBACK_REACHED"],
        ["a route out exists", {route: false}, "SELFTEST_ROUTE_OUT_EXISTS"],
        ["the netns is the host's", {netns: fs.readlinkSync("/proc/self/ns/net")}, "SELFTEST_NETNS_SHARED"],
        ["no netns line", {netns: null}, "SELFTEST_NETNS_NOT_VERIFIED"],
        ["probe crashed (exit 1, no output)", {lp: {stdout: "", exitCode: 1}}, "SELFTEST_LOOPBACK_PROBE_FAILED"],
        ["probe timed out silently", {lp: {stdout: "", exitCode: null, timedOut: true}}, "SELFTEST_LOOPBACK_PROBE_FAILED"],
        ["stdin is not forwarded (the very last step)", {stdin: "nothing\n"}, "SELFTEST_STDIN_NOT_FORWARDED"]
      ];
      for (const [name, script, detail] of cases) {
        const {p, st} = await run(script);
        if (!st.ok && PRE.test(st.detail ?? "")) return ctx.skip();
        expect([name, st.ok, st.detail]).toEqual([name, false, detail]);
        expect([name, p.capabilities]).toEqual([name, {loopback: false, loopbackReason: "NOT_PROBED"}]);
      }
    });

    it.skipIf(process.platform !== "linux")("node genuinely absent inside the sandbox (exit 127, no timeout) is verified WITHOUT loopback; the route and netns proofs still decide", { timeout: T }, async (ctx) => {
      const {p, st} = await run({lp: {stdout: "sh: node: not found\n", exitCode: 127}});
      if (!st.ok && PRE.test(st.detail ?? "")) return ctx.skip();
      expect(st.ok, JSON.stringify(st)).toBe(true);
      expect(p.capabilities.loopback).toBe(false);
      expect(["LOOPBACK_PROBE_NODE_UNAVAILABLE", "LOOPBACK_TOOL_MISSING"]).toContain(p.capabilities.loopbackReason);
    });
  });

  it.skipIf(!hostCanIsolate)("a real provider is verified, claims loopback only when it works, and nothing inside can reach the host loopback listener", { timeout: T2 }, async () => {
    const p = new LinuxUnshareSandboxProvider(procOpts);
    expect(p.capabilities).toEqual({loopback: false, loopbackReason: "NOT_PROBED"});
    const st = await p.selfTest();
    expect(st.ok, JSON.stringify(st)).toBe(true);
    expect(p.capabilities).toEqual(hostHasIp ? {loopback: true, loopbackReason: null} : {loopback: false, loopbackReason: "LOOPBACK_TOOL_MISSING"});
    const l = await hostListener(), ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-ws-"));
    try {
      const attempt = `require("net").connect({host:"127.0.0.1",port:${l.port},timeout:2000}).on("connect",()=>{console.log("CONNECTED");process.exit(0)}).on("error",()=>{console.log("BLOCKED");process.exit(0)}).on("timeout",()=>{console.log("BLOCKED");process.exit(0)})`;
      const r = await p.run([process.execPath, "-e", attempt], {cwd: ws, env: {PATH: LINUX_SANDBOX_HELPER_PATH}, timeoutMs: 30_000});
      expect([r.exitCode, r.stdout.trim()]).toEqual([0, "BLOCKED"]);
      expect(l.connections()).toBe(0);
      const rt = await p.run(["sh", "-c", "tail -n +2 /proc/net/route | wc -l"], {cwd: ws, env: {PATH: LINUX_SANDBOX_HELPER_PATH}, timeoutMs: 30_000});
      expect(rt.stdout.trim()).toBe("0");
    } finally { l.srv.close(); fs.rmSync(ws, {recursive: true, force: true}); }
  });

  it.skipIf(!canStub)("with an ip that really brings lo up the provider claims loopback and project code can listen and connect on 127.0.0.1; a no-op or failing ip leaves lo down and the provider unverified", { timeout: T2 }, async () => {
    await withStubIp(PERL_STUB, async () => {
      const p = new LinuxUnshareSandboxProvider(procOpts), st = await p.selfTest();
      expect(st.ok, JSON.stringify(st)).toBe(true);
      expect(p.capabilities).toEqual({loopback: true, loopbackReason: null});
      const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-lsx-ws-"));
      try {
        const both = 'const net=require("net");const s=net.createServer(c=>c.end("pong"));s.listen(0,"127.0.0.1",()=>{net.connect(s.address().port,"127.0.0.1").on("data",d=>{console.log(String(d));process.exit(0)})})';
        const r = await p.run([process.execPath, "-e", both], {cwd: ws, env: {PATH: LINUX_SANDBOX_HELPER_PATH}, timeoutMs: 30_000});
        expect([r.exitCode, r.stdout.trim()]).toEqual([0, "pong"]);
      } finally { fs.rmSync(ws, {recursive: true, force: true}); }
    });
    for (const [label, script] of [["a no-op ip", "#!/bin/sh\nexit 0\n"], ["a failing ip (|| true keeps the namespace alive)", "#!/bin/sh\nexit 1\n"]] as const) {
      await withStubIp(script, async () => {
        const p = new LinuxUnshareSandboxProvider(procOpts);
        expect([label, await p.selfTest()]).toEqual([label, {ok: false, detail: "SELFTEST_LOOPBACK_NOT_AVAILABLE"}]);
        expect(p.capabilities).toEqual({loopback: false, loopbackReason: "NOT_PROBED"});
      });
    }
    expect(fs.existsSync("/usr/sbin/ip")).toBe(false); // the stub never outlives the test
  });
});
