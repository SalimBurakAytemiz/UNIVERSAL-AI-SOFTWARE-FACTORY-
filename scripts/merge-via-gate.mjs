// //TR: Bu coded merge gate (B4), v7/integration'a merge'i YALNIZCA tum zorunlu kapilar GERCEKTEN gecince yapar; aksi halde fail-closed REDDEDER ve hicbir sey yapmaz. Kapilar: (1) her zorunlu CI context'i (validate ubuntu + windows) tam olarak guncel head SHA icin status=completed+conclusion=success; eksik/pending/failed/cancelled/baska-SHA => RED. (2) governed CLAUDE_REVIEWER verdict'i lease-verdict.verifyVerdict ile head SHA'ya + bagimsiz oturum/kimlige bagli CLEAN; (3) base head'in atasi (strict: dal base'in gerisinde degil; merge commit atilir, FF degil); (4) merge conflict yok. Saf karar fonksiyonu evaluateMergeGate ag/merge yapmaz (test edilebilir); CLI varsayilan olarak yalniz DEGERLENDIRIR, gercek merge icin --apply + gh yetkisi gerekir. Testleri/kurallari ZAYIFLATMAZ; yalniz guvensiz merge'i engeller. Cloud bunu --apply ile CALISTIRMAZ; calistirmak Local/yetkili operatorundur.
import cp from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { verifyVerdict } from "../automation/lib/lease-verdict.mjs";
import { redactCliText } from "../automation/lib/github-cli-env.mjs";

// Only check-runs posted by this GitHub App are trusted; a same-named "success"
// from any other app must not satisfy a required context (overridable via --check-app).
export const DEFAULT_CHECK_APP = "github-actions";

export const REQUIRED_CONTEXTS = ["validate (ubuntu-latest)", "validate (windows-latest)"];

export const DEFAULT_BASE_BRANCH = "v7/integration";

// Implementer session = the LAST `Claude-Session:` trailer of the head commit message, read via git by the CLI
// (never from the verdict file). Accepts a bare id or a claude.ai URL; both are normalised to the `session_...` id.
export function sessionIdFrom(x) { const m = typeof x === "string" ? x.match(/session_[A-Za-z0-9]+/) : null; return m ? m[0] : null; }
export function implementerSessionFromCommit(message) {
  const lines = String(message ?? "").split(/\r?\n/).filter((l) => /^Claude-Session:\s*\S/i.test(l.trim()));
  return lines.length ? sessionIdFrom(lines[lines.length - 1]) : null;
}

// The expectation is derived ONLY from independent evidence: the required --task (bound to the PR), the live head SHA,
// and the head commit's trailer/author as read from git. The verdict file contributes the review record alone;
// any `expectation` it carries is ignored, so a self-consistent fabricated file cannot vouch for itself.
// Limits (honest): the review record itself is UNSIGNED, so its provenance still relies on the operator supplying the
// governed reviewer's record; and independence is checked against the head commit's implementer session only, not every
// implementer session in merge-base..head. Signed verdicts and full-range independence are follow-ups.
export function resolveVerdict(record, { task, headSha, commitMessage, authorName }) {
  const implementerSessionId = implementerSessionFromCommit(commitMessage);
  const v = record && typeof record === "object" ? record.verdict : null;
  const verdictExpectation = task && implementerSessionId && authorName
    ? { expectedTaskId: task, expectedHeadSha: headSha, implementerSessionId, builderIdentity: authorName } : null;
  if (!v || typeof v !== "object") return { verdict: null, verdictExpectation };
  return { verdict: { ...v, implementerSessionId: sessionIdFrom(v.implementerSessionId) ?? v.implementerSessionId, reviewerSessionId: sessionIdFrom(v.reviewerSessionId) ?? v.reviewerSessionId }, verdictExpectation };
}

