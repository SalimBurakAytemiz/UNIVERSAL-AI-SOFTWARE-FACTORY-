//TR: UASCO-T0045 (V3-F020, V3-AC-F020-1) gerileme koruması: MEVCUT CrewCoordinator + composeTeam çekirdeğini AC'ye bağlar. Tek mission'da ≥3 farklı GERÇEK rol crew sürücüsüyle çalışır, rol-rol handoff'u GERÇEK hash-zincirli journal'da (PREDEV_* girdileri) görülür ve taze store replay'i aynı ledger'ı verir. Builder yalnız TaskHub fixture'ı döndürür: canlı model/ağ/shell YOK; "hosted real model run" kanıtı bu testin kapsamı DIŞINDADIR (PR'da açık kalem). Kayıtlı bir test dosyasından çağrılır.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../../core/workos/store.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../../core/workos/predev/driver.js";
import {PRE_DEV_ROLE_MAP} from "../../core/workos/predev/types.js";
import type {ArtifactKind, PlanContent, RequirementsContent, ArchitectureContent} from "../../core/workos/predev/types.js";
import {TASKHUB_BRIEF} from "../../core/workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../../core/workos/predev/fixtures/taskhub/index.js";
import {buildCrewPlan} from "../../core/workos/crew/assignment.js";
import {deriveCoordinationLedger} from "../../core/workos/crew/ledger.js";
import {CrewCoordinator, type CrewStore, type ReworkDecider, type ReworkDecisionInput} from "../../core/workos/crew/coordinator.js";
import {composeTeam, type RoleCatalog} from "../../core/workos/crew/team-composer.js";

const SCOPE = {tenantId: "t-uasco-t0045"};
const RECORDER = "implementer@local.invalid";
const APPROVER = "reviewer@local.invalid";
const ORDER: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];

// Fixture döndüren builder; her çağrının gördüğü üst bağlamı (handoff girdisi) kaydeder.
class FixtureBuilder implements BuilderPort {
  readonly calls: Array<{kind: ArtifactKind; upstream: string[]}> = [];
  async produce(kind: ArtifactKind, _p: string, ctx: MissionContext): Promise<string> {
    this.calls.push({kind, upstream: Object.keys(ctx.approvedUpstream).sort()});
    return JSON.stringify(TASKHUB_ARTIFACTS[kind]);
  }
}
// Plan'ın ilk adayını downstream (Architecture rolü) geri gönderir; sonra kabul.
class PlanReworkOnce implements ReworkDecider {
  decide(i: ReworkDecisionInput) { return i.kind === "Plan" && i.attempt === 0 ? {accept: false as const, reason: "T0045_PLAN_INSUFFICIENT"} : {accept: true as const}; }
}

type JournalLine = {seq: number; type: string; actor: string; payload: Record<string, unknown>};
const readJournal = (dir: string): JournalLine[] =>
  fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as JournalLine);

