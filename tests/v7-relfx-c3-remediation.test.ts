// //TR: Bu test REL-FX cycle-3 düzeltmelerini doğrular (RV-RELFX-C2-001..004): zincirli devre dışı bırakma biçimleri (it.skip.each(t)(, describe.skip.each, test.only.each, xit.each) ve node:test seçenek kısaltması { skip } / { todo } / { only } ile adsız test({ skip: true }, fn) mevcut testte BLOCKED/SKIP_OR_ONLY_ADDED verir; koşucu stdout/stderr'i akış kuralına göre ayrı okunur, stderr'e basılan sahte özet gerçeğini ezemez, çelişkili özet UNKNOWN olur; vitest passWithNoTests "Tests  no tests" çıktısı 0 yürütme (UNVERIFIED_VACUOUS) sayılır; vite.config.* ve package.json jest/mocha/ava anahtarları test harness yüzeyidir. Testler yalnız sentetik çıktı dizeleri, repodaki vitest ve UASCO tarafından yazılmış fixture'ları kullanır (güvenilmeyen/AI üretimi kod çalıştırılmaz).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {EditOnlyImplementer, FakeExecutors} from "../core/workos/executors.js";
import type {ExecutorPair} from "../core/workos/executors.js";
import {disabledTestMarkers, evaluateTestSurface, parseTestRunStreams, parseTestRunSummary} from "../core/workos/test-surface.js";
import type {NameStatusEntry} from "../core/workos/test-surface.js";
import {REPO, T, drive, okScript, rmTmp, runner, setup, startRun, tmpRoot} from "./support/relfx.js";
import {repositoryHead, repositoryHeadAsync} from "../core/workos/runner.js";
import type {RepositoryHead} from "../core/workos/runner.js";
import {ENV_POLICY, REPO as PAR_REPO, git, groupLive, journal, parHarness, procAlive, setup as parSetup, slow, sleep, waitUntil, wrapImplementer} from "./support/par.js";
import cp from "node:child_process";
import os from "node:os";

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-relfxc3-"); });
afterEach(() => rmTmp(tmp));

const E = "\u001b";
const ev = (entries: NameStatusEntry[], content: Record<string, string | null>, executedTests: number | null = 3) =>
  evaluateTestSurface({baseSha: "B", headSha: "H", entries, contentAt: (ref, p) => content[`${ref}:${p}`] ?? null, executedTests});
const surfaceOf = (run: {evidence: {kind: string; testSurface?: unknown}[]}) => run.evidence.filter(e => e.kind === "TEST_SURFACE").at(-1)?.testSurface as any;

// Repodaki vitest'i (node_modules/vitest) UASCO tarafından yazılmış bir fixture dizininde çalıştırır; üst vitest'in VITEST* ortamı çocuğa geçirilmez.
function runRepoVitest(dir: string, args: string[] = []): {stdout: string; stderr: string; status: number | null} {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(?:VITEST|TEST$|NODE_OPTIONS$|NODE_ENV$)/.test(k)) env[k] = v;
  const r = spawnSync(process.execPath, [path.join(REPO, "node_modules", "vitest", "vitest.mjs"), "run", "--root", dir, ...args], {cwd: dir, env, encoding: "utf8", timeout: 120_000, windowsHide: true});
  return {stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), status: r.status};
}
function fixtureDir(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name); fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, "vitest.config.mjs"), "export default {};\n");
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
  return dir;
}

