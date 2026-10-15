// //TR: Bu dosya yeni bağımlılık eklemeden node:zlib üzerine kurulu en küçük güvenli ZIP okuyucusunu sağlar: yalnız stored/deflate, tek disk, ZIP64/şifreleme yok (ZIP_UNSUPPORTED_FEATURE); zip-slip, symlink, .git, yinelenen ad, boyut/dosya sayısı ve CRC denetimleri girdiler diske yazılmadan önce yapılır.
import zlib from "node:zlib";

export type ZipRejectCode =
  | "ZIP_INVALID" | "ZIP_UNSUPPORTED_FEATURE" | "ZIP_PATH_TRAVERSAL" | "ZIP_INVALID_NAME" | "ZIP_FORBIDDEN_PATH" | "ZIP_SYMLINK_REJECTED"
  | "ZIP_SPECIAL_FILE_REJECTED" | "ZIP_DUPLICATE_ENTRY" | "ZIP_TOO_LARGE" | "ZIP_TOO_MANY_FILES" | "ZIP_CRC_MISMATCH" | "ZIP_EMPTY";
export class ZipError extends Error {
  readonly code: ZipRejectCode;
  constructor(code: ZipRejectCode) { super(code); this.code = code; this.name = "ZipError"; }
}
export interface ZipLimits { maxArchiveBytes: number; maxEntries: number; maxFiles: number; maxEntryBytes: number; maxTotalBytes: number }
export const DEFAULT_ZIP_LIMITS: ZipLimits = {maxArchiveBytes: 200 * 1024 * 1024, maxEntries: 20_000, maxFiles: 10_000, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024};
export interface ZipEntry { name: string; segments: string[]; isDir: boolean; isSymlink: boolean; method: number; compressedSize: number; size: number; crc32: number; dataOffset: number }

