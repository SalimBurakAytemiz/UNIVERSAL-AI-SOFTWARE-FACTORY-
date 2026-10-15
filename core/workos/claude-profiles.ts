// //TR: Bu dosya D-SBX-11 (b) kararıyla UASCO'ya özel, Founder'ın kişisel Claude kurulumundan ayrı iki Claude profilini (CLAUDE_CONFIG_DIR) yönetir: implementer ve salt-okunur reviewer.
// //TR: UASCO profil dizinine YALNIZ kendi settings.json dosyasını yazar (hook/MCP/statusLine/apiKeyHelper yok, araç yasakları); kimlik bilgisi asla kopyalanmaz ve okunmaz (yalnız varlık kontrolü).
// //TR: Kişisel %USERPROFILE%/.claude ve %USERPROFILE%/.claude.json içerik için okunmaz, silinmez, üzerine yazılmaz; profil yolu bunların içine/üzerine, ev dizinine, proje çalışma alanına veya bir git çalışma ağacına düşerse reddedilir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export type ClaudeProfileRole = "implementer" | "reviewer";
export const CLAUDE_PROFILE_ROLES: readonly ClaudeProfileRole[] = ["implementer", "reviewer"];
export const CLAUDE_PROFILES_DIRNAME = "claude-profiles";
// Kurulu Claude CLI 2.1.292 metninden (salt okunur): kimlik deposu <config dir>/.credentials.json; global hook kapatma ayarı disableAllHooks.
export const CLAUDE_CREDENTIAL_STORE_FILE = ".credentials.json";
export const CLAUDE_HOOK_KILL_SWITCH = "disableAllHooks";
export const CLAUDE_PROFILE_SETTINGS_FILE = "settings.json";
// Her iki rol: komut/kod çalıştıran, ağa çıkan, alt ajan/skill başlatan araçlar yasak. Reviewer ek olarak dosya yazamaz.
export const CLAUDE_PROFILE_DENY_BOTH = ["Bash", "PowerShell", "WebFetch", "WebSearch", "NotebookEdit", "Agent", "Task", "Skill"] as const;
export const CLAUDE_PROFILE_DENY_REVIEWER_EXTRA = ["Edit", "Write", "MultiEdit"] as const;

export type ClaudeProfileState = "READY" | "LOGIN_REQUIRED" | "REFUSED";
export interface ClaudeProfileStatus {
  role: ClaudeProfileRole; dir: string; state: ClaudeProfileState; reason?: string;
  settings: "PRESENT" | "MISSING" | "MODIFIED"; credentialStore: "PRESENT" | "ABSENT";
  loginCommand: string | null; loginHint: string | null;
}
export interface ClaudeProfileOptions { env?: NodeJS.ProcessEnv; forbiddenRoots?: string[] }

export function claudeProfilesRoot(controlRoot: string): string { return path.join(path.resolve(controlRoot), CLAUDE_PROFILES_DIRNAME); }
export function claudeProfileDir(controlRoot: string, role: ClaudeProfileRole): string {
  if (!CLAUDE_PROFILE_ROLES.includes(role)) throw new Error("CLAUDE_PROFILE_ROLE_INVALID");
  return path.join(claudeProfilesRoot(controlRoot), role);
}

const isWin = process.platform === "win32";
// Var olan en yakın ata realpath ile açılır (junction/8.3 kısa ad), kalan segmentler eklenir; Windows'ta büyük/küçük harf duyarsız karşılaştırma.
function canonical(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try { cur = fs.realpathSync.native(cur); break; } catch { /* yok */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur)); cur = parent;
  }
  const out = path.join(cur, ...rest);
  return isWin ? out.toLowerCase() : out;
}
function inside(parent: string, child: string): boolean { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); }

// Founder'ın kişisel Claude kurulumu: her olası ev dizini için <home>/.claude (dizin) ve <home>/.claude.json (global config).
export function personalClaudeLocations(env: NodeJS.ProcessEnv = process.env): {homes: string[]; dirs: string[]; files: string[]} {
  const homes = [...new Set([env.USERPROFILE, env.HOME, os.homedir()].filter((h): h is string => typeof h === "string" && h !== "" && path.isAbsolute(h)).map(h => path.resolve(h)))];
  return {homes, dirs: homes.map(h => path.join(h, ".claude")), files: homes.map(h => path.join(h, ".claude.json"))};
}

