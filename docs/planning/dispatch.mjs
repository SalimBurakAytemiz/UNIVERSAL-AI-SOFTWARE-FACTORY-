// //TR: Bu betik Cloud-only deterministik sonraki-görev dağıtıcısıdır: BACKLOG_CHECKPOINT.json'u fail-closed doğrular, ilk seçilebilir görevi seçer ve --claim ile git branch-ref (create-only) üzerinden talep eder; bu, birleştirilmiş atomik lease ya da FA-LEASE2 bağlantısı DEĞİLDİR (bkz. DISPATCH.md).
// Usage: node docs/planning/dispatch.mjs [--claim] [--owner <id>] [--backlog <path>] [--remote <name>] [--base-branch <b>] [--stale-hours <n>] [--open-prs a,b] [--max-active <1..16>] [--no-lease]
// Exit: 0 START|NO_ACTION, 2 BLOCKED, 3 RECOVERABLE_FAILURE. Prints exactly one JSON line on stdout.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// "_" is deliberately not allowed in --owner/--remote names so token-shaped secrets (ghp_..., sk_...) can never be accepted or echoed.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/;
const CLAIM_SUBJECT = "dispatch-claim:";
export const EXIT = {START: 0, NO_ACTION: 0, BLOCKED: 2, RECOVERABLE_FAILURE: 3};

const isStr = v => typeof v === "string";
const nonEmpty = v => isStr(v) && v.trim() !== "";
const CAP = 160;
export const capReason = x => String(x).slice(0, CAP);
export const claimBranchOf = id => `claude/${id.toLowerCase()}`;
const refOkCache = new Map();
// Ask git itself whether a ref name is well-formed (args array, no shell). Fail-closed: spawn failure => invalid.
function gitRefOk(name, branch) {
  const k = `${branch ? "b" : "r"}:${name}`;
  if (!refOkCache.has(k)) {
    const r = spawnSync("git", ["check-ref-format", ...(branch ? ["--branch"] : []), name], {encoding: "utf8", windowsHide: true});
    refOkCache.set(k, r.status === 0);
  }
  return refOkCache.get(k);
}
// Validates the id AND the final lowercased claim branch and the lease ref.
export const validId = id => isStr(id) && ID_RE.test(id) && !id.includes("..") && !/\.lock$/i.test(id) && !id.endsWith(".")
  && gitRefOk(claimBranchOf(id), true) && gitRefOk(`refs/uasco/claims/${id}`, false);

// Output sanitisers: backlog/argv text reaches stdout ONLY through these (fixed vocabulary or strictly validated tokens).
const STATUS_ENUM = new Set(["IMPLEMENT_PENDING", "REVIEW_PENDING", "REVIEW_PENDING_PROVIDER_QUOTA", "REVIEW_CLEAN", "REMEDIATION_PENDING", "MERGED", "CLOSED", "QUEUED", "FOUNDER_DECISION_PENDING",
  "AUTHORITY_REQUIRED", "DRAFT_NOT_READY", "IN_REVIEW", "BLOCKED", "DONE", "READY", "IN_PROGRESS", "PENDING_REVIEW", "PENDING_CI", "NOT_STARTED", "COMPLETED"]);
