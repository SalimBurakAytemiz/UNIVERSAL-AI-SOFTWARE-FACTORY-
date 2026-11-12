// //TR: FD-2026-11-03 yürütücüsü için vakalar: yalnız AUTO_MERGE kararında beklenen head SHA ile tek bir merge yazılır, merge commit'inin ebeveynleri ve base doğrulanır, diğer her kararda hiçbir yazma yapılmaz; ana dal CI doğrulaması PASS/RUNNING/FAIL ayrımını yapar.
import {describe, it, expect} from "vitest";
// @ts-expect-error untyped .mjs module
import {executeMerge, verifyMerge, verifyMain} from "../../docs/planning/autonomy/executor.mjs";
// FV2 authority fence: these cases exercise the merge path itself, so the fence is given an explicit V4.1 allowance (no registry); the fence is tested in fv2-executor-fence.cases.ts.
const ALLOW_V41 = () => ({allowed: true, by: "V4.1", reason: "TEST_NO_AUTHORITY_RECORD"});

const H = "a".repeat(40), B = "b".repeat(40), M = "c".repeat(40), X = "d".repeat(40);
const result = (decision: string) => ({decision, task: "CLOUD-T0010", expectedHeadSha: H, expectedBaseSha: B, reasons: decision === "AUTO_MERGE" ? [] : ["R"], authority: decision === "AUTO_MERGE" ? "FD" : null});
const collect = () => ({evidence: {pr: {base: {ref: "v7/integration"}}}, policy: {mergeMethod: "merge"}});
const api = (o: {parents?: string[], tip?: string, cmp?: string, tip0?: string, pr?: unknown} = {}) => { let reads = 0; return (p: string) => {
  if (p === `commits/${M}`) return {parents: (o.parents ?? [B, H]).map(sha => ({sha}))};
  if (p.startsWith("branches/")) return {commit: {sha: reads++ === 0 && o.tip0 !== "skip" ? (o.tip0 ?? B) : (o.tip ?? M)}};
  if (p.startsWith("pulls/")) return o.pr ?? {merged: false};
  if (p.startsWith("compare/")) return {status: o.cmp ?? "ahead"};
  throw new Error(`unexpected ${p}`);
}; };

