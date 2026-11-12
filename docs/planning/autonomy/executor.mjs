// //TR: Bu yürütücü FD-2026-11-03 kalıcı otonomi kararını gerçekten uygular: autonomy.mjs AUTO_MERGE derse PR'ı GitHub üzerinden beklenen head SHA ile merge eder, merge commit'inin ebeveynlerini (base, head) ve yeni base'i doğrular, ana dal CI'ını raporlar; AUTO_MERGE dışındaki her kararda hiçbir şey yazmaz. Çıktılar yalnız sabit kodlar ve doğrulanmış SHA'lardır.
// Usage:
//   node docs/planning/autonomy/executor.mjs merge --pr <n> --implementer-session <id> [...]   (decide + merge + verify)
//   node docs/planning/autonomy/executor.mjs verify-main --sha <merge sha>                     (post-merge push CI on the base)
// Exit: 0 MERGED_VERIFIED / MAIN_PASS, 2 BLOCK / MAIN_FAIL, 4 FOUNDER_REQUIRED, 5 MERGE_FAILED / VERIFY_FAILED / MAIN_RUNNING, 3 INTERNAL_ERROR.
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {collectEvidence, decideFor, curlApi} from "./autonomy.mjs";
import fs from "node:fs";
import {mergeAuthority, liveAuthorityReaders} from "../../../automation/factory-v2/v41-guard.mjs";

export const EXIT = {MERGED_VERIFIED: 0, MAIN_PASS: 0, BLOCK: 2, INTERNAL_ERROR: 3, FOUNDER_REQUIRED: 4, MERGE_FAILED: 5, VERIFY_FAILED: 5, MAIN_RUNNING: 5, MAIN_FAIL: 2};
const SHA_RE = /^[0-9a-f]{40}$/;
// The base workflows whose push runs must pass on the merge commit (the required CI and the Windows installer build).
export const MAIN_WORKFLOWS = Object.freeze([".github/workflows/ci.yml", ".github/workflows/windows-installer.yml"]);
const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-";

/** Write access through curl (the environment's proxy authenticates). executeMerge only ever calls it with PUT pulls/<n>/merge. */
export const curlWrite = repo => (method, p, body) => JSON.parse(execFileSync("curl", ["-sS", "-X", method, "-H", "Content-Type: application/json",
  "-H", "Accept: application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? ["-H", `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : []),
  `https://api.github.com/repos/${repo}/${p}`, "-d", JSON.stringify(body)], {maxBuffer: 16 << 20}).toString("utf8"));

/**
 * Decide, and only on AUTO_MERGE merge with expectedHeadSha, then verify the merge commit's parents are exactly (base, head).
 * Nothing is written for any other decision. A merge that GitHub refuses, or a merge commit that does not verify, is reported, never retried.
 */
/** Factory V2 authority fence: before any write, the verified shared authority record must allow this merge (V4.1 while authoritative; V2 only with a signed holder intent). */
const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// api = the executor's own GitHub reader, used for the registry branch-protection check (no force-push, no deletion).
const liveAuthority = a => mergeAuthority({...liveAuthorityReaders({repoRoot: ROOT_DIR, api: curlApi(REPO)}), ...a});
export function executeMerge({api, write, pr, implementerSessions, decide = decideFor, collect = collectEvidence, authority = liveAuthority, v2Intent = null}) {
  const c = collect({api, pr, implementerSessions});
  const {gate, result} = decide(c);
  const base = {pr, task: result.task, expectedHeadSha: result.expectedHeadSha, expectedBaseSha: result.expectedBaseSha, reasons: result.reasons,
    gate: {decision: gate.decision, trust: gate.trust, identityIndependence: gate.identityIndependence}};
  if (result.decision !== "AUTO_MERGE") return {...base, decision: result.decision};
  if (!SHA_RE.test(result.expectedHeadSha ?? "") || !SHA_RE.test(result.expectedBaseSha ?? "")) return {...base, decision: "INTERNAL_ERROR", reasons: ["SHA_MALFORMED"]};
  // Only a true merge commit can be verified as (base, head); any other method is refused before writing (review 5758193752 L-6).
  if ((c.policy?.mergeMethod ?? "merge") !== "merge") return {...base, decision: "INTERNAL_ERROR", reasons: ["MERGE_METHOD_UNSUPPORTED"]};
  const baseRef = c.evidence.pr.base.ref;
  // GitHub's merge API binds only the head. The base is re-read immediately before the write, so a base that moved is refused
  // instead of merged; a move inside the remaining window is detected afterwards by verifyMerge (VERIFY_FAILED), never hidden (NB-1).
  let tip0;
  try { tip0 = api(`branches/${encodeURIComponent(baseRef)}`).commit.sha; } catch { return {...base, decision: "INTERNAL_ERROR", reasons: ["BASE_UNREADABLE"]}; }
  if (tip0 !== result.expectedBaseSha) return {...base, decision: "BLOCK", reasons: ["BASE_MOVED_BEFORE_MERGE"]};
  let g;
  try { g = authority({pr, headSha: result.expectedHeadSha, v2Intent}); } catch { g = {allowed: false, reason: "AUTHORITY_CHECK_FAILED"}; }
  if (!g?.allowed) return {...base, decision: "BLOCK", reasons: [`AUTHORITY:${g?.reason ?? "UNKNOWN"}`]};
  let m;
  try { m = write("PUT", `pulls/${pr}/merge`, {sha: result.expectedHeadSha, merge_method: "merge"}); } catch { m = null; }
  if (!m || m.merged !== true || !SHA_RE.test(m.sha ?? "")) {
    // L-4: a lost or non-JSON response may hide a merge that happened; the PR is re-read before reporting, never re-merged.
    let p = null;
    try { p = api(`pulls/${pr}`); } catch { p = null; }
    if (!(p && p.merged === true && SHA_RE.test(p.merge_commit_sha ?? "") && p.head?.sha === result.expectedHeadSha)) return {...base, decision: "MERGE_FAILED", reasons: [m ? "MERGE_REFUSED" : "MERGE_REQUEST_FAILED"]};
    m = {merged: true, sha: p.merge_commit_sha};
  }
  const v = verifyMerge({api, mergeSha: m.sha, baseSha: result.expectedBaseSha, headSha: result.expectedHeadSha, baseRef});
  return {...base, decision: v.ok ? "MERGED_VERIFIED" : "VERIFY_FAILED", mergeSha: m.sha, authority: result.authority, reasons: v.reasons};
}

