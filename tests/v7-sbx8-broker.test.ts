// //TR: Bu test SBX-8 C'yi doğrular: builder broker'ı Claude'u --setting-sources user, --strict-mcp-config, --disable-slash-commands, --no-session-persistence ve CLAUDE_CONFIG_DIR=<kontrol kökü>/claude-profiles/implementer ile başlatır; devralınan CLAUDE_CONFIG_DIR atılır;
// //TR: profil oturum açılmamışsa BLOCKED CLAUDE_PROFILE_LOGIN_REQUIRED (kişisel profile geri düşüş yok), kişisel ~/.claude veya git çalışma ağacındaki profil BLOCKED CLAUDE_PROFILE_REFUSED. Sahte launcher node.exe'dir; gerçek Claude CLI ve kişisel profil kullanılmaz.
import {describe, it, expect, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {BROKER_ISOLATION_FLAGS, brokerPlan, builderArgs, implementerProfileBlock, implementerProfileDir, profilePathRefusal, profileSettingsValid, withProfileEnv} from "../scripts/claude-builder-broker.mjs";
import {CLAUDE_CREDENTIAL_STORE_FILE, ensureClaudeProfile} from "../core/workos/claude-profiles.js";

const REPO = path.resolve(import.meta.dirname, "..");
const BROKER = path.join(REPO, "scripts", "claude-builder-broker.mjs");
const node = process.execPath, sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const nodeVersion = String(cp.spawnSync(node, ["--version"], {encoding: "utf8"}).stdout).trim();
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) { try { fs.rmSync(r, {recursive: true, force: true}); } catch { /* Windows */ } } });
const temp = () => { const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx8-brk-")); roots.push(d); return d; };
function control(at: string): string {
  fs.mkdirSync(path.join(at, "config"), {recursive: true});
  fs.mkdirSync(path.join(at, ".ai", "runtime"), {recursive: true});
  for (const f of ["automation.json", "environment-policy.json", "builder-execution-policy.json"]) fs.copyFileSync(path.join(REPO, "config", f), path.join(at, "config", f));
  fs.writeFileSync(path.join(at, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: node, launcherSha256: sha(node), version: nodeVersion, packageJsonPath: "NOT_APPLICABLE_STANDALONE_LAUNCHER", packageJsonSha256: "NOT_APPLICABLE_STANDALONE_LAUNCHER"}}));
  return at;
}
// Sahte ev dizini: alt süreç os.homedir() için USERPROFILE/HOME'u kullanır; gerçek kişisel profil hiç devreye girmez.
const run = (root: string, home: string, extra: Record<string, string> = {}) =>
  cp.spawnSync(node, [BROKER], {cwd: root, input: "prompt", encoding: "utf8", env: {PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", USERPROFILE: home, HOME: home, UASCO_CONTROL_ROOT: root, ...extra}, timeout: 60_000});

describe("SBX-8 C: builder broker isolation flags and implementer profile", () => {
  it("argv keeps the policy tool restriction and adds the four isolation flags (all documented in the installed CLI 2.1.292 --help)", () => {
    const pol = JSON.parse(fs.readFileSync(path.join(REPO, "config", "builder-execution-policy.json"), "utf8"));
    const a = builderArgs(pol);
    expect(BROKER_ISOLATION_FLAGS).toEqual(["--setting-sources", "user", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]);
    expect(a.slice(0, 7)).toEqual(["-p", "--permission-mode", pol.permissionMode, "--tools", pol.allowedTools.join(","), "--disallowedTools", [...pol.disallowedTools, ...pol.disallowedToolPatterns].join(",")]);
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("user");
    for (const f of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) expect(a).toContain(f);
    expect(a.slice(-2)).toEqual(["--output-format", "text"]);
    expect(a).not.toContain("--mcp-config");
    expect(a.join(" ")).not.toMatch(/project|local|bypassPermissions|dangerously/);
  });
  it("plan env: CLAUDE_CONFIG_DIR is the implementer profile under the control root; an inherited CLAUDE_CONFIG_DIR (personal) is dropped", () => {
    const root = control(temp()), prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), "personal-like", ".claude");
    try {
      const p = brokerPlan(root);
      expect(p.profile).toBe(path.join(root, "claude-profiles", "implementer"));
      expect(p.profile).toBe(implementerProfileDir(root));
      expect(p.env.CLAUDE_CONFIG_DIR).toBe(p.profile);
      expect(Object.keys(p.env).filter(k => k.toUpperCase() === "CLAUDE_CONFIG_DIR")).toEqual(["CLAUDE_CONFIG_DIR"]);
      expect(p.args).toEqual(expect.arrayContaining(BROKER_ISOLATION_FLAGS));
    } finally { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
    expect(withProfileEnv({claude_config_dir: "x", CLAUDE_SECURESTORAGE_CONFIG_DIR: "y", A: "1"}, "P")).toEqual({A: "1", CLAUDE_CONFIG_DIR: "P"});
  });
  it("LOGIN_REQUIRED: settings present but no credential store -> exit 3 BROKER_BLOCKED CLAUDE_PROFILE_LOGIN_REQUIRED, launcher never spawned for the task, no fallback to a personal profile that has credentials", () => {
    const base = temp(), home = path.join(base, "home"), root = control(path.join(base, "userdata", "control"));
    fs.mkdirSync(path.join(home, ".claude"), {recursive: true});
    fs.writeFileSync(path.join(home, ".claude", CLAUDE_CREDENTIAL_STORE_FILE), "");
    expect(ensureClaudeProfile(root, "implementer", {env: {USERPROFILE: home, HOME: home}}).state).toBe("LOGIN_REQUIRED");
    const r = run(root, home, {CLAUDE_CONFIG_DIR: path.join(home, ".claude")});
    expect(r.status, r.stderr).toBe(3);
    expect(r.stderr).toContain("BROKER_BLOCKED CLAUDE_PROFILE_LOGIN_REQUIRED");
    expect(r.stderr).not.toContain("bad option");
    expect(fs.readdirSync(implementerProfileDir(root))).toEqual(["settings.json"]);
  });
  it("missing or hook-bearing profile settings are refused before any task spawn", () => {
    const base = temp(), home = path.join(base, "home"), root = control(path.join(base, "control"));
    expect(run(root, home).stderr).toContain("BROKER_BLOCKED CLAUDE_PROFILE_SETTINGS_MISSING");
    const dir = implementerProfileDir(root);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, CLAUDE_CREDENTIAL_STORE_FILE), "");
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({disableAllHooks: true, hooks: {SessionStart: []}, permissions: {deny: ["Bash", "PowerShell", "WebFetch", "WebSearch"]}}));
    const r = run(root, home);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("BROKER_BLOCKED CLAUDE_PROFILE_SETTINGS_INVALID");
    expect(implementerProfileBlock(dir, {USERPROFILE: home, HOME: home})).toBe("CLAUDE_PROFILE_SETTINGS_INVALID");
  });
  it("RV-SBX8-C1-F2: strict key allowlist refuses settings with any extra key the old denylist missed, accepts only the canonical shape", () => {
    const base = temp(), home = path.join(base, "home"), root = control(path.join(base, "control"));
    ensureClaudeProfile(root, "implementer", {env: {USERPROFILE: home, HOME: home}});
    const dir = implementerProfileDir(root), canonical = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
    expect(profileSettingsValid(canonical)).toBe(true);
    // Eski denylist yalnız üst düzey hooks/mcpServers/statusLine/apiKeyHelper/env'i reddediyordu; bu anahtarların hiçbiri aşağıda yok, yine de hepsi GEÇERSIZ olmalı (katı allowlist).
    for (const extra of [{...canonical, model: "claude-x"}, {...canonical, includeCoAuthoredBy: false}, {...canonical, cleanupPeriodDays: 0},
      {...canonical, permissions: {...canonical.permissions, allow: ["Bash"]}}, {...canonical, permissions: {...canonical.permissions, defaultMode: "bypassPermissions"}}])
      expect(profileSettingsValid(extra), JSON.stringify(extra).slice(0, 80)).toBe(false);
    // Kanonik anahtar eksikse de geçersiz.
    const {enableAllProjectMcpServers: _drop, ...noMcp} = canonical;
    expect(profileSettingsValid(noMcp)).toBe(false);
    // Diske yazılan böyle bir ayar broker tarafından herhangi bir spawn'dan önce reddedilir.
    fs.writeFileSync(path.join(dir, CLAUDE_CREDENTIAL_STORE_FILE), "");
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({...canonical, permissions: {...canonical.permissions, allow: ["Bash"]}}));
    const r = run(root, home);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("BROKER_BLOCKED CLAUDE_PROFILE_SETTINGS_INVALID");
  });
  it("control root inside the personal ~/.claude or inside a git work tree -> BROKER_BLOCKED CLAUDE_PROFILE_REFUSED, nothing spawned", () => {
    const base = temp(), home = path.join(base, "home");
    const inPersonal = control(path.join(home, ".claude", "uasco-control"));
    const r1 = run(inPersonal, home);
    expect(r1.status).toBe(3);
    expect(r1.stderr).toContain("BROKER_BLOCKED CLAUDE_PROFILE_REFUSED:PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG");
    expect(r1.stderr).not.toContain("bad option");
    const wt = path.join(base, "repo");
    fs.mkdirSync(path.join(wt, ".git"), {recursive: true});
    const r2 = run(control(wt), home);
    expect(r2.stderr).toContain("BROKER_BLOCKED CLAUDE_PROFILE_REFUSED:PROFILE_PATH_INSIDE_GIT_WORKTREE");
    expect(profilePathRefusal(path.join(os.homedir(), ".claude", "x"))).toBe("PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG");
  });
  it("a logged-in UASCO implementer profile (placeholder store) lets the broker reach the launcher spawn (node rejects the first Claude flag)", () => {
    const base = temp(), home = path.join(base, "home"), root = control(path.join(base, "control"));
    ensureClaudeProfile(root, "implementer", {env: {USERPROFILE: home, HOME: home}});
    fs.writeFileSync(path.join(implementerProfileDir(root), CLAUDE_CREDENTIAL_STORE_FILE), "");
    const r = run(root, home);
    expect(r.stderr).not.toContain("BROKER_BLOCKED");
    expect(r.stderr).toContain("bad option: --permission-mode");
  });
  it("importing the broker module does not run it (only node/fork script execution does)", () => {
    expect(typeof brokerPlan).toBe("function");
  });
});
