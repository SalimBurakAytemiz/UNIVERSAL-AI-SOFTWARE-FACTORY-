// //TR: docs/planning/pr-controller.mjs için kurtarma ve devam senaryoları (COORD-TRANSITION-AUTONOMY): birleştirme çatışması, base ilerlemesi (yalnız etkilenen PR güncellenir), reviewer kimlik hatası (asla CLEAN değil), aynı PR'da CI hatası, eski head'e bağlı karar, aynı head'de FAIL+PASS (ret oylanıp geçilemez), tam kanıtlı draft (MARK_READY), birleşmiş PR (POST_MERGE_VERIFY sonra NEXT_TASK), FOUNDER sınıfı, önceki ret, head'e bağlı olmayan GitHub auto-merge'ün kapatılması; ayrıca birleştirmenin (MERGE_HEAD) yalnız tüm koşullar bu head+base'e bağlıyken ve head SHA'sını taşıyarak üretildiği ve bir PR'ın hatasının başka PR'a eylem üretmediği değişmezleri.
import {describe, it, expect} from "vitest";
import * as C from "../../docs/planning/pr-controller.mjs";
import type {PrState, Verification} from "../../docs/planning/pr-controller.mjs";

const HEAD = "a".repeat(40), BASE = "b".repeat(40), NEWBASE = "c".repeat(40), OLDHEAD = "d".repeat(40), MERGE = "e".repeat(40);
const verified = (o: Record<string, unknown> = {}): Verification => ({status: "PASS", headSha: HEAD, baseSha: BASE, kind: "APP", ...o});
const pr = (o: Partial<PrState> & Record<string, unknown> = {}): PrState => ({pr: 7, lane: "B", draft: false, headSha: HEAD, baseSha: BASE, mergeable_state: "clean",
  ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: HEAD}, independentVerification: verified(), riskTier: "ROUTINE", autoMerge: false, merged: false, priorNegative: false,
  ...o} as PrState);
const acts = (s: unknown) => C.nextActions(s).actions.map(a => a.action);
const plan = (s: unknown) => C.nextActions(s);
const MERGED_HEAD = {action: "MERGE_HEAD", lane: null, reason: "ALL_CONDITIONS_MET", headSha: HEAD};