/** The merge commit's parents must be exactly [base, head], and the base ref must now be that commit or contain it. */
export function verifyMerge({api, mergeSha, baseSha, headSha, baseRef}) {
  const reasons = [];
  let parents = [];
  try { parents = (api(`commits/${mergeSha}`).parents ?? []).map(p => p.sha); } catch { reasons.push("MERGE_COMMIT_UNREADABLE"); }
  if (parents.length !== 2 || parents[0] !== baseSha || parents[1] !== headSha) reasons.push("MERGE_PARENTS_MISMATCH");
  try {
    const tip = api(`branches/${encodeURIComponent(baseRef)}`).commit.sha;
    if (tip !== mergeSha) {
      const cmp = api(`compare/${mergeSha}...${tip}`);
      if (cmp.status !== "ahead" && cmp.status !== "identical") reasons.push("BASE_DOES_NOT_CONTAIN_MERGE");
    }
  } catch { reasons.push("BASE_UNREADABLE"); }
  return {ok: reasons.length === 0, reasons};
}

/** Post-merge main verification: the push runs of MAIN_WORKFLOWS on the merge commit. Missing or unfinished => MAIN_RUNNING; any failure => MAIN_FAIL. */
export function verifyMain({api, sha, baseRef = "v7/integration"}) {
  if (!SHA_RE.test(sha ?? "")) return {decision: "INTERNAL_ERROR", reasons: ["SHA_MALFORMED"]};
  // NB-2/NB-3 of review 5758193752: only push runs on the base branch for this SHA count; the list API returns each run's latest attempt, so the newest run id wins.
  const runs = (api(`actions/runs?head_sha=${sha}&event=push&branch=${encodeURIComponent(baseRef)}&per_page=100`).workflow_runs ?? [])
    .filter(r => r.head_sha === sha && r.event === "push" && r.head_branch === baseRef);
  const out = {};
  for (const wf of MAIN_WORKFLOWS) {
    const latest = runs.filter(r => r.path === wf).sort((a, b) => b.id - a.id)[0];
    out[wf] = !latest ? "MISSING" : latest.status !== "completed" ? "RUNNING" : latest.conclusion === "success" ? "PASS" : "FAIL";
  }
  const vals = Object.values(out);
  const decision = vals.includes("FAIL") ? "MAIN_FAIL" : vals.every(v => v === "PASS") ? "MAIN_PASS" : "MAIN_RUNNING";
  return {decision, sha, workflows: out};
}

const args = (argv, k) => argv.flatMap((a, i) => (a === k && i + 1 < argv.length ? [argv[i + 1]] : []));

export function runCli(argv) {
  const api = curlApi(REPO);
  if (argv[0] === "merge" && args(argv, "--pr").length === 1 && /^[1-9]\d{0,9}$/.test(args(argv, "--pr")[0])) {
    const intent = args(argv, "--v2-intent");
    if (intent.length > 1) return {exit: EXIT.INTERNAL_ERROR, res: {decision: "INTERNAL_ERROR", reasons: ["ARG_INVALID"]}};
    const r = executeMerge({api, write: curlWrite(REPO), pr: Number(args(argv, "--pr")[0]), implementerSessions: args(argv, "--implementer-session"),
      v2Intent: intent.length ? JSON.parse(fs.readFileSync(intent[0], "utf8")) : null});
    return {exit: EXIT[r.decision] ?? EXIT.INTERNAL_ERROR, res: r};
  }
  if (argv[0] === "verify-main" && args(argv, "--sha").length === 1) {
    const r = verifyMain({api, sha: args(argv, "--sha")[0]});
    return {exit: EXIT[r.decision] ?? EXIT.INTERNAL_ERROR, res: r};
  }
  return {exit: EXIT.INTERNAL_ERROR, res: {decision: "INTERNAL_ERROR", reasons: ["ARG_INVALID"]}};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = runCli(process.argv.slice(2)); } catch { r = {exit: EXIT.INTERNAL_ERROR, res: {decision: "INTERNAL_ERROR", reasons: ["INTERNAL_ERROR"]}}; }
  process.stdout.write(JSON.stringify(r.res) + "\n");
  process.exit(r.exit);
}
