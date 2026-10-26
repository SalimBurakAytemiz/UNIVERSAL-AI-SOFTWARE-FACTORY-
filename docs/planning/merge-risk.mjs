// //TR: Bu modül PR değişikliğinin dosya başına risk sınıflandırmasını yapan saf ve deterministik çekirdektir (COORD-TRANSITION-AUTONOMY): ROUTINE (rutin, Founder gerekmez), PREAUTHORIZED (korunan dosyada Founder'ın önceden yetkilendirdiği ve içerikten yapısal olarak doğrulanan dar sınıf: route kaydı, masaüstü izin listesi, test kaydı, trust-root yeniden mühürleme) ve FOUNDER (yüksek risk: güvenlik kapısı, CI/bağımlılık tanımı, sır, yetki genişlemesi, otorite/kapı makinesinin kendisi, korunan dosya silme, test silme, içerik eksik). PR tier'ı dosyaların en yükseğidir. Çıktıdaki kodlar sabittir; PR metni asla kopyalanmaz. Merge-gate taban listeleri (floor) ve tek kanonik yol eşleştirici burada tanımlıdır.
// Pure: no I/O, no network, no clock. Contents (baseText/headText) are read by the caller at the exact base/head SHAs; missing contents are fail-closed (FOUNDER).
import path from "node:path";
import {evaluateProtectedChange, isCanonicalPath, AUTO, PROTECTED_CHANGE_TARGET, MANIFEST_PATH} from "../../core/authority/autonomous-authority.mjs";

// Floor that always applies, so an evidence file whose protectedPaths was emptied or truncated cannot open these.
export const PROTECTED_FLOOR = Object.freeze([".github/workflows/", "automation/lib/", "scripts/validate-", "scripts/run-validation.mjs", "config/", "prompts/"]);
export const PROTECTED_FLOOR_EXACT = Object.freeze(["claude.md", "agents.md"]);
// Files CI executes from the PR head that config/protected-paths.json does not protect: a PR could make validate pass vacuously through them.
// Always FOUNDER tier (dependency and CI-definition changes keep Founder authority). [match, category, isPrefix]
export const CI_EXECUTED_FLOOR = Object.freeze([
  ["scripts/ensure-dependencies.mjs", "ensure-dependencies", false],
  ["package.json", "npm-manifest", false],
  ["package-lock.json", "npm-lockfile", false],
  ["scripts/ci/", "ci-scripts", true],
  ["npm-shrinkwrap.json", "npm-shrinkwrap", false],
  [".npmrc", "npmrc", false],
  // Already protected in config/protected-paths.json; repeated here as defence in depth because CI runs them.
  ["scripts/secret-sanity.mjs", "secret-sanity", false],
  ["scripts/bootstrap-kernel-selftest.mjs", "bootstrap-kernel-selftest", false],
]);
// //TR: Bugün korunmasa bile her zaman FOUNDER olan yüksek risk kümesi (lower-case, ham startsWith ile eşleşir; tek kanonik ve daha sıkı eşleştirici). Kapı/otorite/sınıflandırıcı makinesi, CI ve bağımlılık tanımları, sandbox ve Electron güvenlik yüzeyi buradadır.
export const HIGH_RISK_EXACT = Object.freeze(["package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc", "scripts/generate-trust-root.mjs", "scripts/verify-trust-root.mjs",
  "scripts/secret-sanity.mjs", "scripts/ensure-dependencies.mjs", "claude.md", "agents.md", "core/agents/linux-unshare-sandbox.ts", "core/workos/execution-gate.ts",
  "apps/desktop/preload.mjs", "apps/desktop/renderer/index.html", "apps/desktop/renderer/app.js", "tests/review-governance.test.ts",
  // The recorded authority terms (also exact paths in config/protected-paths.json) and the security gates that admit or redact host work.
  "docs/authority-requests/coord-transition-autonomy.md", "docs/planning/merge_gate.md", "docs/governance/uasco-independent-review.md",
  "core/workos/risk-admission.ts", "core/workos/secret-scan.ts", "scripts/local-worker/sandbox.mjs"]);
export const HIGH_RISK_PREFIXES = Object.freeze([".github/", "scripts/ci/", "scripts/run-validation.mjs", "scripts/validate-", "automation/lib/", "config/", "prompts/", "core/authority/",
  "core/sandbox/", "tsconfig", "vitest.config.", "docs/planning/merge-gate.", "docs/planning/merge-risk.", "docs/planning/pr-controller.", "tests/support/merge-risk",
  "tests/support/pr-controller"]);
// //TR: core/, apps/, scripts/ veya automation/ altında dosya ya da dizin adında "sandbox" geçen her yol (yeni bir sandbox uygulaması, örneğin core/agents/wsl-sandbox.ts veya bir sandbox/ dizini) güvenlik sınırıdır ve FOUNDER'dır; tests/ ve docs/ altı değildir.
export const HIGH_RISK_PATTERNS = Object.freeze([/^docs\/planning\/[^/]+\.proof\.mjs$/, /^tests\/support\/[^/]*authority[^/]*\.cases\.ts$/,
  /^(?:core|apps|scripts|automation)\/.*sandbox/]);
