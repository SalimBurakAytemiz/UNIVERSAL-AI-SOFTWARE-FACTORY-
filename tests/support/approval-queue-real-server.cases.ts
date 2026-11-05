// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır) Gelen Kutusu'ndaki tek Onay kuyruğunu (Final Approval Center) gerçek buildServer'a
// (Fastify inject; main.mjs GET izin listesi + B4 bloğu ve POST_ROUTE_RES izin listesi, apiGet/apiPost sözleşmesi) karşı doğrular: türe göre gruplar ve sayılar, her öğenin konusu/riski/etkisi/bağlantısı,
// Yetkilendir (performTransition onayı) ve Engelle (gerekçe + bu ekranın onayı) eylemleri onaylı / vazgeçilmiş / onay penceresi açıkken ikinci basış, karar kartına odak, salt okunur öğelerin nedeni,
// okunamayan kaynaklar (koşular, pre-dev, mission'lar) ve boş kuyruk. Pre-dev taslağı ücretsiz sabit TaskHub üreticisiyle tohumlanır; ücretli/ağ çağrısı yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {AnalysisFlow} from "../../core/workos/crew/analysis.js";
import {TASKHUB_ARTIFACTS} from "../../core/workos/predev/fixtures/taskhub/index.js";
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

interface Seed { pre: string; fa: string; rep: string; fl: string; pd: string; blk: string; repRun: string; flRun: string; artifactId: string }
async function seed(dataDir: string, empty: boolean): Promise<Seed | null> {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "AQ project", environmentId: "env-dev", createdBy: ACTOR});
  if (empty) return null;
  const mk = (title: string, risk: string, path: string[]) => { const m = store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: risk as any, createdBy: ACTOR}); for (const to of path) store.transitionMission(SCOPE, m.missionId, to as any, "seed", ACTOR); return m.missionId; };
  const pre = mk("Checkout flow", "R2", ["PREFLIGHT"]);
  const fa = mk("Payment provider choice", "R2", ["PREFLIGHT", "FOUNDER_ATTENTION_REQUIRED"]);
  const rep = mk("Book list page", "R1", ["PREFLIGHT", "AUTHORIZED"]);
  const r = store.createRun({tenantId: "tA", missionId: rep, executor: {implementer: "a", reviewer: "b"}, createdBy: ACTOR}), l = store.acquireRunLease(r.runId, 60_000, ACTOR).leaseId!;
  store.transitionRun(r.runId, l, "RUNNING", "x", ACTOR, {mission: {to: "EXECUTING", reason: "x"}}); store.transitionRun(r.runId, l, "CHECKPOINTING", "x", ACTOR); store.transitionRun(r.runId, l, "AWAITING_APPROVAL", "x", ACTOR);
  for (const to of ["VERIFYING", "REVIEWING", "REGRESSION", "REPORTING"]) store.transitionMission(SCOPE, rep, to as any, "s", ACTOR);
  const fl = mk("Search index", "R1", ["PREFLIGHT", "AUTHORIZED"]);
  const rf = store.createRun({tenantId: "tA", missionId: fl, executor: {implementer: "a", reviewer: "b"}, createdBy: ACTOR});
  store.transitionRun(rf.runId, store.acquireRunLease(rf.runId, 60_000, ACTOR).leaseId!, "FAILED", "build failed", ACTOR);
  const blk = mk("Old experiment", "R0", ["BLOCKED"]);
  const pd = mk("Reading list analysis", "R1", []);
  const flow = new AnalysisFlow({store, scope: SCOPE, builder: {async produce(kind: any) { return JSON.stringify((TASKHUB_ARTIFACTS as any)[kind]); }}, readiness: () => ({ready: true, blockers: [], blocker: null, founderAction: null, profiles: null})} as any);
  const d: any = await flow.step(pd);
  if (d.status !== "DRAFT_READY") throw new Error(`seed: ${JSON.stringify(d)}`);
  return {pre, fa, rep, fl, pd, blk, repRun: r.runId, flRun: rf.runId, artifactId: d.artifactId};
}
async function mkApp(empty = false): Promise<{app: App; s: Seed}> {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const s = await seed(dataDir, empty);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => { if (failOn && failOn.test(req.url)) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
  apps.push(app); return {app, s: s as Seed};
}
async function harness(app: App) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), inbox = await load("views", "inbox.js"), forms = await load("forms.js"), aq = await load("views", "approval-queue.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{method: string; path: string; status: number}> = [], refused: string[] = [], nav: string[] = [];
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
      seen.push({method: "POST", path: p, status: r.statusCode});
      let b: unknown = {}; try { b = r.json(); } catch { /* boş gövde */ }
      return {status: r.statusCode, body: b};
    },
  };
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  const out: {root: N | null; confirms: any[]; answer: boolean | Promise<boolean>; focused: string[]; pending: Promise<void>} = {root: null, confirms: [], answer: true, focused: [], pending: Promise.resolve()};
  const ctx: Record<string, any> = {doc, store, api, i18n: {lang: "en", t}, t, navigate: (r: string) => { nav.push(r); }, settleFocus: () => null,
    confirm: async (o: unknown) => { out.confirms.push(o); return out.answer; }, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  ctx.rerender = () => { out.pending = (async () => { store.cache.clear(); out.root = await inbox.render(ctx); })(); return out.pending; };
  ctx.refreshAll = async () => { await ctx.rerender(); };
  (doc as any).getElementById = (id: string) => (out.root ? all(out.root).find(x => x.id === id) ?? null : null);
  N.prototype.focus = function (this: N) { out.focused.push(this.id || this.dataset.focusKey || "?"); };
  for (const k of Object.keys(forms.drafts.reasons)) delete forms.drafts.reasons[k];
  for (const k of Object.keys(forms.drafts.busy)) forms.drafts.busy[k] = false;
  for (const k of Object.keys(forms.drafts.status)) delete forms.drafts.status[k];
  await ctx.rerender();
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const click = async (n: N | undefined) => { expect(n, "clickable").toBeTruthy(); for (const fn of n!.ls.get("click") ?? []) await fn({});
    // the handlers do not return their promise: wait until the action and its repaint have settled
    for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 5)); const p = out.pending; await p; if (p === out.pending && !Object.values(forms.drafts.busy).some(Boolean) && i > 5) break; } };
  const posts = () => seen.filter(x => x.method === "POST");
  const status = async (id: string) => (await app.inject({method: "GET", url: `/v1/missions/${id}`, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json().mission.status;
  return {ctx, out, seen, refused, nav, forms, aq, find, click, posts, status, t, item: (kind: string, id: string) => all(out.root!).find(n => n.dataset.aqItem === id && n.dataset.aqKind === kind)};
}

export function registerApprovalQueueRealServerCases(): void {
describe("Final Approval Center: Inbox approval queue grouped by kind, with confirmed actions, against the real buildServer", () => {
  const focusRestore = N.prototype.focus;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-aq-")); failOn = null; });
  afterEach(async () => {
    N.prototype.focus = focusRestore; failOn = null;
    // shared renderer modules: leave no selected mission, reason, status or lock behind for the next registered suite
    const forms = await load("forms.js");
    forms.selection.missionId = null;
    for (const k of Object.keys(forms.drafts.reasons)) delete forms.drafts.reasons[k];
    for (const k of Object.keys(forms.drafts.busy)) forms.drafts.busy[k] = false;
    for (const k of Object.keys(forms.drafts.status)) if (k.startsWith("act-")) delete forms.drafts.status[k];
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });

  it("groups every pending decision by kind with honest counts; each item shows subject, risk, what approving does and a link; a blocked mission is not an approval", async () => {
    const {app, s} = await mkApp(), h = await harness(app);
    const counts = Object.fromEntries(h.find(n => n.dataset.aqCount !== undefined).map(n => [n.dataset.aqCount, n.dataset.n]));
    expect(counts).toEqual({AUTHORIZATION: "1", DELIVERY: "1", FOUNDER_ATTENTION: "1", PREDEV_DRAFT: "1", RUN_DECISION: "1"});
    expect(h.find(n => n.dataset.aqTotal !== undefined)[0]?.textContent).toBe("5 item(s) wait for your decision");
    expect(h.find(n => n.dataset.aqGroup !== undefined).map(n => n.dataset.aqGroup)).toEqual(["AUTHORIZATION", "DELIVERY", "FOUNDER_ATTENTION", "PREDEV_DRAFT", "RUN_DECISION"]);
    const want: Array<[string, string, string, string, string]> = [["AUTHORIZATION", s.pre, "R2", "TRANSITION", "work"], ["DELIVERY", s.rep, "R1", "DECIDE", "work"], ["FOUNDER_ATTENTION", s.fa, "R2", "DECIDE", "work"], ["PREDEV_DRAFT", s.pd, "R1", "READ_ONLY", "journey"], ["RUN_DECISION", s.fl, "R1", "READ_ONLY", "work"]];
    for (const [kind, id, risk, mode, route] of want) {
      const it = h.item(kind, id); expect(it, kind).toBeTruthy();
      expect(it!.dataset.aqMode, kind).toBe(mode);
      expect(all(it!).find(n => n.dataset.aqRisk !== undefined)?.dataset.aqRisk, kind).toBe(risk);
      expect(all(it!).find(n => n.dataset.aqEffect)?.textContent, kind).toBe(h.t(`aq.effect.${kind}`));
      expect(all(it!).find(n => n.dataset.aqLink)?.dataset.aqLink, kind).toBe(route);
    }
    expect(all(h.item("DELIVERY", s.rep)!).some(n => n.textContent === s.repRun)).toBe(true);
    expect(all(h.item("RUN_DECISION", s.fl)!).some(n => n.textContent === s.flRun)).toBe(true);
    expect(all(h.item("PREDEV_DRAFT", s.pd)!).some(n => n.textContent === s.artifactId)).toBe(true);
    expect(h.find(n => n.dataset.aqItem === s.blk)).toEqual([]);
    expect(h.find(n => n.dataset.aqUnknown !== undefined)).toEqual([]);
    expect(h.seen.filter(x => x.status !== 200)).toEqual([]); expect(h.refused).toEqual([]);
  });

  it("authorize: the confirmation is asked first; confirmed -> the server records AUTHORIZED and the item leaves the queue; cancelled -> nothing is posted", async () => {
    const {app, s} = await mkApp(), h = await harness(app);
    h.out.answer = false;
    await h.click(h.find(n => n.id === `aq-AUTHORIZED-${s.pre}`)[0]);
    expect(h.out.confirms).toHaveLength(1); expect(h.out.confirms[0].target).toBe(`Checkout flow (${s.pre})`);
    expect(h.posts()).toEqual([]); expect(await h.status(s.pre)).toBe("PREFLIGHT");
    expect(h.find(n => n.id === `act-${s.pre}-status`)[0]?.textContent).toContain(h.t("confirm.cancelled"));
    h.out.answer = true;
    await h.click(h.find(n => n.id === `aq-AUTHORIZED-${s.pre}`)[0]);
    expect(h.posts().map(p => [p.path, p.status])).toEqual([[`/v1/missions/${s.pre}/transition`, 200]]);
    expect(await h.status(s.pre)).toBe("AUTHORIZED");
    expect(h.item("AUTHORIZATION", s.pre)).toBeUndefined();
    expect(h.find(n => n.dataset.aqCount === "AUTHORIZATION")[0].dataset.n).toBe("0");
  });

  it("block: a missing reason is a validation error with no dialog and no request; with a reason it asks its own confirmation; a second press while the dialog is open does nothing", async () => {
    const {app, s} = await mkApp(), h = await harness(app);
    await h.click(h.find(n => n.id === `aq-BLOCKED-${s.pre}`)[0]);
    expect(h.out.confirms).toEqual([]); expect(h.posts()).toEqual([]);
    h.forms.drafts.reasons[s.pre] = "Out of scope for this quarter";
    const it0 = {missionId: s.pre, title: "Checkout flow", status: "PREFLIGHT"};
    h.out.answer = false;
    expect(await h.aq.submitQueueTransition(h.ctx, it0, "BLOCKED")).toEqual({ok: false, cancelled: true});
    await h.out.pending; expect(h.find(n => n.id === `act-${s.pre}-status`)[0]?.textContent).toContain(h.t("confirm.cancelled"));
    const keep = h.ctx.confirm; delete h.ctx.confirm;
    expect(await h.aq.submitQueueTransition(h.ctx, it0, "BLOCKED")).toEqual({ok: false, cancelled: true}); // no confirm function: fail closed
    h.ctx.confirm = keep; h.out.confirms.length = 0;
    expect(h.posts()).toEqual([]); expect(await h.status(s.pre)).toBe("PREFLIGHT");
    let release!: (v: boolean) => void; h.out.answer = new Promise<boolean>(r => { release = r; });
    const it = {missionId: s.pre, title: "Checkout flow", status: "PREFLIGHT"};
    const first = h.aq.submitQueueTransition(h.ctx, it, "BLOCKED");
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
    expect(await h.aq.submitQueueTransition(h.ctx, it, "BLOCKED")).toEqual({ok: false, busy: true});
    expect(h.out.confirms).toHaveLength(1);
    expect(h.out.confirms[0]).toMatchObject({title: "Block this mission?", action: "Block the mission (from Preflight)", confirmLabel: "Block"});
    release(true); expect(await first).toMatchObject({ok: true});
    expect(h.posts().map(p => p.path)).toEqual([`/v1/missions/${s.pre}/transition`]);
    expect(await h.status(s.pre)).toBe("BLOCKED");
  });

  it("decide: delivery and Founder-attention items move focus to their decision card below; links set the mission and open the right screen; read-only items say why", async () => {
    const {app, s} = await mkApp(), h = await harness(app);
    await h.click(h.find(n => n.id === `aq-decide-${s.fa}`)[0]); expect(h.out.focused.at(-1)).toBe(`ib-open-${s.fa}`);
    await h.click(h.find(n => n.id === `aq-decide-${s.rep}`)[0]); expect(h.out.focused.at(-1)).toBe(`ib-open-${s.rep}`);
    await h.click(h.find(n => n.id === `aq-open-PREDEV_DRAFT-${s.pd}`)[0]);
    expect(h.nav.at(-1)).toBe("journey"); expect(h.forms.selection.missionId).toBe(s.pd);
    await h.click(h.find(n => n.id === `aq-open-RUN_DECISION-${s.fl}`)[0]);
    expect(h.nav.at(-1)).toBe("work"); expect(h.forms.selection.missionId).toBe(s.fl);
    expect(all(h.item("PREDEV_DRAFT", s.pd)!).find(n => n.dataset.aqReadonly)?.textContent).toBe(h.t("aq.readonly.PREDEV_DRAFT"));
    expect(all(h.item("RUN_DECISION", s.fl)!).find(n => n.dataset.aqReadonly)?.textContent).toBe(h.t("aq.readonly.RUN_DECISION"));
    for (const [k, id] of [["PREDEV_DRAFT", s.pd], ["RUN_DECISION", s.fl]] as const) expect(all(h.item(k, id)!).filter(n => n.tagName === "BUTTON" && n.dataset.aqAction), k).toEqual([]);
    expect(h.posts()).toEqual([]);
  });

  it("unreadable sources: runs 500 -> no delivery item claimed and a note; pre-dev 500 -> a note with how many missions could not be checked", async () => {
    const {app, s} = await mkApp(); failOn = /^\/v1\/(work-runs(\?|$)|predev\/)/;
    const h = await harness(app);
    const unk = Object.fromEntries(h.find(n => n.dataset.aqUnknown !== undefined).map(n => [n.dataset.aqUnknown, n.textContent]));
    expect(Object.keys(unk).sort()).toEqual(["predev", "runs"]);
    const checked = h.seen.filter(x => x.path.startsWith("/v1/predev/")).length;
    expect(checked).toBeGreaterThan(0); expect(unk.predev).toBe(h.t("aq.unknown.predev", {n: checked}));
    expect(h.find(n => n.dataset.aqCount === "DELIVERY")[0].dataset.n).toBe("0");
    expect(h.find(n => n.dataset.aqCount === "PREDEV_DRAFT")[0].dataset.n).toBe("0");
    expect(h.item("AUTHORIZATION", s.pre)).toBeTruthy(); // the missions read is fine
  });

  it("error: the missions read fails -> an honest error state and no queue items; empty store -> 'Nothing waits for your decision'", async () => {
    let {app} = await mkApp(); failOn = /^\/v1\/missions(\?|$)/;
    let h = await harness(app);
    const q = h.find(n => n.id === "inbox-queue")[0];
    expect(all(q).some(n => /\bnote-error\b/.test(n.className))).toBe(true);
    expect(all(q).filter(n => n.dataset.aqItem !== undefined)).toEqual([]);
    for (const a of apps.splice(0)) await a.close(); fs.rmSync(tmp, {recursive: true, force: true}); tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-aq-")); failOn = null;
    ({app} = await mkApp(true)); h = await harness(app);
    expect(h.find(n => n.dataset.aqTotal === "0")[0]?.textContent).toBe("Nothing waits for your decision right now.");
    expect(h.find(n => n.dataset.aqGroup !== undefined)).toEqual([]);
  });

  it("pure core (mutant killers): modes, links, candidates and cap, current-phase drafts only; en/tr strings", async () => {
    const c = await load("approval-queue-core.js");
    expect(c.AQ_MODE).toEqual({AUTHORIZATION: "TRANSITION", DELIVERY: "DECIDE", FOUNDER_ATTENTION: "DECIDE", PREDEV_DRAFT: "READ_ONLY", RUN_DECISION: "READ_ONLY"});
    expect(c.AQ_LINK).toEqual({AUTHORIZATION: "work", DELIVERY: "work", FOUNDER_ATTENTION: "work", PREDEV_DRAFT: "journey", RUN_DECISION: "work"});
    const id = (i: number) => "msn_" + i.toString(16).padStart(24, "0");
    const ms = Array.from({length: 23}, (_, i) => ({missionId: id(i), status: i === 0 ? "REPORTING" : "DRAFT"}));
    expect(c.predevCandidates(ms)).toEqual({ids: ms.slice(1, 21).map(m => m.missionId), skipped: 2});
    const pre = (phase: string, arts: Record<string, string>) => ({state: "VERIFIED", predev: {active: true, phase, artifacts: Object.entries(arts).map(([kind, state]) => ({kind, state, artifactId: "pda_" + "a".repeat(24)}))}});
    expect(c.pendingDraft(pre("REQUIREMENTS", {BusinessAnalysis: "DRAFT", Requirements: "SUBMITTED"}))).toMatchObject({kind: "Requirements", state: "SUBMITTED"});
    expect(c.pendingDraft(pre("REQUIREMENTS", {BusinessAnalysis: "DRAFT", Requirements: "APPROVED"}))).toBeNull(); // an older phase's draft is not the current decision
    expect(c.pendingDraft({state: "ERROR"})).toBeNull();
    const q = c.buildApprovalQueue({missions: {state: "VERIFIED", items: [{missionId: id(1), status: "PREFLIGHT", title: "A", riskLevel: "R3"}]}, runs: {state: "ERROR"}, attention: {state: "ERROR"}});
    expect(q.groups.find((g: any) => g.kind === "AUTHORIZATION").items[0].actions).toEqual([{to: "AUTHORIZED", type: "approve"}, {to: "BLOCKED", type: "reject"}]);
    expect(q.unknown).toEqual({runs: true, attention: true, predevUnread: 0, predevSkipped: 0});
    expect(c.buildApprovalQueue({missions: {state: "OFFLINE"}}).state).toBe("OFFLINE");
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = Object.keys(en).filter((k: string) => k.startsWith("aq."));
    expect(keys.length).toBe(38);
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(tr[k], k).not.toBe(en[k]); }
  });
});
}
