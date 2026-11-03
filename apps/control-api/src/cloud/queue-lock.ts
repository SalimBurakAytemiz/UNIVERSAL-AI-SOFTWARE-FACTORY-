// //TR: Bu dosya bulut iş kuyruğunun tek yazıcı kilidini uygular: kilit içeriği önce geçici dosyaya yazılıp link() ile atomik konur (boş kilit penceresi yok), bayat kilidi yalnız o kilide özgü kuşaklı devralma jetonunu tutan süreç siler (rename-back yok; ölü sahipli jeton silinmeden sonraki kuşakla otomatik kurtarma), bırakma yalnız kendi benzersiz kimliğini taşıyan kilidi siler.
import fs from "node:fs";
import path from "node:path";
import {createHash, randomBytes} from "node:crypto";

/** Testlerde araya girmek için kullanılan dar dosya sistemi yüzeyi. */
export interface LockIo {
  writeFile(path: string, data: string): void;   // yaz + fsync
  link(existing: string, target: string): void;   // hedef varsa EEXIST
  read(path: string): string;
  unlink(path: string): void;
  list(dir: string): string[];
}
export const defaultLockIo: LockIo = {
  writeFile(p, data) { const fd = fs.openSync(p, "wx"); try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } },
  link: (a, b) => fs.linkSync(a, b),
  read: p => fs.readFileSync(p, "utf8"),
  unlink: p => fs.unlinkSync(p),
  list: d => fs.readdirSync(d),
};

