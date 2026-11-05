// //TR: UASCO Entegrasyon Köprüsü kabul testleri: paylaşımlı bare "origin" ve iki ayrı klon (V4.1 ortamı, V2 ortamı) arasında yalnız uzak ref CAS ile salt-okunur senkron, manifest, kabul kapıları, drenaj, mutabakat, deterministik devir, geri dönüş, çökme kurtarma, küresel Supervisor/Writer dışlaması ve devir sonrası 8 Builder ile LIVE çalışma. Yerel dosya kilidi sahiplik kanıtı olarak kullanılmaz.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {S, SESS, bridgeFor, commitLive, LIVE} from "./keys.mjs";
import {git, tasks, WORKER, runUntil} from "./harness.mjs";
import {createRemoteDocStore, createLocalDocStore, gitRunner} from "../../automation/factory-v2/ref-doc-store.mjs";
import {createRemoteLeaseStore, createMemoryStore, Ownership, writerLeaseId} from "../../automation/factory-v2/ownership.mjs";
import {snapshotV41, buildManifest, reconcile, applyPlan, manifestFresh, verifyManifest, authorityRef} from "../../automation/factory-v2/bridge.mjs";
import {StateJournal} from "../../automation/factory-v2/state-journal.mjs";
import {FactorySupervisor, maxOverlap} from "../../automation/factory-v2/supervisor.mjs";
import {LocalProcessExecutor} from "../../automation/factory-v2/executors.mjs";
import {createLocalGitIntegration} from "../../automation/factory-v2/merge-git.mjs";
import {spawnSync} from "node:child_process";

const T = 180_000;
const DOMAIN = "uasco-v7";
const GATES = {reviewClean: {evidence: "review:abc"}, ciPassed: {evidence: "ci:run/1"}, founderAuthorization: {evidence: "FD-test"}, migrationAcceptance: {evidence: "bridge-tests"}};
const commit = (cwd, file, msg) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), {recursive: true}); fs.writeFileSync(path.join(cwd, file), msg + "\n"); git(cwd, "add", file); git(cwd, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", msg); return git(cwd, "rev-parse", "HEAD"); };

/** Shared bare origin + two independent clones standing for two cloud environments. */
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-bridge-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "integ", origin);
  const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
  const base = commit(seed, "README.txt", "base");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/integ");
  git(seed, "checkout", "-q", "-b", "pr-41");
  const prHead = commit(seed, "work/V41-T0002.txt", "V41 builder work");
  git(seed, "push", "-q", "origin", "pr-41");
  const envA = path.join(root, "envA"), envB = path.join(root, "envB");
  git(root, "clone", "-q", origin, envA); git(root, "clone", "-q", origin, envB);
  for (const e of [envA, envB]) git(e, "checkout", "-q", "integ");
  const docs = e => createRemoteDocStore({runGit: gitRunner(e)});
  return {root, origin, base, prHead, envA, envB, docs};
}
const v41State = {done: [{task: "V41-T0001", pr: 1}], inFlight: [{task: "V41-T0002", prs: [41]}, {task: "V41-T0003", prs: []}], blocked: [{task: "V41-T0009", prs: [9], reason: "FOUNDER_REQUIRED"}]};
const index = {tasks: [{id: "V41-T0001", status: "ASSET_DONE"}, {id: "V41-T0002", status: "PROPOSED"}, {id: "V41-T0003", status: "PROPOSED"}, {id: "V41-T0009", status: "PROPOSED"}]};
const openPrs = w => [{number: 41, body: "x\nUASCO-TASK: V41-T0002\n", head: {sha: w.prHead, ref: "pr-41"}, base: {sha: w.base, ref: "integ"}}, {number: 50, body: "no task", head: {sha: w.prHead, ref: "x"}, base: {sha: w.base, ref: "integ"}}];
const manifestOf = (w, version = 1) => buildManifest({domain: DOMAIN, version, snapshot: snapshotV41({baseRef: "integ", baseSha: w.base, autonomyState: v41State, taskIndex: index, openPrs: openPrs(w)}), fromSession: SESS.V41, toSession: SESS.V2});
const remoteRefs = w => git(w.origin, "for-each-ref", "--format=%(refname)", "refs/uasco/").split("\n").filter(Boolean);

