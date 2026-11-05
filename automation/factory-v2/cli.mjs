// //TR: Factory V2 komut satırı: `plan` kanonik backlog'u (task-index.json) canlı V4.1 sahipliğini (STATE.json inFlight + açık PR UASCO-TASK satırları) dışlayarak 8 Builder'a salt-okunur planlar (claim yazmaz); `evidence` geçici izole depoda gerçek alt süreçlerle SHADOW teslim hattını koşar ve PID/zaman damgası/örtüşme kanıtı yazar; `intents` bulut oturum köprüsünün bekleyen/bağlı kayıtlarını yönetir.
// Usage:
//   node automation/factory-v2/cli.mjs plan [--builders 8] [--open-prs prs.json]
//   node automation/factory-v2/cli.mjs evidence [--out file.json] [--builders 8] [--hold-ms 1500]
//   node automation/factory-v2/cli.mjs intents list|bind <intentId> <sessionId>|complete <intentId> <result.json> --dir <dir>
//   node automation/factory-v2/cli.mjs bridge snapshot [--out manifest.json] [--version n]   (read-only: origin + GitHub API)
//   node automation/factory-v2/cli.mjs bridge status                                         (read-only: shared authority record)
//   node automation/factory-v2/cli.mjs bridge probe-store                                    (capability check: CAS create+delete of one probe ref)
//   node automation/factory-v2/cli.mjs bridge prepare --manifest f --gates f | ack --manifest f --drain f | commit --manifest f | rollback --reason r
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {buildTopology, INITIAL_TARGET} from "./topology.mjs";
import {readyTasks, assign, liveOwnedTasks} from "./scheduler.mjs";
import {FactorySupervisor, maxOverlap} from "./supervisor.mjs";
import {LocalProcessExecutor, CloudSessionIntentExecutor} from "./executors.mjs";
import {createLocalGitIntegration} from "./merge-git.mjs";
import {createGitStore} from "./ownership.mjs";
import {createRemoteDocStore, gitRunner} from "./ref-doc-store.mjs";
import {AuthorityBridge, snapshotV41, buildManifest, reconcile} from "./bridge.mjs";
import {createSharedRegistry} from "./shared-registry.mjs";
import {Ownership} from "./ownership.mjs";
import {runProbe, PROBE_DOMAIN} from "./probe-scenario.mjs";
import {KEYRING_SCHEMA, generateRoleKey, signAction, canonDigest, loadCanonicalKeyring} from "./identity.mjs";
import {verifyGates, reviewBinding} from "./gate-verifier.mjs";
import {liveAuthorityReaders} from "./v41-guard.mjs";
import {liveGit, liveGateDeps, liveFreshness, githubClient, prefetchGateEvidence, openPrsLive, closedPrsLive, branchProtected, ghGet} from "./live-sources.mjs";
import {execFileSync} from "node:child_process";

// Node's built-in fetch (used by the GitHub adapter) honours HTTPS_PROXY only with NODE_USE_ENV_PROXY=1: re-run once with it set.
if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = (await import("node:child_process")).spawnSync(process.execPath, process.argv.slice(1), {stdio: "inherit", env: {...process.env, NODE_USE_ENV_PROXY: "1"}});
  process.exit(r.status ?? 1);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));

function plan() {
  const builders = Number(arg("builders", INITIAL_TARGET.builders));
  const index = readJson(path.join(ROOT, "docs/planning/autonomy/task-index.json"));
  const state = readJson(path.join(ROOT, "docs/planning/autonomy/STATE.json"));
  const openPrs = arg("open-prs") ? readJson(arg("open-prs")) : [];
  const done = new Set((state.done ?? []).map(d => d.task));
  const live = liveOwnedTasks({autonomyState: state, openPrs});
  const ready = readyTasks(index.tasks, {done, excluded: live, allowedTiers: ["T0", "T1", "T2"]});
  const slots = buildTopology({...INITIAL_TARGET, builders}).slots.filter(s => s.role === "BUILDER");
  const a = assign(ready, slots);
  const out = {mode: "PLAN_ONLY_NO_CLAIMS", builders, backlog: index.tasks.length, liveOwnedExcluded: [...live].sort(), readyIndependent: ready.length, assignments: a.map(x => ({...x, name: index.tasks.find(t => t.id === x.taskId)?.name}))};
  console.log(JSON.stringify(out, null, 2));
}

