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
import {evaluateMergeGate, parseBinding, normPath, INVISIBLE_RE} from "../merge-gate.mjs";

export const EXIT = {AUTO_MERGE: 0, BLOCK: 2, INTERNAL_ERROR: 3, FOUNDER_REQUIRED: 4};
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const TASK_LINE_RE = /^UASCO-TASK: ([A-Z0-9]+-T\d{4}(?:\.[a-z0-9]+)?)\s*$/;
// The reviewer's attestation for the exceptions code cannot see (spend, new account/credential, production operation, authority widening).
const ATTEST_RE = /^AUTONOMY-EXCEPTIONS: (none|[A-Z_]{1,32}(?:,[A-Z_]{1,32})*)\s*$/;
// Matrix statuses that count as delivered for dependency purposes, and statuses that are never picked as new work.
export const DONE_STATUSES = Object.freeze(["ASSET_DONE", "DONE_OBSERVED"]);
export const NOT_PICKABLE = Object.freeze(["ASSET_DONE", "DONE_OBSERVED", "SPLIT", "BLOCKED", "DEFERRED", "UNVERIFIABLE", "VERIFY_PENDING"]);
// Declared-task states that a routine merge may not claim (NB-2 of review 5757869995). Done tasks stay mergeable: fixes to delivered work are routine.
// VERIFY_PENDING stays routine on purpose: verifying delivered work is ordinary development.
export const NOT_MERGEABLE = Object.freeze(["SPLIT", "BLOCKED", "DEFERRED", "UNVERIFIABLE"]);
// Paths that define this authority. Changing them would widen it, so a PR touching any of them is a Founder decision (B-1).
// STATE.json is the loop's own progress record and is updated by routine PRs.
export const GOVERNANCE_PREFIXES = Object.freeze(["docs/planning/autonomy/", "docs/planning/authority/", "docs/planning/v41/", "docs/planning/cloud-only/", ".claude/"]);
// Factory V2 authority code: the static, re-export and literal dynamic import closure of the authority entry points, i.e. the executor's fence
// (v41-guard), LIVE control (control), the bridge/keygen/factory CLI (cli), cutover, V2 merge writing (github-writer, merge-git) and the gate
// verifier. Every file a protected file can load is protected, so a routine PR cannot change authority behaviour through an import.
// tests/support/fv2-executor-fence.cases.ts recomputes the closure from these roots and fails if the code and this list drift; closure files
// outside automation/factory-v2/ are already Founder paths (automation/lib/ and scripts/ci/ via merge-gate, merge-gate.mjs below).
// A file outside the closure (today only demo-worker.mjs, or a new module no protected file imports) stays routine: wiring it in edits a protected file.
export const FV2_AUTHORITY_ROOTS = Object.freeze(["automation/factory-v2/v41-guard.mjs", "automation/factory-v2/control.mjs", "automation/factory-v2/cli.mjs",
  "automation/factory-v2/cutover.mjs", "automation/factory-v2/github-writer.mjs", "automation/factory-v2/merge-git.mjs", "automation/factory-v2/gate-verifier.mjs"]);
export const FV2_AUTHORITY_FILES = Object.freeze(["bridge", "cli", "cloud-orchestrator", "control", "cutover", "executors", "failures", "gate-verifier", "github-writer",
  "identity", "ledger-log", "live-sources", "merge-git", "merge", "model-router", "ownership", "probe-scenario", "quota-governor", "ref-doc-store", "report", "review",
  "scheduler", "shared-registry", "state-journal", "supervisor", "topology", "v41-guard"].map(f => `automation/factory-v2/${f}.mjs`));
export const GOVERNANCE_EXACT = Object.freeze(["docs/planning/merge-gate.mjs", "docs/planning/merge-gate.proof.mjs", "docs/planning/merge_gate.md", ...FV2_AUTHORITY_FILES]);
export const GOVERNANCE_EXEMPT = Object.freeze(["docs/planning/autonomy/state.json"]);
// Files decide trusts. Each must equal the base's blob, so a PR-head or stale checkout can never supply its own rules (B-2).
export const TRUST_FILES = Object.freeze(["docs/planning/autonomy/autonomy.mjs", "docs/planning/autonomy/executor.mjs", "docs/planning/autonomy/standing-authority.json",
  "docs/planning/autonomy/task-index.json", "docs/planning/merge-gate.mjs",
  // The executor's authority fence (Factory V2) and its whole import closure: a stale or PR-head checkout can never run an older guard.
  "automation/factory-v2/v41-guard.mjs", "automation/factory-v2/bridge.mjs", "automation/factory-v2/identity.mjs", "automation/factory-v2/shared-registry.mjs",
  "automation/factory-v2/ownership.mjs", "automation/factory-v2/scheduler.mjs", "automation/factory-v2/topology.mjs",
  "automation/lib/task-lease.mjs", "automation/lib/task-lease-git-store.mjs"]);
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

