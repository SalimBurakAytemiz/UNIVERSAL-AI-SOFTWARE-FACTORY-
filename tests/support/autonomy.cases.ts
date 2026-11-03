// //TR: Founder kalıcı otonomi kararının (FD-2026-11-03-STANDING-AUTONOMY) karar modülü için vakalar: yalnız merge-gate MERGE + kapsanan kademe + açık kapı yoksa AUTO_MERGE; korumalı/CI yolu, T3, ücretli/dış hesap kapıları FOUNDER_REQUIRED; diğer her şey BLOCK; sıradaki görev seçimi engelli görevlerde durmaz.
import fs from "node:fs";
import {describe, it, expect} from "vitest";
// @ts-expect-error untyped .mjs module
import {decideAutoMerge, nextTasks, taskOf, openGates, decideFor, loadPolicy, loadIndex, loadState, isGovernancePath, attestationOf, collectEvidence, pages, TRUST_FILES} from "../../docs/planning/autonomy/autonomy.mjs";
import {createHash} from "node:crypto";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40), BASE = "b".repeat(40);
const merge = {decision: "MERGE", reasons: [], expectedHeadSha: SHA, expectedBaseSha: BASE};
const block = (...reasons: string[]) => ({decision: "BLOCK", reasons, expectedHeadSha: SHA, expectedBaseSha: BASE});
const policy = {
  decisionId: "FD-TEST", gateMode: "process", trustedReviewerLogins: ["Rev"], coveredTiers: ["T0", "T1", "T2"], standingGates: ["D-31"], satisfiedGates: {"D-01": "x"},
  founderOnlyGateReasons: {"D-08": "PAID_SPEND", "D-03": "EXTERNAL_PROVIDER_OR_ACCOUNT"}, founderRequiredGateReasons: ["PROTECTED_PATH", "CI_EXECUTED_PATH"],
};
const t = (id: string, tier: string, o: Record<string, unknown> = {}) => ({id, tier, status: "MISSING", wave: "W0", deps: [], startGates: [], mergeGates: ["D-31"], exec: "CLOUD", name: id, ...o});
const index = {tasks: [t("CLOUD-T0010", "T2"), t("UASCO-T0072", "T3"), t("CLOUD-T0015", "T2", {mergeGates: ["D-31", "D-08"]}), t("V3-T1099", "T1", {startGates: ["D-77"]})]};
const body = (id: string) => `Summary\n\nUASCO-TASK: ${id}\n`;
const cleanReview = (att = "AUTONOMY-EXCEPTIONS: none", head = SHA, o: Record<string, unknown> = {}, session = "session_rev") => ({id: 1, user: {login: "rev"}, state: "COMMENTED", commit_id: head, submitted_at: "2026-11-03T10:00:00Z",
  body: `findings\n${att}\nVERDICT-BINDING: verdict=CLEAN head=${head} base=${BASE} reviewer-session=${session}`, ...o});
const ev = (o: Record<string, unknown> = {}) => ({implementerSessions: ["session_builder"], diffFiles: [{filename: "apps/x.ts", status: "modified"}], reviews: [cleanReview()], pr: {user: {login: "author"}}, ...o});

