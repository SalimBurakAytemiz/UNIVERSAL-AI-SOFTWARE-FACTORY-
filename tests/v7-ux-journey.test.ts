// //TR: Bu test FA-V2-PRODUCT Proje Yolculuğu salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — GERÇEK bir crew koşusundan sonra GET /v1/predev + GET /v1/crew gövdeleri saf eşleyicilerden (journey-core.js) ve görünümden (views/journey.js) geçer; sözleşme alan adları birebir tutar. (2) İZİN LİSTESİ — iki GET CORE-8'de zaten izinlidir (main.mjs DEĞİŞMEZ), görünüm yalnız bu iki GET + mission listesini okur, hiçbir yazma/köprü çağrısı yapmaz. (3) SAF ESLEYİCİLER — bozuk kimlik/enum/biçim fail-closed ERROR olur (kısmi görünüm yok), onay yalnız kayıtlı durumdan türetilir. (4) GÖRÜNÜM DÜRÜSTLÜĞÜ — mission seçilmedi / pre-dev yok / koşu yok boş durumları, OFFLINE/UNAVAILABLE/ERROR, gerçek faz/artefakt/ledger/verdict, teslim yalnız kaynak düzeyi (NOT_VERIFIED), PRODUCT_VERIFIED ASLA, uydurma yok. (5) ERİŞİLEBİLİRLİK — sıralı liste/zaman çizelgesi anlambilimi, aria-current adımı, klavye ile etkinleşen düğmeler, etiketli seçici, reduced-motion/forced-colors CSS. (6) YEREL AYNALIK — journey.* anahtarları TR/EN birebir ve kullanılan her anahtar mevcut. (7) ROTA — planned.js bileşen devri, app.js VIEWS değişmez.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {PreDevDriver, type BuilderPort, type MissionContext} from "../core/workos/predev/driver.js";
import {CrewCoordinator, type ReworkDecider, type CrewStore} from "../core/workos/crew/coordinator.js";
import {buildCrewPlan} from "../core/workos/crew/assignment.js";
import {TASKHUB_BRIEF} from "../core/workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../core/workos/predev/fixtures/taskhub/index.js";
import type {ArtifactKind} from "../core/workos/predev/types.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "main.mjs"), "utf8");

// ---------------- (1) REAL control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
const APPROVER = "reviewer@local.invalid";
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-journey-")); });
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(tenantId = "tA"): App {
  fs.mkdirSync(runtime(), {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), dataDir: dataDir(), tenantId, port: 3210, logger: false});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };

class TaskHubFixtureBuilder implements BuilderPort {
  async produce(kind: ArtifactKind, _rolePrompt: string, _ctx: MissionContext): Promise<string> { return JSON.stringify(TASKHUB_ARTIFACTS[kind]); }
}
class AcceptAllDecider implements ReworkDecider { decide(): {accept: true} { return {accept: true}; } }
function seedMission(tenantId = "tA"): {missionId: string; title: string} {
  const store = new WorkOsStore(dataDir());
  const scope = {tenantId};
  const p = store.createProject({tenantId, orgId: "org1", name: "TaskHub", environmentId: "env-dev", createdBy: RECORDER});
  const m = store.createMission({tenantId, projectId: p.projectId, title: "TaskHub journey", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
  store.transitionMission(scope, m.missionId, "PREFLIGHT", "preflight", RECORDER);
  store.transitionMission(scope, m.missionId, "AUTHORIZED", "authorized", RECORDER);
  return {missionId: m.missionId, title: "TaskHub journey"};
}
async function seedCompletedCrew(tenantId = "tA"): Promise<{missionId: string; title: string}> {
  const store = new WorkOsStore(dataDir());
  const scope = {tenantId};
  const seeded = seedMission(tenantId);
  const builder = new TaskHubFixtureBuilder();
  const driver = new PreDevDriver({store, brief: TASKHUB_BRIEF, builder});
  let tick = 0;
  const coord = new CrewCoordinator({store: store as unknown as CrewStore, driver, plan: buildCrewPlan(), brief: TASKHUB_BRIEF, builder,
    decider: new AcceptAllDecider(), maxReworkPerPhase: 2, recorder: RECORDER, approver: APPROVER, now: () => `2026-10-16T00:00:${String(tick++ % 60).padStart(2, "0")}.000Z`});
  const res = await coord.run(scope, seeded.missionId);
  if (res.status !== "PRE_DEV_COMPLETE") throw new Error(`seed failed: ${res.status}`);
  return seeded;
}

// ---------------- fake DOM ----------------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  focused = false;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  focus() { this.focused = true; }
  scrollIntoView() { /* test double */ }
}
class D {
  body: N; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byData = (root: N, k: string, v?: string) => all(root).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const allData = (root: N, k: string, v?: string) => all(root).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const byId = (root: N, id: string) => all(root).find(n => n.id === id);
const fire = (n: N, ev: string, e: any = {}) => { for (const fn of n.ls.get(ev) ?? []) fn(e); };
const cls = (n: N, c: string) => n.className.split(/\s+/).includes(c);

const MSN = "msn_" + "ab".repeat(12);
const MSN2 = "msn_" + "cd".repeat(12);
const MISSIONS = {missions: [
  {missionId: MSN, projectId: "prj_" + "11".repeat(12), title: "Alpha mission", status: "EXECUTING", riskLevel: "R1", createdAt: "2026-10-16T01:00:00.000Z"},
  {missionId: MSN2, projectId: "prj_" + "11".repeat(12), title: "Beta mission", status: "AUTHORIZED", riskLevel: "R0", createdAt: "2026-10-15T01:00:00.000Z"}]};

async function mkCtx(getFn: (p: string) => any, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  let rerenders = 0;
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, rerender: async () => { rerenders += 1; }, settleFocus: () => {}};
  return {ctx, doc, calls, selection: forms.selection, rerenders: () => rerenders};
}
const fail = (p: string, status = 404) => { throw new Error(`${p}: HTTP ${status}`); };

// ---------------- fixtures ----------------
const preArt = (state: string, extra: Record<string, any> = {}) => ({state, artifactId: state === "NOT_STARTED" ? null : "pda_" + "aa".repeat(12), version: state === "NOT_STARTED" ? null : 1, authorRoleId: state === "NOT_STARTED" ? null : "UASCO-0022", approved: state === "APPROVED", evidenceRefs: state === "APPROVED" ? ["e1", "e2"] : [], mappedRoleIds: ["UASCO-0022", "UASCO-0021"], ...extra});
const predevBody = (over: Record<string, any> = {}, arts: Record<string, any> = {}) => ({predev: {
  schemaVersion: 1, missionId: MSN, active: true, phase: "PLANNING", preDevId: "pdv_" + "bb".repeat(12),
  artifacts: {BusinessAnalysis: preArt("APPROVED"), Requirements: preArt("APPROVED"), Plan: preArt("DRAFT"), Architecture: preArt("NOT_STARTED"), UxSpec: preArt("NOT_STARTED"), ...arts}, ...over}});
const inactivePredev = () => predevBody({active: false, phase: "NOT_STARTED", preDevId: null}, {BusinessAnalysis: preArt("NOT_STARTED"), Requirements: preArt("NOT_STARTED"), Plan: preArt("NOT_STARTED")});
const evt = (type: string, kind: string, roleId: string, version: number, extra: Record<string, any> = {}) => ({kind, phase: "BUSINESS_ANALYSIS", roleId, type, version, artifactId: "pda_" + "aa".repeat(12), actor: "implementer@local.invalid", at: "2026-10-16T00:00:01.000Z", ...extra});
const expert = (roleId: string, kind: string, assignmentState: string, events: any[] = [], extra: Record<string, any> = {}) => ({roleId, kind, phase: "BUSINESS_ANALYSIS", assignmentState, reworkCount: 0, currentVersion: events.length ? 1 : 0, currentArtifactId: null, events, ...extra});
const ver = (cycle: number, over: Record<string, any> = {}) => ({cycle, sourceCommit: "c".repeat(40), developerRoleId: "UASCO-0100", reviewerRoleId: "UASCO-0200", reviewVerdict: "NONE", reviewReason: null, ...over});
const run = (runId: string, over: Record<string, any> = {}) => ({runId, missionId: MSN, developerRoleId: "UASCO-0100", reviewerRoleId: "UASCO-0200", versions: [ver(1)], finalVerdict: "NONE", delivery: null, ...over});
const crewBody = (over: Record<string, any> = {}) => {
  const ev1 = evt("RECORDED", "BusinessAnalysis", "UASCO-0022", 1), ev2 = evt("SUBMITTED", "BusinessAnalysis", "UASCO-0022", 1), ev3 = evt("APPROVED", "BusinessAnalysis", "UASCO-0022", 1, {evidenceRefs: ["e1"]});
  return {crew: {missionId: MSN, preDevId: "pdv_" + "bb".repeat(12), coordination: {missionId: MSN, preDevId: "pdv_" + "bb".repeat(12),
    experts: [expert("UASCO-0022", "BusinessAnalysis", "APPROVED", [ev1, ev2, ev3]), expert("UASCO-0023", "Requirements", "ASSIGNED")], events: [ev1, ev2, ev3], reworkRequests: []}, devReview: [], ...over}};
};
const ROUTES: Record<string, any> = {};
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/missions": MISSIONS, [`/v1/predev/${MSN}`]: predevBody(), [`/v1/crew/${MSN}`]: crewBody(), ...over};
  return p in m ? m[p] : fail(p);
};
void ROUTES;
// Bütün render edilmiş metin + öznitelik/dataset değerleri (PRODUCT_VERIFIED taraması için).
const surface = (root: N) => all(root).map(n => `${n.textContent}|${n.className}|${[...n.attrs.values()].join(",")}|${Object.values(n.dataset).join(",")}`).join("\n");
const pills = (root: N) => allData(root, "pill").map(n => n.dataset.pill);

describe("Project Journey — GENUINE control-api read-models flow through mappers and view", () => {
  it("a real completed crew run is shown verbatim: all five phases APPROVED, real ledger events, no runs, no fabrication", async () => {
    const seeded = await seedCompletedCrew();
    const app = mkApp();
    const predevRaw = await getJson(app, `/v1/predev/${seeded.missionId}`), crewRaw = await getJson(app, `/v1/crew/${seeded.missionId}`);
    const core = await load("journey-core.js");
    const pd = core.mapPredev(predevRaw), cr = core.mapCrew(crewRaw);
    expect(pd.state).toBe("VERIFIED");
    expect(pd.predev.phase).toBe("PRE_DEV_COMPLETE");
    expect(pd.predev.artifacts.map((a: any) => a.state)).toEqual(["APPROVED", "APPROVED", "APPROVED", "APPROVED", "APPROVED"]);
    expect(cr.state).toBe("VERIFIED");
    expect(cr.crew.experts.length).toBe(5);
    expect(cr.crew.experts.every((e: any) => e.assignmentState === "APPROVED")).toBe(true);
    expect(cr.crew.runs).toEqual([]);
    const journey = await load("views", "journey.js");
    const missionsBody = {missions: [{missionId: seeded.missionId, projectId: "prj_" + "11".repeat(12), title: seeded.title, status: "AUTHORIZED", riskLevel: "R0", createdAt: "2026-10-16T00:00:00.000Z"}]};
    const {ctx, calls, selection} = await mkCtx(async p => p === "/v1/missions" ? missionsBody : getJson(app, p));
    selection.missionId = seeded.missionId;
    const root = await journey.render(ctx);
    expect(calls.slice().sort()).toEqual(["/v1/crew/" + seeded.missionId, "/v1/missions", "/v1/predev/" + seeded.missionId].sort());
    const phases = allData(root, "kind").filter(n => n.tagName === "LI" && "artState" in n.dataset);
    expect(phases.map(n => n.dataset.kind)).toEqual(["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"]);
    expect(phases.every(n => n.dataset.artState === "APPROVED" && n.dataset.approved === "1")).toBe(true);
    expect(allData(root, "event").length).toBeGreaterThan(0);
    // Koşu yok: dürüst boş durum; teslim/verdict uydurulmaz.
    expect(root.textContent).toContain("No runs yet for this mission.");
    expect(allData(root, "run").length).toBe(0);
    expect(surface(root)).not.toMatch(/PRODUCT_VERIFIED"|spill-product_verified/);
  });
  it("a real mission with no pre-dev sequence shows the honest 'no pre-dev yet' state (nothing invented)", async () => {
    const seeded = seedMission();
    const app = mkApp();
    const journey = await load("views", "journey.js");
    const missionsBody = {missions: [{missionId: seeded.missionId, projectId: "prj_" + "11".repeat(12), title: seeded.title, status: "AUTHORIZED", riskLevel: "R0", createdAt: "2026-10-16T00:00:00.000Z"}]};
    const {ctx, selection} = await mkCtx(async p => p === "/v1/missions" ? missionsBody : getJson(app, p));
    selection.missionId = seeded.missionId;
    const root = await journey.render(ctx);
    expect(root.textContent).toContain("No pre-development yet");
    expect(allData(root, "artState").length).toBe(0);
    expect(root.textContent).toContain("only assigned");
  });
});

// ---------------- (2) allow-list ----------------
describe("Project Journey — only already-allow-listed read-only GETs are used (main.mjs unchanged)", () => {
  it("main.mjs already admits exactly the canonical predev/crew GET paths (CORE-8), so no allow-list change is needed", () => {
    expect(mainSrc).toContain("const PREDEV_DETAIL_RE=/^\\/v1\\/predev\\/msn_[0-9a-f]{24}$/;");
    expect(mainSrc).toContain("const CREW_DETAIL_RE=/^\\/v1\\/crew\\/msn_[0-9a-f]{24}$/;");
    expect(mainSrc).toMatch(/PREDEV_DETAIL_RE\.test\(/);
    expect(mainSrc).toMatch(/CREW_DETAIL_RE\.test\(/);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set.includes("/v1/predev")).toBe(false);
    expect(set.includes("/v1/crew")).toBe(false);
  });
  it("journey.js and journey-core.js never write: no .post, no window.uasco, no fetch/XHR/eval; they only use ctx.api reads", () => {
    for (const src of [read("views", "journey.js"), read("journey-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function/);
    }
    expect(read("views", "journey.js")).toMatch(/ctx\.api\.predev\(/);
    expect(read("views", "journey.js")).toMatch(/ctx\.api\.crew\(/);
  });
  it("api.predev/api.crew only request canonical mission ids; an invalid id makes NO request (ERROR)", async () => {
    const {ctx, calls} = await mkCtx(serve());
    for (const bad of ["", "bad", "msn_zz", "MSN_" + "ab".repeat(12), "msn_" + "ab".repeat(12) + "/x", "msn_" + "ab".repeat(12) + "?a=1", undefined as any, null as any]) {
      expect((await ctx.api.predev(bad)).state, String(bad)).toBe("ERROR");
      expect((await ctx.api.crew(bad)).state, String(bad)).toBe("ERROR");
    }
    expect(calls).toEqual([]);
    expect((await ctx.api.predev(MSN)).state).toBe("VERIFIED");
    expect(calls).toEqual([`/v1/predev/${MSN}`]);
  });
});

// ---------------- (3) pure mappers ----------------
describe("Project Journey — pure mappers are fail-closed and never elevate state", () => {
  it("mapPredev copies the five artifact states verbatim; approval comes from the recorded state only", async () => {
    const core = await load("journey-core.js");
    const body = predevBody({}, {Plan: preArt("REJECTED", {approved: true}), UxSpec: preArt("SUBMITTED")});
    const m = core.mapPredev(body);
    expect(m.state).toBe("VERIFIED");
    expect(m.predev.artifacts.map((a: any) => [a.kind, a.state, a.approved])).toEqual([["BusinessAnalysis", "APPROVED", true], ["Requirements", "APPROVED", true], ["Plan", "REJECTED", false], ["Architecture", "NOT_STARTED", false], ["UxSpec", "SUBMITTED", false]]);
    expect(m.predev.artifacts[0].evidenceCount).toBe(2);
  });
  it("any malformed predev field makes the whole read ERROR (no partial chain)", async () => {
    const core = await load("journey-core.js");
    const cases: any[] = [null, undefined, {}, {predev: null}, {predev: []}, predevBody({missionId: "bad"}), predevBody({active: "yes"}), predevBody({phase: "DONE"}), predevBody({phase: "pre_dev_complete"}),
      predevBody({artifacts: null}), predevBody({}, {Plan: preArt("PRODUCT_VERIFIED")}), predevBody({}, {Plan: null}), predevBody({}, {Plan: preArt("approved")})];
    for (const c of cases) expect(core.mapPredev(c).state, JSON.stringify(c)?.slice(0, 80)).toBe("ERROR");
    const missing = predevBody(); delete (missing.predev.artifacts as any).UxSpec;
    expect(core.mapPredev(missing).state).toBe("ERROR");
  });
  it("mapCrew accepts the contract shape and fails closed on one bad expert/event/run/delivery", async () => {
    const core = await load("journey-core.js");
    expect(core.mapCrew(crewBody()).state).toBe("VERIFIED");
    const withRun = crewBody({devReview: [run("run_aaaaaaaa", {finalVerdict: "REVIEW_CLEAN", versions: [ver(1, {reviewVerdict: "REVIEW_CLEAN"})], delivery: {sourceCommit: "d".repeat(40), treeSha: "e".repeat(40), exportArtifactHash: "f".repeat(64)}})]});
    const ok = core.mapCrew(withRun);
    expect(ok.state).toBe("VERIFIED");
    expect(ok.crew.runs[0].delivery.exportArtifactHash).toBe("f".repeat(64));
    const bads: any[] = [null, {}, {crew: {}}, {crew: {missionId: "x", coordination: {experts: []}, devReview: []}},
      crewBody({devReview: [run("run_aaaaaaaa", {finalVerdict: "PRODUCT_VERIFIED"})]}),
      crewBody({devReview: [run("bad id", {})]}),
      crewBody({devReview: [run("run_aaaaaaaa", {versions: [ver(1, {reviewVerdict: "CLEAN"})]})]}),
      crewBody({devReview: [run("run_aaaaaaaa", {versions: [ver(1, {sourceCommit: "xyz"})]})]}),
      crewBody({devReview: [run("run_aaaaaaaa", {delivery: {sourceCommit: "d".repeat(40), treeSha: "e".repeat(40), exportArtifactHash: "short"}})]}),
      crewBody({devReview: "none"})];
    for (const b of bads) expect(core.mapCrew(b).state, JSON.stringify(b)?.slice(0, 90)).toBe("ERROR");
    const badExpert = crewBody(); (badExpert.crew.coordination.experts[0] as any).assignmentState = "DONE";
    expect(core.mapCrew(badExpert).state).toBe("ERROR");
    const badEvent = crewBody(); (badEvent.crew.coordination.events[0] as any).type = "VERIFIED";
    expect(core.mapCrew(badEvent).state).toBe("ERROR");
  });
  it("downstreamOf is null without runs, and a delivery only ever means source delivered (never product verified)", async () => {
    const core = await load("journey-core.js");
    expect(core.downstreamOf([])).toBeNull();
    expect(core.downstreamOf(undefined)).toBeNull();
    const r = core.mapCrew(crewBody({devReview: [run("run_aaaaaaaa"), run("run_bbbbbbbb", {versions: [ver(1, {sourceCommit: null})], delivery: {sourceCommit: "d".repeat(40), treeSha: "e".repeat(40), exportArtifactHash: "f".repeat(64)}, finalVerdict: "REVIEW_CLEAN"})]})).crew.runs;
    const d = core.downstreamOf(r);
    expect(d).toEqual({runId: "run_bbbbbbbb", developed: false, finalVerdict: "REVIEW_CLEAN", sourceDelivered: true, runCount: 2});
    expect(Object.keys(d).join()).not.toMatch(/product|verified/i);
  });
});

// ---------------- (4) view honesty ----------------
describe("Project Journey — view honesty", () => {
  it("no mission selected: honest empty state, ONLY the mission list is read, no chain is drawn", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, calls, selection} = await mkCtx(serve());
    selection.missionId = null;
    const root = await journey.render(ctx);
    expect(calls).toEqual(["/v1/missions"]);
    expect(byData(root, "journey", "no-mission")).toBeTruthy();
    expect(root.textContent).toContain("No mission selected");
    expect(allData(root, "stage").length).toBe(0);
    expect(byId(root, "view-title")!.getAttribute("tabindex")).toBe("-1");
  });
  it("a selection that is not in the (readable) mission list is treated as no mission (shared selection is not rewritten)", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, calls, selection} = await mkCtx(serve());
    selection.missionId = "msn_" + "99".repeat(12);
    const root = await journey.render(ctx);
    expect(calls).toEqual(["/v1/missions"]);
    expect(byData(root, "journey", "no-mission")).toBeTruthy();
    expect(selection.missionId).toBe("msn_" + "99".repeat(12));
  });
  it("mission list failure shows an honest state (OFFLINE / UNAVAILABLE / ERROR); no data is fabricated", async () => {
    const journey = await load("views", "journey.js");
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx, selection} = await mkCtx(() => { throw new Error(thrown); });
      selection.missionId = null;
      const root = await journey.render(ctx);
      expect(byData(root, "journeyState", expected), expected).toBeTruthy();
      expect(allData(root, "stage").length).toBe(0);
    }
  });
  it("renders the autonomous chain: 5 pre-dev phases with real artifact states, current phase marked, downstream NOT_STARTED when there are no runs", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, calls, selection} = await mkCtx(serve());
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    expect(calls.slice().sort()).toEqual(["/v1/crew/" + MSN, "/v1/missions", "/v1/predev/" + MSN].sort());
    const rail = byData(root, "journeyRail")!;
    expect(rail.tagName).toBe("OL");
    expect(rail.getAttribute("aria-label")).toBeTruthy();
    const steps = allData(rail, "stage");
    expect(steps.map(s => s.dataset.stage)).toEqual(["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec", "develop", "review", "delivery"]);
    expect(steps.map(s => s.dataset.stepState)).toEqual(["APPROVED", "APPROVED", "DRAFT", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"]);
    // Numaralar sırayla (1..8) ve dekoratiftir (aria-hidden).
    expect(steps.map(s => all(s).find(n => cls(n, "journey-num"))!.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    // aria-current=step yalnız geçerli faz (PLANNING -> Plan) üzerindedir, hem şeritte hem listede.
    expect(all(rail).filter(n => n.getAttribute("aria-current") === "step").map(n => n.id)).toEqual(["journey-node-Plan"]);
    const list = all(root).find(n => n.tagName === "OL" && cls(n, "journey-phases"))!;
    expect(list.getAttribute("aria-label")).toBeTruthy();
    expect(all(list).filter(n => n.getAttribute("aria-current") === "step").map(n => n.dataset.kind)).toEqual(["Plan"]);
    expect(byData(root, "phase", "PLANNING")).toBeTruthy();
    const plan = allData(list, "kind").find(n => n.dataset.kind === "Plan" && n.tagName === "LI")!;
    expect(plan.dataset.artState).toBe("DRAFT");
    expect(plan.textContent).toContain("DRAFT");
    const ba = allData(list, "kind").find(n => n.dataset.kind === "BusinessAnalysis" && n.tagName === "LI")!;
    expect(ba.dataset.approved).toBe("1");
    expect(ba.textContent).toContain("UASCO-0022");
  });
  it("pre-dev not started: honest empty text, no phase items are drawn as progress", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, selection} = await mkCtx(serve({[`/v1/predev/${MSN}`]: inactivePredev(), [`/v1/crew/${MSN}`]: crewBody({preDevId: null, coordination: {missionId: MSN, preDevId: null, experts: [expert("UASCO-0022", "BusinessAnalysis", "ASSIGNED")], events: [], reworkRequests: []}})}));
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    expect(root.textContent).toContain("No pre-development yet");
    expect(allData(root, "artState").length).toBe(0);
    expect(byData(root, "note", "plan-only")).toBeTruthy();
    expect(allData(root, "event").length).toBe(0);
    expect(root.textContent).toContain("No coordination events recorded yet.");
    expect(all(byData(root, "journeyRail")!).filter(n => n.getAttribute("aria-current") === "step").length).toBe(0);
  });
  it("crew ledger shows per-expert role + state and the recorded events with the real rework reason", async () => {
    const journey = await load("views", "journey.js");
    const rework = evt("REWORK_REQUESTED", "Requirements", "UASCO-0023", 1, {reason: "Acceptance criteria are not testable", phase: "REQUIREMENTS"});
    const body = crewBody();
    body.crew.coordination.experts[1] = expert("UASCO-0023", "Requirements", "REWORK_REQUESTED", [evt("RECORDED", "Requirements", "UASCO-0023", 1), rework], {reworkCount: 1});
    body.crew.coordination.events = [...body.crew.coordination.events, evt("RECORDED", "Requirements", "UASCO-0023", 1), rework];
    const {ctx, selection} = await mkCtx(serve({[`/v1/crew/${MSN}`]: body}));
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    const experts = allData(root, "role").filter(n => n.tagName === "LI");
    expect(experts.map(n => [n.dataset.role, n.dataset.assignment])).toEqual([["UASCO-0022", "APPROVED"], ["UASCO-0023", "REWORK_REQUESTED"]]);
    const reworkItem = allData(root, "event", "REWORK_REQUESTED")[0];
    expect(reworkItem.textContent).toContain("Acceptance criteria are not testable");
    expect(reworkItem.textContent).toContain("UASCO-0023");
    const events = all(root).find(n => cls(n, "journey-events"))!;
    expect(events.tagName).toBe("OL");
    expect(events.getAttribute("aria-label")).toBeTruthy();
    expect(all(events).filter(n => n.tagName === "TIME").length).toBe(5);
    expect(all(events).filter(n => n.tagName === "TIME").every(n => !!n.getAttribute("datetime"))).toBe(true);
  });
  it("dev -> review -> delivery: real versions, verdicts and a source-only delivery (NOT_VERIFIED); PRODUCT_VERIFIED is never shown", async () => {
    const journey = await load("views", "journey.js");
    const body = crewBody({devReview: [
      run("run_aaaaaaaa", {versions: [ver(1, {reviewVerdict: "REWORK_REQUESTED", reviewReason: "missing input validation"}), ver(2, {reviewVerdict: "REVIEW_CLEAN"})], finalVerdict: "REVIEW_CLEAN",
        delivery: {sourceCommit: "d".repeat(40), treeSha: "e".repeat(40), exportArtifactHash: "f".repeat(64)}}),
      run("run_bbbbbbbb", {versions: [ver(1, {sourceCommit: null})], finalVerdict: "NONE"})]});
    const {ctx, selection} = await mkCtx(serve({[`/v1/crew/${MSN}`]: body}));
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    const runs = allData(root, "run");
    expect(runs.map(r => r.dataset.run)).toEqual(["run_aaaaaaaa", "run_bbbbbbbb"]);
    const a = runs[0];
    expect(a.dataset.finalVerdict).toBe("REVIEW_CLEAN");
    expect(allData(a, "cycle").map(n => [n.dataset.cycle, n.dataset.verdict])).toEqual([["1", "REWORK_REQUESTED"], ["2", "REVIEW_CLEAN"]]);
    expect(a.textContent).toContain("missing input validation");
    expect(a.textContent).toContain("UASCO-0100");
    expect(a.textContent).toContain("UASCO-0200");
    const del = byData(a, "delivery", "source-only")!;
    expect(del).toBeTruthy();
    expect(del.textContent).toContain("f".repeat(64));
    expect(pills(del)).toContain("NOT_VERIFIED");
    expect(del.textContent).toContain("NOT verified");
    expect(byData(runs[1], "delivery", "none")).toBeTruthy();
    // Şerit: son listelenen koşu (run_bbbbbbbb) -> geliştirme/inceleme/teslim kaydı yok -> hepsi NOT_STARTED, koşu kimliği açıkça yazılır.
    const steps = allData(byData(root, "journeyRail")!, "stage");
    expect(steps.slice(5).map(s => s.dataset.stepState)).toEqual(["NOT_STARTED", "NOT_STARTED", "NOT_STARTED"]);
    expect(byData(root, "note", "latest-run")!.textContent).toContain("run_bbbbbbbb");
    expect(byData(root, "note", "latest-run")!.textContent).toContain("2 run(s)");
    // Hiçbir yerde PRODUCT_VERIFIED rozeti/sınıfı yok.
    expect(pills(root)).not.toContain("PRODUCT_VERIFIED");
    expect(surface(root)).not.toMatch(/spill-product_verified|data-pill=PRODUCT_VERIFIED/);
  });
  it("rail downstream nodes follow the latest run's recorded verdict and delivery (source only), never an invented one", async () => {
    const journey = await load("views", "journey.js");
    const mk = async (r: any) => { const {ctx, selection} = await mkCtx(serve({[`/v1/crew/${MSN}`]: crewBody({devReview: [r]})})); selection.missionId = MSN; const root = await journey.render(ctx); return allData(byData(root, "journeyRail")!, "stage").slice(5).map(s => s.dataset.stepState); };
    expect(await mk(run("run_aaaaaaaa", {finalVerdict: "REVIEW_CLEAN", versions: [ver(1, {reviewVerdict: "REVIEW_CLEAN"})], delivery: {sourceCommit: "d".repeat(40), treeSha: "e".repeat(40), exportArtifactHash: "f".repeat(64)}}))).toEqual(["SOURCE_RECORDED", "REVIEW_CLEAN", "SOURCE_ONLY"]);
    expect(await mk(run("run_aaaaaaaa", {finalVerdict: "REWORK_REQUESTED", versions: [ver(1, {reviewVerdict: "REWORK_REQUESTED", reviewReason: "x"})]}))).toEqual(["SOURCE_RECORDED", "REWORK_REQUESTED", "NOT_STARTED"]);
    expect(await mk(run("run_aaaaaaaa", {finalVerdict: "REVIEW_REWORK_LIMIT_EXCEEDED", versions: [ver(1, {reviewVerdict: "REWORK_REQUESTED"})]}))).toEqual(["SOURCE_RECORDED", "REVIEW_REWORK_LIMIT_EXCEEDED", "NOT_STARTED"]);
  });
  it("predev/crew read failures render honest per-panel states; the other panel is unaffected; nothing is guessed", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, selection} = await mkCtx(p => (p === "/v1/missions" ? MISSIONS : p === `/v1/predev/${MSN}` ? fail(p, 404) : (() => { throw new Error("fetch failed"); })()));
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    const states = allData(root, "journeyState").map(n => n.dataset.journeyState);
    expect(states).toEqual(["UNAVAILABLE", "OFFLINE", "OFFLINE"]);
    expect(allData(root, "artState").length).toBe(0);
    expect(allData(root, "run").length).toBe(0);
    const steps = allData(byData(root, "journeyRail")!, "stage");
    expect(steps.map(s => s.dataset.stepState)).toEqual(["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE", "OFFLINE", "OFFLINE", "OFFLINE"]);
  });
  it("a malformed predev/crew response is an honest ERROR, not a partial chain", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, selection} = await mkCtx(serve({[`/v1/predev/${MSN}`]: {predev: {missionId: MSN, active: true, phase: "PLANNING", artifacts: {}}}, [`/v1/crew/${MSN}`]: {crew: {}}}));
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    expect(allData(root, "journeyState").map(n => n.dataset.journeyState)).toEqual(["ERROR", "ERROR", "ERROR"]);
    expect(allData(root, "artState").length).toBe(0);
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const journey = await load("views", "journey.js");
    const body = crewBody({devReview: [run("run_aaaaaaaa", {versions: [ver(1, {reviewVerdict: "REWORK_REQUESTED", reviewReason: "<img src=x onerror=alert(1)>"})], finalVerdict: "REWORK_REQUESTED"})]});
    const {ctx, selection} = await mkCtx(serve({[`/v1/crew/${MSN}`]: body, "/v1/missions": {missions: [{...MISSIONS.missions[0], title: "<b>x</b>"}, MISSIONS.missions[1]]}}));
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    expect(all(root).some(n => n.tagName === "IMG" || n.tagName === "B")).toBe(false);
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
  it("renders with no raw i18n keys in both TR and EN across every scenario", async () => {
    const journey = await load("views", "journey.js");
    const body = crewBody({devReview: [run("run_aaaaaaaa", {versions: [ver(1, {reviewVerdict: "REVIEW_CLEAN"}), ver(2, {sourceCommit: null})], finalVerdict: "REVIEW_CLEAN", delivery: {sourceCommit: "d".repeat(40), treeSha: "e".repeat(40), exportArtifactHash: "f".repeat(64)}})]});
    const scenarios: Array<[string, (p: string) => any, string | null]> = [
      ["none", serve(), null], ["full", serve({[`/v1/crew/${MSN}`]: body}), MSN], ["inactive", serve({[`/v1/predev/${MSN}`]: inactivePredev()}), MSN],
      ["offline", () => { throw new Error("fetch failed"); }, MSN], ["empty-missions", serve({"/v1/missions": {missions: []}}), null]];
    for (const lang of ["en", "tr"]) for (const [name, fn, sel] of scenarios) {
      const {ctx, selection} = await mkCtx(fn, lang);
      selection.missionId = sel;
      const root = await journey.render(ctx);
      expect(root.textContent, `${lang}/${name}`).not.toMatch(/\b(journey|area)\.[A-Za-z]+(\.[A-Za-z_]+)*\b/);
    }
  });
});