describe("bridge: read-only synchronisation and manifest", () => {
  it("snapshot is deterministic, digest-bound and writes nothing to the shared origin", {timeout: T}, () => {
    const w = world();
    const m1 = manifestOf(w), m2 = manifestOf(w);
    expect(m1.digest).toBe(m2.digest);
    expect(verifyManifest(m1)).toBeTruthy();
    expect(() => verifyManifest({...m1, version: 2})).toThrow(/MANIFEST_DIGEST_MISMATCH/);
    expect(m1.snapshot.openPrs.map(p => [p.pr, p.task, p.headSha])).toEqual([[41, "V41-T0002", w.prHead], [50, null, w.prHead]]);
    const multi = reconcile(buildManifest({domain: DOMAIN, version: 9, snapshot: snapshotV41({baseRef: "integ", baseSha: w.base, autonomyState: {}, taskIndex: {tasks: []},
      openPrs: [...openPrs(w), {number: 42, body: "UASCO-TASK: V41-T0002", head: {sha: w.prHead, ref: "pr-42"}, base: {sha: w.base, ref: "integ"}}, {number: 43, body: "UASCO-TASK: V41-T0005", head: {sha: w.prHead, ref: "s"}, base: {sha: w.base, ref: "other-branch"}}]}), fromSession: "a", toSession: "b"}));
    expect(multi.unresolved).toEqual([]);
    expect(multi.plan.filter(p => p.canonicalTask === "V41-T0002").map(p => [p.task, p.action])).toEqual([["V41-T0002#pr41", "ADOPT_PR"], ["V41-T0002#pr42", "ADOPT_PR"]]);
    expect(multi.plan.find(p => p.task === "V41-T0005#pr43")).toMatchObject({action: "IMPORT_BLOCKED", reason: "STACKED_ON:other-branch"});
    expect(m1.snapshot.liveOwned).toEqual(["V41-T0002", "V41-T0003", "V41-T0009"]);
    const b = bridgeFor(w.docs(w.envB), DOMAIN);
    expect(b.read().doc.authority).toBe("V4.1"); // absent record = V4.1 authoritative
    expect(b.v41MayDispatch()).toBe(true);
    expect(remoteRefs(w)).toEqual([]);
  });
  it("local stores are refused for cross-cloud authority", () => {
    const w = world();
    expect(() => bridgeFor(createLocalDocStore(w.envA), DOMAIN)).toThrow(/OWNERSHIP_STORE_NOT_SHARED/);
  });
});

