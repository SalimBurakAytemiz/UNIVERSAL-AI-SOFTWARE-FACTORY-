// //TR: PAR-04 (C-PAR-1): workspace sahipliği ve eski yazarın durdurulması. Bir engine çökerse (veya lease'i dolarsa) implementer/reviewer/git çocuğu runs/<id>/work içine yazmaya devam edebilir; devralan engine workspace'e dokunmadan önce o yazarı durdurmak zorundadır. Bu modül: (1) runs/<id>/workspace.owner.json kaydı (atomik, fsync'li, .prev kopyalı; önyükleme kimliği ile), (2) süreç grubu durumu ve kimlik belirteci (pid yeniden kullanımı yabancı bir süreci öldürtmesin), (3) kimliği kanıtlanmış grubun öldürülmesi, (4) setsid ile gruptan kaçan torunlar için lease-işaretli /proc taraması, (5) süreç sonlanırken (SIGINT/SIGTERM/SIGHUP/exit) kayıtlı grupların öldürülmesi. Karar mantığı runner.ts'tedir (reapPriorWriter); burada yalnız mekanizma ve saf yardımcılar vardır.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
// //TR: automation/lib korumalı olduğundan atomic-json.mjs için .d.mts eklenemez; store.ts ile aynı dar yerel tip kullanılır, helper kopyalanmaz.
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok
import {writeJsonAtomic as writeJsonAtomicUntyped} from "../../automation/lib/atomic-json.mjs";
import type {RunStep} from "./types.js";

const writeJsonAtomic = writeJsonAtomicUntyped as (file: string, value: unknown) => void;

export interface WorkspaceOwner { leaseId: string; engineId: string; hostname: string; pid: number; childPgid: number | null; childStart: string | null; step: RunStep; at: string; bootId: string | null }
export const OWNER_FILE = "workspace.owner.json";
export const WRITER_KILL_WAIT_MS = 5_000;
// //TR: Windows/macOS'ta önyükleme kimliği uptime'dan türetilir (saniye çözünürlüğü, sapma olabilir): iki okuma bu eşiğin altında farklıysa AYNI önyükleme sayılır (güvenli yön: eski yazar yaşıyor olabilir varsayılır).
const BOOT_SLACK_MS = 60_000;
// //TR: Lease işareti: implementer/reviewer/git çocuklarının ortamına eklenir; torunlar setsid ile gruptan kaçsa bile ortamı miras alır. Tarama (sweepWriters) bu değişkenle çalışır.
export const WRITER_ENV_RUN = "UASCO_WRITER_RUN";
export const WRITER_ENV_LEASE = "UASCO_WRITER_LEASE";
export const writerEnvFor = (runId: string, leaseId: string): Record<string, string> => ({[WRITER_ENV_RUN]: runId, [WRITER_ENV_LEASE]: leaseId});

export const isOwner = (x: unknown): x is WorkspaceOwner => {
  const o = x as WorkspaceOwner | null;
  return !!o && typeof o === "object" && typeof o.leaseId === "string" && typeof o.engineId === "string" && typeof o.hostname === "string" && Number.isSafeInteger(o.pid)
    && (o.childPgid === null || (Number.isSafeInteger(o.childPgid) && o.childPgid > 1)) && (o.childStart === null || typeof o.childStart === "string") && typeof o.step === "string" && typeof o.at === "string"
    && (o.bootId === undefined || o.bootId === null || typeof o.bootId === "string");
};

// ---- önyükleme kimliği ----
export function bootId(): string | null {
  if (process.platform === "linux") {
    try { const id = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); return id ? `linux:${id}` : null; } catch { return null; }
  }
  return `up:${Math.round((Date.now() - os.uptime() * 1000) / 1000)}`;
}
export function sameBoot(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a.startsWith("up:") && b.startsWith("up:")) return Math.abs(Number(a.slice(3)) - Number(b.slice(3))) * 1000 <= BOOT_SLACK_MS;
  return a === b;
}
export const bootTimeMs = (): number => Date.now() - os.uptime() * 1000;

