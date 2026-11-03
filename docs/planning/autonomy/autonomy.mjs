// //TR: Bu modül Founder kalıcı otonomi kararını (FD-2026-11-03-STANDING-AUTONOMY) kodla uygular: merge-gate.mjs MERGE dediğinde, PR'ın tek V4.1 görevi kapsanan kademedeyse ve D-31 dışındaki tüm kapıları sağlanmışsa AUTO_MERGE, Founder istisnasına giriyorsa FOUNDER_REQUIRED, aksi halde BLOCK der; ayrıca kalıcı STATE.json'a göre sıradaki uygun görevleri seçer. Çıktılar yalnız sabit kodlar, görev kimlikleri ve doğrulanmış SHA'lardır.
// Usage:
//   node docs/planning/autonomy/autonomy.mjs decide --pr <n>           (gathers evidence with GitHub REST through curl, runs merge-gate + policy)
//   node docs/planning/autonomy/autonomy.mjs decide --evidence <file> --body <file>
//   node docs/planning/autonomy/autonomy.mjs next [--limit n]
// Exit: 0 AUTO_MERGE (decide) or OK (next), 2 BLOCK, 4 FOUNDER_REQUIRED, 3 INTERNAL_ERROR.
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {evaluateMergeGate} from "../merge-gate.mjs";

export const EXIT = {AUTO_MERGE: 0, BLOCK: 2, INTERNAL_ERROR: 3, FOUNDER_REQUIRED: 4};
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASK_LINE_RE = /^UASCO-TASK: ([A-Z0-9]+-T\d{4}(?:\.[a-z0-9]+)?)\s*$/;
// Matrix statuses that count as delivered for dependency purposes, and statuses that are never picked as new work.
export const DONE_STATUSES = Object.freeze(["ASSET_DONE", "DONE_OBSERVED"]);
export const NOT_PICKABLE = Object.freeze(["ASSET_DONE", "DONE_OBSERVED", "SPLIT", "BLOCKED", "DEFERRED", "UNVERIFIABLE", "VERIFY_PENDING"]);

export const loadJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
export const loadPolicy = () => loadJson(path.join(HERE, "standing-authority.json"));
export const loadIndex = () => loadJson(path.join(HERE, "task-index.json"));
export const loadState = () => loadJson(path.join(HERE, "STATE.json"));

/** The single task a PR declares. Zero or several lines => null (fail-closed). */
export function taskOf(body) {
  if (typeof body !== "string") return null;
  const ids = body.split(/\r?\n/).map(l => TASK_LINE_RE.exec(l)).filter(Boolean).map(m => m[1]);
  return ids.length === 1 ? ids[0] : null;
}

/** Gates of a task that the standing authority does not satisfy, each with its reason code. */
export function openGates(task, policy) {
  const sat = new Set([...Object.keys(policy.satisfiedGates ?? {}), ...(policy.standingGates ?? [])]);
  const out = [];
  for (const g of new Set([...(task.startGates ?? []), ...(task.mergeGates ?? [])])) {
    if (!sat.has(g)) out.push(`${policy.founderOnlyGateReasons?.[g] ?? "GATE_UNDECIDED"}:${g}`);
  }
  return out;
}

/** Pure decision: merge-gate result + PR body + policy + task index => AUTO_MERGE | FOUNDER_REQUIRED | BLOCK. */
export function decideAutoMerge({gate, body, policy, index}) {
  const reasons = [];
  const tid = taskOf(body);
  const task = tid ? index.tasks.find(t => t.id === tid) : undefined;
  if (!tid) reasons.push("TASK_ID_MISSING_OR_AMBIGUOUS");
  else if (!task) reasons.push("TASK_UNKNOWN");
  const founder = [];
  if (task) {
    if (!policy.coveredTiers.includes(task.tier)) founder.push(`TIER_NOT_COVERED:${task.tier}`);
    founder.push(...openGates(task, policy));
  }
  const gr = Array.isArray(gate?.reasons) ? gate.reasons : ["GATE_RESULT_MALFORMED"];
  if (gate?.decision !== "MERGE") {
    for (const r of gr) {
      if ((policy.founderRequiredGateReasons ?? []).some(p => r === p || r.startsWith(`${p}:`))) founder.push(`PROTECTED_GOVERNANCE:${r}`);
      else reasons.push(`GATE:${r}`);
    }
    if (gr.length === 0) reasons.push("GATE_NOT_MERGE");
  }
  const decision = reasons.length ? "BLOCK" : founder.length ? "FOUNDER_REQUIRED" : "AUTO_MERGE";
  return {decision, task: task ? task.id : null, expectedHeadSha: gate?.expectedHeadSha ?? null, expectedBaseSha: gate?.expectedBaseSha ?? null,
    reasons: [...new Set([...reasons, ...founder])], authority: decision === "AUTO_MERGE" ? policy.decisionId : null};
}

