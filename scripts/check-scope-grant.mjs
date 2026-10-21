// //TR: Bu script bir Coordinator scope grant'inin iki git ref'i arasindaki degisikligi karsilayip karsilamadigini mekanik olarak denetler: degisen dosyalari, korunan politikayi ve trust-root manifestini git'ten okur, saf degerlendiriciyi (core/authority/scope-grant.mjs) cagirir ve SCOPE_GRANT_CHECK: PASS | FAIL <kodlar> yazar (cikis 0/1). Yalniz okur; hicbir dosya yazmaz, hicbir kapiyi gevsetmez, PROPOSED grant'i --assume-active-for-dry-run olmadan asla gecirmez.
// Kullanim: node scripts/check-scope-grant.mjs <grant.json> <baseRef> <headRef> [--assume-active-for-dry-run]
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {evaluateScopeGrant, MANIFEST_PATH} from "../core/authority/scope-grant.mjs";

const POLICY_PATH = "config/protected-paths.json";
const DRY = "--assume-active-for-dry-run";

// //TR: Degerlendirici kodlarina ek olarak yalniz CLI duzeyinde iki hata kodu vardir: USAGE (yanlis arguman) ve GIT_ERROR (ref yok / git basarisiz). Ikisi de FAIL ve cikis 1'dir.
function finish(codes, lines = []) {
  for (const l of lines) console.log(l);
  console.log(codes.length === 0 ? "SCOPE_GRANT_CHECK: PASS" : `SCOPE_GRANT_CHECK: FAIL ${codes.join(",")}`);
  process.exit(codes.length === 0 ? 0 : 1);
}

// //TR: git her zaman argv dizisiyle, shell olmadan calisir. Ref "-" ile baslayamaz (validRef): git secenegi olarak yorumlanip (ornegin --output=...) dosya yazdirilamaz.
function git(args) {
  const r = spawnSync("git", args, {encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true});
  return {ok: r.status === 0 && !r.error, out: r.stdout ?? "", err: (r.stderr ?? "") + (r.error ? String(r.error.message) : "")};
}
const validRef = (r) => typeof r === "string" && r.length > 0 && r.length < 512 && !r.startsWith("-") && !r.includes("..") && /^[A-Za-z0-9._\/@~^{}+-]+$/.test(r);

// //TR: Bir ref'teki dosya: yoksa null (bos manifest sayilir), JSON bozuksa "BAD" (degerlendirici GRANT_INVALID verir).
function showJson(ref, p) {
  const r = git(["show", `${ref}:${p}`]);
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch { return "BAD"; }
}

const argv = process.argv.slice(2);
const dry = argv.includes(DRY);
const pos = argv.filter((a) => a !== DRY);
if (pos.length !== 3 || pos.some((a) => a.startsWith("--"))) {
  console.error("usage: node scripts/check-scope-grant.mjs <grant.json> <baseRef> <headRef> [--assume-active-for-dry-run]");
  finish(["USAGE"]);
}
const [grantFile, baseRef, headRef] = pos;
if (!validRef(baseRef) || !validRef(headRef)) { console.error("invalid ref (allowed: letters, digits and . _ / @ ~ ^ { } + -; must not start with '-' or contain '..')"); finish(["USAGE"]); }

let grant;
try { grant = JSON.parse(fs.readFileSync(grantFile, "utf8")); } catch (e) { console.error(`cannot read grant: ${e.message}`); finish(["GRANT_INVALID"]); }
const lines = [];
if (dry) {
  lines.push("SCOPE_GRANT_DRY_RUN: grant status is treated as ACTIVE only for this dry run; the result below is NOT an authorization.");
  if (grant && typeof grant === "object" && !Array.isArray(grant)) grant = {...grant, status: "ACTIVE"};
}

for (const ref of [baseRef, headRef]) {
  const v = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (!v.ok) { console.error(`git cannot resolve ref: ${ref}`); finish(["GIT_ERROR"], lines); }
}
// //TR: --no-renames: yeniden adlandirmada hem eski hem yeni yol listelenir (korunan dosyanin baska yere tasinmasi gizlenemez). -z: ozel karakterli dosya adlari bozulmaz.
const d = git(["diff", "--name-only", "-z", "--no-renames", `${baseRef}...${headRef}`, "--"]);
if (!d.ok) { console.error(`git diff failed: ${d.err.trim()}`); finish(["GIT_ERROR"], lines); }
const changedFiles = d.out.split("\0").filter((x) => x.length > 0);

// //TR: Korunan politika GUVENILIR taraftan (baseRef) okunur: PR kendi korunan listesini daraltarak kapsam disi kalamaz (politika degisikligi zaten asla devredilemez). Politika yoksa hicbir sey korunmuyor sayilmaz: fail-closed GRANT_INVALID.
const protectedPolicy = showJson(baseRef, POLICY_PATH) ?? "MISSING";
const result = evaluateScopeGrant({
  grant, protectedPolicy, changedFiles,
  manifestBefore: showJson(baseRef, MANIFEST_PATH),
  manifestAfter: showJson(headRef, MANIFEST_PATH),
  now: Date.now(),
});
for (const v of result.violations) lines.push(`VIOLATION ${v.code}${v.path === undefined ? "" : ` ${v.path}`}`);
lines.push(`SCOPE_GRANT_CHANGED_FILES: ${changedFiles.length}`);
finish([...new Set(result.violations.map((v) => v.code))], lines);