export function registerCrewCoordinatorCases(): void {
  describe("UASCO-T0045 V3-AC-F020-1: CrewCoordinator + composeTeam core (regression binding)", () => {
    let tmp = "";
    let store: WorkOsStore;
    let tick = 0;
    const now = () => `2026-11-03T00:00:${String(tick++ % 60).padStart(2, "0")}.000Z`;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0045-")); store = new WorkOsStore(tmp); tick = 0; });
    afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    async function runMission(decider: ReworkDecider) {
      const p = store.createProject({tenantId: SCOPE.tenantId, orgId: "org1", name: "TaskHub", environmentId: "env-dev", createdBy: RECORDER});
      const m = store.createMission({tenantId: SCOPE.tenantId, projectId: p.projectId, title: "T0045 crew", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
      store.transitionMission(SCOPE, m.missionId, "PREFLIGHT", "preflight", RECORDER);
      store.transitionMission(SCOPE, m.missionId, "AUTHORIZED", "authorized", RECORDER);
      const builder = new FixtureBuilder();
      const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});
      const plan = buildCrewPlan();
      const coord = new CrewCoordinator({store: store as unknown as CrewStore, driver, plan, brief: TASKHUB_BRIEF, builder, decider, maxReworkPerPhase: 2, recorder: RECORDER, approver: APPROVER, now});
      const res = await coord.run(SCOPE, m.missionId);
      return {missionId: m.missionId, res, builder, plan};
    }

    it("one mission: >=3 distinct real roles are driven by the crew coordinator and every phase is independently approved", async () => {
      const {res, missionId} = await runMission({decide: () => ({accept: true})});
      expect(res.status).toBe("PRE_DEV_COMPLETE");
      if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");
      const roles = new Set(ORDER.map(k => res.assignments[k].roleId));
      expect(roles.size).toBeGreaterThanOrEqual(3);
      for (const k of ORDER) {
        expect(res.assignments[k].roleId).toBe(PRE_DEV_ROLE_MAP[k][0]);
        expect(res.assignments[k].state).toBe("APPROVED");
      }
      // Her rolün artefaktı aynı mission'a ve aynı pre-dev dizisine aittir (tek mission).
      const arts = store.listPreDevArtifacts(SCOPE, res.preDevId);
      expect(new Set(arts.map(a => a.missionId))).toEqual(new Set([missionId]));
      expect(new Set(arts.map(a => a.authorRoleId)).size).toBeGreaterThanOrEqual(3);
      expect(store.preDevReadModel(SCOPE, missionId).phase).toBe("PRE_DEV_COMPLETE");
    });

    it("handoff: each downstream role is fed the upstream role's APPROVED output, and the hand-over order is in the hash-chained journal", async () => {
      const {res, builder} = await runMission({decide: () => ({accept: true})});
      if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");
      // Builder çağrı sırası faz sırasıdır; Requirements BA'yı, Plan Requirements'ı, Architecture Plan'ı onaylı üst olarak görür.
      expect(builder.calls.map(c => c.kind)).toEqual([...ORDER]);
      expect(builder.calls.find(c => c.kind === "BusinessAnalysis")!.upstream).toEqual([]);
      expect(builder.calls.find(c => c.kind === "Requirements")!.upstream).toContain("BusinessAnalysis");
      expect(builder.calls.find(c => c.kind === "Plan")!.upstream).toContain("Requirements");
      expect(builder.calls.find(c => c.kind === "Architecture")!.upstream).toContain("Plan");

      // Journal: her faz için upstream APPROVED geçişi + PHASE_ADVANCED, downstream RECORDED'dan ÖNCE gelir.
      const j = readJournal(tmp);
      const byId = new Map(store.listPreDevArtifacts(SCOPE, res.preDevId).map(a => [a.id, a]));
      const recordedSeq = (k: ArtifactKind) => j.find(e => e.type === "PREDEV_ARTIFACT_RECORDED" && (e.payload.entity as {kind: string}).kind === k)!.seq;
      const approvedSeq = (k: ArtifactKind) => j.find(e => e.type === "PREDEV_ARTIFACT_TRANSITIONED" && e.payload.to === "APPROVED" && byId.get(String(e.payload.artifactId))?.kind === k)!;
      for (let i = 1; i < ORDER.length; i++) {
        const up = approvedSeq(ORDER[i - 1]);
        expect(up.actor).toBe(APPROVER);
        expect(up.actor).not.toBe(RECORDER);
        const adv = j.find(e => e.type === "PREDEV_PHASE_ADVANCED" && e.seq > up.seq)!;
        expect(adv).toBeTruthy();
        expect(adv.seq).toBeLessThan(recordedSeq(ORDER[i]));
      }
      // Kayıtlı artefaktların yazarları journal'da GERÇEK rol kimlikleridir.
      const authors = j.filter(e => e.type === "PREDEV_ARTIFACT_RECORDED").map(e => (e.payload.entity as {authorRoleId: string}).authorRoleId);
      expect(authors).toEqual(ORDER.map(k => PRE_DEV_ROLE_MAP[k][0]));
    });

    it("rework handoff (downstream -> upstream) is journalled with the downstream role as actor and the ledger replays identically from a fresh store", async () => {
      const {res, plan, missionId} = await runMission(new PlanReworkOnce());
      if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");
      const archRole = PRE_DEV_ROLE_MAP.Architecture[0];
      const j = readJournal(tmp);
      const rej = j.find(e => e.type === "PREDEV_ARTIFACT_TRANSITIONED" && e.payload.to === "REJECTED")!;
      expect(rej.actor).toBe(archRole);
      expect(rej.payload.artifactId).toBe(res.reworkRequests[0].targetArtifactId);
      expect(res.reworkRequests[0]).toMatchObject({targetKind: "Plan", requestedByRoleId: archRole, upstreamRoleId: PRE_DEV_ROLE_MAP.Plan[0], reason: "T0045_PLAN_INSUFFICIENT"});

      const store2 = new WorkOsStore(tmp);
      expect(store2.journalHealth().state).toBe("OK");
      const replayed = deriveCoordinationLedger(plan, missionId, res.preDevId, store2.listPreDevArtifacts(SCOPE, res.preDevId), res.reworkRequests);
      expect(replayed.experts).toEqual(res.ledger.experts);
      expect(replayed.experts.find(e => e.kind === "Plan")!.reworkCount).toBe(1);
    });

    it("composeTeam over the run's APPROVED outputs and the real catalog proposes >=3 real roles, advisory only", async () => {
      const {res} = await runMission({decide: () => ({accept: true})});
      if (res.status !== "PRE_DEV_COMPLETE") throw new Error("unreachable");
      const content = (k: ArtifactKind) => store.listPreDevArtifacts(SCOPE, res.preDevId).find(a => a.kind === k && a.state === "APPROVED")!.content;
      const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "registries", "role-definitions.json"), "utf8"));
      const catalog: RoleCatalog = {roles: raw.roles, guilds: raw.guilds, clusters: raw.clusters};
      const team = composeTeam(TASKHUB_BRIEF, {requirements: content("Requirements") as RequirementsContent, plan: content("Plan") as PlanContent, architecture: content("Architecture") as ArchitectureContent}, catalog);
      const ids = new Set(catalog.roles.map(r => r.roleId));
      expect(team.selections.length).toBeGreaterThanOrEqual(3);
      for (const s of team.selections) expect(ids.has(s.roleId)).toBe(true);
      for (const k of ORDER) expect(team.selections.some(s => s.roleId === res.assignments[k].roleId)).toBe(true);
      expect(team).toMatchObject({advisory: true, activation: "NONE_PROPOSAL_ONLY", liveAgentCount: 0, certifiedWorkerCount: 0});
      // Deterministik: aynı girdi -> aynı öneri.
      expect(composeTeam(TASKHUB_BRIEF, {requirements: content("Requirements") as RequirementsContent, plan: content("Plan") as PlanContent, architecture: content("Architecture") as ArchitectureContent}, catalog)).toEqual(team);
    });
  });
}
