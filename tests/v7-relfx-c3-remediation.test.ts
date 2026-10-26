// //TR: Bu test REL-FX cycle-3 düzeltmelerini doğrular (RV-RELFX-C2-001..004): zincirli devre dışı bırakma biçimleri (it.skip.each(t)(, describe.skip.each, test.only.each, xit.each) ve node:test seçenek kısaltması { skip } / { todo } / { only } ile adsız test({ skip: true }, fn) mevcut testte BLOCKED/SKIP_OR_ONLY_ADDED verir; koşucu stdout/stderr'i akış kuralına göre ayrı okunur, stderr'e basılan sahte özet gerçeğini ezemez, çelişkili özet UNKNOWN olur; vitest passWithNoTests "Tests  no tests" çıktısı 0 yürütme (UNVERIFIED_VACUOUS) sayılır; vite.config.* ve package.json jest/mocha/ava anahtarları test harness yüzeyidir. Testler yalnız sentetik çıktı dizeleri, repodaki vitest ve UASCO tarafından yazılmış fixture'ları kullanır (güvenilmeyen/AI üretimi kod çalıştırılmaz).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {FakeExecutors} from "../core/workos/executors.js";
import {disabledTestMarkers, evaluateTestSurface, parseTestRunStreams, parseTestRunSummary} from "../core/workos/test-surface.js";
import type {NameStatusEntry} from "../core/workos/test-surface.js";
import {REPO, T, drive, okScript, rmTmp, runner, setup, startRun, tmpRoot} from "./support/relfx.js";
import {testExecutionGate} from "./support/test-sandbox.js";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {WorkOsStore} from "../core/workos/store.js";
import {MissionRunner, repositoryHead, repositoryHeadAsync} from "../core/workos/runner.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import type {RunnerOptions, RepositoryHead} from "../core/workos/runner.js";
import type {ExecutorPair} from "../core/workos/executors.js";
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

// //TR: C-PAR-1 (test birleştirme): MissionRunner maxConcurrentRuns >= 2 güvenliği (PAR-03/04/05) ve #218 depo-HEAD probunun eşzamansız sürücüsü testleri kayıtlı bir dosyaya taşındı (yeni test dosyası config/validation.json kaydı gerektirirdi). Blok kendi tmp/REPO/yardımcılarını tanımlar (dosyanın aynı adlı tanımlarını gölgeler); child_process casusları yalnız bu bloğun testlerinde kurulur ve geri alınır (modül mock'u kullanılmaz). tests/v7-par-engine.mts vitest dosyası DEĞİL, PAR-04 testinin çalıştırdığı yardımcıdır.
describe("LANE-C parallel runs: C-PAR-1 (+ #218 head probe)", () => {
// //TR: "Yavaş git" modeli: eşleşen git çağrısı senkron spawnSync ile gelirse olay döngüsü BLOKLANIR (düzeltme öncesi runner), eşzamansız execFile ile gelirse yalnız sonucu gecikir (düzeltme sonrası runner). Gecikme süresi her iki yolda aynıdır; deterministik, shim/PATH gerekmez, Windows'ta da çalışır.
// //TR: C-PAR-1 (test birleştirme): modül mock'u (vi.mock) dosya genelindedir ve başka testlerin child_process'ini etkilerdi. Bu yüzden kaynakların kullandığı VARSAYILAN dışa aktarım nesnesinde (git-isolation.mjs ve runner.ts `import cp ...; cp.spawnSync/cp.execFile` ile çağırır) vi.spyOn kullanılır; casus yalnız bu dosyanın testlerinde kurulur ve her testten sonra geri alınır.
const slow = {rule: null as null | {ms: number; match: (cwd: string, args: string[]) => boolean}, hits: {sync: 0, async: 0}};
const realSpawnSync = cp.spawnSync, realExecFile = cp.execFile as (...x: unknown[]) => unknown;
const isSlow = (cmd: unknown, args: unknown, opts: unknown) => cmd === "git" && slow.rule !== null && slow.rule.match(String((opts as {cwd?: unknown} | undefined)?.cwd ?? ""), Array.isArray(args) ? args.map(String) : []);
function installSlowGit() {
  vi.spyOn(cp, "spawnSync").mockImplementation(((...a: Parameters<typeof cp.spawnSync>) => {
    if (isSlow(a[0], a[1], a[2])) { slow.hits.sync += 1; for (const until = Date.now() + slow.rule!.ms; Date.now() < until;) { /* senkron git: olay döngüsü bloklanır */ } }
    return realSpawnSync(...a);
  }) as typeof cp.spawnSync);
  vi.spyOn(cp, "execFile").mockImplementation(((...a: unknown[]) => {
    const [cmd, args, opts, cb] = a as [string, string[], unknown, ((...r: unknown[]) => void) | undefined];
    if (typeof cb === "function" && isSlow(cmd, args, opts)) {
      slow.hits.async += 1; const ms = slow.rule!.ms;
      return realExecFile(cmd, args, opts, (...r: unknown[]) => { setTimeout(() => cb(...r), ms); });
    }
    return realExecFile(...a);
  }) as typeof cp.execFile);
}

const REPO = path.resolve(import.meta.dirname, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const ENGINE = path.join(REPO, "tests", "v7-par-engine.mts");
const TEST_SCRIPT = `import fs from "node:fs";\nprocess.exit(fs.existsSync("feature.txt") ? 0 : 1);\n`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const git = (cwd: string, args: string[]) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return String(r.stdout).trim(); };

let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-par-")); slow.rule = null; slow.hits = {sync: 0, async: 0}; installSlowGit(); });
afterEach(() => { slow.rule = null; vi.restoreAllMocks(); try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: kapanan süreçler dosyayı kısa süre tutabilir */ } });

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
  return {store, dataDir, base, repo, mkRun, runner, status: (id: string) => store.engineGetRun(id)!.status};
}
const journal = (dataDir: string): Array<{type: string; payload: Record<string, unknown>}> => fs.readFileSync(path.join(dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const wrapImplementer = (base: ExecutorPair, implement: ExecutorPair["implementer"]["implement"]): ExecutorPair => ({...base, implementer: {...base.implementer, implement}});

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
});
