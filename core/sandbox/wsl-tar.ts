//TR: Bu dosya proje dizinini WSL içine KOPYALAMAK için bağımlılıksız, yalnız düzenli dosya ve dizin içeren bir ustar arşivi üretir; sembolik bağ, hardlink ve özel dosya asla taşınmaz (arşivden çıkarma yoluyla sembolik bağ kaçışı yoktur).
import fs from "node:fs";
import path from "node:path";

export interface TarLimits { maxFiles: number; maxTotalBytes: number; maxFileBytes: number; maxDepth: number }
export const DEFAULT_TAR_LIMITS: TarLimits = {maxFiles: 20_000, maxTotalBytes: 256 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024, maxDepth: 40};
export type TarProblem = "COPY_TOO_MANY_FILES" | "COPY_TOO_LARGE" | "COPY_FILE_TOO_LARGE" | "COPY_TOO_DEEP" | "COPY_UNSAFE_NAME" | "COPY_NAME_TOO_LONG" | "COPY_ROOT_UNREADABLE";
export class TarError extends Error { constructor(readonly code: TarProblem) { super(code); this.name = "TarError"; } }
export interface TarResult { archive: Buffer; files: number; bytes: number; skippedLinks: number }

// Ad parçası: boş, "." / "..", denetim karakteri, ters bölü, sürücü iki noktası ve NUL yok; arşivde ve WSL tarafında güvenli.
const SAFE_SEGMENT = /^[^\\/:\u0000-\u001f\u007f]+$/;
const octal = (n: number, len: number) => (n.toString(8).padStart(len - 1, "0") + "\0").slice(-len);

function header(name: string, size: number, isDir: boolean): Buffer {
  const b = Buffer.alloc(512);
  let prefix = "", base = name;
  if (Buffer.byteLength(base) > 100) {
    const cut = name.lastIndexOf("/", 155);
    prefix = name.slice(0, cut); base = name.slice(cut + 1);
    if (cut <= 0 || Buffer.byteLength(prefix) > 155 || Buffer.byteLength(base) > 100) throw new TarError("COPY_NAME_TOO_LONG");
  }
  b.write(base, 0, "utf8"); b.write(octal(isDir ? 0o755 : 0o644, 8), 100, "ascii"); b.write(octal(0, 8), 108, "ascii"); b.write(octal(0, 8), 116, "ascii");
  b.write(octal(isDir ? 0 : size, 12), 124, "ascii"); b.write(octal(0, 12), 136, "ascii"); b.fill(0x20, 148, 156);
  b.write(isDir ? "5" : "0", 156, "ascii"); b.write("ustar\0", 257, "ascii"); b.write("00", 263, "ascii"); b.write(prefix, 345, "utf8");
  let sum = 0; for (const x of b) sum += x;
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return b;
}

/** Yalnız düzenli dosyalar ve dizinler; sembolik bağlar ve diğerleri atlanır (skippedLinks sayılır). Sınır aşımı veya güvensiz ad TarError. */
export function buildTar(root: string, limits: TarLimits = DEFAULT_TAR_LIMITS): TarResult {
  const chunks: Buffer[] = [];
  let files = 0, bytes = 0, skippedLinks = 0;
  const walk = (dirAbs: string, rel: string, depth: number) => {
    if (depth > limits.maxDepth) throw new TarError("COPY_TOO_DEEP");
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dirAbs, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); }
    catch { throw new TarError("COPY_ROOT_UNREADABLE"); }
    for (const e of entries) {
      if (!SAFE_SEGMENT.test(e.name) || e.name === "." || e.name === "..") throw new TarError("COPY_UNSAFE_NAME");
      const abs = path.join(dirAbs, e.name), name = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { skippedLinks++; continue; }
      if (e.isDirectory()) { chunks.push(header(name + "/", 0, true)); walk(abs, name, depth + 1); continue; }
      if (!e.isFile()) { skippedLinks++; continue; }
      const st = fs.lstatSync(abs);
      if (!st.isFile()) { skippedLinks++; continue; }
      if (st.size > limits.maxFileBytes) throw new TarError("COPY_FILE_TOO_LARGE");
      if (++files > limits.maxFiles) throw new TarError("COPY_TOO_MANY_FILES");
      bytes += st.size; if (bytes > limits.maxTotalBytes) throw new TarError("COPY_TOO_LARGE");
      const data = fs.readFileSync(abs);
      if (data.length !== st.size) throw new TarError("COPY_ROOT_UNREADABLE");
      chunks.push(header(name, data.length, false), data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  };
  walk(root, "", 0);
  chunks.push(Buffer.alloc(1024));
  return {archive: Buffer.concat(chunks), files, bytes, skippedLinks};
}
