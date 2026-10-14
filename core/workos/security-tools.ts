// //TR: Bu dosya mission pipeline güvenlik aşamasının araç katmanıdır: gitleaks/trivy/semgrep keşfi (PATH -> mutlak yol, sürüm, sha256; TOOL_LISTED != INSTALLED != PERMITTED != TESTED), gitleaks ve trivy (çevrimdışı) çalıştırma, çıktı ayrıştırma ve politika (SECRET_DETECTED / VULNERABLE_DEPENDENCY / PARTIAL). Araç yoksa dürüst durum yazılır, asla sahte geçti yazılmaz; secret değerleri hiçbir özet veya loga girmez.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {fileURLToPath} from "node:url";
import {runProcess} from "./executors.js";
import type {ProcResult} from "./executors.js";
import {redactSecrets} from "./secret-scan.js";
import type {SecuritySecretFinding, SecurityStageSummary, SecurityToolInfo, SecurityToolName, SecurityVulnFinding} from "./types.js";

export interface ToolOverride { path: string; prefixArgs?: string[] }
// tools[x] === null: araç yok sayılır (PATH araması yapılmaz). Tanımsız: PATH araması. Override yalnız programatik enjeksiyondur (env ile seçilemez).
export interface SecurityOptions {
  tools?: Partial<Record<SecurityToolName, ToolOverride | null>>;
  pathEnv?: string; trivyCacheDir?: string; maxTrivyDbAgeMs?: number; timeoutMs?: number; maxReportBytes?: number; now?: () => number;
}
export interface ResolvedTool extends SecurityToolInfo { prefixArgs: string[] }
export type SecurityToolset = Record<SecurityToolName, ResolvedTool>;

export const TOOL_NAMES: readonly SecurityToolName[] = ["gitleaks", "trivy", "semgrep"];
const VERSION_TIMEOUT_MS = 15_000;
export const DEFAULT_SECURITY_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MAX_REPORT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_TRIVY_DB_AGE_MS = 7 * 24 * 3_600_000;
const MAX_ITEMS = 100, MAX_VULNS = 200;

export function sha256File(file: string): string {
  const h = crypto.createHash("sha256"), fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (n <= 0) break; h.update(buf.subarray(0, n)); }
  } finally { fs.closeSync(fd); }
  return h.digest("hex");
}

// PATH araması: yalnız mutlak PATH girdileri, win32'de yalnız .exe/.com (shell:false ile .cmd/.bat çalıştırılamaz). Bulunan mutlak yol döner.
export function resolveOnPath(name: string, pathEnv: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const delimiter = platform === "win32" ? ";" : ":", exts = platform === "win32" ? [".exe", ".com"] : [""];
  for (const raw of pathEnv.split(delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* sonraki aday */ }
    }
  }
  return null;
}

const notInstalled = (tool: SecurityToolName): ResolvedTool => ({tool, status: "NOT_INSTALLED", path: null, version: null, sha256: null, reason: "TOOL_NOT_INSTALLED", prefixArgs: []});
const broken = (tool: SecurityToolName, p: string, reason: string, prefixArgs: string[]): ResolvedTool => ({tool, status: "ERROR", path: p, version: null, sha256: null, reason, prefixArgs});

function discoverOne(tool: SecurityToolName, opts: SecurityOptions, env: NodeJS.ProcessEnv): ResolvedTool {
  const override = opts.tools?.[tool];
  if (override === null) return notInstalled(tool);
  const prefixArgs = [...(override?.prefixArgs ?? [])];
  const found = override ? override.path : resolveOnPath(tool, opts.pathEnv ?? process.env.PATH ?? process.env.Path ?? "");
  if (!found) return notInstalled(tool);
  const abs = path.resolve(found);
  try { if (!fs.statSync(abs).isFile()) return notInstalled(tool); } catch { return notInstalled(tool); }
  const r = cp.spawnSync(abs, [...prefixArgs, "--version"], {env, shell: false, windowsHide: true, timeout: VERSION_TIMEOUT_MS, encoding: "utf8", maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]});
  if (r.error || r.status !== 0) return broken(tool, abs, "VERSION_CHECK_FAILED", prefixArgs);
  const version = redactSecrets(String(r.stdout ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "").slice(0, 200);
  if (!version) return broken(tool, abs, "VERSION_EMPTY", prefixArgs);
  try { return {tool, status: "INSTALLED", path: abs, version, sha256: sha256File(abs), prefixArgs}; } catch { return broken(tool, abs, "HASH_FAILED", prefixArgs); }
}

