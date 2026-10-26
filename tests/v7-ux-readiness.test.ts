// //TR: Bu test FA-V2-PRODUCT UI-227 "Kalite Kapısı ve Release Readiness" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek tohumlanmış Work OS verisinden (koşu, kanıt, bağımsız inceleme kararları, gerçek git + kaynak teslimi hazırlama/kabulü) dönen GET /v1/work-runs + /v1/reviews + /v1/cockpit + /v1/missions gövdeleri saf eşleyicilerden (readiness-core.js) ve görünümden (views/readiness.js) geçer. (2) İZİN LİSTESİ — dört GET zaten izinlidir (main.mjs/server.ts/app.js/control-boundary.mjs DEĞİŞMEZ, EXTRA_GET_ROUTES büyümez, yeni uç nokta yok), görünüm yalnız bu dört GET'i okur, hiçbir yazma/köprü çağrısı yapmaz. (3) SAF EŞLEYİCİLER — bozuk kimlik/enum/biçim/sayı/çelişki fail-closed ERROR olur (kısmi görünüm yok), inceleme kararı AYNEN taşınır. (4) HAZIRLIK DÜRÜSTLÜĞÜ — READY yalnız yedi kapının HEPSİ sağlandığında; her kapı tek tek bozulduğunda READY olmaz; okunamayan kaynak UNKNOWN'dır, geçmiş sayılmaz. (5) GÖRÜNÜM DÜRÜSTLÜĞÜ — kaynak başına OFFLINE/UNAVAILABLE/ERROR, teslim yalnız kaynak düzeyi (NOT_VERIFIED), ürün doğrulandı sabiti ASLA. (6) ERİŞİLEBİLİRLİK, (7) YEREL AYNALIK (TR/EN birebir) ve (8) ROTA (planned.js devri, app.js VIEWS değişmez).
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

