// //TR: Test yardımcısı (vitest dosyası DEĞİL): v7-relfx-c3-remediation.test.ts içindeki C-PAR-1 bloğu bu betiği AYRI bir süreçte çalıştırır ve faz 1'deki motoru SIGKILL ile "çökertir" (PAR-04). Faz 1: depo + mission + run kurar, uzun süren (orphan) bir implementer çocuğu başlatır; faz 2: yeni bir motor süresi dolan lease'i devralır ve run'ı sürer.
// Kullanım: node --import tsx tests/v7-par-engine.mts <repoRoot> <dir> <phase 1|2> <leaseTtlMs> <orphanMs> [optionsJson]
// orphanMs: yetim implementer'ın EN ÇOK bekleyeceği süre; asıl sinyal <dir>/release dosyasıdır (testler yazar öldürüldükten SONRA yazar: yazar canlıysa o anda ORPHAN.txt yazar). Sabit zaman penceresi yoktur.
// optionsJson: {grandchild?: "group"|"setsid" (implementer'ın torunu ORPHAN2.txt/ORPHAN3.txt yazar), service?: true (faz 1: tick yerine start(); SIGINT testi), maxRecoveries?: number (faz 2)}
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
const [ROOT, DIR, PHASE, TTL, ORPHAN_MS, OPTS_JSON] = process.argv.slice(2);
const OPTS = JSON.parse(OPTS_JSON ?? "{}") as {grandchild?: "group" | "setsid"; service?: boolean; maxRecoveries?: number};
const imp = (p: string) => import(pathToFileURL(path.join(ROOT, p)).href);
const {WorkOsStore} = await imp("core/workos/store.ts");
const {MissionRunner} = await imp("core/workos/runner.ts");
const {FakeExecutors} = await imp("core/workos/executors.ts");
const {fakeSecurity} = await imp("core/workos/security-tools.ts");
const {testExecutionGate} = await imp("tests/support/test-sandbox.ts");
const {spawnGitSync} = await imp("automation/lib/git-isolation.mjs");
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(String(r.stderr)); return String(r.stdout).trim(); };
const dataDir = path.join(DIR, "data"), runtime = path.join(DIR, "rt"), state = path.join(DIR, "state.json");
const mk = (pair: any, ttl: number, sec: string, extra: Record<string, unknown> = {}) =>
  new MissionRunner({executionGate: testExecutionGate(), store: new WorkOsStore(dataDir), dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: path.join(ROOT, "config/environment-policy.json"), executors: pair, retryBackoffMs: [0, 0], leaseTtlMs: ttl, security: fakeSecurity(path.join(DIR, sec)).options, ...extra});
if (PHASE === "1") {
  const repo = path.join(DIR, "src"); fs.mkdirSync(repo, {recursive: true}); fs.mkdirSync(runtime, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), `import fs from "node:fs";process.exit(fs.existsSync("feature.txt")?0:1);\n`);
  git(repo, ["add", "-A"]); git(repo, ["-c", "user.name=S", "-c", "user.email=s@x.invalid", "commit", "-q", "-m", "seed"]);
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "X", objective: "feature.txt", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) store.transitionMission({tenantId: "tA"}, m.missionId, to, "t", "FOUNDER_LOCAL");
  // motor 1'in implementer'ı: ORPHAN_MS uyur, sonra ORPHAN.txt yazıp commit eder (çöken motorun yetim çocuğu)
  const fake = new FakeExecutors({implement: (_n: number, spec: {runId: string}) => ({files: {"ORPHAN.txt": "written by the implementer of the crashed engine\n"}, sleepMs: Number(ORPHAN_MS), waitFile: path.join(DIR, "release"), readyFile: path.join(DIR, "writer-ready"), message: "orphan commit",
    ...(OPTS.grandchild ? {grandchild: {file: path.join(dataDir, "runs", spec.runId, "work", OPTS.grandchild === "setsid" ? "ORPHAN3.txt" : "ORPHAN2.txt"), delayMs: Number(ORPHAN_MS), waitFile: path.join(DIR, "release"), detached: OPTS.grandchild === "setsid", pidFile: path.join(DIR, `${OPTS.grandchild}.pid`), ...(OPTS.grandchild === "setsid" ? {cwd: DIR} : {})}} : {})}), review: () => ({verdict: "CLEAN"})});
  const base = fake.pair();
  const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: base.implementer.identity, reviewer: base.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  fs.writeFileSync(state, JSON.stringify({runId: run.runId}));
  const pair = {...base, implementer: {...base.implementer, implement: async (w: string, spec: unknown, ctx: unknown) => { fs.writeFileSync(path.join(DIR, "implementing.json"), "1"); return base.implementer.implement(w, spec as never, ctx as never); }}};
  const first = mk(pair, Number(TTL), "sec1");
  if (OPTS.service) { first.start(250); setInterval(() => undefined, 1000); await new Promise(() => undefined); } // start() zamanlayıcıyı unref eder: süreci canlı tutan ayrı bir zamanlayıcı gerekir // SIGINT testi: servis kipi; üst süreç SIGINT gönderir
  else await first.tick(); // üst süreç bu süreci implementer çocuğu uyurken SIGKILL eder
} else {
  const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
  const runner = mk(fake.pair(), 60_000, "sec2", OPTS.maxRecoveries !== undefined ? {maxRecoveries: OPTS.maxRecoveries} : {});
  let rep = await runner.tick();
  for (let i = 0; i < 80 && rep.recovered.length === 0; i++) { await new Promise(r => setTimeout(r, 250)); rep = await runner.tick(); }
  console.log(JSON.stringify({recovered: rep.recovered, fenced: rep.fenced, advanced: rep.advanced, cancelled: rep.cancelled}));
}
