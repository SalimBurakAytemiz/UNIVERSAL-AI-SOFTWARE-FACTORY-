// Scratch reproduction (read-only audit): with maxConcurrentRuns=2 and the production default maxStepsPerTick=Infinity,
// does a slot freed by a fast run get refilled while a slow run is still in flight, or only when the whole tick returns?
// Usage: tsx repro-convoy.mts <auditBase> <slowMs> <maxStepsPerTick|inf>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [BASE, SLOWS, MSPT] = process.argv.slice(2);
const SLOW = Number(SLOWS), maxStepsPerTick = MSPT === "inf" ? Number.POSITIVE_INFINITY : Number(MSPT);
const {WorkOsStore} = await import(path.join(BASE, "core/workos/store.ts"));
const {MissionRunner} = await import(path.join(BASE, "core/workos/runner.ts"));
const {FakeExecutors} = await import(path.join(BASE, "core/workos/executors.ts"));
const {fakeSecurity} = await import(path.join(BASE, "core/workos/security-tools.ts"));
const {testExecutionGate} = await import(path.join(BASE, "tests/support/test-sandbox.ts"));
const {spawnGitSync} = await import(path.join(BASE, "automation/lib/git-isolation.mjs"));
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "par-convoy-"));
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(String(r.stderr)); return String(r.stdout).trim(); };
const repo = path.join(tmp, "src"); fs.mkdirSync(repo);
git(repo, ["init", "-q", "-b", "main"]);
fs.writeFileSync(path.join(repo, "test.mjs"), `import fs from "node:fs";process.exit(fs.existsSync("feature.txt")?0:1);\n`);
git(repo, ["add", "-A"]); git(repo, ["-c", "user.name=S", "-c", "user.email=s@x.invalid", "commit", "-q", "-m", "seed"]);
const dataDir = path.join(tmp, "data"), runtime = path.join(tmp, "rt"); fs.mkdirSync(runtime);
const store = new WorkOsStore(dataDir);
const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
const mk = (title: string) => { const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "feature.txt", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"}); for (const to of ["PREFLIGHT", "AUTHORIZED"]) store.transitionMission({tenantId: "tA"}, m.missionId, to, "t", "FOUNDER_LOCAL"); return m.missionId; };
const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
const base = fake.pair();
const T0 = Date.now(); const ev: string[] = []; const at = (s: string) => ev.push(`${((Date.now() - T0) / 1000).toFixed(2)}s ${s}`);
const pair = {...base, implementer: {...base.implementer, async implement(w: string, spec: any, ctx: any) {
  at(`implement start ${spec.title}`);
  if (spec.title === "B") await new Promise(r => setTimeout(r, SLOW));
  const r = await base.implementer.implement(w, spec, ctx); at(`implement end ${spec.title}`); return r;
}}};
const ids: Record<string, string> = {};
for (const t of ["A", "B", "C"]) ids[store.createRun({tenantId: "tA", missionId: mk(t), executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"}).runId] = t;
const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: path.join(BASE, "config/environment-policy.json"), executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, maxConcurrentRuns: 2, maxStepsPerTick, security: fakeSecurity(path.join(tmp, "sec")).options});
const name = (xs: string[]) => xs.map(x => ids[x]);
const done = (id: string) => store.engineGetRun(id).status === "AWAITING_APPROVAL";
let n = 0;
while (!Object.keys(ids).every(done) && n < 200) {
  n++; const rep = await runner.tick();
  if (rep.claimed.length || rep.recovered.length) at(`tick ${n} claimed=${name(rep.claimed)} deferred=${name(rep.deferred)} fenced=${name(rep.fenced)}`);
  for (const [id, t] of Object.entries(ids)) if (done(id) && !ev.some(e => e.endsWith(`AWAITING_APPROVAL ${t}`))) at(`AWAITING_APPROVAL ${t}`);
  await new Promise(r => setTimeout(r, 50));
}
console.log(JSON.stringify({slowMs: SLOW, maxStepsPerTick: MSPT, ticks: n, timeline: ev}, null, 1));
fs.rmSync(tmp, {recursive: true, force: true});
