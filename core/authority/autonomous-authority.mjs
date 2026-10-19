// //TR: UASCO Autonomous Authority Engine (tek kanonik politika karar noktasi). Founder'in onceden verdigi, surumlu ve trust-root'ta muhurlu politika (config/autonomous-authority-policy.json) altinda rutin yazilim gelistirme islemlerini her seferinde insan onayi istemeden AUTO_AUTHORIZED_BY_POLICY olarak yetkilendirir; kapsam disi, suresi gecmis, iptal edilmis, risk siniri asan, Founder kimligine burunen, politikayi/guvenlik kapilarini kendi kendine genisleten veya kanitsiz (CI/review/trust-root/branch-protection) her istegi BLOCKED_BY_POLICY ile reddeder. Yetki sohbet mesajiyla tasinmaz: her karar muhurlu politika + istek alanlarindan deterministik yeniden hesaplanir ve digest ile istege baglanir. Mevcut mekanizmalari yeniden yazmaz: Founder onay kayitlari icin core/authority/approval.ts (assertApprovalValid) sozlesmesini, reviewer karari icin automation/lib/lease-verdict.mjs verifyVerdict'i, gorev sahipligi icin automation/lib/task-lease.mjs kira kayitlarini kullanir.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {verifyVerdict} from "../../automation/lib/lease-verdict.mjs";
import {isValidLeaseRecord, isExpired} from "../../automation/lib/task-lease.mjs";
import {stableStringify} from "../../automation/lib/atomic-json.mjs";

export const AUTO = "AUTO_AUTHORIZED_BY_POLICY";
export const BLOCKED = "BLOCKED_BY_POLICY";
export const POLICY_PATH = "config/autonomous-authority-policy.json";
export const MANIFEST_PATH = "config/trust-root-manifest.json";
export const POLICY_SCHEMA_VERSION = "1.0.0";

// //TR: Founder kararindaki 15 rutin islem sinifi; yalniz politikada bir grant ile acikca verildiyse otomatik yetkilenir.
export const ROUTINE_ACTION_CLASSES = Object.freeze([
  "REQUIREMENT_ANALYSIS", "ARCHITECTURE_DESIGN", "SOURCE_CHANGE", "TEST_CHANGE", "FAILURE_REPAIR",
  "BRANCH_CREATE", "FEATURE_BRANCH_PUSH", "PR_UPDATE", "REVIEW_DISPATCH", "CI_FAILURE_REPAIR",
  "EVIDENCE_ARCHIVE", "GOVERNED_MERGE", "NEXT_TASK_CLAIM", "TASK_RECOVERY", "STATUS_REPORT",
]);
// //TR: Korunan dosyalarda yalniz bu dar, yapisal olarak dogrulanan degisiklik siniflari otomatik yetkilenebilir.
export const PROTECTED_CHANGE_CLASSES = Object.freeze(["TEST_REGISTRATION_APPEND", "TRUST_ROOT_RESEAL"]);
// //TR: Politika icerigi ne derse desin asla otomatik yetkilenmeyen siniflar (Founder istisna yonetimi: BLOCKED_BY_POLICY + kanit).
export const NEVER_AUTO_CLASSES = Object.freeze([
  "SPEND", "NEW_PAID_SERVICE", "LEGAL_FINANCIAL_AUTHORITY", "PRODUCTION_CHANGE", "DESTRUCTIVE", "IRREVERSIBLE",
  "EXTERNAL_SYSTEM_ACCESS", "SECRET_TRANSFER", "POLICY_CHANGE", "SECURITY_GATE_CHANGE", "GITHUB_REVIEW_APPROVE",
  "MASTER_CHANGE", "FORCE_PUSH", "BRANCH_PROTECTION_CHANGE",
]);
export const ROLES = Object.freeze(["BUILDER", "REVIEWER", "MAINTAINER", "SUPERVISOR", "DISPATCHER", "REPORTER"]);
// //TR: Yetki motorunun, politikanin ve kalite kapilarinin kendisi: bunlara dokunan hicbir degisiklik ayni politika ile otomatik yetkilenemez (politika kendi yetkisini genisletemez).
export const POLICY_CORE_PATHS = Object.freeze([
  POLICY_PATH, "core/authority/**", "tests/support/autonomous-authority.cases.ts", "automation/lib/lease-verdict.mjs",
  "automation/lib/task-lease.mjs", "automation/lib/review-governance.mjs", "scripts/merge-via-gate.mjs",
  "config/protected-paths.json", "config/action-policy.json", "scripts/run-validation.mjs", ".github/workflows/**",
]);
// //TR: Dar korunan-degisiklik siniflarinin tek hedef dosyalari; bu dosyalar POLICY_CORE degildir ama yalniz ilgili sinifla degisebilir.
const PROTECTED_CHANGE_TARGET = Object.freeze({TEST_REGISTRATION_APPEND: "config/validation.json", TRUST_ROOT_RESEAL: MANIFEST_PATH});
const TASK_BOUND = new Set(["SOURCE_CHANGE", "TEST_CHANGE", "FAILURE_REPAIR", "FEATURE_BRANCH_PUSH", "PR_UPDATE", "CI_FAILURE_REPAIR", "TASK_RECOVERY", "TEST_REGISTRATION_APPEND", "TRUST_ROOT_RESEAL"]);
// //TR: Korunan dosyayi tasiyan dali itebilen/PR'i guncelleyebilen siniflar (degisikligin kendisi ayni SHA'ya bagli AUTO yapisal kararla yetkili olmali).
const CARRIES_PROTECTED_CHANGE = new Set(["FEATURE_BRANCH_PUSH", "PR_UPDATE"]);
const CHANGE_CLASSES = new Set(["SOURCE_CHANGE", "TEST_CHANGE", "FAILURE_REPAIR", "CI_FAILURE_REPAIR", "FEATURE_BRANCH_PUSH", "PR_UPDATE", "TEST_REGISTRATION_APPEND", "TRUST_ROOT_RESEAL"]);
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_AUTO_RISK = 3;

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const nonEmpty = (x) => typeof x === "string" && x.trim().length > 0;
const isoMs = (x) => (typeof x === "string" && x.trim() ? Date.parse(x) : NaN);
export function digestOf(value) { return sha256(stableStringify(value)); }