// Motor başlangıcında bir kez çözülür; her çalıştırmadan önce verifyTool() ile ikili dosyanın değişmediği doğrulanır.
export function discoverSecurityTools(opts: SecurityOptions, env: NodeJS.ProcessEnv): SecurityToolset {
  return {gitleaks: discoverOne("gitleaks", opts, env), trivy: discoverOne("trivy", opts, env), semgrep: discoverOne("semgrep", opts, env)};
}
export function verifyTool(t: ResolvedTool): string | null {
  if (t.status !== "INSTALLED" || !t.path || !t.sha256) return "TOOL_NOT_USABLE";
  try { return sha256File(t.path) === t.sha256 ? null : "TOOL_BINARY_CHANGED"; } catch { return "TOOL_BINARY_UNREADABLE"; }
}
export const toolInfo = (t: ResolvedTool): SecurityToolInfo => ({tool: t.tool, status: t.status, path: t.path, version: t.version, sha256: t.sha256, ...(t.reason ? {reason: t.reason} : {})});

// ---- Ortak yardımcılar ----
const safeStr = (x: unknown, max = 200): string => redactSecrets(String(x ?? "").replace(/[\u0000-\u001f\u007f]/g, " ")).slice(0, max);
const SHA = /^[0-9a-f]{40}$/;
function readBoundedJson(file: string, maxBytes: number): {ok: true; value: unknown; sha256: string} | {ok: false; reason: string} {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return {ok: false, reason: "REPORT_NOT_A_FILE"};
    if (st.size > maxBytes) return {ok: false, reason: "REPORT_TOO_LARGE"};
    const bytes = fs.readFileSync(file);
    return {ok: true, value: JSON.parse(bytes.toString("utf8")), sha256: crypto.createHash("sha256").update(bytes).digest("hex")};
  } catch (e) { return {ok: false, reason: (e as NodeJS.ErrnoException).code === "ENOENT" ? "REPORT_MISSING" : "REPORT_UNREADABLE"}; }
}

