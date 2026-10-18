// //TR: Bu betik dispatch.mjs için gerçek git ref'leriyle (geçici bare remote + klonlar) çalışan kanıttır: START, otomatik ilerleme, çift süreçli yarış, bozuk alanların fail-closed reddi, BLOCKED/NO_ACTION, bayat claim RECLAIMABLE raporu ve gerçek backlog'un NO_ACTION vermesi.
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
const dispatchSync = (cwd, args) => {
  const r = spawnSync("node", [DISPATCH, ...args], {cwd, encoding: "utf8"});
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
// 6. Real current backlog => NO_ACTION.
{
  const candidates = ["origin/v7/integration", "origin/claude/pensive-mayer-16pnt2"];
  let content = null, src = null;
  for (const c of candidates) { const r = spawnSync("git", ["show", `${c}:docs/planning/BACKLOG_CHECKPOINT.json`], {cwd: REPO_ROOT, encoding: "utf8"}); if (r.status === 0) { content = r.stdout; src = c; break; } }
  if (content === null) check("real BACKLOG_CHECKPOINT.json available", false, "not found on candidate refs (NOT_RUN)");
  else {
    const e = mkEnv([], content);
    const r = dispatchSync(e.work, ["--claim", "--backlog", e.bl]);
    check(`real backlog (from ${src}) => NO_ACTION, nothing claimed`, r.code === 0 && r.j.outcome === "NO_ACTION" && heads(e.bare).length === 0, r.raw.slice(0, 400));
    console.log(`  real-backlog reasons (first 6): ${JSON.stringify(r.j?.reasons?.slice(0, 6))}`);
  }
}
fs.rmSync(tmpRoot, {recursive: true, force: true});
console.log(`DISPATCH_PROOF: ${failures === 0 ? "PASS" : "FAIL"} (${n - failures}/${n} checks)`);
process.exit(failures === 0 ? 0 : 1);
