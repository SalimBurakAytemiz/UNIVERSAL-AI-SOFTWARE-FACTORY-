// //TR: Bu test REL-FX-2 test yüzeyi korumasını doğrular: VERIFY taze klonda base..head name-status ile dokunulan test yollarını sınıflar, TEST_SURFACE kanıtı yazar ve listeyi reviewer'a geçirir; test dosyası silme, assertion azaltma ve test glob'u dışına taşıma functionalAcceptance BLOCKED yapar ve COMPLETE kapısı 409 döner; yalnız önemsiz test ekleme UNVERIFIED_ORACLE/UNVERIFIED_VACUOUS kalır, sıfır test yürütme UNVERIFIED_VACUOUS olur (REL-AT-001/002).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {FakeExecutors} from "../core/workos/executors.js";
import type {FakeImplementDirective, MissionSpec} from "../core/workos/executors.js";
import {assertionCount, evaluateTestSurface, isHarnessChange, isRealTestFile, isTestPath, parseExecutedTestCount, parseNameStatusZ} from "../core/workos/test-surface.js";
import {deriveOutcomes} from "../core/workos/outcomes.js";
import {HDR, T, api, drive, okScript, rmTmp, runner, setup, startRun, tmpRoot} from "./support/relfx.js";
import type {Ctx} from "./support/relfx.js";

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-relfx2-"); });
afterEach(() => rmTmp(tmp));

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
const A_TEST = `export function featureIsOk() { expect(read("feature.txt")).toBe("ok"); }\n`;
const B_TEST = `export function readmeIsBase() { expect(read("README.txt")).toBe("base"); }\nexport function readmeNotEmpty() { expect(read("README.txt").length > 0).toBe(true); }\n`;
const FILES = {"run-tests.mjs": RUN_TESTS, "README.txt": "base\n", "tests/a.test.mjs": A_TEST, "tests/b.test.mjs": B_TEST};

async function runWith(directive: FakeImplementDirective, files: Record<string, string> = FILES): Promise<{c: Ctx; run: Awaited<ReturnType<typeof drive>>; specs: MissionSpec[]}> {
  const c = setup(tmp, "tA", {files, testCommand: ["node", "run-tests.mjs"]});
  const specs: MissionSpec[] = [];
  const fake = new FakeExecutors(okScript({implement: () => directive, review: (_n, spec) => { specs.push(spec); return {verdict: "CLEAN"}; }}));
  const created = startRun(c, fake);
  const run = await drive(c, runner(c, fake), created.runId);
  return {c, run, specs};
}
const surfaceOf = (run: {evidence: {kind: string; testSurface?: unknown}[]}) => run.evidence.filter(e => e.kind === "TEST_SURFACE").at(-1)?.testSurface as any;
async function complete(c: Ctx) {
  const app = api(c);
  const res = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "accept"}});
  await app.close();
  return res;
}

