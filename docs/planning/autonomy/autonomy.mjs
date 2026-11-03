// //TR: Bu modül Founder kalıcı otonomi kararını (FD-2026-11-03-STANDING-AUTONOMY) kodla uygular: merge-gate.mjs MERGE dediğinde, PR'ın tek V4.1 görevi kapsanan kademedeyse, D-31 dışındaki tüm kapıları sağlanmışsa, yönetişim yollarına dokunmuyorsa, builder oturumu bildirilmişse ve bağımsız reviewer istisna yokluğunu onaylamışsa AUTO_MERGE, Founder istisnasına giriyorsa FOUNDER_REQUIRED, aksi halde BLOCK der; güven girdileri (politika, dizin, korumalı yollar) base'den okunur. Çıktılar yalnız sabit kodlar, görev kimlikleri ve doğrulanmış SHA'lardır.
// Usage:
//   node docs/planning/autonomy/autonomy.mjs decide --pr <n> --implementer-session <id> [--implementer-session <id> ...]
//   node docs/planning/autonomy/autonomy.mjs next [--limit n]
// decide must run from a checkout whose trust files are byte-identical to the base (checked against the base's blob SHAs).
// Exit: 0 AUTO_MERGE (decide) or OK (next), 2 BLOCK, 4 FOUNDER_REQUIRED, 3 INTERNAL_ERROR.
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {evaluateMergeGate, parseBinding} from "../merge-gate.mjs";

export const EXIT = {AUTO_MERGE: 0, BLOCK: 2, INTERNAL_ERROR: 3, FOUNDER_REQUIRED: 4};
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const TASK_LINE_RE = /^UASCO-TASK: ([A-Z0-9]+-T\d{4}(?:\.[a-z0-9]+)?)\s*$/;
// The reviewer's attestation for the exceptions code cannot see (spend, new account/credential, production operation, authority widening).
const ATTEST_RE = /^AUTONOMY-EXCEPTIONS: (none|[A-Z_]{1,32}(?:,[A-Z_]{1,32})*)\s*$/;
// Matrix statuses that count as delivered for dependency purposes, and statuses that are never picked as new work.
export const DONE_STATUSES = Object.freeze(["ASSET_DONE", "DONE_OBSERVED"]);
export const NOT_PICKABLE = Object.freeze(["ASSET_DONE", "DONE_OBSERVED", "SPLIT", "BLOCKED", "DEFERRED", "UNVERIFIABLE", "VERIFY_PENDING"]);
// Paths that define this authority. Changing them would widen it, so a PR touching any of them is a Founder decision (B-1).
// STATE.json is the loop's own progress record and is updated by routine PRs.
export const GOVERNANCE_PREFIXES = Object.freeze(["docs/planning/autonomy/", "docs/planning/authority/", "docs/planning/v41/"]);
export const GOVERNANCE_EXACT = Object.freeze(["docs/planning/merge-gate.mjs", "docs/planning/merge-gate.proof.mjs", "docs/planning/merge_gate.md"]);
export const GOVERNANCE_EXEMPT = Object.freeze(["docs/planning/autonomy/state.json"]);
// Files decide trusts. Each must equal the base's blob, so a PR-head or stale checkout can never supply its own rules (B-2).
export const TRUST_FILES = Object.freeze(["docs/planning/autonomy/autonomy.mjs", "docs/planning/autonomy/standing-authority.json",
  "docs/planning/autonomy/task-index.json", "docs/planning/merge-gate.mjs"]);
export const MAX_PAGES = 30;

export const loadJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
export const loadPolicy = () => loadJson(path.join(HERE, "standing-authority.json"));
export const loadIndex = () => loadJson(path.join(HERE, "task-index.json"));
export const loadState = () => loadJson(path.join(HERE, "STATE.json"));

/** Body lines that can carry a machine line: outside code fences and HTML comments, unquoted, at column 0 (NB-4). */
export function plainLines(body) {
  if (typeof body !== "string") return [];
  const noComments = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const out = [];
  let fence = null;
  for (const l of noComments.split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (fence === null) { if (m) { fence = m[1]; continue; } out.push(l); }
    else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(l)) fence = null;
  }
  return out;
}

