// //TR: Bu test REL-FX cycle-2 düzeltmelerini doğrular (RV-RELFX-C1-001..004): ANSI/VT kaçışlı gerçek vitest çıktısı ve jest/mocha/node --test (TAP)/pytest/cargo/dotnet özetlerinden yalnız passed + failed yürütülmüş sayılır, skipped/todo/pending ayrı raporlanır, sıfır yürütme UNVERIFIED_VACUOUS, okunamayan çıktı UNKNOWN olur; mevcut testi devre dışı bırakan xit/xdescribe/xtest/skipIf/todo/{skip:true}/pytest ve unittest skip işaretleri BLOCKED yapar; spec/, *Spec, *_spec, *.cy.*, *.e2e-spec.* yolları ve test harness yapılandırmaları test yüzeyidir; sağlayıcı sınırı yalnız gerçek Claude CLI/işaret satırlarından sınıflanır, EDQUOT disk kotası DISK_FULL ailesidir. Testler yalnız sentetik çıktı dizeleri ve mevcut UASCO fixture'larını kullanır.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {FakeExecutors} from "../core/workos/executors.js";
import {disabledTestMarkers, evaluateTestSurface, isTestPath, parseExecutedTestCount, parseTestRunSummary, stripAnsi} from "../core/workos/test-surface.js";
import type {NameStatusEntry} from "../core/workos/test-surface.js";
import {executorLimit, providerLimit} from "../core/workos/runner.js";
import {T, drive, okScript, rmTmp, runner, setup, startRun, tmpRoot} from "./support/relfx.js";

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-relfxc2-"); });
afterEach(() => rmTmp(tmp));

const E = "\u001b";
const ev = (entries: NameStatusEntry[], content: Record<string, string | null>, executedTests: number | null = 3) =>
  evaluateTestSurface({baseSha: "B", headSha: "H", entries, contentAt: (ref, p) => content[`${ref}:${p}`] ?? null, executedTests});

