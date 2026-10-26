// //TR: Bu test CORE-5 crew/koordinasyon katmanını GERÇEK ürün kodundan geçirir: GERÇEK PreDevDriver (driver.ts), GERÇEK doğrulayıcılar (validateArtifactContent) ve GERÇEK WorkOsStore/journal; yalnız BuilderPort (TaskHub fixture'ı döndüren) ve ReworkDecider enjekte edilir. Driver/validator/store YENİDEN YAZILMAZ veya stub'lanmaz. Tam BA->Req->Plan->Arch->UX crew koşusu GERÇEK rol kimliklerini atar, YALNIZ bağımsız onay sonrası ilerler, koordinasyon ledger'ını (gerçek kayıtlardan türetilmiş) üretir ve sınırlı downstream rework döngüsünü (bir downstream rework talebi üst fazı yeniden açar, artefaktı supersede eder, yeniden onaylar, yeniden ilerler) VE rework sınırının aşılmasının fail-closed olduğunu doğrular. Dürüst: bu yalnız kaynak düzeyinde koordinasyon katmanıdır; üretilen hiçbir kod yürütülmez; hiçbir mission PRODUCT_VERIFIED'a ulaşmaz.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
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
import {selectNextTask, ACTIVE_WINDOW_MS, type QueueTask, type Observed} from "../core/workos/task-selector.js";
import {CrewCoordinator, CrewCoordinatorError, type ReworkDecider, type ReworkDecisionInput, type CrewStore} from "../core/workos/crew/coordinator.js";
import {submitIntake} from "../core/workos/intake.js";
import {submitPlan, validatePlanCreate} from "../core/workos/plan.js";
import {briefFromRecords} from "../core/workos/predev/brief.js";
import {PREDEV_AGENT_ACTOR, PreDevBuilderError} from "../core/workos/predev/claude-builder.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import {ensureClaudeProfile, claudeProfileDir} from "../core/workos/claude-profiles.js";
import {ANALYSIS_KINDS, AnalysisFlow, AnalysisStoppedError, NO_ANALYSIS_BUILDER, claudeAnalysisReadiness, tasksFromPlan} from "../core/workos/crew/analysis.js";
import type {PlanContent, RequirementsContent} from "../core/workos/predev/types.js";
import type {ClaudeCliStatus} from "../core/workos/claude-profiles.js";
import type {AnalysisReadiness} from "../core/workos/crew/analysis.js";
import crypto from "node:crypto";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

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

