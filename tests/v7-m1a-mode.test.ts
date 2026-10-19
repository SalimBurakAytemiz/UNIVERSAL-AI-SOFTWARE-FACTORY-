// //TR: Bu test V7-PKG-M1A-MODE'u (Founder kararları D-SBX1-PATH-2026-10-15 + D-SBX1-PATH-CONDITIONS-2026-10-15) doğrular: doğrulanmış sandbox sağlayıcısı yokken VERIFY/REGRESSION hiçbir şey çalıştırmaz (işaret dosyası yok, test komutu için çocuk süreç yok), NOT_EXECUTED kanıtı yazılır ve run statik SECURITY -> bağımsız REVIEW (istem "testler çalıştırılmadı" der, TEST_SURFACE listesi verilir) -> REPORT -> AWAITING_APPROVAL ile sürer; COMPLETE kesin NOT_EXECUTED onayı ister (eksik/bayat/eşleşmeyen/fazladan onay 409 ve journal değişmez, BLOCKED asla), kabul aynı journal yazısında kaydedilir ve replay birebir türetir; export VERIFICATION_STATUS.json NOT_VERIFIED taşır; dev-run 409 kalır; test sağlayıcısı enjekte edilince eski yürütme yolu değişmez. Yalnız sahte executor'lar ve testin kendi sabit fikstürleri kullanılır (AI üretimi kod ana makinede asla çalışmaz).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {WorkOsStore} from "../core/workos/store.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import {FakeExecutors, reviewPrompt, TESTS_NOT_EXECUTED_STATEMENT} from "../core/workos/executors.js";
import type {MissionSpec} from "../core/workos/executors.js";
import {completionEvidence, deliveryView, deriveOutcomes, verificationStatus, M1A_LABELS, M1A_NOT_VERIFIED_LABEL} from "../core/workos/outcomes.js";
import type {WorkRun} from "../core/workos/types.js";
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
// M1a c2: yalnız TEST sağlayıcısıyla yürütülen, vitest biçiminde özet basan sabit fikstür (PRODUCT_VERIFIED yolunun testi için; M1a üretiminde sağlayıcı yoktur).
const COUNTING_TEST = ["import fs from \"node:fs\";", "const v = fs.existsSync(\"feature.txt\") ? fs.readFileSync(\"feature.txt\", \"utf8\").trim() : \"\";", "console.log(v === \"ok\" ? \" Tests  1 passed (1)\" : \" Tests  1 failed (1)\");", "process.exit(v === \"ok\" ? 0 : 1);", ""].join(String.fromCharCode(10));
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
    expect(report.testExecution).toEqual({testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE", functionalAcceptance: "NOT_EXECUTED", productVerification: "NOT_VERIFIED", productVerificationReason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: M1A_NOT_VERIFIED_LABEL});
    // outcomes: a distinct NOT_EXECUTED state, never UNKNOWN-as-pass or VERIFIED
    const o = deriveOutcomes(run);
    expect(o.functionalAcceptance).toBe("NOT_EXECUTED");
    expect(o.reasons.functionalAcceptance).toBe("SANDBOX_UNAVAILABLE");
    expect(o.completionMode).toBe("NOT_COMPLETED");
    // M1a c2: two separate axes; source generation complete never means the product is verified
    expect(o.sourceGeneration).toMatchObject({state: "SOURCE_GENERATION_COMPLETE", label: M1A_LABELS.SOURCE_GENERATION_COMPLETE});
    expect(o.productVerification).toMatchObject({state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: M1A_NOT_VERIFIED_LABEL});
  });

  it("the reviewer prompt has no not-executed statement when tests were executed (spec without testExecution)", () => {
    const spec = {runId: "r", missionId: "m", projectId: "p", title: "t", objective: "o", acceptanceCriteria: ["a"], riskLevel: "R1", cycle: 0, baseSha: "b"} as MissionSpec;
    expect(reviewPrompt(spec, "")).not.toContain("TESTS WERE NOT EXECUTED");
  });

  it("a deleted/weakened existing test stays BLOCKED (not NOT_EXECUTED): never completable, no source delivery, and COMPLETE accepts no acknowledgement", { timeout: T }, async () => {
    const {c, run} = await m1aRun({files: {"tests/a.test.mjs": "expect(1).toBe(1);\nexpect(2).toBe(2);\n"}, implement: {"tests/a.test.mjs": "expect(1).toBe(1);\n"}});
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(deriveOutcomes(run).functionalAcceptance).toBe("BLOCKED");
    expect(deliveryView(run)).toMatchObject({sourceGeneration: {state: "BLOCKED"}, productVerification: {state: "NOT_VERIFIED"}});
    const tsSha = deliveryView(run).testChanges.testSurfaceSha256 ?? "0".repeat(64);
    const app = noProviderApi(c), before = journalText(c);
    const plain = await complete(app, c, {});
    expect(plain.statusCode).toBe(409);
    expect(plain.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"});
    for (const body of [{notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha}}, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha}, acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tsSha}}])
      expect((await complete(app, c, body)).statusCode).toBe(400);
    const prep = await app.inject({method: "POST", url: `/v1/work-runs/${run.runId}/delivery/prepare`, headers: HDR, payload: {}});
    expect(prep.statusCode).toBe(409);
    expect(prep.json().error).toBe("SOURCE_GENERATION_NOT_COMPLETE");
    expect(() => c.store.acceptSourceDelivery({tenantId: "tA"}, run.runId, {runId: run.runId, missionId: run.missionId, sourceCommit: run.headSha, exportArtifactHash: "e".repeat(64), acknowledgeNotExecuted: true, testChangesAcknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tsSha}}, "FOUNDER_LOCAL")).toThrow(/SOURCE_GENERATION_NOT_COMPLETE/);
    expect(journalText(c)).toBe(before);
  });
});

