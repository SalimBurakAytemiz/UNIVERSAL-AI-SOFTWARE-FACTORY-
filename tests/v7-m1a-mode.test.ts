// //TR: Bu test V7-PKG-M1A-MODE'u (Founder kararları D-SBX1-PATH-2026-10-15 + D-SBX1-PATH-CONDITIONS-2026-10-15) doğrular: doğrulanmış sandbox sağlayıcısı yokken VERIFY/REGRESSION hiçbir şey çalıştırmaz (işaret dosyası yok, test komutu için çocuk süreç yok), NOT_EXECUTED kanıtı yazılır ve run statik SECURITY -> bağımsız REVIEW (istem "testler çalıştırılmadı" der, TEST_SURFACE listesi verilir) -> REPORT -> AWAITING_APPROVAL ile sürer; COMPLETE kesin NOT_EXECUTED onayı ister (eksik/bayat/eşleşmeyen/fazladan onay 409 ve journal değişmez, BLOCKED asla), kabul aynı journal yazısında kaydedilir ve replay birebir türetir; export VERIFICATION_STATUS.json NOT_VERIFIED taşır; dev-run 409 kalır; test sağlayıcısı enjekte edilince eski yürütme yolu değişmez. Yalnız sahte executor'lar ve testin kendi sabit fikstürleri kullanılır (AI üretimi kod ana makinede asla çalışmaz).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {WorkOsStore} from "../core/workos/store.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import {FakeExecutors, reviewPrompt, TESTS_NOT_EXECUTED_STATEMENT} from "../core/workos/executors.js";
import type {MissionSpec} from "../core/workos/executors.js";
import {completionEvidence, completionRequirements, deriveOutcomes, verificationStatus, M1A_NOT_VERIFIED_LABEL} from "../core/workos/outcomes.js";
import {listZipEntries, readZipEntry} from "../core/workos/zip.js";
import {T, setup, okScript, runner, startRun, runOf, missionOf, drive, journalEntries, journalText, rewriteJournal, api, HDR, kinds, tmpRoot, rmTmp} from "./support/relfx.js";
import type {Ctx} from "./support/relfx.js";

let tmp = "";
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = tmpRoot("uasco-m1a-"); });
afterEach(async () => { vi.restoreAllMocks(); for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(tmp); });

// Test komutu çalışırsa işaret dosyası bırakır: YOKLUĞU komutun hiç çalışmadığının kanıtıdır (testin kendi sabit fikstürü).
const markerTest = (marker: string) => `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "EXECUTED");\nprocess.exit(0);\n`;
const noSandbox = () => new ExecutionGate(null);
const noProviderApi = (c: Ctx) => { const a = api(c, {sandbox: undefined}); apps.push(a); return a; };
const complete = (app: ReturnType<typeof api>, c: Ctx, body: Record<string, unknown>) => app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "Founder accepts (M1a)", ...body}});

async function m1aRun(o: {files?: Record<string, string>; implement?: Record<string, string>; specs?: MissionSpec[]} = {}) {
  const marker = path.join(tmp, `executed-${Math.random().toString(16).slice(2)}.flag`);
  const c = setup(tmp, "tA", {files: {"test.mjs": markerTest(marker), "README.txt": "base\n", ...(o.files ?? {})}});
  const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n", ...(o.implement ?? {})}}), review: (_n, spec) => { o.specs?.push(spec); return {verdict: "CLEAN"}; }}));
  const created = startRun(c, fake);
  const run = await drive(c, runner(c, fake, {executionGate: noSandbox()}), created.runId);
  return {c, run, marker};
}

