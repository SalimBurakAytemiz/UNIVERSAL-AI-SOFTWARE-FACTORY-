// //TR: Bu betik Cloud-only deterministik sonraki-görev dağıtıcısıdır: BACKLOG_CHECKPOINT.json'u fail-closed doğrular, ilk seçilebilir görevi seçer ve --claim ile git branch-ref (create-only) üzerinden talep eder; bu, birleştirilmiş atomik lease ya da FA-LEASE2 bağlantısı DEĞİLDİR (bkz. DISPATCH.md).
// Usage: node docs/planning/dispatch.mjs [--claim] [--owner <id>] [--backlog <path>] [--remote <name>] [--base-branch <b>] [--stale-hours <n>] [--open-prs a,b] [--no-lease]
// Exit: 0 START|NO_ACTION, 2 BLOCKED, 3 RECOVERABLE_FAILURE. Prints exactly one JSON line on stdout.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CLAIM_SUBJECT = "dispatch-claim:";
export const EXIT = {START: 0, NO_ACTION: 0, BLOCKED: 2, RECOVERABLE_FAILURE: 3};

const isStr = v => typeof v === "string";
const nonEmpty = v => isStr(v) && v.trim() !== "";
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

class Blocked extends Error { constructor(code) { super(code); this.code = code; } }

export function parseArgs(argv) {
  const o = {claim: false, owner: "cloud-dispatch", backlog: "docs/planning/BACKLOG_CHECKPOINT.json", remote: "origin",
    baseBranch: "v7/integration", staleHours: 6, openPrs: [], lease: true};
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
    else if (a === "--open-prs") o.openPrs = val(i++, a).split(",").map(s => s.trim()).filter(Boolean);
    else throw new Blocked(`ARG_UNKNOWN:${a}`);
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
      if (seen.has(k)) throw new Blocked(`BACKLOG_DUPLICATE_ID:${t.id}`);
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
  if (t.status !== "READY") r.push(`NOT_READY:${isStr(t.status) ? t.status : "malformed"}`);
  if (t.owner !== "CLOUD") r.push(`OWNER_NOT_CLOUD:${isStr(t.owner) ? t.owner : "malformed"}`);
  if (!nonEmpty(t.authorizedBy)) r.push("NO_AUTHORIZED_BY");
  if (!Array.isArray(t.dependsOn) || !t.dependsOn.every(nonEmpty)) r.push("MALFORMED_DEPENDS_ON");
  else for (const d of t.dependsOn) {
    const dep = env.tasks.find(x => x && isStr(x.id) && x.id === d);
    if (!dep || dep.status !== "DONE") r.push(`UNMET_DEP:${d}`);
  }
  if (t.protectedEdit !== undefined && t.protectedEdit !== false) r.push(t.protectedEdit === true ? "PROTECTED_EDIT" : "MALFORMED_PROTECTED_EDIT");
  if (t.requiresNewAuthority !== undefined && t.requiresNewAuthority !== false) r.push(t.requiresNewAuthority === true ? "REQUIRES_NEW_AUTHORITY" : "MALFORMED_REQUIRES_NEW_AUTHORITY");
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
    if (b !== cb && env.remoteHeads.has(b)) r.push(`BRANCH_EXISTS:${b}`);
    if (env.openPrs.has(b)) r.push(`OPEN_PR:${b}`);
  }
  return r;
}

