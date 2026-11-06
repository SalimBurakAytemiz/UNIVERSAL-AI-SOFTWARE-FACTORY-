// //TR: Factory V2 tek kontrol oturumu kabul testleri: paylaşımlı imzalı günlük (değiştirme/sıra bozma/yabancı imza reddi, eşzamanlı yazarlar, eski Supervisor fence reddi), gerçek oturum intent döngüsü (spawn isteği, gerçek oturum bağlama, kapasite, oturum kaybı ve yeniden atama), kimliği doğrulanmış sonuç kanalı (bağlı olmayan oturum, yanlış nonce, eski deneme, geç gelen kayıp-oturum sonucu, başka başa bağlı review reddi) ve süreç yeniden başladığında / başka Supervisor devraldığında kaldığı yerden devam.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {git} from "./harness.mjs";
import {S, SESS, ringFor} from "./keys.mjs";
import {createLocalDocStore, createRemoteDocStore, gitRunner} from "../../automation/factory-v2/ref-doc-store.mjs";
import {createSharedRegistry} from "../../automation/factory-v2/shared-registry.mjs";
import {registryLog} from "../../automation/factory-v2/ledger-log.mjs";
import {StateJournal} from "../../automation/factory-v2/state-journal.mjs";
import {createMemoryStore} from "../../automation/factory-v2/ownership.mjs";
import {FactorySupervisor} from "../../automation/factory-v2/supervisor.mjs";
import {CloudOrchestrator, parseResultText, RESULT_MARK} from "../../automation/factory-v2/cloud-orchestrator.mjs";

const T = 180_000, D = "fv2-test";
const REF = "refs/heads/uasco/registry";
const sha = c => c.repeat(40);
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-ctl-"));
  git(root, "init", "-q", "-b", "integ", "r"); const r = path.join(root, "r");
  fs.writeFileSync(path.join(r, "a.txt"), "a\n"); git(r, "add", "."); git(r, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "a");
  return {root, r};
}
const localLedger = (r, signer = S.V2, ns = "test", chunkSize = 100) => registryLog({registry: createSharedRegistry({docStore: createLocalDocStore(r), ref: REF}), ns, signer, ring: ringFor(D), domain: D, chunkSize});

describe("P0-3 shared signed ledger", () => {
  it("events survive a new process, are hash-chained and Supervisor-signed; tampering, reordering or a foreign signer is refused", {timeout: T}, () => {
    const {r} = repo();
    const j1 = new StateJournal(localLedger(r));
    const f = j1.openEpoch(SESS.V2, "tok1");
    j1.enqueue("T1", {name: "t"}, f); j1.transition("T1", "CLAIMED", {fence: f});
    j1.fact("T1", "PR", {number: 7}, f); j1.fact("T1", "EVIDENCE", {kind: "screenshot", path: "s.png"}, f); j1.fact("T1", "EVIDENCE", {kind: "e2e", result: "PASS"}, f);
    const j2 = new StateJournal(localLedger(r)); // another process / container
    expect(j2.get("T1")).toMatchObject({state: "CLAIMED"});
    expect(j2.get("T1").facts).toEqual({PR: {number: 7}, EVIDENCE: [{kind: "screenshot", path: "s.png"}, {kind: "e2e", result: "PASS"}]});
    expect(j2.events.every(e => e.signer === SESS.V2)).toBe(true);
    // a registry writer without the Supervisor key: forged append, edited event, foreign signature
    const reg = createSharedRegistry({docStore: createLocalDocStore(r), ref: REF});
    const k = "ledger/test/c/000001", cur = reg.read(k);
    const edited = structuredClone(cur.doc); edited.events[1].data.name = "evil";
    expect(reg.cas(k, cur.sha, edited).ok).toBe(true);
    expect(() => new StateJournal(localLedger(r))).toThrow(/LEDGER_EVENT_UNVERIFIED|LEDGER_CHAIN_BROKEN/);
    const now = reg.read(k); expect(reg.cas(k, now.sha, cur.doc).ok).toBe(true); // restore
    expect(new StateJournal(localLedger(r)).seq).toBe(6);
    expect(() => new StateJournal(localLedger(r, S.ATTACK)).enqueue("T2", {}, f)).toThrow(/LEDGER_SIGNER_NOT_AUTHORIZED/); // unregistered key: refused before any write
    expect(new StateJournal(localLedger(r)).get("T2")).toBe(null);
    const swapped = structuredClone(cur.doc); [swapped.events[2], swapped.events[3]] = [swapped.events[3], swapped.events[2]];
    expect(reg.cas(k, reg.read(k).sha, swapped).ok).toBe(true);
    expect(() => new StateJournal(localLedger(r))).toThrow(/LEDGER_SEQ_GAP|LEDGER_CHAIN_BROKEN/);
    expect(() => registryLog({registry: reg, ns: "../x", ring: ringFor(D), domain: D})).toThrow(/LEDGER_NS_INVALID/);
  });
  it("two environments append concurrently through server CAS without losing an event; a stale Supervisor epoch is fenced", {timeout: T}, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-ctl2-")), origin = path.join(root, "o.git");
    git(root, "init", "-q", "--bare", "-b", "integ", origin);
    const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
    fs.writeFileSync(path.join(seed, "a"), "a"); git(seed, "add", "."); git(seed, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "a"); git(seed, "push", "-q", "origin", "HEAD:integ");
    const env = n => { const d = path.join(root, n); git(root, "clone", "-q", origin, d); return new StateJournal(registryLog({registry: createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(d)}), ref: REF}), ns: "p", signer: S.V2, ring: ringFor(D), domain: D})); };
    const a = env("A"), b = env("B");
    const fa = a.openEpoch(SESS.V2, "ta");
    a.enqueue("X", {}, fa); b.reload(); const fb = b.openEpoch(SESS.V2, "tb"); // B is the newer Supervisor epoch
    b.enqueue("Y", {}, fb);
    expect(() => a.enqueue("Z", {}, fa)).toThrow(/JOURNAL_STALE_FENCE/); // A re-reads the shared log and is fenced
    const c = env("C"); expect([...c.tasks.keys()].sort()).toEqual(["X", "Y"]); expect(c.seq).toBe(4);
  });
});

