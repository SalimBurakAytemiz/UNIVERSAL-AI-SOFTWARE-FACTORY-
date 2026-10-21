// //TR: Bu betik UASCO Independent Review workflow'unun aşama yürütücüsüdür (scope, collect, decide, finish, approve): yalnız varsayılan daldaki (v7/integration) güvenilir koddan çalışır, PR kodunu asla checkout etmez veya çalıştırmaz, kanıtı ve kararı SHA'ya bağlı dosyalara yazar ve her hata yolunda kontrolü failure olarak kapatır.
// Usage: node scripts/ci/uasco-review/run.mjs <scope|collect|verdict|decide|finish|approve>   (inputs come from env, never from argv text)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {client, collectEvidence, waitForCi, prDiff, diffPaths, sameChange, commitTree, priorNegativeVerdicts, currentHead, runApprovals, createCheck, getCheck, concludeCheck, approve} from "./github.mjs";
import {CHECK_NAME, preGate, decide, negativeVerdict, verdictIsNegative, carriesSecret, renderSummary, canonical, sha256} from "./review-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
// Not a dot-directory: the reviewer's Read deny rule for hidden paths under /home (which also hides .git/config) would otherwise hide its own inputs.
const OUT = path.resolve(process.env.UASCO_REVIEW_DIR || path.join(ROOT, "uasco-review"));
const env = k => { const v = process.env[k]; return typeof v === "string" && v !== "" ? v : null; };
// Canonical decimal only ("12", never "012" or "12.0"): the workflow's concurrency group uses the raw text, so a spelling variant must not escape cancel-in-progress.
const prNumber = () => { const raw = env("PR_NUMBER"); if (!/^[1-9][0-9]{0,9}$/.test(String(raw))) throw new Error("PR_NUMBER_INVALID"); return Number(raw); };
const SHA_RE = /^[0-9a-f]{40}$/;
// GitHub step outputs; values are fixed codes, numbers, SHAs or booleans only.
const output = (k, v) => { const f = env("GITHUB_OUTPUT"); const line = `${k}=${String(v).replace(/[\r\n]/g, " ")}\n`; if (f) fs.appendFileSync(f, line); else process.stdout.write(line); };
const writeJson = (name, v) => { fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(path.join(OUT, name), JSON.stringify(v, null, 1) + "\n"); };
const readJson = name => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
// GITHUB_API_URL is set by Actions (https://api.github.com); the proof points it at a local mock server.
const apiUrl = () => env("GITHUB_API_URL") ?? "https://api.github.com";
// Short jobs (scope, decide, finish: 10 min) cap a rate-limit wait at 2 min, so a wait can never outlast the job and leave the check in progress.
const SHORT_WAIT = 2 * 60_000;
const readGh = (maxWaitMs = SHORT_WAIT) => client({token: env("GH_READ_TOKEN"), repo: env("GITHUB_REPOSITORY"), apiUrl: apiUrl(), maxWaitMs});
const appGh = () => { const t = env("REVIEW_APP_TOKEN"); if (!t) throw new Error("REVIEW_APP_TOKEN_MISSING"); return client({token: t, repo: env("GITHUB_REPOSITORY"), apiUrl: apiUrl(), maxWaitMs: SHORT_WAIT}); };
const protectedPaths = () => JSON.parse(fs.readFileSync(path.join(ROOT, "config/protected-paths.json"), "utf8"));

// Did this App already reject this head, or another commit of the PR with the same tree? (Re-review then needs Founder authority.)
async function priorNegative(gh, ev, headSha, tree) {
  const prior = await priorNegativeVerdicts(gh, {appSlug: env("APP_SLUG"), shas: [...(ev.commitShas ?? []), headSha]});
  return prior.some(p => p.sha === headSha || (tree !== null && p.tree === tree));
}

// 1. scope: create the in-progress check on the exact head SHA and say whether Founder authority is needed (protected/CI-executed paths, or a re-review
// after a negative verdict on the same content).
async function scope() {
  const gh = readGh(), n = prNumber();
  const ev = await collectEvidence(gh, n, {protectedPaths: protectedPaths(), checkRuns: []});
  const headSha = ev.pr.head.sha;
  if (!SHA_RE.test(String(headSha))) throw new Error("HEAD_SHA_INVALID");
  const pre = preGate(ev);
  const again = await priorNegative(gh, ev, headSha, await commitTree(gh, headSha));
  const check = await createCheck(appGh(), {headSha, title: "Waiting for CI and review", summary: `Review of \`${headSha}\` started. CI must finish on this exact commit first.`, detailsUrl: env("RUN_URL")});
  output("head_sha", headSha);
  output("check_id", check.id);
  output("needs_founder", pre.authority.length > 0 || again);
}

