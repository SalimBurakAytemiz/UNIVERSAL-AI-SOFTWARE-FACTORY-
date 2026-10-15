// //TR: Bu script UASCO Windows NSIS kurulum paketini (imzasız geliştirme sürümü) üretir: reviewed lock mührünü ve checksum'a bağlı provisioned Electron'u doğrular, Control API'yi tsconfig.build.json ile JavaScript'e derler, uygulamayı repo DIŞINDAKİ bir build dizininde sahneler (yalnız runtime bağımlılık kapanışı: fastify/ajv/ajv-formats), özgün bir ikon üretir ve electron-builder'ı electronDist ile (Electron indirmeden) çalıştırır.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";

export const STATIC_DATA_FILES = [
  "registries/agents.json",
  "registries/capabilities.json",
  "registries/execution-fabrics.json",
  "registries/tool-adapters.json",
  "registries/domain-packs.json",
  "roadmap/review-packages.json",
  // INT-R3 D-M1-04: WFR-03 kanonik rol kaydı (GET /v1/agents, /v1/roles, cockpit workforce); yoksa paketli /v1/agents 503 döner.
  "registries/role-definitions.json"
];
export const DESKTOP_FILES = ["apps/desktop/main.mjs", "apps/desktop/preload.mjs", "apps/desktop/backend-error.html"];
export const BACKEND_ENTRY = "apps/control-api/src/packaged-entry.js";
export const RUNTIME_DEPENDENCIES = ["fastify", "ajv", "ajv-formats"];

const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const isInside = (parent, child) => { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };

/** Build çıktıları korumalı .gitignore değiştirilemediği için repo ağacının DIŞINDA tutulur (varsayılan: kardeş "<repo>-build" dizini). */
export function resolveBuildOutDir(root, env = process.env) {
  const out = path.resolve(env.UASCO_BUILD_OUT_DIR || path.join(path.dirname(path.resolve(root)), `${path.basename(path.resolve(root))}-build`));
  if (isInside(path.resolve(root), out)) throw new Error(`BUILD_OUT_DIR_INSIDE_REPO:${out}`);
  return out;
}

/** '//' ile başlayan açıklama anahtarlarını (//TR, //note) electron-builder şemasına verilmeden önce özyinelemeli çıkarır. */
export function stripCommentKeys(value) {
  if (Array.isArray(value)) return value.map(stripCommentKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith("//")).map(([k, v]) => [k, stripCommentKeys(v)]));
  return value;
}

/** Statik installer/electron-builder.json'u build anına özgü mutlak yollarla birleştirir; electronDist verilmeden build reddedilir. */
export function builderConfig(staticConfig, {electronDist, electronVersion, outputDir, resourcesDir}) {
  if (!electronDist || !path.isAbsolute(electronDist)) throw new Error("ELECTRON_DIST_REQUIRED");
  const c = stripCommentKeys(staticConfig);
  return {
    ...c,
    electronDist,
    electronVersion,
    directories: {output: outputDir, buildResources: resourcesDir},
    win: {...c.win, icon: path.join(resourcesDir, "icon.ico")},
    nsis: {...c.nsis, include: path.join(resourcesDir, c.nsis.include), installerIcon: path.join(resourcesDir, "icon.ico"), uninstallerIcon: path.join(resourcesDir, "icon.ico")}
  };
}

/** package-lock v3 üzerinden Node çözümleme kuralıyla runtime bağımlılık kapanışını (dev paketleri hariç) hesaplar. */
export function runtimeDependencyClosure(lock, roots = RUNTIME_DEPENDENCIES) {
  const pkgs = lock.packages ?? {}, out = new Set(), queue = [];
  const resolve = (from, name) => {
    let base = from;
    for (;;) {
      const cand = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
      if (pkgs[cand]) return cand;
      if (!base) return null;
      const i = base.lastIndexOf("/node_modules/");
      base = i >= 0 ? base.slice(0, i) : "";
    }
  };
  for (const r of roots) { const rel = resolve("", r); if (!rel) throw new Error(`RUNTIME_DEPENDENCY_MISSING:${r}`); queue.push(rel); }
  while (queue.length) {
    const rel = queue.shift();
    if (out.has(rel)) continue;
    out.add(rel);
    const e = pkgs[rel];
    if (e.dev === true) throw new Error(`RUNTIME_DEPENDENCY_IS_DEV_ONLY:${rel}`);
    for (const name of Object.keys({...(e.dependencies ?? {}), ...(e.optionalDependencies ?? {})})) {
      const dep = resolve(rel, name);
      if (!dep) { if (e.optionalDependencies?.[name]) continue; throw new Error(`RUNTIME_DEPENDENCY_UNRESOLVED:${rel}->${name}`); }
      queue.push(dep);
    }
  }
  return [...out].sort();
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;
/** Göreli import kapanışı: sahnelenmiş dosyalardan başlar, eksik .mjs/.js dosyalarını repo içindeki aynı göreli yoldan kopyalar. */
export function copyRelativeImportClosure(repoRoot, stageRoot, entries) {
  const seen = new Set(), queue = [...entries], copied = [];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const staged = path.join(stageRoot, rel);
    if (!fs.existsSync(staged)) {
      const src = path.join(repoRoot, rel);
      if (!fs.existsSync(src)) throw new Error(`IMPORT_TARGET_MISSING:${rel}`);
      fs.mkdirSync(path.dirname(staged), {recursive: true});
      fs.copyFileSync(src, staged);
      copied.push(rel);
    }
    const text = fs.readFileSync(staged, "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (target.startsWith("..")) throw new Error(`IMPORT_ESCAPES_APP:${rel}->${m[1]}`);
      queue.push(target);
    }
  }
  return copied.sort();
}