export interface ScanCtx { env: NodeJS.ProcessEnv; timeoutMs: number; maxReportBytes: number; abort: () => boolean }
export interface GitleaksResult {
  status: "CLEAN" | "FINDINGS" | "ERROR"; reason?: string; proc: ProcResult; count: number; items: SecuritySecretFinding[]; rawReportSha256: string | null; transient: boolean;
}
// gitleaks yalnız base..head commit aralığını tarar. Güvenlik kararları: (1) hedef çıplak taze klondur (çalışma ağacı yok): repodaki .gitleaksignore / .gitleaks.toml hiç okunmaz,
// (2) --config motorun kendi dosyasıdır, ignore yolu boş motor dosyasıdır, (3) --ignore-gitleaks-allow satır içi "gitleaks:allow" yorumunu etkisiz kılar,
// (4) log-opts --text --no-textconv --no-ext-diff: .gitattributes (-diff/binary) ve textconv ile içerik gizlenemez, (5) --redact: rapor ve loglarda secret değeri yoktur,
// (6) --diff-merges=first-parent: git log -p merge commit için varsayılan olarak yama göstermez; bu olmadan "evil merge" veya çakışma çözümü ile eklenen içerik hiç taranmazdı (B3C-C1-F1).
export async function runGitleaks(tool: ResolvedTool, a: {bareRepo: string; base: string; head: string; configFile: string; ignoreFile: string; reportFile: string; cwd: string}, ctx: ScanCtx): Promise<GitleaksResult> {
  if (!SHA.test(a.base) || !SHA.test(a.head)) throw new Error("SECURITY_INVALID_SHA");
  try { fs.rmSync(a.reportFile, {force: true}); } catch { /* yoksa sorun değil */ }
  const argv = [tool.path!, ...tool.prefixArgs, "git", "--no-banner", "--no-color", "--log-level", "warn", "--redact", "--config", a.configFile, "--gitleaks-ignore-path", a.ignoreFile, "--ignore-gitleaks-allow",
    "--report-format", "json", "--report-path", a.reportFile, "--exit-code", "1", "--log-opts", `--text --no-textconv --no-ext-diff --diff-merges=first-parent ${a.base}..${a.head}`, a.bareRepo];
  const proc = await runProcess(argv, {cwd: a.cwd, env: ctx.env, timeoutMs: ctx.timeoutMs, shouldAbort: ctx.abort});
  const transient = proc.timedOut || proc.spawnError;
  const fail = (reason: string): GitleaksResult => ({status: "ERROR", reason, proc, count: 0, items: [], rawReportSha256: null, transient});
  if (proc.aborted || transient) { cleanup(a.reportFile); return fail(proc.aborted ? "ABORTED" : proc.timedOut ? "TIMED_OUT" : "SPAWN_FAILED"); }
  if (proc.exitCode !== 0 && proc.exitCode !== 1) { cleanup(a.reportFile); return fail(`UNEXPECTED_EXIT_${proc.exitCode}`); }
  const rep = readBoundedJson(a.reportFile, ctx.maxReportBytes);
  cleanup(a.reportFile); // ham rapor (commit mesajı gibi redakte edilmeyen alanlar içerebilir) saklanmaz; yalnız sha256 kaydedilir
  if (!rep.ok) {
    if (proc.exitCode === 0 && rep.reason === "REPORT_MISSING") return {status: "CLEAN", proc, count: 0, items: [], rawReportSha256: null, transient: false};
    return fail(rep.reason);
  }
  if (!Array.isArray(rep.value)) return fail("REPORT_SHAPE");
  const items: SecuritySecretFinding[] = rep.value.slice(0, MAX_ITEMS).map((f: any) => ({
    ruleId: /^[A-Za-z0-9._-]{1,100}$/.test(String(f?.RuleID ?? "")) ? String(f.RuleID) : "unknown-rule", file: safeStr(f?.File, 300),
    line: Number.isSafeInteger(f?.StartLine) && f.StartLine >= 0 ? f.StartLine : 0, commit: SHA.test(String(f?.Commit ?? "")) ? String(f.Commit) : ""
  }));
  if (proc.exitCode === 1 && rep.value.length === 0) return fail("EXIT_1_WITHOUT_FINDINGS");
  return {status: rep.value.length > 0 ? "FINDINGS" : "CLEAN", proc, count: rep.value.length, items, rawReportSha256: rep.sha256, transient: false};
}
function cleanup(file: string): void { try { fs.rmSync(file, {force: true}); } catch { /* en iyi çaba */ } }