describe("RV-RELFX-C1-001 executed-test count (ANSI-safe, executed = passed + failed)", () => {
  it("real ANSI vitest output (Windows, safeChildEnv) is parsed; all-skipped -> 0 executed", () => {
    const allSkipped = `${E}[2m Test Files ${E}[22m ${E}[33m1 skipped${E}[39m${E}[90m (1)${E}[39m\n${E}[2m      Tests ${E}[22m ${E}[33m2 skipped${E}[39m${E}[90m (2)${E}[39m\n${E}[2m   Start at ${E}[22m 08:00:00\n`;
    expect(parseTestRunSummary(allSkipped)).toEqual({format: "vitest", executed: 0, passed: 0, failed: 0, skipped: 2, todo: 0});
    expect(parseExecutedTestCount(allSkipped)).toBe(0);
    const mixed = `${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[1m${E}[32m3 passed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[33m2 skipped${E}[39m${E}[2m | ${E}[22m${E}[2m1 todo${E}[22m${E}[90m (7)${E}[39m\r\n`;
    expect(parseTestRunSummary(mixed)).toEqual({format: "vitest", executed: 4, passed: 3, failed: 1, skipped: 2, todo: 1});
    expect(parseExecutedTestCount("      Tests  2 skipped | 1 todo (3)")).toBe(0);
    expect(parseExecutedTestCount("      Tests  2 passed (2)")).toBe(2);
  });

  it("strips CSI, OSC (BEL and ST terminated), 8-bit CSI and CR progress rewrites", () => {
    expect(stripAnsi(`${E}]8;;file:///x${E}\\link${E}]8;;${E}\\ ${E}]0;title\u0007\u009b31mred\u009b0m a\rb${E}[?25l`)).toBe("link red a\nb");
    expect(parseExecutedTestCount(`${E}]8;;file:///t${E}\\tests${E}]8;;${E}\\\n${E}[2m      Tests ${E}[22m ${E}[32m1 passed${E}[39m${E}[90m (1)${E}[39m`)).toBe(1);
  });

  it("jest: skipped/todo are not executed", () => {
    expect(parseTestRunSummary("Tests:       2 skipped, 2 total")).toEqual({format: "jest", executed: 0, passed: 0, failed: 0, skipped: 2, todo: 0});
    expect(parseTestRunSummary("Tests:       1 failed, 2 skipped, 1 todo, 5 passed, 9 total")).toEqual({format: "jest", executed: 6, passed: 5, failed: 1, skipped: 2, todo: 1});
    expect(parseExecutedTestCount(`Tests:       ${E}[1m${E}[32m5 passed${E}[39m${E}[22m, 5 total`)).toBe(5);
    expect(parseExecutedTestCount("No tests found, exiting with code 1")).toBe(0);
  });

  it("mocha: pending is not executed", () => {
    expect(parseTestRunSummary("\n  0 passing (3ms)\n  2 pending\n")).toEqual({format: "mocha", executed: 0, passed: 0, failed: 0, skipped: 2, todo: 0});
    expect(parseTestRunSummary("  3 passing (10ms)\n  1 failing\n  2 pending\n")).toEqual({format: "mocha", executed: 4, passed: 3, failed: 1, skipped: 2, todo: 0});
  });

  it("node --test (TAP and spec reporter): only # pass + # fail are executed", () => {
    expect(parseTestRunSummary("# tests 3\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 2\n# todo 1\n# duration_ms 5.1\n")).toEqual({format: "tap", executed: 0, passed: 0, failed: 0, skipped: 2, todo: 1});
    expect(parseTestRunSummary("# tests 5\n# pass 2\n# fail 1\n# skipped 1\n# todo 1\n")).toEqual({format: "tap", executed: 3, passed: 2, failed: 1, skipped: 1, todo: 1});
    expect(parseExecutedTestCount("ℹ tests 2\nℹ suites 0\nℹ pass 0\nℹ fail 0\nℹ skipped 2\nℹ todo 0\n")).toBe(0);
    expect(parseExecutedTestCount("# tests 7\n# pass 7")).toBe(7);
    expect(parseExecutedTestCount("# tests 4\n# duration_ms 3")).toBeNull();
  });

  it("pytest summary lines: skipped/deselected not executed; xfail/xpass/error executed; unrelated 'N things in Xs' is not pytest", () => {
    expect(parseTestRunSummary("============================== 2 skipped in 0.01s ===============================")).toEqual({format: "pytest", executed: 0, passed: 0, failed: 0, skipped: 2, todo: 0});
    expect(parseTestRunSummary("==== 1 failed, 2 passed, 1 skipped, 1 xfailed, 1 error in 0.50s ====")).toEqual({format: "pytest", executed: 5, passed: 2, failed: 3, skipped: 1, todo: 0});
    expect(parseExecutedTestCount("3 passed, 1 warning in 0.12s")).toBe(3);
    expect(parseExecutedTestCount("===== 4 deselected in 0.02s =====")).toBe(0);
    expect(parseExecutedTestCount("============ no tests ran in 0.01s ============")).toBe(0);
    expect(parseExecutedTestCount("12 modules in 0.3s")).toBeNull();
  });

  it("cargo ignored and dotnet skipped are not executed", () => {
    expect(parseTestRunSummary("test result: ok. 0 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out")).toEqual({format: "cargo", executed: 0, passed: 0, failed: 0, skipped: 3, todo: 0});
    expect(parseExecutedTestCount("Passed!  - Failed:     0, Passed:     0, Skipped:     2, Total:     2, Duration: 5 ms")).toBe(0);
    expect(parseExecutedTestCount("Failed!  - Failed:     1, Passed:     3, Skipped:     1, Total:     5")).toBe(4);
  });

  it("unparseable or inconsistent output -> null, and the guard reports UNKNOWN (never treated as executed); zero executed -> UNVERIFIED_VACUOUS", () => {
    expect(parseExecutedTestCount("feature=ok")).toBeNull();
    expect(parseExecutedTestCount("      Tests  2 weird (2)")).toBeNull();
    const touched: NameStatusEntry[] = [{status: "MODIFIED", path: "tests/a.test.ts"}];
    const content = {"B:tests/a.test.ts": "expect(1);", "H:tests/a.test.ts": "expect(1); expect(2);"};
    expect(ev(touched, content, null)).toEqual(expect.objectContaining({functionalAcceptance: "UNKNOWN", reason: "EXECUTED_TEST_COUNT_UNPARSEABLE", executedTests: null}));
    expect(ev(touched, content, parseExecutedTestCount(`${E}[2m      Tests ${E}[22m ${E}[33m2 skipped${E}[39m${E}[90m (2)`))).toEqual(expect.objectContaining({functionalAcceptance: "UNVERIFIED_VACUOUS", reason: "ZERO_TESTS_EXECUTED"}));
    expect(ev(touched, content, 3)).toEqual(expect.objectContaining({functionalAcceptance: "UNVERIFIED_ORACLE"}));
  });
});

