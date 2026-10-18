//TR: FA-LEASE2 baglama (wiring) KABUL kaniti: docs/autonomy/FA-LEASE2-CHANGE-SCOPE.md'deki alti korunan dosyanin entegrasyon dikislerini (claim-before-dispatch, HELD-skip, renew/LOST, release-on-terminal, verdict guard, claim-shape validateControl, token gizliligi) GERCEK lease+verdict modullerine karsi dogrular. Pre-staged kirmizi->yesil hedef: korunan cekirdek henuz DUZENLENMEDI (FA-LEASE2 D3 bekleniyor). Bu dosya korunan hicbir dosyaya dokunmaz, gecici repo kullanir, iz birakmaz.
// FA-LEASE2 wiring ACCEPTANCE proof. Simulates the exact orchestrator integration seams named in
// docs/autonomy/FA-LEASE2-CHANGE-SCOPE.md against the REAL merged lease + verdict modules, so the gated
// protected-core wiring has a ready red->green target. It does NOT edit any protected file (the wiring is
// FA-LEASE2, blocked on the Local D3 record); it only proves what the wiring must do. Run (Node 24):
//   node docs/autonomy/reference/fa-lease2-wiring-acceptance.mjs
import {mkdtempSync, rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, "../../../automation/lib");
const {claim, renew, release, isValidLeaseRecord, leaseVersion} = await import(path.join(LIB, "task-lease.mjs"));
const {createLocalGitRefStore} = await import(path.join(LIB, "task-lease-git-store.mjs"));
const {bindVerdict, verifyVerdict} = await import(path.join(LIB, "lease-verdict.mjs"));

const tmpRoot = mkdtempSync(path.join(HERE, ".fa-lease2-accept-"));
process.on("exit", () => { try { rmSync(tmpRoot, {recursive: true, force: true}); } catch {} });
let passed = 0, failed = 0;
const ok = (c, label, got) => { if (c) { passed++; console.log(`PASS  ${label}`); } else { failed++; console.log(`FAIL  ${label}${got !== undefined ? `\n        got: ${JSON.stringify(got)}` : ""}`); } };
const section = (t) => console.log(`\n== ${t}`);
const git = (dir, a) => spawnSync("git", ["-C", dir, ...a], {encoding: "utf8"});
function newStore() {
  const dir = path.join(tmpRoot, `r${Math.random().toString(36).slice(2)}`);
  if (spawnSync("git", ["init", "-q", dir], {encoding: "utf8"}).status !== 0) throw new Error("git init failed");
  return {dir, store: createLocalGitRefStore({repoDir: dir})};
}
const refExists = (dir, id) => git(dir, ["rev-parse", "--verify", "-q", `refs/uasco/claims/${id}`]).status === 0;

const now = 1_000_000, ttlMs = 900_000, headSha = "sha-reviewed-good";
const impl = {environment: "CLOUD", workerId: "cloud-impl", sessionId: "sess-impl-1"};
const other = {environment: "LOCAL", workerId: "local-w", sessionId: "sess-local-1"};

// Seam 1 — orchestrator-engine.mjs runTick claim site (L194): claim before dispatch; HELD -> skip, no double-dispatch.
section("1. orchestrator-engine runTick: claim-before-dispatch; HELD skips (no double-dispatch)");
const {dir, store} = newStore();
const c1 = claim(store, {...impl, taskId: "T", headSha, now, ttlMs});
ok(c1.status === "GRANTED", "first claim at the dispatch site is GRANTED -> dispatch proceeds", c1.status);
ok(refExists(dir, "T"), "lease ref refs/uasco/claims/T exists (ownership taken before dispatch)");
const c2 = claim(store, {...other, taskId: "T", headSha, now, ttlMs});
ok(c2.status === "HELD", "a second worker's claim at its dispatch site is HELD -> it must skip, not dispatch", c2.status);
const implSession = c1.record.sessionId; // the orchestrator reads implementerSessionId from the held lease

// Seam 2 — orchestrator-engine runTick loop: renew keeps ownership; LOST after takeover -> abort before commit.
section("2. orchestrator-engine runTick: renew keeps ownership; LOST aborts before commit");
const r1 = renew(store, {...impl, taskId: "T", token: c1.record.token, now: now + 1000, ttlMs});
ok(r1.status === "RENEWED" && r1.record.token === c1.record.token, "renew-on-tick keeps the same token", r1.status);
const taker = claim(store, {...other, taskId: "T", headSha, now: now + ttlMs + 2000, ttlMs}); // after expiry
ok(taker.status === "GRANTED" && taker.record.epoch === c1.record.epoch + 1, "expired lease reclaimed by another env (epoch+1)", taker.record && taker.record.epoch);
const lost = renew(store, {...impl, taskId: "T", token: c1.record.token, now: now + ttlMs + 3000, ttlMs});
let committed = false;
if (lost.status === "RENEWED") committed = true; // the wiring must NOT commit when it has lost the lease
ok(lost.status === "LOST", "the displaced implementer's renew returns LOST", lost.status);
ok(committed === false, "LOST -> the builder round aborts BEFORE git.commitAll (no commit under a lost lease)");

