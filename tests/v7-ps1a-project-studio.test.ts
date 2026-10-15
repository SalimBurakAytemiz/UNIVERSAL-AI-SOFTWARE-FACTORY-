// //TR: Bu test PS-1A Project Studio arka ucunu gerçek geçici dizin/git ve gerçek alt süreçlerle doğrular (ağ yok, AI sağlayıcı yok): şablonla yönetilen depo, yerel git/ZIP içe aktarma (zip-slip/symlink/boyut reddi), dev-run + gerçek HTTP önizleme, çökme/yeniden başlatma/tek örnek, GLOBAL_STOP, API yeniden başlangıcında orphan kurtarma, dosya/git görünümü güvenliği ve redaksiyonu, export içeriği ve secret engeli, executor kurulumu (sahte provenance yakalayıcı) ve her yeni route için tenant izolasyonu.
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
import {activateGlobalStop, clearGlobalStop} from "../automation/lib/global-stop.mjs";
import {buildServer} from "../apps/control-api/src/server.js";
import type {BuildServerOptions} from "../apps/control-api/src/server.js";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {listZipEntries, readZipEntry, writeZip, crc32, ZipError} from "../core/workos/zip.js";
import {pidAlive, processStartTime} from "../core/workos/devrun.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
// Token ve sahte secret değerleri çalışma anında parçalardan kurulur; repoda gerçek secret yoktur.
const TOKEN = `tok-${crypto.randomBytes(16).toString("hex")}`;
const FAKE_AWS = ["AK", "IA", "Q7ZX3MPLW2RT5VB9"].join("");
const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ps1a-")); });
afterEach(async () => {
  for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ }
});

function mk(o: {tenantId?: string; dataDir?: string; runtime?: string; extra?: Partial<BuildServerOptions>} = {}) {
  const runtime = o.runtime ?? path.join(tmp, "runtime"); fs.mkdirSync(runtime, {recursive: true});
  const dataDir = o.dataDir ?? path.join(tmp, "data");
  const {studio, ...rest} = o.extra ?? {};
  const app = buildServer({sandbox: TEST_HOST_PASSTHROUGH_SANDBOX, controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, port: 3210, logger: false, tenantId: o.tenantId ?? "tA",
    studio: {...(studio ?? {}), devrun: {probeIntervalMs: 150, stopPollMs: 150, ...(studio?.devrun ?? {})}}, ...rest});
  apps.push(app);
  return {app, runtime, dataDir};
}
const call = (app: App, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({method, url, headers: HDR, ...(payload !== undefined ? {payload: payload as object} : {})});
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const commitAs = (repo: string, msg: string) => { git(repo, ["add", "-A"]); git(repo, ["-c", "user.name=Test", "-c", "user.email=test@local.invalid", "commit", "-q", "-m", msg]); return git(repo, ["rev-parse", "HEAD"]); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<X>(fn: () => Promise<X>, ok: (x: X) => boolean, ms = 30_000): Promise<X> {
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
  return r.json().project as {projectId: string; repository?: {path: string; managed?: boolean}; testCommand?: string[]; devCommand?: string[]; projectType?: string};
}
const devrun = async (app: App, id: string) => (await call(app, "GET", `/v1/projects/${id}/devrun`)).json().devrun;
function treeDigest(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string) => { for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); h.update(path.relative(dir, f)); if (e.isDirectory()) walk(f); else h.update(fs.readFileSync(f)); } };
  walk(dir); return h.digest("hex");
}