// A deleted (or renamed-away) test file is a test removal: always FOUNDER.
export const TEST_FILE_PATTERN = /^tests\/(?:[^/]+\/)*[^/]+\.test\.ts$/;
export const RISK_TIERS = Object.freeze(["ROUTINE", "PREAUTHORIZED", "FOUNDER"]);
// //TR: İçerikten doğrulanan dar sınıflar ve tek hedef dosyaları (Autonomous Authority Engine'in PROTECTED_CHANGE_TARGET tablosundan; ikinci bir kopya yok).
export const PREAUTHORIZED_CLASSES = Object.freeze(Object.fromEntries(Object.entries(PROTECTED_CHANGE_TARGET).map(([cls, file]) => [file, cls])));
export const CONTENT_CANDIDATES = Object.freeze(Object.keys(PREAUTHORIZED_CLASSES));
export const FOUNDER_CODES = Object.freeze(["PROTECTED_PATH", "CI_EXECUTED_PATH", "HIGH_RISK_PATH", "PROTECTED_PATH_REMOVED", "TEST_FILE_REMOVED", "PROTECTED_CONTENT_MISSING",
  "PROTECTED_CLASS_MISMATCH", "FILE_ENTRY_MALFORMED"]);
export const FILE_CODES = Object.freeze(["ROUTINE", ...Object.keys(PROTECTED_CHANGE_TARGET), ...FOUNDER_CODES]);
const DIFF_STATUSES = Object.freeze(["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"]);
const ZERO_SHA = "0".repeat(40);
const RANK = {ROUTINE: 0, PREAUTHORIZED: 1, FOUNDER: 2};

const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const lc = s => s.toLowerCase();

// Normalise a repo path for protected-path matching: "\" -> "/", lower case, leading "./" or "/" dropped, "." and ".." segments resolved.
export function normPath(p) {
  if (!isStr(p) || p.trim() === "" || p.includes("\0")) return null;
  const n = path.posix.normalize(p.replace(/\\/g, "/")).replace(/^(?:\.\/|\/)+/, "");
  if (n === "" || n === "." || n === ".." || n.startsWith("../")) return null;
  return lc(n);
}

export const validProtectedPaths = pp => isObj(pp) && Array.isArray(pp.exactPaths) && Array.isArray(pp.protectedPrefixes) && pp.exactPaths.length > 0 && pp.protectedPrefixes.length > 0
  && pp.exactPaths.every(isStr) && pp.protectedPrefixes.every(isStr);

// //TR: Tek kanonik eşleştirici: tam yollar lower-case karşılaştırılır, önekler ham lower-case startsWith ile (trust-root'un "/" sınırlı eşleştiricisinden daha sıkıdır: "scripts/validate-x.mjs" ve "scripts/run-validation.mjs.bak" de eşleşir).
export function pathMatcher(protectedPaths) {
  const pp = validProtectedPaths(protectedPaths) ? protectedPaths : {exactPaths: [], protectedPrefixes: []};
  const exact = new Set([...PROTECTED_FLOOR_EXACT, ...pp.exactPaths.map(normPath).filter(Boolean)]);
  const prefixes = [...PROTECTED_FLOOR, ...pp.protectedPrefixes].map(p => lc(p.replace(/\\/g, "/")).replace(/^(?:\.\/|\/)+/, "")).filter(Boolean);
  return {
    protectedHit: n => exact.has(n) || prefixes.some(p => n.startsWith(p)),
    ciCategories: n => CI_EXECUTED_FLOOR.filter(([m, , pre]) => (pre ? n.startsWith(m) : n === m)).map(([, cat]) => cat),
  };
}
export const isHighRisk = n => isStr(n) && (HIGH_RISK_EXACT.includes(n) || HIGH_RISK_PREFIXES.some(p => n.startsWith(p)) || HIGH_RISK_PATTERNS.some(re => re.test(n)));

const founder = (file, code) => ({file, tier: "FOUNDER", code});

/**
 * //TR: Tek giriş noktası. input = {files:[{filename, status, previous_filename?, baseText?, headText?}], protectedPaths:{exactPaths, protectedPrefixes}, headSha?, headFiles?}.
 * Dönüş: {tier, files:[{file, tier, code}], classes} — tier dosyaların en yükseğidir; code ve classes yalnız sabit kodlardır. Hiçbir koşulda hata fırlatmaz (hata = FOUNDER).
 */
