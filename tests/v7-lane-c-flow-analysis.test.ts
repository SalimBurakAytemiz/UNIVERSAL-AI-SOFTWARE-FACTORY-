// //TR: C-FLOW-ANALYSIS-1: fikir (intake) -> analiz (BA, Requirements/kabul kriterleri, Plan/iş paketleri, Architecture kararı) -> görev planı. Sahte BuilderPort (model yok); gerçek store, gerçek PreDevDriver, gerçek doğrulayıcılar, gerçek submitPlan. Hazır değilse kesin engel (BLOCKED) ve hiçbir şey kaydedilmez.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {submitIntake} from "../core/workos/intake.js";
import {submitPlan} from "../core/workos/plan.js";
import {briefFromRecords} from "../core/workos/predev/brief.js";
import {PreDevDriver} from "../core/workos/predev/driver.js";
import type {BuilderPort} from "../core/workos/predev/driver.js";
import {PREDEV_AGENT_ACTOR, PreDevBuilderError} from "../core/workos/predev/claude-builder.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
import {PRE_DEV_ROLE_MAP} from "../core/workos/predev/types.js";
import type {ArtifactKind, PlanContent, RequirementsContent} from "../core/workos/predev/types.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import {ensureClaudeProfile, claudeProfileDir} from "../core/workos/claude-profiles.js";
import type {ClaudeCliStatus} from "../core/workos/claude-profiles.js";
import {ANALYSIS_KINDS, AnalysisFlow, NO_ANALYSIS_BUILDER, claudeAnalysisReadiness, tasksFromPlan} from "../core/workos/crew/analysis.js";
import type {AnalysisReadiness} from "../core/workos/crew/analysis.js";

let tmp = "";
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-fa-")); });
afterEach(() => { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

const SCOPE = {tenantId: "tA"};
const READY: AnalysisReadiness = {ready: true, blockers: [], blocker: null, founderAction: null, profiles: null};
const IDEA = "A small team task board with deadlines and reminders for freelancers who juggle several clients";

function setup(builderOverride?: (kind: ArtifactKind, n: number) => string | Error | undefined, readiness: () => AnalysisReadiness = () => READY) {
  const store = new WorkOsStore(path.join(tmp, "data"));
  const {intake} = submitIntake({store, scope: SCOPE, orgId: "o1", actor: "FOUNDER_LOCAL"}, {idea: IDEA, projectType: "web", targetOS: ["web"]});
  const calls: Array<{kind: ArtifactKind; prompt: string; upstream: ArtifactKind[]}> = [];
  const builder: BuilderPort = {
    async produce(kind, rolePrompt, ctx) {
      calls.push({kind, prompt: rolePrompt, upstream: Object.keys(ctx.approvedUpstream) as ArtifactKind[]});
      const o = builderOverride?.(kind, calls.filter(c => c.kind === kind).length);
      if (o instanceof Error) throw o;
      return o ?? JSON.stringify(TASKHUB_ARTIFACTS[kind]);
    }
  };
  const flow = new AnalysisFlow({store, scope: SCOPE, builder, readiness});
  const mission = store.getMission(SCOPE, intake.missionId)!, project = store.getProject(SCOPE, intake.projectId)!;
  const founder = new PreDevDriver({store, brief: briefFromRecords({project, mission}), builder});
  const approve = (artifactId: string, approver = "FOUNDER_LOCAL") => founder.approveAndAdvance(SCOPE, intake.missionId, artifactId, approver, ["ev-founder-review-1"]);
  return {store, flow, calls, approve, founder, missionId: intake.missionId, projectId: intake.projectId, rm: () => store.preDevReadModel(SCOPE, intake.missionId)};
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
  const FOUND: ClaudeCliStatus = {state: "FOUND", path: "/x/claude", kind: "EXECUTABLE", source: "PATH", pathDir: null, searched: [], founderAction: null};
  const NOT_FOUND: ClaudeCliStatus = {state: "NOT_FOUND", path: null, kind: null, source: null, pathDir: null, searched: ["/a"], founderAction: "install claude"};
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
