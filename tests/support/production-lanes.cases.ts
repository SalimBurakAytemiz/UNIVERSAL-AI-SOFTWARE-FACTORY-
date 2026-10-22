// //TR: A-Z üretim hattı kaydı (docs/planning/LANES.json) ve mevcut dispatcher entegrasyonu (dispatch.mjs --plan / --claim --lane) için birim ve entegrasyon testleri. Gerçek kayıt, gerçek lanes.mjs ve gerçek dispatch.mjs geçici bir bare git remote'a karşı çalışır; iki bağımsız görevin eşzamanlı claim'i ve çakışan görevlerin sıralı işlenmesi gerçek claim ref'leriyle kanıtlanır. Kayıtlı bir test dosyasından çağrılır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import * as L from "../../docs/planning/lanes.mjs";

const LANES_FILE = "docs/planning/LANES.json";
const DISPATCH = path.resolve("docs/planning/dispatch.mjs");
const realDoc = () => JSON.parse(fs.readFileSync(LANES_FILE, "utf8"));
const reg = () => L.loadLaneRegistry(LANES_FILE);
const codeOf = (fn: () => unknown) => { try { fn(); return "NO_THROW"; } catch (e) { return (e as {code?: string}).code ?? "NO_CODE"; } };
const T = (id: string, files: string[], extra: Record<string, unknown> = {}) =>
  ({id, status: "READY", owner: "CLOUD", authorizedBy: "FOUNDER:test", dependsOn: [], protectedEdit: false, requiresNewAuthority: false, files, ...extra});
const plan = (tasks: Record<string, unknown>[], inFlight: L.InFlight[] = [], registry = reg()) =>
  L.planLanes({tasks, eligible: new Set(tasks.map(t => String(t.id))), inFlight, registry});
const at = (p: L.LanePlan, id: string) => p.assignments.find(a => a.taskId === id);

// Session owners of Lanes A, B and C before the A-Z registry (PRODUCTION-QUEUE.json productionLanes, 2026-10-21): kept unchanged.
const KEPT = {A: "session_01MApoJPisUKhZdWpTJmcnY3", B: "session_01VaHcvhtW9yjHAsFktdTn5f", C: "session_01Vf5LYEF7vPGkRwL6X5AeGT"} as const;

