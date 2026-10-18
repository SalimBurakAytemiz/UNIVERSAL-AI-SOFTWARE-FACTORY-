// //TR: Bu betik dispatch.mjs için gerçek git ref'leriyle (geçici bare remote + klonlar) çalışan kanıttır: START, otomatik ilerleme, çift süreçli yarış, bozuk alanların fail-closed reddi, BLOCKED/NO_ACTION, bayat claim RECLAIMABLE raporu, düşman id'ler, D/F ref çakışması, lease-store reddi, yarış dışı push hatası ve 8 süreçli yarış (gerçek backlog kontrolü isteğe bağlıdır, yoksa SKIPPED).
// Run: node docs/planning/dispatch.proof.mjs   (needs git + Node >= 22; creates and removes temp dirs only)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISPATCH = path.join(HERE, "dispatch.mjs");
const REPO_ROOT = path.resolve(HERE, "../..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-proof-"));
let failures = 0, n = 0;
const check = (name, cond, detail = "") => { n++; if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? " :: " + detail : ""}`); };

const G = (cwd, args, env = {}) => {
  const r = spawnSync("git", args, {cwd, encoding: "utf8", env: {...process.env, GIT_AUTHOR_NAME: "p", GIT_AUTHOR_EMAIL: "p@x", GIT_COMMITTER_NAME: "p", GIT_COMMITTER_EMAIL: "p@x", ...env}});
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};
let seq = 0;
function mkEnv(tasks, backlogRaw) {
  const dir = path.join(tmpRoot, `env${++seq}`), bare = path.join(dir, "remote.git"), work = path.join(dir, "work");
  fs.mkdirSync(dir); G(dir, ["init", "--bare", "-q", "-b", "v7/integration", bare]);
  G(dir, ["clone", "-q", bare, work]); G(work, ["checkout", "-q", "-b", "v7/integration"]);
  fs.mkdirSync(path.join(work, "docs/planning"), {recursive: true});
  const bl = path.join(work, "docs/planning/BACKLOG_CHECKPOINT.json");
  if (backlogRaw !== null) fs.writeFileSync(bl, backlogRaw ?? JSON.stringify({tasks}));
  fs.writeFileSync(path.join(work, "README"), "x"); G(work, ["add", "-A"]); G(work, ["commit", "-q", "-m", "base"]);
  G(work, ["push", "-q", "origin", "v7/integration"]);
  return {dir, bare, work, bl};
}
const T = (id, extra = {}) => ({id, status: "READY", owner: "CLOUD", authorizedBy: "FOUNDER:test", dependsOn: [], protectedEdit: false, requiresNewAuthority: false, ...extra});
const heads = bare => G(bare, ["for-each-ref", "--format=%(refname)", "refs/heads/claude/"]).split("\n").filter(Boolean);
const dispatchSync = (cwd, args, env) => {
  const r = spawnSync("node", [DISPATCH, ...args], {cwd, encoding: "utf8", ...(env ? {env: {...process.env, ...env}} : {})});
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let j = null; try { j = JSON.parse(line); } catch { /* keep null */ }
  return {code: r.status, j, raw: r.stdout, err: r.stderr};
};
const dispatchAsync = (cwd, args) => new Promise(res => {
  const c = spawn("node", [DISPATCH, ...args], {cwd}); let out = "";
  c.stdout.on("data", d => out += d); c.on("close", code => { let j = null; try { j = JSON.parse(out.trim().split("\n").pop()); } catch { /* null */ } res({code, j, raw: out}); });
});

console.log(`node ${process.version}`);
// 1. START picks first selectable (skips earlier unselectable) + auto-advance sequence.
{
  const e = mkEnv([T("T-0", {status: "DRAFT_NOT_READY"}), T("T-1"), T("T-2"), T("T-3")]);
  const seqIds = [];
  const dry = dispatchSync(e.work, ["--backlog", e.bl]);
  check("dry-run selects first selectable T-1 without claiming", dry.j?.outcome === "START" && dry.j.taskId === "T-1" && dry.j.claimed === false && heads(e.bare).length === 0, dry.raw);
  for (const owner of ["cloud-a", "cloud-b", "cloud-a", "cloud-b"]) {
    const r = dispatchSync(e.work, ["--claim", "--owner", owner, "--backlog", e.bl]);
    seqIds.push(r.j?.taskId ?? r.j?.outcome);
    if (seqIds.length === 1) check("--claim START creates refs/heads/claude/t-1", r.code === 0 && r.j.outcome === "START" && r.j.claimRef === "refs/heads/claude/t-1" && heads(e.bare).includes("refs/heads/claude/t-1"), r.raw);
    if (seqIds.length === 1) check("lease recorded through task-lease module (refs/uasco/claims/T-1)", r.j.lease?.status === "GRANTED" && G(e.bare, ["for-each-ref", "refs/uasco/claims/"]).includes("refs/uasco/claims/T-1"), JSON.stringify(r.j.lease));
    if (seqIds.length === 1) {
      const blob = G(e.bare, ["cat-file", "blob", G(e.bare, ["rev-parse", "refs/uasco/claims/T-1"])]);
      check("lease sessionId contains a UUID", /"sessionId":"cloud-a:\d+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(blob), blob);
    }
  }
  console.log(`AUTO-ADVANCE SEQUENCE: ${seqIds.join(" -> ")}`);
  check("auto-advance T-1 -> T-2 -> T-3 -> NO_ACTION (alternating owners)", seqIds.join(",") === "T-1,T-2,T-3,NO_ACTION", seqIds.join(","));
  const last = dispatchSync(e.work, ["--backlog", e.bl]);
  check("NO_ACTION lists ALREADY_CLAIMED reasons", last.j.outcome === "NO_ACTION" && last.j.reasons.includes("T-1:ALREADY_CLAIMED") && last.j.reasons.includes("T-0:NOT_READY:DRAFT_NOT_READY"), last.raw);
}
// 2. Race: two concurrent child processes, repeated rounds.
for (const mode of [[], ["--no-lease"]]) {
  let bad = 0;
  const rounds = 6;
  for (let i = 0; i < rounds; i++) {
    const one = mkEnv([T("R-1")]);
    const rs = await Promise.all(["w1", "w2"].map(o => dispatchAsync(one.work, ["--claim", "--owner", o, "--backlog", one.bl, ...mode])));
    const starts = rs.filter(r => r.j?.outcome === "START"), none = rs.filter(r => r.j?.outcome === "NO_ACTION");
    if (!(starts.length === 1 && none.length === 1 && heads(one.bare).length === 1)) { bad++; console.log("  race anomaly:", rs.map(r => r.raw.trim()).join(" | ")); }
    const two = mkEnv([T("R-1"), T("R-2")]);
    const rs2 = await Promise.all(["w1", "w2"].map(o => dispatchAsync(two.work, ["--claim", "--owner", o, "--backlog", two.bl, ...mode])));
    const ids = rs2.filter(r => r.j?.outcome === "START").map(r => r.j.taskId).sort();
    if (!(ids.length === 2 && ids[0] === "R-1" && ids[1] === "R-2" && heads(two.bare).length === 2)) { bad++; console.log("  race anomaly (2 tasks):", rs2.map(r => r.raw.trim()).join(" | ")); }
  }
  check(`race ${mode.join(" ") || "(with lease)"}: ${rounds} rounds x (1 task/2 procs -> exactly 1 START; 2 tasks/2 procs -> distinct tasks)`, bad === 0, `${bad} anomalies`);
}
// 3. Malformed fields never selected.
{
  const bad = [
    T("M-DEPS", {dependsOn: "UI-1"}), T("M-PROT", {protectedEdit: "true"}), T("M-AUTH", {authorizedBy: "  "}), T("M-AUTHNUM", {authorizedBy: 5}),
    T("M-NEWAUTH", {requiresNewAuthority: "false"}), T("M-PROTTRUE", {protectedEdit: true}), T("M-NULLPROT", {protectedEdit: null}),
    T("M-DEP-UNMET", {dependsOn: ["NOPE"]}), T("M-OWNER", {owner: "LOCAL"}), T("M-STATUS", {status: "ready"}), T("M-BADID/../x"),
    T("M-BRANCH", {branch: "  "}), {id: "M-NOAUTH", status: "READY", owner: "CLOUD", dependsOn: []}, "not-an-object",
  ];
  const e = mkEnv(bad);
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  check("all malformed/unsafe tasks => NO_ACTION, nothing claimed", r.code === 0 && r.j.outcome === "NO_ACTION" && heads(e.bare).length === 0, r.raw);
  const want = ["M-DEPS:MALFORMED_DEPENDS_ON", "M-PROT:MALFORMED_PROTECTED_EDIT", "M-AUTH:NO_AUTHORIZED_BY", "M-NEWAUTH:MALFORMED_REQUIRES_NEW_AUTHORITY", "M-PROTTRUE:PROTECTED_EDIT", "M-NULLPROT:MALFORMED_PROTECTED_EDIT", "M-DEP-UNMET:UNMET_DEP:NOPE"];
  check("machine-readable reasons present per malformed task", want.every(w => r.j.reasons.includes(w)), JSON.stringify(r.j.reasons));
  const e2 = mkEnv([...bad, T("GOOD")]);
  const r2 = dispatchSync(e2.work, ["--claim", "--backlog", e2.bl]);
  check("only the well-formed task is selected among malformed ones", r2.j.outcome === "START" && r2.j.taskId === "GOOD", r2.raw);
  const e3 = mkEnv([T("D-1", {status: "DONE"}), T("D-2", {dependsOn: ["D-1"]}), T("D-3", {dependsOn: ["D-2"]})]);
  const r3 = dispatchSync(e3.work, ["--claim", "--backlog", e3.bl]);
  check("dependency chain: D-2 selected (D-1 DONE), D-3 blocked on D-2", r3.j.taskId === "D-2" && r3.j.reasons.includes("D-3:UNMET_DEP:D-2"), r3.raw);
  const e4 = mkEnv([T("B-1", {branch: "claude/b-1-work"}), T("B-2"), T("B-3")]);
  G(e4.work, ["push", "-q", "origin", "HEAD:refs/heads/claude/b-1-work"]);
  const r4 = dispatchSync(e4.work, ["--backlog", e4.bl, "--open-prs", "claude/b-3"]);
  check("existing task branch (B-1) and open PR (B-3) skipped; B-2 selected", r4.j.taskId === "B-2" && r4.j.reasons.includes("B-1:BRANCH_EXISTS:claude/b-1-work") && r4.j.reasons.includes("B-3:OPEN_PR:claude/b-3"), r4.raw);
}
// 4. BLOCKED paths.
{
  const e = mkEnv([], null);
  const r = dispatchSync(e.work, ["--backlog", e.bl]);
  check("missing backlog => BLOCKED exit 2", r.code === 2 && r.j?.outcome === "BLOCKED" && r.j.reasons[0] === "BACKLOG_MISSING", r.raw);
  const e2 = mkEnv([], "{not json");
  const r2 = dispatchSync(e2.work, ["--backlog", e2.bl]);
  check("unparseable backlog => BLOCKED exit 2", r2.code === 2 && r2.j.reasons[0] === "BACKLOG_UNPARSEABLE", r2.raw);
  const e3 = mkEnv([], JSON.stringify({tasks: "x"}));
  check("tasks not an array => BLOCKED exit 2", dispatchSync(e3.work, ["--backlog", e3.bl]).code === 2);
  const e4 = mkEnv([T("DUP"), T("dup")]);
  check("duplicate ids (case-insensitive) => BLOCKED exit 2", dispatchSync(e4.work, ["--backlog", e4.bl]).code === 2);
  check("unknown flag => BLOCKED exit 2", dispatchSync(e4.work, ["--bogus"]).code === 2);
  const e5 = mkEnv([T("X-1")]);
  const r5 = dispatchSync(e5.work, ["--backlog", e5.bl, "--remote", "nonexistent"]);
  check("unreachable remote => RECOVERABLE_FAILURE exit 3", r5.code === 3 && r5.j.outcome === "RECOVERABLE_FAILURE", r5.raw);
}
// 5. Stale claim => RECLAIMABLE, never deleted.
{
  const e = mkEnv([T("S-1"), T("S-2"), T("S-3"), T("S-4")]);
  const base = G(e.work, ["rev-parse", "HEAD"]), tree = G(e.work, ["rev-parse", "HEAD^{tree}"]);
  const old = Math.floor(Date.now() / 1000) - 10 * 3600, fresh = Math.floor(Date.now() / 1000) - 3600;
  const mk = (subj, ts) => G(e.work, ["commit-tree", tree, "-p", base, "-m", subj], {GIT_COMMITTER_DATE: `${ts} +0000`, GIT_AUTHOR_DATE: `${ts} +0000`});
  G(e.work, ["push", "-q", "origin", `${mk("dispatch-claim: S-1 owner=dead", old)}:refs/heads/claude/s-1`]);
  G(e.work, ["push", "-q", "origin", `${mk("dispatch-claim: S-2 owner=dead", old)}:refs/heads/claude/s-2`]);
  G(e.work, ["push", "-q", "origin", `${mk("real work", old)}:refs/heads/claude/s-3`]);
  G(e.work, ["push", "-q", "origin", `${mk("dispatch-claim: S-4 owner=ok", fresh)}:refs/heads/claude/s-4`]);
  const before = heads(e.bare).length;
  const r = dispatchSync(e.work, ["--backlog", e.bl, "--open-prs", "claude/s-2"]);
  const st = Object.fromEntries((r.j?.reclaimable ?? []).map(x => [x.taskId, x.state]));
  console.log(`  reclaimable report: ${JSON.stringify(r.j?.reclaimable)}`);
  check("stale S-1 REPORTED RECLAIMABLE; S-2 open-PR, S-3 has work, S-4 fresh not reclaimable", st["S-1"] === "RECLAIMABLE" && st["S-2"] === "OPEN_PR" && st["S-3"] === "HAS_WORK_COMMITS" && st["S-4"] === "FRESH", JSON.stringify(st));
  check("stale claim ref NOT auto-deleted and still blocks selection", heads(e.bare).length === before && r.j.outcome === "NO_ACTION" && r.j.reasons.includes("S-1:RECLAIMABLE") && r.j.reasons.includes("S-1:ALREADY_CLAIMED"), r.raw);
  const r2 = dispatchSync(e.work, ["--backlog", e.bl, "--stale-hours", "24"]);
  check("--stale-hours 24 => S-1 no longer reclaimable", r2.j.reclaimable.find(x => x.taskId === "S-1")?.state === "FRESH", r2.raw);
}
// 6. Fixture backlog (no READY CLOUD task) => NO_ACTION; real backlog check is OPTIONAL and reports SKIPPED when absent.
{
  const fixture = [T("F-1", {status: "DONE"}), T("F-2", {status: "DRAFT_NOT_READY"}), T("F-3", {owner: "LOCAL"}), T("F-4", {dependsOn: ["F-2"]})];
  const e = mkEnv(fixture);
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  check("fixture backlog with no selectable task => NO_ACTION, nothing claimed", r.code === 0 && r.j.outcome === "NO_ACTION" && heads(e.bare).length === 0, r.raw.slice(0, 400));
  const rr = spawnSync("git", ["show", "origin/v7/integration:docs/planning/BACKLOG_CHECKPOINT.json"], {cwd: REPO_ROOT, encoding: "utf8"});
  if (rr.status !== 0) console.log("SKIPPED real-backlog check (origin/v7/integration has no docs/planning/BACKLOG_CHECKPOINT.json); not counted as PASS");
  else {
    const e2 = mkEnv([], rr.stdout);
    const r2 = dispatchSync(e2.work, ["--backlog", e2.bl]);
    check("real backlog from origin/v7/integration evaluates without BLOCKED (dry-run)", r2.code === 0 && ["START", "NO_ACTION"].includes(r2.j?.outcome), r2.raw.slice(0, 300));
  }
}
// 7. Hostile ids and the a.LOCK queue-not-halted case.
{
  const hostile = ["a.LOCK", "master", "HEAD", "@{u}", "refs/heads/master", "../x", "a:b", "-x"];
  const e = mkEnv(hostile.map(id => T(id)));
  const claimed = [];
  for (let i = 0; i < 12; i++) { const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]); if (r.j?.outcome !== "START") break; claimed.push(r.j.claimRef); }
  const allHeads = G(e.bare, ["for-each-ref", "--format=%(refname)", "refs/heads/"]).split("\n").filter(Boolean).filter(h => h !== "refs/heads/v7/integration");
  const dry = dispatchSync(e.work, ["--backlog", e.bl]);
  console.log(`  hostile ids claimed: ${JSON.stringify(claimed)}`);
  check("hostile ids a.LOCK/@{u}/refs/heads/master/../x/a:b/-x => MALFORMED_ID, never pushed", ["a.LOCK", "@{u}", "refs/heads/master", "../x", "a:b", "-x"].every(id => dry.j.reasons.includes(`${id}:MALFORMED_ID`)), JSON.stringify(dry.j.reasons));
  check("only refs/heads/claude/{master,head} exist (no ref outside claude/ and no malformed ref)", allHeads.sort().join(",") === "refs/heads/claude/head,refs/heads/claude/master" && G(e.bare, ["for-each-ref", "refs/uasco/"]).split("\n").every(l => !/\.lock|@|\.\./i.test(l)), allHeads.join(","));
  const e2 = mkEnv([T("a.LOCK"), T("OK-1")]);
  const r2 = dispatchSync(e2.work, ["--claim", "--backlog", e2.bl]);
  check("a.LOCK does not halt the queue: OK-1 claimed, a.LOCK:MALFORMED_ID", r2.code === 0 && r2.j.outcome === "START" && r2.j.taskId === "OK-1" && r2.j.reasons.includes("a.LOCK:MALFORMED_ID"), r2.raw);
}
// 8. Directory/file ref conflict.
{
  const e = mkEnv([T("DF-1"), T("DF-2")]);
  G(e.work, ["push", "-q", "origin", "HEAD:refs/heads/claude/df-1/work"]);
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  check("claude/df-1/work exists => DF-1:REF_CONFLICT skipped, DF-2 still claimed", r.code === 0 && r.j.outcome === "START" && r.j.taskId === "DF-2" && r.j.reasons.includes("DF-1:REF_CONFLICT"), r.raw);
  const e2 = mkEnv([T("DF-3")]);
  G(e2.work, ["push", "-q", "origin", "HEAD:refs/heads/claude"]);
  const r2 = dispatchSync(e2.work, ["--claim", "--backlog", e2.bl]);
  check("head equal to prefix directory (claude) => REF_CONFLICT, nothing pushed", r2.j.outcome === "NO_ACTION" && r2.j.reasons.includes("DF-3:REF_CONFLICT"), r2.raw);
}
// 9. Lease store rejects refs/uasco/* (pre-receive hook): documented behaviour = branch-ref claim proceeds, lease.status LEASE_STORE_UNAVAILABLE.
const hookPath = bare => path.join(bare, "hooks/pre-receive");
const writeHook = (bare, body) => { fs.mkdirSync(path.join(bare, "hooks"), {recursive: true}); fs.writeFileSync(hookPath(bare), `#!/bin/sh\n${body}\n`, {mode: 0o755}); };
{
  const e = mkEnv([T("LS-1"), T("LS-2")]);
  writeHook(e.bare, 'while read o n r; do case "$r" in refs/uasco/*) echo "uasco rejected" >&2; exit 1;; esac; done; exit 0');
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  check("lease store write rejected => START with lease.status LEASE_STORE_UNAVAILABLE (not HELD/NO_ACTION)", r.code === 0 && r.j.outcome === "START" && r.j.taskId === "LS-1" && r.j.lease?.status === "LEASE_STORE_UNAVAILABLE" && r.j.claimed === true && heads(e.bare).includes("refs/heads/claude/ls-1") && r.j.reasons.includes("LS-1:LEASE_STORE_UNAVAILABLE"), r.raw);
}
// 10. Non-race push failure for one task continues the queue.
{
  const e = mkEnv([T("PF-1"), T("PF-2")]);
  writeHook(e.bare, 'while read o n r; do case "$r" in refs/heads/claude/pf-1) echo "pf-1 rejected" >&2; exit 1;; esac; done; exit 0');
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  check("push failure for PF-1 => PUSH_FAILED recorded, PF-2 claimed (queue not halted)", r.code === 0 && r.j.outcome === "START" && r.j.taskId === "PF-2" && r.j.reasons.some(x => x.startsWith("PF-1:PUSH_FAILED")) && heads(e.bare).join() === "refs/heads/claude/pf-2", r.raw);
  const e2 = mkEnv([T("PF-3")]);
  writeHook(e2.bare, 'while read o n r; do case "$r" in refs/heads/claude/*) exit 1;; esac; done; exit 0');
  const r2 = dispatchSync(e2.work, ["--claim", "--backlog", e2.bl]);
  check("only task fails to push with reachable remote => NO_ACTION with PUSH_FAILED (RECOVERABLE only when remote unreachable)", r2.code === 0 && r2.j.outcome === "NO_ACTION" && r2.j.reasons.some(x => x.startsWith("PF-3:PUSH_FAILED")), r2.raw);
}
// 10b. PUSH_FAILED reason is a closed-vocabulary CODE (the hook message is classified, never echoed).
{
  const e = mkEnv([T("PR-1")]);
  writeHook(e.bare, 'while read o n r; do case "$r" in refs/heads/claude/*) echo "policy: claude branches closed" >&2; exit 1;; esac; done; exit 0');
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  const reason = (r.j?.reasons ?? []).find(x => x.startsWith("PR-1:PUSH_FAILED")) ?? "";
  console.log(`  push-failed reason: ${reason}`);
  check("PUSH_FAILED reason is exactly PR-1:PUSH_FAILED:HOOK_DECLINED; hook text and paths not echoed", reason === "PR-1:PUSH_FAILED:HOOK_DECLINED" && !/closed|policy|:\/\/|\/tmp\/|remote\.git/.test(r.raw), r.raw);
}
// 10c. Failed ls-remote after a lease-store failure is fail-closed (LEASE_CHECK_FAILED, task skipped); only a successful empty ls-remote means unavailable.
{
  const mod = await import(path.join(HERE, "dispatch.mjs"));
  check("leaseRefAbsent: failed ls-remote => false; success+empty => true; success+output => false",
    mod.leaseRefAbsent({status: 128, stdout: "", stderr: "x"}) === false && mod.leaseRefAbsent({status: 0, stdout: "\n"}) === true && mod.leaseRefAbsent({status: 0, stdout: "abc\trefs/uasco/claims/X\n"}) === false && mod.leaseRefAbsent(null) === false);
  check("redactRemote is gone (nothing echoes remote text)", mod.redactRemote === undefined);
  const e = mkEnv([T("FC-1"), T("FC-2")]);
  writeHook(e.bare, 'while read o n r; do case "$r" in refs/uasco/*) echo "uasco rejected" >&2; exit 1;; esac; done; exit 0');
  // git wrapper on PATH: ls-remote of a lease ref fails (deterministic); everything else passes through.
  const real = spawnSync("sh", ["-c", "command -v git"], {encoding: "utf8"}).stdout.trim();
  const wdir = path.join(tmpRoot, "gitwrap"); fs.mkdirSync(wdir);
  fs.writeFileSync(path.join(wdir, "git"), `#!/bin/sh\nif [ "$1" = ls-remote ]; then for a in "$@"; do case "$a" in refs/uasco/claims/FC-1) echo "simulated ls-remote failure" >&2; exit 128;; esac; done; fi\nexec "${real}" "$@"\n`, {mode: 0o755});
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl], {PATH: `${wdir}${path.delimiter}${process.env.PATH}`});
  check("lease write rejected AND lease-ref ls-remote fails => FC-1:LEASE_CHECK_FAILED skipped (not LEASE_STORE_UNAVAILABLE), FC-1 branch not pushed", r.j?.reasons?.includes("FC-1:LEASE_CHECK_FAILED") && !r.j.reasons.includes("FC-1:LEASE_STORE_UNAVAILABLE") && !heads(e.bare).includes("refs/heads/claude/fc-1"), r.raw);
  check("queue continues after LEASE_CHECK_FAILED: FC-1 skipped, FC-2 claimed (START; its lease store is unavailable but its ls-remote succeeds)", r.code === 0 && r.j?.outcome === "START" && r.j.taskId === "FC-2" && heads(e.bare).join() === "refs/heads/claude/fc-2", r.raw);
}
// 10d. Closed-vocabulary classification: remote/hook/lease-module text is NEVER echoed; only a CODE from FAIL_CODES leaves the process.
// Token-like fixtures are assembled at runtime / escaped (fake values) so the repo secret scanner (scripts/secret-sanity.mjs, unchanged) does not flag this file.
{
  const mod = await import(path.join(HERE, "dispatch.mjs"));
  const V = new Set(mod.FAIL_CODES);
  check("closed vocabulary is exactly the documented set", mod.FAIL_CODES.join() === "NON_FAST_FORWARD,REF_CONFLICT_REMOTE,REF_LOCKED,PROTECTED_BRANCH,AUTH_FAILED,PERMISSION_DENIED,HOOK_DECLINED,NETWORK,REMOTE_REJECTED,UNKNOWN");
  const cls = [
    [" ! [rejected]        a -> b (non-fast-forward)\nerror: failed to push some refs", "NON_FAST_FORWARD"],
    [" ! [rejected]        a -> b (fetch first)", "NON_FAST_FORWARD"],
    ["remote: policy: claude branches closed\nTo /x/remote.git\n ! [remote rejected] sha -> claude/a (pre-receive hook declined)\nerror: failed to push some refs", "HOOK_DECLINED"],
    ["git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "PERMISSION_DENIED"],
    ["fatal: unable to access 'https://h/r.git/': Could not resolve host: h", "NETWORK"],
    ["fatal: Authentication failed for 'https://h/r.git/'", "AUTH_FAILED"],
    ["Password for 'https://bob@github.com': ", "AUTH_FAILED"],
    ["remote: error: GH006: Protected branch update failed for refs/heads/x", "PROTECTED_BRANCH"],
    ["error: cannot lock ref 'refs/heads/claude/a': is at aaa but expected bbb", "REF_LOCKED"],
    ["error: cannot lock ref 'refs/heads/claude/a/b': 'refs/heads/claude/a' exists; cannot create 'refs/heads/claude/a/b'", "REF_CONFLICT_REMOTE"],
    [" ! [remote rejected] a -> b (some server reason)", "REMOTE_REJECTED"],
    ["something entirely different", "UNKNOWN"], ["", "UNKNOWN"],
  ];
  const badCls = cls.filter(([t, c]) => mod.pushFailReason(t) !== c).map(([t, c]) => `${c}!=${mod.pushFailReason(t)}`);
  check(`classification: ${cls.length} stderr shapes map to their documented code`, badCls.length === 0, badCls.join(" ; "));
  check("unknown text => UNKNOWN; lease-module errors => LEASE_ERROR:<CODE>", mod.pushFailReason("zzz") === "UNKNOWN" && mod.leaseErrorCode(new Error("boom")) === "LEASE_ERROR:UNKNOWN" && mod.leaseErrorCode(new Error("Permission denied")) === "LEASE_ERROR:PERMISSION_DENIED" && mod.leaseErrorCode(null) === "LEASE_ERROR:UNKNOWN");
  const AWS40 = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const GH = "gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789", AK = "AK" + "IAIOSFODNN7EXAMPLE";
  // [stderr, secret substrings that must never appear in the JSON output line]
  const cases = [
    [`remote: token ${GH} bad`, [GH, "abcdefghijklmnop"]],
    ["remote: github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123 x", ["github_pat_11", "qrstuvwxyz0123"]],
    ["remote: glpat-abcdefghijklmnop1234 x", ["glpat-abcdef", "mnop1234"]],
    [`remote: ${AK} used`, [AK, "IOSFODNN7"]],
    ["remote: slack xoxb-123456789012-abcdefghijkl leaked", ["xoxb-1234", "abcdefghijkl"]],
    ["remote: Authorization: Bearer x", ["Bearer x"]],
    ["remote: Authorization: Bearer abc123secret", ["abc123secret"]],
    ["Proxy-Authorization: Basic cHJveHk6cHc=", ["cHJveHk6cHc"]],
    ["Cookie: session=SUPERSECRETCOOKIE; theme=dark", ["SUPERSECRETCOOKIE"]],
    ["remote: password is hunter2", ["hunter2"]],
    ["Password for 'https://bob@github.com': hunter2", ["hunter2", "bob@"]],
    ['remote: {"token":"abc123xyz"}', ["abc123xyz"]],
    ['remote: {"password": "p4ss w0rd", "pass":"qq9", "private_key":"PK-1", "sig":"SIG-1"}', ["p4ss w0rd", "qq9", "PK-1", "SIG-1"]],
    ["remote: pass=hunter2 pwd=hunter3 passphrase=hunter4 credential=hunter5 auth=hunter6", ["hunter2", "hunter3", "hunter4", "hunter5", "hunter6"]],
    ["remote: key=shortkey9 and uncommon-shape-ZQ81-secretvalue", ["shortkey9", "ZQ81", "secretvalue"]],
    ["remote: sk_" + "live_51Habcdefghijkl", ["51Habcdefghijkl", "sk_" + "live"]],
    ["remote: https://acct.blob.core.windows.net/c?sv=2020&sig=AzureSigValue%2Fabc%3D&se=2030", ["AzureSigValue", "acct.blob"]],
    ["remote: aws_secret_access_key = " + AWS40, [AWS40, "K7MDENG"]],
    ["fatal: unable to access 'https://user:pa55w0rd@example.com/o/r.git/'", ["pa55w0rd", "example.com"]],
    ["fatal: ssh://deploy:topsecret@host.example/r.git", ["topsecret", "host.example"]],
    ['remote: cannot open "/tmp/with space/repo.git" now', ["with space", "repo.git"]],
    ["remote: /srv/priv dir/with space/repo.git denied", ["priv dir", "with space"]],
    [`remote: spl${"it"} gh` + "p_abcdefghij" + " klmnopqrstuvwxyz0123456789 x", ["abcdefghij", "klmnopqrstuvwxyz"]],
    ["remote: gh\u200bp_abcdefghijklmnopqrstuvwxyz0123456789", ["abcdefghijklmnop"]],
    ["remote: pre\nremote: Authorization: Bearer NEWLINESECRET\nremote: post", ["NEWLINESECRET"]],
    ["remote: pre\0NULSECRET gh" + "p_abcdefghijklmnopqrstuvwxyz0123 post", ["NULSECRET", "abcdefghijklmnop"]],
    ["remote: unicode \u2028 password=LSEPSECRET", ["LSEPSECRET"]],
    ["remote: " + "A".repeat(1e6) + " tail-SECRET-tail", ["AAAAAAAA", "tail-SECRET"]],
    ["remote: " + "x ".repeat(5e5) + "password=ENDSECRET", ["ENDSECRET"]],
  ];
  const wire = t => t.replace(/\\n/g, "\n").replace(/\\0/g, "\0").replace(/\\u200b/g, "\u200b").replace(/\\u2028/g, "\u2028");
  const bad = [];
  for (const [raw0, secrets] of cases) {
    const raw = wire(raw0);
    for (const input of [raw, "To x\n" + raw + "\n ! [remote rejected] a -> b (pre-receive hook declined)"]) {
      const out = mod.pushFailReason(input), line = JSON.stringify({reasons: ["T:PUSH_FAILED:" + out], error: mod.leaseErrorCode(new Error(input))});
      if (!V.has(out)) bad.push("not in vocabulary: " + out);
      for (const sec of secrets) if (line.includes(wire(sec))) bad.push(`${JSON.stringify(sec)} in ${line}`);
    }
  }
  check(`leak table: ${cases.length} adversarial inputs x 2 shapes => output line holds no secret substring and the reason is within the closed vocabulary`, bad.length === 0, bad.slice(0, 5).join(" ## "));
  check("classifier never throws on odd input (null, undefined, object, array, number, lone surrogate, NUL)", [null, undefined, {}, [], 42, "\ud800", "\u0000"].every(v => { try { return V.has(mod.pushFailReason(v)) && mod.leaseErrorCode(v).startsWith("LEASE_ERROR:"); } catch { return false; } }));
  const patho = ["a/".repeat(500000), '"/'.repeat(500000), "token ".repeat(170000), " ".repeat(1e6) + "x", "@".repeat(1e6), "A".repeat(1e6), "remote: " + "ab:".repeat(350000), "eyJ".repeat(333333), "\n".repeat(1e6) + "remote: x"];
  const slow = patho.map(x => { const t0 = performance.now(); mod.pushFailReason(x); return performance.now() - t0; });
  check(`ReDoS guard: 1 MB pathological inputs each classified in <100 ms (max ${Math.max(...slow).toFixed(1)} ms)`, slow.every(ms => ms < 100), slow.map(x => x.toFixed(0)).join(","));
  // End to end: the hook prints the adversarial stderr (read from a file next to the bare repo); the stdout JSON line must hold no secret.
  const e = mkEnv([T("SEC-1")]);
  const payload = path.join(e.dir, "payload.txt");
  writeHook(e.bare, `while read o n r; do case "$r" in refs/heads/claude/*) cat '${payload}' >&2; exit 1;; esac; done; exit 0`);
  let e2eBad = 0, e2eN = 0;
  for (const [raw0, secrets] of cases) {
    fs.writeFileSync(payload, wire(raw0) + "\n");
    const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
    e2eN++;
    const m = /^SEC-1:PUSH_FAILED:([A-Z_]+)$/.exec((r.j?.reasons ?? []).find(x => x.startsWith("SEC-1:PUSH_FAILED")) ?? "");
    if (!(r.j?.outcome === "NO_ACTION" && m && V.has(m[1]) && secrets.every(sec => !r.raw.includes(wire(sec))) && !/with space|\/tmp\//.test(r.raw))) { e2eBad++; console.log("  e2e leak/shape anomaly:", JSON.stringify(raw0.slice(0, 80)), r.raw.slice(0, 300)); }
  }
  check(`end-to-end: hook echoing ${e2eN} adversarial payloads (tokens, Authorization, JSON creds, spaced paths) leaks nothing into the stdout JSON line`, e2eBad === 0, `${e2eBad} anomalies`);
}
// 10e. Lease-module-throws path uses the same ls-remote gating (stub lease modules live in the temp work clone only).
{
  const stub = work => {
    const d = path.join(work, "automation/lib"); fs.mkdirSync(d, {recursive: true});
    fs.writeFileSync(path.join(d, "task-lease.mjs"), 'export function claim() { throw new Error("boom gh\x70_abcdefghijklmnopqrstuvwxyz0123456789"); }\nexport function release() {}\n');
    fs.writeFileSync(path.join(d, "task-lease-git-store.mjs"), "export function createRemoteRefStore() { return {createIfAbsent() { return {created: false, current: null}; }, read() { return null; }}; }\n");
  };
  const real = spawnSync("sh", ["-c", "command -v git"], {encoding: "utf8"}).stdout.trim();
  const wdir = path.join(tmpRoot, "gitwrap2"); fs.mkdirSync(wdir);
  fs.writeFileSync(path.join(wdir, "git"), `#!/bin/sh\nif [ "$1" = ls-remote ]; then for a in "$@"; do case "$a" in refs/uasco/claims/*) echo "simulated ls-remote failure" >&2; exit 128;; esac; done; fi\nexec "${real}" "$@"\n`, {mode: 0o755});
  const a = mkEnv([T("CT-1")]); stub(a.work);
  const ra = dispatchSync(a.work, ["--claim", "--backlog", a.bl]);
  check("lease module throws + successful empty ls-remote => LEASE_STORE_UNAVAILABLE, branch claim proceeds, error text not echoed (LEASE_ERROR:<CODE> only)", ra.j?.outcome === "START" && ra.j.lease?.status === "LEASE_STORE_UNAVAILABLE" && heads(a.bare).includes("refs/heads/claude/ct-1") && ra.j.lease.error === "LEASE_ERROR:UNKNOWN" && !ra.raw.includes("gh\x70_abcdefghijklmnopqrstuvwxyz") && !ra.raw.includes("boom"), ra.raw);
  const b = mkEnv([T("CT-2")]); stub(b.work);
  const rb = dispatchSync(b.work, ["--claim", "--backlog", b.bl], {PATH: `${wdir}${path.delimiter}${process.env.PATH}`});
  check("lease module throws + FAILED ls-remote => fail-closed CT-2:LEASE_CHECK_FAILED, nothing pushed", rb.j?.reasons?.includes("CT-2:LEASE_CHECK_FAILED") && !rb.j.reasons.includes("CT-2:LEASE_STORE_UNAVAILABLE") && heads(b.bare).length === 0 && rb.j.outcome === "NO_ACTION", rb.raw);
  const c = mkEnv([T("CT-3")]); stub(c.work);
  G(c.work, ["push", "-q", "origin", "HEAD:refs/uasco/claims/CT-3"]);
  const rc = dispatchSync(c.work, ["--claim", "--backlog", c.bl]);
  check("lease module throws + lease ref EXISTS on remote => treated as held (CT-3:LEASE_HELD), nothing pushed", rc.j?.reasons?.includes("CT-3:LEASE_HELD") && heads(c.bare).length === 0, rc.raw);
}
// 11. 8 processes racing on 3 tasks: each task claimed exactly once.
{
  let bad = 0;
  const rounds = 4;
  for (let i = 0; i < rounds; i++) {
    const e = mkEnv([T("N-1"), T("N-2"), T("N-3")]);
    const rs = await Promise.all(Array.from({length: 8}, (_, k) => dispatchAsync(e.work, ["--claim", "--owner", `w${k}`, "--backlog", e.bl])));
    const ids = rs.filter(r => r.j?.outcome === "START").map(r => r.j.taskId).sort();
    const none = rs.filter(r => r.j?.outcome === "NO_ACTION").length;
    if (!(ids.join() === "N-1,N-2,N-3" && none === 5 && heads(e.bare).length === 3)) { bad++; console.log("  8-proc anomaly:", rs.map(r => r.raw.trim()).join(" | ")); }
  }
  check(`8 processes x 3 tasks x ${rounds} rounds: each task claimed exactly once, 5 NO_ACTION`, bad === 0, `${bad} anomalies`);
}
// 12. Future-dated claim => UNKNOWN; claim with changed tree => not RECLAIMABLE.
{
  const e = mkEnv([T("U-1"), T("U-2")]);
  const base = G(e.work, ["rev-parse", "HEAD"]), tree = G(e.work, ["rev-parse", "HEAD^{tree}"]);
  const future = Math.floor(Date.now() / 1000) + 5 * 3600, old = Math.floor(Date.now() / 1000) - 10 * 3600;
  const d = ts => ({GIT_COMMITTER_DATE: `${ts} +0000`, GIT_AUTHOR_DATE: `${ts} +0000`});
  G(e.work, ["push", "-q", "origin", `${G(e.work, ["commit-tree", tree, "-p", base, "-m", "dispatch-claim: U-1 owner=x"], d(future))}:refs/heads/claude/u-1`]);
  fs.writeFileSync(path.join(e.work, "extra"), "y"); G(e.work, ["add", "-A"]); G(e.work, ["commit", "-q", "-m", "tmp"]);
  const tree2 = G(e.work, ["rev-parse", "HEAD^{tree}"]);
  G(e.work, ["push", "-q", "origin", `${G(e.work, ["commit-tree", tree2, "-p", base, "-m", "dispatch-claim: U-2 owner=x"], d(old))}:refs/heads/claude/u-2`]);
  const r = dispatchSync(e.work, ["--backlog", e.bl]);
  const st = Object.fromEntries((r.j?.reclaimable ?? []).map(x => [x.taskId, x.state]));
  check("future-dated claim => UNKNOWN (not FRESH); claim with changed tree => HAS_WORK_COMMITS (not RECLAIMABLE)", st["U-1"] === "UNKNOWN" && st["U-2"] === "HAS_WORK_COMMITS", JSON.stringify(r.j?.reclaimable));
}
fs.rmSync(tmpRoot, {recursive: true, force: true});
console.log(`DISPATCH_PROOF: ${failures === 0 ? "PASS" : "FAIL"} (${n - failures}/${n} checks)`);
process.exit(failures === 0 ? 0 : 1);