describe("bridge: deterministic V4.1 -> V2 transition", () => {
  it("gates, drain, reconciliation and freshness are all required; concurrent writers lose the CAS", {timeout: T}, () => {
    const w = world();
    const bA = bridgeFor(w.docs(w.envA), DOMAIN); // V4.1 side
    const bB = bridgeFor(w.docs(w.envB), DOMAIN); // V2 side
    const m = manifestOf(w);
    expect(() => bB.prepare({manifest: m, gates: {...GATES, founderAuthorization: undefined}, actor: "v2"})).toThrow(/GATE_FOUNDERAUTHORIZATION:EVIDENCE_SHAPE/);
    expect(() => commitLive(bB, {manifest: m, currentOpenPrs: openPrs(w), currentBaseSha: m.snapshot.baseSha, currentStateDigest: m.snapshot.stateDigest, v2Session: "session_v2supervisor"})).toThrow(/PHASE_INVALID/);
    const stale = bA.read(); // A observes before B prepares
    bB.prepare({manifest: m, gates: GATES, signer: S.V2});
    expect(bA.docStore.cas(authorityRef(DOMAIN), stale.sha, {...stale.doc, phase: "V41_AUTHORITATIVE"}).ok).toBe(false); // stale CAS loses
    expect(bA.v41MayDispatch()).toBe(false); // V4.1 stops dispatching new work once prepared
    expect(remoteRefs(w)).toEqual([authorityRef(DOMAIN), `refs/uasco/handover/${DOMAIN}/v1`].sort());
    // V4.1 acks drain, but V41-T0003 (in flight, no PR) is not dispositioned -> unresolved
    bA.drainAck({manifestDigest: m.digest, drain: {acks: {}, builderSessionsStopped: []}, signer: S.V41});
    expect(() => commitLive(bB, {manifest: m, currentOpenPrs: openPrs(w), currentBaseSha: m.snapshot.baseSha, currentStateDigest: m.snapshot.stateDigest, v2Session: "session_v2supervisor"})).toThrow(/RECONCILE_UNRESOLVED:V41-T0003:IN_FLIGHT_NOT_DRAINED/);
    // rollback and redo with a proper drain ack
    bA.rollback({reason: "drain incomplete", signer: S.V41});
    expect(bA.read().doc).toMatchObject({phase: "V41_AUTHORITATIVE", epoch: 1});
    const m2 = manifestOf(w, 2);
    bB.prepare({manifest: m2, gates: GATES, signer: S.V2});
    bA.drainAck({manifestDigest: m2.digest, drain: {acks: {"V41-T0003": "FENCED"}, builderSessionsStopped: ["session_v41builderC"], implementerSessions: {"V41-T0002": ["session_v41builderB"]}}, signer: S.V41});
    // PR head moved after the manifest -> stale, refused
    const moved = openPrs(w).map(p => p.number === 41 ? {...p, head: {...p.head, sha: "f".repeat(40)}} : p);
    expect(() => commitLive(bB, {manifest: m2, currentOpenPrs: moved, currentBaseSha: m2.snapshot.baseSha, currentStateDigest: m2.snapshot.stateDigest, v2Session: "session_v2supervisor"})).toThrow(/MANIFEST_STALE:PR_41_HEAD_MOVED/);
    expect(() => commitLive(bB, {manifest: m2, currentOpenPrs: openPrs(w), currentBaseSha: m2.snapshot.baseSha, currentStateDigest: m2.snapshot.stateDigest, v2Session: "session_intruder"})).toThrow(/SIGNER_KEY_UNKNOWN/);
    const c = commitLive(bB, {manifest: m2, currentOpenPrs: openPrs(w), currentBaseSha: m2.snapshot.baseSha, currentStateDigest: m2.snapshot.stateDigest, v2Session: "session_v2supervisor"});
    expect(c.doc).toMatchObject({authority: "V2", phase: "V2_AUTHORITATIVE", epoch: 2, holder: "session_v2supervisor"});
    expect(bA.v41MayDispatch()).toBe(false);
    expect(bA.assertV2("session_v2supervisor", 2)).toBe(2);
    expect(() => bA.assertV2("session_other", null)).toThrow(/V2_HOLDER_MISMATCH/);
    // reconciliation: done imported, PR adopted at exact SHAs, fenced requeued, blocked kept blocked, foreign PR untouched
    const byTask = Object.fromEntries(c.plan.filter(p => p.task).map(p => [p.task, p]));
    expect(byTask["V41-T0001"].action).toBe("IMPORT_VERIFIED");
    expect(byTask["V41-T0002#pr41"]).toMatchObject({action: "ADOPT_PR", pr: 41, headSha: w.prHead, baseSha: w.base, implementerSessions: ["session_v41builderB"]});
    expect(byTask["V41-T0002"]).toMatchObject({action: "IMPORT_BLOCKED", reason: "AWAITING_ADOPTED_PRS"});
    expect(byTask["V41-T0003"].action).toBe("REQUEUE_FENCED");
    expect(byTask["V41-T0009"].action).toBe("IMPORT_BLOCKED");
    expect(c.plan.some(p => p.pr === 50 && p.action === "FOREIGN_PR_UNTOUCHED")).toBe(true);
  });

  it("a merged increment PR is evidence, not completion: the in-flight task still needs a drain disposition", () => {
    const w = world();
    const m = buildManifest({domain: DOMAIN, version: 3, snapshot: snapshotV41({baseRef: "integ", baseSha: w.base, autonomyState: {inFlight: [{task: "V41-T0007", prs: [70]}]}, taskIndex: {tasks: []},
      mergedPrs: [{number: 70, body: "UASCO-TASK: V41-T0007", merge_commit_sha: w.base}]}), fromSession: "a", toSession: "b"});
    expect(reconcile(m, {acks: {}}).unresolved).toEqual([{task: "V41-T0007", reason: "IN_FLIGHT_NOT_DRAINED"}]);
    expect(reconcile(m, {acks: {"V41-T0007": "COMPLETED"}}).plan).toEqual([expect.objectContaining({task: "V41-T0007", action: "IMPORT_VERIFIED"})]);
  });
  it("applying the plan is idempotent and survives a crash/restart (no duplicate accepted results)", () => {
    const w = world();
    const m = manifestOf(w);
    const {plan} = reconcile(m, {acks: {"V41-T0003": "FENCED"}});
    const dir = path.join(w.root, "journal");
    const j = new StateJournal(dir), f = j.openEpoch("v2", "tok");
    applyPlan(j, m, plan, f);
    const n = j.events.length;
    const j2 = new StateJournal(dir); // restart
    const f2 = j2.openEpoch("v2-restarted", "tok2");
    applyPlan(j2, m, plan, f2);
    expect(j2.events.filter(e => e.kind === "IMPORT").length).toBe(n - 1); // nothing re-imported
    expect(j2.get("V41-T0001").state).toBe("VERIFIED");
    expect(j2.get("V41-T0002#pr41").state).toBe("BUILT");
    expect(j2.get("V41-T0002#pr41").data).toMatchObject({headSha: w.prHead, pr: 41, canonicalTask: "V41-T0002"});
    expect(j2.get("V41-T0002").state).toBe("BLOCKED");
    expect(j2.get("V41-T0003")).toMatchObject({state: "QUEUED", attempt: 1});
    expect(j2.get("V41-T0009").state).toBe("BLOCKED");
  });
});