/** Fake origin checks for the result channel (real git is exercised in the live cloud verification). */
function fakeGit(o = {}) { return {tips: {}, trailers: {}, branchTip(b) { return this.tips[b] ?? null; }, fetch: () => true, sessionsOf(h) { return this.trailers[h] ?? null; }, isAncestor: () => true, ...o}; }
function control({r, sessionId = SESS.V2, now = () => clock.t, g = fakeGit(), leaseStore = createMemoryStore(), backlog = [{id: "T1", name: "add feature", paths: ["work/"], spec: "do it"}], capacity}) {
  const orch = new CloudOrchestrator({repoUrl: "https://example.invalid/r", domain: D, git: g, now, capacity});
  const sup = new FactorySupervisor({domain: D, mode: "SHADOW", sessionId, journal: new StateJournal(localLedger(r)), leaseStore, executor: orch, backlog: () => backlog, now, leaseTtlMs: 3600_000,
    target: {builders: 2, reviewers: 4, mergePreparers: 1, mergeWriters: 1, supervisors: 1}, dispatchBase: () => sha("b"), isAncestor: () => true, diffPaths: () => ["work/x.txt"]});
  orch.attach(sup);
  return {sup, orch, g, leaseStore};
}
const clock = {t: 1_000_000};
const result = (w, extra) => `done\n${RESULT_MARK} ${JSON.stringify({intentId: w.intentId, nonce: w.nonce, taskId: w.taskId, attempt: w.attempt, ...extra})}`;

