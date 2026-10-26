// //TR: Bu dosya paketlenmiş uygulama için executor kurulum durumunu ve LOCAL_CLAUDE etkinleştirmesini sağlar: CLI PATH keşfi, kontrol kökündeki PROVIDER_PROVENANCE.json doğrulaması (PASS + kabul edilen seviye + launcher sha256) ve veri dizininde kalıcı ayar. Model asla çağrılmaz; provenance yakalama mevcut scripts/capture-provider-provenance.mjs ile (yalnız --version) yapılır ve testlerde enjekte edilen sahte bir yakalayıcıyla değiştirilir.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";
import {runNodeScript} from "./executors.js";
import {claudeLauncherCheck, claudeRoleReadiness, detectClaudeCli, withClaudeCliOnPath, CLAUDE_PROFILE_ROLES} from "./claude-profiles.js";
import type {ClaudeCliStatus, ClaudeProfileRole, ClaudeRoleReadiness} from "./claude-profiles.js";

export type LocalClaudeState = "READY" | "NOT_CONFIGURED" | "PROVENANCE_MISSING" | "CLI_NOT_FOUND";
// //TR: C-IMPL-WIN-1: state değerleri DEĞİŞMEZ (arayüz bunları eşler); cli (nasıl/nerede bulundu, .cmd başlatıcı mı) ve readiness (rol başına tam hazırlık: CLI + başlatıcı kanıtı + oturum, Founder'ın kendi giriş komutu) EK alanlardır.
export interface ExecutorStatus { LOCAL_CLAUDE: {state: LocalClaudeState; version?: string; provenanceCapturedAt?: string; enabled: boolean; source: "SETTING" | "ENV" | "NONE"; cli: ClaudeCliStatus; readiness: Record<ClaudeProfileRole, ClaudeRoleReadiness>}; FAKE: {state: "TEST_ONLY"} }
export interface ExecutorSetupOptions {
  repoRoot: string; controlRoot: string; dataDir: string; envPolicyFile: string;
  captureProvenance?: (controlRoot: string) => Promise<{ok: boolean}>;
  findClaudeCli?: () => string | null;
  env?: NodeJS.ProcessEnv;
  // Yalnız testler: Windows keşfini Linux'ta sınamak için platform ve dosya var mı sorgusu (programatik enjeksiyon).
  platform?: NodeJS.Platform; isFile?: (p: string) => boolean;
}
interface Setting { localClaude?: {enabled: boolean; enabledAt: string; enabledBy: string; launcherSha256: string | null; provenanceCapturedAt: string | null} }

export function findOnPath(name: string, pathEnv = process.env.PATH ?? process.env.Path ?? ""): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of exts) { const f = path.join(dir, name + ext); try { if (fs.statSync(f).isFile()) return f; } catch { /* yok */ } }
  }
  return null;
}