// //TR: Basit, belirleyici yol eslestirme: tam yol, "dizin/**" oneki veya tek seviye "*" (dal adlari icin). Bilinmeyen desen hicbir seyle eslesmez (fail-closed).
export function matchPattern(pattern, value) {
  if (typeof pattern !== "string" || typeof value !== "string" || !pattern || !value) return false;
  if (pattern === "**") return true;
  if (pattern.endsWith("/**")) return value.startsWith(pattern.slice(0, -2));
  if (pattern.includes("*")) { const [pre, post, ...rest] = pattern.split("*"); if (rest.length) return false; return value.length >= pre.length + post.length && value.startsWith(pre) && value.endsWith(post) && !value.slice(pre.length, value.length - post.length).includes("/"); }
  return pattern === value;
}
const matchesAny = (patterns, value) => Array.isArray(patterns) && patterns.some((p) => matchPattern(p, value));
export function isProtectedPath(protectedPaths, file) {
  if (!protectedPaths || typeof file !== "string") return true;
  if ((protectedPaths.exactPaths ?? []).includes(file)) return true;
  return (protectedPaths.protectedPrefixes ?? []).some((p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`));
}

// //TR: Politika belgesinin semantik dogrulamasi. Bir politika NEVER_AUTO sinif veremez, politika cekirdegini kapsayan yol izni veremez, bagimsiz review / trust-root / branch-protection / iki-OS CI zorunlulugunu kapatamaz.
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return ["POLICY_NOT_OBJECT"];
  if (policy.schemaVersion !== POLICY_SCHEMA_VERSION) errors.push("POLICY_SCHEMA_VERSION");
  if (!nonEmpty(policy.policyId)) errors.push("POLICY_ID");
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 1) errors.push("POLICY_VERSION");
  if (policy.issuer?.principal !== "FOUNDER" || !nonEmpty(policy.issuer?.identityId) || !nonEmpty(policy.issuer?.decisionRef)) errors.push("POLICY_ISSUER");
  if (!nonEmpty(policy.repository)) errors.push("POLICY_REPOSITORY");
  const grants = Array.isArray(policy.grants) ? policy.grants : null;
  if (!grants || !grants.length) errors.push("POLICY_GRANTS_EMPTY");
  const ids = new Set();
  for (const g of grants ?? []) {
    const id = g?.grantId;
    if (!nonEmpty(id) || ids.has(id)) { errors.push(`GRANT_ID:${id}`); continue; }
    ids.add(id);
    if (!Array.isArray(g.actionClasses) || !g.actionClasses.length) errors.push(`GRANT_CLASSES_EMPTY:${id}`);
    for (const c of g.actionClasses ?? []) {
      if (NEVER_AUTO_CLASSES.includes(c)) errors.push(`GRANT_NEVER_AUTO_CLASS:${id}:${c}`);
      else if (!ROUTINE_ACTION_CLASSES.includes(c) && !PROTECTED_CHANGE_CLASSES.includes(c)) errors.push(`GRANT_UNKNOWN_CLASS:${id}:${c}`);
    }
    if (!Array.isArray(g.roles) || !g.roles.length || g.roles.some((r) => !ROLES.includes(r))) errors.push(`GRANT_ROLES:${id}`);
    if (!Array.isArray(g.branches) || !g.branches.length || g.branches.some((b) => matchPattern(b, "master") || b === "**")) errors.push(`GRANT_BRANCHES:${id}`);
    if (!Array.isArray(g.baseBranches) || !g.baseBranches.length || g.baseBranches.includes("master")) errors.push(`GRANT_BASE_BRANCHES:${id}`);
    if (!Array.isArray(g.paths) || !g.paths.length) errors.push(`GRANT_PATHS:${id}`);
    // //TR: Grant politika cekirdegini acikca hedefleyemez ("**" serbest; cekirdek decide() icinde her durumda engellenir).
    for (const core of POLICY_CORE_PATHS) for (const p of g.paths ?? []) if (p !== "**" && (matchPattern(p, core.replace("/**", "/x")) || matchPattern(core, p.replace("/**", "/x")))) errors.push(`GRANT_COVERS_POLICY_CORE:${id}:${core}`);
    if (!Number.isInteger(g.maxRisk) || g.maxRisk < 0 || g.maxRisk > MAX_AUTO_RISK) errors.push(`GRANT_MAX_RISK:${id}`);
    const nb = isoMs(g.notBefore), ex = isoMs(g.expiresAt);
    if (!Number.isFinite(nb) || !Number.isFinite(ex) || ex <= nb) errors.push(`GRANT_WINDOW:${id}`);
    if (g.revokedAt !== undefined && !Number.isFinite(isoMs(g.revokedAt))) errors.push(`GRANT_REVOKED_AT:${id}`);
  }
  const m = policy.mergeRequirements;
  if (!m || typeof m !== "object") errors.push("MERGE_REQUIREMENTS");
  else {
    if (!Array.isArray(m.ciContexts) || m.ciContexts.length < 2 || !m.ciContexts.every(nonEmpty)) errors.push("MERGE_CI_CONTEXTS");
    if (!nonEmpty(m.ciAppSlug)) errors.push("MERGE_CI_APP");
    if (m.requireIndependentReview !== true) errors.push("MERGE_INDEPENDENT_REVIEW_REQUIRED");
    if (m.requireTrustRootPass !== true) errors.push("MERGE_TRUST_ROOT_REQUIRED");
    if (m.requireBranchProtection !== true) errors.push("MERGE_BRANCH_PROTECTION_REQUIRED");
    if (!nonEmpty(m.baseBranch) || m.baseBranch === "master") errors.push("MERGE_BASE_BRANCH");
    if (!Array.isArray(m.blockingSeverities) || !["P0", "P1"].every((s) => m.blockingSeverities.includes(s))) errors.push("MERGE_BLOCKING_SEVERITIES");
  }
  const r = policy.retry;
  if (!r || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 1 || r.maxAttempts > 5 || !Number.isInteger(r.backoffBaseMs) || r.backoffBaseMs < 1000) errors.push("RETRY_POLICY");
  if (!Array.isArray(policy.trustedFounderIdentityIds) || !policy.trustedFounderIdentityIds.length || !policy.trustedFounderIdentityIds.includes(policy.issuer?.identityId)) errors.push("TRUSTED_FOUNDER_IDS");
  return errors;
}

// //TR: Politika ancak trust-root manifestinde SEALED ve hash'i dosya baytlariyla birebir eslesiyorsa yetki kaynagidir; aksi halde hicbir sey otomatik yetkilenmez.
export function policySealStatus({policyText, manifestText}) {
  if (typeof policyText !== "string" || typeof manifestText !== "string") return {ok: false, reason: "POLICY_OR_MANIFEST_MISSING"};
  let manifest; try { manifest = JSON.parse(manifestText); } catch { return {ok: false, reason: "MANIFEST_UNREADABLE"}; }
  if (manifest?.sealStatus !== "SEALED") return {ok: false, reason: "MANIFEST_NOT_SEALED"};
  const entry = (manifest.files ?? []).find((f) => f?.path === POLICY_PATH);
  if (!entry) return {ok: false, reason: "POLICY_NOT_IN_TRUST_ROOT"};
  const actual = sha256(Buffer.from(policyText, "utf8"));
  if (entry.sha256 !== actual) return {ok: false, reason: "POLICY_HASH_MISMATCH", expected: entry.sha256, actual};
  return {ok: true, reason: "SEALED", policySha256: actual};
}

// //TR: Depo kokunden muhurlu politikayi yukler (I/O). Bulunamaz/okunamaz/muhursuz ise {ok:false} doner; karar fonksiyonu bunu BLOCKED'a cevirir.
export function loadSealedPolicy(repoDir) {
  const read = (p) => { try { return fs.readFileSync(path.join(repoDir, p), "utf8"); } catch { return null; } };
  const policyText = read(POLICY_PATH), manifestText = read(MANIFEST_PATH);
  const seal = policySealStatus({policyText, manifestText});
  let policy = null; if (policyText !== null) { try { policy = JSON.parse(policyText); } catch { return {seal: {ok: false, reason: "POLICY_UNREADABLE"}, policy: null}; } }
  return {seal, policy};
}

function requestShapeErrors(req) {
  const e = [];
  if (!req || typeof req !== "object") return ["REQUEST_NOT_OBJECT"];
  if (!nonEmpty(req.requestId)) e.push("REQUEST_ID");
  if (!nonEmpty(req.actionClass)) e.push("ACTION_CLASS");
  if (!req.principal || !nonEmpty(req.principal.role) || !nonEmpty(req.principal.sessionId) || !nonEmpty(req.principal.identity)) e.push("PRINCIPAL");
  if (!nonEmpty(req.repository)) e.push("REPOSITORY");
  if (!nonEmpty(req.branch)) e.push("BRANCH");
  if (!nonEmpty(req.baseBranch)) e.push("BASE_BRANCH");
  if (!nonEmpty(req.taskId)) e.push("TASK_ID");
  if (!Number.isInteger(req.riskLevel) || req.riskLevel < 0 || req.riskLevel > 5) e.push("RISK_LEVEL");
  if (CHANGE_CLASSES.has(req.actionClass) || req.actionClass === "GOVERNED_MERGE") { if (!SHA_RE.test(req.headSha ?? "")) e.push("HEAD_SHA"); }
  if (CHANGE_CLASSES.has(req.actionClass) && (!Array.isArray(req.changedFiles) || req.changedFiles.some((f) => !nonEmpty(f) || f.includes("..") || f.startsWith("/") || f.includes("\\")))) e.push("CHANGED_FILES");
  return e;
}

// //TR: Kararin baglandigi istek alanlari; ayni karar baska gorev/SHA/dal/sinif/oturum icin yeniden kullanilamaz.
function boundFields(req) {
  return {actionClass: req.actionClass, repository: req.repository, branch: req.branch, baseBranch: req.baseBranch, taskId: req.taskId,
    headSha: req.headSha ?? null, principalRole: req.principal?.role ?? null, principalSessionId: req.principal?.sessionId ?? null,
    changedFiles: Array.isArray(req.changedFiles) ? [...req.changedFiles].sort() : null, attempt: Number.isInteger(req.attempt) ? req.attempt : null};
}

function grantReasonsFor(g, req, nowMs) {
  const r = [];
  if (!g.actionClasses.includes(req.actionClass)) return ["CLASS"];
  if (!g.roles.includes(req.principal.role)) r.push("ROLE");
  if (!matchesAny(g.branches, req.branch)) r.push("BRANCH");
  if (!g.baseBranches.includes(req.baseBranch)) r.push("BASE_BRANCH");
  if (g.revokedAt !== undefined && Number.isFinite(isoMs(g.revokedAt)) && isoMs(g.revokedAt) <= nowMs) r.push("REVOKED");
  if (isoMs(g.notBefore) > nowMs) r.push("NOT_YET_VALID");
  if (isoMs(g.expiresAt) <= nowMs) r.push("EXPIRED");
  if (req.riskLevel > g.maxRisk) r.push("RISK");
  return r;
}

/**
 * //TR: Tek karar noktasi. ctx = {policy, seal, protectedPaths, now, lease, protectedChangeDecisions}.
 * Donus: {status, reasons, grantId, policyId, policyVersion, policySha256, requestDigest, boundTo, decisionDigest, decidedAt}.
 */
export function decide(req, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(NaN);
  const nowMs = now.getTime();
  const reasons = [];
  const policy = ctx.policy;
  const policyErrors = validatePolicy(policy);
  if (!ctx.seal?.ok) reasons.push(`POLICY_NOT_SEALED:${ctx.seal?.reason ?? "UNKNOWN"}`);
  if (policyErrors.length) reasons.push(...policyErrors.map((x) => `POLICY_INVALID:${x}`));
  if (!Number.isFinite(nowMs)) reasons.push("EVALUATION_TIME_INVALID");
  const shape = requestShapeErrors(req);
  if (shape.length) reasons.push(...shape.map((x) => `REQUEST_INVALID:${x}`));
  let grantId = null;
  if (!shape.length) {
    // //TR: Ajanlar Founder olarak hareket edemez; Founder yetkisi yalniz muhurlu politikanin ihraci ve approval.ts kayitlari ile vardir.
    if (req.principal.role === "FOUNDER" || (policy?.trustedFounderIdentityIds ?? []).includes(req.principal.identity)) reasons.push("FOUNDER_PRINCIPAL_NOT_ACCEPTED_FROM_AGENT");
    else if (!ROLES.includes(req.principal.role)) reasons.push(`ROLE_UNKNOWN:${req.principal.role}`);
    if (NEVER_AUTO_CLASSES.includes(req.actionClass)) reasons.push(`NEVER_AUTO_CLASS:${req.actionClass}`);
    else if (!ROUTINE_ACTION_CLASSES.includes(req.actionClass) && !PROTECTED_CHANGE_CLASSES.includes(req.actionClass)) reasons.push(`ACTION_CLASS_UNKNOWN:${req.actionClass}`);
    if (policy && !policyErrors.length) {
      if (req.repository !== policy.repository) reasons.push("REPOSITORY_OUT_OF_SCOPE");
      if (req.branch === "master" || req.baseBranch === "master") reasons.push("MASTER_OUT_OF_SCOPE");
      if (req.riskLevel > MAX_AUTO_RISK) reasons.push(`RISK_ABOVE_AUTO_LIMIT:${req.riskLevel}`);
      const candidates = policy.grants.map((g) => ({g, why: grantReasonsFor(g, req, nowMs)})).filter((x) => x.why[0] !== "CLASS");
      const ok = candidates.find((x) => !x.why.length);
      if (ok) grantId = ok.g.grantId;
      else reasons.push(candidates.length ? `NO_MATCHING_GRANT:${candidates.map((x) => `${x.g.grantId}(${x.why.join("+")})`).join(",")}` : "NO_GRANT_FOR_CLASS");
      const grant = ok?.g;
      // //TR: Yol kapsami: politika cekirdegi asla; korunan yol yalniz dar korunan-degisiklik sinifiyla ve ayni SHA'ya bagli AUTO yapisal kararla.
      for (const f of req.changedFiles ?? []) {
        if (matchesAny(POLICY_CORE_PATHS, f)) { reasons.push(`POLICY_SELF_CHANGE:${f}`); continue; }
        if (isProtectedPath(ctx.protectedPaths, f)) {
          // //TR: ctx.protectedChangeDecisions cagiran oturum tarafindan evaluateProtectedChange ile git iceriginden YENIDEN HESAPLANMIS olmalidir; baska oturumdan gelen karar nesnesi kimlik belgesi degildir.
          const pcd = (ctx.protectedChangeDecisions ?? []).find((d) => d?.file === f && d?.headSha === req.headSha && d?.status === AUTO && PROTECTED_CHANGE_TARGET[d?.classId] === f);
          if (!(pcd && (req.actionClass === pcd.classId || CARRIES_PROTECTED_CHANGE.has(req.actionClass)))) reasons.push(`PROTECTED_PATH_NOT_AUTHORIZED:${f}`);
          continue;
        }
        if (PROTECTED_CHANGE_CLASSES.includes(req.actionClass)) { reasons.push(`PROTECTED_CHANGE_CLASS_TOUCHES_OTHER_FILE:${f}`); continue; }
        if (grant && (!matchesAny(grant.paths, f) || matchesAny(grant.pathsDeny ?? [], f))) reasons.push(`PATH_OUT_OF_GRANT:${f}`);
      }
      // //TR: Gorev sahipligi task-lease kaydindan dogrulanir (atomik git-ref kirasi); sohbet iddiasi degil.
      if (TASK_BOUND.has(req.actionClass)) {
        const lease = ctx.lease;
        if (!isValidLeaseRecord(lease)) reasons.push("LEASE_MISSING");
        else {
          if (lease.taskId !== req.taskId) reasons.push("LEASE_TASK_MISMATCH");
          if (req.actionClass === "TASK_RECOVERY") { if (lease.sessionId !== req.principal.sessionId && !isExpired(lease, nowMs)) reasons.push("RECOVERY_LEASE_STILL_HELD"); }
          else { if (lease.sessionId !== req.principal.sessionId) reasons.push("LEASE_HELD_BY_OTHER_SESSION"); if (isExpired(lease, nowMs)) reasons.push("LEASE_EXPIRED"); }
        }
      }
      if (req.actionClass === "NEXT_TASK_CLAIM" && isValidLeaseRecord(ctx.lease) && ctx.lease.sessionId !== req.principal.sessionId && !isExpired(ctx.lease, nowMs)) reasons.push("TASK_HELD_BY_OTHER_SESSION");
      // //TR: Sinirli yeniden deneme: sonsuz dongu yok; checkpoint olmadan kurtarma yok.
      if (req.actionClass === "TASK_RECOVERY" || req.actionClass === "CI_FAILURE_REPAIR") {
        if (!Number.isInteger(req.attempt) || req.attempt < 1) reasons.push("ATTEMPT_REQUIRED");
        else if (req.attempt > policy.retry.maxAttempts) reasons.push(`RETRY_BUDGET_EXHAUSTED:${req.attempt}>${policy.retry.maxAttempts}`);
      }
      if (req.actionClass === "TASK_RECOVERY" && !(req.checkpoint && SHA_RE.test(req.checkpoint.headSha ?? "") && nonEmpty(req.checkpoint.ref))) reasons.push("CHECKPOINT_REQUIRED");
    }
  }
  const status = reasons.length ? BLOCKED : AUTO;
  const requestDigest = shape.length ? null : digestOf(boundFields(req));
  const decision = {status, reasons, grantId: status === AUTO ? grantId : null, policyId: policy?.policyId ?? null, policyVersion: policy?.policyVersion ?? null,
    policySha256: ctx.seal?.policySha256 ?? null, requestId: req?.requestId ?? null, requestDigest, boundTo: shape.length ? null : boundFields(req),
    decidedAt: Number.isFinite(nowMs) ? now.toISOString() : null};
  decision.decisionDigest = digestOf(decision);
  return Object.freeze(decision);
}

// //TR: Retry backoff'u deterministiktir (ust sinirli ustel); ayni attempt icin her oturum ayni bekleme suresini hesaplar.
export function backoffMs(policy, attempt) {
  const base = policy?.retry?.backoffBaseMs, max = policy?.retry?.maxAttempts;
  if (!Number.isInteger(base) || !Number.isInteger(attempt) || attempt < 1 || attempt > max) return null;
  return Math.min(base * 2 ** (attempt - 1), base * 16);
}

/**
 * //TR: Karar nesneleri kimlik belgesi DEGILDIR (digest imza degildir; herkes tutarli digest'li nesne uretebilir). Bir oturum baska bir
 * oturumdan gelen AUTO karara guvenmez: karari bu fonksiyonla, kendi okudugu muhurlu politika ve git durumundan YENIDEN HESAPLAR.
 * Ayni karar baska gorev/SHA/dal/sinif/oturum icin kullanilamaz (requestDigest), politika degistiyse gecersizdir, yeniden hesap BLOCKED ise reddedilir.
 */
export function verifyDecision(decision, req, ctx = {}) {
  if (!decision || decision.status !== AUTO) return {ok: false, reason: "NOT_AUTO_AUTHORIZED"};
  if (requestShapeErrors(req).length) return {ok: false, reason: "REQUEST_INVALID"};
  if (decision.requestDigest !== digestOf(boundFields(req))) return {ok: false, reason: "DECISION_NOT_FOR_THIS_REQUEST"};
  const fresh = decide(req, ctx);
  if (fresh.status !== AUTO) return {ok: false, reason: `RECOMPUTED_BLOCKED:${fresh.reasons.join("|")}`};
  if (fresh.policySha256 !== decision.policySha256 || fresh.policyVersion !== decision.policyVersion) return {ok: false, reason: "POLICY_CHANGED_SINCE_DECISION"};
  if (fresh.grantId !== decision.grantId) return {ok: false, reason: "GRANT_CHANGED_SINCE_DECISION"};
  return {ok: true, reason: "OK"};
}

const runOk = (r) => r?.status === "completed" && r?.conclusion === "success";
// //TR: Zorunlu CI context'leri: her context icin, sabitlenmis uygulamadan ve degerlendirilen SHA'ya ait en az bir kosu olmali ve hepsi completed/success olmali; PENDING/FAILURE/CANCELLED/UNKNOWN hepsi engeller.
export function evaluateRequiredChecks(policy, checkRuns, sha) {
  const reasons = [];
  const contexts = policy?.mergeRequirements?.ciContexts ?? [];
  const app = policy?.mergeRequirements?.ciAppSlug;
  if (!contexts.length || !nonEmpty(app)) return ["CI_REQUIREMENTS_MISSING"];
  for (const ctxName of contexts) {
    const runs = (Array.isArray(checkRuns) ? checkRuns : []).filter((r) => r?.name === ctxName && r?.app === app && r?.headSha === sha);
    if (!runs.length) { reasons.push(`CI_MISSING:${ctxName}`); continue; }
    if (runs.some((r) => r.status !== "completed")) { reasons.push(`CI_PENDING:${ctxName}`); continue; }
    if (!runs.every(runOk)) reasons.push(`CI_NOT_SUCCESS:${ctxName}:${[...new Set(runs.map((r) => r.conclusion ?? "UNKNOWN"))].join("|")}`);
  }
  return reasons;
}

/**
 * //TR: Guvenli otomatik merge karari. Ayni anda gecmesi gerekenler: guncel HEAD, dogru base, draft degil, mergeable, iki-OS CI basarili,
 * bagimsiz reviewer karari (lease-verdict.verifyVerdict) ayni SHA'ya bagli ve CLEAN, trust-root PASS, korunan yollar yetkili, acik P0/P1 yok,
 * kira tutarli, GitHub branch protection gercekten etkin ve zorunlu context'leri iceriyor, hicbir self-APPROVED yok. Birisi eksikse BLOCKED.
 */
export function evaluateMerge(ev = {}, ctx = {}) {
  const reasons = [];
  const policy = ctx.policy;
  const policyErrors = validatePolicy(policy);
  if (!ctx.seal?.ok) reasons.push(`POLICY_NOT_SEALED:${ctx.seal?.reason ?? "UNKNOWN"}`);
  if (policyErrors.length) reasons.push(...policyErrors.map((x) => `POLICY_INVALID:${x}`));
  const sha = ev.evaluatedSha;
  if (!SHA_RE.test(sha ?? "")) reasons.push("EVALUATED_SHA_INVALID");
  const pr = ev.pr ?? {};
  if (pr.headSha !== sha) reasons.push("HEAD_SHA_CHANGED");
  if (!policyErrors.length && pr.baseRef !== policy.mergeRequirements.baseBranch) reasons.push(`BASE_NOT_ALLOWED:${pr.baseRef}`);
  if (pr.isDraft !== false) reasons.push("PR_IS_DRAFT_OR_UNKNOWN");
  if (pr.mergeable !== true) reasons.push("PR_NOT_MERGEABLE");
  if (!policyErrors.length) reasons.push(...evaluateRequiredChecks(policy, ev.checkRuns, sha));
  const exp = ev.expectation ?? {};
  const vv = verifyVerdict(ev.verdict, {expectedTaskId: exp.taskId, expectedHeadSha: sha, implementerSessionId: exp.implementerSessionId, builderIdentity: exp.builderIdentity});
  if (!vv.ok) reasons.push(`REVIEW_${vv.reason}`);
  // //TR: Merge'i yapan oturum, kodu yazan oturum olamaz (builder kendi PR'ini entegre etmez).
  if (!nonEmpty(ev.mergerSessionId) || ev.mergerSessionId === exp.implementerSessionId) reasons.push("MERGE_BY_IMPLEMENTER_OR_UNKNOWN");
  if (ev.trustRoot?.ok !== true) reasons.push("TRUST_ROOT_NOT_VERIFIED");
  for (const f of ev.changedFiles ?? []) {
    if (matchesAny(POLICY_CORE_PATHS, f)) reasons.push(`POLICY_SELF_CHANGE:${f}`);
    else if (isProtectedPath(ctx.protectedPaths, f) && !(ev.protectedChangeDecisions ?? []).some((d) => d?.file === f && d?.headSha === sha && d?.status === AUTO)) reasons.push(`PROTECTED_PATH_NOT_AUTHORIZED:${f}`);
  }
  if (!Array.isArray(ev.changedFiles)) reasons.push("CHANGED_FILES_UNKNOWN");
  const blocking = policyErrors.length ? ["P0", "P1"] : policy.mergeRequirements.blockingSeverities;
  const open = (ev.openFindings ?? []).filter((f) => blocking.includes(f?.severity) && f?.resolved !== true);
  if (open.length) reasons.push(`OPEN_BLOCKERS:${open.length}`);
  if (!Array.isArray(ev.openFindings)) reasons.push("FINDINGS_UNKNOWN");
  if (!isValidLeaseRecord(ev.lease)) reasons.push("LEASE_MISSING");
  else { if (ev.lease.taskId !== exp.taskId) reasons.push("LEASE_TASK_MISMATCH"); if (ev.lease.headSha && ev.lease.headSha !== sha) reasons.push("LEASE_HEAD_MISMATCH"); }
  const bp = ev.branchProtection ?? {};
  if (bp.active !== true) reasons.push("BRANCH_PROTECTION_NOT_ACTIVE");
  else if (!policyErrors.length && !policy.mergeRequirements.ciContexts.every((c) => (bp.requiredContexts ?? []).includes(c))) reasons.push("BRANCH_PROTECTION_MISSING_REQUIRED_CONTEXTS");
  // //TR: Botlar GitHub APPROVED uretmez; COMMENTED onay sayilmaz. PR yazari kimliginden gelen APPROVED bir anomalidir ve engeller.
  if ((ev.githubReviews ?? []).some((r) => r?.state === "APPROVED" && r?.author && r.author === pr.author)) reasons.push("SELF_APPROVAL_PRESENT");
  const status = reasons.length ? BLOCKED : AUTO;
  const out = {status, merge: status === AUTO ? "AUTHORIZED" : "BLOCKED", reasons, evaluatedSha: sha ?? null, policyVersion: policy?.policyVersion ?? null, policySha256: ctx.seal?.policySha256 ?? null};
  out.decisionDigest = digestOf(out);
  return Object.freeze(out);
}

function deepEqual(a, b) { return stableStringify(a) === stableStringify(b); }
const TEST_FILE_RE = /^tests\/[a-z0-9.-]+\.test\.ts$/;
const isShard = (id) => id === "tests" || /^tests-([2-9]|[1-9]\d+)$/.test(id);

/**
 * //TR: Dar korunan-degisiklik siniflarinin YAPISAL dogrulamasi (dosya icerigi uzerinden, mesaj uzerinden degil):
 * TEST_REGISTRATION_APPEND: config/validation.json'da yalniz son tests kabuguna, diskte var olan ve hicbir adimda bulunmayan yeni tests/*.test.ts dosyalari eklenir; baska hicbir alan degismez.
 * TRUST_ROOT_RESEAL: manifestte yalniz yetkili korunan dosyalarin sha256'si, head dosya baytlarindan hesaplanan degerle guncellenir (+generatedAt); giris eklenmez/silinmez, muhur SEALED kalir.
 */
export function evaluateProtectedChange(input = {}) {
  const {classId, file, baseText, headText, headSha, headFileExists, headFileBytes, authorizedChangedProtectedPaths} = input;
  const reasons = [];
  const done = () => { const out = {status: reasons.length ? BLOCKED : AUTO, classId: classId ?? null, file: file ?? null, headSha: headSha ?? null, reasons}; out.decisionDigest = digestOf(out); return Object.freeze(out); };
  if (!PROTECTED_CHANGE_CLASSES.includes(classId)) { reasons.push(`UNSUPPORTED_PROTECTED_CHANGE_CLASS:${classId}`); return done(); }
  if (PROTECTED_CHANGE_TARGET[classId] !== file) { reasons.push(`CLASS_FILE_MISMATCH:${file}`); return done(); }
  if (!SHA_RE.test(headSha ?? "")) reasons.push("HEAD_SHA_INVALID");
  let base, head; try { base = JSON.parse(baseText); head = JSON.parse(headText); } catch { reasons.push("JSON_UNREADABLE"); return done(); }
  if (classId === "TEST_REGISTRATION_APPEND") {
    const {steps: bs, ...bRest} = base ?? {}, {steps: hs, ...hRest} = head ?? {};
    if (!deepEqual(bRest, hRest)) reasons.push("NON_STEP_FIELDS_CHANGED");
    if (!Array.isArray(bs) || !Array.isArray(hs) || bs.length !== hs.length) { reasons.push("STEP_COUNT_CHANGED"); return done(); }
    const shardIdx = bs.map((s, i) => (isShard(s?.id) ? i : -1)).filter((i) => i >= 0);
    const last = shardIdx.at(-1);
    if (last === undefined) { reasons.push("NO_TEST_SHARD"); return done(); }
    for (let i = 0; i < bs.length; i++) if (i !== last && !deepEqual(bs[i], hs[i])) reasons.push(`STEP_CHANGED:${bs[i]?.id}`);
    const b = bs[last], h = hs[last];
    const {command: bc, ...bo} = b, {command: hc, ...ho} = h;
    if (!deepEqual(bo, ho)) reasons.push("SHARD_FIELDS_CHANGED");
    if (!Array.isArray(bc) || !Array.isArray(hc) || hc.length <= bc.length || !deepEqual(hc.slice(0, bc.length), bc)) { reasons.push("NOT_A_PURE_APPEND"); return done(); }
    const appended = hc.slice(bc.length);
    const existing = new Set(bs.flatMap((s) => (Array.isArray(s?.command) ? s.command : [])));
    if (new Set(appended).size !== appended.length) reasons.push("DUPLICATE_APPEND");
    for (const t of appended) {
      if (!TEST_FILE_RE.test(t)) reasons.push(`NOT_A_TEST_FILE:${t}`);
      else if (existing.has(t)) reasons.push(`ALREADY_REGISTERED:${t}`);
      else if (typeof headFileExists !== "function" || headFileExists(t) !== true) reasons.push(`TEST_FILE_NOT_AT_HEAD:${t}`);
    }
    return done();
  }
  // TRUST_ROOT_RESEAL
  if (head?.sealStatus !== "SEALED") reasons.push("RESEAL_NOT_SEALED");
  const {files: bf, generatedAt: _bg, ...bRest} = base ?? {}, {files: hf, generatedAt: _hg, ...hRest} = head ?? {};
  if (!deepEqual(bRest, hRest)) reasons.push("MANIFEST_FIELDS_CHANGED");
  if (!Array.isArray(bf) || !Array.isArray(hf) || bf.length !== hf.length) { reasons.push("MANIFEST_ENTRY_COUNT_CHANGED"); return done(); }
  const allowed = new Set(Array.isArray(authorizedChangedProtectedPaths) ? authorizedChangedProtectedPaths : []);
  for (let i = 0; i < bf.length; i++) {
    const be = bf[i], he = hf[i];
    if (be?.path !== he?.path) { reasons.push(`MANIFEST_ORDER_OR_PATH_CHANGED:${be?.path}`); continue; }
    if (be.sha256 === he.sha256) continue;
    if (matchesAny(POLICY_CORE_PATHS, he.path)) { reasons.push(`RESEAL_OF_POLICY_CORE:${he.path}`); continue; }
    if (!allowed.has(he.path)) { reasons.push(`RESEAL_NOT_AUTHORIZED:${he.path}`); continue; }
    const bytes = typeof headFileBytes === "function" ? headFileBytes(he.path) : null;
    if (!bytes || sha256(bytes) !== he.sha256) reasons.push(`RESEAL_HASH_NOT_FROM_CONTENT:${he.path}`);
  }
  return done();
}

// //TR: Founder Cockpit / Approval Center icin salt-okunur kayit: rutin isler onay butonu yerine AUTO_AUTHORIZED, engeller gercek gerekceleriyle gosterilir.
export function toCockpitRecord(decision) {
  return Object.freeze({display: decision?.status === AUTO ? "AUTO_AUTHORIZED" : "BLOCKED", status: decision?.status ?? BLOCKED,
    actionClass: decision?.boundTo?.actionClass ?? null, taskId: decision?.boundTo?.taskId ?? null, headSha: decision?.boundTo?.headSha ?? decision?.evaluatedSha ?? null,
    reasons: [...(decision?.reasons ?? [])], policyVersion: decision?.policyVersion ?? null, decisionDigest: decision?.decisionDigest ?? null, decidedAt: decision?.decidedAt ?? null});
}