// ---------------- mission selector ----------------
describe("Project Journey — mission selector (keyboard-accessible, reuses the shared selection)", () => {
  it("is a labelled <select> listing the real missions; choosing one updates the shared selection and re-renders", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, selection, rerenders} = await mkCtx(serve());
    selection.missionId = null;
    const root = await journey.render(ctx);
    const select = byId(root, "journey-mission")!;
    expect(select.tagName).toBe("SELECT");
    const label = all(root).find(n => n.tagName === "LABEL" && n.getAttribute("for") === "journey-mission");
    expect(label).toBeTruthy();
    expect(select.getAttribute("aria-describedby")).toBe("journey-mission-hint");
    const opts = all(select).filter(n => n.tagName === "OPTION");
    expect(opts.map(o => o.getAttribute("value"))).toEqual(["", MSN, MSN2]);
    expect(opts[1].textContent).toContain("Alpha mission");
    fire(select, "change", {target: {value: MSN2}});
    await new Promise(r => setTimeout(r, 0));
    expect(selection.missionId).toBe(MSN2);
    expect(rerenders()).toBe(1);
    // Geçersiz değer seçimi temizler (kimlik doğrulanır).
    fire(select, "change", {target: {value: "not-a-mission"}});
    await new Promise(r => setTimeout(r, 0));
    expect(selection.missionId).toBeNull();
  });
  it("an empty mission list is an honest empty state, with no selector", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, selection} = await mkCtx(serve({"/v1/missions": {missions: []}}));
    selection.missionId = null;
    const root = await journey.render(ctx);
    expect(byId(root, "journey-mission")).toBeUndefined();
    expect(root.textContent).toContain("No missions yet");
  });
});

// ---------------- (5) accessibility ----------------
describe("Project Journey — accessibility", () => {
  it("rail nodes are real buttons (keyboard activation), each with a state pill containing text; activating one focuses its detail panel", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, doc, selection} = await mkCtx(serve());
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    doc.body.append(root);
    const rail = byData(root, "journeyRail")!;
    const buttons = all(rail).filter(n => n.tagName === "BUTTON");
    expect(buttons.length).toBe(8);
    for (const b of buttons) {
      expect(b.getAttribute("type")).toBe("button");
      expect(b.textContent.length).toBeGreaterThan(3);
      expect(all(b).some(n => "pill" in n.dataset)).toBe(true);
    }
    fire(buttons[0], "click");
    expect(byId(root, "journey-predev")!.focused).toBe(true);
    fire(buttons[7], "click");
    expect(byId(root, "journey-dev")!.focused).toBe(true);
    for (const id of ["journey-predev", "journey-crew", "journey-dev"]) expect(byId(root, id)!.getAttribute("tabindex")).toBe("-1");
  });
  it("sections are labelled regions; states are never conveyed by colour alone (pill text + icon)", async () => {
    const journey = await load("views", "journey.js");
    const {ctx, selection} = await mkCtx(serve());
    selection.missionId = MSN;
    const root = await journey.render(ctx);
    for (const id of ["journey-selector", "journey-chain", "journey-predev", "journey-crew", "journey-dev"]) {
      const sec = byId(root, id)!;
      expect(sec.tagName, id).toBe("SECTION");
      expect(byId(root, sec.getAttribute("aria-labelledby")!), id).toBeTruthy();
    }
    for (const p of allData(root, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    // Tek h1 (görünüm başlığı).
    expect(all(root).filter(n => n.tagName === "H1").length).toBe(1);
  });
  it("styles.css has reduced-motion + forced-colors coverage for the journey components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("Proje Yolculuğu: otonom zincir");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.journey-node[^@]*Highlight/);
    expect(mine).toMatch(/\.journey-node\[aria-current="step"\]/);
    expect(mine).toMatch(/\.journey-node:focus-visible/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    // Global reduced-motion kuralı tüm animasyon/geçişleri kapatır ve hâlâ yerindedir.
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (6) locale parity ----------------
describe("Project Journey — locale parity and key coverage", () => {
  it("every journey.* / area.journey.* key is identical and non-empty in TR and EN, with identical placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("journey.") || k === "area.journey.title" || k === "area.journey.desc").sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(80);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.journey.title"]).toBe("Proje Yolculuğu");
  });
  it("every literal and enumerated key used by journey.js exists in the dictionary", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const core = await load("journey-core.js");
    const src = read("views", "journey.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:ctx\.t\(|labelKey:|titleKey:|emptyNote\(ctx,)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"(journey\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.PREDEV_KINDS) need.add(`journey.kind.${k}`);
    for (const k of core.ARTIFACT_STATES) need.add(`journey.artState.${k}`);
    for (const k of core.PREDEV_PHASES) need.add(`journey.phase.${k}`);
    need.add("journey.phase.NOT_STARTED");
    for (const k of core.LEDGER_EVENT_TYPES) need.add(`journey.event.${k}`);
    for (const k of core.FINAL_VERDICTS) need.add(`journey.verdict.${k}`);
    for (const k of ["OFFLINE", "UNAVAILABLE", "ERROR"]) { need.add(`journey.state.${k}`); need.add(`journey.hint.${k}`); }
    const missing = [...need].filter(k => !(k in en));
    expect(missing).toEqual([]);
    expect(need.size).toBeGreaterThan(40);
  });
});

// ---------------- (7) routing ----------------
describe("Project Journey — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/journey to the planned host with component 'journey' (no plannedPackage), after academy and before executive", async () => {
    const routes = await load("routes.js");
    const r = routes.routeById("journey");
    expect(r).toMatchObject({id: "journey", hash: "#/journey", view: "planned", component: "journey", factory: false});
    expect(r.plannedPackage).toBeUndefined();
    expect(routes.routeFromHash("#/journey")).toBe("journey");
    expect(routes.ROUTES.map((x: any) => x.id).slice(-15)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "install", "audit", "domains", "integrations", "scheduler", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("journey");
  });
  it("planned.js delegates the 'journey' component to the real view; app.js VIEWS table has no journey entry", async () => {
    expect(read("views", "planned.js")).toContain('import * as journey from "./journey.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*journey[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toMatch(/journey/i);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    const planned = await load("views", "planned.js");
    const {ctx, selection} = await mkCtx(serve());
    selection.missionId = null;
    const root = await planned.render(ctx, {id: "journey", component: "journey"});
    expect(cls(root, "view-journey")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Project Journey");
  });
});

// //TR: LANE-A Pre-dev Founder kararları: istek kurucuları, yanıt sınıflayıcı ve Yolculuk'taki karar paneli. Kararlar yalnız sunucu sözleşmesi şekilli yanıtlarla (Lane B #194: 201/200 {predev,replayed}, 409 PREDEV_GATE_REFUSED {reason}) sınanır; kapılar sunucudadır ve burada yeniden uygulanmaz.
const PDA = "pda_" + "aa".repeat(12), PDA2 = "pda_" + "bb".repeat(12);
const POST_START = `/v1/missions/${MSN}/predev/start`, POST_APPROVE = `/v1/missions/${MSN}/predev/artifacts/${PDA}/approve`, POST_REJECT = `/v1/missions/${MSN}/predev/artifacts/${PDA}/reject`;
const PD_ALLOW = /^\/v1\/missions\/msn_[0-9a-f]{24}\/predev\/(start|artifacts\/pda_[0-9a-f]{24}\/(approve|reject))$/;
const OK = (body: any, status = 200) => ({status, body});
const refuse = (reason: any, status = 409, error = "PREDEV_GATE_REFUSED") => ({status, body: reason === undefined ? {error} : {error, reason}});
async function mkDecisionCtx(getFn: (p: string) => any, postFn: (p: string, b: unknown) => any, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js"), dec = await load("views", "predev-decisions.js");
  const doc = new D(), store = st.createStore(null), posts: Array<{path: string; body: any}> = [];
  const bridge = {apiGet: async (p: string) => getFn(p), apiPost: async (p: string, b: unknown) => { posts.push({path: p, body: b}); return postFn(p, b); }};
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  let rerenders = 0;
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, rerender: async () => { rerenders += 1; }, settleFocus: () => {}};
  dec.resetPredevDraft(null, null); for (const f of ["predev-start", "predev-approve", "predev-reject"]) { delete forms.drafts.status[f]; forms.drafts.busy[f] = false; }
  forms.selection.missionId = MSN;
  return {ctx, posts, dec, forms, rerenders: () => rerenders};
}
const renderJourney = async (ctx: any) => (await load("views", "journey.js")).render(ctx) as Promise<N>;
const DRAFT_PREDEV = () => predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("DRAFT"), Requirements: preArt("NOT_STARTED"), Plan: preArt("NOT_STARTED")});
const setVal = (root: N, id: string, v: string) => { const n = byId(root, id)!; (n as any).value = v; fire(n, "input"); };
const status = (root: N, formId: string) => byId(root, `${formId}-status`)!;

describe("LANE-A pre-dev decisions — pure core", () => {
  it("builds only the canonical POST paths (nothing else is ever requested)", async () => {
    const core = await load("predev-decisions-core.js");
    expect(core.predevStartPath(MSN)).toBe(POST_START);
    expect(core.predevDecisionPath(MSN, PDA, "approve")).toBe(POST_APPROVE);
    expect(core.predevDecisionPath(MSN, PDA, "reject")).toBe(POST_REJECT);
    for (const p of [core.predevStartPath(MSN), core.predevDecisionPath(MSN, PDA, "approve"), core.predevDecisionPath(MSN, PDA, "reject")]) expect(p).toMatch(PD_ALLOW);
    for (const bad of ["", "bad", "msn_zz", MSN + "/x", MSN + "?a=1", "MSN_" + "ab".repeat(12), undefined, null, 5]) { expect(core.predevStartPath(bad), String(bad)).toBeNull(); expect(core.predevDecisionPath(bad, PDA, "approve"), String(bad)).toBeNull(); }
    for (const bad of ["", "pda_zz", PDA + "/x", PDA + "?a=1", "PDA_" + "aa".repeat(12), "pda_" + "aa".repeat(11), "pda_" + "a".repeat(23), "pda_" + "a".repeat(25), undefined, null]) expect(core.predevDecisionPath(MSN, bad, "approve"), String(bad)).toBeNull();
    for (const verb of ["delete", "", "APPROVE", "approve/", undefined]) expect(core.predevDecisionPath(MSN, PDA, verb), String(verb)).toBeNull();
  });
  it("parses evidence references by the server's schema: 1..20, unique, [A-Za-z0-9._:-]{1,128}; separators are spaces, commas and new lines", async () => {
    const core = await load("predev-decisions-core.js");
    expect(core.parseEvidenceRefs("evd_a, evd_b\nevd_c  evd.d:1-2")).toEqual({refs: ["evd_a", "evd_b", "evd_c", "evd.d:1-2"], error: null});
    expect(core.parseEvidenceRefs("x".repeat(128))).toEqual({refs: ["x".repeat(128)], error: null});
    expect(core.parseEvidenceRefs(Array.from({length: 20}, (_, i) => "e" + i).join(" ")).refs).toHaveLength(20);
    const err = (t: any) => core.parseEvidenceRefs(t);
    for (const t of ["", "  ,\n ", undefined, null, 5]) expect(err(t), String(t)).toEqual({refs: [], error: "predev.err.evidenceRequired"});
    for (const t of ["bad/ref", "ünï", "a;b", "x".repeat(129), "ok bad!"]) expect(err(t), t).toEqual({refs: [], error: "predev.err.evidenceFormat"});
    expect(err("a b a")).toEqual({refs: [], error: "predev.err.evidenceDuplicate"});
    expect(err(Array.from({length: 21}, (_, i) => "e" + i).join(" "))).toEqual({refs: [], error: "predev.err.evidenceMany"});
    expect([core.MAX_EVIDENCE_REFS, core.REJECT_REASON_MAX]).toEqual([20, 1000]);
  });
  it("builds exact request bodies; invalid input yields errors and NO path or body", async () => {
    const core = await load("predev-decisions-core.js");
    expect(core.buildStartRequest({missionId: MSN})).toEqual({ok: true, path: POST_START, body: {}, errors: {}});
    expect(core.buildStartRequest({missionId: "bad"})).toEqual({ok: false, path: null, body: null, errors: {mission: "predev.err.mission"}});
    expect(core.buildApproveRequest({missionId: MSN, artifactId: PDA, evidenceText: "evd_1 evd_2"})).toEqual({ok: true, path: POST_APPROVE, body: {evidenceRefs: ["evd_1", "evd_2"]}, errors: {}});
    expect(core.buildApproveRequest({missionId: MSN, artifactId: "x", evidenceText: ""})).toEqual({ok: false, path: null, body: null, errors: {artifact: "predev.err.artifact", evidenceRefs: "predev.err.evidenceRequired"}});
    expect(core.buildRejectRequest({missionId: MSN, artifactId: PDA, reason: "  scope too vague \n"})).toEqual({ok: true, path: POST_REJECT, body: {reason: "scope too vague"}, errors: {}});
    expect(core.buildRejectRequest({missionId: MSN, artifactId: PDA, reason: "x".repeat(1000)}).ok).toBe(true);
    expect(core.buildRejectRequest({missionId: MSN, artifactId: PDA, reason: "x".repeat(1001)}).errors).toEqual({reason: "predev.err.reasonLong"});
    for (const r of ["", "   \n", undefined, null, 5]) expect(core.buildRejectRequest({missionId: MSN, artifactId: PDA, reason: r}).errors, String(r)).toEqual({reason: "err.reasonRequired"});
    expect(core.buildRejectRequest({missionId: "bad", artifactId: "bad", reason: "x"}).errors).toEqual({artifact: "predev.err.artifact"});
  });
  it("classifies POST answers: a result only from a strictly mapped body of the SAME mission; the server's PREDEV_* reason is carried verbatim; nothing is invented", async () => {
    const core = await load("predev-decisions-core.js");
    const cls = (res: any) => core.classifyPredevPost(res, MSN);
    const good = predevBody();
    expect(cls(OK(good))).toMatchObject({kind: "RESULT", replayed: false}); expect(cls(OK(good)).predev.phase).toBe("PLANNING");
    expect(cls(OK({...good, replayed: true}, 200))).toMatchObject({kind: "RESULT", replayed: true});
    expect(cls(OK({...good, replayed: false}, 201))).toMatchObject({kind: "RESULT", replayed: false});
    for (const bad of [{...good, replayed: "yes"}, {predev: {...good.predev, missionId: MSN2}}, {predev: {...good.predev, phase: "NOPE"}}, {}, null, "ok", [], {predev: null}]) expect(cls(OK(bad)), JSON.stringify(bad)?.slice(0, 60)).toEqual({kind: "INVALID"});
    for (const r of core.PREDEV_REFUSAL_REASONS) expect(cls(refuse(r)), r).toEqual({kind: "REFUSED", reason: r, known: true});
    expect(cls(refuse("PREDEV_SOMETHING_NEW"))).toEqual({kind: "REFUSED", reason: "PREDEV_SOMETHING_NEW", known: false});
    for (const r of [undefined, null, 5, "", "predev_lower", "PREDEV_", "SECRET " + "x", "PREDEV_" + "A".repeat(81), "<b>PREDEV_X</b>", ["PREDEV_X"]]) expect(cls(refuse(r)), String(r)).toEqual({kind: "REFUSED", reason: null, known: false});
    expect(cls(refuse(undefined, 409, "PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE"))).toEqual({kind: "REFUSED", reason: "PREDEV_DRIVER_SEQUENCE_NOT_ACTIVE", known: true});
    expect(cls(refuse(undefined, 404, "PREDEV_DRIVER_ARTIFACT_NOT_FOUND"))).toEqual({kind: "REFUSED", reason: "PREDEV_DRIVER_ARTIFACT_NOT_FOUND", known: true});
    expect(cls(refuse(undefined, 404, "WORKOS_NOT_FOUND"))).toEqual({kind: "NOT_FOUND"});
    expect(cls({status: 404, body: {}})).toEqual({kind: "NOT_ENABLED"});
    expect(cls({status: 501, body: {}})).toEqual({kind: "NOT_ENABLED"});
    expect(cls({status: 403, body: {error: "FORBIDDEN"}})).toEqual({kind: "FAILED"}); // a token/auth 403 is an auth error, never "the desktop shell does not allow it"
    expect(cls({thrown: true, state: "ERROR", message: "INVALID_API_PATH"})).toEqual({kind: "NOT_ENABLED"});
    for (const res of [null, undefined, {thrown: true, state: "OFFLINE", message: "fetch failed"}, {status: 403, body: {error: "ACTION_DENIED", reason: "NO"}}, {status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}, {status: 400, body: {error: "INVALID_BODY"}}, {status: 500, body: {}}, {status: 409, body: {error: "OTHER"}}]) expect(cls(res), JSON.stringify(res)).toEqual({kind: "FAILED"});
  });
  it("maps every classification to a localized status key that exists in EN and TR (placeholders identical); the server's code is passed through as data", async () => {
    const core = await load("predev-decisions-core.js");
    const en = (await load("locales", "en.js")).default as Record<string, string>, tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const keys = new Set<string>();
    const phase = predevBody().predev;
    const cases: Array<[any, any, string]> = [[{kind: "RESULT", predev: phase, replayed: false}, null, "start"], [{kind: "RESULT", predev: phase, replayed: true}, null, "start"], [{kind: "RESULT", predev: phase}, null, "approve"], [{kind: "RESULT", predev: phase}, null, "reject"],
      [{kind: "REFUSED", reason: null, known: false}, null, "approve"], [{kind: "REFUSED", reason: "PREDEV_X", known: false}, null, "approve"], [{kind: "NOT_FOUND"}, null, "approve"], [{kind: "NOT_ENABLED"}, null, "start"], [{kind: "INVALID"}, null, "start"], [{kind: "FAILED"}, {status: 423, body: {}}, "start"]];
    for (const r of core.PREDEV_REFUSAL_REASONS) cases.push([{kind: "REFUSED", reason: r, known: true}, null, "approve"]);
    for (const [c, res, verb] of cases) { const k = core.predevStatusKey(c, res, verb); keys.add(k.key); expect(k.ok, k.key).toBe(c.kind === "RESULT"); expect(en[k.key], k.key).toBeTruthy(); expect(tr[k.key], k.key).toBeTruthy(); expect((tr[k.key].match(/\{\w+\}/g) ?? []).sort().join(), k.key).toBe((en[k.key].match(/\{\w+\}/g) ?? []).sort().join()); }
    // LOW (review #226): a token/auth 403 is shown as an auth error, not as "the desktop shell does not allow it"
    expect(core.predevStatusKey(core.classifyPredevPost({status: 403, body: {error: "FORBIDDEN"}}, MSN), {status: 403, body: {error: "FORBIDDEN"}}, "start")).toMatchObject({ok: false, key: "post.err.auth"});
    expect(core.predevStatusKey({kind: "REFUSED", reason: "PREDEV_X", known: false}, null, "approve")).toEqual({ok: false, key: "predev.refused.unrecognised", vars: {reason: "PREDEV_X"}});
    expect(core.predevStatusKey({kind: "RESULT", predev: phase, replayed: true}, null, "start")).toEqual({ok: true, key: "predev.started.replayed", vars: {phase: "PLANNING"}});
    // Her bilinen ret nedeni kendi kodunu metinde AYNEN taşır.
    for (const r of core.PREDEV_REFUSAL_REASONS) { expect(en[`predev.refused.${r}`], r).toContain(`(${r})`); expect(tr[`predev.refused.${r}`], r).toContain(`(${r})`); }
    expect(keys.size).toBeGreaterThan(20);
  });
});