// Pure, fail-closed decision. evidence:
//  headSha:string, requiredContexts:string[],
//  checkRuns:[{name,status,conclusion}] (already fetched FOR headSha),
//  baseIsAncestorOfHead:boolean (strict/FF: base must be an ancestor of head),
//  hasConflict:boolean,
//  baseFetched:boolean (base ref was just fetched), expectedBaseBranch:string,
//  pr: {baseRefName,headRefOid} as read live from `gh pr view` (merge target + head must match what was evaluated),
//  verdict: governed CLEAN verdict object | null,
//  verdictExpectation: {expectedTaskId,expectedHeadSha,implementerSessionId,builderIdentity}
export function evaluateMergeGate(evidence = {}) {
  const reasons = [];
  const { headSha, requiredContexts = REQUIRED_CONTEXTS, checkRuns = [], baseIsAncestorOfHead, hasConflict, verdict, verdictExpectation, baseFetched, expectedBaseBranch = DEFAULT_BASE_BRANCH, pr } = evidence;
  if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/.test(headSha)) reasons.push("NO_VALID_HEAD_SHA");
  // (1) every run of every required CI context must be completed+success on exactly this head.
  //     Fail-closed: one success must NOT mask another run of the same context that failed / is pending.
  //     This repo emits multiple runs per SHA for the same context name (push + pull_request), so
  //     `every` (not `some`) is required — otherwise a merge could proceed with a failed required check.
  for (const ctx of requiredContexts) {
    const runs = checkRuns.filter((r) => r && r.name === ctx);
    if (!runs.length) { reasons.push(`REQUIRED_CHECK_MISSING:${ctx}`); continue; }
    const ok = runs.every((r) => r.status === "completed" && r.conclusion === "success");
    if (!ok) reasons.push(`REQUIRED_CHECK_NOT_SUCCESS:${ctx}:${runs.map((r) => r.conclusion ?? r.status).join("/")}`);
  }
  // (2) governed independent verdict, SHA + session + identity bound, CLEAN
  if (!verdict) reasons.push("GOVERNED_VERDICT_MISSING");
  else if (!verdictExpectation) reasons.push("VERDICT_EXPECTATION_MISSING");
  else {
    if (verdictExpectation.expectedHeadSha !== headSha) reasons.push("VERDICT_EXPECTATION_NOT_BOUND_TO_HEAD");
    const v = verifyVerdict(verdict, verdictExpectation);
    if (!v.ok) reasons.push(`GOVERNED_VERDICT_REJECTED:${v.reason}`);
  }
  // (3) strict / fast-forward: base must be an ancestor of head (head not behind base)
  if (baseIsAncestorOfHead !== true) reasons.push("NOT_FAST_FORWARD_OR_BEHIND_BASE");
  if (baseFetched !== true) reasons.push("BASE_NOT_FETCHED");
  // (3b) the PR must target the expected integration branch and its live head must be exactly the evaluated SHA
  if (!pr) reasons.push("PR_VIEW_MISSING");
  else {
    if (pr.baseRefName !== expectedBaseBranch) reasons.push(`PR_BASE_MISMATCH:${pr.baseRefName}`);
    if (pr.headRefOid !== headSha) reasons.push("PR_HEAD_MISMATCH");
  }
  // (4) no conflict
  if (hasConflict === true) reasons.push("MERGE_CONFLICT");
  else if (hasConflict !== false) reasons.push("CONFLICT_STATE_UNKNOWN");
  return { decision: reasons.length ? "REFUSE" : "MERGE", reasons };
}

