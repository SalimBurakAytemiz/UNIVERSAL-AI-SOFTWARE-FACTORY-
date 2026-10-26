// //TR: Bu test PS-1A c2 düzeltmelerini gerçek geçici dizin/git ve gerçek alt süreçlerle doğrular (ağ yok, AI sağlayıcı yok): PS1A-C1-F1 (yönetilmeyen/veri dizinine işaret eden repository.path ile tenant izolasyonunun aşılamaması), PS1A-C1-F2 (start beklerken stop/stopAll/GLOBAL_STOP gelirse süreç başlatılmaz, sızıntı yok) ve PS1A-C1-F3 (sahip API pid'i yeniden kullanılmışsa sahip canlı sayılmaz; dosyadan okunan önizleme maskelenir).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./support/test-sandbox.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
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
    // //TR: Windows'ta os.tmpdir() 8.3 kisa adla (RUNNER~1) donebilir; JS fs.realpathSync kisa adi acmaz, realpathSync.native acar. Urun sozlesmesi uzun-ad kanonik yoldur; beklenen deger de ayni kanonik bicimde hesaplanir.
    expect(studio.managedRepoRoot(pb).toLowerCase()).toBe(fs.realpathSync.native(bRepo).toLowerCase());
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

// //TR: B-DEVRUN-RESTART-SAFE: stop() çıkışı süre içinde göremezse çalıştırma STOPPED sayılmaz; restart ikinci bir dev sunucusu BAŞLATMAZ (409 DEVRUN_STOP_TIMEOUT). Çıkış olayı gecikmeli verilen sahte sandbox sağlayıcısı kullanılır (çıkışı geciktiren: gerçek süreç ölür, yönetici bunu geç öğrenir).
describe("B-DEVRUN-RESTART-SAFE: a stop that cannot confirm the exit never allows a second dev server", () => {
  const SCRIPT = "require('http').createServer((q, r) => r.end('ok')).listen(+process.env.PORT, '127.0.0.1');";
  const slowExitProvider = (delayMs: number, counter: {spawns: number}) => ({
    ...TEST_HOST_PASSTHROUGH_SANDBOX, id: "TEST_ONLY_SLOW_EXIT",
    spawn: (command: string, args: string[], o: cp.SpawnOptions) => {
      counter.spawns++;
      const real = cp.spawn(command, args, o);
      return new Proxy(real, {get: (t, k) => {
        if (k === "once" || k === "on") return (ev: string, fn: (...a: unknown[]) => void) => ev === "exit" ? t.once("exit", (...x: unknown[]) => { setTimeout(() => fn(...x), delayMs); }) : t.once(ev, fn);
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      }}) as unknown as cp.ChildProcess;
    }
  });
  const manager = (dataDir: string, gate: ExecutionGate, stopWaitMs?: number) => new DevRunManager({executionGate: gate, studio: new ProjectStudio({dataDir, envPolicyFile: ENV_POLICY}), envPolicyFile: ENV_POLICY,
    globalStopFile: path.join(tmp, "m-runtime", "GLOBAL_STOP.json"), stopPollMs: 100, probeIntervalMs: 100, ...(stopWaitMs !== undefined ? {stopWaitMs} : {})});
  const settle = async (m: DevRunManager, id: string) => { for (let i = 0; i < 100 && m.isActive(id); i++) await sleep(100); };

  it("restart refuses with 409 DEVRUN_STOP_TIMEOUT, spawns nothing, keeps the run active with stopTimedOut, and settles to STOPPED when the exit finally arrives", async () => {
    const {app, dataDir} = mk(), counter = {spawns: 0};
    const p = await createProject(app, {template: "web-node", devCommand: ["node", "-e", SCRIPT]});
    const m = manager(dataDir, new ExecutionGate(slowExitProvider(900, counter)), 150);
    const stateFile = path.join(dataDir, "projects", p.projectId, "devrun", "state.json");
    try {
      const v1 = await m.start(p);
      expect(v1.status).toBe("RUNNING"); expect(counter.spawns).toBe(1);
      const pid1 = v1.pid!;
      const err: unknown = await m.restart(p).then(() => null, e => e);
      expect(err).toBeInstanceOf(StudioError);
      expect(err).toMatchObject({code: "DEVRUN_STOP_TIMEOUT", status: 409});
      expect(counter.spawns).toBe(1);                       // no second dev server
      expect(m.isActive(p.projectId)).toBe(true);           // not claimed STOPPED while the tree may be alive
      const v = m.view(p);
      expect(v).toMatchObject({status: "RUNNING", pid: pid1, stopTimedOut: true});
      expect(JSON.parse(fs.readFileSync(stateFile, "utf8")).stopTimedOut).toBe(true);
      const again: unknown = await m.start(p).then(() => null, e => e);
      expect(again).toMatchObject({code: "DEVRUN_ALREADY_RUNNING", status: 409});
      expect(counter.spawns).toBe(1);
      await settle(m, p.projectId);                         // the delayed exit event arrives
      expect(m.isActive(p.projectId)).toBe(false);
      const done = m.view(p);
      expect(done.status).toBe("STOPPED"); expect(done.reason).toBe("RESTART_REQUESTED"); expect("stopTimedOut" in done).toBe(false);
      expect(pidAlive(pid1)).toBe(false); expect(counter.spawns).toBe(1);
    } finally { await m.stopAll("CLEANUP"); await settle(m, p.projectId); }
  }, T);

  it("an explicit stop times out the same honest way; stopAll never throws and still lists the run; a later stop succeeds", async () => {
    const {app, dataDir} = mk(), counter = {spawns: 0};
    const p = await createProject(app, {template: "web-node", devCommand: ["node", "-e", SCRIPT]});
    const m = manager(dataDir, new ExecutionGate(slowExitProvider(900, counter)), 150);
    try {
      await m.start(p);
      expect(await m.stopDetailed(p.projectId, "STOP_REQUESTED")).toBe("TIMEOUT");
      const err: unknown = await m.stop(p.projectId).then(() => null, e => e);
      expect(err).toMatchObject({code: "DEVRUN_STOP_TIMEOUT", status: 409});
      expect(await m.stopAll("GLOBAL_STOP_ACTIVE")).toEqual([p.projectId]);   // does not reject
      expect(m.view(p)).toMatchObject({status: "RUNNING", stopTimedOut: true});
      await settle(m, p.projectId);
      expect(m.view(p).status).toBe("STOPPED");
      expect(await m.stopDetailed(p.projectId)).toBe("NOT_ACTIVE");
      expect(await m.stop(p.projectId)).toBe(false);
    } finally { await m.stopAll("CLEANUP"); await settle(m, p.projectId); }
  }, T);

  it("the normal path is unchanged: restart replaces the process (old one dead, new pid), stop reports true then false", async () => {
    const {app, dataDir} = mk();
    const p = await createProject(app, {template: "web-node", devCommand: ["node", "-e", SCRIPT]});
    const m = manager(dataDir, testExecutionGate());
    try {
      const v1 = await m.start(p); expect(v1.status).toBe("RUNNING");
      const v2 = await m.restart(p);
      expect(v2.status).toBe("RUNNING"); expect(v2.pid).not.toBe(v1.pid); expect(pidAlive(v1.pid!)).toBe(false);
      expect("stopTimedOut" in v2).toBe(false);
      expect(await m.stop(p.projectId)).toBe(true);
      expect(m.view(p).status).toBe("STOPPED");
      expect(await m.stop(p.projectId)).toBe(false);
    } finally { await m.stopAll("CLEANUP"); }
  }, T);
});

