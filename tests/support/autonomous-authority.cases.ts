// //TR: Autonomous Authority Engine'in davranissal testleri (Founder kararindaki 18 zorunlu senaryo + pozitif uctan uca karar yolu). Kayitli bir test dosyasindan cagrilir; gercek approval.ts, lease-verdict ve task-lease kodunu kullanir, hicbir PASS uydurmaz.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import * as A from "../../core/authority/autonomous-authority.mjs";
import {assertApprovalValid} from "../../core/authority/approval.js";
import {claim, leaseVersion} from "../../automation/lib/task-lease.mjs";
import {bindVerdict} from "../../automation/lib/lease-verdict.mjs";

const POLICY_TEXT = fs.readFileSync("docs/authority/autonomous-authority-policy.proposed.json", "utf8");
const pol = () => JSON.parse(POLICY_TEXT);
const H = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
const S = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const manifestFor = (text: string) => JSON.stringify({sealStatus: "SEALED", files: [{path: A.POLICY_PATH, sha256: H(text)}]});
const SEALED = A.policySealStatus({policyText: POLICY_TEXT, manifestText: manifestFor(POLICY_TEXT)});
const PROTECTED = JSON.parse(fs.readFileSync("config/protected-paths.json", "utf8"));
const NOW = new Date("2026-10-20T12:00:00Z");
const HEAD = S("head"), OTHER = S("other");
const REPO = pol().repository;
const lease = (over: Record<string, unknown> = {}) => ({taskId: "T-1", environment: "cloud", workerId: "w1", sessionId: "s-builder", headSha: HEAD, epoch: 1, token: "s-builder:1:x", acquiredAt: NOW.getTime() - 1000, heartbeatAt: NOW.getTime() - 1000, expiresAt: NOW.getTime() + 600_000, ...over});
const req = (over: Record<string, unknown> = {}): any => ({requestId: "R-1", actionClass: "SOURCE_CHANGE", principal: {role: "BUILDER", sessionId: "s-builder", identity: "claude-builder"}, repository: REPO, branch: "claude/t-1", baseBranch: "v7/integration", taskId: "T-1", riskLevel: 2, headSha: HEAD, changedFiles: ["core/workos/store.ts", "tests/v7-x.test.ts"], ...over});
const ctx = (over: Record<string, unknown> = {}): any => ({policy: pol(), seal: SEALED, now: NOW, protectedPaths: PROTECTED, lease: lease(), ...over});
const CTXS = ["validate (ubuntu-latest)", "validate (windows-latest)"];
const runs = (over: any[] = []) => [...CTXS.map((name) => ({name, status: "completed", conclusion: "success", app: "github-actions", headSha: HEAD})), ...over];
const verdict = (over: Record<string, unknown> = {}) => bindVerdict({taskId: "T-1", reviewedSha: HEAD, reviewerSessionId: "s-reviewer", implementerSessionId: "s-builder", result: "CLEAN", reviewerIdentity: "claude-reviewer", builderIdentity: "claude-builder", ...over});
const PR = {headSha: HEAD, headRef: "claude/t-1", baseRef: "v7/integration", isDraft: false, mergeable: true, upToDate: true, author: "SalimBurakAytemiz"};
// //TR: Merge'in kendi GOVERNED_MERGE istegi; acikca verilmedikce kanit alanlarindan (SHA, dal, base, merge eden oturum, dosyalar) turetilir.
const mergeReq = (ev: any, over: Record<string, unknown> = {}) => req({requestId: "R-M", actionClass: "GOVERNED_MERGE", principal: {role: "SUPERVISOR", sessionId: ev.mergerSessionId, identity: "uasco-supervisor"}, branch: ev.pr?.headRef, baseBranch: ev.pr?.baseRef, headSha: ev.evaluatedSha, changedFiles: ev.changedFiles, ...over});
const mergeEv = (over: Record<string, unknown> = {}): any => {
  const ev: any = {evaluatedSha: HEAD, pr: PR, checkRuns: runs(), verdict: verdict(),
    expectation: {taskId: "T-1", implementerSessionId: "s-builder", builderIdentity: "claude-builder"}, trustRoot: {ok: true}, changedFiles: ["core/workos/store.ts"], openFindings: [], lease: lease(),
    branchProtection: {active: true, requiredContexts: CTXS}, githubReviews: [{state: "COMMENTED", author: "SalimBurakAytemiz"}], mergerSessionId: "s-supervisor", ...over};
  if (!("mergeRequest" in over)) ev.mergeRequest = mergeReq(ev);
  return ev;
};
const reasons = (d: any) => d.reasons.join(" | ");
// //TR: Her negatif senaryo hem BLOCKED durumunu hem beklenen gerekceyi zorunlu kilar (yalniz gerekce metni yetmez).
const expectBlocked = (d: any, re: RegExp, label = "") => { expect(d.status, `${label} ${reasons(d)}`).toBe(A.BLOCKED); expect(reasons(d), label).toMatch(re); };
// //TR: task-lease Store sozlesmesinin bellek ici atomik karsiligi (gercek claim() durum makinesi ile yaris testi icin).
function memStore() {
  const m = new Map<string, any>();
  return {
    createIfAbsent(id: string, rec: any) { if (m.has(id)) return {created: false, current: m.get(id)}; m.set(id, rec); return {created: true, current: rec}; },
    read(id: string) { return m.get(id) ?? null; },
    cas(id: string, expected: any, rec: any) { const cur = m.get(id); if (leaseVersion(cur) !== leaseVersion(expected)) return {ok: false, current: cur ?? null}; m.set(id, rec); return {ok: true, current: rec}; },
    remove(id: string, expected: any) { const cur = m.get(id); if (leaseVersion(cur) !== leaseVersion(expected)) return {ok: false}; m.delete(id); return {ok: true}; },
  };
}
// //TR: config/validation.json ve manifest icin kucuk yapisal fiksturler (TEST_REGISTRATION_APPEND / TRUST_ROOT_RESEAL).
const VITEST = ["node", "node_modules/vitest/vitest.mjs", "run"];
const VAL_BASE = {"//TR": "x", schemaVersion: "2.0.0", steps: [{id: "typecheck", command: ["node", "tsc"]}, {id: "tests", command: [...VITEST, "tests/a.test.ts"], requiresDependencies: true}, {id: "tests-2", command: [...VITEST, "tests/b.test.ts"], requiresDependencies: true}, {id: "tests-bs1-a", command: [...VITEST, "tests/pkg-bs1-autonomy-bootstrap-a.test.ts"], platforms: ["win32"], requiresDependencies: true}]};
const valHead = (mut: (v: any) => void) => { const v = structuredClone(VAL_BASE); mut(v); return v; };
const appendC = (v: any) => { v.steps[2].command.push("tests/c.test.ts"); };
const exists = (f: string) => f === "tests/c.test.ts";
// //TR: Dar sinif GIRDILERI (karar nesnesi degil): motor bunlardan karari her oturumda yeniden hesaplar.
const VAL_HEAD = JSON.stringify(valHead(appendC));
const M_BASE = {schemaVersion: "1.0.0", generatedAt: "t1", sealStatus: "SEALED", files: [{path: "apps/desktop/main.mjs", sha256: "2".repeat(64)}, {path: "config/validation.json", sha256: H(JSON.stringify(VAL_BASE))}]};
const M_HEAD = {...M_BASE, generatedAt: "t2", files: [M_BASE.files[0], {path: "config/validation.json", sha256: H(VAL_HEAD)}]};
const regIn = (over: Record<string, unknown> = {}) => ({classId: "TEST_REGISTRATION_APPEND", file: "config/validation.json", baseText: JSON.stringify(VAL_BASE), headText: VAL_HEAD, headFileExists: exists, ...over});
const resealIn = (over: Record<string, unknown> = {}) => ({classId: "TRUST_ROOT_RESEAL", file: A.MANIFEST_PATH, baseText: JSON.stringify(M_BASE), headText: JSON.stringify(M_HEAD), headFileBytes: (p: string) => (p === "config/validation.json" ? Buffer.from(VAL_HEAD) : null), ...over});