/** Next pickable tasks: not done, not in flight, every dependency done, tier covered, no open gate. Blocked tasks never stop unrelated ones. */
export function nextTasks({index, state, policy, limit = 5}) {
  const done = new Set([...(state.done ?? []).map(x => typeof x === "string" ? x : x.task), ...index.tasks.filter(t => DONE_STATUSES.includes(t.status)).map(t => t.id)]);
  const busy = new Set([...(state.inFlight ?? []).map(x => x.task), ...(state.blocked ?? []).map(x => x.task)]);
  const ready = [], held = [];
  for (const t of index.tasks) {
    if (done.has(t.id) || busy.has(t.id) || NOT_PICKABLE.includes(t.status) || t.exec === "LOCAL") continue;
    const missing = t.deps.map(d => (Array.isArray(d) ? d[0] : d)).filter(d => !done.has(d));
    const why = [...(policy.coveredTiers.includes(t.tier) ? [] : [`TIER_NOT_COVERED:${t.tier}`]), ...openGates(t, policy)];
    if (missing.length) continue;
    (why.length ? held : ready).push(why.length ? {task: t.id, reasons: why} : {task: t.id, tier: t.tier});
  }
  // Earliest wave first (matrix order inside a wave), so the critical path is not starved by later work.
  const waveOf = id => index.tasks.find(t => t.id === id)?.wave ?? "W~";
  ready.sort((a, b) => waveOf(a.task).localeCompare(waveOf(b.task), "en", {numeric: true}));
  return {ready: ready.slice(0, limit), founderHeld: held.length, readyTotal: ready.length};
}

// ---- evidence collection (GitHub REST through curl, which honours the environment's proxy) ----
const api = (repo, p) => JSON.parse(execFileSync("curl", ["-sSf", "-H", "Accept: application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? ["-H", `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : []), `https://api.github.com/repos/${repo}/${p}`],
{maxBuffer: 64 << 20}).toString("utf8"));
const pages = (repo, p, key) => { const all = []; for (let n = 1; n <= 30; n++) { const j = api(repo, `${p}${p.includes("?") ? "&" : "?"}per_page=100&page=${n}`); const arr = key ? j[key] : j; all.push(...arr); if (arr.length < 100) break; } return all; };

export function collectEvidence(repo, pr) {
  const p = api(repo, `pulls/${pr}`);
  const head = p.head.sha;
  const runs = pages(repo, `actions/runs?head_sha=${head}`, "workflow_runs");
  const suite = new Map(runs.map(r => [r.check_suite_id, r]));
  const checkRuns = pages(repo, `commits/${head}/check-runs`, "check_runs").map(c => ({
    name: c.name, status: c.status, conclusion: c.conclusion, head_sha: c.head_sha, app_slug: c.app?.slug ?? null, completed_at: c.completed_at,
    workflowPath: suite.get(c.check_suite?.id)?.path ?? null, workflowRunEvent: suite.get(c.check_suite?.id)?.event ?? null,
  }));
  const reviews = pages(repo, `pulls/${pr}/reviews`).map(r => ({id: r.id, user: r.user ? {login: r.user.login} : null, state: r.state, commit_id: r.commit_id, body: r.body, submitted_at: r.submitted_at}));
  const diffFiles = pages(repo, `pulls/${pr}/files`).map(f => ({filename: f.filename, ...(f.previous_filename ? {previous_filename: f.previous_filename} : {}), status: f.status}));
  const base = api(repo, `branches/${encodeURIComponent(p.base.ref)}`).commit.sha;
  const pp = loadJson(path.join(HERE, "..", "..", "..", "config", "protected-paths.json"));
  return {
    evidence: {
      pr: {number: p.number, state: p.state, draft: p.draft, merged: p.merged, changed_files: p.changed_files, head: {sha: head, ref: p.head.ref}, base: {ref: p.base.ref, sha: p.base.sha}, user: {login: p.user.login}},
      currentBaseSha: base, checkRuns, reviews, diffFiles, protectedPaths: {exactPaths: pp.exactPaths, protectedPrefixes: pp.protectedPrefixes}, rules: api(repo, `rules/branches/${encodeURIComponent(p.base.ref)}`),
    },
    body: p.body ?? "",
  };
}

export function decideFor({evidence, body, policy = loadPolicy(), index = loadIndex()}) {
  const gate = evaluateMergeGate(evidence, {mode: policy.gateMode, trustedReviewerLogins: policy.trustedReviewerLogins, expectedBaseRef: policy.baseRef});
  return {gate, result: decideAutoMerge({gate, body, policy, index})};
}

function arg(argv, k) { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; }

export function runCli(argv) {
  const cmd = argv[0];
  if (cmd === "next") {
    const r = nextTasks({index: loadIndex(), state: loadState(), policy: loadPolicy(), limit: Number(arg(argv, "--limit") ?? 5)});
    return {exit: 0, res: r};
  }
  if (cmd === "decide") {
    let evidence, body;
    if (arg(argv, "--pr")) ({evidence, body} = collectEvidence(arg(argv, "--repo") ?? "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-", Number(arg(argv, "--pr"))));
    else { evidence = loadJson(arg(argv, "--evidence")); body = fs.readFileSync(arg(argv, "--body"), "utf8"); }
    const {gate, result} = decideFor({evidence, body});
    return {exit: EXIT[result.decision], res: {...result, gate: {decision: gate.decision, reasons: gate.reasons, trust: gate.trust, identityIndependence: gate.identityIndependence}}};
  }
  return {exit: EXIT.INTERNAL_ERROR, res: {decision: "INTERNAL_ERROR", reasons: ["ARG_INVALID"]}};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = runCli(process.argv.slice(2)); } catch { r = {exit: EXIT.INTERNAL_ERROR, res: {decision: "INTERNAL_ERROR", reasons: ["INTERNAL_ERROR"]}}; }
  process.stdout.write(JSON.stringify(r.res) + "\n");
  process.exit(r.exit);
}
