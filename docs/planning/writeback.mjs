// //TR: Bu betik birleştirilmiş görevleri yalnızca git soyağacından (ls-remote/fetch/merge-base --is-ancestor/log) kanıtlayıp backlog'da DONE yapar; fail-closed, GitHub API yok, varsayılan kuru çalıştırma (bkz. DISPATCH.md).
// Usage: node docs/planning/writeback.mjs [--backlog <path>] [--remote origin] [--base-branch v7/integration] [--write]
// Exit: 0 CHANGES|NO_CHANGES, 3 RECOVERABLE_FAILURE. Prints exactly one JSON line on stdout.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {claimBranchOf, validId, safeId, safeStatus, refNameOk, loadBacklog, capReason} from "./dispatch.mjs";

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,200}$/;
const CLAIM_SUBJECT = "dispatch-claim:";
const CANDIDATE = new Set(["READY", "IN_PROGRESS", "IN_REVIEW"]);
export const EXIT = {CHANGES: 0, NO_CHANGES: 0, RECOVERABLE_FAILURE: 3};

const isStr = v => typeof v === "string";
class Fail extends Error { constructor(code) { super(code); this.code = code; } }

// Pure core. probe = {baseSha, headOf(branch)->sha|undefined, hasWork(branch, task)->true|false|null (null = no claim commit found), merged(branch, sha)->bool}.
// Never mutates tasks. Rule (all must hold): status READY|IN_PROGRESS|IN_REVIEW, branch exists, real work commit, head ancestor of base tip.
export function computeWriteback(tasks, probe) {
  const changes = [], reasons = [];
  for (const t of tasks) {
    if (!t || typeof t !== "object" || Array.isArray(t) || !CANDIDATE.has(t.status)) continue;
    if (!validId(t.id)) { reasons.push("?:MALFORMED_ID"); continue; }
    const id = safeId(t.id), tag = c => reasons.push(`${id}:${c}`);
    let branch = claimBranchOf(t.id);
    if (t.branch !== undefined) { if (isStr(t.branch) && t.branch.trim() !== "" && refNameOk(t.branch.trim())) branch = t.branch.trim(); else { tag("MALFORMED_BRANCH"); continue; } }
    const head = probe.headOf(branch);
    if (!head || !SHA_RE.test(head)) { tag("NO_BRANCH"); continue; }
    const work = probe.hasWork(branch, t);
    if (work === null) { tag("NO_CLAIM_COMMIT"); continue; }
    if (!work) { tag("NO_WORK_COMMITS"); continue; }
    if (!probe.merged(branch, head)) { tag("NOT_MERGED"); continue; }
    if (t.notes !== undefined && !isStr(t.notes)) { tag("NOTES_MALFORMED"); continue; }
    changes.push({taskId: t.id, from: t.status, to: "DONE", branchHead: head});
  }
  return {changes, reasons};
}

export const noteFor = (date, baseBranch, head, baseSha) => `Write-back ${date}: merged into ${baseBranch} (branch head ${head.slice(0, 7)} ancestor of ${baseSha.slice(0, 7)})`;

// Applies changes to the parsed doc (only status + appended notes); returns the canonical text. Other tasks stay byte-identical.
export function applyChanges(doc, changes, note) {
  for (const c of changes) {
    const t = doc.tasks.find(x => x && x.id === c.taskId);
    t.status = "DONE";
    t.notes = isStr(t.notes) && t.notes !== "" ? `${t.notes} ${note(c)}` : note(c);
  }
  return JSON.stringify(doc, null, 2) + "\n";
}

