// //TR: Bu test REL-FX cycle-4 yapısal onay kapısını ve dedektör düzeltmelerini doğrular (RV-RELFX-C3-001..005): run.headSha TEST_SURFACE kanıtında mevcut test dosyası değişikliği/silme/yeniden adlandırma veya harness değişikliği varsa COMPLETE yalnız güncel kanıt logunun sha256'sına bağlı açık acknowledgement ile olur (S1; bayat/eşleşmeyen onay 409, journal değişmez), onay aynı birleşik journal yazısında kaydedilir ve replay'de yeniden doğrulanır, deriveOutcomes completionMode ACKNOWLEDGED_TEST_CHANGES verir ve functionalAcceptance asla VERIFIED olmaz (S2); tespit edilen zayıflatma onayla açılmaz (S3); yalnız eklenen test onay istemez (S4). Dedektör: değiştirici zincirinden sonra tagged template, node:test t.test(ad, {skip}) alt testleri, takma adlı pytest/unittest biçimleri, ava/karma config ve testCommand'ın adlandırdığı betik. Testler yalnız sentetik dizeler ve UASCO tarafından yazılmış fixture'ları kullanır (güvenilmeyen/AI üretimi kod çalıştırılmaz).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import {FakeExecutors} from "../core/workos/executors.js";
import type {FakeImplementDirective} from "../core/workos/executors.js";
import {completionEvidence, deriveOutcomes, testChangesRequirement} from "../core/workos/outcomes.js";
import {disabledTestMarkers, evaluateTestSurface, isHarnessChange, isTestPath, testCommandScripts} from "../core/workos/test-surface.js";
import type {NameStatusEntry, TestSurfaceSummary} from "../core/workos/test-surface.js";
import type {RunEvidence, WorkRun} from "../core/workos/types.js";
import {HDR, T, api, drive, journalEntries, journalText, missionOf, okScript, rewriteJournal, rmTmp, runner, setup, startRun, tmpRoot} from "./support/relfx.js";
import type {Ctx} from "./support/relfx.js";

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-relfxc4-"); });
afterEach(() => rmTmp(tmp));

// ---------- pure gate ----------
const H1 = "a".repeat(40), H2 = "b".repeat(40), S1 = "1".repeat(64), S2 = "2".repeat(64);
const ev = (kind: string, extra: Partial<RunEvidence> = {}): RunEvidence => ({evidenceId: `evd_${kind.toLowerCase()}`, step: "REPORT", cycle: 0, kind, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, ...extra});
const surface = (over: Partial<TestSurfaceSummary> = {}): TestSurfaceSummary => ({schemaVersion: 1, baseSha: H2, headSha: H1, testGlobs: [], harnessGlobs: [], added: [], modified: [], deleted: [], renamed: [], weakened: [], trivialAdded: [], harness: [],
  executedTests: 3, testRun: null, oracle: "NONE", functionalAcceptance: "UNVERIFIED_ORACLE", reason: "TEST_SURFACE_CHANGED_NO_PINNED_ORACLE", truncated: false, ...over});
const tsEv = (over: Partial<TestSurfaceSummary>, sha: string | null = S1, id = "evd_ts", commitSha = H1) => ev("TEST_SURFACE", {evidenceId: id, step: "VERIFY", commitSha, logSha256: sha, testSurface: surface(over)});
const gateEvidence = (...surfaces: RunEvidence[]) => [ev("IMPLEMENT", {commitSha: H1}), ...surfaces, ev("SECURITY_REPORT", {commitSha: H1, security: {status: "PASSED", blockReason: null} as never}),
  ev("REVIEW", {verdict: "CLEAN", commitSha: H1}), ev("REPORT", {verdict: "CLEAN", commitSha: H1})];
const baseRun = (evidence: RunEvidence[], over: Partial<WorkRun> = {}): WorkRun => ({runId: "run_" + "0".repeat(24), missionId: "msn_x", projectId: "prj_x", tenantId: "tA", roleId: null, executor: {implementer: "I", reviewer: "R"}, leaseId: null, leaseExpiresAt: null,
  attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 0, retryCount: 0, retryAt: null, reason: null, baseSha: H2, headSha: H1, workBranch: "b", checkpoints: [], evidence, createdAt: "", createdBy: "x", updatedAt: "", ...over});
