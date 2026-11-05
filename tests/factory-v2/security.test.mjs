// //TR: Factory V2 devir güvenliği testleri (Founder direktifi, PR #347): drainAck kimlik taklidi, imzalı relay ve değiştirilemezlik, replay, yetkisiz rollback, kayıt dalına doğrudan sahte yazı, eski duruma geri sarma, kabul kanıtlarının canlı kaynak/SHA/kapsam/yetki doğrulaması, çağıran yerine canlı tazelik, V4.1 merge yolunu devirden sonra kesen guard ve yamalanmış kanonik executor.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL, fileURLToPath} from "node:url";
import {git} from "./harness.mjs";
import {S, SESS, bridgeFor, commitLive, LIVE, ringFor} from "./keys.mjs";
import {createRemoteDocStore, gitRunner} from "../../automation/factory-v2/ref-doc-store.mjs";
import {createSharedRegistry} from "../../automation/factory-v2/shared-registry.mjs";
import {Ownership} from "../../automation/factory-v2/ownership.mjs";
import {snapshotV41, buildManifest, authorityRef, verifyAuthorityDoc, checkTransition} from "../../automation/factory-v2/bridge.mjs";
import {signAction, canonDigest} from "../../automation/factory-v2/identity.mjs";
import {verifyGates} from "../../automation/factory-v2/gate-verifier.mjs";
import {mergeAuthority, liveAuthorityReaders} from "../../automation/factory-v2/v41-guard.mjs";

const T = 180_000, D = "uasco-v7";
const GATES = {reviewClean: {evidence: "r"}, ciPassed: {evidence: "c"}, founderAuthorization: {evidence: "f"}, migrationAcceptance: {evidence: "m"}};
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-sec-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "integ", origin);
  const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
  fs.writeFileSync(path.join(seed, "R"), "b\n"); git(seed, "add", "."); git(seed, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "b"); git(seed, "push", "-q", "origin", "HEAD:integ");
  const base = git(seed, "rev-parse", "HEAD");
  const clone = n => { const d = path.join(root, n); git(root, "clone", "-q", origin, d); return d; };
  const A = clone("v41env"), B = clone("v2env"), X = clone("attackerenv");
  const reg = e => createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(e)}), ref: "refs/heads/uasco/registry"});
  const m = buildManifest({domain: D, version: 1, snapshot: snapshotV41({baseRef: "integ", baseSha: base, autonomyState: {}, taskIndex: {tasks: []}, openPrs: []}), fromSession: SESS.V41, toSession: SESS.V2});
  Object.assign(LIVE, {base, prs: [], state: m.snapshot.stateDigest});
  return {root, base, A, B, X, reg, m, bA: bridgeFor(reg(A), D), bB: bridgeFor(reg(B), D), bX: bridgeFor(reg(X), D)};
}
const drain = {acks: {}, builderSessionsStopped: ["session_v41builderA"]};
const toV2 = w => { w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2}); w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41}); return w.bB.commit({manifest: w.m, signer: S.V2}); };

describe("1. drainAck cannot be impersonated (caller-supplied actor is ignored)", () => {
  it("attacker: no signature / own key claiming V4.1 / candidate key / tampered real envelope — all refused; the real V4.1 key succeeds", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, actor: SESS.V41})).toThrow(/SIGNATURE_REQUIRED/);
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, signer: {...S.ATTACK, sessionId: SESS.V41, role: "V41_OWNER"}})).toThrow(/SIGNER_KEY_UNKNOWN/);
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, signer: S.V2})).toThrow(/ROLE_NOT_ALLOWED/);
    // the attacker obtains a genuine V4.1 envelope for a *different* drain and edits it
    const cur = w.bX.read();
    const genuine = signAction({...S.V41, domain: D, action: "DRAIN_ACK", prev: canonDigest(cur.core), payload: w.bX.drainCore(cur, {manifestDigest: w.m.digest, drain: {acks: {}, builderSessionsStopped: []}})});
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, envelope: genuine})).toThrow(/PAYLOAD_MISMATCH/); // payload bound
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, envelope: {...genuine, sessionId: SESS.ATTACK}})).toThrow(/SIGNATURE_INVALID/);
    expect(w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41}).signer).toMatchObject({role: "V41_OWNER", sessionId: SESS.V41});
  });
});

describe("6. relay protocol: V4.1 signs offline, anyone relays, nobody can alter or replay", () => {
  it("relayed envelope is accepted exactly once and only for the state it was signed for", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    const cur = w.bA.read(); // the V4.1 session reads the registry (read access only) and signs the deterministic next core
    const env = signAction({...S.V41, domain: D, action: "DRAIN_ACK", prev: canonDigest(cur.core), payload: w.bA.drainCore(cur, {manifestDigest: w.m.digest, drain})});
    // relayed by the attacker environment, unchanged -> accepted, attributed to V4.1
    expect(w.bX.drainAck({manifestDigest: w.m.digest, drain, envelope: env}).signer.sessionId).toBe(SESS.V41);
    // replaying the same envelope later (state moved on) is refused
    w.bA.rollback({reason: "x", signer: S.V41});
    w.bB.prepare({manifest: buildManifest({...w.m, version: 2, snapshot: w.m.snapshot}), gates: GATES, signer: S.V2});
    expect(() => w.bX.drainAck({manifestDigest: buildManifest({...w.m, version: 2, snapshot: w.m.snapshot}).digest, drain, envelope: env})).toThrow(/STALE_OR_REPLAYED|PAYLOAD_MISMATCH/);
  });
});

