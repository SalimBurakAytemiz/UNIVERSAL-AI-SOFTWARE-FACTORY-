// //TR: Bu test V7-PKG-M1A-MODE cycle 2'yi (D-M1A-STATE-MODEL-2026-10-15 + D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15, RV-M1A-C1-F1) uçtan uca doğrular: iki bağımsız eksen (sourceGeneration / productVerification) yalnız kanıttan türetilir, PRODUCT_VERIFIED yalnız sandbox tanıklı yürütülmüş testlerle olur ve hiçbir onay onu üretemez; SOURCE_GENERATION_COMPLETE koşunun run.headSha ağacından deterministik teslim artefaktı (aynı run = aynı hash, sıralı/zaman damgasız/makine yolsuz, kabul içinde değil) hazırlanır, şablon-yalnız koşu NO_GENERATED_SOURCE ile reddedilir; NOT_VERIFIED kaynak teslimi kabulü runId + missionId + sourceCommit + exportArtifactHash'e bağlı ve tek kullanımlıktır (her alan uyuşmazlığı, başka run, başka/bayat artefakt, ikinci kullanım 409 ve journal değişmez), replay yeniden türetip birebir karşılaştırır, mission PRODUCT_VERIFIED olmadan asla COMPLETE olmaz; dışa aktarma ve kabul öncesi hash yeniden doğrulanır. Proje kodu hiç çalıştırılmaz (yalnız sahte executor + git).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {ProjectStudio} from "../core/workos/project-studio.js";
import {completionEvidence, deliveryView, deriveOutcomes, productVerificationOf, sourceDeliveryAcceptanceCheck, sourceGenerationOf, M1A_LABELS} from "../core/workos/outcomes.js";
import type {RunEvidence, WorkRun} from "../core/workos/types.js";
import {listZipEntries, readZipEntry} from "../core/workos/zip.js";
import {T, setup, okScript, runner, drive, api, HDR, git, journalEntries, rewriteJournal, tmpRoot, rmTmp, ENV_POLICY} from "./support/relfx.js";
import type {Ctx} from "./support/relfx.js";

let tmp = "";
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = tmpRoot("uasco-m1a-c2-"); });
afterEach(async () => { vi.restoreAllMocks(); for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(tmp); });

const SG = M1A_LABELS.SOURCE_GENERATION_COMPLETE, NV = M1A_LABELS.NOT_VERIFIED_SANDBOX, ACC = M1A_LABELS.SOURCE_DELIVERY_ACCEPTED;
const noProviderApi = (c: Ctx) => { const a = api(c, {sandbox: undefined}); apps.push(a); return a; };
type App = ReturnType<typeof api>;