// //TR: LANE-A PQ-012: saf sonraki-görev seçici (core/workos/task-selector.ts): capacityRule, taban, yetki, hat dengesi ve fail-closed BLOCKED kuralları.
describe("PQ-012 selectNextTask (pure next-task selector)", () => {
  const NOW = Date.parse("2026-10-21T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
  const obs = (o: Partial<Observed> = {}): Observed => ({now: NOW, openPrBranches: [], claimBranches: [], ...o});
  const t = (id: string, o: Partial<QueueTask> = {}): QueueTask => ({id, status: "QUEUED", base: "v7/integration", lane: "A", ...o});
  const q = (tasks: QueueTask[], builderCap = 3) => ({builderCap, tasks});
  const taken = (id: string, lane: string, h: number, extra: Partial<QueueTask> = {}) => t(id, {status: "IN_PROGRESS", lane, branch: `claude/${id.toLowerCase()}`, startedAt: hoursAgo(h), ...extra});

  it("selects the first eligible QUEUED task in queue order and is deterministic", () => {
    const queue = q([t("PQ-1"), t("PQ-2")]);
    const r = selectNextTask(queue, obs());
    expect(r).toEqual({action: "SELECT", taskId: "PQ-1", lane: "A", active: 0, builderCap: 3});
    expect(selectNextTask(queue, obs())).toEqual(r);
    expect(selectNextTask(q([t("PQ-2", {status: "HOLD_CAPACITY"})]), obs())).toMatchObject({action: "SELECT", taskId: "PQ-2"});
  });
  it("capacity: fresh in-progress tasks without an open PR count; ACTIVE >= builderCap gives NO_ACTION CAPACITY", () => {
    const tasks = [taken("PQ-7", "B", 1), taken("PQ-8", "C", 2), taken("PQ-9", "A", 5.9), t("PQ-10")];
    expect(selectNextTask(q(tasks), obs())).toEqual({action: "NO_ACTION", reason: "CAPACITY", active: 3, builderCap: 3});
    expect(selectNextTask(q(tasks, 4), obs())).toMatchObject({action: "SELECT", taskId: "PQ-10", active: 3});
  });
  it("a task with an open PR or older than 6 h no longer holds a slot (boundary: exactly 6 h is stale)", () => {
    const tasks = [taken("PQ-7", "B", 1), taken("PQ-8", "C", 2), taken("PQ-9", "A", 6), t("PQ-10")];
    expect(ACTIVE_WINDOW_MS).toBe(6 * 3600_000);
    expect(selectNextTask(q(tasks), obs())).toMatchObject({action: "SELECT", active: 2});
    const withPr = [taken("PQ-7", "B", 1), taken("PQ-8", "C", 2), taken("PQ-9", "A", 3), t("PQ-10")];
    expect(selectNextTask(q(withPr), obs({openPrBranches: ["claude/pq-9"]}))).toMatchObject({action: "SELECT", active: 2});
  });
  it("live claim branches count unless they have an open PR, are older than 6 h, or belong to a task already counted", () => {
    const base = [t("PQ-10")];
    const claims = [{branch: "claude/x1", headAt: NOW - 3600_000}, {branch: "claude/x2", headAt: NOW - 7200_000}, {branch: "claude/x3", headAt: NOW - 1000}];
    expect(selectNextTask(q(base), obs({claimBranches: claims}))).toEqual({action: "NO_ACTION", reason: "CAPACITY", active: 3, builderCap: 3});
    expect(selectNextTask(q(base), obs({claimBranches: claims, openPrBranches: ["claude/x3"]}))).toMatchObject({action: "SELECT", active: 2});
    expect(selectNextTask(q(base), obs({claimBranches: [{branch: "claude/x1", headAt: NOW - 6 * 3600_000}]}))).toMatchObject({action: "SELECT", active: 0});
    const dup = [taken("PQ-7", "B", 1), t("PQ-10")];
    expect(selectNextTask(q(dup), obs({claimBranches: [{branch: "claude/pq-7", headAt: NOW - 1000}, {branch: "claude/pq-7", headAt: NOW - 500}]}))).toMatchObject({action: "SELECT", active: 1});
  });
  it("base: integration bases and satisfied dependencies are eligible; unmet ones are skipped without a selection", () => {
    const stacked = t("PQ-3", {base: "claude/ui-105@632a774 (stacked; draft PR #125 open)"});
    expect(selectNextTask(q([stacked]), obs())).toEqual({action: "NO_ACTION", reason: "NO_ELIGIBLE_TASK", active: 0, builderCap: 3});
    expect(selectNextTask(q([stacked]), obs({openPrBranches: ["claude/ui-105"]}))).toMatchObject({action: "SELECT", taskId: "PQ-3"});
    expect(selectNextTask(q([t("PQ-4", {base: "a910883"})]), obs())).toMatchObject({action: "SELECT"});
    const after = t("PQ-5", {base: "after PQ-4 (settings.js overlap)"});
    expect(selectNextTask(q([t("PQ-4", {status: "IN_PROGRESS", startedAt: hoursAgo(1), branch: "claude/pq-4"}), after]), obs({openPrBranches: []}))).toMatchObject({action: "NO_ACTION", reason: "NO_ELIGIBLE_TASK"});
    expect(selectNextTask(q([t("PQ-4", {status: "TESTED"}), after]), obs())).toMatchObject({action: "SELECT", taskId: "PQ-5"});
    expect(selectNextTask(q([after]), obs())).toMatchObject({action: "NO_ACTION", reason: "NO_ELIGIBLE_TASK"}); // bilinmeyen bağımlılık karşılanmış sayılmaz
  });
  it("authority / founder-only / non-selectable statuses are never selected", () => {
    const tasks = [t("PQ-1", {authority: "package-lock.json is protected"}), t("PQ-2", {founderOnly: true}), t("PQ-3", {status: "FOUNDER_QUEUE"}), t("PQ-4", {status: "BLOCKED"}), t("PQ-5", {status: "WAITING_BASE"}), t("PQ-6", {status: "TESTED"})];
    expect(selectNextTask(q(tasks), obs())).toMatchObject({action: "NO_ACTION", reason: "NO_ELIGIBLE_TASK"});
    expect(selectNextTask(q([...tasks, t("PQ-7")]), obs())).toMatchObject({action: "SELECT", taskId: "PQ-7"});
    expect(selectNextTask(q([t("PQ-8", {authority: "  "})]), obs())).toMatchObject({action: "SELECT", taskId: "PQ-8"});
  });
  it("lane balance prefers the lane with the fewest active tasks, then queue order", () => {
    const tasks = [taken("PQ-7", "A (Lane A builder)", 1), t("PQ-1", {lane: "A (Lane A builder)"}), t("PQ-2", {lane: "B"}), t("PQ-3", {lane: "C"})];
    expect(selectNextTask(q(tasks), obs())).toMatchObject({action: "SELECT", taskId: "PQ-2", lane: "B"});
    const tie = [t("PQ-1", {lane: "C"}), t("PQ-2", {lane: "B"})];
    expect(selectNextTask(q(tie), obs())).toMatchObject({taskId: "PQ-1"});
  });
  it("fails closed with a code on malformed queue, cap, observation, ids, statuses, lanes, bases and timestamps", () => {
    const code = (queue: unknown, o: unknown = obs()) => (selectNextTask(queue as any, o as any) as any).code;
    expect(code(null)).toBe("QUEUE_INVALID");
    expect(code({builderCap: 3, tasks: "x"})).toBe("QUEUE_INVALID");
    for (const cap of [0, -1, 1.5, "3", undefined]) expect(code({builderCap: cap, tasks: []})).toBe("BUILDER_CAP_INVALID");
    expect(code(q([]), {now: "x", openPrBranches: [], claimBranches: []})).toBe("OBSERVED_INVALID");
    expect(code(q([]), {now: NOW, openPrBranches: [""], claimBranches: []})).toBe("OBSERVED_INVALID");
    expect(code(q([]), {now: NOW, openPrBranches: [], claimBranches: [{branch: "claude/a", headAt: "x"}]})).toBe("OBSERVED_INVALID");
    expect(code(q([{id: "", status: "QUEUED"} as any]))).toBe("TASK_INVALID");
    expect(code(q([null as any]))).toBe("TASK_INVALID");
    expect(code(q([t("PQ-1"), t("PQ-1")]))).toBe("TASK_ID_DUPLICATE");
    expect(code(q([t("PQ-1", {status: "DONE"})]))).toBe("TASK_STATUS_UNKNOWN");
    expect(code(q([t("PQ-1", {lane: undefined})]))).toBe("TASK_LANE_INVALID");
    expect(code(q([t("PQ-1", {lane: "lane a"})]))).toBe("TASK_LANE_INVALID");
    expect(code(q([t("PQ-1", {base: undefined})]))).toBe("TASK_BASE_INVALID");
    expect(code(q([t("PQ-1", {base: "somewhere else"})]))).toBe("TASK_BASE_INVALID");
    expect(code(q([taken("PQ-1", "A", 1, {startedAt: "not-a-date"})]))).toBe("TASK_STARTED_AT_INVALID");
    expect(code(q([taken("PQ-1", "A", 1, {startedAt: null})]))).toBe("TASK_STARTED_AT_INVALID");
    expect(selectNextTask(q([t("PQ-1", {lane: undefined})]), obs())).toMatchObject({action: "BLOCKED", taskId: "PQ-1"});
  });
  it("is pure: does not mutate its inputs", () => {
    const queue = q([taken("PQ-7", "B", 1), t("PQ-1")]), o = obs({claimBranches: [{branch: "claude/x", headAt: NOW}]});
    const before = JSON.stringify([queue, o]);
    selectNextTask(queue, o);
    expect(JSON.stringify([queue, o])).toBe(before);
  });
});

// //TR: C-FLOW-ANALYSIS-1 (test birleştirme): analiz adımı testleri kayıtlı bir dosyaya taşındı (yeni test dosyası config/validation.json kaydı gerektirirdi). Aşağıdaki blok kendi tmp/SCOPE/yardımcılarını tanımlar (ana dosyanın aynı adlı tanımlarını gölgeler).
describe("LANE-C analysis flow: C-FLOW-ANALYSIS-1", () => {
let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-fa-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

const SCOPE = {tenantId: "tA"};
const READY: AnalysisReadiness = {ready: true, blockers: [], blocker: null, founderAction: null, profiles: null};
const IDEA = "A small team task board with deadlines and reminders for freelancers who juggle several clients";

function setup(builderOverride?: (kind: ArtifactKind, n: number) => string | Error | undefined, readiness: () => AnalysisReadiness = () => READY, pause?: () => Promise<void> | undefined, flowExtra: {stopped?: () => boolean} = {}) {
  const store = new WorkOsStore(path.join(tmp, "data"));
  const {intake} = submitIntake({store, scope: SCOPE, orgId: "o1", actor: "FOUNDER_LOCAL"}, {idea: IDEA, projectType: "web", targetOS: ["web"]});
  const calls: Array<{kind: ArtifactKind; prompt: string; upstream: ArtifactKind[]}> = [];
  const builder: BuilderPort = {
    async produce(kind, rolePrompt, ctx) {
      calls.push({kind, prompt: rolePrompt, upstream: Object.keys(ctx.approvedUpstream) as ArtifactKind[]});
      await pause?.();
      const o = builderOverride?.(kind, calls.filter(c => c.kind === kind).length);
      if (o instanceof Error) throw o;
      return o ?? JSON.stringify(TASKHUB_ARTIFACTS[kind]);
    }
  };
  const flow = new AnalysisFlow({store, scope: SCOPE, builder, readiness, ...flowExtra});
  const mission = store.getMission(SCOPE, intake.missionId)!, project = store.getProject(SCOPE, intake.projectId)!;
  const founder = new PreDevDriver({store, brief: briefFromRecords({project, mission}), builder});
  const approve = (artifactId: string, approver = "FOUNDER_LOCAL") => founder.approveAndAdvance(SCOPE, intake.missionId, artifactId, approver, ["ev-founder-review-1"]);
  return {store, flow, calls, builder, approve, founder, missionId: intake.missionId, projectId: intake.projectId, rm: () => store.preDevReadModel(SCOPE, intake.missionId)};
}

describe("C-FLOW-ANALYSIS-1: intake -> analysis -> plan", () => {
  it("walks the whole flow: each phase is produced from the idea, waits for the Founder, and the approved Plan becomes the task breakdown", async () => {
    const t = setup();
    expect(t.rm()).toMatchObject({active: false, phase: "NOT_STARTED"});
    const seen: ArtifactKind[] = [];
    for (const kind of ANALYSIS_KINDS) {
      const produced = await t.flow.step(t.missionId);
      expect(produced).toMatchObject({status: "DRAFT_READY", kind, version: 1, roleId: PRE_DEV_ROLE_MAP[kind][0], next: "FOUNDER_APPROVAL"});
      const again = await t.flow.step(t.missionId); // a draft is waiting: no second (paid) call
      expect(again).toMatchObject({status: "AWAITING_APPROVAL", kind, artifactState: "DRAFT", artifactId: (produced as {artifactId: string}).artifactId});
      expect(t.calls.filter(c => c.kind === kind)).toHaveLength(1);
      // the idea reaches every role prompt; only APPROVED upstream artefacts reach later roles
      expect(t.calls[t.calls.length - 1].prompt).toContain("freelancers");
      expect(t.calls[t.calls.length - 1].upstream).toEqual(seen);
      const art = t.store.getPreDevArtifact(SCOPE, (produced as {artifactId: string}).artifactId)!;
      expect([art.state, art.recordedBy, art.authorRoleId]).toEqual(["DRAFT", PREDEV_AGENT_ACTOR, PRE_DEV_ROLE_MAP[kind][0]]);
      expect(() => t.approve(art.id, PREDEV_AGENT_ACTOR)).toThrow(/PREDEV_APPROVER_NOT_INDEPENDENT/); // the agent cannot approve its own draft
      expect(await t.flow.step(t.missionId)).toMatchObject({status: "AWAITING_APPROVAL", kind, artifactState: "SUBMITTED"}); // the refused approval left it SUBMITTED: still waiting, still no paid call
      expect(t.calls.filter(c => c.kind === kind)).toHaveLength(1);
      t.approve(art.id);
      seen.push(kind);
      expect(t.store.getPreDevArtifact(SCOPE, art.id)).toMatchObject({state: "APPROVED", approvedBy: "FOUNDER_LOCAL"});
    }
    expect(await t.flow.step(t.missionId)).toEqual({status: "COMPLETE", approved: [...ANALYSIS_KINDS]});
    expect(t.rm()).toMatchObject({phase: "UX_DESIGN"}); // analysis ends where the optional UX phase starts
    expect(t.calls).toHaveLength(4);

    const draft = t.flow.planFromApproved(t.missionId);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.summary).toMatchObject({requirements: {functional: expect.any(Number), nonFunctional: expect.any(Number), acceptanceCriteria: expect.any(Number)}, plan: {workPackages: 6}});
    expect(draft.summary.requirements.acceptanceCriteria).toBeGreaterThan(0);
    expect(draft.summary.architecture.components.length).toBeGreaterThan(0);
    const created = t.flow.createPlan(t.missionId, "FOUNDER_LOCAL");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.replayed).toBe(false);
    expect(created.tasks.map(x => x.title.split(":")[0])).toEqual(["WP1", "WP2", "WP3", "WP4", "WP5", "WP6"]);
    // the dependency graph of the approved Plan is the dependency graph of the tasks
    const byWp = new Map(created.tasks.map(x => [x.title.split(":")[0], x]));
    const wps = (TASKHUB_ARTIFACTS.Plan as PlanContent).workPackages;
    for (const w of wps) expect([w.id, [...byWp.get(w.id)!.dependsOn].sort()]).toEqual([w.id, w.dependsOn.map(d => byWp.get(d)!.taskId).sort()]);
    // every task traces to requirements and their acceptance criteria
    for (const tr of created.trace) expect([tr.workPackageId, tr.requirements.length > 0 && tr.requirements.every(r => r.acceptanceCriteria.length > 0)]).toEqual([tr.workPackageId, true]);
    // replay is idempotent; the tasks are the ones the existing task routes read
    const replay = t.flow.createPlan(t.missionId, "FOUNDER_LOCAL");
    expect(replay).toMatchObject({ok: true, replayed: true});
    expect(t.store.listTasks(SCOPE, t.missionId).map(x => x.taskId)).toEqual(created.tasks.map(x => x.taskId));
  });

  it("not ready -> BLOCKED with the exact blocker: no paid call, no sequence opened, nothing recorded, no plan", async () => {
    const blocked: AnalysisReadiness = {ready: false, blockers: ["CLAUDE_CLI_NOT_FOUND", "reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"], blocker: "CLAUDE_CLI_NOT_FOUND", founderAction: "install it", profiles: null};
    const t = setup(undefined, () => blocked);
    const r = await t.flow.step(t.missionId);
    expect(r).toMatchObject({status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: blocked.blockers, founderAction: "install it"});
    expect(t.calls).toHaveLength(0);
    expect(t.rm()).toMatchObject({active: false, phase: "NOT_STARTED"});
    expect(t.flow.planFromApproved(t.missionId)).toMatchObject({ok: false, code: "ANALYSIS_NOT_COMPLETE", detail: ANALYSIS_KINDS.join(",")});
    expect(t.flow.createPlan(t.missionId, "FOUNDER_LOCAL")).toMatchObject({ok: false, code: "ANALYSIS_NOT_COMPLETE"});
    expect(t.store.listTasks(SCOPE, t.missionId)).toEqual([]);
  });

  it("readiness is only asked when a paid call would start: a waiting draft and a finished analysis never need it", async () => {
    let asked = 0;
    const t = setup(undefined, () => { asked++; return READY; });
    await t.flow.step(t.missionId); expect(asked).toBe(1);
    await t.flow.step(t.missionId); expect(asked).toBe(1); // AWAITING_APPROVAL
  });

  it("a builder failure is reported with its exact code and records nothing; a retry after the cause is fixed works", async () => {
    let fail = true;
    const t = setup(() => fail ? new PreDevBuilderError("PREDEV_BUILDER_EXIT_NONZERO", "secret detail") : undefined);
    const r = await t.flow.step(t.missionId);
    expect(r).toEqual({status: "BUILDER_FAILED", kind: "BusinessAnalysis", code: "PREDEV_BUILDER_EXIT_NONZERO"}); // the detail never leaves
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED");
    expect(t.rm(), "a failed step must not open the pre-dev sequence or advance its phase").toMatchObject({active: false, phase: "NOT_STARTED"}); // L2
    fail = false;
    expect((await t.flow.step(t.missionId)).status).toBe("DRAFT_READY");
  });

  it("output that is not JSON or breaks the artefact rules is REJECTED with the validator's code; nothing invalid is recorded and the phase does not move", async () => {
    let mode: "json" | "shape" | "good" = "json";
    const t = setup((kind) => mode === "json" ? "not json at all" : mode === "shape" ? JSON.stringify({...(TASKHUB_ARTIFACTS[kind] as object), goals: []}) : JSON.stringify(TASKHUB_ARTIFACTS[kind]));
    expect(await t.flow.step(t.missionId)).toEqual({status: "REJECTED", kind: "BusinessAnalysis", reason: "PREDEV_DRIVER_INVALID_JSON"});
    mode = "shape";
    const shape = await t.flow.step(t.missionId);
    expect(shape).toMatchObject({status: "REJECTED", kind: "BusinessAnalysis"});
    expect((shape as {reason: string}).reason.length).toBeGreaterThan(0);
    expect(t.rm()).toMatchObject({phase: "BUSINESS_ANALYSIS"});
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED");
    mode = "good";
    expect((await t.flow.step(t.missionId)).status).toBe("DRAFT_READY");
  });

  it("a draft the Founder rejects is re-produced as a superseding version (the reject route's gate), not silently kept", async () => {
    const t = setup();
    const first = await t.flow.step(t.missionId) as {artifactId: string};
    t.founder.reject(SCOPE, t.missionId, first.artifactId, "FOUNDER_LOCAL", "goals are too vague");
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("REJECTED");
    const second = await t.flow.step(t.missionId);
    expect(second).toMatchObject({status: "DRAFT_READY", kind: "BusinessAnalysis", version: 2});
    expect(t.store.getPreDevArtifact(SCOPE, (second as {artifactId: string}).artifactId)!.supersedes).toBe(first.artifactId);
  });

  it("no production builder configured: a ready setup still answers with the exact code and records nothing", async () => {
    const t = setup();
    const flow = new AnalysisFlow({store: t.store, scope: SCOPE, builder: NO_ANALYSIS_BUILDER, readiness: () => READY});
    expect(await flow.step(t.missionId)).toEqual({status: "BUILDER_FAILED", kind: "BusinessAnalysis", code: "PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"});
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED");
    expect(t.rm(), "no builder configured: nothing is written, the sequence is not opened").toMatchObject({active: false, phase: "NOT_STARTED"}); // L2
  });

  const approveAll = async (t: ReturnType<typeof setup>) => { for (const _kind of ANALYSIS_KINDS) { const r = await t.flow.step(t.missionId) as {artifactId: string}; t.approve(r.artifactId); } };

  it("M-229-1: an approved Plan whose dependsOn lists a package twice (or more than 49 times) is refused with PLAN_INVALID by planFromApproved AND createPlan, and nothing is persisted that the plan route would answer with 400; the untouched plan is exactly what the route's validator accepts", async () => {
    const wps = (TASKHUB_ARTIFACTS.Plan as PlanContent).workPackages, withDeps = wps.find(w => w.dependsOn.length > 0)!;
    for (const copies of [2, 60]) {
      const t = setup(kind => kind === "Plan" ? JSON.stringify({...(TASKHUB_ARTIFACTS.Plan as object), workPackages: wps.map(w => w.id === withDeps.id ? {...w, dependsOn: Array.from({length: copies}, () => w.dependsOn[0])} : w)}) : undefined);
      await approveAll(t);
      const draft = t.flow.planFromApproved(t.missionId);
      expect(draft, `copies=${copies}`).toMatchObject({ok: false, code: "PLAN_INVALID", detail: expect.stringContaining("dependsOn")});
      expect(t.flow.createPlan(t.missionId, "FOUNDER_LOCAL"), `copies=${copies}`).toMatchObject({ok: false, code: "PLAN_INVALID"});
      expect(t.store.listTasks(SCOPE, t.missionId)).toEqual([]);
    }
    const ok = setup(); await approveAll(ok);
    const d = ok.flow.planFromApproved(ok.missionId);
    expect(d.ok).toBe(true);
    if (d.ok) expect(validatePlanCreate(d.body)).toEqual({ok: true});
  });

  it("M-229-2: two concurrent steps on one mission (the route builds a new flow per request) start ONE paid builder run; the second is answered BLOCKED ANALYSIS_IN_PROGRESS before any builder call, and the guard is released afterwards", async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let n = 0;
    const t = setup(undefined, undefined, () => n++ === 0 ? gate : undefined);
    const other = new AnalysisFlow({store: t.store, scope: SCOPE, builder: t.builder, readiness: () => READY}); // a second request's own flow object
    const first = t.flow.step(t.missionId);
    for (let i = 0; i < 200 && t.calls.length < 1; i++) await new Promise(r => setTimeout(r, 5));
    expect(t.calls).toHaveLength(1);
    const second = await other.step(t.missionId);
    expect(second).toMatchObject({status: "BLOCKED", blocker: "ANALYSIS_IN_PROGRESS", blockers: ["ANALYSIS_IN_PROGRESS"]});
    expect(t.calls, "the second call must not start a second paid builder run").toHaveLength(1);
    release();
    expect(await first).toMatchObject({status: "DRAFT_READY", kind: "BusinessAnalysis", version: 1});
    expect(await other.step(t.missionId)).toMatchObject({status: "AWAITING_APPROVAL", kind: "BusinessAnalysis"}); // released: the draft is simply waiting now
    expect(t.calls).toHaveLength(1);
  });

  it("L1: a Global Stop is honoured with the typed AnalysisStoppedError: set before the call -> no paid call; flipped DURING the call -> the builder's shouldAbort is wired to it and the draft is not recorded (an aborted run is a stop, not BUILDER_FAILED); nothing is written either way", async () => {
    let stopped = true;
    const t = setup(undefined, undefined, undefined, {stopped: () => stopped});
    await expect(t.flow.step(t.missionId)).rejects.toBeInstanceOf(AnalysisStoppedError);
    expect(t.calls).toHaveLength(0);
    expect(t.rm()).toMatchObject({active: false, phase: "NOT_STARTED"});
    stopped = false;
    const during = setup();
    const observed: boolean[] = [];
    const fake: BuilderPort & {shouldAbort?: () => boolean} = {shouldAbort: undefined, async produce(k, p, c) { const raw = await during.builder.produce(k, p, c); stopped = true; observed.push(fake.shouldAbort?.() === true); return raw; }};
    const flow = new AnalysisFlow({store: during.store, scope: SCOPE, builder: fake, readiness: () => READY, stopped: () => stopped});
    await expect(flow.step(during.missionId)).rejects.toBeInstanceOf(AnalysisStoppedError);
    expect(typeof fake.shouldAbort, "the builder must be wired to the stop").toBe("function");
    expect(observed, "the builder's abort hook saw the stop during its run").toEqual([true]);
    expect(during.calls).toHaveLength(1); // the paid call happened ...
    expect(during.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED"); // ... but its output was not recorded
    expect(during.rm()).toMatchObject({active: false, phase: "NOT_STARTED"});
    await new AnalysisFlow({store: during.store, scope: SCOPE, builder: NO_ANALYSIS_BUILDER, readiness: () => READY, stopped: () => false}).step(during.missionId); // (the answer differs between the branches that do and do not know EXECUTOR_NOT_ENABLED; only the wiring matters here)
    expect("shouldAbort" in NO_ANALYSIS_BUILDER, "the shared no-builder sentinel is never wired").toBe(false);
    // an aborted builder (it throws once the stop is up) is a stop, not a builder failure
    stopped = false;
    const aborted: BuilderPort = {async produce() { stopped = true; throw new PreDevBuilderError("PREDEV_BUILDER_EXIT_NONZERO", "killed by the stop"); }};
    await expect(new AnalysisFlow({store: during.store, scope: SCOPE, builder: aborted, readiness: () => READY, stopped: () => stopped}).step(during.missionId)).rejects.toBeInstanceOf(AnalysisStoppedError);
    stopped = false; // cleared: works again
    expect((await new AnalysisFlow({store: during.store, scope: SCOPE, builder: during.builder, readiness: () => READY, stopped: () => stopped}).step(during.missionId)).status).toBe("DRAFT_READY");
  });

  it("L3: when another actor recorded this phase's draft while our paid call ran (a lost race), the answer points at the pending approval, not BUILDER_FAILED for the wrong phase", async () => {
    let t!: ReturnType<typeof setup>;
    t = setup((kind, n) => {
      if (kind === "BusinessAnalysis" && n === 1) { // the other actor: opens the sequence and records the draft first
        const seq = t.store.openPreDevSequence(SCOPE, t.missionId, PREDEV_AGENT_ACTOR);
        t.store.advancePreDevPhase(SCOPE, seq.preDevId, "BUSINESS_ANALYSIS", PREDEV_AGENT_ACTOR);
        t.store.recordPreDevArtifact(SCOPE, seq.preDevId, {kind, authorRoleId: PRE_DEV_ROLE_MAP[kind][0], content: TASKHUB_ARTIFACTS[kind] as never}, PREDEV_AGENT_ACTOR);
      }
      return undefined;
    });
    const r = await t.flow.step(t.missionId);
    const pending = t.rm().artifacts.BusinessAnalysis;
    expect(pending.state).toBe("DRAFT");
    expect(r).toMatchObject({status: "AWAITING_APPROVAL", kind: "BusinessAnalysis", artifactId: pending.artifactId, artifactState: "DRAFT"});
  });

  it("L4: the plan gate and the actor attribution: the agent identity records every draft, the actor given to createPlan owns the plan and its tasks, and nothing else is accepted silently", async () => {
    const t = setup(); await approveAll(t);
    for (const kind of ANALYSIS_KINDS) expect(t.store.getPreDevArtifact(SCOPE, t.rm().artifacts[kind].artifactId!)).toMatchObject({recordedBy: PREDEV_AGENT_ACTOR, approvedBy: "FOUNDER_LOCAL"});
    // the sequence itself is opened and advanced to its first phase by the agent identity (never the Founder's); the Founder only approves
    const events = fs.readFileSync(path.join(t.store.dataDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as {type: string; actor: string; payload: {to?: string}});
    expect(events.filter(e => e.type === "PREDEV_SEQUENCE_OPENED").map(e => e.actor)).toEqual([PREDEV_AGENT_ACTOR]);
    expect(events.filter(e => e.type === "PREDEV_PHASE_ADVANCED" && e.payload.to === "BUSINESS_ANALYSIS").map(e => e.actor)).toEqual([PREDEV_AGENT_ACTOR]);
    expect(events.filter(e => e.type === "PREDEV_ARTIFACT_RECORDED").every(e => e.actor === PREDEV_AGENT_ACTOR)).toBe(true);
    expect(t.flow.createPlan(t.missionId, "FOUNDER_ACTOR_X")).toMatchObject({ok: true, replayed: false});
    const plans = fs.readFileSync(path.join(t.store.dataDir, "plans.jsonl"), "utf8");
    expect(plans).toContain('"createdBy":"FOUNDER_ACTOR_X"');
    expect(plans).not.toContain(PREDEV_AGENT_ACTOR);
    const journal = fs.readFileSync(path.join(t.store.dataDir, "journal.jsonl"), "utf8").split("\n").filter(l => l.includes("TASK_CREATED") && l.includes(t.missionId)).map(l => JSON.parse(l) as {actor: string});
    expect(journal.length).toBe(6);
    expect(journal.every(e => e.actor === "FOUNDER_ACTOR_X")).toBe(true);
  });

  it("an unknown mission is a typed error, not a silent empty analysis", async () => {
    const t = setup();
    await expect(t.flow.step("msn_" + "0".repeat(24))).rejects.toMatchObject({code: "ANALYSIS_MISSION_NOT_FOUND"});
  });

  it("createPlan reports the existing plan module's refusal instead of throwing (a different plan already exists)", async () => {
    const t = setup();
    for (const kind of ANALYSIS_KINDS) { const r = await t.flow.step(t.missionId) as {artifactId: string}; t.approve(r.artifactId); void kind; }
    submitPlan(t.store, SCOPE, "FOUNDER_LOCAL", t.missionId, {tasks: [{title: "A hand-written plan"}]});
    expect(t.flow.createPlan(t.missionId, "FOUNDER_LOCAL")).toMatchObject({ok: false, code: "PLAN_ALREADY_EXISTS"});
  });
});

describe("C-FLOW-ANALYSIS-1: readiness comes from the role bindings, the CLI, the launcher proof and BOTH Claude profiles", () => {
  const FOUND: ClaudeCliStatus = {state: "FOUND", path: "/x/claude", kind: "EXECUTABLE", source: "PATH", pathDir: null, searchedCount: 0, founderAction: null};
  const NOT_FOUND: ClaudeCliStatus = {state: "NOT_FOUND", path: null, kind: null, source: null, pathDir: null, searchedCount: 1, founderAction: "install claude"};
  const control = () => path.join(tmp, "control");
  const data = () => path.join(tmp, "data");
  const verify = () => {
    const launcher = path.join(tmp, "launcher.bin"); fs.writeFileSync(launcher, "bytes");
    fs.mkdirSync(path.join(control(), ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(control(), ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: launcher, launcherSha256: crypto.createHash("sha256").update("bytes").digest("hex")}}));
  };
  const login = (role: "implementer" | "reviewer") => { ensureClaudeProfile(control(), role, {forbiddenRoots: [data()]}); fs.writeFileSync(path.join(claudeProfileDir(control(), role), ".credentials.json"), ""); };
  const ready = (o: {cli?: ClaudeCliStatus; bindings?: typeof FIRST_DELIVERY_BINDINGS} = {}) => claudeAnalysisReadiness({controlRoot: control(), profile: {forbiddenRoots: [data()]}, cli: o.cli ?? FOUND, bindings: o.bindings});

  it("nothing installed, verified or signed in: the exact blockers in setup order, each profile named, the Founder's own login command available", () => {
    const r = ready({cli: NOT_FOUND});
    expect(r).toMatchObject({ready: false, blocker: "CLAUDE_CLI_NOT_FOUND", founderAction: "install claude"});
    expect(r.blockers).toEqual(["CLAUDE_CLI_NOT_FOUND", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED", "reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"]);
    expect(r.profiles!.reviewer.loginCommand).toContain(claudeProfileDir(control(), "reviewer"));
  });

  it("CLI found but the launcher was never verified: PROVIDER_PROVENANCE_NOT_READY comes before the sign-in blockers", () => {
    expect(ready().blockers).toEqual(["PROVIDER_PROVENANCE_NOT_READY", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED", "reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"]);
  });

  it("both profiles are required: one signed-in profile is still BLOCKED, naming the other; both signed in + verified -> ready", () => {
    verify(); login("implementer");
    const one = ready();
    expect([one.ready, one.blockers]).toEqual([false, ["reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"]]);
    login("reviewer");
    expect(ready()).toMatchObject({ready: true, blockers: [], blocker: null, founderAction: null});
  });

  it("an analysis role without an executable binding blocks with ROLE_NOT_EXECUTABLE, whatever the Claude setup", () => {
    verify(); login("implementer"); login("reviewer");
    const noArchitect = FIRST_DELIVERY_BINDINGS.filter(b => b.roleId !== PRE_DEV_ROLE_MAP.Architecture[0]);
    const r = ready({bindings: noArchitect});
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toBe(`ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING:${PRE_DEV_ROLE_MAP.Architecture[0]}`);
  });

  it("wired together: a not-ready real readiness BLOCKS the flow, and once the Founder has set everything up the same flow produces", async () => {
    const t = setup(undefined, () => ready({cli: NOT_FOUND}));
    expect(await t.flow.step(t.missionId)).toMatchObject({status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND"});
    expect(t.calls).toHaveLength(0);
    verify(); login("implementer"); login("reviewer");
    const t2 = setup(undefined, () => ready());
    expect((await t2.flow.step(t2.missionId)).status).toBe("DRAFT_READY");
  });
});

describe("C-FLOW-ANALYSIS-1: tasksFromPlan (approved Plan -> the task list the plan route takes)", () => {
  const REQS: RequirementsContent = {functional: [{id: "R1", statement: "s1", acceptanceCriteria: ["a1", "a2"], tracesTo: ["G1"]}], nonFunctional: [{id: "N1", statement: "n1", acceptanceCriteria: ["b1"], tracesTo: ["G1"]}]};
  const wp = (id: string, dependsOn: string[] = [], extra: Partial<PlanContent["workPackages"][0]> = {}) => ({id, title: `Title ${id}`, dependsOn, estimate: "2d", satisfies: ["R1"], ...extra});
  const plan = (workPackages: PlanContent["workPackages"]): PlanContent => ({scope: [{id: "S1", statement: "x"}], workPackages, milestones: [], outOfScope: []});

  it("orders by dependency (stable), maps dependsOn to earlier indexes, titles carry the package id, and the trace lists requirements with their criteria", () => {
    const r = tasksFromPlan(plan([wp("C", ["B", "A"]), wp("A"), wp("B", ["A"]), wp("D", [], {satisfies: ["N1", "ZZ"]})]), REQS); // C lists its dependencies in reverse: the indexes still come out ascending
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.tasks).toEqual([{title: "A: Title A"}, {title: "B: Title B", dependsOn: [0]}, {title: "C: Title C", dependsOn: [0, 1]}, {title: "D: Title D"}]);
    expect(r.trace.map(x => x.workPackageId)).toEqual(["A", "B", "C", "D"]);
    expect(r.trace[0].requirements).toEqual([{id: "R1", statement: "s1", acceptanceCriteria: ["a1", "a2"]}]);
    expect(r.trace[3]).toMatchObject({satisfies: ["N1", "ZZ"], requirements: [{id: "N1", acceptanceCriteria: ["b1"]}]}); // an unknown requirement id is not invented
  });

  it("refuses instead of guessing: more than 50 packages, an unknown dependency, a cycle", () => {
    expect(tasksFromPlan(plan(Array.from({length: 51}, (_, i) => wp(`W${i}`))), REQS)).toMatchObject({ok: false, code: "PLAN_TOO_LARGE"});
    expect(tasksFromPlan(plan(Array.from({length: 50}, (_, i) => wp(`W${i}`))), REQS).ok).toBe(true);
    expect(tasksFromPlan(plan([wp("A", ["NOPE"])]), REQS)).toMatchObject({ok: false, code: "PLAN_DEPENDENCY_UNKNOWN", detail: "A depends on NOPE"});
    expect(tasksFromPlan(plan([wp("A", ["B"]), wp("B", ["A"])]), REQS)).toMatchObject({ok: false, code: "PLAN_CYCLE", detail: "A,B"});
  });

  it("a title is cut at 200 characters and never empty", () => {
    const r = tasksFromPlan(plan([wp("A", [], {title: "x".repeat(500)})]), REQS);
    expect(r.ok && r.body.tasks[0].title.length).toBe(200);
  });
});
});