describe("3. rollback requires a V41_OWNER or FOUNDER key", () => {
  it("candidate key, attacker key and unsigned rollback are refused; V4.1 and Founder succeed", {timeout: T}, () => {
    const w = world();
    toV2(w);
    expect(() => w.bB.rollback({reason: "x", signer: S.V2})).toThrow(/ROLE_NOT_ALLOWED/);
    expect(() => w.bX.rollback({reason: "x", signer: S.ATTACK})).toThrow(/SIGNER_KEY_UNKNOWN/);
    expect(() => w.bX.rollback({reason: "x", actor: SESS.FOUNDER})).toThrow(/SIGNATURE_REQUIRED/);
    expect(w.bB.assertV2(SESS.V2, 1)).toBe(1); // still V2
    expect(w.bX.rollback({reason: "founder", signer: S.FOUNDER}).core).toMatchObject({phase: "V41_AUTHORITATIVE", epoch: 2});
    expect(w.bA.rollback({reason: "v41", signer: S.V41}).core.epoch).toBe(3);
  });
});

describe("4. a registry writer cannot impersonate a role by writing the document directly", () => {
  it("forged V2 authority, truncated chain and core edits are all unverifiable: V2 gate refuses, V4.1 halts, guard refuses every merge", {timeout: T}, () => {
    const w = world();
    const regX = w.reg(w.X);
    const key = authorityRef(D);
    // (a) forge a V2 authority naming the attacker, with a chain signed by the attacker's own (unregistered) key
    const core = {domain: D, authority: "V2", phase: "V2_AUTHORITATIVE", epoch: 1, holder: SESS.ATTACK, candidate: SESS.ATTACK, outgoing: SESS.V41, manifest: null, gatesDigest: null, drainDigest: null};
    const fake = {schema: "uasco.factory-v2.authority/1", ...core, chain: [{core, envelope: signAction({...S.ATTACK, domain: D, action: "COMMIT", prev: "x", payload: core})}]};
    expect(regX.cas(key, null, fake).ok).toBe(true); // the write itself succeeds (CAS is not identity)...
    expect(() => w.bB.assertV2(SESS.ATTACK, null)).toThrow(/SIGNER_KEY_UNKNOWN/); // ...but nobody accepts it
    expect(w.bA.v41MayDispatch()).toBe(false); // unverifiable record: V4.1 halts too (no split brain)
    const guard = v2Intent => mergeAuthority({readAuthority: () => w.reg(w.A).read(key).doc, readHistory: () => w.reg(w.A).history(key), registryProtected: () => true, keyring: () => ringFor(D), pr: 1, headSha: "a".repeat(40), v2Intent});
    expect(guard(null)).toMatchObject({allowed: false});
    expect(guard(null).reason).toMatch(/AUTHORITY_UNVERIFIABLE/);
  });
  it("editing the core of a genuine record (holder swap) breaks the chain", {timeout: T}, () => {
    const w = world();
    toV2(w);
    const regX = w.reg(w.X), cur = regX.read(authorityRef(D));
    expect(regX.cas(authorityRef(D), cur.sha, {...cur.doc, holder: SESS.ATTACK}).ok).toBe(true);
    expect(() => w.bB.read()).toThrow(/AUTHORITY_CORE_MISMATCH/);
    expect(() => w.bX.assertV2(SESS.ATTACK, null)).toThrow();
  });
  it("rewinding to an older valid state: the V2 holder that remembers its epoch stops; V4.1 resumes; never both", {timeout: T}, () => {
    const w = world();
    const regX = w.reg(w.X);
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    const old = regX.read(authorityRef(D)); // HANDOVER_PREPARED snapshot
    w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41});
    const c = w.bB.commit({manifest: w.m, signer: S.V2});
    const now = regX.read(authorityRef(D));
    expect(regX.cas(authorityRef(D), now.sha, old.doc).ok).toBe(true); // attacker rewinds
    expect(() => w.bB.assertV2(SESS.V2, c.core.epoch)).toThrow(/AUTHORITY_REGRESSION/); // V2 stops: the rewind itself is detected
    expect(w.bA.v41MayDispatch()).toBe(false); // mid-handover: V4.1 does not resume either until a signed rollback
  });
});

