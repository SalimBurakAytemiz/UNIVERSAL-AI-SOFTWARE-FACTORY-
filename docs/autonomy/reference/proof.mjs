// Executable proof for next-step-engine.mjs against the REAL merged lease modules (git-ref backed, temp repo per section).
// Run: node proof.mjs   (Node 24). Prints PASS/FAIL per assertion, exits 1 on any FAIL.
import {mkdtempSync, rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {selectNext} from "./next-step-engine.mjs";

const REPO = "../../../automation/lib";
const {createLocalGitRefStore} = await import(`${REPO}/task-lease-git-store.mjs`);
const {claim, renew, release} = await import(`${REPO}/task-lease.mjs`);
const {verifyVerdict, bindVerdict} = await import(`${REPO}/lease-verdict.mjs`);

const HERE = import.meta.dirname;
const tmpRoot = mkdtempSync(path.join(HERE, ".proof-repos-"));
let repoSeq = 0, passed = 0, failed = 0;

const git = (cwd, args, input) => {
  const r = spawnSync("git", args, {cwd, input, encoding: "utf8"});
  return {status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? ""};
};
function newRepo() {
  const dir = path.join(tmpRoot, `repo${++repoSeq}`);
  const init = spawnSync("git", ["init", "-q", dir], {encoding: "utf8"});
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return {dir, store: createLocalGitRefStore({repoDir: dir})};
}
const leaseRefs = (dir) => git(dir, ["for-each-ref", "--format=%(refname)", "refs/uasco/claims/"]).stdout.split("\n").filter(Boolean);
const leaseOnDisk = (dir, id) => {
  const sha = git(dir, ["rev-parse", "--verify", "-q", `refs/uasco/claims/${id}`]);
  if (sha.status !== 0) return null;
  return JSON.parse(git(dir, ["cat-file", "blob", sha.stdout.trim()]).stdout);
};

function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail !== undefined ? `\n        got: ${JSON.stringify(detail)}` : ""}`); }
}
async function section(title, fn) {
  console.log(`\n== ${title}`);
  try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${title}: threw ${e?.stack ?? e}`); }
}
const ids = (xs) => xs.map((t) => t.id);

const now = 1_000_000, ttlMs = 60_000;
const me = {environment: "CLOUD", workerId: "cloud-w1", sessionId: "sess-cloud-1"};
const other = {environment: "CLOUD", workerId: "cloud-w2", sessionId: "sess-cloud-2"};
const task = (id, status, o = {}) => ({id, owner: "CLOUD", status, authorizedBy: "founder", dependsOn: [], ...o});

