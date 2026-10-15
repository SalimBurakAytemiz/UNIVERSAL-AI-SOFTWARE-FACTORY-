// //TR: Bu test F-B3A-001 düzeltmesini doğrular: süresi dolan lease'in tekrar tekrar devralınması sınırsız döngü yaratmaz; aynı checkpoint konumunda maxRecoveries aşılınca run RECOVERY_FAILED, mission BLOCKED (RECOVERY_BUDGET_EXHAUSTED) olur, executor/klon çağrıları sınırlı kalır, bütçe ilerleme (checkpoint) sonrası sıfırlanır ve lease adım başında/uzun senkron işlerden sonra yenilenir. Gerçek sağlayıcı çağrılmaz.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
// SBX-GATE (INT-R3): these tests exercise their own fixed test/dev commands; host execution is allowed only through the TEST-ONLY injected sandbox provider (production has none).
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./support/test-sandbox.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions, TickReport} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {FakeScript} from "../core/workos/executors.js";
import {TERMINAL_RUN_STATUSES} from "../core/workos/run-state.js";
import type {WorkRun} from "../core/workos/types.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;
const JUMP = 10 * 60_000;
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b3a-rb-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };
const TEST_SCRIPT = `import fs from "node:fs";\nconst v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";\nprocess.exit(v === "ok" ? 0 : 1);\n`;

// Saat, belirli kanıt türleri yazılırken ileri sıçrar: adımın senkron kısmı lease süresinden uzun sürmüş gibi davranır (örn. büyük bir deponun klonu).
class JumpStore extends WorkOsStore {
  constructor(dir: string, private readonly clock: {t: number}, private readonly jumps: Record<string, {by: number; times: number}>) { super(dir, {now: () => clock.t}); }
  override addRunEvidence(...args: Parameters<WorkOsStore["addRunEvidence"]>): ReturnType<WorkOsStore["addRunEvidence"]> {
    const j = this.jumps[args[2].kind];
    if (j && j.times > 0) { j.times -= 1; this.clock.t += j.by; }
    return super.addRunEvidence(...args);
  }
}