describe("2. acceptance evidence is verified (source, SHA, scope, authority) — never accepted as text", () => {
  const H = "a".repeat(40), BASE = "b".repeat(40), M = "c".repeat(40), CAN = "d".repeat(40);
  const binding = (over = {}) => ({id: 9, state: "COMMENTED", user: {login: "SalimBurakAytemiz"}, body: `x\nVERDICT-BINDING: verdict=CLEAN head=${H} base=${BASE} reviewer-session=session_reviewer01\n`, ...over});
  const fixture = (o = {}) => {
    const gh = {
      "pulls/347": {merged: true, merge_commit_sha: M, base: {ref: "v7/integration", sha: BASE}, head: {sha: H}, ...o.pr},
      "pulls/347/files?per_page=100": o.files ?? [{filename: "automation/factory-v2/bridge.mjs"}],
      "pulls/347/reviews?per_page=100": o.reviews ?? [binding()],
      "pulls/347/commits?per_page=100": o.commits ?? [{sha: H, commit: {message: "work\n\nClaude-Session: https://claude.ai/code/session_builderPR347"}}],
      [`commits/${H}/check-runs?per_page=100`]: {check_runs: o.runs ?? ["validate (ubuntu-latest)", "validate (windows-latest)"].map(name => ({name, app: {slug: "github-actions"}, head_sha: H, status: "completed", conclusion: "success"}))},
      [`actions/runs?head_sha=${M}&event=push&per_page=50`]: {workflow_runs: o.push ?? [{id: 1, path: ".github/workflows/ci.yml", head_branch: "v7/integration", head_sha: M, status: "completed", conclusion: "success"}]}
    };
    const files = {"docs/planning/authority/FD-2026-11-05-FACTORY-V2-CUTOVER.md": o.fd ?? `# FD\nAUTHORIZES: FACTORY_V2_CUTOVER domain=uasco-v7 candidate=${SESS.V2} manifest-version=1\n`};
    return {gh: p => { if (!(p in gh)) throw new Error(`no fixture ${p}`); return gh[p]; }, git: {canonicalSha: () => CAN, isAncestor: (a, b) => o.notAncestor ? false : a === M && b === CAN, show: (sha, p) => sha === CAN ? files[p] ?? null : null},
      trustedReviewerLogins: ["SalimBurakAytemiz"], builderSessions: new Set(o.builders ?? []), baseRef: "v7/integration"};
  };
  const gates = (o = {}) => ({reviewClean: {pr: 347, headSha: H}, ciPassed: {headSha: H}, founderAuthorization: {path: "docs/planning/authority/FD-2026-11-05-FACTORY-V2-CUTOVER.md"}, migrationAcceptance: {mergeSha: M}, ...o});
  const ctx = {domain: D, candidate: SESS.V2, manifestVersion: 1};
  it("genuine evidence verifies and records exactly what was checked", () => {
    const r = verifyGates(gates(), ctx, fixture());
    expect(r.verified.reviewClean).toMatchObject({pr: 347, headSha: H, mergeSha: M, reviewerSession: "session_reviewer01"});
    expect(r.verified.founderAuthorization).toMatchObject({canonicalSha: CAN, candidate: SESS.V2, manifestVersion: 1});
  });
  it.each([
    ["plain strings", gates({reviewClean: {evidence: "trust me"}}), {}, /GATE_REVIEW:EVIDENCE_SHAPE/],
    ["PR not merged", gates(), {pr: {merged: false}}, /PR_NOT_MERGED/],
    ["head mismatch", gates(), {pr: {head: {sha: "e".repeat(40)}}}, /HEAD_MISMATCH/],
    ["merge not in canonical", gates(), {notAncestor: true}, /MERGE_NOT_IN_CANONICAL/],
    ["out of scope PR", gates(), {files: [{filename: "README.md"}]}, /OUT_OF_SCOPE/],
    ["untrusted reviewer login", gates(), {reviews: [binding({user: {login: "someone-else"}})]}, /NO_TRUSTED_CLEAN_BINDING_AT_HEAD/],
    ["binding on another head", gates(), {reviews: [binding({body: `VERDICT-BINDING: verdict=CLEAN head=${"f".repeat(40)} base=${BASE} reviewer-session=session_reviewer01`})]}, /NO_TRUSTED_CLEAN_BINDING_AT_HEAD/],
    ["reviewer is a builder session (caller-supplied list)", gates(), {builders: ["session_reviewer01"]}, /NO_TRUSTED_CLEAN_BINDING_AT_HEAD/],
    ["reviewer is the PR's own implementer (Claude-Session trailer, same login)", gates(), {commits: [{sha: H, commit: {message: "x\n\nClaude-Session: https://claude.ai/code/session_reviewer01"}}]}, /NO_TRUSTED_CLEAN_BINDING_AT_HEAD/],
    ["100 or more commits (listing may be truncated)", gates(), {commits: Array.from({length: 100}, () => ({sha: H, commit: {message: "x\n\nClaude-Session: https://claude.ai/code/session_builderPR347"}}))}, /PR_COMMITS_UNVERIFIABLE/],
    ["reviewer session is a case variant of the implementer", gates(), {commits: [{sha: H, commit: {message: "x\n\nClaude-Session: https://claude.ai/code/session_REVIEWER01"}}]}, /NO_TRUSTED_CLEAN_BINDING_AT_HEAD/],
    ["reviewer-side case variant: binding session is an upper-case variant of a lower-case implementer", gates(), {reviews: [binding({body: `VERDICT-BINDING: verdict=CLEAN head=${H} base=${BASE} reviewer-session=session_REVIEWER01`})], commits: [{sha: H, commit: {message: "x\n\nClaude-Session: https://claude.ai/code/session_reviewer01"}}]}, /NO_TRUSTED_CLEAN_BINDING_AT_HEAD/],
    ["PR commits without implementer trailers", gates(), {commits: [{sha: H, commit: {message: "no trailer"}}]}, /IMPLEMENTER_SESSIONS_UNKNOWN/],
    ["migration run on another branch", gates(), {push: [{id: 1, path: ".github/workflows/ci.yml", head_branch: "other", head_sha: "c".repeat(40), status: "completed", conclusion: "success"}]}, /NO_PUSH_RUN/],
    ["CI on another SHA", gates({ciPassed: {headSha: "e".repeat(40)}}), {}, /GATE_CI:SHA_NOT_REVIEWED_HEAD/],
    ["CI context failed", gates(), {runs: [{name: "validate (ubuntu-latest)", app: {slug: "github-actions"}, head_sha: H, status: "completed", conclusion: "failure"}, {name: "validate (windows-latest)", app: {slug: "github-actions"}, head_sha: H, status: "completed", conclusion: "success"}]}, /CONTEXT_NOT_SUCCESS/],
    ["CI from a foreign app", gates(), {runs: ["validate (ubuntu-latest)", "validate (windows-latest)"].map(name => ({name, app: {slug: "other"}, head_sha: H, status: "completed", conclusion: "success"}))}, /CONTEXT_MISSING/],
    ["Founder record outside governance path", gates({founderAuthorization: {path: "docs/factory-v2/README.md"}}), {}, /PATH_NOT_GOVERNANCE/],
    ["Founder record not in canonical", gates({founderAuthorization: {path: "docs/planning/authority/NOPE.md"}}), {}, /NOT_IN_CANONICAL/],
    ["Founder record for another candidate", gates(), {fd: `AUTHORIZES: FACTORY_V2_CUTOVER domain=uasco-v7 candidate=${SESS.ATTACK} manifest-version=1`}, /SCOPE_MISMATCH/],
    ["migration evidence for another merge", gates({migrationAcceptance: {mergeSha: "e".repeat(40)}}), {}, /NOT_THE_REVIEWED_MERGE/],
    ["post-merge CI failed", gates(), {push: [{id: 1, path: ".github/workflows/ci.yml", head_branch: "v7/integration", head_sha: M, status: "completed", conclusion: "failure"}]}, /PUSH_RUN_NOT_SUCCESS/]
  ])("refuses: %s", (_n, g, o, re) => { expect(() => verifyGates(g, ctx, fixture(o))).toThrow(re); });
  it("prepare without a verifier is refused (no text-only acceptance path)", {timeout: T}, () => {
    const w = world();
    const b = bridgeFor(w.reg(w.B), D, {gateVerifier: undefined});
    expect(() => b.prepare({manifest: w.m, gates: GATES, signer: S.V2})).toThrow(/GATE_VERIFIER_REQUIRED/);
  });
});

