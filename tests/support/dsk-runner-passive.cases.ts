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

export function registerDskRunnerPassiveCases(): void {
 describe("DSK-T0008 P-A passive runner (MANUAL start mode)", () => {
  const TOKEN = "t".repeat(32);
  const apps: Array<{close: () => Promise<unknown>}> = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

  async function mk(o: {mode?: "AUTO" | "MANUAL"; kind?: "FAKE" | "LOCAL_CLAUDE"; ready?: boolean; intervalMs?: number; policyContext?: Record<string, boolean>; counter?: {implement: number}} = {}) {
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
    const counter = o.counter ?? {implement: 0};
    const pair = {...new FakeExecutors({implement: () => { counter.implement += 1; return {files: {"feature.txt": "ok\n"}}; }, review: () => ({verdict: "CLEAN"})}).pair(), kind: o.kind ?? "LOCAL_CLAUDE"};
    const app = buildServer({controlToken: TOKEN, runtime, dataDir: data, controlRoot: control, tenantId: "tA", port: 3210, logger: false, executors: pair as never,
      executorSetup: {findClaudeCli: () => process.execPath, captureProvenance: async () => ({ok: true})}, sandbox: null, ...(o.policyContext ? {policyContext: o.policyContext} : {}),
      runner: {enabled: true, intervalMs: o.intervalMs ?? 600_000, startMode: o.mode ?? "MANUAL", retryBackoffMs: [0, 0]}} as never);
    apps.push(app); await app.ready();
    const auth = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210", "content-type": "application/json"};
    const events = () => { const f = path.join(runtime, "control-api-events.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).map(e => String(e.event ?? e.type ?? "")) : []; };
    const runner = async () => (await app.inject({method: "GET", url: "/v1/system/executors", headers: auth})).json().runner;
    const start = async (payload: unknown = {}) => app.inject({method: "POST", url: "/v1/system/runner/start", headers: auth, payload: JSON.stringify(payload)});
    const enable = async () => app.inject({method: "POST", url: "/v1/system/executors/local-claude/enable", headers: auth, payload: "{}"});
    // a real git project + authorized mission + queued run, written through the same journal the server reads
    const queueRun = () => {
      const repo = path.join(tmp, `src-${crypto.randomBytes(3).toString("hex")}`); fs.mkdirSync(repo, {recursive: true});
      const git = (a: string[]) => { const r = spawnGitSync(repo, a); if (r.status !== 0) throw new Error(String(r.stderr)); };
      git(["init", "-q", "-b", "main"]); fs.writeFileSync(path.join(repo, "test.mjs"), "process.exit(0);\n"); git(["add", "-A"]); git(["-c", "user.name=S", "-c", "user.email=s@local.invalid", "commit", "-q", "-m", "seed"]);
      const st = new WorkOsStore(data);
      const p = st.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
      const m = st.createMission({tenantId: "tA", projectId: p.projectId, title: "F", objective: "feature.txt says ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) st.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      return st.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}).runId;
    };
    const runOf = (id: string) => new WorkOsStore(data).getRun({tenantId: "tA"}, id)!;
    const stop = () => activateGlobalStop(path.join(runtime, "GLOBAL_STOP.json"), "test stop", "FOUNDER");
    return {app, events, runner, start, enable, queueRun, runOf, stop, counter, control};
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

  it("no verified sandbox: start is allowed, but the run's tests are NOT_EXECUTED and it stops at AWAITING_APPROVAL (never SUCCEEDED)", { timeout: 120_000 }, async () => {
    const s = await mk({ready: true, intervalMs: 250});
    expect((await s.app.inject({method: "GET", url: "/v1/system/executors", headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json().sandbox.state).toBe("UNAVAILABLE");
    expect((await s.enable()).statusCode).toBe(200);
    const id = s.queueRun();
    expect((await s.start()).statusCode).toBe(200);
    await until(() => ["AWAITING_APPROVAL", "SUCCEEDED", "FAILED", "BLOCKED"].includes(s.runOf(id).status));
    const run = s.runOf(id);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.evidence.map(e => e.kind)).toContain("VERIFY_TESTS_NOT_EXECUTED");
    expect(run.completion).toBeUndefined();
    expect(s.counter.implement).toBe(1);
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