describe("P0-1 + P0-2 real-session orchestration and authenticated result channel", () => {
  it("intent -> create_session request -> bound real session -> verified result -> review -> CLEAN, across Supervisor process restarts", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore(), g = fakeGit();
    let c = control({r, leaseStore, g});
    expect(c.sup.start().owner).toBe(true);
    await c.sup.tick();
    const [act] = c.orch.actions();
    expect(act).toMatchObject({role: "BUILDER", taskId: "T1", createSession: {source_revision: sha("b"), tags: expect.arrayContaining(["uasco-factory-v2", "role:builder"])}});
    expect(act.createSession.outcome_branch).toMatch(/^fv2w\/fv2-test\/T1-a0-/);
    expect(act.createSession.prompt).toContain(RESULT_MARK);
    // a fresh process of the same Supervisor session (every `factory tick` is one) adopts its lease and epoch
    c = control({r, leaseStore, g}); expect(c.sup.start()).toMatchObject({owner: true});
    expect(() => c.orch.bind(act.intentId, "not-a-session")).toThrow(/SESSION_ID_INVALID/);
    c.orch.bind(act.intentId, "session_builderAAAA1");
    expect(() => c.orch.bind(c.orch.actions()[0]?.intentId ?? act.intentId, "session_builderAAAA1")).not.toThrow(); // same pair is idempotent
    const w = c.orch.workers(x => x.intentId === act.intentId)[0];
    // result channel negatives (each recorded as RESULT_REJECTED, nothing accepted)
    expect(c.orch.submitResult(act.intentId, {sessionId: "session_intruderXX1", text: result(w, {ok: true, headSha: sha("c")})})).toMatchObject({accepted: false, reason: "SESSION_NOT_BOUND_TO_INTENT"});
    expect(c.orch.submitResult(act.intentId, {sessionId: "session_builderAAAA1", text: result({...w, nonce: "x"}, {ok: true, headSha: sha("c")})}).reason).toBe("NONCE_OR_INTENT_MISMATCH");
    expect(c.orch.submitResult(act.intentId, {sessionId: "session_builderAAAA1", text: result(w, {ok: true, headSha: sha("c")}) + "\n" + result(w, {ok: true, headSha: sha("d")})}).reason).toBe("RESULT_AMBIGUOUS");
    expect(c.orch.submitResult(act.intentId, {sessionId: "session_builderAAAA1", text: result(w, {ok: true, headSha: sha("c")})}).reason).toBe("HEAD_NOT_BRANCH_TIP");
    g.tips[w.branch] = sha("c"); g.trailers[sha("c")] = ["session_someoneelse1"];
    expect(c.orch.submitResult(act.intentId, {sessionId: "session_builderAAAA1", text: result(w, {ok: true, headSha: sha("c")})}).reason).toBe("COMMIT_SESSION_MISMATCH");
    g.trailers[sha("c")] = ["session_builderAAAA1"];
    expect(c.orch.submitResult(act.intentId, {sessionId: "session_builderAAAA1", text: result(w, {ok: true, headSha: sha("c"), summary: "s"})})).toEqual({accepted: true});
    expect(c.sup.journal.events.filter(e => e.kind === "RESULT_REJECTED").length).toBe(5);
    // the next tick (another fresh process) re-attaches the in-flight job and consumes the verified result
    c = control({r, leaseStore, g}); c.sup.start(); await c.sup.tick();
    expect(c.sup.journal.get("T1")).toMatchObject({state: "REVIEWING", data: {headSha: sha("c"), branch: w.branch}});
    const rvs = c.orch.actions().filter(a => a.role === "REVIEWER");
    expect(rvs.length).toBeGreaterThan(0);
    for (const [i, rv] of rvs.entries()) {
      expect(rv.createSession).toMatchObject({source_revision: sha("c")}); expect(rv.createSession.outcome_branch).toBeUndefined();
      const sid = `session_reviewerBB${i}x`;
      c.orch.bind(rv.intentId, sid);
      expect(() => c.orch.bind(rv.intentId, "session_builderAAAA1")).toThrow(/INTENT_NOT_PENDING/);
      const rw = c.orch.workers(x => x.intentId === rv.intentId)[0];
      expect(c.orch.submitResult(rv.intentId, {sessionId: sid, text: result(rw, {status: "CLEAN", headSha: sha("d"), baseSha: sha("b")})}).reason).toBe("REVIEW_NOT_BOUND_TO_HEAD");
      expect(c.orch.submitResult(rv.intentId, {sessionId: sid, text: result(rw, {status: "CLEAN", headSha: sha("c"), baseSha: sha("b"), blockers: []})})).toEqual({accepted: true});
    }
    c = control({r, leaseStore, g}); c.sup.start(); await c.sup.tick();
    const t = c.sup.journal.get("T1");
    expect(t.state === "REVIEW_CLEAN" || t.state === "PREPARING").toBe(true);
    expect(t.data.verdicts[0]).toMatchObject({status: "CLEAN", headSha: sha("c")});
    expect([...c.sup.journal.workers.values()].map(x => [x.role, x.status])).toEqual([["BUILDER", "COMPLETED"], ...rvs.map(() => ["REVIEWER", "COMPLETED"])]);
  });

  it("a lost session is reassigned to a NEW session with attempt+1; its late result is refused; capacity is enforced", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore(), g = fakeGit();
    let c = control({r, leaseStore, g, backlog: [{id: "T1", paths: ["a/"]}, {id: "T2", paths: ["b/"]}, {id: "T3", paths: ["c/"]}]});
    c.sup.start(); await c.sup.tick();
    expect(c.orch.actions().length).toBe(2); // 2 builder slots: T3 waits, nothing over capacity
    expect(() => c.orch.start({role: "BUILDER", taskId: "T9", slotId: "x", fromSha: sha("b")})).toThrow(/CAPACITY_EXCEEDED/);
    expect(() => c.orch.start({role: "WRITER", taskId: "T9"})).toThrow(/ROLE_INVALID/);
    const a1 = c.orch.actions().find(a => a.taskId === "T1");
    c.orch.bind(a1.intentId, "session_lostbuilder1");
    expect(() => c.orch.bind(c.orch.actions()[0].intentId, "session_lostbuilder1")).toThrow(/SESSION_ALREADY_BOUND/);
    c.orch.lost(a1.intentId, "SESSION_FAILED");
    c = control({r, leaseStore, g, backlog: [{id: "T1", paths: ["a/"]}, {id: "T2", paths: ["b/"]}, {id: "T3", paths: ["c/"]}]}); c.sup.start(); await c.sup.tick();
    expect(c.sup.journal.get("T1")).toMatchObject({state: "BUILDING", attempt: 1}); // re-dispatched in the same tick, as a new intent
    expect(c.sup.journal.events.filter(e => e.kind === "SUPERVISOR_EPOCH").length).toBe(1); // same Supervisor session resumed its epoch
    const w1 = c.orch.workers(x => x.intentId === a1.intentId)[0];
    g.tips[w1.branch] = sha("e"); g.trailers[sha("e")] = ["session_lostbuilder1"];
    expect(c.orch.submitResult(a1.intentId, {sessionId: "session_lostbuilder1", text: result(w1, {ok: true, headSha: sha("e")})}).reason).toBe("INTENT_NOT_RUNNING:LOST");
    const again = c.orch.actions().filter(a => a.taskId === "T1");
    expect(again.length).toBe(1); expect(again[0].intentId).not.toBe(a1.intentId);
    expect(again[0].createSession.outcome_branch).toMatch(/T1-a1-/);
  });

  it("another Supervisor session takes over after the lease expires: new epoch, the old one is fenced, in-flight cloud work continues", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore(), g = fakeGit();
    const old = control({r, leaseStore, g}); old.sup.start(); await old.sup.tick();
    const a = old.orch.actions()[0]; old.orch.bind(a.intentId, "session_builderCCCC1");
    clock.t += 2 * 3600_000; // old Supervisor's lease expired (container gone)
    const neu = control({r, leaseStore, g, sessionId: "session_v2supervisorB"});
    expect(neu.sup.start()).toMatchObject({owner: true, epoch: 2});
    expect(() => old.orch.lost(a.intentId)).toThrow(); // stale epoch / lost lease: never writes again
    const w = neu.orch.workers(x => x.intentId === a.intentId)[0];
    g.tips[w.branch] = sha("f"); g.trailers[sha("f")] = ["session_builderCCCC1"];
    expect(neu.orch.submitResult(a.intentId, {sessionId: "session_builderCCCC1", text: result(w, {ok: true, headSha: sha("f")})})).toEqual({accepted: true});
    await neu.sup.tick();
    expect(neu.sup.journal.get("T1").state).toMatch(/BUILT|REVIEWING/);
    expect(neu.sup.journal.events.filter(e => e.kind === "SUPERVISOR_EPOCH").map(e => e.data.supervisorId)).toEqual([SESS.V2, "session_v2supervisorB"]);
  });

  it("result text parsing is strict", () => {
    expect(() => parseResultText("nothing")).toThrow(/RESULT_MISSING/);
    expect(() => parseResultText(`${RESULT_MARK} {bad`)).toThrow(/RESULT_UNPARSEABLE/);
    expect(parseResultText(`x\n  ${RESULT_MARK} {"a":1}`)).toEqual({a: 1});
  });
});