// ---- sahiplik kaydı ----
export type OwnerRead = {kind: "ABSENT"} | {kind: "OK"; rec: WorkspaceOwner} | {kind: "INVALID"; why: string; mtimeMs: number | null};
// //TR: Yalnız ana dosya okunur; .prev yedeğine DÜŞÜLMEZ (yırtık bir yazı çocuğu yeni kaydetmiş olabilir: eski kayıt "yazar yok" derdi). Yırtık/okunamayan kayıt önyüklemeden ESKİYSE (süreçler yeniden başlatmadan sağ çıkmaz) çağıran "yazar yok" sayar; değilse fail-closed.
export function readOwner(file: string): OwnerRead {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? {kind: "ABSENT"} : {kind: "INVALID", why: "owner record unreadable", mtimeMs: null}; }
  let prev: unknown = null;
  try { prev = JSON.parse(raw); } catch { /* aşağıda geçersiz */ }
  if (isOwner(prev)) return {kind: "OK", rec: {...prev, bootId: prev.bootId ?? null}};
  let mtimeMs: number | null = null;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* yok say */ }
  return {kind: "INVALID", why: "owner record invalid", mtimeMs};
}
// //TR: fsync'li geçici dosya + .prev kopyası + rename (başarısızsa kopya) + dizin fsync (automation/lib/atomic-json.mjs): güç kesintisinde yırtık kayıt penceresi kapanır.
export function writeOwner(file: string, rec: WorkspaceOwner): void { writeJsonAtomic(file, rec); }

