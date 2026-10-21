// //TR: Bu betik UASCO Independent Review workflow'unun aşama yürütücüsüdür (scope, collect, decide, finish): yalnız base dalındaki güvenilir koddan çalışır, PR kodunu asla checkout etmez veya çalıştırmaz, kanıtı ve kararı SHA'ya bağlı dosyalara yazar ve her hata yolunda kontrolü failure olarak kapatır.
// Usage: node scripts/ci/uasco-review/run.mjs <scope|collect|decide|finish>   (inputs come from env, never from argv text)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {client, collectEvidence, waitForCi, prDiff, currentHead, runApprovals, createCheck, concludeCheck, approve} from "./github.mjs";
import {CHECK_NAME, preGate, decide, renderSummary, canonical, sha256} from "./review-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT = path.resolve(process.env.UASCO_REVIEW_DIR || path.join(ROOT, ".uasco-review"));
const env = k => { const v = process.env[k]; return typeof v === "string" && v !== "" ? v : null; };
const prNumber = () => { const n = Number(env("PR_NUMBER")); if (!Number.isSafeInteger(n) || n < 1) throw new Error("PR_NUMBER_INVALID"); return n; };
const SHA_RE = /^[0-9a-f]{40}$/;
// GitHub step outputs; values are fixed codes, numbers, SHAs or booleans only.
const output = (k, v) => { const f = env("GITHUB_OUTPUT"); const line = `${k}=${String(v).replace(/[\r\n]/g, " ")}\n`; if (f) fs.appendFileSync(f, line); else process.stdout.write(line); };
const writeJson = (name, v) => { fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(path.join(OUT, name), JSON.stringify(v, null, 1) + "\n"); };
const readJson = name => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
// GITHUB_API_URL is set by Actions (https://api.github.com); the proof points it at a local mock server.
const apiUrl = () => env("GITHUB_API_URL") ?? "https://api.github.com";
const readGh = () => client({token: env("GH_READ_TOKEN"), repo: env("GITHUB_REPOSITORY"), apiUrl: apiUrl()});
const appGh = () => { const t = env("REVIEW_APP_TOKEN"); if (!t) throw new Error("REVIEW_APP_TOKEN_MISSING"); return client({token: t, repo: env("GITHUB_REPOSITORY"), apiUrl: apiUrl()}); };
const protectedPaths = () => JSON.parse(fs.readFileSync(path.join(ROOT, "config/protected-paths.json"), "utf8"));

// 1. scope: create the in-progress check on the exact head SHA and say whether Founder authority (protected/CI-executed paths) is needed.
async function scope() {
  const gh = readGh(), n = prNumber();
  const ev = await collectEvidence(gh, n, {protectedPaths: protectedPaths(), checkRuns: []});
  const headSha = ev.pr.head.sha;
  if (!SHA_RE.test(String(headSha))) throw new Error("HEAD_SHA_INVALID");
  const pre = preGate(ev);
  const check = await createCheck(appGh(), {headSha, title: "Waiting for CI and review", summary: `Review of \`${headSha}\` started. CI must finish on this exact commit first.`, detailsUrl: env("RUN_URL")});
  output("head_sha", headSha);
  output("check_id", check.id);
  output("needs_founder", pre.authority.length > 0);
}

// 2. collect: wait for CI on the head, gather evidence, run the deterministic pre-gate. Only a green, complete PR goes to the reviewer.
async function collect() {
  const gh = readGh(), n = prNumber(), headSha = env("HEAD_SHA");
  if (!SHA_RE.test(String(headSha))) throw new Error("HEAD_SHA_INVALID");
  const ci = await waitForCi(gh, headSha, {timeoutMs: Number(env("CI_WAIT_MINUTES") ?? 100) * 60_000});
  const ev = await collectEvidence(gh, n, {protectedPaths: protectedPaths(), checkRuns: ci.checkRuns});
  writeJson("evidence.json", ev);
  const pre = preGate(ev);
  const blockers = [...pre.blockers, ...(ci.state === "TIMEOUT" ? ["CI_WAIT_TIMEOUT"] : []), ...(ev.pr.head.sha !== headSha ? ["STALE_HEAD"] : [])];
  if (blockers.length) { output("proceed", false); writeJson("precheck.json", {blockers}); return; }
  const diff = await prDiff(gh, n);
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
  const runId = env("GITHUB_RUN_ID");
  const approvals = env("NEEDS_FOUNDER") === "true" && runId ? await runApprovals(gh, runId).catch(() => []) : [];
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
  let d;
  try { d = readJson("decision.json"); } catch { d = null; }
  const ok = d && d.conclusion === "success" && Array.isArray(d.reasons) && d.reasons.length === 0 && d.headSha === env("HEAD_SHA");
  const decision = d ?? {conclusion: "failure", reasons: ["DECISION_MISSING"], headSha: env("HEAD_SHA"), baseSha: null, verdict: null, digest: "none"};
  if (!ok && decision.conclusion === "success") decision.reasons = ["DECISION_INCONSISTENT"];
  await concludeCheck(gh, id, {conclusion: ok ? "success" : "failure", title: ok ? "Independent review passed" : "Independent review did not pass",
    summary: renderSummary({...decision, conclusion: ok ? "success" : "failure"}, env("RUN_URL")), externalId: typeof decision.digest === "string" ? decision.digest.slice(0, 64) : undefined});
  if (ok && env("SUBMIT_APPROVAL") === "true") await approve(gh, prNumber(), d.headSha, `UASCO Independent Review passed for ${d.headSha}. Evidence digest ${d.digest}.`);
  output("final", ok ? "success" : "failure");
}

export const phases = {scope, collect, decide: decideStep, finish: finishStep};
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const phase = process.argv[2];
  if (!Object.hasOwn(phases, phase)) { console.error("USAGE: run.mjs <scope|collect|decide|finish>"); process.exit(2); }
  phases[phase]().catch(e => { console.error(`${CHECK_NAME}: ${phase} failed: ${String(e?.code ?? e?.message ?? "ERROR").slice(0, 80)}`); process.exit(1); });
}
