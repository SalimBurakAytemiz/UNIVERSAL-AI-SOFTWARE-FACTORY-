// //TR: DSK-T0003 (UI-024 + UI-207) vakaları: görev bağımlılık grafiği ve kritik yol saf fonksiyonları (döngü, eksik hedef, yinelenen, bilinmeyen dependsOn, eşitlik kırma) ile Work görünümündeki haritanın gerçek buildServer'a (Fastify inject, masaüstü GET izin listesi) karşı çizimi. Kayıtlı tests/v7-b4-desktop-shell.test.ts içe aktarır; ücretli/ağ çağrısı yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {submitPlan} from "../../core/workos/plan.js";
import {buildServer} from "../../apps/control-api/src/server.js";
import {D, N, all, desktopAllows, SYNTHETIC_HEALTH} from "./renderer-real-server.cases.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), ACTOR = "implementer@local.invalid", SCOPE = {tenantId: "tA"};
const id = (n: number) => `tsk_${n.toString(16).padStart(24, "0")}`;
const task = (n: number, deps: number[] | null, status: string | null = "PENDING") => ({taskId: id(n), title: `T${n}`, status, dependsOn: deps === null ? null : deps.map(id), invalidDeps: 0});
type App = ReturnType<typeof buildServer>;

export function registerTaskGraphCases(): void {
describe("DSK-T0003: task graph and critical path (pure)", () => {
  it("diamond DAG: edges, levels, longest chain by task count with deterministic tie-break, ready/waiting/blocked kinds", async () => {
    const c = await load("task-graph-core.js");
    const g = c.buildTaskGraph([task(1, [], "DONE"), task(2, [1]), task(3, [1]), task(4, [2, 3]), task(5, [4]), task(6, [], "BLOCKED"), task(7, [], "IN_PROGRESS"), task(8, [], null)]);
    expect(g.acyclic).toBe(true); expect(g.errorCount).toBe(0);
    expect(g.criticalPath).toEqual([id(1), id(2), id(4), id(5)]);
    expect(g.edges).toHaveLength(5);
    expect(g.edges.filter((e: any) => e.critical).map((e: any) => [e.from, e.to])).toEqual([[id(1), id(2)], [id(2), id(4)], [id(4), id(5)]]);
    expect(g.nodes.map((n: any) => n.kind)).toEqual(["done", "ready", "ready", "waiting", "waiting", "blocked", "active", "unknown"]);
    expect(g.nodes.map((n: any) => n.level)).toEqual([0, 1, 1, 2, 3, 0, 0, 0]);
    expect(g.nodes[3].waitingOn).toEqual([id(2), id(3)]);
    expect(g.counts).toMatchObject({ready: 2, waiting: 2, blocked: 1, active: 1, done: 1, unknown: 1, unresolved: 0});
  });
  it("cycles (incl. self-dependency) are reported, nodes become unresolved and no critical path is invented", async () => {
    const c = await load("task-graph-core.js");
    const g = c.buildTaskGraph([task(1, [3]), task(2, [1]), task(3, [2]), task(4, [4]), task(5, [])]);
    expect(g.acyclic).toBe(false); expect(g.criticalPath).toBeNull();
    expect(g.errors.cycles).toEqual([[id(1), id(2), id(3)], [id(4)]]);
    expect(g.nodes.map((n: any) => n.kind)).toEqual(["unresolved", "unresolved", "unresolved", "unresolved", "ready"]);
    expect(g.nodes.every((n: any) => !n.critical)).toBe(true);
  });
  it("missing targets, duplicates, unknown and invalid dependsOn are honest errors; a task with a missing dep is never 'ready'", async () => {
    const c = await load("task-graph-core.js");
    const ghost = id(99);
    const g = c.buildTaskGraph([{...task(1, []), dependsOn: [ghost]}, task(2, null), task(1, []), {...task(3, []), invalidDeps: 1}, task(4, [1])]);
    expect(g.errors.missing).toEqual([{taskId: id(1), dependsOn: ghost}]);
    expect(g.errors.duplicates).toEqual([id(1)]); expect(g.errors.unknownDeps).toEqual([id(2)]); expect(g.errors.invalidDeps).toEqual([id(3)]);
    expect(g.errorCount).toBe(4); expect(g.edges).toHaveLength(1);
    expect(g.nodes.map((n: any) => n.kind)).toEqual(["unresolved", "unresolved", "unresolved", "waiting"]);
    expect(g.nodes[0].missing).toEqual([ghost]);
    // No cycle: the critical path still exists over the valid edges.
    expect(g.criticalPath).toEqual([id(1), id(4)]);
  });
  it("mapper and path: rejects malformed reads, keeps raw dep strings, counts dropped records; layout is deterministic", async () => {
    const c = await load("task-graph-core.js");
    expect(c.missionTasksPath("msn_" + "a".repeat(24))).toBe(`/v1/missions/msn_${"a".repeat(24)}/tasks`);
    expect(c.missionTasksPath("msn_x")).toBeNull(); expect(c.missionTasksPath("../x")).toBeNull();
    expect(c.mapMissionTasks(null).state).toBe("ERROR"); expect(c.mapMissionTasks({tasks: "x"}).state).toBe("ERROR");
    const m = c.mapMissionTasks({tasks: [{taskId: id(1), title: "A", status: "WEIRD", dependsOn: ["tsk_bad", 7]}, {taskId: "bad"}, {taskId: id(2), title: "", status: "DONE"}]});
    expect(m).toMatchObject({state: "VERIFIED", dropped: 1, truncated: false});
    expect(m.tasks).toEqual([{taskId: id(1), title: "A", status: null, dependsOn: ["tsk_bad"], invalidDeps: 1}, {taskId: id(2), title: null, status: "DONE", dependsOn: null, invalidDeps: 0}]);
    const L = c.layoutTaskGraph(c.buildTaskGraph([task(1, []), task(2, [1]), task(3, [1])]));
    expect([...L.pos.entries()].map(([k, p]: any) => [k, p.x, p.y])).toEqual([[id(1), 12, 12], [id(2), 248, 12], [id(3), 248, 70]]);
    expect(L.edges).toHaveLength(2); expect(L.width).toBe(12 * 2 + 2 * 180 + 56);
    expect(c.buildTaskGraph([]).criticalPath).toBeNull();
  });
  it("view: cycle and missing-target errors render as an alert, the list fallback is present and keyboard-navigable", async () => {
    const c = await load("task-graph-core.js"), v = await load("views", "task-graph.js"), i18n = await load("i18n.js");
    const doc = new D(), t = (k: string, x?: unknown) => i18n.translate("en", k, x), mid = "msn_" + "b".repeat(24);
    const ctx: any = {doc, t, i18n: {lang: "en", t}, rerender: async () => undefined};
    v.resetTaskGraph();
    const closed = v.taskGraphSection(ctx, mid, null) as N;
    const tog = all(closed).find(n => n.attrs.get("id") === "task-graph-toggle" || n.id === "task-graph-toggle")!;
    expect(tog.attrs.get("aria-expanded")).toBe("false");
    for (const fn of tog.ls.get("click") ?? []) await fn({});
    expect(v.isTaskGraphOpen(mid)).toBe(true);
    const tasks = [{...task(1, [2]), title: "Alpha"}, {...task(2, [1]), title: "Beta"}, {...task(3, []), dependsOn: [id(42)], title: "Gamma"}];
    const res = {state: "VERIFIED", read: {tasks, dropped: 0, truncated: false}, graph: c.buildTaskGraph(tasks)};
    const root = v.taskGraphSection(ctx, mid, res) as N;
    const alert = all(root).find(n => n.attrs.get("role") === "alert")!;
    expect(alert.textContent).toContain("Dependency cycle: Alpha → Beta → Alpha");
    expect(alert.textContent).toContain(`"Gamma" depends on ${id(42)}, which is not a task of this mission.`);
    expect(all(root).some(n => n.dataset.tgCriticalNa === "1")).toBe(true);
    const items = all(root).filter(n => n.dataset.tgItem !== undefined);
    expect(items.map(n => n.dataset.tgKind)).toEqual(["unresolved", "unresolved", "unresolved"]);
    const svg = all(root).find(n => n.tagName === "SVG")!;
    expect(svg.attrs.get("role")).toBe("img"); expect(svg.attrs.get("aria-label")).toContain("critical path: not computed");
    expect(all(root).find(n => n.dataset.tgSelect === id(1))!.ls.get("keydown")?.length).toBe(1);
    v.resetTaskGraph();
  });
});

let tmp = "";
const apps: App[] = [];
let failOn: RegExp | null = null;
function mkApp() {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "T0003 project", environmentId: "env-dev", createdBy: ACTOR});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "T0003 mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SCOPE, m.missionId, to, "test", ACTOR);
  const plan = submitPlan(store, SCOPE, ACTOR, m.missionId, {tasks: [{title: "Design"}, {title: "API", dependsOn: [0]}, {title: "UI", dependsOn: [0]}, {title: "Integrate", dependsOn: [1, 2]}, {title: "Release", dependsOn: [3]}, {title: "Docs"}]});
  const ids = plan.tasks.map(t => t.taskId);
  store.transitionTask(SCOPE, ids[0], "IN_PROGRESS", "test", ACTOR); store.transitionTask(SCOPE, ids[0], "DONE", "test", ACTOR);
  store.transitionTask(SCOPE, ids[5], "BLOCKED", "test", ACTOR);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => { if (failOn && failOn.test(req.url)) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
  apps.push(app);
  return {app, missionId: m.missionId, ids};
}
async function harness(app: App) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), work = await load("views", "work.js"), forms = await load("forms.js"), tg = await load("views", "task-graph.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{path: string; status: number}> = [], refused: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    if (!desktopAllows(p)) { refused.push(p); throw new Error("INVALID_API_PATH"); }
    const challenge = crypto.randomBytes(32).toString("hex");
    const hr = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    if (String(hr.json().controlProof ?? "") !== controlChallengeProof(TOKEN, challenge)) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
    if (p === "/health") return {...SYNTHETIC_HEALTH};
    const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}});
    seen.push({path: p, status: r.statusCode});
    if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
    return r.json();
  }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  const out: {root: N | null; pending: Promise<void>} = {root: null, pending: Promise.resolve()};
  const ctx: any = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, refreshAll: async () => undefined, settleFocus: () => null, confirm: async () => false,
    selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  ctx.rerender = () => { out.pending = (async () => { store.cache.clear(); out.root = await work.render(ctx); })(); return out.pending; };
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const click = async (n: N | undefined) => { expect(n, "clickable node").toBeTruthy(); for (const fn of n!.ls.get("click") ?? []) await fn({preventDefault: () => undefined}); await out.pending; };
  return {ctx, out, seen, refused, work, forms, tg, find, click};
}