async function evidence() {
  const builders = Number(arg("builders", 8));
  process.env.FACTORY_HOLD_MS = arg("hold-ms", "1500");
  delete process.env.FACTORY_FAIL;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-evidence-"));
  const repo = path.join(root, "repo"); fs.mkdirSync(repo);
  const g = (...a) => { const r = spawnSync("git", a, {cwd: repo, encoding: "utf8"}); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  g("init", "-q", "-b", "integ"); fs.writeFileSync(path.join(repo, "README.txt"), "base\n"); g("add", "."); g("-c", "user.name=e", "-c", "user.email=e@invalid", "commit", "-q", "-m", "base");
  const base = g("rev-parse", "HEAD");
  const ev = [];
  const executor = new LocalProcessExecutor({repoDir: repo, worktreeRoot: path.join(root, "wt"), baseSha: base, command: () => [process.execPath, [path.join(HERE, "demo-worker.mjs")]], evidence: ev});
  const integ = createLocalGitIntegration({repoDir: repo, branch: "integ", scratchDir: path.join(root, "integration")});
  const backlog = Array.from({length: builders}, (_, i) => ({id: `EV-T${String(i + 1).padStart(4, "0")}`, tier: "T1", status: "PROPOSED", deps: [], paths: [`work/EV-T${String(i + 1).padStart(4, "0")}.txt`]}));
  const sup = new FactorySupervisor({repoDir: repo, domain: "evidence", mode: "SHADOW", sessionId: `session_evidence${process.pid}`, journalDir: path.join(root, "journal"), leaseStore: createGitStore(repo, "SHADOW"),
    executor, backlog: () => backlog, target: {...INITIAL_TARGET, builders: Math.max(builders, 1)},
    mergeFacts: t => ({candidate: {taskId: t.taskId, headSha: t.data.headSha, baseSha: t.data.baseSha, changedPaths: t.data.changedPaths, allowedPaths: ["work/"], builderIdentity: t.data.builderIdentity, priorBlockers: [], required: t.data.required},
      canonicalSha: integ.readCanonical(), conflicts: false, baseDeltaOverlaps: false, verdicts: t.data.verdicts, ci: {sha: t.data.headSha, requiredContexts: {"local-check": "success"}}, protectedPaths: readJson(path.join(ROOT, "config/protected-paths.json"))}),
    git: integ, postMergeVerify: async t => spawnSync("git", ["cat-file", "-e", `integ:${t.data.changedPaths[0]}`], {cwd: repo}).status === 0});
  const started = sup.start();
  const t0 = Date.now();
  while (sup.journal.inState("VERIFIED").length < builders && Date.now() - t0 < 120_000) { await sup.tick(); await new Promise(r => setTimeout(r, 100)); }
  const role = r => sup.spans.filter(s => s.role === r);
  const out = {
    "//TR": "Factory V2 SHADOW kanıtı: geçici izole depoda gerçek alt süreçler (model çağrısı yok); canlı fabrika aktivasyonu DEĞİLDİR.",
    kind: "SHADOW_LOCAL_PROCESS_EVIDENCE", isLiveActivation: false, startedAt: new Date(t0).toISOString(), supervisor: {sessionId: sup.o.sessionId, epoch: started.epoch},
    measured: {maxConcurrentBuilders: maxOverlap(role("BUILDER")), maxConcurrentReviewers: maxOverlap(role("REVIEWER")), preparerWorkersUsed: new Set(role("MERGE_PREPARER").map(s => s.slotId)).size, // local preparation is synchronous here; overlap is proven by test A3
      distinctReviewerSlots: new Set(role("REVIEWER").map(s => s.slotId)).size,
      distinctBuilderPids: new Set(ev.filter(e => e.role === "BUILDER").map(e => e.pid)).size, verified: sup.journal.inState("VERIFIED").length, mergeCommits: g("log", "--merges", "--format=%H", "integ").split("\n").filter(Boolean).length},
    processes: ev.map(e => ({role: e.role, slotId: e.slotId, taskId: e.taskId, pid: e.pid, startedAt: new Date(e.startedAt).toISOString(), endedAt: new Date(e.endedAt).toISOString(), exit: e.code})),
    report: sup.report()
  };
  sup.stop();
  const file = arg("out");
  if (file) fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out.measured));
  fs.rmSync(root, {recursive: true, force: true});
  if (out.measured.verified !== builders) process.exit(2);
}