describe("bridge: guards that survived mutation in review of 3213d6a8 (M3, M5, M6, M8) and drain/freshness hardening", () => {
  const setup = () => {
    const w = world();
    const bA = bridgeFor(w.docs(w.envA), DOMAIN), bB = bridgeFor(w.docs(w.envB), DOMAIN);
    const m = manifestOf(w);
    bB.prepare({manifest: m, gates: GATES, signer: S.V2});
    return {w, bA, bB, m};
  };
  const fresh = (m, w) => ({currentOpenPrs: openPrs(w), currentBaseSha: m.snapshot.baseSha, currentStateDigest: m.snapshot.stateDigest});
  it("M3: drain ack must carry the prepared manifest digest; only the outgoing owner may ack", {timeout: T}, () => {
    const {bA, bB, m} = setup();
    const drain = {acks: {"V41-T0003": "FENCED"}, builderSessionsStopped: []};
    expect(() => bA.drainAck({manifestDigest: "0".repeat(64), drain, signer: S.V41})).toThrow(/DRAIN_MANIFEST_MISMATCH/);
    expect(() => bB.drainAck({manifestDigest: m.digest, drain, signer: S.V2})).toThrow(/ROLE_NOT_ALLOWED/);
    expect(() => bB.drainAck({manifestDigest: m.digest, drain, signer: S.ATTACK})).toThrow(/SIGNER_KEY_UNKNOWN/);
    expect(() => bB.drainAck({manifestDigest: m.digest, drain, actor: SESS.V41})).toThrow(/SIGNATURE_REQUIRED/); // a caller-supplied actor string is not identity
  });
  it("M5 + freshness: a PR opened, a PR re-based, the canonical base moved or STATE.json changed after the manifest all refuse commit", {timeout: T}, () => {
    const {w, bA, bB, m} = setup();
    bA.drainAck({manifestDigest: m.digest, drain: {acks: {"V41-T0003": "FENCED"}, builderSessionsStopped: []}, signer: S.V41});
    const c = o => () => commitLive(bB, {manifest: m, v2Session: "session_v2supervisor", ...fresh(m, w), ...o});
    expect(c({currentOpenPrs: [...openPrs(w), {number: 77, body: "", head: {sha: w.prHead, ref: "z"}, base: {sha: w.base, ref: "integ"}}]})).toThrow(/PR_77_OPENED_AFTER_MANIFEST/);
    expect(c({currentOpenPrs: openPrs(w).map(p => p.number === 41 ? {...p, base: {...p.base, ref: "elsewhere"}} : p)})).toThrow(/PR_41_BASE_CHANGED/);
    expect(c({currentBaseSha: "e".repeat(40)})).toThrow(/CANONICAL_BASE_MOVED/);
    expect(c({currentStateDigest: "d".repeat(64)})).toThrow(/STATE_CHANGED/);
    expect(c({}) ()).toMatchObject({doc: {phase: "V2_AUTHORITATIVE"}});
  });
  it("M8: the V2 gate is pinned to the epoch — a rollback and re-commit to the same holder invalidates the old epoch", {timeout: T}, () => {
    const {w, bA, bB, m} = setup();
    bA.drainAck({manifestDigest: m.digest, drain: {acks: {"V41-T0003": "FENCED"}, builderSessionsStopped: []}, signer: S.V41});
    const e1 = commitLive(bB, {manifest: m, v2Session: "session_v2supervisor", ...fresh(m, w)}).doc.epoch;
    bA.rollback({reason: "x", signer: S.V41});
    const m2 = manifestOf(w, 2);
    bB.prepare({manifest: m2, gates: GATES, signer: S.V2});
    bA.drainAck({manifestDigest: m2.digest, drain: {acks: {"V41-T0003": "FENCED"}, builderSessionsStopped: []}, signer: S.V41});
    const e2 = commitLive(bB, {manifest: m2, v2Session: "session_v2supervisor", ...fresh(m2, w)}).doc.epoch;
    expect(e2).toBeGreaterThan(e1);
    expect(() => bB.assertV2("session_v2supervisor", e1)).toThrow(/V2_EPOCH_MISMATCH/);
    expect(bB.assertV2("session_v2supervisor", e2)).toBe(e2);
  });
  it("M6: the writer re-checks authority before each merge write (revoked mid-batch -> nothing written)", async () => {
    const {writeMerges} = await import("../../automation/factory-v2/merge.mjs");
    const own = new Ownership(createMemoryStore(), {leaseId: "writer--x", environment: "e", workerId: "w", sessionId: "session_writerxx"});
    let merges = 0, allowed = true;
    const git = {readCanonical: () => "1".repeat(40), merge: async () => { merges++; return {ok: true, resultSha: "2".repeat(40)}; }, verifyRemote: async () => true};
    const beforeWrite = () => { if (!allowed) throw Object.assign(new Error("AUTHORITY_REVOKED"), {code: "OWNERSHIP_LOST", detail: "AUTHORITY_REVOKED"}); };
    allowed = false;
    const out = await writeMerges([{taskId: "a"}, {taskId: "b"}], {ownership: own, git, beforeWrite});
    expect(merges).toBe(0);
    expect(out.results[0]).toMatchObject({status: "FENCED", reasons: ["AUTHORITY_REVOKED"]});
  });
});