// Studio şablon projesi + mission + sahte executor ile sandbox'sız (M1a) koşu: AWAITING_APPROVAL / REPORTING'de durur.
async function studioProject(c: Ctx, app: App, key: string): Promise<string> {
  const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "M1a c2 App", environmentId: "dev", template: "web-node", idempotencyKey: key}});
  expect(created.statusCode, created.body).toBe(201);
  return created.json().project.projectId;
}
async function m1aRun(c: Ctx, app: App, pid: string, files: Record<string, string> = {"feature.txt": "ok\n"}) {
  const mc = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: pid, title: "Add feature", objective: "feature.txt says ok", acceptanceCriteria: ["reviewed"], riskLevel: "R1"}});
  const missionId = mc.json().mission.missionId as string;
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await app.inject({method: "POST", url: `/v1/missions/${missionId}/transition`, headers: HDR, payload: {to, reason: "go"}})).statusCode).toBe(200);
  const fake = new FakeExecutors(okScript({implement: () => ({files})})), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
  const r0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  await runner({...c, store, missionId}, fake, {executionGate: new ExecutionGate(null)}).tick();
  const run = store.getRun({tenantId: "tA"}, r0.runId)!;
  expect(run.status, run.reason ?? "").toBe("AWAITING_APPROVAL");
  return {missionId, run, store};
}
const prepare = (app: App, runId: string) => app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/prepare`, headers: HDR, payload: {}});
const accept = (app: App, runId: string, acceptance: unknown) => app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/accept`, headers: HDR, payload: {acceptance}});
const exportDelivery = (app: App, runId: string) => app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/export`, headers: HDR, payload: {}});
const acceptanceOf = (art: {runId: string; missionId: string; sourceCommit: string; exportArtifactHash: string}) => ({runId: art.runId, missionId: art.missionId, sourceCommit: art.sourceCommit, exportArtifactHash: art.exportArtifactHash, acknowledgeNotExecuted: true});

describe("M1a c2 state model: two independent evidence-derived axes (pure)", () => {
  const H = "a".repeat(40), B = "b".repeat(40);
  const ev = (kind: string, extra: Partial<RunEvidence> = {}): RunEvidence => ({evidenceId: `evd_${kind.toLowerCase()}`, step: "REPORT", cycle: 0, kind, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, commitSha: H, ...extra});
  const surface = (over: Record<string, unknown> = {}) => ev("TEST_SURFACE", {logSha256: "c".repeat(64), testSurface: {schemaVersion: 1, baseSha: B, headSha: H, testGlobs: [], harnessGlobs: [], added: [], modified: [], deleted: [], renamed: [], weakened: [], trivialAdded: [], harness: [], executedTests: 3, testRun: null, oracle: "NONE", functionalAcceptance: "UNVERIFIED_ORACLE", reason: "NO_INDEPENDENT_ORACLE", truncated: false, ...over} as never});
  const source = [ev("IMPLEMENT"), ev("SECURITY_REPORT", {security: {status: "PARTIAL", blockReason: null, gaps: [], secrets: {builtin: {status: "CLEAN"}, gitleaks: {status: "NOT_INSTALLED"}}, sca: {status: "NOT_INSTALLED"}} as never}), ev("REVIEW", {verdict: "CLEAN"}), ev("REPORT", {verdict: "CLEAN"})];
  const sandboxTests = (id: string | null = "SBX_PROVIDER", exit = 0) => [ev("VERIFY_TESTS", {exitCode: exit, ...(id ? {sandboxProviderId: id} : {})}), ev("REGRESSION_TESTS", {exitCode: exit, ...(id ? {sandboxProviderId: id} : {})})];
  const run = (evidence: RunEvidence[], over: Partial<WorkRun> = {}): WorkRun => ({runId: "run_" + "1".repeat(24), missionId: "msn_" + "2".repeat(24), projectId: "prj_" + "3".repeat(24), tenantId: "tA", roleId: null, executor: {implementer: "I", reviewer: "R"},
    leaseId: null, leaseExpiresAt: null, attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 0, retryCount: 0, retryAt: null, reason: null, baseSha: B, headSha: H, workBranch: "b", checkpoints: [], evidence, createdAt: "", createdBy: "x", updatedAt: "", ...over});

  it("SOURCE_GENERATION_COMPLETE needs a builder commit != base + non-BLOCKED security + CLEAN review + CLEAN report at head; it never implies PRODUCT_VERIFIED", () => {
    const m1a = run([...source, ev("VERIFY_TESTS_NOT_EXECUTED", {exitCode: null}), surface({executedTests: null, functionalAcceptance: "NOT_EXECUTED"}), ev("REGRESSION_TESTS_NOT_EXECUTED", {exitCode: null})]);
    expect(sourceGenerationOf(m1a)).toMatchObject({state: "SOURCE_GENERATION_COMPLETE", label: SG});
    expect(productVerificationOf(H, m1a.evidence)).toMatchObject({state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: NV, refs: null});
    expect(completionEvidence(m1a)).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    expect(sourceGenerationOf(run(source, {headSha: B}))).toMatchObject({state: "BLOCKED", reason: "NO_GENERATED_SOURCE"});
    expect(sourceGenerationOf(run(source.filter(e => e.kind !== "IMPLEMENT")))).toMatchObject({state: "BLOCKED", reason: "BUILDER_COMMIT_EVIDENCE_MISSING"});
    expect(sourceGenerationOf(run(source.filter(e => e.kind !== "REVIEW")))).toMatchObject({state: "BLOCKED", reason: "REVIEW_EVIDENCE_MISSING"});
    expect(sourceGenerationOf(run(source.filter(e => e.kind !== "REPORT")))).toMatchObject({state: "BLOCKED", reason: "REPORT_EVIDENCE_MISSING"});
    expect(sourceGenerationOf(run([...source, surface({functionalAcceptance: "BLOCKED", reason: "EXISTING_TEST_DELETED"})])).state).toBe("BLOCKED");
    expect(sourceGenerationOf(run([], {status: "QUEUED", headSha: null})).state).toBe("NOT_STARTED");
    expect(sourceGenerationOf(run([ev("IMPLEMENT")], {status: "RUNNING"})).state).toBe("IN_PROGRESS");
    expect(sourceGenerationOf(run([ev("IMPLEMENT")], {status: "BLOCKED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"}))).toMatchObject({state: "BLOCKED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED"});
    expect(sourceGenerationOf(run([ev("IMPLEMENT")], {status: "FAILED"})).state).toBe("FAILED");
  });

  it("PRODUCT_VERIFIED only from sandbox-attested executed tests (count > 0, exit 0, no test changes); otherwise NOT_VERIFIED/FAILED with a reason", () => {
    const ok = run([...source, ...sandboxTests(), surface()]);
    expect(productVerificationOf(H, ok.evidence)).toMatchObject({state: "PRODUCT_VERIFIED", reason: "TESTS_EXECUTED_IN_VERIFIED_SANDBOX"});
    expect(completionEvidence(ok)).toMatchObject({ok: true, refs: {headSha: H, productVerification: {state: "PRODUCT_VERIFIED", verifyEvidenceId: "evd_verify_tests", regressionEvidenceId: "evd_regression_tests", testSurfaceEvidenceId: "evd_test_surface"}}});
    expect(productVerificationOf(H, [...source, ...sandboxTests(null), surface()]).reason).toBe("SANDBOX_ATTESTATION_MISSING");
    expect(productVerificationOf(H, [...source, ...sandboxTests(), surface({executedTests: 0})]).reason).toBe("ZERO_TESTS_EXECUTED");
    expect(productVerificationOf(H, [...source, ...sandboxTests(), surface({executedTests: null})]).reason).toBe("EXECUTED_TEST_COUNT_UNKNOWN");
    expect(productVerificationOf(H, [...source, ...sandboxTests(), surface({modified: ["tests/a.test.ts"]})]).reason).toBe("TEST_CHANGES_REQUIRE_INDEPENDENT_VERIFICATION");
    expect(productVerificationOf(H, [...source, ...sandboxTests("SBX", 1), surface()]).state).toBe("FAILED");
    expect(productVerificationOf(H, [...source, surface()]).reason).toBe("NOT_EXECUTED:TESTS_NOT_REACHED");
    expect(productVerificationOf(H, [...source, ...sandboxTests(), surface({functionalAcceptance: "BLOCKED", reason: "EXISTING_TEST_DELETED"})]).state).toBe("NOT_VERIFIED");
    // the gate takes no acknowledgement input at all: extra arguments are ignored and cannot change the result
    const m1a = run([...source, ev("VERIFY_TESTS_NOT_EXECUTED", {exitCode: null})]);
    expect((completionEvidence as unknown as (...a: unknown[]) => unknown)(m1a, m1a.evidence, {acknowledgeTestChanges: true}, {acknowledgeNotExecuted: true, headSha: H})).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
  });

  it("acceptance gate: exact object, bound to the current artifact record; refuses PRODUCT_VERIFIED runs; never changes productVerification", () => {
    const art = {runId: "run_" + "1".repeat(24), missionId: "msn_" + "2".repeat(24), sourceCommit: H, treeSha: "d".repeat(40), exportArtifactHash: "e".repeat(64), artifactPath: `deliveries/run_${"1".repeat(24)}/${"e".repeat(64)}.zip`};
    const m1a = run([...source, ev("VERIFY_TESTS_NOT_EXECUTED", {exitCode: null})], {deliveryArtifact: art});
    const ctx = {run: m1a, missionStatus: "REPORTING", latestRunId: m1a.runId};
    const good = acceptanceOf(art);
    const okc = sourceDeliveryAcceptanceCheck(ctx, good);
    expect(okc).toMatchObject({ok: true, record: {runId: art.runId, missionId: art.missionId, sourceCommit: H, exportArtifactHash: art.exportArtifactHash, acknowledgements: {notExecuted: {acknowledgeNotExecuted: true, productVerification: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE"}}}});
    for (const k of ["runId", "missionId", "sourceCommit", "exportArtifactHash"] as const) {
      const bad = {...good, [k]: k === "exportArtifactHash" ? "f".repeat(64) : k === "sourceCommit" ? "f".repeat(40) : k === "runId" ? "run_" + "9".repeat(24) : "msn_" + "9".repeat(24)};
      expect(sourceDeliveryAcceptanceCheck(ctx, bad), k).toEqual({ok: false, reason: "DELIVERY_ACCEPTANCE_MISMATCH"});
    }
    for (const bad of [{...good, acknowledgeNotExecuted: false}, {...good, extra: 1}, (({acknowledgeNotExecuted: _a, ...r}) => r)(good), null, [], "x"]) expect(sourceDeliveryAcceptanceCheck(ctx, bad)).toEqual({ok: false, reason: "DELIVERY_ACCEPTANCE_INVALID"});
    expect(sourceDeliveryAcceptanceCheck({...ctx, run: {...m1a, deliveryArtifact: undefined}}, good)).toEqual({ok: false, reason: "DELIVERY_ARTIFACT_NOT_PREPARED"});
    expect(sourceDeliveryAcceptanceCheck({...ctx, missionStatus: "BLOCKED"}, good)).toEqual({ok: false, reason: "DELIVERY_MISSION_NOT_REPORTING"});
    expect(sourceDeliveryAcceptanceCheck({...ctx, latestRunId: "run_" + "8".repeat(24)}, good)).toEqual({ok: false, reason: "DELIVERY_NOT_LATEST_RUN"});
    expect(sourceDeliveryAcceptanceCheck({...ctx, run: {...m1a, sourceDelivery: {...(okc as unknown as {record: any}).record, acceptedAt: "x"}}}, good)).toEqual({ok: false, reason: "DELIVERY_ALREADY_ACCEPTED"});
    const verified = run([...source, ...sandboxTests(), surface()], {deliveryArtifact: art});
    expect(sourceDeliveryAcceptanceCheck({...ctx, run: verified}, good)).toEqual({ok: false, reason: "DELIVERY_PRODUCT_VERIFIED_USE_COMPLETE"});
    // test/harness changes need the exact extra acknowledgement (bound to the TEST_SURFACE log hash)
    const tc = run([...source, ev("VERIFY_TESTS_NOT_EXECUTED", {exitCode: null}), surface({modified: ["tests/a.test.ts"], executedTests: null, functionalAcceptance: "NOT_EXECUTED"})], {deliveryArtifact: art});
    expect(sourceDeliveryAcceptanceCheck({...ctx, run: tc}, good)).toEqual({ok: false, reason: "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"});
    expect(sourceDeliveryAcceptanceCheck({...ctx, run: tc}, {...good, testChangesAcknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: "0".repeat(64)}})).toEqual({ok: false, reason: "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"});
    const tcOk = sourceDeliveryAcceptanceCheck({...ctx, run: tc}, {...good, testChangesAcknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: "c".repeat(64)}});
    expect(tcOk).toMatchObject({ok: true, record: {acknowledgements: {testChanges: {acknowledgeTestChanges: true, testSurfaceSha256: "c".repeat(64), changed: {modified: ["tests/a.test.ts"]}}}}});
    // acceptance never changes the product axis
    const accepted = {...m1a, sourceDelivery: {...(okc as unknown as {record: any}).record, acceptedAt: "2026-10-15T00:00:00.000Z"}};
    const o = deriveOutcomes(accepted);
    expect(o.productVerification.state).toBe("NOT_VERIFIED");
    expect(o.sourceDelivery).toEqual({state: "SOURCE_DELIVERY_ACCEPTED", label: ACC, exportArtifactHash: art.exportArtifactHash, sourceCommit: H});
    expect(o.completionMode).toBe("NOT_COMPLETED");
    expect(completionEvidence(accepted)).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
  });
});

describe("M1a c2 delivery artifact bound to the real run (API + git, no project code executed)", () => {
  it("prepare builds a deterministic artifact of run.headSha (identical hash on re-prepare, fresh studio and after the file is lost); ref refs/uasco/runs/<runId>; labels; no timestamps or machine paths", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "c2-det");
    const {missionId, run} = await m1aRun(c, app, pid);
    // before prepare: the delivery view shows SOURCE_GENERATION_COMPLETE + NOT_VERIFIED, no artifact
    const v0 = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}/delivery`, headers: HDR})).json().delivery;
    expect(v0).toMatchObject({runId: run.runId, missionId, sourceCommit: run.headSha, sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", label: SG}, productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: NV}, testsExecuted: false, artifact: null, accepted: null, fileState: null});
    const spawnSync = vi.spyOn(cp, "spawnSync"), spawn = vi.spyOn(cp, "spawn");
    const n0 = journalEntries(c).length;
    const p1 = await prepare(app, run.runId);
    expect(p1.statusCode, p1.body).toBe(201);
    const art = p1.json().artifact;
    // only git ran during prepare: project code (test.mjs / package scripts / node) is never executed
    for (const call of spawnSync.mock.calls) expect(String(call[0])).toBe("git");
    expect(spawn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(art).toEqual({runId: run.runId, missionId, sourceCommit: run.headSha, treeSha: expect.stringMatching(/^[0-9a-f]{40}$/), exportArtifactHash: expect.stringMatching(/^[0-9a-f]{64}$/), artifactPath: `deliveries/${run.runId}/${art.exportArtifactHash}.zip`});
    const entries = journalEntries(c);
    expect(entries.length).toBe(n0 + 1);
    expect(entries.at(-1)).toMatchObject({type: "DELIVERY_ARTIFACT_PREPARED", payload: art});
    const file = path.join(c.dataDir, art.artifactPath), bytes = fs.readFileSync(file);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(art.exportArtifactHash);
    // namespaced ref in the managed repo, objects local (no alternates needed)
    const repo = path.join(c.dataDir, "projects", pid, "repo");
    expect(git(repo, ["rev-parse", `refs/uasco/runs/${run.runId}`])).toBe(run.headSha);
    expect(git(repo, ["rev-parse", `${run.headSha}^{tree}`])).toBe(art.treeSha);
    // archive: sorted entries, zero DOS time/date, fixed modes, real generated file, labels, no acceptance, no machine paths
    const zipEntries = listZipEntries(bytes, undefined, {scanOnly: true}).filter(e => !e.isDir);
    const names = zipEntries.map(e => e.name);
    expect(names).toEqual([...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    expect(names).toEqual(expect.arrayContaining(["README.md", "VERIFICATION_STATUS.json", "source/feature.txt", "source/package.json"]));
    expect(names.every(n => n === "README.md" || n === "VERIFICATION_STATUS.json" || n.startsWith("source/"))).toBe(true);
    expect(readZipEntry(bytes, zipEntries.find(e => e.name === "source/feature.txt")!).toString("utf8")).toBe("ok\n");
    for (let i = 0; i + 30 <= bytes.length; i++) if (bytes.readUInt32LE(i) === 0x04034b50) { expect(bytes.readUInt16LE(i + 10)).toBe(0); expect(bytes.readUInt16LE(i + 12)).toBe(0); }
    const vs = JSON.parse(readZipEntry(bytes, zipEntries.find(e => e.name === "VERIFICATION_STATUS.json")!).toString("utf8"));
    expect(vs).toMatchObject({schemaVersion: 2, kind: "RUN_DELIVERY_ARTIFACT", runId: run.runId, missionId, projectId: pid, sourceCommit: run.headSha, treeSha: art.treeSha, baseCommit: run.baseSha,
      sourceGeneration: "SOURCE_GENERATION_COMPLETE", productVerification: "NOT_VERIFIED", productVerificationReason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", reviewVerdict: "CLEAN", testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE",
      labels: {sourceGeneration: SG, productVerification: NV, sourceDeliveryOnAcceptance: ACC}});
    expect(vs.reviewEvidenceId).toMatch(/^evd_/);
    expect(JSON.stringify(vs)).not.toMatch(/acceptedAt|SOURCE_DELIVERY_ACCEPTED"/);
    const readme = readZipEntry(bytes, zipEntries.find(e => e.name === "README.md")!).toString("utf8");
    for (const s of [SG, NV, ACC, run.runId, missionId, run.headSha!, "PRODUCT_VERIFIED and mission COMPLETE are impossible"]) expect(readme).toContain(s);
    expect(readme).not.toMatch(/Tests executed [|] yes|PRODUCT_VERIFIED —|[|] COMPLETE|Tests [|] PASSED/);
    const text = bytes.toString("latin1");
    for (const machine of [c.dataDir, tmp, path.basename(tmp), "C:\\", "Users"]) expect(text.includes(machine), machine).toBe(false);
    // re-prepare: identical hash, no new journal entry (idempotent)
    const p2 = await prepare(app, run.runId);
    expect(p2.statusCode).toBe(200);
    expect(p2.json()).toMatchObject({recorded: false, artifact: art});
    expect(journalEntries(c).length).toBe(n0 + 1);
    // a fresh Studio instance rebuilds the identical bytes; after the file and the run workspace are lost the objects are already local
    fs.rmSync(file);
    fs.rmSync(path.join(c.dataDir, "runs", run.runId, "work"), {recursive: true, force: true});
    const st = new ProjectStudio({dataDir: c.dataDir, envPolicyFile: ENV_POLICY});
    const project = new WorkOsStore(c.dataDir).getProject({tenantId: "tA"}, pid)!;
    expect(st.prepareRunDelivery(project, new WorkOsStore(c.dataDir).getRun({tenantId: "tA"}, run.runId)!)).toEqual(art);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    const p3 = await prepare(app, run.runId);
    expect(p3.json()).toMatchObject({recorded: false, artifact: art, delivery: {fileState: "VERIFIED"}});
  });

  it("template-only run (builder commit with the template tree) -> 409 NO_GENERATED_SOURCE, nothing recorded or written; non-complete run -> 409 SOURCE_GENERATION_NOT_COMPLETE", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "c2-tpl");
    const {run} = await m1aRun(c, app, pid, {});
    expect(run.headSha).not.toBe(run.baseSha);
    const n0 = journalEntries(c).length;
    const r = await prepare(app, run.runId);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("NO_GENERATED_SOURCE");
    expect(journalEntries(c).length).toBe(n0);
    expect(fs.existsSync(path.join(c.dataDir, "deliveries", run.runId))).toBe(false);
    // a run that never reached SOURCE_GENERATION_COMPLETE (implementer refused) is refused before git work
    const mc = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: pid, title: "Blocked", objective: "x", acceptanceCriteria: ["x"], riskLevel: "R1"}});
    const mid = mc.json().mission.missionId;
    for (const to of ["PREFLIGHT", "AUTHORIZED"]) await app.inject({method: "POST", url: `/v1/missions/${mid}/transition`, headers: HDR, payload: {to, reason: "go"}});
    const fake = new FakeExecutors(okScript({implement: () => ({files: {"x.txt": "x\n"}, exitCode: 1})})), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
    const r0 = store.createRun({tenantId: "tA", missionId: mid, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    await runner({...c, store, missionId: mid}, fake, {executionGate: new ExecutionGate(null)}).tick();
    expect(store.getRun({tenantId: "tA"}, r0.runId)!.status).not.toBe("AWAITING_APPROVAL");
    const n1 = journalEntries(c).length;
    const b = await prepare(app, r0.runId);
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({error: "SOURCE_GENERATION_NOT_COMPLETE"});
    expect(journalEntries(c).length).toBe(n1);
  });
});

