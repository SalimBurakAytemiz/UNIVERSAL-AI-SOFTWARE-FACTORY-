// //TR: Bu test FA-V2-PRODUCT UI-205 "Çoklu Proje Komuta Matrisi" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek tohumlanmış Work OS verisinden (birden çok proje, mission, koşu, kanıt, bağımsız inceleme kararları, gerçek git) dönen GET /v1/projects + /v1/missions + /v1/work-runs + /v1/cockpit gövdeleri saf eşleyicilerden (matrix-core.js) ve görünümden (views/matrix.js) geçer; (2) yalnız zaten izinli dört salt-okunur GET kullanılır (yeni uç nokta yok, EXTRA_GET_ROUTES kümesi değişmez, korumalı dosyalara dokunulmaz); (3) eşleyiciler fail-closed'dır (tek bozuk kayıt tüm okumayı ERROR yapar); (4) matris DÜRÜSTTÜR: proje durumu sağlık iddiası değildir, hiçbir projeye gerçek kanıt olmadan doğrulanmış/yeşil durum verilmez, okunamayan kaynağın sayıları 0 değil "—" olur, inceleme kararı AYNEN gösterilir, teslim NOT_VERIFIED kalır, ürün doğrulaması asla gösterilmez; (5) erişilebilirlik; (6) EN/TR sözlük eşitliği; (7) rota devri (app.js VIEWS değişmez).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {T, setup, okScript, runner, api as relfxApi, HDR as RELFX_HDR, tmpRoot, rmTmp} from "./support/relfx.js";
import {moduleSpecifiers} from "./support/static-imports.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (posture/readiness testleri ile aynı desen) ----------------
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
const byData = (r: N, k: string, v?: string) => all(r).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const allData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const byId = (r: N, id: string) => all(r).find(n => n.id === id);
const cls = (n: N, c: string) => n.className.split(/\s+/).includes(c);
// Bütün render edilmiş metin + öznitelik/dataset değerleri (yasak sabit taraması için).
const surface = (r: N) => all(r).map(n => `${n.textContent}|${n.className}|${[...n.attrs.values()].join(",")}|${Object.values(n.dataset).join(",")}`).join("\n");
const pills = (r: N) => allData(r, "pill").map(n => n.dataset.pill);
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `matrix-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const rowsOf = (r: N) => allData(r, "matrixRow").filter(n => n.tagName === "TR");
const rowFor = (r: N, pid: string) => rowsOf(r).find(n => n.dataset.matrixRow === pid)!;
const cell = (row: N, col: string) => all(row).find(n => (n.tagName === "TD" || n.tagName === "TH") && n.dataset.col === col)!;
const groupsOf = (r: N) => allData(r, "matrixGroup").filter(n => n.tagName === "TBODY");
const sourcesOf = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const signalsOf = (row: N) => allData(cell(row, "status"), "signal").map(n => [n.dataset.signal, n.dataset.n]);
/** "healthy"/"all clear" yalnız dürüstlük/boş/eksik notlarında (olumsuzlama olarak) geçebilir; hiçbir satır ya da gösterge bunu iddia etmez. */
const healthyClaims = (r: N) => all(r).filter(n => /healthy|all clear/i.test(n._text) && n.dataset.honesty === undefined && n.dataset.matrixPartial === undefined && n.dataset.matrixEmpty === undefined);
const click = (n: N) => { const fns = n.ls.get("click"); expect(fns, "click listener").toBeTruthy(); fns!.forEach(f => f({})); };

async function mkCtx(getFn: (p: string) => any, lang = "en", post?: (p: string, b: unknown) => any) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [], picks: string[] = [];
  const bridge: Record<string, unknown> = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  if (post) bridge.apiPost = async (p: string, b: unknown) => post(p, b);
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { nav.push(id); }, selectProject: (id: string) => { picks.push(id); }, rerender: async () => {}, settleFocus: () => {}};
  return {ctx, doc, calls, nav, picks};
}
const fail = (p: string, status = 404) => { throw new Error(`${p}: HTTP ${status}`); };
async function renderView(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "matrix.js");
  const m = await mkCtx(getFn, lang);
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, ...m};
}

// ---------------- fixtures (sözleşme biçiminde; yönetim özeti testleri ile aynı sözleşme) ----------------
const PID = (c: string) => "prj_" + c.repeat(12);
const MID = (c: string) => "msn_" + c.repeat(12);
const RID = (c: string) => "run_" + c.repeat(12);
const PA = PID("aa"), PB = PID("bb"), PC = PID("cc"), PD = PID("dd"), PE = PID("ee");
const MA1 = MID("a1"), MA2 = MID("a2"), MB1 = MID("b1"), MC1 = MID("c1"), ME1 = MID("e1");
const RA1 = RID("a1"), RA2 = RID("a2"), RB1 = RID("b1"), RC1 = RID("c1"), RE1 = RID("e1");
const sha = (c: string) => c.repeat(40);
const T0 = "2026-10-16T02:00:00.000Z";
const projectRow = (projectId: string, name: string, over: Record<string, any> = {}) => ({projectId, orgId: "org1", tenantId: "tA", name, environmentId: "env-dev", createdAt: "2026-10-01T00:00:00.000Z", createdBy: "x", repository: {path: "/secret/repo/path"}, ...over});
const PROJECTS = {projects: [projectRow(PD, "Delta Docs"), projectRow(PE, "Epsilon Done"), projectRow(PC, "Gamma Tool"), projectRow(PB, "Beta Service"), projectRow(PA, "Alpha Platform")]};
const missionRow = (missionId: string, projectId: string, status: string, createdAt: string, over: Record<string, any> = {}) => ({missionId, projectId, tenantId: "tA", title: `Mission ${missionId.slice(4, 8)}`, objective: "o", acceptanceCriteria: ["ac"], status, riskLevel: "R1", createdAt, createdBy: "x", traceId: "trc_" + "aa".repeat(12), ...over});
const MISSIONS = {missions: [
  missionRow(MA1, PA, "EXECUTING", "2026-10-16T01:00:00.000Z"), missionRow(MA2, PA, "PREFLIGHT", "2026-10-16T02:00:00.000Z"),
  missionRow(MB1, PB, "BLOCKED", "2026-10-15T01:00:00.000Z"), missionRow(MC1, PC, "EXECUTING", "2026-10-14T01:00:00.000Z"), missionRow(ME1, PE, "COMPLETE", "2026-10-10T01:00:00.000Z")]};
const ev = (kind: string, cycle: number, over: Record<string, any> = {}) => ({evidenceId: "evd_" + kind.toLowerCase() + cycle, step: "IMPLEMENT", cycle, kind, argv: [], startedAt: T0, endedAt: "2026-10-16T02:00:01.000Z", exitCode: 0, logPath: null, logSha256: null, ...over});
const CLEAN_EV = (c: string) => [ev("IMPLEMENT", 1, {commitSha: sha(c)}), ev("REVIEW", 1, {step: "REVIEW", commitSha: sha(c), reviewerIdentity: "REV-1", verdict: "CLEAN"})];
const runRow = (runId: string, missionId: string, projectId: string, over: Record<string, any> = {}) => ({runId, missionId, projectId, tenantId: "tA", roleId: null, executor: {implementer: "IMPL", reviewer: "REV"}, leaseId: null, leaseExpiresAt: null, attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 1, retryCount: 0, retryAt: null, reason: null,
  baseSha: sha("b"), headSha: sha("c"), workBranch: "b", checkpoints: [], evidence: CLEAN_EV("c"), createdAt: T0, createdBy: "x", updatedAt: "2026-10-16T03:00:00.000Z", ...over});
const artifact = (runId: string, missionId: string) => ({runId, missionId, sourceCommit: sha("c"), treeSha: sha("d"), exportArtifactHash: "f".repeat(64), artifactPath: `deliveries/${runId}/${"f".repeat(64)}.zip`});
const accepted = (runId: string, missionId: string) => ({runId, missionId, sourceCommit: sha("c"), exportArtifactHash: "f".repeat(64), acknowledgements: {notExecuted: {acknowledgeNotExecuted: true}}, acceptedAt: "2026-10-16T03:30:00.000Z"});
// PA: RUNNING (kanıt yok) + AWAITING_APPROVAL (CLEAN, güncel head, kabul edilmiş kaynak teslimi). PB: FAILED + BLOCKED inceleme. PC: RUNNING. PE: SUCCEEDED + CLEAN + kabul edilmiş teslim + tamamlanma kaydı (API ürün doğrulaması alanını TAŞIR; görünüm asla göstermez).
const RUNS = {runs: [
  runRow(RA1, MA1, PA, {status: "RUNNING", step: "IMPLEMENT", remediationCycle: 0, headSha: null, evidence: [], updatedAt: "2026-10-16T06:00:00.000Z"}),
  runRow(RA2, MA1, PA, {updatedAt: "2026-10-16T05:00:00.000Z", deliveryArtifact: artifact(RA2, MA1), sourceDelivery: accepted(RA2, MA1)}),
  runRow(RB1, MB1, PB, {status: "FAILED", step: "REVIEW", reason: "REVIEW_BLOCKED", headSha: sha("e"), evidence: [ev("IMPLEMENT", 0, {commitSha: sha("e")}), ev("REVIEW", 0, {step: "REVIEW", commitSha: sha("e"), reviewerIdentity: "REV-2", verdict: "BLOCKED"})], updatedAt: "2026-10-16T04:00:00.000Z"}),
  runRow(RC1, MC1, PC, {status: "RUNNING", step: "IMPLEMENT", remediationCycle: 0, headSha: null, evidence: [], updatedAt: "2026-10-16T03:00:00.000Z"}),
  runRow(RE1, ME1, PE, {status: "SUCCEEDED", step: "REPORT", updatedAt: "2026-10-10T05:00:00.000Z", deliveryArtifact: artifact(RE1, ME1), sourceDelivery: accepted(RE1, ME1), completion: {headSha: sha("c"), productVerification: {status: FORBIDDEN, note: "server-side record"}}})]};
const cockpitBody = (over: Record<string, any> = {}) => ({generatedAt: "2026-10-16T06:00:00.000Z", globalStop: {active: false, reason: null},
  projects: {state: "VERIFIED", count: 5}, missions: {state: "VERIFIED", total: 5, byStatus: {EXECUTING: 2, PREFLIGHT: 1, BLOCKED: 1, COMPLETE: 1}},
  awaitingApproval: {state: "VERIFIED", items: [{missionId: MA2, projectId: PA, title: "Mission a2a2", riskLevel: "R1"}]},
  orchestrator: {state: "VERIFIED", asOf: "2026-10-16T05:30:00.000Z", packages: {total: 4, byStatus: {MERGED: 3, QUEUED: 1}}, source: "ORCHESTRATOR_STATE"},
  workforce: {state: "VERIFIED", registeredRoles: 363, registeredRolesAuthority: "LEGACY_REFERENCE_ONLY", canonicalRegisteredRoles: 255, targetRoles: 255, activeWorkerRuns: 2, source: "x"},
  legacy: {scheduler: {authority: false, note: "LEGACY_SNAPSHOT"}}, evidence: {state: "VERIFIED", total: 10, verified: 8, mismatch: 1, missing: 1, unverifiable: 0, sources: {workos: "AVAILABLE"}}, ...over});
const FOUR = ["/v1/cockpit", "/v1/missions", "/v1/projects", "/v1/work-runs"];
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/projects": PROJECTS, "/v1/missions": MISSIONS, "/v1/work-runs": RUNS, "/v1/cockpit": cockpitBody(), ...over};
  if (!(p in m)) return fail(p);
  const v = m[p];
  return typeof v === "function" ? v(p) : v; // işlev geçersiz kılma: okuma hatası (throw) benzetimi
};
const down = (status = 500) => () => fail("x", status);
/** Dört okumayı gerçek eşleyicilerden geçirip matrisi üretir. res geçersiz kılmaları: okunamayan kaynak {state}. */
async function assess(o: {projects?: any; missions?: any; runs?: any; cockpit?: any; res?: Record<string, any>} = {}) {
  const core = await load("matrix-core.js");
  const res = {projects: core.mapMatrixProjects(o.projects ?? PROJECTS), missions: core.mapMatrixMissions(o.missions ?? MISSIONS), workRuns: core.mapMatrixWorkRuns(o.runs ?? RUNS), cockpit: core.mapMatrixCockpit(o.cockpit ?? cockpitBody()), ...(o.res ?? {})};
  return {core, res, out: core.buildMatrix(res)};
}
const rowOf = (out: any, pid: string) => out.rows.find((r: any) => r.projectId === pid);
/** Hiçbir projeye gerçek kanıt olmadan doğrulanmış/yeşil/sağlıklı durum verilmez; başarı rozeti yalnız güncel head'e bağlı CLEAN inceleme hücresinde olabilir. */
function expectNoGreen(rootNode: N, label: string) {
  expect(surface(rootNode), label).not.toContain(FORBIDDEN);
  let doneInRows = 0, cleanAtHead = 0;
  for (const row of rowsOf(rootNode)) {
    expect(["ATTENTION_NEEDED", "UNKNOWN", "ACTIVE", "IDLE", "NO_ACTIVITY"], label).toContain(row.dataset.status);
    const st = cell(row, "status");
    expect(pills(st), label).not.toContain("DONE");
    expect(pills(st), label).not.toContain("VERIFIED");
    expect(pills(st), label).not.toContain("PRODUCT_VERIFIED");
    expect(st.textContent, label).not.toMatch(/healthy|verified|secure|\bok\b|all clear|\bready\b|green|passed|\bcomplete(d)?\b/i);
    const dl = cell(row, "delivery");
    expect(pills(dl), label).not.toContain("DONE");
    expect(pills(dl), label).not.toContain("VERIFIED");
    const rv = cell(row, "review");
    const rvDone = pills(rv).filter(p => p === "DONE").length;
    doneInRows += rvDone;
    if (rvDone) { expect(rv.dataset.kind, label).toBe("CLEAN_AT_HEAD"); expect(rv.dataset.verdict, label).toBe("CLEAN"); expect(rv.dataset.atHead, label).toBe("1"); cleanAtHead += 1; }
    for (const other of ["project", "missions", "runs", "blocked", "awaiting", "open"]) expect(pills(cell(row, other)), `${label}/${other}`).not.toContain("DONE");
  }
  expect(doneInRows, label).toBe(cleanAtHead);
  // Tablo dışında (KPI, kaynak şeridi) bir proje başarı rozeti yoktur; kaynak şeridi VERIFIED'ı yalnız "okuma başarılı" için kullanır.
}

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-matrix-")); });
afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(tenantId = "tA"): App {
  fs.mkdirSync(runtime(), {recursive: true});
  // repoRoot geçici dizindir: kokpit orkestratör/rol dosyaları yoktur (dürüst UNAVAILABLE/null), kanıt endeksi gerçek depoyu taramaz.
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), repoRoot: tmp, dataDir: dataDir(), tenantId, port: 3210, logger: false});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string, headers: Record<string, string> = hdr) => { const r = await app.inject({method: "GET", url, headers}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const evBase = (step: string, cycle: number, kind: string) => ({step, cycle, kind, argv: ["x"], startedAt: "2026-10-16T08:00:00.000Z", endedAt: "2026-10-16T08:00:01.000Z", exitCode: 0, logPath: null, logSha256: null}) as any;
// Gerçek Work OS store ile DÖRT proje: Alpha (AWAITING_APPROVAL + CLEAN güncel head, ikinci koşu RUNNING), Beta (BLOCKED mission + FAILED koşu + BLOCKED inceleme), Gamma (PREFLIGHT mission, koşu yok), Delta (hiçbir kayıt yok).
async function seedRealStore() {
  const store = new WorkOsStore(dataDir());
  const tenantId = "tA", scope = {tenantId};
  const mkP = (name: string) => store.createProject({tenantId, orgId: "org1", name, environmentId: "env-dev", createdBy: RECORDER}).projectId;
  const mkM = (projectId: string, title: string, path: string[]) => {
    const m = store.createMission({tenantId, projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
    for (const to of path) store.transitionMission(scope, m.missionId, to as any, "go", RECORDER);
    return m.missionId;
  };
  const BASE = "b".repeat(40), V0 = "a".repeat(40), V1 = "c".repeat(40), E0 = "e".repeat(40);
  const start = (missionId: string, tag: string) => {
    const r = store.createRun({tenantId, missionId, executor: {implementer: `IMPL-${tag}`, reviewer: `REV-${tag}`}, createdBy: RECORDER});
    return {runId: r.runId, leaseId: store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string};
  };
  const add = (r: {runId: string; leaseId: string}, step: string, cycle: number, kind: string, extra: Record<string, unknown>) => store.addRunEvidence(r.runId, r.leaseId, {...evBase(step, cycle, kind), ...extra}, "ENGINE");
  const to = (r: {runId: string; leaseId: string}, status: any, opts: any = {}) => store.transitionRun(r.runId, r.leaseId, status, "t", "ENGINE", opts);
  const pAlpha = mkP("Real Alpha"), pBeta = mkP("Real Beta"), pGamma = mkP("Real Gamma"), pDelta = mkP("Real Delta");
  const mA = mkM(pAlpha, "Alpha work", ["PREFLIGHT", "AUTHORIZED"]);
  const a = start(mA, "A");
  to(a, "RUNNING", {patch: {baseSha: BASE, headSha: V0}});
  add(a, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE, commitSha: V0});
  add(a, "REVIEW", 0, "REVIEW", {commitSha: V0, reviewerIdentity: "REV-A", executorIdentity: "IMPL-A", verdict: "BLOCKED", findingsCount: 1});
  to(a, "CHECKPOINTING");
  store.checkpointRun(a.runId, a.leaseId, {step: "IMPLEMENT", data: {}}, "ENGINE", {patch: {remediationCycle: 1, headSha: V1}});
  to(a, "RUNNING");
  add(a, "IMPLEMENT", 1, "IMPLEMENT", {baseSha: BASE, commitSha: V1});
  add(a, "REVIEW", 1, "REVIEW", {commitSha: V1, reviewerIdentity: "REV-A", executorIdentity: "IMPL-A", verdict: "CLEAN", findingsCount: 0});
  to(a, "CHECKPOINTING"); to(a, "AWAITING_APPROVAL");
  await sleep(8);
  const mA2 = mkM(pAlpha, "Alpha second", ["PREFLIGHT", "AUTHORIZED"]);
  const b = start(mA2, "B");
  to(b, "RUNNING", {patch: {baseSha: BASE, headSha: V0}});
  add(b, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE, commitSha: V0});
  await sleep(8);
  const mB = mkM(pBeta, "Beta blocked", ["PREFLIGHT", "AUTHORIZED"]);
  const c = start(mB, "C");
  to(c, "RUNNING", {patch: {baseSha: BASE, headSha: E0}});
  add(c, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE, commitSha: E0});
  add(c, "REVIEW", 0, "REVIEW", {commitSha: E0, reviewerIdentity: "REV-C", executorIdentity: "IMPL-C", verdict: "BLOCKED", findingsCount: 2});
  to(c, "FAILED");
  store.transitionMission(scope, mB, "BLOCKED", "review blocked", RECORDER);
  mkM(pGamma, "Gamma preflight", ["PREFLIGHT"]);
  return {pAlpha, pBeta, pGamma, pDelta, runA: a.runId, runB: b.runId, runC: c.runId, mA, mA2, mB};
}

describe("Matrix — GENUINE control-api read-models flow through mappers, aggregation and view", () => {
  // //TR: Gercek disk G/C'li bu test Windows CI'da varsayilan 5 sn vitest sinirini asabiliyor (iddia degil yalniz sure); kardes gercek-G/C testleriyle ayni acik sure butcesi verilir.
  it("real seeded multi-project Work OS: per-project counts, attention grouping, verbatim review verdicts, source-only delivery and a real cockpit cross-check", { timeout: T }, async () => {
    const s = await seedRealStore();
    const app = mkApp();
    const core = await load("matrix-core.js");
    const raw = {projects: await getJson(app, "/v1/projects"), missions: await getJson(app, "/v1/missions"), runs: await getJson(app, "/v1/work-runs"), cockpit: await getJson(app, "/v1/cockpit")};
    const res = {projects: core.mapMatrixProjects(raw.projects), missions: core.mapMatrixMissions(raw.missions), workRuns: core.mapMatrixWorkRuns(raw.runs), cockpit: core.mapMatrixCockpit(raw.cockpit)};
    for (const r of Object.values(res) as any[]) expect(r.state).toBe("VERIFIED");
    const out = core.buildMatrix(res);
    expect(out.complete).toBe(true);
    expect(out.rows.length).toBe(4);
    const al = rowOf(out, s.pAlpha), be = rowOf(out, s.pBeta), ga = rowOf(out, s.pGamma), de = rowOf(out, s.pDelta);
    // Alpha: iki mission, iki koşu (biri onay bekliyor), bloke yok (gerçek sıfır), son inceleme CLEAN ve güncel head'e bağlı.
    expect(al).toMatchObject({status: "ATTENTION_NEEDED", name: "Real Alpha"});
    expect(al.missions.total).toBe(2); expect(al.runs).toMatchObject({total: 2, awaiting: 1, open: 1, ended: 0});
    expect(al.signals).toEqual([{code: "RUN_AWAITING_APPROVAL", n: 1, source: "workRuns"}]);
    expect(al.blocked).toMatchObject({total: 0}); expect(al.awaiting).toMatchObject({total: 1, missions: 0, runs: 1});
    expect(al.review).toMatchObject({kind: "CLEAN_AT_HEAD", reviewedRuns: 1}); expect(al.review.latest).toMatchObject({verdict: "CLEAN", reviewer: "REV-A", cycle: 1, atHead: true, runId: s.runA});
    expect(al.delivery).toMatchObject({best: "NOT_PREPARED", runs: 2});
    // Beta: bloke mission, FAILED koşu ve BLOCKED inceleme aynen.
    expect(be).toMatchObject({status: "ATTENTION_NEEDED"}); expect(be.blocked).toMatchObject({total: 1, missions: 1, runs: 0});
    expect(be.runs).toMatchObject({total: 1, failed: 1}); expect(be.review).toMatchObject({kind: "BLOCKED"}); expect(be.review.latest).toMatchObject({verdict: "BLOCKED", reviewer: "REV-C", runId: s.runC});
    // Gamma: yalnız PREFLIGHT mission; koşu yok = GERÇEK sıfır (kaynak okundu); inceleme kaydı yok, teslim yok.
    expect(ga).toMatchObject({status: "ATTENTION_NEEDED"}); expect(ga.runs.total).toBe(0); expect(ga.review.kind).toBe("NONE"); expect(ga.delivery.best).toBe("NO_RUNS");
    expect(ga.signals).toEqual([{code: "MISSION_PREFLIGHT", n: 1, source: "missions"}]);
    // Delta: hiçbir kayıt yok -> NO_ACTIVITY (sağlıklı değil).
    expect(de).toMatchObject({status: "NO_ACTIVITY", lastActivityAt: null, latestMissionId: null});
    // Gerçek kokpit toplamı proje/mission listeleriyle uyuşur (çapraz denetim gerçek veriyle).
    expect(out.reconcile.map((x: any) => [x.key, x.cockpit, x.matrix, x.agree])).toEqual([["projects", 4, 4, true], ["missions", 4, 4, true], ["awaiting", 1, 1, true]]);
    expect(out.rollup.tiles.attention.value).toBe(3);

    const view = await load("views", "matrix.js");
    const {ctx, calls} = await mkCtx(async p => getJson(app, p));
    const rootNode: N = await view.render(ctx);
    expect(calls.slice().sort()).toEqual(FOUR);
    expect(rowsOf(rootNode).length).toBe(4);
    expect(groupsOf(rootNode).map(g => [g.dataset.matrixGroup, g.dataset.n])).toEqual([["ATTENTION_NEEDED", "3"], ["NO_ACTIVITY", "1"]]);
    expect(rowFor(rootNode, s.pDelta).dataset.status).toBe("NO_ACTIVITY");
    expect(cell(rowFor(rootNode, s.pAlpha), "review").dataset).toMatchObject({kind: "CLEAN_AT_HEAD", verdict: "CLEAN", atHead: "1"});
    expect(cell(rowFor(rootNode, s.pBeta), "review").dataset).toMatchObject({kind: "BLOCKED", verdict: "BLOCKED"});
    expect(cell(rowFor(rootNode, s.pBeta), "blocked").dataset.n).toBe("1");
    expect(cell(rowFor(rootNode, s.pAlpha), "blocked").dataset.n).toBe("0"); // gerçek sıfır: iki kaynak da okundu
    expect(cell(rowFor(rootNode, s.pGamma), "runs").dataset.n).toBe("0");
    expect(kpiValue(rootNode, "projects")).toBe("4"); expect(kpiValue(rootNode, "missions")).toBe("4"); expect(kpiValue(rootNode, "awaiting")).toBe("1"); expect(kpiValue(rootNode, "attention")).toBe("3");
    expect(byData(rootNode, "reconcile", "agree")).toBeTruthy();
    expectNoGreen(rootNode, "real-seeded");
    expect(rootNode.textContent).not.toMatch(/product[\s_-]*verified/i);
  });
  it("a real Work OS without any record gives an honest empty matrix (real zero) and zero attention — never a healthy claim", async () => {
    const app = mkApp();
    const r = await renderView(p => getJson(app, p));
    expect(rowsOf(r.root).length).toBe(0);
    expect(byData(r.root, "matrixEmpty", "1")!.textContent).toContain("No projects are registered yet");
    expect(allData(r.root, "matrixState").length).toBe(0);
    // Günlük (journal) yokken kokpit projeleri UNAVAILABLE bildirir: sayı "—" olur (0 uydurulmaz), ama proje LİSTESİ okundu ve gerçek sıfırdır => dikkat sayısı gerçek 0.
    expect(kpiValue(r.root, "projects")).toBe("—"); expect(kpi(r.root, "projects").dataset.state).toBe("UNAVAILABLE");
    expect(kpiValue(r.root, "attention")).toBe("0");
    expect(pills(kpi(r.root, "attention"))).toEqual(["EMPTY"]);
    expect(healthyClaims(r.root)).toEqual([]);
    expectNoGreen(r.root, "real-empty");
  });
});

describe("Matrix — REAL runner + REAL git: a CLEAN review awaiting approval never becomes a green or verified project", () => {
  it("shows the awaiting-approval run and the real review verdict verbatim; the project stays 'needs attention' and delivery is not verified", { timeout: T }, async () => {
    const rt = tmpRoot("uasco-matrix-m1a-");
    try {
      const c = setup(rt);
      const app = relfxApi(c, {sandbox: undefined}) as unknown as App; apps.push(app);
      const created = await app.inject({method: "POST", url: "/v1/projects", headers: RELFX_HDR, payload: {name: "Matrix App", environmentId: "dev", template: "web-node", idempotencyKey: "matrix-1"}});
      expect(created.statusCode, created.body).toBe(201);
      const pid = created.json().project.projectId as string;
      const mc = await app.inject({method: "POST", url: "/v1/missions", headers: RELFX_HDR, payload: {projectId: pid, title: "Add feature", objective: "feature.txt says ok", acceptanceCriteria: ["reviewed"], riskLevel: "R1"}});
      const missionId = mc.json().mission.missionId as string;
      for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await app.inject({method: "POST", url: `/v1/missions/${missionId}/transition`, headers: RELFX_HDR, payload: {to, reason: "go"}})).statusCode).toBe(200);
      const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n"}})})), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
      const r0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
      await runner({...c, store, missionId}, fake, {executionGate: new ExecutionGate(null)}).tick();
      const run = store.getRun({tenantId: "tA"}, r0.runId)!;
      expect(run.status, run.reason ?? "").toBe("AWAITING_APPROVAL");

      const core = await load("matrix-core.js");
      const raws = {projects: await getJson(app, "/v1/projects", RELFX_HDR), missions: await getJson(app, "/v1/missions", RELFX_HDR), runs: await getJson(app, "/v1/work-runs", RELFX_HDR), cockpit: await getJson(app, "/v1/cockpit", RELFX_HDR)};
      // Gerçek gövdeler katı eşleyicilerden geçer (gerçek veri biçimi sözleşmeyle uyumlu).
      expect(core.mapMatrixProjects(raws.projects).state).toBe("VERIFIED");
      expect(core.mapMatrixMissions(raws.missions).state).toBe("VERIFIED");
      expect(core.mapMatrixWorkRuns(raws.runs).state).toBe("VERIFIED");
      expect(core.mapMatrixCockpit(raws.cockpit).state).toBe("VERIFIED");

      const {root: rootNode} = await renderView(p => getJson(app, p, RELFX_HDR));
      const row = rowFor(rootNode, pid);
      expect(row.dataset.status).toBe("ATTENTION_NEEDED");
      expect(signalsOf(row)).toEqual([["RUN_AWAITING_APPROVAL", "1"]]);
      expect(cell(row, "awaiting").dataset.n).toBe("1");
      const rv = cell(row, "review");
      expect(rv.dataset.verdict).toBe("CLEAN");
      expect(byData(rv, "verbatim", "1")!.textContent).toBe("CLEAN");
      expect(cell(row, "delivery").dataset.delivery).not.toBe("SOURCE_ACCEPTED");
      expect(pills(cell(row, "delivery"))).not.toContain("DONE");
      expectNoGreen(rootNode, "real-runner");
      expect(rootNode.textContent).not.toMatch(/product[\s_-]*verified/i);
    } finally { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(rt); }
  });
});

// ---------------- (2) allow-list ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Matrix — only already-allow-listed read-only GETs are used (protected files unchanged)", () => {
  it("all four GET paths are already admitted by the desktop allow-list; nothing new is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    for (const p of FOUR) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/matrix", "/v1/portfolio", "/v1/portfolio/matrix", "/v1/projects/matrix", "/v1/cockpit?x=1", "/v1/cockpit/", "/v1/projects/", "/v1/work-runs/", "/v1/command-matrix"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes("matrix")).toBe(false);
    for (const f of [mainSrc, fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8"), fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")]) {
      expect(f).not.toContain("/v1/matrix");
      expect(f).not.toContain("/v1/portfolio");
    }
  });
  it("matrix.js / matrix-core.js never write and never reach outside ctx.api: no post, bridge, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "matrix.js"), read("matrix-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions|createMission|startRun/);
    }
    const imports = moduleSpecifiers({source: read("views", "matrix.js")}).sort();
    expect(imports).toEqual(["../components.js", "../forms.js", "../matrix-core.js", "../model.js", "../work-core.js"]);
    expect(moduleSpecifiers({source: read("matrix-core.js")}).sort()).toEqual(["./executive-core.js", "./work-core.js"]);
    for (const m of ["matrixProjects", "matrixMissions", "matrixWorkRuns", "matrixCockpit"]) expect(read("views", "matrix.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur (yeni POST yolu eklenmez); matris erişimcileri yalnız sabit GET yollarını okur.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const accessors = read("api.js").split(String.fromCharCode(10)).filter(l => /^\s*async matrix(Projects|Missions|WorkRuns|Cockpit)\(\)/.test(l));
    expect(accessors.length).toBe(4);
    for (const l of accessors) { expect(l).not.toMatch(/post\(|apiPost|force|store\.projectId/); expect(l).toMatch(/await get\((PROJECTS|MISSIONS|WORK_RUNS|COCKPIT)_PATH\)/); }
  });
  it("the api layer requests exactly the four fixed paths, with no query string, no selected-project scoping and no caller-chosen path", async () => {
    const {ctx, calls} = await mkCtx(serve());
    ctx.store.selectProject(PA); // seçili proje matrisi DARALTMAZ: portföy tüm projeleri kapsar.
    const core = await load("matrix-core.js");
    expect(core.MATRIX_SOURCE_PATHS).toEqual({projects: "/v1/projects", missions: "/v1/missions", workRuns: "/v1/work-runs", cockpit: "/v1/cockpit"});
    expect(core.MATRIX_SOURCES).toEqual(["projects", "missions", "workRuns", "cockpit"]);
    expect((await ctx.api.matrixProjects()).state).toBe("VERIFIED");
    expect((await ctx.api.matrixMissions()).state).toBe("VERIFIED");
    expect((await ctx.api.matrixWorkRuns()).state).toBe("VERIFIED");
    expect((await ctx.api.matrixCockpit()).state).toBe("VERIFIED");
    expect(calls).toEqual(["/v1/projects", "/v1/missions", "/v1/work-runs", "/v1/cockpit"]);
    for (const m of ["matrixProjects", "matrixMissions", "matrixWorkRuns", "matrixCockpit"]) expect(ctx.api[m].length).toBe(0);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    const ms = ["matrixProjects", "matrixMissions", "matrixWorkRuns", "matrixCockpit"];
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ms) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    for (const m of ms) expect((await ctx.api[m]()).state, m).toBe("ERROR");
  });
});

// ---------------- (3) pure mappers: fail-closed ----------------
describe("Matrix — pure mappers are fail-closed and never elevate state", () => {
  it("mapMatrixProjects keeps only the safe fields and carries the record AS IS (no repository path, no invented health)", async () => {
    const core = await load("matrix-core.js");
    const m = core.mapMatrixProjects(PROJECTS);
    expect(m.state).toBe("VERIFIED");
    expect(m.projects.total).toBe(5);
    expect(m.projects.items[0]).toEqual({projectId: PD, name: "Delta Docs", environmentId: "env-dev", createdAt: "2026-10-01T00:00:00.000Z"});
    expect(JSON.stringify(m)).not.toContain("/secret/repo/path");
    expect(core.mapMatrixProjects({projects: []})).toEqual({state: "VERIFIED", projects: {total: 0, items: []}});
    expect(core.mapMatrixProjects({projects: [projectRow(PA, "A", {environmentId: undefined})]}).projects.items[0].environmentId).toBeNull();
  });
  it("any malformed project record (or duplicate id, wrong shape) makes the WHOLE read ERROR — no partial list", async () => {
    const core = await load("matrix-core.js");
    const good = projectRow(PA, "Alpha");
    const bads: any[] = [null, [], "x", {}, {projects: null}, {projects: {}}, {projects: [good, null]}, {projects: [good, "x"]}, {projects: [good, projectRow("prj_nope", "B")]}, {projects: [good, projectRow(PB, "")]},
      {projects: [good, projectRow(PB, 7 as any)]}, {projects: [good, projectRow(PB, "B", {createdAt: "not-a-date"})]}, {projects: [good, projectRow(PB, "B", {createdAt: undefined})]}, {projects: [good, projectRow(PB, "B", {environmentId: 5})]},
      {projects: [good, projectRow(PB, "B", {environmentId: ""})]}, {projects: [good, projectRow(PA, "Alpha again")]}, {projects: [good, {...projectRow(PB, "B"), projectId: undefined}]}];
    for (const b of bads) expect(core.mapMatrixProjects(b), JSON.stringify(b)).toEqual({state: "ERROR", projects: null});
  });
  it("missions, work runs and the cockpit use the strict Executive contract: one malformed field rejects the whole read", async () => {
    const core = await load("matrix-core.js");
    expect(core.mapMatrixMissions(MISSIONS).state).toBe("VERIFIED");
    expect(core.mapMatrixWorkRuns(RUNS).state).toBe("VERIFIED");
    expect(core.mapMatrixCockpit(cockpitBody()).state).toBe("VERIFIED");
    expect(core.mapMatrixMissions({missions: [...MISSIONS.missions, missionRow(MID("f1"), PA, "NOT_A_STATUS", T0)]})).toEqual({state: "ERROR", missions: null});
    expect(core.mapMatrixMissions({missions: [...MISSIONS.missions, MISSIONS.missions[0]]})).toEqual({state: "ERROR", missions: null});
    expect(core.mapMatrixWorkRuns({runs: [...RUNS.runs, runRow(RID("f1"), MA1, PA, {status: "DONE"})]})).toEqual({state: "ERROR", runs: null});
    expect(core.mapMatrixWorkRuns({runs: [...RUNS.runs, runRow(RID("f2"), MA1, "prj_bad")]})).toEqual({state: "ERROR", runs: null});
    expect(core.mapMatrixWorkRuns({runs: [runRow(RID("f3"), MA1, PA, {evidence: [ev("REVIEW", 1, {verdict: "APPROVED"})]})]})).toEqual({state: "ERROR", runs: null});
    expect(core.mapMatrixCockpit({...cockpitBody(), projects: {state: "BOGUS", count: 5}})).toEqual({state: "ERROR", cockpit: null});
    expect(core.mapMatrixCockpit(cockpitBody({missions: {state: "VERIFIED", total: 9, byStatus: {EXECUTING: 1}}}))).toEqual({state: "ERROR", cockpit: null});
    expect(core.mapMatrixCockpit(cockpitBody({projects: {state: "VERIFIED", count: -1}}))).toEqual({state: "ERROR", cockpit: null});
  });
  it("a blocked/unavailable cockpit block is honest data and is carried without a number; a live block with a missing number rejects the read", async () => {
    const core = await load("matrix-core.js");
    const m = core.mapMatrixCockpit(cockpitBody({projects: {state: "UNAVAILABLE", count: 5}}));
    expect(m.state).toBe("VERIFIED");
    expect(m.cockpit.projects).toEqual({state: "UNAVAILABLE", count: null});
    expect(core.mapMatrixCockpit(cockpitBody({projects: {state: "VERIFIED"}})).state).toBe("ERROR");
  });
});

// ---------------- (4) matrix semantics ----------------
describe("Matrix — per-project semantics: counts, honest status, grouping and ordering", () => {
  it("computes every column from the recorded rows only and sorts the groups: attention first (most signals first), then unknown, active, idle, no activity", async () => {
    const {out} = await assess();
    expect(out.complete).toBe(true);
    expect(out.rows.map((r: any) => [r.projectId, r.status])).toEqual([[PA, "ATTENTION_NEEDED"], [PB, "ATTENTION_NEEDED"], [PC, "ACTIVE"], [PE, "IDLE"], [PD, "NO_ACTIVITY"]]);
    expect(out.groups.map((g: any) => [g.status, g.items.length])).toEqual([["ATTENTION_NEEDED", 2], ["UNKNOWN", 0], ["ACTIVE", 1], ["IDLE", 1], ["NO_ACTIVITY", 1]]);
    expect(out.totals).toEqual({projects: 5, byStatus: {ATTENTION_NEEDED: 2, UNKNOWN: 0, ACTIVE: 1, IDLE: 1, NO_ACTIVITY: 1}});
    const a = rowOf(out, PA);
    expect(a.missions).toMatchObject({total: 2, inProgress: 1, preflight: 1, blocked: 0, attention: 0, byStatus: [["EXECUTING", 1], ["PREFLIGHT", 1]]});
    expect(a.runs).toMatchObject({total: 2, open: 1, awaiting: 1, ended: 0, blocked: 0, failed: 0});
    expect(a.signals).toEqual([{code: "MISSION_PREFLIGHT", n: 1, source: "missions"}, {code: "RUN_AWAITING_APPROVAL", n: 1, source: "workRuns"}]);
    expect(a.score).toBe(2); expect(a.partial).toBe(false);
    expect(a.blocked).toEqual({total: 0, missions: 0, runs: 0}); expect(a.awaiting).toEqual({total: 2, missions: 1, runs: 1});
    expect(a.delivery).toEqual({best: "SOURCE_ACCEPTED", runs: 2, counts: {NOT_PREPARED: 1, ARTIFACT_PREPARED: 0, SOURCE_ACCEPTED: 1}});
    expect(a.latestMissionId).toBe(MA2); expect(a.lastActivityAt).toBe("2026-10-16T06:00:00.000Z");
    const b = rowOf(out, PB);
    expect(b.signals).toEqual([{code: "MISSION_BLOCKED", n: 1, source: "missions"}]);
    expect(b.blocked).toEqual({total: 1, missions: 1, runs: 0}); expect(b.awaiting.total).toBe(0);
    expect(b.runs).toMatchObject({total: 1, ended: 1, failed: 1}); // FAILED koşu "failed" olarak sayılır, "engelli" değildir (kayıtlı durum AYNEN)
    const c = rowOf(out, PC);
    expect(c).toMatchObject({signals: [], score: 0, status: "ACTIVE"}); expect(c.runs.open).toBe(1);
    const d = rowOf(out, PD);
    expect(d).toMatchObject({status: "NO_ACTIVITY", signals: [], latestMissionId: null, lastActivityAt: null});
    expect(d.missions.total).toBe(0); expect(d.runs.total).toBe(0); expect(d.review.kind).toBe("NONE"); expect(d.delivery.best).toBe("NO_RUNS");
    const e = rowOf(out, PE);
    expect(e.status).toBe("IDLE"); expect(e.missions.complete).toBe(1);
    expect(e.review.kind).toBe("CLEAN_AT_HEAD");
  });
  it("every individual attention signal makes the project ATTENTION_NEEDED, and only recorded states can do it", async () => {
    const cases: Array<[string, any, any, string]> = [
      ["MISSION_BLOCKED", [missionRow(MA1, PA, "BLOCKED", T0)], [], "MISSION_BLOCKED"],
      ["MISSION_FOUNDER_ATTENTION", [missionRow(MA1, PA, "FOUNDER_ATTENTION_REQUIRED", T0)], [], "MISSION_FOUNDER_ATTENTION"],
      ["MISSION_PREFLIGHT", [missionRow(MA1, PA, "PREFLIGHT", T0)], [], "MISSION_PREFLIGHT"],
      ["RUN_AWAITING_APPROVAL", [missionRow(MA1, PA, "REPORTING", T0)], [runRow(RA1, MA1, PA, {status: "AWAITING_APPROVAL"})], "RUN_AWAITING_APPROVAL"],
      ["RUN_BLOCKED/BLOCKED", [missionRow(MA1, PA, "EXECUTING", T0)], [runRow(RA1, MA1, PA, {status: "BLOCKED", evidence: []})], "RUN_BLOCKED"],
      ["RUN_BLOCKED/QUARANTINED", [missionRow(MA1, PA, "EXECUTING", T0)], [runRow(RA1, MA1, PA, {status: "QUARANTINED", evidence: []})], "RUN_BLOCKED"],
      ["RUN_DEGRADED", [missionRow(MA1, PA, "EXECUTING", T0)], [runRow(RA1, MA1, PA, {status: "DEGRADED", evidence: []})], "RUN_DEGRADED"]];
    for (const [label, ms, rs, code] of cases) {
      const {out} = await assess({projects: {projects: [projectRow(PA, "Alpha")]}, missions: {missions: ms}, runs: {runs: rs}});
      const r = rowOf(out, PA);
      expect(r.status, label).toBe("ATTENTION_NEEDED");
      expect(r.signals.map((s: any) => s.code), label).toEqual([code]);
    }
    // Olumsuz olmayan kayıtlı durumlar (FAILED/CANCELLED/SUCCEEDED koşu, COMPLETE/EXECUTING/AUTHORIZED mission) dikkat sinyali DEĞİLDİR ve hiçbiri "sağlıklı" demek değildir.
    for (const [ms, rs] of [["COMPLETE", "SUCCEEDED"], ["EXECUTING", "FAILED"], ["AUTHORIZED", "CANCELLED"], ["EXECUTING", "RUNNING"]] as const) {
      const {out} = await assess({projects: {projects: [projectRow(PA, "Alpha")]}, missions: {missions: [missionRow(MA1, PA, ms, T0)]}, runs: {runs: [runRow(RA1, MA1, PA, {status: rs, evidence: []})]}});
      const r = rowOf(out, PA);
      expect(r.signals, `${ms}/${rs}`).toEqual([]);
      expect(["ACTIVE", "IDLE"], `${ms}/${rs}`).toContain(r.status);
    }
  });
  it("ACTIVE needs open work, IDLE means records but nothing open, NO_ACTIVITY means no records — each derived only from the read rows", async () => {
    const one = (ms: any[], rs: any[]) => assess({projects: {projects: [projectRow(PA, "Alpha")]}, missions: {missions: ms}, runs: {runs: rs}}).then(x => rowOf(x.out, PA).status);
    expect(await one([], [])).toBe("NO_ACTIVITY");
    expect(await one([missionRow(MA1, PA, "EXECUTING", T0)], [])).toBe("ACTIVE");
    expect(await one([missionRow(MA1, PA, "DRAFT", T0)], [])).toBe("IDLE");
    expect(await one([missionRow(MA1, PA, "COMPLETE", T0)], [runRow(RA1, MA1, PA, {status: "SUCCEEDED", evidence: []})])).toBe("IDLE");
    expect(await one([missionRow(MA1, PA, "COMPLETE", T0)], [runRow(RA1, MA1, PA, {status: "RUNNING", evidence: []})])).toBe("ACTIVE");
  });
  it("an unreadable missions source withholds mission-dependent counts (null, never 0); positives from the readable source still escalate, silence never becomes 'idle' or 'healthy'", async () => {
    const {out} = await assess({res: {missions: {state: "OFFLINE", missions: null}}});
    expect(out.complete).toBe(false);
    expect(out.unreadable).toEqual(["missions"]); expect(out.incompleteState).toBe("OFFLINE");
    for (const r of out.rows) { expect(r.missions, r.projectId).toBeNull(); expect(r.blocked, r.projectId).toBeNull(); expect(r.awaiting, r.projectId).toBeNull(); expect(r.runs, r.projectId).not.toBeNull(); expect(r.latestMissionId).toBeNull(); }
    expect(rowOf(out, PA)).toMatchObject({status: "ATTENTION_NEEDED", partial: true, unreadable: ["missions"]});
    expect(rowOf(out, PA).signals.map((s: any) => s.code)).toEqual(["RUN_AWAITING_APPROVAL"]);
    for (const pid of [PB, PC, PD, PE]) expect(rowOf(out, pid), pid).toMatchObject({status: "UNKNOWN", unknownState: "OFFLINE", signals: []});
    expect(out.groups.find((g: any) => g.status === "IDLE").items.length).toBe(0);
    expect(out.groups.find((g: any) => g.status === "NO_ACTIVITY").items.length).toBe(0);
    expect(out.rollup.tiles.attention).toMatchObject({state: "OFFLINE", value: null});
  });
  it("an unreadable work-runs source withholds run-dependent counts, the review and the delivery (null, never 0 or 'none')", async () => {
    const {out} = await assess({res: {workRuns: {state: "UNAVAILABLE", runs: null}}});
    expect(out.incompleteState).toBe("UNAVAILABLE");
    for (const r of out.rows) { expect(r.runs).toBeNull(); expect(r.review).toBeNull(); expect(r.delivery).toBeNull(); expect(r.blocked).toBeNull(); expect(r.awaiting).toBeNull(); expect(r.missions).not.toBeNull(); }
    expect(rowOf(out, PA).signals.map((s: any) => s.code)).toEqual(["MISSION_PREFLIGHT"]);
    expect(rowOf(out, PB).signals.map((s: any) => s.code)).toEqual(["MISSION_BLOCKED"]);
    for (const pid of [PC, PD, PE]) expect(rowOf(out, pid), pid).toMatchObject({status: "UNKNOWN", unknownState: "UNAVAILABLE"});
  });
  it("both missions and work runs unreadable: every project is UNKNOWN with the combined honest state; an unreadable project list yields no rows at all", async () => {
    let r = await assess({res: {missions: {state: "ERROR", missions: null}, workRuns: {state: "OFFLINE", runs: null}}});
    expect(r.out.rows.every((x: any) => x.status === "UNKNOWN" && x.unknownState === "OFFLINE" && x.unreadable.join() === "missions,workRuns")).toBe(true);
    expect(r.out.incompleteState).toBe("OFFLINE");
    r = await assess({res: {projects: {state: "ERROR", projects: null}}});
    expect(r.out.rows).toEqual([]); expect(r.out.projects).toBeNull(); expect(r.out.totals).toEqual({projects: null, byStatus: null});
    expect(r.out.sources.projects.state).toBe("ERROR");
    expect(r.out.reconcile.find((x: any) => x.key === "projects")).toBeUndefined();
    // VERIFIED ama gövdesiz bir okuma KULLANILMAZ ve ERROR sayılır (tahmin yok).
    r = await assess({res: {missions: {state: "VERIFIED"}}});
    expect(r.out.sources.missions.state).toBe("ERROR");
    expect(rowOf(r.out, PD).status).toBe("UNKNOWN");
  });
  it("latest review: carried verbatim from the newest run that has a REVIEW record; CLEAN is a success only when bound to the run's current head", async () => {
    const mk = (rs: any[]) => assess({projects: {projects: [projectRow(PA, "Alpha")]}, missions: {missions: [missionRow(MA1, PA, "EXECUTING", T0)]}, runs: {runs: rs}}).then(x => rowOf(x.out, PA).review);
    expect(await mk([])).toEqual({reviewedRuns: 0, latest: null, kind: "NONE"});
    expect(await mk([runRow(RA1, MA1, PA, {evidence: []})])).toMatchObject({kind: "NONE", latest: null});
    const clean = await mk([runRow(RA1, MA1, PA)]);
    expect(clean).toMatchObject({kind: "CLEAN_AT_HEAD", reviewedRuns: 1}); expect(clean.latest).toMatchObject({verdict: "CLEAN", reviewer: "REV-1", cycle: 1, atHead: true});
    const stale = await mk([runRow(RA1, MA1, PA, {headSha: sha("d")})]);
    expect(stale.kind).toBe("CLEAN_STALE"); expect(stale.latest).toMatchObject({verdict: "CLEAN", atHead: false});
    const blocked = await mk([runRow(RA1, MA1, PA, {evidence: [ev("IMPLEMENT", 1, {commitSha: sha("c")}), ev("REVIEW", 1, {step: "REVIEW", commitSha: sha("c"), reviewerIdentity: "REV-9", verdict: "BLOCKED"})]})]);
    expect(blocked.kind).toBe("BLOCKED"); expect(blocked.latest.verdict).toBe("BLOCKED");
    const novalid = await mk([runRow(RA1, MA1, PA, {evidence: [ev("REVIEW", 1, {step: "REVIEW", reviewerIdentity: "REV-9"})]})]);
    expect(novalid.kind).toBe("NO_VALID_VERDICT"); expect(novalid.latest.verdict).toBeNull();
    // En yeni etkinlikli inceleme kaydı olan koşu "son" sayılır; eski koşunun CLEAN kararı yeni BLOCKED kararı örtmez.
    const newest = await mk([runRow(RA1, MA1, PA, {updatedAt: "2026-10-16T03:00:00.000Z"}), runRow(RID("a9"), MA1, PA, {updatedAt: "2026-10-16T09:00:00.000Z", evidence: [ev("REVIEW", 1, {step: "REVIEW", commitSha: sha("c"), reviewerIdentity: "REV-9", verdict: "BLOCKED"})]})]);
    expect(newest.kind).toBe("BLOCKED"); expect(newest.reviewedRuns).toBe(2); expect(newest.latest.runId).toBe(RID("a9"));
  });
  it("delivery is aggregated from recorded states only and the best state never exceeds what a run recorded", async () => {
    const mk = (rs: any[]) => assess({projects: {projects: [projectRow(PA, "Alpha")]}, missions: {missions: [missionRow(MA1, PA, "EXECUTING", T0)]}, runs: {runs: rs}}).then(x => rowOf(x.out, PA).delivery);
    expect(await mk([])).toMatchObject({best: "NO_RUNS", runs: 0});
    expect(await mk([runRow(RA1, MA1, PA)])).toMatchObject({best: "NOT_PREPARED"});
    expect(await mk([runRow(RA1, MA1, PA, {deliveryArtifact: artifact(RA1, MA1)})])).toMatchObject({best: "ARTIFACT_PREPARED", counts: {ARTIFACT_PREPARED: 1}});
    expect(await mk([runRow(RA1, MA1, PA, {deliveryArtifact: artifact(RA1, MA1), sourceDelivery: accepted(RA1, MA1)}), runRow(RID("a9"), MA1, PA)])).toMatchObject({best: "SOURCE_ACCEPTED", counts: {SOURCE_ACCEPTED: 1, NOT_PREPARED: 1}});
  });
  it("projects order inside a group: more signals first, then newest activity, then name, then id (stable)", async () => {
    const projects = {projects: [projectRow(PID("a1"), "Zeta"), projectRow(PID("a2"), "Alpha"), projectRow(PID("a3"), "Alpha"), projectRow(PID("a4"), "Mid"), projectRow(PID("a5"), "Many")]};
    const mk = (id: string, pid: string, status: string, at: string) => missionRow(MID(id), pid, status, at);
    const missions = {missions: [
      mk("01", PID("a1"), "BLOCKED", "2026-10-01T00:00:00.000Z"), mk("02", PID("a2"), "BLOCKED", "2026-10-01T00:00:00.000Z"), mk("03", PID("a3"), "BLOCKED", "2026-10-01T00:00:00.000Z"),
      mk("04", PID("a4"), "BLOCKED", "2026-10-09T00:00:00.000Z"), mk("05", PID("a5"), "BLOCKED", "2026-10-01T00:00:00.000Z"), mk("06", PID("a5"), "PREFLIGHT", "2026-10-01T00:00:00.000Z")]};
    const {out} = await assess({projects, missions, runs: {runs: []}});
    // Many (2 sinyal) -> Mid (1 sinyal, en yeni) -> aynı etkinlikte ad (Alpha, Alpha, Zeta) -> Alpha'lar arasında kimlik.
    expect(out.rows.map((r: any) => r.projectId)).toEqual([PID("a5"), PID("a4"), PID("a2"), PID("a3"), PID("a1")]);
  });
  it("the cockpit rollup carries only live blocks; non-live blocks show no number; the attention figure needs all three row sources", async () => {
    let r = await assess({cockpit: cockpitBody({projects: {state: "UNAVAILABLE", count: null}, evidence: {state: "ERROR", total: null, verified: null, mismatch: null, missing: null, unverifiable: null, sources: {}}})});
    expect(r.out.rollup.state).toBe("VERIFIED");
    expect(r.out.rollup.tiles.projects).toMatchObject({state: "UNAVAILABLE", value: null});
    expect(r.out.rollup.tiles.evidence).toMatchObject({state: "ERROR", value: null, detail: null});
    expect(r.out.rollup.tiles.missions).toMatchObject({state: "VERIFIED", value: 5});
    expect(r.out.rollup.tiles.attention).toMatchObject({state: "VERIFIED", value: 2});
    expect(r.out.reconcile.find((x: any) => x.key === "projects")).toBeUndefined(); // kokpit bloğu canlı değilse karşılaştırma yok
    r = await assess({res: {cockpit: {state: "OFFLINE", cockpit: null}}});
    expect(r.out.rollup).toMatchObject({state: "OFFLINE", generatedAt: null, globalStop: null});
    for (const k of ["projects", "missions", "awaiting", "workers", "evidence"]) expect(r.out.rollup.tiles[k], k).toMatchObject({state: "OFFLINE", value: null});
    expect(r.out.rows.length).toBe(5); // satırlar kokpite bağlı değildir
    expect(r.out.rollup.tiles.attention.value).toBe(2);
  });
  it("cross-check: a cockpit total that disagrees with the lists is reported, never silently reconciled; missions/runs of unlisted projects are counted, not hidden", async () => {
    let r = await assess({cockpit: cockpitBody({projects: {state: "VERIFIED", count: 7}})});
    expect(r.out.reconcile.map((x: any) => [x.key, x.cockpit, x.matrix, x.agree])).toEqual([["projects", 7, 5, false], ["missions", 5, 5, true], ["awaiting", 1, 1, true]]);
    expect(r.out.rows.length).toBe(5);
    r = await assess({projects: {projects: [projectRow(PA, "Alpha")]}});
    expect(r.out.unlisted).toEqual({missions: 3, runs: 3});
    expect(r.out.rows.length).toBe(1);
    r = await assess({res: {missions: {state: "OFFLINE", missions: null}}});
    expect(r.out.unlisted.missions).toBeNull(); expect(r.out.unlisted.runs).toBe(0);
  });
});

// ---------------- (5) view honesty ----------------
describe("Matrix — view honesty", () => {
  it("renders the rollup (A) and the matrix (B) in that order with real figures, grouped by attention, verdicts verbatim, delivery NOT verified", async () => {
    const {root: r, calls} = await renderView(serve());
    expect(calls.slice().sort()).toEqual(FOUR);
    expect(all(r).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["matrix-rollup", "matrix-grid"]);
    expect(byId(r, "view-title")!.textContent).toBe("Multi-Project Command Matrix");
    expect(sourcesOf(r).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["projects", "VERIFIED"], ["missions", "VERIFIED"], ["workRuns", "VERIFIED"], ["cockpit", "VERIFIED"]]);
    // Rollup: kokpitten gerçek toplamlar; dikkat sayısı satırlardan.
    expect(kpiValue(r, "projects")).toBe("5"); expect(kpiValue(r, "missions")).toBe("5"); expect(kpiValue(r, "awaiting")).toBe("1");
    expect(kpiValue(r, "attention")).toBe("2"); expect(kpiValue(r, "workers")).toBe("2"); expect(kpiValue(r, "evidence")).toBe("8");
    expect(pills(kpi(r, "awaiting"))).toEqual(["WAITING"]); expect(pills(kpi(r, "attention"))).toEqual(["ATTENTION"]);
    expect(pills(kpi(r, "evidence"))).toEqual(["NOT_VERIFIED"]); // 8 / 10 kayıt doğrulandı: eksik kanıt başarı gibi görünmez
    expect(all(kpi(r, "evidence")).some(n => n.textContent.includes("of 10 records · mismatch 1 · missing 1 · unverifiable 0"))).toBe(true);
    expect(byData(r, "fact", "globalStop")!.dataset.globalStop).toBe("inactive");
    expect(byData(r, "reconcile", "agree")!.dataset.compared).toBe("projects,missions,awaiting");
    expect(byData(r, "reconcile", "agree")!.textContent).toBe("Cross-check: the cockpit totals agree with the lists they could be compared against (projects, missions, missions awaiting approval).");
    // Gruplar ve sıra.
    expect(groupsOf(r).map(g => [g.dataset.matrixGroup, g.dataset.n])).toEqual([["ATTENTION_NEEDED", "2"], ["ACTIVE", "1"], ["IDLE", "1"], ["NO_ACTIVITY", "1"]]);
    expect(rowsOf(r).map(n => n.dataset.matrixRow)).toEqual([PA, PB, PC, PE, PD]);
    expect(allData(r, "col", "project").filter(n => n.tagName === "TH" && n.getAttribute("scope") === "row").length).toBe(5);
    // Alpha satırı.
    const a = rowFor(r, PA);
    expect(a.dataset).toMatchObject({status: "ATTENTION_NEEDED", review: "CLEAN_AT_HEAD", delivery: "SOURCE_ACCEPTED"});
    expect(byData(cell(a, "project"), "field", "projectId")!.textContent).toBe(PA);
    expect(cell(a, "project").textContent).toContain("Alpha Platform");
    expect(signalsOf(a)).toEqual([["MISSION_PREFLIGHT", "1"], ["RUN_AWAITING_APPROVAL", "1"]]);
    expect(pills(cell(a, "status"))).toEqual(["ATTENTION"]);
    expect(cell(a, "missions").dataset.n).toBe("2"); expect(byData(cell(a, "missions"), "field", "breakdown")!.textContent).toBe("EXECUTING 1 · PREFLIGHT 1");
    expect(cell(a, "runs").dataset.n).toBe("2"); expect(byData(cell(a, "runs"), "field", "breakdown")!.textContent).toBe("AWAITING_APPROVAL 1 · RUNNING 1");
    expect(cell(a, "blocked").dataset.n).toBe("0");
    expect(cell(a, "awaiting").dataset.n).toBe("2"); expect(byData(cell(a, "awaiting"), "field", "split")!.textContent).toBe("1 missions · 1 runs");
    const rv = cell(a, "review");
    expect(byData(rv, "verbatim", "1")!.textContent).toBe("CLEAN"); expect(pills(rv)).toEqual(["DONE"]);
    expect(byData(rv, "note", "at-head")).toBeTruthy(); expect(rv.textContent).toContain("by REV-1, cycle 1");
    expect(pills(cell(a, "delivery"))).toEqual(["NOT_VERIFIED"]); expect(cell(a, "delivery").textContent).toContain("Source delivery accepted · NOT verified");
    expect(byData(cell(a, "delivery"), "field", "deliveryCounts")!.textContent).toBe("Accepted 1 · prepared 0 · none 1");
    // Beta: BLOCKED karar aynen, engelli sayısı.
    const b = rowFor(r, PB);
    expect(cell(b, "blocked").dataset.n).toBe("1"); expect(pills(cell(b, "review"))).toEqual(["BLOCKED"]); expect(byData(cell(b, "review"), "verbatim", "1")!.textContent).toBe("BLOCKED");
    expect(cell(b, "review").textContent).toContain("by REV-2");
    expect(pills(cell(b, "delivery"))).toEqual(["NOT_EXECUTED"]);
    // Gamma: açık koşu, inceleme yok.
    const c = rowFor(r, PC);
    expect(pills(cell(c, "status"))).toEqual(["ACTIVE"]); expect(cell(c, "review").dataset.kind).toBe("NONE"); expect(pills(cell(c, "review"))).toEqual(["NOT_EXECUTED"]); expect(cell(c, "review").textContent).toContain("No review recorded");
    // Delta: kayıt yok.
    const d = rowFor(r, PD);
    expect(pills(cell(d, "status"))).toEqual(["EMPTY"]); expect(cell(d, "missions").dataset.n).toBe("0"); expect(cell(d, "runs").dataset.n).toBe("0");
    expect(pills(cell(d, "delivery"))).toEqual(["EMPTY"]); expect(byData(cell(d, "project"), "field", "lastActivity")!.dataset.value).toBe("none");
    expect(allData(d, "journey").length).toBe(0);
    // Epsilon: tamamlanmış proje bile doğrulanmış gösterilmez.
    const e = rowFor(r, PE);
    expect(pills(cell(e, "status"))).toEqual(["IDLE"]); expect(cell(e, "delivery").textContent).toContain("NOT verified");
    // Sabit notlar.
    expect(byData(r, "readonly", "1")).toBeTruthy();
    expect(byData(r, "honesty", "1")!.textContent).toContain("never shown as healthy or verified");
    expect(byData(r, "note", "review-independence")!.textContent).toContain("not re-derived here");
    expect(byData(r, "note", "source-only")!.textContent).toContain("source-only");
    expect(byData(r, "note", "order")!.textContent).toContain("need attention first");
    expect(allData(r, "matrixState").length).toBe(0);
    expect(byData(r, "matrixPartial")).toBeUndefined();
    expectNoGreen(r, "default");
  });
  it("EXPLICIT: no project is ever shown verified, healthy or green without real evidence — across completed, clean-reviewed, accepted-delivery, empty, partial and unreadable scenarios", async () => {
    const scenarios: Array<[string, (p: string) => any]> = [
      ["default", serve()],
      ["empty runs", serve({"/v1/work-runs": {runs: []}})],
      ["only completed", serve({"/v1/missions": {missions: [missionRow(ME1, PE, "COMPLETE", T0)]}, "/v1/work-runs": {runs: [RUNS.runs[4]]}})],
      ["missions down", serve({"/v1/missions": down()})],
      ["runs down", serve({"/v1/work-runs": down(404)})],
      ["cockpit down", serve({"/v1/cockpit": () => { throw new Error("fetch failed"); }})],
      ["projects down", serve({"/v1/projects": down()})],
      ["malformed runs", serve({"/v1/work-runs": {runs: [{...RUNS.runs[0], status: "DONE"}]}})],
      ["everything down", () => { throw new Error("fetch failed"); }]];
    for (const [label, fn] of scenarios) {
      const {root: r} = await renderView(fn);
      expectNoGreen(r, label);
    }
    // Pozitif kontrol: tamamlanmış proje CLEAN-at-head inceleme rozetini alır (gerçek kanıt), ama durumu IDLE kalır ve teslimi NOT_VERIFIED'dır.
    const {root: r} = await renderView(serve({"/v1/missions": {missions: [missionRow(ME1, PE, "COMPLETE", T0)]}, "/v1/work-runs": {runs: [RUNS.runs[4]]}}));
    const e = rowFor(r, PE);
    expect(e.dataset.status).toBe("IDLE"); expect(pills(cell(e, "review"))).toEqual(["DONE"]); expect(pills(cell(e, "delivery"))).toEqual(["NOT_VERIFIED"]); expect(pills(cell(e, "status"))).toEqual(["IDLE"]);
    // Stale CLEAN başarı rozeti ALMAZ.
    const stale = runRow(RE1, ME1, PE, {status: "SUCCEEDED", headSha: sha("d")});
    const s = await renderView(serve({"/v1/missions": {missions: [missionRow(ME1, PE, "COMPLETE", T0)]}, "/v1/work-runs": {runs: [stale]}}));
    const se = cell(rowFor(s.root, PE), "review");
    expect(se.dataset).toMatchObject({kind: "CLEAN_STALE", verdict: "CLEAN", atHead: "0"}); expect(pills(se)).toEqual(["NOT_VERIFIED"]); expect(byData(se, "note", "stale-verdict")).toBeTruthy();
    expectNoGreen(s.root, "stale");
  });
  it("EVERY scenario in EN and TR renders without the verified-product constant (even though the API carries it) and without raw i18n keys", async () => {
    for (const lang of ["en", "tr"]) for (const fn of [serve(), serve({"/v1/work-runs": down()}), serve({"/v1/missions": down(404)}), serve({"/v1/projects": () => { throw new Error("fetch failed"); }}), serve({"/v1/cockpit": down()}), () => ({nonsense: true})]) {
      const {root: r} = await renderView(fn, lang);
      const s = surface(r);
      expect(s).not.toContain(FORBIDDEN);
      expect(r.textContent).not.toMatch(/product[\s_-]*verified/i);
      expect(s).not.toMatch(/\b(?:area\.)?matrix\.[A-Za-z0-9_.]+\b/);
      expect(s).not.toContain("undefined");
      expect(s).not.toContain("[object Object]");
      expect(s).not.toContain("NaN");
    }
    // API'nin taşıdığı tamamlanma kaydı alanı eşleyiciden geçse de hiçbir yerde görünmez.
    expect(JSON.stringify(RUNS)).toContain(FORBIDDEN);
    const core = await load("matrix-core.js");
    expect(JSON.stringify(core.buildMatrix({projects: core.mapMatrixProjects(PROJECTS), missions: core.mapMatrixMissions(MISSIONS), workRuns: core.mapMatrixWorkRuns(RUNS), cockpit: core.mapMatrixCockpit(cockpitBody())}))).not.toContain(FORBIDDEN);
  });
  it("each source fails independently with its own honest state; healthy sources stay intact, only dependent figures are withheld (—, never 0)", async () => {
    // Missions okunamıyor.
    let r = await renderView(serve({"/v1/missions": down()}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["missions", "ERROR"]]);
    expect(sourcesOf(r.root).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["projects", "VERIFIED"], ["missions", "ERROR"], ["workRuns", "VERIFIED"], ["cockpit", "VERIFIED"]]);
    expect(byData(r.root, "matrixState")!.textContent).toContain("GET /v1/missions");
    expect(byData(r.root, "matrixPartial")!.dataset.matrixPartial).toBe("missions");
    for (const row of rowsOf(r.root)) {
      for (const col of ["missions", "blocked", "awaiting"]) { const c = cell(row, col); expect(c.dataset.withheld, `${row.dataset.matrixRow}/${col}`).toBe("1"); expect("n" in c.dataset).toBe(false); expect(c.textContent).toContain("—"); expect(pills(c)).toEqual(["FAILED"]); }
      expect(cell(row, "runs").dataset.n).toBeDefined();
      expect(cell(row, "review").dataset.withheld).toBeUndefined();
      expect(allData(row, "journey").length).toBe(0); // son mission okunamadığı için Journey düğmesi tahmin edilmez
    }
    expect(rowFor(r.root, PA).dataset.status).toBe("ATTENTION_NEEDED"); expect(byData(cell(rowFor(r.root, PA), "status"), "note", "partial")).toBeTruthy();
    expect(rowFor(r.root, PD).dataset.status).toBe("UNKNOWN"); expect(byData(cell(rowFor(r.root, PD), "status"), "note", "unknown")!.getAttribute("role")).toBe("status");
    expect(kpiValue(r.root, "attention")).toBe("—"); expect(kpi(r.root, "attention").dataset.state).toBe("ERROR");
    expect(byData(r.root, "reconcile", "agree")!.dataset.compared).toBe("projects"); // mission listesi okunamadığı için yalnız proje sayısı karşılaştırılır
    expect(kpiValue(r.root, "projects")).toBe("5"); expect(kpiValue(r.root, "missions")).toBe("5");
    expect(groupsOf(r.root).map(g => g.dataset.matrixGroup)).toEqual(["ATTENTION_NEEDED", "UNKNOWN"]);
    // Work runs okunamıyor.
    r = await renderView(serve({"/v1/work-runs": down(404)}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["workRuns", "UNAVAILABLE"]]);
    for (const row of rowsOf(r.root)) {
      for (const col of ["runs", "blocked", "awaiting", "review", "delivery"]) { const c = cell(row, col); expect(c.dataset.withheld, `${row.dataset.matrixRow}/${col}`).toBe("1"); expect(c.textContent).toContain("—"); expect(pills(c)).toEqual(["UNAVAILABLE"]); }
      expect(cell(row, "missions").dataset.n).toBeDefined();
    }
    expect(rowFor(r.root, PD).dataset.status).toBe("UNKNOWN");
    // Kokpit okunamıyor: satırlar sağlam, yalnız kokpit sayıları saklanır.
    r = await renderView(serve({"/v1/cockpit": down()}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["cockpit", "ERROR"]]);
    for (const id of ["projects", "missions", "awaiting", "workers", "evidence"]) { expect(kpiValue(r.root, id), id).toBe("—"); expect(kpi(r.root, id).dataset.state, id).toBe("ERROR"); }
    expect(kpiValue(r.root, "attention")).toBe("2");
    expect(rowsOf(r.root).length).toBe(5);
    expect(byData(r.root, "fact", "globalStop")!.dataset.globalStop).toBe("unknown");
    expect(byData(r.root, "reconcile")).toBeUndefined();
    // Projeler okunamıyor: satır yok ve "boş" da denmez; kokpit toplamları sağlam kalır.
    r = await renderView(serve({"/v1/projects": () => { throw new Error("fetch failed"); }}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["projects", "OFFLINE"]]);
    expect(rowsOf(r.root).length).toBe(0);
    expect(byData(r.root, "matrixEmpty")!.dataset.matrixEmpty).toBe("unknown");
    expect(allData(r.root, "matrixEmpty", "1").length).toBe(0);
    expect(kpiValue(r.root, "projects")).toBe("5"); expect(kpiValue(r.root, "attention")).toBe("—");
  });
  it("when everything is unreadable no figure, row or group is shown, and nothing is called empty, idle, healthy or zero", async () => {
    for (const [fn, expected] of [[() => { throw new Error("fetch failed"); }, "OFFLINE"], [() => fail("x", 404), "UNAVAILABLE"], [() => fail("x", 500), "ERROR"], [() => ({nonsense: true}), "ERROR"]] as const) {
      const {root: r} = await renderView(fn);
      expect(rowsOf(r).length, expected).toBe(0);
      expect(groupsOf(r).length).toBe(0);
      expect(allData(r, "matrixState").map(n => n.dataset.matrixState), expected).toEqual([expected, expected, expected, expected]);
      for (const id of ["projects", "missions", "awaiting", "attention", "workers", "evidence"]) { expect(kpiValue(r, id), id).toBe("—"); expect(kpi(r, id).dataset.state, id).toBe(expected); }
      expect(byData(r, "matrixEmpty")!.dataset.matrixEmpty).toBe("unknown");
      expect(healthyClaims(r)).toEqual([]);
      expectNoGreen(r, expected);
    }
  });
  it("a malformed record rejects only its own source: no partial rows or figures from that source, the other sources stay readable", async () => {
    let r = await renderView(serve({"/v1/projects": {projects: [...PROJECTS.projects, projectRow("prj_bad", "Broken")]}}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["projects", "ERROR"]]);
    expect(rowsOf(r.root).length).toBe(0); // tek bozuk proje, sağlam projeleri de göstermez (kısmi liste yok)
    expect(kpiValue(r.root, "missions")).toBe("5");
    r = await renderView(serve({"/v1/work-runs": {runs: [RUNS.runs[0], {...RUNS.runs[1], status: "DONE"}]}}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["workRuns", "ERROR"]]);
    expect(rowsOf(r.root).length).toBe(5);
    for (const row of rowsOf(r.root)) expect(cell(row, "runs").dataset.withheld).toBe("1");
    r = await renderView(serve({"/v1/cockpit": cockpitBody({missions: {state: "VERIFIED", total: 99, byStatus: {EXECUTING: 1}}})}));
    expect(allData(r.root, "matrixState").map(n => [n.dataset.source, n.dataset.matrixState])).toEqual([["cockpit", "ERROR"]]);
    expect(kpiValue(r.root, "missions")).toBe("—");
    expect(rowsOf(r.root).length).toBe(5);
  });
  it("a cockpit total that disagrees with the lists is shown as such (both values as read), and unlisted missions/runs are counted", async () => {
    let r = await renderView(serve({"/v1/cockpit": cockpitBody({projects: {state: "VERIFIED", count: 7}})}));
    const mm = allData(r.root, "reconcileKey");
    expect(mm.map(n => [n.dataset.reconcileKey, n.dataset.cockpit, n.dataset.matrix])).toEqual([["projects", "7", "5"]]);
    expect(mm[0].textContent).toBe("Cross-check: the cockpit counts 7 projects but the project list has 5. Both are shown as read.");
    expect(byData(r.root, "reconcile", "agree")).toBeUndefined();
    expect(kpiValue(r.root, "projects")).toBe("7"); expect(rowsOf(r.root).length).toBe(5);
    r = await renderView(serve({"/v1/projects": {projects: [projectRow(PA, "Alpha Platform")]}, "/v1/cockpit": cockpitBody({projects: {state: "VERIFIED", count: 1}})}));
    expect(byData(r.root, "unlisted", "missions")!.dataset.n).toBe("3");
    expect(byData(r.root, "unlisted", "runs")!.dataset.n).toBe("3");
    expect(byData(r.root, "unlisted", "missions")!.textContent).toContain("3 missions belong to a project that is not in the project list");
    expect(rowsOf(r.root).length).toBe(1);
  });
  it("honest empty state: no projects is a readable zero with explicit text; projects without missions/runs are NO_ACTIVITY with real zeros (only when the sources were READ)", async () => {
    let r = await renderView(serve({"/v1/projects": {projects: []}, "/v1/cockpit": cockpitBody({projects: {state: "VERIFIED", count: 0}, missions: {state: "VERIFIED", total: 0, byStatus: {}}, awaitingApproval: {state: "VERIFIED", items: []}})}));
    expect(rowsOf(r.root).length).toBe(0);
    expect(byData(r.root, "matrixEmpty", "1")!.textContent).toBe("No projects are registered yet. This is a real, readable zero.");
    expect(kpiValue(r.root, "projects")).toBe("0"); expect(kpiValue(r.root, "attention")).toBe("0");
    r = await renderView(serve({"/v1/missions": {missions: []}, "/v1/work-runs": {runs: []}}));
    expect(rowsOf(r.root).length).toBe(5);
    for (const row of rowsOf(r.root)) { expect(row.dataset.status).toBe("NO_ACTIVITY"); expect(cell(row, "missions").dataset.n).toBe("0"); expect(cell(row, "blocked").dataset.n).toBe("0"); expect(cell(row, "awaiting").dataset.n).toBe("0"); }
    expect(groupsOf(r.root).map(g => g.dataset.matrixGroup)).toEqual(["NO_ACTIVITY"]);
    expect(kpiValue(r.root, "attention")).toBe("0");
  });
  it("very long lists are truncated honestly (the first 200 most urgent shown, the real total stated) while the rollup covers ALL projects", async () => {
    const ids = Array.from({length: 205}, (_, i) => "prj_" + (i + 1).toString(16).padStart(24, "0"));
    const projects = {projects: ids.map((id, i) => projectRow(id, `P${String(i).padStart(3, "0")}`))};
    const missions = {missions: [missionRow(MID("f9"), ids[204], "BLOCKED", T0)]};
    const {root: r} = await renderView(serve({"/v1/projects": projects, "/v1/missions": missions, "/v1/work-runs": {runs: []}, "/v1/cockpit": cockpitBody({projects: {state: "VERIFIED", count: 205}, missions: {state: "VERIFIED", total: 1, byStatus: {BLOCKED: 1}}, awaitingApproval: {state: "VERIFIED", items: []}})}));
    expect(rowsOf(r).length).toBe(200);
    expect(byData(r, "note", "truncated")!.textContent).toBe("Showing the first 200 of 205 projects (most urgent first).");
    expect(kpiValue(r, "projects")).toBe("205"); expect(kpiValue(r, "attention")).toBe("1");
    expect(rowsOf(r)[0].dataset.matrixRow).toBe(ids[204]); // en acil olan kırpılmaz
    expect(groupsOf(r).map(g => [g.dataset.matrixGroup, g.dataset.n])).toEqual([["ATTENTION_NEEDED", "1"], ["NO_ACTIVITY", "204"]]);
    expect(allData(r, "matrixRows", "200").length).toBe(1);
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const {root: r} = await renderView(serve({"/v1/projects": {projects: [projectRow(PA, evil, {environmentId: "<b>env</b>"})]}, "/v1/missions": {missions: [missionRow(MA1, PA, "EXECUTING", T0, {title: evil})]}, "/v1/work-runs": {runs: []}, "/v1/cockpit": cockpitBody()}));
    expect(cell(rowFor(r, PA), "project").textContent).toContain(evil);
    expect(all(r).some(n => n.tagName === "IMG" || n.tagName === "B" || n.tagName === "SCRIPT")).toBe(false);
    expect(read("views", "matrix.js")).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root: r} = await renderView(serve(), "tr");
    expect(byId(r, "view-title")!.textContent).toBe("Çoklu Proje Komuta Matrisi");
    expect(rowsOf(r).map(n => n.dataset.matrixRow)).toEqual([PA, PB, PC, PE, PD]);
    expect(allData(r, "col").filter(n => n.tagName === "TH" && n.getAttribute("scope") === "col").map(n => n.textContent)).toEqual(["Proje", "Durum", "Mission'lar", "İş koşuları", "Engelli", "Onay bekleyen", "Son inceleme", "Teslim (yalnız kaynak)", "Aç"]);
    expect(groupsOf(r)[0].textContent).toContain("Dikkat gerektiriyor · 2");
    expect(cell(rowFor(r, PA), "status").textContent).toContain("Onay bekleyen koşular: 1");
    expect(cell(rowFor(r, PA), "delivery").textContent).toContain("DOĞRULANMADI");
    expect(byData(cell(rowFor(r, PA), "review"), "verbatim", "1")!.textContent).toBe("CLEAN"); // karar dile göre değişmez
    expect(kpiValue(r, "projects")).toBe("5");
    expectNoGreen(r, "tr");
  });
  it("row actions only navigate to existing screens: they select the project context and the latest readable mission, never POST or fabricate a decision", async () => {
    const posts: unknown[][] = [];
    const view = await load("views", "matrix.js"), forms = await load("forms.js");
    const {ctx, nav, picks, calls} = await mkCtx(serve(), "en", (p, b) => { posts.push([p, b]); return {status: 200, body: {}}; });
    const rootNode: N = await view.render(ctx);
    const alpha = rowFor(rootNode, PA);
    const btns = all(alpha).filter(n => n.tagName === "BUTTON");
    expect(btns.map(b => b.dataset.navigate)).toEqual(["projects", "work", "journey"]);
    expect(btns.map(b => b.textContent)).toEqual(["Project", "Work", "Journey"]);
    expect(btns.map(b => b.getAttribute("aria-label"))).toEqual(["Open project Alpha Platform", "Open work for Alpha Platform", "Open the journey of the latest mission of Alpha Platform"]);
    expect(btns.every(b => b.getAttribute("type") === "button")).toBe(true);
    click(btns[0]); expect(nav).toEqual(["projects"]); expect(picks).toEqual([PA]);
    forms.selection.missionId = null;
    click(btns[1]); expect(nav).toEqual(["projects", "work"]); expect(picks).toEqual([PA, PA]); expect(forms.selection.missionId).toBe(MA2);
    forms.selection.missionId = null;
    click(btns[2]); expect(nav).toEqual(["projects", "work", "journey"]); expect(forms.selection.missionId).toBe(MA2);
    expect(posts).toEqual([]);
    expect(calls.every(c => FOUR.includes(c))).toBe(true);
    // Mission'ı olmayan proje: Journey düğmesi yoktur.
    expect(all(rowFor(rootNode, PD)).filter(n => n.tagName === "BUTTON").map(b => b.dataset.navigate)).toEqual(["projects", "work"]);
    // Her gezinme hedefi mevcut bir rotadır; formlar yoktur.
    const routes = await load("routes.js");
    for (const b of all(rootNode).filter(n => n.tagName === "BUTTON")) expect(routes.routeById(b.dataset.navigate!), b.dataset.navigate).toBeTruthy();
    expect(all(rootNode).some(n => n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "FORM" || n.tagName === "SELECT")).toBe(false);
    forms.selection.missionId = null;
  });
});

// ---------------- (6) accessibility ----------------
describe("Matrix — accessibility", () => {
  it("single labelled h1, exactly two labelled sections, a labelled KPI group, a captioned table with column/row/group headers inside a labelled focusable scroll region", async () => {
    const {root: r} = await renderView(serve());
    const h1 = all(r).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    const ids2 = ["matrix-rollup", "matrix-grid"];
    expect(all(r).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(ids2);
    for (const id of ids2) expect(byId(r, byId(r, id)!.getAttribute("aria-labelledby")!), id).toBeTruthy();
    const group = all(r).find(n => n.getAttribute("role") === "group" && cls(n, "matrix-kpis"))!;
    expect(group.getAttribute("aria-label")).toBe("Portfolio totals");
    const tiles = allData(group, "kpi");
    expect(tiles.length).toBe(6);
    for (const t of tiles) {
      expect(t.tagName).toBe("ARTICLE");
      expect(byId(r, t.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
      expect(all(t).some(n => "pill" in n.dataset)).toBe(true);
    }
    for (const ul of all(r).filter(n => n.tagName === "UL" && cls(n, "company-sources"))) expect(ul.getAttribute("aria-label")).toBeTruthy();
    const region = all(r).find(n => cls(n, "matrix-scroll"))!;
    expect(region.getAttribute("role")).toBe("region"); expect(region.getAttribute("tabindex")).toBe("0"); expect(region.getAttribute("aria-label")).toBe("Project matrix, scrollable");
    const tables = all(r).filter(n => n.tagName === "TABLE");
    expect(tables.length).toBe(1);
    expect(tables[0].parent).toBe(region);
    const cap = tables[0].children[0];
    expect(cap.tagName).toBe("CAPTION"); expect(cap.textContent.length).toBeGreaterThan(20);
    const thead = tables[0].children[1];
    expect(thead.tagName).toBe("THEAD");
    const heads = all(thead).filter(n => n.tagName === "TH");
    expect(heads.length).toBe(9);
    for (const th of heads) { expect(th.getAttribute("scope")).toBe("col"); expect(th.textContent.length).toBeGreaterThan(0); }
    const bodies = tables[0].children.slice(2);
    expect(bodies.length).toBe(4);
    for (const tb of bodies) {
      expect(tb.tagName).toBe("TBODY");
      const gr = tb.children[0];
      expect(gr.tagName).toBe("TR");
      const gh = gr.children[0];
      expect(gh.tagName).toBe("TH"); expect(gh.getAttribute("scope")).toBe("colgroup"); expect(gh.getAttribute("colspan")).toBe("9"); expect(gr.children.length).toBe(1);
      for (const row of tb.children.slice(1)) {
        expect(row.tagName).toBe("TR");
        expect(row.children.length).toBe(9);
        expect(row.children[0].tagName).toBe("TH"); expect(row.children[0].getAttribute("scope")).toBe("row");
        row.children.slice(1).forEach(c => expect(c.tagName).toBe("TD"));
        expect(row.children.map(c => c.dataset.col)).toEqual(["project", "status", "missions", "runs", "blocked", "awaiting", "review", "delivery", "open"]);
        for (const t of all(row).filter(n => n.tagName === "TIME")) { expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(t.textContent.length).toBeGreaterThan(3); }
        for (const ul of all(row).filter(n => n.tagName === "UL")) expect(ul.getAttribute("aria-label")).toBeTruthy();
        const bg = all(row).find(n => n.getAttribute("role") === "group")!;
        expect(bg.getAttribute("aria-label")).toMatch(/^Open /);
        for (const b of all(bg).filter(n => n.tagName === "BUTTON")) { expect(b.textContent.length).toBeGreaterThan(0); expect(b.getAttribute("aria-label")!.length).toBeGreaterThan(b.textContent.length); expect(b.id).toMatch(/^mx-(project|work|journey)-prj_[0-9a-f]{24}$/); }
      }
    }
    // Kimlikler benzersiz.
    const ids = all(r).map(n => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every state pill carries text (state is never colour alone) and withheld cells carry a title explaining why", async () => {
    const {root: r} = await renderView(serve({"/v1/work-runs": down()}));
    for (const p of allData(r, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    for (const row of rowsOf(r)) expect(pills(row).length, row.dataset.matrixRow).toBeGreaterThanOrEqual(5);
    for (const w of allData(r, "withheld", "1")) { expect(w.getAttribute("title")).toBe("Not shown: Work runs could not be read"); expect(w.textContent).toContain("—"); }
  });
  it("failure blocks are status regions (role=status) with text, not colour alone", async () => {
    const {root: r} = await renderView(() => { throw new Error("fetch failed"); });
    const blocks = allData(r, "matrixState");
    expect(blocks.length).toBe(4);
    for (const b of blocks) { expect(b.getAttribute("role")).toBe("status"); expect(b.textContent).toContain("Offline"); expect(pills(b)).toContain("OFFLINE"); }
    expect(byData(r, "matrixEmpty")!.getAttribute("role")).toBe("status");
    expect(byData(r, "matrixPartial")!.getAttribute("role")).toBe("status");
  });
  it("styles.css has container-query, forced-colors, focus and scroll-region coverage for the matrix components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("Çoklu Proje Komuta Matrisi: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.matrix-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).toMatch(/\.matrix-scroll\{overflow-x:auto/);
    expect(mine).toMatch(/\.matrix-scroll:focus-visible\{outline:/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    // Anlam renkle taşınmaz: yalnız sol kenar vurgusu renklidir; durum metni/rozeti her satırda vardır.
    expect(mine).toMatch(/\.matrix-row\[data-status="ATTENTION_NEEDED"\] \.matrix-project\{box-shadow:inset 4px 0 0 var\(--warn\)\}/);
    expect(mine).not.toMatch(/var\(--ok\)/);
    for (const v of mine.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(css, v).toContain(`${v.slice(4, -1)}:`);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (7) locale parity ----------------
describe("Matrix — locale parity and key coverage", () => {
  const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("matrix.") || k.startsWith("area.matrix.")).sort();
  it("every matrix.* / area.matrix.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(100);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.matrix.title"]).toBe("Çoklu Proje Komuta Matrisi");
    expect(en["area.matrix.title"]).toBe("Multi-Project Command Matrix");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
    // Durum/grup/satır/sinyal metinleri sağlık ya da başarı dili kullanmaz (yalnız kayıtlı etkinliği anlatır).
    const claim = /healthy|verified|secure|\bpass(ed)?\b|\bok\b|all clear|\bready\b|\bgreen\b|sağlıklı|doğrulandı\b|güvenli/i;
    for (const k of sub(en).filter(k => /^matrix\.(status|group|groupDesc|row|signal|signals)\./.test(k))) { expect(en[k], k).not.toMatch(claim); expect(tr[k], k).not.toMatch(claim); }
    // Dürüstlük uyarısı "sağlıklı/doğrulanmış gösterilmez" der: bu tek istisnadır.
    expect(en["matrix.honesty"]).toContain("never shown as healthy or verified");
    // Teslim her yerde "NOT verified" / "DOĞRULANMADI" der.
    for (const k of ["matrix.delivery.ARTIFACT_PREPARED", "matrix.delivery.SOURCE_ACCEPTED"]) { expect(en[k]).toContain("NOT verified"); expect(tr[k]).toContain("DOĞRULANMADI"); }
  });
  it("every literal and enumerated key used by matrix.js exists in both dictionaries, and no matrix key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("matrix-core.js");
    const src = read("views", "matrix.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"((?:matrix|area\.matrix)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.MATRIX_SOURCES) { need.add(`matrix.src.${k}`); need.add(`matrix.srcShort.${k}`); }
    for (const k of core.UNKNOWN_DETAILS) { need.add(`matrix.state.${k}`); need.add(`matrix.hint.${k}`); }
    for (const k of ["projects", "missions", "awaiting", "attention", "workers", "evidence"]) { need.add(`matrix.kpi.${k}`); need.add(`matrix.kpi.q.${k}`); }
    need.add("matrix.kpi.q.evidenceDetail");
    for (const c of core.MATRIX_COLUMNS) need.add(`matrix.col.${c}`);
    for (const s of core.MATRIX_STATUSES) { need.add(`matrix.group.${s}`); need.add(`matrix.groupDesc.${s}`); if (s !== "UNKNOWN") need.add(`matrix.status.${s}`); }
    for (const s of core.SIGNAL_CODES) need.add(`matrix.signal.${s}`);
    for (const k of ["NONE", "NO_VALID_VERDICT"]) need.add(`matrix.review.${k}`);
    for (const k of core.DELIVERY_BEST) need.add(`matrix.delivery.${k}`);
    for (const k of ["blocked", "awaiting"]) need.add(`matrix.cell.${k}Split`);
    for (const k of ["project", "work", "journey"]) { need.add(`matrix.action.${k}`); need.add(`matrix.action.${k}.aria`); }
    for (const k of ["projects", "missions", "awaiting"]) { need.add(`matrix.reconcile.mismatch.${k}`); need.add(`matrix.reconcile.key.${k}`); }
    need.add("area.matrix.title"); need.add("area.matrix.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(100);
    // Sözlükte ölü anahtar kalmaz: her matrix.* anahtarı görünümde/çekirdekte kullanılır.
    expect(Object.keys(en).filter(k => (k.startsWith("matrix.") || k.startsWith("area.matrix.")) && !need.has(k))).toEqual([]);
    // Core sabitleri sözleşmeyle uyumlu.
    expect(core.UNKNOWN_DETAILS).toEqual(["OFFLINE", "UNAVAILABLE", "ERROR"]);
    expect(core.MATRIX_STATUSES).toEqual(["ATTENTION_NEEDED", "UNKNOWN", "ACTIVE", "IDLE", "NO_ACTIVITY"]);
    expect(core.MATRIX_STATUSES.some((s: string) => /HEALTH|VERIFIED|OK|GREEN|READY|PASS/i.test(s))).toBe(false);
    expect(core.SIGNAL_CODES).toEqual(["MISSION_BLOCKED", "MISSION_FOUNDER_ATTENTION", "MISSION_PREFLIGHT", "RUN_AWAITING_APPROVAL", "RUN_BLOCKED", "RUN_DEGRADED"]);
    expect(core.MATRIX_COLUMNS.length).toBe(9);
    // Çekirdek sabitleri, çalıştırma durumları ve mission durumları sunucu sözleşmesinden gelir (kopya değil, aynı modül).
    const exec = await load("executive-core.js");
    expect(core.PILL_FOR_RUN_STATUS).toBe(exec.PILL_FOR_RUN_STATUS);
    for (const s of core.BLOCKED_RUN_STATUSES) expect(exec.RUN_STATUSES).toContain(s);
    expect(exec.RUN_STATUSES).toContain(core.DEGRADED_RUN_STATUS);
  });
});

// ---------------- (8) routing ----------------
describe("Matrix — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/matrix to the planned host with component 'matrix' (no plannedPackage), after posture and before settings, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("matrix");
    expect(r).toMatchObject({id: "matrix", hash: "#/matrix", view: "planned", component: "matrix", factory: false, icon: "layers"});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/matrix")).toBe("matrix");
    expect(routes.routeFromHash("#/matrix/")).toBe("matrix");
    expect(routes.routeFromHash("#/matrixx")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/Matrix")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-15)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "install", "audit", "domains", "integrations", "scheduler", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("matrix");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    // Eski rotalar etkilenmez.
    for (const id of ["posture", "readiness", "queue", "executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
    expect(routes.routeById("assurance")).toMatchObject({id: "assurance", hash: "#/assurance", view: "assurance", factory: true});
  });
  it("planned.js delegates the 'matrix' component to the real view; app.js VIEWS table has no matrix entry and is untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as matrix from "./matrix.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*matrix[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("matrix.js");
    expect(app).not.toMatch(/\bmatrix\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const rootNode: N = await planned.render(ctx, {id: "matrix", component: "matrix"});
    expect(cls(rootNode, "view-matrix")).toBe(true);
    expect(byId(rootNode, "view-title")!.textContent).toBe("Multi-Project Command Matrix");
    // Mevcut devredilen rotalar etkilenmez.
    const po = await planned.render((await mkCtx(() => ({nonsense: 1}))).ctx, {id: "posture", component: "posture"});
    expect(cls(po, "view-posture")).toBe(true);
    const e = await planned.render((await mkCtx(() => ({nonsense: 1}))).ctx, {id: "executive", component: "executive"});
    expect(cls(e, "view-executive")).toBe(true);
    const q = await planned.render((await mkCtx(() => ({nonsense: 1}))).ctx, {id: "queue", component: "queue"});
    expect(cls(q, "view-queue")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.matrix.title")).toBe("Çoklu Proje Komuta Matrisi");
    expect(i18n.translate("en", "area.matrix.desc")).toContain("Read-only.");
  });
});
// //TR: UI-DOMAIN-PACKS Alan Paketleri (#/domains) — kayıtlı alan paketlerinin salt-okunur listesi; fixture GERÇEK registries/domain-packs.json dosyasından gelir (sunucu bu dosyayı aynen döndürür). REGISTERED/ON_DEMAND/SEED_DOMAIN_PROFILE etkin, güncel ya da sertifikalı anlamına gelmez; hiçbir değer yükseltilmez.
const DOM: any = JSON.parse(fs.readFileSync(path.join(root, "registries", "domain-packs.json"), "utf8"));
const domServe = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/domains": DOM, ...over};
  if (!(p in m)) throw new Error(`${p}: HTTP 404`);
  if (m[p] instanceof Error) throw m[p];
  return m[p];
};
async function renderDom(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "domains.js");
  const posts: string[] = [];
  const m = await mkCtx(getFn, lang, (p: string) => { posts.push(p); throw new Error("POST must never be called"); });
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, posts, ...m};
}
const boom = (msg: string) => new Error(msg);
const domItems = (r: N) => allData(r, "domainItem").filter(n => n.tagName === "LI");
const domCount = (r: N) => all(allData(r, "domainCount")[0]).find(n => cls(n, "kpi-value"))!.textContent;
const domLines = (r: N) => all(r).map(n => n._text).filter(Boolean).join("\n");

describe("Domain Packs — route, reachability and allow-list", () => {
  it("routes.js maps #/domains to the planned host (component 'domains', no plannedPackage), after install and before settings, with an existing icon; app.js is untouched", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js"), i18n = await load("i18n.js");
    const r = routes.routeById("domains");
    expect(r).toMatchObject({id: "domains", hash: "#/domains", view: "planned", component: "domains", factory: false});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/domains")).toBe("domains");
    expect(routes.routeFromHash("#/domainsx")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("domains");
    expect(read("views", "planned.js")).toContain('import * as domains from "./domains.js"');
    expect(read("app.js")).not.toMatch(/domains/);
    for (const lang of ["en", "tr"]) expect(i18n.translate(lang, "area.domains.title")).not.toBe("area.domains.title");
  });
  it("GET /v1/domains is already admitted by the desktop allow-list; nothing else under that name is", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    const core = await load("domains-core.js");
    expect(allowed("/v1/domains")).toBe(true);
    expect(core.DOMAINS_PATH).toBe("/v1/domains");
    for (const p of ["/v1/domains?x=1", "/v1/domains/x", "/v1/domains/activate", "/v1/domain"]) expect(allowed(p), p).toBe(false);
  });
});

describe("Domain Packs — strict mapping of the real registry shape", () => {
  it("maps the real registries/domain-packs.json (count, ids, verbatim values)", async () => {
    const core = await load("domains-core.js");
    const m = core.mapDomains(DOM);
    expect(m.state).toBe("VERIFIED");
    expect(m.registry.count).toBe(DOM.count);
    expect(m.registry.items[0]).toMatchObject({id: DOM.domains[0].id, name: DOM.domains[0].name, status: "REGISTERED", activation: "ON_DEMAND", knowledgeState: "SEED_DOMAIN_PROFILE"});
    expect(m.registry.byStatus).toEqual([{value: "REGISTERED", count: DOM.count}]);
  });
  it("rejects contradictory or malformed responses wholesale (count mismatch, duplicate id, bad enum, missing name, wrong key, path traversal, over the cap)", async () => {
    const core = await load("domains-core.js");
    const d = (over: Record<string, any> = {}) => ({id: "domain-x", name: "X", status: "REGISTERED", activation: "ON_DEMAND", profilePath: "domain-packs/x.json", knowledgeState: "SEED_DOMAIN_PROFILE", freshnessPolicy: "MISSION_TIME_REVALIDATION_REQUIRED", ...over});
    const bads: Array<[string, any]> = [
      ["count", {count: 2, domains: [d()]}], ["dup", {count: 2, domains: [d(), d()]}], ["enum", {count: 1, domains: [d({status: "registered"})]}],
      ["name", {count: 1, domains: [d({name: ""})]}], ["key", {count: 1, packs: [d()]}], ["null", null], ["arr", []], ["row", {count: 1, domains: ["x"]}],
      ["trav", {count: 1, domains: [d({profilePath: "../secret.json"})]}], ["abs", {count: 1, domains: [d({profilePath: "/etc/passwd"})]}],
      ["cap", {count: 501, domains: Array.from({length: 501}, (_, i) => d({id: `domain-${i}`}))}]
    ];
    for (const [label, raw] of bads) { const m = core.mapDomains(raw); expect(m.state, label).toBe("ERROR"); expect(m.registry, label).toBeNull(); }
    // Unknown-but-well-formed values are carried verbatim, never promoted.
    expect(core.mapDomains({count: 1, domains: [d({status: "ACTIVE"})]}).registry.items[0].status).toBe("ACTIVE");
  });
  it("buildDomains reports a null count for an unreadable source (never 0)", async () => {
    const core = await load("domains-core.js");
    expect(core.buildDomains({state: "OFFLINE", registry: null})).toEqual({state: "OFFLINE", registry: null, count: null});
    expect(core.buildDomains(undefined).count).toBeNull();
    expect(core.buildDomains(core.mapDomains(DOM)).count).toBe(DOM.count);
  });
});

describe("Domain Packs — mapping limits (boundaries)", () => {
  const row = (i: number, over: Record<string, any> = {}) => ({id: `dp${i}`, name: `Pack ${i}`, status: "ACTIVE", activation: "OFF", knowledgeState: "UNKNOWN", ...over});
  const reg = (domains: any[], count = domains.length) => ({schemaVersion: "1", count, domains});
  it("accepts exactly MAX_DOMAINS entries and rejects one more", async () => {
    const core = await load("domains-core.js");
    expect(core.mapDomains(reg(Array.from({length: core.MAX_DOMAINS}, (_, i) => row(i)))).state).toBe("VERIFIED");
    expect(core.mapDomains(reg(Array.from({length: core.MAX_DOMAINS + 1}, (_, i) => row(i)))).state).toBe("ERROR");
  });
  it("count must equal the list length in both directions", async () => {
    const core = await load("domains-core.js");
    expect(core.mapDomains(reg([row(1), row(2)], 3)).state).toBe("ERROR");
    expect(core.mapDomains(reg([row(1), row(2)], 1)).state).toBe("ERROR");
    expect(core.mapDomains(reg([row(1), row(2)], 2)).state).toBe("VERIFIED");
  });
  it("names are kept up to 120 characters and cut there; a one-character name is kept", async () => {
    const core = await load("domains-core.js");
    expect(core.mapDomains(reg([row(1, {name: "n".repeat(120)})])).registry.items[0].name).toHaveLength(120);
    expect(core.mapDomains(reg([row(1, {name: "n".repeat(121)})])).registry.items[0].name).toHaveLength(120);
    expect(core.mapDomains(reg([row(1, {name: "x"})])).registry.items[0].name).toBe("x");
  });
  it("ids must be real strings (a number or one-element array is not coerced), optional fields may be null, profile paths may not have empty or dot-dot segments", async () => {
    const core = await load("domains-core.js");
    expect(core.mapDomains(reg([row(1, {id: 5})])).state).toBe("ERROR");
    expect(core.mapDomains(reg([row(1, {id: ["dp1"]})])).state).toBe("ERROR");
    const withNulls = core.mapDomains(reg([row(1, {freshnessPolicy: null, profilePath: null})]));
    expect(withNulls.state).toBe("VERIFIED");
    expect([withNulls.registry.items[0].freshnessPolicy, withNulls.registry.items[0].profilePath]).toEqual([null, null]);
    expect(core.mapDomains(reg([row(1, {profilePath: "a//b"})])).state).toBe("ERROR");
    expect(core.mapDomains(reg([row(1, {profilePath: "a/../b"})])).state).toBe("ERROR");
    expect(core.mapDomains(reg([row(1, {profilePath: "a/b/"})])).state).toBe("ERROR");
    expect(core.mapDomains(reg([row(1, {profilePath: "a/b.json"})])).state).toBe("VERIFIED");
  });
  it("a failed read keeps OFFLINE and UNAVAILABLE and maps every other state to ERROR with a null count", async () => {
    const core = await load("domains-core.js");
    for (const [inState, outState] of [["OFFLINE", "OFFLINE"], ["UNAVAILABLE", "UNAVAILABLE"], ["ERROR", "ERROR"], ["WHATEVER", "ERROR"]]) {
      const r = core.buildDomains({state: inState, registry: null});
      expect([r.state, r.count, r.registry]).toEqual([outState, null, null]);
    }
  });
  it("tallies are counted per value, count-descending then by name, and skip absent values", async () => {
    const core = await load("domains-core.js");
    const r = core.mapDomains(reg([row(1, {status: "D"}), row(2, {status: "C"}), row(3, {status: "B"}), row(4, {status: "B"}), row(5, {status: "A"})]));
    expect(r.registry.byStatus).toEqual([{value: "B", count: 2}, {value: "A", count: 1}, {value: "C", count: 1}, {value: "D", count: 1}]);
  });
});

describe("Domain Packs — rendering (read-only, verbatim values, honest states, accessibility)", () => {
  it("renders every domain pack with verbatim values, exact count, no controls, no writes, no 'active/verified/certified' claims, exactly one GET", async () => {
    const {root, posts, calls} = await renderDom(domServe());
    expect(cls(root, "view-domains")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Domain Packs");
    expect(domItems(root).length).toBe(DOM.count);
    expect(domCount(root)).toBe(String(DOM.count));
    for (const li of domItems(root)) { expect(li.dataset.status).toBe("REGISTERED"); expect(li.dataset.activation).toBe("ON_DEMAND"); expect(li.dataset.knowledgeState).toBe("SEED_DOMAIN_PROFILE"); }
    const first = domItems(root)[0];
    expect(domLines(first)).toContain(DOM.domains[0].name);
    expect(domLines(first)).toContain("SEED_DOMAIN_PROFILE");
    expect(all(root).filter(n => ["BUTTON", "A", "INPUT", "SELECT", "FORM"].includes(n.tagName)).length).toBe(0);
    expect(all(root).some(n => n.ls.size > 0)).toBe(false);
    expect(posts).toEqual([]);
    expect([...calls]).toEqual(["/v1/domains"]);
    expect(surface(root)).not.toContain(FORBIDDEN);
    expect(allData(first, "pill").length).toBe(0);
    for (const li of domItems(root)) expect(domLines(li)).not.toMatch(/\b(connected|active|enabled|installed|certified|verified|compliant|ready|healthy)\b/i);
  });
  it("accessibility: one h1 that is focusable, a labelled list, labelled count group, and status roles on state blocks", async () => {
    const {root} = await renderDom(domServe());
    const h1s = all(root).filter(n => n.tagName === "H1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].attrs.get("tabindex")).toBe("-1");
    expect(all(root).find(n => n.tagName === "UL" && n.attrs.get("aria-label") === "Registered domain packs")).toBeTruthy();
    expect(all(root).find(n => n.attrs.get("role") === "group" && n.attrs.get("aria-label"))).toBeTruthy();
    const down = await renderDom(domServe({"/v1/domains": boom("fetch failed")}));
    expect(byData(down.root, "domainState")!.attrs.get("role")).toBe("status");
    expect(byData(down.root, "domainWithheld")!.attrs.get("role")).toBe("status");
  });
  it("server text is written as text only (markup in a name stays literal)", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const dom = {...DOM, count: 1, domains: [{...DOM.domains[0], id: "domain-evil", name: evil}]};
    const {root} = await renderDom(domServe({"/v1/domains": dom}));
    const li = domItems(root)[0];
    expect(all(li).some(n => n.textContent === evil)).toBe(true);
    expect(all(li).every(n => n.tagName !== "IMG")).toBe(true);
  });
  it("a read failure shows an honest state and a dash count (never 0, never an empty list)", async () => {
    for (const err of [boom("fetch failed"), boom("HTTP 404"), boom("HTTP 500")]) {
      const {root} = await renderDom(domServe({"/v1/domains": err}));
      expect(domCount(root)).toBe("—");
      expect(domItems(root).length).toBe(0);
      expect(byData(root, "domainWithheld")).toBeTruthy();
      expect(byData(root, "domainEmpty")).toBeUndefined();
      expect(byData(root, "domainState")).toBeTruthy();
    }
  });
  it("a malformed registry (count mismatch) is rejected as a read failure, not rendered partially or as zero", async () => {
    const {root} = await renderDom(domServe({"/v1/domains": {...DOM, count: DOM.count + 1}}));
    expect(domCount(root)).toBe("—");
    expect(byData(root, "domainState", "ERROR")).toBeTruthy();
    expect(domItems(root).length).toBe(0);
  });
  it("a genuinely empty readable registry says only that it returned no entries, and its count is a real 0", async () => {
    const {root} = await renderDom(domServe({"/v1/domains": {schemaVersion: "2.0.0", count: 0, domains: []}}));
    expect(domCount(root)).toBe("0");
    expect(byData(root, "domainEmpty")!.textContent).toBe("The domain pack registry returned no entries.");
  });
  it("EN and TR render without raw i18n keys; domains.* locale keys have exact EN/TR key and placeholder parity", async () => {
    for (const lang of ["en", "tr"]) for (const over of [{}, {"/v1/domains": boom("fetch failed")}, {"/v1/domains": boom("HTTP 404")}, {"/v1/domains": {count: 9, domains: []}}]) {
      const {root} = await renderDom(domServe(over), lang);
      expect(surface(root), lang).not.toMatch(/\b(domains|area)\.[a-z][A-Za-z.]*\b/);
    }
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = (o: Record<string, string>) => Object.keys(o).filter(k => k.startsWith("domains.") || k === "area.domains.title" || k === "area.domains.desc").sort();
    expect(keys(en).length).toBeGreaterThan(25);
    expect(keys(tr)).toEqual(keys(en));
    const ph = (s: string) => (s.match(/\{[A-Za-z]+\}/g) ?? []).sort().join(",");
    for (const k of keys(en)) { expect(tr[k].length, k).toBeGreaterThan(0); expect(ph(tr[k]), k).toBe(ph(en[k])); }
  });
});
// //TR: UI-078 Uzantılar ve Entegrasyonlar (#/integrations) — yetenek/adaptör/fabrika kayıt defterlerinin salt-okunur listesi; fixture'lar GERÇEK registries/*.json dosyalarından gelir (sunucu bu dosyaları aynen döndürür). REGISTERED/NOT_IMPLEMENTED değerleri AYNEN gösterilir ("bağlı/etkin" ima edilmez), okunamayan kaynağın sayısı "—"dir (0 değil), hiçbir denetim/düğme/POST yoktur ve route app.js (korumalı) değişmeden planned.js üzerinden erişilir.
const regFile = (f: string): any => JSON.parse(fs.readFileSync(path.join(root, "registries", f), "utf8"));
const REG = {capabilities: regFile("capabilities.json"), adapters: regFile("tool-adapters.json"), fabrics: regFile("execution-fabrics.json")};
const INTEG_PATHS = {capabilities: "/v1/capabilities", adapters: "/v1/adapters", fabrics: "/v1/fabrics"};
const integServe = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/capabilities": REG.capabilities, "/v1/adapters": REG.adapters, "/v1/fabrics": REG.fabrics, ...over};
  if (!(p in m)) throw new Error(`${p}: HTTP 404`);
  const v = m[p];
  if (v instanceof Error) throw v;
  return v;
};
async function renderInteg(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "integrations.js");
  const posts: string[] = [];
  const m = await mkCtx(getFn, lang, (p: string) => { posts.push(p); throw new Error("POST must never be called"); });
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, posts, ...m};
}
const integCount = (r: N, k: string) => all(allData(r, "integCount", k)[0]).find(n => cls(n, "kpi-value"))!.textContent;
const lines = (r: N) => all(r).map(n => n._text).filter(Boolean).join("\n");
const integItems =(r: N) => allData(r, "integItem").filter(n => n.tagName === "LI");

describe("Integrations UI-078 — route, reachability and allow-list", () => {
  it("routes.js maps #/integrations to the planned host (component 'integrations', no plannedPackage), after audit and before settings, with an existing icon; reachable via the ROUTES-driven nav and palette without touching protected files", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("integrations");
    expect(r).toMatchObject({id: "integrations", hash: "#/integrations", view: "planned", component: "integrations", factory: false});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/integrations")).toBe("integrations");
    expect(routes.routeFromHash("#/integrationsx")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-4)).toEqual(["domains", "integrations", "scheduler", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("integrations");
    expect(read("views", "planned.js")).toContain('import * as integrations from "./integrations.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*integrations[^}]*\}\)/);
    expect(read("shell.js")).toContain("syncNav(doc,el(\"navList\"),ROUTES");
    expect(read("shell.js")).toContain("ROUTES.map(r=>({kind:\"action\",action:\"goto\"");
    expect(read("app.js")).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    expect(read("app.js")).not.toMatch(/integrations/);
    const i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) expect(i18n.translate(lang, "area.integrations.title")).not.toBe("area.integrations.title");
    expect(i18n.translate("en", "area.integrations.title")).toBe("Extensions & Integrations");
  });
  it("the three registry GET paths are already admitted by the desktop allow-list; nothing else under those names is", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    const core = await load("integrations-core.js");
    for (const p of Object.values(INTEG_PATHS)) expect(allowed(p), p).toBe(true);
    expect([core.CAPABILITIES_PATH, core.ADAPTERS_PATH, core.FABRICS_PATH]).toEqual(Object.values(INTEG_PATHS));
    for (const p of ["/v1/capabilities?x=1", "/v1/adapters/x", "/v1/fabrics/enable", "/v1/integrations", "/v1/adapters/install"]) expect(allowed(p), p).toBe(false);
  });
});

describe("Integrations UI-078 — mapping limits (boundaries)", () => {
  const cap = (i: number, over: Record<string, any> = {}) => ({id: `c${i}`, name: `Cap ${i}`, status: "REGISTERED", implementation: "NOT_IMPLEMENTED", ...over});
  const adp = (i: number, over: Record<string, any> = {}) => ({id: `a${i}`, category: "CLOUD", status: "REGISTERED", implementation: "NOT_IMPLEMENTED", ...over});
  const reg = (key: string, list: any[], count = list.length) => ({schemaVersion: "1", count, [key]: list});
  it("accepts exactly MAX_ITEMS entries and rejects one more", async () => {
    const core = await load("integrations-core.js");
    expect(core.mapCapabilities(reg("capabilities", Array.from({length: core.MAX_ITEMS}, (_, i) => cap(i)))).state).toBe("VERIFIED");
    expect(core.mapCapabilities(reg("capabilities", Array.from({length: core.MAX_ITEMS + 1}, (_, i) => cap(i)))).state).toBe("ERROR");
  });
  it("count must equal the list length in both directions; an unknown kind or non-object is ERROR", async () => {
    const core = await load("integrations-core.js");
    expect(core.mapCapabilities(reg("capabilities", [cap(1), cap(2)], 3)).state).toBe("ERROR");
    expect(core.mapCapabilities(reg("capabilities", [cap(1), cap(2)], 1)).state).toBe("ERROR");
    expect(core.mapRegistry("nope", reg("nope", [])).state).toBe("ERROR");
    expect(core.mapCapabilities([]).state).toBe("ERROR");
    expect(core.mapCapabilities(null).state).toBe("ERROR");
  });
  it("names are cut at 120 characters; ids and enum values must be real strings (a one-element array is not coerced)", async () => {
    const core = await load("integrations-core.js");
    expect(core.mapCapabilities(reg("capabilities", [cap(1, {name: "n".repeat(121)})])).registry.items[0].name).toHaveLength(120);
    expect(core.mapCapabilities(reg("capabilities", [cap(1, {name: "n".repeat(120)})])).registry.items[0].name).toHaveLength(120);
    expect(core.mapCapabilities(reg("capabilities", [cap(1, {id: ["c1"]})])).state).toBe("ERROR");
    expect(core.mapCapabilities(reg("capabilities", [cap(1, {status: ["REGISTERED"]})])).state).toBe("ERROR");
    expect(core.mapCapabilities(reg("capabilities", [cap(1, {implementation: ["NOT_IMPLEMENTED"]})])).state).toBe("ERROR");
    expect(core.mapAdapters(reg("adapters", [adp(1, {category: ["CLOUD"]})])).state).toBe("ERROR");
  });
  it("null optional fields are accepted as unknown (null), wrong types are rejected", async () => {
    const core = await load("integrations-core.js");
    const a = core.mapAdapters(reg("adapters", [adp(1, {requiresCertification: null, activation: null})]));
    expect(a.state).toBe("VERIFIED");
    expect([a.registry.items[0].requiresCertification, a.registry.items[0].activation]).toEqual([null, null]);
    expect(core.mapAdapters(reg("adapters", [adp(1, {requiresCertification: "true"})])).state).toBe("ERROR");
    expect(core.mapAdapters(reg("adapters", [adp(1, {requiresCertification: false})])).registry.items[0].requiresCertification).toBe(false);
    expect(core.mapAdapters(reg("adapters", [adp(1, {activation: ["ON"]})])).state).toBe("ERROR");
  });
  it("a failed read keeps OFFLINE and UNAVAILABLE and maps any other state to ERROR with null counts", async () => {
    const core = await load("integrations-core.js");
    for (const [inState, outState] of [["OFFLINE", "OFFLINE"], ["UNAVAILABLE", "UNAVAILABLE"], ["ERROR", "ERROR"], ["WHATEVER", "ERROR"]]) {
      const r = core.buildIntegrations({capabilities: {state: inState, registry: null}});
      expect(r.sources.capabilities.state).toBe(outState);
      expect(r.counts.capabilities).toBeNull();
    }
  });
  it("tallies sort by count descending, then by value", async () => {
    const core = await load("integrations-core.js");
    const r = core.mapCapabilities(reg("capabilities", [cap(1, {status: "D"}), cap(2, {status: "C"}), cap(3, {status: "B"}), cap(4, {status: "B"}), cap(5, {status: "A"})]));
    expect(r.registry.byStatus).toEqual([{value: "B", count: 2}, {value: "A", count: 1}, {value: "C", count: 1}, {value: "D", count: 1}]);
  });
});

describe("Integrations UI-078 — strict mapping of the real registry shapes", () => {
  it("maps the real registries/*.json files (counts, ids, verbatim REGISTERED / NOT_IMPLEMENTED values)", async () => {
    const core = await load("integrations-core.js");
    const c = core.mapCapabilities(REG.capabilities), a = core.mapAdapters(REG.adapters), f = core.mapFabrics(REG.fabrics);
    for (const x of [c, a, f]) expect(x.state).toBe("VERIFIED");
    expect(c.registry.count).toBe(REG.capabilities.count);
    expect(a.registry.count).toBe(REG.adapters.count);
    expect(f.registry.count).toBe(REG.fabrics.count);
    expect(c.registry.items[0]).toMatchObject({id: "UASCO-CAP-001", name: "Mission OS", status: "REGISTERED", implementation: "NOT_IMPLEMENTED", activation: "ON_DEMAND"});
    expect(a.registry.items[0]).toMatchObject({id: "playwright", category: "BROWSER", status: "REGISTERED", implementation: "NOT_IMPLEMENTED", requiresCertification: true});
    expect(c.registry.byStatus).toEqual([{value: "REGISTERED", count: REG.capabilities.count}]);
    expect(a.registry.byImplementation).toEqual([{value: "NOT_IMPLEMENTED", count: REG.adapters.count}]);
  });
  it("rejects contradictory or malformed responses wholesale (count mismatch, duplicate id, bad enum, missing name, wrong list key, non-boolean flag, over the cap)", async () => {
    const core = await load("integrations-core.js");
    const cap = (over: Record<string, any> = {}) => ({id: "UASCO-CAP-901", name: "X", status: "REGISTERED", activation: "ON_DEMAND", implementation: "NOT_IMPLEMENTED", ...over});
    const bads: Array<[string, any]> = [
      ["count", {count: 2, capabilities: [cap()]}], ["dup", {count: 2, capabilities: [cap(), cap()]}], ["enum", {count: 1, capabilities: [cap({status: "registered"})]}],
      ["impl", {count: 1, capabilities: [cap({implementation: 5})]}], ["name", {count: 1, capabilities: [cap({name: ""})]}], ["key", {count: 1, fabrics: [cap()]}],
      ["null", null], ["arr", []], ["row", {count: 1, capabilities: ["x"]}], ["cap", {count: 501, capabilities: Array.from({length: 501}, (_, i) => cap({id: `UASCO-CAP-${1000 + i}`}))}]
    ];
    for (const [label, raw] of bads) { const m = core.mapCapabilities(raw); expect(m.state, label).toBe("ERROR"); expect(m.registry, label).toBeNull(); }
    expect(core.mapAdapters({count: 1, adapters: [{id: "x1", category: "BROWSER", status: "REGISTERED", implementation: "NOT_IMPLEMENTED", requiresCertification: "yes"}]}).state).toBe("ERROR");
    expect(core.mapAdapters({count: 1, adapters: [{id: "x1", status: "REGISTERED", implementation: "NOT_IMPLEMENTED"}]}).state).toBe("ERROR");
    // An unknown-but-well-formed value is carried verbatim, never promoted or translated.
    const odd = core.mapCapabilities({count: 1, capabilities: [cap({status: "ACTIVE", implementation: "IMPLEMENTED"})]});
    expect(odd.registry.items[0]).toMatchObject({status: "ACTIVE", implementation: "IMPLEMENTED"});
  });
  it("buildIntegrations reports a null count for an unreadable source (never 0) and lists it as unreadable", async () => {
    const core = await load("integrations-core.js");
    const out = core.buildIntegrations({capabilities: core.mapCapabilities(REG.capabilities), adapters: {state: "OFFLINE", registry: null}, fabrics: undefined});
    expect(out.counts).toEqual({capabilities: REG.capabilities.count, adapters: null, fabrics: null});
    expect(out.unreadable).toEqual(["adapters", "fabrics"]);
    expect(out.sources.adapters.state).toBe("OFFLINE");
    expect(out.complete).toBe(false);
  });
});

describe("Integrations UI-078 — rendering (read-only, verbatim values, honest states)", () => {
  it("renders every registry entry with verbatim status / implementation values, exact counts, no controls, no writes, no 'connected/active' claims", async () => {
    const {root, posts, calls} = await renderInteg(integServe());
    expect(cls(root, "view-integrations")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Extensions & Integrations");
    expect(integItems(root).length).toBe(REG.capabilities.count + REG.adapters.count + REG.fabrics.count);
    expect(integCount(root, "capabilities")).toBe(String(REG.capabilities.count));
    expect(integCount(root, "adapters")).toBe(String(REG.adapters.count));
    expect(integCount(root, "fabrics")).toBe(String(REG.fabrics.count));
    for (const li of integItems(root)) { expect(li.dataset.status).toBe("REGISTERED"); expect(li.dataset.implementation).toBe("NOT_IMPLEMENTED"); }
    const first = integItems(root).find(n => n.dataset.integItem === "UASCO-CAP-001")!;
    expect(lines(first)).toContain("REGISTERED");
    expect(lines(first)).toContain("NOT_IMPLEMENTED");
    expect(lines(first)).toContain("Mission OS");
    expect(allData(root, "field", "requiresCertification").length).toBe(REG.adapters.count);
    expect(allData(root, "tally").length).toBe(6);
    // Read-only: no buttons/links/inputs, no POSTs, exactly the three GETs.
    expect(all(root).filter(n => ["BUTTON", "A", "INPUT", "SELECT", "FORM"].includes(n.tagName)).length).toBe(0);
    expect(all(root).some(n => n.ls.size > 0)).toBe(false);
    expect(posts).toEqual([]);
    expect([...calls].sort()).toEqual(Object.values(INTEG_PATHS).sort());
    expect(surface(root)).not.toContain(FORBIDDEN);
    // Item rows never use state pills (no active/connected/verified iconography); only plain badges carry the recorded text.
    expect(allData(integItems(root)[0], "pill").length).toBe(0);
    // Only the entry rows are scanned (explanatory notes may name these words in the negative).
    for (const li of integItems(root)) expect(lines(li)).not.toMatch(/\b(connected|active|enabled|installed|ready|healthy)\b/i);
  });
  it("server text is written as text only (markup in a name stays literal)", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const caps = {...REG.capabilities, count: 1, capabilities: [{id: "UASCO-CAP-777", name: evil, status: "REGISTERED", activation: "ON_DEMAND", implementation: "NOT_IMPLEMENTED"}]};
    const {root} = await renderInteg(integServe({"/v1/capabilities": caps}));
    const li = integItems(root).find(n => n.dataset.integItem === "UASCO-CAP-777")!;
    expect(all(li).some(n => n.textContent === evil)).toBe(true);
    expect(all(li).every(n => n.tagName !== "IMG")).toBe(true);
  });
  it("a read failure shows an honest state and a dash count for THAT registry only (never 0, never an empty list); the others still render", async () => {
    for (const err of [boom("fetch failed"), boom("HTTP 404"), boom("HTTP 500")]) {
      const {root} = await renderInteg(integServe({"/v1/adapters": err}));
      expect(integCount(root, "adapters")).toBe("—");
      expect(integCount(root, "capabilities")).toBe(String(REG.capabilities.count));
      expect(byData(root, "integWithheld", "adapters")).toBeTruthy();
      expect(byData(root, "integEmpty", "adapters")).toBeUndefined();
      expect(byData(root, "integState")).toBeTruthy();
      expect(byData(root, "integPartial")!.dataset.integPartial).toBe("adapters");
      expect(integItems(root).length).toBe(REG.capabilities.count + REG.fabrics.count);
    }
    const allDown = await renderInteg(integServe({"/v1/capabilities": boom("fetch failed"), "/v1/adapters": boom("fetch failed"), "/v1/fabrics": boom("fetch failed")}));
    for (const k of ["capabilities", "adapters", "fabrics"]) expect(integCount(allDown.root, k)).toBe("—");
    expect(integItems(allDown.root).length).toBe(0);
    expect(allData(allDown.root, "integEmpty").length).toBe(0);
    expect(byData(allDown.root, "integPartial")!.dataset.integPartial).toBe("capabilities,adapters,fabrics");
  });
  it("a malformed registry (count mismatch) is rejected as a read failure, not rendered partially or as zero", async () => {
    const {root} = await renderInteg(integServe({"/v1/fabrics": {...REG.fabrics, count: REG.fabrics.count + 1}}));
    expect(integCount(root, "fabrics")).toBe("—");
    expect(byData(root, "integState", "ERROR")).toBeTruthy();
    expect(byData(root, "integWithheld", "fabrics")).toBeTruthy();
  });
  it("a genuinely empty readable registry says only that it returned no entries, and its count is a real 0", async () => {
    const {root} = await renderInteg(integServe({"/v1/fabrics": {schemaVersion: "1.0.0", count: 0, fabrics: []}}));
    expect(integCount(root, "fabrics")).toBe("0");
    expect(byData(root, "integEmpty", "fabrics")!.textContent).toBe("The fabric registry returned no entries.");
  });
  it("EN and TR render without raw i18n keys; integrations.* locale keys have exact EN/TR parity", async () => {
    for (const lang of ["en", "tr"]) {
      for (const over of [{}, {"/v1/capabilities": boom("fetch failed")}, {"/v1/adapters": boom("HTTP 404")}, {"/v1/fabrics": {count: 9, fabrics: []}}]) {
        const {root} = await renderInteg(integServe(over), lang);
        expect(surface(root), lang).not.toMatch(/\b(integrations|area)\.[a-z][A-Za-z.]*\b/);
      }
    }
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = (o: Record<string, string>) => Object.keys(o).filter(k => k.startsWith("integrations.") || k === "area.integrations.title" || k === "area.integrations.desc").sort();
    expect(keys(en).length).toBeGreaterThan(50);
    expect(keys(tr)).toEqual(keys(en));
    for (const k of keys(en)) expect(tr[k].length, k).toBeGreaterThan(0);
  });
});

describe("Integrations UI-078 remediation — activation is a recorded policy value", () => {
  it("integrations.honesty states (EN+TR) that activation is a recorded policy value, not a live state, and it is rendered on the page", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    expect(en["integrations.honesty"]).toContain("An activation value is a policy value recorded in the registry, not a live state");
    expect(tr["integrations.honesty"]).toContain("Etkinleştirme (activation) değeri kayıt defterinde kayıtlı bir politika değeridir, canlı bir durum değildir");
    const view = await load("views", "integrations.js");
    expect(read("views", "integrations.js")).toContain('ctx.t("integrations.honesty")');
    expect(typeof view.render).toBe("function");
  });
});