describe("P0-5 factory report", () => {
  it("one report shows sessions, tasks with PR/review/CI/merge, queue and dependencies, Founder decisions and product evidence; unmeasured quota is UNKNOWN", {timeout: T}, async () => {
    const {buildReport, renderMarkdown, parseAcceptance, UNKNOWN} = await import("../../automation/factory-v2/report.mjs");
    const {r} = repo(); const backlog = [{id: "T1", name: "screen", domain: "UI_UX"}, {id: "T2", name: "api", deps: ["T1"], domain: "BACKEND"}];
    const c = control({r, backlog}); c.sup.start(); await c.sup.tick();
    const a = c.orch.actions()[0]; c.orch.bind(a.intentId, "session_builderRPT01");
    c.sup.journal.fact("T1", "PR", {number: 901, url: "https://example.invalid/pr/901"}, c.sup.fence());
    c.sup.journal.fact("T1", "EVIDENCE", {kind: "screenshot", path: "docs/evidence/t1.png"}, c.sup.fence());
    const acceptance = parseAcceptance("| A2 | keyring | NOT_MET | x |\n| A1 | registry | MET (probe namespace) | y |");
    expect(acceptance).toEqual([{id: "A2", condition: "keyring", status: "NOT_MET"}, {id: "A1", condition: "registry", status: "MET"}]);
    const rep = buildReport({journal: c.sup.journal, backlog, supervisor: {mode: "SHADOW", sessionId: SESS.V2, epoch: 1, state: "ACTIVE", target: c.sup.topology.target},
      github: {openPrs: [{number: 354, title: "x", headSha: sha("a"), baseRef: "v7/integration", checks: {"founder-authority": "waiting"}, binding: {verdict: "CLEAN", head: sha("a")}, founderWaiting: true}]}, acceptance});
    expect(rep.quota).toBe(UNKNOWN);
    expect(rep.capacity.builders).toMatchObject({capacity: 2, running: 1});
    expect(rep.sessions[0]).toMatchObject({role: "BUILDER", status: "ACTIVE", sessionId: "session_builderRPT01", taskId: "T1"});
    const t1 = rep.tasks.rows.find(x => x.taskId === "T1");
    expect(t1).toMatchObject({area: "UI_UX", pr: {number: 901}, owners: ["BUILDER:session_builderRPT01"], evidence: [{kind: "screenshot", path: "docs/evidence/t1.png"}]});
    expect(rep.queue.find(q => q.taskId === "T2")?.waitingOn ?? rep.tasks.rows.find(x => x.taskId === "T2").waitingOn).toEqual(["T1"]);
    expect(rep.founderDecisions.map(d => d.kind)).toEqual(["PR_FOUNDER_AUTHORITY", "CUTOVER_CONDITION"]);
    expect(rep.productEvidence).toEqual([{taskId: "T1", kind: "screenshot", path: "docs/evidence/t1.png"}]);
    const md = renderMarkdown(rep);
    for (const s of ["## Capacity and sessions", "session_builderRPT01", "#354", "UNKNOWN (no measured quota source)", "CUTOVER_CONDITION: A2", "docs/evidence/t1.png"]) expect(md).toContain(s);
    expect(buildReport({journal: c.sup.journal}).github).toBe(UNKNOWN);
  });
});

