// //TR: Bu test B7 Windows kurulum paketini gerçek kurulum yapmadan doğrular: electron-builder ayarı (kullanıcı başına, dizin seçimi, kısayollar, oneClick yok, provisioned electronDist, artifact adı), NSIS include'daki boş alan/ağ sürücüsü kontrolleri ve varsayılan kapalı "kullanıcı verilerini de sil" seçeneği, kurulu mod yol eşlemesinin bütün değişken veriyi userData altına koyması, token'ın argv/env/log'a girmemesi, tek örnek kilidi ve geliştirme modunun değişmemesi.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {PassThrough} from "node:stream";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const desk = path.join(root, "apps", "desktop");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(root, ...p)).href);
const mainSrc = read("apps", "desktop", "main.mjs");
const nsh = read("installer", "nsis", "uasco-installer.nsh");
const ebConfig = JSON.parse(read("installer", "electron-builder.json"));
const buildScript = read("scripts", "build-installer.mjs");

// electron vitest içinde import edilemez; korumalı main.mjs içindeki saf B7 bloğu izole değerlendirilir.
const packagedBlock = () => {
  const m = /\/\/ B7-PACKAGED-BEGIN\n([\s\S]*?)\/\/ B7-PACKAGED-END/.exec(mainSrc);
  expect(m).not.toBeNull();
  return new Function("path", `${m![1]}\nreturn {packagedDataPaths,backendLaunchSpec,PACKAGED_BACKEND_ENTRY,BACKEND_ENV_PASSTHROUGH};`)(path) as {
    packagedDataPaths: (u: unknown) => Record<string, string>;
    backendLaunchSpec: (x: Record<string, unknown>) => {command: string; args: string[]; options: {cwd: string; env: Record<string, string>; stdio: string[]; windowsHide: boolean; shell?: unknown}};
    PACKAGED_BACKEND_ENTRY: string[];
    BACKEND_ENV_PASSTHROUGH: string[];
  };
};