// ---- trivy (çevrimdışı) ----
export function defaultTrivyCacheDir(): string {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "trivy");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "trivy");
}
export type TrivyDbState = "FRESH" | "STALE" | "MISSING" | "UNREADABLE";
// Yerel zafiyet DB'sinin durumu: <cache>/db/trivy.db ve metadata.json. DB asla indirilmez; yoksa/eskiyse sonuç PARTIAL olur.
export function trivyDbState(cacheDir: string, nowMs: number, maxAgeMs: number): {state: TrivyDbState; updatedAt?: string} {
  const dir = path.join(cacheDir, "db");
  try { if (!fs.statSync(path.join(dir, "trivy.db")).isFile()) return {state: "MISSING"}; } catch { return {state: "MISSING"}; }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
    const updated = Date.parse(String(meta?.UpdatedAt ?? meta?.DownloadedAt ?? ""));
    if (!Number.isFinite(updated)) return {state: "UNREADABLE"};
    return {state: nowMs - updated > maxAgeMs ? "STALE" : "FRESH", updatedAt: new Date(updated).toISOString()};
  } catch { return {state: "UNREADABLE"}; }
}
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export interface TrivyResult {
  status: "CLEAN" | "FINDINGS" | "PARTIAL" | "ERROR"; reason?: string; dbState: TrivyDbState | "RUN_FAILED"; proc: ProcResult | null; counts: Record<string, number>; blocking: number;
  findings: SecurityVulnFinding[]; truncated: boolean; rawReportSha256: string | null; transient: boolean;
}
const DB_ERROR = /first run cannot skip|DB error|database error|vulnerability db|--skip-db-update|trivy\.db|metadata\.json/i;
export async function runTrivy(tool: ResolvedTool, a: {target: string; cacheDir: string; reportFile: string; cwd: string; nowMs: number; maxDbAgeMs: number}, ctx: ScanCtx): Promise<TrivyResult> {
  const base = {counts: {} as Record<string, number>, blocking: 0, findings: [] as SecurityVulnFinding[], truncated: false, rawReportSha256: null, transient: false};
  const db = trivyDbState(a.cacheDir, a.nowMs, a.maxDbAgeMs);
  // DB yoksa/okunamıyorsa trivy hiç başlatılmaz (DB indirmesi asla denenmez).
  if (db.state === "MISSING" || db.state === "UNREADABLE") return {...base, status: "PARTIAL", reason: "TRIVY_DB_UNAVAILABLE", dbState: db.state, proc: null};
  try { fs.rmSync(a.reportFile, {force: true}); } catch { /* yoksa sorun değil */ }
  const argv = [tool.path!, ...tool.prefixArgs, "fs", "--skip-db-update", "--skip-java-db-update", "--skip-check-update", "--skip-vex-repo-update", "--offline-scan", "--skip-version-check", "--disable-telemetry",
    "--scanners", "vuln", "--config", "", "--ignorefile", "", "--cache-dir", a.cacheDir, "--format", "json", "--output", a.reportFile, "--no-progress", "--list-all-pkgs=false", "--exit-code", "0", a.target];
  const proc = await runProcess(argv, {cwd: a.cwd, env: ctx.env, timeoutMs: ctx.timeoutMs, shouldAbort: ctx.abort});
  const transient = proc.timedOut || proc.spawnError;
  const fail = (reason: string): TrivyResult => ({...base, status: "ERROR", reason, dbState: db.state, proc, transient});
  if (proc.aborted || transient) { cleanup(a.reportFile); return fail(proc.aborted ? "ABORTED" : proc.timedOut ? "TIMED_OUT" : "SPAWN_FAILED"); }
  if (proc.exitCode !== 0) {
    cleanup(a.reportFile);
    if (DB_ERROR.test(`${proc.stderr}\n${proc.stdout}`)) return {...base, status: "PARTIAL", reason: "TRIVY_DB_UNAVAILABLE", dbState: "RUN_FAILED", proc};
    return fail(`UNEXPECTED_EXIT_${proc.exitCode}`);
  }
  const rep = readBoundedJson(a.reportFile, ctx.maxReportBytes);
  if (!rep.ok) return fail(rep.reason);
  const doc = rep.value as {Results?: unknown};
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return fail("REPORT_SHAPE");
  const all: SecurityVulnFinding[] = [];
  for (const res of Array.isArray(doc.Results) ? doc.Results : []) {
    const target = safeStr((res as any)?.Target, 300);
    for (const v of Array.isArray((res as any)?.Vulnerabilities) ? (res as any).Vulnerabilities : []) {
      const sev = String(v?.Severity ?? "UNKNOWN").toUpperCase();
      all.push({package: safeStr(v?.PkgName), version: safeStr(v?.InstalledVersion, 100), id: safeStr(v?.VulnerabilityID, 100), severity: (SEVERITIES as readonly string[]).includes(sev) ? sev : "UNKNOWN",
        fixedVersion: v?.FixedVersion ? safeStr(v.FixedVersion, 100) : null, target});
    }
  }
  const counts: Record<string, number> = {};
  for (const f of all) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  all.sort((x, y) => SEVERITIES.indexOf(x.severity as typeof SEVERITIES[number]) - SEVERITIES.indexOf(y.severity as typeof SEVERITIES[number]));
  const blocking = (counts.CRITICAL ?? 0) + (counts.HIGH ?? 0);
  const stale = db.state === "STALE";
  return {status: stale ? "PARTIAL" : all.length ? "FINDINGS" : "CLEAN", ...(stale ? {reason: "TRIVY_DB_UNAVAILABLE"} : {}), dbState: db.state, proc, counts, blocking,
    findings: all.slice(0, MAX_VULNS), truncated: all.length > MAX_VULNS, rawReportSha256: rep.sha256, transient: false};
}

