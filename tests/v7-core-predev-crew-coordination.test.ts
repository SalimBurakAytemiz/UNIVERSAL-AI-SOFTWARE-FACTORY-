// //TR: Bu test CORE-5 crew/koordinasyon katmanını GERÇEK ürün kodundan geçirir: GERÇEK PreDevDriver (driver.ts), GERÇEK doğrulayıcılar (validateArtifactContent) ve GERÇEK WorkOsStore/journal; yalnız BuilderPort (TaskHub fixture'ı döndüren) ve ReworkDecider enjekte edilir. Driver/validator/store YENİDEN YAZILMAZ veya stub'lanmaz. Tam BA->Req->Plan->Arch->UX crew koşusu GERÇEK rol kimliklerini atar, YALNIZ bağımsız onay sonrası ilerler, koordinasyon ledger'ını (gerçek kayıtlardan türetilmiş) üretir ve sınırlı downstream rework döngüsünü (bir downstream rework talebi üst fazı yeniden açar, artefaktı supersede eder, yeniden onaylar, yeniden ilerler) VE rework sınırının aşılmasının fail-closed olduğunu doğrular. Dürüst: bu yalnız kaynak düzeyinde koordinasyon katmanıdır; üretilen hiçbir kod yürütülmez; hiçbir mission PRODUCT_VERIFIED'a ulaşmaz.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../core/workos/predev/driver.js";
import {PRE_DEV_ROLE_MAP, PRE_DEV_ROLE_IDS, ARTIFACT_KINDS} from "../core/workos/predev/types.js";
import type {ArtifactKind} from "../core/workos/predev/types.js";
import {TASKHUB_BRIEF} from "../core/workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
import {buildCrewPlan, bindingForKind, canAssignmentTransition, advanceAssignment, newAssignment, TASK_ASSIGNMENT_STATES} from "../core/workos/crew/assignment.js";
import {CrewCoordinator, CrewCoordinatorError, type ReworkDecider, type ReworkDecisionInput, type CrewStore} from "../core/workos/crew/coordinator.js";

const SCOPE = {tenantId: "t-crew-core5"};
const RECORDER = "implementer@local.invalid";
const APPROVER = "reviewer@local.invalid";
const KIND_ORDER: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];

// //TR: Enjekte edilen BuilderPort: tür başına GERÇEK TaskHub fixture'ını JSON metni olarak döndürür ve bağlamı yakalar. Canlı model/ağ/shell YOK; driver/koordinatör bu metni GERÇEK doğrulayıcıdan geçirir.
class TaskHubFixtureBuilder implements BuilderPort {
  readonly calls: Array<{kind: ArtifactKind; context: MissionContext}> = [];
  async produce(kind: ArtifactKind, _rolePrompt: string, missionContext: MissionContext): Promise<string> {
    this.calls.push({kind, context: JSON.parse(JSON.stringify(missionContext))});
    return JSON.stringify(TASKHUB_ARTIFACTS[kind]);
  }
  countFor(kind: ArtifactKind): number { return this.calls.filter(c => c.kind === kind).length; }
}

// //TR: Deterministik rework kararları. accept dışındaki her karar sabit bir sebep taşır (uydurma değil).
class AcceptAllDecider implements ReworkDecider {
  decide(): {accept: true} { return {accept: true}; }
}
// //TR: Belirli bir tür için İLK adayı (attempt 0) downstream yetersiz bulur, sonra kabul eder (tek rework).
class ReworkOnceDecider implements ReworkDecider {
  constructor(private readonly target: ArtifactKind, private readonly reason: string) {}
  decide(input: ReworkDecisionInput): {accept: true} | {accept: false; reason: string} {
    if (input.kind === this.target && input.attempt === 0) return {accept: false, reason: this.reason};
    return {accept: true};
  }
}
// //TR: Belirli bir türü HER zaman yetersiz bulur (sınır aşımını zorlamak için).
class AlwaysReworkDecider implements ReworkDecider {
  constructor(private readonly target: ArtifactKind, private readonly reason: string) {}
  decide(input: ReworkDecisionInput): {accept: true} | {accept: false; reason: string} {
    if (input.kind === this.target) return {accept: false, reason: this.reason};
    return {accept: true};
  }
}