describe("RV-RELFX-C2-001 chained and shorthand disabled-test detection", () => {
  const JS_BASE = `const table = [[1, 1], [2, 2]];\ndescribe("s", () => {\n  it.each(table)("a %i", (x, y) => { expect(x).toBe(y); });\n  test("b", () => { expect(2).toBe(2); });\n  describe.each(table)("g %i", (x) => { it("c", () => { expect(x).toBeGreaterThan(0); }); });\n});\n`;
  const cases: [string, string][] = [
    ["it.skip.each(table)(...) on an existing parametrized test", JS_BASE.replace(`it.each(table)("a %i"`, `it.skip.each(table)("a %i"`)],
    ["describe.skip.each(table)(...)", JS_BASE.replace(`describe.each(table)("g %i"`, `describe.skip.each(table)("g %i"`)],
    ["test.only.each(table)(...)", JS_BASE.replace(`it.each(table)("a %i"`, `test.only.each(table)("a %i"`)],
    ["it.concurrent.skip(...)", JS_BASE.replace(`test("b"`, `it.concurrent.skip("b"`)],
    ["xit.each(table)(...)", JS_BASE.replace(`it.each(table)("a %i"`, `xit.each(table)("a %i"`)],
    ["node:test shorthand test('b', { skip }, fn)", JS_BASE.replace(`test("b", () =>`, `test("b", { skip }, () =>`)],
    ["node:test shorthand { todo }", JS_BASE.replace(`test("b", () =>`, `test("b", { timeout: 5, todo }, () =>`)],
    ["node:test shorthand { only }", JS_BASE.replace(`test("b", () =>`, `test('b', {only}, () =>`)],
    ["nameless test({ skip: true }, fn)", JS_BASE.replace(`test("b", () =>`, `test({ skip: true }, () =>`)],
    ["nameless test({ skip }, fn)", JS_BASE.replace(`test("b", () =>`, `test({ skip }, () =>`)],
    ["nameless it({ todo: 'later' }, fn)", JS_BASE.replace(`test("b", () =>`, `it({ todo: "later" }, () =>`)],
    ["quoted key test('b', {\"skip\": true}, fn)", JS_BASE.replace(`test("b", () =>`, `test("b", {"skip": true}, () =>`)]
  ];
  for (const [name, after] of cases) {
    it(`${name} -> BLOCKED / SKIP_OR_ONLY_ADDED`, () => {
      expect(after).not.toBe(JS_BASE);
      expect(disabledTestMarkers(after)).toBeGreaterThan(disabledTestMarkers(JS_BASE));
      const r = ev([{status: "MODIFIED", path: "tests/s.test.ts"}], {"B:tests/s.test.ts": JS_BASE, "H:tests/s.test.ts": after});
      expect(r).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED", weakened: [expect.objectContaining({path: "tests/s.test.ts", reason: "SKIP_OR_ONLY_ADDED"})]}));
    });
  }
  it("negatives: each without modifier, {skip: false}, skip as a value, pagination shorthand outside a test call, .skipped( are not markers", () => {
    expect(disabledTestMarkers(JS_BASE)).toBe(0);
    expect(disabledTestMarkers(`test({ skip: false }, () => {});`)).toBe(0);
    expect(disabledTestMarkers(`test("b", { timeout: skip }, () => {});`)).toBe(0);
    expect(disabledTestMarkers(`const rows = await db.user.findMany({ skip, take });`)).toBe(0);
    expect(disabledTestMarkers(`results.skipped(1); queue.onlyOnce(2);`)).toBe(0);
    const after = JS_BASE.replace(`test("b", () => {`, `test("b", () => { const rows = page({ skip, take });`);
    expect(ev([{status: "MODIFIED", path: "tests/s.test.ts"}], {"B:tests/s.test.ts": JS_BASE, "H:tests/s.test.ts": after}).functionalAcceptance).toBe("UNVERIFIED_ORACLE");
  });
});

describe("RV-RELFX-C2-002 stream-aware summary parsing", () => {
  const REAL_STDOUT = `\n ${E}[46m RUN ${E}[49m v4.1.11 /tmp/x\n\n${E}[2m Test Files ${E}[22m ${E}[33m1 skipped${E}[39m${E}[90m (1)${E}[39m\n${E}[2m      Tests ${E}[22m ${E}[33m1 skipped${E}[39m${E}[90m (1)${E}[39m\n${E}[2m   Start at ${E}[22m 12:14:35\n`;
  const FAKE_STDERR = "      Tests  99 passed (99)\n";
  it("synthetic: a fake summary on stderr cannot override the real stdout summary", () => {
    expect(parseTestRunStreams(REAL_STDOUT, FAKE_STDERR)).toEqual({format: "vitest", executed: 0, passed: 0, failed: 0, skipped: 1, todo: 0});
    // the old concatenation is no longer trusted: two different single-runner summaries conflict -> null (UNKNOWN), never 99
    expect(parseTestRunSummary(`${REAL_STDOUT}\n${FAKE_STDERR}`)).toBeNull();
  });
  it("synthetic: conflicts and wrong-stream summaries are UNKNOWN (null), never counted", () => {
    // test code printed a fake summary to stdout before the real one -> conflict
    expect(parseTestRunStreams(`      Tests  50 passed (50)\n${REAL_STDOUT}`, "")).toBeNull();
    // vitest summary only on stderr (wrong stream) -> unrecognized
    expect(parseTestRunStreams("feature=ok\n", FAKE_STDERR)).toBeNull();
    // jest summary belongs to stderr; on stdout it is ignored
    expect(parseTestRunStreams("Tests:       5 passed, 5 total\n", "")).toBeNull();
    expect(parseTestRunStreams("", "Tests:       1 skipped, 4 passed, 5 total\n")).toEqual({format: "jest", executed: 4, passed: 4, failed: 0, skipped: 1, todo: 0});
    // two streams disagree -> null; stdout unreadable vitest + stderr jest -> null (no fallback to the other stream)
    expect(parseTestRunStreams("      Tests  2 passed (2)\n", "Tests:       5 passed, 5 total\n")).toBeNull();
    expect(parseTestRunStreams("      Tests  2 weird (2)\n", "Tests:       5 passed, 5 total\n")).toBeNull();
    // node:test TAP diagnostic printed by a test conflicts with the runner's own counter
    expect(parseTestRunStreams("# pass 9\n# tests 1\n# pass 0\n# skipped 1\n", "")).toBeNull();
    // the same real summary on both streams is accepted; vitest's "No test files found" on stderr is read as 0 executed
    expect(parseTestRunStreams("", `No test files found, exiting with code 1\n`)).toEqual({format: "vitest", executed: 0, passed: 0, failed: 0, skipped: 0, todo: 0});
    expect(parseTestRunStreams("  3 passing (10ms)\n  1 pending\n", "")).toEqual({format: "mocha", executed: 3, passed: 3, failed: 0, skipped: 1, todo: 0});
  });
  it("reproduced with the repo's own vitest and a UASCO-authored fixture that writes a fake summary to stderr", { timeout: T }, () => {
    const dir = fixtureDir("fake-stderr", {"fake.test.ts": `// UASCO-authored fixture: prints a fake runner summary to stderr; the only real test is skipped.\nimport {it} from "vitest";\nprocess.stderr.write("      Tests  99 passed (99)\\n");\nit.skip("real", () => {});\n`});
    const r = runRepoVitest(dir);
    expect(r.stderr).toContain("Tests  99 passed (99)");
    expect(parseTestRunStreams(r.stdout, r.stderr)).toEqual({format: "vitest", executed: 0, passed: 0, failed: 0, skipped: 1, todo: 0});
    expect(parseTestRunSummary(`${r.stdout}\n${r.stderr}`)?.executed ?? null).not.toBe(99);
  });
  it("runner VERIFY: a UASCO-authored test command that prints a fake summary to stderr is not counted as executed", { timeout: T }, async () => {
    const script = `console.log("      Tests  1 skipped (1)");\nconsole.error("      Tests  42 passed (42)");\nprocess.exit(0);\n`;
    const c = setup(tmp, "tA", {files: {"run-tests.mjs": script, "README.txt": "base\n", "tests/a.test.mjs": "export const x = 1;\n"}, testCommand: ["node", "run-tests.mjs"]});
    const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n", "tests/a.test.mjs": "export const x = 2;\n"}})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake), created.runId);
    expect(surfaceOf(run)).toEqual(expect.objectContaining({modified: ["tests/a.test.mjs"], executedTests: 0, functionalAcceptance: "UNVERIFIED_VACUOUS", reason: "ZERO_TESTS_EXECUTED"}));
  });
});

