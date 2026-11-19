// //TR: DSK-T0008 P-A (Founder onayı 2026-11-18): kurulu uygulamada runner PASSIVE başlar (startMode MANUAL). Açılışta ve executor etkinleştirmesinde kendiliğinden başlamaz; yalnız POST /v1/system/runner/start ile ve etkin yürütücü LOCAL_CLAUDE + iki rol hazırken başlar. Gerçek model çağrılmaz: FakeExecutors çifti tür etiketi LOCAL_CLAUDE ile enjekte edilir; hazırlık mevcut testlerin tarifiyle (PASS provenance = node ikilisi, UASCO profilleri + kimlik dosyası varlığı) kurulur. AUTO kip (geliştirme/test) davranışı değişmez. tests/v7-b3a-runner.test.ts altında kayıtlı (tests-3).
import {describe, it, expect, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {buildServer} from "../../apps/control-api/src/server.js";
import {packagedServerOptions, packagedControlRoot} from "../../apps/control-api/src/packaged-entry.js";
import {ensureClaudeProfile, claudeProfileDir} from "../../core/workos/claude-profiles.js";

export function registerDskRunnerPassiveCases(): void {
 describe("DSK-T0008 P-A passive runner (MANUAL start mode)", () => {
  const TOKEN = "t".repeat(32);
  const apps: Array<{close: () => Promise<unknown>}> = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

  async function mk(o: {mode?: "AUTO" | "MANUAL"; kind?: "FAKE" | "LOCAL_CLAUDE"; ready?: boolean} = {}) {
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
    const pair = {...new FakeExecutors({implement: () => ({files: {"f.txt": "x\n"}}), review: () => ({verdict: "CLEAN"})}).pair(), kind: o.kind ?? "LOCAL_CLAUDE"};
    const app = buildServer({controlToken: TOKEN, runtime, dataDir: data, controlRoot: control, tenantId: "tA", port: 3210, logger: false, executors: pair as never,
      executorSetup: {findClaudeCli: () => process.execPath, captureProvenance: async () => ({ok: true})}, runner: {enabled: true, intervalMs: 600_000, startMode: o.mode ?? "MANUAL"}} as never);
    apps.push(app); await app.ready();
    const auth = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210", "content-type": "application/json"};
    const events = () => { const f = path.join(runtime, "control-api-events.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).map(e => String(e.event ?? e.type ?? "")) : []; };
    const runner = async () => (await app.inject({method: "GET", url: "/v1/system/executors", headers: auth})).json().runner;
    const start = async (payload: unknown = {}) => app.inject({method: "POST", url: "/v1/system/runner/start", headers: auth, payload: JSON.stringify(payload)});
    const enable = async () => app.inject({method: "POST", url: "/v1/system/executors/local-claude/enable", headers: auth, payload: "{}"});
    return {app, events, runner, start, enable};
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

  it("AUTO (default) keeps today's behaviour: started at boot, and start is refused as RUNNER_NOT_MANUAL", async () => {
    const s = await mk({mode: "AUTO", ready: true});
    expect(s.events()).toContain("WORKOS_RUNNER_STARTED");
    expect((await s.runner()).state).toBe("ACTIVE");
    const r = await s.start(); expect(r.statusCode).toBe(409); expect(r.json().reason).toBe("RUNNER_NOT_MANUAL");
  });
 });
}