describe("RV-RELFX-C1-002 disabled-test detection in modified tests", () => {
  const JS_BASE = `describe("s", () => {\n  it("a", () => { expect(1).toBe(1); });\n  test("b", () => { expect(2).toBe(2); });\n});\n`;
  const PY_BASE = `import pytest\nimport unittest\n\ndef test_a():\n    assert compute() == 1\n\nclass T(unittest.TestCase):\n    def test_b(self):\n        self.assertEqual(compute(), 1)\n`;
  const jsCases: [string, string][] = [
    ["xit(", JS_BASE.replace(`it("a"`, `xit("a"`)],
    ["xdescribe(", JS_BASE.replace(`describe("s"`, `xdescribe("s"`)],
    ["xtest(", JS_BASE.replace(`test("b"`, `xtest("b"`)],
    ["it.skipIf(...)(", JS_BASE.replace(`it("a"`, `it.skipIf(process.platform === "win32")("a"`)],
    ["describe.skipIf(...)(", JS_BASE.replace(`describe("s"`, `describe.skipIf(true)("s"`)],
    ["test.todo(", JS_BASE.replace(`test("b"`, `test.todo("b"`)],
    ["it.todo(", JS_BASE.replace(`it("a"`, `it.todo("a"`)],
    ["test('x', {skip: true}, ...)", JS_BASE.replace(`test("b", () =>`, `test("b", {skip: true}, () =>`)],
    ["node:test {todo: 'later'}", JS_BASE.replace(`it("a", () =>`, `it("a", { todo: "later" }, () =>`)],
    ["node:test {skip: 'flaky'}", JS_BASE.replace(`it("a", () =>`, `it('a', {timeout: 5, skip: 'flaky'}, () =>`)],
    ["it.skip(", JS_BASE.replace(`it("a"`, `it.skip("a"`)],
    ["fit( (focus narrows the run)", JS_BASE.replace(`it("a"`, `fit("a"`)]
  ];
  const pyCases: [string, string][] = [
    ["@pytest.mark.skip (no parentheses)", PY_BASE.replace("def test_a", "@pytest.mark.skip\ndef test_a")],
    ["@pytest.mark.skip(reason=...)", PY_BASE.replace("def test_a", "@pytest.mark.skip(reason=\"later\")\ndef test_a")],
    ["@pytest.mark.skipif(...)", PY_BASE.replace("def test_a", "@pytest.mark.skipif(sys.platform == \"win32\", reason=\"x\")\ndef test_a")],
    ["@pytest.mark.skipif (no parentheses)", PY_BASE.replace("def test_a", "@pytest.mark.skipif\ndef test_a")],
    ["@unittest.skip(...)", PY_BASE.replace("    def test_b", "    @unittest.skip(\"x\")\n    def test_b")],
    ["@skip(...) imported from unittest", PY_BASE.replace("    def test_b", "    @skip(\"x\")\n    def test_b")],
    ["self.skipTest(", PY_BASE.replace("        self.assertEqual", "        self.skipTest(\"x\")\n        self.assertEqual")]
  ];
  for (const [name, after] of jsCases) {
    it(`JS: ${name} on an existing test -> BLOCKED`, () => {
      expect(disabledTestMarkers(after)).toBeGreaterThan(disabledTestMarkers(JS_BASE));
      const r = ev([{status: "MODIFIED", path: "tests/s.test.ts"}], {"B:tests/s.test.ts": JS_BASE, "H:tests/s.test.ts": after});
      expect(r.functionalAcceptance).toBe("BLOCKED");
      expect(r.reason).toBe("TEST_WEAKENED");
      expect(r.weakened).toHaveLength(1);
    });
  }
  for (const [name, after] of pyCases) {
    it(`Python: ${name} on an existing test -> BLOCKED`, () => {
      expect(disabledTestMarkers(after)).toBeGreaterThan(disabledTestMarkers(PY_BASE));
      const r = ev([{status: "MODIFIED", path: "tests/test_s.py"}], {"B:tests/test_s.py": PY_BASE, "H:tests/test_s.py": after});
      expect(r).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED", weakened: [expect.objectContaining({path: "tests/test_s.py", reason: "SKIP_OR_ONLY_ADDED"})]}));
    });
  }
  it("negatives: {skip: false}, pagination {skip: 10}, model.fit(, xtestHelper are not disabled-test markers", () => {
    expect(disabledTestMarkers(`test("b", {skip: false}, () => {});`)).toBe(0);
    expect(disabledTestMarkers(`const rows = await db.user.findMany({ skip: 10, take: 5 });`)).toBe(0);
    expect(disabledTestMarkers(`model.fit(x, y); curve.xit(1);`)).toBe(0);
    expect(disabledTestMarkers(`xtestHelper(); prefix_xit(1);`)).toBe(0);
    const after = JS_BASE.replace(`it("a", () => {`, `it("a", () => { const rows = page({ skip: 10 });`);
    expect(ev([{status: "MODIFIED", path: "tests/s.test.ts"}], {"B:tests/s.test.ts": JS_BASE, "H:tests/s.test.ts": after}).functionalAcceptance).toBe("UNVERIFIED_ORACLE");
  });
});

