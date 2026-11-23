// //TR: İki-oturumlu güvenlik probunun yerel provası: aynı senaryo iki ayrı süreçte, paylaşımlı bare origin + iki klon üzerinden (GitHub/kanonik kaynaklar sahte, zaman ölçekli) koşar; canlı Cloud koşusundan önce senaryonun her saldırıyı reddettiğini ve meşru yolların geçtiğini doğrular.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {git} from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
describe("two-process rehearsal of the two-session security probe", () => {
  it("every attack is refused and the legitimate signed path succeeds", {timeout: 240_000}, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-probe-"));
    const origin = path.join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "integ", origin);
    const seed = path.join(root, "seed"); git(root, "clone", "-q", origin, seed);
    fs.writeFileSync(path.join(seed, "R"), "b\n"); git(seed, "add", "."); git(seed, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "b"); git(seed, "push", "-q", "origin", "HEAD:integ");
    const base = git(seed, "rev-parse", "HEAD");
    const A = path.join(root, "A"), B = path.join(root, "B");
    git(root, "clone", "-q", origin, A); git(root, "clone", "-q", origin, B);
    const ringFile = path.join(root, "ring.json");
    const runner = path.join(root, "run.mjs");
    fs.writeFileSync(runner, `
import fs from "node:fs"; import {spawnSync} from "node:child_process";
import {runProbe, PROBE_DOMAIN} from ${JSON.stringify(pathToFileURL(path.resolve(HERE, "../../automation/factory-v2/probe-scenario.mjs")).href)};
import {createSharedRegistry} from ${JSON.stringify(pathToFileURL(path.resolve(HERE, "../../automation/factory-v2/shared-registry.mjs")).href)};
import {createRemoteDocStore, gitRunner} from ${JSON.stringify(pathToFileURL(path.resolve(HERE, "../../automation/factory-v2/ref-doc-store.mjs")).href)};
import {snapshotV41} from ${JSON.stringify(pathToFileURL(path.resolve(HERE, "../../automation/factory-v2/bridge.mjs")).href)};
import {KEYRING_SCHEMA, parseKeyring} from ${JSON.stringify(pathToFileURL(path.resolve(HERE, "../../automation/factory-v2/identity.mjs")).href)};
const [role, session, repo, out, ringFile, base] = process.argv.slice(2);
const ev = [];
const reg = createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(repo)}), ref: "refs/heads/uasco/registry-probe2"});
// keyring "publication": role A builds it from published keys once both are present (stands in for the PR-branch commit)
const keyringSha = async me => { for (;;) { const ks = reg.sections().filter(k => k.startsWith("probe-keys/")); if (ks.length === 2) break; await new Promise(r => setTimeout(r, 200)); }
  if (role === "A") { const keys = reg.sections().filter(k => k.startsWith("probe-keys/")).map(k => { const d = reg.read(k).doc; return {keyId: d.keyId, role: d.role, sessionId: d.session, publicKeyPem: d.publicKeyPem}; });
    fs.writeFileSync(ringFile + ".tmp", JSON.stringify({schema: KEYRING_SCHEMA, mode: "PROBE", domain: PROBE_DOMAIN, keys})); fs.renameSync(ringFile + ".tmp", ringFile); }
  while (!fs.existsSync(ringFile)) await new Promise(r => setTimeout(r, 200));
  const blob = spawnSync("git", ["hash-object", "-w", ringFile], {cwd: repo, encoding: "utf8"}).stdout.trim();
  const tree = spawnSync("git", ["mktree"], {cwd: repo, input: "040000 tree " + spawnSync("git", ["mktree"], {cwd: repo, input: "100644 blob " + blob + "\\tPROBE-ROLE-KEYS.json\\n", encoding: "utf8"}).stdout.trim() + "\\tprobe\\n", encoding: "utf8"}).stdout.trim();
  const t2 = spawnSync("git", ["mktree"], {cwd: repo, input: "040000 tree " + tree + "\\tfactory-v2\\n", encoding: "utf8"}).stdout.trim();
  const t3 = spawnSync("git", ["mktree"], {cwd: repo, input: "040000 tree " + t2 + "\\tdocs\\n", encoding: "utf8"}).stdout.trim();
  return spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit-tree", t3, "-m", "ring"], {cwd: repo, encoding: "utf8"}).stdout.trim(); };
const H = "a".repeat(40);
const deps = {timeScale: 0.1, pollMs: 150, keyringSha,
  live: {canonicalSha: () => base, openPrs: () => [], stateDigest: sha => snapshotV41({baseRef: "v7/integration", baseSha: sha, autonomyState: {}, taskIndex: {tasks: []}}).stateDigest},
  git: {canonicalSha: () => base, show: (s, p) => p.endsWith("STATE.json") ? "{}" : p.endsWith("task-index.json") ? '{"tasks":[]}' : null, isAncestor: () => false},
  gh: p => p === "pulls/347" ? {merged: false, head: {sha: H}, base: {ref: "v7/integration", sha: base}, merge_commit_sha: null} : [],
  gateDeps: () => ({gh: p => p === "pulls/347" ? {merged: false, head: {sha: H}, base: {ref: "v7/integration"}} : [], git: {canonicalSha: () => base, isAncestor: () => false, show: () => null}, trustedReviewerLogins: ["x"], baseRef: "v7/integration"})};
await runProbe({role, session, repoRoot: repo, branch: "uasco/registry-probe2", keyDir: repo + "-keys", prBranch: "none", deps,
  log: (step, data = {}) => { ev.push({step, ...data}); fs.writeFileSync(out, JSON.stringify(ev)); }});
`);
    const run = (role, sess, repo) => new Promise((res, rej) => { const c = spawn(process.execPath, [runner, role, sess, repo, path.join(root, `${role}.json`), ringFile, base], {stdio: ["ignore", "inherit", "inherit"]}); c.on("close", code => code === 0 ? res() : rej(new Error(`${role} exit ${code}`))); });
    await Promise.all([run("A", "session_probeAAAAAA", A), run("B", "session_probeBBBBBB", B)]);
    const ev = Object.fromEntries(["A", "B"].flatMap(r => JSON.parse(fs.readFileSync(path.join(root, `${r}.json`), "utf8")).map(e => [e.step, e])));
    expect(ev.B_DIRECT_FORGED_WRITE.written).toBe(true);
    expect(ev.B_ASSERT_V2_ON_FORGED_RECORD).toMatchObject({outcome: "REFUSED"});
    expect(ev.A_V41_MAY_DISPATCH_AFTER_FORGERY.value).toBe(false);
    expect(ev.A_RESET_INVALID_WITH_V41_KEY.outcome).toBe("ACCEPTED");
    expect(ev.B_RESET_INVALID_WITH_CANDIDATE_KEY.error).toMatch(/ROLE_NOT_ALLOWED/);
    expect(ev.B_PREPARE_TEXT_EVIDENCE.error).toMatch(/GATE_REVIEW:EVIDENCE_SHAPE/);
    expect(ev.B_PREPARE_REAL_BUT_UNMERGED_PR_347.error).toMatch(/PR_NOT_MERGED/);
    expect(ev.B_PREPARE_PROBE_WAIVER.outcome).toBe("ACCEPTED");
    expect(ev.B_DRAIN_ACK_ACTOR_STRING_AS_V41.error).toMatch(/SIGNATURE_REQUIRED/);
    expect(ev.B_DRAIN_ACK_UNREGISTERED_KEY_CLAIMING_V41.error).toMatch(/SIGNER_KEY_UNKNOWN/);
    expect(ev.B_DRAIN_ACK_WITH_CANDIDATE_KEY.error).toMatch(/ROLE_NOT_ALLOWED/);
    expect(ev.B_RELAY_ALTERED_DRAIN.error).toMatch(/PAYLOAD_MISMATCH/);
    expect(ev.B_RELAY_UNCHANGED_DRAIN.detail).toMatchObject({role: "V41_OWNER", sessionId: "session_probeAAAAAA"});
    expect(ev.B_COMMIT_WITH_LIVE_FRESHNESS.outcome).toBe("ACCEPTED");
    expect(ev.A_GUARD_V41_MERGE_AFTER_HANDOVER).toMatchObject({allowed: false, reason: "V41_FENCED_BY_V2_AUTHORITY"});
    expect(ev.A_GUARD_V41_SIGNED_MERGE_INTENT.allowed).toBe(false);
    expect(ev.B_GUARD_SIGNED_HOLDER_MERGE_INTENT).toMatchObject({allowed: true, by: "V2"});
    expect(ev.B_ROLLBACK_WITH_CANDIDATE_KEY.error).toMatch(/ROLE_NOT_ALLOWED/);
    expect(ev.B_ROLLBACK_WITH_UNREGISTERED_KEY.error).toMatch(/SIGNER_KEY_UNKNOWN/);
    const races = ["A", "B"].map(r => JSON.parse(fs.readFileSync(path.join(root, `${r}.json`), "utf8")).find(e => e.step === "WRITER_LEASE_RACE"));
    expect(races.filter(r => r.granted).length).toBe(1); // exactly one writer
    expect(ev.STALE_WRITER_FENCED_AFTER_TAKEOVER).toMatchObject({fenced: true, renewAfterLoss: false});
    expect(ev.WRITER_TAKEOVER_AFTER_EXPIRY).toMatchObject({granted: true, epoch: 2});
    expect(ev.A_ROLLBACK_WITH_V41_KEY.outcome).toBe("ACCEPTED");
    expect(ev.A_V41_MAY_DISPATCH_AFTER_ROLLBACK.value).toBe(true);
  });
});