describe("guards that survived mutation", () => {
  it("a correctly re-chained event signed by an unregistered key is refused (the chain alone is not identity)", {timeout: T}, async () => {
    const {signAction, canonDigest} = await import("../../automation/factory-v2/identity.mjs");
    const {r} = repo();
    const j = new StateJournal(localLedger(r)); const f = j.openEpoch(SESS.V2, "t"); j.enqueue("T1", {}, f);
    const reg = createSharedRegistry({docStore: createLocalDocStore(r), ref: REF});
    const k = "ledger/test/c/000001", cur = reg.read(k), last = cur.doc.events.at(-1);
    const body = {kind: "ENQUEUE", taskId: "EVIL", idempotencyKey: "enqueue:EVIL", data: {}, fenceEpoch: 1, fenceToken: "t", seq: 3, at: 1, prev: canonDigest(last), ledger: `${D}/test`};
    const forged = {...body, sig: signAction({...S.ATTACK, domain: D, action: "LEDGER", prev: body.prev, payload: body})};
    expect(reg.cas(k, cur.sha, {events: [...cur.doc.events, forged]}).ok).toBe(true);
    expect(() => new StateJournal(localLedger(r))).toThrow(/LEDGER_EVENT_UNVERIFIED:3:SIGNER_KEY_UNKNOWN/);
  });
  it("a result for an intent whose task attempt moved on is refused; a lease token cannot be adopted by another session", {timeout: T}, async () => {
    const {Ownership} = await import("../../automation/factory-v2/ownership.mjs");
    const {r} = repo(); const g = fakeGit(); const c = control({r, g}); c.sup.start(); await c.sup.tick();
    const a = c.orch.actions()[0]; c.orch.bind(a.intentId, "session_builderSTALE"); const w = c.orch.workers(x => x.intentId === a.intentId)[0];
    c.sup.journal.transition("T1", "RETRY_WAIT", {fence: c.sup.fence(), bumpAttempt: true, data: {retryAt: 0}});
    g.tips[w.branch] = sha("9"); g.trailers[sha("9")] = ["session_builderSTALE"];
    expect(c.orch.submitResult(a.intentId, {sessionId: "session_builderSTALE", text: result(w, {ok: true, headSha: sha("9")})}).reason).toBe("STALE_ATTEMPT");
    const store = createMemoryStore();
    const mine = new Ownership(store, {leaseId: "x", environment: "e", workerId: "w", sessionId: "session_holderAAAA1"}); mine.acquire();
    const thief = new Ownership(store, {leaseId: "x", environment: "e", workerId: "w", sessionId: "session_thiefBBBBB1"});
    expect(thief.adopt(mine.token)).toBe(false);
    expect(new Ownership(store, {leaseId: "x", environment: "e", workerId: "w", sessionId: "session_holderAAAA1"}).adopt(mine.token)).toBe(true);
  });
});

