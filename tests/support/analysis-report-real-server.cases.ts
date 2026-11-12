// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-journey.test.ts tarafından içe aktarılır) DSK-T0002 (UI-014) okunur analiz raporunu doğrular: sunucu tarafında salt-okunur GET /v1/missions/:id/analysis/report (400/404, başlamamış dizi, tam TaskHub analizi, yazma yok) ve renderer tarafında Proje Yolculuğu rapor paneli gerçek buildServer'a (Fastify inject) karşı çizilir.
// Köprü main.mjs'in GERÇEK GET izin listesini uygular (B4 bloğunda çapalı rapor kaydı vardır; varyantlar reddedilir). Okuma yolu "etkin değil" durumu (INVALID_API_PATH) model düzeyinde sınanır.
// Analiz, fake-backend ile aynı biçimde (ücretsiz sabit TaskHub üreticisi, gerçek Claude YOK) tohumlanır; ücretli/ağ çağrısı yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {AnalysisFlow, ANALYSIS_KINDS} from "../../core/workos/crew/analysis.js";
import {PreDevDriver} from "../../core/workos/predev/driver.js";
import {briefFromRecords} from "../../core/workos/predev/brief.js";
import {TASKHUB_ARTIFACTS} from "../../core/workos/predev/fixtures/taskhub/index.js";
import {buildServer} from "../../apps/control-api/src/server.js";
import {D, N, all, desktopAllows, SYNTHETIC_HEALTH} from "./renderer-real-server.cases.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), ACTOR = "implementer@local.invalid", SCOPE = {tenantId: "tA"};
const HDR = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const TH: any = TASKHUB_ARTIFACTS;
type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
let failOn: {re: RegExp; status: number} | null = null;

interface Seed { full: string; draft: string; idle: string; planned: string }
async function seed(dataDir: string): Promise<Seed> {
  const store = new WorkOsStore(dataDir);
  const project = store.createProject({tenantId: "tA", orgId: "org1", name: "DSK-T0002 project", environmentId: "env-dev", createdBy: ACTOR});
  const mk = (title: string) => store.createMission({tenantId: "tA", projectId: project.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: ACTOR}).missionId;
  const full = mk("T0002 approved analysis"), draft = mk("T0002 draft analysis"), idle = mk("T0002 not started"), planned = mk("T0002 planned");
  const builder: any = {async produce(kind: string) { return JSON.stringify(TH[kind]); }};
  const flow = new AnalysisFlow({store, scope: SCOPE, builder, readiness: () => ({ready: true, blockers: [], blocker: null, founderAction: null, profiles: null})} as any);
  const approveAll = async (id: string) => {
    const founder = new PreDevDriver({store, brief: briefFromRecords({project: store.getProject(SCOPE, project.projectId)!, mission: store.getMission(SCOPE, id)!}), builder} as any);
    for (const _k of ANALYSIS_KINDS) { const r: any = await flow.step(id); if (r.status !== "DRAFT_READY") throw new Error(`seed: ${JSON.stringify(r)}`); founder.approveAndAdvance(SCOPE, id, r.artifactId, "FOUNDER_LOCAL", ["ev-t0002-1"]); }
  };
  await approveAll(full); await approveAll(planned);
  const p = flow.createPlan(planned, "FOUNDER_LOCAL"); if (!p.ok) throw new Error(`seed plan: ${JSON.stringify(p)}`);
  const d: any = await flow.step(draft); if (d.status !== "DRAFT_READY") throw new Error(`seed draft: ${JSON.stringify(d)}`);
  return {full, draft, idle, planned};
}
async function mkApp(): Promise<{app: App; s: Seed}> {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const s = await seed(dataDir);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  app.addHook("onRequest", async (req, reply) => { if (failOn && req.method === "GET" && failOn.re.test(req.url)) return reply.code(failOn.status).send({error: "INJECTED_SERVER_FAILURE"}); });
  apps.push(app); return {app, s};
}
const get = (app: App, url: string) => app.inject({method: "GET", url, headers: HDR});
const reportUrl = (id: string) => `/v1/missions/${id}/analysis/report`;
const REPORT_RE = /^\/v1\/missions\/msn_[0-9a-f]{24}\/analysis\/report$/;