function intents() {
  const ex = new CloudSessionIntentExecutor({dir: arg("dir"), promptFor: () => ""});
  const [, , , sub, a, b] = process.argv;
  if (sub === "list") console.log(JSON.stringify(ex.pending(), null, 2));
  else if (sub === "bind") { ex.bind(a, b); console.log("BOUND"); }
  else if (sub === "complete") { ex.complete(a, readJson(b)); console.log("COMPLETED"); }
  else { console.error("intents list|bind|complete"); process.exit(1); }
}

const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-", BASE = "v7/integration", DOMAIN = "uasco-v7";
// GitHub is read only through the code-backed adapter (scripts/ci/uasco-review/github.mjs via live-sources.mjs).
async function bridge() {
  const sub = process.argv[3];
  const raw = createRemoteDocStore({runGit: gitRunner(ROOT)});
  // --registry-branch uasco/<name>: the authorized shared registry (one allowed branch); otherwise refs/uasco/* (needs ref push rights).
  const rb = arg("registry-branch");
  const docs = rb ? createSharedRegistry({docStore: raw, ref: `refs/heads/${rb}`}) : raw;
  // Identity = canonical keyring at the live canonical SHA; gate evidence and freshness = live GitHub + canonical git (never the caller).
  const lg = liveGit({repoRoot: ROOT}), ghc = githubClient(), live = liveFreshness({repoRoot: ROOT, gh: ghc});
  let ghReader = null; // filled by prefetchGateEvidence right before prepare
  const lr = liveAuthorityReaders({repoRoot: ROOT, branch: rb ?? "uasco/registry", domain: DOMAIN}); // canonical anchor + persisted high-water mark
  const b = () => new AuthorityBridge({docStore: docs, domain: DOMAIN, keyring: () => loadCanonicalKeyring({repoDir: ROOT, commitSha: lg.canonicalSha()}),
    gateVerifier: (g, ctx) => verifyGates(g, ctx, liveGateDeps({repoRoot: ROOT, gh: ghReader})), live, anchored: () => lr.anchored(), hwm: lr.hwm,
    storeProtected: () => protectedNow === true});
  let protectedNow = false; // fetched through the adapter right before prepare/commit
  const actor = process.env.CLAUDE_SESSION_ID ?? arg("actor", "unknown"); // label for probe refs only; never an identity
  if (sub === "snapshot") {
    const g = a => execFileSync("git", a, {cwd: ROOT, maxBuffer: 64 << 20}).toString("utf8");
    g(["fetch", "-q", "origin", BASE]);
    const baseSha = g(["rev-parse", `origin/${BASE}`]).trim();
    const show = f => JSON.parse(g(["show", `${baseSha}:${f}`]));
    const open = await openPrsLive(ghc);
    const merged = (await closedPrsLive(ghc)).filter(p => p.merged_at && p.base?.ref === BASE);
    const snapshot = snapshotV41({baseRef: BASE, baseSha, autonomyState: show("docs/planning/autonomy/STATE.json"), taskIndex: show("docs/planning/autonomy/task-index.json"), openPrs: open, mergedPrs: merged});
    const cur = b().read().doc;
    const m = buildManifest({domain: DOMAIN, version: Number(arg("version", (cur.manifest?.version ?? 0) + 1)), snapshot, fromSession: arg("from", "V4.1"), toSession: arg("to", "UNASSIGNED")});
    const rec = reconcile(m, {acks: {}});
    if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(m, null, 2) + "\n");
    console.log(JSON.stringify({mode: "READ_ONLY_SYNC", authority: cur.authority, phase: cur.phase, baseSha, digest: m.digest, done: snapshot.done.length, mergedPrTasks: snapshot.mergedPrTasks.length,
      openPrs: snapshot.openPrs.map(p => `${p.pr}:${p.task ?? "-"}@${p.headSha.slice(0, 8)}${p.baseRef === BASE ? "" : ` (stacked on ${p.baseRef})`}`), inFlight: snapshot.inFlight.map(f => f.task), blocked: snapshot.blocked.map(f => f.task),
      reconcile: {planned: rec.plan.length, unresolvedWithoutDrainAck: rec.unresolved}}, null, 2));
  } else if (sub === "status") { try { console.log(JSON.stringify(b().read().core, null, 2)); } catch (e) { console.log(JSON.stringify({unverifiable: String(e?.message ?? e)})); process.exit(2); } }
  else if (sub === "probe-store") {
    const ref = `refs/uasco/factory-v2/probe/${String(actor).replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const c = docs.cas(ref, null, {probe: true, at: Date.now()});
    const race = c.ok ? docs.cas(ref, null, {probe: "second"}) : null;
    const del = c.ok ? docs.remove(ref, c.sha) : false;
    console.log(JSON.stringify({ref, created: c.ok, secondCreateRefused: race ? !race.ok : null, deleted: del}));
    process.exit(c.ok && race && !race.ok && del ? 0 : 2);
  } else if (sub === "check-review") {
    // Pre-merge readiness: is there a trusted, SHA-bound, independent CLEAN review binding for the PR's CURRENT head? (read-only)
    const n = Number(arg("pr")); const pr = await ghGet(ghc, `pulls/${n}`);
    const gh = await prefetchGateEvidence(ghc, {reviewClean: {pr: n, headSha: pr.head.sha}});
    try { console.log(JSON.stringify({pr: n, ready: true, ...reviewBinding(pr, n, pr.head.sha, liveGateDeps({repoRoot: ROOT, gh}))}, null, 2)); }
    catch (e) { console.log(JSON.stringify({pr: n, ready: false, headSha: pr.head.sha, baseSha: pr.base?.sha, reason: String(e?.message ?? e)}, null, 2)); process.exit(2); }
  } else if (sub === "keygen") {
    // the private key stays in this container; print only the public keyring entry for a Founder-approved keyring PR
    const k = {...generateRoleKey(), role: arg("role"), sessionId: arg("session")};
    fs.writeFileSync(arg("out"), JSON.stringify(k), {mode: 0o600});
    console.log(JSON.stringify({keyId: k.keyId, role: k.role, sessionId: k.sessionId, publicKeyPem: k.publicKeyPem}, null, 2));
  } else if (sub === "sign-drain") {
    // offline signing by the V4.1 owner for relay: bound to the current verified state, the manifest digest and the exact drain content
    const br = b(), cur = br.read(), drain = readJson(arg("drain"));
    const key = readJson(arg("key"));
    console.log(JSON.stringify(signAction({...key, domain: DOMAIN, action: "DRAIN_ACK", prev: canonDigest(cur.core), payload: br.drainCore(cur, {manifestDigest: cur.core.manifest?.digest, drain})}), null, 2));
  }
  else if (sub === "prepare") { ghReader = await prefetchGateEvidence(ghc, readJson(arg("gates"))); protectedNow = await branchProtected(ghc, rb ?? "uasco/registry"); console.log(JSON.stringify(b().prepare({manifest: readJson(arg("manifest")), gates: readJson(arg("gates")), signer: readJson(arg("key"))}).core, null, 2)); }
  else if (sub === "relay-drain") { const br = b(); console.log(JSON.stringify(br.drainAck({manifestDigest: br.read().core.manifest?.digest, drain: readJson(arg("drain")), envelope: readJson(arg("envelope"))}).signer, null, 2)); }
  else if (sub === "ack") console.log(JSON.stringify(b().drainAck({manifestDigest: readJson(arg("manifest")).digest, drain: readJson(arg("drain")), signer: readJson(arg("key"))}).core, null, 2));
  else if (sub === "commit") { await live.refresh(); protectedNow = await branchProtected(ghc, rb ?? "uasco/registry"); console.log(JSON.stringify(b().commit({manifest: readJson(arg("manifest")), signer: readJson(arg("key"))}), null, 2)); } // open PRs fetched just now through the adapter; base/STATE read from git by the bridge
  else if (sub === "rollback") console.log(JSON.stringify(b().rollback({reason: arg("reason", "manual"), signer: readJson(arg("key"))}).core, null, 2));
  else if (sub === "reset-invalid") console.log(JSON.stringify(b().resetInvalid({reason: arg("reason", "invalid record"), signer: readJson(arg("key"))}).core, null, 2));
  else { console.error("bridge snapshot|status|probe-store|keygen|prepare|sign-drain|relay-drain|ack|commit|rollback|reset-invalid"); process.exit(1); }
}

/**
 * Two-session verification of the shared registry on an allowed branch (each session started with outcome_branch=<branch>).
 * Role A and role B run in different Claude Cloud sessions and coordinate only through the registry itself.
 */
async function registry() {
  const sub = process.argv[3], role = arg("role"), branch = arg("branch", "uasco/registry-probe"), session = arg("session"), run = arg("run", "r1");
  if (sub !== "verify" || !["A", "B"].includes(role) || !/^session_[A-Za-z0-9]{8,}$/.test(session ?? "") || !/^[A-Za-z0-9-]{1,40}$/.test(run)) { console.error("registry verify --role A|B --session <session id> --run <id> [--branch uasco/x]"); process.exit(1); }
  if (!/^uasco\/[A-Za-z0-9._-]{1,80}$/.test(branch)) { console.error("branch must be uasco/<name>"); process.exit(1); }
  // Isolation: every key lives under probe/<run>/ and leases under namespace probe-<run>; no authority section is ever touched.
  const K = name => `probe/${run}/${name}`;
  const ref = `refs/heads/${branch}`;
  const docs = createRemoteDocStore({runGit: gitRunner(ROOT)});
  const reg = createSharedRegistry({docStore: docs, ref});
  const leases = reg.leaseStore(`probe-${run}`);
  const ev = []; const log = (step, data = {}) => { const e = {at: new Date().toISOString(), role, session, run, step, ...data}; ev.push(e); console.log(JSON.stringify(e)); if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(ev, null, 2) + "\n"); };
  const head = () => { const r = spawnSync("git", ["ls-remote", "origin", ref], {cwd: ROOT, encoding: "utf8"}); return r.stdout.split(/\s+/)[0] || null; };
  const until = async (pred, ms = 900_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await new Promise(r => setTimeout(r, 5_000)); } return null; };
  const push = args => { const r = spawnSync("git", ["push", ...args], {cwd: ROOT, encoding: "utf8"}); return {exit: r.status, stderr: (r.stderr ?? "").split("\n").filter(l => /rule|reject|protect|GH0|denied|declined|non-fast-forward|error/i.test(l)).slice(0, 4).join(" | ").slice(0, 400)}; };
  log("PROTECTION_AS_SEEN_BY_THIS_SESSION", {branch, protectedByActiveNoBypassRuleset: await branchProtected(githubClient(), branch)});
  const own = new Ownership(leases, {leaseId: "supervisor--probe", environment: `cloud:${role}`, workerId: "supervisor", sessionId: session, ttlMs: role === "A" ? 120_000 : 600_000});
  if (role === "A") {
    const g = own.acquire(); const original = own.record ? {...own.record} : null; const firstHead = head(); log("A_ACQUIRE_SUPERVISOR_LEASE", {granted: g.granted, epoch: own.epoch, registryHead: firstHead});
    const w = reg.cas(K("A-hello"), null, {session, token: own.token, firstHead, at: Date.now()}); log("A_FAST_FORWARD_WRITE", {ok: w.ok, registryHead: head()});
    // a genuinely outdated expectation (A's own earlier registry version) — refused by the server, not locally
    spawnSync("git", ["fetch", "-q", "origin", `+${ref}:${ref}`], {cwd: ROOT});
    const stale = firstHead ? docs.cas(ref, firstHead, {schema: "uasco.factory-v2.shared-registry/1", sections: {}}) : {ok: true};
    log("A_STALE_WRITE_REFUSED_BY_SERVER", {refused: !stale.ok, expectedOld: firstHead, registryHead: head()});
    const b = await until(() => reg.read(K("B-hello")).doc); log("A_SAW_B", {b});
    log("A_RELEASE", {released: own.release(), registryHead: head()});
    const ba = await until(() => reg.read(K("B-acquired")).doc); log("A_SAW_B_ACQUIRE", {ba});
    const stale2 = new Ownership(leases, {leaseId: "supervisor--probe", environment: "cloud:A", workerId: "supervisor", sessionId: session, ttlMs: 120_000}); stale2.record = original; // A's real former grant
    let fenced = false; try { stale2.fence(); } catch (e) { fenced = e.code === "OWNERSHIP_LOST"; }
    log("A_OLD_OWNER_FENCED", {fenced, renewAfterLoss: stale2.renew()});
    reg.cas(K("A-done"), null, {session, at: Date.now()});
  } else {
    const a = await until(() => reg.read(K("A-hello")).doc); log("B_SAW_A", {a, registryHead: head()});
    const g = own.acquire(); log("B_ACQUIRE_WHILE_A_HOLDS", {granted: g.granted, holderSession: g.holder?.sessionId ?? null});
    reg.cas(K("B-hello"), null, {session, sawHolder: g.holder?.sessionId ?? null, grantedWhileHeld: g.granted, at: Date.now()});
    const got = await until(() => own.acquire().granted || null); log("B_ACQUIRE_AFTER_RELEASE", {granted: !!got, epoch: own.epoch, registryHead: head()});
    reg.cas(K("B-acquired"), null, {session, epoch: own.epoch, at: Date.now()});
    // server-side protection, attacked from this session's own push identity (expected: all rejected, head unchanged)
    const before = head();
    spawnSync("git", ["fetch", "-q", "origin", `+${ref}:${ref}`], {cwd: ROOT});
    log("B_FORCE_PUSH_REWIND_ATTEMPT", {target: a.firstHead, ...push(["--force", "origin", `${a.firstHead}:${ref}`])});
    log("B_NON_FAST_FORWARD_PUSH_ATTEMPT", push(["origin", `${a.firstHead}:${ref}`]));
    log("B_BRANCH_DELETE_ATTEMPT", push(["origin", `:${ref}`]));
    log("B_HEAD_UNCHANGED_AFTER_ATTACKS", {before, after: head()});
    await until(() => reg.read(K("A-done")).doc, 300_000);
    log("B_RELEASE", {released: own.release(), registryHead: head()});
  }
}

/** Two-session security probe (probe- domain only). `probe-keyring` builds the PROBE keyring from keys the probe sessions published. */
async function probe() {
  const role = arg("role"), session = arg("session"), branch = arg("branch", "uasco/registry-probe2");
  if (!["A", "B"].includes(role) || !/^session_[A-Za-z0-9]{8,}$/.test(session ?? "") || !/^uasco\/registry-probe[A-Za-z0-9._-]*$/.test(branch)) { console.error("probe --role A|B --session <id> [--branch uasco/registry-probe*]"); process.exit(1); }
  const ev = [];
  const log = (step, data = {}) => { const e = {at: new Date().toISOString(), role, session, step, ...data}; ev.push(e); console.log(JSON.stringify(e)); if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(ev, null, 2) + "\n"); };
  await runProbe({role, session, repoRoot: ROOT, branch, keyDir: arg("key-dir", "/tmp/fv2-probe-keys"), prBranch: arg("pr-branch", "claude/nice-sagan-c1zzow"), log});
}
function probeKeyring() {
  const branch = arg("branch", "uasco/registry-probe2");
  const reg = createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(ROOT)}), ref: `refs/heads/${branch}`});
  const keys = reg.sections().filter(k => k.startsWith("probe-keys/")).map(k => { const d = reg.read(k).doc; return {keyId: d.keyId, role: d.role, sessionId: d.session, publicKeyPem: d.publicKeyPem}; });
  const ring = {"//TR": "PROBE anahtar listesi: yalnız probe- alanında iki-oturumlu güvenlik probu için; canlı uasco-v7 otoritesini YETKİLENDİREMEZ (loader probe olmayan alanı reddeder).", schema: KEYRING_SCHEMA, mode: "PROBE", domain: PROBE_DOMAIN, sourceBranch: branch, keys};
  fs.mkdirSync(path.dirname(arg("out")), {recursive: true}); fs.writeFileSync(arg("out"), JSON.stringify(ring, null, 2) + "\n");
  console.log(JSON.stringify({keys: keys.map(k => `${k.role}:${k.sessionId}:${k.keyId}`)}));
}

const cmd = process.argv[2];
if (cmd === "plan") plan();
else if (cmd === "evidence") await evidence();
else if (cmd === "intents") intents();
else if (cmd === "bridge") await bridge();
else if (cmd === "registry") await registry();
else if (cmd === "probe") await probe();
else if (cmd === "probe-keyring") probeKeyring();
else { console.error("usage: cli.mjs plan|evidence|intents"); process.exit(1); }