let CRC_TABLE: Uint32Array | null = null;
export function crc32(buf: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Ad doğrulaması: ters eğik çizgi '/' sayılır; mutlak yol, sürücü harfi, '..' (zip-slip), boş/'.' segment, denetim karakteri, Windows'ta geçersiz karakter/ad reddedilir. '.git' segmenti hiçbir derinlikte kabul edilmez (yönetilen depo iç dosyaları içe aktarılamaz).
export function zipEntrySegments(rawName: string): {segments: string[]; isDir: boolean} {
  const name = rawName.replace(/\\/g, "/");
  if (!name || name.length > 1024 || /[\u0000-\u001f\u007f]/.test(name)) throw new ZipError("ZIP_INVALID_NAME");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new ZipError("ZIP_PATH_TRAVERSAL");
  const isDir = name.endsWith("/");
  const segments = (isDir ? name.slice(0, -1) : name).split("/");
  for (const seg of segments) {
    if (seg === "..") throw new ZipError("ZIP_PATH_TRAVERSAL");
    if (seg === "" || seg === "." || seg.length > 255 || /[<>:"|?*]/.test(seg) || /[. ]$/.test(seg) || WIN_RESERVED.test(seg)) throw new ZipError("ZIP_INVALID_NAME");
    if (seg.toLowerCase() === ".git") throw new ZipError("ZIP_FORBIDDEN_PATH");
  }
  return {segments, isDir};
}

// Merkez dizini okur ve her girdiyi doğrular; içerik açılmaz (açma readZipEntry ile, boyut sınırlı).
export function listZipEntries(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS, opts: {scanOnly?: boolean} = {}): ZipEntry[] {
  // scanOnly: yalnız içerik taraması (export doğrulaması); ad/symlink/yineleme kuralları uygulanmaz, hiçbir şey diske yazılmaz.
  if (buf.length > limits.maxArchiveBytes) throw new ZipError("ZIP_TOO_LARGE");
  if (buf.length < 22) throw new ZipError("ZIP_INVALID");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError("ZIP_INVALID");
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) throw new ZipError("ZIP_UNSUPPORTED_FEATURE"); // ZIP64
  const disk = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6), onDisk = buf.readUInt16LE(eocd + 8), total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new ZipError("ZIP_UNSUPPORTED_FEATURE");
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError("ZIP_UNSUPPORTED_FEATURE");
  if (total > limits.maxEntries) throw new ZipError("ZIP_TOO_MANY_FILES");
  if (cdOffset + cdSize > eocd) throw new ZipError("ZIP_INVALID");
  const out: ZipEntry[] = []; const seen = new Map<string, boolean>(), explicit = new Set<string>();
  let off = cdOffset, files = 0, totalBytes = 0;
  for (let i = 0; i < total; i++) {
    if (off + 46 > eocd || buf.readUInt32LE(off) !== 0x02014b50) throw new ZipError("ZIP_INVALID");
    const madeBy = buf.readUInt16LE(off + 4), flags = buf.readUInt16LE(off + 8), method = buf.readUInt16LE(off + 10), crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24), nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const diskStart = buf.readUInt16LE(off + 34), ext = buf.readUInt32LE(off + 38), local = buf.readUInt32LE(off + 42);
    if (off + 46 + nlen + xlen + clen > eocd) throw new ZipError("ZIP_INVALID");
    const nameBytes = buf.subarray(off + 46, off + 46 + nlen);
    off += 46 + nlen + xlen + clen;
    if (flags & 0x0001 || flags & 0x0040 || flags & 0x2000) throw new ZipError("ZIP_UNSUPPORTED_FEATURE"); // şifreleme / güçlü şifreleme / maskeli merkez dizin
    if (method !== 0 && method !== 8) throw new ZipError("ZIP_UNSUPPORTED_FEATURE");
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff || diskStart !== 0) throw new ZipError("ZIP_UNSUPPORTED_FEATURE");
    const rawName = flags & 0x0800 ? nameBytes.toString("utf8") : nameBytes.toString("latin1");
    const unixMode = (madeBy >> 8) === 3 ? (ext >>> 16) & 0o170000 : 0;
    const isSymlink = unixMode === 0o120000 || ((madeBy >> 8) === 0 || (madeBy >> 8) === 10 || (madeBy >> 8) === 11) && (ext & 0x400) !== 0;
    if (isSymlink && !opts.scanOnly) throw new ZipError("ZIP_SYMLINK_REJECTED");
    if (!opts.scanOnly && unixMode !== 0 && unixMode !== 0o100000 && unixMode !== 0o040000 && unixMode !== 0o120000) throw new ZipError("ZIP_SPECIAL_FILE_REJECTED");
    let segs: {segments: string[]; isDir: boolean};
    if (opts.scanOnly) { const n = rawName.replace(/\\/g, "/"); segs = {segments: n.replace(/\/$/, "").split("/"), isDir: n.endsWith("/")}; }
    else segs = zipEntrySegments(rawName);
    const isDir = segs.isDir || unixMode === 0o040000;
    // Yinelenen ve dosya/dizin çakışan adlar (büyük/küçük harf duyarsız; Windows dosya sistemi) reddedilir.
    const lower = segs.segments.map(s => s.toLowerCase()), full = lower.join("/");
    if (!opts.scanOnly) {
      if (explicit.has(full) || (!isDir && seen.has(full)) || (isDir && seen.get(full) === false)) throw new ZipError("ZIP_DUPLICATE_ENTRY");
      for (let k = 1; k < lower.length; k++) { const key = lower.slice(0, k).join("/"); if (seen.get(key) === false) throw new ZipError("ZIP_DUPLICATE_ENTRY"); seen.set(key, true); }
      explicit.add(full); seen.set(full, isDir);
    }
    if (!isDir) {
      files += 1; totalBytes += usize;
      if (files > limits.maxFiles) throw new ZipError("ZIP_TOO_MANY_FILES");
      if (usize > limits.maxEntryBytes || totalBytes > limits.maxTotalBytes) throw new ZipError("ZIP_TOO_LARGE");
    }
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError("ZIP_INVALID");
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    if (!buf.subarray(local + 30, local + 30 + lnlen).equals(nameBytes)) throw new ZipError("ZIP_INVALID");
    const dataOffset = local + 30 + lnlen + lxlen;
    if (dataOffset + csize > cdOffset) throw new ZipError("ZIP_INVALID");
    if (method === 0 && csize !== usize) throw new ZipError("ZIP_INVALID");
    out.push({name: segs.segments.join("/") + (isDir ? "/" : ""), segments: segs.segments, isDir, isSymlink, method, compressedSize: csize, size: usize, crc32: crc, dataOffset});
  }
  return out;
}

// Girdi içeriği: inflate çıktı sınırı bildirilen boyutla sınırlıdır (zip bombası), uzunluk ve CRC32 doğrulanır.
export function readZipEntry(buf: Buffer, e: ZipEntry, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Buffer {
  if (e.isDir) return Buffer.alloc(0);
  if (e.size > limits.maxEntryBytes) throw new ZipError("ZIP_TOO_LARGE");
  const raw = buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
  let data: Buffer;
  if (e.method === 0) data = Buffer.from(raw);
  else {
    try { data = zlib.inflateRawSync(raw, {maxOutputLength: Math.max(1, e.size)}); }
    catch (err) { throw new ZipError((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" ? "ZIP_TOO_LARGE" : "ZIP_INVALID"); }
    if (e.size === 0 && data.length > 0) throw new ZipError("ZIP_TOO_LARGE");
  }
  if (data.length !== e.size) throw new ZipError(data.length > e.size ? "ZIP_TOO_LARGE" : "ZIP_INVALID");
  if (crc32(data) !== e.crc32) throw new ZipError("ZIP_CRC_MISMATCH");
  return data;
}

// Testler ve export dışı araçlar için küçük, deterministik bir ZIP yazıcı (stored/deflate). Üretim içe aktarma yolu bunu kullanmaz.
export interface ZipWriteEntry { name: string; data?: Buffer | string; dir?: boolean; unixMode?: number; method?: 0 | 8; rawName?: Buffer }
export function writeZip(entries: ZipWriteEntry[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = e.rawName ?? Buffer.from(e.name, "utf8");
    const data = e.dir ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8");
    const method = e.dir ? 0 : (e.method ?? 8);
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    const mode = e.unixMode ?? (e.dir ? 0o040755 : 0o100644);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
