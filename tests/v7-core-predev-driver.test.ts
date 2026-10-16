// //TR: Bu test PRE_DEV driver'ının PRE_DEV fazını YÜRÜTÜLEBİLİR kıldığını kanıtlar: enjekte edilen bir MOCK BuilderPort'tan (KAYITLI yanıtlar; canlı model/ağ/shell YOK) tipli artefakt istenir, MEVCUT doğrulayıcılarla doğrulanır, DRAFT kaydedilir ve YALNIZ APPROVED olduğunda faz ilerler. TaskHub referans özeti üzerinde beş fazın tamamı uçtan uca sürülür; geçersiz/izlenemez yanıt mevcut doğrulayıcılarca REJECTED olur ve İLERLEMEZ; alt rol yalnız ONAYLI üst artefaktları görür; replay eşitliği ve mevcut mission akışları + tüm kapılar sağlam kalır. Kayıtlı yanıtlar test-yazımı yapısal içeriktir (uydurma ürün verisi değil) ve dönen hiçbir kod yürütülmez.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../core/workos/predev/driver.js";
import {ROLE_PROMPTS, composeRolePrompt} from "../core/workos/predev/role-prompts.js";
import {PRE_DEV_ROLE_IDS, PRE_DEV_ROLE_MAP, ARTIFACT_KINDS} from "../core/workos/predev/types.js";
import type {ArtifactKind} from "../core/workos/predev/types.js";
import {TASKHUB_BRIEF} from "../core/workos/predev/fixtures/taskhub-brief.js";

const SCOPE = {tenantId: "t-predev-driver"};
const IMPL = "impl@local.invalid";
const REV = "reviewer@local.invalid";
const EV = ["evd_taskhub_ba_signed"];

