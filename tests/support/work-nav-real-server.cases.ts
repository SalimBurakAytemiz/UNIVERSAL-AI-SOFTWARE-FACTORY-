// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır) UASCO-T0012'yi doğrular: Görevler ekranında plan özeti (sıralı görevler,
// bağımlılık, durum sayımı), görev -> koşu ve koşu -> görev gezinmesi gerçek buildServer'a (Fastify inject, main.mjs apiGet sözleşmesi + masaüstü GET izin listesi) karşı çizilir.
// Her durum sınanır: mutlu yol, görev-koşu okuması hatası, koşu-görev okuması hatası, koşu listesi okunamadı, koşu listede yok, planı olmayan mission. Ücretli/ağ çağrısı yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {submitPlan} from "../../core/workos/plan.js";
import {linkTaskRun} from "../../core/workos/task-run-link.js";
import {buildServer} from "../../apps/control-api/src/server.js";
import {D, N, all, desktopAllows, SYNTHETIC_HEALTH} from "./renderer-real-server.cases.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), ACTOR = "implementer@local.invalid", SCOPE = {tenantId: "tA"};
type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];

interface Seed { missionId: string; emptyMissionId: string; taskIds: string[]; runId: string }
function seed(dataDir: string): Seed {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "T0012 project", environmentId: "env-dev", createdBy: ACTOR});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "T0012 mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR});
  const empty = store.createMission({tenantId: "tA", projectId: p.projectId, title: "T0012 unplanned", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(SCOPE, m.missionId, to, "test", ACTOR);
  const plan = submitPlan(store, SCOPE, ACTOR, m.missionId, {tasks: [{title: "Design schema"}, {title: "Build API", dependsOn: [0]}, {title: "Write docs", dependsOn: [0, 1]}]});
  const run = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "claude-implementer", reviewer: "claude-reviewer-configured"}, createdBy: ACTOR});
  linkTaskRun(store, SCOPE, ACTOR, plan.tasks[1].taskId, run.runId);
  return {missionId: m.missionId, emptyMissionId: empty.missionId, taskIds: plan.tasks.map(t => t.taskId), runId: run.runId};
}
// Hata enjeksiyonu: sunucu dinlemeye başladıktan sonra kanca eklenemez; tek kanca bu desene uyan /v1 isteklerini 500 ile yanıtlar (kimlik/belirteç kancalarından sonra).
let failOn: RegExp | null = null;
function mkApp(): {app: App; s: Seed} {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const s = seed(dataDir);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => { if (failOn && failOn.test(req.url)) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
  apps.push(app); return {app, s};
}
/** Sunucuya karşı Work görünümü; ctx.rerender görünümü yeniden çizer (app.js gibi), son kök `h.root`'tadır. */
async function harness(app: App) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), work = await load("views", "work.js"), forms = await load("forms.js");
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
  const out: {root: N | null; settled: string[][]; focused: string[]; pending: Promise<void>} = {root: null, settled: [], focused: [], pending: Promise.resolve()};
  // getElementById: the rendered tree (as the real DOM); focus() on a found node is recorded so the jump target can be asserted
  (doc as unknown as {getElementById: (id: string) => N | null}).getElementById = (id: string) => { const n = out.root ? all(out.root).find(x => x.id === id) ?? null : null; if (n) n.focus = () => { out.focused.push(id); }; return n; };
  const ctx: Record<string, unknown> & {t: typeof t} = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, refreshAll: async () => undefined,
    settleFocus: ({keys}: {keys: string[]}) => { out.settled.push(keys); return null; }, confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(),
    renderAttention: () => undefined};
  ctx.rerender = () => { out.pending = (async () => { store.cache.clear(); out.root = await work.render(ctx); })(); return out.pending; };
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const click = async (n: N | undefined) => { expect(n, "clickable node").toBeTruthy(); for (const fn of n!.ls.get("click") ?? []) await fn({preventDefault: () => undefined}); await out.pending; };
  return {ctx, out, seen, refused, work, forms, find, click, text: () => out.root!.textContent};
}