// ---- süreç grubu durumu ve kimlik belirteci ----
export interface GroupMember { pid: number; state: string; start: number }
// Linux: /proc taraması; okunamazsa null (çağıran fail-closed davranır). Zombi (Z) ve ölü (X) üyeler yazamaz, sayılmaz.
export function groupMembers(pgid: number): GroupMember[] | null {
  try {
    const out: GroupMember[] = [];
    for (const name of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      let st: string;
      try { st = fs.readFileSync(`/proc/${name}/stat`, "utf8"); } catch { continue; }
      const f = st.slice(st.lastIndexOf(")") + 2).split(" "); // f[0] = durum, f[2] = süreç grubu, f[19] = başlangıç (saat tiki)
      if (Number(f[2]) === pgid && f[0] !== "Z" && f[0] !== "X") out.push({pid: Number(name), state: f[0]!, start: Number(f[19])});
    }
    return out;
  } catch { return null; }
}
// POSIX: çocuk yeni oturumun/grubun lideridir (pgid = pid) ve sinyal tüm gruba gider; Windows: grup yok, pid çocuk ağacının köküdür (taskkill /T). EPERM = grup var ama hiçbir üyesine sinyal gönderme yetkimiz yok (bizim çocuğumuz aynı kullanıcıdır, yani bu grup bizim DEĞİL olabilir) = OTHER_USER; kimlik belirteci karşılaştırması çağırandadır.
export function writerState(pgid: number): "ALIVE" | "GONE" | "OTHER_USER" | "UNKNOWN" {
  try { process.kill(process.platform === "win32" ? pgid : -pgid, 0); } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ESRCH" ? "GONE" : code === "EPERM" ? "OTHER_USER" : "UNKNOWN";
  }
  if (process.platform !== "linux") return "ALIVE";
  const m = groupMembers(pgid); // zombi üyeler kill(-pgid, 0)'ı sonsuza dek başarılı tutardı; /proc okunamazsa canlı varsayılır (fail-closed)
  return m === null || m.length > 0 ? "ALIVE" : "GONE";
}
// //TR: pid/pgid yeniden kullanımı (yeniden başlatma, pid sarması) yabancı bir süreci öldürtmesin diye lider sürecin BAŞLANGIÇ zamanı kayıtlıdır: Linux /proc/<pid>/stat 22. alan (dünya okunur); diğerlerinde ps/PowerShell (eşzamansız, yalnız devir yolunda).
export function startTokenLinux(pid: number): string | null {
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return st.slice(st.lastIndexOf(")") + 2).split(" ")[19] ?? null; } catch { return null; }
}
// //TR: Saf komut kurucu (testlerde kontrol edilir). macOS/BSD `ps -o lstart=` YEREL saatle yazar: TZ/LANG farklı iki engine aynı süreç için farklı belirteç görür ve "pid yeniden kullanıldı" sanıp canlı yazarı öldürmezdi (fail-open). Bu yüzden mutlak /bin/ps ve sabitlenmiş ortam (LC_ALL=C, TZ=UTC0) kullanılır.
export function startTokenCommand(platform: NodeJS.Platform, pid: number): {cmd: string; args: string[]; env?: NodeJS.ProcessEnv} {
  if (platform === "win32") return {cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]};
  return {cmd: "/bin/ps", args: ["-o", "lstart=", "-p", String(pid)], env: {LC_ALL: "C", LANG: "C", TZ: "UTC0", PATH: "/bin:/usr/bin"}};
}
export function startToken(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return Promise.resolve(null);
  if (process.platform === "linux") return Promise.resolve(startTokenLinux(pid));
  const c = startTokenCommand(process.platform, pid);
  return new Promise(resolve => {
    try { cp.execFile(c.cmd, c.args, {encoding: "utf8", windowsHide: true, timeout: 15_000, ...(c.env ? {env: c.env} : {})}, (err, stdout) => { const t = err ? "" : String(stdout ?? "").trim(); resolve(t || null); }); } catch { resolve(null); }
  });
}
// //TR: Windows'ta kimlik denetimi ve öldürme TEK PowerShell çağrısındadır (denetim ile taskkill arasındaki 1-3 sn'lik pid yeniden kullanım penceresi kapanır); belirteç yalnız rakamlardan oluşmuyorsa komut kurulmaz (enjeksiyon yok, öldürme yok).
export function windowsKillArgs(pgid: number, expectedStart: string | null): string[] | null {
  if (!Number.isSafeInteger(pgid) || pgid <= 1 || expectedStart === null || !/^\d{1,20}$/.test(expectedStart)) return null;
  return ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-Process -Id ${pgid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime.ToUniversalTime().Ticks -eq ${expectedStart}) { & taskkill.exe /pid ${pgid} /T /F | Out-Null; exit 0 }; exit 3`];
}
// //TR: #224 tur 3 (SWEEP-4/6): Windows .NET Ticks (100 ns, 0001-01-01'den) <-> Unix ms; 2^53'ü aştığı için BigInt. macOS `ps -o lstart=` (LC_ALL=C, TZ=UTC0) "Mon Oct 26 07:55:19 2026" biçimini UTC olarak okur. Linux belirteci saat tikidir (önyükleme saati gerekir): burada karşılaştırılmaz (null).
const DOTNET_UNIX_EPOCH_TICKS = 621355968000000000n;
export function tokenMs(platform: NodeJS.Platform, token: string): number | null {
  if (platform === "win32") return /^\d{1,20}$/.test(token) ? Number((BigInt(token) - DOTNET_UNIX_EPOCH_TICKS) / 10000n) : null;
  if (platform === "darwin") { const t = Date.parse(`${token.trim()} UTC`); return Number.isFinite(t) ? t : null; }
  return null;
}
// //TR: SWEEP-4: kayıtta çocuğun başlangıç belirteci yoksa (kısa ömürlü git çocuğu, eşzamansız belirteç yazılamadı) bile, kaydın yazıldığı andan (`at`, çocuk doğduktan HEMEN sonra yazılır) SONRA başlamış canlı bir süreç kayıtlı yazar olamaz: pid yeniden kullanılmıştır. slackMs saat/okuma farkı payıdır.
const RECORD_SLACK_MS = 5_000;
export function startedAfterRecord(platform: NodeJS.Platform, tokenNow: string | null, recordAtIso: string, slackMs = RECORD_SLACK_MS): boolean {
  if (tokenNow === null) return false;
  const started = tokenMs(platform, tokenNow), at = Date.parse(recordAtIso);
  return started !== null && Number.isFinite(at) && started > at + slackMs;
}
// //TR: SWEEP-6: Windows'ta erişim reddi (EPERM) tek başına "bizim yazarımız değil" demez. Yalnız (a) Get-Process StartTime'ı da okunamıyorsa VE (b) bağımsız bir ikinci kaynaktan (Win32_Process.CreationDate, CIM) okunan oluşturma zamanı kayıtlı başlangıçtan (yoksa kaydın yazıldığı andan sonra) FARKLI ise yazar yoktur; ikinci kaynak da okunamıyorsa fail-closed (UNKNOWN). CIM mikrosaniye çözünürlüklüdür: kayıtlı belirteçle karşılaştırma toleranslıdır.
const CREATION_TOLERANCE_MS = 2_000;
export interface AccessDeniedProbe { creationTicks: string | null; recordedStart: string | null; recordAtIso: string }
export function accessDeniedVerdict(platform: NodeJS.Platform, startTokenNow: string | null, probe?: AccessDeniedProbe): "NOT_OUR_WRITER" | "UNKNOWN" {
  if (platform !== "win32" || startTokenNow !== null || !probe || probe.creationTicks === null) return "UNKNOWN";
  const created = tokenMs("win32", probe.creationTicks);
  if (created === null) return "UNKNOWN";
  if (probe.recordedStart !== null) { const recorded = tokenMs("win32", probe.recordedStart); return recorded !== null && Math.abs(created - recorded) > CREATION_TOLERANCE_MS ? "NOT_OUR_WRITER" : "UNKNOWN"; }
  return startedAfterRecord("win32", probe.creationTicks, probe.recordAtIso) ? "NOT_OUR_WRITER" : "UNKNOWN";
}
export function creationTicksCommand(pid: number): {cmd: string; args: string[]} | null {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  return {cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($p -and $p.CreationDate) { $p.CreationDate.ToUniversalTime().Ticks }`]};
}
export function creationTicks(pid: number): Promise<string | null> {
  const c = process.platform === "win32" ? creationTicksCommand(pid) : null;
  if (!c) return Promise.resolve(null);
  return new Promise(resolve => {
    try { cp.execFile(c.cmd, c.args, {encoding: "utf8", windowsHide: true, timeout: 15_000}, (err, stdout) => { const t = err ? "" : String(stdout ?? "").trim(); resolve(/^\d{1,20}$/.test(t) ? t : null); }); } catch { resolve(null); }
  });
}
// //TR: SWEEP-4: öldürme sonrası bekleme döngüsü GONE'da VEYA kimlik belirteci DEĞİŞTİĞİNDE biter (pid başka bir sürece verildi: ilk yazar öldü, yenisine dokunulmaz); yoksa yeniden kullanılan bir pid 5 sn "yazar öldürülemedi" diye fail-closed olurdu. deps yalnız testler içindir.
export async function waitWriterGone(pgid: number, startedToken: string | null, waitMs = WRITER_KILL_WAIT_MS, deps: {state?: (pgid: number) => ReturnType<typeof writerState>; token?: (pid: number) => Promise<string | null>; sleep?: (ms: number) => Promise<void>} = {}): Promise<"GONE" | "REUSED" | "ALIVE"> {
  const state = deps.state ?? writerState, token = deps.token ?? startToken, nap = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  for (const until = Date.now() + waitMs; ;) {
    if (state(pgid) === "GONE") return "GONE";
    if (startedToken !== null) { const t = await token(pgid); if (t !== null && t !== startedToken) return "REUSED"; }
    if (Date.now() >= until) return "ALIVE";
    await nap(50);
  }
}
export function killWriterGroup(pgid: number, expectedStart: string | null): Promise<void> {
  if (process.platform === "win32") {
    const args = windowsKillArgs(pgid, expectedStart);
    if (!args) return Promise.resolve();
    return new Promise(resolve => { try { cp.execFile("powershell.exe", args, {windowsHide: true, timeout: 30_000}, () => resolve()); } catch { resolve(); } });
  }
  try { process.kill(-pgid, "SIGKILL"); } catch { /* grup zaten bitmiş olabilir */ }
  return Promise.resolve();
}