describe("M1a c2 Founder NOT_VERIFIED acceptance: bound, single use, replayed, never COMPLETE", () => {
  it("mismatch on each field, another run, another (stale) artifact, malformed body, second use -> refused with the journal unchanged; the exact object is recorded once; mission never COMPLETE", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "c2-acc");
    const a = await m1aRun(c, app, pid, {"feature.txt": "ok\n"});
    const b = await m1aRun(c, app, pid, {"other.txt": "other\n"});
    const artA = (await prepare(app, a.run.runId)).json().artifact, artB = (await prepare(app, b.run.runId)).json().artifact;
    expect(artA.exportArtifactHash).not.toBe(artB.exportArtifactHash);
    const n0 = journalEntries(c).length;
    const refuse = async (runId: string, acc: unknown, status: number, reason?: string) => {
      const r = await accept(app, runId, acc);
      expect(r.statusCode, `${JSON.stringify(acc)} ${r.body}`).toBe(status);
      if (reason) expect(r.json().reason).toBe(reason);
      expect(journalEntries(c).length).toBe(n0);
    };
    const good = acceptanceOf(artA);
    await refuse(a.run.runId, {...good, runId: b.run.runId}, 409, "DELIVERY_ACCEPTANCE_MISMATCH");
    await refuse(a.run.runId, {...good, missionId: b.missionId}, 409, "DELIVERY_ACCEPTANCE_MISMATCH");
    await refuse(a.run.runId, {...good, sourceCommit: b.run.headSha}, 409, "DELIVERY_ACCEPTANCE_MISMATCH");
    await refuse(a.run.runId, {...good, exportArtifactHash: artB.exportArtifactHash}, 409, "DELIVERY_ACCEPTANCE_MISMATCH");
    // reuse of run A's acceptance for run B (and B's fields with A's artifact)
    await refuse(b.run.runId, good, 409, "DELIVERY_ACCEPTANCE_MISMATCH");
    await refuse(b.run.runId, {...acceptanceOf(artB), exportArtifactHash: artA.exportArtifactHash}, 409, "DELIVERY_ACCEPTANCE_MISMATCH");
    // malformed: missing/false acknowledgement, extra field -> 400
    await refuse(a.run.runId, {...good, acknowledgeNotExecuted: false}, 400);
    await refuse(a.run.runId, (({acknowledgeNotExecuted: _x, ...r}) => r)(good), 400);
    await refuse(a.run.runId, {...good, acknowledgeTestChanges: true}, 400);
    // COMPLETE never accepts acknowledgements and is refused without PRODUCT_VERIFIED
    const cm = await app.inject({method: "POST", url: `/v1/missions/${a.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "x", notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: a.run.headSha}}});
    expect(cm.statusCode).toBe(400);
    const cm2 = await app.inject({method: "POST", url: `/v1/missions/${a.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "x"}});
    expect(cm2.statusCode).toBe(409);
    expect(cm2.json().reason).toBe("COMPLETION_PRODUCT_NOT_VERIFIED");
    expect(journalEntries(c).length).toBe(n0);
    // the exact object is accepted once
    const ok = await accept(app, a.run.runId, good);
    expect(ok.statusCode, ok.body).toBe(200);
    const body = ok.json();
    expect(body.label).toBe(ACC);
    expect(body.mission.status).toBe("REPORTING");
    expect(body.outcomes).toMatchObject({completionMode: "NOT_COMPLETED", productVerification: {state: "NOT_VERIFIED", label: NV}, sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", label: SG}, sourceDelivery: {state: "SOURCE_DELIVERY_ACCEPTED", label: ACC, exportArtifactHash: artA.exportArtifactHash}});
    expect(body.delivery.accepted).toMatchObject({runId: a.run.runId, missionId: a.missionId, sourceCommit: a.run.headSha, exportArtifactHash: artA.exportArtifactHash});
    const entries = journalEntries(c);
    expect(entries.length).toBe(n0 + 1);
    const last = entries.at(-1);
    expect(last.type).toBe("SOURCE_DELIVERY_ACCEPTED");
    expect(Object.keys(last.payload)).toEqual(["runId", "missionId", "sourceCommit", "exportArtifactHash", "acknowledgements", "acceptedAt"]);
    expect(last.payload.acceptedAt).toBe(last.at);
    expect(last.payload.acknowledgements.notExecuted).toMatchObject({acknowledgeNotExecuted: true, productVerification: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE"});
    expect(last.payload.acknowledgements.notExecuted.notExecutedEvidenceIds.length).toBe(2);
    // second use -> 409, journal unchanged; run/mission states untouched
    await (async () => { const r = await accept(app, a.run.runId, good); expect(r.statusCode).toBe(409); expect(r.json().reason).toBe("DELIVERY_ALREADY_ACCEPTED"); expect(journalEntries(c).length).toBe(n0 + 1); })();
    const after = new WorkOsStore(c.dataDir);
    expect(after.getRun({tenantId: "tA"}, a.run.runId)!.status).toBe("AWAITING_APPROVAL");
    expect(after.getMission({tenantId: "tA"}, a.missionId)!.status).toBe("REPORTING");
    expect((await app.inject({method: "POST", url: `/v1/missions/${a.missionId}/transition`, headers: HDR, payload: {to: "COMPLETE", reason: "after acceptance"}})).json().reason).toBe("COMPLETION_PRODUCT_NOT_VERIFIED");
    // after acceptance the artifact is frozen: re-prepare is refused
    expect((await prepare(app, a.run.runId)).json()).toMatchObject({error: "DELIVERY_ALREADY_ACCEPTED"});
    // a stale record: a newer DELIVERY_ARTIFACT_PREPARED for run B supersedes the one the Founder saw
    const sB = new WorkOsStore(c.dataDir);
    sB.recordDeliveryArtifact({tenantId: "tA"}, b.run.runId, {...artB, exportArtifactHash: "f".repeat(64), artifactPath: `deliveries/${b.run.runId}/${"f".repeat(64)}.zip`}, "FOUNDER_LOCAL");
    const n2 = journalEntries(c).length;
    expect(() => sB.acceptSourceDelivery({tenantId: "tA"}, b.run.runId, acceptanceOf(artB), "FOUNDER_LOCAL")).toThrow(/DELIVERY_ACCEPTANCE_MISMATCH/);
    expect(journalEntries(c).length).toBe(n2);
  });

  it("replay re-derives the acceptance byte for byte; forged or reused acceptance entries (valid hash chain) are tamper", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "c2-rep");
    const a = await m1aRun(c, app, pid, {"feature.txt": "ok\n"});
    const b = await m1aRun(c, app, pid, {"other.txt": "other\n"});
    const artA = (await prepare(app, a.run.runId)).json().artifact;
    await prepare(app, b.run.runId);
    expect((await accept(app, a.run.runId, acceptanceOf(artA))).statusCode).toBe(200);
    await app.close(); apps.splice(0);
    const good = journalEntries(c);
    fs.rmSync(path.join(c.dataDir, "snapshot.json"), {force: true});
    const fresh = new WorkOsStore(c.dataDir);
    expect(fresh.isTampered).toBe(false);
    const ra = fresh.getRun({tenantId: "tA"}, a.run.runId)!;
    expect(ra.sourceDelivery).toEqual(good.at(-1).payload);
    expect(deriveOutcomes(ra).productVerification.state).toBe("NOT_VERIFIED");
    const accIdx = good.findIndex(e => e.type === "SOURCE_DELIVERY_ACCEPTED");
    const forge = (edit: (p: any) => any) => rewriteJournal(c, () => good.map((e, i) => i === accIdx ? {...e, payload: edit(structuredClone(e.payload))} : e));
    const variants: Array<[string, (p: any) => any]> = [
      ["other artifact hash", p => ({...p, exportArtifactHash: "f".repeat(64)})],
      ["acknowledgement stripped", p => ({...p, acknowledgements: {...p.acknowledgements, notExecuted: {...p.acknowledgements.notExecuted, acknowledgeNotExecuted: false}}})],
      ["claims PRODUCT_VERIFIED", p => ({...p, acknowledgements: {...p.acknowledgements, notExecuted: {...p.acknowledgements.notExecuted, productVerification: "PRODUCT_VERIFIED"}}})],
      ["reused for run B", p => ({...p, runId: b.run.runId, missionId: b.missionId, sourceCommit: b.run.headSha})],
      ["acceptedAt rewritten", p => ({...p, acceptedAt: "2020-01-01T00:00:00.000Z"})]
    ];
    for (const [name, edit] of variants) {
      forge(edit);
      expect(new WorkOsStore(c.dataDir).isTampered, name).toBe(true);
    }
    // a duplicated acceptance entry (second use) is tamper as well
    rewriteJournal(c, () => [...good, {...good[accIdx]}]);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(true);
    // a cycle-1 style COMPLETE record carrying a NOT_EXECUTED acknowledgement is no longer derivable -> tamper
    rewriteJournal(c, () => [...good.filter(e => e.type !== "SOURCE_DELIVERY_ACCEPTED"), {type: "RUN_TRANSITION", actor: "x", at: new Date().toISOString(), payload: {runId: a.run.runId, leaseId: null, from: "AWAITING_APPROVAL", to: "SUCCEEDED", reason: "FOUNDER_ACCEPTED: x",
      mission: {missionId: a.missionId, from: "REPORTING", to: "COMPLETE", reason: "x"}, completion: {headSha: a.run.headSha, reportEvidenceId: "x", reviewEvidenceId: "x", securityEvidenceId: "x", notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: a.run.headSha}}}}]);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(true);
    // the untouched journal still replays cleanly
    rewriteJournal(c, () => good);
    expect(new WorkOsStore(c.dataDir).isTampered).toBe(false);
  });

  it("export and accept re-verify the artifact sha256 against the record: a modified or missing file is refused (no bytes, no acceptance)", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "c2-exp");
    const a = await m1aRun(c, app, pid);
    expect((await exportDelivery(app, a.run.runId)).json()).toMatchObject({error: "DELIVERY_ARTIFACT_NOT_PREPARED"});
    const art = (await prepare(app, a.run.runId)).json().artifact;
    const ex = await exportDelivery(app, a.run.runId);
    expect(ex.statusCode).toBe(200);
    expect(ex.json()).toMatchObject({sha256: art.exportArtifactHash, fileState: "VERIFIED", artifact: art});
    expect(path.resolve(ex.json().path)).toBe(path.resolve(c.dataDir, art.artifactPath));
    const file = path.join(c.dataDir, art.artifactPath), orig = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([orig, Buffer.from("x")]));
    const n0 = journalEntries(c).length;
    expect((await app.inject({method: "GET", url: `/v1/work-runs/${a.run.runId}/delivery`, headers: HDR})).json().delivery.fileState).toBe("MODIFIED");
    const bad = await exportDelivery(app, a.run.runId);
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toEqual({error: "DELIVERY_ARTIFACT_HASH_MISMATCH"});
    const badAcc = await accept(app, a.run.runId, acceptanceOf(art));
    expect(badAcc.statusCode).toBe(409);
    expect(badAcc.json().error).toBe("DELIVERY_ARTIFACT_HASH_MISMATCH");
    fs.rmSync(file);
    expect((await exportDelivery(app, a.run.runId)).json()).toEqual({error: "DELIVERY_ARTIFACT_MISSING"});
    expect((await accept(app, a.run.runId, acceptanceOf(art))).json().error).toBe("DELIVERY_ARTIFACT_MISSING");
    expect(journalEntries(c).length).toBe(n0);
    // the listing presents only evidence-derived states (never COMPLETE/VERIFIED for this run)
    const list = (await app.inject({method: "GET", url: `/v1/deliveries?projectId=${pid}`, headers: HDR})).json().deliveries;
    expect(list.map((d: any) => [d.runId, d.sourceGeneration.state, d.productVerification.state, d.fileState])).toEqual([[a.run.runId, "SOURCE_GENERATION_COMPLETE", "NOT_VERIFIED", "MISSING"]]);
    expect(deliveryView(new WorkOsStore(c.dataDir).getRun({tenantId: "tA"}, a.run.runId)!).labels).toEqual({sourceGeneration: SG, productVerification: NV, sourceDelivery: null});
  });
});