describe("M1a runner progression without a verified sandbox", () => {
  it("never executes the test command (no marker, no child process for it), records NOT_EXECUTED and continues SECURITY -> REVIEW -> REPORT -> AWAITING_APPROVAL with no budget used", { timeout: T }, async () => {
    const spawn = vi.spyOn(cp, "spawn"), spawnSync = vi.spyOn(cp, "spawnSync"), execFile = vi.spyOn(cp, "execFile"), fork = vi.spyOn(cp, "fork");
    const specs: MissionSpec[] = [];
    const {c, run, marker} = await m1aRun({specs});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toBe("DELIVERY_DECISION_PENDING_FOUNDER; TESTS_NOT_EXECUTED_SANDBOX_UNAVAILABLE");
    expect(missionOf(c).status).toBe("REPORTING");
    expect(run.retryCount).toBe(0);
    expect(run.remediationCycle).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    const argvOf = (call: unknown[]) => JSON.stringify(call.slice(0, 2));
    for (const s of [spawn, spawnSync, execFile, fork]) for (const call of s.mock.calls) expect(argvOf(call as unknown[])).not.toContain("test.mjs");
    const k = kinds(run);
    expect(k).toEqual(expect.arrayContaining(["VERIFY_TESTS_NOT_EXECUTED", "TEST_SURFACE", "SECURITY_REPORT", "REVIEW", "REGRESSION_TESTS_NOT_EXECUTED", "REPORT"]));
    expect(k).not.toContain("VERIFY_TESTS");
    expect(k).not.toContain("REGRESSION_TESTS");
    expect(k.indexOf("VERIFY_TESTS_NOT_EXECUTED")).toBeLessThan(k.indexOf("SECURITY_REPORT"));
    expect(k.indexOf("SECURITY_REPORT")).toBeLessThan(k.indexOf("REVIEW"));
    expect(k.indexOf("REVIEW")).toBeLessThan(k.indexOf("REGRESSION_TESTS_NOT_EXECUTED"));
    for (const kind of ["VERIFY_TESTS_NOT_EXECUTED", "REGRESSION_TESTS_NOT_EXECUTED"]) {
      const ne = run.evidence.find(e => e.kind === kind)!;
      expect(ne.exitCode).toBeNull();
      expect(ne.commitSha).toBe(run.headSha);
      expect(ne.note).toMatch(/^NOT_EXECUTED: SANDBOX_UNAVAILABLE \(NO_VERIFIED_PROVIDER\)/);
    }
    // static TEST_SURFACE kept: executedTests null (never fabricated), functionalAcceptance NOT_EXECUTED
    const ts = run.evidence.find(e => e.kind === "TEST_SURFACE")!.testSurface!;
    expect(ts).toMatchObject({executedTests: null, testRun: null, functionalAcceptance: "NOT_EXECUTED", reason: "SANDBOX_UNAVAILABLE"});
    // independent reviewer is told explicitly and still receives the TEST_SURFACE list
    expect(specs).toHaveLength(1);
    expect(specs[0].testExecution).toEqual({executed: false, reason: "SANDBOX_UNAVAILABLE"});
    expect(specs[0].testSurface).toMatchObject({functionalAcceptance: "NOT_EXECUTED", added: [], modified: []});
    const prompt = reviewPrompt(specs[0], "diff --git a/feature.txt b/feature.txt\n");
    expect(prompt).toContain(TESTS_NOT_EXECUTED_STATEMENT);
    expect(prompt).toMatch(/TESTS WERE NOT EXECUTED: no verified sandbox exists/);
    expect(prompt).toContain("Test surface touched by the implementer (functionalAcceptance=NOT_EXECUTED");
    // report.json carries the honest label
    const report = JSON.parse(fs.readFileSync(path.join(c.dataDir, run.evidence.find(e => e.kind === "REPORT")!.logPath!), "utf8"));
    expect(report.testExecution).toEqual({testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE", functionalAcceptance: "NOT_EXECUTED", label: M1A_NOT_VERIFIED_LABEL});
    // outcomes: a distinct NOT_EXECUTED state, never UNKNOWN-as-pass or VERIFIED
    const o = deriveOutcomes(run);
    expect(o.functionalAcceptance).toBe("NOT_EXECUTED");
    expect(o.reasons.functionalAcceptance).toBe("SANDBOX_UNAVAILABLE");
    expect(o.completionMode).toBe("NOT_COMPLETED");
  });

  it("the reviewer prompt has no not-executed statement when tests were executed (spec without testExecution)", () => {
    const spec = {runId: "r", missionId: "m", projectId: "p", title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", cycle: 0, baseSha: "b"} as MissionSpec;
    expect(reviewPrompt(spec, "")).not.toContain("TESTS WERE NOT EXECUTED");
  });

  it("a deleted/weakened existing test stays BLOCKED (not NOT_EXECUTED) and is never completable, even with both acknowledgements", { timeout: T }, async () => {
    const {c, run} = await m1aRun({files: {"tests/a.test.mjs": "expect(1).toBe(1);\nexpect(2).toBe(2);\n"}, implement: {"tests/a.test.mjs": "expect(1).toBe(1);\n"}});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(deriveOutcomes(run).functionalAcceptance).toBe("BLOCKED");
    const req = completionRequirements(run);
    expect(req.notExecuted.required).toBe(false);
    const app = noProviderApi(c), before = journalText(c);
    for (const body of [{}, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha}}, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha}, acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: req.testChanges.testSurfaceSha256 ?? "0".repeat(64)}}]) {
      const r = await complete(app, c, body);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"});
    }
    expect(journalText(c)).toBe(before);
  });
});