/** The single task a PR declares. Zero or several lines => null (fail-closed). */
export function taskOf(body) {
  const ids = plainLines(body).map(l => TASK_LINE_RE.exec(l)).filter(Boolean).map(m => m[1]);
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

const norm = p => (typeof p === "string" ? path.posix.normalize(p.replace(/\\/g, "/")).replace(/^(?:\.\/|\/)+/, "").toLowerCase() : null);
/** True if a diff path belongs to the authority's own definition. */
export function isGovernancePath(p) {
  const n = norm(p);
  if (n === null) return true;   // unusable path: fail-closed
  if (GOVERNANCE_EXEMPT.includes(n)) return false;
  return GOVERNANCE_EXACT.includes(n) || GOVERNANCE_PREFIXES.some(x => n.startsWith(x));
}

/** The reviewer's exception attestation from the latest CLEAN binding review on the exact head and base; null if none (NB-5). */
export function attestationOf(reviews, head, base) {
  const clean = (Array.isArray(reviews) ? reviews : []).filter(r => r && r.commit_id === head && typeof r.body === "string")
    .map(r => ({r, b: parseBinding(r.body)})).filter(x => x.b && x.b.verdict === "CLEAN" && x.b.head === head && x.b.base === base)
    .sort((a, b) => Date.parse(a.r.submitted_at) - Date.parse(b.r.submitted_at));
  if (!clean.length) return null;
  const lines = plainLines(clean.at(-1).r.body).map(l => ATTEST_RE.exec(l)).filter(Boolean);
  return lines.length === 1 ? lines[0][1] : null;
}

/** Pure decision: merge-gate result + evidence + PR body + policy + task index => AUTO_MERGE | FOUNDER_REQUIRED | BLOCK. */
export function decideAutoMerge({gate, body, policy, index, evidence = {}}) {
  const reasons = [];
  const founder = [];
  const tid = taskOf(body);
  const task = tid ? index.tasks.find(t => t.id === tid) : undefined;
  if (!tid) reasons.push("TASK_ID_MISSING_OR_AMBIGUOUS");
  else if (!task) reasons.push("TASK_UNKNOWN");
  if (task) {
    if (!policy.coveredTiers.includes(task.tier)) founder.push(`TIER_NOT_COVERED:${task.tier}`);
    founder.push(...openGates(task, policy));
  }
  // B-3: without the builder session ids, merge-gate cannot reject a self-review, so the autonomous path refuses to decide.
  const impl = Array.isArray(evidence.implementerSessions) ? evidence.implementerSessions.filter(s => typeof s === "string" && s.trim() !== "") : [];
  if (impl.length === 0) reasons.push("IMPLEMENTER_SESSIONS_MISSING");
  // B-1: changes to the authority's own definition (filename or previous_filename) are never routine.
  if (!Array.isArray(evidence.diffFiles)) reasons.push("DIFF_MISSING");
  else if (evidence.diffFiles.some(f => isGovernancePath(f?.filename) || (f?.previous_filename !== undefined && isGovernancePath(f.previous_filename)))) founder.push("GOVERNANCE_PATH");
  const gr = Array.isArray(gate?.reasons) ? gate.reasons : ["GATE_RESULT_MALFORMED"];
  if (gate?.decision !== "MERGE") {
    for (const r of gr) {
      if ((policy.founderRequiredGateReasons ?? []).some(p => r === p || r.startsWith(`${p}:`))) founder.push(`PROTECTED_GOVERNANCE:${r}`);
      else reasons.push(`GATE:${r}`);
    }
    if (gr.length === 0) reasons.push("GATE_NOT_MERGE");
  } else {
    // NB-5: content-level exceptions (spend, accounts, production operations) are attested by the independent reviewer.
    const att = attestationOf(evidence.reviews, gate.expectedHeadSha, gate.expectedBaseSha);
    if (att === null) reasons.push("REVIEWER_ATTESTATION_MISSING");
    else if (att !== "none") for (const x of att.split(",")) founder.push(`REVIEWER_ATTESTED:${x}`);
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
    // L-1: a typed dependency [id, type] is met only by a merged task (the only type the matrix uses is MERGED); other types are treated as unmet.
    const missing = t.deps.filter(d => (Array.isArray(d) ? d[1] !== "MERGED" || !done.has(d[0]) : !done.has(d)));
    if (missing.length) continue;
    const why = [...(policy.coveredTiers.includes(t.tier) ? [] : [`TIER_NOT_COVERED:${t.tier}`]), ...openGates(t, policy)];
    (why.length ? held : ready).push(why.length ? {task: t.id, reasons: why} : {task: t.id, tier: t.tier});
  }
  // Earliest wave first (matrix order inside a wave), so the critical path is not starved by later work.
  const waveOf = id => index.tasks.find(t => t.id === id)?.wave ?? "W~";
  ready.sort((a, b) => waveOf(a.task).localeCompare(waveOf(b.task), "en", {numeric: true}));
  return {ready: ready.slice(0, limit), founderHeld: held.length, readyTotal: ready.length};
}

// ---- evidence collection (GitHub REST through curl, which honours the environment's proxy) ----
export const curlApi = repo => p => JSON.parse(execFileSync("curl", ["-sSf", "-H", "Accept: application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? ["-H", `Authorization: Bearer ${process.env.GITHUB_TOKEN}`] : []), `https://api.github.com/repos/${repo}/${p}`],
{maxBuffer: 64 << 20}).toString("utf8"));
/** All pages of a list; reaching the page cap is an error, never a silent truncation (NB-2). */
export function pages(api, p, key) {
  const all = [];
  for (let n = 1; n <= MAX_PAGES; n++) {
    const j = api(`${p}${p.includes("?") ? "&" : "?"}per_page=100&page=${n}`);
    const arr = key ? j[key] : j;
    if (!Array.isArray(arr)) throw new Error("EVIDENCE_LIST_MALFORMED");
    all.push(...arr);
    if (arr.length < 100) return all;
  }
  throw new Error("EVIDENCE_PAGE_CAP");
}
const gitBlobSha = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const contentAt = (api, file, ref) => { const j = api(`contents/${file}?ref=${ref}`); if (j.encoding !== "base64") throw new Error("CONTENT_ENCODING"); return {sha: j.sha, buf: Buffer.from(j.content, "base64")}; };

/** Evidence for merge-gate, with trust inputs read from the base, and local trust files checked against it. `api` is injectable for tests. */
export function collectEvidence({api, pr, implementerSessions, root = ROOT}) {
  const p = api(`pulls/${pr}`);
  const head = p.head.sha;
  const base0 = api(`branches/${encodeURIComponent(p.base.ref)}`).commit.sha;
  const trustMismatch = [];
  for (const f of TRUST_FILES) {
    const {sha} = contentAt(api, f, base0);
    let local = null;
    try { local = gitBlobSha(fs.readFileSync(path.join(root, f))); } catch { /* missing locally => mismatch */ }
    if (local !== sha) trustMismatch.push(f);
  }
  const policy = JSON.parse(contentAt(api, "docs/planning/autonomy/standing-authority.json", base0).buf.toString("utf8"));
  const index = JSON.parse(contentAt(api, "docs/planning/autonomy/task-index.json", base0).buf.toString("utf8"));
  const pp = JSON.parse(contentAt(api, "config/protected-paths.json", base0).buf.toString("utf8"));
  const runs = pages(api, `actions/runs?head_sha=${head}`, "workflow_runs");
  const suite = new Map(runs.map(r => [r.check_suite_id, r]));
  // NB-1: every run on the head, not only the latest per name.
  const checkRuns = pages(api, `commits/${head}/check-runs?filter=all`, "check_runs").map(c => ({
    name: c.name, status: c.status, conclusion: c.conclusion, head_sha: c.head_sha, app_slug: c.app?.slug ?? null, completed_at: c.completed_at,
    workflowPath: suite.get(c.check_suite?.id)?.path ?? null, workflowRunEvent: suite.get(c.check_suite?.id)?.event ?? null,
  }));
  const reviews = pages(api, `pulls/${pr}/reviews`).map(r => ({id: r.id, user: r.user ? {login: r.user.login} : null, state: r.state, commit_id: r.commit_id, body: r.body, submitted_at: r.submitted_at}));
  const diffFiles = pages(api, `pulls/${pr}/files`).map(f => ({filename: f.filename, ...(f.previous_filename ? {previous_filename: f.previous_filename} : {}), status: f.status}));
  const rules = api(`rules/branches/${encodeURIComponent(p.base.ref)}`);
  // NB-3: the base is read last; trust inputs read at base0 must still be the base.
  const currentBaseSha = api(`branches/${encodeURIComponent(p.base.ref)}`).commit.sha;
  return {
    evidence: {
      pr: {number: p.number, state: p.state, draft: p.draft, merged: p.merged, changed_files: p.changed_files, head: {sha: head, ref: p.head.ref}, base: {ref: p.base.ref, sha: p.base.sha}, user: {login: p.user.login}},
      currentBaseSha, checkRuns, reviews, diffFiles, protectedPaths: {exactPaths: pp.exactPaths, protectedPrefixes: pp.protectedPrefixes}, rules,
      implementerSessions: [...(implementerSessions ?? [])],
    },
    body: p.body ?? "", policy, index,
    trust: {reasons: [...trustMismatch.map(f => `LOCAL_TRUST_FILE_MISMATCH:${f}`), ...(currentBaseSha !== base0 ? ["TRUST_BASE_MOVED"] : [])]},
  };
}

export function decideFor({evidence, body, policy = loadPolicy(), index = loadIndex(), trust = {reasons: []}}) {
  const gate = evaluateMergeGate(evidence, {mode: policy.gateMode, trustedReviewerLogins: policy.trustedReviewerLogins, expectedBaseRef: policy.baseRef});
  const result = decideAutoMerge({gate, body, policy, index, evidence: evidence ?? {}});
  if (trust.reasons.length) { result.decision = "BLOCK"; result.authority = null; result.reasons = [...trust.reasons, ...result.reasons]; }
  return {gate, result};
}

const args = (argv, k) => argv.flatMap((a, i) => (a === k && i + 1 < argv.length ? [argv[i + 1]] : []));

export function runCli(argv) {
  const cmd = argv[0];
  if (cmd === "next") {
    return {exit: 0, res: nextTasks({index: loadIndex(), state: loadState(), policy: loadPolicy(), limit: Number(args(argv, "--limit")[0] ?? 5)})};
  }
  if (cmd === "decide" && args(argv, "--pr").length === 1) {
    const repo = args(argv, "--repo")[0] ?? "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-";
    const c = collectEvidence({api: curlApi(repo), pr: Number(args(argv, "--pr")[0]), implementerSessions: args(argv, "--implementer-session")});
    const {gate, result} = decideFor(c);
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
