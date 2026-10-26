// //TR: Bu dosya Project Studio dev-run yöneticisidir (PS-005/006): proje başına tek örnek (süreç içi harita + süreçler arası kilit), yönetilen deponun HEAD'inden ayrı dev workspace, safeChildEnv + boş loopback PORT, sınırlı/redakte log halkaları, çökme tespiti (çıkış kodu), süreç ağacı sonlandırma, yalnız gerçek HTTP yoklaması başarılıysa önizleme URL'si, GLOBAL_STOP'ta durdurma ve API yeniden başlangıcında sahipsiz (orphan) süreç tespiti/sonlandırması (pid + başlangıç zamanı eşleşirse).
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import cp from "node:child_process";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";
import {globalStopState} from "../../automation/lib/global-stop.mjs";
import {inspectProcessLock, acquireProcessLock} from "../../automation/lib/process-lock.mjs";
import type {Project} from "./types.js";
import {testCommandAllowed} from "./schemas.js";
import {redactSecrets} from "./secret-scan.js";
import type {ProjectStudio} from "./project-studio.js";
import {StudioError} from "./project-studio.js";
import {ExecutionGate} from "./execution-gate.js";
import {bridgeSupport} from "./devrun-bridge.js";
import type {BridgeHandle, NsenterOptions} from "./devrun-bridge.js";
import type {SandboxChild} from "./execution-gate.js";
import {systemExe} from "../sandbox/win-exe.js";

export type DevRunStatus = "STOPPED" | "STARTING" | "RUNNING" | "CRASHED" | "BLOCKED";
export interface DevRunPreview { url: string | null; state: "AVAILABLE" | "UNAVAILABLE"; lastProbeAt: string | null; reason?: string }
export interface DevRunRecovery { at: string; result: "ORPHAN_KILLED" | "ORPHAN_ALREADY_EXITED" | "ORPHAN_PID_MISMATCH_NOT_KILLED" | "ORPHAN_KILL_FAILED"; previousInstanceId: string | null; pid: number | null }
export interface DevRunState {
  schemaVersion: 1; projectId: string; tenantId: string; status: DevRunStatus; reason: string | null;
  pid: number | null; pidStartTime: string | null; ownerPid: number; ownerHost: string; instanceId: string;
  // PS1A-C1-F3: sahip API sürecinin başlangıç zamanı; pid tek başına yeniden kullanılabildiği için sahip yalnız pid + başlangıç zamanı eşleşirse canlı sayılır (yoksa: eski kayıt, fail-closed).
  ownerStartTime?: string | null;
  startedAt: string | null; endedAt: string | null; exitCode: number | null; signal: string | null; port: number | null; argv: string[]; headSha: string | null;
  preview: DevRunPreview; recovery?: DevRunRecovery;
  // B-DEVRUN-RESTART-SAFE: durdurma isteği çıkışı süre içinde göremedi; süreç ağacı hâlâ canlı olabilir. Çıkış gelince onExit bunu siler.
  stopTimedOut?: true;
  // B-RUN-1: ürün bir teslim kaydına (work-run) bağlı başlatıldıysa o koşunun kimliği; headSha teslim edilen commit'tir. bridged: ürün portu yalnız sağlayıcı köprüsüyle (127.0.0.1) ana makineye açılır.
  deliveryRunId?: string | null; bridged?: boolean;
  // C-5: sağlayıcı-taraflı scratch (WSL); API çökerse recover() bununla Linux tarafını kapatır. stopIncomplete: kapatma temiz bitmedi (sağlayıcı kodu).
  sandboxScratch?: string | null; stopIncomplete?: string;
  // PS1A-C2-F2: süreç çıkışından sonra kalan süreç ağacı temizliği (Windows: ppid yürüyüşü + periyodik soy anlık görüntüsü; Linux: süreç grubu + kaydedilmiş soy (setsid'li torunlar dahil) ppid yürüyüşü; diğer POSIX: yalnız süreç grubu).
  treeCleanup?: {at: string; method: "PPID_WALK" | "PROCESS_GROUP" | "PROCESS_GROUP_PPID_WALK" | "UNAVAILABLE"; killed: number; survivors: number | null; verification?: "VERIFIED" | "UNVERIFIED"};
}
export interface DevRunView extends Omit<DevRunState, "ownerPid" | "ownerHost" | "instanceId" | "pidStartTime" | "ownerStartTime" | "schemaVersion" | "tenantId"> { logTail: {stdout: string; stderr: string; truncated: boolean} }
export interface DevRunOptions {
  studio: ProjectStudio; envPolicyFile: string; globalStopFile: string;
  audit?: (event: string, details: Record<string, unknown>) => void;
  startTimeOf?: (pid: number) => Promise<string | null>;
  // Test enjeksiyonu: boş loopback port seçimi (varsayılan freeLoopbackPort); PS1A-C1-F2 yarışını deterministik kurmak için kullanılır.
  freePort?: () => Promise<number>;
  logRingBytes?: number; logTailBytes?: number; startWaitMs?: number; graceMs?: number; probeIntervalMs?: number; stopPollMs?: number;
  // B-DEVRUN-RESTART-SAFE: stop() çıkışı en çok bu kadar bekler (varsayılan 15 sn); dolarsa süreç ağacı hâlâ canlı olabilir, çalıştırma STOPPED sayılmaz.
  stopWaitMs?: number;
  // Windows stop 409 düzeltmesi: kök çıkışı ile ağaç temizliği AYRI bütçelerdir. stop() kök çıkınca döner; ağaç temizliği arka planda biter (sonucu treeCleanup'ta görünür).
  // Yeni start (restart dahil) eski ağaç TAMAMEN temizlenmeden süreç başlatmaz: en çok bu kadar bekler (varsayılan 60 sn), dolarsa 409 DEVRUN_STOP_PENDING.
  reapWaitMs?: number;
  // PS1A-C2-F2: Windows'ta çalışırken soy süreçlerin (pid + oluşturma zamanı) anlık görüntü aralığı; 0 kapatır.
  treeSnapshotMs?: number;
  // SBX-GATE: dev komutu proje kodudur; yalnız bu kapının izin verdiği doğrulanmış sandbox sağlayıcısında başlatılır. Tanımsız = sağlayıcı yok = 409 SANDBOX_UNAVAILABLE (süreç başlatılmaz).
  executionGate?: ExecutionGate;
  // B-RUN-1: köprü ayarları (test enjeksiyonu: nsenter yolu/null, bağlantı sınırı).
  bridgeOptions?: NsenterOptions;
  // C-9: yönetici genelinde eşzamanlı etkin dev-run üst sınırı (varsayılan 2); aşılırsa 409 DEVRUN_CAPACITY.
  maxConcurrent?: number;
  // recover() sağlayıcı-taraflı scratch kapatmasını arka planda bu süre kadar dener (varsayılan 30 sn).
  recoverTeardownMs?: number;
}
const NO_PREVIEW_TYPES = new Set(["desktop", "mobile", "native"]);
const ACTIVE: ReadonlySet<DevRunStatus> = new Set(["STARTING", "RUNNING"]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Zaman aşımlı bekleme: sayaç HER durumda temizlenir (60/15 sn'lik tutamaklar kapanıştan sonra kalmaz). */
const timed = <T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> => new Promise<T>(res => { const t = setTimeout(() => res(onTimeout), ms); p.then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(onTimeout); }); });