// ---------- özgün ikon (üçüncü taraf logosu yok): koyu mavi zemin üzerinde beyaz "U" ve amber vurgu ----------
function iconPixel(x, y) {
  const r = 0.2, inset = 0.04, lo = inset, hi = 1 - inset;
  const cx = Math.min(Math.max(x, lo + r), hi - r), cy = Math.min(Math.max(y, lo + r), hi - r);
  if (x < lo || x > hi || y < lo || y > hi || Math.hypot(x - cx, y - cy) > r) return null;
  const t = 0.13, R = 0.26, ux = 0.5, uy = 0.56, top = 0.22;
  let inU = false;
  if (y < uy) inU = y > top && (Math.abs(x - (ux - R + t / 2)) < t / 2 || Math.abs(x - (ux + R - t / 2)) < t / 2);
  else { const d = Math.hypot(x - ux, y - uy); inU = d <= R && d >= R - t; }
  if (inU) return [255, 255, 255, 255];
  if (Math.hypot(x - 0.5, y - 0.36) < 0.055) return [245, 166, 35, 255];
  const g = y;
  return [Math.round(24 + 20 * g), Math.round(52 + 50 * g), Math.round(96 + 90 * g), 255];
}
function renderPng(size) {
  const ss = 4, raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = iconPixel((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
        if (c) { acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3]; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4, a = acc[3] / (ss * ss);
      raw[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0; raw[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0; raw[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0; raw[o + 3] = Math.round(a);
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, {level: 9})), chunk("IEND", Buffer.alloc(0))]);
}
/** PNG gömülü çok boyutlu ICO (16-256 px) üretir; electron-builder Windows için en az 256 px ister. */
export function makeIco(sizes = [16, 24, 32, 48, 64, 128, 256]) {
  const pngs = sizes.map(renderPng), header = Buffer.alloc(6), dir = Buffer.alloc(16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + dir.length;
  sizes.forEach((s, i) => { const o = i * 16; dir[o] = s >= 256 ? 0 : s; dir[o + 1] = s >= 256 ? 0 : s; dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(pngs[i].length, o + 8); dir.writeUInt32LE(offset, o + 12); offset += pngs[i].length; });
  return Buffer.concat([header, dir, ...pngs]);
}

function copyDir(src, dst, {skipNodeModules = false} = {}) {
  fs.mkdirSync(dst, {recursive: true});
  for (const e of fs.readdirSync(src, {withFileTypes: true})) {
    if (skipNodeModules && e.name === "node_modules") continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isSymbolicLink()) throw new Error(`SYMLINK_DENIED:${s}`);
    if (e.isDirectory()) copyDir(s, d); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}
function dirStats(dir) { let files = 0, bytes = 0; const walk = (d) => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) { files++; bytes += fs.statSync(p).size; } } }; walk(dir); return {files, bytes}; }
function log(step, extra = {}) { console.log(JSON.stringify({step, at: new Date().toISOString(), ...extra})); }

