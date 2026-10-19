// //TR: Bu test CORE-6 crew DEVELOPMENT + REVIEW kancalarını UÇTAN UCA GERÇEK ürün kodundan geçirir: GERÇEK PreDevDriver + CORE-5 CrewCoordinator (pre-dev), GERÇEK MissionRunner (CORE-4 kod-üretim hattı), GERÇEK ProjectStudio.prepareRunDelivery (deterministik teslim/dışa-aktarım), GERÇEK doğrulayıcılar ve GERÇEK WorkOsStore/journal. YALNIZ builder (TaskHub fixture'ı / üretilen dilimi döndüren) ve reviewer (verdict) ENJEKTE edilen portlardır. Driver/runner/delivery/validators/store YENİDEN YAZILMAZ veya stub'lanmaz. execution-gate SAĞLAYICISIZDIR (ExecutionGate(null)) => her yürütme BLOCKED(SANDBOX_UNAVAILABLE); ÜRETİLEN KOD HİÇ ÇALIŞTIRILMAZ. Doğrulanan: tam pre-dev -> dev -> review koşusu SOURCE_GENERATION_COMPLETE bir teslime (deterministik exportArtifactHash, runId + sourceCommit'e bağlı) ulaşır; review verdict'i developer'dan BAĞIMSIZ bir reviewer aktörünce kaydedilir; review-REWORK döngüsü kaynağı SUPERSEDE edip yeniden review eder; rework sınırı aşılınca FAIL-CLOSED olur; hiçbir mission PRODUCT_VERIFIED'a ulaşmaz ve execution-gate üretilen kodu çalıştırmak için ASLA çağrılmaz. Ledger (pre-dev + dev + review) yalnız gerçek kaydedilmiş journal olaylarından türetilir ve taze store'dan replay edilebilir.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {ProjectStudio} from "../core/workos/project-studio.js";
import {MissionRunner} from "../core/workos/runner.js";
import {ExecutionGate, SANDBOX_UNAVAILABLE, PROJECT_EXECUTION_KINDS} from "../core/workos/execution-gate.js";
import {fakeSecurity} from "../core/workos/security-tools.js";
import {sourceGenerationOf, productVerificationOf, completionEvidence, deriveOutcomes, M1A_LABELS} from "../core/workos/outcomes.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../core/workos/predev/driver.js";
import {PRE_DEV_ROLE_MAP, ARTIFACT_KINDS} from "../core/workos/predev/types.js";
import type {ArtifactKind} from "../core/workos/predev/types.js";
import {TASKHUB_BRIEF} from "../core/workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
import {buildCrewPlan} from "../core/workos/crew/assignment.js";
import {CrewCoordinator, type ReworkDecider, type CrewStore} from "../core/workos/crew/coordinator.js";
import {
  CrewDevReview, CrewDevReviewError, crewDevExecutors, deriveDevReviewTimeline,
  type DevBuildContext, type DevBuilderPort, type DevReviewContext, type DevReviewerPort, type DevelopmentEngine, type ReviewVerdict
} from "../core/workos/crew/dev-review.js";
import type {ExecutorPair} from "../core/workos/executors.js";
import type {Project, Scope, WorkRun} from "../core/workos/types.js";
import {TASKHUB_GENERATED_FILES} from "./fixtures/taskhub-generated/slice.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ENV_POLICY = path.join(REPO, "config", "environment-policy.json");
const T = 180_000;

const SCOPE: Scope = {tenantId: "t-crew-core6"};
const RECORDER = "implementer@local.invalid";
const APPROVER = "reviewer@local.invalid";
const DEVELOPER_ROLE = "UASCO-0085";   // Principal Workflow Backend Engineer (gerçek katalog; certified değil)
const REVIEWER_ROLE = "UASCO-0252";    // Principal Secure Code Review Expert (gerçek katalog; certified değil)
const SG = M1A_LABELS.SOURCE_GENERATION_COMPLETE, NV = M1A_LABELS.NOT_VERIFIED_SANDBOX;
const TERMINAL: readonly string[] = ["AWAITING_APPROVAL", "SUCCEEDED", "BLOCKED", "FAILED", "CANCELLED", "RECOVERY_FAILED", "QUARANTINED"];

// //TR: Üretilen TaskHub dilimi teslim yollarında "taskhub/..." altına yerleştirilir (CORE-4 ile aynı yerleşim).
const SLICE_UNDER_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(TASKHUB_GENERATED_FILES).map(([p, content]) => ["taskhub/" + p, content])
);

