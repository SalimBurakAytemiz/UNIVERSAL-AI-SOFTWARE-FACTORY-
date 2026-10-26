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
export function killWriterGroup(pgid: number, expectedStart: string | null): Promise<void> {
  if (process.platform === "win32") {
    const args = windowsKillArgs(pgid, expectedStart);
    if (!args) return Promise.resolve();
    return new Promise(resolve => { try { cp.execFile("powershell.exe", args, {windowsHide: true, timeout: 30_000}, () => resolve()); } catch { resolve(); } });
  }
  try { process.kill(-pgid, "SIGKILL"); } catch { /* grup zaten bitmiş olabilir */ }
  return Promise.resolve();
}

// //TR: Lider yok ama grup canlı (Linux): bir grup kimliği üyeleri yaşadıkça yeniden kullanılmaz, ancak yeniden başlatma sonrası ya da grup dağılıp kimlik yeniden alınmışsa bu grup BAŞKASININ olabilir (çift çatallanmış bir daemon). Öldürmeden önce: aynı önyükleme VE her canlı üye lider sürecin kaydedilmiş başlangıcından SONRA başlamış olmalı; aksi halde fail-closed.
export function leaderlessGroupProof(pgid: number, prev: WorkspaceOwner): {ok: true} | {ok: false; why: string} {
  if (prev.bootId === null || !sameBoot(prev.bootId, bootId())) return {ok: false, why: `writer group ${pgid} has no leader and its boot cannot be proven the same`};
  const childStart = Number(prev.childStart);
  if (!Number.isSafeInteger(childStart)) return {ok: false, why: `writer group ${pgid} is alive but its identity cannot be proven`};
  const members = groupMembers(pgid);
  if (members === null) return {ok: false, why: `writer group ${pgid} members cannot be read`};
  if (members.some(m => !Number.isSafeInteger(m.start) || m.start < childStart)) return {ok: false, why: `writer group ${pgid} has a member older than the recorded writer`};
  return {ok: true};
}

// ---- setsid ile kaçan torunlar (Linux) ----
// //TR: Süreç grubu öldürmesi setsid/çift çatal ile gruptan ayrılan torunu yakalamaz. Çocukların ortamındaki lease işareti torunlara geçer: bu run'ın EKSİ lease'lerinden birinin işaretini taşıyan veya çalışma dizini run dizininin altında olan her süreç (kendimiz hariç) öldürülür ve ölmesi beklenir. Okunamayan (başka kullanıcı) süreç bizim değildir. Windows'ta eşdeğeri bir Job nesnesidir (yok): bu bilinen bir kalıntıdır.
export function findLeaseWriters(o: {runDir: string; runId: string; currentLeaseId: string}): number[] {
  if (process.platform !== "linux") return [];
  const hits: number[] = [];
  const marker = `${WRITER_ENV_RUN}=${o.runId}`, current = `${WRITER_ENV_LEASE}=${o.currentLeaseId}`, leasePrefix = `${WRITER_ENV_LEASE}=`;
  let names: string[];
  try { names = fs.readdirSync("/proc"); } catch { return hits; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === process.pid) continue;
    let state = "";
    try { const st = fs.readFileSync(`/proc/${name}/stat`, "utf8"); state = st.slice(st.lastIndexOf(")") + 2, st.lastIndexOf(")") + 3); } catch { continue; }
    if (state === "Z" || state === "X") continue;
    let hit = false;
    try {
      const vars = fs.readFileSync(`/proc/${name}/environ`, "latin1").split("\0");
      if (vars.includes(marker)) { const lease = vars.find(v => v.startsWith(leasePrefix)); hit = lease !== current; }
    } catch { /* başka kullanıcı: bizim yazarımız değil */ }
    if (!hit) {
      try { const cwd = fs.readlinkSync(`/proc/${name}/cwd`); hit = cwd === o.runDir || cwd.startsWith(o.runDir + path.sep); } catch { /* okunamadı */ }
    }
    if (hit) hits.push(pid);
  }
  return hits;
}
export async function sweepWriters(o: {runDir: string; runId: string; currentLeaseId: string}, waitMs = WRITER_KILL_WAIT_MS): Promise<{killed: number[]; survivors: number[]}> {
  const killed = findLeaseWriters(o);
  for (const pid of killed) { try { process.kill(pid, "SIGKILL"); } catch { /* zaten bitmiş */ } }
  let survivors = killed.length ? findLeaseWriters(o) : [];
  for (const until = Date.now() + waitMs; survivors.length > 0 && Date.now() < until;) { await new Promise<void>(r => setTimeout(r, 50)); survivors = findLeaseWriters(o); }
  return {killed, survivors};
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
export function installTerminationForwarding(): () => void {
  if (process.platform === "win32") return () => undefined;
  if (forwardRefs++ === 0) {
    process.on("exit", killTrackedGroups);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const h = () => { killTrackedGroups(); if (process.listenerCount(sig) <= 1) { process.removeListener(sig, h); try { process.kill(process.pid, sig); } catch { /* sonlanamadı */ } } };
      forwardHandlers.set(sig, h); process.on(sig, h);
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--forwardRefs === 0) { process.removeListener("exit", killTrackedGroups); for (const [sig, h] of forwardHandlers) process.removeListener(sig, h); forwardHandlers.clear(); }
  };
}