describe("7. freshness comes from live canonical sources, not from the caller", () => {
  it("commit ignores caller-supplied freshness; live base/state/PR changes refuse; no live source refuses", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41});
    LIVE.base = "e".repeat(40);
    expect(() => w.bB.commit({manifest: w.m, signer: S.V2, currentBaseSha: w.base, currentStateDigest: w.m.snapshot.stateDigest, currentOpenPrs: []})).toThrow(/CANONICAL_BASE_MOVED/);
    LIVE.base = w.base; LIVE.prs = [{number: 5, head: {sha: "1".repeat(40)}, base: {ref: "integ"}}];
    expect(() => w.bB.commit({manifest: w.m, signer: S.V2})).toThrow(/PR_5_OPENED_AFTER_MANIFEST/);
    LIVE.prs = [];
    expect(() => bridgeFor(w.reg(w.B), D, {live: undefined}).commit({manifest: w.m, signer: S.V2})).toThrow(/LIVE_SOURCE_REQUIRED/);
    expect(w.bB.commit({manifest: w.m, signer: S.V2}).core.phase).toBe("V2_AUTHORITATIVE");
  });
});

describe("5. the canonical merge path refuses V4.1 merges after handover (independent of V2's own checks)", () => {
  const intent = (core, o = {}, signer = S.V2) => signAction({...signer, domain: D, action: "MERGE", prev: canonDigest(core), payload: {pr: 7, headSha: "a".repeat(40), epoch: core.epoch, ...o}});
  it("guard decisions across phases", {timeout: T}, () => {
    const w = world();
    const read = () => w.reg(w.A).read(authorityRef(D)).doc;
    const g = v2Intent => mergeAuthority({readAuthority: read, readHistory: () => w.reg(w.A).history(authorityRef(D)), registryProtected: () => true, keyring: () => ringFor(D), pr: 7, headSha: "a".repeat(40), v2Intent});
    expect(g(null)).toMatchObject({allowed: true, by: "V4.1"}); // no record yet: status quo
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    expect(g(null)).toMatchObject({allowed: false, reason: "HANDOVER_IN_PROGRESS:HANDOVER_PREPARED"});
    w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41});
    const c = w.bB.commit({manifest: w.m, signer: S.V2});
    expect(g(null)).toMatchObject({allowed: false, reason: "V41_FENCED_BY_V2_AUTHORITY"});
    expect(g(intent(c.core))).toMatchObject({allowed: true, by: "V2", holder: SESS.V2});
    expect(g(intent(c.core, {headSha: "b".repeat(40)})).reason).toMatch(/PAYLOAD_MISMATCH/);
    expect(g(intent(c.core, {}, S.V41)).reason).toMatch(/ROLE_NOT_ALLOWED/);
    expect(g(intent(c.core, {}, S.ATTACK)).reason).toMatch(/SIGNER_KEY_UNKNOWN/);
    w.bA.rollback({reason: "back", signer: S.V41});
    expect(g(null)).toMatchObject({allowed: true, by: "V4.1"});
    expect(g(intent(c.core)).allowed).toBe(false);
  });
  it("the prepared executor.mjs patch blocks the real merge call before any write when V2 is authoritative", {timeout: T}, async () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-exec-"));
    fs.rmSync(wt, {recursive: true});
    git(repo, "worktree", "add", "-q", "--detach", wt, "HEAD");
    try {
      const ap = spawnSync("git", ["apply", path.join(repo, "docs/authority-requests/FV2-PROTECTED-EXECUTOR-AUTHORITY-FENCE.diff")], {cwd: wt, encoding: "utf8"});
      expect(ap.status, ap.stderr).toBe(0);
      fs.symlinkSync(path.join(repo, "node_modules"), path.join(wt, "node_modules"), "junction"); // junction: no privilege needed on Windows
      fs.cpSync(path.join(repo, "automation/factory-v2"), path.join(wt, "automation/factory-v2"), {recursive: true}); // the code under test, as in this working tree
      const {executeMerge} = await import(pathToFileURL(path.join(wt, "docs/planning/autonomy/executor.mjs")).href);
      const H = "a".repeat(40), B = "b".repeat(40);
      let writes = 0;
      const run = authority => executeMerge({pr: 7, implementerSessions: ["s"], authority,
        collect: () => ({policy: {mergeMethod: "merge"}, evidence: {pr: {base: {ref: "v7/integration"}}}}),
        decide: () => ({gate: {decision: "MERGE"}, result: {decision: "AUTO_MERGE", task: "X-T0001", expectedHeadSha: H, expectedBaseSha: B, reasons: []}}),
        api: p => (p.startsWith("branches/") ? {commit: {sha: B}} : {}), write: () => { writes++; return {merged: false}; }});
      const w = world(); toV2(w);
      const v2 = a => mergeAuthority({readAuthority: () => w.reg(w.A).read(authorityRef(D)).doc, readHistory: () => w.reg(w.A).history(authorityRef(D)), registryProtected: () => true, keyring: () => ringFor(D), ...a});
      expect(run(v2)).toMatchObject({decision: "BLOCK", reasons: ["AUTHORITY:V41_FENCED_BY_V2_AUTHORITY"]});
      expect(writes).toBe(0);
      expect(run(() => { throw new Error("boom"); })).toMatchObject({decision: "BLOCK", reasons: ["AUTHORITY:AUTHORITY_CHECK_FAILED"]});
      expect(writes).toBe(0);
      run(a => mergeAuthority({readAuthority: () => null, keyring: () => ringFor(D), ...a})); // no record: V4.1 proceeds to the write
      expect(writes).toBe(1);
    } finally { spawnSync("git", ["worktree", "remove", "--force", wt], {cwd: repo}); }
  });
});

