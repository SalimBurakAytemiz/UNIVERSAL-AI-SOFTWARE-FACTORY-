// //TR: Bu test PS-1A c2 düzeltmelerini gerçek geçici dizin/git ve gerçek alt süreçlerle doğrular (ağ yok, AI sağlayıcı yok): PS1A-C1-F1 (yönetilmeyen/veri dizinine işaret eden repository.path ile tenant izolasyonunun aşılamaması), PS1A-C1-F2 (start beklerken stop/stopAll/GLOBAL_STOP gelirse süreç başlatılmaz, sızıntı yok) ve PS1A-C1-F3 (sahip API pid'i yeniden kullanılmışsa sahip canlı sayılmaz; dosyadan okunan önizleme maskelenir).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./support/test-sandbox.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {activateGlobalStop, clearGlobalStop} from "../automation/lib/global-stop.mjs";
import {buildServer} from "../apps/control-api/src/server.js";
import type {BuildServerOptions} from "../apps/control-api/src/server.js";
import {WorkOsStore} from "../core/workos/store.js";
import {ProjectStudio, StudioError} from "../core/workos/project-studio.js";
import {DevRunManager, freeLoopbackPort, killProcessTree, pidAlive, processStartTime} from "../core/workos/devrun.js";
import type {Project} from "../core/workos/types.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
// Token çalışma anında üretilir; repoda gerçek secret yoktur.
const TOKEN = `tok-${crypto.randomBytes(16).toString("hex")}`;
const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
type App = ReturnType<typeof buildServer>;
let tmp = "", ext = "";
const apps: App[] = [];
const procs: cp.ChildProcess[] = [];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ps1a-c2-"));
  ext = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ps1a-c2-ext-"));
});
afterEach(async () => {
  for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
  for (const p of procs.splice(0)) { if (p.pid && p.exitCode === null) killProcessTree(p.pid); }
  for (const d of [tmp, ext]) { try { fs.rmSync(d, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } }
});

function mk(o: {tenantId?: string; dataDir?: string; runtime?: string; extra?: Partial<BuildServerOptions>} = {}) {
  const runtime = o.runtime ?? path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
  const dataDir = o.dataDir ?? path.join(tmp, "data");
  const app = buildServer({sandbox: TEST_HOST_PASSTHROUGH_SANDBOX, controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, port: 3210, logger: false, tenantId: o.tenantId ?? "tA",
    studio: {devrun: {probeIntervalMs: 150, stopPollMs: 150}}, ...(o.extra ?? {})});
  apps.push(app);
  return {app, runtime, dataDir};
}
const call = (app: App, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({method, url, headers: HDR, ...(payload !== undefined ? {payload: payload as object} : {})});
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function createProject(app: App, extra: Record<string, unknown> = {}) {
  const r = await call(app, "POST", "/v1/projects", {name: "Studio App", environmentId: "dev", ...extra});
  expect(r.statusCode, r.body).toBe(201);
  return r.json().project as Project;
}
const devrun = async (app: App, id: string) => (await call(app, "GET", `/v1/projects/${id}/devrun`)).json().devrun;
const idle = () => { const c = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore", windowsHide: true}); procs.push(c); return c.pid!; };

describe("PS1A-C1-F1: Studio routes only act on the project's own managed repository", () => {
  it("refuses repository.path inside/above dataDir at creation and every Studio route on a non-managed or foreign repository", async () => {
    const b = mk({tenantId: "tB"});
    const pb = await createProject(b.app, {template: "web-node"});
    const bRepo = pb.repository!.path!;
    const a = mk({tenantId: "tA", dataDir: b.dataDir, runtime: b.runtime});
    // Oluşturma: veri dizini, projects kökü, B'nin yönetilen deposu/proje dizini/dosyası ve veri dizininin üstü reddedilir.
    const forbidden = [b.dataDir, path.join(b.dataDir, "projects"), path.join(b.dataDir, "projects", pb.projectId), bRepo, path.join(bRepo, "README.md"), tmp, path.join(b.dataDir, "journal-does-not-exist")];
    for (const p of forbidden) {
      const r = await call(a.app, "POST", "/v1/projects", {name: "X", environmentId: "dev", repository: {path: p}});
      expect(r.statusCode, p).toBe(400);
      expect(r.json(), p).toEqual({error: "REPOSITORY_PATH_FORBIDDEN"});
    }
    expect((await call(a.app, "GET", "/v1/projects")).json().projects).toEqual([]);
    // Dışarıdaki (yönetilmeyen) depo kaydedilebilir ama hiçbir Studio route'u onu okuyamaz/çalıştıramaz/export edemez.
    fs.writeFileSync(path.join(ext, "README.md"), "external\n");
    fs.writeFileSync(path.join(ext, "server.js"), "require('http').createServer((q, r) => r.end('x')).listen(+process.env.PORT, '127.0.0.1');\n");
    git(ext, ["init", "-q", "-b", "main"]); git(ext, ["add", "-A"]); git(ext, ["-c", "user.name=T", "-c", "user.email=t@local.invalid", "commit", "-q", "-m", "init"]);
    const pe = await createProject(a.app, {repository: {path: ext}, devCommand: ["node", "server.js"]});
    // Journal'a doğrudan (API dışı) yazılmış kayıtlar: veri dizinine işaret eden yönetilmeyen yol ve B'nin deposuna işaret eden managed=true kayıt.
    const store = new WorkOsStore(b.dataDir);
    const mkStore = (repository?: {path: string}) => store.createProject({tenantId: "tA", orgId: "local", name: "S", environmentId: "dev", createdBy: "FOUNDER_LOCAL", ...(repository ? {repository} : {}), devCommand: ["node", "server.js"]});
    const pData = mkStore({path: b.dataDir});
    const pProjects = mkStore({path: path.join(b.dataDir, "projects")});
    const pForeign = mkStore();
    store.setProjectRepository({tenantId: "tA"}, pForeign.projectId, {path: bRepo, managed: true}, "FOUNDER_LOCAL", {kind: "git", headSha: git(bRepo, ["rev-parse", "HEAD"])});
    const a2 = mk({tenantId: "tA", dataDir: b.dataDir, runtime: b.runtime});
    const head = git(bRepo, ["rev-parse", "HEAD"]);
    const listed = (await call(a2.app, "GET", "/v1/projects")).json().projects.map((x: Project) => x.projectId).sort();
    expect(listed).toEqual([pe.projectId, pData.projectId, pProjects.projectId, pForeign.projectId].sort());
    for (const p of [pe, pData, pProjects, pForeign]) {
      const gets = ["files", `files?path=${pb.projectId}`, "files?path=projects", "file?path=README.md", `file?path=${pb.projectId}/repo/README.md`, "git/log", `git/diff?from=${head}`, "git/diff?from=HEAD"];
      for (const g of gets) {
        const r = await call(a2.app, "GET", `/v1/projects/${p.projectId}/${g}`);
        expect(r.statusCode, `${p.projectId} ${g} ${r.body}`).toBe(409);
        expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
        expect(r.body).not.toContain("<h1>");
      }
      for (const u of ["export", "devrun/start", "devrun/restart"]) {
        const r = await call(a2.app, "POST", `/v1/projects/${p.projectId}/${u}`, {});
        expect(r.statusCode, `${p.projectId} ${u} ${r.body}`).toBe(409);
        expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
      }
      expect((await devrun(a2.app, p.projectId)).status).toBe("STOPPED");
      expect((await call(a2.app, "GET", `/v1/projects/${p.projectId}/exports`)).json().exports).toEqual([]);
    }
    expect(fs.existsSync(path.join(b.dataDir, "exports")) ? fs.readdirSync(path.join(b.dataDir, "exports")).filter(f => f.endsWith(".zip")) : []).toEqual([]);
    // B kendi yönetilen deposunu kullanmaya devam eder.
    const own = await call(b.app, "GET", `/v1/projects/${pb.projectId}/file?path=README.md`);
    expect(own.statusCode, own.body).toBe(200);
    // Doğrudan modül seviyesi: managedRepoRoot yalnız <dataDir>/projects/<id>/repo'yu kabul eder.
    const studio = new ProjectStudio({dataDir: b.dataDir, envPolicyFile: ENV_POLICY});
    expect(studio.managedRepoRoot(pb).toLowerCase()).toBe(fs.realpathSync(bRepo).toLowerCase());
    expect(() => studio.managedRepoRoot({...pb, projectId: pForeign.projectId})).toThrow(StudioError);
    expect(() => studio.managedRepoRoot({...pb, repository: {path: bRepo}})).toThrow(/REPOSITORY_NOT_MANAGED/);
  }, T);
});

describe("PS1A-C1-F2: stop/stopAll/GLOBAL_STOP while start is pending never leaks a process", () => {
  it("does not spawn when stopped during the port wait, refuses with 423 when GLOBAL_STOP appears, and stops a child spawned before the stop", async () => {
    const {app, dataDir} = mk();
    const marker = path.join(tmp, "spawned.txt");
    const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); require('http').createServer((q, r) => r.end('ok')).listen(+process.env.PORT, '127.0.0.1');`;
    const p = await createProject(app, {template: "web-node", devCommand: ["node", "-e", script]});
    const stopFile = path.join(tmp, "m-runtime", "GLOBAL_STOP.json"); fs.mkdirSync(path.dirname(stopFile), {recursive: true});
    let portHold: Promise<void> | null = null, timeHold: Promise<void> | null = null, entered: () => void = () => undefined;
    const m = new DevRunManager({executionGate: testExecutionGate(), studio: new ProjectStudio({dataDir, envPolicyFile: ENV_POLICY}), envPolicyFile: ENV_POLICY, globalStopFile: stopFile, stopPollMs: 100, probeIntervalMs: 100,
      freePort: async () => { if (portHold) { entered(); await portHold; } return freeLoopbackPort(); },
      startTimeOf: async pid => { if (timeHold && pid !== process.pid) { entered(); await timeHold; } return processStartTime(pid); }});
    const hold = () => { let open: () => void = () => undefined; const gate = new Promise<void>(r => { open = r; }); const reached = new Promise<void>(r => { entered = r; }); return {gate, open, reached}; };
    const stateFile = path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), lockFile = path.join(dataDir, "projects", p.projectId, "devrun", "devrun.lock");
    try {
      // 1) stopAll, start freeLoopbackPort'u beklerken gelir (EXP5).
      const h1 = hold(); portHold = h1.gate;
      const pending = m.start(p);
      await h1.reached;
      expect(await m.stopAll("GLOBAL_STOP_ACTIVE")).toEqual([p.projectId]);
      h1.open(); portHold = null;
      const v = await pending;
      expect(v).toMatchObject({status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE", pid: null, port: null, preview: {url: null, state: "UNAVAILABLE"}});
      await sleep(1500);
      expect(fs.existsSync(marker)).toBe(false);
      expect(await m.stopAll("again")).toEqual([]);
      expect(m.isActive(p.projectId)).toBe(false);
      expect(fs.existsSync(lockFile)).toBe(false);
      const s1 = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      expect(s1).toMatchObject({status: "STOPPED", pid: null});
      // 2) Bant dışı GLOBAL_STOP dosyası port beklenirken etkinleşir: spawn yok, 423.
      const h2 = hold(); portHold = h2.gate;
      const pending2 = m.start(p).then(() => null, (e: unknown) => e);
      await h2.reached;
      activateGlobalStop(stopFile, "test", "TEST");
      h2.open(); portHold = null;
      const err = await pending2;
      expect(err).toBeInstanceOf(StudioError);
      expect((err as StudioError).code).toBe("GLOBAL_STOP_ACTIVE");
      expect((err as StudioError).status).toBe(423);
      await sleep(1500);
      expect(fs.existsSync(marker)).toBe(false);
      expect(m.isActive(p.projectId)).toBe(false);
      expect(m.view(p)).toMatchObject({status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE", pid: null});
      expect(fs.existsSync(lockFile)).toBe(false);
      clearGlobalStop(stopFile, "TEST");
      // 3) Spawn'dan sonraki await (başlangıç zamanı) sırasında stopAll: başlatılan çocuk sonlandırılır.
      const h3 = hold(); timeHold = h3.gate;
      const pending3 = m.start(p);
      await h3.reached;
      expect(await m.stopAll("GLOBAL_STOP_ACTIVE")).toEqual([p.projectId]);
      h3.open(); timeHold = null;
      const v3 = await pending3;
      expect(v3.status).toBe("STOPPED");
      const spawnedPid = v3.pid as number;
      expect(spawnedPid).toBeGreaterThan(0);
      expect(pidAlive(spawnedPid)).toBe(false);
      expect(m.isActive(p.projectId)).toBe(false);
      expect(fs.existsSync(lockFile)).toBe(false);
      // Pozitif kontrol: işaretçi mekanizması gerçekten çalışır (normal start çocuğu başlatır), kapanışta durur.
      fs.rmSync(marker, {force: true});
      const ok = await m.start(p);
      expect(ok.status).toBe("RUNNING");
      for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await sleep(100);
      expect(fs.existsSync(marker)).toBe(true);
      await m.close();
      expect(pidAlive(ok.pid as number)).toBe(false);
    } finally { await m.close(); }
  }, T);
});

describe("PS1A-C1-F3: the owning API process is identified by pid + start time", () => {
  it("treats a reused owner pid as dead (recovers the orphan, takes the lock) and masks a preview not probed by this instance", async () => {
    const a = mk();
    const q1 = await createProject(a.app, {template: "web-node"});
    const q2 = await createProject(a.app, {template: "web-node"});
    const host = os.hostname(), now = new Date().toISOString();
    // Canlı ama ilgisiz süreç (eski API pid'i yeniden kullanılmış): kayıtlı sahip başlangıç zamanı farklıdır.
    const unrelated = idle();
    const orphan1 = idle();
    // Gerçekten canlı başka sahip: pid ve başlangıç zamanı eşleşir.
    const liveOwner = idle();
    const orphan2 = idle();
    const [o1Start, ownerStart, o2Start] = await Promise.all([processStartTime(orphan1), processStartTime(liveOwner), processStartTime(orphan2)]);
    expect(o1Start && ownerStart && o2Start).toBeTruthy();
    const write = (projectId: string, st: Record<string, unknown>, lock: {pid: number; runId: string}) => {
      const d = path.join(a.dataDir, "projects", projectId, "devrun"); fs.mkdirSync(d, {recursive: true});
      fs.writeFileSync(path.join(d, "state.json"), JSON.stringify({schemaVersion: 1, projectId, tenantId: "tA", status: "RUNNING", reason: null, ownerHost: host, startedAt: now, endedAt: null, exitCode: null, signal: null,
        port: 45678, argv: ["node", "server.js"], headSha: null, preview: {url: "http://127.0.0.1:45678/", state: "AVAILABLE", lastProbeAt: now}, ...st}));
      fs.writeFileSync(path.join(d, "devrun.lock"), JSON.stringify({pid: lock.pid, hostname: host, runId: lock.runId, lockId: crypto.randomUUID(), startedAt: now}));
    };
    write(q1.projectId, {pid: orphan1, pidStartTime: o1Start, ownerPid: unrelated, ownerStartTime: "1999-01-01T00:00:00.0000000Z", instanceId: "dev_previous"}, {pid: unrelated, runId: "dev_previous"});
    write(q2.projectId, {pid: orphan2, pidStartTime: o2Start, ownerPid: liveOwner, ownerStartTime: ownerStart, instanceId: "dev_other"}, {pid: liveOwner, runId: "dev_other"});
    const b = mk({dataDir: a.dataDir, runtime: a.runtime});
    // q1: sahip pid'i canlı ama başlangıç zamanı farklı -> sahipsiz; orphan (pid+zaman eşleşir) sonlandırılır, ilgisiz süreç sonlandırılmaz, kilit devralınır.
    const v1 = await devrun(b.app, q1.projectId);
    expect(v1).toMatchObject({status: "STOPPED", reason: "RECOVERED_AFTER_API_RESTART:ORPHAN_KILLED", recovery: {result: "ORPHAN_KILLED", pid: orphan1}, preview: {url: null, state: "UNAVAILABLE"}});
    expect(pidAlive(orphan1)).toBe(false);
    expect(pidAlive(unrelated)).toBe(true);
    expect(fs.existsSync(path.join(a.dataDir, "projects", q1.projectId, "devrun", "devrun.lock"))).toBe(false);
    const s1 = await call(b.app, "POST", `/v1/projects/${q1.projectId}/devrun/start`, {});
    expect(s1.statusCode, s1.body).toBe(200);
    expect(s1.json().devrun.status).toBe("RUNNING");
    const persisted = JSON.parse(fs.readFileSync(path.join(a.dataDir, "projects", q1.projectId, "devrun", "state.json"), "utf8"));
    expect(persisted.ownerPid).toBe(process.pid);
    expect(persisted.ownerStartTime).toBe(await processStartTime(process.pid));
    expect(s1.json().devrun).not.toHaveProperty("ownerStartTime");
    await call(b.app, "POST", `/v1/projects/${q1.projectId}/devrun/stop`, {});
    // q2: sahip gerçekten canlı -> dokunulmaz, start 409; dosyadan okunan AVAILABLE önizleme yoklanmadan sunulmaz.
    const v2 = await devrun(b.app, q2.projectId);
    expect(v2.status).toBe("RUNNING");
    expect(v2.recovery).toBeUndefined();
    expect(v2.preview).toEqual({url: null, state: "UNAVAILABLE", lastProbeAt: now, reason: "NOT_OWNED_BY_THIS_INSTANCE"});
    expect(pidAlive(orphan2)).toBe(true);
    const s2 = await call(b.app, "POST", `/v1/projects/${q2.projectId}/devrun/start`, {});
    expect(s2.statusCode).toBe(409);
    expect(s2.json()).toEqual({error: "DEVRUN_LOCKED"});
    // Sahip gerçekten öldükten sonra kilit ölü pid olarak devralınır.
    killProcessTree(liveOwner);
    for (let i = 0; i < 50 && pidAlive(liveOwner); i++) await sleep(100);
    const s3 = await call(b.app, "POST", `/v1/projects/${q2.projectId}/devrun/start`, {});
    expect(s3.statusCode, s3.body).toBe(200);
    await call(b.app, "POST", `/v1/projects/${q2.projectId}/devrun/stop`, {});
  }, T);
});