export class ExecutorSetup {
  constructor(private readonly o: ExecutorSetupOptions) {}
  get controlRoot(): string { return this.o.controlRoot; }
  private settingFile(): string { return path.join(this.o.dataDir, "settings", "executors.json"); }
  private readSetting(): Setting { try { const s = JSON.parse(fs.readFileSync(this.settingFile(), "utf8")); return s && typeof s === "object" ? s : {}; } catch { return {}; } }
  private writeSetting(s: Setting): void {
    const f = this.settingFile(); fs.mkdirSync(path.dirname(f), {recursive: true});
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({"//TR": "Executor kurulum ayarı (veri dizini); LOCAL_CLAUDE yalnız geçerli provenance ile etkinleştirilir.", ...s}, null, 2) + "\n");
    fs.renameSync(tmp, f);
  }
  // Claude broker/reviewer ile aynı kural: final PASS, seviye FULL_PACKAGE|STANDALONE_LAUNCHER ve launcher sha256 hâlâ eşleşiyor.
  provenance(): {ok: boolean; version?: string; capturedAt?: string; launcherSha256?: string; resolvedPath?: string} {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(this.o.controlRoot, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), "utf8"));
      const c = p?.claude, level = c?.provenanceLevel;
      if (p?.final !== "PASS" || (level !== "FULL_PACKAGE" && level !== "STANDALONE_LAUNCHER") || typeof c?.resolvedPath !== "string" || typeof c?.launcherSha256 !== "string") return {ok: false};
      const sha = crypto.createHash("sha256").update(fs.readFileSync(c.resolvedPath)).digest("hex");
      if (sha !== c.launcherSha256) return {ok: false};
      return {ok: true, version: typeof c.version === "string" ? c.version.slice(0, 200) : undefined, capturedAt: typeof p.capturedAt === "string" ? p.capturedAt : undefined, launcherSha256: sha, resolvedPath: c.resolvedPath};
    } catch { return {ok: false}; }
  }
  // Enjekte edilmiş bulucu (test) yalnız yol döner; aksi halde PATH + bilinen kurulum dizinleri taranır ve .cmd/.bat başlatıcı SHIM_UNSUPPORTED olarak ayrılır.
  cliStatus(): ClaudeCliStatus {
    if (this.o.findClaudeCli) { const p = this.o.findClaudeCli(); return p ? {state: "FOUND", path: p, kind: "EXECUTABLE", source: "PATH", pathDir: null, searched: [], founderAction: null} : detectClaudeCli({env: {}, platform: this.o.platform, isFile: () => false}); }
    return detectClaudeCli({env: this.o.env, platform: this.o.platform, isFile: this.o.isFile});
  }
  private cli(): string | null { const c = this.cliStatus(); return c.state === "FOUND" ? c.path : null; }
  envSelected(): boolean { return (this.o.env ?? process.env).UASCO_WORKOS_EXECUTOR === "local-claude"; }
  settingEnabled(): boolean { return this.readSetting().localClaude?.enabled === true; }
  status(): ExecutorStatus {
    const enabled = this.settingEnabled() || this.envSelected(), source = this.settingEnabled() ? "SETTING" as const : this.envSelected() ? "ENV" as const : "NONE" as const;
    const prov = this.provenance(), cli = this.cliStatus();
    const readiness = Object.fromEntries(CLAUDE_PROFILE_ROLES.map(r => [r, claudeRoleReadiness(this.o.controlRoot, r, {forbiddenRoots: [this.o.dataDir], cli, launcher: claudeLauncherCheck(this.o.controlRoot)})])) as Record<ClaudeProfileRole, ClaudeRoleReadiness>;
    let state: LocalClaudeState;
    if (cli.state !== "FOUND" && !prov.ok) state = "CLI_NOT_FOUND";
    else if (!prov.ok) state = "PROVENANCE_MISSING";
    else state = enabled ? "READY" : "NOT_CONFIGURED";
    return {LOCAL_CLAUDE: {state, enabled, source, cli, readiness, ...(prov.version ? {version: prov.version} : {}), ...(prov.capturedAt ? {provenanceCapturedAt: prov.capturedAt} : {})}, FAKE: {state: "TEST_ONLY"}};
  }
  // INT-R3 D-M1-02: yakalama script'i uygulama kökünden (paketli: kurulum dizinindeki sahnelenmiş kopya) node çocuk süreci olarak (fork; ELECTRON_RUN_AS_NODE aktarılmaz) çalışır; cwd = kontrol kökü (paketli: userData), yani provenance asla kurulum dizinine yazılmaz.
  private async defaultCapture(controlRoot: string): Promise<{ok: boolean}> {
    fs.mkdirSync(controlRoot, {recursive: true});
    // CLI PATH'te ilk eşleşme değilse (bilinen kurulum dizini / gölgelenmiş) yakalama `where claude` ile BULABİLSİN diye dizini PATH'in başına eklenir.
    const r = await runNodeScript(path.join(this.o.repoRoot, "scripts", "capture-provider-provenance.mjs"), [], {cwd: controlRoot, env: withClaudeCliOnPath(safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}), this.cliStatus(), this.o.platform), timeoutMs: 120_000});
    return {ok: r.exitCode === 0 && !r.timedOut && !r.spawnError};
  }
  // Etkinleştirme: CLI yoksa reddedilir; provenance kontrol köküne yakalanır ve doğrulanır; yalnız geçerliyse ayar kalıcı yazılır.
  async enableLocalClaude(actor: string): Promise<{ok: true; status: ExecutorStatus} | {ok: false; reason: "CLI_NOT_FOUND" | "CLI_SHIM_UNSUPPORTED" | "PROVENANCE_CAPTURE_FAILED"; status: ExecutorStatus}> {
    const cli = this.cliStatus();
    if (cli.state !== "FOUND") return {ok: false, reason: cli.state === "SHIM_UNSUPPORTED" ? "CLI_SHIM_UNSUPPORTED" : "CLI_NOT_FOUND", status: this.status()};
    let captured = false;
    try { captured = (await (this.o.captureProvenance ?? (r => this.defaultCapture(r)))(this.o.controlRoot)).ok === true; } catch { captured = false; }
    const prov = this.provenance();
    if (!captured || !prov.ok) return {ok: false, reason: "PROVENANCE_CAPTURE_FAILED", status: this.status()};
    this.writeSetting({...this.readSetting(), localClaude: {enabled: true, enabledAt: new Date().toISOString(), enabledBy: actor.slice(0, 100), launcherSha256: prov.launcherSha256 ?? null, provenanceCapturedAt: prov.capturedAt ?? null}});
    return {ok: true, status: this.status()};
  }
}
