// //TR: Factory V2 ortak kayıt (tek izinli dal refs/heads/uasco/*) kabul testleri: iki ayrı klon arasında bölüm CAS'ı, sunucu tarafı stale CAS reddi, eşzamanlı süreçlerde kayıp yazı olmaması, lease dışlaması/fencing/devralma, otorite köprüsünün kayıt üzerinde tam devir+geri dönüşü ve STATE.json handoff.status alanının yetki kaynağı SAYILMAMASI.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {S, SESS, bridgeFor, commitLive, LIVE} from "./keys.mjs";
import {git} from "./harness.mjs";
import {createRemoteDocStore, gitRunner} from "../../automation/factory-v2/ref-doc-store.mjs";
import {createSharedRegistry} from "../../automation/factory-v2/shared-registry.mjs";
import {Ownership} from "../../automation/factory-v2/ownership.mjs";
import {snapshotV41, buildManifest} from "../../automation/factory-v2/bridge.mjs";
import {FactorySupervisor} from "../../automation/factory-v2/supervisor.mjs";

const T = 180_000;
const REF = "refs/heads/uasco/registry";
const HERE = path.dirname(fileURLToPath(import.meta.url));
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-reg-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "integ", origin);
  const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
  fs.writeFileSync(path.join(seed, "README.txt"), "b\n"); git(seed, "add", "."); git(seed, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "b"); git(seed, "push", "-q", "origin", "HEAD:integ");
  const base = git(seed, "rev-parse", "HEAD");
  const clone = n => { const d = path.join(root, n); git(root, "clone", "-q", origin, d); return d; };
  const A = clone("envA"), B = clone("envB");
  const reg = e => createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(e)}), ref: REF});
  return {root, origin, base, A, B, reg};
}
const GATES = {reviewClean: {evidence: "r"}, ciPassed: {evidence: "c"}, founderAuthorization: {evidence: "f"}, migrationAcceptance: {evidence: "m"}};

