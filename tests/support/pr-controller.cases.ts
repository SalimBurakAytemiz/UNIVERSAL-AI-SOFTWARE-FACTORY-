// //TR: docs/planning/pr-controller.mjs için kurtarma ve devam senaryoları (COORD-TRANSITION-AUTONOMY): birleştirme çatışması, base ilerlemesi (yalnız etkilenen PR güncellenir), reviewer kimlik hatası (asla CLEAN değil), aynı PR'da CI hatası, eski head'e bağlı karar, tam kanıtlı draft (MARK_READY), birleşmiş PR (POST_MERGE_VERIFY sonra NEXT_TASK), FOUNDER sınıfı, önceki ret; ayrıca auto-merge'ün yalnız tüm koşullar bu head+base'e bağlıyken açıldığı ve bir PR'ın hatasının başka PR'a eylem üretmediği değişmezleri.
import {describe, it, expect} from "vitest";
import * as C from "../../docs/planning/pr-controller.mjs";
import type {PrState} from "../../docs/planning/pr-controller.mjs";

const HEAD = "a".repeat(40), BASE = "b".repeat(40), NEWBASE = "c".repeat(40), OLDHEAD = "d".repeat(40), MERGE = "e".repeat(40);
const verified = (o: Record<string, unknown> = {}) => ({status: "PASS", headSha: HEAD, baseSha: BASE, kind: "APP", ...o});
const pr = (o: Partial<PrState> & Record<string, unknown> = {}): PrState => ({pr: 7, lane: "B", draft: false, headSha: HEAD, baseSha: BASE, mergeable_state: "clean",
  ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: HEAD}, independentVerification: verified(), riskTier: "ROUTINE", autoMerge: false, merged: false, priorNegative: false,
  ...o} as PrState);
const acts = (s: unknown) => C.nextActions(s).actions.map(a => a.action);
const plan = (s: unknown) => C.nextActions(s);