/** True if a diff path belongs to the authority's own definition. Uses merge-gate's normPath (L-b); an unusable path is fail-closed. */
export function isGovernancePath(p) {
  const n = normPath(p);
  if (n === null) return true;
  if (GOVERNANCE_EXEMPT.includes(n)) return false;
  return GOVERNANCE_EXACT.includes(n) || GOVERNANCE_PREFIXES.some(x => n.startsWith(x));
}

const REVIEW_STATES = new Set(["COMMENTED", "APPROVED"]);
const lc = s => s.toLowerCase();
// Same login shape merge-gate accepts (NB-d).
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const INVISIBLE_G = new RegExp(INVISIBLE_RE.source, "gu");
export const MALFORMED = "MALFORMED";
// A line "mentions" the attestation if, after NFKC, removing invisibles and decoding HTML character references, it holds the two words
// joined by up to 8 non-alphanumerics (any dash, space, underscore, entity...). Every such line must be the single well-formed one (B-1 of review 5757807150).
// Common Cyrillic/Greek look-alikes of the token's Latin letters, folded before matching (NB-1 of review 5757869995).
const CONFUSABLES = new Map(Object.entries({"а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "т": "t", "м": "m", "н": "n", "к": "k",
  "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C", "У": "Y", "Х": "X", "І": "I", "Т": "T", "М": "M", "Н": "N", "К": "K", "ο": "o", "Ο": "O", "α": "a", "Α": "A",
  "ε": "e", "Ε": "E", "τ": "t", "Τ": "T", "ν": "n", "Ν": "N", "μ": "m", "Μ": "M", "ρ": "p", "Ρ": "P", "χ": "x", "Χ": "X", "ι": "i", "Ι": "I", "κ": "k", "Κ": "K", "υ": "y", "Υ": "Y"}));