// Profil yolu reddi (null = izinli). Kişisel .claude'a eşit/içinde, ev dizinine eşit (<home>/.claude.json kişisel dosyadır), yasak köklerin (Work OS proje/run çalışma alanları) içinde veya bir git çalışma ağacında olamaz.
export function claudeProfilePathRefusal(dir: string, o: ClaudeProfileOptions = {}): string | null {
  if (typeof dir !== "string" || !dir || !path.isAbsolute(dir)) return "PROFILE_PATH_NOT_ABSOLUTE";
  const c = canonical(dir), personal = personalClaudeLocations(o.env ?? process.env);
  if (personal.dirs.some(d => inside(canonical(d), c))) return "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG";
  if (personal.files.some(f => canonical(f) === c)) return "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG";
  if (personal.homes.some(h => canonical(h) === c)) return "PROFILE_PATH_IS_HOME_DIRECTORY";
  if ((o.forbiddenRoots ?? []).some(r => typeof r === "string" && r !== "" && inside(canonical(r), c))) return "PROFILE_PATH_INSIDE_PROJECT_WORKSPACE";
  for (let cur = path.resolve(dir); ; cur = path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, ".git"))) return "PROFILE_PATH_INSIDE_GIT_WORKTREE";
    if (path.dirname(cur) === cur) break;
  }
  return null;
}

// "//c/Users/x" biçimi: Claude izin kurallarında dosya sistemi kökünden mutlak yol.
function permissionPath(abs: string): string {
  const p = path.resolve(abs).replace(/\\/g, "/");
  const m = /^([A-Za-z]):\/?(.*)$/.exec(p);
  return m ? `//${m[1].toLowerCase()}/${m[2]}`.replace(/\/+$/, "") : `/${p}`.replace(/\/+$/, "");
}

// UASCO'nun profil başına yazdığı TEK dosya. Bilinmeyen anahtar yok (CLI ayar doğrulaması dosyayı yok saymasın diye yorum anahtarı da yok).
export function claudeProfileSettings(role: ClaudeProfileRole, controlRoot: string): Record<string, unknown> {
  const profiles = permissionPath(claudeProfilesRoot(controlRoot));
  const tools = [...CLAUDE_PROFILE_DENY_BOTH, ...(role === "reviewer" ? CLAUDE_PROFILE_DENY_REVIEWER_EXTRA : [])];
  const paths = [`Read(~/.claude/**)`, `Read(~/.claude.json)`, `Read(${profiles}/**)`, `Edit(~/.claude/**)`, `Edit(~/.claude.json)`, `Edit(${profiles}/**)`];
  return {[CLAUDE_HOOK_KILL_SWITCH]: true, enableAllProjectMcpServers: false, permissions: {deny: [...tools, ...paths], disableBypassPermissionsMode: "disable"}};
}
export function claudeProfileSettingsBytes(role: ClaudeProfileRole, controlRoot: string): Buffer {
  return Buffer.from(JSON.stringify(claudeProfileSettings(role, controlRoot), null, 2) + "\n", "utf8");
}

// Founder'ın kendisi çalıştırır (UASCO asla oturum açmaz): yalnız bu PowerShell penceresi için CLAUDE_CONFIG_DIR ayarlanır, claude başlatılır, çıkışta değişken kaldırılır.
export function claudeProfileLoginCommand(dir: string): string {
  return `$env:CLAUDE_CONFIG_DIR='${dir.replace(/'/g, "''")}'; claude; Remove-Item Env:\\CLAUDE_CONFIG_DIR`;
}
export const CLAUDE_PROFILE_LOGIN_HINT = "Run the command in a new PowerShell window, type /login inside Claude and sign in, then /exit. UASCO never logs in for you and never copies your personal Claude credentials.";

function settingsState(file: string, expected: Buffer): "PRESENT" | "MISSING" | "MODIFIED" {
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch { return "MISSING"; }
  if (!st.isFile()) return "MODIFIED";
  try { return fs.readFileSync(file).equals(expected) ? "PRESENT" : "MODIFIED"; } catch { return "MODIFIED"; }
}
// Kimlik deposu yalnız lstat ile kontrol edilir (içerik asla okunmaz); symlink/junction ve sabit bağlantı (nlink>1) kabul edilmez (kişisel kimliğe bağlanamaz).
function credentialState(dir: string): {present: boolean; refusal?: string} {
  let st: fs.Stats;
  try { st = fs.lstatSync(path.join(dir, CLAUDE_CREDENTIAL_STORE_FILE)); } catch { return {present: false}; }
  if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) return {present: false, refusal: "CREDENTIAL_STORE_NOT_A_REGULAR_FILE"};
  return {present: true};
}
function dirRefusal(dir: string, o: ClaudeProfileOptions): string | null {
  const r = claudeProfilePathRefusal(dir, o);
  if (r) return r;
  try { if (fs.lstatSync(dir).isSymbolicLink()) return "PROFILE_PATH_IS_LINK"; } catch { /* henüz yok */ }
  return null;
}

