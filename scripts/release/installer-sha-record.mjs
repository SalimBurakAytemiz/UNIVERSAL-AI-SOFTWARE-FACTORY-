// //TR: Bu release script'i Windows kurulum derlemesinin (npm run dist:win, electron-builder NSIS) ürettiği UASCO-Setup-*.exe dosyasını toplar; dosya adı, bayt boyutu ve akış ile gerçekten hesaplanan SHA-256 değerini commit SHA'sına bağlı INSTALLER-RECORD.json olarak kaydeder ve sonradan bir release/kabul adımının gönderdiği .exe'yi bu kayda karşı doğrulamasını sağlar. BUILD-SUMMARY.json varsa onunla çapraz kontrol eder; uyuşmazlıkta, birden fazla/sıfır .exe'de veya geçersiz commit SHA'sında fail-closed reddeder. İmza/authenticity iddiası değildir.
// usage:
//   node scripts/release/installer-sha-record.mjs record <distInstallerDir> --commit <40-hex sha> [--out <file>]
//   node scripts/release/installer-sha-record.mjs verify <recordFile> <installer.exe> [--commit <40-hex sha>]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

export const RECORD_SCHEMA = "uasco.installer-sha-record/v1";
export const RECORD_FILE = "INSTALLER-RECORD.json";
export const INSTALLER_PATTERN = /^UASCO(?:-[A-Za-z0-9]+)*-Setup-[0-9A-Za-z.+-]+\.exe$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export class RecordError extends Error {
  constructor(code, detail = "") { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

export function normalizeCommit(sha) {
  const s = String(sha ?? "").trim().toLowerCase();
  if (!COMMIT_RE.test(s)) throw new RecordError("INVALID_COMMIT_SHA", String(sha ?? ""));
  return s;
}

export function sha256FileStream(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    let bytes = 0;
    fs.createReadStream(file)
      .on("data", (c) => { bytes += c.length; h.update(c); })
      .on("error", reject)
      .on("end", () => resolve({sha256: h.digest("hex"), bytes}));
  });
}

// Matches both the release (UASCO-Setup-*) and variant (UASCO-<Variant>-Setup-*) artifact names.
export function findInstaller(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RecordError("DIST_DIR_MISSING", dir);
  const found = fs.readdirSync(dir, {withFileTypes: true}).filter((e) => e.isFile() && INSTALLER_PATTERN.test(e.name)).map((e) => e.name).sort();
  if (found.length === 0) throw new RecordError("INSTALLER_NOT_FOUND", dir);
  if (found.length > 1) throw new RecordError("MULTIPLE_INSTALLERS", found.join(","));
  return path.join(dir, found[0]);
}