describe("LANE-A pre-dev decisions — view (Journey)", () => {
  it("not started: only a Start control; it POSTs {} to the canonical path and reports the server's phase; the mission list and predev are re-read afterwards", async () => {
    const {ctx, posts, dec, rerenders} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: inactivePredev()}), () => OK(predevBody({phase: "BUSINESS_ANALYSIS"}), 201));
    const root = await renderJourney(ctx);
    expect(byData(root, "decision", "start")!.textContent).toContain("No pre-dev sequence exists");
    expect(allData(root, "decision", "pending").length).toBe(0);
    expect(byId(root, "predev-approve-submit")).toBeUndefined();
    const btn = byId(root, "predev-start-submit")!;
    fire(btn, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toEqual([{path: POST_START, body: {}}]);
    expect(rerenders()).toBe(2); // one repaint when the lock is set (before the POST), one with the answer
    const st = status(await renderJourney(ctx), "predev-start");
    expect(st.dataset.result).toBe("ok"); expect(st.textContent).toBe("Pre-dev sequence started. The server reports the phase: BUSINESS_ANALYSIS.");
    void dec;
  });
  it("start: a replay, a refusal (verbatim code), not-enabled, a server error and a malformed 2xx are each reported as such — never as success", async () => {
    const run = async (answer: any) => {
      const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: inactivePredev()}), () => (answer instanceof Error ? (() => { throw answer; })() : answer));
      const root = await renderJourney(ctx); fire(byId(root, "predev-start-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
      const st = status(await renderJourney(ctx), "predev-start"); return {st, posts};
    };
    const rep = await run(OK({...predevBody(), replayed: true}, 200)); expect(rep.st.dataset.result).toBe("ok"); expect(rep.st.textContent).toContain("already existed");
    const ref = await run(refuse("PREDEV_SEQUENCE_EXISTS_FOR_MISSION")); expect(ref.st.dataset.result).toBe("error"); expect(ref.st.textContent).toContain("(PREDEV_SEQUENCE_EXISTS_FOR_MISSION)");
    const none = await run(Object.assign(new Error("INVALID_API_PATH"), {})); expect(none.st.dataset.result).toBe("error"); expect(none.st.textContent).toContain("not enabled in this build");
    const stop = await run({status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}); expect(stop.st.dataset.result).toBe("error"); expect(stop.st.textContent.length).toBeGreaterThan(10);
    const bad = await run(OK({predev: {missionId: MSN, active: true}}, 201)); expect(bad.st.dataset.result).toBe("error"); expect(bad.st.textContent).toContain("could not be read");
    const other = await run(OK(predevBody({missionId: MSN2}), 201)); expect(other.st.dataset.result).toBe("error");
  });
  it("a DRAFT awaiting a decision shows its facts, the server-gates note and both forms; nothing is posted until the Founder acts", async () => {
    const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), () => { throw new Error("must not post"); });
    const root = await renderJourney(ctx);
    const panel = byId(root, "predev-decisions")!;
    expect(panel.dataset.predevDecisions).toBe(MSN);
    expect(byData(panel, "decision", "pending")!.dataset.artifact).toBe(PDA);
    expect(byData(panel, "decision", "pending")!.textContent).toBe("A Business analysis draft is waiting for your decision.");
    expect(byData(panel, "note", "server-gates")!.textContent).toContain("independent of the author");
    expect(allData(panel, "decision", "start").length).toBe(0);
    for (const id of ["predev-evidence", "predev-reason", "predev-approve-submit", "predev-reject-submit"]) expect(byId(panel, id), id).toBeTruthy();
    expect(byId(panel, "predev-evidence")!.tagName).toBe("TEXTAREA");
    expect(posts).toEqual([]);
  });
  it("approve: empty/invalid evidence is a validation error and sends NOTHING; valid evidence POSTs exactly {evidenceRefs}; success re-reads and says what the server reports", async () => {
    let answer: any = OK(predevBody({phase: "REQUIREMENTS"}));
    const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), () => answer);
    let root = await renderJourney(ctx);
    fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toEqual([]);
    root = await renderJourney(ctx);
    expect(status(root, "predev-approve").dataset.result).toBe("invalid");
    expect(status(root, "predev-approve").textContent).toContain("At least one evidence reference is required.");
    setVal(root, "predev-evidence", "bad/ref"); fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toEqual([]);
    root = await renderJourney(ctx);
    expect(status(root, "predev-approve").textContent).toContain("not allowed");
    setVal(root, "predev-evidence", "evd_taskhub_ba_signed, evd_2"); fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toEqual([{path: POST_APPROVE, body: {evidenceRefs: ["evd_taskhub_ba_signed", "evd_2"]}}]);
    root = await renderJourney(ctx);
    expect(status(root, "predev-approve").dataset.result).toBe("ok");
    expect(status(root, "predev-approve").textContent).toBe("Approved. The server advanced the sequence; phase: REQUIREMENTS.");
  });
  it("approve refused by the server: the code is shown verbatim (known, unrecognised and missing reasons), the draft stays decidable and the entered evidence is kept", async () => {
    const evil = "PREDEV_X";
    for (const [answer, expected] of [
      [refuse("PREDEV_APPROVER_NOT_INDEPENDENT"), "Refused (PREDEV_APPROVER_NOT_INDEPENDENT): the approver must be independent of whoever recorded the draft."],
      [refuse("PREDEV_APPROVAL_EVIDENCE_REQUIRED"), "Refused (PREDEV_APPROVAL_EVIDENCE_REQUIRED): approval needs evidence."],
      [refuse(evil), "The server refused this decision: PREDEV_X. This reason is not one this screen knows, so it is shown as returned."],
      [refuse("<img src=x onerror=1>"), "The server refused this decision and gave no reason."],
      [refuse(undefined), "The server refused this decision and gave no reason."]] as Array<[any, string]>) {
      const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), () => answer);
      let root = await renderJourney(ctx);
      setVal(root, "predev-evidence", "evd_1"); fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
      expect(posts).toHaveLength(1);
      root = await renderJourney(ctx);
      const st = status(root, "predev-approve");
      expect(st.dataset.result).toBe("error"); expect(st.textContent).toBe(expected);
      expect(byData(root, "decision", "pending")).toBeTruthy(); // taslak hâlâ karar bekliyor
      expect((byId(root, "predev-evidence") as any).value).toBe("evd_1");
      expect(all(root).some(n => n.tagName === "IMG")).toBe(false);
    }
  });
  it("reject: a blank reason is a validation error and sends nothing; a reason POSTs exactly {reason}; the phase text says it does not advance", async () => {
    const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), () => OK(predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("REJECTED")})));
    let root = await renderJourney(ctx);
    setVal(root, "predev-reason", "   "); fire(byId(root, "predev-reject-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toEqual([]);
    root = await renderJourney(ctx);
    expect(status(root, "predev-reject").textContent).toContain("A reason is required");
    setVal(root, "predev-reason", "  scope too vague "); fire(byId(root, "predev-reject-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toEqual([{path: POST_REJECT, body: {reason: "scope too vague"}}]);
    root = await renderJourney(ctx);
    expect(status(root, "predev-reject").textContent).toBe("Rejected. The phase does not advance; phase: BUSINESS_ANALYSIS.");
    setVal(root, "predev-reason", "x".repeat(1001)); fire(byId(root, "predev-reject-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts).toHaveLength(1);
  });
  it("there is NO decision control unless a DRAFT/SUBMITTED artifact with a canonical id awaits one: rejected, approved, not-started, unreadable id, completed sequence", async () => {
    const cases: Array<[string, any, string]> = [
      ["rejected", predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("REJECTED")}), "rejected"],
      ["approved", predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("APPROVED")}), "approved"],
      ["not started", predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("NOT_STARTED")}), "noDraft"],
      ["unreadable id", predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("DRAFT", {artifactId: "art-1"})}), "unreadable"],
      ["authorized (no artifact phase)", predevBody({phase: "AUTHORIZED"}), "phase"]];
    for (const [label, body, why] of cases) {
      const {ctx} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: body}), () => { throw new Error("must not post"); });
      const root = await renderJourney(ctx);
      expect(byData(root, "decision", "none")!.dataset.why, label).toBe(why);
      for (const id of ["predev-evidence", "predev-reason", "predev-approve-submit", "predev-reject-submit", "predev-start-submit"]) expect(byId(root, id), `${label}/${id}`).toBeUndefined();
    }
    const {ctx} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: predevBody({phase: "PRE_DEV_COMPLETE"}, {BusinessAnalysis: preArt("APPROVED"), Requirements: preArt("APPROVED"), Plan: preArt("APPROVED"), Architecture: preArt("APPROVED"), UxSpec: preArt("APPROVED")})}), () => { throw new Error("must not post"); });
    const root = await renderJourney(ctx);
    expect(byData(root, "decision", "complete")!.textContent).toContain("complete");
    expect(byId(root, "predev-approve-submit")).toBeUndefined();
  });
  it("SUBMITTED artifacts are decidable too; the decision always targets the CURRENT phase's artifact id", async () => {
    const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: predevBody({phase: "PLANNING"}, {Plan: preArt("SUBMITTED", {artifactId: PDA2})})}), () => OK(predevBody()));
    let root = await renderJourney(ctx);
    expect(byData(root, "decision", "pending")!.dataset.artifact).toBe(PDA2);
    setVal(root, "predev-evidence", "evd_1"); fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(posts[0].path).toBe(`/v1/missions/${MSN}/predev/artifacts/${PDA2}/approve`);
    root = await renderJourney(ctx);
    expect(byData(root, "decision", "pending")).toBeTruthy();
  });
  it("a second click while a request is in flight sends nothing; the buttons are disabled meanwhile", async () => {
    let release: (v: any) => void = () => {};
    const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), () => new Promise(r => { release = r; }));
    const root = await renderJourney(ctx);
    setVal(root, "predev-evidence", "evd_1");
    fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    fire(byId(root, "predev-approve-submit")!, "click"); fire(byId(root, "predev-approve-submit")!, "click");
    await new Promise(r => setTimeout(r, 0));
    expect(posts).toHaveLength(1);
    expect((await renderJourney(ctx)).children.length).toBeGreaterThan(0);
    const mid = await renderJourney(ctx);
    expect(byId(mid, "predev-approve-submit")!.attrs.get("disabled")).toBeDefined();
    release(OK(predevBody())); await new Promise(r => setTimeout(r, 0));
  });
  it("start and reject also ignore a second click while their request is in flight", async () => {
    for (const [btnId, predev, count] of [["predev-start-submit", inactivePredev(), 1], ["predev-reject-submit", DRAFT_PREDEV(), 1]] as Array<[string, any, number]>) {
      let release: (v: any) => void = () => {};
      const {ctx, posts} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: predev}), () => new Promise(r => { release = r; }));
      const root = await renderJourney(ctx);
      if (btnId === "predev-reject-submit") setVal(root, "predev-reason", "because");
      fire(byId(root, btnId)!, "click"); await new Promise(r => setTimeout(r, 0));
      fire(byId(root, btnId)!, "click"); fire(byId(root, btnId)!, "click"); await new Promise(r => setTimeout(r, 0));
      expect(posts, btnId).toHaveLength(count);
      expect(byId(await renderJourney(ctx), btnId)!.attrs.get("disabled"), btnId).toBeDefined();
      release(OK(predevBody())); await new Promise(r => setTimeout(r, 0));
    }
  });
  it("a successful decision keeps its own result visible when the next draft takes over; the start result stays visible once the sequence is active; the draft's pill follows its state", async () => {
    let body: any = DRAFT_PREDEV();
    const answers: any[] = [OK(predevBody({phase: "REQUIREMENTS"}))];
    const {ctx} = await mkDecisionCtx(p => (p === `/v1/predev/${MSN}` ? body : serve()(p)), () => answers.shift());
    let root = await renderJourney(ctx);
    expect(pills(byId(root, "predev-decisions")!)).toContain("ACTIVE");
    setVal(root, "predev-evidence", "evd_1"); fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    ctx.store.cache.clear();
    body = predevBody({phase: "REQUIREMENTS"}, {BusinessAnalysis: preArt("APPROVED"), Requirements: preArt("SUBMITTED", {artifactId: PDA2}), Plan: preArt("NOT_STARTED")});
    root = await renderJourney(ctx);
    expect(byData(root, "decision", "pending")!.dataset.artifact).toBe(PDA2);
    expect(pills(byId(root, "predev-decisions")!)).toContain("WAITING");
    expect(status(root, "predev-approve").textContent).toBe("Approved. The server advanced the sequence; phase: REQUIREMENTS.");
    expect((byId(root, "predev-evidence") as any).value).toBe("");
    // Başlatma: okuma artık etkin diziyi gösterse de başlatma sonucu görünür kalır.
    let pre: any = inactivePredev();
    const c2 = await mkDecisionCtx(p => (p === `/v1/predev/${MSN}` ? pre : serve()(p)), () => OK(predevBody({phase: "BUSINESS_ANALYSIS"}), 201));
    const r0 = await renderJourney(c2.ctx);
    fire(byId(r0, "predev-start-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    c2.ctx.store.cache.clear(); pre = predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("NOT_STARTED"), Requirements: preArt("NOT_STARTED"), Plan: preArt("NOT_STARTED")});
    const r1 = await renderJourney(c2.ctx);
    expect(byId(r1, "predev-start-submit")).toBeUndefined();
    expect(status(r1, "predev-start").textContent).toBe("Pre-dev sequence started. The server reports the phase: BUSINESS_ANALYSIS.");
  });
  it("a draft that becomes REJECTED by someone else clears the old entered text and the old result (they belonged to a decidable draft)", async () => {
    let body: any = DRAFT_PREDEV();
    const {ctx} = await mkDecisionCtx(p => (p === `/v1/predev/${MSN}` ? body : serve()(p)), () => refuse("PREDEV_APPROVER_NOT_INDEPENDENT"));
    let root = await renderJourney(ctx);
    setVal(root, "predev-evidence", "evd_1"); fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    root = await renderJourney(ctx);
    expect(status(root, "predev-approve").textContent).toContain("PREDEV_APPROVER_NOT_INDEPENDENT");
    ctx.store.cache.clear();
    body = predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("REJECTED"), Requirements: preArt("NOT_STARTED"), Plan: preArt("NOT_STARTED")});
    root = await renderJourney(ctx);
    expect(byData(root, "decision", "none")!.dataset.why).toBe("rejected");
    expect(status(root, "predev-approve").textContent).toBe("");
  });
  it("drafts never leak to another artifact or mission: changing the awaiting artifact (not caused by a decision) or the mission clears entered text and old results", async () => {
    let body: any = DRAFT_PREDEV();
    const {ctx, dec} = await mkDecisionCtx(p => (p === `/v1/predev/${MSN}` ? body : serve()(p)), () => refuse("PREDEV_APPROVER_NOT_INDEPENDENT"));
    let root = await renderJourney(ctx);
    setVal(root, "predev-evidence", "evd_1"); setVal(root, "predev-reason", "because");
    fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    root = await renderJourney(ctx);
    expect(status(root, "predev-approve").textContent).toContain("PREDEV_APPROVER_NOT_INDEPENDENT");
    // Başka bir taslak (ajan yeni sürüm kaydetti): eski girdi ve eski ret metni gösterilmez.
    ctx.store.cache.clear();
    body = predevBody({phase: "BUSINESS_ANALYSIS"}, {BusinessAnalysis: preArt("DRAFT", {artifactId: PDA2, version: 2}), Requirements: preArt("NOT_STARTED"), Plan: preArt("NOT_STARTED")});
    root = await renderJourney(ctx);
    expect(byData(root, "decision", "pending")!.dataset.artifact).toBe(PDA2);
    expect((byId(root, "predev-evidence") as any).value).toBe("");
    expect((byId(root, "predev-reason") as any).value).toBe("");
    expect(status(root, "predev-approve").textContent).toBe("");
    expect(dec.predevDraft.artifactId).toBe(PDA2);
  });
  it("an unreadable predev read draws NO decision panel (the Journey already shows the honest read state)", async () => {
    for (const thrown of ["x: HTTP 404", "fetch failed", "x: HTTP 500"]) {
      const {ctx} = await mkDecisionCtx(p => { if (p === `/v1/predev/${MSN}`) throw new Error(thrown); return serve()(p); }, () => { throw new Error("must not post"); });
      const root = await renderJourney(ctx);
      expect(byId(root, "predev-decisions"), thrown).toBeUndefined();
      expect(allData(root, "journeyState").length, thrown).toBeGreaterThan(0);
    }
  });
  it("server text is rendered as text only, in English and Turkish, with no raw i18n keys", async () => {
    for (const lang of ["en", "tr"]) {
      const {ctx} = await mkDecisionCtx(serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), () => refuse("PREDEV_APPROVAL_EVIDENCE_REQUIRED"), lang);
      let root = await renderJourney(ctx);
      setVal(root, "predev-evidence", "evd_1");
      fire(byId(root, "predev-approve-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
      root = await renderJourney(ctx);
      expect(status(root, "predev-approve").textContent, lang).toContain("(PREDEV_APPROVAL_EVIDENCE_REQUIRED)");
      expect(all(root).some(n => ["SCRIPT", "IMG", "IFRAME"].includes(n.tagName)), lang).toBe(false);
      expect(root.textContent, lang).not.toMatch(/\bpredev\.[a-zA-Z]+\.?[A-Za-z_]*\b|\{[a-zA-Z]+\}/);
      expect(byId(root, "predev-decisions")!.getAttribute("aria-label"), lang).toBe(lang === "en" ? "Pre-development decisions" : "Ön geliştirme kararları");
    }
  });
  it("the module only writes through ctx.api.post with core-built paths; nothing else (no fetch/bridge/eval/HTML sinks); the paths fit the shape the desktop shell must allow", async () => {
    const src = read("views", "predev-decisions.js"), core = read("predev-decisions-core.js");
    expect(src.match(/ctx\.api\.post\(/g)).toHaveLength(1);
    for (const s of [src, core]) expect(s).not.toMatch(/window\.uasco|\bbridge\b|apiPost|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
    expect(src).toContain("req.path");
    const {scanImports} = await import("./support/static-imports.js");
    expect(scanImports(path.join(rend, "predev-decisions-core.js")).map((r: any) => r.specifier).sort()).toEqual(["./journey-core.js", "./work-core.js"]);
    expect(scanImports(path.join(rend, "views", "predev-decisions.js")).map((r: any) => r.specifier).sort()).toEqual(["../components.js", "../forms.js", "../journey-core.js", "../model.js", "../predev-decisions-core.js"]);
  });
  it("every predev.* key used by the view and core exists in EN and TR and no predev.* key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>, tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("predev-decisions-core.js");
    const need = new Set<string>();
    for (const f of ["views/predev-decisions.js", "predev-decisions-core.js"]) for (const m of read(...f.split("/")).matchAll(/"(predev\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const r of core.PREDEV_REFUSAL_REASONS) need.add(`predev.refused.${r}`);
    for (const k of ["started", "started.replayed", "approved", "rejected"]) need.add(`predev.${k}`);
    expect([...need].filter(k => !(k in en) || !(k in tr))).toEqual([]);
    const have = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("predev.")).sort();
    expect(have(en)).toEqual(have(tr));
    expect(have(en).filter(k => !need.has(k))).toEqual([]);
    for (const k of ["form.field.evidenceRefs", "form.field.artifact", "form.field.mission"]) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); }
  });
});