// ---- CLI (evidence gathering + optional apply). Default: evaluate only, never merges. ----
function sh(c, a) { const r = cp.spawnSync(c, a, { encoding: "utf8", windowsHide: true }); return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }; }
function gatherAndEvaluate({ owner, repo, headSha, baseBranch, baseRef, verdictFile, task, prNum, checkApp = DEFAULT_CHECK_APP }) {
  // --paginate with --jq streams one JSON object per line (JSONL), so multi-page results no longer
  // break JSON.parse by concatenating top-level objects. Include the posting app's slug so we can
  // drop same-named check-runs from any other app (fail-closed: unknown/missing -> fewer trusted runs).
  const cr = sh("gh", ["api", `repos/${owner}/${repo}/commits/${headSha}/check-runs`, "--paginate",
    "--jq", ".check_runs[] | {name: .name, status: .status, conclusion: .conclusion, app: .app.slug}"]);
  let checkRuns = [];
  if (cr.status === 0) {
    for (const line of cr.stdout.split("\n")) {
      const s = line.trim(); if (!s) continue;
      try { const r = JSON.parse(s); if (r.app === checkApp) checkRuns.push({ name: r.name, status: r.status, conclusion: r.conclusion }); }
      catch { /* a malformed line -> skip it -> may leave a required context missing -> REFUSE */ }
    }
  }
  // Live PR facts: merge target + current head. Fetch the base first so ancestry/conflict are not judged on a stale ref.
  const baseFetched = sh("git", ["fetch", "origin", baseBranch]).status === 0;
  let pr = null;
  const pv = sh("gh", ["pr", "view", prNum, "--repo", `${owner}/${repo}`, "--json", "baseRefName,headRefOid"]);
  if (pv.status === 0) { try { const j = JSON.parse(pv.stdout); if (j && typeof j.baseRefName === "string" && typeof j.headRefOid === "string") pr = { baseRefName: j.baseRefName, headRefOid: j.headRefOid }; } catch { /* -> PR_VIEW_MISSING */ } }
  // The head commit must be local to read its trailer; fetch the PR ref if needed (failure -> no expectation -> REFUSE).
  if (sh("git", ["cat-file", "-e", `${headSha}^{commit}`]).status !== 0) sh("git", ["fetch", "origin", `refs/pull/${prNum}/head`]);
  const msg = sh("git", ["log", "-1", "--format=%B", headSha]), au = sh("git", ["log", "-1", "--format=%an", headSha]);
  const baseSha = sh("git", ["rev-parse", baseRef]).stdout.trim();
  const baseIsAncestorOfHead = baseSha ? sh("git", ["merge-base", "--is-ancestor", baseSha, headSha]).status === 0 : false;
  // conflict probe (read-only): a merge-tree with conflict markers means conflict.
  let hasConflict = true;
  if (baseSha) { const mt = sh("git", ["merge-tree", "--write-tree", baseSha, headSha]); hasConflict = mt.status !== 0 || /^CONFLICT|^<<<<<<< /m.test(mt.stdout); }
  let record = null;
  if (verdictFile && fs.existsSync(verdictFile)) { try { record = JSON.parse(fs.readFileSync(verdictFile, "utf8")); } catch { /* missing -> REFUSE */ } }
  const { verdict, verdictExpectation } = resolveVerdict(record, { task, headSha, commitMessage: msg.status === 0 ? msg.stdout : "", authorName: au.status === 0 ? au.stdout.trim() : "" });
  return evaluateMergeGate({ headSha, checkRuns, baseIsAncestorOfHead, hasConflict, verdict, verdictExpectation, baseFetched, expectedBaseBranch: baseBranch, pr });
}

// pathToFileURL makes the "run as a script" check correct on Windows (a required CI platform here),
// where a raw `file://${process.argv[1]}` string does not match import.meta.url for drive-letter paths.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const apply = process.argv.includes("--apply");
  const owner = arg("--owner"), repo = arg("--repo"), headSha = arg("--head"), baseBranch = arg("--base-branch", DEFAULT_BASE_BRANCH), baseRef = arg("--base", `origin/${baseBranch}`), verdictFile = arg("--verdict"), task = arg("--task"), prNum = arg("--pr"), checkApp = arg("--check-app", DEFAULT_CHECK_APP);
  // Validate the SHA before any git/gh call so an option-like value can never reach git as a flag.
  if (headSha && !/^[0-9a-f]{40}$/.test(headSha)) { console.error("HEAD_SHA_INVALID: --head must be a 40-hex commit SHA"); process.exit(2); }
  if (!owner || !repo || !headSha || !task || !prNum) { console.error("usage: merge-via-gate.mjs --owner O --repo R --pr N --task <task id> --head <40-hex SHA> [--base-branch v7/integration] [--base ref] [--verdict review-record.json] [--check-app slug] [--apply]"); process.exit(2); }
  const result = gatherAndEvaluate({ owner, repo, headSha, baseBranch, baseRef, verdictFile, task, prNum, checkApp });
  console.log(JSON.stringify({ "//TR": "coded merge gate karari; REFUSE => hicbir merge yapilmaz", ...result, headSha, apply }, null, 2));
  if (result.decision !== "MERGE") { console.error(`MERGE_REFUSED: ${result.reasons.join("; ")}`); process.exit(1); }
  if (!apply) { console.log("GATE_PASS (evaluate-only; pass --apply with gh authority to perform the merge)"); process.exit(0); }
  // --apply: operator (Local/authorized) performs the merge after the gate verified fast-forward-ability
  // (base is an ancestor of head). `--merge` records a merge commit on the integration branch;
  // `--match-head-commit` refuses if head moved since the gate evaluated this exact SHA. Cloud does not run this path.
  // The gate above already bound this PR's live base branch + head SHA (PR_BASE_MISMATCH / PR_HEAD_MISMATCH).
  const m = prNum ? sh("gh", ["pr", "merge", prNum, "--merge", "--match-head-commit", headSha]) : { status: 1, stderr: "no --pr given for apply" };
  if (m.status !== 0) { console.error(`MERGE_APPLY_FAILED: ${redactCliText(m.stderr).slice(-400)}`); process.exit(1); }
  console.log("MERGED");
}