interface Ctx { dataDir: string; stopFile: string; missionId: string; store: JumpStore; clock: {t: number}; fake: FakeExecutors }
function setup(jumps: Record<string, {by: number; times: number}>): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const repo = path.join(tmp, `src-${id}`);
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `runtime-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  const clock = {t: Date.now()};
  const store = new JumpStore(dataDir, clock, jumps);
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "Add feature", objective: "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
  const script: FakeScript = {implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})};
  return {dataDir, stopFile: path.join(runtime, "GLOBAL_STOP.json"), missionId: m.missionId, store, clock, fake: new FakeExecutors(script)};
}
const startRun = (c: Ctx): WorkRun => {
  const p = c.fake.pair();
  return c.store.createRun({tenantId: "tA", missionId: c.missionId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
};
const runner = (c: Ctx, extra: Partial<RunnerOptions> = {}) =>
  new MissionRunner({executionGate: testExecutionGate(), store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: c.fake.pair(), retryBackoffMs: [0, 0], leaseTtlMs: 60_000, now: () => c.clock.t, security: fakeSecurity(`${c.dataDir}-sec`).options, ...extra});
const runOf = (c: Ctx, id: string) => c.store.getRun({tenantId: "tA"}, id)!;
const journal = (c: Ctx) => fs.readFileSync(path.join(c.dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
async function tickUntilSettled(c: Ctx, r: MissionRunner, runId: string, max = 12): Promise<TickReport[]> {
  const reps: TickReport[] = [];
  for (let i = 0; i < max; i++) {
    reps.push(await r.tick());
    const s = runOf(c, runId).status;
    if (TERMINAL_RUN_STATUSES.includes(s) || s === "AWAITING_APPROVAL") break;
  }
  return reps;
}

describe("F-B3A-001 recovery budget", () => {
  it("a WORKSPACE step that always outlives its lease ends RECOVERY_FAILED within the budget; clones stay bounded", { timeout: T }, async () => {
    const c = setup({WORKSPACE: {by: JUMP, times: Number.POSITIVE_INFINITY}});
    const r = startRun(c);
    const reps = await tickUntilSettled(c, runner(c), r.runId);
    const run = runOf(c, r.runId);
    expect(run.status).toBe("RECOVERY_FAILED");
    expect(run.reason).toBe("RECOVERY_BUDGET_EXHAUSTED");
    expect(run.step).toBe("WORKSPACE");
    expect(run.attempt).toBe(4); // ilk lease + 2 izinli recovery + bütçeyi aşan devralma
    expect(reps).toHaveLength(4);
    expect(reps[0]).toEqual(expect.objectContaining({claimed: [r.runId], fenced: [r.runId]}));
    for (const rep of reps.slice(1, 3)) expect(rep).toEqual(expect.objectContaining({recovered: [r.runId], fenced: [r.runId]}));
    expect(reps[3]).toEqual(expect.objectContaining({recovered: [r.runId], fenced: []}));
    const rec = run.evidence.filter(e => e.kind === "RECOVERY");
    expect(rec.map(e => e.exitCode)).toEqual([0, 0, 1]);
    expect(rec[2].note).toMatch(/RECOVERY_BUDGET_EXHAUSTED/);
    expect(run.evidence.filter(e => e.kind === "WORKSPACE")).toHaveLength(0); // her denemede yazı fence edildi
    const clones = fs.readdirSync(path.join(c.dataDir, "runs", r.runId, "logs")).filter(f => f.startsWith("workspace-"));
    expect(clones).toHaveLength(3); // 1 + maxRecoveries; bütçe aşılınca yeniden klon yok
    const m = c.store.getMission({tenantId: "tA"}, c.missionId)!;
    expect(m.status).toBe("BLOCKED");
    const last = journal(c).filter(e => e.type === "RUN_TRANSITION" && e.payload.runId === r.runId).at(-1);
    expect(last.payload).toEqual(expect.objectContaining({to: "RECOVERY_FAILED", reason: "RECOVERY_BUDGET_EXHAUSTED"}));
    expect(last.payload.mission).toEqual(expect.objectContaining({to: "BLOCKED", reason: "RECOVERY_BUDGET_EXHAUSTED"}));
    // terminal: sonraki tick'ler hiçbir şey yazmaz ve klonlamaz
    const n = journal(c).length;
    const again = await runner(c).tick();
    expect(again).toEqual(expect.objectContaining({claimed: [], recovered: [], fenced: [], advanced: []}));
    expect(journal(c).length).toBe(n);
  });

  it("a crash that repeats during IMPLEMENT calls the (paid) implementer at most 1 + maxRecoveries times", { timeout: T }, async () => {
    for (const maxRecoveries of [0, 2]) {
      const c = setup({IMPLEMENT: {by: JUMP, times: Number.POSITIVE_INFINITY}});
      const r = startRun(c);
      await tickUntilSettled(c, runner(c, {maxRecoveries}), r.runId);
      const run = runOf(c, r.runId);
      expect(run.status).toBe("RECOVERY_FAILED");
      expect(run.reason).toBe("RECOVERY_BUDGET_EXHAUSTED");
      expect(run.step).toBe("IMPLEMENT");
      expect(c.fake.calls.implement).toBe(1 + maxRecoveries);
      expect(c.fake.calls.review).toBe(0);
      expect(run.attempt).toBe(2 + maxRecoveries);
      expect(c.store.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("BLOCKED");
    }
  });

  it("the budget counts recoveries since the last checkpoint: progress between takeovers is not exhausted", { timeout: T }, async () => {
    const c = setup({IMPLEMENT: {by: JUMP, times: 2}, SECRET_SCAN: {by: JUMP, times: 2}});
    const r = startRun(c);
    const reps = await tickUntilSettled(c, runner(c), r.runId);
    const run = runOf(c, r.runId);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.attempt).toBe(5); // IMPLEMENT'te 2 + VERIFY'da 2 recovery; toplam 4 > maxRecoveries ama her konumda <= 2
    expect(reps.flatMap(x => x.recovered)).toHaveLength(4);
    expect(c.fake.calls.implement).toBe(3);
    expect(run.checkpoints.map(x => x.step)).toEqual(["WORKSPACE", "IMPLEMENT", "VERIFY", "SECURITY", "REVIEW", "REGRESSION", "REPORT"]);
    expect(run.checkpoints.map(x => x.data.attempt)).toEqual([1, 3, 5, 5, 5, 5, 5]);
    expect(run.evidence.filter(e => e.kind === "RECOVERY").map(e => e.exitCode)).toEqual([0, 0, 0, 0]);
    expect(c.store.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("REPORTING");
  });

  it("the lease is renewed at each step start and after long synchronous work, so a run whose steps each take less than the TTL is never taken over", { timeout: T }, async () => {
    // her kanıt yazısı 25 s ilerletir; toplam süre (7 kanıt = 175 s) TTL'yi (60 s) çok aşar, tek adım ise aşmaz
    const c = setup({WORKSPACE: {by: 25_000, times: 1}, IMPLEMENT: {by: 25_000, times: 1}, SECRET_SCAN: {by: 25_000, times: 1}, VERIFY_TESTS: {by: 25_000, times: 1},
      REVIEW: {by: 25_000, times: 1}, REGRESSION_TESTS: {by: 25_000, times: 1}, REPORT: {by: 25_000, times: 1}});
    const t0 = c.clock.t;
    const r = startRun(c);
    const rep = await runner(c).tick();
    expect(c.clock.t - t0).toBe(175_000);
    expect(rep).toEqual(expect.objectContaining({claimed: [r.runId], recovered: [], fenced: []}));
    const run = runOf(c, r.runId);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.attempt).toBe(1);
    expect(run.evidence.some(e => e.kind === "RECOVERY")).toBe(false);
    const renews = journal(c).filter(e => e.type === "RUN_LEASE" && e.payload.runId === r.runId && e.payload.kind === "RENEW");
    expect(renews.length).toBeGreaterThanOrEqual(6); // en az her adım başında bir yenileme
  });
});
