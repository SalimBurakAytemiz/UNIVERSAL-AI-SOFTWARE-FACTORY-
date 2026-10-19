// //TR: Bu test REL-FX-1 kanıta bağlı tamamlamayı doğrular: kanıtsız/run'sız COMPLETE 409 ve journal değişmez (REL-AT-005), başka commit'in kanıtı kapıyı açmaz (REL-AT-003), BLOCKED güvenlik 409, kabul tek journal girdisinde run'ı SUCCEEDED + mission'ı COMPLETE yapar ve replay aynı sonucu verir, sahte birleşik girdi replay'de tamper sayılır; deriveOutcomes dürüst NOT_EXECUTED/UNKNOWN döner (REL-AT-001).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import {WorkOsStore} from "../core/workos/store.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {completionEvidence, deriveOutcomes} from "../core/workos/outcomes.js";
import type {RunEvidence, WorkRun} from "../core/workos/types.js";
import {HDR, T, api, drive, journalEntries, journalText, missionOf, okScript, rewriteJournal, rmTmp, runOf, runner, setup, startRun, tmpRoot} from "./support/relfx.js";
import type {Ctx} from "./support/relfx.js";

let tmp = "";
beforeEach(() => { tmp = tmpRoot("uasco-relfx1-"); });
afterEach(() => rmTmp(tmp));

const WALK = ["PREFLIGHT", "AUTHORIZED", "PLANNED", "EXECUTING", "VERIFYING", "REVIEWING", "REGRESSION", "REPORTING"] as const;
const H1 = "a".repeat(40), H2 = "b".repeat(40);
const ev = (kind: string, extra: Partial<RunEvidence> = {}): RunEvidence => ({evidenceId: `evd_${kind.toLowerCase()}`, step: "REPORT", cycle: 0, kind, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, ...extra});
const sec = (status: "PASSED" | "PARTIAL" | "BLOCKED", commitSha = H1) => ev("SECURITY_REPORT", {commitSha, security: {status, blockReason: status === "BLOCKED" ? "SECRET_DETECTED" : null} as never});
const baseRun = (over: Partial<WorkRun> = {}): WorkRun => ({runId: "run_" + "0".repeat(24), missionId: "msn_x", projectId: "prj_x", tenantId: "tA", roleId: null, executor: {implementer: "I", reviewer: "R"}, leaseId: null, leaseExpiresAt: null,
  attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 0, retryCount: 0, retryAt: null, reason: null, baseSha: H2, headSha: H1, workBranch: "b", checkpoints: [], evidence: [], createdAt: "", createdBy: "x", updatedAt: "", ...over});
const fullEvidence = (head = H1) => [ev("IMPLEMENT", {commitSha: head}), sec("PASSED", head), ev("REVIEW", {verdict: "CLEAN", commitSha: head}), ev("REPORT", {verdict: "CLEAN", commitSha: head})];
// D-M1A-STATE-MODEL-2026-10-15: ürün düzeyi COMPLETE ayrıca PRODUCT_VERIFIED kanıtı ister: doğrulanmış sandbox tanıklı VERIFY/REGRESSION (exit 0) + TEST_SURFACE'te yürütülen test sayısı > 0.
const productEvidence = (head = H1) => [ev("VERIFY_TESTS", {commitSha: head, sandboxProviderId: "TEST_SBX"}), ev("REGRESSION_TESTS", {commitSha: head, sandboxProviderId: "TEST_SBX"}),
  ev("TEST_SURFACE", {commitSha: head, testSurface: {added: [], modified: [], deleted: [], renamed: [], weakened: [], harness: [], executedTests: 2, functionalAcceptance: "UNVERIFIED_ORACLE", reason: "NO_INDEPENDENT_ORACLE", truncated: false} as never})];
// Test komutu (testin kendi sabit fikstürü) vitest biçiminde özet basar; yalnız TEST sağlayıcısıyla (passthrough) yürütülür.
const COUNTING_TEST = `import fs from "node:fs";
const v = fs.existsSync("feature.txt") ? fs.readFileSync("feature.txt", "utf8").trim() : "";
console.log(v === "ok" ? " Tests  1 passed (1)" : " Tests  1 failed (1)");
process.exit(v === "ok" ? 0 : 1);
`;

