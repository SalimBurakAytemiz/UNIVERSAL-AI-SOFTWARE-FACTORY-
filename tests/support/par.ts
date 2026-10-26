// //TR: C-PAR-1 test destek modülü (vitest dosyası DEĞİL; tests/*.test.ts değildir, kayıt gerektirmez): MissionRunner paralel-çalışma testlerinin ortak parçaları. "Yavaş git" modeli (eşleşen git çağrısı senkron spawnSync ile gelirse olay döngüsü BLOKLANIR, eşzamansız execFile ile gelirse yalnız sonucu gecikir; gecikme iki yolda aynıdır, shim/PATH gerekmez, Windows'ta da çalışır), depo+store+mission kurulumu ve süreç/grup yardımcıları. Testler iki kayıtlı dosyaya bölünmüştür (heartbeat/planlama ve yazar durdurma) ki hiçbir Windows adımı 600 sn sınırına yaklaşmasın.
import {beforeEach, afterEach, vi} from "vitest";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {testExecutionGate} from "./test-sandbox.js";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {MissionRunner} from "../../core/workos/runner.js";
import {fakeSecurity} from "../../core/workos/security-tools.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import type {RunnerOptions} from "../../core/workos/runner.js";
import type {ExecutorPair} from "../../core/workos/executors.js";

