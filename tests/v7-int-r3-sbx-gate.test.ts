// //TR: Bu test SBX-GATE'i (Founder kararı FD-REL-1-REJECT-HOST-EXEC-2026-10-15) doğrular: doğrulanmış sandbox sağlayıcısı yoksa runner VERIFY/REGRESSION test komutu hiç çalışmaz (run BLOCKED SANDBOX_UNAVAILABLE, kanıt NOT_EXECUTED, yeniden deneme/remediation bütçesi tüketilmez), Studio dev-run start 409 SANDBOX_UNAVAILABLE döner ve süreç başlatılmaz; env değişkeni, API gövdesi, journal kaydı veya düz nesne sağlayıcı kaydedemez/taklit edemez; öz-testi geçmeyen sağlayıcı reddedilir. Yürütülen tek kod testin kendi sabit fikstürüdür ve yalnız enjekte edilen TEST sağlayıcısıyla çalışır.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
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
import type {SandboxProvider} from "../core/workos/execution-gate.js";
import {buildServer} from "../apps/control-api/src/server.js";
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
  it("blocks the run with SANDBOX_UNAVAILABLE, records NOT_EXECUTED evidence and never runs the test command (no retry/remediation budget used)", { timeout: T }, async () => {
    const marker = path.join(tmp, "verify-executed.flag"), c = setup(marker), f = fake();
    for (const k of SANDBOX_ENV) process.env[k] = "1";
    process.env.UASCO_SANDBOX_PROVIDER = "windows-sandbox";
    const created = startRun(c, f);
    // düz nesne "kapı" (izin taklidi) yok sayılır -> sağlayıcısız kapı
    const forged = {authorize: async (kind: string) => ({allowed: true, kind, providerId: "FORGED", provider: TEST_HOST_PASSTHROUGH_SANDBOX})} as unknown as ExecutionGate;
    await mkRunner(c, f, {executionGate: forged}).tick();
    const run = c.store.getRun({tenantId: "tA"}, created.runId)!;
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("SANDBOX_UNAVAILABLE");
    expect(run.step).toBe("VERIFY");
    expect(run.retryCount).toBe(0);
    expect(run.remediationCycle).toBe(0);
    expect(c.store.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("BLOCKED");
    expect(fs.existsSync(marker)).toBe(false);
    const ev = run.evidence.map(e => e.kind);
    expect(ev).toContain("VERIFY_TESTS_NOT_EXECUTED");
    expect(ev).not.toContain("VERIFY_TESTS");
    const ne = run.evidence.find(e => e.kind === "VERIFY_TESTS_NOT_EXECUTED")!;
    expect(ne.exitCode).toBeNull();
    expect(ne.note).toMatch(/^NOT_EXECUTED: SANDBOX_UNAVAILABLE \(NO_VERIFIED_PROVIDER\)/);
    expect(fs.readFileSync(path.join(c.dataDir, ne.logPath!), "utf8")).toContain("NOT_EXECUTED");
    // terminal: a later tick does nothing and still never executes
    await mkRunner(c, f).tick();
    expect(c.store.getRun({tenantId: "tA"}, created.runId)!.status).toBe("BLOCKED");
    expect(fs.existsSync(marker)).toBe(false);
  });
  it("a provider whose self-test fails is refused the same way; a verified (test) provider runs the command through the provider", { timeout: T }, async () => {
    const m1 = path.join(tmp, "selftest-failed.flag"), c1 = setup(m1), f1 = fake(), r1 = startRun(c1, f1);
    let runCalls = 0;
    const failing = new ExecutionGate(provider({selfTest: async () => ({ok: false, detail: "NETWORK_NOT_ISOLATED"}), run: async (a, o) => { runCalls++; return TEST_HOST_PASSTHROUGH_SANDBOX.run(a, o); }}));
    await mkRunner(c1, f1, {executionGate: failing}).tick();
    expect(c1.store.getRun({tenantId: "tA"}, r1.runId)!).toMatchObject({status: "BLOCKED", reason: "SANDBOX_UNAVAILABLE"});
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
  it("a mission run reaches VERIFY and is BLOCKED SANDBOX_UNAVAILABLE through the API (FAKE executors, no sandbox)", { timeout: T }, async () => {
    const marker = path.join(tmp, "api-executed.flag"), c = setup(marker), f = fake();
    const app = buildServer({controlToken: TOKEN, runtime: c.runtime, repoRoot: REPO, dataDir: c.dataDir, tenantId: "tA", port: 3210, logger: false, executors: f.pair(), runner: {enabled: true, intervalMs: 250, security: fakeSecurity(`${c.dataDir}-sec`).options}});
    apps.push(app);
    await app.ready();
    const started = await call(app, "POST", `/v1/missions/${c.missionId}/runs`, {idempotencyKey: "sbx-run-1"});
    expect(started.statusCode).toBe(201);
    const runId = started.json().run.runId;
    let run: any = null;
    for (let i = 0; i < 400 && (!run || !["BLOCKED", "FAILED", "AWAITING_APPROVAL"].includes(run.status)); i++) { await new Promise(r => setTimeout(r, 250)); run = (await call(app, "GET", `/v1/work-runs/${runId}`)).json().run; }
    expect(run).toMatchObject({status: "BLOCKED", reason: "SANDBOX_UNAVAILABLE", step: "VERIFY"});
    expect(run.evidence.map((e: any) => e.kind)).toContain("VERIFY_TESTS_NOT_EXECUTED");
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