export function registerPrControllerCases() {
  describe("PR controller (COORD-TRANSITION-AUTONOMY)", () => {
    it("all conditions met on this head and base => MERGE_HEAD carrying the head SHA (the coordinator never arms GitHub auto-merge)", () => {
      expect(plan(pr())).toEqual({pr: 7, actions: [MERGED_HEAD]});
      expect(acts(pr({riskTier: "PREAUTHORIZED"}))).toEqual(["MERGE_HEAD"]);
      // A blocked state is tried: the head-bound merge call fails and the executor stops there.
      expect(acts(pr({mergeable_state: "blocked"}))).toEqual(["MERGE_HEAD"]);
      expect(C.ACTIONS).not.toContain("ENABLE_AUTO_MERGE");
    });
    it("an armed GitHub auto-merge is not bound to the head (#218: armed on a2ed5c11, merged 16f47821 after a push): it is disarmed unless it was armed on this exact head", () => {
      expect(plan(pr({autoMerge: true})).actions).toEqual([{action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_BOUND_TO_HEAD"}, MERGED_HEAD]);
      expect(acts(pr({autoMerge: true, autoMergeArmedHead: OLDHEAD}))).toEqual(["DISABLE_AUTO_MERGE", "MERGE_HEAD"]);
      expect(acts(pr({autoMerge: true, autoMergeArmedHead: HEAD}))).toEqual(["MERGE_HEAD"]);
      // Armed on a ROUTINE head, then a FOUNDER-tier head was pushed: the stale arm is removed before GitHub can merge the new head on the validate checks alone.
      expect(acts(pr({autoMerge: true, autoMergeArmedHead: OLDHEAD, riskTier: "FOUNDER"}))).toEqual(["DISABLE_AUTO_MERGE", "FOUNDER_REQUIRED"]);
      expect(acts(pr({autoMerge: true, autoMergeArmedHead: "HEAD", riskTier: "FOUNDER"}))).toEqual(["DISABLE_AUTO_MERGE", "FOUNDER_REQUIRED"]);
      // Armed on this FOUNDER-tier head: the Founder's own decision; the controller neither merges nor disarms.
      expect(acts(pr({autoMerge: true, autoMergeArmedHead: HEAD, riskTier: "FOUNDER"}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(acts(pr({autoMerge: true, ciRequired: {ubuntu: "PENDING", windows: "PASS", headSha: HEAD}}))).toEqual(["DISABLE_AUTO_MERGE", "WAIT_CI"]);
    });
    it("merge conflict => RESOLVE_CONFLICT for the owner lane on the same PR (and an unbound auto-merge is disarmed first)", () => {
      expect(plan(pr({mergeable_state: "dirty"}))).toEqual({pr: 7, actions: [{action: "RESOLVE_CONFLICT", lane: "B", reason: "MERGE_CONFLICT"}]});
      expect(acts(pr({mergeable_state: "dirty", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "RESOLVE_CONFLICT"]);
    });
    it("base advanced: only the PRs it affects are updated; a disjoint, low-risk base change leaves the verdict usable; an empty PR file list counts as affected", () => {
      const moved = {baseSha: NEWBASE, prFiles: ["apps/desktop/renderer/views/flow.js", "tests/v7-flow.test.ts"]};
      const delta = (files: string[]) => ({baseDelta: {fromBaseSha: BASE, toBaseSha: NEWBASE, files}});
      const affected = pr({...moved, ...delta(["apps/desktop/renderer/views/flow.js"])});
      const unaffected = pr({...moved, ...delta(["core/workos/crew/analysis.ts", "docs/x.md"])});
      const unknown = pr({...moved});
      const risky = pr({...moved, ...delta(["config/validation.json"])});
      const wrongFrom = pr({...moved, baseDelta: {fromBaseSha: OLDHEAD, toBaseSha: NEWBASE, files: ["docs/x.md"]}});
      const noPrFiles = pr({...moved, prFiles: [], ...delta(["src/a.ts"])});
      const noDelta = pr({...moved, ...delta([])});
      const res = C.planAll([affected, unaffected, unknown, risky, wrongFrom, noPrFiles, noDelta]).map(p => p.actions.map(a => a.action));
      expect(res).toEqual([["UPDATE_BRANCH"], ["MERGE_HEAD"], ["UPDATE_BRANCH"], ["UPDATE_BRANCH"], ["UPDATE_BRANCH"], ["UPDATE_BRANCH"], ["UPDATE_BRANCH"]]);
      expect(C.nextActions(affected).actions[0].reason).toBe("BASE_CHANGED_AFFECTED");
      expect(acts(pr({mergeable_state: "behind"}))).toEqual(["UPDATE_BRANCH"]);
    });
    it("reviewer auth failure with no trusted alternative => BLOCK_REVIEW_AUTH, never a merge; a trusted alternative unblocks", () => {
      const auth = verified({status: "AUTH_FAILED"});
      expect(plan(pr({independentVerification: auth}))).toEqual({pr: 7, actions: [{action: "BLOCK_REVIEW_AUTH", lane: null, reason: "REVIEWER_AUTH_FAILED"}]});
      expect(acts(pr({independentVerification: auth, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "BLOCK_REVIEW_AUTH"]);
      // A process review counts only when it is explicitly an independent session.
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS"})]}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS", independentSession: "yes"})]}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(plan(pr({independentVerification: verified({kind: "PROCESS"})})).actions).toEqual([{action: "REQUEST_INDEPENDENT_VERIFICATION", lane: null, reason: "VERIFIER_NOT_INDEPENDENT"}]);
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS", independentSession: true})]}))).toEqual(["MERGE_HEAD"]);
    });
    it("CI failure => FIX_CI for the owner lane on the same PR; pending, missing, stale or unbound CI => WAIT_CI", () => {
      expect(plan(pr({ciRequired: {ubuntu: "PASS", windows: "FAIL", headSha: HEAD}}))).toEqual({pr: 7, actions: [{action: "FIX_CI", lane: "B", reason: "CI_FAILED"}]});
      expect(plan(pr({ciRequired: {ubuntu: "PENDING", windows: "PASS", headSha: HEAD}})).actions[0]).toEqual({action: "WAIT_CI", lane: null, reason: "CI_PENDING"});
      expect(plan(pr({ciRequired: {ubuntu: "MISSING", windows: "PASS", headSha: HEAD}})).actions[0].reason).toBe("CI_MISSING");
      expect(plan(pr({ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: OLDHEAD}})).actions[0].reason).toBe("CI_STALE");
      // CI PASS that is not bound to a head SHA is not this head's CI.
      expect(plan(pr({ciRequired: {ubuntu: "PASS", windows: "PASS"}})).actions).toEqual([{action: "WAIT_CI", lane: null, reason: "CI_HEAD_UNKNOWN"}]);
      expect(acts(pr({ciRequired: {ubuntu: "FAIL", windows: "FAIL", headSha: HEAD}, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "FIX_CI"]);
    });
    it("a verdict bound to an older head => REVERIFY; an untrusted or missing verdict => REQUEST_INDEPENDENT_VERIFICATION; a failed verdict => REMEDIATE_REVIEW by the lane", () => {
      expect(plan(pr({independentVerification: verified({headSha: OLDHEAD})})).actions).toEqual([{action: "REVERIFY", lane: null, reason: "VERIFICATION_STALE_HEAD"}]);
      expect(plan(pr({independentVerification: null})).actions[0].reason).toBe("VERIFICATION_MISSING");
      expect(plan(pr({independentVerification: verified({status: "MISSING"})})).actions[0].reason).toBe("VERIFICATION_MISSING");
      expect(plan(pr({independentVerification: verified({status: "FAIL"})})).actions).toEqual([{action: "REMEDIATE_REVIEW", lane: "B", reason: "VERIFICATION_FAILED"}]);
      expect(acts(pr({independentVerification: verified({headSha: OLDHEAD}), autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "REVERIFY"]);
    });
    it("a FAIL verdict on this head is never outvoted by a PASS on the same head (re-review after a negative verdict => Founder), in any order and from any reviewer", () => {
      const both: [string, Verification[]][] = [
        ["APP FAIL + independent PROCESS PASS", [verified({status: "FAIL"}), verified({kind: "PROCESS", independentSession: true})]],
        ["independent PROCESS FAIL + APP PASS", [verified({status: "FAIL", kind: "PROCESS", independentSession: true}), verified()]],
        ["APP FAIL + APP PASS", [verified({status: "FAIL"}), verified()]],
        ["APP PASS + APP FAIL", [verified(), verified({status: "FAIL"})]],
        ["builder PROCESS FAIL + APP PASS", [verified({status: "FAIL", kind: "PROCESS"}), verified()]],
      ];
      for (const [name, list] of both) expect(acts(pr({independentVerification: list})), name).toEqual(["FOUNDER_REQUIRED", "REMEDIATE_REVIEW"]);
      expect(plan(pr({independentVerification: [verified({status: "FAIL"}), verified()]})).actions[0].reason).toBe("PRIOR_NEGATIVE_VERDICT");
      // A FAIL on an older head does not block a PASS on this head (the caller's priorNegative covers the same tree).
      expect(acts(pr({independentVerification: [verified({status: "FAIL", headSha: OLDHEAD}), verified()]}))).toEqual(["MERGE_HEAD"]);
    });
    it("a draft with complete evidence => MARK_READY, then MERGE_HEAD; a draft with green CI and no verdict => MARK_READY only (its ready event starts the review)", () => {
      expect(acts(pr({draft: true, mergeable_state: "draft"}))).toEqual(["MARK_READY", "MERGE_HEAD"]);
      expect(acts(pr({draft: true, independentVerification: null}))).toEqual(["MARK_READY"]);
      expect(acts(pr({draft: true, ciRequired: {ubuntu: "PENDING", windows: "PASS", headSha: HEAD}}))).toEqual(["WAIT_CI"]);
      expect(acts(pr({draft: true, mergeable_state: "dirty"}))).toEqual(["RESOLVE_CONFLICT"]);
    });
    it("merged => POST_MERGE_VERIFY then NEXT_TASK for the lane; verified => NEXT_TASK; a post-merge mismatch => FOUNDER_REQUIRED", () => {
      expect(plan(pr({merged: true, mergeCommit: MERGE}))).toEqual({pr: 7, actions: [{action: "POST_MERGE_VERIFY", lane: null, reason: "MERGED_UNVERIFIED"},
        {action: "NEXT_TASK", lane: "B", reason: "MERGED_UNVERIFIED"}]});
      expect(plan(pr({merged: true})).actions[0].reason).toBe("MERGE_COMMIT_UNKNOWN");
      expect(plan(pr({merged: true, postMerge: "VERIFIED"})).actions).toEqual([{action: "NEXT_TASK", lane: "B", reason: "MERGED_VERIFIED"}]);
      expect(plan(pr({merged: true, postMerge: "MISMATCH"})).actions).toEqual([{action: "FOUNDER_REQUIRED", lane: null, reason: "POST_MERGE_MISMATCH"}]);
    });
    it("FOUNDER tier => FOUNDER_REQUIRED and never a merge; no input field stands for a Founder approval (a stray founderApprovedHead unlocks nothing)", () => {
      expect(plan(pr({riskTier: "FOUNDER"})).actions).toEqual([{action: "FOUNDER_REQUIRED", lane: null, reason: "RISK_TIER_FOUNDER"}]);
      expect(acts(pr({riskTier: "FOUNDER", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "FOUNDER_REQUIRED"]);
      expect(acts(pr({riskTier: "FOUNDER", founderApprovedHead: HEAD}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(acts(pr({riskTier: "FOUNDER", independentVerification: verified({kind: "PROCESS", independentSession: true}), founderApprovedHead: HEAD}))).toEqual(["FOUNDER_REQUIRED"]);
      // Founder authority is reported alongside the lane's own work, which continues.
      expect(acts(pr({riskTier: "FOUNDER", ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}}))).toEqual(["FOUNDER_REQUIRED", "FIX_CI"]);
      expect(acts(pr({riskTier: undefined}))).toEqual(["NOOP"]);
      expect(plan(pr({riskTier: "SOMETHING"})).actions[0].reason).toBe("RISK_TIER_UNKNOWN");
    });
    it("a prior negative verdict on this content => FOUNDER_REQUIRED (nothing overrides it); an unknown prior record never merges", () => {
      expect(plan(pr({priorNegative: true})).actions).toEqual([{action: "FOUNDER_REQUIRED", lane: null, reason: "PRIOR_NEGATIVE_VERDICT"}]);
      expect(acts(pr({priorNegative: true, founderApprovedHead: HEAD}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(plan(pr({priorNegative: null})).actions).toEqual([{action: "NOOP", lane: null, reason: "PRIOR_VERDICT_UNKNOWN"}]);
      expect(acts(pr({priorNegative: undefined, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "NOOP"]);
    });
    it("unknown mergeability waits; a malformed state (a missing PR number included) does nothing except disarm an armed auto-merge", () => {
      expect(plan(pr({mergeable_state: "unknown"})).actions[0].reason).toBe("MERGEABILITY_UNKNOWN");
      expect(plan(pr({mergeable_state: null})).actions[0].reason).toBe("MERGEABILITY_UNKNOWN");
      for (const bad of [null, "x", {}, pr({headSha: "HEAD"}), pr({draft: "false" as unknown as boolean}), pr({ciRequired: {ubuntu: "GREEN", windows: "PASS", headSha: HEAD}}),
        pr({mergeable_state: "weird"}), pr({pr: undefined}), pr({pr: 0}), pr({pr: "7" as unknown as number})])
        expect(plan(bad).actions.map(a => a.reason)).toEqual(["STATE_MALFORMED"]);
      expect(acts(pr({headSha: "HEAD", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "NOOP"]);
      expect(plan(pr({pr: undefined, mergeable_state: "dirty", autoMerge: true}))).toEqual({pr: null, actions: [{action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_BOUND_TO_HEAD"},
        {action: "NOOP", lane: null, reason: "STATE_MALFORMED"}]});
    });
    it("a failure in one PR never yields actions for another PR (planAll is per-PR and isolated)", () => {
      const ok = pr({pr: 1, lane: "A"}), broken = {pr: 2, lane: "C", headSha: 5}, conflict = pr({pr: 3, lane: "C", mergeable_state: "dirty"}),
        ci = pr({pr: 4, lane: "A", ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}});
      const throwing = Object.defineProperty(pr({pr: 5}), "ciRequired", {get() { throw new Error("boom"); }});
      const all = C.planAll([ok, broken, conflict, ci, throwing]);
      expect(all.map(p => p.actions.map(a => a.action))).toEqual([["MERGE_HEAD"], ["NOOP"], ["RESOLVE_CONFLICT"], ["FIX_CI"], ["NOOP"]]);
      expect(all[0]).toEqual(C.nextActions(ok));
      expect(all[2].actions[0].lane).toBe("C");
      expect(all[3]).toEqual({pr: 4, actions: [{action: "FIX_CI", lane: "A", reason: "CI_FAILED"}]});
      expect(all[4].actions[0].reason).toBe("INTERNAL_ERROR");
      expect(C.planAll("x" as unknown)).toEqual([]);
    });
    it("invariant over every combination (several verdicts per PR included): MERGE_HEAD only with CI PASS bound to this head, a trusted PASS bound to this head and base, no FAIL on the head, no conflict, a non-FOUNDER tier and no prior negative; an unbound auto-merge is always disarmed first; outputs are fixed codes", {timeout: 120000}, () => {
      let merged = 0, total = 0;
      const failures: string[] = [];
      const extras: Verification[][] = [[], [{status: "FAIL", headSha: HEAD, baseSha: BASE, kind: "APP"}],
        [{status: "PASS", headSha: HEAD, baseSha: BASE, kind: "PROCESS", independentSession: true}], [{status: "AUTH_FAILED", headSha: HEAD, baseSha: BASE, kind: "APP"}]];
      const arms: [boolean, string | null][] = [[false, null], [true, null], [true, HEAD], [true, OLDHEAD]];
      for (const ci of C.CI_VALUES) for (const st of C.VERIFICATION_STATUSES) for (const kind of C.VERIFICATION_KINDS) for (const vHead of [HEAD, OLDHEAD]) for (const vBase of [BASE, NEWBASE])
        for (const tier of ["ROUTINE", "PREAUTHORIZED", "FOUNDER"]) for (const ms of C.MERGEABLE_STATES) for (const prior of [false, true]) for (const extra of extras)
          for (const [autoMerge, armed] of arms) for (const draft of [false, true]) {
            const list = [{status: st, headSha: vHead, baseSha: vBase, kind}, ...extra];
            const s = pr({draft, mergeable_state: ms, ciRequired: {ubuntu: "PASS", windows: ci, headSha: HEAD}, independentVerification: list, riskTier: tier, priorNegative: prior,
              autoMerge, autoMergeArmedHead: armed, founderApprovedHead: HEAD});
            const p = C.nextActions(s);
            total++;
            // Plain checks collected per combination (one expect at the end keeps this loop fast enough for the Windows runner).
            const bad = (why: string) => failures.length < 20 && failures.push(`${why}: ${JSON.stringify({ci, st, kind, vHead, vBase, tier, ms, prior, extra, autoMerge, armed, draft})} -> ${JSON.stringify(p.actions)}`);
            if (!p.actions.length) bad("EMPTY_PLAN");
            if (!p.actions.every(a => C.ACTIONS.includes(a.action) && C.REASONS.includes(a.reason))) bad("UNFIXED_CODE");
            const disarm = p.actions.some(a => a.action === "DISABLE_AUTO_MERGE");
            if (disarm !== (autoMerge && armed !== HEAD)) bad("DISARM_RULE");
            if (disarm && p.actions[0].action !== "DISABLE_AUTO_MERGE") bad("DISARM_NOT_FIRST");
            const m = p.actions.filter(a => a.action === "MERGE_HEAD");
            if (!m.length) continue;
            merged++;
            if (JSON.stringify(m) !== JSON.stringify([MERGED_HEAD])) bad("MERGE_NOT_HEAD_BOUND");
            if (ci !== "PASS") bad("MERGE_WITHOUT_CI");
            if (!list.some(v => v.status === "PASS" && v.headSha === HEAD && v.baseSha === BASE && (v.kind === "APP" || (v as {independentSession?: boolean}).independentSession === true))) bad("MERGE_WITHOUT_TRUSTED_PASS");
            if (list.some(v => v.status === "FAIL" && v.headSha === HEAD)) bad("MERGE_OVER_FAIL");
            if (["dirty", "behind", "unknown"].includes(ms)) bad("MERGE_ON_CONFLICT_OR_UNKNOWN");
            if (tier === "FOUNDER") bad("MERGE_FOUNDER_TIER");
            if (prior) bad("MERGE_AFTER_PRIOR_NEGATIVE");
            if (p.actions.at(-1)?.action !== "MERGE_HEAD") bad("MERGE_NOT_LAST");
            if (draft && p.actions.filter(a => a.action !== "DISABLE_AUTO_MERGE")[0].action !== "MARK_READY") bad("DRAFT_NOT_READY_FIRST");
          }
      expect(failures).toEqual([]);
      expect(total).toBeGreaterThan(100000);
      expect(merged).toBeGreaterThan(0);
    });
  });
}