describe("B7 electron-builder configuration (static)", () => {
  it("is an assisted per-user NSIS x64 installer with directory choice and UASCO shortcuts", () => {
    expect(ebConfig.appId).toBe("com.uasco.desktop");
    expect(ebConfig.productName).toBe("UASCO");
    expect(ebConfig.artifactName).toBe("UASCO-Setup-${version}-win-x64.${ext}");
    expect(ebConfig.win.target).toEqual([{target: "nsis", arch: ["x64"]}]);
    expect(ebConfig.win.requestedExecutionLevel).toBe("asInvoker");
    expect(ebConfig.win.sign).toBe(false);
    const n = ebConfig.nsis;
    expect(n.oneClick).toBe(false);
    expect(n.perMachine).toBe(false);
    expect(n.allowElevation).toBe(false);
    expect(n.allowToChangeInstallationDirectory).toBe(true);
    expect(n.createDesktopShortcut).toBe(true);
    expect(n.createStartMenuShortcut).toBe(true);
    expect(n.shortcutName).toBe("UASCO");
    expect(n.deleteAppDataOnUninstall).toBe(false);
    expect(n.warningsAsErrors).toBe(true);
    expect(n.include).toBe("uasco-installer.nsh");
    expect(n.uninstallDisplayName).toMatch(/unsigned development build/);
  });
  it("never lets electron-builder download Electron: electronDist comes from the checksum-verified provisioned runtime", async () => {
    expect(buildScript).toContain("const electronExe = await verifyProvisionedElectron(root);");
    expect(buildScript).toContain("const electronDist = path.dirname(electronExe);");
    expect(buildScript.indexOf("assertInstalledDependencyState(root)")).toBeLessThan(buildScript.indexOf("verifyProvisionedElectron(root)"));
    expect(buildScript).not.toMatch(/node_modules[\\/"', ]+electron[\\/"', ]+dist|UASCO-recovery|quarantine/);
    const {builderConfig, stripCommentKeys} = await load("scripts", "build-installer.mjs");
    expect(Object.keys(stripCommentKeys(ebConfig))).not.toEqual(expect.arrayContaining(["electronDownload"]));
    expect(stripCommentKeys(ebConfig).electronDist).toBeUndefined();
    expect(ebConfig.publish).toBeNull();
    expect(() => builderConfig(ebConfig, {electronDist: "", electronVersion: "44.4.5", outputDir: "o", resourcesDir: "r"})).toThrow(/ELECTRON_DIST_REQUIRED/);
    expect(() => builderConfig(ebConfig, {electronDist: "relative/dist", electronVersion: "44.4.5", outputDir: "o", resourcesDir: "r"})).toThrow(/ELECTRON_DIST_REQUIRED/);
    const dist = path.join(root, ".ai", "cache", "electron", "44.4.5-win32-x64", "dist"), res = path.join(os.tmpdir(), "res");
    const c = builderConfig(ebConfig, {electronDist: dist, electronVersion: "44.4.5", outputDir: path.join(os.tmpdir(), "out"), resourcesDir: res});
    expect(c.electronDist).toBe(dist);
    expect(c.electronVersion).toBe("44.4.5");
    expect(c.nsis.include).toBe(path.join(res, "uasco-installer.nsh"));
    expect(c.nsis.oneClick).toBe(false);
    expect(JSON.stringify(c)).not.toContain("//");
    expect(stripCommentKeys({"//TR": 1, a: {"//note": 2, b: [{"//x": 3, c: 4}]}})).toEqual({a: {b: [{c: 4}]}});
  });
  it("keeps build outputs outside the repository tree (protected .gitignore is not changed)", async () => {
    const {resolveBuildOutDir} = await load("scripts", "build-installer.mjs");
    expect(resolveBuildOutDir(root, {})).toBe(path.join(path.dirname(root), `${path.basename(root)}-build`));
    expect(() => resolveBuildOutDir(root, {UASCO_BUILD_OUT_DIR: path.join(root, "dist-installer")})).toThrow(/BUILD_OUT_DIR_INSIDE_REPO/);
    expect(() => resolveBuildOutDir(root, {UASCO_BUILD_OUT_DIR: root})).toThrow(/BUILD_OUT_DIR_INSIDE_REPO/);
  });
  it("ships only the runtime dependency closure of fastify/ajv/ajv-formats (no dev tooling) from the reviewed lock", async () => {
    const {runtimeDependencyClosure} = await load("scripts", "build-installer.mjs");
    const lock = JSON.parse(read("package-lock.json"));
    const closure: string[] = runtimeDependencyClosure(lock);
    for (const x of ["node_modules/fastify", "node_modules/ajv", "node_modules/ajv-formats"]) expect(closure).toContain(x);
    for (const x of ["electron", "electron-builder", "typescript", "tsx", "vitest", "concurrently", "app-builder-lib"]) expect(closure).not.toContain(`node_modules/${x}`);
    for (const rel of closure) expect(lock.packages[rel].dev, rel).not.toBe(true);
    expect(() => runtimeDependencyClosure({packages: {"": {}}}, ["fastify"])).toThrow(/RUNTIME_DEPENDENCY_MISSING:fastify/);
  });
  it("generates an original multi-size ICO (256 px entry, PNG payloads) instead of shipping a third-party logo", async () => {
    const {makeIco} = await load("scripts", "build-installer.mjs");
    const ico: Buffer = makeIco([16, 256]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6 + 16]).toBe(0); // 256 px encoded as 0
    const off = ico.readUInt32LE(6 + 16 + 12);
    expect(ico.subarray(off, off + 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
  it("adds only the approved exact-pinned electron-builder devDependency and the dist scripts; dev mode scripts are unchanged", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies["electron-builder"]).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    expect(pkg.version).toMatch(/^0\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    expect(pkg.dependencies).toEqual({"ajv": "8.20.0", "ajv-formats": "3.0.1", "fastify": "5.12.5"});
    expect(pkg.scripts["dist:win"]).toBe("node scripts/build-installer.mjs");
    expect(pkg.scripts.dev).toBe("concurrently -k \"npm:control-api\" \"npm:desktop\"");
    expect(pkg.scripts.desktop).toBe("electron apps/desktop/main.mjs");
    expect(pkg.scripts["control-api"]).toBe("tsx apps/control-api/src/server.ts");
    const tsb = JSON.parse(read("tsconfig.build.json"));
    expect(tsb.extends).toBe("./tsconfig.json");
    expect(tsb.include).toEqual(["apps/control-api/src/**/*.ts"]);
    expect(tsb.compilerOptions.noEmit).toBe(false);
  });
});

describe("B7 NSIS include: pre-install checks, uninstall data choice, test-only switches", () => {
  it("checks drive existence, free space >= required size + margin and refuses with a TR/EN message", () => {
    expect(nsh).toMatch(/!define \/math UASCO_REQUIRED_MB \$\{UASCO_APP_SIZE_MB\} \+ \$\{UASCO_SPACE_MARGIN_MB\}/);
    expect(nsh).toContain("GetDiskFreeSpaceExW");
    expect(nsh).toContain("GetDriveTypeW");
    expect(nsh).toMatch(/\$\{If\} \$R2 < \$uascoRequiredMB/);
    expect(nsh).toContain("Yetersiz disk alanı");
    expect(nsh).toContain("Insufficient disk space");
    expect(nsh).toContain("Hedef sürücü bulunamadı");
    expect(nsh).toMatch(/SetErrorLevel 3\s+Quit/);
  });
  it("warns on network drives (UNC path or DRIVE_REMOTE)", () => {
    expect(nsh).toMatch(/\$\{If\} \$R1 == "\\\\"/);
    expect(nsh).toMatch(/\$\{If\} \$R4 == 4/);
    expect(nsh).toContain("ağ sürücüsünde");
    expect(nsh).toContain("network drive");
  });
  it("offers 'kullanıcı verilerini de sil' unchecked by default and never deletes data on upgrade", () => {
    expect(nsh).toMatch(/NSD_CreateCheckbox[^\n]*Kullanıcı verilerini de sil/);
    expect(nsh).toMatch(/\$\{NSD_Uncheck\} \$uascoDeleteCheckbox/);
    expect(nsh).not.toMatch(/NSD_Check\b/);
    expect(nsh).toMatch(/!macro customUnInit\s+StrCpy \$uascoDeleteUserData "0"/);
    expect(nsh).toMatch(/!macro customUnInstall\s+\$\{IfNot\} \$\{isUpdated\}\s+\$\{If\} \$uascoDeleteUserData == "1"/);
  });
  it("labels the installer as an unsigned development build", () => {
    expect(nsh).toContain("İMZASIZ GELİŞTİRME");
    expect(nsh).toContain("UNSIGNED DEVELOPMENT");
    expect(nsh).toContain("SmartScreen");
  });
  it("test-only switch redirects shortcut targets into $PLUGINSDIR before shortcut creation and keeps the default uninstall-result handling", () => {
    expect(nsh).toContain("/UASCO_TEST_NO_SHORTCUTS");
    expect(nsh).toMatch(/StrCpy \$newDesktopLink "\$PLUGINSDIR\\uasco-test-desktop\.lnk"/);
    expect(nsh).toMatch(/StrCpy \$newStartMenuLink "\$PLUGINSDIR\\uasco-test-startmenu\.lnk"/);
    expect(nsh).toContain("SetErrorLevel 2");
    expect(nsh).toContain("$(uninstallFailed): $R0");
  });
});

describe("B7 packaged-mode path mapping and backend launch (main.mjs B7 block)", () => {
  const b = packagedBlock();
  const ud = path.join(os.tmpdir(), "uasco-ud", "UASCO");
  it("maps every mutable path under userData", () => {
    const p = b.packagedDataPaths(ud);
    expect(Object.keys(p).sort()).toEqual(["backendLogFile", "desktopLogFile", "globalStopFile", "logsDir", "runtimeDir", "smokeMarker", "userData", "workosDataDir"]);
    for (const [k, v] of Object.entries(p)) {
      const rel = path.relative(ud, v);
      expect(rel.startsWith("..") || path.isAbsolute(rel), k).toBe(false);
    }
    expect(p.globalStopFile).toBe(path.join(ud, "runtime", "GLOBAL_STOP.json"));
    expect(p.workosDataDir).toBe(path.join(ud, "workos"));
    expect(() => b.packagedDataPaths("relative/dir")).toThrow(/USER_DATA_PATH_INVALID/);
    expect(() => b.packagedDataPaths(undefined)).toThrow(/USER_DATA_PATH_INVALID/);
  });
  it("starts the backend with the Electron binary in node mode, from the install dir, with a minimal env and no token on argv or env", () => {
    const paths = b.packagedDataPaths(ud), appRoot = path.join(os.tmpdir(), "inst", "resources", "app");
    const base = {SystemRoot: "C:\\Windows", TEMP: "T", NODE_OPTIONS: "--require evil.js", UASCO_CONTROL_TOKEN: "f".repeat(64), ELECTRON_RUN_AS_NODE: "0", PATH: "x"};
    const s = b.backendLaunchSpec({execPath: "C:\\X\\UASCO.exe", appRoot, paths, port: 51234, baseEnv: base});
    expect(s.command).toBe("C:\\X\\UASCO.exe");
    expect(s.args).toEqual([path.join(appRoot, "apps", "control-api", "src", "packaged-entry.js")]);
    expect(s.options.cwd).toBe(appRoot);
    expect(s.options.shell).toBeUndefined();
    expect(s.options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(s.options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(s.options.env.CONTROL_API_PORT).toBe("51234");
    expect(s.options.env.UASCO_DATA_DIR).toBe(paths.workosDataDir);
    expect(s.options.env.UASCO_RUNTIME_DIR).toBe(paths.runtimeDir);
    expect(s.options.env.NODE_OPTIONS).toBeUndefined();
    expect(s.options.env.UASCO_CONTROL_TOKEN).toBeUndefined();
    expect(s.options.env.PATH).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("f".repeat(64));
    expect(b.BACKEND_ENV_PASSTHROUGH.some(k => /TOKEN|NODE_|ELECTRON/.test(k))).toBe(false);
  });
  it("passes the per-launch token only over stdin, generates it in the main process when packaged, and redacts it from logs", () => {
    expect(mainSrc).toContain('const token=packaged?crypto.randomBytes(32).toString("hex"):(process.env.UASCO_CONTROL_TOKEN??"");');
    expect(mainSrc).toContain("const child=cp.spawn(spec.command,spec.args,spec.options);");
    expect(mainSrc).toContain('child.stdin.write(token+"\\n");');
    expect(mainSrc).toContain('if(t.includes(token))t=t.split(token).join("[redacted]")');
    expect(mainSrc).not.toMatch(/console\.(log|error|info|warn)\([^)]*token/);
    expect(mainSrc).not.toMatch(/writeFileSync\([^)]*token/);
    expect(mainSrc).not.toContain("safeStorage");
    const entry = read("apps", "control-api", "src", "packaged-entry.ts");
    expect(entry).toContain("readFirstLine(process.stdin)");
    expect(entry).not.toMatch(/process\.env\.UASCO_CONTROL_TOKEN|process\.argv\[2\]/);
    expect(entry).toContain('app.listen({host: "127.0.0.1", port: cfg.port})');
  });
  it("waits for verified /health identity, shows an honest backend-error page on failure and stops the backend on quit", () => {
    expect(mainSrc).toMatch(/while\(Date\.now\(\)<deadline\)\{[^\n]*await verifyServerIdentity\(true\)/);
    expect(mainSrc).toContain('if(packaged&&!(await startPackagedBackend())){await win.loadFile(path.join(here,"backend-error.html"));return}');
    expect(mainSrc).toMatch(/app\.on\("before-quit",e=>\{if\(!packaged\|\|backendQuitting\|\|!backend\)return;e\.preventDefault\(\);backendQuitting=true;stopBackend\(\)\.finally\(\(\)=>app\.quit\(\)\)\}\)/);
    const html = read("apps", "desktop", "backend-error.html");
    expect(html).toContain("Arka uç başlatılamadı");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
  });
  it("uses a single-instance lock in packaged mode", () => {
    expect(mainSrc).toContain("const singleInstanceOk=!packaged||app.requestSingleInstanceLock();");
    expect(mainSrc).toContain("if(!singleInstanceOk)app.quit();");
    expect(mainSrc).toMatch(/app\.whenReady\(\)\.then\(async\(\)=>\{\n\s*if\(!singleInstanceOk\)return;/);
    expect(mainSrc).toContain('app.on("second-instance"');
  });
  it("keeps dev mode unchanged: env token/port, repo-relative smoke marker, renderer load and every B4/B5 security property", () => {
    expect(mainSrc).toContain("let port=packaged?0:parseControlPort(process.env.CONTROL_API_PORT,3210),apiBase=packaged?\"\":controlOrigin(port);");
    expect(mainSrc).toContain('const marker=packaged?packagedDataPaths(app.getPath("userData")).smokeMarker:".ai/runtime/DESKTOP_SMOKE_READY.json";');
    expect(mainSrc).toContain("await win.loadFile(rendererFile);");
    for (const x of ["contextIsolation:true", "nodeIntegration:false", "sandbox:true", "webSecurity:true", "devTools:false", "setPermissionRequestHandler", "will-redirect", "requireTrustedSender(event)", "UNTRUSTED_IPC_SENDER", "// B4-ALLOWLIST-BEGIN", "// B5-POST-ALLOWLIST-BEGIN"]) expect(mainSrc).toContain(x);
    expect(mainSrc.match(/await startPackagedBackend\(\)/g)?.length).toBe(1);
  });
  it("loads the sandboxed preload without ESM import syntax and keeps the same narrow surface", () => {
    const preload = read("apps", "desktop", "preload.mjs");
    expect(preload).toContain('const {contextBridge,ipcRenderer}=require("electron");');
    expect(preload).not.toMatch(/^import /m);
    for (const x of ["apiGet", "apiPost", "stop", "resume", "retryBlocked"]) expect(preload).toContain(`${x}:`);
  });
});

describe("B7 packaged Control API entry (pure helpers)", () => {
  it("reads only the first stdin line as the token and fails closed on closed/oversized input", async () => {
    const {readFirstLine} = await load("apps", "control-api", "src", "packaged-entry.ts");
    const s1 = new PassThrough();
    const p1 = readFirstLine(s1);
    s1.write("ab");
    s1.write("cd\nrest-is-ignored\n");
    await expect(p1).resolves.toBe("abcd");
    const s2 = new PassThrough();
    const p2 = readFirstLine(s2);
    s2.end();
    await expect(p2).rejects.toThrow(/CONTROL_TOKEN_STDIN_CLOSED/);
    const s3 = new PassThrough();
    const p3 = readFirstLine(s3);
    s3.write("x".repeat(300));
    await expect(p3).rejects.toThrow(/CONTROL_TOKEN_LINE_TOO_LONG/);
    const s4 = new PassThrough();
    await expect(readFirstLine(s4, 20)).rejects.toThrow(/CONTROL_TOKEN_STDIN_TIMEOUT/);
  });
  it("requires absolute userData-derived runtime and data directories", async () => {
    const {packagedServerConfig} = await load("apps", "control-api", "src", "packaged-entry.ts");
    const abs = path.join(os.tmpdir(), "uasco-ud");
    expect(packagedServerConfig({UASCO_RUNTIME_DIR: path.join(abs, "runtime"), UASCO_DATA_DIR: path.join(abs, "workos"), CONTROL_API_PORT: "50000"})).toEqual({runtime: path.join(abs, "runtime"), dataDir: path.join(abs, "workos"), port: 50000});
    expect(() => packagedServerConfig({UASCO_RUNTIME_DIR: ".ai/runtime", UASCO_DATA_DIR: path.join(abs, "workos")})).toThrow(/UASCO_RUNTIME_DIR_NOT_ABSOLUTE/);
    expect(() => packagedServerConfig({UASCO_RUNTIME_DIR: path.join(abs, "runtime")})).toThrow(/UASCO_DATA_DIR_NOT_ABSOLUTE/);
  });
});

describe("B7 relative import closure of the staged app", () => {
  it("copies missing relative imports from the repo and rejects imports escaping the app root", async () => {
    const {copyRelativeImportClosure} = await load("scripts", "build-installer.mjs");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-b7-repo-")), stage = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-b7-stage-"));
    try {
      fs.mkdirSync(path.join(repo, "lib"), {recursive: true});
      fs.writeFileSync(path.join(repo, "lib", "a.mjs"), 'import {b} from "./b.mjs";\nexport const a=b;\n');
      fs.writeFileSync(path.join(repo, "lib", "b.mjs"), "export const b=1;\n");
      fs.mkdirSync(path.join(stage, "app"), {recursive: true});
      fs.writeFileSync(path.join(stage, "app", "main.mjs"), 'import {a} from "../lib/a.mjs";\nimport fs from "node:fs";\n');
      expect(copyRelativeImportClosure(repo, stage, ["app/main.mjs"])).toEqual(["lib/a.mjs", "lib/b.mjs"]);
      fs.writeFileSync(path.join(stage, "app", "evil.mjs"), 'import x from "../../outside.mjs";\n');
      expect(() => copyRelativeImportClosure(repo, stage, ["app/evil.mjs"])).toThrow(/IMPORT_ESCAPES_APP/);
    } finally {
      fs.rmSync(repo, {recursive: true, force: true});
      fs.rmSync(stage, {recursive: true, force: true});
    }
  });
});

// ---------- INT-R3 D-M1-04: kanonik rol kaydı paketlenmiş uygulamaya sahnelenir ----------
describe("INT-R3 D-M1-04 packaged GET /v1/agents", () => {
  it("stages registries/role-definitions.json so the packaged backend answers /v1/agents with canonical counts (not 503)", async () => {
    const {STATIC_DATA_FILES} = await load("scripts", "build-installer.mjs");
    expect(STATIC_DATA_FILES).toContain("registries/role-definitions.json");
    const {buildServer} = await load("apps", "control-api", "src", "server.ts");
    const app0 = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-b7-app-"));
    try {
      // paketlenmiş uygulama kökü: yalnız sahnelenen statik veri dosyaları vardır
      for (const f of STATIC_DATA_FILES as string[]) { fs.mkdirSync(path.dirname(path.join(app0, f)), {recursive: true}); fs.copyFileSync(path.join(root, f), path.join(app0, f)); }
      const tokenValue = "a".repeat(64), runtimeDir = path.join(app0, "ud", "runtime");
      fs.mkdirSync(runtimeDir, {recursive: true});
      const app = buildServer({controlToken: tokenValue, runtime: runtimeDir, dataDir: path.join(app0, "ud", "workos"), repoRoot: app0, port: 3210, logger: false});
      try {
        const r = await app.inject({method: "GET", url: "/v1/agents", headers: {"x-uasco-control-token": tokenValue, host: "127.0.0.1:3210"}});
        expect(r.statusCode).toBe(200);
        const j = r.json();
        expect(j.registeredRoles).toBe(599);
        expect(j.legacyRoles).toBe(363);
        expect(Number.isSafeInteger(j.certified)).toBe(true);
        expect(j.roleRegistry).toMatchObject({path: "registries/role-definitions.json", authority: "CANONICAL", legacyAuthority: "LEGACY_REFERENCE_ONLY"});
      } finally { await app.close(); }
    } finally { fs.rmSync(app0, {recursive: true, force: true}); }
  });
});
