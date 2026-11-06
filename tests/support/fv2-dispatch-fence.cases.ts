// //TR: FV2 V4.1 dispatch otorite çiti (tests/v7-cloud-contracts.test.ts altında kayıtlı): V4.1'in yeni iş seçimi (autonomy.mjs next / dispatchNext) her şeyden ÖNCE doğrulanmış otorite kaydını okur; kayıt yokken veya V41_AUTHORITATIVE iken bugünkü çıktı aynen sürer, devir ortasında/V2 otoritedeyken/doğrulanamayan kayıtta hiçbir şey yüklenmeden BLOCK döner.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error untyped governance module
import {dispatchAuthority, mergeAuthority} from "../../automation/factory-v2/v41-guard.mjs";
// @ts-expect-error untyped governance module
import {dispatchNext, runCli, nextTasks} from "../../docs/planning/autonomy/autonomy.mjs";
// @ts-expect-error untyped governance module
import {buildManifest, snapshotV41, authorityRef} from "../../automation/factory-v2/bridge.mjs";
// @ts-expect-error untyped governance module
import {createRemoteDocStore, gitRunner} from "../../automation/factory-v2/ref-doc-store.mjs";
// @ts-expect-error untyped governance module
import {createSharedRegistry} from "../../automation/factory-v2/shared-registry.mjs";
// @ts-expect-error untyped governance module
import {signAction, KEYRING_SCHEMA, CANONICAL_KEYRING_PATH} from "../../automation/factory-v2/identity.mjs";
// @ts-expect-error untyped test helper
import {git} from "../factory-v2/harness.mjs";
// @ts-expect-error untyped test helper
import {S, SESS, bridgeFor, LIVE, ringFor} from "../factory-v2/keys.mjs";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const T = 180_000, D = "uasco-v7", BASE_REF = "v7/integration";
const GATES = {reviewClean: {evidence: "r"}, ciPassed: {evidence: "c"}, founderAuthorization: {evidence: "f"}, migrationAcceptance: {evidence: "m"}};
const DRAIN = {acks: {}, builderSessionsStopped: ["session_v41builderA"]};
// Server-enforced protection as the GitHub rules API reports it (no bypass): what the live reader requires once a record exists.
const PROTECTED_API = (p: string) => (p.startsWith("rules/branches/") ? [{type: "non_fast_forward", ruleset_id: 1}, {type: "deletion", ruleset_id: 1}]
  : p === "rulesets/1" ? {enforcement: "active", bypass_actors: [], current_user_can_bypass: "never"} : null);
const INDEX = {tasks: [{id: "A-T0001", tier: "T0", status: "PLANNED", deps: [], startGates: [], mergeGates: [], wave: "W1"}]};
const POLICY = {coveredTiers: ["T0"], standingGates: [], satisfiedGates: {}};
const STATE = {done: [], inFlight: [], blocked: []};

