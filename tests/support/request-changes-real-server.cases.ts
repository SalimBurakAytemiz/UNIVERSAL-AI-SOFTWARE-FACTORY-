// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır) UASCO-T0017.A alternatifini ("Değişiklik iste") gerçek buildServer'a (Fastify inject; main.mjs GET izin
// listesi + B4 bloğu ve POST_ROUTE_RES izin listesi) karşı doğrular: yalnız AWAITING_APPROVAL koşusu olan REPORTING mission'ında sunulur; boş gerekçe istek göndermez; onay penceresi (vazgeç / onay işlevi
// yok / pencere açıkken ikinci basış) arkasında mevcut POST /v1/missions/:id/transition {to:"BLOCKED"} çağrılır, gerekçe koşu kimliğiyle sunucu denetim kaydına yazılır, mission BLOCKED olur; koşular
// okunamazsa sunulmaz. Ücretli/ağ çağrısı yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";
import {D, N, all, desktopAllows, SYNTHETIC_HEALTH} from "./renderer-real-server.cases.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), ACTOR = "implementer@local.invalid", SCOPE = {tenantId: "tA"};
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const postAllowed = (() => { const a = MAIN_SRC.indexOf("const POST_ROUTE_RES="), b = MAIN_SRC.indexOf("/** Gövde düz"); if (a < 0 || b < 0) throw new Error("main.mjs POST allow-list not found"); return new Function(`${MAIN_SRC.slice(a, b)}\nreturn desktopPostPathAllowed;`)() as (p: string) => boolean; })();
type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
let failOn: RegExp | null = null;