export function registerWorkNavRealServerCases(): void {
describe("UASCO-T0012: Work screen plan view and task <-> run navigation against the real buildServer", () => {
  let H: Awaited<ReturnType<typeof harness>> | null = null;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0012-")); });
  afterEach(async () => {
    failOn = null;
    if (H) { H.work.resetNav(); H.forms.selection.missionId = null; H = null; }
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });
  const open = async (app: App, missionId: string) => { H = await harness(app); H.work.resetNav(); H.forms.selection.missionId = missionId; await (H.ctx.rerender as () => Promise<void>)(); return H; };

  it("plan view: ordered tasks with server dependencies and honest status counts", async () => {
    const {app, s} = mkApp(), h = await open(app, s.missionId);
    const ov = h.find(n => n.id === "plan-overview")[0];
    expect(ov?.dataset.planTotal).toBe("3"); expect(ov?.dataset.planDone).toBe("0");
    expect(ov?.textContent).toContain("0 of 3 tasks done");
    expect(h.find(n => n.dataset.planCount === "PENDING")[0]?.dataset.n).toBe("3");
    expect(h.find(n => n.dataset.planUnknown !== undefined)).toEqual([]);
    const rows = h.find(n => n.dataset.planRow !== undefined);
    expect(rows.map(r => [r.dataset.planRow, r.dataset.planTask])).toEqual(s.taskIds.map((id, i) => [String(i + 1), id]));
    expect(rows.map(r => all(r).find(n => n.dataset.planAfter !== undefined)?.dataset.planAfter ?? null)).toEqual([null, "1", "1,2"]);
    expect(h.text()).toContain("after #1, #2");
    expect(h.seen.filter(x => x.status !== 200)).toEqual([]); expect(h.refused).toEqual([]);
  });

  it("task -> run -> task: the task's run id opens the run card (detail + linked tasks loaded) and the card links back to the task", async () => {
    const {app, s} = mkApp(), h = await open(app, s.missionId);
    await h.click(h.find(n => n.dataset.taskInspect === s.taskIds[1])[0]);
    expect(h.seen.some(x => x.path === `/v1/tasks/${s.taskIds[1]}/runs` && x.status === 200)).toBe(true);
    const gotos = h.find(n => n.dataset.gotoRun === s.runId);
    expect(gotos.map(n => n.dataset.gotoFrom).sort()).toEqual(["inspector", "taskruns"]);
    expect(gotos.every(n => n.attrs.get("aria-controls") === `run-card-${s.runId}`)).toBe(true);
    // the unlinked task offers no run link
    expect(h.find(n => n.dataset.gotoRun !== undefined && n.dataset.gotoRun !== s.runId)).toEqual([]);

    await h.click(gotos.find(n => n.dataset.gotoFrom === "taskruns"));
    const card = h.find(n => n.id === `run-card-${s.runId}`)[0];
    expect(card?.dataset.runFocused).toBe("1"); expect(card?.attrs.get("aria-current")).toBe("true");
    expect(h.out.focused.at(-1)).toBe(`run-card-${s.runId}`);
    expect(h.seen.some(x => x.path === `/v1/work-runs/${s.runId}/tasks` && x.status === 200)).toBe(true);
    const back = all(card!).filter(n => n.dataset.gotoTask !== undefined);
    expect(back.map(n => [n.dataset.gotoTask, n.textContent])).toEqual([[s.taskIds[1], "Build API"]]);
    expect(h.find(n => n.dataset.runFocusMissing !== undefined)).toEqual([]);

    // reset the inspector to another task, then follow the run card's back-link
    await h.click(h.find(n => n.dataset.taskInspect === s.taskIds[0])[0]);
    expect(h.work.navState().inspectedTask.taskId).toBe(s.taskIds[0]);
    await h.click(all(h.find(n => n.id === `run-card-${s.runId}`)[0]!).find(n => n.dataset.gotoTask === s.taskIds[1]));
    expect(h.work.navState().inspectedTask).toEqual({missionId: s.missionId, taskId: s.taskIds[1]});
    expect(h.find(n => n.id === "task-inspector")[0]?.dataset.taskInspector).toBe("open");
    expect(h.find(n => n.dataset.taskField === "taskId")[0]?.textContent).toBe(s.taskIds[1]);
    expect(h.out.focused.at(-1)).toBe("task-inspector");
    expect(h.seen.filter(x => x.status !== 200)).toEqual([]); expect(h.refused).toEqual([]);
  });

  it("task with no linked run: honest 'no run' state and no run link", async () => {
    const {app, s} = mkApp(), h = await open(app, s.missionId);
    await h.click(h.find(n => n.dataset.taskInspect === s.taskIds[0])[0]);
    expect(h.find(n => n.dataset.taskRunLinks === "none").length).toBe(1);
    expect(h.find(n => n.dataset.gotoRun !== undefined)).toEqual([]);
  });

  it("error: the task's run read fails (HTTP 500) -> failure state, no run link fabricated", async () => {
    const {app, s} = mkApp();
    failOn = /^\/v1\/tasks\/[^/]+\/runs/;
    const h = await open(app, s.missionId);
    await h.click(h.find(n => n.dataset.taskInspect === s.taskIds[1])[0]);
    expect(h.find(n => n.dataset.gotoRun !== undefined)).toEqual([]);
    expect(h.find(n => n.dataset.taskField === "runLink")[0]?.textContent).toBe(h.ctx.t("work.task.unknown"));
    expect(all(h.find(n => n.id === "task-runs")[0]!).some(n => /\bnote-error\b/.test(n.className))).toBe(true);
  });

  it("error: the run's task read fails (HTTP 500) -> the card says so and offers no back-link", async () => {
    const {app, s} = mkApp();
    failOn = /^\/v1\/work-runs\/[^/?]+\/tasks/;
    const h = await open(app, s.missionId);
    const card = h.find(n => n.id === `run-card-${s.runId}`)[0]!;
    expect(all(card).find(n => n.dataset.runLinked !== undefined)?.dataset.runLinked).toBe("error");
    expect(h.find(n => n.dataset.gotoTask !== undefined)).toEqual([]);
  });

  it("unavailable/error: the mission's run list cannot be read -> no card is invented, an honest note is shown", async () => {
    const {app, s} = mkApp(), h = await open(app, s.missionId);
    failOn = /^\/v1\/work-runs\?.*missionId=/;
    await h.work.gotoRun(h.ctx, s.missionId, s.runId);
    expect(h.find(n => n.id === `run-card-${s.runId}`)).toEqual([]);
    const note = h.find(n => n.id === "run-focus-missing")[0];
    expect(note?.textContent).toBe(h.ctx.t("nav.runsUnread", {runId: s.runId}));
    expect(h.out.settled.at(-1)).toEqual([`id:run-card-${s.runId}`, "id:run-focus-missing"]);
  });

  it("empty: a run id that is not in this mission's run list -> 'not listed' note; changing mission clears the focus", async () => {
    const {app, s} = mkApp(), h = await open(app, s.missionId);
    const ghost = `wrun_${"0".repeat(24)}`;
    await h.work.gotoRun(h.ctx, s.missionId, ghost);
    expect(h.find(n => n.dataset.runFocusMissing === ghost)[0]?.textContent).toBe(h.ctx.t("nav.runNotListed", {runId: ghost}));
    expect(h.find(n => n.dataset.runFocused === "1")).toEqual([]);
    h.forms.selection.missionId = s.emptyMissionId; await (h.ctx.rerender as () => Promise<void>)();
    expect(h.work.navState().focusedRun).toBeNull();
    expect(h.find(n => n.dataset.runFocusMissing !== undefined)).toEqual([]);
  });

  it("empty: a mission without a plan shows the honest no-task state and no plan overview", async () => {
    const {app, s} = mkApp(), h = await open(app, s.emptyMissionId);
    expect(h.find(n => n.dataset.noTasks === s.emptyMissionId).length).toBe(1);
    expect(h.find(n => n.id === "plan-overview")).toEqual([]);
  });

  it("plan counts never fabricate: unknown statuses are counted as unknown, not done; en/tr strings exist", async () => {
    const pv = await load("views", "plan-view.js"), en = (await load("locales", "en.js")), tr = (await load("locales", "tr.js"));
    expect(pv.planCounts([{status: "DONE"}, {status: "—"}, {status: "WEIRD"}, {status: "BLOCKED"}])).toEqual({total: 4, counts: {DONE: 1, IN_PROGRESS: 0, PENDING: 0, BLOCKED: 1, UNKNOWN: 2}});
    expect(pv.orderedTaskRows([{taskId: "a", status: "DONE", dependsOn: null}, {taskId: "b", status: "PENDING", dependsOn: ["a", "zz"]}]).map((r: {after: unknown}) => r.after)).toEqual([null, [1, "zz"]]);
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("planview.") || k.startsWith("nav.goto") || k === "nav.runNotListed" || k === "nav.runsUnread");
    expect(keys.length).toBe(14);
    for (const k of keys) { expect(T[k], k).toBeTruthy(); if (k !== "planview.title") expect(T[k], k).not.toBe(E[k]); }
  });
});
}
