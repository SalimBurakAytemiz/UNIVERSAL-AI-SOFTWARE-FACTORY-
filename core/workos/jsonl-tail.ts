//TR: Bu dosya intake/plan gibi yan JSONL kayıt dosyalarının yırtık son satır davranışını Work OS journal'ı (REL-FX-4) ile aynı kurala bağlar: "\n" ile bitmeyen son satır yalnız beklenen kayıt başlangıcının önekiyse yırtık append sayılır (okumada yok sayılır, yazmadan önce karantinaya alınıp kesilir); ortadaki bozuk satır veya yabancı kuyruk fail-closed kalır, sessizce kabul edilmez.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class JsonlTailError extends Error {
  constructor(readonly reason: "FOREIGN_TAIL" | "QUARANTINE_FAILED" | "FILE_CHANGED") { super(reason); this.name = "JsonlTailError"; }
}
const hex = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

// //TR: Son satır "\n" ile bitmiyorsa ayrılır; kuyruk yalnız `recordStart` (kaydın JSON.stringify başlangıcı) önekiyse yırtık append'dir, yabancıysa fail-closed (journal'daki JOURNAL_TRUNCATED_LINE kuralı).
function split(buf: Buffer, recordStart: string): {cut: number; tail: Buffer} {
  const cut = buf.length > 0 && buf[buf.length - 1] !== 0x0a ? buf.lastIndexOf(0x0a) + 1 : buf.length;
  const tail = buf.subarray(cut);
  if (tail.length > 0) {
    const expected = Buffer.from(recordStart, "utf8"), n = Math.min(expected.length, tail.length);
    if (!tail.subarray(0, n).equals(expected.subarray(0, n))) throw new JsonlTailError("FOREIGN_TAIL");
  }
  return {cut, tail};
}

/** Tam (satır sonlu) kayıtları okur; yırtık kuyruk yok sayılır, bozuk ortadaki satır veya yabancı kuyruk fırlatır. */
export function readJsonlRecords<T>(file: string, recordStart: string): T[] {
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file), {cut} = split(buf, recordStart);
  return buf.subarray(0, cut).toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
}

// Yırtık kuyruk silinmeden önce karantina dizinine bayt bayt kopyalanır (adı kuyruğun sha256'sından); kopya doğrulanamazsa dosyaya dokunulmaz.
function discardTornTail(file: string, recordStart: string): void {
  if (!fs.existsSync(file)) return;
  const buf = fs.readFileSync(file), {cut, tail} = split(buf, recordStart);
  if (tail.length === 0) return;
  const tailSha = hex(tail), q = path.join(path.dirname(file), "quarantine", `${path.basename(file, ".jsonl")}-torn-${tailSha.slice(0, 16)}.tail`);
  try {
    fs.mkdirSync(path.dirname(q), {recursive: true});
    if (!fs.existsSync(q) || hex(fs.readFileSync(q)) !== tailSha) {
      const tmp = `${q}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      fs.writeFileSync(tmp, tail); fs.renameSync(tmp, q);
    }
    if (hex(fs.readFileSync(q)) !== tailSha) throw new Error("QUARANTINE_MISMATCH");
  } catch { throw new JsonlTailError("QUARANTINE_FAILED"); }
  if (fs.statSync(file).size !== buf.length) throw new JsonlTailError("FILE_CHANGED");
  const fd = fs.openSync(file, "r+");
  try { fs.ftruncateSync(fd, cut); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Kaydı tek satır olarak ekler: önce varsa yırtık kuyruğu karantinaya alıp keser, yazı başarısız olursa dosyayı yazı öncesi boyuta geri keser (yarım satır bırakılmaz). */
export function appendJsonlRecord(file: string, rec: unknown, recordStart: string): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  discardTornTail(file, recordStart);
  const line = Buffer.from(JSON.stringify(rec) + "\n", "utf8");
  const fd = fs.openSync(file, "a");
  try {
    const size = fs.fstatSync(fd).size;
    try {
      if (fs.writeSync(fd, line) !== line.length) throw new Error("SHORT_WRITE");
      fs.fsyncSync(fd);
    } catch (e) {
      try { const rfd = fs.openSync(file, "r+"); try { fs.ftruncateSync(rfd, size); fs.fsyncSync(rfd); } finally { fs.closeSync(rfd); } } catch { /* sonraki okuma yırtık kuyruğu kural gereği ayırır */ }
      throw e;
    }
  } finally { fs.closeSync(fd); }
}