function readBuildSummary(dir) {
  const p = path.join(dir, "BUILD-SUMMARY.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { throw new RecordError("BUILD_SUMMARY_UNREADABLE", String(e?.message ?? e)); }
}

export async function createRecord(dir, commit, {now = () => new Date()} = {}) {
  const commitSha = normalizeCommit(commit);
  const exe = findInstaller(dir);
  const st = fs.lstatSync(exe);
  if (!st.isFile()) throw new RecordError("INSTALLER_NOT_REGULAR_FILE", exe);
  const {sha256, bytes} = await sha256FileStream(exe);
  if (bytes !== st.size) throw new RecordError("INSTALLER_CHANGED_DURING_HASH", `${bytes}!=${st.size}`);
  if (bytes === 0) throw new RecordError("INSTALLER_EMPTY", exe);
  const summary = readBuildSummary(dir);
  let buildSummary = {present: false};
  if (summary) {
    const name = summary.artifact ? path.basename(String(summary.artifact).replace(/\\/g, "/")) : null;
    if (name !== path.basename(exe)) throw new RecordError("BUILD_SUMMARY_ARTIFACT_MISMATCH", `${name}!=${path.basename(exe)}`);
    if (summary.sha256 !== sha256) throw new RecordError("BUILD_SUMMARY_SHA256_MISMATCH", `${summary.sha256}!=${sha256}`);
    if (summary.bytes !== bytes) throw new RecordError("BUILD_SUMMARY_BYTES_MISMATCH", `${summary.bytes}!=${bytes}`);
    buildSummary = {present: true, matches: true, version: summary.version ?? null, variant: summary.variant ?? null, signed: summary.signed === true};
  }
  return {
    "//TR": "Bu kayıt Windows kurulum .exe dosyasının adını, boyutunu ve gerçekten hesaplanmış SHA-256 değerini commit SHA'sına bağlar; imza veya authenticity iddiası değildir.",
    schema: RECORD_SCHEMA,
    commitSha,
    installer: {fileName: path.basename(exe), bytes, sha256},
    buildSummary,
    hashComputedBy: "scripts/release/installer-sha-record.mjs (node:crypto sha256, streamed)",
    recordedAt: now().toISOString(),
  };
}

export function validateRecordShape(rec) {
  if (!rec || typeof rec !== "object") throw new RecordError("RECORD_INVALID", "not an object");
  if (rec.schema !== RECORD_SCHEMA) throw new RecordError("RECORD_SCHEMA_MISMATCH", String(rec.schema));
  normalizeCommit(rec.commitSha);
  const i = rec.installer;
  if (!i || typeof i.fileName !== "string" || !INSTALLER_PATTERN.test(i.fileName)) throw new RecordError("RECORD_INVALID", "installer.fileName");
  if (!Number.isSafeInteger(i.bytes) || i.bytes <= 0) throw new RecordError("RECORD_INVALID", "installer.bytes");
  if (typeof i.sha256 !== "string" || !SHA256_RE.test(i.sha256)) throw new RecordError("RECORD_INVALID", "installer.sha256");
  return rec;
}

export async function verifyRecord(rec, exePath, {commit} = {}) {
  validateRecordShape(rec);
  const mismatches = [];
  if (commit !== undefined && normalizeCommit(commit) !== rec.commitSha) mismatches.push({field: "commitSha", expected: rec.commitSha, actual: normalizeCommit(commit)});
  if (!fs.existsSync(exePath) || !fs.lstatSync(exePath).isFile()) throw new RecordError("INSTALLER_MISSING", exePath);
  const name = path.basename(exePath);
  if (name !== rec.installer.fileName) mismatches.push({field: "fileName", expected: rec.installer.fileName, actual: name});
  const {sha256, bytes} = await sha256FileStream(exePath);
  if (bytes !== rec.installer.bytes) mismatches.push({field: "bytes", expected: rec.installer.bytes, actual: bytes});
  if (sha256 !== rec.installer.sha256) mismatches.push({field: "sha256", expected: rec.installer.sha256, actual: sha256});
  return {ok: mismatches.length === 0, commitSha: rec.commitSha, fileName: name, bytes, sha256, mismatches};
}

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit" || a === "--out") { if (i + 1 >= argv.length) throw new RecordError("USAGE", `${a} needs a value`); opt[a.slice(2)] = argv[++i]; }
    else if (a.startsWith("--")) throw new RecordError("USAGE", `unknown option ${a}`);
    else pos.push(a);
  }
  return {pos, opt};
}

export async function main(argv = process.argv.slice(2), out = console) {
  try {
    const [cmd, ...rest] = argv;
    const {pos, opt} = parseArgs(rest);
    if (cmd === "record") {
      if (pos.length !== 1) throw new RecordError("USAGE", "record <distInstallerDir> --commit <sha> [--out <file>]");
      const dir = path.resolve(pos[0]);
      const rec = await createRecord(dir, opt.commit ?? process.env.UASCO_HEAD_SHA);
      const target = path.resolve(opt.out ?? path.join(dir, RECORD_FILE));
      fs.writeFileSync(target, JSON.stringify(rec, null, 2) + "\n", {flag: "wx"});
      out.log(`INSTALLER_SHA_RECORD: PASS ${rec.installer.fileName} bytes=${rec.installer.bytes} sha256=${rec.installer.sha256} commit=${rec.commitSha} record=${target}`);
      return 0;
    }
    if (cmd === "verify") {
      if (pos.length !== 2) throw new RecordError("USAGE", "verify <recordFile> <installer.exe> [--commit <sha>]");
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.resolve(pos[0]), "utf8")); } catch (e) { throw new RecordError("RECORD_UNREADABLE", String(e?.message ?? e)); }
      const r = await verifyRecord(rec, path.resolve(pos[1]), {commit: opt.commit});
      if (!r.ok) { out.error(`INSTALLER_SHA_VERIFY: FAIL ${JSON.stringify(r.mismatches)}`); return 1; }
      out.log(`INSTALLER_SHA_VERIFY: PASS ${r.fileName} bytes=${r.bytes} sha256=${r.sha256} commit=${r.commitSha}`);
      return 0;
    }
    throw new RecordError("USAGE", "record|verify");
  } catch (e) {
    out.error(`INSTALLER_SHA_RECORD: FAIL ${e?.code ?? "ERROR"} ${e?.message ?? e}`);
    return e?.code === "USAGE" ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