const fold = l => [...l].map(c => CONFUSABLES.get(c) ?? c).join("");
const decodeOnce = l => l.replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
  .replace(/&#(\d{1,7});?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff))).replace(/&amp;/gi, "&").replace(/&[a-z]+;/gi, " ");
// Entities are decoded up to three times (double escaping such as &amp;#45;) and inline HTML tags are removed.
const decodeEntities = (l, strip) => { const d = decodeOnce(decodeOnce(decodeOnce(l))); return strip ? d.replace(/<[^>]{0,200}>/g, "") : d; };
const MENTION_RE = /autonomy[^\p{L}\p{N}]{0,8}exceptions/iu;
// Tag stripping may only ADD detections: a line is a mention if the test hits before OR after tags are removed (NB-1 of review 5757980178).
const normMention = (l, strip) => fold(decodeEntities(l.normalize("NFKC").replace(INVISIBLE_G, ""), strip).normalize("NFKC").replace(INVISIBLE_G, ""));
export const mentionsAttestation = l => MENTION_RE.test(normMention(l, false)) || MENTION_RE.test(normMention(l, true));
/**
 * One review's attestation: null if no line mentions it at all; MALFORMED if any line anywhere (fenced, quoted, with invisibles,
 * any case or dash, entities, several lines) mentions it and the review does not hold exactly one well-formed plain line.
 */
export function reviewAttestation(body) {
  if (typeof body !== "string") return null;
  const mentions = body.split(/\r?\n/).filter(mentionsAttestation);
  if (mentions.length === 0) return null;
  const plain = plainLines(body).map(l => ATTEST_RE.exec(l)).filter(Boolean);
  if (mentions.length !== 1 || plain.length !== 1 || INVISIBLE_RE.test(mentions[0]) || !ATTEST_RE.test(mentions[0])) return MALFORMED;
  return plain[0][1];
}

/**
 * The reviewer's exception attestation (BLOCKING-1 of review 5757611393). It uses merge-gate's own selection rules:
 * - only reviews from `allowed` logins (trusted reviewers plus, in process mode, the PR author) count;
 * - a review counts only if its state is COMMENTED or APPROVED, its time is valid, its binding is CLEAN on the exact head and base, and its session is not a builder session;
 * - the selected review is the latest by time, then by id, the same one merge-gate accepts. It must carry exactly one attestation line, else null.
 * The exceptions are the union over EVERY qualifying CLEAN review, so a later review can never erase an earlier attested exception.
 */
export function attestationOf({reviews, head, base, allowed, implementerSessions = []}) {
  const impl = new Set(implementerSessions);
  const all = (Array.isArray(reviews) ? reviews : []).flatMap(r => {
    if (!r || typeof r.body !== "string" || r.commit_id !== head) return [];
    const login = r.user && typeof r.user.login === "string" && LOGIN_RE.test(r.user.login) ? lc(r.user.login) : null;
    if (login === null || !allowed.has(login)) return [];
    const t = typeof r.submitted_at === "string" ? Date.parse(r.submitted_at) : NaN;
    const b = parseBinding(r.body);
    if (!b || b.code || b.verdict !== "CLEAN" || b.head !== head || b.base !== base || impl.has(b.session)) return [];
    // NB-2: a DISMISSED CLEAN review still contributes its exceptions (and must still carry a readable line); it is never the selected one.
    if (r.state === "DISMISSED") return [{t, id: Number(r.id) || 0, a: reviewAttestation(r.body), selectable: false}];
    if (!REVIEW_STATES.has(r.state) || !Number.isFinite(t)) return [];
    return [{t, id: Number(r.id) || 0, a: reviewAttestation(r.body), selectable: true}];
  });
  // The selected review (latest selectable, as merge-gate picks it) only has to exist: every qualifying review must carry its own line anyway.
  if (!all.some(x => x.selectable)) return null;
  // Any qualifying review whose attestation cannot be read fails the whole decision closed: its stated exception may be the one hidden.
  if (all.some(x => x.a === MALFORMED)) return MALFORMED;
  // Every qualifying CLEAN review must carry its own attestation; a silent one may be a garbled exception (B-1 of review 5757807150, fix (b)).
  if (all.some(x => x.a === null)) return null;
  const codes = new Set(all.flatMap(x => (x.a === "none" ? [] : x.a.split(","))));
  return codes.size ? [...codes].join(",") : "none";
}

/** Pure decision: merge-gate result + evidence + PR body + policy + task index => AUTO_MERGE | FOUNDER_REQUIRED | BLOCK. */
export function decideAutoMerge({gate, body, policy, index, evidence = {}, state = {}}) {
  const reasons = [];
  const founder = [];
  const tid = taskOf(body);
  const task = tid ? index.tasks.find(t => t.id === tid) : undefined;
  if (!tid) reasons.push("TASK_ID_MISSING_OR_AMBIGUOUS");
  else if (!task) reasons.push("TASK_UNKNOWN");
  if (task) {
    if (!policy.coveredTiers.includes(task.tier)) founder.push(`TIER_NOT_COVERED:${task.tier}`);
    founder.push(...openGates(task, policy));
    if (NOT_MERGEABLE.includes(task.status)) founder.push(`TASK_NOT_ACTIONABLE:${task.status}`);
    if (task.exec === "LOCAL") founder.push("TASK_LOCAL_EXECUTION");
    const done = doneSet(index, state);
    for (const d of task.deps ?? []) if (Array.isArray(d) ? d[1] !== "MERGED" || !done.has(d[0]) : !done.has(d)) founder.push(`TASK_DEPENDENCY_UNMET:${Array.isArray(d) ? d[0] : d}`);
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
    const author = typeof evidence.pr?.user?.login === "string" && LOGIN_RE.test(evidence.pr.user.login) ? [lc(evidence.pr.user.login)] : [];
    // Same allowed set as merge-gate: trusted logins other than the author, plus the author in process mode only (L-3).
    const allowed = new Set([...(policy.trustedReviewerLogins ?? []).map(lc).filter(l => !author.includes(l)), ...(policy.gateMode === "process" ? author : [])]);
    const att = attestationOf({reviews: evidence.reviews, head: gate.expectedHeadSha, base: gate.expectedBaseSha, allowed, implementerSessions: impl});
    if (att === null) reasons.push("REVIEWER_ATTESTATION_MISSING");
    else if (att === MALFORMED) reasons.push("REVIEWER_ATTESTATION_MALFORMED");
    else if (att !== "none") for (const x of att.split(",")) founder.push(`REVIEWER_ATTESTED:${x}`);
  }
  const decision = reasons.length ? "BLOCK" : founder.length ? "FOUNDER_REQUIRED" : "AUTO_MERGE";
  return {decision, task: task ? task.id : null, expectedHeadSha: gate?.expectedHeadSha ?? null, expectedBaseSha: gate?.expectedBaseSha ?? null,
    reasons: [...new Set([...reasons, ...founder])], authority: decision === "AUTO_MERGE" ? policy.decisionId : null};
}

/** Next pickable tasks: not done, not in flight, every dependency done, tier covered, no open gate. Blocked tasks never stop unrelated ones. */
export const doneSet = (index, state) => new Set([...(state?.done ?? []).map(x => typeof x === "string" ? x : x.task), ...index.tasks.filter(t => DONE_STATUSES.includes(t.status)).map(t => t.id)]);
export function nextTasks({index, state, policy, limit = 5}) {
  const done = doneSet(index, state);
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

/**
 * STATE.json done entries are claims written by routine PRs. Only entries whose PR is merged into the base ref and declares that task
 * (its single UASCO-TASK line, or the task id as the first word of its title) count; the rest are dropped (NB-2 of review 5757980178).
 */
export const MAX_STATE_ENTRIES = 500;
export function verifiedState(api, state, baseRef) {
  const done = [], dropped = [], seen = new Map();
  const entries = Array.isArray(state?.done) ? state.done : [];
  // NB-2 of review 5758038281: bounded, one API call per distinct PR; an unreadable PR drops its entry instead of failing every decide.
  if (entries.length > MAX_STATE_ENTRIES) throw new Error("STATE_TOO_LARGE");
  for (const e of entries) {
    const task = typeof e === "string" ? e : e?.task, pr = typeof e === "object" && e ? e.pr : undefined;
    let ok = false;
    if (typeof task === "string" && Number.isSafeInteger(pr) && pr > 0) {
      if (!seen.has(pr)) { let p = null; try { p = api(`pulls/${pr}`); } catch { p = null; } seen.set(pr, p); }
      const p = seen.get(pr);
      // NB-1: a PR that declares a task in its body vouches only for that task; the title's first word is a fallback for PRs with no declaration.
      const declared = p ? taskOf(p.body ?? "") : null;
      ok = !!p && p.merged === true && p.base?.ref === baseRef && (declared !== null ? declared === task : String(p.title ?? "").split(/\s+/)[0] === task);
    }
    (ok ? done : dropped).push(ok ? {task, pr} : String(task));
  }
  return {done, dropped};
}

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
  const state = verifiedState(api, JSON.parse(contentAt(api, "docs/planning/autonomy/STATE.json", base0).buf.toString("utf8")), p.base.ref);
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
    body: p.body ?? "", policy, index, state,
    trust: {reasons: [...trustMismatch.map(f => `LOCAL_TRUST_FILE_MISMATCH:${f}`), ...(currentBaseSha !== base0 ? ["TRUST_BASE_MOVED"] : [])]},
  };
}

export function decideFor({evidence, body, policy = loadPolicy(), index = loadIndex(), state = {done: []}, trust}) {
  const gate = evaluateMergeGate(evidence, {mode: policy.gateMode, trustedReviewerLogins: policy.trustedReviewerLogins, expectedBaseRef: policy.baseRef});
  const result = decideAutoMerge({gate, body, policy, index, evidence: evidence ?? {}, state});
  // NB-a: the trust result from collectEvidence is mandatory; a missing or malformed one blocks.
  const tr = trust && Array.isArray(trust.reasons) && trust.reasons.every(x => typeof x === "string") ? trust.reasons : ["TRUST_RESULT_MISSING"];
  if (tr.length) { result.decision = "BLOCK"; result.authority = null; result.reasons = [...tr, ...result.reasons]; }
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
