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
import path from "node:path";
import os from "node:os";
import cp from "node:child_process";
import {ENGINE, ORPHAN_MS, REPO as PAR_REPO, git, groupLive, parHarness, procAlive, release, setup as parSetup, sleep, waitUntil} from "./support/par.js";

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

// //TR: C-PAR-1 (test birleştirme): PAR-04 — engine çöktükten sonra implementer/reviewer/git çocuğu runs/<id>/work içine yazmaya devam edemez — ve #224 koordinatör incelemesinin yazar durdurma/kimlik/dayanıklılık düzeltmeleri. Heartbeat/planlama testleri tests-7'deki tests/v7-relfx-c3-remediation.test.ts'tedir (iki Windows adımı arasında bölünmüştür); ortak parçalar tests/support/par.ts'tedir. tests/v7-par-engine.mts vitest dosyası DEĞİL, bu testlerin iki ayrı süreçte çalıştırdığı yardımcıdır. Blok kendi tmp/yardımcılarını tanımlar.
describe("LANE-C parallel runs: writer reaping (C-PAR-1 PAR-04, #224 review)", () => {
  const par = parHarness();
  let tmp = ""; beforeEach(() => { tmp = par.tmp(); });
  const REPO = PAR_REPO;
  const setup = (name?: string, seed?: Record<string, string>, clock?: () => number) => parSetup(tmp, name, seed, clock);
describe("C-PAR-1 PAR-04: after an engine crash the implementer child must not keep writing into runs/<id>/work", () => {
  const TTL = 1500; // ORPHAN_MS ve release: tests/support/par.ts (yetim sabit pencereye değil release dosyasına bağlıdır)
  const spawnEngine = (dir: string, phase: "1" | "2") => {
    const child = cp.spawn(process.execPath, ["--import", "tsx", ENGINE, REPO, dir, phase, String(TTL), String(ORPHAN_MS)], {cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
    let out = "", err = "";
    child.stdout.on("data", d => { out += String(d); }); child.stderr.on("data", d => { err += String(d); });
    const closed = new Promise<number | null>(r => child.on("close", code => r(code)));
    return {child, closed, text: () => ({out, err})};
  };
  const waitFor = async (pred: () => boolean, ms: number) => { for (const until = Date.now() + ms; Date.now() < until;) { if (pred()) return true; await sleep(50); } return false; };

  it("a surviving implementer child is stopped at takeover: ORPHAN.txt absent, work HEAD == run.headSha, run completes", { timeout: 180_000 }, async () => {
    const dir = path.join(tmp, "engine"); fs.mkdirSync(dir);
    const e1 = spawnEngine(dir, "1");
    expect(await Promise.race([waitFor(() => fs.existsSync(path.join(dir, "implementing.json")), 120_000), e1.closed.then(() => false)]), JSON.stringify(e1.text())).toBe(true);
    const { runId } = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as {runId: string};
    const ownerFile = path.join(dir, "data", "runs", runId, "workspace.owner.json");
    // //TR: düzeltilmiş motorda sahiplik kaydı çocuğun grubunu taşır (Linux dışında kimlik belirteci eşzamansız eklenir); düzeltme öncesi motorda kayıt hiç yoktur ve bekleme süresi dolar.
    await waitFor(() => { try { const o = JSON.parse(fs.readFileSync(ownerFile, "utf8")); return o.childPgid != null && (process.platform === "linux" || o.childStart != null); } catch { return false; } }, 10_000);
    e1.child.kill("SIGKILL"); await e1.closed;
    const e2 = spawnEngine(dir, "2");
    expect(await e2.closed, JSON.stringify(e2.text())).toBe(0);
    const rep = JSON.parse(e2.text().out.trim().split("\n").pop()!) as {recovered: string[]};
    expect(rep.recovered).toEqual([runId]);
    await release(dir); // yetim çocuk (hâlâ yaşıyorsa) şimdi uyanıp yazardı
    const run = new WorkOsStore(path.join(dir, "data")).engineGetRun(runId)!;
    const work = path.join(dir, "data", "runs", runId, "work");
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(fs.existsSync(path.join(work, "ORPHAN.txt"))).toBe(false);
    expect(git(work, ["log", "--format=%s"]).split("\n")).not.toContain("orphan commit");
    expect(git(work, ["rev-parse", "HEAD"])).toBe(run.headSha);
  });

  it("guardWorkspace fences a mutation when the owner record is missing, unreadable or belongs to another lease", () => {
    const c = setup(); const r = c.mkRun("A"), mr = c.runner(), run = c.store.engineGetRun(r.runId)!;
    const guard = (lease: string) => (mr as unknown as {guardWorkspace(run: unknown, leaseId: string): void}).guardWorkspace(run, lease);
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    expect(() => guard("lse_a")).toThrow(/WORKOS_LEASE_FENCED/); // no record
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({leaseId: "lse_a", engineId: "e", hostname: os.hostname(), pid: process.pid, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString()}));
    expect(() => guard("lse_a")).not.toThrow();
    expect(() => guard("lse_b")).toThrow(/WORKOS_LEASE_FENCED/); // another engine's lease
    fs.writeFileSync(file, "{not json");
    expect(() => guard("lse_a")).toThrow(/WORKOS_LEASE_FENCED/); // unreadable: fail closed
  });

  it("VERIFY refuses a workspace whose HEAD is not the recorded headSha (WORKSPACE_DIVERGED) instead of silently repairing it", { timeout: 90_000 }, async () => {
    const c = setup(); const r = c.mkRun("A");
    const mr = c.runner({maxStepsPerTick: 2}); // WORKSPACE + IMPLEMENT only
    await mr.tick();
    expect(c.store.engineGetRun(r.runId)!.step).toBe("VERIFY");
    const work = path.join(c.dataDir, "runs", r.runId, "work");
    git(work, ["-c", "user.name=X", "-c", "user.email=x@x.invalid", "commit", "-q", "--allow-empty", "-m", "behind the engine's back"]);
    await mr.tick();
    const after = c.store.engineGetRun(r.runId)!;
    expect([after.status, after.reason]).toEqual(["FAILED", "WORKSPACE_DIVERGED"]);
  });

  it("takeover is fail-closed when the previous writer cannot be established, and never signals a process whose identity does not match", { timeout: 120_000 }, async () => {
    const c = setup();
    const crashed = async (patch: Record<string, unknown>) => {
      const r = c.mkRun(`R${Math.random()}`);
      const first = c.runner({leaseTtlMs: 300, maxStepsPerTick: 0, executors: c.base});
      expect((await first.tick()).claimed).toEqual([r.runId]); // LEASED, hiçbir adım çalışmadı
      const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file, JSON.stringify({leaseId: "lse_gone", engineId: "engine_gone", hostname: os.hostname(), pid: 1, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString(), ...patch}));
      await sleep(450); // lease süresi doldu
      const rep = await c.runner({executors: c.base}).tick(); // generous TTL: only the first runner's lease (300 ms) must expire; the takeover runner runs a whole pipeline and must not fence itself under CPU load
      expect(rep.recovered).toEqual([r.runId]);
      const run = c.store.engineGetRun(r.runId)!;
      return {run, note: run.evidence.find(e => e.kind === "RECOVERY")?.note ?? ""};
    };
    const decoy = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore", windowsHide: true, ...(process.platform === "win32" ? {} : {detached: true})});
    const alive = () => { try { process.kill(decoy.pid!, 0); return true; } catch { return false; } };
    try {
      let x = await crashed({childPgid: 4242424, childStart: "1", hostname: "other-host.invalid"});
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(x.note).toMatch(/writer group 4242424 belongs to host other-host\.invalid/);
      x = await crashed({childPgid: null, step: "IMPLEMENT", leaseId: "lse_gone"}); // kayıtlı çocuk yok: devir serbest
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      x = await crashed({childPgid: decoy.pid, childStart: "not-the-start-time-of-this-process"}); // pid yeniden kullanılmış: ASLA sinyal gönderilmez
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/was reused by another process/);
      expect(alive()).toBe(true);
      x = await crashed({childPgid: decoy.pid, childStart: null}); // canlı grup, kimlik kanıtlanamıyor: fail-closed, öldürülmez
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(x.note).toMatch(/identity cannot be proven/);
      expect(alive()).toBe(true);
    } finally { try { if (process.platform === "win32") decoy.kill(); else process.kill(-decoy.pid!, "SIGKILL"); } catch { /* zaten bitmiş */ } }
  });
});

describe("C-PAR-1 review round 1 (#224): writer reaping, identity and durability", () => {
  const wg = () => import("../core/workos/writer-guard.js").catch(() => null);
  const TTL = 1500;
  const spawnEngine = (dir: string, phase: "1" | "2", opts: Record<string, unknown> = {}, ttlOverride?: number) => {
    const child = cp.spawn(process.execPath, ["--import", "tsx", ENGINE, REPO, dir, phase, String(ttlOverride ?? TTL), String(ORPHAN_MS), JSON.stringify(opts)], {cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
    let out = "", err = "";
    child.stdout.on("data", d => { out += String(d); }); child.stderr.on("data", d => { err += String(d); });
    const closed = new Promise<number | null>(r => child.on("close", code => r(code)));
    return {child, closed, text: () => ({out, err})};
  };
  const waitFor = waitUntil, groupAlive = groupLive;
  // //TR: Başarısız bir testin arkasında yetim implementer/torun grupları kalmasın (sızıntı sonraki testi ve Windows tmp temizliğini bozar).
  const leaked: number[] = [];
  afterEach(() => { for (const g of leaked.splice(0)) { try { process.kill(-g, "SIGKILL"); } catch { /* bitmiş */ } } });
  // Faz 1'i başlatır, implementer çocuğu uyurken motoru öldürür (SIGKILL); {dir, runId, pgid, killedAt} döner.
  const crashEngine = async (dir: string, opts: Record<string, unknown> = {}) => {
    fs.mkdirSync(dir);
    const e1 = spawnEngine(dir, "1", opts);
    expect(await Promise.race([waitFor(() => fs.existsSync(path.join(dir, "implementing.json")), 120_000), e1.closed.then(() => false)]), JSON.stringify(e1.text())).toBe(true); // motor 1 erken çıkarsa (içe aktarma hatası) 120 sn beklemeden stderr ile başarısız ol
    const {runId} = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as {runId: string};
    const ownerFile = path.join(dir, "data", "runs", runId, "workspace.owner.json");
    let pgid = 0;
    await waitFor(() => { try { const o = JSON.parse(fs.readFileSync(ownerFile, "utf8")); pgid = o.childPgid ?? 0; return o.childPgid != null && (process.platform === "linux" || o.childStart != null); } catch { return false; } }, 10_000);
    if (opts.grandchild) expect(await waitFor(() => fs.existsSync(path.join(dir, `${String(opts.grandchild)}.pid`)), 10_000)).toBe(true); // torun doğdu ve pid'ini yazdı
    const killedAt = Date.now();
    if (pgid > 1) leaked.push(pgid);
    e1.child.kill("SIGKILL"); await e1.closed;
    return {dir, runId, pgid, killedAt, work: path.join(dir, "data", "runs", runId, "work")};
  };
  const recoveryNote = (dir: string, runId: string) => new WorkOsStore(path.join(dir, "data")).engineGetRun(runId)!.evidence.find(e => e.kind === "RECOVERY")?.note ?? "";
  // //TR: Başarısız bir onaylamanın nedeni okunabilsin diye durum özeti (yetim artık sabit bir pencereye değil release dosyasına bağlıdır).
  const snap = (x: {dir: string; runId: string; pgid: number; killedAt: number; work: string}, closedAfterMs: number) => () => { const r = new WorkOsStore(path.join(x.dir, "data")).engineGetRun(x.runId)!; return JSON.stringify({takeoverClosedMsAfterKill: closedAfterMs, status: r.status, reason: r.reason, groupAlive: groupAlive(x.pgid), orphanFile: fs.existsSync(path.join(x.work, "ORPHAN.txt")), note: recoveryNote(x.dir, x.runId)}); };

  it("PAR04-GSTOP-NO-REAP: a GLOBAL_STOP that is active at takeover still stops the crashed engine's writer BEFORE the run is cancelled", { timeout: 180_000 }, async () => {
    const x = await crashEngine(path.join(tmp, "stop"));
    expect(x.pgid).toBeGreaterThan(1);
    fs.writeFileSync(path.join(x.dir, "rt", "GLOBAL_STOP.json"), JSON.stringify({active: true, reason: "TEST_STOP", actor: "test"}));
    const e2 = spawnEngine(x.dir, "2");
    expect(await e2.closed, JSON.stringify(e2.text())).toBe(0);
    const why = snap(x, Date.now() - x.killedAt);
    await release(x.dir);
    const run = new WorkOsStore(path.join(x.dir, "data")).engineGetRun(x.runId)!;
    expect(run.status, why()).toBe("CANCELLED");
    expect(groupAlive(x.pgid), why()).toBe(false);
    expect(fs.existsSync(path.join(x.work, "ORPHAN.txt")), why()).toBe(false);
    expect(run.evidence.find(e => e.kind === "CANCEL")?.note ?? "", why()).toMatch(/stopped writer group/);
  });

  it("TK-2 / PAR04-EXHAUSTED-NO-REAP: a takeover that exhausts the recovery budget still stops the writer; the reason stays RECOVERY_BUDGET_EXHAUSTED and the note names the stopped group", { timeout: 180_000 }, async () => {
    const x = await crashEngine(path.join(tmp, "exhaust"));
    const e2 = spawnEngine(x.dir, "2", {maxRecoveries: 0});
    expect(await e2.closed, JSON.stringify(e2.text())).toBe(0);
    const why = snap(x, Date.now() - x.killedAt);
    await release(x.dir);
    const run = new WorkOsStore(path.join(x.dir, "data")).engineGetRun(x.runId)!;
    expect([run.status, run.reason], why()).toEqual(["RECOVERY_FAILED", "RECOVERY_BUDGET_EXHAUSTED"]);
    expect(groupAlive(x.pgid), why()).toBe(false);
    expect(fs.existsSync(path.join(x.work, "ORPHAN.txt")), why()).toBe(false);
    expect(recoveryNote(x.dir, x.runId), why()).toMatch(/stopped writer group/);
  });

  it("TEST-PAR04-DEFENCES (M7): a descendant in the writer's process group is stopped too, not only the leader", { timeout: 180_000 }, async () => {
    const x = await crashEngine(path.join(tmp, "grp"), {grandchild: "group"});
    const gcPid = Number(fs.readFileSync(path.join(x.dir, "group.pid"), "utf8"));
    expect(procAlive(gcPid)).toBe(true); // yetim torun çöken motordan sonra sürüyor
    const e2 = spawnEngine(x.dir, "2", {grandchild: "group"});
    expect(await e2.closed, JSON.stringify(e2.text())).toBe(0);
    expect(await waitUntil(() => !procAlive(gcPid), 5000), "a group member survived the kill").toBe(true);
    await release(x.dir); // torun (hâlâ yaşıyorsa) şimdi ORPHAN2.txt yazardı
    expect(fs.existsSync(path.join(x.work, "ORPHAN2.txt"))).toBe(false);
    expect(new WorkOsStore(path.join(x.dir, "data")).engineGetRun(x.runId)!.status).toBe("AWAITING_APPROVAL");
  });

  it.skipIf(process.platform !== "linux")("TK-1: a descendant that called setsid (left the process group) AND works outside the run directory is found by the lease marker alone and stopped; the run delivers only the new engine's work", { timeout: 180_000 }, async () => {
    const x = await crashEngine(path.join(tmp, "setsid"), {grandchild: "setsid"});
    const gcPid = Number(fs.readFileSync(path.join(x.dir, "setsid.pid"), "utf8"));
    expect(procAlive(gcPid)).toBe(true);
    expect(groupLive(gcPid), "the detached descendant must be in its OWN group").toBe(true);
    const e2 = spawnEngine(x.dir, "2");
    expect(await e2.closed, JSON.stringify(e2.text())).toBe(0);
    const run = new WorkOsStore(path.join(x.dir, "data")).engineGetRun(x.runId)!;
    expect(procAlive(gcPid), "the detached descendant survived the takeover").toBe(false);
    await release(x.dir); // torun (hâlâ yaşıyorsa) şimdi ORPHAN3.txt yazardı
    expect(fs.existsSync(path.join(x.work, "ORPHAN3.txt"))).toBe(false);
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(git(x.work, ["rev-parse", "HEAD"])).toBe(run.headSha);
    expect(recoveryNote(x.dir, x.runId)).toMatch(/swept \d+ detached writer process/);
  });

  it.skipIf(process.platform === "win32")("TK-5: SIGINT to the engine (service mode) kills the implementer group it started in its own session; the engine then dies of the signal", { timeout: 180_000 }, async () => {
    const dir = path.join(tmp, "sigint"); fs.mkdirSync(dir);
    const e1 = spawnEngine(dir, "1", {service: true}, 60_000);
    try { // servis kipindeki motor kendiliğinden çıkmaz: bir onaylama başarısız olursa bile motor ve yazar grubu burada öldürülür
      expect(await Promise.race([waitFor(() => fs.existsSync(path.join(dir, "implementing.json")), 120_000), e1.closed.then(() => false)]), JSON.stringify(e1.text())).toBe(true);
      const {runId} = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as {runId: string};
      const ownerFile = path.join(dir, "data", "runs", runId, "workspace.owner.json");
      let pgid = 0;
      expect(await waitFor(() => { try { pgid = JSON.parse(fs.readFileSync(ownerFile, "utf8")).childPgid ?? 0; return pgid > 1; } catch { return false; } }, 10_000)).toBe(true);
      leaked.push(pgid);
      e1.child.kill("SIGINT"); // yalnız motora (çocuk kendi oturumundadır: terminalin Ctrl+C'si ona ulaşmazdı)
      const code = await Promise.race([e1.closed, sleep(15_000).then(() => "TIMEOUT" as const)]);
      expect(code, JSON.stringify(e1.text())).not.toBe("TIMEOUT");
      expect(await waitFor(() => !groupAlive(pgid), 5_000), "the implementer group outlived the engine").toBe(true);
      await release(dir);
      expect(fs.existsSync(path.join(dir, "data", "runs", runId, "work", "ORPHAN.txt"))).toBe(false);
    } finally { try { e1.child.kill("SIGKILL"); } catch { /* bitmiş */ } }
  });

  // ---- in-process: owner-record identity and durability ----
  const crashedRun = async (c: ReturnType<typeof setup>, patch: Record<string, unknown>, o: {raw?: string; mtimeSec?: number; inRunDir?: (runDir: string) => void} = {}) => {
    const r = c.mkRun(`R${Math.random()}`);
    const first = c.runner({leaseTtlMs: 300, maxStepsPerTick: 0, executors: c.base});
    expect((await first.tick()).claimed).toEqual([r.runId]); // LEASED, hiçbir adım çalışmadı
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const boot = (await wg())?.bootId?.() ?? null;
    fs.writeFileSync(file, o.raw ?? JSON.stringify({leaseId: "lse_gone", engineId: "engine_gone", hostname: os.hostname(), pid: 1, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString(), bootId: boot, ...patch}));
    if (o.mtimeSec !== undefined) fs.utimesSync(file, o.mtimeSec, o.mtimeSec);
    o.inRunDir?.(path.dirname(file));
    await sleep(450); // lease süresi doldu
    const rep = await c.runner({executors: c.base}).tick(); // cömert TTL: yalnız ilk runner'ın lease'i (300 ms) dolmalı
    expect(rep.recovered).toEqual([r.runId]);
    const run = c.store.engineGetRun(r.runId)!;
    return {run, note: run.evidence.find(e => e.kind === "RECOVERY")?.note ?? ""};
  };
  const sleeper = () => cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore", windowsHide: true, ...(process.platform === "win32" ? {} : {detached: true})});
  const isAlive = procAlive;
  const killGroup = (pid: number) => { try { if (process.platform === "win32") process.kill(pid); else process.kill(-pid, "SIGKILL"); } catch { /* zaten bitmiş */ } };

  it.skipIf(process.platform !== "linux")("TK-1 (cwd): a process whose working directory is inside the run directory is stopped at takeover even without a lease marker (the untracked VERIFY test process)", { timeout: 120_000 }, async () => {
    const c = setup();
    let decoy = null as cp.ChildProcess | null;
    try {
      const x = await crashedRun(c, {}, {inRunDir: runDir => { decoy = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {cwd: runDir, stdio: "ignore", detached: true}); }});
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/swept 1 detached writer process/);
      expect(await waitUntil(() => !procAlive(decoy!.pid!), 5000), "the process working inside the run directory survived the takeover").toBe(true);
    } finally { try { if (decoy?.pid) process.kill(-decoy.pid, "SIGKILL"); } catch { /* bitmiş */ } }
  });

  it("TK-3: a recorded pid that now belongs to another user's process (kill -> EPERM) is a REUSED pid when its start token differs: the takeover proceeds and nothing is signalled; an equal token stays fail-closed", { timeout: 120_000 }, async () => {
    const c = setup(), decoy = sleeper();
    const target = process.platform === "win32" ? decoy.pid! : -decoy.pid!;
    const realKill = process.kill.bind(process), signalled: Array<[number, unknown]> = [];
    const decoyAlive = () => { try { realKill(decoy.pid!, 0); return true; } catch { return false; } };
    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0 && pid === target) { const e = new Error("EPERM") as NodeJS.ErrnoException; e.code = "EPERM"; throw e; } // başka kullanıcının süreci
      if (signal !== 0 && (pid === target || pid === decoy.pid)) signalled.push([pid, signal]);
      return realKill(pid, signal as never);
    }) as typeof process.kill);
    try {
      let x = await crashedRun(c, {childPgid: decoy.pid, childStart: "not-the-start-time-of-this-process"});
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/was reused by another process/);
      expect(decoyAlive()).toBe(true);
      expect(signalled).toEqual([]);
      const token = await (await wg())?.startToken(decoy.pid!);
      if (token) { // belirteç aynı + EPERM: grup bizim olabilir ama sinyal gönderemeyiz -> bilinmiyor -> fail-closed
        x = await crashedRun(c, {childPgid: decoy.pid, childStart: token});
        expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
        expect(signalled).toEqual([]);
      }
    } finally { killGroup(decoy.pid!); }
  });

  it("TK-4: a torn owner record is fail-closed in the same boot, but processes do not survive a reboot: a record older than the boot, or written in another boot, means no writer (and nothing is signalled)", { timeout: 120_000 }, async () => {
    const c = setup(), decoy = sleeper();
    try {
      let x = await crashedRun(c, {}, {raw: "\0".repeat(256)}); // güç kesintisi sonrası NUL dolu dosya, ama bu önyüklemede yazılmış
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(x.note).toMatch(/owner record invalid/);
      x = await crashedRun(c, {}, {raw: "\0".repeat(256), mtimeSec: 1}); // dosya önyüklemeden ESKİ
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/before the current boot/);
      const token = await (await wg())?.startToken(decoy.pid!);
      x = await crashedRun(c, {childPgid: decoy.pid, childStart: token ?? "1", bootId: "linux:another-boot-id"}); // kimliği KANITLANMIŞ ama başka önyüklemeden
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/previous boot/);
      expect(isAlive(decoy.pid!)).toBe(true);
    } finally { killGroup(decoy.pid!); }
  });

  it("TK-4: the owner record cannot be written at a step start (transient disk/rename error) -> the step is RETRIED, not failed with ENGINE_ERROR", { timeout: 90_000 }, async () => {
    const c = setup(), r = c.mkRun("A");
    const mr = c.runner({maxStepsPerTick: 1});
    await mr.tick(); // WORKSPACE
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    fs.rmSync(file, {force: true}); fs.rmSync(`${file}.prev`, {force: true}); fs.mkdirSync(file); // kayıt yerine dizin: yazı başarısız olur
    await mr.tick(); // IMPLEMENT adım başı
    const after = c.store.engineGetRun(r.runId)!;
    expect([after.status, after.reason]).toEqual(["RETRY_SCHEDULED", "OWNER_RECORD_WRITE_FAILED"]);
  });

  it("TK-4: owner.json is written durably (atomic helper: a .prev copy of the previous record exists after the second write)", { timeout: 90_000 }, async () => {
    const c = setup(), r = c.mkRun("A");
    await c.runner({maxStepsPerTick: 2}).tick(); // WORKSPACE + IMPLEMENT: kayıt birden çok kez yeniden yazılır
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({hostname: os.hostname()});
    expect(fs.existsSync(`${file}.prev`), "fsync'li atomik yazıcı önceki kaydı .prev olarak tutar").toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toHaveProperty("bootId");
  });

  it.skipIf(process.platform !== "linux")("TK-7: a leaderless group is killed only when its boot, its members' start times AND the recorded lease marker prove it is the recorded writer's; otherwise fail-closed and untouched", { timeout: 180_000 }, async () => {
    const c = setup(), G = await wg();
    const leaderless = async (lease?: string) => { // lider çıkar, üye (sleep) grupta kalır; lease verilirse üye yazarın lease işaretini taşır (çocuk ortamı miras alır)
      const leader = cp.spawn("sh", ["-c", "sleep 60 & sleep 1.2; exit 0"], {stdio: "ignore", detached: true, env: {...process.env, ...(lease ? {UASCO_WRITER_LEASE: lease} : {})}});
      const token = G!.startTokenLinux(leader.pid!)!;
      await new Promise<void>(r => leader.on("exit", () => r()));
      await waitFor(() => (G!.groupMembers(leader.pid!) ?? []).length > 0, 3000);
      return {pgid: leader.pid!, token};
    };
    const cleanup = (pgid: number) => { try { process.kill(-pgid, "SIGKILL"); } catch { /* bitmiş */ } };
    let a = await leaderless("lse_gone");
    const stranger = await leaderless(); // aynı önyükleme, lider kayıttan sonra başlamış üyeler, AMA lease işareti yok: grup kimliği yeniden alınmış yabancı bir grup (çift çatallanmış daemon) gibi
    try {
      // (a) kayıtlı başlangıçtan ÖNCE başlamış bir üye: bu grup yazarın değil -> öldürülmez
      let x = await crashedRun(c, {childPgid: a.pgid, childStart: String(Number(a.token) + 100_000_000)});
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(G!.groupMembers(a.pgid)!.length).toBeGreaterThan(0);
      // (b) önyükleme kimliği kayıtta yok (eski kayıt): kanıtlanamaz -> öldürülmez
      x = await crashedRun(c, {childPgid: a.pgid, childStart: a.token, bootId: null});
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(G!.groupMembers(a.pgid)!.length).toBeGreaterThan(0);
      // (b2) R2: önyükleme ve başlangıç zamanı tutuyor ama hiçbir üyenin ortamında kaydın lease işareti yok: yabancı grup -> öldürülmez
      x = await crashedRun(c, {childPgid: stranger.pgid, childStart: stranger.token});
      expect([x.run.status, x.run.reason]).toEqual(["RECOVERY_FAILED", "RECOVERY_FAILED: WORKSPACE_WRITER_ALIVE"]);
      expect(x.note).toMatch(/no member carries the recorded lease marker/);
      expect(G!.groupMembers(stranger.pgid)!.length).toBeGreaterThan(0);
      // (c) aynı önyükleme + üye lider başladıktan sonra başlamış + üye lease işaretini taşıyor: kanıtlandı -> öldürülür
      x = await crashedRun(c, {childPgid: a.pgid, childStart: a.token});
      expect(x.run.status).toBe("AWAITING_APPROVAL");
      expect(x.note).toMatch(/stopped writer group/);
      expect(await waitFor(() => (G!.groupMembers(a.pgid) ?? []).length === 0, 3000)).toBe(true);
    } finally { cleanup(a.pgid); cleanup(stranger.pgid); }
  });

  // ---- R2 (second adversarial pass): sweep and reap ----
  it("R2-8: the sweep re-scans and re-kills until a scan is clean (a descendant forked after the first snapshot is not left alive); an unkillable one is reported as a survivor", async () => {
    const G = await wg();
    const scans: number[][] = [[11], [11, 12], [12], []], killed: number[] = [];
    const r = await G!.sweepWriters({runDir: "/x", runId: "r", currentLeaseId: "l"}, 5000, {find: () => scans.shift() ?? [], kill: pid => { killed.push(pid); }});
    expect(killed).toEqual([11, 11, 12, 12]);
    expect([r.killed.sort(), r.survivors]).toEqual([[11, 12], []]);
    const stuck = await G!.sweepWriters({runDir: "/x", runId: "r", currentLeaseId: "l"}, 200, {find: () => [7], kill: () => undefined});
    expect(stuck.survivors).toEqual([7]);
  });

  it.skipIf(process.platform !== "linux")("R2-9: an unmarked process whose cwd is inside the run directory is found even when the configured run directory goes through a symlink; a sibling directory with the same prefix is not", async () => {
    const G = await wg();
    const real = path.join(tmp, "real"), run = path.join(real, "run_x"), sibling = path.join(real, "run_x_other");
    fs.mkdirSync(run, {recursive: true}); fs.mkdirSync(sibling, {recursive: true});
    const link = path.join(tmp, "link"); fs.symlinkSync(real, link, "dir");
    const spawn = (cwd: string) => cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {cwd, stdio: "ignore", detached: true});
    const inside = spawn(run), outside = spawn(sibling);
    leaked.push(inside.pid!, outside.pid!);
    try {
      expect(await waitFor(() => { try { return fs.readlinkSync(`/proc/${inside.pid}/cwd`) === run && fs.readlinkSync(`/proc/${outside.pid}/cwd`) === sibling; } catch { return false; } }, 10_000)).toBe(true);
      const hits = G!.findLeaseWriters({runDir: path.join(link, "run_x"), runId: "run_x", currentLeaseId: "lse_now"});
      expect(hits).toContain(inside.pid);
      expect(hits).not.toContain(outside.pid);
    } finally { inside.kill("SIGKILL"); outside.kill("SIGKILL"); }
  });

  it.skipIf(process.platform !== "linux")("R2-10: a detached descendant that outlives a TIMED-OUT implementer is killed before the next step (the step's own lease marker is swept after every implementer, not only at takeover)", { timeout: 120_000 }, async () => {
    const c = setup(); c.mkRun("A");
    const pidFile = path.join(tmp, "gc.pid");
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "ok\n"}, sleepMs: 30_000, grandchild: {file: path.join(tmp, "never.txt"), delayMs: 60_000, detached: true, pidFile, cwd: tmp}}), review: () => ({verdict: "CLEAN"})});
    let gc = 0;
    try {
      await c.runner({executors: fake.pair(), executorTimeoutMs: 1500, maxStepsPerTick: 2}).tick(); // WORKSPACE + IMPLEMENT (zaman aşımı)
      gc = Number(fs.readFileSync(pidFile, "utf8"));
      expect(gc).toBeGreaterThan(1);
      expect(await waitFor(() => !procAlive(gc), 3000), "the detached descendant of the timed-out implementer is still running").toBe(true);
    } finally { if (gc > 1) { try { process.kill(gc, "SIGKILL"); } catch { /* bitmiş */ } } }
  });

  it("R2-11: a failed owner-record refresh at the end of the takeover does not block the emergency cancel: GLOBAL_STOP still ends the run CANCELLED (not FAILED with ENGINE_ERROR)", { timeout: 90_000 }, async () => {
    const c = setup(), r = c.mkRun("A");
    const first = c.runner({leaseTtlMs: 300, maxStepsPerTick: 0, executors: c.base});
    expect((await first.tick()).claimed).toEqual([r.runId]);
    const file = path.join(c.dataDir, "runs", r.runId, "workspace.owner.json");
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({leaseId: "lse_gone", engineId: "engine_gone", hostname: os.hostname(), pid: 1, childPgid: null, childStart: null, step: "IMPLEMENT", at: new Date().toISOString(), bootId: (await wg())?.bootId?.() ?? null}));
    const gs = path.join(path.dirname(c.dataDir), "rt", "GLOBAL_STOP.json");
    fs.mkdirSync(path.dirname(gs), {recursive: true});
    fs.writeFileSync(gs, JSON.stringify({active: true, reason: "TEST_STOP", actor: "test"}));
    await sleep(450); // ilk lease doldu
    const realRename = fs.renameSync.bind(fs), realCopy = fs.copyFileSync.bind(fs);
    const eperm = () => Object.assign(new Error("EPERM: simulated"), {code: "EPERM"});
    vi.spyOn(fs, "renameSync").mockImplementation(((a: fs.PathLike, b: fs.PathLike) => { if (String(b).endsWith("workspace.owner.json")) throw eperm(); return realRename(a, b); }) as typeof fs.renameSync);
    vi.spyOn(fs, "copyFileSync").mockImplementation(((a: fs.PathLike, b: fs.PathLike, m?: number) => { if (String(b).endsWith("workspace.owner.json")) throw eperm(); return realCopy(a, b, m); }) as typeof fs.copyFileSync);
    try { await c.runner({executors: c.base}).tick(); } finally { vi.restoreAllMocks(); }
    const run = c.store.engineGetRun(r.runId)!;
    expect([run.status, run.reason], JSON.stringify(run.evidence.map(e => e.note))).toEqual(["CANCELLED", "GLOBAL_STOP_ACTIVE: TEST_STOP"]);
  });

  it("TK-6 / TK-8: the macOS/BSD identity command pins TZ/locale and uses an absolute ps; the Windows kill is ONE PowerShell call that re-checks the start time and refuses a non-numeric token", async () => {
    const G = await wg();
    const mac = G?.startTokenCommand?.("darwin", 4242);
    expect(mac).toMatchObject({cmd: "/bin/ps", args: ["-o", "lstart=", "-p", "4242"], env: {TZ: "UTC0", LC_ALL: "C"}});
    expect(G?.startTokenCommand?.("win32", 4242)?.cmd).toBe("powershell.exe");
    const w = G?.windowsKillArgs?.(4242, "638000000000000000");
    expect(w?.length).toBe(4);
    expect(w?.[3]).toMatch(/Get-Process -Id 4242/);
    expect(w?.[3]).toMatch(/Ticks -eq 638000000000000000/);
    expect(w?.[3]).toMatch(/taskkill\.exe \/pid 4242 \/T \/F/);
    expect(G?.windowsKillArgs?.(4242, "1; calc.exe")).toBeNull();
    expect(G?.windowsKillArgs?.(4242, null)).toBeNull();
    expect(G?.windowsKillArgs?.(1, "1")).toBeNull();
  });
});
});