// ---- TaskHub için KAYITLI (test-yazımı) yapısal yanıtlar: doğrulayıcılardan geçen, kendi içinde tutarlı, gerçek izlenebilirlik taşıyan içerikler ----
const BA = {
  problem: "Ekipler işi tek yerde görünür kılamıyor; görev durumu, atama ve son tarihler dağınık.",
  stakeholders: ["Ekip üyeleri", "Ekip yöneticileri", "Workspace yöneticisi"],
  goals: [
    {id: "G1", statement: "Kullanıcılar güvenli şekilde oturum açabilsin"},
    {id: "G2", statement: "Kullanıcılar proje/görev oluşturup atayabilsin"},
    {id: "G3", statement: "Görevler durum/öncelik/son tarih taşısın ve kalıcı olsun"},
    {id: "G4", statement: "Pano ilerlemeyi duruma göre göstersin"},
    {id: "G5", statement: "Workspace'ler arası yetkisiz erişim engellensin"}
  ],
  constraints: ["Web tabanlı", "İlişkisel veritabanı", "Parolalar düz metin saklanmamalı"],
  successMetrics: ["ASSUMPTION: sayısal metrik özette bağlanmadı; ilk sürümde aktif kullanım izlenecek"],
  assumptions: ["TaskHub bir iç ekip aracıdır (referans proje)"],
  risks: ["Yetkilendirme sızıntısı workspace izolasyonunu bozabilir"]
};
const REQ = {
  functional: [
    {id: "F1", statement: "E-posta+parola ile oturum açma", acceptanceCriteria: ["geçerli kimlikle oturum açılır"], tracesTo: ["G1"]},
    {id: "F2", statement: "Proje ve görev oluşturma + atama", acceptanceCriteria: ["görev bir üyeye atanabilir"], tracesTo: ["G2"]},
    {id: "F3", statement: "Görev durumu/öncelik/son tarih düzenleme", acceptanceCriteria: ["durum değişikliği kalıcıdır"], tracesTo: ["G3"]},
    {id: "F4", statement: "Pano görevleri duruma göre gösterir", acceptanceCriteria: ["todo/in-progress/done sütunları görünür"], tracesTo: ["G4"]}
  ],
  nonFunctional: [
    {id: "N1", statement: "Workspace verisi tenant-izole", acceptanceCriteria: ["başka workspace verisine erişilemez"], tracesTo: ["G5"]},
    {id: "N2", statement: "Parolalar hash'lenerek saklanır", acceptanceCriteria: ["depoda düz metin parola yok"], tracesTo: ["G1"]}
  ]
};
// İzlenemez (geçersiz) Requirements: tracesTo var olmayan bir goal id'ye (G99) işaret eder -> REQ_TRACEABILITY_BROKEN.
const REQ_UNTRACEABLE = {
  functional: [{id: "F1", statement: "x", acceptanceCriteria: ["y"], tracesTo: ["G99"]}],
  nonFunctional: []
};
const PLAN = {
  scope: [
    {id: "SC1", statement: "Kimlik doğrulama yüzeyi"},
    {id: "SC2", statement: "Proje/görev yönetimi"},
    {id: "SC3", statement: "Ekip panosu"}
  ],
  workPackages: [
    {id: "WP1", title: "Auth servisi", dependsOn: [], estimate: "5d", satisfies: ["F1", "N1", "N2"]},
    {id: "WP2", title: "Proje/görev API", dependsOn: ["WP1"], estimate: "8d", satisfies: ["F2", "F3"]},
    {id: "WP3", title: "Pano UI", dependsOn: ["WP2"], estimate: "5d", satisfies: ["F4"]}
  ],
  milestones: [{id: "M1", title: "Beta", workPackageIds: ["WP1", "WP2", "WP3"]}],
  outOfScope: ["Gerçek-zamanlı sohbet", "Faturalandırma"]
};
const ARCH = {
  components: [
    {id: "C1", name: "AuthService", responsibility: "kimlik doğrulama + oturum", covers: ["SC1"]},
    {id: "C2", name: "TaskApiService", responsibility: "proje/görev CRUD + atama", covers: ["SC2"]},
    {id: "C3", name: "WebBoardUI", responsibility: "pano render", covers: ["SC3"]}
  ],
  techChoices: [
    {choice: "PostgreSQL", rationale: "ilişkisel kalıcılık", alternativesConsidered: ["MySQL"]},
    {choice: "Node/Express", rationale: "ekip becerisi", alternativesConsidered: ["Go"]}
  ],
  dataModel: "users, workspaces, projects, tasks",
  integrations: [],
  infraNeeds: ["yönetilen PostgreSQL"],
  risks: ["OPEN QUESTION: ölçek hedefi özette bağlanmadı"]
};
const UX = {
  screens: [{id: "S1", name: "Login"}, {id: "S2", name: "Proje listesi"}, {id: "S3", name: "Görev panosu"}],
  flows: [{id: "FL1", name: "Oturum aç", steps: ["login aç", "kimlik gir", "panoyu gör"]}],
  components: [{id: "UC1", name: "TaskCard"}, {id: "UC2", name: "StatusColumn"}],
  a11yNotes: ["pano için klavye gezinmesi", "durum değişiminde aria-live"]
};

const VALID_BY_KIND: Record<ArtifactKind, unknown> = {
  BusinessAnalysis: BA, Requirements: REQ, Plan: PLAN, Architecture: ARCH, UxSpec: UX
};

// //TR: MOCK BuilderPort: kayıtlı yanıtları (tür başına kuyruk) döndürür; çağrıları (ve o anki mission bağlamını) yakalar. Canlı model/ağ/shell YOK; yalnız önceden kaydedilmiş JSON metni üretir.
class RecordedBuilder implements BuilderPort {
  readonly calls: Array<{kind: ArtifactKind; rolePrompt: string; context: MissionContext}> = [];
  constructor(private readonly queues: Partial<Record<ArtifactKind, unknown[]>>) {}
  async produce(kind: ArtifactKind, rolePrompt: string, missionContext: MissionContext): Promise<string> {
    this.calls.push({kind, rolePrompt, context: JSON.parse(JSON.stringify(missionContext))});
    const q = this.queues[kind];
    if (!q || q.length === 0) throw new Error(`no recorded response for ${kind}`);
    return JSON.stringify(q.shift());
  }
  lastContextFor(kind: ArtifactKind): MissionContext | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) if (this.calls[i].kind === kind) return this.calls[i].context;
    return undefined;
  }
}

