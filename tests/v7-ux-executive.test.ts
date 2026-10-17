// //TR: Bu test FA-V2-PRODUCT UI-236 "Kurucu Yönetim Özeti ve İcra Defteri" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek tohumlanmış Work OS verisinden (proje, mission, koşu, kanıt, gerçek git + kaynak teslimi hazırlama/kabulü) dönen GET /v1/cockpit + /v1/missions + /v1/work-runs + /v1/founder-attention gövdeleri saf eşleyicilerden (executive-core.js) ve görünümden (views/executive.js) geçer. (2) İZİN LİSTESİ — dört GET zaten izinlidir (main.mjs/control-boundary/server.ts/app.js DEĞİŞMEZ, EXTRA_GET_ROUTES büyümez), görünüm yalnız bu dört GET'i okur, hiçbir yazma/köprü çağrısı yapmaz. (3) SAF EŞLEYİCİLER — bozuk kimlik/enum/biçim/sayı fail-closed ERROR olur (kısmi görünüm yok), durumlar yükseltilmez, sıralama yeni-önce. (4) GÖRÜNÜM DÜRÜSTLÜĞÜ — kaynak başına OFFLINE/UNAVAILABLE/ERROR, boş durumlar, okunamayan göstergede 0 değil "—", teslim yalnız kaynak düzeyi (NOT_VERIFIED), ürün doğrulandı sabiti ASLA, uydurma yok. (5) ERİŞİLEBİLİRLİK, (6) YEREL AYNALIK (TR/EN birebir) ve (7) ROTA (planned.js devri, app.js VIEWS değişmez).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";
import {RUN_STATUSES as CORE_RUN_STATUSES, RUN_STEPS as CORE_RUN_STEPS} from "../core/workos/run-state.js";
import {ExecutionGate} from "../core/workos/execution-gate.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {T, setup, okScript, runner, api as relfxApi, HDR as RELFX_HDR, tmpRoot, rmTmp} from "./support/relfx.js";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (journey testi ile aynı desen) ----------------
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
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `executive-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const rows = (r: N) => allData(r, "run").filter(n => n.tagName === "LI");

async function mkCtx(getFn: (p: string) => any, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, rerender: async () => {}, settleFocus: () => {}};
  return {ctx, doc, calls};
}
const fail = (p: string, status = 404) => { throw new Error(`${p}: HTTP ${status}`); };

// ---------------- fixtures (sözleşme biçiminde) ----------------
const MSN1 = "msn_" + "ab".repeat(12), MSN2 = "msn_" + "cd".repeat(12), MSN3 = "msn_" + "ef".repeat(12);
const PRJ = "prj_" + "11".repeat(12);
const RUN1 = "run_" + "a1".repeat(12), RUN2 = "run_" + "b2".repeat(12), RUN3 = "run_" + "c3".repeat(12);
const sha = (c: string) => c.repeat(40);
const missionRow = (missionId: string, over: Record<string, any> = {}) => ({missionId, projectId: PRJ, tenantId: "tA", title: "Alpha mission", objective: "o", acceptanceCriteria: ["ac"], status: "EXECUTING", riskLevel: "R1", createdAt: "2026-10-16T01:00:00.000Z", createdBy: "x", traceId: "trc_" + "aa".repeat(12), ...over});
const MISSIONS = {missions: [missionRow(MSN1, {title: "Alpha mission", status: "EXECUTING", createdAt: "2026-10-16T01:00:00.000Z"}), missionRow(MSN2, {title: "Beta mission", status: "AUTHORIZED", createdAt: "2026-10-15T01:00:00.000Z"}), missionRow(MSN3, {title: "Gamma mission", status: "PREFLIGHT", riskLevel: "R0", createdAt: "2026-10-14T01:00:00.000Z"})]};
const ev = (kind: string, cycle: number, over: Record<string, any> = {}) => ({evidenceId: "evd_" + kind.toLowerCase() + cycle, step: "IMPLEMENT", cycle, kind, argv: [], startedAt: "2026-10-16T02:00:00.000Z", endedAt: "2026-10-16T02:00:01.000Z", exitCode: 0, logPath: null, logSha256: null, ...over});
const runRow = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, projectId: PRJ, tenantId: "tA", roleId: null, executor: {implementer: "IMPL", reviewer: "REV"}, leaseId: null, leaseExpiresAt: null, attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 1, retryCount: 0, retryAt: null, reason: null,
  baseSha: sha("b"), headSha: sha("c"), workBranch: "b", checkpoints: [], evidence: [ev("IMPLEMENT", 0, {commitSha: sha("a")}), ev("REVIEW", 0, {step: "REVIEW", commitSha: sha("a"), reviewerIdentity: "REV-1", verdict: "BLOCKED"}), ev("IMPLEMENT", 1, {commitSha: sha("c")}), ev("REVIEW", 1, {step: "REVIEW", commitSha: sha("c"), reviewerIdentity: "REV-1", verdict: "CLEAN"})],
  createdAt: "2026-10-16T02:00:00.000Z", createdBy: "x", updatedAt: "2026-10-16T03:00:00.000Z", ...over});
const artifact = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, sourceCommit: sha("c"), treeSha: sha("d"), exportArtifactHash: "f".repeat(64), artifactPath: `deliveries/${runId}/${"f".repeat(64)}.zip`, ...over});
const accepted = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, sourceCommit: sha("c"), exportArtifactHash: "f".repeat(64), acknowledgements: {notExecuted: {acknowledgeNotExecuted: true}}, acceptedAt: "2026-10-16T03:30:00.000Z", ...over});
// Üç koşu: RUN1 (03:00, kabul edilmiş kaynak teslimi + CLEAN), RUN2 (05:00, çalışıyor, kanıt yok), RUN3 (04:00, FAILED + BLOCKED inceleme).
const RUNS = {runs: [
  runRow(RUN1, MSN1, {updatedAt: "2026-10-16T03:00:00.000Z", deliveryArtifact: artifact(RUN1, MSN1), sourceDelivery: accepted(RUN1, MSN1)}),
  runRow(RUN2, MSN2, {status: "RUNNING", step: "IMPLEMENT", remediationCycle: 0, headSha: null, baseSha: sha("b"), evidence: [], createdAt: "2026-10-16T04:30:00.000Z", updatedAt: "2026-10-16T05:00:00.000Z"}),
  runRow(RUN3, MSN3, {status: "FAILED", step: "REVIEW", reason: "REVIEW_BLOCKED", evidence: [ev("IMPLEMENT", 0, {commitSha: sha("e")}), ev("REVIEW", 0, {step: "REVIEW", commitSha: sha("e"), reviewerIdentity: "REV-2", verdict: "BLOCKED"})], headSha: sha("e"), updatedAt: "2026-10-16T04:00:00.000Z"})]};
const cockpitBody = (over: Record<string, any> = {}) => ({generatedAt: "2026-10-16T06:00:00.000Z", globalStop: {active: false, reason: null},
  projects: {state: "VERIFIED", count: 3}, missions: {state: "VERIFIED", total: 3, byStatus: {EXECUTING: 1, AUTHORIZED: 1, PREFLIGHT: 1}},
  awaitingApproval: {state: "VERIFIED", items: [{missionId: MSN3, projectId: PRJ, title: "Gamma mission", riskLevel: "R0"}]},
  orchestrator: {state: "VERIFIED", asOf: "2026-10-16T05:30:00.000Z", packages: {total: 4, byStatus: {MERGED: 3, QUEUED: 1}}, source: "ORCHESTRATOR_STATE"},
  workforce: {state: "VERIFIED", registeredRoles: 363, registeredRolesAuthority: "LEGACY_REFERENCE_ONLY", canonicalRegisteredRoles: 255, targetRoles: 255, activeWorkerRuns: 1, source: "x"},
  legacy: {scheduler: {authority: false, note: "LEGACY_SNAPSHOT"}}, evidence: {state: "VERIFIED", total: 10, verified: 8, mismatch: 1, missing: 1, unverifiable: 0, sources: {workos: "AVAILABLE"}}, ...over});
const attentionBody = (n = 2, over: Record<string, any> = {}) => ({blocked: Array.from({length: n}, (_, i) => ({packageId: `PKG-${i}`, kind: "REVIEW_PENDING_PROVIDER_QUOTA", retryable: false})), retryableKinds: [], schedulerVerification: "VERIFIED", ...over});
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/cockpit": cockpitBody(), "/v1/missions": MISSIONS, "/v1/work-runs": RUNS, "/v1/founder-attention": attentionBody(), ...over};
  return p in m ? m[p] : fail(p);
};
const FOUR = ["/v1/cockpit", "/v1/founder-attention", "/v1/missions", "/v1/work-runs"];

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-executive-")); });
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
const rowFor = (root: N, id: string) => rows(root).find(n => n.dataset.run === id)!;


const srcItems = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const evBase = (step: string, cycle: number, kind: string) => ({step, cycle, kind, argv: ["x"], startedAt: "2026-10-16T08:00:00.000Z", endedAt: "2026-10-16T08:00:01.000Z", exitCode: 0, logPath: null, logSha256: null}) as any;
// Gerçek Work OS store ile: 4 mission, 3 koşu (AWAITING_APPROVAL + CLEAN/2 sürüm, RUNNING + inceleme yok, FAILED + BLOCKED), 1 koşusuz mission.
async function seedRealStore(): Promise<{A: string; B: string; C: string; V0: string; V1: string; E0: string}> {
  const store = new WorkOsStore(dataDir());
  const tenantId = "tA", scope = {tenantId};
  const p = store.createProject({tenantId, orgId: "org1", name: "Exec", environmentId: "env-dev", createdBy: RECORDER});
  const mk = (title: string) => {
    const m = store.createMission({tenantId, projectId: p.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, m.missionId, to, "go", RECORDER);
    return m.missionId;
  };
  const BASE = "b".repeat(40), V0 = "a".repeat(40), V1 = "c".repeat(40), E0 = "e".repeat(40);
  const start = (missionId: string, tag: string) => {
    const r = store.createRun({tenantId, missionId, executor: {implementer: `IMPL-${tag}`, reviewer: `REV-${tag}`}, createdBy: RECORDER});
    return {runId: r.runId, leaseId: store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string};
  };
  const add = (r: {runId: string; leaseId: string}, step: string, cycle: number, kind: string, extra: Record<string, unknown>) => store.addRunEvidence(r.runId, r.leaseId, {...evBase(step, cycle, kind), ...extra}, "ENGINE");
  const to = (r: {runId: string; leaseId: string}, status: any, opts: any = {}) => store.transitionRun(r.runId, r.leaseId, status, "t", "ENGINE", opts);
  // A: döngü 0 BLOCKED, döngü 1 CLEAN (iki kaynak sürümü), Founder kararı bekliyor.
  const a = start(mk("Real A"), "A");
  to(a, "RUNNING", {patch: {baseSha: BASE, headSha: V0}});
  add(a, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE, commitSha: V0});
  add(a, "REVIEW", 0, "REVIEW", {commitSha: V0, reviewerIdentity: "REV-A", verdict: "BLOCKED", findingsCount: 1});
  to(a, "CHECKPOINTING");
  store.checkpointRun(a.runId, a.leaseId, {step: "IMPLEMENT", data: {}}, "ENGINE", {patch: {remediationCycle: 1, headSha: V1}});
  to(a, "RUNNING");
  add(a, "IMPLEMENT", 1, "IMPLEMENT", {baseSha: BASE, commitSha: V1});
  add(a, "REVIEW", 1, "REVIEW", {commitSha: V1, reviewerIdentity: "REV-A", verdict: "CLEAN", findingsCount: 0});
  to(a, "CHECKPOINTING"); to(a, "AWAITING_APPROVAL");
  await sleep(8);
  // C: tek sürüm, BLOCKED inceleme, FAILED.
  const c = start(mk("Real C"), "C");
  to(c, "RUNNING", {patch: {baseSha: BASE, headSha: E0}});
  add(c, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE, commitSha: E0});
  add(c, "REVIEW", 0, "REVIEW", {commitSha: E0, reviewerIdentity: "REV-C", verdict: "BLOCKED", findingsCount: 2});
  to(c, "FAILED");
  await sleep(8);
  // B: çalışıyor, yalnız kaynak sürümü; inceleme kanıtı yok.
  const b = start(mk("Real B"), "B");
  to(b, "RUNNING", {patch: {baseSha: BASE, headSha: V0}});
  add(b, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE, commitSha: V0});
  mk("Real D no run");
  return {A: a.runId, B: b.runId, C: c.runId, V0, V1, E0};
}

async function renderView(getFn: (p: string) => any, lang = "en") {
  const executive = await load("views", "executive.js");
  const m = await mkCtx(getFn, lang);
  const root: N = await executive.render(m.ctx);
  return {root, ...m};
}

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
describe("Executive — GENUINE control-api read-models flow through mappers and view", () => {
  it("real seeded Work OS data is shown verbatim: counts, newest-first ledger, two real source versions, real reviewer verdicts, honest NOT_PREPARED delivery", async () => {
    const seeded = await seedRealStore();
    const app = mkApp();
    const core = await load("executive-core.js");
    const raw = {cockpit: await getJson(app, "/v1/cockpit"), missions: await getJson(app, "/v1/missions"), runs: await getJson(app, "/v1/work-runs"), attention: await getJson(app, "/v1/founder-attention")};
    const cp = core.mapExecCockpit(raw.cockpit), ms = core.mapExecMissions(raw.missions), rn = core.mapExecWorkRuns(raw.runs), at = core.mapExecAttention(raw.attention);
    for (const r of [cp, ms, rn, at]) expect(r.state).toBe("VERIFIED");
    expect(cp.cockpit.projects).toEqual({state: "VERIFIED", count: 1});
    expect(cp.cockpit.missions.total).toBe(4);
    expect(ms.missions.total).toBe(4);
    expect(ms.missions.inProgress).toBe(4);
    // Orkestratör dosyaları yok => dürüst UNAVAILABLE ve sayı null (0 değil); kanonik rol sayısı kaynak yoksa null.
    expect(cp.cockpit.orchestrator).toMatchObject({state: "UNAVAILABLE", total: null});
    expect(cp.cockpit.workforce.registeredRoles).toBeNull();
    expect(cp.cockpit.workforce.activeWorkerRuns).toBe(1);
    expect(rn.runs).toMatchObject({total: 3, open: 1, awaiting: 1, ended: 1, prepared: 0, accepted: 0});
    expect(at.attention.blocked).toBe(0);

    const expectedOrder = [...raw.runs.runs].sort((x: any, y: any) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt)).map((r: any) => r.runId);
    expect(rn.runs.items.map((r: any) => r.runId)).toEqual(expectedOrder);
    expect(expectedOrder[0]).toBe(seeded.B); // en son yazılan koşu önce

    const executive = await load("views", "executive.js");
    const {ctx, calls} = await mkCtx(async p => getJson(app, p));
    const root: N = await executive.render(ctx);
    expect(calls.slice().sort()).toEqual(FOUR);
    expect(rows(root).map(n => n.dataset.run)).toEqual(expectedOrder);
    expect(kpiValue(root, "projects")).toBe("1");
    expect(kpiValue(root, "missions")).toBe("4");
    expect(kpiValue(root, "runs")).toBe("3");
    expect(kpiValue(root, "deliveries")).toBe("0");
    expect(kpiValue(root, "blocked")).toBe("0");
    const a = rowFor(root, seeded.A);
    expect(a.dataset.status).toBe("AWAITING_APPROVAL");
    expect(a.dataset.verdict).toBe("CLEAN");
    expect(a.dataset.delivery).toBe("NOT_PREPARED");
    expect(allData(a, "cycle").map(n => [n.dataset.cycle, n.dataset.commit])).toEqual([["0", seeded.V0], ["1", seeded.V1]]);
    expect(a.textContent).toContain("REV-A");
    expect(a.textContent).toContain(seeded.V1.slice(0, 12));
    expect(byData(a, "atHead", "1")).toBeTruthy();
    const b = rowFor(root, seeded.B);
    expect(b.dataset.verdict).toBe("NONE");
    expect(b.textContent).toContain("No reviewer verdict recorded");
    const c = rowFor(root, seeded.C);
    expect(c.dataset.verdict).toBe("BLOCKED");
    expect(c.dataset.status).toBe("FAILED");
    expect(pills(c)).toContain("BLOCKED");
    // Orkestratör gerçekten okunamadı: ilgili olgu "—" gösterir, sıfır göstermez.
    expect(byData(root, "fact", "orchestrator")!.textContent).toContain("—");
    expect(surface(root)).not.toContain(FORBIDDEN);
    expect(surface(root)).not.toMatch(/spill-product_verified/);
  });
  it("a real Work OS without any journal shows honest UNAVAILABLE cockpit figures (never a zero), and a real journal with only a project shows real zeros", async () => {
    // Günlük yok: sunucu bloklarını UNAVAILABLE bildirir; görünüm bunu "—" + durum olarak gösterir, 0 uydurmaz.
    let app = mkApp();
    let r = await renderView(p => getJson(app, p));
    for (const k of ["projects", "missions", "approvals", "evidence"]) { expect(kpiValue(r.root, k), k).toBe("—"); expect(kpi(r.root, k).dataset.state, k).toBe("UNAVAILABLE"); }
    expect(["orchestrator", "roles", "workers"].map(k => pills(byData(r.root, "fact", k)!))).toEqual([["UNAVAILABLE"], ["UNAVAILABLE"], ["UNAVAILABLE"]]);
    // Uç noktalar boş liste döndürdü (günlük yok => kayıtlı koşu yok): bu gerçek bir sıfırdır ve metinle belirtilir.
    expect(kpiValue(r.root, "runs")).toBe("0");
    expect(r.root.textContent).toContain("No work runs have been recorded yet.");
    await app.close(); apps.splice(0);
    fs.rmSync(path.join(tmp, "data"), {recursive: true, force: true});
    const store = new WorkOsStore(dataDir());
    store.createProject({tenantId: "tA", orgId: "org1", name: "Only a project", environmentId: "env-dev", createdBy: RECORDER});
    app = mkApp();
    r = await renderView(p => getJson(app, p));
    expect(kpiValue(r.root, "projects")).toBe("1");
    expect(kpiValue(r.root, "missions")).toBe("0");
    expect(kpiValue(r.root, "inProgress")).toBe("0");
    expect(kpiValue(r.root, "runs")).toBe("0");
    expect(kpiValue(r.root, "deliveries")).toBe("0");
    expect(rows(r.root).length).toBe(0);
    expect(r.root.textContent).toContain("No work runs have been recorded yet.");
    expect(allData(r.root, "executiveState").length).toBe(0);
  });
});

describe("Executive — REAL source delivery (real git + fake executors): prepared, then accepted, always source-only", () => {
  it("shows the real prepared and accepted delivery with the real artifact hash and commit; never a verified-product claim", { timeout: T }, async () => {
    const rt = tmpRoot("uasco-exec-m1a-");
    try {
      const c = setup(rt);
      const app = relfxApi(c, {sandbox: undefined}) as unknown as App; apps.push(app);
      const created = await app.inject({method: "POST", url: "/v1/projects", headers: RELFX_HDR, payload: {name: "Exec App", environmentId: "dev", template: "web-node", idempotencyKey: "exec-1"}});
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

      const view = async () => (await renderView(p => getJson(app, p, RELFX_HDR))).root;
      let root = await view();
      let row = rowFor(root, run.runId);
      expect(row.dataset.delivery).toBe("NOT_PREPARED");
      expect(row.dataset.verdict).toBe("CLEAN");
      expect(row.textContent).toContain(pair.reviewer.identity);
      expect(allData(row, "cycle").map(n => n.dataset.commit)).toEqual([run.headSha]);
      expect(kpiValue(root, "deliveries")).toBe("0");

      const prep = await app.inject({method: "POST", url: `/v1/work-runs/${run.runId}/delivery/prepare`, headers: RELFX_HDR, payload: {}});
      expect(prep.statusCode, prep.body).toBe(201);
      const art = prep.json().artifact;
      root = await view(); row = rowFor(root, run.runId);
      expect(row.dataset.delivery).toBe("ARTIFACT_PREPARED");
      expect(row.textContent).toContain(art.exportArtifactHash);
      expect(pills(row)).toContain("NOT_VERIFIED");
      expect(kpiValue(root, "deliveries")).toBe("0");
      expect(root.textContent).toContain("1 prepared and awaiting acceptance");

      const acc = await app.inject({method: "POST", url: `/v1/work-runs/${run.runId}/delivery/accept`, headers: RELFX_HDR, payload: {acceptance: {runId: art.runId, missionId: art.missionId, sourceCommit: art.sourceCommit, exportArtifactHash: art.exportArtifactHash, acknowledgeNotExecuted: true}}});
      expect(acc.statusCode, acc.body).toBe(200);
      root = await view(); row = rowFor(root, run.runId);
      expect(row.dataset.delivery).toBe("SOURCE_ACCEPTED");
      expect(row.textContent).toContain(art.exportArtifactHash);
      expect(row.textContent).toContain(String(art.sourceCommit).slice(0, 12));
      expect(row.textContent).toContain("Source delivery accepted · NOT verified");
      expect(byData(row, "note", "source-only")).toBeTruthy();
      expect(pills(row)).toContain("NOT_VERIFIED");
      expect(all(row).filter(n => n.tagName === "TIME").length).toBeGreaterThan(1);
      expect(kpiValue(root, "deliveries")).toBe("1");
      expect(pills(kpi(root, "deliveries"))).toContain("NOT_VERIFIED");
      // Gerçek tamamlanma kaydı yok (M1a: ürün doğrulanmadı): yalnız kaynak teslimi; yasak sabit hiçbir yerde yok.
      expect(byData(row, "completion", "recorded")).toBeUndefined();
      expect(surface(root)).not.toContain(FORBIDDEN);
      expect(root.textContent).not.toMatch(/product[\s_-]*verified/i);
      expect(pills(root)).not.toContain(FORBIDDEN);
    } finally { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(rt); }
  });
});

// ---------------- (2) allow-list ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Executive — only already-allow-listed read-only GETs are used (protected files unchanged)", () => {
  it("all four GET paths are already admitted by the desktop allow-list; nothing else is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    for (const p of FOUR) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/executive", "/v1/executive/summary", "/v1/ledger", "/v1/cockpit?x=1", "/v1/work-runs/", "/v1/missions?x=1"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes("executive")).toBe(false);
    expect(mainSrc).not.toContain("/v1/executive");
    expect(fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8")).not.toContain("/v1/executive");
    expect(fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")).not.toContain("/v1/executive");
  });
  it("executive.js / executive-core.js never write and never reach outside ctx.api: no post, bridge, fetch/XHR, eval, HTML sinks; imports are read-only modules", () => {
    for (const src of [read("views", "executive.js"), read("executive-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toContain(FORBIDDEN);
    }
    const imports = [...read("views", "executive.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort();
    expect(imports).toEqual(["../components.js", "../executive-core.js", "../model.js", "../work-core.js"]);
    expect([...read("executive-core.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1])).toEqual(["./work-core.js"]);
    for (const m of ["execCockpit", "execMissions", "execWorkRuns", "execAttention"]) expect(read("views", "executive.js")).toContain(`api.${m}(`);
    // api.js: yalnız bu dört GET sabit yoldan okunur; yeni POST yolu eklenmez (tek apiPost çağrısı korunur).
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
  });
  it("the api layer requests exactly the four fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls} = await mkCtx(serve());
    const core = await load("executive-core.js");
    expect(core.EXECUTIVE_SOURCE_PATHS).toEqual({cockpit: "/v1/cockpit", missions: "/v1/missions", workRuns: "/v1/work-runs", attention: "/v1/founder-attention"});
    expect(core.EXECUTIVE_SOURCES).toEqual(["cockpit", "missions", "workRuns", "attention"]);
    expect((await ctx.api.execCockpit()).state).toBe("VERIFIED");
    expect((await ctx.api.execMissions()).state).toBe("VERIFIED");
    expect((await ctx.api.execWorkRuns()).state).toBe("VERIFIED");
    expect((await ctx.api.execAttention()).state).toBe("VERIFIED");
    expect(calls).toEqual(["/v1/cockpit", "/v1/missions", "/v1/work-runs", "/v1/founder-attention"]);
    expect(ctx.api.execCockpit.length).toBe(0);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ["execCockpit", "execMissions", "execWorkRuns", "execAttention"]) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    expect((await ctx.api.execCockpit()).state).toBe("ERROR");
    expect((await ctx.api.execMissions()).state).toBe("ERROR");
    expect((await ctx.api.execWorkRuns()).state).toBe("ERROR");
    expect((await ctx.api.execAttention()).state).toBe("ERROR");
  });
});

// ---------------- (3) pure mappers ----------------
describe("Executive — pure mappers are fail-closed and never elevate state", () => {
  it("run status / step enums are an exact copy of core/workos/run-state.ts", async () => {
    const core = await load("executive-core.js");
    expect([...core.RUN_STATUSES].sort()).toEqual([...CORE_RUN_STATUSES].sort());
    expect([...core.RUN_STEPS]).toEqual([...CORE_RUN_STEPS]);
    for (const s of CORE_RUN_STATUSES) expect(core.PILL_FOR_RUN_STATUS[s], s).toBeTruthy();
  });
  it("mapExecCockpit accepts the contract shape, carries honest non-live blocks without numbers, and uses ONLY the canonical role count", async () => {
    const core = await load("executive-core.js");
    const ok = core.mapExecCockpit(cockpitBody());
    expect(ok.state).toBe("VERIFIED");
    expect(ok.cockpit).toMatchObject({generatedAt: "2026-10-16T06:00:00.000Z", globalStop: {active: false, reason: null}, projects: {state: "VERIFIED", count: 3}, missions: {state: "VERIFIED", total: 3, byStatus: {EXECUTING: 1, AUTHORIZED: 1, PREFLIGHT: 1}},
      awaiting: {state: "VERIFIED", count: 1}, orchestrator: {state: "VERIFIED", total: 4, byStatus: {MERGED: 3, QUEUED: 1}, asOf: "2026-10-16T05:30:00.000Z"}, workforce: {state: "VERIFIED", registeredRoles: 255, activeWorkerRuns: 1}, evidence: {state: "VERIFIED", total: 10, verified: 8, mismatch: 1, missing: 1, unverifiable: 0}});
    // Eski (legacy) 363 sayısı asla kayıtlı rol diye taşınmaz.
    expect(JSON.stringify(ok.cockpit)).not.toContain("363");
    const noCanon = core.mapExecCockpit(cockpitBody({workforce: {state: "VERIFIED", registeredRoles: 363, canonicalRegisteredRoles: null, activeWorkerRuns: 0}}));
    expect(noCanon.cockpit.workforce.registeredRoles).toBeNull();
    const honest = core.mapExecCockpit(cockpitBody({projects: {state: "UNAVAILABLE", count: 9}, missions: {state: "ERROR", total: null, byStatus: {}}, awaitingApproval: {state: "UNAVAILABLE", items: []},
      orchestrator: {state: "UNAVAILABLE", asOf: null, packages: {total: null, byStatus: {}}}, workforce: {state: "UNAVAILABLE", registeredRoles: 3, canonicalRegisteredRoles: null, activeWorkerRuns: null},
      evidence: {state: "ERROR", total: null, verified: null, mismatch: null, missing: null, unverifiable: null}}));
    expect(honest.state).toBe("VERIFIED");
    expect(honest.cockpit.projects).toEqual({state: "UNAVAILABLE", count: null});
    expect(honest.cockpit.missions).toEqual({state: "ERROR", total: null, byStatus: {}});
    expect(honest.cockpit.awaiting).toEqual({state: "UNAVAILABLE", count: null});
    expect(honest.cockpit.workforce).toEqual({state: "UNAVAILABLE", registeredRoles: null, activeWorkerRuns: null});
    expect(honest.cockpit.evidence.verified).toBeNull();
    const stopped = core.mapExecCockpit(cockpitBody({globalStop: {active: true, reason: "FOUNDER_STOP"}}));
    expect(stopped.cockpit.globalStop).toEqual({active: true, reason: "FOUNDER_STOP"});
  });
  it("any malformed cockpit field makes the WHOLE read ERROR (no partial values)", async () => {
    const core = await load("executive-core.js");
    const bad: any[] = [null, undefined, [], "x", {},
      cockpitBody({generatedAt: "not-a-date"}), cockpitBody({generatedAt: undefined}),
      cockpitBody({globalStop: null}), cockpitBody({globalStop: {active: "yes", reason: null}}), cockpitBody({globalStop: {active: false, reason: 5}}),
      cockpitBody({projects: {state: "OK", count: 1}}), cockpitBody({projects: {state: "VERIFIED", count: -1}}), cockpitBody({projects: {state: "VERIFIED", count: 1.5}}), cockpitBody({projects: {state: "VERIFIED", count: "3"}}), cockpitBody({projects: {state: "VERIFIED", count: null}}), cockpitBody({projects: null}),
      cockpitBody({missions: {state: "VERIFIED", total: 3, byStatus: {EXECUTING: 1}}}),
      cockpitBody({missions: {state: "VERIFIED", total: 3, byStatus: {EXECUTING: 1, AUTHORIZED: 1, BOGUS: 1}}}),
      cockpitBody({missions: {state: "VERIFIED", total: 3, byStatus: {EXECUTING: 1, AUTHORIZED: 1, PREFLIGHT: "1"}}}),
      cockpitBody({missions: {state: "VERIFIED", total: 3, byStatus: null}}),
      cockpitBody({awaitingApproval: {state: "VERIFIED", items: "none"}}), cockpitBody({awaitingApproval: {state: "VERIFIED", items: [{missionId: "bad"}]}}), cockpitBody({awaitingApproval: {state: "VERIFIED", items: [null]}}),
      cockpitBody({orchestrator: {state: "VERIFIED", asOf: null, packages: null}}),
      cockpitBody({orchestrator: {state: "VERIFIED", asOf: "bad", packages: {total: 1, byStatus: {MERGED: 1}}}}),
      cockpitBody({orchestrator: {state: "VERIFIED", asOf: null, packages: {total: 2, byStatus: {MERGED: 1}}}}),
      cockpitBody({orchestrator: {state: "VERIFIED", asOf: null, packages: {total: 1, byStatus: {merged: 1}}}}),
      cockpitBody({workforce: {state: "VERIFIED", canonicalRegisteredRoles: "255", activeWorkerRuns: 1}}),
      cockpitBody({workforce: {state: "VERIFIED", canonicalRegisteredRoles: 255}}),
      cockpitBody({workforce: {state: "VERIFIED", canonicalRegisteredRoles: 255, activeWorkerRuns: -2}}),
      cockpitBody({evidence: {state: "VERIFIED", total: 3, verified: 3, mismatch: 0, missing: 0}}),
      cockpitBody({evidence: {state: "MAYBE"}}), cockpitBody({evidence: undefined})];
    for (const b of bad) {
      const m = core.mapExecCockpit(b);
      expect(m.state, JSON.stringify(b)?.slice(0, 110)).toBe("ERROR");
      expect(m.cockpit).toBeNull();
    }
  });
  it("mapExecMissions counts in-progress from recorded statuses, sorts newest first, and one bad row (or duplicate) fails the whole read", async () => {
    const core = await load("executive-core.js");
    const ok = core.mapExecMissions(MISSIONS);
    expect(ok.state).toBe("VERIFIED");
    expect(ok.missions.total).toBe(3);
    expect(ok.missions.inProgress).toBe(2); // EXECUTING + AUTHORIZED (PREFLIGHT değil)
    expect(ok.missions.byStatus).toEqual({EXECUTING: 1, AUTHORIZED: 1, PREFLIGHT: 1});
    expect(ok.missions.items.map((m: any) => m.missionId)).toEqual([MSN1, MSN2, MSN3]);
    expect(core.mapExecMissions({missions: []})).toEqual({state: "VERIFIED", missions: {total: 0, inProgress: 0, byStatus: {}, items: []}});
    const shuffled = core.mapExecMissions({missions: [...MISSIONS.missions].reverse()});
    expect(shuffled.missions.items.map((m: any) => m.missionId)).toEqual([MSN1, MSN2, MSN3]);
    const m0 = MISSIONS.missions[0];
    const bad: any[] = [null, undefined, {}, {missions: "x"}, {missions: {}}, {missions: [null]},
      {missions: [{...m0, missionId: "bad"}]}, {missions: [{...m0, missionId: "MSN_" + "ab".repeat(12)}]}, {missions: [{...m0, projectId: "prj_x"}]}, {missions: [{...m0, status: "DONE"}]}, {missions: [{...m0, status: undefined}]},
      {missions: [{...m0, riskLevel: "R9"}]}, {missions: [{...m0, createdAt: "yesterday"}]}, {missions: [{...m0, title: ""}]}, {missions: [{...m0, title: undefined}]}, {missions: [m0, m0]}, {missions: [m0, {...MISSIONS.missions[1], missionId: "bad"}]}];
    for (const b of bad) expect(core.mapExecMissions(b).state, JSON.stringify(b)?.slice(0, 100)).toBe("ERROR");
  });
  it("mapExecWorkRuns derives versions / verdict / delivery verbatim from the record, counts every run once, and sorts newest activity first", async () => {
    const core = await load("executive-core.js");
    const m = core.mapExecWorkRuns(RUNS);
    expect(m.state).toBe("VERIFIED");
    expect(m.runs).toMatchObject({total: 3, open: 1, awaiting: 1, ended: 1, prepared: 0, accepted: 1});
    expect(m.runs.items.map((r: any) => r.runId)).toEqual([RUN2, RUN3, RUN1]);
    const r1 = m.runs.items.find((r: any) => r.runId === RUN1), r2 = m.runs.items.find((r: any) => r.runId === RUN2), r3 = m.runs.items.find((r: any) => r.runId === RUN3);
    expect(r1.versions.map((v: any) => [v.cycle, v.commitSha])).toEqual([[0, sha("a")], [1, sha("c")]]);
    expect(r1.review).toEqual({verdict: "CLEAN", reviewer: "REV-1", cycle: 1, commitSha: sha("c"), atHead: true});
    expect(r1.delivery.state).toBe("SOURCE_ACCEPTED");
    expect(r1.delivery.artifact).toEqual({sourceCommit: sha("c"), treeSha: sha("d"), exportArtifactHash: "f".repeat(64)});
    expect(r1.delivery.accepted).toEqual({sourceCommit: sha("c"), exportArtifactHash: "f".repeat(64), acceptedAt: "2026-10-16T03:30:00.000Z"});
    expect(JSON.stringify(r1)).not.toContain("artifactPath");
    expect(r2.versions).toEqual([]);
    expect(r2.review).toBeNull();
    expect(r2.delivery).toEqual({state: "NOT_PREPARED", artifact: null, accepted: null});
    expect(r3.review).toMatchObject({verdict: "BLOCKED", reviewer: "REV-2"});
    expect(core.mapExecWorkRuns({runs: []})).toEqual({state: "VERIFIED", runs: {items: [], total: 0, open: 0, awaiting: 0, ended: 0, prepared: 0, accepted: 0}});
    // Eşit updatedAt: createdAt sonra runId ile kararlı sıra.
    const tie = core.mapExecWorkRuns({runs: [runRow(RUN1, MSN1, {updatedAt: "2026-10-16T09:00:00.000Z", createdAt: "2026-10-16T01:00:00.000Z"}), runRow(RUN2, MSN2, {updatedAt: "2026-10-16T09:00:00.000Z", createdAt: "2026-10-16T02:00:00.000Z"}), runRow(RUN3, MSN3, {updatedAt: "2026-10-16T09:00:00.000Z", createdAt: "2026-10-16T02:00:00.000Z"})]});
    expect(tie.runs.items.map((r: any) => r.runId)).toEqual([RUN3, RUN2, RUN1]);
  });
  it("the reviewer verdict is the LATEST review evidence; a review without a valid verdict is never shown as clean; a verdict for an older commit is flagged", async () => {
    const core = await load("executive-core.js");
    const one = (evidence: any[], over: Record<string, any> = {}) => core.mapExecWorkRuns({runs: [runRow(RUN1, MSN1, {evidence, ...over})]}).runs.items[0];
    const rv = (cycle: number, over: Record<string, any> = {}) => ev("REVIEW", cycle, {step: "REVIEW", commitSha: sha("c"), reviewerIdentity: "REV-X", verdict: "CLEAN", ...over});
    expect(one([rv(0, {verdict: "CLEAN"}), rv(1, {verdict: undefined})]).review).toMatchObject({verdict: null, cycle: 1});
    expect(one([rv(1, {verdict: undefined}), rv(0, {verdict: "CLEAN"})]).review).toMatchObject({verdict: null, cycle: 1});
    expect(one([rv(1, {verdict: "BLOCKED"}), rv(1, {verdict: "CLEAN"})]).review).toMatchObject({verdict: "CLEAN", cycle: 1});
    expect(one([rv(0, {verdict: "CLEAN", commitSha: sha("a")})]).review).toMatchObject({verdict: "CLEAN", atHead: false});
    expect(one([rv(0, {commitSha: undefined})]).review).toMatchObject({verdict: "CLEAN", commitSha: null, atHead: false});
    expect(one([rv(0)], {headSha: null}).review.atHead).toBe(false);
    expect(one([ev("IMPLEMENT", 0, {commitSha: sha("a")})]).review).toBeNull();
    // Kaynak sürümleri yalnız IMPLEMENT + kayıtlı commit; tekrar tek sayılır; kanıtsız IMPLEMENT yoktur.
    const v = one([ev("IMPLEMENT", 1, {commitSha: sha("c")}), ev("IMPLEMENT", 0, {commitSha: sha("a")}), ev("IMPLEMENT", 0, {commitSha: sha("a")}), ev("IMPLEMENT", 2), ev("REPORT", 1, {commitSha: sha("f")}), ev("REVIEW", 1, {commitSha: sha("9"), verdict: "CLEAN"})]);
    expect(v.versions.map((x: any) => [x.cycle, x.commitSha])).toEqual([[0, sha("a")], [1, sha("c")]]);
  });
  it("delivery state is read from the recorded artifact / acceptance only (never inferred); a completion record is carried as a bare fact and never re-interpreted", async () => {
    const core = await load("executive-core.js");
    const one = (over: Record<string, any>) => core.mapExecWorkRuns({runs: [runRow(RUN1, MSN1, over)]}).runs.items[0];
    expect(one({}).delivery.state).toBe("NOT_PREPARED");
    expect(one({deliveryArtifact: artifact(RUN1, MSN1)}).delivery.state).toBe("ARTIFACT_PREPARED");
    expect(one({deliveryArtifact: artifact(RUN1, MSN1), sourceDelivery: accepted(RUN1, MSN1)}).delivery.state).toBe("SOURCE_ACCEPTED");
    expect(one({deliveryArtifact: null, sourceDelivery: null}).delivery.state).toBe("NOT_PREPARED");
    const withCompletion = one({status: "SUCCEEDED", completion: {headSha: sha("c"), reportEvidenceId: "e1", reviewEvidenceId: "e2", securityEvidenceId: "e3", productVerification: {state: FORBIDDEN, verifyEvidenceId: "e4"}}});
    expect(withCompletion.completionRecorded).toBe(true);
    expect(one({}).completionRecorded).toBe(false);
    // Eşleyici çıktısı ürün doğrulandı sabitini taşımaz (yalnız varlık bayrağı).
    expect(JSON.stringify(withCompletion)).not.toContain(FORBIDDEN);
    expect(Object.keys(withCompletion).join()).not.toMatch(/product|verified/i);
    expect(DELIVERY_STATES_FOR_TEST).toEqual((await load("executive-core.js")).DELIVERY_STATES);
  });
  it("any malformed run field makes the WHOLE work-runs read ERROR (no partial ledger)", async () => {
    const core = await load("executive-core.js");
    const r = (over: Record<string, any>) => ({runs: [runRow(RUN1, MSN1, over)]});
    const bad: any[] = [null, undefined, [], {}, {workRuns: []}, {runs: {}}, {runs: "x"}, {runs: [null]}, {runs: [runRow(RUN1, MSN1), runRow(RUN1, MSN2)]},
      r({runId: "bad"}), r({runId: "run_" + "A1".repeat(12)}), r({missionId: "bad"}), r({projectId: "prj_x"}), r({status: "DONE"}), r({status: "succeeded"}), r({step: "FINISH"}), r({createdAt: "x"}), r({updatedAt: undefined}), r({remediationCycle: -1}), r({remediationCycle: 1.2}),
      r({headSha: "zzz"}), r({baseSha: 123}), r({evidence: "x"}), r({evidence: undefined}), r({evidence: [null]}), r({evidence: [ev("", 0)]}), r({evidence: [{kind: "IMPLEMENT"}]}), r({evidence: [ev("IMPLEMENT", 0, {commitSha: "xyz"})]}), r({evidence: [ev("REVIEW", 0, {verdict: "PASS"})]}), r({evidence: [ev("REVIEW", -1, {verdict: "CLEAN"})]}),
      r({deliveryArtifact: "x"}), r({deliveryArtifact: artifact(RUN1, MSN1, {exportArtifactHash: "short"})}), r({deliveryArtifact: artifact(RUN1, MSN1, {treeSha: "nope"})}), r({deliveryArtifact: artifact(RUN1, MSN1, {runId: RUN2})}), r({deliveryArtifact: artifact(RUN1, MSN2)}),
      r({sourceDelivery: accepted(RUN1, MSN1, {acceptedAt: undefined})}), r({sourceDelivery: accepted(RUN1, MSN1, {acceptedAt: "later"})}), r({sourceDelivery: accepted(RUN1, MSN2)}), r({sourceDelivery: accepted(RUN1, MSN1, {exportArtifactHash: "x"})}), r({sourceDelivery: accepted(RUN1, MSN1, {sourceCommit: "abc"})}),
      r({completion: {headSha: sha("c"), productVerification: {}}}), r({status: "SUCCEEDED", completion: {productVerification: {}}}), r({status: "SUCCEEDED", completion: {headSha: sha("c"), productVerification: "x"}}), r({status: "SUCCEEDED", completion: "done"})];
    for (const b of bad) {
      const m = core.mapExecWorkRuns(b);
      expect(m.state, JSON.stringify(b)?.slice(0, 120)).toBe("ERROR");
      expect(m.runs).toBeNull();
    }
    // Tek bozuk satır, diğer sağlam satırlarla birlikte bile tüm okumayı düşürür.
    expect(core.mapExecWorkRuns({runs: [runRow(RUN1, MSN1), runRow(RUN2, MSN2, {status: "DONE"})]}).state).toBe("ERROR");
  });
  it("mapExecAttention counts blocked packages; a REJECTED scheduler verification is UNAVAILABLE (never zero); malformed is ERROR", async () => {
    const core = await load("executive-core.js");
    expect(core.mapExecAttention(attentionBody(2))).toEqual({state: "VERIFIED", attention: {blocked: 2}});
    expect(core.mapExecAttention(attentionBody(0))).toEqual({state: "VERIFIED", attention: {blocked: 0}});
    expect(core.mapExecAttention({blocked: [], retryableKinds: [], schedulerVerification: "REJECTED", error: "x"})).toEqual({state: "UNAVAILABLE", attention: null});
    for (const b of [null, undefined, [], {}, {blocked: "x"}, {blocked: [null]}, {blocked: [1, 2]}, {blocked: {}}]) expect(core.mapExecAttention(b).state, JSON.stringify(b)).toBe("ERROR");
  });
  it("executiveSummary derives the headline figures only from readable sources; an unreadable source shows its honest state and a null value, never zero", async () => {
    const core = await load("executive-core.js");
    const good = {cockpit: core.mapExecCockpit(cockpitBody()), missions: core.mapExecMissions(MISSIONS), runs: core.mapExecWorkRuns(RUNS), attention: core.mapExecAttention(attentionBody(2))};
    const s = core.executiveSummary(good);
    const v = (k: string) => [s.kpis[k].state, s.kpis[k].value];
    expect(Object.keys(s.kpis)).toEqual(["projects", "missions", "approvals", "evidence", "inProgress", "runs", "deliveries", "blocked"]);
    expect(v("projects")).toEqual(["VERIFIED", 3]);
    expect(v("missions")).toEqual(["VERIFIED", 3]);
    expect(v("approvals")).toEqual(["VERIFIED", 1]);
    expect(v("evidence")).toEqual(["VERIFIED", 8]);
    expect(s.kpis.evidence.detail).toEqual({total: 10, mismatch: 1, missing: 1, unverifiable: 0});
    expect(v("inProgress")).toEqual(["VERIFIED", 2]);
    expect(v("runs")).toEqual(["VERIFIED", 3]);
    expect(s.kpis.runs.detail).toEqual({open: 1, awaiting: 1, ended: 1});
    expect(v("deliveries")).toEqual(["VERIFIED", 1]);
    expect(s.kpis.deliveries.detail).toEqual({prepared: 0, accepted: 1});
    expect(v("blocked")).toEqual(["VERIFIED", 2]);
    expect(s.kpis.projects.source).toBe("GET /v1/cockpit");
    expect(s.kpis.runs.source).toBe("GET /v1/work-runs");
    expect(s.platform).toMatchObject({failState: null, globalStop: {active: false}, orchestrator: {total: 4}, workforce: {registeredRoles: 255, activeWorkerRuns: 1}});
    const down = core.executiveSummary({cockpit: {state: "OFFLINE", cockpit: null}, missions: {state: "UNAVAILABLE", missions: null}, runs: {state: "ERROR", runs: null}, attention: {state: "WEIRD"}});
    expect(Object.entries(down.kpis).map(([k, b]: any) => [k, b.state, b.value])).toEqual([["projects", "OFFLINE", null], ["missions", "OFFLINE", null], ["approvals", "OFFLINE", null], ["evidence", "OFFLINE", null], ["inProgress", "UNAVAILABLE", null], ["runs", "ERROR", null], ["deliveries", "ERROR", null], ["blocked", "ERROR", null]]);
    expect(down.platform).toEqual({globalStop: null, orchestrator: null, workforce: null, failState: "OFFLINE"});
    // Kokpit okundu ama alt blok UNAVAILABLE: gösterge o durumu taşır, değer null (0 değil).
    const part = core.executiveSummary({...good, cockpit: core.mapExecCockpit(cockpitBody({projects: {state: "UNAVAILABLE", count: null}}))});
    expect([part.kpis.projects.state, part.kpis.projects.value]).toEqual(["UNAVAILABLE", null]);
    expect(part.kpis.missions.value).toBe(3);
  });
});
const DELIVERY_STATES_FOR_TEST = ["NOT_PREPARED", "ARTIFACT_PREPARED", "SOURCE_ACCEPTED"];

// ---------------- (4) view honesty ----------------
describe("Executive — view honesty", () => {
  it("renders section A (executive summary) before section B (execution ledger) with real KPI values from the four sources", async () => {
    const {root, calls} = await renderView(serve());
    expect(calls.slice().sort()).toEqual(FOUR);
    expect(root.children.map(c => c.id || c.className)).toEqual(["hero", "executive-summary", "executive-ledger"]);
    expect(cls(root, "view-executive")).toBe(true);
    expect(["projects", "missions", "inProgress", "runs", "approvals", "blocked", "deliveries", "evidence"].map(k => [k, kpiValue(root, k)])).toEqual([["projects", "3"], ["missions", "3"], ["inProgress", "2"], ["runs", "3"], ["approvals", "1"], ["blocked", "2"], ["deliveries", "1"], ["evidence", "8"]]);
    expect(kpi(root, "runs").textContent).toContain("1 open · 1 awaiting Founder decision · 1 ended.");
    expect(kpi(root, "evidence").textContent).toContain("of 10 evidence records are hash-verified · 1 mismatch · 1 missing · 0 unverifiable.");
    expect(kpi(root, "deliveries").textContent).toContain("0 prepared and awaiting acceptance, 1 accepted. Source only");
    expect(srcItems(root).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["cockpit", "VERIFIED"], ["missions", "VERIFIED"], ["workRuns", "VERIFIED"], ["attention", "VERIFIED"]]);
    expect(surface(kpi(root, "missions"))).toContain("EXECUTING: 1");
    // Platform olguları yalnız kokpit bloklarından.
    expect(byData(root, "fact", "globalStop")!.textContent).toContain("Not active");
    expect(byData(root, "fact", "orchestrator")!.textContent).toContain("MERGED 3");
    expect(byData(root, "fact", "roles")!.textContent).toContain("255");
    expect(byData(root, "fact", "roles")!.textContent).not.toContain("363");
    // Kanonik rol sayısı kaynakta yoksa rozet VERIFIED değil UNAVAILABLE (doğrulandı — gösterilmez).
    const noRoles = (await renderView(serve({"/v1/cockpit": cockpitBody({workforce: {state: "VERIFIED", registeredRoles: 363, canonicalRegisteredRoles: null, activeWorkerRuns: 2}})}))).root;
    expect(byData(noRoles, "fact", "roles")!.textContent).toContain("—");
    expect(pills(byData(noRoles, "fact", "roles")!)).toEqual(["UNAVAILABLE"]);
    expect(byData(noRoles, "fact", "roles")!.textContent).not.toContain("363");
    expect(pills(byData(noRoles, "fact", "workers")!)).toEqual(["VERIFIED"]);
    expect(byData(root, "fact", "orchestrator")!.textContent).toContain("as of ");
    expect(byData(root, "fact", "workers")!.textContent).toContain("1");
    expect(allData(root, "executiveState").length).toBe(0);
  });
  it("the ledger is newest activity first and each row shows the real versions, reviewer verdict and delivery state", async () => {
    const {root} = await renderView(serve());
    expect(rows(root).map(n => n.dataset.run)).toEqual([RUN2, RUN3, RUN1]);
    const list = byData(root, "executiveLedger")!;
    expect(list.tagName).toBe("OL");
    expect(list.dataset.executiveLedger).toBe("3");
    const r1 = rowFor(root, RUN1), r2 = rowFor(root, RUN2), r3 = rowFor(root, RUN3);
    expect([r1.dataset.status, r1.dataset.verdict, r1.dataset.delivery]).toEqual(["AWAITING_APPROVAL", "CLEAN", "SOURCE_ACCEPTED"]);
    expect([r2.dataset.status, r2.dataset.verdict, r2.dataset.delivery]).toEqual(["RUNNING", "NONE", "NOT_PREPARED"]);
    expect([r3.dataset.status, r3.dataset.verdict, r3.dataset.delivery]).toEqual(["FAILED", "BLOCKED", "NOT_PREPARED"]);
    expect(allData(r1, "cycle").map(n => [n.dataset.cycle, n.dataset.commit])).toEqual([["0", sha("a")], ["1", sha("c")]]);
    expect(r1.textContent).toContain("aaaaaaaaaaaa");
    expect(r1.textContent).toContain("Cycle 1");
    expect(r1.textContent).toContain("REV-1");
    expect(r1.textContent).toContain("Alpha mission");
    expect(r1.textContent).toContain(MSN1);
    expect(r1.textContent).toContain("f".repeat(64));
    expect(r1.textContent).toContain("Source delivery accepted · NOT verified");
    expect(pills(r1)).toEqual(expect.arrayContaining(["WAITING", "DONE", "NOT_VERIFIED"]));
    expect(r2.textContent).toContain("No source version recorded for this run.");
    expect(r2.textContent).toContain("No reviewer verdict recorded");
    expect(r2.textContent).toContain("No delivery package prepared");
    expect(r3.textContent).toContain("REV-2");
    expect(pills(r3)).toEqual(expect.arrayContaining(["FAILED", "BLOCKED", "NOT_EXECUTED"]));
    // Satır zamanı gerçek updatedAt'tır; <time datetime> makine okunur.
    expect(all(r2).find(n => n.tagName === "TIME")!.getAttribute("datetime")).toBe("2026-10-16T05:00:00.000Z");
  });
  it("a verdict recorded for an older commit than the run's head is flagged, never presented as current", async () => {
    const body = {runs: [runRow(RUN1, MSN1, {headSha: sha("9"), evidence: [ev("IMPLEMENT", 0, {commitSha: sha("a")}), ev("REVIEW", 0, {step: "REVIEW", commitSha: sha("a"), reviewerIdentity: "REV-9", verdict: "CLEAN"})]})]};
    const {root} = await renderView(serve({"/v1/work-runs": body}));
    const row = rowFor(root, RUN1);
    expect(byData(row, "atHead", "0")).toBeTruthy();
    expect(byData(row, "note", "stale-verdict")!.textContent).toContain("earlier commit");
  });
  it("a review that recorded no valid verdict is shown as NOT_EXECUTED, never as a clean verdict", async () => {
    const body = {runs: [runRow(RUN1, MSN1, {evidence: [ev("IMPLEMENT", 0, {commitSha: sha("c")}), ev("REVIEW", 0, {step: "REVIEW", commitSha: sha("c"), reviewerIdentity: "REV-9"})]})]};
    const {root} = await renderView(serve({"/v1/work-runs": body}));
    const row = rowFor(root, RUN1);
    expect(row.dataset.verdict).toBe("NONE");
    expect(row.textContent).toContain("Review ran but recorded no valid verdict");
    expect(pills(row)).not.toContain("DONE");
  });
  it("delivery is source-only: a prepared (not accepted) package is NOT_VERIFIED, a recorded completion is only acknowledged as a record, and no verified-product constant is ever rendered", async () => {
    const body = {runs: [
      runRow(RUN1, MSN1, {deliveryArtifact: artifact(RUN1, MSN1)}),
      runRow(RUN2, MSN2, {status: "SUCCEEDED", updatedAt: "2026-10-16T06:00:00.000Z", completion: {headSha: sha("c"), reportEvidenceId: "e1", reviewEvidenceId: "e2", securityEvidenceId: "e3", productVerification: {state: FORBIDDEN, verifyEvidenceId: "e4", regressionEvidenceId: "e5", testSurfaceEvidenceId: "e6"}}})]};
    const {root} = await renderView(serve({"/v1/work-runs": body}));
    const prepared = rowFor(root, RUN1);
    expect(prepared.dataset.delivery).toBe("ARTIFACT_PREPARED");
    expect(prepared.textContent).toContain("Source package prepared · not accepted · NOT verified");
    expect(pills(prepared)).toContain("NOT_VERIFIED");
    expect(prepared.textContent).not.toContain("Accepted at");
    const completed = rowFor(root, RUN2);
    expect(byData(completed, "completion", "recorded")!.textContent).toContain("This view does not re-verify it");
    expect(completed.dataset.delivery).toBe("NOT_PREPARED");
    expect(kpiValue(root, "deliveries")).toBe("0");
    for (const text of [surface(root), root.textContent]) { expect(text).not.toContain(FORBIDDEN); expect(text).not.toMatch(/product[\s_-]*verified/i); }
    expect(pills(root)).not.toContain(FORBIDDEN);
    expect(surface(root)).not.toMatch(/spill-product_verified/);
  });
  it("EVERY scenario in EN and TR renders without the verified-product constant (even though the API carries it) and without raw i18n keys", async () => {
    const completion = {headSha: sha("c"), reportEvidenceId: "e1", reviewEvidenceId: "e2", securityEvidenceId: "e3", productVerification: {state: FORBIDDEN}};
    const full = {runs: [...RUNS.runs, runRow("run_" + "d4".repeat(12), MSN1, {status: "SUCCEEDED", completion, updatedAt: "2026-10-16T07:00:00.000Z"})]};
    const scenarios: Array<[string, (p: string) => any]> = [
      ["full", serve({"/v1/work-runs": full})], ["plain", serve()],
      ["offline", () => { throw new Error("fetch failed"); }], ["unavailable", () => fail("x", 404)], ["error", () => fail("x", 500)], ["malformed", () => ({nonsense: true})],
      ["empty", serve({"/v1/work-runs": {runs: []}, "/v1/missions": {missions: []}, "/v1/founder-attention": attentionBody(0)})],
      ["partial", (p: string) => (p === "/v1/work-runs" ? fail(p, 404) : serve({"/v1/cockpit": cockpitBody({workforce: {state: "UNAVAILABLE", registeredRoles: null, canonicalRegisteredRoles: null, activeWorkerRuns: null}})})(p))],
      ["stopped", serve({"/v1/cockpit": cockpitBody({globalStop: {active: true, reason: "FOUNDER_STOP"}})})]];
    for (const lang of ["en", "tr"]) for (const [name, fn] of scenarios) {
      const {root} = await renderView(fn, lang);
      const label = `${lang}/${name}`;
      expect(surface(root), label).not.toContain(FORBIDDEN);
      expect(root.textContent, label).not.toMatch(/product[\s_-]*verified/i);
      expect(root.textContent, label).not.toMatch(/\b(executive|area\.executive)\.[A-Za-z]+(\.[A-Za-z_]+)*\b/);
      expect(pills(root), label).not.toContain(FORBIDDEN);
    }
  });
  it("each source fails independently with its own honest state; nothing is guessed and the healthy sources stay intact", async () => {
    // Kokpit düştü (OFFLINE): kokpit göstergeleri "—"; mission/koşu/dikkat göstergeleri ve defter sağlam.
    let r = await renderView(p => (p === "/v1/cockpit" ? (() => { throw new Error("fetch failed"); })() : serve()(p)));
    expect(allData(r.root, "executiveState").map(n => [n.dataset.source, n.dataset.executiveState])).toEqual([["cockpit", "OFFLINE"]]);
    for (const k of ["projects", "missions", "approvals", "evidence"]) { expect(kpiValue(r.root, k), k).toBe("—"); expect(kpi(r.root, k).dataset.state, k).toBe("OFFLINE"); }
    expect(kpiValue(r.root, "inProgress")).toBe("2");
    expect(kpiValue(r.root, "runs")).toBe("3");
    expect(kpiValue(r.root, "blocked")).toBe("2");
    expect(rows(r.root).length).toBe(3);
    expect(byData(r.root, "platform", "OFFLINE")).toBeTruthy();
    expect(srcItems(r.root).map(n => n.dataset.sourceState)).toEqual(["OFFLINE", "VERIFIED", "VERIFIED", "VERIFIED"]);
    // İş koşuları 404 (UNAVAILABLE): defter durum bloğu, satır yok; koşu/teslim göstergeleri "—".
    r = await renderView(p => (p === "/v1/work-runs" ? fail(p, 404) : serve()(p)));
    expect(rows(r.root).length).toBe(0);
    const ledger = byId(r.root, "executive-ledger")!;
    expect(byData(ledger, "executiveState", "UNAVAILABLE")).toBeTruthy();
    expect(ledger.textContent).toContain("GET /v1/work-runs");
    expect(kpiValue(r.root, "runs")).toBe("—");
    expect(kpiValue(r.root, "deliveries")).toBe("—");
    expect(kpiValue(r.root, "projects")).toBe("3");
    // Founder dikkati düştü (500): ERROR; engelli göstergesi "—", 0 değil.
    r = await renderView(p => (p === "/v1/founder-attention" ? fail(p, 500) : serve()(p)));
    expect(allData(r.root, "executiveState").map(n => [n.dataset.source, n.dataset.executiveState])).toEqual([["attention", "ERROR"]]);
    expect(kpiValue(r.root, "blocked")).toBe("—");
    expect(kpi(r.root, "blocked").dataset.state).toBe("ERROR");
    // Mission listesi düştü: hat içi "—"; defter satırları mission KİMLİĞİYLE gösterilir, başlık uydurulmaz.
    r = await renderView(p => (p === "/v1/missions" ? fail(p, 404) : serve()(p)));
    expect(kpiValue(r.root, "inProgress")).toBe("—");
    expect(rowFor(r.root, RUN1).textContent).toContain(MSN1);
    expect(rowFor(r.root, RUN1).textContent).not.toContain("Alpha mission");
    // Zamanlayıcı doğrulaması reddedildi: UNAVAILABLE (sıfır değil).
    r = await renderView(serve({"/v1/founder-attention": {blocked: [], schedulerVerification: "REJECTED", error: "x"}}));
    expect(byData(r.root, "executiveState", "UNAVAILABLE")).toBeTruthy();
    expect(kpiValue(r.root, "blocked")).toBe("—");
  });
  it("a malformed response is an ERROR for the WHOLE read: no partial ledger, no partial figures; other sources are unaffected", async () => {
    const badRuns = {runs: [runRow(RUN1, MSN1), runRow(RUN2, MSN2, {status: "DONE"})]};
    let r = await renderView(serve({"/v1/work-runs": badRuns}));
    expect(rows(r.root).length).toBe(0);
    expect(byData(byId(r.root, "executive-ledger")!, "executiveState", "ERROR")).toBeTruthy();
    expect(kpiValue(r.root, "runs")).toBe("—");
    expect(kpiValue(r.root, "projects")).toBe("3");
    r = await renderView(serve({"/v1/cockpit": cockpitBody({projects: {state: "VERIFIED", count: -4}})}));
    expect(byData(byId(r.root, "executive-summary")!, "executiveState", "ERROR")).toBeTruthy();
    for (const k of ["projects", "missions", "approvals", "evidence"]) expect(kpiValue(r.root, k), k).toBe("—");
    expect(kpiValue(r.root, "runs")).toBe("3");
    expect(rows(r.root).length).toBe(3);
    r = await renderView(serve({"/v1/missions": {missions: [{...MISSIONS.missions[0], status: "WHATEVER"}]}}));
    expect(kpiValue(r.root, "inProgress")).toBe("—");
    expect(kpi(r.root, "inProgress").dataset.state).toBe("ERROR");
  });
  it("when everything is unreadable no figure is shown at all (every KPI is — and the ledger is a state block)", async () => {
    const {root} = await renderView(() => { throw new Error("fetch failed"); });
    for (const k of ["projects", "missions", "inProgress", "runs", "approvals", "blocked", "deliveries", "evidence"]) { expect(kpiValue(root, k), k).toBe("—"); expect(kpi(root, k).dataset.state, k).toBe("OFFLINE"); }
    expect(allData(root, "executiveState").map(n => n.dataset.source)).toEqual(["cockpit", "missions", "attention", "workRuns"]);
    expect(rows(root).length).toBe(0);
    expect(root.textContent).toContain("No data is shown or invented.");
    expect(root.textContent).not.toMatch(/\b0\b/);
  });
  it("honest empty states: no runs / no missions / no blocked packages are readable zeros with explicit empty text", async () => {
    const {root} = await renderView(serve({"/v1/work-runs": {runs: []}, "/v1/missions": {missions: []}, "/v1/founder-attention": attentionBody(0), "/v1/cockpit": cockpitBody({projects: {state: "VERIFIED", count: 0}, missions: {state: "VERIFIED", total: 0, byStatus: {}}, awaitingApproval: {state: "VERIFIED", items: []}})}));
    expect(kpiValue(root, "runs")).toBe("0");
    expect(kpiValue(root, "inProgress")).toBe("0");
    expect(kpiValue(root, "blocked")).toBe("0");
    expect(pills(kpi(root, "runs"))).toContain("EMPTY");
    expect(root.textContent).toContain("No work runs have been recorded yet.");
    expect(rows(root).length).toBe(0);
  });
  it("a global stop is shown as ACTIVE with its recorded reason", async () => {
    const {root} = await renderView(serve({"/v1/cockpit": cockpitBody({globalStop: {active: true, reason: "FOUNDER_STOP"}})}));
    const f = byData(root, "fact", "globalStop")!;
    expect(f.textContent).toContain("ACTIVE — all work is stopped. Reason: FOUNDER_STOP");
    expect(pills(f)).toContain("STOPPED");
  });
  it("very long ledgers are truncated honestly (newest 200 shown, the real total stated)", async () => {
    const many = {runs: Array.from({length: 205}, (_, i) => runRow("run_" + i.toString(16).padStart(24, "0"), MSN1, {updatedAt: new Date(Date.parse("2026-10-16T00:00:00.000Z") + i * 1000).toISOString()}))};
    const {root} = await renderView(serve({"/v1/work-runs": many}));
    expect(rows(root).length).toBe(200);
    expect(byData(root, "note", "truncated")!.textContent).toContain("Showing the newest 200 of 205 runs.");
    expect(kpiValue(root, "runs")).toBe("205");
    expect(rows(root)[0].dataset.run).toBe("run_" + (204).toString(16).padStart(24, "0"));
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const body = {runs: [runRow(RUN1, MSN1, {evidence: [ev("IMPLEMENT", 0, {commitSha: sha("c")}), ev("REVIEW", 0, {step: "REVIEW", commitSha: sha("c"), reviewerIdentity: "<img src=x onerror=alert(1)>", verdict: "CLEAN"})]})]};
    const {root} = await renderView(serve({"/v1/work-runs": body, "/v1/missions": {missions: [{...MISSIONS.missions[0], title: "<b>x</b>"}]}}));
    expect(all(root).some(n => n.tagName === "IMG" || n.tagName === "B")).toBe(false);
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.textContent).toContain("<b>x</b>");
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root} = await renderView(serve(), "tr");
    expect(byId(root, "view-title")!.textContent).toBe("Kurucu Yönetim Özeti ve İcra Defteri");
    expect(kpiValue(root, "runs")).toBe("3");
    expect(rows(root).map(n => n.dataset.run)).toEqual([RUN2, RUN3, RUN1]);
    expect(rowFor(root, RUN1).textContent).toContain("Kaynak teslimi kabul edildi · DOĞRULANMADI");
    expect(root.textContent).toContain("İcra defteri");
  });
});

// ---------------- (5) accessibility ----------------
describe("Executive — accessibility", () => {
  it("single labelled h1, exactly two labelled sections (summary, ledger), a labelled KPI group and a labelled ordered ledger with machine-readable times", async () => {
    const {root} = await renderView(serve());
    const h1 = all(root).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    expect(all(root).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["executive-summary", "executive-ledger"]);
    for (const id of ["executive-summary", "executive-ledger"]) {
      const sec = byId(root, id)!;
      expect(sec.tagName, id).toBe("SECTION");
      expect(byId(root, sec.getAttribute("aria-labelledby")!), id).toBeTruthy();
    }
    const group = all(root).find(n => n.getAttribute("role") === "group")!;
    expect(group.getAttribute("aria-label")).toBe("Executive summary figures");
    const tiles = allData(group, "kpi");
    expect(tiles.length).toBe(8);
    for (const t of tiles) {
      expect(t.tagName).toBe("ARTICLE");
      expect(byId(root, t.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
      expect(all(t).some(n => "pill" in n.dataset)).toBe(true);
    }
    const list = byData(root, "executiveLedger")!;
    expect(list.getAttribute("aria-label")).toBe("Work runs, newest activity first");
    for (const li of rows(root)) {
      const t = all(li).find(n => n.tagName === "TIME")!;
      expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(t.textContent.length).toBeGreaterThan(3);
    }
    expect(all(root).filter(n => n.tagName === "UL" && cls(n, "company-sources")).every(n => !!n.getAttribute("aria-label"))).toBe(true);
  });
  it("definition lists are well-formed (dt/dd pairs) and every state pill carries text (state is never colour alone)", async () => {
    const full = {runs: [...RUNS.runs, runRow("run_" + "d4".repeat(12), MSN1, {deliveryArtifact: artifact("run_" + "d4".repeat(12), MSN1)})]};
    const {root} = await renderView(serve({"/v1/work-runs": full}));
    for (const dl of all(root).filter(n => n.tagName === "DL")) {
      expect(dl.children.length % 2, "dl pairs").toBe(0);
      dl.children.forEach((c, i) => expect(c.tagName).toBe(i % 2 === 0 ? "DT" : "DD"));
    }
    for (const p of allData(root, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    // Sürüm listesi sıralı liste ve etiketli.
    const versions = all(root).filter(n => cls(n, "executive-versions"));
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) { expect(v.tagName).toBe("OL"); expect(v.getAttribute("aria-label")).toBeTruthy(); }
  });
  it("failure blocks are status regions (role=status) with text, not colour alone", async () => {
    const {root} = await renderView(() => { throw new Error("fetch failed"); });
    const blocks = allData(root, "executiveState");
    expect(blocks.length).toBe(4);
    for (const b of blocks) { expect(b.getAttribute("role")).toBe("status"); expect(b.textContent).toContain("Offline"); expect(pills(b)).toContain("OFFLINE"); }
  });
  it("styles.css has container-query, forced-colors and focus coverage for the executive components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("Kurucu Yönetim Özeti ve İcra Defteri: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.executive-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    expect(mine).toMatch(/\.executive-ledger \.executive-versions li\{display:block/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (6) locale parity ----------------
describe("Executive — locale parity and key coverage", () => {
  it("every executive.* / area.executive.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("executive.") || k.startsWith("area.executive.")).sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(60);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.executive.title"]).toBe("Kurucu Yönetim Özeti ve İcra Defteri");
    expect(en["area.executive.title"]).toBe("Founder Executive Summary & Execution Ledger");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    // Hiçbir yerel değer ürün-doğrulandı sabitini veya eşdeğerini içermez.
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
  });
  it("every literal and enumerated key used by executive.js exists in the dictionary", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const core = await load("executive-core.js");
    const src = read("views", "executive.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|emptyNote\(ctx,)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"(executive\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of ["projects", "missions", "inProgress", "runs", "approvals", "blocked", "deliveries", "evidence"]) need.add(`executive.kpi.${k}`);
    for (const k of ["globalStop", "orchestrator", "roles", "workers"]) need.add(`executive.platform.${k}`);
    for (const k of core.EXECUTIVE_SOURCES) need.add(`executive.src.${k}`);
    for (const k of core.DELIVERY_STATES) need.add(`executive.delivery.${k}`);
    for (const k of ["OFFLINE", "UNAVAILABLE", "ERROR"]) { need.add(`executive.state.${k}`); need.add(`executive.hint.${k}`); }
    need.add("area.executive.title"); need.add("area.executive.desc");
    const missing = [...need].filter(k => !(k in en));
    expect(missing).toEqual([]);
    expect(need.size).toBeGreaterThan(40);
  });
});

// ---------------- (7) routing ----------------
describe("Executive — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/executive to the planned host with component 'executive' (no plannedPackage), after journey and before settings", async () => {
    const routes = await load("routes.js");
    const r = routes.routeById("executive");
    expect(r).toMatchObject({id: "executive", hash: "#/executive", view: "planned", component: "executive", factory: false});
    expect(r.plannedPackage).toBeUndefined();
    expect(routes.routeFromHash("#/executive")).toBe("executive");
    expect(routes.routeFromHash("#/executive/")).toBe("executive");
    expect(routes.routeFromHash("#/executives")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-7)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("executive");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
  });
  it("planned.js delegates the 'executive' component to the real view; app.js VIEWS table has no executive entry and is untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as executive from "./executive.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*executive[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toMatch(/executive/i);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const root: N = await planned.render(ctx, {id: "executive", component: "executive"});
    expect(cls(root, "view-executive")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Founder Executive Summary & Execution Ledger");
    // Mevcut devredilen rotalar etkilenmez.
    const j = await planned.render((await mkCtx(serve())).ctx, {id: "journey", component: "journey"});
    expect(cls(j, "view-journey")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.executive.title")).toBe("Kurucu Yönetim Özeti ve İcra Defteri");
  });
});