// 2. collect: wait for CI on the head, gather evidence, run the deterministic pre-gate. Only a green, complete PR goes to the reviewer.
async function collect() {
  const gh = readGh(15 * 60_000), n = prNumber(), headSha = env("HEAD_SHA");
  if (!SHA_RE.test(String(headSha))) throw new Error("HEAD_SHA_INVALID");
  const ci = await waitForCi(gh, headSha, {prNumber: n, timeoutMs: Number(env("CI_WAIT_MINUTES") ?? 100) * 60_000});
  const ev = await collectEvidence(gh, n, {protectedPaths: protectedPaths(), checkRuns: ci.checkRuns});
  ev.headTree = await commitTree(gh, headSha);
  ev.priorNegativeVerdict = await priorNegative(gh, ev, headSha, ev.headTree);
  writeJson("evidence.json", ev);
  output("base_sha", SHA_RE.test(String(ev.currentBaseSha)) ? ev.currentBaseSha : "");
  const pre = preGate(ev);
  const blockers = [...pre.blockers, ...(ci.state === "TIMEOUT" ? ["CI_WAIT_TIMEOUT"] : []), ...(ci.state === "MERGE_CONFLICT" ? ["PR_MERGE_CONFLICT"] : []),
    ...(ev.pr.head.sha !== headSha ? ["STALE_HEAD"] : []),
    // The commit list feeds the implementer-session and prior-verdict checks: it must be complete and end at the reviewed head (GitHub lists at most 250).
    ...(ev.commitShas.length === 0 || ev.commitShas.at(-1) !== headSha || Number(ev.pr.commits) !== ev.commitShas.length ? ["COMMITS_UNVERIFIED"] : [])];
  // GitHub's diff endpoints stop at 300 files; a PR that large must be split, it is never reviewed from a partial diff.
  if (!blockers.length && (ev.diffFiles.length > 300 || Number(ev.pr.changed_files) > 300)) blockers.push("DIFF_TOO_LARGE_FOR_REVIEW");
  if (blockers.length) { output("proceed", false); writeJson("precheck.json", {blockers}); return; }
  let diff;
  try { diff = await prDiff(gh, ev.currentBaseSha, headSha); } catch { output("proceed", false); writeJson("precheck.json", {blockers: ["DIFF_UNAVAILABLE"]}); return; }
  // The SHA-bound diff and the file list used for the protected-path decision must describe the same change, old names included; otherwise the PR base was
  // moved mid-run (or the diff cannot be read), and nothing is reviewed.
  if (!diff.truncated && !sameChange(diffPaths(diff.text), ev.diffFiles)) {
    output("proceed", false); writeJson("precheck.json", {blockers: ["DIFF_FILES_MISMATCH"]}); return;
  }
  const input = path.join(OUT, "review-input");
  fs.mkdirSync(input, {recursive: true});
  fs.writeFileSync(path.join(input, "pr.diff"), diff.text);
  const ciLines = ev.checkRuns.map(c => `- ${c.name}: ${c.status}/${c.conclusion} on ${c.head_sha} (${c.workflowPath}, ${c.workflowRunEvent})`);
  fs.writeFileSync(path.join(input, "context.md"), [`# Review input for PR #${n}`, "", `- head: ${headSha}`, `- base: ${ev.currentBaseSha}`, `- changed files: ${ev.diffFiles.length}`,
    `- diff truncated: ${diff.truncated}`, `- protected or CI-executed paths: ${pre.authority.length ? pre.authority.join(", ") : "none"}`, "", "## CI on this exact head", ...ciLines, "",
    "## Changed files", ...ev.diffFiles.map(f => `- ${f.status}: ${f.filename}${f.previous_filename ? ` (from ${f.previous_filename})` : ""}`), ""].join("\n"));
  const prompt = fs.readFileSync(path.join(HERE, "REVIEWER-PROMPT.md"), "utf8").replaceAll("{{HEAD_SHA}}", headSha).replaceAll("{{BASE_SHA}}", String(ev.currentBaseSha))
    .replaceAll("{{INPUT_DIR}}", path.relative(ROOT, input));
  fs.writeFileSync(path.join(input, "INSTRUCTIONS.md"), prompt);
  output("proceed", !diff.truncated);
  if (diff.truncated) writeJson("precheck.json", {blockers: ["DIFF_TOO_LARGE_FOR_REVIEW"]});
  output("schema", reviewerSchema());
  output("model_arg", modelArg(env("REVIEW_MODEL")));
}