describe("REL-FX-2 test-surface helpers (pure)", () => {
  it("classifies test paths, parses name-status -z, counts assertions and executed tests", () => {
    for (const p of ["tests/a.test.ts", "test/x.js", "src/__tests__/y.tsx", "pkg/foo.spec.ts", "lib/bar.test.mjs", "pkg/x_test.go", "app/test_api.py", "src/test/java/FooTest.java"]) expect(isTestPath(p)).toBe(true);
    for (const p of ["src/index.ts", "README.md", "testing.md", "attic/b.mjs", "contest/x.js"]) expect(isTestPath(p)).toBe(false);
    expect(isTestPath("check.mjs", ["node", "check.mjs", "--flag"])).toBe(true);
    expect(parseNameStatusZ("A\0tests/new.test.ts\0M\0src/a.ts\0D\0tests/old.test.ts\0R087\0tests/b.test.ts\0attic/b.ts\0")).toEqual([
      {status: "ADDED", path: "tests/new.test.ts"}, {status: "MODIFIED", path: "src/a.ts"}, {status: "DELETED", path: "tests/old.test.ts"}, {status: "RENAMED", path: "attic/b.ts", oldPath: "tests/b.test.ts"}]);
    expect(assertionCount("expect(a).toBe(1); assert(x); assert.strictEqual(a, b); assertEquals(1, 1); // expectation")).toBe(4);
    expect(parseExecutedTestCount("      Tests  2 passed (2)")).toBe(2);
    expect(parseExecutedTestCount(" Test Files  1 passed (1)\n      Tests  1 failed | 3 passed (4)")).toBe(4);
    expect(parseExecutedTestCount("No test files found, exiting with code 1")).toBe(0);
    expect(parseExecutedTestCount("Tests:       5 passed, 5 total")).toBe(5);
    expect(parseExecutedTestCount("# tests 7\n# pass 7")).toBe(7);
    expect(parseExecutedTestCount("=========== 3 passed, 1 skipped in 0.12s ===========")).toBe(3); // RV-RELFX-C1-001: skipped is not executed
    expect(parseExecutedTestCount("============ no tests ran in 0.01s ============")).toBe(0);
    expect(parseExecutedTestCount("feature=ok")).toBeNull();
  });

  it("precedence: deleted/weakened -> BLOCKED; zero executed -> UNVERIFIED_VACUOUS; touched -> UNVERIFIED_ORACLE; untouched -> UNKNOWN", () => {
    const content: Record<string, string> = {"base:tests/b.test.ts": "expect(1);expect(2);", "head:tests/b.test.ts": "expect(1);", "head:tests/c.test.ts": "it('x', () => {});", "head:tests/d.test.ts": "expect(1).toBe(1);"};
    const at = (ref: string, p: string) => content[`${ref === "B" ? "base" : "head"}:${p}`] ?? null;
    const ev = (entries: ReturnType<typeof parseNameStatusZ>, executedTests: number | null = 3) => evaluateTestSurface({baseSha: "B", headSha: "H", entries, contentAt: at, executedTests});
    expect(ev([{status: "DELETED", path: "tests/x.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_DELETED", deleted: ["tests/x.test.ts"]}));
    expect(ev([{status: "MODIFIED", path: "tests/b.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED", weakened: [{path: "tests/b.test.ts", before: 2, after: 1, reason: "ASSERTION_COUNT_REDUCED"}]}));
    expect(ev([{status: "RENAMED", path: "attic/b.ts", oldPath: "tests/b.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", deleted: ["tests/b.test.ts"]}));
    expect(ev([{status: "ADDED", path: "tests/c.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "UNVERIFIED_VACUOUS", reason: "TRIVIAL_TEST_ADDED", trivialAdded: ["tests/c.test.ts"]}));
    expect(ev([{status: "ADDED", path: "tests/d.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "UNVERIFIED_ORACLE", added: ["tests/d.test.ts"]}));
    expect(ev([{status: "MODIFIED", path: "src/a.ts"}], 0)).toEqual(expect.objectContaining({functionalAcceptance: "UNVERIFIED_VACUOUS", reason: "ZERO_TESTS_EXECUTED"}));
    expect(ev([{status: "MODIFIED", path: "src/a.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "UNKNOWN", reason: "NO_TEST_SURFACE_CHANGE_DETECTED_NO_PINNED_ORACLE", oracle: "NONE"}));
  });

  it("RV-RELFX-C5-OBS-1: a deleted or assertion-weakened real test stays hard BLOCKED even when its basename also matches the harness list; a pure config file only diverts to harness", () => {
    const content: Record<string, string> = {"base:tests/vitest.config.test.ts": "expect(1);expect(2);", "head:tests/vitest.config.test.ts": "expect(1);"};
    const at = (ref: string, p: string) => content[`${ref === "B" ? "base" : "head"}:${p}`] ?? null;
    const ev = (entries: ReturnType<typeof parseNameStatusZ>) => evaluateTestSurface({baseSha: "B", headSha: "H", entries, contentAt: at, executedTests: 3});
    // vitest.config.test.ts matches BOTH the harness list (vitest.config.*) and a real test-file name (*.test.*)
    expect(isHarnessChange({status: "DELETED", path: "tests/vitest.config.test.ts"}, "B", "H", at)).toBe(true);
    expect(isRealTestFile("tests/vitest.config.test.ts")).toBe(true);
    // deleted -> hard BLOCKED (TEST_DELETED), NOT downgraded to harness/acknowledgement
    expect(ev([{status: "DELETED", path: "tests/vitest.config.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_DELETED", deleted: ["tests/vitest.config.test.ts"], harness: []}));
    // assertion-weakened -> hard BLOCKED (TEST_WEAKENED), NOT harness
    expect(ev([{status: "MODIFIED", path: "tests/vitest.config.test.ts"}])).toEqual(expect.objectContaining({functionalAcceptance: "BLOCKED", reason: "TEST_WEAKENED", harness: []}));
    // a pure config/harness file (not a real test file) still diverts to harness, even when deleted (acknowledgement, not a hard block)
    expect(isRealTestFile("tests/vitest.config.ts")).toBe(false);
    expect(ev([{status: "DELETED", path: "tests/vitest.config.ts"}])).toEqual(expect.objectContaining({harness: ["tests/vitest.config.ts"], deleted: [], functionalAcceptance: "UNVERIFIED_ORACLE"}));
  });
});

describe("REL-FX-2 test-surface guard in the runner", () => {
  it("baseline: untouched tests -> TEST_SURFACE recorded, reviewer sees the list, functionalAcceptance UNKNOWN, COMPLETE allowed", { timeout: T }, async () => {
    const {c, run, specs} = await runWith({files: {"feature.txt": "ok\n"}});
    expect(run.status).toBe("AWAITING_APPROVAL");
    const ts = surfaceOf(run);
    expect(ts).toEqual(expect.objectContaining({baseSha: run.baseSha, headSha: run.headSha, added: [], modified: [], deleted: [], renamed: [], weakened: [], executedTests: 3, functionalAcceptance: "UNKNOWN"}));
    expect(run.evidence.find(e => e.kind === "TEST_SURFACE")).toEqual(expect.objectContaining({step: "VERIFY", commitSha: run.headSha, baseSha: run.baseSha}));
    expect(specs[0].testSurface).toEqual(expect.objectContaining({deleted: [], weakened: [], functionalAcceptance: "UNKNOWN"}));
    expect((await complete(c)).statusCode).toBe(200);
  });

  it("negative: the implementer deletes a test file -> functionalAcceptance BLOCKED, reviewer told, COMPLETE refused 409", { timeout: T }, async () => {
    const {c, run, specs} = await runWith({files: {"feature.txt": "ok\n"}, deleteFiles: ["tests/b.test.mjs"]});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(surfaceOf(run)).toEqual(expect.objectContaining({deleted: ["tests/b.test.mjs"], functionalAcceptance: "BLOCKED", reason: "TEST_DELETED", executedTests: 1}));
    expect(specs[0].testSurface?.deleted).toEqual(["tests/b.test.mjs"]);
    expect(deriveOutcomes(run).functionalAcceptance).toBe("BLOCKED");
    const res = await complete(c);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"});
  });

  it("negative: the implementer removes assertions -> not VERIFIED (BLOCKED, ASSERTION_COUNT_REDUCED)", { timeout: T }, async () => {
    const {c, run} = await runWith({files: {"feature.txt": "ok\n", "tests/b.test.mjs": "export function readmeIsBase() { }\nexport function readmeNotEmpty() { expect(true).toBe(true); }\n"}});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(surfaceOf(run)).toEqual(expect.objectContaining({modified: ["tests/b.test.mjs"], weakened: [{path: "tests/b.test.mjs", before: 2, after: 1, reason: "ASSERTION_COUNT_REDUCED"}], functionalAcceptance: "BLOCKED"}));
    expect((await complete(c)).statusCode).toBe(409);
  });

  it("negative: moving a test out of the test globs counts as deletion", { timeout: T }, async () => {
    const {run} = await runWith({files: {"feature.txt": "ok\n", "attic/b.mjs": B_TEST}, deleteFiles: ["tests/b.test.mjs"]});
    expect(surfaceOf(run)).toEqual(expect.objectContaining({deleted: ["tests/b.test.mjs"], functionalAcceptance: "BLOCKED"}));
  });

  it("negative: adding only a trivial test is never VERIFIED (UNVERIFIED_ORACLE with an assertion, UNVERIFIED_VACUOUS without)", { timeout: T }, async () => {
    const one = await runWith({files: {"feature.txt": "ok\n", "tests/c.test.mjs": "export function trivial() { expect(1).toBe(1); }\n"}});
    expect(surfaceOf(one.run)).toEqual(expect.objectContaining({added: ["tests/c.test.mjs"], functionalAcceptance: "UNVERIFIED_ORACLE", reason: "TEST_SURFACE_CHANGED_NO_PINNED_ORACLE", executedTests: 4}));
    expect(deriveOutcomes(one.run).functionalAcceptance).toBe("UNVERIFIED_ORACLE");
    // the Founder can still accept; the outcome is shown truthfully
    const res = await complete(one.c);
    expect(res.statusCode).toBe(200);
    expect(res.json().outcomes.functionalAcceptance).toBe("UNVERIFIED_ORACLE");
    const two = await runWith({files: {"feature.txt": "ok\n", "tests/c.test.mjs": "export function trivial() { }\n"}});
    expect(surfaceOf(two.run)).toEqual(expect.objectContaining({trivialAdded: ["tests/c.test.mjs"], functionalAcceptance: "UNVERIFIED_VACUOUS"}));
  });

  it("zero executed tests (runner count parsed) -> UNVERIFIED_VACUOUS", { timeout: T }, async () => {
    const {run} = await runWith({files: {"feature.txt": "ok\n"}}, {"run-tests.mjs": RUN_TESTS, "README.txt": "base\n"});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(surfaceOf(run)).toEqual(expect.objectContaining({executedTests: 0, functionalAcceptance: "UNVERIFIED_VACUOUS", reason: "ZERO_TESTS_EXECUTED"}));
  });
});
