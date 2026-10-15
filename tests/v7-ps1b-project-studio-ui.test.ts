// //TR: Bu test PS-1B masaüstü Project Studio'yu doğrular: main.mjs GET/POST allow-list eklemeleri (tam eşleşme + traversal/yöntem/boyut negatifleri), yalnız ana süreçte çözülen içe aktarma yolu / önizleme URL'si / dışa aktarma klasörü kuralları, IPC işleyicilerinin renderer'dan yol ya da URL almaması, sihirbaz ve diğer istek gövdeleri (argv dizileri), önizleme düğmesinin yalnız AVAILABLE iken etkin olması, gizli bilgi sansürü, tr/en eşitliği ve sahte DOM ile gerçek görünüm modülleri; mevcut B4/B5/B7 testleri ayrıca çalışır.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

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
  it("preload exposes only the three narrow calls (kind / ids), no token and no generic invoke", () => {
    const preload = read(desk, "preload.mjs");
    expect(preload).toContain('pickImportPath:(kind)=>ipcRenderer.invoke("uasco:pick-import-path",kind)');
    expect(preload).toContain('openPreview:(projectId)=>ipcRenderer.invoke("uasco:open-preview",projectId)');
    expect(preload).toContain('showExport:(projectId,exportId)=>ipcRenderer.invoke("uasco:show-export",projectId,exportId)');
    expect(code(preload)).not.toMatch(/token|process\.env|ipcRenderer\.send|ipcRenderer\.on\(|shell|dialog|openExternal/i);
    expect(preload.match(/ipcRenderer\.invoke\(/g)?.length).toBe(8);
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
    expect(core.devRunActions("BLOCKED")).toEqual({start: false, stop: false, restart: false});
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
    expect(exe.items).toEqual([{id: "LOCAL_CLAUDE", state: "NOT_CONFIGURED", testOnly: false}, {id: "FAKE", state: "READY", testOnly: true}, {id: "LOCAL_CLAUDE", state: null, testOnly: false}]);
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
  replaceChildren(...n: Array<N | string>) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
  focus() { this.doc.focused = this; }
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  querySelectorAll(_s: string): N[] { return all(this); }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  get activeElement(): N { return this.focused && this.body.contains(this.focused) && !this.focused.disabled ? this.focused : this.body; } // gerçek tarayıcı gibi: devre dışı kalan odaklı öğe odağı kaybeder
}
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
    expect(routes.ROUTES.map((r: any) => r.id)).toEqual(["home", "projects", "work", "workforce", "assurance", "delivery", "tower", "inbox", "company", "settings"]);
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
    const step = cfg.steps.find((s: any) => s.id === "tests");
    expect(step.command.slice(-2)).toEqual(["tests/v7-ps1b-project-studio-ui.test.ts", "tests/v7-ps1b-relpath-canonical.test.ts"]); // c2: PS1B-C1-001 testi sona eklendi
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
    expect(app).toContain("if(hadFocus&&focusLost(doc))settleFocus(doc,main,{})");
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