describe("found by the live probe", () => {
  it("a backlog edit after enqueue cannot give a job paths that differ from its frozen spec", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore();
    const backlog = [{id: "T1", paths: ["a/"], spec: "write a/x"}, {id: "T2", paths: ["b/"], spec: "write b/y"}];
    let c = control({r, leaseStore, backlog, capacity: {BUILDER: 1}}); c.sup.start(); await c.sup.tick(); // T1 dispatched, T2 enqueued and waiting
    backlog[1].paths = ["c/"]; // edited after enqueue
    c.orch.lost(c.orch.actions()[0].intentId); c = control({r, leaseStore, backlog, capacity: {BUILDER: 1}}); c.sup.start(); await c.sup.tick();
    const jobs = c.orch.workers(w => w.taskId === "T2");
    for (const w of jobs) { expect(w.createSession.prompt).toContain("Allowed paths: b/."); expect(w.createSession.prompt).toContain("write b/y"); }
  });
});
describe("reviewer capacity below the required focuses", () => {
  it("withdraws the partial reviewer set and waits; no partial review, no crash", {timeout: T}, async () => {
    const {r} = repo(); const g = fakeGit();
    const c = control({r, g, capacity: {REVIEWER: 1}}); c.sup.o.diffPaths = () => ["automation/factory-v2/supervisor.mjs"]; // security + cross-system: several focuses
    c.sup.start(); await c.sup.tick();
    const a = c.orch.actions()[0]; c.orch.bind(a.intentId, "session_builderCAP01"); const w = c.orch.workers(x => x.intentId === a.intentId)[0];
    g.tips[w.branch] = sha("7"); g.trailers[sha("7")] = ["session_builderCAP01"];
    expect(c.orch.submitResult(a.intentId, {sessionId: "session_builderCAP01", text: result(w, {ok: true, headSha: sha("7")})})).toEqual({accepted: true});
    await c.sup.tick();
    await c.sup.tick();
    expect(c.sup.journal.get("T1").state).toBe("BUILT"); // waits for enough reviewer sessions
    expect(c.orch.workers(x => x.role === "REVIEWER")).toEqual([]); // and creates no partial reviewer set (no ledger churn)
  });
});

