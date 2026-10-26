// //TR: Bu test SBX-8 B'yi (D-SBX-11 b) doğrular: implementer/reviewer UASCO Claude profilleri kontrol kökü altında ayrı dizinlerdir; UASCO yalnız kendi settings.json dosyasını yazar (hook/MCP/statusLine/apiKeyHelper yok, araç yasakları, reviewer ek olarak yazamaz), kimlik deposu yalnız varlıkla kontrol edilir (yoksa LOGIN_REQUIRED),
// //TR: kişisel ~/.claude, ev dizini, proje çalışma alanı ve git çalışma ağacı içindeki profil yolları reddedilir ve hiçbir şey yazılmaz; GET /v1/system/executors durum ve Founder giriş komutunu döner. Gerçek Claude CLI çalıştırılmaz; kişisel profil okunmaz.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  CLAUDE_CREDENTIAL_STORE_FILE, CLAUDE_PROFILE_DENY_BOTH, CLAUDE_PROFILE_DENY_REVIEWER_EXTRA, claudeProfileDir, claudeProfileForRun, claudeProfileLoginCommand, claudeProfilePathRefusal,
  claudeProfileSettings, claudeProfileStatus, ensureClaudeProfile, ensureClaudeProfiles, withClaudeProfileEnv
} from "../core/workos/claude-profiles.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {CLAUDE_CLI_INSTALL_HINT, claudeAuthFailure, claudeLauncherCheck, claudeRoleReadiness, detectClaudeCli, withClaudeCliOnPath} from "../core/workos/claude-profiles.js";
import {EditOnlyImplementer, LocalClaudeExecutors} from "../core/workos/executors.js";
import {ExecutorSetup} from "../core/workos/executor-setup.js";

const REPO = path.resolve(import.meta.dirname, "..");
const TOKEN = `tok-${crypto.randomBytes(16).toString("hex")}`;
const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
const apps: Array<ReturnType<typeof buildServer>> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx8-prof-")); });
afterEach(async () => {
  for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
});
// Sahte ev dizini: testler gerçek kişisel ~/.claude'a hiç dokunmaz.
const fakeHomeEnv = (home: string): NodeJS.ProcessEnv => ({USERPROFILE: home, HOME: home});