export function classifyChange(input) {
  try {
    const files = isObj(input) && Array.isArray(input.files) ? input.files : null;
    if (files === null) return {tier: "FOUNDER", files: [], classes: ["FILES_MALFORMED"]};
    const ppOk = validProtectedPaths(input.protectedPaths);
    const m = pathMatcher(input.protectedPaths);
    const headSha = isStr(input.headSha) && /^[0-9a-f]{40}$/.test(input.headSha) ? input.headSha : ZERO_SHA;
    const present = new Set([...(Array.isArray(input.headFiles) ? input.headFiles.filter(isStr) : []),
      ...files.filter(f => isObj(f) && isStr(f.filename) && f.status !== "removed").map(f => f.filename)]);
    const seen = new Map();
    for (const f of files) { const n = isObj(f) ? normPath(f.filename) : null; if (n !== null) seen.set(n, (seen.get(n) ?? 0) + 1); }
    const touchesRisk = n => m.protectedHit(n) || isHighRisk(n) || m.ciCategories(n).length > 0;
    const first = files.map(f => {
      const file = isObj(f) && isStr(f.filename) ? f.filename : null;
      if (file === null || !DIFF_STATUSES.includes(f.status)) return founder(file, "FILE_ENTRY_MALFORMED");
      const moved = f.status === "renamed" || f.status === "copied";
      const hasPrev = f.previous_filename !== undefined && f.previous_filename !== null;
      if ((moved && !hasPrev) || (hasPrev && !isStr(f.previous_filename))) return founder(file, "FILE_ENTRY_MALFORMED");
      // //TR: Ham ad kanonik olmalıdır: NTFS takma adları ("main.mjs.", "main.mjs ", "x:akış", "PROGRA~1") ve "./", "a//b", "\\" gibi eşdeğer yazımlar korunan bir dosyayı ROUTINE gösteremez.
      if (!isCanonicalPath(file) || (hasPrev && !isCanonicalPath(f.previous_filename))) return founder(file, "FILE_ENTRY_MALFORMED");
      const ns = [normPath(f.filename), ...(hasPrev ? [normPath(f.previous_filename)] : [])];
      if (ns.some(n => n === null) || seen.get(ns[0]) !== 1) return founder(file, "FILE_ENTRY_MALFORMED");
      // The name that disappears: the file itself when removed, the old name when renamed (a copy keeps its source). Compared on the raw names: a case-only
      // rename ("tests/a.test.ts" -> "tests/A.test.ts") removes the registered path on a case-sensitive checkout although both normalise to the same name.
      const gone = f.status === "removed" ? [ns[0]] : hasPrev && f.status !== "copied" && f.previous_filename !== file ? [ns[1]] : [];
      if (gone.some(touchesRisk)) return founder(file, "PROTECTED_PATH_REMOVED");
      if (gone.some(n => TEST_FILE_PATTERN.test(n))) return founder(file, "TEST_FILE_REMOVED");
      const ci = ns.some(n => m.ciCategories(n).length > 0), high = ns.some(isHighRisk), prot = ns.some(m.protectedHit);
      if (!ci && !high && !prot) return {file, tier: "ROUTINE", code: "ROUTINE"};
      // Content-verified classes: exactly the class's target file, modified in place (never added, removed, renamed or copied), never a CI-executed path.
      if (f.status === "modified" && !hasPrev && !ci && Object.hasOwn(PREAUTHORIZED_CLASSES, f.filename)) return {file, tier: "PENDING", code: PREAUTHORIZED_CLASSES[f.filename], entry: f};
      // The same precedence as merge-gate's reasons: CI-executed, then protected, then high-risk only (so context.md and the check summary name the same code).
      return founder(file, ci ? "CI_EXECUTED_PATH" : prot ? "PROTECTED_PATH" : "HIGH_RISK_PATH");
    });
    const evaluate = (x, extra) => {
      const {entry} = x;
      if (!isStr(entry.baseText) || !isStr(entry.headText)) return founder(x.file, "PROTECTED_CONTENT_MISSING");
      const d = evaluateProtectedChange({classId: x.code, file: x.file, baseText: entry.baseText, headText: entry.headText, headSha, ...extra});
      return d.status === AUTO ? {file: x.file, tier: "PREAUTHORIZED", code: x.code} : founder(x.file, "PROTECTED_CLASS_MISMATCH");
    };
    // Every class except the reseal first; the reseal may then cover exactly the files that came out ROUTINE or PREAUTHORIZED.
    const second = first.map(x => (x.tier === "PENDING" && x.file !== MANIFEST_PATH ? evaluate(x, {headFileExists: p => present.has(p)}) : x));
    const authorized = second.filter(x => x.tier === "ROUTINE" || x.tier === "PREAUTHORIZED").map(x => x.file);
    const bytesOf = p => { const e = files.find(f => isObj(f) && f.filename === p && f.status !== "removed" && isStr(f.headText)); return e ? Buffer.from(e.headText, "utf8") : null; };
    const result = second.map(x => (x.tier === "PENDING" ? evaluate(x, {authorizedChangedProtectedPaths: authorized, headFileBytes: bytesOf}) : x));
    let tier = ppOk ? "ROUTINE" : "FOUNDER";
    for (const x of result) if (RANK[x.tier] > RANK[tier]) tier = x.tier;
    const classes = [...new Set([...result.map(x => x.code), ...(ppOk ? [] : ["PROTECTED_PATHS_MALFORMED"])])].sort();
    return {tier, files: result.map(({file, tier: t, code}) => ({file, tier: t, code})), classes};
  } catch {
    return {tier: "FOUNDER", files: [], classes: ["CLASSIFIER_ERROR"]};
  }
}
