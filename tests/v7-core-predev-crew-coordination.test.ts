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