export function select(tasks, env) {
  const perTask = [];
  let chosen = null;
  for (const t of tasks) {
    const reasons = evaluateTask(t, env);
    const id = t && isStr(t.id) ? t.id : null;
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
  for (const l of r.stdout.split("\n")) { const p = l.trim().split(/\s+/); if (p.length === 2 && p[1].startsWith("refs/heads/")) m.set(p[1].slice(11), p[0]); }
  return m;
}

// Stale = claim ref exists, only dispatch-claim commits beyond base, newest such commit (else lease acquiredAt) older than staleHours, not in open PRs.
function staleReport(git, remote, baseSha, claimed, openPrs, staleHours, readLease, now) {
  const out = [];
  for (const {taskId, branch, sha} of claimed) {
    const claimRef = `refs/heads/${branch}`;
    if (openPrs.has(branch)) { out.push({taskId, claimRef, state: "OPEN_PR"}); continue; }
    if (!baseSha) { out.push({taskId, claimRef, state: "UNKNOWN", why: "BASE_UNAVAILABLE"}); continue; }
    if (git(["cat-file", "-e", `${sha}^{commit}`]).status !== 0 && git(["fetch", "--no-tags", remote, claimRef]).status !== 0) {
      out.push({taskId, claimRef, state: "UNKNOWN", why: "CLAIM_REF_NOT_FETCHABLE"}); continue;
    }
    const l = git(["log", "--format=%ct%x09%s", `${baseSha}..${sha}`]);
    if (l.status !== 0) { out.push({taskId, claimRef, state: "UNKNOWN", why: "LOG_FAILED"}); continue; }
    const rows = l.stdout.split("\n").filter(Boolean).map(x => x.split("\t"));
    if (rows.some(r => !(r[1] || "").startsWith(CLAIM_SUBJECT))) { out.push({taskId, claimRef, state: "HAS_WORK_COMMITS"}); continue; }
    // A claim commit that changed the tree is not a pure claim, whatever its subject says.
    const tc = git(["rev-parse", `${sha}^{tree}`]), tb = git(["rev-parse", `${baseSha}^{tree}`]);
    if (tc.status !== 0 || tb.status !== 0) { out.push({taskId, claimRef, state: "UNKNOWN", why: "TREE_COMPARE_FAILED"}); continue; }
    if (tc.stdout.trim() !== tb.stdout.trim()) { out.push({taskId, claimRef, state: "HAS_WORK_COMMITS", why: "TREE_DIFFERS_FROM_BASE"}); continue; }
    let ageMs = null, extra = null;
    if (rows.length) ageMs = now - Math.max(...rows.map(r => Number(r[0]))) * 1000;
    else { const le = readLease(taskId); if (le && Number.isFinite(le.acquiredAt)) { ageMs = now - le.acquiredAt; extra = "age from lease acquiredAt"; } }
    if (ageMs === null || !Number.isFinite(ageMs)) { out.push({taskId, claimRef, state: "UNKNOWN", why: "CLAIM_AGE_UNKNOWN"}); continue; }
    if (ageMs < 0) { out.push({taskId, claimRef, state: "UNKNOWN", why: "CLAIM_AGE_NEGATIVE_FUTURE_DATED"}); continue; }
    const ageHours = Math.round(ageMs / 36e5 * 100) / 100;
    out.push(ageMs > staleHours * 36e5
      ? {taskId, claimRef, state: "RECLAIMABLE", ageHours, note: "reported only; never auto-deleted; an operator must delete the ref", ...(extra ? {extra} : {})}
      : {taskId, claimRef, state: "FRESH", ageHours});
  }
  return out;
}

// Pure decision: the lease store is "unavailable" (not held) ONLY when ls-remote SUCCEEDED and printed nothing.
// A failed ls-remote (non-zero status) proves nothing about the ref, so it stays fail-closed.
export const leaseRefAbsent = lr => !!lr && lr.status === 0 && String(lr.stdout ?? "").trim() === "";
export const leaseCheckFailed = lr => !lr || lr.status !== 0;

// Redact URLs and filesystem/remote paths from a git stderr fragment.
export const redactRemote = t => String(t)
  .replace(/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, "<url>")
  .replace(/\b[\w.-]+@[\w.-]+:\S+/g, "<url>")
  .replace(/[A-Za-z]:[\\/][^\s'")]+/g, "<path>")
  .replace(/(^|[\s'"(=])((?:\.{1,2})?\/[^\s'")]+)/g, "$1<path>");
// Reason text for a failed push: prefer "remote: ..." and "! [remote rejected]" lines, else the last stderr line.
export function pushFailReason(stderr) {
  const lines = String(stderr ?? "").split("\n").map(x => x.trim()).filter(Boolean);
  const pick = lines.filter(x => /^remote:/.test(x) || /^!\s*\[remote rejected\]/.test(x));
  const txt = (pick.length ? pick.join(" | ") : (lines.at(-1) ?? "unknown")).replace(/\s+/g, " ");
  return redactRemote(txt).slice(0, 240);
}

function fin(outcome, reasons, extra = {}) {
  const out = {outcome, taskId: null, branch: null, claimRef: null, reasons, ...extra};
  return {outcome, exit: EXIT[outcome], line: JSON.stringify(out)};
}

export async function run(argv, cwd = process.cwd()) {
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

  // Lease modules are imported read-only; a load failure only disables the optional lease record.
  let leaseApi = null, store = null;
  const leaseFlag = {unavail: false};
  if (o.lease) {
    try {
      const top = git(["rev-parse", "--show-toplevel"]).stdout.trim();
      const base = top && fs.existsSync(path.join(top, "automation/lib/task-lease.mjs")) ? top : path.resolve(HERE, "../..");
      leaseApi = await import(pathToFileURL(path.join(base, "automation/lib/task-lease.mjs")).href);
      const S = await import(pathToFileURL(path.join(base, "automation/lib/task-lease-git-store.mjs")).href);
      const raw = S.createRemoteRefStore({runGit: git, remote: o.remote});
      // Observe the store's fail-closed "created:false, current:null" (write rejected / unreadable) signal.
      store = {...raw, createIfAbsent: (id, rec) => { const c = raw.createIfAbsent(id, rec); if (!c.created && !c.current) leaseFlag.unavail = true; return c; }};
    } catch { leaseApi = null; store = null; }
  }
  const readLease = id => { try { return store ? store.read(id) : null; } catch { return null; } };

  let baseSha = heads.get(o.baseBranch) ?? null;
  if (baseSha && git(["cat-file", "-e", `${baseSha}^{commit}`]).status !== 0) {
    git(["fetch", "--no-tags", o.remote, `refs/heads/${o.baseBranch}`]);
    if (git(["cat-file", "-e", `${baseSha}^{commit}`]).status !== 0) baseSha = null;
  }
  const claimedList = [];
  for (const t of tasks) {
    if (!t || !validId(t.id) || t.status !== "READY") continue;
    const b = claimBranchOf(t.id);
    if (claimedHeads.has(b)) claimedList.push({taskId: t.id, branch: b, sha: heads.get(b)});
  }
  const reclaimable = staleReport(git, o.remote, baseSha, claimedList, env.openPrs, o.staleHours, readLease, Date.now());
  for (const r of reclaimable) if (r.state === "RECLAIMABLE") flat.push(`${r.taskId}:RECLAIMABLE`);
  const extras = {perTask, reclaimable, mode: o.claim ? "CLAIM" : "DRY_RUN", owner: o.owner};

  if (!first) return fin("NO_ACTION", flat.length ? flat : ["EMPTY_BACKLOG"], extras);
  if (!o.claim) return fin("START", flat, {...extras, taskId: first.id, branch: claimBranchOf(first.id), claimRef: `refs/heads/${claimBranchOf(first.id)}`, claimed: false});
  if (!baseSha) return fin("RECOVERABLE_FAILURE", [...flat, `BASE_UNAVAILABLE:${o.remote}/${o.baseBranch}`], extras);

  // Claim loop: a lost race (or held lease) falls through to the next selectable task.
  const lost = [];
  const sessionId = `${o.owner}:${process.pid}:${crypto.randomUUID()}`;
  const pushFailed = [];
  const skipNext = (id, reason) => { env.skip.set(id, reason); return select(tasks, env).chosen; };
  const next = id => { env.claimedHeads.add(claimBranchOf(id)); return select(tasks, env).chosen; };
  const releaseGrant = (lid, grant) => { if (grant) { try { leaseApi.release(store, {...lid, token: grant.token}); } catch { /* best effort */ } } };
  let chosen = first;
  for (let guard = 0; guard <= tasks.length && chosen; guard++) {
    const id = chosen.id, br = claimBranchOf(id), ref = `refs/heads/${br}`;
    const lid = {taskId: id, environment: "CLOUD", workerId: o.owner, sessionId};
    let leaseInfo = {status: "SKIPPED"}, grant = null;
    if (store) {
      leaseFlag.unavail = false;
      try {
        const g = leaseApi.claim(store, {...lid, headSha: baseSha, now: Date.now(), ttlMs: Math.max(o.staleHours, 0.001) * 36e5});
        leaseInfo = {status: g.status, token: g.record?.token ?? null, epoch: g.record?.epoch ?? null};
        if (g.status === "GRANTED") grant = g.record;
        else if (g.status === "HELD" && leaseFlag.unavail) {
          // Lease write failed and nothing is readable: if the lease ref does not exist on the remote, the store is unavailable
          // (e.g. server rejects refs/uasco/*), NOT held by someone else. Fail-safe: the branch-ref claim is the arbiter.
          const lr = git(["ls-remote", o.remote, `refs/uasco/claims/${id}`]);
          if (leaseCheckFailed(lr)) leaseInfo = {status: "LEASE_CHECK_FAILED"};
          else if (leaseRefAbsent(lr)) leaseInfo = {status: "LEASE_STORE_UNAVAILABLE", token: null, epoch: null};
        }
      } catch (e) { leaseInfo = {status: "LEASE_STORE_UNAVAILABLE", error: String(e.message).slice(0, 120)}; }
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
    if (p.status === 0) {
      return fin("START", [...flat, ...lost, ...pushFailed], {...extras, taskId: id, branch: br, claimRef: ref, claimSha: sha, baseSha, claimed: true, lease: leaseInfo});
    }
    releaseGrant(lid, grant);
    const again = remoteHeads(git, o.remote);
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
  const r = await run(process.argv.slice(2));
  process.stdout.write(r.line + "\n");
  process.exitCode = r.exit;
}