const allValidQueues = (): Partial<Record<ArtifactKind, unknown[]>> => ({
  BusinessAnalysis: [BA], Requirements: [REQ], Plan: [PLAN], Architecture: [ARCH], UxSpec: [UX]
});

let tmp = "";
let store: WorkOsStore;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-predev-drv-")); store = new WorkOsStore(tmp); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

function newMission(): string {
  const p = store.createProject({tenantId: SCOPE.tenantId, orgId: "org1", name: "proj", environmentId: "env-dev", createdBy: IMPL});
  const m = store.createMission({tenantId: SCOPE.tenantId, projectId: p.projectId, title: "Mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: IMPL});
  return m.missionId;
}
function authorize(missionId: string): void {
  store.transitionMission(SCOPE, missionId, "PREFLIGHT", "preflight", IMPL);
  store.transitionMission(SCOPE, missionId, "AUTHORIZED", "authorized", IMPL);
}
function authorizedMission(): string { const m = newMission(); authorize(m); return m; }

// Beş fazı valid kayıtlı yanıtlarla sürer: her fazda produce (DRAFT) -> approveAndAdvance (SUBMITTED->APPROVED->advance).
async function driveAllPhases(driver: PreDevDriver, missionId: string): Promise<void> {
  const order: ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];
  const nextPhase: Record<ArtifactKind, string> = {
    BusinessAnalysis: "REQUIREMENTS", Requirements: "PLANNING", Plan: "ARCHITECTURE", Architecture: "UX_DESIGN", UxSpec: "PRE_DEV_COMPLETE"
  };
  for (const kind of order) {
    const out = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    expect(out.status).toBe("RECORDED");
    if (out.status !== "RECORDED") return;
    expect(out.kind).toBe(kind);
    const adv = driver.approveAndAdvance(SCOPE, missionId, out.artifactId, REV, [`evd_${kind}`]);
    expect(adv.phase).toBe(nextPhase[kind]);
  }
}

describe("PreDevDriver: executable pre-dev over the TaskHub reference brief", () => {
  it("(a) a valid recorded BA validates, records DRAFT, and after APPROVE the phase advances", async () => {
    const missionId = authorizedMission();
    const builder = new RecordedBuilder({BusinessAnalysis: [BA]});
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    const started = driver.start(SCOPE, missionId, IMPL);
    expect(started.phase).toBe("BUSINESS_ANALYSIS");

    const out = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    expect(out.status).toBe("RECORDED");
    if (out.status !== "RECORDED") throw new Error("expected RECORDED");
    expect(out.kind).toBe("BusinessAnalysis");
    expect(store.preDevReadModel(SCOPE, missionId).artifacts.BusinessAnalysis.state).toBe("DRAFT");

    const adv = driver.approveAndAdvance(SCOPE, missionId, out.artifactId, REV, EV);
    expect(adv.phase).toBe("REQUIREMENTS");
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("REQUIREMENTS");
    expect(rm.artifacts.BusinessAnalysis.state).toBe("APPROVED");
    expect(rm.artifacts.BusinessAnalysis.approved).toBe(true);
    // authorRoleId gerçek katalog rolüne eşlenmiş olmalı.
    expect(PRE_DEV_ROLE_MAP.BusinessAnalysis).toContain(rm.artifacts.BusinessAnalysis.authorRoleId);
  });

  it("(b) an untraceable recorded response is REJECTED by the existing validators, recorded honestly, and does NOT advance", async () => {
    const missionId = authorizedMission();
    const builder = new RecordedBuilder({BusinessAnalysis: [BA], Requirements: [REQ_UNTRACEABLE, REQ]});
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    driver.start(SCOPE, missionId, IMPL);
    const ba = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    if (ba.status !== "RECORDED") throw new Error("expected BA RECORDED");
    driver.approveAndAdvance(SCOPE, missionId, ba.artifactId, REV, EV);
    expect(store.preDevReadModel(SCOPE, missionId).phase).toBe("REQUIREMENTS");

    // Untraceable Requirements: validator rejects; honest reason; nothing recorded; no advance.
    const bad = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    expect(bad.status).toBe("REJECTED");
    if (bad.status !== "REJECTED") throw new Error("expected REJECTED");
    expect(bad.reason).toBe("REQ_TRACEABILITY_BROKEN");
    const rmAfterBad = store.preDevReadModel(SCOPE, missionId);
    expect(rmAfterBad.phase).toBe("REQUIREMENTS"); // did not advance
    expect(rmAfterBad.artifacts.Requirements.state).toBe("NOT_STARTED"); // nothing recorded
    expect(store.journalHealth().state).toBe("OK"); // no tampered/invalid entry written

    // Recovery: a valid recorded response now records and advances.
    const good = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    expect(good.status).toBe("RECORDED");
    if (good.status !== "RECORDED") throw new Error("expected RECORDED");
    const adv = driver.approveAndAdvance(SCOPE, missionId, good.artifactId, REV, ["evd_req"]);
    expect(adv.phase).toBe("PLANNING");
  });

  it("(c) a downstream role only sees APPROVED upstream artifacts in its context (not DRAFT)", async () => {
    const missionId = authorizedMission();
    const builder = new RecordedBuilder({BusinessAnalysis: [BA], Requirements: [REQ]});
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    driver.start(SCOPE, missionId, IMPL);
    const ba = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    if (ba.status !== "RECORDED") throw new Error("expected BA RECORDED");

    // While BA is only DRAFT (not approved), it is EXCLUDED from a downstream role's context.
    const ctxDraft = driver.buildMissionContext(SCOPE, missionId, "Requirements");
    expect(ctxDraft.approvedUpstream.BusinessAnalysis).toBeUndefined();

    driver.approveAndAdvance(SCOPE, missionId, ba.artifactId, REV, EV);

    // Once APPROVED, it is INCLUDED (and equals the approved content).
    const ctxApproved = driver.buildMissionContext(SCOPE, missionId, "Requirements");
    expect(ctxApproved.approvedUpstream.BusinessAnalysis).toEqual(BA);

    // The builder actually receives approved-only upstream when producing Requirements.
    const req = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    expect(req.status).toBe("RECORDED");
    const seen = builder.lastContextFor("Requirements");
    expect(seen).toBeDefined();
    expect(Object.keys(seen!.approvedUpstream)).toEqual(["BusinessAnalysis"]);
    expect(seen!.approvedUpstream.BusinessAnalysis).toEqual(BA);
    expect(seen!.brief.projectName).toBe("TaskHub");
    expect(seen!.brief.isReference).toBe(true);
  });

  it("(d) end-to-end across all five phases reaches PRE_DEV_COMPLETE and replays to identical state", async () => {
    const missionId = authorizedMission();
    const builder = new RecordedBuilder(allValidQueues());
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});

    driver.start(SCOPE, missionId, IMPL);
    await driveAllPhases(driver, missionId);

    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("PRE_DEV_COMPLETE");
    for (const k of ARTIFACT_KINDS) {
      expect(rm.artifacts[k].state).toBe("APPROVED");
      expect(rm.artifacts[k].approved).toBe(true);
    }

    // Replay: a fresh store over the same journal reconstructs identical read model.
    const store2 = new WorkOsStore(tmp);
    expect(store2.journalHealth().state).toBe("OK");
    expect(store2.preDevReadModel(SCOPE, missionId)).toEqual(rm);
  });

  it("(e) existing missions/flows and all gates remain intact", async () => {
    // Mission without a pre-dev sequence: honest empty states + existing lifecycle/execution gate unaffected.
    const plain = authorizedMission();
    const rmPlain = store.preDevReadModel(SCOPE, plain);
    expect(rmPlain.active).toBe(false);
    expect(rmPlain.phase).toBe("NOT_STARTED");
    const run = store.createRun({tenantId: SCOPE.tenantId, missionId: plain, executor: {implementer: IMPL, reviewer: REV}, createdBy: IMPL});
    expect(run.status).toBe("QUEUED");
    expect(store.getMission(SCOPE, plain)?.status).toBe("PLANNED");

    // Phase gate: cannot advance while the phase artifact is not APPROVED.
    const missionId = authorizedMission();
    const builder = new RecordedBuilder({BusinessAnalysis: [BA]});
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});
    const started = driver.start(SCOPE, missionId, IMPL);
    const ba = await driver.produceCurrentPhase(SCOPE, missionId, IMPL);
    if (ba.status !== "RECORDED") throw new Error("expected RECORDED");
    expect(() => store.advancePreDevPhase(SCOPE, started.preDevId, "REQUIREMENTS", IMPL)).toThrow(/PREDEV_PHASE_ARTIFACT_NOT_APPROVED/);

    // Independence gate: self-approval (approver === recorder) is rejected by the existing mechanism.
    expect(() => driver.approveAndAdvance(SCOPE, missionId, ba.artifactId, IMPL, EV)).toThrow(/PREDEV_APPROVER_NOT_INDEPENDENT/);
    // Evidence gate: empty evidenceRefs rejected.
    expect(() => driver.approveAndAdvance(SCOPE, missionId, ba.artifactId, REV, [])).toThrow(/PREDEV_APPROVAL_EVIDENCE_REQUIRED/);

    // Mission status untouched by the pre-dev layer.
    expect(store.getMission(SCOPE, missionId)?.status).toBe("AUTHORIZED");
  });
});