describe("P0 blockers from the #388 review: rollback, ledger identity, lost/result race", () => {
  const build = (r, n, ns = "test", chunkSize = 100) => { const j = new StateJournal(localLedger(r, S.V2, ns, chunkSize)); const f = j.openEpoch(SESS.V2, "t"); for (let i = 1; i <= n; i++) j.enqueue(`T${i}`, {}, f); return j; };
  const reg = r => createSharedRegistry({docStore: createLocalDocStore(r), ref: REF});
  it("tail truncation and rollback to an older, fully consistent state are detected from the append-only branch history", {timeout: T}, () => {
    const {r} = repo(); build(r, 4);
    const k = "ledger/test/c/000001", cur = reg(r).read(k);
    const truncated = {events: cur.doc.events.slice(0, 3)}; // a valid prefix: every remaining event is genuine and chained
    expect(reg(r).cas(k, cur.sha, truncated).ok).toBe(true);
    expect(() => new StateJournal(localLedger(r))).toThrow(/LEDGER_ROLLBACK_DETECTED/);
    expect(reg(r).cas(k, reg(r).read(k).sha, cur.doc).ok).toBe(true); // restored: readable again
    expect(new StateJournal(localLedger(r)).seq).toBe(5);
  });
  it("deleting whole trailing chunks is detected; an attacker-written bogus history version carries no weight", {timeout: T}, () => {
    const {r} = repo(); build(r, 7, "test", 3); // 8 events -> chunks 1,2,3
    const g = reg(r), k3 = "ledger/test/c/000003";
    expect(g.remove(k3, g.read(k3).sha)).toBe(true);
    expect(() => new StateJournal(localLedger(r, S.V2, "test", 3))).toThrow(/LEDGER_ROLLBACK_DETECTED/);
    const {r: r2} = repo(); build(r2, 2);
    const g2 = reg(r2), k = "ledger/test/c/000002"; // a never-signed junk chunk written into history and removed again
    expect(g2.cas(k, null, {events: [{seq: 99, kind: "X", sig: {}}]}).ok).toBe(true);
    expect(g2.remove(k, g2.read(k).sha)).toBe(true);
    expect(new StateJournal(localLedger(r2)).seq).toBe(3);
  });
  it("a genuine signed chain copied into another ledger (namespace) is refused", {timeout: T}, () => {
    const {r} = repo(); build(r, 2, "alpha");
    const g = reg(r), src = g.read("ledger/alpha/c/000001").doc;
    expect(g.cas("ledger/beta/c/000001", null, src).ok).toBe(true);
    expect(() => new StateJournal(localLedger(r, S.V2, "beta"))).toThrow(/LEDGER_IDENTITY_MISMATCH/);
    expect(new StateJournal(localLedger(r, S.V2, "alpha")).seq).toBe(3);
  });
  it("a session marked LOST while its result is being verified is never accepted (checks re-run inside the ledger CAS)", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore(), g = fakeGit();
    const c = control({r, leaseStore, g}); c.sup.start(); await c.sup.tick();
    const a = c.orch.actions()[0]; c.orch.bind(a.intentId, "session_builderRACE1"); const w = c.orch.workers(x => x.intentId === a.intentId)[0];
    g.tips[w.branch] = sha("5"); g.trailers[sha("5")] = ["session_builderRACE1"];
    const other = control({r, leaseStore, g}); other.sup.start(); // a second process of the control session
    g.sessionsOf = h => { other.orch.lost(a.intentId, "SESSION_FAILED"); return g.trailers[h]; }; // LOST lands mid-verification
    expect(c.orch.submitResult(a.intentId, {sessionId: "session_builderRACE1", text: result(w, {ok: true, headSha: sha("5")})})).toMatchObject({accepted: false, reason: "INTENT_NOT_RUNNING:LOST"});
    expect(new StateJournal(localLedger(r)).workers.get(a.intentId).status).toBe("LOST");
    // and two processes binding the same intent concurrently: exactly one wins, the other is told so
    await c.sup.tick(); clock.t += 60_000; await c.sup.tick(); const b = c.orch.actions()[0]; // bounded retry after its backoff
    expect(b).toBeTruthy();
    const g2 = control({r, leaseStore, g}); g2.sup.start();
    expect(c.orch.bind(b.intentId, "session_binderAAAAA1")).toEqual({bound: true});
    expect(() => g2.orch.bind(b.intentId, "session_binderBBBBB1")).toThrow(/INTENT_NOT_PENDING/);
  });
  it("LIVE control stack: only the live domain on the protected live registry with a non-empty canonical keyring; SHADOW only for probe domains", async () => {
    const {controlStack} = await import("../../automation/factory-v2/control.mjs");
    const {parseKeyring, KEYRING_SCHEMA} = await import("../../automation/factory-v2/identity.mjs");
    const empty = parseKeyring({schema: KEYRING_SCHEMA, mode: "LIVE", domain: "uasco-v7", keys: []}, {kind: "TEST"});
    expect(() => controlStack({mode: "LIVE", domain: "probe-x", registryBranch: "uasco/registry"}, {repoDir: ".", registryProtected: true})).toThrow(/CONTROL_LIVE_DOMAIN_OR_REGISTRY_INVALID/);
    expect(() => controlStack({mode: "LIVE", domain: "uasco-v7", registryBranch: "uasco/other"}, {repoDir: ".", registryProtected: true})).toThrow(/CONTROL_LIVE_DOMAIN_OR_REGISTRY_INVALID/);
    expect(() => controlStack({mode: "LIVE", domain: "uasco-v7", registryBranch: "uasco/registry"}, {repoDir: "."})).toThrow(/CONTROL_LIVE_REGISTRY_NOT_PROTECTED/);
    expect(() => controlStack({mode: "LIVE", domain: "uasco-v7", registryBranch: "uasco/registry"}, {repoDir: ".", registryProtected: true, deps: {ring: empty, registry: {}}})).toThrow(/CONTROL_LIVE_KEYRING_EMPTY/);
    expect(() => controlStack({mode: "SHADOW", domain: "uasco-v7", registryBranch: "uasco/x"}, {repoDir: "."})).toThrow(/CONTROL_SHADOW_REQUIRES_PROBE_DOMAIN/);
    expect(() => controlStack({mode: "SHADOW", domain: "probe-x", registryBranch: "main"}, {repoDir: "."})).toThrow(/CONTROL_REGISTRY_BRANCH_INVALID/);
    expect(() => controlStack({mode: "TURBO", domain: "probe-x", registryBranch: "uasco/x"}, {repoDir: "."})).toThrow(/CONTROL_MODE_INVALID/);
  });
  it("LIVE Supervisor with keys and a protected registry stays STANDBY while no signed V2 authority names it (no dispatch, no ledger epoch)", {timeout: T}, async () => {
    const {controlStack} = await import("../../automation/factory-v2/control.mjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-live-")), origin = path.join(root, "o.git");
    git(root, "init", "-q", "--bare", "-b", "integ", origin); const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
    fs.writeFileSync(path.join(seed, "a"), "a"); git(seed, "add", "."); git(seed, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "a"); git(seed, "push", "-q", "origin", "HEAD:integ");
    const env = path.join(root, "env"); git(root, "clone", "-q", origin, env);
    const registry = createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(env)}), ref: "refs/heads/uasco/registry"});
    const keyFile = path.join(root, "k.json"); fs.writeFileSync(keyFile, JSON.stringify(S.V2));
    const s = controlStack({mode: "LIVE", domain: "uasco-v7", registryBranch: "uasco/registry", ledgerNs: "live", sessionId: SESS.V2, signerKeyFile: keyFile, repoUrl: "x", dispatchRef: "integ"},
      {repoDir: env, registryProtected: true, deps: {registry, ring: ringFor("uasco-v7"), liveReaders: {anchored: () => false, hwm: null}}});
    const st = s.sup.start();
    expect(st.owner).toBe(false); expect(String(st.authority)).toMatch(/./); // refused by the authority gate (no V2 record for this session)
    expect((await s.sup.tick()).state).toBe("STANDBY");
    expect(s.journal.events.length).toBe(0); expect(s.orch.actions()).toEqual([]);
  });
  it("one session cannot be bound to two intents even when the pre-check saw a stale view (race window)", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore();
    const backlog = [{id: "T1", paths: ["a/"]}, {id: "T2", paths: ["b/"]}];
    const c = control({r, leaseStore, backlog}); c.sup.start(); await c.sup.tick();
    const [x, y] = c.orch.actions(); const other = control({r, leaseStore, backlog}); other.sup.start();
    const stale = c.orch.workers(); c.orch.workers = () => stale; // c's pre-check runs on a view taken before other's bind lands
    other.orch.bind(x.intentId, "session_sharedSESS01");
    expect(() => c.orch.bind(y.intentId, "session_sharedSESS01")).toThrow(/SESSION_ALREADY_BOUND/);
  });
  it("a racing bind of the same intent by another session (stale pre-check view) is refused, never reported as bound", {timeout: T}, async () => {
    const {r} = repo(); const leaseStore = createMemoryStore();
    const c = control({r, leaseStore}); c.sup.start(); await c.sup.tick();
    const [x] = c.orch.actions(); const other = control({r, leaseStore}); other.sup.start();
    const stale = c.orch.workers(); c.orch.workers = () => stale; // c decided before other's bind landed
    expect(other.orch.bind(x.intentId, "session_winnerAAAAA1")).toEqual({bound: true});
    expect(() => c.orch.bind(x.intentId, "session_loserBBBBBB1")).toThrow(/INTENT_NOT_PENDING:RUNNING/);
    expect(new StateJournal(localLedger(r)).workers.get(x.intentId).sessionId).toBe("session_winnerAAAAA1");
    expect(c.orch.bind(x.intentId, "session_winnerAAAAA1")).toEqual({bound: true}); // same pair stays idempotent
  });
  it("a second, different result from the bound session after one was accepted is refused, not silently 'accepted'", {timeout: T}, async () => {
    const {r} = repo(); const g = fakeGit(); const c = control({r, g}); c.sup.start(); await c.sup.tick();
    const a = c.orch.actions()[0]; c.orch.bind(a.intentId, "session_builderDUP01"); const w = c.orch.workers(x => x.intentId === a.intentId)[0];
    g.tips[w.branch] = sha("3"); g.trailers[sha("3")] = ["session_builderDUP01"];
    const ok = result(w, {ok: true, headSha: sha("3"), summary: "one"});
    expect(c.orch.submitResult(a.intentId, {sessionId: "session_builderDUP01", text: ok})).toEqual({accepted: true});
    const stale = c.orch.workers(); c.orch.workers = () => stale.map(x => x.intentId === a.intentId ? {...x, status: "RUNNING"} : x); // stale pre-check
    expect(c.orch.submitResult(a.intentId, {sessionId: "session_builderDUP01", text: result(w, {ok: true, headSha: sha("3"), summary: "two"})})).toMatchObject({accepted: false, reason: "INTENT_NOT_RUNNING:RESULT_ACCEPTED"});
  });
  it("a registry without history cannot prove no rollback: the ledger refuses to load", () => {
    const {r} = repo(); const g = createSharedRegistry({docStore: createLocalDocStore(r), ref: REF});
    expect(() => new StateJournal(registryLog({registry: {...g, history: undefined}, ns: "h", signer: S.V2, ring: ringFor(D), domain: D}))).toThrow(/LEDGER_HISTORY_UNAVAILABLE/);
  });
});

