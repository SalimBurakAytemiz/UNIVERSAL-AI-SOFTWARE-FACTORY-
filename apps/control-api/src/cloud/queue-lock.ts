// //TR: Bu dosya bulut iş kuyruğunun tek yazıcı kilidini uygular: kilit içeriği önce geçici dosyaya yazılıp link() ile atomik konur (boş kilit penceresi yok), bayat kilidi yalnız devralma jetonunu tutan süreç siler (rename-back yok), bırakma yalnız kendi benzersiz kimliğini taşıyan kilidi siler.
import fs from "node:fs";
import {randomBytes} from "node:crypto";

/** Testlerde araya girmek için kullanılan dar dosya sistemi yüzeyi. */
export interface LockIo {
  writeFile(path: string, data: string): void;   // yaz + fsync
  link(existing: string, target: string): void;   // hedef varsa EEXIST
  read(path: string): string;
  unlink(path: string): void;
  mtimeMs(path: string): number;
}
export const defaultLockIo: LockIo = {
  writeFile(p, data) { const fd = fs.openSync(p, "wx"); try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } },
  link: (a, b) => fs.linkSync(a, b),
  read: p => fs.readFileSync(p, "utf8"),
  unlink: p => fs.unlinkSync(p),
  mtimeMs: p => fs.statSync(p).mtimeMs,
};

/** EPERM: süreç var ama sinyal izni yok -> canlı. ESRCH: yok -> ölü. */
export function pidAlive(pid: number, kill: (pid: number, sig: 0) => void = (p, s) => { process.kill(p, s); }): boolean {
  try { kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export interface QueueLockOptions {
  io?: LockIo;
  alive?: (pid: number) => boolean;
  now?: () => number;
  pid?: number;
  /** Sahibi ölü bir devralma jetonu bu süreden eskiyse silinebilir (jetonu tutarken çöken süreç). */
  staleTokenGraceMs?: number;
}
export interface QueueLock {readonly id: string; release(): void}

const parsePid = (raw: string): number => { const m = /^(\d+):[0-9a-f]{32}$/.exec(raw.trim()); return m ? Number(m[1]) : Number.NaN; };
const isEexist = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EEXIST";
const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

/** `${pid}:${32 hex}` içeriğini önce benzersiz geçici dosyaya yazıp `target`a link'ler. Başarısızlıkta geçici dosya her durumda silinir. */
function linkWithContent(io: LockIo, target: string, id: string): boolean {
  const tmp = `${target}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    io.writeFile(tmp, id);
    try { io.link(tmp, target); return true; } catch (e) { if (isEexist(e)) return false; throw e; }
  } finally {
    try { io.unlink(tmp); } catch { /* yut: zaten yok */ }
  }
}

/**
 * Kilidi alır ya da QUEUE_LOCKED fırlatır.
 * - Kilit dosyası yalnız tam içerikle ortaya çıkar (link), bu yüzden okuyan süreç asla boş/yarım kilit görmez.
 * - Bayat (sahibi ölü) kilidi silmek için önce `${lockPath}.takeover` jetonu link() ile alınır. Jeton tutulurken bayat kilit
 *   yalnız jeton sahibi tarafından silinebilir; taze kilit yalnız dosya yokken oluşabilir. Silinen dosya bu yüzden her zaman
 *   okunan bayat kilittir (rename-back yok, başkasının kilidi silinmez).
 */
export function acquireQueueLock(lockPath: string, o: QueueLockOptions = {}): QueueLock {
  const io = o.io ?? defaultLockIo, alive = o.alive ?? ((p: number) => pidAlive(p)), now = o.now ?? Date.now;
  const id = `${o.pid ?? process.pid}:${randomBytes(16).toString("hex")}`;
  const token = `${lockPath}.takeover`, grace = o.staleTokenGraceMs ?? 60_000;
  const holdsLive = (raw: string) => { const p = parsePid(raw); return Number.isSafeInteger(p) && p > 0 && alive(p); };
  const lock: QueueLock = {
    id,
    release() {   // NB-3: yalnız hâlâ bizim kimliğimizi taşıyan kilit silinir
      let raw: string;
      try { raw = io.read(lockPath); } catch { return; }
      if (raw.trim() === id) { try { io.unlink(lockPath); } catch { /* yut */ } }
    },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (linkWithContent(io, lockPath, id)) return lock;
    let raw: string;
    try { raw = io.read(lockPath); } catch (e) { if (isEnoent(e)) continue; throw e; }
    if (holdsLive(raw)) throw new Error("QUEUE_LOCKED");
    // Bayat kilit (ölü pid ya da tanınmayan içerik). Devralma jetonunu al.
    if (!linkWithContent(io, token, id)) {
      let traw = "";
      try { traw = io.read(token); } catch (e) { if (isEnoent(e)) continue; throw e; }
      let age = 0;
      try { age = now() - io.mtimeMs(token); } catch { continue; }
      if (holdsLive(traw) || age < grace) throw new Error("QUEUE_LOCKED");   // başka süreç devralıyor
      try { io.unlink(token); } catch { /* yut */ }   // jetonu tutarken çökmüş sürecin artığı (kalan risk: belgelendi)
      continue;
    }
    try {
      let again: string | null = null;
      try { again = io.read(lockPath); } catch (e) { if (!isEnoent(e)) throw e; }
      if (again !== null) {
        if (again !== raw && holdsLive(again)) throw new Error("QUEUE_LOCKED");
        if (!holdsLive(again)) { try { io.unlink(lockPath); } catch (e) { if (!isEnoent(e)) throw e; } }
      }
      if (linkWithContent(io, lockPath, id)) return lock;
    } finally {
      try { if (io.read(token).trim() === id) io.unlink(token); } catch { /* yut */ }
    }
  }
  throw new Error("QUEUE_LOCKED");
}