async function finishedRun(): Promise<{c: Ctx; run: WorkRun}> {
  const c = setup(tmp, "tA", {files: {"test.mjs": COUNTING_TEST, "README.txt": "base\n"}}); const fake = new FakeExecutors(okScript());
  const created = startRun(c, fake);
  const run = await drive(c, runner(c, fake), created.runId);
  expect(run.status).toBe("AWAITING_APPROVAL");
  expect(missionOf(c).status).toBe("REPORTING");
  return {c, run};
}

describe("REL-FX-1 completion predicate and outcome read-model (pure)", () => {
  it("accepts only REPORT + CLEAN REVIEW + non-BLOCKED SECURITY_REPORT bound to run.headSha", () => {
    expect(completionEvidence(baseRun({evidence: [...fullEvidence(), ...productEvidence()]}))).toEqual({ok: true, refs: {headSha: H1, reportEvidenceId: "evd_report", reviewEvidenceId: "evd_review", securityEvidenceId: "evd_security_report",
      productVerification: {state: "PRODUCT_VERIFIED", verifyEvidenceId: "evd_verify_tests", regressionEvidenceId: "evd_regression_tests", testSurfaceEvidenceId: "evd_test_surface"}}});
    // FX-1 evidence alone (static security + independent review + report) is never product-level COMPLETE
    expect(completionEvidence(baseRun({evidence: fullEvidence()}))).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    expect(completionEvidence(baseRun({evidence: [...fullEvidence(), ...productEvidence().map(e => ({...e, sandboxProviderId: undefined}))]}))).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    expect(completionEvidence(undefined)).toEqual({ok: false, reason: "COMPLETION_NO_RUN"});
    expect(completionEvidence(baseRun({status: "BLOCKED", evidence: fullEvidence()}))).toEqual({ok: false, reason: "COMPLETION_RUN_NOT_AWAITING_APPROVAL"});
    expect(completionEvidence(baseRun({headSha: null, evidence: fullEvidence()}))).toEqual({ok: false, reason: "COMPLETION_HEAD_SHA_MISSING"});
    // REL-AT-003: evidence for another commit does not satisfy the guard
    expect(completionEvidence(baseRun({evidence: fullEvidence(H2)}))).toEqual({ok: false, reason: "COMPLETION_REVIEW_EVIDENCE_MISSING"});
    expect(completionEvidence(baseRun({evidence: [sec("PASSED"), ev("REVIEW", {verdict: "CLEAN", commitSha: H1}), ev("REPORT", {verdict: "CLEAN", commitSha: H2})]}))).toEqual({ok: false, reason: "COMPLETION_REPORT_EVIDENCE_MISSING"});
    expect(completionEvidence(baseRun({evidence: [sec("PASSED", H2), ev("REVIEW", {verdict: "CLEAN", commitSha: H1}), ev("REPORT", {verdict: "CLEAN", commitSha: H1})]}))).toEqual({ok: false, reason: "COMPLETION_SECURITY_EVIDENCE_MISSING"});
    expect(completionEvidence(baseRun({evidence: [sec("BLOCKED"), ev("REVIEW", {verdict: "CLEAN", commitSha: H1}), ev("REPORT", {verdict: "CLEAN", commitSha: H1})]}))).toEqual({ok: false, reason: "COMPLETION_SECURITY_EVIDENCE_MISSING"});
    expect(completionEvidence(baseRun({evidence: [sec("PASSED"), ev("REVIEW", {verdict: "BLOCKED", commitSha: H1}), ev("REPORT", {verdict: "CLEAN", commitSha: H1})]}))).toEqual({ok: false, reason: "COMPLETION_REVIEW_EVIDENCE_MISSING"});
    expect(completionEvidence(baseRun({evidence: [sec("PASSED"), ev("REVIEW", {verdict: "CLEAN", commitSha: H1})]}))).toEqual({ok: false, reason: "COMPLETION_REPORT_EVIDENCE_MISSING"});
    // a PARTIAL security stage is not BLOCKED (the gap is shown, not hidden)
    expect(completionEvidence(baseRun({evidence: [sec("PARTIAL"), ev("REVIEW", {verdict: "CLEAN", commitSha: H1}), ev("REPORT", {verdict: "CLEAN", commitSha: H1}), ...productEvidence()]})).ok).toBe(true);
  });

  it("deriveOutcomes is honest: NOT_EXECUTED / UNKNOWN where there is no evidence, never a guessed VERIFIED", () => {
    const empty = deriveOutcomes(baseRun({status: "QUEUED", headSha: null, evidence: []}));
    expect(empty).toEqual(expect.objectContaining({execution: "NOT_EXECUTED", functionalAcceptance: "UNKNOWN", security: "NOT_EXECUTED", evidenceIntegrity: "UNKNOWN", recovery: "NOT_APPLICABLE", release: "NOT_EXECUTED", customerOutcome: "UNKNOWN"}));
    expect(Object.keys(empty.reasons).sort()).toEqual(["customerOutcome", "evidenceIntegrity", "execution", "functionalAcceptance", "recovery", "release", "security"]);
    const done = deriveOutcomes(baseRun({evidence: fullEvidence()}));
    expect(done).toEqual(expect.objectContaining({execution: "VERIFIED", security: "VERIFIED", functionalAcceptance: "UNKNOWN", evidenceIntegrity: "UNKNOWN", release: "NOT_EXECUTED"}));
    // REL-AT-001: functionalAcceptance is not VERIFIED without an independent oracle
    expect(done.functionalAcceptance).not.toBe("VERIFIED");
    expect(deriveOutcomes(baseRun({evidence: [sec("PARTIAL")]})).security).toBe("DEGRADED");
    expect(deriveOutcomes(baseRun({evidence: [sec("PASSED", H2)]})).security).toBe("STALE");
    expect(deriveOutcomes(baseRun({status: "BLOCKED", evidence: [sec("BLOCKED")]}))).toEqual(expect.objectContaining({execution: "BLOCKED", security: "BLOCKED"}));
    expect(deriveOutcomes(baseRun({status: "RECOVERY_FAILED", reason: "RECOVERY_BUDGET_EXHAUSTED", evidence: [ev("RECOVERY", {exitCode: 1})]}))).toEqual(expect.objectContaining({execution: "FAILED", recovery: "FAILED"}));
    expect(deriveOutcomes(baseRun({evidence: [...fullEvidence(), ev("RECOVERY", {exitCode: 0})]})).recovery).toBe("VERIFIED");
    // pure: input is not mutated
    const r = baseRun({evidence: fullEvidence()}); const before = JSON.stringify(r); deriveOutcomes(r); expect(JSON.stringify(r)).toBe(before);
  });
});

