// //TR: Bu test CORE pre-dev artefakt sözleşmelerini doğrular: her artefakt doğrulayıcısı (geçerli / eksik-alan / kırık-izlenebilirlik), PRE_DEV faz dizisi (yalnız APPROVED'da ilerleme; mevcut mission'lar etkilenmez; mevcut kapılar sağlam), hash zincirli journal'dan replay ve dürüst (sahte veri içermeyen) okuma modeli durumları. Hiçbir rol-ajanı çalıştırılmaz, hiçbir üretilen kod yürütülmez.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {
  validateBusinessAnalysis, validateRequirements, validatePlan, validateArchitecture, validateUxSpec, validateArtifactContent
} from "../core/workos/predev/validators.js";
import {PRE_DEV_ROLE_IDS, PRE_DEV_ROLE_MAP} from "../core/workos/predev/types.js";
import type {ArchitectureContent, BusinessAnalysisContent, PlanContent, RequirementsContent, UxSpecContent} from "../core/workos/predev/types.js";

const SCOPE = {tenantId: "t-predev"};
const IMPL = "impl@local.invalid";
const REV = "reviewer@local.invalid";
const EV = ["evd_0123456789abcdef"];

// ---- Geçerli içerik fikstürleri (yalnız yapı; doğrulayıcılar içeriği uydurmaz) ----
const BA: BusinessAnalysisContent = {
  problem: "Users cannot track orders", stakeholders: ["ops", "customers"],
  goals: [{id: "G1", statement: "Provide live tracking"}, {id: "G2", statement: "Reduce support load"}],
  constraints: ["GDPR"], successMetrics: ["NPS +10"], assumptions: ["carrier API exists"], risks: ["carrier downtime"]
};
const REQ: RequirementsContent = {
  functional: [{id: "F1", statement: "Show live status", acceptanceCriteria: ["status visible <5s"], tracesTo: ["G1"]}],
  nonFunctional: [{id: "N1", statement: "p95 < 300ms", acceptanceCriteria: ["load test passes"], tracesTo: ["G2"]}]
};
const PLAN: PlanContent = {
  scope: [{id: "SC1", statement: "tracking surface"}],
  workPackages: [{id: "WP1", title: "tracking api", dependsOn: [], estimate: "3d", satisfies: ["F1", "N1"]}],
  milestones: [{id: "M1", title: "beta", workPackageIds: ["WP1"]}], outOfScope: ["refunds"]
};
const ARCH: ArchitectureContent = {
  components: [{id: "C1", name: "TrackingService", responsibility: "aggregate carrier events", covers: ["SC1"]}],
  techChoices: [{choice: "Node", rationale: "team skill", alternativesConsidered: ["Go"]}],
  dataModel: "orders, events", integrations: ["carrier API"], infraNeeds: ["queue"], risks: ["rate limits"]
};
const UX: UxSpecContent = {
  screens: [{id: "S1", name: "Order tracking"}], flows: [{id: "FL1", name: "track order", steps: ["open", "see status"]}],
  components: [{id: "UC1", name: "StatusBadge"}], a11yNotes: ["aria-live for status"]
};

let tmp = "";
let store: WorkOsStore;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-predev-")); store = new WorkOsStore(tmp); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