export function registerPrControllerCases() {
  describe("PR controller (COORD-TRANSITION-AUTONOMY)", () => {
    it("all conditions met on this head and base => ENABLE_AUTO_MERGE; already armed => NOOP", () => {
      expect(plan(pr())).toEqual({pr: 7, actions: [{action: "ENABLE_AUTO_MERGE", lane: null, reason: "ALL_CONDITIONS_MET"}]});
      expect(plan(pr({autoMerge: true})).actions).toEqual([{action: "NOOP", lane: null, reason: "AUTO_MERGE_ARMED"}]);
      expect(acts(pr({riskTier: "PREAUTHORIZED"}))).toEqual(["ENABLE_AUTO_MERGE"]);
      expect(acts(pr({mergeable_state: "blocked"}))).toEqual(["ENABLE_AUTO_MERGE"]);
    });
    it("merge conflict => RESOLVE_CONFLICT for the owner lane on the same PR (and an armed auto-merge is disarmed first)", () => {
      expect(plan(pr({mergeable_state: "dirty"}))).toEqual({pr: 7, actions: [{action: "RESOLVE_CONFLICT", lane: "B", reason: "MERGE_CONFLICT"}]});
      expect(acts(pr({mergeable_state: "dirty", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "RESOLVE_CONFLICT"]);
    });
    it("base advanced: only the PRs it affects are updated; a disjoint, low-risk base change leaves the verdict usable", () => {
      const moved = {baseSha: NEWBASE, prFiles: ["apps/desktop/renderer/views/flow.js", "tests/v7-flow.test.ts"]};
      const delta = (files: string[]) => ({baseDelta: {fromBaseSha: BASE, toBaseSha: NEWBASE, files}});
      const affected = pr({...moved, ...delta(["apps/desktop/renderer/views/flow.js"])});
      const unaffected = pr({...moved, ...delta(["core/workos/crew/analysis.ts", "docs/x.md"])});
      const unknown = pr({...moved});
      const risky = pr({...moved, ...delta(["config/validation.json"])});
      const wrongFrom = pr({...moved, baseDelta: {fromBaseSha: OLDHEAD, toBaseSha: NEWBASE, files: ["docs/x.md"]}});
      const res = C.planAll([affected, unaffected, unknown, risky, wrongFrom]).map(p => p.actions.map(a => a.action));
      expect(res).toEqual([["UPDATE_BRANCH"], ["ENABLE_AUTO_MERGE"], ["UPDATE_BRANCH"], ["UPDATE_BRANCH"], ["UPDATE_BRANCH"]]);
      expect(C.nextActions(affected).actions[0].reason).toBe("BASE_CHANGED_AFFECTED");
      expect(acts(pr({mergeable_state: "behind"}))).toEqual(["UPDATE_BRANCH"]);
    });
    it("reviewer auth failure with no trusted alternative => BLOCK_REVIEW_AUTH, never auto-merge; a trusted alternative unblocks", () => {
      const auth = verified({status: "AUTH_FAILED"});
      expect(plan(pr({independentVerification: auth}))).toEqual({pr: 7, actions: [{action: "BLOCK_REVIEW_AUTH", lane: null, reason: "REVIEWER_AUTH_FAILED"}]});
      expect(acts(pr({independentVerification: auth, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "BLOCK_REVIEW_AUTH"]);
      // A process review counts only when it is explicitly an independent session.
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS"})]}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS", independentSession: "yes"})]}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(plan(pr({independentVerification: verified({kind: "PROCESS"})})).actions).toEqual([{action: "REQUEST_INDEPENDENT_VERIFICATION", lane: null, reason: "VERIFIER_NOT_INDEPENDENT"}]);
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS", independentSession: true})]}))).toEqual(["ENABLE_AUTO_MERGE"]);
    });
    it("CI failure => FIX_CI for the owner lane on the same PR; pending, missing or stale CI => WAIT_CI", () => {
      expect(plan(pr({ciRequired: {ubuntu: "PASS", windows: "FAIL", headSha: HEAD}}))).toEqual({pr: 7, actions: [{action: "FIX_CI", lane: "B", reason: "CI_FAILED"}]});
      expect(plan(pr({ciRequired: {ubuntu: "PENDING", windows: "PASS"}})).actions[0]).toEqual({action: "WAIT_CI", lane: null, reason: "CI_PENDING"});
      expect(plan(pr({ciRequired: {ubuntu: "MISSING", windows: "PASS"}})).actions[0].reason).toBe("CI_MISSING");
      expect(plan(pr({ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: OLDHEAD}})).actions[0].reason).toBe("CI_STALE");
      expect(acts(pr({ciRequired: {ubuntu: "FAIL", windows: "FAIL"}, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "FIX_CI"]);
    });
    it("a verdict bound to an older head => REVERIFY; an untrusted or missing verdict => REQUEST_INDEPENDENT_VERIFICATION; a failed verdict => REMEDIATE_REVIEW by the lane", () => {
      expect(plan(pr({independentVerification: verified({headSha: OLDHEAD})})).actions).toEqual([{action: "REVERIFY", lane: null, reason: "VERIFICATION_STALE_HEAD"}]);
      expect(plan(pr({independentVerification: null})).actions[0].reason).toBe("VERIFICATION_MISSING");
      expect(plan(pr({independentVerification: verified({status: "MISSING"})})).actions[0].reason).toBe("VERIFICATION_MISSING");
      expect(plan(pr({independentVerification: verified({status: "FAIL"})})).actions).toEqual([{action: "REMEDIATE_REVIEW", lane: "B", reason: "VERIFICATION_FAILED"}]);
      expect(acts(pr({independentVerification: verified({headSha: OLDHEAD}), autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "REVERIFY"]);
    });
    it("a draft with complete evidence => MARK_READY, then ENABLE_AUTO_MERGE; a draft with green CI and no verdict => MARK_READY only (its ready event starts the review)", () => {
      expect(acts(pr({draft: true, mergeable_state: "draft"}))).toEqual(["MARK_READY", "ENABLE_AUTO_MERGE"]);
      expect(acts(pr({draft: true, independentVerification: null}))).toEqual(["MARK_READY"]);
      expect(acts(pr({draft: true, ciRequired: {ubuntu: "PENDING", windows: "PASS"}}))).toEqual(["WAIT_CI"]);
      expect(acts(pr({draft: true, mergeable_state: "dirty"}))).toEqual(["RESOLVE_CONFLICT"]);
    });
    it("merged => POST_MERGE_VERIFY then NEXT_TASK for the lane; verified => NEXT_TASK; a post-merge mismatch => FOUNDER_REQUIRED", () => {
      expect(plan(pr({merged: true, mergeCommit: MERGE}))).toEqual({pr: 7, actions: [{action: "POST_MERGE_VERIFY", lane: null, reason: "MERGED_UNVERIFIED"},
        {action: "NEXT_TASK", lane: "B", reason: "MERGED_UNVERIFIED"}]});
      expect(plan(pr({merged: true})).actions[0].reason).toBe("MERGE_COMMIT_UNKNOWN");
      expect(plan(pr({merged: true, postMerge: "VERIFIED"})).actions).toEqual([{action: "NEXT_TASK", lane: "B", reason: "MERGED_VERIFIED"}]);
      expect(plan(pr({merged: true, postMerge: "MISMATCH"})).actions).toEqual([{action: "FOUNDER_REQUIRED", lane: null, reason: "POST_MERGE_MISMATCH"}]);
    });
    it("FOUNDER tier => FOUNDER_REQUIRED and never auto-merge (an armed auto-merge is disarmed); the Founder's approval of this exact head allows it", () => {
      expect(acts(pr({riskTier: "FOUNDER"}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(acts(pr({riskTier: "FOUNDER", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "FOUNDER_REQUIRED"]);
      expect(acts(pr({riskTier: "FOUNDER", founderApprovedHead: OLDHEAD}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(acts(pr({riskTier: "FOUNDER", founderApprovedHead: HEAD}))).toEqual(["ENABLE_AUTO_MERGE"]);
      // Founder authority is reported alongside the lane's own work, which continues.
      expect(acts(pr({riskTier: "FOUNDER", ciRequired: {ubuntu: "FAIL", windows: "PASS"}}))).toEqual(["FOUNDER_REQUIRED", "FIX_CI"]);
      expect(acts(pr({riskTier: undefined}))).toEqual(["NOOP"]);
      expect(plan(pr({riskTier: "SOMETHING"})).actions[0].reason).toBe("RISK_TIER_UNKNOWN");
    });
    it("a prior negative verdict on this content => FOUNDER_REQUIRED; an unknown prior record never auto-merges", () => {
      expect(plan(pr({priorNegative: true})).actions).toEqual([{action: "FOUNDER_REQUIRED", lane: null, reason: "PRIOR_NEGATIVE_VERDICT"}]);
      expect(acts(pr({priorNegative: true, founderApprovedHead: HEAD}))).toEqual(["ENABLE_AUTO_MERGE"]);
      expect(plan(pr({priorNegative: null})).actions).toEqual([{action: "NOOP", lane: null, reason: "PRIOR_VERDICT_UNKNOWN"}]);
      expect(acts(pr({priorNegative: undefined, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "NOOP"]);
    });
    it("unknown mergeability waits; a malformed state does nothing except disarm an armed auto-merge", () => {
      expect(plan(pr({mergeable_state: "unknown"})).actions[0].reason).toBe("MERGEABILITY_UNKNOWN");
      expect(plan(pr({mergeable_state: null})).actions[0].reason).toBe("MERGEABILITY_UNKNOWN");
      for (const bad of [null, "x", {}, pr({headSha: "HEAD"}), pr({draft: "false" as unknown as boolean}), pr({ciRequired: {ubuntu: "GREEN", windows: "PASS"}}), pr({mergeable_state: "weird"})])
        expect(plan(bad).actions.map(a => a.reason)).toEqual(["STATE_MALFORMED"]);
      expect(acts(pr({headSha: "HEAD", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "NOOP"]);
    });
    it("a failure in one PR never yields actions for another PR (planAll is per-PR and isolated)", () => {
      const ok = pr({pr: 1, lane: "A"}), broken = {pr: 2, lane: "C", headSha: 5}, conflict = pr({pr: 3, lane: "C", mergeable_state: "dirty"}), ci = pr({pr: 4, lane: "A", ciRequired: {ubuntu: "FAIL", windows: "PASS"}});
      const throwing = Object.defineProperty(pr({pr: 5}), "ciRequired", {get() { throw new Error("boom"); }});
      const all = C.planAll([ok, broken, conflict, ci, throwing]);
      expect(all.map(p => p.actions.map(a => a.action))).toEqual([["ENABLE_AUTO_MERGE"], ["NOOP"], ["RESOLVE_CONFLICT"], ["FIX_CI"], ["NOOP"]]);
      expect(all[0]).toEqual(C.nextActions(ok));
      expect(all[2].actions[0].lane).toBe("C");
      expect(all[3]).toEqual({pr: 4, actions: [{action: "FIX_CI", lane: "A", reason: "CI_FAILED"}]});
      expect(all[4].actions[0].reason).toBe("INTERNAL_ERROR");
      expect(C.planAll("x" as unknown)).toEqual([]);
    });
    it("invariant over every combination: ENABLE_AUTO_MERGE only with CI PASS on this head, a trusted PASS bound to this head and base, no conflict, a non-FOUNDER tier (or the Founder's approval of this head) and no prior negative; outputs are fixed codes", () => {
      let enabled = 0, total = 0;
      for (const ci of C.CI_VALUES) for (const st of C.VERIFICATION_STATUSES) for (const kind of C.VERIFICATION_KINDS) for (const vHead of [HEAD, OLDHEAD]) for (const vBase of [BASE, NEWBASE])
        for (const tier of ["ROUTINE", "PREAUTHORIZED", "FOUNDER"]) for (const ms of C.MERGEABLE_STATES) for (const prior of [false, true]) for (const founder of [null, HEAD]) for (const draft of [false, true]) {
          const s = pr({draft, mergeable_state: ms, ciRequired: {ubuntu: "PASS", windows: ci, headSha: HEAD}, independentVerification: {status: st, headSha: vHead, baseSha: vBase, kind},
            riskTier: tier, priorNegative: prior, founderApprovedHead: founder});
          const p = C.nextActions(s);
          total++;
          for (const a of p.actions) { expect(C.ACTIONS).toContain(a.action); expect(C.REASONS).toContain(a.reason); }
          if (!p.actions.some(a => a.action === "ENABLE_AUTO_MERGE")) continue;
          enabled++;
          expect(ci).toBe("PASS");
          expect([st, vHead, vBase, kind]).toEqual(["PASS", HEAD, BASE, "APP"]);
          expect(["dirty", "behind", "unknown"]).not.toContain(ms);
          expect(tier !== "FOUNDER" || founder === HEAD).toBe(true);
          expect(!prior || founder === HEAD).toBe(true);
          if (draft) expect(p.actions[0].action).toBe("MARK_READY");
        }
      expect(total).toBeGreaterThan(5000);
      expect(enabled).toBeGreaterThan(0);
    });
  });
}
