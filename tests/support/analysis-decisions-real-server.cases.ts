// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır) UASCO-T0013'ü doğrular: Proje Yolculuğu'ndaki analiz/pre-dev bölümü gerçek buildServer'a
// (Fastify inject; main.mjs GET izin listesi + B4 bloğu, POST_ROUTE_RES izin listesi ve apiGet/apiPost sözleşmesi) karşı çizilir. Faz zaman çizelgesi (şu anki faz, verilen ve bekleyen kararlar),
// onay penceresi arkasındaki onay/ret kararları (onaylandı / vazgeçildi / onay işlevi yok), etiketli engel nedenleri (en/tr, ham kod yok), uçuştaki istek notu, okuma hatası, etkin olmayan rota ve
// başlamamış dizi sınanır. Taslak, fake-backend ile aynı biçimde (ücretsiz sabit TaskHub üreticisi, gerçek Claude YOK) tohumlanır; ücretli/ağ çağrısı yoktur.
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
// main.mjs POST izin listesi (korumalı dosya DEĞİŞTİRİLMEDEN okunur ve değerlendirilir)
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const postAllowed = (() => { const a = MAIN_SRC.indexOf("const POST_ROUTE_RES="), b = MAIN_SRC.indexOf("/** Gövde düz"); if (a < 0 || b < 0) throw new Error("main.mjs POST allow-list not found"); return new Function(`${MAIN_SRC.slice(a, b)}\nreturn desktopPostPathAllowed;`)() as (p: string) => boolean; })();
type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
let failOn: {re: RegExp; method: string; status: number} | null = null;
let holdOn: {re: RegExp; gate: Promise<void>} | null = null;

