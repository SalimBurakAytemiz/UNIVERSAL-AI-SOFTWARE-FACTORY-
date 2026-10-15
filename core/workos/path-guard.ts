// //TR: Bu dosya kullanıcı kaynaklı yerel yolların kanonik biçimini (PS1A-C2-F1) tek yerden üretir: fs.realpathSync.native (Windows: GetFinalPathNameByHandle; 8.3 kısa adları, junction/symlink'leri açar) en yakın var olan ataya uygulanır, UNC/aygıt yolları reddedilir, açılamayan 8.3 biçimli "~<rakam>" segmentleri fail-closed reddedilir; veri dizini içi/üstü ve yönetilen depo eşitliği bu kanonik biçim üzerinden karar verilir.
import fs from "node:fs";
import path from "node:path";

const WIN = process.platform === "win32";
export type CanonicalResult = {ok: true; path: string; key: string} | {ok: false; reason: "PATH_INVALID" | "PATH_UNC_OR_DEVICE" | "PATH_SHORT_NAME_UNRESOLVED" | "PATH_UNRESOLVABLE"};
// Windows'ta karşılaştırma büyük/küçük harfe duyarsızdır.
const keyOf = (p: string) => WIN ? p.toLowerCase() : p;
const isUncOrDevice = (p: string) => /^[\\/]{2}/.test(p);
const SHORT_NAME = /~\d/;

// Kanonik yol: yol veya en yakın var olan atası realpathSync.native ile çözülür, var olmayan kalan segmentler eklenir.
// Windows: kalan segmentlerde sondaki nokta/boşluk Win32 normalizasyonu gibi kırpılır, ':' (ADS/sürücü) ve açılamayan "~<rakam>" segmenti reddedilir.
export function canonicalPath(raw: unknown, base?: string): CanonicalResult {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || /[\u0000\r\n]/.test(raw)) return {ok: false, reason: "PATH_INVALID"};
  if (isUncOrDevice(raw)) return {ok: false, reason: "PATH_UNC_OR_DEVICE"};
  const abs = base ? path.resolve(base, raw) : path.resolve(raw);
  if (isUncOrDevice(abs)) return {ok: false, reason: "PATH_UNC_OR_DEVICE"};
  const rest: string[] = [];
  let cur = abs, real: string | null = null;
  for (;;) {
    try { real = fs.realpathSync.native(cur); break; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return {ok: false, reason: "PATH_UNRESOLVABLE"};
      const parent = path.dirname(cur);
      if (parent === cur) return {ok: false, reason: "PATH_UNRESOLVABLE"};
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
  if (isUncOrDevice(real)) return {ok: false, reason: "PATH_UNC_OR_DEVICE"};
  const tail: string[] = [];
  for (const seg of rest) {
    let s = seg;
    if (WIN) {
      if (s.includes(":")) return {ok: false, reason: "PATH_INVALID"};
      s = s.replace(/[. ]+$/, "");
      if (!s) return {ok: false, reason: "PATH_INVALID"};
      // Var olmayan segmentin 8.3 açılımı alınamaz: kısa ad gibi görünüyorsa fail-closed.
      if (SHORT_NAME.test(s)) return {ok: false, reason: "PATH_SHORT_NAME_UNRESOLVED"};
    }
    tail.push(s);
  }
  const out = tail.length ? path.join(real, ...tail) : real;
  return {ok: true, path: out, key: keyOf(out)};
}

// rel boş veya kökün altındaysa true (her iki argüman kanonik anahtar olmalıdır).
export function underKey(rootKey: string, pKey: string): boolean {
  const rel = path.relative(rootKey, pKey);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Veri dizininin kanonik biçimiyle iç içe (içinde veya üstünde) olan yol yasaktır; kanonik biçim alınamazsa da yasaktır (fail-closed).
export function pathOverlapsDataDir(raw: unknown, dataDir: string): {forbidden: false; canonical: string} | {forbidden: true; reason: string} {
  const c = canonicalPath(raw);
  if (!c.ok) return {forbidden: true, reason: c.reason};
  const d = canonicalPath(dataDir);
  if (!d.ok) return {forbidden: true, reason: "DATA_DIR_UNRESOLVABLE"};
  const nominal = keyOf(path.resolve(dataDir)), rawKey = keyOf(path.resolve(raw as string));
  for (const dk of new Set([d.key, nominal])) for (const pk of new Set([c.key, rawKey])) {
    if (underKey(dk, pk) || underKey(pk, dk)) return {forbidden: true, reason: "PATH_OVERLAPS_DATA_DIR"};
  }
  return {forbidden: false, canonical: c.path};
}

// Yönetilen depo: kayıtlı yolun kanonik biçimi <dataDir>/projects/<projectId>/repo'nun kanonik biçimine eşit olmalı ve bu beklenen yolun kendisi
// bağlantı (junction/symlink) içermemelidir (kanonik beklenen = kanonik projects kökü + projectId + "repo"). Uymazsa null.
export function managedRepoCanonical(dataDir: string, projectId: string, rawPath: unknown): string | null {
  if (!/^prj_[0-9a-f]{24}$/.test(projectId)) return null;
  const c = canonicalPath(rawPath);
  const projects = canonicalPath(path.join(path.resolve(dataDir), "projects"));
  const expected = canonicalPath(path.join(path.resolve(dataDir), "projects", projectId, "repo"));
  if (!c.ok || !projects.ok || !expected.ok) return null;
  if (expected.key !== keyOf(path.join(projects.path, projectId, "repo"))) return null;
  if (c.key !== expected.key) return null;
  return c.path;
}