let tmp = "";
let store: WorkOsStore;
let tick = 0;
const now = () => `2026-10-16T00:00:${String(tick++ % 60).padStart(2, "0")}.000Z`;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-crew-core5-")); store = new WorkOsStore(tmp); tick = 0; });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows: dosya kısa süre tutulabilir */ } });

function authorizedMission(): string {
  const p = store.createProject({tenantId: SCOPE.tenantId, orgId: "org1", name: "TaskHub", environmentId: "env-dev", createdBy: RECORDER});
  const m = store.createMission({tenantId: SCOPE.tenantId, projectId: p.projectId, title: "TaskHub crew", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
  store.transitionMission(SCOPE, m.missionId, "PREFLIGHT", "preflight", RECORDER);
  store.transitionMission(SCOPE, m.missionId, "AUTHORIZED", "authorized", RECORDER);
  return m.missionId;
}

function coordinator(decider: ReworkDecider, maxRework: number, builder?: TaskHubFixtureBuilder): {coord: CrewCoordinator; builder: TaskHubFixtureBuilder} {
  const b = builder ?? new TaskHubFixtureBuilder();
  const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: b});
  const coord = new CrewCoordinator({store: store as unknown as CrewStore, driver, plan: buildCrewPlan(), brief: TASKHUB_BRIEF, builder: b, decider, maxReworkPerPhase: maxRework, recorder: RECORDER, approver: APPROVER, now});
  return {coord, builder: b};
}

describe("CrewPlan assignment (real role ids, honest state machine)", () => {
  it("binds the real ~13 first-release role ids to the pre-dev phases without adding/certifying any role", () => {
    const plan = buildCrewPlan();
    expect(plan.phases.map(p => p.kind)).toEqual([...KIND_ORDER]);
    for (const kind of KIND_ORDER) {
      const b = bindingForKind(plan, kind);
      expect(b.roleIds).toEqual(PRE_DEV_ROLE_MAP[kind]);
      expect(b.primaryRoleId).toBe(PRE_DEV_ROLE_MAP[kind][0]);
    }
    // Downstream zinciri: her faz bir sonrakinin primary rolüne işaret eder; son faz (UxSpec) null (dev/review kancası).
    expect(bindingForKind(plan, "Plan").downstreamRoleId).toBe(PRE_DEV_ROLE_MAP.Architecture[0]);
    expect(bindingForKind(plan, "UxSpec").downstreamRoleId).toBeNull();
    expect(new Set(plan.roleIds)).toEqual(new Set(PRE_DEV_ROLE_IDS));
    expect(plan.roleIds.length).toBe(13);
    expect(plan.reservedDownstreamPhaseHooks).toEqual(["DEVELOPMENT", "REVIEW"]);
  });

  it("the referenced role ids exist in the REAL registry and NONE is certified (unchanged catalog status)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const reg = JSON.parse(fs.readFileSync(path.join(here, "..", "registries", "role-definitions.json"), "utf8"));
    const arr: Array<Record<string, unknown>> = Array.isArray(reg) ? reg : (reg.roles ?? reg.definitions ?? Object.values(reg).find((v: unknown) => Array.isArray(v)) as Array<Record<string, unknown>>);
    for (const id of PRE_DEV_ROLE_IDS) {
      const r = arr.find(x => x.id === id || x.roleId === id);
      expect(r, `role ${id} must exist in registry`).toBeTruthy();
      expect(r!.proficiencyStatus, `role ${id} must NOT be certified`).not.toBe("CERTIFIED");
      expect(r!.runtimeStatus).not.toBe("CERTIFIED");
    }
  });

  it("TaskAssignment state machine allows only the contracted transitions and fails closed otherwise", () => {
    expect(TASK_ASSIGNMENT_STATES).toContain("REWORK_REQUESTED");
    const a0 = newAssignment(bindingForKind(buildCrewPlan(), "Plan"));
    expect(a0.state).toBe("ASSIGNED");
    expect(canAssignmentTransition("SUBMITTED", "APPROVED")).toBe(true);
    expect(canAssignmentTransition("SUBMITTED", "REWORK_REQUESTED")).toBe(true);
    expect(canAssignmentTransition("REWORK_REQUESTED", "IN_PROGRESS")).toBe(true);
    expect(canAssignmentTransition("APPROVED", "IN_PROGRESS")).toBe(false);
    expect(canAssignmentTransition("ASSIGNED", "APPROVED")).toBe(false);
    expect(() => advanceAssignment({...a0, state: "APPROVED"}, "IN_PROGRESS")).toThrow(/CREW_ASSIGNMENT_ILLEGAL/);
  });
});