// Süreç kimliği: pid tek başına yeniden kullanılabilir; başlangıç zamanı ile birlikte doğrulanır (Windows: .NET Process.StartTime, Linux: /proc/<pid>/stat alan 22, diğer: ps lstart).
let OWN_START_CACHE: Promise<string | null> | null = null;
export async function processStartTime(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const run = (file: string, args: string[]) => new Promise<string | null>(resolve => {
    cp.execFile(file, args, {windowsHide: true, timeout: 15_000, encoding: "utf8"}, (err, out) => resolve(err ? null : String(out).trim() || null));
  });
  if (process.platform === "win32") return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().ToString('o')`]);
  if (process.platform === "linux") { try { const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19] ?? null; } catch { return null; } }
  return run("ps", ["-o", "lstart=", "-p", String(pid)]);
}
export function pidAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
  // Linux: kill(pid, 0) zombi (çıkmış, ebeveyni henüz toplamamış) süreç için de başarılıdır; yalnız /proc durumu açıkça Z/X ise ölü sayılır (okunamazsa kill sonucu geçerli: yanlış "ölü" yok).
  if (process.platform === "linux") { try { const s = parseLinuxStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8")); if (s && (s.state === "Z" || s.state === "X")) return false; } catch { /* okunamadı */ } }
  return true;
}
// Linux /proc/<pid>/stat: "pid (comm) S ppid ... starttime(alan 22)"; comm boşluk/parantez içerebilir, son ")" sonrası ayrıştırılır.
function parseLinuxStat(text: string): {pid: number; state: string; ppid: number; startTicks: number} | null {
  const close = text.lastIndexOf(")"); if (close < 0) return null;
  const pid = Number(text.slice(0, text.indexOf("(")).trim());
  const f = text.slice(close + 2).split(" ");
  const ppid = Number(f[1]), startTicks = Number(f[19]);
  return Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(startTicks) && f[0] ? {pid, state: f[0], ppid, startTicks} : null;
}
// Linux saat dönüşümü (açılış anı ms + tik süresi ms) süreç başına bir kez hesaplanır; böylece aynı sürecin oluşturma zamanı her listede birebir aynı sayıdır (bilinen soy eşleşmesi ±2 ms).
let linuxClock: {bootMs: number; tickMs: number} | null | undefined;
function linuxClockInfo(): {bootMs: number; tickMs: number} | null {
  if (linuxClock !== undefined) return linuxClock;
  try {
    const up = Number(fs.readFileSync("/proc/uptime", "utf8").trim().split(/\s+/)[0]);
    const r = cp.spawnSync("getconf", ["CLK_TCK"], {encoding: "utf8", timeout: 5_000, windowsHide: true});
    const hz = Number(String(r.stdout ?? "").trim());
    linuxClock = Number.isFinite(up) && up > 0 ? {bootMs: Date.now() - up * 1000, tickMs: Number.isFinite(hz) && hz > 0 ? 1000 / hz : 10} : null;
  } catch { linuxClock = null; }
  return linuxClock;
}
function linuxTicksToMs(ticks: number): number | null { const c = linuxClockInfo(); return c ? Math.round(c.bootMs + ticks * c.tickMs) : null; }
// processStartTime çıktısını epoch ms'ye çevirir (Linux: /proc tik sayısı, diğer: tarih metni). Okunamazsa null.
export function startTimeMs(s: string | null): number | null {
  if (!s) return null;
  if (process.platform === "linux" && /^\d+$/.test(s)) return linuxTicksToMs(Number(s));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
export function killProcessTree(pid: number): void {
  try {
    if (process.platform === "win32") { const tk = systemExe("taskkill.exe"); if (tk) cp.spawnSync(tk, ["/pid", String(pid), "/T", "/F"], {windowsHide: true, stdio: "ignore", timeout: 15_000}); }
    else { try { process.kill(-pid, "SIGKILL"); } catch { process.kill(pid, "SIGKILL"); } }
  } catch { /* süreç zaten bitmiş olabilir */ }
}
// PS1A-C2-F2: süreç tablosu (pid, ppid, oluşturma zamanı ms). Windows: Win32_Process; Linux: /proc/<pid>/stat (zombiler hariç: çıkmışlardır, öldürülemez ve canlı çocukları yoktur).
// Desteklenmeyen platformda veya okunamazsa null (temizlik yalnız süreç grubuyla / yapılamadı olarak raporlanır).
export interface ProcInfo { pid: number; ppid: number; created: number }
export const PROCESS_LIST_SUPPORTED = process.platform === "win32" || process.platform === "linux";
async function listLinuxProcesses(): Promise<ProcInfo[] | null> {
  if (!linuxClockInfo()) return null;
  let names: string[];
  try { names = await fs.promises.readdir("/proc"); } catch { return null; }
  const rows = await Promise.all(names.filter(n => /^\d+$/.test(n)).map(async n => {
    try {
      const s = parseLinuxStat(await fs.promises.readFile(`/proc/${n}/stat`, "utf8"));
      const created = s ? linuxTicksToMs(s.startTicks) : null;
      return s && created !== null && s.state !== "Z" && s.state !== "X" ? {pid: s.pid, ppid: s.ppid, created} : null;
    } catch { return null; /* süreç bu arada bitti */ }
  }));
  const out = rows.filter((r): r is ProcInfo => r !== null);
  return out.length ? out : null;
}
export function listProcesses(): Promise<ProcInfo[] | null> {
  if (process.platform === "linux") return listLinuxProcesses();
  if (process.platform !== "win32") return Promise.resolve(null);
  const script = "Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { '{0},{1},{2}' -f $_.ProcessId,$_.ParentProcessId,([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } }";
  return new Promise(resolve => {
    cp.execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide: true, timeout: 30_000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024}, (err, out) => {
      if (err) return resolve(null);
      const rows = String(out).split(/\r?\n/).map(l => l.trim().split(",").map(Number)).filter(r => r.length === 3 && r.every(Number.isFinite)).map(([pid, ppid, created]) => ({pid, ppid, created}));
      resolve(rows.length ? rows : null);
    });
  });
}
// Kök sürecin (çökmüş olabilir) soyu: ppid zinciri yalnız oluşturma zamanı tutarlıysa izlenir (çocuk ebeveynden sonra, ebeveyn pid'i yeniden kullanıldıysa yeni sahibinden önce oluşmuştur).
// known: daha önce görülen soy (pid -> oluşturma zamanı); ara ebeveyni ölmüş torunlar bu kayıtlar üzerinden bağlanır. Bu API süreci asla dahil edilmez.
export function treeDescendants(procs: ProcInfo[], root: {pid: number; notBefore: number; startTime: number | null}, known: ReadonlyMap<number, number> = new Map()): ProcInfo[] {
  const live = new Map(procs.map(p => [p.pid, p]));
  const anc = new Map<number, {created: number; until: number}>();
  const out = new Map<number, ProcInfo>();
  const r = live.get(root.pid);
  const rootReused = r ? (root.startTime !== null ? Math.abs(r.created - root.startTime) > 1000 : r.created < root.notBefore) : false;
  anc.set(root.pid, {created: root.notBefore, until: rootReused && r ? r.created : Infinity});
  for (const [pid, created] of known) {
    if (pid === root.pid || pid === process.pid) continue;
    const l = live.get(pid);
    if (l && Math.abs(l.created - created) <= 2) { out.set(pid, l); anc.set(pid, {created, until: Infinity}); }
    else anc.set(pid, {created, until: l ? l.created : Infinity});
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const p of procs) {
      if (out.has(p.pid) || p.pid === root.pid || p.pid === process.pid) continue;
      const a = anc.get(p.ppid);
      if (a && p.created >= a.created && p.created < a.until) { out.set(p.pid, p); anc.set(p.pid, {created: p.created, until: Infinity}); changed = true; }
    }
  }
  return [...out.values()];
}
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const a = s.address(); const port = typeof a === "object" && a ? a.port : 0; s.close(() => port ? resolve(port) : reject(new Error("NO_PORT"))); });
  });
}
function probe(port: number, timeoutMs = 1500): Promise<number | null> {
  return new Promise(resolve => {
    const req = http.get({host: "127.0.0.1", port, path: "/", timeout: timeoutMs, agent: false}, res => { res.resume(); resolve(res.statusCode ?? null); });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

// Sınırlı halka tampon: son N bayt tutulur; kalıcı dosyaya redakte edilmiş hali yazılır.
class Ring {
  private buf = Buffer.alloc(0); dropped = false;
  constructor(private readonly max: number) {}
  push(chunk: Buffer): void { this.buf = Buffer.concat([this.buf, chunk]); if (this.buf.length > this.max) { this.buf = this.buf.subarray(this.buf.length - this.max); this.dropped = true; } }
  text(): string { return this.buf.toString("utf8"); }
}
interface Active {
  state: DevRunState; child: cp.ChildProcess | null; stopping: boolean; stdout: Ring; stderr: Ring;
  release: (() => void) | null; probeTimer: NodeJS.Timeout | null; flushTimer: NodeJS.Timeout | null; exited: Promise<void>; rootExited: Promise<void>; teardown: Promise<void>; projectType: string | undefined;
  known: Map<number, number>; snapTimer: NodeJS.Timeout | null; bridge: BridgeHandle | null;
  provider: {isVerified?(): boolean} | null; blockedReason: string | null; deverifyStop: boolean;
  // D1: uçuştaki spawn/spawnAsync; stop/stopAll/close sandbox kurulmadan 'STOPPED' demez, bunun bitmesini (ve iptal edildiyse söküldüğünü) bekler.
  spawning: Promise<void> | null;
}

export class DevRunManager {
  private readonly reaping = new Map<string, Promise<void>>();
  // Bekleyen (henüz yer tutucusu yazılmamış) start'ların iptali: stop/stopAll/close bu sayaçları artırır, start bekleme sonrası yeniden denetler; closed kapanıştan sonra yeni süreci engeller.
  private closed = false; private stopEpoch = 0; private readonly startGen = new Map<string, number>();
  readonly instanceId = `dev_${crypto.randomBytes(8).toString("hex")}`;
  private readonly active = new Map<string, Active>();
  private stopTimer: NodeJS.Timeout | null = null;
  private readonly o: Required<Omit<DevRunOptions, "audit" | "executionGate" | "bridgeOptions">> & {bridgeOptions: NsenterOptions} & {audit: (event: string, details: Record<string, unknown>) => void; executionGate: ExecutionGate};
  readonly recoveries: Array<{projectId: string} & DevRunRecovery> = [];

  constructor(opts: DevRunOptions) {
    this.o = {audit: () => undefined, startTimeOf: processStartTime, freePort: freeLoopbackPort, logRingBytes: 256 * 1024, logTailBytes: 16 * 1024, startWaitMs: 15_000, graceMs: 1_000, probeIntervalMs: 500, stopPollMs: 500, stopWaitMs: 15_000, treeSnapshotMs: 2_000, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined))} as unknown as DevRunManager["o"];
    // SBX-GATE: yalnız gerçek bir ExecutionGate örneği kabul edilir; başka her değer sağlayıcısız kapıdır (fail-closed).
    if (!(this.o.executionGate instanceof ExecutionGate)) this.o.executionGate = new ExecutionGate(null);
  }

  // Bu API sürecinin başlangıç zamanı (sahiplik kimliği); bir kez okunur.
  private selfStart: string | null = null;
  private selfStartP: Promise<string | null> | null = null;
  // Bu sürecin başlangıç zamanı süreç ömrü boyunca sabittir: varsayılan okuyucu için süreç genelinde BİR kez okunur (Windows'ta PowerShell çağrısı sunucu başına yüzlerce ms-sn sürer ve onReady süresini yer).
  private ownStartTime(): Promise<string | null> {
    if (this.selfStartP) return this.selfStartP;
    const read = this.o.startTimeOf === processStartTime ? (OWN_START_CACHE ??= processStartTime(process.pid).catch(() => null)) : this.o.startTimeOf(process.pid);
    return this.selfStartP = read.then(t => { this.selfStart = t; return t; }, () => null);
  }
  // PS1A-C1-F3: kaydın sahibi başka bir canlı API süreci mi? Aynı süreç (başka yönetici örneği) burada canlı sayılmaz (kilit ayrıca bakar).
  // pid ölü -> değil; pid canlı ama kayıtlı başlangıç zamanı farklı -> pid yeniden kullanılmış, değil; zaman yok/okunamıyor -> fail-closed canlı.
  private async ownerLive(st: DevRunState): Promise<boolean> {
    if (st.ownerPid === process.pid) return false;
    if (st.ownerHost !== os.hostname()) return true;
    if (!pidAlive(st.ownerPid)) return false;
    if (!st.ownerStartTime) return true;
    const now = await this.o.startTimeOf(st.ownerPid).catch(() => null);
    return now === null ? true : now === st.ownerStartTime;
  }
  private dir(projectId: string): string { return path.join(this.o.studio.projectDir(projectId), "devrun"); }
  private stateFile(projectId: string): string { return path.join(this.dir(projectId), "state.json"); }
  private lockFile(projectId: string): string { return path.join(this.dir(projectId), "devrun.lock"); }
  private readState(projectId: string): DevRunState | null {
    try { const s = JSON.parse(fs.readFileSync(this.stateFile(projectId), "utf8")); return s && s.schemaVersion === 1 && s.projectId === projectId ? s as DevRunState : null; } catch { return null; }
  }
  // Durum yalnız bu örnek hâlâ sahibiyse yazılır: devralan yeni örneğin kaydı eski örneğin geç gelen çıkış olayıyla ezilmez.
  private writeState(st: DevRunState, force = false): void {
    const cur = this.readState(st.projectId);
    if (!force && cur && cur.instanceId !== this.instanceId) return;
    fs.mkdirSync(this.dir(st.projectId), {recursive: true});
    const f = this.stateFile(st.projectId), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({"//TR": "Dev-run durumu; otorite süreç içi yöneticidir, bu dosya yeniden başlangıçta sahipsiz süreç tespiti için kullanılır.", ...st}, null, 2) + "\n");
    fs.renameSync(tmp, f);
  }
  private blank(project: Project): DevRunState {
    return {schemaVersion: 1, projectId: project.projectId, tenantId: project.tenantId, status: "STOPPED", reason: null, pid: null, pidStartTime: null, ownerPid: process.pid, ownerHost: os.hostname(), ownerStartTime: this.selfStart, instanceId: this.instanceId,
      startedAt: null, endedAt: null, exitCode: null, signal: null, port: null, argv: [], headSha: null, preview: {url: null, state: "UNAVAILABLE", lastProbeAt: null, reason: "NOT_RUNNING"}};
  }
  private readLogs(projectId: string, a?: Active): {stdout: string; stderr: string; truncated: boolean} {
    const tail = (t: string) => { const b = Buffer.from(t, "utf8"); return b.length > this.o.logTailBytes ? {t: b.subarray(b.length - this.o.logTailBytes).toString("utf8"), cut: true} : {t, cut: false}; };
    let out: string, err: string, dropped = false;
    if (a) { out = a.stdout.text(); err = a.stderr.text(); dropped = a.stdout.dropped || a.stderr.dropped; }
    else {
      const rd = (n: string) => { try { return fs.readFileSync(path.join(this.dir(projectId), "logs", n), "utf8"); } catch { return ""; } };
      out = rd("stdout.log"); err = rd("stderr.log");
    }
    const o = tail(redactSecrets(out)), e = tail(redactSecrets(err));
    return {stdout: o.t, stderr: e.t, truncated: dropped || o.cut || e.cut};
  }
  private flushLogs(a: Active): void {
    try {
      const d = path.join(this.dir(a.state.projectId), "logs");
      fs.mkdirSync(d, {recursive: true});
      fs.writeFileSync(path.join(d, "stdout.log"), redactSecrets(a.stdout.text()));
      fs.writeFileSync(path.join(d, "stderr.log"), redactSecrets(a.stderr.text()));
    } catch { /* log kalıcılığı en iyi çaba; bellek halkası otoritedir */ }
  }
  private scheduleFlush(a: Active): void { if (!a.flushTimer) a.flushTimer = setTimeout(() => { a.flushTimer = null; this.flushLogs(a); }, 200); }

  view(project: Project): DevRunView {
    const a = this.active.get(project.projectId);
    if (a) this.checkProvider(a);
    const st = a?.state ?? this.readState(project.projectId) ?? this.blank(project);
    const {ownerPid: _o, ownerHost: _h, instanceId: _i, pidStartTime: _p, ownerStartTime: _ost, schemaVersion: _s, tenantId: _t, ...pub} = st;
    // PS1A-C1-F3: önizleme URL'si yalnız bu örneğin kendi HTTP yoklamasından gelir; dosyadan okunan (başka/eski örneğe ait) AVAILABLE önizleme maskelenir.
    const preview: DevRunPreview = a?.blockedReason ? {url: null, state: "UNAVAILABLE", lastProbeAt: pub.preview?.lastProbeAt ?? null, reason: a.blockedReason} : !a && pub.preview?.state === "AVAILABLE" ? {url: null, state: "UNAVAILABLE", lastProbeAt: pub.preview.lastProbeAt ?? null, reason: "NOT_OWNED_BY_THIS_INSTANCE"} : {...pub.preview};
    return {...pub, argv: [...pub.argv], preview, logTail: this.readLogs(project.projectId, a)};
  }
  // C-5: sağlayıcı-taraflı kapatma temiz bitmediyse (kod döndü) kayıt STOP_INCOMPLETE:<kod> taşır; scratch kaydı recover() için saklanır, temizse silinir.
  private noteTeardown(a: Active, td: unknown): void {
    const st = a.state;
    if (typeof td === "string" && td) { st.stopIncomplete = td; st.reason = `STOP_INCOMPLETE:${td}`; this.o.audit("DEVRUN_STOP_INCOMPLETE", {projectId: st.projectId, code: td}); }
    else if (st.sandboxScratch && td === null) st.sandboxScratch = null;
    else return;
    const cur = this.readState(st.projectId);
    if (!this.active.has(st.projectId) && cur && cur.instanceId === this.instanceId && cur.startedAt === st.startedAt && !ACTIVE.has(cur.status)) { try { this.writeState({...cur, reason: st.reason, stopIncomplete: st.stopIncomplete, sandboxScratch: st.sandboxScratch ?? null}); } catch { /* durum yazılamadı */ } }
  }
  // C-1: sağlayıcı kendini doğrulanmamış yaptıysa (isVerified() false) çalışan ürün çalışır/köprülü/200 kalamaz: sağlayıcı tarafında kapatılır ve BLOCKED yazılır.
  private checkProvider(a: Active): void {
    if (!ACTIVE.has(a.state.status) || typeof a.provider?.isVerified !== "function") return;
    // Durdurma zaman aşımına uğradıysa (TIMEOUT) bir sonraki denetimde yeniden denenir.
    if (a.blockedReason) { if (!a.deverifyStop) this.stopForDeverify(a); return; }
    let ok = false; try { ok = a.provider.isVerified() === true; } catch { ok = false; }
    if (ok) return;
    a.blockedReason = "SANDBOX_UNVERIFIED";
    try { a.bridge?.close(); } catch { /* kapalı */ }
    a.bridge = null;
    a.state.preview = {url: null, state: "UNAVAILABLE", lastProbeAt: a.state.preview.lastProbeAt, reason: "SANDBOX_UNVERIFIED"};
    this.o.audit("DEVRUN_SANDBOX_DEVERIFIED", {projectId: a.state.projectId});
    this.stopForDeverify(a);
  }
  private stopForDeverify(a: Active): void {
    a.deverifyStop = true;
    void this.stopDetailed(a.state.projectId, "SANDBOX_UNVERIFIED").then(r => { if (r === "TIMEOUT") a.deverifyStop = false; }, () => { a.deverifyStop = false; });
  }
  isActive(projectId: string): boolean { const a = this.active.get(projectId); return Boolean(a && ACTIVE.has(a.state.status)); }

  // Süreçler arası tek örnek: kilit canlı başka bir API sürecindeyse reddedilir; bu süreçteki eski bir örneğe veya ölü pid'e aitse devralınır.
  // PS1A-C1-F3: staleOwner, pid'i canlı ama başlangıç zamanı kayıttakinden farklı (pid yeniden kullanılmış) önceki sahiptir; kilit tam olarak o sahibin kimliğini taşıyorsa devralınır.
  private takeLock(projectId: string, staleOwner: {pid: number; instanceId: string} | null = null): () => void {
    const f = this.lockFile(projectId);
    fs.mkdirSync(path.dirname(f), {recursive: true});
    const s = inspectProcessLock(f) as {state: string; pid?: number; runId?: string | null};
    if (s.state === "ACTIVE" && s.pid !== process.pid && staleOwner && s.pid === staleOwner.pid && s.runId === staleOwner.instanceId) fs.rmSync(f, {force: true});
    else if (s.state === "ACTIVE" && s.pid === process.pid) {
      // Aynı süreçteki başka bir yönetici örneği hâlâ çalıştırıyorsa kilitli sayılır; yalnız artık sahiplenilmeyen kilit kaldırılır.
      const cur = this.readState(projectId);
      if (s.runId !== this.instanceId && cur && ACTIVE.has(cur.status) && cur.instanceId === s.runId) throw new StudioError("DEVRUN_LOCKED", 409);
      fs.rmSync(f, {force: true});
    } else if (s.state === "ACTIVE" || s.state === "OTHER_HOST" || s.state === "UNREADABLE" || s.state === "INVALID" || s.state === "PID_STATE_UNKNOWN") throw new StudioError("DEVRUN_LOCKED", 409);
    try { return acquireProcessLock(f, this.instanceId); } catch { throw new StudioError("DEVRUN_LOCKED", 409); }
  }

  // D2: reddedilen/engellenen bir başlatma önceki çalıştırmanın STOP_INCOMPLETE kaydını ve scratch tanıtıcısını SİLMEZ (sonraki start Linux tarafı kapatmayı yeniden dener).
  private keepIncomplete(cur: DevRunState | null): Partial<DevRunState> {
    return cur ? {...(cur.stopIncomplete ? {stopIncomplete: cur.stopIncomplete} : {}), ...(cur.sandboxScratch ? {sandboxScratch: cur.sandboxScratch} : {})} : {};
  }
  private block(project: Project, reason: string): never {
    const cur = this.readState(project.projectId);
    const st = {...this.blank(project), status: "BLOCKED" as const, reason, endedAt: new Date().toISOString(), ...this.keepIncomplete(cur)};
    try { this.writeState(st, !cur || !ACTIVE.has(cur.status)); } catch { /* durum yazılamadı */ }
    throw new StudioError("DEVRUN_BLOCKED", 409, reason);
  }

  async start(project: Project, link?: {runId: string; headSha: string}): Promise<DevRunView> {
    const id = project.projectId;
    if (this.closed) throw new StudioError("DEVRUN_CLOSED", 409);
    const epoch0 = this.stopEpoch, gen0 = this.startGen.get(id) ?? 0;
    const cancelled = () => this.closed || this.stopEpoch !== epoch0 || (this.startGen.get(id) ?? 0) !== gen0;
    if (this.isActive(id)) throw new StudioError("DEVRUN_ALREADY_RUNNING", 409);
    if (this.stopActive()) throw new StudioError("GLOBAL_STOP_ACTIVE", 423);
    // SBX-GATE (FD-REL-1-REJECT-HOST-EXEC-2026-10-15): doğrulanmış sandbox yoksa dev komutu hiç başlatılmaz; durum dürüstçe BLOCKED/SANDBOX_UNAVAILABLE yazılır ve 409 döner.
    const gate = await this.o.executionGate.authorize("STUDIO_DEVRUN");
    if (!gate.allowed) {
      const cur = this.readState(id);
      if (!cur || !ACTIVE.has(cur.status)) { try { this.writeState({...this.blank(project), status: "BLOCKED", reason: gate.reason, endedAt: new Date().toISOString(), ...this.keepIncomplete(cur)}, true); } catch { /* durum yazılamadı */ } }
      this.o.audit("WORKOS_DEVRUN_REFUSED", {projectId: id, reason: gate.reason, detail: gate.detail});
      throw new StudioError(gate.reason, 409, gate.detail);
    }
    // B-RUN-1: sağlayıcının ağı izoleyse ürün ancak sağlayıcı köprüsüyle erişilebilir; köprü yoksa HİÇBİR süreç başlatılmaz (kesin neden, sessiz ana makine çalıştırması yok).
    const bridge = bridgeSupport(gate.provider, this.o.bridgeOptions);
    if (!bridge.ok) {
      const cur = this.readState(id);
      if (!cur || !ACTIVE.has(cur.status)) { try { this.writeState({...this.blank(project), status: "BLOCKED", reason: `DEVRUN_SANDBOX_UNAVAILABLE:${bridge.reason}`, endedAt: new Date().toISOString(), ...this.keepIncomplete(cur)}, true); } catch { /* durum yazılamadı */ } }
      this.o.audit("WORKOS_DEVRUN_REFUSED", {projectId: id, reason: "DEVRUN_SANDBOX_UNAVAILABLE", detail: bridge.reason});
      throw new StudioError("DEVRUN_SANDBOX_UNAVAILABLE", 409, bridge.reason);
    }
    // Önceki çalıştırmanın ağaç temizliği (arka planda) bitmeden yeni süreç başlatılmaz.
    const pending = this.reaping.get(id);
    if (pending && !(await timed(pending.then(() => true), this.o.reapWaitMs ?? 60_000, false))) throw new StudioError("DEVRUN_STOP_PENDING", 409);
    // NEW-2: önceki çalıştırmanın sağlayıcı-taraflı kapatması temiz bitmediyse (STOP_INCOMPLETE) kayıt sessizce düşmez: önce Linux tarafı yeniden kapatılır; kapanmazsa yeni süreç BAŞLATILMAZ.
    const prevRun = this.readState(id);
    if (prevRun?.stopIncomplete) {
      const code = prevRun.sandboxScratch ? (await this.recoverScratchWith(prevRun, gate.provider)).code : null;
      if (code) throw new StudioError("DEVRUN_STOP_INCOMPLETE", 409, code);
      try { this.writeState({...prevRun, stopIncomplete: undefined, sandboxScratch: null, reason: "STOP_INCOMPLETE_RESOLVED"}, true); } catch { /* durum yazılamadı */ }
    }
    // Kapı beklemesinden sonra (await) eşzamanlı start ve GLOBAL_STOP yeniden kontrol edilir.
    if (this.isActive(id)) throw new StudioError("DEVRUN_ALREADY_RUNNING", 409);
    if (this.stopActive()) throw new StudioError("GLOBAL_STOP_ACTIVE", 423);
    const argv = project.devCommand;
    if (!argv) return this.block(project, "DEVRUN_COMMAND_NOT_CONFIGURED");
    if (!testCommandAllowed(argv)) return this.block(project, "DEVRUN_COMMAND_NOT_ALLOWED");
    // PS1A-C1-F1: dev-run yalnız projenin kendi yönetilen deposundan klonlanır; istemci kontrollü (yönetilmeyen) repository.path 409 REPOSITORY_NOT_MANAGED'dir.
    let repo: string;
    try { repo = this.o.studio.managedRepoRoot(project); }
    catch (e) { if (e instanceof StudioError && e.code === "REPOSITORY_NOT_CONFIGURED") return this.block(project, "REPOSITORY_NOT_CONFIGURED"); throw e; }
    // Yer tutucu: aynı süreçteki eşzamanlı ikinci start await'ten önce reddedilir.
    // Bekleme sırasında stop/stopAll/close geldiyse süreç BAŞLATILMAZ (yer tutucu ile aynı eşzamanlı adımda denetlenir).
    if (cancelled()) { if (this.closed) throw new StudioError("DEVRUN_CLOSED", 409); return this.view(project); }
    if ([...this.active.values()].filter(x => ACTIVE.has(x.state.status)).length >= (this.o.maxConcurrent ?? 2)) throw new StudioError("DEVRUN_CAPACITY", 409);
    const st: DevRunState = {...this.blank(project), status: "STARTING", startedAt: new Date().toISOString(), argv: [...argv]};
    // C-8: teslim bağlantısı STARTING yer tutucusundan itibaren kayıtlıdır (ürün durdurma STARTING sırasında da çalışır).
    if (link) st.deliveryRunId = link.runId;
    const a: Active = {state: st, child: null, stopping: false, stdout: new Ring(this.o.logRingBytes), stderr: new Ring(this.o.logRingBytes), release: null, probeTimer: null, flushTimer: null, exited: Promise.resolve(), rootExited: Promise.resolve(), teardown: Promise.resolve(), projectType: project.projectType, known: new Map(), snapTimer: null, bridge: null, provider: null, blockedReason: null, deverifyStop: false, spawning: null};
    this.active.set(id, a);
    // PS1A-C1-F2: her await'ten sonra (özellikle spawn'dan hemen önce) stop/stopAll/GLOBAL_STOP ve harita sahipliği yeniden kontrol edilir.
    let spawnDoneRef: () => void = () => undefined;
    const aborted = () => a.stopping || this.closed || this.active.get(id) !== a || this.stopActive() !== null;
    try {
      st.ownerStartTime = await this.ownStartTime();
      // PS1A-C1-F3: kaydın sahibi yalnız pid + başlangıç zamanı eşleşirse canlı başka bir API sürecidir; pid yeniden kullanılmışsa kilit devralınabilir.
      const persisted = this.readState(id);
      let staleOwner: {pid: number; instanceId: string} | null = null;
      if (persisted && persisted.instanceId !== this.instanceId && persisted.ownerPid !== process.pid) {
        if (await this.ownerLive(persisted)) { if (ACTIVE.has(persisted.status)) throw new StudioError("DEVRUN_LOCKED", 409); }
        else staleOwner = {pid: persisted.ownerPid, instanceId: persisted.instanceId};
      }
      if (aborted()) return await this.abortStart(project, a);
      a.release = this.takeLock(id, staleOwner);
      // Dev workspace: yönetilen deponun HEAD'inin taze çalışma kopyası (run workspace'leri asla kullanılmaz).
      const ws = path.join(this.dir(id), "workspace");
      fs.rmSync(ws, {recursive: true, force: true});
      const c = this.o.studio.git(this.dir(id), ["clone", "--no-hardlinks", "--quiet", "--", repo, ws]);
      // B-RUN-1: teslim kaydına bağlıysa çalışan şey deponun HEAD'i değil TESLİM EDİLEN commit'tir.
      if (c.status === 0 && link && (!/^[0-9a-f]{40}$/.test(link.headSha) || this.o.studio.git(ws, ["checkout", "--detach", "--quiet", link.headSha]).status !== 0)) throw new StudioError("DEVRUN_BLOCKED", 409, "DEVRUN_DELIVERY_HEAD_MISSING");
      const head = c.status === 0 ? String(this.o.studio.git(ws, ["rev-parse", "HEAD"]).stdout ?? "").trim() : "";
      if (!/^[0-9a-f]{40}$/.test(head)) throw new StudioError("DEVRUN_BLOCKED", 409, "DEVRUN_WORKSPACE_FAILED");
      st.headSha = head;
      if (link) { if (head !== link.headSha) throw new StudioError("DEVRUN_BLOCKED", 409, "DEVRUN_DELIVERY_HEAD_MISSING"); st.deliveryRunId = link.runId; }
      const port = await this.o.freePort();
      // PS1A-C1-F2: port beklenirken stop/stopAll/GLOBAL_STOP geldiyse süreç BAŞLATILMAZ (izlenmeyen süreç sızıntısı yok).
      if (aborted()) return await this.abortStart(project, a);
      st.port = port;
      const env = {...safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}), PORT: String(st.port), HOST: "127.0.0.1"};
      const exe = argv[0] === "node" ? process.execPath : argv[0];
      // SBX-GATE: süreç ana makinede değil, kapının doğruladığı sağlayıcıda başlatılır.
      // Zaten doğrulanmamış bir sağlayıcıda süreç BAŞLATILMAZ (kapının önbelleği eski olabilir).
      { const vp = gate.provider as {isVerified?(): boolean}; if (typeof vp.isVerified === "function" && vp.isVerified() !== true) throw new StudioError("SANDBOX_UNAVAILABLE", 409, "SANDBOX_UNVERIFIED"); }
      let spawnDone: () => void = () => undefined;
      a.spawning = new Promise<void>(r => { spawnDone = r; }); spawnDoneRef = () => spawnDone();
      const spawnOpts = {cwd: ws, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", shouldAbort: aborted};
      // B-RUN-WIN-1: eşzamansız hazırlık gerektiren sağlayıcı (WSL) spawnAsync sunar; yoksa eşzamanlı spawn.
      const child: SandboxChild = gate.provider.spawnAsync ? await gate.provider.spawnAsync(exe, argv.slice(1), spawnOpts) : gate.provider.spawn(exe, argv.slice(1), spawnOpts);
      a.child = child; a.provider = gate.provider; if (child.sandboxScratch) st.sandboxScratch = child.sandboxScratch;
      a.rootExited = new Promise<void>(resolve => { child.once("exit", () => resolve()); child.once("error", () => { if (child.pid === undefined) resolve(); }); });
      a.exited = new Promise<void>(resolve => {
        // PS1A-C2-F2: çıkış (çökme veya durdurma) sonrası kalan ağaç (ayrık torunlar dahil) temizlenmeden exited çözülmez.
        child.once("exit", (code, signal) => { this.onExit(a, code, signal); a.teardown = Promise.resolve(child.sandboxTeardown).catch(() => "TEARDOWN_ERROR").then(td => this.noteTeardown(a, td)); void Promise.all([this.reapTree(a).catch(() => undefined), a.teardown]).finally(resolve); });
        child.once("error", () => { if (child.pid === undefined) { this.onExit(a, null, null, "DEVRUN_SPAWN_FAILED"); resolve(); } });
      });
      this.reaping.set(id, a.exited); void a.exited.finally(() => { if (this.reaping.get(id) === a.exited) this.reaping.delete(id); });
      child.stdout?.on("data", (b: Buffer) => { a.stdout.push(b); this.scheduleFlush(a); });
      child.stderr?.on("data", (b: Buffer) => { a.stderr.push(b); this.scheduleFlush(a); });
      spawnDoneRef(); // kurulum bitti, tüm çıkış/teardown izleyicileri bağlı: stop artık çocuğu ve sağlayıcı kapatmasını bekleyebilir
      if (child.pid === undefined) { await a.exited; return this.view(project); }
      st.pid = child.pid;
      // NEW-3: sağlayıcı-taraflı scratch, köprü kurulumundan ÖNCE kalıcı yazılır (API bu aralıkta çökerse recover() Linux tarafını kapatabilsin).
      if (st.sandboxScratch && ACTIVE.has(st.status)) { try { this.writeState(st, true); } catch { /* durum yazılamadı */ } }
      // B-RUN-WIN-1: eşzamansız hazırlık sırasında (spawnAsync) stop/GLOBAL_STOP geldiyse yeni süreç hemen sonlandırılır (aşağıdaki aborted() denetimi çıkışı bekler).
      if (a.stopping || this.stopActive() !== null) killProcessTree(child.pid);
      // B-RUN-1: köprü (yalnız ağ-izole sağlayıcılarda): ana makine 127.0.0.1:port -> sandbox 127.0.0.1:port. Açılamazsa süreç durdurulur ve çalıştırma BLOCKED olur.
      if (bridge.start) {
        try { a.bridge = await bridge.start(child, st.port); st.bridged = true; }
        catch (e) { a.stopping = true; killProcessTree(child.pid); await timed(a.exited, 10_000, undefined); throw new StudioError("DEVRUN_BLOCKED", 409, `DEVRUN_BRIDGE_FAILED:${e instanceof Error ? e.message.slice(0, 60) : "ERROR"}`); }
      }
      st.pidStartTime = await this.o.startTimeOf(child.pid);
      // Spawn'dan sonraki await sırasında durdurma geldiyse: stop() çocuğu sonlandırır (a.child atanmıştır); bant dışı GLOBAL_STOP burada da uygulanır.
      if (aborted()) {
        if (!a.stopping && this.active.get(id) === a) await this.stopDetailed(id, "GLOBAL_STOP_ACTIVE");
        else await timed(a.exited, 15_000, undefined);
        if (this.stopActive()) throw new StudioError("GLOBAL_STOP_ACTIVE", 423);
        return this.view(project);
      }
      if (ACTIVE.has(st.status)) this.writeState(st, true);
      this.o.audit("DEVRUN_STARTED", {projectId: id, pid: child.pid, port: st.port, headSha: head});
      this.ensureStopWatch();
      this.snapshotLoop(a);
      if (NO_PREVIEW_TYPES.has(String(project.projectType))) st.preview = {url: null, state: "UNAVAILABLE", lastProbeAt: null, reason: "PREVIEW_NOT_SUPPORTED_FOR_PROJECT_TYPE"};
      else { st.preview = {url: null, state: "UNAVAILABLE", lastProbeAt: null, reason: "PROBE_PENDING"}; this.probeLoop(a); }
      // İlk yoklama başarısı, süreç çıkışı veya (önizlemesiz/yanıtsız) grace süresi beklenir.
      const deadline = Date.now() + this.o.startWaitMs, graceAt = Date.now() + this.o.graceMs;
      while (Date.now() < deadline && st.status === "STARTING") {
        if (st.preview.state === "AVAILABLE") break;
        if (Date.now() >= graceAt && NO_PREVIEW_TYPES.has(String(project.projectType))) break;
        await sleep(50);
      }
      if (st.status === "STARTING" && a.child && a.child.exitCode === null) { st.status = "RUNNING"; this.writeState(st); }
      return this.view(project);
    } catch (e) {
      spawnDoneRef();
      if (a.child && a.child.exitCode === null && a.child.pid) { a.stopping = true; killProcessTree(a.child.pid); await timed(a.exited, 10_000, undefined); }
      // D1/L4: sağlayıcı hazırlığı iptal/doğrulama kaybıyla yarıda kaldı ve scratch temizlenemediyse tanıtıcı KALICI yazılır (recover() Linux tarafını kapatır).
      const incompleteCode = (e as {cleanupCode?: unknown} | null)?.cleanupCode, scratch = (e as {sandboxScratch?: unknown} | null)?.sandboxScratch;
      if (typeof incompleteCode === "string" && typeof scratch === "string") { a.state.stopIncomplete = incompleteCode; a.state.sandboxScratch = scratch; }
      this.cleanup(a);
      if (this.active.get(id) === a) this.active.delete(id);
      const inc = a.state.stopIncomplete ?? this.readState(id)?.stopIncomplete;
      if (a.state.stopIncomplete && a.state.sandboxScratch) { try { this.writeState({...this.blank(project), status: "BLOCKED", reason: `STOP_INCOMPLETE:${a.state.stopIncomplete}`, endedAt: new Date().toISOString(), stopIncomplete: a.state.stopIncomplete, sandboxScratch: a.state.sandboxScratch}, true); } catch { /* durum yazılamadı */ } }
      if (e instanceof StudioError && e.code === "DEVRUN_BLOCKED") {
        try { this.block(project, e.reason ?? "DEVRUN_BLOCKED"); } catch (be) { if (inc) throw new StudioError("DEVRUN_STOP_INCOMPLETE", 409, inc); throw be; }
      }
      // Hazırlık sırasında stop/close geldi: hata değil, iptal edilmiş başlatma.
      if (e instanceof Error && /SANDBOX_REFUSED: ABORTED/.test(e.message)) {
        if (inc) throw new StudioError("DEVRUN_STOP_INCOMPLETE", 409, inc);
        if (this.closed) throw new StudioError("DEVRUN_CLOSED", 409);
        return this.view(project);
      }
      if (inc && !(e instanceof StudioError)) throw new StudioError("DEVRUN_STOP_INCOMPLETE", 409, inc);
      throw e;
    }
  }

  // PS1A-C1-F2: süreç başlatılmadan önce durdurma/GLOBAL_STOP geldiyse kayıt (henüz sonlandırılmadıysa) STOPPED olarak kapatılır; GLOBAL_STOP 423 döner.
  private async abortStart(project: Project, a: Active): Promise<DevRunView> {
    const g = this.stopActive();
    if (this.active.get(project.projectId) === a) { a.stopping = true; a.state.reason = a.state.reason ?? (g ? "GLOBAL_STOP_ACTIVE" : "STOP_REQUESTED"); this.onExit(a, null, null); }
    if (g) throw new StudioError("GLOBAL_STOP_ACTIVE", 423);
    return this.view(project);
  }
  private probeLoop(a: Active): void {
    const tick = async () => {
      a.probeTimer = null;
      if (!ACTIVE.has(a.state.status) || !a.state.port) return;
      this.checkProvider(a);
      if (a.blockedReason) return;
      const code = await probe(a.state.port);
      if (!ACTIVE.has(a.state.status)) return;
      const at = new Date().toISOString();
      // Önizleme yalnız gerçek bir HTTP yanıtı (5xx değil) alınınca AVAILABLE olur; sahte önizleme yoktur.
      if (code !== null && code < 500) { a.state.preview = {url: `http://127.0.0.1:${a.state.port}/`, state: "AVAILABLE", lastProbeAt: at}; if (a.state.status === "STARTING") a.state.status = "RUNNING"; }
      else a.state.preview = {url: null, state: "UNAVAILABLE", lastProbeAt: at, reason: code === null ? "PROBE_FAILED" : "PROBE_HTTP_ERROR"};
      this.writeState(a.state);
      a.probeTimer = setTimeout(() => void tick(), a.state.preview.state === "AVAILABLE" ? Math.max(this.o.probeIntervalMs, 5_000) : this.o.probeIntervalMs);
      a.probeTimer.unref?.();
    };
    a.probeTimer = setTimeout(() => void tick(), 100);
    a.probeTimer.unref?.();
  }
  // PS1A-C2-F2: Windows'ta kök canlıyken soy süreçler periyodik kaydedilir; ara ebeveyn öldükten sonra kök çökerse torun bu kayıtla bulunur.
  private rootInfo(a: Active): {pid: number; notBefore: number; startTime: number | null} | null {
    const pid = a.child?.pid, nb = Date.parse(a.state.startedAt ?? "");
    if (!pid || !Number.isFinite(nb)) return null;
    // Linux: pidStartTime /proc tik sayısıdır; listProcesses ile aynı dönüşümle ms'ye çevrilir (Date.parse rakam dizisini geçerli ama anlamsız bir yıl sayar).
    return {pid, notBefore: nb - 1000, startTime: startTimeMs(a.state.pidStartTime)};
  }
  // Windows ve Linux: kök canlıyken soy periyodik kaydedilir. Linux'ta kök (veya ara ebeveyn) ölünce yetimler init'e/alt toplayıcıya bağlanır (ppid kaybolur);
  // bu yüzden ayrık (setsid) torunlar yalnız bu kayıtla bulunabilir.
  private snapshotLoop(a: Active): void {
    if (!PROCESS_LIST_SUPPORTED || !this.o.treeSnapshotMs || a.snapTimer) return;
    let busy = false;
    a.snapTimer = setInterval(() => {
      if (busy || !ACTIVE.has(a.state.status)) return;
      const root = this.rootInfo(a); if (!root) return;
      busy = true;
      void listProcesses().then(ps => { if (ps && ACTIVE.has(a.state.status)) for (const d of treeDescendants(ps, root, a.known)) a.known.set(d.pid, d.created); }).finally(() => { busy = false; });
    }, this.o.treeSnapshotMs);
    a.snapTimer.unref?.();
  }
  // POSIX durdurma: kök öldürülmeden hemen önce soy bir kez daha kaydedilir (son periyodik görüntüden sonra doğan setsid'li torunlar da reapTree'de bulunur).
  private async recordTree(a: Active): Promise<void> {
    const root = this.rootInfo(a); if (!root) return;
    const ps = await listProcesses().catch(() => null);
    if (ps) for (const d of treeDescendants(ps, root, a.known)) a.known.set(d.pid, d.created);
  }
  private async reapTree(a: Active): Promise<void> {
    if (a.snapTimer) clearInterval(a.snapTimer); a.snapTimer = null;
    const root = this.rootInfo(a);
    if (!root) return;
    let method: NonNullable<DevRunState["treeCleanup"]>["method"], victims: number[] = [];
    if (process.platform !== "win32") {
      // Önce süreç grubu (grup üyeleri atomik olarak); ardından setsid ile gruptan kaçan kaydedilmiş/ppid bağlı soy da tek tek SIGKILL edilir.
      try { process.kill(-root.pid, "SIGKILL"); } catch { /* grup boş */ }
      const ps = await listProcesses();
      if (!ps) method = "PROCESS_GROUP";
      else {
        method = "PROCESS_GROUP_PPID_WALK";
        victims = treeDescendants(ps, root, a.known).map(p => p.pid);
        for (const v of victims) { try { process.kill(v, "SIGKILL"); } catch { /* bu arada bitti */ } }
        for (let i = 0; i < 30 && victims.some(pidAlive); i++) await sleep(100);
      }
    } else {
      const ps = await listProcesses();
      if (!ps) method = "UNAVAILABLE";
      else {
        method = "PPID_WALK";
        victims = treeDescendants(ps, root, a.known).map(p => p.pid);
        for (let i = 0; i < victims.length; i += 20) {
          const tk = systemExe("taskkill.exe"); if (tk) cp.spawnSync(tk, ["/F", "/T", ...victims.slice(i, i + 20).flatMap(p => ["/PID", String(p)])], {windowsHide: true, stdio: "ignore", timeout: 15_000});
        }
        for (let i = 0; i < 30 && victims.some(pidAlive); i++) await sleep(100);
      }
    }
    const st = a.state;
    // PROCESS_GROUP / UNAVAILABLE: süreç listesi alınamadı, kalan süreç sayılamaz => survivors null + UNVERIFIED (0 DEĞİL).
    const verifiable = method === "PPID_WALK" || method === "PROCESS_GROUP_PPID_WALK";
    st.treeCleanup = {at: new Date().toISOString(), method, killed: victims.length, survivors: verifiable ? victims.filter(pidAlive).length : null, verification: verifiable ? "VERIFIED" : "UNVERIFIED"};
    if (victims.length || method === "UNAVAILABLE") this.o.audit("DEVRUN_TREE_REAPED", {projectId: st.projectId, method, killed: victims.length, survivors: st.treeCleanup.survivors});
    // Yalnız aynı çalıştırmanın kaydı hâlâ geçerliyse yazılır (bu arada başlatılan yeni çalıştırma ezilmez).
    const cur = this.readState(st.projectId);
    if (!this.active.has(st.projectId) && cur && cur.instanceId === this.instanceId && cur.startedAt === st.startedAt && !ACTIVE.has(cur.status)) { try { this.writeState(st); } catch { /* durum yazılamadı */ } }
  }
  private cleanup(a: Active): void {
    try { a.bridge?.close(); } catch { /* kapalı */ }
    a.bridge = null;
    if (a.probeTimer) clearTimeout(a.probeTimer); a.probeTimer = null;
    if (a.flushTimer) clearTimeout(a.flushTimer); a.flushTimer = null;
    // Hiç süreç başlatılmadıysa (kilitli/iptal) önceki örneğin kalıcı logları boş halkayla ezilmez.
    if (a.child) this.flushLogs(a);
    try { a.release?.(); } catch { /* kilit devralınmış olabilir */ }
    a.release = null;
  }
  private onExit(a: Active, code: number | null, signal: NodeJS.Signals | null, reason?: string): void {
    const st = a.state;
    st.endedAt = new Date().toISOString(); st.exitCode = code; st.signal = signal ?? null;
    delete st.stopTimedOut;
    st.status = a.blockedReason ? "BLOCKED" : a.stopping ? "STOPPED" : "CRASHED";
    st.reason = a.blockedReason ? a.blockedReason : a.stopping ? (st.reason ?? "STOP_REQUESTED") : (reason ?? `PROCESS_EXITED${code !== null ? `:${code}` : signal ? `:${signal}` : ""}`);
    st.preview = {url: null, state: "UNAVAILABLE", lastProbeAt: st.preview.lastProbeAt, reason: "NOT_RUNNING"};
    this.cleanup(a);
    // D1: geç çıkış, AYNI projenin yeni (etkin) çalıştırmasının kaydını ezmez (startedAt sahipliği).
    const own = this.readState(st.projectId);
    if (!own || own.startedAt === st.startedAt || !ACTIVE.has(own.status)) { try { this.writeState(st); } catch { /* durum yazılamadı */ } }
    if (this.active.get(st.projectId) === a) this.active.delete(st.projectId);
    this.o.audit(a.stopping ? "DEVRUN_STOPPED" : "DEVRUN_CRASHED", {projectId: st.projectId, exitCode: code, signal: signal ?? null, reason: st.reason});
  }

  // Durdurma sonucu: NOT_ACTIVE (çalışan yok), STOPPED (çıkış görüldü), TIMEOUT (süre doldu, ağaç hâlâ canlı olabilir: çalıştırma aktif kalır, STOPPED yazılmaz).
  async stopDetailed(projectId: string, reason = "STOP_REQUESTED"): Promise<"NOT_ACTIVE" | "STOPPED" | "TIMEOUT" | "INCOMPLETE"> {
    this.startGen.set(projectId, (this.startGen.get(projectId) ?? 0) + 1);
    const a = this.active.get(projectId);
    if (!a) return "NOT_ACTIVE";
    a.stopping = true; a.state.reason = reason;
    // D1: sandbox hâlâ kuruluyorsa 'STOPPED' denmez; kurulum (ve iptal edildiyse sökülme) beklenir, süre dolarsa TIMEOUT (stop 409 DEVRUN_STOP_TIMEOUT).
    if (a.spawning && !(await timed(a.spawning.then(() => true), this.o.stopWaitMs, false))) return "TIMEOUT";
    const running = () => Boolean(a.child?.pid && a.child.exitCode === null && a.child.signalCode === null);
    // POSIX: kök ölünce yetimlerin ppid'si kaybolur; öldürmeden önce soy kaydedilir. Bekleme sonrası kök hâlâ çalışıyorsa öldürülür (toplanmış pid'e sinyal yok). Windows davranışı değişmez.
    if (running() && process.platform !== "win32" && PROCESS_LIST_SUPPORTED) await this.recordTree(a);
    if (running()) killProcessTree(a.child!.pid!);
    // Bütçe 1: kök çıkışı + sağlayıcının Linux-tarafı kapatması (stop bunları bekler). Bütçe 2 (ağaç temizliği, reapTree) arka planda sürer.
    const exited = await timed(a.rootExited.then(() => a.teardown).then(() => true), this.o.stopWaitMs, false);
    if (!exited) {
      // Süreç ağacının öldüğü doğrulanmadı: STOPPED yazılmaz, çalıştırma aktif kalır (kilit/port/pid sahipliği korunur) ve yeni bir başlatma reddedilir.
      a.state.stopTimedOut = true;
      try { this.writeState(a.state); } catch { /* durum yazılamadı */ }
      this.o.audit("DEVRUN_STOP_TIMEOUT", {projectId, pid: a.state.pid, waitedMs: this.o.stopWaitMs, reason});
      return "TIMEOUT";
    }
    if (this.active.get(projectId) === a) { this.onExit(a, a.child?.exitCode ?? null, null); }
    // NEW-2: sağlayıcı-taraflı kapatma temiz bitmediyse (STOP_INCOMPLETE:<kod>) süreç durdu ama Linux tarafı temiz DEĞİL: "STOPPED" denmez.
    return a.state.stopIncomplete ? "INCOMPLETE" : "STOPPED";
  }
  // Açık durdur çağrısı: zaman aşımında 409 DEVRUN_STOP_TIMEOUT (eski davranış "STOPPED" yalan söylüyordu); başka durumda eski boolean sözleşmesi.
  async stop(projectId: string, reason = "STOP_REQUESTED"): Promise<boolean> {
    const r = await this.stopDetailed(projectId, reason);
    if (r === "TIMEOUT") throw new StudioError("DEVRUN_STOP_TIMEOUT", 409);
    if (r === "INCOMPLETE") throw new StudioError("DEVRUN_STOP_INCOMPLETE", 409, this.readState(projectId)?.stopIncomplete ?? "TEARDOWN_INCOMPLETE");
    return r === "STOPPED";
  }
  async restart(project: Project): Promise<DevRunView> { await this.stop(project.projectId, "RESTART_REQUESTED"); return this.start(project); }
  async stopAll(reason: string): Promise<string[]> { this.stopEpoch++; const ids = [...this.active.keys()]; await Promise.all(ids.map(id => this.stopDetailed(id, reason))); return ids; }

  private stopActive(): string | null { try { const s = globalStopState(this.o.globalStopFile); return s ? String(s.reason ?? "GLOBAL_STOP_ACTIVE") : null; } catch { return "GLOBAL_STOP_STATE_UNSAFE"; } }
  // Bant dışı GLOBAL_STOP (dosya) da izlenir: aktif dev-run varken periyodik kontrol, aktifse hepsi durdurulur.
  private ensureStopWatch(): void {
    if (this.stopTimer) return;
    this.stopTimer = setInterval(() => {
      if (!this.active.size) { if (this.stopTimer) clearInterval(this.stopTimer); this.stopTimer = null; return; }
      if (this.stopActive()) void this.stopAll("GLOBAL_STOP_ACTIVE");
      else for (const a of this.active.values()) this.checkProvider(a);
    }, this.o.stopPollMs);
    this.stopTimer.unref?.();
  }
  async close(): Promise<void> { this.closed = true; await this.stopAll("API_SHUTDOWN"); await timed(Promise.all([...this.reaping.values()]).then(() => undefined), this.o.stopWaitMs, undefined); await timed(this.settleRecovery(), this.o.stopWaitMs, undefined); if (this.stopTimer) clearInterval(this.stopTimer); this.stopTimer = null; }

  // PS-AT-004: API yeniden başladığında STARTING/RUNNING kayıtları incelenir. Sahibi canlı başka bir API süreciyse dokunulmaz; değilse süreç sahipsizdir:
  // pid canlı ve başlangıç zamanı kayıtla birebir aynıysa süreç ağacı sonlandırılır, değilse (pid yeniden kullanılmış/doğrulanamıyor) ÖLDÜRÜLMEZ ve raporlanır.
  // Sağlayıcıya dokunan kurtarma (authorize/selfTest, teardownScratch) başlangıcı bekletmez: arka plan görevi, sınırlı süre; sonuç kayda yazılır (temizse silinir, değilse STOP_INCOMPLETE:<kod>).
  private readonly bgTasks = new Set<Promise<void>>();
  private scheduleScratch(id: string, st: DevRunState): void {
    const t = (async () => {
      const td = await timed(this.recoverScratch(st), this.o.recoverTeardownMs ?? 30_000, {code: "TEARDOWN_TIMEOUT"});
      const cur = this.readState(id); if (!cur || cur.sandboxScratch !== st.sandboxScratch || ACTIVE.has(cur.status)) return;
      try {
        if (!td.code) this.writeState({...cur, stopIncomplete: undefined, sandboxScratch: null, reason: cur.stopIncomplete ? "STOP_INCOMPLETE_RESOLVED" : cur.reason}, true);
        else this.writeState({...cur, stopIncomplete: td.code, reason: `STOP_INCOMPLETE:${td.code}`}, true);
      } catch { /* durum yazılamadı */ }
    })().catch(() => undefined);
    this.bgTasks.add(t); void t.finally(() => this.bgTasks.delete(t));
  }
  /** Arka plan kurtarma görevlerinin bitmesini bekler (testler ve kapanış). */
  async settleRecovery(): Promise<void> { await Promise.all([...this.bgTasks]); }
  private async recoverScratch(st: DevRunState): Promise<{code: string | null}> {
    if (!st.sandboxScratch) return {code: null};
    let provider: {teardownScratch?: (s: string) => Promise<string | null>} | null = null;
    try { const g = await this.o.executionGate?.authorize("STUDIO_DEVRUN"); provider = g && g.allowed ? g.provider : null; } catch { provider = null; }
    return this.recoverScratchWith(st, provider);
  }
  private async recoverScratchWith(st: DevRunState, provider: {teardownScratch?: (s: string) => Promise<string | null>} | null): Promise<{code: string | null}> {
    if (!st.sandboxScratch) return {code: null};
    if (!provider || typeof provider.teardownScratch !== "function") return {code: "SANDBOX_PROVIDER_UNAVAILABLE"};
    try { return {code: await provider.teardownScratch(st.sandboxScratch)}; } catch { return {code: "TEARDOWN_ERROR"}; }
  }
  async recover(): Promise<Array<{projectId: string} & DevRunRecovery>> {
    const root = path.join(this.o.studio.dataDir, "projects");
    let ids: string[] = [];
    try { ids = fs.readdirSync(root).filter(x => /^prj_[0-9a-f]{24}$/.test(x)); } catch { return []; }
    const out: Array<{projectId: string} & DevRunRecovery> = [];
    const self = await this.ownStartTime();
    for (const id of ids) {
      const st = this.readState(id);
      // C-5: önceki kapatma temiz bitmediyse (STOP_INCOMPLETE + scratch) sahip canlı değilse Linux tarafı yeniden denenir.
      if (st && !ACTIVE.has(st.status) && st.sandboxScratch && st.instanceId !== this.instanceId && !this.active.has(id) && st.ownerHost === os.hostname() && !(await this.ownerLive(st))) {
        this.scheduleScratch(id, st); // sağlayıcıya dokunur: sunucu açılışını ASLA bekletmez (arka planda, sınırlı süre)
        continue;
      }
      if (!st || !ACTIVE.has(st.status) || st.instanceId === this.instanceId || this.active.has(id)) continue;
      if (st.ownerHost !== os.hostname()) continue;
      // PS1A-C1-F3: canlı başka API süreci yalnız pid + başlangıç zamanı eşleşirse; yeniden kullanılmış pid sahibi canlı saymaz.
      if (await this.ownerLive(st)) continue;
      const ownerReused = st.ownerPid !== process.pid && pidAlive(st.ownerPid);
      let result: DevRunRecovery["result"];
      if (!pidAlive(st.pid)) result = "ORPHAN_ALREADY_EXITED";
      else {
        const now = st.pid ? await this.o.startTimeOf(st.pid) : null;
        if (!now || !st.pidStartTime || now !== st.pidStartTime) result = "ORPHAN_PID_MISMATCH_NOT_KILLED";
        else { killProcessTree(st.pid!); for (let i = 0; i < 50 && pidAlive(st.pid); i++) await sleep(100); result = pidAlive(st.pid) ? "ORPHAN_KILL_FAILED" : "ORPHAN_KILLED"; }
      }
      // C-5: sağlayıcı-taraflı scratch (WSL) Linux tarafında kapatılır; kapatılamazsa kayıt STOP_INCOMPLETE ile scratch'ı korur.
      const pendingScratch = Boolean(st.sandboxScratch); // kapatma arka planda (scheduleScratch) denenir; sonuç kayda yazılır
      const rec: DevRunRecovery = {at: new Date().toISOString(), result, previousInstanceId: st.instanceId, pid: st.pid};
      const next: DevRunState = {...st, status: result === "ORPHAN_KILL_FAILED" ? "CRASHED" : "STOPPED", reason: pendingScratch ? "STOP_INCOMPLETE:TEARDOWN_PENDING" : `RECOVERED_AFTER_API_RESTART:${result}`, ...(pendingScratch ? {stopIncomplete: "TEARDOWN_PENDING", sandboxScratch: st.sandboxScratch ?? null} : {sandboxScratch: null}), endedAt: rec.at, instanceId: this.instanceId, ownerPid: process.pid, ownerHost: os.hostname(), ownerStartTime: self,
        preview: {url: null, state: "UNAVAILABLE", lastProbeAt: st.preview?.lastProbeAt ?? null, reason: "NOT_RUNNING"}, recovery: rec};
      this.writeState(next, true);
      const lf = this.lockFile(id), ls = inspectProcessLock(lf) as {state: string; pid?: number; runId?: string | null};
      const reusedLock = ownerReused && ls.state === "ACTIVE" && ls.pid === st.ownerPid && ls.runId === st.instanceId;
      if (ls.state !== "ABSENT" && (ls.pid === process.pid || ls.state === "STALE_SAME_HOST_DEAD_PID" || reusedLock)) { try { fs.rmSync(lf, {force: true}); } catch { /* kilit */ } }
      this.o.audit("DEVRUN_ORPHAN_RECOVERED", {projectId: id, result, pid: st.pid});
      if (pendingScratch) this.scheduleScratch(id, {...next, stopIncomplete: undefined});
      out.push({projectId: id, ...rec});
    }
    this.recoveries.push(...out);
    return out;
  }
}