describe("RV-RELFX-C1-003 test-path globs and test-harness config", () => {
  it("spec/ dirs, *Spec.js, *_spec.rb, *.cy.*, *.e2e-spec.* are test paths", () => {
    for (const p of ["spec/models/user_spec.rb", "app/spec/helper.js", "specs/a.js", "src/FooSpec.js", "lib/foo_spec.rb", "cypress/e2e/login.cy.ts", "e2e/app.e2e-spec.ts", "src\\FooSpec.ts"]) expect(isTestPath(p)).toBe(true);
    for (const p of ["src/special.ts", "src/inspect.ts", "respec/x.js", "src/Spec.ts", "docs/spectrum.md"]) expect(isTestPath(p)).toBe(false);
  });

  it("harness config changes are TEST_SURFACE (UNVERIFIED_ORACLE, listed in harness), never silently UNKNOWN", () => {
    for (const p of ["vitest.config.ts", "packages/web/jest.config.js", "playwright.config.ts", "cypress.config.mjs", "pkg/sub/conftest.py", "pytest.ini", "tox.ini", "vitest.workspace.ts", ".mocharc.yml"]) {
      expect(ev([{status: "MODIFIED", path: p}], {})).toEqual(expect.objectContaining({harness: [p], functionalAcceptance: "UNVERIFIED_ORACLE", reason: "TEST_SURFACE_CHANGED_NO_PINNED_ORACLE"}));
    }
    expect(ev([{status: "DELETED", path: "vitest.config.ts"}], {})).toEqual(expect.objectContaining({harness: ["vitest.config.ts"], deleted: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(ev([{status: "RENAMED", path: "conftest.py", oldPath: "tests_support/conftest.py"}], {}).harness).toEqual(["conftest.py"]);
  });

  it("package.json counts only when scripts.test changes; setup.cfg only for [tool:pytest]; pyproject only for [tool.pytest.ini_options]", () => {
    const pkg = (test: string, version = "1.0.0") => JSON.stringify({name: "x", version, scripts: {test, build: "tsc"}});
    const e = (p: string): NameStatusEntry[] => [{status: "MODIFIED", path: p}];
    expect(ev(e("package.json"), {"B:package.json": pkg("vitest run"), "H:package.json": pkg("vitest run --passWithNoTests")})).toEqual(expect.objectContaining({harness: ["package.json"], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(ev(e("apps/a/package.json"), {"B:apps/a/package.json": pkg("jest"), "H:apps/a/package.json": "{not json"}).harness).toEqual(["apps/a/package.json"]);
    expect(ev(e("package.json"), {"B:package.json": pkg("vitest run"), "H:package.json": pkg("vitest run", "1.0.1")})).toEqual(expect.objectContaining({harness: [], functionalAcceptance: "UNKNOWN", reason: "NO_TEST_SURFACE_CHANGE_DETECTED_NO_PINNED_ORACLE"}));
    expect(ev([{status: "ADDED", path: "package.json"}], {"H:package.json": pkg("node --test")}).harness).toEqual(["package.json"]);
    const cfg = (pytest: string, meta = "x") => `[metadata]\nname = ${meta}\n\n[tool:pytest]\n${pytest}\n\n[flake8]\nmax-line-length = 100\n`;
    expect(ev(e("setup.cfg"), {"B:setup.cfg": cfg("addopts = -q"), "H:setup.cfg": cfg("addopts = -q -k 'not slow'")}).harness).toEqual(["setup.cfg"]);
    expect(ev(e("setup.cfg"), {"B:setup.cfg": cfg("addopts = -q"), "H:setup.cfg": cfg("addopts = -q", "y")}).harness).toEqual([]);
    const toml = (opts: string) => `[project]\nname = "x"\n\n[tool.pytest.ini_options]\n${opts}\n`;
    expect(ev(e("pyproject.toml"), {"B:pyproject.toml": toml("testpaths = [\"tests\"]"), "H:pyproject.toml": toml("testpaths = [\"none\"]")}).harness).toEqual(["pyproject.toml"]);
  });
});

describe("RV-RELFX-C1-004 provider-limit classification", () => {
  it("pure: only Claude CLI error lines / the structured marker are provider limits; EDQUOT is DISK_FULL; arbitrary stderr is not", () => {
    expect(executorLimit(1, "EDQUOT: disk quota exceeded")).toBe("DISK_FULL");
    expect(providerLimit(1, "EDQUOT: disk quota exceeded")).toBeNull();
    expect(executorLimit(1, "Error: ENOSPC: no space left on device, write")).toBe("DISK_FULL");
    expect(executorLimit(1, "TypeError: rateLimiter is not a function\n    at main (index.js:3:1)")).toBeNull();
    expect(executorLimit(1, "Error: quota exceeded for widget store")).toBeNull();
    expect(executorLimit(1, "const limit = 429; // rate limit test")).toBeNull();
    expect(executorLimit(1, "API Error: 500 Internal server error")).toBeNull();
    // true positives
    expect(executorLimit(75, "Claude AI usage limit reached|1760540400")).toBe("QUOTA_EXHAUSTED");
    expect(executorLimit(1, `API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}`)).toBe("RATE_LIMIT");
    expect(executorLimit(1, `--- stderr ---\n${E}[31mAPI Error: 429 Too Many Requests${E}[39m\n`)).toBe("RATE_LIMIT");
    expect(executorLimit(1, "You've hit your usage limit · resets 3pm")).toBe("QUOTA_EXHAUSTED");
    expect(executorLimit(1, "noise\nUASCO_PROVIDER_LIMIT: QUOTA_EXHAUSTED\n")).toBe("QUOTA_EXHAUSTED");
    expect(providerLimit(1, "UASCO_PROVIDER_LIMIT=RATE_LIMIT")).toBe("RATE_LIMIT");
  });

  it("runner: implementer EDQUOT -> BLOCKED(DISK_FULL) without retry; 'rateLimiter is not a function' -> normal IMPLEMENT_FAILED", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({implement: () => ({exitCode: 1, stderr: "EDQUOT: disk quota exceeded"})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run.status).toBe("BLOCKED");
    expect(run.reason).toBe("DISK_FULL");
    expect(run.retryCount).toBe(0);
    expect(fake.calls.implement).toBe(1);
    expect(run.evidence.find(e => e.kind === "IMPLEMENT")?.note).toBe("RESOURCE_LIMIT: DISK_FULL");

    const c2 = setup(tmp, "tA");
    const plain = new FakeExecutors(okScript({implement: () => ({exitCode: 1, stderr: "TypeError: rateLimiter is not a function"})}));
    const r2 = startRun(c2, plain);
    const run2 = await drive(c2, runner(c2, plain, {maxRetries: 2}), r2.runId);
    expect(run2.status).toBe("FAILED");
    expect(run2.reason).toBe("IMPLEMENT_FAILED");
    expect(run2.evidence.find(e => e.kind === "IMPLEMENT")?.note ?? "").not.toMatch(/PROVIDER_LIMIT/);
  });

  it("runner: reviewer stdout 'rateLimiter is not a function' is a normal REVIEW_FAILED, not PROVIDER_QUOTA", { timeout: T }, async () => {
    const c = setup(tmp, "tA");
    const fake = new FakeExecutors(okScript({review: () => ({exitCode: 1, raw: "TypeError: rateLimiter is not a function"})}));
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake, {maxRetries: 2}), created.runId);
    expect(run.status).toBe("FAILED");
    expect(run.reason).toBe("REVIEW_FAILED");
  });
});
