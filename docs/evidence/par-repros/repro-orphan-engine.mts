// Scratch reproduction (read-only audit): engine crash while the implementer child runs -> does the orphan child keep writing
// into runs/<id>/work after a new engine has taken the expired lease over and re-entered IMPLEMENT?
// Usage: tsx repro-orphan-engine.mts <auditBase> <dir> <phase: 1|2> <ttlMs>
import fs from "node:fs";
import path from "node:path";
const [BASE, DIR, PHASE, TTLS] = process.argv.slice(2);
const TTL = Number(TTLS);
const {WorkOsStore} = await import(path.join(BASE, "core/workos/store.ts"));
const {MissionRunner} = await import(path.join(BASE, "core/workos/runner.ts"));
const {FakeExecutors} = await import(path.join(BASE, "core/workos/executors.ts"));
const {fakeSecurity} = await import(path.join(BASE, "core/workos/security-tools.ts"));
const {testExecutionGate} = await import(path.join(BASE, "tests/support/test-sandbox.ts"));
const {spawnGitSync} = await import(path.join(BASE, "automation/lib/git-isolation.mjs"));
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(String(r.stderr)); return String(r.stdout).trim(); };
const dataDir = path.join(DIR, "data"), runtime = path.join(DIR, "rt");
const state = path.join(DIR, "state.json");
let fake: InstanceType<typeof FakeExecutors>;
if (PHASE === "1") {
  const repo = path.join(DIR, "src"); fs.mkdirSync(repo, {recursive: true}); fs.mkdirSync(runtime, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), `import fs from "node:fs";process.exit(fs.existsSync("feature.txt")?0:1);\n`);
  git(repo, ["add", "-A"]); git(repo, ["-c", "user.name=S", "-c", "user.email=s@x.invalid", "commit", "-q", "-m", "seed"]);
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "X", objective: "feature.txt", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) store.transitionMission({tenantId: "tA"}, m.missionId, to, "t", "FOUNDER_LOCAL");
  // engine 1's implementer: a long call (8 s) that writes ORPHAN.txt and commits at the end
  fake = new FakeExecutors({implement: () => ({files: {"ORPHAN.txt": "written by the implementer of the crashed engine\n"}, sleepMs: 8000, message: "orphan commit"}), review: () => ({verdict: "CLEAN"})});
  const pair = fake.pair();
  const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  fs.writeFileSync(state, JSON.stringify({runId: run.runId, work: path.join(dataDir, "runs", run.runId, "work")}));
  const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: path.join(BASE, "config/environment-policy.json"), executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: TTL, security: fakeSecurity(path.join(DIR, "sec")).options});
  await runner.tick(); // the parent SIGKILLs this process while the implementer child sleeps
} else {
  const {runId, work} = JSON.parse(fs.readFileSync(state, "utf8"));
  const store = new WorkOsStore(dataDir);
  fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
  const pair = fake.pair();
  const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: path.join(BASE, "config/environment-policy.json"), executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(DIR, "sec2")).options});
  const rep = await runner.tick();
  const r = store.engineGetRun(runId);
  const out = {phase2tick: {recovered: rep.recovered, advanced: rep.advanced, fenced: rep.fenced}, runAfterPhase2: {status: r.status, attempt: r.attempt, headSha: r.headSha}, workHeadAfterPhase2: git(work, ["rev-parse", "HEAD"])};
  // wait for the orphan child (if alive) to finish its 8 s sleep and commit
  await new Promise(res => setTimeout(res, 9000));
  const after = {workHead: git(work, ["rev-parse", "HEAD"]), workLog: git(work, ["log", "--format=%s", "-5"]).split("\n"), orphanFilePresent: fs.existsSync(path.join(work, "ORPHAN.txt")), runHeadSha: store.engineGetRun(runId).headSha};
  console.log(JSON.stringify({...out, afterOrphanWindow: after, workspaceDivergedFromRecordedHead: after.workHead !== after.runHeadSha}, null, 1));
}
