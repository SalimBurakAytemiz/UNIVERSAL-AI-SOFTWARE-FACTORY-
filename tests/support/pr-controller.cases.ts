// //TR: docs/planning/pr-controller.mjs için kurtarma ve devam senaryoları (COORD-TRANSITION-AUTONOMY): birleştirme çatışması, base ilerlemesi (merge-gate ile aynı base kuralı; yalnız birleştirmeye hazır PR güncellenir), reviewer kimlik hatası (asla CLEAN değil), aynı PR'da CI hatası, eski head'e veya eski base'e bağlı karar, aynı head'de FAIL+PASS (ret oylanıp geçilemez), bozuk veya bilinmeyen karar kayıtları (filtrelenip yok sayılmaz), tam kanıtlı draft (MARK_READY), birleşmiş PR (POST_MERGE_VERIFY sonra NEXT_TASK), FOUNDER sınıfı, önceki ret, head'e bağlı risk sınıfı ve ret kaydı, head'e bağlı olmayan veya push öncesi GitHub auto-merge'ün kapatılması; merge-gate ile adım adım uyum simülasyonu, birleştirmenin (MERGE_HEAD) yalnız tüm koşullar bu head+base'e bağlıyken üretildiği değişmezler ve denetleyici mutasyon kanıtı.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import * as C from "../../docs/planning/pr-controller.mjs";
import type {PrState, Verification} from "../../docs/planning/pr-controller.mjs";
import {evaluateMergeGate, parseBinding, REQUIRED_CONTEXTS} from "../../docs/planning/merge-gate.mjs";

const HEAD = "a".repeat(40), BASE = "b".repeat(40), NEWBASE = "c".repeat(40), OLDHEAD = "d".repeat(40), MERGE = "e".repeat(40);
const verified = (o: Record<string, unknown> = {}): Verification => ({status: "PASS", headSha: HEAD, baseSha: BASE, kind: "APP", ...o});
const pr = (o: Partial<PrState> & Record<string, unknown> = {}): PrState => ({pr: 7, lane: "B", draft: false, headSha: HEAD, baseSha: BASE, prBaseSha: BASE, mergeable_state: "clean",
  ciRequired: {ubuntu: "PASS", windows: "PASS", headSha: HEAD}, independentVerification: verified(), riskTier: "ROUTINE", riskTierHeadSha: HEAD, autoMerge: false, merged: false,
  priorNegative: false, priorNegativeHeadSha: HEAD, ...o} as PrState);
