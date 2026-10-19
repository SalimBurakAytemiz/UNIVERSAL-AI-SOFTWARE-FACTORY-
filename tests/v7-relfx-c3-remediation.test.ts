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