export function registerAutonomousAuthorityCases() {
  describe("Autonomous Authority Engine", () => {
    it("the proposed genesis policy is valid and the real repo is NOT autonomous-ready until it is sealed in the trust root", () => {
      expect(A.validatePolicy(pol())).toEqual([]);
      expect(SEALED.ok).toBe(true);
      const real = A.loadSealedPolicy(process.cwd());
      expect(real.seal.ok).toBe(false);
      const d = A.decide(req(), ctx({policy: real.policy, seal: real.seal}));
      expect(d.status).toBe(A.BLOCKED);
      expectBlocked(d, /POLICY_NOT_SEALED/);
    });
    it("1: an authorized routine task is AUTO_AUTHORIZED_BY_POLICY without any human approval, bound to the request", () => {
      const d = A.decide(req(), ctx());
      expect(reasons(d)).toBe("");
      expect(d.status).toBe(A.AUTO);
      expect(d.grantId).toBe("G-ROUTINE-BUILD");
      expect(d.policySha256).toBe(SEALED.policySha256);
      expect(A.verifyDecision(d, req(), ctx())).toEqual({ok: true, reason: "OK"});
      expect(A.toCockpitRecord(d)).toMatchObject({display: "AUTO_AUTHORIZED", actionClass: "SOURCE_CHANGE", taskId: "T-1", headSha: HEAD, reasons: []});
    });
    it("2: unauthorized tasks are rejected (class not granted to role, foreign repo, master, unknown class, risk above limit, path traversal)", () => {
      expectBlocked(A.decide(req({actionClass: "GOVERNED_MERGE"}), ctx()), /NO_MATCHING_GRANT/);
      expectBlocked(A.decide(req({repository: "evil/repo"}), ctx()), /REPOSITORY_OUT_OF_SCOPE/);
      expectBlocked(A.decide(req({branch: "master"}), ctx()), /MASTER_OUT_OF_SCOPE/);
      expectBlocked(A.decide(req({actionClass: "SOMETHING_NEW"}), ctx()), /ACTION_CLASS_UNKNOWN/);
      expectBlocked(A.decide(req({riskLevel: 4}), ctx()), /RISK_ABOVE_AUTO_LIMIT/);
      expectBlocked(A.decide(req({changedFiles: ["../etc/passwd"]}), ctx()), /REQUEST_INVALID:CHANGED_FILES/);
      expectBlocked(A.decide(req({changedFiles: ["apps/desktop/main.mjs"]}), ctx()), /PROTECTED_PATH_NOT_AUTHORIZED:apps\/desktop\/main\.mjs/);
      expectBlocked(A.decide(req(), ctx({protectedPaths: undefined})), /PROTECTED_PATH_NOT_AUTHORIZED/);
    });
    it("3: another agent cannot impersonate the Founder (role, identity, or a self-made approval record)", () => {
      expectBlocked(A.decide(req({principal: {role: "FOUNDER", sessionId: "s-builder", identity: "claude-builder"}}), ctx()), /FOUNDER_PRINCIPAL_NOT_ACCEPTED_FROM_AGENT/);
      expectBlocked(A.decide(req({principal: {role: "BUILDER", sessionId: "s-builder", identity: "founder:salimburakaytemiz"}}), ctx()), /FOUNDER_PRINCIPAL_NOT_ACCEPTED_FROM_AGENT/);
      const forged = {id: "A-1", approverIdentityId: "claude-builder", actionDigest: "a".repeat(32), targetDigest: "b".repeat(32), grantedAt: "2026-10-19T00:00:00Z", expiresAt: "2026-10-30T00:00:00Z"};
      expect(() => assertApprovalValid(forged, "a".repeat(32), "b".repeat(32), pol().trustedFounderIdentityIds, NOW)).toThrow("Approval approver not trusted");
    });
    it("4: the builder cannot stand in as its own reviewer (same session or same identity)", () => {
      expectBlocked(A.evaluateMerge(mergeEv({verdict: verdict({reviewerSessionId: "s-builder"})}), ctx()), /REVIEW_NOT_INDEPENDENT/);
      expectBlocked(A.evaluateMerge(mergeEv({verdict: verdict({reviewerIdentity: "CLAUDE-BUILDER "})}), ctx()), /REVIEW_SAME_IDENTITY/);
      expectBlocked(A.evaluateMerge(mergeEv({mergerSessionId: "s-builder"}), ctx()), /MERGE_BY_IMPLEMENTER_OR_UNKNOWN/);
    });
    it("5: a maintainer cannot apply a change broader than the narrow protected-change class", () => {
      const broader = A.evaluateProtectedChange({classId: "TEST_REGISTRATION_APPEND", file: "config/validation.json", headSha: HEAD, baseText: JSON.stringify(VAL_BASE), headText: JSON.stringify(valHead((v) => { appendC(v); v.steps[0].command = ["node", "noop"]; })), headFileExists: exists});
      expect(broader.status).toBe(A.BLOCKED);
      expectBlocked(broader, /STEP_CHANGED:typecheck/);
      expectBlocked(A.evaluateProtectedChange({classId: "TEST_REGISTRATION_APPEND", file: "config/validation.json", headSha: HEAD, baseText: JSON.stringify(VAL_BASE), headText: JSON.stringify(valHead((v) => { v.steps[2].command = [...VITEST, "tests/c.test.ts"]; })), headFileExists: exists}), /NOT_A_PURE_APPEND/);
      expectBlocked(A.evaluateProtectedChange({classId: "TEST_REGISTRATION_APPEND", file: "config/validation.json", headSha: HEAD, baseText: JSON.stringify(VAL_BASE), headText: JSON.stringify(valHead((v) => { delete v.steps[3].platforms; appendC(v); })), headFileExists: exists}), /STEP_CHANGED:tests-bs1-a/);
      const d = A.decide(req({actionClass: "TEST_REGISTRATION_APPEND", principal: {role: "MAINTAINER", sessionId: "s-maint", identity: "claude-maintainer"}, changedFiles: ["config/validation.json", "apps/desktop/main.mjs"]}), ctx({lease: lease({sessionId: "s-maint"}), protectedChanges: [regIn()]}));
      expectBlocked(d, /PROTECTED_PATH_NOT_AUTHORIZED:apps\/desktop\/main\.mjs/);
    });
    it("6: a review valid for an old SHA is rejected on the new SHA, and a decision does not carry over to a new head", () => {
      expectBlocked(A.evaluateMerge(mergeEv({verdict: verdict({reviewedSha: OTHER})}), ctx()), /REVIEW_STALE_SHA/);
      const d = A.decide(req(), ctx());
      expect(A.verifyDecision(d, req({headSha: OTHER}), ctx({lease: lease({headSha: OTHER})}))).toMatchObject({ok: false, reason: "DECISION_NOT_FOR_THIS_REQUEST"});
    });
    it("7: a fake CLEAN (unbound verdict, bot text, forged AUTO decision) never authorizes anything", () => {
      expectBlocked(A.evaluateMerge(mergeEv({verdict: {result: "CLEAN"}}), ctx()), /REVIEW_TASK_MISMATCH/);
      expectBlocked(A.evaluateMerge(mergeEv({verdict: "UASCO-LOOP-RECORD result CLEAN"}), ctx()), /REVIEW_/);
      const bad = req({changedFiles: ["config/autonomous-authority-policy.json"]});
      const forged = {...A.decide(req(), ctx()), status: A.AUTO, requestDigest: A.digestOf({forged: true})};
      expect(A.verifyDecision(forged, bad, ctx()).ok).toBe(false);
      const real = A.decide(bad, ctx());
      expect(A.verifyDecision({...real, status: A.AUTO, reasons: []}, bad, ctx()).reason).toMatch(/RECOMPUTED_BLOCKED:.*POLICY_SELF_CHANGE/);
    });
    it("8: no merge while Windows or Linux CI failed, even if the other OS is green", () => {
      const ev = mergeEv({checkRuns: [{name: CTXS[0], status: "completed", conclusion: "success", app: "github-actions", headSha: HEAD}, {name: CTXS[1], status: "completed", conclusion: "failure", app: "github-actions", headSha: HEAD}]});
      const m = A.evaluateMerge(ev, ctx());
      expect(m.merge).toBe("BLOCKED");
      expectBlocked(m, /CI_NOT_SUCCESS:validate \(windows-latest\):failure/);
      expectBlocked(A.evaluateMerge(mergeEv({checkRuns: runs([{name: CTXS[0], status: "completed", conclusion: "failure", app: "github-actions", headSha: HEAD}])}), ctx()), /CI_NOT_SUCCESS:validate \(ubuntu-latest\)/);
    });
    it("9: a trust-root mismatch blocks: tampered policy bytes are not a sealed policy, and an unverified trust root blocks merge", () => {
      const tampered = POLICY_TEXT.replace('"maxRisk": 1', '"maxRisk": 3');
      const seal = A.policySealStatus({policyText: tampered, manifestText: manifestFor(POLICY_TEXT)});
      expect(seal).toMatchObject({ok: false, reason: "POLICY_HASH_MISMATCH"});
      expectBlocked(A.decide(req(), ctx({policy: JSON.parse(tampered), seal})), /POLICY_NOT_SEALED:POLICY_HASH_MISMATCH/);
      expect(A.policySealStatus({policyText: POLICY_TEXT, manifestText: JSON.stringify({sealStatus: "STALE", files: []})}).ok).toBe(false);
      expectBlocked(A.evaluateMerge(mergeEv({trustRoot: {ok: false}}), ctx()), /TRUST_ROOT_NOT_VERIFIED/);
    });
    it("10: an unauthorized change to a protected policy/gate file is never auto-authorized", () => {
      for (const f of ["config/autonomous-authority-policy.json", "core/authority/autonomous-authority.mjs", ".github/workflows/ci.yml", "config/protected-paths.json", "scripts/run-validation.mjs", "tests/support/autonomous-authority.cases.ts"]) {
        expectBlocked(A.decide(req({changedFiles: [f]}), ctx()), /POLICY_SELF_CHANGE/, f);
        expectBlocked(A.evaluateMerge(mergeEv({changedFiles: [f]}), ctx()), /POLICY_SELF_CHANGE/, f);
      }
    });
    it("11: expired, not-yet-valid or revoked grants authorize nothing", () => {
      expectBlocked(A.decide(req(), ctx({now: new Date("2026-12-01T00:00:00Z")})), /G-ROUTINE-BUILD\(.*EXPIRED/);
      expectBlocked(A.decide(req(), ctx({now: new Date("2026-10-18T00:00:00Z")})), /NOT_YET_VALID/);
      const p = pol(); p.grants[0].revokedAt = "2026-10-20T00:00:00Z";
      const text = JSON.stringify(p);
      expectBlocked(A.decide(req(), ctx({policy: p, seal: A.policySealStatus({policyText: text, manifestText: manifestFor(text)})})), /REVOKED/);
    });
    it("12: the same task cannot be owned by two Cloud sessions (real task-lease claim race)", () => {
      const store = memStore(), t = NOW.getTime();
      const a = claim(store, {taskId: "T-1", environment: "cloud", workerId: "w1", sessionId: "s-a", now: t, ttlMs: 60_000});
      const b = claim(store, {taskId: "T-1", environment: "cloud", workerId: "w2", sessionId: "s-b", now: t, ttlMs: 60_000});
      expect([a.status, b.status]).toEqual(["GRANTED", "HELD"]);
      const asB = {role: "BUILDER", sessionId: "s-b", identity: "claude-builder"};
      expectBlocked(A.decide(req({principal: asB}), ctx({lease: a.record})), /LEASE_HELD_BY_OTHER_SESSION/);
      expectBlocked(A.decide(req({actionClass: "NEXT_TASK_CLAIM", principal: {role: "DISPATCHER", sessionId: "s-b", identity: "uasco-dispatcher"}}), ctx({lease: a.record})), /TASK_HELD_BY_OTHER_SESSION/);
      expect(A.decide(req({principal: {role: "BUILDER", sessionId: "s-a", identity: "claude-builder"}}), ctx({lease: {...a.record, headSha: HEAD}})).status).toBe(A.AUTO);
    });
    it("13: a crashed task is recovered from a checkpoint within a bounded retry budget with deterministic backoff", () => {
      const sup = {role: "SUPERVISOR", sessionId: "s-recover", identity: "uasco-supervisor"};
      const crashed = lease({expiresAt: NOW.getTime() - 1});
      const rec = (over = {}) => req({actionClass: "TASK_RECOVERY", principal: sup, attempt: 1, checkpoint: {headSha: HEAD, ref: "refs/uasco/checkpoints/T-1"}, changedFiles: [], ...over});
      expect(reasons(A.decide(rec(), ctx({lease: crashed})))).toBe("");
      expectBlocked(A.decide(rec({checkpoint: undefined}), ctx({lease: crashed})), /CHECKPOINT_REQUIRED/);
      expectBlocked(A.decide(rec({attempt: 4}), ctx({lease: crashed})), /RETRY_BUDGET_EXHAUSTED:4>3/);
      expectBlocked(A.decide(rec(), ctx({lease: lease()})), /RECOVERY_LEASE_STILL_HELD/);
      expect([1, 2, 3, 4].map((n) => A.backoffMs(pol(), n))).toEqual([60_000, 120_000, 240_000, null]);
    });
    it("14: pending, missing, foreign-app or other-SHA CI never counts", () => {
      expectBlocked(A.evaluateMerge(mergeEv({checkRuns: runs().map((r, i) => (i === 1 ? {...r, status: "in_progress", conclusion: null} : r))}), ctx()), /CI_PENDING:validate \(windows-latest\)/);
      expectBlocked(A.evaluateMerge(mergeEv({checkRuns: runs().slice(0, 1)}), ctx()), /CI_MISSING:validate \(windows-latest\)/);
      expectBlocked(A.evaluateMerge(mergeEv({checkRuns: runs().map((r) => ({...r, app: "some-bot"}))}), ctx()), /CI_MISSING:validate \(ubuntu-latest\)/);
      expectBlocked(A.evaluateMerge(mergeEv({checkRuns: runs().map((r) => ({...r, headSha: OTHER}))}), ctx()), /CI_MISSING/);
      expectBlocked(A.evaluateMerge(mergeEv({checkRuns: runs().map((r, i) => (i === 0 ? {...r, conclusion: "cancelled"} : r))}), ctx()), /CI_NOT_SUCCESS:validate \(ubuntu-latest\):cancelled/);
    });
    it("15: one blocked task does not stop other independent authorized tasks", () => {
      const decisions = [
        A.decide(req({requestId: "R-A", taskId: "T-A"}), ctx({lease: lease({taskId: "T-A", sessionId: "s-other"})})),
        A.decide(req({requestId: "R-B", taskId: "T-B"}), ctx({lease: lease({taskId: "T-B"})})),
      ];
      expect(decisions.map((d) => d.status)).toEqual([A.BLOCKED, A.AUTO]);
    });
    it("16: a bot can never produce a GitHub approval; COMMENTED is not APPROVED; a self-APPROVED review blocks merge", () => {
      expectBlocked(A.decide(req({actionClass: "GITHUB_REVIEW_APPROVE"}), ctx()), /NEVER_AUTO_CLASS:GITHUB_REVIEW_APPROVE/);
      const p = pol(); p.grants[0].actionClasses.push("GITHUB_REVIEW_APPROVE");
      expect(A.validatePolicy(p)).toContain("GRANT_NEVER_AUTO_CLASS:G-ROUTINE-BUILD:GITHUB_REVIEW_APPROVE");
      expectBlocked(A.evaluateMerge(mergeEv({githubReviews: [{state: "APPROVED", author: "SalimBurakAytemiz"}]}), ctx()), /SELF_APPROVAL_PRESENT/);
      expectBlocked(A.evaluateMerge(mergeEv({verdict: undefined, githubReviews: [{state: "COMMENTED", author: "x"}, {state: "COMMENTED", author: "y"}]}), ctx()), /REVIEW_TASK_MISMATCH/);
    });
    it("17: an approval or decision cannot be reused for another task or target", () => {
      const d = A.decide(req(), ctx());
      expect(A.verifyDecision(d, req({taskId: "T-2"}), ctx({lease: lease({taskId: "T-2"})}))).toMatchObject({ok: false, reason: "DECISION_NOT_FOR_THIS_REQUEST"});
      expect(A.verifyDecision(d, req({branch: "claude/other"}), ctx())).toMatchObject({ok: false, reason: "DECISION_NOT_FOR_THIS_REQUEST"});
      const founder = {id: "A-1", approverIdentityId: "founder:salimburakaytemiz", actionDigest: "a".repeat(32), targetDigest: "b".repeat(32), grantedAt: "2026-10-19T00:00:00Z", expiresAt: "2026-10-30T00:00:00Z"};
      expect(() => assertApprovalValid(founder, "a".repeat(32), "c".repeat(32), pol().trustedFounderIdentityIds, NOW)).toThrow("Approval target mismatch");
      const p2 = pol(); p2.policyVersion = 2; const t2 = JSON.stringify(p2);
      expect(A.verifyDecision(d, req(), ctx({policy: p2, seal: A.policySealStatus({policyText: t2, manifestText: manifestFor(t2)})}))).toMatchObject({ok: false, reason: "POLICY_CHANGED_SINCE_DECISION"});
    });
    it("18: a policy update cannot authorize itself or switch off independent review, trust root, branch protection or two-OS CI", () => {
      const maint = {role: "MAINTAINER", sessionId: "s-maint", identity: "claude-maintainer"};
      expectBlocked(A.decide(req({actionClass: "FEATURE_BRANCH_PUSH", principal: maint, changedFiles: ["config/autonomous-authority-policy.json"]}), ctx({lease: lease({sessionId: "s-maint"})})), /POLICY_SELF_CHANGE/);
      expectBlocked(A.decide(req({actionClass: "POLICY_CHANGE"}), ctx()), /NEVER_AUTO_CLASS:POLICY_CHANGE/);
      const weak = pol();
      weak.mergeRequirements.requireIndependentReview = false; weak.mergeRequirements.requireBranchProtection = false; weak.mergeRequirements.ciContexts = ["validate (ubuntu-latest)"];
      weak.grants[0].paths = ["core/authority/**"];
      expect(A.validatePolicy(weak)).toEqual(expect.arrayContaining(["MERGE_INDEPENDENT_REVIEW_REQUIRED", "MERGE_BRANCH_PROTECTION_REQUIRED", "MERGE_CI_CONTEXTS", "GRANT_COVERS_POLICY_CORE:G-ROUTINE-BUILD:core/authority/**"]));
      const manifestBase = JSON.stringify({schemaVersion: "1.0.0", generatedAt: "t1", sealStatus: "SEALED", files: [{path: A.POLICY_PATH, sha256: "1".repeat(64)}]});
      const manifestHead = JSON.stringify({schemaVersion: "1.0.0", generatedAt: "t2", sealStatus: "SEALED", files: [{path: A.POLICY_PATH, sha256: H("evil")}]});
      expectBlocked(A.evaluateProtectedChange({classId: "TRUST_ROOT_RESEAL", file: A.MANIFEST_PATH, headSha: HEAD, baseText: manifestBase, headText: manifestHead, authorizedChangedProtectedPaths: [A.POLICY_PATH], headFileBytes: () => Buffer.from("evil")}), /RESEAL_OF_POLICY_CORE/);
    });
    it("narrow protected-change classes are auto-authorized only when structurally exact (test registration + reseal from real content)", () => {
      const reg = A.evaluateProtectedChange({...regIn(), headSha: HEAD});
      expect(reasons(reg)).toBe("");
      const reseal = A.evaluateProtectedChange({...resealIn(), headSha: HEAD, authorizedChangedProtectedPaths: ["config/validation.json"]});
      expect(reasons(reseal)).toBe("");
      expectBlocked(A.evaluateProtectedChange({...resealIn({headFileBytes: () => Buffer.from("other bytes")}), headSha: HEAD, authorizedChangedProtectedPaths: ["config/validation.json"]}), /RESEAL_HASH_NOT_FROM_CONTENT/);
      const maint = {role: "MAINTAINER", sessionId: "s-maint", identity: "claude-maintainer"};
      const c = ctx({lease: lease({sessionId: "s-maint"}), protectedChanges: [regIn(), resealIn()]});
      const regReq = req({actionClass: "TEST_REGISTRATION_APPEND", principal: maint, changedFiles: ["config/validation.json"]});
      const regD = A.decide(regReq, c);
      expect(reasons(regD)).toBe("");
      expect(A.verifyDecision(regD, regReq, c)).toEqual({ok: true, reason: "OK"});
      expect(reasons(A.decide(req({actionClass: "TRUST_ROOT_RESEAL", principal: maint, changedFiles: [A.MANIFEST_PATH]}), c))).toBe("");
      // //TR: Reseal, yapisal olarak AUTO cikmis bir kayit degisikligi olmadan validation.json'u yeniden muhurleyemez.
      expectBlocked(A.decide(req({actionClass: "TRUST_ROOT_RESEAL", principal: maint, changedFiles: [A.MANIFEST_PATH]}), ctx({lease: lease({sessionId: "s-maint"}), protectedChanges: [resealIn()]})), /PROTECTED_PATH_NOT_AUTHORIZED/);
      // //TR: Korunan kayit + reseal tasiyan PR'in merge'i ayni SHA'da yeniden hesaplanan kararlarla AUTHORIZED olur.
      const files = ["config/validation.json", A.MANIFEST_PATH, "tests/c.test.ts"];
      expect(reasons(A.evaluateMerge(mergeEv({changedFiles: files, protectedChanges: [regIn(), resealIn()]}), ctx()))).toBe("");
      expect(A.evaluateMerge(mergeEv({changedFiles: files}), ctx()).reasons).toContain("PROTECTED_PATH_NOT_AUTHORIZED:config/validation.json");
    });
    it("merge is AUTHORIZED only when every gate holds; with branch protection not active it stays BLOCKED", () => {
      const m = A.evaluateMerge(mergeEv(), ctx());
      expect(reasons(m)).toBe("");
      expect(m).toMatchObject({status: A.AUTO, merge: "AUTHORIZED", evaluatedSha: HEAD});
      expectBlocked(A.evaluateMerge(mergeEv({branchProtection: {active: false}}), ctx()), /BRANCH_PROTECTION_NOT_ACTIVE/);
      expectBlocked(A.evaluateMerge(mergeEv({branchProtection: {active: true, requiredContexts: [CTXS[0]]}}), ctx()), /BRANCH_PROTECTION_MISSING_REQUIRED_CONTEXTS/);
      expectBlocked(A.evaluateMerge(mergeEv({pr: {headSha: OTHER, baseRef: "v7/integration", isDraft: false, mergeable: true}}), ctx()), /HEAD_SHA_CHANGED/);
      expectBlocked(A.evaluateMerge(mergeEv({openFindings: [{severity: "P1", resolved: false}]}), ctx()), /OPEN_BLOCKERS:1/);
      expectBlocked(A.evaluateMerge(mergeEv({pr: {headSha: HEAD, baseRef: "master", isDraft: false, mergeable: true}}), ctx()), /BASE_NOT_ALLOWED:master/);
      expectBlocked(A.evaluateMerge(mergeEv({lease: lease({headSha: OTHER})}), ctx()), /LEASE_HEAD_MISMATCH/);
      expectBlocked(A.evaluateMerge(mergeEv({changedFiles: ["apps/desktop/main.mjs"]}), ctx()), /PROTECTED_PATH_NOT_AUTHORIZED/);
      expect(A.toCockpitRecord(A.evaluateMerge(mergeEv({branchProtection: {active: false}}), ctx()))).toMatchObject({display: "BLOCKED", headSha: HEAD});
    });
    it("review a3d7eea blocker 1: a hand-made AUTO decision object authorizes no protected path; only recomputed narrow-class decisions for the class's own target do", () => {
      const fake = {status: A.AUTO, classId: "TEST_REGISTRATION_APPEND", file: "apps/desktop/main.mjs", headSha: HEAD, reasons: []};
      // //TR: Merge katmaninin kendi korunan-yol kontrolu (yalniz ic GOVERNED_MERGE karari degil) engellemeli: gerekce ust duzey listede olmali.
      for (const extra of [{protectedChangeDecisions: [fake]}, {protectedChanges: [regIn({file: "apps/desktop/main.mjs"})]}]) {
        const m = A.evaluateMerge(mergeEv({changedFiles: ["apps/desktop/main.mjs"], ...extra}), ctx());
        expect(m.status).toBe(A.BLOCKED);
        expect(m.reasons).toContain("PROTECTED_PATH_NOT_AUTHORIZED:apps/desktop/main.mjs");
      }
      const fakeOnTarget = {...fake, file: "config/validation.json"};
      expect(A.evaluateMerge(mergeEv({changedFiles: ["config/validation.json"], protectedChangeDecisions: [fakeOnTarget]}), ctx()).reasons).toContain("PROTECTED_PATH_NOT_AUTHORIZED:config/validation.json");
      const realLooking = A.evaluateProtectedChange({...regIn(), headSha: HEAD});
      const maint = {role: "MAINTAINER", sessionId: "s-maint", identity: "claude-maintainer"};
      expectBlocked(A.decide(req({actionClass: "TEST_REGISTRATION_APPEND", principal: maint, changedFiles: ["config/validation.json"]}), ctx({lease: lease({sessionId: "s-maint"}), protectedChangeDecisions: [realLooking]})), /PROTECTED_PATH_NOT_AUTHORIZED:config\/validation\.json/);
      // //TR: Cagiranin verdigi yetkili-yol listesi dar hedefler disina genisletilemez.
      const mb = {...M_BASE, files: [{path: "apps/desktop/main.mjs", sha256: "2".repeat(64)}]}, mh = {...mb, generatedAt: "t2", files: [{path: "apps/desktop/main.mjs", sha256: H("x")}]};
      expectBlocked(A.evaluateProtectedChange({classId: "TRUST_ROOT_RESEAL", file: A.MANIFEST_PATH, headSha: HEAD, baseText: JSON.stringify(mb), headText: JSON.stringify(mh), authorizedChangedProtectedPaths: ["apps/desktop/main.mjs"], headFileBytes: () => Buffer.from("x")}), /RESEAL_NOT_AUTHORIZED:apps\/desktop\/main\.mjs/);
      expectBlocked(A.evaluateProtectedChange({...resealIn({headText: JSON.stringify({...M_HEAD, files: [{...M_HEAD.files[0], note: "x"}, M_HEAD.files[1]]})}), headSha: HEAD, authorizedChangedProtectedPaths: ["config/validation.json"]}), /MANIFEST_ENTRY_FIELDS_CHANGED:apps\/desktop\/main\.mjs/);
    });
    it("review a3d7eea blocker 2: implementer and lease are bound at merge (spoofed implementer, merger = lease holder, expired lease, no clock)", () => {
      const spoof = {taskId: "T-1", implementerSessionId: "s-fake", builderIdentity: "claude-builder"};
      expectBlocked(A.evaluateMerge(mergeEv({expectation: spoof, verdict: verdict({reviewerSessionId: "s-builder", implementerSessionId: "s-fake"})}), ctx()), /IMPLEMENTER_NOT_LEASE_HOLDER/);
      expectBlocked(A.evaluateMerge(mergeEv({expectation: spoof, verdict: verdict({implementerSessionId: "s-fake"}), mergerSessionId: "s-builder"}), ctx()), /MERGE_BY_LEASE_HOLDER/);
      expectBlocked(A.evaluateMerge(mergeEv({lease: lease({expiresAt: NOW.getTime() - 1})}), ctx()), /LEASE_EXPIRED/);
      expectBlocked(A.evaluateMerge(mergeEv(), ctx({now: undefined})), /EVALUATION_TIME_INVALID/);
    });
    it("review a3d7eea nits: canonical/case-variant paths, unknown severities, the merge's own GOVERNED_MERGE decision, stale branch, grant selection by path cover", () => {
      for (const f of ["./config/autonomous-authority-policy.json", "core//authority/x.mjs", "core/authority/./x.mjs", " core/authority/x.mjs", "core/authority/"]) {
        expectBlocked(A.decide(req({changedFiles: [f]}), ctx()), /REQUEST_INVALID:CHANGED_FILES/, f);
        expectBlocked(A.evaluateMerge(mergeEv({changedFiles: [f]}), ctx()), /CHANGED_FILES_INVALID/, f);
      }
      expectBlocked(A.decide(req({actionClass: "STATUS_REPORT", changedFiles: ["a/../config/x"]}), ctx()), /REQUEST_INVALID:CHANGED_FILES/);
      expectBlocked(A.decide(req({changedFiles: ["Core/Authority/autonomous-authority.mjs"]}), ctx()), /POLICY_SELF_CHANGE/);
      expectBlocked(A.evaluateMerge(mergeEv({changedFiles: [".GitHub/Workflows/ci.yml"]}), ctx()), /POLICY_SELF_CHANGE/);
      expectBlocked(A.decide(req({changedFiles: ["Apps/Desktop/main.mjs"]}), ctx()), /PROTECTED_PATH_NOT_AUTHORIZED:Apps\/Desktop\/main\.mjs/);
      for (const severity of ["HIGH", "p1", "", undefined, "MEDIUM-HIGH"]) expectBlocked(A.evaluateMerge(mergeEv({openFindings: [{severity, resolved: false}]}), ctx()), /OPEN_BLOCKERS:1/, String(severity));
      expect(reasons(A.evaluateMerge(mergeEv({openFindings: [{severity: "P2"}, {severity: "NIT"}, {severity: "P0", resolved: true}]}), ctx()))).toBe("");
      expectBlocked(A.evaluateMerge(mergeEv({mergeRequest: undefined}), ctx()), /MERGE_REQUEST_MISSING/);
      const base = mergeEv();
      expectBlocked(A.evaluateMerge(mergeEv({mergeRequest: mergeReq(base, {principal: {role: "BUILDER", sessionId: "s-supervisor", identity: "claude-builder"}})}), ctx()), /MERGE_REQUEST_BLOCKED:NO_MATCHING_GRANT/);
      expectBlocked(A.evaluateMerge(mergeEv({mergeRequest: mergeReq(base, {changedFiles: ["docs/x.md"]})}), ctx()), /MERGE_REQUEST_MISMATCH:changedFiles/);
      expectBlocked(A.evaluateMerge(mergeEv({mergeRequest: mergeReq(base, {headSha: OTHER})}), ctx()), /MERGE_REQUEST_MISMATCH:headSha/);
      expectBlocked(A.evaluateMerge(mergeEv({pr: {...PR, upToDate: false}}), ctx()), /BRANCH_NOT_UP_TO_DATE/);
      const p = pol(); p.grants.unshift({...p.grants[0], grantId: "G-DOCS-ONLY", actionClasses: ["SOURCE_CHANGE"], paths: ["docs/**"]});
      const text = JSON.stringify(p), seal = A.policySealStatus({policyText: text, manifestText: manifestFor(text)});
      expect(A.decide(req(), ctx({policy: p, seal}))).toMatchObject({status: A.AUTO, grantId: "G-ROUTINE-BUILD"});
      expectBlocked(A.decide(req({changedFiles: ["core/workos/store.ts"]}), ctx({policy: {...p, grants: [p.grants[0]]}, seal: A.policySealStatus({policyText: JSON.stringify({...p, grants: [p.grants[0]]}), manifestText: manifestFor(JSON.stringify({...p, grants: [p.grants[0]]}))})})), /PATH_OUT_OF_GRANT:core\/workos\/store\.ts/);
    });
  });
}
