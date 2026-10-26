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
// Her Claude çağrısında (builder broker'ı ve reviewer) zorunlu yalıtım bayrakları; kurulu CLI 2.1.292 --help çıktısında dördü de belgelidir. scripts/claude-builder-broker.mjs BROKER_ISOLATION_FLAGS ile aynı olmalıdır (test).
export const CLAUDE_ISOLATION_FLAGS = ["--setting-sources", "user", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"] as const;
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

// ---- C-IMPL-WIN-1: Claude Code CLI keşfi, başlatıcı kanıtı ve rol başına tam hazırlık ----
// //TR: Paketli Windows uygulaması CLI'yi PATH'ten VE bilinen kurulum dizinlerinden arar. Provenance yakalama (korumalı scripts/capture-provider-provenance.mjs) `where claude` ile ilk eşleşmeyi alıp kabuksuz çalıştırır: .cmd/.bat başlatıcı kabuksuz başlatılamaz (Node EINVAL), bu yüzden SHIM_UNSUPPORTED dürüstçe bildirilir. Bulunan çalıştırılabilir PATH'te değilse/gölgelenmişse `pathDir` yakalama alt sürecinin PATH'inin BAŞINA eklenir.
export type ClaudeCliState = "FOUND" | "NOT_FOUND" | "SHIM_UNSUPPORTED";
export interface ClaudeCliStatus {
  state: ClaudeCliState; path: string | null; kind: "EXECUTABLE" | "CMD" | "BAT" | null; source: "PATH" | "WELL_KNOWN" | null;
  // yakalama alt sürecinin PATH'inin başına eklenecek dizin (CLI PATH'te ilk eşleşme değilse); yoksa null
  pathDir: string | null; searched: string[]; founderAction: string | null;
}
export interface ClaudeCliOptions { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; isFile?: (p: string) => boolean }
export const CLAUDE_CLI_INSTALL_HINT = "Install the native Claude Code for Windows (it provides claude.exe), for example in PowerShell: irm https://claude.ai/install.ps1 | iex (check Anthropic's current install instructions), then restart UASCO.";

export function detectClaudeCli(o: ClaudeCliOptions = {}): ClaudeCliStatus {
  const env = o.env ?? process.env, platform = o.platform ?? process.platform, win = platform === "win32", P = win ? path.win32 : path.posix;
  const get = (n: string): string | undefined => { for (const [k, v] of Object.entries(env)) if (win ? k.toUpperCase() === n : k === n) return v; return undefined; };
  const isFile = o.isFile ?? ((f: string) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  const exts = win ? (get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").map(e => e.trim().toLowerCase()).filter(e => /^\.[a-z0-9]+$/.test(e)) : [""];
  const kindOf = (ext: string): "EXECUTABLE" | "CMD" | "BAT" | null => ext === ".cmd" ? "CMD" : ext === ".bat" ? "BAT" : ext === ".exe" || ext === ".com" || !win ? "EXECUTABLE" : null;
  const clean = (d: string) => d.trim().replace(/^"(.*)"$/, "$1");
  const pathDirs = (get("PATH") ?? "").split(win ? ";" : ":").map(clean).filter(d => d && P.isAbsolute(d));
  const wellKnown: string[] = [];
  if (win) {
    const home = get("USERPROFILE"), appData = get("APPDATA");
    if (home) wellKnown.push(P.join(home, ".local", "bin"), P.join(home, ".claude", "local"));
    if (appData) wellKnown.push(P.join(appData, "npm"));
  }
  type Hit = {path: string; kind: "EXECUTABLE" | "CMD" | "BAT"; source: "PATH" | "WELL_KNOWN"; dir: string; pathIndex: number};
  const hits: Hit[] = [], searched: string[] = [];
  const scan = (dirs: string[], source: "PATH" | "WELL_KNOWN") => dirs.forEach((dir, i) => {
    searched.push(dir);
    for (const ext of exts) { const kind = kindOf(ext), f = P.join(dir, "claude" + ext); if (kind && isFile(f)) { hits.push({path: f, kind, source, dir, pathIndex: source === "PATH" ? i : -1}); break; } }
  });
  scan(pathDirs, "PATH"); scan(wellKnown.filter(d => !pathDirs.some(p => p.toLowerCase() === d.toLowerCase())), "WELL_KNOWN");
  const exe = hits.find(h => h.kind === "EXECUTABLE");
  if (exe) {
    const first = hits[0], shadowed = first !== exe; // `where claude` ilk satırı alır: ilk eşleşme çalıştırılabilir değilse veya CLI PATH'te değilse dizin başa eklenir
    return {state: "FOUND", path: exe.path, kind: "EXECUTABLE", source: exe.source, pathDir: exe.source === "WELL_KNOWN" || shadowed ? exe.dir : null, searched, founderAction: null};
  }
  const shim = hits[0];
  if (shim) return {state: "SHIM_UNSUPPORTED", path: shim.path, kind: shim.kind, source: shim.source, pathDir: null, searched,
    founderAction: `Found ${shim.path}, a ${shim.kind === "CMD" ? ".cmd" : ".bat"} launcher (an npm install). UASCO starts the CLI without a shell and Windows does not allow that for .cmd/.bat files. ${CLAUDE_CLI_INSTALL_HINT}`};
  return {state: "NOT_FOUND", path: null, kind: null, source: null, pathDir: null, searched, founderAction: `The Claude Code CLI was not found (searched ${searched.length} folder${searched.length === 1 ? "" : "s"}). ${CLAUDE_CLI_INSTALL_HINT}`};
}
// Yakalama/başlatma alt süreci için env: CLI PATH'te ilk eşleşme değilse bulunduğu dizin PATH'in başına eklenir (anahtar harf biçimi korunur).
export function withClaudeCliOnPath(env: NodeJS.ProcessEnv, cli: ClaudeCliStatus, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  if (cli.state !== "FOUND" || !cli.pathDir) return env;
  const win = platform === "win32", key = Object.keys(env).find(k => (win ? k.toUpperCase() === "PATH" : k === "PATH")) ?? "PATH", sep = win ? ";" : ":";
  return {...env, [key]: env[key] ? `${cli.pathDir}${sep}${env[key]}` : cli.pathDir};
}

export type LauncherCheck = {ok: true; resolvedPath: string} | {ok: false; code: "PROVIDER_PROVENANCE_NOT_READY" | "CLAUDE_PACKAGE_PROVENANCE_REQUIRED" | "CLAUDE_CLI_NOT_FOUND" | "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"};
// Reviewer/implementer ile aynı kural (PASS + paket/standalone seviyesi + launcher sha256), tek yerde ve makine-okunur kodlarla: provenance dosyası yok/okunamaz = NOT_READY; launcher dosyası artık yok = CLI_NOT_FOUND; içerik değişti = CHANGED.
export function claudeLauncherCheck(controlRoot: string): LauncherCheck {
  let prov: any;
  try { prov = JSON.parse(fs.readFileSync(path.join(controlRoot, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), "utf8")); } catch { return {ok: false, code: "PROVIDER_PROVENANCE_NOT_READY"}; }
  if (prov?.final !== "PASS") return {ok: false, code: "PROVIDER_PROVENANCE_NOT_READY"};
  const level = prov.claude?.provenanceLevel;
  if (level !== "FULL_PACKAGE" && level !== "STANDALONE_LAUNCHER") return {ok: false, code: "CLAUDE_PACKAGE_PROVENANCE_REQUIRED"};
  const resolved = prov.claude?.resolvedPath;
  if (typeof resolved !== "string" || !resolved || typeof prov.claude?.launcherSha256 !== "string" || !prov.claude.launcherSha256) return {ok: false, code: "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"};
  let bytes: Buffer;
  try { bytes = fs.readFileSync(resolved); } catch (e) { return {ok: false, code: (e as NodeJS.ErrnoException).code === "ENOENT" ? "CLAUDE_CLI_NOT_FOUND" : "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"}; }
  return crypto.createHash("sha256").update(bytes).digest("hex") === prov.claude.launcherSha256 ? {ok: true, resolvedPath: resolved} : {ok: false, code: "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"};
}

// //TR: Rol başına TAM hazırlık (salt-okunur): profil oturumu + CLI + başlatıcı kanıtı. blockers sıralıdır (CLI, kanıt, oturum): Founder kurulum sırasını izler; ready yalnız hepsi tamamsa true. Çalıştırma zamanındaki ret sırası executors.ts'te (profil önce) korunur.
export interface ClaudeRoleReadiness {
  role: ClaudeProfileRole; ready: boolean; blockers: string[]; blocker: string | null; founderAction: string | null;
  profile: ClaudeProfileState; loginCommand: string | null; loginHint: string | null;
}
const LAUNCHER_ACTION: Record<string, string> = {
  PROVIDER_PROVENANCE_NOT_READY: "The Claude launcher has not been verified yet: enable the Claude executor in Settings (it captures and checks the launcher).",
  CLAUDE_PACKAGE_PROVENANCE_REQUIRED: "The installed Claude launcher is not a recognised Claude Code package: reinstall Claude Code and enable the executor again.",
  CLAUDE_CLI_NOT_FOUND: "The verified Claude launcher no longer exists on disk: reinstall Claude Code and enable the executor again.",
  CLAUDE_LAUNCHER_PROVENANCE_CHANGED: "The Claude launcher changed after it was verified: enable the executor again to verify the new one."
};
export function claudeRoleReadiness(controlRoot: string, role: ClaudeProfileRole, o: ClaudeProfileOptions & {cli?: ClaudeCliStatus; launcher?: LauncherCheck} = {}): ClaudeRoleReadiness {
  const cli = o.cli ?? detectClaudeCli({env: o.env}), launcher = o.launcher ?? claudeLauncherCheck(controlRoot);
  let ps: ClaudeProfileStatus;
  try { ps = claudeProfileStatus(controlRoot, role, o); } catch { ps = {role, dir: claudeProfileDir(controlRoot, role), state: "REFUSED", reason: "PROFILE_STATUS_UNAVAILABLE", settings: "MISSING", credentialStore: "ABSENT", loginCommand: null, loginHint: null}; }
  const blockers: string[] = [], actions: string[] = [];
  // Bir launcher kanıtı yoksa CLI'nin PATH'te olması yeter değildir; kanıt VARSA (CLI daha önce doğrulandı) PATH aramasının sonucu tek başına engel değildir.
  if (cli.state !== "FOUND" && !launcher.ok) { blockers.push(cli.state === "SHIM_UNSUPPORTED" ? "CLAUDE_CLI_SHIM_UNSUPPORTED" : "CLAUDE_CLI_NOT_FOUND"); actions.push(cli.founderAction ?? ""); }
  if (!launcher.ok && !(cli.state !== "FOUND" && launcher.code === "PROVIDER_PROVENANCE_NOT_READY")) { blockers.push(launcher.code); actions.push(LAUNCHER_ACTION[launcher.code]); }
  if (ps.state === "LOGIN_REQUIRED") { blockers.push("CLAUDE_PROFILE_LOGIN_REQUIRED"); actions.push(`Sign in once for this role: ${ps.loginCommand} (${ps.loginHint})`); }
  else if (ps.state === "REFUSED") { blockers.push(`CLAUDE_PROFILE_REFUSED:${ps.reason ?? "UNKNOWN"}`); actions.push("The UASCO Claude profile folder was refused (see the reason); UASCO never falls back to your personal Claude profile."); }
  else if (ps.settings !== "PRESENT") { blockers.push("CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"); actions.push("The UASCO profile settings.json is missing or was modified: open Settings so UASCO can restore it."); }
  return {role, ready: blockers.length === 0, blockers, blocker: blockers[0] ?? null, founderAction: actions.find(a => a) ?? null, profile: ps.state, loginCommand: ps.loginCommand, loginHint: ps.loginHint};
}

// //TR: Claude CLI yazdırma kipinde oturum yokluğunu/süresini satır başındaki hata iletisiyle bildirir (bekleyip asılı kalmaz). Yalnız satır başı eşleşir (rastgele stderr oturum hatası sayılmaz); kota/hız sınırı bundan ayrı sınıflandırılır (runner executorLimit).
const CLAUDE_AUTH_ERROR_RE = /^(?:error:\s*)?(?:invalid api key\b|oauth token (?:has )?(?:expired|revoked)\b|(?:your )?(?:session|login) (?:has )?expired\b|not logged in\b|please run \/login\b|authentication[_ ]error\b|api error: 401\b)/i;
export function claudeAuthFailure(log: string): boolean {
  return String(log ?? "").slice(-8192).split("\n").some(l => CLAUDE_AUTH_ERROR_RE.test(l.trim().replace(/\u001b\[[0-9;]*m/g, "")));
}
