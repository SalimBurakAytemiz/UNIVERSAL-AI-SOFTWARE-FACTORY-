// //TR: Factory V2 kabul matrisi (A1-A17): gerçek alt süreçlerle 8 Builder/4 Reviewer/3 Preparer eşzamanlılığı, tek Writer/tek Supervisor dışlaması, lease fencing, çökme kurtarma, worktree izolasyonu, review/CI bütünlüğü, bloklu görev yalıtımı, kota, ölçekleme, uçtan uca teslim, V4.1 birlikte yaşam ve güvenli devir. A18 (canlı aktivasyon kanıtı) bu testlerin kapsamı dışındadır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {makeRepo, makeSupervisor, runUntil, tasks, git} from "./harness.mjs";
import {maxOverlap} from "../../automation/factory-v2/supervisor.mjs";
import {buildTopology, reconfigure, INITIAL_TARGET, validateTarget} from "../../automation/factory-v2/topology.mjs";
import {Ownership, createGitStore, createMemoryStore, supervisorLeaseId, NAMESPACES} from "../../automation/factory-v2/ownership.mjs";
import {StateJournal} from "../../automation/factory-v2/state-journal.mjs";
import {readyTasks, assign, liveOwnedTasks, scopesOverlap} from "../../automation/factory-v2/scheduler.mjs";
import {reviewAuthorizes, requiredFocuses, riskOf} from "../../automation/factory-v2/review.mjs";
import {prepareAll, prepareCandidate, writeMerges} from "../../automation/factory-v2/merge.mjs";
import {decideBuilders, quotaMode, pickForWindow} from "../../automation/factory-v2/quota-governor.mjs";
import {classify, nextRetry} from "../../automation/factory-v2/failures.mjs";
import {handover} from "../../automation/factory-v2/cutover.mjs";
import {createLocalGitIntegration} from "../../automation/factory-v2/merge-git.mjs";
import {createWorktree} from "../../automation/factory-v2/executors.mjs";

const T = 120_000;
const S1 = "1".repeat(40), S2 = "2".repeat(40), S3 = "3".repeat(40);
const clean = (id, focus, head = S2, base = S1) => ({reviewerId: id, reviewerIdentity: id, focus, status: "CLEAN", headSha: head, baseSha: base, blockers: [], resolves: []});