/** A real shared origin (bare repo) with the canonical base branch carrying a LIVE keyring of the test keys, and the V4.1 / V2 clones. */
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-dispatch-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", BASE_REF, origin);
  const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
  const kr = path.join(seed, CANONICAL_KEYRING_PATH); fs.mkdirSync(path.dirname(kr), {recursive: true});
  const entry = (s: Any) => ({keyId: s.keyId, role: s.role, sessionId: s.sessionId, publicKeyPem: s.publicKeyPem});
  fs.writeFileSync(kr, JSON.stringify({schema: KEYRING_SCHEMA, domain: D, keys: [S.V41, S.V2, S.FOUNDER].map(entry)}));
  git(seed, "add", "."); git(seed, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "b"); git(seed, "push", "-q", "origin", `HEAD:${BASE_REF}`);
  const base = git(seed, "rev-parse", "HEAD");
  const clone = (n: string) => { const d = path.join(root, n); git(root, "clone", "-q", origin, d); return d; };
  const A = clone("v41env"), B = clone("v2env"), X = clone("attackerenv");
  const reg = (e: string) => createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(e)}), ref: "refs/heads/uasco/registry"});
  const m = buildManifest({domain: D, version: 1, snapshot: snapshotV41({baseRef: BASE_REF, baseSha: base, autonomyState: {}, taskIndex: {tasks: []}, openPrs: []}), fromSession: SESS.V41, toSession: SESS.V2});
  Object.assign(LIVE, {base, prs: [], state: m.snapshot.stateDigest});
  const bA = bridgeFor(reg(A), D), bB = bridgeFor(reg(B), D);
  const key = authorityRef(D);
  // the pure fence over the real registry, with the test keyring and protection asserted
  const fence = (o: Any = {}) => dispatchAuthority({readAuthority: () => reg(A).read(key).doc, readHistory: () => reg(A).history(key), registryProtected: () => true, keyring: () => ringFor(D), ...o});
  return {root, A, X, reg, key, m, bA, bB, fence,
    prepare: () => bB.prepare({manifest: m, gates: GATES, signer: S.V2}),
    drain: () => bA.drainAck({manifestDigest: m.digest, drain: DRAIN, signer: S.V41}),
    commit: () => bB.commit({manifest: m, signer: S.V2}),
    rollback: () => bA.rollback({reason: "back", signer: S.V41})};
}

/** dispatchNext with counting loaders: the loaders are the only work `next` does after the fence, so zero calls = zero side effects. */
function counted() {
  const calls: string[] = [];
  const load = {index: () => { calls.push("index"); return INDEX; }, state: () => { calls.push("state"); return STATE; }, policy: () => { calls.push("policy"); return POLICY; }};
  return {calls, load};
}

