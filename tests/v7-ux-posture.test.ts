// //TR: Bu test FA-V2-PRODUCT UI-037+046 "Güvence Komuta Merkezi ve Güvenlik Duruşu" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek tohumlanmış Work OS verisinden (koşu, kanıt, bağımsız inceleme kararları, gerçek git + kaynak teslimi) dönen GET /v1/work-runs + /v1/reviews + /v1/cockpit gövdeleri saf eşleyicilerden (posture-core.js) ve görünümden (views/posture.js) geçer. (2) İZİN LİSTESİ — üç GET zaten izinlidir (main.mjs/server.ts/app.js/control-boundary.mjs DEĞİŞMEZ, EXTRA_GET_ROUTES büyümez, yeni uç nokta yok), görünüm yalnız bu üç GET'i okur, hiçbir yazma/köprü çağrısı yapmaz. (3) SAF EŞLEYİCİLER — bozuk kimlik/enum/biçim/sayı/çelişki fail-closed ERROR olur (kısmi görünüm yok), inceleme kararı AYNEN taşınır. (4) DURUŞ DÜRÜSTLÜĞÜ — genel duruş yalnız dört sütunun HEPSİ sağlandığında ASSURED olur; QA NOT_EXECUTED, güvenlik PASSED değil, inceleme temiz değil ya da kanıt doğrulanmamış/eksik/okunamıyorsa HİÇBİR koşulda ASSURED olmaz; okunamayan kaynak UNKNOWN'dır, sayıları 0 değil "—" olur. (5) GÖRÜNÜM DÜRÜSTLÜĞÜ — kaynak başına OFFLINE/UNAVAILABLE/ERROR, eksikler adıyla listelenir, ürün doğrulandı sabiti ASLA. (6) ERİŞİLEBİLİRLİK, (7) YEREL AYNALIK (TR/EN birebir) ve (8) ROTA (planned.js devri, app.js VIEWS değişmez).
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
import {NO_REAL_WSL_ON_WIN32} from "./support/test-sandbox.js";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (git, alt süreç, HTTP, disk) yavaş GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #49 Windows CI ölçümleri: 1-4 sn normal koşu, yavaş koşuda zaman aşımı). Yalnız süre bütçesi; hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (readiness/queue testleri ile aynı desen) ----------------
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
const lines = (r: N) => all(r).map(n => n._text).filter(Boolean).join("\n");
const pills = (r: N) => allData(r, "pill").map(n => n.dataset.pill);
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `posture-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const pillarCards = (r: N) => allData(r, "pillar").filter(n => n.tagName === "LI" && cls(n, "posture-pillar"));
const pillarOf = (r: N, id: string) => pillarCards(r).find(n => n.dataset.pillar === id)!;
const countOf = (card: N, key: string) => allData(card, "count").find(n => n.dataset.count === key);
const serverCount = (card: N, key: string) => allData(card, "serverCount").find(n => n.dataset.serverCount === key);
const itemsOf = (r: N) => allData(r, "postureItem").filter(n => n.tagName === "LI");
const itemFor = (r: N, runId: string) => itemsOf(r).find(n => n.dataset.postureItem === runId)!;
const field = (li: N, key: string) => allData(li, "field").find(n => n.dataset.field === key);
const overallOf = (r: N) => byData(r, "overall")!;
const missingOf = (r: N) => allData(r, "missingPillar").map(n => [n.dataset.missingPillar, n.dataset.reason, n.dataset.missingN]);
const sourcesOf = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const click = (n: N) => { const fns = n.ls.get("click"); expect(fns, "click listener").toBeTruthy(); fns!.forEach(f => f({})); };

async function mkCtx(getFn: (p: string) => any, lang = "en", post?: (p: string, b: unknown) => any) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [];
  const bridge: Record<string, unknown> = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  if (post) bridge.apiPost = async (p: string, b: unknown) => post(p, b);
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { nav.push(id); }, rerender: async () => {}, settleFocus: () => {}};
  return {ctx, doc, calls, nav};
}
const fail = (p: string, status = 404) => { throw new Error(`${p}: HTTP ${status}`); };
async function renderView(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "posture.js");
  const m = await mkCtx(getFn, lang);
  const root: N = await view.render(m.ctx);
  return {root, ...m};
}

// ---------------- fixtures (sözleşme biçiminde; readiness testleri ile aynı sözleşme) ----------------
const PRJ = "prj_" + "11".repeat(12);
const MSN = (c: string) => "msn_" + c.repeat(12);
const RUN = (c: string) => "run_" + c.repeat(12);
const MSN1 = MSN("ab"), MSN2 = MSN("cd"), MSN3 = MSN("ef"), MSN4 = MSN("12");
const RUN1 = RUN("a1"), RUN2 = RUN("b2"), RUN3 = RUN("c3"), RUN4 = RUN("d4");
const sha = (c: string) => c.repeat(40);
const BASE = sha("b"), HEAD = sha("c"), OLD = sha("a"), HEAD3 = sha("e");
const T0 = "2026-10-16T02:00:00.000Z";
let evSeq = 0;
const ev = (kind: string, cycle: number, over: Record<string, any> = {}) => ({evidenceId: "evd_" + (++evSeq).toString(16).padStart(24, "0"), step: "IMPLEMENT", cycle, kind, argv: [], startedAt: T0, endedAt: "2026-10-16T02:00:01.000Z", exitCode: 0, logPath: null, logSha256: null, commitSha: HEAD, ...over});
const SEC = (status: string, over: Record<string, any> = {}) => ev("SECURITY_REPORT", 1, {step: "SECURITY", security: {schemaVersion: 1, status, blockReason: status === "BLOCKED" ? "SECRET_DETECTED" : null}, ...over});
const TESTS = (over: Record<string, any> = {}) => [ev("VERIFY_TESTS", 1, {step: "VERIFY", sandboxProviderId: "sbx.fake", ...over}), ev("TEST_SURFACE", 1, {step: "VERIFY", testSurface: {functionalAcceptance: "UNVERIFIED_ORACLE", executedTests: 12}}), ev("REGRESSION_TESTS", 1, {step: "REGRESSION", sandboxProviderId: "sbx.fake", ...over})];
const NOT_EXEC = () => [ev("VERIFY_TESTS_NOT_EXECUTED", 1, {step: "VERIFY", exitCode: null}), ev("TEST_SURFACE", 1, {step: "VERIFY", testSurface: {functionalAcceptance: "NOT_EXECUTED", executedTests: null}})];
const REVIEW_EV = (verdict = "CLEAN", over: Record<string, any> = {}) => ev("REVIEW", 1, {step: "REVIEW", reviewerIdentity: "REV-1", executorIdentity: "IMPL-1", verdict, ...over});
const IMPL = (over: Record<string, any> = {}) => ev("IMPLEMENT", 1, over);
const REPORT = (over: Record<string, any> = {}) => ev("REPORT", 1, {step: "REPORT", verdict: "CLEAN", ...over});
const FULL_EV = () => [IMPL(), ...TESTS(), SEC("PASSED"), REVIEW_EV(), REPORT()];
const runRow = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, projectId: PRJ, tenantId: "tA", roleId: null, executor: {implementer: "IMPL-1", reviewer: "REV-1"}, leaseId: null, leaseExpiresAt: null, attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 1, retryCount: 0,
  baseSha: BASE, headSha: HEAD, workBranch: "b", checkpoints: [], evidence: FULL_EV(), createdAt: T0, createdBy: "x", updatedAt: "2026-10-16T03:00:00.000Z", ...over});
/** Dört sütunun hepsinin gerçekten sağlandığı koşu (yalnız sentetik uç durum: testler tanıklı sandbox'ta yürütüldü, güvenlik PASSED, bağımsız inceleme CLEAN). */
const GOOD_RUN = (runId = RUN1, missionId = MSN1, over: Record<string, any> = {}) => runRow(runId, missionId, {status: "SUCCEEDED", updatedAt: "2026-10-16T07:00:00.000Z", ...over});
// Gerçek şekil: inceleme CLEAN + güvenlik PASSED, ama testler çalıştırılmadı (sandbox yok).
const SOURCE_RUN = (over: Record<string, any> = {}) => runRow(RUN2, MSN2, {evidence: [IMPL(), ...NOT_EXEC(), SEC("PASSED"), REVIEW_EV(), REPORT()], updatedAt: "2026-10-16T05:00:00.000Z", ...over});
const BLOCKED_RUN = (over: Record<string, any> = {}) => runRow(RUN3, MSN3, {status: "FAILED", step: "REVIEW", reason: "REVIEW_BLOCKED", headSha: HEAD3, evidence: [IMPL({commitSha: HEAD3}), REVIEW_EV("BLOCKED", {commitSha: HEAD3})], updatedAt: "2026-10-16T04:00:00.000Z", ...over});
const NEW_RUN = (over: Record<string, any> = {}) => runRow(RUN4, MSN4, {status: "RUNNING", step: "IMPLEMENT", remediationCycle: 0, headSha: null, evidence: [], createdAt: "2026-10-16T05:30:00.000Z", updatedAt: "2026-10-16T06:00:00.000Z", ...over});
const RUNS = {runs: [SOURCE_RUN(), BLOCKED_RUN(), NEW_RUN()]};
// ---- /v1/reviews: koşunun kayıtlarından tutarlı özet üretir (sunucu sözleşmesi) ----
const REVIEW_ID = (runId: string) => "evd_" + runId.slice(4);
const countBy = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ({...m, [x]: (m[x] ?? 0) + 1}), {});
const reviewRecord = (runId: string, missionId: string, over: Record<string, any> = {}) => ({reviewId: REVIEW_ID(runId), runId, missionId, projectId: PRJ, cycle: 1, step: "REVIEW", reviewer: {identity: "REV-1"}, implementer: {identity: "IMPL-1"}, independent: true, reviewedCommit: HEAD, reviewedRange: {baseSha: BASE, headSha: HEAD}, currentHead: true,
  verdict: "CLEAN", startedAt: T0, timestamp: "2026-10-16T02:30:00.000Z", evidence: {recordedVerdict: "CLEAN", invalidated: null, findingsCount: 0, findings: null, exitCode: 0, timedOut: false, logSha256: null, note: null}, ...over});
function rv(run: any, state = "CLEAN", over: {sum?: Record<string, any>; rec?: Record<string, any>} = {}) {
  const head = run.headSha, base = {runId: run.runId, missionId: run.missionId, projectId: PRJ, status: run.status, step: run.step, headSha: head};
  if (state === "NOT_REVIEWED") return {sum: {...base, reviewState: state, latestReviewId: null, reviewCount: 0, ...over.sum}, rec: null};
  const verdict = state === "INDEPENDENCE_UNVERIFIED" ? "CLEAN" : state;
  const rec = reviewRecord(run.runId, run.missionId, {verdict, reviewedCommit: head, independent: state === "INDEPENDENCE_UNVERIFIED" ? false : true, ...over.rec});
  return {sum: {...base, reviewState: state, latestReviewId: rec.reviewId, reviewCount: 1, ...over.sum}, rec};
}
const reviewsBody = (pairs: Array<{sum: any; rec: any}>, over: Record<string, any> = {}) => {
  const recs = pairs.map(p => p.rec).filter(Boolean), sums = pairs.map(p => p.sum);
  return {source: "WORK_OS_JOURNAL_RUN_EVIDENCE", notice: "Verdicts are read as recorded.", summary: {runs: sums.length, reviews: recs.length, runsByReviewState: countBy(sums.map(s => s.reviewState)), reviewsByVerdict: countBy(recs.map(r => r.verdict)), truncated: false}, reviews: recs, runs: sums, ...over};
};
const reviewsFor = (runs: any[], states: Record<string, string> = {}) => reviewsBody(runs.map(r => rv(r, states[r.runId] ?? "CLEAN")));
const DEFAULT_STATES = {[RUN3]: "BLOCKED", [RUN4]: "NOT_REVIEWED"};
const REVIEWS = reviewsFor(RUNS.runs, DEFAULT_STATES);
const cockpitBody = (evidence: Record<string, any> = {}, over: Record<string, any> = {}) => ({generatedAt: "2026-10-16T08:00:00.000Z", globalStop: {active: false, reason: null},
  evidence: {state: "VERIFIED", total: 10, verified: 10, mismatch: 0, missing: 0, unverifiable: 0, sources: {workos: "AVAILABLE"}, ...evidence}, ...over});
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/work-runs": RUNS, "/v1/reviews": REVIEWS, "/v1/cockpit": cockpitBody(), ...over};
  if (!(p in m)) return fail(p);
  const v = m[p];
  return typeof v === "function" ? v(p) : v; // işlev geçersiz kılma: okuma hatası (throw) benzetimi
};
const THREE = ["/v1/cockpit", "/v1/reviews", "/v1/work-runs"];
/** Hiçbir olumsuz sütun içermeyen ama eksik kanıtlı gerçekçi küme (koşu 2: testler yürütülmedi; koşu 4: yeni, incelenmedi). */
const NO_NEG = [SOURCE_RUN(), NEW_RUN()];
const serveNoNeg = (over: Record<string, any> = {}) => serve({"/v1/work-runs": {runs: NO_NEG}, "/v1/reviews": reviewsFor(NO_NEG, {[RUN4]: "NOT_REVIEWED"}), ...over});
/** Pozitif kontrol: dört sütunun hepsi gerçekten sağlanır -> ASSURED. */
const GOOD = [GOOD_RUN()];
const serveGood = (over: Record<string, any> = {}) => serve({"/v1/work-runs": {runs: GOOD}, "/v1/reviews": reviewsFor(GOOD), ...over});
/** Üç okumayı gerçek eşleyicilerden geçirip duruşu üretir (sütun matrisi için). */
async function assess(runs: any[], o: {reviews?: any; cockpit?: any} = {}) {
  const core = await load("posture-core.js");
  const res = {workRuns: core.mapPostureWorkRuns({runs}), reviews: core.mapPostureReviews(o.reviews ?? reviewsFor(runs)), evidence: core.mapPostureEvidence(o.cockpit ?? cockpitBody())};
  return {core, res, out: core.buildPosture(res)};
}
/** Güvenceli (ASSURED) olmaması gereken her durumda: genel göstergede başarı/güvenli ifadesi, başarı rozeti ve ASSURED işareti yoktur. */
function expectNotAssured(r: N, label: string) {
  const o = overallOf(r);
  expect(o.dataset.overall, label).not.toBe("ASSURED");
  expect(allData(r, "overall", "ASSURED").length, label).toBe(0);
  expect(o.textContent, label).not.toMatch(/assured|secure|\bpass(ed)?\b/i);
  expect(pills(o), label).not.toContain("DONE");
  expect(pills(o), label).not.toContain("VERIFIED");
  expect(allData(r, "pillarStatus").filter(n => cls(n, "posture-pillar") && n.dataset.pillarStatus === "OK").length >= 4, label).toBe(false);
  expect(surface(r), label).not.toContain(FORBIDDEN);
}

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-posture-")); });
afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(tenantId = "tA"): App {
  fs.mkdirSync(runtime(), {recursive: true});
  // repoRoot geçici dizindir: kanıt endeksi gerçek depoyu taramaz.
  const app = buildServer({...NO_REAL_WSL_ON_WIN32, controlToken: TOKEN, runtime: runtime(), repoRoot: tmp, dataDir: dataDir(), tenantId, port: 3210, logger: false});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string, headers: Record<string, string> = hdr) => { const r = await app.inject({method: "GET", url, headers}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const evBase = (step: string, cycle: number, kind: string) => ({step, cycle, kind, argv: ["x"], startedAt: "2026-10-16T08:00:00.000Z", endedAt: "2026-10-16T08:00:01.000Z", exitCode: 0, logPath: null, logSha256: null}) as any;
// Gerçek Work OS store ile: A (BLOCKED sonra CLEAN, bağımsız), B (çalışıyor, inceleme yok), C (FAILED + BLOCKED), D (CLEAN ama bağımsızlık kanıtsız), E (inceleme eski commit'e ait).
async function seedRealStore() {
  const store = new WorkOsStore(dataDir());
  const tenantId = "tA", scope = {tenantId};
  const p = store.createProject({tenantId, orgId: "org1", name: "Posture", environmentId: "env-dev", createdBy: RECORDER});
  const mk = (title: string) => {
    const m = store.createMission({tenantId, projectId: p.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, m.missionId, to, "go", RECORDER);
    return m.missionId;
  };
  const BASE_ = "b".repeat(40), V0 = "a".repeat(40), V1 = "c".repeat(40), E0 = "e".repeat(40);
  const start = (missionId: string, tag: string) => {
    const r = store.createRun({tenantId, missionId, executor: {implementer: `IMPL-${tag}`, reviewer: `REV-${tag}`}, createdBy: RECORDER});
    return {runId: r.runId, leaseId: store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string};
  };
  const add = (r: {runId: string; leaseId: string}, step: string, cycle: number, kind: string, extra: Record<string, unknown>) => store.addRunEvidence(r.runId, r.leaseId, {...evBase(step, cycle, kind), ...extra}, "ENGINE");
  const to = (r: {runId: string; leaseId: string}, status: any, opts: any = {}) => store.transitionRun(r.runId, r.leaseId, status, "t", "ENGINE", opts);
  const a = start(mk("Real A"), "A");
  to(a, "RUNNING", {patch: {baseSha: BASE_, headSha: V0}});
  add(a, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE_, commitSha: V0});
  add(a, "REVIEW", 0, "REVIEW", {commitSha: V0, reviewerIdentity: "REV-A", executorIdentity: "IMPL-A", verdict: "BLOCKED", findingsCount: 1});
  to(a, "CHECKPOINTING");
  store.checkpointRun(a.runId, a.leaseId, {step: "IMPLEMENT", data: {}}, "ENGINE", {patch: {remediationCycle: 1, headSha: V1}});
  to(a, "RUNNING");
  add(a, "IMPLEMENT", 1, "IMPLEMENT", {baseSha: BASE_, commitSha: V1});
  add(a, "REVIEW", 1, "REVIEW", {commitSha: V1, reviewerIdentity: "REV-A", executorIdentity: "IMPL-A", verdict: "CLEAN", findingsCount: 0});
  to(a, "CHECKPOINTING"); to(a, "AWAITING_APPROVAL");
  await sleep(8);
  const c = start(mk("Real C"), "C");
  to(c, "RUNNING", {patch: {baseSha: BASE_, headSha: E0}});
  add(c, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE_, commitSha: E0});
  add(c, "REVIEW", 0, "REVIEW", {commitSha: E0, reviewerIdentity: "REV-C", executorIdentity: "IMPL-C", verdict: "BLOCKED", findingsCount: 2});
  to(c, "FAILED");
  await sleep(8);
  const b = start(mk("Real B"), "B");
  to(b, "RUNNING", {patch: {baseSha: BASE_, headSha: V0}});
  add(b, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE_, commitSha: V0});
  await sleep(8);
  const d = start(mk("Real D"), "D");
  to(d, "RUNNING", {patch: {baseSha: BASE_, headSha: V1}});
  add(d, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE_, commitSha: V1});
  add(d, "REVIEW", 0, "REVIEW", {commitSha: V1, reviewerIdentity: "REV-D", verdict: "CLEAN", findingsCount: 0});
  to(d, "CHECKPOINTING"); to(d, "AWAITING_APPROVAL");
  await sleep(8);
  const e = start(mk("Real E"), "E");
  to(e, "RUNNING", {patch: {baseSha: BASE_, headSha: V0}});
  add(e, "IMPLEMENT", 0, "IMPLEMENT", {baseSha: BASE_, commitSha: V0});
  add(e, "REVIEW", 0, "REVIEW", {commitSha: V0, reviewerIdentity: "REV-E", executorIdentity: "IMPL-E", verdict: "CLEAN", findingsCount: 0});
  to(e, "CHECKPOINTING");
  store.checkpointRun(e.runId, e.leaseId, {step: "IMPLEMENT", data: {}}, "ENGINE", {patch: {remediationCycle: 1, headSha: V1}});
  to(e, "RUNNING");
  add(e, "IMPLEMENT", 1, "IMPLEMENT", {baseSha: BASE_, commitSha: V1});
  to(e, "CHECKPOINTING"); to(e, "AWAITING_APPROVAL");
  return {A: a.runId, B: b.runId, C: c.runId, D: d.runId, E: e.runId};
}

describe("Posture — GENUINE control-api read-models flow through mappers, aggregation and view", () => {
  // //TR: Gercek disk G/C'li bu test Windows CI'da varsayilan 5 sn vitest sinirini asabiliyor (iddia degil yalniz sure); kardes gercek-G/C testleriyle ayni acik sure butcesi verilir.
  it("real seeded Work OS data: QA and security are NOT_EXECUTED, review states are carried verbatim, and the overall posture is never assured", { timeout: T }, async () => {
    const seeded = await seedRealStore();
    const app = mkApp();
    const core = await load("posture-core.js");
    const raw = {runs: await getJson(app, "/v1/work-runs"), reviews: await getJson(app, "/v1/reviews"), cockpit: await getJson(app, "/v1/cockpit")};
    const res = {workRuns: core.mapPostureWorkRuns(raw.runs), reviews: core.mapPostureReviews(raw.reviews), evidence: core.mapPostureEvidence(raw.cockpit)};
    for (const r of Object.values(res) as any[]) expect(r.state).toBe("VERIFIED");
    // Kayıtlı ham karar AYNEN sunucu özetinden gelir (beş durumun tamamı, eksik anahtar 0).
    expect(res.reviews.reviews.summary).toMatchObject({runs: 5, byState: {CLEAN: 1, BLOCKED: 1, NO_VERDICT: 0, NOT_REVIEWED: 2, INDEPENDENCE_UNVERIFIED: 1}});
    const a = core.buildPosture(res);
    expect(a.runs).toBe(5);
    expect(a.byPillar.qa).toMatchObject({status: "INCOMPLETE", total: 5, good: 0, counts: {EXECUTED: 0, FAILED: 0, BLOCKED: 0, NOT_EXECUTED: 5, UNVERIFIED: 0}});
    expect(a.byPillar.security).toMatchObject({status: "INCOMPLETE", good: 0, counts: {PASSED: 0, NOT_EXECUTED: 5}});
    expect(a.latestSecurity).toBeNull();
    expect(a.byPillar.review).toMatchObject({status: "FAIL", total: 5, good: 1, counts: {CLEAN: 1, BLOCKED: 1, NOT_REVIEWED: 2, INDEPENDENCE_UNVERIFIED: 1, STALE: 0, NOT_LISTED: 0, UNCONFIRMED: 0}});
    // Gerçek günlükte kanıt kayıtları hash ile doğrulanır: bütünlük sütunu OK'dur (sıfırdan büyük kayıt) — ama sağlam bir kanıt tabanı QA/güvenlik/inceleme eksiğini kapatmaz.
    const itotal = a.byPillar.integrity.total as number;
    expect(itotal).toBeGreaterThan(0);
    expect(a.byPillar.integrity).toMatchObject({status: "OK", total: itotal, good: itotal, counts: {verified: itotal, mismatch: 0, missing: 0, unverifiable: 0}});
    expect(a.tier).toBe("AT_RISK");
    expect(a.rows.map((r: any) => r.runId).sort()).toEqual(Object.values(seeded).sort());

    const view = await load("views", "posture.js");
    const {ctx, calls} = await mkCtx(async p => getJson(app, p));
    const rootNode: N = await view.render(ctx);
    expect(calls.slice().sort()).toEqual(THREE);
    expect(itemsOf(rootNode).length).toBe(5);
    expect(overallOf(rootNode).dataset.overall).toBe("AT_RISK");
    expect(pills(overallOf(rootNode))).toEqual(["BLOCKED"]);
    expect(kpiValue(rootNode, "total")).toBe("5");
    expect(kpiValue(rootNode, "qa")).toBe("0");
    expect(kpiValue(rootNode, "security")).toBe("0");
    expect(kpiValue(rootNode, "review")).toBe("1");
    expect(kpiValue(rootNode, "integrity")).toBe(String(itotal));
    expect(pillarOf(rootNode, "integrity").dataset.pillarStatus).toBe("OK");
    expect(pillarOf(rootNode, "qa").dataset.pillarStatus).toBe("INCOMPLETE");
    expect(missingOf(rootNode)).toEqual([["qa", "NOT_EXECUTED", "5"], ["security", "NOT_EXECUTED", "5"], ["review", "BLOCKED", "1"], ["review", "INDEPENDENCE_UNVERIFIED", "1"], ["review", "NOT_REVIEWED", "2"]]);
    const ra = itemFor(rootNode, seeded.A), rc = itemFor(rootNode, seeded.C), rd = itemFor(rootNode, seeded.D);
    expect(ra.dataset).toMatchObject({qa: "NOT_EXECUTED", security: "NOT_EXECUTED", review: "CLEAN"});
    expect(rc.dataset.review).toBe("BLOCKED");
    expect(rd.dataset.review).toBe("INDEPENDENCE_UNVERIFIED");
    expect(byData(field(rd, "review")!, "verbatim", "1")!.textContent).toBe("INDEPENDENCE_UNVERIFIED");
    expect(serverCount(pillarOf(rootNode, "review"), "INDEPENDENCE_UNVERIFIED")!.textContent).toBe("INDEPENDENCE_UNVERIFIED: 1");
    expectNotAssured(rootNode, "real-seeded");
    expect(rootNode.textContent).not.toMatch(/product[\s_-]*verified/i);
  });
  it("a real Work OS without any journal gives honest empty pillars (real zeros, NO_DATA) and an UNKNOWN integrity pillar — never assured", async () => {
    const app = mkApp();
    const r = await renderView(p => getJson(app, p));
    expect(itemsOf(r.root).length).toBe(0);
    expect(byData(r.root, "postureEmpty", "1")!.textContent).toContain("No work runs have been recorded yet");
    expect(allData(r.root, "postureState").length).toBe(0);
    expect(pillarOf(r.root, "qa").dataset.pillarStatus).toBe("NO_DATA");
    expect(pillarOf(r.root, "security").dataset.pillarStatus).toBe("NO_DATA");
    expect(pillarOf(r.root, "review").dataset.pillarStatus).toBe("NO_DATA");
    expect(pillarOf(r.root, "integrity").dataset.pillarStatus).toBe("UNKNOWN");
    expect(kpiValue(r.root, "total")).toBe("0");
    expect(kpiValue(r.root, "integrity")).toBe("—");
    expect(overallOf(r.root).dataset.overall).toBe("UNKNOWN");
    expectNotAssured(r.root, "real-empty");
  });
});

describe("Posture — REAL runner + REAL git: a CLEAN independent review without a sandbox never makes the posture assured", () => {
  it("shows the real review verdict with QA NOT_EXECUTED; the security scan is shown as recorded; the overall posture stays below assured", { timeout: T }, async () => {
    const rt = tmpRoot("uasco-posture-m1a-");
    try {
      const c = setup(rt);
      const app = relfxApi(c, {sandbox: undefined}) as unknown as App; apps.push(app);
      const created = await app.inject({method: "POST", url: "/v1/projects", headers: RELFX_HDR, payload: {name: "Posture App", environmentId: "dev", template: "web-node", idempotencyKey: "posture-1"}});
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

      const core = await load("posture-core.js");
      const raws = {runs: await getJson(app, "/v1/work-runs", RELFX_HDR), reviews: await getJson(app, "/v1/reviews", RELFX_HDR), cockpit: await getJson(app, "/v1/cockpit", RELFX_HDR)};
      // Gerçek gövdeler katı eşleyicilerden geçer (gerçek veri biçimi sözleşmeyle uyumlu).
      expect(core.mapPostureWorkRuns(raws.runs).state).toBe("VERIFIED");
      expect(core.mapPostureReviews(raws.reviews).state).toBe("VERIFIED");
      expect(core.mapPostureEvidence(raws.cockpit).state).toBe("VERIFIED");
      expect(raws.reviews.runs.find((x: any) => x.runId === run.runId).reviewState).toBe("CLEAN");

      const {root: rootNode} = await renderView(p => getJson(app, p, RELFX_HDR));
      const row = itemFor(rootNode, run.runId);
      expect(row.dataset.review).toBe("CLEAN");
      expect(row.dataset.qa).toBe("NOT_EXECUTED");
      expect(["PASSED", "PARTIAL"]).toContain(row.dataset.security);
      expect(byData(field(row, "review")!, "verbatim", "1")!.textContent).toBe("CLEAN");
      expect(pillarOf(rootNode, "qa").dataset.pillarStatus).toBe("INCOMPLETE");
      expect(pills(field(row, "qa")!)).toEqual(["NOT_EXECUTED"]);
      expect(missingOf(rootNode).some(([p, code]) => p === "qa" && code === "NOT_EXECUTED")).toBe(true);
      expect(overallOf(rootNode).dataset.overall).not.toBe("ASSURED");
      expectNotAssured(rootNode, "real-runner");
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
describe("Posture — only already-allow-listed read-only GETs are used (protected files unchanged)", () => {
  it("all three GET paths are already admitted by the desktop allow-list (incl. the UI-049 reviews list); nothing new is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    for (const p of THREE) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/posture", "/v1/security", "/v1/security/posture", "/v1/assurance", "/v1/qa", "/v1/reviews/", "/v1/reviews?x=1", "/v1/reviews/bad", "/v1/cockpit?x=1", "/v1/work-runs/"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes("posture")).toBe(false);
    expect(set.includes("reviews")).toBe(false); // /v1/reviews zaten ayrık çapalı desenle (REVIEWS_LIST_RE) izinli; küme büyümez
    for (const f of [mainSrc, fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8"), fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")]) {
      expect(f).not.toContain("/v1/posture");
      expect(f).not.toContain("/v1/security/posture");
    }
  });
  it("posture.js / posture-core.js never write and never reach outside ctx.api: no post, bridge, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "posture.js"), read("posture-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions/);
    }
    const imports = moduleSpecifiers({source: read("views", "posture.js")}).sort();
    expect(imports).toEqual(["../components.js", "../model.js", "../posture-core.js", "../work-core.js"]);
    expect(moduleSpecifiers({source: read("posture-core.js")}).sort()).toEqual(["./readiness-core.js"]);
    for (const m of ["commandCenterWorkRuns", "commandCenterReviews", "commandCenterEvidence"]) expect(read("views", "posture.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur (yeni POST yolu eklenmez); duruş erişimcileri yalnız sabit GET yollarını okur.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const accessors = read("api.js").split(String.fromCharCode(10)).filter(l => /^\s*async commandCenter(WorkRuns|Reviews|Evidence)\(\)/.test(l));
    expect(accessors.length).toBe(3);
    for (const l of accessors) { expect(l).not.toMatch(/post\(|apiPost|force/); expect(l).toMatch(/await get\((WORK_RUNS|REVIEWS|COCKPIT)_PATH\)/); }
  });
  it("the api layer requests exactly the three fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls} = await mkCtx(serve());
    const core = await load("posture-core.js");
    expect(core.POSTURE_SOURCE_PATHS).toEqual({workRuns: "/v1/work-runs", reviews: "/v1/reviews", evidence: "/v1/cockpit"});
    expect(core.POSTURE_SOURCES).toEqual(["workRuns", "reviews", "evidence"]);
    expect((await ctx.api.commandCenterWorkRuns()).state).toBe("VERIFIED");
    expect((await ctx.api.commandCenterReviews()).state).toBe("VERIFIED");
    expect((await ctx.api.commandCenterEvidence()).state).toBe("VERIFIED");
    expect(calls).toEqual(["/v1/work-runs", "/v1/reviews", "/v1/cockpit"]);
    for (const m of ["commandCenterWorkRuns", "commandCenterReviews", "commandCenterEvidence"]) expect(ctx.api[m].length).toBe(0);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    const ms = ["commandCenterWorkRuns", "commandCenterReviews", "commandCenterEvidence"];
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ms) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    for (const m of ms) expect((await ctx.api[m]()).state, m).toBe("ERROR");
  });
});

// ---------------- (3) pure mappers ----------------
describe("Posture — pure mappers are fail-closed and never elevate state", () => {
  it("mapPostureWorkRuns / mapPostureEvidence use the strict Quality Gate contract: any malformed field makes the WHOLE read ERROR", async () => {
    const core = await load("posture-core.js");
    const ok = core.mapPostureWorkRuns({runs: [SOURCE_RUN()]});
    expect(ok.state).toBe("VERIFIED");
    expect(ok.runs.items[0]).toMatchObject({runId: RUN2, security: "PASSED", tests: "NOT_EXECUTED"});
    const bad = (over: Record<string, any>) => core.mapPostureWorkRuns({runs: [SOURCE_RUN(), runRow(RUN3, MSN3, over)]});
    for (const over of [{status: "DONE"}, {runId: "run_x"}, {headSha: "zz"}, {evidence: "no"}, {remediationCycle: -1}, {step: "NOPE"}, {updatedAt: "not-a-date"}, {evidence: [{kind: "SECURITY_REPORT", cycle: 1, security: {status: "OK"}}]}]) expect(bad(over), JSON.stringify(over)).toEqual({state: "ERROR", runs: null});
    expect(core.mapPostureWorkRuns({runs: [SOURCE_RUN(), SOURCE_RUN()]})).toEqual({state: "ERROR", runs: null}); // yinelenen kimlik
    for (const nonsense of [null, 7, "x", [], {}, {runs: "no"}]) expect(core.mapPostureWorkRuns(nonsense)).toEqual({state: "ERROR", runs: null});
    for (const nonsense of [null, 7, [], {}, {generatedAt: "x", evidence: {state: "VERIFIED"}}, {generatedAt: "2026-10-16T08:00:00.000Z", evidence: {state: "WEIRD"}}, cockpitBody({verified: 9}), cockpitBody({total: "10"}), cockpitBody({missing: -1})]) expect(core.mapPostureEvidence(nonsense), JSON.stringify(nonsense)).toEqual({state: "ERROR", evidence: null});
    expect(core.mapPostureEvidence(cockpitBody({state: "UNAVAILABLE", total: 5, verified: 5, mismatch: null, missing: null, unverifiable: null})).evidence).toMatchObject({state: "UNAVAILABLE", total: null, verified: null});
  });
  it("mapPostureReviews carries every server review state VERBATIM (missing key = 0) and links nothing it cannot confirm", async () => {
    const core = await load("posture-core.js");
    const runs = [GOOD_RUN(RUN1, MSN1), SOURCE_RUN(), BLOCKED_RUN(), NEW_RUN()];
    const states = {[RUN1]: "CLEAN", [RUN2]: "INDEPENDENCE_UNVERIFIED", [RUN3]: "BLOCKED", [RUN4]: "NOT_REVIEWED"};
    const m = core.mapPostureReviews(reviewsFor(runs, states));
    expect(m.state).toBe("VERIFIED");
    expect(m.reviews.summary).toEqual({runs: 4, reviews: 3, byState: {CLEAN: 1, BLOCKED: 1, NO_VERDICT: 0, NOT_REVIEWED: 1, INDEPENDENCE_UNVERIFIED: 1}});
    expect(m.reviews.runs.map((r: any) => r.reviewState)).toEqual(["CLEAN", "INDEPENDENCE_UNVERIFIED", "BLOCKED", "NOT_REVIEWED"]);
    const nv = core.mapPostureReviews(reviewsFor([NEW_RUN()], {[RUN4]: "NO_VERDICT"}));
    expect(nv.state).toBe("ERROR"); // NO_VERDICT için kayıt ve head gerekir: yeni koşuda head yok -> çelişki
    expect(core.mapPostureReviews(reviewsFor([SOURCE_RUN()], {[RUN2]: "NO_VERDICT"})).reviews.summary.byState.NO_VERDICT).toBe(1);
  });
  it("any malformed or self-contradicting review payload makes the WHOLE reviews read ERROR (no partial verdicts)", async () => {
    const core = await load("posture-core.js");
    const base = () => reviewsFor(RUNS.runs, DEFAULT_STATES) as any;
    const mut = (fn: (b: any) => void) => { const b = base(); fn(b); return core.mapPostureReviews(b); };
    expect(core.mapPostureReviews(base()).state).toBe("VERIFIED");
    const cases: Array<[string, (b: any) => void]> = [
      ["unknown verdict", b => { b.reviews[0] = {...b.reviews[0], verdict: "APPROVED"}; }],
      ["unknown review state", b => { b.runs[0] = {...b.runs[0], reviewState: "APPROVED"}; }],
      ["counter mismatch", b => { b.summary.runs += 1; }],
      ["state counter mismatch", b => { b.summary.runsByReviewState = {CLEAN: 99}; }],
      ["wrong source", b => { b.source = "SOMETHING_ELSE"; }],
      ["missing summary", b => { delete b.summary; }],
      ["CLEAN contradicted by a non-independent record", b => { b.reviews[0] = {...b.reviews[0], independent: false}; }],
      ["CLEAN contradicted by another commit", b => { b.reviews[0] = {...b.reviews[0], reviewedCommit: OLD}; }],
      ["duplicate run", b => { b.runs.push(b.runs[0]); b.summary.runs += 1; b.summary.runsByReviewState.CLEAN += 1; }],
      ["bad review id", b => { b.reviews[0] = {...b.reviews[0], reviewId: "evd_x"}; }]];
    for (const [name, fn] of cases) expect(mut(fn), name).toEqual({state: "ERROR", reviews: null});
    for (const nonsense of [null, 7, [], {}, {source: "WORK_OS_JOURNAL_RUN_EVIDENCE"}]) expect(core.mapPostureReviews(nonsense)).toEqual({state: "ERROR", reviews: null});
  });
});

// ---------------- (4) aggregation: the overall posture is honest ----------------
describe("Posture — the overall posture is ASSURED only when all four pillars are genuinely satisfied; nothing is assumed", () => {
  it("the baseline with all four pillars satisfied is ASSURED and lists nothing as missing (positive control)", async () => {
    const {out} = await assess(GOOD);
    expect(out.tier).toBe("ASSURED");
    expect(out.missing).toEqual([]);
    expect(out.pillars.map((p: any) => [p.id, p.status])).toEqual([["qa", "OK"], ["security", "OK"], ["review", "OK"], ["integrity", "OK"]]);
    expect(out.byPillar.qa).toMatchObject({good: 1, total: 1}); expect(out.byPillar.integrity).toMatchObject({good: 10, total: 10});
    expect(out.latestSecurity).toMatchObject({runId: RUN1, status: "PASSED"});
    expect(out.unreadable).toEqual([]); expect(out.incompleteState).toBeNull(); expect(out.unknownState).toBeNull();
  });
  it("breaking ANY single pillar in ANY way (missing, stale, partial, failed, unverified, unreadable) can never leave the posture ASSURED, and the broken pillar is the one named as missing", async () => {
    const R = (o: Record<string, any>) => GOOD_RUN(RUN1, MSN1, o);
    const evWith = (drop: string[], extra: any[]) => [...FULL_EV().filter(e => !drop.includes(e.kind)), ...extra];
    const noTests = () => evWith(["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"], NOT_EXEC());
    const cases: Array<[string, any[], {reviews?: any; cockpit?: any}, string, string, string]> = [
      // [name, runs, overrides, expected tier, pillar named, reason code]
      ["tests not executed (no sandbox)", [R({evidence: noTests()})], {}, "UNVERIFIED", "qa", "NOT_EXECUTED"],
      ["tests unattested", [R({evidence: evWith(["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"], TESTS({sandboxProviderId: null}))})], {}, "UNVERIFIED", "qa", "UNVERIFIED"],
      ["tests failed", [R({evidence: evWith(["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"], TESTS({exitCode: 1}))})], {}, "AT_RISK", "qa", "FAILED"],
      ["only verify tests present", [R({evidence: FULL_EV().filter(e => e.kind !== "REGRESSION_TESTS")})], {}, "UNVERIFIED", "qa", "NOT_EXECUTED"],
      ["security partial", [R({evidence: evWith(["SECURITY_REPORT"], [SEC("PARTIAL")])})], {}, "UNVERIFIED", "security", "PARTIAL"],
      ["security blocked", [R({evidence: evWith(["SECURITY_REPORT"], [SEC("BLOCKED")])})], {}, "AT_RISK", "security", "BLOCKED"],
      ["security stale (other commit)", [R({evidence: evWith(["SECURITY_REPORT"], [SEC("PASSED", {commitSha: OLD})])})], {}, "UNVERIFIED", "security", "STALE"],
      ["no security scan", [R({evidence: evWith(["SECURITY_REPORT"], [])})], {}, "UNVERIFIED", "security", "NOT_EXECUTED"],
      ["review blocked", GOOD, {reviews: reviewsFor(GOOD, {[RUN1]: "BLOCKED"})}, "AT_RISK", "review", "BLOCKED"],
      ["review not reviewed", GOOD, {reviews: reviewsFor(GOOD, {[RUN1]: "NOT_REVIEWED"})}, "UNVERIFIED", "review", "NOT_REVIEWED"],
      ["independence unverified", GOOD, {reviews: reviewsFor(GOOD, {[RUN1]: "INDEPENDENCE_UNVERIFIED"})}, "UNVERIFIED", "review", "INDEPENDENCE_UNVERIFIED"],
      ["no verdict", GOOD, {reviews: reviewsFor(GOOD, {[RUN1]: "NO_VERDICT"})}, "UNVERIFIED", "review", "NO_VERDICT"],
      ["review of another head (stale)", GOOD, {reviews: reviewsBody([rv(GOOD[0], "CLEAN", {sum: {headSha: OLD}, rec: {reviewedCommit: OLD}})])}, "UNVERIFIED", "review", "STALE"],
      ["run missing from the review list", GOOD, {reviews: reviewsBody([])}, "UNVERIFIED", "review", "NOT_LISTED"],
      ["evidence mismatch", GOOD, {cockpit: cockpitBody({verified: 9, mismatch: 1})}, "AT_RISK", "integrity", "MISMATCH"],
      ["evidence missing", GOOD, {cockpit: cockpitBody({verified: 9, missing: 1})}, "UNVERIFIED", "integrity", "MISSING"],
      ["evidence unverifiable", GOOD, {cockpit: cockpitBody({verified: 9, unverifiable: 1})}, "UNVERIFIED", "integrity", "UNVERIFIABLE"],
      ["evidence stale", GOOD, {cockpit: cockpitBody({state: "STALE"})}, "UNVERIFIED", "integrity", "STALE"],
      ["no evidence records", GOOD, {cockpit: cockpitBody({total: 0, verified: 0})}, "UNVERIFIED", "integrity", "NO_RECORDS"],
      ["evidence block unavailable", GOOD, {cockpit: cockpitBody({state: "UNAVAILABLE", total: null, verified: null, mismatch: null, missing: null, unverifiable: null})}, "UNKNOWN", "integrity", "UNAVAILABLE"],
      ["evidence block error", GOOD, {cockpit: cockpitBody({state: "ERROR", total: null, verified: null, mismatch: null, missing: null, unverifiable: null})}, "UNKNOWN", "integrity", "ERROR"]];
    for (const [name, runs, o, tier, pillar, code] of cases) {
      const {out} = await assess(runs, o);
      expect(out.tier, name).toBe(tier);
      expect(out.tier, name).not.toBe("ASSURED");
      expect(out.missing.some((m: any) => m.pillar === pillar && m.code === code), name).toBe(true);
      expect(out.byPillar[pillar].status, name).not.toBe("OK");
    }
    // Hiç koşu yok: üç sütun NO_DATA (gerçek sıfır), ASSURED değil; her sütun "kayıt yok" olarak adlandırılır.
    const {out: empty} = await assess([], {reviews: reviewsBody([])});
    expect(empty.tier).toBe("UNVERIFIED");
    expect(empty.pillars.map((p: any) => p.status)).toEqual(["NO_DATA", "NO_DATA", "NO_DATA", "OK"]);
    expect(empty.missing.map((m: any) => [m.pillar, m.code])).toEqual([["qa", "NO_RECORDS"], ["security", "NO_RECORDS"], ["review", "NO_RECORDS"]]);
  });
  it("unreadable sources make their pillars UNKNOWN with NO counts (null, never 0); a readable negative pillar still wins (AT_RISK), otherwise the tier is UNKNOWN", async () => {
    const core = await load("posture-core.js");
    const good = await assess(GOOD);
    for (const state of ["OFFLINE", "UNAVAILABLE", "ERROR"]) {
      const out = core.buildPosture({...good.res, workRuns: {state, runs: null}});
      expect(out.byPillar.qa).toMatchObject({status: "UNKNOWN", detail: state, total: null, counts: null, good: null});
      expect(out.byPillar.security).toMatchObject({status: "UNKNOWN", counts: null});
      expect(out.runs).toBeNull(); expect(out.rows).toEqual([]); expect(out.latestSecurity).toBeNull();
      expect(out.sources.workRuns.state).toBe(state); expect(out.unreadable).toEqual(["workRuns"]);
      expect(out.tier).toBe("UNKNOWN"); expect(out.unknownState).toBe(state);
      const rev = core.buildPosture({...good.res, reviews: {state, reviews: null}});
      expect(rev.byPillar.review).toMatchObject({status: "UNKNOWN", detail: state, total: null, counts: null, good: null});
      expect(rev.tier).toBe("UNKNOWN");
      expect(rev.rows.every((r: any) => r.review === null && r.reviewUnread === state)).toBe(true);
      const evd = core.buildPosture({...good.res, evidence: {state, evidence: null}});
      expect(evd.byPillar.integrity).toMatchObject({status: "UNKNOWN", detail: state, total: null, counts: null, good: null});
      expect(evd.tier).toBe("UNKNOWN");
      for (const x of [out, rev, evd]) expect(x.missing.length).toBeGreaterThan(0);
    }
    // Hepsi okunamıyor: hiçbir sayı, hiçbir satır, ASSURED yok.
    const none = core.buildPosture({workRuns: {state: "OFFLINE", runs: null}, reviews: {state: "ERROR", reviews: null}, evidence: {state: "UNAVAILABLE", evidence: null}});
    expect(none.pillars.every((p: any) => p.status === "UNKNOWN" && p.counts === null && p.total === null)).toBe(true);
    expect(none.tier).toBe("UNKNOWN"); expect(none.unknownState).toBe("OFFLINE"); expect(none.incompleteState).toBe("OFFLINE");
    expect(core.buildPosture({}).tier).toBe("UNKNOWN");
    // Okunabilir olumsuz sütun, başka bir sütunun okunamamasının önüne geçer.
    const neg = await assess(RUNS.runs, {reviews: REVIEWS});
    const withOffline = core.buildPosture({...neg.res, workRuns: {state: "OFFLINE", runs: null}});
    expect(withOffline.byPillar.review.status).toBe("FAIL");
    expect(withOffline.tier).toBe("AT_RISK");
    // VERIFIED ama gövdesi eksik (özetsiz inceleme) tahmin edilmez: ERROR kaynak ve UNKNOWN sütun.
    const noSummary = core.buildPosture({...good.res, reviews: {state: "VERIFIED", reviews: {truncated: false, runs: [], records: []}}});
    expect(noSummary.sources.reviews.state).toBe("ERROR"); expect(noSummary.byPillar.review.status).toBe("UNKNOWN"); expect(noSummary.tier).toBe("UNKNOWN");
  });
  it("QA and security aggregate per run from the CURRENT head only; NOT_EXECUTED is counted as such, the latest scan is the newest run that has one", async () => {
    const {out} = await assess(RUNS.runs, {reviews: REVIEWS});
    expect(out.byPillar.qa).toMatchObject({status: "INCOMPLETE", total: 3, good: 0, counts: {EXECUTED: 0, FAILED: 0, BLOCKED: 0, NOT_EXECUTED: 3, UNVERIFIED: 0}});
    expect(out.byPillar.security).toMatchObject({status: "INCOMPLETE", good: 1, counts: {PASSED: 1, PARTIAL: 0, BLOCKED: 0, STALE: 0, NOT_EXECUTED: 2}});
    expect(out.latestSecurity).toEqual({runId: RUN2, status: "PASSED", updatedAt: "2026-10-16T05:00:00.000Z"});
    expect(out.byPillar.review).toMatchObject({status: "FAIL", total: 3, good: 1, server: {CLEAN: 1, BLOCKED: 1, NO_VERDICT: 0, NOT_REVIEWED: 1, INDEPENDENCE_UNVERIFIED: 0}});
    expect(out.tier).toBe("AT_RISK");
    expect(out.missing.map((m: any) => [m.pillar, m.code, m.n])).toEqual([["qa", "NOT_EXECUTED", 3], ["security", "NOT_EXECUTED", 2], ["review", "BLOCKED", 1], ["review", "NOT_REVIEWED", 1]]);
    // En yeni etkinlik önce; satır başına değerler koşunun kendisinden.
    expect(out.rows.map((r: any) => r.runId)).toEqual([RUN4, RUN2, RUN3]);
    expect(out.rows[1]).toMatchObject({qa: "NOT_EXECUTED", security: "PASSED", review: "CLEAN"});
    expect(out.rows[2]).toMatchObject({qa: "NOT_EXECUTED", security: "NOT_EXECUTED", review: "BLOCKED"});
    // Güvenlik taraması başka commit'e aitse en son kayıt STALE olarak adlandırılır (yükseltilmez).
    const stale = await assess([SOURCE_RUN({evidence: [IMPL(), ...NOT_EXEC(), SEC("PASSED", {commitSha: OLD}), REVIEW_EV(), REPORT()]})]);
    expect(stale.out.latestSecurity).toMatchObject({status: "STALE"});
  });
  it("a truncated review list leaves unseen runs unconfirmed: the pillar can never be satisfied and names them", async () => {
    const pairs = GOOD.map(r => rv(r, "CLEAN"));
    const b: any = reviewsBody(pairs);
    b.summary.truncated = true; b.summary.runs += 2; b.summary.runsByReviewState.CLEAN += 2;
    const {out} = await assess(GOOD, {reviews: b});
    expect(out.byPillar.review).toMatchObject({status: "INCOMPLETE", unseen: 2, truncated: true, server: {CLEAN: 3}});
    expect(out.missing.some((m: any) => m.pillar === "review" && m.code === "UNSEEN" && m.n === 2)).toBe(true);
    expect(out.tier).toBe("UNVERIFIED");
    // Kısaltılmış listede kaydı olmayan CLEAN özeti doğrulanamaz (UNCONFIRMED), asla temiz sayılmaz.
    const c: any = reviewsBody(pairs.map(p => ({sum: p.sum, rec: null})));
    c.summary.truncated = true; c.summary.reviews = 1; c.summary.reviewsByVerdict = {CLEAN: 1};
    const r2 = await assess(GOOD, {reviews: c});
    expect(r2.out.byPillar.review.counts.UNCONFIRMED).toBe(1);
    expect(r2.out.byPillar.review.status).toBe("INCOMPLETE");
    expect(r2.out.tier).not.toBe("ASSURED");
  });
  it("rows are newest activity first, with createdAt then run id as stable tie-breakers", async () => {
    const same = "2026-10-16T09:00:00.000Z";
    const runs = [runRow(RUN("a1"), MSN1, {updatedAt: same}), runRow(RUN("b2"), MSN1, {updatedAt: same}), runRow(RUN("c3"), MSN1, {updatedAt: same, createdAt: "2026-10-16T03:00:00.000Z"}), runRow(RUN("d4"), MSN1, {updatedAt: "2026-10-16T10:00:00.000Z"})];
    const {out} = await assess(runs);
    expect(out.rows.map((r: any) => r.runId)).toEqual([RUN("d4"), RUN("c3"), RUN("b2"), RUN("a1")]);
  });
});

// ---------------- (5) view honesty ----------------
describe("Posture — view honesty", () => {
  it("renders summary (A), pillars (B) and runs (C) in that order with real figures: QA NOT_EXECUTED, security as recorded, review verbatim, what is missing named", async () => {
    const {root, calls} = await renderView(serve());
    expect(calls.slice().sort()).toEqual(THREE);
    expect(all(root).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["posture-summary", "posture-pillars", "posture-runs"]);
    expect(byId(root, "view-title")!.textContent).toBe("Assurance Command Center & Security Posture");
    expect(sourcesOf(root).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["workRuns", "VERIFIED"], ["reviews", "VERIFIED"], ["evidence", "VERIFIED"]]);
    // Genel duruş: bir inceleme BLOCKED -> olumsuz kanıt; ASSURED değil.
    expect(overallOf(root).dataset.overall).toBe("AT_RISK");
    expect(pills(overallOf(root))).toEqual(["BLOCKED"]);
    expect(overallOf(root).textContent).toContain("At risk");
    expectNotAssured(root, "default");
    // Eksikler adıyla (sütun + neden + sayı).
    expect(missingOf(root)).toEqual([["qa", "NOT_EXECUTED", "3"], ["security", "NOT_EXECUTED", "2"], ["review", "BLOCKED", "1"], ["review", "NOT_REVIEWED", "1"]]);
    const missingTexts = allData(root, "missingPillar").map(n => n.textContent);
    expect(missingTexts[0]).toBe("QA evidence: 3 run(s) with tests not executed (no verified sandbox, or not reached)");
    expect(missingTexts[2]).toBe("Independent review: 1 run(s) the independent reviewer rejected");
    expect(byData(root, "missing", "0")).toBeUndefined();
    // KPI: gerçek sayılar; QA 0 yürütüldü, başarı rozeti yok.
    expect(kpiValue(root, "total")).toBe("3");
    expect(kpiValue(root, "qa")).toBe("0");
    expect(kpiValue(root, "security")).toBe("1");
    expect(kpiValue(root, "review")).toBe("1");
    expect(kpiValue(root, "integrity")).toBe("10");
    expect(pills(kpi(root, "qa"))).toEqual(["NOT_VERIFIED"]);
    expect(pills(kpi(root, "security"))).toEqual(["NOT_VERIFIED"]);
    expect(pills(kpi(root, "review"))).toEqual(["BLOCKED"]);
    expect(pills(kpi(root, "integrity"))).toEqual(["DONE"]);
    // Sütun kartları.
    expect(pillarCards(root).map(n => [n.dataset.pillar, n.dataset.pillarStatus])).toEqual([["qa", "INCOMPLETE"], ["security", "INCOMPLETE"], ["review", "FAIL"], ["integrity", "OK"]]);
    const qa = pillarOf(root, "qa");
    expect(countOf(qa, "NOT_EXECUTED")!.textContent).toBe("Not executed: 3");
    expect(countOf(qa, "EXECUTED")!.textContent).toBe("Executed: 0");
    expect(byData(qa, "field", "basis")!.textContent).toBe("Based on 3 work runs.");
    expect(pills(qa)).toEqual(["NOT_VERIFIED"]);
    const sec = pillarOf(root, "security");
    expect(countOf(sec, "PASSED")!.textContent).toBe("Passed: 1");
    expect(countOf(sec, "NOT_EXECUTED")!.textContent).toBe("Not executed: 2");
    expect(byData(sec, "latest", "PASSED")!.textContent).toContain(RUN2);
    const rev = pillarOf(root, "review");
    expect(["CLEAN", "BLOCKED", "NO_VERDICT", "NOT_REVIEWED", "INDEPENDENCE_UNVERIFIED"].map(k => serverCount(rev, k)!.textContent)).toEqual(["CLEAN: 1", "BLOCKED: 1", "NO_VERDICT: 0", "NOT_REVIEWED: 1", "INDEPENDENCE_UNVERIFIED: 0"]);
    expect(allData(rev, "verbatim", "1").length).toBe(5);
    expect(pills(rev)).toEqual(["BLOCKED"]);
    const integ = pillarOf(root, "integrity");
    expect(countOf(integ, "verified")!.textContent).toBe("Hash-verified: 10");
    expect(countOf(integ, "missing")!.textContent).toBe("Missing: 0");
    expect(pills(integ)).toEqual(["DONE"]);
    // Koşular: en yeni önce; değerler koşunun kendisinden.
    expect(itemsOf(root).map(n => n.dataset.postureItem)).toEqual([RUN4, RUN2, RUN3]);
    expect(itemFor(root, RUN2).dataset).toMatchObject({qa: "NOT_EXECUTED", security: "PASSED", review: "CLEAN", runStatus: "AWAITING_APPROVAL"});
    expect(pills(field(itemFor(root, RUN2), "qa")!)).toEqual(["NOT_EXECUTED"]);
    expect(pills(field(itemFor(root, RUN2), "security")!)).toEqual(["DONE"]);
    expect(byData(field(itemFor(root, RUN3), "review")!, "verbatim", "1")!.textContent).toBe("BLOCKED");
    expect(pills(field(itemFor(root, RUN3), "review")!)).toEqual(["BLOCKED"]);
    expect(field(itemFor(root, RUN4), "head")!.textContent).toBe("—");
    expect(field(itemFor(root, RUN4), "review")!.textContent).toContain("Not reviewed");
    // Sabit notlar ve dürüstlük uyarısı.
    expect(byData(root, "readonly", "1")).toBeTruthy();
    expect(byData(root, "honesty", "1")!.textContent).toContain("never zero and never passed");
    expect(byData(root, "note", "not-product-verification")!.textContent).toContain("not a product verification");
    expect(byData(root, "note", "actions")!.textContent).toContain("Nothing is approved, delivered or released from this view.");
    expect(byData(root, "note", "order")!.textContent).toBe("Order: newest activity first.");
    expect(allData(root, "postureState").length).toBe(0);
    expect(byData(root, "posturePartial")).toBeUndefined();
    expect(surface(root)).not.toContain(FORBIDDEN);
  });
  it("POSITIVE CONTROL: when all four pillars are genuinely satisfied the view shows ASSURED with nothing missing — and still never the verified-product constant", async () => {
    const {root} = await renderView(serveGood());
    expect(overallOf(root).dataset.overall).toBe("ASSURED");
    expect(pills(overallOf(root))).toEqual(["DONE"]);
    expect(overallOf(root).textContent).toContain("Assured by recorded evidence");
    expect(byData(root, "missing", "0")!.textContent).toBe("Nothing is missing: all four pillars are satisfied by recorded evidence.");
    expect(missingOf(root)).toEqual([]);
    expect(pillarCards(root).map(n => n.dataset.pillarStatus)).toEqual(["OK", "OK", "OK", "OK"]);
    expect(["qa", "security", "review", "integrity"].map(id => pills(kpi(root, id)))).toEqual([["DONE"], ["DONE"], ["DONE"], ["DONE"]]);
    expect(kpiValue(root, "qa")).toBe("1");
    expect(byData(root, "note", "not-product-verification")).toBeTruthy();
    expect(surface(root)).not.toContain(FORBIDDEN);
    expect(root.textContent).not.toMatch(/product[\s_-]*verified/i);
    expect(pills(root)).not.toContain(FORBIDDEN);
  });
  it("EXPLICIT: the posture NEVER shows ASSURED / secure / pass when QA is NOT_EXECUTED, security is not PASSED, a review is not clean, or evidence is unverified, missing or unreadable", async () => {
    const swap = (extra: Record<string, any>) => serveGood(extra);
    const noTests = GOOD_RUN(RUN1, MSN1, {evidence: [...FULL_EV().filter(e => !["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"].includes(e.kind)), ...NOT_EXEC()]});
    const withEv = (drop: string[], extra: any[]) => GOOD_RUN(RUN1, MSN1, {evidence: [...FULL_EV().filter(e => !drop.includes(e.kind)), ...extra]});
    const only = (run: any, extra: Record<string, any> = {}) => serve({"/v1/work-runs": {runs: [run]}, "/v1/reviews": reviewsFor([run]), ...extra});
    const scenarios: Array<[string, (p: string) => any]> = [
      ["QA tests NOT_EXECUTED (no sandbox)", only(noTests)],
      ["QA tests unattested", only(withEv(["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"], TESTS({sandboxProviderId: null})))],
      ["QA tests failed", only(withEv(["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"], TESTS({exitCode: 2})))],
      ["security none", only(withEv(["SECURITY_REPORT"], []))],
      ["security partial", only(withEv(["SECURITY_REPORT"], [SEC("PARTIAL")]))],
      ["security blocked", only(withEv(["SECURITY_REPORT"], [SEC("BLOCKED")]))],
      ["security stale", only(withEv(["SECURITY_REPORT"], [SEC("PASSED", {commitSha: OLD})]))],
      ["review blocked", swap({"/v1/reviews": reviewsFor(GOOD, {[RUN1]: "BLOCKED"})})],
      ["review not reviewed", swap({"/v1/reviews": reviewsFor(GOOD, {[RUN1]: "NOT_REVIEWED"})})],
      ["independence unverified", swap({"/v1/reviews": reviewsFor(GOOD, {[RUN1]: "INDEPENDENCE_UNVERIFIED"})})],
      ["no verdict", swap({"/v1/reviews": reviewsFor(GOOD, {[RUN1]: "NO_VERDICT"})})],
      ["reviews unreadable", swap({"/v1/reviews": () => fail("x", 500)})],
      ["reviews offline", swap({"/v1/reviews": () => { throw new Error("fetch failed"); }})],
      ["evidence mismatch", swap({"/v1/cockpit": cockpitBody({verified: 9, mismatch: 1})})],
      ["evidence missing", swap({"/v1/cockpit": cockpitBody({verified: 9, missing: 1})})],
      ["evidence unverifiable", swap({"/v1/cockpit": cockpitBody({verified: 9, unverifiable: 1})})],
      ["evidence stale", swap({"/v1/cockpit": cockpitBody({state: "STALE"})})],
      ["evidence unreadable", swap({"/v1/cockpit": () => fail("x", 500)})],
      ["evidence block unavailable", swap({"/v1/cockpit": cockpitBody({state: "UNAVAILABLE", total: null, verified: null, mismatch: null, missing: null, unverifiable: null})})],
      ["work runs unreadable", swap({"/v1/work-runs": () => fail("x", 404)})],
      ["no runs at all", serve({"/v1/work-runs": {runs: []}, "/v1/reviews": reviewsBody([])})],
      ["the realistic shape", serve()], ["the realistic shape without a negative", serveNoNeg()],
      ["everything offline", () => { throw new Error("fetch failed"); }], ["everything malformed", () => ({nonsense: true})]];
    // Pozitif kontrol: aynı düzenek bozulmamış durumda ASSURED gösterir; aksi halde bu test boş geçerdi.
    expect(overallOf((await renderView(serveGood())).root).dataset.overall).toBe("ASSURED");
    for (const lang of ["en", "tr"]) for (const [name, fn] of scenarios) {
      const {root} = await renderView(fn, lang);
      const label = `${lang}/${name}`;
      const o = overallOf(root);
      expect(o.dataset.overall, label).not.toBe("ASSURED");
      expect(allData(root, "overall", "ASSURED").length, label).toBe(0);
      expect(pills(o), label).not.toContain("DONE");
      expect(pills(o), label).not.toContain("VERIFIED");
      expect(o.textContent, label).not.toContain("Assured by recorded evidence");
      expect(o.textContent, label).not.toContain("Kayıtlı kanıtla güvenceli");
      expect(byData(root, "missing", "0"), label).toBeUndefined();
      expect(missingOf(root).length, label).toBeGreaterThan(0);
      if (lang === "en") expect(o.textContent, label).not.toMatch(/assured|secure|\bpass(ed)?\b/i);
      expect(surface(root), label).not.toContain(FORBIDDEN);
    }
    // QA NOT_EXECUTED -> hiçbir QA başarı göstergesi: sütun OK değil, KPI rozeti DONE değil, koşu rozeti NOT_EXECUTED.
    const q = await renderView(only(noTests));
    expect(pillarOf(q.root, "qa").dataset.pillarStatus).toBe("INCOMPLETE");
    expect(pills(kpi(q.root, "qa"))).not.toContain("DONE");
    expect(kpiValue(q.root, "qa")).toBe("0");
    expect(pills(field(itemFor(q.root, RUN1), "qa")!)).toEqual(["NOT_EXECUTED"]);
    expect(missingOf(q.root)).toEqual([["qa", "NOT_EXECUTED", "1"]]);
    expect(overallOf(q.root).dataset.overall).toBe("UNVERIFIED");
    // Güvenlik PASSED değil -> sütun OK değil.
    const s = await renderView(only(withEv(["SECURITY_REPORT"], [SEC("PARTIAL")])));
    expect(pillarOf(s.root, "security").dataset.pillarStatus).toBe("INCOMPLETE");
    expect(pills(kpi(s.root, "security"))).not.toContain("DONE");
    expect(kpiValue(s.root, "security")).toBe("0");
    // Kanıt doğrulanmamış -> sütun OK değil.
    const e = await renderView(swap({"/v1/cockpit": cockpitBody({verified: 9, unverifiable: 1})}));
    expect(pillarOf(e.root, "integrity").dataset.pillarStatus).toBe("INCOMPLETE");
    expect(pills(kpi(e.root, "integrity"))).not.toContain("DONE");
    expect(overallOf(e.root).dataset.overall).toBe("UNVERIFIED");
  });
  it("EVERY scenario in EN and TR renders without the verified-product constant (even though the API carries it) and without raw i18n keys", async () => {
    const withForbidden = serve({"/v1/work-runs": {runs: [GOOD_RUN(RUN1, MSN1, {completion: {headSha: HEAD, productVerification: {state: FORBIDDEN}}})]}, "/v1/reviews": reviewsFor(GOOD)});
    const scenarios: Array<[string, (p: string) => any]> = [
      ["full", serve()], ["good", serveGood()], ["api-carries-forbidden", withForbidden],
      ["offline", () => { throw new Error("fetch failed"); }], ["unavailable", () => fail("x", 404)], ["error", () => fail("x", 500)], ["malformed", () => ({nonsense: true})],
      ["empty", serve({"/v1/work-runs": {runs: []}, "/v1/reviews": reviewsBody([])})],
      ["mismatch", serve({"/v1/cockpit": cockpitBody({verified: 9, mismatch: 1})})], ["stale-evidence", serve({"/v1/cockpit": cockpitBody({state: "STALE"})})],
      ["evidence-unavailable", serve({"/v1/cockpit": cockpitBody({state: "UNAVAILABLE", total: null, verified: null, mismatch: null, missing: null, unverifiable: null})})],
      ["partial-reviews", (p: string) => (p === "/v1/reviews" ? fail(p, 500) : serve()(p))],
      ["partial-evidence", (p: string) => (p === "/v1/cockpit" ? fail(p, 404) : serve()(p))],
      ["partial-runs", (p: string) => (p === "/v1/work-runs" ? fail(p, 404) : serve()(p))],
      ["no-negative", serveNoNeg()]];
    for (const lang of ["en", "tr"]) for (const [name, fn] of scenarios) {
      const {root} = await renderView(fn, lang);
      const label = `${lang}/${name}`;
      expect(surface(root), label).not.toContain(FORBIDDEN);
      expect(root.textContent, label).not.toMatch(/product[\s_-]*verified/i);
      expect(lines(root), label).not.toMatch(/\b(posture|area\.posture)\.[A-Za-z]+(\.[A-Za-z_0-9]+)*\b/);
      expect(pills(root), label).not.toContain(FORBIDDEN);
    }
  });
  it("each source fails independently with its own honest state; healthy sources stay intact, only the dependent figures are withheld (—, never 0) and the dependent pillars are UNKNOWN", async () => {
    // Reviews okunamıyor: QA/güvenlik sayıları sağlam; yalnız inceleme sütunu/sayısı saklanır.
    let r = await renderView(serveNoNeg({"/v1/reviews": () => fail("x", 500)}));
    expect(allData(r.root, "postureState").map(n => [n.dataset.source, n.dataset.postureState])).toEqual([["reviews", "ERROR"]]);
    expect(sourcesOf(r.root).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["workRuns", "VERIFIED"], ["reviews", "ERROR"], ["evidence", "VERIFIED"]]);
    expect(byData(r.root, "postureState")!.textContent).toContain("GET /v1/reviews");
    expect(kpiValue(r.root, "total")).toBe("2"); expect(kpiValue(r.root, "qa")).toBe("0"); expect(kpiValue(r.root, "security")).toBe("1"); expect(kpiValue(r.root, "integrity")).toBe("10");
    expect(kpiValue(r.root, "review")).toBe("—"); expect(kpi(r.root, "review").dataset.state).toBe("ERROR");
    expect(pillarOf(r.root, "review").dataset.pillarStatus).toBe("UNKNOWN");
    expect(byData(pillarOf(r.root, "review"), "withheld", "1")!.dataset.reason).toBe("ERROR");
    expect(allData(pillarOf(r.root, "review"), "count").length).toBe(0);
    expect(allData(pillarOf(r.root, "review"), "serverCount").length).toBe(0);
    expect(byData(r.root, "posturePartial")!.dataset.posturePartial).toBe("reviews");
    expect(byData(r.root, "posturePartial")!.textContent).toContain("Independent reviews could not be read");
    expect(overallOf(r.root).dataset.overall).toBe("UNKNOWN");
    expect(pills(overallOf(r.root))).toEqual(["FAILED"]);
    expect(itemsOf(r.root).length).toBe(2);
    for (const li of itemsOf(r.root)) { expect(li.dataset.review).toBe("ERROR"); expect(pills(field(li, "review")!)).toEqual(["FAILED"]); expect(field(li, "review")!.textContent).toContain("unknown"); }
    expect(byData(r.root, "note", "reviews-unknown")).toBeTruthy();
    // Work-runs okunamıyor: hiç satır yok, "boş" da denmez; QA/güvenlik sayıları "—".
    r = await renderView(serve({"/v1/work-runs": () => fail("x", 404)}));
    expect(allData(r.root, "postureState").map(n => [n.dataset.source, n.dataset.postureState])).toEqual([["workRuns", "UNAVAILABLE"]]);
    expect(itemsOf(r.root).length).toBe(0);
    expect(byData(r.root, "postureEmpty")!.dataset.postureEmpty).toBe("unknown");
    expect(allData(r.root, "postureEmpty", "1").length).toBe(0);
    for (const id of ["total", "qa", "security"]) { expect(kpiValue(r.root, id), id).toBe("—"); expect(kpi(r.root, id).dataset.state, id).toBe("UNAVAILABLE"); }
    expect(kpiValue(r.root, "review")).toBe("1"); expect(kpiValue(r.root, "integrity")).toBe("10");
    expect(pillarOf(r.root, "qa").dataset.pillarStatus).toBe("UNKNOWN");
    expect(allData(pillarOf(r.root, "qa"), "count").length).toBe(0);
    expect(overallOf(r.root).dataset.overall).toBe("AT_RISK"); // okunabilir olumsuz kanıt (BLOCKED inceleme) bilinmeyenin önüne geçer
    // Kanıt bütünlüğü okunamıyor: yalnız bütünlük sütunu UNKNOWN.
    r = await renderView(serveNoNeg({"/v1/cockpit": () => fail("x", 500)}));
    expect(allData(r.root, "postureState").map(n => [n.dataset.source, n.dataset.postureState])).toEqual([["evidence", "ERROR"]]);
    expect(kpiValue(r.root, "integrity")).toBe("—");
    expect(pillarOf(r.root, "integrity").dataset.pillarStatus).toBe("UNKNOWN");
    expect(allData(pillarOf(r.root, "integrity"), "count").length).toBe(0);
    expect(kpiValue(r.root, "total")).toBe("2");
    expect(overallOf(r.root).dataset.overall).toBe("UNKNOWN");
  });
  it("when everything is unreadable no figure, pillar count or row is shown, and nothing is called assured, empty or zero", async () => {
    for (const [fn, expected] of [[() => { throw new Error("fetch failed"); }, "OFFLINE"], [() => fail("x", 404), "UNAVAILABLE"], [() => fail("x", 500), "ERROR"], [() => ({nonsense: true}), "ERROR"]] as const) {
      const {root} = await renderView(fn);
      expect(itemsOf(root).length, expected).toBe(0);
      expect(allData(root, "postureState").map(n => n.dataset.postureState), expected).toEqual([expected, expected, expected]);
      for (const id of ["total", "qa", "security", "review", "integrity"]) { expect(kpiValue(root, id), id).toBe("—"); expect(kpi(root, id).dataset.state, id).toBe(expected); }
      expect(pillarCards(root).map(n => n.dataset.pillarStatus)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"]);
      expect(allData(root, "count").length + allData(root, "serverCount").length, expected).toBe(0);
      expect(allData(root, "withheld", "1").length).toBe(4);
      expect(byData(root, "postureEmpty")!.dataset.postureEmpty).toBe("unknown");
      expect(overallOf(root).dataset.overall).toBe("UNKNOWN");
      expectNotAssured(root, expected);
    }
  });
  it("a malformed record rejects only its own source: no partial figures or rows from that source, the other sources stay readable", async () => {
    const badReview = (() => { const b: any = reviewsFor(RUNS.runs, DEFAULT_STATES); b.reviews[0] = {...b.reviews[0], verdict: "APPROVED"}; return b; })();
    let r = await renderView(serve({"/v1/reviews": badReview}));
    expect(allData(r.root, "postureState").map(n => [n.dataset.source, n.dataset.postureState])).toEqual([["reviews", "ERROR"]]);
    expect(kpiValue(r.root, "review")).toBe("—");
    expect(kpiValue(r.root, "total")).toBe("3");
    r = await renderView(serve({"/v1/work-runs": {runs: [SOURCE_RUN(), runRow(RUN3, MSN3, {status: "DONE"})]}}));
    expect(allData(r.root, "postureState").map(n => [n.dataset.source, n.dataset.postureState])).toEqual([["workRuns", "ERROR"]]);
    expect(itemsOf(r.root).length).toBe(0); // tek bozuk koşu, sağlam koşuyu da göstermez (kısmi liste yok)
    expect(kpiValue(r.root, "qa")).toBe("—");
    r = await renderView(serve({"/v1/cockpit": cockpitBody({verified: 9})}));
    expect(allData(r.root, "postureState").map(n => [n.dataset.source, n.dataset.postureState])).toEqual([["evidence", "ERROR"]]);
    expect(kpiValue(r.root, "integrity")).toBe("—");
    expect(itemsOf(r.root).length).toBe(3);
  });
  it("evidence integrity problems are shown as such: a mismatch is negative evidence, a missing/unverifiable record is incomplete, a non-live block is unknown with no numbers", async () => {
    let r = await renderView(serveGood({"/v1/cockpit": cockpitBody({verified: 7, mismatch: 2, missing: 1})}));
    let integ = pillarOf(r.root, "integrity");
    expect(integ.dataset.pillarStatus).toBe("FAIL");
    expect(countOf(integ, "verified")!.textContent).toBe("Hash-verified: 7");
    expect(countOf(integ, "mismatch")!.textContent).toBe("Mismatch: 2");
    expect(countOf(integ, "missing")!.textContent).toBe("Missing: 1");
    expect(pills(integ)).toEqual(["BLOCKED"]);
    expect(overallOf(r.root).dataset.overall).toBe("AT_RISK");
    expect(missingOf(r.root)).toEqual([["integrity", "MISMATCH", "2"], ["integrity", "MISSING", "1"]]);
    r = await renderView(serveGood({"/v1/cockpit": cockpitBody({state: "UNAVAILABLE", total: 5, verified: 5, mismatch: null, missing: null, unverifiable: null})}));
    integ = pillarOf(r.root, "integrity");
    expect(integ.dataset.pillarStatus).toBe("UNKNOWN");
    expect(pills(integ)).toEqual(["UNAVAILABLE"]);
    expect(allData(integ, "count").length).toBe(0);
    expect(r.root.textContent).not.toContain("5 evidence");
    expect(kpiValue(r.root, "integrity")).toBe("—");
    expect(kpi(r.root, "integrity").dataset.state).toBe("UNAVAILABLE");
    r = await renderView(serveGood({"/v1/cockpit": cockpitBody({state: "STALE"})}));
    integ = pillarOf(r.root, "integrity");
    expect(integ.dataset.pillarStatus).toBe("INCOMPLETE");
    expect(byData(integ, "field", "integrityAsOf")!.textContent).toContain("stale");
    expect(missingOf(r.root)).toEqual([["integrity", "STALE", ""]]);
  });
  it("honest empty state: no work runs is a readable zero with explicit text (only when the work runs were READ)", async () => {
    const {root} = await renderView(serve({"/v1/work-runs": {runs: []}, "/v1/reviews": reviewsBody([])}));
    expect(itemsOf(root).length).toBe(0);
    expect(byData(root, "postureEmpty", "1")!.textContent).toBe("No work runs have been recorded yet, so there is nothing to assess.");
    expect(kpiValue(root, "total")).toBe("0");
    expect(kpiValue(root, "qa")).toBe("0");
    expect(pillarOf(root, "qa").dataset.pillarStatus).toBe("NO_DATA");
    expect(missingOf(root)).toEqual([["qa", "NO_RECORDS", ""], ["security", "NO_RECORDS", ""], ["review", "NO_RECORDS", ""]]);
    expect(overallOf(root).dataset.overall).toBe("UNVERIFIED");
  });
  it("very long lists are truncated honestly (the first 200 shown, the real total stated) while the aggregate counts cover ALL runs", async () => {
    const runs = Array.from({length: 205}, (_, i) => runRow("run_" + (i + 1).toString(16).padStart(24, "0"), MSN1, {evidence: [], headSha: null, status: "RUNNING", updatedAt: new Date(Date.UTC(2026, 9, 16, 0, 0, i)).toISOString()}));
    const {root} = await renderView(serve({"/v1/work-runs": {runs}, "/v1/reviews": reviewsFor(runs, Object.fromEntries(runs.map(r => [r.runId, "NOT_REVIEWED"])))}));
    expect(itemsOf(root).length).toBe(200);
    expect(allData(root, "postureList").map(n => n.dataset.postureList)).toEqual(["200"]);
    expect(byData(root, "note", "truncated")!.textContent).toBe("Showing the newest 200 of 205 runs.");
    expect(kpiValue(root, "total")).toBe("205");
    expect(countOf(pillarOf(root, "qa"), "NOT_EXECUTED")!.textContent).toBe("Not executed: 205");
    expect(itemsOf(root)[0].dataset.postureItem).toBe(runs[204].runId);
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const run = SOURCE_RUN({status: "<b>x</b>"});
    const {root} = await renderView(serve({"/v1/work-runs": {runs: [run]}, "/v1/reviews": reviewsFor([run])}));
    // Geçersiz enum tümden ERROR olur: işaretleme hiçbir yerde yorumlanmaz ve içerik gösterilmez.
    expect(all(root).some(n => n.tagName === "IMG" || n.tagName === "B")).toBe(false);
    expect(itemsOf(root).length).toBe(0);
    const rv2: any = reviewsFor([SOURCE_RUN()], {});
    rv2.reviews = rv2.reviews.map((x: any) => ({...x, reviewer: {identity: "<img src=x onerror=alert(1)>"}}));
    const r2 = await renderView(serve({"/v1/work-runs": {runs: [SOURCE_RUN()]}, "/v1/reviews": rv2}));
    expect(all(r2.root).some(n => n.tagName === "IMG" || n.tagName === "B")).toBe(false);
    expect(itemsOf(r2.root).length).toBe(1);
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root} = await renderView(serve(), "tr");
    expect(byId(root, "view-title")!.textContent).toBe("Güvence Komuta Merkezi ve Güvenlik Duruşu");
    expect(kpiValue(root, "total")).toBe("3");
    expect(overallOf(root).dataset.overall).toBe("AT_RISK");
    expect(overallOf(root).textContent).toContain("Risk altında");
    expect(itemsOf(root).map(n => n.dataset.postureItem)).toEqual([RUN4, RUN2, RUN3]);
    expect(missingOf(root).length).toBe(4);
    expect(root.textContent).toContain("Neler eksik");
    expect(countOf(pillarOf(root, "qa"), "NOT_EXECUTED")!.textContent).toBe("Yürütülmedi: 3");
    expect(byData(root, "honesty", "1")!.textContent).toContain("asla sıfır, asla geçmiş sayılmaz");
    expect(byId(root, "posture-missing-t")!.textContent).toBe("Neler eksik");
    expect(serverCount(pillarOf(root, "review"), "BLOCKED")!.textContent).toBe("BLOCKED: 1"); // ham kod yerelleştirilmez
  });
  it("navigation buttons only navigate to existing screens and never POST or fabricate a decision", async () => {
    const posts: unknown[][] = [];
    const view = await load("views", "posture.js");
    const {ctx, nav, calls} = await mkCtx(serve(), "en", (p, b) => { posts.push([p, b]); return {status: 200, body: {}}; });
    const rootNode: N = await view.render(ctx);
    const buttons = all(rootNode).filter(n => n.tagName === "BUTTON");
    expect(buttons.map(b => b.dataset.navigate)).toEqual(["assurance", "readiness", "work"]);
    for (const b of buttons) click(b);
    expect(nav).toEqual(["assurance", "readiness", "work"]);
    expect(posts).toEqual([]);
    expect(calls.every(c => THREE.includes(c))).toBe(true);
    expect(buttons.every(b => b.getAttribute("type") === "button")).toBe(true);
    expect(buttons.map(b => b.textContent)).toEqual(["Open Assurance", "Open Quality Gate & Release Readiness", "Open Work"]);
    expect(all(rootNode).some(n => n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "FORM" || n.tagName === "SELECT")).toBe(false);
    const routes = await load("routes.js");
    for (const b of buttons) expect(routes.routeById(b.dataset.navigate!), b.dataset.navigate).toBeTruthy();
  });
});

// ---------------- (6) accessibility ----------------
describe("Posture — accessibility", () => {
  it("single labelled h1, exactly three labelled sections, a labelled KPI group, labelled pillar and run lists, a labelled missing list and machine-readable times", async () => {
    const {root} = await renderView(serve());
    const h1 = all(root).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    const ids3 = ["posture-summary", "posture-pillars", "posture-runs"];
    expect(all(root).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(ids3);
    for (const id of ids3) expect(byId(root, byId(root, id)!.getAttribute("aria-labelledby")!), id).toBeTruthy();
    const group = all(root).find(n => n.getAttribute("role") === "group" && cls(n, "posture-kpis"))!;
    expect(group.getAttribute("aria-label")).toBe("Assurance posture figures");
    const tiles = allData(group, "kpi");
    expect(tiles.length).toBe(5);
    for (const t of tiles) {
      expect(t.tagName).toBe("ARTICLE");
      expect(byId(root, t.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
      expect(all(t).some(n => "pill" in n.dataset)).toBe(true);
    }
    const ml = all(root).find(n => cls(n, "posture-missing"))!;
    expect(byId(root, ml.getAttribute("aria-labelledby")!)!.textContent).toBe("What is missing");
    const pl = all(root).find(n => cls(n, "posture-pillar-list"))!;
    expect(pl.tagName).toBe("UL"); expect(pl.getAttribute("aria-label")).toBe("Posture pillars");
    expect(pl.children.length).toBe(4); expect(pl.children.every(c => c.tagName === "LI")).toBe(true);
    for (const li of pillarCards(root)) {
      expect(all(li).filter(n => n.tagName === "H3").length).toBe(1);
      for (const ul of all(li).filter(n => n.tagName === "UL")) expect(ul.getAttribute("aria-label"), li.dataset.pillar).toBeTruthy();
    }
    const lists = all(root).filter(n => n.tagName === "OL");
    expect(lists.length).toBe(1);
    expect(lists[0].getAttribute("aria-label")).toBe("Work runs and their assurance state");
    expect(lists[0].children.every(c => c.tagName === "LI")).toBe(true);
    for (const li of itemsOf(root)) {
      expect(all(li).filter(n => n.tagName === "H3").length).toBe(1);
      for (const t of all(li).filter(n => n.tagName === "TIME")) { expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(t.textContent.length).toBeGreaterThan(3); }
    }
    for (const ul of all(root).filter(n => n.tagName === "UL" && cls(n, "company-sources"))) expect(ul.getAttribute("aria-label")).toBeTruthy();
    const bg = all(root).find(n => n.getAttribute("role") === "group" && cls(n, "btn-row"))!;
    expect(bg.getAttribute("aria-label")).toBe("Open related screens");
    for (const b of all(bg).filter(n => n.tagName === "BUTTON")) { expect(b.textContent.length).toBeGreaterThan(0); expect(b.id).toMatch(/^ps-open-[a-z]+$/); }
    // Kimlikler benzersiz.
    const ids = all(root).map(n => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("definition lists are well-formed (dt/dd pairs, seven per run) and every state pill carries text (state is never colour alone)", async () => {
    const {root} = await renderView(serve());
    const dls = all(root).filter(n => n.tagName === "DL");
    expect(dls.length).toBe(3);
    for (const dl of dls) {
      expect(dl.children.length).toBe(14);
      dl.children.forEach((c, i) => expect(c.tagName).toBe(i % 2 === 0 ? "DT" : "DD"));
    }
    for (const p of allData(root, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    for (const li of itemsOf(root)) expect(pills(li).length, li.dataset.postureItem).toBeGreaterThanOrEqual(4);
    for (const li of pillarCards(root)) expect(pills(li).length, li.dataset.pillar).toBe(1);
  });
  it("failure blocks are status regions (role=status) with text, not colour alone", async () => {
    const {root} = await renderView(() => { throw new Error("fetch failed"); });
    const blocks = allData(root, "postureState");
    expect(blocks.length).toBe(3);
    for (const b of blocks) { expect(b.getAttribute("role")).toBe("status"); expect(b.textContent).toContain("Offline"); expect(pills(b)).toContain("OFFLINE"); }
    expect(byData(root, "postureEmpty")!.getAttribute("role")).toBe("status");
    expect(byData(root, "posturePartial")!.getAttribute("role")).toBe("status");
    for (const w of allData(root, "withheld", "1")) expect(w.getAttribute("role")).toBe("status");
  });
  it("styles.css has container-query, forced-colors and focus coverage for the posture components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("Güvence Komuta Merkezi ve Güvenlik Duruşu: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.posture-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    // Anlam renkle taşınmaz: duruş rengi yalnız sol kenar vurgusudur; metin/rozet her kartta vardır.
    expect(mine).toMatch(/\.posture-pillar\[data-pillar-status="FAIL"\]\{border-left-color:var\(--danger\)\}/);
    expect(mine).toMatch(/\.posture-pillar\[data-pillar-status="OK"\]\{border-left-color:var\(--ok\)\}/);
    for (const v of mine.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(css, v).toContain(`${v.slice(4, -1)}:`);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (7) locale parity ----------------
describe("Posture — locale parity and key coverage", () => {
  it("every posture.* / area.posture.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("posture.") || k.startsWith("area.posture.")).sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(100);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.posture.title"]).toBe("Güvence Komuta Merkezi ve Güvenlik Duruşu");
    expect(en["area.posture.title"]).toBe("Assurance Command Center & Security Posture");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
    // Yalnız ASSURED açıklaması başarı dilini kullanabilir: diğer üç düzey açıklaması "assured/secure/pass" içermez.
    for (const t of ["AT_RISK", "UNVERIFIED", "UNKNOWN"]) for (const k of [`posture.tier.${t}`, `posture.tierDesc.${t}`]) expect(en[k], k).not.toMatch(/assured|secure|\bpass(ed)?\b/i);
  });
  it("every literal and enumerated key used by posture.js exists in both dictionaries, and no posture key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("posture-core.js");
    const src = read("views", "posture.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"((?:posture|area\.posture)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.POSTURE_SOURCES) { need.add(`posture.src.${k}`); need.add(`posture.srcShort.${k}`); }
    for (const k of core.UNKNOWN_DETAILS) { need.add(`posture.state.${k}`); need.add(`posture.hint.${k}`); need.add(`posture.reason.UNKNOWN.${k}`); }
    for (const k of ["total", "qa", "security", "review", "integrity"]) { need.add(`posture.kpi.${k}`); need.add(`posture.kpi.q.${k}`); }
    for (const p of core.PILLARS) { need.add(`posture.pillar.${p}`); need.add(`posture.pillarNote.${p}`); need.add(`posture.counts.aria.${p}`); need.add(`posture.reason.${p}.NO_RECORDS`); for (const c of core.REASONS[p]) need.add(`posture.reason.${p}.${c}`); }
    for (const s of core.PILLAR_STATUSES) need.add(`posture.pstatus.${s}`);
    for (const t of core.TIERS) { need.add(`posture.tier.${t}`); need.add(`posture.tierDesc.${t}`); }
    for (const s of ["workRuns", "reviews", "evidence"]) need.add(`posture.basis.${s}`);
    for (const k of core.QA_STATES) need.add(`posture.val.qa.${k}`);
    for (const k of core.SECURITY_STATES) need.add(`posture.val.security.${k}`);
    for (const k of core.REVIEW_DETAILS) need.add(`posture.val.review.${k}`);
    for (const k of ["verified", "mismatch", "missing", "unverifiable"]) need.add(`posture.val.integrity.${k}`);
    for (const k of ["VERIFIED", "STALE"]) need.add(`posture.blockState.${k}`);
    need.add("area.posture.title"); need.add("area.posture.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(100);
    // Sözlükte ölü anahtar kalmaz: her posture.* anahtarı görünümde/çekirdekte kullanılır.
    expect(Object.keys(en).filter(k => (k.startsWith("posture.") || k.startsWith("area.posture.")) && !need.has(k))).toEqual([]);
    // Core sabitleri sunucu sözleşmesiyle uyumlu.
    expect(core.UNKNOWN_DETAILS).toEqual(["OFFLINE", "UNAVAILABLE", "ERROR"]);
    expect(core.REVIEW_DETAILS).toEqual(expect.arrayContaining(core.REVIEW_STATES));
    expect(core.TIERS).toEqual(["ASSURED", "AT_RISK", "UNVERIFIED", "UNKNOWN"]);
    expect(core.PILLARS).toEqual(["qa", "security", "review", "integrity"]);
  });
});

// ---------------- (8) routing ----------------
describe("Posture — route delegation (app.js VIEWS unchanged, #/assurance untouched)", () => {
  it("routes.js maps #/posture to the planned host with component 'posture' (no plannedPackage), after readiness and before settings, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("posture");
    expect(r).toMatchObject({id: "posture", hash: "#/posture", view: "planned", component: "posture", factory: false, icon: "shield"});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/posture")).toBe("posture");
    expect(routes.routeFromHash("#/posture/")).toBe("posture");
    expect(routes.routeFromHash("#/postures")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/Posture")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-15)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "install", "audit", "domains", "integrations", "scheduler", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("posture");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    // Eski rotalar etkilenmez; #/assurance kendi görünümüdür (tek sahiplik).
    for (const id of ["readiness", "queue", "executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
    expect(routes.routeById("assurance")).toMatchObject({id: "assurance", hash: "#/assurance", view: "assurance", factory: true});
    expect(routes.routeById("assurance").component).toBeUndefined();
  });
  it("planned.js delegates the 'posture' component to the real view; app.js VIEWS table has no posture entry and is untouched; the assurance view is not touched", async () => {
    expect(read("views", "planned.js")).toContain('import * as posture from "./posture.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*posture[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("posture.js");
    expect(app).not.toMatch(/\bposture\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    // Mevcut #/assurance görünümü kendi (yerel) duruş panelini taşır; yeni modüllere HİÇBİR bağı yoktur (tek sahiplik, değişmedi).
    expect(read("views", "assurance.js")).not.toMatch(/posture-core|posture\.js|views\/posture|commandCenterWorkRuns|commandCenterReviews|commandCenterEvidence/);
    expect(read("assurance-core.js")).not.toMatch(/posture-core|posture\.js|commandCenterWorkRuns|commandCenterReviews|commandCenterEvidence/);
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const rootNode: N = await planned.render(ctx, {id: "posture", component: "posture"});
    expect(cls(rootNode, "view-posture")).toBe(true);
    expect(byId(rootNode, "view-title")!.textContent).toBe("Assurance Command Center & Security Posture");
    // Mevcut devredilen rotalar etkilenmez.
    const e = await planned.render((await mkCtx(serve({"/v1/cockpit": {nonsense: 1}}))).ctx, {id: "executive", component: "executive"});
    expect(cls(e, "view-executive")).toBe(true);
    const rd = await planned.render((await mkCtx(serve())).ctx, {id: "readiness", component: "readiness"});
    expect(cls(rd, "view-readiness")).toBe(true);
    const q = await planned.render((await mkCtx(serve())).ctx, {id: "queue", component: "queue"});
    expect(cls(q, "view-queue")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.posture.title")).toBe("Güvence Komuta Merkezi ve Güvenlik Duruşu");
    expect(i18n.translate("en", "area.posture.desc")).toContain("Read-only.");
  });
});
// //TR: UI-BUILD-SCHEDULER Derleme Zamanlayıcı (#/scheduler) — faz bazlı zamanlayıcı ilerlemesinin salt-okunur görünümü; fixture'lar GERÇEK roadmap/scheduler-state.template.json biçiminden türetilir (sunucu doğrulanmış durumu `verification:"VERIFIED"` ile döndürür). Sunucu VERIFIED demedikçe faz/ilerleme uydurulmaz; COMPLETED ürün doğrulaması ya da teslim değildir.
const SCHED_TPL: any = JSON.parse(fs.readFileSync(path.join(root, "roadmap", "scheduler-state.template.json"), "utf8"));
const SHA = "a".repeat(40);
const schedPhase = (n: number, over: Record<string, any> = {}) => ({phase: n, status: "PENDING", attempts: 0, lastRunId: null, completedCommit: null, evidenceRefs: [], ...over});
const SCHED_OK: any = {schemaVersion: SCHED_TPL.schemaVersion, verification: "VERIFIED", updatedAt: "2026-10-18T10:00:00.000Z", active: [2], blocked: [{phase: 3, reason: "x", kind: "FOUNDER_ATTENTION", at: "2026-10-18T10:00:00.000Z"}],
  phases: [schedPhase(3, {status: "BLOCKED", attempts: 2, lastFailure: "needs founder"}), schedPhase(1, {status: "COMPLETED", attempts: 1, lastRunId: "RUN-1", completedCommit: SHA, evidenceRefs: ["evd_abc"]}), schedPhase(2, {status: "ACTIVE", attempts: 1, lastRunId: "RUN-2"})]};
const schedServe = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/scheduler": SCHED_OK, ...over};
  if (!(p in m)) throw new Error(`${p}: HTTP 404`);
  if (m[p] instanceof Error) throw m[p];
  return m[p];
};
const schedBoom = (msg: string) => new Error(msg);
async function renderSched(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "scheduler.js");
  const posts: string[] = [];
  const m = await mkCtx(getFn, lang, (p: string) => { posts.push(p); throw new Error("POST must never be called"); });
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, posts, ...m};
}
const schedRows = (r: N) => allData(r, "schedPhase").filter(n => n.tagName === "LI");
const schedCount = (r: N, k: string) => all(allData(r, "schedCount", k)[0]).find(n => cls(n, "kpi-value"))!.textContent;
const schedLines = (r: N) => all(r).map(n => n._text).filter(Boolean).join("\n");

describe("Build Scheduler — route, reachability and allow-list", () => {
  it("routes.js maps #/scheduler to the planned host (component 'scheduler', no plannedPackage), with an existing icon; app.js is untouched", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js"), i18n = await load("i18n.js");
    const r = routes.routeById("scheduler");
    expect(r).toMatchObject({id: "scheduler", hash: "#/scheduler", view: "planned", component: "scheduler", factory: false});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/scheduler")).toBe("scheduler");
    expect(routes.routeFromHash("#/schedulerx")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("scheduler");
    expect(read("views", "planned.js")).toContain('import * as scheduler from "./scheduler.js"');
    expect(read("app.js")).not.toMatch(/scheduler/);
    for (const lang of ["en", "tr"]) expect(i18n.translate(lang, "area.scheduler.title")).not.toBe("area.scheduler.title");
  });
  it("GET /v1/scheduler is already admitted by the desktop allow-list; nothing else under that name is", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    const core = await load("scheduler-core.js");
    expect(allowed("/v1/scheduler")).toBe(true);
    expect(core.SCHEDULER_PATH).toBe("/v1/scheduler");
    for (const p of ["/v1/scheduler?x=1", "/v1/scheduler/run", "/v1/scheduler/retry", "/v1/schedulers"]) expect(allowed(p), p).toBe(false);
  });
});

describe("Build Scheduler — strict mapping", () => {
  it("maps a VERIFIED state (phase order, tally, counts, verbatim values)", async () => {
    const core = await load("scheduler-core.js");
    const m = core.mapScheduler(SCHED_OK);
    expect(m.state).toBe("VERIFIED");
    expect(m.scheduler.phases.map((p: any) => p.phase)).toEqual([1, 2, 3]);
    expect(m.scheduler).toMatchObject({total: 3, completed: 1, activeCount: 1, blockedCount: 1});
    expect(m.scheduler.phases[0]).toMatchObject({status: "COMPLETED", completedCommit: SHA, lastRunId: "RUN-1", evidenceRefs: ["evd_abc"]});
  });
  it("accepts the real supervisor formats: .ai/runtime attestation refs and the PHASE0_INSTALL_BASELINE commit marker", async () => {
    const core = await load("scheduler-core.js");
    const ok = (over: Record<string, any> = {}) => ({...SCHED_OK, ...over});
    const refs = [".ai/runtime/evidence-ledger/packages/PKG-001/" + SHA + ".json", ".ai/runtime/evidence-ledger/packages/PKG-001/" + SHA + "-review-bundle.json", ".ai/runtime/runs/RUN-2026-10-18T10-00-00-000Z-1a2b3c4d/events.jsonl", ".ai/runtime/runs/RUN-1/evidence/PKG-001-review-attestation.json"];
    const m = core.mapScheduler(ok({phases: [schedPhase(0, {status: "COMPLETED", completedCommit: "PHASE0_INSTALL_BASELINE"}), schedPhase(1, {status: "COMPLETED", completedCommit: SHA, evidenceRefs: refs})]}));
    expect(m.state).toBe("VERIFIED");
    expect(m.scheduler.phases.map((p: any) => p.completedCommit)).toEqual(["PHASE0_INSTALL_BASELINE", SHA]);
    expect(m.scheduler.phases[1].evidenceRefs).toEqual(refs);
  });
  it("still rejects traversal, absolute, backslash, drive and unknown-marker values", async () => {
    const core = await load("scheduler-core.js");
    const ok = (over: Record<string, any> = {}) => ({...SCHED_OK, ...over});
    for (const ref of ["../.ai/runtime/x.json", ".ai/../../etc/passwd", ".ai/runtime/../x", "/.ai/runtime/x.json", "/etc/passwd", "C:/x/y.json", ".ai\\runtime\\x.json", "./.ai/x", ".ai//x", ".ai/runtime/", "..", ".", ".ai/runtime/x y", "a".repeat(161)])
      expect(core.mapScheduler(ok({phases: [schedPhase(1, {evidenceRefs: [ref]})]})).state, ref).toBe("ERROR");
    for (const c of ["phase0_install_baseline", "PHASE0_INSTALL_BASELINE2", "PHASE0 INSTALL", "../PHASE0_INSTALL_BASELINE"])
      expect(core.mapScheduler(ok({phases: [schedPhase(1, {completedCommit: c})]})).state, c).toBe("ERROR");
  });
  it("PENDING / REJECTED server verification never yields phases or counts (null, not 0)", async () => {
    const core = await load("scheduler-core.js");
    const p = core.buildScheduler(core.mapScheduler({status: "NOT_INITIALIZED", verification: "PENDING"}));
    expect(p).toMatchObject({state: "PENDING", scheduler: null, total: null, completed: null, activeCount: null, blockedCount: null, pendingStatus: "NOT_INITIALIZED"});
    const r = core.buildScheduler(core.mapScheduler({status: "INVALID", verification: "REJECTED", error: "SCHEDULER_STATE_INVALID"}));
    expect(r).toMatchObject({state: "REJECTED", scheduler: null, total: null});
  });
  it("rejects malformed / contradictory / unverified-but-claimed-verified responses wholesale", async () => {
    const core = await load("scheduler-core.js");
    const ok = (over: Record<string, any> = {}) => ({...SCHED_OK, ...over});
    const bads: Array<[string, any]> = [
      ["null", null], ["arr", []], ["noverif", {phases: []}], ["weird", ok({verification: "MAYBE"})], ["nophases", ok({phases: "x"})],
      ["dup", ok({phases: [schedPhase(1), schedPhase(1)]})], ["negphase", ok({phases: [schedPhase(-1)]})], ["lowerstatus", ok({phases: [schedPhase(1, {status: "completed"})]})],
      ["attempts", ok({phases: [schedPhase(1, {attempts: -1})]})], ["sha", ok({phases: [schedPhase(1, {completedCommit: "../x"})]})], ["run", ok({phases: [schedPhase(1, {lastRunId: "a b"})]})],
      ["refs", ok({phases: [schedPhase(1, {evidenceRefs: ["../../etc/passwd "]})]})], ["retryAt", ok({phases: [schedPhase(1, {retryAt: "tomorrow"})]})],
      ["active", ok({active: "x"})], ["upd", ok({updatedAt: "yesterday"})], ["cap", ok({phases: Array.from({length: 2001}, (_, i) => schedPhase(i))})]
    ];
    for (const [label, raw] of bads) { const m = core.mapScheduler(raw); expect(m.state, label).toBe("ERROR"); expect(m.scheduler, label).toBeNull(); }
  });
});

describe("Build Scheduler — mapping limits (boundaries)", () => {
  const ph = (i: number, over: Record<string, any> = {}) => ({phase: i, status: "PENDING", attempts: 0, ...over});
  const resp = (phases: any[], over: Record<string, any> = {}) => ({verification: "VERIFIED", schemaVersion: "1", updatedAt: "2026-10-18T10:00:00Z", phases, active: [], blocked: [], ...over});
  const one = async (over: Record<string, any>, top: Record<string, any> = {}) => (await load("scheduler-core.js")).mapScheduler(resp([ph(1, over)], top));
  it("accepts exactly MAX_PHASES phases and rejects one more", async () => {
    const core = await load("scheduler-core.js");
    expect(core.mapScheduler(resp(Array.from({length: core.MAX_PHASES}, (_, i) => ph(i)))).state).toBe("VERIFIED");
    expect(core.mapScheduler(resp(Array.from({length: core.MAX_PHASES + 1}, (_, i) => ph(i)))).state).toBe("ERROR");
  });
  it("phase status must be a real string; attempts and phase number may be 0 but not negative", async () => {
    expect((await one({status: ["ACTIVE"]})).state).toBe("ERROR");
    expect((await one({phase: 0, attempts: 0})).state).toBe("VERIFIED");
    expect((await one({attempts: -1})).state).toBe("ERROR");
  });
  it("evidence refs: at most 50, each at most 160 characters, a non-array is rejected, null means none", async () => {
    expect((await one({evidenceRefs: Array.from({length: 50}, (_, i) => `evd_${i}`)})).state).toBe("VERIFIED");
    expect((await one({evidenceRefs: Array.from({length: 51}, (_, i) => `evd_${i}`)})).state).toBe("ERROR");
    expect((await one({evidenceRefs: "evd_1"})).state).toBe("ERROR");
    expect((await one({evidenceRefs: ["a".repeat(160)]})).state).toBe("VERIFIED");
    expect((await one({evidenceRefs: ["a".repeat(161)]})).state).toBe("ERROR");
    const nul = await one({evidenceRefs: null});
    expect(nul.scheduler.phases[0].evidenceRefs).toEqual([]);
  });
  it("run id and commit must be real strings (a one-element array is not coerced)", async () => {
    expect((await one({lastRunId: ["run1"]})).state).toBe("ERROR");
    expect((await one({completedCommit: ["abcdef0"]})).state).toBe("ERROR");
    expect((await one({lastRunId: "run1", completedCommit: "abcdef0"})).state).toBe("VERIFIED");
  });
  it("lastFailure is cut at 300 characters, a short one is kept, an empty one is null", async () => {
    expect((await one({lastFailure: "f".repeat(301)})).scheduler.phases[0].lastFailure).toHaveLength(300);
    expect((await one({lastFailure: "f".repeat(300)})).scheduler.phases[0].lastFailure).toHaveLength(300);
    expect((await one({lastFailure: "x"})).scheduler.phases[0].lastFailure).toBe("x");
    expect((await one({lastFailure: ""})).scheduler.phases[0].lastFailure).toBeNull();
  });
  it("schemaVersion up to 20 characters is kept, longer is null", async () => {
    expect((await one({}, {schemaVersion: "v".repeat(20)})).scheduler.schemaVersion).toHaveLength(20);
    expect((await one({}, {schemaVersion: "v".repeat(21)})).scheduler.schemaVersion).toBeNull();
  });
  it("retryAt and updatedAt: null or absent is unknown, a malformed value rejects the whole read", async () => {
    expect((await one({retryAt: null})).scheduler.phases[0].retryAt).toBeNull();
    expect((await one({retryAt: "2026-10-18T10:00:00Z"})).scheduler.phases[0].retryAt).toBe("2026-10-18T10:00:00Z");
    expect((await one({retryAt: "soon"})).state).toBe("ERROR");
    expect((await one({}, {updatedAt: null})).scheduler.updatedAt).toBeNull();
    expect((await one({}, {updatedAt: "yesterday"})).state).toBe("ERROR");
  });
  it("active and blocked: absent counts as 0, a non-array is rejected, lengths are counted", async () => {
    expect((await one({}, {active: undefined, blocked: undefined})).scheduler).toMatchObject({activeCount: 0, blockedCount: 0});
    expect((await one({}, {active: "x"})).state).toBe("ERROR");
    expect((await one({}, {blocked: {}})).state).toBe("ERROR");
    expect((await one({}, {active: [1, 2], blocked: [3]})).scheduler).toMatchObject({activeCount: 2, blockedCount: 1});
  });
  it("status tally sorts by count descending then by name", async () => {
    const core = await load("scheduler-core.js");
    const r = core.mapScheduler(resp([ph(1, {status: "PENDING"}), ph(2, {status: "ACTIVE"}), ph(3, {status: "BLOCKED"}), ph(4, {status: "BLOCKED"}), ph(5, {status: "COMPLETED"})]));
    expect(r.scheduler.byStatus).toEqual([{value: "BLOCKED", count: 2}, {value: "ACTIVE", count: 1}, {value: "COMPLETED", count: 1}, {value: "PENDING", count: 1}]);
  });
  it("PENDING keeps only a well-formed status; failed reads keep OFFLINE and UNAVAILABLE", async () => {
    const core = await load("scheduler-core.js");
    expect(core.mapScheduler({verification: "PENDING", status: "NOT_INITIALIZED"}).scheduler.status).toBe("NOT_INITIALIZED");
    expect(core.mapScheduler({verification: "PENDING", status: "not valid"}).scheduler.status).toBeNull();
    for (const [i, o] of [["OFFLINE", "OFFLINE"], ["UNAVAILABLE", "UNAVAILABLE"], ["ERROR", "ERROR"], ["X", "ERROR"]]) {
      const r = core.buildScheduler({state: i, scheduler: null});
      expect([r.state, r.total]).toEqual([o, null]);
    }
  });
});

describe("Build Scheduler — rendering (read-only, honest states, accessibility)", () => {
  it("renders every phase with verbatim values, exact counts, no controls, no writes, exactly one GET, no product-verified claim", async () => {
    const {root, posts, calls} = await renderSched(schedServe());
    expect(cls(root, "view-scheduler")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Build Scheduler");
    expect(schedRows(root).map(n => n.dataset.schedPhase)).toEqual(["1", "2", "3"]);
    expect(schedRows(root).map(n => n.dataset.status)).toEqual(["COMPLETED", "ACTIVE", "BLOCKED"]);
    expect(schedCount(root, "total")).toBe("3");
    expect(schedCount(root, "completed")).toBe("1");
    expect(schedCount(root, "active")).toBe("1");
    expect(schedCount(root, "blocked")).toBe("1");
    expect(schedLines(schedRows(root)[0])).toContain(SHA);
    expect(schedLines(schedRows(root)[2])).toContain("needs founder");
    expect(all(root).filter(n => ["BUTTON", "A", "INPUT", "SELECT", "FORM"].includes(n.tagName)).length).toBe(0);
    expect(all(root).some(n => n.ls.size > 0)).toBe(false);
    expect(posts).toEqual([]);
    expect([...calls]).toEqual(["/v1/scheduler"]);
    expect(surface(root)).not.toContain(FORBIDDEN);
    for (const li of schedRows(root)) expect(schedLines(li)).not.toMatch(/\b(verified|delivered|shipped|certified|healthy|ready)\b/i);
  });
  it("accessibility: a single focusable h1, a labelled phase list, a labelled counts group, and status roles on state blocks", async () => {
    const {root} = await renderSched(schedServe());
    const h1s = all(root).filter(n => n.tagName === "H1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].attrs.get("tabindex")).toBe("-1");
    expect(all(root).find(n => n.tagName === "UL" && n.attrs.get("aria-label") === "Scheduler phases")).toBeTruthy();
    expect(all(root).find(n => n.attrs.get("role") === "group" && n.attrs.get("aria-label") === "Scheduler phase counts")).toBeTruthy();
    const down = await renderSched(schedServe({"/v1/scheduler": schedBoom("fetch failed")}));
    expect(byData(down.root, "schedState")!.attrs.get("role")).toBe("status");
    expect(byData(down.root, "schedWithheld")!.attrs.get("role")).toBe("status");
  });
  it("NOT_INITIALIZED (PENDING) and REJECTED states show no phases and dash counts, and say so honestly", async () => {
    for (const [body, st] of [[{status: "NOT_INITIALIZED", verification: "PENDING"}, "PENDING"], [{status: "INVALID", verification: "REJECTED", error: "SCHEDULER_STATE_INVALID"}, "REJECTED"]] as const) {
      const {root} = await renderSched(schedServe({"/v1/scheduler": body}));
      expect(schedRows(root).length).toBe(0);
      for (const k of ["total", "completed", "active", "blocked"]) expect(schedCount(root, k)).toBe("—");
      expect(byData(root, "schedState", st)).toBeTruthy();
      expect(byData(root, "schedWithheld")).toBeTruthy();
      expect(byData(root, "schedEmpty")).toBeUndefined();
    }
  });
  it("a read failure shows an honest state and dash counts (never 0, never an empty list)", async () => {
    for (const err of [schedBoom("fetch failed"), schedBoom("HTTP 404"), schedBoom("HTTP 500")]) {
      const {root} = await renderSched(schedServe({"/v1/scheduler": err}));
      expect(schedCount(root, "total")).toBe("—");
      expect(schedRows(root).length).toBe(0);
      expect(byData(root, "schedWithheld")).toBeTruthy();
      expect(byData(root, "schedEmpty")).toBeUndefined();
    }
  });
  it("a malformed response claiming VERIFIED is rejected whole (no partial phases)", async () => {
    const {root} = await renderSched(schedServe({"/v1/scheduler": {...SCHED_OK, phases: [schedPhase(1), schedPhase(1)]}}));
    expect(schedRows(root).length).toBe(0);
    expect(schedCount(root, "total")).toBe("—");
    expect(byData(root, "schedState", "ERROR")).toBeTruthy();
  });
  it("a verified state with zero phases says only that, and its totals are a real 0", async () => {
    const {root} = await renderSched(schedServe({"/v1/scheduler": {...SCHED_OK, phases: [], active: [], blocked: []}}));
    expect(schedCount(root, "total")).toBe("0");
    expect(byData(root, "schedEmpty")!.textContent).toBe("The verified scheduler state contains no phases.");
  });
  it("server text (lastFailure) is written as text only", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const {root} = await renderSched(schedServe({"/v1/scheduler": {...SCHED_OK, phases: [schedPhase(1, {status: "BLOCKED", lastFailure: evil})], active: [], blocked: []}}));
    expect(all(schedRows(root)[0]).some(n => n.textContent.includes(evil))).toBe(true);
    expect(all(schedRows(root)[0]).every(n => n.tagName !== "IMG")).toBe(true);
  });
  it("EN and TR render without raw i18n keys; scheduler.* locale keys have exact EN/TR key and placeholder parity", async () => {
    for (const lang of ["en", "tr"]) for (const over of [{}, {"/v1/scheduler": schedBoom("fetch failed")}, {"/v1/scheduler": {status: "NOT_INITIALIZED", verification: "PENDING"}}, {"/v1/scheduler": {verification: "REJECTED"}}, {"/v1/scheduler": {verification: "VERIFIED", phases: "x"}}]) {
      const {root} = await renderSched(schedServe(over), lang);
      expect(surface(root), lang).not.toMatch(/\b(scheduler|area)\.[a-z][A-Za-z.]*\b/);
    }
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = (o: Record<string, string>) => Object.keys(o).filter(k => k.startsWith("scheduler.") || k === "area.scheduler.title" || k === "area.scheduler.desc").sort();
    expect(keys(en).length).toBeGreaterThan(35);
    expect(keys(tr)).toEqual(keys(en));
    const ph = (s: string) => (s.match(/\{[A-Za-z]+\}/g) ?? []).sort().join(",");
    for (const k of keys(en)) { expect(tr[k].length, k).toBeGreaterThan(0); expect(ph(tr[k]), k).toBe(ph(en[k])); }
  });
});