describe("CrewCoordinator over the REAL driver/validators/store with a mock BuilderPort", () => {
  it("drives the full BA->Req->Plan->Arch->UX crew run; advances ONLY on independent approval; records the ledger", async () => {
    const missionId = authorizedMission();
    const {coord} = coordinator(new AcceptAllDecider(), 2);
    const res = await coord.run(SCOPE, missionId);
    expect(res.status).toBe("PRE_DEV_COMPLETE");
    if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");

    // GERÇEK store: tüm fazlar APPROVED ve dizi PRE_DEV_COMPLETE.
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("PRE_DEV_COMPLETE");
    for (const kind of ARTIFACT_KINDS) {
      expect(rm.artifacts[kind].approved, `${kind} approved`).toBe(true);
      expect(res.assignments[kind].state).toBe("APPROVED");
      expect(res.assignments[kind].roleId).toBe(PRE_DEV_ROLE_MAP[kind][0]); // gerçek rol kimliği
    }
    // Rework olmadı; ledger her uzman için RECORDED+SUBMITTED+APPROVED taşır; onay aktörü kaydedenden BAĞIMSIZ.
    expect(res.reworkRequests).toHaveLength(0);
    expect(res.ledger.experts).toHaveLength(5);
    for (const e of res.ledger.experts) {
      expect(e.assignmentState).toBe("APPROVED");
      expect(e.reworkCount).toBe(0);
      const approved = e.events.find(ev => ev.type === "APPROVED");
      expect(approved).toBeTruthy();
      expect(approved!.actor).toBe(APPROVER);
      expect(approved!.actor).not.toBe(RECORDER);
      expect(approved!.evidenceRefs && approved!.evidenceRefs.length).toBeGreaterThan(0);
      expect(e.roleId).toBe(PRE_DEV_ROLE_MAP[e.kind][0]);
    }
    // Mevcut mission lifecycle DEĞİŞMEZ; hiçbir mission PRODUCT_VERIFIED'a ulaşmaz.
    expect(store.getMission(SCOPE, missionId)?.status).toBe("AUTHORIZED");
  });

  it("bounded downstream rework: a downstream request re-opens the upstream phase, supersedes the artifact, re-approves, re-advances", async () => {
    const missionId = authorizedMission();
    const reason = "ARCH_DOWNSTREAM_PLAN_INSUFFICIENT";
    const {coord, builder} = coordinator(new ReworkOnceDecider("Plan", reason), 2);
    const res = await coord.run(SCOPE, missionId);
    expect(res.status).toBe("PRE_DEV_COMPLETE");
    if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");

    // Tek downstream rework talebi: üst=Plan artefaktına karşı, downstream=Architect rolünce, gerçek sebeple.
    expect(res.reworkRequests).toHaveLength(1);
    const rr = res.reworkRequests[0];
    expect(rr.targetKind).toBe("Plan");
    expect(rr.requestedByRoleId).toBe(PRE_DEV_ROLE_MAP.Architecture[0]); // downstream tüketici
    expect(rr.upstreamRoleId).toBe(PRE_DEV_ROLE_MAP.Plan[0]);
    expect(rr.reason).toBe(reason);

    // GERÇEK store: Plan v1 REJECTED (downstream aktör), Plan v2 APPROVED (bağımsız approver), v2 v1'i supersede eder.
    const plans = store.listPreDevArtifacts(SCOPE, res.preDevId).filter(a => a.kind === "Plan").sort((a, b) => a.version - b.version);
    expect(plans).toHaveLength(2);
    expect(plans[0].state).toBe("REJECTED");
    expect(plans[0].rejectedBy).toBe(PRE_DEV_ROLE_MAP.Architecture[0]);
    expect(plans[0].id).toBe(rr.targetArtifactId);
    expect(plans[1].state).toBe("APPROVED");
    expect(plans[1].version).toBe(2);
    expect(plans[1].supersedes).toBe(plans[0].id);
    expect(plans[1].approvedBy).toBe(APPROVER);
    expect(plans[1].authorRoleId).toBe(PRE_DEV_ROLE_MAP.Plan[0]);
    // Builder, Plan için tam iki kez çağrıldı (v1 + supersede eden v2); üretilen içerik asla yürütülmedi.
    expect(builder.countFor("Plan")).toBe(2);

    // Faz yine de PRE_DEV_COMPLETE'e ilerledi (yeniden onay + yeniden advance).
    expect(store.preDevReadModel(SCOPE, missionId).phase).toBe("PRE_DEV_COMPLETE");

    // Ledger Plan uzmanı için rework'ü dürüstçe yansıtır: reworkCount=1, REWORK_REQUESTED(sebepli) + APPROVED olayları.
    const planExpert = res.ledger.experts.find(e => e.kind === "Plan")!;
    expect(planExpert.reworkCount).toBe(1);
    expect(planExpert.assignmentState).toBe("APPROVED");
    const rework = planExpert.events.find(ev => ev.type === "REWORK_REQUESTED");
    expect(rework).toBeTruthy();
    expect(rework!.reason).toBe(reason);
    expect(rework!.version).toBe(1);
    expect(planExpert.events.some(ev => ev.type === "APPROVED" && ev.version === 2)).toBe(true);
  });

  it("the coordination ledger is derivable by replay from a fresh store over the same journal", async () => {
    const missionId = authorizedMission();
    const {coord} = coordinator(new ReworkOnceDecider("Requirements", "REQ_INSUFFICIENT_FOR_PLAN"), 2);
    const res = await coord.run(SCOPE, missionId);
    expect(res.status).toBe("PRE_DEV_COMPLETE");
    if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");

    // Taze store aynı journal'dan artefaktları birebir yeniden kurar (yapısal zaman çizelgesi replay'den türetilebilir).
    const store2 = new WorkOsStore(tmp);
    expect(store2.journalHealth().state).toBe("OK");
    const a1 = store.listPreDevArtifacts(SCOPE, res.preDevId).map(a => ({id: a.id, kind: a.kind, version: a.version, state: a.state, authorRoleId: a.authorRoleId, recordedBy: a.recordedBy, approvedBy: a.approvedBy, rejectedBy: a.rejectedBy, supersedes: a.supersedes})).sort((x, y) => x.id < y.id ? -1 : 1);
    const a2 = store2.listPreDevArtifacts(SCOPE, res.preDevId).map(a => ({id: a.id, kind: a.kind, version: a.version, state: a.state, authorRoleId: a.authorRoleId, recordedBy: a.recordedBy, approvedBy: a.approvedBy, rejectedBy: a.rejectedBy, supersedes: a.supersedes})).sort((x, y) => x.id < y.id ? -1 : 1);
    expect(a2).toEqual(a1);
    // Replay sonrası Requirements yine bir REJECTED + bir APPROVED taşır (rework döngüsü kalıcı).
    const reqs = store2.listPreDevArtifacts(SCOPE, res.preDevId).filter(a => a.kind === "Requirements");
    expect(reqs.filter(a => a.state === "REJECTED")).toHaveLength(1);
    expect(reqs.filter(a => a.state === "APPROVED")).toHaveLength(1);
  });

  it("exceeding the rework bound fails closed: NO approval, NO advance (never auto-approves)", async () => {
    const missionId = authorizedMission();
    // maxReworkPerPhase=1: Plan sürekli reddedilirse, ilk supersede'den sonra ikinci rework talebi sınırı aşar ve fail-closed olur.
    const {coord} = coordinator(new AlwaysReworkDecider("Plan", "PLAN_NEVER_SUFFICIENT"), 1);
    const res = await coord.run(SCOPE, missionId);
    expect(res.status).toBe("REWORK_LIMIT_EXCEEDED");
    if (res.status !== "REWORK_LIMIT_EXCEEDED") throw new Error("unreachable");
    expect(res.kind).toBe("Plan");
    expect(res.phase).toBe("PLANNING");
    expect(res.reworkCount).toBe(1);

    // GERÇEK store: faz PLANNING'de kaldı (ilerlemedi); hiçbir Plan artefaktı APPROVED değil.
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("PLANNING");
    expect(rm.artifacts.Plan.approved).toBe(false);
    const plans = store.listPreDevArtifacts(SCOPE, res.preDevId).filter(a => a.kind === "Plan");
    expect(plans.some(a => a.state === "APPROVED")).toBe(false);
    // Upstream BA + Requirements onaylıdır (fail-closed yalnız sınırı aşan fazda durur).
    expect(rm.artifacts.BusinessAnalysis.approved).toBe(true);
    expect(rm.artifacts.Requirements.approved).toBe(true);
    // Downstream fazlar (Architecture/UxSpec) hiç başlamadı.
    expect(rm.artifacts.Architecture.state).toBe("NOT_STARTED");
    expect(rm.artifacts.UxSpec.state).toBe("NOT_STARTED");
  });

  it("a validator-rejected produce fails closed (no invalid artifact recorded, no advance)", async () => {
    const missionId = authorizedMission();
    // Bozuk Requirements üreten builder: tracesTo var olmayan bir goal'e işaret eder -> GERÇEK doğrulayıcı reddeder.
    class BrokenReqBuilder extends TaskHubFixtureBuilder {
      async produce(kind: ArtifactKind, rp: string, ctx: MissionContext): Promise<string> {
        if (kind === "Requirements") {
          const broken = JSON.parse(JSON.stringify(TASKHUB_ARTIFACTS.Requirements)) as {functional: Array<{tracesTo: string[]}>};
          broken.functional[0].tracesTo = ["G999"];
          this.calls.push({kind, context: JSON.parse(JSON.stringify(ctx))});
          return JSON.stringify(broken);
        }
        return super.produce(kind, rp, ctx);
      }
    }
    const b = new BrokenReqBuilder();
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: b});
    const coord = new CrewCoordinator({store: store as unknown as CrewStore, driver, plan: buildCrewPlan(), brief: TASKHUB_BRIEF, builder: b, decider: new AcceptAllDecider(), maxReworkPerPhase: 2, recorder: RECORDER, approver: APPROVER, now});
    const res = await coord.run(SCOPE, missionId);
    expect(res.status).toBe("PRODUCE_REJECTED");
    if (res.status !== "PRODUCE_REJECTED") throw new Error("unreachable");
    expect(res.kind).toBe("Requirements");
    expect(res.reason).toBe("REQ_TRACEABILITY_BROKEN");
    const rm = store.preDevReadModel(SCOPE, missionId);
    expect(rm.phase).toBe("REQUIREMENTS");
    expect(rm.artifacts.Requirements.state).toBe("NOT_STARTED");
    expect(store.journalHealth().state).toBe("OK");
  });

  it("rejects a non-independent approver at construction (does not weaken the approval gate)", () => {
    const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder: new TaskHubFixtureBuilder()});
    expect(() => new CrewCoordinator({store: store as unknown as CrewStore, driver, plan: buildCrewPlan(), brief: TASKHUB_BRIEF, builder: new TaskHubFixtureBuilder(), decider: new AcceptAllDecider(), maxReworkPerPhase: 1, recorder: RECORDER, approver: RECORDER, now}))
      .toThrow(CrewCoordinatorError);
  });
});
