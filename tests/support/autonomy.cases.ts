// //TR: Founder kalıcı otonomi kararının (FD-2026-11-03-STANDING-AUTONOMY) karar modülü için vakalar: yalnız merge-gate MERGE + kapsanan kademe + açık kapı yoksa AUTO_MERGE; korumalı/CI yolu, T3, ücretli/dış hesap kapıları FOUNDER_REQUIRED; diğer her şey BLOCK; sıradaki görev seçimi engelli görevlerde durmaz.
import fs from "node:fs";
import {describe, it, expect} from "vitest";
// @ts-expect-error untyped .mjs module
import {decideAutoMerge, nextTasks, taskOf, openGates, decideFor, loadPolicy, loadIndex, loadState} from "../../docs/planning/autonomy/autonomy.mjs";

const SHA = "a".repeat(40), BASE = "b".repeat(40);
const merge = {decision: "MERGE", reasons: [], expectedHeadSha: SHA, expectedBaseSha: BASE};
const block = (...reasons: string[]) => ({decision: "BLOCK", reasons, expectedHeadSha: SHA, expectedBaseSha: BASE});
const policy = {
  decisionId: "FD-TEST", coveredTiers: ["T0", "T1", "T2"], standingGates: ["D-31"], satisfiedGates: {"D-01": "x"},
  founderOnlyGateReasons: {"D-08": "PAID_SPEND", "D-03": "EXTERNAL_PROVIDER_OR_ACCOUNT"}, founderRequiredGateReasons: ["PROTECTED_PATH", "CI_EXECUTED_PATH"],
};
const t = (id: string, tier: string, o: Record<string, unknown> = {}) => ({id, tier, status: "MISSING", wave: "W0", deps: [], startGates: [], mergeGates: ["D-31"], exec: "CLOUD", name: id, ...o});
const index = {tasks: [t("CLOUD-T0010", "T2"), t("UASCO-T0072", "T3"), t("CLOUD-T0015", "T2", {mergeGates: ["D-31", "D-08"]}), t("V3-T1099", "T1", {startGates: ["D-77"]})]};
const body = (id: string) => `Summary\n\nUASCO-TASK: ${id}\n`;

export function registerAutonomyCases() {
  describe("standing autonomy authority (FD-2026-11-03)", () => {
    it("A1 merge-gate MERGE + covered T2 task with only D-31 => AUTO_MERGE bound to the head SHA", () => {
      const r = decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index});
      expect(r).toMatchObject({decision: "AUTO_MERGE", task: "CLOUD-T0010", expectedHeadSha: SHA, authority: "FD-TEST", reasons: []});
    });
    it("A2 a T3 task is never auto-merged", () => {
      const r = decideAutoMerge({gate: merge, body: body("UASCO-T0072"), policy, index});
      expect(r.decision).toBe("FOUNDER_REQUIRED");
      expect(r.reasons).toContain("TIER_NOT_COVERED:T3");
      expect(r.authority).toBeNull();
    });
    it("A3 protected or CI-executed paths => FOUNDER_REQUIRED, never AUTO_MERGE", () => {
      for (const g of [block("PROTECTED_PATH"), block("CI_EXECUTED_PATH:npm-manifest")]) {
        const r = decideAutoMerge({gate: g, body: body("CLOUD-T0010"), policy, index});
        expect(r.decision).toBe("FOUNDER_REQUIRED");
        expect(r.reasons[0]).toMatch(/^PROTECTED_GOVERNANCE:/);
      }
    });
    it("A4 any other gate reason blocks, even next to a protected path", () => {
      expect(decideAutoMerge({gate: block("CHECK_FAILED:validate (windows-latest)"), body: body("CLOUD-T0010"), policy, index}).decision).toBe("BLOCK");
      expect(decideAutoMerge({gate: block("PROTECTED_PATH", "VERDICT_MISSING"), body: body("CLOUD-T0010"), policy, index}).decision).toBe("BLOCK");
      expect(decideAutoMerge({gate: {decision: "BLOCK"}, body: body("CLOUD-T0010"), policy, index}).decision).toBe("BLOCK");
      expect(decideAutoMerge({gate: {decision: "MERGE_PLEASE", reasons: []}, body: body("CLOUD-T0010"), policy, index}).decision).toBe("BLOCK");
    });
    it("A5 the PR must name exactly one known task on its own line", () => {
      expect(taskOf("UASCO-TASK: CLOUD-T0010\nUASCO-TASK: CLOUD-T0015")).toBeNull();
      expect(taskOf("> UASCO-TASK: CLOUD-T0010")).toBeNull();
      expect(taskOf("  UASCO-TASK: CLOUD-T0010")).toBeNull();
      expect(taskOf("UASCO-TASK: UASCO-T0016.A")).toBeNull();
      expect(taskOf("UASCO-TASK: V3-T1012.a")).toBe("V3-T1012.a");
      expect(decideAutoMerge({gate: merge, body: "no task", policy, index}).reasons).toContain("TASK_ID_MISSING_OR_AMBIGUOUS");
      expect(decideAutoMerge({gate: merge, body: body("CLOUD-T9999"), policy, index}).reasons).toContain("TASK_UNKNOWN");
    });
    it("A6 spend/provider gates and undecided gates go to the Founder", () => {
      expect(decideAutoMerge({gate: merge, body: body("CLOUD-T0015"), policy, index}).reasons).toEqual(["PAID_SPEND:D-08"]);
      expect(openGates(index.tasks[3], policy)).toEqual(["GATE_UNDECIDED:D-77"]);
    });
    it("A7 next task selection: typed deps, persistent state, held tasks never stop unrelated ones", () => {
      const ix = {tasks: [t("A-T0001", "T2", {status: "ASSET_DONE"}), t("A-T0002", "T2", {deps: [["A-T0001", "MERGED"]], wave: "W1"}),
        t("A-T0003", "T2", {deps: [["A-T0009", "MERGED"]]}), t("A-T0004", "T3"), t("A-T0005", "T1", {wave: "W0"}), t("A-T0006", "T2", {status: "BLOCKED"}),
        t("A-T0007", "T2"), t("A-T0008", "T2", {exec: "LOCAL"})]};
      const r = nextTasks({index: ix, state: {done: [{task: "A-T0007", pr: 1}], inFlight: [], blocked: []}, policy, limit: 10});
      expect(r.ready.map((x: {task: string}) => x.task)).toEqual(["A-T0005", "A-T0002"]);
      expect(r.founderHeld).toBe(1);
    });
    it("A8 the committed policy, record, index and state are consistent", () => {
      const p = loadPolicy(), ix = loadIndex(), st = loadState();
      expect(p.decisionId).toBe("FD-2026-11-03-STANDING-AUTONOMY");
      expect(fs.existsSync(p.record)).toBe(true);
      expect(p.coveredTiers).not.toContain("T3");
      expect(ix.count).toBe(256);
      expect(ix.tasks).toHaveLength(256);
      expect(ix.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      for (const d of st.done) expect(ix.tasks.some((x: {id: string}) => x.id === d.task)).toBe(true);
    });
    it("A9 integration with the real merge-gate: malformed or empty evidence never auto-merges", () => {
      for (const evidence of [{}, {pr: {number: 1}}, null]) {
        const {result} = decideFor({evidence, body: body("CLOUD-T0010")});
        expect(result.decision).toBe("BLOCK");
      }
    });
  });
}