describe("PS-1A templates and managed repositories (PS-001/002)", () => {
  it("web-node template creates a managed repo with an engine-identity initial commit and a passing test; replay is idempotent", async () => {
    const {app, dataDir} = mk();
    const body = {name: "Shop Front", environmentId: "dev", template: "web-node", techStack: ["node"], targetOS: ["web"], acceptanceCriteria: ["index page loads"], budget: {maxRuns: 1, maxTokens: 1000}, idempotencyKey: "tpl-1"};
    const r = await call(app, "POST", "/v1/projects", body);
    expect(r.statusCode, r.body).toBe(201);
    const p = r.json().project;
    expect(p.repository).toEqual({path: path.join(path.resolve(dataDir), "projects", p.projectId, "repo"), managed: true});
    expect(p).toMatchObject({template: "web-node", projectType: "web", testCommand: ["node", "test.js"], devCommand: ["node", "server.js"], techStack: ["node"], targetOS: ["web"], budget: {maxRuns: 1, maxTokens: 1000}});
    const repo = p.repository.path;
    expect(git(repo, ["log", "--format=%an <%ae>|%s"])).toBe("UASCO Project Studio <studio@local.invalid>|Initial commit from template web-node");
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["ls-files"]).split("\n").sort()).toEqual([".gitignore", "README.md", "package.json", "public/index.html", "server.js", "test.js"]);
    const clone = path.join(tmp, "verify-clone"); git(tmp, ["clone", "-q", repo, clone]);
    expect(cp.spawnSync(process.execPath, ["test.js"], {cwd: clone, encoding: "utf8"}).status).toBe(0);
    const again = await call(app, "POST", "/v1/projects", body);
    expect(again.statusCode).toBe(200);
    expect(again.json().project.projectId).toBe(p.projectId);
    expect(fs.readdirSync(path.join(dataDir, "projects")).filter(x => x.startsWith("prj_"))).toEqual([p.projectId]);
    expect((await call(app, "POST", "/v1/projects", {...body, idempotencyKey: "tpl-2", repository: {path: tmp}})).statusCode).toBe(400);
    expect((await call(app, "POST", "/v1/projects", {name: "x", environmentId: "dev", template: "rails"})).statusCode).toBe(400);
    expect((await call(app, "POST", "/v1/projects", {name: "x", environmentId: "dev", devCommand: ["bash", "-c", "x"]})).statusCode).toBe(400);
    // budget.maxRuns: ikinci run reddedilir (Work OS store).
    const store = new WorkOsStore(dataDir);
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "t", "FOUNDER_LOCAL");
    const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "A", reviewer: "B"}, createdBy: "FOUNDER_LOCAL"});
    for (const to of ["CANCELLING", "CANCELLED"] as const) store.transitionRun(run.runId, null, to, "t", "T");
    const m2 = store.createMission({tenantId: "tA", projectId: p.projectId, title: "t2", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m2.missionId, to, "t", "FOUNDER_LOCAL");
    expect(() => store.createRun({tenantId: "tA", missionId: m2.missionId, executor: {implementer: "A", reviewer: "B"}, createdBy: "FOUNDER_LOCAL"})).toThrow(/PROJECT_RUN_BUDGET_EXHAUSTED/);
  }, T);

  it("node-lib has a passing test and empty has no runnable code", async () => {
    const {app} = mk();
    const lib = await createProject(app, {template: "node-lib"});
    expect(lib).toMatchObject({projectType: "library", testCommand: ["node", "test.js"]});
    expect(lib.devCommand).toBeUndefined();
    expect(cp.spawnSync(process.execPath, ["test.js"], {cwd: lib.repository!.path, encoding: "utf8"}).status).toBe(0);
    const empty = await createProject(app, {template: "empty"});
    expect(empty.testCommand).toBeUndefined();
    expect(git(empty.repository!.path, ["ls-files"]).split("\n").sort()).toEqual([".gitignore", "README.md"]);
  }, T);
});

