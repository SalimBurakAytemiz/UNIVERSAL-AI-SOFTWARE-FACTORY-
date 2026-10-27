// //TR: Bu test PS-1B masaüstü Project Studio'yu doğrular: main.mjs GET/POST allow-list eklemeleri (tam eşleşme + traversal/yöntem/boyut negatifleri), yalnız ana süreçte çözülen içe aktarma yolu / önizleme URL'si / dışa aktarma klasörü kuralları, IPC işleyicilerinin renderer'dan yol ya da URL almaması, sihirbaz ve diğer istek gövdeleri (argv dizileri), önizleme düğmesinin yalnız AVAILABLE iken etkin olması, gizli bilgi sansürü, tr/en eşitliği ve sahte DOM ile gerçek görünüm modülleri; mevcut B4/B5/B7 testleri ayrıca çalışır.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {logicalTestFiles} from "./support/validation-test-shards.js";

const root = path.resolve(__dirname, "..");
const desk = path.join(root, "apps", "desktop");
const rend = path.join(desk, "renderer");
const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(...p)).href);
const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const code = (src: string) => src.split(/\r?\n/).filter(l => !l.trim().startsWith("//")).join("\n");

const PID = "prj_" + "ab12".repeat(6);
const MID = "msn_" + "cd34".repeat(6);
const EXP = "exp_0123456789ab";
const HASH = "0123456789abcdef0123456789abcdef01234567";

// ---------- main.mjs blok yükleyicileri (electron vitest içinde import edilemez) ----------
const mainSrc = read(desk, "main.mjs");
const block = (name: string): string => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); expect(m, name).not.toBeNull(); return m![1]; };
const loadGet = () => new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const loadPost = () => new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};
const loadNative = () => new Function(`${block("PS1B-NATIVE")}\nreturn {psImportPathValid, psImportPostAllowed, psPreviewUrl, psExportPathFromBody, psResolveExportPath};`)() as any;

const enc = encodeURIComponent;

describe("PS-1B GET allow-list additions (main.mjs B4 block)", () => {
  it("allows exactly the Project Studio read routes with strict ids and canonical encoded paths", () => {
    const ok = loadGet();
    const good = [`/v1/projects/${PID}/devrun`, `/v1/projects/${PID}/files`, `/v1/projects/${PID}/files?path=${enc("src")}`, `/v1/projects/${PID}/files?path=${enc("src/lib")}`,
      `/v1/projects/${PID}/file?path=${enc("src/index.js")}`, `/v1/projects/${PID}/file?path=${enc("dökümantasyon/okubeni.md")}`, `/v1/projects/${PID}/file?path=${enc("a b/c d.txt")}`,
      `/v1/projects/${PID}/git/log`, `/v1/projects/${PID}/git/log?limit=30`, `/v1/projects/${PID}/git/log?limit=500`,
      `/v1/projects/${PID}/git/diff`, `/v1/projects/${PID}/git/diff?from=${HASH}`, `/v1/projects/${PID}/git/diff?from=abc1234&to=${HASH}`, `/v1/projects/${PID}/git/diff?to=HEAD`, `/v1/projects/${PID}/git/diff?from=HEAD~1&to=HEAD`,
      `/v1/projects/${PID}/exports`, `/v1/projects/${PID}/exports/${EXP}`, "/v1/system/executors"];
    for (const p of good) expect(ok(p), p).toBe(true);
    // B4/B5 rotaları değişmedi
    for (const p of ["/v1/cockpit", "/v1/projects", "/v1/missions", `/v1/missions?projectId=${PID}`, `/v1/missions/${MID}`, "/v1/work-runs", "/v1/evidence"]) expect(ok(p), p).toBe(true);
  });
  it("rejects traversal, encoding tricks, bad ids, unknown params, duplicates, wrong segments and oversize", () => {
    const ok = loadGet();
    const bad = [
      `/v1/projects/${PID}/file`, `/v1/projects/${PID}/file?`, `/v1/projects/${PID}/file?path=`, `/v1/projects/${PID}/file?path=..`, `/v1/projects/${PID}/file?path=${enc("../secret")}`, `/v1/projects/${PID}/file?path=${enc("a/../../b")}`,
      `/v1/projects/${PID}/file?path=%2e%2e%2fsecret`, `/v1/projects/${PID}/file?path=${enc("/etc/passwd")}`, `/v1/projects/${PID}/file?path=${enc("C:/Windows/win.ini")}`, `/v1/projects/${PID}/file?path=${enc("a\\b")}`,
      `/v1/projects/${PID}/file?path=src/index.js`, `/v1/projects/${PID}/file?path=a%2fb`, `/v1/projects/${PID}/file?path=a%2Fb%2F`, `/v1/projects/${PID}/file?path=${enc("a//b")}`, `/v1/projects/${PID}/file?path=${enc("./a")}`, `/v1/projects/${PID}/file?path=${enc("a/.")}`,
      `/v1/projects/${PID}/file?path=a%00b`, `/v1/projects/${PID}/file?path=a%0ab`, `/v1/projects/${PID}/file?path=100%25`, `/v1/projects/${PID}/file?path=%zz`, `/v1/projects/${PID}/file?path=${enc("x").toLowerCase()}%c3%b6`,
      `/v1/projects/${PID}/file?path=${enc("a".repeat(301))}`, `/v1/projects/${PID}/file?path=${"a%2F".repeat(250)}b`, `/v1/projects/${PID}/file?path=a&path=b`, `/v1/projects/${PID}/file?path=a&x=1`, `/v1/projects/${PID}/file?path=a#frag`, `/v1/projects/${PID}/file?path=a b`,
      `/v1/projects/${PID}/files?path=`, `/v1/projects/${PID}/files?path=${enc("..")}`, `/v1/projects/${PID}/files?x=1`, `/v1/projects/${PID}/files/`, `/v1/projects/${PID}/files/src`,
      `/v1/projects/${PID}/devrun?x=1`, `/v1/projects/${PID}/devrun/`, `/v1/projects/${PID}/devrun/start`, `/v1/projects/${PID}/devrun/extra`,
      `/v1/projects/${PID}/git/log?limit=0`, `/v1/projects/${PID}/git/log?limit=501`, `/v1/projects/${PID}/git/log?limit=1.5`, `/v1/projects/${PID}/git/log?limit=-1`, `/v1/projects/${PID}/git/log?limit=5&limit=6`, `/v1/projects/${PID}/git/log?from=abc1234`, `/v1/projects/${PID}/git/log?`,
      `/v1/projects/${PID}/git/diff?from=abc`, `/v1/projects/${PID}/git/diff?from=main`, `/v1/projects/${PID}/git/diff?from=--output=x`, `/v1/projects/${PID}/git/diff?from=HEAD^`, `/v1/projects/${PID}/git/diff?from=HEAD~1000`, `/v1/projects/${PID}/git/diff?to=${"A".repeat(40)}`,
      `/v1/projects/${PID}/git/diff?from=${HASH}&from=${HASH}`, `/v1/projects/${PID}/git/diff?path=x`, `/v1/projects/${PID}/git/diff?from=${HASH};rm`, `/v1/projects/${PID}/git/diff?from=${HASH}&`, `/v1/projects/${PID}/git/diff?from=&to=`,
      `/v1/projects/${PID}/exports?x=1`, `/v1/projects/${PID}/exports/`, `/v1/projects/${PID}/exports/abc`, `/v1/projects/${PID}/exports/${EXP}/extra`, `/v1/projects/${PID}/exports/${EXP}?x=1`, `/v1/projects/${PID}/exports/..`, `/v1/projects/${PID}/exports/${"a".repeat(65)}`,
      "/v1/projects/prj_zz/devrun", "/v1/projects/prj_" + "A".repeat(24) + "/devrun", "/v1/projects/prj_" + "a".repeat(23) + "/devrun", "/v1/projects/prj_" + "a".repeat(25) + "/devrun", `/v1/projects//devrun`, `/v1/projects/../devrun`,
      `/v1/projects/${PID}`, `/v1/projects/${PID}/`, `/v1/projects/${PID}/import`, `/v1/projects/${PID}/export`, `/v1/projects/${PID}/secrets`, `/v1/projects/${PID}/git/push`, `/v1/projects/${PID}/git`, `/v1/projects/${PID}/git/log/extra`,
      "/v1/system", "/v1/system/", "/v1/system/executors/", "/v1/system/executors?x=1", "/v1/system/executors/local-claude", "/v1/system/executors/local-claude/enable", "/v1/system/env", "/v1/system/executors\n",
      "http://evil.invalid/v1/system/executors", "//evil/v1/system/executors", "", "/", "/v1/" + "a".repeat(950)];
    for (const p of bad) expect(ok(p), JSON.stringify(p)).toBe(false);
    for (const nonString of [undefined, null, 1, {}, [], [`/v1/projects/${PID}/devrun`]]) expect(ok(nonString)).toBe(false);
  });
});

describe("PS-1B POST allow-list additions (main.mjs B5 block)", () => {
  it("allows the B5 routes plus exactly import, devrun start/stop/restart, export and local-claude enable", () => {
    const {desktopPostPathAllowed: ok} = loadPost();
    for (const p of ["/v1/projects", "/v1/missions", `/v1/missions/${MID}/transition`, `/v1/missions/${MID}/runs`,
      `/v1/projects/${PID}/import`, `/v1/projects/${PID}/devrun/start`, `/v1/projects/${PID}/devrun/stop`, `/v1/projects/${PID}/devrun/restart`, `/v1/projects/${PID}/export`, "/v1/system/executors/local-claude/enable"]) expect(ok(p), p).toBe(true);
  });
  it("rejects other methods' routes, GET-only routes, traversal, query strings, other executors and id tricks", () => {
    const {desktopPostPathAllowed: ok} = loadPost();
    const bad = [`/v1/projects/${PID}`, `/v1/projects/${PID}/`, `/v1/projects/${PID}/devrun`, `/v1/projects/${PID}/devrun/`, `/v1/projects/${PID}/devrun/kill`, `/v1/projects/${PID}/devrun/start/`, `/v1/projects/${PID}/devrun/start?x=1`, `/v1/projects/${PID}/devrun/START`,
      `/v1/projects/${PID}/files`, `/v1/projects/${PID}/file`, `/v1/projects/${PID}/git/log`, `/v1/projects/${PID}/git/diff`, `/v1/projects/${PID}/git/push`, `/v1/projects/${PID}/exports`, `/v1/projects/${PID}/exports/${EXP}`, `/v1/projects/${PID}/export/`, `/v1/projects/${PID}/export?x=1`, `/v1/projects/${PID}/import/`, `/v1/projects/${PID}/import?kind=git`,
      `/v1/projects/${PID}/../control/stop`, `/v1/projects/../import`, "/v1/projects/prj_zz/import", "/v1/projects/prj_" + "a".repeat(23) + "/export", "/v1/projects/prj_" + "G".repeat(24) + "/devrun/start",
      "/v1/system/executors", "/v1/system/executors/local-claude", "/v1/system/executors/local-claude/enable/", "/v1/system/executors/local-claude/disable", "/v1/system/executors/fake/enable", "/v1/system/executors/local-claude/enable?x=1", "/v1/system/executors/../control/stop",
      "/v1/control/stop", "/v1/control/resume", "/health", "//evil.invalid/v1/projects", "http://evil.invalid/v1/projects/" + PID + "/export", "", "/v1/" + "a".repeat(200)];
    for (const p of bad) expect(ok(p), JSON.stringify(p)).toBe(false);
    for (const nonString of [undefined, null, 1, {}, [], ["/v1/projects"]]) expect(ok(nonString)).toBe(false);
  });
  it("keeps the 32 KB plain-object body cap for the new routes", () => {
    const {desktopPostBodyCheck: check} = loadPost();
    expect(check({kind: "git", path: "C:\\Projeler\\app"})).toMatchObject({ok: true});
    expect(check({s: "a".repeat(40000)})).toEqual({ok: false, error: "API_BODY_TOO_LARGE"});
    expect(check([1])).toMatchObject({ok: false, error: "INVALID_API_BODY"});
    expect(check("x")).toMatchObject({ok: false});
  });
});