// allowReport: ek olarak YALNIZ rapor yolu; denyReport: rapor yolu izin listesinde olmayan eski bir masaüstü derlemesinin benzetimi (INVALID_API_PATH)
async function harness(app: App, missionId: string, {allowReport = false, denyReport = false, lang = "en"} = {}) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), journey = await load("views", "journey.js"), forms = await load("forms.js"), rep = await load("views", "analysis-report.js"), an = await load("views", "analysis-step.js"), dec = await load("views", "predev-decisions.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{path: string; status: number}> = [], refused: string[] = [];
  const bridge = {
    apiGet: async (p: string) => {
      if ((denyReport && REPORT_RE.test(p)) || (!desktopAllows(p) && !(allowReport && REPORT_RE.test(p)))) { refused.push(p); throw new Error("INVALID_API_PATH"); }
      const challenge = crypto.randomBytes(32).toString("hex");
      const hr = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
      if (String(hr.json().controlProof ?? "") !== controlChallengeProof(TOKEN, challenge)) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
      if (p === "/health") return {...SYNTHETIC_HEALTH};
      const r = await get(app, p); seen.push({path: p, status: r.statusCode});
      if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    },
    apiPost: async (p: string) => { refused.push(p); throw new Error("INVALID_API_PATH"); },
  };
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  const out: {root: N | null} = {root: null};
  const ctx: Record<string, any> = {doc, store, api, i18n: {lang, t}, t, navigate: () => undefined, refreshAll: async () => undefined, settleFocus: () => null,
    confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  ctx.rerender = async () => { store.cache.clear(); out.root = await journey.render(ctx); };
  rep.resetAnalysisReport(null); an.resetAnalysis(null); dec.resetPredevDraft(null, null);
  forms.selection.missionId = missionId; await ctx.rerender();
  const find = (pred: (n: N) => boolean) => all(out.root!).filter(pred);
  const panel = () => find(n => n.id === "analysis-report")[0];
  const state = () => all(panel()).find(n => n.dataset.reportView !== undefined)?.dataset.reportView;
  const click = async () => { const b = find(n => n.id === "analysis-report-load")[0]; for (const fn of b.ls.get("click") ?? []) fn({}); for (let i = 0; i < 100 && (rep.reportUi.loading || rep.reportUi.res === null); i++) await new Promise(r => setTimeout(r, 0)); };
  return {ctx, out, seen, refused, rep, find, panel, state, click, t};
}

export function registerAnalysisReportRealServerCases(): void {
describe("DSK-T0002 (UI-014): readable analysis report per mission against the real buildServer", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0002-")); failOn = null; });
  afterEach(async () => {
    failOn = null;
    const forms = await load("forms.js"), rep = await load("views", "analysis-report.js"), an = await load("views", "analysis-step.js"), dec = await load("views", "predev-decisions.js");
    forms.selection.missionId = null; rep.resetAnalysisReport(null); an.resetAnalysis(null); dec.resetPredevDraft(null, null);
    for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } }
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  });

  it("desktop allow-list (main.mjs B4): exactly the anchored report path is a permitted GET; variants are refused", () => {
    const ok = "/v1/missions/msn_" + "a1".repeat(12) + "/analysis/report";
    expect(desktopAllows(ok)).toBe(true);
    for (const bad of [ok + "/", ok + "?x=1", ok + "#x", ok.toUpperCase(), ok.replace("msn_", "prj_"), "/v1/missions/msn_" + "a".repeat(23) + "/analysis/report", "/v1/missions/msn_" + "A".repeat(24) + "/analysis/report",
      "/v1/missions/msn_" + "a".repeat(25) + "/analysis/report", ok.replace("/report", "/reports"), ok.replace("/analysis/report", "/analysis/step"), ok.replace("/analysis/report", "/analysis/plan"), ok.replace("/analysis/report", "/analysis"), "/v1/missions/../analysis/report", " " + ok])
      expect(desktopAllows(bad), bad).toBe(false);
  });

  it("server: GET report rejects a bad id (400) and an unknown mission (404); a mission with no analysis is honestly empty", async () => {
    const {app, s} = await mkApp();
    for (const bad of ["msn_x", "msn_" + "A".repeat(24), "msn_" + "a".repeat(23)]) expect((await get(app, reportUrl(bad))).statusCode, bad).toBe(400);
    const nf = await get(app, reportUrl("msn_" + "0".repeat(24))); expect([nf.statusCode, nf.json()]).toEqual([404, {error: "WORKOS_NOT_FOUND"}]);
    expect((await app.inject({method: "GET", url: reportUrl(s.idle), headers: {host: "127.0.0.1:3210"}})).statusCode, "token required").not.toBe(200);
    const r = (await get(app, reportUrl(s.idle))).json().report;
    expect([r.missionId, r.active, r.phase, r.tasks]).toEqual([s.idle, false, "NOT_STARTED", []]);
    for (const k of ["BusinessAnalysis", "Requirements", "Plan", "Architecture"]) expect(r.sections[k]).toEqual({state: "NOT_STARTED", artifactId: null, version: null, authorRoleId: null, content: null});
  });

  it("server: an approved analysis is projected from the recorded artefacts (states as recorded, content as recorded), and reading writes nothing", async () => {
    const {app, s} = await mkApp();
    const before = (await get(app, `/v1/predev/${s.full}`)).json();
    const res = await get(app, reportUrl(s.full)); expect(res.statusCode).toBe(200);
    const r = res.json().report;
    expect(r.active).toBe(true);
    for (const k of ["BusinessAnalysis", "Requirements", "Plan", "Architecture"]) { expect(r.sections[k].state).toBe("APPROVED"); expect(r.sections[k].artifactId).toBe(before.predev.artifacts[k].artifactId); }
    expect(r.sections.BusinessAnalysis.content.problem).toBe(TH.BusinessAnalysis.problem);
    expect(r.sections.BusinessAnalysis.content.risks).toEqual(TH.BusinessAnalysis.risks);
    expect(r.sections.Requirements.content.functional.map((x: any) => x.id)).toEqual(TH.Requirements.functional.map((x: any) => x.id));
    expect(r.sections.Requirements.content.functional[0].acceptanceCriteria).toEqual(TH.Requirements.functional[0].acceptanceCriteria);
    expect(r.sections.Plan.content.workPackages.map((w: any) => w.id)).toEqual(TH.Plan.workPackages.map((w: any) => w.id));
    expect(r.sections.Architecture.content.risks).toEqual(TH.Architecture.risks);
    expect(r.tasks).toEqual([]);
    // the draft mission: its first artefact carries its recorded (non-approved) state, the rest NOT_STARTED
    const dr = (await get(app, reportUrl(s.draft))).json().report;
    expect(dr.sections.BusinessAnalysis.state).not.toBe("APPROVED"); expect(dr.sections.BusinessAnalysis.content.problem).toBe(TH.BusinessAnalysis.problem);
    expect([dr.sections.Requirements.state, dr.sections.Requirements.content]).toEqual(["NOT_STARTED", null]);
    // a created task plan is listed
    const pr = (await get(app, reportUrl(s.planned))).json().report; expect(pr.tasks.length).toBe(TH.Plan.workPackages.length);
    expect((await get(app, `/v1/predev/${s.full}`)).json()).toEqual(before);
    for (const m of ["POST", "PUT", "DELETE"]) expect((await app.inject({method: m as any, url: reportUrl(s.full), headers: HDR, payload: m === "POST" ? {} : undefined})).statusCode, m).toBe(404);
  });

  it("renderer, real desktop allow-list: the decision state is shown live and the report is read only on request", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.full);
    expect(h.panel(), "report panel rendered in the journey").toBeTruthy();
    expect(h.state()).toBe("NOT_LOADED");
    const cnt = all(h.panel()).find(n => n.dataset.reportApproved !== undefined)!;
    expect([cnt.dataset.reportApproved, cnt.dataset.reportTotal]).toEqual(["4", "4"]);
    expect(all(h.panel()).filter(n => n.dataset.reportDecision).map(n => [n.dataset.reportDecision, n.dataset.reportState])).toEqual([["BusinessAnalysis", "APPROVED"], ["Requirements", "APPROVED"], ["Plan", "APPROVED"], ["Architecture", "APPROVED"]]);
    expect(h.seen.some(x => REPORT_RE.test(x.path)) || h.refused.some(p => REPORT_RE.test(p)), "nothing read before the Founder asks").toBe(false);
    // approve/reject flow untouched: the analysis step and pre-dev decisions sections are still rendered
    expect(h.find(n => n.id === "analysis-step-submit")).toHaveLength(1);
    expect(h.find(n => n.id === "analysis-step")).toHaveLength(1);
    await h.click();
    // main.mjs B4 allow-list carries the anchored report entry: the real bridge reads it and the report renders
    expect(h.state()).toBe("VERIFIED"); expect(h.refused).toEqual([]);
    expect(all(h.panel()).find(n => n.dataset.reportProblem)?.textContent).toBe(TH.BusinessAnalysis.problem);
    expect(h.seen.filter(x => REPORT_RE.test(x.path))).toEqual([{path: reportUrl(s.full), status: 200}]);
  });

  it("renderer, report route permitted: summary, proposed tasks with acceptance criteria, risks and open questions come from the server data", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.full, {allowReport: true});
    await h.click();
    expect(h.state()).toBe("VERIFIED"); expect(h.refused).toEqual([]);
    const p = h.panel(), q = (k: string) => all(p).filter(n => n.dataset[k] !== undefined);
    expect(q("reportProblem")[0].textContent).toBe(TH.BusinessAnalysis.problem);
    expect(q("reportTask").map(n => n.dataset.reportTask)).toEqual(TH.Plan.workPackages.map((w: any) => w.id));
    const reqs = [...TH.Requirements.functional, ...TH.Requirements.nonFunctional];
    const expectedCriteria = TH.Plan.workPackages.flatMap((w: any) => w.satisfies.flatMap((id: string) => reqs.find((r: any) => r.id === id)?.acceptanceCriteria ?? []));
    expect(q("reportCriterion").map(n => n.textContent)).toEqual(expectedCriteria);
    expect(expectedCriteria.length).toBeGreaterThan(0);
    expect(q("reportRisk").map(n => n.dataset.reportRisk)).toEqual([...TH.BusinessAnalysis.risks.map(() => "BusinessAnalysis"), ...TH.Architecture.risks.map(() => "Architecture")]);
    expect(q("reportQuestion").length).toBe(TH.BusinessAnalysis.assumptions.length + TH.BusinessAnalysis.constraints.length + TH.Plan.outOfScope.length);
    expect(q("reportCreatedTasks")[0].dataset.reportCreatedTasks).toBe("0");
    expect(h.seen.filter(x => REPORT_RE.test(x.path))).toEqual([{path: reportUrl(s.full), status: 200}]);
    // Turkish strings render without raw keys
    const tr = await harness(app, s.planned, {allowReport: true, lang: "tr"}); await tr.click();
    expect(tr.state()).toBe("VERIFIED"); expect(tr.panel().textContent).toContain("Önerilen görevler ve kabul kriterleri"); expect(tr.panel().textContent).not.toContain("analysisReport.");
    expect(all(tr.panel()).find(n => n.dataset.reportCreatedTasks !== undefined)!.dataset.reportCreatedTasks).toBe(String(TH.Plan.workPackages.length));
  });

  it("renderer: a desktop build without the report route says 'not enabled' and shows no content", async () => {
    const {app, s} = await mkApp(), h = await harness(app, s.full, {denyReport: true}); await h.click();
    expect(h.state()).toBe("UNAVAILABLE"); expect(h.refused).toEqual([reportUrl(s.full)]);
    expect(h.panel().textContent).toContain("not enabled in this desktop build"); expect(h.panel().textContent).not.toContain(TH.BusinessAnalysis.problem);
  });

  it("renderer: honest empty state for a mission with no analysis, honest error on a server failure, and retry recovers", async () => {
    const {app, s} = await mkApp();
    const e = await harness(app, s.idle, {allowReport: true}); await e.click(); expect(e.state()).toBe("EMPTY");
    expect(e.panel().textContent).toContain("No analysis has been recorded");
    failOn = {re: /\/analysis\/report$/, status: 500};
    const h = await harness(app, s.full, {allowReport: true}); await h.click();
    expect(h.state()).toBe("ERROR"); expect(h.panel().textContent).not.toContain(TH.BusinessAnalysis.problem);
    failOn = null; h.rep.reportUi.res = null; await h.click(); expect(h.state()).toBe("VERIFIED");
    // malformed 2xx is not shown as a report
    const mod = await load("analysis-report-core.js");
    expect(mod.mapAnalysisReport({report: {missionId: s.full, active: true, phase: "X", sections: {}, tasks: []}}).state).toBe("ERROR");
    expect(mod.analysisReportPath("msn_bad")).toBe(null);
  });
});
}
