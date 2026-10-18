// //TR: Bu coded merge gate (B4), v7/integration'a merge'i YALNIZCA tum zorunlu kapilar GERCEKTEN gecince yapar; aksi halde fail-closed REDDEDER ve hicbir sey yapmaz. Kapilar: (1) her zorunlu CI context'i (validate ubuntu + windows) tam olarak guncel head SHA icin status=completed+conclusion=success; eksik/pending/failed/cancelled/baska-SHA => RED. (2) governed CLAUDE_REVIEWER verdict'i lease-verdict.verifyVerdict ile head SHA'ya + bagimsiz oturum/kimlige bagli CLEAN; (3) base head'in atasi (strict/FF, dal base'in gerisinde degil); (4) merge conflict yok. Saf karar fonksiyonu evaluateMergeGate ag/merge yapmaz (test edilebilir); CLI varsayilan olarak yalniz DEGERLENDIRIR, gercek merge icin --apply + gh yetkisi gerekir. Testleri/kurallari ZAYIFLATMAZ; yalniz guvensiz merge'i engeller. Cloud bunu --apply ile CALISTIRMAZ; calistirmak Local/yetkili operatorundur.
import cp from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { verifyVerdict } from "../automation/lib/lease-verdict.mjs";

// Only check-runs posted by this GitHub App are trusted; a same-named "success"
// from any other app must not satisfy a required context (overridable via --check-app).
export const DEFAULT_CHECK_APP = "github-actions";

export const REQUIRED_CONTEXTS = ["validate (ubuntu-latest)", "validate (windows-latest)"];

// Pure, fail-closed decision. evidence:
//  headSha:string, requiredContexts:string[],
//  checkRuns:[{name,status,conclusion}] (already fetched FOR headSha),
//  baseIsAncestorOfHead:boolean (strict/FF: base must be an ancestor of head),
//  hasConflict:boolean,
//  verdict: governed CLEAN verdict object | null,
//  verdictExpectation: {expectedTaskId,expectedHeadSha,implementerSessionId,builderIdentity}
export function evaluateMergeGate(evidence = {}) {
  const reasons = [];
  const { headSha, requiredContexts = REQUIRED_CONTEXTS, checkRuns = [], baseIsAncestorOfHead, hasConflict, verdict, verdictExpectation } = evidence;
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
  // (4) no conflict
  if (hasConflict === true) reasons.push("MERGE_CONFLICT");
  else if (hasConflict !== false) reasons.push("CONFLICT_STATE_UNKNOWN");
  return { decision: reasons.length ? "REFUSE" : "MERGE", reasons };
}

// ---- CLI (evidence gathering + optional apply). Default: evaluate only, never merges. ----
function sh(c, a) { const r = cp.spawnSync(c, a, { encoding: "utf8", windowsHide: true }); return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }; }
function gatherAndEvaluate({ owner, repo, headSha, baseRef, verdictFile, checkApp = DEFAULT_CHECK_APP }) {
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
  const baseSha = sh("git", ["rev-parse", baseRef]).stdout.trim();
  const baseIsAncestorOfHead = baseSha ? sh("git", ["merge-base", "--is-ancestor", baseSha, headSha]).status === 0 : false;
  // conflict probe (read-only): a merge-tree with conflict markers means conflict.
  let hasConflict = true;
  if (baseSha) { const mt = sh("git", ["merge-tree", "--write-tree", baseSha, headSha]); hasConflict = mt.status !== 0 || /^CONFLICT|^<<<<<<< /m.test(mt.stdout); }
  let verdict = null, verdictExpectation = null;
  if (verdictFile && fs.existsSync(verdictFile)) { try { const j = JSON.parse(fs.readFileSync(verdictFile, "utf8")); verdict = j.verdict ?? null; verdictExpectation = j.expectation ?? null; } catch { /* missing -> REFUSE */ } }
  return evaluateMergeGate({ headSha, checkRuns, baseIsAncestorOfHead, hasConflict, verdict, verdictExpectation });
}

// pathToFileURL makes the "run as a script" check correct on Windows (a required CI platform here),
// where a raw `file://${process.argv[1]}` string does not match import.meta.url for drive-letter paths.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const apply = process.argv.includes("--apply");
  const owner = arg("--owner"), repo = arg("--repo"), headSha = arg("--head"), baseRef = arg("--base", "origin/v7/integration"), verdictFile = arg("--verdict"), checkApp = arg("--check-app", DEFAULT_CHECK_APP);
  if (!owner || !repo || !headSha) { console.error("usage: merge-via-gate.mjs --owner O --repo R --head <40-hex SHA> [--base ref] [--verdict file.json] [--check-app slug] [--apply]"); process.exit(2); }
  const result = gatherAndEvaluate({ owner, repo, headSha, baseRef, verdictFile, checkApp });
  console.log(JSON.stringify({ "//TR": "coded merge gate karari; REFUSE => hicbir merge yapilmaz", ...result, headSha, apply }, null, 2));
  if (result.decision !== "MERGE") { console.error(`MERGE_REFUSED: ${result.reasons.join("; ")}`); process.exit(1); }
  if (!apply) { console.log("GATE_PASS (evaluate-only; pass --apply with gh authority to perform the merge)"); process.exit(0); }
  // --apply: operator (Local/authorized) performs the merge after the gate verified fast-forward-ability
  // (base is an ancestor of head). `--merge` records a merge commit on the integration branch;
  // `--match-head-commit` refuses if head moved since the gate evaluated this exact SHA. Cloud does not run this path.
  const prNum = arg("--pr");
  const m = prNum ? sh("gh", ["pr", "merge", prNum, "--merge", "--match-head-commit", headSha]) : { status: 1, stderr: "no --pr given for apply" };
  if (m.status !== 0) { console.error(`MERGE_APPLY_FAILED: ${m.stderr.slice(-400)}`); process.exit(1); }
  console.log("MERGED");
}