// //TR: PRE_DEV için enjekte BuilderPort: tür başına GERÇEK TaskHub fixture'ını JSON metni olarak döndürür (CORE-5 ile aynı). Canlı model/ağ/shell yok.
class TaskHubFixtureBuilder implements BuilderPort {
  async produce(kind: ArtifactKind, _rp: string, _ctx: MissionContext): Promise<string> { return JSON.stringify(TASKHUB_ARTIFACTS[kind]); }
}
class AcceptAllDecider implements ReworkDecider { decide(): {accept: true} { return {accept: true}; } }

// //TR: DEVELOPMENT portu: üretilen dilimi döndürür. attempt>0 (REWORK) olduğunda SUPERSEDE eden farklı bir sürüm üretir (rework sebebini belgeleyen ek dosya); böylece runner gerçek bir yeni commit yazar (değişiklik yok reddi olmaz). Üretilen kod ASLA çalıştırılmaz.
class SliceBuilderPort implements DevBuilderPort {
  readonly builds: DevBuildContext[] = [];
  async build(ctx: DevBuildContext): Promise<{files: Record<string, string>}> {
    this.builds.push(ctx);
    const files: Record<string, string> = {...SLICE_UNDER_PREFIX};
    if (ctx.attempt > 0) files[`taskhub/REWORK-${ctx.attempt}.md`] = `# Rework ${ctx.attempt}\n\nAddressed reviewer request: ${(ctx.rework?.reason ?? "").replace(/[\r\n]+/g, " ")}\n`;
    return {files};
  }
}

// //TR: REVIEW portu (kayıtlı deterministik karar). Varsayılan: her zaman REVIEW_CLEAN. target attempt'lerde REWORK_REQUESTED döner (uydurma değil; sabit sebep).
class RecordedReviewerPort implements DevReviewerPort {
  readonly reviews: DevReviewContext[] = [];
  constructor(private readonly plan: (ctx: DevReviewContext) => ReviewVerdict) {}
  async review(ctx: DevReviewContext): Promise<ReviewVerdict> { this.reviews.push(ctx); return this.plan(ctx); }
}

let tmp = "";
let dataDir = "";
let store: WorkOsStore;
let studio: ProjectStudio;
let engineSeq = 0;
let tick = 0;
const now = () => `2026-10-16T01:00:${String(tick++ % 60).padStart(2, "0")}.000Z`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-crew-core6-"));
  dataDir = path.join(tmp, "data");
  store = new WorkOsStore(dataDir);
  studio = new ProjectStudio({dataDir, envPolicyFile: ENV_POLICY});
  engineSeq = 0; tick = 0;
});
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

// //TR: Yönetilen depolu (web-node şablonu) proje + AUTHORIZED mission; pre-dev + run için hazır. Depo <dataDir>/projects/<id>/repo altında kurulur (prepareRunDelivery bunu gerektirir).
function authorizedProjectMission(): {project: Project; missionId: string} {
  const p = store.createProjectDetailed({
    tenantId: SCOPE.tenantId, orgId: "org1", name: "TaskHub", environmentId: "env-dev", createdBy: RECORDER,
    template: "web-node", testCommand: ["node", "test.js"],
    prepareManagedRepository: (projectId) => { const x = studio.createTemplateRepository(projectId, "web-node", "TaskHub"); return {path: x.path, discard: x.discard}; }
  }).entity;
  const m = store.createMission({tenantId: SCOPE.tenantId, projectId: p.projectId, title: "TaskHub crew", objective: "tasks domain vertical slice", acceptanceCriteria: ["reviewed"], riskLevel: "R1", createdBy: RECORDER});
  store.transitionMission(SCOPE, m.missionId, "PREFLIGHT", "preflight", RECORDER);
  store.transitionMission(SCOPE, m.missionId, "AUTHORIZED", "authorized", RECORDER);
  return {project: p, missionId: m.missionId};
}