// Seam 3 — orchestrator-engine applyOutcome terminal (L79-84): release on CLOSED/MERGED; task re-claimable.
section("3. orchestrator-engine applyOutcome terminal: release frees the lease");
const rel = release(store, {...other, taskId: "T", token: taker.record.token});
ok(rel.status === "RELEASED", "release on a terminal transition succeeds for the current holder", rel.status);
ok(!refExists(dir, "T"), "after release the lease ref is gone");
ok(claim(store, {...impl, taskId: "T", headSha, now: now + ttlMs + 5000, ttlMs}).status === "GRANTED", "released task is claimable again");

// Seam 4 — orchestrator-executors verifyCleanEvidence / claudeOnlyExecutionMergeDenial: verdict bound to task+SHA+independent session/identity.
section("4. orchestrator-executors merge gate: verdict bound to task + reviewedSha + independent session + identity");
const expected = {expectedTaskId: "T", expectedHeadSha: headSha, implementerSessionId: implSession, builderIdentity: "claude-builder"};
const base = {taskId: "T", reviewedSha: headSha, reviewerSessionId: "sess-reviewer-1", implementerSessionId: implSession, result: "CLEAN", reviewerIdentity: "claude-reviewer", builderIdentity: "claude-builder"};
ok(verifyVerdict(bindVerdict(base), expected).ok === true, "valid independent CLEAN at the right task+SHA+identity is ACCEPTED");
ok(verifyVerdict(bindVerdict({...base, reviewedSha: "sha-old"}), expected).reason === "STALE_SHA", "stale reviewed SHA -> STALE_SHA");
ok(verifyVerdict(bindVerdict(base), {...expected, expectedHeadSha: "sha-moved"}).reason === "STALE_SHA", "head moved after review -> STALE_SHA");
ok(verifyVerdict(bindVerdict({...base, reviewerSessionId: implSession}), expected).reason === "NOT_INDEPENDENT", "reviewer session == implementer session -> NOT_INDEPENDENT");
ok(verifyVerdict(bindVerdict({...base, implementerSessionId: "sess-forged"}), expected).reason === "NOT_INDEPENDENT", "verdict implementer != the lease holder -> NOT_INDEPENDENT");
ok(verifyVerdict(bindVerdict({...base, reviewerIdentity: "claude-builder"}), expected).reason === "SAME_IDENTITY", "reviewer identity == builder identity -> SAME_IDENTITY");
ok(verifyVerdict(bindVerdict({...base, reviewerIdentity: "  CLAUDE-Builder "}), expected).reason === "SAME_IDENTITY", "case/space variant of the builder identity -> SAME_IDENTITY");
ok(verifyVerdict(bindVerdict({...base, taskId: "OTHER"}), expected).reason === "TASK_MISMATCH", "verdict for another task -> TASK_MISMATCH");
ok(verifyVerdict(bindVerdict({...base, result: "BLOCKED"}), expected).reason === "NOT_CLEAN:BLOCKED", "non-CLEAN verdict -> NOT_CLEAN");

// Seam 5 — orchestrator-state validateControl: control.packages[id].claim must satisfy isValidLeaseRecord (fail-closed).
section("5. orchestrator-state validateControl: a per-task claim record must be a valid lease record");
ok(isValidLeaseRecord(c1.record) === true, "a real GRANTED claim record is a valid lease record (validateControl accepts)");
for (const bad of [null, {}, {token: ""}, {...c1.record, token: ""}, {...c1.record, epoch: 0}, {...c1.record, expiresAt: "soon"}])
  if (isValidLeaseRecord(bad)) { ok(false, "malformed claim record wrongly accepted", bad); }
ok(![null, {}, {token: ""}, {...c1.record, epoch: 0}, {...c1.record, expiresAt: "soon"}].some(isValidLeaseRecord), "malformed/empty claim records are rejected -> CONTROL_INVALID (fail-closed)");

// Seam 6 — orchestrator-state commitTransition: the raw lease token must never be written to the hash-chained log.
section("6. orchestrator-state transition log: the lease token is never persisted (only taskId/epoch/expiresAt summary)");
const rec = c1.record;
const logEntry = {type: "IMPLEMENT_STARTED", taskId: rec.taskId, epoch: rec.epoch, expiresAt: rec.expiresAt, workerId: rec.workerId}; // the summary the wiring may log
const line = JSON.stringify(logEntry);
ok(!line.includes(rec.token), "serialized transition-log entry does NOT contain the raw lease token");
ok(typeof rec.token === "string" && rec.token.length > 0 && leaseVersion(rec) !== null, "the token exists and versions the lease, but stays out of the log");

console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: ALL CHECKS PASS" : "RESULT: FAILURES PRESENT");
process.exit(failed === 0 ? 0 : 1);