// //TR: Lider yok ama grup canlı (Linux): bir grup kimliği üyeleri yaşadıkça yeniden kullanılmaz, ancak grup dağılıp kimlik yeniden alınmışsa (pid sarması, aynı önyükleme kimliğiyle yeni pid alanı) bu grup BAŞKASININ olabilir (çift çatallanmış bir daemon): böyle bir grubun üyeleri de kaydedilen liderden SONRA başlamıştır, yani başlangıç zamanı tek başına ayırt etmez. Öldürmeden önce: aynı önyükleme, her canlı üye kayıtlı liderden sonra başlamış VE en az bir üyenin ortamı kaydın lease işaretini (UASCO_WRITER_LEASE=<önceki lease>) taşımalı; işaret rastgele bir lease kimliğidir, yabancı bir grup taşıyamaz. Aksi halde fail-closed.
const envHas = (pid: number, entry: string): boolean => { try { return fs.readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(entry); } catch { return false; } };
export function leaderlessGroupProof(pgid: number, prev: WorkspaceOwner): {ok: true} | {ok: false; why: string; transient?: true} {
  if (prev.bootId === null || !sameBoot(prev.bootId, bootId())) return {ok: false, why: `writer group ${pgid} has no leader and its boot cannot be proven the same`};
  const childStart = Number(prev.childStart);
  if (!Number.isSafeInteger(childStart)) return {ok: false, why: `writer group ${pgid} is alive but its identity cannot be proven`};
  const members = groupMembers(pgid);
  if (members === null) return {ok: false, why: `writer group ${pgid} members cannot be read`, transient: true}; // //TR: SWEEP-5: /proc okunamıyor: geçici olabilir (yeniden denenir)
  if (members.some(m => !Number.isSafeInteger(m.start) || m.start < childStart)) return {ok: false, why: `writer group ${pgid} has a member older than the recorded writer`};
  const mark = `${WRITER_ENV_LEASE}=${prev.leaseId}`;
  if (!members.some(m => envHas(m.pid, mark))) return {ok: false, why: `writer group ${pgid} has no leader and no member carries the recorded lease marker`};
  return {ok: true};
}