describe("DSK-T0003: Work view dependency map against the real buildServer", () => {
  let H: Awaited<ReturnType<typeof harness>> | null = null;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-dsk-t0003-")); });
  afterEach(async () => {
    failOn = null;
    if (H) { H.work.resetNav(); H.tg.resetTaskGraph(); H.forms.selection.missionId = null; H = null; }
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });
  const open = async (app: App, missionId: string) => { H = await harness(app); H.work.resetNav(); H.tg.resetTaskGraph(); H.forms.selection.missionId = missionId; await H.ctx.rerender(); return H; };

  it("closed by default (no tasks read); opening reads GET /v1/missions/:id/tasks and draws nodes, edges, critical path, ready and blocked", async () => {
    const {app, missionId, ids} = mkApp(), h = await open(app, missionId);
    const tasksPath = `/v1/missions/${missionId}/tasks`;
    expect(h.seen.some(x => x.path === tasksPath)).toBe(false);
    expect(h.find(n => n.id === "task-graph")).toEqual([]);
    await h.click(h.find(n => n.id === "task-graph-toggle")[0]);
    expect(h.seen.filter(x => x.path === tasksPath).map(x => x.status)).toEqual([200]);
    const box = h.find(n => n.dataset.taskGraphState !== undefined)[0]!;
    expect(box.dataset).toMatchObject({taskGraphState: "VERIFIED", tgTotal: "6", tgReady: "2", tgBlocked: "1", tgWaiting: "2", tgCritical: [ids[0], ids[1], ids[3], ids[4]].join(",")});
    expect(h.find(n => n.attrs.get("role") === "alert")).toEqual([]);
    const nodes = h.find(n => n.attrs.get("data-task-id") !== undefined && n.tagName === "G");
    expect(nodes.map(n => [n.attrs.get("data-task-id"), n.attrs.get("data-kind"), n.attrs.get("data-critical")]).sort()).toEqual(
      [[ids[0], "done", "1"], [ids[1], "ready", "1"], [ids[2], "ready", "0"], [ids[3], "waiting", "1"], [ids[4], "waiting", "1"], [ids[5], "blocked", "0"]].sort());
    expect(h.find(n => n.tagName === "PATH" && n.attrs.get("data-from") !== undefined)).toHaveLength(5);
    expect(h.find(n => n.dataset.tgItem !== undefined)).toHaveLength(6);
    expect(h.find(n => n.dataset.tgCritStep !== undefined).map(n => n.dataset.tgCritStep)).toEqual(["1", "2", "3", "4"]);
    // selecting a task in the list highlights it and its neighbours on the map
    await h.click(h.find(n => n.dataset.tgSelect === ids[3])[0]);
    expect(h.find(n => n.dataset.tgSelect === ids[3])[0]?.attrs.get("aria-pressed")).toBe("true");
    const sel = h.find(n => n.tagName === "G" && n.attrs.get("data-task-id") === ids[3])[0]!;
    expect(sel.attrs.get("class")).toContain("tg-selected");
    expect(h.find(n => n.tagName === "G" && /tg-related/.test(n.attrs.get("class") ?? "")).map(n => n.attrs.get("data-task-id")).sort()).toEqual([ids[1], ids[2], ids[4]].sort());
    expect(h.refused).toEqual([]); expect(h.seen.filter(x => x.status !== 200)).toEqual([]);
  });

  it("error: the tasks read fails (HTTP 500) -> honest error state, no node is invented; closing hides the map", async () => {
    const {app, missionId} = mkApp(), h = await open(app, missionId);
    failOn = /^\/v1\/missions\/[^/]+\/tasks$/;
    await h.click(h.find(n => n.id === "task-graph-toggle")[0]);
    const box = h.find(n => n.dataset.taskGraphState !== undefined)[0]!;
    expect(box.dataset.taskGraphState).not.toBe("VERIFIED");
    expect(h.find(n => n.tagName === "SVG" && /tg-svg/.test(n.attrs.get("class") ?? ""))).toEqual([]);
    expect(h.find(n => n.dataset.tgItem !== undefined)).toEqual([]);
    failOn = null;
    await h.click(h.find(n => n.id === "task-graph-toggle")[0]);
    expect(h.find(n => n.id === "task-graph")).toEqual([]);
  });
});
}