describe("shared registry on one allowed branch (two environments)", () => {
  it("section CAS across clones; the server refuses a stale whole-document CAS; history is a fast-forward commit chain", {timeout: T}, () => {
    const w = world();
    const rA = w.reg(w.A), rB = w.reg(w.B);
    expect(rA.kind).toBe("REMOTE_GIT_REF");
    expect(rA.cas("x/one", null, {v: 1}).ok).toBe(true);
    const firstVersion = git(w.origin, "rev-parse", REF);
    expect(rB.cas("x/one", null, {v: "dup"}).ok).toBe(false); // create-if-absent across environments
    const seen = rB.read("x/one");
    expect(seen.doc).toEqual({v: 1});
    expect(rB.cas("x/two", null, {v: 2}).ok).toBe(true); // a write to another section...
    expect(rA.cas("x/one", seen.sha, {v: 3}).ok).toBe(true); // ...does not break this section's CAS (retried on the doc)
    expect(rB.cas("x/one", seen.sha, {v: "stale"}).ok).toBe(false); // stale section version refused
    const raw = createRemoteDocStore({runGit: gitRunner(w.B)});
    git(w.B, "fetch", "-q", "origin", `+${REF}:${REF}`);
    const before = git(w.origin, "rev-parse", REF);
    expect(raw.cas(REF, firstVersion, {schema: "uasco.factory-v2.shared-registry/1", sections: {}}).ok).toBe(false); // outdated expectation: refused by the server's lease check
    expect(git(w.origin, "rev-parse", REF)).toBe(before);
    expect(rA.sections()).toEqual(["x/one", "x/two"]);
    const chain = git(w.origin, "rev-list", "--count", REF);
    expect(Number(chain)).toBe(3);
    expect(git(w.origin, "rev-list", "--merges", REF)).toBe(""); // linear: every write fast-forwards the previous version
  });

  it("concurrent writers in separate processes lose no update (whole-doc CAS + per-section retry)", {timeout: T}, async () => {
    const w = world();
    const script = path.join(w.root, "writer.mjs");
    fs.writeFileSync(script, `import {createRemoteDocStore, gitRunner} from ${JSON.stringify(path.resolve(HERE, "../../automation/factory-v2/ref-doc-store.mjs"))};
import {createSharedRegistry} from ${JSON.stringify(path.resolve(HERE, "../../automation/factory-v2/shared-registry.mjs"))};
const [cwd, tag] = process.argv.slice(2);
const reg = createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(cwd)}), ref: ${JSON.stringify(REF)}, maxRetries: 60, backoffMs: 15});
for (let i = 0; i < 6; i++) if (!reg.cas("w/" + tag + "-" + i, null, {tag, i}).ok) process.exit(9);
`);
    const run = (cwd, tag) => new Promise((res, rej) => { const c = spawn(process.execPath, [script, cwd, tag], {stdio: "inherit"}); c.on("close", code => code === 0 ? res() : rej(new Error(`writer ${tag} exit ${code}`))); });
    await Promise.all([run(w.A, "a"), run(w.B, "b")]);
    expect(w.reg(w.A).sections().length).toBe(12);
  });

  it("supervisor lease: exclusive across environments, fenced after takeover, epoch increases on expiry takeover", {timeout: T}, () => {
    const w = world();
    let now = 1_000_000;
    const lA = w.reg(w.A).leaseStore("live"), lB = w.reg(w.B).leaseStore("live");
    const mk = (s, sess) => new Ownership(s, {leaseId: "supervisor--LIVE-uasco-v7", environment: sess, workerId: "supervisor", sessionId: sess, ttlMs: 10_000, safetyMarginMs: 1_000, now: () => now});
    const a = mk(lA, "session_envAAAAAA"), b = mk(lB, "session_envBBBBBB");
    expect(a.acquire().granted).toBe(true);
    expect(b.acquire()).toMatchObject({granted: false});
    expect(a.renew()).toBe(true);
    now += 30_000; // A stalls past TTL
    expect(b.acquire().granted).toBe(true);
    expect(b.epoch).toBe(2);
    expect(() => a.fence()).toThrow(/OWNERSHIP_LOST/);
    expect(a.renew()).toBe(false);
  });

  it("authority bridge runs unchanged on the registry: full handover, V2 gate, rollback; STATE.json handoff.status is NOT authority", {timeout: T}, () => {
    const w = world();
    const bA = bridgeFor(w.reg(w.A), "uasco-v7");
    const bB = bridgeFor(w.reg(w.B), "uasco-v7");
    // a STATE.json that *claims* a completed handoff changes nothing: authority is only the CAS'd record
    const state = {done: [], inFlight: [], blocked: [], handoff: {status: "V2_AUTHORITATIVE", authority: "V2 owns everything"}};
    const snap = snapshotV41({baseRef: "integ", baseSha: w.base, autonomyState: state, taskIndex: {tasks: []}, openPrs: []});
    expect(JSON.stringify(snap)).not.toMatch(/V2_AUTHORITATIVE/);
    expect(bA.read().doc.authority).toBe("V4.1");
    expect(() => bA.assertV2("session_v2supervisor", null)).toThrow(/V2_NOT_AUTHORITATIVE/);
    const m = buildManifest({domain: "uasco-v7", version: 1, snapshot: snap, fromSession: SESS.V41, toSession: SESS.V2});
    bB.prepare({manifest: m, gates: GATES, signer: S.V2});
    expect(bA.v41MayDispatch()).toBe(false);
    bA.drainAck({manifestDigest: m.digest, drain: {acks: {}, builderSessionsStopped: []}, signer: S.V41});
    const c = commitLive(bB, {manifest: m, currentOpenPrs: [], currentBaseSha: m.snapshot.baseSha, currentStateDigest: m.snapshot.stateDigest, v2Session: "session_v2supervisor"});
    expect(c.doc).toMatchObject({authority: "V2", epoch: 1, holder: "session_v2supervisor"});
    expect(bA.assertV2("session_v2supervisor", 1)).toBe(1);
    bA.rollback({reason: "test", signer: S.V41});
    expect(() => bB.assertV2("session_v2supervisor", 1)).toThrow(/V2_NOT_AUTHORITATIVE/);
    expect(bA.v41MayDispatch()).toBe(true);
    expect(w.reg(w.A).sections()).toEqual(["refs/uasco/authority/uasco-v7", "refs/uasco/handover/uasco-v7/v1"]);
  });

  it("LIVE supervisor accepts the registry lease store (shared) and stays STANDBY while V4.1 is authoritative", {timeout: T}, () => {
    const w = world();
    const reg = w.reg(w.B);
    const bridge = bridgeFor(reg, "uasco-v7");
    const sup = new FactorySupervisor({domain: "uasco-v7", mode: "LIVE", sessionId: "session_v2supervisor", journalDir: path.join(w.root, "j"), leaseStore: reg.leaseStore("live"),
      executor: {start: () => { throw new Error("must not dispatch"); }}, backlog: () => [], authority: (s, e) => bridge.assertV2(s, e)});
    expect(sup.start()).toMatchObject({owner: false});
    expect(reg.sections()).toEqual([]); // nothing claimed
  });
});

describe("registry hardening (review of 5356c945)", () => {
  it("stale takeover: two environments that observed the same expired lease cannot both win (lease-version guard)", {timeout: T}, () => {
    const w = world();
    let now = 5_000_000;
    const lA = w.reg(w.A).leaseStore("live"), lB = w.reg(w.B).leaseStore("live");
    const first = new Ownership(lA, {leaseId: "writer--x", environment: "e0", workerId: "w", sessionId: "session_firstowner", ttlMs: 1_000, now: () => now});
    expect(first.acquire().granted).toBe(true);
    now += 10_000;
    const observed = lA.read("writer--x"); // both takers saw this expired record
    const take = (store, sess) => store.cas("writer--x", observed, {...observed, sessionId: sess, workerId: "w", environment: sess, epoch: observed.epoch + 1, token: `${sess}:t`, heartbeatAt: now, expiresAt: now + 60_000});
    const a = take(lA, "session_takerAAAAA"), b = take(lB, "session_takerBBBBB");
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(lA.read("writer--x").sessionId).toBe(a.ok ? "session_takerAAAAA" : "session_takerBBBBB");
  });
  it("no ABA: a section that returns to an earlier value has a new version", {timeout: T}, () => {
    const w = world();
    const r = w.reg(w.A);
    const v1 = r.cas("k", null, {x: "A"}).sha;
    const v2 = r.cas("k", v1, {x: "B"}).sha;
    const v3 = r.cas("k", v2, {x: "A"}).sha;
    expect(v3).not.toBe(v1);
    expect(r.cas("k", v1, {x: "stale"}).ok).toBe(false);
  });
});
