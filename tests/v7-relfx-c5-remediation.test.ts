// //TR: Bu test REL-FX cycle-5 harness sınıflama düzeltmelerini doğrular (RV-RELFX-C4-001/002): harness kontrolü test-yolu dalından bağımsız olarak her name-status girişinde çalışır,
// bu yüzden bir test dizinine eklenen veya yeniden adlandırılan sabit-liste harness dosyası (tests/vitest.config.ts, tests/conftest.py) yeni test değil harness sayılır ve
// testChangesRequirement.required true olur (Founder onayı gerekir); gerçek yeni test dosyaları S4 onaysız yolunu korur. HARNESS_ALWAYS_RES, TEST_PATH_RES ve named() taban-ad
// eşlemeleri büyük/küçük harfe duyarsızdır (NTFS; fail-closed). Testler yalnız sentetik dizeler kullanır (güvenilmeyen/AI üretimi kod çalıştırılmaz).
import {describe, it, expect} from "vitest";
import {evaluateTestSurface, isHarnessChange, isTestPath} from "../core/workos/test-surface.js";
import type {NameStatusEntry, TestSurfaceSummary} from "../core/workos/test-surface.js";
import {testChangesRequirement} from "../core/workos/outcomes.js";
import type {RunEvidence} from "../core/workos/types.js";

const H1 = "a".repeat(40), H2 = "b".repeat(40), S1 = "1".repeat(64);
const none = () => null;
const evalSurface = (entries: NameStatusEntry[], contentAt: (ref: string, p: string) => string | null = none) =>
  evaluateTestSurface({baseSha: H2, headSha: H1, entries, contentAt, executedTests: 3});
// testChangesRequirement için bir TEST_SURFACE kanıtı kur ve required'ı oku.
const reqOf = (surface: TestSurfaceSummary) => {
  const ev: RunEvidence = {evidenceId: "evd_ts", step: "VERIFY", cycle: 0, kind: "TEST_SURFACE", argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: S1, commitSha: H1, testSurface: surface} as RunEvidence;
  return testChangesRequirement(H1, [ev]);
};

describe("RV-RELFX-C4-001 harness classification runs on every entry, independent of the test-path branch", () => {
  it("a harness config RENAMED into a test directory (git mv -> R100) is harness, not a newly added test", () => {
    const r = evalSurface([{status: "RENAMED", path: "tests/vitest.config.ts", oldPath: "vitest.config.ts"}]);
    expect(r).toEqual(expect.objectContaining({harness: ["tests/vitest.config.ts"], added: [], renamed: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(reqOf(r).required).toBe(true);
    expect(reqOf(r).changed.harness).toEqual(["tests/vitest.config.ts"]);
  });

  it("an ADDED conftest.py under a test directory is harness (collect hooks can gate selection), not a newly added test", () => {
    const r = evalSurface([{status: "ADDED", path: "tests/conftest.py"}]);
    expect(r).toEqual(expect.objectContaining({harness: ["tests/conftest.py"], added: [], trivialAdded: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(reqOf(r).required).toBe(true);
  });

  it("an ADDED vitest.config.ts under a test directory is harness, not a newly added test", () => {
    const r = evalSurface([{status: "ADDED", path: "tests/vitest.config.ts"}]);
    expect(r).toEqual(expect.objectContaining({harness: ["tests/vitest.config.ts"], added: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(reqOf(r).required).toBe(true);
  });

  it("S4 regression: a genuinely added, non-harness test file stays an added test and needs no acknowledgement", () => {
    const r = evalSurface([{status: "ADDED", path: "tests/new.test.ts"}], (ref, p) => (ref === H1 && p === "tests/new.test.ts" ? "it(\"x\", () => { expect(1).toBe(1); });\n" : null));
    expect(r).toEqual(expect.objectContaining({added: ["tests/new.test.ts"], harness: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(reqOf(r).required).toBe(false);
  });

  it("an ADDED pytest.ini / tox.ini / .mocharc anywhere is harness and requires acknowledgement", () => {
    for (const p of ["pytest.ini", "tests/tox.ini", ".mocharc.json", "tests/.mocharc"]) {
      const r = evalSurface([{status: "ADDED", path: p}]);
      expect(r.harness).toEqual([p]);
      expect(reqOf(r).required).toBe(true);
    }
  });
});

describe("RV-RELFX-C4-002 harness and test-path matching are case-insensitive (NTFS), failing closed", () => {
  it("case variants of unconditional harness basenames at root and in subdirectories are harness", () => {
    const cases = ["Vitest.config.ts", "Conftest.py", "PYTEST.INI", "packages/a/Jest.Config.js", "web/Karma.Conf.ts", "tests/CONFTEST.PY", "pkg/Tox.INI", "a/.MochaRC.cjs"];
    for (const p of cases) {
      expect(isHarnessChange({status: "ADDED", path: p}, "B", "H", none)).toBe(true);
      expect(evalSurface([{status: "ADDED", path: p}]).harness).toEqual([p]);
    }
  });

  it("case variants of test paths are classified as test surface at root and in subdirectories", () => {
    for (const p of ["Tests/a.test.ts", "src/A.Test.ts", "pkg/B.Spec.js", "TEST_foo.py", "SPECS/x.ts", "pkg/__TESTS__/y.ts"]) expect(isTestPath(p)).toBe(true);
  });

  it("case-insensitive named() basename: an ADDED Package.json whose test script changed is harness", () => {
    const base = JSON.stringify({name: "x", scripts: {test: "vitest run", build: "tsc"}});
    const head = JSON.stringify({name: "x", scripts: {test: "vitest run --passWithNoTests", build: "tsc"}});
    const at = (ref: string, p: string) => ((p.split("/").pop() ?? "").toLowerCase() === "package.json" ? (ref === "B" ? base : head) : null);
    expect(isHarnessChange({status: "MODIFIED", path: "Package.json"}, "B", "H", at)).toBe(true);
    expect(isHarnessChange({status: "MODIFIED", path: "Package.json"}, "B", "H", (ref, p) => ((p.split("/").pop() ?? "").toLowerCase() === "package.json" ? base : null))).toBe(false);
  });

  it("negative: an ordinary production file resembling a config name is not harness", () => {
    for (const p of ["src/config.ts", "src/jestSetup.ts", "lib/conftester.py"]) expect(isHarnessChange({status: "MODIFIED", path: p}, "B", "H", none)).toBe(false);
  });
});