// //TR: LANE-B B-RUN-1: teslim edilen ürünün çalıştırılması. Ağ-izole sağlayıcıda ürün yalnız sağlayıcı köprüsüyle (127.0.0.1, tek port) açılır; köprü/loopback yoksa kesin DEVRUN_SANDBOX_UNAVAILABLE ve HİÇBİR süreç başlamaz. Gerçek Linux sağlayıcılı test yalnız selfTest + loopback + nsenter varsa çalışır, aksi halde SKIP görünür (PASS sayılmaz).
describe("LANE-B product run: provider bridge (B-RUN-1)", () => {
  const manager = (dataDir: string, gate: ExecutionGate, o: Record<string, unknown> = {}) => new DevRunManager({executionGate: gate, studio: new ProjectStudio({dataDir, envPolicyFile: ENV_POLICY}), envPolicyFile: ENV_POLICY,
    globalStopFile: path.join(tmp, "m-runtime", "GLOBAL_STOP.json"), stopPollMs: 100, probeIntervalMs: 100, ...o});
  const fakeIsolated = (extra: Record<string, unknown> = {}) => {
    const spawned: string[] = [];
    const provider = {id: "linux-unshare-v2", async selfTest() { return {ok: true}; }, async run() { throw new Error("unused"); }, spawn(c: string, a: string[], o: cp.SpawnOptions) { spawned.push(c); return cp.spawn(c, a, o); }, ...extra};
    return {provider, spawned};
  };
  it("bridgeSupport: HOST test doubles need no bridge; the Linux provider needs a proven loopback and nsenter; WSL has none yet; every refusal carries an exact reason", async () => {
    const {bridgeSupport, providerNetwork} = await import("../core/workos/devrun-bridge.js");
    expect(providerNetwork(TEST_HOST_PASSTHROUGH_SANDBOX)).toBe("HOST"); expect(bridgeSupport(TEST_HOST_PASSTHROUGH_SANDBOX)).toMatchObject({ok: true, start: null});
    const lin = (caps?: unknown) => ({id: "linux-unshare-v2", selfTest: async () => ({ok: true}), run: async () => ({}) as any, spawn: () => ({}) as any, ...(caps ? {capabilities: caps} : {})});
    // Platform kapısı yeteneklerden ÖNCE gelir (üründe doğru); beklentiler çalıştıran işletim sistemine bağlı olmasın diye platform açıkça verilir (win32 -> BRIDGE_PLATFORM_NOT_LINUX, linux -> yetenek kodları).
    const L = {platform: "linux" as const};
    expect(bridgeSupport(lin(), {platform: "win32"})).toEqual({ok: false, reason: "BRIDGE_PLATFORM_NOT_LINUX"});
    expect(bridgeSupport(lin(), L)).toEqual({ok: false, reason: "SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED"});
    expect(bridgeSupport(lin({loopback: false, loopbackReason: "LOOPBACK_TOOL_MISSING"}), L)).toEqual({ok: false, reason: "SANDBOX_LOOPBACK_NOT_VERIFIED:LOOPBACK_TOOL_MISSING"});
    expect(bridgeSupport(lin({loopback: true}), {...L, nsenterBinary: null})).toEqual({ok: false, reason: "NSENTER_MISSING"});
    expect(bridgeSupport(lin({loopback: true}), {nsenterBinary: "/usr/bin/nsenter", platform: "win32"})).toEqual({ok: false, reason: "BRIDGE_PLATFORM_NOT_LINUX"});
    expect(bridgeSupport(lin({loopback: true}), {nsenterBinary: "/usr/bin/nsenter", platform: "linux"})).toMatchObject({ok: true, network: "ISOLATED"});
    expect(bridgeSupport({...lin(), id: "wsl-unshare-v1"} as any, L)).toEqual({ok: false, reason: "PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1"});
    const own = async () => ({port: 1, close() {}});
    expect(bridgeSupport({...lin(), bridge: own} as any, L)).toMatchObject({ok: true});
  });

  it("an isolated provider without a usable bridge is refused with DEVRUN_SANDBOX_UNAVAILABLE + exact reason BEFORE anything is cloned or spawned; state is BLOCKED; an unverified provider keeps SANDBOX_UNAVAILABLE", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    const {provider, spawned} = fakeIsolated();
    const m = manager(dataDir, new ExecutionGate(provider as any), {bridgeOptions: {platform: "linux"}});
    await expect(m.start(p)).rejects.toMatchObject({code: "DEVRUN_SANDBOX_UNAVAILABLE", status: 409, reason: "SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED"});
    expect(spawned).toEqual([]); expect(fs.existsSync(path.join(dataDir, "projects", p.projectId, "devrun", "workspace"))).toBe(false);
    const v = m.view(p); expect(v.status).toBe("BLOCKED"); expect(v.reason).toBe("DEVRUN_SANDBOX_UNAVAILABLE:SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED");
    const bad = manager(dataDir, new ExecutionGate({...provider, selfTest: async () => ({ok: false, detail: "X"})} as any));
    await expect(bad.start(p)).rejects.toMatchObject({code: "SANDBOX_UNAVAILABLE", status: 409});
    expect(spawned).toEqual([]);
  }, T);

  it("C-1: a RUNNING bridged product is stopped on the provider side and becomes BLOCKED (SANDBOX_UNVERIFIED) when the provider de-verifies; view masks the preview at once, the bridge closes and the process is gone", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    // net: üst düzey import
    const net = await import("node:net");
    let innerPort = 0, closed = 0, verified = true, child: cp.ChildProcess | null = null; const proxies = new Set<import("node:net").Socket>();
    const provider = {id: "FAKE_ISOLATED", network: "ISOLATED", async selfTest() { return {ok: verified}; }, isVerified() { return verified; }, async run() { throw new Error("unused"); },
      spawn(c: string, a: string[], o: cp.SpawnOptions) { innerPort = Math.floor(30000 + Math.random() * 20000); child = cp.spawn(c, a, {...o, env: {...(o.env as any), PORT: String(innerPort)}}); return child; },
      async bridge(_c: cp.ChildProcess, port: number) {
        const srv = net.createServer(s => { const u = net.connect(innerPort, "127.0.0.1"); proxies.add(s); s.pipe(u); u.pipe(s); s.on("error", () => u.destroy()); u.on("error", () => s.destroy()); });
        await new Promise<void>(r => srv.listen(port, "127.0.0.1", () => r()));
        return {port, close() { closed++; srv.close(); for (const s of proxies) s.destroy(); }};
      }};
    const m = manager(dataDir, new ExecutionGate(provider as any));
    try {
      const v = await m.start(p); expect(v).toMatchObject({status: "RUNNING", bridged: true});
      expect((await fetch(`http://127.0.0.1:${v.port}/`)).status).toBe(200);
      verified = false;
      const masked = m.view(p); expect(masked.preview).toMatchObject({state: "UNAVAILABLE", url: null, reason: "SANDBOX_UNVERIFIED"});
      expect(closed, "the bridge closes IMMEDIATELY on de-verify, before the stop completes").toBe(1);
      for (let i = 0; i < 100 && m.view(p).status !== "BLOCKED"; i++) await new Promise(r => setTimeout(r, 100));
      const done = m.view(p); expect(done).toMatchObject({status: "BLOCKED", reason: "SANDBOX_UNVERIFIED"}); expect(closed).toBe(1);
      expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
      await expect(fetch(`http://127.0.0.1:${v.port}/`)).rejects.toBeTruthy();
    } finally { await m.stopAll("CLEANUP"); }
  }, T);

  it("STOP-409 (Windows stop timeout): stop returns STOPPED as soon as the root exits even when the tree reap is slow (reap is a separate background budget); a new start waits for that reap and is refused with 409 DEVRUN_STOP_PENDING if it takes too long", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    const m = manager(dataDir, new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX as any), {stopWaitMs: 1500, reapWaitMs: 300});
    let reaps = 0; (m as any).reapTree = async () => { reaps++; await new Promise(r => setTimeout(r, 3000)); };
    try {
      await m.start(p);
      const t0 = Date.now(); expect(await m.stop(p.projectId)).toBe(true); expect(Date.now() - t0, "stop must not wait for the slow reap").toBeLessThan(1400);
      expect(m.view(p).status).toBe("STOPPED");
      await expect(m.start(p)).rejects.toMatchObject({code: "DEVRUN_STOP_PENDING", status: 409});
      (m as any).o.reapWaitMs = 10_000; const v = await m.start(p); expect(reaps).toBe(1); expect(v.status).toMatch(/RUNNING|STARTING/);
    } finally { (m as any).reapTree = async () => undefined; await m.stopAll("CLEANUP"); }
  }, 40_000);

  const spawning = (extra: Record<string, unknown> = {}) => { const spawned: string[] = []; return {spawned, provider: {...TEST_HOST_PASSTHROUGH_SANDBOX, spawn(c: string, a: string[], o: cp.SpawnOptions) { spawned.push(c); return cp.spawn(c, a, o); }, ...extra} as any}; };

  it("START-WAIT-STOP: a stop, stopAll or close that arrives while a start waits for the previous reap cancels that start (0 spawns, never RUNNING); the wait timers are cleared", async () => {
    for (const how of ["stop", "stopAll", "close"] as const) {
      const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
      const {provider, spawned} = spawning();
      const m = manager(dataDir, new ExecutionGate(provider), {reapWaitMs: 10_000});
      (m as any).reapTree = async () => { await new Promise(r => setTimeout(r, 1500)); };
      try {
        await m.start(p); expect(spawned).toHaveLength(1); await m.stop(p.projectId);
        const s = m.start(p).then(v => v, e => e);
        await new Promise(r => setTimeout(r, 200)); // start şimdi önceki ağaç temizliğini bekliyor (yer tutucu yok)
        if (how === "stop") await m.stop(p.projectId); else if (how === "stopAll") await m.stopAll("TEST"); else await m.close();
        const r: any = await s;
        if (how === "close") expect(r).toMatchObject({code: "DEVRUN_CLOSED"}); else expect(r.status, JSON.stringify(r).slice(0, 200)).toBe("STOPPED");
        expect(spawned, how).toHaveLength(1); expect(m.isActive(p.projectId)).toBe(false);
        if (how === "close") await expect(m.start(p)).rejects.toMatchObject({code: "DEVRUN_CLOSED"});
      } finally { (m as any).reapTree = async () => undefined; await m.close().catch(() => undefined); }
    }
  }, 60_000);

  it("M04: the manager-wide cap defaults to 2 (third concurrent start is 409 DEVRUN_CAPACITY)", async () => {
    const {app, dataDir} = mk(); const ps = [await createProject(app, {template: "web-node"}), await createProject(app, {template: "web-node"}), await createProject(app, {template: "web-node"})];
    const m = manager(dataDir, new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX as any));
    try {
      await m.start(ps[0]!); await m.start(ps[1]!);
      await expect(m.start(ps[2]!)).rejects.toMatchObject({code: "DEVRUN_CAPACITY", status: 409});
    } finally { await m.stopAll("CLEANUP"); }
  }, T);

  it("M06/M16: the periodic check alone (no view() call) stops a product whose provider de-verifies; a non-boolean isVerified() result is NOT accepted as verified", async () => {
    for (const bad of [false, undefined]) {
      const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
      let verified: unknown = true; const {provider} = spawning({isVerified: () => verified});
      const m = manager(dataDir, new ExecutionGate(provider), {probeIntervalMs: 60_000}); // yoklama döngüsü devre dışı sayılır: yalnız stopPollMs (100 ms) zamanlayıcısı denetler
      try {
        await m.start(p); expect(m.isActive(p.projectId)).toBe(true);
        verified = bad; // view() ÇAĞRILMAZ: yalnız zamanlayıcı denetler
        for (let i = 0; i < 80 && m.isActive(p.projectId); i++) await new Promise(r => setTimeout(r, 100));
        expect(m.isActive(p.projectId), `isVerified()=${String(bad)}`).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), "utf8"))).toMatchObject({status: "BLOCKED", reason: "SANDBOX_UNVERIFIED"});
      } finally { await m.close(); }
    }
  }, 60_000);

  it("a provider that is ALREADY de-verified never gets spawn() (cached gate result is not enough); a de-verify stop that times out is retried by the periodic check", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    let verified: unknown = true; const {provider, spawned} = spawning({isVerified: () => verified});
    const m = manager(dataDir, new ExecutionGate(provider));
    try {
      await m.start(p); await m.stop(p.projectId); expect(spawned).toHaveLength(1);
      verified = false; await expect(m.start(p)).rejects.toMatchObject({code: "SANDBOX_UNAVAILABLE", reason: "SANDBOX_UNVERIFIED"}); expect(spawned).toHaveLength(1);
      verified = undefined; await expect(m.start(p)).rejects.toMatchObject({code: "SANDBOX_UNAVAILABLE", reason: "SANDBOX_UNVERIFIED"}); expect(spawned, "a non-boolean isVerified() is not verified").toHaveLength(1);
      verified = true; await m.start(p);
      const real = (m as any).stopDetailed.bind(m); let tries = 0;
      (m as any).stopDetailed = async (id: string, why?: string) => { if (why === "SANDBOX_UNVERIFIED" && ++tries === 1) return "TIMEOUT"; return real(id, why); };
      verified = false;
      for (let i = 0; i < 80 && m.isActive(p.projectId); i++) await new Promise(r => setTimeout(r, 100));
      expect(tries).toBeGreaterThanOrEqual(2); expect(m.isActive(p.projectId)).toBe(false);
    } finally { await m.close(); }
  }, 60_000);

  it("M13: close() waits for the background tree reaps (bounded by stopWaitMs) before it resolves", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    const m = manager(dataDir, new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX as any), {stopWaitMs: 5000});
    let reaped = false; (m as any).reapTree = async () => { await new Promise(r => setTimeout(r, 1200)); reaped = true; };
    await m.start(p); await m.close();
    expect(reaped, "close must not resolve before the reap finishes").toBe(true);
  }, 30_000);

  const heldSpawnAsync = (o: {honourAbort: boolean; teardownCode?: () => string | null}) => {
    let release!: () => void; const hold = new Promise<void>(r => { release = r; }); const st = {calls: 0, spawned: 0, children: [] as cp.ChildProcess[], torn: [] as string[]};
    const provider = hostSpawn({
      async spawnAsync(c: string, a: string[], op: cp.SpawnOptions & {shouldAbort?: () => boolean}) {
        st.calls++; await hold;
        if (o.honourAbort && op.shouldAbort?.()) throw new Error("SANDBOX_REFUSED: ABORTED");
        const ch: any = cp.spawn(c, a, op); st.spawned++; st.children.push(ch); ch.sandboxScratch = "/tmp/uasco-sbx-Hd0001";
        ch.sandboxTeardown = new Promise(res => ch.once("exit", () => res(o.teardownCode?.() ?? null))); return ch;
      },
      async teardownScratch(sc: string) { st.torn.push(sc); return o.teardownCode?.() ?? null; }});
    return {provider, st, release: () => release()};
  };

  it("D1: a stop, stopAll or close that arrives while spawnAsync is still preparing does NOT answer STOPPED before the sandbox exists: with a provider that honours shouldAbort nothing is spawned; with one that ignores it the stop waits for the spawn, kills it and waits for exit + provider teardown; a second start then runs and its record is never overwritten by the cancelled run's late exit", async () => {
    for (const honour of [true, false]) for (const how of ["stop", "stopAll", "close"] as const) {
      const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
      const {provider, st, release} = heldSpawnAsync({honourAbort: honour});
      const m = manager(dataDir, new ExecutionGate(provider));
      try {
        const first = m.start(p).then(v => v, e => e);
        for (let i = 0; i < 100 && st.calls < 1; i++) await new Promise(r => setTimeout(r, 20));
        expect(st.calls).toBe(1);
        let stopSettled = false; const stopping = (how === "stop" ? m.stop(p.projectId) : how === "stopAll" ? m.stopAll("TEST") : m.close()).then(() => { stopSettled = true; });
        await new Promise(r => setTimeout(r, 200)); expect(stopSettled, `${how} must wait for the in-flight spawn (honour=${honour})`).toBe(false);
        release(); await stopping; const r1: any = await first;
        if (honour) { expect(st.spawned, "no sandbox is created after the cancel").toBe(0); } else { expect(st.spawned).toBe(1); expect(st.children[0]!.exitCode !== null || st.children[0]!.signalCode !== null, "the late spawn is killed and awaited").toBe(true); }
        expect(m.isActive(p.projectId)).toBe(false); expect(JSON.stringify(r1).includes('"status":"RUNNING"')).toBe(false);
        if (how !== "close") {
          const second = await m.start(p); expect(second.status).toMatch(/RUNNING|STARTING/); const startedAt = second.startedAt;
          await new Promise(r => setTimeout(r, 400));
          const rec = JSON.parse(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), "utf8")); expect(rec.startedAt, "late exit of the cancelled run must not overwrite the new run").toBe(startedAt); expect(rec.status).toMatch(/RUNNING|STARTING/);
        }
      } finally { release(); await m.close().catch(() => undefined); }
    }
  }, 120_000);

  it("D1 ownership: the late exit of a superseded run never overwrites the persisted record of the project's NEW active run (startedAt ownership)", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    const m = manager(dataDir, new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX as any), {maxConcurrent: 4});
    try {
      await m.start(p); const a1 = (m as any).active.get(p.projectId); const pid1 = a1.child.pid as number;
      (m as any).active.delete(p.projectId); (m as any).reaping.delete(p.projectId); a1.release?.(); a1.release = null; // eski çalıştırma haritadan düşmüş (iptal/yarış senaryosu)
      await new Promise(r => setTimeout(r, 1100)); // startedAt farklı olsun
      const second = await m.start(p); expect(second.status).toMatch(/RUNNING|STARTING/);
      const rec = () => JSON.parse(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), "utf8"));
      const before = rec(); expect(before.startedAt).toBe(second.startedAt); expect(before.startedAt).not.toBe(a1.state.startedAt);
      (m as any).onExit(a1, 1, null); // eski çalıştırmanın GEÇ çıkışı
      expect(rec(), "the new run's record must be untouched").toMatchObject({startedAt: second.startedAt, status: before.status}); expect(rec().exitCode ?? null).toBeNull();
      killProcessTree(pid1);
    } finally { await m.close().catch(() => undefined); }
  }, 60_000);

  it("L4: recover() also closes the Linux side of a TERMINAL record that still carries a sandboxScratch (no stopIncomplete flag, e.g. a crash or a stop that raced spawnAsync) and clears it only on a clean teardown", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    let code: string | null = "PROCESS_SURVIVED"; const torn: string[] = [];
    const provider = hostSpawn({async teardownScratch(sc: string) { torn.push(sc); return code; }});
    const f = path.join(dataDir, "projects", p.projectId, "devrun", "state.json"); fs.mkdirSync(path.dirname(f), {recursive: true});
    const m0 = manager(dataDir, new ExecutionGate(provider));
    const rec = {...(m0 as any).blank(p), status: "STOPPED", reason: "STOP_REQUESTED", instanceId: "dev_dead", ownerPid: 2 ** 22 - 3, sandboxScratch: "/tmp/uasco-sbx-Tt0001", endedAt: new Date().toISOString()};
    fs.writeFileSync(f, JSON.stringify(rec));
    const m = manager(dataDir, new ExecutionGate(provider));
    await m.recover(); expect(torn).toEqual(["/tmp/uasco-sbx-Tt0001"]); expect(JSON.parse(fs.readFileSync(f, "utf8")).sandboxScratch, "kept while the teardown is incomplete").toBe("/tmp/uasco-sbx-Tt0001");
    code = null; await m.recover(); expect(torn).toHaveLength(2); const after = JSON.parse(fs.readFileSync(f, "utf8")); expect(after.sandboxScratch).toBeNull(); expect(after.reason).toBe("STOP_REQUESTED");
    await m.recover(); expect(torn).toHaveLength(2);
  }, 30_000);

  it("D2: a refusal on top of an incomplete teardown keeps stopIncomplete + sandboxScratch (the next start retries the teardown or is refused 409); a post-spawn bridge failure with an incomplete teardown surfaces DEVRUN_STOP_INCOMPLETE", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    let code: string | null = "PROCESS_SURVIVED"; const {provider, st, release} = heldSpawnAsync({honourAbort: true, teardownCode: () => code}); release();
    const m = manager(dataDir, new ExecutionGate(provider));
    try {
      await m.start(p); await expect(m.stop(p.projectId)).rejects.toMatchObject({code: "DEVRUN_STOP_INCOMPLETE"});
      const keep = () => JSON.parse(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), "utf8"));
      expect(keep()).toMatchObject({stopIncomplete: "PROCESS_SURVIVED", sandboxScratch: "/tmp/uasco-sbx-Hd0001"});
      (provider as any).network = "ISOLATED"; // köprüsüz yalıtılmış sağlayıcı: bridgeSupport reddi (kapı reddi ile aynı yazım yolu)
      await expect(m.start(p)).rejects.toMatchObject({code: "DEVRUN_SANDBOX_UNAVAILABLE"});
      expect(keep()).toMatchObject({status: "BLOCKED", stopIncomplete: "PROCESS_SURVIVED", sandboxScratch: "/tmp/uasco-sbx-Hd0001"});
      (provider as any).network = "HOST";
      await expect(m.start(p)).rejects.toMatchObject({code: "DEVRUN_STOP_INCOMPLETE"}); expect(st.torn).toEqual(["/tmp/uasco-sbx-Hd0001"]);
      code = null; expect((await m.start(p)).status).toMatch(/RUNNING|STARTING/); expect(st.torn).toHaveLength(2);
    } finally { code = null; await m.close().catch(() => undefined); }
    const {app: app2, dataDir: d2} = mk(); const p2 = await createProject(app2, {template: "web-node"});
    const h2 = heldSpawnAsync({honourAbort: true, teardownCode: () => "PROCESS_SURVIVED"}); h2.release();
    const iso = {...h2.provider, id: "FAKE_ISOLATED", network: "ISOLATED", async bridge() { throw new Error("BRIDGE_X"); }};
    const m2 = manager(d2, new ExecutionGate(iso as any));
    try {
      await expect(m2.start(p2)).rejects.toMatchObject({code: "DEVRUN_STOP_INCOMPLETE", status: 409, reason: "PROCESS_SURVIVED"});
      expect(JSON.parse(fs.readFileSync(path.join(d2, "projects", p2.projectId, "devrun", "state.json"), "utf8"))).toMatchObject({stopIncomplete: "PROCESS_SURVIVED", sandboxScratch: "/tmp/uasco-sbx-Hd0001"});
    } finally { await m2.close().catch(() => undefined); }
  }, 90_000);

  it("C-8: the delivery link is on the STARTING placeholder (product stop works during STARTING); C-9: the manager-wide cap refuses the next start with 409 DEVRUN_CAPACITY", async () => {
    const {app, dataDir} = mk(); const p1 = await createProject(app, {template: "web-node"}), p2 = await createProject(app, {template: "web-node"});
    let release: (n: number) => void = () => undefined, reached = false;
    const gateP = new Promise<number>(r => { release = r; });
    const m = manager(dataDir, new ExecutionGate(TEST_HOST_PASSTHROUGH_SANDBOX as any), {maxConcurrent: 1, startTimeOf: async () => { reached = true; await new Promise(r => setTimeout(r, 400)); return null; }, freePort: async () => gateP});
    const link = {runId: "run_" + "c".repeat(24), headSha: git(path.join(dataDir, "projects", p1.projectId, "repo"), ["rev-parse", "HEAD"]).trim()};
    const first = m.start(p1, link);
    try {
      for (let i = 0; i < 100 && !reached; i++) await new Promise(r => setTimeout(r, 50));
      expect(m.view(p1)).toMatchObject({status: "STARTING", deliveryRunId: link.runId});
      await expect(m.start(p2)).rejects.toMatchObject({code: "DEVRUN_CAPACITY", status: 409});
      release(await (await import("../core/workos/devrun.js")).freeLoopbackPort()); await first;
      await expect(m.start(p2)).rejects.toMatchObject({code: "DEVRUN_CAPACITY"});
      await m.stop(p1.projectId); expect((await m.start(p2)).status).toMatch(/RUNNING|STARTING/);
    } finally { release(1); await first.catch(() => undefined); await m.stopAll("CLEANUP"); }
  }, T);

  it("with a provider bridge the product starts, the host reaches it ONLY on 127.0.0.1:<port> through the bridge, the run is tied to the delivery (runId + exact head), a wrong head is refused, and stop closes the bridge", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    const head = git(path.join(dataDir, "projects", p.projectId, "repo"), ["rev-parse", "HEAD"]).trim();
    // net: üst düzey import
    let innerPort = 0, bridgeCalls: number[] = [], closed = 0; const proxies = new Set<import("node:net").Socket>();
    const provider = {id: "FAKE_ISOLATED", network: "ISOLATED", async selfTest() { return {ok: true}; }, async run() { throw new Error("unused"); },
      spawn(c: string, a: string[], o: cp.SpawnOptions) { innerPort = Math.floor(30000 + Math.random() * 20000); return cp.spawn(c, a, {...o, env: {...(o.env as any), PORT: String(innerPort)}}); },
      async bridge(_child: cp.ChildProcess, port: number) {
        bridgeCalls.push(port);
        const srv = net.createServer(s => { const u = net.connect(innerPort, "127.0.0.1"); proxies.add(s); s.pipe(u); u.pipe(s); s.on("error", () => u.destroy()); u.on("error", () => s.destroy()); });
        await new Promise<void>(r => srv.listen(port, "127.0.0.1", () => r()));
        return {port, close() { closed++; srv.close(); for (const s of proxies) s.destroy(); }};
      }};
    const m = manager(dataDir, new ExecutionGate(provider as any));
    try {
      await expect(m.start(p, {runId: "run_" + "a".repeat(24), headSha: "b".repeat(40)})).rejects.toMatchObject({code: "DEVRUN_BLOCKED", reason: "DEVRUN_DELIVERY_HEAD_MISSING"});
      const v = await m.start(p, {runId: "run_" + "a".repeat(24), headSha: head});
      expect(v).toMatchObject({status: "RUNNING", bridged: true, deliveryRunId: "run_" + "a".repeat(24), headSha: head}); expect(v.preview.state).toBe("AVAILABLE");
      expect(bridgeCalls).toEqual([v.port]); expect(v.preview.url).toContain(`127.0.0.1:${v.port}`);
      const res = await fetch(`http://127.0.0.1:${v.port}/`); expect(res.status).toBe(200);
      await m.stop(p.projectId); expect(closed).toBe(1);
      await expect(fetch(`http://127.0.0.1:${v.port}/`)).rejects.toBeTruthy();
      expect(m.view(p).status).toBe("STOPPED");
    } finally { await m.stopAll("CLEANUP"); }
  }, T);

  const hostSpawn = (o: Record<string, unknown>) => ({...TEST_HOST_PASSTHROUGH_SANDBOX, ...o}) as any;
  it("C-5: a provider teardown code is recorded as STOP_INCOMPLETE:<code> with the scratch kept in the state; recover() retries the Linux-side teardown (teardownScratch) once the owner is dead and clears the record only on a clean result; a clean teardown drops the scratch", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    let code: string | null = "PROCESS_SURVIVED"; const torn: string[] = [];
    const provider = hostSpawn({async spawnAsync(c: string, a: string[], o: cp.SpawnOptions) { const ch: any = cp.spawn(c, a, o); ch.sandboxScratch = "/tmp/uasco-sbx-AbC123"; ch.sandboxTeardown = new Promise(res => ch.once("exit", () => res(code))); return ch; },
      async teardownScratch(sc: string) { torn.push(sc); return code; }});
    const m = manager(dataDir, new ExecutionGate(provider));
    try {
      await m.start(p);
      // NEW-2: kapatma temiz bitmedi => stop 'STOPPED' DEMEZ (409 DEVRUN_STOP_INCOMPLETE + kod)
      await expect(m.stop(p.projectId)).rejects.toMatchObject({code: "DEVRUN_STOP_INCOMPLETE", status: 409, reason: "PROCESS_SURVIVED"});
      for (let i = 0; i < 50 && m.view(p).reason !== "STOP_INCOMPLETE:PROCESS_SURVIVED"; i++) await new Promise(r => setTimeout(r, 100));
      expect(m.view(p)).toMatchObject({status: "STOPPED", reason: "STOP_INCOMPLETE:PROCESS_SURVIVED", stopIncomplete: "PROCESS_SURVIVED", sandboxScratch: "/tmp/uasco-sbx-AbC123"});
      const st = JSON.parse(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), "utf8")); st.instanceId = "dev_dead"; st.ownerPid = 2 ** 22 - 3; fs.writeFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), JSON.stringify(st));
      const m2 = manager(dataDir, new ExecutionGate(provider));
      await m2.recover(); expect(torn).toEqual(["/tmp/uasco-sbx-AbC123"]); expect(m2.view(p)).toMatchObject({stopIncomplete: "PROCESS_SURVIVED"});
      code = null; await m2.recover(); expect(torn).toEqual(["/tmp/uasco-sbx-AbC123", "/tmp/uasco-sbx-AbC123"]); expect(m2.view(p).stopIncomplete).toBeUndefined(); expect(m2.view(p).sandboxScratch).toBeNull();
      await m2.recover(); expect(torn.length).toBe(2);
      await m2.start(p); await m2.stop(p.projectId);
      for (let i = 0; i < 50 && m2.view(p).sandboxScratch !== null; i++) await new Promise(r => setTimeout(r, 100));
      expect(m2.view(p)).toMatchObject({status: "STOPPED", sandboxScratch: null}); expect(m2.view(p).stopIncomplete).toBeUndefined();
    } finally { await m.stopAll("CLEANUP"); }
  }, T);


  it("NEW-2: a new run for the same project is refused (409 DEVRUN_STOP_INCOMPLETE) while the previous provider teardown is incomplete - the record and scratch are not dropped; start retries the teardown first and proceeds only on a clean result", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    let code: string | null = "PROCESS_SURVIVED"; const torn: string[] = [];
    const provider = hostSpawn({async spawnAsync(c: string, a: string[], o: cp.SpawnOptions) { const ch: any = cp.spawn(c, a, o); ch.sandboxScratch = "/tmp/uasco-sbx-AbC123"; ch.sandboxTeardown = new Promise(res => ch.once("exit", () => res(code))); return ch; },
      async teardownScratch(sc: string) { torn.push(sc); return code; }});
    const m = manager(dataDir, new ExecutionGate(provider));
    try {
      await m.start(p); await expect(m.stop(p.projectId)).rejects.toMatchObject({code: "DEVRUN_STOP_INCOMPLETE"});
      await expect(m.start(p)).rejects.toMatchObject({code: "DEVRUN_STOP_INCOMPLETE", status: 409, reason: "PROCESS_SURVIVED"});
      expect(torn).toEqual(["/tmp/uasco-sbx-AbC123"]); expect(m.view(p)).toMatchObject({stopIncomplete: "PROCESS_SURVIVED", sandboxScratch: "/tmp/uasco-sbx-AbC123"}); // kayıt düşmedi
      code = null; const v = await m.start(p); expect(torn).toHaveLength(2); expect(v.status).toMatch(/RUNNING|STARTING/);
      expect(m.view(p).stopIncomplete).toBeUndefined();
    } finally { code = null; await m.stopAll("CLEANUP"); }
  }, T);

  it("NEW-3: the provider scratch is persisted right after spawn, BEFORE the (slow) bridge setup finishes, so an API crash in that window still leaves recover() the Linux-side handle", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    let startedBridge!: () => void; const bridging = new Promise<void>(r => { startedBridge = r; }); let finish!: () => void; const slow = new Promise<void>(r => { finish = r; });
    const provider = {id: "FAKE_ISOLATED", network: "ISOLATED", async selfTest() { return {ok: true}; }, async run() { throw new Error("unused"); },
      async spawnAsync(c: string, a: string[], o: cp.SpawnOptions) { const ch: any = cp.spawn(c, a, o); ch.sandboxScratch = "/tmp/uasco-sbx-Zz9Zz9"; return ch; },
      spawn(): never { throw new Error("unused"); },
      async bridge(_c: cp.ChildProcess, port: number) { startedBridge(); await slow; return {port, close() { /* kapalı */ }}; }};
    const m = manager(dataDir, new ExecutionGate(provider as any));
    const started = m.start(p).catch(e => e);
    try {
      await bridging;
      const st = JSON.parse(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "state.json"), "utf8"));
      expect(st).toMatchObject({status: "STARTING", sandboxScratch: "/tmp/uasco-sbx-Zz9Zz9"}); expect(st.pid).toBeGreaterThan(0);
    } finally { finish(); await started; await m.stopAll("CLEANUP"); }
  }, T);



  it.skipIf(process.platform !== "linux")("C-7: the Linux nsenter relay runs with an empty env, no_new_privs and an empty capability set (real nsenter into an unshared userns+netns holder; the relay 'node' is a probe script that prints what it runs with)", async () => {
    const {startNsenterBridge} = await import("../core/workos/devrun-bridge.js");
    const probeUserns = cp.spawnSync("unshare", ["-Urn", "true"]); if (probeUserns.status !== 0) return; // bu çekirdekte kullanıcı ad alanı yok: kanıtlanacak bir şey yok
    const holder = cp.spawn("unshare", ["-Urn", "sleep", "30"], {stdio: "ignore"}); const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-c7-"));
    const probe = path.join(dir, "probe.sh"); fs.writeFileSync(probe, "#!/bin/sh\ngrep -E '^(NoNewPrivs|CapInh|CapPrm|CapEff|CapBnd|CapAmb):' /proc/self/status\nenv\n", {mode: 0o755});
    process.env.UASCO_C7_CANARY_SECRET = "must-not-leak";
    try {
      const port = await freeLoopbackPort();
      const h = await startNsenterBridge(holder, port, {nsenterBinary: "/usr/bin/nsenter", nodeBinary: probe, isolationWaitMs: 3000});
      const out = await new Promise<string>((res, rej) => { const c = net.connect(port, "127.0.0.1"); let b = ""; c.on("data", d => b += d); c.on("close", () => res(b)); c.on("error", rej); setTimeout(() => res(b), 8000); });
      h.close();
      expect(out, out).toMatch(/NoNewPrivs:\s+1/);
      for (const k of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) expect(out, out).toMatch(new RegExp(`${k}:\\s+0000000000000000`));
      expect(out).not.toContain("must-not-leak"); expect(out).not.toContain("UASCO_C7_CANARY_SECRET");
    } finally { delete process.env.UASCO_C7_CANARY_SECRET; holder.kill("SIGKILL"); fs.rmSync(dir, {recursive: true, force: true}); }
  }, T);

  it("startNsenterBridge refuses a target that shares the host network namespace (it would expose host loopback), an exited/invalid pid and a bad port", async () => {
    const {startNsenterBridge} = await import("../core/workos/devrun-bridge.js");
    const idleChild = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"}); procs.push(idleChild);
    await expect(startNsenterBridge(idleChild, await freeLoopbackPort(), {nsenterBinary: "/usr/bin/nsenter", isolationWaitMs: 100})).rejects.toThrow(process.platform === "linux" ? "BRIDGE_TARGET_NOT_ISOLATED" : /./);
    await expect(startNsenterBridge(idleChild, 0, {nsenterBinary: "/usr/bin/nsenter"})).rejects.toThrow("BRIDGE_PORT_INVALID");
    await expect(startNsenterBridge({pid: undefined} as any, 8080, {nsenterBinary: "/usr/bin/nsenter"})).rejects.toThrow("BRIDGE_TARGET_MISSING");
    await expect(startNsenterBridge(idleChild, 8080, {nsenterBinary: null})).rejects.toThrow(/NSENTER_MISSING|BRIDGE_TARGET/);
  });

  // Gerçek ağ ad alanı: ip varsa (yoksa SKIP) sandbox-benzeri unshare --net içindeki sunucuya köprü 200 döner; köprü olmadan ana makineden erişilemez.
  it("REAL netns: a server inside a private user+net namespace is unreachable from the host directly and reachable ONLY through the nsenter bridge (skipped without ip/nsenter/unshare)", async ctx => {
    const have = (b: string) => cp.spawnSync("sh", ["-c", `command -v ${b}`]).status === 0;
    // Araç varlığı yetmez: GitHub ubuntu-24.04 gibi ana makineler kullanıcı ad alanını (AppArmor) engelleyebilir; gerçek yeteneği ayni komutla sına, yoksa SKIP (kesin neden yazdırılır).
    const userns = process.platform === "linux" && have("unshare") ? cp.spawnSync("unshare", ["--user", "--map-root-user", "--net", "true"], {encoding: "utf8"}) : null;
    if (process.platform !== "linux" || !have("ip") || !have("nsenter") || !userns || userns.status !== 0) { console.log(`REAL netns skipped: ${userns ? `unshare --user --map-root-user --net exit ${userns.status}: ${String(userns.stderr).trim().slice(0, 120)}` : "tools missing"}`); ctx.skip(); }
    const {startNsenterBridge} = await import("../core/workos/devrun-bridge.js");
    const inner = 20000 + Math.floor(Math.random() * 20000);
    const child = cp.spawn("unshare", ["--user", "--map-root-user", "--net", "--fork", "sh", "-c", `ip link set lo up && exec ${process.execPath} -e "require('http').createServer((q,r)=>r.end('inside')).listen(${inner},'127.0.0.1')"`], {stdio: "ignore", detached: true}); procs.push(child);
    await sleep(1500);
    const hostPort = await freeLoopbackPort();
    await expect(fetch(`http://127.0.0.1:${inner}/`)).rejects.toBeTruthy();
    const b = await startNsenterBridge(child, inner, {}).catch(e => e); // köprü portu = sandbox portu (dev-run ikisini aynı seçer)
    try { expect(b, String(b)).toHaveProperty("close"); const r = await fetch(`http://127.0.0.1:${inner}/`); expect(await r.text()).toBe("inside"); void hostPort; } finally { (b as any).close?.(); if (child.pid) killProcessTree(child.pid); }
  });

  // Gerçek sağlayıcı: yalnız selfTest geçer + loopback kanıtlanmış + nsenter varsa; aksi halde SKIP (kesin neden yazdırılır).
  it("REAL Linux provider: the generated web-node product starts inside the sandbox and the bridged port answers 200 (skipped unless selfTest passes with proven loopback)", async ctx => {
    const {LinuxUnshareSandboxProvider} = await import("../core/agents/linux-unshare-sandbox.js");
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const provider = new LinuxUnshareSandboxProvider(isRoot ? {acceptUnenforcedProcessLimit: true} : {});
    const st = await provider.selfTest();
    const sup = st.ok ? (await import("../core/workos/devrun-bridge.js")).bridgeSupport(provider as any) : null;
    console.log(`B-RUN-1 real provider: selfTest=${JSON.stringify(st)} bridge=${JSON.stringify(sup && (sup.ok ? "OK" : sup))}`);
    if (!st.ok || !sup || !sup.ok) ctx.skip();
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    const m = manager(dataDir, new ExecutionGate(provider as any), {startWaitMs: 30_000});
    try {
      const v = await m.start(p).catch(e => { throw new Error(`${e.code}:${e.reason}`); });
      expect(v).toMatchObject({status: "RUNNING", bridged: true}); expect(v.preview.state).toBe("AVAILABLE");
      const r = await fetch(`http://127.0.0.1:${v.port}/`); expect(r.status).toBe(200);
    } finally { await m.stopAll("CLEANUP"); }
  }, T);
  it("B-RUN-WIN-1: a provider with spawnAsync is used instead of spawn(); stop waits for the provider's Linux-side teardown; a stop that arrives while spawnAsync is still preparing kills the process it then returns", async () => {
    const {app, dataDir} = mk(); const p = await createProject(app, {template: "web-node"});
    // net: üst düzey import
    let inner = 0, teardownDone = false, release: () => void = () => undefined, entered: () => void = () => undefined, slow = false, spawnCalled = 0, killedLate = false;
    const mkProvider = () => ({id: "FAKE_WSL_LIKE", network: "ISOLATED", async selfTest() { return {ok: true}; }, async run() { throw new Error("unused"); },
      spawn() { spawnCalled++; throw new Error("sync spawn must not be used"); },
      async spawnAsync(c: string, a: string[], o: cp.SpawnOptions) {
        if (slow) { entered(); await new Promise<void>(r => { release = r; }); }
        inner = Math.floor(30000 + Math.random() * 20000);
        const child: any = cp.spawn(c, a, {...o, env: {...(o.env as any), PORT: String(inner)}});
        child.sandboxTeardown = new Promise<void>(res => child.once("exit", () => setTimeout(() => { teardownDone = true; if (slow) killedLate = true; res(); }, 300)));
        return child;
      },
      async bridge(_c: cp.ChildProcess, port: number) { const srv = net.createServer(s => { const u = net.connect(inner, "127.0.0.1"); s.pipe(u); u.pipe(s); s.on("error", () => u.destroy()); u.on("error", () => s.destroy()); }); await new Promise<void>(r => srv.listen(port, "127.0.0.1", () => r())); return {port, close() { srv.close(); }}; }});
    // 1) normal: start uses spawnAsync, stop resolves only after the teardown promise
    const m = manager(dataDir, new ExecutionGate(mkProvider() as any), {startWaitMs: 3000, graceMs: 200});
    try {
      const v = await m.start(p); expect(spawnCalled).toBe(0); expect(v.bridged).toBe(true); expect(v.pid).toBeGreaterThan(0);
      expect(teardownDone).toBe(false);
      await m.stop(p.projectId); expect(teardownDone).toBe(true);
    } finally { await m.stopAll("CLEANUP"); }
    // 2) stop while spawnAsync is preparing
    teardownDone = false; slow = true; const reached = new Promise<void>(r => { entered = r; });
    const m2 = manager(dataDir, new ExecutionGate(mkProvider() as any), {startWaitMs: 3000, graceMs: 200});
    try {
      const starting = m2.start(p).catch(e => e); await reached;
      const stopping = m2.stop(p.projectId); await sleep(100); release();
      await Promise.race([starting, sleep(20_000)]); await stopping;
      await sleep(800); expect(killedLate).toBe(true); expect(m2.view(p).status).toBe("STOPPED");
    } finally { await m2.stopAll("CLEANUP"); }
  }, T);
});