describe("PreDevDriver: role-prompt templates are honest pure data", () => {
  it("each template binds a real, non-certified catalog roleId and forbids fabrication", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "registries", "role-definitions.json"), "utf8"));
    const arr: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : (raw.roles ?? raw.roleDefinitions ?? Object.values(raw).find(Array.isArray));
    const byId = new Map(arr.map(r => [r.roleId as string, r]));
    for (const kind of ARTIFACT_KINDS) {
      const t = ROLE_PROMPTS[kind];
      expect(t.kind).toBe(kind);
      expect(PRE_DEV_ROLE_MAP[kind]).toContain(t.roleId); // bound to a mapped role
      const role = byId.get(t.roleId);
      expect(role, `role ${t.roleId} must exist`).toBeDefined();
      expect(role!.proficiencyStatus).not.toBe("CERTIFIED"); // this package certifies nothing
      // Honesty rules present: no-fabrication + an assumption/open-question fallback.
      const joined = t.honestyRules.join(" ");
      expect(joined).toMatch(/UYDURMA/);
      expect(joined).toMatch(/varsay|açık-soru/i);
      expect(t.traceabilityRules.length).toBeGreaterThanOrEqual(1);
    }
    expect(PRE_DEV_ROLE_IDS.length).toBeGreaterThanOrEqual(13);
  });

  it("composeRolePrompt embeds only the provided brief + approved upstream (pure string, no fabrication source)", () => {
    const ctx: MissionContext = {brief: TASKHUB_BRIEF, approvedUpstream: {BusinessAnalysis: BA}};
    const prompt = composeRolePrompt("Requirements", ctx);
    expect(prompt).toContain(ROLE_PROMPTS.Requirements.roleId);
    expect(prompt).toContain("TaskHub");
    expect(prompt).toContain("\"G1\""); // the authorized source goal ids are present
    expect(prompt).toContain("UYDURMA"); // fabrication is forbidden in the prompt text
  });
});