/** EPERM: süreç var ama sinyal izni yok -> canlı. ESRCH: yok -> ölü. */
export function pidAlive(pid: number, kill: (pid: number, sig: 0) => void = (p, s) => { process.kill(p, s); }): boolean {
  try { kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export interface QueueLockOptions {
  io?: LockIo;
  alive?: (pid: number) => boolean;
  pid?: number;
}
export interface QueueLock {readonly id: string; release(): void}

const parsePid = (raw: string): number => { const m = /^(\d+):[0-9a-f]{32}$/.exec(raw.trim()); return m ? Number(m[1]) : Number.NaN; };
const isEexist = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "EEXIST";
const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

/** `${pid}:${32 hex}` içeriğini önce benzersiz geçici dosyaya yazıp `target`a link'ler. Başarısızlıkta geçici dosya her durumda silinir. */
function linkWithContent(io: LockIo, target: string, id: string): boolean {
  const pid = id.split(":")[0];
  const tmp = `${target}.tmp-${pid}-${randomBytes(8).toString("hex")}`;   // N-3: sahibinin pid'i adda; ölü sahibin artığı temizlenebilir
  try {
    io.writeFile(tmp, id);
    try { io.link(tmp, target); return true; } catch (e) { if (isEexist(e)) return false; throw e; }
  } finally {
    try { io.unlink(tmp); } catch { /* yut: zaten yok */ }
  }
}

export const MAX_TAKEOVER_GENERATIONS = 16;

/**
 * Kilidi alır ya da QUEUE_LOCKED fırlatır.
 * - Kilit dosyası yalnız tam içerikle ortaya çıkar (link), okuyan süreç asla boş/yarım kilit görmez.
 * - Bayat kilit S (sahibi ölü ya da tanınmayan içerik) yalnız `${lockPath}.takeover.<h(S)>.<k>` jetonunu link() ile alan süreç
 *   tarafından ve yalnız içerik hâlâ S ise silinir. Kilit kimlikleri benzersiz rastgele olduğu için S bir daha oluşmaz.
 * - Otomatik kurtarma: k kuşağının sahibi ölüyse jeton SİLİNMEZ; k+1 kuşağı denenir. Her kuşağı en çok bir süreç alır, bu yüzden
 *   iki süreç aynı S'yi aynı anda devralamaz (NB-5 yarışı yapısal olarak yok). Kilidi alan süreç eski jetonları temizler.
 * - Ardışık MAX_TAKEOVER_GENERATIONS devralma çökmesi: QUEUE_TAKEOVER_STALE (güvenli tarafta kal).
 */
export function acquireQueueLock(lockPath: string, o: QueueLockOptions = {}): QueueLock {
  const io = o.io ?? defaultLockIo, alive = o.alive ?? ((p: number) => pidAlive(p));
  const id = `${o.pid ?? process.pid}:${randomBytes(16).toString("hex")}`;
  const dir = path.dirname(lockPath), base = path.basename(lockPath);
  const prefix = lockPath.slice(0, lockPath.length - base.length);   // jeton yolları lockPath'in kendi ayırıcısıyla kurulur (Windows: path.join "\\" üretir)
  const tokenOf = (stale: string, k: number) => `${lockPath}.takeover.${createHash("sha256").update(stale).digest("hex").slice(0, 24)}.${k}`;
  const holdsLive = (raw: string) => { const p = parsePid(raw); return Number.isSafeInteger(p) && p > 0 && alive(p); };
  const lock: QueueLock = {
    id,
    release() {   // NB-3: yalnız hâlâ bizim kimliğimizi taşıyan kilit silinir
      let raw: string;
      try { raw = io.read(lockPath); } catch { return; }
      if (raw.trim() === id) { try { io.unlink(lockPath); } catch { /* yut */ } }
    },
  };
  const won = (): QueueLock => {   // kilit bizde: artık geçersiz devralma jetonlarını (ve eski biçim `.takeover`) temizle
    let names: string[] = [];
    try { names = io.list(dir); } catch { return lock; }
    // başka sürecin yazmakta olduğu geçici dosyaya (.tmp-) dokunulmaz (L-1); sahibi ölü .tmp- artıkları silinir (N-3)
    const tmpOwnerDead = (n: string) => { const m = /\.tmp-(\d+)-[0-9a-f]{16}$/.exec(n); return m !== null && !alive(Number(m[1])); };
    for (const n of names) if (n.startsWith(`${base}.`) && n.includes(".tmp-") && tmpOwnerDead(n)) { try { io.unlink(prefix + n); } catch { /* yut */ } }
    for (const n of names) if ((n === `${base}.takeover` || n.startsWith(`${base}.takeover.`)) && !n.includes(".tmp-")) { try { io.unlink(prefix + n); } catch { /* yut */ } }
    return lock;
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    if (linkWithContent(io, lockPath, id)) return won();
    let raw: string;
    try { raw = io.read(lockPath); } catch (e) { if (isEnoent(e)) continue; throw e; }
    if (holdsLive(raw)) throw new Error("QUEUE_LOCKED");
    // Bayat kilit S = raw. Bu S için boş bir kuşak jetonu al.
    let token: string | null = null, spins = 0;
    for (let k = 1; k <= MAX_TAKEOVER_GENERATIONS && token === null; k++) {
      const t = tokenOf(raw, k);
      if (linkWithContent(io, t, id)) { token = t; break; }
      let traw: string;
      try { traw = io.read(t); } catch (e) { if (isEnoent(e)) { if (++spins <= 8) { k--; continue; } throw new Error("QUEUE_LOCKED"); } throw e; }   // N-3: bütçe aşılınca tipli hata   // sahibi bıraktı: aynı kuşağı yeniden dene (sınırlı)
      if (holdsLive(traw)) throw new Error("QUEUE_LOCKED");   // bu S'yi başka bir canlı süreç devralıyor
      // sahibi ölü: jeton silinmez, bir sonraki kuşak denenir
    }
    if (token === null) throw new Error("QUEUE_TAKEOVER_STALE");
    try {
      let again: string | null = null;
      try { again = io.read(lockPath); } catch (e) { if (!isEnoent(e)) throw e; }
      if (again === raw) {   // yalnız jetonun koruduğu S silinir; pid yeniden canlı görünüyorsa muhafazakâr davran
        if (holdsLive(again)) throw new Error("QUEUE_LOCKED");
        try { io.unlink(lockPath); } catch (e) { if (!isEnoent(e)) throw e; }
      }
      else if (again !== null) { if (holdsLive(again)) throw new Error("QUEUE_LOCKED"); continue; }   // başka bir bayat içerik: kendi jetonuyla
      if (linkWithContent(io, lockPath, id)) return won();
    } finally {
      try { if (io.read(token).trim() === id) io.unlink(token); } catch { /* yut */ }
    }
  }
  throw new Error("QUEUE_LOCKED");
}
