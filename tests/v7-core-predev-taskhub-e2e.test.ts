// //TR: Bu test, TaskHub referans projesinin GERÇEK pre-dev artefakt setini (core/workos/predev/fixtures/taskhub/ altında, her biri ilgili UASCO role-builder rolünün gerçek çıktısı) GERÇEK ürün kodundan geçirir: GERÇEK PreDevDriver (driver.ts), GERÇEK doğrulayıcılar (validateArtifactContent) ve GERÇEK WorkOsStore/journal. Driver/validator/store YENİDEN YAZILMAZ veya stub'lanmaz; yalnız BuilderPort enjekte edilir ve produce(kind) ilgili fixture'ı döndürür. Beş faz uçtan uca sürülür (start -> produce=DRAFT -> submit(recorder) -> approve(bağımsız approver, boş olmayan evidenceRefs) -> advance); faz YALNIZ APPROVED sonrası ilerler ve dizi PRE_DEV'in sonuna (UxSpec APPROVED -> PRE_DEV_COMPLETE) ulaşır. İzlenebilirliği bilerek bozulmuş bir varyant GERÇEK doğrulayıcıca REJECTED olur ve İLERLEMEZ; alt rol yalnız ONAYLI üst artefaktları görür; journal replay eşitliği doğrulanır. Dönen hiçbir kod yürütülmez; bu yalnız PRE-DEV fazıdır.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../core/workos/predev/driver.js";
import {validateArtifactContent, type UpstreamContents} from "../core/workos/predev/validators.js";
import {ARTIFACT_KINDS, PRE_DEV_ROLE_MAP} from "../core/workos/predev/types.js";
import type {
  ArtifactKind, BusinessAnalysisContent, PlanContent, RequirementsContent
} from "../core/workos/predev/types.js";
import {TASKHUB_BRIEF} from "../core/workos/predev/fixtures/taskhub-brief.js";
import {
  TASKHUB_ARTIFACTS, TASKHUB_BUSINESS_ANALYSIS, TASKHUB_REQUIREMENTS, TASKHUB_PLAN
} from "../core/workos/predev/fixtures/taskhub/index.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const SCOPE = {tenantId: "t-taskhub-e2e"};
const RECORDER = "implementer@local.invalid"; // kaydeden (recorder) kimliği; submit bu kimlikten yapılır.
const APPROVER = "reviewer@local.invalid";    // kaydedenden BAĞIMSIZ onaylayan kimliği.
const KIND_ORDER: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];
const NEXT_PHASE: Readonly<Record<ArtifactKind, string>> = {
  BusinessAnalysis: "REQUIREMENTS", Requirements: "PLANNING", Plan: "ARCHITECTURE", Architecture: "UX_DESIGN", UxSpec: "PRE_DEV_COMPLETE"
};

// //TR: Enjekte edilen BuilderPort: tür başına STEP-1 TaskHub fixture'ını JSON metni olarak döndürür ve o anki mission bağlamını yakalar. Canlı model/ağ/shell YOK; driver bu metni GERÇEK doğrulayıcıdan geçirir.
class TaskHubFixtureBuilder implements BuilderPort {
  readonly calls: Array<{kind: ArtifactKind; context: MissionContext}> = [];
  constructor(private readonly override: Partial<Record<ArtifactKind, unknown>> = {}) {}
  async produce(kind: ArtifactKind, _rolePrompt: string, missionContext: MissionContext): Promise<string> {
    this.calls.push({kind, context: JSON.parse(JSON.stringify(missionContext))});
    const content = kind in this.override ? this.override[kind] : TASKHUB_ARTIFACTS[kind];
    return JSON.stringify(content);
  }
  lastContextFor(kind: ArtifactKind): MissionContext | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) if (this.calls[i].kind === kind) return this.calls[i].context;
    return undefined;
  }
}

let tmp = "";
let store: WorkOsStore;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-taskhub-e2e-")); store = new WorkOsStore(tmp); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