const ACK = (sha = S1) => ({acknowledgeTestChanges: true, testSurfaceSha256: sha});
const REQ = {ok: false, reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};

describe("REL-FX c4 S1-S4 structural acknowledgement gate (pure)", () => {
  it("S1: a modified, renamed or harness change requires an acknowledgement that matches the current TEST_SURFACE log sha256 exactly", () => {
    for (const over of [{modified: ["tests/a.test.ts"]}, {renamed: [{from: "tests/a.test.ts", to: "tests/b.test.ts"}]}, {harness: ["vitest.config.ts"]}, {harness: ["package.json"], added: ["tests/n.test.ts"]}]) {
      const run = baseRun(gateEvidence(tsEv(over)));
      expect(testChangesRequirement(H1, run.evidence)).toEqual(expect.objectContaining({required: true, testSurfaceSha256: S1}));
      expect(completionEvidence(run)).toEqual(REQ);
      expect(completionEvidence(run, run.evidence, ACK(S2))).toEqual(REQ); // mismatched
      for (const bad of [{acknowledgeTestChanges: false, testSurfaceSha256: S1}, {acknowledgeTestChanges: true}, {...ACK(), extra: 1}, {acknowledgeTestChanges: "true", testSurfaceSha256: S1}, {acknowledgeTestChanges: true, testSurfaceSha256: "A".repeat(64)}, {acknowledgeTestChanges: true, testSurfaceSha256: S1.slice(1)}, null, "yes", [ACK()]])
        expect(completionEvidence(run, run.evidence, bad)).toEqual(REQ);
      const ok = completionEvidence(run, run.evidence, ACK());
      expect(ok.ok).toBe(true);
      if (!ok.ok) continue;
      expect(ok.refs.testChangesAcknowledgement).toEqual({acknowledgeTestChanges: true, testSurfaceSha256: S1, testSurfaceEvidenceId: "evd_ts",
        changed: {modified: over.modified ?? [], deleted: [], renamed: over.renamed ?? [], harness: over.harness ?? [], truncated: false}, functionalAcceptance: "UNVERIFIED_ORACLE"});
    }
  });

  it("S1: a stale acknowledgement (sha of an earlier TEST_SURFACE for this head, or of another head) is refused", () => {
    const run = baseRun(gateEvidence(tsEv({modified: ["tests/a.test.ts"]}, S2, "evd_old"), tsEv({modified: ["tests/a.test.ts"]}, S1, "evd_new")));
    expect(completionEvidence(run, run.evidence, ACK(S2))).toEqual(REQ);
    expect(completionEvidence(run, run.evidence, ACK(S1)).ok).toBe(true);
    const other = baseRun(gateEvidence(tsEv({modified: ["tests/a.test.ts"]}, S2, "evd_other", H2), tsEv({modified: ["tests/a.test.ts"]}, S1)));
    expect(completionEvidence(other, other.evidence, ACK(S2))).toEqual(REQ);
    // evidence without a valid log sha256 can never be acknowledged (fail-closed)
    const noSha = baseRun(gateEvidence(tsEv({modified: ["tests/a.test.ts"]}, null)));
    expect(completionEvidence(noSha, noSha.evidence, ACK(S1))).toEqual(REQ);
  });

  it("S3: detected weakening or deletion (BLOCKED) refuses COMPLETE even with a matching acknowledgement", () => {
    const weak = baseRun(gateEvidence(tsEv({modified: ["tests/a.test.ts"], weakened: [{path: "tests/a.test.ts", before: 2, after: 1, reason: "ASSERTION_COUNT_REDUCED"}], functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED"})));
    expect(completionEvidence(weak, weak.evidence, ACK())).toEqual({ok: false, reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"});
    const del = baseRun(gateEvidence(tsEv({deleted: ["tests/a.test.ts"], functionalAcceptance: "BLOCKED", reason: "TEST_DELETED"})));
    expect(completionEvidence(del, del.evidence, ACK())).toEqual({ok: false, reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"});
  });

  it("S4: newly added tests alone need no acknowledgement and stay UNVERIFIED_ORACLE; an unneeded acknowledgement must still match", () => {
    const run = baseRun(gateEvidence(tsEv({added: ["tests/new.test.ts"]})));
    expect(testChangesRequirement(H1, run.evidence).required).toBe(false);
    const ok = completionEvidence(run);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.refs.testChangesAcknowledgement).toBeUndefined();
    expect(deriveOutcomes(run).functionalAcceptance).toBe("UNVERIFIED_ORACLE");
    expect(completionEvidence(run, run.evidence, ACK(S2))).toEqual(REQ);
    const unneeded = completionEvidence(run, run.evidence, ACK(S1));
    expect(unneeded.ok).toBe(true);
    if (unneeded.ok) expect(unneeded.refs.testChangesAcknowledgement).toBeUndefined();
    // no TEST_SURFACE at all (legacy shape): no requirement; a supplied acknowledgement cannot match anything
    const legacy = baseRun(gateEvidence());
    expect(completionEvidence(legacy).ok).toBe(true);
    expect(completionEvidence(legacy, legacy.evidence, ACK())).toEqual(REQ);
  });

  it("S2: deriveOutcomes exposes completionMode; an acknowledged completion is never VERIFIED", () => {
    const run = baseRun(gateEvidence(tsEv({modified: ["tests/a.test.ts"]})));
    expect(deriveOutcomes(run).completionMode).toBe("NOT_COMPLETED");
    const chk = completionEvidence(run, run.evidence, ACK());
    if (!chk.ok) throw new Error("expected ok");
    const done = deriveOutcomes({...run, status: "SUCCEEDED", completion: chk.refs});
    expect(done).toEqual(expect.objectContaining({completionMode: "ACKNOWLEDGED_TEST_CHANGES", functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(done.functionalAcceptance).not.toBe("VERIFIED");
    const plain = baseRun(gateEvidence(tsEv({added: ["tests/n.test.ts"]})));
    const pc = completionEvidence(plain); if (!pc.ok) throw new Error("expected ok");
    expect(deriveOutcomes({...plain, status: "SUCCEEDED", completion: pc.refs}).completionMode).toBe("EVIDENCE_GUARD");
  });

  it("a detector evasion on an existing test still needs the acknowledgement (the guarantee is structural, not the pattern)", () => {
    const B = `describe("s", () => {\n  it("a", () => { expect(1).toBe(1); });\n});\n`;
    const A = `const later = it.skip;\ndescribe("s", () => {\n  later("a", () => { expect(1).toBe(1); });\n});\n`;
    const r = evaluateTestSurface({baseSha: "B", headSha: "H", entries: [{status: "MODIFIED", path: "tests/s.test.ts"}], contentAt: (ref, p) => ({"B:tests/s.test.ts": B, "H:tests/s.test.ts": A} as Record<string, string>)[`${ref}:${p}`] ?? null, executedTests: 3});
    expect(r.functionalAcceptance).toBe("UNVERIFIED_ORACLE"); // evaded the text detector (documented limit)
    const run = baseRun(gateEvidence(ev("TEST_SURFACE", {evidenceId: "evd_ts", commitSha: H1, logSha256: S1, testSurface: {...r, headSha: H1}})));
    expect(completionEvidence(run)).toEqual(REQ);
  });
});

// ---------- detector fixes ----------
const evalMod = (path_: string, before: string, after: string, testCommand: string[] = []) =>
  evaluateTestSurface({baseSha: "B", headSha: "H", entries: [{status: "MODIFIED", path: path_}], contentAt: (ref, p) => (p === path_ ? (ref === "B" ? before : after) : null), executedTests: 3, testCommand});

describe("RV-RELFX-C3-001 tagged-template .each/.for after skip/only/x/f modifiers", () => {
  const BASE = "describe(\"s\", () => {\n  it.each`\n    a    | b\n    ${1} | ${1}\n  `(\"eq $a\", ({a, b}) => { expect(a).toBe(b); });\n  test.for`\n    x\n    ${2}\n  `(\"t $x\", ({x}) => { expect(x).toBe(2); });\n});\n";
  const cases: [string, string][] = [
    ["it.skip.each`...`", BASE.replace("it.each`", "it.skip.each`")],
    ["it.only.each`...`", BASE.replace("it.each`", "it.only.each`")],
    ["test.skip.for`...`", BASE.replace("test.for`", "test.skip.for`")],
    ["xit.each`...`", BASE.replace("it.each`", "xit.each`")],
    ["fit.each`...`", BASE.replace("it.each`", "fit.each`")],
    ["describe.skip.each`...`", BASE.replace("describe(\"s\"", "describe.skip.each`\n  v\n  ${1}\n`(\"s\"")],
    ["it.todo.each `...` (space before the template)", BASE.replace("it.each`", "it.todo.each `")]
  ];
  for (const [name, after] of cases) it(`${name} -> BLOCKED / SKIP_OR_ONLY_ADDED`, () => {
    expect(after).not.toBe(BASE);
    expect(disabledTestMarkers(after)).toBeGreaterThan(disabledTestMarkers(BASE));
    expect(evalMod("tests/s.test.ts", BASE, after)).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED", weakened: [expect.objectContaining({reason: "SKIP_OR_ONLY_ADDED"})]}));
  });
  it("negative: unmodified it.each`...` / test.for`...` are not markers", () => { expect(disabledTestMarkers(BASE)).toBe(0); });
});

describe("RV-RELFX-C3-002 node:test subtests with a member receiver", () => {
  const BASE = `import test from "node:test";\nimport assert from "node:assert";\ntest("outer", async (t) => {\n  await t.test("sub", async () => { assert.equal(1, 1); });\n});\n`;
  const cases: [string, string][] = [
    ["t.test(name, {skip: true}, fn)", BASE.replace(`t.test("sub", async`, `t.test("sub", {skip: true}, async`)],
    ["t.test(name, { todo }, fn)", BASE.replace(`t.test("sub", async`, `t.test("sub", { todo }, async`)],
    ["t.test(name, {only: 'x'}, fn)", BASE.replace(`t.test("sub", async`, `t.test("sub", {only: "x"}, async`)],
    ["ctx.sub.test(name, { timeout: 5, skip: 'later' }, fn)", BASE.replace(`t.test("sub", async`, `t.sub.test("sub", { timeout: 5, skip: "later" }, async`)],
    ["t.test({ skip: true }, fn) (nameless)", BASE.replace(`t.test("sub", async`, `t.test({ skip: true }, async`)]
  ];
  for (const [name, after] of cases) it(`${name} -> BLOCKED / SKIP_OR_ONLY_ADDED`, () => {
    expect(disabledTestMarkers(after)).toBeGreaterThan(disabledTestMarkers(BASE));
    expect(evalMod("test/outer.test.mjs", BASE, after)).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED"}));
  });
  it("negatives: t.test(name, {timeout}), {skip: false}, regex .test(value) are not markers", () => {
    expect(disabledTestMarkers(BASE)).toBe(0);
    expect(disabledTestMarkers(`await t.test("sub", {timeout: 5}, async () => {});`)).toBe(0);
    expect(disabledTestMarkers(`await t.test("sub", {skip: false}, async () => {});`)).toBe(0);
    expect(disabledTestMarkers(`if (pattern.test(value)) { use({only: 1}); }`)).toBe(0);
  });
});

describe("RV-RELFX-C3-003 aliased pytest / unittest disabling forms", () => {
  const PY = `import pytest\nimport unittest\n\n\ndef test_a():\n    assert 1 == 1\n\n\nclass T(unittest.TestCase):\n    def test_b(self):\n        self.assertEqual(1, 1)\n`;
  const cases: [string, string][] = [
    ["import pytest as pt; @pt.mark.skip", PY.replace("import pytest\n", "import pytest as pt\n").replace("def test_a", "@pt.mark.skip(reason=\"x\")\ndef test_a")],
    ["from pytest import mark; @mark.skipif", PY.replace("import pytest\n", "from pytest import mark\n").replace("def test_a", "@mark.skipif(True, reason=\"x\")\ndef test_a")],
    ["@mark.xfail (bare)", PY.replace("import pytest\n", "from pytest import mark\n").replace("def test_a", "@mark.xfail\ndef test_a")],
    ["pytestmark = pt.mark.skip (module level)", PY.replace("import pytest\n", "import pytest as pt\npytestmark = pt.mark.skip\n")],
    ["pytest.importorskip(...)", PY.replace("    assert 1 == 1", "    pytest.importorskip(\"not_installed\")\n    assert 1 == 1")],
    ["from pytest import importorskip", PY.replace("    assert 1 == 1", "    importorskip(\"x\")\n    assert 1 == 1")],
    ["from pytest import skip; skip(...)", PY.replace("    assert 1 == 1", "    skip(\"later\")\n    assert 1 == 1")],
    ["pt.xfail(...) imperative", PY.replace("    assert 1 == 1", "    pt.xfail(\"later\")\n    assert 1 == 1")],
    ["raise unittest.SkipTest", PY.replace("        self.assertEqual(1, 1)", "        raise unittest.SkipTest(\"later\")\n        self.assertEqual(1, 1)")],
    ["raise SkipTest (imported)", PY.replace("        self.assertEqual(1, 1)", "        raise SkipTest(\"later\")\n        self.assertEqual(1, 1)")],
    ["import unittest as ut; @ut.skip", PY.replace("    def test_b", "    @ut.skip(\"later\")\n    def test_b")],
    ["@ut.expectedFailure", PY.replace("    def test_b", "    @ut.expectedFailure\n    def test_b")],
    ["xfail = pytest.mark.xfail; @xfail", PY.replace("def test_a", "@xfail\ndef test_a")]
  ];
  for (const [name, after] of cases) it(`${name} -> BLOCKED / SKIP_OR_ONLY_ADDED`, () => {
    expect(after).not.toBe(PY);
    expect(disabledTestMarkers(after)).toBeGreaterThan(disabledTestMarkers(PY));
    expect(evalMod("tests/test_a.py", PY, after)).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED"}));
  });
  it("negative: the base file and a renamed (non-disabling) helper are not markers", () => {
    expect(disabledTestMarkers(PY)).toBe(0);
    expect(disabledTestMarkers(`def skipped_items(xs):\n    return [x for x in xs if x.skipped]\n`)).toBe(0);
  });
});

describe("RV-RELFX-C3-004 harness locations: ava/karma config and the script named by the mission testCommand", () => {
  const none = () => null;
  it("ava.config.* and karma.conf.* are unconditional harness files", () => {
    for (const p of ["ava.config.js", "ava.config.mjs", "packages/a/ava.config.cjs", "karma.conf.js", "web/karma.conf.ts"]) expect(isHarnessChange({status: "MODIFIED", path: p}, "B", "H", none)).toBe(true);
    const r = evaluateTestSurface({baseSha: "B", headSha: "H", entries: [{status: "MODIFIED", path: "karma.conf.js"}], contentAt: none, executedTests: 3});
    expect(r).toEqual(expect.objectContaining({harness: ["karma.conf.js"], functionalAcceptance: "UNVERIFIED_ORACLE"}));
  });
  it("testCommandScripts names the package.json scripts a testCommand runs", () => {
    expect(testCommandScripts(["npm", "run", "test:unit"])).toEqual(["pretest:unit", "test:unit", "posttest:unit"]);
    expect(testCommandScripts(["npm", "--silent", "run-script", "ci"])).toEqual(["preci", "ci", "postci"]);
    expect(testCommandScripts(["npm", "t"])).toEqual(["pretest", "test", "posttest"]);
    expect(testCommandScripts(["yarn", "test:ci"])).toEqual(["pretest:ci", "test:ci", "posttest:ci"]);
    expect(testCommandScripts(["pnpm", "run", "check"])).toEqual(["precheck", "check", "postcheck"]);
    expect(testCommandScripts(["node", "run-tests.mjs"])).toEqual([]);
    expect(testCommandScripts(["npm", "install"])).toEqual([]);
  });
  it("a change to the package.json script named by testCommand (or its pre/post) is harness; an unrelated script change is not", () => {
    const pkg = (scripts: Record<string, string>) => JSON.stringify({name: "x", scripts});
    const base = pkg({"test:unit": "vitest run", "build": "tsc"});
    const at = (after: string) => (ref: string) => (ref === "B" ? base : after);
    const e: NameStatusEntry = {status: "MODIFIED", path: "package.json"};
    const tc = ["npm", "run", "test:unit"];
    expect(isHarnessChange(e, "B", "H", at(pkg({"test:unit": "vitest run --passWithNoTests", "build": "tsc"})), tc)).toBe(true);
    expect(isHarnessChange(e, "B", "H", at(pkg({"test:unit": "vitest run", "pretest:unit": "exit 0", "build": "tsc"})), tc)).toBe(true);
    expect(isHarnessChange(e, "B", "H", at(pkg({"test:unit": "vitest run", "build": "tsc -b"})), tc)).toBe(false);
    // without the testCommand the named script is not compared (the pre-c4 gap)
    expect(isHarnessChange(e, "B", "H", at(pkg({"test:unit": "vitest run --passWithNoTests", "build": "tsc"})))).toBe(false);
    const r = evaluateTestSurface({baseSha: "B", headSha: "H", entries: [e], contentAt: at(pkg({"test:unit": "true", "build": "tsc"})), executedTests: 3, testCommand: tc});
    expect(r).toEqual(expect.objectContaining({harness: ["package.json"], functionalAcceptance: "UNVERIFIED_ORACLE"}));
  });
  it("a --config=<file> option value in testCommand is test surface", () => {
    expect(isTestPath("cfg/custom-runner.mjs", ["npx", "vitest", "run", "--config=./cfg/custom-runner.mjs"])).toBe(true);
    expect(isTestPath("cfg/custom-runner.mjs", ["npx", "vitest", "run", "--config", "cfg/custom-runner.mjs"])).toBe(true);
    expect(isTestPath("cfg/custom-runner.mjs", ["npx", "vitest", "run", "--reporter=dot"])).toBe(false);
  });
});

// ---------- store + API (UASCO-authored fixture repo; fake executors) ----------
const RUN_TESTS = `import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
globalThis.read = f => fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "";
globalThis.expect = v => ({toBe: w => { if (v !== w) throw new Error("expected " + w + " got " + v); }});
let total = 0, failed = 0;
const files = fs.existsSync("tests") ? fs.readdirSync("tests").filter(f => f.endsWith(".test.mjs")).sort() : [];
for (const f of files) {
  const m = await import(pathToFileURL(path.resolve("tests", f)).href);
  for (const fn of Object.values(m)) { if (typeof fn !== "function") continue; total++; try { await fn(); } catch (e) { failed++; console.log("FAIL " + f + ": " + e.message); } }
}
console.log("      Tests  " + (failed ? failed + " failed | " : "") + (total - failed) + " passed (" + total + ")");
process.exit(failed ? 1 : 0);
`;
const B_TEST = `export function readmeIsBase() { expect(read("README.txt")).toBe("base"); }\n`;
const FILES = {"run-tests.mjs": RUN_TESTS, "README.txt": "base\n", "tests/b.test.mjs": B_TEST, "vitest.config.mjs": "export default {};\n"};

async function runWith(directive: FakeImplementDirective): Promise<{c: Ctx; run: WorkRun}> {
  const c = setup(tmp, "tA", {files: FILES, testCommand: ["node", "run-tests.mjs"]});
  const fake = new FakeExecutors(okScript({implement: () => directive}));
  const created = startRun(c, fake);
  const run = await drive(c, runner(c, fake), created.runId);
  expect(run.status).toBe("AWAITING_APPROVAL");
  return {c, run};
}
const tsOf = (run: WorkRun) => run.evidence.filter(e => e.kind === "TEST_SURFACE").at(-1)!;
const complete = (app: ReturnType<typeof api>, c: Ctx, extra: Record<string, unknown> = {}) =>
  app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "Founder accepts", ...extra}});

describe("REL-FX c4 acknowledgement gate through the store and the API", () => {
  it("S1/S2: a modified existing test -> 409 without/with a mismatched or stale acknowledgement (journal unchanged); a matching one completes in one journal write that replays", { timeout: T }, async () => {
    const {c, run} = await runWith({files: {"feature.txt": "ok\n", "tests/b.test.mjs": B_TEST + "// clarified\n"}});
    const ts = tsOf(run);
    expect(ts.testSurface).toEqual(expect.objectContaining({modified: ["tests/b.test.mjs"], weakened: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    // the acknowledged hash is the sha256 of the exact TEST_SURFACE evidence log
    expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(c.dataDir, ts.logPath!))).digest("hex")).toBe(ts.logSha256);
    const app = api(c);
    const before = journalText(c);
    const refused = await complete(app, c);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"});
    const mismatched = await complete(app, c, {acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: "0".repeat(64)}});
    expect(mismatched.statusCode).toBe(409);
    expect(mismatched.json().reason).toBe("COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT");
    // malformed acknowledgement or an acknowledgement on a non-COMPLETE transition -> 400
    expect((await complete(app, c, {acknowledgement: {acknowledgeTestChanges: false, testSurfaceSha256: ts.logSha256}})).statusCode).toBe(400);
    expect((await complete(app, c, {acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: ts.logSha256, paths: []}})).statusCode).toBe(400);
    expect((await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "BLOCKED", reason: "x", acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: ts.logSha256}}})).statusCode).toBe(400);
    // the store path (transitionMission) has no acknowledgement and is refused the same way
    expect(() => c.store.transitionMission({tenantId: "tA"}, c.missionId, "COMPLETE", "x", "FOUNDER_LOCAL")).toThrow(/COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT/);
    expect(journalText(c)).toBe(before);
    expect(missionOf(c).status).toBe("REPORTING");

    const n = journalEntries(c).length;
    const ok = await complete(app, c, {acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: ts.logSha256}});
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.mission.status).toBe("COMPLETE");
    expect(body.run.status).toBe("SUCCEEDED");
    expect(body.outcomes).toEqual(expect.objectContaining({completionMode: "ACKNOWLEDGED_TEST_CHANGES", functionalAcceptance: "UNVERIFIED_ORACLE"}));
    const rec = {acknowledgeTestChanges: true, testSurfaceSha256: ts.logSha256, testSurfaceEvidenceId: ts.evidenceId,
      changed: {modified: ["tests/b.test.mjs"], deleted: [], renamed: [], harness: [], truncated: false}, functionalAcceptance: "UNVERIFIED_ORACLE"};
    expect(body.run.completion.testChangesAcknowledgement).toEqual(rec);
    const entries = journalEntries(c);
    expect(entries.length).toBe(n + 1);
    const last = entries[entries.length - 1];
    expect(last.type).toBe("RUN_TRANSITION");
    expect(last.payload).toEqual(expect.objectContaining({from: "AWAITING_APPROVAL", to: "SUCCEEDED", mission: expect.objectContaining({to: "COMPLETE"}), completion: expect.objectContaining({headSha: run.headSha, testChangesAcknowledgement: rec})}));
    // replay of the combined write from the journal alone
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    const fresh = new WorkOsStore(c.dataDir);
    expect(fresh.isTampered).toBe(false);
    const replayed = fresh.getRun({tenantId: "tA"}, run.runId)!;
    expect(replayed.status).toBe("SUCCEEDED");
    expect(replayed.completion?.testChangesAcknowledgement).toEqual(rec);
    expect(deriveOutcomes(replayed).completionMode).toBe("ACKNOWLEDGED_TEST_CHANGES");
    expect(deriveOutcomes(replayed).functionalAcceptance).not.toBe("VERIFIED");
    const view = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: HDR})).json();
    expect(view.outcomes.completionMode).toBe("ACKNOWLEDGED_TEST_CHANGES");
    await app.close();
  });

  it("replay: a combined entry with the acknowledgement stripped, or with a different sha / path list, is tamper", { timeout: T }, async () => {
    const {c, run} = await runWith({files: {"feature.txt": "ok\n", "tests/b.test.mjs": B_TEST + "// clarified\n"}});
    const ts = tsOf(run);
    c.store.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL", {acknowledgeTestChanges: true, testSurfaceSha256: ts.logSha256});
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
    const good = journalEntries(c);
    const forge = (edit: (completion: any) => any) => rewriteJournal(c, () => good.map(e => e.type === "RUN_TRANSITION" && e.payload.to === "SUCCEEDED" ? {...e, payload: {...e.payload, completion: edit(e.payload.completion)}} : e));
    const variants: ((x: any) => any)[] = [
      ({testChangesAcknowledgement: _a, ...rest}) => rest,
      x => ({...x, testChangesAcknowledgement: {...x.testChangesAcknowledgement, testSurfaceSha256: "f".repeat(64)}}),
      x => ({...x, testChangesAcknowledgement: {...x.testChangesAcknowledgement, changed: {...x.testChangesAcknowledgement.changed, modified: []}}}),
      x => ({...x, testChangesAcknowledgement: {...x.testChangesAcknowledgement, functionalAcceptance: "VERIFIED"}}),
      x => ({...x, testChangesAcknowledgement: null})
    ];
    for (const v of variants) { forge(v); expect(new WorkOsStore(c.dataDir).isTampered).toBe(true); }
    rewriteJournal(c, () => good);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
  });

  it("stale: re-verification evidence (new TEST_SURFACE log hash) invalidates an acknowledgement taken earlier -> 409, journal unchanged", { timeout: T }, async () => {
    const {c, run} = await runWith({files: {"feature.txt": "ok\n", "tests/b.test.mjs": B_TEST + "// clarified\n"}});
    const old = tsOf(run).logSha256!;
    rewriteJournal(c, es => es.map(e => e.type === "RUN_EVIDENCE" && e.payload.evidence.kind === "TEST_SURFACE" ? {...e, payload: {...e.payload, evidence: {...e.payload.evidence, logSha256: "e".repeat(64)}}} : e));
    const s = new WorkOsStore(c.dataDir);
    expect(s.isTampered).toBe(false);
    const before = journalText(c);
    expect(() => s.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL", {acknowledgeTestChanges: true, testSurfaceSha256: old})).toThrow(/COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT/);
    expect(journalText(c)).toBe(before);
    expect(s.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL", {acknowledgeTestChanges: true, testSurfaceSha256: "e".repeat(64)}).run.status).toBe("SUCCEEDED");
  });

  it("S1 harness-only change requires the acknowledgement; S4 an added test alone completes without one (EVIDENCE_GUARD, UNVERIFIED_ORACLE)", { timeout: T }, async () => {
    const h = await runWith({files: {"feature.txt": "ok\n", "vitest.config.mjs": "export default {test: {include: []}};\n"}});
    expect(tsOf(h.run).testSurface).toEqual(expect.objectContaining({harness: ["vitest.config.mjs"], modified: []}));
    expect(() => h.c.store.completeMission({tenantId: "tA"}, h.c.missionId, "accept", "FOUNDER_LOCAL")).toThrow(/COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT/);
    const done = h.c.store.completeMission({tenantId: "tA"}, h.c.missionId, "accept", "FOUNDER_LOCAL", {acknowledgeTestChanges: true, testSurfaceSha256: tsOf(h.run).logSha256});
    expect(done.run.completion?.testChangesAcknowledgement?.changed.harness).toEqual(["vitest.config.mjs"]);

    const a = await runWith({files: {"feature.txt": "ok\n", "tests/c.test.mjs": `export function featureOk() { expect(read("feature.txt")).toBe("ok"); }\n`}});
    expect(tsOf(a.run).testSurface).toEqual(expect.objectContaining({added: ["tests/c.test.mjs"], modified: [], harness: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
    const app = api(a.c);
    const res = await complete(app, a.c);
    expect(res.statusCode).toBe(200);
    expect(res.json().outcomes).toEqual(expect.objectContaining({completionMode: "EVIDENCE_GUARD", functionalAcceptance: "UNVERIFIED_ORACLE"}));
    expect(res.json().run.completion.testChangesAcknowledgement).toBeUndefined();
    await app.close();
  });

  it("S3: a deleted test stays refused (BLOCKED) even with a matching acknowledgement", { timeout: T }, async () => {
    const {c, run} = await runWith({files: {"feature.txt": "ok\n", "tests/c.test.mjs": `export function featureOk() { expect(read("feature.txt")).toBe("ok"); }\n`}, deleteFiles: ["tests/b.test.mjs"]});
    expect(tsOf(run).testSurface?.functionalAcceptance).toBe("BLOCKED");
    const app = api(c);
    const before = journalText(c);
    const res = await complete(app, c, {acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tsOf(run).logSha256}});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"});
    expect(journalText(c)).toBe(before);
    await app.close();
  });
});
