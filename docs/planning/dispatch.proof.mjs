// //TR: Bu betik dispatch.mjs için gerçek git ref'leriyle (geçici bare remote + klonlar) çalışan kanıttır: START, otomatik ilerleme, çift süreçli yarış, bozuk alanların fail-closed reddi, BLOCKED/NO_ACTION, bayat claim RECLAIMABLE raporu, düşman id'ler, D/F ref çakışması, lease-store reddi, yarış dışı push hatası ve 8 süreçli yarış, çıktı kanallarının kapatılması (lease status/token/epoch, atılan getter, sha, düşman backlog, global gizli-işaret taraması) (gerçek backlog kontrolü isteğe bağlıdır, yoksa SKIPPED).
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
// Authority gating is opt-in: eligible tasks carry protectedEdit:false AND requiresNewAuthority:false explicitly, so T() keeps both defaults
// (every case below that expects a selectable task stays meaningful). Pass ABSENT to leave a key out of the backlog entry altogether.
const ABSENT = Symbol("ABSENT");
const T = (id, extra = {}) => Object.fromEntries(Object.entries({id, status: "READY", owner: "CLOUD", authorizedBy: "FOUNDER:test", dependsOn: [], protectedEdit: false, requiresNewAuthority: false, ...extra}).filter(([, v]) => v !== ABSENT));
// The lease modules are resolved relative to the SCRIPT (import.meta.url), not the cwd. A case that plants stub lease modules in a temp clone
// therefore runs a copy of dispatch.mjs from inside that clone (docs/planning/), so the stubs stay the modules under test.
const LOCAL_SCRIPT = new Map();
function useLocalScript(work) {
  const dst = path.join(work, "docs/planning/dispatch.mjs");
  fs.mkdirSync(path.dirname(dst), {recursive: true}); fs.copyFileSync(DISPATCH, dst); LOCAL_SCRIPT.set(work, dst);
}
const scriptFor = cwd => LOCAL_SCRIPT.get(cwd) ?? DISPATCH;
const heads = bare => G(bare, ["for-each-ref", "--format=%(refname)", "refs/heads/claude/"]).split("\n").filter(Boolean);
const ALL_RAW = []; // every stdout captured from any dispatch.mjs run in this proof (scanned globally at the end)
const dispatchSync = (cwd, args, env, nodeArgs = []) => {
  const r = spawnSync("node", [...nodeArgs, scriptFor(cwd), ...args], {cwd, encoding: "utf8", ...(env ? {env: {...process.env, ...env}} : {})});
  ALL_RAW.push(r.stdout);
  const line = r.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let j = null; try { j = JSON.parse(line); } catch { /* keep null */ }
  return {code: r.status, j, raw: r.stdout, err: r.stderr};
};
const dispatchAsync = (cwd, args) => new Promise(res => {
  const c = spawn("node", [scriptFor(cwd), ...args], {cwd}); let out = "";
  c.stdout.on("data", d => out += d); c.on("close", code => { ALL_RAW.push(out); let j = null; try { j = JSON.parse(out.trim().split("\n").pop()); } catch { /* null */ } res({code, j, raw: out}); });
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
// 3b. Authority gating is opt-in: protectedEdit AND requiresNewAuthority must both be present and exactly the boolean false.
{
  const MP = "MISSING_PROTECTED_EDIT", MR = "MISSING_REQUIRES_NEW_AUTHORITY", XP = "MALFORMED_PROTECTED_EDIT", XR = "MALFORMED_REQUIRES_NEW_AUTHORITY";
  const cases = [
    ["AG-ABS-BOTH", {protectedEdit: ABSENT, requiresNewAuthority: ABSENT}, [MP, MR]],
    ["AG-ABS-PE", {protectedEdit: ABSENT}, [MP]],
    ["AG-ABS-RNA", {requiresNewAuthority: ABSENT}, [MR]],
    ["AG-NULL-BOTH", {protectedEdit: null, requiresNewAuthority: null}, [XP, XR]],
    ["AG-NULL-PE", {protectedEdit: null}, [XP]],
    ["AG-NULL-RNA", {requiresNewAuthority: null}, [XR]],
    ["AG-STR-BOTH", {protectedEdit: "false", requiresNewAuthority: "false"}, [XP, XR]],
    ["AG-STR-PE", {protectedEdit: "false"}, [XP]],
    ["AG-STR-RNA", {requiresNewAuthority: "false"}, [XR]],
    ["AG-ZERO-BOTH", {protectedEdit: 0, requiresNewAuthority: 0}, [XP, XR]],
  ];
  const tasks = cases.map(([id, extra]) => T(id, extra));
  const e = mkEnv(tasks);
  const onDisk = JSON.parse(fs.readFileSync(e.bl, "utf8")).tasks;
  check("authority-gating fixture really omits the keys (absent, not undefined/false) and carries null / \"false\" literally",
    !("protectedEdit" in onDisk[0]) && !("requiresNewAuthority" in onDisk[0]) && !("protectedEdit" in onDisk[1]) && onDisk[1].requiresNewAuthority === false && !("requiresNewAuthority" in onDisk[2]) && onDisk[2].protectedEdit === false
      && onDisk[3].protectedEdit === null && onDisk[6].protectedEdit === "false" && onDisk[6].requiresNewAuthority === "false", JSON.stringify(onDisk.slice(0, 7)));
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
  check("flags absent / null / \"false\" / 0 (alone or in either position) => NO_ACTION, nothing claimed", r.code === 0 && r.j?.outcome === "NO_ACTION" && heads(e.bare).length === 0, r.raw.slice(0, 400));
  const bad = cases.filter(([id, , want]) => {
    const got = (r.j?.reasons ?? []).filter(x => x.startsWith(`${id}:`)).map(x => x.slice(id.length + 1)).sort();
    return got.join() !== [...want].sort().join();
  }).map(c => c[0]);
  check("each ineligible task carries exactly its clear reason (MISSING_* for absent, MALFORMED_* for null / \"false\" / 0), none of them silently eligible", bad.length === 0, `${bad.join(",")} :: ${JSON.stringify(r.j?.reasons)}`);
  const e2 = mkEnv([...tasks, T("AG-OK")]);
  const r2 = dispatchSync(e2.work, ["--claim", "--backlog", e2.bl]);
  check("only the task with both flags explicitly false (AG-OK) is claimed among the flag-less / malformed ones", r2.j?.outcome === "START" && r2.j.taskId === "AG-OK" && heads(e2.bare).join() === "refs/heads/claude/ag-ok", r2.raw.slice(0, 400));
  const amod = await import(path.join(HERE, "dispatch.mjs"));
  const aenv = {tasks: [], claimedHeads: new Set(), remoteHeads: new Set(), openPrs: new Set()};
  check("evaluateTask: explicit false/false => eligible (no reasons); true => PROTECTED_EDIT / REQUIRES_NEW_AUTHORITY; absent => MISSING_*",
    amod.evaluateTask(T("AG-U"), aenv).length === 0
    && amod.evaluateTask(T("AG-U", {protectedEdit: true, requiresNewAuthority: true}), aenv).join() === "PROTECTED_EDIT,REQUIRES_NEW_AUTHORITY"
    && amod.evaluateTask(T("AG-U", {protectedEdit: ABSENT, requiresNewAuthority: ABSENT}), aenv).join() === `${MP},${MR}`);
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
  check("hostile ids a.LOCK/@{u}/refs/heads/master/../x/a:b/-x => ?:MALFORMED_ID (id sanitised to '?'), never pushed, never echoed", dry.j.reasons.filter(x => x === "?:MALFORMED_ID").length === 6 && ["a.LOCK", "@{u}", "refs/heads/master", "../x", "a:b", "-x"].every(id => !dry.raw.includes(id)), JSON.stringify(dry.j.reasons));
  check("only refs/heads/claude/{master,head} exist (no ref outside claude/ and no malformed ref)", allHeads.sort().join(",") === "refs/heads/claude/head,refs/heads/claude/master" && G(e.bare, ["for-each-ref", "refs/uasco/"]).split("\n").every(l => !/\.lock|@|\.\./i.test(l)), allHeads.join(","));
  const e2 = mkEnv([T("a.LOCK"), T("OK-1")]);
  const r2 = dispatchSync(e2.work, ["--claim", "--backlog", e2.bl]);
  check("a.LOCK does not halt the queue: OK-1 claimed, ?:MALFORMED_ID", r2.code === 0 && r2.j.outcome === "START" && r2.j.taskId === "OK-1" && r2.j.reasons.includes("?:MALFORMED_ID") && !r2.raw.includes("a.LOCK"), r2.raw);
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
    const d = path.join(work, "automation/lib"); fs.mkdirSync(d, {recursive: true}); useLocalScript(work);
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
// 13. Output sinks: stdout holds only fixed codes / validated tokens. Token-like fixtures are built at runtime (fake values; the repo secret scanner stays unchanged).
const FK = s => "gh" + "p_" + s; // fake token-shaped marker assembled at runtime. NB: "_" is a legal id/ref/token character, so id/dep/branch fixtures add a space to be genuinely invalid.
const MARKERS = ["STATUSLEAK", "TOKENLEAK", "EPOCHLEAK", "SHALEAK", "IDLEAK", "OWNERLEAK", "DEPLEAK", "BRANCHLEAK", "PRLEAK", "DUPLEAK", "INTERNALLEAK", "GETTERLEAK", "ARGLEAK", "HEADLEAK", "OWNERLEAK2", "BASELEAK"].map(FK);
const stubLease = (work, {claimBody, releaseLog}) => {
  const d = path.join(work, "automation/lib"); fs.mkdirSync(d, {recursive: true}); useLocalScript(work);
  fs.writeFileSync(path.join(d, "task-lease.mjs"), `import fs from "node:fs";\nexport function claim() { ${claimBody} }\nexport function release() { fs.appendFileSync(${JSON.stringify(releaseLog)}, "released\\n"); return {status: "RELEASED"}; }\n`);
  fs.writeFileSync(path.join(d, "task-lease-git-store.mjs"), "export function createRemoteRefStore() { return {createIfAbsent() { return {created: true, current: null}; }, read() { return null; }}; }\n");
};
const mod13 = await import(path.join(HERE, "dispatch.mjs"));
{
  // (1a) unknown lease status: fail-closed skip, nothing released, status text never echoed.
  const a = mkEnv([T("LK-1"), T("LK-2")]); const logA = path.join(a.dir, "release.log");
  stubLease(a.work, {releaseLog: logA, claimBody: `return {status: ${JSON.stringify(FK("STATUSLEAK"))}, record: {token: ${JSON.stringify(FK("TOKENLEAK"))}, epoch: 1}};`});
  const ra = dispatchSync(a.work, ["--claim", "--backlog", a.bl]);
  check("lease status other than GRANTED/HELD => LK-1:LEASE_ERROR:UNKNOWN skip, nothing pushed, nothing released, status/token not echoed", ra.j?.reasons?.includes("LK-1:LEASE_ERROR:UNKNOWN") && ra.j.reasons.includes("LK-2:LEASE_ERROR:UNKNOWN") && heads(a.bare).length === 0 && !fs.existsSync(logA) && !ra.raw.includes(FK("STATUSLEAK")) && !ra.raw.includes(FK("TOKENLEAK")), ra.raw);
  // (1b) GRANTED with hostile token/epoch: claim proceeds, token and epoch omitted.
  const b = mkEnv([T("LK-3")]); const logB = path.join(b.dir, "release.log");
  stubLease(b.work, {releaseLog: logB, claimBody: `return {status: "GRANTED", record: {token: ${JSON.stringify(FK("TOKENLEAK"))}, epoch: ${JSON.stringify(FK("EPOCHLEAK"))}}};`});
  const rb = dispatchSync(b.work, ["--claim", "--backlog", b.bl]);
  check("GRANTED with token/epoch of invalid shape => START, lease.status GRANTED, token and epoch omitted", rb.j?.outcome === "START" && rb.j.lease?.status === "GRANTED" && !("token" in rb.j.lease) && !("epoch" in rb.j.lease) && !rb.raw.includes(FK("TOKENLEAK")) && !rb.raw.includes(FK("EPOCHLEAK")), rb.raw);
  const c = mkEnv([T("LK-4")]);
  stubLease(c.work, {releaseLog: path.join(c.dir, "r.log"), claimBody: 'return {status: "GRANTED", record: {token: "abc.DEF:1-2-x", epoch: 7}};'});
  const rc = dispatchSync(c.work, ["--claim", "--backlog", c.bl]);
  check("GRANTED with a validated token and safe-integer epoch => both echoed", rc.j?.lease?.token === "abc.DEF:1-2-x" && rc.j.lease.epoch === 7, rc.raw);
  // (2a) throwing-getter error object from the lease module: leaseErrorCode never throws, process prints exactly one JSON line.
  const d = mkEnv([T("LK-5")]);
  stubLease(d.work, {releaseLog: path.join(d.dir, "r.log"), claimBody: `const e = {}; Object.defineProperty(e, "message", {get() { throw new Error(${JSON.stringify(FK("GETTERLEAK"))}); }}); throw e;`});
  const rd = dispatchSync(d.work, ["--claim", "--backlog", d.bl]);
  check("lease module throws an object with a throwing getter => exactly one JSON line, no crash, LEASE_ERROR:UNKNOWN, no leak", rd.code === 0 && rd.raw.trim().split("\n").length === 1 && rd.j?.lease?.error === "LEASE_ERROR:UNKNOWN" && !rd.raw.includes(FK("GETTERLEAK")), rd.raw + rd.err.slice(0, 200));
  const hostileErr = new Proxy({}, {get() { throw new Error("x"); }});
  check("leaseErrorCode never throws (throwing getter, throwing Proxy)", mod13.leaseErrorCode(hostileErr) === "LEASE_ERROR:UNKNOWN" && mod13.leaseErrorCode({get message() { throw 1; }}) === "LEASE_ERROR:UNKNOWN");
  // (2b) unexpected exception inside run(): fixed JSON line, exit 3. A preload makes the claim commit-tree spawn throw (outside every inner try).
  const e = mkEnv([T("IE-1")]);
  const pre = path.join(e.dir, "preload.mjs");
  fs.writeFileSync(pre, `import cp from "node:child_process"; import {syncBuiltinESMExports} from "node:module";\nconst o = cp.spawnSync; cp.spawnSync = (...a) => { if (a[1]?.[0] === "commit-tree") throw new Error(${JSON.stringify(FK("INTERNALLEAK"))}); return o(...a); };\nsyncBuiltinESMExports();\n`);
  const re = dispatchSync(e.work, ["--claim", "--no-lease", "--backlog", e.bl], undefined, ["--import", pre]);
  check("unexpected exception => exactly one fixed line {RECOVERABLE_FAILURE, [INTERNAL_ERROR, CLAIM_MAY_EXIST_CHECK_REMOTE]} (claim mode), exit 3, exception text not echoed", re.code === 3 && re.raw.trim() === JSON.stringify({outcome: "RECOVERABLE_FAILURE", reasons: ["INTERNAL_ERROR", "CLAIM_MAY_EXIST_CHECK_REMOTE"]}) && !re.raw.includes(FK("INTERNALLEAK")), re.raw + re.err.slice(0, 200));
  // (3) ls-remote sha rewritten to a token-like string: line ignored, never reaches baseSha / git argv / output.
  const f = mkEnv([T("SH-1")]);
  const real = spawnSync("sh", ["-c", "command -v git"], {encoding: "utf8"}).stdout.trim();
  const wdir = path.join(tmpRoot, "gitwrap3"); fs.mkdirSync(wdir);
  const argvLog = path.join(f.dir, "argv.log");
  fs.writeFileSync(path.join(wdir, "git"), `#!/bin/sh\necho "$@" >> '${argvLog}'\nif [ "$1" = ls-remote ]; then out=$("${real}" "$@") || exit $?; printf '%s\\n' "$out" | sed 's/^[0-9a-f]\\{40\\}/${FK("SHALEAK")}/'; exit 0; fi\nexec "${real}" "$@"\n`, {mode: 0o755});
  const rf = dispatchSync(f.work, ["--claim", "--backlog", f.bl], {PATH: `${wdir}${path.delimiter}${process.env.PATH}`});
  const argvSeen = fs.existsSync(argvLog) ? fs.readFileSync(argvLog, "utf8") : "";
  check("ls-remote sha rewritten to a non-hex string => lines ignored: not in stdout, not in any git argv, nothing pushed", !rf.raw.includes(FK("SHALEAK")) && !argvSeen.includes(FK("SHALEAK")) && heads(f.bare).length === 0 && rf.j?.outcome === "RECOVERABLE_FAILURE", rf.raw + argvSeen.slice(0, 200));
  // (4) hostile backlog: ids/status/owner/dep/branch carrying token-like text never appear in stdout.
  const long = "claude/" + "b".repeat(130);
  const h = mkEnv([
    T(FK("IDLEAK") + " x"), T("HB-1", {status: FK("STATUSLEAK")}), T("HB-2", {owner: FK("OWNERLEAK")}), T("HB-3", {dependsOn: [FK("DEPLEAK") + " x"]}),
    T("HB-4", {branch: FK("PRLEAK") + " x"}), T("HB-5", {branch: long}), T("HB-6", {status: 5, owner: {x: FK("OWNERLEAK")}}), T("HB-7", {status: "DONE", owner: "LOCAL"}),
  ]);
  G(h.work, ["push", "-q", "origin", `HEAD:refs/heads/${long}`]);
  const rh = dispatchSync(h.work, ["--backlog", h.bl, "--open-prs", FK("PRLEAK") + " x"]);
  const rs = rh.j?.reasons ?? [];
  console.log(`  hostile backlog reasons: ${JSON.stringify(rs)}`);
  check("hostile backlog: no marker in stdout; id->'?', status/owner->'malformed', dep->'?', branch->BRANCH_INVALID (also for a >120-char existing head); known enum values still shown",
    MARKERS.every(m => !rh.raw.includes(m)) && !rh.raw.includes("bbbbbbbb") && rs.includes("?:MALFORMED_ID") && rs.includes("HB-1:NOT_READY:malformed") && rs.includes("HB-2:OWNER_NOT_CLOUD:malformed") && rs.includes("HB-3:UNMET_DEP:?") && rs.includes("HB-4:OPEN_PR:BRANCH_INVALID") && rs.includes("HB-5:BRANCH_EXISTS:BRANCH_INVALID") && rs.includes("HB-6:NOT_READY:malformed") && rs.includes("HB-7:NOT_READY:DONE") && rs.includes("HB-7:OWNER_NOT_CLOUD:LOCAL"), rh.raw);
  check("every reason string is at most 160 chars", rs.every(x => x.length <= 160) && rh.j.perTask.every(p => p.reasons.every(x => x.length <= 160)));
  const dupe = mkEnv([T(FK("DUPLEAK") + " x"), T(FK("DUPLEAK") + " x")]);
  const rdup = dispatchSync(dupe.work, ["--backlog", dupe.bl]);
  check("BACKLOG_DUPLICATE_ID echoes '?' for an invalid id", rdup.code === 2 && rdup.j.reasons[0] === "BACKLOG_DUPLICATE_ID:?" && !rdup.raw.includes(FK("DUPLEAK")), rdup.raw);
  const dv = mkEnv([T("Dv-1"), T("dv-1")]);
  check("BACKLOG_DUPLICATE_ID:<id> echoes a valid id", dispatchSync(dv.work, ["--backlog", dv.bl]).j.reasons[0] === "BACKLOG_DUPLICATE_ID:Dv-1" || dispatchSync(dv.work, ["--backlog", dv.bl]).j.reasons[0] === "BACKLOG_DUPLICATE_ID:dv-1");
  const ra2 = dispatchSync(h.work, ["--" + FK("ARGLEAK")]);
  check("unknown argv flag with token-like text => ARG_UNKNOWN:? (not echoed)", ra2.code === 2 && ra2.j.reasons[0] === "ARG_UNKNOWN:?" && !ra2.raw.includes("ARGLEAK"), ra2.raw);
  // (5) classifier: word boundaries; codes are advisory labels.
  check("classifier: 'hostlsxy'/'opensslx' no longer match NETWORK; standalone 'ssl'/'tls'/'timed out' still do", mod13.classifyFailure("hostlsxy") === "UNKNOWN" && mod13.classifyFailure("opensslx") === "UNKNOWN" && mod13.classifyFailure("fatal: ssl handshake failed") === "NETWORK" && mod13.classifyFailure("tls alert") === "NETWORK" && mod13.classifyFailure("operation timed out") === "NETWORK");
  check("sanitisers: safeBranch caps at 120 and validates; safeStatus/safeOwner are closed", mod13.safeBranch("claude/ok") === "claude/ok" && mod13.safeBranch("a".repeat(121)) === "BRANCH_INVALID" && mod13.safeBranch("x y") === "BRANCH_INVALID" && mod13.safeStatus("READY") === "READY" && mod13.safeStatus("nope") === "malformed" && mod13.safeOwner("FOUNDER") === "FOUNDER" && mod13.safeOwner("root") === "malformed");
}
// 15. Delta-review fixes: full head set (F1), non-zero push status (F2), argv echo (F3), muted lease modules (F4).
{
  const wrapDir = name => { const d = path.join(tmpRoot, name); fs.mkdirSync(d); return d; };
  const real = spawnSync("sh", ["-c", "command -v git"], {encoding: "utf8"}).stdout.trim();
  const withPath = d => ({PATH: `${d}${path.delimiter}${process.env.PATH}`});
  // F1: exotic (non-ASCII) heads stay in the full set: BRANCH_EXISTS / REF_CONFLICT still fire, nothing exotic is echoed or started.
  const HL = FK("HEADLEAK");
  const f1 = mkEnv([T("T1", {branch: "feat/é"}), T("T2", {branch: "feat/plain"}), T("T3", {branch: `feat/${HL}é`})]);
  for (const h of ["feat/é", "feat/plain", `feat/${HL}é`]) G(f1.work, ["push", "-q", "origin", `HEAD:refs/heads/${h}`]);
  for (const args of [["--backlog", f1.bl], ["--claim", "--backlog", f1.bl]]) {
    const r = dispatchSync(f1.work, args), rs = r.j?.reasons ?? [];
    check(`F1 ${args[0] === "--claim" ? "claim" : "dry-run"}: exotic head feat/é => T1 skipped (BRANCH_EXISTS:BRANCH_INVALID), T2 BRANCH_EXISTS:feat/plain, T3 skipped, never START, no claude head pushed`,
      r.j?.outcome === "NO_ACTION" && rs.includes("T1:BRANCH_EXISTS:BRANCH_INVALID") && rs.includes("T2:BRANCH_EXISTS:feat/plain") && rs.includes("T3:BRANCH_EXISTS:BRANCH_INVALID") && !r.raw.includes("é") && !r.raw.includes(HL) && heads(f1.bare).length === 0, r.raw);
  }
  const f1b = mkEnv([T("T1"), T("T2")]);
  G(f1b.work, ["push", "-q", "origin", "HEAD:refs/heads/claude/t1/é"]);
  const rdf = dispatchSync(f1b.work, ["--claim", "--backlog", f1b.bl]);
  check("F1 exotic D/F: head claude/t1/é still gives T1:REF_CONFLICT (T1 never claimed), T2 claimed", rdf.j?.outcome === "START" && rdf.j.taskId === "T2" && rdf.j.reasons.includes("T1:REF_CONFLICT") && !heads(f1b.bare).includes("refs/heads/claude/t1") && !rdf.raw.includes("é"), rdf.raw);
  // F2: push performs the real push, then exits 1 (only for refs/heads/claude/*; lease pushes pass through).
  const w2 = wrapDir("gitwrap-f2");
  fs.writeFileSync(path.join(w2, "git"), `#!/bin/sh\nif [ "$1" = push ]; then for a in "$@"; do case "$a" in *refs/heads/claude/*) "${real}" "$@"; exit 1;; esac; done; fi\nexec "${real}" "$@"\n`, {mode: 0o755});
  const f2 = mkEnv([T("F2-1"), T("F2-2")]);
  const r2a = dispatchSync(f2.work, ["--claim", "--backlog", f2.bl], withPath(w2));
  check("F2 run 1 (push lands, exit 1): START F2-1 (claim is ours), lease kept, no CLAIM_RACE_LOST, F2-2 NOT also claimed",
    r2a.j?.outcome === "START" && r2a.j.taskId === "F2-1" && r2a.j.claimed === true && r2a.j.lease?.status === "GRANTED" && !r2a.raw.includes("CLAIM_RACE_LOST") && heads(f2.bare).join() === "refs/heads/claude/f2-1" && G(f2.bare, ["for-each-ref", "refs/uasco/claims/"]).includes("refs/uasco/claims/F2-1"), r2a.raw);
  const r2b = dispatchSync(f2.work, ["--backlog", f2.bl]);
  check("F2 run 2: F2-1:ALREADY_CLAIMED, next selectable is F2-2", r2b.j?.reasons?.includes("F2-1:ALREADY_CLAIMED") && r2b.j.taskId === "F2-2", r2b.raw);
  // Second wrapper: exits 1 WITHOUT pushing => PUSH_FAILED, next task claimed.
  const w3 = wrapDir("gitwrap-f2b");
  fs.writeFileSync(path.join(w3, "git"), `#!/bin/sh\nif [ "$1" = push ]; then for a in "$@"; do case "$a" in *refs/heads/claude/f2-3) echo "boom" >&2; exit 1;; esac; done; fi\nexec "${real}" "$@"\n`, {mode: 0o755});
  const f3 = mkEnv([T("F2-3"), T("F2-4")]);
  const r3 = dispatchSync(f3.work, ["--claim", "--backlog", f3.bl], withPath(w3));
  check("F2 push fails without landing => F2-3:PUSH_FAILED, F2-4 claimed, no CLAIM_RACE_LOST", r3.j?.outcome === "START" && r3.j.taskId === "F2-4" && r3.j.reasons.some(x => x.startsWith("F2-3:PUSH_FAILED:")) && !r3.raw.includes("CLAIM_RACE_LOST") && heads(f3.bare).join() === "refs/heads/claude/f2-4", r3.raw);
  // Internal-error hint is claim-mode only.
  check("internal-error line carries CLAIM_MAY_EXIST_CHECK_REMOTE in claim mode only", JSON.parse(mod13.internalLine(["--claim"])).reasons.join() === "INTERNAL_ERROR,CLAIM_MAY_EXIST_CHECK_REMOTE" && JSON.parse(mod13.internalLine([])).reasons.join() === "INTERNAL_ERROR");
  // F3: argv echo.
  const OW = FK("OWNERLEAK2"), BB = FK("BASELEAK");
  const f4 = mkEnv([T("A-1")]);
  const ro = dispatchSync(f4.work, ["--backlog", f4.bl, "--owner", OW]);
  check("F3 owner with token-shaped text => BLOCKED ARG_INVALID:--owner, never echoed", ro.code === 2 && ro.j?.reasons?.[0] === "ARG_INVALID:--owner" && !ro.raw.includes("OWNERLEAK2"), ro.raw);
  const rb = dispatchSync(f4.work, ["--claim", "--backlog", f4.bl, "--base-branch", BB]);
  check("F3 --base-branch with token-shaped text => BASE_UNAVAILABLE:origin/BRANCH_INVALID, never echoed", rb.code === 3 && rb.j?.reasons?.includes("BASE_UNAVAILABLE:origin/BRANCH_INVALID") && !rb.raw.includes("BASELEAK"), rb.raw);
  const rb2 = dispatchSync(f4.work, ["--claim", "--backlog", f4.bl, "--base-branch", "nobase"]);
  check("F3 plain unknown base branch is echoed as a valid ref (BASE_UNAVAILABLE:origin/nobase)", rb2.j?.reasons?.includes("BASE_UNAVAILABLE:origin/nobase"), rb2.raw);
  check("F3 safeOwnerArg: plain owner echoed, '_'/space/empty/non-string => '?'", mod13.safeOwnerArg("cloud-1") === "cloud-1" && mod13.safeOwnerArg(OW) === "?" && mod13.safeOwnerArg("a b") === "?" && mod13.safeOwnerArg("") === "?" && mod13.safeOwnerArg(5) === "?");
  // F4: a lease module that prints to console/stdout/stderr (top level, claim, store) cannot add output lines.
  const f5 = mkEnv([T("MU-1")]);
  const MK = FK("MUTELEAK"); MARKERS.push(MK);
  const dd = path.join(f5.work, "automation/lib"); fs.mkdirSync(dd, {recursive: true}); useLocalScript(f5.work);
  fs.writeFileSync(path.join(dd, "task-lease.mjs"), `console.log(${JSON.stringify(MK + "-top")});\nexport function claim() { console.log(${JSON.stringify(MK + "-claim")}); process.stdout.write(${JSON.stringify(MK + "-w\n")}); console.error(${JSON.stringify(MK + "-err")}); process.stderr.write(${JSON.stringify(MK + "-e2\n")}); return {status: "GRANTED", record: {token: "abc.DEF:1", epoch: 3}}; }\nexport function release() { console.log(${JSON.stringify(MK + "-rel")}); }\n`);
  fs.writeFileSync(path.join(dd, "task-lease-git-store.mjs"), `export function createRemoteRefStore() { console.log(${JSON.stringify(MK + "-store")}); return {createIfAbsent() { return {created: true, current: null}; }, read() { console.log(${JSON.stringify(MK + "-read")}); return null; }}; }\n`);
  const rm = dispatchSync(f5.work, ["--claim", "--backlog", f5.bl]);
  check("F4 lease module printing to console.log/stdout/stderr: stdout is exactly one JSON line without the marker, stderr free of it, claim still START with lease GRANTED",
    rm.raw.trim().split("\n").length === 1 && rm.j?.outcome === "START" && rm.j.lease?.status === "GRANTED" && !rm.raw.includes("MUTELEAK") && !rm.err.includes("MUTELEAK"), rm.raw + rm.err.slice(0, 200));
}
// 13b. N1: the lease modules come from the script's OWN repo (import.meta.url), never from the cwd repo being operated on.
{
  const e = mkEnv([T("CWD-1")]);
  const planted = path.join(e.dir, "planted.log");
  const d = path.join(e.work, "automation/lib"); fs.mkdirSync(d, {recursive: true});
  fs.writeFileSync(path.join(d, "task-lease.mjs"), `import fs from "node:fs";\nexport function claim() { fs.appendFileSync(${JSON.stringify(planted)}, "claim\\n"); return {status: "GRANTED", record: {token: "planted.cwd:1", epoch: 99}}; }\nexport function release() {}\n`);
  fs.writeFileSync(path.join(d, "task-lease-git-store.mjs"), `import fs from "node:fs";\nexport function createRemoteRefStore() { fs.appendFileSync(${JSON.stringify(planted)}, "store\\n"); return {createIfAbsent() { return {created: true, current: null}; }, read() { return null; }}; }\n`);
  const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]); // the REAL dispatch.mjs, cwd = a repo that carries planted lease modules
  check("N1 cwd repo with its own automation/lib/task-lease*.mjs: those planted modules are NOT loaded (token/epoch not theirs, no planted marker), the script's own lease modules record the claim",
    r.j?.outcome === "START" && r.j.lease?.status === "GRANTED" && r.j.lease.token !== "planted.cwd:1" && r.j.lease.epoch !== 99 && !fs.existsSync(planted)
    && /^cloud-dispatch:\d+:/.test(r.j.lease.token ?? "") && G(e.bare, ["for-each-ref", "refs/uasco/claims/"]).includes("refs/uasco/claims/CWD-1"), r.raw.slice(0, 500) + (fs.existsSync(planted) ? " [planted module ran]" : ""));
}
// 14. Global proof: every stdout produced by every scenario above is a single JSON line and holds none of the fake secret markers.
{
  const globalMarkers = [...MARKERS, FK("abcdefghijklmnopqrstuvwxyz0123456789"), "hunter2", "SUPERSECRETCOOKIE", "policy:", "remote.git", "/tmp/"];
  const lines = ALL_RAW.filter(x => x && x.trim());
  const oneLine = lines.filter(x => x.trim().split("\n").length === 1 && (() => { try { JSON.parse(x); return true; } catch { return false; } })()).length;
  const hit = [];
  for (const x of lines) for (const m of globalMarkers) if (x.includes(m)) hit.push(`${m} in ${x.slice(0, 120)}`);
  check(`global scan: ${lines.length} stdout lines from every scenario are single JSON lines (${oneLine}) and contain none of ${globalMarkers.length} fake secret markers`, oneLine === lines.length && hit.length === 0, hit.slice(0, 3).join(" ## "));
}
fs.rmSync(tmpRoot, {recursive: true, force: true});
console.log(`DISPATCH_PROOF: ${failures === 0 ? "PASS" : "FAIL"} (${n - failures}/${n} checks)`);
process.exit(failures === 0 ? 0 : 1);