function newMission(risk: "R0" | "R1" = "R0"): string {
  const p = store.createProject({tenantId: SCOPE.tenantId, orgId: "org1", name: "proj", environmentId: "env-dev", createdBy: IMPL});
  const m = store.createMission({tenantId: SCOPE.tenantId, projectId: p.projectId, title: "Mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: risk, createdBy: IMPL});
  return m.missionId;
}
function authorize(missionId: string): void {
  store.transitionMission(SCOPE, missionId, "PREFLIGHT", "preflight", IMPL);
  store.transitionMission(SCOPE, missionId, "AUTHORIZED", "authorized", IMPL);
}
// Bir fazı tam döngüyle tamamlar: record (DRAFT) -> SUBMITTED -> APPROVED (bağımsız aktör + kanıt) -> ilerle.
function completePhase(preDevId: string, kind: "BusinessAnalysis" | "Requirements" | "Plan" | "Architecture" | "UxSpec", content: object, nextPhase: string): void {
  const roleId = PRE_DEV_ROLE_MAP[kind][0];
  const art = store.recordPreDevArtifact(SCOPE, preDevId, {kind, authorRoleId: roleId, content: content as never}, IMPL);
  store.transitionPreDevArtifact(SCOPE, preDevId, art.id, "SUBMITTED", {}, IMPL);
  store.transitionPreDevArtifact(SCOPE, preDevId, art.id, "APPROVED", {evidenceRefs: EV}, REV);
  store.advancePreDevPhase(SCOPE, preDevId, nextPhase as never, REV);
}

describe("pre-dev artifact validators", () => {
  it("BusinessAnalysis: valid / missing-field", () => {
    expect(validateBusinessAnalysis(BA).ok).toBe(true);
    const {goals, ...noGoals} = BA; void goals;
    expect(validateBusinessAnalysis(noGoals).ok).toBe(false);
    expect(validateBusinessAnalysis({...BA, goals: []}).ok).toBe(false);
    expect(validateBusinessAnalysis({...BA, goals: [{id: "G1", statement: "a"}, {id: "G1", statement: "b"}]}).ok).toBe(false); // duplicate ids
  });
  it("Requirements: valid / missing-field / broken-traceability", () => {
    expect(validateRequirements(REQ, BA).ok).toBe(true);
    expect(validateRequirements({functional: [], nonFunctional: []}, BA).ok).toBe(false); // missing functional
    const broken = {...REQ, functional: [{...REQ.functional[0], tracesTo: ["G9"]}]};
    const r = validateRequirements(broken, BA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toBe("REQ_TRACEABILITY_BROKEN");
  });
  it("Plan: valid / missing-field / broken requirement reference + coverage", () => {
    expect(validatePlan(PLAN, REQ).ok).toBe(true);
    expect(validatePlan({...PLAN, workPackages: []}, REQ).ok).toBe(false);
    const dangling = validatePlan({...PLAN, workPackages: [{...PLAN.workPackages[0], satisfies: ["F9"]}]}, REQ);
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.errors).toBe("PLAN_WP_REQUIREMENT_BROKEN");
    const uncovered = validatePlan({...PLAN, workPackages: [{...PLAN.workPackages[0], satisfies: ["F1"]}]}, REQ); // N1 uncovered
    expect(uncovered.ok).toBe(false);
    if (!uncovered.ok) expect(uncovered.errors).toBe("PLAN_REQUIREMENT_NOT_COVERED");
  });
  it("Architecture: valid / missing-field / broken scope coverage", () => {
    expect(validateArchitecture(ARCH, PLAN).ok).toBe(true);
    expect(validateArchitecture({...ARCH, techChoices: []}, PLAN).ok).toBe(false);
    const broken = validateArchitecture({...ARCH, components: [{...ARCH.components[0], covers: ["SC9"]}]}, PLAN);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors).toBe("ARCH_SCOPE_REFERENCE_BROKEN");
  });
  it("UxSpec: valid / missing-field", () => {
    expect(validateUxSpec(UX).ok).toBe(true);
    const {a11yNotes, ...noA11y} = UX; void a11yNotes;
    expect(validateUxSpec(noA11y).ok).toBe(false);
    expect(validateUxSpec({...UX, screens: []}).ok).toBe(false);
  });
  it("validators never invent data: unknown extra fields rejected", () => {
    expect(validateBusinessAnalysis({...BA, extra: 1}).ok).toBe(false);
    expect(validateUxSpec({...UX, extra: 1}).ok).toBe(false);
  });
  it("dispatcher requires upstream content for traceable kinds (no fabrication)", () => {
    expect(validateArtifactContent("Requirements", REQ).ok).toBe(false); // no BA upstream -> fails, not invented
    expect(validateArtifactContent("Requirements", REQ, {businessAnalysis: BA}).ok).toBe(true);
    expect(validateArtifactContent("BusinessAnalysis", BA).ok).toBe(true);
  });
});

describe("PRE_DEV phase sequence", () => {
  it("advances only when the phase artifact is APPROVED; records honest states; replays", () => {
    const missionId = newMission();
    authorize(missionId);
    const seq = store.openPreDevSequence(SCOPE, missionId, IMPL);
    expect(seq.phase).toBe("AUTHORIZED");

    // AUTHORIZED -> BUSINESS_ANALYSIS: entry phase, no artifact gate.
    store.advancePreDevPhase(SCOPE, seq.preDevId, "BUSINESS_ANALYSIS", IMPL);
    const art = store.recordPreDevArtifact(SCOPE, seq.preDevId, {kind: "BusinessAnalysis", authorRoleId: PRE_DEV_ROLE_MAP.BusinessAnalysis[0], content: BA}, IMPL);
    expect(art.state).toBe("DRAFT");

    // Cannot advance while BA not APPROVED.
    expect(() => store.advancePreDevPhase(SCOPE, seq.preDevId, "REQUIREMENTS", IMPL)).toThrow(/PREDEV_PHASE_ARTIFACT_NOT_APPROVED/);

    store.transitionPreDevArtifact(SCOPE, seq.preDevId, art.id, "SUBMITTED", {}, IMPL);
    // Self-approval rejected.
    expect(() => store.transitionPreDevArtifact(SCOPE, seq.preDevId, art.id, "APPROVED", {evidenceRefs: EV}, IMPL)).toThrow(/PREDEV_APPROVER_NOT_INDEPENDENT/);
    // Evidence-less approval rejected.
    expect(() => store.transitionPreDevArtifact(SCOPE, seq.preDevId, art.id, "APPROVED", {}, REV)).toThrow(/PREDEV_APPROVAL_EVIDENCE_REQUIRED/);
    // Proper approval.
    const approved = store.transitionPreDevArtifact(SCOPE, seq.preDevId, art.id, "APPROVED", {evidenceRefs: EV}, REV);
    expect(approved.state).toBe("APPROVED");
    expect(approved.approvedBy).toBe(REV);

    // Now advance works.
    store.advancePreDevPhase(SCOPE, seq.preDevId, "REQUIREMENTS", REV);
    completePhase(seq.preDevId, "Requirements", REQ, "PLANNING");
    completePhase(seq.preDevId, "Plan", PLAN, "ARCHITECTURE");
    completePhase(seq.preDevId, "Architecture", ARCH, "UX_DESIGN");
    completePhase(seq.preDevId, "UxSpec", UX, "PRE_DEV_COMPLETE");

    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.active).toBe(true);
    expect(rm.phase).toBe("PRE_DEV_COMPLETE");
    for (const k of ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"] as const) {
      expect(rm.artifacts[k].state).toBe("APPROVED");
      expect(rm.artifacts[k].approved).toBe(true);
    }

    // Replay: a fresh store over the same journal reconstructs identical state.
    const store2 = new WorkOsStore(tmp);
    expect(store2.journalHealth().state).toBe("OK");
    const rm2 = store2.preDevReadModel(SCOPE, missionId);
    expect(rm2).toEqual(rm);
    expect(store2.getPreDevSequence(SCOPE, missionId)?.phase).toBe("PRE_DEV_COMPLETE");
  });

  it("recording an artifact out of its phase is rejected; wrong author role rejected", () => {
    const missionId = newMission();
    authorize(missionId);
    const seq = store.openPreDevSequence(SCOPE, missionId, IMPL);
    store.advancePreDevPhase(SCOPE, seq.preDevId, "BUSINESS_ANALYSIS", IMPL);
    // Requirements cannot be recorded while in BUSINESS_ANALYSIS phase.
    expect(() => store.recordPreDevArtifact(SCOPE, seq.preDevId, {kind: "Requirements", authorRoleId: PRE_DEV_ROLE_MAP.Requirements[0], content: REQ as never}, IMPL)).toThrow(/PREDEV_ENTRY_REJECTED/);
    // BA with an unmapped author role is rejected.
    expect(() => store.recordPreDevArtifact(SCOPE, seq.preDevId, {kind: "BusinessAnalysis", authorRoleId: "UASCO-9999", content: BA}, IMPL)).toThrow(/PREDEV_AUTHOR_ROLE_NOT_MAPPED/);
  });

  it("rejected artifact can be superseded by a new version", () => {
    const missionId = newMission();
    authorize(missionId);
    const seq = store.openPreDevSequence(SCOPE, missionId, IMPL);
    store.advancePreDevPhase(SCOPE, seq.preDevId, "BUSINESS_ANALYSIS", IMPL);
    const a1 = store.recordPreDevArtifact(SCOPE, seq.preDevId, {kind: "BusinessAnalysis", authorRoleId: PRE_DEV_ROLE_MAP.BusinessAnalysis[0], content: BA}, IMPL);
    store.transitionPreDevArtifact(SCOPE, seq.preDevId, a1.id, "SUBMITTED", {}, IMPL);
    store.transitionPreDevArtifact(SCOPE, seq.preDevId, a1.id, "REJECTED", {reason: "incomplete goals"}, REV);
    const a2 = store.recordPreDevArtifact(SCOPE, seq.preDevId, {kind: "BusinessAnalysis", authorRoleId: PRE_DEV_ROLE_MAP.BusinessAnalysis[0], content: BA, supersedes: a1.id}, IMPL);
    expect(a2.version).toBe(2);
    expect(a2.supersedes).toBe(a1.id);
  });
});