export function registerAutonomyCases() {
  describe("standing autonomy authority (FD-2026-11-03)", () => {
    it("A1 merge-gate MERGE + covered T2 task with only D-31 => AUTO_MERGE bound to the head SHA", () => {
      const r = decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: ev()});
      expect(r).toMatchObject({decision: "AUTO_MERGE", task: "CLOUD-T0010", expectedHeadSha: SHA, authority: "FD-TEST", reasons: []});
    });
    it("A2 a T3 task is never auto-merged", () => {
      const r = decideAutoMerge({gate: merge, body: body("UASCO-T0072"), policy, index, evidence: ev()});
      expect(r.decision).toBe("FOUNDER_REQUIRED");
      expect(r.reasons).toContain("TIER_NOT_COVERED:T3");
      expect(r.authority).toBeNull();
    });
    it("A3 protected or CI-executed paths => FOUNDER_REQUIRED, never AUTO_MERGE", () => {
      for (const g of [block("PROTECTED_PATH"), block("CI_EXECUTED_PATH:npm-manifest")]) {
        const r = decideAutoMerge({gate: g, body: body("CLOUD-T0010"), policy, index, evidence: ev()});
        expect(r.decision).toBe("FOUNDER_REQUIRED");
        expect(r.reasons[0]).toMatch(/^PROTECTED_GOVERNANCE:/);
      }
    });
    it("A4 any other gate reason blocks, even next to a protected path", () => {
      expect(decideAutoMerge({gate: block("CHECK_FAILED:validate (windows-latest)"), body: body("CLOUD-T0010"), policy, index, evidence: ev()}).decision).toBe("BLOCK");
      expect(decideAutoMerge({gate: block("PROTECTED_PATH", "VERDICT_MISSING"), body: body("CLOUD-T0010"), policy, index, evidence: ev()}).decision).toBe("BLOCK");
      expect(decideAutoMerge({gate: {decision: "BLOCK"}, body: body("CLOUD-T0010"), policy, index, evidence: ev()}).decision).toBe("BLOCK");
      expect(decideAutoMerge({gate: {decision: "MERGE_PLEASE", reasons: []}, body: body("CLOUD-T0010"), policy, index, evidence: ev()}).decision).toBe("BLOCK");
    });
    it("A5 the PR must name exactly one known task on its own line", () => {
      expect(taskOf("UASCO-TASK: CLOUD-T0010\nUASCO-TASK: CLOUD-T0015")).toBeNull();
      expect(taskOf("> UASCO-TASK: CLOUD-T0010")).toBeNull();
      expect(taskOf("  UASCO-TASK: CLOUD-T0010")).toBeNull();
      expect(taskOf("UASCO-TASK: UASCO-T0016.A")).toBeNull();
      expect(taskOf("UASCO-TASK: V3-T1012.a")).toBe("V3-T1012.a");
      expect(taskOf("```\nUASCO-TASK: CLOUD-T0010\n```")).toBeNull();
      expect(taskOf("<!--\nUASCO-TASK: CLOUD-T0010\n-->")).toBeNull();
      expect(decideAutoMerge({gate: merge, body: "no task", policy, index, evidence: ev()}).reasons).toContain("TASK_ID_MISSING_OR_AMBIGUOUS");
      expect(decideAutoMerge({gate: merge, body: body("CLOUD-T9999"), policy, index, evidence: ev()}).reasons).toContain("TASK_UNKNOWN");
    });
    it("A6 spend/provider gates and undecided gates go to the Founder", () => {
      expect(decideAutoMerge({gate: merge, body: body("CLOUD-T0015"), policy, index, evidence: ev()}).reasons).toEqual(["PAID_SPEND:D-08"]);
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
    it("B1 a PR touching the authority's own definition is never routine (filename or previous_filename)", () => {
      for (const f of ["docs/planning/autonomy/standing-authority.json", "docs/planning/autonomy/task-index.json", "docs/planning/merge-gate.mjs", "DOCS/Planning/MERGE_GATE.md",
        "docs/planning/authority/FD-x.md", "docs/planning/v41/UASCO_V4_1_CLOUD_MERGED.zip", "docs\\planning\\autonomy\\autonomy.mjs", "./docs/planning/x/../autonomy/autonomy.mjs"]) {
        expect(isGovernancePath(f)).toBe(true);
        const r = decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: ev({diffFiles: [{filename: f, status: "modified"}]})});
        expect(r.decision).toBe("FOUNDER_REQUIRED");
        expect(r.reasons).toContain("GOVERNANCE_PATH");
      }
      const renamed = ev({diffFiles: [{filename: "apps/y.mjs", previous_filename: "docs/planning/merge-gate.mjs", status: "renamed"}]});
      expect(decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: renamed}).decision).toBe("FOUNDER_REQUIRED");
      expect(isGovernancePath("docs/planning/autonomy/STATE.json")).toBe(false);
      expect(decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: ev({diffFiles: undefined})}).reasons).toContain("DIFF_MISSING");
    });
    it("B3 the builder session ids are mandatory", () => {
      for (const implementerSessions of [undefined, [], [""], ["  "]]) {
        const r = decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: ev({implementerSessions})});
        expect(r.decision).toBe("BLOCK");
        expect(r.reasons).toContain("IMPLEMENTER_SESSIONS_MISSING");
      }
    });
    it("NB5 the reviewer must attest to the content-level exceptions on the CLEAN review itself", () => {
      const d = (reviews: unknown[]) => decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: ev({reviews})});
      expect(d([cleanReview("")]).reasons).toContain("REVIEWER_ATTESTATION_MISSING");
      expect(d([cleanReview("> AUTONOMY-EXCEPTIONS: none")]).reasons).toContain("REVIEWER_ATTESTATION_MALFORMED");
      expect(d([cleanReview("```\nAUTONOMY-EXCEPTIONS: none\n```")]).reasons).toContain("REVIEWER_ATTESTATION_MALFORMED");
      expect(d([cleanReview("AUTONOMY-EXCEPTIONS: none", "c".repeat(40))]).reasons).toContain("REVIEWER_ATTESTATION_MISSING");
      expect(d([cleanReview("AUTONOMY-EXCEPTIONS: none\nAUTONOMY-EXCEPTIONS: none")]).reasons).toContain("REVIEWER_ATTESTATION_MALFORMED");
      const paid = d([cleanReview("AUTONOMY-EXCEPTIONS: PAID_SPEND,NEW_CREDENTIAL")]);
      expect(paid.decision).toBe("FOUNDER_REQUIRED");
      expect(paid.reasons).toEqual(["REVIEWER_ATTESTED:PAID_SPEND", "REVIEWER_ATTESTED:NEW_CREDENTIAL"]);
      expect(attestationOf({reviews: [cleanReview()], head: SHA, base: BASE, allowed: new Set(["rev"])})).toBe("none");
    });
    it("NB5b no later or foreign review can erase an attested exception (review 5757611393 BLOCKING-1)", () => {
      const d = (reviews: unknown[]) => decideAutoMerge({gate: merge, body: body("CLOUD-T0010"), policy, index, evidence: ev({reviews})});
      const paid = cleanReview("AUTONOMY-EXCEPTIONS: PAID_SPEND", SHA, {id: 1});
      const later = (o: Record<string, unknown>, session?: string) => cleanReview("AUTONOMY-EXCEPTIONS: none", SHA, {id: 2, submitted_at: "2026-11-03T11:00:00Z", ...o}, session);
      for (const extra of [later({user: {login: "mallory"}}), later({}, "session_builder"), later({}), later({state: "PENDING"}), later({submitted_at: null}), later({user: null})]) {
        const r = d([paid, extra]);
        expect(r.decision).toBe("FOUNDER_REQUIRED");
        expect(r.reasons).toContain("REVIEWER_ATTESTED:PAID_SPEND");
      }
      // A foreign account's attestation never counts, even alone: the governed reviewer's review must carry it.
      expect(d([cleanReview("", SHA, {}), later({user: {login: "mallory"}})]).reasons).toContain("REVIEWER_ATTESTATION_MISSING");
      // A builder-session CLEAN is never the selected review, so it cannot supply the attestation the governed review lacks.
      expect(d([cleanReview("", SHA, {}), later({}, "session_builder")]).reasons).toContain("REVIEWER_ATTESTATION_MISSING");
      // BLOCKING-A (review 5757730354): an unreadable attestation on ANY qualifying review fails closed, whatever a later review says.
      for (const bad of ["AUTONOMY-EXCEPTIONS: PAID_SPEND, LEGAL", "AUTONOMY-EXCEPTIONS: PAID_SPEND\nAUTONOMY-EXCEPTIONS: none", "AUTONOMY-EXCEPTIONS: paid_spend",
        "AUTONOMY-EXCEPTIONS: PAID_SPEND\u200b", "AUTONOMY\u200b-EXCEPTIONS: none", "> AUTONOMY-EXCEPTIONS: PAID_SPEND\nAUTONOMY-EXCEPTIONS: none", "```\nAUTONOMY-EXCEPTIONS: PAID_SPEND\n```\nAUTONOMY-EXCEPTIONS: none",
        "  AUTONOMY-EXCEPTIONS: none", "autonomy-exceptions: none"]) {
        for (const reviews of [[cleanReview(bad, SHA, {id: 1}, "sA"), later({}, "sC")], [cleanReview("AUTONOMY-EXCEPTIONS: none", SHA, {id: 1}, "sA"), later({body: `x\n${bad}\nVERDICT-BINDING: verdict=CLEAN head=${SHA} base=${BASE} reviewer-session=sC`}, "sC")]]) {
          const r = d(reviews);
          expect(r.decision).toBe("BLOCK");
          expect(r.reasons).toContain("REVIEWER_ATTESTATION_MALFORMED");
        }
      }
      const mixed = d([cleanReview("AUTONOMY-EXCEPTIONS: paid_spend", SHA, {id: 1}, "sA"), later({body: `x\nAUTONOMY-EXCEPTIONS: LEGAL\nVERDICT-BINDING: verdict=CLEAN head=${SHA} base=${BASE} reviewer-session=sC`}, "sC")]);
      expect(mixed.decision).toBe("BLOCK");
      expect(mixed.reasons).toContain("REVIEWER_ATTESTATION_MALFORMED");
      // The PR author's own review counts in process mode (merge-gate's allowed set).
      expect(d([cleanReview("AUTONOMY-EXCEPTIONS: none", SHA, {user: {login: "Author"}})]).decision).toBe("AUTO_MERGE");
    });
    it("B2/NB1/NB2/NB3 evidence: trust inputs from the base, local trust files must match it, every check run, no silent truncation", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-aut-"));
      const blob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
      const files: Record<string, Buffer> = {};
      for (const f of TRUST_FILES) { files[f] = Buffer.from(`content of ${f}\n`); fs.mkdirSync(path.dirname(path.join(root, f)), {recursive: true}); fs.writeFileSync(path.join(root, f), files[f]); }
      files["docs/planning/autonomy/standing-authority.json"] = Buffer.from(JSON.stringify(policy));
      files["docs/planning/autonomy/task-index.json"] = Buffer.from(JSON.stringify(index));
      files["config/protected-paths.json"] = Buffer.from(JSON.stringify({exactPaths: ["x"], protectedPrefixes: ["y/"]}));
      fs.writeFileSync(path.join(root, "docs/planning/autonomy/standing-authority.json"), files["docs/planning/autonomy/standing-authority.json"]);
      fs.writeFileSync(path.join(root, "docs/planning/autonomy/task-index.json"), files["docs/planning/autonomy/task-index.json"]);
      const seen: string[] = [];
      let baseReads = 0, moved = false;
      const api = (p: string) => {
        seen.push(p);
        if (p === "pulls/7") return {number: 7, state: "open", draft: false, merged: false, changed_files: 1, head: {sha: SHA, ref: "h"}, base: {ref: "v7/integration", sha: BASE}, user: {login: "u"}, body: body("CLOUD-T0010")};
        if (p.startsWith("branches/")) return {commit: {sha: moved && baseReads++ > 0 ? "c".repeat(40) : BASE}};
        if (p.startsWith("contents/")) { const f = decodeURIComponent(p.slice(9, p.indexOf("?ref="))); expect(p.endsWith(`?ref=${BASE}`)).toBe(true); return {sha: blob(files[f]), encoding: "base64", content: files[f].toString("base64")}; }
        if (p.startsWith("actions/runs")) return {workflow_runs: [{check_suite_id: 11, path: ".github/workflows/ci.yml", event: "pull_request"}]};
        if (p.startsWith(`commits/${SHA}/check-runs`)) return {check_runs: [{name: "validate (ubuntu-latest)", status: "completed", conclusion: "success", head_sha: SHA, app: {slug: "github-actions"}, completed_at: "t", check_suite: {id: 11}},
          {name: "orphan", status: "completed", conclusion: "success", head_sha: SHA, app: {slug: "github-actions"}, completed_at: "t", check_suite: {id: 99}}]};
        if (p.startsWith("pulls/7/reviews")) return [];
        if (p.startsWith("pulls/7/files")) return [{filename: "a.ts", status: "modified"}];
        if (p.startsWith("rules/")) return [];
        throw new Error(`unexpected ${p}`);
      };
      const c = collectEvidence({api, pr: 7, implementerSessions: ["s1"], root});
      expect(c.trust.reasons).toEqual([]);
      expect(c.evidence.implementerSessions).toEqual(["s1"]);
      expect(c.evidence.protectedPaths).toEqual({exactPaths: ["x"], protectedPrefixes: ["y/"]});
      expect(c.evidence.checkRuns[0]).toMatchObject({workflowPath: ".github/workflows/ci.yml", workflowRunEvent: "pull_request"});
      expect(c.evidence.checkRuns[1]).toMatchObject({workflowPath: null, workflowRunEvent: null});
      expect(seen.some(p => p.includes("check-runs?filter=all&"))).toBe(true);
      expect(seen.at(-1)).toMatch(/^branches\//);
      fs.appendFileSync(path.join(root, "docs/planning/merge-gate.mjs"), "// tampered\n");
      const t = collectEvidence({api, pr: 7, implementerSessions: ["s1"], root});
      expect(t.trust.reasons).toEqual(["LOCAL_TRUST_FILE_MISMATCH:docs/planning/merge-gate.mjs"]);
      const {result} = decideFor(t);
      expect(result.decision).toBe("BLOCK");
      expect(result.reasons[0]).toBe("LOCAL_TRUST_FILE_MISMATCH:docs/planning/merge-gate.mjs");
      expect(decideFor({evidence: t.evidence, body: t.body, policy: t.policy, index: t.index}).result.reasons).toContain("TRUST_RESULT_MISSING");
      fs.writeFileSync(path.join(root, "docs/planning/merge-gate.mjs"), files["docs/planning/merge-gate.mjs"]);
      moved = true;
      const m = collectEvidence({api, pr: 7, implementerSessions: ["s1"], root});
      expect(m.trust.reasons).toEqual(["TRUST_BASE_MOVED"]);
      expect(decideFor(m).result.decision).toBe("BLOCK");
      expect(() => pages(() => Array(100).fill(1), "x")).toThrow("EVIDENCE_PAGE_CAP");
      expect(() => pages(() => ({}), "x", "k")).toThrow("EVIDENCE_LIST_MALFORMED");
      fs.rmSync(root, {recursive: true, force: true});
    });
    it("A9 integration with the real merge-gate: malformed or empty evidence never auto-merges", () => {
      for (const evidence of [{}, {pr: {number: 1}}, null]) {
        const {result} = decideFor({evidence, body: body("CLOUD-T0010")});
        expect(result.decision).toBe("BLOCK");
      }
    });
  });
}
