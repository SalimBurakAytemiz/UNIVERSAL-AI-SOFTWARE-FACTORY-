// //TR: Factory V2 iki-oturumlu güvenlik probu (yalnız "probe-" alanı, PROBE anahtar listesi; canlı uasco-v7 otoritesine ve canlı kayıt dalına dokunmaz): A = V4.1 sahibi rolü, B = V2 adayı + saldırgan. İki ayrı Claude Cloud oturumu yalnız izinli kayıt dalı üzerinden koordine olur ve şu saldırıları gerçek ortamda dener: doğrudan sahte otorite yazısı, metin/gerçek-ama-merge-edilmemiş kabul kanıtı, drainAck kimlik taklidi, relay'de değiştirme, yetkisiz rollback, çift Writer, eski lease ile yazma; ayrıca imzalı relay, devir ve merge guard'ı doğrular. Her adım JSON kanıt satırı üretir.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRemoteDocStore, gitRunner} from "./ref-doc-store.mjs";
import {createSharedRegistry} from "./shared-registry.mjs";
import {Ownership} from "./ownership.mjs";
import {AuthorityBridge, snapshotV41, buildManifest, authorityRef} from "./bridge.mjs";
import {generateRoleKey, parseKeyring, signAction, canonDigest} from "./identity.mjs";
import {verifyGates} from "./gate-verifier.mjs";
import {mergeAuthority} from "./v41-guard.mjs";
import {liveFreshness, liveGateDeps, liveGit, githubApi, BASE} from "./live-sources.mjs";

export const PROBE_DOMAIN = "probe-uasco";
export const PROBE_KEYRING_PATH = "docs/factory-v2/probe/PROBE-ROLE-KEYS.json";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** PROBE keyring: read from an exact commit of the PR branch; refused for any non-probe domain (it can never authorize the live domain). */
export function loadProbeKeyring({repoRoot, commitSha, domain}) {
  if (!String(domain).startsWith("probe-")) throw new Error("PROBE_KEYRING_LIVE_DOMAIN_REFUSED");
  const r = spawnSync("git", ["show", `${commitSha}:${PROBE_KEYRING_PATH}`], {cwd: repoRoot, encoding: "utf8"});
  if (r.status !== 0) throw new Error("PROBE_KEYRING_ABSENT");
  const ring = parseKeyring(JSON.parse(r.stdout), {kind: "PROBE", commitSha});
  if (ring.mode !== "PROBE" || ring.domain !== domain) throw new Error("PROBE_KEYRING_MODE");
  return ring;
}

