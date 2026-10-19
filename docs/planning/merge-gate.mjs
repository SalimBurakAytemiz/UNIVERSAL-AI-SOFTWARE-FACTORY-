// //TR: Bu modül v7/integration için kodla zorlanan fail-closed merge kapısıdır: koordinatörün GitHub araçlarıyla topladığı kanıtı (PR, base SHA, check-run'lar, PR review'ları, diff, korumalı yollar, ruleset) saf ve deterministik değerlendirir; yalnız tüm koşullar sağlanırsa MERGE der. Aynı GitHub hesabı verdict'i yalnız süreç düzeyindedir, sahteciliğe dayanıklı DEĞİLDİR (bkz. MERGE_GATE.md).
// Usage: node docs/planning/merge-gate.mjs --evidence <file.json> [--mode process|strict] [--policy <file.json>]
//        node docs/planning/merge-gate.mjs --post-merge <file.json>
// Exit: 0 MERGE (or post-merge VERIFIED), 2 BLOCK (or MISMATCH), 3 INTERNAL_ERROR. Prints exactly one JSON line on stdout.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const EXIT = {MERGE: 0, BLOCK: 2, INTERNAL_ERROR: 3};
export const REQUIRED_CONTEXTS = Object.freeze(["validate (ubuntu-latest)", "validate (windows-latest)"]);
export const CHECK_APP = "github-actions";
export const DEFAULT_BASE_REF = "v7/integration";
export const REQUIRED_RULES = Object.freeze(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
// Floor of protected prefixes that always applies, so an evidence file whose protectedPaths was emptied or truncated cannot open them.
export const PROTECTED_FLOOR = Object.freeze([".github/workflows/", "automation/lib/", "scripts/validate-", "scripts/run-validation.mjs", "config/", "prompts/"]);
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// GitHub logins (an App's bot account carries a "[bot]" suffix). Compared case-insensitively, never echoed.
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
// The one machine line a reviewer posts in a PR REVIEW body. The whole trimmed line must match; anything else starting with the prefix is malformed.
export const BINDING_RE = /^VERDICT-BINDING: verdict=([A-Z_]{1,32}) head=([0-9a-f]{40}|[0-9a-f]{64}) base=([0-9a-f]{40}|[0-9a-f]{64}) reviewer-session=([A-Za-z0-9._:-]{1,128})$/;
const BINDING_PREFIX_RE = /^\s*verdict-binding\b/i;
const VERDICT_STATES = new Set(["COMMENTED", "APPROVED"]);

const isStr = v => typeof v === "string";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isSha = v => isStr(v) && SHA_RE.test(v);
const lc = s => s.toLowerCase();
const timeOf = v => { if (!isStr(v)) return NaN; const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };

// Normalise a repo path for protected-path matching: "\" -> "/", lower case, leading "./" or "/" dropped, "." and ".." segments resolved.
export function normPath(p) {
  if (!isStr(p) || p.trim() === "" || p.includes("\0")) return null;
  const n = path.posix.normalize(p.replace(/\\/g, "/")).replace(/^(?:\.\/|\/)+/, "");
  if (n === "" || n === "." || n === ".." || n.startsWith("../")) return null;
  return lc(n);
}

// Parse every binding line of one review body. Fail-closed: exactly one well-formed line, else a fixed code.
export function parseBinding(body) {
  if (!isStr(body)) return {code: "VERDICT_BINDING_MALFORMED"};
  const lines = body.split(/\r?\n/).filter(l => BINDING_PREFIX_RE.test(l));
  if (lines.length === 0) return null;
  if (lines.length > 1) return {code: "VERDICT_BINDING_AMBIGUOUS"};
  const m = BINDING_RE.exec(lines[0].trim());
  if (!m) return {code: "VERDICT_BINDING_MALFORMED"};
  return {verdict: m[1], head: m[2], base: m[3], session: m[4]};
}

function checkPr(pr, policy, r) {
  if (!isObj(pr)) { r.push("EVIDENCE_MALFORMED:pr"); return; }
  if (pr.state !== "open") r.push("PR_NOT_OPEN");
  if (pr.draft !== false) r.push(pr.draft === true ? "PR_DRAFT" : "EVIDENCE_MALFORMED:pr.draft");
  if (pr.merged !== false) r.push(pr.merged === true ? "PR_ALREADY_MERGED" : "EVIDENCE_MALFORMED:pr.merged");
  if (!isObj(pr.head) || !isSha(pr.head.sha)) r.push("EVIDENCE_MALFORMED:pr.head.sha");
  if (!isObj(pr.base) || !isSha(pr.base.sha)) r.push("EVIDENCE_MALFORMED:pr.base.sha");
  if (!isObj(pr.base) || pr.base.ref !== policy.expectedBaseRef) r.push("BASE_REF_MISMATCH");
  if (!isObj(pr.user) || !isStr(pr.user.login) || !LOGIN_RE.test(pr.user.login)) r.push("EVIDENCE_MALFORMED:pr.user.login");
}

function checkCi(checkRuns, headSha, r) {
  if (!Array.isArray(checkRuns)) { r.push("EVIDENCE_MALFORMED:checkRuns"); return; }
  for (const ctx of REQUIRED_CONTEXTS) {
    const named = checkRuns.filter(c => isObj(c) && c.name === ctx);
    const runs = named.filter(c => c.head_sha === headSha && c.app_slug === CHECK_APP);
    if (runs.length === 0) {
      r.push(`CHECK_MISSING:${ctx}`);
      if (named.some(c => c.head_sha !== headSha)) r.push(`CHECK_ON_OTHER_SHA:${ctx}`);
      if (named.some(c => c.head_sha === headSha && c.app_slug !== CHECK_APP)) r.push(`CHECK_FROM_OTHER_APP:${ctx}`);
      continue;
    }
    // Any unfinished run on this head means the context is not settled, whatever an earlier run said.
    if (runs.some(c => c.status !== "completed")) { r.push(`CHECK_PENDING:${ctx}`); continue; }
    if (runs.some(c => !Number.isFinite(timeOf(c.completed_at)))) { r.push(`CHECK_MALFORMED:${ctx}`); continue; }
    const latest = runs.reduce((a, b) => timeOf(b.completed_at) >= timeOf(a.completed_at) ? b : a);
    // Ties on completed_at are fail-closed: every run sharing the latest time must be a success.
    const tied = runs.filter(c => timeOf(c.completed_at) === timeOf(latest.completed_at));
    if (!tied.every(c => c.conclusion === "success")) r.push(`CHECK_FAILED:${ctx}`);
  }
}

// Verdict: PR REVIEWS only (issue comments are never read). Returns the login of the binding CLEAN review, or null.
function checkVerdict(ev, headSha, baseSha, allowed, r) {
  const {reviews} = ev;
  if (!Array.isArray(reviews)) { r.push("EVIDENCE_MALFORMED:reviews"); return null; }
  const implSessions = Array.isArray(ev.implementerSessions) ? new Set(ev.implementerSessions.filter(isStr)) : new Set();
  const cands = [];
  let older = false;
  for (const rv of reviews) {
    if (!isObj(rv) || !isObj(rv.user) || !isStr(rv.user.login) || !allowed.has(lc(rv.user.login))) continue;
    const b = parseBinding(rv.body);
    if (b === null) continue;
    if (rv.commit_id !== headSha) { older = true; continue; } // a verdict on any other commit is void
    const t = timeOf(rv.submitted_at);
    let code = null;
    if (b.code) code = b.code;
    else if (!Number.isFinite(t)) code = "VERDICT_BINDING_MALFORMED";
    else if (b.verdict !== "CLEAN") code = "VERDICT_NOT_CLEAN";
    else if (b.head !== headSha) code = "VERDICT_HEAD_MISMATCH";
    else if (b.base !== baseSha) code = "VERDICT_BASE_MISMATCH";
    else if (!VERDICT_STATES.has(rv.state)) code = "VERDICT_REVIEW_STATE_INVALID";
    else if (implSessions.has(b.session)) code = "VERDICT_REVIEWER_IS_IMPLEMENTER_SESSION";
    cands.push({t, code, login: rv.user.login, id: rv.id});
  }
  const clean = cands.filter(c => c.code === null).sort((a, b) => a.t - b.t || (Number(a.id) || 0) - (Number(b.id) || 0));
  if (clean.length === 0) {
    r.push("VERDICT_MISSING");
    if (older) r.push("VERDICT_ONLY_ON_OTHER_COMMIT");
    for (const c of cands) r.push(c.code);
    return null;
  }
  const last = clean[clean.length - 1];
  // Any non-CLEAN binding review on this head at or after the latest CLEAN (or with no usable time) supersedes it.
  const later = cands.filter(c => c.code !== null && !(c.t < last.t));
  if (later.length) { r.push("VERDICT_SUPERSEDED_BY_LATER_REVIEW"); for (const c of later) r.push(c.code); return null; }
  return last.login;
}

function checkPaths(ev, r) {
  const pp = ev.protectedPaths;
  if (!isObj(pp) || !Array.isArray(pp.exactPaths) || !Array.isArray(pp.protectedPrefixes) || pp.exactPaths.length === 0 || pp.protectedPrefixes.length === 0
    || !pp.exactPaths.every(isStr) || !pp.protectedPrefixes.every(isStr)) { r.push("EVIDENCE_MALFORMED:protectedPaths"); return; }
  if (!Array.isArray(ev.ownDiffFiles)) { r.push("EVIDENCE_MALFORMED:ownDiffFiles"); return; }
  const exact = new Set(pp.exactPaths.map(normPath).filter(Boolean));
  const prefixes = [...PROTECTED_FLOOR, ...pp.protectedPrefixes].map(p => lc(p.replace(/\\/g, "/")).replace(/^(?:\.\/|\/)+/, "")).filter(Boolean);
  for (const f of ev.ownDiffFiles) {
    const n = normPath(f);
    if (n === null) { r.push("EVIDENCE_MALFORMED:ownDiffFiles"); continue; }
    if (exact.has(n) || prefixes.some(p => n.startsWith(p))) r.push("PROTECTED_PATH");
  }
}

function checkRules(rules, mode, r) {
  if (!Array.isArray(rules)) { r.push("EVIDENCE_MALFORMED:rules"); return; }
  const ofType = t => rules.filter(x => isObj(x) && x.type === t);
  for (const t of REQUIRED_RULES) if (ofType(t).length === 0) r.push(`RULESET_MISSING:${t}`);
  const ctxs = new Set();
  for (const x of ofType("required_status_checks")) {
    const list = isObj(x.parameters) && Array.isArray(x.parameters.required_status_checks) ? x.parameters.required_status_checks : [];
    for (const c of list) if (isObj(c) && isStr(c.context)) ctxs.add(c.context);
  }
  if (ofType("required_status_checks").length) for (const ctx of REQUIRED_CONTEXTS) if (!ctxs.has(ctx)) r.push(`RULESET_MISSING:required_status_checks:${ctx}`);
  if (mode === "strict" && !ofType("pull_request").some(x => isObj(x.parameters) && Number.isInteger(x.parameters.required_approving_review_count) && x.parameters.required_approving_review_count >= 1))
    r.push("RULESET_MISSING:required_approving_review_count");
}

export function normalisePolicy(policy = {}) {
  const p = isObj(policy) ? policy : {};
  const mode = p.mode === undefined ? "process" : p.mode;
  const trusted = Array.isArray(p.trustedReviewerLogins) ? p.trustedReviewerLogins.filter(l => isStr(l) && LOGIN_RE.test(l)).map(lc) : [];
  return {mode, trusted: new Set(trusted), expectedBaseRef: isStr(p.expectedBaseRef) ? p.expectedBaseRef : DEFAULT_BASE_REF};
}

// Pure, deterministic, no I/O. Every output string is a fixed code or a validated SHA; no evidence text is ever copied out.
export function evaluateMergeGate(evidence, policy) {
  let mode = "process";
  try {
    const pol = normalisePolicy(policy);
    if (pol.mode !== "process" && pol.mode !== "strict") return out("BLOCK", null, null, ["POLICY_MALFORMED:mode"], "SAME_ACCOUNT", "NONE", "process");
    mode = pol.mode;
    const r = [];
    if (!isObj(evidence)) return out("BLOCK", null, null, ["EVIDENCE_MALFORMED:root"], "SAME_ACCOUNT", "NONE", mode);
    const ev = evidence;
    checkPr(ev.pr, pol, r);
    const headSha = isObj(ev.pr) && isObj(ev.pr.head) && isSha(ev.pr.head.sha) ? ev.pr.head.sha : null;
    const prBase = isObj(ev.pr) && isObj(ev.pr.base) && isSha(ev.pr.base.sha) ? ev.pr.base.sha : null;
    const baseSha = isSha(ev.currentBaseSha) ? ev.currentBaseSha : null;
    if (baseSha === null) r.push("EVIDENCE_MALFORMED:currentBaseSha");
    else if (prBase !== null && baseSha !== prBase) r.push("BASE_DRIFT");
    const author = isObj(ev.pr) && isObj(ev.pr.user) && isStr(ev.pr.user.login) && LOGIN_RE.test(ev.pr.user.login) ? lc(ev.pr.user.login) : null;
    // Whose reviews can carry a verdict: trusted reviewer logins, plus (process mode only) the PR author's own account. Reviews by anyone else are ignored.
    const allowed = new Set([...pol.trusted].filter(l => l !== author));
    if (mode === "process" && author) allowed.add(author);
    if (headSha) checkCi(ev.checkRuns, headSha, r);
    const reviewer = headSha && baseSha ? checkVerdict(ev, headSha, baseSha, allowed, r) : (r.push("VERDICT_MISSING"), null);
    checkPaths(ev, r);
    checkRules(ev.rules, mode, r);
    const independence = reviewer !== null && author !== null && lc(reviewer) !== author && pol.trusted.has(lc(reviewer)) ? "DISTINCT_ACCOUNT" : "SAME_ACCOUNT";
    if (mode === "strict" && independence === "SAME_ACCOUNT") r.push("REVIEWER_NOT_INDEPENDENT_IDENTITY");
    const reasons = [...new Set(r)];
    const decision = reasons.length ? "BLOCK" : "MERGE";
    const trust = decision !== "MERGE" ? "NONE" : independence === "DISTINCT_ACCOUNT" ? "DISTINCT_TRUSTED_ACCOUNT" : "PROCESS_ONLY_SAME_ACCOUNT";
    return out(decision, headSha, baseSha, reasons, independence, trust, mode);
  } catch {
    return out("INTERNAL_ERROR", null, null, ["INTERNAL_ERROR"], "SAME_ACCOUNT", "NONE", mode);
  }
}

function out(decision, expectedHeadSha, expectedBaseSha, reasons, identityIndependence, trust, mode) {
  return {decision, expectedHeadSha, expectedBaseSha, reasons, identityIndependence, trust, mode};
}

// After the merge API returned: the merge commit must have exactly [expectedBaseSha, expectedHeadSha] as parents and be the new base head.
export function verifyPostMerge(x) {
  try {
    const r = [];
    if (!isObj(x)) return {decision: "MISMATCH", reasons: ["EVIDENCE_MALFORMED:root"]};
    const {mergeCommitSha, mergeCommitParents, newBaseHead, expectedBaseSha, expectedHeadSha} = x;
    for (const [k, v] of Object.entries({mergeCommitSha, newBaseHead, expectedBaseSha, expectedHeadSha})) if (!isSha(v)) r.push(`EVIDENCE_MALFORMED:${k}`);
    if (!Array.isArray(mergeCommitParents) || !mergeCommitParents.every(isSha)) r.push("EVIDENCE_MALFORMED:mergeCommitParents");
    else if (mergeCommitParents.length !== 2 || mergeCommitParents[0] !== expectedBaseSha || mergeCommitParents[1] !== expectedHeadSha) r.push("MERGE_PARENTS_MISMATCH");
    if (isSha(newBaseHead) && isSha(mergeCommitSha) && newBaseHead !== mergeCommitSha) r.push("BASE_HEAD_NOT_MERGE_COMMIT");
    return {decision: r.length ? "MISMATCH" : "VERIFIED", reasons: r};
  } catch {
    return {decision: "MISMATCH", reasons: ["INTERNAL_ERROR"]};
  }
}

const readJson = f => { let raw; try { raw = fs.readFileSync(f, "utf8"); } catch { return {err: "UNREADABLE"}; } try { return {v: JSON.parse(raw)}; } catch { return {err: "UNPARSEABLE"}; } };

export function runCli(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!["--evidence", "--mode", "--policy", "--post-merge"].includes(a) || i + 1 >= argv.length || o[a] !== undefined)
      return {exit: EXIT.BLOCK, res: out("BLOCK", null, null, ["ARG_INVALID"], "SAME_ACCOUNT", "NONE", "process")};
    o[a] = argv[++i];
  }
  if (o["--post-merge"] !== undefined) {
    const j = readJson(o["--post-merge"]);
    const res = j.err ? {decision: "MISMATCH", reasons: [`EVIDENCE_${j.err}`]} : verifyPostMerge(j.v);
    return {exit: res.decision === "VERIFIED" ? EXIT.MERGE : EXIT.BLOCK, res};
  }
  const mode = o["--mode"] ?? "process";
  const blocked = code => ({exit: EXIT.BLOCK, res: out("BLOCK", null, null, [code], "SAME_ACCOUNT", "NONE", mode === "strict" ? "strict" : "process")});
  if (mode !== "process" && mode !== "strict") return blocked("ARG_INVALID:--mode");
  if (o["--evidence"] === undefined) return blocked("ARG_MISSING:--evidence");
  let policy = {};
  if (o["--policy"] !== undefined) { const p = readJson(o["--policy"]); if (p.err || !isObj(p.v)) return blocked(`POLICY_${p.err ?? "MALFORMED"}`); policy = p.v; }
  const e = readJson(o["--evidence"]);
  if (e.err) return blocked(`EVIDENCE_${e.err}`);
  const res = evaluateMergeGate(e.v, {...policy, mode});
  return {exit: res.decision === "MERGE" ? EXIT.MERGE : res.decision === "BLOCK" ? EXIT.BLOCK : EXIT.INTERNAL_ERROR, res};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = runCli(process.argv.slice(2)); } catch { r = {exit: EXIT.INTERNAL_ERROR, res: out("INTERNAL_ERROR", null, null, ["INTERNAL_ERROR"], "SAME_ACCOUNT", "NONE", "process")}; }
  process.stdout.write(JSON.stringify(r.res) + "\n");
  process.exitCode = r.exit;
}