describe("verifyAuthorityDoc", () => {
  it("absent record is the V4.1 genesis; a valid chain verifies", {timeout: T}, () => {
    const w = world();
    expect(verifyAuthorityDoc(null, {ring: ringFor(D), domain: D}).core.phase).toBe("V41_AUTHORITATIVE");
    toV2(w);
    expect(verifyAuthorityDoc(w.reg(w.A).read(authorityRef(D)).doc, {ring: ringFor(D), domain: D}).epoch).toBe(1);
    expect(() => verifyAuthorityDoc(w.reg(w.A).read(authorityRef(D)).doc, {ring: ringFor("other"), domain: D})).toThrow(/DOMAIN_MISMATCH/);
  });
});

describe("resetInvalid", () => {
  it("only an unverifiable record can be reset, and only by V41_OWNER/FOUNDER; the chain restarts at a verified V4.1 genesis", {timeout: T}, () => {
    const w = world();
    expect(() => w.bA.resetInvalid({reason: "x", signer: S.V41})).toThrow(/RESET_NOT_NEEDED/);
    toV2(w);
    const regX = w.reg(w.X), cur = regX.read(authorityRef(D));
    regX.cas(authorityRef(D), cur.sha, {...cur.doc, holder: SESS.ATTACK});
    expect(() => w.bX.resetInvalid({reason: "x", signer: S.V2})).toThrow(/ROLE_NOT_ALLOWED/);
    expect(w.bX.resetInvalid({reason: "forged", signer: S.FOUNDER}).core).toMatchObject({phase: "V41_AUTHORITATIVE", epoch: 2}); // above every epoch ever stored
    expect(w.bA.v41MayDispatch()).toBe(true);
    expect(() => w.bB.assertV2(SESS.V2, 1)).toThrow(/V2_NOT_AUTHORITATIVE/);
  });
});