const acts = (s: unknown) => C.nextActions(s).actions.map(a => a.action);
const reasons = (s: unknown) => C.nextActions(s).actions.map(a => a.reason);
const plan = (s: unknown) => C.nextActions(s);
const MERGED_HEAD = {action: "MERGE_HEAD", lane: null, reason: "ALL_CONDITIONS_MET", headSha: HEAD};
// A base move after another merge: the base tip moved on, pulls.base.sha did not (it moves only on a head push).
const moved = (o: Partial<PrState> & Record<string, unknown> = {}) => pr({baseSha: NEWBASE, prBaseSha: BASE, ...o});

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
    it("an arm on this head is removed before any action that pushes to the PR (the push makes a new head the arm would merge on validate alone); a reviewer auth failure alone keeps it", () => {
      const armed = {autoMerge: true, autoMergeArmedHead: HEAD};
      const before = {action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_BEFORE_PUSH"};
      expect(plan(pr({...armed, ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}})).actions).toEqual([before, {action: "FIX_CI", lane: "B", reason: "CI_FAILED"}]);
      expect(acts(pr({...armed, mergeable_state: "dirty"}))).toEqual(["DISABLE_AUTO_MERGE", "RESOLVE_CONFLICT"]);
      expect(acts(pr({...armed, independentVerification: verified({status: "FAIL"})}))).toEqual(["DISABLE_AUTO_MERGE", "REMEDIATE_REVIEW"]);
      expect(acts(pr({...armed, mergeable_state: "behind"}))).toEqual(["DISABLE_AUTO_MERGE", "UPDATE_BRANCH"]);
      expect(acts(moved({...armed}))).toEqual(["DISABLE_AUTO_MERGE", "UPDATE_BRANCH"]);
      // FOUNDER tier armed by the Founder on this head: a lane fix push still disarms first.
      expect(acts(pr({...armed, riskTier: "FOUNDER", ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}}))).toEqual(["DISABLE_AUTO_MERGE", "FOUNDER_REQUIRED", "FIX_CI"]);
      // No push: an arm on this head is the Founder's decision and overrides a reviewer auth failure (documented in COORD-TRANSITION-AUTONOMY).
      expect(acts(pr({...armed, independentVerification: verified({status: "AUTH_FAILED"})}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(C.PUSH_ACTIONS).toEqual(["RESOLVE_CONFLICT", "FIX_CI", "REMEDIATE_REVIEW", "UPDATE_BRANCH"]);
    });
    it("merge conflict => RESOLVE_CONFLICT for the owner lane on the same PR (and an unbound auto-merge is disarmed first)", () => {
      expect(plan(pr({mergeable_state: "dirty"}))).toEqual({pr: 7, actions: [{action: "RESOLVE_CONFLICT", lane: "B", reason: "MERGE_CONFLICT"}]});
      expect(acts(pr({mergeable_state: "dirty", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "RESOLVE_CONFLICT"]);
    });
    it("base advanced: the merge gate's base rule (pulls.base.sha == base tip == verdict base); a PR is updated only when it is ready to merge, never by file-name intersection", () => {
      // Verdict on the old base, base tip moved: update first (the gate says BASE_DRIFT and VERDICT_BASE_MISMATCH).
      expect(plan(moved()).actions).toEqual([{action: "UPDATE_BRANCH", lane: null, reason: "BASE_MOVED"}]);
      // Re-verified against the new tip without an update: CI still ran on the old base (gate BASE_DRIFT), so the PR is still updated.
      expect(acts(moved({independentVerification: verified({baseSha: NEWBASE})}))).toEqual(["UPDATE_BRANCH"]);
      // pulls.base.sha equals the tip but the verdict is bound to another base: re-verify, no update needed.
      expect(plan(pr({baseSha: NEWBASE, prBaseSha: NEWBASE})).actions).toEqual([{action: "REVERIFY", lane: null, reason: "VERIFICATION_STALE_BASE"}]);
      // The old name-intersection exception is gone: a disjoint base delta and PR file list unlock nothing.
      expect(acts(moved({baseDelta: {fromBaseSha: BASE, toBaseSha: NEWBASE, files: ["docs/x.md"]}, prFiles: ["src/a.ts"]}))).toEqual(["UPDATE_BRANCH"]);
      expect(acts(pr({mergeable_state: "behind"}))).toEqual(["UPDATE_BRANCH"]);
      // PRs that are not ready are not touched by a base move: their own next step comes first (a lane push also refreshes pulls.base.sha).
      expect(acts(moved({ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}}))).toEqual(["FIX_CI"]);
      expect(acts(moved({ciRequired: {ubuntu: "PENDING", windows: "PASS", headSha: HEAD}}))).toEqual(["WAIT_CI"]);
      expect(acts(moved({mergeable_state: "dirty"}))).toEqual(["RESOLVE_CONFLICT"]);
      expect(acts(moved({independentVerification: verified({status: "FAIL"})}))).toEqual(["REMEDIATE_REVIEW"]);
      // FOUNDER tier and prior negative: the Founder decides when the PR is updated; no base-driven update or re-verification.
      expect(acts(moved({riskTier: "FOUNDER"}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(acts(pr({riskTier: "FOUNDER", baseSha: NEWBASE, prBaseSha: NEWBASE}))).toEqual(["FOUNDER_REQUIRED"]);
      expect(acts(moved({priorNegative: true}))).toEqual(["FOUNDER_REQUIRED"]);
      // A draft that is otherwise ready is updated before it is marked ready (its review then binds to the current base).
      expect(acts(moved({draft: true}))).toEqual(["UPDATE_BRANCH"]);
      // Only the ready PRs of a set are updated; each plan is computed from its own state.
      const res = C.planAll([moved({pr: 1}), moved({pr: 2, ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}}), pr({pr: 3, baseSha: NEWBASE, prBaseSha: NEWBASE,
        independentVerification: verified({baseSha: NEWBASE})}), moved({pr: 4, riskTier: "FOUNDER"})]).map(p => p.actions.map(a => a.action));
      expect(res).toEqual([["UPDATE_BRANCH"], ["FIX_CI"], ["MERGE_HEAD"], ["FOUNDER_REQUIRED"]]);
    });
    it("controller and merge gate agree step by step after a base move that does not touch the PR: update, CI, re-verification, then both say merge", () => {
      const [UBU, WIN] = REQUIRED_CONTEXTS;
      const H1 = HEAD, H2 = "f".repeat(40);
      const ciRun = (name: string, head: string, status = "completed") => ({name, status, conclusion: status === "completed" ? "success" : null, head_sha: head, app_slug: "github-actions",
        completed_at: status === "completed" ? "2026-10-26T09:00:00Z" : null, workflowPath: ".github/workflows/ci.yml", workflowRunEvent: "pull_request"});
      // The same independent reviewer session re-verifies (a later CLEAN from the same login and session clears its own earlier binding on that head).
      const review = (id: number, head: string, base: string, at: string) => ({id, user: {login: "owner1"}, state: "COMMENTED", commit_id: head, submitted_at: at,
        body: `Independent review.\nVERDICT-BINDING: verdict=CLEAN head=${head} base=${base} reviewer-session=session_reviewer`});
      const RULES = [{type: "deletion"}, {type: "non_fast_forward"}, {type: "pull_request", parameters: {required_approving_review_count: 0}},
        {type: "required_status_checks", parameters: {required_status_checks: [{context: UBU}, {context: WIN}], strict_required_status_checks_policy: false}}];
      const PP = JSON.parse(fs.readFileSync("config/protected-paths.json", "utf8"));
      type Ev = {head: string; prBase: string; tip: string; ci: ReturnType<typeof ciRun>[]; reviews: ReturnType<typeof review>[]};
      const evidence = (e: Ev) => ({pr: {number: 7, state: "open", draft: false, merged: false, changed_files: 1, head: {sha: e.head, ref: "claude/lane-b-widget"},
        base: {ref: "v7/integration", sha: e.prBase}, user: {login: "owner1"}}, currentBaseSha: e.tip, checkRuns: e.ci, reviews: e.reviews, implementerSessions: ["session_builder"],
        diffFiles: [{filename: "apps/control-api/src/routes/widget-status.ts", status: "added"}], protectedPaths: PP, rules: RULES});
      // The controller state is derived from the same evidence and the gate's own head-bound tier, as the coordinator does.
      const stateOf = (e: Ev, gate: ReturnType<typeof evaluateMergeGate>): PrState => {
        const ctx = (n: string) => { const r = e.ci.filter(c => c.name === n && c.head_sha === e.head); return !r.length ? "MISSING" : r.some(c => c.status !== "completed") ? "PENDING" : r.every(c => c.conclusion === "success") ? "PASS" : "FAIL"; };
        const verdicts: Verification[] = [];
        for (const rv of e.reviews) {
          const b = parseBinding(rv.body);
          if (b && "verdict" in b) verdicts.push({status: b.verdict === "CLEAN" ? "PASS" : "FAIL", headSha: b.head, baseSha: b.base, kind: "PROCESS", independentSession: b.session !== "session_builder"});
        }
        return {pr: 7, lane: "B", draft: false, headSha: e.head, baseSha: e.tip, prBaseSha: e.prBase, mergeable_state: "clean", ciRequired: {ubuntu: ctx(UBU), windows: ctx(WIN), headSha: e.head},
          independentVerification: verdicts, riskTier: gate.riskTier, riskTierHeadSha: gate.expectedHeadSha, autoMerge: false, merged: false, priorNegative: false, priorNegativeHeadSha: e.head};
      };
      const step = (e: Ev) => { const gate = evaluateMergeGate(evidence(e), {mode: "process"}); const p = C.nextActions(stateOf(e, gate)); return {gate, p, a: p.actions.map(x => x.action)}; };
      const greenH1 = [ciRun(UBU, H1), ciRun(WIN, H1)], greenH2 = [ciRun(UBU, H2), ciRun(WIN, H2)];
      const seq: [string, Ev, string[]][] = [
        ["verified on base B", {head: H1, prBase: BASE, tip: BASE, ci: greenH1, reviews: [review(1, H1, BASE, "2026-10-26T09:10:00Z")]}, ["MERGE_HEAD"]],
        ["another PR merged (tip C, docs only)", {head: H1, prBase: BASE, tip: NEWBASE, ci: greenH1, reviews: [review(1, H1, BASE, "2026-10-26T09:10:00Z")]}, ["UPDATE_BRANCH"]],
        ["re-verified on C without an update", {head: H1, prBase: BASE, tip: NEWBASE, ci: greenH1, reviews: [review(1, H1, BASE, "2026-10-26T09:10:00Z"), review(2, H1, NEWBASE, "2026-10-26T09:20:00Z")]}, ["UPDATE_BRANCH"]],
        ["updated: head H2 on C, CI running", {head: H2, prBase: NEWBASE, tip: NEWBASE, ci: [ciRun(UBU, H2, "in_progress"), ciRun(WIN, H2)], reviews: [review(1, H1, BASE, "2026-10-26T09:10:00Z")]}, ["WAIT_CI"]],
        ["CI green on H2, verdict only on H1", {head: H2, prBase: NEWBASE, tip: NEWBASE, ci: greenH2, reviews: [review(1, H1, BASE, "2026-10-26T09:10:00Z")]}, ["REVERIFY"]],
        ["re-verified on H2 and C", {head: H2, prBase: NEWBASE, tip: NEWBASE, ci: greenH2, reviews: [review(1, H1, BASE, "2026-10-26T09:10:00Z"), review(3, H2, NEWBASE, "2026-10-26T09:40:00Z")]}, ["MERGE_HEAD"]],
      ];
      for (const [name, e, want] of seq) {
        const {gate, p, a} = step(e);
        expect(a, name).toEqual(want);
        // One rule: the controller says MERGE_HEAD exactly when the gate says MERGE, for the same head and base.
        expect(a.includes("MERGE_HEAD"), `${name}: ${JSON.stringify(gate.reasons)}`).toBe(gate.decision === "MERGE");
        if (gate.decision === "MERGE") { expect(p.actions.at(-1)?.headSha).toBe(gate.expectedHeadSha); expect(gate.expectedBaseSha).toBe(e.tip); }
      }
      // The reviewer's round-2 probe: after re-verification bound to the new base the gate still blocks only on BASE_DRIFT, and the plan now makes progress (update) instead of MERGE_HEAD.
      expect(step(seq[2][1]).gate.reasons).toEqual(["BASE_DRIFT"]);
    });
    it("reviewer auth failure with no trusted alternative => BLOCK_REVIEW_AUTH, never a merge; a trusted alternative unblocks", () => {
      const auth = verified({status: "AUTH_FAILED"});
      expect(plan(pr({independentVerification: auth}))).toEqual({pr: 7, actions: [{action: "BLOCK_REVIEW_AUTH", lane: null, reason: "REVIEWER_AUTH_FAILED"}]});
      expect(acts(pr({independentVerification: auth, autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "BLOCK_REVIEW_AUTH"]);
      // An App auth failure carries no base (the check run has none): still an auth failure, not a FAIL.
      expect(acts(pr({independentVerification: verified({status: "AUTH_FAILED", baseSha: null})}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      // A process review counts only when it is explicitly an independent session.
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS"})]}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS", independentSession: "yes"})]}))).toEqual(["BLOCK_REVIEW_AUTH"]);
      expect(plan(pr({independentVerification: verified({kind: "PROCESS"})})).actions).toEqual([{action: "REQUEST_INDEPENDENT_VERIFICATION", lane: null, reason: "VERIFIER_NOT_INDEPENDENT"}]);
      expect(acts(pr({independentVerification: [auth, verified({kind: "PROCESS", independentSession: true})]}))).toEqual(["MERGE_HEAD"]);
      expect(acts(pr({independentVerification: [verified({status: "AUTH_FAILED", baseSha: null}), verified({kind: "PROCESS", independentSession: true})]}))).toEqual(["MERGE_HEAD"]);
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
      expect(plan(pr({independentVerification: []})).actions[0].reason).toBe("VERIFICATION_MISSING");
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
    it("round 2: a malformed or unknown verdict record is never filtered away: a FAIL counts on this head unless it is provably for another head, anything unreadable stops the merge", () => {
      const pass = verified(), proc = verified({kind: "PROCESS", independentSession: true});
      // Realistic: an App FAIL rebuilt from the check run has no base (the check carries head_sha only; decide/finish may record base null).
      const fails: [string, Record<string, unknown>][] = [["base null", {baseSha: null}], ["base missing", {baseSha: undefined}], ["kind HUMAN", {kind: "HUMAN"}],
        ["upper-case head", {headSha: HEAD.toUpperCase()}], ["head missing", {headSha: undefined}], ["head not a SHA", {headSha: "HEAD"}], ["base not a SHA", {baseSha: "unknown"}]];
      for (const [name, o] of fails) {
        expect(acts(pr({independentVerification: [verified({status: "FAIL", ...o}), proc]})), `${name} + PROCESS PASS`).toEqual(["FOUNDER_REQUIRED", "REMEDIATE_REVIEW"]);
        expect(acts(pr({independentVerification: [verified({status: "FAIL", ...o}), pass]})), `${name} + APP PASS`).toEqual(["FOUNDER_REQUIRED", "REMEDIATE_REVIEW"]);
        expect(acts(pr({independentVerification: verified({status: "FAIL", ...o})})), `${name} alone`).toEqual(["REMEDIATE_REVIEW"]);
      }
      // The reviewer's exact probe (FAIL with base null next to an independent PROCESS PASS) no longer merges.
      expect(plan(pr({independentVerification: [{status: "FAIL", headSha: HEAD, baseSha: null, kind: "APP"} as unknown as Verification,
        {status: "PASS", headSha: HEAD, baseSha: BASE, kind: "PROCESS", independentSession: true}]})).actions.map(a => a.action)).toEqual(["FOUNDER_REQUIRED", "REMEDIATE_REVIEW"]);
      // Unknown statuses, malformed PASS records and non-object entries are unreadable: no merge, a fixed reason.
      const unreadable: [string, unknown][] = [["status BLOCKED", verified({status: "BLOCKED"})], ["status lower-case fail", verified({status: "fail"})], ["status missing", verified({status: undefined})],
        ["PASS without base", verified({baseSha: undefined})], ["PASS with base null", verified({baseSha: null})], ["PASS of kind HUMAN", verified({kind: "HUMAN"})],
        ["PASS with upper-case head", verified({headSha: HEAD.toUpperCase()})], ["a string entry", "PASS"], ["a null entry", null], ["an array entry", [verified()]]];
      for (const [name, bad] of unreadable) {
        expect(plan(pr({independentVerification: [bad as Verification, pass]})).actions, name).toEqual([{action: "NOOP", lane: null, reason: "VERIFICATION_MALFORMED"}]);
        expect(acts(pr({independentVerification: [pass, bad as Verification, proc]})), name).toEqual(["NOOP"]);
      }
      expect(plan(pr({independentVerification: "PASS" as unknown as Verification})).actions).toEqual([{action: "NOOP", lane: null, reason: "VERIFICATION_MALFORMED"}]);
      // Provably for another head (a valid, different head SHA): ignored, whatever else is wrong with it.
      expect(acts(pr({independentVerification: [verified({status: "BLOCKED", headSha: OLDHEAD}), pass]}))).toEqual(["MERGE_HEAD"]);
      expect(acts(pr({independentVerification: [verified({status: "FAIL", headSha: OLDHEAD, baseSha: null, kind: "HUMAN"}), pass]}))).toEqual(["MERGE_HEAD"]);
      // Unreadable records disarm a stale arm too and never yield a lane action.
      expect(acts(pr({autoMerge: true, independentVerification: [verified({status: "BLOCKED"}), pass]}))).toEqual(["DISABLE_AUTO_MERGE", "NOOP"]);
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
      // A merged PR needs no pulls.base.sha binding.
      expect(acts(pr({merged: true, postMerge: "VERIFIED", prBaseSha: undefined}))).toEqual(["NEXT_TASK"]);
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
    it("round 2: the risk tier and the prior-negative record count only for the head they were computed for (riskTierHeadSha / priorNegativeHeadSha)", () => {
      // The reviewer's probe: a ROUTINE tier computed for an older head next to an independent PASS on the new head.
      expect(plan(pr({riskTierHeadSha: OLDHEAD, independentVerification: verified({kind: "PROCESS", independentSession: true})})).actions)
        .toEqual([{action: "NOOP", lane: null, reason: "RISK_TIER_STALE"}]);
      for (const h of [undefined, null, "HEAD", HEAD.toUpperCase()]) expect(reasons(pr({riskTierHeadSha: h})), String(h)).toEqual(["RISK_TIER_STALE"]);
      // A FOUNDER tier of an older head is stale too (the tier is recomputed for every head): no merge, no Founder request for a head it was not computed for.
      expect(reasons(pr({riskTier: "FOUNDER", riskTierHeadSha: OLDHEAD}))).toEqual(["RISK_TIER_STALE"]);
      expect(reasons(pr({priorNegativeHeadSha: OLDHEAD}))).toEqual(["PRIOR_VERDICT_STALE"]);
      expect(reasons(pr({priorNegativeHeadSha: undefined}))).toEqual(["PRIOR_VERDICT_STALE"]);
      expect(reasons(pr({priorNegative: true, priorNegativeHeadSha: OLDHEAD}))).toEqual(["PRIOR_VERDICT_STALE"]);
      // A stale tier never yields a base-driven update and the plan still names the reason (never empty).
      expect(plan(moved({riskTierHeadSha: OLDHEAD})).actions).toEqual([{action: "NOOP", lane: null, reason: "RISK_TIER_STALE"}]);
      expect(plan(moved({priorNegativeHeadSha: OLDHEAD})).actions).toEqual([{action: "NOOP", lane: null, reason: "PRIOR_VERDICT_STALE"}]);
      expect(plan(pr({baseSha: NEWBASE, prBaseSha: NEWBASE, riskTier: undefined})).actions).toEqual([{action: "NOOP", lane: null, reason: "RISK_TIER_UNKNOWN"}]);
      // Stale inputs block only the merge: lane work and verification requests continue.
      expect(acts(pr({riskTierHeadSha: OLDHEAD, ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}}))).toEqual(["FIX_CI"]);
      expect(acts(pr({riskTierHeadSha: OLDHEAD, independentVerification: null}))).toEqual(["REQUEST_INDEPENDENT_VERIFICATION"]);
    });
    it("unknown mergeability waits; a malformed state (a missing PR number or pulls.base.sha included) does nothing except disarm an armed auto-merge", () => {
      expect(plan(pr({mergeable_state: "unknown"})).actions[0].reason).toBe("MERGEABILITY_UNKNOWN");
      expect(plan(pr({mergeable_state: null})).actions[0].reason).toBe("MERGEABILITY_UNKNOWN");
      for (const bad of [null, "x", {}, pr({headSha: "HEAD"}), pr({draft: "false" as unknown as boolean}), pr({ciRequired: {ubuntu: "GREEN", windows: "PASS", headSha: HEAD}}),
        pr({mergeable_state: "weird"}), pr({pr: undefined}), pr({pr: 0}), pr({pr: "7" as unknown as number}), pr({prBaseSha: undefined}), pr({prBaseSha: BASE.toUpperCase()})])
        expect(plan(bad).actions.map(a => a.reason)).toEqual(["STATE_MALFORMED"]);
      expect(acts(pr({headSha: "HEAD", autoMerge: true}))).toEqual(["DISABLE_AUTO_MERGE", "NOOP"]);
      expect(plan(pr({pr: undefined, mergeable_state: "dirty", autoMerge: true}))).toEqual({pr: null, actions: [{action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_BOUND_TO_HEAD"},
        {action: "NOOP", lane: null, reason: "STATE_MALFORMED"}]});
    });
    it("a failure in one PR never yields actions for another PR (planAll is per-PR and isolated)", () => {
      const ok = pr({pr: 1, lane: "A"}), broken = {pr: 2, lane: "C", headSha: 5}, conflict = pr({pr: 3, lane: "C", mergeable_state: "dirty"}),
        ci = pr({pr: 4, lane: "A", ciRequired: {ubuntu: "FAIL", windows: "PASS", headSha: HEAD}});
      const throwing = Object.defineProperty(pr({pr: 5}), "ciRequired", {get() { throw new Error("boom"); }});
      const badVerdict = pr({pr: 6, independentVerification: [verified({status: "BLOCKED"})]});
      const all = C.planAll([ok, broken, conflict, ci, throwing, badVerdict]);
      expect(all.map(p => p.actions.map(a => a.action))).toEqual([["MERGE_HEAD"], ["NOOP"], ["RESOLVE_CONFLICT"], ["FIX_CI"], ["NOOP"], ["NOOP"]]);
      expect(all[0]).toEqual(C.nextActions(ok));
      expect(all[2].actions[0].lane).toBe("C");
      expect(all[3]).toEqual({pr: 4, actions: [{action: "FIX_CI", lane: "A", reason: "CI_FAILED"}]});
      expect(all[4].actions[0].reason).toBe("INTERNAL_ERROR");
      expect(C.planAll("x" as unknown)).toEqual([]);
    });
    it("invariant over every combination (several verdicts per PR, base moves included): MERGE_HEAD only with CI PASS bound to this head, CI and a trusted PASS on the current base, no FAIL on the head, no conflict, a non-FOUNDER tier and no prior negative; an auto-merge is disarmed when unbound or before a push; outputs are fixed codes", {timeout: 120000}, () => {
      let merged = 0, total = 0;
      const failures: string[] = [];
      const extras: Verification[][] = [[], [{status: "FAIL", headSha: HEAD, baseSha: BASE, kind: "APP"}],
        [{status: "PASS", headSha: HEAD, baseSha: BASE, kind: "PROCESS", independentSession: true}], [{status: "AUTH_FAILED", headSha: HEAD, baseSha: BASE, kind: "APP"}]];
      const arms: [boolean, string | null][] = [[false, null], [true, null], [true, HEAD], [true, OLDHEAD]];
      for (const ci of C.CI_VALUES) for (const st of C.VERIFICATION_STATUSES) for (const kind of C.VERIFICATION_KINDS) for (const vHead of [HEAD, OLDHEAD]) for (const vBase of [BASE, NEWBASE])
        for (const tier of ["ROUTINE", "PREAUTHORIZED", "FOUNDER"]) for (const ms of C.MERGEABLE_STATES) for (const prior of [false, true]) for (const extra of extras)
          for (const [autoMerge, armed] of arms) for (const draft of [false, true]) for (const prBase of [BASE, NEWBASE]) {
            const list = [{status: st, headSha: vHead, baseSha: vBase, kind}, ...extra];
            const s = pr({draft, mergeable_state: ms, ciRequired: {ubuntu: "PASS", windows: ci, headSha: HEAD}, independentVerification: list, riskTier: tier, priorNegative: prior,
              autoMerge, autoMergeArmedHead: armed, founderApprovedHead: HEAD, prBaseSha: prBase});
            const p = C.nextActions(s);
            total++;
            // Plain checks collected per combination (one expect at the end keeps this loop fast enough for the Windows runner).
            const bad = (why: string) => failures.length < 20 && failures.push(`${why}: ${JSON.stringify({ci, st, kind, vHead, vBase, tier, ms, prior, extra, autoMerge, armed, draft, prBase})} -> ${JSON.stringify(p.actions)}`);
            if (!p.actions.length) bad("EMPTY_PLAN");
            if (!p.actions.every(a => C.ACTIONS.includes(a.action) && C.REASONS.includes(a.reason))) bad("UNFIXED_CODE");
            const disarm = p.actions.some(a => a.action === "DISABLE_AUTO_MERGE");
            const pushes = p.actions.some(a => C.PUSH_ACTIONS.includes(a.action));
            if (disarm !== (autoMerge && (armed !== HEAD || pushes))) bad("DISARM_RULE");
            if (disarm && p.actions[0].action !== "DISABLE_AUTO_MERGE") bad("DISARM_NOT_FIRST");
            if (p.actions.some(a => a.action === "UPDATE_BRANCH" && a.reason === "BASE_MOVED") && (tier === "FOUNDER" || prior)) bad("BASE_UPDATE_FOR_FOUNDER_DECISION");
            const m = p.actions.filter(a => a.action === "MERGE_HEAD");
            if (!m.length) continue;
            merged++;
            if (JSON.stringify(m) !== JSON.stringify([MERGED_HEAD])) bad("MERGE_NOT_HEAD_BOUND");
            if (ci !== "PASS") bad("MERGE_WITHOUT_CI");
            if (prBase !== BASE) bad("MERGE_ON_BASE_DRIFT");
            if (!list.some(v => v.status === "PASS" && v.headSha === HEAD && v.baseSha === BASE && (v.kind === "APP" || (v as {independentSession?: boolean}).independentSession === true))) bad("MERGE_WITHOUT_TRUSTED_PASS");
            if (list.some(v => v.status === "FAIL" && v.headSha === HEAD)) bad("MERGE_OVER_FAIL");
            if (["dirty", "behind", "unknown"].includes(ms)) bad("MERGE_ON_CONFLICT_OR_UNKNOWN");
            if (tier === "FOUNDER") bad("MERGE_FOUNDER_TIER");
            if (prior) bad("MERGE_AFTER_PRIOR_NEGATIVE");
            if (p.actions.at(-1)?.action !== "MERGE_HEAD") bad("MERGE_NOT_LAST");
            if (draft && p.actions.filter(a => a.action !== "DISABLE_AUTO_MERGE")[0].action !== "MARK_READY") bad("DRAFT_NOT_READY_FIRST");
          }
      expect(failures).toEqual([]);
      expect(total).toBeGreaterThan(300000);
      expect(merged).toBeGreaterThan(0);
    });
    it("invariant: every plan is non-empty and never merges or updates for a base move when the tier or the prior record is unknown or computed for another head", () => {
      const failures: string[] = [];
      const lists: unknown[] = [null, verified(), verified({baseSha: NEWBASE}), verified({headSha: OLDHEAD}), verified({status: "AUTH_FAILED", baseSha: null}), verified({kind: "PROCESS"}),
        [verified({status: "FAIL"}), verified()], [verified({status: "BLOCKED"})]];
      for (const tierHead of [HEAD, OLDHEAD, undefined]) for (const tier of ["ROUTINE", "FOUNDER", "X", undefined]) for (const priorHead of [HEAD, OLDHEAD, undefined])
        for (const prior of [false, true, null]) for (const [baseSha, prBaseSha] of [[BASE, BASE], [NEWBASE, BASE], [NEWBASE, NEWBASE]]) for (const iv of lists)
          for (const draft of [false, true]) for (const autoMerge of [false, true]) {
            const s = pr({riskTierHeadSha: tierHead, riskTier: tier, priorNegativeHeadSha: priorHead, priorNegative: prior, baseSha, prBaseSha, independentVerification: iv as Verification | Verification[] | null, draft, autoMerge});
            const a = C.nextActions(s).actions;
            const known = tierHead === HEAD && (tier === "ROUTINE" || tier === "FOUNDER") && priorHead === HEAD && prior !== null;
            const tag = JSON.stringify({tierHead, tier, priorHead, prior, baseSha, prBaseSha, iv, draft, autoMerge}) + " -> " + a.map(x => x.action).join(",");
            if (!a.length || a.every(x => x.action === "DISABLE_AUTO_MERGE")) failures.push(`EMPTY_PLAN ${tag}`);
            if (!known && a.some(x => x.action === "MERGE_HEAD")) failures.push(`MERGE_WITH_UNKNOWN_AUTHORITY ${tag}`);
            if (!(known && tier === "ROUTINE" && prior === false) && a.some(x => x.reason === "BASE_MOVED" || x.reason === "VERIFICATION_STALE_BASE")) failures.push(`BASE_WORK_WITHOUT_MERGE_AUTHORITY ${tag}`);
          }
      expect(failures.slice(0, 20)).toEqual([]);
    });
    it("invariant over malformed verdict records: no record that is not a well-formed PASS and not provably for another head is ever outvoted into a merge", () => {
      const failures: string[] = [];
      const statuses = ["PASS", "FAIL", "MISSING", "AUTH_FAILED", "BLOCKED", "fail", undefined];
      const kinds = ["APP", "PROCESS", "HUMAN", undefined], heads = [HEAD, OLDHEAD, HEAD.toUpperCase(), "HEAD", undefined], bases = [BASE, NEWBASE, null, undefined, "unknown"];
      const companions: Verification[][] = [[verified()], [verified({kind: "PROCESS", independentSession: true})], [verified(), verified({kind: "PROCESS", independentSession: true})]];
      const okRecord = (v: Record<string, unknown>) => C.VERIFICATION_STATUSES.includes(v.status as string) && C.VERIFICATION_KINDS.includes(v.kind as string) && /^[0-9a-f]{40}$/.test(String(v.headSha))
        && (v.status === "PASS" ? /^[0-9a-f]{40}$/.test(String(v.baseSha)) : v.baseSha === null || v.baseSha === undefined || /^[0-9a-f]{40}$/.test(String(v.baseSha)));
      for (const status of statuses) for (const kind of kinds) for (const headSha of heads) for (const baseSha of bases) for (const comp of companions) for (const first of [false, true]) {
        const rec = {status, kind, headSha, baseSha} as Record<string, unknown>;
        const other = typeof headSha === "string" && /^[0-9a-f]{40}$/.test(headSha) && headSha !== HEAD;
        const list = first ? [rec, ...comp] : [...comp, rec];
        const a = acts(pr({independentVerification: list as unknown as Verification[]}));
        const tag = `${JSON.stringify(rec)} first=${first} comp=${comp.length} -> ${a.join(",")}`;
        if (other) { if (JSON.stringify(a) !== JSON.stringify(["MERGE_HEAD"])) failures.push(`OTHER_HEAD_NOT_IGNORED ${tag}`); continue; }
        if (status === "FAIL") { if (JSON.stringify(a) !== JSON.stringify(["FOUNDER_REQUIRED", "REMEDIATE_REVIEW"])) failures.push(`FAIL_NOT_ON_HEAD ${tag}`); continue; }
        if (!okRecord(rec)) { if (JSON.stringify(a) !== JSON.stringify(["NOOP"])) failures.push(`UNREADABLE_NOT_BLOCKING ${tag}`); continue; }
        if (a.includes("NOOP") || a.includes("REMEDIATE_REVIEW")) failures.push(`WELL_FORMED_BLOCKS ${tag}`);
      }
      expect(failures.slice(0, 20)).toEqual([]);
    });
    it("every controller mutant is killed by a case (pr-controller mutation proof)", {timeout: 120000}, () => {
      const r = spawnSync(process.execPath, ["docs/planning/pr-controller.proof.mjs"], {encoding: "utf8", timeout: 110000});
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const m = /^PR_CONTROLLER_PROOF: PASS (\d+)\/(\d+) cases, (\d+)\/(\d+) mutants killed$/.exec(r.stdout.trim().split(/\r?\n/).pop() ?? "");
      expect(m, r.stdout.slice(-2000)).not.toBeNull();
      expect(m?.[1]).toBe(m?.[2]);
      expect(m?.[3]).toBe(m?.[4]);
      expect(Number(m?.[4])).toBeGreaterThanOrEqual(15);
    });
  });
}