// M1a c2: sentetik (biçimi geçerli) teslim artefaktı kaydı; artefakt dosyası ve API kabul yolu v7-m1a-c2-delivery testlerindedir.
const HASH = "e".repeat(64);
const artifactRecord = (run: WorkRun) => ({runId: run.runId, missionId: run.missionId, sourceCommit: run.headSha!, treeSha: "d".repeat(40), exportArtifactHash: HASH, artifactPath: `deliveries/${run.runId}/${HASH}.zip`});
const acceptanceFor = (run: WorkRun, extra: Record<string, unknown> = {}) => ({runId: run.runId, missionId: run.missionId, sourceCommit: run.headSha, exportArtifactHash: HASH, acknowledgeNotExecuted: true, ...extra});

describe("M1a c2 COMPLETE gate (D-M1A-STATE-MODEL-2026-10-15): PRODUCT_VERIFIED required, no acknowledgement ever completes", () => {
  it("an M1a run (tests never executed) is refused COMPLETE with or without any acknowledgement; malformed bodies 400; the journal is unchanged", { timeout: T }, async () => {
    const {c, run} = await m1aRun();
    const app = noProviderApi(c), before = journalText(c), head = run.headSha!;
    const view = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}`, headers: HDR})).json();
    expect(view.delivery).toMatchObject({sourceCommit: head, sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE"}, productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: M1A_NOT_VERIFIED_LABEL}, testsExecuted: false,
      testChanges: {required: false, testSurfaceSha256: expect.any(String), changed: {modified: [], deleted: [], renamed: [], harness: [], truncated: false}}});
    expect(view.completionRequirements).toBeUndefined();
    const plain = await complete(app, c, {});
    expect(plain.statusCode).toBe(409);
    expect(plain.json()).toEqual({error: "WORKOS_CONFLICT", reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    // the cycle-1 exact acknowledgement (and every other acknowledgement shape) is no longer accepted by COMPLETE
    const tsSha = view.delivery.testChanges.testSurfaceSha256;
    for (const body of [{notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head}}, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: "f".repeat(40)}},
      {notExecutedAcknowledgement: {acknowledgeNotExecuted: false, headSha: head}}, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head, extra: 1}}, {acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tsSha}},
      {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head}, acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tsSha}}]) {
      const r = await complete(app, c, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    const other = await app.inject({method: "POST", url: `/v1/missions/${c.missionId}/transition`, headers: HDR, payload: {to: "BLOCKED", reason: "x", notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: head}}});
    expect(other.statusCode).toBe(400);
    expect(journalText(c)).toBe(before);
    // store/pure level: the gate takes no acknowledgement; extra arguments cannot change the decision
    expect(() => c.store.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL")).toThrow(/COMPLETION_PRODUCT_NOT_VERIFIED/);
    expect((completionEvidence as unknown as (...a: unknown[]) => unknown)(runOf(c, run.runId), undefined, undefined, {acknowledgeNotExecuted: true, headSha: head})).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    expect(runOf(c, run.runId).status).toBe("AWAITING_APPROVAL");
    expect(missionOf(c).status).toBe("REPORTING");
    expect(journalText(c)).toBe(before);
  });

  it("the NOT_VERIFIED source delivery replaces the cycle-1 path: one exact bound acceptance, mission stays REPORTING, outcomes NOT_COMPLETED/NOT_VERIFIED, replay byte-identical, a forged cycle-1 COMPLETE entry is tamper", { timeout: T }, async () => {
    const {c, run} = await m1aRun();
    c.store.recordDeliveryArtifact({tenantId: "tA"}, run.runId, artifactRecord(run), "FOUNDER_LOCAL");
    const n = journalEntries(c).length;
    const ok = c.store.acceptSourceDelivery({tenantId: "tA"}, run.runId, acceptanceFor(run), "FOUNDER_LOCAL");
    expect(ok.mission.status).toBe("REPORTING");
    expect(ok.run.status).toBe("AWAITING_APPROVAL");
    const neIds = run.evidence.filter(e => e.kind.endsWith("_TESTS_NOT_EXECUTED")).map(e => e.evidenceId);
    expect(neIds).toHaveLength(2);
    expect(ok.run.sourceDelivery).toEqual({runId: run.runId, missionId: run.missionId, sourceCommit: run.headSha, exportArtifactHash: HASH,
      acknowledgements: {notExecuted: {acknowledgeNotExecuted: true, productVerification: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", notExecutedEvidenceIds: neIds}}, acceptedAt: expect.any(String)});
    expect(deriveOutcomes(ok.run)).toMatchObject({completionMode: "NOT_COMPLETED", functionalAcceptance: "NOT_EXECUTED", productVerification: {state: "NOT_VERIFIED"}, sourceDelivery: {state: "SOURCE_DELIVERY_ACCEPTED"}});
    expect(journalEntries(c).length).toBe(n + 1);
    // second use is refused; COMPLETE stays impossible
    expect(() => c.store.acceptSourceDelivery({tenantId: "tA"}, run.runId, acceptanceFor(run), "FOUNDER_LOCAL")).toThrow(/DELIVERY_ALREADY_ACCEPTED/);
    expect(() => c.store.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL")).toThrow(/COMPLETION_PRODUCT_NOT_VERIFIED/);
    expect(journalEntries(c).length).toBe(n + 1);
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    const fresh = new WorkOsStore(c.dataDir);
    expect(fresh.isTampered).toBe(false);
    expect(JSON.stringify(fresh.getRun({tenantId: "tA"}, run.runId)!.sourceDelivery)).toBe(JSON.stringify(ok.run.sourceDelivery));
    // forged: a cycle-1 style combined COMPLETE entry with the exact NOT_EXECUTED acknowledgement (valid chain) is tamper on replay
    const good = journalEntries(c);
    rewriteJournal(c, () => [...good, {type: "RUN_TRANSITION", actor: "x", at: new Date().toISOString(), payload: {runId: run.runId, leaseId: null, from: "AWAITING_APPROVAL", to: "SUCCEEDED", reason: "FOUNDER_ACCEPTED: x",
      mission: {missionId: c.missionId, from: "REPORTING", to: "COMPLETE", reason: "x"}, completion: {headSha: run.headSha, reportEvidenceId: "x", reviewEvidenceId: "x", securityEvidenceId: "x",
        notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha, functionalAcceptance: "NOT_EXECUTED", reason: "SANDBOX_UNAVAILABLE", notExecutedEvidenceIds: neIds}}}}]);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(true);
    rewriteJournal(c, () => good);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
  });

  it("changed existing tests: the source delivery needs BOTH acknowledgements (never one instead of the other); still never COMPLETE", { timeout: T }, async () => {
    const {c, run} = await m1aRun({files: {"tests/a.test.mjs": "expect(1).toBe(1);\n"}, implement: {"tests/a.test.mjs": "expect(1).toBe(1);\nexpect(2).toBe(2);\n"}});
    expect(run.status).toBe("AWAITING_APPROVAL");
    const v = deliveryView(run);
    expect(v.productVerification.state).toBe("NOT_VERIFIED");
    expect(v.testChanges).toMatchObject({required: true, changed: {modified: ["tests/a.test.mjs"]}});
    c.store.recordDeliveryArtifact({tenantId: "tA"}, run.runId, artifactRecord(run), "FOUNDER_LOCAL");
    const before = journalText(c), tc = {acknowledgeTestChanges: true, testSurfaceSha256: v.testChanges.testSurfaceSha256};
    expect(() => c.store.acceptSourceDelivery({tenantId: "tA"}, run.runId, acceptanceFor(run), "FOUNDER_LOCAL")).toThrow(/DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT/);
    const {acknowledgeNotExecuted: _n, ...withoutNe} = acceptanceFor(run, {testChangesAcknowledgement: tc});
    expect(() => c.store.acceptSourceDelivery({tenantId: "tA"}, run.runId, withoutNe, "FOUNDER_LOCAL")).toThrow(/DELIVERY_ACCEPTANCE_INVALID/);
    expect(journalText(c)).toBe(before);
    const ok = c.store.acceptSourceDelivery({tenantId: "tA"}, run.runId, acceptanceFor(run, {testChangesAcknowledgement: tc}), "FOUNDER_LOCAL");
    expect(ok.run.sourceDelivery?.acknowledgements.testChanges).toMatchObject({functionalAcceptance: "NOT_EXECUTED", changed: {modified: ["tests/a.test.mjs"]}});
    expect(deriveOutcomes(ok.run).completionMode).toBe("NOT_COMPLETED");
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    expect(deriveOutcomes(new WorkOsStore(c.dataDir).getRun({tenantId: "tA"}, run.runId)!).sourceDelivery.state).toBe("SOURCE_DELIVERY_ACCEPTED");
  });

  it("with a test-injected verified provider the execute path is unchanged (tests run via the provider, no NOT_EXECUTED); COMPLETE needs a positive executed count (PRODUCT_VERIFIED) and accepts no acknowledgement", { timeout: T }, async () => {
    const c = setup(tmp, "tA", {files: {"test.mjs": COUNTING_TEST, "README.txt": "base\n"}});
    const fake = new FakeExecutors(okScript());
    const created = startRun(c, fake);
    const run = await drive(c, runner(c, fake), created.runId); // runner() injects the test-only provider
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.reason).toBe("DELIVERY_DECISION_PENDING_FOUNDER");
    expect(kinds(run)).toEqual(expect.arrayContaining(["VERIFY_TESTS", "REGRESSION_TESTS"]));
    expect(run.evidence.filter(e => e.kind === "VERIFY_TESTS" || e.kind === "REGRESSION_TESTS").map(e => e.sandboxProviderId)).toEqual(["TEST_ONLY_HOST_PASSTHROUGH", "TEST_ONLY_HOST_PASSTHROUGH"]);
    expect(kinds(run).some(k => k.endsWith("_NOT_EXECUTED"))).toBe(false);
    expect(deriveOutcomes(run).functionalAcceptance).not.toBe("NOT_EXECUTED");
    expect(deriveOutcomes(run).productVerification.state).toBe("PRODUCT_VERIFIED");
    // the default project export is never a run delivery: NO_RUN/NOT_VERIFIED even for a verified run's commit
    expect(verificationStatus(run, run.headSha!)).toMatchObject({testsExecuted: true, notExecutedReason: null, runDelivery: "NO_RUN", productVerification: "NOT_VERIFIED", label: M1A_LABELS.NO_RUN_NOT_VERIFIED});
    const app = api(c); apps.push(app);
    const bad = await complete(app, c, {notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: run.headSha}});
    expect(bad.statusCode).toBe(400);
    const ok = await complete(app, c, {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().outcomes.completionMode).toBe("EVIDENCE_GUARD");
  });

  it("with the provider but an unparseable executed count the product stays NOT_VERIFIED and COMPLETE is refused", { timeout: T }, async () => {
    const c = setup(tmp);
    const fake = new FakeExecutors(okScript());
    const run = await drive(c, runner(c, fake), startRun(c, fake).runId);
    expect(kinds(run)).toEqual(expect.arrayContaining(["VERIFY_TESTS", "REGRESSION_TESTS"]));
    expect(deriveOutcomes(run).productVerification).toMatchObject({state: "NOT_VERIFIED", reason: "EXECUTED_TEST_COUNT_UNKNOWN"});
    expect(() => c.store.completeMission({tenantId: "tA"}, c.missionId, "accept", "FOUNDER_LOCAL")).toThrow(/COMPLETION_PRODUCT_NOT_VERIFIED/);
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
    expect(meta.verification).toEqual({label: M1A_LABELS.NO_RUN_NOT_VERIFIED, testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", runDelivery: "NO_RUN", productVerification: "NOT_VERIFIED"});
    const zip = fs.readFileSync(path.join(c.dataDir, "exports", `${meta.exportId}.zip`));
    const entries = listZipEntries(zip, undefined, {scanOnly: true});
    expect(entries.filter(e => !e.isDir).map(e => e.name)).toContain("VERIFICATION_STATUS.json");
    expect(entries.some(e => e.name === "reports/test-report.json")).toBe(false); // nothing executed -> no test report
    const vs = JSON.parse(readZipEntry(zip, entries.find(e => e.name === "VERIFICATION_STATUS.json")!).toString("utf8"));
    expect(vs).toEqual({schemaVersion: 2, kind: "PROJECT_EXPORT", runDelivery: "NO_RUN", producedByRunId: done.runId, missionId, headSha: done.headSha, productVerification: "NOT_VERIFIED", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE",
      reviewVerdict: "CLEAN", securitySummary: expect.objectContaining({status: expect.any(String), gaps: expect.any(Array), secrets: expect.any(Object), sca: expect.any(String)}), label: M1A_LABELS.NO_RUN_NOT_VERIFIED});
    expect(vs).toEqual(verificationStatus(done, done.headSha!));
    const readme = readZipEntry(zip, entries.find(e => e.name === "README.md")!).toString("utf8");
    expect(readme).toContain("| Tests | NOT_EXECUTED (SANDBOX_UNAVAILABLE) |");
    expect(readme).toContain(`| Verification | ${M1A_LABELS.NO_RUN_NOT_VERIFIED}`);
    expect(readme).toContain("| Run delivery | NO_RUN (project export, not a run delivery package) |");
    expect(verificationStatus(null, "a".repeat(40))).toEqual({schemaVersion: 2, kind: "PROJECT_EXPORT", runDelivery: "NO_RUN", producedByRunId: null, missionId: null, headSha: "a".repeat(40), productVerification: "NOT_VERIFIED", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "NO_RUN", reviewVerdict: null, securitySummary: null, label: M1A_LABELS.NO_RUN_NOT_VERIFIED});
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
    expect(meta.verification).toEqual({label: M1A_LABELS.NO_RUN_NOT_VERIFIED, testsExecuted: false, notExecutedReason: "NO_RUN", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", runDelivery: "NO_RUN", productVerification: "NOT_VERIFIED"});
    const zip = fs.readFileSync(path.join(c.dataDir, "exports", `${meta.exportId}.zip`));
    const entries = listZipEntries(zip, undefined, {scanOnly: true});
    const vsEntry = entries.find(e => e.name === "VERIFICATION_STATUS.json")!;
    expect(vsEntry).toBeTruthy();
    const vs = JSON.parse(readZipEntry(zip, vsEntry).toString("utf8"));
    expect(vs).toEqual({schemaVersion: 2, kind: "PROJECT_EXPORT", runDelivery: "NO_RUN", producedByRunId: null, missionId: null, headSha: meta.commit, productVerification: "NOT_VERIFIED", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "NO_RUN", reviewVerdict: null, securitySummary: null, label: M1A_LABELS.NO_RUN_NOT_VERIFIED});
    const readme = readZipEntry(zip, entries.find(e => e.name === "README.md")!).toString("utf8");
    expect(readme).toContain("| Tests | NOT_EXECUTED (NO_RUN) |");
    expect(readme).toContain(`| Verification | ${M1A_LABELS.NO_RUN_NOT_VERIFIED}`);
    // the default project export is never presented as a run delivery
    expect(readme).toContain("NOT a UASCO run delivery package");
    expect(readme).not.toMatch(/PRODUCT_VERIFIED —|[|] COMPLETE/);
  });
});