export function registerAutonomyExecutorCases() {
  describe("FD-2026-11-03 executor", () => {
    it("E1 nothing is written unless the decision is AUTO_MERGE", () => {
      for (const d of ["BLOCK", "FOUNDER_REQUIRED", "INTERNAL_ERROR"]) {
        let writes = 0;
        const r = executeMerge({api: api(), write: () => { writes++; return {}; }, pr: 1, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: () => ({gate: {}, result: result(d)})});
        expect(r.decision).toBe(d);
        expect(writes).toBe(0);
      }
    });
    it("E2 AUTO_MERGE merges once with expectedHeadSha and verifies parents (base, head)", () => {
      const calls: unknown[] = [];
      const r = executeMerge({api: api(), write: (m: string, p: string, b: unknown) => { calls.push([m, p, b]); return {merged: true, sha: M}; }, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: () => ({gate: {}, result: result("AUTO_MERGE")})});
      expect(calls).toEqual([["PUT", "pulls/7/merge", {sha: H, merge_method: "merge"}]]);
      expect(r).toMatchObject({decision: "MERGED_VERIFIED", mergeSha: M, reasons: [], authority: "FD"});
    });
    it("E3 a refused or failed merge is reported, never retried", () => {
      for (const write of [() => { throw new Error("409"); }, () => ({merged: false}), () => ({merged: true, sha: "zz"})]) {
        let n = 0;
        const r = executeMerge({api: api(), write: () => { n++; return write(); }, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: () => ({gate: {}, result: result("AUTO_MERGE")})});
        expect(r.decision).toBe("MERGE_FAILED");
        expect(n).toBe(1);
      }
    });
    it("E4 merge verification: wrong parents or a base that does not contain the merge fail", () => {
      expect(verifyMerge({api: api({parents: [X, H], tip0: "skip"}), mergeSha: M, baseSha: B, headSha: H, baseRef: "v7/integration"}).reasons).toEqual(["MERGE_PARENTS_MISMATCH"]);
      expect(verifyMerge({api: api({parents: [B], tip0: "skip"}), mergeSha: M, baseSha: B, headSha: H, baseRef: "v7/integration"}).reasons).toEqual(["MERGE_PARENTS_MISMATCH"]);
      expect(verifyMerge({api: api({tip: X, cmp: "ahead", tip0: "skip"}), mergeSha: M, baseSha: B, headSha: H, baseRef: "v7/integration"}).ok).toBe(true);
      expect(verifyMerge({api: api({tip: X, cmp: "diverged", tip0: "skip"}), mergeSha: M, baseSha: B, headSha: H, baseRef: "v7/integration"}).reasons).toEqual(["BASE_DOES_NOT_CONTAIN_MERGE"]);
      const r = executeMerge({api: api({parents: [X, H]}), write: () => ({merged: true, sha: M}), pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: () => ({gate: {}, result: result("AUTO_MERGE")})});
      expect(r.decision).toBe("VERIFY_FAILED");
    });
    it("E5 main verification needs both push workflows to pass on the merge commit", () => {
      const runs = (list: unknown[]) => () => ({workflow_runs: list});
      const run = (p: string, status: string, conclusion: string | null, id = 1, head = M, attempt = 1, branch = "v7/integration") => ({path: p, status, conclusion, id, run_attempt: attempt, head_sha: head, event: "push", head_branch: branch});
      const ci = ".github/workflows/ci.yml", wi = ".github/workflows/windows-installer.yml";
      expect(verifyMain({api: runs([run(ci, "completed", "success"), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_PASS");
      expect(verifyMain({api: runs([run(ci, "in_progress", null), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_RUNNING");
      expect(verifyMain({api: runs([run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_RUNNING");
      expect(verifyMain({api: runs([run(ci, "completed", "failure"), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_FAIL");
      expect(verifyMain({api: runs([run(ci, "completed", "success", 1, X), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_RUNNING");
      expect(verifyMain({api: runs([]), sha: "nope"}).decision).toBe("INTERNAL_ERROR");
      // NB-2/NB-3: the newest run wins whatever its attempt; other branches never count; cancelled fails.
      expect(verifyMain({api: runs([run(ci, "completed", "success", 1, M, 2), run(ci, "completed", "failure", 2, M, 1), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_FAIL");
      expect(verifyMain({api: runs([run(ci, "completed", "success", 1, M, 1, "other"), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_RUNNING");
      expect(verifyMain({api: runs([run(ci, "completed", "cancelled"), run(wi, "completed", "success")]), sha: M}).decision).toBe("MAIN_FAIL");
    });
    it("E6 base moved before the merge => no write; lost response re-reads the PR; only the merge method is allowed", () => {
      let writes = 0;
      const w = () => { writes++; return {merged: true, sha: M}; };
      const d = () => ({gate: {}, result: result("AUTO_MERGE")});
      expect(executeMerge({api: api({tip0: X}), write: w, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: d}).reasons).toEqual(["BASE_MOVED_BEFORE_MERGE"]);
      expect(writes).toBe(0);
      const lost = executeMerge({api: api({pr: {merged: true, merge_commit_sha: M, head: {sha: H}}}), write: () => { throw new Error("EOF"); }, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: d});
      expect(lost).toMatchObject({decision: "MERGED_VERIFIED", mergeSha: M});
      const notMerged = executeMerge({api: api({pr: {merged: false}}), write: () => { throw new Error("EOF"); }, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: d});
      expect(notMerged.decision).toBe("MERGE_FAILED");
      const squash = executeMerge({api: api(), write: w, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect: () => ({...collect(), policy: {mergeMethod: "squash"}}), decide: d});
      expect(squash.reasons).toEqual(["MERGE_METHOD_UNSUPPORTED"]);
      expect(writes).toBe(0);
      // A base that moves inside the remaining window is detected afterwards, never reported as verified.
      expect(executeMerge({api: api({parents: [X, H]}), write: w, pr: 7, implementerSessions: ["s"], authority: ALLOW_V41, collect, decide: d}).decision).toBe("VERIFY_FAILED");
    });
  });
}