describe("LANE-A A-FLOW-5 analysis step — pure core", () => {
  const A1 = "pda_" + "ab".repeat(12);
  const draft = (over: any = {}) => ({status: "DRAFT_READY", kind: "BusinessAnalysis", artifactId: A1, version: 1, roleId: "UASCO-0300", next: "FOUNDER_APPROVAL", ...over});
  const await_ = (over: any = {}) => ({status: "AWAITING_APPROVAL", kind: "Requirements", artifactId: A1, artifactState: "DRAFT", next: "FOUNDER_APPROVAL", ...over});
  const KINDS = ["BusinessAnalysis", "Requirements", "Plan", "Architecture"];
  const complete = (over: any = {}) => ({status: "COMPLETE", approved: [...KINDS], ...over});
  const blocked = (over: any = {}) => ({status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: ["CLAUDE_CLI_NOT_FOUND", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED"], founderAction: "free text", ...over});
  it("builds the two fixed empty-body requests and refuses non-canonical mission ids", async () => {
    const c = await load("analysis-core.js");
    expect(c.buildAnalysisStepRequest({missionId: MSN})).toEqual({ok: true, path: `/v1/missions/${MSN}/analysis/step`, body: {}, errors: {}});
    expect(c.buildAnalysisPlanRequest({missionId: MSN})).toEqual({ok: true, path: `/v1/missions/${MSN}/analysis/plan`, body: {}, errors: {}});
    for (const bad of ["msn_zz", "", undefined, null, `${MSN}/x`, `${MSN}?a=1`, [MSN], "MSN_" + "ab".repeat(12)]) {
      expect(c.analysisStepPath(bad), String(bad)).toBeNull(); expect(c.analysisPlanPath(bad), String(bad)).toBeNull();
      expect(c.buildAnalysisStepRequest({missionId: bad})).toMatchObject({ok: false, path: null, body: null, errors: {mission: "analysis.err.mission"}});
    }
  });
  it("maps every Lane C step strictly: allowed kinds only, canonical artifact ids, COMPLETE only with all four phases approved exactly once", async () => {
    const c = await load("analysis-core.js");
    expect(c.mapAnalysisStep(draft())).toEqual({status: "DRAFT_READY", kind: "BusinessAnalysis", artifactId: A1, version: 1, roleId: "UASCO-0300"});
    expect(c.mapAnalysisStep(await_({artifactState: "SUBMITTED"}))).toEqual({status: "AWAITING_APPROVAL", kind: "Requirements", artifactId: A1, artifactState: "SUBMITTED"});
    expect(c.mapAnalysisStep({status: "REJECTED", kind: "Plan", reason: "workPackages[0].id duplicate"})).toEqual({status: "REJECTED", kind: "Plan", reason: "workPackages[0].id duplicate"});
    expect(c.mapAnalysisStep({status: "BUILDER_FAILED", kind: "Architecture", code: "PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"})).toEqual({status: "BUILDER_FAILED", kind: "Architecture", code: "PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"});
    expect(c.mapAnalysisStep(complete({approved: [...KINDS].reverse()}))).toEqual({status: "COMPLETE", approved: KINDS}); // canonical order
    expect(c.mapAnalysisStep(blocked())).toEqual({status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: ["CLAUDE_CLI_NOT_FOUND", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED"], phaseStuck: false, target: null, founderAction: null}); // free text founderAction is never carried for an ordinary blocker
    expect(c.mapAnalysisStep(blocked({blocker: "ANALYSIS_NOT_READY", blockers: []})).blockers).toEqual([]);
    const bad: any[] = [null, [], "COMPLETE", {}, {status: "DONE"}, {status: "complete"},
      draft({kind: "UxSpec"}), draft({kind: undefined}), draft({artifactId: "pda_zz"}), draft({artifactId: [A1]}), draft({version: 0}), draft({version: 1.5}), draft({version: "1"}), draft({roleId: "bad role"}), draft({roleId: undefined}), draft({next: "NOTHING"}), draft({next: undefined}),
      await_({artifactState: "APPROVED"}), await_({artifactId: "x"}), await_({kind: "Other"}), await_({next: undefined}),
      {status: "REJECTED", kind: "Plan", reason: ""}, {status: "REJECTED", kind: "Nope", reason: "r"},
      {status: "BUILDER_FAILED", kind: "Plan", code: ""}, {status: "BUILDER_FAILED", kind: "Plan"},
      complete({approved: KINDS.slice(0, 3)}), complete({approved: [...KINDS, "UxSpec"]}), complete({approved: ["BusinessAnalysis", "BusinessAnalysis", "Plan", "Architecture"]}), complete({approved: ["BusinessAnalysis", "Requirements", "Plan", "UxSpec"]}), complete({approved: "all"}), complete({approved: undefined}),
      blocked({blocker: ""}), blocked({blocker: undefined}), blocked({blockers: "x"}), blocked({blockers: [5]}), blocked({blockers: Array(51).fill("A")}), blocked({blocker: "OTHER"}), 
      blocked({blocker: "A", blockers: Array(51).fill("A")}), blocked({blocker: "A", blockers: ["A", 5]}), {status: "BUILDER_FAILED", kind: "Nope", code: "C"}, complete({approved: [...KINDS, "Plan"]})];
    for (const b of bad) expect(c.mapAnalysisStep(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
    expect(c.mapAnalysisStep(blocked({blocker: "A", blockers: Array(20).fill("A")})).blockers).toHaveLength(20);
    // LOW (review #226): the server's own text is shown, control characters become spaces and long text is cut for display only; a step is never refused for its wording
    expect(c.mapAnalysisStep({status: "REJECTED", kind: "Plan", reason: "a\nb"})).toMatchObject({reason: "a b"});
    expect(c.mapAnalysisStep({status: "REJECTED", kind: "Plan", reason: "x".repeat(5000)}).reason.length).toBeLessThan(5000);
    expect(c.mapAnalysisStep(blocked({blocker: "A", blockers: Array(50).fill("A")})).blockers).toHaveLength(50); // 50 is the limit
  });
  it("classifies the HTTP answer with a consistency check between status and result: a blocked step is not a success and a 'complete' on an error status is invalid", async () => {
    const c = await load("analysis-core.js");
    const R = (status: number, body: any, extra: any = {}) => c.classifyAnalysisStep({status, body, ...extra});
    for (const s of [draft(), await_(), complete()]) expect(R(200, s).kind).toBe("STEP");
    expect(R(201, draft()).kind).toBe("STEP");
    for (const st of [409, 500, 502, 403, 404]) { expect(R(st, complete()).kind, `COMPLETE ${st}`).toBe("INVALID"); expect(R(st, draft()).kind, `DRAFT ${st}`).toBe("INVALID"); expect(R(st, await_()).kind).toBe("INVALID"); }
    expect(R(409, blocked())).toMatchObject({kind: "STEP", step: {status: "BLOCKED"}}); expect(R(200, blocked()).kind).toBe("STEP"); expect(R(502, blocked()).kind).toBe("INVALID"); expect(R(500, blocked()).kind).toBe("INVALID");
    expect(R(409, {error: "ANALYSIS_BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: ["CLAUDE_CLI_NOT_FOUND"], founderAction: "x"})).toMatchObject({kind: "STEP", step: {status: "BLOCKED", blockers: ["CLAUDE_CLI_NOT_FOUND"]}});
    expect(R(409, {error: "ANALYSIS_BLOCKED", blocker: 5, blockers: []}).kind).toBe("INVALID"); expect(R(200, {error: "ANALYSIS_BLOCKED", blocker: "X", blockers: ["X"]}).kind).toBe("INVALID");
    const rej = {status: "REJECTED", kind: "Plan", reason: "bad"}, bf = {status: "BUILDER_FAILED", kind: "Plan", code: "C"};
    for (const b of [rej, bf]) { expect(R(502, b).kind).toBe("STEP"); expect(R(200, b).kind).toBe("STEP"); expect(R(409, b).kind).toBe("INVALID"); expect(R(500, b).kind).toBe("INVALID"); }
    expect(R(200, {status: "COMPLETE"}).kind).toBe("INVALID"); expect(R(200, {foo: 1}).kind).toBe("INVALID"); expect(R(200, {}).kind).toBe("INVALID");
    expect(R(423, {error: "GLOBAL_STOP_ACTIVE"}).kind).toBe("STOPPED"); expect(R(403, {error: "ACTION_DENIED"}).kind).toBe("DENIED");
    expect(R(404, {error: "WORKOS_NOT_FOUND"}).kind).toBe("NOT_FOUND"); expect(R(404, {}).kind).toBe("NOT_ENABLED"); expect(R(501, {}).kind).toBe("NOT_ENABLED");
    expect(R(500, {}).kind).toBe("FAILED"); expect(R(409, {error: "SOMETHING"}).kind).toBe("FAILED");
    expect(c.classifyAnalysisStep(null).kind).toBe("FAILED");
    expect(c.classifyAnalysisStep({thrown: true, message: "INVALID_API_PATH"}).kind).toBe("NOT_ENABLED"); expect(c.classifyAnalysisStep({thrown: true, message: "boom"}).kind).toBe("FAILED");
  });
  const trace = (i: number, over: any = {}) => ({index: i, workPackageId: `WP${i + 1}`, estimate: "S", satisfies: ["FR-1"], requirements: [{id: "FR-1", statement: "Users can sign in", acceptanceCriteria: ["Valid login works", "Invalid login is refused"]}], ...over});
  const plan = (n = 2, over: any = {}) => ({tasks: Array.from({length: n}, (_, i) => ({taskId: "tsk_" + String(i).repeat(24)})), replayed: false, trace: Array.from({length: n}, (_, i) => trace(i)), summary: {}, ...over});
  it("maps the created plan strictly (task count, traceability task -> requirement -> acceptance criteria) and classifies refusals by their exact code", async () => {
    const c = await load("analysis-core.js");
    const ok = c.mapAnalysisPlan(plan());
    expect(ok).toMatchObject({taskCount: 2, replayed: false}); expect(ok.trace[0]).toEqual({...trace(0), hiddenRequirements: 0, requirements: [{...trace(0).requirements[0], hiddenCriteria: 0}]});
    expect(c.mapAnalysisPlan(plan(50)).taskCount).toBe(50);
    const bad: any[] = [null, [], {}, plan(0), plan(51), plan(2, {replayed: "no"}), plan(2, {replayed: undefined}), plan(2, {trace: [trace(0)]}), plan(2, {trace: [trace(1), trace(0)]}), plan(2, {tasks: "x"}),
      plan(1, {trace: [trace(0, {estimate: ""})]}), plan(1, {trace: [trace(0, {satisfies: "FR-1"})]}), plan(1, {trace: [trace(0, {satisfies: [5]})]}),
      plan(1, {trace: [trace(0, {requirements: [{id: "FR-1", statement: "", acceptanceCriteria: []}]})]}),
      plan(1, {trace: [trace(0, {requirements: [{id: "FR-1", statement: "s", acceptanceCriteria: [""]}]})]}), plan(1, {trace: [trace(0, {requirements: [{id: "FR-1", statement: "s", acceptanceCriteria: "x"}]})]}), plan(1, {trace: [null]})];
    expect(c.mapAnalysisPlan(plan(1, {trace: [trace(0, {requirements: [{id: "FR-1", statement: "s", acceptanceCriteria: Array(20).fill("c")}]})]})).trace[0].requirements[0].acceptanceCriteria).toHaveLength(20);
    // LOW (review #226): a plan the server's validators accept (any non-empty ids / statements / criteria, no length caps, up to 50 tasks) is shown, never "could not be read"
    const lane = c.mapAnalysisPlan(plan(1, {trace: [trace(0, {workPackageId: "WP 1 / signup", requirements: [{id: "FR 1", statement: "s".repeat(5000), acceptanceCriteria: Array(300).fill("c")}]})]}));
    expect(lane).not.toBeNull(); expect(lane.trace[0].workPackageId).toBe("WP 1 / signup"); expect(lane.trace[0].requirements[0].acceptanceCriteria).toHaveLength(200); expect(lane.trace[0].requirements[0].hiddenCriteria).toBe(100); expect(lane.trace[0].requirements[0].statement.length).toBeLessThan(5000);
    for (const b of bad) expect(c.mapAnalysisPlan(b), JSON.stringify(b)?.slice(0, 80)).toBeNull();
    expect(c.mapAnalysisPlan(plan(1, {trace: [trace(0, {requirements: []})]})).trace[0].requirements).toEqual([]); // a task without a requirement is shown as such
    const R = (status: number, body: any) => c.classifyAnalysisPlan({status, body});
    expect(R(201, plan()).kind).toBe("PLAN"); expect(R(200, plan(2, {replayed: true})).plan.replayed).toBe(true); expect(R(200, {tasks: []}).kind).toBe("INVALID");
    expect(R(409, {error: "ANALYSIS_NOT_COMPLETE"})).toEqual({kind: "REFUSED", code: "ANALYSIS_NOT_COMPLETE"}); expect(R(409, {code: "PLAN_CYCLE"})).toEqual({kind: "REFUSED", code: "PLAN_CYCLE"});
    expect(R(409, {error: "plan cycle!"}).kind).toBe("FAILED"); expect(R(409, {}).kind).toBe("FAILED");
    expect(R(423, {}).kind).toBe("STOPPED"); expect(R(403, {}).kind).toBe("DENIED"); expect(R(404, {error: "WORKOS_NOT_FOUND"}).kind).toBe("NOT_FOUND"); expect(R(404, {}).kind).toBe("NOT_ENABLED"); expect(R(500, {}).kind).toBe("FAILED");
    expect(c.classifyAnalysisPlan({thrown: true, message: "INVALID_API_PATH"}).kind).toBe("NOT_ENABLED"); expect(c.classifyAnalysisPlan(null).kind).toBe("FAILED");
    // M1 (review #226): the server's own 404 codes mean "this mission/project is unknown", never "the step is not enabled"
    for (const code of ["ANALYSIS_MISSION_NOT_FOUND", "ANALYSIS_PROJECT_NOT_FOUND", "WORKOS_NOT_FOUND"]) {
      expect(R(404, {error: code}).kind, `plan ${code}`).toBe("NOT_FOUND"); expect(c.classifyAnalysisStep({status: 404, body: {error: code}}).kind, `step ${code}`).toBe("NOT_FOUND");
    }
    expect(R(404, {error: "SOMETHING_ELSE"}).kind).toBe("NOT_ENABLED"); expect(c.classifyAnalysisStep({status: 404, body: {error: "SOMETHING_ELSE"}}).kind).toBe("NOT_ENABLED");
    expect(c.analysisStatusKey({kind: "NOT_FOUND"}, {}, "step").key).toBe("analysis.notFound");
    // LOW (review #226): a 403 ACTION_DENIED shows the server's reason; a token 403 is an auth error
    expect(c.analysisStatusKey({kind: "DENIED"}, {status: 403, body: {error: "ACTION_DENIED", reason: "NO_PERMISSION"}}, "step")).toMatchObject({ok: false, key: "post.err.denied", vars: {reason: "NO_PERMISSION"}});
    expect(c.analysisStatusKey({kind: "DENIED"}, {status: 403, body: {error: "FORBIDDEN"}}, "plan")).toMatchObject({ok: false, key: "post.err.auth"});
    const k = (cl: any, res: any = {}, verb = "step") => c.analysisStatusKey(cl, res, verb);
    expect(k({kind: "STEP", step: {status: "COMPLETE"}})).toMatchObject({ok: true, key: "analysis.step.COMPLETE"});
    for (const st of ["BLOCKED", "REJECTED", "BUILDER_FAILED"]) expect(k({kind: "STEP", step: {status: st, kind: "Plan"}}).ok, st).toBe(false);
    for (const st of ["DRAFT_READY", "AWAITING_APPROVAL"]) expect(k({kind: "STEP", step: {status: st, kind: "Plan"}}).ok, st).toBe(true);
    expect(k({kind: "PLAN", plan: {replayed: false, taskCount: 3}}, {}, "plan")).toEqual({ok: true, key: "analysis.plan.created", vars: {n: "3"}});
    expect(k({kind: "PLAN", plan: {replayed: true, taskCount: 3}}, {}, "plan").key).toBe("analysis.plan.replayed");
    expect(k({kind: "REFUSED", code: "PLAN_CYCLE"}, {}, "plan")).toEqual({ok: false, key: "analysis.plan.refused", vars: {code: "PLAN_CYCLE"}});
    expect(k({kind: "NOT_ENABLED"}).key).toBe("analysis.notEnabled"); expect(k({kind: "INVALID"}).key).toBe("analysis.invalid"); expect(k({kind: "STOPPED"}).key).toBe("post.err.423");
  });
});

describe("LANE-A A-FLOW-5 analysis step — view (Journey)", () => {
  const STEP = `/v1/missions/${MSN}/analysis/step`, PLAN = `/v1/missions/${MSN}/analysis/plan`, A1 = "pda_" + "ab".repeat(12);
  const KINDS = ["BusinessAnalysis", "Requirements", "Plan", "Architecture"];
  const CMD = "$env:CLAUDE_CONFIG_DIR='C:\\x\\implementer'; claude";
  const exe = (over: any = {}) => ({executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: "LOCAL_CLAUDE"}, claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: CMD}, reviewer: {state: "READY", loginCommand: null}}, ...over});
  async function open(stepAnswer: any, extra: Record<string, any> = {}, planAnswer: any = {status: 404, body: {}}) {
    const gets: string[] = [], served = serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV(), ...extra});
    const pick = (a: any) => (typeof a === "function" ? a() : a);
    const base = await mkDecisionCtx((p: string) => { gets.push(p); return served(p); }, (p: string) => { const a = p === STEP ? pick(stepAnswer) : p === PLAN ? pick(planAnswer) : {status: 404, body: {}}; if (a instanceof Error) throw a; return a; });
    const an = await load("views", "analysis-step.js"); an.resetAnalysis(null); for (const f of ["analysis-step", "analysis-plan"]) { delete base.forms.drafts.status[f]; base.forms.drafts.busy[f] = false; }
    const nav: string[] = []; base.ctx.navigate = (v: string) => { nav.push(v); };
    return {...base, an, nav, gets, root: await renderJourney(base.ctx)};
  }
  const press = async (b: any, id: string) => { fire(byId(b.root, id)!, "click"); await new Promise(r => setTimeout(r, 0)); b.root = await renderJourney(b.ctx); return b.root; };
  const block = (root: N) => byId(root, "analysis-step")!;
  const stOf = (root: N, form = "analysis-step") => byId(root, `${form}-status`)!;
  // //TR: A-ANALYSIS-L10N (F1): analiz rotasının/çekirdeğin döndürebildiği HER engel kodunun en/tr metni vardır; kod listesi GERÇEK kaynak dosyalardan (claude-profiles.ts, analysis.ts, first-delivery-bindings.ts) çıkarılır, elle yazılmaz; yeni bir kod eklenir ve metni yoksa bu test düşer.
  it("F1: every blocker code the analysis route and core can return has an English and a Turkish text (no '(not recognised)'), the list is read from the real sources, and EXECUTOR_NOT_ENABLED shows its text through the real block", async () => {
    const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const cp = src("core/workos/claude-profiles.ts"), an = src("core/workos/crew/analysis.ts"), fdb = src("core/agents/first-delivery-bindings.ts");
    const codes = new Set<string>();
    // //TR: L1: tarama tek satıra güvenmez; LauncherCheck tipi birden çok satıra sarılabilir, analysis.ts doğrudan {status:"BLOCKED", blocker:"X"} döndürebilir ve claudeRoleReadiness önek taşımayan bir kodu blockers.push ile ekleyebilir.
    const launcherFrom = cp.indexOf("export type LauncherCheck ="), launcherTo = cp.indexOf("export function claudeLauncherCheck(");
    if (launcherFrom < 0 || launcherTo < launcherFrom) throw new Error("missing LauncherCheck type");
    for (const m of cp.slice(launcherFrom, launcherTo).matchAll(/"([A-Z][A-Z0-9_]+)"/g)) codes.add(m[1]);
    const body = cp.slice(cp.indexOf("export function claudeRoleReadiness("), cp.indexOf("// //TR: Claude CLI yazdırma kipinde"));
    for (const m of body.matchAll(/\b((?:CLAUDE|PROVIDER|CLI)_[A-Z_]+)\b/g)) codes.add(m[1]);
    for (const m of an.matchAll(/blockedStep\("([A-Z_]+)"/g)) codes.add(m[1]);
    for (const m of an.matchAll(/status:\s*"BLOCKED",\s*blocker:\s*"([A-Z][A-Z0-9_]+)"/g)) codes.add(m[1]); // a direct BLOCKED return that bypasses blockedStep
    for (const src2 of [body, an]) for (const push of src2.matchAll(/\bblockers\.push\(([^;]*?)\);/g)) for (const m of push[1].matchAll(/(?:^|(?<!\?)\?\s*|(?<![?:\w$]):\s*)["`]([A-Z][A-Z0-9_]+)(?=["`:])/g)) codes.add(m[1]); // an unprefixed code pushed onto blockers
    for (const m of an.matchAll(/\?\? "([A-Z_]+)"/g)) codes.add(m[1]);
    const { EXECUTOR_NOT_ENABLED } = await import("../core/workos/crew/analysis.js"); codes.add(EXECUTOR_NOT_ENABLED);
    if (/ROLE_NOT_EXECUTABLE/.test(fdb)) codes.add("ROLE_NOT_EXECUTABLE");
    for (const known of ["CLAUDE_CLI_NOT_FOUND", "CLAUDE_CLI_SHIM_UNSUPPORTED", "PROVIDER_PROVENANCE_NOT_READY", "CLAUDE_PACKAGE_PROVENANCE_REQUIRED", "CLAUDE_LAUNCHER_PROVENANCE_CHANGED", "CLAUDE_PACKAGE_PROVENANCE_CHANGED", "CLAUDE_PROFILE_LOGIN_REQUIRED", "CLAUDE_PROFILE_REFUSED", "ANALYSIS_IN_PROGRESS", "ANALYSIS_PHASE_NOT_ADVANCED", "ANALYSIS_NOT_READY", "EXECUTOR_NOT_ENABLED", "ROLE_NOT_EXECUTABLE"]) expect(codes.has(known), `source scan lost ${known}`).toBe(true);
    const an2 = await load("views", "analysis-step.js"), i18n = await load("i18n.js");
    const E = (await load("locales", "en.js")).default as Record<string, string>, T = (await load("locales", "tr.js")).default as Record<string, string>;
    for (const [lang, dict] of [["en", E], ["tr", T]] as const) {
      const ctx = { t: (k: string, v?: any) => i18n.translate(lang, k, v) };
      for (const code of [...codes].sort()) {
        const variants = code.startsWith("CLAUDE_PROFILE_") ? [code, `implementer:${code}`, `reviewer:${code}`, ...(code === "CLAUDE_PROFILE_REFUSED" ? [`implementer:${code}:PROFILE_PATH_INSIDE_GIT_WORKTREE`] : [])] : [code, ...(code === "ROLE_NOT_EXECUTABLE" ? ["ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING:UASCO-0001"] : [])];
        for (const v of variants) {
          const t = an2.blockerText(ctx, v);
          expect(t, `${lang} ${v}`).not.toMatch(/not recognised|tanınmadı/);
          expect(t, `${lang} ${v}`).not.toBe(v);
        }
        expect(dict[`analysis.blocker.${code}`], `${lang} analysis.blocker.${code}`).toBeTruthy();
      }
    }
    expect(E["analysis.blocker.EXECUTOR_NOT_ENABLED"]).toBe("Local Claude is not enabled, so no draft can be produced. Open Settings, then AI Executors, and enable Local Claude.");
    expect(T["analysis.blocker.EXECUTOR_NOT_ENABLED"]).toBe("Local Claude etkin değil, bu yüzden taslak üretilemez. Ayarlar > AI Yürütücüleri bölümünden Local Claude'u etkinleştirin.");
    expect(E["analysis.blocker.ANALYSIS_IN_PROGRESS"]).toBe("A draft for this mission is already being produced. Wait for it to finish, then look at the pending draft.");
    expect(T["analysis.blocker.ANALYSIS_IN_PROGRESS"]).toBe("Bu mission için bir taslak zaten üretiliyor. Bitmesini bekleyin, sonra bekleyen taslağa bakın.");
    expect(E["analysis.blocker.CLAUDE_PACKAGE_PROVENANCE_CHANGED"]).toBe("The installed Claude Code package changed after it was verified. Enable Local Claude again to verify the new install.");
    expect(T["analysis.blocker.CLAUDE_PACKAGE_PROVENANCE_CHANGED"]).toBe("Kurulu Claude Code paketi doğrulandıktan sonra değişti. Yeni kurulumu doğrulamak için Local Claude'u yeniden etkinleştirin.");
    // through the real block: the route's own free BLOCKED (no builder) ends with EXECUTOR_NOT_ENABLED
    const b = await open({status: 200, body: {status: "BLOCKED", blocker: "PROVIDER_PROVENANCE_NOT_READY", blockers: ["PROVIDER_PROVENANCE_NOT_READY", "EXECUTOR_NOT_ENABLED"], founderAction: "free text"}});
    const after = await press(b, "analysis-step-submit");
    const rows = allData(block(after), "analysisBlocker");
    expect(rows.map(n => n.dataset.analysisBlocker)).toEqual(["PROVIDER_PROVENANCE_NOT_READY", "EXECUTOR_NOT_ENABLED"]);
    expect(rows[1].textContent).toBe("Local Claude is not enabled, so no draft can be produced. Open Settings, then AI Executors, and enable Local Claude.");
    expect(block(after).textContent).not.toContain("not recognised");
  });

  // //TR: A-ANALYSIS-L10N (F2): 409 WORKOS_CONFLICT + reason köprüden geçer ve görünümde SEBEP metniyle gösterilir; genel "idempotency anahtarı" metni değil.
  it("F2: a 409 WORKOS_CONFLICT with a reason (MISSION_NOT_PREDEV_ELIGIBLE) is its own state with the truthful text, an unknown reason still shows the code, and a 409 without a valid reason stays the generic conflict", async () => {
    const c = await load("analysis-core.js");
    const R = (status: number, body: any) => c.classifyAnalysisStep({status, body});
    expect(R(409, {error: "WORKOS_CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"})).toEqual({kind: "CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"});
    expect(R(409, {error: "WORKOS_CONFLICT", reason: "SOMETHING_NEW"})).toEqual({kind: "CONFLICT", reason: "SOMETHING_NEW"});
    for (const bad of [{error: "WORKOS_CONFLICT"}, {error: "WORKOS_CONFLICT", reason: "lower case"}, {error: "WORKOS_CONFLICT", reason: 5}, {error: "WORKOS_CONFLICT", reason: "A".repeat(65)}, {error: "OTHER", reason: "MISSION_NOT_PREDEV_ELIGIBLE"}]) expect(R(409, bad).kind, JSON.stringify(bad)).toBe("FAILED");
    for (const st of [200, 400, 404, 500, 502]) expect(R(st, {error: "WORKOS_CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"}).kind, `status ${st}`).not.toBe("CONFLICT");
    expect(c.analysisStatusKey({kind: "CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"}, {}, "step")).toEqual({ok: false, key: "analysis.conflict.MISSION_NOT_PREDEV_ELIGIBLE", vars: {}});
    expect(c.analysisStatusKey({kind: "CONFLICT", reason: "SOMETHING_NEW"}, {}, "step")).toEqual({ok: false, key: "analysis.conflict.other", vars: {reason: "SOMETHING_NEW"}});
    expect(c.ANALYSIS_CONFLICT_REASONS).toEqual(["MISSION_NOT_PREDEV_ELIGIBLE"]);
    const E = (await load("locales", "en.js")).default as Record<string, string>, T = (await load("locales", "tr.js")).default as Record<string, string>;
    expect(E["analysis.conflict.MISSION_NOT_PREDEV_ELIGIBLE"]).toBe("This mission is no longer open for the pre-development analysis (for example a run has already started). Nothing was recorded.");
    expect(T["analysis.conflict.MISSION_NOT_PREDEV_ELIGIBLE"]).toBe("Bu mission artık ön geliştirme analizine açık değil (örneğin bir koşu zaten başladı). Hiçbir şey kaydedilmedi.");
    expect(E["analysis.conflict.other"]).toBe("The server refused the analysis step because of a conflict ({reason}). Nothing was recorded.");
    expect(T["analysis.conflict.other"]).toBe("Sunucu analiz adımını bir çakışma nedeniyle reddetti ({reason}). Hiçbir şey kaydedilmedi.");
    for (const k of ["analysis.conflict.MISSION_NOT_PREDEV_ELIGIBLE", "analysis.conflict.other"]) expect(E[k]).not.toMatch(/idempotency/i);
    // //TR: L2: çakışma geç yolda builder.produce SONRASI da gelebilir (recorder.start -> openPreDevSequence); bu yüzden metin "hiçbir şey üretilmedi" ya da iş/maliyet olmadığı iddiasını TAŞIMAZ, yalnız "kaydedilmedi" der.
    for (const k of ["analysis.conflict.MISSION_NOT_PREDEV_ELIGIBLE", "analysis.conflict.other"]) { expect(E[k]).not.toMatch(/produced|no cost|free of charge/i); expect(T[k]).not.toMatch(/üretil|maliyet/i); expect(E[k]).toContain("Nothing was recorded."); expect(T[k]).toContain("Hiçbir şey kaydedilmedi."); }
    // through the real block, with the body exactly as the desktop bridge delivers it
    const b = await open({status: 409, body: {error: "WORKOS_CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"}});
    const after = await press(b, "analysis-step-submit");
    expect(stOf(after).textContent).toBe("This mission is no longer open for the pre-development analysis (for example a run has already started). Nothing was recorded.");
    expect(stOf(after).dataset.result).toBe("error");
    expect(byId(after, "analysis-plan-submit")).toBeUndefined();
    const u = await open({status: 409, body: {error: "WORKOS_CONFLICT", reason: "SOMETHING_NEW"}});
    expect(stOf(await press(u, "analysis-step-submit")).textContent).toBe("The server refused the analysis step because of a conflict (SOMETHING_NEW). Nothing was recorded.");
    const g = await open({status: 409, body: {error: "WORKOS_CONFLICT"}});
    expect(stOf(await press(g, "analysis-step-submit")).textContent).toMatch(/^Conflict \(HTTP 409\)/);
  });
  it("shows an Analyse button and a closed 'Create plan' gate before any step; pressing it posts {} once to the canonical path", async () => {
    const b = await open({status: 200, body: {status: "DRAFT_READY", kind: "BusinessAnalysis", artifactId: A1, version: 1, roleId: "UASCO-0300", next: "FOUNDER_APPROVAL"}});
    expect(byData(block(b.root), "analysisStatus")!.dataset.analysisStatus).toBe("NONE"); expect(byId(b.root, "analysis-plan-submit")).toBeUndefined();
    expect(byData(block(b.root), "analysisPlanGate", "CLOSED")).toBeDefined(); expect(b.posts).toEqual([]);
    expect(allData(b.root, "kind").length).toBeGreaterThan(0); // the existing pre-dev section is still rendered next to it
    const after = await press(b, "analysis-step-submit");
    expect(b.posts).toEqual([{path: STEP, body: {}}]); expect(b.rerenders()).toBe(2); // one repaint when the lock is set (before the POST), one with the answer
    expect(byData(block(after), "analysisStatus")!.dataset.analysisStatus).toBe("DRAFT_READY");
    expect(block(after).textContent).toContain("Draft ready: Business analysis"); expect(block(after).textContent).toContain("version 1"); expect(block(after).textContent).toContain("UASCO-0300");
    expect(stOf(after).dataset.result).toBe("ok");
    expect(byId(after, "analysis-plan-submit")).toBeUndefined();
  });
  it("never says 'Analysis complete' unless the step is COMPLETE; every other outcome is reported as it is", async () => {
    const run = async (answer: any) => { const b = await open(answer); const r = await press(b, "analysis-step-submit"); return {b, r, text: block(r).textContent, st: stOf(r)}; };
    const draft = await run({status: 200, body: {status: "DRAFT_READY", kind: "Requirements", artifactId: A1, version: 2, roleId: "UASCO-0301", next: "FOUNDER_APPROVAL"}});
    const wait = await run({status: 200, body: {status: "AWAITING_APPROVAL", kind: "Plan", artifactId: A1, artifactState: "SUBMITTED", next: "FOUNDER_APPROVAL"}});
    const rej = await run({status: 502, body: {status: "REJECTED", kind: "Architecture", reason: "components must not be empty"}});
    const bf = await run({status: 502, body: {status: "BUILDER_FAILED", kind: "Plan", code: "PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"}});
    const blk = await run({status: 409, body: {status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: ["CLAUDE_CLI_NOT_FOUND"], founderAction: "x"}});
    const done = await run({status: 200, body: {status: "COMPLETE", approved: KINDS}});
    for (const x of [draft, wait, rej, bf, blk]) { expect(x.text).not.toContain("Analysis complete"); expect(byId(x.r, "analysis-plan-submit")).toBeUndefined(); }
    expect(draft.st.dataset.result).toBe("ok"); expect(wait.st.dataset.result).toBe("ok");
    for (const x of [rej, bf, blk]) expect(x.st.dataset.result, x.text).toBe("error");
    expect(wait.text).toContain("waits for your decision"); expect(wait.text).toContain("No new analysis was started");
    expect(rej.text).toContain("failed the validators and nothing was recorded: components must not be empty"); expect(bf.text).toContain("builder code PREDEV_DRIVER_BUILDER_NOT_CONFIGURED"); expect(bf.text).toContain("Nothing was recorded");
    expect(done.text).toContain("Analysis complete: Business analysis, Requirements, Plan, Architecture are approved"); expect(done.st.dataset.result).toBe("ok");
    expect(byId(done.r, "analysis-plan-submit")).toBeDefined(); expect(byData(block(done.r), "analysisPlanGate")).toBeUndefined();
  });
  it("BLOCKED lists the exact blockers in plain words, shows the Founder's own login command only as text, and reads executors only after a BLOCKED result", async () => {
    const answer = {status: 409, body: {status: "BLOCKED", blocker: "CLAUDE_CLI_SHIM_UNSUPPORTED", blockers: ["CLAUDE_CLI_SHIM_UNSUPPORTED", "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED", "reviewer:CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN", "ROLE_NOT_EXECUTABLE:UASCO-0300 unbound", "BRAND_NEW"], founderAction: "Found C:\\Users\\x\\claude.cmd"}};
    const seen: string[] = [];
    const b = await open(answer, {"/v1/system/executors": exe()});
    expect(b.posts).toEqual([]);
    const getsBefore = () => seen.length;
    void getsBefore;
    const after = await press(b, "analysis-step-submit");
    const blk = byData(block(after), "analysisStatus", "BLOCKED")!;
    const items = allData(blk, "analysisBlocker").map(n => [n.dataset.analysisBlocker, n.textContent]);
    expect(items.map(i => i[0])).toEqual(answer.body.blockers);
    expect(items[0][1]).toContain("npm .cmd/.bat launcher");
    expect(items[1][1]).toContain("Implementer profile: This UASCO Claude profile is not signed in");
    for (const it of items) expect(it[1], "analysis text, not run text").not.toMatch(/nothing was started|no run|run will/i); // LOW (review #226): analysis blockers never use the run wording
    expect(items[2][1]).toContain("Reviewer profile (read-only): This UASCO Claude profile folder was refused"); expect(items[2][1]).toContain("(SETTINGS_NOT_WRITTEN)");
    expect(items[3][1]).toContain("not bound to an executable profile"); expect(items[3][1]).toContain("(UASCO-0300 unbound)");
    expect(items[4][1]).toBe("BRAND_NEW (not recognised)");
    expect(blk.textContent).not.toMatch(/claude\.cmd|C:\\Users/); // the server's free text and paths are never shown
    const login = allData(blk, "analysisLogin");
    expect(login.map(n => n.dataset.analysisLogin)).toEqual(["implementer"]); expect(login[0].textContent).toBe(CMD);
    expect(all(blk).filter(n => n.tagName === "BUTTON").length).toBe(0); // text only, never executed by the renderer
    expect(stOf(after).dataset.result).toBe("error");
  });
  it("BLOCKED without a readable login command says so instead of inventing one; the executors read is skipped when nothing is blocked", async () => {
    const answer = {status: 409, body: {error: "ANALYSIS_BLOCKED", blocker: "implementer:CLAUDE_PROFILE_LOGIN_EXPIRED", blockers: ["implementer:CLAUDE_PROFILE_LOGIN_EXPIRED"]}};
    const b = await open(answer); // /v1/system/executors is not served -> unreadable
    const after = await press(b, "analysis-step-submit");
    expect(allData(block(after), "analysisLogin").length).toBe(0); expect(byData(block(after), "analysisLoginMissing", "implementer")!.textContent).toContain("sign-in command for the Implementer profile is not available here");
    expect(block(after).textContent).toContain("sign-in has expired");
    // not blocked -> no executors read at all
    let reads = 0;
    const ok = await open({status: 200, body: {status: "AWAITING_APPROVAL", kind: "Plan", artifactId: A1, artifactState: "DRAFT", next: "FOUNDER_APPROVAL"}}, {"/v1/system/executors": () => { reads++; return exe(); }});
    await press(ok, "analysis-step-submit"); expect(reads).toBe(0);
  });
  it("COMPLETE opens 'Create plan'; it posts {} once, shows the traceability and offers the plan in Tasks; a refusal is shown by its code and nothing is claimed", async () => {
    const tr = (i: number) => ({index: i, workPackageId: `WP${i + 1}`, estimate: "M", satisfies: ["FR-1"], requirements: [{id: "FR-1", statement: "Users can sign in", acceptanceCriteria: ["Valid login works", "Invalid login is refused"]}]});
    const created = {status: 201, body: {tasks: [{taskId: "tsk_" + "1".repeat(24)}, {taskId: "tsk_" + "2".repeat(24)}], replayed: false, trace: [tr(0), tr(1)], summary: {}}};
    const b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, {}, created);
    await press(b, "analysis-step-submit");
    const r1 = await press(b, "analysis-plan-submit");
    expect(b.posts.map(p => p.path)).toEqual([STEP, PLAN]); expect(b.posts[1].body).toEqual({});
    const res = byId(r1, "analysis-plan-result")!;
    expect(res.dataset.tasks).toBe("2"); expect(res.textContent).toContain("Plan created with 2 tasks"); expect(res.textContent).toContain("No run was started");
    expect(allData(res, "traceTask").map(n => n.dataset.traceTask)).toEqual(["WP1", "WP2"]);
    expect(allData(res, "traceCriterion").map(n => n.textContent)).toEqual(["Valid login works", "Invalid login is refused", "Valid login works", "Invalid login is refused"]);
    expect(allData(res, "traceReq").length).toBe(2);
    expect(stOf(r1, "analysis-plan").dataset.result).toBe("ok");
    fire(byId(r1, "analysis-open-plan")!, "click"); expect(b.nav).toEqual(["work"]); expect(b.forms.selection.missionId).toBe(MSN);
    // a refusal by code
    const c = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, {}, {status: 409, body: {error: "PLAN_ALREADY_EXISTS"}});
    await press(c, "analysis-step-submit"); const r2 = await press(c, "analysis-plan-submit");
    expect(stOf(r2, "analysis-plan").dataset.result).toBe("error"); expect(stOf(r2, "analysis-plan").textContent).toContain("PLAN_ALREADY_EXISTS");
    expect(byId(r2, "analysis-plan-result")).toBeUndefined(); expect(byId(r2, "analysis-open-plan")).toBeUndefined();
    // a malformed 2xx never claims a plan
    const d = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, {}, {status: 201, body: {tasks: [], replayed: false, trace: []}});
    await press(d, "analysis-step-submit"); const r3 = await press(d, "analysis-plan-submit");
    expect(stOf(r3, "analysis-plan").textContent).toContain("could not be read"); expect(byId(r3, "analysis-plan-result")).toBeUndefined();
  });
  it("sends no plan request unless this mission's step reported COMPLETE in this view, and forgets results when the mission changes", async () => {
    const b = await open({status: 200, body: {status: "DRAFT_READY", kind: "Plan", artifactId: A1, version: 1, roleId: "UASCO-0300", next: "FOUNDER_APPROVAL"}});
    const r = await b.an.submitAnalysisPlan(b.ctx, MSN);
    expect(r).toEqual({ok: false, validation: true}); expect(b.posts).toEqual([]);
    expect(b.forms.drafts.status["analysis-plan"]).toMatchObject({ok: false, key: "analysis.err.notComplete"});
    await press(b, "analysis-step-submit");
    expect(await b.an.submitAnalysisPlan(b.ctx, MSN)).toEqual({ok: false, validation: true}); expect(b.posts.map(p => p.path)).toEqual([STEP]); // DRAFT_READY is not COMPLETE
    // switching mission wipes the shown result and any status
    const other = "msn_" + "cd".repeat(12);
    b.an.analysisPanel(b.ctx, {missionId: other, exec: null});
    expect(b.an.analysisUi.missionId).toBe(other); expect(b.an.analysisUi.step).toBeNull(); expect(b.forms.drafts.status["analysis-step"]).toBeUndefined(); expect(b.forms.drafts.status["analysis-plan"]).toBeUndefined();
    expect(await b.an.submitAnalysisPlan(b.ctx, MSN)).toEqual({ok: false, validation: true}); // the old mission's COMPLETE does not carry over
  });
  it("not enabled, a server error, an invalid answer and a Global Stop are each reported as such — never as a result", async () => {
    const run = async (answer: any) => { const b = await open(answer); const r = await press(b, "analysis-step-submit"); return {r, st: stOf(r), text: block(r).textContent}; };
    const none = await run(Object.assign(new Error("INVALID_API_PATH"), {})); expect(none.st.dataset.result).toBe("error"); expect(none.st.textContent).toContain("not enabled in this build"); expect(byData(none.r as any, "analysisStatus", "NONE")).toBeDefined();
    const nf = await run({status: 404, body: {}}); expect(nf.st.textContent).toContain("not enabled in this build");
    const err = await run({status: 500, body: {}}); expect(err.st.dataset.result).toBe("error"); expect(err.text).not.toContain("Draft ready");
    const inv = await run({status: 200, body: {status: "COMPLETE", approved: ["Plan"]}}); expect(inv.st.textContent).toContain("could not be read"); expect(inv.text).not.toContain("Analysis complete");
    const stop = await run({status: 423, body: {error: "GLOBAL_STOP_ACTIVE"}}); expect(stop.st.dataset.result).toBe("error");
  });
  it("a failed re-check clears the old result (no stale 'complete', the plan gate closes) while an already created plan stays shown", async () => {
    const tr = { index: 0, workPackageId: "WP1", estimate: "S", satisfies: [], requirements: [] };
    let n = 0;
    const b = await open(() => (++n === 1 ? {status: 200, body: {status: "COMPLETE", approved: KINDS}} : {status: 500, body: {}}), {}, {status: 201, body: {tasks: [{taskId: "tsk_" + "1".repeat(24)}], replayed: false, trace: [tr], summary: {}}});
    const a1 = await press(b, "analysis-step-submit"); expect(byId(a1, "analysis-plan-submit")).toBeDefined();
    const a2 = await press(b, "analysis-plan-submit"); expect(byId(a2, "analysis-plan-result")).toBeDefined();
    const a3 = await press(b, "analysis-step-submit");
    expect(byData(block(a3), "analysisStatus")!.dataset.analysisStatus).toBe("NONE"); expect(block(a3).textContent).not.toContain("Analysis complete");
    expect(byId(a3, "analysis-plan-submit")).toBeUndefined(); expect(stOf(a3).dataset.result).toBe("error");
    expect(byId(a3, "analysis-plan-result")).toBeDefined(); // the earlier real plan is not erased by a failed re-check
  });
  it("plan view details: a task without requirements says so, a requirement without criteria has no empty list, a replay says the plan already existed, a later refusal keeps the plan shown, and Open sets the mission", async () => {
    const reqNo = {index: 0, workPackageId: "WP1", estimate: "S", satisfies: [], requirements: []};
    const reqNoCrit = {index: 1, workPackageId: "WP2", estimate: "M", satisfies: ["FR-2"], requirements: [{id: "FR-2", statement: "Admins can export", acceptanceCriteria: []}]};
    let n = 0;
    const b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, {}, () => (++n === 1 ? {status: 200, body: {tasks: [{taskId: "tsk_" + "1".repeat(24)}, {taskId: "tsk_" + "2".repeat(24)}], replayed: true, trace: [reqNo, reqNoCrit], summary: {}}} : {status: 409, body: {error: "PLAN_ALREADY_EXISTS"}}));
    await press(b, "analysis-step-submit");
    const r1 = await press(b, "analysis-plan-submit");
    const res = byId(r1, "analysis-plan-result")!;
    expect(res.textContent).toContain("The same plan already existed (2 tasks)"); expect(res.textContent).not.toContain("Plan created with");
    const wp1 = allData(res, "traceTask", "WP1")[0], wp2 = allData(res, "traceTask", "WP2")[0];
    expect(allData(wp1, "traceNone").length).toBe(1); expect(allData(wp1, "traceReq").length).toBe(0);
    expect(allData(wp2, "traceNone").length).toBe(0); expect(allData(wp2, "traceReq").length).toBe(1);
    expect(all(allData(wp2, "traceReq")[0]).filter(x => x.tagName === "UL").length).toBe(0); // no empty criteria list
    const r2 = await press(b, "analysis-plan-submit");
    expect(stOf(r2, "analysis-plan").dataset.result).toBe("error"); expect(byId(r2, "analysis-plan-result")).toBeDefined();
    b.forms.selection.missionId = "msn_" + "ee".repeat(12);
    fire(byId(r2, "analysis-open-plan")!, "click"); expect(b.forms.selection.missionId).toBe(MSN); expect(b.nav).toEqual(["work"]);
  });
  it("the shared production lock (409 PREDEV_PRODUCE_IN_PROGRESS / PREDEV_PRODUCE_BUSY) is its own state with its own text, not the generic idempotency conflict; nothing is claimed as produced", async () => {
    const c = await load("analysis-core.js");
    const R = (error: string) => c.classifyAnalysisStep({status: 409, body: {error}});
    expect(R("PREDEV_PRODUCE_IN_PROGRESS")).toEqual({kind: "BUSY", scope: "SAME"}); expect(R("PREDEV_PRODUCE_BUSY")).toEqual({kind: "BUSY", scope: "OTHER"});
    expect(c.classifyAnalysisStep({status: 500, body: {error: "PREDEV_PRODUCE_BUSY"}}).kind).toBe("FAILED"); expect(c.classifyAnalysisStep({status: 409, body: {error: "SOMETHING_ELSE"}}).kind).toBe("FAILED"); // only the two codes, only on 409
    expect(c.classifyAnalysisStep({status: 200, body: {error: "PREDEV_PRODUCE_BUSY"}}).kind).toBe("INVALID");
    expect(c.analysisStatusKey({kind: "BUSY", scope: "SAME"}, {}, "step")).toEqual({ok: false, key: "analysis.busy.SAME", vars: {}}); expect(c.analysisStatusKey({kind: "BUSY", scope: "OTHER"}, {}, "step")).toEqual({ok: false, key: "analysis.busy.OTHER", vars: {}});
    const E = (await load("locales", "en.js")).default as Record<string, string>, T = (await load("locales", "tr.js")).default as Record<string, string>;
    for (const k of ["analysis.busy.SAME", "analysis.busy.OTHER"]) { expect(E[k], k).toMatch(/already being produced/); expect(T[k], k).toBeTruthy(); expect(T[k]).not.toBe(E[k]); expect(E[k]).not.toMatch(/idempotency/i); }
    for (const [error, text] of [["PREDEV_PRODUCE_IN_PROGRESS", "for this mission"], ["PREDEV_PRODUCE_BUSY", "for another mission"]]) {
      const b = await open({status: 409, body: {error}});
      const after = await press(b, "analysis-step-submit");
      expect(stOf(after).textContent).toContain(text); expect(stOf(after).textContent).not.toMatch(/Conflict|idempotency/i); expect(stOf(after).dataset.result).toBe("error");
      expect(byData(block(after), "analysisStatus", "NONE")).toBeDefined(); expect(allData(after, "analysisBlocker").length).toBe(0); expect(byId(after, "analysis-plan-submit")).toBeUndefined();
    }
  });
  it("a plan larger than the display caps says how much is not shown (criteria and requirements), in en and tr; nothing is silently cut", async () => {
    const crit = Array.from({length: 250}, (_, i) => `criterion ${i}`), reqs = Array.from({length: 205}, (_, i) => ({id: `FR-${i}`, statement: "s", acceptanceCriteria: i === 0 ? crit : []}));
    const big = {index: 0, workPackageId: "WP1", estimate: "S", satisfies: [], requirements: reqs};
    const T = (await load("locales", "tr.js")).default as Record<string, string>; expect(T["analysis.trace.more"]).toContain("{n}"); expect(T["analysis.trace.more"]).not.toBe("{n} more not shown");
    for (const more of ["more not shown"]) {
      const b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, {}, () => ({status: 201, body: {tasks: [{taskId: "tsk_" + "1".repeat(24)}], replayed: false, trace: [big], summary: {}}}));
      await press(b, "analysis-step-submit");
      const res = byId(await press(b, "analysis-plan-submit"), "analysis-plan-result")!;
      expect(allData(res, "traceCriterion")).toHaveLength(200); expect(allData(res, "traceReq")).toHaveLength(200);
      const crits = allData(res, "traceHidden", "criteria"), rqs = allData(res, "traceHidden", "requirements");
      expect(crits).toHaveLength(1); expect(crits[0].textContent).toContain("50"); expect(crits[0].textContent).toContain(more);
      expect(rqs).toHaveLength(1); expect(rqs[0].textContent).toContain("5"); expect(rqs[0].textContent).toContain(more);
    }
  });
  it("BLOCKED details: an empty blocker list still shows the single blocker, one login block per role even with two sign-in blockers, and the command may come from the per-role readiness reading", async () => {
    const e1 = await open({status: 409, body: {status: "BLOCKED", blocker: "ANALYSIS_NOT_READY", blockers: [], founderAction: null}});
    const r1 = await press(e1, "analysis-step-submit");
    expect(allData(block(r1), "analysisBlocker").map(n => [n.dataset.analysisBlocker, n.textContent])).toEqual([["ANALYSIS_NOT_READY", "The analysis is not ready for an unspecified reason."]]);
    const two = {status: 409, body: {status: "BLOCKED", blocker: "implementer:CLAUDE_PROFILE_LOGIN_REQUIRED", blockers: ["implementer:CLAUDE_PROFILE_LOGIN_REQUIRED", "implementer:CLAUDE_PROFILE_LOGIN_EXPIRED", "reviewer:CLAUDE_PROFILE_LOGIN_REQUIRED"]}};
    const e2 = await open(two, {"/v1/system/executors": exe({claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", loginCommand: CMD}, reviewer: {state: "LOGIN_REQUIRED", loginCommand: CMD.replace("implementer", "reviewer")}}})});
    const r2 = await press(e2, "analysis-step-submit");
    expect(allData(block(r2), "analysisLogin").map(n => n.dataset.analysisLogin)).toEqual(["implementer", "reviewer"]);
    const ready = (r: string) => ({ready: false, blockers: ["CLAUDE_PROFILE_LOGIN_REQUIRED"], blocker: "CLAUDE_PROFILE_LOGIN_REQUIRED", profile: "LOGIN_REQUIRED", loginCommand: CMD.replace("implementer", r)});
    const only = {executors: {LOCAL_CLAUDE: {state: "READY", readiness: {implementer: ready("implementer"), reviewer: ready("reviewer")}}, FAKE: {state: "TEST_ONLY"}}, active: {reason: "LOCAL_CLAUDE"}};
    const e3 = await open(two, {"/v1/system/executors": only}); // no claudeProfiles at all
    const r3 = await press(e3, "analysis-step-submit");
    expect(allData(block(r3), "analysisLogin").map(n => [n.dataset.analysisLogin, n.textContent.includes("reviewer")])).toEqual([["implementer", false], ["reviewer", true]]);
  });
  it("reads the executors only for a BLOCKED result of the shown mission; a plan is never sent for another mission's COMPLETE", async () => {
    const ok = await open({status: 200, body: {status: "AWAITING_APPROVAL", kind: "Plan", artifactId: A1, artifactState: "DRAFT", next: "FOUNDER_APPROVAL"}}, {"/v1/system/executors": exe()});
    await press(ok, "analysis-step-submit"); expect(ok.gets.filter(g => g === "/v1/system/executors")).toEqual([]);
    const bl = await open({status: 409, body: {status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: ["CLAUDE_CLI_NOT_FOUND"]}}, {"/v1/system/executors": exe()});
    expect(bl.gets.filter(g => g === "/v1/system/executors")).toEqual([]);
    await press(bl, "analysis-step-submit"); expect(bl.gets.filter(g => g === "/v1/system/executors").length).toBe(1);
    const c = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}});
    await press(c, "analysis-step-submit");
    const other = "msn_" + "cd".repeat(12);
    expect(await c.an.submitAnalysisPlan(c.ctx, other)).toEqual({ok: false, validation: true}); // COMPLETE belongs to MSN, not to another mission
    expect(c.posts.map(p => p.path)).toEqual([STEP]);
    // a step run for another mission switches the view state to that mission, so the first mission's COMPLETE cannot be reused
    await c.an.submitAnalysisStep(c.ctx, other); expect(c.an.analysisUi.missionId).toBe(other);
    expect(await c.an.submitAnalysisPlan(c.ctx, MSN)).toEqual({ok: false, validation: true});
  });
  it("is present in English and Turkish with the same keys; no analysis text is a raw key", async () => {
    const en = await load("locales", "en.js"), tr = await load("locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("analysis."));
    // //TR: A-ANALYSIS-L10N: 5 yeni anahtar (analysis.blocker.EXECUTOR_NOT_ENABLED/ANALYSIS_IN_PROGRESS/CLAUDE_PACKAGE_PROVENANCE_CHANGED, analysis.conflict.MISSION_NOT_PREDEV_ELIGIBLE/other); sayı 58 -> 63.
    expect(keys.length).toBe(63);
    for (const h of ["CLAUDE_CLI_NOT_FOUND", "CLAUDE_CLI_SHIM_UNSUPPORTED", "PROVIDER_PROVENANCE_NOT_READY", "CLAUDE_PACKAGE_PROVENANCE_REQUIRED", "CLAUDE_LAUNCHER_PROVENANCE_CHANGED", "CLAUDE_PROFILE_LOGIN_REQUIRED", "CLAUDE_PROFILE_LOGIN_EXPIRED", "CLAUDE_PROFILE_REFUSED", "PROVENANCE_MISSING"]) expect(E[`analysis.blocker.${h}`], h).toBeTruthy();
    for (const k of keys) { expect(T[k], k).toBeTruthy(); expect(E[k], k).not.toBe(k); }
    const b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}); const r = await press(b, "analysis-step-submit");
    expect(block(r).textContent).not.toMatch(/analysis\.[a-z]/);
  });
});

describe("LANE-A A-ANALYSIS-STUCK-1: an approved artefact whose phase did not advance (ANALYSIS_PHASE_NOT_ADVANCED)", () => {
  const STEP = `/v1/missions/${MSN}/analysis/step`, A1 = "pda_" + "ab".repeat(12), A2 = "pda_" + "cd".repeat(12);
  const PLAN = `/v1/missions/${MSN}/analysis/plan`, KINDS = ["BusinessAnalysis", "Requirements", "Plan", "Architecture"];
  const APPROVE = (id: string) => `/v1/missions/${MSN}/predev/artifacts/${id}/approve`;
  const deferred = () => { let res: (v: any) => void = () => {}; const p = new Promise<any>(r => { res = r; }); return {p, res}; };
  const OKPLAN = {tasks: [{}], replayed: false, trace: [{index: 0, workPackageId: "WP1", estimate: "1d", satisfies: [], requirements: []}]};
  const stuck = (over: any = {}) => ({status: 200, body: {status: "BLOCKED", blocker: "ANALYSIS_PHASE_NOT_ADVANCED", blockers: ["ANALYSIS_PHASE_NOT_ADVANCED"], founderAction: "Approve the artefact again to resume (server prose, never parsed).", kind: "Requirements", artifactId: A1, readiness: {ready: false}, ...over}});
  async function open(stepAnswer: any, approveAnswer: any = {status: 200, body: {...predevBody({phase: "PLANNING"}), replayed: false}}, planAnswer: any = {status: 404, body: {}}) {
    const served = serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), approves: string[] = [];
    const base = await mkDecisionCtx(served, (p: string) => {
      if (p === STEP) return typeof stepAnswer === "function" ? stepAnswer() : stepAnswer;
      if (p === PLAN) return typeof planAnswer === "function" ? planAnswer() : planAnswer;
      if (p.endsWith("/approve")) { approves.push(p); return typeof approveAnswer === "function" ? approveAnswer() : approveAnswer; }
      return {status: 404, body: {}};
    });
    const an = await load("views", "analysis-step.js"); an.resetAnalysis(null); for (const f of ["analysis-step", "analysis-plan", "analysis-reapprove"]) { delete base.forms.drafts.status[f]; base.forms.drafts.busy[f] = false; }
    return {...base, an, approves, root: await renderJourney(base.ctx)};
  }
  const press = async (b: any, id: string) => { fire(byId(b.root, id)!, "click"); await new Promise(r => setTimeout(r, 0)); b.root = await renderJourney(b.ctx); return b.root; };
  const text = (n: N) => n.textContent, stuckOf = (root: N) => allData(byId(root, "analysis-step")!, "analysisStuck");

  it("core: kind/artifactId come only from the structured fields and only for this blocker; a missing or malformed field leaves no target (the prose is never parsed)", async () => {
    const c = await load("analysis-core.js"), m = (over: any) => c.mapAnalysisStep({status: "BLOCKED", blocker: "ANALYSIS_PHASE_NOT_ADVANCED", blockers: ["ANALYSIS_PHASE_NOT_ADVANCED"], founderAction: "Approve pda_" + "ee".repeat(12) + " of kind Plan again", ...over});
    expect(m({kind: "Requirements", artifactId: A1})).toMatchObject({phaseStuck: true, target: {kind: "Requirements", artifactId: A1}, founderAction: null});
    for (const bad of [{kind: undefined}, {artifactId: undefined}, {kind: "Nope"}, {artifactId: "pda_zz"}, {artifactId: 5}]) {
      const r = m({kind: "Requirements", artifactId: A1, ...bad});
      expect(r, JSON.stringify(bad)).toMatchObject({phaseStuck: true, target: null}); expect(r.founderAction).toContain("Approve pda_"); // text only; the id in the prose is NOT adopted
    }
    const other = c.mapAnalysisStep({status: "BLOCKED", blocker: "CLAUDE_CLI_NOT_FOUND", blockers: ["CLAUDE_CLI_NOT_FOUND"], kind: "Requirements", artifactId: A1, founderAction: "x"});
    expect(other).toMatchObject({phaseStuck: false, target: null, founderAction: null}); // kind/artifactId on any other blocker are ignored
    expect(c.buildReapproveRequest({missionId: MSN, step: m({kind: "Requirements", artifactId: A1}), evidenceText: "ev-1 ev-2"})).toEqual({ok: true, path: `/v1/missions/${MSN}/predev/artifacts/${A1}/approve`, body: {evidenceRefs: ["ev-1", "ev-2"]}, errors: {}});
    expect(c.buildReapproveRequest({missionId: MSN, step: m({}), evidenceText: "ev-1"})).toMatchObject({ok: false, path: null, errors: {artifact: "analysis.err.noTarget"}});
    expect(c.buildReapproveRequest({missionId: MSN, step: m({kind: "Requirements", artifactId: A1}), evidenceText: ""})).toMatchObject({ok: false, errors: {evidenceRefs: "predev.err.evidenceRequired"}});
    expect(c.buildReapproveRequest({missionId: MSN, step: null, evidenceText: "ev"}).ok).toBe(false);
  });

  it("view: the stuck artefact is shown as a Founder action (not FAILED / BUILDER_FAILED) with the structured target; Re-approve needs the Founder's own evidence and posts exactly to that artefact's approve path", async () => {
    const b = await open(stuck());
    const after = await press(b, "analysis-step-submit");
    const blk = byData(byId(after, "analysis-step")!, "analysisStatus", "BLOCKED")!;
    expect(["BUILDER_FAILED", "REJECTED"].some(s => byData(byId(after, "analysis-step")!, "analysisStatus", s))).toBe(false);
    const box = stuckOf(after)[0]; expect(box.dataset.analysisStuck).toBe("Requirements"); expect(box.dataset.artifact).toBe(A1);
    expect(text(box)).toContain("The Requirements artefact is approved but the phase did not advance. Approve it again to resume"); expect(text(blk)).toContain("approved, but the pre-development phase did not move on");
    expect(text(blk)).not.toContain("(not recognised)"); expect(b.posts.map((p: any) => p.path)).toEqual([STEP]);
    expect(text(box)).toContain("the artefact keeps the evidence of its original approval"); expect(text(box)).not.toContain("records them as your evidence"); // the resume path does not record new evidence, so the hint must not promise it
    // no evidence -> nothing is posted
    await press(b, "analysis-reapprove-submit");
    expect(b.approves).toEqual([]); expect(status(b.root, "analysis-reapprove").dataset.result).toBe("invalid");
    setVal(b.root, "analysis-reapprove-evidence", "evidence-1"); await press(b, "analysis-reapprove-submit");
    expect(b.approves).toEqual([APPROVE(A1)]); expect(b.posts[b.posts.length - 1]).toEqual({path: APPROVE(A1), body: {evidenceRefs: ["evidence-1"]}});
    expect(b.posts.filter((p: any) => p.path === STEP)).toHaveLength(1); // no step (no paid call) is started by the button
    expect(stuckOf(b.root)).toHaveLength(0); // the stale stuck block is gone
    const done = status(b.root, "analysis-reapprove"); expect(done.dataset.result).toBe("ok"); expect(text(done)).toContain("Approved again"); expect(text(done)).toContain("Nothing was generated");
  });

  it("view: a failed re-approve keeps the stuck block and its button and says the server's real reason; nothing is claimed", async () => {
    for (const [ans, expectText] of [[{status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}}, "PREDEV_INDEPENDENT_APPROVER_REQUIRED"], [{status: 404, body: {}}, "not enabled"], [{status: 500, body: {}}, ""]] as const) {
      const b = await open(stuck(), ans); await press(b, "analysis-step-submit");
      setVal(b.root, "analysis-reapprove-evidence", "ev"); await press(b, "analysis-reapprove-submit");
      expect(stuckOf(b.root)).toHaveLength(1); expect(byId(b.root, "analysis-reapprove-submit")).toBeDefined();
      const st = status(b.root, "analysis-reapprove"); expect(st.dataset.result).toBe("error"); expect(text(st)).not.toContain("Approved again");
      if (expectText) expect(text(st).toLowerCase()).toContain(expectText.toLowerCase());
    }
  });

  it("view: without a structured kind or artifactId there is no button; the founderAction is shown as text only", async () => {
    for (const over of [{kind: undefined}, {artifactId: undefined}, {artifactId: "pda_bad"}]) {
      const b = await open(stuck(over)); const r = await press(b, "analysis-step-submit");
      expect(byId(r, "analysis-reapprove-submit")).toBeUndefined(); expect(byId(r, "analysis-reapprove-evidence")).toBeUndefined();
      expect(stuckOf(r)[0].dataset.analysisStuck).toBe("NO_TARGET"); expect(text(byData(byId(r, "analysis-step")!, "analysisFounderAction")!)).toContain("Approve the artefact again to resume");
      expect(b.approves).toEqual([]);
    }
  });

  it("view: the button posts the CURRENT answer's artefact (a second step with another artefact replaces the first)", async () => {
    let ans = stuck(); // the step answer switches between two calls
    const served = serve({[`/v1/predev/${MSN}`]: DRAFT_PREDEV()}), approves: string[] = [];
    const base = await mkDecisionCtx(served, (p: string) => { if (p === STEP) return ans; if (p.endsWith("/approve")) { approves.push(p); return {status: 200, body: {...predevBody({phase: "PLANNING"}), replayed: false}}; } return {status: 404, body: {}}; });
    const an = await load("views", "analysis-step.js"); an.resetAnalysis(null);
    const h = {...base, root: await renderJourney(base.ctx)} as any;
    await press(h, "analysis-step-submit"); ans = stuck({artifactId: A2, kind: "Plan"}); await press(h, "analysis-step-submit");
    expect(stuckOf(h.root)[0].dataset.artifact).toBe(A2);
    setVal(h.root, "analysis-reapprove-evidence", "ev"); await press(h, "analysis-reapprove-submit");
    expect(approves).toEqual([APPROVE(A2)]);
  });

  it("switching missions (the real panel render path) drops a stuck step, typed evidence and a re-approve status", async () => {
    const b = await open(stuck(), {status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}});
    await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "typed-evidence"); await press(b, "analysis-reapprove-submit");
    expect(b.an.analysisUi.step).toMatchObject({phaseStuck: true}); expect(b.an.analysisUi.evidence).toBe("typed-evidence"); expect(b.forms.drafts.status["analysis-reapprove"]).toBeDefined(); expect(b.forms.drafts.status["analysis-step"]).toBeDefined();
    const other = b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N; // what Journey does when another mission is selected
    expect(b.an.analysisUi).toMatchObject({missionId: MSN2, step: null, plan: null, evidence: ""});
    for (const f of ["analysis-reapprove", "analysis-step", "analysis-plan"]) expect(b.forms.drafts.status[f], f).toBeUndefined();
    expect(allData(other, "analysisStuck")).toHaveLength(0); expect(byId(other, "analysis-reapprove-submit")).toBeUndefined();
  });

  it("a successful re-approve also removes the stale 'The analysis is blocked' status line", async () => {
    const b = await open(stuck()); await press(b, "analysis-step-submit");
    expect(text(byId(b.root, "analysis-step")!)).toContain("The analysis is blocked"); expect(status(b.root, "analysis-step").dataset.result).toBe("error");
    setVal(b.root, "analysis-reapprove-evidence", "ev"); await press(b, "analysis-reapprove-submit");
    expect(text(byId(b.root, "analysis-step")!)).not.toContain("The analysis is blocked"); expect(status(b.root, "analysis-step").dataset.result).toBeUndefined();
    expect(status(b.root, "analysis-reapprove").dataset.result).toBe("ok");
  });

  it("a result that lands after another mission was selected is dropped: re-approve (success and refusal), Analyse and Create plan never touch the new mission", async () => {
    const OK = {status: 200, body: {...predevBody({phase: "PLANNING"}), replayed: false}}, REFUSED = {status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}};
    for (const [label, answer] of [["success", OK], ["refusal", REFUSED]] as const) {
      const d = deferred(), b = await open(stuck(), () => d.p); await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev");
      const pending = b.an.submitReapprove(b.ctx, MSN);
      b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}); // mission B selected while A's request is in flight
      b.an.analysisUi.step = {status: "COMPLETE", approved: KINDS}; b.an.analysisUi.evidence = "B-evidence"; b.forms.drafts.status["analysis-step"] = {ok: true, key: "analysis.step.COMPLETE", vars: {}, errors: null};
      d.res(answer); const r = await pending;
      expect(r, label).toMatchObject({ok: false, stale: true});
      expect(b.an.analysisUi.step, label).toMatchObject({status: "COMPLETE"}); expect(b.an.analysisUi.evidence, label).toBe("B-evidence");
      expect(b.forms.drafts.status["analysis-reapprove"], label).toBeUndefined(); expect(b.forms.drafts.status["analysis-step"], label).toMatchObject({key: "analysis.step.COMPLETE"});
    }
    { // Analyse: A's late stuck answer is not adopted by B
      const d = deferred(), b = await open(() => d.p);
      const pending = b.an.submitAnalysisStep(b.ctx, MSN); b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}); d.res(stuck());
      expect(await pending).toMatchObject({ok: false, stale: true}); expect(b.an.analysisUi.step).toBeNull(); expect(b.forms.drafts.status["analysis-step"]).toBeUndefined();
      const after = b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N; expect(byId(after, "analysis-reapprove-submit")).toBeUndefined();
    }
    { // Create plan: A's late plan is not adopted by B
      const d = deferred(), b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, undefined, () => d.p); await press(b, "analysis-step-submit");
      const pending = b.an.submitAnalysisPlan(b.ctx, MSN); b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}); d.res({status: 201, body: OKPLAN});
      expect(await pending).toMatchObject({ok: false, stale: true}); expect(b.an.analysisUi.plan).toBeNull(); expect(b.forms.drafts.status["analysis-plan"]).toBeUndefined();
    }
  });

  it("in flight: three clicks send one POST and the button is disabled meanwhile", async () => {
    const d = deferred(), b = await open(stuck(), () => d.p); await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev");
    const btn = byId(b.root, "analysis-reapprove-submit")!; expect(btn.attrs.get("disabled")).toBeUndefined();
    fire(btn, "click"); fire(btn, "click"); fire(btn, "click"); await new Promise(r => setTimeout(r, 0));
    expect(b.approves).toHaveLength(1);
    b.root = await renderJourney(b.ctx); expect(byId(b.root, "analysis-reapprove-submit")!.attrs.get("disabled")).toBeDefined();
    d.res({status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}}); await new Promise(r => setTimeout(r, 0));
    b.root = await renderJourney(b.ctx); expect(byId(b.root, "analysis-reapprove-submit")!.attrs.get("disabled")).toBeUndefined();
  });

  it("a malformed or other-mission 2xx answer is an error and the stuck block and button stay", async () => {
    for (const bad of [{status: 200, body: {}}, {status: 200, body: {predev: {...predevBody({phase: "PLANNING"}).predev, missionId: MSN2}}}, {status: 200, body: {...predevBody({phase: "PLANNING"}), replayed: "yes"}}]) {
      const b = await open(stuck(), bad); await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev"); await press(b, "analysis-reapprove-submit");
      expect(status(b.root, "analysis-reapprove").dataset.result, JSON.stringify(bad).slice(0, 50)).toBe("error"); expect(text(status(b.root, "analysis-reapprove"))).not.toContain("Approved again");
      expect(stuckOf(b.root)).toHaveLength(1); expect(byId(b.root, "analysis-reapprove-submit")).toBeDefined(); expect(b.an.analysisUi.step).toMatchObject({phaseStuck: true});
    }
  });

  it("re-approve is refused, then Analyse returns a draft: the old refusal and the stuck block are gone", async () => {
    let n = 0; const b = await open(() => (n++ === 0 ? stuck() : {status: 200, body: {status: "DRAFT_READY", kind: "Requirements", artifactId: A1, version: 1, roleId: "UASCO-0300", next: "FOUNDER_APPROVAL"}}),
      {status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}});
    await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev"); await press(b, "analysis-reapprove-submit");
    expect(text(status(b.root, "analysis-reapprove"))).toContain("PREDEV_INDEPENDENT_APPROVER_REQUIRED");
    await press(b, "analysis-step-submit");
    expect(byData(byId(b.root, "analysis-step")!, "analysisStatus", "DRAFT_READY")).toBeDefined(); expect(stuckOf(b.root)).toHaveLength(0);
    expect(status(b.root, "analysis-reapprove").dataset.result).toBeUndefined(); expect(text(byId(b.root, "analysis-step")!)).not.toContain("PREDEV_INDEPENDENT_APPROVER_REQUIRED");
  });

  it("en + tr text exists for every new key and a raw key is never shown", async () => {
    const en = await load("locales", "en.js"), tr = await load("locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    for (const k of ["analysis.blocker.ANALYSIS_PHASE_NOT_ADVANCED", "analysis.stuck.title", "analysis.stuck.head", "analysis.stuck.noTarget", "analysis.stuck.evidenceHint", "analysis.reapprove.button", "analysis.reapprove.done", "analysis.err.noTarget"]) { expect(E[k], k).toBeTruthy(); expect(T[k], k).toBeTruthy(); expect(T[k]).not.toBe(E[k]); }
    const b = await open(stuck()); const r = await press(b, "analysis-step-submit"); expect(text(byId(r, "analysis-step")!)).not.toMatch(/analysis\.[a-z]+\./);
  });

  // ---- A-ANALYSIS-ORDER-1 ----
  it("Analyse and Re-approve never run at the same time: while one is in flight the other button is disabled, a click or a direct call sends nothing, and the late answer cannot override the newer state", async () => {
    // (1) Analyse in flight -> Re-approve is blocked
    let n = 0; const dStep = deferred();
    const a = await open(() => (n++ === 0 ? stuck() : dStep.p)); await press(a, "analysis-step-submit"); setVal(a.root, "analysis-reapprove-evidence", "ev");
    fire(byId(a.root, "analysis-step-submit")!, "click"); await new Promise(r => setTimeout(r, 0)); a.root = await renderJourney(a.ctx);
    expect(byId(a.root, "analysis-step-submit")!.attrs.get("disabled")).toBeDefined(); expect(byId(a.root, "analysis-reapprove-submit")!.attrs.get("disabled")).toBeDefined();
    fire(byId(a.root, "analysis-reapprove-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(await a.an.submitReapprove(a.ctx, MSN)).toEqual({ok: false, busy: true}); expect(a.approves).toEqual([]);
    dStep.res({status: 200, body: {status: "DRAFT_READY", kind: "Requirements", artifactId: A1, version: 1, roleId: "UASCO-0300", next: "FOUNDER_APPROVAL"}}); await new Promise(r => setTimeout(r, 0));
    a.root = await renderJourney(a.ctx); expect(byData(byId(a.root, "analysis-step")!, "analysisStatus", "DRAFT_READY")).toBeDefined(); expect(stuckOf(a.root)).toHaveLength(0);
    // (2) Re-approve in flight -> Analyse is blocked and its answer never overrides
    const dApp = deferred(), r = await open(stuck(), () => dApp.p); await press(r, "analysis-step-submit"); setVal(r.root, "analysis-reapprove-evidence", "ev");
    fire(byId(r.root, "analysis-reapprove-submit")!, "click"); await new Promise(x => setTimeout(x, 0)); r.root = await renderJourney(r.ctx);
    expect(byId(r.root, "analysis-step-submit")!.attrs.get("disabled")).toBeDefined();
    const stepsBefore = r.posts.filter((p: any) => p.path === STEP).length;
    fire(byId(r.root, "analysis-step-submit")!, "click"); await new Promise(x => setTimeout(x, 0));
    expect(await r.an.submitAnalysisStep(r.ctx, MSN)).toEqual({ok: false, busy: true}); expect(r.posts.filter((p: any) => p.path === STEP).length).toBe(stepsBefore);
    dApp.res({status: 200, body: {...predevBody({phase: "PLANNING"}), replayed: false}}); await new Promise(x => setTimeout(x, 0));
    r.root = await renderJourney(r.ctx); expect(r.an.analysisUi.step).toBeNull(); expect(status(r.root, "analysis-reapprove").dataset.result).toBe("ok");
    // (3) Create plan in flight -> Analyse is blocked
    const dPlan = deferred(), p = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, undefined, () => dPlan.p); await press(p, "analysis-step-submit");
    fire(byId(p.root, "analysis-plan-submit")!, "click"); await new Promise(x => setTimeout(x, 0)); p.root = await renderJourney(p.ctx);
    expect(byId(p.root, "analysis-step-submit")!.attrs.get("disabled")).toBeDefined(); expect(await p.an.submitAnalysisStep(p.ctx, MSN)).toEqual({ok: false, busy: true});
    dPlan.res({status: 201, body: OKPLAN}); await new Promise(x => setTimeout(x, 0));
  });

  it("Create plan is blocked while Analyse is in flight (button disabled, direct call refused, no plan POST), so a stale COMPLETE cannot start a plan", async () => {
    let n = 0; const d = deferred(), plans: string[] = [];
    const b = await open(() => (n++ === 0 ? {status: 200, body: {status: "COMPLETE", approved: KINDS}} : d.p), undefined, () => { plans.push("plan"); return {status: 201, body: OKPLAN}; });
    await press(b, "analysis-step-submit"); expect(byId(b.root, "analysis-plan-submit")).toBeDefined();
    fire(byId(b.root, "analysis-step-submit")!, "click"); await new Promise(r => setTimeout(r, 0)); b.root = await renderJourney(b.ctx);
    expect(byId(b.root, "analysis-plan-submit")!.attrs.get("disabled")).toBeDefined();
    fire(byId(b.root, "analysis-plan-submit")!, "click"); await new Promise(r => setTimeout(r, 0));
    expect(await b.an.submitAnalysisPlan(b.ctx, MSN)).toEqual({ok: false, busy: true}); expect(plans).toEqual([]);
    d.res({status: 200, body: {status: "COMPLETE", approved: KINDS}}); await new Promise(r => setTimeout(r, 0));
  });

  it("a dropped (stale) answer still repaints the panel exactly once, for re-approve, Analyse and Create plan", async () => {
    const OK = {status: 200, body: {...predevBody({phase: "PLANNING"}), replayed: false}};
    const cases: Array<[string, (b: any) => Promise<any>, any, (b: any) => any]> = [
      ["re-approve", b => b.an.submitReapprove(b.ctx, MSN), OK, () => ({})],
      ["analyse", b => b.an.submitAnalysisStep(b.ctx, MSN), stuck(), () => ({})],
      ["plan", b => b.an.submitAnalysisPlan(b.ctx, MSN), {status: 201, body: OKPLAN}, () => ({})],
    ];
    for (const [label, start, answer] of cases) {
      const d = deferred();
      const b = label === "re-approve" ? await open(stuck(), () => d.p) : label === "analyse" ? await open(() => d.p) : await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, undefined, () => d.p);
      if (label !== "analyse") await press(b, "analysis-step-submit");
      if (label === "re-approve") setVal(b.root, "analysis-reapprove-evidence", "ev");
      const seen: boolean[] = [], orig = b.ctx.rerender; b.ctx.rerender = async () => { seen.push(b.an.analysisBusy()); return orig(); }; // the lock state at every repaint
      const pending = start(b); b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null});
      const before = b.rerenders(); d.res(answer); const r = await pending;
      expect(r, label).toMatchObject({ok: false, stale: true}); expect(b.rerenders() - before, `${label}: one repaint for the dropped answer`).toBe(1);
      expect(seen, `${label}: busy at each repaint (set, then released before the stale repaint)`).toEqual([true, false]); expect(b.an.analysisBusy(), `${label}: the lock is released`).toBe(false);
      const fresh = b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N; expect(byId(fresh, "analysis-step-submit")!.attrs.get("disabled"), `${label}: a fresh panel's Analyse is enabled`).toBeUndefined();
    }
  });

  it("the typed evidence is cleared after a successful re-approve and a later stuck answer starts with an empty field", async () => {
    let n = 0; const b = await open(() => (n++ === 0 ? stuck() : stuck({artifactId: A2, kind: "Plan"})));
    await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "first-evidence"); await press(b, "analysis-reapprove-submit");
    expect(b.an.analysisUi.evidence).toBe(""); expect(b.approves).toEqual([APPROVE(A1)]);
    await press(b, "analysis-step-submit"); expect((byId(b.root, "analysis-reapprove-evidence") as any).value).toBe("");
    await press(b, "analysis-reapprove-submit"); expect(b.approves).toEqual([APPROVE(A1)]); // the old evidence is NOT reused: an empty field is a validation error, nothing is posted
    expect(status(b.root, "analysis-reapprove").dataset.result).toBe("invalid");
  });

  it("the lock is visible right after the click (the other buttons are disabled by the click's own repaint, with an explanatory note), and it also explains the disabled buttons of another mission", async () => {
    const d = deferred(), b = await open(stuck(), () => d.p); await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev");
    expect(byData(byId(b.root, "analysis-step")!, "analysisBusy")).toBeUndefined();
    b.ctx.rerender = async () => { b.root = await renderJourney(b.ctx); }; // a real repaint, as in the app
    fire(byId(b.root, "analysis-reapprove-submit")!, "click"); // the click's own repaint only: NO extra manual repaint; it is an IPC-backed module load in vitest, so wait (bounded) for it after the original dwell
    expect(b.forms.missionWriteBusy()).toBe(true);
    await new Promise(r => setTimeout(r, 40));
    for (const end = Date.now() + 2000; byId(b.root, "analysis-step-submit")!.attrs.get("disabled") === undefined && Date.now() < end;) await new Promise(r => setTimeout(r, 5));
    expect(byId(b.root, "analysis-step-submit")!.attrs.get("disabled")).toBeDefined(); expect(byId(b.root, "analysis-reapprove-submit")!.attrs.get("disabled")).toBeDefined();
    expect(text(byData(byId(b.root, "analysis-step")!, "analysisBusy")!)).toContain("Another request that changes mission data is running");
    const other = b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N; // mission B while A's request runs: the same conservative lock, but explained
    expect(byId(other, "analysis-step-submit")!.attrs.get("disabled")).toBeDefined(); expect(byData(other, "analysisBusy")).toBeDefined();
    d.res({status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}}); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const after = b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N; expect(byId(after, "analysis-step-submit")!.attrs.get("disabled")).toBeUndefined(); expect(byData(after, "analysisBusy")).toBeUndefined();
  });

  it("two calls in the same tick send exactly one POST and the second is refused as busy (step, re-approve, create plan)", async () => {
    { const d = deferred(), b = await open(() => d.p); const p1 = b.an.submitAnalysisStep(b.ctx, MSN), p2 = b.an.submitAnalysisStep(b.ctx, MSN);
      expect(await p2).toEqual({ok: false, busy: true}); d.res({status: 200, body: {status: "COMPLETE", approved: KINDS}}); await p1; expect(b.posts.filter((p: any) => p.path === STEP)).toHaveLength(1); }
    { const d = deferred(), b = await open(stuck(), () => d.p); await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev");
      const p1 = b.an.submitReapprove(b.ctx, MSN), p2 = b.an.submitReapprove(b.ctx, MSN);
      expect(await p2).toEqual({ok: false, busy: true}); d.res({status: 409, body: {error: "PREDEV_GATE_REFUSED", reason: "PREDEV_INDEPENDENT_APPROVER_REQUIRED"}}); await p1; expect(b.approves).toHaveLength(1); }
    { const d = deferred(), b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}, undefined, () => d.p); await press(b, "analysis-step-submit");
      const p1 = b.an.submitAnalysisPlan(b.ctx, MSN), p2 = b.an.submitAnalysisPlan(b.ctx, MSN);
      expect(await p2).toEqual({ok: false, busy: true}); d.res({status: 201, body: OKPLAN}); await p1; expect(b.posts.filter((p: any) => p.path === PLAN)).toHaveLength(1); }
  });

  it("a pre-POST repaint that rejects releases the lock (no POST is sent, nobody stays locked) and the in-flight note takes focus when the lock repaints", async () => {
    const fails: Array<[string, (b: any) => Promise<any>, () => Promise<any>]> = [
      ["step", b => b.an.submitAnalysisStep(b.ctx, MSN), () => open(stuck())],
      ["re-approve", b => b.an.submitReapprove(b.ctx, MSN), async () => { const b = await open(stuck()); await press(b, "analysis-step-submit"); setVal(b.root, "analysis-reapprove-evidence", "ev"); return b; }],
      ["plan", b => b.an.submitAnalysisPlan(b.ctx, MSN), async () => { const b = await open({status: 200, body: {status: "COMPLETE", approved: KINDS}}); await press(b, "analysis-step-submit"); return b; }],
    ];
    for (const [label, call, mk] of fails) {
      const b = await mk(), posts0 = b.posts.length; b.ctx.rerender = async () => { throw new Error("REPAINT_FAILED"); };
      await expect(call(b), label).rejects.toThrow("REPAINT_FAILED");
      expect(b.an.analysisBusy(), `${label}: the lock is released`).toBe(false); expect(b.posts.length, `${label}: nothing was posted`).toBe(posts0);
      const other = b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N; expect(byId(other, "analysis-step-submit")!.attrs.get("disabled"), `${label}: another mission's Analyse is enabled`).toBeUndefined(); expect(byData(other, "analysisBusy")).toBeUndefined();
    }
    // focus: the rebuilt button is disabled, so the in-flight note (stable id, tabindex -1) takes it; asserted for all three submits
    for (const [label, call, mk] of fails) {
      const d = deferred(), b = await mk(); const spy: any[] = []; b.ctx.settleFocus = (o: any) => { spy.push(o); return null; };
      b.ctx.api.post = async (p: string) => { await d.p; return {status: 404, body: {}}; }; // hold the POST
      const pending = call(b); await new Promise(r => setTimeout(r, 0));
      expect(spy, `${label}: settle before the POST answers`).toEqual([{keys: ["id:analysis-in-flight"]}]);
      const note = byData(b.an.analysisPanel(b.ctx, {missionId: MSN, exec: null}) as N, "analysisBusy")!;
      expect([note.id, note.attrs.get("tabindex")], label).toEqual(["analysis-in-flight", "-1"]);
      d.res(null); await pending;
    }
  });
});

// //TR: A-FLOW-2: ilk teslim akışının "görev -> koşu" bağı GERÇEK control-api ve gerçek görünümlerle uçtan uca doğrulanır (yürütücü FAKE, koşu yalnız oluşturulur): fikir -> iki görevli elle plan -> mission AUTHORIZED -> koşu başlat -> "koşuyu görevlere bağla" adımı (hiçbir görev kendiliğinden seçilmez) -> bağ -> koşu kartı ve görev denetçisi AYNI bağı gösterir. Her POST önce main.mjs'in B5 POST izin listesinden geçer.
describe("LANE-A A-FLOW-2: the task to run link of the first-delivery flow against the real control-api", () => {
  const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); if (!m) throw new Error(`missing ${name}`); return m[1]; };
  const postAllowed = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn desktopPostPathAllowed;`)() as (v: unknown) => boolean;
  const IDEA = "A small task list web app where one person can add, finish and remove tasks.";
  const text = (n: N) => n.textContent;
  const jsonOf = (r: any) => { try { return r.json(); } catch { return {}; } };

  async function setup() {
    fs.mkdirSync(runtime(), {recursive: true});
    const {FakeExecutors} = await import("../core/workos/executors.js");
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "x\n"}, message: "fake"}), review: () => ({verdict: "CLEAN"})});
    const app = buildServer({controlToken: TOKEN, runtime: runtime(), dataDir: dataDir(), tenantId: "tA", port: 3210, logger: false, executors: fake.pair()}); apps.push(app);
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js");
    forms.resetAllForms();
    const doc = new D(), store = st.createStore(null);
    const calls = {post: [] as Array<{path: string; body: any; status: number}>, resp: [] as any[], confirm: [] as any[], refresh: 0};
    const bridge = {
      apiGet: async (p: string) => { const r = await app.inject({method: "GET", url: p, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json(); },
      apiPost: async (p: string, b: unknown) => {
        if (!postAllowed(p)) throw new Error("INVALID_API_PATH");
        const r = await app.inject({method: "POST", url: p, headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify(b)});
        calls.post.push({path: p, body: b, status: r.statusCode}); calls.resp.push(jsonOf(r)); return {status: r.statusCode, body: jsonOf(r)};
      }
    };
    const api = apiMod.createApi({bridge, store});
    const ctx: any = {doc, store, api, i18n: {lang: "en", t: (k: string, v?: any) => i18n.translate("en", k, v)}, t: (k: string, v?: any) => i18n.translate("en", k, v), navigate: () => {},
      rerender: async () => { store.cache.clear(); }, refreshAll: async () => { calls.refresh++; store.cache.clear(); },
      confirm: async (o: any) => { calls.confirm.push(o); return true; }, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL", settleFocus: () => {}};
    return {app, ctx, doc, calls, forms};
  }
  // idea -> project + mission -> two-task hand plan -> PREFLIGHT -> AUTHORIZED -> run started through the real routes
  async function flowToStartedRun(s: Awaited<ReturnType<typeof setup>>) {
    const intake = await load("views", "intake.js"), plan = await load("views", "plan-form.js"), actions = await load("work-actions.js");
    intake.resetIntakeAll(); (await load("views", "task-status.js")).resetTaskStatusDraft(null); (await load("views", "task-runs.js")).resetTaskRunsDraft(null);
    Object.assign(intake.intakeDraft, {idea: IDEA, title: "Task list"});
    expect(await intake.submitIntake(s.ctx)).toEqual({ok: true});
    const missionId: string = intake.intakeUi.last.missionId; s.forms.selection.missionId = missionId;
    plan.resetPlanDraft(missionId); plan.planDraft.rows = [{title: "Add a task", deps: ""}, {title: "Finish a task", deps: ""}];
    expect(await plan.submitPlan(s.ctx, missionId)).toMatchObject({ok: true, status: 201});
    for (const [from, to] of [["DRAFT", "PREFLIGHT"], ["PREFLIGHT", "AUTHORIZED"]]) expect(await actions.performTransition(s.ctx, {missionId, title: "Task list", from, to, reason: `${from} -> ${to}`})).toMatchObject({ok: true});
    const started = await actions.startRun(s.ctx, {missionId, status: "AUTHORIZED"});
    expect(started).toMatchObject({ok: true, status: 201});
    expect(s.calls.post.at(-1)!.path).toBe(`/v1/missions/${missionId}/runs`);
    const runId: string = s.calls.resp.at(-1).run.runId; // the server's own answer, not what the view parsed
    return {missionId, runId, actions};
  }
  const view = async (s: Awaited<ReturnType<typeof setup>>) => { const root: N = await (await load("views", "work.js")).render(s.ctx); s.doc.body.replaceChildren(root); return root; };
  const linksOnServer = async (s: Awaited<ReturnType<typeof setup>>, taskId: string) => (await getJson(s.app, `/v1/tasks/${taskId}/runs`)).runs.map((x: any) => x.link.runId);
  const tick = () => new Promise(r => setTimeout(r, 0));

  it("start run -> the link step offers every open task unchecked -> one checked task is linked -> the run card and both task inspectors show the same link", async () => {
    const s = await setup(), {missionId, runId} = await flowToStartedRun(s), actions = await load("work-actions.js");
    const detail = await s.ctx.api.missionDetail(missionId), [t1, t2] = [detail.mission.tasks.find((t: any) => t.title === "Add a task"), detail.mission.tasks.find((t: any) => t.title === "Finish a task")];
    expect(runId).toMatch(/^run_[0-9a-f]{24}$/);
    // the step appears right after a successful start, names the run, and chooses nothing for the Founder
    let root = await view(s);
    const panel = byId(root, "run-link")!;
    expect(panel.dataset.runLink).toBe(missionId); expect(panel.dataset.runId).toBe(runId); expect(text(panel)).toContain(runId);
    expect(allData(panel, "runlinkTask").map(n => n.dataset.runlinkTask).sort()).toEqual([t1.taskId, t2.taskId].sort());
    expect(allData(panel, "runlinkTask").every(n => !n.attrs.has("checked"))).toBe(true); // nothing is chosen for the Founder
    expect(allData(panel, "runlinkItem").every(n => n.dataset.runlinkState === "IDLE")).toBe(true);
    expect(await linksOnServer(s, t1.taskId)).toEqual([]); expect(await linksOnServer(s, t2.taskId)).toEqual([]); // nothing is linked by starting a run
    // the run card exists for the mission and reports no linked task yet
    expect(byData(root, "runId", runId)).toBeDefined();
    expect(byData(root, "runLinkedFor", runId)).toBeDefined(); expect(allData(root, "runLinkedTask")).toEqual([]);
    expect(byData(byData(root, "runLinkedFor", runId)!, "runLinked", "none")).toBeDefined(); // the VERIFIED-empty state, not an error or an unavailable note
    // nothing checked: no request
    const post0 = s.calls.post.length;
    expect(await actions.submitRunLinks(s.ctx, detail.mission)).toMatchObject({ok: false, validation: true, posted: 0});
    expect(s.calls.post.length).toBe(post0);
    // check task 1 only and link
    fire(byData(panel, "runlinkTask", t1.taskId)!, "change", {target: {checked: true}});
    const detail2 = await s.ctx.api.missionDetail(missionId);
    expect(await actions.submitRunLinks(s.ctx, detail2.mission)).toEqual({ok: true, posted: 1});
    expect(s.calls.post.at(-1)).toEqual({path: `/v1/tasks/${t1.taskId}/runs`, body: {runId}, status: 201});
    expect(s.calls.post.length).toBe(post0 + 1);
    expect(await linksOnServer(s, t1.taskId)).toEqual([runId]); expect(await linksOnServer(s, t2.taskId)).toEqual([]);
    root = await view(s);
    const afterPanel = byId(root, "run-link")!;
    expect(byData(afterPanel, "runlinkItem", t1.taskId)!.dataset.runlinkState).toBe("LINKED");
    expect(byData(afterPanel, "runlinkItem", t2.taskId)!.dataset.runlinkState).toBe("IDLE");
    expect(byData(afterPanel, "runlink", "summary")!.dataset).toMatchObject({linked: "1", notLinked: "0"});
    // submitting again sends nothing for the linked task
    const post1 = s.calls.post.length;
    expect(await actions.submitRunLinks(s.ctx, (await s.ctx.api.missionDetail(missionId)).mission)).toMatchObject({ok: false, validation: true, posted: 0});
    expect(s.calls.post.length).toBe(post1);
    // the run card now lists exactly the linked task (reverse read GET /v1/work-runs/:id/tasks)
    const card = byData(root, "runLinkedFor", runId)!;
    expect(allData(card, "runLinkedTask").map(n => n.dataset.runLinkedTask)).toEqual([t1.taskId]);
    // task 1 inspector: the run is listed and governs; task 2 inspector: no run linked, and the unlinked run can be linked from the task side
    const open = async (taskId: string) => { let r = await view(s); if (byId(r, "task-runs")?.dataset.taskRunsFor !== taskId) { fire(byData(r, "taskInspect", taskId)!, "click"); r = await view(s); } return r; };
    root = await open(t1.taskId);
    expect(byId(root, "task-runs")!.dataset.taskRunsFor).toBe(t1.taskId);
    expect(byData(byId(root, "task-runs")!, "taskRun", runId)!.dataset.taskRunGoverning).toBe("1");
    root = await open(t2.taskId);
    expect(text(byId(root, "task-runs")!)).toContain("No run is linked to this task.");
    expect(allData(byId(root, "task-runs")!, "taskRun")).toEqual([]);
    expect(byId(root, "taskruns-run")).toBeDefined();
    expect((byId(root, "taskruns-run") as any).value).toBe(runId); // the only unlinked run is preselected
    const post2 = s.calls.post.length;
    fire(byId(root, "taskruns-submit")!, "click");
    for (let i = 0; i < 200 && s.calls.post.length === post2; i++) await tick();
    expect(s.calls.post.length).toBe(post2 + 1);
    expect(s.calls.post.at(-1)).toEqual({path: `/v1/tasks/${t2.taskId}/runs`, body: {runId}, status: 201});
    expect(await linksOnServer(s, t2.taskId)).toEqual([runId]);
    root = await open(t2.taskId);
    expect(byData(byId(root, "task-runs")!, "taskRun", runId)).toBeDefined();
    expect(allData(byData(root, "runLinkedFor", runId)!, "runLinkedTask").map(n => n.dataset.runLinkedTask).sort()).toEqual([t1.taskId, t2.taskId].sort()); // both ends agree
    await tick();
  });

  it("with Global Stop active the first link is refused (423), the remaining checked task is not attempted, and nothing is linked on the server", async () => {
    const s = await setup(), {missionId, runId, actions} = await flowToStartedRun(s);
    const detail = await s.ctx.api.missionDetail(missionId), ids = detail.mission.tasks.map((t: any) => t.taskId);
    const root = await view(s), panel = byId(root, "run-link")!;
    for (const id of ids) fire(byData(panel, "runlinkTask", id)!, "change", {target: {checked: true}});
    const stop = await s.app.inject({method: "POST", url: "/v1/control/stop", headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify({reason: "journey test"})});
    expect(stop.statusCode, stop.body).toBe(200);
    const post0 = s.calls.post.length;
    expect(await actions.submitRunLinks(s.ctx, (await s.ctx.api.missionDetail(missionId)).mission)).toEqual({ok: false, posted: 1});
    expect(s.calls.post.length).toBe(post0 + 1); // the batch stopped after the first refusal
    expect(s.calls.post.at(-1)!.status).toBe(423);
    for (const id of ids) expect(await linksOnServer(s, id)).toEqual([]);
    const after = byId(await view(s), "run-link")!;
    expect(allData(after, "runlinkItem").map(n => n.dataset.runlinkState).sort()).toEqual(["NOT_ATTEMPTED", "STOPPED"]);
    expect(text(after)).toContain("the global stop is active");
    expect(byData(after, "runlink", "summary")!.dataset).toMatchObject({linked: "0", notLinked: "2"});
    expect(runId).toMatch(/^run_/);
  });
});

describe("LANE-A A-PREDEV-BUSY-1: one mission-write lock for the pre-dev decisions, the analysis actions and the hand plan", () => {
  const STEP = `/v1/missions/${MSN}/analysis/step`, START = `/v1/missions/${MSN}/predev/start`, ART = "pda_" + "aa".repeat(12);
  const APPROVE = `/v1/missions/${MSN}/predev/artifacts/${ART}/approve`, REJECT = `/v1/missions/${MSN}/predev/artifacts/${ART}/reject`;
  const OK_PREDEV = {status: 200, body: {...predevBody({phase: "REQUIREMENTS"}), replayed: false}};
  const deferred = () => { let res: (v: any) => void = () => {}; const p = new Promise<any>(r => { res = r; }); return {p, res}; };
  const settleMs = (ms = 30) => new Promise(r => setTimeout(r, ms));
  // The lock is shown by the click's OWN repaint, and open() repaints for real: renderJourney() loads the view through vitest's module runner, an IPC round trip to the main
  // process, so a fixed timer can fire before that repaint lands on a loaded runner (CI run 40377419792). Wait for the asserted observable itself (bounded; no manual repaint, no retry), then assert it.
  const until = async (cond: () => boolean, boundMs = 2000) => { const end = Date.now() + boundMs; while (!cond() && Date.now() < end) await settleMs(5); };
  const soon = <T,>(p: Promise<T>): Promise<T | "NOT_REFUSED_IN_TIME"> => Promise.race([p, new Promise<"NOT_REFUSED_IN_TIME">(r => setTimeout(() => r("NOT_REFUSED_IN_TIME"), 300))]); // a call that is not refused would wait for the held POST: fail fast (no timeout is raised)
  async function open(handlers: Record<string, any>, predev: any = DRAFT_PREDEV()) {
    const served = serve({[`/v1/predev/${MSN}`]: predev}), pending: Record<string, number> = {};
    const base = await mkDecisionCtx(served, (p: string) => { pending[p] = (pending[p] ?? 0) + 1; const h = handlers[p]; const a = typeof h === "function" ? h() : h; return a ?? {status: 404, body: {}}; });
    const an = await load("views", "analysis-step.js"); an.resetAnalysis(null);
    const f = await load("forms.js"); for (const id of f.MISSION_WRITE_FORMS) { delete base.forms.drafts.status[id]; base.forms.drafts.busy[id] = false; }
    const b: any = {...base, an, calls: pending, root: await renderJourney(base.ctx)};
    b.ctx.rerender = async () => { b.root = await renderJourney(b.ctx); }; // a real repaint, as in the app
    return b;
  }
  const text = (n: N) => n.textContent, dis = (b: any, id: string) => byId(b.root, id)!.attrs.get("disabled");
  const typeEv = (b: any) => setVal(b.root, "predev-evidence", "ev-1");

  it("the shared predicate names exactly the forms the views use", async () => {
    const f = await load("forms.js"), an = await load("views", "analysis-step.js"), dec = await load("views", "predev-decisions.js"), pf = await load("views", "plan-form.js");
    expect([...f.MISSION_WRITE_FORMS].sort()).toEqual([an.ANALYSIS_STEP_FORM, an.ANALYSIS_PLAN_FORM, an.ANALYSIS_REAPPROVE_FORM, dec.PREDEV_START_FORM, dec.PREDEV_APPROVE_FORM, dec.PREDEV_REJECT_FORM, pf.PLAN_FORM].sort());
    expect(an.analysisBusy).toBe(f.missionWriteBusy);
  });

  it("an in-flight analysis step disables Approve / Reject and refuses their submits (and the reverse); the explanation note shows on both panels", async () => {
    const d = deferred(), b = await open({[STEP]: () => d.p, [APPROVE]: OK_PREDEV, [REJECT]: OK_PREDEV});
    expect(dis(b, "predev-approve-submit")).toBeUndefined();
    fire(byId(b.root, "analysis-step-submit")!, "click"); // analysis step in flight, real repaint
    expect(b.forms.missionWriteBusy()).toBe(true); // the lock is set synchronously by the click
    await settleMs();
    await until(() => dis(b, "predev-approve-submit") !== undefined);
    expect(dis(b, "predev-approve-submit")).toBeDefined(); expect(dis(b, "predev-reject-submit")).toBeDefined(); expect(dis(b, "analysis-step-submit")).toBeDefined();
    expect(byData(byId(b.root, "predev-decisions")!, "predevBusy")).toBeDefined(); expect(text(byData(byId(b.root, "predev-decisions")!, "predevBusy")!)).toContain("Another request that changes mission data is running");
    typeEv(b); b.dec.predevDraft.reason = "no";
    expect(await b.dec.submitApprove(b.ctx, MSN, ART)).toEqual({ok: false, busy: true}); expect(await b.dec.submitReject(b.ctx, MSN, ART)).toEqual({ok: false, busy: true});
    fire(byId(b.root, "predev-approve-submit")!, "click"); await settleMs();
    expect(b.calls[APPROVE] ?? 0).toBe(0); expect(b.calls[REJECT] ?? 0).toBe(0);
    d.res({status: 200, body: {status: "AWAITING_APPROVAL", kind: "BusinessAnalysis", artifactId: ART, artifactState: "DRAFT", next: "FOUNDER_APPROVAL"}}); await settleMs(); await until(() => dis(b, "predev-approve-submit") === undefined);
    expect(dis(b, "predev-approve-submit")).toBeUndefined(); expect(byData(byId(b.root, "predev-decisions")!, "predevBusy")).toBeUndefined();
    // reverse: Approve in flight -> analysis buttons and submits are blocked
    const d2 = deferred(), r = await open({[STEP]: {status: 200, body: {status: "COMPLETE", approved: ["BusinessAnalysis", "Requirements", "Plan", "Architecture"]}}, [APPROVE]: () => d2.p});
    typeEv(r); fire(byId(r.root, "predev-approve-submit")!, "click");
    expect(r.forms.missionWriteBusy()).toBe(true);
    await settleMs();
    await until(() => dis(r, "analysis-step-submit") !== undefined);
    expect(dis(r, "analysis-step-submit")).toBeDefined(); expect(text(byData(byId(r.root, "analysis-step")!, "analysisBusy")!)).toContain("running");
    expect(await r.an.submitAnalysisStep(r.ctx, MSN)).toEqual({ok: false, busy: true}); expect(await r.an.submitReapprove(r.ctx, MSN)).toEqual({ok: false, busy: true}); expect(await r.an.submitAnalysisPlan(r.ctx, MSN)).toEqual({ok: false, busy: true});
    expect(r.calls[STEP] ?? 0).toBe(0);
    d2.res(OK_PREDEV); await settleMs(); await until(() => dis(r, "analysis-step-submit") === undefined); expect(dis(r, "analysis-step-submit")).toBeUndefined();
  });

  it("Start is locked too (an inactive pre-dev record) in both directions", async () => {
    const d = deferred(), b = await open({[STEP]: () => d.p, [START]: OK_PREDEV}, inactivePredev());
    fire(byId(b.root, "analysis-step-submit")!, "click");
    expect(b.forms.missionWriteBusy()).toBe(true);
    await settleMs();
    await until(() => dis(b, "predev-start-submit") !== undefined);
    expect(dis(b, "predev-start-submit")).toBeDefined(); expect(await b.dec.submitStart(b.ctx, MSN)).toEqual({ok: false, busy: true}); expect(b.calls[START] ?? 0).toBe(0);
    d.res({status: 200, body: {status: "BLOCKED", blocker: "X", blockers: ["X"]}}); await settleMs();
    const d2 = deferred(), r = await open({[STEP]: {status: 200, body: {status: "BLOCKED", blocker: "X", blockers: ["X"]}}, [START]: () => d2.p}, inactivePredev());
    fire(byId(r.root, "predev-start-submit")!, "click");
    expect(r.forms.missionWriteBusy()).toBe(true);
    await settleMs();
    await until(() => dis(r, "analysis-step-submit") !== undefined);
    expect(dis(r, "analysis-step-submit")).toBeDefined(); expect(await r.an.submitAnalysisStep(r.ctx, MSN)).toEqual({ok: false, busy: true});
    d2.res(OK_PREDEV); await settleMs();
  });

  it("same-tick double call: one POST, the second is refused as busy (Approve, Reject, Start)", async () => {
    for (const [label, mk] of [["approve", (b: any) => b.dec.submitApprove(b.ctx, MSN, ART)], ["reject", (b: any) => b.dec.submitReject(b.ctx, MSN, ART)]] as const) {
      const d = deferred(), b = await open({[APPROVE]: () => d.p, [REJECT]: () => d.p}); typeEv(b); b.dec.predevDraft.reason = "not good";
      const p1 = mk(b), p2 = mk(b); expect(await soon(p2), label).toEqual({ok: false, busy: true}); d.res(OK_PREDEV); await p1;
      expect(b.calls[label === "approve" ? APPROVE : REJECT], label).toBe(1);
    }
    const d = deferred(), b = await open({[START]: () => d.p}, inactivePredev());
    const p1 = b.dec.submitStart(b.ctx, MSN), p2 = b.dec.submitStart(b.ctx, MSN); expect(await soon(p2)).toEqual({ok: false, busy: true}); d.res(OK_PREDEV); await p1; expect(b.calls[START]).toBe(1);
  });

  it("the lock is released when the pre-POST repaint rejects and when a stale answer is dropped; the note takes focus; a result for another mission is not adopted", async () => {
    // rejecting repaint
    const b = await open({[APPROVE]: OK_PREDEV}); typeEv(b); const orig = b.ctx.rerender; b.ctx.rerender = async () => { throw new Error("REPAINT_FAILED"); };
    await expect(b.dec.submitApprove(b.ctx, MSN, ART)).rejects.toThrow("REPAINT_FAILED");
    const f = await load("forms.js"); expect(f.missionWriteBusy()).toBe(false); expect(b.calls[APPROVE] ?? 0).toBe(0);
    // focus + stale answer
    b.ctx.rerender = orig; const spy: any[] = []; b.ctx.settleFocus = (o: any) => { spy.push(o); return null; };
    const d = deferred(); const b2 = await open({[APPROVE]: () => d.p}); typeEv(b2); b2.ctx.settleFocus = (o: any) => { spy.push(o); return null; };
    const seen: boolean[] = [], r0 = b2.ctx.rerender; b2.ctx.rerender = async () => { seen.push(f.missionWriteBusy()); return r0(); };
    const pending = b2.dec.submitApprove(b2.ctx, MSN, ART);
    expect(b2.forms.missionWriteBusy()).toBe(true);
    await settleMs();
    await until(() => byData(byId(b2.root, "predev-decisions")!, "predevBusy") !== undefined);
    expect(spy).toContainEqual({keys: ["id:predev-in-flight"]}); const note = byData(byId(b2.root, "predev-decisions")!, "predevBusy")!; expect([note.id, note.attrs.get("tabindex")]).toEqual(["predev-in-flight", "-1"]);
    b2.dec.decisionsPanel(b2.ctx, {missionId: MSN2, pre: (await load("journey-core.js")).mapPredev(DRAFT_PREDEV())}); // mission B selected (real reset path) while A's request is in flight
    d.res(OK_PREDEV); const res = await pending;
    expect(res).toMatchObject({ok: false, stale: true}); expect(f.missionWriteBusy()).toBe(false); expect(b2.forms.drafts.status["predev-approve"]).toBeUndefined(); expect(b2.dec.predevDraft.keepStatus).toBe(false); // the dropped answer wrote neither a status nor the keep-status flag
    expect(seen.at(-1)).toBe(false); // released before the stale repaint
  });

  it("the in-flight note is true on every panel and mission: it names no request kind and no mission (the lock is global)", async () => {
    const d = deferred(), b = await open({[APPROVE]: () => d.p}); typeEv(b);
    fire(byId(b.root, "predev-approve-submit")!, "click"); // a pre-dev Approve is in flight
    expect(b.forms.missionWriteBusy()).toBe(true);
    await settleMs();
    await until(() => byData(byId(b.root, "predev-decisions")!, "predevBusy") !== undefined);
    const notes = [byData(byId(b.root, "predev-decisions")!, "predevBusy")!, byData(byId(b.root, "analysis-step")!, "analysisBusy")!, // mission A: both panels
      byData(b.an.analysisPanel(b.ctx, {missionId: MSN2, exec: null}) as N, "analysisBusy")!, // a SECOND mission's analysis panel
      byData(b.dec.decisionsPanel(b.ctx, {missionId: MSN2, pre: (await load("journey-core.js")).mapPredev(DRAFT_PREDEV())}) as N, "predevBusy")!]; // a SECOND mission's decisions panel
    for (const n of notes) { expect(n, "note present").toBeDefined(); expect(text(n)).toContain("Another request that changes mission data is running"); expect(text(n)).not.toMatch(/this mission|analysis request|pre-?dev request|hand plan/i); }
    d.res(OK_PREDEV); await settleMs();
  });

  it("the busy refusal comes before validation: an invalid submit while another request runs is refused as busy and writes no validation status (Approve, analysis Re-approve)", async () => {
    const d = deferred(), b = await open({[STEP]: () => d.p, [APPROVE]: OK_PREDEV});
    fire(byId(b.root, "analysis-step-submit")!, "click"); await settleMs(); // an analysis step is in flight; the evidence field is EMPTY (invalid)
    expect(await soon(b.dec.submitApprove(b.ctx, MSN, ART))).toEqual({ok: false, busy: true}); expect(b.forms.drafts.status["predev-approve"]).toBeUndefined();
    expect(await soon(b.an.submitReapprove(b.ctx, MSN))).toEqual({ok: false, busy: true}); expect(b.forms.drafts.status["analysis-reapprove"]).toBeUndefined();
    d.res({status: 200, body: {status: "BLOCKED", blocker: "X", blockers: ["X"]}}); await settleMs();
  });
});


// //TR: A-FLOW-TASK-1: ilk teslim akışının "plan -> koşu" arasındaki yazması olan GÖREV DURUMU adımı GERÇEK control-api ile uçtan uca doğrulanır: fikir (intake) -> elle plan -> görev durumu denetimi; her POST önce main.mjs'in B5 POST izin listesinden geçer (köprü kapısı), sonra gerçek sunucuya gider. Görünüm DONE'ı açık onay olmadan göndermez, bağımlılığı bitmemiş görevi başlatmaz, Global Stop'ta (423) başarı göstermez ve görev DONE olsa da mission'ı tamamlandı saymaz.
describe("LANE-A A-FLOW-TASK-1: the task status step of the first-delivery flow against the real control-api", () => {
  const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); if (!m) throw new Error(`missing ${name}`); return m[1]; };
  const postAllowed = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn desktopPostPathAllowed;`)() as (v: unknown) => boolean;
  const IDEA = "A small task list web app where one person can add, finish and remove tasks.";
  const body = (r: any) => { try { return r.json(); } catch { return {}; } };
  const text = (n: N) => n.textContent;

  // The bridge is the main-process contract: POST paths must pass the allow-list, GET failures throw like the real bridge.
  async function setup(lang = "en") {
    const app = mkApp(), apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js");
    forms.resetAllForms();
    const doc = new D(), store = st.createStore(null);
    const calls = {post: [] as Array<{path: string; body: any; status: number}>, confirm: [] as any[], refresh: 0, rerender: 0};
    const bridge = {
      apiGet: async (p: string) => { const r = await app.inject({method: "GET", url: p, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json(); },
      apiPost: async (p: string, b: unknown) => {
        if (!postAllowed(p)) throw new Error("INVALID_API_PATH");
        const r = await app.inject({method: "POST", url: p, headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify(b)});
        calls.post.push({path: p, body: b, status: r.statusCode}); return {status: r.statusCode, body: body(r)};
      }
    };
    const api = apiMod.createApi({bridge, store});
    let answer = false;
    const ctx: any = {doc, store, api, i18n: {lang, t: (k: string, v?: any) => i18n.translate(lang, k, v)}, t: (k: string, v?: any) => i18n.translate(lang, k, v), navigate: () => {},
      rerender: async () => { calls.rerender++; store.cache.clear(); }, refreshAll: async () => { calls.refresh++; store.cache.clear(); },
      confirm: async (o: any) => { calls.confirm.push(o); return answer; }, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL", settleFocus: () => {}};
    return {app, ctx, doc, calls, forms, answer: (v: boolean) => { answer = v; }};
  }
  // idea -> project + mission (real POST /v1/intakes), then a three-task hand plan (2 depends on 1) through the real plan form
  async function flowToPlan(s: Awaited<ReturnType<typeof setup>>) {
    const intake = await load("views", "intake.js"), plan = await load("views", "plan-form.js"), ts = await load("views", "task-status.js");
    intake.resetIntakeAll(); ts.resetTaskStatusDraft(null);
    Object.assign(intake.intakeDraft, {idea: IDEA, title: "Task list"});
    expect(await intake.submitIntake(s.ctx)).toEqual({ok: true});
    const missionId: string = intake.intakeUi.last.missionId; s.forms.selection.missionId = missionId;
    plan.resetPlanDraft(missionId); plan.planDraft.rows = [{title: "Add a task", deps: ""}, {title: "Finish a task", deps: "1"}, {title: "Remove a task", deps: ""}];
    expect(await plan.submitPlan(s.ctx, missionId)).toMatchObject({ok: true, status: 201});
    return {missionId, ts};
  }
  async function openTask(s: Awaited<ReturnType<typeof setup>>, ts: any, missionId: string, title: string) {
    const view = await load("views", "work.js"), md = await s.ctx.api.missionDetail(missionId);
    let root: N = await view.render(s.ctx); s.doc.body.replaceChildren(root);
    const t = md.mission.tasks.find((x: any) => x.title === title);
    if (byId(root, "task-status")?.dataset.taskStatus !== t.taskId) { fire(byData(root, "taskInspect", t.taskId)!, "click"); root = await view.render(s.ctx); s.doc.body.replaceChildren(root); } // a second click on the open task would close it
    expect(byId(root, "task-status")!.dataset.taskStatus).toBe(t.taskId);
    return {root, task: t, md, ts};
  }
  const taskOnServer = async (app: App, id: string) => (await getJson(app, `/v1/tasks/${id}`)).task;

  it("walks one task through the real routes: IN_PROGRESS, a cancelled DONE changes nothing, a confirmed DONE unlocks the dependent task, and the mission is not called complete", async () => {
    const s = await setup(), {missionId, ts} = await flowToPlan(s);
    const post0 = s.calls.post.length, refresh0 = s.calls.refresh;
    let o = await openTask(s, ts, missionId, "Add a task");
    expect(allData(o.root, "taskTo").map(n => n.dataset.taskTo)).toEqual(["IN_PROGRESS", "BLOCKED"]); // PENDING offers exactly these two
    expect(s.calls.post.length).toBe(post0); // opening and rendering never write
    // PENDING -> IN_PROGRESS: no confirm, exact body, real server state
    const r1 = await ts.submitTaskTransition(s.ctx, o.md.mission, o.task, "IN_PROGRESS");
    expect(r1).toMatchObject({ok: true, status: 200});
    expect(s.calls.post.at(-1)).toEqual({path: `/v1/tasks/${o.task.taskId}/transition`, body: {to: "IN_PROGRESS", reason: "PENDING -> IN_PROGRESS (UASCO Desktop)"}, status: 200});
    expect(s.calls.confirm).toEqual([]); // only DONE asks
    expect(s.calls.refresh).toBe(refresh0 + 1); // the success refreshed the whole app once
    expect((await taskOnServer(s.app, o.task.taskId)).status).toBe("IN_PROGRESS");
    o = await openTask(s, ts, missionId, "Add a task");
    expect(allData(o.root, "taskTo").map(n => n.dataset.taskTo)).toEqual(["DONE", "BLOCKED", "PENDING"]);
    expect(text(byId(o.root, "task-status")!)).toContain('Task "Add a task" moved to In progress. No run was started.');
    // DONE, confirmation refused: no request, honest status, server unchanged
    s.answer(false); const postN = s.calls.post.length, refreshN = s.calls.refresh;
    expect(await ts.submitTaskTransition(s.ctx, o.md.mission, o.task, "DONE")).toEqual({ok: false, cancelled: true});
    expect(s.calls.post.length).toBe(postN); expect(s.calls.refresh).toBe(refreshN); expect(s.calls.confirm.length).toBe(1);
    expect(s.calls.confirm[0].target).toContain(o.task.taskId);
    expect(text(byId(await (await load("views", "work.js")).render(s.ctx), "task-status")!)).toContain("Action was not confirmed; nothing was changed.");
    expect((await taskOnServer(s.app, o.task.taskId)).status).toBe("IN_PROGRESS");
    // the dependent task cannot start yet: no button, a validation refusal, no request
    const second = await openTask(s, ts, missionId, "Finish a task");
    expect(allData(second.root, "taskTo").map(n => n.dataset.taskTo)).toEqual(["BLOCKED"]);
    expect(text(byId(second.root, "task-status")!)).toContain("must be done before this one can start: Add a task");
    const postV = s.calls.post.length;
    expect(await ts.submitTaskTransition(s.ctx, second.md.mission, second.task, "IN_PROGRESS")).toEqual({ok: false, validation: true});
    expect(s.calls.post.length).toBe(postV);
    // DONE, confirmed: final, and it unlocks the dependent task
    s.answer(true);
    o = await openTask(s, ts, missionId, "Add a task");
    expect(await ts.submitTaskTransition(s.ctx, o.md.mission, o.task, "DONE")).toMatchObject({ok: true, status: 200});
    expect(s.calls.post.at(-1)).toMatchObject({path: `/v1/tasks/${o.task.taskId}/transition`, body: {to: "DONE", reason: "IN_PROGRESS -> DONE (UASCO Desktop)"}, status: 200});
    expect((await taskOnServer(s.app, o.task.taskId)).status).toBe("DONE");
    const done = await openTask(s, ts, missionId, "Add a task");
    expect(allData(done.root, "taskTo")).toEqual([]); expect(text(byId(done.root, "task-status")!)).toContain("This task is done; a done task is not reopened.");
    const unlocked = await openTask(s, ts, missionId, "Finish a task");
    expect(allData(unlocked.root, "taskTo").map(n => n.dataset.taskTo)).toEqual(["IN_PROGRESS", "BLOCKED"]);
    // a done task is not a complete mission, and no verification is claimed
    const m = (await getJson(s.app, `/v1/missions/${missionId}`)).mission;
    expect(m.status).not.toBe("COMPLETE");
    expect(surface(unlocked.root)).not.toMatch(/PRODUCT_VERIFIED|spill-product_verified/);
    expect(text(unlocked.root)).not.toMatch(/mission (is )?complete/i);
  });

  it("BLOCKED needs a reason, and with Global Stop active the server refuses (423): the view shows a failure and keeps the old status", async () => {
    const s = await setup(), {missionId, ts} = await flowToPlan(s);
    const o = await openTask(s, ts, missionId, "Remove a task");
    const post0 = s.calls.post.length;
    expect(await ts.submitTaskTransition(s.ctx, o.md.mission, o.task, "BLOCKED")).toEqual({ok: false, validation: true}); // empty reason
    expect(s.calls.post.length).toBe(post0);
    ts.taskStatusDraft.reason = "waiting for the design";
    expect(await ts.submitTaskTransition(s.ctx, o.md.mission, o.task, "BLOCKED")).toMatchObject({ok: true, status: 200});
    expect(s.calls.post.at(-1)!.body).toEqual({to: "BLOCKED", reason: "waiting for the design"});
    expect((await taskOnServer(s.app, o.task.taskId)).status).toBe("BLOCKED");
    // Global Stop: the write is refused by the server and the view must not report success
    const stop = await s.app.inject({method: "POST", url: "/v1/control/stop", headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify({reason: "journey test"})});
    expect(stop.statusCode, stop.body).toBe(200);
    const blocked = await openTask(s, ts, missionId, "Remove a task");
    expect(allData(blocked.root, "taskTo").map(n => n.dataset.taskTo)).toEqual(["PENDING"]);
    const refresh0 = s.calls.refresh;
    const res = await ts.submitTaskTransition(s.ctx, blocked.md.mission, blocked.task, "PENDING");
    expect(res).toMatchObject({ok: false, status: 423});
    expect(s.calls.post.at(-1)).toMatchObject({status: 423});
    expect((await taskOnServer(s.app, o.task.taskId)).status).toBe("BLOCKED"); // unchanged
    const rendered = await (await load("views", "work.js")).render(s.ctx);
    expect(byId(rendered, "task-status-status")!.dataset.result).toBe("error"); // the view shows a failure
    expect(text(byId(rendered, "task-status")!)).not.toContain("moved to Pending");
    expect(s.calls.refresh).toBe(refresh0 + 1);
  });
});

// //TR: A-UI011-EVIDENCE-1 (yalnız kanıt + test, yeni özellik yok): COORD protected batch 4b (#242) analiz ve ürün-çalıştırma rotalarını server.ts'e kaydetti ve main.mjs'de izinledi. Bu blok masaüstü render katmanının (GERÇEK görünümler + GERÇEK api.js + main.mjs izin listesi ve hata gövdesi temizleyici) bu rotalara GERÇEK bir control-api üzerinden ulaştığını Linux'ta kanıtlar. ÜCRETLİ Claude çağrısı YAPILMAZ: LOCAL_CLAUDE hiçbir zaman etkinleştirilmez (yalnız ücretsiz BLOCKED/409 durumları); gerçek bir analiz, Windows ve gerçek Electron çalıştırılmaz (NOT_EXECUTED).
describe("LANE-A A-UI011-EVIDENCE-1: the analysis step and the run-the-product step against the REAL control-api (free states only, LOCAL_CLAUDE stays off)", () => {
  const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); if (!m) throw new Error(`missing ${name}`); return m[1]; };
  const postGates = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};
  const postAllowed = postGates.desktopPostPathAllowed;
  const getAllowed = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
  // apps/desktop/main.mjs:321 admits a GET when desktopGetPathAllowed (automation/lib/control-boundary.mjs) OR desktopExtraGetPathAllowed holds
  let baseGetAllowed: (v: unknown) => boolean = () => false;
  // main.mjs's own error-body scrubber, exactly as the desktop bridge applies it before the renderer sees a POST answer
  const scrubFrom = mainSrc.indexOf("function scrubText("), scrubTo = mainSrc.indexOf("async function apiPost(");
  if (scrubFrom < 0) throw new Error("missing function scrubText("); if (scrubTo < 0) throw new Error("missing async function apiPost(");
  const scrubSrc = mainSrc.slice(scrubFrom, scrubTo);
  const sanitizePostBody = new Function("token", `${scrubSrc}\nreturn sanitizePostBody;`)(TOKEN) as (status: number, parsed: unknown) => unknown;
  const text = (n: N) => n.textContent;
  const tick = () => new Promise(r => setTimeout(r, 0));

  // //TR: Sunucu ana makinenin ortamından UASCO_WORKOS_EXECUTOR / UASCO_WORKOS_RUNNER / UASCO_CONTROL_ROOT okur; bu blok bunları siler (afterEach'te geri koyar), controlRoot'u geçici dizine ve runner'ı kapalıya sabitler ve checkout içindeki claude-profiles'a hiçbir şey yazılmadığını sabitler.
  const ENV_KEYS = ["UASCO_WORKOS_EXECUTOR", "UASCO_WORKOS_RUNNER", "UASCO_CONTROL_ROOT"];
  const savedEnv: Record<string, string | undefined> = {};
  const checkoutProfiles = () => { const p = path.join(process.cwd(), "claude-profiles"); return fs.existsSync(p) ? fs.readdirSync(p, {recursive: true}).map(String).sort() : null; };
  let profilesBefore: string[] | null = null;
  const controlRoot = () => path.join(tmp, "control");
  beforeEach(async () => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    profilesBefore = checkoutProfiles();
    baseGetAllowed = (await import("../automation/lib/control-boundary.mjs")).desktopGetPathAllowed as (v: unknown) => boolean;
  });
  afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

  async function setup(executors?: unknown) {
    fs.mkdirSync(runtime(), {recursive: true}); fs.mkdirSync(controlRoot(), {recursive: true});
    const store = new WorkOsStore(dataDir()), scope = {tenantId: "tA"};
    const project = store.createProject({tenantId: "tA", orgId: "org1", name: "Evidence", environmentId: "env-dev", createdBy: RECORDER});
    const open = store.createMission({tenantId: "tA", projectId: project.projectId, title: "Open mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
    const exec = store.createMission({tenantId: "tA", projectId: project.projectId, title: "Executing mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R0", createdBy: RECORDER});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, exec.missionId, to, to, RECORDER);
    const run = store.createRun({tenantId: "tA", missionId: exec.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: RECORDER});
    const app = buildServer({controlToken: TOKEN, runtime: runtime(), dataDir: dataDir(), tenantId: "tA", port: 3210, logger: false, controlRoot: controlRoot(), runner: {enabled: false}, ...(executors ? {executors: executors as never} : {})}); apps.push(app);
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js");
    forms.resetAllForms();
    const doc = new D(), cache = st.createStore(null);
    const calls = {post: [] as Array<{path: string; status: number; wire: any; seen: any}>, confirm: [] as any[], get: [] as string[]};
    const bridge = {
      apiGet: async (p: string) => { calls.get.push(p); if (!baseGetAllowed(p) && !getAllowed(p)) throw new Error("INVALID_API_PATH"); const r = await app.inject({method: "GET", url: p, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json(); },
      apiPost: async (p: string, b: unknown) => {
        if (!postAllowed(p)) throw new Error("INVALID_API_PATH");
        const prepared = postGates.desktopPostBodyCheck(b); if (!prepared.ok) throw new Error(prepared.error);
        const r = await app.inject({method: "POST", url: p, headers: {...hdr, "content-type": "application/json"}, payload: prepared.text});
        let wire: any = null; try { wire = r.json(); } catch { /* non-json */ }
        const seen = sanitizePostBody(r.statusCode, wire);
        calls.post.push({path: p, status: r.statusCode, wire, seen}); return {status: r.statusCode, body: seen};
      }
    };
    const api = apiMod.createApi({bridge, store: cache});
    const t = (k: string, v?: any) => i18n.translate("en", k, v);
    const ctx: any = {doc, store: cache, api, i18n: {lang: "en", t}, t, navigate: () => {}, rerender: async () => { cache.clear?.(); cache.cache?.clear?.(); }, refreshAll: async () => { cache.cache?.clear?.(); },
      confirm: async (o: any) => { calls.confirm.push(o); return true; }, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL", settleFocus: () => {}};
    const executorsOf = async () => getJson(app, "/v1/system/executors");
    return {app, ctx, doc, calls, forms, project, open, exec, run, executorsOf, profilesBefore: profilesBefore, controlRoot: controlRoot()};
  }

  const blockerCodes = (root: N) => allData(root, "analysisBlocker").map(n => n.dataset.analysisBlocker);
  async function analyseOnce(s: Awaited<ReturnType<typeof setup>>, missionId: string) {
    const an = await load("views", "analysis-step.js");
    an.resetAnalysis(missionId);
    const result = await an.submitAnalysisStep(s.ctx, missionId);
    const panel = an.analysisPanel(s.ctx, {missionId, exec: await s.ctx.api.executors()}) as N;
    s.doc.body.replaceChildren(panel);
    return {an, result, panel, post: s.calls.post.at(-1)!};
  }
  // The free BLOCKED answer: the same renderer state whether no executor is configured at all or an executor pair without a pre-development builder is installed (both give the route NO_ANALYSIS_BUILDER).
  function expectFreeBlocked(s: Awaited<ReturnType<typeof setup>>, r: Awaited<ReturnType<typeof analyseOnce>>, missionId: string) {
    expect(r.post.path).toBe(`/v1/missions/${missionId}/analysis/step`);
    expect(r.post.status).toBe(200);
    expect(r.post.wire.status).toBe("BLOCKED");
    expect(Array.isArray(r.post.wire.blockers) && r.post.wire.blockers.length >= 1).toBe(true);
    expect(r.post.wire.blockers.at(-1)).toBe("EXECUTOR_NOT_ENABLED"); // the route appends this when there is no builder, whatever else the machine reports
    expect(r.post.wire.blocker).toBe(r.post.wire.blockers[0]);
    expect(r.result).toEqual({ok: false, kind: "STEP", status: 200});
    expect(byData(r.panel, "analysisStatus", "BLOCKED")).toBeDefined();
    expect(blockerCodes(r.panel)).toEqual(r.post.wire.blockers);
    expect(text(r.panel)).toContain("Blocked: the analysis cannot start until these are fixed. Nothing was produced or recorded.");
    expect(text(r.panel)).not.toContain("not enabled in this build");
    expect(byId(r.panel, "analysis-plan-submit")).toBeUndefined(); // Create plan stays closed
    expect(byData(r.panel, "analysisPlanGate", "CLOSED")).toBeDefined();
    expect(text(byData(r.panel, "analysisHandPlan")!)).toContain("write the plan by hand in Tasks"); // the free way out
  }
  async function expectLocalClaudeStillOff(s: Awaited<ReturnType<typeof setup>>, before: any) {
    const after = await s.executorsOf();
    expect(after.executors.LOCAL_CLAUDE.enabled).toBe(false);
    expect(after.active).toEqual(before.active); // the active executor did not change
    expect(s.calls.post.map(x => x.path).filter(p => p.includes("/executors/"))).toEqual([]); // the enable route is never called
    expect(s.calls.post.every(x => x.status !== 201)).toBe(true);
    // the runner stayed off: the QUEUED run created by setup was never leased, and nothing was written under the checkout
    expect((await getJson(s.app, `/v1/work-runs/${s.run.runId}`)).run.status).toBe("QUEUED");
    expect(checkoutProfiles()).toEqual(s.profilesBefore);
  }
  // LOCAL_CLAUDE is off BEFORE the step under test runs; the returned snapshot is what expectLocalClaudeStillOff compares against
  async function localClaudeOffBefore(s: Awaited<ReturnType<typeof setup>>) {
    const before = await s.executorsOf();
    expect(before.executors.LOCAL_CLAUDE.enabled).toBe(false);
    return before;
  }

  it("NO_ANALYSIS_BUILDER, no executor configured and LOCAL_CLAUDE disabled: the real route answers a FREE 200 BLOCKED and the view shows the exact blockers; nothing is produced, LOCAL_CLAUDE stays off", async () => {
    const s = await setup();
    const before = await s.executorsOf();
    expect(before.executors.LOCAL_CLAUDE.enabled).toBe(false);
    expect(before.active).toEqual({reason: "EXECUTOR_NOT_CONFIGURED"});
    const r = await analyseOnce(s, s.open.missionId);
    expectFreeBlocked(s, r, s.open.missionId);
    // The desktop bridge's own scrubber leaves the code-only blockers untouched but REALLY rewrites the host path the server puts in readiness.profiles.*.loginCommand (main.mjs scrubText -> "[path]"): seen differs from wire.
    expect(r.post.seen.blockers).toEqual(r.post.wire.blockers);
    const wireLogin = r.post.wire.readiness.profiles.implementer.loginCommand as string, seenLogin = r.post.seen.readiness.profiles.implementer.loginCommand as string;
    expect(wireLogin).toContain(s.controlRoot);
    expect(seenLogin).not.toContain(s.controlRoot);
    expect(seenLogin).toContain("[path]");
    expect(r.post.seen).not.toEqual(r.post.wire);
    // FINDING F1 (fixed by #286): analysis.blocker.EXECUTOR_NOT_ENABLED now exists, so the last blocker shows its translated text and no "not recognised" note.
    const last = allData(r.panel, "analysisBlocker").at(-1)!;
    expect(last.dataset.analysisBlocker).toBe("EXECUTOR_NOT_ENABLED");
    expect(text(last)).toContain("Local Claude is not enabled, so no draft can be produced. Open Settings, then AI Executors, and enable Local Claude.");
    expect(text(last)).not.toContain("not recognised");
    expect(allData(r.panel, "analysisBlocker").length).toBe(r.post.wire.blockers.length);
    await expectLocalClaudeStillOff(s, before);
    const pd = (await getJson(s.app, `/v1/predev/${s.open.missionId}`)).predev; // nothing was recorded by the free BLOCKED step
    expect([pd.active, pd.phase, pd.preDevId]).toEqual([false, "NOT_STARTED", null]);
    expect(Object.values(pd.artifacts as Record<string, any>).every((x: any) => x.state === "NOT_STARTED" && x.artifactId === null)).toBe(true);
  });

  it("NO_ANALYSIS_BUILDER with an installed executor pair that has no pre-development builder (the fake pair): the same free BLOCKED, the active executor is the pair, LOCAL_CLAUDE stays off", async () => {
    const {FakeExecutors} = await import("../core/workos/executors.js");
    const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "x\n"}, message: "fake"}), review: () => ({verdict: "CLEAN"})});
    const s = await setup(fake.pair());
    const before = await s.executorsOf();
    expect(before.executors.LOCAL_CLAUDE.enabled).toBe(false);
    expect(before.active.reason).not.toBe("EXECUTOR_NOT_CONFIGURED");
    expect(before.active.reason).not.toBe("LOCAL_CLAUDE");
    const r = await analyseOnce(s, s.open.missionId);
    expectFreeBlocked(s, r, s.open.missionId);
    await expectLocalClaudeStillOff(s, before);
  });

  it("the analysis plan route is reached with the exact refusal: Create plan before COMPLETE is a 409 ANALYSIS_NOT_COMPLETE the view classifies as a refusal; a mission that is no longer open for pre-development is a 409 WORKOS_CONFLICT (FINDING F2, fixed by #286: shown as its own CONFLICT text)", async () => {
    const s = await setup();
    const before = await localClaudeOffBefore(s);
    const core = await load("analysis-core.js");
    const pres = await s.ctx.api.post(core.analysisPlanPath(s.open.missionId), {});
    expect(pres).toEqual({ok: false, status: 409, body: {error: "ANALYSIS_NOT_COMPLETE"}});
    expect(core.classifyAnalysisPlan(pres)).toEqual({kind: "REFUSED", code: "ANALYSIS_NOT_COMPLETE"});
    expect(core.analysisStatusKey(core.classifyAnalysisPlan(pres), pres, "plan")).toEqual({ok: false, key: "analysis.plan.refused", vars: {code: "ANALYSIS_NOT_COMPLETE"}});
    // An unknown mission id is a 404 from the route (WORKOS_NOT_FOUND), classified as not found.
    const nf = await s.ctx.api.post(core.analysisStepPath("msn_" + "0".repeat(24)), {});
    expect(nf.status).toBe(404); expect(core.classifyAnalysisStep(nf).kind).toBe("NOT_FOUND");
    // FINDING F2 (fixed by #286): the route says WHY (reason MISSION_NOT_PREDEV_ELIGIBLE), the bridge keeps it, and classifyAnalysisStep now returns CONFLICT with that reason, so the view shows its own text (no idempotency wording).
    const an = await load("views", "analysis-step.js");
    an.resetAnalysis(s.exec.missionId);
    const r = await an.submitAnalysisStep(s.ctx, s.exec.missionId);
    const post = s.calls.post.at(-1)!;
    expect(post.status).toBe(409); expect(post.seen).toEqual({error: "WORKOS_CONFLICT", reason: "MISSION_NOT_PREDEV_ELIGIBLE"});
    expect(r).toMatchObject({ok: false, kind: "CONFLICT", status: 409});
    s.doc.body.replaceChildren(an.analysisPanel(s.ctx, {missionId: s.exec.missionId, exec: null}) as N);
    expect(text(byId(s.doc.body, "analysis-step-status")!)).toBe("This mission is no longer open for the pre-development analysis (for example a run has already started). Nothing was recorded.");
    await expectLocalClaudeStillOff(s, before);
  });

  it("run-the-product on a run that has no product: the real GET shape is accepted, the card offers neither start nor stop, Start (called directly) is the exact 409 PRODUCT_RUN_NOT_DELIVERABLE with reason NOT_STARTED:QUEUED, Stop is an idempotent 200, and LOCAL_CLAUDE stays off", async () => {
    const s = await setup();
    const before = await localClaudeOffBefore(s);
    const pc = await load("views", "product-card.js"), core = await load("project-core.js");
    // the desktop allow-lists admit exactly these paths
    expect(getAllowed(core.runProductPath(s.run.runId))).toBe(true);
    for (const a of ["start", "stop"]) expect(postAllowed(`/v1/work-runs/${s.run.runId}/product/${a}`)).toBe(true);
    expect(getAllowed(core.runProductPath(s.run.runId) + "?x=1")).toBe(false);
    // real GET -> renderer mapper (no mock of the route)
    const prod = await s.ctx.api.runProduct(s.run.runId);
    expect(prod.state).toBe("VERIFIED");
    expect(prod.product).toMatchObject({runId: s.run.runId, deliveredHeadSha: null, tiedToThisRun: false, deliverable: null});
    expect(prod.product.run).toMatchObject({status: "STOPPED", deliveryRunId: null, reason: null});
    // the card for that run
    const project = (await s.ctx.api.projects()).items[0], runs = (await s.ctx.api.workRuns({missionId: s.exec.missionId})).items;
    const card = await pc.productCard(s.ctx, project, runs.find((r: any) => r.runId === s.run.runId)); s.doc.body.replaceChildren(card);
    expect([card.dataset.productState, card.dataset.productOffer, card.dataset.productRun]).toEqual(["STOPPED", "NONE", s.run.runId]);
    expect(byId(card, "product-start")).toBeUndefined(); expect(byId(card, "product-stop")).toBeUndefined();
    expect(byData(card, "productCommit", "NONE")).toBeDefined();
    expect(text(byData(card, "productDelivery", "NOT_DELIVERABLE")!)).toBe("This run cannot be started as a product: its source generation is not complete or it has no delivered commit (NOT_STARTED). Nothing is started from here.");
    // Start, driven directly through the real route and the real bridge scrubber: the exact refusal and its reason
    const started = await pc.productAction(s.ctx, project, s.run.runId, "start");
    expect(started).toEqual({ok: false, status: 409});
    const startPost = s.calls.post.at(-1)!;
    expect(startPost.path).toBe(`/v1/work-runs/${s.run.runId}/product/start`);
    expect(startPost.seen).toEqual({error: "PRODUCT_RUN_NOT_DELIVERABLE", reason: "NOT_STARTED:QUEUED"});
    expect(s.forms.drafts.status["product-run"]).toEqual({ok: false, key: "post.err.409.PRODUCT_RUN_NOT_DELIVERABLE", vars: {status: 409, reason: "NOT_STARTED:QUEUED"}, errors: null});
    expect(s.ctx.t("post.err.409.PRODUCT_RUN_NOT_DELIVERABLE", {reason: "NOT_STARTED:QUEUED"})).toBe("Refused (PRODUCT_RUN_NOT_DELIVERABLE, reason NOT_STARTED:QUEUED): this run has no delivered source commit, so there is no product to start.");
    expect(s.calls.confirm).toHaveLength(1); // the Founder confirmed the start; the server still refused
    // Stop: idempotent 200, nothing was running
    const stopped = await pc.productAction(s.ctx, project, s.run.runId, "stop");
    expect(stopped).toEqual({ok: true, status: 200});
    expect(s.forms.drafts.status["product-run"]).toEqual({ok: true, key: "product.done.stop", vars: {}, errors: null});
    expect(s.calls.post.at(-1)!.seen.product).toMatchObject({runId: s.run.runId, tiedToThisRun: false, devrun: {status: "STOPPED"}});
    expect((await getJson(s.app, `/v1/projects/${s.project.projectId}/devrun`)).devrun.status).toBe("STOPPED"); // no dev-run was started
    await expectLocalClaudeStillOff(s, before);
  });

  it("the bad-shape and bad-state edges of the product routes also reach the view honestly: unknown run is a 404 the card does not turn into a product; a malformed run id never reaches the server", async () => {
    const s = await setup();
    const before = await localClaudeOffBefore(s);
    const pc = await load("views", "product-card.js"), core = await load("project-core.js");
    expect(core.runProductPath("run_zz")).toBeNull();
    expect(core.buildProductRequest({runId: "run_zz", action: "start"}).ok).toBe(false);
    const project = (await s.ctx.api.projects()).items[0];
    const bad = await pc.productAction(s.ctx, project, "run_zz", "start");
    expect(bad).toEqual({ok: false, validation: true});
    expect(s.calls.post).toEqual([]); // nothing was sent
    const ghost = "run_" + "0".repeat(24);
    const res = await s.ctx.api.post(`/v1/work-runs/${ghost}/product/stop`, {});
    expect(res).toEqual({ok: false, status: 404, body: {error: "RUN_NOT_FOUND"}});
    expect((await s.ctx.api.runProduct(ghost)).state).not.toBe("VERIFIED");
    await expectLocalClaudeStillOff(s, before);
  });
});