// ---------------- fake DOM (executive/queue testleri ile aynı desen) ----------------
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
// Düğüm metinlerini satırla ayırır (bitişik düğümlerin sonu/başı yanlışlıkla bir anahtar gibi eşleşmesin).
const lines = (r: N) => all(r).map(n => n._text).filter(Boolean).join("\n");
const pills = (r: N) => allData(r, "pill").map(n => n.dataset.pill);
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `readiness-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const itemsOf = (r: N) => allData(r, "readinessItem").filter(n => n.tagName === "LI");
const itemFor = (r: N, runId: string) => itemsOf(r).find(n => n.dataset.readinessItem === runId)!;
const field = (li: N, key: string) => allData(li, "field").find(n => n.dataset.field === key);
const missingGates = (li: N) => allData(li, "gate").filter(n => n.tagName === "LI").map(n => n.dataset.gate);
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
  const view = await load("views", "readiness.js");
  const m = await mkCtx(getFn, lang);
  const root: N = await view.render(m.ctx);
  return {root, ...m};
}

// ---------------- fixtures (sözleşme biçiminde) ----------------
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
const artifact = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, sourceCommit: HEAD, treeSha: sha("d"), exportArtifactHash: "f".repeat(64), artifactPath: `deliveries/${runId}/x.zip`, ...over});
const accepted = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, sourceCommit: HEAD, exportArtifactHash: "f".repeat(64), acknowledgements: {notExecuted: {acknowledgeNotExecuted: true}}, acceptedAt: "2026-10-16T03:30:00.000Z", ...over});
const completion = (over: Record<string, any> = {}) => ({headSha: HEAD, reportEvidenceId: "e1", reviewEvidenceId: "e2", securityEvidenceId: "e3", productVerification: {state: FORBIDDEN, verifyEvidenceId: "e4", regressionEvidenceId: "e5", testSurfaceEvidenceId: "e6"}, ...over});
const runRow = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, projectId: PRJ, tenantId: "tA", roleId: null, executor: {implementer: "IMPL-1", reviewer: "REV-1"}, leaseId: null, leaseExpiresAt: null, attempt: 1, status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 1, retryCount: 0,
  baseSha: BASE, headSha: HEAD, workBranch: "b", checkpoints: [], evidence: FULL_EV(), createdAt: T0, createdBy: "x", updatedAt: "2026-10-16T03:00:00.000Z", ...over});
/** Yedi kapının hepsinin gerçekten sağlandığı koşu (yalnız sentetik uç durum: sunucu tamamlanma kaydı + testler tanıklı sandbox'ta yürütüldü). */
const READY_RUN = (runId = RUN1, missionId = MSN1, over: Record<string, any> = {}) => runRow(runId, missionId, {status: "SUCCEEDED", deliveryArtifact: artifact(runId, missionId), completion: completion(), updatedAt: "2026-10-16T07:00:00.000Z", ...over});
// Kaynak düzeyi: inceleme CLEAN + güvenlik PASSED + teslim paketi hazır, ama testler çalıştırılmadı (sandbox yok) ve tamamlanma kaydı yok.
const SOURCE_RUN = (over: Record<string, any> = {}) => runRow(RUN2, MSN2, {evidence: [IMPL(), ...NOT_EXEC(), SEC("PASSED"), REVIEW_EV(), REPORT()], deliveryArtifact: artifact(RUN2, MSN2), updatedAt: "2026-10-16T05:00:00.000Z", ...over});
const BLOCKED_RUN = (over: Record<string, any> = {}) => runRow(RUN3, MSN3, {status: "FAILED", step: "REVIEW", reason: "REVIEW_BLOCKED", headSha: HEAD3, evidence: [IMPL({commitSha: HEAD3}), REVIEW_EV("BLOCKED", {commitSha: HEAD3})], updatedAt: "2026-10-16T04:00:00.000Z", ...over});
const NEW_RUN = (over: Record<string, any> = {}) => runRow(RUN4, MSN4, {status: "RUNNING", step: "IMPLEMENT", remediationCycle: 0, headSha: null, evidence: [], createdAt: "2026-10-16T05:30:00.000Z", updatedAt: "2026-10-16T06:00:00.000Z", ...over});
const RUNS = {runs: [SOURCE_RUN(), BLOCKED_RUN(), NEW_RUN()]};
const missionRow = (missionId: string, title: string, over: Record<string, any> = {}) => ({missionId, projectId: PRJ, tenantId: "tA", title, objective: "o", acceptanceCriteria: ["ac"], status: "EXECUTING", riskLevel: "R1", createdAt: "2026-10-15T01:00:00.000Z", createdBy: "x", traceId: "trc_" + "aa".repeat(12), ...over});
const MISSIONS = {missions: [missionRow(MSN1, "Alpha mission"), missionRow(MSN2, "Beta mission"), missionRow(MSN3, "Gamma mission"), missionRow(MSN4, "Delta mission")]};
// ---- /v1/reviews: koşunun kayıtlarından tutarlı özet üretir (sunucu sözleşmesi) ----
const REVIEW_ID = (runId: string) => "evd_" + runId.slice(4);
const countBy = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ({...m, [x]: (m[x] ?? 0) + 1}), {});
const reviewRecord = (runId: string, missionId: string, over: Record<string, any> = {}) => ({reviewId: REVIEW_ID(runId), runId, missionId, projectId: PRJ, cycle: 1, step: "REVIEW", reviewer: {identity: "REV-1"}, implementer: {identity: "IMPL-1"}, independent: true, reviewedCommit: HEAD, reviewedRange: {baseSha: BASE, headSha: HEAD}, currentHead: true,
  verdict: "CLEAN", startedAt: T0, timestamp: "2026-10-16T02:30:00.000Z", evidence: {recordedVerdict: "CLEAN", invalidated: null, findingsCount: 0, findings: null, exitCode: 0, timedOut: false, logSha256: null, note: null}, ...over});
/** Koşu için (özet, kayıt) çifti: durum -> sunucunun üreteceği tutarlı biçim. */
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
  const m: Record<string, any> = {"/v1/work-runs": RUNS, "/v1/reviews": REVIEWS, "/v1/cockpit": cockpitBody(), "/v1/missions": MISSIONS, ...over};
  if (!(p in m)) return fail(p);
  const v = m[p];
  return typeof v === "function" ? v(p) : v; // işlev geçersiz kılma: okuma hatası (throw) benzetimi
};
const FOUR = ["/v1/cockpit", "/v1/missions", "/v1/reviews", "/v1/work-runs"];
/** Dört okumayı gerçek eşleyicilerden geçirip hazırlık değerlendirmesini üretir (kapı matrisi için). */
async function assess(runs: any[], o: {reviews?: any; cockpit?: any; missions?: any} = {}) {
  const core = await load("readiness-core.js");
  const res = {workRuns: core.mapReadinessWorkRuns({runs}), reviews: core.mapReadinessReviews(o.reviews ?? reviewsFor(runs)), evidence: core.mapReadinessEvidence(o.cockpit ?? cockpitBody()), missions: o.missions ?? (await load("queue-core.js")).mapQueueMissions(MISSIONS)};
  return {core, res, out: core.buildReadiness(res)};
}

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-readiness-")); });
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
  const p = store.createProject({tenantId, orgId: "org1", name: "Readiness", environmentId: "env-dev", createdBy: RECORDER});
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

describe("Readiness — GENUINE control-api read-models flow through mappers, gate derivation and view", () => {
  // //TR: Gercek disk G/C'li bu test Windows CI'da varsayilan 5 sn vitest sinirini asabiliyor (iddia degil yalniz sure); kardes gercek-G/C testleriyle ayni acik sure butcesi verilir.
  it("real seeded Work OS data: the independent review verdict is carried verbatim, no run is READY, and the stale/unproven cases are not called clean", { timeout: T }, async () => {
    const seeded = await seedRealStore();
    const app = mkApp();
    const core = await load("readiness-core.js"), queue = await load("queue-core.js");
    const raw = {runs: await getJson(app, "/v1/work-runs"), reviews: await getJson(app, "/v1/reviews"), cockpit: await getJson(app, "/v1/cockpit"), missions: await getJson(app, "/v1/missions")};
    const res = {workRuns: core.mapReadinessWorkRuns(raw.runs), reviews: core.mapReadinessReviews(raw.reviews), evidence: core.mapReadinessEvidence(raw.cockpit), missions: queue.mapQueueMissions(raw.missions)};
    for (const r of Object.values(res) as any[]) expect(r.state).toBe("VERIFIED");
    const states = Object.fromEntries(res.reviews.reviews.runs.map((r: any) => [r.runId, r.reviewState]));
    expect(states).toEqual({[seeded.A]: "CLEAN", [seeded.B]: "NOT_REVIEWED", [seeded.C]: "BLOCKED", [seeded.D]: "INDEPENDENCE_UNVERIFIED", [seeded.E]: "NOT_REVIEWED"});
    // Kayıtlı ham karar AYNEN eşleyiciden geçer: A'nın iki kaydı (BLOCKED sonra CLEAN) listededir.
    expect(res.reviews.reviews.records.filter((r: any) => r.runId === seeded.A).map((r: any) => r.verdict).sort()).toEqual(["BLOCKED", "CLEAN"]);
    const a = core.buildReadiness(res);
    expect(a.complete).toBe(true);
    const by = Object.fromEntries(a.rows.map((r: any) => [r.runId, r]));
    expect(by[seeded.A].gateById.review).toMatchObject({status: "PASS", detail: "CLEAN"});
    expect(by[seeded.B].gateById.review).toMatchObject({status: "PENDING", detail: "NOT_REVIEWED"});
    expect(by[seeded.C].gateById.review).toMatchObject({status: "FAIL", detail: "BLOCKED"});
    expect(by[seeded.D].gateById.review).toMatchObject({status: "PENDING", detail: "INDEPENDENCE_UNVERIFIED"});
    expect(by[seeded.E].gateById.review).toMatchObject({status: "PENDING", detail: "NOT_REVIEWED"});
    expect(by[seeded.C].tier).toBe("BLOCKED");
    // Gerçekte hiçbir koşu READY değildir: güvenlik/test/tamamlanma kanıtı yok; CLEAN bir inceleme tek başına hazırlık değildir.
    expect(a.rows.map((r: any) => r.tier).filter((t: string) => t === "READY" || t === "SOURCE_ONLY")).toEqual([]);
    expect(a.counts).toMatchObject({total: 5, byTier: {READY: 0, SOURCE_ONLY: 0, NOT_READY: 4, BLOCKED: 1}});
    for (const r of a.rows) { expect(r.gateById.security.detail, r.runId).toBe("NOT_EXECUTED"); expect(r.gateById.tests.detail, r.runId).toBe("NOT_EXECUTED"); expect(r.gateById.completion.detail, r.runId).toBe("NOT_RECORDED"); expect(r.gateById.delivery.detail, r.runId).toBe("NOT_PREPARED"); }

    const view = await load("views", "readiness.js");
    const {ctx, calls} = await mkCtx(async p => getJson(app, p));
    const rootNode: N = await view.render(ctx);
    expect(calls.slice().sort()).toEqual(FOUR);
    expect(itemsOf(rootNode).length).toBe(5);
    const expectedOrder = [...raw.runs.runs].sort((x: any, y: any) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt)).map((r: any) => r.runId);
    expect(itemsOf(rootNode).map(n => n.dataset.readinessItem)).toEqual(expectedOrder);
    expect(kpiValue(rootNode, "total")).toBe("5");
    expect(kpiValue(rootNode, "ready")).toBe("0");
    expect(kpiValue(rootNode, "sourceOnly")).toBe("0");
    expect(kpiValue(rootNode, "blocked")).toBe("1");
    const ra = itemFor(rootNode, seeded.A);
    expect(ra.dataset).toMatchObject({tier: "NOT_READY", review: "CLEAN", security: "NOT_EXECUTED", tests: "NOT_EXECUTED", delivery: "NOT_PREPARED", completion: "NOT_RECORDED"});
    expect(field(ra, "review")!.textContent).toContain("CLEAN");
    expect(field(ra, "review")!.textContent).toContain("REV-A");
    expect(byData(ra, "independent", "yes")).toBeTruthy();
    expect(itemFor(rootNode, seeded.C).dataset.tier).toBe("BLOCKED");
    expect(field(itemFor(rootNode, seeded.C), "review")!.textContent).toContain("rejected the current head");
    expect(field(itemFor(rootNode, seeded.D), "review")!.textContent).toContain("could not be proven independent");
    expect(field(itemFor(rootNode, seeded.E), "review")!.textContent).toContain("no independent review");
    expect(allData(rootNode, "overall", "READY").length).toBe(0);
    expect(surface(rootNode)).not.toContain(FORBIDDEN);
    expect(rootNode.textContent).not.toMatch(/product[\s_-]*verified/i);
  });
  it("a real Work OS without any journal gives an honest empty result (a real zero) and the integrity gate is UNKNOWN, never passed", async () => {
    const app = mkApp();
    const r = await renderView(p => getJson(app, p));
    expect(itemsOf(r.root).length).toBe(0);
    expect(byData(r.root, "readinessEmpty", "1")!.textContent).toContain("No work runs have been recorded yet");
    expect(allData(r.root, "readinessState").length).toBe(0);
    // Sunucu kanıt bloğu günlük yokken UNAVAILABLE bildirir: kapı UNKNOWN'dır, geçmiş sayılmaz.
    expect(byData(r.root, "integrityStatus")!.dataset.integrityStatus).toBe("UNKNOWN");
    expect(kpiValue(r.root, "total")).toBe("0");
    expect(kpiValue(r.root, "ready")).toBe("0");
  });
});

describe("Readiness — REAL runner + REAL git + REAL source delivery: a CLEAN independent review and a prepared/accepted package are never READY", () => {
  it("shows the real review verdict, tests NOT_EXECUTED, no completion record, source-only NOT_VERIFIED delivery; overall readiness stays below READY", { timeout: T }, async () => {
    const rt = tmpRoot("uasco-ready-m1a-");
    try {
      const c = setup(rt);
      const app = relfxApi(c, {sandbox: undefined}) as unknown as App; apps.push(app);
      const created = await app.inject({method: "POST", url: "/v1/projects", headers: RELFX_HDR, payload: {name: "Ready App", environmentId: "dev", template: "web-node", idempotencyKey: "ready-1"}});
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
      const core = await load("readiness-core.js");
      // Gerçek gövdeler katı eşleyicilerden geçer (gerçek veri biçimi sözleşmeyle uyumlu).
      const raws = {runs: await getJson(app, "/v1/work-runs", RELFX_HDR), reviews: await getJson(app, "/v1/reviews", RELFX_HDR), cockpit: await getJson(app, "/v1/cockpit", RELFX_HDR)};
      expect(core.mapReadinessWorkRuns(raws.runs).state).toBe("VERIFIED");
      expect(core.mapReadinessReviews(raws.reviews).state).toBe("VERIFIED");
      expect(core.mapReadinessEvidence(raws.cockpit).state).toBe("VERIFIED");
      expect(raws.reviews.runs.find((x: any) => x.runId === run.runId).reviewState).toBe("CLEAN");

      let rootNode = await view();
      let row = itemFor(rootNode, run.runId);
      expect(row.dataset.review).toBe("CLEAN");
      expect(row.dataset.tests).toBe("NOT_EXECUTED");
      expect(row.dataset.completion).toBe("NOT_RECORDED");
      expect(row.dataset.delivery).toBe("NOT_PREPARED");
      expect(["PASSED", "PARTIAL"]).toContain(row.dataset.security);
      expect(row.dataset.tier).not.toBe("READY");
      expect(missingGates(row)).toEqual(expect.arrayContaining(["run", "tests", "completion", "delivery"]));
      expect(row.textContent).toContain(pair.reviewer.identity);

      const prep = await app.inject({method: "POST", url: `/v1/work-runs/${run.runId}/delivery/prepare`, headers: RELFX_HDR, payload: {}});
      expect(prep.statusCode, prep.body).toBe(201);
      const art = prep.json().artifact;
      rootNode = await view(); row = itemFor(rootNode, run.runId);
      expect(row.dataset.delivery).toBe("ARTIFACT_PREPARED");
      expect(row.textContent).toContain(art.exportArtifactHash);
      expect(pills(field(row, "delivery")!)).toContain("NOT_VERIFIED");
      expect(byData(row, "note", "source-only")).toBeTruthy();
      expect(row.dataset.tier).toBe(row.dataset.security === "PASSED" ? "SOURCE_ONLY" : "NOT_READY");
      expect(row.dataset.tier).not.toBe("READY");

      const acc = await app.inject({method: "POST", url: `/v1/work-runs/${run.runId}/delivery/accept`, headers: RELFX_HDR, payload: {acceptance: {runId: art.runId, missionId: art.missionId, sourceCommit: art.sourceCommit, exportArtifactHash: art.exportArtifactHash, acknowledgeNotExecuted: true}}});
      expect(acc.statusCode, acc.body).toBe(200);
      rootNode = await view(); row = itemFor(rootNode, run.runId);
      expect(row.dataset.delivery).toBe("SOURCE_ACCEPTED");
      expect(row.textContent).toContain("Source delivery accepted · NOT_VERIFIED");
      expect(row.textContent).toContain(String(art.sourceCommit).slice(0, 12));
      expect(pills(field(row, "delivery")!)).toContain("NOT_VERIFIED");
      // Kabul edilmiş kaynak teslimi bile hazırlık değildir: testler çalıştırılmadı, tamamlanma kaydı yok.
      expect(row.dataset.tests).toBe("NOT_EXECUTED");
      expect(row.dataset.completion).toBe("NOT_RECORDED");
      expect(row.dataset.tier).not.toBe("READY");
      expect(allData(rootNode, "overall", "READY").length).toBe(0);
      expect(kpiValue(rootNode, "ready")).toBe("0");
      expect(surface(rootNode)).not.toContain(FORBIDDEN);
      expect(rootNode.textContent).not.toMatch(/product[\s_-]*verified/i);
      expect(pills(rootNode)).not.toContain(FORBIDDEN);
    } finally { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(rt); }
  });
});

// ---------------- (2) allow-list ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Readiness — only already-allow-listed read-only GETs are used (protected files unchanged)", () => {
  it("all four GET paths are already admitted by the desktop allow-list (incl. the UI-049 reviews list); nothing new is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    for (const p of FOUR) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/readiness", "/v1/readiness/summary", "/v1/release", "/v1/quality-gate", "/v1/reviews/", "/v1/reviews?x=1", "/v1/reviews/bad", "/v1/cockpit?x=1", "/v1/work-runs/", "/v1/missions?x=1"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes("readiness")).toBe(false);
    expect(set.includes("reviews")).toBe(false); // /v1/reviews zaten ayrık çapalı desenle (REVIEWS_LIST_RE) izinli; küme büyümez
    for (const f of [mainSrc, fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8"), fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")]) {
      expect(f).not.toContain("/v1/readiness");
      expect(f).not.toContain("/v1/quality-gate");
    }
  });
  it("readiness.js / readiness-core.js never write and never reach outside ctx.api: no post, bridge, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "readiness.js"), read("readiness-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions/);
    }
    const imports = moduleSpecifiers({source: read("views", "readiness.js")}).sort();
    expect(imports).toEqual(["../components.js", "../forms.js", "../model.js", "../readiness-core.js", "../work-core.js"]);
    expect(moduleSpecifiers({source: read("readiness-core.js")}).sort()).toEqual(["./executive-core.js", "./work-core.js"]);
    for (const m of ["readinessWorkRuns", "readinessReviews", "readinessEvidence", "readinessMissions"]) expect(read("views", "readiness.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur (yeni POST yolu eklenmez); hazırlık erişimcileri yalnız sabit GET yollarını okur.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const accessors = read("api.js").split(String.fromCharCode(10)).filter(l => /^\s*async readiness(WorkRuns|Reviews|Evidence|Missions)\(\)/.test(l));
    expect(accessors.length).toBe(4);
    for (const l of accessors) { expect(l).not.toMatch(/post\(|apiPost|force/); expect(l).toMatch(/await get\((WORK_RUNS|REVIEWS|COCKPIT|MISSIONS)_PATH\)/); }
  });
  it("the api layer requests exactly the four fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls} = await mkCtx(serve());
    const core = await load("readiness-core.js");
    expect(core.READINESS_SOURCE_PATHS).toEqual({workRuns: "/v1/work-runs", reviews: "/v1/reviews", evidence: "/v1/cockpit", missions: "/v1/missions"});
    expect(core.READINESS_SOURCES).toEqual(["workRuns", "reviews", "evidence", "missions"]);
    expect((await ctx.api.readinessWorkRuns()).state).toBe("VERIFIED");
    expect((await ctx.api.readinessReviews()).state).toBe("VERIFIED");
    expect((await ctx.api.readinessEvidence()).state).toBe("VERIFIED");
    expect((await ctx.api.readinessMissions()).state).toBe("VERIFIED");
    expect(calls).toEqual(["/v1/work-runs", "/v1/reviews", "/v1/cockpit", "/v1/missions"]);
    for (const m of ["readinessWorkRuns", "readinessReviews", "readinessEvidence", "readinessMissions"]) expect(ctx.api[m].length).toBe(0);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    const ms = ["readinessWorkRuns", "readinessReviews", "readinessEvidence", "readinessMissions"];
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ms) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    for (const m of ms) expect((await ctx.api[m]()).state, m).toBe("ERROR");
  });
});

// ---------------- (3) pure mappers ----------------
describe("Readiness — pure mappers are fail-closed and never elevate state", () => {
  const one = async (over: Record<string, any>, id = RUN1) => (await load("readiness-core.js")).mapReadinessWorkRuns({runs: [runRow(id, MSN1, over)]}).runs.items[0];
  it("mapReadinessWorkRuns derives security / tests / delivery / completion from the recorded evidence of the CURRENT head only, counts every run once", async () => {
    const core = await load("readiness-core.js");
    const m = core.mapReadinessWorkRuns({runs: [...RUNS.runs, READY_RUN()]});
    expect(m.state).toBe("VERIFIED");
    expect(m.runs.total).toBe(4);
    const by = Object.fromEntries(m.runs.items.map((r: any) => [r.runId, r]));
    expect(by[RUN2]).toMatchObject({security: "PASSED", tests: "NOT_EXECUTED", completion: {recorded: false, headSha: null}, delivery: {state: "ARTIFACT_PREPARED", commits: [HEAD]}});
    expect(by[RUN3]).toMatchObject({security: "NOT_EXECUTED", tests: "NOT_EXECUTED", delivery: {state: "NOT_PREPARED", commits: []}});
    expect(by[RUN4]).toMatchObject({headSha: null, security: "NOT_EXECUTED", tests: "NOT_EXECUTED"});
    expect(by[RUN1]).toMatchObject({security: "PASSED", tests: "EXECUTED", completion: {recorded: true, headSha: HEAD}, status: "SUCCEEDED"});
    // Eşleyici çıktısı ürün doğrulandı sabitini taşımaz (tamamlanma kaydı yalnız varlık + head olarak taşınır).
    expect(JSON.stringify(m)).not.toContain(FORBIDDEN);
    expect(core.mapReadinessWorkRuns({runs: []})).toEqual({state: "VERIFIED", runs: {total: 0, items: []}});
  });
  it("security: only a report bound to the current head counts; another commit is STALE; the latest report at head wins; a report without a stage summary is ignored (never elevated)", async () => {
    expect((await one({evidence: []})).security).toBe("NOT_EXECUTED");
    for (const st of ["PASSED", "PARTIAL", "BLOCKED"]) expect((await one({evidence: [SEC(st)]})).security, st).toBe(st);
    expect((await one({evidence: [SEC("PASSED", {commitSha: OLD})]})).security).toBe("STALE");
    expect((await one({evidence: [SEC("PASSED", {commitSha: undefined})]})).security).toBe("STALE");
    expect((await one({evidence: [SEC("BLOCKED"), SEC("PASSED")]})).security).toBe("PASSED");
    expect((await one({evidence: [SEC("PASSED"), SEC("BLOCKED")]})).security).toBe("BLOCKED");
    expect((await one({evidence: [SEC("PASSED", {commitSha: OLD}), SEC("PARTIAL")]})).security).toBe("PARTIAL");
    expect((await one({evidence: [ev("SECURITY_REPORT", 1, {step: "SECURITY"})]})).security).toBe("NOT_EXECUTED");
    expect((await one({headSha: null, evidence: [SEC("PASSED")]})).security).toBe("STALE");
  });
  it("tests: EXECUTED only for BOTH test kinds at the current head, exit 0, attested sandbox and a positive executed count; every other shape is never executed", async () => {
    const t = async (evidence: any[], over: Record<string, any> = {}) => (await one({evidence, ...over})).tests;
    const surface = (testSurface: Record<string, any>) => TESTS().map(e => e.kind === "TEST_SURFACE" ? {...e, testSurface} : e);
    expect(await t(TESTS())).toBe("EXECUTED");
    expect(await t([])).toBe("NOT_EXECUTED");
    expect(await t(NOT_EXEC())).toBe("NOT_EXECUTED");
    expect(await t([...TESTS(), ev("VERIFY_TESTS_NOT_EXECUTED", 1, {exitCode: null})])).toBe("NOT_EXECUTED"); // sandbox yokluğu kaydı daima kazanır
    expect(await t(TESTS().filter(e => e.kind !== "REGRESSION_TESTS"))).toBe("NOT_EXECUTED");
    expect(await t(TESTS().filter(e => e.kind !== "VERIFY_TESTS"))).toBe("NOT_EXECUTED");
    expect(await t(TESTS({commitSha: OLD}))).toBe("NOT_EXECUTED");
    expect(await t(TESTS({exitCode: 1}))).toBe("FAILED");
    expect(await t(TESTS({exitCode: null}))).toBe("FAILED");
    expect(await t(TESTS({sandboxProviderId: undefined}))).toBe("UNVERIFIED");
    expect(await t(surface({functionalAcceptance: "UNVERIFIED_VACUOUS", executedTests: 0}))).toBe("UNVERIFIED");
    expect(await t(surface({functionalAcceptance: "UNKNOWN", executedTests: null}))).toBe("UNVERIFIED");
    expect(await t(TESTS().filter(e => e.kind !== "TEST_SURFACE"))).toBe("UNVERIFIED");
    expect(await t(surface({functionalAcceptance: "BLOCKED", executedTests: 12}))).toBe("BLOCKED");
    expect(await t(TESTS(), {headSha: null})).toBe("NOT_EXECUTED");
  });
  it("delivery and completion are read from the recorded artifact / acceptance / completion only (never inferred)", async () => {
    expect((await one({})).delivery).toMatchObject({state: "NOT_PREPARED", commits: [], exportArtifactHash: null});
    expect((await one({deliveryArtifact: artifact(RUN1, MSN1)})).delivery).toMatchObject({state: "ARTIFACT_PREPARED", commits: [HEAD], exportArtifactHash: "f".repeat(64)});
    expect((await one({deliveryArtifact: artifact(RUN1, MSN1), sourceDelivery: accepted(RUN1, MSN1)})).delivery).toMatchObject({state: "SOURCE_ACCEPTED", acceptedAt: "2026-10-16T03:30:00.000Z"});
    expect((await one({deliveryArtifact: null, sourceDelivery: null})).delivery.state).toBe("NOT_PREPARED");
    expect((await one({})).completion).toEqual({recorded: false, headSha: null});
    expect((await one({status: "SUCCEEDED", completion: completion()})).completion).toEqual({recorded: true, headSha: HEAD});
    expect(JSON.stringify(await one({status: "SUCCEEDED", completion: completion()}))).not.toContain(FORBIDDEN);
  });
  it("any malformed run / evidence / delivery / completion field makes the WHOLE work-runs read ERROR (no partial list)", async () => {
    const core = await load("readiness-core.js");
    const r = (over: Record<string, any>) => ({runs: [runRow(RUN1, MSN1, over)]});
    const e1 = (over: Record<string, any>, kind = "IMPLEMENT") => r({evidence: [ev(kind, 1, over)]});
    const bad: any[] = [null, undefined, [], {}, {workRuns: []}, {runs: {}}, {runs: "x"}, {runs: [null]}, {runs: [runRow(RUN1, MSN1), runRow(RUN1, MSN2)]},
      r({runId: "bad"}), r({runId: "run_" + "A1".repeat(12)}), r({missionId: "bad"}), r({projectId: "prj_x"}), r({status: "DONE"}), r({status: "succeeded"}), r({step: "FINISH"}), r({createdAt: "x"}), r({updatedAt: undefined}),
      r({remediationCycle: -1}), r({remediationCycle: 1.5}), r({remediationCycle: "1"}), r({headSha: "zzz"}), r({baseSha: 123}), r({evidence: "x"}), r({evidence: undefined}), r({evidence: [null]}),
      e1({}, ""), e1({cycle: -1}), e1({cycle: undefined}), e1({commitSha: "xyz"}), e1({exitCode: "0"}), e1({exitCode: 1.5}), e1({verdict: "OK"}, "REVIEW"), e1({sandboxProviderId: 5}, "VERIFY_TESTS"), e1({sandboxProviderId: "bad id"}, "VERIFY_TESTS"),
      e1({security: "x"}, "SECURITY_REPORT"), e1({security: {status: "GREEN"}}, "SECURITY_REPORT"), e1({security: {}}, "SECURITY_REPORT"),
      e1({testSurface: "x"}, "TEST_SURFACE"), e1({testSurface: {functionalAcceptance: "VERIFIED", executedTests: 1}}, "TEST_SURFACE"), e1({testSurface: {functionalAcceptance: "UNKNOWN", executedTests: "3"}}, "TEST_SURFACE"), e1({testSurface: {functionalAcceptance: "UNKNOWN", executedTests: -1}}, "TEST_SURFACE"), e1({testSurface: {functionalAcceptance: "UNKNOWN"}}, "TEST_SURFACE"),
      r({deliveryArtifact: "x"}), r({deliveryArtifact: artifact(RUN1, MSN1, {exportArtifactHash: "short"})}), r({deliveryArtifact: artifact(RUN1, MSN1, {treeSha: "nope"})}), r({deliveryArtifact: artifact(RUN1, MSN1, {runId: RUN2})}), r({deliveryArtifact: artifact(RUN1, MSN1, {missionId: MSN2})}), r({deliveryArtifact: artifact(RUN1, MSN1, {sourceCommit: "x"})}),
      r({sourceDelivery: accepted(RUN1, MSN1, {acceptedAt: undefined})}), r({sourceDelivery: accepted(RUN1, MSN1, {acceptedAt: "later"})}), r({sourceDelivery: accepted(RUN1, MSN2)}), r({sourceDelivery: accepted(RUN1, MSN1, {exportArtifactHash: "x"})}), r({sourceDelivery: "x"}),
      r({status: "AWAITING_APPROVAL", completion: completion()}), r({status: "SUCCEEDED", completion: completion({headSha: "x"})}), r({status: "SUCCEEDED", completion: completion({productVerification: "x"})}), r({status: "SUCCEEDED", completion: "done"}), r({status: "SUCCEEDED", completion: {productVerification: {}}})];
    for (const b of bad) {
      const m = core.mapReadinessWorkRuns(b);
      expect(m.state, JSON.stringify(b)?.slice(0, 140)).toBe("ERROR");
      expect(m.runs).toBeNull();
    }
    // Tek bozuk satır, diğer sağlam satırlarla birlikte bile tüm okumayı düşürür.
    expect(core.mapReadinessWorkRuns({runs: [runRow(RUN1, MSN1), runRow(RUN2, MSN2, {status: "DONE"})]}).state).toBe("ERROR");
  });
  it("mapReadinessReviews carries every server review state VERBATIM and links each run to its latest recorded review", async () => {
    const core = await load("readiness-core.js");
    expect(core.REVIEW_STATES).toEqual(["CLEAN", "BLOCKED", "NO_VERDICT", "NOT_REVIEWED", "INDEPENDENCE_UNVERIFIED"]);
    const runs = ["a", "b", "c", "d", "e"].map((c, i) => runRow(RUN(c.repeat(2)), MSN1, {headSha: sha(String(i + 1))}));
    const states = core.REVIEW_STATES as string[];
    const m = core.mapReadinessReviews(reviewsBody(runs.map((r, i) => rv(r, states[i]))));
    expect(m.state).toBe("VERIFIED");
    expect(m.reviews.runs.map((r: any) => r.reviewState)).toEqual(states);
    expect(m.reviews.runs.map((r: any) => r.latest === null ? null : r.latest.verdict)).toEqual(["CLEAN", "BLOCKED", "NO_VERDICT", null, "CLEAN"]);
    expect(m.reviews.runs[4].latest.independent).toBe(false);
    expect(m.reviews.runs[0].latest).toMatchObject({reviewer: "REV-1", independent: true, reviewedCommit: runs[0].headSha, findingsCount: 0, cycle: 1});
    expect(m.reviews.truncated).toBe(false);
    const dflt = core.mapReadinessReviews(REVIEWS);
    expect(dflt.reviews.runs.map((r: any) => [r.runId, r.reviewState])).toEqual([[RUN2, "CLEAN"], [RUN3, "BLOCKED"], [RUN4, "NOT_REVIEWED"]]);
    expect(core.mapReadinessReviews(reviewsBody([]))).toMatchObject({state: "VERIFIED", reviews: {runs: [], records: []}});
  });
  it("any malformed or self-contradicting review payload makes the WHOLE reviews read ERROR (no partial verdicts)", async () => {
    const core = await load("readiness-core.js");
    const run = runRow(RUN1, MSN1), good = () => rv(run);
    const body = (pairs: any[] = [good()], over: Record<string, any> = {}) => reviewsBody(pairs, over);
    const withSummary = (s: Record<string, any>) => { const b = body(); b.summary = {...b.summary, ...s}; return b; };
    const sumOf = (over: Record<string, any>) => body([{sum: {...good().sum, ...over}, rec: good().rec}]);
    const recOf = (over: Record<string, any>) => body([{sum: good().sum, rec: {...good().rec, ...over}}]);
    const dupRun = body([good(), {sum: good().sum, rec: null}]);
    const bad: any[] = [null, undefined, [], {}, "x", body([], {source: "OTHER"}), body([], {source: undefined}), body([], {summary: null}), body([], {reviews: "x"}), body([], {runs: {}}),
      withSummary({runs: 2}), withSummary({reviews: 0}), withSummary({runs: "1"}), withSummary({truncated: "no"}), withSummary({truncated: undefined}),
      withSummary({runsByReviewState: {CLEAN: 2}}), withSummary({runsByReviewState: {APPROVED: 1}}), withSummary({runsByReviewState: null}), withSummary({reviewsByVerdict: {CLEAN: 1, BLOCKED: 1}}), withSummary({reviewsByVerdict: {NOT_REVIEWED: 1}}),
      body([good(), good()]), dupRun,
      sumOf({reviewState: "APPROVED"}), sumOf({reviewState: "clean"}), sumOf({runId: "bad"}), sumOf({missionId: "x"}), sumOf({status: "DONE"}), sumOf({step: "X"}), sumOf({headSha: "zzz"}), sumOf({headSha: null}), sumOf({reviewCount: -1}), sumOf({reviewCount: "1"}),
      sumOf({reviewState: "NOT_REVIEWED"}), sumOf({latestReviewId: null}), sumOf({latestReviewId: "evd_xyz"}), sumOf({latestReviewId: "evd_" + "9".repeat(24)}),
      sumOf({reviewState: "BLOCKED"}), sumOf({reviewState: "NO_VERDICT"}), sumOf({reviewState: "INDEPENDENCE_UNVERIFIED"}),
      recOf({reviewId: "bad"}), recOf({runId: RUN2}), recOf({missionId: "x"}), recOf({projectId: "x"}), recOf({cycle: -1}), recOf({verdict: "OK"}), recOf({verdict: "BLOCKED"}), recOf({timestamp: "x"}), recOf({independent: "yes"}), recOf({independent: false}), recOf({independent: null}),
      recOf({reviewedCommit: "abc"}), recOf({reviewedCommit: OLD}), recOf({reviewedCommit: null}), recOf({currentHead: "true"}), recOf({currentHead: undefined}), recOf({reviewer: null}), recOf({reviewer: {identity: 5}}), recOf({implementer: {identity: 5}}), recOf({evidence: null}), recOf({evidence: {findingsCount: -1}}), recOf({evidence: {findingsCount: "1"}})];
    for (const b of bad) {
      const m = core.mapReadinessReviews(b);
      expect(m.state, JSON.stringify(b)?.slice(0, 160)).toBe("ERROR");
      expect(m.reviews).toBeNull();
    }
    // Bir CLEAN özeti, kaydı bağımsız olmayan/başka commit'e ait/başka karar olan bir koşuda ASLA CLEAN taşınmaz; tutarlı gövde ise kabul edilir.
    expect(core.mapReadinessReviews(body()).state).toBe("VERIFIED");
  });
  it("a truncated reviews list may omit a record: the run keeps its server state but the CLEAN claim is unconfirmed (never PASS)", async () => {
    const core = await load("readiness-core.js");
    const run = READY_RUN(), b: any = reviewsBody([rv(run)]);
    b.reviews = []; b.summary.reviews = 1; b.summary.reviewsByVerdict = {CLEAN: 1}; b.summary.truncated = true;
    const m = core.mapReadinessReviews(b);
    expect(m.state).toBe("VERIFIED");
    expect(m.reviews).toMatchObject({truncated: true});
    expect(m.reviews.runs[0]).toMatchObject({reviewState: "CLEAN", latest: null});
    const a = core.buildReadiness({workRuns: core.mapReadinessWorkRuns({runs: [run]}), reviews: m, evidence: core.mapReadinessEvidence(cockpitBody()), missions: {state: "UNAVAILABLE"}});
    expect(a.rows[0].gateById.review).toMatchObject({status: "PENDING", detail: "UNCONFIRMED"});
    expect(a.rows[0].tier).not.toBe("READY");
    // Kısaltılmamış listede kayıp kayıt bir tutarsızlıktır.
    const b2: any = reviewsBody([rv(run)]); b2.reviews = []; b2.summary.reviews = 0; b2.summary.reviewsByVerdict = {};
    expect(core.mapReadinessReviews(b2).state).toBe("ERROR");
  });
  it("mapReadinessEvidence reads only the cockpit evidence block: honest non-live blocks carry no numbers; any malformed field or inconsistent sum fails the whole read", async () => {
    const core = await load("readiness-core.js");
    expect(core.mapReadinessEvidence(cockpitBody())).toEqual({state: "VERIFIED", evidence: {state: "VERIFIED", total: 10, verified: 10, mismatch: 0, missing: 0, unverifiable: 0, asOf: "2026-10-16T08:00:00.000Z"}});
    expect(core.mapReadinessEvidence(cockpitBody({state: "STALE"})).evidence.state).toBe("STALE");
    for (const st of ["UNAVAILABLE", "ERROR"]) expect(core.mapReadinessEvidence(cockpitBody({state: st, total: 9, verified: 9, mismatch: null, missing: null, unverifiable: null})).evidence).toMatchObject({state: st, total: null, verified: null, mismatch: null, missing: null, unverifiable: null});
    const bad: any[] = [null, undefined, [], {}, {evidence: {}}, cockpitBody({}, {generatedAt: "x"}), cockpitBody({}, {generatedAt: undefined}), cockpitBody({}, {evidence: null}), cockpitBody({}, {evidence: "x"}),
      cockpitBody({state: "MAYBE"}), cockpitBody({state: undefined}), cockpitBody({total: undefined}), cockpitBody({verified: -1}), cockpitBody({verified: "10"}), cockpitBody({mismatch: 1.5}), cockpitBody({missing: undefined}), cockpitBody({unverifiable: null}),
      cockpitBody({verified: 9}), cockpitBody({verified: 10, mismatch: 1})];
    for (const b of bad) { const m = core.mapReadinessEvidence(b); expect(m.state, JSON.stringify(b)?.slice(0, 120)).toBe("ERROR"); expect(m.evidence).toBeNull(); }
  });
});

// ---------------- (4) readiness derivation ----------------
describe("Readiness — READY only when every one of the seven gates is genuinely satisfied; nothing is assumed", () => {
  it("the baseline run with all seven gates satisfied is READY, lists nothing as missing, and the other tiers follow the documented rules", async () => {
    const {core, out} = await assess([READY_RUN()]);
    expect(core.GATES).toEqual(["run", "review", "security", "tests", "delivery", "completion", "integrity"]);
    expect(core.TIERS).toEqual(["READY", "SOURCE_ONLY", "NOT_READY", "BLOCKED"]);
    expect(out.complete).toBe(true);
    const row = out.rows[0];
    expect(row.tier).toBe("READY");
    expect(row.missing).toEqual([]);
    expect(row.gates.map((g: any) => [g.id, g.status])).toEqual(core.GATES.map((g: string) => [g, "PASS"]));
    expect(row.title).toBe("Alpha mission");
    expect(out.counts).toEqual({total: 1, byTier: {READY: 1, SOURCE_ONLY: 0, NOT_READY: 0, BLOCKED: 0}});
    const all4 = [READY_RUN(), ...RUNS.runs];
    const mixed = (await assess(all4, {reviews: reviewsFor(all4, DEFAULT_STATES)})).out;
    expect(mixed.counts).toEqual({total: 4, byTier: {READY: 1, SOURCE_ONLY: 1, NOT_READY: 1, BLOCKED: 1}});
    expect(Object.fromEntries(mixed.rows.map((r: any) => [r.runId, r.tier]))).toEqual({[RUN1]: "READY", [RUN2]: "SOURCE_ONLY", [RUN3]: "BLOCKED", [RUN4]: "NOT_READY"});
  });
  type Spec = {runs: any[]; reviews?: any; cockpit?: any; reviewsRes?: any; evidenceRes?: any};
  type Case = [string, () => Spec, string, string, string];
  const R1 = (over: Record<string, any> = {}) => [READY_RUN(RUN1, MSN1, over)];
  const stRv = (state: string) => (): Spec => ({runs: R1(), reviews: reviewsFor(R1(), {[RUN1]: state})});
  const without = (...kinds: string[]) => FULL_EV().filter(e => !kinds.includes(e.kind));
  const TEST_KINDS = ["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"];
  const noCockpit = {total: null, verified: null, mismatch: null, missing: null, unverifiable: null};
  const cases: Case[] = [
    ["run still awaiting the Founder decision", () => ({runs: R1({status: "AWAITING_APPROVAL", completion: undefined})}), "run", "PENDING", "AWAITING_APPROVAL"],
    ["run still running", () => ({runs: R1({status: "RUNNING", completion: undefined})}), "run", "PENDING", "RUNNING"],
    ["run failed", () => ({runs: R1({status: "FAILED", completion: undefined})}), "run", "FAIL", "FAILED"],
    ["run cancelled", () => ({runs: R1({status: "CANCELLED", completion: undefined})}), "run", "FAIL", "CANCELLED"],
    ["review BLOCKED", stRv("BLOCKED"), "review", "FAIL", "BLOCKED"],
    ["review NO_VERDICT", stRv("NO_VERDICT"), "review", "PENDING", "NO_VERDICT"],
    ["review NOT_REVIEWED", stRv("NOT_REVIEWED"), "review", "PENDING", "NOT_REVIEWED"],
    ["review INDEPENDENCE_UNVERIFIED", stRv("INDEPENDENCE_UNVERIFIED"), "review", "PENDING", "INDEPENDENCE_UNVERIFIED"],
    ["review belongs to another head", () => ({runs: R1(), reviews: reviewsBody([rv(R1()[0], "CLEAN", {sum: {headSha: OLD}, rec: {reviewedCommit: OLD}})])}), "review", "PENDING", "STALE"],
    ["run has no review record listed", () => ({runs: R1(), reviews: reviewsBody([])}), "review", "PENDING", "NOT_LISTED"],
    ["reviews offline", () => ({runs: R1(), reviewsRes: {state: "OFFLINE", reviews: null}}), "review", "UNKNOWN", "OFFLINE"],
    ["reviews unavailable", () => ({runs: R1(), reviewsRes: {state: "UNAVAILABLE", reviews: null}}), "review", "UNKNOWN", "UNAVAILABLE"],
    ["reviews malformed", () => ({runs: R1(), reviews: {nonsense: true}}), "review", "UNKNOWN", "ERROR"],
    ["security PARTIAL", () => ({runs: R1({evidence: [...without("SECURITY_REPORT"), SEC("PARTIAL")]})}), "security", "PENDING", "PARTIAL"],
    ["security BLOCKED", () => ({runs: R1({evidence: [...without("SECURITY_REPORT"), SEC("BLOCKED")]})}), "security", "FAIL", "BLOCKED"],
    ["security report for another commit", () => ({runs: R1({evidence: [...without("SECURITY_REPORT"), SEC("PASSED", {commitSha: OLD})]})}), "security", "PENDING", "STALE"],
    ["no security report", () => ({runs: R1({evidence: without("SECURITY_REPORT")})}), "security", "PENDING", "NOT_EXECUTED"],
    ["tests never ran", () => ({runs: R1({evidence: without(...TEST_KINDS)})}), "tests", "PENDING", "NOT_EXECUTED"],
    ["tests recorded as NOT_EXECUTED (no sandbox)", () => ({runs: R1({evidence: [...without(...TEST_KINDS), ...NOT_EXEC()]})}), "tests", "PENDING", "NOT_EXECUTED"],
    ["tests failed", () => ({runs: R1({evidence: [...without(...TEST_KINDS), ...TESTS({exitCode: 1})]})}), "tests", "FAIL", "FAILED"],
    ["tests without sandbox attestation", () => ({runs: R1({evidence: [...without(...TEST_KINDS), ...TESTS({sandboxProviderId: undefined})]})}), "tests", "PENDING", "UNVERIFIED"],
    ["zero tests executed", () => ({runs: R1({evidence: [...without("TEST_SURFACE"), ev("TEST_SURFACE", 1, {testSurface: {functionalAcceptance: "UNVERIFIED_VACUOUS", executedTests: 0}})]})}), "tests", "PENDING", "UNVERIFIED"],
    ["test surface blocked", () => ({runs: R1({evidence: [...without("TEST_SURFACE"), ev("TEST_SURFACE", 1, {testSurface: {functionalAcceptance: "BLOCKED", executedTests: 5}})]})}), "tests", "FAIL", "BLOCKED"],
    ["tests for another commit", () => ({runs: R1({evidence: [...without(...TEST_KINDS), ...TESTS({commitSha: OLD})]})}), "tests", "PENDING", "NOT_EXECUTED"],
    ["no delivery package", () => ({runs: R1({deliveryArtifact: undefined})}), "delivery", "PENDING", "NOT_PREPARED"],
    ["delivery package for another commit", () => ({runs: R1({deliveryArtifact: artifact(RUN1, MSN1, {sourceCommit: OLD})})}), "delivery", "PENDING", "STALE"],
    ["no completion record", () => ({runs: R1({completion: undefined})}), "completion", "PENDING", "NOT_RECORDED"],
    ["completion for another head", () => ({runs: R1({completion: completion({headSha: OLD})})}), "completion", "PENDING", "STALE"],
    ["evidence mismatch", () => ({runs: R1(), cockpit: cockpitBody({verified: 9, mismatch: 1})}), "integrity", "FAIL", "MISMATCH"],
    ["evidence missing", () => ({runs: R1(), cockpit: cockpitBody({verified: 9, missing: 1})}), "integrity", "PENDING", "INCOMPLETE"],
    ["evidence unverifiable", () => ({runs: R1(), cockpit: cockpitBody({verified: 9, unverifiable: 1})}), "integrity", "PENDING", "INCOMPLETE"],
    ["no evidence records at all", () => ({runs: R1(), cockpit: cockpitBody({total: 0, verified: 0})}), "integrity", "PENDING", "INCOMPLETE"],
    ["evidence check stale", () => ({runs: R1(), cockpit: cockpitBody({state: "STALE"})}), "integrity", "PENDING", "STALE"],
    ["evidence block unavailable", () => ({runs: R1(), cockpit: cockpitBody({state: "UNAVAILABLE", ...noCockpit})}), "integrity", "UNKNOWN", "UNAVAILABLE"],
    ["evidence block error", () => ({runs: R1(), cockpit: cockpitBody({state: "ERROR", ...noCockpit})}), "integrity", "UNKNOWN", "ERROR"],
    ["cockpit offline", () => ({runs: R1(), evidenceRes: {state: "OFFLINE", evidence: null}}), "integrity", "UNKNOWN", "OFFLINE"],
    ["cockpit malformed", () => ({runs: R1(), cockpit: {nonsense: true}}), "integrity", "UNKNOWN", "ERROR"]];
  async function evaluate(spec: Spec) {
    const core = await load("readiness-core.js");
    const res = {workRuns: core.mapReadinessWorkRuns({runs: spec.runs}), reviews: spec.reviewsRes ?? core.mapReadinessReviews(spec.reviews ?? reviewsFor(spec.runs)), evidence: spec.evidenceRes ?? core.mapReadinessEvidence(spec.cockpit ?? cockpitBody()), missions: (await load("queue-core.js")).mapQueueMissions(MISSIONS)};
    return {core, res, out: core.buildReadiness(res)};
  }
  it("breaking ANY single gate in ANY way (missing, stale, partial, failed, unverified, unreadable) can never leave the run READY, and the broken gate is the one named as missing", async () => {
    expect(cases.length).toBeGreaterThan(30);
    for (const [label, build, gateId, status, detail] of cases) {
      const {res, out} = await evaluate(build());
      expect(res.workRuns.state, `${label}: runs fixture must be valid`).toBe("VERIFIED");
      const row = out.rows[0];
      expect(row.gateById[gateId], label).toMatchObject({status, detail});
      expect(row.tier, label).not.toBe("READY");
      expect(row.missing.map((g: any) => g.id), label).toContain(gateId);
      expect(row.missing.length, label).toBeGreaterThan(0);
      if (res.reviews.state !== "VERIFIED" || res.evidence.state !== "VERIFIED") expect(out.complete, label).toBe(false);
    }
  });
  it("a negative run-level gate makes the run BLOCKED; platform integrity or unreadable data never blocks by itself and unknown gates never count as passed", async () => {
    for (const [label, build, gateId, status] of cases) {
      const {out} = await evaluate(build());
      const row = out.rows[0];
      const runScopedFail = ["run", "review", "security", "tests"].includes(gateId) && status === "FAIL";
      if (runScopedFail) expect(row.tier, label).toBe("BLOCKED");
      else expect(row.tier, label).not.toBe("BLOCKED");
      if (status === "UNKNOWN") expect(row.gateById[gateId].status, label).not.toBe("PASS");
      // Kanıt uyuşmazlığı kaynak-düzeyi iddiayı da düşürür: inceleme/güvenlik kanıtının kendisi şüphelidir.
      if (gateId === "integrity" && status === "FAIL") expect(row.tier, label).toBe("NOT_READY");
    }
  });
  it("SOURCE_ONLY needs review CLEAN + security PASSED + a delivery package for the current head, and is never a release-ready state", async () => {
    const core = await load("readiness-core.js");
    const row = (await assess([SOURCE_RUN()])).out.rows[0];
    expect(row.tier).toBe("SOURCE_ONLY");
    expect(row.missing.map((g: any) => g.id)).toEqual(["run", "tests", "completion"]);
    expect(core.TIERS.indexOf(row.tier)).toBeGreaterThan(core.TIERS.indexOf("READY"));
    // Biri eksikse SOURCE_ONLY da olmaz.
    expect((await assess([SOURCE_RUN({deliveryArtifact: undefined})])).out.rows[0].tier).toBe("NOT_READY");
    expect((await assess([SOURCE_RUN({evidence: [IMPL(), ...NOT_EXEC(), SEC("PARTIAL"), REVIEW_EV(), REPORT()]})])).out.rows[0].tier).toBe("NOT_READY");
    expect((await assess([SOURCE_RUN()], {reviews: reviewsFor([SOURCE_RUN()], {[RUN2]: "NOT_REVIEWED"})})).out.rows[0].tier).toBe("NOT_READY");
    expect((await assess([SOURCE_RUN()], {cockpit: cockpitBody({verified: 9, mismatch: 1})})).out.rows[0].tier).toBe("NOT_READY");
  });
  it("an incomplete assessment never reports totals (null, not zero) and names the unreadable sources; unreadable work runs yield no rows at all", async () => {
    const core = await load("readiness-core.js");
    const runs = core.mapReadinessWorkRuns(RUNS), reviews = core.mapReadinessReviews(REVIEWS), evidence = core.mapReadinessEvidence(cockpitBody());
    const missions = (await load("queue-core.js")).mapQueueMissions(MISSIONS);
    const full = core.buildReadiness({workRuns: runs, reviews, evidence, missions});
    expect(full.complete).toBe(true);
    expect(full.counts.total).toBe(3);
    expect(full.unreadable).toEqual([]);
    const noRv = core.buildReadiness({workRuns: runs, reviews: {state: "OFFLINE", reviews: null}, evidence, missions});
    expect(noRv).toMatchObject({complete: false, counts: null, unreadableRequired: ["reviews"], incompleteState: "OFFLINE"});
    expect(noRv.rows.length).toBe(3);
    const noEv = core.buildReadiness({workRuns: runs, reviews, evidence: {state: "ERROR", evidence: null}, missions});
    expect(noEv).toMatchObject({complete: false, counts: null, unreadableRequired: ["evidence"], incompleteState: "ERROR"});
    const noRuns = core.buildReadiness({workRuns: {state: "UNAVAILABLE", runs: null}, reviews, evidence, missions});
    expect(noRuns).toMatchObject({complete: false, counts: null, rows: [], unreadableRequired: ["workRuns"], incompleteState: "UNAVAILABLE"});
    // Mission başlıkları yalnız süs: okunamasa da değerlendirme tamdır ve başlık uydurulmaz.
    const noMs = core.buildReadiness({workRuns: runs, reviews, evidence, missions: {state: "ERROR", missions: null}});
    expect(noMs.complete).toBe(true);
    expect(noMs).toMatchObject({unreadable: ["missions"], titlesKnown: false});
    expect(noMs.rows.every((r: any) => r.title === null)).toBe(true);
    const nothing = core.buildReadiness({workRuns: undefined, reviews: null, evidence: {}, missions: {state: "?"}});
    expect(nothing).toMatchObject({complete: false, counts: null, rows: []});
    expect(nothing.incompleteState).toBe("ERROR");
  });
  it("rows are newest activity first, with createdAt then run id as stable tie-breakers", async () => {
    const mk = (id: string, upd: string, cr: string) => runRow(id, MSN1, {updatedAt: upd, createdAt: cr});
    const runs = [mk(RUN1, "2026-10-16T09:00:00.000Z", "2026-10-16T01:00:00.000Z"), mk(RUN2, "2026-10-16T09:00:00.000Z", "2026-10-16T02:00:00.000Z"), mk(RUN3, "2026-10-16T09:00:00.000Z", "2026-10-16T02:00:00.000Z"), mk(RUN4, "2026-10-16T10:00:00.000Z", "2026-10-16T00:00:00.000Z")];
    const order = (await assess(runs)).out.rows.map((r: any) => r.runId);
    expect(order).toEqual([RUN4, RUN3, RUN2, RUN1]);
    expect((await assess([...runs].reverse())).out.rows.map((r: any) => r.runId)).toEqual(order);
  });
});

// ---------------- (5) view honesty ----------------
const sourcesOf = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const READY_ALL = [READY_RUN(), ...RUNS.runs];
const serveReady = (over: Record<string, any> = {}) => serve({"/v1/work-runs": {runs: READY_ALL}, "/v1/reviews": reviewsFor(READY_ALL, DEFAULT_STATES), ...over});
describe("Readiness — view honesty", () => {
  it("renders summary (section A) before the per-run readiness (section B): real figures, newest first, exactly what is missing, delivery source-only NOT_VERIFIED", async () => {
    const {root, calls} = await renderView(serve());
    expect(calls.slice().sort()).toEqual(FOUR);
    expect(all(root).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["readiness-summary", "readiness-runs"]);
    expect(byId(root, "view-title")!.textContent).toBe("Quality Gate & Release Readiness");
    expect(sourcesOf(root).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["workRuns", "VERIFIED"], ["reviews", "VERIFIED"], ["evidence", "VERIFIED"], ["missions", "VERIFIED"]]);
    expect(kpiValue(root, "total")).toBe("3");
    expect(kpiValue(root, "ready")).toBe("0");
    expect(kpiValue(root, "sourceOnly")).toBe("1");
    expect(kpiValue(root, "notReady")).toBe("1");
    expect(kpiValue(root, "blocked")).toBe("1");
    expect(pills(kpi(root, "sourceOnly"))).toContain("NOT_VERIFIED");
    expect(itemsOf(root).map(n => n.dataset.readinessItem)).toEqual([RUN4, RUN2, RUN3]);
    expect(byData(root, "integrity")!.dataset.integrity).toBe("ALL_VERIFIED");
    expect(byData(root, "field", "integrityCounts")!.textContent).toBe("10 of 10 evidence records are hash-verified · 0 mismatch · 0 missing · 0 unverifiable.");

    const r2 = itemFor(root, RUN2);
    expect(r2.dataset).toMatchObject({tier: "SOURCE_ONLY", runStatus: "AWAITING_APPROVAL", review: "CLEAN", security: "PASSED", tests: "NOT_EXECUTED", delivery: "ARTIFACT_PREPARED", completion: "NOT_RECORDED", integrity: "ALL_VERIFIED"});
    expect(all(r2).find(n => n.tagName === "H4")!.textContent).toBe("Beta mission");
    expect(field(r2, "mission")!.textContent).toContain(MSN2);
    expect(pills(byData(r2, "overall")!)).toEqual(["NOT_VERIFIED"]);
    expect(byData(r2, "overall")!.textContent).toContain("Source only · NOT_VERIFIED");
    expect(byData(r2, "overall")!.textContent).toContain("This is not a release-ready state.");
    expect(missingGates(r2)).toEqual(["run", "tests", "completion"]);
    expect(pills(field(r2, "run")!)).toEqual(["WAITING"]);
    expect(pills(field(r2, "review")!)).toEqual(["DONE"]);
    expect(byData(field(r2, "review")!, "verbatim", "1")!.textContent).toBe("CLEAN");
    expect(field(r2, "review")!.textContent).toContain("Reviewer REV-1, cycle 1");
    expect(byData(field(r2, "review")!, "independent", "yes")).toBeTruthy();
    expect(pills(field(r2, "security")!)).toEqual(["DONE"]);
    expect(pills(field(r2, "tests")!)).toEqual(["NOT_EXECUTED"]);
    expect(field(r2, "tests")!.textContent).toContain("Not executed");
    expect(pills(field(r2, "delivery")!)).toEqual(["NOT_VERIFIED"]);
    expect(field(r2, "delivery")!.textContent).toContain("Source package prepared · NOT_VERIFIED");
    expect(field(r2, "delivery")!.textContent).toContain("f".repeat(64));
    expect(byData(field(r2, "delivery")!, "note", "source-only")!.textContent).toBe("Source only: the generated code was not executed. NOT_VERIFIED.");
    expect(pills(field(r2, "completion")!)).toEqual(["NOT_EXECUTED"]);
    expect(pills(field(r2, "integrity")!)).toEqual(["VERIFIED"]);

    const r3 = itemFor(root, RUN3);
    expect(r3.dataset).toMatchObject({tier: "BLOCKED", runStatus: "FAILED", review: "BLOCKED"});
    expect(pills(byData(r3, "overall")!)).toEqual(["BLOCKED"]);
    expect(byData(r3, "overall")!.textContent).toContain("Blocked / rejected");
    expect(pills(field(r3, "run")!)).toEqual(["FAILED"]);
    expect(pills(field(r3, "review")!)).toEqual(["BLOCKED"]);
    expect(byData(field(r3, "review")!, "verbatim", "1")!.textContent).toBe("BLOCKED");
    expect(field(r3, "review")!.textContent).toContain("rejected the current head");
    expect(missingGates(r3)).toEqual(["run", "review", "security", "tests", "delivery", "completion"]);

    const r4 = itemFor(root, RUN4);
    expect(r4.dataset).toMatchObject({tier: "NOT_READY", review: "NOT_REVIEWED", delivery: "NOT_PREPARED"});
    expect(pills(byData(r4, "overall")!)).toEqual(["WAITING"]);
    expect(field(r4, "head")!.textContent).toBe("—");
    expect(field(r4, "mission")!.textContent).toContain("Delta mission");

    // Hiçbir koşu READY değil; sabit notlar ve dürüstlük uyarısı var; yasak sabit yok.
    expect(allData(root, "overall", "READY").length).toBe(0);
    expect(byData(root, "readonly", "1")).toBeTruthy();
    expect(byData(root, "honesty", "1")!.textContent).toContain("Delivery here is source only");
    expect(byData(root, "note", "gates")!.textContent).toContain("A run is READY only if all of these are satisfied");
    expect(byData(root, "note", "actions")!.textContent).toContain("Nothing is approved, delivered or released from this view.");
    expect(byData(root, "note", "order")!.textContent).toBe("Order: newest activity first.");
    expect(allData(root, "readinessState").length).toBe(0);
    expect(byData(root, "readinessPartial")).toBeUndefined();
    expect(surface(root)).not.toContain(FORBIDDEN);
  });
  it("a run whose seven gates are ALL genuinely satisfied is READY: nothing is missing, and even then delivery stays source-only NOT_VERIFIED and the verified-product constant is never shown", async () => {
    const {root} = await renderView(serveReady());
    expect(itemsOf(root).map(n => n.dataset.readinessItem)).toEqual([RUN1, RUN4, RUN2, RUN3]);
    const r1 = itemFor(root, RUN1);
    expect(r1.dataset).toMatchObject({tier: "READY", runStatus: "SUCCEEDED", review: "CLEAN", security: "PASSED", tests: "EXECUTED", delivery: "ARTIFACT_PREPARED", completion: "RECORDED", integrity: "ALL_VERIFIED"});
    expect(pills(byData(r1, "overall")!)).toEqual(["DONE"]);
    expect(byData(r1, "overall")!.textContent).toContain("All seven gates are satisfied for the current head commit.");
    expect(byData(r1, "missing", "0")!.textContent).toBe("No gate is missing: all seven are satisfied.");
    expect(missingGates(r1)).toEqual([]);
    expect(kpiValue(root, "ready")).toBe("1");
    expect(kpiValue(root, "total")).toBe("4");
    expect(pills(field(r1, "delivery")!)).toEqual(["NOT_VERIFIED"]);
    expect(field(r1, "completion")!.textContent).toContain("Recorded by the server for the current head");
    // Sunucu tamamlanma kaydı sabiti taşısa bile görünüm onu hiçbir yerde üretmez.
    expect(surface(root)).not.toContain(FORBIDDEN);
    expect(root.textContent).not.toMatch(/product[\s_-]*verified/i);
    expect(pills(root)).not.toContain(FORBIDDEN);
    // Diğer koşular etkilenmez.
    expect(itemFor(root, RUN2).dataset.tier).toBe("SOURCE_ONLY");
    expect(itemFor(root, RUN3).dataset.tier).toBe("BLOCKED");
  });
  it("overall readiness never shows READY when evidence, review or delivery is unverified: every degraded scenario renders no READY row and no READY figure", async () => {
    const R1 = READY_RUN();
    const only = (extra: Record<string, any>, runs: any[] = [R1]) => serve({"/v1/work-runs": {runs}, "/v1/reviews": reviewsFor(runs), ...extra});
    const noTests = READY_RUN(RUN1, MSN1, {evidence: [...FULL_EV().filter(e => !["VERIFY_TESTS", "REGRESSION_TESTS", "TEST_SURFACE"].includes(e.kind)), ...NOT_EXEC()]});
    const scenarios: Array<[string, (p: string) => any]> = [
      ["review blocked", only({"/v1/reviews": reviewsFor([R1], {[RUN1]: "BLOCKED"})})],
      ["review not reviewed", only({"/v1/reviews": reviewsFor([R1], {[RUN1]: "NOT_REVIEWED"})})],
      ["independence unverified", only({"/v1/reviews": reviewsFor([R1], {[RUN1]: "INDEPENDENCE_UNVERIFIED"})})],
      ["no verdict", only({"/v1/reviews": reviewsFor([R1], {[RUN1]: "NO_VERDICT"})})],
      ["reviews unreadable", only({"/v1/reviews": () => fail("x", 500)})],
      ["reviews offline", only({"/v1/reviews": () => { throw new Error("fetch failed"); }})],
      ["evidence mismatch", only({"/v1/cockpit": cockpitBody({verified: 9, mismatch: 1})})],
      ["evidence unreadable", (p: string) => (p === "/v1/cockpit" ? fail(p, 500) : only({})(p))],
      ["tests not executed (no sandbox)", only({}, [noTests])],
      ["no completion record", only({}, [READY_RUN(RUN1, MSN1, {completion: undefined})])],
      ["no delivery package", only({}, [READY_RUN(RUN1, MSN1, {deliveryArtifact: undefined})])],
      ["security partial", only({}, [READY_RUN(RUN1, MSN1, {evidence: [...FULL_EV().filter(e => e.kind !== "SECURITY_REPORT"), SEC("PARTIAL")]})])],
      ["source only (the real shape)", serve()]];
    // Pozitif kontrol: aynı düzenek bozulmamış koşuda READY gösterir; aksi halde bu test boş geçerdi.
    expect(allData((await renderView(only({}))).root, "overall", "READY").length).toBe(1);
    for (const [name, fn] of scenarios) {
      const {root} = await renderView(fn);
      expect(allData(root, "overall", "READY").length, name).toBe(0);
      expect(allData(root, "tier", "READY").length, name).toBe(0);
      expect(["0", "—"], name).toContain(kpiValue(root, "ready"));
      expect(root.textContent, name).not.toContain("All seven gates are satisfied");
      expect(surface(root), name).not.toContain(FORBIDDEN);
    }
  });
  it("EVERY scenario in EN and TR renders without the verified-product constant (even though the API carries it) and without raw i18n keys", async () => {
    const scenarios: Array<[string, (p: string) => any]> = [
      ["full", serve()], ["ready-carrying-forbidden", serveReady()],
      ["offline", () => { throw new Error("fetch failed"); }], ["unavailable", () => fail("x", 404)], ["error", () => fail("x", 500)], ["malformed", () => ({nonsense: true})],
      ["empty", serve({"/v1/work-runs": {runs: []}, "/v1/reviews": reviewsBody([]), "/v1/missions": {missions: []}})],
      ["mismatch", serve({"/v1/cockpit": cockpitBody({verified: 9, mismatch: 1})})], ["stale-evidence", serve({"/v1/cockpit": cockpitBody({state: "STALE"})})],
      ["evidence-unavailable", serve({"/v1/cockpit": cockpitBody({state: "UNAVAILABLE", total: null, verified: null, mismatch: null, missing: null, unverifiable: null})})],
      ["partial-reviews", (p: string) => (p === "/v1/reviews" ? fail(p, 500) : serve()(p))],
      ["partial-evidence", (p: string) => (p === "/v1/cockpit" ? fail(p, 404) : serve()(p))],
      ["partial-missions", (p: string) => (p === "/v1/missions" ? fail(p, 500) : serve()(p))],
      ["partial-runs", (p: string) => (p === "/v1/work-runs" ? fail(p, 404) : serve()(p))]];
    for (const lang of ["en", "tr"]) for (const [name, fn] of scenarios) {
      const {root} = await renderView(fn, lang);
      const label = `${lang}/${name}`;
      expect(surface(root), label).not.toContain(FORBIDDEN);
      expect(root.textContent, label).not.toMatch(/product[\s_-]*verified/i);
      expect(lines(root), label).not.toMatch(/\b(readiness|area\.readiness)\.[A-Za-z]+(\.[A-Za-z_0-9]+)*\b/);
      expect(pills(root), label).not.toContain(FORBIDDEN);
    }
  });
  it("each source fails independently with its own honest state; healthy sources stay intact, figures are withheld, affected gates are UNKNOWN (never passed)", async () => {
    // Reviews okunamıyor: satırlar listelenir, ama inceleme kapısı UNKNOWN; sayılar yok.
    let r = await renderView(serve({"/v1/reviews": () => fail("x", 500)}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["reviews", "ERROR"]]);
    expect(sourcesOf(r.root).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["workRuns", "VERIFIED"], ["reviews", "ERROR"], ["evidence", "VERIFIED"], ["missions", "VERIFIED"]]);
    expect(byData(r.root, "readinessState")!.textContent).toContain("GET /v1/reviews");
    for (const id of ["total", "ready", "sourceOnly", "notReady", "blocked"]) { expect(kpiValue(r.root, id), id).toBe("—"); expect(kpi(r.root, id).dataset.state, id).toBe("ERROR"); }
    expect(byData(r.root, "readinessPartial")!.dataset.readinessPartial).toBe("reviews");
    expect(byData(r.root, "readinessPartial")!.textContent).toContain("Independent reviews could not be read");
    expect(itemsOf(r.root).map(n => n.dataset.readinessItem)).toEqual([RUN4, RUN2, RUN3]);
    for (const li of itemsOf(r.root)) { expect(li.dataset.review).toBe("ERROR"); expect(pills(field(li, "review")!)).toEqual(["FAILED"]); expect(field(li, "review")!.textContent).toContain("Unknown"); }
    expect(itemFor(r.root, RUN2).dataset.tier).toBe("NOT_READY"); // inceleme bilinmeden kaynak-düzeyi hazır iddiası kurulmaz
    expect(itemFor(r.root, RUN3).dataset.tier).toBe("BLOCKED"); // koşunun kendi kapısı olumsuz: kesin
    expect(byData(r.root, "note", "gates-unknown")!.textContent).toContain("Independent reviews could not be read");
    // Work-runs okunamıyor: hiç satır yok, "boş" da denmez.
    r = await renderView(serve({"/v1/work-runs": () => fail("x", 404)}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["workRuns", "UNAVAILABLE"]]);
    expect(itemsOf(r.root).length).toBe(0);
    expect(byData(r.root, "readinessEmpty")!.dataset.readinessEmpty).toBe("unknown");
    expect(byData(r.root, "readinessEmpty")!.textContent).toContain("could not be read");
    expect(allData(r.root, "readinessEmpty", "1").length).toBe(0);
    for (const id of ["total", "ready"]) expect(kpiValue(r.root, id), id).toBe("—");
    // Kanıt bütünlüğü okunamıyor: kapı UNKNOWN, platform bloğu dürüst durum; READY olamaz.
    r = await renderView(serve({"/v1/cockpit": () => fail("x", 500)}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["evidence", "ERROR"]]);
    expect(byData(r.root, "integrity")!.dataset.integrity).toBe("ERROR");
    expect(byData(r.root, "integrity")!.dataset.integrityStatus).toBe("UNKNOWN");
    expect(byData(r.root, "field", "integrityCounts")).toBeUndefined();
    expect(kpiValue(r.root, "total")).toBe("—");
    for (const li of itemsOf(r.root)) expect(li.dataset.integrity).toBe("ERROR");
    // Mission başlıkları okunamıyor: değerlendirme TAMDIR (başlık yalnız süs); başlık uydurulmaz.
    r = await renderView(serve({"/v1/missions": () => fail("x", 500)}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["missions", "ERROR"]]);
    expect(kpiValue(r.root, "total")).toBe("3");
    expect(itemsOf(r.root).map(n => n.dataset.tier)).toEqual(["NOT_READY", "SOURCE_ONLY", "BLOCKED"]);
    expect(all(itemFor(r.root, RUN2)).find(n => n.tagName === "H4")!.textContent).toBe(RUN2);
    expect(field(itemFor(r.root, RUN2), "mission")!.textContent).toContain("title unavailable (mission list not read)");
    expect(byData(r.root, "readinessPartial")).toBeUndefined();
  });
  it("a mission missing from a readable mission list is stated as such (the title is never invented)", async () => {
    const {root} = await renderView(serve({"/v1/missions": {missions: [missionRow(MSN2, "Beta mission")]}}));
    expect(field(itemFor(root, RUN4), "mission")!.textContent).toContain("not in the mission list");
    expect(all(itemFor(root, RUN4)).find(n => n.tagName === "H4")!.textContent).toBe(RUN4);
    expect(all(itemFor(root, RUN2)).find(n => n.tagName === "H4")!.textContent).toBe("Beta mission");
  });
  it("when everything is unreadable no row and no figure is shown, and nothing is called ready or empty", async () => {
    for (const [fn, expected] of [[() => { throw new Error("fetch failed"); }, "OFFLINE"], [() => fail("x", 404), "UNAVAILABLE"], [() => fail("x", 500), "ERROR"], [() => ({nonsense: true}), "ERROR"]] as const) {
      const {root} = await renderView(fn);
      expect(itemsOf(root).length, expected).toBe(0);
      expect(allData(root, "readinessState").map(n => n.dataset.readinessState), expected).toEqual([expected, expected, expected, expected]);
      for (const id of ["total", "ready", "sourceOnly", "notReady", "blocked"]) { expect(kpiValue(root, id), id).toBe("—"); expect(kpi(root, id).dataset.state, id).toBe(expected); }
      expect(byData(root, "readinessEmpty")!.dataset.readinessEmpty).toBe("unknown");
      expect(allData(root, "overall").length).toBe(0);
    }
  });
  it("a malformed record rejects only its own source: no partial figures or partial rows from that source, the other sources stay readable", async () => {
    const badReview = (() => { const b: any = reviewsFor(RUNS.runs, DEFAULT_STATES); b.reviews[0] = {...b.reviews[0], verdict: "APPROVED"}; return b; })();
    let r = await renderView(serve({"/v1/reviews": badReview}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["reviews", "ERROR"]]);
    for (const li of itemsOf(r.root)) expect(li.dataset.review).toBe("ERROR");
    expect(kpiValue(r.root, "total")).toBe("—");
    r = await renderView(serve({"/v1/work-runs": {runs: [SOURCE_RUN(), runRow(RUN3, MSN3, {status: "DONE"})]}}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["workRuns", "ERROR"]]);
    expect(itemsOf(r.root).length).toBe(0); // tek bozuk koşu, sağlam koşuyu da göstermez (kısmi liste yok)
    r = await renderView(serve({"/v1/cockpit": cockpitBody({verified: 9})}));
    expect(allData(r.root, "readinessState").map(n => [n.dataset.source, n.dataset.readinessState])).toEqual([["evidence", "ERROR"]]);
    expect(itemsOf(r.root).length).toBe(3);
  });
  it("evidence integrity problems are shown as such: a mismatch is a failing gate, a non-live block is unknown with no numbers", async () => {
    let r = await renderView(serve({"/v1/cockpit": cockpitBody({verified: 7, mismatch: 2, missing: 1})}));
    expect(byData(r.root, "integrity")!.dataset).toMatchObject({integrity: "MISMATCH", integrityStatus: "FAIL"});
    expect(byData(r.root, "field", "integrityCounts")!.textContent).toBe("7 of 10 evidence records are hash-verified · 2 mismatch · 1 missing · 0 unverifiable.");
    expect(pills(byData(r.root, "integrity")!)).toEqual(["BLOCKED"]);
    for (const li of itemsOf(r.root)) { expect(li.dataset.integrity).toBe("MISMATCH"); expect(li.dataset.tier).not.toBe("SOURCE_ONLY"); }
    r = await renderView(serve({"/v1/cockpit": cockpitBody({state: "UNAVAILABLE", total: 5, verified: 5, mismatch: null, missing: null, unverifiable: null})}));
    expect(byData(r.root, "integrity")!.dataset).toMatchObject({integrity: "UNAVAILABLE", integrityStatus: "UNKNOWN"});
    expect(pills(byData(r.root, "integrity")!)).toEqual(["UNAVAILABLE"]);
    expect(byData(r.root, "field", "integrityCounts")).toBeUndefined();
    expect(r.root.textContent).not.toContain("5 of 5");
  });
  it("honest empty state: no work runs is a readable zero with explicit text (only when the work runs were READ)", async () => {
    const {root} = await renderView(serve({"/v1/work-runs": {runs: []}, "/v1/reviews": reviewsBody([])}));
    expect(itemsOf(root).length).toBe(0);
    expect(byData(root, "readinessEmpty", "1")!.textContent).toBe("No work runs have been recorded yet, so there is nothing to assess.");
    expect(kpiValue(root, "total")).toBe("0");
    expect(kpiValue(root, "ready")).toBe("0");
  });
  it("very long lists are truncated honestly (the first 200 shown, the real total stated)", async () => {
    const runs = Array.from({length: 205}, (_, i) => runRow("run_" + (i + 1).toString(16).padStart(24, "0"), MSN1, {evidence: [], headSha: null, status: "RUNNING", updatedAt: new Date(Date.UTC(2026, 9, 16, 0, 0, i)).toISOString()}));
    const {root} = await renderView(serve({"/v1/work-runs": {runs}, "/v1/reviews": reviewsFor(runs, Object.fromEntries(runs.map(r => [r.runId, "NOT_REVIEWED"])))}));
    expect(itemsOf(root).length).toBe(200);
    expect(allData(root, "readinessList").map(n => n.dataset.readinessList)).toEqual(["200"]);
    expect(byData(root, "note", "truncated")!.textContent).toBe("Showing the newest 200 of 205 runs.");
    expect(kpiValue(root, "total")).toBe("205");
    expect(itemsOf(root)[0].dataset.readinessItem).toBe(runs[204].runId);
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const m = {missions: [missionRow(MSN2, "<b>x</b>"), missionRow(MSN3, "g"), missionRow(MSN4, "d")]};
    const rv2: any = reviewsFor(RUNS.runs, DEFAULT_STATES);
    rv2.reviews = rv2.reviews.map((x: any) => x.runId === RUN2 ? {...x, reviewer: {identity: "<img src=x onerror=alert(1)>"}} : x);
    const {root} = await renderView(serve({"/v1/missions": m, "/v1/reviews": rv2}));
    expect(all(root).some(n => n.tagName === "IMG" || n.tagName === "B")).toBe(false);
    expect(root.textContent).toContain("<b>x</b>");
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root} = await renderView(serve(), "tr");
    expect(byId(root, "view-title")!.textContent).toBe("Kalite Kapısı ve Release Readiness");
    expect(kpiValue(root, "total")).toBe("3");
    expect(itemsOf(root).map(n => n.dataset.readinessItem)).toEqual([RUN4, RUN2, RUN3]);
    expect(byData(itemFor(root, RUN2), "overall")!.textContent).toContain("Yalnız kaynak · NOT_VERIFIED");
    expect(byData(itemFor(root, RUN3), "overall")!.textContent).toContain("Engellendi / reddedildi");
    expect(field(itemFor(root, RUN3), "review")!.textContent).toContain("reddetti");
    expect(byData(root, "honesty", "1")!.textContent).toContain("NOT_VERIFIED");
    expect(root.textContent).toContain("Neler eksik");
    expect(root.textContent).toContain("Yedi kapı");
  });
  it("navigation buttons only navigate to existing flows and never POST or fabricate a decision", async () => {
    const posts: unknown[][] = [];
    const view = await load("views", "readiness.js"), forms = await load("forms.js");
    const {ctx, nav, calls} = await mkCtx(serve(), "en", (p, b) => { posts.push([p, b]); return {status: 200, body: {}}; });
    const rootNode: N = await view.render(ctx);
    const buttons = all(rootNode).filter(n => n.tagName === "BUTTON");
    expect(buttons.length).toBe(6);
    expect(buttons.filter(n => n.dataset.navigate === "work").length).toBe(3);
    expect(buttons.filter(n => n.dataset.navigate === "assurance").length).toBe(3);
    for (const b of buttons) click(b);
    expect(nav.length).toBe(6);
    expect(new Set(nav)).toEqual(new Set(["work", "assurance"]));
    // Son tıklanan Work düğmesi son satırın mission'ını seçer (yeni sıra: RUN4, RUN2, RUN3 -> RUN3 / MSN3).
    expect(forms.selection.missionId).toBe(MSN3);
    expect(posts).toEqual([]);
    expect(calls.every(c => FOUR.includes(c))).toBe(true);
    expect(buttons.every(b => b.getAttribute("type") === "button")).toBe(true);
    expect(buttons.map(b => b.textContent).every(t => /^(Open mission in Work|Open Assurance)$/.test(t))).toBe(true);
    expect(all(rootNode).some(n => n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "FORM" || n.tagName === "SELECT")).toBe(false);
    expect(byData(rootNode, "note", "actions")!.textContent).toContain("Nothing is approved, delivered or released from this view.");
  });
});

// ---------------- (6) accessibility ----------------
describe("Readiness — accessibility", () => {
  it("single labelled h1, exactly two labelled sections, a labelled KPI group, a labelled list of runs, labelled missing lists and machine-readable times", async () => {
    const {root} = await renderView(serve());
    const h1 = all(root).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    expect(all(root).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["readiness-summary", "readiness-runs"]);
    for (const id of ["readiness-summary", "readiness-runs"]) expect(byId(root, byId(root, id)!.getAttribute("aria-labelledby")!), id).toBeTruthy();
    const group = all(root).find(n => n.getAttribute("role") === "group" && cls(n, "readiness-kpis"))!;
    expect(group.getAttribute("aria-label")).toBe("Release readiness figures");
    const tiles = allData(group, "kpi");
    expect(tiles.length).toBe(5);
    for (const t of tiles) {
      expect(t.tagName).toBe("ARTICLE");
      expect(byId(root, t.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
      expect(all(t).some(n => "pill" in n.dataset)).toBe(true);
    }
    const lists = all(root).filter(n => n.tagName === "OL");
    expect(lists.length).toBe(1);
    expect(lists[0].getAttribute("aria-label")).toBe("Work runs and their release readiness");
    expect(lists[0].children.every(c => c.tagName === "LI")).toBe(true);
    for (const li of itemsOf(root)) {
      expect(all(li).filter(n => n.tagName === "H4").length).toBe(1);
      const sub = all(li).filter(n => n.tagName === "H5");
      expect(sub.length).toBe(1);
      expect(sub[0].textContent).toBe("What is missing");
      const ul = all(li).find(n => n.tagName === "UL");
      if (ul) expect(ul.getAttribute("aria-labelledby")).toBe(sub[0].id);
      for (const t of all(li).filter(n => n.tagName === "TIME")) { expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(t.textContent.length).toBeGreaterThan(3); }
      const grp = all(li).find(n => n.getAttribute("role") === "group")!;
      expect(grp.getAttribute("aria-label")).toMatch(/^Actions for /);
      for (const b of all(grp).filter(n => n.tagName === "BUTTON")) { expect(b.textContent.length).toBeGreaterThan(0); expect(b.id).toMatch(/^rd-(open|assure)-[A-Za-z0-9_-]+$/); }
    }
    expect(byData(root, "gate")).toBeTruthy();
    for (const ul of all(root).filter(n => n.tagName === "UL" && cls(n, "company-sources"))) expect(ul.getAttribute("aria-label")).toBeTruthy();
    // Kimlikler benzersiz.
    const ids = all(root).map(n => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("definition lists are well-formed (dt/dd pairs, eleven per run) and every state pill carries text (state is never colour alone)", async () => {
    const {root} = await renderView(serve());
    const dls = all(root).filter(n => n.tagName === "DL");
    expect(dls.length).toBe(3);
    for (const dl of dls) {
      expect(dl.children.length).toBe(22);
      dl.children.forEach((c, i) => expect(c.tagName).toBe(i % 2 === 0 ? "DT" : "DD"));
    }
    for (const p of allData(root, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    for (const li of itemsOf(root)) expect(pills(li).length, li.dataset.readinessItem).toBeGreaterThanOrEqual(8);
  });
  it("failure blocks are status regions (role=status) with text, not colour alone", async () => {
    const {root} = await renderView(() => { throw new Error("fetch failed"); });
    const blocks = allData(root, "readinessState");
    expect(blocks.length).toBe(4);
    for (const b of blocks) { expect(b.getAttribute("role")).toBe("status"); expect(b.textContent).toContain("Offline"); expect(pills(b)).toContain("OFFLINE"); }
    expect(byData(root, "readinessEmpty")!.getAttribute("role")).toBe("status");
    expect(byData(root, "readinessPartial")!.getAttribute("role")).toBe("status");
  });
  it("styles.css has container-query, forced-colors and focus coverage for the readiness components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("Kalite Kapısı ve Release Readiness: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.readiness-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    // Anlam renkle taşınmaz: hazırlık rengi yalnız sol kenar vurgusudur; metin/rozet her kartta vardır.
    expect(mine).toMatch(/\.readiness-item\[data-tier="BLOCKED"\]\{border-left-color:var\(--danger\)\}/);
    expect(mine).toMatch(/\.readiness-item\[data-tier="READY"\]\{border-left-color:var\(--ok\)\}/);
    for (const v of mine.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(css, v).toContain(`${v.slice(4, -1)}:`);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (7) locale parity ----------------
describe("Readiness — locale parity and key coverage", () => {
  it("every readiness.* / area.readiness.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("readiness.") || k.startsWith("area.readiness.")).sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(100);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.readiness.title"]).toBe("Kalite Kapısı ve Release Readiness");
    expect(en["area.readiness.title"]).toBe("Quality Gate & Release Readiness");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
  });
  it("every literal and enumerated key used by readiness.js exists in both dictionaries, and no readiness key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("readiness-core.js");
    const src = read("views", "readiness.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|emptyNote\(ctx,)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"((?:readiness|area\.readiness)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.READINESS_SOURCES) { need.add(`readiness.src.${k}`); need.add(`readiness.srcShort.${k}`); }
    for (const k of ["OFFLINE", "UNAVAILABLE", "ERROR"]) { need.add(`readiness.state.${k}`); need.add(`readiness.hint.${k}`); need.add(`readiness.detail.UNKNOWN.${k}`); }
    for (const k of ["total", "ready", "sourceOnly", "notReady", "blocked"]) { need.add(`readiness.kpi.${k}`); need.add(`readiness.kpi.q.${k}`); }
    for (const g of core.GATES) need.add(`readiness.gate.${g}`);
    for (const [g, ds] of Object.entries(core.GATE_DETAILS) as Array<[string, string[]]>) for (const d of ds) need.add(`readiness.detail.${g}.${d}`);
    for (const t of core.TIERS) { need.add(`readiness.tier.${t}`); need.add(`readiness.tierDesc.${t}`); }
    for (const k of ["yes", "no", "unknown"]) need.add(`readiness.review.independent.${k}`);
    need.add("area.readiness.title"); need.add("area.readiness.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(100);
    // Sözlükte ölü anahtar kalmaz: her readiness.* anahtarı görünümde/çekirdekte kullanılır.
    expect(Object.keys(en).filter(k => (k.startsWith("readiness.") || k.startsWith("area.readiness.")) && !need.has(k))).toEqual([]);
    // Core sabitleri sunucu sözleşmesiyle uyumlu.
    expect(core.UNKNOWN_DETAILS).toEqual(["OFFLINE", "UNAVAILABLE", "ERROR"]);
    expect(core.GATE_DETAILS.review).toEqual(expect.arrayContaining(core.REVIEW_STATES));
  });
});

// ---------------- (8) routing ----------------
describe("Readiness — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/readiness to the planned host with component 'readiness' (no plannedPackage), after queue and before settings, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("readiness");
    expect(r).toMatchObject({id: "readiness", hash: "#/readiness", view: "planned", component: "readiness", factory: false, icon: "check"});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/readiness")).toBe("readiness");
    expect(routes.routeFromHash("#/readiness/")).toBe("readiness");
    expect(routes.routeFromHash("#/readinesss")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/Readiness")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-15)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "install", "audit", "domains", "integrations", "scheduler", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("readiness");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    // Eski rotalar etkilenmez.
    for (const id of ["queue", "executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
  });
  it("planned.js delegates the 'readiness' component to the real view; app.js VIEWS table has no readiness entry and is untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as readiness from "./readiness.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*readiness[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("readiness.js");
    expect(app).not.toMatch(/\breadiness\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const rootNode: N = await planned.render(ctx, {id: "readiness", component: "readiness"});
    expect(cls(rootNode, "view-readiness")).toBe(true);
    expect(byId(rootNode, "view-title")!.textContent).toBe("Quality Gate & Release Readiness");
    // Mevcut devredilen rotalar etkilenmez.
    const e = await planned.render((await mkCtx(serve({"/v1/cockpit": {nonsense: 1}}))).ctx, {id: "executive", component: "executive"});
    expect(cls(e, "view-executive")).toBe(true);
    const q = await planned.render((await mkCtx(serve())).ctx, {id: "queue", component: "queue"});
    expect(cls(q, "view-queue")).toBe(true);
    const j = await planned.render((await mkCtx(serve())).ctx, {id: "journey", component: "journey"});
    expect(cls(j, "view-journey")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.readiness.title")).toBe("Kalite Kapısı ve Release Readiness");
    expect(i18n.translate("en", "area.readiness.desc")).toContain("Read-only.");
  });
});