describe("bridge: global exclusivity across cloud environments (shared origin refs only)", () => {
  it("one Supervisor lease and one Merge Writer lease across two clones", {timeout: T}, () => {
    const w = world();
    const sA = createRemoteLeaseStore({runGit: gitRunner(w.envA)}), sB = createRemoteLeaseStore({runGit: gitRunner(w.envB)});
    const mk = (s, sess, id) => new Ownership(s, {leaseId: id, environment: sess, workerId: "w", sessionId: sess});
    const supA = mk(sA, "session_envAsuper", "supervisor--LIVE-uasco-v7"), supB = mk(sB, "session_envBsuper", "supervisor--LIVE-uasco-v7");
    expect(supA.acquire().granted).toBe(true);
    expect(supB.acquire().granted).toBe(false);
    const wA = mk(sA, "session_envAwrite", writerLeaseId("LIVE-uasco-v7")), wB = mk(sB, "session_envBwrite", writerLeaseId("LIVE-uasco-v7"));
    expect(wB.acquire().granted).toBe(true);
    expect(wA.acquire().granted).toBe(false);
    expect(wB.fence().epoch).toBe(1);
    expect(git(w.origin, "for-each-ref", "--format=%(refname)", "refs/uasco/claims/").split("\n").sort()).toEqual(["refs/uasco/claims/supervisor--LIVE-uasco-v7", "refs/uasco/claims/writer--LIVE-uasco-v7"]);
  });
});

