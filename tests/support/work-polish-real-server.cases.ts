// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır) V3-T1023 alternatifini (Görevler ekranı cilası) gerçek buildServer'a (Fastify inject + masaüstü GET izin listesi)
// karşı doğrular: uzun mission tablosunun sayfalanması (dürüst N / M, "daha fazla" ve odak), mission başlıkları ile görev listesinde dolaşan tabindex (ok tuşları, Home/End, sarma), görev durum süzgeci
// (sunucu durumlarından sayılar, eşleşme yoksa dürüst boş not, mission değişince sıfırlama), boş Work listesinin oluşturma eylemi ve okuma hatası. Ücretli/ağ çağrısı yoktur.
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
type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
let failOn: RegExp | null = null;

interface Seed { planned: string; quiet: string; tasks: string[] }
function seed(dataDir: string, missions: number): Seed {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "Polish project", environmentId: "env-dev", createdBy: ACTOR});
  const ids: string[] = [];
  for (let i = 1; i <= missions; i++) ids.push(store.createMission({tenantId: "tA", projectId: p.projectId, title: `Mission ${String(i).padStart(2, "0")}`, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR}).missionId);
  if (!missions) return {planned: "", quiet: "", tasks: []};
  const [planned, quiet] = [ids[ids.length - 1], ids[ids.length - 2]];
  for (const m of [planned, quiet]) for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SCOPE, m, to, "seed", ACTOR);
  const pl = submitPlan(store, SCOPE, ACTOR, planned, {tasks: ["Design schema", "Build API", "Write docs", "Add tests", "Wire UI", "Release notes"].map((title, i) => ({title, ...(i ? {dependsOn: [0]} : {})}))});
  store.transitionTask(SCOPE, pl.tasks[0].taskId, "IN_PROGRESS", "seed", ACTOR); store.transitionTask(SCOPE, pl.tasks[0].taskId, "DONE", "seed", ACTOR);
  store.transitionTask(SCOPE, pl.tasks[1].taskId, "IN_PROGRESS", "seed", ACTOR); store.transitionTask(SCOPE, pl.tasks[2].taskId, "BLOCKED", "seed", ACTOR);
  submitPlan(store, SCOPE, ACTOR, quiet, {tasks: [{title: "Only pending A"}, {title: "Only pending B"}]});
  return {planned, quiet, tasks: pl.tasks.map(t => t.taskId)};
}
function mkApp(missions = 32): {app: App; s: Seed} {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const s = seed(dataDir, missions);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => { if (failOn && failOn.test(req.url)) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
  apps.push(app); return {app, s};
}
async function harness(app: App, missionId: string | null) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), work = await load("views", "work.js"), forms = await load("forms.js"), polish = await load("views", "work-polish.js");
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
  const out: {root: N | null; focused: string[]; pending: Promise<void>} = {root: null, focused: [], pending: Promise.resolve()};
  const ctx: Record<string, any> = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, refreshAll: async () => undefined, settleFocus: () => null,
    confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  ctx.rerender = () => { out.pending = (async () => { store.cache.clear(); out.root = await work.render(ctx); })(); return out.pending; };
  // getElementById searches the rendered tree; focus() on a node is recorded (by id, else its data-focus-key)
  (doc as any).getElementById = (id: string) => (out.root ? all(out.root).find(x => x.id === id) ?? null : null);
  N.prototype.focus = function (this: N) { out.focused.push(this.id || this.dataset.focusKey || this.dataset.taskInspect || "?"); };
  polish.resetPolish(); forms.drafts.missionFilter = "ALL"; forms.selection.missionId = missionId; work.resetNav?.();
  await ctx.rerender();
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const fire = async (n: N | undefined, ev: string, e: Record<string, unknown> = {}) => { expect(n, `${ev} target`).toBeTruthy(); for (const fn of n!.ls.get(ev) ?? []) await fn({preventDefault: () => undefined, ...e}); await out.pending; };
  return {ctx, out, seen, refused, polish, forms, find, fire, t, text: () => out.root!.textContent};
}
const tabIdx = (ns: N[]) => ns.map(n => n.attrs.get("tabindex"));