describe("PS-1A import (PS-003)", () => {
  it("git import clones a local repository into the managed repo and leaves the original untouched", async () => {
    const {app} = mk();
    const src = path.join(tmp, "orig"); fs.mkdirSync(src);
    git(src, ["init", "-q", "-b", "main"]);
    fs.writeFileSync(path.join(src, "app.js"), "module.exports = 1;\n"); fs.writeFileSync(path.join(src, "test.js"), "require('node:assert').equal(require('./app.js'), 1);\n");
    const head = commitAs(src, "seed");
    const before = treeDigest(src);
    const p = await createProject(app, {testCommand: ["node", "test.js"]});
    expect(p.repository).toBeUndefined();
    for (const bad of ["https://example.invalid/r.git", "git@example.invalid:r.git", "relative/path", "\\\\server\\share\\repo", "file:///tmp/x"]) {
      const r = await call(app, "POST", `/v1/projects/${p.projectId}/import`, {kind: "git", path: bad});
      expect(r.statusCode, bad).toBe(400);
      expect(r.json().error).toBe("IMPORT_REJECTED");
    }
    const r = await call(app, "POST", `/v1/projects/${p.projectId}/import`, {kind: "git", path: src});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().import).toEqual({kind: "git", headSha: head});
    const managed = r.json().project.repository;
    expect(managed.managed).toBe(true);
    expect(git(managed.path, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(managed.path, ["remote"])).toBe("");
    expect(treeDigest(src)).toBe(before);
    expect((await call(app, "GET", "/v1/projects")).json().projects.find((x: {projectId: string}) => x.projectId === p.projectId).repository).toEqual(managed);
    expect((await call(app, "POST", `/v1/projects/${p.projectId}/import`, {kind: "git", path: src})).json().error).toBe("PROJECT_REPOSITORY_ALREADY_MANAGED");
  }, T);

  it("zip import extracts a safe archive and rejects zip-slip, symlink, .git, oversize, bombs, encryption and duplicates without writing", async () => {
    const {app, dataDir} = mk({extra: {studio: {zipLimits: {maxEntryBytes: 64 * 1024, maxFiles: 20}}}});
    const write = (name: string, buf: Buffer) => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); return f; };
    const good = write("good.zip", writeZip([{name: "proj/", dir: true}, {name: "proj/index.js", data: "console.log(1);\n"}, {name: "proj/lib/a.txt", data: "a\n", method: 0}]));
    const bomb = writeZip([{name: "bomb.txt", data: Buffer.alloc(200_000)}]);
    const cdOff = bomb.readUInt32LE(bomb.length - 22 + 16); bomb.writeUInt32LE(100, 22); bomb.writeUInt32LE(100, cdOff + 24);
    const enc = writeZip([{name: "e.txt", data: "x"}]); const encCd = enc.readUInt32LE(enc.length - 22 + 16); enc.writeUInt16LE(0x0801, 6); enc.writeUInt16LE(0x0801, encCd + 8);
    const cases: Array<[string, Buffer, string]> = [
      ["slip", writeZip([{name: "ok.txt", data: "x"}, {name: "../evil.txt", data: "pwn"}]), "ZIP_PATH_TRAVERSAL"],
      ["slip-backslash", writeZip([{name: "a\\..\\..\\evil.txt", data: "pwn"}]), "ZIP_PATH_TRAVERSAL"],
      ["absolute", writeZip([{name: "/evil.txt", data: "pwn"}]), "ZIP_PATH_TRAVERSAL"],
      ["drive", writeZip([{name: "C:/evil.txt", data: "pwn"}]), "ZIP_PATH_TRAVERSAL"],
      ["symlink", writeZip([{name: "link", data: "../../outside", unixMode: 0o120777}]), "ZIP_SYMLINK_REJECTED"],
      ["git", writeZip([{name: "src/.git/config", data: "[core]\n"}]), "ZIP_FORBIDDEN_PATH"],
      ["oversize", writeZip([{name: "big.bin", data: Buffer.alloc(100 * 1024, 7)}]), "ZIP_TOO_LARGE"],
      ["bomb", bomb, "ZIP_TOO_LARGE"],
      ["count", writeZip(Array.from({length: 25}, (_, i) => ({name: `f${i}.txt`, data: "x"}))), "ZIP_TOO_MANY_FILES"],
      ["encrypted", enc, "ZIP_UNSUPPORTED_FEATURE"],
      ["duplicate", writeZip([{name: "A.txt", data: "1"}, {name: "a.txt", data: "2"}]), "ZIP_DUPLICATE_ENTRY"],
      ["file-dir", writeZip([{name: "x", data: "1"}, {name: "x/y.txt", data: "2"}]), "ZIP_DUPLICATE_ENTRY"],
      ["stored-method", (() => { const z = writeZip([{name: "m.txt", data: "x", method: 0}]); const c = z.readUInt32LE(z.length - 22 + 16); z.writeUInt16LE(12, 8); z.writeUInt16LE(12, c + 10); return z; })(), "ZIP_UNSUPPORTED_FEATURE"],
      ["garbage", Buffer.from("not a zip at all, definitely not"), "ZIP_INVALID"]
    ];
    const p = await createProject(app);
    for (const [name, buf, reason] of cases) {
      const r = await call(app, "POST", `/v1/projects/${p.projectId}/import`, {kind: "zip", path: write(`${name}.zip`, buf)});
      expect(r.statusCode, name).toBe(400);
      expect(r.json(), name).toEqual({error: "IMPORT_REJECTED", reason});
    }
    expect(fs.existsSync(path.join(tmp, "evil.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "projects", p.projectId, "repo"))).toBe(false);
    expect(fs.readdirSync(path.join(dataDir, "projects", p.projectId)).filter(x => x.startsWith(".staging"))).toEqual([]);
    const ok = await call(app, "POST", `/v1/projects/${p.projectId}/import`, {kind: "zip", path: good});
    expect(ok.statusCode, ok.body).toBe(200);
    const repo = ok.json().project.repository.path;
    expect(git(repo, ["ls-files"]).split("\n").sort()).toEqual(["index.js", "lib/a.txt"]);
    expect(git(repo, ["log", "--format=%an"])).toBe("UASCO Project Studio");
    // Okuyucu birim kontrolleri: CRC uyuşmazlığı ve CRC32 bilinen değer.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    const bad = writeZip([{name: "c.txt", data: "hello", method: 0}]); bad.writeUInt8(bad[30 + 5] ^ 1, 30 + 5);
    expect(() => { const b = bad; for (const e of listZipEntries(b)) readZipEntry(b, e); }).toThrow(ZipError);
  }, T);
});

describe("PS-1A dev-run and live preview (PS-005/006, PS-AT-002/004)", () => {
  it("runs the web-node template: RUNNING + real HTTP preview + logs, single instance, stop, restart", async () => {
    const {app, dataDir} = mk();
    const p = await createProject(app, {template: "web-node"});
    expect((await devrun(app, p.projectId)).status).toBe("STOPPED");
    const s = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().devrun.status).toBe("RUNNING");
    const v = await until(() => devrun(app, p.projectId), d => d.preview.state === "AVAILABLE");
    expect(v.preview.url).toBe(`http://127.0.0.1:${v.port}/`);
    const page = await httpGet(v.preview.url);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<h1>Studio App</h1>");
    expect(v.headSha).toBe(git(p.repository!.path, ["rev-parse", "HEAD"]));
    const withLogs = await until(() => devrun(app, p.projectId), d => d.logTail.stdout.includes("listening on"));
    expect(withLogs.logTail.stdout).toContain(`listening on http://127.0.0.1:${v.port}`);
    expect(JSON.stringify(withLogs)).not.toContain(path.resolve(dataDir));
    const second = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("DEVRUN_ALREADY_RUNNING");
    const pid1 = v.pid as number;
    const rs = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/restart`, {});
    expect(rs.statusCode, rs.body).toBe(200);
    expect(rs.json().devrun.status).toBe("RUNNING");
    expect(rs.json().devrun.pid).not.toBe(pid1);
    expect(pidAlive(pid1)).toBe(false);
    const pid2 = rs.json().devrun.pid as number;
    const st = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/stop`, {});
    expect(st.json().devrun).toMatchObject({status: "STOPPED", reason: "STOP_REQUESTED", preview: {url: null, state: "UNAVAILABLE"}});
    expect(pidAlive(pid2)).toBe(false);
    // Kalıcı log dosyası yalnız dev-run dizinindedir (run workspace'leri kullanılmaz).
    expect(fs.readFileSync(path.join(dataDir, "projects", p.projectId, "devrun", "logs", "stdout.log"), "utf8")).toContain("listening on");
    expect(fs.existsSync(path.join(dataDir, "runs"))).toBe(false);
  }, T);

  it("detects a crash with its exit code, blocks without a dev command, redacts secrets in logs and has no preview for mobile", async () => {
    const {app, dataDir} = mk();
    const crash = await createProject(app, {template: "web-node", devCommand: ["node", "-e", "setTimeout(() => process.exit(7), 300)"]});
    await call(app, "POST", `/v1/projects/${crash.projectId}/devrun/start`, {});
    const c = await until(() => devrun(app, crash.projectId), d => d.status === "CRASHED");
    expect(c).toMatchObject({status: "CRASHED", exitCode: 7, reason: "PROCESS_EXITED:7", preview: {url: null, state: "UNAVAILABLE"}});
    const lib = await createProject(app, {template: "node-lib"});
    const b = await call(app, "POST", `/v1/projects/${lib.projectId}/devrun/start`, {});
    expect(b.statusCode).toBe(409);
    expect(b.json()).toEqual({error: "DEVRUN_BLOCKED", reason: "DEVRUN_COMMAND_NOT_CONFIGURED"});
    expect((await devrun(app, lib.projectId)).status).toBe("BLOCKED");
    const leak = await createProject(app, {template: "web-node", projectType: "mobile", devCommand: ["node", "-e", "console.log('key=' + ['AK','IA','Q7ZX3MPLW2RT5VB9'].join('')); setInterval(() => {}, 1000)"]});
    const s = await call(app, "POST", `/v1/projects/${leak.projectId}/devrun/start`, {});
    expect(s.json().devrun).toMatchObject({status: "RUNNING", preview: {url: null, state: "UNAVAILABLE", reason: "PREVIEW_NOT_SUPPORTED_FOR_PROJECT_TYPE"}});
    const d = await until(() => devrun(app, leak.projectId), x => x.logTail.stdout.includes("key="));
    expect(d.logTail.stdout).toContain("key=[REDACTED:AWS_ACCESS_KEY]");
    expect(JSON.stringify(d)).not.toContain(FAKE_AWS);
    await call(app, "POST", `/v1/projects/${leak.projectId}/devrun/stop`, {});
    expect(fs.readFileSync(path.join(dataDir, "projects", leak.projectId, "devrun", "logs", "stdout.log"), "utf8")).not.toContain(FAKE_AWS);
  }, T);

  it("GLOBAL_STOP stops running dev-runs (API and out-of-band stop file) and blocks start with 423", async () => {
    const {app, runtime} = mk();
    const p = await createProject(app, {template: "web-node"});
    const s = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    const pid = s.json().devrun.pid as number;
    const stop = await call(app, "POST", "/v1/control/stop", {reason: "test"});
    expect(stop.json().devRunsStopped).toBe(1);
    expect(await devrun(app, p.projectId)).toMatchObject({status: "STOPPED", reason: "GLOBAL_STOP_ACTIVE"});
    expect(pidAlive(pid)).toBe(false);
    const refused = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(refused.statusCode).toBe(423);
    expect(refused.json()).toEqual({error: "GLOBAL_STOP_ACTIVE"});
    clearGlobalStop(path.join(runtime, "GLOBAL_STOP.json"), "TEST");
    const again = await call(app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(again.json().devrun.status).toBe("RUNNING");
    activateGlobalStop(path.join(runtime, "GLOBAL_STOP.json"), "out of band", "TEST");
    const stopped = await until(() => devrun(app, p.projectId), d => d.status === "STOPPED");
    expect(stopped.reason).toBe("GLOBAL_STOP_ACTIVE");
    expect(pidAlive(again.json().devrun.pid)).toBe(false);
  }, T);

  it("recovers orphaned dev-runs after a new API instance: kills only a pid whose start time matches, reports a mismatch", async () => {
    const a = mk();
    const p = await createProject(a.app, {template: "web-node"});
    const s = await call(a.app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    const pid = s.json().devrun.pid as number;
    expect(pidAlive(pid)).toBe(true);
    // İkinci proje: kaydedilen pid canlı (bu test süreci) ama başlangıç zamanı farklı -> öldürülmez.
    const q = await createProject(a.app, {template: "web-node"});
    const dead = cp.spawnSync(process.execPath, ["-e", "process.exit(0)"]).pid!;
    const qdir = path.join(a.dataDir, "projects", q.projectId, "devrun"); fs.mkdirSync(qdir, {recursive: true});
    fs.writeFileSync(path.join(qdir, "state.json"), JSON.stringify({schemaVersion: 1, projectId: q.projectId, tenantId: "tA", status: "RUNNING", reason: null, pid: process.pid, pidStartTime: "1999-01-01T00:00:00.0000000Z", ownerPid: dead, ownerHost: os.hostname(), instanceId: "dev_previous", startedAt: new Date().toISOString(), endedAt: null, exitCode: null, signal: null, port: 1, argv: ["node", "server.js"], headSha: null, preview: {url: null, state: "UNAVAILABLE", lastProbeAt: null}}));
    const b = mk({dataDir: a.dataDir, runtime: a.runtime});
    const v = await devrun(b.app, p.projectId);
    expect(v.status).toBe("STOPPED");
    expect(v.reason).toBe("RECOVERED_AFTER_API_RESTART:ORPHAN_KILLED");
    expect(v.recovery).toMatchObject({result: "ORPHAN_KILLED", pid});
    expect(pidAlive(pid)).toBe(false);
    const w = await devrun(b.app, q.projectId);
    expect(w.recovery).toMatchObject({result: "ORPHAN_PID_MISMATCH_NOT_KILLED", pid: process.pid});
    expect(w.status).toBe("STOPPED");
    // Yeni örnek kilidi devralır ve tekrar başlatabilir.
    const again = await call(b.app, "POST", `/v1/projects/${p.projectId}/devrun/start`, {});
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().devrun.status).toBe("RUNNING");
    expect(await processStartTime(again.json().devrun.pid)).toBeTruthy();
  }, T);
});

