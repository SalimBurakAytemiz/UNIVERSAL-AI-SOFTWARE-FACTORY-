// //TR: C-PAR-1: MissionRunner maxConcurrentRuns >= 2 iken güvenli olmalıdır. Üç ters-çevrilmiş denetim tekrarı (docs/evidence/par-repros, claude/coord-par-repros) regresyon testidir ve fe08022'de BAŞARISIZ, düzeltmeyle GEÇER: PAR-04 yetim implementer çocuğu, PAR-03 senkron git'in diğer run'ın heartbeat'ini aç bırakması, PAR-05 tick'in sürüşleri beklemesi (convoy).
import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
// //TR: Gerçek G/Ç'li (alt süreç, git) testler yoğun Windows runner'da varsayılan 5 sn sınırını aşabilir (diğer b3a testleriyle aynı gerekçe).
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {testExecutionGate} from "./support/test-sandbox.js";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner} from "../core/workos/runner.js";
import type {RunnerOptions} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {ExecutorPair} from "../core/workos/executors.js";

// //TR: "Yavaş git" modeli: eşleşen git çağrısı senkron spawnSync ile gelirse olay döngüsü BLOKLANIR (düzeltme öncesi runner), eşzamansız execFile ile gelirse yalnız sonucu gecikir (düzeltme sonrası runner). Gecikme süresi her iki yolda aynıdır; deterministik, shim/PATH gerekmez, Windows'ta da çalışır.
const slow = vi.hoisted(() => ({rule: null as null | {ms: number; match: (cwd: string, args: string[]) => boolean}, hits: {sync: 0, async: 0}}));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const isSlow = (cmd: unknown, args: unknown, opts: unknown) => cmd === "git" && slow.rule !== null && slow.rule.match(String((opts as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(args) ? args.map(String) : []);
  const spawnSync = ((...a: Parameters<typeof actual.spawnSync>) => {
    if (isSlow(a[0], a[1], a[2])) { slow.hits.sync += 1; for (const until = Date.now() + slow.rule!.ms; Date.now() < until;) { /* senkron git: olay döngüsü bloklanır */ } }
    return actual.spawnSync(...a);
  }) as typeof actual.spawnSync;
  const execFile = ((...a: unknown[]) => {
    const [cmd, args, opts, cb] = a as [string, string[], unknown, ((...r: unknown[]) => void) | undefined];
    if (typeof cb === "function" && isSlow(cmd, args, opts)) {
      slow.hits.async += 1; const ms = slow.rule!.ms;
      return (actual.execFile as (...x: unknown[]) => unknown)(cmd, args, opts, (...r: unknown[]) => { setTimeout(() => cb(...r), ms); });
    }
    return (actual.execFile as (...x: unknown[]) => unknown)(...a);
  }) as typeof actual.execFile;
  return {...actual, spawnSync, execFile, default: {...actual, spawnSync, execFile}};
});

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const ENGINE = path.join(REPO, "tests", "v7-par-engine.mts");
const TEST_SCRIPT = `import fs from "node:fs";\nprocess.exit(fs.existsSync("feature.txt") ? 0 : 1);\n`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };

let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-par-")); slow.rule = null; slow.hits = {sync: 0, async: 0}; });
afterEach(() => { slow.rule = null; try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

function setup(name = "s") {
  const root = path.join(tmp, name); fs.mkdirSync(root);
  const repo = path.join(root, "src"); fs.mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "test.mjs"), TEST_SCRIPT);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "commit", "-q", "-m", "seed"]);
  const dataDir = path.join(root, "data"), runtime = path.join(root, "rt"); fs.mkdirSync(runtime);
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL", repository: {path: repo}, testCommand: ["node", "test.mjs"]});
  const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}}), review: () => ({verdict: "CLEAN"})});
  const base = fake.pair();
  const mkRun = (title: string) => {
    const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "feature.txt", acceptanceCriteria: ["tests pass"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, m.missionId, to, "test", "FOUNDER_LOCAL");
    return store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: base.implementer.identity, reviewer: base.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  };
  const runner = (extra: Partial<RunnerOptions> = {}) => new MissionRunner({executionGate: testExecutionGate(), store, dataDir, globalStopFile: path.join(runtime, "GLOBAL_STOP.json"), envPolicyFile: ENV_POLICY, executors: base, retryBackoffMs: [0, 0], leaseTtlMs: 60_000, security: fakeSecurity(path.join(root, "sec")).options, ...extra});
  return {store, dataDir, base, mkRun, runner, status: (id: string) => store.engineGetRun(id)!.status};
}
const journal = (dataDir: string): Array<{type: string; payload: Record<string, unknown>}> => fs.readFileSync(path.join(dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const wrapImplementer = (base: ExecutorPair, implement: ExecutorPair["implementer"]["implement"]): ExecutorPair => ({...base, implementer: {...base.implementer, implement}});

describe("C-PAR-1 PAR-03: synchronous git in one run must not starve another run's lease heartbeat (cap 2)", () => {
  it("run A's slow git clone (3 s, TTL 2 s) leaves run B (long async implementer call) unfenced: no abort, no re-run", { timeout: 90_000 }, async () => {
    const TTL = 2000, BLOCK = 3000;
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B");
    const calls = {A: 0, B: 0, Baborted: 0};
    const pair = wrapImplementer(c.base, async (w, spec, ctx) => {
      if (spec.title === "A") { calls.A += 1; return c.base.implementer.implement(w, spec, ctx); }
      calls.B += 1;
      if (calls.B === 1) { // run B: uzun ücretli çağrı (eşzamansız); ctx.shouldAbort'u runProcess gibi yoklar
        const startedAt = new Date().toISOString();
        for (const until = Date.now() + BLOCK + TTL; Date.now() < until;) {
          await sleep(100);
          if (ctx.shouldAbort?.()) { calls.Baborted += 1; return {exitCode: null, log: "aborted", argv: ["fake-long"], startedAt, endedAt: new Date().toISOString(), timedOut: false, aborted: true, transient: false}; }
        }
      }
      return c.base.implementer.implement(w, spec, ctx);
    });
    slow.rule = {ms: BLOCK, match: (cwd, args) => cwd.includes(A.runId) && args.includes("clone") && args.some(a => a.endsWith("scan-c0"))}; // A'nın VERIFY tarama klonu
    const rep = await c.runner({maxConcurrentRuns: 2, leaseTtlMs: TTL, executors: pair}).tick();
    expect(slow.hits.sync + slow.hits.async, "the slow-git scenario really fired once").toBe(1);
    expect(rep.claimed.sort()).toEqual([A.runId, B.runId].sort());
    expect(rep.fenced).toEqual([]);
    expect(calls.B).toBe(1);
    expect(calls.Baborted).toBe(0);
    expect([c.status(A.runId), c.status(B.runId)]).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  });

  it("span() renews EVERY owned lease before and after a synchronous span (throttled to TTL/10, so the journal does not balloon)", { timeout: 60_000 }, async () => {
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B"), clock = {t: Date.now()};
    const mr = c.runner({maxConcurrentRuns: 2, maxStepsPerTick: 0, now: () => clock.t}); // 60 s TTL: throttle window 6 s
    expect((await mr.tick()).claimed).toHaveLength(2); // both LEASED and still owned; no step ran
    const renews = () => [A, B].map(r => journal(c.dataDir).filter(e => e.type === "RUN_LEASE" && e.payload.runId === r.runId && e.payload.kind === "RENEW").length);
    const span = (mr as unknown as {span<T>(fn: () => T): T}).span.bind(mr);
    const base = renews();
    span(() => 1);
    expect(renews(), "just renewed: throttled").toEqual(base);
    clock.t += 7000;
    expect(span(() => { clock.t += 7000; return "ok"; })).toBe("ok");
    expect(renews(), "one renewal before and one after the span, for each run").toEqual(base.map(n => n + 2));
  });

  it("the real event-loop monitor sees a recent stall even after a long healthy period (a single stall must not be buried in a long window)", { timeout: 60_000 }, async () => {
    const c = setup(), mr = c.runner({leaseTtlMs: 1500}); // TTL/6 = 250 ms
    const m = mr as unknown as {startLoopMonitor(): void; stopLoopMonitor(): void; loopStalled(): boolean};
    m.startLoopMonitor();
    try {
      await sleep(3200); // ~160 healthy samples: one outlier sample would sit above the 99th percentile of a window this long
      expect(m.loopStalled()).toBe(false);
      await sleep(60); // perf_hooks drops the first sample after reset(); let a normal one establish the baseline so the stall below is the second
      for (const until = Date.now() + 700; Date.now() < until;) { /* senkron iş: olay döngüsü 700 ms bloklanır */ }
      await sleep(100);
      expect(m.loopStalled()).toBe(true);
    } finally { m.stopLoopMonitor(); }
  });

  it("a stalled event loop (p99 > TTL/6) blocks claiming a SECOND run, never the first; a healthy loop claims both", { timeout: 60_000 }, async () => {
    for (const [stallMs, claimed] of [[10_000, 1], [0, 2]] as const) {
      const c = setup(`stall${stallMs}`); const runs = [c.mkRun("A"), c.mkRun("B")];
      const rep = await c.runner({maxConcurrentRuns: 2, leaseTtlMs: 6000, loopDelayP99Ms: () => stallMs, maxStepsPerTick: 0}).tick();
      expect([stallMs, rep.claimed.length, rep.deferred.length]).toEqual([stallMs, claimed, 2 - claimed]);
      if (claimed === 1) expect(rep.deferred).toEqual([runs[1].runId]);
    }
  });
});

describe("C-PAR-1 follow-up: a reviewer that cannot start for a reason the Founder can fix BLOCKS the run (like a missing sign-in), it does not FAIL it", () => {
  it("CLI missing / .cmd shim / unverified, changed or vanished launcher / expired sign-in -> BLOCKED with the exact code; a review that is invalid for its own reasons stays FAILED", { timeout: 180_000 }, async () => {
    const rows: Array<[string, "BLOCKED" | "FAILED"]> = [["CLAUDE_PROFILE_LOGIN_REQUIRED", "BLOCKED"], ["CLAUDE_PROFILE_LOGIN_EXPIRED", "BLOCKED"], ["CLAUDE_CLI_NOT_FOUND", "BLOCKED"], ["CLAUDE_CLI_SHIM_UNSUPPORTED", "BLOCKED"],
      ["PROVIDER_PROVENANCE_NOT_READY", "BLOCKED"], ["CLAUDE_PACKAGE_PROVENANCE_REQUIRED", "BLOCKED"], ["CLAUDE_LAUNCHER_PROVENANCE_CHANGED", "BLOCKED"], ["REVIEW_WORKSPACE_MODIFIED", "FAILED"], ["REVIEW_FAILED", "FAILED"]];
    for (const [i, [code, want]] of rows.entries()) {
      const c = setup(`rb${i}`), run = c.mkRun("A"), at = new Date().toISOString();
      const pair: ExecutorPair = {...c.base, reviewer: {...c.base.reviewer, review: async () => ({verdict: "BLOCKED", findings: [], valid: false, invalidReason: code, exitCode: null, log: "x", argv: [], startedAt: at, endedAt: at, timedOut: false, aborted: false, transient: false})}};
      await c.runner({executors: pair}).tick();
      const after = c.store.engineGetRun(run.runId)!;
      expect([code, after.status, after.reason, after.step]).toEqual([code, want, code, "REVIEW"]);
    }
  });
});

describe("C-PAR-1 PAR-05: the tick must not be gang-scheduled (a slot freed by a fast run is refilled while a slow run is still in flight)", () => {
  it("cap 2, production tick interval: C's implement starts within one tick (2 s) of A reaching AWAITING_APPROVAL while B is still in IMPLEMENT", { timeout: 120_000 }, async () => {
    const SLOW = 8000;
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B"), C = c.mkRun("C");
    const t0 = Date.now(), at: Record<string, number> = {}, mark = (k: string) => { at[k] ??= Date.now() - t0; };
    const pair = wrapImplementer(c.base, async (w, spec, ctx) => {
      mark(`start${spec.title}`);
      if (spec.title === "B") await sleep(SLOW);
      try { return await c.base.implementer.implement(w, spec, ctx); } finally { mark(`end${spec.title}`); }
    });
    const mr = c.runner({maxConcurrentRuns: 2, executors: pair});
    mr.start(); // üretim varsayılanı: 2000 ms
    const ids: Record<string, string> = {A: A.runId, B: B.runId, C: C.runId};
    try {
      for (const deadline = Date.now() + 100_000; Date.now() < deadline;) {
        for (const [t, id] of Object.entries(ids)) if (c.status(id) === "AWAITING_APPROVAL") mark(`done${t}`);
        if (Object.keys(ids).every(t => at[`done${t}`] !== undefined)) break;
        await sleep(50);
      }
    } finally { mr.stop(); }
    expect(Object.keys(ids).map(t => c.status(ids[t]))).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
    expect(at.startC - at.doneA, JSON.stringify(at)).toBeLessThanOrEqual(2000);
    expect(at.startC, JSON.stringify(at)).toBeLessThan(at.endB);
  });
});

describe("C-PAR-1 PAR-04: after an engine crash the implementer child must not keep writing into runs/<id>/work", () => {
  const ORPHAN_MS = 8000, TTL = 1500;
  const spawnEngine = (dir: string, phase: "1" | "2") => {
    const child = cp.spawn(process.execPath, ["--import", "tsx", ENGINE, REPO, dir, phase, String(TTL), String(ORPHAN_MS)], {cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
    let out = "", err = "";
    child.stdout.on("data", d => { out += String(d); }); child.stderr.on("data", d => { err += String(d); });
    const closed = new Promise<number | null>(r => child.on("close", code => r(code)));
    return {child, closed, text: () => ({out, err})};
  };
  const waitFor = async (pred: () => boolean, ms: number) => { for (const until = Date.now() + ms; Date.now() < until;) { if (pred()) return true; await sleep(50); } return false; };

  it("a surviving implementer child is stopped at takeover: ORPHAN.txt absent, work HEAD == run.headSha, run completes", { timeout: 180_000 }, async () => {
    const dir = path.join(tmp, "engine"); fs.mkdirSync(dir);
    const e1 = spawnEngine(dir, "1");
    expect(await waitFor(() => fs.existsSync(path.join(dir, "implementing.json")), 120_000), JSON.stringify(e1.text())).toBe(true);
    const { runId } = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as {runId: string};
    const ownerFile = path.join(dir, "data", "runs", runId, "workspace.owner.json");
    // //TR: düzeltilmiş motorda sahiplik kaydı çocuğun grubunu taşır (Linux dışında kimlik belirteci eşzamansız eklenir); düzeltme öncesi motorda kayıt hiç yoktur ve bekleme süresi dolar.
    await waitFor(() => { try { const o = JSON.parse(fs.readFileSync(ownerFile, "utf8")); return o.childPgid != null && (process.platform === "linux" || o.childStart != null); } catch { return false; } }, 10_000);
    const killedAt = Date.now();
    e1.child.kill("SIGKILL"); await e1.closed;
    const e2 = spawnEngine(dir, "2");
    expect(await e2.closed, JSON.stringify(e2.text())).toBe(0);
    const rep = JSON.parse(e2.text().out.trim().split("\n").pop()!) as {recovered: string[]};
    expect(rep.recovered).toEqual([runId]);
    await sleep(Math.max(0, killedAt + ORPHAN_MS + 2000 - Date.now())); // yetim çocuk (hâlâ yaşıyorsa) uyanıp yazmış olurdu
    const run = new WorkOsStore(path.join(dir, "data")).engineGetRun(runId)!;
    const work = path.join(dir, "data", "runs", runId, "work");
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(fs.existsSync(path.join(work, "ORPHAN.txt"))).toBe(false);
    expect(git(work, ["log", "--format=%s"]).split("\n")).not.toContain("orphan commit");
    expect(git(work, ["rev-parse", "HEAD"])).toBe(run.headSha);
  });

  it("guardWorkspace fences a mutation when the owner record is missing, unreadable or belongs to another lease", () => {
    const c = setup(); const r = c.mkRun("A"), mr = c.runner(), run = c.store.engineGetRun(r.runId)!;
    const guard = (lease: string) => (mr as unknown as {guardWorkspace(run: unknown, leaseId: string): void}).guardWorkspace(run, lease);
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    expect(() => guard("lse_a")).toThrow(/WORKOS_LEASE_FENCED/); // no record
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({leaseId: "lse_a", engineId: "e", hostname: os.hostname(), pid: process.pid, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString()}));
    expect(() => guard("lse_a")).not.toThrow();
    expect(() => guard("lse_b")).toThrow(/WORKOS_LEASE_FENCED/); // another engine's lease
    fs.writeFileSync(file, "{not json");
    expect(() => guard("lse_a")).toThrow(/WORKOS_LEASE_FENCED/); // unreadable: fail closed
  });

  it("VERIFY refuses a workspace whose HEAD is not the recorded headSha (WORKSPACE_DIVERGED) instead of silently repairing it", { timeout: 90_000 }, async () => {
    const c = setup(); const r = c.mkRun("A");
    const mr = c.runner({maxStepsPerTick: 2}); // WORKSPACE + IMPLEMENT only
    await mr.tick();
    expect(c.store.engineGetRun(r.runId)!.step).toBe("VERIFY");
    const work = path.join(c.dataDir, "runs", r.runId, "work");
    git(work, ["-c", "user.name=X", "-c", "user.email=x@x.invalid", "commit", "-q", "--allow-empty", "-m", "behind the engine's back"]);
    await mr.tick();
    const after = c.store.engineGetRun(r.runId)!;
    expect([after.status, after.reason]).toEqual(["FAILED", "WORKSPACE_DIVERGED"]);
  });

  it("takeover is fail-closed when the previous writer cannot be established, and never signals a process whose identity does not match", { timeout: 120_000 }, async () => {
    const c = setup();
    const crashed = async (patch: Record<string, unknown>) => {
      const r = c.mkRun(`R${Math.random()}`);
      const first = c.runner({leaseTtlMs: 300, maxStepsPerTick: 0, executors: c.base});
      expect((await first.tick()).claimed).toEqual([r.runId]); // LEASED, hiçbir adım çalışmadı
      const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file, JSON.stringify({leaseId: "lse_gone", engineId: "engine_gone", hostname: os.hostname(), pid: 1, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString(), ...patch}));
      await sleep(450); // lease süresi doldu
      const rep = await c.runner({executors: c.base}).tick(); // generous TTL: only the first runner's lease (300 ms) must expire; the takeover runner runs a whole pipeline and must not fence itself under CPU load
      expect(rep.recovered).toEqual([r.runId]);
      const run = c.store.engineGetRun(r.runId)!;
      return {run, note: run.evidence.find(e => e.kind === "RECOVERY")?.note ?? ""};
    };
    const decoy = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore", windowsHide: true, ...(process.platform === "win32" ? {} : {detached: true})});
    const alive = () => { try { process.kill(decoy.pid!, 0); return true; } catch { return false; } };
    try {
      let x = await crashed({childPgid: 4242424, childStart: "1", hostname: "other-host.invalid"});
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(x.note).toMatch(/writer group 4242424 belongs to host other-host\.invalid/);
      x = await crashed({childPgid: null, step: "IMPLEMENT", leaseId: "lse_gone"}); // kayıtlı çocuk yok: devir serbest
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      x = await crashed({childPgid: decoy.pid, childStart: "not-the-start-time-of-this-process"}); // pid yeniden kullanılmış: ASLA sinyal gönderilmez
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/was reused by another process/);
      expect(alive()).toBe(true);
      x = await crashed({childPgid: decoy.pid, childStart: null}); // canlı grup, kimlik kanıtlanamıyor: fail-closed, öldürülmez
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(x.note).toMatch(/identity cannot be proven/);
      expect(alive()).toBe(true);
    } finally { try { if (process.platform === "win32") decoy.kill(); else process.kill(-decoy.pid!, "SIGKILL"); } catch { /* zaten bitmiş */ } }
  });
});