describe("SBX-8 B: UASCO Claude role profiles", () => {
  it("profiles live under <controlRoot>/claude-profiles/<role>; implementer and reviewer are separate directories", () => {
    const control = path.join(tmp, "userdata", "control");
    expect(claudeProfileDir(control, "implementer")).toBe(path.join(control, "claude-profiles", "implementer"));
    expect(claudeProfileDir(control, "reviewer")).toBe(path.join(control, "claude-profiles", "reviewer"));
    expect(() => claudeProfileDir(control, "personal" as never)).toThrow(/CLAUDE_PROFILE_ROLE_INVALID/);
  });
  it("settings: hooks disabled by the CLI kill switch, no hooks/MCP/statusLine/apiKeyHelper/env keys, tool denies for both roles and Edit/Write/MultiEdit denied only as reviewer tools", () => {
    const control = path.join(tmp, "control");
    for (const role of ["implementer", "reviewer"] as const) {
      const s = claudeProfileSettings(role, control) as {disableAllHooks: boolean; enableAllProjectMcpServers: boolean; permissions: {deny: string[]; allow?: unknown; disableBypassPermissionsMode: string}};
      expect(Object.keys(s).sort()).toEqual(["disableAllHooks", "enableAllProjectMcpServers", "permissions"]);
      expect(s.disableAllHooks).toBe(true);
      expect(s.enableAllProjectMcpServers).toBe(false);
      for (const k of ["hooks", "mcpServers", "statusLine", "apiKeyHelper", "env", "additionalDirectories", "enabledMcpjsonServers"]) expect(k in s).toBe(false);
      expect(s.permissions.allow).toBeUndefined();
      expect(s.permissions.disableBypassPermissionsMode).toBe("disable");
      for (const t of CLAUDE_PROFILE_DENY_BOTH) expect(s.permissions.deny).toContain(t);
      for (const t of ["Bash", "PowerShell", "WebFetch", "WebSearch", "NotebookEdit", "Agent", "Task", "Skill"]) expect(s.permissions.deny).toContain(t);
      for (const t of CLAUDE_PROFILE_DENY_REVIEWER_EXTRA) expect(s.permissions.deny.includes(t)).toBe(role === "reviewer");
      expect(s.permissions.deny).toEqual(expect.arrayContaining(["Read(~/.claude/**)", "Read(~/.claude.json)", "Edit(~/.claude/**)"]));
      expect(s.permissions.deny.some(d => d.startsWith("Read(") && d.includes("/claude-profiles/**"))).toBe(true);
    }
  });
  it("ensure writes ONLY settings.json (no credentials copied); status is LOGIN_REQUIRED until the CLI credential store exists in that profile (existence check only)", () => {
    const control = path.join(tmp, "control"), home = path.join(tmp, "home"), env = fakeHomeEnv(home);
    fs.mkdirSync(path.join(home, ".claude"), {recursive: true});
    fs.writeFileSync(path.join(home, ".claude", CLAUDE_CREDENTIAL_STORE_FILE), "PERSONAL-NOT-TO-BE-COPIED");
    const st = ensureClaudeProfiles(control, {env});
    for (const role of ["implementer", "reviewer"] as const) {
      const dir = claudeProfileDir(control, role);
      expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
      expect(st[role]).toMatchObject({role, dir, state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", settings: "PRESENT", credentialStore: "ABSENT"});
      expect(st[role].loginCommand).toBe(claudeProfileLoginCommand(dir));
      expect(st[role].loginCommand).toContain(`$env:CLAUDE_CONFIG_DIR='${dir}'`);
      expect(st[role].loginCommand).toMatch(/; claude; Remove-Item Env:\\CLAUDE_CONFIG_DIR$/);
      expect(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"))).toEqual(claudeProfileSettings(role, control));
    }
    // personal store untouched and never transferred
    expect(fs.readFileSync(path.join(home, ".claude", CLAUDE_CREDENTIAL_STORE_FILE), "utf8")).toBe("PERSONAL-NOT-TO-BE-COPIED");
    // the Founder logs in (simulated by an empty placeholder file; its content is never read)
    fs.writeFileSync(path.join(claudeProfileDir(control, "implementer"), CLAUDE_CREDENTIAL_STORE_FILE), "");
    expect(claudeProfileStatus(control, "implementer", {env})).toMatchObject({state: "READY", credentialStore: "PRESENT"});
    expect(claudeProfileStatus(control, "reviewer", {env}).state).toBe("LOGIN_REQUIRED");
    expect(claudeProfileForRun(control, "implementer", {env})).toEqual({ok: true, dir: claudeProfileDir(control, "implementer")});
    expect(claudeProfileForRun(control, "reviewer", {env})).toMatchObject({ok: false, reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"});
  });
  it("a tampered settings.json is reported MODIFIED by the read-only status and restored by ensure; status itself writes nothing", () => {
    const control = path.join(tmp, "control"), env = fakeHomeEnv(path.join(tmp, "home"));
    expect(claudeProfileStatus(control, "reviewer", {env}).settings).toBe("MISSING");
    expect(fs.existsSync(path.join(control, "claude-profiles"))).toBe(false);
    ensureClaudeProfile(control, "reviewer", {env});
    const f = path.join(claudeProfileDir(control, "reviewer"), "settings.json");
    fs.writeFileSync(f, JSON.stringify({hooks: {SessionStart: [{hooks: [{type: "command", command: "calc.exe"}]}]}}));
    expect(claudeProfileStatus(control, "reviewer", {env}).settings).toBe("MODIFIED");
    expect(ensureClaudeProfile(control, "reviewer", {env}).settings).toBe("PRESENT");
    expect(fs.readFileSync(f, "utf8")).not.toContain("hooks\"");
  });
  it("refuses any profile path equal to or inside the personal ~/.claude, the home directory itself, a project workspace or a git work tree, and writes nothing there", () => {
    const home = path.join(tmp, "home"), env = fakeHomeEnv(home);
    fs.mkdirSync(path.join(home, ".claude"), {recursive: true});
    expect(claudeProfilePathRefusal(path.join(home, ".claude"), {env})).toBe("PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG");
    expect(claudeProfilePathRefusal(path.join(home, ".claude", "uasco", "implementer"), {env})).toBe("PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG");
    expect(claudeProfilePathRefusal(path.join(home, ".CLAUDE", "x"), {env})).toBe(process.platform === "win32" ? "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG" : null);
    expect(claudeProfilePathRefusal(home, {env})).toBe("PROFILE_PATH_IS_HOME_DIRECTORY");
    expect(claudeProfilePathRefusal("relative/dir", {env})).toBe("PROFILE_PATH_NOT_ABSOLUTE");
    // the real personal location is refused too (path comparison only; nothing there is read or written)
    expect(claudeProfilePathRefusal(path.join(os.homedir(), ".claude", "uasco"))).toBe("PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG");
    // control root inside the personal ~/.claude -> REFUSED, nothing created
    const inPersonal = path.join(home, ".claude", "uasco-control");
    const r = ensureClaudeProfile(inPersonal, "implementer", {env});
    expect(r).toMatchObject({state: "REFUSED", reason: "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG", loginCommand: null});
    expect(fs.existsSync(inPersonal)).toBe(false);
    expect(claudeProfileForRun(inPersonal, "implementer", {env})).toMatchObject({ok: false, reason: "CLAUDE_PROFILE_REFUSED:PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG"});
    // project workspace (Work OS data dir) and git work tree
    const data = path.join(tmp, "workos");
    expect(ensureClaudeProfile(path.join(data, "projects", "p", "repo"), "reviewer", {env, forbiddenRoots: [data]})).toMatchObject({state: "REFUSED", reason: "PROFILE_PATH_INSIDE_PROJECT_WORKSPACE"});
    const wt = path.join(tmp, "some-repo");
    fs.mkdirSync(path.join(wt, ".git"), {recursive: true});
    expect(ensureClaudeProfile(path.join(wt, "control"), "implementer", {env})).toMatchObject({state: "REFUSED", reason: "PROFILE_PATH_INSIDE_GIT_WORKTREE"});
    expect(fs.existsSync(path.join(wt, "control"))).toBe(false);
    expect(claudeProfileStatus(REPO, "implementer", {env}).reason).toBe("PROFILE_PATH_INSIDE_GIT_WORKTREE");
  });
  it("a credential store hard-linked to another file (e.g. the personal store) is REFUSED, never treated as logged in", () => {
    const control = path.join(tmp, "control"), env = fakeHomeEnv(path.join(tmp, "home"));
    ensureClaudeProfile(control, "reviewer", {env});
    const target = path.join(tmp, "personal-like.json");
    fs.writeFileSync(target, "");
    fs.linkSync(target, path.join(claudeProfileDir(control, "reviewer"), CLAUDE_CREDENTIAL_STORE_FILE));
    expect(claudeProfileStatus(control, "reviewer", {env})).toMatchObject({state: "REFUSED", reason: "CREDENTIAL_STORE_NOT_A_REGULAR_FILE"});
    expect(claudeProfileForRun(control, "reviewer", {env})).toMatchObject({ok: false, reason: "CLAUDE_PROFILE_REFUSED:CREDENTIAL_STORE_NOT_A_REGULAR_FILE"});
  });
  it("a credential store that is a symlink (e.g. to the personal store) is REFUSED (skipped when the OS denies symlink creation)", (ctx) => {
    const control = path.join(tmp, "control"), env = fakeHomeEnv(path.join(tmp, "home"));
    ensureClaudeProfile(control, "implementer", {env});
    const target = path.join(tmp, "elsewhere.json");
    fs.writeFileSync(target, "");
    try { fs.symlinkSync(target, path.join(claudeProfileDir(control, "implementer"), CLAUDE_CREDENTIAL_STORE_FILE), "file"); } catch { ctx.skip(); return; }
    expect(claudeProfileStatus(control, "implementer", {env})).toMatchObject({state: "REFUSED", reason: "CREDENTIAL_STORE_NOT_A_REGULAR_FILE"});
    expect(claudeProfileForRun(control, "implementer", {env}).ok).toBe(false);
  });
  it("child env: every inherited CLAUDE_CONFIG_DIR / CLAUDE_SECURESTORAGE_CONFIG_DIR casing is dropped and only the role profile is set", () => {
    const e = withClaudeProfileEnv({PATH: "p", CLAUDE_CONFIG_DIR: "C:/Users/x/.claude", claude_config_dir: "y", Claude_SecureStorage_Config_Dir: "z"}, "D:/uasco/control/claude-profiles/reviewer");
    expect(e).toEqual({PATH: "p", CLAUDE_CONFIG_DIR: "D:/uasco/control/claude-profiles/reviewer"});
    expect(claudeProfileLoginCommand("C:/it's/x")).toBe("$env:CLAUDE_CONFIG_DIR='C:/it''s/x'; claude; Remove-Item Env:\\CLAUDE_CONFIG_DIR");
  });
});

describe("SBX-8 B: GET /v1/system/executors exposes profile status and the Founder login command", () => {
  const call = (app: ReturnType<typeof buildServer>) => app.inject({method: "GET", url: "/v1/system/executors", headers: HDR});
  it("control root outside any work tree -> both profiles LOGIN_REQUIRED with the exact login command; existing executor fields unchanged", async () => {
    const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data"), controlRoot = path.join(tmp, "userdata", "control");
    fs.mkdirSync(runtime, {recursive: true});
    const app = buildServer({controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, controlRoot, port: 3210, logger: false, tenantId: "tA"});
    apps.push(app);
    const j = (await call(app)).json();
    expect(Object.keys(j).sort()).toEqual(["active", "claudeProfiles", "executors", "sandbox"]);
    expect(j.executors.FAKE).toEqual({state: "TEST_ONLY"});
    for (const role of ["implementer", "reviewer"]) {
      const dir = path.join(controlRoot, "claude-profiles", role);
      expect(j.claudeProfiles[role]).toMatchObject({role, dir, state: "LOGIN_REQUIRED", settings: "PRESENT", credentialStore: "ABSENT", loginCommand: claudeProfileLoginCommand(dir)});
      expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
    }
  });
  it("dev control root = repository work tree -> REFUSED, nothing written into the repository", async () => {
    const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
    fs.mkdirSync(runtime, {recursive: true});
    const existed = fs.existsSync(path.join(REPO, "claude-profiles"));
    const app = buildServer({controlToken: TOKEN, runtime, dataDir, repoRoot: REPO, controlRoot: REPO, port: 3210, logger: false, tenantId: "tA"});
    apps.push(app);
    const j = (await call(app)).json();
    for (const role of ["implementer", "reviewer"]) expect(j.claudeProfiles[role]).toMatchObject({state: "REFUSED", reason: "PROFILE_PATH_INSIDE_GIT_WORKTREE", loginCommand: null});
    expect(fs.existsSync(path.join(REPO, "claude-profiles"))).toBe(existed);
  });
});

// //TR: C-IMPL-WIN-1 (test birleştirme): gerçek implementer hazırlığı (Windows dahil) testleri; kayıtlı bir dosyaya taşındı (yeni test dosyası config/validation.json kaydı gerektirirdi). tmp/REPO bu dosyanın başındaki tanımlardır; önceki dosyadaki aynı tanımların yerine geçer.
describe("C-IMPL-WIN-1: finding the Claude Code CLI (Windows semantics, simulated on any host)", () => {
  const WIN = (files: string[], env: Record<string, string>) => detectClaudeCli({platform: "win32", env, isFile: p => files.map(f => f.toLowerCase()).includes(p.toLowerCase())});
  const NPM = "C:\\Users\\f\\AppData\\Roaming\\npm", NATIVE = "C:\\Users\\f\\.local\\bin", OTHER = "C:\\Tools";
  const env = (PATH: string) => ({Path: PATH, UserProfile: "C:\\Users\\f", AppData: "C:\\Users\\f\\AppData\\Roaming"}); // Windows env names are case-insensitive

  it("claude.exe on PATH is found as the first match: nothing needs to be prepended", () => {
    const r = WIN([`${OTHER}\\claude.exe`], env(`C:\\Windows;${OTHER}`));
    expect(r).toMatchObject({state: "FOUND", path: `${OTHER}\\claude.exe`, kind: "EXECUTABLE", source: "PATH", pathDir: null, founderAction: null});
  });

  it("an npm .cmd launcher is refused honestly (the protected capture starts the CLI without a shell, which Windows does not allow for .cmd/.bat)", () => {
    const r = WIN([`${NPM}\\claude.cmd`], env(`C:\\Windows;${NPM}`));
    expect(r).toMatchObject({state: "SHIM_UNSUPPORTED", path: `${NPM}\\claude.cmd`, kind: "CMD", source: "PATH"});
    expect(r.founderAction).toContain(".cmd launcher");
    expect(r.founderAction).toContain(CLAUDE_CLI_INSTALL_HINT);
    expect(WIN([`${NPM}\\claude.bat`], env(NPM)).kind).toBe("BAT");
  });

  it("a real claude.exe behind a .cmd shim on PATH is found, and its folder is prepended so the capture's `where claude` resolves it first", () => {
    const r = WIN([`${NPM}\\claude.cmd`, `${OTHER}\\claude.exe`], env(`${NPM};${OTHER}`));
    expect(r).toMatchObject({state: "FOUND", path: `${OTHER}\\claude.exe`, source: "PATH", pathDir: OTHER});
    const e = withClaudeCliOnPath({Path: `${NPM};${OTHER}`, TEMP: "x"}, r, "win32");
    expect(e.Path).toBe(`${OTHER};${NPM};${OTHER}`); // key spelling kept, Windows separator
    expect(Object.keys(e)).toEqual(["Path", "TEMP"]);
  });

  it("the native install folder is searched even when it is not on PATH (and then prepended for the capture)", () => {
    const r = WIN([`${NATIVE}\\claude.exe`], env("C:\\Windows"));
    expect(r).toMatchObject({state: "FOUND", path: `${NATIVE}\\claude.exe`, source: "WELL_KNOWN", pathDir: NATIVE});
    expect(withClaudeCliOnPath({PATH: "C:\\Windows"}, r, "win32").PATH).toBe(`${NATIVE};C:\\Windows`);
  });

  it("nothing found: NOT_FOUND counts what was searched (the server's PATH folders are NOT part of the status) and tells the Founder what to install", () => {
    const probed: string[] = [];
    const r = detectClaudeCli({platform: "win32", env: env("C:\\Windows;relative\\dir;\"C:\\Quoted\""), isFile: p => { probed.push(p.toLowerCase()); return false; }});
    expect(r.state).toBe("NOT_FOUND");
    expect(r.searchedCount).toBe(5); // C:\Windows, C:\Quoted, the native folder, ~\.claude\local, npm
    expect(Object.keys(r)).not.toContain("searched");
    expect(JSON.stringify(r)).not.toMatch(/Quoted|Windows\\|AppData/); // no folder of the server's PATH leaves through the API
    expect(probed.some(p => p.startsWith("relative"))).toBe(false); // relative PATH entries are never trusted (never even probed)
    expect(probed.some(p => p.startsWith("c:\\quoted\\"))).toBe(true);
    expect(r.founderAction).toContain(CLAUDE_CLI_INSTALL_HINT);
    expect(r.founderAction).toContain("searched 5 folders");
    expect(withClaudeCliOnPath({PATH: "x"}, r, "win32").PATH).toBe("x"); // nothing to prepend
  });

  it("PATHEXT decides what counts: without .cmd in PATHEXT a claude.cmd is not a candidate; the default order is .COM .EXE .BAT .CMD", () => {
    expect(WIN([`${NPM}\\claude.cmd`], {...env(NPM), PATHEXT: ".EXE;.COM"}).state).toBe("NOT_FOUND");
    expect(WIN([`${NPM}\\claude.cmd`, `${NPM}\\claude.exe`], env(NPM))).toMatchObject({state: "FOUND", path: `${NPM}\\claude.exe`});
    expect(WIN([`${NPM}\\claude.cmd`, `${NPM}\\claude.bat`], env(NPM)).kind).toBe("BAT"); // .BAT precedes .CMD in the default PATHEXT
  });

  it("M3: claude.com is an executable launcher (PATHEXT .COM)", () => {
    expect(WIN([`${OTHER}\\claude.com`], env(`C:\\Windows;${OTHER}`))).toMatchObject({state: "FOUND", path: `${OTHER}\\claude.com`, kind: "EXECUTABLE"});
  });

  it("M8: inside ONE folder the first PATHEXT match wins (where.exe order): with .CMD before .EXE a folder holding both is the unsupported shim, not a found CLI", () => {
    const r = WIN([`${OTHER}\\claude.cmd`, `${OTHER}\\claude.exe`], {Path: `C:\\Windows;${OTHER}`, PathExt: ".CMD;.EXE", UserProfile: "C:\\Users\\f", AppData: "C:\\Users\\f\\AppData\\Roaming"});
    expect(r).toMatchObject({state: "SHIM_UNSUPPORTED", kind: "CMD", path: `${OTHER}\\claude.cmd`});
  });

  it("M10: with no PATH at all the CLI's folder becomes the whole PATH (never 'dir;undefined')", () => {
    const found = WIN([`${NATIVE}\\claude.exe`], {UserProfile: "C:\\Users\\f", AppData: "C:\\Users\\f\\AppData\\Roaming"});
    expect(found).toMatchObject({state: "FOUND", pathDir: NATIVE});
    expect(withClaudeCliOnPath({}, found, "win32")).toEqual({PATH: NATIVE});
    expect(withClaudeCliOnPath({Path: "X"}, found, "win32")).toEqual({Path: `${NATIVE};X`});
  });

  it("POSIX hosts: the plain `claude` file on PATH, no well-known folders", () => {
    const r = detectClaudeCli({platform: "linux", env: {PATH: "/usr/bin:/usr/local/bin"}, isFile: p => p === "/usr/local/bin/claude"});
    expect(r).toMatchObject({state: "FOUND", path: "/usr/local/bin/claude", kind: "EXECUTABLE", source: "PATH", pathDir: null});
    expect(detectClaudeCli({platform: "linux", env: {PATH: "/usr/bin"}, isFile: () => false}).state).toBe("NOT_FOUND");
  });
});

describe("C-IMPL-WIN-1: launcher proof, per-role readiness and auth failures", () => {
  const control = () => path.join(tmp, "control");
  const writeProv = (patch: Record<string, unknown> = {}, launcher = path.join(tmp, "claude-launcher.bin")) => {
    if (!fs.existsSync(launcher)) fs.writeFileSync(launcher, "launcher-bytes");
    const sha = crypto.createHash("sha256").update(fs.readFileSync(launcher)).digest("hex");
    fs.mkdirSync(path.join(control(), ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(control(), ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: launcher, launcherSha256: sha, version: "9.9.9"}, ...patch}));
    return launcher;
  };
  const login = (role: "implementer" | "reviewer") => { ensureClaudeProfile(control(), role, {forbiddenRoots: [path.join(tmp, "data")]}); fs.writeFileSync(path.join(claudeProfileDir(control(), role), ".credentials.json"), ""); };
  const FOUND = {state: "FOUND" as const, path: "C:\\x\\claude.exe", kind: "EXECUTABLE" as const, source: "PATH" as const, pathDir: null, searchedCount: 0, founderAction: null};
  const o = {get forbiddenRoots() { return [path.join(tmp, "data")]; }}; // evaluated when spread (tmp is created per test)

  it("claudeLauncherCheck gives one machine-readable code per failure", () => {
    expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "PROVIDER_PROVENANCE_NOT_READY"}); // no provenance file at all
    const launcher = writeProv();
    expect(claudeLauncherCheck(control())).toEqual({ok: true, resolvedPath: launcher});
    writeProv({final: "BLOCKED"}); expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "PROVIDER_PROVENANCE_NOT_READY"});
    writeProv({claude: {provenanceLevel: "LAUNCHER_ONLY", resolvedPath: launcher, launcherSha256: "x"}}); expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_PACKAGE_PROVENANCE_REQUIRED"});
    writeProv({claude: {provenanceLevel: "FULL_PACKAGE", launcherSha256: "x"}}); expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"}); // no resolvedPath
    writeProv({claude: {provenanceLevel: "FULL_PACKAGE", resolvedPath: launcher, launcherSha256: "0".repeat(64)}}); expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"}); // content changed
    writeProv(); fs.rmSync(launcher); expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_CLI_NOT_FOUND"}); // the verified launcher is gone
    fs.writeFileSync(path.join(control(), ".ai", "runtime", "PROVIDER_PROVENANCE.json"), "{not json"); expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "PROVIDER_PROVENANCE_NOT_READY"});
  });

  it("M-228-1: for FULL_PACKAGE the package.json hash is part of the launcher proof (the broker refuses CLAUDE_PACKAGE_PROVENANCE_CHANGED), so readiness says so BEFORE any run", () => {
    const launcher = writeProv(), pkg = path.join(tmp, "package.json"), sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    fs.writeFileSync(pkg, '{"name":"@anthropic-ai/claude-code","version":"1.0.0"}');
    const full = (claude: Record<string, unknown> = {}) => writeProv({claude: {provenanceLevel: "FULL_PACKAGE", resolvedPath: launcher, launcherSha256: sha(launcher), packageJsonPath: pkg, packageJsonSha256: sha(pkg), ...claude}});
    full(); expect(claudeLauncherCheck(control())).toEqual({ok: true, resolvedPath: launcher});
    fs.writeFileSync(pkg, '{"name":"x","version":"2.0.0"}'); // the npm package was changed after it was verified
    expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_PACKAGE_PROVENANCE_CHANGED"});
    login("implementer"); login("reviewer");
    for (const role of ["implementer", "reviewer"] as const) expect(claudeRoleReadiness(control(), role, {...o, cli: FOUND})).toMatchObject({ready: false, blocker: "CLAUDE_PACKAGE_PROVENANCE_CHANGED", founderAction: expect.stringContaining("package.json")});
    fs.rmSync(pkg); // a vanished package.json is a change too (the broker would throw)
    expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_PACKAGE_PROVENANCE_CHANGED"});
    fs.writeFileSync(pkg, "{}"); full({packageJsonSha256: "0".repeat(64)}); // a recorded hash that does not match
    expect(claudeLauncherCheck(control())).toEqual({ok: false, code: "CLAUDE_PACKAGE_PROVENANCE_CHANGED"});
    // nothing recorded / UNKNOWN / the standalone level: nothing to compare (the broker does not compare either)
    full({packageJsonPath: "UNKNOWN"}); expect(claudeLauncherCheck(control())).toEqual({ok: true, resolvedPath: launcher});
    full({packageJsonPath: undefined}); expect(claudeLauncherCheck(control())).toEqual({ok: true, resolvedPath: launcher});
    writeProv(); expect(claudeLauncherCheck(control())).toEqual({ok: true, resolvedPath: launcher});
  });

  it("L4: the same blocker code is listed once (no CLI and a vanished verified launcher is ONE CLAUDE_CLI_NOT_FOUND)", () => {
    const launcher = writeProv(); fs.rmSync(launcher);
    const r = claudeRoleReadiness(control(), "implementer", {...o, cli: {...FOUND, state: "NOT_FOUND", path: null, kind: null, source: null, founderAction: "install it"}});
    expect(r.blockers.filter(b => b === "CLAUDE_CLI_NOT_FOUND")).toHaveLength(1);
    expect(new Set(r.blockers).size).toBe(r.blockers.length);
  });

  it("M2: a signed-in role whose settings.json was modified or removed is NOT ready", () => {
    writeProv(); login("reviewer");
    expect(claudeRoleReadiness(control(), "reviewer", {...o, cli: FOUND})).toMatchObject({ready: true, blockers: []});
    const settings = path.join(claudeProfileDir(control(), "reviewer"), "settings.json");
    fs.writeFileSync(settings, '{"hooks": {"PreToolUse": []}}'); // modified
    const modified = claudeRoleReadiness(control(), "reviewer", {...o, cli: FOUND});
    expect(modified.ready).toBe(false); expect(modified.blocker).toMatch(/^CLAUDE_PROFILE_REFUSED:/);
    fs.rmSync(settings); // removed
    const removed = claudeRoleReadiness(control(), "reviewer", {...o, cli: FOUND});
    expect(removed.ready).toBe(false); expect(removed.blocker).toMatch(/^CLAUDE_PROFILE_REFUSED:/);
  });

  it("claudeRoleReadiness reports every blocker in setup order with the exact action and the Founder's own login command", () => {
    // nothing installed, nothing verified, nobody signed in
    let r = claudeRoleReadiness(control(), "implementer", {...o, cli: {...FOUND, state: "NOT_FOUND", path: null, kind: null, source: null, founderAction: "install it"}});
    expect(r).toMatchObject({ready: false, blockers: ["CLAUDE_CLI_NOT_FOUND", "CLAUDE_PROFILE_LOGIN_REQUIRED"], blocker: "CLAUDE_CLI_NOT_FOUND", founderAction: "install it", profile: "LOGIN_REQUIRED"});
    expect(r.loginCommand).toContain(`CLAUDE_CONFIG_DIR='${claudeProfileDir(control(), "implementer")}'`);
    // a .cmd shim
    r = claudeRoleReadiness(control(), "reviewer", {...o, cli: {...FOUND, state: "SHIM_UNSUPPORTED", kind: "CMD", founderAction: "use claude.exe"}});
    expect(r.blockers[0]).toBe("CLAUDE_CLI_SHIM_UNSUPPORTED");
    // CLI found but never verified
    r = claudeRoleReadiness(control(), "implementer", {...o, cli: FOUND});
    expect(r.blockers).toEqual(["PROVIDER_PROVENANCE_NOT_READY", "CLAUDE_PROFILE_LOGIN_REQUIRED"]);
    expect(r.founderAction).toContain("enable the Claude executor");
    // verified and signed in: ready, per role
    writeProv(); login("implementer");
    expect(claudeRoleReadiness(control(), "implementer", {...o, cli: FOUND})).toMatchObject({ready: true, blockers: [], blocker: null, founderAction: null, profile: "READY"});
    expect(claudeRoleReadiness(control(), "reviewer", {...o, cli: FOUND})).toMatchObject({ready: false, blockers: ["CLAUDE_PROFILE_LOGIN_REQUIRED"]}); // the reviewer profile is separate
    // an already verified launcher is not undone by a PATH miss (the proof names the file)
    expect(claudeRoleReadiness(control(), "implementer", {...o, cli: {...FOUND, state: "NOT_FOUND", path: null}}).ready).toBe(true);
    // a refused profile folder (inside the Work OS data dir) is REFUSED, never a fallback
    const bad = claudeRoleReadiness(control(), "implementer", {forbiddenRoots: [control()], cli: FOUND});
    expect(bad.profile).toBe("REFUSED"); expect(bad.blocker).toMatch(/^CLAUDE_PROFILE_REFUSED:/);
  });

  it("claudeAuthFailure recognises the CLI's own sign-in errors at the start of a line and nothing else", () => {
    for (const l of ["Invalid API key · Please run /login", "OAuth token has expired. Please run /login", "Error: Not logged in · Please run /login", "\u001b[31mPlease run /login\u001b[0m", "authentication_error: invalid x-api-key", "Your session has expired", "API Error: 401 {\"type\":\"authentication_error\"}"]) expect([l, claudeAuthFailure(`noise\n${l}\n`)]).toEqual([l, true]);
    for (const l of ["TypeError: authenticationError is not a function", "the docs say: please run /login to sign in", "log: invalid api key found in config (just text)", "build failed", ""]) expect([l, claudeAuthFailure(l)]).toEqual([l, false]);
    expect(claudeAuthFailure("Please run /login\n" + "x".repeat(9000))).toBe(false); // only the last 8 KiB is inspected
  });
});

