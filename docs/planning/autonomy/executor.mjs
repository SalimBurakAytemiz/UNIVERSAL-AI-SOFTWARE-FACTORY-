// //TR: Bu yürütücü FD-2026-11-03 kalıcı otonomi kararını gerçekten uygular: autonomy.mjs AUTO_MERGE derse PR'ı GitHub üzerinden beklenen head SHA ile merge eder, merge commit'inin ebeveynlerini (base, head) ve yeni base'i doğrular, ana dal CI'ını raporlar; AUTO_MERGE dışındaki her kararda hiçbir şey yazmaz. Çıktılar yalnız sabit kodlar ve doğrulanmış SHA'lardır.
// Usage:
//   node docs/planning/autonomy/executor.mjs merge --pr <n> --implementer-session <id> [...]   (decide + merge + verify)
//   node docs/planning/autonomy/executor.mjs verify-main --sha <merge sha>                     (post-merge push CI on the base)
// Exit: 0 MERGED_VERIFIED / MAIN_PASS, 2 BLOCK / MAIN_FAIL, 4 FOUNDER_REQUIRED, 5 MERGE_FAILED / VERIFY_FAILED / MAIN_RUNNING, 3 INTERNAL_ERROR.
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {collectEvidence, decideFor, curlApi} from "./autonomy.mjs";

export const EXIT = {MERGED_VERIFIED: 0, MAIN_PASS: 0, BLOCK: 2, INTERNAL_ERROR: 3, FOUNDER_REQUIRED: 4, MERGE_FAILED: 5, VERIFY_FAILED: 5, MAIN_RUNNING: 5, MAIN_FAIL: 2};
const SHA_RE = /^[0-9a-f]{40}$/;
// The base workflows whose push runs must pass on the merge commit (the required CI and the Windows installer build).
export const MAIN_WORKFLOWS = Object.freeze([".github/workflows/ci.yml", ".github/workflows/windows-installer.yml"]);
const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-";

/** Write access through curl (the environment's proxy authenticates). Only PUT pulls/<n>/merge is ever used. */
export const curlWrite = repo => (method, p, body) => JSON.parse(execFileSync("curl", ["-sS", "-X", method, "-H", "Content-Type: application/json",
  "-H", "Accept: application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? ["-H", `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : []),
  `https://api.github.com/repos/${repo}/${p}`, "-d", JSON.stringify(body)], {maxBuffer: 16 << 20}).toString("utf8"));

/**
 * Decide, and only on AUTO_MERGE merge with expectedHeadSha, then verify the merge commit's parents are exactly (base, head).
 * Nothing is written for any other decision. A merge that GitHub refuses, or a merge commit that does not verify, is reported, never retried.
 */
export function executeMerge({api, write, pr, implementerSessions, decide = decideFor, collect = collectEvidence}) {
  const c = collect({api, pr, implementerSessions});
  const {gate, result} = decide(c);
  const base = {pr, task: result.task, expectedHeadSha: result.expectedHeadSha, expectedBaseSha: result.expectedBaseSha, reasons: result.reasons,
    gate: {decision: gate.decision, trust: gate.trust, identityIndependence: gate.identityIndependence}};
  if (result.decision !== "AUTO_MERGE") return {...base, decision: result.decision};
  if (!SHA_RE.test(result.expectedHeadSha ?? "") || !SHA_RE.test(result.expectedBaseSha ?? "")) return {...base, decision: "INTERNAL_ERROR", reasons: ["SHA_MALFORMED"]};
  let m;
  try { m = write("PUT", `pulls/${pr}/merge`, {sha: result.expectedHeadSha, merge_method: c.policy?.mergeMethod ?? "merge"}); } catch { return {...base, decision: "MERGE_FAILED", reasons: ["MERGE_REQUEST_FAILED"]}; }
  if (!m || m.merged !== true || !SHA_RE.test(m.sha ?? "")) return {...base, decision: "MERGE_FAILED", reasons: ["MERGE_REFUSED"]};
  const v = verifyMerge({api, mergeSha: m.sha, baseSha: result.expectedBaseSha, headSha: result.expectedHeadSha, baseRef: c.evidence.pr.base.ref});
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
export function verifyMain({api, sha}) {
  if (!SHA_RE.test(sha ?? "")) return {decision: "INTERNAL_ERROR", reasons: ["SHA_MALFORMED"]};
  const runs = (api(`actions/runs?head_sha=${sha}&event=push&per_page=100`).workflow_runs ?? []).filter(r => r.head_sha === sha);
  const out = {};
  for (const wf of MAIN_WORKFLOWS) {
    const latest = runs.filter(r => r.path === wf).sort((a, b) => (b.run_attempt ?? 0) - (a.run_attempt ?? 0) || b.id - a.id)[0];
    out[wf] = !latest ? "MISSING" : latest.status !== "completed" ? "RUNNING" : latest.conclusion === "success" ? "PASS" : "FAIL";
  }
  const vals = Object.values(out);
  const decision = vals.includes("FAIL") ? "MAIN_FAIL" : vals.every(v => v === "PASS") ? "MAIN_PASS" : "MAIN_RUNNING";
  return {decision, sha, workflows: out};
}

const args = (argv, k) => argv.flatMap((a, i) => (a === k && i + 1 < argv.length ? [argv[i + 1]] : []));

export function runCli(argv) {
  const api = curlApi(REPO);
  if (argv[0] === "merge" && args(argv, "--pr").length === 1) {
    const r = executeMerge({api, write: curlWrite(REPO), pr: Number(args(argv, "--pr")[0]), implementerSessions: args(argv, "--implementer-session")});
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