export function registerProductionLaneCases() {
  describe("A-Z production lane registry", () => {
    it("defines exactly 26 lanes A-Z, each with ownership, task types, allowed paths and dependency constraints", () => {
      const r = reg(), doc = realDoc();
      expect(r.lanes.map(l => l.id).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      for (const l of r.lanes) {
        expect(l.taskTypes.length).toBeGreaterThan(0);
        expect(l.paths.length).toBeGreaterThan(0);
        expect(Array.isArray(l.dependsOnLanes)).toBe(true);
        expect(l.status === "ACTIVE" ? typeof l.session === "string" : l.session === null).toBe(true);
      }
      expect(doc.canonicalBacklog).toBe("docs/planning/BACKLOG_CHECKPOINT.json");
      expect(doc.dispatcher).toBe("docs/planning/dispatch.mjs");
      expect(r.lanes.filter(l => l.status === "ACTIVE").map(l => l.id).join("")).toBe("ABCZ");
    });

    it("keeps the existing Lane A/B/C owners and their owned paths", () => {
      const r = reg();
      for (const [id, session] of Object.entries(KEPT)) { const l = r.byId.get(id)!; expect(l.session).toBe(session); expect(l.owner).toBe("LANE_BUILDER"); expect(l.status).toBe("ACTIVE"); }
      expect(r.byId.get("A")!.paths).toContain("apps/desktop/renderer/");
      expect(r.byId.get("B")!.paths).toEqual(expect.arrayContaining(["core/", "apps/control-api/src/routes/"]));
      expect(r.byId.get("C")!.paths).toEqual(expect.arrayContaining(["core/agents/", "core/workos/runner.ts", "core/workos/crew/", "registries/role-definitions.json"]));
      const own = (f: string) => L.ownerOf(r, f)?.id;
      expect([own("apps/desktop/renderer/views/home.js"), own("core/workos/intake.ts"), own("apps/control-api/src/routes/memory.ts"),
        own("core/workos/runner.ts"), own("core/agents/role-execution.ts"), own("core/workos/store.ts")]).toEqual(["A", "B", "B", "C", "C", "Z"]);
    });

    it("never grants a protected, CI-executed or supervisor-owned path, and fails closed on every malformed registry", () => {
      const m = L.repoProtectedMatcher();
      for (const l of reg().lanes) for (const p of l.paths) expect(m(p)).toBeNull();
      const mut = (f: (d: any) => void) => { const d = realDoc(); f(d); return codeOf(() => L.validateLaneRegistry(d)); };
      expect(mut(d => { d.lanes[3].allowedPaths.push("config/"); })).toBe("LANE_PROTECTED_PATH:D");
      expect(mut(d => { d.lanes[3].allowedPaths.push("scripts/ci/"); })).toBe("LANE_CI_EXECUTED_PATH:D");
      expect(mut(d => { d.lanes[3].allowedPaths.push(".ai/runtime/"); })).toBe("LANE_SUPERVISOR_STATE_PATH:D");
      expect(mut(d => { d.lanes[3].allowedPaths.push("apps/desktop/renderer/app.js"); })).toBe("LANE_PROTECTED_PATH:D");
      expect(mut(d => { d.lanes.pop(); })).toBe("LANES_COUNT_NOT_26");
      expect(mut(d => { [d.lanes[1], d.lanes[2]] = [d.lanes[2], d.lanes[1]]; })).toBe("LANES_ORDER_INVALID:B");
      expect(mut(d => { d.lanes[4].allowedPaths.push("apps/mobile/"); })).toBe("LANE_PATH_DUPLICATE:D+E");
      expect(mut(d => { d.lanes[1].dependsOnLanes = ["A"]; })).toMatch(/^LANES_DEPENDENCY_CYCLE:/);
      expect(mut(d => { d.lanes[3].status = "ACTIVE"; })).toBe("LANE_INVALID:D:status/ownership");
      expect(mut(d => { d.lanes[0].ownership.session = null; })).toBe("LANE_INVALID:A:ownership.session");
      expect(mut(d => { d.lanes[0].allowedPaths.push("../outside/"); })).toBe("LANE_INVALID:A:allowedPaths");
      expect(mut(d => { d.lanes[0].dependsOnLanes = ["A"]; })).toBe("LANE_INVALID:A:dependsOnLanes");
      expect(mut(d => { d.capacity.ciSlots = 0; })).toBe("LANES_SCHEMA_INVALID:capacity");
      expect(codeOf(() => L.loadLaneRegistry("docs/planning/NO-SUCH-LANES.json"))).toBe("LANES_MISSING");
    });

    it("routes by the most specific owned path, ignores shared test files, refuses cross-lane, protected and CI-executed work", () => {
      const r = reg(), route = (t: Record<string, unknown>) => { const x = L.routeTask(t, r); return x.lane?.id ?? x.error; };
      expect(route(T("t1", ["apps/desktop/renderer/views/home.js", "tests/v7-b1-workos.test.ts"]))).toBe("A");
      expect(route(T("t2", ["Apps\\Desktop\\Renderer\\Views\\Home.js"]))).toBe("A");
      expect(route(T("t3", ["apps/mobile/src/app.ts", "tests/v7-mob-pairing.test.ts"]))).toBe("D");
      expect(route(T("t4", ["tests/support/test-sandbox.ts"]))).toBe("N");
      expect(route(T("t5", ["tests/new-suite.test.ts"]))).toBe("O");
      expect(route(T("t6", ["apps/desktop/backend-error.html"]))).toBe("U");
      expect(route(T("t7", ["apps/desktop/renderer/views/home.js", "core/workos/intake.ts"]))).toBe("CROSS_LANE:A+B");
      expect(route(T("t8", ["apps/desktop/renderer/app.js"]))).toBe("PROTECTED_PATH");
      expect(route(T("t9", ["package-lock.json"]))).toBe("CI_EXECUTED_PATH");
      expect(route(T("t10", ["apps/desktop/renderer/views/home.js"], {lane: "B"}))).toBe("LANE_PIN_PATH_MISMATCH:B");
      expect(route(T("t11", [], {type: "TEST"}))).toBe("O");
      expect(route(T("t12", [], {package: "MOBILE-ANDROID"}))).toBe("D");
      expect(route(T("t13", [], {}))).toBe("NO_LANE_MATCH");
      expect(route(T("t14", ["../etc/passwd"]))).toBe("MALFORMED_FILES");
    });
  });

  describe("A-Z lane planner (wave scheduling)", () => {
    it("runs two independent tasks of different lanes in the same wave (parallel)", () => {
      const p = plan([T("UI-1", ["apps/desktop/renderer/views/alpha.js"]), T("API-1", ["core/workos/beta.ts"]), T("AG-1", ["core/agents/gamma.ts"])]);
      expect(p.startNow).toEqual([{taskId: "API-1", lane: "B"}, {taskId: "UI-1", lane: "A"}, {taskId: "AG-1", lane: "C"}]);
      expect(p.assignments.every(a => a.wave === 0 && a.after.length === 0 && a.reason === "START")).toBe(true);
    });

    it("never runs two tasks whose files overlap in the same wave: the later one waits for the earlier (sequential)", () => {
      const shared = "tests/v7-shared-flow.test.ts";
      const p = plan([T("UI-2", ["apps/desktop/renderer/views/gamma.js", shared]), T("AG-2", ["core/agents/delta.ts", shared]), T("API-2", ["core/workos/eps.ts"])]);
      expect(at(p, "UI-2")).toMatchObject({wave: 0, reason: "START"});
      expect(at(p, "AG-2")).toMatchObject({wave: 1, after: ["UI-2"], reason: "AFTER_CONFLICT"});
      expect(at(p, "API-2")).toMatchObject({wave: 0, reason: "START"});
      // Directory-level and case-only differences are overlaps too (Windows checkouts).
      const q = plan([T("D-1", ["apps/desktop/renderer/views"]), T("D-2", ["Apps/Desktop/Renderer/Views/Home.js"])]);
      expect(at(q, "D-2")).toMatchObject({wave: 1, after: ["D-1"], reason: "AFTER_CONFLICT"});
    });

    it("plans upstream lanes first: a UI task that overlaps an API task waits for it even when listed first (A dependsOn B)", () => {
      const shared = "tests/v7-shared-contract.test.ts";
      const p = plan([T("UI-3", ["apps/desktop/renderer/views/zeta.js", shared]), T("API-3", ["core/workos/zeta.ts", shared])]);
      expect(at(p, "API-3")).toMatchObject({wave: 0});
      expect(at(p, "UI-3")).toMatchObject({wave: 1, after: ["API-3"], reason: "AFTER_CONFLICT"});
    });

    it("waits for overlapping in-flight work and honours lane, builder and CI capacity", () => {
      const inFlight: L.InFlight[] = [{id: "UI-0", laneId: "A", files: ["apps/desktop/renderer/views/shared.js"], building: true, prOpen: false, ciBusy: false}];
      const p = plan([T("API-4", ["core/workos/one.ts"]), T("UI-4", ["apps/desktop/renderer/views/shared.js"]), T("API-5", ["core/workos/two.ts"])], inFlight);
      expect(at(p, "UI-4")).toMatchObject({wave: 1, after: ["UI-0"], reason: "AFTER_CONFLICT"});
      expect(at(p, "API-4")).toMatchObject({wave: 0});
      expect(at(p, "API-5")).toMatchObject({wave: 1, reason: "CAPACITY"}); // Lane B maxActive 1
      const r = reg(), doc = realDoc(); doc.lanes[1].maxActive = 2; doc.capacity.builderCap = 2;
      const tight = L.validateLaneRegistry(doc);
      const q = plan([T("API-6", ["core/workos/a.ts"]), T("API-7", ["core/workos/b.ts"]), T("AG-6", ["core/agents/c.ts"])], [], tight);
      expect([at(q, "API-6")?.wave, at(q, "API-7")?.wave, at(q, "AG-6")?.wave]).toEqual([0, 0, 1]); // builderCap 2
      const busy: L.InFlight[] = Array.from({length: r.capacity.ciSlots}, (_, i) => ({id: `PR-${i}`, laneId: "C", files: [`core/agents/pr${i}.ts`], building: false, prOpen: false, ciBusy: true}));
      expect(at(plan([T("API-8", ["core/workos/c.ts"])], busy), "API-8")).toMatchObject({wave: 1, reason: "CAPACITY"}); // ciSlots full
    });

    it("defers work for STANDBY lanes and unroutable tasks with an explicit reason instead of dropping it", () => {
      const p = plan([T("MOB-X", ["apps/mobile/src/x.ts"]), T("X-1", ["apps/desktop/renderer/x.js", "core/workos/x.ts"]), T("P-1", ["config/automation.json"])]);
      expect(p.startNow).toEqual([]);
      expect(p.deferred).toEqual([{taskId: "MOB-X", lane: "D", reason: "LANE_STANDBY:D"}, {taskId: "X-1", lane: null, reason: "CROSS_LANE:A+B"}, {taskId: "P-1", lane: null, reason: "PROTECTED_PATH"}]);
    });

    it("plans the real canonical backlog deterministically: every eligible task is assigned once or deferred with a reason", () => {
      const tasks = JSON.parse(fs.readFileSync("docs/planning/BACKLOG_CHECKPOINT.json", "utf8")).tasks as Record<string, unknown>[];
      const eligible = new Set(tasks.filter(t => t.status === "READY" && t.owner === "CLOUD").map(t => String(t.id)));
      const a = L.planLanes({tasks, eligible, registry: reg()}), b = L.planLanes({tasks, eligible, registry: reg()});
      expect(a).toEqual(b);
      const seen = [...a.assignments.map(x => x.taskId), ...a.deferred.map(x => x.taskId)];
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.sort()).toEqual([...eligible].sort());
      const report = L.laneReport(tasks, reg());
      expect(report.lanes.map(l => l.lane).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      expect(report.lanes.filter(l => l.status === "STANDBY").every(l => l.gaps.includes("BUILDER_MISSING"))).toBe(true);
    });
  });

  describe("dispatch.mjs with A-Z lanes (real git claims)", {timeout: 240000}, () => {
    const G = (cwd: string, args: string[]) => {
      const r = spawnSync("git", args, {cwd, encoding: "utf8", env: {...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x"}});
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-dispatch-"));
    const bare = path.join(tmp, "remote.git"), work = path.join(tmp, "work");
    const SHARED = "tests/v7-shared-flow.test.ts";
    const tasks: Record<string, unknown>[] = [
      T("UI-1", ["apps/desktop/renderer/views/alpha.js"]),
      T("API-1", ["core/workos/beta.ts"]),
      T("AG-1", ["core/agents/delta.ts", SHARED]),
      T("UI-2", ["apps/desktop/renderer/views/gamma.js", SHARED]),
      T("MOB-1", ["apps/mobile/src/x.ts"]),
      T("X-1", ["apps/desktop/renderer/views/x.js", "core/workos/x.ts"]),
    ];
    const writeBacklog = () => fs.writeFileSync(path.join(work, "docs/planning/BACKLOG_CHECKPOINT.json"), JSON.stringify({tasks}));
    const setStatus = (id: string, status: string) => { const t = tasks.find(x => x.id === id)!; t.status = status; writeBacklog(); };
    const args = (extra: string[]) => [DISPATCH, "--lanes", path.join(work, LANES_FILE), ...extra];
    const runOnce = (extra: string[]) => {
      const r = spawnSync(process.execPath, args(extra), {cwd: work, encoding: "utf8", timeout: 120000});
      return {code: r.status, j: JSON.parse(r.stdout.trim().split(/\r?\n/).pop() || "{}"), raw: r.stdout + r.stderr};
    };
    const runAsync = (extra: string[]) => new Promise<{code: number | null; j: any}>(resolve => {
      const c = spawn(process.execPath, args(extra), {cwd: work});
      let out = ""; c.stdout.on("data", d => { out += d; });
      c.on("close", code => resolve({code, j: JSON.parse(out.trim().split(/\r?\n/).pop() || "{}")}));
    });
    const heads = () => G(bare, ["for-each-ref", "--format=%(refname)", "refs/heads/claude/"]).split("\n").filter(Boolean).sort();
    const setup = () => {
      G(tmp, ["init", "--bare", "-q", "-b", "v7/integration", bare]);
      G(tmp, ["clone", "-q", bare, work]); G(work, ["checkout", "-q", "-b", "v7/integration"]);
      fs.mkdirSync(path.join(work, "docs/planning"), {recursive: true});
      fs.copyFileSync(LANES_FILE, path.join(work, LANES_FILE));
      writeBacklog(); fs.writeFileSync(path.join(work, "README"), "x");
      G(work, ["add", "-A"]); G(work, ["commit", "-q", "-m", "base"]); G(work, ["push", "-q", "origin", "v7/integration"]);
    };

    it("--plan reads the real registry and plans parallel lanes, sequential conflicts and explicit deferrals (read-only)", () => {
      setup();
      const r = runOnce(["--plan"]);
      expect(r.code, r.raw).toBe(0);
      expect(r.j.outcome).toBe("PLAN");
      expect(r.j.plan.startNow).toEqual([{taskId: "API-1", lane: "B"}, {taskId: "UI-1", lane: "A"}, {taskId: "AG-1", lane: "C"}]);
      expect(r.j.plan.assignments.find((a: L.Assignment) => a.taskId === "UI-2")).toMatchObject({wave: 1, after: ["AG-1"], reason: "AFTER_CONFLICT"});
      expect(r.j.plan.deferred).toEqual([{taskId: "MOB-1", lane: "D", reason: "LANE_STANDBY:D"}, {taskId: "X-1", lane: null, reason: "CROSS_LANE:A+B"}]);
      expect(heads()).toEqual([]);
    });

    it("two lane builders claim two independent tasks at the same time (parallel execution through the real dispatcher)", async () => {
      const [a, b] = await Promise.all([runAsync(["--claim", "--lane", "A", "--owner", "lane-a"]), runAsync(["--claim", "--lane", "B", "--owner", "lane-b"])]);
      expect([a.code, a.j.outcome, a.j.taskId, a.j.lane]).toEqual([0, "START", "UI-1", "A"]);
      expect([b.code, b.j.outcome, b.j.taskId, b.j.lane]).toEqual([0, "START", "API-1", "B"]);
      expect(heads()).toEqual(["refs/heads/claude/api-1", "refs/heads/claude/ui-1"]);
    });

    it("conflicting tasks are claimed one after the other: UI-2 waits while AG-1 holds the shared file", () => {
      const c = runOnce(["--claim", "--lane", "C", "--owner", "lane-c"]);
      expect([c.j.outcome, c.j.taskId]).toEqual(["START", "AG-1"]);
      setStatus("UI-1", "DONE"); // Lane A is free again; only the conflict holds UI-2 now
      const wait = runOnce(["--claim", "--lane", "A", "--owner", "lane-a"]);
      expect(wait.j.outcome, wait.raw).toBe("NO_ACTION");
      expect(wait.j.reasons).toContain("UI-2:LANE_WAIT:AFTER:AG-1");
      expect(heads()).not.toContain("refs/heads/claude/ui-2");
      setStatus("AG-1", "DONE");
      const go = runOnce(["--claim", "--lane", "A", "--owner", "lane-a"]);
      expect([go.j.outcome, go.j.taskId]).toEqual(["START", "UI-2"]);
      expect(heads()).toEqual(["refs/heads/claude/ag-1", "refs/heads/claude/api-1", "refs/heads/claude/ui-1", "refs/heads/claude/ui-2"]);
    });

    it("a STANDBY lane claims nothing and says why; bad lane arguments and a missing registry are BLOCKED", () => {
      const d = runOnce(["--claim", "--lane", "D", "--owner", "lane-d"]);
      expect(d.j.outcome).toBe("NO_ACTION");
      expect(d.j.reasons).toContain("MOB-1:LANE_STANDBY:D");
      expect(runOnce(["--plan", "--claim"]).j.reasons).toEqual(["ARG_CONFLICT:--plan+--claim"]);
      expect(runOnce(["--lane", "a"]).j.reasons).toEqual(["ARG_INVALID:--lane"]);
      const missing = spawnSync(process.execPath, [DISPATCH, "--plan", "--lanes", path.join(work, "nope.json")], {cwd: work, encoding: "utf8"});
      expect([missing.status, JSON.parse(missing.stdout).reasons]).toEqual([2, ["LANES_MISSING"]]);
      fs.rmSync(tmp, {recursive: true, force: true});
    });
  });
}