// Salt-okunur durum (hiçbir dosya yazılmaz).
export function claudeProfileStatus(controlRoot: string, role: ClaudeProfileRole, o: ClaudeProfileOptions = {}): ClaudeProfileStatus {
  const dir = claudeProfileDir(controlRoot, role), refusal = dirRefusal(dir, o);
  if (refusal) return {role, dir, state: "REFUSED", reason: refusal, settings: "MISSING", credentialStore: "ABSENT", loginCommand: null, loginHint: null};
  const settings = settingsState(path.join(dir, CLAUDE_PROFILE_SETTINGS_FILE), claudeProfileSettingsBytes(role, controlRoot));
  const cred = credentialState(dir);
  if (cred.refusal) return {role, dir, state: "REFUSED", reason: cred.refusal, settings, credentialStore: "ABSENT", loginCommand: null, loginHint: null};
  return {role, dir, state: cred.present ? "READY" : "LOGIN_REQUIRED", ...(cred.present ? {} : {reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"}), settings, credentialStore: cred.present ? "PRESENT" : "ABSENT",
    loginCommand: claudeProfileLoginCommand(dir), loginHint: CLAUDE_PROFILE_LOGIN_HINT};
}

// Profil dizinini kurar ve UASCO'nun settings.json dosyasını (farklıysa) atomik yazar; başka hiçbir dosyaya dokunmaz. Yol reddedilirse hiçbir şey yazılmaz.
export function ensureClaudeProfile(controlRoot: string, role: ClaudeProfileRole, o: ClaudeProfileOptions = {}): ClaudeProfileStatus {
  const dir = claudeProfileDir(controlRoot, role);
  const before = dirRefusal(dir, o);
  if (before) return claudeProfileStatus(controlRoot, role, o);
  fs.mkdirSync(dir, {recursive: true});
  // mkdir sonrası yeniden doğrulama: ara dizinlerden biri kişisel kuruluma giden bir junction ise yazılmaz.
  if (dirRefusal(dir, o)) return claudeProfileStatus(controlRoot, role, o);
  const file = path.join(dir, CLAUDE_PROFILE_SETTINGS_FILE), bytes = claudeProfileSettingsBytes(role, controlRoot);
  if (settingsState(file, bytes) !== "PRESENT") {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, bytes, {flag: "wx"});
    fs.renameSync(tmp, file);
  }
  return claudeProfileStatus(controlRoot, role, o);
}
export function ensureClaudeProfiles(controlRoot: string, o: ClaudeProfileOptions = {}): Record<ClaudeProfileRole, ClaudeProfileStatus> {
  return {implementer: ensureClaudeProfile(controlRoot, "implementer", o), reviewer: ensureClaudeProfile(controlRoot, "reviewer", o)};
}

// Çalıştırma öncesi kapı: profil hazırlanır; READY değilse (oturum açılmamış/yol reddi) neden döner — kişisel profile asla geri düşülmez.
export function claudeProfileForRun(controlRoot: string, role: ClaudeProfileRole, o: ClaudeProfileOptions = {}): {ok: true; dir: string} | {ok: false; reason: string; status: ClaudeProfileStatus} {
  const s = ensureClaudeProfile(controlRoot, role, o);
  if (s.state === "READY" && s.settings === "PRESENT") return {ok: true, dir: s.dir};
  if (s.state === "LOGIN_REQUIRED") return {ok: false, reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", status: s};
  return {ok: false, reason: `CLAUDE_PROFILE_REFUSED:${s.reason ?? (s.settings !== "PRESENT" ? "SETTINGS_NOT_WRITTEN" : "UNKNOWN")}`, status: s};
}

// Çocuk süreç env'i: devralınan her CLAUDE_CONFIG_DIR / CLAUDE_SECURESTORAGE_CONFIG_DIR (her harf biçimi) atılır, yalnız rol profili ayarlanır.
export function withClaudeProfileEnv(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) { const u = k.toUpperCase(); if (u === "CLAUDE_CONFIG_DIR" || u === "CLAUDE_SECURESTORAGE_CONFIG_DIR") continue; out[k] = v; }
  out.CLAUDE_CONFIG_DIR = dir;
  return out;
}