// //TR: CORE-5 pre-dev crew koşusu: BA->Req->Plan->Arch->UX, bağımsız onayla PRE_DEV_COMPLETE'e. Mission AUTHORIZED kalır.
async function runPreDev(missionId: string): Promise<void> {
  const b = new TaskHubFixtureBuilder();
  const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: b});
  const coord = new CrewCoordinator({store: store as unknown as CrewStore, driver, plan: buildCrewPlan(), brief: TASKHUB_BRIEF, builder: b, decider: new AcceptAllDecider(), maxReworkPerPhase: 2, recorder: RECORDER, approver: APPROVER, now});
  const res = await coord.run(SCOPE, missionId);
  expect(res.status).toBe("PRE_DEV_COMPLETE");
  const rm = store.preDevReadModel(SCOPE, missionId);
  expect(rm.phase).toBe("PRE_DEV_COMPLETE");
  for (const kind of ARTIFACT_KINDS) expect(rm.artifacts[kind].approved, `${kind} approved`).toBe(true);
}

// //TR: Enjekte geliştirme motoru: GERÇEK MissionRunner'ı crew executor çifti + SAĞLAYICISIZ execution-gate (ExecutionGate(null)) + deterministik fake güvenlik araçlarıyla kurar ve run'ı terminal duruma kadar sürer. Üretilen proje kodu ASLA çalıştırılmaz (gate BLOCKED).
function makeEngine(maxRemediations: number): (executors: ExecutorPair) => DevelopmentEngine & {gate: ExecutionGate} {
  return (executors: ExecutorPair) => {
    const gate = new ExecutionGate(null);
    const runner = new MissionRunner({
      store, dataDir, globalStopFile: path.join(tmp, `GLOBAL_STOP-${engineSeq}.json`), envPolicyFile: ENV_POLICY, executors,
      retryBackoffMs: [0, 0], leaseTtlMs: 60_000, maxRemediations, security: fakeSecurity(`${dataDir}-sec-${engineSeq++}`).options, executionGate: gate
    });
    return {
      gate,
      async drive(runId: string): Promise<WorkRun> {
        for (let i = 0; i < 60; i++) { await runner.tick(); const r = store.getRun(SCOPE, runId)!; if (TERMINAL.includes(r.status)) return r; }
        return store.getRun(SCOPE, runId)!;
      }
    };
  };
}

function devReview(project: Project, builder: DevBuilderPort, reviewer: DevReviewerPort, maxRemediations: number): CrewDevReview {
  return new CrewDevReview({store, studio, builder, reviewer, developerRoleId: DEVELOPER_ROLE, reviewerRoleId: REVIEWER_ROLE, envPolicyFile: ENV_POLICY, makeEngine: makeEngine(maxRemediations), createdBy: RECORDER});
}

describe("CORE-6 crew dev+review bridge (ports + independence)", () => {
  it("builds an independent executor pair from the ports and refuses a non-independent reviewer", () => {
    const pair = crewDevExecutors(DEVELOPER_ROLE, REVIEWER_ROLE, new SliceBuilderPort(), new RecordedReviewerPort(() => ({verdict: "REVIEW_CLEAN"})), ENV_POLICY);
    expect(pair.implementer.identity).toBe(DEVELOPER_ROLE);
    expect(pair.reviewer.identity).toBe(REVIEWER_ROLE);
    expect(pair.implementer.identity).not.toBe(pair.reviewer.identity);
    expect(() => crewDevExecutors(DEVELOPER_ROLE, DEVELOPER_ROLE, new SliceBuilderPort(), new RecordedReviewerPort(() => ({verdict: "REVIEW_CLEAN"})), ENV_POLICY)).toThrow(CrewDevReviewError);
    expect(() => new CrewDevReview({store, studio, builder: new SliceBuilderPort(), reviewer: new RecordedReviewerPort(() => ({verdict: "REVIEW_CLEAN"})), developerRoleId: "UASCO-0085", reviewerRoleId: "UASCO-0085", envPolicyFile: ENV_POLICY, makeEngine: makeEngine(2), createdBy: RECORDER})).toThrow(CrewDevReviewError);
  });

  it("the developer and reviewer role ids exist in the REAL registry and NEITHER is certified", () => {
    const reg = JSON.parse(fs.readFileSync(path.join(REPO, "registries", "role-definitions.json"), "utf8"));
    const arr: Array<Record<string, unknown>> = Array.isArray(reg) ? reg : (reg.roles ?? reg.definitions ?? Object.values(reg).find((v: unknown) => Array.isArray(v)) as Array<Record<string, unknown>>);
    for (const id of [DEVELOPER_ROLE, REVIEWER_ROLE]) {
      const r = arr.find(x => x.id === id || x.roleId === id);
      expect(r, `role ${id} must exist`).toBeTruthy();
      expect(r!.proficiencyStatus, `role ${id} not certified`).not.toBe("CERTIFIED");
      expect(r!.runtimeStatus).not.toBe("CERTIFIED");
    }
    expect(DEVELOPER_ROLE).not.toBe(REVIEWER_ROLE);
  });
});