describe("PS-1B main-process native helpers (PS1B-NATIVE block)", () => {
  it("import path validation: absolute, no traversal or control characters, ZIP needs .zip", () => {
    const {psImportPathValid: v} = loadNative();
    expect(v("C:\\Projeler\\app", "git", path.win32)).toBe(true);
    expect(v("/home/u/app", "git", path.posix)).toBe(true);
    expect(v("C:\\a\\proje.ZIP", "zip", path.win32)).toBe(true);
    for (const [p, k, pm] of [["relative/app", "git", path.posix], ["C:\\a\\..\\b", "git", path.win32], ["/a/../b", "git", path.posix], ["/a\nb", "git", path.posix], ["", "git", path.posix], ["/x", "git", path.posix], ["/a/b.tar", "zip", path.posix], ["/a/b.zip", "tar", path.posix], ["/a/b.zip", "", path.posix], [5, "git", path.posix], ["/" + "a".repeat(1100), "git", path.posix]] as any[])
      expect(v(p, k, pm), JSON.stringify([p, k])).toBe(false);
  });
  it("import POST is accepted only for a path the main process issued from its own dialog (same kind), with exactly {kind,path}", () => {
    const {psImportPostAllowed: allowed} = loadNative();
    const issued = new Map<string, string>([["C:\\Projeler\\app", "git"], ["C:\\z\\a.zip", "zip"]]);
    const imp = `/v1/projects/${PID}/import`;
    expect(allowed(imp, {kind: "git", path: "C:\\Projeler\\app"}, issued)).toBe(true);
    expect(allowed(imp, {kind: "zip", path: "C:\\z\\a.zip"}, issued)).toBe(true);
    for (const body of [{kind: "git", path: "C:\\Windows"}, {kind: "zip", path: "C:\\Projeler\\app"}, {kind: "git", path: "C:\\Projeler\\app", extra: 1}, {kind: "git"}, {path: "C:\\Projeler\\app"}, {kind: "tar", path: "C:\\Projeler\\app"}, {kind: "git", path: ["C:\\Projeler\\app"]}, {}, null, undefined, [], "x"])
      expect(allowed(imp, body, issued), JSON.stringify(body)).toBe(false);
    expect(allowed(imp, {kind: "git", path: "C:\\Projeler\\app"}, new Map())).toBe(false);
    // diğer rotalar bu kontrolden etkilenmez
    expect(allowed(`/v1/projects/${PID}/export`, {commit: HASH}, new Map())).toBe(true);
    expect(allowed("/v1/projects", {name: "x"}, new Map())).toBe(true);
  });
  it("preview URL comes only from backend devrun state: RUNNING + AVAILABLE + http://127.0.0.1:<port>/ (not the control port, >=1024, port matches)", () => {
    const {psPreviewUrl: pv} = loadNative();
    const run = (over: any = {}) => ({status: "RUNNING", port: 5173, preview: {state: "AVAILABLE", url: "http://127.0.0.1:5173/", lastProbeAt: "2026-10-15T00:00:00Z"}, ...over});
    expect(pv(run(), 3210)).toBe("http://127.0.0.1:5173/");
    expect(pv(run({port: undefined}), 3210)).toBe("http://127.0.0.1:5173/");
    const bad: any[] = [run({status: "STARTING"}), run({status: "STOPPED"}), run({status: "CRASHED"}), run({preview: {state: "UNAVAILABLE", url: "http://127.0.0.1:5173/"}}), run({preview: {state: "AVAILABLE", url: null}}), run({preview: {state: "AVAILABLE"}}), run({preview: null}),
      run({port: 5174}), run({port: "5173"}), null, undefined, "x", []];
    for (const u of ["http://localhost:5173/", "http://127.0.0.1:5173", "http://127.0.0.1:5173/app", "http://127.0.0.1:5173/?x=1", "https://127.0.0.1:5173/", "http://127.0.0.1/", "http://127.0.0.1:0/", "http://127.0.0.1:80/", "http://127.0.0.1:1023/", "http://127.0.0.1:65536/", "http://127.0.0.1:99999/", "http://127.0.0.1:05173/",
      "http://user@127.0.0.1:5173/", "http://127.0.0.1:5173@evil.invalid/", "http://127.0.0.1.evil.invalid:5173/", "http://0.0.0.0:5173/", "http://[::1]:5173/", "javascript:alert(1)", "file:///C:/Windows/System32/calc.exe", "ms-msdt:/x", "http://127.0.0.1:5173/\n", 5, {}])
      bad.push(run({port: undefined, preview: {state: "AVAILABLE", url: u}}));
    bad.forEach((r, i) => expect(pv(r, 3210), `case ${i}: ${JSON.stringify(r)}`).toBeNull());
    expect(pv(run({port: 3210, preview: {state: "AVAILABLE", url: "http://127.0.0.1:3210/"}}), 3210)).toBeNull(); // Control API portu asla önizlenmez
  });
  it("export path resolver: only real paths strictly inside <dataDir>/exports (symlink/junction escape, sibling prefix, traversal, relative, missing all rejected)", () => {
    const {psResolveExportPath: res, psExportPathFromBody: from} = loadNative();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-ps1b-"));
    try {
      const data = path.join(tmp, "data"), exportsDir = path.join(data, "exports"), proj = path.join(exportsDir, "prj1");
      fs.mkdirSync(proj, {recursive: true}); fs.mkdirSync(path.join(data, "exports-evil"), {recursive: true}); fs.mkdirSync(path.join(tmp, "outside"), {recursive: true});
      const good = path.join(proj, "export.zip"); fs.writeFileSync(good, "x");
      fs.writeFileSync(path.join(tmp, "outside", "secret.txt"), "s"); fs.writeFileSync(path.join(data, "exports-evil", "x.zip"), "x");
      expect(res(good, exportsDir, fs, path)).toBe(fs.realpathSync(good));
      expect(res(proj, exportsDir, fs, path)).toBe(fs.realpathSync(proj));
      for (const bad of [exportsDir, path.join(data, "exports-evil", "x.zip"), path.join(proj, "..", "..", "..", "outside", "secret.txt"), path.join(tmp, "outside", "secret.txt"), path.join(proj, "missing.zip"), "export.zip", "", "C", 5, null, undefined, path.join(exportsDir, "..")])
        expect(res(bad, exportsDir, fs, path), JSON.stringify(bad)).toBeNull();
      expect(res(good, "relative/exports", fs, path)).toBeNull();
      expect(res(good, path.join(tmp, "nonexistent"), fs, path)).toBeNull();
      expect(res(good + "\n", exportsDir, fs, path)).toBeNull();
      let linked = false;
      try { fs.symlinkSync(path.join(tmp, "outside"), path.join(proj, "link"), "junction"); linked = true; } catch { linked = false; }
      if (linked) expect(res(path.join(proj, "link", "secret.txt"), exportsDir, fs, path)).toBeNull();
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
    // posix yol semantiği (sahte fs ile)
    const fake = {realpathSync: (p: string) => path.posix.normalize(p)};
    expect(res("/d/exports/a.zip", "/d/exports", fake, path.posix)).toBe("/d/exports/a.zip");
    expect(res("/d/exports/../secret", "/d/exports", fake, path.posix)).toBeNull();
    expect(res("/d/exports2/a.zip", "/d/exports", fake, path.posix)).toBeNull();
    expect(res("/d/exports/..foo/a.zip", "/d/exports", fake, path.posix)).toBe("/d/exports/..foo/a.zip");
    expect(from({export: {path: "/d/exports/a.zip"}})).toBe("/d/exports/a.zip");
    expect(from({path: "/d/exports/a.zip"})).toBe("/d/exports/a.zip");
    expect(from({export: {archivePath: "/d/exports/b.zip"}})).toBe("/d/exports/b.zip");
    for (const b of [null, undefined, 5, "x", {}, {export: {}}, {path: 5}]) expect(from(b)).toBeNull();
  });
});

describe("PS-1B IPC wiring (main.mjs, preload.mjs) is static and narrow", () => {
  const handler = (name: string): string => { const i = mainSrc.indexOf(`ipcMain.handle("${name}"`); expect(i, name).toBeGreaterThan(-1); const j = mainSrc.indexOf("\nipcMain.handle(", i + 10); const k = mainSrc.indexOf("\n});", i); return mainSrc.slice(i, Math.min(...[j, k < 0 ? Infinity : k + 4].filter(x => x > 0))); };
  it("every new handler checks the trusted sender first and takes no path/url/command from the renderer", () => {
    const pick = handler("uasco:pick-import-path"), prev = handler("uasco:open-preview"), show = handler("uasco:show-export");
    expect(pick).toMatch(/^ipcMain\.handle\("uasco:pick-import-path",async\(event,kind\)=>\{\s*requireTrustedSender\(event\);/);
    expect(prev).toMatch(/^ipcMain\.handle\("uasco:open-preview",async\(event,projectId\)=>\{\s*requireTrustedSender\(event\);/);
    expect(show).toMatch(/^ipcMain\.handle\("uasco:show-export",async\(event,projectId,exportId\)=>\{\s*requireTrustedSender\(event\);/);
    // kimlikler sıkı desene uymadan hiçbir ağ/kabuk eylemi yok
    expect(prev).toContain("PS_PROJECT_ID_RE.test(projectId)");
    expect(show).toContain("PS_PROJECT_ID_RE.test(projectId)");
    expect(show).toContain("PS_EXPORT_ID_RE.test(exportId)");
    expect(pick).toContain("PS_IMPORT_KINDS.includes(kind)");
  });
  it("openExternal is called once with the URL the main process validated from backend state; showItemInFolder once with the resolver result; no BrowserWindow for previews", () => {
    expect(mainSrc.match(/shell\.openExternal\(/g)?.length).toBe(1);
    expect(mainSrc.match(/shell\.showItemInFolder\(/g)?.length).toBe(1);
    expect(mainSrc.match(/dialog\.showOpenDialog\(/g)?.length).toBe(1);
    expect(mainSrc).toContain("shell.openExternal(url)");
    expect(mainSrc).toContain("const url=psPreviewUrl(devrun,port);");
    expect(mainSrc).toContain("shell.showItemInFolder(resolved)");
    expect(mainSrc).toContain("psResolveExportPath(psExportPathFromBody(body),path.join(dataDirRoot(),\"exports\"),fs,path)");
    expect(mainSrc.match(/new BrowserWindow\(/g)?.length).toBe(1);
    expect(mainSrc).not.toMatch(/openPath\(|shell\.openItem|trashItem|beep\(/);
    // renderer'dan gelen parametre hiçbir zaman doğrudan shell'e verilmez
    for (const [name, arg] of [["uasco:open-preview", "projectId"], ["uasco:show-export", "exportId"], ["uasco:pick-import-path", "kind"]]) {
      const h = handler(name);
      expect(h, name).not.toMatch(new RegExp(`(?:openExternal|showItemInFolder)\\(\\s*${arg}\\b`));
    }
    expect(handler("uasco:open-preview")).toMatch(/api\(`\/v1\/projects\/\$\{projectId\}\/devrun`\)/);
  });
  it("the POST handler additionally enforces main-issued import paths and consumes them after success; dialog results are validated and remembered with a cap", () => {
    expect(mainSrc).toContain("if(!psImportPostAllowed(p,body,importIssued))throw new Error(\"IMPORT_PATH_NOT_MAIN_RESOLVED\")");
    expect(mainSrc).toContain("importIssued.delete(body.path)");
    expect(mainSrc).toContain("if(!psImportPathValid(p,kind,path))throw new Error(\"IMPORT_PATH_REJECTED\")");
    expect(mainSrc).toContain("importIssued.size>=8");
    expect(mainSrc).toContain("sandbox:true");
    expect(mainSrc).toContain("contextIsolation:true");
  });
  it("preload exposes only the narrow calls (kind / ids; M1a c2 adds exportDelivery(runId)), no token and no generic invoke", () => {
    const preload = read(desk, "preload.mjs");
    expect(preload).toContain('pickImportPath:(kind)=>ipcRenderer.invoke("uasco:pick-import-path",kind)');
    expect(preload).toContain('openPreview:(projectId)=>ipcRenderer.invoke("uasco:open-preview",projectId)');
    expect(preload).toContain('showExport:(projectId,exportId)=>ipcRenderer.invoke("uasco:show-export",projectId,exportId)');
    expect(code(preload)).not.toMatch(/token|process\.env|ipcRenderer\.send|ipcRenderer\.on\(|shell|dialog|openExternal/i);
    expect(preload).toContain('exportDelivery:(runId)=>ipcRenderer.invoke("uasco:export-delivery",runId)');
    expect(preload.match(/ipcRenderer\.invoke\(/g)?.length).toBe(9);
    expect(preload).not.toMatch(/^import /m);
  });
  it("the trusted-sender check ignores only the URL fragment (hash routes keep working) and still rejects any other document", () => {
    const m = /function trustedSender\(event\)\{(.*)\}\r?\n/.exec(mainSrc);
    expect(m).not.toBeNull();
    const rendererUrl = "file:///C:/app/renderer/index.html", win = {webContents: {}};
    const mk = (w: any) => new Function("controlWindow", "rendererUrl", "function trustedSender(event){" + m![1] + "}\nreturn trustedSender;")(w, rendererUrl) as (e: any) => boolean;
    const fn = mk(win);
    const ev = (url: any, sender: any = win.webContents) => ({sender, senderFrame: {url}});
    for (const u of [rendererUrl, rendererUrl + "#/projects", rendererUrl + "#/settings", rendererUrl + "#"]) expect(fn(ev(u)), u).toBe(true);
    for (const u of [rendererUrl + "?x=1", rendererUrl + "x", "file:///C:/other/index.html", "https://evil.invalid/", "file:///C:/app/renderer/index.html/../x", undefined, null, 5, ""]) expect(fn(ev(u)), String(u)).toBe(false);
    expect(fn(ev(rendererUrl, {}))).toBe(false);
    expect(fn({sender: win.webContents})).toBe(false);
    expect(mk(null)(ev(rendererUrl))).toBe(false);
    // Node's pathToFileURL encodes "~" as %7E while Chromium keeps "~" (8.3 short paths such as C:\Users\RUNNER~1).
    const shortUrl = "file:///C:/Users/RUNNER%7E1/AppData/Local/Temp/UASCO/resources/app/apps/desktop/renderer/index.html";
    const fnShort = new Function("controlWindow", "rendererUrl", "function trustedSender(event){" + m![1] + "}\nreturn trustedSender;")(win, shortUrl) as (e: any) => boolean;
    for (const u of [shortUrl, shortUrl.replace("%7E", "~"), shortUrl.replace("%7E", "~") + "#/work"]) expect(fnShort(ev(u)), u).toBe(true);
    for (const u of [shortUrl.replace("%7E", "~") + "?x=1", shortUrl.replace("RUNNER%7E1", "OTHER~1"), shortUrl.replace("%7E", "~").replace("index.html", "x.html"), "file://evil/C:/Users/RUNNER~1/AppData/Local/Temp/UASCO/resources/app/apps/desktop/renderer/index.html", shortUrl.replace("%7E1", "%E0%A4%A"), "https://evil.invalid/C:/Users/RUNNER~1/AppData/Local/Temp/UASCO/resources/app/apps/desktop/renderer/index.html"]) expect(fnShort(ev(u)), u).toBe(false);
  });
  it("CSP is unchanged and index.html did not change structure", () => {
    const html = read(rend, "index.html");
    expect(html).toContain(`content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:"`);
    expect(html).not.toMatch(/<iframe|<webview|<object|<embed|unsafe-inline|unsafe-eval/);
  });
});

// ---------- Saf çekirdek ----------
let core: any;
beforeEach(async () => { core = await load(rend, "project-core.js"); });

describe("PS-1B wizard and request builders", () => {
  const base = () => ({name: " Mağaza ", template: "web-node", projectType: "web", techStack: ["Node.js", "", "React"], targetOS: ["windows", "linux"], acceptanceCriteria: ["Giriş çalışır", " "], maxRuns: "20", maxTokens: "2000000", devCommand: ["npm", "run", "dev", ""], testCommand: ["node", "--test"]});
  it("builds the exact POST /v1/projects body with argv arrays, trimmed values, budget and no extra keys", () => {
    const r = core.buildWizardRequest(base(), {key: "ui-abc"});
    expect(r.ok).toBe(true);
    expect(r.path).toBe("/v1/projects");
    expect(r.body).toEqual({name: "Mağaza", template: "web-node", projectType: "web", techStack: ["Node.js", "React"], targetOS: ["windows", "linux"], acceptanceCriteria: ["Giriş çalışır"], budget: {maxRuns: 20, maxTokens: 2000000}, devCommand: ["npm", "run", "dev"], testCommand: ["node", "--test"], idempotencyKey: "ui-abc"});
    expect(Array.isArray(r.body.devCommand)).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/"devCommand":"/);
  });
  it("supports the empty template with only a name; optional fields are omitted, not sent blank", () => {
    const r = core.buildWizardRequest({name: "Boş", template: "empty", techStack: [""], targetOS: [], acceptanceCriteria: [""], maxRuns: "", maxTokens: "", devCommand: [""], testCommand: [""]});
    expect(r).toEqual({ok: true, path: "/v1/projects", body: {name: "Boş", template: "empty"}});
    for (const t of core.TEMPLATES) expect(core.buildWizardRequest({name: "x", template: t}).ok).toBe(true);
    expect([...core.TEMPLATES]).toEqual(["web-node", "node-lib", "empty"]);
  });
  it("rejects shell-string commands, bad templates, OS values, budgets, oversize bodies and bad keys", () => {
    const err = (over: any, key?: string) => core.buildWizardRequest({...base(), ...over}, key === undefined ? undefined : {key}).errors ?? {};
    expect(err({template: "react-native"}).template).toBe("studio.err.template");
    expect(err({template: ""}).template).toBe("studio.err.template");
    expect(err({name: " "}).name).toBe("err.nameRequired");
    expect(err({name: "a".repeat(201)}).name).toBe("err.nameLong");
    expect(err({devCommand: ["npm run dev"]}).devCommand).toBe("studio.err.argvShellString");
    expect(err({devCommand: "npm run dev"}).devCommand).toBe("studio.err.argvInvalid");
    expect(err({devCommand: ["npm", "a\u0000b"]}).devCommand).toBe("studio.err.argvControl");
    expect(err({testCommand: Array.from({length: 33}, () => "x")}).testCommand).toBe("studio.err.argvMany");
    expect(err({targetOS: ["beos"]}).targetOS).toBe("studio.err.osInvalid");
    expect(err({targetOS: ["linux", "linux"]}).targetOS).toBe("studio.err.osInvalid");
    expect(err({techStack: Array.from({length: 21}, (_, i) => `t${i}`)}).techStack).toBe("studio.err.techInvalid");
    expect(err({techStack: ["x".repeat(61)]}).techStack).toBe("studio.err.techInvalid");
    expect(err({projectType: "x".repeat(61)}).projectType).toBe("studio.err.typeLong");
    for (const v of ["0", "1001", "-1", "1.5", "abc", "1e3", "999999999999999999"]) expect(err({maxRuns: v}).budgetMaxRuns, v).toBe("studio.err.budgetRuns");
    for (const v of ["999", "1000000001", "x"]) expect(err({maxTokens: v}).budgetMaxTokens, v).toBe("studio.err.budgetTokens");
    expect(err({acceptanceCriteria: Array.from({length: 51}, (_, i) => `k${i}`)}).acceptanceCriteria).toBe("err.criteriaMany");
    expect(err({acceptanceCriteria: Array.from({length: 50}, () => "k".repeat(4000))}).form).toBe("err.tooLarge");
    expect(err({}, "bad key").idempotencyKey).toBe("err.idempotencyKey");
    expect(core.buildWizardRequest(null).ok).toBe(false);
  });
  it("builds import, devrun, export and enable requests with validated ids; nothing else is constructible", () => {
    expect(core.buildImportRequest({projectId: PID, kind: "git", path: "C:\\Projeler\\app"})).toEqual({ok: true, path: `/v1/projects/${PID}/import`, body: {kind: "git", path: "C:\\Projeler\\app"}});
    expect(core.buildImportRequest({projectId: PID, kind: "zip", path: "/home/u/a.zip"}).ok).toBe(true);
    expect(core.buildImportRequest({projectId: PID, kind: "zip", path: "/home/u/a.tar"}).errors.importPath).toBe("studio.err.zipExt");
    expect(core.buildImportRequest({projectId: PID, kind: "git", path: "rel/app"}).errors.importPath).toBe("err.pathAbsolute");
    expect(core.buildImportRequest({projectId: PID, kind: "git", path: "/a/../b"}).errors.importPath).toBe("err.pathTraversal");
    expect(core.buildImportRequest({projectId: PID, kind: "git", path: "https://evil/x"}).errors.importPath).toBe("err.pathUrl");
    expect(core.buildImportRequest({projectId: "x", kind: "tar", path: ""}).errors).toMatchObject({projectId: "err.projectRequired", importKind: "studio.err.importKind", importPath: "err.pathRequired"});
    for (const a of ["start", "stop", "restart"]) expect(core.buildDevRunRequest({projectId: PID, action: a})).toEqual({ok: true, path: `/v1/projects/${PID}/devrun/${a}`, body: {}});
    expect(core.buildDevRunRequest({projectId: PID, action: "kill"}).ok).toBe(false);
    expect(core.buildDevRunRequest({projectId: "../x", action: "start"}).ok).toBe(false);
    expect(core.buildExportRequest({projectId: PID})).toEqual({ok: true, path: `/v1/projects/${PID}/export`, body: {}});
    expect(core.buildExportRequest({projectId: PID, commit: HASH}).body).toEqual({commit: HASH});
    expect(core.buildExportRequest({projectId: PID, commit: "main"}).errors.commit).toBe("studio.err.commit");
    expect(core.buildEnableExecutorRequest()).toEqual({ok: true, path: "/v1/system/executors/local-claude/enable", body: {}});
  });
  it("every path the renderer can build is accepted by the main allow-lists (GET and POST) and bad input yields null", () => {
    const get = loadGet(), {desktopPostPathAllowed: post} = loadPost();
    for (const p of [core.devrunPath(PID), core.filesPath(PID), core.filesPath(PID, "src"), core.filesPath(PID, "dökümantasyon/okubeni dosyası.md"), core.filePath(PID, "src/a b.js"), core.gitLogPath(PID), core.gitLogPath(PID, 500), core.gitDiffPath(PID, "", ""), core.gitDiffPath(PID, HASH, "HEAD"), core.exportsPath(PID), core.exportItemPath(PID, EXP), core.EXECUTORS_PATH])
      expect(get(p), String(p)).toBe(true);
    for (const p of [`/v1/projects/${PID}/import`, `/v1/projects/${PID}/devrun/start`, `/v1/projects/${PID}/export`, core.ENABLE_LOCAL_CLAUDE_PATH]) expect(post(p)).toBe(true);
    for (const p of [core.devrunPath("x"), core.filesPath(PID, "../x"), core.filesPath(PID, "/abs"), core.filesPath(PID, "a\\b"), core.filePath(PID, ""), core.filePath(PID, "a/../b"), core.gitLogPath(PID, 0), core.gitLogPath(PID, 501), core.gitDiffPath(PID, "main"), core.gitDiffPath(PID, "", "--x"), core.exportItemPath(PID, "a/b"), core.exportsPath("prj_x")])
      expect(p).toBeNull();
  });
});

describe("PS-1B preview gate, dev-run actions and mappers", () => {
  const dr = (over: any = {}) => ({status: "RUNNING", pid: 4242, startedAt: "2026-10-15T00:00:00.000Z", port: 5173, preview: {url: "http://127.0.0.1:5173/", state: "AVAILABLE", lastProbeAt: "2026-10-15T00:00:05.000Z"}, logTail: "ready", ...over});
  it("preview is openable only when RUNNING + AVAILABLE + exact loopback URL (+matching port); mapper drops non-loopback URLs", () => {
    const m = (raw: any) => core.mapDevRun(raw).run;
    expect(core.previewOpenable(m(dr()))).toBe(true);
    expect(core.previewOpenable(m(dr({preview: {url: "http://127.0.0.1:5173/", state: "UNAVAILABLE"}})))).toBe(false);
    expect(core.previewOpenable(m(dr({preview: {url: null, state: "AVAILABLE"}})))).toBe(false);
    expect(core.previewOpenable(m(dr({preview: {url: "http://localhost:5173/", state: "AVAILABLE"}})))).toBe(false);
    expect(core.previewOpenable(m(dr({preview: {url: "http://evil.invalid:5173/", state: "AVAILABLE"}})))).toBe(false);
    expect(core.previewOpenable(m(dr({preview: {url: "http://127.0.0.1:5173/x", state: "AVAILABLE"}})))).toBe(false);
    expect(core.previewOpenable(m(dr({preview: {url: "http://127.0.0.1:80/", state: "AVAILABLE"}, port: null})))).toBe(false);
    expect(core.previewOpenable(m(dr({port: 6000})))).toBe(false);
    for (const s of ["STOPPED", "STARTING", "CRASHED", "BLOCKED"]) expect(core.previewOpenable(m(dr({status: s}))), s).toBe(false);
    expect(core.previewOpenable(null)).toBe(false);
    expect(core.previewOpenable(m(dr({preview: undefined})))).toBe(false);
    expect(m(dr({preview: {url: "javascript:alert(1)", state: "AVAILABLE"}})).preview.url).toBeNull();
    expect(core.mapDevRun({status: "WHATEVER"})).toEqual({state: "ERROR", run: null});
    expect(core.mapDevRun(null)).toEqual({state: "ERROR", run: null});
  });
  it("dev-run actions: start only when STOPPED/CRASHED, stop only while live, restart while live or crashed", () => {
    expect(core.devRunActions("STOPPED")).toEqual({start: true, stop: false, restart: false});
    expect(core.devRunActions("STARTING")).toEqual({start: false, stop: true, restart: true});
    expect(core.devRunActions("RUNNING")).toEqual({start: false, stop: true, restart: true});
    expect(core.devRunActions("CRASHED")).toEqual({start: true, stop: false, restart: true});
    expect(core.devRunActions("BLOCKED")).toEqual({start: true, stop: false, restart: false}); // A-FLOW-4: a refused start (e.g. no sandbox yet) can be retried; the server re-asks the gate each time
  });
  it("redacts secrets and caps size in log tails, file content and diffs", () => {
    const fakeKey = "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2";
    const bearerValue = "abcdefghijklmnopqrstuvwxyz" + "0123456789", awsKey = "AK" + "IAABCDEFGHIJKLMNOP";
    const raw = `listening\nOPENAI_API_KEY=${fakeKey}\nAuthorization: ${["Bea", "rer"].join("")} ${bearerValue}\n{"password": "hunter2"}\ntoken: abc123\n${awsKey}\n` + ["-----BEGIN", " RSA PRIVATE KEY-----\nMIIBOg==\n-----END", " RSA PRIVATE KEY-----"].join("");
    const out = core.redactText(raw);
    for (const leak of [fakeKey, "hunter2", bearerValue, awsKey, "MIIBOg", "abc123"]) expect(out, leak).not.toContain(leak);
    expect(out).toContain("listening");
    expect(out).toContain("[REDACTED]");
    const tail = core.mapDevRun(dr({logTail: "x".repeat(50000) + "\n" + fakeKey})).run.logTail;
    expect(tail.length).toBeLessThanOrEqual(core.LOG_TAIL_MAX_CHARS);
    expect(tail).not.toContain(fakeKey);
    expect(core.mapDevRun(dr({logTail: ["a", "b"]})).run.logTail).toBe("a\nb");
    const file = core.mapFileContent({content: "y".repeat(150000)}).file;
    expect(file.text.length).toBe(core.FILE_VIEW_MAX_CHARS);
    expect(file.truncated).toBe(true);
    expect(core.mapFileContent({content: `k=${fakeKey}`}).file.text).not.toContain(fakeKey);
    expect(core.mapFileContent({binary: true, size: 5}).file).toMatchObject({binary: true, text: ""});
    expect(core.mapFileContent({}).state).toBe("ERROR");
    const diff = core.mapGitDiff({diff: Array.from({length: 5000}, (_, i) => `+line ${i}`).join("\n")}).diff;
    expect(diff.lines.length).toBe(core.DIFF_VIEW_MAX_LINES);
    expect(diff.truncated).toBe(true);
    expect(core.mapGitDiff({diff: `+${fakeKey}`}).diff.lines[0]).not.toContain(fakeKey);
    expect(core.mapGitDiff({diff: ""}).diff.empty).toBe(true);
  });
  it("maps file lists, git logs, exports and executors defensively without inventing data", () => {
    const fl = core.mapFileList({entries: [{name: "b.txt", type: "file", size: 5}, {name: "src", type: "dir"}, {name: "../evil"}, {name: "a/b"}, {name: ".."}, {name: "ok\u0000"}, {name: "a.txt", type: "file"}, 5, null]});
    expect(fl.entries.map((e: any) => e.name)).toEqual(["src", "a.txt", "b.txt"]);
    expect(fl.entries[0].dir).toBe(true);
    expect(core.mapFileList({}).state).toBe("ERROR");
    const gl = core.mapGitLog({commits: [{hash: HASH, subject: "ilk", author: {name: "A"}, date: "2026-10-15T00:00:00Z"}, {hash: "nothex"}, {sha: "abcdef1", message: "ikinci\ngövde"}]});
    expect(gl.commits.map((c: any) => c.short)).toEqual(["0123456", "abcdef1"]);
    expect(gl.commits[1].subject).toBe("ikinci");
    expect(core.mapGitLog({}).state).toBe("ERROR");
    const ex = core.mapExports({exports: [{exportId: "exp_aaaaaa", createdAt: "2026-10-14T00:00:00Z", commit: HASH, sizeBytes: 2048, status: "COMPLETE"}, {exportId: "exp_bbbbbb", createdAt: "2026-10-15T00:00:00Z"}, {exportId: "a/b"}, {id: "x"}]});
    expect(ex.items.map((e: any) => e.exportId)).toEqual(["exp_bbbbbb", "exp_aaaaaa"]);
    expect(ex.items[1]).toMatchObject({commit: HASH, sizeBytes: 2048, status: "COMPLETE"});
    expect(core.formatBytes(2048)).toBe("2.0 KB");
    expect(core.formatBytes(-1)).toBe("—");
    const exe = core.mapExecutors({executors: [{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED"}, {id: "fake", state: "READY"}, {id: "weird!", state: "READY"}, {id: "LOCAL_CLAUDE", state: "has space"}]});
    expect(exe.items).toEqual([{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED", testOnly: false, cli: null, readiness: null}, {id: "FAKE", state: "READY", testOnly: true, cli: null, readiness: null}, {id: "LOCAL_CLAUDE", state: null, testOnly: false, cli: null, readiness: null}]); // cli/readiness only exist for LOCAL_CLAUDE and are null unless the server sends a valid shape
    expect(core.mapExecutors({executors: {LOCAL_CLAUDE: {state: "READY"}, FAKE: "READY"}}).items.map((e: any) => [e.id, e.state])).toEqual([["LOCAL_CLAUDE", "READY"], ["FAKE", "READY"]]);
    expect(core.canEnableExecutor({id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED", testOnly: false})).toBe(true);
    for (const s of ["READY", "PROVENANCE_MISSING", "CLI_NOT_FOUND", null]) expect(core.canEnableExecutor({id: "LOCAL_CLAUDE", state: s, testOnly: false}), String(s)).toBe(false);
    expect(core.canEnableExecutor({id: "FAKE", state: "NOT_CONFIGURED", testOnly: true})).toBe(false);
    expect(core.mapExecutors(null).state).toBe("ERROR");
  });
  it("derives overview facts only from reported data (no review/security claims without evidence)", () => {
    const runs = [{runId: "run_aaaaaa", missionId: MID, startedAt: "2026-10-14T00:00:00Z"}, {runId: "run_bbbbbb", missionId: MID, startedAt: "2026-10-15T00:00:00Z"}, {runId: "run_cccccc", missionId: "msn_" + "0".repeat(24), startedAt: "2026-10-16T00:00:00Z"}];
    expect(core.latestRunFor(runs, [MID]).runId).toBe("run_bbbbbb");
    expect(core.latestRunFor(runs, [])).toBeNull();
    expect(core.securitySummary([])).toEqual({seen: false, total: 0, counts: {}, allVerified: false});
    expect(core.securitySummary([{kind: "TEST_LOG", verification: "VERIFIED"}]).seen).toBe(false);
    expect(core.securitySummary([{kind: "SECURITY_SCAN", verification: "VERIFIED"}, {kind: "SAST_REPORT", verification: null}])).toMatchObject({seen: true, total: 2, allVerified: false, counts: {VERIFIED: 1, NONE: 1}});
    expect(core.diffLineKind("+a")).toBe("add"); expect(core.diffLineKind("-a")).toBe("del"); expect(core.diffLineKind("@@ -1 +1 @@")).toBe("hunk"); expect(core.diffLineKind("+++ b/x")).toBe("meta"); expect(core.diffLineKind("--- a/x")).toBe("meta"); expect(core.diffLineKind(" ctx")).toBe("ctx");
  });
});

// ---------- tr/en eşitliği ----------
describe("PS-1B i18n", () => {
  it("tr and en keep identical keys and placeholders; every key used by the Project Studio modules exists in both", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(tr)) { expect(tr[k].trim().length, k).toBeGreaterThan(0); expect(en[k].trim().length, k).toBeGreaterThan(0); expect(ph(en[k]), k).toBe(ph(tr[k])); }
    const pc = await load(rend, "project-core.js");
    const need = new Set<string>();
    const files = ["project-core.js", "studio-state.js", "api.js", "views/projects.js", "views/studio-wizard.js", "views/studio-workspace.js", "views/executors-panel.js", "views/settings.js", "app.js"].map(f => path.join(rend, f));
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/"((?:studio|exec|devrun|form\.field|err|post|confirm|work\.form|work\.col|work\.caption|workforce\.live|everif|projects|mstatus|state)\.[A-Za-z0-9_.-]+)"/g)) need.add(m[1]);
      for (const m of s.matchAll(/(?:\bt\(|labelKey:|titleKey:|hintKey:|itemLabelKey:|addKey:|removeKey:|errorKey:|text:ctx\.t\()\s*"([a-zA-Z0-9_.-]+)"/g)) need.add(m[1]);
      for (const m of s.matchAll(/\["((?:studio)\.[a-z.]+)"(?:,"[a-z.A-Z]+")*\]/g)) need.add(m[1]);
    }
    for (const t of pc.TEMPLATES) { need.add(`studio.template.${t}`); need.add(`studio.template.${t}.desc`); }
    for (const o of pc.TARGET_OS) need.add(`studio.os.${o}`);
    for (const k of pc.IMPORT_KINDS) need.add(`studio.import.kind.${k}`);
    for (const k of pc.STUDIO_TABS) need.add(`studio.tab.${k}`);
    for (const s of pc.DEVRUN_STATES) need.add(`devrun.state.${s}`);
    for (const s of pc.PREVIEW_STATES) need.add(`devrun.preview.${s}`);
    for (const s of pc.EXECUTOR_STATES) { need.add(`exec.state.${s}`); need.add(`exec.hint.${s}`); }
    for (const id of ["LOCAL_CLAUDE", "FAKE"]) need.add(`exec.name.${id}`);
    for (const a of ["start", "stop", "restart"]) { need.add(`studio.run.${a}`); need.add(`studio.run.done.${a}`); }
    for (const r of ["DEVRUN_UNAVAILABLE", "PREVIEW_UNAVAILABLE", "OPEN_FAILED"]) need.add(`studio.run.preview.reason.${r}`);
    for (const r of ["EXPORT_UNAVAILABLE", "EXPORT_PATH_REJECTED"]) need.add(`studio.export.reason.${r}`);
    for (const f of ["template", "projectType", "techStack", "targetOS", "devCommand", "budgetMaxRuns", "budgetMaxTokens", "importKind", "importPath", "commit", "action", "name", "testCommand", "acceptanceCriteria", "projectId", "idempotencyKey", "form"]) need.add(`form.field.${f}`);
    const fields = new Set<string>(), errKeys = new Set<string>();
    const collect = (r: any) => { for (const [f, k] of Object.entries(r.errors ?? {})) { fields.add(f); errKeys.add(k as string); } };
    collect(pc.buildWizardRequest({template: "x", targetOS: ["x"], maxRuns: "0", maxTokens: "1", devCommand: "x", testCommand: "x", techStack: ["x".repeat(99)], projectType: "x".repeat(99), acceptanceCriteria: Array.from({length: 51}, () => "k")}, {key: "bad key"}));
    collect(pc.buildImportRequest({projectId: "x", kind: "x", path: ""})); collect(pc.buildImportRequest({projectId: PID, kind: "zip", path: "/a/b.tar"})); collect(pc.buildDevRunRequest({projectId: "x", action: "x"})); collect(pc.buildExportRequest({projectId: "x", commit: "no"}));
    for (const f of fields) need.add(`form.field.${f}`);
    for (const k of errKeys) need.add(k);
    for (const k of ["studio.err.argvInvalid", "studio.err.argvControl", "studio.err.argvLong", "studio.err.argvMany", "studio.err.argvShellString"]) need.add(k);
    const missing = [...need].filter(k => !/[${]/.test(k) && !(k in tr)).concat([...need].filter(k => !/[${]/.test(k) && !(k in en)));
    expect(missing).toEqual([]);
    expect(need.size).toBeGreaterThan(120);
    // tr varsayılan, en gerçekten çevrildi
    for (const k of ["studio.tab.run", "studio.wizard.title", "exec.title", "studio.run.openPreview"]) expect(en[k]).not.toBe(tr[k]);
  });
});

// ---------- Sahte DOM + gerçek görünüm modülleri ----------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; open = false; checked = false; _dis = false; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get disabled() { return this._dis || this.attrs.has("disabled"); }
  set disabled(v: boolean) { this._dis = v; if (!v) this.attrs.delete("disabled"); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; if (node.parent) node.parent.children = node.parent.children.filter(x => x !== node); node.parent = this; this.children.push(node); } }
  // //TR: UX WP-PROJECTS: kpiTile'ın SVG ikon/sparkline'ı appendChild kullandığı için sahte düğüm bunu gerçek DOM gibi sağlar (WP2/WP3/WP4 harness'leriyle aynı); doğrulama gevşetilmez.
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
  focus() { if (this.doc.canFocus(this)) this.doc.focused = this; } // c5: Chromium gibi odaklanamayan öğede (devre dışı, display:none, tabindex'siz kap) sessiz no-op
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  querySelectorAll(_s: string): N[] { return all(this); }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  // //TR: UX WP-PROJECTS: proje listesi artık WP2 kpiTile'ını (SVG ikon/sparkline) kullandığı için sahte DOM gerçek document gibi createElementNS sağlar (WP2/WP3/WP4 harness'leriyle aynı); hiçbir mevcut doğrulama gevşetilmez.
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  // c5 (PS1B-C4-001): lazyBlur=true Chromium'u modeller — devre dışı/gizli kalan odaklı öğe activeElement olarak kalır, flushBlur() (stil yeniden hesabı) sonra gövdeye düşürür; false iken hemen düşer.
  lazyBlur = false;
  /** Chromium'un focus() koşulları: bağlı, devre dışı değil, kendisi veya atası [hidden] / display:none (boş .form-status, styles.css '.form-status:empty{display:none}') değil, doğası gereği odaklanabilir etiket veya tabindex. */
  canFocus(n: N): boolean {
    if (n === this.body || !this.body.contains(n) || n.disabled) return false;
    for (let x: N | null = n; x && x !== this.body; x = x.parent) if (x.attrs.has("hidden") || isEmptyFormStatus(x)) return false;
    return FOCUSABLE_TAGS.has(n.tagName) || (n.tagName === "A" && n.attrs.has("href")) || n.attrs.has("tabindex");
  }
  flushBlur() { if (this.focused && !this.canFocus(this.focused)) this.focused = null; }
  get activeElement(): N { const f = this.focused; if (!f || !this.body.contains(f)) return this.body; return this.lazyBlur || this.canFocus(f) ? f : this.body; } // kaldırılan öğe her durumda odağı hemen kaybeder
}
const FOCUSABLE_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
const isEmptyFormStatus = (x: N) => x.className.split(/\s+/).includes("form-status") && x.children.length === 0 && x._text === "";
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (root: N, id: string) => all(root).find(n => n.id === id) ?? null;
const text = (n: N) => n.textContent;
const tick = () => new Promise(r => setTimeout(r, 0));

interface CtxOpts {get?: (p: string) => any; post?: (p: string, b: any) => {status: number; body: any}; confirm?: (o: any) => boolean; lang?: string; native?: any}
async function mkCtx(o: CtxOpts = {}) {
  const apiMod = await load(rend, "api.js"), st = await load(rend, "state.js"), i18n = await load(rend, "i18n.js");
  const doc = new D(), store = st.createStore(null), lang = o.lang ?? "tr";
  const calls = {get: [] as string[], post: [] as Array<{path: string; body: any}>, confirm: [] as any[], navigate: [] as string[], rerender: 0, refresh: 0, selected: [] as string[]};
  const bridge = {
    apiGet: async (p: string) => { calls.get.push(p); const r = o.get?.(p); if (r === undefined) throw new Error(`${p}: HTTP 404`); return r; },
    apiPost: async (p: string, b: any) => { calls.post.push({path: p, body: b}); const r = o.post?.(p, b); if (!r) throw new Error("CONTROL_API_UNREACHABLE"); return r; }
  };
  const api = apiMod.createApi({bridge, store});
  const ctx: any = {doc, store, api, i18n: {lang, t: (k: string, v?: any) => i18n.translate(lang, k, v)}, t: (k: string, v?: any) => i18n.translate(lang, k, v),
    navigate: (id: string) => { calls.navigate.push(id); }, rerender: async () => { calls.rerender++; store.cache.clear(); }, refreshAll: async () => { calls.refresh++; store.cache.clear(); },
    confirm: async (opts: any) => { calls.confirm.push(opts); return o.confirm ? o.confirm(opts) : false; }, selectProject: (id: string) => { calls.selected.push(id); }, renderAttention() {}, principal: "FOUNDER_LOCAL", native: o.native};
  return {ctx, doc, calls, store};
}
const mount = (doc: D, node: N) => { doc.body.replaceChildren(node); return node; };
const project = (extra: any = {}) => ({projectId: PID, name: "Mağaza", tenantId: "t1", environmentId: "local", createdAt: "2026-10-14T08:00:00.000Z", repository: {path: "C:\\Projeler\\magaza"}, ...extra});
const runBody = (extra: any = {}) => ({status: "RUNNING", pid: 99, startedAt: "2026-10-15T00:00:00.000Z", port: 5173, preview: {url: "http://127.0.0.1:5173/", state: "AVAILABLE", lastProbeAt: "2026-10-15T00:00:03.000Z"}, logTail: "dev server up", ...extra});

let forms: any, st: any, workspace: any, projectsView: any;
beforeEach(async () => { forms = await load(rend, "forms.js"); forms.resetAllForms(); st = await load(rend, "studio-state.js"); st.resetStudio(); workspace = await load(rend, "views", "studio-workspace.js"); projectsView = await load(rend, "views", "projects.js"); });
afterEach(() => { workspace?.stopRunPolling(); vi.useRealTimers(); });

const projectsGet = (extra: Record<string, any> = {}) => (p: string) => (p in extra ? extra[p] : p === "/v1/projects" ? {projects: [project()]} : undefined);
const openWs = async (o: CtxOpts, tab = "overview") => {
  const c = await mkCtx(o);
  st.openProject(PID, tab);
  const root = mount(c.doc, await projectsView.render(c.ctx));
  return {...c, root};
};

describe("PS-1B Yeni Proje wizard and İçe Aktar (fake DOM)", () => {
  it("renders the wizard with template choices (incl. empty), submit builds the argv-array body once and shows success without any auto-submit", async () => {
    const {ctx, doc, calls} = await mkCtx({get: projectsGet(), post: () => ({status: 201, body: {project: {projectId: PID, name: "Yeni"}}})});
    const root = mount(doc, await projectsView.render(ctx));
    expect(calls.post).toEqual([]);
    expect(byId(root, "studio-template-empty")).not.toBeNull();
    expect(byId(root, "studio-template-web-node")!.getAttribute("type")).toBe("radio");
    byId(root, "studio-template-node-lib")!.fire("change");
    byId(root, "studio-name")!.value = "Yeni"; byId(root, "studio-name")!.fire("input");
    byId(root, "studio-tech-0")!.value = "Node.js"; byId(root, "studio-tech-0")!.fire("input");
    const os = byId(root, "studio-os-windows")!; os.checked = true; os.fire("change");
    byId(root, "studio-criteria-0")!.value = "Açılışta hata yok"; byId(root, "studio-criteria-0")!.fire("input");
    byId(root, "studio-budget-runs")!.value = "10"; byId(root, "studio-budget-runs")!.fire("input");
    byId(root, "studio-dev-0")!.value = "npm"; byId(root, "studio-dev-0")!.fire("input");
    byId(root, "studio-dev-add")!.fire("click");
    byId(root, "studio-dev-1")!.value = "start"; byId(root, "studio-dev-1")!.fire("input");
    expect(text(byId(root, "studio-dev-preview")!)).toContain('["npm","start"]');
    byId(root, "studio-wizard-form")!.fire("submit");
    await tick();
    expect(calls.post.length).toBe(1);
    expect(calls.post[0].path).toBe("/v1/projects");
    expect(calls.post[0].body).toMatchObject({name: "Yeni", template: "node-lib", techStack: ["Node.js"], targetOS: ["windows"], acceptanceCriteria: ["Açılışta hata yok"], budget: {maxRuns: 10}, devCommand: ["npm", "start"]});
    expect(calls.post[0].body.idempotencyKey).toMatch(/^ui-[A-Za-z0-9._:-]+$/);
    expect(forms.drafts.status["studio-wizard"].ok).toBe(true);
    expect(st.studio.lastCreated).toEqual({projectId: PID, name: "Yeni"});
    expect(st.wizard.name).toBe("");
  });
  it("shows validation errors without sending, keeps the draft, and reuses the idempotency key on retry", async () => {
    let n = 0; const codes = [503, 201];
    const {ctx, doc, calls} = await mkCtx({get: projectsGet(), post: () => ({status: codes[n++] ?? 201, body: n === 1 ? {error: "WORKOS_UNAVAILABLE"} : {project: {projectId: PID, name: "A"}}})});
    let root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-name")!.value = "A"; byId(root, "studio-name")!.fire("input");
    byId(root, "studio-dev-0")!.value = "npm run dev"; byId(root, "studio-dev-0")!.fire("input");
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    expect(calls.post).toEqual([]);
    root = mount(doc, await projectsView.render(ctx));
    expect(byId(root, "studio-name")!.value).toBe("A");
    expect(text(byId(root, "studio-wizard-status")!)).toContain("Geliştirme komutu");
    byId(root, "studio-dev-0")!.value = "npm"; byId(root, "studio-dev-0")!.fire("input");
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["studio-wizard"].key).toBe("post.err.503");
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    expect(calls.post.length).toBe(2);
    expect(calls.post[1].body.idempotencyKey).toBe(calls.post[0].body.idempotencyKey);
  });
  it("import: path comes only from the native dialog result, submit stays disabled until chosen, and the POST carries exactly {kind,path}", async () => {
    const picked: string[] = [];
    const native = {pickImportPath: async (kind: string) => { picked.push(kind); return {cancelled: false, path: kind === "zip" ? "C:\\z\\a.zip" : "C:\\Projeler\\app", kind}; }};
    const {ctx, doc, calls} = await mkCtx({get: projectsGet(), post: () => ({status: 202, body: {}}), native});
    let root = mount(doc, await projectsView.render(ctx));
    expect(byId(root, "studio-import-path")).not.toBeNull();
    expect(byId(root, "studio-import-submit")!.hasAttribute("disabled")).toBe(true);
    expect(byId(root, "studio-import-path-input")).toBeNull(); // elle yol girişi yok
    expect(all(root).filter(n => n.attrs.get("id")?.startsWith("studio-import") && n.tagName === "INPUT").length).toBe(0);
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    expect(calls.post).toEqual([]); // yol yokken gönderilmez
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    expect(picked).toEqual(["git"]);
    root = mount(doc, await projectsView.render(ctx));
    expect(text(byId(root, "studio-import-path")!)).toBe("C:\\Projeler\\app");
    expect(byId(root, "studio-import-submit")!.hasAttribute("disabled")).toBe(false);
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    expect(calls.post).toEqual([{path: `/v1/projects/${PID}/import`, body: {kind: "git", path: "C:\\Projeler\\app"}}]);
    expect(forms.drafts.status["studio-import"].ok).toBe(true);
    expect(st.importDraft.path).toBe(""); // başarıda sıfırlanır
  });
  it("import: cancelling the dialog or a missing native bridge sends nothing; switching the type clears the chosen path", async () => {
    const {ctx, doc, calls} = await mkCtx({get: projectsGet(), post: () => ({status: 202, body: {}}), native: {pickImportPath: async () => ({cancelled: true})}});
    let root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    expect(st.importDraft.path).toBe("");
    st.importDraft.path = "C:\\x"; st.importDraft.pickedFor = "git";
    const kind = byId(root, "studio-import-kind")!; kind.value = "zip"; kind.fire("change");
    root = mount(doc, await projectsView.render(ctx));
    expect(st.importDraft.path).toBe("");
    expect(calls.post).toEqual([]);
    const none = await mkCtx({get: projectsGet()});
    const r2 = mount(none.doc, await projectsView.render(none.ctx));
    byId(r2, "studio-import-pick")!.fire("click"); await tick();
    expect(forms.drafts.status["studio-import"].key).toBe("studio.import.noDialog");
    // renderer hiçbir koşulda dialog sonucunun dışında yol taşımaz
    st.resetImport();
    const mismatch = await mkCtx({get: projectsGet(), native: {pickImportPath: async () => ({cancelled: false, path: "C:\\x", kind: "zip"})}});
    mount(mismatch.doc, await projectsView.render(mismatch.ctx));
    await load(rend, "views", "studio-wizard.js").then(async (w: any) => { await w.pickImportPath(mismatch.ctx); });
    expect(st.importDraft.path).toBe("");
  });
  it("keeps the B5 'register an existing repository' form (ids unchanged) and the project list opens the workspace via a button", async () => {
    const {ctx, doc, calls} = await mkCtx({get: projectsGet()});
    const root = mount(doc, await projectsView.render(ctx));
    for (const id of ["project-form", "project-name", "project-repo", "project-submit"]) expect(byId(root, id), id).not.toBeNull();
    expect(text(byId(root, "project-form-t")!)).toContain("Mevcut yerel depo");
    byId(root, `open-${PID}`)!.fire("click");
    expect(st.studio.projectId).toBe(PID);
    expect(calls.selected).toEqual([PID]);
  });
});

describe("PS-1B workspace tabs (fake DOM)", () => {
  it("renders a project workspace with six tabs, roving tabindex and tabpanel wiring; no new sidebar route exists", async () => {
    const {root} = await openWs({get: projectsGet({[`/v1/missions?projectId=${PID}`]: {missions: [{missionId: MID, projectId: PID, title: "G1", status: "EXECUTING", riskLevel: "R1"}]}, "/v1/work-runs": {workRuns: [{runId: "run_aaaaaa", missionId: MID, status: "RUNNING", startedAt: "2026-10-15T00:00:00Z", reviewer: {identity: "CLAUDE_REVIEWER", verdict: "BLOCKED"}}]}, "/v1/evidence?runId=run_aaaaaa": {evidence: [{evidenceId: "evd_aaaaaa", kind: "SECURITY_SCAN", verification: "MISMATCH"}]}})});
    const tabs = all(root).filter(n => n.getAttribute("role") === "tab");
    expect(tabs.map(t => t.dataset.tab)).toEqual(["overview", "run", "files", "changes", "missions", "delivery"]);
    expect(tabs.filter(t => t.getAttribute("aria-selected") === "true").length).toBe(1);
    expect(tabs.filter(t => t.getAttribute("tabindex") === "0").length).toBe(1);
    expect(byId(root, "studio-panel")!.getAttribute("role")).toBe("tabpanel");
    expect(byId(root, "studio-panel")!.getAttribute("aria-labelledby")).toBe("studio-tab-overview");
    expect(text(byId(root, "view-title")!)).toBe("Mağaza");
    expect(text(root)).toContain("CLAUDE_REVIEWER");
    expect(text(byId(root, "studio-ov-security")!)).toContain("1 kanıt");
    const routes = await load(rend, "routes.js");
    expect(routes.ROUTES.map((r: any) => r.id)).toEqual(["home", "projects", "work", "workforce", "assurance", "delivery", "tower", "inbox", "company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "install", "audit", "domains", "integrations", "scheduler", "settings"]);
  });
  it("overview never claims review or security state the server did not report", async () => {
    const {root} = await openWs({get: projectsGet({[`/v1/missions?projectId=${PID}`]: {missions: [{missionId: MID, projectId: PID, title: "G1", status: "EXECUTING", riskLevel: "R1"}]}, "/v1/work-runs": {workRuns: [{runId: "run_aaaaaa", missionId: MID, status: "RUNNING", startedAt: "2026-10-15T00:00:00Z"}]}, "/v1/evidence?runId=run_aaaaaa": {evidence: []}})});
    expect(text(byId(root, "studio-ov-review")!)).toContain("incelendi sayılmaz");
    expect(text(byId(root, "studio-ov-security")!)).toContain("güvenli olduğu anlamına gelmez");
    const unavailable = await openWs({get: projectsGet()});
    expect(text(byId(unavailable.root, "studio-ov-review")!)).toContain("Kullanılamıyor");
  });
  it("arrow keys move between tabs and the selected tab changes the panel", async () => {
    const {ctx, doc, root, calls} = await openWs({get: projectsGet()});
    const t0 = byId(root, "studio-tab-overview")!;
    t0.fire("keydown", {key: "ArrowRight"});
    expect(st.studio.tab).toBe("run");
    expect(doc.focused?.id).toBe("studio-tab-run");
    expect(calls.rerender).toBeGreaterThan(0);
    byId(root, "studio-tab-run")!.fire("keydown", {key: "End"});
    expect(st.studio.tab).toBe("delivery");
    byId(root, "studio-tab-delivery")!.fire("keydown", {key: "ArrowRight"});
    expect(st.studio.tab).toBe("overview");
    byId(root, "studio-tab-overview")!.fire("keydown", {key: "ArrowLeft"});
    expect(st.studio.tab).toBe("delivery");
    void ctx;
  });
  it("run tab: backend 404 shows honest UNAVAILABLE and no fake status or buttons", async () => {
    const {root} = await openWs({get: projectsGet()}, "run");
    expect(text(byId(root, "studio-run")!)).toContain("Kullanılamıyor");
    expect(byId(root, "studio-run-start")).toBeNull();
    expect(byId(root, "studio-run-preview")).toBeNull();
  });
  it("run tab: the preview button is disabled unless the backend reports AVAILABLE, and opening goes only through the id-only native call", async () => {
    const opened: any[] = [];
    const native = {openPreview: async (id: string) => { opened.push(id); return {opened: true}; }};
    const g = (run: any) => projectsGet({[`/v1/projects/${PID}/devrun`]: run});
    for (const [label, run, expectDisabled] of [
      ["available", runBody(), false], ["unavailable", runBody({preview: {url: null, state: "UNAVAILABLE", lastProbeAt: null}}), true], ["starting", runBody({status: "STARTING", preview: {url: "http://127.0.0.1:5173/", state: "AVAILABLE"}}), true],
      ["stopped", runBody({status: "STOPPED", pid: null, port: null, preview: {url: null, state: "UNAVAILABLE"}}), true], ["crashed", runBody({status: "CRASHED", exitCode: 1}), true], ["evil-url", runBody({preview: {url: "http://evil.invalid:5173/", state: "AVAILABLE"}}), true]] as any[]) {
      const {root} = await openWs({get: g(run), native}, "run");
      const btn = byId(root, "studio-run-preview")!;
      expect(btn.disabled, label).toBe(expectDisabled);
      workspace.stopRunPolling();
    }
    const {root} = await openWs({get: g(runBody()), native}, "run");
    byId(root, "studio-run-preview")!.fire("click"); await tick();
    expect(opened).toEqual([PID]);
    expect(forms.drafts.status[workspace.DEV_FORM].key).toBe("studio.run.preview.opened");
    const blocked = await openWs({get: g(runBody({preview: {url: null, state: "UNAVAILABLE"}})), native}, "run");
    opened.length = 0;
    byId(blocked.root, "studio-run-preview")!.fire("click"); await tick();
    expect(opened).toEqual([]); // devre dışıyken hiç çağrılmaz
  });
  it("run tab: start asks for confirmation (and sends nothing when declined); stop needs none; actions POST fixed routes; buttons reflect state", async () => {
    let status = "STOPPED";
    const get = projectsGet();
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({status, pid: status === "STOPPED" ? null : 9, preview: {url: null, state: "UNAVAILABLE"}}) : get(p);
    const {root, calls} = await openWs({get: getFn, post: p => { if (p.endsWith("/start")) status = "RUNNING"; if (p.endsWith("/stop")) status = "STOPPED"; return {status: 202, body: {}}; }, confirm: () => false}, "run");
    expect(byId(root, "studio-run-start")!.disabled).toBe(false);
    expect(byId(root, "studio-run-stop")!.disabled).toBe(true);
    expect(text(byId(root, "studio-run-stop")!)).toBe("Durdur"); // STOP görünür kalır
    byId(root, "studio-run-start")!.fire("click"); await tick();
    expect(calls.confirm.length).toBe(1);
    expect(calls.confirm[0].body).toContain("bu bilgisayarda çalıştırır");
    expect(calls.post).toEqual([]);
    const ctx2 = await mkCtx({get: getFn, post: p => { if (p.endsWith("/start")) status = "RUNNING"; if (p.endsWith("/stop")) status = "STOPPED"; return {status: 202, body: {}}; }, confirm: () => true});
    st.openProject(PID, "run");
    const root2 = mount(ctx2.doc, await projectsView.render(ctx2.ctx));
    byId(root2, "studio-run-start")!.fire("click"); await tick(); await tick();
    expect(ctx2.calls.post).toEqual([{path: `/v1/projects/${PID}/devrun/start`, body: {}}]);
    expect(byId(root2, "studio-run-stop")!.disabled).toBe(false);
    expect(byId(root2, "studio-run-start")!.disabled).toBe(true);
    byId(root2, "studio-run-stop")!.fire("click"); await tick(); await tick();
    expect(ctx2.calls.confirm.length).toBe(1); // durdurma onay istemez
    expect(ctx2.calls.post[1]).toEqual({path: `/v1/projects/${PID}/devrun/stop`, body: {}});
    expect(text(byId(root2, "studio-run-state")!)).toContain("Durduruldu");
  });
  it("run tab: the log tail refreshes in place (focus stays on the log), redacted, and polling stops when the node leaves the document", async () => {
    vi.useFakeTimers();
    let log = "satır 1";
    const key = "sk-" + "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2";
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({logTail: log}) : projectsGet()(p);
    const {root, doc, calls} = await openWs({get: getFn}, "run");
    const pre = byId(root, "studio-log")!;
    pre.focus();
    expect(text(pre)).toBe("satır 1");
    expect(pre.getAttribute("aria-live")).toBe("off");
    expect(pre.getAttribute("tabindex")).toBe("0");
    log = `satır 1\nsatır 2 API_KEY=${key}`;
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(text(pre)).toContain("satır 2");
    expect(text(pre)).not.toContain(key);
    expect(doc.focused).toBe(pre); // yerinde güncelleme odağı bozmaz
    expect(byId(root, "studio-log")).toBe(pre); // düğüm yeniden kurulmadı
    const n = calls.get.filter(x => x.endsWith("/devrun")).length;
    expect(n).toBeGreaterThanOrEqual(2);
    (byId(root, "studio-run") as any).isConnected = false;
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS * 3);
    const after = calls.get.filter(x => x.endsWith("/devrun")).length;
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS * 3);
    expect(calls.get.filter(x => x.endsWith("/devrun")).length).toBe(after);
  });
  it("run tab: polling does not start for a stopped dev-run", async () => {
    vi.useFakeTimers();
    const {calls} = await openWs({get: projectsGet({[`/v1/projects/${PID}/devrun`]: runBody({status: "STOPPED", pid: null, port: null, preview: {url: null, state: "UNAVAILABLE"}})})}, "run");
    const before = calls.get.length;
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS * 4);
    expect(calls.get.length).toBe(before);
  });
  it("files tab: lists entries, navigates folders with validated relative paths, shows a redacted read-only viewer and never builds a traversal path", async () => {
    const key = "ghp_" + "A".repeat(30);
    const g = projectsGet({[`/v1/projects/${PID}/files`]: {entries: [{name: "src", type: "dir"}, {name: "README.md", type: "file", size: 12}, {name: "..", type: "dir"}]},
      [`/v1/projects/${PID}/files?path=src`]: {entries: [{name: "index.js", type: "file", size: 20}]},
      [`/v1/projects/${PID}/file?path=${enc("src/index.js")}`]: {content: `const t = "${key}";\nconsole.log(1)`, size: 20}});
    const {root, calls} = await openWs({get: g}, "files");
    expect(byId(root, "fe-src")).not.toBeNull();
    expect(byId(root, "fe-..")).toBeNull();
    byId(root, "fe-src")!.fire("click");
    expect(st.studio.dir).toBe("src");
    const c2 = await mkCtx({get: g}); st.openProject(PID, "files");
    const root2 = mount(c2.doc, await projectsView.render(c2.ctx));
    expect(byId(root2, "studio-files-path")!.textContent).toBe("/src");
    expect(byId(root2, "studio-files-up")).not.toBeNull();
    byId(root2, "fe-src/index.js")!.fire("click");
    expect(st.studio.file).toBe("src/index.js");
    const c3 = await mkCtx({get: g}); st.openProject(PID, "files");
    const root3 = mount(c3.doc, await projectsView.render(c3.ctx));
    const view = byId(root3, "studio-file-view")!;
    expect(text(view)).toContain("console.log(1)");
    expect(text(view)).not.toContain(key);
    expect(view.tagName).toBe("PRE");
    expect(all(root3).some(n => n.tagName === "TEXTAREA" || (n.tagName === "INPUT" && n.attrs.get("id")?.includes("file")))).toBe(false); // salt-okunur
    const allGets = [...calls.get, ...c2.calls.get, ...c3.calls.get];
    const getOk = loadGet();
    for (const p of allGets) expect(getOk(p) || ["/v1/projects", "/v1/work-runs"].includes(p) || p.startsWith("/v1/missions"), p).toBe(true);
    st.studio.dir = ""; st.studio.file = "../x";
    const c4 = await mkCtx({get: g}); st.openProject(PID, "files"); st.studio.file = "../x";
    await projectsView.render(c4.ctx);
    expect(c4.calls.get.some(p => p.includes("file?path"))).toBe(false);
  });
  it("changes tab: lists git history, renders diff lines as text spans with +/- markers, and sends only validated hashes", async () => {
    const g = projectsGet({[`/v1/projects/${PID}/git/log?limit=30`]: {commits: [{hash: HASH, subject: "ikinci", author: "A", date: "2026-10-15T00:00:00Z"}, {hash: "abcdef0123456789abcdef0123456789abcdef01", subject: "ilk"}]},
      [`/v1/projects/${PID}/git/diff?from=abcdef0123456789abcdef0123456789abcdef01&to=${HASH}`]: {diff: "diff --git a/x b/x\n@@ -1 +1 @@\n-eski\n+<img src=x onerror=alert(1)>\n bağlam", files: [{path: "x", additions: 1, deletions: 1}]}});
    const {ctx, doc, calls} = await mkCtx({get: g}); st.openProject(PID, "changes");
    let root = mount(doc, await projectsView.render(ctx));
    expect(text(root)).toContain("ikinci");
    expect(calls.get.some(p => p.includes("git/diff"))).toBe(false); // diff kullanıcı istemeden çekilmez
    byId(root, "studio-diff-show")!.fire("click");
    expect(st.studio.diffRequested).toBe(true);
    root = mount(doc, await projectsView.render(ctx));
    const view = byId(root, "studio-diff-view")!;
    const kinds = view.children.map(c => c.className);
    expect(kinds).toEqual(["diff-line diff-meta", "diff-line diff-hunk", "diff-line diff-del", "diff-line diff-add", "diff-line diff-ctx"]);
    expect(text(view)).toContain("+<img src=x onerror=alert(1)>"); // metin olarak, HTML değil
    expect(view.children.every(c => c.tagName === "SPAN" && c.children.length === 0)).toBe(true);
    expect(calls.get.filter(p => p.includes("git/diff"))).toEqual([`/v1/projects/${PID}/git/diff?from=abcdef0123456789abcdef0123456789abcdef01&to=${HASH}`]);
  });
  it("missions tab links to the B5 mission screens for this project", async () => {
    const g = projectsGet({[`/v1/missions?projectId=${PID}`]: {missions: [{missionId: MID, projectId: PID, title: "Görev 1", status: "DRAFT", riskLevel: "R1"}]}});
    const {ctx, doc, calls} = await mkCtx({get: g}); st.openProject(PID, "missions");
    const root = mount(doc, await projectsView.render(ctx));
    byId(root, `sm-${MID}`)!.fire("click");
    expect(forms.selection.missionId).toBe(MID);
    expect(calls.navigate).toEqual(["work"]);
    expect(calls.selected).toEqual([PID]);
    byId(root, "studio-missions-open")!.fire("click");
    expect(calls.navigate).toEqual(["work", "work"]);
  });
  it("delivery tab: export POSTs the fixed route, lists exports, and 'show in folder' passes ids only to the native call", async () => {
    const shown: any[] = [];
    const native = {showExport: async (p: string, e: string) => { shown.push([p, e]); return {shown: true}; }};
    const g = projectsGet({[`/v1/projects/${PID}/exports`]: {exports: [{exportId: EXP, createdAt: "2026-10-15T00:00:00Z", commit: HASH, sizeBytes: 4096, status: "COMPLETE"}]}});
    const {ctx, doc, calls} = await mkCtx({get: g, post: () => ({status: 201, body: {export: {exportId: EXP}}}), native}); st.openProject(PID, "delivery");
    const root = mount(doc, await projectsView.render(ctx));
    expect(text(root)).toContain(EXP);
    expect(text(root)).toContain("4.0 KB");
    byId(root, "studio-export-form")!.fire("submit"); await tick();
    expect(calls.post).toEqual([{path: `/v1/projects/${PID}/export`, body: {}}]);
    st.studio.commit = "main";
    byId(root, "studio-export-form")!.fire("submit"); await tick();
    expect(calls.post.length).toBe(1);
    expect(forms.drafts.status["studio-export"].errors.commit).toBe("studio.err.commit");
    byId(root, `ex-show-${EXP}`)!.fire("click"); await tick();
    expect(shown).toEqual([[PID, EXP]]);
    expect(forms.drafts.status["studio-export"].key).toBe("studio.export.shown");
    const rejected = await mkCtx({get: g, native: {showExport: async () => ({shown: false, reason: "EXPORT_PATH_REJECTED"})}}); st.openProject(PID, "delivery");
    const r2 = mount(rejected.doc, await projectsView.render(rejected.ctx));
    byId(r2, `ex-show-${EXP}`)!.fire("click"); await tick();
    expect(forms.drafts.status["studio-export"].key).toBe("studio.export.reason.EXPORT_PATH_REJECTED");
    const bogus = await mkCtx({get: g, native: {showExport: async () => ({shown: false, reason: "<script>"})}}); st.openProject(PID, "delivery");
    const r3 = mount(bogus.doc, await projectsView.render(bogus.ctx));
    byId(r3, `ex-show-${EXP}`)!.fire("click"); await tick();
    expect(forms.drafts.status["studio-export"].key).toBe("studio.export.reason.EXPORT_UNAVAILABLE");
  });
});

describe("PS-1B Ayarlar → AI Yürütücüleri (fake DOM)", () => {
  it("shows honest UNAVAILABLE when the backend has no executors route and renders no enable button", async () => {
    const {ctx, doc} = await mkCtx({get: () => undefined});
    const settings = await load(rend, "views", "settings.js");
    const root = mount(doc, await settings.render(ctx));
    expect(text(byId(root, "settings-executors")!)).toContain("Kullanılamıyor");
    expect(byId(root, "exec-enable")).toBeNull();
    expect(byId(root, "settings-lang")).not.toBeNull();
  });
  it("renders LOCAL_CLAUDE states and FAKE as test-only; enable exists only for NOT_CONFIGURED and needs the accessible confirm", async () => {
    const settings = await load(rend, "views", "settings.js");
    for (const [state, enable] of [["READY", false], ["NOT_CONFIGURED", true], ["PROVENANCE_MISSING", false], ["CLI_NOT_FOUND", false]] as any[]) {
      const {ctx, doc} = await mkCtx({get: p => p === "/v1/system/executors" ? {executors: [{id: "LOCAL_CLAUDE", state}, {id: "FAKE", state: "NOT_CONFIGURED"}]} : undefined});
      const root = mount(doc, await settings.render(ctx));
      expect(byId(root, "exec-enable") !== null, state).toBe(enable);
      expect(text(byId(root, "settings-executors")!)).toContain("yalnız test");
      expect(all(root).filter(n => n.id === "exec-enable").length).toBeLessThanOrEqual(1);
    }
    let posted = 0;
    const declined = await mkCtx({get: p => p === "/v1/system/executors" ? {executors: [{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED"}]} : undefined, post: () => { posted++; return {status: 200, body: {}}; }, confirm: () => false});
    const r1 = mount(declined.doc, await settings.render(declined.ctx));
    byId(r1, "exec-enable")!.fire("click"); await tick();
    expect(declined.calls.confirm.length).toBe(1);
    expect(declined.calls.confirm[0].body).toContain("kendi Claude girişinizle");
    expect(posted).toBe(0);
    const accepted = await mkCtx({get: p => p === "/v1/system/executors" ? {executors: [{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED"}]} : undefined, post: () => ({status: 200, body: {}}), confirm: () => true});
    const r2 = mount(accepted.doc, await settings.render(accepted.ctx));
    byId(r2, "exec-enable")!.fire("click"); await tick();
    expect(accepted.calls.post).toEqual([{path: "/v1/system/executors/local-claude/enable", body: {}}]);
    expect(forms.drafts.status.executors.ok).toBe(true);
  });
  it("English strings render for the new panels and no raw keys leak", async () => {
    const settings = await load(rend, "views", "settings.js");
    const {ctx, doc} = await mkCtx({lang: "en", get: p => p === "/v1/system/executors" ? {executors: [{id: "LOCAL_CLAUDE", state: "CLI_NOT_FOUND"}]} : undefined});
    const root = mount(doc, await settings.render(ctx));
    expect(text(root)).toContain("CLI not found");
    expect(text(root)).not.toMatch(/\bexec\.[a-z]/);
    const c2 = await mkCtx({lang: "en", get: projectsGet()});
    const r2 = mount(c2.doc, await projectsView.render(c2.ctx));
    expect(text(r2)).toContain("New Project");
    expect(text(r2)).not.toMatch(/\bstudio\.[a-z]+\./);
  });
});

// ---------- Statik güvenlik ----------
describe("PS-1B static safety and wiring", () => {
  const newFiles = ["project-core.js", "studio-state.js", "views/studio-wizard.js", "views/studio-workspace.js", "views/executors-panel.js", "views/projects.js", "views/settings.js"];
  it("new renderer modules never use innerHTML/eval/fetch/window.uasco/storage and keep backend data as text; views never touch the bridge", () => {
    for (const f of newFiles) {
      const s = code(read(rend, f));
      expect(s, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|\bfetch\s*\(|window\.uasco|localStorage|sessionStorage|XMLHttpRequest|WebSocket|window\.open|\.href\s*=|location\./);
      expect(s, f).not.toMatch(/\bbridge\b|apiPost|apiGet|ipcRenderer|require\(|process\.env/);
      expect(s, f).not.toMatch(/setAttribute\(\s*["'](?:href|src|srcdoc|style|on[a-z]+)["']/i);
    }
    const app = read(rend, "app.js");
    expect(app.match(/window\.uasco\.(pickImportPath|openPreview|showExport)\(/g)?.length).toBe(3);
    for (const f of walk(rend).filter(x => x.endsWith(".js") || x.endsWith(".html") || x.endsWith(".css"))) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/);
      expect(s, f).not.toContain("x-uasco-control-token");
      expect(s.includes("\r"), `${f} must use LF`).toBe(false);
    }
  });
  it("api client adds only GET readers (no generic method), every new path is allowed by main, and invalid ids create no request", async () => {
    const apiMod = await load(rend, "api.js"), stMod = await load(rend, "state.js");
    const calls: string[] = [];
    const store = stMod.createStore(null);
    const client = apiMod.createApi({bridge: {apiGet: async (p: string) => { calls.push(p); throw new Error(`${p}: HTTP 404`); }}, store});
    expect(Object.keys(client).filter(k => /post|put|patch|delete/i.test(k))).toEqual(["post"]);
    await Promise.all([client.devrun(PID), client.projectFiles(PID), client.projectFiles(PID, "src/lib"), client.projectFile(PID, "src/a b.js"), client.gitLog(PID, 30), client.gitDiff(PID, HASH, "HEAD"), client.projectExports(PID), client.exportItem(PID, EXP), client.executors()]);
    const ok = loadGet();
    expect(calls.length).toBe(9);
    for (const p of calls) expect(ok(p), p).toBe(true);
    calls.length = 0; store.cache.clear();
    expect((await client.devrun("../x")).state).toBe("ERROR");
    expect((await client.projectFile(PID, "../x")).state).toBe("ERROR");
    expect((await client.projectFiles(PID, "/abs")).state).toBe("ERROR");
    expect((await client.gitLog(PID, 9999)).state).toBe("ERROR");
    expect((await client.gitDiff(PID, "main")).state).toBe("ERROR");
    expect((await client.exportItem(PID, "a/b")).state).toBe("ERROR");
    expect(calls).toEqual([]);
    expect((await client.devrun(PID)).state).toBe("UNAVAILABLE");
    expect((await client.executors()).state).toBe("UNAVAILABLE");
  });
  it("styles keep the new components accessible: diff markers, forced-colors and responsive rules; STOP is still never hidden", () => {
    const css = read(rend, "styles.css");
    for (const sel of [".studio-grid", ".studio-files", ".choice-group", ".diff-add", ".diff-del", ".code-view", ".badge-ok"]) expect(css, sel).toContain(sel);
    expect(css).toMatch(/\.studio-files\{[^}]*grid-template-columns/);
    const stopRules = css.split("}").filter(r => /\.btn-stop|\.actions|\.topbar/.test(r));
    for (const r of stopRules) expect(r, r).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
    expect(css).toContain("forced-colors:active");
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/);
  });
  it("validation.json appends this test at the very end of the tests step and nothing else changed there", () => {
    const cfg = JSON.parse(read(root, "config", "validation.json"));
    // PUBLIC-CI: "tests" adımı sıralı tests, tests-2..tests-N kabuklarına bölünebilir; bitişiklik/sıra kuralı kabukların birleşimi olan mantıksal liste üzerinde aynen geçerlidir.
    const step = {command: logicalTestFiles(cfg)};
    // c2: PS1B-C1-001 testi PS-1B UI testinin hemen ardından; V7-PKG-M1A-MODE (merge-tool sözleşmesi) m1a-* testlerini, UX paketleri de ux-* testlerini bu çiftin sonrasına ekler.
    const j = step.command.indexOf("tests/v7-ps1b-project-studio-ui.test.ts");
    expect(step.command.slice(j, j + 2)).toEqual(["tests/v7-ps1b-project-studio-ui.test.ts", "tests/v7-ps1b-relpath-canonical.test.ts"]);
    // V7-CORE-PREDEV (FA-V2-PRODUCT): CORE pre-dev sözleşme testi (core-predev-*) ve UX paketleri (ux-*) de sona eklenir; ps1b çiftinin sırası ve tekilliği değişmez.
    // MASTER-V2 C-RDY-1 (#260, R1 TEST_REGISTRATION_APPEND): rol hazırlık denetçisi testi (core-readiness-*) de sona eklenir; sıra ve tekillik kuralı aynen geçerlidir.
    for (const later of step.command.slice(j + 2)) expect(later).toMatch(/^tests\/v7-(?:b([6-9]|\d{2,})[a-z]?|ps\d+[a-z]?|m1a|core-predev|core-readiness|ux)-[a-z0-9-]+\.test\.ts$/);
    expect(step.command.filter((x: string) => x === "tests/v7-ps1b-project-studio-ui.test.ts").length).toBe(1);
    expect(step.command).toContain("tests/v7-b7-installer.test.ts");
  });
});

// ---------- PS-1B c3: odak tutma (PS1B-C2-001) ve bayat dev-run iletisi (PS1B-C2-002) ----------
describe("PS-1B c3: keyboard focus stays on a real element after every primary action (never <body>)", () => {
  // app.js renderRoute ile aynı odak mantığını (captureFocus -> değiştir -> restoreFocus -> yedek) gerçek focus.js ile çalıştıran canlı yeniden çizim.
  async function mkLive(o: CtxOpts, mode: "projects" | "settings" = "projects") {
    const c = await mkCtx(o), fm = await load(rend, "focus.js"), settings = await load(rend, "views", "settings.js");
    const view = mode === "settings" ? settings : projectsView;
    const redraw = async () => {
      c.store.cache.clear();
      const node = await view.render(c.ctx);
      const saved = fm.captureFocus(c.doc, c.doc.body), had = c.doc.body.contains(c.doc.activeElement) && c.doc.activeElement !== c.doc.body;
      c.doc.body.replaceChildren(node); fm.restoreFocus(c.doc, c.doc.body, saved);
      if (had && fm.focusLost(c.doc)) fm.settleFocus(c.doc, c.doc.body, {});
    };
    c.ctx.rerender = async () => { c.calls.rerender++; await redraw(); };
    c.ctx.refreshAll = async () => { c.calls.refresh++; await redraw(); };
    c.ctx.settleFocus = (opts: any) => fm.settleFocus(c.doc, c.doc.body, opts);
    await redraw();
    return {...c, fm, redraw, $: (id: string) => byId(c.doc.body, id)};
  }
  const focusId = (doc: D) => doc.activeElement === doc.body ? "<body>" : (doc.activeElement.id || doc.activeElement.tagName);
  const settleTicks = async () => { for (let i = 0; i < 8; i++) await tick(); };
  const press = async (n: N | null, ev = "click") => { expect(n).not.toBeNull(); n!.focus(); n!.fire(ev); await settleTicks(); };

  it("focus.js: settleFocus skips disabled targets, prefers keys, then the first list item, then the view title, and never returns body", async () => {
    const fm = await load(rend, "focus.js"), doc = new D(), main = doc.createElement("div");
    const mk = (tag: string, id: string, extra: Record<string, string> = {}) => { const n = doc.createElement(tag); n.attrs.set("id", id); Object.assign(n.dataset, extra); return n; };
    const title = mk("h1", "view-title"), off = mk("button", "off"), first = mk("button", "first", {focusFirst: "1"}), on = mk("button", "on");
    title.attrs.set("tabindex", "-1"); // gerçek görünüm başlığı gibi (h1 tabindex=-1)
    off.disabled = true; main.append(title, off, first, on); doc.body.append(main);
    expect(fm.focusLost(doc)).toBe(true);
    expect(fm.settleFocus(doc, main, {keys: ["id:off", "id:on"]})).toBe(on); // devre dışı atlanır
    doc.focused = null; expect(fm.settleFocus(doc, main, {keys: ["id:gone"]})).toBe(first); // ilk liste öğesi
    first.disabled = true; doc.focused = null; expect(fm.settleFocus(doc, main, {})).toBe(title); // başlık
    expect(fm.restoreFocus(doc, main, "id:off")).toBe(false);
    doc.focused = on; expect(fm.settleFocus(doc, main, {keys: ["id:first"]})).toBe(on); // canlı odak korunur
    expect(doc.activeElement).not.toBe(doc.body);
    off.disabled = false; doc.focused = off; off.disabled = true; expect(fm.focusLost(doc)).toBe(true); // devre dışı kalan odaklı öğe odağı kaybeder
  });
  it("wizard: failed validation and success each leave focus on the status result (not body); the create-open button leads to the workspace title", async () => {
    const {doc, $} = await mkLive({get: projectsGet(), post: () => ({status: 201, body: {project: {projectId: PID, name: "Yeni"}}})});
    $("studio-name")!.focus();
    $("studio-wizard-form")!.fire("submit"); await settleTicks();
    expect(focusId(doc)).toBe("studio-wizard-status"); // doğrulama hatası
    $("studio-name")!.value = "Yeni"; $("studio-name")!.fire("input");
    $("studio-wizard-submit")!.focus();
    $("studio-wizard-form")!.fire("submit"); await settleTicks();
    expect(focusId(doc)).toBe("studio-wizard-status");
    expect(text($("studio-wizard-status")!)).toContain("Yeni");
    await press($("studio-open-created"));
    expect(st.studio.projectId).toBe(PID);
    expect(focusId(doc)).toBe("view-title"); // tıklanan düğme kalktı; başlığa taşındı
  });
  it("wizard: a server error result also lands focus on the status region", async () => {
    const {doc, $} = await mkLive({get: projectsGet(), post: () => ({status: 503, body: {error: "WORKOS_UNAVAILABLE"}})});
    $("studio-name")!.value = "A"; $("studio-name")!.fire("input");
    $("studio-wizard-submit")!.focus();
    $("studio-wizard-form")!.fire("submit"); await settleTicks();
    expect(forms.drafts.status["studio-wizard"].key).toBe("post.err.503");
    expect(focusId(doc)).toBe("studio-wizard-status");
  });
  it("import: pick (success, cancel, no bridge), kind switch and submit never drop focus to body", async () => {
    let cancel = false;
    const native = {pickImportPath: async (kind: string) => cancel ? {cancelled: true} : {cancelled: false, path: kind === "zip" ? "C:\\Projeler\\app.zip" : "C:\\Projeler\\app", kind}};
    const {doc, $} = await mkLive({get: projectsGet(), post: () => ({status: 202, body: {}}), native});
    await press($("studio-import-pick"));
    expect(focusId(doc)).toBe("studio-import-pick");
    cancel = true; await press($("studio-import-pick"));
    expect(focusId(doc)).toBe("studio-import-pick");
    const kind = $("studio-import-kind")!; kind.focus(); kind.value = "zip"; kind.fire("change"); await settleTicks();
    expect(focusId(doc)).toBe("studio-import-kind");
    cancel = false; await press($("studio-import-pick"));
    expect(text($("studio-import-path")!)).toContain("Projeler");
    $("studio-import-submit")!.focus(); $("studio-import-form")!.fire("submit"); await settleTicks();
    expect(focusId(doc)).toBe("studio-import-status");
    expect($("studio-import-submit")!.disabled).toBe(true); // sıfırlanınca devre dışı; yine de odak gövdede değil
    const none = await mkLive({get: projectsGet()});
    await press(none.$("studio-import-pick"));
    expect(focusId(none.doc)).toBe("studio-import-status");
  });
  it("dev-run: start/stop/restart/preview and a declined confirmation keep focus on the control, or on the result when the control becomes disabled", async () => {
    let status = "STOPPED"; const opened: string[] = [];
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({status, pid: status === "STOPPED" ? null : 9, preview: status === "RUNNING" ? {url: "http://127.0.0.1:5173/", state: "AVAILABLE"} : {url: null, state: "UNAVAILABLE"}}) : projectsGet()(p);
    let yes = false;
    st.openProject(PID, "run");
    const {doc, $} = await mkLive({get: getFn, post: p => { if (p.endsWith("/start")) status = "RUNNING"; if (p.endsWith("/stop")) status = "STOPPED"; if (p.endsWith("/restart")) status = "RUNNING"; return {status: 202, body: {}}; }, confirm: () => yes, native: {openPreview: async (id: string) => { opened.push(id); return {opened: true}; }}});
    await press($("studio-run-start")); // onay reddedildi
    expect(focusId(doc)).toBe("studio-run-start");
    expect(text($("studio-devrun-status")!)).toContain("onaylanmad");
    yes = true;
    await press($("studio-run-start")); // başlat -> düğme devre dışı kalır
    expect($("studio-run-start")!.disabled).toBe(true);
    expect(focusId(doc)).toBe("studio-devrun-status");
    await press($("studio-run-preview"));
    expect(opened).toEqual([PID]);
    expect(focusId(doc)).toBe("studio-run-preview");
    await press($("studio-run-restart"));
    expect(focusId(doc)).toBe("studio-run-restart"); // hâlâ etkin
    await press($("studio-run-stop")); // durdur -> düğme devre dışı kalır
    expect($("studio-run-stop")!.disabled).toBe(true);
    expect(focusId(doc)).toBe("studio-devrun-status");
  });
  it("tabs: click and arrow keys keep focus on the active tab through the rebuild", async () => {
    st.openProject(PID, "overview");
    const L = await mkLive({get: projectsGet()});
    await press(L.$("studio-tab-run"));
    expect(focusId(L.doc)).toBe("studio-tab-run");
    L.$("studio-tab-run")!.focus(); L.$("studio-tab-run")!.fire("keydown", {key: "ArrowRight"}); await settleTicks();
    expect(focusId(L.doc)).toBe("studio-tab-files");
    L.$("studio-tab-files")!.fire("keydown", {key: "End"}); await settleTicks();
    expect(focusId(L.doc)).toBe("studio-tab-delivery");
  });
  it("files: opening a folder moves focus into the new list, up returns to the folder, opening a file keeps its button", async () => {
    const g = projectsGet({[`/v1/projects/${PID}/files`]: {entries: [{name: "src", type: "dir"}, {name: "README.md", type: "file", size: 12}]},
      [`/v1/projects/${PID}/files?path=src`]: {entries: [{name: "index.js", type: "file", size: 20}]},
      [`/v1/projects/${PID}/file?path=${enc("src/index.js")}`]: {content: "console.log(1)", size: 20}});
    st.openProject(PID, "files");
    const {doc, $} = await mkLive({get: g});
    await press($("fe-src"));
    expect(st.studio.dir).toBe("src");
    expect(focusId(doc)).toBe("fe-src/index.js"); // yeni listenin ilk öğesi
    await press($("fe-src/index.js"));
    expect(focusId(doc)).toBe("fe-src/index.js");
    expect(byId(doc.body, "studio-file-view")).not.toBeNull();
    await press($("studio-files-up"));
    expect(st.studio.dir).toBe("");
    expect(focusId(doc)).toBe("fe-src");
  });
  it("changes, delivery (export submit, validation error, show in folder) and back-to-list never leave focus on body", async () => {
    const g = projectsGet({[`/v1/projects/${PID}/git/log?limit=30`]: {commits: [{hash: HASH, subject: "ikinci", author: "A", date: "2026-10-15T00:00:00Z"}, {hash: "abcdef0123456789abcdef0123456789abcdef01", subject: "ilk"}]},
      [`/v1/projects/${PID}/git/diff?from=abcdef0123456789abcdef0123456789abcdef01&to=${HASH}`]: {diff: "@@ -1 +1 @@\n-a\n+b", files: [{path: "x", additions: 1, deletions: 1}]},
      [`/v1/projects/${PID}/exports`]: {exports: [{exportId: EXP, createdAt: "2026-10-15T00:00:00Z", commit: HASH, sizeBytes: 4096, status: "COMPLETE"}]}});
    st.openProject(PID, "changes");
    const L = await mkLive({get: g, post: () => ({status: 201, body: {export: {exportId: EXP}}}), native: {showExport: async () => ({shown: true})}});
    await press(L.$("studio-diff-show"));
    expect(byId(L.doc.body, "studio-diff-view")).not.toBeNull();
    expect(focusId(L.doc)).toBe("studio-diff-show");
    await press(L.$("studio-tab-delivery"));
    st.studio.commit = "main"; await L.redraw();
    L.$("studio-export-submit")!.focus(); L.$("studio-export-form")!.fire("submit"); await settleTicks();
    expect(forms.drafts.status["studio-export"].errors.commit).toBe("studio.err.commit");
    expect(focusId(L.doc)).toBe("studio-export-status");
    st.studio.commit = ""; await L.redraw();
    L.$("studio-export-submit")!.focus(); L.$("studio-export-form")!.fire("submit"); await settleTicks();
    expect(forms.drafts.status["studio-export"].key).toBe("studio.export.done");
    expect(focusId(L.doc)).toBe("studio-export-status");
    await press(L.$(`ex-show-${EXP}`));
    expect(forms.drafts.status["studio-export"].key).toBe("studio.export.shown");
    expect(focusId(L.doc)).toBe("studio-export-status");
    await press(L.$("studio-back"));
    expect(st.studio.projectId).toBeNull();
    expect(focusId(L.doc)).toBe(`open-${PID}`); // geri: proje listesindeki kendi "Aç" düğmesi
    await press(L.$(`open-${PID}`));
    expect(st.studio.projectId).toBe(PID);
    expect(focusId(L.doc)).toBe("view-title");
  });
  it("executors: declined and accepted enable leave focus on the result region (the enable button disappears when READY)", async () => {
    let state = "NOT_CONFIGURED", yes = false;
    const L = await mkLive({get: p => p === "/v1/system/executors" ? {executors: [{id: "LOCAL_CLAUDE", state}]} : undefined, post: () => { state = "READY"; return {status: 200, body: {}}; }, confirm: () => yes}, "settings");
    await press(L.$("exec-enable"));
    expect(focusId(L.doc)).toBe("executors-status");
    yes = true; await press(L.$("exec-enable"));
    expect(L.$("exec-enable")).toBeNull();
    expect(focusId(L.doc)).toBe("executors-status");
  });
  it("app.js wires the same focus.js mechanism: lost-focus safety net after rebuild, ctx.settleFocus, and the confirm dialog returns focus to its invoker", () => {
    const app = code(read(rend, "app.js"));
    expect(app).toContain("captureFocus(doc,main)");
    expect(app).toContain("restoreFocus(doc,main,saved)");
    expect(app).toContain("if(hadFocus&&focusLost(doc))settleFocus(doc,main,{keys:PANEL_FOCUS_FALLBACK[saved]??[]})");
    expect(app).toContain('"id:studio-devrun-status":["id:studio-run-state"]'); // c4: PS1B-C3-002
    expect(app).toContain("settleFocus:opts=>settleFocus(doc,main,opts)");
    expect(app).toContain("invoker=active&&active!==doc.body?active:null");
    expect(app).toContain("invoker.focus()");
    for (const f of ["studio-wizard.js", "studio-workspace.js", "executors-panel.js", "projects.js", "work.js"]) expect(code(read(rend, "views", f)), f).not.toContain("focusStatus(");
  });
});

describe("PS-1B c3: a dev-run action message does not outlive the state it described (PS1B-C2-002)", () => {
  it("clears the 'accepted' message when the polled dev-run state changes, and when the tab is rebuilt under a different state", async () => {
    vi.useFakeTimers();
    let status = "STOPPED";
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({status, pid: status === "STOPPED" ? null : 9, preview: {url: null, state: "UNAVAILABLE"}}) : projectsGet()(p);
    const {root} = await openWs({get: getFn, post: p => { if (p.endsWith("/start")) status = "STARTING"; return {status: 202, body: {}}; }, confirm: () => true}, "run");
    byId(root, "studio-run-start")!.fire("click");
    await vi.advanceTimersByTimeAsync(10);
    expect(text(byId(root, "studio-run-state")!)).toContain("Başlıyor");
    expect(text(byId(root, "studio-devrun-status")!)).toContain("Başlatma isteği kabul edildi"); // sonuç yansıtıldıktan sonra görünür
    expect(forms.drafts.status["studio-devrun"].forState).toBe("STARTING");
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10); // durum değişmedi -> ileti kalır
    expect(text(byId(root, "studio-devrun-status")!)).toContain("kabul edildi");
    status = "RUNNING";
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(text(byId(root, "studio-run-state")!)).toContain("Çalışıyor");
    expect(text(byId(root, "studio-devrun-status")!)).not.toContain("kabul edildi"); // bayat ileti silindi
    expect(forms.drafts.status["studio-devrun"]).toBeUndefined();
    // stop kabul edildi (STOPPED); sonra durum dışarıdan değişti; sekme yeniden kurulunca eski ileti gösterilmez
    status = "RUNNING";
    const again = await mkCtx({get: getFn, post: p => { if (p.endsWith("/stop")) status = "STOPPED"; return {status: 202, body: {}}; }, confirm: () => true});
    st.openProject(PID, "run");
    const r2 = mount(again.doc, await projectsView.render(again.ctx));
    byId(r2, "studio-run-stop")!.fire("click"); await vi.advanceTimersByTimeAsync(10);
    expect(text(byId(r2, "studio-devrun-status")!)).toContain("Durdurma isteği kabul edildi");
    status = "STARTING"; // dışarıdan başka bir başlatma
    workspace.stopRunPolling();
    const r3 = mount(again.doc, await projectsView.render(again.ctx));
    expect(text(byId(r3, "studio-run-state")!)).toContain("Başlıyor");
    expect(text(byId(r3, "studio-devrun-status")!)).not.toContain("Durdurma isteği kabul edildi");
  });
});

// ---------- PS-1B c4: yoklama kaynaklı yeniden çizim odaklı Stop'u devre dışı bırakınca odak gövdeye düşmez (PS1B-C3-001) ----------
describe("PS-1B c4: a poll-driven repaint that disables the focused dev-run control keeps focus on a real element", () => {
  const focusId = (doc: D) => doc.activeElement === doc.body ? "<body>" : (doc.activeElement.id || doc.activeElement.tagName);
  async function openRun(initial: string) {
    vi.useFakeTimers();
    let status = initial;
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({status, pid: status === "RUNNING" ? 9 : null, exitCode: status === "CRASHED" ? 1 : null, preview: status === "RUNNING" ? {url: "http://127.0.0.1:5173/", state: "AVAILABLE"} : {url: null, state: "UNAVAILABLE"}}) : projectsGet()(p);
    const c = await mkCtx({get: getFn, post: () => ({status: 202, body: {}}), confirm: () => true});
    const fm = await load(rend, "focus.js");
    c.ctx.settleFocus = (opts: any) => fm.settleFocus(c.doc, c.doc.body, opts);
    st.openProject(PID, "run");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    return {...c, root, setStatus: (v: string) => { status = v; }};
  }
  it("RUNNING, focus on Stop, stop POST leaves RUNNING, then the poll reports STOPPED -> focus lands on the status/state node, not <body>", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const stop = byId(root, "studio-run-stop")!;
    stop.focus();
    stop.fire("click"); await vi.advanceTimersByTimeAsync(10);
    expect(stop.disabled).toBe(false); // POST sonrası hâlâ RUNNING
    stop.focus(); // kullanıcı odağı Stop üzerine geri alır; yoklama durumu değiştirir
    expect(doc.activeElement).toBe(stop);
    setStatus("STOPPED");
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(stop.disabled).toBe(true);
    expect(focusId(doc)).toBe("studio-run-state"); // c5: tam iniş noktası (bayat ileti silindi, boş durum bloğu display:none)
  });
  it("RUNNING -> CRASHED by the poll alone (no user action) while Stop is focused -> focus lands on the status/state node", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const stop = byId(root, "studio-run-stop")!;
    stop.focus();
    setStatus("CRASHED");
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(stop.disabled).toBe(true);
    expect(focusId(doc)).toBe("studio-run-state"); // c5: tam iniş noktası (bayat ileti silindi, boş durum bloğu display:none)
  });
  it("a poll repaint does not steal focus when focus is outside the run panel or still on an enabled control", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const outside = doc.createElement("button"); outside.setAttribute("id", "outside-btn"); doc.body.append(outside); outside.focus();
    setStatus("STOPPED");
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(doc.activeElement).toBe(outside);
    const log = byId(root, "studio-log")!; log.focus();
    await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS * 2);
    expect(doc.activeElement).toBe(log);
  });
});

// ---------- PS-1B c5: odak yerleştirme doğrulanır ve odak alamayan aday atlanır (PS1B-C4-001) ----------
describe("PS-1B c5: focus placement is verified against activeElement and falls through to the next candidate (PS1B-C4-001)", () => {
  const focusId = (doc: D) => doc.activeElement === doc.body ? "<body>" : (doc.activeElement.id || doc.activeElement.tagName);
  // Chromium modeli: devre dışı kalan odaklı öğe activeElement olarak kalır (lazyBlur); flushBlur sonraki stil hesabıdır — son iniş noktası budur.
  const landed = (doc: D) => { doc.flushBlur(); return focusId(doc); };
  const mkEl = (doc: D, tag: string, id: string, attrs: Record<string, string> = {}, dataset: Record<string, string> = {}) => { const n = doc.createElement(tag); n.attrs.set("id", id); for (const [k, v] of Object.entries(attrs)) n.attrs.set(k, v); Object.assign(n.dataset, dataset); return n; };
  async function openRun(initial: string) {
    vi.useFakeTimers();
    let status = initial;
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({status, pid: status === "RUNNING" ? 9 : null, exitCode: status === "CRASHED" ? 1 : null, preview: status === "RUNNING" ? {url: "http://127.0.0.1:5173/", state: "AVAILABLE"} : {url: null, state: "UNAVAILABLE"}}) : projectsGet()(p);
    const c = await mkCtx({get: getFn, post: () => ({status: 202, body: {}}), confirm: () => true});
    c.doc.lazyBlur = true;
    const fm = await load(rend, "focus.js");
    c.ctx.settleFocus = (opts: any) => fm.settleFocus(c.doc, c.doc.body, opts);
    st.openProject(PID, "run");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    return {...c, root, setStatus: (v: string) => { status = v; }};
  }

  it("fake DOM models Chromium: focus() is a no-op on disabled, [hidden], empty .form-status and non-focusable nodes; a disabled focused node blurs lazily", () => {
    const doc = new D(); doc.lazyBlur = true;
    const btn = mkEl(doc, "button", "b"), off = mkEl(doc, "button", "off"), empty = mkEl(doc, "div", "st", {tabindex: "-1"}), full = mkEl(doc, "div", "st2", {tabindex: "-1"}), hid = mkEl(doc, "div", "h", {hidden: ""}), inHid = mkEl(doc, "button", "ih"), plain = mkEl(doc, "div", "plain");
    empty.className = "form-status"; full.className = "form-status form-status-ok"; full.append(doc.createElement("p")); off.disabled = true; hid.append(inHid);
    doc.body.append(btn, off, empty, full, hid, plain);
    for (const n of [off, empty, inHid, plain]) { n.focus(); expect(doc.activeElement, n.id).toBe(doc.body); }
    full.focus(); expect(doc.activeElement).toBe(full);
    btn.focus(); expect(doc.activeElement).toBe(btn);
    btn.disabled = true; expect(doc.activeElement).toBe(btn); // tembel blur: hâlâ activeElement
    expect(landed(doc)).toBe("<body>");
  });
  it("focus.js: settleFocus skips an empty (display:none) status and a non-focusable candidate and continues to the next key", async () => {
    const fm = await load(rend, "focus.js"), doc = new D(); doc.lazyBlur = true;
    const main = doc.createElement("div"), stop = mkEl(doc, "button", "stop"), status = mkEl(doc, "div", "x-status", {tabindex: "-1"}), panelEl = mkEl(doc, "section", "panel"), state = mkEl(doc, "p", "state", {tabindex: "-1"}), title = mkEl(doc, "h1", "view-title", {tabindex: "-1"});
    status.className = "form-status"; main.append(title, stop, status, panelEl, state); doc.body.append(main);
    stop.focus(); stop.disabled = true; // tembel: odak hâlâ devre dışı Stop üzerinde
    expect(fm.settleFocus(doc, main, {keys: ["id:x-status", "id:panel", "id:state"]})).toBe(state);
    expect(landed(doc)).toBe("state");
  });
  it("focus.js: the data-focus-first loop and the view-title fallback continue past candidates that cannot take focus; nothing focusable -> null", async () => {
    const fm = await load(rend, "focus.js"), doc = new D(); doc.lazyBlur = true;
    const main = doc.createElement("div"), wrap = mkEl(doc, "div", "wrap", {hidden: ""}), f1 = mkEl(doc, "button", "f1", {}, {focusFirst: "1"}), f2 = mkEl(doc, "button", "f2", {}, {focusFirst: "1"}), title = mkEl(doc, "h1", "view-title", {tabindex: "-1"}), gone = mkEl(doc, "button", "gone");
    wrap.append(f1); main.append(title, gone, wrap, f2); doc.body.append(main);
    gone.focus(); gone.disabled = true;
    expect(fm.settleFocus(doc, main, {keys: ["id:missing"]})).toBe(f2); // gizli ilk liste öğesi atlandı
    expect(landed(doc)).toBe("f2");
    f2.disabled = true; doc.flushBlur();
    expect(fm.settleFocus(doc, main, {})).toBe(title);
    expect(landed(doc)).toBe("view-title");
    title.attrs.delete("tabindex"); doc.focused = null;
    expect(fm.settleFocus(doc, main, {})).toBeNull(); // odaklanamayan başlık "yerleştirildi" sayılmaz
  });
  it("focus.js: restoreFocus reports false when the restored node cannot take focus (emptied status), so the safety-net fallback runs", async () => {
    const fm = await load(rend, "focus.js"), doc = new D(); doc.lazyBlur = true;
    const main = doc.createElement("div"), status = mkEl(doc, "div", "studio-devrun-status", {tabindex: "-1"}), state = mkEl(doc, "p", "studio-run-state", {tabindex: "-1"});
    status.className = "form-status"; main.append(status, state); doc.body.append(main);
    expect(fm.restoreFocus(doc, main, "id:studio-devrun-status")).toBe(false);
    expect(fm.focusLost(doc)).toBe(true);
    expect(fm.settleFocus(doc, main, {keys: ["id:studio-run-state"]})).toBe(state); // app.js PANEL_FOCUS_FALLBACK yedeği
    expect(fm.restoreFocus(doc, main, "id:studio-run-state")).toBe(true);
  });
  it("S1: RUNNING, Stop -> 202 (still RUNNING), focus back on Stop, poll reports STOPPED -> exactly #studio-run-state", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const stop = byId(root, "studio-run-stop")!;
    stop.focus(); stop.fire("click"); await vi.advanceTimersByTimeAsync(10);
    expect(stop.disabled).toBe(false);
    expect(text(byId(root, "studio-devrun-status")!)).toContain("Durdurma isteği kabul edildi");
    expect(focusId(doc)).toBe("studio-run-stop");
    setStatus("STOPPED"); await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(stop.disabled).toBe(true);
    expect(text(byId(root, "studio-devrun-status")!)).toBe(""); // bayat ileti silindi -> boş blok display:none
    expect(focusId(doc)).toBe("studio-run-state");
    expect(landed(doc)).toBe("studio-run-state");
  });
  it("S2: RUNNING -> CRASHED by the poll alone while Stop is focused -> exactly #studio-run-state", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const stop = byId(root, "studio-run-stop")!; stop.focus();
    setStatus("CRASHED"); await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(stop.disabled).toBe(true);
    expect(landed(doc)).toBe("studio-run-state");
  });
  it("S3: focus on Open preview, the poll reports CRASHED -> exactly #studio-run-state", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const pv = byId(root, "studio-run-preview")!; expect(pv.disabled).toBe(false); pv.focus(); expect(doc.activeElement).toBe(pv);
    setStatus("CRASHED"); await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(pv.disabled).toBe(true);
    expect(landed(doc)).toBe("studio-run-state");
  });
  it("S5: focus on Restart, the poll reports STOPPED -> exactly #studio-run-state", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const rs = byId(root, "studio-run-restart")!; expect(rs.disabled).toBe(false); rs.focus(); expect(doc.activeElement).toBe(rs);
    setStatus("STOPPED"); await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(rs.disabled).toBe(true);
    expect(landed(doc)).toBe("studio-run-state");
  });
  it("S4 control: focus on the enabled #studio-log stays on the log through a CRASHED poll", async () => {
    const {root, doc, setStatus} = await openRun("RUNNING");
    const log = byId(root, "studio-log")!; log.focus();
    setStatus("CRASHED"); await vi.advanceTimersByTimeAsync(workspace.RUN_POLL_MS + 10);
    expect(byId(root, "studio-run-stop")!.disabled).toBe(true);
    expect(landed(doc)).toBe("studio-log");
    expect(doc.activeElement).toBe(log);
  });
});

// //TR: SBX-8 G (D-SBX-11 b): Ayarlar → AI Yürütücüleri, ayrı UASCO Claude profillerinin (implementer / salt-okunur reviewer) durumunu ve Founder'ın kendisinin çalıştıracağı giriş komutunu YALNIZ METİN olarak gösterir; komutu çalıştıran veya kimlik isteyen hiçbir düğme yoktur; şüpheli komut/durum gösterilmez.
describe("SBX-8 G: Settings shows the UASCO Claude profile status and the login command text", () => {
  const BS = String.fromCharCode(92); // ters bölü (Windows yolu)
  const cmd = (role: string) => `$env:CLAUDE_CONFIG_DIR='${["C:", "Users", "x", "AppData", "Roaming", "UASCO", "control", "claude-profiles", role].join(BS)}'; claude; Remove-Item Env:${BS}CLAUDE_CONFIG_DIR`;
  it("maps only implementer/reviewer with safe state/reason and a well-formed login command; anything else is dropped", () => {
    expect(core.mapClaudeProfiles(undefined)).toEqual([]);
    expect(core.mapClaudeProfiles({implementer: {state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: cmd("implementer")}, reviewer: {state: "bad state", reason: "x y", loginCommand: "calc.exe"}, personal: {state: "READY"}}))
      .toEqual([{role: "implementer", state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: cmd("implementer")}, {role: "reviewer", state: null, reason: null, loginCommand: null}]);
    expect(core.mapClaudeProfiles({implementer: {state: "READY", loginCommand: `${cmd("implementer")}\nStart-Process calc`}})[0].loginCommand).toBeNull();
    expect(core.mapExecutors({executors: [], claudeProfiles: {reviewer: {state: "REFUSED", reason: "CLAUDE_PROFILE_REFUSED:PROFILE_PATH_INSIDE_GIT_WORKTREE", loginCommand: null}}}).profiles).toEqual([{role: "reviewer", state: "REFUSED", reason: "CLAUDE_PROFILE_REFUSED:PROFILE_PATH_INSIDE_GIT_WORKTREE", loginCommand: null}]);
  });
  it("renders both profiles with honest states and the command as text only (no extra buttons, nothing executed or posted)", async () => {
    const settings = await load(rend, "views", "settings.js");
    const body = {executors: [{id: "LOCAL_CLAUDE", state: "READY"}], claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: cmd("implementer")}, reviewer: {state: "READY", loginCommand: cmd("reviewer")}}};
    for (const lang of ["tr", "en"]) {
      const {ctx, doc, calls} = await mkCtx({lang, get: p => p === "/v1/system/executors" ? body : undefined});
      const root = mount(doc, await settings.render(ctx));
      const sec = byId(root, "settings-claude-profiles")!;
      expect(sec, lang).not.toBeNull();
      const t = text(sec);
      expect(t).toContain(lang === "tr" ? "Giriş gerekli" : "Sign-in required");
      expect(t).toContain(lang === "tr" ? "Giriş yapıldı" : "Signed in");
      expect(t).toContain(lang === "tr" ? "salt okunur" : "read-only");
      expect(t).toContain(cmd("implementer"));
      expect(t).toContain(cmd("reviewer"));
      expect(all(sec).some(n => n.tagName === "BUTTON")).toBe(false);
      expect(calls.post).toEqual([]);
    }
  });
  it("no claudeProfiles in the response (older backend) -> no profile section", async () => {
    const settings = await load(rend, "views", "settings.js");
    const {ctx, doc} = await mkCtx({get: p => p === "/v1/system/executors" ? {executors: [{id: "LOCAL_CLAUDE", state: "READY"}]} : undefined});
    expect(byId(mount(doc, await settings.render(ctx)), "settings-claude-profiles")).toBeNull();
  });
});

// //TR: test+states: studio-wizard (functional/negative/a11y) — Yeni Proje sihirbazı ve İçe Aktar paneli: başarısız/ağ hatalı gönderimde başarı uydurulmadığını, geçersiz proje kimliğinin "oluşturuldu" durumu kurmadığını, yerel diyalog hatasında dürüst durum gösterildiğini, proje yokken içe aktarma gönderiminin kapalı kaldığını ve erişilebilirlik sözleşmesini (fieldset/legend, aria-describedby/invalid, tipli düğmeler, role=alert) doğrular.
describe("test+states studio-wizard: negative (no fabricated success)", () => {
  const fillValid = (root: N) => { byId(root, "studio-name")!.value = "Yeni"; byId(root, "studio-name")!.fire("input"); };
  it("a network failure (bridge throws) records an error status, keeps the draft and never reports success or sets lastCreated", async () => {
    // //TR: Köprü hata fırlatınca başarı bildirilmez, taslak korunur.
    const {ctx, doc, calls} = await mkCtx({get: projectsGet()}); // post tanımsız: CONTROL_API_UNREACHABLE
    const root = mount(doc, await projectsView.render(ctx));
    fillValid(root);
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    expect(calls.post.length).toBe(1);
    const status = forms.drafts.status["studio-wizard"];
    expect(status.ok).toBe(false);
    expect(st.studio.lastCreated).toBeFalsy();
    expect(st.wizard.name).toBe("Yeni");
    expect(forms.drafts.busy["studio-wizard"]).toBe(false);
    const root2 = mount(doc, await projectsView.render(ctx));
    expect(byId(root2, "studio-wizard-status")!.getAttribute("role")).toBe("alert");
    expect(byId(root2, "studio-open-created")).toBeNull();
  });
  it("HTTP 4xx/5xx never marks success; a 201 without a valid prj_ id succeeds without a fabricated open-created shortcut", async () => {
    for (const code of [400, 403, 409, 500]) {
      forms.resetAllForms(); st.resetStudio();
      const {ctx, doc} = await mkCtx({get: projectsGet(), post: () => ({status: code, body: {error: "NOPE"}})});
      const root = mount(doc, await projectsView.render(ctx));
      fillValid(root);
      byId(root, "studio-wizard-form")!.fire("submit"); await tick();
      expect(forms.drafts.status["studio-wizard"].ok, String(code)).toBe(false);
      expect(st.studio.lastCreated, String(code)).toBeFalsy();
      expect(st.wizard.name, String(code)).toBe("Yeni");
    }
    forms.resetAllForms(); st.resetStudio();
    const {ctx, doc} = await mkCtx({get: projectsGet(), post: () => ({status: 201, body: {project: {projectId: "not-an-id", name: "X"}}})});
    const root = mount(doc, await projectsView.render(ctx));
    fillValid(root);
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    expect(st.studio.lastCreated).toBeFalsy(); // geçersiz kimlik ile sahte "Aç" kısayolu kurulmaz
    const root2 = mount(doc, await projectsView.render(ctx));
    expect(byId(root2, "studio-open-created")).toBeNull();
  });
  it("invalid input sends nothing and flags the offending field with aria-invalid and a described error", async () => {
    const {ctx, doc, calls} = await mkCtx({get: projectsGet()});
    let root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-wizard-form")!.fire("submit"); await tick(); // ad boş
    expect(calls.post).toEqual([]);
    root = mount(doc, await projectsView.render(ctx));
    const name = byId(root, "studio-name")!;
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const err = byId(root, "studio-name-err")!;
    expect(text(err).length).toBeGreaterThan(0);
    expect(name.getAttribute("aria-describedby") ?? "").toContain("studio-name-err");
  });
  it("a native dialog that throws shows the honest dialogFailed status and keeps the path empty", async () => {
    const native = {pickImportPath: async () => { throw new Error("boom"); }};
    const {ctx, doc} = await mkCtx({get: projectsGet(), native});
    const root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    expect(forms.drafts.status["studio-import"].key).toBe("studio.import.dialogFailed");
    expect(forms.drafts.status["studio-import"].ok).toBe(false);
    expect(st.importDraft.path).toBe("");
  });
  it("import POST failure does not clear the chosen path and reports a non-success status", async () => {
    const native = {pickImportPath: async (kind: string) => ({cancelled: false, path: "C:\\Projeler\\app", kind})};
    const {ctx, doc, calls} = await mkCtx({get: projectsGet(), native, post: () => ({status: 500, body: {error: "X"}})});
    let root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    expect(calls.post.length).toBe(1);
    expect(forms.drafts.status["studio-import"].ok).toBe(false);
    expect(st.importDraft.path).toBe("C:\\Projeler\\app");
  });
  it("with no listed projects (projects read failed) the import form cannot be submitted even after a path is picked", async () => {
    const native = {pickImportPath: async (kind: string) => ({cancelled: false, path: "C:\\x", kind})};
    const {ctx, doc, calls} = await mkCtx({get: () => undefined, native, post: () => ({status: 202, body: {}})});
    let root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    root = mount(doc, await projectsView.render(ctx));
    expect(byId(root, "studio-import-submit")!.hasAttribute("disabled")).toBe(true);
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    expect(calls.post).toEqual([]);
  });
});

describe("test+states studio-wizard: accessibility", () => {
  it("template and OS choices are fieldsets with legends and labelled inputs (radio group shares one name)", async () => {
    const {ctx, doc} = await mkCtx({get: projectsGet()});
    const root = mount(doc, await projectsView.render(ctx));
    for (const id of ["studio-template", "studio-os"]) {
      const fs_ = byId(root, id)!;
      expect(fs_.tagName).toBe("FIELDSET");
      const legend = fs_.children.find(c => c.tagName === "LEGEND")!;
      expect(text(legend).length).toBeGreaterThan(0);
      const inputs = all(fs_).filter(n => n.tagName === "INPUT");
      expect(inputs.length).toBeGreaterThan(1);
      for (const i of inputs) expect(all(fs_).some(l => l.tagName === "LABEL" && l.getAttribute("for") === i.id), i.id).toBe(true);
    }
    const radios = all(byId(root, "studio-template")!).filter(n => n.tagName === "INPUT");
    expect(new Set(radios.map(r => r.attrs.get("name"))).size).toBe(1);
    expect(byId(root, "studio-template")!.getAttribute("aria-describedby")).toContain("studio-template-hint");
  });
  it("forms are named by their summary, every button is explicitly typed, and the submit buttons are type=submit", async () => {
    const {ctx, doc} = await mkCtx({get: projectsGet()});
    const root = mount(doc, await projectsView.render(ctx));
    expect(byId(root, "studio-wizard-form")!.getAttribute("aria-labelledby")).toBe("studio-wizard-t");
    expect(byId(root, "studio-import-form")!.getAttribute("aria-labelledby")).toBe("studio-import-t");
    expect(byId(root, "studio-wizard-t")!.tagName).toBe("SUMMARY");
    expect(byId(root, "studio-import-t")!.tagName).toBe("SUMMARY");
    expect(byId(root, "studio-wizard-submit")!.getAttribute("type")).toBe("submit");
    expect(byId(root, "studio-import-submit")!.getAttribute("type")).toBe("submit");
    for (const sc of ["studio-wizard", "studio-import"]) for (const b of all(byId(root, sc)!).filter(n => n.tagName === "BUTTON")) expect(["button", "submit"], b.id || text(b)).toContain(b.getAttribute("type"));
  });
  it("the chosen import path is a polite live region labelled by its field label, and shows the honest none-chosen text first", async () => {
    const {ctx, doc} = await mkCtx({get: projectsGet()});
    const root = mount(doc, await projectsView.render(ctx));
    const p = byId(root, "studio-import-path")!;
    expect(p.getAttribute("aria-live")).toBe("polite");
    expect(p.getAttribute("aria-labelledby")).toBe("studio-import-path-l");
    expect(byId(root, "studio-import-path-l")!.tagName).toBe("SPAN");
    expect(text(p).length).toBeGreaterThan(0);
    expect(text(p)).not.toMatch(/^[A-Za-z]:\\|^\//); // yol seçilmeden bir yol gösterilmez
  });
  it("keyboard: the submit button is disabled while a submission is in flight, so Enter/Space cannot double-post", async () => {
    let release: (v: any) => void = () => {};
    const pending = new Promise(r => { release = r; });
    const {ctx, doc, calls} = await mkCtx({get: projectsGet()});
    (ctx.api as any).post = async (p: string, b: any) => { calls.post.push({path: p, body: b}); return pending; };
    let root = mount(doc, await projectsView.render(ctx));
    byId(root, "studio-name")!.value = "Yeni"; byId(root, "studio-name")!.fire("input");
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    expect(forms.drafts.busy["studio-wizard"]).toBe(true);
    byId(root, "studio-wizard-form")!.fire("submit"); await tick(); // ikinci Enter
    expect(calls.post.length).toBe(1);
    root = mount(doc, await projectsView.render(ctx));
    expect(byId(root, "studio-wizard-submit")!.hasAttribute("disabled")).toBe(true);
    release({status: 500, body: {}}); await tick();
    expect(forms.drafts.busy["studio-wizard"]).toBe(false);
  });
});

describe("test+states studio-wizard: EN/TR parity and English rendering", () => {
  it("every literal key in studio-wizard.js, every template/OS/import-kind label exists in both locales with equal placeholders", async () => {
    // //TR: Sihirbazın kullandığı tüm anahtarlar iki dilde tanımlıdır.
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>, en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const pc = await load(rend, "project-core.js");
    const src = fs.readFileSync(path.join(rend, "views", "studio-wizard.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|hintKey:|itemLabelKey:|addKey:|removeKey:|legendKey:)\s*"([a-zA-Z0-9_.-]+)"/g)) keys.add(m[1]);
    for (const t of pc.TEMPLATES) { keys.add(`studio.template.${t}`); keys.add(`studio.template.${t}.desc`); }
    for (const o of pc.TARGET_OS) keys.add(`studio.os.${o}`);
    for (const k of pc.IMPORT_KINDS) keys.add(`studio.import.kind.${k}`);
    expect(keys.size).toBeGreaterThan(25);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(k in tr && k in en, k).toBe(true); expect(ph(en[k]), k).toBe(ph(tr[k])); expect(en[k].trim().length, k).toBeGreaterThan(0); }
  });
  it("renders the wizard and import panels in English without Turkish UI copy", async () => {
    const {ctx, doc} = await mkCtx({get: projectsGet(), lang: "en"});
    const root = mount(doc, await projectsView.render(ctx));
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>, en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(text(byId(root, "studio-wizard-t")!)).toBe(en["studio.wizard.title"]);
    expect(text(byId(root, "studio-wizard-t")!)).not.toBe(tr["studio.wizard.title"]);
    expect(text(byId(root, "studio-import-t")!)).toBe(en["studio.import.title"]);
    expect(text(byId(root, "studio-wizard-submit")!)).toBe(en["studio.wizard.submit"]);
  });
});

// //TR: UX hardening — AI Yürütücüleri paneli: boş liste, başarısız etkinleştirme, bilinmeyen durum, FAKE için eylem yok, erişilebilirlik ve EN/TR eşitliği (dürüst durum; READY uydurulmaz).
describe("UX hardening: executors panel functional / negative / a11y", () => {
  const EX = "/v1/system/executors";
  const run = async (opts: any) => {
    const settings = await load(rend, "views", "settings.js");
    const c = await mkCtx(opts);
    return {...c, root: mount(c.doc, await settings.render(c.ctx))};
  };
  it("shows the empty note for an empty executor list and no enable button", async () => {
    const {root} = await run({get: (p: string) => p === EX ? {executors: []} : undefined});
    expect(text(byId(root, "settings-executors")!)).toContain("Sunucu hiç yürütücü bildirmedi");
    expect(byId(root, "exec-enable")).toBeNull();
  });
  it("shows an unreadable payload as an error state, never as a ready executor", async () => {
    const {root} = await run({get: (p: string) => p === EX ? {executors: "x"} : undefined});
    const panel = byId(root, "settings-executors")!;
    expect(all(panel).some(n => n.attrs.get("role") === "status")).toBe(true);
    expect(all(panel).filter(n => n.className.includes("badge-ok")).length).toBe(0);
    expect(byId(root, "exec-enable")).toBeNull();
  });
  it("renders a missing state as Unknown (no ready badge) and offers no enable", async () => {
    const {root} = await run({lang: "en", get: (p: string) => p === EX ? {executors: [{id: "LOCAL_CLAUDE"}]} : undefined});
    const panel = byId(root, "settings-executors")!;
    expect(text(panel)).toContain("Unknown");
    expect(all(panel).filter(n => n.className.includes("badge-ok")).length).toBe(0);
    expect(byId(root, "exec-enable")).toBeNull();
  });
  it("never offers enable for the test-only FAKE executor even when NOT_CONFIGURED", async () => {
    const {root} = await run({lang: "en", get: (p: string) => p === EX ? {executors: [{id: "FAKE", state: "NOT_CONFIGURED"}]} : undefined});
    expect(byId(root, "exec-enable")).toBeNull();
    expect(text(byId(root, "settings-executors")!)).toContain("test only");
  });
  it("announces a failed enable request as an error and does not claim it was enabled", async () => {
    for (const status of [403, 503]) {
      const {root, ctx} = await run({lang: "en", get: (p: string) => p === EX ? {executors: [{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED"}]} : undefined, post: () => ({status, body: {}}), confirm: () => true});
      byId(root, "exec-enable")!.fire("click"); await tick();
      expect(forms.drafts.status.executors.ok, String(status)).toBe(false);
      expect(forms.drafts.status.executors.key).not.toBe("exec.enabled");
      expect(ctx.t(forms.drafts.status.executors.key, forms.drafts.status.executors.vars)).not.toMatch(/accepted/);
    }
  });
  it("announces a bridge exception on enable as an error", async () => {
    const {root} = await run({get: (p: string) => p === EX ? {executors: [{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED"}]} : undefined, post: () => { throw new Error("BRIDGE_DOWN"); }, confirm: () => true});
    byId(root, "exec-enable")!.fire("click"); await tick();
    expect(forms.drafts.status.executors.ok).toBe(false);
  });
  it("is accessible: typed button, live status region, labelled section, headings", async () => {
    const {root} = await run({lang: "en", get: (p: string) => p === EX ? {executors: [{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED"}], claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"}}} : undefined});
    const panel = byId(root, "settings-executors")!;
    expect(panel.getAttribute("aria-labelledby")).toBeTruthy();
    expect(byId(root, "exec-enable")!.getAttribute("type")).toBe("button");
    expect(all(panel).some(n => n.id === "executors-status" && n.getAttribute("aria-live") === "polite")).toBe(true);
    expect(all(panel).filter(n => n.tagName === "H3").length).toBeGreaterThan(0);
    expect(all(byId(root, "settings-claude-profiles")!).filter(n => n.tagName === "H3" || n.tagName === "H4").length).toBeGreaterThan(1);
  });
  it("has identical en/tr exec.* key sets and placeholders, and every exec key used by the panel exists", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>, en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    const keys = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("exec.")).sort();
    expect(keys(tr)).toEqual(keys(en));
    const ph = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
    for (const k of keys(en)) expect(ph(tr[k]), k).toEqual(ph(en[k]));
    const used = [...fs.readFileSync(path.join(rend, "views", "executors-panel.js"), "utf8").matchAll(/"(exec\.[A-Za-z0-9_.]+)"/g)].map(m => m[1]);
    expect(used.filter(k => !(k in tr && k in en))).toEqual([]);
  });
});

describe("UI-125: brownfield import shows the server's specific rejection and failure codes", () => {
  const ZIP = ["ZIP_INVALID", "ZIP_UNSUPPORTED_FEATURE", "ZIP_PATH_TRAVERSAL", "ZIP_INVALID_NAME", "ZIP_FORBIDDEN_PATH", "ZIP_SYMLINK_REJECTED", "ZIP_SPECIAL_FILE_REJECTED", "ZIP_DUPLICATE_ENTRY", "ZIP_TOO_LARGE", "ZIP_TOO_MANY_FILES", "ZIP_CRC_MISMATCH", "ZIP_EMPTY"];
  const REJ = ["IMPORT_PATH_INVALID", "IMPORT_REMOTE_NOT_SUPPORTED", "IMPORT_PATH_NOT_ABSOLUTE", "IMPORT_SOURCE_FORBIDDEN", "IMPORT_SOURCE_NOT_FOUND", "IMPORT_SOURCE_NOT_A_REPOSITORY", ...ZIP];
  const ph = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
  const load2 = async () => ({pc: await load(rend, "project-core.js"), wc: await load(rend, "work-core.js"), en: (await load(rend, "locales", "en.js")).default as Record<string, string>, tr: (await load(rend, "locales", "tr.js")).default as Record<string, string>});
  const r = (status: number, body: unknown) => ({status, body});

  it("every closed-set rejection code maps to a static key that prints the exact code, never post.err.400", async () => {
    const {pc, en, tr} = await load2();
    for (const code of REJ) {
      const d = pc.describeImportResult(r(400, {error: "IMPORT_REJECTED", reason: code}));
      expect(d.ok).toBe(false);
      expect(d.key).not.toBe("post.err.400");
      expect(d.key).toMatch(/^studio\.import\.err\./);
      expect(d.vars).toEqual({status: 400, code});
      expect(en[d.key]).toContain("{code}"); expect(tr[d.key]).toContain("{code}");
    }
  });
  it("unknown safe codes get the generic code keys; missing or unsafe codes get a generic key without a code", async () => {
    const {pc, en, tr} = await load2();
    expect(pc.describeImportResult(r(400, {error: "IMPORT_REJECTED", reason: "SOMETHING_NEW"}))).toEqual({ok: false, key: "studio.import.err.rejectedCode", vars: {status: 400, code: "SOMETHING_NEW"}});
    expect(pc.describeImportResult(r(422, {error: "IMPORT_FAILED", reason: "SOMETHING_NEW"}))).toEqual({ok: false, key: "studio.import.err.failedCode", vars: {status: 422, code: "SOMETHING_NEW"}});
    for (const reason of [undefined, null, 5, "lower", "A", "X".repeat(65), "BAD CODE", "<b>X_Y</b>"]) {
      const d = pc.describeImportResult(r(400, {error: "IMPORT_REJECTED", reason}));
      expect(d.key).toBe("studio.import.err.rejected"); expect(d.vars).toEqual({status: 400});
      expect(pc.describeImportResult(r(422, {error: "IMPORT_FAILED", reason})).key).toBe("studio.import.err.failed");
    }
    for (const k of ["studio.import.err.rejected", "studio.import.err.failed"]) expect(en[k]).not.toContain("{code}");
    expect(tr["studio.import.err.rejectedCode"]).toContain("{code}");
  });
  it("422 specific reasons and the three 409 variants map to specific keys", async () => {
    const {pc} = await load2();
    const keys = new Set<string>();
    for (const code of ["GIT_CLONE_FAILED", "IMPORT_SOURCE_EMPTY", "AGENT_CONFIG_QUARANTINE_FAILED"]) {
      const d = pc.describeImportResult(r(422, {error: "IMPORT_FAILED", reason: code}));
      expect(d.vars).toEqual({status: 422, code}); expect(d.key).not.toBe("studio.import.err.failedCode"); keys.add(d.key);
    }
    expect(keys.size).toBe(3);
    for (const b of [{error: "PROJECT_REPOSITORY_ALREADY_MANAGED"}, {error: "DEVRUN_ACTIVE"}, {error: "WORKOS_CONFLICT", reason: "RUN_ALREADY_ACTIVE"}]) {
      const d = pc.describeImportResult(r(409, b));
      expect(d.ok).toBe(false); expect(d.key).toMatch(/^studio\.import\.err\./); keys.add(d.key);
    }
    expect(keys.size).toBe(6);
  });
  it("every other response delegates to describePostResult unchanged; ok only on 2xx", async () => {
    const {pc, wc} = await load2();
    const cases: unknown[] = [r(202, {}), r(200, {error: "IMPORT_REJECTED"}), r(400, {error: "OTHER"}), r(400, null), r(401, {}), r(403, {error: "ACTION_DENIED", reason: "X_Y"}), r(404, {}), r(409, {error: "SOMETHING"}), r(409, {error: "WORKOS_CONFLICT", reason: "OTHER_REASON"}), r(423, {}), r(503, {}), r(500, {error: "IMPORT_FAILED", reason: "GIT_CLONE_FAILED"}), r(422, {error: "OTHER"}), {thrown: true, state: "OFFLINE"}, {thrown: true}, null, undefined];
    for (const c of cases) expect(pc.describeImportResult(c)).toEqual(wc.describePostResult(c));
    expect(pc.describeImportResult(r(202, {})).ok).toBe(true);
    expect(pc.describeImportResult(r(400, {error: "IMPORT_REJECTED", reason: "ZIP_EMPTY"})).ok).toBe(false);
  });
  it("en/tr: all UI-125 keys exist, are non-empty and keep identical placeholders; messages make no unsupported claims", async () => {
    const {pc, en, tr} = await load2();
    const ks = Object.keys(en).filter(k => k.startsWith("studio.import.err."));
    expect(ks.length).toBeGreaterThanOrEqual(19);
    for (const k of ks) { expect(en[k].length).toBeGreaterThan(0); expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toEqual(ph(en[k])); expect(en[k]).not.toMatch(/\b(type|paste|enter)\b.*\b(path|URL)\b/i); }
    for (const code of REJ) expect(ks).toContain(pc.describeImportResult(r(400, {error: "IMPORT_REJECTED", reason: code})).key);
  });
  it("panel: a failed import shows the specific key, keeps the chosen path for retry and focuses the alert; 2xx still resets", async () => {
    const cases: Array<[number, any, string]> = [[400, {error: "IMPORT_REJECTED", reason: "ZIP_TOO_LARGE"}, "zip"], [422, {error: "IMPORT_FAILED", reason: "GIT_CLONE_FAILED"}, "git"], [409, {error: "PROJECT_REPOSITORY_ALREADY_MANAGED"}, "git"]];
    for (const [status, body, kind] of cases) {
      const native = {pickImportPath: async (k: string) => ({cancelled: false, path: k === "zip" ? "C:\\z\\a.zip" : "C:\\Projeler\\app", kind: k})};
      const {ctx, doc, calls} = await mkCtx({get: projectsGet(), post: () => ({status, body}), native});
      let root = mount(doc, await projectsView.render(ctx));
      if (kind === "zip") { const sel = byId(root, "studio-import-kind")!; sel.value = "zip"; sel.fire("change"); await tick(); root = mount(doc, await projectsView.render(ctx)); }
      byId(root, "studio-import-pick")!.fire("click"); await tick();
      root = mount(doc, await projectsView.render(ctx));
      const expected = (await load(rend, "project-core.js")).describeImportResult({status, body});
      byId(root, "studio-import-form")!.fire("submit"); await tick();
      expect(calls.post.length).toBe(1);
      expect(Object.keys(calls.post[0].body)).toEqual(["kind", "path"]);
      expect(forms.drafts.status["studio-import"].ok).toBe(false);
      expect(forms.drafts.status["studio-import"].key).toBe(expected.key);
      expect(forms.drafts.status["studio-import"].key).not.toBe("post.err.400");
      expect(st.importDraft.path).not.toBe("");
      root = mount(doc, await projectsView.render(ctx));
      const alert = byId(root, "studio-import-status");
      expect(alert).not.toBeNull(); expect(alert!.attrs.get("role")).toBe("alert");
      expect(text(alert!)).not.toContain("schema validation");
    }
  });
});

// //TR: LANE-A first-delivery akışı: yeni proje oluşturulunca Kurucu fikri formu ilk mission'ı gerçek POST /v1/missions ile açar; başarı uydurulmaz, görev yoksa dürüst not gösterilir.
describe("LANE-A founder idea -> first mission (fake DOM)", () => {
  const MSN = "msn_" + "ef56".repeat(6);
  const created = async (post: (p: string, b: any) => {status: number; body: any}) => {
    const c = await mkCtx({get: projectsGet(), post, lang: "en"});
    let root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-name")!.value = "Shop"; byId(root, "studio-name")!.fire("input");
    byId(root, "studio-criteria-0")!.value = "Checkout works"; byId(root, "studio-criteria-0")!.fire("input");
    byId(root, "studio-wizard-form")!.fire("submit"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    return {...c, root};
  };
  const okPost = (p: string, b: any) => p === "/v1/projects" ? {status: 201, body: {project: {projectId: PID, name: "Shop"}}} : {status: 201, body: {mission: {missionId: MSN, title: b.title}}};
  it("shows no idea form before a project is created and prefills title + criteria after", async () => {
    const c = await mkCtx({get: projectsGet(), post: okPost, lang: "en"});
    expect(byId(mount(c.doc, await projectsView.render(c.ctx)), "studio-idea")).toBeNull();
    const {root} = await created(okPost);
    expect(byId(root, "studio-idea")!.dataset.ideaProject).toBe(PID);
    expect(byId(root, "studio-idea-title")!.value).toBe("Shop");
    expect(byId(root, "studio-idea-criteria-0")!.value).toBe("Checkout works");
  });
  it("rejects an empty objective without sending, then POSTs /v1/missions once for the new project and offers Open in Tasks", async () => {
    const {ctx, doc, calls, root} = await created(okPost);
    byId(root, "studio-idea-form")!.fire("submit"); await tick();
    expect(calls.post.filter(p => p.path === "/v1/missions")).toEqual([]);
    expect(forms.drafts.status["studio-idea"].ok).toBe(false);
    byId(root, "studio-idea-objective")!.value = "Online shop"; byId(root, "studio-idea-objective")!.fire("input");
    byId(root, "studio-idea-form")!.fire("submit"); await tick();
    const m = calls.post.filter(p => p.path === "/v1/missions");
    expect(m.length).toBe(1);
    expect(m[0].body).toMatchObject({projectId: PID, title: "Shop", objective: "Online shop", acceptanceCriteria: ["Checkout works"], riskLevel: "R1"});
    expect(forms.drafts.status["studio-idea"].ok).toBe(true);
    const root2 = mount(doc, await projectsView.render(ctx));
    expect(byId(root2, "studio-idea-submit")!.disabled).toBe(true); // ikinci gönderim yok
    await (async () => { byId(root2, "studio-idea-open")!.fire("click"); })();
    expect(calls.navigate).toEqual(["work"]);
    expect((await load(rend, "forms.js")).selection.missionId).toBe(MSN);
  });
  it("a new project's idea form never shows the previous project's 'First mission created' status", async () => {
    const PID2 = "prj_" + "9a".repeat(12);
    let n = 0;
    const post = (p: string, b: any) => p === "/v1/projects" ? (++n, {status: 201, body: {project: {projectId: n === 1 ? PID : PID2, name: b.name}}}) : {status: 201, body: {mission: {missionId: MSN, title: b.title}}};
    const {ctx, doc, root} = await created(post);
    byId(root, "studio-idea-objective")!.value = "Online shop"; byId(root, "studio-idea-objective")!.fire("input");
    byId(root, "studio-idea-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["studio-idea"].ok).toBe(true);
    let root2 = mount(doc, await projectsView.render(ctx));
    expect(text(byId(root2, "studio-idea-status")!)).toContain("First mission created");
    byId(root2, "studio-name")!.value = "Beta"; byId(root2, "studio-name")!.fire("input");
    byId(root2, "studio-wizard-form")!.fire("submit"); await tick();
    root2 = mount(doc, await projectsView.render(ctx));
    expect(byId(root2, "studio-idea")!.dataset.ideaProject).toBe(PID2);
    expect(forms.drafts.status["studio-idea"]).toBeUndefined();
    expect(byId(root2, "studio-idea-status")!.dataset.result).toBeUndefined();
    expect(text(byId(root2, "studio-idea-status")!)).toBe("");
    expect(byId(root2, "studio-idea-open")).toBeNull();
  });
  it("a server failure records an error, creates no mission link and keeps the draft", async () => {
    const {ctx, doc, calls, root} = await created((p, b) => p === "/v1/projects" ? okPost(p, b) : {status: 503, body: {error: "WORKOS_UNAVAILABLE"}});
    byId(root, "studio-idea-objective")!.value = "x"; byId(root, "studio-idea-objective")!.fire("input");
    byId(root, "studio-idea-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["studio-idea"].ok).toBe(false);
    const root2 = mount(doc, await projectsView.render(ctx));
    expect(byId(root2, "studio-idea-open")).toBeNull();
    expect(byId(root2, "studio-idea-objective")!.value).toBe("x");
    expect(calls.navigate).toEqual([]);
  });
  it("a 201 without a valid msn_ id succeeds without a fabricated open-mission shortcut", async () => {
    const {ctx, doc, root} = await created((p, b) => p === "/v1/projects" ? okPost(p, b) : {status: 201, body: {mission: {missionId: "bad", title: "T"}}});
    byId(root, "studio-idea-objective")!.value = "x"; byId(root, "studio-idea-objective")!.fire("input");
    byId(root, "studio-idea-form")!.fire("submit"); await tick();
    expect(byId(mount(doc, await projectsView.render(ctx)), "studio-idea-open")).toBeNull();
  });
  it("mission detail shows an honest no-tasks note when the mission has no tasks, never invented tasks", async () => {
    const work = await load(rend, "views", "work.js");
    const mission = {missionId: MSN, projectId: PID, title: "Shop", objective: "o", acceptanceCriteria: ["c"], status: "DRAFT", riskLevel: "R1", createdAt: "2026-10-21T00:00:00.000Z"};
    const get = (p: string) => p === "/v1/projects" ? {projects: [project()]} : p === "/v1/missions" ? {missions: [mission]} : p === `/v1/missions/${MSN}` ? {mission, tasks: []} : p.startsWith("/v1/work-runs") ? {runs: []} : p.startsWith("/v1/evidence") ? {items: []} : undefined;
    const {ctx, doc} = await mkCtx({get, lang: "en"});
    (await load(rend, "forms.js")).selection.missionId = MSN;
    const root = mount(doc, await work.render(ctx));
    expect(all(root).some(n => n.dataset?.noTasks === MSN)).toBe(true);
  });
});

// //TR: LANE-A UI-126 Proje Intake: Kurucu fikri -> POST /v1/intakes (proje + ilk mission tek adımda); sıkı gövde, kaynak etiketleri sunucudan aynen, başarı uydurulmaz.
describe("LANE-A project intake from an idea (fake DOM)", () => {
  const ITK = "itk_" + "ab12".repeat(6), MSN = "msn_" + "cd34".repeat(6);
  const IDEA = "Bir kitap kulübü uygulaması: üyeler kitap önerir ve oylar";
  const rec = (extra: any = {}) => ({intakeId: ITK, projectId: PID, missionId: MSN, title: "Kitap Kulübü", idea: IDEA, riskLevel: "R1", acceptanceCriteria: ["Uygulama açılır"], status: "CREATED",
    sources: {title: "FOUNDER", acceptanceCriteria: "DEFAULT", riskLevel: "DEFAULT"}, createdAt: "2026-10-21T10:00:00.000Z", ...extra });
  const open = async (o: CtxOpts) => { const c = await mkCtx({lang: "en", ...o, get: projectsGet()}); const m = await load(rend, "views", "intake.js"); m.resetIntakeAll(); return {...c, m, root: mount(c.doc, await projectsView.render(c.ctx))}; };
  const type = (root: N, id: string, v: string) => { byId(root, id)!.value = v; byId(root, id)!.fire("input"); };

  it("builds a strict body from the server schema: idea 10-4000, optional fields only when entered, risk R0-R3, unique OS/tech", async () => {
    const c = await load(rend, "intake-core.js");
    const ok = c.buildIntakeRequest({idea: `  ${IDEA} `, title: "", projectType: "", techStack: ["", " React "], targetOS: ["web"], acceptanceCriteria: ["", " a "], riskLevel: ""}, {key: "ui-abc"});
    expect(ok).toEqual({ok: true, path: "/v1/intakes", errors: {}, body: {idea: IDEA, techStack: ["React"], targetOS: ["web"], acceptanceCriteria: ["a"], idempotencyKey: "ui-abc"}});
    expect(Object.keys(c.buildIntakeRequest({idea: IDEA}).body)).toEqual(["idea"]);
    const bad = (i: any) => c.buildIntakeRequest({idea: IDEA, ...i}).errors;
    expect(c.buildIntakeRequest({idea: "kısa"}).errors.idea).toBe("intake.err.ideaShort");
    expect(c.buildIntakeRequest({idea: "x".repeat(4001)}).errors.idea).toBe("intake.err.ideaLong");
    expect(c.buildIntakeRequest({idea: "         "}).errors.idea).toBe("intake.err.ideaShort");
    expect(bad({title: "t".repeat(121)}).title).toBe("intake.err.titleLong");
    expect(bad({projectType: "robot"}).projectType).toBe("intake.err.type");
    expect(bad({techStack: ["a", "a"]}).techStack).toBe("intake.err.tech");
    expect(bad({techStack: ["a;b"]}).techStack).toBe("intake.err.tech");
    expect(bad({techStack: Array.from({length: 21}, (_, i) => "t" + i)}).techStack).toBe("intake.err.tech");
    expect(bad({targetOS: ["web", "web"]}).targetOS).toBe("intake.err.os");
    expect(bad({targetOS: ["beos"]}).targetOS).toBe("intake.err.os");
    expect(bad({acceptanceCriteria: Array.from({length: 51}, () => "k")}).acceptanceCriteria).toBe("intake.err.criteria");
    expect(bad({riskLevel: "R4"}).riskLevel).toBe("intake.err.risk"); // R4 intake ile açılmaz
    expect(c.buildIntakeRequest({idea: IDEA}, {key: "bad key!"}).errors.idempotencyKey).toBe("intake.err.key");
    expect(c.buildIntakeRequest({idea: "kısa"}).body).toBeNull();
    // Sınırlar sunucu şemasıyla birebir: idea 10..4000, title en çok 120.
    expect(c.buildIntakeRequest({idea: "x".repeat(9)}).errors.idea).toBe("intake.err.ideaShort");
    expect(c.buildIntakeRequest({idea: "x".repeat(10)}).ok).toBe(true);
    expect(c.buildIntakeRequest({idea: " ".repeat(5) + "x".repeat(9) + " ".repeat(5)}).errors.idea).toBe("intake.err.ideaShort"); // kırpıldıktan sonra 9
    expect(c.buildIntakeRequest({idea: "x".repeat(4000)}).ok).toBe(true);
    expect(c.buildIntakeRequest({idea: IDEA, title: "t".repeat(120)}).ok).toBe(true);
    expect(c.buildIntakeRequest({idea: IDEA, techStack: ["t".repeat(50)]}).ok).toBe(true);
    expect(c.buildIntakeRequest({idea: IDEA, techStack: ["t".repeat(51)]}).errors.techStack).toBe("intake.err.tech");
    expect(c.buildIntakeRequest({idea: IDEA, acceptanceCriteria: ["k".repeat(4000)]}).ok).toBe(true);
    expect(c.buildIntakeRequest({idea: IDEA, acceptanceCriteria: ["k".repeat(4001)]}).errors.acceptanceCriteria).toBe("intake.err.criteria");
  });
  it("maps intake records strictly and carries field sources verbatim; one malformed record makes the list ERROR", async () => {
    const c = await load(rend, "intake-core.js");
    expect(c.mapIntake(rec()).sources).toEqual({title: "FOUNDER", acceptanceCriteria: "DEFAULT", riskLevel: "DEFAULT"});
    for (const bad of [null, rec({intakeId: "itk_x"}), rec({projectId: "p"}), rec({missionId: "m"}), rec({riskLevel: "R9"}), rec({sources: {title: "FOUNDER"}}), rec({sources: {title: "ME", acceptanceCriteria: "DEFAULT", riskLevel: "DEFAULT"}}),
      rec({acceptanceCriteria: "x"}), rec({idea: ""}), rec({title: 5})]) expect(c.mapIntake(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull();
    expect(c.mapIntakes({intakes: [rec(), rec({intakeId: "itk_" + "ff".repeat(12), createdAt: "2026-10-21T11:00:00.000Z"})]}).items[0].intakeId).toBe("itk_" + "ff".repeat(12)); // yeni önce
    expect(c.mapIntakes({intakes: [rec(), null]}).state).toBe("ERROR");
    expect(c.mapIntakes({}).state).toBe("ERROR");
    expect(c.intakePath(ITK)).toBe(`/v1/intakes/${ITK}`); expect(c.intakePath("x")).toBeNull();
  });
  it("renders on the Projects screen, sends nothing until submit, then posts the typed idea once and shows server-marked sources with open buttons", async () => {
    const {ctx, doc, calls, root, m} = await open({post: (p, b) => p === "/v1/intakes" ? {status: 201, body: {intake: rec({title: b.title ?? "Kitap Kulübü"})}} : {status: 404, body: {}}});
    expect(byId(root, "intake")).not.toBeNull();
    expect(calls.post).toEqual([]);
    type(root, "intake-idea", IDEA); type(root, "intake-title", "Kitap Kulübü");
    byId(root, "intake-form")!.fire("submit"); await tick();
    expect(calls.post.length).toBe(1);
    expect(calls.post[0].path).toBe("/v1/intakes");
    expect(calls.post[0].body).toMatchObject({idea: IDEA, title: "Kitap Kulübü"});
    expect(Object.keys(calls.post[0].body).sort()).toEqual(["idea", "idempotencyKey", "template", "title"]); // web-node is the visible default of the template select
    expect(calls.post[0].body.template).toBe("web-node");
    expect(forms.drafts.status.intake.ok).toBe(true);
    const root2 = mount(doc, await projectsView.render(ctx));
    const res = byId(root2, "intake-result")!;
    expect(res.dataset.intakeId).toBe(ITK);
    expect(text(res)).toContain("You entered"); expect(text(res)).toContain("Default, not entered by you");
    expect(m.intakeDraft.idea).toBe("");
    byId(root2, "intake-open-mission")!.fire("click");
    expect(calls.navigate).toEqual(["work"]); expect(forms.selection.missionId).toBe(MSN);
    byId(root2, "intake-open-project")!.fire("click"); await tick();
    expect(calls.selected).toEqual([PID]);
  });
  it("validation errors send nothing; refusals and an invalid server record never show a result card; the draft is kept", async () => {
    const v = await open({});
    type(v.root, "intake-idea", "kısa");
    byId(v.root, "intake-form")!.fire("submit"); await tick();
    expect(v.calls.post).toEqual([]); expect(forms.drafts.status.intake.ok).toBe(false);
    const cases: Array<[any, string]> = [[{status: 409, body: {error: "INTAKE_IDEMPOTENCY_CONFLICT"}}, "post.err.409"], [{status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}, "post.err.423"], [{status: 403, body: {error: "FORBIDDEN"}}, "post.err.auth"],
      [{status: 404, body: {error: "NOT_FOUND"}}, "post.err.unavailable"], [{status: 503, body: {error: "INTAKE_STORE_CORRUPT"}}, "post.err.503"]];
    for (const [resp, key] of cases) {
      forms.resetAllForms();
      const o = await open({post: () => resp});
      type(o.root, "intake-idea", IDEA);
      byId(o.root, "intake-form")!.fire("submit"); await tick();
      expect(forms.drafts.status.intake, key).toMatchObject({ok: false, key});
      const r2 = mount(o.doc, await projectsView.render(o.ctx));
      expect(byId(r2, "intake-result")).toBeNull(); expect(byId(r2, "intake-idea")!.value).toBe(IDEA);
    }
    forms.resetAllForms();
    const odd = await open({post: () => ({status: 201, body: {intake: rec({missionId: "bad"})}})});
    type(odd.root, "intake-idea", IDEA);
    byId(odd.root, "intake-form")!.fire("submit"); await tick();
    expect(forms.drafts.status.intake.ok).toBe(true); // sunucu 201 dedi; kayıt bozuk -> kısayol/kaynak etiketi uydurulmaz
    expect(byId(mount(odd.doc, await projectsView.render(odd.ctx)), "intake-result")).toBeNull();
  });
  describe("LANE-A A-FLOW-2: intake template and run readiness", () => {
    const RD = `/v1/projects/${PID}/readiness`;
    const chk = (id: string, state = "OK", blocking = true, reason: string | null = null, nextAction: string | null = null) => ({id, state, blocking, reason, nextAction});
    const okChecks = () => [chk("MISSION"), chk("RISK"), chk("REPOSITORY"), chk("TEST_COMMAND", "OK", false), chk("PLAN", "OK", false)];
    const readiness = (extra: any = {}, checks: any[] = okChecks()) => ({readiness: {projectId: PID, missionId: MSN, ready: true, verifiable: true, checks, ...extra}});
    const blockedChecks = () => [chk("MISSION"), chk("RISK"), chk("REPOSITORY", "BLOCKED", true, "REPOSITORY_NOT_CONFIGURED", "CONFIGURE_REPOSITORY"), chk("TEST_COMMAND", "BLOCKED", false, "TEST_COMMAND_MISSING", "SET_TEST_COMMAND"), chk("PLAN", "BLOCKED", false, "NO_PLANNED_TASKS", "PLAN_MISSION")];
    const submitted = async (opts: {rd?: any; lang?: string; pick?: string}) => {
      const c = await mkCtx({lang: opts.lang ?? "en", get: projectsGet({"/v1/intakes": {intakes: []}, ...(opts.rd === undefined ? {} : {[RD]: opts.rd})}), post: (_p: string, b: any) => ({status: 201, body: {intake: rec({...(b.template === undefined ? {} : {template: b.template})})}})} as any);
      (await load(rend, "views", "intake.js")).resetIntakeAll();
      const o = {...c, root: mount(c.doc, await projectsView.render(c.ctx))};
      type(o.root, "intake-idea", IDEA);
      if (opts.pick !== undefined) { byId(o.root, "intake-template")!.value = opts.pick; byId(o.root, "intake-template")!.fire("change"); }
      byId(o.root, "intake-form")!.fire("submit"); await tick();
      return {...o, shown: mount(o.doc, await projectsView.render(o.ctx))};
    };
    it("sends template only when chosen and validates it against the server enum (trimmed, no repository field exists)", async () => {
      const c = await load(rend, "intake-core.js");
      expect(c.INTAKE_TEMPLATES).toEqual(["web-node", "node-lib", "empty"]);
      for (const t of ["web-node", "node-lib", "empty"]) expect(c.buildIntakeRequest({idea: IDEA, template: ` ${t} `}).body).toEqual({idea: IDEA, template: t});
      expect(c.buildIntakeRequest({idea: IDEA, template: ""}).body).toEqual({idea: IDEA});
      expect(c.buildIntakeRequest({idea: IDEA}).body).toEqual({idea: IDEA});
      for (const bad of ["Web-Node", "web", "x", "web-node,empty", "__proto__"]) expect(c.buildIntakeRequest({idea: IDEA, template: bad}), bad).toMatchObject({ok: false, body: null, errors: {template: "intake.err.template"}});
      expect(Object.keys(c.buildIntakeRequest({idea: IDEA, template: "empty", riskLevel: "R1"}, {key: "k1"}).body)).toEqual(["idea", "riskLevel", "template", "idempotencyKey"]);
    });
    it("carries the server-echoed template; a missing template is null and an unknown one makes the record invalid", async () => {
      const c = await load(rend, "intake-core.js");
      expect(c.mapIntake(rec()).template).toBeNull();
      for (const t of ["web-node", "node-lib", "empty"]) expect(c.mapIntake(rec({template: t})).template).toBe(t);
      for (const bad of ["cobol", "", null, 5, ["web-node"], "WEB-NODE"]) expect(c.mapIntake(rec({template: bad})), JSON.stringify(bad)).toBeNull();
      expect(c.mapIntakes({intakes: [rec({template: "x"})]}).state).toBe("ERROR");
    });
    it("shows a template select that defaults to web-node, offers every template plus an explicit none, and posts the chosen value", async () => {
      const f = await open({});
      const sel = byId(f.root, "intake-template")!;
      expect(sel).not.toBeNull(); expect(sel.value).toBe("web-node");
      expect(all(sel).filter(n => n.tagName === "OPTION").map(n => n.attrs.get("value"))).toEqual(["web-node", "node-lib", "empty", ""]);
      expect(text(sel)).toContain("Web app (Node)"); expect(text(sel)).toContain("No template");
      for (const [pick, want] of [["node-lib", "node-lib"], ["empty", "empty"], ["", undefined], [undefined, "web-node"]] as const) {
        forms.resetAllForms();
        const o = await submitted({pick: pick as any});
        expect(o.calls.post.length).toBe(1);
        expect(o.calls.post[0].body.template, String(pick)).toBe(want);
        if (want === undefined) expect(Object.hasOwn(o.calls.post[0].body, "template")).toBe(false);
      }
    });
    it("the result card names the template the server recorded, or says no repository was created", async () => {
      forms.resetAllForms();
      const a = await submitted({pick: "node-lib"});
      const card = byId(a.shown, "intake-result")!;
      expect(all(card).find(n => n.dataset.intakeTemplate === "node-lib")).toBeTruthy(); expect(text(card)).toContain("Library (Node)");
      forms.resetAllForms();
      const b = await submitted({pick: ""});
      const none = all(byId(b.shown, "intake-result")!).find(n => n.dataset.intakeTemplate === "NONE")!;
      expect(text(none)).toContain("no repository was created");
    });
    it("maps run readiness strictly: fixed order and vocabulary, and ready/verifiable must agree with the checks", async () => {
      const p = await load(rend, "project-core.js");
      expect(p.readinessPath(PID)).toBe(RD); expect(p.readinessPath("prj_zz")).toBeNull(); expect(p.readinessPath(`${PID}/x`)).toBeNull();
      const good = p.mapRunReadiness(readiness());
      expect(good.state).toBe("VERIFIED"); expect(good.readiness).toMatchObject({projectId: PID, missionId: MSN, ready: true, verifiable: true}); expect(good.readiness.checks.map((c: any) => c.id)).toEqual(["MISSION", "RISK", "REPOSITORY", "TEST_COMMAND", "PLAN"]);
      const bl = p.mapRunReadiness(readiness({ready: false, verifiable: false}, blockedChecks()));
      expect(bl.readiness).toMatchObject({ready: false, verifiable: false}); expect(bl.readiness.checks[2]).toEqual({id: "REPOSITORY", state: "BLOCKED", blocking: true, reason: "REPOSITORY_NOT_CONFIGURED", nextAction: "CONFIGURE_REPOSITORY"});
      const nonBlocking = okChecks(); nonBlocking[3] = chk("TEST_COMMAND", "BLOCKED", false, "TEST_COMMAND_MISSING", "SET_TEST_COMMAND");
      expect(p.mapRunReadiness(readiness({ready: true, verifiable: false}, nonBlocking)).readiness).toMatchObject({ready: true, verifiable: false});
      const sw = (i: number, j: number) => { const c = okChecks(); [c[i], c[j]] = [c[j], c[i]]; return c; };
      const one = (id: string, c: any) => okChecks().map(x => x.id === id ? c : x);
      const nb = {ready: false, verifiable: false};
      const bad: any[] = [null, {}, {readiness: null}, readiness({projectId: "prj_zz"}), readiness({missionId: "msn_zz"}), readiness({missionId: undefined}), readiness({ready: "true"}), readiness({verifiable: 1}),
        readiness({}, okChecks().slice(0, 4)), readiness({}, [...okChecks(), chk("PLAN")]), readiness({}, sw(0, 1)), readiness({}, one("RISK", chk("SECURITY"))),
        readiness(nb, okChecks()), // claims blocked, every check OK
        readiness({}, blockedChecks()), // claims ready/verifiable, a blocking check is BLOCKED
        readiness({ready: true, verifiable: true}, nonBlocking), // verifiable with a non-OK check
        readiness(nb, nonBlocking), // not ready although only a non-blocking check is not OK
        readiness({}, one("MISSION", chk("MISSION", "OK", true, "NO_OPEN_MISSION"))), // OK with a reason
        readiness(nb, one("MISSION", chk("MISSION", "BLOCKED", true, null))), // BLOCKED without a reason
        readiness({}, one("MISSION", chk("MISSION", "MAYBE"))), readiness({ready: true, verifiable: false}, one("PLAN", chk("PLAN", "MAYBE", false, "NO_PLANNED_TASKS"))), // unknown state even with a reason and a consistent ready flag
 readiness({}, one("MISSION", {...chk("MISSION"), blocking: "yes"})),
        readiness(nb, one("MISSION", chk("MISSION", "BLOCKED", true, "no open mission"))),
        readiness(nb, one("MISSION", chk("MISSION", "BLOCKED", true, ["NO_OPEN_MISSION"] as any))),
        readiness(nb, one("MISSION", chk("MISSION", "BLOCKED", true, "NO_OPEN_MISSION", "x y")))];
      for (const b of bad) expect(p.mapRunReadiness(b).state, JSON.stringify(b)?.slice(0, 90)).toBe("ERROR");
      expect(p.mapRunReadiness(readiness({missionId: null, ready: false, verifiable: false}, [chk("MISSION", "BLOCKED", true, "NO_OPEN_MISSION", "CREATE_MISSION"), chk("RISK", "UNKNOWN", true, "SOURCE_UNREADABLE"), chk("REPOSITORY"), chk("TEST_COMMAND", "OK", false), chk("PLAN", "UNKNOWN", false, "SOURCE_UNREADABLE")])).state).toBe("VERIFIED");
    });
    it("shows a blocked first run with the server's exact reasons and next steps, and never a ready state", async () => {
      forms.resetAllForms();
      const o = await submitted({rd: readiness({ready: false, verifiable: false}, blockedChecks())});
      expect(o.calls.get).toContain(RD);
      const blk = byId(o.shown, "intake-readiness")!;
      expect(blk.dataset.runReadiness).toBe("BLOCKED");
      const row = (id: string) => all(blk).find(n => n.dataset.readyCheck === id)!;
      expect(row("REPOSITORY").dataset).toMatchObject({readyState: "BLOCKED", readyBlocking: "true"});
      expect(text(row("REPOSITORY"))).toContain("The project has no code repository."); expect(text(row("REPOSITORY"))).toContain("Attach code (import) or create the project from a template.");
      expect(row("TEST_COMMAND").dataset.readyBlocking).toBe("false");
      expect(text(row("TEST_COMMAND"))).toContain("does not block the run"); expect(text(row("TEST_COMMAND"))).toContain("NOT_EXECUTED");
      expect(text(row("MISSION"))).not.toContain("does not block"); expect(row("MISSION").dataset.readyState).toBe("OK");
      expect(text(blk)).toContain("Blocked: the first run cannot start"); expect(text(blk)).not.toContain("A run can start");
    });
    it("distinguishes ready-but-unverifiable from fully verifiable, and says readiness is not product verification", async () => {
      forms.resetAllForms();
      const nb = okChecks(); nb[3] = chk("TEST_COMMAND", "BLOCKED", false, "TEST_COMMAND_MISSING", "SET_TEST_COMMAND");
      const a = await submitted({rd: readiness({ready: true, verifiable: false}, nb)});
      const ba = byId(a.shown, "intake-readiness")!;
      expect(ba.dataset.runReadiness).toBe("READY"); expect(text(ba)).toContain("A run can start. Some results cannot be fully verified yet");
      forms.resetAllForms();
      const b = await submitted({rd: readiness()});
      const bb = byId(b.shown, "intake-readiness")!;
      expect(text(bb)).toContain("every check passed. This is not a product verification."); expect(text(bb)).toContain("does not say the product works");
      expect(all(bb).filter(n => n.dataset.readyCheck).map(n => n.dataset.readyCheck)).toEqual(["MISSION", "RISK", "REPOSITORY", "TEST_COMMAND", "PLAN"]);
    });
    it("is honest when the read is unavailable, contradictory, for another project, or has an unrecognised code", async () => {
      forms.resetAllForms();
      const off = await submitted({});
      const bo = byId(off.shown, "intake-readiness")!;
      expect(bo.dataset.runReadiness).toBe("UNAVAILABLE"); expect(text(bo)).toContain("not available to the desktop yet"); expect(text(bo)).toContain("does not mean the project is ready");
      expect(all(bo).some(n => n.dataset.readyCheck)).toBe(false);
      forms.resetAllForms();
      const lie = await submitted({rd: readiness({}, blockedChecks())});
      expect(byId(lie.shown, "intake-readiness")!.dataset.runReadiness).toBe("ERROR"); expect(all(byId(lie.shown, "intake-readiness")!).some(n => n.dataset.readyCheck)).toBe(false);
      forms.resetAllForms();
      const other = await submitted({rd: readiness({projectId: "prj_" + "ee".repeat(12)})});
      expect(byId(other.shown, "intake-readiness")!.dataset.runReadiness).toBe("ERROR");
      forms.resetAllForms();
      const odd = okChecks(); odd[2] = chk("REPOSITORY", "BLOCKED", true, "BRAND_NEW_REASON", "BRAND_NEW_ACTION");
      const unk = await submitted({rd: readiness({ready: false, verifiable: false}, odd)});
      const r = all(byId(unk.shown, "intake-readiness")!).find(n => n.dataset.readyCheck === "REPOSITORY")!;
      expect(text(r)).toContain("BRAND_NEW_REASON (not recognised)"); expect(text(r)).toContain("BRAND_NEW_ACTION (not recognised)");
    });
    it("offers a button only for next steps that have a real destination, and it goes to the readiness mission, not a guessed one", async () => {
      forms.resetAllForms();
      const MSN2 = "msn_" + "dd".repeat(12);
      const odd = blockedChecks(); odd[3] = chk("TEST_COMMAND", "BLOCKED", false, "TEST_COMMAND_MISSING", "SET_TEST_COMMAND");
      const o = await submitted({rd: readiness({ready: false, verifiable: false, missionId: MSN2}, odd)});
      const goIds = all(byId(o.shown, "intake-readiness")!).filter(n => n.id?.startsWith("intake-ready-go-")).map(n => n.id);
      expect(goIds).toEqual(["intake-ready-go-CONFIGURE_REPOSITORY", "intake-ready-go-PLAN_MISSION"]); // SET_TEST_COMMAND has no screen yet: text only
      expect(text(byId(o.shown, "intake-ready-go-PLAN_MISSION")!)).toBe("Open the mission in Tasks to plan it");
      byId(o.shown, "intake-ready-go-PLAN_MISSION")!.fire("click");
      expect(o.calls.navigate).toEqual(["work"]); expect(forms.selection.missionId).toBe(MSN2);
      byId(o.shown, "intake-ready-go-CONFIGURE_REPOSITORY")!.fire("click"); await tick();
      expect(o.calls.selected).toEqual([PID]);
      (await load(rend, "studio-state.js")).resetStudio(); // the click opened the workspace; later tests start from the list
      // no target mission -> no plan button; an OK check never gets one even if the server repeats a next step
      forms.resetAllForms();
      const nm = okChecks(); nm[0] = chk("MISSION", "BLOCKED", true, "NO_OPEN_MISSION", "CREATE_MISSION"); nm[4] = chk("PLAN", "UNKNOWN", false, "SOURCE_UNREADABLE", "PLAN_MISSION"); nm[2] = chk("REPOSITORY", "OK", true, null, "CONFIGURE_REPOSITORY");
      const n = await submitted({rd: readiness({ready: false, verifiable: false, missionId: null}, nm)});
      expect(all(byId(n.shown, "intake-readiness")!).some(x => x.id?.startsWith("intake-ready-go-"))).toBe(false);
    });
    it("shows no readiness before an intake exists, and has a Turkish text for every code it can show", async () => {
      forms.resetAllForms();
      const f = await open({});
      expect(byId(f.root, "intake-readiness")).toBeNull(); expect(f.calls.get.some((g: string) => g.endsWith("/readiness"))).toBe(false);
      forms.resetAllForms();
      const t = await submitted({lang: "tr", rd: readiness({ready: false, verifiable: false}, blockedChecks())});
      expect(text(byId(t.shown, "intake-readiness")!)).toContain("Projede kod deposu yok.");
    });
  });
  it("lists earlier intakes from GET /v1/intakes and shows an honest UNAVAILABLE note when the read is not reachable", async () => {
    const c = await mkCtx({lang: "en", get: projectsGet({"/v1/intakes": {intakes: [rec()]}})});
    (await load(rend, "views", "intake.js")).resetIntakeAll();
    const root = mount(c.doc, await projectsView.render(c.ctx));
    expect(all(root).filter(n => n.dataset.intakeRow).map(n => n.dataset.intakeRow)).toEqual([ITK]);
    const off = await open({});
    expect(all(off.root).filter(n => n.dataset.intakeRow).length).toBe(0);
    expect(text(byId(off.root, "intake")!)).toContain("not available to the desktop yet");
    expect(byId(off.root, "intake-form")).not.toBeNull(); // oluşturma listeden bağımsız
  });
  it("labels every target-OS checkbox with a real name in en and tr, never a raw i18n key", async () => {
    const c = await load(rend, "intake-core.js");
    expect([...c.INTAKE_OS]).toEqual(["windows", "macos", "linux", "web", "android", "ios"]);
    for (const lang of ["en", "tr"]) {
      const o = await open({lang});
      const labels = c.INTAKE_OS.map((v: string) => text(all(o.root).find(n => n.attrs.get("for") === `intake-os-${v}`)!));
      expect(labels, lang).toEqual(["Windows", "macOS", "Linux", "Web", "Android", "iOS"]);
    }
  });
  it("refuses a body above the bridge/server 32 KB limit with a localized error before any POST; the limit is the bridge constant", async () => {
    const c = await load(rend, "intake-core.js"), work = await load(rend, "work-core.js");
    const bridgeLimit = Number(/const POST_MAX_BODY_BYTES=(\d+);/.exec(mainSrc)![1]);
    expect(work.MAX_BODY_BYTES).toBe(bridgeLimit); // renderer sabiti köprü sabitine sabitlenmiştir
    const huge = {idea: "x".repeat(4000), acceptanceCriteria: Array.from({length: 8}, () => "y".repeat(4000))};
    for (const key of [undefined, "ui-abc"]) {
      const r = c.buildIntakeRequest(huge, key === undefined ? {} : {key});
      expect(r.ok).toBe(false); expect(r.body).toBeNull(); expect(r.errors).toEqual({form: "err.tooLarge"});
    }
    // Sınır: anahtarlı gövde tam sınırda kabul, bir bayt fazlası ret; anahtarsız doğrulama geçişi en uzun anahtar payını ayırır.
    const KEY = "k".repeat(100), bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;
    const input = (n: number) => ({idea: "x".repeat(100), acceptanceCriteria: [...Array.from({length: 8}, () => "y".repeat(4000)), "z".repeat(n)]});
    const body = (n: number) => ({idea: "x".repeat(100), acceptanceCriteria: input(n).acceptanceCriteria, idempotencyKey: KEY});
    const n = bridgeLimit - bytes(body(0));
    expect(n).toBeGreaterThan(0); expect(n).toBeLessThanOrEqual(4000);
    expect(bytes(body(n))).toBe(bridgeLimit);
    expect(c.buildIntakeRequest(input(n), {key: KEY}).ok).toBe(true);
    expect(c.buildIntakeRequest(input(n)).ok).toBe(true);
    expect(c.buildIntakeRequest(input(n + 1), {key: KEY}).errors).toEqual({form: "err.tooLarge"});
    expect(c.buildIntakeRequest(input(n + 1)).errors).toEqual({form: "err.tooLarge"});
    // Arayüz: gönderim POST etmez, yerelleştirilmiş sınır hatası gösterilir.
    const o = await open({post: () => ({status: 201, body: {}})});
    o.m.intakeDraft.idea = huge.idea; o.m.intakeDraft.acceptanceCriteria = [...huge.acceptanceCriteria];
    byId(o.root, "intake-form")!.fire("submit"); await tick();
    expect(o.calls.post).toEqual([]);
    expect(forms.drafts.status.intake.errors).toEqual({form: "err.tooLarge"});
    const shown = mount(o.doc, await projectsView.render(o.ctx));
    expect(text(byId(shown, "intake-status")!)).toContain("The request body exceeds the 32 KB limit.");
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    expect((tr.default ?? tr)["err.tooLarge"]).toBeTruthy(); expect((en.default ?? en)["err.tooLarge"]).toBeTruthy();
  });
  it("intake strings exist in en and tr", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("intake.") || k === "form.field.idea");
    expect(keys.length).toBe(39);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

// //TR: LANE-A first-delivery: proje akış göstergesi (GET /v1/projects/:id/flow) — sıkı eşleme, dürüst UNAVAILABLE/ERROR, olumlu durum uydurulmaz.
describe("LANE-A first-delivery flow stepper (fake DOM)", () => {
  const stages = (states: string[]) => ["MISSION", "PLAN", "RUN", "REVIEW", "DELIVERY"].map((stage, i) => ({stage, state: states[i], detail: null}));
  const flowBody = (states: string[], extra: any = {}) => ({flow: {projectId: PID, stages: stages(states), missionCount: 1, taskCount: 3, latestRunId: null, ...extra}});
  const FLOW = `/v1/projects/${PID}/flow`;
  const flowOf = async (get: any) => { const c = await openWs({get: projectsGet(get)}); return {...c, panel: byId(c.root, "studio-ov-flow")}; };

  it("maps strictly: five stages in fixed order with known states; any deviation is ERROR", async () => {
    const core = await load(rend, "project-core.js");
    expect(core.flowPath(PID)).toBe(FLOW);
    expect(core.flowPath("prj_x")).toBeNull();
    const ok = core.mapFlow(flowBody(["DONE", "ACTIVE", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"]));
    expect(ok.state).toBe("VERIFIED"); expect(ok.flow.taskCount).toBe(3);
    const s5 = ["DONE", "DONE", "DONE", "DONE", "DONE"];
    for (const bad of [null, {}, {flow: {}}, flowBody(["DONE", "ACTIVE", "NOT_STARTED", "NOT_STARTED"]), flowBody(["DONE", "ACTIVE", "NOT_STARTED", "NOT_STARTED", "WEIRD"]),
      {flow: {...flowBody(s5).flow, projectId: "x"}}, {flow: {...flowBody(s5).flow, stages: [...stages(s5)].reverse()}}]) expect(core.mapFlow(bad).state).toBe("ERROR");
    expect(core.mapFlow(flowBody(s5, {taskCount: -1, latestRunId: "../x"})).flow).toMatchObject({taskCount: null, latestRunId: null});
  });
  it("renders the five steps with text state labels from the server read and says DONE is not verification", async () => {
    const {panel, calls} = await flowOf({[FLOW]: flowBody(["DONE", "DONE", "ACTIVE", "NOT_STARTED", "NOT_STARTED"], {latestRunId: "run_" + "a".repeat(24)})});
    expect(panel).not.toBeNull();
    const steps = all(panel!).filter(n => n.dataset.flowStage);
    expect(steps.map(n => [n.dataset.flowStage, n.dataset.flowState])).toEqual([["MISSION", "DONE"], ["PLAN", "DONE"], ["RUN", "ACTIVE"], ["REVIEW", "NOT_STARTED"], ["DELIVERY", "NOT_STARTED"]]);
    expect(text(steps[2])).toContain("Sürüyor");
    expect(text(panel!)).toContain("ürünün doğrulandığı"); // tr: DONE doğrulama değildir
    expect(calls.post).toEqual([]);
    expect(calls.get).toContain(FLOW);
  });
  it("shows an honest UNAVAILABLE note (no steps) when the read is not reachable, and ERROR for malformed data", async () => {
    const off = await flowOf({});
    expect(all(off.panel!).filter(n => n.dataset.flowStage).length).toBe(0);
    expect(text(off.panel!)).toContain("ilerleme gösterilmez");
    const bad = await flowOf({[FLOW]: {flow: {projectId: PID, stages: []}}});
    expect(all(bad.panel!).filter(n => n.dataset.flowStage).length).toBe(0);
    expect(text(bad.panel!)).not.toContain("Bitti");
  });
  it("flow taskRuns: absent field shows nothing, null says unknown, a valid summary is shown, an impossible one is treated as unknown", async () => {
    const core = await load(rend, "project-core.js");
    const base = flowBody(["DONE", "DONE", "ACTIVE", "NOT_STARTED", "NOT_STARTED"]);
    const withTr = (taskRuns: any) => ({flow: {...base.flow, ...(taskRuns === "ABSENT" ? {} : {taskRuns})}});
    expect(core.mapFlow(withTr("ABSENT")).flow.taskRuns).toBeUndefined();
    expect(core.mapFlow(withTr(null)).flow.taskRuns).toBeNull();
    expect(core.mapFlow(withTr({tasksWithRuns: 2, tasks: 5})).flow.taskRuns).toEqual({tasksWithRuns: 2, tasks: 5});
    for (const bad of [{tasksWithRuns: 6, tasks: 5}, {tasksWithRuns: -1, tasks: 5}, {tasksWithRuns: "2", tasks: 5}, {tasks: 5}, 3, "x"]) expect(core.mapFlow(withTr(bad)).flow.taskRuns, JSON.stringify(bad)).toBeNull();
    const shown = await openWs({get: projectsGet({[FLOW]: withTr({tasksWithRuns: 2, tasks: 5})}), lang: "en"});
    const row = all(byId(shown.root, "studio-ov-flow")!).find(n => n.dataset.flowTaskRuns)!;
    expect(row.dataset.flowTaskRuns).toBe("KNOWN"); expect(text(row)).toContain("2 of 5 planned tasks have a linked run");
    const unk = await openWs({get: projectsGet({[FLOW]: withTr(null)}), lang: "en"});
    const u = all(byId(unk.root, "studio-ov-flow")!).find(n => n.dataset.flowTaskRuns)!;
    expect(u.dataset.flowTaskRuns).toBe("UNKNOWN"); expect(text(u)).toContain("unknown");
    expect(text(u)).not.toMatch(/\b0 of\b/); // bilinmeyen 0 diye gösterilmez
    const none = await openWs({get: projectsGet({[FLOW]: withTr("ABSENT")}), lang: "en"});
    expect(all(byId(none.root, "studio-ov-flow")!).some(n => "flowTaskRuns" in n.dataset)).toBe(false);
  });
  it("describeFlowDetail maps known codes only with the matching stage state, parses PLAN/RUN shapes, and shows anything else verbatim", async () => {
    const core = await load(rend, "project-core.js");
    const d = core.describeFlowDetail;
    expect(d("PLAN", null, "NOT_STARTED")).toBeNull(); expect(d("PLAN", "", "ACTIVE")).toBeNull(); expect(d("RUN", undefined, "ACTIVE")).toBeNull();
    expect(d("PLAN", "2/5 DONE", "ACTIVE")).toEqual({kind: "key", key: "flow.detail.PLAN.progress", vars: {done: "2", total: "5"}});
    expect(d("PLAN", "5/5 DONE", "DONE").vars).toEqual({done: "5", total: "5"});
    expect(d("PLAN", "6/5 DONE", "ACTIVE")).toEqual({kind: "raw", text: "6/5 DONE"}); // sayısal olarak imkansız: çevrilmez
    expect(d("PLAN", "DONE", "ACTIVE")).toEqual({kind: "raw", text: "DONE"});
    expect(d("RUN", "RUNNING/IMPLEMENT", "ACTIVE")).toEqual({kind: "key", key: "flow.detail.RUN.status", vars: {status: "RUNNING", step: "IMPLEMENT"}});
    expect(d("RUN", "running/x", "ACTIVE")).toEqual({kind: "raw", text: "running/x"});
    const ok = (stage: string, code: string, state: string) => expect(d(stage, code, state), `${stage}.${code}@${state}`).toEqual({kind: "key", key: `flow.detail.${stage}.${code}`, vars: {}});
    ok("MISSION", "COMPLETE", "DONE"); ok("MISSION", "BLOCKED", "BLOCKED");
    ok("REVIEW", "CLEAN_REVIEW_GATE_PASSED", "DONE"); ok("REVIEW", "CLEAN_REVIEW_FOR_HEAD", "DONE"); ok("REVIEW", "RUN_NOT_SUCCEEDED", "UNKNOWN");
    for (const c of ["REVIEW", "REGRESSION", "REPORT"]) ok("REVIEW", c, "ACTIVE");
    ok("DELIVERY", "PRODUCT_VERIFIED", "DONE"); ok("DELIVERY", "NOT_VERIFIED", "DONE");
    ok("DELIVERY", "SOURCE_DELIVERY_ACCEPTED_NOT_VERIFIED", "ACTIVE"); ok("DELIVERY", "ARTIFACT_PREPARED_NOT_VERIFIED", "ACTIVE");
    // Sunucu ACTIVE mission aşamasına son mission'ın durumunu yazar: [EXECUTING, COMPLETE] -> ACTIVE + COMPLETE. "Tüm mission'lar tamamlandı" DENMEZ.
    expect(d("MISSION", "COMPLETE", "ACTIVE")).toEqual({kind: "status", status: "COMPLETE"});
    expect(d("MISSION", "BLOCKED", "ACTIVE")).toEqual({kind: "status", status: "BLOCKED"});
    expect(d("MISSION", "COMPLETE", "BLOCKED")).toEqual({kind: "status", status: "COMPLETE"});
    expect(d("MISSION", "EXECUTING", "ACTIVE")).toEqual({kind: "status", status: "EXECUTING"});
    expect(d("MISSION", "not a status", "ACTIVE")).toEqual({kind: "raw", text: "not a status"});
    // Diğer aşamalarda yanlış durumla gelen bilinen kod çevrilmez; ham ve "beklenmeyen" işaretli
    expect(d("REVIEW", "CLEAN_REVIEW_FOR_HEAD", "ACTIVE")).toEqual({kind: "raw", text: "CLEAN_REVIEW_FOR_HEAD", mismatch: true});
    expect(d("REVIEW", "CLEAN_REVIEW_GATE_PASSED", "UNKNOWN")).toEqual({kind: "raw", text: "CLEAN_REVIEW_GATE_PASSED", mismatch: true});
    expect(d("REVIEW", "REPORT", "DONE")).toEqual({kind: "raw", text: "REPORT", mismatch: true});
    expect(d("DELIVERY", "PRODUCT_VERIFIED", "ACTIVE")).toEqual({kind: "raw", text: "PRODUCT_VERIFIED", mismatch: true});
    expect(d("DELIVERY", "ARTIFACT_PREPARED_NOT_VERIFIED", "DONE")).toEqual({kind: "raw", text: "ARTIFACT_PREPARED_NOT_VERIFIED", mismatch: true});
    // Durum verilmezse (bilinmiyorsa) olumlu anlam verilmez
    expect(d("REVIEW", "CLEAN_REVIEW_FOR_HEAD")).toEqual({kind: "raw", text: "CLEAN_REVIEW_FOR_HEAD", mismatch: true});
    expect(d("MISSION", "COMPLETE")).toEqual({kind: "status", status: "COMPLETE"});
    // Kodlar yalnız kendi aşamasında geçerlidir
    expect(d("DELIVERY", "CLEAN_REVIEW_FOR_HEAD", "DONE")).toEqual({kind: "raw", text: "CLEAN_REVIEW_FOR_HEAD"});
    expect(d("REVIEW", "PRODUCT_VERIFIED", "DONE")).toEqual({kind: "raw", text: "PRODUCT_VERIFIED"});
    expect(d("RUN", "CLEAN_REVIEW_GATE_PASSED", "ACTIVE")).toEqual({kind: "raw", text: "CLEAN_REVIEW_GATE_PASSED"});
    expect(d("REVIEW", "__proto__", "DONE")).toEqual({kind: "raw", text: "__proto__"});
    expect(d("REVIEW", "constructor", "DONE")).toEqual({kind: "raw", text: "constructor"});
  });
  it("ACTIVE mission stage carrying COMPLETE (missions [EXECUTING, COMPLETE]) never says all missions are complete", async () => {
    const mk = (state: string, detail: string) => ({flow: {projectId: PID, stages: ["MISSION", "PLAN", "RUN", "REVIEW", "DELIVERY"].map((stage, i) => ({stage, state: i === 0 ? state : "NOT_STARTED", detail: i === 0 ? detail : null})), missionCount: 2, taskCount: 0, latestRunId: null}});
    const active = await openWs({get: projectsGet({[FLOW]: mk("ACTIVE", "COMPLETE")}), lang: "en"});
    const am = all(byId(active.root, "studio-ov-flow")!).find(n => n.dataset.flowStage === "MISSION")!;
    expect(text(am)).not.toContain("every mission"); expect(text(am)).not.toContain("recorded as complete");
    expect(all(am).some(n => n.dataset.flowDetail === "COMPLETE" && n.dataset.flowDetailKind === "status")).toBe(true);
    const done = await openWs({get: projectsGet({[FLOW]: mk("DONE", "COMPLETE")}), lang: "en"});
    expect(text(all(byId(done.root, "studio-ov-flow")!).find(n => n.dataset.flowStage === "MISSION")!)).toContain("every mission of this project is recorded as complete");
    // Başka aşamada yanlış durumla gelen bilinen kod: ham gösterilir ve "durumla uyuşmuyor" diye işaretlenir, olumlu anlam verilmez
    const bad = { flow: { projectId: PID, stages: ["MISSION", "PLAN", "RUN", "REVIEW", "DELIVERY"].map((stage, i) => ({ stage, state: i === 3 ? "ACTIVE" : "NOT_STARTED", detail: i === 3 ? "CLEAN_REVIEW_FOR_HEAD" : null })), missionCount: 1, taskCount: 0, latestRunId: null } };
    const mis = await openWs({get: projectsGet({[FLOW]: bad}), lang: "en"});
    const rv = text(all(byId(mis.root, "studio-ov-flow")!).find(n => n.dataset.flowStage === "REVIEW")!);
    expect(rv).toContain("CLEAN_REVIEW_FOR_HEAD (code does not match this stage's state)");
    expect(rv).not.toContain("clean independent review is recorded");
    const odd = await openWs({get: projectsGet({[FLOW]: mk("ACTIVE", "BLOCKED")}), lang: "en"});
    expect(text(all(byId(odd.root, "studio-ov-flow")!).find(n => n.dataset.flowStage === "MISSION")!)).not.toContain("at least one mission is blocked");
  });
  it("renders readable details with 'NOT verified' wording for delivery, never as done-and-verified, and raw unknown codes marked unrecognised", async () => {
    const mk = (details: Array<string | null>, states = ["DONE", "ACTIVE", "ACTIVE", "DONE", "ACTIVE"]) => ({flow: {projectId: PID, stages: ["MISSION", "PLAN", "RUN", "REVIEW", "DELIVERY"].map((stage, i) => ({stage, state: states[i], detail: details[i]})), missionCount: 1, taskCount: 5, latestRunId: null}});
    const body = mk(["EXECUTING", "2/5 DONE", "AWAITING_APPROVAL/REPORT", "CLEAN_REVIEW_FOR_HEAD", "ARTIFACT_PREPARED_NOT_VERIFIED"]);
    const c = await openWs({get: projectsGet({[FLOW]: body}), lang: "en"});
    const panel = byId(c.root, "studio-ov-flow")!;
    const det = (stage: string) => all(panel).find(n => n.dataset.flowStage === stage)!;
    const t = (stage: string) => text(det(stage));
    expect(t("PLAN")).toContain("2 of 5 planned tasks recorded as done");
    expect(t("REVIEW")).toContain("clean independent review is recorded for the run's current head; the run itself is not finished");
    expect(t("DELIVERY")).toContain("NOT verified");
    expect(t("DELIVERY")).toContain("not accepted");
    expect(all(det("DELIVERY")).some(n => n.dataset.flowDetail === "ARTIFACT_PREPARED_NOT_VERIFIED" && n.dataset.flowDetailKind === "key")).toBe(true);
    expect(det("DELIVERY").dataset.flowState).toBe("ACTIVE");
    expect(t("RUN")).toContain("step REPORT");
    // Kabul edilmiş NOT_VERIFIED teslim de "doğrulandı" demez
    const acc = await openWs({get: projectsGet({[FLOW]: mk([null, null, null, null, "SOURCE_DELIVERY_ACCEPTED_NOT_VERIFIED"])}), lang: "en"});
    const dt = text(all(byId(acc.root, "studio-ov-flow")!).find(n => n.dataset.flowStage === "DELIVERY")!);
    expect(dt).toContain("accepted by you"); expect(dt).toContain("NOT verified");
    // Bilinmeyen kod aynen ve işaretli
    const unk = await openWs({get: projectsGet({[FLOW]: mk([null, null, null, "SOMETHING_NEW", null])}), lang: "en"});
    const rv = all(byId(unk.root, "studio-ov-flow")!).find(n => n.dataset.flowStage === "REVIEW")!;
    expect(text(rv)).toContain("SOMETHING_NEW (unrecognised code)");
    expect(all(rv).some(n => n.dataset.flowDetailKind === "raw")).toBe(true);
    // Ayrıntısı olmayan aşamada hiçbir şey eklenmez
    const none = await openWs({get: projectsGet({[FLOW]: mk([null, null, null, null, null], ["NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"])}), lang: "en"});
    expect(all(byId(none.root, "studio-ov-flow")!).some(n => "flowDetail" in n.dataset)).toBe(false);
  });
  it("flow strings exist in en and tr", async () => {
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("flow."));
    expect(keys.length).toBe(35);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

// //TR: test+states: studio-workspace (functional/negative/a11y) — çalışma alanı sekmelerinde okuma hataları/boş/bozuk yanıtların dürüst durum gösterdiğini (uydurma satır, koşu, commit, teslim yok), başarısız dev-run/dışa aktarma POST'unun başarı bildirmediğini, native köprü yokken önizleme/klasörde göster eyleminin dürüst hata verdiğini ve erişilebilirlik sözleşmesini (h1 tabindex, tablist/tab/tabpanel, tipli düğmeler, tablo başlıkları, dil eşitliği) doğrular.
describe("test+states studio-workspace: negative (honest tab states)", () => {
  const openTab = async (tab: string, get: Record<string, any> = {}, extra: Partial<CtxOpts> = {}) => {
    const c = await mkCtx({get: projectsGet(get), ...extra});
    st.openProject(PID, tab);
    const root = mount(c.doc, await projectsView.render(c.ctx));
    return {...c, root};
  };
  it("files tab: list 404 shows UNAVAILABLE with no entries; an empty list says so; a file read failure shows no fabricated content", async () => {
    // //TR: Dosya listesi okunamazsa girdi uydurulmaz.
    const a = await openTab("files");
    expect(all(a.root).filter(n => n.id.startsWith("fe-")).length).toBe(0);
    expect(text(byId(a.root, "studio-files-tree")!)).toContain("Kullanılamıyor");
    expect(text(byId(a.root, "studio-files-viewer")!).length).toBeGreaterThan(0);
    const b = await openTab("files", {[`/v1/projects/${PID}/files`]: {entries: []}});
    expect(all(b.root).filter(n => n.id.startsWith("fe-")).length).toBe(0);
    expect(byId(b.root, "studio-file-view")).toBeNull();
    st.openProject(PID, "files"); st.studio.file = "src/a.js";
    const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/files`]: {entries: [{name: "a.js", dir: false}]}})});
    const rc = mount(c.doc, await projectsView.render(c.ctx));
    expect(byId(rc, "studio-file-view")).toBeNull(); // dosya okunamadı: görüntüleyici içeriği yok
  });
  it("changes tab: git log 404 and an empty log render honest notes with no commit table, no diff picker and no diff request", async () => {
    const a = await openTab("changes");
    expect(all(a.root).filter(n => n.tagName === "TABLE").length).toBe(0);
    expect(byId(a.root, "studio-diff-show")).toBeNull();
    expect(text(byId(a.root, "studio-git-log")!)).toContain("Kullanılamıyor");
    const b = await openTab("changes", {[`/v1/projects/${PID}/git/log?limit=30`]: {commits: []}});
    expect(all(b.root).filter(n => n.tagName === "TABLE").length).toBe(0);
    expect(b.calls.get.some(p => p.includes("git/diff"))).toBe(false);
    const c = await openTab("changes", {[`/v1/projects/${PID}/git/log?limit=30`]: {nonsense: true}});
    expect(all(c.root).filter(n => n.tagName === "TABLE").length).toBe(0);
  });
  it("missions tab: a failed read shows UNAVAILABLE with no rows; an empty list says so; the open-work button stays usable", async () => {
    const a = await openTab("missions");
    expect(all(a.root).filter(n => n.id.startsWith("sm-")).length).toBe(0);
    expect(text(byId(a.root, "studio-missions")!)).toContain("Kullanılamıyor");
    expect(byId(a.root, "studio-missions-open")).not.toBeNull();
    const b = await openTab("missions", {[`/v1/missions?projectId=${PID}`]: {missions: []}});
    expect(all(b.root).filter(n => n.tagName === "TABLE").length).toBe(0);
    const c = await openTab("missions", {[`/v1/missions?projectId=${PID}`]: {missions: "x"}});
    expect(all(c.root).filter(n => n.id.startsWith("sm-")).length).toBe(0);
  });
  it("delivery tab: exports 404 shows UNAVAILABLE, no list rows, but the export form stays; malformed exports are not listed", async () => {
    const a = await openTab("delivery");
    expect(byId(a.root, "studio-export-submit")).not.toBeNull();
    expect(all(a.root).filter(n => n.id.startsWith("ex-show-")).length).toBe(0);
    expect(text(byId(a.root, "studio-exports")!)).toContain("Kullanılamıyor");
    const b = await openTab("delivery", {[`/v1/projects/${PID}/exports`]: {exports: "nope"}});
    expect(all(b.root).filter(n => n.id.startsWith("ex-show-")).length).toBe(0);
  });
  it("overview: when missions fail the run/review/security cards show the same honest state and no run id is invented", async () => {
    const a = await openTab("overview", {"/v1/work-runs": {workRuns: [{runId: "run_zzzzzz", missionId: MID, status: "RUNNING", startedAt: "2026-10-15T00:00:00Z"}]}});
    expect(text(byId(a.root, "studio-ov-run")!)).not.toContain("run_zzzzzz");
    for (const id of ["studio-ov-missions", "studio-ov-run", "studio-ov-review", "studio-ov-security"]) expect(text(byId(a.root, id)!), id).toContain("Kullanılamıyor");
  });
  it("run tab: a failed start POST reports a non-success status, does not claim RUNNING and re-enables the controls", async () => {
    const getFn = (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody({status: "STOPPED", pid: null, preview: {url: null, state: "UNAVAILABLE"}}) : projectsGet()(p);
    const c = await mkCtx({get: getFn, post: () => ({status: 500, body: {error: "X"}}), confirm: () => true});
    st.openProject(PID, "run");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-run-start")!.fire("click"); await tick(); await tick();
    expect(c.calls.post.length).toBe(1);
    expect(forms.drafts.status["studio-devrun"].ok).toBe(false);
    expect(forms.drafts.busy["studio-devrun"]).toBe(false);
    expect(byId(root, "studio-run-state")!.dataset.status).toBe("STOPPED");
    expect(byId(root, "studio-run-start")!.disabled).toBe(false);
    expect(byId(root, "studio-run-stop")!.disabled).toBe(true);
    expect(byId(root, "studio-devrun-status")!.getAttribute("role")).toBe("alert");
  });
  it("run tab: without a native bridge the preview button is a no-op that reports noNative; it never opens anything", async () => {
    const c = await mkCtx({get: (p: string) => p === `/v1/projects/${PID}/devrun` ? runBody() : projectsGet()(p)});
    st.openProject(PID, "run");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    const ws = await load(rend, "views", "studio-workspace.js");
    expect(byId(root, "studio-run-preview")!.disabled).toBe(false); // sunucu AVAILABLE bildirdi
    byId(root, "studio-run-preview")!.fire("click"); await tick();
    expect(forms.drafts.status["studio-devrun"].key).toBe("studio.run.preview.noNative");
    expect(forms.drafts.status["studio-devrun"].ok).toBe(false);
    ws.stopRunPolling();
  });
  it("delivery tab: a failed export POST reports a non-success status and an export without a native bridge reports noExport", async () => {
    const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/exports`]: {exports: [{exportId: EXP, createdAt: "2026-10-15T00:00:00Z", commit: HASH, sizeBytes: 1, status: "COMPLETE"}]}}), post: () => ({status: 503, body: {error: "X"}})});
    st.openProject(PID, "delivery");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-export-form")!.fire("submit"); await tick();
    expect(forms.drafts.status["studio-export"].ok).toBe(false);
    expect(forms.drafts.busy["studio-export"]).toBe(false);
    byId(root, `ex-show-${EXP}`)!.fire("click"); await tick();
    expect(forms.drafts.status["studio-export"].key).toBe("studio.export.noNative");
    expect(forms.drafts.status["studio-export"].ok).toBe(false);
  });
});

describe("test+states studio-workspace: accessibility", () => {
  it("every tab renders one h1 with tabindex -1 carrying the project name, a labelled tablist, tabs controlling the panel, and only typed buttons", async () => {
    // //TR: Her sekmede h1 odak hedefidir ve tüm düğmeler tiplidir.
    const ws = await load(rend, "views", "studio-workspace.js");
    for (const tab of ["overview", "run", "files", "changes", "missions", "delivery"]) {
      const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/devrun`]: runBody()})});
      st.openProject(PID, tab);
      const root = mount(c.doc, await projectsView.render(c.ctx));
      const h1s = all(root).filter(n => n.tagName === "H1");
      expect(h1s.length, tab).toBe(1);
      expect(h1s[0].getAttribute("tabindex"), tab).toBe("-1");
      expect(text(h1s[0]), tab).toBe("Mağaza");
      const list = all(root).find(n => n.getAttribute("role") === "tablist")!;
      expect(list.getAttribute("aria-label")!.length, tab).toBeGreaterThan(0);
      const tabs = all(list).filter(n => n.getAttribute("role") === "tab");
      expect(tabs.length).toBe(6);
      for (const t of tabs) { expect(t.tagName).toBe("BUTTON"); expect(t.getAttribute("type")).toBe("button"); expect(t.getAttribute("aria-controls")).toBe("studio-panel"); expect(t.getAttribute("aria-selected")).toBe(t.dataset.tab === tab ? "true" : "false"); expect(t.getAttribute("tabindex")).toBe(t.dataset.tab === tab ? "0" : "-1"); }
      for (const b of all(root).filter(n => n.tagName === "BUTTON")) expect(["button", "submit"], `${tab}:${b.id || text(b)}`).toContain(b.getAttribute("type"));
      ws.stopRunPolling();
    }
  });
  it("Home/End and wrap-around keys select tabs and focus follows; unrelated keys do nothing", async () => {
    const c = await mkCtx({get: projectsGet()});
    st.openProject(PID, "files");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-tab-files")!.fire("keydown", {key: "Home"});
    expect(st.studio.tab).toBe("overview");
    expect(c.doc.focused?.id).toBe("studio-tab-overview");
    byId(root, "studio-tab-overview")!.fire("keydown", {key: "End"});
    expect(st.studio.tab).toBe("delivery");
    byId(root, "studio-tab-delivery")!.fire("keydown", {key: "a"});
    expect(st.studio.tab).toBe("delivery");
  });
  it("commit and export tables carry captions and column-scoped headers; the log and diff viewers are focusable and labelled", async () => {
    const g = projectsGet({[`/v1/projects/${PID}/git/log?limit=30`]: {commits: [{hash: HASH, subject: "s", author: "A", date: "2026-10-15T00:00:00Z"}]}, [`/v1/projects/${PID}/exports`]: {exports: [{exportId: EXP, createdAt: "2026-10-15T00:00:00Z", commit: HASH, sizeBytes: 1, status: "COMPLETE"}]}, [`/v1/projects/${PID}/devrun`]: runBody()});
    for (const tab of ["changes", "delivery"]) {
      const c = await mkCtx({get: g}); st.openProject(PID, tab);
      const root = mount(c.doc, await projectsView.render(c.ctx));
      const tables = all(root).filter(n => n.tagName === "TABLE");
      expect(tables.length, tab).toBeGreaterThan(0);
      for (const t of tables) {
        expect(all(t).some(n => n.tagName === "CAPTION" && text(n).length > 0), tab).toBe(true);
        const ths = all(t).filter(n => n.tagName === "TH");
        expect(ths.length).toBeGreaterThan(1);
        for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
      }
    }
    const c = await mkCtx({get: g}); st.openProject(PID, "run");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    const log = byId(root, "studio-log")!;
    expect(log.getAttribute("tabindex")).toBe("0");
    expect(log.getAttribute("aria-label")!.length).toBeGreaterThan(0);
    expect(byId(root, "studio-run-state")!.getAttribute("role")).toBe("status");
    expect(byId(root, "studio-run-state")!.getAttribute("aria-live")).toBe("polite");
    (await load(rend, "views", "studio-workspace.js")).stopRunPolling();
  });
});

describe("test+states studio-workspace: EN/TR parity", () => {
  it("every literal and derived key used by studio-workspace.js exists in both locales with equal placeholders; English tab labels differ from Turkish", async () => {
    // //TR: Çalışma alanının kullandığı tüm anahtarlar iki dilde vardır.
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>, en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const pc = await load(rend, "project-core.js");
    const src = fs.readFileSync(path.join(rend, "views", "studio-workspace.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|hintKey:|errorKey:|text:ctx\.t\()\s*"([a-zA-Z0-9_.-]+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/"((?:studio|work|everif|devrun|confirm)\.[A-Za-z0-9_.-]+)"/g)) keys.add(m[1]);
    for (const k of pc.STUDIO_TABS) keys.add(`studio.tab.${k}`);
    for (const s of pc.DEVRUN_STATES) keys.add(`devrun.state.${s}`);
    for (const s of pc.PREVIEW_STATES) keys.add(`devrun.preview.${s}`);
    for (const a of ["start", "stop", "restart"]) { keys.add(`studio.run.${a}`); keys.add(`studio.run.done.${a}`); }
    for (const r of ["DEVRUN_UNAVAILABLE", "PREVIEW_UNAVAILABLE", "OPEN_FAILED"]) keys.add(`studio.run.preview.reason.${r}`);
    for (const r of ["EXPORT_UNAVAILABLE", "EXPORT_PATH_REJECTED"]) keys.add(`studio.export.reason.${r}`);
    const real = [...keys].filter(k => !/[${}]/.test(k));
    expect(real.length).toBeGreaterThan(60);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of real) { expect(k in tr && k in en, k).toBe(true); expect(ph(en[k]), k).toBe(ph(tr[k])); expect(en[k].trim().length, k).toBeGreaterThan(0); }
    for (const k of pc.STUDIO_TABS) expect(en[`studio.tab.${k}`]).not.toBe(tr[`studio.tab.${k}`]);
  });
});

// //TR: LANE-A Proje bilgisi paneli (GET /v1/projects/:id/knowledge): sıkı eşleme, TAMPERED/TORN_TAIL/kanıt durumları, okunamayan kaynakta sayı uydurulmaz.
describe("LANE-A project knowledge panel", () => {
  const MID = "msn_" + "cd34".repeat(6), HEXID = "ef56".repeat(6);
  const mem = (over: Record<string, any> = {}) => ({state: "OK", health: {state: "OK", reason: null, records: 3, lastSeq: 3, lastHash: "h", tornTailBytes: 0}, total: 3, byKind: {DECISION: 1, FACT: 1, SOURCE: 0, REVISION: 1, NOTE: 0},
    currentHeads: [{id: "mem_000003", kind: "REVISION", title: "Use SQLite", at: "2026-10-22T03:00:00Z", tags: ["db"]}, {id: "mem_000002", kind: "FACT", title: "Windows first", at: "2026-10-21T03:00:00Z", tags: []}], ...over});
  const evd = (over: Record<string, any> = {}) => ({state: "AVAILABLE", sampled: true, truncated: false, missionsQueried: 2, total: 3, byKind: {WORK_RUN_STEP: 2, WORK_RUN_LOG: 1, REVIEW_EVIDENCE: 0, AUDIT_CHECKPOINT: 0}, byVerification: {VERIFIED: 2, MISMATCH: 1, MISSING: 0, UNVERIFIABLE: 0},
    latest: [{evidenceId: "evd_" + HEXID, kind: "WORK_RUN_STEP", verification: "VERIFIED", createdAt: "2026-10-22T03:00:00Z", missionId: MID, runId: "run_" + HEXID}], ...over});
  const body = (m: any = mem(), e: any = evd(), pid = PID) => ({knowledge: {projectId: pid, memory: m, evidence: e}});
  const withHealth = (state: string, extra: Record<string, any> = {}) => ({state, health: {state, reason: state === "OK" ? null : "x", records: 3, lastSeq: 3, lastHash: "h", tornTailBytes: 0, ...extra}});
  const open = async (res: any, lang = "en") => {
    const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/knowledge`]: res}), lang} as any);
    st.openProject(PID, "overview");
    return {...c, root: mount(c.doc, await projectsView.render(c.ctx))};
  };
  const stats = (root: N, prefix: string) => all(root).filter(n => (n.dataset.stat ?? "").startsWith(prefix)).map(n => [n.dataset.stat, n.dataset.value]);

  it("maps the real shape strictly; the project id must match the request", async () => {
    const c = await load(rend, "knowledge-core.js");
    expect(c.knowledgePath(PID)).toBe(`/v1/projects/${PID}/knowledge`); expect(c.knowledgePath("prj_x")).toBeNull(); expect(c.knowledgePath([PID] as any)).toBeNull();
    const r = c.mapKnowledge(body(), PID);
    expect(r.state).toBe("VERIFIED");
    expect(r.knowledge.memory).toMatchObject({state: "OK", total: 3, byKind: {DECISION: 1, FACT: 1, SOURCE: 0, REVISION: 1, NOTE: 0}});
    expect(r.knowledge.memory.currentHeads.map((x: any) => x.id)).toEqual(["mem_000003", "mem_000002"]);
    expect(r.knowledge.evidence).toMatchObject({state: "AVAILABLE", sampled: true, total: 3});
    expect(c.mapKnowledge(body(mem(), evd(), "prj_" + "11".repeat(12)), PID).state).toBe("ERROR");
    expect(c.mapKnowledge(body(), "prj_x").state).toBe("ERROR");
  });
  it("any malformed field, a counter that contradicts its total, or a null rule broken for the state makes the whole read ERROR", async () => {
    const c = await load(rend, "knowledge-core.js");
    const bads: any[] = [null, [], {}, {knowledge: null}, {knowledge: {projectId: PID}}, body(null), body(mem(), null), body(mem(), {state: "AVAILABLE"}),
      body(mem({state: "NOPE", health: {state: "NOPE", reason: null, records: 0, lastSeq: 0, lastHash: "h", tornTailBytes: 0}})),
      body(mem({health: {state: "ABSENT", reason: null, records: 3, lastSeq: 3, lastHash: "h", tornTailBytes: 0}})),
      body(mem({health: {state: "OK", reason: "text", records: -1, lastSeq: 3, lastHash: "h", tornTailBytes: 0}})), body(mem({health: {state: "OK", reason: 5, records: 3, lastSeq: 3, lastHash: "h", tornTailBytes: 0}})),
      body(mem({health: {state: "OK", reason: null, records: 3, lastSeq: "3", lastHash: "h", tornTailBytes: 0}})), body(mem({health: {state: "OK", reason: null, records: 3, lastSeq: 3, lastHash: "h", tornTailBytes: 1.5}})),
      body(mem({total: 4})), body(mem({total: "3"})), body(mem({total: null})), body(mem({byKind: {DECISION: 1, FACT: 1, SOURCE: 0, REVISION: 1}})), body(mem({byKind: {DECISION: 1, FACT: 1, SOURCE: 0, REVISION: 1, NOTE: 0, EXTRA: 0}})),
      body(mem({byKind: {DECISION: 1, FACT: 1, SOURCE: 0, REVISION: 1, NOTE: "0"}})), body(mem({byKind: null})), body(mem({currentHeads: null})), body(mem({currentHeads: "x"})),
      body(mem({currentHeads: Array.from({length: 21}, (_, i) => ({id: `mem_${String(i + 1).padStart(6, "0")}`, kind: "NOTE", title: "t", at: "2026-10-22T03:00:00Z", tags: []})), total: 21, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 21}})),
      body(mem({currentHeads: [{id: "mem_1", kind: "FACT", title: "t", at: "2026-10-22T03:00:00Z", tags: []}]})), body(mem({currentHeads: [{id: "mem_000001", kind: "OTHER", title: "t", at: "2026-10-22T03:00:00Z", tags: []}]})),
      body(mem({currentHeads: [{id: "mem_000001", kind: "FACT", title: "", at: "2026-10-22T03:00:00Z", tags: []}]})), body(mem({currentHeads: [{id: "mem_000001", kind: "FACT", title: "t", at: "2026-02-30T03:00:00Z", tags: []}]})),
      body(mem({currentHeads: [{id: "mem_000001", kind: "FACT", title: "t", at: "2026-10-22T03:00:00Z", tags: "db"}]})), body(mem({currentHeads: [{id: "mem_000001", kind: "FACT", title: "t", at: "2026-10-22T03:00:00Z", tags: [5]}]})),
      body(mem({currentHeads: Array.from({length: 4}, (_, i) => ({id: `mem_00000${i + 1}`, kind: "NOTE", title: "t", at: "2026-10-22T03:00:00Z", tags: []}))})),
      body(mem({...withHealth("TAMPERED"), total: 3, byKind: null, currentHeads: null})), body(mem({...withHealth("TAMPERED"), total: null, byKind: mem().byKind, currentHeads: null})), body(mem({...withHealth("TAMPERED"), total: null, byKind: null, currentHeads: []})),
      body(mem(), {state: "UNAVAILABLE", reason: "OTHER"}), body(mem(), {state: "ERROR", reason: "EVIDENCE_NOT_WIRED"}), body(mem(), {state: "WHATEVER", reason: "EVIDENCE_NOT_WIRED"}),
      body(mem(), evd({sampled: false})), body(mem(), evd({truncated: "no"})), body(mem(), evd({missionsQueried: 11})), body(mem(), evd({missionsQueried: -1})), body(mem(), evd({total: 4})), body(mem(), evd({byKind: {WORK_RUN_STEP: 2, WORK_RUN_LOG: 1, REVIEW_EVIDENCE: 0}})),
      body(mem(), evd({byVerification: {VERIFIED: 2, MISMATCH: 0, MISSING: 0, UNVERIFIABLE: 0}})), body(mem(), evd({latest: "x"})), body(mem(), evd({latest: Array.from({length: 11}, () => evd().latest[0]), total: 11, byKind: {WORK_RUN_STEP: 11, WORK_RUN_LOG: 0, REVIEW_EVIDENCE: 0, AUDIT_CHECKPOINT: 0}, byVerification: {VERIFIED: 11, MISMATCH: 0, MISSING: 0, UNVERIFIABLE: 0}})),
      body(mem(), evd({total: 0, byKind: {WORK_RUN_STEP: 0, WORK_RUN_LOG: 0, REVIEW_EVIDENCE: 0, AUDIT_CHECKPOINT: 0}, byVerification: {VERIFIED: 0, MISMATCH: 0, MISSING: 0, UNVERIFIABLE: 0}})),
      body(mem(), evd({latest: [{...evd().latest[0], evidenceId: "evd_1"}]})), body(mem(), evd({latest: [{...evd().latest[0], kind: "X"}]})), body(mem(), evd({latest: [{...evd().latest[0], verification: "X"}]})), body(mem(), evd({latest: [{...evd().latest[0], createdAt: "yesterday"}]})),
      body(mem(), evd({latest: [{...evd().latest[0], missionId: 5}]})), body(mem(), evd({latest: [{...evd().latest[0], runId: ""}]}))];
    bads.forEach((b, i) => { const r = c.mapKnowledge(b, PID); expect([i, r.state, r.knowledge]).toEqual([i, "ERROR", null]); });
  });
  it("valid edge shapes are accepted: TAMPERED with nulls, ABSENT empty memory, 20 heads, null dates and ids in the sample, the two evidence-unavailable forms", async () => {
    const c = await load(rend, "knowledge-core.js");
    const ok = (b: any) => c.mapKnowledge(b, PID);
    expect(ok(body({...withHealth("TAMPERED"), total: null, byKind: null, currentHeads: null})).knowledge.memory).toMatchObject({state: "TAMPERED", total: null, byKind: null, currentHeads: null});
    expect(ok(body({...withHealth("ABSENT", {records: 0, lastSeq: 0}), total: 0, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 0}, currentHeads: []})).state).toBe("VERIFIED");
    const heads = Array.from({length: 20}, (_, i) => ({id: `mem_${String(i + 1).padStart(6, "0")}`, kind: "NOTE", title: "t".repeat(300), at: "2026-10-22T03:00:00.123Z", tags: Array.from({length: 20}, () => "g".repeat(64))}));
    expect(ok(body(mem({currentHeads: heads, total: 20, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 20}}))).state).toBe("VERIFIED");
    expect(ok(body(mem({currentHeads: [{...heads[0], title: "t".repeat(301)}], total: 1, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 1}}))).state).toBe("ERROR");
    expect(ok(body(mem({currentHeads: [{...heads[0], tags: Array.from({length: 21}, () => "g")}], total: 1, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 1}}))).state).toBe("ERROR");
    expect(ok(body(mem({currentHeads: [{...heads[0], tags: ["g".repeat(65)]}], total: 1, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 1}}))).state).toBe("ERROR");
    expect(ok(body(mem(), evd({latest: [{...evd().latest[0], createdAt: null, missionId: null, runId: null}]}))).knowledge.evidence.latest[0]).toMatchObject({createdAt: null, missionId: null, runId: null});
    expect(ok(body(mem(), evd({missionsQueried: 10}))).state).toBe("VERIFIED"); expect(ok(body(mem(), evd({missionsQueried: 0}))).state).toBe("VERIFIED");
    const ten = Array.from({length: 10}, () => evd().latest[0]);
    expect(ok(body(mem(), evd({latest: ten, total: 10, byKind: {WORK_RUN_STEP: 10, WORK_RUN_LOG: 0, REVIEW_EVIDENCE: 0, AUDIT_CHECKPOINT: 0}, byVerification: {VERIFIED: 10, MISMATCH: 0, MISSING: 0, UNVERIFIABLE: 0}}))).state).toBe("VERIFIED");
    const big = c.MAX_COUNT ?? 1000000;
    expect(ok(body(mem({total: big, byKind: {DECISION: big, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 0}, currentHeads: []}))).state).toBe("VERIFIED");
    expect(ok(body(mem({total: big + 1, byKind: {DECISION: big + 1, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 0}, currentHeads: []}))).state).toBe("ERROR");
    // ids must be real strings (a one-element array is not coerced into an id) and the kind sum must match the total on its own
    expect(ok(body(mem({currentHeads: [{id: ["mem_000001"], kind: "FACT", title: "t", at: "2026-10-22T03:00:00Z", tags: []}]}))).state).toBe("ERROR");
    expect(ok(body(mem(), evd({latest: [{...evd().latest[0], evidenceId: ["evd_" + HEXID]}]}))).state).toBe("ERROR");
    expect(ok(body(mem(), evd({byKind: {WORK_RUN_STEP: 1, WORK_RUN_LOG: 1, REVIEW_EVIDENCE: 0, AUDIT_CHECKPOINT: 0}}))).state).toBe("ERROR");
    expect(ok(body(mem(), evd({byVerification: {VERIFIED: 1, MISMATCH: 1, MISSING: 0, UNVERIFIABLE: 0}}))).state).toBe("ERROR");
    expect(ok(body(mem(), {state: "UNAVAILABLE", reason: "EVIDENCE_NOT_WIRED"})).knowledge.evidence).toEqual({state: "UNAVAILABLE", reason: "EVIDENCE_NOT_WIRED"});
    expect(ok(body(mem(), {state: "ERROR", reason: "EVIDENCE_QUERY_FAILED"})).knowledge.evidence).toEqual({state: "ERROR", reason: "EVIDENCE_QUERY_FAILED"});
  });
  it("renders memory counts per kind (separate), current entries, and the evidence sample with its 'sample' wording", async () => {
    const o = await open(body());
    const p = byId(o.root, "studio-ov-knowledge")!;
    expect(stats(p, "memory-")).toEqual([["memory-total", "3"], ["memory-DECISION", "1"], ["memory-FACT", "1"], ["memory-SOURCE", "0"], ["memory-REVISION", "1"], ["memory-NOTE", "0"]]);
    expect(all(p).filter(n => "memoryId" in n.dataset).map(n => n.dataset.memoryId)).toEqual(["mem_000003", "mem_000002"]);
    expect(stats(p, "evidence-")).toEqual([["evidence-total", "3"], ["evidence-VERIFIED", "2"], ["evidence-MISMATCH", "1"], ["evidence-MISSING", "0"], ["evidence-UNVERIFIABLE", "0"]]);
    const s = all(p).find(n => "knowledgeSampled" in n.dataset)!; expect(s.dataset.truncated).toBe("0"); expect(text(s)).toContain("A sample, not the full index");
    expect(all(p).filter(n => "evidenceId" in n.dataset)).toHaveLength(1);
    expect(o.calls.get).toContain(`/v1/projects/${PID}/knowledge`); expect(o.calls.post).toEqual([]);
    const t = await open(body(mem(), evd({truncated: true})));
    expect(text(all(byId(t.root, "studio-ov-knowledge")!).find(n => "knowledgeSampled" in n.dataset)!)).toContain("More evidence exists");
  });
  it("a TAMPERED memory shows NO counts and NO entries; a torn tail says the verified part is shown", async () => {
    const t = await open(body({...withHealth("TAMPERED"), total: null, byKind: null, currentHeads: null}));
    const p = byId(t.root, "studio-ov-knowledge")!;
    expect(stats(p, "memory-")).toEqual([]); expect(all(p).filter(n => "memoryId" in n.dataset)).toEqual([]);
    expect(text(p)).toContain("failed verification"); expect(stats(p, "evidence-").length).toBe(5);
    const torn = await open(body(mem({...withHealth("TORN_TAIL", {tornTailBytes: 17})})));
    const tp = byId(torn.root, "studio-ov-knowledge")!; expect(text(tp)).toContain("17 bytes ignored"); expect(stats(tp, "memory-").length).toBe(6);
    const empty = await open(body({...withHealth("ABSENT", {records: 0, lastSeq: 0}), total: 0, byKind: {DECISION: 0, FACT: 0, SOURCE: 0, REVISION: 0, NOTE: 0}, currentHeads: []}));
    expect(text(byId(empty.root, "studio-ov-knowledge")!)).toContain("No memory entries");
  });
  it("evidence not wired or failing shows the reason and NO evidence figures (never an invented zero)", async () => {
    for (const [e, word] of [[{state: "UNAVAILABLE", reason: "EVIDENCE_NOT_WIRED"}, "not connected"], [{state: "ERROR", reason: "EVIDENCE_QUERY_FAILED"}, "could not be queried"]] as const) {
      const o = await open(body(mem(), e)); const p = byId(o.root, "studio-ov-knowledge")!;
      expect(stats(p, "evidence-")).toEqual([]); expect(text(p)).toContain(word); expect(stats(p, "memory-").length).toBe(6);
    }
  });
  it("an unreadable endpoint (404, refused by the main process, offline, malformed or another project's answer) shows a state note and no figures", async () => {
    const miss = await open(undefined);
    for (const node of [miss.root, (await open({knowledge: {projectId: "prj_" + "11".repeat(12), memory: mem(), evidence: evd()}})).root, (await open({nonsense: true})).root]) {
      const p = byId(node, "studio-ov-knowledge")!; expect(p).not.toBeNull();
      expect(stats(p, "memory-")).toEqual([]); expect(stats(p, "evidence-")).toEqual([]); expect(all(p).filter(n => "memoryId" in n.dataset)).toEqual([]);
      expect(text(p)).toContain(`GET /v1/projects/${PID}/knowledge`);
    }
    const refused = await mkCtx({get: (p: string) => { if (p.endsWith("/knowledge")) throw new Error("INVALID_API_PATH"); return projectsGet()(p); }, lang: "en"} as any);
    st.openProject(PID, "overview");
    const rp = byId(mount(refused.doc, await projectsView.render(refused.ctx)), "studio-ov-knowledge")!;
    expect(stats(rp, "memory-")).toEqual([]); expect(text(rp)).toMatch(/unavailable/i);
  });
  const SHA = "ab".repeat(32);
  const stepOf = (n: number, over: Record<string, any> = {}) => ({id: `mem_${String(n).padStart(6, "0")}`, seq: n, at: `2026-10-2${n}T03:00:00Z`, kind: "REVISION", author: {role: "FOUNDER"}, sources: [{ref: "doc/a.md", sha256: SHA, retrievedAt: "2026-10-21T03:00:00Z"}], hash: SHA, ...over});
  const prov = (lineage: any[], over: Record<string, any> = {}) => ({provenance: {id: lineage[lineage.length - 1]?.id ?? "mem_000003", currentHeadId: "mem_000003", lineage, ...over}});
  it("maps the history strictly: oldest first, the last step is the requested entry, sequence strictly increasing", async () => {
    const c = await load(rend, "knowledge-core.js");
    expect(c.provenancePath(PID, "mem_000003")).toBe(`/v1/projects/${PID}/memory/mem_000003/provenance`);
    for (const [p, m] of [["prj_x", "mem_000003"], [PID, "mem_1"], [PID, ["mem_000003"]], [[PID], "mem_000003"], [PID, "mem_000003/x"]] as any[]) expect(c.provenancePath(p, m), String(m)).toBeNull();
    const good = prov([stepOf(1), stepOf(2), stepOf(3)]);
    const r = c.mapProvenance(good, "mem_000003");
    expect(r.state).toBe("VERIFIED"); expect(r.provenance.lineage.map((x: any) => x.seq)).toEqual([1, 2, 3]); expect(r.provenance.lineage[0]).toMatchObject({authorRole: "FOUNDER", sources: [{ref: "doc/a.md", sha256: SHA}]});
    expect(c.mapProvenance(prov([stepOf(3)]), "mem_000003").state).toBe("VERIFIED");
    expect(c.mapProvenance(prov([stepOf(3, {seq: c.MAX_COUNT})]), "mem_000003").state).toBe("VERIFIED");
    expect(c.mapProvenance(prov([stepOf(3, {seq: c.MAX_COUNT + 1})]), "mem_000003").state).toBe("ERROR");
    expect(c.mapProvenance(prov([stepOf(3, {sources: Array.from({length: 32}, () => ({ref: "x", retrievedAt: "2026-10-21T03:00:00Z"}))})]), "mem_000003").state).toBe("VERIFIED");
    expect(c.mapProvenance(prov([stepOf(3, {sources: [{ref: "x", retrievedAt: "2026-10-21T03:00:00Z"}]})]), "mem_000003").provenance.lineage[0].sources[0].sha256).toBeNull();
    expect(c.mapProvenance(prov([stepOf(1, {id: ["mem_000001"]}), stepOf(3)]), "mem_000003").state).toBe("ERROR");
    expect(c.mapProvenance(prov([stepOf(1), stepOf(2)], {id: "mem_000003"}), "mem_000003").state).toBe("ERROR");
    expect(c.mapProvenance(prov([stepOf(3, {sources: [{ref: "x", sha256: [SHA], retrievedAt: "2026-10-21T03:00:00Z"}]})]), "mem_000003").state).toBe("ERROR");
    expect(c.mapProvenance(prov([stepOf(1, {sources: [{ref: "x", retrievedAt: "2026-10-21T03:00:00Z"}]}), stepOf(3, {author: {role: "A", sessionId: "s"}})]), "mem_000003").state).toBe("VERIFIED");
    expect(c.mapProvenance(prov(Array.from({length: c.MAX_LINEAGE}, (_, i) => stepOf(i + 1, {id: `mem_${String(i + 1).padStart(6, "0")}`, at: "2026-10-21T03:00:00Z"}))), `mem_${String(c.MAX_LINEAGE).padStart(6, "0")}`).state).toBe("VERIFIED");
    const bads: any[] = [null, [], {}, {provenance: null}, prov([]), prov([stepOf(2), stepOf(1)]), prov([stepOf(3), stepOf(3)]), prov([stepOf(1), stepOf(2)]), prov([stepOf(1), stepOf(3)], {id: "mem_000002"}), prov([stepOf(3)], {currentHeadId: "x"}), prov([stepOf(3)], {currentHeadId: ["mem_000003"]}),
      prov([stepOf(3, {id: ["mem_000003"]})], {id: "mem_000003"}), prov([stepOf(3, {seq: 0})]), prov([stepOf(3, {seq: 1.5})]), prov([stepOf(3, {at: "2026-02-30T03:00:00Z"})]), prov([stepOf(3, {kind: "X"})]), prov([stepOf(3, {hash: "short"})]), prov([stepOf(3, {hash: SHA.toUpperCase()})]),
      prov([stepOf(3, {author: null})]), prov([stepOf(3, {author: {role: ""}})]), prov([stepOf(3, {author: {role: "A", sessionId: ""}})]), prov([stepOf(3, {sources: "x"})]), prov([stepOf(3, {sources: Array.from({length: 33}, () => ({ref: "x", retrievedAt: "2026-10-21T03:00:00Z"}))})]),
      prov([stepOf(3, {sources: [{ref: "", retrievedAt: "2026-10-21T03:00:00Z"}]})]), prov([stepOf(3, {sources: [{ref: "x", retrievedAt: "bad"}]})]), prov([stepOf(3, {sources: [{ref: "x", sha256: "nope", retrievedAt: "2026-10-21T03:00:00Z"}]})]), prov([stepOf(3, {sources: [null]})]),
      prov(Array.from({length: c.MAX_LINEAGE + 1}, (_, i) => stepOf(i + 1, {id: `mem_${String(i + 1).padStart(6, "0")}`, at: "2026-10-21T03:00:00Z"})), {id: `mem_${String(c.MAX_LINEAGE + 1).padStart(6, "0")}`})];
    bads.forEach((b, i) => { const r = c.mapProvenance(b, "mem_000003"); expect([i, r.state, r.provenance]).toEqual([i, "ERROR", null]); });
    expect(c.mapProvenance(good, "mem_000002").state).toBe("ERROR"); expect(c.mapProvenance(good, "x").state).toBe("ERROR");
  });
  it("opening an entry's history reads its provenance and lists the steps oldest first; closing it, a vanished entry or another project drops the selection", async () => {
    const panel = await load(rend, "views", "knowledge-panel.js");
    panel.resetKnowledgeSel();
    const route = `/v1/projects/${PID}/memory/mem_000003/provenance`;
    const mk = async (get: Record<string, any>) => { const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/knowledge`]: body(), ...get}), lang: "en"} as any); st.openProject(PID, "overview"); return c; };
    const closed = await mk({[route]: prov([stepOf(1), stepOf(3)])});
    let root = mount(closed.doc, await projectsView.render(closed.ctx));
    expect(closed.calls.get).not.toContain(route); expect(all(root).filter(n => "memoryHistoryBtn" in n.dataset).map(n => n.dataset.memoryHistoryBtn)).toEqual(["mem_000003", "mem_000002"]);
    panel.knowledgeSel.projectId = PID; panel.knowledgeSel.memId = "mem_000003";
    const o = await mk({[route]: prov([stepOf(1), stepOf(3)])});
    root = mount(o.doc, await projectsView.render(o.ctx));
    expect(o.calls.get).toContain(route);
    const hist = all(root).find(n => "memoryHistory" in n.dataset)!;
    expect(hist.dataset.memoryHistory).toBe("mem_000003");
    expect(all(hist).filter(n => "lineageId" in n.dataset).map(n => [n.dataset.lineageId, n.dataset.lineageSeq])).toEqual([["mem_000001", "1"], ["mem_000003", "3"]]);
    expect(text(hist)).toContain("current version"); expect(text(hist)).toContain("by FOUNDER"); expect(text(hist)).toContain("1 source(s)");
    const btn = (id: string) => all(root).find(n => n.dataset.memoryHistoryBtn === id)!;
    expect(btn("mem_000003").attrs.get("aria-expanded")).toBe("true"); expect(btn("mem_000002").attrs.get("aria-expanded")).toBe("false");
    expect(text(btn("mem_000003"))).toBe("Hide history"); expect(text(btn("mem_000002"))).toBe("Show history");
    // an unreadable history shows a state note and no steps
    const bad = await mk({[route]: {provenance: {id: "mem_000003"}}});
    const br = mount(bad.doc, await projectsView.render(bad.ctx));
    expect(all(br).filter(n => "lineageId" in n.dataset)).toEqual([]); expect(all(br).filter(n => n.dataset.memoryHistory === "unreadable")).toHaveLength(1);
    // a selection that is no longer a current entry is dropped without a request
    panel.knowledgeSel.projectId = PID; panel.knowledgeSel.memId = "mem_000099";
    const gone = await mk({});
    mount(gone.doc, await projectsView.render(gone.ctx));
    expect(gone.calls.get.some((p: string) => p.includes("mem_000099"))).toBe(false); expect(panel.knowledgeSel.memId).toBeNull();
    // the toggle button opens and closes the selection, and an entry that is no longer the head says which entry replaced it
    panel.resetKnowledgeSel();
    const t = await mk({[route]: prov([stepOf(1), stepOf(3)], {currentHeadId: "mem_000009"})});
    const tr0 = mount(t.doc, await projectsView.render(t.ctx));
    const tb = all(tr0).find(n => n.dataset.memoryHistoryBtn === "mem_000003")!;
    tb.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(panel.knowledgeSel.memId).toBe("mem_000003"); expect(panel.knowledgeSel.projectId).toBe(PID);
    const t2 = await mk({[route]: prov([stepOf(1), stepOf(3)], {currentHeadId: "mem_000009"})});
    const tr1 = mount(t2.doc, await projectsView.render(t2.ctx));
    expect(text(all(tr1).find(n => "memoryHistory" in n.dataset)!)).toContain("mem_000009");
    all(tr1).find(n => n.dataset.memoryHistoryBtn === "mem_000003")!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(panel.knowledgeSel.memId).toBeNull();
    // a selection made in another project is dropped
    panel.knowledgeSel.projectId = "prj_" + "11".repeat(12); panel.knowledgeSel.memId = "mem_000003";
    const other = await mk({});
    mount(other.doc, await projectsView.render(other.ctx));
    expect(other.calls.get).not.toContain(route); expect(panel.knowledgeSel.memId).toBeNull();
    panel.resetKnowledgeSel();
  });
  const rec = (n: number, over: Record<string, any> = {}) => ({seq: n, id: `mem_${String(n).padStart(6, "0")}`, at: `2026-10-21T03:00:${String(n % 60).padStart(2, "0")}Z`, kind: "DECISION", projectId: PID, title: `Entry ${n}`, body: `Body of entry ${n}`, sources: [], tags: ["db"], author: {role: "FOUNDER"}, prevHash: "0".repeat(64), hash: SHA, ...over});
  const lst = (records: any[], over: Record<string, any> = {}) => ({records, health: {state: "OK", reason: null, records: Math.max(records.length, 3), lastSeq: 3, lastHash: SHA, tornTailBytes: 0}, ...over});
  it("builds the search path with fixed key order, canonical percent-encoding and nothing for empty values", async () => {
    const c = await load(rend, "knowledge-core.js");
    const b = (o: any, pid = PID) => c.buildMemorySearch(pid, o);
    expect(b({})).toEqual({ok: true, path: `/v1/projects/${PID}/memory`, errors: {}});
    expect(b({kind: "FACT", tag: " db ", q: "  use it  "}).path).toBe(`/v1/projects/${PID}/memory?kind=FACT&tag=db&q=use%20it`);
    expect(b({q: "a&b=c/d?e #é'()*!"}).path).toBe(`/v1/projects/${PID}/memory?q=a%26b%3Dc%2Fd%3Fe%20%23%C3%A9%27%28%29%2A%21`);
    expect(b({tag: "a b&c=d"}).path).toBe(`/v1/projects/${PID}/memory?tag=a%20b%26c%3Dd`);
    expect(b({tag: "x"}).path).toBe(`/v1/projects/${PID}/memory?tag=x`); expect(b({kind: "NOTE"}).path).toBe(`/v1/projects/${PID}/memory?kind=NOTE`); expect(b({kind: "", tag: "  ", q: " "}).path).toBe(`/v1/projects/${PID}/memory`);
    expect(b({tag: "t".repeat(64)}).ok).toBe(true); expect(b({tag: "t".repeat(65)}).errors).toEqual({memTag: "knowledge.search.err.tag"});
    expect(b({q: "q".repeat(200)}).ok).toBe(true); expect(b({q: "q".repeat(201)}).errors).toEqual({memQ: "knowledge.search.err.q"});
    expect(b({q: " " + "q".repeat(200) + " "}).ok).toBe(true);
    expect(b({kind: "OTHER"}).errors).toEqual({memKind: "knowledge.search.err.kind"}); expect(b({kind: "fact"}).ok).toBe(false); expect(b({kind: ["FACT"]}).ok).toBe(false);
    const cc = (n: number) => String.fromCharCode(n);
    expect(b({q: "a" + cc(10) + "b"}).ok).toBe(false); expect(b({q: "a" + cc(0) + "b"}).ok).toBe(false); expect(b({tag: "a" + cc(127)}).ok).toBe(false); expect(b({q: "a" + cc(31)}).ok).toBe(false); expect(b({q: "a" + cc(32) + "b"}).ok).toBe(true); expect(b({tag: ["x"]}).ok).toBe(false); expect(b({q: 5}).ok).toBe(false);
    expect(b({}, "prj_x")).toEqual({ok: false, path: null, errors: {project: "knowledge.search.err.project"}}); expect(b({}, [PID] as any).ok).toBe(false);
    expect(Object.keys(b({kind: "x", tag: "t".repeat(65), q: "q".repeat(201)}).errors).sort()).toEqual(["memKind", "memQ", "memTag"]);
  });
  it("maps the list strictly: newest first, strictly increasing seq, project id must match, filters not re-applied, counts bounded by the chain", async () => {
    const c = await load(rend, "knowledge-core.js");
    const ok = c.mapMemoryList(lst([rec(1), rec(2), rec(3, {supersedes: "mem_000001", sources: [{ref: "doc", retrievedAt: "2026-10-21T03:00:00Z"}]})]), PID);
    expect(ok.state).toBe("VERIFIED"); expect(ok.list.records.map((r: any) => r.id)).toEqual(["mem_000003", "mem_000002", "mem_000001"]); expect(ok.list.total).toBe(3);
    expect(ok.list.records[0]).toMatchObject({supersedes: "mem_000001", authorRole: "FOUNDER", title: "Entry 3"}); expect(ok.list.records[1].supersedes).toBeNull();
    expect(c.mapMemoryList(lst([]), PID)).toMatchObject({state: "VERIFIED", list: {records: [], total: 0}});
    expect(c.mapMemoryList(lst([rec(1, {body: "b".repeat(32768)})]), PID).state).toBe("VERIFIED");
    expect(c.mapMemoryList(lst([rec(1, {title: "t".repeat(200)})]), PID).state).toBe("VERIFIED");
    expect(c.mapMemoryList(lst(Array.from({length: c.MAX_LIST}, (_, i) => rec(i + 1, {id: `mem_${String(i + 1).padStart(6, "0")}`})), {health: {state: "OK", reason: null, records: c.MAX_LIST, lastSeq: 1, lastHash: SHA, tornTailBytes: 0}}), PID).state).toBe("VERIFIED");
    const big = Array.from({length: c.MAX_LIST + 1}, (_, i) => rec(i + 1, {id: `mem_${String(i + 1).padStart(6, "0")}`}));
    expect(c.mapMemoryList(lst([rec(1, {tags: Array.from({length: 32}, (_, i) => `t${i}`)})]), PID).state).toBe("VERIFIED");
    expect(c.mapMemoryList(lst([rec(1), rec(2, {seq: 1})]), PID).state).toBe("ERROR");
    expect(c.mapMemoryList(lst([rec(1, {prevHash: "g".repeat(64)})]), PID).state).toBe("ERROR");
    expect(c.mapMemoryList(lst([rec(1, {prevHash: ["0".repeat(64)]})]), PID).state).toBe("ERROR");
    const bads: any[] = [null, [], {}, {records: []}, {health: lst([]).health}, lst("x" as any), lst([], {health: null}), lst([], {health: {state: "NOPE", records: 0, tornTailBytes: 0}}), lst([], {health: {state: "OK", records: -1, tornTailBytes: 0}}), lst([], {health: {state: "OK", records: 0, tornTailBytes: 1.5}}),
      lst([rec(1), rec(1)]), lst([rec(2), rec(1)]), lst([rec(1), rec(2, {id: "mem_000001"})]), lst([rec(1, {projectId: "prj_" + "11".repeat(12)})]), lst([rec(1, {title: ""})]), lst([rec(1, {title: "t".repeat(201)})]), lst([rec(1, {body: ""})]), lst([rec(1, {body: "b".repeat(32769)})]), lst([rec(1, {body: 5})]),
      lst([rec(1, {prevHash: "x"})]), lst([rec(1, {prevHash: undefined})]), lst([rec(1, {supersedes: "x"})]), lst([rec(1, {supersedes: "mem_000001"})]), lst([rec(1, {supersedes: ["mem_000002"]})]), lst([rec(1, {tags: "db"})]), lst([rec(1, {tags: Array.from({length: 33}, () => "t")})]), lst([rec(1, {tags: [""]})]), lst([rec(1, {tags: ["t".repeat(65)]})]),
      lst([rec(1, {author: null})]), lst([rec(1, {sources: "x"})]), lst([rec(1, {hash: "short"})]), lst([null]), lst(big, {health: {state: "OK", records: big.length, lastSeq: 1, lastHash: SHA, tornTailBytes: 0}}),
      lst([rec(1), rec(2), rec(3), rec(4)], {health: {state: "OK", reason: null, records: 3, lastSeq: 3, lastHash: SHA, tornTailBytes: 0}})];
    bads.forEach((b, i) => { const r = c.mapMemoryList(b, PID); expect([i, r.state, r.list]).toEqual([i, "ERROR", null]); });
    expect(c.mapMemoryList(lst([rec(1)]), "prj_x").state).toBe("ERROR");
  });
  it("the search form validates, sends one GET with the canonical query, and lists matches newest first with a cut body", async () => {
    const panel = await load(rend, "views", "knowledge-panel.js");
    panel.resetKnowledgeSel(); panel.resetMemSearch();
    const longBody = "L".repeat(450);
    const results = lst([rec(1), rec(2, {body: longBody, tags: ["db", "x"], supersedes: "mem_000001", sources: [{ref: "doc", retrievedAt: "2026-10-21T03:00:00Z"}]})]);
    const q = `/v1/projects/${PID}/memory?kind=DECISION&tag=db&q=use%20it`;
    const mk = async () => { const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/knowledge`]: body(), [q]: results}), lang: "en"} as any); st.openProject(PID, "overview"); return c; };
    const c0 = await mk(); let root = mount(c0.doc, await projectsView.render(c0.ctx));
    expect(byId(root, "knowledge-search")).not.toBeNull(); expect(c0.calls.get.some((p: string) => p.includes("/memory"))).toBe(false);
    // invalid input: nothing is requested and the errors are listed
    panel.memSearch.kind = "BAD"; panel.memSearch.q = "x".repeat(201);
    const r0 = await panel.submitMemSearch(c0.ctx, PID);
    expect(r0).toEqual({ok: false, validation: true}); expect(panel.memSearch.path).toBeNull(); expect(c0.calls.get.some((p: string) => p.includes("/memory"))).toBe(false);
    root = mount(c0.doc, await projectsView.render(c0.ctx));
    expect(byId(root, "knowledge-search-status")!.dataset.result).toBe("invalid");
    // valid input: the one canonical GET, results newest first
    panel.memSearch.kind = "DECISION"; panel.memSearch.tag = "db"; panel.memSearch.q = "use it";
    const c1 = await mk();
    expect(await panel.submitMemSearch(c1.ctx, PID)).toEqual({ok: true, path: q});
    root = mount(c1.doc, await projectsView.render(c1.ctx));
    expect(c1.calls.get.filter((p: string) => p.includes("/memory"))).toEqual([q]); expect(c1.calls.post).toEqual([]);
    const res = all(root).find(n => "memorySearchResult" in n.dataset)!;
    expect(res.dataset.memorySearchResult).toBe("list"); expect(res.dataset.total).toBe("2");
    expect(all(res).filter(n => "searchMemoryId" in n.dataset).map(n => n.dataset.searchMemoryId)).toEqual(["mem_000002", "mem_000001"]);
    expect(text(res)).toContain("Showing 2 of 2 matching entries"); expect(text(res)).toContain("L".repeat(400) + "…"); expect(text(res)).not.toContain("L".repeat(401)); expect(text(res)).toContain("cut after 400 characters");
    expect(text(res)).toContain("replaces mem_000001"); expect(text(res)).toContain("1 source(s)"); expect(text(res)).toContain("by FOUNDER");
    // clear resets the form
    all(root).find(n => n.id === "knowledge-search-clear")!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect([panel.memSearch.kind, panel.memSearch.tag, panel.memSearch.q, panel.memSearch.path]).toEqual(["", "", "", null]);
  });
  it("a search made in another project is dropped when this project's overview is shown", async () => {
    const panel = await load(rend, "views", "knowledge-panel.js");
    panel.resetKnowledgeSel(); panel.resetMemSearch();
    panel.memSearch.projectId = "prj_" + "11".repeat(12); panel.memSearch.path = `/v1/projects/${PID}/memory`; panel.memSearch.q = "left over";
    const c = await mkCtx({get: projectsGet({[`/v1/projects/${PID}/knowledge`]: body()}), lang: "en"} as any); st.openProject(PID, "overview");
    const root = mount(c.doc, await projectsView.render(c.ctx));
    expect(c.calls.get.some((p: string) => p.includes("/memory"))).toBe(false); expect(panel.memSearch.path).toBeNull(); expect(panel.memSearch.q).toBe("");
    expect(all(root).filter(n => "memorySearchResult" in n.dataset)).toEqual([]);
  });
  it("the search shows 'no match', caps the rendered rows, and an unreadable answer shows a state note with no rows", async () => {
    const panel = await load(rend, "views", "knowledge-panel.js"), core = await load(rend, "knowledge-core.js");
    const run = async (answer: any, throwing = false) => {
      panel.resetKnowledgeSel(); panel.resetMemSearch();
      const path = `/v1/projects/${PID}/memory`;
      const c = await mkCtx({get: (p: string) => { if (p === path && throwing) throw new Error("INVALID_API_PATH"); return projectsGet({[`/v1/projects/${PID}/knowledge`]: body(), [path]: answer})(p); }, lang: "en"} as any);
      st.openProject(PID, "overview"); await panel.submitMemSearch(c.ctx, PID);
      return all(mount(c.doc, await projectsView.render(c.ctx))).find(n => "memorySearchResult" in n.dataset)!;
    };
    expect((await run(lst([]))).dataset.memorySearchResult).toBe("none");
    const many = Array.from({length: core.LIST_RENDER_CAP + 5}, (_, i) => rec(i + 1, {id: `mem_${String(i + 1).padStart(6, "0")}`}));
    const capped = await run(lst(many));
    expect(all(capped).filter(n => "searchMemoryId" in n.dataset)).toHaveLength(core.LIST_RENDER_CAP); expect(capped.dataset.shown).toBe(String(core.LIST_RENDER_CAP)); expect(capped.dataset.total).toBe(String(core.LIST_RENDER_CAP + 5));
    expect(all(capped).filter(n => "searchMemoryId" in n.dataset)[0].dataset.searchMemoryId).toBe(`mem_${String(core.LIST_RENDER_CAP + 5).padStart(6, "0")}`);
    for (const bad of [await run({nonsense: true}), await run(undefined), await run(undefined, true)]) { expect(bad.dataset.memorySearchResult).toBe("unreadable"); expect(all(bad).filter(n => "searchMemoryId" in n.dataset)).toEqual([]); }
  });
  it("en and tr have the same knowledge keys and placeholders, and every kind and state has a label", async () => {
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>, tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const keys = Object.keys(en).filter(k => k.startsWith("knowledge."));
    expect(keys).toHaveLength(58);
    const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(Object.keys(tr).filter(k => k.startsWith("knowledge."))).toHaveLength(58);
    const c = await load(rend, "knowledge-core.js");
    for (const k of [...c.MEMORY_KINDS, ...c.EVIDENCE_KINDS]) expect(en[`knowledge.kind.${k}`], k).toBeTruthy();
    for (const s of c.MEMORY_STATES) { expect(en[`knowledge.mem.state.${s}`], s).toBeTruthy(); expect(en[`knowledge.mem.hint.${s}`], s).toBeTruthy(); }
  });
});

describe("LANE-A A-FLOW-4: running product after delivery (B-RUN-1 contract, run-scoped routes)", () => {
  const RUN = "run_" + "ab".repeat(12), OTHER = "run_" + "cd".repeat(12), HEAD = "e".repeat(40);
  const PROD = `/v1/work-runs/${RUN}/product`, EXE = "/v1/system/executors";
  const runs = (runId = RUN) => ({"/v1/work-runs": {workRuns: [{runId, missionId: MID, status: "SUCCEEDED", startedAt: "2026-10-26T01:00:00.000Z"}]}, [`/v1/missions?projectId=${PID}`]: {missions: [{missionId: MID, projectId: PID, title: "G1", status: "REPORTING", riskLevel: "R1"}]}});
  const dv = (over: any = {}) => ({status: "STOPPED", pid: null, port: null, preview: {state: "UNAVAILABLE", url: null}, logTail: "", deliveryRunId: null, bridged: null, ...over});
  const prod = (devrun: any = dv(), over: any = {}) => ({product: {runId: RUN, deliveredHeadSha: HEAD, devrun, tiedToThisRun: devrun.deliveryRunId === RUN, ...over}});
  const live = (over: any = {}) => dv({status: "RUNNING", port: 4123, pid: 77, deliveryRunId: RUN, bridged: true, preview: {state: "AVAILABLE", url: "http://127.0.0.1:4123/"}, ...over});
  // M3 (review #226): B-RUN-1 starts a product when the delivery's SOURCE GENERATION is complete and a 40-hex commit exists; the DELIVERY stage being DONE means PRODUCT_VERIFIED and is NOT required
  const DETP = `/v1/work-runs/${RUN}`;
  const sgv = (state = "SOURCE_GENERATION_COMPLETE") => ({runId: RUN, missionId: MID, status: "SUCCEEDED", sourceGeneration: {state, reason: null}, productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE"}, testsExecuted: false});
  const det = (state = "SOURCE_GENERATION_COMPLETE") => ({workRun: {runId: RUN, missionId: MID, status: "SUCCEEDED"}, outcomes: null, delivery: sgv(state)});
  const exe = (sb: any = {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE"}) => ({executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: "LOCAL_CLAUDE"}, sandbox: sb});
  const open = (extra: Record<string, any>, o: any = {}) => openWs({lang: "en", get: projectsGet({...runs(), [PROD]: prod(), [DETP]: det(), [EXE]: exe(), ...extra}), ...o});
  const card = (root: N) => byId(root, "studio-ov-product")!;
  it("maps the run-scoped product strictly: this run's id, a 40-hex delivered commit or null, tiedToThisRun must agree with deliveryRunId, reason is a safe code", async () => {
    const c = await load(rend, "project-core.js");
    expect(c.runProductPath(RUN)).toBe(PROD);
    const api = await mkCtx({lang: "en", get: projectsGet({[PROD]: prod()})});
    expect((await api.ctx.api.runProduct("run_zz")).state).toBe("ERROR"); expect(api.calls.get).toEqual([]); // a bad id sends nothing
    expect((await api.ctx.api.runProduct(RUN)).state).toBe("VERIFIED"); expect(api.calls.get).toEqual([PROD]);
    for (const bad of ["run_zz", "", undefined, null, `${RUN}/x`, `${RUN}?a=1`, [RUN], "RUN_" + "ab".repeat(12)]) expect(c.runProductPath(bad), String(bad)).toBeNull();
    expect(c.buildProductRequest({runId: RUN, action: "start"})).toEqual({ok: true, path: `${PROD}/start`, body: {}});
    expect(c.buildProductRequest({runId: RUN, action: "stop"}).path).toBe(`${PROD}/stop`);
    for (const bad of [{runId: "run_zz", action: "start"}, {runId: RUN, action: "restart"}, {runId: RUN, action: "../x"}]) expect(c.buildProductRequest(bad).ok, JSON.stringify(bad)).toBe(false);
    const ok = c.mapRunProduct(prod(live()), RUN);
    expect(ok.state).toBe("VERIFIED"); expect(ok.product).toMatchObject({runId: RUN, deliveredHeadSha: HEAD, tiedToThisRun: true}); expect(ok.product.run).toMatchObject({status: "RUNNING", deliveryRunId: RUN, bridged: true});
    expect(c.mapRunProduct(prod(dv(), {deliveredHeadSha: null}), RUN).product.deliveredHeadSha).toBeNull();
    expect(c.mapRunProduct(prod(live({deliveryRunId: OTHER})), RUN).product.tiedToThisRun).toBe(false);
    const bad: any[] = [null, {}, {product: null}, prod(dv(), {runId: OTHER}), prod(dv(), {deliveredHeadSha: "abc"}), prod(dv(), {deliveredHeadSha: "abcdef1"}), prod(dv(), {deliveredHeadSha: "a".repeat(41)}), prod(dv(), {deliveredHeadSha: "a".repeat(64)}), prod(dv(), {deliveredHeadSha: "E".repeat(40)}), prod(dv(), {deliveredHeadSha: undefined}), prod(dv(), {tiedToThisRun: "yes"}),
      prod(live(), {tiedToThisRun: false}), prod(live({deliveryRunId: OTHER}), {tiedToThisRun: true}), prod(dv(), {tiedToThisRun: true}), prod(dv({status: "WEIRD"})), {product: {...prod().product, devrun: null}}, {product: {...prod().product, devrun: "x"}}];
    for (const b of bad) expect(c.mapRunProduct(b, RUN).state, JSON.stringify(b)?.slice(0, 80)).toBe("ERROR");
    const rs = (reason: any) => c.mapDevRun({devrun: dv({status: "BLOCKED", reason})}).run.reason;
    expect(rs("DEVRUN_SANDBOX_UNAVAILABLE:PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1")).toBe("DEVRUN_SANDBOX_UNAVAILABLE:PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1");
    expect(rs("DEVRUN_SANDBOX_UNAVAILABLE:SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED")).toBe("DEVRUN_SANDBOX_UNAVAILABLE:SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED");
    for (const r of ["sandbox", "<x>", 5, null, "A".repeat(161), "", "DEVRUN:" + "a".repeat(100), "X:with space"]) expect(rs(r), String(r)).toBeNull();
    expect(c.mapDevRun({devrun: dv({bridged: "yes", deliveryRunId: "run_zz"})}).run).toMatchObject({bridged: null, deliveryRunId: null});
  });
  it("offers Start by the route's own condition (source generation complete + a delivered commit, or the route's own `deliverable`), never by the DELIVERY stage; no other delivery's product may run; Stop only for this delivery's own product", async () => {
    const c = await load(rend, "project-core.js");
    const P = (devrun: any, over: any = {}) => c.mapRunProduct(prod(devrun, over), RUN).product;
    const D = (state = "SOURCE_GENERATION_COMPLETE") => ({sourceGeneration: {state}});
    expect(c.productOffer(P(dv()), D())).toMatchObject({deliverable: true, hasCommit: true, start: true, stop: false, open: false});
    expect(c.productOffer(P(dv({status: "BLOCKED", reason: "DEVRUN_SANDBOX_UNAVAILABLE:NSENTER_MISSING"})), D()).start).toBe(true); // refused starts can be retried
    for (const st of ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "FAILED"]) expect(c.productOffer(P(dv()), D(st)), st).toMatchObject({deliverable: false, start: false});
    expect(c.productOffer(P(dv()), null)).toMatchObject({deliverable: null, start: false});
    expect(c.productOffer(P(dv(), {deliveredHeadSha: null}), D())).toMatchObject({hasCommit: false, deliverable: false, start: false});
    // M3: a delivery whose product is not verified yet (DELIVERY stage not DONE) can still be started; the route's own `deliverable` wins over the guess
    expect(c.productOffer(P(dv(), {deliverable: {ok: true}}), null)).toMatchObject({deliverable: true, start: true});
    expect(c.productOffer(P(dv(), {deliverable: {ok: false, reason: "SOURCE_GENERATION_NOT_COMPLETE"}}), D())).toMatchObject({deliverable: false, start: false});
    expect(c.productOffer(P(dv(), {deliveredHeadSha: null, deliverable: {ok: true}}), D())).toMatchObject({deliverable: false, hasCommit: false, start: false}); // the route's own ok never starts a product without a delivered commit
    expect(c.mapRunProduct(prod(dv(), {deliverable: {ok: "yes"}}), RUN).state).toBe("ERROR"); expect(c.mapRunProduct(prod(dv(), {deliverable: {ok: true, reason: "bad reason"}}), RUN).state).toBe("ERROR");
    expect(c.productOffer(P(live()), D()).start).toBe(false);
    expect(c.productOffer(P(live()), D())).toMatchObject({start: false, stop: true, open: true});
    expect(c.productOffer(P(live()), null)).toMatchObject({stop: true}); // Stop never depends on the delivery read
    const other = c.productOffer(P(live({deliveryRunId: OTHER})), D());
    expect(other).toMatchObject({otherRunning: true, start: false, stop: false, open: false});
    expect(c.productOffer(P(live({bridged: false})), D())).toMatchObject({stop: true, open: false});
    expect(c.productOffer(P(live({bridged: null})), D()).open).toBe(false);
    for (const bad of [{preview: {state: "AVAILABLE", url: "http://evil.example/"}}, {preview: {state: "UNAVAILABLE", url: "http://127.0.0.1:4123/"}}, {port: 4999}, {preview: {state: "AVAILABLE", url: "http://127.0.0.1:4123/x"}}, {status: "STARTING"}])
      expect(c.productOffer(P(live(bad)), D()).open, JSON.stringify(bad)).toBe(false);
    // another delivery's product that is still STARTING also blocks (and is flagged), not only a RUNNING one
    expect(c.productOffer(P(dv({status: "STARTING", deliveryRunId: OTHER})), D())).toMatchObject({otherRunning: true, start: false, stop: false});
    expect(c.productOffer(P(dv({status: "STOPPED", deliveryRunId: OTHER})), D())).toMatchObject({otherRunning: false, start: true});
  });
  it("reads only the run-scoped route for the latest run, offers Start after delivery, confirms, posts the fixed empty-body route once and re-reads; it never claims the product runs", async () => {
    const o = await open({}, {post: () => ({status: 200, body: prod(dv({status: "STARTING", deliveryRunId: RUN, bridged: true}))}), confirm: () => true});
    const c = card(o.root);
    expect(c.dataset.productRun).toBe(RUN); expect(c.dataset.productState).toBe("STOPPED"); expect(c.dataset.productOffer).toBe("START");
    expect(o.calls.get).not.toContain(`/v1/projects/${PID}/devrun`); // the project dev-run route is no longer used by this card
    expect(byId(o.root, "product-stop")).toBeNull();
    const reads = () => o.calls.get.filter((g: string) => g === PROD).length, before = reads();
    byId(o.root, "product-start")!.fire("click"); await tick(); await tick();
    expect(reads()).toBe(before + 1);
    expect(o.calls.confirm).toHaveLength(1); expect(String(o.calls.confirm[0].body)).toContain("untrusted generated code"); expect(String(o.calls.confirm[0].body)).toContain("exactly one port");
    expect(o.calls.post).toEqual([{path: `${PROD}/start`, body: {}}]);
    expect(forms.drafts.status["product-run"]).toMatchObject({ok: true, key: "product.done.start"});
    const shown = mount(o.doc, await projectsView.render(o.ctx));
    expect(text(byId(shown, "product-run-status")!)).toContain("not assumed to be running");
    forms.resetAllForms();
    const n = await open({}, {confirm: () => false});
    byId(n.root, "product-start")!.fire("click"); await tick();
    expect(n.calls.post).toEqual([]); expect(forms.drafts.status["product-run"]).toMatchObject({ok: false, key: "confirm.cancelled"});
  });
  it("tells why Start is not offered: no run, no delivered commit, source generation not complete or unreadable; nothing is started. A run/mission read that failed is shown as such, never as 'no run'", async () => {
    const none = await open({"/v1/work-runs": {workRuns: []}});
    expect(all(card(none.root)).find(n => n.dataset.productDelivery)!.dataset.productDelivery).toBe("NO_RUN"); expect(byId(none.root, "product-start")).toBeNull();
    expect(none.calls.get.some((g: string) => g.endsWith("/product"))).toBe(false);
    forms.resetAllForms();
    const nc = await open({[PROD]: prod(dv(), {deliveredHeadSha: null})});
    expect(all(card(nc.root)).some(n => n.dataset.productCommit === "NONE")).toBe(true); expect(byId(nc.root, "product-start")).toBeNull();
    for (const [dt, tag] of [[det("IN_PROGRESS"), "NOT_DELIVERABLE"], [det("BLOCKED"), "NOT_DELIVERABLE"], [det("FAILED"), "NOT_DELIVERABLE"], [undefined, "UNKNOWN"], [{workRun: {runId: RUN, missionId: MID, status: "SUCCEEDED"}}, "UNKNOWN"]] as const) {
      forms.resetAllForms();
      const o = await open({[DETP]: dt});
      expect(byId(o.root, "product-start"), tag).toBeNull();
      expect(all(card(o.root)).find(n => n.dataset.productDelivery)!.dataset.productDelivery).toBe(tag);
      expect(card(o.root).dataset.productOffer).toBe("NONE");
    }
    // M3: the DELIVERY stage is irrelevant (a delivered, not yet verified product is startable)
    forms.resetAllForms();
    const sg = await open({[DETP]: det("SOURCE_GENERATION_COMPLETE"), [`/v1/projects/${PID}/flow`]: {flow: {projectId: PID, stages: [{stage: "DELIVERY", state: "ACTIVE", detail: null}]}}});
    expect(byId(sg.root, "product-start")).not.toBeNull(); expect(card(sg.root).dataset.productOffer).toBe("START");
    // M4 (review #226): a failed runs/missions read shows the read state, never "No run has been recorded"
    for (const [get, st] of [[(p: string) => { if (p === "/v1/work-runs" || p.startsWith("/v1/work-runs?")) throw new Error("fetch failed"); return projectsGet({...runs()})(p); }, "OFFLINE"], [(p: string) => { if (p === "/v1/work-runs" || p.startsWith("/v1/work-runs?")) throw new Error("INVALID_API_PATH"); return projectsGet({...runs()})(p); }, "UNAVAILABLE"]] as const) {
      forms.resetAllForms();
      const f = await openWs({lang: "en", get}); const pd = all(card(f.root)).find(n => n.dataset.productDelivery)!;
      expect(pd.dataset.productDelivery, st).toMatch(/^RUNS_/); expect(pd.dataset.productDelivery).not.toBe("NO_RUN"); expect(text(card(f.root))).not.toContain("No run has been recorded"); expect(byId(f.root, "product-start")).toBeNull();
      expect(f.calls.get.some((g: string) => g.endsWith("/product"))).toBe(false);
    }
  });
  it("shows the local address only for this delivery's RUNNING, bridged product; Stop posts the fixed route without confirmation; another delivery's product is neither shown nor stopped", async () => {
    const o = await open({[PROD]: prod(live()), [DETP]: det("IN_PROGRESS")}, {post: () => ({status: 200, body: prod(dv())})});
    const url = all(card(o.root)).find(n => n.dataset.productUrl)!;
    expect(url.dataset.productUrl).toBe("http://127.0.0.1:4123/"); expect(text(url)).toContain("http://127.0.0.1:4123/");
    expect(byId(o.root, "product-start")).toBeNull(); expect(card(o.root).dataset.productOffer).toBe("STOP");
    byId(o.root, "product-stop")!.fire("click"); await tick(); await tick();
    expect(o.calls.confirm).toHaveLength(0); expect(o.calls.post).toEqual([{path: `${PROD}/stop`, body: {}}]);
    expect(forms.drafts.status["product-run"]).toMatchObject({ok: true, key: "product.done.stop"});
    const badgeCls = (root: N) => String(all(card(root)).find(n => String(n.className).split(" ").includes("badge"))!.className);
    expect(badgeCls(o.root)).toContain("badge-ok");
    forms.resetAllForms();
    const oth = await open({[PROD]: prod(live({deliveryRunId: OTHER}))});
    expect(all(card(oth.root)).some(n => n.dataset.productUrl)).toBe(false); expect(byId(oth.root, "product-stop")).toBeNull(); expect(byId(oth.root, "product-start")).toBeNull();
    expect(all(card(oth.root)).some(n => n.dataset.productOther === "1")).toBe(true); expect(badgeCls(oth.root)).toContain("badge-risk");
    forms.resetAllForms();
    const nb = await open({[PROD]: prod(live({bridged: false}))});
    expect(all(card(nb.root)).some(n => n.dataset.productUrl)).toBe(false); expect(text(card(nb.root))).toContain("not bridged to a local address"); expect(byId(nb.root, "product-stop")).not.toBeNull();
    forms.resetAllForms();
    const noUrl = await open({[PROD]: prod(live({preview: {state: "UNAVAILABLE", url: null}}))});
    expect(text(card(noUrl.root))).toContain("No address yet"); expect(byId(noUrl.root, "product-stop")).not.toBeNull();
    forms.resetAllForms();
    expect(badgeCls((await open({})).root)).not.toMatch(/badge-ok|badge-risk/);
  });
  it("renders the exact refusal: state reason with known detail codes translated, unknown codes raw and flagged, a reason only for BLOCKED/CRASHED; no run-on-host path", async () => {
    const reasonOf = async (st: string, reason: string | null, lang = "en") => { const o = await openWs({lang, get: projectsGet({...runs(), [PROD]: prod(dv({status: st, reason})), [DETP]: det(), [EXE]: exe()})}); return all(card(o.root)).find(n => n.dataset.productReason); };
    const a = await reasonOf("BLOCKED", "DEVRUN_SANDBOX_UNAVAILABLE:PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1");
    expect(a!.dataset.productReason).toBe("DEVRUN_SANDBOX_UNAVAILABLE:PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1");
    expect(text(a!)).toContain("no verified sandbox provider can host the product"); expect(text(a!)).toContain("no bridge to a local address"); expect(text(a!)).toContain("(PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1)");
    expect(text(a!)).not.toMatch(/run anyway|on the host/i);
    expect(text((await reasonOf("BLOCKED", "DEVRUN_SANDBOX_UNAVAILABLE:SANDBOX_LOOPBACK_NOT_VERIFIED:NOT_REPORTED"))!)).toContain("did not prove it has a working loopback");
    expect(text((await reasonOf("BLOCKED", "SANDBOX_UNAVAILABLE"))!)).toContain("no verified sandbox exists");
    expect(text((await reasonOf("CRASHED", "BRAND_NEW_REASON"))!)).toContain("BRAND_NEW_REASON (not recognised)");
    expect(text((await reasonOf("BLOCKED", "DEVRUN_SANDBOX_UNAVAILABLE:BRAND_NEW_DETAIL"))!)).toContain("(BRAND_NEW_DETAIL)");
    // LOW (review #226): the B-RUN-1 / devrun reasons have their own text, not "(not recognised)"
    // the server also reports PROCESS_EXITED:<code|signal> (CRASHED) and SANDBOX_UNVERIFIED: recognised, with the detail shown as given
    const px = (await reasonOf("CRASHED", "PROCESS_EXITED:SIGTERM"))!; expect(text(px)).toContain("exited by itself"); expect(text(px)).toContain("(SIGTERM)"); expect(text(px)).not.toContain("not recognised");
    const su = (await reasonOf("BLOCKED", "SANDBOX_UNVERIFIED"))!; expect(text(su)).toContain("lost its verification"); expect(text(su)).toContain("running product was stopped"); expect(text(su)).not.toMatch(/was not started|could not be verified/); expect(text(su)).not.toContain("not recognised"); // the server uses it only to STOP an already running product (devrun checkProvider)
    expect(text((await reasonOf("BLOCKED", "SANDBOX_UNVERIFIED", "tr"))!)).toContain("durduruldu");
    expect(text((await reasonOf("CRASHED", "PROCESS_EXITED:1", "tr"))!)).toContain("sonlandı");
    for (const r of ["DEVRUN_BRIDGE_FAILED", "DEVRUN_COMMAND_NOT_CONFIGURED", "DEVRUN_COMMAND_NOT_ALLOWED", "REPOSITORY_NOT_CONFIGURED", "DEVRUN_DELIVERY_HEAD_MISSING", "DEVRUN_SPAWN_FAILED"]) { const n = (await reasonOf("BLOCKED", r))!; expect(n.dataset.productReason, r).toBe(r); expect(text(n), r).not.toContain("not recognised"); expect(text(n), r).not.toContain("product.reason"); }
    expect(await reasonOf("STOPPED", "SANDBOX_UNAVAILABLE")).toBeUndefined();
    expect(text((await reasonOf("BLOCKED", "DEVRUN_SANDBOX_UNAVAILABLE:NSENTER_MISSING", "tr"))!)).toContain("Başlatma reddedildi");
    const o = await open({[EXE]: exe({state: "AVAILABLE", providerId: "docker"})}); const o_av = (x: any) => all(card(x.root)).find(n => n.dataset.productSandbox)!;
    expect(all(card(o.root)).find(n => n.dataset.productSandbox)!.dataset.productSandbox).toBe("AVAILABLE");
    const un = all(card((await open({[EXE]: exe()})).root)).find(n => n.dataset.productSandbox)!;
    expect(un.dataset.productSandbox).toBe("UNAVAILABLE"); expect(text(un)).toContain("starting will be refused"); expect(text(un)).not.toContain("Sandbox available");
    expect(text(o_av(o))).toContain("only inside the verified sandbox");
    expect(all(card((await open({[EXE]: undefined})).root)).find(n => n.dataset.productSandbox)!.dataset.productSandbox).toBe("UNKNOWN");
  });
  it("explains server refusals of start/stop with the exact reason in the post result (no raw server text), in en and tr", async () => {
    const w = await load(rend, "work-core.js");
    const d = (status: number, body: any) => w.describePostResult({status, body});
    expect(d(409, {error: "DEVRUN_SANDBOX_UNAVAILABLE", reason: "PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1"})).toEqual({ok: false, key: "post.err.409.DEVRUN_SANDBOX_UNAVAILABLE", vars: {status: 409, reason: "PROVIDER_HAS_NO_BRIDGE:wsl-unshare-v1"}});
    expect(d(409, {error: "PRODUCT_RUN_NOT_DELIVERABLE", reason: "NO_DELIVERED_COMMIT"}).vars.reason).toBe("NO_DELIVERED_COMMIT");
    expect(d(409, {error: "PRODUCT_RUN_NOT_THIS_DELIVERY", reason: "RUNNING_FOR_OTHER_RUN"}).key).toBe("post.err.409.PRODUCT_RUN_NOT_THIS_DELIVERY");
    for (const r of ["<script>", "has space", 5, undefined, "a".repeat(200)]) expect(d(409, {error: "DEVRUN_SANDBOX_UNAVAILABLE", reason: r}).vars.reason, String(r)).toBe("UNKNOWN");
    expect(d(409, {error: "SANDBOX_UNAVAILABLE"})).toEqual({ok: false, key: "post.err.409.SANDBOX_UNAVAILABLE", vars: {status: 409}}); // the old gate refusal is unchanged
    expect(d(423, {error: "GLOBAL_STOP_ACTIVE"}).key).toBe("post.err.423"); expect(d(403, {error: "ACTION_DENIED"}).key).toBe("post.err.auth");
    const en = await load(rend, "locales", "en.js"), tr = await load(rend, "locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("product.") || /^post\.err\.409\.(DEVRUN|PRODUCT)/.test(k));
    expect(keys.length).toBe(48);
    // LOW (review #226): the keys the card can reach exist, and no key is left unreachable
    for (const k of ["product.reason.DEVRUN_BRIDGE_FAILED", "product.reason.DEVRUN_COMMAND_NOT_CONFIGURED", "product.reason.DEVRUN_COMMAND_NOT_ALLOWED", "product.reason.REPOSITORY_NOT_CONFIGURED", "product.reason.DEVRUN_DELIVERY_HEAD_MISSING", "product.reason.DEVRUN_SPAWN_FAILED"]) expect(E[k], k).toBeTruthy();
    for (const k of ["product.reason.DEVRUN_BLOCKED", "product.detail.DEVRUN_BRIDGE_FAILED", "product.notDelivered"]) expect(E[k], k).toBeUndefined();
    for (const k of keys) expect(T[k], k).toBeTruthy();
    for (const k of keys.filter(x => /^post\.err\.409\.(DEVRUN_SANDBOX|PRODUCT_RUN_NOT)/.test(x))) expect(E[k], k).toContain("{reason}");
  });
  it("an unreadable product route is UNAVAILABLE (or an error) with no state, URL or buttons made up; the Run tab shortcut opens the Run tab", async () => {
    const o = await open({[PROD]: undefined});
    expect(card(o.root).dataset.productState).toBeUndefined(); expect(text(card(o.root))).toContain("not available to the desktop yet");
    expect(byId(o.root, "product-start")).toBeNull(); expect(byId(o.root, "product-stop")).toBeNull();
    const err = await open({[PROD]: prod(dv(), {runId: OTHER})});
    expect(card(err.root).dataset.productState).toBeUndefined(); expect(byId(err.root, "product-start")).toBeNull();
    const ok = await open({});
    byId(ok.root, "product-open-run")!.fire("click"); await tick();
    expect(st.studio.tab).toBe("run");
  });
});

// //TR: LANE-A A-UI125-1: İçe aktarma başarısı ajan yapılandırma KARANTİNASINI gizleyen düz bir "kabul edildi" olamaz. Yanıt şekli gerçek sunucudan alınmıştır (server.ts import rotası; v7-sbx8-agent-config.test.ts sözleşme testi gerçek yanıtı eşleyiciye okutur): {project, import:{kind, headSha, agentConfigQuarantine?:{count, headSha, files:[{path,pattern,kind,bytes,sha256}], truncated, storedUnder}}}; alan YALNIZ karantina varsa gelir.
describe("LANE-A A-UI125-1 import success shows the agent configuration quarantine honestly (fake DOM)", () => {
  const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
  const fileOf = (p: string, over: Record<string, any> = {}) => ({path: p, pattern: p.endsWith(".json") ? ".mcp.json" : "CLAUDE.md", kind: "file", bytes: 120, sha256: crypto.createHash("sha256").update(p).digest("hex"), ...over});
  const quarantine = (files: any[], over: Record<string, any> = {}) => ({count: files.length, headSha: HEAD, files, truncated: false, storedUnder: "projects/<projectId>/quarantine/agent-config/<sha256>", ...over});
  const body = (q?: unknown) => ({project: {projectId: PID, name: "Mağaza"}, import: {kind: "git", headSha: HEAD, ...(q === undefined ? {} : {agentConfigQuarantine: q})}});
  const imp = async (post: () => {status: number; body: any}, lang = "en", fixed = false) => {
    const native = {pickImportPath: async (k: string) => ({cancelled: false, path: k === "zip" ? "C:\\z\\a.zip" : "C:\\Projeler\\app", kind: k})};
    const c = await mkCtx({get: projectsGet(), post, native, lang});
    if (fixed) st.openProject(PID, "overview");
    let root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    return {...c, root};
  };
  const block = (root: N) => byId(root, "studio-import-quarantine");
  const statusText = (root: N) => text(byId(root, "studio-import-status")!);

  it("QUARANTINED: the status says files were quarantined and are NOT in the repository, and the evidence block lists count, commit, storage and every file", async () => {
    const files = [fileOf("CLAUDE.md"), fileOf(".claude/settings.json", {pattern: ".claude/**"}), fileOf("pkg/.mcp.json")];
    const r = await imp(() => ({status: 200, body: body(quarantine(files))}));
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: true, key: "studio.import.doneQuarantined", vars: {count: 3}});
    expect(statusText(r.root)).toBe("Import accepted, but 3 agent configuration file(s) were quarantined: they are NOT in the project repository. Details below.");
    expect(statusText(r.root)).not.toContain("Import request accepted.");
    const b = block(r.root)!;
    expect(b.dataset.quarantine).toBe("QUARANTINED");
    expect(b.dataset.quarantineFor).toBe(PID);
    expect(text(all(b).find(n => n.dataset.quarantineNote === "quarantined")!)).toBe("3 agent configuration file(s) were quarantined at commit a1b2c3d4e5f6 and are not in the managed repository. Evidence is stored under projects/<projectId>/quarantine/agent-config/<sha256>.");
    expect(all(b).filter(n => "quarantineFile" in n.dataset).map(n => n.dataset.quarantineFile)).toEqual(["CLAUDE.md", ".claude/settings.json", "pkg/.mcp.json"]);
    const row = all(b).find(n => n.dataset.quarantineFile === ".claude/settings.json")!;
    expect(row.children.map(text)).toEqual([".claude/settings.json", ".claude/**", "file", "120", fileOf(".claude/settings.json").sha256.slice(0, 12)]);
    expect(all(b).filter(n => n.tagName === "TH").map(text)).toEqual(["Path", "Pattern", "Kind", "Bytes", "SHA-256 (first 12)"]);
    expect(all(b).filter(n => "quarantineMore" in n.dataset)).toEqual([]);
    expect(Object.keys(r.calls.post[0].body)).toEqual(["kind", "path"]); // the request itself is unchanged
  });

  it("NOT quarantined (no agentConfigQuarantine field in a readable import block): the plain acceptance plus an explicit 'server reported no quarantine' line - never a quarantine claim", async () => {
    const r = await imp(() => ({status: 200, body: body()}));
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: true, key: "studio.import.done"});
    expect(statusText(r.root)).toBe("Import request accepted.");
    const b = block(r.root)!;
    expect(b.dataset.quarantine).toBe("NONE");
    expect(text(all(b).find(n => n.dataset.quarantineNote === "none")!)).toBe("The server reported no agent configuration quarantine for this import. (It sends this evidence only when something was quarantined.)");
    expect(all(b).filter(n => "quarantineFile" in n.dataset)).toEqual([]);
    expect(text(b)).not.toMatch(/were quarantined at commit/);
  });

  it("UNKNOWN (the answer has no readable import block, or the evidence is malformed): never a plain success, never partial figures", async () => {
    // //TR: A-UI125-1 round-1 (#269): bu tablodan "dosya yolunda kontrol karakteri => UNKNOWN" girdisi bilerek çıkarıldı; yol artık listelenmez ama SAYILIR (QUARANTINED + undisplayable) ve kanıtı "L5"/"L3" testlerinde sabitlenmiştir. Desen ve storedUnder içindeki kontrol karakterleri hâlâ UNKNOWN'dur (aşağıdaki iki girdi).
    const bads: Array<[string, any]> = [["empty body", {}], ["no import block", {project: {projectId: PID}}], ["import not an object", {import: "x"}],
      ["import without kind", {import: {headSha: HEAD}}], ["import with a bad headSha", {import: {kind: "git", headSha: "xyz"}}],
      ["count mismatching the files", body(quarantine([fileOf("CLAUDE.md")], {count: 2}))], ["count above the listed files with a consistent truncated flag (the server truncates only above 500)", body(quarantine([fileOf("CLAUDE.md"), fileOf("a/CLAUDE.md")], {count: 3, truncated: true}))], ["more files listed than counted", body(quarantine([fileOf("CLAUDE.md"), fileOf("a/CLAUDE.md")], {count: 1}))], ["count zero", body(quarantine([], {count: 0}))],
      ["truncated flag contradicting the counts", body(quarantine([fileOf("CLAUDE.md")], {truncated: true}))], ["evidence headSha differing from the import headSha", body(quarantine([fileOf("CLAUDE.md")], {headSha: "b".repeat(40)}))],
      ["a file with a bad sha256", body(quarantine([fileOf("CLAUDE.md", {sha256: "zz"})]))], ["a file kind outside file/symlink/other", body(quarantine([fileOf("CLAUDE.md", {kind: "dir"})]))],
      ["a file pattern with a control character", body(quarantine([fileOf("CLAUDE.md", {pattern: "CLAUDE.md\n"})]))], ["storedUnder with a newline", body(quarantine([fileOf("CLAUDE.md")], {storedUnder: "a\nb"}))], ["a file without sha256", body(quarantine([{path: "CLAUDE.md", pattern: "CLAUDE.md", kind: "file", bytes: 1}]))], ["an empty file path", body(quarantine([fileOf("")]))], ["negative bytes", body(quarantine([fileOf("CLAUDE.md", {bytes: -1})]))],
      ["files not an array", body(quarantine([fileOf("CLAUDE.md")], {files: "x"}))], ["storedUnder missing", body(quarantine([fileOf("CLAUDE.md")], {storedUnder: undefined}))],
      ["the quarantine field is null", body(null)], ["the quarantine field is an array", body([])]];
    const pc = await load(rend, "project-core.js");
    for (const [name, b] of bads) expect(pc.mapImportQuarantine({status: 200, body: b}), name).toEqual({state: "UNKNOWN"});
    const r = await imp(() => ({status: 202, body: {}}));
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: true, key: "studio.import.doneQuarantineUnknown"});
    expect(statusText(r.root)).toBe("Import request accepted. The quarantine outcome is unknown: the server's answer did not carry a readable import result.");
    const b = block(r.root)!;
    expect(b.dataset.quarantine).toBe("UNKNOWN");
    expect(text(all(b).find(n => n.dataset.quarantineNote === "unknown")!)).toBe("Quarantine status unknown: the server's answer did not carry a readable import result, so nothing can be said about quarantined files.");
    expect(all(b).filter(n => "quarantineFile" in n.dataset)).toEqual([]);
  });

  it("the mapper accepts exactly the server's limits: at most 500 files, truncated only when count > files, and the view shows the first 20 with a 'showing N of M' note", async () => {
    const pc = await load(rend, "project-core.js");
    const many = (n: number) => Array.from({length: n}, (_, i) => fileOf(`d${i}/CLAUDE.md`));
    expect(pc.QUARANTINE_MAX_FILES).toBe(500);
    expect(pc.mapImportQuarantine({status: 200, body: body(quarantine(many(500)))}).state).toBe("QUARANTINED");
    expect(pc.mapImportQuarantine({status: 200, body: body(quarantine(many(500), {count: 600, truncated: true}))})).toMatchObject({state: "QUARANTINED", count: 600, truncated: true});
    expect(pc.mapImportQuarantine({status: 200, body: body(quarantine(many(500), {count: 501}))})).toEqual({state: "UNKNOWN"}); // 501 would have been truncated
    expect(pc.mapImportQuarantine({status: 200, body: body(quarantine(many(501), {count: 501}))})).toEqual({state: "UNKNOWN"}); // the server never lists more than 500
    const r = await imp(() => ({status: 200, body: body(quarantine(many(25)))}));
    const b = block(r.root)!;
    expect(all(b).filter(n => "quarantineFile" in n.dataset)).toHaveLength(20);
    expect(text(all(b).find(n => "quarantineMore" in n.dataset)!)).toBe("Showing 20 of 25 quarantined files; the full list is in the evidence manifest stored by the server.");
    const big = await imp(() => ({status: 200, body: body(quarantine(many(500), {count: 600, truncated: true}))}));
    expect(text(all(block(big.root)!).find(n => "quarantineMore" in n.dataset)!)).toContain("Showing 20 of 600");
    expect(text(byId(big.root, "studio-import-status")!)).toContain("600 agent configuration file(s)");
  });

  it("a failed import shows no quarantine block, and starting a new import clears the previous outcome; the workspace panel shows only its own project's outcome", async () => {
    const first = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md")]))}));
    expect(block(first.root)).not.toBeNull();
    // the same drafts: a second import that fails (409) clears the old block
    const native = {pickImportPath: async (k: string) => ({cancelled: false, path: "C:\\Projeler\\app", kind: k})};
    const c = await mkCtx({get: projectsGet(), post: () => ({status: 409, body: {error: "PROJECT_REPOSITORY_ALREADY_MANAGED"}}), native, lang: "en"});
    let root = mount(c.doc, await projectsView.render(c.ctx));
    expect(block(root)).not.toBeNull(); // still the previous (module state) outcome until a new import starts
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    expect(forms.drafts.status["studio-import"].ok).toBe(false);
    expect(block(root)).toBeNull();
    // workspace panel (fixedId): another project's outcome is not shown
    st.setImportOutcome("prj_" + "ff00".repeat(6), {state: "QUARANTINED", headSha: HEAD, count: 1, files: [fileOf("CLAUDE.md")], truncated: false, storedUnder: "x"});
    const ws = await openWs({get: projectsGet(), lang: "en"});
    expect(block(ws.root)).toBeNull();
    st.setImportOutcome(PID, {state: "NONE", headSha: HEAD});
    const ws2 = await openWs({get: projectsGet(), lang: "en"});
    expect(block(ws2.root)?.dataset.quarantine).toBe("NONE");
  });

  // ---- #269 round-1 repair (COORD ledger 9207490) ----
  const PID_B = "prj_" + "cd34".repeat(6);
  const twoProjects = () => projectsGet({"/v1/projects": {projects: [project(), project({projectId: PID_B, name: "Dükkan"})]}});
  const many = (n: number) => Array.from({length: n}, (_, i) => fileOf(`d${i}/CLAUDE.md`));
  const wsStatus = (root: N) => text(byId(root, "studio-import-status")!);
  const submitWs = async (c: any, pid: string) => {
    st.openProject(pid, "overview");
    let root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    return mount(c.doc, await projectsView.render(c.ctx));
  };
  const native = {pickImportPath: async (k: string) => ({cancelled: false, path: k === "zip" ? "C:\\z\\a.zip" : "C:\\Projeler\\app", kind: k})};

  it("M1: the outcome is filed under the project the import was STARTED for, even when another workspace is open when the POST resolves", async () => {
    let release: (v: any) => void = () => {};
    const pending = new Promise<any>(r => { release = r; });
    const c = await mkCtx({get: twoProjects(), post: (() => pending) as any, native, lang: "en"});
    st.openProject(PID, "overview");
    let root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    root = mount(c.doc, await projectsView.render(c.ctx));
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    expect(c.calls.post.map(x => x.path)).toEqual([`/v1/projects/${PID}/import`]);
    st.openProject(PID_B, "overview"); // the Founder moves to workspace B while the POST is in flight
    mount(c.doc, await projectsView.render(c.ctx));
    release({status: 200, body: body(quarantine([fileOf("CLAUDE.md")]))}); await tick(); await tick();
    expect(st.importOutcome.projectId).toBe(PID);
    const rootB = mount(c.doc, await projectsView.render(c.ctx));
    expect(block(rootB)).toBeNull();
    expect(wsStatus(rootB)).toBe("");
    st.openProject(PID, "overview");
    const rootA = mount(c.doc, await projectsView.render(c.ctx));
    expect(block(rootA)?.dataset.quarantine).toBe("QUARANTINED");
    expect(block(rootA)?.dataset.quarantineFor).toBe(PID);
    expect(wsStatus(rootA)).toContain("1 agent configuration file(s) were quarantined");
  });

  it("M3: the quarantine status line is project-scoped like the evidence block (real submit path): another workspace shows neither", async () => {
    const c = await mkCtx({get: twoProjects(), post: () => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md"), fileOf("a/CLAUDE.md"), fileOf("b/CLAUDE.md")]))}), native, lang: "en"});
    const rootA = await submitWs(c, PID);
    expect(wsStatus(rootA)).toContain("3 agent configuration file(s) were quarantined");
    expect(block(rootA)?.dataset.quarantineFor).toBe(PID);
    st.openProject(PID_B, "overview");
    const rootB = mount(c.doc, await projectsView.render(c.ctx));
    expect(byId(rootB, "studio-import-ws")).not.toBeNull();
    expect(block(rootB)).toBeNull();
    expect(wsStatus(rootB)).toBe("");
    expect(text(byId(rootB, "studio-import-ws")!)).not.toMatch(/quarantined/);
    st.openProject(PID, "overview");
    expect(wsStatus(mount(c.doc, await projectsView.render(c.ctx)))).toContain("3 agent configuration file(s) were quarantined");
  });

  it("M2: the 'more' note claims the manifest only when the manifest holds every path; for a truncated list it says only the first N are recorded (en and tr, exact text)", async () => {
    const big = await imp(() => ({status: 200, body: body(quarantine(many(500), {count: 600, truncated: true}))}));
    expect(text(all(block(big.root)!).find(n => "quarantineMore" in n.dataset)!)).toBe("Showing 20 of 600 quarantined files; only the first 500 paths are recorded and the other 100 are not retained by name.");
    const bigTr = await imp(() => ({status: 200, body: body(quarantine(many(500), {count: 600, truncated: true}))}), "tr");
    expect(text(all(block(bigTr.root)!).find(n => "quarantineMore" in n.dataset)!)).toBe("Karantinaya alınan 600 dosyanın 20 tanesi gösteriliyor; yalnız ilk 500 yol kayıtlıdır, kalan 100 dosyanın adı saklanmaz.");
    const mid = await imp(() => ({status: 200, body: body(quarantine(many(30)))}));
    expect(text(all(block(mid.root)!).find(n => "quarantineMore" in n.dataset)!)).toBe("Showing 20 of 30 quarantined files; the full list is in the evidence manifest stored by the server.");
    const midTr = await imp(() => ({status: 200, body: body(quarantine(many(30)))}), "tr");
    expect(text(all(block(midTr.root)!).find(n => "quarantineMore" in n.dataset)!)).toBe("Karantinaya alınan 30 dosyanın 20 tanesi gösteriliyor; tam liste sunucunun sakladığı kanıt manifestindedir.");
    expect(text(block(big.root)!)).not.toMatch(/manifest/);
  });

  it("M4/M5: exact en and tr heading, caption and column texts in QUARANTINED, and exact heading + body text in NONE and UNKNOWN", async () => {
    const h4 = (root: N) => text(all(block(root)!).find(n => n.tagName === "H4")!);
    const q = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md")]))}));
    expect(h4(q.root)).toBe("Agent configuration quarantine");
    expect(text(all(block(q.root)!).find(n => n.tagName === "CAPTION")!)).toBe("Quarantined agent configuration files");
    expect(all(block(q.root)!).filter(n => n.tagName === "TH").map(text)).toEqual(["Path", "Pattern", "Kind", "Bytes", "SHA-256 (first 12)"]);
    const qTr = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md")]))}), "tr");
    expect(h4(qTr.root)).toBe("Ajan yapılandırma karantinası");
    expect(text(all(block(qTr.root)!).find(n => n.tagName === "CAPTION")!)).toBe("Karantinaya alınan ajan yapılandırma dosyaları");
    expect(all(block(qTr.root)!).filter(n => n.tagName === "TH").map(text)).toEqual(["Yol", "Desen", "Tür", "Bayt", "SHA-256 (ilk 12)"]);
    const n = await imp(() => ({status: 200, body: body()}));
    expect(h4(n.root)).toBe("Agent configuration quarantine");
    const nTr = await imp(() => ({status: 200, body: body()}), "tr");
    expect(h4(nTr.root)).toBe("Ajan yapılandırma karantinası");
    const u = await imp(() => ({status: 202, body: {}}));
    expect(h4(u.root)).toBe("Agent configuration quarantine");
    expect(text(block(u.root)!)).toBe("Agent configuration quarantineQuarantine status unknown: the server's answer did not carry a readable import result, so nothing can be said about quarantined files.");
    const uTr = await imp(() => ({status: 202, body: {}}), "tr");
    expect(h4(uTr.root)).toBe("Ajan yapılandırma karantinası");
    expect(text(all(block(uTr.root)!).find(x => x.dataset.quarantineNote === "unknown")!)).toBe("Karantina durumu bilinmiyor: sunucunun yanıtı okunabilir bir içe aktarma sonucu taşımıyordu; karantinaya alınan dosyalar hakkında bir şey söylenemez.");
    expect(text(all(block(uTr.root)!).find(x => x.dataset.quarantineNote === "unknown")!)).not.toBe(text(all(block(nTr.root)!).find(x => x.dataset.quarantineNote === "none")!));
  });

  it("L4: the NONE state renders no files table, no caption and no 'showing N of M' note", async () => {
    const n = await imp(() => ({status: 200, body: body()}));
    const b = block(n.root)!;
    expect(b.dataset.quarantine).toBe("NONE");
    expect(byId(b, "studio-import-quarantine-files")).toBeNull();
    expect(all(b).filter(x => ["TABLE", "CAPTION", "TH", "TR"].includes(x.tagName))).toEqual([]);
    expect(all(b).filter(x => "quarantineMore" in x.dataset || "quarantineUndisplayable" in x.dataset)).toEqual([]);
    expect(text(b)).not.toMatch(/Showing/);
  });

  it("L1: picking a new path clears the previous import's quarantine evidence along with its status", async () => {
    const r = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md")]))}));
    expect(block(r.root)).not.toBeNull();
    byId(r.root, "studio-import-pick")!.fire("click"); await tick();
    const root = mount(r.doc, await projectsView.render(r.ctx));
    expect(block(root)).toBeNull();
    expect(st.importOutcome).toEqual({projectId: null, quarantine: null});
  });

  it("L2: a file entry without sha256 is UNKNOWN, and the projects view renders it without crashing", async () => {
    const r = await imp(() => ({status: 200, body: body(quarantine([{path: "CLAUDE.md", pattern: "CLAUDE.md", kind: "file", bytes: 1}]))}));
    expect(block(r.root)?.dataset.quarantine).toBe("UNKNOWN");
    expect(all(block(r.root)!).filter(n => "quarantineFile" in n.dataset)).toEqual([]);
  });

  it("L3: the mapper bounds and charset are pinned (bytes integer/safe, count <= 1000000, path <= 1024, pattern <= 120, storedUnder <= 200, no NUL/DEL/control characters)", async () => {
    const pc = await load(rend, "project-core.js");
    const map = (files: any[], over: Record<string, any> = {}) => pc.mapImportQuarantine({status: 200, body: body(quarantine(files, over))});
    expect(map([fileOf("CLAUDE.md", {bytes: 1.5})])).toEqual({state: "UNKNOWN"});
    expect(map([fileOf("CLAUDE.md", {bytes: 2 ** 53})])).toEqual({state: "UNKNOWN"});
    expect(map([fileOf("CLAUDE.md", {bytes: 0})]).state).toBe("QUARANTINED");
    expect(map(many(500), {count: 1_000_000, truncated: true}).state).toBe("QUARANTINED");
    expect(map(many(500), {count: 1_000_001, truncated: true})).toEqual({state: "UNKNOWN"});
    expect(map(many(500), {count: 1.5 + 500, truncated: true})).toEqual({state: "UNKNOWN"});
    expect(map([fileOf("CLAUDE.md", {pattern: "p".repeat(120)})]).state).toBe("QUARANTINED");
    expect(map([fileOf("CLAUDE.md", {pattern: "p".repeat(121)})])).toEqual({state: "UNKNOWN"});
    expect(map([fileOf("CLAUDE.md")], {storedUnder: "s".repeat(200)}).state).toBe("QUARANTINED");
    expect(map([fileOf("CLAUDE.md")], {storedUnder: "s".repeat(201)})).toEqual({state: "UNKNOWN"});
    for (const bad of ["a\u0000b", "a\u007fb", "a\tb", "a\u001fb"]) {
      expect(map([fileOf("CLAUDE.md", {pattern: bad})]), JSON.stringify(bad)).toEqual({state: "UNKNOWN"});
      expect(map([fileOf("CLAUDE.md")], {storedUnder: bad}), JSON.stringify(bad)).toEqual({state: "UNKNOWN"});
    }
    const ok = map([fileOf("p".repeat(1024))]);
    expect(ok).toMatchObject({state: "QUARANTINED", undisplayable: 0, recorded: 1});
    expect(ok.files).toHaveLength(1);
    for (const bad of ["p".repeat(1025), "a\u0000b", "a\u007fb", "a\tb", "a\nb"]) {
      const m = map([fileOf("CLAUDE.md"), fileOf(bad)]);
      expect(m, JSON.stringify(bad.slice(0, 6))).toMatchObject({state: "QUARANTINED", count: 2, recorded: 2, undisplayable: 1});
      expect(m.files.map((f: any) => f.path)).toEqual(["CLAUDE.md"]);
    }
  });

  // //TR: A-269-LOWS: q.undisplayable metni C1/bidi/biçimlendirme karakterlerini de kapsayacak şekilde genişletildi; bu testteki üç sabit metin (en/tr) buna göre güncellendi, başka assertion değişmedi.
  it("L5: one repo-controlled undisplayable path (too long, TAB, newline) keeps the real quarantine count and commit, is counted but not listed, and is never NONE or a wrong-cause UNKNOWN", async () => {
    const r = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md"), fileOf("evil\tname/CLAUDE.md"), fileOf("x".repeat(1030))]))}));
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: true, key: "studio.import.doneQuarantined", vars: {count: 3}});
    const b = block(r.root)!;
    expect(b.dataset.quarantine).toBe("QUARANTINED");
    expect(text(all(b).find(n => n.dataset.quarantineNote === "quarantined")!)).toBe("3 agent configuration file(s) were quarantined at commit a1b2c3d4e5f6 and are not in the managed repository. Evidence is stored under projects/<projectId>/quarantine/agent-config/<sha256>.");
    expect(all(b).filter(n => "quarantineFile" in n.dataset).map(n => n.dataset.quarantineFile)).toEqual(["CLAUDE.md"]);
    expect(text(all(b).find(n => "quarantineUndisplayable" in n.dataset)!)).toBe("2 recorded path(s) cannot be displayed (too long or containing control or hidden formatting characters); they are counted above but not listed.");
    expect(all(b).filter(n => "quarantineMore" in n.dataset)).toEqual([]);
    const tr = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md"), fileOf("evil\nname/CLAUDE.md")]))}), "tr");
    expect(text(all(block(tr.root)!).find(n => "quarantineUndisplayable" in n.dataset)!)).toBe("Kayıtlı 1 yol gösterilemiyor (çok uzun veya kontrol ya da gizli biçimlendirme karakteri içeriyor); yukarıda sayıldı ama listelenmedi.");
    const allBad = await imp(() => ({status: 200, body: body(quarantine([fileOf("a\nb")]))}));
    expect(block(allBad.root)?.dataset.quarantine).toBe("QUARANTINED");
    expect(byId(block(allBad.root)!, "studio-import-quarantine-files")).toBeNull();
    expect(forms.drafts.status["studio-import"]).toMatchObject({key: "studio.import.doneQuarantined", vars: {count: 1}});
  });

  // ---- A-269-LOWS (COORD ledger, #269 review LOWs) ----
  it("D28/D29: the noDialog, dialogFailed and validation statuses carry the project id, and a workspace panel shows only its own project's status", async () => {
    const PID_B = "prj_" + "cd34".repeat(6);
    const two = projectsGet({"/v1/projects": {projects: [project(), project({projectId: PID_B, name: "Dükkan"})]}});
    const noNative = await mkCtx({get: two, lang: "en"});
    st.openProject(PID, "overview");
    let root = mount(noNative.doc, await projectsView.render(noNative.ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: false, key: "studio.import.noDialog", projectId: PID});
    root = mount(noNative.doc, await projectsView.render(noNative.ctx));
    expect(text(byId(root, "studio-import-status")!)).toContain("The file dialog is not available");
    st.openProject(PID_B, "overview");
    expect(text(byId(mount(noNative.doc, await projectsView.render(noNative.ctx)), "studio-import-status")!)).toBe("");
    forms.resetAllForms(); st.resetStudio();
    const broken = await mkCtx({get: two, lang: "en", native: {pickImportPath: async () => { throw new Error("boom"); }}});
    st.openProject(PID, "overview");
    root = mount(broken.doc, await projectsView.render(broken.ctx));
    byId(root, "studio-import-pick")!.fire("click"); await tick();
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: false, key: "studio.import.dialogFailed", projectId: PID});
    st.openProject(PID_B, "overview");
    expect(text(byId(mount(broken.doc, await projectsView.render(broken.ctx)), "studio-import-status")!)).toBe("");
    forms.resetAllForms(); st.resetStudio();
    const val = await mkCtx({get: two, lang: "en", native});
    st.openProject(PID, "overview");
    root = mount(val.doc, await projectsView.render(val.ctx));
    byId(root, "studio-import-form")!.fire("submit"); await tick();
    expect(val.calls.post).toEqual([]);
    expect(forms.drafts.status["studio-import"]).toMatchObject({ok: false, projectId: PID});
    expect(Object.keys(forms.drafts.status["studio-import"].errors).length).toBeGreaterThan(0);
    root = mount(val.doc, await projectsView.render(val.ctx));
    expect(text(byId(root, "studio-import-status")!)).not.toBe("");
    st.openProject(PID_B, "overview");
    expect(text(byId(mount(val.doc, await projectsView.render(val.ctx)), "studio-import-status")!)).toBe("");
  });

  it("D23: a file entry whose path is not a string (or is empty) is UNKNOWN, never a listed or counted file", async () => {
    const pc = await load(rend, "project-core.js");
    for (const bad of [7, null, undefined, {}, ["CLAUDE.md"], true, ""]) {
      const f: any = {...fileOf("CLAUDE.md"), path: bad};
      expect(pc.mapImportQuarantine({status: 200, body: body(quarantine([f]))}), JSON.stringify(bad) ?? "undefined").toEqual({state: "UNKNOWN"});
    }
    const noPath: any = fileOf("CLAUDE.md"); delete noPath.path;
    expect(pc.mapImportQuarantine({status: 200, body: body(quarantine([noPath]))})).toEqual({state: "UNKNOWN"});
  });

  it("C1 controls and bidi/format characters in a path are counted but not listed; in a pattern or storedUnder they are UNKNOWN; neighbouring printable characters stay listed", async () => {
    const pc = await load(rend, "project-core.js");
    const map = (files: any[], over: Record<string, any> = {}) => pc.mapImportQuarantine({status: 200, body: body(quarantine(files, over))});
    const hidden = ["\u0080", "\u0085", "\u009f", "​", "‎", "‏", "‪", "‭", "‮", "⁦", "⁧", "⁩"];
    for (const c of hidden) {
      const m = map([fileOf("CLAUDE.md"), fileOf(`ev${c}il/CLAUDE.md`)]);
      expect(m, JSON.stringify(c)).toMatchObject({state: "QUARANTINED", count: 2, recorded: 2, undisplayable: 1});
      expect(m.files.map((f: any) => f.path), JSON.stringify(c)).toEqual(["CLAUDE.md"]);
      expect(map([fileOf("CLAUDE.md", {pattern: `p${c}q`})]), JSON.stringify(c)).toEqual({state: "UNKNOWN"});
      expect(map([fileOf("CLAUDE.md")], {storedUnder: `a${c}b`}), JSON.stringify(c)).toEqual({state: "UNKNOWN"});
    }
    const shown = [" ", "¡", "é", " ", "‐", " ", "⁠", "⁥", "⁪", "あ"];
    for (const c of shown) {
      const m = map([fileOf(`ok${c}name/CLAUDE.md`)]);
      expect(m, JSON.stringify(c)).toMatchObject({state: "QUARANTINED", undisplayable: 0});
      expect(m.files.map((f: any) => f.path), JSON.stringify(c)).toEqual([`ok${c}name/CLAUDE.md`]);
    }
    const r = await imp(() => ({status: 200, body: body(quarantine([fileOf("a‮b/CLAUDE.md")]))}));
    expect(all(block(r.root)!).filter(n => "quarantineFile" in n.dataset)).toEqual([]);
    expect(text(all(block(r.root)!).find(n => "quarantineUndisplayable" in n.dataset)!)).toBe("1 recorded path(s) cannot be displayed (too long or containing control or hidden formatting characters); they are counted above but not listed.");
  });

  it("Turkish renders the same three outcomes, and the en/tr keys have the same placeholders", async () => {
    const q = await imp(() => ({status: 200, body: body(quarantine([fileOf("CLAUDE.md")]))}), "tr");
    expect(statusText(q.root)).toBe("İçe aktarma kabul edildi, ancak 1 ajan yapılandırma dosyası karantinaya alındı: bunlar proje deposunda DEĞİL. Ayrıntılar aşağıda.");
    expect(text(all(block(q.root)!).find(n => n.dataset.quarantineNote === "quarantined")!)).toBe("1 ajan yapılandırma dosyası a1b2c3d4e5f6 commit'inde karantinaya alındı ve yönetilen depoda değil. Kanıt şurada saklanır: projects/<projectId>/quarantine/agent-config/<sha256>.");
    const n = await imp(() => ({status: 200, body: body()}), "tr");
    expect(text(all(block(n.root)!).find(x => x.dataset.quarantineNote === "none")!)).toBe("Sunucu bu içe aktarma için ajan yapılandırma karantinası bildirmedi. (Bu kanıtı yalnız bir şey karantinaya alındığında gönderir.)");
    const u = await imp(() => ({status: 202, body: {}}), "tr");
    expect(statusText(u.root)).toBe("İçe aktarma isteği kabul edildi. Karantina sonucu bilinmiyor: sunucunun yanıtı okunabilir bir içe aktarma sonucu taşımıyordu.");
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>, tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const keys = Object.keys(en).filter(k => k.startsWith("studio.import.q.") || k === "studio.import.doneQuarantined" || k === "studio.import.doneQuarantineUnknown");
    // //TR: A-UI125-1 repair: iki yeni anahtar (q.moreTruncated, q.undisplayable) eklendi; sayı 13 -> 15.
    expect(keys.length).toBe(15);
    const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
  });
});