describe("M1a COMPLETE gate (FX-1 extension, fail-closed)", () => {
  it("refuses missing, stale, mismatched and malformed NOT_EXECUTED acknowledgements with the journal unchanged", { timeout: T }, async () => {
    const {c, run} = await m1aRun();
    const app = noProviderApi(c), before = journalText(c), head = run.headSha!;
    const view = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: HDR})).json();
    expect(view.completionRequirements).toEqual({headSha: head, functionalAcceptance: "NOT_EXECUTED", notExecuted: {required: true, reason: "SANDBOX_UNAVAILABLE"}, testChanges: {required: false, testSurfaceSha256: expect.any(String), changed: {modified: [], deleted: [], renamed: [], harness: [], truncated: false}}});
    const refused = async (body: Record<string, unknown>, code = 409) => {
      const r = await complete(app, c, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(code);
      if (code === 409) expect(r.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"});
      expect(journalText(c)).toBe(before);
    };
    await refused({});
    await refused({notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: "f".repeat(40)}}); // stale / other commit
    await refused({notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.baseSha}}); // base, not head
    await refused({notExecutedAcknowledgement: {acknowledgeNotExecuted: false, headSha: head}}, 400); // schema: const true
    await refused({notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head, extra: 1}}, 400);
    await refused({notExecutedAcknowledgement: {acknowledgeNotExecuted: true}}, 400);
    // the test-change acknowledgement can never stand in for it
    const tsSha = view.completionRequirements.testChanges.testSurfaceSha256;
    await refused({acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tsSha}});
    // only with to=COMPLETE
    const other = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "BLOCKED", reason: "x", notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head}}});
    expect(other.statusCode).toBe(400);
    expect(journalText(c)).toBe(before);
    // store-level: non-exact objects are refused the same way (no schema in front)
    for (const bad of [{acknowledgeNotExecuted: true, headSha: head, extra: 1}, {acknowledgeNotExecuted: "true", headSha: head}, [true, head], null, head])
      expect(completionEvidence(runOf(c, run.runId), undefined, undefined, bad)).toEqual({ok: false, reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"});
    expect(runOf(c, run.runId).status).toBe("AWAITING_APPROVAL");
  });

  it("accepts the exact acknowledgement in the same journal write as SUCCEEDED; outcomes NOT_EXECUTED_ACKNOWLEDGED; replay re-derives byte-identically; a stripped acknowledgement is tamper", { timeout: T }, async () => {
    const {c, run} = await m1aRun();
    const app = noProviderApi(c), n = journalEntries(c).length, head = run.headSha!;
    const res = await complete(app, c, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head}});
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.mission.status).toBe("COMPLETE");
    expect(body.run.status).toBe("SUCCEEDED");
    expect(body.outcomes).toMatchObject({completionMode: "NOT_EXECUTED_ACKNOWLEDGED", functionalAcceptance: "NOT_EXECUTED"});
    const neIds = run.evidence.filter(e => e.kind.endsWith("_TESTS_NOT_EXECUTED")).map(e => e.evidenceId);
    expect(neIds).toHaveLength(2);
    expect(body.run.completion.notExecutedAcknowledgement).toEqual({acknowledgeNotExecuted: true, headSha: head, functionalAcceptance: "NOT_EXECUTED", reason: "SANDBOX_UNAVAILABLE", notExecutedEvidenceIds: neIds});
    expect(body.run.completion.testChangesAcknowledgement).toBeUndefined();
    const entries = journalEntries(c);
    expect(entries.length).toBe(n + 1);
    const last = entries[entries.length - 1];
    expect(last.payload).toMatchObject({runId: run.runId, from: "AWAITING_APPROVAL", to: "SUCCEEDED", mission: {to: "COMPLETE"}});
    expect(last.payload.completion).toEqual(body.run.completion);
    // replay from the journal alone
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    const fresh = new WorkOsStore(c.dataDir);
    expect(fresh.isTampered).toBe(false);
    const replayed = fresh.getRun({tenantId: "tA"}, run.runId)!;
    expect(JSON.stringify(replayed.completion)).toBe(JSON.stringify(body.run.completion));
    expect(deriveOutcomes(replayed).completionMode).toBe("NOT_EXECUTED_ACKNOWLEDGED");
    await app.close();
    // forged: the combined entry without the acknowledgement (valid chain) is tamper on replay
    rewriteJournal(c, es => es.map((e, i) => i === es.length - 1 ? {...e, payload: {...e.payload, completion: {...e.payload.completion, notExecutedAcknowledgement: undefined}}} : e));
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(true);
    // forged: an acknowledgement for another commit is tamper too
    rewriteJournal(c, es => es.map((e, i) => i === es.length - 1 ? {...e, payload: {...e.payload, completion: {...body.run.completion, notExecutedAcknowledgement: {...body.run.completion.notExecutedAcknowledgement, headSha: "f".repeat(40)}}}} : e));
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(true);
  });

  it("changed existing tests need BOTH acknowledgements (never one instead of the other); completionMode NOT_EXECUTED_ACKNOWLEDGED_WITH_TEST_CHANGES", { timeout: T }, async () => {
    const {c, run} = await m1aRun({files: {"tests/a.test.mjs": "expect(1).toBe(1);\n"}, implement: {"tests/a.test.mjs": "expect(1).toBe(1);\nexpect(2).toBe(2);\n"}});
    expect(run.status).toBe("AWAITING_APPROVAL");
    const req = completionRequirements(run);
    expect(req.notExecuted.required).toBe(true);
    expect(req.testChanges).toMatchObject({required: true, changed: {modified: ["tests/a.test.mjs"]}});
    const app = noProviderApi(c), before = journalText(c);
    const ne = {acknowledgeNotExecuted: true, headSha: run.headSha}, tc = {acknowledgeTestChanges: true, testSurfaceSha256: req.testChanges.testSurfaceSha256};
    const r1 = await complete(app, c, {notExecutedAcknowledgement: ne});
    expect(r1.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"});
    const r2 = await complete(app, c, {acknowledgement: tc});
    expect(r2.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"});
    expect(journalText(c)).toBe(before);
    const ok = await complete(app, c, {notExecutedAcknowledgement: ne, acknowledgement: tc});
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().outcomes.completionMode).toBe("NOT_EXECUTED_ACKNOWLEDGED_WITH_TEST_CHANGES");
    expect(ok.json().run.completion.testChangesAcknowledgement).toMatchObject({functionalAcceptance: "NOT_EXECUTED", changed: {modified: ["tests/a.test.mjs"]}});
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    expect(deriveOutcomes(new WorkOsStore(c.dataDir).getRun({tenantId: "tA"}, run.runId)!).completionMode).toBe("NOT_EXECUTED_ACKNOWLEDGED_WITH_TEST_CHANGES");
  });

  it("with a test-injected verified provider the old execute path is unchanged: tests run via the provider, no NOT_EXECUTED, the acknowledgement is refused and plain COMPLETE works", { timeout: T }, async () => {
    const c = setup(tmp);
    const fake = new FakeExecutors(okScript());
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake), created.runId); // runner() injects the test-only provider
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toBe("DELIVERY_DECISION_PENDING_FOUNDER");
    expect(kinds(run)).toEqual(expect.arrayContaining(["VERIFY_TESTS", "REGRESSION_TESTS"]));
    expect(kinds(run).some(k => k.endsWith("_NOT_EXECUTED"))).toBe(false);
    expect(deriveOutcomes(run).functionalAcceptance).not.toBe("NOT_EXECUTED");
    expect(verificationStatus(run, run.headSha!)).toMatchObject({testsExecuted: true, notExecutedReason: null, label: "NOT_VERIFIED"});
    const app = api(c); apps.push(app);
    const bad = await complete(app, c, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha}});
    expect(bad.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"});
    const ok = await complete(app, c, {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().outcomes.completionMode).toBe("EVIDENCE_GUARD");
  });
});

