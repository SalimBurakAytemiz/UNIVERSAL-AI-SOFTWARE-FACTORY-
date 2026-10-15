// //TR: Bu yardımcı REL-FX-1..4 testlerinin ortak kurulumudur: geçici git deposu, Work OS store, deterministik FAKE executor + sahte güvenlik araçlarıyla runner, token'lı control API ve geçerli hash zinciriyle journal yeniden yazma (enjeksiyon/tamper senaryoları). Gerçek sağlayıcı çağrılmaz.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok (enjeksiyon testleri için geçerli hash zinciri üretir)
import {sha256 as sha256Untyped} from "../../automation/lib/atomic-json.mjs";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import type {WorkOsStoreOptions} from "../../core/workos/store.js";
import {MissionRunner} from "../../core/workos/runner.js";
import type {RunnerOptions} from "../../core/workos/runner.js";
import {fakeSecurity} from "../../core/workos/security-tools.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import type {FakeScript} from "../../core/workos/executors.js";
import {buildServer} from "../../apps/control-api/src/server.js";
import type {RiskLevel, WorkRun} from "../../core/workos/types.js";
// INT-R4: SBX kapısı artık yürütmeyi aracılar; bu runner/dev-run testlerinin komutları testlerin kendi sabit fikstürleridir (AI üretimi değil), bu yüzden yalnız-test passthrough sandbox enjekte edilir (SBX-8 temel testleriyle aynı desen). Gerçek izolasyon sağlamaz; üretim bu dosyayı import etmez.
import {testExecutionGate, TEST_HOST_PASSTHROUGH_SANDBOX} from "./test-sandbox.js";

export const sha256 = sha256Untyped as (v: unknown) => string;
export const REPO = path.resolve(import.meta.dirname, "..", "..");
export const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
export const T = 180_000;

export function tmpRoot(prefix: string): string { return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix)); }
export function rmTmp(dir: string): void { try { fs.rmSync(dir, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } }
export const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };

export const TEST_SCRIPT = `import fs from "node:fs";\nconst v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";\nconsole.log("feature=" + v);\nprocess.exit(v === "ok" ? 0 : 1);\n`;
export function makeRepo(tmp: string, id: string, files: Record<string, string> = {"test.mjs": TEST_SCRIPT, "README.txt": "base\n"}): {repo: string; head: string} {
  const repo = path.join(tmp, `src-${id}`);
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-q", "-b", "main"]);
  for (const [rel, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), {recursive: true}); fs.writeFileSync(path.join(repo, rel), content); }
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  return {repo, head: git(repo, ["rev-parse", "HEAD"])};
}

export interface Ctx { tmp: string; store: WorkOsStore; dataDir: string; runtime: string; stopFile: string; repo: string; head: string; missionId: string; projectId: string; tenantId: string }
export interface SetupOpts { riskLevel?: RiskLevel; objective?: string; testCommand?: string[]; files?: Record<string, string>; authorize?: boolean; storeOptions?: WorkOsStoreOptions }
export function setup(tmp: string, tenantId = "tA", o: SetupOpts = {}): Ctx {
  const id = crypto.randomBytes(4).toString("hex");
  const {repo, head} = makeRepo(tmp, id, o.files);
  const dataDir = path.join(tmp, `data-${id}`), runtime = path.join(tmp, `runtime-${id}`);
  fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir, o.storeOptions);
  const p = store.createProject({tenantId, orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: o.testCommand ?? ["node", "test.mjs"]});
  const m = store.createMission({tenantId, projectId: p.projectId, title: "Add feature", objective: o.objective ?? "feature.txt must say ok", acceptanceCriteria: ["tests pass"], riskLevel: o.riskLevel ?? "R1", createdBy: "FOUNDER_LOCAL"});
  if (o.authorize !== false) for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId}, m.missionId, to, "test", "FOUNDER_LOCAL");
  return {tmp, store, dataDir, runtime, stopFile: path.join(runtime, "GLOBAL_STOP.json"), repo, head, missionId: m.missionId, projectId: p.projectId, tenantId};
}
export const okScript = (extra: Partial<FakeScript> = {}): FakeScript => ({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"}), ...extra});
export function runner(c: Ctx, fake: FakeExecutors, extra: Partial<RunnerOptions> = {}): MissionRunner {
  return new MissionRunner({store: c.store, dataDir: c.dataDir, globalStopFile: c.stopFile, envPolicyFile: ENV_POLICY, executors: fake.pair(), retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(`${c.dataDir}-sec`).options, executionGate: testExecutionGate(), ...extra});
}
export const startRun = (c: Ctx, fake: FakeExecutors) => {
  const p = fake.pair();
  return c.store.createRun({tenantId: c.tenantId, missionId: c.missionId, executor: {implementer: p.implementer.identity, reviewer: p.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
};
export const runOf = (c: Ctx, id: string) => c.store.getRun({tenantId: c.tenantId}, id)!;
export const missionOf = (c: Ctx) => c.store.getMission({tenantId: c.tenantId}, c.missionId)!;
export const journalFile = (c: {dataDir: string}) => path.join(c.dataDir, "journal.jsonl");
export const journalText = (c: {dataDir: string}) => fs.readFileSync(journalFile(c), "utf8");
export const journalEntries = (c: {dataDir: string}) => journalText(c).split("\n").filter(Boolean).map(l => JSON.parse(l));
export const kinds = (r: WorkRun) => r.evidence.map(e => e.kind);

// Run'ı AWAITING_APPROVAL'a (veya terminal duruma) kadar sürer.
export async function drive(c: Ctx, eng: MissionRunner, runId: string, max = 30): Promise<WorkRun> {
  for (let i = 0; i < max; i++) {
    await eng.tick();
    const r = runOf(c, runId);
    if (["AWAITING_APPROVAL", "SUCCEEDED", "BLOCKED", "FAILED", "CANCELLED", "RECOVERY_FAILED", "QUARANTINED"].includes(r.status)) return r;
  }
  return runOf(c, runId);
}

// Geçerli hash zinciriyle journal yeniden yazımı (saldırgan/enjeksiyon simülasyonu); snapshot silinir.
export function rewriteJournal(c: {dataDir: string}, edit: (entries: any[]) => any[]): void {
  const entries = edit(journalEntries(c));
  let prev = "0".repeat(64);
  const out = entries.map((e, i) => { const {hash: _h, ...body} = e; body.seq = i + 1; body.prevHash = prev; const full = {...body, hash: sha256(body)}; prev = full.hash; return full; });
  fs.writeFileSync(journalFile(c), out.map(e => JSON.stringify(e)).join("\n") + "\n");
  fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
}

export const TOKEN = crypto.randomBytes(24).toString("hex");
export const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
// repoRoot geçici dizindir; runner'ın env policy dosyası oraya kopyalanır.
export function api(c: Ctx, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(c.tmp, "config"), {recursive: true});
  fs.copyFileSync(ENV_POLICY, path.join(c.tmp, "config", "environment-policy.json"));
  return buildServer({controlToken: TOKEN, runtime: c.runtime, repoRoot: c.tmp, dataDir: c.dataDir, tenantId: c.tenantId, port: 3210, logger: false, sandbox: TEST_HOST_PASSTHROUGH_SANDBOX, ...extra});
}