// ---- setsid ile kaçan torunlar (Linux) ----
// //TR: Süreç grubu öldürmesi setsid/çift çatal ile gruptan ayrılan torunu yakalamaz. Çocukların ortamındaki lease işareti torunlara geçer: bu run'ın EKSİ lease'lerinden birinin işaretini taşıyan her süreç (kendimiz hariç) öldürülür ve ölmesi beklenir. Okunamayan (başka kullanıcı) süreç bizim değildir. Windows'ta eşdeğeri bir Job nesnesidir (yok): bu bilinen bir kalıntıdır.
// //TR: #224 tur 3 (SWEEP-2): ikinci ölçüt (cwd) yalnız DEVİRDE ve yalnız işaretsiz kalan yazarlar içindir (işaret bırakmayan VERIFY test süreci): çalışma dizini run'ın work/ ya da klon dizinlerinden (scan-/security-/review-) birinin altındaysa VE süreçte denetim terminali yoksa hedeftir. logs/, run kökü ve terminalli süreçler (Kurucu'nun kabuğu/editörü) asla cwd ile hedef olmaz. Normal bir implementer'dan sonraki tarama (byCwd:false) yalnız işaretle ve kayıtlı grupla eşleşir.
export interface SweepTarget { runDir: string; runId: string; currentLeaseId: string; includeCurrent?: boolean; byCwd?: boolean }
// //TR: R2: readlink(/proc/<pid>/cwd) kanonik yolu verir; runDir sembolik bir bileşen içeriyorsa (sembolik ev dizini, bağlama takma adı) sözcüksel karşılaştırma hiç eşleşmez ve işaretsiz süreçler taramadan kaçardı: runDir kanonikleştirilir. includeCurrent: ENGİNİN KENDİ lease'inin işaretini taşıyan artıklar da (implementer bitti ya da öldürüldü ama torunu kaldı) hedeftir; devirde yalnız ESKİ lease'ler hedeftir.
const canonicalDir = (dir: string): string => { try { return fs.realpathSync(dir); } catch { return dir; } };
// //TR: Run dizini altında yazarın çalışabildiği alt dizinler: runner.ts'teki work/ ile freshClone/bareClone adları (scan-c<N>, security-c<N>, security-gl-c<N>.git, review-c<N>). logs/, security/ (rapor) ve diğerleri yazar dizini değildir.
export const RUN_WRITER_DIR = /^(work|(scan|security|review)-.+)$/;
const inWriterDir = (cwd: string, dirs: string[]): boolean => dirs.some(d => cwd.startsWith(d + path.sep) && RUN_WRITER_DIR.test(cwd.slice(d.length + 1).split(path.sep)[0]));
export function findLeaseWriters(o: SweepTarget): number[] {
  if (process.platform !== "linux") return [];
  const hits: number[] = [];
  const dirs = [...new Set([o.runDir, canonicalDir(o.runDir)])];
  const marker = `${WRITER_ENV_RUN}=${o.runId}`, current = `${WRITER_ENV_LEASE}=${o.currentLeaseId}`, leasePrefix = `${WRITER_ENV_LEASE}=`;
  let names: string[];
  try { names = fs.readdirSync("/proc"); } catch { return hits; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === process.pid) continue;
    let state = "", tty = 0;
    // //TR: /proc/<pid>/stat: ")" sonrası alanlar: durum, ppid, pgrp, oturum, tty_nr.
    try { const st = fs.readFileSync(`/proc/${name}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" "); state = f[0] ?? ""; tty = Number(f[4]); } catch { continue; }
    if (state === "Z" || state === "X") continue;
    let hit = false;
    try {
      const vars = fs.readFileSync(`/proc/${name}/environ`, "latin1").split("\0");
      if (vars.includes(marker)) { const lease = vars.find(v => v.startsWith(leasePrefix)); hit = o.includeCurrent === true || lease !== current; }
    } catch { /* başka kullanıcı: bizim yazarımız değil */ }
    if (!hit && o.byCwd !== false && tty === 0) {
      try { hit = inWriterDir(fs.readlinkSync(`/proc/${name}/cwd`), dirs); } catch { /* okunamadı */ }
    }
    if (hit) hits.push(pid);
  }
  return hits;
}
// //TR: R2: tarama tek seferlik değildir: öldürülen bir sürecin son anlarında çatalladığı (veya hâlâ çatallayan) torunlar ilk görüntüde yoktur. Temiz bir tarama görülene kadar (ya da süre dolana kadar) her turda bulunanların HEPSİNE yeniden SIGKILL gider; süre dolarsa kalanlar `survivors` olur ve çağıran fail-closed davranır. deps yalnız testler içindir (belirleyici tarama dizisi).
export async function sweepWriters(o: SweepTarget, waitMs = WRITER_KILL_WAIT_MS, deps: {find?: (t: SweepTarget) => number[]; kill?: (pid: number) => void} = {}): Promise<{killed: number[]; survivors: number[]}> {
  const find = deps.find ?? findLeaseWriters, kill = deps.kill ?? ((pid: number) => { try { process.kill(pid, "SIGKILL"); } catch { /* zaten bitmiş */ } });
  const killed = new Set<number>();
  let hits = find(o);
  for (const until = Date.now() + waitMs; hits.length > 0;) {
    for (const pid of hits) { killed.add(pid); kill(pid); }
    if (Date.now() >= until) break;
    await new Promise<void>(r => setTimeout(r, 50));
    hits = find(o);
  }
  return {killed: [...killed], survivors: hits};
}

// ---- süreç sonlanırken kayıtlı grupların öldürülmesi (TK-5) ----
// //TR: newSession ile çocuk kendi oturumundadır: engine'in terminalindeki Ctrl+C/SIGHUP çocuğa ULAŞMAZ. Çalışan çocukların grupları burada tutulur; engine sonlanırken (SIGINT/SIGTERM/SIGHUP/exit) hepsine SIGKILL gider. Sinyal için başka dinleyici yoksa varsayılan davranış (süreç sonlanır) yeniden tetiklenir; varsa onların kapanış mantığına dokunulmaz.
const liveGroups = new Set<number>();
export const trackWriterGroup = (pgid: number): void => { if (process.platform !== "win32") liveGroups.add(pgid); };
export const untrackWriterGroup = (pgid: number): void => { liveGroups.delete(pgid); };
export const trackedWriterGroups = (): number[] => [...liveGroups];
export function killTrackedGroups(): void { for (const g of liveGroups) { try { process.kill(-g, "SIGKILL"); } catch { /* grup zaten bitmiş */ } } }
let forwardRefs = 0;
const forwardHandlers = new Map<NodeJS.Signals, () => void>();
// //TR: R2: süreç sonlanıyor işareti (sinyal ya da exit). Başka bir dinleyici varsa süreç kapanış mantığını sürdürür ve sürüşler birkaç ms daha yaşar: yazar gruplarının ÖLDÜRÜLMÜŞ olması o adımın hatası DEĞİLDİR. Runner bu işareti görünce başarısız/engelli/yeniden-dene sonuçlarını KAYDETMEZ (run kilitli kalır, sonraki engine devralır).
let terminating = false;
export const isTerminating = (): boolean => terminating;
const onProcessExit = (): void => { terminating = true; killTrackedGroups(); };
export function installTerminationForwarding(): () => void {
  if (process.platform === "win32") return () => undefined;
  if (forwardRefs++ === 0) {
    process.on("exit", onProcessExit);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const h = () => { terminating = true; killTrackedGroups(); if (process.listenerCount(sig) <= 1) { process.removeListener(sig, h); try { process.kill(process.pid, sig); } catch { /* sonlanamadı */ } } };
      forwardHandlers.set(sig, h); process.on(sig, h);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--forwardRefs === 0) { process.removeListener("exit", onProcessExit); for (const [sig, h] of forwardHandlers) process.removeListener(sig, h); forwardHandlers.clear(); terminating = false; }
  };
}