interface Seed { pending: string; idle: string; artifactId: string }
async function seed(dataDir: string): Promise<Seed> {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "T0013 project", environmentId: "env-dev", createdBy: ACTOR});
  const mk = (title: string) => store.createMission({tenantId: "tA", projectId: p.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR}).missionId;
  const pending = mk("T0013 pending decision"), idle = mk("T0013 not started");
  // fake-backend ile aynı: sabit TaskHub taslağı (ücretsiz, gerçek sağlayıcı yok)
  const flow = new AnalysisFlow({store, scope: SCOPE, builder: {async produce(kind: any) { return JSON.stringify((TASKHUB_ARTIFACTS as any)[kind]); }}, readiness: () => ({ready: true, blockers: [], blocker: null, founderAction: null, profiles: null})} as any);
  const draft: any = await flow.step(pending);
  if (draft.status !== "DRAFT_READY") throw new Error(`seed: ${JSON.stringify(draft)}`);
  return {pending, idle, artifactId: draft.artifactId};
}
async function mkApp(): Promise<{app: App; s: Seed}> {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const s = await seed(dataDir);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => {
    if (holdOn && holdOn.re.test(req.url)) await holdOn.gate;
    if (failOn && req.method === failOn.method && failOn.re.test(req.url)) return reply.code(failOn.status).send(failOn.status === 404 ? {} : {error: "INJECTED_SERVER_FAILURE"});
  });
  apps.push(app); return {app, s};
}
async function harness(app: App, missionId: string, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), journey = await load("views", "journey.js"), forms = await load("forms.js"), dec = await load("views", "predev-decisions.js"), an = await load("views", "analysis-step.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{method: string; path: string; status: number}> = [], refused: string[] = [];
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
    // main.mjs uasco:api-post: izin listesi dışı yol INVALID_API_PATH; aksi halde {status, body}
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
  const t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  const out: {root: N | null; confirms: any[]; answer: boolean | Promise<boolean>} = {root: null, confirms: [], answer: true};
  const ctx: Record<string, any> = {doc, store, api, i18n: {lang, t}, t, navigate: () => undefined, refreshAll: async () => undefined, settleFocus: () => null,
    confirm: async (o: unknown) => { out.confirms.push(o); return out.answer; }, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  ctx.rerender = async () => { store.cache.clear(); out.root = await journey.render(ctx); };
  dec.resetPredevDraft(null, null); an.resetAnalysis(null);
  for (const f of ["predev-start", "predev-approve", "predev-reject", "analysis-step", "analysis-reapprove", "analysis-plan"]) { delete forms.drafts.status[f]; forms.drafts.busy[f] = false; }
  forms.selection.missionId = missionId; await ctx.rerender();
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const posts = () => seen.filter(x => x.method === "POST");
  const serverPredev = async () => (await app.inject({method: "GET", url: `/v1/predev/${missionId}`, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json().predev;
  return {ctx, out, seen, refused, dec, an, forms, find, posts, serverPredev, t, text: () => out.root!.textContent};
}
const tick = () => new Promise(r => setTimeout(r, 0));

export function registerAnalysisDecisionsRealServerCases(): void {
describe("UASCO-T0013: analysis / pre-dev phase timeline and confirmed decisions against the real buildServer", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0013-")); failOn = null; holdOn = null; });
  afterEach(async () => {
    failOn = null; holdOn = null;
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });

  it("phase timeline: five phases, the current one marked, decisions taken / pending / not started counted from the server's artefact states", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    const tl = h.find(n => n.id === "predev-timeline")[0];
    expect(tl, "timeline shown for an active sequence").toBeTruthy();
    expect([tl.dataset.tlTaken, tl.dataset.tlPending, tl.dataset.tlNone, tl.dataset.tlComplete]).toEqual(["0", "1", "4", "0"]);
    expect(all(tl).find(n => n.dataset.tlSummary)?.textContent).toBe("Decisions taken: 0 · awaiting your decision: 1 · not started: 4");
    const rows = all(tl).filter(n => n.dataset.tlKind !== undefined);
    expect(rows.map(r => [r.dataset.tlKind, r.dataset.tlDecision, r.dataset.tlCurrent])).toEqual([
      ["BusinessAnalysis", "PENDING", "1"], ["Requirements", "NONE", "0"], ["Plan", "NONE", "0"], ["Architecture", "NONE", "0"], ["UxSpec", "NONE", "0"]]);
    expect(rows[0].attrs.get("aria-current")).toBe("step");
    expect(rows[0].textContent).toContain("(current phase)"); expect(rows[0].textContent).toContain("awaiting your decision");
    expect(h.seen.filter(x => x.status !== 200)).toEqual([]); expect(h.refused).toEqual([]);
  });

  it("approve: the confirmation names the phase and the artefact; once confirmed the server records it and the timeline shows the decision taken", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    h.dec.predevDraft.evidence = "ev-t0013-1";
    // wired through the real button: the confirmation carries the phase name (the button passes the kind)
    const btn = h.find(n => n.id === "predev-approve-submit")[0]; for (const fn of btn.ls.get("click") ?? []) fn({});
    for (let i = 0; i < 50 && h.posts().length === 0; i++) await tick();
    for (let i = 0; i < 50 && h.forms.drafts.busy["predev-approve"]; i++) await tick();
    expect(h.out.confirms).toHaveLength(1);
    expect(h.out.confirms[0]).toMatchObject({title: "Approve this draft?", action: "Approve the Business analysis draft", target: `Business analysis (${s.artifactId})`, confirmLabel: "Approve"});
    expect(h.posts().map(p => [p.path, p.status])).toEqual([[`/v1/missions/${s.pending}/predev/artifacts/${s.artifactId}/approve`, 200]]);
    expect((await h.serverPredev()).artifacts.BusinessAnalysis.state).toBe("APPROVED");
    await h.ctx.rerender();
    const tl = h.find(n => n.id === "predev-timeline")[0];
    expect([tl.dataset.tlTaken, tl.dataset.tlPending]).toEqual(["1", "0"]);
    expect(all(tl).find(n => n.dataset.tlKind === "BusinessAnalysis")?.dataset.tlDecision).toBe("APPROVED");
    expect(all(tl).find(n => n.dataset.tlKind === "Requirements")?.dataset.tlCurrent).toBe("1");
  });

  it("approve cancelled, and no confirm function at all: nothing reaches the server, the status says so, the draft stays decidable", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    h.dec.predevDraft.evidence = "ev-t0013-1"; h.out.answer = false;
    expect(await h.dec.submitApprove(h.ctx, s.pending, s.artifactId, "BusinessAnalysis")).toEqual({ok: false, cancelled: true});
    expect(h.posts()).toEqual([]); expect(h.out.confirms).toHaveLength(1);
    expect(h.find(n => n.id === "predev-approve-status")[0]?.textContent).toContain("Action was not confirmed; nothing was changed.");
    expect(h.find(n => n.id === "predev-approve-submit").length).toBe(1);
    delete h.ctx.confirm;
    expect(await h.dec.submitReject(h.ctx, s.pending, s.artifactId, "BusinessAnalysis")).toMatchObject({ok: false});
    expect(h.posts()).toEqual([]);
    expect((await h.serverPredev()).artifacts.BusinessAnalysis.state).toBe("DRAFT");
    expect(h.forms.drafts.busy["predev-approve"]).toBe(false); expect(h.forms.drafts.busy["predev-reject"]).toBe(false);
  });

  it("reject: confirmed with a reason, the server records REJECTED and the timeline shows 'rejected, rework requested'", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    h.dec.predevDraft.reason = "Scope is unclear";
    expect(await h.dec.submitReject(h.ctx, s.pending, s.artifactId, "BusinessAnalysis")).toMatchObject({ok: true});
    expect(h.out.confirms[0]).toMatchObject({title: "Reject this draft?", action: "Reject the Business analysis draft", confirmLabel: "Reject"});
    expect((await h.serverPredev()).artifacts.BusinessAnalysis.state).toBe("REJECTED");
    const row = h.find(n => n.dataset.tlKind === "BusinessAnalysis")[0];
    expect(row.dataset.tlDecision).toBe("REJECTED"); expect(row.textContent).toContain("decision taken: rejected, rework requested");
  });

  it("mission switched while the Approve / Reject dialog is open: even a confirmed dialog posts nothing for the old mission, the lock is released and the draft stays decidable (#373 F1)", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    for (const verb of ["approve", "reject"] as const) {
      h.dec.resetPredevDraft(s.pending, s.artifactId); h.dec.predevDraft.evidence = "ev-1"; h.dec.predevDraft.reason = "Scope is unclear";
      let release!: (v: boolean) => void; h.out.answer = new Promise<boolean>(r => { release = r; });
      const p = verb === "approve" ? h.dec.submitApprove(h.ctx, s.pending, s.artifactId, "BusinessAnalysis") : h.dec.submitReject(h.ctx, s.pending, s.artifactId, "BusinessAnalysis");
      for (let i = 0; i < 5; i++) await tick();
      expect(h.forms.drafts.busy[`predev-${verb}`], `${verb}: locked while the dialog is open`).toBe(true);
      h.forms.selection.missionId = s.idle; await h.ctx.rerender(); // the Founder opened another mission meanwhile
      expect(h.dec.predevDraft.missionId).toBe(s.idle);
      release(true);
      expect(await p, verb).toEqual({ok: false, stale: true, status: null});
      expect(h.posts(), `${verb}: nothing posted for the old mission`).toEqual([]);
      expect(h.forms.drafts.busy[`predev-${verb}`], `${verb}: lock released`).toBe(false);
      expect((await h.serverPredev()).artifacts.BusinessAnalysis.state, verb).toBe("DRAFT");
      h.forms.selection.missionId = s.pending; await h.ctx.rerender();
    }
    expect(h.out.confirms).toHaveLength(2);
  });

  it("loading: while the confirmed request is in flight the panel says so and Approve / Reject are disabled; a second press sends nothing", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    let open!: () => void; holdOn = {re: /\/predev\/artifacts\/[^/]+\/approve$/, gate: new Promise<void>(r => { open = r; })};
    h.dec.predevDraft.evidence = "ev-1";
    const p = h.dec.submitApprove(h.ctx, s.pending, s.artifactId, "BusinessAnalysis");
    for (let i = 0; i < 20; i++) await tick();
    expect(h.find(n => n.id === "predev-in-flight").length).toBe(1);
    expect(h.find(n => n.id === "predev-approve-submit")[0].attrs.has("disabled")).toBe(true);
    expect(await h.dec.submitApprove(h.ctx, s.pending, s.artifactId, "BusinessAnalysis")).toEqual({ok: false, busy: true});
    open(); expect(await p).toMatchObject({ok: true});
    expect(h.posts().length).toBe(1); expect(h.out.confirms).toHaveLength(1);
  });

  it("blocked analysis: every blocker the real server returns is shown with its human label in English and Turkish, never as a raw, unrecognised code", async () => {
    for (const lang of ["en", "tr"]) {
      const {app, s} = await mkApp(), h = await harness(app, s.idle, lang);
      const r = await h.an.submitAnalysisStep(h.ctx, s.idle);
      expect(r.kind, `${lang}: real server answer`).toBe("STEP");
      const items = h.find(n => n.dataset.analysisBlocker !== undefined);
      expect(items.length, `${lang}: blockers listed`).toBeGreaterThan(0);
      for (const li of items) {
        const code = li.dataset.analysisBlocker, head = code.replace(/^(implementer|reviewer):/, "").split(":")[0];
        expect(li.textContent, `${lang}: ${code} is labelled`).not.toContain(h.t("analysis.unrecognised"));
        expect(li.textContent, `${lang}: ${code}`).toContain(h.t(`analysis.blocker.${head}`));
        expect(li.textContent.trim(), `${lang}: ${code} is not shown bare`).not.toBe(code);
      }
      expect(h.posts().every(p => p.path === `/v1/missions/${s.idle}/analysis/step`)).toBe(true); // nothing else was posted; no decision was taken
      for (const a of apps.splice(0)) await a.close();
    }
  });

  it("error: the pre-dev read fails (HTTP 500) -> an honest error state, no timeline and no decision buttons", async () => {
    const {app, s} = await mkApp(); failOn = {re: /^\/v1\/predev\//, method: "GET", status: 500};
    const h = await harness(app, s.pending);
    expect(h.find(n => n.id === "predev-timeline")).toEqual([]);
    expect(h.find(n => n.id === "predev-approve-submit" || n.id === "predev-reject-submit")).toEqual([]);
    const st = all(h.find(n => n.id === "journey-predev")[0]!).find(n => n.dataset.journeyState !== undefined);
    expect(st?.dataset.journeyState, "journey's classified failure block").toBe("ERROR");
    expect(st?.textContent).toContain(`/v1/predev/${s.pending}: HTTP 500`);
  });

  it("unavailable: the decision route answers 404 without a server code -> 'not enabled in this build', the draft is not called approved", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.pending);
    failOn = {re: /\/predev\/artifacts\/[^/]+\/approve$/, method: "POST", status: 404};
    h.dec.predevDraft.evidence = "ev-1";
    expect(await h.dec.submitApprove(h.ctx, s.pending, s.artifactId, "BusinessAnalysis")).toMatchObject({ok: false, kind: "NOT_ENABLED"});
    expect(h.find(n => n.id === "predev-approve-status")[0]?.textContent).toContain(h.t("predev.notEnabled"));
    failOn = null; expect((await h.serverPredev()).artifacts.BusinessAnalysis.state).toBe("DRAFT");
  });

  it("empty: a mission whose pre-dev sequence has not started shows the start action, no timeline and no decision buttons", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.idle);
    expect(h.find(n => n.id === "predev-timeline")).toEqual([]);
    expect(h.find(n => n.dataset.decision === "start").length).toBe(1);
    expect(h.find(n => n.id === "predev-approve-submit")).toEqual([]);
  });

  it("pure core: decisions come only from recorded states; counts and the current phase are exact (mutant killers)", async () => {
    const core = await load("predev-decisions-core.js");
    expect(core.DECISION_OF).toEqual({APPROVED: "APPROVED", REJECTED: "REJECTED", DRAFT: "PENDING", SUBMITTED: "PENDING", NOT_STARTED: "NONE"});
    const a = (kind: string, state: string) => ({kind, state});
    const tl = core.phaseTimeline({phase: "PLANNING", artifacts: [a("BusinessAnalysis", "APPROVED"), a("Requirements", "REJECTED"), a("Plan", "SUBMITTED"), a("Architecture", "NOT_STARTED"), a("UxSpec", "WEIRD")]});
    expect(tl).toMatchObject({taken: 2, pending: 1, notStarted: 2, complete: false, currentKind: "Plan"});
    expect(tl.rows.map((r: any) => r.current)).toEqual([false, false, true, false, false]);
    expect(tl.rows[4].decision).toBe("NONE"); // an unknown state is never a decision
    expect(core.phaseTimeline({phase: "PRE_DEV_COMPLETE", artifacts: []})).toMatchObject({complete: true, currentKind: null});
    expect(core.phaseTimeline(null)).toBeNull(); expect(core.phaseTimeline({phase: "PLANNING"})).toBeNull();
    const en = await load("locales", "en.js"), tr = await load("locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("predev.tl.") || k.startsWith("predev.confirm."));
    expect(keys.length).toBe(26);
    for (const k of keys) { expect(T[k], k).toBeTruthy(); expect(T[k], k).not.toBe(E[k]); }
  });
});
}