// //TR: "Yavaş git" modeli: eşleşen git çağrısı senkron spawnSync ile gelirse olay döngüsü BLOKLANIR (düzeltme öncesi runner), eşzamansız execFile ile gelirse yalnız sonucu gecikir (düzeltme sonrası runner). Gecikme süresi her iki yolda aynıdır; deterministik, shim/PATH gerekmez, Windows'ta da çalışır.
// //TR: C-PAR-1 (test birleştirme): modül mock'u (vi.mock) dosya genelindedir ve başka testlerin child_process'ini etkilerdi. Bu yüzden kaynakların kullandığı VARSAYILAN dışa aktarım nesnesinde (git-isolation.mjs ve runner.ts `import cp ...; cp.spawnSync/cp.execFile` ile çağırır) vi.spyOn kullanılır; casus yalnız bu dosyanın testlerinde kurulur ve her testten sonra geri alınır.
export const slow = {rule: null as null | {ms: number; match: (cwd: string, args: string[]) => boolean}, hits: {sync: 0, async: 0}, observe: null as null | ((cwd: string, args: string[], env: NodeJS.ProcessEnv) => void)}; // observe: her git çağrısını (senkron/eşzamansız) gözler; çocuğun ortamını denetleyen testler için
const realSpawnSync = cp.spawnSync, realExecFile = cp.execFile as (...x: unknown[]) => unknown;
const isSlow = (cmd: unknown, args: unknown, opts: unknown) => cmd === "git" && slow.rule !== null && slow.rule.match(String((opts as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(args) ? args.map(String) : []);
export function installSlowGit() {
  vi.spyOn(cp, "spawnSync").mockImplementation(((...a: Parameters<typeof cp.spawnSync>) => {
    if (isSlow(a[0], a[1], a[2])) { slow.hits.sync += 1; for (const until = Date.now() + slow.rule!.ms; Date.now() < until;) { /* senkron git: olay döngüsü bloklanır */ } }
    return realSpawnSync(...a);
  }) as typeof cp.spawnSync);
  vi.spyOn(cp, "execFile").mockImplementation(((...a: unknown[]) => {
    const [cmd, args, opts, cb] = a as [string, string[], unknown, ((...r: unknown[]) => void) | undefined];
    if (cmd === "git") slow.observe?.(String((opts as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(args) ? args.map(String) : [], ((opts as {env?: NodeJS.ProcessEnv} | undefined)?.env) ?? {});
    if (typeof cb === "function" && isSlow(cmd, args, opts)) {
      slow.hits.async += 1; const ms = slow.rule!.ms;
      return realExecFile(cmd, args, opts, (...r: unknown[]) => { setTimeout(() => cb(...r), ms); });
    }
    return realExecFile(...a);
  }) as typeof cp.execFile);
}

export const REPO = path.resolve(import.meta.dirname, "..", "..");
export const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
export const ENGINE = path.join(REPO, "tests", "v7-par-engine.mts");
const TEST_SCRIPT = `import fs from "node:fs";\nprocess.exit(fs.existsSync("feature.txt") ? 0 : 1);\n`;
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// //TR: Yetim implementer/torun, test "yazar öldürüldü" kanıtını verdikten SONRA <dir>/release dosyası yazılana kadar bekler (en çok ORPHAN_MS): sonuç sabit bir zaman penceresine değil, motor açılış hızından bağımsız bu sinyale bağlıdır. Yazar canlıysa dosya belirince ORPHAN*.txt yazar ve test bunu görür.
export const ORPHAN_MS = 30_000;
// //TR: Yazar GERÇEKTEN park etti mi (yönergeyi okudu, release bekliyor)? Motor 1 bundan önce öldürülürse yazar boş yönergeyle hemen çıkar ve "yazar durdurulmuş mu" sorusu anlamsızlaşır. Motor 1 erken çıkarsa false.
export const writerParked = (dir: string, engineClosed: Promise<unknown>, ms = 120_000): Promise<boolean> => Promise.race([waitUntil(() => fs.existsSync(path.join(dir, "writer-ready")), ms), engineClosed.then(() => false)]);
export const release = async (dir: string) => { fs.writeFileSync(path.join(dir, "release"), "1"); await sleep(1500); };
export const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };

// //TR: Her kullanan describe içinde BİR KEZ çağrılır: o describe'ın testleri için tmp dizini + "yavaş git" casusları kurulur ve her testten sonra geri alınır (modül mock'u yok; başka dosyaların child_process'i etkilenmez).
export function parHarness(): {tmp: () => string} {
  let tmp = "";
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-par-")); slow.rule = null; slow.observe = null; slow.hits = {sync: 0, async: 0}; installSlowGit(); });
  afterEach(() => { slow.rule = null; slow.observe = null; vi.restoreAllMocks(); try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });
  return {tmp: () => tmp};
}

export function setup(tmp: string, name = "s", seed: Record<string, string> = {}, clock?: () => number) {
  const root = path.join(tmp, name); fs.mkdirSync(root);
  const repo = path.join(root, "src"); fs.mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
  for (const [f, content] of Object.entries(seed)) fs.writeFileSync(path.join(repo, f), content);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(root, "data"), runtime = path.join(root, "rt"); fs.mkdirSync(runtime);
  const store = new WorkOsStore(dataDir, clock ? {now: clock} : {});
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
  const base = fake.pair();
  const mkRun = (title: string) => {
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "feature.txt", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    return store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: base.implementer.identity, reviewer: base.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  };
  const runner = (extra: Partial<RunnerOptions> = {}) => new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY, executors: base, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(root, "sec")).options, ...extra});
  return {store, dataDir, base, repo, mkRun, runner, status: (id: string) => store.engineGetRun(id)!.status};
}
export const journal = (dataDir: string): Array<{type: string; payload: Record<string, unknown>}> => fs.readFileSync(path.join(dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
export const wrapImplementer = (base: ExecutorPair, implement: ExecutorPair["implementer"]["implement"]): ExecutorPair => ({...base, implementer: {...base.implementer, implement}});

export const waitUntil = async (pred: () => boolean, ms: number) => { for (const until = Date.now() + ms; Date.now() < until;) { if (pred()) return true; await sleep(50); } return false; };
export const procAlive = (pid: number) => { try { process.kill(pid, 0); } catch { return false; } return !(process.platform === "linux" && (() => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); return ["Z", "X"].includes(st.slice(st.lastIndexOf(")") + 2, st.lastIndexOf(")") + 3)); } catch { return true; } })()); };
// //TR: Linux'ta zombi (Z) üyeler yazamaz ve sayılmaz (reaper'sız kapta öldürülen grubun zombileri kill(-pgid, 0)'ı sonsuza dek başarılı tutar); diğer platformlarda kill(…, 0).
export const groupLive = (pgid: number): boolean => {
  if (process.platform !== "linux") { try { process.kill(process.platform === "win32" ? pgid : -pgid, 0); return true; } catch { return false; } }
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try { const st = fs.readFileSync(`/proc/${name}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" "); if (Number(f[2]) === pgid && f[0] !== "Z" && f[0] !== "X") return true; } catch { /* süreç bitti */ }
  }
  return false;
};