export async function runProbe({role, session, repoRoot, branch, keyDir, prBranch, log, deps = {}}) {
  const k = deps.timeScale ?? 1, poll = deps.pollMs ?? 4_000; // tests shrink time; live runs use real seconds
  const reg = createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(repoRoot)}), ref: `refs/heads/${branch}`});
  const until = async (key, ms = 1_200_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const d = reg.read(key).doc; if (d) return d; await sleep(poll); } throw new Error(`TIMEOUT_WAITING:${key}`); };
  const mark = (key, v = {}) => reg.cas(key, null, {session, at: Date.now(), ...v});
  const attempt = (step, fn) => { try { const r = fn(); log(step, {outcome: "ACCEPTED", detail: r}); return r; } catch (e) { log(step, {outcome: "REFUSED", error: String(e?.message ?? e)}); return null; } };
  // --- keys: generated in this container; only the public key leaves it
  fs.mkdirSync(keyDir, {recursive: true});
  const myRole = role === "A" ? "V41_OWNER" : "V2_CANDIDATE";
  const me = {...generateRoleKey(), role: myRole, sessionId: session};
  fs.writeFileSync(path.join(keyDir, `${role}.json`), JSON.stringify(me), {mode: 0o600});
  const attacker = role === "B" ? {...generateRoleKey(), role: "V41_OWNER", sessionId: "session_attackerkeyB"} : null; // never registered anywhere
  mark(`probe-keys/${session}`, {role: myRole, keyId: me.keyId, publicKeyPem: me.publicKeyPem});
  log("KEY_PUBLISHED", {role: myRole, keyId: me.keyId});
  // --- wait for the PROBE keyring to be committed on the PR branch, containing our key
  let ringSha = deps.keyringSha ? await deps.keyringSha(me) : null;
  for (const t0 = Date.now(); !ringSha && Date.now() - t0 < 1_800_000; await sleep(15_000)) {
    if (spawnSync("git", ["fetch", "-q", "origin", prBranch], {cwd: repoRoot}).status !== 0) continue;
    const sha = spawnSync("git", ["rev-parse", "FETCH_HEAD"], {cwd: repoRoot, encoding: "utf8"}).stdout.trim();
    try { const ring = loadProbeKeyring({repoRoot, commitSha: sha, domain: PROBE_DOMAIN}); if (ring.keys.has(me.keyId)) { ringSha = sha; break; } } catch {}
  }
  if (!ringSha) throw new Error("PROBE_KEYRING_NOT_PUBLISHED");
  log("KEYRING_PINNED", {commitSha: ringSha});
  const keyring = () => loadProbeKeyring({repoRoot, commitSha: ringSha, domain: PROBE_DOMAIN});
  const live = deps.live ?? liveFreshness({repoRoot});
  const realVerifier = (gates, ctx) => verifyGates(gates, ctx, deps.gateDeps ? deps.gateDeps() : liveGateDeps({repoRoot}));
  const gh = deps.gh ?? githubApi(), lgit = deps.git ?? liveGit({repoRoot});
  // PROBE waiver: only for a probe- domain and only when explicitly marked; the live domain never has it.
  const probeVerifier = (gates, ctx) => (gates?.probeWaiver === "PROBE-ONLY-NOT-ACCEPTANCE" && ctx.domain.startsWith("probe-")) ? {verified: {probeWaiver: true}} : realVerifier(gates, ctx);
  const bridge = new AuthorityBridge({docStore: reg, domain: PROBE_DOMAIN, keyring, gateVerifier: probeVerifier, live});
  const A_SESSION = () => reg.read("probe/A-ready").doc?.session;
  if (role === "A") {
    mark("probe/A-ready");
    await until("probe/B-forged");
    log("A_V41_MAY_DISPATCH_AFTER_FORGERY", {value: bridge.v41MayDispatch()});
    attempt("A_READ_FORGED_RECORD", () => bridge.read().core);
    attempt("A_RESET_INVALID_WITH_V41_KEY", () => bridge.resetInvalid({reason: "forged by registry writer", signer: me}).core);
    mark("probe/A-reset");
    const prep = await until("probe/B-prepared");
    const cur = bridge.read();
    const drain = {acks: Object.fromEntries((prep.unresolved ?? []).map(t => [t, "FENCED"])), builderSessionsStopped: ["session_probeNoBuilders"], note: "probe"};
    const env = signAction({...me, domain: PROBE_DOMAIN, action: "DRAIN_ACK", prev: canonDigest(cur.core), payload: bridge.drainCore(cur, {manifestDigest: cur.core.manifest.digest, drain})});
    mark("relay/drain", {envelope: env, drain, manifestDigest: cur.core.manifest.digest});
    log("A_DRAIN_SIGNED_OFFLINE_FOR_RELAY", {prev: env.prev, keyId: env.keyId});
    const done = await until("probe/B-commit");
    log("A_SAW_B_COMMIT", done);
    const guard = v2Intent => mergeAuthority({readAuthority: () => reg.read(authorityRef(PROBE_DOMAIN)).doc, keyring, domain: PROBE_DOMAIN, pr: 347, headSha: "0".repeat(39) + "1", v2Intent});
    log("A_GUARD_V41_MERGE_AFTER_HANDOVER", guard(null));
    const c = bridge.read().core;
    log("A_GUARD_V41_SIGNED_MERGE_INTENT", guard(signAction({...me, domain: PROBE_DOMAIN, action: "MERGE", prev: canonDigest(c), payload: {pr: 347, headSha: "0".repeat(39) + "1", epoch: c.epoch}})));
    mark("probe/A-guard-checked");
  } else {
    await until("probe/A-ready");
    // forged authority record written directly to the shared document (bypassing the bridge)
    const core = {domain: PROBE_DOMAIN, authority: "V2", phase: "V2_AUTHORITATIVE", epoch: 7, holder: session, candidate: session, outgoing: A_SESSION(), manifest: null, gatesDigest: null, drainDigest: null};
    const forged = {schema: "uasco.factory-v2.authority/1", ...core, chain: [{core, envelope: signAction({...attacker, role: "V2_CANDIDATE", sessionId: session, domain: PROBE_DOMAIN, action: "COMMIT", prev: "forged", payload: core})}]};
    const cur0 = reg.read(authorityRef(PROBE_DOMAIN));
    log("B_DIRECT_FORGED_WRITE", {written: reg.cas(authorityRef(PROBE_DOMAIN), cur0.sha, forged).ok});
    attempt("B_ASSERT_V2_ON_FORGED_RECORD", () => bridge.assertV2(session, null));
    attempt("B_RESET_INVALID_WITH_CANDIDATE_KEY", () => bridge.resetInvalid({reason: "x", signer: me})); // record is invalid now: only V41/FOUNDER may reset
    mark("probe/B-forged");
    await until("probe/A-reset");
    // manifest from LIVE canonical data
    const g = lgit, base = g.canonicalSha();
    const snapshot = snapshotV41({baseRef: BASE, baseSha: base, autonomyState: JSON.parse(g.show(base, "docs/planning/autonomy/STATE.json")),
      taskIndex: JSON.parse(g.show(base, "docs/planning/autonomy/task-index.json")), openPrs: live.openPrs()});
    const manifest = buildManifest({domain: PROBE_DOMAIN, version: 1, snapshot, fromSession: A_SESSION(), toSession: session});
    attempt("B_PREPARE_TEXT_EVIDENCE", () => bridge.prepare({manifest, gates: {reviewClean: {evidence: "CLEAN"}, ciPassed: {evidence: "PASS"}, founderAuthorization: {evidence: "yes"}, migrationAcceptance: {evidence: "ok"}}, signer: me}));
    const pr = gh("pulls/347");
    attempt("B_PREPARE_REAL_BUT_UNMERGED_PR_347", () => bridge.prepare({manifest, signer: me, gates: {reviewClean: {pr: 347, headSha: pr.head.sha}, ciPassed: {headSha: pr.head.sha},
      founderAuthorization: {path: "docs/planning/authority/FD-2026-11-03-STANDING-AUTONOMY.md"}, migrationAcceptance: {mergeSha: pr.merge_commit_sha ?? "0".repeat(40)}}}));
    attempt("B_PREPARE_PROBE_WAIVER", () => bridge.prepare({manifest, gates: {probeWaiver: "PROBE-ONLY-NOT-ACCEPTANCE"}, signer: me}).core.phase);
    const unresolved = [...new Set(snapshot.inFlight.map(f => f.task))];
    mark("probe/B-prepared", {unresolved});
    const drainFake = {acks: {}, builderSessionsStopped: []};
    const md = manifest.digest;
    attempt("B_DRAIN_ACK_ACTOR_STRING_AS_V41", () => bridge.drainAck({manifestDigest: md, drain: drainFake, actor: A_SESSION()}));
    attempt("B_DRAIN_ACK_UNREGISTERED_KEY_CLAIMING_V41", () => bridge.drainAck({manifestDigest: md, drain: drainFake, signer: {...attacker, sessionId: A_SESSION()}}));
    attempt("B_DRAIN_ACK_WITH_CANDIDATE_KEY", () => bridge.drainAck({manifestDigest: md, drain: drainFake, signer: me}));
    const relay = await until("relay/drain");
    attempt("B_RELAY_ALTERED_DRAIN", () => bridge.drainAck({manifestDigest: md, drain: {...relay.drain, acks: {...relay.drain.acks, "FORGED-T0001": "COMPLETED"}}, envelope: relay.envelope}));
    attempt("B_RELAY_UNCHANGED_DRAIN", () => bridge.drainAck({manifestDigest: md, drain: relay.drain, envelope: relay.envelope}).signer);
    const committed = attempt("B_COMMIT_WITH_LIVE_FRESHNESS", () => bridge.commit({manifest, signer: me}).core);
    mark("probe/B-commit", {phase: committed?.phase ?? null});
    if (committed) {
      const c = bridge.read().core;
      log("B_GUARD_SIGNED_HOLDER_MERGE_INTENT", mergeAuthority({readAuthority: () => reg.read(authorityRef(PROBE_DOMAIN)).doc, keyring, domain: PROBE_DOMAIN, pr: 347, headSha: "0".repeat(39) + "1",
        v2Intent: signAction({...me, domain: PROBE_DOMAIN, action: "MERGE", prev: canonDigest(c), payload: {pr: 347, headSha: "0".repeat(39) + "1", epoch: c.epoch}})}));
    }
    await until("probe/A-guard-checked");
    attempt("B_ROLLBACK_WITH_CANDIDATE_KEY", () => bridge.rollback({reason: "unauthorized", signer: me}));
    attempt("B_ROLLBACK_WITH_UNREGISTERED_KEY", () => bridge.rollback({reason: "unauthorized", signer: attacker}));
    mark("probe/go-lease", {at: Date.now() + 20_000 * k});
  }
  // --- double writer + stale lease (both sessions, same instant)
  const go = (await until("probe/go-lease")).at;
  await sleep(Math.max(0, go - Date.now()));
  const writer = new Ownership(reg.leaseStore("probe"), {leaseId: "writer--LIVE-probe-uasco", environment: `cloud:${role}`, workerId: "merge-writer", sessionId: session, ttlMs: 30_000 * k, safetyMarginMs: 2_000 * k});
  const g1 = writer.acquire();
  log("WRITER_LEASE_RACE", {granted: g1.granted, epoch: writer.epoch, holder: g1.holder?.sessionId ?? session});
  if (g1.granted) {
    await sleep(50_000 * k); // let it expire; the other session takes over
    let fenced = false; try { writer.fence(); } catch (e) { fenced = e.code === "OWNERSHIP_LOST"; }
    log("STALE_WRITER_FENCED_AFTER_TAKEOVER", {fenced, renewAfterLoss: writer.renew()});
  } else {
    await sleep(38_000 * k);
    const g2 = writer.acquire();
    log("WRITER_TAKEOVER_AFTER_EXPIRY", {granted: g2.granted, epoch: writer.epoch});
    await sleep(20_000 * k); writer.release();
  }
  if (role === "A") {
    attempt("A_ROLLBACK_WITH_V41_KEY", () => bridge.rollback({reason: "probe complete", signer: me}).core);
    log("A_V41_MAY_DISPATCH_AFTER_ROLLBACK", {value: bridge.v41MayDispatch()});
    mark("probe/A-done");
  } else await until("probe/A-done");
}
