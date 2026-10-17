// //TR: Bu test PS-1A c3 düzeltmelerini gerçek geçici dizin/git, gerçek Windows 8.3 kısa adları, junction'lar ve gerçek alt süreçlerle doğrular (ağ yok, AI sağlayıcı yok): PS1A-C2-F1 (kanonik yol: 8.3 kısa ad/junction/UNC/aygıt takma adlarıyla veri dizini, projects kökü veya başka tenant'ın yönetilen deposu proje oluşturma, import, Studio route'ları ve runner klonunda kabul edilmez; kendi yönetilen proje uçtan uca çalışır) ve PS1A-C2-F2 (dev süreci çöktüğünde ayrık torun süreçler hayatta kalmaz).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./support/test-sandbox.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import cp from "node:child_process";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {buildServer} from "../apps/control-api/src/server.js";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {ProjectStudio, StudioError} from "../core/workos/project-studio.js";
import {canonicalPath, pathOverlapsDataDir, managedRepoCanonical} from "../core/workos/path-guard.js";
import {killProcessTree, pidAlive, treeDescendants} from "../core/workos/devrun.js";
import type {Project} from "../core/workos/types.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 240_000;
const WIN = process.platform === "win32";
// Token çalışma anında üretilir; repoda gerçek secret yoktur.
const TOKEN = `tok-${crypto.randomBytes(16).toString("hex")}`;
const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
type App = ReturnType<typeof buildServer>;
let tmp = "", ext = "";
const apps: App[] = [];
const pids: number[] = [];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "uasco-ps1a-c3-longname-"));
  ext = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "uasco-ps1a-c3-external-"));
});
afterEach(async () => {
  for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
  for (const p of pids.splice(0)) if (pidAlive(p)) killProcessTree(p);
  for (const d of [tmp, ext]) { try { fs.rmSync(d, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } }
});

function mk(o: {tenantId?: string; dataDir?: string; runtime?: string} = {}) {
  const runtime = o.runtime ?? path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
  const dataDir = o.dataDir ?? path.join(tmp, "datadirectory-long");
  const app = buildServer({sandbox: TEST_HOST_PASSTHROUGH_SANDBOX, controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, port: 3210, logger: false, tenantId: o.tenantId ?? "tA",
    studio: {devrun: {probeIntervalMs: 150, stopPollMs: 150, treeSnapshotMs: 200}}});
  apps.push(app);
  return {app, runtime, dataDir};
}
const call = (app: App, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({method, url, headers: HDR, ...(payload !== undefined ? {payload: payload as object} : {})});
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T> | T, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms; let last = await fn();
  while (!ok(last) && Date.now() < end) { await sleep(100); last = await fn(); }
  return last;
}
const httpGet = (url: string) => new Promise<{status: number; body: string}>((resolve, reject) => {
  http.get(url, {agent: false}, res => { let b = ""; res.setEncoding("utf8"); res.on("data", c => { b += c; }); res.on("end", () => resolve({status: res.statusCode ?? 0, body: b})); }).on("error", reject);
});
async function createProject(app: App, extra: Record<string, unknown> = {}) {
  const r = await call(app, "POST", "/v1/projects", {name: "Studio App", environmentId: "dev", ...extra});
  expect(r.statusCode, r.body).toBe(201);
  return r.json().project as Project;
}
const devrun = async (app: App, id: string) => (await call(app, "GET", `/v1/projects/${id}/devrun`)).json().devrun;
// Gerçek 8.3 kısa ad: cmd'nin %~sI genişletmesi (Windows dosya sistemi tarafından üretilir).
function shortName(p: string): string | null {
  if (!WIN) return null;
  const r = cp.spawnSync("cmd.exe", ["/d", "/s", "/c", `for %I in ("${p}") do @echo %~sI`], {encoding: "utf8", windowsVerbatimArguments: true, windowsHide: true});
  const s = String(r.stdout ?? "").trim();
  return r.status === 0 && s && s.toLowerCase() !== p.toLowerCase() && /~\d/.test(s) ? s : null;
}
function initRepo(dir: string, files: Record<string, string>) {
  fs.mkdirSync(dir, {recursive: true});
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  git(dir, ["init", "-q", "-b", "main"]); git(dir, ["add", "-A"]); git(dir, ["-c", "user.name=T", "-c", "user.email=t@local.invalid", "commit", "-q", "-m", "init"]);
}
const STUDIO_GETS = (head: string) => ["files", "file?path=README.md", "git/log", `git/diff?from=${head}`];

describe("PS1A-C2-F1: canonical (8.3 / junction / UNC safe) path containment", () => {
  it("expands a real 8.3 short-name alias with realpathSync.native and refuses it (unit level)", (ctx) => {
    const long = path.join(tmp, "averyverylongdirectoryname");
    fs.mkdirSync(long);
    const s = shortName(long);
    if (!s) { ctx.skip("8.3 short names are not available on this volume/platform"); return; }
    // Kanıt: JS realpathSync kısa adı açmaz, native açar.
    expect(fs.realpathSync(s).toLowerCase()).not.toBe(long.toLowerCase());
    expect(fs.realpathSync.native(s).toLowerCase()).toBe(long.toLowerCase());
    const c = canonicalPath(s);
    expect(c.ok && c.key).toBe(long.toLowerCase());
    // Var olmayan alt yol: en yakın var olan ata açılır.
    const c2 = canonicalPath(path.join(s, "not-yet", "child"));
    expect(c2.ok && c2.key).toBe(path.join(long, "not-yet", "child").toLowerCase());
    expect(pathOverlapsDataDir(s, long)).toMatchObject({forbidden: true});
    expect(pathOverlapsDataDir(path.join(s, "x"), long)).toMatchObject({forbidden: true});
    expect(pathOverlapsDataDir(tmp, path.join(s, "x"))).toMatchObject({forbidden: true});
    // Açılamayan kısa ad (var olmayan "~<rakam>" segmenti) fail-closed.
    expect(canonicalPath(path.join(ext, "NOPE~1", "x"))).toEqual({ok: false, reason: "PATH_SHORT_NAME_UNRESOLVED"});
    // UNC/aygıt biçimleri.
    for (const u of ["\\\\?\\" + long, "\\\\.\\" + long, "\\\\server\\share\\x", "//?/C:/x", "//server/share"]) expect(canonicalPath(u), u).toEqual({ok: false, reason: "PATH_UNC_OR_DEVICE"});
    // Win32 sondaki nokta/boşluk normalizasyonu: var olmayan "data." veri dizinine eşlenir.
    expect(pathOverlapsDataDir(path.join(tmp, "nodata."), path.join(tmp, "nodata"))).toMatchObject({forbidden: true});
    expect(pathOverlapsDataDir(ext, long)).toMatchObject({forbidden: false});
  });

  it("refuses 8.3 aliases of dataDir, <dataDir>/projects and another tenant's managed repo at create, import, every Studio route and the runner clone", async (ctx) => {
    const b = mk({tenantId: "tB"});
    const pb = await createProject(b.app, {template: "web-node"});
    const bRepo = pb.repository!.path!;
    const bExport = await call(b.app, "POST", `/v1/projects/${pb.projectId}/export`, {});
    expect(bExport.statusCode, bExport.body).toBe(201);
    const bZip = path.join(b.dataDir, "exports", `${bExport.json().export.exportId}.zip`);
    const sData = shortName(b.dataDir), sRepo = shortName(bRepo), sTmp = shortName(tmp), sZip = shortName(bZip);
    if (!sData || !sRepo || !sTmp || !sZip) { ctx.skip("8.3 short names are not available on this volume/platform"); return; }
    const sProjects = path.join(sData, "projects");
    expect(fs.realpathSync(sRepo).toLowerCase()).not.toBe(fs.realpathSync.native(bRepo).toLowerCase()); // JS realpath bu takma adı açamaz (c2 açığının kökü)
    const a = mk({tenantId: "tA", dataDir: b.dataDir, runtime: b.runtime});
    const aliases = [sData, sProjects, sRepo, path.join(sRepo, "README.md"), sTmp, path.join(sData, "journal.jsonl")];
    // 1) Proje oluşturma.
    for (const p of aliases) {
      const r = await call(a.app, "POST", "/v1/projects", {name: "X", environmentId: "dev", repository: {path: p}});
      expect(r.statusCode, p).toBe(400);
      expect(r.json(), p).toEqual({error: "REPOSITORY_PATH_FORBIDDEN"});
    }
    expect((await call(a.app, "GET", "/v1/projects")).json().projects).toEqual([]);
    // 2) Import (git + zip).
    const pa = await createProject(a.app, {});
    for (const [kind, p] of [["git", sRepo], ["git", sData], ["git", sProjects], ["git", sTmp], ["zip", sZip]] as const) {
      const r = await call(a.app, "POST", `/v1/projects/${pa.projectId}/import`, {kind, path: p});
      expect(r.statusCode, `${kind} ${p} ${r.body}`).toBe(400);
      expect(r.json(), p).toEqual({error: "IMPORT_REJECTED", reason: "IMPORT_SOURCE_FORBIDDEN"});
    }
    expect(fs.existsSync(path.join(b.dataDir, "projects", pa.projectId, "repo"))).toBe(false);
    // 3) Studio route'ları: journal'a doğrudan yazılmış (API dışı) takma adlı kayıtlar.
    const store = new WorkOsStore(b.dataDir);
    const mkStore = (repository?: {path: string}) => store.createProject({tenantId: "tA", orgId: "local", name: "S", environmentId: "dev", createdBy: "FOUNDER_LOCAL", ...(repository ? {repository} : {}), devCommand: ["node", "server.js"], testCommand: ["node", "-e", "0"]});
    const head = git(bRepo, ["rev-parse", "HEAD"]);
    const unmanaged = [sData, sProjects, sRepo].map(p => mkStore({path: p}));
    const managedAlias = mkStore();
    store.setProjectRepository({tenantId: "tA"}, managedAlias.projectId, {path: sRepo, managed: true}, "FOUNDER_LOCAL", {kind: "git", headSha: head});
    const managedProjects = mkStore();
    store.setProjectRepository({tenantId: "tA"}, managedProjects.projectId, {path: sProjects, managed: true}, "FOUNDER_LOCAL", {kind: "git", headSha: head});
    const a2 = mk({tenantId: "tA", dataDir: b.dataDir, runtime: b.runtime});
    for (const p of [...unmanaged, managedAlias, managedProjects]) {
      for (const g of STUDIO_GETS(head)) {
        const r = await call(a2.app, "GET", `/v1/projects/${p.projectId}/${g}`);
        expect(r.statusCode, `${p.projectId} ${g} ${r.body}`).toBe(409);
        expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
      }
      for (const u of ["export", "devrun/start", "devrun/restart", "devrun/stop"]) {
        const r = await call(a2.app, "POST", `/v1/projects/${p.projectId}/${u}`, {});
        expect(r.statusCode, `${p.projectId} ${u} ${r.body}`).toBe(409);
        expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
      }
    }
    expect(fs.readdirSync(path.join(b.dataDir, "exports")).filter(f => f.endsWith(".zip"))).toHaveLength(1);
    // Modül seviyesi.
    const studio = new ProjectStudio({dataDir: b.dataDir, envPolicyFile: ENV_POLICY});
    expect(() => studio.managedRepoRoot({...pb, projectId: managedAlias.projectId, tenantId: "tA", repository: {path: sRepo, managed: true}})).toThrow(/REPOSITORY_NOT_MANAGED/);
    expect(managedRepoCanonical(b.dataDir, managedAlias.projectId, sRepo)).toBeNull();
    // Aynı projenin kendi deposunun kısa adı kendisine eşittir (aynı tenant, aynı proje).
    expect(managedRepoCanonical(b.dataDir, pb.projectId, sRepo)?.toLowerCase()).toBe(fs.realpathSync.native(bRepo).toLowerCase());
    // 4) Runner klonu (derinlemesine savunma): takma adlı yönetilmeyen/yönetilen kayıtlar klonlanmaz.
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
    const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir: b.dataDir, globalStopFile: path.join(b.runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY, executors: fake.pair(), retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${b.dataDir}-sec`).options});
    const expectBlocked: Array<[Project, string]> = [...unmanaged.map(p => [p, "REPOSITORY_PATH_FORBIDDEN"] as [Project, string]), [managedAlias, "REPOSITORY_NOT_MANAGED"], [managedProjects, "REPOSITORY_NOT_MANAGED"]];
    const runIds: string[] = [];
    for (const [p] of expectBlocked) {
      const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "t", objective: "o", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
      const pair = fake.pair();
      runIds.push(store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}).runId);
    }
    for (let i = 0; i < expectBlocked.length + 2; i++) await runner.tick();
    expectBlocked.forEach(([, reason], i) => {
      const r = store.getRun({tenantId: "tA"}, runIds[i])!;
      expect(r.reason, `${r.runId} ${r.status}`).toBe(reason);
      expect(r.evidence.some(e => e.kind === "WORKSPACE")).toBe(false);
      expect(fs.existsSync(path.join(b.dataDir, "runs", r.runId, "work"))).toBe(false);
    });
    // B kendi deposunu kullanmaya devam eder.
    expect((await call(b.app, "GET", `/v1/projects/${pb.projectId}/file?path=README.md`)).statusCode).toBe(200);
  }, T);

  it("refuses junction aliases (create, import, Studio routes) and a managed repo dir replaced by a junction", async (ctx) => {
    const b = mk({tenantId: "tB"});
    const pb = await createProject(b.app, {template: "web-node"});
    const bRepo = pb.repository!.path!;
    const jData = path.join(ext, "j-data"), jRepo = path.join(ext, "j-repo"), jAbove = path.join(ext, "j-above");
    try { fs.symlinkSync(b.dataDir, jData, "junction"); fs.symlinkSync(bRepo, jRepo, "junction"); fs.symlinkSync(tmp, jAbove, "junction"); }
    catch (e) { ctx.skip(`junction/symlink creation not permitted on this host: ${(e as NodeJS.ErrnoException).code}`); return; }
    const a = mk({tenantId: "tA", dataDir: b.dataDir, runtime: b.runtime});
    for (const p of [jData, path.join(jData, "projects"), jRepo, jAbove, path.join(jData, "projects", "not-yet")]) {
      const r = await call(a.app, "POST", "/v1/projects", {name: "X", environmentId: "dev", repository: {path: p}});
      expect(r.statusCode, p).toBe(400);
      expect(r.json()).toEqual({error: "REPOSITORY_PATH_FORBIDDEN"});
    }
    const pa = await createProject(a.app, {});
    for (const p of [jRepo, jData, jAbove]) {
      const r = await call(a.app, "POST", `/v1/projects/${pa.projectId}/import`, {kind: "git", path: p});
      expect(r.statusCode, p).toBe(400);
      expect(r.json()).toEqual({error: "IMPORT_REJECTED", reason: "IMPORT_SOURCE_FORBIDDEN"});
    }
    // Yönetilen depo dizininin kendisi başka bir projenin deposuna junction ile değiştirilirse (API dışı) Studio reddeder.
    const store = new WorkOsStore(b.dataDir);
    const px = store.createProject({tenantId: "tA", orgId: "local", name: "S", environmentId: "dev", createdBy: "FOUNDER_LOCAL", devCommand: ["node", "server.js"]});
    const own = path.join(b.dataDir, "projects", px.projectId, "repo");
    fs.mkdirSync(path.dirname(own), {recursive: true});
    fs.symlinkSync(bRepo, own, "junction");
    store.setProjectRepository({tenantId: "tA"}, px.projectId, {path: own, managed: true}, "FOUNDER_LOCAL", {kind: "git", headSha: git(bRepo, ["rev-parse", "HEAD"])});
    const pj = store.createProject({tenantId: "tA", orgId: "local", name: "S", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: jRepo}});
    const a2 = mk({tenantId: "tA", dataDir: b.dataDir, runtime: b.runtime});
    for (const p of [px, pj]) for (const g of ["files", "file?path=README.md", "git/log"]) {
      const r = await call(a2.app, "GET", `/v1/projects/${p.projectId}/${g}`);
      expect(r.statusCode, `${g} ${r.body}`).toBe(409);
      expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
    }
    const studio = new ProjectStudio({dataDir: b.dataDir, envPolicyFile: ENV_POLICY});
    expect(() => studio.managedRepoRoot(store.getProject({tenantId: "tA"}, px.projectId)!)).toThrow(StudioError);
  }, T);

  it("refuses UNC/device and unresolvable short-name paths, and every Studio route on an unmanaged project", async () => {
    const {app} = mk();
    const unc = ["\\\\?\\" + tmp, "\\\\.\\" + tmp, "\\\\server\\share\\repo", "//?/" + tmp.replace(/\\/g, "/"), path.join(ext, "ABCDEF~1")];
    for (const p of unc) {
      const r = await call(app, "POST", "/v1/projects", {name: "X", environmentId: "dev", repository: {path: p}});
      expect(r.statusCode, p).toBe(WIN || !p.includes("~") ? 400 : 201);
      if (r.statusCode === 400) expect(r.json()).toEqual({error: "REPOSITORY_PATH_FORBIDDEN"});
    }
    const pa = await createProject(app, {});
    for (const p of unc.slice(0, 4)) {
      const r = await call(app, "POST", `/v1/projects/${pa.projectId}/import`, {kind: "git", path: p});
      expect(r.statusCode, p).toBe(400);
      expect(r.json()).toEqual({error: "IMPORT_REJECTED", reason: "IMPORT_REMOTE_NOT_SUPPORTED"});
    }
    // Yönetilmeyen (dışarıdaki, meşru) proje: kayıt kabul edilir ama Studio route'ları 409; import ile yönetilen depoya alınabilir.
    initRepo(path.join(ext, "legacy"), {"README.md": "legacy\n", "server.js": "require('http').createServer((q, r) => r.end('legacy')).listen(+process.env.PORT, '127.0.0.1');\n"});
    const legacy = await createProject(app, {repository: {path: path.join(ext, "legacy")}, devCommand: ["node", "server.js"]});
    for (const g of ["files", "file?path=README.md", "git/log", "git/diff?from=HEAD"]) {
      const r = await call(app, "GET", `/v1/projects/${legacy.projectId}/${g}`);
      expect(r.statusCode, g).toBe(409);
      expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
    }
    for (const u of ["export", "devrun/start", "devrun/restart", "devrun/stop"]) {
      const r = await call(app, "POST", `/v1/projects/${legacy.projectId}/${u}`, {});
      expect(r.statusCode, u).toBe(409);
      expect(r.json()).toEqual({error: "REPOSITORY_NOT_MANAGED"});
    }
    const imp = await call(app, "POST", `/v1/projects/${legacy.projectId}/import`, {kind: "git", path: path.join(ext, "legacy")});
    expect(imp.statusCode, imp.body).toBe(200);
    const f = await call(app, "GET", `/v1/projects/${legacy.projectId}/file?path=README.md`);
    expect(f.statusCode, f.body).toBe(200);
    expect(f.json().text).toBe("legacy\n");
  }, T);

  it("keeps the own managed project working end-to-end when dataDir itself is given as an 8.3 alias (template -> devrun -> preview -> export)", async (ctx) => {
    const longData = path.join(tmp, "datadirectory-long");
    fs.mkdirSync(longData, {recursive: true});
    const sData = shortName(longData);
    if (!sData) { ctx.skip("8.3 short names are not available on this volume/platform"); return; }
    const {app} = mk({dataDir: sData});
    const p = await createProject(app, {template: "web-node"});
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/files`)).statusCode).toBe(200);
    // Kısa ad '.git' gizleme kuralını aşamaz (GIT~1).
    const repoLong = fs.realpathSync.native(p.repository!.path!);
    const gitShort = shortName(path.join(repoLong, ".git"));
    if (gitShort) {
      const r = await call(app, "GET", `/v1/projects/${p.projectId}/file?path=${encodeURIComponent(`${path.basename(gitShort)}/HEAD`)}`);
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json().error).toBe("PATH_REJECTED");
    }
    const s = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(s.statusCode, s.body).toBe(200);
    const v = await until(() => devrun(app, p.projectId), d => d.preview.state === "AVAILABLE");
    expect(v.preview.url).toBe(`http://127.0.0.1:${v.port}/`);
    expect((await httpGet(v.preview.url)).status).toBeLessThan(500);
    const st = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/stop`, {});
    expect(st.json().devrun.status).toBe("STOPPED");
    expect(pidAlive(v.pid)).toBe(false);
    const ex = await call(app, "POST", `/v1/projects/${p.projectId}/export`, {});
    expect(ex.statusCode, ex.body).toBe(201);
    expect(ex.json().export.secretScan.status).toBe("CLEAN");
  }, T);
});

describe("PS1A-C2-F2: a crashed dev process leaves no live descendants", () => {
  it("treeDescendants follows ppid only with consistent creation times (pid reuse safe)", () => {
    const procs = [
      {pid: 100, ppid: 1, created: 5_000},        // kök pid'i yeniden kullanılmış (yeni süreç)
      {pid: 200, ppid: 100, created: 2_000},      // eski kökün gerçek çocuğu
      {pid: 201, ppid: 100, created: 6_000},      // yeni (ilgisiz) sahibin çocuğu
      {pid: 300, ppid: 200, created: 2_500},      // torun
      {pid: 400, ppid: 999, created: 3_000},      // ara ebeveyni ölmüş torun (kayıtta biliniyor)
      {pid: 500, ppid: 998, created: 3_000},      // bilinmeyen
      {pid: 600, ppid: 999, created: 9_000}       // 999 yeniden kullanılmış sonra oluştu: hayır
    ];
    const got = treeDescendants([...procs, {pid: 999, ppid: 1, created: 8_000}], {pid: 100, notBefore: 1_000, startTime: 1_000}, new Map([[999, 1_500]])).map(p => p.pid).sort();
    expect(got).toEqual([200, 300, 400]);
  });

  it("kills a detached grandchild when the dev root crashes, and a snapshot-tracked grandchild whose parent exited first", async () => {
    const {app} = mk();
    const g1 = path.join(ext, "g1.pid"), g2 = path.join(ext, "g2.pid");
    const idleJs = "setInterval(() => {}, 1000)";
    // Kök: (a) ayrık torun başlatır, (b) torun başlatıp 3 sn sonra çıkan bir ara süreç başlatır, sonra 6 sn'de 7 koduyla çöker.
    const mid = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(idleJs)}],{detached:true,stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(g2)},String(c.pid));c.unref();setTimeout(()=>process.exit(0),3000);`;
    const root = `const cp=require('child_process');const c=cp.spawn(process.execPath,['-e',${JSON.stringify(idleJs)}],{detached:true,stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(g1)},String(c.pid));c.unref();`
      + `cp.spawn(process.execPath,['-e',${JSON.stringify(mid)}],{detached:true,stdio:'ignore'}).unref();require('http').createServer((q,r)=>r.end('ok')).listen(+process.env.PORT,'127.0.0.1');setTimeout(()=>process.exit(7),6000);`;
    const p = await createProject(app, {template: "web-node", devCommand: ["node", "-e", root]});
    // Kontrol: ilgisiz süreç dokunulmadan kalmalı.
    const bystander = cp.spawn(process.execPath, ["-e", idleJs], {stdio: "ignore", windowsHide: true});
    pids.push(bystander.pid!);
    const s = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(s.statusCode, s.body).toBe(200);
    await until(() => fs.existsSync(g1) && fs.existsSync(g2), x => x, 15_000);
    const gp1 = Number(fs.readFileSync(g1, "utf8")), gp2 = Number(fs.readFileSync(g2, "utf8"));
    pids.push(gp1, gp2);
    expect(pidAlive(gp1) && pidAlive(gp2)).toBe(true);
    const c = await until(() => devrun(app, p.projectId), d => d.status === "CRASHED" && Boolean(d.treeCleanup), 60_000);
    expect(c).toMatchObject({status: "CRASHED", exitCode: 7, reason: "PROCESS_EXITED:7"});
    // Linux: süreç grubu + kaydedilmiş soy (setsid ile gruptan kaçan ayrık torunlar) ppid yürüyüşü; Windows: ppid yürüyüşü.
    expect(c.treeCleanup.method).toBe(WIN ? "PPID_WALK" : process.platform === "linux" ? "PROCESS_GROUP_PPID_WALK" : "PROCESS_GROUP");
    expect(c.treeCleanup.survivors).toBe(0);
    await until(() => !pidAlive(gp1) && !pidAlive(gp2), x => x, 10_000);
    expect(pidAlive(gp1)).toBe(false);
    expect(pidAlive(gp2)).toBe(false);
    expect(pidAlive(c.pid)).toBe(false);
    expect(pidAlive(bystander.pid!)).toBe(true);
    // Ağaç temizlendikten sonra yeniden başlatma normal çalışır.
    fs.rmSync(g1); fs.rmSync(g2);
    const r = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(r.statusCode, r.body).toBe(200);
    await until(() => fs.existsSync(g1) && fs.existsSync(g2), x => x, 15_000);
    const gp3 = Number(fs.readFileSync(g1, "utf8")), gp4 = Number(fs.readFileSync(g2, "utf8")); pids.push(gp3, gp4);
    const stop = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/stop`, {});
    expect(stop.json().devrun.status).toBe("STOPPED");
    await until(() => !pidAlive(gp3) && !pidAlive(gp4), x => x, 10_000);
    expect(pidAlive(gp3)).toBe(false);
    expect(pidAlive(gp4)).toBe(false);
  }, T);
});