// An optional model alias from a repository variable. Anything outside a plain alias is dropped, so a variable can never add CLI flags.
export const modelArg = m => typeof m === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(m) ? `--model ${m}` : "";

// The schema travels inside a single-quoted CLI argument: one line, no "$comment", and never a quote character that could end the argument.
export function reviewerSchema() {
  const {$comment, ...schema} = JSON.parse(fs.readFileSync(path.join(HERE, "verdict.schema.json"), "utf8"));
  const s = JSON.stringify(schema);
  if (/['\r\n]/.test(s)) throw new Error("SCHEMA_NOT_ARGUMENT_SAFE");
  return s;
}

// ai-review: write the reviewer's structured output for upload. A credential-shaped verdict (raw text or parsed value, so JSON \u escapes cannot hide one)
// is replaced before the first upload and is never published; the gate rejects the placeholder as malformed.
async function verdictStep() {
  const raw = env("VERDICT_JSON") ?? "";
  let parsed = raw;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  const dir = path.resolve(env("UASCO_VERDICT_DIR") ?? path.join(ROOT, "uasco-verdict"));
  fs.mkdirSync(dir, {recursive: true});
  // The placeholder keeps whether the replaced verdict was negative, so rejecting its text never erases a rejection.
  fs.writeFileSync(path.join(dir, "verdict.json"), carriesSecret(parsed) || carriesSecret(raw) ? JSON.stringify({rejected: "VERDICT_CONTAINS_SECRET_PATTERN", negative: verdictIsNegative(parsed)}) : raw);
}

// 3. decide: re-read the head (staleness), the Founder approvals of THIS run, and gate the verdict.
async function decideStep() {
  const gh = readGh(), n = prNumber();
  // The verdict arrives as a file from the separate ai-review job (artifact), never through this job's environment.
  let verdict = null, raw = null;
  try { raw = fs.readFileSync(path.join(OUT, "verdict.json"), "utf8"); } catch { raw = null; }
  if (raw !== null && raw.trim() !== "") { try { verdict = JSON.parse(raw); } catch { verdict = {malformed: true}; } }
  let evidence, pre = null;
  try { evidence = readJson("evidence.json"); } catch { evidence = null; }
  try { pre = readJson("precheck.json"); } catch { pre = null; }
  // The App's own records are read again now: a partial re-run reuses an earlier attempt's evidence file, which cannot know that attempt's own verdict.
  // A failed lookup leaves the value unknown (fail-closed in decide).
  if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    const live = await priorNegative(gh, evidence, evidence.pr?.head?.sha, SHA_RE.test(String(evidence.headTree)) ? evidence.headTree : null).catch(() => null);
    evidence.priorNegativeVerdict = live === null ? null : evidence.priorNegativeVerdict === true || live;
  }
  const runId = env("GITHUB_RUN_ID");
  const approvals = (env("NEEDS_FOUNDER") === "true" || evidence?.priorNegativeVerdict === true) && runId ? await runApprovals(gh, runId).catch(() => []) : [];
  const d = decide({evidence, verdict, currentHeadSha: await currentHead(gh, n), approvals, policy: {founderLogin: env("FOUNDER_LOGIN"), reviewerSession: env("REVIEWER_SESSION")}});
  // Pre-check blockers (CI timeout, oversized diff) are folded in so a skipped review can never read as success.
  if (pre && Array.isArray(pre.blockers) && pre.blockers.length) { d.reasons = [...new Set([...pre.blockers, ...d.reasons])]; d.conclusion = "failure"; const {digest, ...rec} = d; d.digest = sha256(canonical(rec)); }
  writeJson("decision.json", d);
  output("conclusion", d.conclusion);
}

// 4. finish (always runs): conclude the check from decision.json; anything missing or unreadable concludes failure.
async function finishStep() {
  const gh = appGh(), id = Number(env("CHECK_ID"));
  if (!Number.isSafeInteger(id)) throw new Error("CHECK_ID_INVALID");
  // Write-once: a check this App already concluded is never rewritten. A partial re-run (ai-review, collect or finish alone) therefore cannot flip a failure
  // or erase its v2:1 record; reviewing again needs a full re-run or a new event, which creates a new check that sees the record.
  const cur = await getCheck(gh, id);
  if (cur?.head_sha !== env("HEAD_SHA")) { output("final", "failure"); throw new Error("CHECK_HEAD_MISMATCH"); }
  if (cur?.status === "completed") { output("final", "failure"); throw new Error("CHECK_ALREADY_CONCLUDED"); }
  let d;
  try { d = readJson("decision.json"); } catch { d = null; }
  const ok = d && d.conclusion === "success" && Array.isArray(d.reasons) && d.reasons.length === 0 && d.headSha === env("HEAD_SHA");
  let decision = d;
  if (!decision) {
    // No decision: the verdict file still decides whether this run recorded a rejection (a lost decision must never lower the record).
    let v = null, ev = null;
    try { v = JSON.parse(fs.readFileSync(path.join(OUT, "verdict.json"), "utf8")); } catch { v = null; }
    try { ev = readJson("evidence.json"); } catch { ev = null; }
    decision = {conclusion: "failure", reasons: ["DECISION_MISSING", ...(verdictIsNegative(v) ? ["DECISION_MISSING_NEGATIVE_VERDICT"] : [])], headSha: env("HEAD_SHA"), baseSha: null,
      headTree: SHA_RE.test(String(ev?.headTree)) ? ev.headTree : null, verdict: null, digest: "none"};
  }
  if (!ok && decision.conclusion === "success") decision.reasons = ["DECISION_INCONSISTENT"];
  // external_id is written only by this App: "v2:<1 = substantive negative verdict>:<head tree>:<digest prefix>", read back by later runs (priorNegativeVerdicts).
  const tree = SHA_RE.test(String(decision.headTree)) ? decision.headTree : "0".repeat(40), dig = /^[0-9a-f]{64}$/.test(String(decision.digest)) ? decision.digest.slice(0, 16) : "none";
  await concludeCheck(gh, id, {conclusion: ok ? "success" : "failure", title: ok ? "Independent review passed" : "Independent review did not pass",
    summary: renderSummary({...decision, conclusion: ok ? "success" : "failure"}, env("RUN_URL")), externalId: `v2:${!ok && negativeVerdict(decision) ? 1 : 0}:${tree}:${dig}`});
  output("final", ok ? "success" : "failure");
}

// 5. approve (optional; its own App token with pull_requests:write): an APPROVE review pinned to the reviewed commit, only for a passed
// decision whose head is still the PR head. It satisfies require_last_push_approval without a human; the next push dismisses it.
async function approveStep() {
  if (env("SUBMIT_APPROVAL") !== "true") { output("approved", false); return; }
  let d = null;
  try { d = readJson("decision.json"); } catch { d = null; }
  const ok = d && d.conclusion === "success" && Array.isArray(d.reasons) && d.reasons.length === 0 && SHA_RE.test(String(d.headSha)) && d.headSha === env("HEAD_SHA");
  if (!ok) { output("approved", false); return; }
  const gh = appGh(), n = prNumber();
  if (await currentHead(gh, n) !== d.headSha) { output("approved", false); return; }
  await approve(gh, n, d.headSha, `UASCO Independent Review passed for ${d.headSha}. Evidence digest ${d.digest}.`);
  output("approved", true);
}

export const phases = {scope, collect, verdict: verdictStep, decide: decideStep, finish: finishStep, approve: approveStep};
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const phase = process.argv[2];
  if (!Object.hasOwn(phases, phase)) { console.error("USAGE: run.mjs <scope|collect|verdict|decide|finish|approve>"); process.exit(2); }
  phases[phase]().catch(e => { console.error(`${CHECK_NAME}: ${phase} failed: ${String(e?.code ?? e?.message ?? "ERROR").slice(0, 80)}`); process.exit(1); });
}