try {
  // ---------------------------------------------------------------- 1 + 2
  const r12 = newRepo();
  const headline = [
    task("A", "AWAITING_LOCAL", {handedTo: "LOCAL"}),          // handed to Local: must NOT block anything
    task("B", "READY"),                                         // the only selectable task
    task("C", "READY", {dependsOn: ["x"]}),                     // x is not done -> dependency-blocked
    task("D", "READY", {owner: "FOUNDER"}),                     // wrong owner
  ];

  await section("1. HEADLINE: AWAITING_LOCAL does not block an independent READY task", () => {
    const res = selectNext(headline, {store: r12.store, owner: me, now, ttlMs});
    ok(res.action === "START", "action is START", res);
    ok(res.task?.id === "B", "selected task is B (A not blocking, C dep-blocked, D wrong owner)", res.task?.id);
    const onDisk = leaseOnDisk(r12.dir, "B");
    ok(onDisk !== null, "lease ref refs/uasco/claims/B exists in the git repo");
    ok(onDisk?.environment === me.environment && onDisk?.workerId === me.workerId && onDisk?.sessionId === me.sessionId, "lease ref belongs to this owner", onDisk);
    ok(onDisk?.taskId === "B" && onDisk?.epoch === 1 && onDisk?.token === res.lease?.token, "returned lease == on-disk lease (taskId B, epoch 1, same token)", {onDisk, lease: res.lease});
    ok(leaseRefs(r12.dir).join() === "refs/uasco/claims/B", "no lease was taken for A, C or D", leaseRefs(r12.dir));
  });

  await section("2. SINGLE OWNERSHIP: a different owner cannot also START B", () => {
    const res = selectNext(headline, {store: r12.store, owner: other, now: now + 1000, ttlMs});
    ok(res.action !== "START", "second owner does NOT start B", res);
    ok(res.action === "NO_READY_WORK", "second owner gets NO_READY_WORK (B held, others not selectable)", res);
    ok(ids(res.held ?? []).join() === "B", "B reported as held elsewhere", ids(res.held ?? []));
    const onDisk = leaseOnDisk(r12.dir, "B");
    ok(onDisk?.sessionId === me.sessionId && onDisk?.epoch === 1, "lease on disk is still owner #1, epoch 1", onDisk);
    const again = selectNext(headline, {store: r12.store, owner: me, now: now + 2000, ttlMs});
    ok(again.action === "START" && again.task.id === "B" && again.lease.token === leaseOnDisk(r12.dir, "B").token, "original owner re-selecting B resumes its own lease (idempotent START, same token)", again);
  });

  // ---------------------------------------------------------------- 3
  await section("3. NO_READY_WORK: only an AWAITING_LOCAL task (Local hand-off) -> no hang", () => {
    const {dir, store} = newRepo();
    const res = selectNext([task("A", "AWAITING_LOCAL")], {store, owner: me, now, ttlMs});
    ok(res.action === "NO_READY_WORK", "[A AWAITING_LOCAL] -> NO_READY_WORK", res);
    ok(leaseRefs(dir).length === 0, "no lease taken");
    const mixed = selectNext([task("A", "AWAITING_LOCAL"), task("E", "DONE"), task("F", "BLOCKED"), task("G", "DRAFT_NOT_READY"), task("H", "READY", {owner: "LOCAL"})], {store, owner: me, now, ttlMs});
    ok(mixed.action === "NO_READY_WORK", "AWAITING_LOCAL/DONE/BLOCKED/DRAFT_NOT_READY/LOCAL-owned READY -> NO_READY_WORK", mixed);
    ok(selectNext([], {store, owner: me, now, ttlMs}).action === "NO_READY_WORK", "empty backlog -> NO_READY_WORK");
    ok(selectNext([task("E", "DONE")], {store, owner: me, now, ttlMs}).action === "NO_READY_WORK", "everything DONE -> NO_READY_WORK");
  });

  // ---------------------------------------------------------------- 4
  await section("4. AUTHORITY_REQUIRED: only FOUNDER-owned or unauthorised work remains", () => {
    const {dir, store} = newRepo();
    const run = (b) => selectNext(b, {store, owner: me, now, ttlMs});
    let res = run([task("D", "READY", {owner: "FOUNDER"})]);
    ok(res.action === "AUTHORITY_REQUIRED" && ids(res.tasks).join() === "D", "[D READY FOUNDER] -> AUTHORITY_REQUIRED [D]", res);
    res = run([task("E", "READY", {authorizedBy: null})]);
    ok(res.action === "AUTHORITY_REQUIRED" && ids(res.tasks).join() === "E", "[E READY CLOUD authorizedBy=null] -> AUTHORITY_REQUIRED [E]", res);
    res = run([task("E", "READY", {authorizedBy: ""})]);
    ok(res.action === "AUTHORITY_REQUIRED", "authorizedBy empty string -> AUTHORITY_REQUIRED", res);
    res = run([task("A", "AWAITING_LOCAL"), task("D", "READY", {owner: "FOUNDER"}), task("X", "DONE")]);
    ok(res.action === "AUTHORITY_REQUIRED", "AWAITING_LOCAL/DONE alongside FOUNDER work does not mask it", res);
    res = run([task("E", "READY", {authorizedBy: null}), task("B", "READY")]);
    ok(res.action === "START" && res.task.id === "B", "an unauthorised task does not block an authorised independent one (START B)", res);
    ok(leaseRefs(dir).join() === "refs/uasco/claims/B", "only B was leased across this section", leaseRefs(dir));
  });

  // ---------------------------------------------------------------- 5
  await section("5. BLOCKED: remaining READY work is all dependency-blocked", () => {
    const {dir, store} = newRepo();
    const run = (b) => selectNext(b, {store, owner: me, now, ttlMs});
    let res = run([task("C", "READY", {dependsOn: ["x"]}), task("x", "BLOCKED")]);
    ok(res.action === "BLOCKED" && ids(res.tasks).join() === "C", "[C deps=[x], x BLOCKED] -> BLOCKED [C]", res);
    res = run([task("C", "READY", {dependsOn: ["x"]}), task("x", "AWAITING_LOCAL")]);
    ok(res.action === "BLOCKED", "dependency waiting on a Local hand-off -> BLOCKED (not a hang, not START)", res);
    res = run([task("C", "READY", {dependsOn: ["x"]})]);
    ok(res.action === "BLOCKED", "dependency id absent from the backlog -> BLOCKED (fail closed)", res);
    res = run([task("C", "READY", {dependsOn: ["x", "y"]}), task("x", "DONE"), task("y", "DRAFT_NOT_READY")]);
    ok(res.action === "BLOCKED", "one of two dependencies done is still BLOCKED", res);
    res = run([task("C", "READY", {dependsOn: ["x"]}), task("x", "DONE")]);
    ok(res.action === "START" && res.task.id === "C", "once the dependency is DONE, C becomes selectable (START C)", res);
    const blockedOnly = newRepo();
    selectNext([task("C", "READY", {dependsOn: ["x"]}), task("x", "BLOCKED")], {store: blockedOnly.store, owner: me, now, ttlMs});
    ok(leaseRefs(blockedOnly.dir).length === 0, "no lease is taken for a BLOCKED outcome");
  });

  // ---------------------------------------------------------------- 6
  await section("6. LEASE CONTROLS: renew / expiry reclaim / stale token / release (real git-ref store)", () => {
    const {dir, store} = newRepo();
    const T = "L1", life = 1000;
    const g1 = claim(store, {...me, taskId: T, now: 10_000, ttlMs: life});
    ok(g1.status === "GRANTED" && g1.record.epoch === 1, "owner #1 claim -> GRANTED epoch 1", g1);
    const rn = renew(store, {...me, taskId: T, token: g1.record.token, now: 10_500, ttlMs: life});
    ok(rn.status === "RENEWED" && rn.record.token === g1.record.token && rn.record.expiresAt === 11_500, "renew keeps ownership (same token, expiresAt extended to 11500)", rn);
    const dk = leaseOnDisk(dir, T);
    ok(dk?.sessionId === me.sessionId && dk?.epoch === 1 && dk?.expiresAt === 11_500, "renewed record is what git holds (still owner #1, epoch 1)", dk);
    const early = claim(store, {...other, taskId: T, now: 11_000, ttlMs: life});
    ok(early.status === "HELD", "owner #2 before expiry -> HELD", early);
    const tk = claim(store, {...other, taskId: T, now: 11_501, ttlMs: life});
    ok(tk.status === "GRANTED" && tk.record.epoch === 2, "after expiry owner #2 reclaims -> GRANTED with epoch+1 (2)", tk);
    ok(tk.previous?.token === g1.record.token, "takeover reports the previous (expired) holder", tk.previous);
    ok(leaseOnDisk(dir, T)?.sessionId === other.sessionId, "git now holds owner #2");
    const stale = renew(store, {...me, taskId: T, token: g1.record.token, now: 11_600, ttlMs: life});
    ok(stale.status === "LOST", "stale-token renew by the former holder -> LOST", stale);
    ok(release(store, {...me, taskId: T, token: g1.record.token}).status === "NOOP" && leaseOnDisk(dir, T)?.sessionId === other.sessionId, "stale-token release is a NOOP and does not free the new holder's lease");
    const rn2 = renew(store, {...other, taskId: T, token: tk.record.token, now: 11_700, ttlMs: life});
    ok(rn2.status === "RENEWED", "current holder still renews fine", rn2);
    const rl = release(store, {...other, taskId: T, token: tk.record.token});
    ok(rl.status === "RELEASED", "release by the holder -> RELEASED", rl);
    ok(leaseOnDisk(dir, T) === null && store.read(T) === null, "released lease ref is gone from git");
    const again = claim(store, {...me, taskId: T, now: 11_800, ttlMs: life});
    ok(again.status === "GRANTED", "after release the task can be claimed again", again);
    // engine-level reclaim: an expired lease is taken over through selectNext
    const e = newRepo();
    const first = selectNext([task("B", "READY")], {store: e.store, owner: me, now, ttlMs});
    const mid = selectNext([task("B", "READY")], {store: e.store, owner: other, now: now + ttlMs, ttlMs});
    const late = selectNext([task("B", "READY")], {store: e.store, owner: other, now: now + ttlMs + 1, ttlMs});
    ok(first.action === "START" && mid.action === "NO_READY_WORK" && late.action === "START" && late.lease.epoch === 2 && late.previous?.token === first.lease.token,
      "selectNext: held at the expiry boundary, reclaimed one ms later (epoch 2, previous reported)", {first: first.action, mid: mid.action, late: late.action, epoch: late.lease?.epoch});
  });

  // ---------------------------------------------------------------- 7
  await section("7. RECOVERABLE_FAILURE: a throwing store is classified, never crashes", () => {
    const real = newRepo().store;
    const boom = (m) => () => { throw new Error(m); };
    const backlog = [task("B", "READY")];
    const readThrows = {...real, read: boom("store read exploded")};
    let res;
    try { res = selectNext(backlog, {store: readThrows, owner: me, now, ttlMs}); } catch (e) { res = {threw: String(e)}; }
    ok(res.action === "RECOVERABLE_FAILURE", "store.read throws -> RECOVERABLE_FAILURE (no exception escapes)", res);
    ok(/store read exploded/.test(res.reason ?? "") && res.retryable === true && res.taskId === "B", "reason carries the error, retryable:true, names the task", res);
    const createThrows = {...real, createIfAbsent: boom("create exploded")};
    try { res = selectNext(backlog, {store: createThrows, owner: me, now, ttlMs}); } catch (e) { res = {threw: String(e)}; }
    ok(res.action === "RECOVERABLE_FAILURE", "store.createIfAbsent throws (inside claim) -> RECOVERABLE_FAILURE", res);
    const goodAfter = selectNext(backlog, {store: real, owner: me, now, ttlMs});
    ok(goodAfter.action === "START", "after the transient failure a healthy store retries successfully (START)", goodAfter);
    // a store failure must not be disguised as "no work" when nothing is selectable: tasks that never touch the store stay classified
    const noWork = selectNext([task("A", "AWAITING_LOCAL")], {store: readThrows, owner: me, now, ttlMs});
    ok(noWork.action === "NO_READY_WORK", "a broken store is not touched (and not blamed) when nothing is selectable", noWork);
    let argErr = null;
    try { selectNext(backlog, {store: real, owner: {environment: "CLOUD"}, now, ttlMs}); } catch (e) { argErr = e; }
    ok(/NEXTSTEP_ARG_INVALID:owner\.workerId/.test(argErr?.message ?? ""), "programmer errors (bad owner) throw NEXTSTEP_ARG_INVALID rather than being retried as 'recoverable'", argErr?.message);
  });

  // ---------------------------------------------------------------- 8
  await section("8. SESSION-INDEPENDENT REVIEW: verdict bound to task + SHA + independent identity", () => {
    const {store} = newRepo();
    const started = selectNext([task("B", "READY")], {store, owner: me, now, ttlMs, headSha: "sha-good"});
    ok(started.action === "START" && started.lease.headSha === "sha-good", "implementer starts B under a lease pinned to sha-good", started);
    const implementerSessionId = started.lease.sessionId; // supervisor-owned, taken from the lease, not from the verdict
    const expected = {expectedTaskId: "B", expectedHeadSha: "sha-good", implementerSessionId, builderIdentity: "claude-builder"};
    const base = {taskId: "B", reviewedSha: "sha-good", reviewerSessionId: "sess-reviewer-9", implementerSessionId, result: "CLEAN", reviewerIdentity: "claude-reviewer", builderIdentity: "claude-builder"};
    const verdict = bindVerdict(base);
    const good = verifyVerdict(verdict, expected);
    ok(good.ok === true && good.reason === "OK", "valid independent CLEAN at the right SHA/task/identity is ACCEPTED", good);
    const stale = verifyVerdict(bindVerdict({...base, reviewedSha: "sha-old"}), expected);
    ok(stale.ok === false && stale.reason === "STALE_SHA", "stale-SHA verdict is REJECTED (STALE_SHA)", stale);
    const moved = verifyVerdict(verdict, {...expected, expectedHeadSha: "sha-newer"});
    ok(moved.ok === false && moved.reason === "STALE_SHA", "head moved after review -> same verdict REJECTED (STALE_SHA)", moved);
    const selfSess = verifyVerdict(bindVerdict({...base, reviewerSessionId: implementerSessionId}), expected);
    ok(selfSess.ok === false && selfSess.reason === "NOT_INDEPENDENT", "reviewer session == implementer session REJECTED (NOT_INDEPENDENT)", selfSess);
    const selfId = verifyVerdict(bindVerdict({...base, reviewerIdentity: "claude-builder"}), expected);
    ok(selfId.ok === false && selfId.reason === "SAME_IDENTITY", "reviewer identity == builder identity REJECTED (SAME_IDENTITY)", selfId);
    const selfCase = verifyVerdict(bindVerdict({...base, reviewerIdentity: "  CLAUDE-Builder "}), expected);
    ok(selfCase.ok === false && selfCase.reason === "SAME_IDENTITY", "case/whitespace variant of the builder identity REJECTED (SAME_IDENTITY)", selfCase);
    const wrongTask = verifyVerdict(bindVerdict({...base, taskId: "C"}), expected);
    ok(wrongTask.ok === false && wrongTask.reason === "TASK_MISMATCH", "verdict for another task REJECTED (TASK_MISMATCH)", wrongTask);
    const notClean = verifyVerdict(bindVerdict({...base, result: "BLOCKED"}), expected);
    ok(notClean.ok === false && notClean.reason === "NOT_CLEAN:BLOCKED", "non-CLEAN verdict is not accepted (NOT_CLEAN:BLOCKED)", notClean);
    const forgedImpl = verifyVerdict(bindVerdict({...base, implementerSessionId: "someone-else"}), expected);
    ok(forgedImpl.ok === false && forgedImpl.reason === "NOT_INDEPENDENT", "verdict naming a different implementer than the supervisor's REJECTED (NOT_INDEPENDENT)", forgedImpl);
  });

  // ---------------------------------------------------------------- 9 (extras)
  await section("9. ENGINE EXTRAS: priority order, skip-held-continue, poison task id", () => {
    const {dir, store} = newRepo();
    // B is held by someone else; selectNext must skip it and continue to the next selectable task.
    claim(store, {...other, taskId: "B", now, ttlMs});
    let res = selectNext([task("B", "READY"), task("E", "READY")], {store, owner: me, now: now + 5, ttlMs});
    ok(res.action === "START" && res.task.id === "E", "first selectable task is HELD elsewhere -> skipped, next one (E) is started", res);
    // explicit priority overrides array order
    const p = newRepo();
    res = selectNext([task("P1", "READY"), task("P2", "READY", {priority: 1}), task("P3", "READY", {priority: 0})], {store: p.store, owner: me, now, ttlMs});
    ok(res.action === "START" && res.task.id === "P3", "numeric priority (lowest first) beats array order", res);
    res = selectNext([task("Q1", "READY"), task("Q2", "READY")], {store: p.store, owner: me, now, ttlMs});
    ok(res.action === "START" && res.task.id === "Q1", "without priority, backlog array order is priority order", res);
    // a malformed task id must not starve an independent task nor crash
    res = selectNext([task("bad id with spaces", "READY"), task("G", "READY")], {store: p.store, owner: me, now, ttlMs});
    ok(res.action === "START" && res.task.id === "G", "task with an invalid id is skipped (LEASE_TASK_ID_INVALID), independent task G still starts", res);
    res = selectNext([task("bad id with spaces", "READY")], {store: p.store, owner: me, now, ttlMs});
    ok(res.action === "NO_READY_WORK" && res.skipped?.length === 1, "only an invalid-id task -> NO_READY_WORK with it reported under skipped", res);
    ok(!leaseRefs(dir).includes("refs/uasco/claims/bad id with spaces"), "no ref was created for the invalid id");
    // authority + dependency-blocked together: a human is needed, dep-blocked shown for context
    res = selectNext([task("D", "READY", {owner: "FOUNDER"}), task("C", "READY", {dependsOn: ["x"]})], {store: p.store, owner: me, now, ttlMs});
    ok(res.action === "AUTHORITY_REQUIRED" && ids(res.blocked).join() === "C", "FOUNDER work + dep-blocked work -> AUTHORITY_REQUIRED (blocked listed for context)", res);
  });
} finally {
  rmSync(tmpRoot, {recursive: true, force: true});
}

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: ALL CHECKS PASS" : "RESULT: FAILURES PRESENT");
process.exit(failed === 0 ? 0 : 1);
