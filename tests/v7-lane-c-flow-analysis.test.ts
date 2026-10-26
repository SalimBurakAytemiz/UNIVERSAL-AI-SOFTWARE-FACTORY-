// //TR: C-FLOW-ANALYSIS-1: fikir (intake) -> analiz (BA, Requirements/kabul kriterleri, Plan/iş paketleri, Architecture kararı) -> görev planı. Sahte BuilderPort (model yok); gerçek store, gerçek PreDevDriver, gerçek doğrulayıcılar, gerçek submitPlan. Hazır değilse kesin engel (BLOCKED) ve hiçbir şey kaydedilmez.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WorkOsStore} from "../core/workos/store.js";
import {LocalClaudeExecutors, reviewerArgv, runProcess} from "../core/workos/executors.js";
import type {ProcOptions, ProcResult} from "../core/workos/executors.js";
import {OUTPUT_SKELETONS, PLACEHOLDER_MARKER, composeRolePrompt} from "../core/workos/predev/role-prompts.js";
import {validateArtifactContent} from "../core/workos/predev/validators.js";
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
const REPO = path.resolve(import.meta.dirname, "..");
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

// ---------------------------------------------------------------------------------------------------------------------------
// C-FLOW-ANALYSIS-2: real analysis content. The production BuilderPort (ClaudePreDevBuilder from LocalClaudeExecutors) runs against a
// FAKE Claude CLI: a real child process (a node script standing in for `claude -p --output-format json`) started by the real
// runProcess, so timeouts, process-group kills, stdin, exit codes and the scratch directory are the production ones. No model, no network.
// ---------------------------------------------------------------------------------------------------------------------------
describe("C-FLOW-ANALYSIS-2: the Desktop analysis through the production builder and a fake Claude CLI process", () => {
  const FOUND: ClaudeCliStatus = {state: "FOUND", path: process.execPath, kind: "EXECUTABLE", source: "PATH", pathDir: null, searched: [], founderAction: null};
  const T = {timeout: 120_000};
  type Scenario = {stdout?: string; stderr?: string; exit?: number; sleepMs?: number; touch?: boolean; echoSkeleton?: boolean};
  const envelope = (result: unknown, over: Record<string, unknown> = {}) => JSON.stringify({type: "result", subtype: "success", is_error: false, duration_ms: 1200, num_turns: 1, result, session_id: "s-1", total_cost_usd: 0.0123, ...over}) + "\n";
  const good = (kind: ArtifactKind) => envelope(JSON.stringify(TASKHUB_ARTIFACTS[kind]));

  function rig(o: {login?: boolean; timeoutMs?: number} = {}) {
    const control = path.join(tmp, "userdata", "control"), data = path.join(tmp, "data");
    const script = path.join(tmp, "fake-claude.mjs"), scenarioFile = path.join(tmp, "scenario.json"), logFile = path.join(tmp, "calls.jsonl");
    const sha = crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");
    fs.mkdirSync(path.join(control, ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(control, ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", claude: {provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: process.execPath, launcherSha256: sha, version: "fake"}}));
    for (const role of ["implementer", "reviewer"] as const) if (o.login !== false) { ensureClaudeProfile(control, role, {forbiddenRoots: [data]}); fs.writeFileSync(path.join(claudeProfileDir(control, role), ".credentials.json"), ""); }
    fs.writeFileSync(script, `import fs from "node:fs";
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const prompt = Buffer.concat(chunks).toString("utf8");
const kind = /# ARTEFAKT TÜRÜ: (\\w+)/.exec(prompt)?.[1];
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({kind, pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd(), cfg: process.env.CLAUDE_CONFIG_DIR, keys: Object.keys(process.env).filter(k => /ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i.test(k)), prompt: prompt.length}) + "\\n");
const sc = JSON.parse(fs.readFileSync(${JSON.stringify(scenarioFile)}, "utf8")); const s = sc[kind] ?? sc["*"] ?? {};
if (s.sleepMs) await new Promise(r => setTimeout(r, s.sleepMs));
if (s.touch) fs.writeFileSync("STRAY.txt", "x");
let out = s.stdout;
if (s.echoSkeleton) out = JSON.stringify({type: "result", subtype: "success", is_error: false, result: prompt.slice(prompt.lastIndexOf("\\n{\\n") + 1)}) + "\\n";
if (out !== undefined) process.stdout.write(out);
if (s.stderr) process.stderr.write(s.stderr);
process.exit(s.exit ?? 0);
`);
    const scenario = (s: Record<string, Scenario>) => fs.writeFileSync(scenarioFile, JSON.stringify(s));
    scenario({});
    const runReviewer = (argv: string[], po: ProcOptions): Promise<ProcResult> => runProcess([process.execPath, script, ...argv.slice(1)], o.timeoutMs ? {...po, timeoutMs: o.timeoutMs} : po);
    const pair = () => new LocalClaudeExecutors(REPO, control, {runReviewer, profile: {forbiddenRoots: [data]}}).pair();
    let last: ReturnType<NonNullable<ReturnType<typeof pair>["preDevBuilder"]>> | null = null;
    const builder: BuilderPort = {produce(kind, prompt, ctx) { last = pair().preDevBuilder!(); return last.produce(kind, prompt, ctx); }};
    const readiness = () => claudeAnalysisReadiness({controlRoot: control, profile: {forbiddenRoots: [data]}, cli: FOUND});
    const store = new WorkOsStore(path.join(tmp, "data"));
    const {intake} = submitIntake({store, scope: SCOPE, orgId: "o1", actor: "FOUNDER_LOCAL"}, {idea: IDEA, projectType: "web", targetOS: ["web"]});
    const flow = new AnalysisFlow({store, scope: SCOPE, builder, readiness});
    const mission = store.getMission(SCOPE, intake.missionId)!, project = store.getProject(SCOPE, intake.projectId)!;
    const founder = new PreDevDriver({store, brief: briefFromRecords({project, mission}), builder});
    return {
      control, store, flow, scenario, missionId: intake.missionId, builder: () => last, readiness,
      spawns: (): Array<{kind: string; pid: number; argv: string[]; cwd: string; cfg: string; keys: string[]; prompt: number}> => fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [],
      rm: () => store.preDevReadModel(SCOPE, intake.missionId),
      approve: (artifactId: string) => founder.approveAndAdvance(SCOPE, intake.missionId, artifactId, "FOUNDER_LOCAL", ["ev-founder-review-1"])
    };
  }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it("good output: all four roles produce real drafts through the production builder; one process per draft, read-only json argv, reviewer profile, empty scratch outside the repo, no API key; the approved plan becomes tasks", T, async () => {
    const t = rig();
    t.scenario({"*": {}, ...Object.fromEntries(ANALYSIS_KINDS.map(k => [k, {stdout: good(k)}]))});
    const prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    try {
      for (const [i, kind] of ANALYSIS_KINDS.entries()) {
        const r = await t.flow.step(t.missionId);
        expect(r).toMatchObject({status: "DRAFT_READY", kind, version: 1, roleId: PRE_DEV_ROLE_MAP[kind][0]});
        expect(t.spawns()).toHaveLength(i + 1); // exactly one paid call per draft
        const trace = t.builder()!.lastTrace!;
        expect(trace).toMatchObject({kind, failure: null, exitCode: 0, roleId: PRE_DEV_ROLE_MAP[kind][0]});
        expect(trace.outputSha256).toBe(crypto.createHash("sha256").update(JSON.stringify(TASKHUB_ARTIFACTS[kind])).digest("hex"));
        const art = t.store.getPreDevArtifact(SCOPE, (r as {artifactId: string}).artifactId)!;
        expect(art).toMatchObject({state: "DRAFT", recordedBy: PREDEV_AGENT_ACTOR, content: TASKHUB_ARTIFACTS[kind]}); // the draft IS the model's content
        t.approve(art.id);
      }
    } finally { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; }
    expect(await t.flow.step(t.missionId)).toMatchObject({status: "COMPLETE"});
    const calls = t.spawns();
    for (const c of calls) {
      expect(c.argv).toEqual(reviewerArgv(process.execPath, "json").slice(1)); // read-only tools + isolation flags, -p, --output-format json
      expect(c.argv.slice(-2)).toEqual(["--output-format", "json"]);
      expect(c.cfg).toBe(claudeProfileDir(t.control, "reviewer"));
      expect(c.keys).toEqual([]); // no paid API key reaches the process
      expect(c.prompt).toBeGreaterThan(500);
      const rel = path.relative(REPO, c.cwd); expect(rel.startsWith("..") || path.isAbsolute(rel)).toBe(true);
      expect(fs.existsSync(c.cwd)).toBe(false); // the scratch directory is gone
    }
    expect(new Set(calls.map(c => c.cwd)).size).toBe(4);
    expect(calls.map(c => c.kind)).toEqual([...ANALYSIS_KINDS]);
    const plan = t.flow.createPlan(t.missionId, "FOUNDER_LOCAL");
    expect(plan.ok && plan.tasks.length).toBe(6);
  });

  it("one ```json fence around the WHOLE reply is unwrapped; prose around the JSON, two fences, a bare brace-less reply are not repaired: REJECTED with the exact driver code, nothing recorded", T, async () => {
    const fenced = "```json\n" + JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis, null, 2) + "\n```";
    const t = rig();
    t.scenario({"*": {stdout: envelope(fenced + "\n")}}); // the CLI may end its text with a newline
    const ok = await t.flow.step(t.missionId);
    expect(ok.status).toBe("DRAFT_READY");
    expect(t.store.getPreDevArtifact(SCOPE, (ok as {artifactId: string}).artifactId)!.content).toEqual(TASKHUB_ARTIFACTS.BusinessAnalysis);
    for (const [name, text] of [
      ["prose before", "Here is the analysis:\n" + JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis)],
      ["prose before a fence", "Sure!\n```json\n" + JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis) + "\n```"],
      ["prose after", "```json\n" + JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis) + "\n```\nHope this helps!"],
      ["two fences", "```json\n{}\n```\n```json\n" + JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis) + "\n```"],
      ["not json", "I could not produce the analysis."]
    ] as const) {
      fs.rmSync(path.join(tmp, "calls.jsonl"), {force: true}); fs.rmSync(path.join(tmp, "data"), {recursive: true, force: true}); // fresh spawn log and store per case
      const u = rig();
      u.scenario({"*": {stdout: envelope(text)}});
      expect([name, await u.flow.step(u.missionId)]).toEqual([name, {status: "REJECTED", kind: "BusinessAnalysis", reason: "PREDEV_DRIVER_INVALID_JSON"}]);
      expect([name, u.rm().artifacts.BusinessAnalysis.state]).toEqual([name, "NOT_STARTED"]);
      expect([name, u.spawns().length]).toEqual([name, 1]); // a rejection never re-spawns on its own
    }
  });

  it("malformed JSON and schema misses are REJECTED with the validator's exact code (BA_SHAPE, REQ_TRACEABILITY_BROKEN), never repaired; the corrected retry is a second, separate call", T, async () => {
    const t = rig();
    const ba = TASKHUB_ARTIFACTS.BusinessAnalysis as unknown as Record<string, unknown>;
    const {problem: _drop, ...noProblem} = ba;
    t.scenario({"*": {stdout: envelope('{"problem": "cut off')}});
    expect(await t.flow.step(t.missionId)).toEqual({status: "REJECTED", kind: "BusinessAnalysis", reason: "PREDEV_DRIVER_INVALID_JSON"});
    t.scenario({"*": {stdout: envelope(JSON.stringify(noProblem))}});
    expect(await t.flow.step(t.missionId)).toEqual({status: "REJECTED", kind: "BusinessAnalysis", reason: "BA_SHAPE"});
    t.scenario({"*": {stdout: envelope(JSON.stringify({...ba, extra: "smuggled"}))}});
    expect(await t.flow.step(t.missionId)).toMatchObject({status: "REJECTED", reason: "BA_SHAPE"}); // an unknown key is a miss too
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED");
    expect(t.spawns()).toHaveLength(3);
    t.scenario({"*": {stdout: good("BusinessAnalysis")}});
    const r = await t.flow.step(t.missionId); expect(r.status).toBe("DRAFT_READY");
    t.approve((r as {artifactId: string}).artifactId);
    // downstream traceability: requirements that trace to a goal that is not in the approved analysis
    const reqs = JSON.parse(JSON.stringify(TASKHUB_ARTIFACTS.Requirements)) as RequirementsContent;
    reqs.functional[0].tracesTo = ["G99"];
    t.scenario({"*": {stdout: envelope(JSON.stringify(reqs))}});
    expect(await t.flow.step(t.missionId)).toEqual({status: "REJECTED", kind: "Requirements", reason: "REQ_TRACEABILITY_BROKEN"});
    expect(t.spawns()).toHaveLength(5);
    expect(t.rm().artifacts.Requirements.state).toBe("NOT_STARTED");
  });

  it("an echoed output skeleton cannot pass: every placeholder is rejected as PREDEV_DRIVER_PLACEHOLDER_VALUE (the skeleton is shape-valid, so only the guard stops it)", T, async () => {
    const t = rig();
    t.scenario({"*": {echoSkeleton: true}});
    expect(await t.flow.step(t.missionId)).toEqual({status: "REJECTED", kind: "BusinessAnalysis", reason: "PREDEV_DRIVER_PLACEHOLDER_VALUE"});
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED");
    expect(t.spawns()).toHaveLength(1);
  });

  it("timeout: the fake CLI hangs -> BUILDER_FAILED PREDEV_BUILDER_TIMEOUT, the process (group) is killed, nothing recorded; the retry after the cause is gone produces", T, async () => {
    const t = rig({timeoutMs: 1_500});
    t.scenario({"*": {sleepMs: 60_000, stdout: good("BusinessAnalysis")}});
    const t0 = Date.now();
    expect(await t.flow.step(t.missionId)).toEqual({status: "BUILDER_FAILED", kind: "BusinessAnalysis", code: "PREDEV_BUILDER_TIMEOUT"});
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(t.builder()!.lastTrace).toMatchObject({failure: "PREDEV_BUILDER_TIMEOUT", outputSha256: null});
    const [c] = t.spawns(); expect(c.kind).toBe("BusinessAnalysis");
    expect(alive(c.pid)).toBe(false);
    expect(t.rm().artifacts.BusinessAnalysis.state).toBe("NOT_STARTED");
    t.scenario({"*": {stdout: good("BusinessAnalysis")}});
    expect((await t.flow.step(t.missionId)).status).toBe("DRAFT_READY");
    expect(t.spawns()).toHaveLength(2);
  });

  it("login required / expired: the exact PREDEV_BUILDER_LOGIN_EXPIRED whether the CLI says it on the envelope (exit 1 or 0), on stdout or on stderr; any other failure keeps its own exact code", T, async () => {
    const loginMsg = "Invalid API key · Please run /login";
    const cases: Array<[string, Scenario, string]> = [
      ["envelope is_error + exit 1", {stdout: envelope(loginMsg, {is_error: true}), exit: 1}, "PREDEV_BUILDER_LOGIN_EXPIRED"],
      ["envelope is_error + exit 0", {stdout: envelope(loginMsg, {is_error: true}), exit: 0}, "PREDEV_BUILDER_LOGIN_EXPIRED"],
      ["plain stdout + exit 1", {stdout: loginMsg + "\n", exit: 1}, "PREDEV_BUILDER_LOGIN_EXPIRED"],
      ["stderr only + exit 1", {stderr: "Error: OAuth token has expired\n", exit: 1}, "PREDEV_BUILDER_LOGIN_EXPIRED"],
      ["oauth revoked in the envelope", {stdout: envelope("OAuth token revoked · Please run /login", {is_error: true, subtype: "error_during_execution"}), exit: 1}, "PREDEV_BUILDER_LOGIN_EXPIRED"],
      ["exit 1, no auth text", {stdout: "", stderr: "boom\n", exit: 1}, "PREDEV_BUILDER_EXIT_NONZERO"],
      ["is_error, not auth", {stdout: envelope("Credit balance is too low", {is_error: true}), exit: 0}, "PREDEV_BUILDER_CLI_ERROR"],
      ["max turns", {stdout: envelope("", {subtype: "error_max_turns"}), exit: 0}, "PREDEV_BUILDER_CLI_ERROR"],
      ["success text that mentions /login is NOT an auth failure", {stdout: envelope("Please run /login\n" + JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis)), exit: 0}, "REJECTED:PREDEV_DRIVER_INVALID_JSON"],
      ["plain JSON, no envelope", {stdout: JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis), exit: 0}, "PREDEV_BUILDER_ENVELOPE_INVALID"],
      ["array of events", {stdout: JSON.stringify([{type: "result", subtype: "success", is_error: false, result: "{}"}]), exit: 0}, "PREDEV_BUILDER_ENVELOPE_INVALID"],
      ["envelope without result text", {stdout: JSON.stringify({type: "result", subtype: "success", is_error: false}), exit: 0}, "PREDEV_BUILDER_ENVELOPE_INVALID"],
      ["empty result", {stdout: envelope("   "), exit: 0}, "PREDEV_BUILDER_EMPTY_OUTPUT"],
      ["no stdout at all", {stdout: "", exit: 0}, "PREDEV_BUILDER_EMPTY_OUTPUT"],
      ["the process wrote into its scratch", {stdout: good("BusinessAnalysis"), touch: true}, "PREDEV_BUILDER_SCRATCH_MODIFIED"]
    ];
    for (const [name, sc, expected] of cases) {
      const t = rig();
      t.scenario({"*": sc});
      const r = await t.flow.step(t.missionId);
      const got = r.status === "BUILDER_FAILED" ? r.code : r.status === "REJECTED" ? `REJECTED:${r.reason}` : r.status;
      expect([name, got]).toEqual([name, expected]);
      expect([name, t.rm().artifacts.BusinessAnalysis.state]).toEqual([name, "NOT_STARTED"]);
      expect([name, t.spawns().length]).toEqual([name, 1]);
      fs.rmSync(path.join(tmp, "calls.jsonl"), {force: true}); fs.rmSync(path.join(tmp, "data"), {recursive: true, force: true});
    }
  });

  it("claudeAnalysisReadiness gates every spawn: not signed in, launcher changed after readiness, or the CLI missing -> no process is ever started", T, async () => {
    const t = rig({login: false});
    t.scenario({"*": {stdout: good("BusinessAnalysis")}});
    const blocked = await t.flow.step(t.missionId);
    expect(blocked).toMatchObject({status: "BLOCKED", blocker: "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED"});
    expect((blocked as {blockers: string[]}).blockers).toEqual(["implementer:CLAUDE_PROFILE_LOGIN_REQUIRED", "reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"]);
    expect(t.spawns()).toHaveLength(0);
    expect(t.rm()).toMatchObject({active: false, phase: "NOT_STARTED"});

    // readiness passed once, then the launcher bytes change: the builder's own provenance check stops the spawn (defence in depth)
    const u = rig();
    u.scenario({"*": {stdout: good("BusinessAnalysis")}});
    expect(u.readiness().ready).toBe(true);
    const prov = path.join(u.control, ".ai", "runtime", "PROVIDER_PROVENANCE.json");
    fs.writeFileSync(prov, fs.readFileSync(prov, "utf8").replace(/"launcherSha256":"[0-9a-f]{64}"/, `"launcherSha256":"${"0".repeat(64)}"`));
    expect(await u.flow.step(u.missionId)).toMatchObject({status: "BLOCKED", blocker: "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"});
    expect(u.spawns()).toHaveLength(0);
  });

  it("the roles' prompts carry a per-kind output skeleton whose keys are exactly the validators' keys; a filled skeleton passes the REAL validators chain (G1 -> FR1 -> S1/WP1 -> C1)", () => {
    const fill = (x: unknown): unknown => typeof x === "string" ? (x.includes(PLACEHOLDER_MARKER) ? "filled text" : x) : Array.isArray(x) ? x.map(fill) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)])) : x;
    const filled = Object.fromEntries((Object.keys(OUTPUT_SKELETONS) as ArtifactKind[]).map(k => [k, fill(OUTPUT_SKELETONS[k])])) as Record<ArtifactKind, any>;
    filled.Requirements.functional[0].tracesTo = ["G1"]; filled.Requirements.nonFunctional[0].tracesTo = ["G1"];
    filled.Plan.workPackages[0].satisfies = ["FR1", "NFR1"];
    filled.Architecture.components[0].covers = ["S1"];
    expect(validateArtifactContent("BusinessAnalysis", filled.BusinessAnalysis)).toEqual({ok: true});
    expect(validateArtifactContent("Requirements", filled.Requirements, {businessAnalysis: filled.BusinessAnalysis})).toEqual({ok: true});
    expect(validateArtifactContent("Plan", filled.Plan, {requirements: filled.Requirements})).toEqual({ok: true});
    expect(validateArtifactContent("Architecture", filled.Architecture, {plan: filled.Plan})).toEqual({ok: true});
    expect(validateArtifactContent("UxSpec", filled.UxSpec)).toEqual({ok: true});
    for (const k of Object.keys(OUTPUT_SKELETONS) as ArtifactKind[]) {
      const prompt = composeRolePrompt(k, {brief: {projectName: "p", isReference: false, label: "l", summary: "s", stakeholders: [], objectives: [], constraints: [], outOfScope: [], notes: []}, approvedUpstream: {}});
      expect([k, prompt.endsWith(JSON.stringify(OUTPUT_SKELETONS[k], null, 2))]).toEqual([k, true]);
      expect([k, JSON.stringify(OUTPUT_SKELETONS[k]).includes(PLACEHOLDER_MARKER)]).toEqual([k, true]);
    }
    // the traceability slots are placeholders: copying the skeleton cannot satisfy the real chain
    expect(validateArtifactContent("Requirements", OUTPUT_SKELETONS.Requirements, {businessAnalysis: filled.BusinessAnalysis})).toEqual({ok: false, errors: "REQ_TRACEABILITY_BROKEN"});
  });

  it("the placeholder guard looks at every string, at any depth, keys included; honest text that merely looks similar passes", T, async () => {
    const poison = (mutate: (c: any) => void) => { const c = JSON.parse(JSON.stringify(TASKHUB_ARTIFACTS.BusinessAnalysis)); mutate(c); return JSON.stringify(c); };
    for (const [name, out] of [
      ["goal statement", poison(c => { c.goals[0].statement = `${PLACEHOLDER_MARKER}: goal>>`; })],
      ["last risk", poison(c => { c.risks[c.risks.length - 1] = `see ${PLACEHOLDER_MARKER}: x>>`; })],
      ["a key (the guard runs before the shape check)", poison(c => { c[`${PLACEHOLDER_MARKER}: key>>`] = "x"; })]
    ] as const) {
      const t = setup(() => out);
      expect([name, await t.flow.step(t.missionId)]).toEqual([name, {status: "REJECTED", kind: "BusinessAnalysis", reason: "PREDEV_DRIVER_PLACEHOLDER_VALUE"}]);
      expect([name, t.rm().artifacts.BusinessAnalysis.state]).toEqual([name, "NOT_STARTED"]);
    }
    const honest = setup(() => poison(c => { c.assumptions.push("Users fill in <<name>> fields and the word FILL appears in text"); }));
    expect((await honest.flow.step(honest.missionId)).status).toBe("DRAFT_READY");
  });
});