describe("anti-rewind (review of b31a0338, B1): a registry writer cannot roll authority back without a key", () => {
  const key = authorityRef(D);
  const guardOf = (w, o = {}) => v2Intent => mergeAuthority({readAuthority: () => w.reg(w.A).read(key).doc, readHistory: () => w.reg(w.A).history(key), registryProtected: () => true, keyring: () => ringFor(D), pr: 7, headSha: "a".repeat(40), v2Intent, ...o});
  it("(a) deleting the record after a handover: V4.1 does NOT resume, the guard refuses, only a signed reset recovers (epoch above everything seen)", {timeout: T}, () => {
    const w = world(); toV2(w);
    const regX = w.reg(w.X), cur = regX.read(key);
    expect(regX.remove(key, cur.sha)).toBe(true);
    expect(w.bA.v41MayDispatch()).toBe(false);
    expect(() => w.bB.read()).toThrow(/AUTHORITY_RECORD_REMOVED/);
    expect(guardOf(w)(null)).toMatchObject({allowed: false});
    expect(guardOf(w)(null).reason).toMatch(/AUTHORITY_RECORD_REMOVED/);
    expect(() => w.bX.resetInvalid({reason: "x", signer: S.V2})).toThrow(/ROLE_NOT_ALLOWED/);
    expect(w.bA.resetInvalid({reason: "record removed", signer: S.V41}).core).toMatchObject({phase: "V41_AUTHORITATIVE", epoch: 2});
    expect(w.bA.v41MayDispatch()).toBe(true);
  });
  it("(b) writing back the older signed V2 record after a Founder rollback is refused (no replayed authority)", {timeout: T}, () => {
    const w = world(); toV2(w);
    const regX = w.reg(w.X), v2rec = regX.read(key).doc;
    w.bX.rollback({reason: "founder", signer: S.FOUNDER});
    const now = regX.read(key);
    expect(regX.cas(key, now.sha, v2rec).ok).toBe(true);
    expect(() => w.bB.assertV2(SESS.V2, 1)).toThrow(/AUTHORITY_REGRESSION/);
    expect(w.bA.v41MayDispatch()).toBe(false);
    expect(guardOf(w)(null).reason).toMatch(/AUTHORITY_REGRESSION/);
  });
  it("(c) truncating the chain to an earlier signed prefix is refused", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    const regX = w.reg(w.X), prepared = regX.read(key).doc;
    w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41});
    w.bB.commit({manifest: w.m, signer: S.V2});
    const now = regX.read(key);
    expect(regX.cas(key, now.sha, prepared).ok).toBe(true);
    expect(() => w.bA.read()).toThrow(/AUTHORITY_REGRESSION/);
  });
  it("canonical anchor and the reader's high-water mark make an absent record unverifiable, not genesis", {timeout: T}, () => {
    const w = world();
    expect(guardOf(w, {anchored: () => true})(null).reason).toMatch(/AUTHORITY_RECORD_REMOVED/);
    let mark = {epoch: 3};
    expect(guardOf(w, {hwm: {get: () => mark, set: v => { mark = v; }}})(null).reason).toMatch(/AUTHORITY_RECORD_REMOVED/);
    expect(guardOf(w)(null)).toMatchObject({allowed: true, by: "V4.1"}); // nothing ever recorded, nothing anchored: status quo
    const b = bridgeFor(w.reg(w.B), D, {anchored: () => true});
    expect(() => b.read()).toThrow(/AUTHORITY_RECORD_REMOVED/);
  });
});

describe("mutation survivors of review b31a0338 (N1)", () => {
  it("prev binding: a valid envelope signed for another prior state is STALE_OR_REPLAYED", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    const cur = w.bA.read();
    const next = w.bA.drainCore(cur, {manifestDigest: w.m.digest, drain});
    const wrongPrev = signAction({...S.V41, domain: D, action: "DRAIN_ACK", prev: canonDigest({...cur.core, epoch: 99}), payload: next});
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, envelope: wrongPrev})).toThrow(/STALE_OR_REPLAYED/);
  });
  it("drain signer must be THE outgoing owner: another registered V41_OWNER key is refused", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    expect(() => w.bX.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41b})).toThrow(/DRAIN_ACK_SIGNER_INVALID/);
  });
  it("commit signer must be THE candidate: another registered V2_CANDIDATE key is refused", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41});
    expect(() => w.bX.commit({manifest: w.m, signer: S.V2b})).toThrow(/COMMIT_CANDIDATE_MISMATCH/);
    expect(() => w.bX.prepare({manifest: w.m, gates: GATES, signer: S.V2b})).toThrow(/PHASE_INVALID|PREPARE_SIGNER_NOT_CANDIDATE/);
  });
});