// ---- Politika ----
export interface PolicyInput {
  baseSha: string; headSha: string; cycle: number; tools: SecurityToolInfo[]; builtinHits: number;
  gitleaks: {status: "CLEAN" | "FINDINGS" | "NOT_INSTALLED" | "ERROR"; reason?: string; count: number; items: SecuritySecretFinding[]; rawReportSha256: string | null};
  trivy: {status: "CLEAN" | "FINDINGS" | "PARTIAL" | "NOT_INSTALLED" | "ERROR"; reason?: string; dbState?: string; counts: Record<string, number>; blocking: number; findings: SecurityVulnFinding[]; truncated: boolean; rawReportSha256: string | null};
  semgrep: SecurityToolInfo;
}
// Durum: BLOCKED (secret / HIGH-CRITICAL zafiyet / araç hatası) > PARTIAL (uygulanan bileşenlerden biri eksik) > PASSED. SAST ve SBOM sabit boşluklardır: durumu düşürmez ama her zaman gaps ve founderNote'ta görünür.
export function evaluateSecurityPolicy(p: PolicyInput): SecurityStageSummary {
  const secretFindings = p.builtinHits + p.gitleaks.count;
  const toolError = p.gitleaks.status === "ERROR" || p.trivy.status === "ERROR";
  const blockReason: SecurityStageSummary["blockReason"] = secretFindings > 0 ? "SECRET_DETECTED" : p.trivy.blocking > 0 ? "VULNERABLE_DEPENDENCY" : toolError ? "SECURITY_TOOL_ERROR" : null;
  const partialGaps: string[] = [];
  if (p.gitleaks.status === "NOT_INSTALLED") partialGaps.push("SECRETS_GITLEAKS:TOOL_NOT_INSTALLED");
  if (p.trivy.status === "NOT_INSTALLED") partialGaps.push("SCA:TOOL_NOT_INSTALLED");
  if (p.trivy.status === "PARTIAL") partialGaps.push(`SCA:${p.trivy.reason ?? "PARTIAL"}`);
  const sast = p.semgrep.status === "INSTALLED" ? {status: "NOT_AVAILABLE" as const, reason: "TOOL_INSTALLED_NOT_INTEGRATED", tool: "semgrep" as const} : {status: "NOT_AVAILABLE" as const, reason: p.semgrep.status === "ERROR" ? "TOOL_ERROR" : "TOOL_NOT_INSTALLED", tool: "semgrep" as const};
  const sbom = {status: "NOT_AVAILABLE" as const, reason: "NOT_IMPLEMENTED"};
  const gaps = [...partialGaps, `SAST:${sast.reason}`, `SBOM:${sbom.reason}`];
  const status: SecurityStageSummary["status"] = blockReason ? "BLOCKED" : partialGaps.length ? "PARTIAL" : "PASSED";
  let note: string;
  if (blockReason === "SECRET_DETECTED") note = `Security stage BLOCKED: ${secretFindings} secret finding(s) (gitleaks ${p.gitleaks.count}, built-in scan ${p.builtinHits}); secret values are never recorded.`;
  else if (blockReason === "VULNERABLE_DEPENDENCY") note = `Security stage BLOCKED: ${p.trivy.blocking} HIGH/CRITICAL vulnerable dependency finding(s).`;
  else if (blockReason === "SECURITY_TOOL_ERROR") note = `Security stage BLOCKED: a scanner failed (${[p.gitleaks.status === "ERROR" ? `gitleaks ${p.gitleaks.reason}` : "", p.trivy.status === "ERROR" ? `trivy ${p.trivy.reason}` : ""].filter(Boolean).join("; ")}); no clean result can be claimed.`;
  else if (status === "PARTIAL") note = `Security coverage is PARTIAL: ${partialGaps.join(", ")}.`;
  else note = "Secrets and dependency scans completed without blocking findings.";
  note += ` Standing gaps: ${gaps.filter(g => !partialGaps.includes(g)).join(", ")}.`;
  return {
    schemaVersion: 1, status, blockReason, baseSha: p.baseSha, headSha: p.headSha, cycle: p.cycle,
    secrets: {builtin: {status: p.builtinHits ? "FINDINGS" : "CLEAN", hits: p.builtinHits}, gitleaks: {status: p.gitleaks.status, ...(p.gitleaks.reason ? {reason: p.gitleaks.reason} : {}), findings: p.gitleaks.count, items: p.gitleaks.items, rawReportSha256: p.gitleaks.rawReportSha256}},
    sca: {status: p.trivy.status, ...(p.trivy.reason ? {reason: p.trivy.reason} : {}), ...(p.trivy.dbState ? {dbState: p.trivy.dbState} : {}), counts: p.trivy.counts, blocking: p.trivy.blocking, findings: p.trivy.findings, truncated: p.trivy.truncated, rawReportSha256: p.trivy.rawReportSha256},
    sast, sbom, gaps, tools: p.tools, founderNote: note
  };
}

