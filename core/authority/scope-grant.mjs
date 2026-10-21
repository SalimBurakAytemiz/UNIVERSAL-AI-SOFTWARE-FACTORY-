// //TR: Coordinator Scope Grant degerlendiricisi: Founder'in tek seferde onayladigi ozellik kapsamindaki korunan dosya degisikliklerini ve trust-root muhrunu SAF (G/C yok, deterministik, asla throw etmeyen) bir fonksiyonla denetler. Kapsam disi korunan degisiklik, asla devredilemeyen yol, kapsam disi muhur degisikligi, aktif olmayan veya suresi dolmus grant fail-closed ihlal olarak doner. Bu modul hicbir kapiyi gevsetmez ve kendi basina yetki vermez.
export const SCOPE_GRANT_CODES = Object.freeze([
  "GRANT_INVALID", "GRANT_NOT_ACTIVE", "GRANT_EXPIRED",
  "NEVER_DELEGABLE_PATH", "PROTECTED_CHANGE_OUTSIDE_GRANT", "RESEAL_OUTSIDE_GRANT",
]);
export const MANIFEST_PATH = "config/trust-root-manifest.json";

// //TR: Hicbir grant ile devredilemeyen yollar. Kontrol/koruma kapilarini, grant'in kendisini ve grant kurallarini degistirebilecek her sey burada; "listelenmis olsa bile" ihlaldir. Trust-root manifesti yalniz allowTrustRootReseal === true ise devredilebilir.
export const NEVER_DELEGABLE_EXACT = Object.freeze([
  "config/protected-paths.json", "CODEOWNERS", "docs/CODEOWNERS", ".github/CODEOWNERS",
  "scripts/generate-trust-root.mjs", "scripts/verify-trust-root.mjs",
  "config/environment-policy.json", "config/builder-execution-policy.json",
  "docs/governance/COORDINATOR-SCOPE-GRANTS.md",
]);
export const NEVER_DELEGABLE_PREFIXES = Object.freeze([".github/", "scripts/ci/uasco-review/", "docs/authority-grants/"]);

const ORDER = new Map(SCOPE_GRANT_CODES.map((c, i) => [c, i]));
const NEVER_EXACT_KEYS = new Set(NEVER_DELEGABLE_EXACT.map((p) => p.toLowerCase()));
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x) => typeof x === "string" && x.trim().length > 0;
const viol = (code, path) => (path === undefined ? {code} : {code, path});