describe("review of af184254: history rewrite, history window, lease traffic, protection", () => {
  const key = authorityRef(D);
  it("server-side protection (no force-push, no delete): our own writes still work; an attacker's force-push and deletion are rejected", {timeout: T}, () => {
    const w = world();
    const origin = path.join(w.root, "origin.git");
    git(origin, "config", "receive.denyNonFastForwards", "true"); git(origin, "config", "receive.denyDeletes", "true");
    toV2(w); // prepare/drain/commit are plain fast-forward pushes
    w.bX.rollback({reason: "founder", signer: S.FOUNDER});
    const tip = git(origin, "rev-parse", "refs/heads/uasco/registry");
    const pre = git(origin, "rev-parse", "refs/heads/uasco/registry~1"); // the V2 state before the rollback
    const force = spawnSync("git", ["push", "--force", "origin", `${pre}:refs/heads/uasco/registry`], {cwd: w.X, encoding: "utf8"});
    expect(force.status).not.toBe(0);
    const del = spawnSync("git", ["push", "origin", ":refs/heads/uasco/registry"], {cwd: w.X, encoding: "utf8"});
    expect(del.status).not.toBe(0);
    expect(git(origin, "rev-parse", "refs/heads/uasco/registry")).toBe(tip);
    expect(w.bA.v41MayDispatch()).toBe(true);
  });
  it("without verified protection: no prepare/commit, and the guard refuses once any authority exists", {timeout: T}, () => {
    const w = world();
    const unprot = bridgeFor(w.reg(w.B), D, {storeProtected: () => false});
    expect(() => unprot.prepare({manifest: w.m, gates: GATES, signer: S.V2})).toThrow(/REGISTRY_NOT_PROTECTED/);
    toV2(w);
    expect(mergeAuthority({readAuthority: () => w.reg(w.A).read(key).doc, readHistory: () => w.reg(w.A).history(key), keyring: () => ringFor(D), pr: 7, headSha: "a".repeat(40)}))
      .toMatchObject({allowed: false, reason: "REGISTRY_NOT_PROTECTED"});
  });
  it("authority history only lists authority changes: lease traffic does not grow it (no window overflow, no permanent lock-up)", {timeout: T}, () => {
    const w = world(); toV2(w);
    const reg = w.reg(w.A), leases = reg.leaseStore("live");
    for (let i = 0; i < 25; i++) new Ownership(leases, {leaseId: `l${i}`, environment: "e", workerId: "w", sessionId: "session_leasetraffic"}).acquire();
    expect(reg.history(key).length).toBe(3); // prepare, drain, commit
    expect(() => createRemoteDocStore({runGit: gitRunner(w.A)}).historyOf("refs/heads/uasco/registry", "authority/uasco-v7.json", 2)).toThrow(/REFDOC_HISTORY_TOO_LONG/);
    expect(w.bB.assertV2(SESS.V2, 1)).toBe(1);
  });
  it("M1: a different valid chain of the same epoch and length (not an extension of the stored one) is refused", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2});
    const regX = w.reg(w.X), stored = regX.read(key);
    // an alternative, validly signed PREPARE for another manifest version, created against a scratch store, then written over the stored one
    const alt = bridgeFor(createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(world().A)}), ref: "refs/heads/uasco/registry"}), D);
    const m2 = buildManifest({...w.m, version: 7, snapshot: w.m.snapshot});
    const altDoc = alt.prepare({manifest: m2, gates: GATES, signer: S.V2}).doc;
    expect(regX.cas(key, stored.sha, altDoc).ok).toBe(true);
    expect(() => w.bA.read()).toThrow(/AUTHORITY_REGRESSION/);
  });
  it("M7: only the first link from genesis may jump epochs; a rollback elsewhere must be exactly epoch+1", () => {
    const prev = {domain: D, authority: "V4.1", phase: "V41_AUTHORITATIVE", epoch: 2, holder: null, candidate: null, outgoing: null, manifest: null, gatesDigest: null, drainDigest: null};
    expect(() => checkTransition(prev, {...prev, epoch: 9}, {sessionId: SESS.V41})).toThrow(/ROLLBACK_FIELDS_INVALID/);
    expect(checkTransition(prev, {...prev, epoch: 3}, {sessionId: SESS.V41})).toBe("ROLLBACK");
    expect(checkTransition({...prev, epoch: 0}, {...prev, epoch: 9}, {sessionId: SESS.V41})).toBe("ROLLBACK");
  });
});