describe("RV-RELFX-C2-003 vitest passWithNoTests 'Tests  no tests'", () => {
  it("captured output -> vitest summary with 0 executed -> UNVERIFIED_VACUOUS(ZERO_TESTS_EXECUTED)", () => {
    // captured from the repo's vitest 4.1.11 (--passWithNoTests, UASCO-authored fixture with an empty describe), ANSI colours as on a TTY
    const captured = `\n ${E}[46m RUN ${E}[49m v4.1.11 /tmp/vt-notests\n\n\n${E}[2m Test Files ${E}[22m ${E}[32m1 passed${E}[39m${E}[90m (1)${E}[39m\n${E}[2m      Tests ${E}[22m no tests\n${E}[2m   Start at ${E}[22m 12:14:18\n${E}[2m   Duration ${E}[22m 201ms\n\n`;
    const s = parseTestRunStreams(captured, "");
    expect(s).toEqual({format: "vitest", executed: 0, passed: 0, failed: 0, skipped: 0, todo: 0});
    const touched: NameStatusEntry[] = [{status: "MODIFIED", path: "tests/a.test.ts"}];
    expect(ev(touched, {"B:tests/a.test.ts": "expect(1);", "H:tests/a.test.ts": "expect(1); expect(2);"}, s?.executed ?? null)).toEqual(expect.objectContaining({functionalAcceptance: "UNVERIFIED_VACUOUS", reason: "ZERO_TESTS_EXECUTED"}));
  });
  it("live: the repo's own vitest with --passWithNoTests on a UASCO-authored empty fixture", { timeout: T }, () => {
    const dir = fixtureDir("no-tests", {"empty.test.ts": `// UASCO-authored fixture: a test file with no tests.\nimport {describe} from "vitest";\ndescribe("empty", () => {});\n`});
    const r = runRepoVitest(dir, ["--passWithNoTests"]);
    const streams = `--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
    expect(r.status, streams).toBe(0);
    // CI may colourise the summary (e.g. "Tests ESC[22m no tests"); the contract is checked on the ANSI-stripped stdout.
    const plain = String(r.stdout).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "");
    expect(plain, streams).toMatch(/Tests\s+no tests/);
    expect(parseTestRunStreams(r.stdout, r.stderr), streams).toEqual({format: "vitest", executed: 0, passed: 0, failed: 0, skipped: 0, todo: 0});
  });
});

describe("RV-RELFX-C2-004 harness detection: vite.config.* and package.json jest/mocha/ava keys", () => {
  it("vite.config.* changes are harness surface", () => {
    for (const p of ["vite.config.ts", "apps/web/vite.config.mjs", "vite.config.mts"]) {
      expect(ev([{status: "MODIFIED", path: p}], {})).toEqual(expect.objectContaining({harness: [p], functionalAcceptance: "UNVERIFIED_ORACLE", reason: "TEST_SURFACE_CHANGED_NO_PINNED_ORACLE"}));
    }
  });
  it("package.json top-level jest/mocha/ava config changes are harness surface; unrelated keys are not", () => {
    const e = (p: string): NameStatusEntry[] => [{status: "MODIFIED", path: p}];
    const pkg = (extra: Record<string, unknown>) => JSON.stringify({name: "x", version: "1.0.0", scripts: {test: "jest"}, ...extra}, null, 2);
    const pairs: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ["jest", {jest: {testMatch: ["**/*.test.js"]}}, {jest: {testMatch: ["**/nothing/*.test.js"]}}],
      ["mocha", {mocha: {spec: "test/**/*.js"}}, {mocha: {spec: "test/none/*.js"}}],
      ["ava", {}, {ava: {files: ["none/**"]}}]
    ];
    for (const [key, before, after] of pairs) {
      expect(ev(e("package.json"), {"B:package.json": pkg(before), "H:package.json": pkg(after)}), key).toEqual(expect.objectContaining({harness: ["package.json"], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    }
    expect(ev(e("pkg/package.json"), {"B:pkg/package.json": pkg({jest: {a: 1}, description: "a"}), "H:pkg/package.json": pkg({jest: {a: 1}, description: "b"})})).toEqual(expect.objectContaining({harness: [], functionalAcceptance: "UNKNOWN", reason: "NO_TEST_SURFACE_CHANGE_DETECTED_NO_PINNED_ORACLE"}));
  });
});

// //TR: C-PAR-1 (test birleştirme): MissionRunner maxConcurrentRuns >= 2 iken HEARTBEAT ve PLANLAMA güvenliği (PAR-03/05), #218 depo-HEAD probunun eşzamansız sürücüsü ve #224 koordinatör incelemesinin heartbeat/planlama düzeltmeleri. Ortak parçalar tests/support/par.ts'tedir. Yazar durdurma (PAR-04) testleri tests-6'daki tests/v7-relfx-1-completion.test.ts'e konuldu (iki Windows adımı arasında bölünmüştür). Blok kendi tmp/yardımcılarını tanımlar (dosyanın aynı adlı tanımlarını gölgeler); child_process casusları yalnız bu bloğun testlerinde kurulur ve geri alınır.
describe("LANE-C parallel runs: heartbeat and scheduling (C-PAR-1 PAR-03/05, #218 head probe, #224 review)", () => {
  const par = parHarness();
  let tmp = ""; beforeEach(() => { tmp = par.tmp(); });
  const REPO = PAR_REPO;
  const setup = (name?: string, seed?: Record<string, string>, clock?: () => number) => parSetup(tmp, name, seed, clock);
describe("C-PAR-1 PAR-03: synchronous git in one run must not starve another run's lease heartbeat (cap 2)", () => {
  // //TR: Aynı senaryo iki yavaş git noktası için: A'nın VERIFY tarama klonu ve A'nın WORKSPACE adımındaki depo kökü/HEAD probu (#218 ile birleşimde eşzamansız sürücü).
  const slowGitLeavesBUnfenced = async (slowMatch: (A: {runId: string}, srcRepo: string) => (cwd: string, args: string[]) => boolean) => {
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
    slow.rule = {ms: BLOCK, match: slowMatch(A, c.repo)};
    const rep = await c.runner({maxConcurrentRuns: 2, leaseTtlMs: TTL, executors: pair}).tick();
    expect(slow.hits.sync + slow.hits.async, "the slow-git scenario really fired once").toBe(1);
    expect(rep.claimed.sort()).toEqual([A.runId, B.runId].sort());
    expect(rep.fenced).toEqual([]);
    expect(calls.B).toBe(1);
    expect(calls.Baborted).toBe(0);
    expect([c.status(A.runId), c.status(B.runId)]).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  };
  it("run A's slow git clone (3 s, TTL 2 s) leaves run B (long async implementer call) unfenced: no abort, no re-run", { timeout: 90_000 }, async () => {
    await slowGitLeavesBUnfenced(A => (cwd, args) => cwd.includes(A.runId) && args.includes("clone") && args.some(a => a.endsWith("scan-c0"))); // A'nın VERIFY tarama klonu
  });
  it("run A's slow repository HEAD probe (3 s, TTL 2 s, WORKSPACE step) leaves run B unfenced too: the probe is asynchronous", { timeout: 90_000 }, async () => {
    let fired = false; // yalnız İLK HEAD okuması yavaş (A'nınki); B'ninki ve sonraki adımlar hızlı
    await slowGitLeavesBUnfenced((_A, srcRepo) => (cwd, args) => { const hit = !fired && cwd === fs.realpathSync(srcRepo) && args.includes("HEAD^{commit}") && args.includes("HEAD"); if (hit) fired = true; return hit; });
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

// //TR: #218 (repositoryHead) + C-PAR-1 birleşimi: runner WORKSPACE adımı depo kökü/HEAD kararını artık EŞZAMANSIZ sürücüyle verir (olay döngüsünü bloklamaz); karar prosedürü (headDecision) tek yerde, iki sürücü aynı ortam izin listesini ve aynı tavanı kullanır. Bu testler iki sürücünün aynı cevabı verdiğini, host GIT_* değişkenlerinin hiçbirini görmediğini ve eşzamansız sürücünün döngüyü bloklamadığını kanıtlar.
describe("C-PAR-1 + #218: the runner's repository HEAD probe is the same decision, asynchronous", () => {
  const ID = ["-c", "user.name=Seed", "-c", "user.email=seed@local.invalid", "-c", "commit.gpgsign=false"];
  const commit = (dir: string, name = "f.txt") => { fs.writeFileSync(path.join(dir, name), `${name}\n`); git(dir, ["add", "-A"]); git(dir, [...ID, "commit", "-q", "-m", `add ${name}`]); return git(dir, ["rev-parse", "HEAD"]); };
  const repo = (dir: string, withCommit = true, file = "f.txt") => { fs.mkdirSync(dir, {recursive: true}); git(dir, ["init", "-q", "-b", "main"]); return withCommit ? commit(dir, file) : null; };
  const both = async (dir: string, opts?: {timeoutMs?: number}): Promise<[RepositoryHead, RepositoryHead]> => [repositoryHead(dir, opts), await repositoryHeadAsync(dir, opts)];
  const withEnv = async <R,>(vars: Record<string, string>, fn: () => Promise<R>): Promise<R> => {
    const saved = Object.entries(process.env);
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    try { return await fn(); } finally { for (const k of Object.keys(process.env)) delete process.env[k]; for (const [k, v] of saved) if (v !== undefined) process.env[k] = v; }
  };
  const UNRESOLVED: RepositoryHead = {ok: false, reason: "REPOSITORY_HEAD_UNRESOLVED"}, NOT_ROOT: RepositoryHead = {ok: false, reason: "REPOSITORY_NOT_WORKTREE_ROOT"};

  it("both drivers give the same verdict on every repository shape, with and without planted GIT_* variables (a decoy repository never leaks in)", { timeout: 120_000 }, async () => {
    const root = path.join(tmp, "root"), rootHead = repo(root)!;
    const unborn = path.join(tmp, "unborn"); repo(unborn, false);
    const sub = path.join(root, "pkg", "deep"); fs.mkdirSync(sub, {recursive: true});
    const bareSrc = path.join(tmp, "bare-src"); repo(bareSrc); const bare = path.join(tmp, "bare.git"); git(tmp, ["clone", "-q", "--bare", bareSrc, bare]);
    const wt = path.join(tmp, "wt"); git(root, ["worktree", "add", "-q", "-b", "wt", wt]);
    const decoy = path.join(tmp, "decoy"), decoyHead = repo(decoy, true, "decoy-only.txt")!;
    const shapes: Array<[string, string, RepositoryHead | null]> = [
      ["repo root", root, {ok: true, baseSha: rootHead}], ["unborn HEAD", unborn, UNRESOLVED], ["plain subdirectory of a repository", sub, NOT_ROOT],
      ["bare repository", bare, {ok: true, baseSha: git(bare, ["rev-parse", "HEAD"])}], ["linked worktree (gitfile)", wt, {ok: true, baseSha: rootHead}],
      ["missing path", path.join(tmp, "nope"), UNRESOLVED], ["relative spelling of the root", path.relative(process.cwd(), root), {ok: true, baseSha: rootHead}], ["a directory that is no repository", fs.mkdtempSync(path.join(tmp, "plain-")), null]
    ];
    const planted: Array<[string, Record<string, string>]> = [["clean", {}], ["GIT_DIR", {GIT_DIR: path.join(decoy, ".git")}], ["GIT_DIR + GIT_WORK_TREE", {GIT_DIR: path.join(decoy, ".git"), GIT_WORK_TREE: decoy}], ["a ceiling covering everything", {GIT_CEILING_DIRECTORIES: path.parse(tmp).root}]];
    for (const [label, dir, want] of shapes) for (const [env, vars] of planted) {
      const [syncV, asyncV] = await withEnv(vars, () => both(dir));
      expect([label, env, asyncV]).toEqual([label, env, syncV]);
      if (want) expect([label, env, asyncV]).toEqual([label, env, want]);
      else expect([label, env, asyncV.ok]).toEqual([label, env, false]);
    }
    expect(decoyHead).not.toBe(rootHead); // the decoy really has another HEAD, so a leaked GIT_DIR would have changed the verdicts above
  });

  it("the async probe is what the WORKSPACE step uses: a planted GIT_DIR in the engine's process cannot change the run's baseSha", { timeout: 90_000 }, async () => {
    const c = setup("env-gd"), decoy = path.join(tmp, "decoy2"); repo(decoy, true, "decoy-only.txt");
    const srcHead = git(c.repo, ["rev-parse", "HEAD"]);
    const A = c.mkRun("A");
    await withEnv({GIT_DIR: path.join(decoy, ".git")}, async () => { await c.runner().tick(); });
    expect(c.status(A.runId)).toBe("AWAITING_APPROVAL");
    expect(c.store.engineGetRun(A.runId)).toMatchObject({baseSha: srcHead});
  });

  it("the async driver keeps the event loop free while the probe's git calls are slow; the sync driver blocks it (same git, same delay)", { timeout: 60_000 }, async () => {
    const root = path.join(tmp, "root"); const head = repo(root)!;
    slow.rule = {ms: 300, match: (_cwd, args) => args.includes("rev-parse")};
    let ticks = 0; const timer = setInterval(() => { ticks += 1; }, 25);
    try {
      const t0 = Date.now();
      expect(await repositoryHeadAsync(root)).toEqual({ok: true, baseSha: head});
      const asyncMs = Date.now() - t0;
      expect(slow.hits.async).toBeGreaterThanOrEqual(2); // root proof (--show-toplevel) + the HEAD read
      expect(slow.hits.sync).toBe(0);
      expect(asyncMs).toBeGreaterThanOrEqual(550); // 2+ probes x 300 ms
      expect(ticks).toBeGreaterThanOrEqual(Math.floor(asyncMs / 25 / 2)); // the loop kept ticking during the whole probe
      ticks = 0; slow.hits = {sync: 0, async: 0};
      expect(repositoryHead(root)).toEqual({ok: true, baseSha: head});
      expect(slow.hits.sync).toBeGreaterThanOrEqual(2);
      expect(slow.hits.async).toBe(0);
      expect(ticks).toBe(0); // the sync driver held the loop for its whole duration
    } finally { clearInterval(timer); }
  });

  it("the deadline is shared by the whole probe in both drivers: once it is spent, the rest of the decision is refused (never a guess)", { timeout: 60_000 }, async () => {
    const root = path.join(tmp, "root"); repo(root);
    slow.rule = {ms: 300, match: (_cwd, args) => args.includes("rev-parse")};
    const [syncV, asyncV] = await both(root, {timeoutMs: 100});
    expect(asyncV).toEqual(UNRESOLVED);
    expect(syncV).toEqual(UNRESOLVED);
  });
});

// //TR: #224 koordinatör incelemesi (REVIEW-0baa72f) düzeltmelerinin testleri. Her test, düzeltilmemiş runner'da (c0259b7) BAŞARISIZ olacak biçimde yazılmıştır (yeni modüller dinamik içe aktarılır ki dosya eski kodda da yüklensin). Motor tabanlı testler tests/v7-par-engine.mts'i iki ayrı süreçte çalıştırır ve birini SIGKILL/SIGINT ile durdurur.
describe("C-PAR-1 review round 1 (#224): heartbeat and scheduling", () => {
  it("HB-1: the production implementer path (EditOnlyImplementer + engine commit) does not starve another run's lease: a slow engine commit (3 s, TTL 2 s) leaves run B unfenced", { timeout: 120_000 }, async () => {
    const TTL = 2000, BLOCK = 3000;
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B");
    const script = (delayMs: number) => `setTimeout(() => require("node:fs").writeFileSync("feature.txt", "ok\\n"), ${delayMs});`;
    // A: hemen yazar; B: uzun ücretli çağrı (eşzamansız süreç). Her ikisi de ÜRETİM yolundan geçer: EditOnlyImplementer + engine commit.
    const impl = new EditOnlyImplementer("TEST_EDIT_ONLY", ENV_POLICY, (_ws, spec) => ({argv: [process.execPath, "-e", script(spec.title === "B" ? BLOCK + TTL : 0)], env: {PATH: process.env.PATH ?? ""}, input: ""}));
    const pair: ExecutorPair = {...c.base, implementer: impl};
    let fired = false;
    slow.rule = {ms: BLOCK, match: (cwd, args) => { const hit = !fired && cwd.includes(A.runId) && args.includes("read-tree"); if (hit) fired = true; return hit; }}; // A'nın engine commit'i (indeks yeniden kurulumu)
    const rep = await c.runner({maxConcurrentRuns: 2, leaseTtlMs: TTL, executors: pair}).tick();
    expect(slow.hits.sync + slow.hits.async, "the slow engine-commit scenario really fired once").toBe(1);
    expect(rep.claimed.sort()).toEqual([A.runId, B.runId].sort());
    expect(rep.fenced).toEqual([]);
    expect([c.status(A.runId), c.status(B.runId)]).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  });

  it("HB-2: the per-file test-surface reads renew every owned lease before EACH `git show` (total 4+ s sync work, TTL 2 s, each call 0.7 s): run B stays unfenced", { timeout: 120_000 }, async () => {
    const TTL = 2000;
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B");
    const calls = {B: 0};
    const pair = wrapImplementer(c.base, async (w, spec, ctx) => {
      if (spec.title === "A") { // üç yeni test dosyası: test yüzeyi dosya başına bir `git show` okur
        return new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n", "a1.test.mjs": "// a1\n", "a2.test.mjs": "// a2\n", "a3.test.mjs": "// a3\n"}}), review: () => ({verdict: "CLEAN"})}).pair().implementer.implement(w, spec, ctx);
      }
      calls.B += 1;
      const startedAt = new Date().toISOString();
      for (const until = Date.now() + 6500; Date.now() < until;) { await sleep(100); if (ctx.shouldAbort?.()) return {exitCode: null, log: "aborted", argv: ["fake-long"], startedAt, endedAt: new Date().toISOString(), timedOut: false, aborted: true, transient: false}; }
      return c.base.implementer.implement(w, spec, ctx);
    });
    slow.rule = {ms: 700, match: (cwd, args) => cwd.includes(A.runId) && args.includes("show")};
    const rep = await c.runner({maxConcurrentRuns: 2, leaseTtlMs: TTL, executors: pair}).tick();
    expect(slow.hits.sync, "the sync `git show` loop really ran").toBeGreaterThanOrEqual(3);
    expect(rep.fenced).toEqual([]);
    expect(calls.B).toBe(1);
    expect([c.status(A.runId), c.status(B.runId)], JSON.stringify([c.store.engineGetRun(A.runId)!.reason, c.store.engineGetRun(B.runId)!.reason])).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  });

  it("HB-3: a stall right after the loop-delay window was reset is still seen (the drift sentinel does not depend on the histogram's dropped first sample)", { timeout: 60_000 }, async () => {
    const c = setup(), mr = c.runner({leaseTtlMs: 1500}) as unknown as {startLoopMonitor(): void; stopLoopMonitor(): void; sampleLoop(): void; loopStalled(): boolean};
    mr.startLoopMonitor();
    try {
      await sleep(250); // ilk örnekler kaydedildi
      expect(mr.loopStalled()).toBe(false);
      mr.sampleLoop(); // pencereyi sıfırlar: perf_hooks sıfırlama sonrası İLK örneği atar
      for (const until = Date.now() + 700; Date.now() < until;) { /* 700 ms stall, eşik 250 ms */ }
      await sleep(150);
      expect(mr.loopStalled()).toBe(true);
    } finally { mr.stopLoopMonitor(); }
  });

  it("STOP-NO-ABORT-NO-AWAIT: stop() aborts the in-flight implementer group, starts no new step, awaits the drives and leaves the run un-cancelled for the next engine", { timeout: 90_000 }, async () => {
    const c = setup(); const A = c.mkRun("A");
    const slowImpl = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}, sleepMs: 20_000}), review: () => ({verdict: "CLEAN"})});
    const mr = c.runner({executors: slowImpl.pair()});
    mr.start(250);
    const work = () => path.join(c.dataDir, "runs", A.runId, "work");
    const ownerFile = path.join(c.dataDir, "runs", A.runId, "workspace.owner.json");
    let pgid = 0;
    expect(await waitUntil(() => { try { pgid = JSON.parse(fs.readFileSync(ownerFile, "utf8")).childPgid ?? 0; return pgid > 1 && c.store.engineGetRun(A.runId)!.step === "IMPLEMENT"; } catch { return false; } }, 30_000)).toBe(true);
    const t0 = Date.now();
    const stopped = mr.stop();
    expect(stopped).toBeInstanceOf(Promise);
    await stopped;
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(procAlive(pgid), "the implementer group outlived stop()").toBe(false);
    const notCancelled = () => { const r = c.store.engineGetRun(A.runId)!; return [r.status, r.step]; };
    expect(notCancelled()).toEqual(["RUNNING", "IMPLEMENT"]); // iptal EDİLMEDİ: lease dolunca sonraki engine devralır
    await sleep(600);
    expect(notCancelled()).toEqual(["RUNNING", "IMPLEMENT"]); // yeni adım başlamadı
    expect(fs.existsSync(path.join(work(), "feature.txt"))).toBe(false);
    expect(slowImpl.calls.implement, "a new implementer was started after stop()").toBe(1);
  });

  it("TEST-PAR05-REFILL (M3): with a 10 s timer the freed slot is refilled IMMEDIATELY (C starts within 2 s of A finishing while B is still in IMPLEMENT)", { timeout: 120_000 }, async () => {
    const SLOW = 8000;
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B"), C = c.mkRun("C");
    const t0 = Date.now(), at: Record<string, number> = {}, mark = (k: string) => { at[k] ??= Date.now() - t0; };
    const pair = wrapImplementer(c.base, async (w, spec, ctx) => {
      mark(`start${spec.title}`);
      if (spec.title === "B") await sleep(SLOW);
      try { return await c.base.implementer.implement(w, spec, ctx); } finally { mark(`end${spec.title}`); }
    });
    const mr = c.runner({maxConcurrentRuns: 2, executors: pair});
    mr.start(10_000); // zamanlayıcı yavaş: yalnız iş-korumalı hemen doldurma C'yi zamanında başlatır
    (mr as unknown as {pump(freshOnly: boolean): void}).pump(false);
    const ids: Record<string, string> = {A: A.runId, B: B.runId, C: C.runId};
    try {
      for (const deadline = Date.now() + 100_000; Date.now() < deadline;) {
        for (const [t, id] of Object.entries(ids)) if (c.status(id) === "AWAITING_APPROVAL") mark(`done${t}`);
        if (at.doneA !== undefined && at.startC !== undefined) break;
        await sleep(50);
      }
    } finally { await mr.stop(); }
    expect(at.startC - at.doneA, JSON.stringify(at)).toBeLessThanOrEqual(2000);
    expect(at.startC, JSON.stringify(at)).toBeLessThan(at.endB);
  });

  it("TEST-SELF-TAKEOVER (M9): a run whose drive is still in flight is never taken over by its own engine, even after another run's synchronous stall expired its lease", { timeout: 120_000 }, async () => {
    const TTL = 1000;
    const c = setup(); const A = c.mkRun("A"), B = c.mkRun("B");
    let aInFlight = false, takeoverWhileInFlight = false, takeovers = 0, aCalls = 0;
    const takeoverCount = () => journal(c.dataDir).filter(e => e.type === "RUN_LEASE" && e.payload.runId === A.runId && e.payload.kind === "TAKEOVER").length;
    const pair = wrapImplementer(c.base, async (w, spec, ctx) => {
      if (spec.title === "B") { await sleep(400); for (const until = Date.now() + 1600; Date.now() < until;) { /* B: senkron stall > TTL */ } return c.base.implementer.implement(w, spec, ctx); }
      aInFlight = true; aCalls += 1;
      try { for (const until = Date.now() + 3500; Date.now() < until;) { await sleep(50); if (ctx.shouldAbort?.()) break; } return await c.base.implementer.implement(w, spec, ctx); } finally { aInFlight = false; }
    });
    const mr = c.runner({maxConcurrentRuns: 2, leaseTtlMs: TTL, executors: pair});
    mr.start(250);
    // //TR: bayrak YALNIZ yeni bir TAKEOVER olayı, A'nın ilk çağrısı hâlâ sürerken yazılırsa kalkar (meşru sonraki devir, A'nın çağrısı bittikten sonradır).
    const watcher = setInterval(() => { const n = takeoverCount(); if (n > takeovers) { if (aCalls === 1 && aInFlight) takeoverWhileInFlight = true; takeovers = n; } }, 20);
    try { await sleep(7000); } finally { clearInterval(watcher); await mr.stop(); }
    expect(takeoverWhileInFlight, "the engine took over a run whose own drive was still in flight").toBe(false);
  });

  it("TEST-PAR04-DEFENCES (M11): if onSpawn throws (the writer cannot be recorded) the spawned child is killed, never left unrecorded", { timeout: 60_000 }, async () => {
    const {runProcess} = await import("../core/workos/executors.js");
    let pid = 0;
    const r = await runProcess([process.execPath, "-e", "setInterval(() => {}, 1000)"], {cwd: tmp, env: {PATH: process.env.PATH ?? ""}, timeoutMs: 30_000, newSession: process.platform !== "win32", onSpawn: c => { pid = c.pid; throw new Error("cannot record"); }});
    expect(pid).toBeGreaterThan(1);
    expect(r.spawnError).toBe(true);
    expect(await waitUntil(() => !procAlive(pid), 5000), "the unrecorded child is still running").toBe(true);
  });

  it("TEST-PAR04-DEFENCES (M5): recordChild refuses a run whose owner record belongs to another lease (WORKOS_LEASE_FENCED) and leaves the record untouched", () => {
    const c = setup(), r = c.mkRun("A"), mr = c.runner(), run = c.store.engineGetRun(r.runId)!;
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const rec = JSON.stringify({leaseId: "lse_a", engineId: "e", hostname: os.hostname(), pid: process.pid, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString(), bootId: null});
    fs.writeFileSync(file, rec);
    const recordChild = (lease: string) => (mr as unknown as {recordChild(run: unknown, lease: string, c: {pid: number; pgid: number | null}): void}).recordChild(run, lease, {pid: 4242, pgid: 4242});
    expect(() => recordChild("lse_b")).toThrow(/WORKOS_LEASE_FENCED/);
    expect(fs.readFileSync(file, "utf8")).toBe(rec);
    expect(() => recordChild("lse_a")).not.toThrow();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({childPgid: 4242});
  });

  it("TEST-PAR04-DEFENCES (M10): when renewAllOwned fences run B, B's child is aborted by the `lost` flag at once, long before B's own heartbeat (TTL/3 = 20 s) could notice", { timeout: 120_000 }, async () => {
    const TTL = 60_000, clock = {t: Date.now()};
    const c = setup("m10", {}, () => clock.t); c.mkRun("A"); c.mkRun("B");
    let bAbortedAt = 0, bPolling = false;
    const pair = wrapImplementer(c.base, async (w, spec, ctx) => {
      if (spec.title === "A") { // A: senkron aralıkta (span) saat TTL'den fazla ileri gider -> renewAllOwned B'yi (ve A'yı) fence eder
        for (let i = 0; i < 200 && !bPolling; i++) await sleep(20);
        (mr as unknown as {span<T>(fn: () => T): T}).span(() => { clock.t += TTL + 5_000; });
        await sleep(300);
        return c.base.implementer.implement(w, spec, ctx);
      }
      bPolling = true;
      const startedAt = new Date().toISOString();
      for (const until = Date.now() + 8_000; Date.now() < until;) { await sleep(25); if (ctx.shouldAbort?.()) { bAbortedAt = Date.now(); return {exitCode: null, log: "aborted", argv: ["fake-long"], startedAt, endedAt: new Date().toISOString(), timedOut: false, aborted: true, transient: false}; } }
      return c.base.implementer.implement(w, spec, ctx);
    });
    const mr = c.runner({maxConcurrentRuns: 2, leaseTtlMs: TTL, now: () => clock.t, executors: pair});
    const t0 = Date.now();
    await mr.tick();
    expect(bAbortedAt, "B's child was never aborted by the lost flag").toBeGreaterThan(0);
    expect(bAbortedAt - t0).toBeLessThan(7_000); // B'nin kendi heartbeat'i (20 s) beklenseydi bu süre aşılırdı
  });
});
});