describe("bridge: LIVE activation after handover — one execution system at 8 builders", () => {
  it("V2 stays STANDBY under V4.1 authority, activates at 8 builders after commit, is revoked by rollback", {timeout: T}, async () => {
    process.env.FACTORY_HOLD_MS = "1500"; delete process.env.FACTORY_FAIL;
    const w = world();
    const bA = bridgeFor(w.docs(w.envA), DOMAIN);
    const bB = bridgeFor(w.docs(w.envB), DOMAIN);
    const leaseStore = createRemoteLeaseStore({runGit: gitRunner(w.envB)});
    const backlog = [...tasks(8), ...index.tasks.map(t => ({...t, deps: [], tier: "T1"}))];
    const evidence = [];
    const integ = createLocalGitIntegration({repoDir: w.envB, branch: "integ", scratchDir: path.join(w.root, "integration")});
    git(w.envB, "fetch", "-q", "origin", "pr-41");
    const mk = () => new FactorySupervisor({repoDir: w.envB, domain: DOMAIN, mode: "LIVE", sessionId: "session_v2supervisor", journalDir: path.join(w.root, "v2journal"), leaseStore,
      executor: new LocalProcessExecutor({repoDir: w.envB, worktreeRoot: path.join(w.root, "wt"), baseSha: w.base, command: () => [process.execPath, [WORKER]], evidence}),
      backlog: () => backlog, authority: (s, e) => bB.assertV2(s, e), liveOwned: () => new Set(),
      mergeFacts: t => ({candidate: {taskId: t.taskId, headSha: t.data.headSha, baseSha: t.data.baseSha, changedPaths: t.data.changedPaths ?? [`work/${t.taskId}.txt`], allowedPaths: ["work/"], builderIdentity: t.data.builderIdentity ?? "v41", priorBlockers: [], required: t.data.required ?? []},
        canonicalSha: integ.readCanonical(), conflicts: false, baseDeltaOverlaps: false, verdicts: t.data.verdicts ?? [], ci: {sha: t.data.headSha, requiredContexts: {"local-check": "success"}}, protectedPaths: {exactPaths: [], protectedPrefixes: ["config/"]}}),
      git: integ, postMergeVerify: async () => true});
    expect(() => new FactorySupervisor({domain: DOMAIN, mode: "LIVE", sessionId: "s", journalDir: path.join(w.root, "x"), leaseStore: createMemoryStore(), executor: {}, backlog: () => [], authority: () => 1}).start()).toThrow(/LIVE_REQUIRES_SHARED_LEASE_STORE/);
    let sup = mk();
    expect(sup.start()).toMatchObject({owner: false}); // V4.1 still authoritative: no claims, no dispatch
    expect(remoteRefs(w)).toEqual([]);
    // handover
    const m = manifestOf(w);
    bB.prepare({manifest: m, gates: GATES, signer: S.V2});
    bA.drainAck({manifestDigest: m.digest, drain: {acks: {"V41-T0003": "FENCED"}, builderSessionsStopped: ["session_v41builderC"]}, signer: S.V41});
    const c = commitLive(bB, {manifest: m, currentOpenPrs: openPrs(w), currentBaseSha: m.snapshot.baseSha, currentStateDigest: m.snapshot.stateDigest, v2Session: "session_v2supervisor"});
    sup = mk();
    expect(sup.start().owner).toBe(true);
    applyPlan(sup.journal, m, c.plan, sup.fenceRef);
    const target = () => ["V41-T0002#pr41", "V41-T0003", ...tasks(8).map(t => t.id)].every(id => sup.journal.get(id)?.state === "VERIFIED");
    expect(await runUntil(sup, target, {timeoutMs: 150_000})).toBe(true);
    expect(sup.report().target).toMatchObject({builders: 8, reviewers: 4, mergePreparers: 3, mergeWriters: 1, supervisors: 1});
    expect(maxOverlap(sup.spans.filter(s => s.role === "BUILDER"))).toBe(8);
    expect(sup.journal.get("V41-T0001").state).toBe("VERIFIED"); // imported, never rebuilt
    expect(evidence.some(e => e.taskId === "V41-T0001" || e.taskId === "V41-T0002" && e.role === "BUILDER")).toBe(false); // adopted PR reviewed+merged, not rebuilt
    expect(sup.journal.get("V41-T0009").state).toBe("BLOCKED");
    expect(spawnSync("git", ["merge-base", "--is-ancestor", w.prHead, "integ"], {cwd: w.envB}).status).toBe(0); // the V4.1 PR head landed as-is
    // rollback: V2 is revoked on its next tick; V4.1 may dispatch again
    bA.rollback({reason: "test rollback", signer: S.V41});
    expect((await sup.tick()).state).toBe("AUTHORITY_REVOKED");
    expect(bA.v41MayDispatch()).toBe(true);
  });
});