describe("PS-1A files and git (PS-007)", () => {
  it("lists and reads files safely: traversal, symlink/junction escape, .git, binary and size limits; secrets redacted", async () => {
    const {app} = mk();
    const p = await createProject(app, {template: "web-node"});
    const repo = p.repository!.path;
    const root = (await call(app, "GET", `/v1/projects/${p.projectId}/files`)).json();
    expect(root.entries.map((e: {name: string}) => e.name)).toEqual(["public", ".gitignore", "package.json", "README.md", "server.js", "test.js"]);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/files?all=1`)).json().entries.map((e: {name: string}) => e.name)).toContain(".git");
    const f = await call(app, "GET", `/v1/projects/${p.projectId}/file?path=server.js`);
    expect(f.statusCode).toBe(200);
    expect(f.json()).toMatchObject({path: "server.js", redacted: false});
    expect(f.json().text).toContain("process.env.PORT");
    fs.writeFileSync(path.join(repo, "creds.txt"), `aws=${FAKE_AWS}\n`);
    const red = (await call(app, "GET", `/v1/projects/${p.projectId}/file?path=creds.txt`)).json();
    expect(red).toMatchObject({redacted: true, text: "aws=[REDACTED:AWS_ACCESS_KEY]\n"});
    const outside = path.join(tmp, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
    fs.symlinkSync(outside, path.join(repo, "link"), "junction");
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/files`)).json().entries.find((e: {name: string}) => e.name === "link").type).toBe("symlink");
    for (const q of ["link", "link/secret.txt", "../outside/secret.txt", "..%5Coutside%5Csecret.txt", "public/../../outside/secret.txt", encodeURIComponent(path.join(outside, "secret.txt")), "C%3A%2FWindows%2Fwin.ini", ".git/config", "%2Fetc%2Fpasswd"]) {
      for (const route of ["file", "files"]) {
        const r = await call(app, "GET", `/v1/projects/${p.projectId}/${route}?path=${q}`);
        expect(r.statusCode, `${route} ${q}`).toBe(400);
        expect(r.json().error).toBe("PATH_REJECTED");
      }
    }
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/file?path=.git/HEAD&all=1`)).statusCode).toBe(200);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/file?path=missing.txt`)).statusCode).toBe(404);
    fs.writeFileSync(path.join(repo, "bin.dat"), Buffer.from([1, 0, 2]));
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/file?path=bin.dat`)).statusCode).toBe(415);
    fs.writeFileSync(path.join(repo, "big.txt"), "x".repeat(512 * 1024 + 1));
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/file?path=big.txt`)).statusCode).toBe(413);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/file?path=public`)).statusCode).toBe(400);
  }, T);

  it("links runs to their commits, diffs run commits read-only and bounds large diffs; exports with reports", async () => {
    const {app, dataDir, runtime} = mk();
    const p = await createProject(app, {template: "web-node"});
    const mc = await call(app, "POST", "/v1/missions", {projectId: p.projectId, title: "Add feature", objective: "feature.txt says ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1"});
    const missionId = mc.json().mission.missionId;
    for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await call(app, "POST", `/v1/missions/${missionId}/transition`, {to, reason: "go"})).statusCode).toBe(200);
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
    const store = new WorkOsStore(dataDir);
    const pair = fake.pair();
    const run = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    await new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY, executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(tmp, "sec")).options}).tick();
    const done = store.getRun({tenantId: "tA"}, run.runId)!;
    expect(done.status, done.reason ?? "").toBe("AWAITING_APPROVAL");
    const base = git(p.repository!.path, ["rev-parse", "HEAD"]);
    expect(done.baseSha).toBe(base);
    // Yönetilen depo run tarafından değiştirilmez; run commit'i yalnız alternates ile okunur.
    expect(spawnGitSync(p.repository!.path, ["cat-file", "-e", `${done.headSha}^{commit}`]).status).not.toBe(0);
    const log = (await call(app, "GET", `/v1/projects/${p.projectId}/git/log?runId=${run.runId}&limit=10`)).json();
    expect(log.commits[0].sha).toBe(done.headSha);
    expect(log.commits[0].runIds).toEqual([run.runId]);
    expect(log.commits[1].sha).toBe(base);
    expect(log.runs).toEqual([expect.objectContaining({runId: run.runId, missionId, headSha: done.headSha, baseSha: base, commits: [done.headSha]})]);
    const headLog = (await call(app, "GET", `/v1/projects/${p.projectId}/git/log`)).json();
    expect(headLog.commits.map((c: {sha: string}) => c.sha)).toEqual([base]);
    const diff = (await call(app, "GET", `/v1/projects/${p.projectId}/git/diff?from=${base}&to=${done.headSha}`)).json();
    expect(diff).toMatchObject({from: base, to: done.headSha, truncated: false, files: [{file: "feature.txt", added: 1, deleted: 0}]});
    expect(diff.diff).toContain("+ok");
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/git/diff?from=HEAD~1`)).statusCode).toBe(400);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/git/diff?from=${"0".repeat(40)}`)).statusCode).toBe(404);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/git/log?limit=500`)).statusCode).toBe(400);
    // Export of the run commit: source tree (no .git), README, test/security/run reports.
    const ex = await call(app, "POST", `/v1/projects/${p.projectId}/export`, {commit: done.headSha});
    expect(ex.statusCode, ex.body).toBe(201);
    const meta = ex.json().export;
    expect(meta).toMatchObject({projectId: p.projectId, commit: done.headSha, runId: run.runId, file: `exports/${meta.exportId}.zip`, contents: {readme: true, testReport: true, securityReport: true, runReport: true}, secretScan: {scanner: "builtin", status: "CLEAN"}});
    expect(JSON.stringify(ex.json())).not.toContain(path.resolve(dataDir));
    const zip = fs.readFileSync(path.join(dataDir, "exports", `${meta.exportId}.zip`));
    expect(crypto.createHash("sha256").update(zip).digest("hex")).toBe(meta.sha256);
    expect(zip.length).toBe(meta.size);
    const entries = listZipEntries(zip, undefined, {scanOnly: true});
    const names = entries.filter(e => !e.isDir).map(e => e.name).sort();
    // V7-PKG-M1A-MODE: arşiv kökünde kanıttan türetilmiş VERIFICATION_STATUS.json da vardır (bu test TEST sağlayıcısıyla testleri yürütür: testsExecuted=true, yine NOT_VERIFIED).
    expect(names).toEqual(["README.md", "VERIFICATION_STATUS.json", "reports/run-report.json", "reports/security-report.json", "reports/test-report.json", "source/.gitignore", "source/README.md", "source/feature.txt", "source/package.json", "source/public/index.html", "source/server.js", "source/test.js"]);
    expect(entries.some(e => e.segments.includes(".git"))).toBe(false);
    const readme = readZipEntry(zip, entries.find(e => e.name === "README.md")!).toString("utf8");
    expect(readme).toContain(done.headSha!);
    expect(readme).toContain("| Independent review | CLEAN by FAKE_REVIEWER |");
    expect(readme).toContain("| Tests | PASSED");
    expect(readme).toContain("`node test.js`");
    const vs = JSON.parse(readZipEntry(zip, entries.find(e => e.name === "VERIFICATION_STATUS.json")!).toString("utf8"));
    expect(vs).toMatchObject({runId: run.runId, headSha: done.headSha, testsExecuted: true, notExecutedReason: null, reviewVerdict: "CLEAN", label: "NOT_VERIFIED"});
    expect(vs.functionalAcceptance).not.toBe("VERIFIED");
    expect(meta.verification).toMatchObject({label: "NOT_VERIFIED", testsExecuted: true});
    const tr = JSON.parse(readZipEntry(zip, entries.find(e => e.name === "reports/test-report.json")!).toString("utf8"));
    expect(tr).toMatchObject({runId: run.runId, commit: done.headSha, status: "PASSED"});
    expect(JSON.parse(readZipEntry(zip, entries.find(e => e.name === "reports/security-report.json")!).toString("utf8")).summary.status).toBe("PASSED");
    const list = (await call(app, "GET", `/v1/projects/${p.projectId}/exports`)).json().exports;
    expect(list).toEqual([meta]);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/exports/${meta.exportId}`)).json()).toEqual({export: meta, fileState: "PRESENT"});
    const journal = fs.readFileSync(path.join(dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    expect(journal.filter(e => e.type === "PROJECT_EXPORT_RECORDED").map(e => e.payload.entity.sha256)).toEqual([meta.sha256]);
    // Büyük diff sınırlıdır.
    const repo = p.repository!.path;
    fs.writeFileSync(path.join(repo, "large.txt"), Array.from({length: 60_000}, (_, i) => `line ${i} ${"y".repeat(20)}`).join("\n"));
    const big = commitAs(repo, "large");
    const bd = (await call(app, "GET", `/v1/projects/${p.projectId}/git/diff?from=${base}&to=${big}`)).json();
    expect(bd.truncated).toBe(true);
    expect(Buffer.byteLength(bd.diff, "utf8")).toBeLessThanOrEqual(512 * 1024);
  }, T);

  it("blocks an export whose tree contains a secret (409, nothing published)", async () => {
    const {app, dataDir} = mk();
    const p = await createProject(app, {template: "node-lib"});
    const clean = await call(app, "POST", `/v1/projects/${p.projectId}/export`, {});
    expect(clean.statusCode, clean.body).toBe(201);
    expect(clean.json().export).toMatchObject({runId: null, contents: {readme: true, testReport: false, securityReport: false, runReport: false}});
    const readme = (() => { const z = fs.readFileSync(path.join(dataDir, "exports", `${clean.json().export.exportId}.zip`)); const es = listZipEntries(z, undefined, {scanOnly: true}); return readZipEntry(z, es.find(e => e.name === "README.md")!).toString("utf8"); })();
    expect(readme).toContain("| Independent review | NOT_AVAILABLE |");
    fs.writeFileSync(path.join(p.repository!.path, "leak.txt"), `token ${FAKE_AWS}\n`);
    commitAs(p.repository!.path, "leak");
    const before = fs.readdirSync(path.join(dataDir, "exports"));
    const r = await call(app, "POST", `/v1/projects/${p.projectId}/export`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({error: "EXPORT_BLOCKED_SECRET", findings: [{file: "source/leak.txt", line: 1, kind: "AWS_ACCESS_KEY"}]});
    expect(fs.readdirSync(path.join(dataDir, "exports"))).toEqual(before);
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/exports`)).json().exports).toHaveLength(1);
    fs.writeFileSync(path.join(dataDir, "exports", `${clean.json().export.exportId}.zip`), "tampered");
    expect((await call(app, "GET", `/v1/projects/${p.projectId}/exports/${clean.json().export.exportId}`)).json().fileState).toBe("MODIFIED");
  }, T);
});

