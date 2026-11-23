// //TR: DSK-T0008 P-A (Founder onayı 2026-11-18): kurulu uygulamada runner PASSIVE başlar (startMode MANUAL). Açılışta ve executor etkinleştirmesinde kendiliğinden başlamaz; yalnız POST /v1/system/runner/start ile ve etkin yürütücü LOCAL_CLAUDE + iki rol hazırken başlar. Gerçek model çağrılmaz: FakeExecutors çifti tür etiketi LOCAL_CLAUDE ile enjekte edilir; hazırlık mevcut testlerin tarifiyle (PASS provenance = node ikilisi, UASCO profilleri + kimlik dosyası varlığı) kurulur. AUTO kip (geliştirme/test) davranışı değişmez. tests/v7-b3a-runner.test.ts altında kayıtlı (tests-3).
import {describe, it, expect, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {buildServer} from "../../apps/control-api/src/server.js";
import {packagedServerOptions, packagedControlRoot} from "../../apps/control-api/src/packaged-entry.js";
import {ensureClaudeProfile, claudeProfileDir} from "../../core/workos/claude-profiles.js";
import {WorkOsStore} from "../../core/workos/store.js";
import {activateGlobalStop} from "../../automation/lib/global-stop.mjs";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {TEST_HOST_PASSTHROUGH_SANDBOX} from "./test-sandbox.js";
import {LocalClaudeExecutors, NOT_ISOLATED, FakeExecutors as FakeEx} from "../../core/workos/executors.js";
import {MissionRunner} from "../../core/workos/runner.js";
import {ExecutionGate} from "../../core/workos/execution-gate.js";
import {fakeSecurity} from "../../core/workos/security-tools.js";

export function registerDskRunnerPassiveCases(): void {
 describe("DSK-T0008 P-A passive runner (MANUAL start mode)", () => {
  const TOKEN = "t".repeat(32);
  const apps: Array<{close: () => Promise<unknown>}> = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

  async function mk(o: {mode?: "AUTO" | "MANUAL"; kind?: "FAKE" | "LOCAL_CLAUDE"; ready?: boolean; intervalMs?: number; policyContext?: Record<string, boolean>; counter?: {implement: number; review?: number}; sandbox?: boolean; isolated?: boolean} = {}) {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dsk-pa-"));
    const runtime = path.join(tmp, "runtime"), control = path.join(tmp, "control"), data = path.join(tmp, "data");
    for (const d of [runtime, control]) fs.mkdirSync(d, {recursive: true});
    if (o.ready) {
      const sha = crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");
      fs.mkdirSync(path.join(control, ".ai", "runtime"), {recursive: true});
      fs.writeFileSync(path.join(control, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: process.execPath, launcherSha256: sha, version: "fake"}}));
      for (const role of ["implementer", "reviewer"] as const) { ensureClaudeProfile(control, role, {forbiddenRoots: [data]}); fs.writeFileSync(path.join(claudeProfileDir(control, role), ".credentials.json"), ""); }
    }
    const {FakeExecutors} = await import("../../core/workos/executors.js");
    const counter = o.counter ?? {implement: 0, review: 0} as {implement: number; review?: number};
    // a test pair labelled LOCAL_CLAUDE; it is "isolated" only when the test says so (bound to the TEST provider id), like a future DSK-T0007 executor
    const pair = {...new FakeExecutors({implement: () => { counter.implement += 1; return {files: {"feature.txt": "ok\n"}}; }, review: () => { counter.review = (counter.review ?? 0) + 1; return {verdict: "CLEAN"}; }}).pair(), kind: o.kind ?? "LOCAL_CLAUDE",
      ...(o.isolated ? {isolation: {state: "ISOLATED", providerId: TEST_HOST_PASSTHROUGH_SANDBOX.id}} : {})};
    const app = buildServer({controlToken: TOKEN, runtime, dataDir: data, controlRoot: control, tenantId: "tA", port: 3210, logger: false, executors: pair as never,
      executorSetup: {findClaudeCli: () => process.execPath, captureProvenance: async () => ({ok: true})}, sandbox: o.sandbox ? TEST_HOST_PASSTHROUGH_SANDBOX : null, ...(o.policyContext ? {policyContext: o.policyContext} : {}),
      runner: {enabled: true, intervalMs: o.intervalMs ?? 600_000, startMode: o.mode ?? "MANUAL", retryBackoffMs: [0, 0]}} as never);
    apps.push(app); await app.ready();
    const auth = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210", "content-type": "application/json"};
    const events = () => { const f = path.join(runtime, "control-api-events.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).map(e => String(e.event ?? e.type ?? "")) : []; };
    const runner = async () => (await app.inject({method: "GET", url: "/v1/system/executors", headers: auth})).json().runner;
    const start = async (payload: unknown = {}) => app.inject({method: "POST", url: "/v1/system/runner/start", headers: auth, payload: JSON.stringify(payload)});
    const enable = async () => app.inject({method: "POST", url: "/v1/system/executors/local-claude/enable", headers: auth, payload: "{}"});
    // a real git project + authorized mission + queued run, written through the same journal the server reads
    const queueRun = (o2: {marker?: string; missionTo?: Array<"PREFLIGHT" | "AUTHORIZED">} = {}) => {
      const repo = path.join(tmp, `src-${crypto.randomBytes(3).toString("hex")}`); fs.mkdirSync(repo, {recursive: true});
      const git = (a: string[]) => { const r = spawnGitSync(repo, a); if (r.status !== 0) throw new Error(String(r.stderr)); };
      git(["init", "-q", "-b", "main"]); fs.writeFileSync(path.join(repo, "test.mjs"), o2.marker ? `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(o2.marker)}, "EXECUTED");\nprocess.exit(0);\n` : "process.exit(0);\n"); git(["add", "-A"]); git(["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "-m", "seed"]);
      const st = new WorkOsStore(data);
      const p = st.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
      const m = st.createMission({tenantId: "tA", projectId: p.projectId, title: "F", objective: "feature.txt says ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of o2.missionTo ?? (["PREFLIGHT", "AUTHORIZED"] as const)) st.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      lastRepo = repo;
      return st.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}).runId;
    };
    let lastRepo = "";
    const runOf = (id: string) => new WorkOsStore(data).getRun({tenantId: "tA"}, id)!;
    const stop = () => activateGlobalStop(path.join(runtime, "GLOBAL_STOP.json"), "test stop", "FOUNDER");
    return {app, events, runner, start, enable, queueRun, runOf, stop, counter, control, data, repo: () => lastRepo};
  }

  it("the packaged app runs the runner in MANUAL start mode", () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), "dsk-pa-ud-"));
    const cfg = {runtime: path.join(ud, "runtime"), dataDir: path.join(ud, "data"), port: 50000, userData: ud} as never;
    expect(packagedServerOptions(cfg, "a".repeat(64), packagedControlRoot(cfg)).runner).toEqual({enabled: true, startMode: "MANUAL"});
  });

  it("MANUAL: nothing starts at boot; the executors GET reports PASSIVE", async () => {
    const s = await mk({ready: true});
    expect(s.events().includes("WORKOS_RUNNER_STARTED")).toBe(false);
    expect(await s.runner()).toEqual({state: "PASSIVE", startMode: "MANUAL", reason: null, maxConcurrentRuns: null});
  });

  it("start is refused (409) while the profiles are not ready, and for a non-LOCAL_CLAUDE executor; the runner stays PASSIVE", async () => {
    const notReady = await mk({ready: false});
    const r1 = await notReady.start();
    expect(r1.statusCode).toBe(409); expect(r1.json()).toMatchObject({error: "RUNNER_START_REFUSED", reason: "EXECUTOR_NOT_READY"});
    expect(r1.json().blockers).toEqual(["IMPLEMENTER_NOT_READY", "REVIEWER_NOT_READY"]);
    expect((await notReady.runner()).state).toBe("PASSIVE");
    expect(notReady.events()).toContain("WORKOS_RUNNER_START_REFUSED");
    const fake = await mk({ready: true, kind: "FAKE"});
    const r2 = await fake.start();
    expect(r2.statusCode).toBe(409); expect(r2.json().blockers).toEqual(["EXECUTOR_NOT_READY:FAKE"]);
  });

  it("start with a non-empty body is rejected by the write gate (400) and starts nothing", async () => {
    const s = await mk({ready: true});
    expect((await s.start({force: true})).statusCode).toBe(400);
    expect((await s.runner()).state).toBe("PASSIVE");
  });

  it("enabling the executor in MANUAL mode does not start the runner; start then succeeds (ACTIVE) and a second start is idempotent", async () => {
    const s = await mk({ready: true});
    expect((await s.enable()).statusCode).toBe(200);
    expect(s.events().includes("WORKOS_RUNNER_STARTED")).toBe(false);
    expect((await s.runner()).state).toBe("PASSIVE");
    const r = await s.start();
    expect(r.statusCode).toBe(200); expect(r.json().runner).toMatchObject({state: "ACTIVE", startMode: "MANUAL", maxConcurrentRuns: 1});
    expect(s.events()).toContain("WORKOS_RUNNER_STARTED");
    expect((await s.start()).json().runner.state).toBe("ACTIVE");
  });

  const until = async (cond: () => boolean, ms = 60_000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await new Promise(r => setTimeout(r, 100)); } };

  it("PASSIVE never leases or executes a queued run, even with the executor enabled", async () => {
    const s = await mk({ready: true, intervalMs: 250});
    expect((await s.enable()).statusCode).toBe(200);
    const id = s.queueRun();
    await new Promise(r => setTimeout(r, 1200));
    expect(s.runOf(id)).toMatchObject({status: "QUEUED", leaseId: null, attempt: 0});
    expect(s.counter.implement).toBe(0);
  });

  it("Global Stop: start is refused with 423 and the runner stays PASSIVE", async () => {
    const s = await mk({ready: true});
    expect((await s.enable()).statusCode).toBe(200);
    s.stop();
    const r = await s.start();
    expect(r.statusCode).toBe(423); expect(r.json().error).toBe("GLOBAL_STOP_ACTIVE");
    expect((await s.runner()).state).toBe("PASSIVE");
    expect(s.events()).not.toContain("WORKOS_RUNNER_STARTED");
  });

  it("a denied action policy refuses start with 403 (write gate), nothing starts", async () => {
    const s = await mk({ready: true, policyContext: {scopeAllowed: false}});
    const r = await s.start();
    expect(r.statusCode).toBe(403); expect(r.json().error).toBe("ACTION_DENIED");
    expect((await s.runner()).state).toBe("PASSIVE");
  });

  it("an unverified launcher (provenance hash no longer matches) refuses start; one missing sign-in names only that role", async () => {
    const s = await mk({ready: true});
    expect((await s.enable()).statusCode).toBe(200);
    const pf = path.join(s.control, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), prov = JSON.parse(fs.readFileSync(pf, "utf8"));
    fs.writeFileSync(pf, JSON.stringify({...prov, claude: {...prov.claude, launcherSha256: "0".repeat(64)}}));
    const r = await s.start();
    expect(r.statusCode).toBe(409); expect(r.json().blockers).toEqual(["IMPLEMENTER_NOT_READY", "REVIEWER_NOT_READY"]);
    const s2 = await mk({ready: true});
    expect((await s2.enable()).statusCode).toBe(200);
    fs.rmSync(path.join(claudeProfileDir(s2.control, "reviewer"), ".credentials.json"));
    const r2 = await s2.start();
    expect(r2.statusCode).toBe(409); expect(r2.json().blockers).toEqual(["REVIEWER_NOT_READY"]);
    expect((await s2.runner()).state).toBe("PASSIVE");
  });

  const waitTicks = () => new Promise(r => setTimeout(r, 1500));
  const unleased = (s: Awaited<ReturnType<typeof mk>>, id: string) => expect(s.runOf(id)).toMatchObject({status: "QUEUED", leaseId: null, attempt: 0});

  it("STRICT SANDBOX: with no verified sandbox an ACTIVE runner leases nothing (SANDBOX_REQUIRED): zero executor calls, zero host changes, zero delivery", { timeout: 120_000 }, async () => {
    const s = await mk({ready: true, intervalMs: 250, isolated: true});
    expect((await s.enable()).statusCode).toBe(200);
    const marker = path.join(s.control, "..", "PROJECT_CODE_EXECUTED"), id = s.queueRun({marker});
    const repo = s.repo(), headBefore = String(spawnGitSync(repo, ["rev-parse", "HEAD"]).stdout).trim();
    expect((await s.start()).json().runner.state).toBe("ACTIVE");
    await waitTicks();
    unleased(s, id);
    expect(s.counter.implement).toBe(0); expect(s.counter.review ?? 0).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    expect(String(spawnGitSync(repo, ["rev-parse", "HEAD"]).stdout).trim()).toBe(headBefore);
    expect(String(spawnGitSync(repo, ["status", "--porcelain"]).stdout).trim()).toBe("");
    expect(fs.existsSync(path.join(s.data, "deliveries"))).toBe(false);
    expect(fs.existsSync(path.join(s.data, "runs", id))).toBe(false); // not even a workspace clone
  });

  it("STRICT SANDBOX: a verified sandbox alone is not enough — an executor that spawns on the host stays NOT_ISOLATED and leases nothing", { timeout: 120_000 }, async () => {
    const s = await mk({ready: true, intervalMs: 250, sandbox: true, isolated: false});
    expect((await s.app.inject({method: "GET", url: "/v1/system/executors", headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json().sandbox.state).toBe("AVAILABLE");
    expect((await s.enable()).statusCode).toBe(200);
    const id = s.queueRun();
    expect((await s.start()).statusCode).toBe(200);
    await waitTicks();
    unleased(s, id);
    expect(s.counter.implement).toBe(0);
  });

  it("STRICT SANDBOX positive path (test-only isolated executor bound to the verified TEST provider): the run is leased and executed", { timeout: 120_000 }, async () => {
    const s = await mk({ready: true, intervalMs: 250, sandbox: true, isolated: true});
    expect((await s.enable()).statusCode).toBe(200);
    const id = s.queueRun();
    expect((await s.start()).statusCode).toBe(200);
    await until(() => ["AWAITING_APPROVAL", "SUCCEEDED", "FAILED", "BLOCKED"].includes(s.runOf(id).status));
    expect(s.counter.implement).toBe(1);
  });

  it("REVALIDATION: if isolation is lost after the lease (e.g. recovery onto a host without the provider), IMPLEMENT is refused before the model runs", { timeout: 120_000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dsk-reval-")), repo = path.join(tmp, "repo"), data = path.join(tmp, "data"); fs.mkdirSync(repo);
    const git = (a: string[]) => { const r = spawnGitSync(repo, a); if (r.status !== 0) throw new Error(String(r.stderr)); };
    git(["init", "-q", "-b", "main"]); fs.writeFileSync(path.join(repo, "test.mjs"), "process.exit(0);\n"); git(["add", "-A"]); git(["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "-m", "s"]);
    let calls = 0;
    const pair: any = {...new FakeEx({implement: () => { calls += 1; return {files: {"feature.txt": "ok\n"}}; }, review: () => ({verdict: "CLEAN"})}).pair(), kind: "LOCAL_CLAUDE", isolation: {state: "ISOLATED", providerId: TEST_HOST_PASSTHROUGH_SANDBOX.id}};
    const st = new WorkOsStore(data);
    const p = st.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
    const m = st.createMission({tenantId: "tA", projectId: p.projectId, title: "F", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) st.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    const id = st.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}).runId;
    const gate = new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX); await gate.status(); // settle the self-test so the synchronous snapshot is AVAILABLE
    const r = new MissionRunner({executionGate: gate, store: st, dataDir: data, globalStopFile: path.join(tmp, "GLOBAL_STOP.json"), envPolicyFile: path.resolve(import.meta.dirname, "..", "..", "config", "environment-policy.json"),
      executors: pair, maxStepsPerTick: 1, retryBackoffMs: [0, 0], security: fakeSecurity(`${data}-sec`).options});
    expect(r.isolationRefusal()).toBe(null);
    expect((await r.tick()).claimed).toEqual([id]); // leased; WORKSPACE step done (no model)
    pair.isolation = {state: "NOT_ISOLATED", reason: "HOST_SPAWN"};
    expect(r.isolationRefusal()).toBe("NOT_ISOLATED");
    await r.tick();
    const run = st.getRun({tenantId: "tA"}, id)!;
    expect(run.status).toBe("BLOCKED"); expect(run.reason).toContain("NOT_ISOLATED");
    expect(calls).toBe(0);
    await r.stop();
  });

  it("the synchronous gate snapshot is fail-closed until the self-test settled, and a failing self-test is never AVAILABLE", async () => {
    const g = new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX);
    expect(g.snapshot()).toEqual({ok: false, providerId: null});
    await g.status(); expect(g.snapshot()).toEqual({ok: true, providerId: TEST_HOST_PASSTHROUGH_SANDBOX.id});
    const bad = new ExecutionGate({...TEST_HOST_PASSTHROUGH_SANDBOX, id: "BAD", selfTest: async () => ({ok: false})});
    await bad.status(); expect(bad.snapshot().ok).toBe(false);
    expect(new ExecutionGate(null).snapshot().ok).toBe(false);
  });

  it("DSK-T0007 routing: with a gate whose provider PASSED its self-test, all three model processes start through that provider (never a host fork/spawn); a failed self-test leaves the executor NOT_ISOLATED", { timeout: 60_000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dsk-route-")), control = path.join(tmp, "control"), data = path.join(tmp, "data");
    const sha = crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");
    fs.mkdirSync(path.join(control, ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(control, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: process.execPath, launcherSha256: sha, version: "fake"}}));
    for (const role of ["implementer", "reviewer"] as const) { ensureClaudeProfile(control, role, {forbiddenRoots: [data]}); fs.writeFileSync(path.join(claudeProfileDir(control, role), ".credentials.json"), ""); }
    const ws = path.join(tmp, "ws"); fs.mkdirSync(ws); for (const a of [["init", "-q", "-b", "main"], ["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "--allow-empty", "-m", "s"]]) spawnGitSync(ws, a);
    const calls: Array<{argv: string[]; cwd: string; env: string[]}> = [];
    const recording = {id: "RECORDING_PROVIDER", async selfTest() { return {ok: true}; },
      async run(argv: string[], o: {cwd: string; env: NodeJS.ProcessEnv}) { calls.push({argv, cwd: o.cwd, env: Object.keys(o.env)}); const at = new Date().toISOString(); return {argv, exitCode: 1, stdout: "", stderr: "recorded", startedAt: at, endedAt: at, timedOut: false, aborted: false, spawnError: false}; },
      spawn() { throw new Error("spawn must not be used"); }};
    const gate = new ExecutionGate(recording as never); await gate.status();
    const ex = new LocalClaudeExecutors(path.resolve(import.meta.dirname, "..", ".."), control, {isolationGate: gate, profile: {forbiddenRoots: [data]}});
    expect(ex.isolation).toEqual({state: "ISOLATED", providerId: "RECORDING_PROVIDER"});
    const pair = ex.pair();
    const spec = {runId: "run_" + "0".repeat(24), missionId: "msn_" + "1".repeat(24), projectId: "prj_" + "2".repeat(24), title: "t", objective: "o", acceptanceCriteria: ["a"], startSha: String(spawnGitSync(ws, ["rev-parse", "HEAD"]).stdout).trim()} as never;
    await pair.implementer.implement(ws, spec, {timeoutMs: 5000});
    await pair.reviewer.review(ws, spec, "", {timeoutMs: 5000});
    await pair.preDevBuilder!().produce("BusinessAnalysis" as never, "Analyse the mission.", {} as never).catch(() => null);
    expect(calls.length).toBe(3);
    expect(calls[0].argv[0]).toBe(process.execPath); expect(calls[0].argv[1]).toMatch(/claude-builder-broker\.mjs$/); expect(calls[0].cwd).toBe(ws);
    expect(calls[1].argv[0]).toBe(process.execPath); // the provenance-verified launcher (here: the node binary fixture)
    expect(calls[2].argv[0]).toBe(process.execPath);
    for (const c of calls) { expect(c.env).not.toContain("ANTHROPIC_API_KEY"); expect(c.env).toContain("CLAUDE_CONFIG_DIR"); }
    // a provider whose self-test fails gives no isolation and no process
    const failing = new ExecutionGate({...recording, id: "FAILING", async selfTest() { return {ok: false}; }} as never); await failing.status();
    const ex2 = new LocalClaudeExecutors(path.resolve(import.meta.dirname, "..", ".."), control, {isolationGate: failing, profile: {forbiddenRoots: [data]}});
    expect(ex2.isolation.state).toBe("NOT_ISOLATED");
    const before = calls.length;
    expect((await ex2.pair().implementer.implement(ws, spec, {timeoutMs: 5000})).blockReason).toBe(NOT_ISOLATED);
    expect(calls.length).toBe(before);
  });

  // ---- Founder review 2026-11-23: isolation lifecycle (no stale construction-time snapshot) ----
  const iso = (o: {selfTest: () => Promise<{ok: boolean}>; id?: string; linuxGuest?: boolean; map?: any}) => {
    const calls: string[][] = [];
    const prov: any = {id: o.id ?? "RECORDING_PROVIDER", selfTest: o.selfTest, spawn() { throw new Error("no spawn"); }, ...(o.linuxGuest ? {linuxGuest: true} : {}), ...(o.map ? {mapModelProcess: o.map} : {}),
      async run(argv: string[]) { calls.push(argv); const at = new Date().toISOString(); return {argv, exitCode: 1, stdout: "", stderr: "", startedAt: at, endedAt: at, timedOut: false, aborted: false, spawnError: false}; }};
    return {prov, calls};
  };
  const rig = () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dsk-life-")), control = path.join(tmp, "control"), data = path.join(tmp, "data");
    const sha = crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");
    fs.mkdirSync(path.join(control, ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(control, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: process.execPath, launcherSha256: sha, version: "fake"}}));
    for (const role of ["implementer", "reviewer"] as const) { ensureClaudeProfile(control, role, {forbiddenRoots: [data]}); fs.writeFileSync(path.join(claudeProfileDir(control, role), ".credentials.json"), ""); }
    const ws = path.join(tmp, "ws"); fs.mkdirSync(ws); for (const a of [["init", "-q", "-b", "main"], ["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "--allow-empty", "-m", "s"]]) spawnGitSync(ws, a);
    const spec = {runId: "run_" + "0".repeat(24), missionId: "msn_" + "1".repeat(24), projectId: "prj_" + "2".repeat(24), title: "t", objective: "o", acceptanceCriteria: ["a"], startSha: String(spawnGitSync(ws, ["rev-parse", "HEAD"]).stdout).trim()} as never;
    return {control, data, ws, spec, repo: path.resolve(import.meta.dirname, "..", "..")};
  };

  it("LIFECYCLE: a pair built BEFORE the self-test settles becomes eligible once it passes, without rebuilding the pair; the runner sees it", async () => {
    const r = rig(); let release!: () => void; const gateOpen = new Promise<void>(res => { release = res; });
    const {prov, calls} = iso({selfTest: async () => { await gateOpen; return {ok: true}; }});
    const gate = new ExecutionGate(prov);
    const pair = new LocalClaudeExecutors(r.repo, r.control, {isolationGate: gate, profile: {forbiddenRoots: [r.data]}}).pair();
    const runner = new MissionRunner({executionGate: gate, store: new WorkOsStore(r.data), dataDir: r.data, globalStopFile: path.join(r.data, "..", "STOP.json"), envPolicyFile: path.join(r.repo, "config", "environment-policy.json"), executors: pair, security: fakeSecurity(`${r.data}-sec`).options});
    expect(pair.isolation?.state).toBe("NOT_ISOLATED"); expect(runner.isolationRefusal()).toBe("SANDBOX_REQUIRED");
    expect((await pair.implementer.implement(r.ws, r.spec, {timeoutMs: 2000})).blockReason).toBe(NOT_ISOLATED); expect(calls).toEqual([]);
    release(); await gate.status();
    expect(pair.isolation).toEqual({state: "ISOLATED", providerId: "RECORDING_PROVIDER"}); // same object, live value
    expect(runner.isolationRefusal()).toBe(null);
    await pair.implementer.implement(r.ws, r.spec, {timeoutMs: 2000}); expect(calls.length).toBe(1);
    await runner.stop();
  });

  it("LIFECYCLE: a failing, throwing or never-settling self-test keeps every real-model path closed", async () => {
    const r = rig();
    for (const st of [async () => ({ok: false}), async () => { throw new Error("x"); }, () => new Promise<{ok: boolean}>(() => {})]) {
      const {prov, calls} = iso({selfTest: st as never}); const gate = new ExecutionGate(prov); void gate.status(); await new Promise(res => setTimeout(res, 20));
      const pair = new LocalClaudeExecutors(r.repo, r.control, {isolationGate: gate, profile: {forbiddenRoots: [r.data]}}).pair();
      expect(pair.isolation?.state).toBe("NOT_ISOLATED");
      expect((await pair.implementer.implement(r.ws, r.spec, {timeoutMs: 2000})).blockReason).toBe(NOT_ISOLATED);
      expect((await pair.reviewer.review(r.ws, r.spec, "", {timeoutMs: 2000})).invalidReason).toBe(NOT_ISOLATED);
      expect(await pair.preDevBuilder!().produce("BusinessAnalysis" as never, "x", {} as never).then(() => null, (e: {detail?: string}) => e.detail)).toBe(NOT_ISOLATED);
      expect(calls).toEqual([]);
    }
  });

  it("TEST OVERRIDE cannot bypass production isolation: ignored next to a real gate, refused without the TEST_ONLY_ prefix, never referenced by production code", async () => {
    const r = rig(), {prov} = iso({selfTest: async () => ({ok: false})}), gate = new ExecutionGate(prov); await gate.status();
    expect(new LocalClaudeExecutors(r.repo, r.control, {isolationGate: gate, testOnlyIsolationProviderId: "TEST_ONLY_HOST_PASSTHROUGH"}).isolation.state).toBe("NOT_ISOLATED");
    expect(new LocalClaudeExecutors(r.repo, r.control, {testOnlyIsolationProviderId: "linux-unshare-v2"}).isolation.state).toBe("NOT_ISOLATED");
    expect(new LocalClaudeExecutors(r.repo, r.control, {testOnlyIsolationProviderId: "TEST_ONLY_HOST_PASSTHROUGH"}).isolation.state).toBe("ISOLATED");
    // a production gate never carries a TEST_ONLY_ provider, so the runner's id match fails even if the override were set
    const scan = (d: string): string[] => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.name === "node_modules" ? [] : e.isDirectory() ? scan(path.join(d, e.name)) : /\.(ts|mts|mjs|js)$/.test(e.name) ? [path.join(d, e.name)] : []);
    const users = ["apps", "core", "scripts", "automation"].flatMap(d => scan(path.join(r.repo, d))).filter(f => fs.readFileSync(f, "utf8").includes("testOnlyIsolationProviderId"));
    expect(users.map(f => path.relative(r.repo, f).replace(/\\/g, "/"))).toEqual(["core/workos/executors.ts"]);
  });

  it("WSL BOUNDARY: Windows paths never reach a Linux guest; an unmapped WSL provider starts nothing, a mapper's Linux paths are passed through", async () => {
    const {windowsPathIn} = await import("../../core/workos/executors.js");
    expect(windowsPathIn({argv: ["C:\\Program Files\\nodejs\\node.exe"], cwd: "/w", env: {}})).toBe("WINDOWS_PATH_IN_ARGV");
    expect(windowsPathIn({argv: ["/usr/bin/node"], cwd: "C:/Users/f/run", env: {}})).toBe("WINDOWS_PATH_IN_CWD");
    expect(windowsPathIn({argv: ["/usr/bin/node"], cwd: "/w", env: {CLAUDE_CONFIG_DIR: "C:\\Users\\f\\.uasco\\implementer"}})).toBe("WINDOWS_PATH_IN_ENV_CLAUDE_CONFIG_DIR");
    expect(windowsPathIn({argv: ["/usr/bin/node", "/opt/uasco/broker.mjs"], cwd: "/work", env: {HOME: "/home/uasco", CLAUDE_CONFIG_DIR: "/profiles/implementer"}})).toBe(null);
    const r = rig();
    // a guest-Linux provider without a mapper: the host paths (this host's node binary path is treated as foreign by the WSL id) are refused unless they are Linux paths; simulate a Windows host path
    const win = iso({selfTest: async () => ({ok: true}), id: "wsl-test", linuxGuest: true, map: (argv: string[], o: {cwd: string; env: NodeJS.ProcessEnv}) => ({argv: ["C:\\node.exe", ...argv.slice(1)], cwd: o.cwd, env: o.env})});
    const g1 = new ExecutionGate(win.prov); await g1.status();
    const p1 = new LocalClaudeExecutors(r.repo, r.control, {isolationGate: g1, profile: {forbiddenRoots: [r.data]}}).pair();
    const out = await p1.implementer.implement(r.ws, r.spec, {timeoutMs: 2000});
    expect(out.exitCode).toBe(null); expect(win.calls).toEqual([]);
    const ok = iso({selfTest: async () => ({ok: true}), id: "wsl-test", linuxGuest: true, map: (argv: string[], o: {cwd: string; env: NodeJS.ProcessEnv}) => ({argv: ["/usr/bin/node", "/opt/uasco/" + path.basename(argv[1] ?? "x")], cwd: "/work", env: {...Object.fromEntries(Object.entries(o.env).filter(([k]) => k !== "CLAUDE_CONFIG_DIR" && k !== "HOME" && k !== "PATH")), HOME: "/home/uasco", CLAUDE_CONFIG_DIR: "/profiles/implementer", PATH: "/usr/bin:/bin"}})});
    const g2 = new ExecutionGate(ok.prov); await g2.status();
    await new LocalClaudeExecutors(r.repo, r.control, {isolationGate: g2, profile: {forbiddenRoots: [r.data]}}).pair().implementer.implement(r.ws, r.spec, {timeoutMs: 2000});
    expect(ok.calls).toEqual([["/usr/bin/node", "/opt/uasco/claude-builder-broker.mjs"]]);
  });

  it("PRODUCTION executor: LocalClaudeExecutors is NOT_ISOLATED and refuses all three real-model paths at the source, before any process starts", async () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "dsk-iso-")), calls: string[][] = [];
    const ex = new LocalClaudeExecutors(path.resolve(import.meta.dirname, "..", ".."), tmp, {runReviewer: async argv => { calls.push(argv); throw new Error("must not run"); }});
    expect(ex.isolation).toEqual({state: "NOT_ISOLATED", reason: "HOST_SPAWN"});
    const pair = ex.pair(); expect(pair.isolation).toEqual({state: "NOT_ISOLATED", reason: "HOST_SPAWN"});
    const spec = {runId: "run_" + "0".repeat(24), missionId: "msn_" + "1".repeat(24), projectId: "prj_" + "2".repeat(24), title: "t", objective: "o", acceptanceCriteria: ["a"], startSha: "a".repeat(40)} as never;
    const ws = path.join(tmp, "ws"); fs.mkdirSync(ws); spawnGitSync(ws, ["init", "-q", "-b", "main"]); fs.writeFileSync(path.join(ws, "a.txt"), "a\n"); spawnGitSync(ws, ["add", "-A"]); spawnGitSync(ws, ["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "-m", "s"]);
    const impl = await pair.implementer.implement(ws, spec, {timeoutMs: 1000});
    expect(impl.blockReason).toBe(NOT_ISOLATED); expect(impl.exitCode).toBe(null);
    const rv = await pair.reviewer.review(ws, spec, "", {timeoutMs: 1000});
    expect(rv).toMatchObject({verdict: "BLOCKED", valid: false, invalidReason: NOT_ISOLATED});
    const pre = await pair.preDevBuilder!().produce("BusinessAnalysis" as never, "Analyse the mission.", {} as never).then(() => null, (e: {code?: string; detail?: string}) => e);
    expect(pre).toMatchObject({code: "PREDEV_BUILDER_PROVENANCE_REFUSED", detail: NOT_ISOLATED});
    expect(calls).toEqual([]);
  });

  it("cancellation: after start, Global Stop cancels a queued run before any executor call", { timeout: 120_000 }, async () => {
    const s = await mk({ready: true, intervalMs: 250});
    expect((await s.enable()).statusCode).toBe(200);
    expect((await s.start()).statusCode).toBe(200);
    s.stop();
    const id = s.queueRun();
    await until(() => s.runOf(id).status !== "QUEUED");
    expect(s.runOf(id).status).toMatch(/^(CANCELLED|CANCELLING)$/);
    expect(s.counter.implement).toBe(0);
  });

  it("AUTO (default) keeps today's behaviour: started at boot, and start is refused as RUNNER_NOT_MANUAL", async () => {
    const s = await mk({mode: "AUTO", ready: true});
    expect(s.events()).toContain("WORKOS_RUNNER_STARTED");
    expect((await s.runner()).state).toBe("ACTIVE");
    const r = await s.start(); expect(r.statusCode).toBe(409); expect(r.json().reason).toBe("RUNNER_NOT_MANUAL");
  });
 });
}