describe("review of aec2ff87 (follow-ups)", () => {
  const key = authorityRef(D), RB = "refs/heads/uasco/registry";
  it("commit() refuses when storeProtected() is false (prepare and drain done under protection)", {timeout: T}, () => {
    const w = world();
    w.bB.prepare({manifest: w.m, gates: GATES, signer: S.V2}); w.bA.drainAck({manifestDigest: w.m.digest, drain, signer: S.V41});
    const before = w.reg(w.A).read(key).doc;
    expect(() => bridgeFor(w.reg(w.B), D, {storeProtected: () => false}).commit({manifest: w.m, signer: S.V2})).toThrow(/REGISTRY_NOT_PROTECTED/);
    expect(() => bridgeFor(w.reg(w.B), D, {storeProtected: () => { throw new Error("rules api down"); }}).commit({manifest: w.m, signer: S.V2})).toThrow(/REGISTRY_NOT_PROTECTED/);
    expect(w.reg(w.A).read(key).doc).toEqual(before); // nothing written
    expect(w.bB.commit({manifest: w.m, signer: S.V2}).doc.chain.at(-1).core.phase).toBe("V2_AUTHORITATIVE");
  });
  it("an unparseable historical authority sidecar (pushed without any key) carries no authority: bridge and guard still verify the real chain", {timeout: T}, () => {
    const w = world(); toV2(w);
    // attacker: a plain fast-forward commit that keeps doc.json but replaces the authority sidecar with junk
    const X = w.X;
    git(X, "fetch", "-q", "origin", `+${RB}:${RB}`);
    const tip = git(X, "rev-parse", RB), sub = git(X, "rev-parse", `${tip}:authority`);
    const junk = spawnSync("git", ["hash-object", "-w", "--stdin"], {cwd: X, input: "{not json", encoding: "utf8"}).stdout.trim();
    const ls = git(X, "ls-tree", sub).split("\n").map(l => l.endsWith("\tuasco-v7.json") ? `100644 blob ${junk}\tuasco-v7.json` : l);
    const subJunk = spawnSync("git", ["mktree"], {cwd: X, input: ls.join("\n") + "\n", encoding: "utf8"}).stdout.trim();
    const top = git(X, "ls-tree", tip).split("\n").map(l => l.endsWith("\tauthority") ? `040000 tree ${subJunk}\tauthority` : l);
    const treeJunk = spawnSync("git", ["mktree"], {cwd: X, input: top.join("\n") + "\n", encoding: "utf8"}).stdout.trim();
    const c = git(X, "-c", "user.name=x", "-c", "user.email=x@invalid", "commit-tree", treeJunk, "-p", tip, "-m", "junk");
    git(X, "push", "-q", "origin", `${c}:${RB}`);
    const origin = path.join(w.root, "origin.git");
    git(origin, "config", "receive.denyNonFastForwards", "true"); git(origin, "config", "receive.denyDeletes", "true"); // the junk now stays in history
    // the latest sidecar entry is junk -> null; the current record (doc.json) is untouched and verifies against the real chain
    expect(w.reg(w.A).history(key).at(-1)).toBeNull();
    expect(w.bA.read().core.phase).toBe("V2_AUTHORITATIVE");
    expect(w.bB.assertV2(SESS.V2, 1)).toBe(1);
    // a signed transition still lands; afterwards the junk is a historical entry and every reader keeps working
    w.bX.rollback({reason: "founder", signer: S.FOUNDER});
    expect(w.reg(w.A).history(key).some(h => h === null)).toBe(true);
    expect(w.bA.read().core.phase).toBe("V41_AUTHORITATIVE");
    // the canonical merge guard's live readers (git history of the sidecar) tolerate the junk entry too
    const live = liveAuthorityReaders({repoRoot: w.A, baseRef: "integ", api: () => [{type: "non_fast_forward"}, {type: "deletion"}]});
    const hist = live.readHistory();
    expect(hist.some(h => h === null)).toBe(true);
    expect(live.registryProtected()).toBe(true);
    const guard = mergeAuthority({readAuthority: live.readAuthority, readHistory: live.readHistory, registryProtected: live.registryProtected, keyring: () => ringFor(D), pr: 7, headSha: "a".repeat(40)});
    expect(guard).toMatchObject({allowed: true, by: "V4.1"});
    // the current record itself stays strict: an unparseable doc.json fails closed
    git(X, "fetch", "-q", "origin", `+${RB}:${RB}`);
    const t2 = git(X, "rev-parse", RB);
    const docJunk = spawnSync("git", ["hash-object", "-w", "--stdin"], {cwd: X, input: "{not json", encoding: "utf8"}).stdout.trim();
    const top2 = git(X, "ls-tree", t2).split("\n").map(l => l.endsWith("\tdoc.json") ? `100644 blob ${docJunk}\tdoc.json` : l);
    const tree2 = spawnSync("git", ["mktree"], {cwd: X, input: top2.join("\n") + "\n", encoding: "utf8"}).stdout.trim();
    git(X, "push", "-q", "origin", `${git(X, "-c", "user.name=x", "-c", "user.email=x@invalid", "commit-tree", tree2, "-p", t2, "-m", "junk doc")}:${RB}`);
    expect(() => w.bA.read()).toThrow(/UNPARSEABLE/);
    expect(mergeAuthority({readAuthority: live.readAuthority, readHistory: live.readHistory, registryProtected: live.registryProtected, keyring: () => ringFor(D), pr: 7, headSha: "a".repeat(40)}).allowed).toBe(false);
  });
});