describe("PS-1A executor setup", () => {
  it("reports CLI/provenance state, enables LOCAL_CLAUDE through a fake provenance capture and persists the setting", async () => {
    const control = path.join(tmp, "control"); fs.mkdirSync(path.join(control, "config"), {recursive: true});
    fs.copyFileSync(path.join(REPO, "config", "execution-backends.json"), path.join(control, "config", "execution-backends.json"));
    const cli = path.join(tmp, "bin", process.platform === "win32" ? "claude.exe" : "claude"); fs.mkdirSync(path.dirname(cli)); fs.writeFileSync(cli, "fake launcher bytes");
    const captures: string[] = [];
    let captureOk = true;
    const capture = async (root: string) => {
      captures.push(root);
      if (!captureOk) return {ok: false};
      fs.mkdirSync(path.join(root, ".ai", "runtime"), {recursive: true});
      fs.writeFileSync(path.join(root, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", capturedAt: "2026-10-15T00:00:00.000Z", claude: {status: "PASS", provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: cli, version: "9.9.9 (fake)", launcherSha256: crypto.createHash("sha256").update(fs.readFileSync(cli)).digest("hex")}}));
      return {ok: true};
    };
    const none = mk({extra: {controlRoot: control, executorSetup: {findClaudeCli: () => null, captureProvenance: capture}}});
    expect((await call(none.app, "GET", "/v1/system/executors")).json().executors).toEqual({LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", enabled: false, source: "NONE"}, FAKE: {state: "TEST_ONLY"}});
    const refused = await call(none.app, "POST", "/v1/system/executors/local-claude/enable", {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({error: "EXECUTOR_ENABLE_REFUSED", reason: "CLI_NOT_FOUND"});
    expect(captures).toEqual([]);
    const {app, dataDir, runtime} = mk({dataDir: path.join(tmp, "data2"), extra: {controlRoot: control, executorSetup: {findClaudeCli: () => cli, captureProvenance: capture}}});
    expect((await call(app, "GET", "/v1/system/executors")).json().executors.LOCAL_CLAUDE.state).toBe("PROVENANCE_MISSING");
    expect((await call(app, "POST", "/v1/system/executors/local-claude/enable", {x: 1})).statusCode).toBe(400);
    captureOk = false;
    const failed = await call(app, "POST", "/v1/system/executors/local-claude/enable", {});
    expect(failed.json()).toMatchObject({error: "EXECUTOR_ENABLE_REFUSED", reason: "PROVENANCE_CAPTURE_FAILED"});
    captureOk = true;
    const ok = await call(app, "POST", "/v1/system/executors/local-claude/enable", {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({executors: {LOCAL_CLAUDE: {state: "READY", enabled: true, source: "SETTING", version: "9.9.9 (fake)", provenanceCapturedAt: "2026-10-15T00:00:00.000Z"}, FAKE: {state: "TEST_ONLY"}}, active: {reason: "LOCAL_CLAUDE"}});
    expect(captures).toEqual([path.resolve(control), path.resolve(control)]);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "settings", "executors.json"), "utf8")).localClaude.enabled).toBe(true);
    const later = mk({dataDir, runtime, extra: {controlRoot: control, executorSetup: {findClaudeCli: () => cli}}});
    expect((await call(later.app, "GET", "/v1/system/executors")).json()).toMatchObject({executors: {LOCAL_CLAUDE: {state: "READY", source: "SETTING"}}, active: {reason: "LOCAL_CLAUDE"}});
    fs.writeFileSync(cli, "launcher replaced");
    const later2 = mk({dataDir, runtime, extra: {controlRoot: control, executorSetup: {findClaudeCli: () => cli}}});
    expect((await call(later2.app, "GET", "/v1/system/executors")).json()).toMatchObject({executors: {LOCAL_CLAUDE: {state: "PROVENANCE_MISSING"}}, active: {reason: "PROVENANCE_MISSING"}});
  }, T);
});

describe("PS-1A write gates and tenant isolation", () => {
  it("every new write route follows GLOBAL_STOP 423 -> action-gateway 403 -> schema 400", async () => {
    const {app, runtime} = mk();
    const p = await createProject(app, {template: "web-node"});
    const routes: Array<[string, unknown, unknown]> = [
      [`/v1/projects/${p.projectId}/import`, {kind: "git", path: tmp}, {kind: "svn", path: tmp}],
      [`/v1/projects/${p.projectId}/devrun/start`, {}, {x: 1}],
      [`/v1/projects/${p.projectId}/devrun/stop`, {}, {x: 1}],
      [`/v1/projects/${p.projectId}/devrun/restart`, {}, {x: 1}],
      [`/v1/projects/${p.projectId}/export`, {}, {commit: "zz"}],
      ["/v1/system/executors/local-claude/enable", {}, {x: 1}]
    ];
    for (const [url, , bad] of routes) expect((await call(app, "POST", url, bad)).statusCode, url).toBe(400);
    const denied = mk({dataDir: path.join(tmp, "data"), runtime, extra: {policyContext: {scopeAllowed: false}}});
    for (const [url, good] of routes) { const r = await call(denied.app, "POST", url, good); expect(r.statusCode, url).toBe(403); expect(r.json()).toEqual({error: "ACTION_DENIED", reason: "SCOPE_DENIED"}); }
    activateGlobalStop(path.join(runtime, "GLOBAL_STOP.json"), "test", "TEST");
    for (const [url, , bad] of routes) expect((await call(app, "POST", url, bad)).statusCode, url).toBe(423);
    expect((await call(app, "POST", "/v1/projects", {name: "x", environmentId: "dev", template: "empty"})).statusCode).toBe(423);
  }, T);

  it("other tenants cannot see or act on a project through any new route", async () => {
    const a = mk();
    const p = await createProject(a.app, {template: "web-node"});
    const ex = (await call(a.app, "POST", `/v1/projects/${p.projectId}/export`, {})).json().export;
    const head = git(p.repository!.path, ["rev-parse", "HEAD"]);
    const b = mk({tenantId: "tB", dataDir: a.dataDir, runtime: a.runtime});
    expect((await call(b.app, "GET", "/v1/projects")).json().projects).toEqual([]);
    const gets = ["devrun", "files", "file?path=server.js", "git/log", `git/diff?from=${head}`, "exports", `exports/${ex.exportId}`];
    for (const g of gets) { const r = await call(b.app, "GET", `/v1/projects/${p.projectId}/${g}`); expect(r.statusCode, g).toBe(404); expect(r.json()).toEqual({error: "WORKOS_NOT_FOUND"}); }
    const posts: Array<[string, unknown]> = [["import", {kind: "git", path: tmp}], ["devrun/start", {}], ["devrun/stop", {}], ["devrun/restart", {}], ["export", {}]];
    for (const [u, body] of posts) { const r = await call(b.app, "POST", `/v1/projects/${p.projectId}/${u}`, body); expect(r.statusCode, u).toBe(404); }
    expect((await devrun(a.app, p.projectId)).status).toBe("STOPPED");
    expect((await call(a.app, "GET", `/v1/projects/${p.projectId}/exports`)).json().exports).toHaveLength(1);
    expect((await call(a.app, "GET", "/v1/projects/prj_bad/files")).statusCode).toBe(400);
    expect((await call(a.app, "GET", `/v1/projects/${p.projectId}/exports/exp_bad`)).statusCode).toBe(400);
  }, T);
});
