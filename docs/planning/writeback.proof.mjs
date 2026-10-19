// //TR: Bu betik writeback.mjs için gerçek git ref'leriyle (geçici bare remote + klon) çalışan kanıttır: birleşmiş iş dalı DONE olur; yalnız-claim, birleşmemiş, eksik dal ve DONE/BLOCKED/AUTHORITY_REQUIRED/DRAFT_NOT_READY görevleri değişmez; bozuk backlog dosyaya dokunmaz; --write biçimi korur; kuru çalıştırma yazmaz; UI-030→UI-032 zinciri gerçek dispatch.mjs ile START verir; çıktıda düşman metin yoktur.
// Run: node docs/planning/writeback.proof.mjs   (needs git + Node >= 22; creates and removes temp dirs only)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRITEBACK = path.join(HERE, "writeback.mjs");
const DISPATCH = path.join(HERE, "dispatch.mjs");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "writeback-proof-"));
let failures = 0, n = 0;
const check = (name, cond, detail = "") => { n++; if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? " :: " + detail : ""}`); };

const G = (cwd, args) => {
  const r = spawnSync("git", args, {cwd, encoding: "utf8", env: {...process.env, GIT_AUTHOR_NAME: "p", GIT_AUTHOR_EMAIL: "p@x", GIT_COMMITTER_NAME: "p", GIT_COMMITTER_EMAIL: "p@x"}});
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};
let seq = 0;
const ALL_RAW = [];
function mkEnv(backlogRaw) {
  const dir = path.join(tmpRoot, `env${++seq}`), bare = path.join(dir, "remote.git"), work = path.join(dir, "work");
  fs.mkdirSync(dir); G(dir, ["init", "--bare", "-q", "-b", "v7/integration", bare]);
  G(dir, ["clone", "-q", bare, work]); G(work, ["checkout", "-q", "-b", "v7/integration"]);
  fs.writeFileSync(path.join(work, "README"), "x"); G(work, ["add", "-A"]); G(work, ["commit", "-q", "-m", "base"]);
  G(work, ["push", "-q", "origin", "v7/integration"]);
  const bl = path.join(dir, "backlog.json");
  if (backlogRaw !== null) fs.writeFileSync(bl, backlogRaw);
  return {dir, bare, work, bl};
}
const T = (id, extra = {}) => ({id, title: `t ${id}`, owner: "CLOUD", status: "IN_REVIEW", dependsOn: [], protectedEdit: false, requiresNewAuthority: false, authorizedBy: "FOUNDER:test", ...extra});
const canon = doc => JSON.stringify(doc, null, 2) + "\n";
// Branch builders mirror what dispatch --claim and a builder produce.
const baseTip = e => G(e.work, ["rev-parse", "origin/v7/integration"]);
function claim(e, id, branch = `claude/${id.toLowerCase()}`) {
  G(e.work, ["fetch", "-q", "origin"]);
  const b = baseTip(e);
  const sha = G(e.work, ["commit-tree", `${b}^{tree}`, "-p", b, "-m", `dispatch-claim: ${id} owner=proof at=x nonce=1`]);
  G(e.work, ["push", "-q", "origin", `${sha}:refs/heads/${branch}`]);
  return {branch, sha};
}
function work(e, branch, extraCommits = 1) {
  G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", branch, `origin/${branch}`]);
  for (let i = 0; i < extraCommits; i++) { fs.writeFileSync(path.join(e.work, `${branch.replace(/\//g, "_")}-${i}.txt`), "w"); G(e.work, ["add", "-A"]); G(e.work, ["commit", "-q", "-m", `work ${branch} ${i}`]); }
  G(e.work, ["push", "-q", "origin", branch]);
}
function merge(e, branch) {
  G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", "v7/integration", "origin/v7/integration"]);
  G(e.work, ["merge", "-q", "--no-ff", "-m", `Merge ${branch}`, `origin/${branch}`]); G(e.work, ["push", "-q", "origin", "v7/integration"]);
}
const wb = (e, args = [], cwd = e.work) => {
  const r = spawnSync("node", [WRITEBACK, "--backlog", e.bl, ...args], {cwd, encoding: "utf8"});
  ALL_RAW.push(r.stdout);
  let j = null; try { j = JSON.parse(r.stdout.trim().split("\n").filter(Boolean).pop()); } catch { /* null */ }
  return {code: r.status, j, raw: r.stdout};
};
const disp = (e, args = []) => {
  const r = spawnSync("node", [DISPATCH, "--backlog", e.bl, ...args], {cwd: e.work, encoding: "utf8"});
  let j = null; try { j = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* null */ }
  return {code: r.status, j, raw: r.stdout};
};
const SECRET = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

console.log(`node ${process.version}`);
// 1. Main matrix: one remote, many tasks, every rule exercised in isolation.
const M = (() => {
  const e = mkEnv(null);
  const spec = [];
  const add = (t, f) => { spec.push(t); f?.(); };
  add(T("W-MERGED"), () => { const c = claim(e, "W-MERGED"); work(e, c.branch); merge(e, c.branch); });
  add(T("W-NOTES", {status: "IN_PROGRESS", notes: "Earlier note."}), () => { const c = claim(e, "W-NOTES"); work(e, c.branch, 2); merge(e, c.branch); });
  add(T("W-READY", {status: "READY"}), () => { const c = claim(e, "W-READY"); work(e, c.branch); merge(e, c.branch); });
  add(T("W-CUSTOM", {branch: "claude/w-custom-work"}), () => { const c = claim(e, "W-CUSTOM", "claude/w-custom-work"); work(e, c.branch); merge(e, c.branch); });
  add(T("W-CLAIMONLY"), () => { const c = claim(e, "W-CLAIMONLY"); merge(e, c.branch); }); // merged, but no work: only rule (c) can reject
  add(T("W-IMPORT"), () => { // claim-only branch that merged newer base commits in: imported commits are not work
    const c = claim(e, "W-IMPORT");
    G(e.work, ["checkout", "-q", "-B", "v7/integration", "origin/v7/integration"]); fs.writeFileSync(path.join(e.work, "newer.txt"), "n"); G(e.work, ["add", "-A"]); G(e.work, ["commit", "-q", "-m", "newer base work"]); G(e.work, ["push", "-q", "origin", "v7/integration"]);
    G(e.work, ["checkout", "-q", "-B", c.branch, `origin/${c.branch}`]); G(e.work, ["merge", "-q", "--no-ff", "-m", "sync base", "v7/integration"]); G(e.work, ["push", "-q", "origin", c.branch]);
    merge(e, c.branch);
  });
  add(T("W-UNMERGED"), () => { const c = claim(e, "W-UNMERGED"); work(e, c.branch); });
  add(T("W-MISSING"));
  const rawBranch = (name, mk) => { G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", name, "origin/v7/integration"]); mk(); G(e.work, ["push", "-q", "origin", name]); merge(e, name); };
  const commitFile = (f, msg) => { fs.writeFileSync(path.join(e.work, f), "w"); G(e.work, ["add", "-A"]); G(e.work, ["commit", "-q", "-m", msg]); };
  add(T("W-NOCLAIM"), () => rawBranch("claude/w-noclaim", () => commitFile("nc.txt", "work without any claim commit")));
  add(T("W-FORGED1"), () => rawBranch("claude/w-forged1", () => commitFile("f1.txt", "dispatch-claim: W-FORGED1 owner=x at=x nonce=1"))); // prefix only, tree differs from parent
  add(T("W-FORGED2"), () => rawBranch("claude/w-forged2", () => { commitFile("side.txt", "side work"); G(e.work, ["commit", "-q", "--allow-empty", "-m", "dispatch-claim: W-FORGED2 owner=x at=x nonce=1"]); })); // empty + prefix, but parent not on the base chain
  add(T("W-EMPTY"), () => { const c = claim(e, "W-EMPTY"); G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", c.branch, `origin/${c.branch}`]); G(e.work, ["commit", "-q", "--allow-empty", "-m", "empty work"]); G(e.work, ["push", "-q", "origin", c.branch]); merge(e, c.branch); });
  add(T("W-REBASED"), () => { // claim fast-forwarded into base, unrelated base commit N lands, branch = N + an empty commit, merged: base commits are not work
    const c = claim(e, "W-REBASED"); G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", "v7/integration", "origin/v7/integration"]);
    G(e.work, ["merge", "-q", "--ff-only", c.sha]); commitFile("n1.txt", "unrelated base commit N"); G(e.work, ["push", "-q", "origin", "v7/integration"]);
    G(e.work, ["commit", "-q", "--allow-empty", "-m", "empty on top"]); G(e.work, ["push", "-q", "origin", "HEAD:refs/heads/claude/w-rebased"]); G(e.work, ["reset", "-q", "--hard", "HEAD~1"]);
    G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["merge", "-q", "--no-ff", "-m", "Merge w-rebased", "origin/claude/w-rebased"]); G(e.work, ["push", "-q", "origin", "v7/integration"]);
  });
  add(T("W-REPRO", {status: "IN_PROGRESS"}), () => { // reviewer repro: claim-only fast-forwarded into base, unrelated base commit lands, claim branch repointed at the base tip
    const c = claim(e, "W-REPRO"); G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", "v7/integration", "origin/v7/integration"]);
    G(e.work, ["merge", "-q", "--ff-only", c.sha]); commitFile("n2.txt", "unrelated base commit"); G(e.work, ["push", "-q", "origin", "v7/integration"]);
    G(e.work, ["push", "-q", "-f", "origin", "HEAD:refs/heads/claude/w-repro"]);
  });
  add(T("W-FFCLAIM"), () => { const c = claim(e, "W-FFCLAIM"); G(e.work, ["fetch", "-q", "origin"]); G(e.work, ["checkout", "-q", "-B", "v7/integration", "origin/v7/integration"]); G(e.work, ["merge", "-q", "--ff-only", c.sha]); G(e.work, ["push", "-q", "origin", "v7/integration"]); });
  const mkOther = (id, br) => () => { const c = claim(e, id, br); work(e, br); merge(e, br); };
  add(T("W-TBBASE", {branch: "v7/integration"}));
  add(T("W-TBREFS", {branch: "refs/heads/claude/w-tbrefs"}), mkOther("W-TBREFS", "claude/w-tbrefs"));
  add(T("W-TBFEAT", {branch: "feat/w-tbfeat"}), mkOther("W-TBFEAT", "feat/w-tbfeat"));
  add(T("W-TBMASTER", {branch: "master"}));
  for (const st of ["DONE", "BLOCKED", "AUTHORITY_REQUIRED", "DRAFT_NOT_READY"]) add(T(`W-${st}`, {status: st}), () => { const c = claim(e, `W-${st}`); work(e, c.branch); merge(e, c.branch); });
  add(T("W-BADBRANCH", {branch: `bad branch ${SECRET}`}));
  add(T(`W-BAD/../${SECRET}`));
  add(T("W-NOTESOBJ", {notes: {marker: SECRET}}), () => { const c = claim(e, "W-NOTESOBJ"); work(e, c.branch); merge(e, c.branch); });
  const doc = {"//TR": "t", _doc: "d", generatedAt: "2026-10-19", head: "abc", tasks: spec, relations: [{a: 1, b: [2, 3]}]};
  const raw = canon(doc);
  fs.writeFileSync(e.bl, raw);
  return {e, doc, raw};
})();
{
  const {e, raw, doc} = M;
  const dry = wb(e);
  const ids = (dry.j?.changes ?? []).map(c => c.taskId).sort();
  check("dry run: exactly the merged work tasks (incl. READY, IN_PROGRESS, custom task.branch) are proposed", dry.j?.outcome === "CHANGES" && ids.join() === "W-CUSTOM,W-MERGED,W-NOTES,W-READY", dry.raw);
  check("dry run writes nothing (file byte-identical) and reports written:false", fs.readFileSync(e.bl, "utf8") === raw && dry.j.written === false && dry.j.mode === "DRY_RUN");
  const ch = Object.fromEntries(dry.j.changes.map(c => [c.taskId, c]));
  check("change records carry from/to/branchHead (full sha of the remote head) and baseSha is the remote base tip",
    ch["W-MERGED"].from === "IN_REVIEW" && ch["W-MERGED"].to === "DONE" && ch["W-MERGED"].branchHead === G(e.bare, ["rev-parse", "refs/heads/claude/w-merged"]) && ch["W-READY"].from === "READY"
    && ch["W-NOTES"].from === "IN_PROGRESS" && dry.j.baseSha === G(e.bare, ["rev-parse", "refs/heads/v7/integration"]), dry.raw);
  const why = c => (dry.j.reasons.find(r => r.startsWith(c)) ?? "");
  check("claim-only branch (merged, no work) is not proposed: NO_WORK_COMMITS", why("W-CLAIMONLY:") === "W-CLAIMONLY:NO_WORK_COMMITS", JSON.stringify(dry.j.reasons));
  check("claim-only branch that merged newer base commits is still not work (first-parent rule)", why("W-IMPORT:") === "W-IMPORT:NO_WORK_COMMITS", JSON.stringify(dry.j.reasons));
  check("work branch not merged => NOT_MERGED, unchanged", why("W-UNMERGED:") === "W-UNMERGED:NOT_MERGED", JSON.stringify(dry.j.reasons));
  check("missing branch => NO_BRANCH; branch without a claim commit => NO_CLAIM_COMMIT (fail-closed)", why("W-MISSING:") === "W-MISSING:NO_BRANCH" && why("W-NOCLAIM:") === "W-NOCLAIM:NO_CLAIM_COMMIT", JSON.stringify(dry.j.reasons));
  check("reviewer repro (claim-only ff'd into base, unrelated base commit, claim branch repointed at base tip, IN_PROGRESS) => not DONE: HEAD_ON_BASE_CHAIN", why("W-REPRO:") === "W-REPRO:HEAD_ON_BASE_CHAIN" && !ids.includes("W-REPRO"), JSON.stringify(dry.j.reasons));
  check("fast-forwarded claim-only branch (head on the base chain) => HEAD_ON_BASE_CHAIN", why("W-FFCLAIM:") === "W-FFCLAIM:HEAD_ON_BASE_CHAIN", JSON.stringify(dry.j.reasons));
  check("branch = unrelated base commit + empty commit, merged by a merge commit: base commits are not work => NO_WORK_COMMITS", why("W-REBASED:") === "W-REBASED:NO_WORK_COMMITS", JSON.stringify(dry.j.reasons));
  check("task.branch = base branch / master / refs/heads/... / feat/... => BRANCH_NOT_ALLOWED, never DONE", ["W-TBBASE", "W-TBMASTER", "W-TBREFS", "W-TBFEAT"].every(i => why(`${i}:`) === `${i}:BRANCH_NOT_ALLOWED` && !ids.includes(i)), JSON.stringify(dry.j.reasons));
  check("empty-commit \"work\" branch (merged) => NO_WORK_COMMITS", why("W-EMPTY:") === "W-EMPTY:NO_WORK_COMMITS", JSON.stringify(dry.j.reasons));
  check("forged claim message (prefix only with a changed tree; or empty + prefix whose parent is off the base chain) => NO_CLAIM_COMMIT", why("W-FORGED1:") === "W-FORGED1:NO_CLAIM_COMMIT" && why("W-FORGED2:") === "W-FORGED2:NO_CLAIM_COMMIT", JSON.stringify(dry.j.reasons));
  check("DONE / BLOCKED / AUTHORITY_REQUIRED / DRAFT_NOT_READY tasks (even with merged work) are never proposed or mentioned",
    !ids.some(i => /DONE|BLOCKED|AUTHORITY|DRAFT/.test(i)) && !dry.j.reasons.some(r => /W-(DONE|BLOCKED|AUTHORITY_REQUIRED|DRAFT_NOT_READY):/.test(r)), JSON.stringify(dry.j.reasons));
  check("malformed branch / malformed id / non-string notes are skipped with fixed codes", why("W-BADBRANCH:") === "W-BADBRANCH:MALFORMED_BRANCH" && dry.j.reasons.includes("?:MALFORMED_ID") && why("W-NOTESOBJ:") === "W-NOTESOBJ:NOTES_MALFORMED", JSON.stringify(dry.j.reasons));

  const w = wb(e, ["--write", "--base-branch", "v7/integration"]);
  const after = fs.readFileSync(e.bl, "utf8"), ad = JSON.parse(after);
  check("--write: outcome CHANGES, written:true, same changes as the dry run", w.j?.outcome === "CHANGES" && w.j.written === true && w.j.changes.map(c => c.taskId).sort().join() === ids.join(), w.raw);
  const byId = Object.fromEntries(ad.tasks.map(t => [t.id, t]));
  check("--write: the four tasks are DONE", ids.every(i => byId[i].status === "DONE"));
  const baseShort = w.j.baseSha.slice(0, 7);
  check("--write: notes carry the exact evidence line; existing notes are appended to, never replaced",
    new RegExp(`^Write-back \\d{4}-\\d{2}-\\d{2}: merged into v7/integration \\(branch head ${ch["W-MERGED"].branchHead.slice(0, 7)} ancestor of ${baseShort}\\)$`).test(byId["W-MERGED"].notes)
    && byId["W-NOTES"].notes.startsWith("Earlier note. Write-back ") && !("notes" in doc.tasks[0]) , byId["W-NOTES"].notes);
  const blockOf = t => JSON.stringify(t, null, 2).split("\n").map(l => "    " + l).join("\n");
  const untouched = doc.tasks.filter(t => !ids.includes(t.id));
  check(`--write preserves formatting: ${untouched.length} unchanged task blocks are byte-identical substrings in old and new text, same 2-space format, trailing newline, top-level keys/order and relations unchanged`,
    untouched.every(t => raw.includes(blockOf(t)) && after.includes(blockOf(t))) && after === canon(ad) && after.endsWith("}\n") && !after.endsWith("\n\n")
    && Object.keys(ad).join() === Object.keys(doc).join() && JSON.stringify(ad.relations) === JSON.stringify(doc.relations) && ad.tasks.map(t => t.id).join() === doc.tasks.map(t => t.id).join(), "");
  check("--write changed only status+notes of the DONE tasks (every other field of them identical)",
    ids.every(i => { const o = doc.tasks.find(t => t.id === i), a = byId[i]; const {status: s1, notes: n1, ...ro} = o, {status: s2, notes: n2, ...ra} = a; return JSON.stringify(ro) === JSON.stringify(ra); }));
  const again = wb(e, ["--write"]);
  check("second --write is a no-op (NO_CHANGES, file untouched): never downgrades or re-touches DONE", again.j?.outcome === "NO_CHANGES" && fs.readFileSync(e.bl, "utf8") === after, again.raw);
}
// 2. Fail-closed: malformed backlog / duplicate ids / git failure change nothing.
{
  const bad = [["unparseable JSON", "{not json", "BACKLOG_UNPARSEABLE"], ["tasks not an array", JSON.stringify({tasks: "x"}), "BACKLOG_SCHEMA_INVALID:tasks"],
    ["duplicate ids (case-insensitive)", canon({tasks: [T("DUP"), T("dup")]}), "BACKLOG_DUPLICATE_ID:dup"]];
  for (const [name, content, code] of bad) {
    const e = mkEnv(content);
    const r = wb(e, ["--write"]);
    check(`${name} => RECOVERABLE_FAILURE ${code}, exit 3, file untouched`, r.code === 3 && r.j?.outcome === "RECOVERABLE_FAILURE" && r.j.reasons[0] === code && r.j.changes.length === 0 && fs.readFileSync(e.bl, "utf8") === content, r.raw);
  }
  const e = mkEnv(null); const c = claim(e, "G-1"); work(e, c.branch); merge(e, c.branch);
  const content = canon({tasks: [T("G-1")]}); fs.writeFileSync(e.bl, content);
  const r1 = wb(e, ["--write", "--remote", "nonexistent"]);
  check("git failure (remote unreachable) => RECOVERABLE_FAILURE REMOTE_UNREACHABLE, file untouched", r1.code === 3 && r1.j.reasons[0] === "REMOTE_UNREACHABLE" && fs.readFileSync(e.bl, "utf8") === content, r1.raw);
  const r2 = wb(e, ["--write", "--base-branch", "no-such-base"]);
  check("missing base branch => RECOVERABLE_FAILURE BASE_UNAVAILABLE, file untouched", r2.code === 3 && r2.j.reasons[0] === "BASE_UNAVAILABLE" && fs.readFileSync(e.bl, "utf8") === content, r2.raw);
  const r3 = wb(e, ["--bogus"]), r4 = wb(e, ["--remote", SECRET]);
  check("bad arguments => RECOVERABLE_FAILURE with fixed codes (no echo of the value)", r3.j?.reasons[0] === "ARG_UNKNOWN:--bogus" && r4.j?.reasons[0] === "ARG_INVALID:--remote" && !r4.raw.includes(SECRET), r3.raw + r4.raw);
  const odd = JSON.stringify({tasks: [T("G-1")]}); fs.writeFileSync(e.bl, odd);
  const r5 = wb(e, ["--write"]);
  check("non-canonical backlog formatting + --write => refused (BACKLOG_FORMAT_NOT_CANONICAL), file untouched; dry run still reports", r5.j?.reasons[0] === "BACKLOG_FORMAT_NOT_CANONICAL" && fs.readFileSync(e.bl, "utf8") === odd && wb(e).j.outcome === "CHANGES");
}
// 3. End-to-end "next task after success": UI-030 merged => write-back DONE => real dispatch.mjs turns UNMET_DEP into START for UI-032.
{
  const e = mkEnv(null);
  fs.writeFileSync(e.bl, canon({tasks: [T("UI-030", {status: "READY"}), T("UI-032", {status: "READY", dependsOn: ["UI-030"]})]}));
  const c0 = disp(e, ["--claim", "--owner", "cloud-a"]);
  check("setup: real dispatch --claim claims UI-030 (first READY task)", c0.j?.outcome === "START" && c0.j.taskId === "UI-030" && c0.j.claimRef === "refs/heads/claude/ui-030", c0.raw);
  const blocked = disp(e);
  check("before write-back: UI-032 is UNMET_DEP:UI-030 and nothing is startable (NO_ACTION)", blocked.j?.outcome === "NO_ACTION" && blocked.j.reasons.includes("UI-032:UNMET_DEP:UI-030"), blocked.raw);
  work(e, "claude/ui-030"); // builder commits on top of the real dispatch claim commit
  const pre = wb(e);
  check("claimed + worked but not yet merged: write-back proposes nothing (NOT_MERGED)", pre.j?.outcome === "NO_CHANGES" && pre.j.reasons.includes("UI-030:NOT_MERGED"), pre.raw);
  merge(e, "claude/ui-030");
  const w = wb(e, ["--write"]);
  const bl = JSON.parse(fs.readFileSync(e.bl, "utf8")).tasks;
  check("after merge: write-back marks UI-030 DONE (UI-032 untouched, still READY)", w.j?.outcome === "CHANGES" && w.j.changes.length === 1 && bl[0].status === "DONE" && bl[1].status === "READY" && !("notes" in bl[1]), w.raw);
  const next = disp(e);
  check("after write-back: real dispatch.mjs returns START for UI-032 (UNMET_DEP gone) — next task after success", next.j?.outcome === "START" && next.j.taskId === "UI-032" && !next.j.reasons.some(r => r.includes("UNMET_DEP")), next.raw);
  const claimed = disp(e, ["--claim", "--owner", "cloud-b"]);
  check("and --claim really claims UI-032 (refs/heads/claude/ui-032 on the remote)", claimed.j?.outcome === "START" && claimed.j.taskId === "UI-032" && G(e.bare, ["for-each-ref", "refs/heads/claude/ui-032"]).includes("refs/heads/claude/ui-032"), claimed.raw);
}
// 4. No-echo scan: hostile ids/branches/notes/args never reach any stdout; every stdout is exactly one JSON line.
{
  const markers = [SECRET, "remote.git", "/tmp/", "marker"];
  const lines = ALL_RAW.filter(x => x && x.trim());
  const oneLine = lines.filter(x => x.trim().split("\n").length === 1 && (() => { try { JSON.parse(x); return true; } catch { return false; } })()).length;
  const hit = [];
  for (const x of lines) for (const m of markers) if (x.includes(m)) hit.push(`${m} in ${x.slice(0, 100)}`);
  check(`no-echo scan: ${lines.length} stdout lines are single JSON lines (${oneLine}) and contain none of ${markers.length} hostile markers`, oneLine === lines.length && hit.length === 0, hit.slice(0, 3).join(" ## "));
}
fs.rmSync(tmpRoot, {recursive: true, force: true});
console.log(`WRITEBACK_PROOF: ${failures === 0 ? "PASS" : "FAIL"} (${n - failures}/${n} checks)`);
process.exit(failures === 0 ? 0 : 1);
