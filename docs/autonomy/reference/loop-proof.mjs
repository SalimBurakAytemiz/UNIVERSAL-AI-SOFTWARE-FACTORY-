//TR: Uctan uca NEXT-STEP DONGU kaniti: Cloud bir gorevi tamamlayip Local'e devredince baska yetkilendirilmis bagimsiz goreve otomatik gectigini, tekil sahiplik ve dogru siniflandirmayi gercek lease modulleri + git-ref store ile kanitlar; repoda iz birakmaz.
// End-to-end LOOP proof for the autonomous next-step cycle (the P0 success criterion), against the REAL merged
// lease modules + git-ref store. It simulates the orchestrator loop: selectNext -> START -> "Cloud finished,
// hand to Local" (status->AWAITING_LOCAL, release the Cloud lease) -> selectNext again, and asserts Cloud
// auto-advances to the next authorized independent task, never hangs on a Local hand-off, never double-owns a
// task, and classifies the terminal state honestly. Run: node loop-proof.mjs  (Node 24). Exits 1 on any FAIL.
import {mkdtempSync, rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {selectNext} from "./next-step-engine.mjs";

const REPO = "../../../automation/lib";
const {createLocalGitRefStore} = await import(`${REPO}/task-lease-git-store.mjs`);
const {release} = await import(`${REPO}/task-lease.mjs`);

const HERE = import.meta.dirname;
const tmpRoot = mkdtempSync(path.join(HERE, ".loop-proof-repos-"));
let passed = 0, failed = 0;
const git = (cwd, args) => spawnSync("git", args, {cwd, encoding: "utf8"});
function newRepo() {
  const dir = path.join(tmpRoot, "repo");
  const init = spawnSync("git", ["init", "-q", dir], {encoding: "utf8"});
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return {dir, store: createLocalGitRefStore({repoDir: dir})};
}
const leaseRefs = (dir) => git(dir, ["for-each-ref", "--format=%(refname)", "refs/uasco/claims/"]).stdout.split("\n").filter(Boolean);
const refExists = (dir, id) => git(dir, ["rev-parse", "--verify", "-q", `refs/uasco/claims/${id}`]).status === 0;
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail !== undefined ? `\n        got: ${JSON.stringify(detail)}` : ""}`); }
}

const now = 1_000_000, ttlMs = 60_000;
const cloud = {environment: "CLOUD", workerId: "cloud-w1", sessionId: "sess-cloud-1"};
const cloud2 = {environment: "CLOUD", workerId: "cloud-w2", sessionId: "sess-cloud-2"};
const sel = (backlog, owner) => selectNext(backlog, {store, owner, now, ttlMs, headSha: "sha-head"});

const {dir, store} = newRepo();

// Backlog: T1,T2 independent CLOUD work; T3 depends on T2 being DONE (a Local hand-off is NOT "done");
// T4 is FOUNDER (needs authority); T5 is already handed to Local and must never block or be started.
const T = {
  T1: {id: "T1", owner: "CLOUD", status: "READY", authorizedBy: "founder", dependsOn: [], priority: 1},
  T2: {id: "T2", owner: "CLOUD", status: "READY", authorizedBy: "founder", dependsOn: [], priority: 2},
  T3: {id: "T3", owner: "CLOUD", status: "READY", authorizedBy: "founder", dependsOn: ["T2"], priority: 3},
  T4: {id: "T4", owner: "FOUNDER", status: "READY", authorizedBy: "founder", dependsOn: [], priority: 4},
  T5: {id: "T5", owner: "CLOUD", status: "AWAITING_LOCAL", authorizedBy: "founder", dependsOn: [], priority: 0},
};
const backlog = Object.values(T);

// Simulate "Cloud finished the task and handed it to Local": the task leaves Cloud's READY set and its Cloud
// lease is released so Local can take ownership. This is the orchestrator's job; the engine only selects.
const handToLocal = (task, lease) => { task.status = "AWAITING_LOCAL"; release(store, {...cloud, taskId: task.id, token: lease.token}); };

console.log("== LOOP: start -> hand to Local -> auto-advance, driven by the real engine + real leases");
const started = [];
const trace = [];
let guard = 0;
let res;
while (guard++ < 20) {
  res = sel(backlog, cloud);
  trace.push(res.action === "START" ? `START:${res.task.id}` : res.action);
  if (res.action !== "START") break;
  // single ownership while active: exactly this task's ref exists, nothing else
  ok(refExists(dir, res.task.id) && leaseRefs(dir).length === 1, `while ${res.task.id} active: exactly one lease ref, and it is ${res.task.id}`, leaseRefs(dir));
  ok(res.lease.environment === "CLOUD" && res.lease.token, `${res.task.id} lease is held by Cloud with a token`, res.lease);
  started.push(res.task.id);
  handToLocal(res.task, res.lease);
  ok(!refExists(dir, res.task.id), `after handing ${res.task.id} to Local, its Cloud lease ref is gone`, leaseRefs(dir));
  // Model Local finishing T2 right after it is handed off, so the dependent T3 can later recover.
  if (res.task.id === "T2") T.T2.status = "DONE";
}

ok(guard < 20, "loop terminates (no hang)", {guard});
ok(JSON.stringify(started) === JSON.stringify(["T1", "T2", "T3"]), "auto-advance order is T1 -> T2 -> T3 (T5 AWAITING_LOCAL never blocks; T3 recovers once T2 is DONE)", started);
ok(!started.includes("T5"), "the Local-handed task T5 is never started by Cloud", started);
ok(!started.includes("T4"), "the FOUNDER task T4 is never auto-started", started);
ok(res.action === "AUTHORITY_REQUIRED" && res.tasks.some((t) => t.id === "T4"), "terminal state is AUTHORITY_REQUIRED naming the FOUNDER task T4", res);
ok(leaseRefs(dir).length === 0, "no Cloud lease is left held after the loop drains", leaseRefs(dir));

// P5 — two Cloud workers never take the SAME task, but DO parallelize across tasks.
console.log("\n== SINGLE OWNERSHIP ACROSS WORKERS (P5)");
// fresh backlog, nothing handed off yet
for (const t of Object.values(T)) {}
const b2 = [
  {id: "U1", owner: "CLOUD", status: "READY", authorizedBy: "founder", dependsOn: [], priority: 1},
  {id: "U2", owner: "CLOUD", status: "READY", authorizedBy: "founder", dependsOn: [], priority: 2},
];
const w1 = sel(b2, cloud);
const w2 = sel(b2, cloud2);
ok(w1.action === "START" && w1.task.id === "U1", "worker 1 starts U1", w1.action + ":" + w1.task?.id);
ok(w2.action === "START" && w2.task.id === "U2", "worker 2 does NOT also take U1; it advances to U2", w2.action + ":" + w2.task?.id);
ok(refExists(dir, "U1") && refExists(dir, "U2"), "both U1 and U2 have exactly one owner each (two refs)", leaseRefs(dir).filter((r) => r.endsWith("U1") || r.endsWith("U2")));
const w1Again = sel(b2, cloud);  // worker 1 re-selects: resumes its own U1, does not jump to U2
ok(w1Again.action === "START" && w1Again.task.id === "U1" && w1Again.lease.token === w1.lease.token, "worker 1 re-selecting resumes its OWN U1 (idempotent, same token)", w1Again.lease?.token === w1.lease?.token);
release(store, {...cloud, taskId: "U1", token: w1.lease.token});
release(store, {...cloud2, taskId: "U2", token: w2.lease.token});

rmSync(tmpRoot, {recursive: true, force: true});
console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "RESULT: ALL CHECKS PASS" : "RESULT: FAILURES PRESENT");
process.exit(failed === 0 ? 0 : 1);