describe("backward compatibility & existing gates", () => {
  it("missions without a pre-dev sequence report honest empty states and follow the existing path", () => {
    const missionId = newMission();
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.active).toBe(false);
    expect(rm.phase).toBe("NOT_STARTED");
    for (const k of ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"] as const) {
      expect(rm.artifacts[k].state).toBe("NOT_STARTED");
      expect(rm.artifacts[k].artifactId).toBeNull();
    }
    // Existing mission lifecycle + execution gate unaffected: run creation still works on an AUTHORIZED mission.
    authorize(missionId);
    const run = store.createRun({tenantId: SCOPE.tenantId, missionId, executor: {implementer: IMPL, reviewer: REV}, createdBy: IMPL});
    expect(run.status).toBe("QUEUED");
    expect(store.getMission(SCOPE, missionId)?.status).toBe("PLANNED"); // createRun advances AUTHORIZED->PLANNED as before
  });

  it("opening a pre-dev sequence does not mutate mission status; second open conflicts", () => {
    const missionId = newMission();
    authorize(missionId);
    store.openPreDevSequence(SCOPE, missionId, IMPL);
    expect(store.getMission(SCOPE, missionId)?.status).toBe("AUTHORIZED"); // mission untouched by pre-dev layer
    expect(() => store.openPreDevSequence(SCOPE, missionId, IMPL)).toThrow(/PREDEV_SEQUENCE_EXISTS/);
  });

  it("pre-dev sequence is tenant-isolated", () => {
    const missionId = newMission();
    authorize(missionId);
    store.openPreDevSequence(SCOPE, missionId, IMPL);
    expect(store.getPreDevSequence({tenantId: "other"}, missionId)).toBeUndefined();
    expect(store.preDevReadModel({tenantId: "other"}, missionId).active).toBe(false);
  });
});

describe("role mapping honesty (catalog is not modified, no role certified)", () => {
  it("every mapped authorRoleId exists in the catalog and is not marked certified by this package", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "registries", "role-definitions.json"), "utf8"));
    const arr: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : (raw.roles ?? raw.roleDefinitions ?? Object.values(raw).find(Array.isArray));
    const byId = new Map(arr.map(r => [r.roleId as string, r]));
    expect(PRE_DEV_ROLE_IDS.length).toBeGreaterThanOrEqual(13);
    for (const id of PRE_DEV_ROLE_IDS) {
      const role = byId.get(id);
      expect(role, `role ${id} must exist`).toBeDefined();
      // This package references roleIds read-only; it never certifies a role.
      expect(role!.proficiencyStatus).not.toBe("CERTIFIED");
    }
  });
});