describe("REL-FX-1 evidence-bound COMPLETE (store + API)", () => {
  it("REL-AT-005: API COMPLETE without a run or evidence -> 409 with a stable reason and the journal unchanged", { timeout: T }, async () => {
    const c = setup(tmp, "tA", {authorize: false});
    const app = api(c);
    for (const to of WALK) expect((await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to, reason: "walk"}})).statusCode).toBe(200);
    const before = journalText(c);
    const res = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "looks done"}});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_NO_RUN"});
    expect(journalText(c)).toBe(before);
    expect(missionOf(c).status).toBe("REPORTING");
    // the store path is guarded the same way (no bypass through transitionMission)
    expect(() => c.store.transitionMission({tenantId: "tA"}, c.missionId, "COMPLETE", "x", "FOUNDER_LOCAL")).toThrow(/COMPLETION_NO_RUN/);
    expect(journalText(c)).toBe(before);
    await app.close();
  });

  it("accept: one journal entry moves the run AWAITING_APPROVAL -> SUCCEEDED and the mission REPORTING -> COMPLETE; replay reproduces it; a second COMPLETE is refused", { timeout: T }, async () => {
    const {c, run} = await finishedRun();
    const app = api(c);
    const view = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: HDR})).json();
    expect(view.outcomes).toEqual(expect.objectContaining({runId: run.runId, headSha: run.headSha, execution: "VERIFIED", functionalAcceptance: "UNKNOWN", evidenceIntegrity: "UNKNOWN", release: "NOT_EXECUTED"}));
    // the TEST sandbox provider executed the fixture test inside the gate: the only path to PRODUCT_VERIFIED (unreachable in M1a where no provider exists)
    expect(view.outcomes.productVerification).toMatchObject({state: "PRODUCT_VERIFIED", reason: "TESTS_EXECUTED_IN_VERIFIED_SANDBOX"});
    expect(view.outcomes.sourceGeneration.state).toBe("SOURCE_GENERATION_COMPLETE");
    const n = journalEntries(c).length;
    const res = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "Founder accepts"}});
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mission.status).toBe("COMPLETE");
    expect(body.run.status).toBe("SUCCEEDED");
    expect(body.outcomes.release).toBe("NOT_EXECUTED");
    const entries = journalEntries(c);
    expect(entries.length).toBe(n + 1);
    const last = entries[entries.length - 1];
    expect(last.type).toBe("RUN_TRANSITION");
    expect(last.payload).toEqual(expect.objectContaining({runId: run.runId, from: "AWAITING_APPROVAL", to: "SUCCEEDED", mission: expect.objectContaining({from: "REPORTING", to: "COMPLETE"}),
      completion: expect.objectContaining({headSha: run.headSha, productVerification: expect.objectContaining({state: "PRODUCT_VERIFIED"})})}));
    // replay of the combined write from the journal alone
    fs.rmSync(`${c.dataDir}/snapshot.json`, {force: true});
    const fresh = new WorkOsStore(c.dataDir);
    expect(fresh.isTampered).toBe(false);
    expect(fresh.getRun({tenantId: "tA"}, run.runId)!.status).toBe("SUCCEEDED");
    expect(fresh.getMission({tenantId: "tA"}, c.missionId)!.status).toBe("COMPLETE");
    const again = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "twice"}});
    expect(again.statusCode).toBe(409);
    expect(journalEntries(c).length).toBe(n + 1);
    await app.close();
  });

  it("REL-AT-003: REPORT evidence for a commit other than run.headSha -> 409, journal unchanged", { timeout: T }, async () => {
    const {c, run} = await finishedRun();
    rewriteJournal(c, es => es.map(e => e.type === "RUN_EVIDENCE" && e.payload.evidence.kind === "REPORT" ? {...e, payload: {...e.payload, evidence: {...e.payload.evidence, commitSha: "c".repeat(40)}}} : e));
    const s = new WorkOsStore(c.dataDir);
    expect(s.isTampered).toBe(false);
    const before = journalText(c);
    expect(() => s.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL")).toThrow(/COMPLETION_REPORT_EVIDENCE_MISSING/);
    expect(journalText(c)).toBe(before);
    expect(s.getRun({tenantId: "tA"}, run.runId)!.status).toBe("AWAITING_APPROVAL");
  });

  it("BLOCKED security evidence -> 409 via the API, journal unchanged", { timeout: T }, async () => {
    const {c} = await finishedRun();
    rewriteJournal(c, es => es.map(e => e.type === "RUN_EVIDENCE" && e.payload.evidence.kind === "SECURITY_REPORT" ? {...e, payload: {...e.payload, evidence: {...e.payload.evidence, security: {...e.payload.evidence.security, status: "BLOCKED"}}}} : e));
    const app = api(c);
    const before = journalText(c);
    const res = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "accept"}});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_SECURITY_EVIDENCE_MISSING"});
    expect(journalText(c)).toBe(before);
    await app.close();
  });

  it("no other write path can produce SUCCEEDED or COMPLETE, and a forged combined entry (valid hash chain) is tamper on replay", { timeout: T }, async () => {
    const c = setup(tmp, "tA", {authorize: false});
    for (const to of WALK) c.store.transitionMission({tenantId: "tA"}, c.missionId, to, "walk", "FOUNDER_LOCAL");
    // forge: a run in AWAITING_APPROVAL without any evidence, then the combined RUN_TRANSITION
    const at = new Date().toISOString(), runId = "run_" + "1".repeat(24);
    rewriteJournal(c, es => {
      const ent = {runId, missionId: c.missionId, projectId: c.projectId, tenantId: "tA", roleId: null, executor: {implementer: "I", reviewer: "R"}, leaseId: null, leaseExpiresAt: null, attempt: 0, status: "CREATED", step: "WORKSPACE",
        remediationCycle: 0, retryCount: 0, retryAt: null, reason: null, baseSha: null, headSha: "d".repeat(40), workBranch: null, checkpoints: [], evidence: [], createdAt: at, createdBy: "x", updatedAt: at};
      return [...es, {type: "RUN_CREATED", actor: "x", at, payload: {entity: ent}},
        {type: "RUN_TRANSITION", actor: "x", at, payload: {runId, leaseId: null, from: "CREATED", to: "BLOCKED", reason: "x"}}];
    });
    const s = new WorkOsStore(c.dataDir);
    expect(s.isTampered).toBe(false);
    expect(() => s.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL")).toThrow(/COMPLETION_RUN_NOT_AWAITING_APPROVAL/);
    // forged SUCCEEDED + COMPLETE entry: replay refuses it
    rewriteJournal(c, es => {
      const i = es.findIndex(e => e.type === "RUN_TRANSITION" && e.payload.to === "BLOCKED");
      es[i] = {...es[i], payload: {runId, leaseId: null, from: "CREATED", to: "QUEUED", reason: "x"}};
      return es;
    });
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
    rewriteJournal(c, es => [...es, {type: "RUN_TRANSITION", actor: "x", at, payload: {runId, leaseId: null, from: "QUEUED", to: "BLOCKED", reason: "x", mission: {missionId: c.missionId, from: "REPORTING", to: "COMPLETE", reason: "forged"}}}]);
    const t = new WorkOsStore(c.dataDir);
    expect(t.isTampered).toBe(true);
    expect(() => t.listMissions({tenantId: "tA"})).toThrow(/COMPLETION_UNSUPPORTED/);
  });

  it("forged AWAITING_APPROVAL -> SUCCEEDED + COMPLETE without evidence is tamper on replay; runner-style writes cannot set SUCCEEDED/COMPLETE", { timeout: T }, async () => {
    const {c, run} = await finishedRun();
    // engine write paths refuse
    expect(() => c.store.transitionRun(run.runId, null, "SUCCEEDED", "x", "WORKOS_RUNNER")).toThrow(/COMPLETION_REQUIRES_EVIDENCE_GUARD/);
    const before = journalText(c);
    // forge the combined entry after stripping the REVIEW evidence (valid chain)
    rewriteJournal(c, es => [...es.filter(e => !(e.type === "RUN_EVIDENCE" && e.payload.evidence.kind === "REVIEW")),
      {type: "RUN_TRANSITION", actor: "x", at: new Date().toISOString(), payload: {runId: run.runId, leaseId: null, from: "AWAITING_APPROVAL", to: "SUCCEEDED", reason: "forged", mission: {missionId: c.missionId, from: "REPORTING", to: "COMPLETE", reason: "forged"}, completion: {headSha: run.headSha}}}]);
    const t = new WorkOsStore(c.dataDir);
    expect(t.isTampered).toBe(true);
    expect(() => t.getRun({tenantId: "tA"}, run.runId)).toThrow(/COMPLETION_UNSUPPORTED/);
    // a SUCCEEDED transition without the mission move is also refused on replay
    fs.writeFileSync(`${c.dataDir}/journal.jsonl`, before);
    rewriteJournal(c, es => [...es, {type: "RUN_TRANSITION", actor: "x", at: new Date().toISOString(), payload: {runId: run.runId, leaseId: null, from: "AWAITING_APPROVAL", to: "SUCCEEDED", reason: "forged"}}]);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(true);
  });

  it("v7-b5 regression shape: the run view exposes outcomes read-only and accepting does not merge or push", { timeout: T }, async () => {
    const {c, run} = await finishedRun();
    const app = api(c);
    const res = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "accept"}});
    expect(res.statusCode).toBe(200);
    // the source repository is untouched (no merge/push by acceptance)
    const {git} = await import("./support/relfx.js");
    expect(git(c.repo, ["rev-parse", "HEAD"])).toBe(c.head);
    expect(runOf(c, run.runId).status).toBe("SUCCEEDED");
    const view = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: HDR})).json();
    expect(view.outcomes).toEqual(expect.objectContaining({execution: "VERIFIED", release: "NOT_EXECUTED"}));
    expect(view.outcomes.reasons.release).toBe("ACCEPTED_NOT_RELEASED");
    await app.close();
  });
});