describe("CORE-6 full pre-dev -> development -> review over REAL driver/runner/delivery/store", () => {
  it("clean review: reaches a SOURCE_GENERATION_COMPLETE deterministic delivery; review verdict recorded by an independent reviewer actor; NOT product-verified; generated code never executed", { timeout: T }, async () => {
    const {project, missionId} = authorizedProjectMission();
    await runPreDev(missionId);

    const builder = new SliceBuilderPort();
    const reviewer = new RecordedReviewerPort(() => ({verdict: "REVIEW_CLEAN"}));
    const res = await devReview(project, builder, reviewer, 2).run(SCOPE, project, missionId);

    expect(res.status, JSON.stringify(res)).toBe("DELIVERED");
    if (res.status !== "DELIVERED") throw new Error("unreachable");
    const run = res.run;

    // Kaynak üretimi tamam; ürün DOĞRULANMADI (sandbox yok); teslim deterministik exportArtifactHash taşır.
    expect(sourceGenerationOf(run)).toMatchObject({state: "SOURCE_GENERATION_COMPLETE", label: SG});
    expect(productVerificationOf(run.headSha!, run.evidence)).toMatchObject({state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: NV});
    expect(res.delivery).toEqual({
      runId: run.runId, missionId, sourceCommit: run.headSha,
      treeSha: expect.stringMatching(/^[0-9a-f]{40}$/), exportArtifactHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      artifactPath: `deliveries/${run.runId}/${res.delivery.exportArtifactHash}.zip`
    });
    // Artefakt diskte ve sha256'sı exportArtifactHash ile eşleşir; taze studio AYNI baytı yeniden üretir (deterministik).
    const file = path.join(dataDir, res.delivery.artifactPath), bytes = fs.readFileSync(file);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(res.delivery.exportArtifactHash);
    const freshStudio = new ProjectStudio({dataDir, envPolicyFile: ENV_POLICY});
    const freshProject = new WorkOsStore(dataDir).getProject(SCOPE, project.projectId)!;
    const rebuilt = freshStudio.prepareRunDelivery(freshProject, new WorkOsStore(dataDir).getRun(SCOPE, run.runId)!);
    expect(rebuilt).toEqual(res.delivery);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    // Teslim artefaktı üretilen gerçek dosyaları source/taskhub/... altında taşır (çalıştırılmadan paketlendi).
    const text = bytes.toString("latin1");
    expect(text).toContain("source/taskhub/src/auth.ts");
    expect(text).toContain("source/taskhub/db/migrations/0001_init.sql");

    // Review verdict'i BAĞIMSIZ reviewer aktörünce (reviewer rolü != developer rolü) GERÇEK REVIEW kanıtına kaydedildi.
    const reviewEv = run.evidence.filter(e => e.kind === "REVIEW");
    expect(reviewEv.length).toBeGreaterThanOrEqual(1);
    const cleanReview = reviewEv.find(e => e.verdict === "CLEAN")!;
    expect(cleanReview.reviewerIdentity).toBe(REVIEWER_ROLE);
    expect(cleanReview.reviewerIdentity).not.toBe(run.executor.implementer);
    expect(run.executor).toEqual({implementer: DEVELOPER_ROLE, reviewer: REVIEWER_ROLE});
    // IMPLEMENT kanıtı developer rolünce; tek kaynak sürüm (rework yok).
    const implEv = run.evidence.filter(e => e.kind === "IMPLEMENT" && e.exitCode === 0 && e.commitSha);
    expect(implEv).toHaveLength(1);
    expect(implEv[0].executorIdentity).toBe(DEVELOPER_ROLE);
    expect(res.reviewRework).toBe(0);
    expect(reviewer.reviews).toHaveLength(1);

    // Hiçbir mission PRODUCT_VERIFIED/COMPLETE değildir; execution-gate üretilen kodu çalıştırmak için ASLA çağrılmadı.
    expect(completionEvidence(run)).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    expect(deriveOutcomes(run).completionMode).not.toBe("COMPLETE");
    expect(store.getMission(SCOPE, missionId)?.status).not.toBe("COMPLETE");
    expect(run.evidence.some(e => (e.kind === "VERIFY_TESTS" || e.kind === "REGRESSION_TESTS") && e.commitSha === run.headSha)).toBe(false);
    expect(run.evidence.some(e => e.kind === "VERIFY_TESTS_NOT_EXECUTED" || e.kind === "REGRESSION_TESTS_NOT_EXECUTED")).toBe(true);

    // Re-prepare aynı run -> AYNI kayıt, journal'a yeni DELIVERY yazılmaz (deterministik, idempotent).
    const again = store.recordDeliveryArtifact(SCOPE, run.runId, studio.prepareRunDelivery(project, store.getRun(SCOPE, run.runId)!), DEVELOPER_ROLE);
    expect(again.recorded).toBe(false);
    expect(again.record).toEqual(res.delivery);

    // Ledger: pre-dev + dev+review tek zaman çizelgesi; tek temiz sürüm, teslim hash'li.
    const tl = deriveDevReviewTimeline(run, DEVELOPER_ROLE, REVIEWER_ROLE);
    expect(tl.versions).toHaveLength(1);
    expect(tl.versions[0]).toMatchObject({cycle: 0, developerRoleId: DEVELOPER_ROLE, reviewerRoleId: REVIEWER_ROLE, reviewVerdict: "REVIEW_CLEAN"});
    expect(tl.versions[0].sourceCommit).toBe(run.headSha);
    expect(tl.finalVerdict).toBe("REVIEW_CLEAN");
    expect(tl.delivery?.exportArtifactHash).toBe(res.delivery.exportArtifactHash);

    // Execution gate sağlayıcısız: her proje-kod yürütme türü BLOCKED(SANDBOX_UNAVAILABLE) (üretilen kod çalıştırılamaz).
    const gate = new ExecutionGate(null);
    for (const kind of PROJECT_EXECUTION_KINDS) expect(await gate.authorize(kind)).toMatchObject({allowed: false, reason: SANDBOX_UNAVAILABLE});
  });

  it("review REWORK supersedes the source and re-reviews, then delivers the superseding version", { timeout: T }, async () => {
    const {project, missionId} = authorizedProjectMission();
    await runPreDev(missionId);

    const reason = "WORKSPACE_ISOLATION_EVIDENCE_INSUFFICIENT";
    const builder = new SliceBuilderPort();
    // İlk sürüm (attempt 0) REWORK ister; superseding sürüm (attempt 1) REVIEW_CLEAN.
    const reviewer = new RecordedReviewerPort((ctx) => ctx.attempt === 0 ? {verdict: "REWORK_REQUESTED", reason} : {verdict: "REVIEW_CLEAN"});
    const res = await devReview(project, builder, reviewer, 2).run(SCOPE, project, missionId);

    expect(res.status, JSON.stringify(res)).toBe("DELIVERED");
    if (res.status !== "DELIVERED") throw new Error("unreachable");
    const run = res.run;
    expect(res.reviewRework).toBe(1);

    // İki kaynak sürüm (v0 reddedildi, v1 supersede eder); builder tam iki kez üretti; ikinci sürüm farklı (REWORK dosyası).
    const implCommits = run.evidence.filter(e => e.kind === "IMPLEMENT" && e.exitCode === 0 && e.commitSha).map(e => e.commitSha);
    expect(implCommits).toHaveLength(2);
    expect(implCommits[0]).not.toBe(implCommits[1]);
    expect(builder.builds.map(b => b.attempt)).toEqual([0, 1]);
    // Rework bağlamı gerçek review bulgusunu taşır (runner adım sebebi REVIEW_BLOCKED; spesifik sebep bulgulardadır).
    expect(builder.builds[1].rework?.reason).toBe("REVIEW_BLOCKED");
    expect((builder.builds[1].rework?.findings ?? []).join(" ")).toContain(reason);

    // Review iki kez çağrıldı: attempt 0 REWORK, attempt 1 CLEAN. REVIEW kanıtı bağımsız aktörce.
    expect(reviewer.reviews.map(r => r.attempt)).toEqual([0, 1]);
    const reviewVerdicts = run.evidence.filter(e => e.kind === "REVIEW").map(e => e.verdict);
    expect(reviewVerdicts).toContain("BLOCKED");
    expect(reviewVerdicts).toContain("CLEAN");
    for (const e of run.evidence.filter(e => e.kind === "REVIEW")) expect(e.reviewerIdentity).toBe(REVIEWER_ROLE);

    // Teslim superseding (v1) için hazırlandı: sourceCommit == son head.
    expect(res.delivery.sourceCommit).toBe(run.headSha);
    expect(run.headSha).toBe(implCommits[1]);

    // Ledger rework'ü dürüstçe yansıtır: cycle0 REWORK_REQUESTED(sebepli), cycle1 REVIEW_CLEAN.
    const tl = deriveDevReviewTimeline(run, DEVELOPER_ROLE, REVIEWER_ROLE);
    expect(tl.versions.map(v => v.cycle)).toEqual([0, 1]);
    expect(tl.versions[0].reviewVerdict).toBe("REWORK_REQUESTED");
    expect(tl.versions[0].reviewReason).toContain(reason);
    expect(tl.versions[0].sourceCommit).toBe(implCommits[0]);
    expect(tl.versions[1].reviewVerdict).toBe("REVIEW_CLEAN");
    expect(tl.versions[1].sourceCommit).toBe(implCommits[1]);
    expect(tl.finalVerdict).toBe("REVIEW_CLEAN");

    // Yine PRODUCT_VERIFIED değil; üretilen kod çalıştırılmadı.
    expect(productVerificationOf(run.headSha!, run.evidence).state).toBe("NOT_VERIFIED");
    expect(store.getMission(SCOPE, missionId)?.status).not.toBe("COMPLETE");

    // Ledger taze store'dan replay edilebilir (yapısal zaman çizelgesi gerçek journal'dan türetilir).
    const store2 = new WorkOsStore(dataDir);
    expect(store2.journalHealth().state).toBe("OK");
    const tl2 = deriveDevReviewTimeline(store2.getRun(SCOPE, run.runId)!, DEVELOPER_ROLE, REVIEWER_ROLE);
    expect(tl2).toEqual(tl);
  });

  it("exceeding the review rework bound fails closed: no delivery, run BLOCKED, never auto-clean", { timeout: T }, async () => {
    const {project, missionId} = authorizedProjectMission();
    await runPreDev(missionId);

    const builder = new SliceBuilderPort();
    // Reviewer her zaman REWORK ister; maxRemediations=1 => ilk supersede'den sonra sınır aşılır ve fail-closed olur.
    const reviewer = new RecordedReviewerPort(() => ({verdict: "REWORK_REQUESTED", reason: "NEVER_SUFFICIENT"}));
    const res = await devReview(project, builder, reviewer, 1).run(SCOPE, project, missionId);

    expect(res.status, JSON.stringify(res)).toBe("REVIEW_REWORK_LIMIT_EXCEEDED");
    if (res.status !== "REVIEW_REWORK_LIMIT_EXCEEDED") throw new Error("unreachable");
    const run = res.run;
    expect(run.status).toBe("BLOCKED");
    expect(res.reason).toMatch(/^REVIEW_BLOCKED/);

    // Teslim YOK; hiçbir SOURCE_GENERATION_COMPLETE/PRODUCT_VERIFIED yok; kaynak teslim artefaktı kaydı yok.
    expect(run.deliveryArtifact).toBeUndefined();
    expect(sourceGenerationOf(run).state).not.toBe("SOURCE_GENERATION_COMPLETE");
    expect(fs.existsSync(path.join(dataDir, "deliveries", run.runId))).toBe(false);
    // Hiçbir REVIEW CLEAN kaydı yok (asla kendiliğinden temizlenmedi); mission COMPLETE değil.
    expect(run.evidence.some(e => e.kind === "REVIEW" && e.verdict === "CLEAN")).toBe(false);
    expect(store.getMission(SCOPE, missionId)?.status).not.toBe("COMPLETE");

    // Ledger: sınır aşımı final verdict; hiçbir sürüm CLEAN değil.
    const tl = deriveDevReviewTimeline(run, DEVELOPER_ROLE, REVIEWER_ROLE);
    expect(tl.finalVerdict).toBe("REVIEW_REWORK_LIMIT_EXCEEDED");
    expect(tl.versions.every(v => v.reviewVerdict !== "REVIEW_CLEAN")).toBe(true);
    expect(tl.delivery).toBeNull();
  });
});