describe("M1a export and live preview", () => {
  it("export ZIP of an M1a run commit (Studio project, no sandbox) has VERIFICATION_STATUS.json at its root derived from evidence (NOT_VERIFIED, testsExecuted false)", { timeout: T }, async () => {
    const c = setup(tmp);
    const app = noProviderApi(c);
    const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "M1a App", environmentId: "dev", template: "web-node", idempotencyKey: "m1a-ex"}});
    expect(created.statusCode).toBe(201);
    const pid = created.json().project.projectId;
    const mc = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: pid, title: "Add feature", objective: "feature.txt says ok", acceptanceCriteria: ["reviewed"], riskLevel: "R1"}});
    const missionId = mc.json().mission.missionId;
    for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await app.inject({method: "POST", url: `/v1/missions/${missionId}/transition`, headers: HDR, payload: {to, reason: "go"}})).statusCode).toBe(200);
    const fake = new FakeExecutors(okScript()), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
    const r0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    await runner({...c, store, missionId}, fake, {executionGate: noSandbox()}).tick();
    const done = store.getRun({tenantId: "tA"}, r0.runId)!;
    expect(done.status, done.reason ?? "").toBe("AWAITING_APPROVAL");
    expect(kinds(done)).toContain("VERIFY_TESTS_NOT_EXECUTED");
    const ex = await app.inject({method: "POST", url: `/v1/projects/${pid}/export`, headers: HDR, payload: {commit: done.headSha}});
    expect(ex.statusCode, ex.body).toBe(201);
    const meta = ex.json().export;
    expect(meta.runId).toBe(done.runId);
    expect(meta.verification).toEqual({label: M1A_NOT_VERIFIED_LABEL, testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED"});
    const zip = fs.readFileSync(path.join(c.dataDir, "exports", `${meta.exportId}.zip`));
    const entries = listZipEntries(zip, undefined, {scanOnly: true});
    expect(entries.filter(e => !e.isDir).map(e => e.name)).toContain("VERIFICATION_STATUS.json");
    expect(entries.some(e => e.name === "reports/test-report.json")).toBe(false); // nothing executed -> no test report
    const vs = JSON.parse(readZipEntry(zip, entries.find(e => e.name === "VERIFICATION_STATUS.json")!).toString("utf8"));
    expect(vs).toEqual({schemaVersion: 1, runId: done.runId, missionId, headSha: done.headSha, functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE",
      reviewVerdict: "CLEAN", securitySummary: expect.objectContaining({status: expect.any(String), gaps: expect.any(Array), secrets: expect.any(Object), sca: expect.any(String)}), label: "NOT_VERIFIED (M1a: tests not executed)"});
    expect(vs).toEqual(verificationStatus(done, done.headSha!));
    const readme = readZipEntry(zip, entries.find(e => e.name === "README.md")!).toString("utf8");
    expect(readme).toContain("| Tests | NOT_EXECUTED (SANDBOX_UNAVAILABLE) |");
    expect(readme).toContain("| Verification | NOT_VERIFIED (M1a: tests not executed)");
    expect(verificationStatus(null, "a".repeat(40))).toEqual({schemaVersion: 1, runId: null, missionId: null, headSha: "a".repeat(40), functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "NO_RUN", reviewVerdict: null, securitySummary: null, label: "NOT_VERIFIED"});
  });

  it("Studio template project: export ZIP contains VERIFICATION_STATUS.json (NO_RUN, NOT_VERIFIED) and dev-run start stays 409 SANDBOX_UNAVAILABLE", { timeout: T }, async () => {
    const c = setup(tmp);
    const app = noProviderApi(c);
    const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "M1a Shop", environmentId: "dev", template: "web-node", idempotencyKey: "m1a-1"}});
    expect(created.statusCode).toBe(201);
    const pid = created.json().project.projectId;
    const dev = await app.inject({method: "POST", url: `/v1/projects/${pid}/devrun/start`, headers: HDR, payload: {}});
    expect(dev.statusCode).toBe(409);
    expect(dev.json()).toEqual({error: "SANDBOX_UNAVAILABLE", reason: "NO_VERIFIED_PROVIDER"});
    const ex = await app.inject({method: "POST", url: `/v1/projects/${pid}/export`, headers: HDR, payload: {}});
    expect(ex.statusCode, ex.body).toBe(201);
    const meta = ex.json().export;
    expect(meta.contents.verificationStatus).toBe(true);
    expect(meta.verification).toEqual({label: "NOT_VERIFIED", testsExecuted: false, notExecutedReason: "NO_RUN", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED"});
    const zip = fs.readFileSync(path.join(c.dataDir, "exports", `${meta.exportId}.zip`));
    const entries = listZipEntries(zip, undefined, {scanOnly: true});
    const vsEntry = entries.find(e => e.name === "VERIFICATION_STATUS.json")!;
    expect(vsEntry).toBeTruthy();
    const vs = JSON.parse(readZipEntry(zip, vsEntry).toString("utf8"));
    expect(vs).toEqual({schemaVersion: 1, runId: null, missionId: null, headSha: meta.commit, functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "NO_RUN", reviewVerdict: null, securitySummary: null, label: "NOT_VERIFIED"});
    const readme = readZipEntry(zip, entries.find(e => e.name === "README.md")!).toString("utf8");
    expect(readme).toContain("| Tests | NOT_EXECUTED (NO_RUN) |");
    expect(readme).toContain("| Verification | NOT_VERIFIED");
  });
});