async function main() {
  const root = process.cwd(), stageOnly = process.argv.includes("--stage-only"), started = Date.now();
  const {assertInstalledDependencyState} = await import("../automation/lib/dependency-install.mjs");
  const {verifyProvisionedElectron} = await import("../automation/lib/electron-provision.mjs");
  assertInstalledDependencyState(root);
  const electronExe = await verifyProvisionedElectron(root);
  const electronDist = path.dirname(electronExe);
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const electronVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
  const outRoot = resolveBuildOutDir(root), stage = path.join(outRoot, "app"), resources = path.join(outRoot, "resources"), output = path.join(outRoot, "dist-installer");
  log("verified", {electronDist, electronVersion, outRoot});

  fs.rmSync(stage, {recursive: true, force: true}); fs.rmSync(resources, {recursive: true, force: true});
  fs.mkdirSync(stage, {recursive: true}); fs.mkdirSync(resources, {recursive: true});

  // 1) backend: TypeScript -> JavaScript (protected tsconfig.json unchanged; tsconfig.build.json extends it)
  const tsc = cp.spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(root, "tsconfig.build.json"), "--outDir", stage], {cwd: root, encoding: "utf8", windowsHide: true});
  if (tsc.status !== 0) throw new Error(`BACKEND_COMPILE_FAILED:${(tsc.stdout + tsc.stderr).slice(-2000)}`);
  if (!fs.existsSync(path.join(stage, BACKEND_ENTRY))) throw new Error("BACKEND_ENTRY_NOT_EMITTED");
  log("backend-compiled");

  // 2) desktop shell + renderer + static read-only data
  for (const f of [...DESKTOP_FILES, ...STATIC_DATA_FILES]) { fs.mkdirSync(path.dirname(path.join(stage, f)), {recursive: true}); fs.copyFileSync(path.join(root, f), path.join(stage, f)); }
  copyDir(path.join(root, "apps", "desktop", "renderer"), path.join(stage, "apps", "desktop", "renderer"));
  const copiedLibs = copyRelativeImportClosure(root, stage, ["apps/desktop/main.mjs", "apps/desktop/preload.mjs", BACKEND_ENTRY]);
  log("app-staged", {copiedLibs});

  // 3) runtime node_modules closure (exact versions from the reviewed lock)
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const closure = runtimeDependencyClosure(lock);
  for (const rel of closure) copyDir(path.join(root, rel), path.join(stage, rel), {skipNodeModules: true});
  log("runtime-deps-staged", {packages: closure.length});

  // 4) app package.json (version from root package.json)
  const deps = Object.fromEntries(RUNTIME_DEPENDENCIES.map(n => [n, rootPkg.dependencies[n]]));
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({name: "uasco-desktop", productName: "UASCO", version: rootPkg.version, description: "UASCO desktop (unsigned development build)", author: {name: "UASCO"}, private: true, type: "module", main: "apps/desktop/main.mjs", dependencies: deps}, null, 2) + "\n");

  // 5) build resources: generated icon + NSIS include
  fs.writeFileSync(path.join(resources, "icon.ico"), makeIco());
  fs.copyFileSync(path.join(root, "installer", "nsis", "uasco-installer.nsh"), path.join(resources, "uasco-installer.nsh"));
  const stageStats = dirStats(stage);
  log("staged", stageStats);
  if (stageOnly) { log("done-stage-only", {stage, ms: Date.now() - started}); return; }

  // 6) electron-builder (NSIS/winCodeSign helper download approved under FA-V2-PRODUCT; Electron itself comes from electronDist)
  process.env.ELECTRON_BUILDER_CACHE = path.join(outRoot, "eb-cache");
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  const staticConfig = JSON.parse(fs.readFileSync(path.join(root, "installer", "electron-builder.json"), "utf8"));
  const config = builderConfig(staticConfig, {electronDist, electronVersion, outputDir: output, resourcesDir: resources});
  fs.rmSync(output, {recursive: true, force: true});
  const ebModule = await import("electron-builder"), eb = typeof ebModule.build === "function" ? ebModule : ebModule.default;
  await eb.build({projectDir: stage, targets: eb.Platform.WINDOWS.createTarget(["nsis"], eb.Arch.x64), config, publish: "never"});
  const artifact = path.join(output, `UASCO-Setup-${rootPkg.version}-win-x64.exe`);
  if (!fs.existsSync(artifact)) throw new Error(`INSTALLER_NOT_PRODUCED:${artifact}`);
  const summary = {artifact, bytes: fs.statSync(artifact).size, sha256: sha256File(artifact), version: rootPkg.version, signed: false, signature: "NONE (unsigned development build; SmartScreen warnings expected)", electronVersion, electronDist, unpackedApp: stageStats, durationMs: Date.now() - started};
  fs.writeFileSync(path.join(output, "BUILD-SUMMARY.json"), JSON.stringify(summary, null, 2) + "\n");
  log("installer-built", summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`BUILD_INSTALLER: FAIL ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