function authorizedMission(): string {
  const p = store.createProject({tenantId: SCOPE.tenantId, orgId: "org1", name: "TaskHub", environmentId: "env-dev", createdBy: RECORDER});
  const m = store.createMission({tenantId: SCOPE.tenantId, projectId: p.projectId, title: "TaskHub pre-dev", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
  store.transitionMission(SCOPE, m.missionId, "PREFLIGHT", "preflight", RECORDER);
  store.transitionMission(SCOPE, m.missionId, "AUTHORIZED", "authorized", RECORDER);
  return m.missionId;
}

// //TR: Bağımsız doğrulama: STEP-1 fixture'larının GERÇEK doğrulayıcı (validateArtifactContent) + gerçek üst içeriklerle geçtiğini, fixture seti kendi içinde izlenebilir olduğu için kanıtlar.
function upstreamFor(kind: ArtifactKind): UpstreamContents {
  if (kind === "Requirements") return {businessAnalysis: TASKHUB_BUSINESS_ANALYSIS as BusinessAnalysisContent};
  if (kind === "Plan") return {requirements: TASKHUB_REQUIREMENTS as RequirementsContent};
  if (kind === "Architecture") return {plan: TASKHUB_PLAN as PlanContent};
  return {};
}

describe("TaskHub pre-dev E2E over the REAL driver/validators/store", () => {
  it("each genuine TaskHub fixture passes the REAL validator with its real upstream", () => {
    for (const kind of KIND_ORDER) {
      const v = validateArtifactContent(kind, TASKHUB_ARTIFACTS[kind], upstreamFor(kind));
      expect(v.ok, `${kind} must validate (got ${v.ok ? "" : v.errors})`).toBe(true);
    }
  });

  it("drives all five phases end-to-end; advances ONLY after APPROVED; reaches PRE_DEV_COMPLETE with UxSpec APPROVED", async () => {
    const missionId = authorizedMission();
    const builder = new TaskHubFixtureBuilder();
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    const started = driver.start(SCOPE, missionId, RECORDER);
    expect(started.phase).toBe("BUSINESS_ANALYSIS");

    for (const kind of KIND_ORDER) {
      const phaseBefore = store.preDevReadModel(SCOPE, missionId).phase;

      // produce: GERÇEK doğrulayıcı + DRAFT kaydı.
      const out = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
      expect(out.status, `${kind} must RECORD`).toBe("RECORDED");
      if (out.status !== "RECORDED") throw new Error("unreachable");
      expect(out.kind).toBe(kind);

      const rmDraft = store.preDevReadModel(SCOPE, missionId);
      expect(rmDraft.artifacts[kind].state).toBe("DRAFT");
      expect(rmDraft.phase).toBe(phaseBefore); // produce DRAFT fazı ilerletmez
      // authorRoleId gerçek (certified-değil) katalog rolüne eşlenmiş olmalı.
      expect(PRE_DEV_ROLE_MAP[kind]).toContain(rmDraft.artifacts[kind].authorRoleId);

      // GATE: APPROVED olmadan faz ilerleyemez (GERÇEK store kapısı).
      expect(() => store.advancePreDevPhase(SCOPE, started.preDevId, NEXT_PHASE[kind] as never, RECORDER))
        .toThrow(/PREDEV_PHASE_ARTIFACT_NOT_APPROVED/);
      expect(store.preDevReadModel(SCOPE, missionId).phase).toBe(phaseBefore);

      // submit(recorder) -> approve(bağımsız approver, boş olmayan evidenceRefs) -> advance (GERÇEK mekanizma).
      const adv = driver.approveAndAdvance(SCOPE, missionId, out.artifactId, APPROVER, [`evd_taskhub_${kind}`]);
      expect(adv.phase).toBe(NEXT_PHASE[kind]);

      const rmApproved = store.preDevReadModel(SCOPE, missionId);
      expect(rmApproved.artifacts[kind].state).toBe("APPROVED");
      expect(rmApproved.artifacts[kind].approved).toBe(true);
      expect(rmApproved.artifacts[kind].evidenceRefs).toContain(`evd_taskhub_${kind}`);
    }

    // PRE_DEV'in sonu: UxSpec APPROVED ve faz PRE_DEV_COMPLETE.
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("PRE_DEV_COMPLETE");
    expect(rm.artifacts.UxSpec.state).toBe("APPROVED");
    for (const kind of ARTIFACT_KINDS) expect(rm.artifacts[kind].approved).toBe(true);

    // Mevcut mission durumu pre-dev katmanınca DEĞİŞTİRİLMEZ.
    expect(store.getMission(SCOPE, missionId)?.status).toBe("AUTHORIZED");
  });

  it("a traceability-broken variant of Requirements is REJECTED by the REAL validator and does NOT advance (negative path), then recovers", async () => {
    const missionId = authorizedMission();
    // Genuine Requirements'ın izlenebilirliğini bilerek boz: tracesTo var olmayan bir goal id'ye (G999) işaret etsin.
    const broken: RequirementsContent = JSON.parse(JSON.stringify(TASKHUB_REQUIREMENTS));
    broken.functional[0].tracesTo = ["G999"];
    const builder = new TaskHubFixtureBuilder({Requirements: broken});
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    driver.start(SCOPE, missionId, RECORDER);
    const ba = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
    if (ba.status !== "RECORDED") throw new Error("expected BA RECORDED");
    driver.approveAndAdvance(SCOPE, missionId, ba.artifactId, APPROVER, ["evd_taskhub_ba"]);
    expect(store.preDevReadModel(SCOPE, missionId).phase).toBe("REQUIREMENTS");

    // GERÇEK doğrulayıcı reddeder; hiçbir geçersiz artefakt kaydedilmez; faz ilerlemez; journal sağlam.
    const bad = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
    expect(bad.status).toBe("REJECTED");
    if (bad.status !== "REJECTED") throw new Error("expected REJECTED");
    expect(bad.reason).toBe("REQ_TRACEABILITY_BROKEN");
    const rmBad = store.preDevReadModel(SCOPE, missionId);
    expect(rmBad.phase).toBe("REQUIREMENTS");
    expect(rmBad.artifacts.Requirements.state).toBe("NOT_STARTED");
    expect(store.journalHealth().state).toBe("OK");

    // Kurtarma: artık genuine fixture üretilir (override temizlenir) ve ilerler.
    const good = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: new TaskHubFixtureBuilder()});
    const rec = await good.produceCurrentPhase(SCOPE, missionId, RECORDER);
    expect(rec.status).toBe("RECORDED");
    if (rec.status !== "RECORDED") throw new Error("expected RECORDED");
    const adv = good.approveAndAdvance(SCOPE, missionId, rec.artifactId, APPROVER, ["evd_taskhub_req"]);
    expect(adv.phase).toBe("PLANNING");
  });

  it("downstream context contains ONLY APPROVED upstream artifacts (DRAFT upstream excluded)", async () => {
    const missionId = authorizedMission();
    const builder = new TaskHubFixtureBuilder();
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    driver.start(SCOPE, missionId, RECORDER);
    const ba = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
    if (ba.status !== "RECORDED") throw new Error("expected BA RECORDED");

    // BA yalnız DRAFT iken alt rol bağlamından DIŞLANIR.
    expect(driver.buildMissionContext(SCOPE, missionId, "Requirements").approvedUpstream.BusinessAnalysis).toBeUndefined();
    driver.approveAndAdvance(SCOPE, missionId, ba.artifactId, APPROVER, ["evd_taskhub_ba"]);
    // APPROVED sonrası DAHİL edilir ve onaylı içeriğe eşittir.
    expect(driver.buildMissionContext(SCOPE, missionId, "Requirements").approvedUpstream.BusinessAnalysis).toEqual(TASKHUB_BUSINESS_ANALYSIS);

    const req = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
    if (req.status !== "RECORDED") throw new Error("expected REQ RECORDED");
    const seenReq = builder.lastContextFor("Requirements");
    expect(Object.keys(seenReq!.approvedUpstream)).toEqual(["BusinessAnalysis"]);
    expect(seenReq!.brief.projectName).toBe("TaskHub");
    expect(seenReq!.brief.isReference).toBe(true);

    // Plan fazına kadar sürünce Architecture bağlamı tam olarak üç ONAYLI üstü taşır (hepsi APPROVED).
    driver.approveAndAdvance(SCOPE, missionId, req.artifactId, APPROVER, ["evd_taskhub_req"]);
    const plan = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
    if (plan.status !== "RECORDED") throw new Error("expected PLAN RECORDED");
    driver.approveAndAdvance(SCOPE, missionId, plan.artifactId, APPROVER, ["evd_taskhub_plan"]);
    const arch = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
    if (arch.status !== "RECORDED") throw new Error("expected ARCH RECORDED");
    const seenArch = builder.lastContextFor("Architecture");
    expect(new Set(Object.keys(seenArch!.approvedUpstream))).toEqual(new Set(["BusinessAnalysis", "Requirements", "Plan"]));
    expect(seenArch!.approvedUpstream.Plan).toEqual(TASKHUB_PLAN);
  });

  it("journal replay reconstructs an identical pre-dev read model (durable, hash-chained journal)", async () => {
    const missionId = authorizedMission();
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: new TaskHubFixtureBuilder()});
    driver.start(SCOPE, missionId, RECORDER);
    for (const kind of KIND_ORDER) {
      const out = await driver.produceCurrentPhase(SCOPE, missionId, RECORDER);
      if (out.status !== "RECORDED") throw new Error(`expected ${kind} RECORDED`);
      driver.approveAndAdvance(SCOPE, missionId, out.artifactId, APPROVER, [`evd_taskhub_${kind}`]);
    }
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("PRE_DEV_COMPLETE");

    // Aynı journal üzerinden taze bir store birebir aynı okuma modelini yeniden kurar.
    const store2 = new WorkOsStore(tmp);
    expect(store2.journalHealth().state).toBe("OK");
    expect(store2.preDevReadModel(SCOPE, missionId)).toEqual(rm);
  });
});