export function parseArgs(argv) {
  const o = {backlog: "docs/planning/BACKLOG_CHECKPOINT.json", remote: "origin", baseBranch: "v7/integration", write: false};
  const val = (i, f) => { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Fail(`ARG_MISSING_VALUE:${f}`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") o.write = true;
    else if (a === "--backlog") o.backlog = val(i++, a);
    else if (a === "--remote") o.remote = val(i++, a);
    else if (a === "--base-branch") o.baseBranch = val(i++, a);
    else throw new Fail(`ARG_UNKNOWN:${/^--?[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(a) ? a : "?"}`);
  }
  if (!NAME_RE.test(o.remote)) throw new Fail("ARG_INVALID:--remote");
  if (!REF_RE.test(o.baseBranch) || o.baseBranch.includes("..") || o.baseBranch.includes("_")) throw new Fail("ARG_INVALID:--base-branch");
  return o;
}

const gitIn = cwd => args => {
  const r = spawnSync("git", args, {cwd, encoding: "utf8", windowsHide: true, env: {...process.env, GIT_TERMINAL_PROMPT: "0"}});
  return {status: r.status ?? 1, stdout: r.stdout ?? ""};
};

function fin(outcome, reasons, extra = {}) {
  const out = {outcome, baseSha: null, changes: [], ...extra, reasons: reasons.map(capReason)};
  return {outcome, exit: EXIT[outcome], line: JSON.stringify(out)};
}

export async function run(argv, cwd = process.cwd(), now = () => new Date()) {
  try { return runInner(argv, cwd, now); } catch (e) { return fin("RECOVERABLE_FAILURE", [e instanceof Fail ? e.code : "INTERNAL_ERROR"]); }
}

function runInner(argv, cwd, now) {
  const o = parseArgs(argv), git = gitIn(cwd), file = path.resolve(cwd, o.backlog);
  let tasks, raw;
  try { tasks = loadBacklog(file); } catch (e) { throw new Fail(isStr(e?.code) ? e.code : "BACKLOG_ERROR"); }
  raw = fs.readFileSync(file, "utf8");
  const ls = git(["ls-remote", "--heads", o.remote]);
  if (ls.status !== 0) throw new Fail("REMOTE_UNREACHABLE");
  const heads = new Map();
  for (const l of ls.stdout.split("\n")) {
    const i = l.indexOf("\t"), sha = l.slice(0, i), ref = l.slice(i + 1);
    if (i > 0 && SHA_RE.test(sha) && ref.startsWith("refs/heads/") && ref.length > 11) heads.set(ref.slice(11), sha);
  }
  const baseSha = heads.get(o.baseBranch);
  if (!baseSha) throw new Fail("BASE_UNAVAILABLE");
  // One fetch for the base tip and every candidate branch head, so the objects exist locally (no refs are written).
  const want = new Set([o.baseBranch]);
  for (const t of tasks) if (t && typeof t === "object" && CANDIDATE.has(t.status) && validId(t.id)) {
    const b = isStr(t.branch) && t.branch.trim() && refNameOk(t.branch.trim()) ? t.branch.trim() : claimBranchOf(t.id);
    if (heads.has(b)) want.add(b);
  }
  const f = git(["fetch", "--no-tags", "--no-write-fetch-head", o.remote, ...[...want].map(b => `refs/heads/${b}`)]);
  if (f.status !== 0) throw new Fail("FETCH_FAILED");
  const ok = (r, accept = [0]) => { if (!accept.includes(r.status)) throw new Fail("GIT_FAILED"); return r; };
  ok(git(["cat-file", "-e", `${baseSha}^{commit}`]));
  const probe = {
    baseSha,
    headOf: b => heads.get(b),
    // Real work = non-merge commits on the branch's first-parent chain above this task's own claim commit(s) that are not themselves claim commits.
    hasWork(b, t) {
      const h = heads.get(b);
      const c = ok(git(["log", "--first-parent", "--fixed-strings", `--grep=${CLAIM_SUBJECT} ${t.id} `, "--format=%H%x09%s", h]));
      const claims = c.stdout.split("\n").filter(Boolean).map(x => x.split("\t")).filter(r => SHA_RE.test(r[0]) && (r[1] ?? "").startsWith(`${CLAIM_SUBJECT} ${t.id} `)).map(r => r[0]);
      if (!claims.length) return null;
      const l = ok(git(["log", "--first-parent", "--no-merges", "--format=%H%x09%s", h, "--not", ...claims]));
      return l.stdout.split("\n").filter(Boolean).some(x => !(x.split("\t")[1] ?? "").startsWith(CLAIM_SUBJECT));
    },
    merged: (b, h) => ok(git(["merge-base", "--is-ancestor", h, baseSha]), [0, 1]).status === 0,
  };
  const {changes, reasons} = computeWriteback(tasks, probe);
  let written = false;
  if (changes.length && o.write) {
    const doc = JSON.parse(raw);
    if (JSON.stringify(doc, null, 2) + "\n" !== raw) throw new Fail("BACKLOG_FORMAT_NOT_CANONICAL");
    const date = now().toISOString().slice(0, 10);
    const text = applyChanges(doc, changes, c => noteFor(date, o.baseBranch, c.branchHead, baseSha));
    const tmp = `${file}.writeback-${process.pid}.tmp`;
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
    written = true;
  }
  return fin(changes.length ? "CHANGES" : "NO_CHANGES", reasons, {baseSha, changes: changes.map(c => ({...c, taskId: safeId(c.taskId), from: safeStatus(c.from)})), mode: o.write ? "WRITE" : "DRY_RUN", written});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await run(process.argv.slice(2));
  process.stdout.write(r.line + "\n");
  process.exitCode = r.exit;
}