describe("factory-v2 topology", () => {
  it("initial target is 8+4+3+1+1 = 17 and exclusivity roles are fixed at 1", () => {
    const t = buildTopology();
    expect(INITIAL_TARGET).toEqual({builders: 8, reviewers: 4, mergePreparers: 3, mergeWriters: 1, supervisors: 1});
    expect(t.slots.length).toBe(17);
    expect(t.slots.filter(s => s.role === "BUILDER").map(s => s.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"].map(x => `builder-${x}`));
    expect(() => validateTarget({...INITIAL_TARGET, mergeWriters: 2})).toThrow(/mergeWriters/);
    expect(() => validateTarget({...INITIAL_TARGET, supervisors: 2})).toThrow(/supervisors/);
  });
  it("A13: reconfigures 8 -> 10 -> 12 and drains (never preempts) busy slots when shrinking", () => {
    let t = buildTopology();
    const r10 = reconfigure(t, {...INITIAL_TARGET, builders: 10});
    expect(r10.slots.filter(s => s.role === "BUILDER").length).toBe(10);
    const r12 = reconfigure(r10, {...INITIAL_TARGET, builders: 12});
    expect(r12.added).toEqual(["builder-X11", "builder-X12"]);
    const down = reconfigure(r12, {...INITIAL_TARGET, builders: 8}, new Set(["builder-X12"]));
    expect(down.draining).toEqual(["builder-X12"]);
    expect(down.removed).toContain("builder-X11");
  });
});

describe("factory-v2 real concurrency (child processes, isolated worktrees)", () => {
  it("A1 + A2 + A3 + A14: 8 builders overlap, 4 reviewers overlap, 3 preparers, single writer, post-merge verified", {timeout: T}, async () => {
    process.env.FACTORY_HOLD_MS = "1500"; delete process.env.FACTORY_FAIL;
    const env = makeRepo();
    // tasks 1..4 are cross-system (paths with "worker") -> 3 reviewer focuses; this keeps 4 reviewers busy at once
    const backlog = tasks(8).map((t, i) => i < 2 ? {...t, tier: "T2", paths: [`work/worker-${t.id}.txt`]} : t);
    const {sup, evidence} = makeSupervisor(env, {backlog});
    expect(sup.start().owner).toBe(true);
    const ok = await runUntil(sup, () => sup.journal.inState("VERIFIED").length === 8);
    expect(ok).toBe(true);
    const builders = sup.spans.filter(s => s.role === "BUILDER");
    const reviewers = sup.spans.filter(s => s.role === "REVIEWER");
    expect(new Set(builders.map(s => s.slotId)).size).toBe(8);
    expect(maxOverlap(builders)).toBe(8);
    expect(maxOverlap(reviewers)).toBeGreaterThanOrEqual(4);
    expect(new Set(evidence.filter(e => e.role === "BUILDER").map(e => e.pid)).size).toBe(8); // 8 distinct OS processes
    // every merged file reached the canonical branch through the writer, which only ever fast-moved via CAS
    for (const t of backlog) expect(git(env.repo, "cat-file", "-t", `integ:${t.paths[0]}`)).toBe("blob");
    const merges = git(env.repo, "log", "--merges", "--format=%s", "integ").split("\n");
    expect(merges.length).toBe(8);
    // A10: every merged head had a CI result bound to that exact head
    for (const t of sup.journal.inState("VERIFIED")) expect(t.data.preparedHead).toBe(t.data.headSha);
    sup.stop();
  });

  it("A3: three preparers process independent candidates concurrently", async () => {
    const facts = Array.from({length: 6}, (_, i) => ({i}));
    const {spans} = await prepareAll(facts, 3, async () => { await new Promise(r => setTimeout(r, 150)); return {ready: true}; });
    expect(maxOverlap(spans)).toBe(3);
    expect(new Set(spans.map(s => s.worker))).toEqual(new Set(["preparer-1", "preparer-2", "preparer-3"]));
  });

  it("A8: builders cannot overwrite each other's uncommitted changes (separate worktrees and branches)", () => {
    const env = makeRepo();
    const a = createWorktree(env.repo, path.join(env.root, "wt"), {taskId: "X1", slotId: "builder-A", baseSha: env.base});
    const b = createWorktree(env.repo, path.join(env.root, "wt"), {taskId: "X2", slotId: "builder-B", baseSha: env.base});
    fs.writeFileSync(path.join(a.dir, "same.txt"), "A\n");
    fs.writeFileSync(path.join(b.dir, "same.txt"), "B\n");
    expect(a.dir).not.toBe(b.dir); expect(a.branch).not.toBe(b.branch);
    expect(fs.readFileSync(path.join(a.dir, "same.txt"), "utf8")).toBe("A\n");
    expect(fs.existsSync(path.join(env.repo, "same.txt"))).toBe(false);
  });
});

describe("factory-v2 exclusivity and fencing", () => {
  it("A5 + A16: a second supervisor stays STANDBY; handover transfers ownership and fences the old owner", () => {
    const env = makeRepo();
    const store = createGitStore(env.repo, "SHADOW");
    const {sup: s1} = makeSupervisor(env, {leaseStore: store, sessionId: "session_supervisorAA"});
    const {sup: s2} = makeSupervisor(env, {leaseStore: store, sessionId: "session_supervisorBB"});
    expect(s1.start().owner).toBe(true);
    const r2 = s2.start();
    expect(r2.owner).toBe(false); expect(r2.holder.sessionId).toBe("session_supervisorAA");
    const j = new StateJournal(path.join(env.root, "handover-journal"));
    const {owner} = handover({store, domain: "SHADOW-test", from: s1.lease, to: {environment: "cloud", workerId: "supervisor", sessionId: "session_supervisorBB", ttlMs: 60_000}, journal: j});
    expect(owner.holder().sessionId).toBe("session_supervisorBB");
    expect(() => s1.fence()).toThrow(/OWNERSHIP_LOST/);
    expect(j.events.some(e => e.kind === "HANDOVER")).toBe(true);
  });

  it("A5: after takeover the old supervisor's journal writes are rejected (stale fence epoch)", () => {
    const env = makeRepo();
    let now = 1_000_000;
    const store = createMemoryStore();
    const journalDir = path.join(env.root, "j");
    const {sup: s1} = makeSupervisor(env, {leaseStore: store, journalDir, sessionId: "session_supervisorAA", leaseTtlMs: 10_000, now: () => now});
    s1.start();
    now += 20_000; // s1 stalls past its TTL
    const {sup: s2} = makeSupervisor(env, {leaseStore: store, journalDir, sessionId: "session_supervisorBB", leaseTtlMs: 10_000, now: () => now});
    expect(s2.start().owner).toBe(true);
    expect(() => s1.fence()).toThrow(/OWNERSHIP_LOST/);
    expect(() => s1.journal.enqueue("ZOMBIE-T0001", {}, s1.fenceRef)).toThrow(/JOURNAL_STALE_FENCE/);
  });

  it("A4: concurrent writers cannot both write; CAS refuses a moved base", async () => {
    const env = makeRepo();
    const store = createGitStore(env.repo, "SHADOW");
    const w1 = new Ownership(store, {leaseId: "writer--integ", environment: "cloud", workerId: "merge-writer", sessionId: "session_writer11"});
    const w2 = new Ownership(store, {leaseId: "writer--integ", environment: "cloud", workerId: "merge-writer", sessionId: "session_writer22"});
    expect(w1.acquire().granted).toBe(true);
    const r = await writeMerges([{taskId: "x"}], {ownership: w2, git: {readCanonical: () => { throw new Error("must not read"); }}});
    expect(r.held).toBe(true);
    const integ = createLocalGitIntegration({repoDir: env.repo, branch: "integ", scratchDir: path.join(env.root, "s")});
    const wt = createWorktree(env.repo, path.join(env.root, "wt"), {taskId: "M1", slotId: "builder-A", baseSha: env.base});
    fs.writeFileSync(path.join(wt.dir, "m.txt"), "m\n"); git(wt.dir, "add", "m.txt"); git(wt.dir, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "m");
    const head = git(wt.dir, "rev-parse", "HEAD");
    const ok = await integ.merge({taskId: "M1", headSha: head}, env.base);
    expect(ok.ok).toBe(true);
    const stale = await integ.merge({taskId: "M1", headSha: head}, env.base); // base moved underneath
    expect(stale).toEqual({ok: false, reason: "BASE_MOVED"});
  });

  it("A6: a worker whose task lease expired cannot commit its result", {timeout: T}, async () => {
    process.env.FACTORY_HOLD_MS = "800"; delete process.env.FACTORY_FAIL;
    const env = makeRepo();
    let skew = 0;
    const store = createMemoryStore();
    const {sup} = makeSupervisor(env, {leaseStore: store, backlog: tasks(1), leaseTtlMs: 30_000, now: () => Date.now() + skew});
    sup.start();
    await sup.tick();
    expect(sup.journal.inState("BUILDING").length).toBe(1);
    // simulate the worker's lease being lost: another owner takes the task lease while the process still runs
    const t = sup.journal.inState("BUILDING")[0];
    sup.taskLeases.get(t.taskId).renew = () => false;
    skew = 31_000;
    const thief = new Ownership(store, {leaseId: `task--${t.taskId}`, environment: "cloud", workerId: "other", sessionId: "session_otherxxx", now: () => Date.now() + skew});
    expect(thief.acquire().granted).toBe(true);
    skew = 0; sup.lease.now = () => Date.now(); // keep the supervisor itself alive
    await new Promise(r => setTimeout(r, 1500));
    expect(sup.journal.events.some(e => e.kind === "FENCED_RESULT_DISCARDED")).toBe(true);
    expect(sup.journal.get(t.taskId).state).toBe("RETRY_WAIT"); // slot freed; the result was never accepted
    expect(sup.journal.get(t.taskId).data.headSha).toBeUndefined();
  });
});

describe("factory-v2 recovery and isolation", () => {
  it("A7: a restarted supervisor recovers orphaned work but leaves validly-owned work alone; enqueue is idempotent", () => {
    const env = makeRepo();
    const store = createMemoryStore();
    const journalDir = path.join(env.root, "j");
    let now = 5_000_000;
    const j = new StateJournal(journalDir);
    const f = j.openEpoch("old", "tok");
    for (const id of ["R-T0001", "R-T0002"]) { j.enqueue(id, {}, f); j.transition(id, "CLAIMED", {fence: f}); j.transition(id, "BUILDING", {fence: f}); }
    expect(j.enqueue("R-T0001", {}, f).duplicate).toBe(true);
    // R-T0002 is still owned by a live worker elsewhere
    new Ownership(store, {leaseId: "task--R-T0002", environment: "cloud", workerId: "builder-C", sessionId: "session_liveworker", now: () => now}).acquire();
    const {sup} = makeSupervisor(env, {leaseStore: store, journalDir, backlog: [], now: () => now});
    sup.start();
    expect(sup.journal.get("R-T0001").state).toBe("RETRY_WAIT");
    expect(sup.journal.get("R-T0001").attempt).toBe(1);
    expect(sup.journal.get("R-T0002").state).toBe("BUILDING");
  });

  it("A11 + A17: injected crash, reviewer auth failure, builder auth failure — unrelated tasks still deliver", {timeout: T}, async () => {
    process.env.FACTORY_HOLD_MS = "300";
    const backlog = tasks(6);
    process.env.FACTORY_FAIL = JSON.stringify({[backlog[0].id]: {crash: 1}, [backlog[1].id]: {review: "auth"}, [backlog[2].id]: {auth: true}, [backlog[3].id]: {review: "changes"}});
    const env = makeRepo();
    const {sup} = makeSupervisor(env, {backlog});
    sup.start();
    // the crashed task retries after backoff (2s); others proceed independently
    await runUntil(sup, () => sup.journal.inState("VERIFIED").length >= 4 && sup.journal.inState("BLOCKED").length >= 2, {timeoutMs: 90_000});
    const st = id => sup.journal.get(id).state;
    expect(st(backlog[0].id)).toBe("VERIFIED"); // crash -> bounded retry -> delivered
    expect(st(backlog[1].id)).toBe("BLOCKED"); // reviewer auth failure never became CLEAN
    expect(sup.journal.get(backlog[1].id).data.lastReviewReasons.join()).toMatch(/REVIEW_FAILED:REVIEWER_AUTH_REJECTED/);
    expect(st(backlog[2].id)).toBe("BLOCKED"); // authorization error: no retry loop
    expect(st(backlog[3].id)).toBe("VERIFIED"); // changes requested -> remediation -> blocker resolved -> merged
    expect(st(backlog[4].id)).toBe("VERIFIED"); expect(st(backlog[5].id)).toBe("VERIFIED");
    delete process.env.FACTORY_FAIL;
  });
});

describe("factory-v2 review and CI integrity (A9, A10)", () => {
  const req = ["ARCHITECTURE_CORRECTNESS", "SECURITY_ISOLATION"];
  const ok = {verdicts: [clean("R1", req[0]), clean("R2", req[1])], required: req, baseSha: S1, headSha: S2, builderIdentity: "builder-A"};
  it("authorizes only exact-SHA, independent, clean, blocker-free verdicts", () => {
    expect(reviewAuthorizes(ok).authorized).toBe(true);
    expect(reviewAuthorizes({...ok, headSha: S3}).reasons).toContain("STALE_REVIEW");
    expect(reviewAuthorizes({...ok, verdicts: [clean("R1", req[0]), {...clean("R2", req[1]), status: "REVIEWER_AUTH_REJECTED"}]}).reasons).toContain("REVIEW_FAILED:REVIEWER_AUTH_REJECTED");
    expect(reviewAuthorizes({...ok, builderIdentity: "R1"}).authorized).toBe(false);
    expect(reviewAuthorizes({...ok, priorBlockers: [{id: "B-1"}]}).reasons).toContain("UNRESOLVED_PRIOR_BLOCKER:B-1");
    expect(reviewAuthorizes({...ok, verdicts: [clean("R1", req[0]), {...clean("R1", req[1])}]}).reasons).toContain("DUAL_REVIEW_NOT_INDEPENDENT");
  });
  it("risk-aware allocation: low risk needs one reviewer, security/cross-system add focuses", () => {
    expect(requiredFocuses(riskOf({paths: ["docs/x.md"], tier: "T0"}))).toEqual(["ARCHITECTURE_CORRECTNESS"]);
    expect(requiredFocuses(riskOf({paths: ["core/auth/token.ts"], tier: "T1"}))).toContain("SECURITY_ISOLATION");
    expect(requiredFocuses(riskOf({paths: ["automation/factory-v2/scheduler.mjs"], tier: "T1"}))).toContain("ADVERSARIAL_CROSS_SYSTEM");
  });
  it("CI must be bound to the head SHA; protected paths and scope violations block; GitHub 'mergeable' is not a check", () => {
    const base = {candidate: {taskId: "t", headSha: S2, baseSha: S1, changedPaths: ["work/a.txt"], diffSource: "GIT_DIFF", allowedPaths: ["work/"], builderIdentity: "builder-A", required: ["ARCHITECTURE_CORRECTNESS"]},
      canonicalSha: S1, verdicts: [clean("R1", "ARCHITECTURE_CORRECTNESS")], ci: {sha: S2, requiredContexts: {validate: "success"}}, protectedPaths: {exactPaths: [], protectedPrefixes: ["config/"]}, githubMergeable: true};
    expect(prepareCandidate(base).ready).toBe(true);
    expect(prepareCandidate({...base, ci: {sha: S3, requiredContexts: {validate: "success"}}}).reasons).toContain("CI_NOT_BOUND_TO_HEAD");
    expect(prepareCandidate({...base, ci: {sha: S2, requiredContexts: {}}}).reasons).toContain("CI_REQUIRED_CONTEXTS_MISSING");
    expect(prepareCandidate({...base, ci: {sha: S2, requiredContexts: {validate: "failure"}}}).ready).toBe(false);
    expect(prepareCandidate({...base, candidate: {...base.candidate, changedPaths: ["config/x.json"], allowedPaths: ["config/"]}}).reasons.join()).toMatch(/PROTECTED_PATH_FOUNDER_REQUIRED/);
    expect(prepareCandidate({...base, candidate: {...base.candidate, changedPaths: ["src/y.ts"]}}).reasons.join()).toMatch(/SCOPE_VIOLATION/);
  });
});

describe("factory-v2 quota governor and backpressure (A12)", () => {
  const s = {target: 8, current: 8, readyBacklog: 20, reviewQueue: 0, ciQueue: 0, mergeQueue: 0, reviewerSlots: 4};
  it("normal -> full target; high usage halves; session limit / weekly exhaustion stop model calls; recovery resumes", () => {
    expect(decideBuilders({...s, quota: quotaMode({weeklyUsedPct: 31})}).builders).toBe(8);
    expect(decideBuilders({...s, quota: quotaMode({weeklyUsedPct: 95})}).builders).toBe(4);
    const lim = decideBuilders({...s, quota: quotaMode({sessionLimited: true, retryAfterMs: 60_000})});
    expect(lim).toMatchObject({builders: 0, modelCallsAllowed: false});
    expect(decideBuilders({...s, quota: quotaMode({weeklyUsedPct: 100, resetAt: 1})}).modelCallsAllowed).toBe(false);
    expect(decideBuilders({...s, quota: quotaMode({providerHealthy: false})}).builders).toBe(4);
    expect(decideBuilders({...s, current: 4, quota: quotaMode({weeklyUsedPct: 2})}).builders).toBe(5); // reset -> step back up
  });
  it("backpressure lowers builders and redirects capacity; hysteresis scales up one step at a time", () => {
    const d = decideBuilders({...s, reviewQueue: 12, quota: {mode: "NORMAL"}});
    expect(d.builders).toBe(7); expect(d.redirect).toContain("REVIEW_REMEDIATION");
    expect(decideBuilders({...s, current: 6, reviewQueue: 5, quota: {mode: "NORMAL"}}).builders).toBe(6); // between watermarks: hold
    expect(decideBuilders({...s, readyBacklog: 3, quota: {mode: "NORMAL"}}).builders).toBe(3);
    expect(pickForWindow([{id: "a", estimateHours: 1}, {id: "b", estimateHours: 9}, {id: "c", estimateHours: 9, checkpointable: true}], 4).map(t => t.id)).toEqual(["a", "c"]);
  });
  it("failure classes: transient retried with bounded backoff, auth/security never retried", () => {
    expect(classify(new Error("429 RATE_LIMIT"))).toBe("TEMPORARY");
    expect(nextRetry(new Error("ECONNRESET"), 1)).toMatchObject({action: "RETRY", delayMs: 2000});
    expect(nextRetry(new Error("ECONNRESET"), 3).action).toBe("FAIL");
    expect(nextRetry(new Error("REVIEWER_AUTH_REJECTED"), 1).action).toBe("BLOCK");
    expect(nextRetry(new Error("SECRET_LEAK detected"), 1).action).toBe("BLOCK");
  });
});

describe("factory-v2 coexistence with the live V4.1 runtime (A15)", () => {
  it("SHADOW uses an isolated ref namespace; LIVE excludes tasks the live runtime owns", () => {
    expect(NAMESPACES.SHADOW).not.toBe(NAMESPACES.LIVE);
    expect(NAMESPACES.SHADOW.startsWith(NAMESPACES.LIVE)).toBe(false);
    const live = liveOwnedTasks({autonomyState: {inFlight: [{task: "CLOUD-T0005"}]}, openPrs: [{body: "x\nUASCO-TASK: CLOUD-T0002\n"}]});
    expect([...live].sort()).toEqual(["CLOUD-T0002", "CLOUD-T0005"]);
    const backlog = [{id: "CLOUD-T0005", status: "PROPOSED"}, {id: "CLOUD-T0002", status: "PROPOSED"}, {id: "CLOUD-T0099", status: "PROPOSED"}];
    expect(readyTasks(backlog, {excluded: live}).map(t => t.id)).toEqual(["CLOUD-T0099"]);
  });
  it("dependency and file-scope rules: unmet deps and start gates are never dispatched; overlapping scopes are not run together", () => {
    const b = [{id: "A-T0001", deps: [], status: "PROPOSED"}, {id: "A-T0002", deps: ["A-T0001"], status: "PROPOSED"}, {id: "A-T0003", deps: [], startGates: ["D-08"], status: "PROPOSED"}];
    expect(readyTasks(b).map(t => t.id)).toEqual(["A-T0001"]);
    expect(scopesOverlap(["core/x/"], ["core/x/y.ts"])).toBe(true);
    const a = assign([{id: "1", paths: ["core/x/a.ts"]}, {id: "2", paths: ["core/x/a.ts"]}, {id: "3", paths: ["core/y.ts"]}], buildTopology().slots.filter(s => s.role === "BUILDER"));
    expect(a.map(x => x.taskId)).toEqual(["1", "3"]);
  });
  it("supervisor lease ids for SHADOW and LIVE domains never collide", () => {
    expect(supervisorLeaseId("SHADOW-uasco")).not.toBe(supervisorLeaseId("LIVE-uasco"));
  });
});

describe("factory-v2 reviewer allocation", () => {
  it("prefers specialists, falls back to any independent idle reviewer, never the builder", async () => {
    const {allocateReviewers} = await import("../../automation/factory-v2/review.mjs");
    const idle = buildTopology().slots.filter(s => s.role === "REVIEWER").map(s => ({...s, identity: s.id}));
    const a = allocateReviewers(["ARCHITECTURE_CORRECTNESS"], idle.filter(r => r.id !== "reviewer-R1"), "builder-A");
    expect(a.complete).toBe(true); expect(a.picks[0].focus).toBe("ARCHITECTURE_CORRECTNESS"); expect(a.picks[0].specialist).toBe(false);
    const b = allocateReviewers(["ARCHITECTURE_CORRECTNESS", "SECURITY_ISOLATION"], idle, "builder-A");
    expect(b.picks.map(p => p.id).sort()).toEqual(["reviewer-R1", "reviewer-R2"]); expect(b.picks.every(p => p.specialist)).toBe(true);
    expect(allocateReviewers(["ARCHITECTURE_CORRECTNESS"], [{...idle[0], identity: "builder-A"}], "builder-A").complete).toBe(false);
  });
});

describe("factory-v2 reviewer blockers (review of 2c94f31)", () => {
  const S = "1".repeat(40), H = "2".repeat(40);
  const v = {reviewerId: "reviewer-R1", reviewerIdentity: "reviewer-R1", focus: "ARCHITECTURE_CORRECTNESS", status: "CLEAN", headSha: H, baseSha: S, blockers: [], resolves: []};
  it("B1: missing/empty review requirements and zero verdicts never authorize", () => {
    expect(reviewAuthorizes({verdicts: [], required: [], baseSha: S, headSha: H, builderIdentity: "builder-A"}).reasons).toEqual(expect.arrayContaining(["REVIEW_REQUIREMENTS_MISSING", "NO_CLEAN_REVIEW_AT_HEAD"]));
    expect(reviewAuthorizes({verdicts: [v], required: undefined, baseSha: S, headSha: H, builderIdentity: "builder-A"}).authorized).toBe(false);
    const f = {candidate: {taskId: "t", headSha: H, baseSha: S, changedPaths: ["work/a"], diffSource: "GIT_DIFF", allowedPaths: ["work/"], builderIdentity: "builder-A"}, canonicalSha: S, verdicts: [], ci: {sha: H, requiredContexts: {v: "success"}}};
    expect(prepareCandidate(f).ready).toBe(false);
    expect(prepareCandidate({...f, candidate: {...f.candidate, required: ["ARCHITECTURE_CORRECTNESS"], diffSource: undefined}, verdicts: [v]}).reasons).toContain("CHANGED_PATHS_UNVERIFIED");
  });
  it("self-review is refused even when only reviewerId (not reviewerIdentity) matches the builder", () => {
    const r = reviewAuthorizes({verdicts: [{...v, reviewerId: "builder-A"}], required: ["ARCHITECTURE_CORRECTNESS"], baseSha: S, headSha: H, builderIdentity: "builder-A"});
    expect(r.reasons).toContain("SELF_REVIEW:builder-A");
  });
  it("B2: a builder that under-reports its changes is caught by the supervisor's own git diff", {timeout: 120_000}, async () => {
    process.env.FACTORY_HOLD_MS = "200";
    const backlog = tasks(2);
    process.env.FACTORY_FAIL = JSON.stringify({[backlog[0].id]: {lie: true}});
    const env = makeRepo();
    const {sup} = makeSupervisor(env, {backlog});
    sup.start();
    await runUntil(sup, () => sup.journal.get(backlog[0].id)?.state === "BLOCKED" && sup.journal.get(backlog[1].id)?.state === "VERIFIED", {timeoutMs: 60_000});
    const liar = sup.journal.get(backlog[0].id);
    expect(liar.state).toBe("BLOCKED");
    expect(liar.data.mergeBlock.join()).toMatch(/SCOPE_VIOLATION:.*config\/evil\.json|PROTECTED_PATH_FOUNDER_REQUIRED:config\/evil\.json/);
    expect(liar.data.changedPaths).toContain("config/evil.json");
    expect(liar.data.required).toContain("SECURITY_ISOLATION"); // risk from the true diff, not the claim
    expect(sup.journal.get(backlog[1].id).state).toBe("VERIFIED");
    expect(spawnSyncGit(env.repo, ["cat-file", "-e", "integ:config/evil.json"])).not.toBe(0);
    delete process.env.FACTORY_FAIL;
  });
  it("SHADOW refuses a lease store outside the shadow namespace", () => {
    const env = makeRepo();
    expect(() => makeSupervisor(env, {leaseStore: {kind: "REMOTE_GIT_REF", namespace: NAMESPACES.LIVE, read: () => null}}).sup.start()).toThrow(/SHADOW_REQUIRES_SHADOW_NAMESPACE/);
  });
});
import {spawnSync as _sp} from "node:child_process";
const spawnSyncGit = (cwd, a) => _sp("git", a, {cwd}).status;