const OWNER_ENUM = new Set(["CLOUD", "LOCAL", "FOUNDER"]);
export const safeId = id => validId(id) ? id : "?";
export const safeStatus = s => isStr(s) && STATUS_ENUM.has(s) ? s : "malformed";
export const safeOwner = o => isStr(o) && OWNER_ENUM.has(o) ? o : "malformed";
export const refNameOk = b => isStr(b) && REF_RE.test(b) && !b.includes("..") && !b.endsWith(".") && !/\.lock$/i.test(b);
export const safeBranch = b => refNameOk(b) && b.length <= 120 ? b : "BRANCH_INVALID";
// argv values: owner is echoed only if it passes the TOKEN_RE-style check (no "_"), the base branch only as a valid "_"-free ref name.
export const safeOwnerArg = o => isStr(o) && /^[A-Za-z0-9.:-]{1,256}$/.test(o) ? o : "?";
export const safeBaseEcho = b => isStr(b) && !b.includes("_") ? safeBranch(b) : "BRANCH_INVALID";
const safeArg = a => isStr(a) && /^--?[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(a) ? a : "?";

class Blocked extends Error { constructor(code) { super(code); this.code = code; } }

export function parseArgs(argv) {
  const o = {claim: false, owner: "cloud-dispatch", backlog: "docs/planning/BACKLOG_CHECKPOINT.json", remote: "origin",
    baseBranch: "v7/integration", staleHours: 6, openPrs: [], maxActive: null, lease: true};
  const val = (i, f) => { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Blocked(`ARG_MISSING_VALUE:${f}`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--claim") o.claim = true;
    else if (a === "--no-lease") o.lease = false;
    else if (a === "--owner") o.owner = val(i++, a);
    else if (a === "--backlog") o.backlog = val(i++, a);
    else if (a === "--remote") o.remote = val(i++, a);
    else if (a === "--base-branch") o.baseBranch = val(i++, a);
    else if (a === "--stale-hours") { const n = Number(val(i++, a)); if (!Number.isFinite(n) || n < 0) throw new Blocked("ARG_INVALID:--stale-hours"); o.staleHours = n; }
    else if (a === "--max-active") { const v = val(i++, a); const n = /^[0-9]{1,3}$/.test(v) ? Number(v) : NaN; if (!(n >= 1 && n <= 16)) throw new Blocked("ARG_INVALID:--max-active"); o.maxActive = n; }
    // An explicit empty value ("--open-prs ''") means "no open PRs"; a flag with NO following argument stays ARG_MISSING_VALUE (fail-closed).
    else if (a === "--open-prs") o.openPrs = val(i++, a).split(",").map(s => s.trim()).filter(Boolean);
    else throw new Blocked(`ARG_UNKNOWN:${safeArg(a)}`);
  }
  if (!NAME_RE.test(o.owner)) throw new Blocked("ARG_INVALID:--owner");
  if (!NAME_RE.test(o.remote)) throw new Blocked("ARG_INVALID:--remote");
  if (!REF_RE.test(o.baseBranch) || o.baseBranch.includes("..")) throw new Blocked("ARG_INVALID:--base-branch");
  return o;
}

// Fail-closed backlog load: any structural problem is BLOCKED (exit 2), never "no work".
export function loadBacklog(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { throw new Blocked("BACKLOG_MISSING"); }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new Blocked("BACKLOG_UNPARSEABLE"); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !Array.isArray(doc.tasks)) throw new Blocked("BACKLOG_SCHEMA_INVALID:tasks");
  const seen = new Set();
  for (const t of doc.tasks) {
    if (t && typeof t === "object" && isStr(t.id)) {
      const k = t.id.toLowerCase();
      if (seen.has(k)) throw new Blocked(`BACKLOG_DUPLICATE_ID:${safeId(t.id)}`);
      seen.add(k);
    }
  }
  return doc.tasks;
}

// Pure evaluation of one task. env = {tasks, claimedHeads:Set<branch>, remoteHeads:Set<branch>, openPrs:Set<branch>}.
export function evaluateTask(t, env) {
  const r = [];
  if (!t || typeof t !== "object" || Array.isArray(t)) return ["MALFORMED_TASK"];
  if (!validId(t.id)) return ["MALFORMED_ID"];
  if (t.status !== "READY") r.push(`NOT_READY:${safeStatus(t.status)}`);
  if (t.owner !== "CLOUD") r.push(`OWNER_NOT_CLOUD:${safeOwner(t.owner)}`);
  if (!nonEmpty(t.authorizedBy)) r.push("NO_AUTHORIZED_BY");
  if (!Array.isArray(t.dependsOn) || !t.dependsOn.every(nonEmpty)) r.push("MALFORMED_DEPENDS_ON");
  else for (const d of t.dependsOn) {
    const dep = env.tasks.find(x => x && isStr(x.id) && x.id === d);
    if (!dep || dep.status !== "DONE") r.push(`UNMET_DEP:${safeId(d)}`);
  }
  // Authority gating is opt-IN: both flags must be present AND the boolean false. Absent, null, "false", 0, ... are never eligible.
  if (t.protectedEdit !== false) r.push(t.protectedEdit === true ? "PROTECTED_EDIT" : Object.hasOwn(t, "protectedEdit") ? "MALFORMED_PROTECTED_EDIT" : "MISSING_PROTECTED_EDIT");
  if (t.requiresNewAuthority !== false) r.push(t.requiresNewAuthority === true ? "REQUIRES_NEW_AUTHORITY" : Object.hasOwn(t, "requiresNewAuthority") ? "MALFORMED_REQUIRES_NEW_AUTHORITY" : "MISSING_REQUIRES_NEW_AUTHORITY");
  const cb = claimBranchOf(t.id);
  if (env.claimedHeads.has(cb)) r.push("ALREADY_CLAIMED");
  // Directory/file ref conflicts: a head under claude/<id>/ or a head equal to a directory prefix of the claim ref cannot coexist with it.
  if (!env.claimedHeads.has(cb)) {
    const parts = cb.split("/");
    const prefixes = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
    let conflict = prefixes.some(pf => env.remoteHeads.has(pf));
    if (!conflict) for (const h of env.remoteHeads) if (h.startsWith(`${cb}/`)) { conflict = true; break; }
    if (conflict) r.push("REF_CONFLICT");
  }
  if (env.skip && env.skip.has(t.id)) r.push(env.skip.get(t.id));
  const own = [cb];
  if (t.branch !== undefined) { if (nonEmpty(t.branch)) own.push(t.branch.trim()); else r.push("MALFORMED_BRANCH"); }
  for (const b of own) {
    if (b !== cb && env.remoteHeads.has(b)) r.push(`BRANCH_EXISTS:${safeBranch(b)}`);
    if (env.openPrs.has(b)) r.push(`OPEN_PR:${safeBranch(b)}`);
  }
  return r;
}

export function select(tasks, env) {
  const perTask = [];
  let chosen = null;
  for (const t of tasks) {
    const reasons = evaluateTask(t, env);
    const id = t && validId(t.id) ? t.id : null;
    if (reasons.length) perTask.push({taskId: id, reasons});
    else if (!chosen) chosen = t;
  }
  return {chosen, perTask};
}

function makeGit(cwd) {
  return (args, input, extraEnv) => {
    const a = args[0] === "fetch" ? ["fetch", "--no-write-fetch-head", ...args.slice(1)] : args;
    const r = spawnSync("git", a, {cwd, input, encoding: "utf8", windowsHide: true,
      env: {...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv}});
    return {status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? ""};
  };
}

function remoteHeads(git, remote) {
  const r = git(["ls-remote", "--heads", remote]);
  if (r.status !== 0) return null;
  const m = new Map();
  // EVERY head the remote lists is kept (full set) for existence/conflict decisions; only the sha is validated (40/64 hex; a malformed line is ignored).
  // Head names are never echoed from here: output goes through safeBranch/validId only. ls-remote format is "<sha>\t<ref>".
  for (const l of r.stdout.split("\n")) {
    const i = l.indexOf("\t");
    if (i < 0) continue;
    const sha = l.slice(0, i), ref = l.slice(i + 1);
    if (!SHA_RE.test(sha) || !ref.startsWith("refs/heads/") || ref.length === 11) continue;
    m.set(ref.slice(11), sha);
  }
  return m;
}

// Pure claim = every commit beyond merge-base(branch, base) is a "dispatch-claim:" commit with exactly one parent whose tree equals that
// parent's tree (independent of base movement). A head that is an ancestor of the base tip is MERGED_AWAITING_WRITEBACK.
// Work branches: HAS_WORK_COMMITS while their head commit is newer than staleHours, else ABANDONED_WITH_WORK (reported only; never deleted/reclaimed).
function staleReport(git, remote, baseSha, claimed, openPrs, staleHours, readLease, now) {
  const out = [];
  const hoursOf = ms => Math.round(ms / 36e5 * 100) / 100;
  for (const {taskId, branch, sha} of claimed) {
    const claimRef = `refs/heads/${branch}`;
    if (openPrs.has(branch)) { out.push({taskId, claimRef, state: "OPEN_PR"}); continue; }
    if (!baseSha) { out.push({taskId, claimRef, state: "UNKNOWN", why: "BASE_UNAVAILABLE"}); continue; }
    if (git(["cat-file", "-e", `${sha}^{commit}`]).status !== 0 && git(["fetch", "--no-tags", remote, claimRef]).status !== 0) {
      out.push({taskId, claimRef, state: "UNKNOWN", why: "CLAIM_REF_NOT_FETCHABLE"}); continue;
    }
    const anc = git(["merge-base", "--is-ancestor", sha, baseSha]);
    if (anc.status === 0) { out.push({taskId, claimRef, state: "MERGED_AWAITING_WRITEBACK"}); continue; }
    if (anc.status !== 1) { out.push({taskId, claimRef, state: "UNKNOWN", why: "ANCESTRY_CHECK_FAILED"}); continue; }
    const mb = git(["merge-base", sha, baseSha]);
    if (mb.status !== 0 || !SHA_RE.test(mb.stdout.trim())) { out.push({taskId, claimRef, state: "UNKNOWN", why: "MERGE_BASE_FAILED"}); continue; }
    const l = git(["log", "--format=%ct%x09%s%x09%P", `${mb.stdout.trim()}..${sha}`]);
    if (l.status !== 0) { out.push({taskId, claimRef, state: "UNKNOWN", why: "LOG_FAILED"}); continue; }
    const rows = l.stdout.split("\n").filter(Boolean).map(x => x.split("\t"));
    let pure = true;
    for (const r of rows) {
      const parents = (r[2] || "").split(" ").filter(Boolean);
      if (!(r[1] || "").startsWith(CLAIM_SUBJECT) || parents.length !== 1) { pure = false; break; }
    }
    if (pure) {
      const commits = git(["rev-list", `${mb.stdout.trim()}..${sha}`]);
      if (commits.status !== 0) { out.push({taskId, claimRef, state: "UNKNOWN", why: "TREE_COMPARE_FAILED"}); continue; }
      // A claim commit that changed the tree relative to its own parent is not a pure claim, whatever its subject says.
      for (const c of commits.stdout.split("\n").filter(Boolean)) {
        const t = git(["rev-parse", `${c}^{tree}`, `${c}^1^{tree}`]);
        const [a, b] = t.stdout.trim().split("\n");
        if (t.status !== 0 || !a || !b) { out.push({taskId, claimRef, state: "UNKNOWN", why: "TREE_COMPARE_FAILED"}); pure = null; break; }
        if (a !== b) { pure = false; break; }
      }
      if (pure === null) continue;
    }
    if (!pure) {
      const h = git(["log", "-1", "--format=%ct", sha]);
      const ct = Number(h.stdout.trim());
      if (h.status !== 0 || !Number.isFinite(ct)) { out.push({taskId, claimRef, state: "HAS_WORK_COMMITS"}); continue; }
      const ageMs = now - ct * 1000;
      const rec = {taskId, claimRef, state: "HAS_WORK_COMMITS", lastActivityAt: new Date(ct * 1000).toISOString()};
      if (ageMs < 0) { out.push({...rec, why: "ACTIVITY_FUTURE_DATED"}); continue; }
      rec.ageHours = hoursOf(ageMs);
      if (ageMs > staleHours * 36e5) { rec.state = "ABANDONED_WITH_WORK"; rec.note = "reported only; never auto-deleted or auto-reclaimed; an operator decides"; }
      out.push(rec); continue;
    }
    let ageMs = null, extra = null;
    if (rows.length) ageMs = now - Math.max(...rows.map(r => Number(r[0]))) * 1000;
    else { const le = readLease(taskId); if (le && Number.isFinite(le.acquiredAt)) { ageMs = now - le.acquiredAt; extra = "age from lease acquiredAt"; } }
    if (ageMs === null || !Number.isFinite(ageMs)) { out.push({taskId, claimRef, state: "UNKNOWN", why: "CLAIM_AGE_UNKNOWN"}); continue; }
    if (ageMs < 0) { out.push({taskId, claimRef, state: "UNKNOWN", why: "CLAIM_AGE_NEGATIVE_FUTURE_DATED"}); continue; }
    const ageHours = hoursOf(ageMs);
    out.push(ageMs > staleHours * 36e5
      ? {taskId, claimRef, state: "RECLAIMABLE", ageHours, note: "reported only; never auto-deleted; an operator must delete the ref", ...(extra ? {extra} : {})}
      : {taskId, claimRef, state: "FRESH", ageHours});
  }
  return out;
}

// True when a commit reachable from the base tip has a subject starting with exactly "dispatch-claim: <id> " (claimed AND merged earlier,
// possibly with the claim branch deleted since). null = could not be determined (fail-closed). Fixed-string, bounded, subjects never echoed.
function claimInBaseHistory(git, baseSha, id) {
  const prefix = `${CLAIM_SUBJECT} ${id} `;
  const r = git(["log", "--format=%s", "--fixed-strings", `--grep=${prefix}`, "--max-count=200", baseSha]);
  if (r.status !== 0) return null;
  return r.stdout.split("\n").some(s => s.startsWith(prefix));
}

// Pure decision: the lease store is "unavailable" (not held) ONLY when ls-remote SUCCEEDED and printed nothing.
// A failed ls-remote (non-zero status) proves nothing about the ref, so it stays fail-closed.
export const leaseRefAbsent = lr => !!lr && lr.status === 0 && String(lr.stdout ?? "").trim() === "";
export const leaseCheckFailed = lr => !lr || lr.status !== 0;

// NOTE: codes are ADVISORY LABELS. The matched text (remote/hook/lease stderr) is attacker-influenceable, so a hook can make its own
// rejection look like e.g. NETWORK or PERMISSION_DENIED (first match wins, in the order below). Never gate a decision on a code.
// Closed-vocabulary classifier for untrusted server/hook/lease-module error text. The text is NEVER echoed: it is matched
// against fixed patterns and only a CODE from FAIL_CODES can leave this function (so no substring of it reaches any output).
// Patterns are simple (no nested quantifiers, bounded input) so matching is linear. First match wins.
export const FAIL_CODES = Object.freeze(["NON_FAST_FORWARD", "REF_CONFLICT_REMOTE", "REF_LOCKED", "PROTECTED_BRANCH", "AUTH_FAILED", "PERMISSION_DENIED", "HOOK_DECLINED", "NETWORK", "REMOTE_REJECTED", "UNKNOWN"]);
const CLASSIFIERS = [
  ["NON_FAST_FORWARD", /non-fast-forward|\(fetch first\)|tip of your current branch is behind|stale info/],
  ["REF_CONFLICT_REMOTE", /exists; cannot create|exists; cannot be created|directory\/file conflict/],
  ["REF_LOCKED", /cannot lock ref|failed to lock|unable to lock|\.lock' exists/],
  ["PROTECTED_BRANCH", /protected branch|branch protection|gh006|gh013|repository rule violations/],
  ["AUTH_FAILED", /authentication failed|could not read (?:username|password)|(?:username|password) for |terminal prompts disabled|bad credentials|invalid credentials|requires authentication/],
  ["PERMISSION_DENIED", /permission denied|access denied|permission to [^ ]+ denied|write access to repository not granted|not permitted/],
  ["HOOK_DECLINED", /hook declined|hook exited|hook failed|hook returned|pre-receive|update hook|post-receive/],
  ["NETWORK", /could not resolve host|unable to access|connection (?:refused|timed out|reset|closed)|network is unreachable|\b(?:timed out|ssl|tls)\b|early eof|remote end hung up|could not read from remote/],
  ["REMOTE_REJECTED", /remote rejected|failed to push|rejected/],
];
export function classifyFailure(text) {
  try {
    const t = String(text ?? "").slice(0, 65536).toLowerCase();
    for (const [code, rx] of CLASSIFIERS) if (rx.test(t)) return code;
  } catch { /* fall through */ }
  return "UNKNOWN";
}
export const pushFailReason = stderr => classifyFailure(stderr);
// Never throws (hostile error objects with throwing getters/toString included).
export const leaseErrorCode = e => { try { return `LEASE_ERROR:${classifyFailure(e?.message ?? e)}`; } catch { return "LEASE_ERROR:UNKNOWN"; } };
// Real lease tokens are <owner>:<pid>:<uuid>:<epoch>:<uuid>; "_" is deliberately excluded so token-shaped secrets (ghp_..., sk_...) are never echoed.
const TOKEN_RE = /^[A-Za-z0-9.:-]{1,256}$/;

function fin(outcome, reasons, extra = {}) {
  const out = {outcome, taskId: null, branch: null, claimRef: null, ...extra, reasons: reasons.map(capReason)};
  if (Array.isArray(out.perTask)) out.perTask = out.perTask.map(p => ({...p, reasons: p.reasons.map(capReason)}));
  return {outcome, exit: EXIT[outcome], line: JSON.stringify(out)};
}

const INTERNAL_LINE = JSON.stringify({outcome: "RECOVERABLE_FAILURE", reasons: ["INTERNAL_ERROR"]});
// In claim mode a claim push may already have reached the remote when the unexpected exception hit.
const INTERNAL_LINE_CLAIM = JSON.stringify({outcome: "RECOVERABLE_FAILURE", reasons: ["INTERNAL_ERROR", "CLAIM_MAY_EXIST_CHECK_REMOTE"]});
export const internalLine = argv => Array.isArray(argv) && argv.includes("--claim") ? INTERNAL_LINE_CLAIM : INTERNAL_LINE;
export async function run(argv, cwd = process.cwd()) {
  try { return await runInner(argv, cwd); } catch { return {outcome: "RECOVERABLE_FAILURE", exit: EXIT.RECOVERABLE_FAILURE, line: internalLine(argv)}; }
}
// Lease modules are trusted repo code, but anything they write to console/stdout/stderr is discarded while they run so the one-line stdout contract holds.
// (A module writing straight to fd 1 via fs.writeSync is out of reach: that is why the modules must be trusted.)
const MUTE = ["log", "info", "debug", "warn", "error", "trace", "dir", "table"];
function muteStart() {
  const saved = {c: {}, out: process.stdout.write, err: process.stderr.write};
  for (const k of MUTE) { saved.c[k] = console[k]; console[k] = () => {}; }
  process.stdout.write = (...a) => { const cb = a.find(x => typeof x === "function"); if (cb) cb(); return true; };
  process.stderr.write = process.stdout.write;
  return saved;
}
function muteEnd(saved) { for (const k of MUTE) console[k] = saved.c[k]; process.stdout.write = saved.out; process.stderr.write = saved.err; }
const quiet = fn => { const sv = muteStart(); try { return fn(); } finally { muteEnd(sv); } };
const quietAsync = async fn => { const sv = muteStart(); try { return await fn(); } finally { muteEnd(sv); } };

async function runInner(argv, cwd) {
  let o;
  try { o = parseArgs(argv); } catch (e) { return fin("BLOCKED", [e.code || "ARG_ERROR"]); }
  let tasks;
  try { tasks = loadBacklog(path.resolve(cwd, o.backlog)); } catch (e) { return fin("BLOCKED", [e.code || "BACKLOG_ERROR"]); }
  const git = makeGit(cwd);
  const heads = remoteHeads(git, o.remote);
  if (!heads) return fin("RECOVERABLE_FAILURE", ["REMOTE_UNREACHABLE"]);
  const claimedHeads = new Set([...heads.keys()].filter(n => n.startsWith("claude/")));
  const env = {tasks, claimedHeads, remoteHeads: new Set(heads.keys()), openPrs: new Set(o.openPrs), skip: new Map()};
  const {chosen: first, perTask} = select(tasks, env);
  const flat = perTask.flatMap(p => p.reasons.map(x => `${p.taskId ?? "?"}:${x}`));

  // Lease modules are imported read-only from THIS script's own repo (import.meta.url), never from the caller's cwd/git toplevel
  // (a cwd repo could otherwise plant its own automation/lib/task-lease*.mjs); a load failure only disables the optional lease record.
  let leaseApi = null, store = null;
  const leaseFlag = {unavail: false};
  if (o.lease) {
    try {
      const base = path.resolve(HERE, "../..");
      const imp = f => quietAsync(() => import(pathToFileURL(path.join(base, f)).href));
      leaseApi = await imp("automation/lib/task-lease.mjs");
      const S = await imp("automation/lib/task-lease-git-store.mjs");
      const raw = quiet(() => S.createRemoteRefStore({runGit: git, remote: o.remote}));
      // Observe the store's fail-closed "created:false, current:null" (write rejected / unreadable) signal.
      store = {...raw, createIfAbsent: (id, rec) => { const c = raw.createIfAbsent(id, rec); if (!c.created && !c.current) leaseFlag.unavail = true; return c; }};
    } catch { leaseApi = null; store = null; }
  }
  const readLease = id => { try { return store ? quiet(() => store.read(id)) : null; } catch { return null; } };

  let baseSha = heads.get(o.baseBranch) ?? null;
  if (baseSha && git(["cat-file", "-e", `${baseSha}^{commit}`]).status !== 0) {
    git(["fetch", "--no-tags", o.remote, `refs/heads/${o.baseBranch}`]);
    if (git(["cat-file", "-e", `${baseSha}^{commit}`]).status !== 0) baseSha = null;
  }
  const claimedList = [];
  for (const t of tasks) {
    if (!t || !validId(t.id)) continue;
    const b = claimBranchOf(t.id);
    if (claimedHeads.has(b)) claimedList.push({taskId: t.id, branch: b, sha: heads.get(b)});
  }
  const reclaimable = staleReport(git, o.remote, baseSha, claimedList, env.openPrs, o.staleHours, readLease, Date.now());
  for (const r of reclaimable) if (r.state === "RECLAIMABLE") flat.push(`${r.taskId}:RECLAIMABLE`);
  const active = reclaimable.filter(r => (r.state === "FRESH" || r.state === "HAS_WORK_COMMITS") && !env.openPrs.has(claimBranchOf(r.taskId))).length;
  const extras = {perTask, reclaimable, active, mode: o.claim ? "CLAIM" : "DRY_RUN", owner: safeOwnerArg(o.owner)};

  const skipNext = (id, reason) => { env.skip.set(id, reason); return select(tasks, env).chosen; };
  if (!first) return fin("NO_ACTION", flat.length ? flat : ["EMPTY_BACKLOG"], extras);
  if (!o.claim) {
    // Dry run mirrors the claim loop: a task whose claim is already in the base history is not offered (reserves nothing either way).
    let pick = first;
    while (pick && baseSha) {
      const h = claimInBaseHistory(git, baseSha, pick.id);
      if (h === false) break;
      const code = h === null ? "CLAIM_HISTORY_CHECK_FAILED" : "CLAIM_IN_BASE_HISTORY";
      flat.push(`${pick.id}:${code}`); pick = skipNext(pick.id, code);
    }
    if (!pick) return fin("NO_ACTION", flat, extras);
    return fin("START", flat, {...extras, taskId: pick.id, branch: claimBranchOf(pick.id), claimRef: `refs/heads/${claimBranchOf(pick.id)}`, claimed: false});
  }
  if (o.maxActive !== null && active >= o.maxActive) return fin("NO_ACTION", [...flat, `CAPACITY_FULL:${active}/${o.maxActive}`], extras);
  if (!baseSha) return fin("RECOVERABLE_FAILURE", [...flat, `BASE_UNAVAILABLE:${o.remote}/${safeBaseEcho(o.baseBranch)}`], extras);

  // Claim loop: a lost race (or held lease) falls through to the next selectable task.
  const lost = [];
  const sessionId = `${o.owner}:${process.pid}:${crypto.randomUUID()}`;
  const pushFailed = [];
  const next = id => { env.claimedHeads.add(claimBranchOf(id)); return select(tasks, env).chosen; };
  const releaseGrant = (lid, grant) => { if (grant) { try { quiet(() => leaseApi.release(store, {...lid, token: grant.token})); } catch { /* best effort */ } } };
  let chosen = first;
  for (let guard = 0; guard <= tasks.length && chosen; guard++) {
    const id = chosen.id, br = claimBranchOf(id), ref = `refs/heads/${br}`;
    const inHist = claimInBaseHistory(git, baseSha, id);
    if (inHist !== false) {
      const code = inHist === null ? "CLAIM_HISTORY_CHECK_FAILED" : "CLAIM_IN_BASE_HISTORY";
      lost.push(`${id}:${code}`); chosen = skipNext(id, code); continue;
    }
    const lid = {taskId: id, environment: "CLOUD", workerId: o.owner, sessionId};
    let leaseInfo = {status: "SKIPPED"}, grant = null;
    if (store) {
      leaseFlag.unavail = false;
      try {
        const g = quiet(() => leaseApi.claim(store, {...lid, headSha: baseSha, now: Date.now(), ttlMs: Math.max(o.staleHours, 0.001) * 36e5}));
        const gs = g.status, rec = g.record;
        if (gs === "GRANTED") {
          grant = rec;
          leaseInfo = {status: "GRANTED"};
          const tok = rec?.token, ep = rec?.epoch;
          if (isStr(tok) && TOKEN_RE.test(tok)) leaseInfo.token = tok;
          if (Number.isSafeInteger(ep)) leaseInfo.epoch = ep;
        } else if (gs === "HELD") {
          leaseInfo = {status: "HELD"};
          if (leaseFlag.unavail) {
            // Lease write failed and nothing is readable: if the lease ref does not exist on the remote, the store is unavailable
            // (e.g. server rejects refs/uasco/*), NOT held by someone else. Fail-safe: the branch-ref claim is the arbiter.
            const lr = git(["ls-remote", o.remote, `refs/uasco/claims/${id}`]);
            if (leaseCheckFailed(lr)) leaseInfo = {status: "LEASE_CHECK_FAILED"};
            else if (leaseRefAbsent(lr)) leaseInfo = {status: "LEASE_STORE_UNAVAILABLE"};
          }
        } else leaseInfo = {status: "LEASE_ERROR_UNKNOWN_STATUS"}; // any other value: fail closed; nothing obtained, nothing released
      } catch (e) {
        // Same ls-remote gating as above: only a SUCCESSFUL empty ls-remote means "store unavailable"; a failed one is fail-closed,
        // and a lease ref that exists (unreadable here) is treated as held. The error text is untrusted: only a LEASE_ERROR:<CODE> classification is reported.
        releaseGrant(lid, grant); grant = null; // an exception after a grant was obtained: give it back (only what we obtained)
        const why = leaseErrorCode(e);
        let lr = null; try { lr = git(["ls-remote", o.remote, `refs/uasco/claims/${id}`]); } catch { /* stays null => check failed */ }
        leaseInfo = leaseCheckFailed(lr) ? {status: "LEASE_CHECK_FAILED", error: why}
          : leaseRefAbsent(lr) ? {status: "LEASE_STORE_UNAVAILABLE", error: why} : {status: "HELD", error: why};
      }
      if (leaseInfo.status === "LEASE_ERROR_UNKNOWN_STATUS") { lost.push(`${id}:LEASE_ERROR:UNKNOWN`); chosen = skipNext(id, "LEASE_ERROR:UNKNOWN"); continue; }
      if (leaseInfo.status === "LEASE_STORE_UNAVAILABLE") lost.push(`${id}:LEASE_STORE_UNAVAILABLE`);
      if (leaseInfo.status === "LEASE_CHECK_FAILED") { lost.push(`${id}:LEASE_CHECK_FAILED`); chosen = skipNext(id, "LEASE_CHECK_FAILED"); continue; }
      if (leaseInfo.status === "HELD") { lost.push(`${id}:LEASE_HELD`); chosen = skipNext(id, "LEASE_HELD"); continue; }
    }
    const msg = `${CLAIM_SUBJECT} ${id} owner=${o.owner} at=${new Date().toISOString()} nonce=${crypto.randomUUID()}`;
    const ident = {GIT_AUTHOR_NAME: "dispatch", GIT_AUTHOR_EMAIL: "dispatch@invalid", GIT_COMMITTER_NAME: "dispatch", GIT_COMMITTER_EMAIL: "dispatch@invalid"};
    const c = git(["commit-tree", `${baseSha}^{tree}`, "-p", baseSha, "-m", msg], undefined, ident);
    if (c.status !== 0) { releaseGrant(lid, grant); return fin("RECOVERABLE_FAILURE", [...flat, ...lost, `${id}:CLAIM_COMMIT_FAILED`], extras); }
    const sha = c.stdout.trim();
    // create-only: --force-with-lease=<ref>: (empty expectation) means "ref must not exist".
    const p = git(["push", "--quiet", o.remote, `${sha}:${ref}`, `--force-with-lease=${ref}:`]);
    let ours = p.status === 0, again = null;
    if (!ours) {
      // A non-zero status does not prove the push failed (the ref may have been created before the client died/hook/network error): re-list.
      again = remoteHeads(git, o.remote);
      if (again && again.get(br) === sha) { ours = true; pushFailed.push(`${id}:PUSH_STATUS_NONZERO_CLAIM_VERIFIED`); }
    }
    if (ours) {
      return fin("START", [...flat, ...lost, ...pushFailed], {...extras, taskId: id, branch: br, claimRef: ref, claimSha: sha, baseSha, claimed: true, lease: leaseInfo});
    }
    releaseGrant(lid, grant);
    if (!again) return fin("RECOVERABLE_FAILURE", [...flat, ...lost, ...pushFailed, `${id}:PUSH_FAILED_REMOTE_UNREACHABLE`], extras);
    if (!again.has(br)) {
      // Non-race failure for this task only (e.g. hook rejection, ref conflict): record and continue with the next task.
      pushFailed.push(`${id}:PUSH_FAILED:${pushFailReason(p.stderr)}`);
      chosen = skipNext(id, "PUSH_FAILED");
      continue;
    }
    lost.push(`${id}:CLAIM_RACE_LOST`);
    for (const k of again.keys()) { env.remoteHeads.add(k); if (k.startsWith("claude/")) env.claimedHeads.add(k); }
    chosen = next(id);
  }
  return fin("NO_ACTION", [...flat, ...lost, ...pushFailed], extras);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = await run(process.argv.slice(2)); } catch { r = {exit: EXIT.RECOVERABLE_FAILURE, line: internalLine(process.argv.slice(2))}; }
  process.stdout.write(r.line + "\n");
  process.exitCode = r.exit;
}