// //TR: Yol normalizasyonu trust-root ile ayni (ters egik cizgi -> "/", bastaki "./" atilir). strict=true grant icindeki yollar icindir: zaten normal olmali, glob karakteri tasimamali. Mutlak yol, "..", bos parca, dizin (sondaki "/") ve kontrol karakteri gecersizdir.
function cleanPath(p, strict) {
  if (typeof p !== "string") return null;
  if (strict && (p.includes("\\") || p.startsWith("./") || /[*?]/.test(p))) return null;
  const s = strict ? p : p.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (s.length === 0 || s.length > 1024 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  if (s.startsWith("/") || s.endsWith("/")) return null;
  if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return s;
}

// //TR: Eslestirme buyuk/kucuk harf duyarsizdir (Windows/macOS dosya sistemleri icin fail-closed); on-ek kurali generate-trust-root.mjs / trust-root.mjs ile ayni: sondaki "/" atilir, yol on-ekin kendisi veya on-ek + "/" ile baslar ("scripts/validate-" gibi "/" ile bitmeyen on-ekler de ayni kuralla eslesir).
function prefixMatch(key, pre) {
  const base = String(pre).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
  return key === base || key.startsWith(`${base}/`);
}

function readPolicy(policy, bad) {
  if (!isObj(policy) || !Array.isArray(policy.exactPaths) || !policy.exactPaths.every(isStr)) { bad(); return null; }
  const prefixes = policy.protectedPrefixes ?? [];
  if (!Array.isArray(prefixes) || !prefixes.every(isStr)) { bad(); return null; }
  if (policy.exactPaths.length + prefixes.length === 0) { bad(); return null; }
  const exact = new Set(policy.exactPaths.map((p) => String(p).replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase()));
  return (key) => exact.has(key) || prefixes.some((pre) => prefixMatch(key, pre));
}

function readGrant(grant, bad) {
  if (!isObj(grant)) { bad(); return null; }
  const fs = grant.founderStatement, scope = grant.scope;
  let ok = isStr(grant.status) && isStr(grant.reference) && (grant.grantId === undefined || isStr(grant.grantId));
  ok = ok && isObj(fs) && isStr(fs.quote) && isStr(fs.at) && isStr(fs.channel);
  ok = ok && isObj(scope) && Array.isArray(scope.protectedFiles);
  ok = ok && (scope?.allowTrustRootReseal === undefined || typeof scope.allowTrustRootReseal === "boolean");
  ok = ok && typeof grant.expiresAt === "string" && ISO_UTC.test(grant.expiresAt) && Number.isFinite(Date.parse(grant.expiresAt));
  if (!ok) { bad(); return null; }
  const files = [];
  for (const e of scope.protectedFiles) {
    const p = isObj(e) && isStr(e.allowedChange) ? cleanPath(e.path, true) : null;
    if (p === null) { bad(isObj(e) && typeof e.path === "string" ? e.path : undefined); continue; }
    files.push(p);
  }
  if (files.length !== scope.protectedFiles.length) return null;
  return {status: grant.status, expiresMs: Date.parse(grant.expiresAt), files, granted: new Set(files.map((p) => p.toLowerCase())), reseal: scope.allowTrustRootReseal === true};
}

// //TR: Manifest girdisi: null = ref'te dosya yok (bos sayilir); undefined = hic verilmedi. Bicim bozuksa, yol tekrari varsa (ikinci kayit ilkini gizleyemez) veya girdi gecersizse null doner ve ihlal kaydedilir.
function readManifest(m, bad) {
  if (m === null) return {files: new Map(), meta: null};
  if (!isObj(m) || !Array.isArray(m.files)) { bad(MANIFEST_PATH); return null; }
  const files = new Map();
  for (const e of m.files) {
    const p = isObj(e) && typeof e.sha256 === "string" ? cleanPath(e.path, false) : null;
    if (p === null || files.has(p.toLowerCase())) { bad(isObj(e) && typeof e.path === "string" ? e.path : MANIFEST_PATH); return null; }
    files.set(p.toLowerCase(), {path: p, sha256: e.sha256});
  }
  return {files, meta: {sealStatus: m.sealStatus, schemaVersion: m.schemaVersion}};
}

function neverDelegable(key, reseal) {
  if (key === MANIFEST_PATH.toLowerCase()) return !reseal;
  if (NEVER_EXACT_KEYS.has(key)) return true;
  return NEVER_DELEGABLE_PREFIXES.some((pre) => prefixMatch(key, pre));
}

function toMs(now) {
  if (typeof now === "number") return Number.isFinite(now) ? now : NaN;
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string" && ISO_UTC.test(now)) return Date.parse(now);
  return NaN;
}

function finish(list) {
  const seen = new Set(), out = [];
  for (const v of list) { const k = `${v.code}\u0000${v.path ?? ""}`; if (!seen.has(k)) { seen.add(k); out.push(v); } }
  out.sort((a, b) => ORDER.get(a.code) - ORDER.get(b.code) || ((a.path ?? "") < (b.path ?? "") ? -1 : (a.path ?? "") > (b.path ?? "") ? 1 : 0));
  return {ok: out.length === 0, violations: out};
}

function evaluate(input) {
  const invalid = [];
  const bad = (path) => invalid.push(viol("GRANT_INVALID", path));
  if (!isObj(input)) return finish([viol("GRANT_INVALID")]);
  const {grant, protectedPolicy, changedFiles, manifestBefore, manifestAfter, now} = input;
  const g = readGrant(grant, bad);
  const isProtected = readPolicy(protectedPolicy, bad);
  const nowMs = toMs(now);
  if (Number.isNaN(nowMs)) bad();
  const changed = [];
  if (!Array.isArray(changedFiles)) bad();
  else for (const f of changedFiles) { const p = cleanPath(f, false); if (p === null) bad(typeof f === "string" ? f : undefined); else changed.push(p); }
  const keys = [...new Set(changed.map((p) => p.toLowerCase()))].sort();
  const original = new Map(changed.map((p) => [p.toLowerCase(), p]));
  const manifestTouched = keys.includes(MANIFEST_PATH.toLowerCase());
  if (manifestTouched && (manifestBefore === undefined || manifestAfter === undefined)) bad(MANIFEST_PATH);
  const before = readManifest(manifestBefore === undefined ? null : manifestBefore, bad);
  const after = readManifest(manifestAfter === undefined ? null : manifestAfter, bad);
  if (invalid.length > 0 || !g || !isProtected || !before || !after) return finish(invalid.length > 0 ? invalid : [viol("GRANT_INVALID")]);

  const out = [];
  if (g.status !== "ACTIVE") out.push(viol("GRANT_NOT_ACTIVE"));
  if (nowMs > g.expiresMs) out.push(viol("GRANT_EXPIRED"));
  // //TR: Grant'in kendisi asla devredilemez bir yolu listeliyorsa, o yol hic degismemis olsa bile ihlaldir.
  for (const p of g.files) if (neverDelegable(p.toLowerCase(), g.reseal)) out.push(viol("NEVER_DELEGABLE_PATH", p));
  for (const k of keys) {
    const p = original.get(k);
    if (neverDelegable(k, g.reseal)) out.push(viol("NEVER_DELEGABLE_PATH", p));
    const grantedHere = g.granted.has(k) || (k === MANIFEST_PATH.toLowerCase() && g.reseal);
    if (isProtected(k) && !grantedHere) out.push(viol("PROTECTED_CHANGE_OUTSIDE_GRANT", p));
  }
  // //TR: Muhur denetimi: manifestte yalniz grant'te listelenen dosyalarin girdisi eklenebilir/silinebilir/degisebilir; generatedAt serbest. sealStatus/schemaVersion degisikligi de kapsam disidir.
  for (const k of new Set([...before.files.keys(), ...after.files.keys()])) {
    const b = before.files.get(k), a = after.files.get(k);
    if (b && a && b.sha256 === a.sha256) continue;
    if (!g.granted.has(k)) out.push(viol("RESEAL_OUTSIDE_GRANT", (a ?? b).path));
  }
  if (before.meta && after.meta && (before.meta.sealStatus !== after.meta.sealStatus || before.meta.schemaVersion !== after.meta.schemaVersion)) out.push(viol("RESEAL_OUTSIDE_GRANT", MANIFEST_PATH));
  return finish(out);
}

// //TR: Tek giris noktasi. Hicbir kosulda throw etmez; beklenmeyen her hata GRANT_INVALID olarak fail-closed doner.
export function evaluateScopeGrant(input) {
  try { return evaluate(input); } catch { return finish([viol("GRANT_INVALID")]); }
}