export function registerFv2DispatchFenceCases(): void {
  describe("FV2 governance: V4.1 dispatch fence (dispatchAuthority, pure)", () => {
    it("(a) no authority record anywhere: allowed (genesis, V4.1 as today)", () => {
      expect(dispatchAuthority({readAuthority: () => null, keyring: () => { throw new Error("never read"); }})).toEqual({allowed: true, by: "V4.1", reason: "NO_AUTHORITY_RECORD"});
    });
    it("(b)-(d) real signed records across the handover: V41 allowed; PREPARED / DRAINED / V2 blocked; rollback to V41 allowed again", {timeout: T}, () => {
      const w = world();
      expect(w.fence()).toMatchObject({allowed: true, reason: "NO_AUTHORITY_RECORD"});
      w.prepare();
      expect(w.fence()).toEqual({allowed: false, reason: "HANDOVER_IN_PROGRESS:HANDOVER_PREPARED"});
      w.drain();
      expect(w.fence()).toEqual({allowed: false, reason: "HANDOVER_IN_PROGRESS:V41_DRAINED"});
      w.commit();
      expect(w.fence()).toEqual({allowed: false, reason: "V41_FENCED_BY_V2_AUTHORITY"});
      w.rollback();
      expect(w.fence()).toMatchObject({allowed: true, by: "V4.1", epoch: 2});
    });
    it("(e) forged / unprotected / unverifiable records are blocked as AUTHORITY_UNVERIFIABLE", {timeout: T}, () => {
      const w = world();
      // forged V2 record naming the attacker, chain signed by an unregistered key
      const core = {domain: D, authority: "V2", phase: "V2_AUTHORITATIVE", epoch: 1, holder: SESS.ATTACK, candidate: SESS.ATTACK, outgoing: SESS.V41, manifest: null, gatesDigest: null, drainDigest: null};
      const fake = {schema: "uasco.factory-v2.authority/1", ...core, chain: [{core, envelope: signAction({...S.ATTACK, domain: D, action: "COMMIT", prev: "x", payload: core})}]};
      expect(w.reg(w.X).cas(w.key, null, fake).ok).toBe(true);
      expect(w.fence().reason).toMatch(/^AUTHORITY_UNVERIFIABLE:.*SIGNER_KEY_UNKNOWN/);
      expect(w.fence().allowed).toBe(false);
      // a forged record claiming V41_AUTHORITATIVE is no better: it is not genesis, so it must verify
      const w2 = world();
      const c41 = {...core, authority: "V4.1", phase: "V41_AUTHORITATIVE", holder: SESS.ATTACK};
      expect(w2.reg(w2.X).cas(w2.key, null, {schema: "uasco.factory-v2.authority/1", ...c41, chain: [{core: c41, envelope: signAction({...S.ATTACK, domain: D, action: "ROLLBACK", prev: "x", payload: c41})}]}).ok).toBe(true);
      expect(w2.fence()).toMatchObject({allowed: false, reason: expect.stringMatching(/^AUTHORITY_UNVERIFIABLE:/)});
      // a genuine V41 record on an unprotected registry, or with no keyring, carries no authority
      const w3 = world(); w3.prepare(); w3.drain(); w3.commit(); w3.rollback();
      expect(w3.fence().allowed).toBe(true);
      expect(w3.fence({registryProtected: () => false})).toEqual({allowed: false, reason: "AUTHORITY_UNVERIFIABLE:REGISTRY_NOT_PROTECTED"});
      expect(w3.fence({registryProtected: () => { throw new Error("rules api down"); }})).toEqual({allowed: false, reason: "AUTHORITY_UNVERIFIABLE:REGISTRY_NOT_PROTECTED"});
      expect(w3.fence({keyring: () => { throw new Error("KEYRING_ABSENT"); }})).toEqual({allowed: false, reason: "AUTHORITY_UNVERIFIABLE:KEYRING_ABSENT"});
      // record deleted after authority existed (history remains): never read as genesis
      expect(w3.fence({readAuthority: () => null}).reason).toMatch(/^AUTHORITY_UNVERIFIABLE:.*AUTHORITY_RECORD_REMOVED/);
      // a reader that remembers a higher epoch than the record: regression, blocked
      expect(w3.fence({hwm: {get: () => ({epoch: 99}), set: () => {}}}).reason).toMatch(/^AUTHORITY_UNVERIFIABLE:.*AUTHORITY_REGRESSION/);
    });
    it("(f) any reader throwing, or a malformed history, blocks fail-closed", () => {
      const boom = () => { throw new Error("REMOTE_UNREACHABLE"); };
      for (const o of [{readAuthority: boom}, {readAuthority: () => null, readHistory: boom}, {readAuthority: () => null, anchored: boom},
        {readAuthority: () => null, hwm: {get: boom, set: () => {}}}]) {
        expect(dispatchAuthority({keyring: () => ringFor(D), ...o})).toEqual({allowed: false, reason: "AUTHORITY_UNVERIFIABLE:READ:REMOTE_UNREACHABLE"});
      }
      expect(dispatchAuthority({readAuthority: () => null, readHistory: () => "x", keyring: () => ringFor(D)})).toEqual({allowed: false, reason: "AUTHORITY_UNVERIFIABLE:READ:HISTORY_MALFORMED"});
      // genesis is only genesis when nothing at all was ever seen
      expect(dispatchAuthority({readAuthority: () => null, anchored: () => true, registryProtected: () => true, keyring: () => ringFor(D)}).reason).toMatch(/^AUTHORITY_UNVERIFIABLE:.*AUTHORITY_RECORD_REMOVED/);
      expect(dispatchAuthority({readAuthority: () => null, hwm: {get: () => ({epoch: 3}), set: () => {}}, registryProtected: () => true, keyring: () => ringFor(D)}).allowed).toBe(false);
      // the merge guard is unchanged by the new export
      expect(mergeAuthority({readAuthority: () => null, keyring: () => ringFor(D)})).toEqual({allowed: true, by: "V4.1", reason: "NO_AUTHORITY_RECORD"});
    });
  });

  describe("FV2 governance: dispatchNext (autonomy.mjs next) runs the fence before any work", () => {
    it("allowed: output is exactly today's nextTasks result, exit 0", () => {
      const {calls, load} = counted();
      const r = dispatchNext({authority: () => ({allowed: true, by: "V4.1"}), load, limit: 3});
      expect(r).toEqual({exit: 0, res: nextTasks({index: INDEX, state: STATE, policy: POLICY, limit: 3})});
      expect(calls.sort()).toEqual(["index", "policy", "state"]);
    });
    it.each([["mid-handover", "HANDOVER_IN_PROGRESS:V41_DRAINED"], ["V2 authoritative", "V41_FENCED_BY_V2_AUTHORITY"], ["unverifiable", "AUTHORITY_UNVERIFIABLE:x"]])
    ("%s: BLOCK (exit 2), nothing loaded or selected", (_n, reason) => {
      const {calls, load} = counted();
      expect(dispatchNext({authority: () => ({allowed: false, reason}), load})).toEqual({exit: 2, res: {decision: "BLOCK", reasons: [`AUTHORITY:${reason}`]}});
      expect(calls).toEqual([]);
    });
    it("(f) the authority check throwing or returning garbage: BLOCK, zero side effects, nothing thrown", () => {
      for (const authority of [() => { throw new Error("boom"); }, () => undefined, () => ({allowed: "yes"}), () => ({allowed: 1})]) {
        const {calls, load} = counted();
        const r = dispatchNext({authority, load});
        expect(r.exit).toBe(2);
        expect(r.res.decision).toBe("BLOCK");
        expect(calls).toEqual([]);
      }
    });
    it("(g) default wiring (live verified reader over a real origin, injected repoRoot/api): genesis allowed, handover/V2 blocked, rollback allowed", {timeout: T}, () => {
      const w = world();
      const live = () => { const {calls, load} = counted(); return {r: dispatchNext({repoRoot: w.A, api: PROTECTED_API, load}), calls}; };
      let x = live();
      expect(x.r.exit).toBe(0); // no record on origin: today's behaviour
      expect(x.r.res.ready).toEqual([{task: "A-T0001", tier: "T0"}]);
      w.prepare();
      x = live(); expect(x.r.res).toEqual({decision: "BLOCK", reasons: ["AUTHORITY:HANDOVER_IN_PROGRESS:HANDOVER_PREPARED"]}); expect(x.calls).toEqual([]);
      w.drain(); w.commit();
      x = live(); expect(x.r).toEqual({exit: 2, res: {decision: "BLOCK", reasons: ["AUTHORITY:V41_FENCED_BY_V2_AUTHORITY"]}}); expect(x.calls).toEqual([]);
      // without server-side registry protection the same live record is unverifiable
      const {calls, load} = counted();
      expect(dispatchNext({repoRoot: w.A, api: () => [], load}).res.reasons).toEqual(["AUTHORITY:AUTHORITY_UNVERIFIABLE:REGISTRY_NOT_PROTECTED"]);
      expect(calls).toEqual([]);
      w.rollback();
      x = live(); expect(x.r.exit).toBe(0); expect(x.calls.length).toBe(3);
      // an unreachable origin fails closed through the default reader
      const lone = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-dispatch-lone-")); git(lone, "init", "-q");
      const y = counted();
      expect(dispatchNext({repoRoot: lone, api: PROTECTED_API, load: y.load}).res.reasons[0]).toMatch(/^AUTHORITY:AUTHORITY_UNVERIFIABLE:READ:REMOTE_UNREACHABLE/);
      expect(y.calls).toEqual([]);
    });
    it("the `next` CLI goes through dispatchNext (unknown commands still ARG_INVALID)", () => {
      const src = fs.readFileSync("docs/planning/autonomy/autonomy.mjs", "utf8");
      expect(src).toMatch(/if \(cmd === "next"\) return dispatchNext\(/);
      expect(runCli(["bogus"])).toEqual({exit: 3, res: {decision: "INTERNAL_ERROR", reasons: ["ARG_INVALID"]}});
    });
  });
}