describe("C-IMPL-WIN-1: a run refuses with the exact reason, instantly, and never starts a process", () => {
  const setupApp = () => {
    const appRoot = path.join(tmp, "app"), controlRoot = path.join(tmp, "control"), ws = path.join(tmp, "ws");
    for (const f of ["config/execution-backends.json", "config/automation.json", "config/environment-policy.json", "config/builder-execution-policy.json"]) { fs.mkdirSync(path.dirname(path.join(appRoot, f)), {recursive: true}); fs.copyFileSync(path.join(REPO, f), path.join(appRoot, f)); }
    fs.mkdirSync(path.join(appRoot, "scripts"), {recursive: true});
    fs.writeFileSync(path.join(appRoot, "scripts", "claude-builder-broker.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(path.join(tmp, "BROKER_STARTED"))}, "1");\n`); // must never run in these cases
    fs.mkdirSync(ws, {recursive: true});
    const g = (args: string[]) => { const r = spawnGitSync(ws, args); expect(r.status, args.join(" ") + r.stderr).toBe(0); return String(r.stdout).trim(); };
    g(["init", "-q", "-b", "main"]); fs.writeFileSync(path.join(ws, "README.txt"), "base\n"); g(["add", "-A"]); g(["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
    const head = g(["rev-parse", "HEAD"]);
    const spec = {runId: "run_" + "0".repeat(24), missionId: "msn_" + "1".repeat(24), projectId: "prj_" + "2".repeat(24), title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1" as const, cycle: 0, baseSha: head, startSha: head};
    return {appRoot, controlRoot, ws, spec, pair: () => new LocalClaudeExecutors(appRoot, controlRoot, {profile: {forbiddenRoots: [path.join(tmp, "data")]}}).pair()};
  };
  const prov = (controlRoot: string, launcher: string, patch: Record<string, unknown> = {}) => {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(launcher)).digest("hex");
    fs.mkdirSync(path.join(controlRoot, ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(controlRoot, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: launcher, launcherSha256: sha}, ...patch}));
  };

  it("implementer: signed in but the launcher is unverified, changed or gone -> BLOCK reason is the exact code, the broker never starts, no waiting", { timeout: 60_000 }, async () => {
    const a = setupApp();
    ensureClaudeProfile(a.controlRoot, "implementer", {forbiddenRoots: [path.join(tmp, "data")]}); fs.writeFileSync(path.join(claudeProfileDir(a.controlRoot, "implementer"), ".credentials.json"), "");
    const run = async () => { const t0 = Date.now(), r = await a.pair().implementer.implement(a.ws, a.spec, {timeoutMs: 600_000}); expect(Date.now() - t0).toBeLessThan(5_000); return r; };
    expect(await run()).toMatchObject({exitCode: null, blockReason: "PROVIDER_PROVENANCE_NOT_READY", argv: []}); // never verified
    const launcher = path.join(tmp, "launcher.bin"); fs.writeFileSync(launcher, "v1"); prov(a.controlRoot, launcher);
    fs.writeFileSync(launcher, "v2-changed"); expect(await run()).toMatchObject({exitCode: null, blockReason: "CLAUDE_LAUNCHER_PROVENANCE_CHANGED", argv: []});
    fs.rmSync(launcher); expect(await run()).toMatchObject({exitCode: null, blockReason: "CLAUDE_CLI_NOT_FOUND", argv: []});
    expect(fs.existsSync(path.join(tmp, "BROKER_STARTED"))).toBe(false);
  });

  it("implementer: not signed in is still refused FIRST with CLAUDE_PROFILE_LOGIN_REQUIRED (existing contract), whatever the launcher state", { timeout: 60_000 }, async () => {
    const a = setupApp();
    expect(await a.pair().implementer.implement(a.ws, a.spec, {timeoutMs: 600_000})).toMatchObject({exitCode: null, blockReason: "CLAUDE_PROFILE_LOGIN_REQUIRED", argv: []});
  });

  it("reviewer: an unverified or vanished launcher is an INVALID review with the exact code as invalidReason (not a generic failure)", { timeout: 60_000 }, async () => {
    const a = setupApp();
    const review = () => a.pair().reviewer.review(a.ws, {runId: a.spec.runId, missionId: "m", projectId: "p", title: "t", objective: "o", acceptanceCriteria: [], riskLevel: "R1", cycle: 0, baseSha: a.spec.baseSha}, "", {timeoutMs: 10_000});
    let r = await review();
    expect(r).toMatchObject({verdict: "BLOCKED", valid: false, invalidReason: "PROVIDER_PROVENANCE_NOT_READY"}); expect(r.log).toContain("PROVENANCE_REFUSED");
    const launcher = path.join(tmp, "launcher.bin"); fs.writeFileSync(launcher, "v1"); prov(a.controlRoot, launcher); fs.rmSync(launcher);
    r = await review(); expect(r).toMatchObject({valid: false, invalidReason: "CLAUDE_CLI_NOT_FOUND"});
  });

  it("M-228-1 (run): FULL_PACKAGE with a changed package.json -> the implementer is BLOCKED and the reviewer INVALID with the exact code; the broker never starts", { timeout: 60_000 }, async () => {
    const a = setupApp(), launcher = path.join(tmp, "launcher.bin"), pkg = path.join(tmp, "package.json"), sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    fs.writeFileSync(launcher, "v1"); fs.writeFileSync(pkg, '{"version":"1"}');
    prov(a.controlRoot, launcher, {claude: {provenanceLevel: "FULL_PACKAGE", resolvedPath: launcher, launcherSha256: sha(launcher), packageJsonPath: pkg, packageJsonSha256: sha(pkg)}});
    for (const role of ["implementer", "reviewer"] as const) { ensureClaudeProfile(a.controlRoot, role, {forbiddenRoots: [path.join(tmp, "data")]}); fs.writeFileSync(path.join(claudeProfileDir(a.controlRoot, role), ".credentials.json"), ""); }
    fs.writeFileSync(pkg, '{"version":"2"}');
    const p = a.pair();
    expect(await p.implementer.implement(a.ws, a.spec, {timeoutMs: 30_000})).toMatchObject({exitCode: null, blockReason: "CLAUDE_PACKAGE_PROVENANCE_CHANGED", transient: false});
    expect(fs.existsSync(path.join(tmp, "BROKER_STARTED"))).toBe(false);
    const rv = await p.reviewer.review(a.ws, {runId: a.spec.runId, missionId: "m", projectId: "p", title: "t", objective: "o", acceptanceCriteria: [], riskLevel: "R1", cycle: 0, baseSha: a.spec.baseSha}, "", {timeoutMs: 10_000});
    expect(rv).toMatchObject({valid: false, invalidReason: "CLAUDE_PACKAGE_PROVENANCE_CHANGED"});
  });

  it("L1/L2: the reviewer's expired sign-in is never retried (exit 75 too) and is concluded only from a FAILED exit, never from text inside a successful run's output", { timeout: 60_000 }, async () => {
    const a = setupApp(), launcher = path.join(tmp, "launcher.bin"); fs.writeFileSync(launcher, "v1"); prov(a.controlRoot, launcher);
    ensureClaudeProfile(a.controlRoot, "reviewer", {forbiddenRoots: [path.join(tmp, "data")]}); fs.writeFileSync(path.join(claudeProfileDir(a.controlRoot, "reviewer"), ".credentials.json"), "");
    const review = (exitCode: number, stdout: string, stderr: string) => new LocalClaudeExecutors(a.appRoot, a.controlRoot, {profile: {forbiddenRoots: [path.join(tmp, "data")]}, runReviewer: async (argv) => ({argv, exitCode, stdout, stderr, startedAt: "t", endedAt: "t", timedOut: false, aborted: false, spawnError: false})})
      .pair().reviewer.review(a.ws, {runId: a.spec.runId, missionId: "m", projectId: "p", title: "t", objective: "o", acceptanceCriteria: [], riskLevel: "R1", cycle: 0, baseSha: a.spec.baseSha}, "", {timeoutMs: 10_000});
    expect(await review(75, "", "Invalid API key · Please run /login\n")).toMatchObject({valid: false, invalidReason: "CLAUDE_PROFILE_LOGIN_EXPIRED", transient: false}); // 75 normally means "retry"
    expect(await review(1, "", "OAuth token has expired. Please run /login\n")).toMatchObject({valid: false, invalidReason: "CLAUDE_PROFILE_LOGIN_EXPIRED"});
    const ok0 = await review(0, "Invalid API key\nPlease run /login\n", ""); // exit 0, no verdict: the sign-in text came from the reviewed content, not from the CLI
    expect(ok0.valid).toBe(false); expect(ok0.invalidReason).not.toBe("CLAUDE_PROFILE_LOGIN_EXPIRED");
  });

  it("M1: an implementer that exits 0 is never concluded to be signed out from text in its output (the engine commit goes ahead)", { timeout: 60_000 }, async () => {
    const a = setupApp();
    const impl = new EditOnlyImplementer("TEST_IMPL", path.join(a.appRoot, "config", "environment-policy.json"), () => ({argv: [process.execPath, "-e", "console.error('Invalid API key · Please run /login'); require('node:fs').writeFileSync('feature.txt', 'ok\\n')"], env: {PATH: process.env.PATH ?? ""}, input: ""}));
    const r = await impl.implement(a.ws, a.spec, {timeoutMs: 30_000});
    expect(r.exitCode).toBe(0); expect(r.blockReason).toBeUndefined(); expect(r.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("an expired sign-in (credential file present, CLI asks to log in) is CLAUDE_PROFILE_LOGIN_EXPIRED for the implementer and the reviewer, not a retry and not a generic failure", { timeout: 60_000 }, async () => {
    const a = setupApp();
    const expired = "console.error('Invalid API key · Please run /login'); process.exit(75)"; // 75 is in this adapter's transient list: the sign-in error must still not be retried
    const impl = new EditOnlyImplementer("TEST_IMPL", path.join(a.appRoot, "config", "environment-policy.json"), () => ({argv: [process.execPath, "-e", expired], env: {PATH: process.env.PATH ?? ""}, input: ""}), [75]);
    expect(await impl.implement(a.ws, a.spec, {timeoutMs: 30_000})).toMatchObject({exitCode: 75, blockReason: "CLAUDE_PROFILE_LOGIN_EXPIRED", transient: false});
    const other = new EditOnlyImplementer("TEST_IMPL", path.join(a.appRoot, "config", "environment-policy.json"), () => ({argv: [process.execPath, "-e", "console.error('some compiler error'); process.exit(1)"], env: {PATH: process.env.PATH ?? ""}, input: ""}));
    expect((await other.implement(a.ws, a.spec, {timeoutMs: 30_000})).blockReason).toBeUndefined(); // any other failure keeps its old handling
    // reviewer with the same CLI message (injected runner; a verified launcher and a signed-in reviewer profile exist)
    const launcher = path.join(tmp, "launcher.bin"); fs.writeFileSync(launcher, "v1"); prov(a.controlRoot, launcher);
    ensureClaudeProfile(a.controlRoot, "reviewer", {forbiddenRoots: [path.join(tmp, "data")]}); fs.writeFileSync(path.join(claudeProfileDir(a.controlRoot, "reviewer"), ".credentials.json"), "");
    const ex = new LocalClaudeExecutors(a.appRoot, a.controlRoot, {profile: {forbiddenRoots: [path.join(tmp, "data")]}, runReviewer: async (argv) => ({argv, exitCode: 1, stdout: "", stderr: "OAuth token has expired. Please run /login\n", startedAt: "t", endedAt: "t", timedOut: false, aborted: false, spawnError: false})});
    const r = await ex.pair().reviewer.review(a.ws, {runId: a.spec.runId, missionId: "m", projectId: "p", title: "t", objective: "o", acceptanceCriteria: [], riskLevel: "R1", cycle: 0, baseSha: a.spec.baseSha}, "", {timeoutMs: 10_000});
    expect(r).toMatchObject({valid: false, invalidReason: "CLAUDE_PROFILE_LOGIN_EXPIRED"});
  });
});

describe("C-IMPL-WIN-1: the executors status the desktop shows", () => {
  const mk = (extra: Record<string, unknown> = {}) => {
    const repoRoot = path.join(tmp, "app"), controlRoot = path.join(tmp, "control"), dataDir = path.join(tmp, "data");
    fs.mkdirSync(path.join(repoRoot, "config"), {recursive: true}); fs.copyFileSync(path.join(REPO, "config", "environment-policy.json"), path.join(repoRoot, "config", "environment-policy.json"));
    return {controlRoot, setup: new ExecutorSetup({repoRoot, controlRoot, dataDir, envPolicyFile: path.join(repoRoot, "config", "environment-policy.json"), ...extra})};
  };
  const win = (files: string[], PATH: string) => ({platform: "win32" as const, env: {Path: PATH, UserProfile: "C:\\Users\\f", AppData: "C:\\Users\\f\\AppData\\Roaming"}, isFile: (p: string) => files.includes(p)});

  it("status keeps the four state values and adds the CLI detail and each role's readiness; a .cmd shim is CLI_NOT_FOUND with the exact detail", () => {
    const {setup} = mk(win(["C:\\n\\claude.cmd"], "C:\\n"));
    const s = setup.status().LOCAL_CLAUDE;
    expect(s.state).toBe("CLI_NOT_FOUND");
    expect(s.cli).toMatchObject({state: "SHIM_UNSUPPORTED", kind: "CMD"});
    expect(Object.keys(s.readiness)).toEqual(["implementer", "reviewer"]);
    expect(s.readiness.implementer).toMatchObject({ready: false, blocker: "CLAUDE_CLI_SHIM_UNSUPPORTED", profile: "LOGIN_REQUIRED"});
    expect(s.readiness.implementer.loginCommand).toContain("claude;");
    const found = mk(win(["C:\\n\\claude.exe"], "C:\\n")).setup.status().LOCAL_CLAUDE;
    expect(found).toMatchObject({state: "PROVENANCE_MISSING", cli: {state: "FOUND", path: "C:\\n\\claude.exe"}});
  });

  it("enabling with a .cmd shim is refused with CLI_SHIM_UNSUPPORTED (and a missing CLI with CLI_NOT_FOUND); nothing is captured or saved", async () => {
    const calls: number[] = [];
    const captureProvenance = async () => { calls.push(1); return {ok: true}; };
    const shim = await mk({...win(["C:\\n\\claude.cmd"], "C:\\n"), captureProvenance}).setup.enableLocalClaude("FOUNDER");
    expect(shim).toMatchObject({ok: false, reason: "CLI_SHIM_UNSUPPORTED"});
    const none = await mk({...win([], "C:\\n"), captureProvenance}).setup.enableLocalClaude("FOUNDER");
    expect(none).toMatchObject({ok: false, reason: "CLI_NOT_FOUND"});
    expect(calls).toEqual([]);
  });

  it("the provenance capture runs with the CLI's folder at the FRONT of its PATH when the CLI is only in a known install folder", async () => {
    const NATIVE = "C:\\Users\\f\\.local\\bin", seen = path.join(tmp, "captured-path.txt");
    const s = mk({...win([`${NATIVE}\\claude.exe`], "C:\\Windows")});
    const script = path.join(tmp, "app", "scripts", "capture-provider-provenance.mjs");
    fs.mkdirSync(path.dirname(script), {recursive: true});
    fs.writeFileSync(script, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(seen)}, process.env.PATH ?? process.env.Path ?? "");\n`); // stands in for the protected capture: records the PATH it was given, then fails
    const r = await s.setup.enableLocalClaude("FOUNDER");
    expect(r).toMatchObject({ok: false, reason: "PROVENANCE_CAPTURE_FAILED"});
    expect(fs.readFileSync(seen, "utf8").startsWith(`${NATIVE};`)).toBe(true);
  });

  const signedIn = (controlRoot: string, launcher: string) => {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(launcher)).digest("hex");
    fs.mkdirSync(path.join(controlRoot, ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(controlRoot, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", capturedAt: "2026-10-26T00:00:00.000Z", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: launcher, launcherSha256: sha, version: "9.9.9"}}));
    for (const role of ["implementer", "reviewer"] as const) { ensureClaudeProfile(controlRoot, role, {forbiddenRoots: [path.join(tmp, "data")]}); fs.writeFileSync(path.join(claudeProfileDir(controlRoot, role), ".credentials.json"), ""); }
  };

  it("L3: per-role readiness is NOT ready while the executor is not enabled (EXECUTOR_NOT_ENABLED comes after the CLI/launcher/sign-in blockers); enabling makes it ready", async () => {
    const launcher = path.join(tmp, "claude-launcher.bin"); fs.writeFileSync(launcher, "x");
    const none = mk({...win([], "C:\\n")}).setup.status().LOCAL_CLAUDE.readiness.implementer; // nothing installed, verified or signed in (own control root: taken BEFORE the signed-in setup below shares this test's tmp)
    expect(none.blockers[0]).toBe("CLAUDE_CLI_NOT_FOUND"); expect(none.blockers[none.blockers.length - 1]).toBe("EXECUTOR_NOT_ENABLED"); // the other blockers still come first
    const {setup, controlRoot} = mk({...win(["C:\\n\\claude.exe"], "C:\\n"), captureProvenance: async () => ({ok: true})});
    signedIn(controlRoot, launcher);
    const before = setup.status().LOCAL_CLAUDE;
    expect(before.state).toBe("NOT_CONFIGURED");
    for (const role of ["implementer", "reviewer"] as const) expect(before.readiness[role]).toMatchObject({ready: false, blockers: ["EXECUTOR_NOT_ENABLED"], blocker: "EXECUTOR_NOT_ENABLED", founderAction: expect.stringContaining("Settings")});
    expect((await setup.enableLocalClaude("FOUNDER")).ok).toBe(true);
    const after = setup.status().LOCAL_CLAUDE;
    expect(after.state).toBe("READY");
    for (const role of ["implementer", "reviewer"] as const) expect(after.readiness[role]).toMatchObject({ready: true, blockers: [], blocker: null});
  });

  it("L5: one status() hashes the launcher once, and the cli detail carries a folder count but no listing of the server's PATH", () => {
    const launcher = path.join(tmp, "claude-launcher.bin"); fs.writeFileSync(launcher, "x");
    const {setup, controlRoot} = mk({...win(["C:\\n\\claude.exe"], "C:\\Windows;C:\\n")});
    signedIn(controlRoot, launcher);
    const read = vi.spyOn(fs, "readFileSync");
    const s = setup.status().LOCAL_CLAUDE;
    expect(read.mock.calls.filter(c => String(c[0]) === launcher), "the launcher was read more than once for one status()").toHaveLength(1);
    read.mockRestore();
    expect(s.state).toBe("NOT_CONFIGURED");
    expect(Object.keys(s.cli)).not.toContain("searched");
    expect(s.cli.searchedCount).toBe(5); // C:\\Windows, C:\\n and the three well-known folders
    expect(JSON.stringify(s.cli)).not.toContain("Windows");
  });

  it("the provenance capture child gets the deterministic env allow-list: provider keys and arbitrary variables of the host are NOT passed on", async () => {
    const seen = path.join(tmp, "captured-env.json");
    const s = mk({...win(["C:\\n\\claude.exe"], "C:\\n")});
    const script = path.join(tmp, "app", "scripts", "capture-provider-provenance.mjs");
    fs.mkdirSync(path.dirname(script), {recursive: true});
    fs.writeFileSync(script, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.keys(process.env)));\n`);
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-provider-value"); vi.stubEnv("UASCO_PROBE_SECRET", "x"); vi.stubEnv("GITHUB_TOKEN", "fake-token-value");
    try { await s.setup.enableLocalClaude("FOUNDER"); } finally { vi.unstubAllEnvs(); }
    const keys = JSON.parse(fs.readFileSync(seen, "utf8")) as string[];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of ["ANTHROPIC_API_KEY", "UASCO_PROBE_SECRET", "GITHUB_TOKEN"]) expect(keys, k).not.toContain(k);
  });

  it("an injected finder (the existing test hook) still decides: found -> FOUND, absent -> NOT_FOUND", () => {
    expect(mk({findClaudeCli: () => "/x/claude"}).setup.status().LOCAL_CLAUDE.cli).toMatchObject({state: "FOUND", path: "/x/claude"});
    expect(mk({findClaudeCli: () => null}).setup.status().LOCAL_CLAUDE).toMatchObject({state: "CLI_NOT_FOUND", cli: {state: "NOT_FOUND"}});
  });
});