export function registerWorkPolishRealServerCases(): void {
describe("V3-T1023 alternative: Work screen polish (paging, roving tabindex, task status filter, empty state) against the real buildServer", () => {
  const focusRestore = N.prototype.focus;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-polish-")); failOn = null; });
  afterEach(async () => {
    N.prototype.focus = focusRestore; failOn = null;
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });

  it("long mission table: first 25 of 32 with an honest count; 'Show 7 more' reveals the rest and focuses the first new row; a filter change starts again at page 1", async () => {
    const {app} = mkApp(), h = await harness(app, null);
    const rows = () => h.find(n => n.dataset.missionId !== undefined && n.tagName === "BUTTON");
    expect(rows().length).toBe(25);
    const pg = h.find(n => n.id === "mission-page")[0];
    expect([pg?.dataset.missionShown, pg?.dataset.missionTotal]).toEqual(["25", "32"]);
    expect(pg?.textContent).toContain("Showing 25 of 32 missions");
    const more = h.find(n => n.id === "mission-more")[0]; expect(more?.textContent).toBe("Show 7 more");
    await h.fire(more, "click");
    expect(rows().length).toBe(32); expect(h.find(n => n.id === "mission-more")).toEqual([]);
    expect(h.find(n => n.id === "mission-page")[0]?.textContent).toContain("Showing 32 of 32 missions");
    expect(h.out.focused.at(-1)).toBe("mission-row-25");
    // filter: 30 Draft (page 1 again: 25 + more), then the 2 Authorized (no paging block)
    await h.fire(h.find(n => n.id === "mf-DRAFT")[0], "click");
    expect(rows().length).toBe(25); expect(h.find(n => n.id === "mission-page")[0]?.dataset.missionTotal).toBe("30");
    await h.fire(h.find(n => n.id === "mf-AUTHORIZED")[0], "click");
    expect(rows().length).toBe(2); expect(h.find(n => n.id === "mission-page")).toEqual([]);
    expect(h.seen.filter(x => x.status !== 200)).toEqual([]); expect(h.refused).toEqual([]);
  });

  it("roving tabindex over mission titles: one tab stop; ArrowDown / ArrowUp (wrapping) / Home / End move focus and the tab stop", async () => {
    const {app} = mkApp(), h = await harness(app, null);
    const rows = h.find(n => n.dataset.missionId !== undefined && n.tagName === "BUTTON");
    expect(tabIdx(rows).filter(x => x === "0").length).toBe(1); expect(rows[0].attrs.get("tabindex")).toBe("0");
    await h.fire(rows[0], "keydown", {key: "ArrowDown"}); expect(h.out.focused.at(-1)).toBe("mission-row-1");
    expect(rows[1].attrs.get("tabindex")).toBe("0"); expect(rows[0].attrs.get("tabindex")).toBe("-1");
    await h.fire(rows[1], "keydown", {key: "End"}); expect(h.out.focused.at(-1)).toBe("mission-row-24");
    await h.fire(rows[24], "keydown", {key: "Home"}); expect(h.out.focused.at(-1)).toBe("mission-row-0");
    await h.fire(rows[0], "keydown", {key: "ArrowUp"}); expect(h.out.focused.at(-1)).toBe("mission-row-24"); // wraps
    const n = h.out.focused.length; await h.fire(rows[0], "keydown", {key: "a"}); expect(h.out.focused.length).toBe(n); // other keys do nothing
  });

  it("task status filter: counts come from the server's task states; Blocked shows only the blocked task; arrows move through the tasks", async () => {
    const {app, s} = mkApp(), h = await harness(app, s.planned);
    const counts = Object.fromEntries(h.find(n => n.dataset.taskFilter !== undefined).map(n => [n.dataset.taskFilter, n.dataset.n]));
    expect(counts).toEqual({ALL: "6", PENDING: "3", IN_PROGRESS: "1", DONE: "1", BLOCKED: "1"});
    expect(h.find(n => n.id === "tf-ALL")[0].attrs.get("aria-pressed")).toBe("true");
    const tasks = () => h.find(n => n.dataset.taskInspect !== undefined);
    expect(tasks().length).toBe(6);
    expect(tabIdx(tasks()).filter(x => x === "0").length).toBe(1);
    await h.fire(tasks()[0], "keydown", {key: "ArrowDown"}); expect(h.out.focused.at(-1)).toBe(`task-${s.tasks[1]}`);
    await h.fire(tasks()[0], "keydown", {key: "End"}); expect(h.out.focused.at(-1)).toBe(`task-${s.tasks[5]}`);
    await h.fire(h.find(n => n.id === "tf-BLOCKED")[0], "click");
    expect(tasks().map(n => n.textContent)).toEqual(["Write docs"]);
    expect(h.find(n => n.id === "tf-BLOCKED")[0].attrs.get("aria-pressed")).toBe("true");
    await h.fire(h.find(n => n.id === "tf-PENDING")[0], "click");
    expect(tasks().map(n => n.textContent)).toEqual(["Add tests", "Wire UI", "Release notes"]);
  });

  it("task filter empty state: no match -> honest note and 'Show all tasks' (focus returns to All); the filter resets when the mission changes", async () => {
    const {app, s} = mkApp(), h = await harness(app, s.quiet);
    await h.fire(h.find(n => n.id === "tf-DONE")[0], "click");
    expect(h.find(n => n.dataset.taskInspect !== undefined)).toEqual([]);
    expect(h.find(n => n.id === "task-filter-none")[0]?.textContent).toContain("No task in this mission has the status Done.");
    await h.fire(h.find(n => n.id === "task-filter-reset")[0], "click");
    expect(h.find(n => n.dataset.taskInspect !== undefined).length).toBe(2); expect(h.out.focused.at(-1)).toBe("tf-ALL");
    await h.fire(h.find(n => n.id === "tf-DONE")[0], "click");
    h.forms.selection.missionId = s.planned; await h.ctx.rerender();
    expect(h.find(n => n.id === "tf-ALL")[0].attrs.get("aria-pressed")).toBe("true");
    expect(h.find(n => n.dataset.taskInspect !== undefined).length).toBe(6);
  });

  it("empty: no missions -> honest empty note and a 'Create the first mission' action that focuses the form's first field", async () => {
    const {app} = mkApp(0), h = await harness(app, null);
    const e = h.find(n => n.id === "work-empty")[0];
    expect(e?.textContent).toContain("There are no missions yet.");
    expect(h.find(n => n.id === "mission-page")).toEqual([]);
    await h.fire(h.find(n => n.id === "work-empty-create")[0], "click");
    expect(h.out.focused.at(-1)).toBe("mission-title");
  });

  it("error: the mission list read fails (HTTP 500) -> failure state; no paging, no empty-state action, no rows", async () => {
    const {app} = mkApp(); failOn = /^\/v1\/missions(\?|$)/;
    const h = await harness(app, null);
    expect(h.find(n => n.id === "work-empty" || n.id === "mission-page")).toEqual([]);
    expect(h.find(n => n.dataset.missionId !== undefined && n.tagName === "BUTTON")).toEqual([]);
    expect(all(h.find(n => n.id === "work-list")[0]!).some(n => /\bnote-error\b/.test(n.className))).toBe(true);
  });

  it("pure core (mutant killers): page size, page reset, unknown task status only under All, roving edge cases; en/tr strings", async () => {
    const p = await load("views", "work-polish.js");
    expect(p.MISSION_PAGE).toBe(25); expect(p.TASK_FILTERS).toEqual(["ALL", "PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]);
    p.resetPolish(); const items = Array.from({length: 26}, (_, i) => ({i}));
    expect(p.pageMissions(items, "ALL")).toMatchObject({total: 26, hidden: 1}); expect(p.pageMissions(items, "ALL").rows.length).toBe(25);
    p.polishState.missionShown = 50; expect(p.pageMissions(items, "ALL").hidden).toBe(0);
    expect(p.pageMissions(items, "DRAFT").rows.length).toBe(25); // a new filter starts at page 1
    const ts = [{status: "DONE"}, {status: "—"}, {status: "PENDING"}];
    expect(p.filterTasks(ts, "ALL").length).toBe(3); expect(p.filterTasks(ts, "DONE")).toEqual([{status: "DONE"}]); expect(p.filterTasks(ts, "BOGUS").length).toBe(3);
    expect(p.roving([])).toEqual([]);
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = Object.keys(en).filter((k: string) => k.startsWith("polish."));
    expect(keys.length).toBe(7);
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(tr[k], k).not.toBe(en[k]); }
  });
});
}
