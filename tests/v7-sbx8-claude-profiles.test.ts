// //TR: Bu test SBX-8 B'yi (D-SBX-11 b) doğrular: implementer/reviewer UASCO Claude profilleri kontrol kökü altında ayrı dizinlerdir; UASCO yalnız kendi settings.json dosyasını yazar (hook/MCP/statusLine/apiKeyHelper yok, araç yasakları, reviewer ek olarak yazamaz), kimlik deposu yalnız varlıkla kontrol edilir (yoksa LOGIN_REQUIRED),
// //TR: kişisel ~/.claude, ev dizini, proje çalışma alanı ve git çalışma ağacı içindeki profil yolları reddedilir ve hiçbir şey yazılmaz; GET /v1/system/executors durum ve Founder giriş komutunu döner. Gerçek Claude CLI çalıştırılmaz; kişisel profil okunmaz.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  CLAUDE_CREDENTIAL_STORE_FILE, CLAUDE_PROFILE_DENY_BOTH, CLAUDE_PROFILE_DENY_REVIEWER_EXTRA, claudeProfileDir, claudeProfileForRun, claudeProfileLoginCommand, claudeProfilePathRefusal,
  claudeProfileSettings, claudeProfileStatus, ensureClaudeProfile, ensureClaudeProfiles, withClaudeProfileEnv
} from "../core/workos/claude-profiles.js";
import {buildServer} from "../apps/control-api/src/server.js";

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
