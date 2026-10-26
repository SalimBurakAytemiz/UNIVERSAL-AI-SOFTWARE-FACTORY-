// Scratch reproduction (read-only audit, not part of the repo): does synchronous event-loop work in run A
// starve run B's lease heartbeat when MissionRunner runs with maxConcurrentRuns=2?
// Usage: tsx repro-hb-starve.ts <auditBase> <cap> <ttlMs> <blockMs>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [BASE, CAPS, TTLS, BLOCKS] = process.argv.slice(2);
const CAP = Number(CAPS), TTL = Number(TTLS), BLOCK = Number(BLOCKS);
const {WorkOsStore} = await import(path.join(BASE, "core/workos/store.ts"));
const {MissionRunner} = await import(path.join(BASE, "core/workos/runner.ts"));
const {FakeExecutors} = await import(path.join(BASE, "core/workos/executors.ts"));
const {fakeSecurity} = await import(path.join(BASE, "core/workos/security-tools.ts"));
const {testExecutionGate} = await import(path.join(BASE, "tests/support/test-sandbox.ts"));
const {spawnGitSync} = await import(path.join(BASE, "automation/lib/git-isolation.mjs"));

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "par-hb-"));
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const calls = {A: 0, B: 0, Baborted: 0};
const pair = {...base, implementer: {...base.implementer, async implement(w: string, spec: any, ctx: any) {
  if (spec.title === "A") {
    calls.A++;
    if (calls.A === 1) { await sleep(Math.floor(TTL / 2)); const until = Date.now() + BLOCK; while (Date.now() < until) { /* synchronous work in run A: models spawnGitSync / sync journal reload */ } }
    return base.implementer.implement(w, spec, ctx);
  }
  calls.B++;
  // run B: a long paid call (async child) that honours shouldAbort like runProcess (polls every 250 ms)
  const until = Date.now() + BLOCK + 2 * TTL; const startedAt = new Date().toISOString();
  while (calls.B === 1 && Date.now() < until) { await sleep(100); if (ctx.shouldAbort?.()) { calls.Baborted++; return {exitCode: null, log: "aborted", argv: ["fake-long"], startedAt, endedAt: new Date().toISOString(), timedOut: false, aborted: true, transient: false}; } }
  return base.implementer.implement(w, spec, ctx);
}}};
const ra = store.createRun({tenantId: "tA", missionId: mk("A"), executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
const rb = store.createRun({tenantId: "tA", missionId: mk("B"), executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
const runner = new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: path.join(BASE, "config/environment-policy.json"), executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: TTL, maxConcurrentRuns: CAP, security: fakeSecurity(path.join(tmp, "sec")).options});
const st = (id: string) => { const r = store.engineGetRun(id); return {status: r.status, step: r.step, attempt: r.attempt, reason: r.reason}; };
const ticks: unknown[] = [];
for (let i = 0; i < 4; i++) {
  const t0 = Date.now(); const rep = await runner.tick();
  ticks.push({tick: i + 1, ms: Date.now() - t0, claimed: rep.claimed.map((x: string) => x === ra.runId ? "A" : "B"), deferred: rep.deferred.map((x: string) => x === ra.runId ? "A" : "B"), fenced: rep.fenced.map((x: string) => x === ra.runId ? "A" : "B"), recovered: rep.recovered.map((x: string) => x === ra.runId ? "A" : "B"), advanced: rep.advanced.map((x: string) => x === ra.runId ? "A" : "B"), A: st(ra.runId), B: st(rb.runId)});
  if (["AWAITING_APPROVAL", "BLOCKED", "FAILED", "RECOVERY_FAILED", "CANCELLED"].includes(st(ra.runId).status) && ["AWAITING_APPROVAL", "BLOCKED", "FAILED", "RECOVERY_FAILED", "CANCELLED"].includes(st(rb.runId).status)) break;
  await sleep(TTL + 200); // let any stale lease expire so the next tick can take it over
}
const recoveryEv = store.engineGetRun(rb.runId).evidence.filter((e: any) => e.kind === "RECOVERY").map((e: any) => e.note);
const jl = fs.readFileSync(path.join(dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); const byType: Record<string, number> = {}; for (const e of jl) byType[e.type] = (byType[e.type] ?? 0) + 1;
console.log(JSON.stringify({journalEntries: jl.length, byType, cap: CAP, ttlMs: TTL, blockMs: BLOCK, implementerCalls: calls, ticks, bRecoveryEvidence: recoveryEv}, null, 1));
fs.rmSync(tmp, {recursive: true, force: true});