interface Seed { rep: string; run: string; plain: string; runtime: string }
function seed(dataDir: string): Omit<Seed, "runtime"> {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "RC project", environmentId: "env-dev", createdBy: ACTOR});
  const mk = (title: string, path: string[]) => { const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR}); for (const to of path) store.transitionMission(SCOPE, m.missionId, to as any, "seed", ACTOR); return m.missionId; };
  const rep = mk("Book list page", ["PREFLIGHT", "AUTHORIZED"]);
  const r = store.createRun({tenantId: "tA", missionId: rep, executor: {implementer: "a", reviewer: "b"}, createdBy: ACTOR}), l = store.acquireRunLease(r.runId, 60_000, ACTOR).leaseId!;
  store.transitionRun(r.runId, l, "RUNNING", "x", ACTOR, {mission: {to: "EXECUTING", reason: "x"}}); store.transitionRun(r.runId, l, "CHECKPOINTING", "x", ACTOR); store.transitionRun(r.runId, l, "AWAITING_APPROVAL", "x", ACTOR);
  for (const to of ["VERIFYING", "REVIEWING", "REGRESSION", "REPORTING"]) store.transitionMission(SCOPE, rep, to as any, "s", ACTOR);
  const plain = mk("Not yet reporting", ["PREFLIGHT"]);
  return {rep, run: r.runId, plain};
}
function mkApp(): {app: App; s: Seed} {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const s = seed(dataDir);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => { if (failOn && failOn.test(req.url)) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
  apps.push(app); return {app, s: {...s, runtime}};
}
async function harness(app: App, missionId: string) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), work = await load("views", "work.js"), forms = await load("forms.js"), rc = await load("views", "request-changes.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{method: string; path: string; status: number; body?: any}> = [], refused: string[] = [];
  const identity = async () => {
    const challenge = crypto.randomBytes(32).toString("hex");
    const hr = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    if (String(hr.json().controlProof ?? "") !== controlChallengeProof(TOKEN, challenge)) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const bridge = {
    apiGet: async (p: string) => {
      if (!desktopAllows(p)) { refused.push(p); throw new Error("INVALID_API_PATH"); }
      await identity(); if (p === "/health") return {...SYNTHETIC_HEALTH};
      const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}});
      seen.push({method: "GET", path: p, status: r.statusCode});
      if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    },
    apiPost: async (p: string, body: unknown) => {
      if (!postAllowed(p)) { refused.push(p); throw new Error("INVALID_API_PATH"); }
      await identity();
      const r = await app.inject({method: "POST", url: p, payload: JSON.stringify(body ?? {}), headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210", "content-type": "application/json"}});
      seen.push({method: "POST", path: p, status: r.statusCode, body});
      let b: unknown = {}; try { b = r.json(); } catch { /* boş gövde */ }
      return {status: r.statusCode, body: b};
    },
  };
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  const out: {root: N | null; confirms: any[]; answer: boolean | Promise<boolean>; pending: Promise<void>} = {root: null, confirms: [], answer: true, pending: Promise.resolve()};
  const ctx: Record<string, any> = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, settleFocus: () => null,
    confirm: async (o: unknown) => { out.confirms.push(o); return out.answer; }, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  ctx.rerender = () => { out.pending = (async () => { store.cache.clear(); out.root = await work.render(ctx); })(); return out.pending; };
  ctx.refreshAll = async () => { await ctx.rerender(); };
  rc.resetRequestChanges();
  for (const k of Object.keys(forms.drafts.busy)) forms.drafts.busy[k] = false;
  for (const k of Object.keys(forms.drafts.status)) delete forms.drafts.status[k];
  forms.selection.missionId = missionId; await ctx.rerender();
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const posts = () => seen.filter(x => x.method === "POST");
  const status = async (id: string) => (await app.inject({method: "GET", url: `/v1/missions/${id}`, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json().mission.status;
  const mission = () => ({missionId, title: "Book list page", status: "REPORTING"});
  return {ctx, out, seen, refused, rc, forms, find, posts, status, mission, t};
}

export function registerRequestChangesRealServerCases(): void {
describe("UASCO-T0017.A alternative: 'Request changes' for an AWAITING_APPROVAL run against the real buildServer", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-rc-")); failOn = null; });
  afterEach(async () => {
    failOn = null;
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });

  it("offered only for a REPORTING mission with an AWAITING_APPROVAL run, with the honest 'no revision engine' note; not offered elsewhere", async () => {
    const {app, s} = mkApp();
    let h = await harness(app, s.rep);
    const p = h.find(n => n.id === "request-changes")[0];
    expect(p?.dataset.rcState).toBe("OFFER");
    expect(all(p).find(n => n.id === "rc-submit")?.dataset.rcRun).toBe(s.run);
    expect(all(p).find(n => n.dataset.rcHonest)?.textContent).toBe(h.t("rc.honest"));
    expect(h.refused).toEqual([]);
    h = await harness(app, s.plain);
    expect(h.find(n => n.id === "request-changes")).toEqual([]);
  });

  it("empty reason: a validation error, no dialog, no request", async () => {
    const {app, s} = mkApp(), h = await harness(app, s.rep);
    h.rc.rcDraft.text = "   ";
    expect(await h.rc.submitRequestChanges(h.ctx, h.mission(), s.run)).toEqual({ok: false, validation: true});
    expect(h.out.confirms).toEqual([]); expect(h.posts()).toEqual([]);
    await h.out.pending;
    expect(h.find(n => n.id === `rc-${s.rep}-status`)[0]?.textContent).toContain(h.t("rc.err.required"));
  });

  it("cancelled, or no confirm function: nothing is posted and the mission stays REPORTING", async () => {
    const {app, s} = mkApp(), h = await harness(app, s.rep);
    h.rc.rcDraft.text = "The list must be paginated"; h.out.answer = false;
    expect(await h.rc.submitRequestChanges(h.ctx, h.mission(), s.run)).toEqual({ok: false, cancelled: true});
    await h.out.pending; expect(h.find(n => n.id === `rc-${s.rep}-status`)[0]?.textContent).toContain(h.t("confirm.cancelled"));
    delete h.ctx.confirm;
    expect(await h.rc.submitRequestChanges(h.ctx, h.mission(), s.run)).toEqual({ok: false, cancelled: true});
    expect(h.posts()).toEqual([]); expect(await h.status(s.rep)).toBe("REPORTING");
  });

  it("confirmed: one POST to the allowed transition route with to BLOCKED and the run-tagged reason; the server records it; a second press during the dialog does nothing", async () => {
    const {app, s} = mkApp(), h = await harness(app, s.rep);
    h.rc.rcDraft.text = "  The list must be paginated  ";
    let release!: (v: boolean) => void; h.out.answer = new Promise<boolean>(r => { release = r; });
    const first = h.rc.submitRequestChanges(h.ctx, h.mission(), s.run);
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
    expect(await h.rc.submitRequestChanges(h.ctx, h.mission(), s.run)).toEqual({ok: false, busy: true});
    expect(h.out.confirms).toHaveLength(1);
    expect(h.out.confirms[0]).toMatchObject({title: "Request changes and block this mission?", action: `Request changes for run ${s.run}`, target: `Book list page (${s.rep})`});
    release(true); expect(await first).toMatchObject({ok: true});
    const reason = `Changes requested for run ${s.run}: The list must be paginated`;
    expect(h.posts().map(p => [p.path, p.status, p.body])).toEqual([[`/v1/missions/${s.rep}/transition`, 200, {to: "BLOCKED", reason}]]);
    expect(await h.status(s.rep)).toBe("BLOCKED");
    // the control audit records the transition; the Work OS journal (data dir) records the run-tagged reason
    const audit = fs.readFileSync(path.join(s.runtime, "control-api-events.jsonl"), "utf8");
    expect(audit.split("\n").some(l => l.includes("WORKOS_MISSION_TRANSITIONED") && l.includes(s.rep) && l.includes("REPORTING") && l.includes("BLOCKED"))).toBe(true);
    const walk = (d: string): string[] => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    expect(walk(path.join(tmp, "data")).some(f => fs.readFileSync(f, "utf8").includes(reason)), "reason recorded in the Work OS journal").toBe(true);
    await h.out.pending;
    const rec = h.find(n => n.id === "rc-recorded")[0];
    expect(rec?.dataset.rcRecorded).toBe(s.run); expect(rec?.textContent).toContain(reason); expect(rec?.textContent).toContain("Blocked");
    expect(h.find(n => n.id === "rc-submit")).toEqual([]); // the mission is no longer REPORTING: nothing more to request
  });

  it("error: the runs read fails -> not offered, with an honest note", async () => {
    const {app, s} = mkApp(); failOn = /^\/v1\/work-runs(\?|$)/;
    const h = await harness(app, s.rep);
    const p = h.find(n => n.id === "request-changes")[0];
    expect(p?.dataset.rcState).toBe("RUNS_UNKNOWN"); expect(h.find(n => n.id === "rc-submit")).toEqual([]);
    expect(all(p).find(n => n.dataset.rcNote)?.textContent).toBe(h.t("rc.runsUnknown"));
  });

  it("pure core (mutant killers) and en/tr strings", async () => {
    const rc = await load("views", "request-changes.js");
    const m = {missionId: "msn_" + "a".repeat(24), status: "REPORTING"}, run = (status: string, missionId = m.missionId) => ({runId: "run_" + "b".repeat(24), missionId, status});
    expect(rc.requestChangesTarget(m, {state: "VERIFIED", items: [run("AWAITING_APPROVAL")]})).toEqual({state: "OFFER", runId: "run_" + "b".repeat(24)});
    expect(rc.requestChangesTarget(m, {state: "VERIFIED", items: [run("FAILED")]})).toEqual({state: "NONE"});
    for (const st of ["RUNNING", "CHECKPOINTING", "SUCCEEDED", "BLOCKED"]) expect(rc.requestChangesTarget(m, {state: "VERIFIED", items: [run(st)]}), st).toEqual({state: "NONE"});
    expect(rc.requestChangesTarget(m, {state: "VERIFIED", items: [run("AWAITING_APPROVAL", "msn_" + "c".repeat(24))]})).toEqual({state: "NONE"});
    expect(rc.requestChangesTarget({...m, status: "REVIEWING"}, {state: "VERIFIED", items: [run("AWAITING_APPROVAL")]})).toEqual({state: "NONE"});
    expect(rc.requestChangesTarget(m, {state: "OFFLINE"})).toEqual({state: "RUNS_UNKNOWN"});
    expect(rc.buildRequestChangesReason("run_x", "")).toEqual({ok: false, error: "rc.err.required"});
    expect(rc.buildRequestChangesReason("run_x", "a".repeat(4000))).toEqual({ok: false, error: "rc.err.long"});
    expect(rc.buildRequestChangesReason("run_x", " fix ")).toEqual({ok: true, reason: "Changes requested for run run_x: fix"});
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = Object.keys(en).filter((k: string) => k.startsWith("rc."));
    expect(keys.length).toBe(15);
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(tr[k], k).not.toBe(en[k]); }
  });
});
}