// ---- Test enjeksiyonu: FAKE tarayıcı (core/workos/fake-security-tool.mjs) ----
export const FAKE_SECURITY_TOOL_SCRIPT = fileURLToPath(new URL("./fake-security-tool.mjs", import.meta.url));
export interface FakeSecurityDirective {
  gitleaks?: {installed?: boolean; findings?: Array<{ruleId: string; file: string; line: number; commit?: string}>; exitCode?: number; sleepMs?: number; plantedSecret?: string};
  trivy?: {installed?: boolean; dbState?: "FRESH" | "STALE" | "MISSING"; dbError?: boolean; vulns?: Array<{id: string; pkg: string; version: string; severity: string; fixed?: string}>; exitCode?: number; sleepMs?: number; raw?: string};
  semgrep?: {installed?: boolean};
}
export interface FakeSecurity { options: SecurityOptions; dir: string; directiveFile: string; callsFile: string; startedFlag: string; set(d: FakeSecurityDirective): void; calls(): Array<{tool: string; argv: string[]; cwd: string}> }
// node'un kendisi "araç" olarak, sahte script prefixArgs ile çalıştırılır; trivy DB durumu yerel cache dizininde (metadata.json + trivy.db) kurulur.
export function fakeSecurity(dir: string, initial: FakeSecurityDirective = {}): FakeSecurity {
  fs.mkdirSync(dir, {recursive: true});
  const directiveFile = path.join(dir, "directive.json"), callsFile = path.join(dir, "calls.jsonl"), startedFlag = path.join(dir, "started.flag"), cacheDir = path.join(dir, "trivy-cache");
  const set = (d: FakeSecurityDirective) => {
    fs.writeFileSync(directiveFile, JSON.stringify(d));
    const state = d.trivy?.dbState ?? "FRESH";
    fs.rmSync(path.join(cacheDir, "db"), {recursive: true, force: true});
    if (state !== "MISSING") {
      fs.mkdirSync(path.join(cacheDir, "db"), {recursive: true});
      fs.writeFileSync(path.join(cacheDir, "db", "trivy.db"), "fake");
      const updated = new Date(Date.now() - (state === "STALE" ? 30 * 24 * 3_600_000 : 3_600_000)).toISOString();
      fs.writeFileSync(path.join(cacheDir, "db", "metadata.json"), JSON.stringify({Version: 2, UpdatedAt: updated, DownloadedAt: updated}));
    }
  };
  set(initial);
  const ov = (tool: string, installed: boolean | undefined): ToolOverride | null => installed === false ? null : {path: process.execPath, prefixArgs: [FAKE_SECURITY_TOOL_SCRIPT, tool, directiveFile, callsFile, startedFlag]};
  return {
    dir, directiveFile, callsFile, startedFlag, set,
    options: {tools: {gitleaks: ov("gitleaks", initial.gitleaks?.installed), trivy: ov("trivy", initial.trivy?.installed), semgrep: ov("semgrep", initial.semgrep?.installed === true ? true : false)}, trivyCacheDir: cacheDir},
    calls: () => fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
  };
}