// //TR: LANE-B: delivery POST'larının (prepare/accept/export) ortak yazma kapıları (GLOBAL_STOP 423, politika 403) ve ret audit olayları (WORKOS_DELIVERY_PREPARE_REFUSED, WORKOS_SOURCE_DELIVERY_REFUSED) yalnız route düzeyinde, journal değişmeden doğrulanır.
describe("LANE-B delivery routes: write gates and refusal audit events", () => {
  const auditEvents = (c: Ctx): Array<Record<string, any>> => {
    const f = path.join(c.runtime, "control-api-events.jsonl");
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  };
  const named = (c: Ctx, event: string) => auditEvents(c).filter(e => e.event === event || e.type === event || e.name === event || JSON.stringify(e).includes(`"${event}"`));

  it("GLOBAL_STOP answers 423 on all three delivery POSTs without touching the journal or the delivery files; reads still work and the gate lifts", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "lane-b-stop");
    const {run} = await m1aRun(c, app, pid);
    const art = (await prepare(app, run.runId)).json().artifact;
    fs.writeFileSync(c.stopFile, JSON.stringify({active: true, reason: "test", actor: "TEST"}));
    const n0 = journalEntries(c).length;
    for (const r of [await prepare(app, run.runId), await accept(app, run.runId, acceptanceOf(art)), await exportDelivery(app, run.runId)]) {
      expect(r.statusCode, r.body).toBe(423);
      expect(r.json().error).toBe("GLOBAL_STOP_ACTIVE");
    }
    expect(journalEntries(c).length).toBe(n0);
    expect((await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}/delivery`, headers: HDR})).statusCode).toBe(200);
    fs.rmSync(c.stopFile);
    expect((await exportDelivery(app, run.runId)).statusCode).toBe(200);
  });

  it("an action-gateway denial answers 403 SCOPE_DENIED on all three delivery POSTs, journal unchanged, and audits WORKOS_WRITE_DENIED per action", { timeout: T }, async () => {
    const c = setup(tmp), ok = noProviderApi(c), pid = await studioProject(c, ok, "lane-b-deny");
    const {run} = await m1aRun(c, ok, pid);
    const art = (await prepare(ok, run.runId)).json().artifact;
    const denied = api(c, {sandbox: undefined, policyContext: {scopeAllowed: false}}); apps.push(denied);
    const n0 = journalEntries(c).length;
    for (const r of [await prepare(denied, run.runId), await accept(denied, run.runId, acceptanceOf(art)), await exportDelivery(denied, run.runId)]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json()).toMatchObject({error: "ACTION_DENIED", reason: "SCOPE_DENIED"});
    }
    expect(journalEntries(c).length).toBe(n0);
    const text = JSON.stringify(auditEvents(c));
    for (const a of ["workos.delivery.prepare", "workos.delivery.accept", "workos.delivery.export"]) expect(text).toContain(a);
    expect(named(c, "WORKOS_WRITE_DENIED").length).toBe(3);
  });

  it("refusals leave an audit trail with a fixed reason code and no absolute path", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(c, app, "lane-b-audit");
    const tpl = await m1aRun(c, app, pid, {});
    expect((await prepare(app, tpl.run.runId)).statusCode).toBe(409);
    const pre = named(c, "WORKOS_DELIVERY_PREPARE_REFUSED");
    expect(pre).toHaveLength(1);
    expect(JSON.stringify(pre[0])).toContain("NO_GENERATED_SOURCE");

    const a = await m1aRun(c, app, pid, {"feature.txt": "ok\n"}), art = (await prepare(app, a.run.runId)).json().artifact;
    expect((await accept(app, a.run.runId, {...acceptanceOf(art), exportArtifactHash: "f".repeat(64)})).statusCode).toBe(409);
    const refused = named(c, "WORKOS_SOURCE_DELIVERY_REFUSED");
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(refused[0])).toContain("DELIVERY_ACCEPTANCE_MISMATCH");

    fs.appendFileSync(path.join(c.dataDir, "deliveries", a.run.runId, fs.readdirSync(path.join(c.dataDir, "deliveries", a.run.runId))[0]), "x");
    expect((await accept(app, a.run.runId, acceptanceOf(art))).statusCode).toBe(409);
    expect(JSON.stringify(named(c, "WORKOS_SOURCE_DELIVERY_REFUSED"))).toContain("DELIVERY_ARTIFACT_MODIFIED");
    const all = JSON.stringify(auditEvents(c));
    expect(all).not.toContain(c.tmp);
  });
});

// //TR: LANE-B B-E2E-1: ilk teslim zincirinin backend uçtan uca kanıtı tek testte: intake(template) -> yönetilen depo -> plan -> koşu (sahte implementer'ın küçük gerçek değişikliği) -> VERIFY'ın ExecutionGate üzerinden GERÇEK LinuxUnshareSandboxProvider ile çalışması -> teslim kaydının okunması -> görev durumunun koşuyu izlemesi. Sandbox bu ana makinede doğrulanırsa testler ÇALIŞMIŞ olmalıdır; doğrulanamazsa dürüst NOT_EXECUTED / SANDBOX_UNAVAILABLE ve tam neden beklenir (asla sahte PASS).
describe("LANE-B first-delivery backend E2E (intake template -> plan -> run -> VERIFY via ExecutionGate -> delivery -> task status)", () => {
  async function walk(mkProvider: () => import("../core/workos/execution-gate.js").SandboxProvider, label: string) {
    const {LINUX_SANDBOX_ID} = await import("../core/agents/linux-unshare-sandbox.js");
    const dataDir = path.join(tmp, "data-e2e"), runtime = path.join(tmp, "runtime-e2e"); fs.mkdirSync(runtime, {recursive: true});
    const ctx0 = {tmp, runtime, dataDir, tenantId: "tA"} as Ctx;
    const provider = mkProvider();
    const st = await provider.selfTest();
    const branch = st.ok ? "SANDBOX_VERIFIED_TESTS_EXECUTED" : `SANDBOX_UNAVAILABLE_${st.detail}`;
    console.log(`B-E2E-1 ${label} sandbox branch: ${branch}`);
    const app = api(ctx0, {sandbox: provider}); apps.push(app);
    const post = (url: string, payload: unknown) => app.inject({method: "POST", url, headers: HDR, payload: payload as any});
    const get = (url: string) => app.inject({method: "GET", url, headers: HDR});

    // 1. intake with a template -> project with a managed repository and the template's test command
    const itk = await post("/v1/intakes", {idea: "A small web app with an API where I track my daily reading streak", template: "web-node", idempotencyKey: "e2e-1"});
    expect(itk.statusCode, itk.body).toBe(201);
    const {projectId, missionId} = itk.json().intake as {projectId: string; missionId: string};
    const project = (await get("/v1/projects")).json().projects.find((x: any) => x.projectId === projectId);
    expect(project).toMatchObject({template: "web-node", testCommand: ["node", "test.js"], repository: {managed: true}});
    // 2. plan -> tasks
    const plan = await post(`/v1/missions/${missionId}/plan`, {tasks: [{title: "Add the reading page"}, {title: "Keep the API health check"}]});
    expect(plan.statusCode, plan.body).toBeLessThan(300);
    const tasks = (await get(`/v1/missions/${missionId}/tasks`)).json().tasks as {taskId: string; title: string}[];
    expect(tasks.length).toBe(2);
    // 3. mission authorized, one run with the fake implementer's small real change
    for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await post(`/v1/missions/${missionId}/transition`, {to, reason: "go"})).statusCode).toBe(200);
    const page = '<!doctype html><html><head><meta charset="utf-8"><title>Reading streak</title></head><body><h1>Reading streak</h1><p>Read today to keep your streak.</p></body></html>\n';
    const fake = new FakeExecutors(okScript({implement: () => ({files: {"public/index.html": page}})})), pair = fake.pair(), store = new WorkOsStore(dataDir);
    const run0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
    const link = await post(`/v1/tasks/${tasks[0].taskId}/runs`, {runId: run0.runId});
    expect(link.statusCode, link.body).toBeLessThan(300);
    const c = {tmp, store, dataDir, runtime, stopFile: path.join(runtime, "GLOBAL_STOP.json"), repo: "", head: "", missionId, projectId, tenantId: "tA"} as Ctx;
    const run = await drive(c, runner(c, fake, {executionGate: new ExecutionGate(provider)}), run0.runId);
    expect(run.status, run.reason ?? "").toBe("AWAITING_APPROVAL");
    expect(run.headSha).toBeTruthy(); expect(run.headSha).not.toBe(run.baseSha);
    const ev = run.evidence.map(e => e.kind);
    expect(ev).toContain("IMPLEMENT"); expect(ev).toContain("REVIEW");
    // 4. VERIFY: executed through the real sandbox, or honestly NOT_EXECUTED with the exact reason
    const delivery = (await get(`/v1/work-runs/${run.runId}/delivery`)).json().delivery;
    expect(delivery).toMatchObject({runId: run.runId, missionId, sourceCommit: run.headSha, sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE"}});
    if (st.ok) {
      const v = run.evidence.find(e => e.kind === "VERIFY_TESTS")!;
      expect(ev).not.toContain("VERIFY_TESTS_NOT_EXECUTED");
      expect(v, `branch ${branch}: ${run.reason ?? ""}`).toBeTruthy();
      expect(v.exitCode).toBe(0);
      expect(v.sandboxProviderId).toBe(LINUX_SANDBOX_ID);
      expect(fs.readFileSync(path.join(dataDir, v.logPath!), "utf8")).toContain("tests 3");
      expect(delivery.productVerification, JSON.stringify(delivery.productVerification)).toMatchObject({state: "PRODUCT_VERIFIED"});
    } else {
      expect(run.reason).toContain("TESTS_NOT_EXECUTED_SANDBOX_UNAVAILABLE");
      expect(ev).toContain("VERIFY_TESTS_NOT_EXECUTED"); expect(ev).not.toContain("VERIFY_TESTS");
      expect(run.evidence.find(e => e.kind === "VERIFY_TESTS_NOT_EXECUTED")!.note).toMatch(/^NOT_EXECUTED: SANDBOX_UNAVAILABLE \(SELF_TEST_FAILED\)/);
      expect(st.detail).toMatch(/^[A-Z_]+$/);
      expect(delivery.productVerification).toMatchObject({state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE"});
    }
    // 5. the delivery record can be prepared and read back
    const prep = await post(`/v1/work-runs/${run.runId}/delivery/prepare`, {});
    expect(prep.statusCode, prep.body).toBe(201);
    expect(prep.json().artifact).toMatchObject({runId: run.runId, sourceCommit: run.headSha});
    expect((await get(`/v1/work-runs/${run.runId}/delivery`)).json().delivery.artifact?.exportArtifactHash).toBe(prep.json().artifact.exportArtifactHash);
    // 6. the task status follows the run (AWAITING_APPROVAL -> IN_PROGRESS), the other task is untouched; the flow view shows the chain
    const rec = await post(`/v1/work-runs/${run.runId}/tasks/reconcile`, {});
    expect(rec.statusCode, rec.body).toBe(200);
    expect((await get(`/v1/tasks/${tasks[0].taskId}`)).json().task.status).toBe("IN_PROGRESS");
    expect((await get(`/v1/tasks/${tasks[1].taskId}`)).json().task.status).toBe("PENDING");
    const flow = (await get(`/v1/projects/${projectId}/flow`)).json().flow;
    expect(flow.latestRunId).toBe(run.runId); expect(flow.testCommand).toBe("CONFIGURED"); expect(flow.taskRuns).toMatchObject({tasksWithRuns: 1, tasks: 2});
    return {executed: st.ok, branch};
  }
  it("real Linux sandbox provider on this host: EXECUTED+passed when it verifies, otherwise honest NOT_EXECUTED with the exact reason (the CI host takes one branch; it is printed)", { timeout: T }, async () => {
    const {LinuxUnshareSandboxProvider} = await import("../core/agents/linux-unshare-sandbox.js");
    const isRoot = (process.getuid?.() ?? 0) === 0;
    const r = await walk(() => new LinuxUnshareSandboxProvider(isRoot ? {acceptUnenforcedProcessLimit: true} : {}), "real");
    expect(typeof r.executed).toBe("boolean");
  });
  it("a host that cannot isolate (unshare missing) always yields the honest NOT_EXECUTED outcome with SANDBOX_UNAVAILABLE and never a PASS", { timeout: T }, async () => {
    const {LinuxUnshareSandboxProvider} = await import("../core/agents/linux-unshare-sandbox.js");
    const r = await walk(() => new LinuxUnshareSandboxProvider({unshareBinary: "/nonexistent/unshare"}), "forced-unavailable");
    expect(r).toEqual({executed: false, branch: "SANDBOX_UNAVAILABLE_UNSHARE_MISSING"});
  });
});
