// //TR: Bu test FA-V2-PRODUCT UI-071 "Operasyon ve Kurtarma" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek tohumlanmış çalışma zamanından (gerçek global stop dosyası, gerçek RunLedger koşu dizinleri, gerçek zamanlayıcı durumu + engelli paketler, yeniden deneme kaydı, checkpoint, gerçek Work OS günlüğü) dönen GET /v1/control/status + /v1/runs + /v1/founder-attention gövdeleri saf eşleyicilerden (operations-core.js) ve görünümden (views/operations.js) geçer. (2) İZİN LİSTESİ — üç GET zaten izinlidir (main.mjs/server.ts/app.js/control-boundary.mjs DEĞİŞMEZ, EXTRA_GET_ROUTES büyümez, yeni uç nokta ve yeni POST yok), görünüm yalnız bu üç GET'i okur; mevcut Stop/Resume/Retry denetimlerini YENİDEN UYGULAMAZ ve tetiklemez. (3) SAF EŞLEYİCİLER — bozuk kimlik/enum/zaman damgası/çelişkili alan TÜM okumayı ERROR yapar, durumlar yükseltilmez, boş neden gerçek bir stop'u gizlemez. (4) TÜRETİM — "takıldı" yalnız gerçek zaman damgasından ve belgelenmiş eşiklerden türer; genel durum (NO_ISSUES_RECORDED) YALNIZ gerçek kanıtla verilir: tek bir kırık koşul bile onu engeller; okunamayan kaynağın sayıları null'dır (0 değil). (5) GÖRÜNÜM — dürüst boş/OFFLINE/UNAVAILABLE/ERROR durumları, kurtarma kontrol listesi gerçek durumu yansıtır, ürün doğrulama sabiti hiçbir yerde üretilmez, API metni HTML değil metin olarak render edilir. (6) ERİŞİLEBİLİRLİK, TR/EN sözlük eşitliği ve rota devri (app.js VIEWS değişmez).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const lib = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(root, "automation", "lib", ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (posture/readiness/queue testleri ile aynı desen) ----------------
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
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `ops-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const stepsOf = (r: N) => allData(r, "step").filter(n => n.tagName === "LI");
const stepIds = (r: N) => stepsOf(r).map(n => n.dataset.step);
const stepFor = (r: N, id: string) => stepsOf(r).find(n => n.dataset.step === id)!;
const overallOf = (r: N) => byData(r, "overall")!;
const controlOf = (r: N, id: string) => allData(r, "control").find(n => n.tagName === "LI" && n.dataset.control === id)!;
const runItems = (r: N) => allData(r, "opsRun").filter(n => n.tagName === "LI");
const runFor = (r: N, id: string) => runItems(r).find(n => n.dataset.opsRun === id)!;
const blockedItems = (r: N) => allData(r, "opsBlockedItem").filter(n => n.tagName === "LI");
const field = (li: N, key: string) => allData(li, "field").find(n => n.dataset.field === key);
const sourcesOf = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const click = (n: N) => { const fns = n.ls.get("click"); expect(fns, "click listener").toBeTruthy(); fns!.forEach(f => f({})); };

// ---------------- fixtures (sözleşme biçiminde) ----------------
const H = 3_600_000, MIN = 60_000;
const NOW = Date.parse("2026-10-17T12:00:00.000Z");
let ANCHOR = NOW; // gerçek-sunucu testlerinde gerçek şimdiye taşınır; saf testlerde sabittir
const ago = (ms: number) => new Date(ANCHOR - ms).toISOString();
const RID = (n: string) => `RUN-20261016080000-aa${n}`;
const finishedRun = (id: string, status = "COMPLETE", startedAgo = 3 * H, over: Record<string, any> = {}) => ({runId: id, summary: {runId: id, status, finishedAt: ago(startedAgo - H), packageId: "PKG-001", ...over}, manifest: {runId: id, startedAt: ago(startedAgo), status: "RUNNING", mode: "FULL_AUTO"}});
const openRun = (id: string, age: number | null, over: Record<string, any> = {}) => ({runId: id, summary: null, manifest: {runId: id, startedAt: age === null ? undefined : ago(age), status: "RUNNING", mode: "FULL_AUTO", ...over}});
const runsBody = (rows: any[]) => ({count: rows.length, runs: rows});
const ctlBody = (over: Record<string, any> = {}) => ({globalStop: {active: false}, workos: {state: "OK", reason: null, tornTail: null}, ...over});
const blockedRow = (over: Record<string, any> = {}) => ({phase: 7, reason: "Quota exhausted", kind: "QUOTA_EXHAUSTED", at: ago(3 * H), retryable: true, ...over});
const KINDS = ["NETWORK_FAILURE", "QUOTA_EXHAUSTED", "RATE_LIMIT", "TIMEOUT"];
const attBody = (over: Record<string, any> = {}) => ({blocked: [], retryableKinds: KINDS, schedulerVerification: "VERIFIED", checkpoint: null, retry: null, ...over});
const retryRec = (retryAt: string, over: Record<string, any> = {}) => ({packageId: "PKG-012", phaseIds: [7], reason: "RATE_LIMIT", retryAfterSeconds: 600, retryAt, updatedAt: ago(2 * H), ...over});
const checkpointRec = (updatedAt: string, over: Record<string, any> = {}) => ({schemaVersion: "1.1.0", generation: 3, updatedAt, state: {stage: "IMPLEMENT"}, previousDigest: null, digest: "d".repeat(64), ...over});
const OK_RUNS = [finishedRun(RID("01"))];
const fail = (msg: string) => new Error(msg);
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/control/status": ctlBody(), "/v1/runs": runsBody(OK_RUNS), "/v1/founder-attention": attBody(), ...over};
  if (!(p in m)) throw new Error(`${p}: HTTP 404`);
  const v = m[p];
  if (v instanceof Error) throw v;
  return v;
};
const THREE = ["/v1/control/status", "/v1/runs", "/v1/founder-attention"];
const KEYS: Record<string, string> = {control: "/v1/control/status", runs: "/v1/runs", attention: "/v1/founder-attention"};

async function mkCtx(getFn: (p: string) => any, lang = "en", now: number | null = NOW) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [], posts: string[] = [];
  // Köprü: yazma/denetim çağrıları ASLA beklenmez; gelirse kaydedilir ve test başarısız olur.
  const bridge: Record<string, unknown> = {
    apiGet: async (p: string) => { calls.push(p); return getFn(p); },
    apiPost: async (p: string) => { posts.push(`apiPost ${p}`); throw new Error("POST must never be called"); },
    stop: async () => { posts.push("stop"); }, resume: async () => { posts.push("resume"); }, retryBlocked: async () => { posts.push("retryBlocked"); }
  };
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { nav.push(id); }, rerender: async () => {}, settleFocus: () => {},
    stop: async () => { posts.push("ctx.stop"); }, resume: async () => { posts.push("ctx.resume"); }, requestStop: () => { posts.push("ctx.requestStop"); }};
  if (now !== null) ctx.now = () => now;
  return {ctx, doc, calls, nav, posts};
}
async function renderView(getFn: (p: string) => any, lang = "en", now: number | null = NOW) {
  const view = await load("views", "operations.js");
  const m = await mkCtx(getFn, lang, now);
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, ...m};
}
/** Üç okumayı gerçek eşleyicilerden geçirip durumu üretir. */
async function assess(over: Record<string, any> = {}, now = NOW) {
  const core = await load("operations-core.js");
  const m = await mkCtx(serve(over));
  const res = {control: await m.ctx.api.operationsControl(), runs: await m.ctx.api.operationsRuns(), attention: await m.ctx.api.operationsAttention()};
  return {core, res, out: core.buildOperations(res, now)};
}
/** "Sorunsuz" görünmemesi gereken her durumda: genel göstergede olumlu ifade, başarı rozeti ve NO_ISSUES_RECORDED işareti yoktur. */
function expectNotClear(r: N, label: string) {
  const o = overallOf(r);
  expect(o.dataset.overall, label).not.toBe("NO_ISSUES_RECORDED");
  expect(allData(r, "overall", "NO_ISSUES_RECORDED").length, label).toBe(0);
  expect(o.textContent, label).not.toMatch(/no issues|healthy|all[- ]clear|\bfine\b|\bok\b/i);
  expect(pills(o), label).not.toContain("DONE");
  expect(pills(o), label).not.toContain("VERIFIED");
  expect(allData(r, "opsEmpty", "clear").length, label).toBe(0);
  expect(r.textContent, label).not.toContain("No recovery steps are recorded as needed");
  expect(surface(r), label).not.toContain(FORBIDDEN);
}

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ops-")); ANCHOR = NOW; });
afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } ANCHOR = NOW; });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(): App {
  fs.mkdirSync(runtime(), {recursive: true});
  // repoRoot geçici dizindir: gerçek depoyu taramaz. Zamanlayıcı paket tanımı çalışma dizinindeki roadmap'ten okunur.
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), repoRoot: tmp, dataDir: dataDir(), tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };
const realGet = (app: App) => async (p: string) => getJson(app, p);
async function realRaw(app: App) { return {control: await getJson(app, KEYS.control), runs: await getJson(app, KEYS.runs), attention: await getJson(app, KEYS.attention)}; }
async function realAssess(app: App, now: number) {
  const core = await load("operations-core.js");
  const raw = await realRaw(app);
  const res = {control: core.mapOperationsControl(raw.control), runs: core.mapOperationsRuns(raw.runs), attention: core.mapOperationsAttention(raw.attention)};
  return {core, raw, res, out: core.buildOperations(res, now)};
}
/** Gerçek RunLedger ile koşu dizinleri (gerçek manifest + Ed25519 imzalı özet); status null ise özet yazılmaz (bitmemiş koşu). */
async function seedRuns(rows: Array<{id: string; startedAgo: number; status: string | null; finishedAgo?: number; extra?: Record<string, any>}>) {
  const {RunLedger} = await lib("run-ledger.mjs"), {buildRunManifest} = await lib("runtime-contracts.mjs");
  const keyFile = path.join(tmp, "signing.pem");
  fs.writeFileSync(keyFile, crypto.generateKeyPairSync("ed25519").privateKey.export({type: "pkcs8", format: "pem"}));
  for (const r of rows) {
    const led = new RunLedger(path.join(runtime(), "runs"), r.id, {signingKeyFile: keyFile});
    led.event("supervisor", "RUN_STARTED", {});
    led.writeManifest(buildRunManifest({runId: r.id, startedAt: ago(r.startedAgo), baseCommit: "a".repeat(40), mode: "FULL_AUTO", executionUnit: "PACKAGE", builder: {provider: "p", modelId: "m"}, reviewer: {provider: "p", modelId: "m"}, remoteConfigured: false, remoteUrl: null, status: "RUNNING"}));
    if (r.status !== null) led.writeSummary({status: r.status, finishedAt: ago(r.finishedAgo ?? 0), ...(r.extra ?? {})});
  }
}
/** Gerçek zamanlayıcı durumu (149 faz şablonu) + gerçek engelli kayıtlar; saveSchedulerState durumu doğrular. */
async function seedScheduler(blocked: Array<{phase: number; kind: string; reason: string; agoMs: number}> = []) {
  const sched = await lib("scheduler.mjs");
  const state = JSON.parse(fs.readFileSync(path.join(root, "roadmap", "scheduler-state.template.json"), "utf8"));
  for (const b of blocked) sched.markBlocked(state, b.phase, b.reason, b.kind);
  state.blocked = state.blocked.map((x: any) => ({...x, at: ago(blocked.find(b => b.phase === x.phase)!.agoMs)}));
  sched.saveSchedulerState(path.join(runtime(), "scheduler-state.json"), state);
}
const seedJson = async (name: string, value: unknown) => (await lib("atomic-json.mjs")).writeJsonAtomic(path.join(runtime(), name), value);
function seedJournal() {
  // Gerçek Work OS günlüğü (hash-zincirli): journalHealth OK olur.
  const store = new WorkOsStore(dataDir());
  store.createProject({tenantId: "tA", orgId: "org1", name: "Ops", environmentId: "env-dev", createdBy: "implementer@local.invalid"});
}

describe("Operations — GENUINE control-api read-models flow through mappers, derivation and view", () => {
  it("a fresh real runtime has no evidence: journal ABSENT, scheduler PENDING, no runs — the state is UNVERIFIED and never 'no issues recorded'", { timeout: 30_000 }, async () => {
    ANCHOR = Date.now();
    const app = mkApp();
    const {raw, res, out} = await realAssess(app, ANCHOR + 10 * MIN);
    expect(raw.control).toMatchObject({globalStop: {active: false}, workos: {state: "ABSENT"}});
    expect(raw.runs).toEqual({count: 0, runs: []});
    expect(raw.attention).toMatchObject({blocked: [], schedulerVerification: "PENDING"});
    for (const r of Object.values(res) as any[]) expect(r.state).toBe("VERIFIED");
    expect(out.tier).toBe("UNVERIFIED");
    expect(out.steps.map((s: any) => s.id).sort()).toEqual(["JOURNAL_ABSENT", "NO_RUNS_RECORDED", "SCHEDULER_NOT_VERIFIED"]);
    expect(out.runs).toMatchObject({total: 0, stalled: 0});
    const {root: r, posts} = await renderView(realGet(app), "en", ANCHOR + 10 * MIN);
    expect(overallOf(r).dataset.overall).toBe("UNVERIFIED");
    expectNotClear(r, "fresh");
    expect(stepIds(r).sort()).toEqual(["JOURNAL_ABSENT", "NO_RUNS_RECORDED", "SCHEDULER_NOT_VERIFIED"]);
    // Gerçek sıfır: sayılar OKUNDU ve sıfırdır (gizli değil); engelli paket listesi "kanıt değil" notunu taşır.
    expect(kpiValue(r, "runs")).toBe("0");
    expect(byData(r, "opsEmpty", "unverified")).toBeTruthy();
    expect(posts).toEqual([]);
  });

  it("real seeded runtime: an active global stop, real run directories, a real scheduler with blocked phases, a retry record and a checkpoint — each is carried and flagged from its REAL record", { timeout: 30_000 }, async () => {
    ANCHOR = Date.now();
    const now = ANCHOR + 10 * MIN;
    const gs = await lib("global-stop.mjs");
    gs.activateGlobalStop(path.join(runtime(), "GLOBAL_STOP.json"), "Founder requested from the ops test", "FOUNDER_CONTROL_TOWER");
    await seedRuns([
      {id: RID("a1"), startedAgo: 30 * H, status: "COMPLETE", finishedAgo: 29 * H},
      {id: RID("b2"), startedAgo: 20 * H, status: null},
      {id: RID("c3"), startedAgo: 5 * H, status: "FOUNDER_ATTENTION_REQUIRED", finishedAgo: 4 * H, extra: {packageId: "PKG-007"}},
      {id: RID("d4"), startedAgo: 1 * H, status: null}
    ]);
    await seedScheduler([{phase: 7, kind: "QUOTA_EXHAUSTED", reason: "Quota exhausted", agoMs: 3 * H}, {phase: 9, kind: "FOUNDER_ATTENTION", reason: "Review blocked", agoMs: 26 * H}]);
    await seedJson("SUPERVISOR_RETRY.json", retryRec(new Date(now + H).toISOString()));
    await seedJson("supervisor-checkpoint.json", checkpointRec(new Date(now - H).toISOString()));
    const app = mkApp();
    const {raw, res, out} = await realAssess(app, now);
    expect(raw.control.globalStop).toMatchObject({active: true, reason: "Founder requested from the ops test", actor: "FOUNDER_CONTROL_TOWER"});
    expect(raw.runs.count).toBe(4);
    expect(raw.attention.blocked.map((b: any) => [b.phase, b.kind, b.retryable])).toEqual([[7, "QUOTA_EXHAUSTED", true], [9, "FOUNDER_ATTENTION", false]]);
    for (const r of Object.values(res) as any[]) expect(r.state).toBe("VERIFIED");
    // Gerçek imzalı özetler: bitenler FINISHED, özetsiz iki koşu kayıtlı başlangıçtan sınıflanır (20 sa -> STALLED, 1 sa -> IN_PROGRESS).
    const byId = Object.fromEntries(out.runs.items.map((x: any) => [x.runId, x]));
    expect(byId[RID("a1")]).toMatchObject({status: "COMPLETE", statusBasis: "SUMMARY", liveness: "FINISHED", group: "FINISHED"});
    expect(byId[RID("c3")]).toMatchObject({status: "FOUNDER_ATTENTION_REQUIRED", liveness: "FINISHED", group: "ATTENTION", packageId: "PKG-007"});
    expect(byId[RID("b2")]).toMatchObject({status: "RUNNING", statusBasis: "MANIFEST", liveness: "STALLED", group: "RUNNING"});
    expect(byId[RID("d4")]).toMatchObject({liveness: "IN_PROGRESS"});
    expect(byId[RID("b2")].ageMs).toBeGreaterThan(19.9 * H);
    expect(out.runs).toMatchObject({total: 4, inProgress: 1, stalled: 1, undetermined: 0});
    expect(out.runs.latest.runId).toBe(RID("d4"));
    expect(out.queue).toMatchObject({total: 2, retryable: 1, retryUsable: 0, notRetryable: 1, schedulerVerification: "VERIFIED"});
    expect(out.queue.retry).toMatchObject({packageId: "PKG-012", phase: "WAITING"});
    expect(out.queue.checkpoint).toMatchObject({generation: 3, stale: false});
    expect(out.control).toMatchObject({active: true, failClosed: false, reason: "Founder requested from the ops test", journal: {state: "ABSENT"}});
    expect(out.tier).toBe("ATTENTION_NEEDED");
    // Kontrol listesi: önce eylem gerektirenler, sonra doğrulanmayanlar, en sonda izlenecekler; gerçek duruma göre başka adım YOK.
    expect(out.steps.map((s: any) => `${s.severity}:${s.id}`)).toEqual(["ACTION:STOP_ACTIVE", "ACTION:BLOCKED_PACKAGE", "ACTION:BLOCKED_PACKAGE", "ACTION:RUN_STALLED", "UNVERIFIED:JOURNAL_ABSENT", "WATCH:RETRY_WAITING", "WATCH:RUN_IN_PROGRESS"]);
    const {root: r, posts, nav} = await renderView(realGet(app), "en", now);
    expect(overallOf(r).dataset.overall).toBe("ATTENTION_NEEDED");
    expectNotClear(r, "seeded");
    expect(stepIds(r)).toEqual(["STOP_ACTIVE", "BLOCKED_PACKAGE", "BLOCKED_PACKAGE", "RUN_STALLED", "JOURNAL_ABSENT", "RETRY_WAITING", "RUN_IN_PROGRESS"]);
    expect(stepFor(r, "STOP_ACTIVE").textContent).toContain("Founder requested from the ops test");
    expect(stepFor(r, "RUN_STALLED").textContent).toContain(RID("b2"));
    expect([kpiValue(r, "runs"), kpiValue(r, "inProgress"), kpiValue(r, "stalled"), kpiValue(r, "blocked"), kpiValue(r, "retryable")]).toEqual(["4", "1", "1", "2", "1"]);
    // Mevcut denetimlerin dürüst durumu: stop aktif -> Resume ilgili; 1 engelli tür yeniden denenebilir ama gerçek satırda PKG-NNN kimliği yok.
    expect(controlOf(r, "stop").dataset.controlState).toBe("active");
    expect(controlOf(r, "resume").dataset.controlState).toBe("relevant");
    expect(controlOf(r, "retry").dataset.controlState).toBe("someNoId");
    expect(blockedItems(r).map(n => [n.dataset.opsBlockedItem, n.dataset.retryable])).toEqual([["|7", "yes"], ["|9", "no"]]);
    expect(runFor(r, RID("b2")).dataset.liveness).toBe("STALLED");
    expect(runFor(r, RID("c3")).dataset.group).toBe("ATTENTION");
    // Görünüm hiçbir denetimi çağırmadı.
    expect(posts).toEqual([]); expect(nav).toEqual([]);
  });

  it("lifting the real stop removes only the stop step; remaining blocked packages and the stalled run keep the state at 'attention needed'", { timeout: 30_000 }, async () => {
    ANCHOR = Date.now();
    const now = ANCHOR + 10 * MIN;
    const gs = await lib("global-stop.mjs"), file = path.join(runtime(), "GLOBAL_STOP.json");
    gs.activateGlobalStop(file, "temporary", "FOUNDER_CONTROL_TOWER");
    await seedRuns([{id: RID("a1"), startedAgo: 10 * H, status: null}]);
    await seedScheduler([{phase: 3, kind: "TIMEOUT", reason: "Timed out", agoMs: 2 * H}]);
    const app = mkApp();
    expect((await realAssess(app, now)).out.steps.map((s: any) => s.id)).toEqual(["STOP_ACTIVE", "BLOCKED_PACKAGE", "RUN_STALLED", "JOURNAL_ABSENT"]);
    gs.clearGlobalStop(file);
    const after = (await realAssess(app, now)).out;
    expect(after.control.active).toBe(false);
    expect(after.steps.map((s: any) => s.id)).toEqual(["BLOCKED_PACKAGE", "RUN_STALLED", "JOURNAL_ABSENT"]);
    expect(after.tier).toBe("ATTENTION_NEEDED");
    const {root: r} = await renderView(realGet(app), "en", now);
    expect(controlOf(r, "stop").dataset.controlState).toBe("inactive");
    expect(controlOf(r, "resume").dataset.controlState).toBe("notNeeded");
    expectNotClear(r, "after-resume");
  });

  it("a real unsafe stop file is reported fail-closed (REJECTED verification) and a real overdue retry record / stale checkpoint are flagged from their real timestamps", { timeout: 30_000 }, async () => {
    ANCHOR = Date.now();
    const now = ANCHOR + 10 * MIN;
    fs.mkdirSync(runtime(), {recursive: true});
    fs.writeFileSync(path.join(runtime(), "GLOBAL_STOP.json"), "{ this is not json", "utf8"); // gerçek bozuk stop dosyası
    await seedJson("SUPERVISOR_RETRY.json", retryRec(ago(2 * H)));
    await seedJson("supervisor-checkpoint.json", checkpointRec(ago(9 * H), {generation: 5}));
    await seedScheduler([]);
    const app = mkApp();
    const {raw, out} = await realAssess(app, now);
    expect(raw.control.globalStop).toMatchObject({active: true, reason: "GLOBAL_STOP_STATE_INVALID_FAIL_CLOSED"});
    expect(out.control).toMatchObject({active: true, failClosed: true});
    expect(out.queue.retry).toMatchObject({phase: "OVERDUE", packageId: "PKG-012"});
    expect(out.queue.checkpoint).toMatchObject({generation: 5, stale: true});
    expect(out.steps.map((s: any) => s.id)).toEqual(["STOP_FAIL_CLOSED", "RETRY_OVERDUE", "CHECKPOINT_STALE", "JOURNAL_ABSENT", "NO_RUNS_RECORDED"]);
    expect(out.tier).toBe("ATTENTION_NEEDED");
    const {root: r} = await renderView(realGet(app), "en", now);
    expect(field(controlOf(r, "stop"), "where")).toBeTruthy();
    expect(allData(r, "field", "stop")[0].dataset.value).toBe("failClosed");
    expect(allData(r, "field", "retry")[0].dataset.value).toBe("OVERDUE");
    expect(allData(r, "field", "checkpoint")[0].dataset.value).toBe("stale");
  });

  it("POSITIVE CONTROL: only with a real OK journal, a verified scheduler, an inactive stop and a recorded finished run does the real runtime show 'no issues recorded' — and one real change takes it away again", { timeout: 30_000 }, async () => {
    ANCHOR = Date.now();
    const now = ANCHOR + 10 * MIN;
    seedJournal();
    await seedScheduler([]);
    await seedRuns([{id: RID("a1"), startedAgo: 6 * H, status: "COMPLETE", finishedAgo: 5 * H}]);
    const app = mkApp();
    const {raw, out} = await realAssess(app, now);
    expect(raw.control.workos.state).toBe("OK");
    expect(raw.attention.schedulerVerification).toBe("VERIFIED");
    expect(out.steps).toEqual([]);
    expect(out.tier).toBe("NO_ISSUES_RECORDED");
    const {root: r} = await renderView(realGet(app), "en", now);
    expect(overallOf(r).dataset.overall).toBe("NO_ISSUES_RECORDED");
    expect(pills(overallOf(r))).toContain("DONE");
    expect(overallOf(r).textContent).toContain("No issues recorded");
    expect(byData(r, "opsEmpty", "clear")).toBeTruthy();
    expect(stepsOf(r).length).toBe(0);
    expect(surface(r)).not.toContain(FORBIDDEN);
    // Aynı gerçek çalışma zamanında tek bir gerçek değişiklik (global stop) durumu hemen geri alır.
    const gs = await lib("global-stop.mjs");
    gs.activateGlobalStop(path.join(runtime(), "GLOBAL_STOP.json"), "again", "FOUNDER_CONTROL_TOWER");
    const {root: r2} = await renderView(realGet(app), "en", now);
    expect(overallOf(r2).dataset.overall).toBe("ATTENTION_NEEDED");
    expectNotClear(r2, "stopped-again");
  });
});

// ---------------- (2) allow-list: nothing new, nothing written ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Operations — only already-allow-listed read-only GETs are used (protected files unchanged, no new control path)", () => {
  it("all three GET paths are already admitted by the desktop allow-list; nothing new is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    for (const p of THREE) expect(allowed(p), p).toBe(true);
    // Üçü de temel (control-boundary) izin listesindedir; EXTRA kümesine hiçbiri eklenmedi.
    for (const p of THREE) expect(boundary.desktopGetPathAllowed(p), p).toBe(true);
    for (const p of ["/v1/operations", "/v1/recovery", "/v1/ops", "/v1/control", "/v1/control/stop", "/v1/control/resume", "/v1/runs/", "/v1/runs?x=1", "/v1/control/status?x=1", "/v1/founder-attention?x=1"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    for (const p of THREE) expect(set.includes(p), p).toBe(false);
    for (const f of [mainSrc, fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8"), fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")]) {
      expect(f).not.toContain("/v1/operations");
      expect(f).not.toContain("/v1/recovery");
    }
    // Mevcut IPC denetimleri (stop/resume/retry-blocked) main.mjs'te olduğu gibi durur; yeni IPC kanalı eklenmedi.
    expect([...mainSrc.matchAll(/ipcMain\.handle\("(uasco:[a-z-]+)"/g)].map(m => m[1]).filter(s => /stop|resume|retry/.test(s))).toEqual(["uasco:stop", "uasco:resume", "uasco:retry-blocked"]);
    expect(mainSrc).not.toMatch(/uasco:operations|uasco:recover/);
  });
  it("operations.js / operations-core.js never write and never reach outside ctx.api: no post, bridge, stop/resume/retry invocation, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "operations.js"), read("operations-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toMatch(/ctx\.stop\b|ctx\.resume\b|requestStop|retryBlocked|\.stop\(|\.resume\(|uasco:|confirm\(/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions/);
    }
    const imports = [...read("views", "operations.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort();
    expect(imports).toEqual(["../components.js", "../model.js", "../operations-core.js", "../work-core.js"]);
    expect([...read("operations-core.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort()).toEqual(["./queue-core.js"]);
    for (const m of ["operationsControl", "operationsRuns", "operationsAttention"]) expect(read("views", "operations.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur (yeni POST yolu eklenmez); operasyon erişimcileri yalnız sabit GET yollarını okur.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const accessors = read("api.js").split(String.fromCharCode(10)).filter(l => /^\s*async operations(Control|Runs|Attention)\(\)/.test(l));
    expect(accessors.length).toBe(3);
    for (const l of accessors) { expect(l).not.toMatch(/post\(|apiPost|force/); expect(l).toMatch(/await get\((CONTROL|RUNS|ATTENTION)_PATH\)/); }
  });
  it("the api layer requests exactly the three fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls, posts} = await mkCtx(serve());
    const core = await load("operations-core.js");
    expect(core.OPS_SOURCE_PATHS).toEqual({control: "/v1/control/status", runs: "/v1/runs", attention: "/v1/founder-attention"});
    expect(core.OPS_SOURCES).toEqual(["control", "runs", "attention"]);
    expect((await ctx.api.operationsControl()).state).toBe("VERIFIED");
    expect((await ctx.api.operationsRuns()).state).toBe("VERIFIED");
    expect((await ctx.api.operationsAttention()).state).toBe("VERIFIED");
    expect(calls).toEqual(THREE);
    for (const m of ["operationsControl", "operationsRuns", "operationsAttention"]) expect(ctx.api[m].length).toBe(0);
    expect(posts).toEqual([]);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    const ms = ["operationsControl", "operationsRuns", "operationsAttention"];
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ms) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    for (const m of ms) expect((await ctx.api[m]()).state, m).toBe("ERROR");
  });
  it("a render never invokes any stop / resume / retry / POST path, even when its buttons are pressed", async () => {
    const r = await renderView(serve({"/v1/control/status": ctlBody({globalStop: {active: true, reason: "r", actor: "a", activatedAt: ago(H)}}), "/v1/founder-attention": attBody({blocked: [blockedRow({packageId: "PKG-005"})]})}));
    const buttons = all(r.root).filter(n => n.tagName === "BUTTON");
    expect(buttons.map(b => b.id)).toEqual(["ops-open-tower", "ops-open-inbox"]);
    buttons.forEach(click);
    expect(r.nav).toEqual(["tower", "inbox"]);
    expect(r.posts).toEqual([]);
    expect(r.calls).toEqual(THREE);
  });
});

// ---------------- (3) pure mappers ----------------
describe("Operations — pure mappers are fail-closed and never elevate state", () => {
  it("mapOperationsControl carries the recorded stop verbatim; an empty reason can never hide an active stop; an inactive stop carries no stale text", async () => {
    const core = await load("operations-core.js");
    expect(core.mapOperationsControl(ctlBody())).toEqual({state: "VERIFIED", control: {active: false, reason: null, actor: null, activatedAt: null, verification: null, journal: {state: "OK", reason: null}}});
    expect(core.mapOperationsControl(ctlBody({globalStop: {active: false, reason: "stale text", actor: "OLD", activatedAt: ago(H)}})).control).toMatchObject({active: false, reason: null, actor: null, activatedAt: null});
    expect(core.mapOperationsControl(ctlBody({globalStop: {active: true, reason: "Founder stop", actor: "FOUNDER", activatedAt: ago(H), "//TR": "x"}})).control).toMatchObject({active: true, reason: "Founder stop", actor: "FOUNDER", activatedAt: ago(H)});
    for (const reason of ["", undefined, null]) expect(core.mapOperationsControl(ctlBody({globalStop: {active: true, reason}})), String(reason)).toEqual({state: "VERIFIED", control: expect.objectContaining({active: true, reason: null})});
    expect(core.mapOperationsControl({globalStop: {active: true}}).control.journal).toBeNull(); // workos yok -> raporlanmadı, tahmin edilmez
    expect(core.mapOperationsControl(ctlBody({globalStop: {active: true, reason: "x".repeat(2000)}})).control.reason.length).toBe(1000);
    for (const [state, extra] of [["OK", {}], ["ABSENT", {}], ["TAMPERED", {reason: "BROKEN"}], ["UNAVAILABLE", {reason: "HEALTH_UNREADABLE"}]] as const)
      expect(core.mapOperationsControl(ctlBody({workos: {state, reason: null, tornTail: null, ...extra}})).control.journal, state).toEqual({state, reason: (extra as any).reason ?? null});
    expect(core.mapOperationsControl(ctlBody({workos: {state: "TORN_TAIL", reason: "JOURNAL_TORN_TAIL", tornTail: {offset: 1}}})).control.journal).toEqual({state: "TORN_TAIL", reason: "JOURNAL_TORN_TAIL"});
    expect(core.mapOperationsControl({globalStop: {active: true, reason: "GLOBAL_STOP_STATE_UNSAFE"}, verification: "REJECTED"}).control).toMatchObject({active: true, verification: "REJECTED"});
  });
  it("any malformed or self-contradicting control payload makes the WHOLE read ERROR (never 'not stopped')", async () => {
    const core = await load("operations-core.js");
    const bad: any[] = [null, undefined, [], "x", 1, {}, {globalStop: null}, {globalStop: []}, {globalStop: {}}, {globalStop: {active: "true"}}, {globalStop: {active: 1}}, {globalStop: {active: null}},
      ctlBody({globalStop: {active: true, reason: 5}}), ctlBody({globalStop: {active: true, actor: {}}}), ctlBody({globalStop: {active: true, activatedAt: "not-a-date"}}), ctlBody({globalStop: {active: true, activatedAt: 5}}),
      ctlBody({verification: "rejected"}), ctlBody({verification: 5}), ctlBody({globalStop: {active: false}, verification: "REJECTED"}),
      ctlBody({workos: "OK"}), ctlBody({workos: {}}), ctlBody({workos: {state: "FINE"}}), ctlBody({workos: {state: "ok"}}), ctlBody({workos: {state: "OK", reason: 5}}),
      ctlBody({workos: {state: "OK", reason: "weird"}}), ctlBody({workos: {state: "TORN_TAIL", reason: "r", tornTail: null}}), ctlBody({workos: {state: "OK", reason: null, tornTail: {offset: 1}}}), ctlBody({workos: {state: "TAMPERED", reason: "r", tornTail: "x"}})];
    for (const b of bad) expect(core.mapOperationsControl(b), JSON.stringify(b)).toEqual({state: "ERROR", control: null});
  });
  it("mapOperationsRuns carries every recorded status VERBATIM and never invents one; rows without any record have no status", async () => {
    const core = await load("operations-core.js");
    const m = core.mapOperationsRuns(runsBody([finishedRun(RID("01"), "COMPLETE"), finishedRun(RID("02"), "SOME_NEW_STATUS"), openRun(RID("03"), H), {runId: RID("04")}, {runId: RID("05"), summary: {}, manifest: {status: "RUNNING"}}]));
    expect(m.state).toBe("VERIFIED");
    const by = Object.fromEntries(m.runs.items.map((x: any) => [x.runId, x]));
    expect(by[RID("01")]).toMatchObject({status: "COMPLETE", statusBasis: "SUMMARY", hasSummary: true, packageId: "PKG-001"});
    expect(by[RID("02")]).toMatchObject({status: "SOME_NEW_STATUS", statusBasis: "SUMMARY"});
    expect(by[RID("03")]).toMatchObject({status: "RUNNING", statusBasis: "MANIFEST", hasSummary: false, hasManifest: true, startedAt: ago(H)});
    expect(by[RID("04")]).toMatchObject({status: null, statusBasis: null, hasSummary: false, hasManifest: false, startedAt: null});
    // Özet var ama durumu yok: manifest durumu OLARAK yükseltilmez (bitmiş/durum bilinmiyor).
    expect(by[RID("05")]).toMatchObject({status: null, statusBasis: null, hasSummary: true});
    expect(m.runs.total).toBe(5); expect(m.runs.capped).toBe(false);
    expect(core.mapOperationsRuns(runsBody(Array.from({length: 100}, (_, i) => finishedRun(RID(String(i).padStart(3, "0"))))))).toMatchObject({state: "VERIFIED", runs: {total: 100, capped: true}});
    expect(core.mapOperationsRuns({count: 0, runs: []})).toEqual({state: "VERIFIED", runs: {total: 0, capped: false, items: []}});
  });
  it("any malformed or self-contradicting run row makes the WHOLE runs read ERROR (no partial counts)", async () => {
    const core = await load("operations-core.js");
    const good = finishedRun(RID("01"));
    const bad: any[] = [null, [], "x", {}, {count: 1}, {runs: []}, {count: "1", runs: [good]}, {count: 2, runs: [good]}, {count: 0, runs: [good]}, {count: 1.5, runs: [good]},
      runsBody([{...good, runId: "RUN-"}]), runsBody([{...good, runId: "run_abc"}]), runsBody([{...good, runId: "RUN-a/../b"}]), runsBody([{...good, runId: 5}]), runsBody([good, good]),
      runsBody([{...good, summary: "done"}]), runsBody([{...good, manifest: []}]), runsBody([{...good, summary: {...good.summary, status: "complete"}}]), runsBody([{...good, summary: {...good.summary, status: 5}}]),
      runsBody([{...good, summary: {...good.summary, finishedAt: "garbage"}}]), runsBody([{...good, manifest: {...good.manifest, startedAt: "garbage"}}]), runsBody([{...good, summary: {...good.summary, runId: RID("99")}}]),
      runsBody([{...good, manifest: {...good.manifest, runId: RID("99")}}]), runsBody([{...good, summary: {...good.summary, packageId: "bad id"}}]), runsBody([{...good, summary: {...good.summary, error: 5}}]),
      runsBody([{...good, summary: {...good.summary, status: "RUNNING"}}]), runsBody([good, {...finishedRun(RID("02")), summary: {status: "x y"}}])];
    for (const b of bad) expect(core.mapOperationsRuns(b), JSON.stringify(b).slice(0, 120)).toEqual({state: "ERROR", runs: null});
  });
  it("mapOperationsAttention shares the strict queue mapper, validates retry and checkpoint records, and reports a rejected scheduler as such", async () => {
    const core = await load("operations-core.js");
    const empty = core.mapOperationsAttention(attBody());
    expect(empty).toEqual({state: "VERIFIED", attention: {total: 0, items: [], schedulerVerification: "VERIFIED", retryableKinds: KINDS, retry: null, checkpoint: null}});
    const full = core.mapOperationsAttention(attBody({blocked: [blockedRow({packageId: "PKG-005"}), blockedRow({phase: 9, kind: "FOUNDER_ATTENTION", reason: "r", retryable: false})], retry: retryRec(ago(H)), checkpoint: checkpointRec(ago(2 * H))}));
    expect(full.attention.total).toBe(2);
    expect(full.attention.items.map((x: any) => [x.packageId, x.phase, x.kind, x.retryable])).toEqual([["PKG-005", 7, "QUOTA_EXHAUSTED", true], [null, 9, "FOUNDER_ATTENTION", false]]);
    expect(full.attention.retry).toEqual({packageId: "PKG-012", phaseIds: [7], reason: "RATE_LIMIT", retryAfterSeconds: 600, retryAt: ago(H), updatedAt: ago(2 * H)});
    expect(full.attention.checkpoint).toEqual({generation: 3, updatedAt: ago(2 * H)});
    expect(core.mapOperationsAttention({blocked: [], retryableKinds: [], schedulerVerification: "REJECTED", error: "SCHEDULER_STATE_INVALID"})).toEqual({state: "UNAVAILABLE", attention: null, schedulerRejected: true});
    expect(core.mapOperationsAttention({blocked: [], schedulerVerification: "PENDING"}).attention).toMatchObject({schedulerVerification: "PENDING", total: 0});
    expect(core.mapOperationsAttention({blocked: []}).attention.schedulerVerification).toBeNull();
  });
  it("any malformed attention payload (blocked row, retry record, checkpoint, kinds) makes the WHOLE read ERROR", async () => {
    const core = await load("operations-core.js");
    const bad: any[] = [null, [], "x", {}, {blocked: "x"}, attBody({schedulerVerification: "verified"}), attBody({schedulerVerification: 5}),
      attBody({blocked: [{kind: "TIMEOUT"}]}), attBody({blocked: [blockedRow({at: "garbage"})]}), attBody({blocked: [blockedRow({retryable: "yes"})]}), attBody({blocked: [blockedRow({kind: "bad kind!"})]}),
      attBody({blocked: [blockedRow(), blockedRow()]}), attBody({blocked: [blockedRow({phase: -1})]}), attBody({blocked: [blockedRow({reason: 5})]}),
      attBody({retryableKinds: "TIMEOUT"}), attBody({retryableKinds: ["bad kind"]}), attBody({retryableKinds: Array.from({length: 21}, () => "TIMEOUT")}),
      attBody({retry: "soon"}), attBody({retry: {}}), attBody({retry: retryRec("garbage")}), attBody({retry: retryRec(ago(H), {packageId: "bad id"})}), attBody({retry: retryRec(ago(H), {retryAfterSeconds: -1})}),
      attBody({retry: retryRec(ago(H), {phaseIds: ["x"]})}), attBody({retry: retryRec(ago(H), {updatedAt: "garbage"})}), attBody({retry: retryRec(ago(H), {reason: 5})}),
      attBody({checkpoint: "x"}), attBody({checkpoint: {generation: 1}}), attBody({checkpoint: checkpointRec(ago(H), {generation: 0})}), attBody({checkpoint: checkpointRec("garbage")}), attBody({checkpoint: checkpointRec(ago(H), {generation: 1.5})})];
    for (const b of bad) expect(core.mapOperationsAttention(b), JSON.stringify(b).slice(0, 140)).toEqual({state: "ERROR", attention: null});
  });
});

// ---------------- (4) derivation: honest state, real timestamps only ----------------
type Case = [string, Record<string, any>, string, string[]];
const CASES: Case[] = [
  ["global stop active", {"/v1/control/status": ctlBody({globalStop: {active: true, reason: "Founder stop", actor: "FOUNDER", activatedAt: ago(2 * H)}})}, "ATTENTION_NEEDED", ["STOP_ACTIVE"]],
  ["global stop fail-closed (unsafe, REJECTED)", {"/v1/control/status": {globalStop: {active: true, reason: "GLOBAL_STOP_STATE_UNSAFE"}, verification: "REJECTED", workos: {state: "OK", reason: null, tornTail: null}}}, "ATTENTION_NEEDED", ["STOP_FAIL_CLOSED"]],
  ["global stop fail-closed (invalid file)", {"/v1/control/status": ctlBody({globalStop: {active: true, reason: "GLOBAL_STOP_STATE_INVALID_FAIL_CLOSED", actor: "SYSTEM"}})}, "ATTENTION_NEEDED", ["STOP_FAIL_CLOSED"]],
  ["journal TAMPERED", {"/v1/control/status": ctlBody({workos: {state: "TAMPERED", reason: "HASH_CHAIN_BROKEN", tornTail: null}})}, "ATTENTION_NEEDED", ["JOURNAL_TAMPERED"]],
  ["journal TORN_TAIL", {"/v1/control/status": ctlBody({workos: {state: "TORN_TAIL", reason: "JOURNAL_TORN_TAIL", tornTail: {offset: 10}}})}, "ATTENTION_NEEDED", ["JOURNAL_TORN_TAIL"]],
  ["journal UNAVAILABLE", {"/v1/control/status": ctlBody({workos: {state: "UNAVAILABLE", reason: "HEALTH_UNREADABLE", tornTail: null}})}, "ATTENTION_NEEDED", ["JOURNAL_UNAVAILABLE"]],
  ["journal ABSENT", {"/v1/control/status": ctlBody({workos: {state: "ABSENT", reason: null, tornTail: null}})}, "UNVERIFIED", ["JOURNAL_ABSENT"]],
  ["journal health not reported", {"/v1/control/status": {globalStop: {active: false}}}, "UNVERIFIED", ["JOURNAL_NOT_REPORTED"]],
  ["scheduler PENDING", {"/v1/founder-attention": attBody({schedulerVerification: "PENDING"})}, "UNVERIFIED", ["SCHEDULER_NOT_VERIFIED"]],
  ["scheduler verification not reported", {"/v1/founder-attention": {blocked: [], retryableKinds: KINDS}}, "UNVERIFIED", ["SCHEDULER_NOT_VERIFIED"]],
  ["scheduler REJECTED", {"/v1/founder-attention": {blocked: [], retryableKinds: KINDS, schedulerVerification: "REJECTED", error: "SCHEDULER_STATE_INVALID"}}, "ATTENTION_NEEDED", ["SCHEDULER_REJECTED"]],
  ["blocked package", {"/v1/founder-attention": attBody({blocked: [blockedRow()]})}, "ATTENTION_NEEDED", ["BLOCKED_PACKAGE"]],
  ["retry record overdue", {"/v1/founder-attention": attBody({retry: retryRec(ago(H))})}, "ATTENTION_NEEDED", ["RETRY_OVERDUE"]],
  ["retry record due (within the grace)", {"/v1/founder-attention": attBody({retry: retryRec(ago(2 * MIN))})}, "WATCH", ["RETRY_DUE"]],
  ["retry record waiting", {"/v1/founder-attention": attBody({retry: retryRec(ago(-H))})}, "WATCH", ["RETRY_WAITING"]],
  ["checkpoint not cleared past the threshold", {"/v1/founder-attention": attBody({checkpoint: checkpointRec(ago(7 * H))})}, "ATTENTION_NEEDED", ["CHECKPOINT_STALE"]],
  ["no runs recorded", {"/v1/runs": runsBody([])}, "UNVERIFIED", ["NO_RUNS_RECORDED"]],
  ["stalled run (no summary past the threshold)", {"/v1/runs": runsBody([...OK_RUNS, openRun(RID("02"), 7 * H)])}, "ATTENTION_NEEDED", ["RUN_STALLED"]],
  ["unfinished run within the threshold", {"/v1/runs": runsBody([...OK_RUNS, openRun(RID("02"), H)])}, "WATCH", ["RUN_IN_PROGRESS"]],
  ["unfinished run without a start time", {"/v1/runs": runsBody([...OK_RUNS, openRun(RID("02"), null)])}, "UNVERIFIED", ["RUN_UNDETERMINED"]],
  ["latest run ended FATAL", {"/v1/runs": runsBody([finishedRun(RID("01"), "COMPLETE", 10 * H), finishedRun(RID("02"), "FATAL", 2 * H, {error: "boom"})])}, "ATTENTION_NEEDED", ["LATEST_RUN_ATTENTION"]],
  ["latest run ended FOUNDER_ATTENTION_REQUIRED", {"/v1/runs": runsBody([finishedRun(RID("01"), "COMPLETE", 10 * H), finishedRun(RID("02"), "FOUNDER_ATTENTION_REQUIRED", 2 * H)])}, "ATTENTION_NEEDED", ["LATEST_RUN_ATTENTION"]],
  ["newest run (by runId) is FATAL with a summary but NO manifest (supervisor crashed before writeManifest); it must not be out-sorted behind an older COMPLETE run", {"/v1/runs": runsBody([finishedRun(RID("01"), "COMPLETE", 10 * H), {runId: RID("09"), summary: {runId: RID("09"), status: "FATAL", finishedAt: ago(1 * H), packageId: "PKG-001", error: "crash before manifest"}, manifest: null}])}, "ATTENTION_NEEDED", ["LATEST_RUN_ATTENTION"]]
];
describe("Operations — the overall state is 'no issues recorded' only when everything is genuinely satisfied; nothing is assumed", () => {
  it("the baseline with every condition satisfied is NO_ISSUES_RECORDED with an empty checklist (positive control)", async () => {
    const {out, core} = await assess();
    expect(out.tier).toBe("NO_ISSUES_RECORDED");
    expect(out.steps).toEqual([]);
    expect(out.unreadable).toEqual([]);
    expect(out.unknownState).toBeNull();
    expect(core.TIERS).toEqual(["ATTENTION_NEEDED", "UNKNOWN", "UNVERIFIED", "WATCH", "NO_ISSUES_RECORDED"]);
    expect(out.counts).toEqual({ACTION: 0, UNKNOWN: 0, UNVERIFIED: 0, WATCH: 0});
    expect(out.runs).toMatchObject({total: 1, stalled: 0, inProgress: 0, undetermined: 0});
    expect(out.control).toMatchObject({active: false, failClosed: false, journal: {state: "OK"}});
  });
  it("breaking ANY single condition in ANY way can never leave 'no issues recorded', and exactly the broken condition is named in the checklist", async () => {
    for (const [label, over, tier, ids] of CASES) {
      const {out} = await assess(over);
      expect(out.tier, label).toBe(tier);
      expect(out.tier, label).not.toBe("NO_ISSUES_RECORDED");
      expect(out.steps.map((s: any) => s.id), label).toEqual(ids);
    }
  });
  it("every single-break case is also never shown as healthy in the rendered view (no 'no issues', no done pill, no clear note)", async () => {
    for (const [label, over, tier] of CASES) {
      const {root: r} = await renderView(serve(over));
      expect(overallOf(r).dataset.overall, label).toBe(tier);
      expectNotClear(r, label);
      expect(stepsOf(r).length, label).toBeGreaterThan(0);
    }
  });
  it("unreadable sources make their figures null (never 0) and the state UNKNOWN — unless a readable source already shows a recorded problem, which wins", async () => {
    for (const key of ["control", "runs", "attention"]) for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"], ["MALFORMED", "ERROR"]] as const) {
      const over = {[KEYS[key]]: thrown === "MALFORMED" ? {nonsense: true} : fail(thrown)};
      const {out} = await assess(over);
      expect(out.tier, `${key}/${thrown}`).toBe("UNKNOWN");
      expect(out.unknownState, `${key}/${thrown}`).toBe(expected);
      expect(out.unreadable, `${key}/${thrown}`).toEqual([key]);
      expect(out.sources[key].state).toBe(expected);
      expect(out.steps.map((s: any) => s.id)).toEqual(["SOURCE_UNREADABLE"]);
      expect(out.steps[0].params).toMatchObject({source: key, state: expected});
      // Okunamayan kaynağın sayıları null'dır; okunabilenler korunur.
      expect(out.control === null, `${key}/${thrown}`).toBe(key === "control");
      expect(out.runs === null, `${key}/${thrown}`).toBe(key === "runs");
      expect(out.queue === null, `${key}/${thrown}`).toBe(key === "attention");
    }
    // Olumsuz okunabilir kanıt, bilinmeyenin önüne geçer.
    const mixed = await assess({"/v1/control/status": fail("fetch failed"), "/v1/founder-attention": attBody({blocked: [blockedRow()]})});
    expect(mixed.out.tier).toBe("ATTENTION_NEEDED");
    expect(mixed.out.steps.map((s: any) => s.id)).toEqual(["BLOCKED_PACKAGE", "SOURCE_UNREADABLE"]);
    // Birden fazla okunamayan kaynakta en ağır dürüst durum: OFFLINE > ERROR > UNAVAILABLE.
    expect((await assess({"/v1/control/status": fail("x: HTTP 404"), "/v1/runs": fail("x: HTTP 500")})).out.unknownState).toBe("ERROR");
    expect((await assess({"/v1/control/status": fail("x: HTTP 404"), "/v1/runs": fail("fetch failed")})).out.unknownState).toBe("OFFLINE");
    expect((await assess({"/v1/control/status": fail("x: HTTP 404"), "/v1/runs": fail("x: HTTP 404")})).out.unknownState).toBe("UNAVAILABLE");
  });
  it("a rejected scheduler is a recorded negative (not an unreadable source): the blocked-package figures are withheld (null) and the step is SCHEDULER_REJECTED", async () => {
    const {out, res} = await assess({"/v1/founder-attention": {blocked: [], retryableKinds: KINDS, schedulerVerification: "REJECTED", error: "SCHEDULER_STATE_INVALID"}});
    expect(res.attention).toMatchObject({state: "UNAVAILABLE", attention: null, schedulerRejected: true});
    expect(out.schedulerRejected).toBe(true);
    expect(out.queue).toBeNull();
    expect(out.unreadable).toEqual(["attention"]);
    expect(out.steps.map((s: any) => s.id)).toEqual(["SCHEDULER_REJECTED"]);
    // Gerçekten UNAVAILABLE (404) olan kaynak REJECTED sayılmaz.
    const nf = await assess({"/v1/founder-attention": fail("x: HTTP 404")});
    expect(nf.out.schedulerRejected).toBe(false);
    expect(nf.out.steps.map((s: any) => s.id)).toEqual(["SOURCE_UNREADABLE"]);
  });
  it("'stalled' is derived ONLY from real timestamps and the documented thresholds: exactly at the threshold is not stalled, past it is; missing / future / unusable times are never classified", async () => {
    const core = await load("operations-core.js");
    expect(core.RUN_STALL_AFTER_MS).toBe(6 * H);
    expect(core.RETRY_OVERDUE_AFTER_MS).toBe(10 * MIN);
    expect(core.CHECKPOINT_STALE_AFTER_MS).toBe(6 * H);
    const live = async (rows: any[], now = NOW) => { const {out} = await assess({"/v1/runs": runsBody(rows)}, now); return Object.fromEntries(out.runs.items.map((x: any) => [x.runId, x.liveness])); };
    expect(await live([openRun(RID("01"), 6 * H)])).toEqual({[RID("01")]: "IN_PROGRESS"});
    expect(await live([openRun(RID("01"), 6 * H + 1)])).toEqual({[RID("01")]: "STALLED"});
    expect(await live([openRun(RID("01"), 0)])).toEqual({[RID("01")]: "IN_PROGRESS"});
    expect(await live([openRun(RID("01"), -H)])).toEqual({[RID("01")]: "UNDETERMINED"}); // başlangıç gelecekte (saat kayması)
    expect(await live([openRun(RID("01"), null)])).toEqual({[RID("01")]: "UNDETERMINED"});
    expect(await live([{runId: RID("01")}])).toEqual({[RID("01")]: "UNDETERMINED"});
    expect(await live([{runId: RID("01"), summary: {}, manifest: {startedAt: ago(20 * H)}}])).toEqual({[RID("01")]: "UNDETERMINED"}); // özet var ama durumu yok
    expect(await live([openRun(RID("01"), 20 * H)], Number.NaN)).toEqual({[RID("01")]: "UNDETERMINED"}); // geçerli şimdiki zaman yok
    // Bitmiş koşu hiçbir zaman takılmış sayılmaz (özeti vardır), ne kadar eski olursa olsun.
    expect(await live([finishedRun(RID("01"), "COMPLETE", 500 * H)])).toEqual({[RID("01")]: "FINISHED"});
    const nan = await assess({"/v1/runs": runsBody([openRun(RID("01"), 20 * H)]), "/v1/founder-attention": attBody({retry: retryRec(ago(H)), checkpoint: checkpointRec(ago(20 * H))})}, Number.NaN);
    expect(nan.out.steps.map((s: any) => s.id)).toEqual(["RETRY_UNDETERMINED", "RUN_UNDETERMINED"]); // retry fazı belirlenemiyor -> UNVERIFIED (fail-open düzeltmesi, 2. reviewer); checkpoint yaşı hesaplanamaz (stale değil)
    expect(nan.out.queue.retry.phase).toBe("UNDETERMINED");
    expect(nan.out.queue.checkpoint.ageMs).toBeNull();
    // Yeniden deneme sınırları: gelecek -> WAITING, geçmiş <= 10 dk -> DUE, > 10 dk -> OVERDUE.
    const phase = async (at: number) => (await assess({"/v1/founder-attention": attBody({retry: retryRec(ago(at))})})).out.queue.retry.phase;
    expect([await phase(-1), await phase(0), await phase(10 * MIN), await phase(10 * MIN + 1)]).toEqual(["WAITING", "DUE", "DUE", "OVERDUE"]);
    const stale = async (at: number) => (await assess({"/v1/founder-attention": attBody({checkpoint: checkpointRec(ago(at))})})).out.queue.checkpoint.stale;
    expect([await stale(6 * H), await stale(6 * H + 1), await stale(-H)]).toEqual([false, true, false]);
  });
  it("a finished run's recorded status is never promoted: unknown statuses are 'other', missing ones are 'no status', and only the recorded attention statuses count as 'needs attention'", async () => {
    const {out} = await assess({"/v1/runs": runsBody([finishedRun(RID("01"), "COMPLETE", 20 * H), finishedRun(RID("02"), "RETRY_WAIT", 19 * H), finishedRun(RID("03"), "GLOBAL_STOP", 18 * H), finishedRun(RID("04"), "IDLE_NO_RUNNABLE_WORK", 17 * H),
      finishedRun(RID("05"), "MORE_WORK", 16 * H), finishedRun(RID("06"), "WEIRD_STATUS", 15 * H), {runId: RID("07")}, finishedRun(RID("08"), "FATAL", 14 * H)])});
    const g = Object.fromEntries(out.runs.items.map((x: any) => [x.runId, x.group]));
    expect(g).toEqual({[RID("01")]: "FINISHED", [RID("02")]: "WAITING", [RID("03")]: "STOPPED", [RID("04")]: "FINISHED", [RID("05")]: "FINISHED", [RID("06")]: "OTHER", [RID("07")]: "UNKNOWN", [RID("08")]: "ATTENTION"});
    expect(out.runs.byState.map((x: any) => [x.status, x.n]).sort()).toEqual([["COMPLETE", 1], ["FATAL", 1], ["GLOBAL_STOP", 1], ["IDLE_NO_RUNNABLE_WORK", 1], ["MORE_WORK", 1], ["NO_STATUS", 1], ["RETRY_WAIT", 1], ["WEIRD_STATUS", 1]]);
    expect(out.runs.groups).toMatchObject({ATTENTION: 1, WAITING: 1, STOPPED: 1, FINISHED: 3, OTHER: 1, UNKNOWN: 1, RUNNING: 0});
    // Yalnız EN YENİ biten koşunun dikkat durumu eylem adımıdır (geçmiş koşular sayılara girer, eylem üretmez); burada en yeni (14 sa) FATAL -> adım var.
    expect(out.runs.latest.runId).toBe(RID("08"));
    expect(out.steps.map((s: any) => s.id)).toEqual(["LATEST_RUN_ATTENTION", "RUN_UNDETERMINED"]);
    // En yeni koşu temiz bittiyse eski bir FATAL eylem üretmez.
    const old = await assess({"/v1/runs": runsBody([finishedRun(RID("01"), "FATAL", 20 * H), finishedRun(RID("02"), "COMPLETE", 2 * H)])});
    expect(old.out.steps).toEqual([]);
    expect(old.out.tier).toBe("NO_ISSUES_RECORDED");
  });
  it("blocked packages are carried from the record: retry authority only when the control plane says so AND the item has a PKG-NNN id; waits come from the recorded time", async () => {
    const {out} = await assess({"/v1/founder-attention": attBody({blocked: [
      blockedRow({packageId: "PKG-005", phase: 5, at: ago(30 * MIN)}),                                  // yeniden denenebilir + geçerli kimlik
      blockedRow({phase: 7, at: ago(3 * H)}),                                                         // yeniden denenebilir ama kimlik yok
      blockedRow({packageId: "PKG-009", phase: 9, kind: "FOUNDER_ATTENTION", retryable: false, at: ago(50 * H)}), // yeniden denenemez
      blockedRow({packageId: "PKG-010", phase: 10, retryable: undefined, at: "2099-01-01T00:00:00.000Z"})            // belirtilmemiş + gelecekteki zaman
    ]})});
    const q = out.queue;
    expect(q).toMatchObject({total: 4, retryable: 2, retryUsable: 1, notRetryable: 1, unknownRetry: 1});
    expect(q.items.map((x: any) => [x.packageId, x.retryNow, x.waitMs])).toEqual([["PKG-005", true, 30 * MIN], [null, false, 3 * H], ["PKG-009", false, 50 * H], ["PKG-010", false, null]]);
    expect(out.steps.map((s: any) => [s.params.packageId ?? null, s.control])).toEqual([["PKG-005", "retry"], [null, null], ["PKG-009", null], ["PKG-010", null]]);
    // Eşleyici yeniden deneme yetkisini "uydurmaz": retryable alanı yoksa null (belirtilmedi).
    expect(q.items[3].retryable).toBeNull();
  });
});

// ---------------- (5) view honesty ----------------
const busy = () => serve({
  "/v1/control/status": ctlBody({globalStop: {active: true, reason: "Founder stop", actor: "FOUNDER", activatedAt: ago(2 * H)}}),
  "/v1/runs": runsBody([finishedRun(RID("01"), "COMPLETE", 30 * H), openRun(RID("02"), 20 * H), finishedRun(RID("03"), "FOUNDER_ATTENTION_REQUIRED", 5 * H, {error: "gate failed"}), openRun(RID("04"), H)]),
  "/v1/founder-attention": attBody({blocked: [blockedRow({packageId: "PKG-005", phase: 5}), blockedRow({phase: 9, kind: "FOUNDER_ATTENTION", reason: "Review blocked", retryable: false, at: ago(26 * H)})], retry: retryRec(ago(-H)), checkpoint: checkpointRec(ago(H))})
});
describe("Operations — view honesty", () => {
  it("renders summary, recovery checklist, controls, control plane and runs in that order, from the recorded state", async () => {
    const {root: r, calls} = await renderView(busy());
    expect(cls(r, "view-operations")).toBe(true);
    expect(all(r).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["ops-summary", "ops-recovery", "ops-controls", "ops-plane", "ops-runs"]);
    expect(byId(r, "view-title")!.textContent).toBe("Operations & Recovery");
    expect(calls.sort()).toEqual([...THREE].sort());
    expect(byData(r, "readonly", "1")!.textContent).toContain("GET /v1/control/status");
    expect(byData(r, "honesty", "1")!.getAttribute("role")).toBe("note");
    // Özet: kaynaklar, genel durum, sayaçlar, KPI.
    expect(sourcesOf(r).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["control", "VERIFIED"], ["runs", "VERIFIED"], ["attention", "VERIFIED"]]);
    expect(overallOf(r).dataset.overall).toBe("ATTENTION_NEEDED");
    expect(pills(overallOf(r))).toEqual(["ATTENTION"]);
    expect(byData(r, "note", "step-counts")!.textContent).toBe("Checklist: 4 need action · 0 unknown · 0 not verified · 2 to watch");
    expect(byData(r, "note", "not-product-verification")!.textContent).toContain("not product verification");
    expect([kpiValue(r, "runs"), kpiValue(r, "inProgress"), kpiValue(r, "stalled"), kpiValue(r, "blocked"), kpiValue(r, "retryable")]).toEqual(["4", "1", "1", "2", "1"]);
    // Kontrol listesi: eylem önce, izleme sonda.
    expect(stepsOf(r).map(n => `${n.dataset.stepSeverity}:${n.dataset.step}`)).toEqual(["ACTION:STOP_ACTIVE", "ACTION:BLOCKED_PACKAGE", "ACTION:BLOCKED_PACKAGE", "ACTION:RUN_STALLED", "WATCH:RETRY_WAITING", "WATCH:RUN_IN_PROGRESS"]);
    const first = stepsOf(r)[0];
    expect(all(first).find(n => n.tagName === "H3")!.textContent).toBe("Global stop is active");
    expect(field(first, "detail")!.textContent).toContain("Reason: Founder stop. Set by FOUNDER; active for 2 h 0 min.");
    expect(field(first, "where")!.textContent).toContain("Existing control: Resume");
    const blocked = stepsOf(r).filter(n => n.dataset.step === "BLOCKED_PACKAGE");
    expect(all(blocked[0]).find(n => n.tagName === "H3")!.textContent).toBe("Blocked: PKG-005");
    expect(field(blocked[0], "detail")!.textContent).toBe("Kind QUOTA_EXHAUSTED; blocked for 3 h 0 min. Reason: Quota exhausted.");
    expect(blocked[0].dataset.stepControl).toBe("retry");
    expect(field(blocked[0], "where")!.textContent).toContain("Existing control: Retry");
    expect(all(blocked[1]).find(n => n.tagName === "H3")!.textContent).toBe("Blocked: phase 9");
    expect(field(blocked[1], "where")!.textContent).toContain("Founder attention is required");
    expect(blocked[1].dataset.stepControl).toBe("");
    expect(field(stepFor(r, "RUN_STALLED"), "detail")!.textContent).toContain("still has no final summary (display threshold 6 h 0 min)");
    // Mevcut denetimler: yalnız durum; yeniden uygulanmaz.
    expect(controlOf(r, "stop").dataset.controlState).toBe("active");
    expect(pills(controlOf(r, "stop"))).toEqual(["STOPPED"]);
    expect(controlOf(r, "resume").dataset.controlState).toBe("relevant");
    expect(controlOf(r, "retry").dataset.controlState).toBe("some");
    expect(controlOf(r, "retry").textContent).toContain("1 of 2 blocked items are retryable by the control plane.");
    expect(controlOf(r, "stop").textContent).toContain("EMERGENCY STOP");
    expect(byData(r, "note", "controls-defer")!.textContent).toContain("Nothing is stopped, resumed or retried from this view.");
    // Kontrol düzlemi + kuyruk.
    expect(allData(r, "field", "stop")[0].dataset.value).toBe("active");
    expect(field(byId(r, "ops-plane")!, "reason")!.textContent).toBe("Founder stop");
    expect(field(byId(r, "ops-plane")!, "journal")!.dataset.value).toBe("OK");
    expect(field(byId(r, "ops-plane")!, "scheduler")!.dataset.value).toBe("VERIFIED");
    expect(field(byId(r, "ops-plane")!, "retry")!.dataset.value).toBe("WAITING");
    expect(field(byId(r, "ops-plane")!, "checkpoint")!.dataset.value).toBe("present");
    expect(blockedItems(r).map(n => [n.dataset.opsBlockedItem, n.dataset.retryable])).toEqual([["PKG-005|5", "yes"], ["|9", "no"]]);
    // Koşular: kayıtlı durum AYNEN, canlılık yalnız kayıtlı zamandan.
    expect(allData(r, "runState").map(n => [n.dataset.runState, n.dataset.n])).toEqual([["COMPLETE", "1"], ["FOUNDER_ATTENTION_REQUIRED", "1"], ["RUNNING", "2"]].sort((a, b) => Number(b[1]) - Number(a[1]) || (a[0] < b[0] ? -1 : 1)));
    expect(runItems(r).map(n => [n.dataset.opsRun, n.dataset.liveness])).toEqual([[RID("04"), "IN_PROGRESS"], [RID("03"), "FINISHED"], [RID("02"), "STALLED"], [RID("01"), "FINISHED"]]);
    expect(pills(runFor(r, RID("02")))).toEqual(["ATTENTION"]);
    expect(pills(runFor(r, RID("04")))).toEqual(["ACTIVE"]);
    expect(pills(runFor(r, RID("03")))).toEqual(["ATTENTION"]);
    expect(pills(runFor(r, RID("01")))).toEqual(["DONE"]);
    expect(field(runFor(r, RID("03")), "error")!.textContent).toBe("gate failed");
    expect(byData(r, "note", "thresholds")!.textContent).toContain("not recorded timeouts");
    expect(byData(r, "note", "order")!.textContent).toBe("Order: newest start first.");
    expect(surface(r)).not.toContain(FORBIDDEN);
  });
  it("EXPLICIT: the state is NEVER shown as healthy / no issues / done when ANY evidence is missing, unverified, unreadable or negative", async () => {
    // (tek kırık koşul matrisi yukarıda tam; burada karma ve uç durumlar)
    const scenarios: Array<[string, Record<string, any>]> = [
      ["everything unreadable", {"/v1/control/status": fail("fetch failed"), "/v1/runs": fail("fetch failed"), "/v1/founder-attention": fail("fetch failed")}],
      ["everything malformed", {"/v1/control/status": {x: 1}, "/v1/runs": {x: 1}, "/v1/founder-attention": {x: 1}}],
      ["all empty fresh runtime", {"/v1/control/status": ctlBody({workos: {state: "ABSENT", reason: null, tornTail: null}}), "/v1/runs": runsBody([]), "/v1/founder-attention": attBody({schedulerVerification: "PENDING"})}],
      ["clean runs but the scheduler is unreadable", {"/v1/founder-attention": fail("x: HTTP 500")}],
      ["verified scheduler, healthy journal, but the run list is unreadable", {"/v1/runs": fail("x: HTTP 404")}],
      ["stop lifted but a package is blocked", {"/v1/founder-attention": attBody({blocked: [blockedRow()]})}],
      ["only waiting work", {"/v1/runs": runsBody([...OK_RUNS, openRun(RID("02"), MIN)]), "/v1/founder-attention": attBody({retry: retryRec(ago(-H))})}],
      ["recorded zero blocked packages under an unverified scheduler", {"/v1/founder-attention": attBody({schedulerVerification: null})}]
    ];
    for (const [label, over] of scenarios) {
      const {root: r} = await renderView(serve(over));
      expectNotClear(r, label);
      expect(allData(r, "overall").length, label).toBe(1);
    }
  });
  it("EVERY scenario in EN and TR renders without the verified-product constant (even though the API carries it) and without raw i18n keys", async () => {
    const poisoned = serve({"/v1/runs": runsBody([finishedRun(RID("01"), "COMPLETE", 3 * H, {note: FORBIDDEN, verdict: FORBIDDEN})]), "/v1/founder-attention": attBody({blocked: [blockedRow({reason: `${FORBIDDEN} is not a reason`})]})});
    const list: Array<[string, (p: string) => any]> = [["baseline", serve()], ["busy", busy()], ["poisoned", poisoned], ["offline", () => { throw new Error("fetch failed"); }], ["404", () => { throw new Error("x: HTTP 404"); }], ["malformed", () => ({nonsense: true})],
      ...CASES.map(([l, o]) => [l, serve(o)] as [string, (p: string) => any])];
    for (const lang of ["en", "tr"]) for (const [label, fn] of list) {
      const {root: r} = await renderView(fn, lang);
      const txt = lines(r), s = surface(r).replace(FORBIDDEN + " is not a reason", "");
      if (label !== "poisoned") expect(s, `${lang}/${label}`).not.toContain(FORBIDDEN);
      expect(txt, `${lang}/${label}`).not.toMatch(/\bops\.[A-Za-z]+\.[A-Za-z]|area\.operations|\{[a-zA-Z]+\}/);
      for (const n of allData(r, "pill")) expect(n.textContent.trim().length, `${lang}/${label}`).toBeGreaterThan(0);
    }
    const {root: rp} = await renderView(poisoned);
    expect(pills(rp)).not.toContain("PRODUCT_" + "VERIFIED");
  });
  it("each source fails independently with its own honest state; healthy sources stay intact, only the dependent figures are withheld (—, never 0)", async () => {
    // control OFFLINE: stop/journal facts withheld; the other two stay readable.
    let r = (await renderView(serve({"/v1/control/status": fail("fetch failed")}))).root;
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["control", "OFFLINE"]]);
    expect(sourcesOf(r).map(n => n.dataset.sourceState)).toEqual(["OFFLINE", "VERIFIED", "VERIFIED"]);
    expect(overallOf(r).dataset.overall).toBe("UNKNOWN");
    expect(pills(overallOf(r))).toEqual(["OFFLINE"]);
    expect(allData(r, "withheld", "1").map(n => [n.dataset.source, n.dataset.reason])).toEqual([["control", "OFFLINE"]]);
    expect(allData(r, "field", "stop").length).toBe(0);
    expect(kpiValue(r, "runs")).toBe("1");
    for (const c of ["stop", "resume"]) { expect(controlOf(r, c).dataset.controlState).toBe("OFFLINE"); expect(pills(controlOf(r, c))).toEqual(["OFFLINE"]); }
    expect(controlOf(r, "retry").dataset.controlState).toBe("none");
    expectNotClear(r, "control offline");
    // runs UNAVAILABLE: no counts, no rows, runs KPI withheld; control + queue intact.
    r = (await renderView(serve({"/v1/runs": fail("x: HTTP 404")}))).root;
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["runs", "UNAVAILABLE"]]);
    expect([kpiValue(r, "runs"), kpiValue(r, "inProgress"), kpiValue(r, "stalled")]).toEqual(["—", "—", "—"]);
    expect(kpiValue(r, "blocked")).toBe("0");
    expect(runItems(r).length).toBe(0);
    expect(byData(r, "opsEmpty", "unknown")!.getAttribute("role")).toBe("status");
    expect(byData(r, "opsEmpty", "unknown")!.textContent).toContain("could not be read");
    expect(allData(r, "runState").length).toBe(0);
    // attention ERROR: blocked list unknown; blocked/retryable KPI withheld; retry control state unknown.
    r = (await renderView(serve({"/v1/founder-attention": fail("x: HTTP 500")}))).root;
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["attention", "ERROR"]]);
    expect([kpiValue(r, "blocked"), kpiValue(r, "retryable")]).toEqual(["—", "—"]);
    expect(blockedItems(r).length).toBe(0);
    expect(controlOf(r, "retry").dataset.controlState).toBe("ERROR");
    expect(allData(r, "withheld", "1").map(n => [n.dataset.source, n.dataset.reason])).toEqual([["attention", "ERROR"]]);
    expect(kpiValue(r, "runs")).toBe("1");
  });
  it("when everything is unreadable no figure, field, step count or row is shown, and nothing is called healthy, empty or zero", async () => {
    const {root: r} = await renderView(() => { throw new Error("fetch failed"); });
    expect(overallOf(r).dataset.overall).toBe("UNKNOWN");
    expect(allData(r, "opsState").length).toBe(3);
    expect(["runs", "inProgress", "stalled", "blocked", "retryable"].map(k => kpiValue(r, k))).toEqual(["—", "—", "—", "—", "—"]);
    expect(stepIds(r)).toEqual(["SOURCE_UNREADABLE", "SOURCE_UNREADABLE", "SOURCE_UNREADABLE"]);
    expect(runItems(r).length + blockedItems(r).length).toBe(0);
    expect(allData(r, "field").filter(n => ["stop", "journal", "scheduler", "retry", "checkpoint"].includes(n.dataset.field)).length).toBe(0);
    expect(allData(r, "withheld", "1").length).toBe(2);
    expect(byData(r, "opsPartial")!.textContent).toContain("Control plane, Supervisor runs, Blocked packages");
    expect(["stop", "resume", "retry"].map(c => controlOf(r, c).dataset.controlState)).toEqual(["OFFLINE", "OFFLINE", "OFFLINE"]);
    expect(r.textContent).not.toContain("No supervisor runs are recorded.");
    expect(r.textContent).not.toContain("No blocked packages are recorded.");
    expectNotClear(r, "all offline");
  });
  it("a malformed record rejects only its own source: no partial figures or rows from that source, the other sources stay readable", async () => {
    const badRuns = runsBody([finishedRun(RID("01")), {...finishedRun(RID("02")), summary: {status: "bad status!"}}]);
    let r = (await renderView(serve({"/v1/runs": badRuns}))).root;
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["runs", "ERROR"]]);
    expect(runItems(r).length).toBe(0);
    expect(kpiValue(r, "runs")).toBe("—");
    expect(kpiValue(r, "blocked")).toBe("0");
    r = (await renderView(serve({"/v1/founder-attention": attBody({blocked: [blockedRow(), blockedRow({at: "garbage", phase: 8})]})}))).root;
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["attention", "ERROR"]]);
    expect(blockedItems(r).length).toBe(0);
    expect(kpiValue(r, "blocked")).toBe("—");
    expect(kpiValue(r, "runs")).toBe("1");
    r = (await renderView(serve({"/v1/control/status": {globalStop: {active: "yes"}}}))).root;
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["control", "ERROR"]]);
    expect(allData(r, "field", "stop").length).toBe(0);
    expect(controlOf(r, "stop").dataset.controlState).toBe("ERROR"); // bozuk yanıt "stop yok" sayılmaz
  });
  it("a rejected scheduler is shown as a recorded negative with its own block, withheld queue values and a SCHEDULER_REJECTED step — not as 'unavailable'", async () => {
    const {root: r} = await renderView(serve({"/v1/founder-attention": {blocked: [], retryableKinds: KINDS, schedulerVerification: "REJECTED", error: "SCHEDULER_STATE_INVALID"}}));
    expect(allData(r, "opsState").map(n => [n.dataset.source, n.dataset.opsState])).toEqual([["attention", "REJECTED"]]);
    expect(pills(byData(r, "opsState", "REJECTED")!)).toEqual(["BLOCKED"]);
    expect(byData(r, "opsState", "REJECTED")!.getAttribute("role")).toBe("status");
    expect(stepIds(r)).toEqual(["SCHEDULER_REJECTED"]);
    expect(overallOf(r).dataset.overall).toBe("ATTENTION_NEEDED");
    expect(controlOf(r, "retry").dataset.controlState).toBe("rejected");
    expect(allData(r, "withheld", "1").map(n => [n.dataset.source, n.dataset.reason])).toEqual([["attention", "REJECTED"]]);
    expect([kpiValue(r, "blocked"), kpiValue(r, "retryable")]).toEqual(["—", "—"]);
    expect(byData(r, "opsEmpty", "unknown")!.textContent).toContain("could not be read");
    expectNotClear(r, "rejected");
  });
  it("the existing controls are shown with their honest state only: stop / resume follow the recorded stop, retry follows the recorded blocked items", async () => {
    const cs = async (over: Record<string, any>) => { const {root: r} = await renderView(serve(over)); return ["stop", "resume", "retry"].map(c => `${controlOf(r, c).dataset.controlState}`).join(","); };
    expect(await cs({})).toBe("inactive,notNeeded,none");
    expect(await cs({"/v1/control/status": ctlBody({globalStop: {active: true, reason: "r"}})})).toBe("active,relevant,none");
    expect(await cs({"/v1/founder-attention": attBody({schedulerVerification: "PENDING"})})).toBe("inactive,notNeeded,unverified");
    expect(await cs({"/v1/founder-attention": attBody({blocked: [blockedRow({packageId: "PKG-005"})]})})).toBe("inactive,notNeeded,some");
    expect(await cs({"/v1/founder-attention": attBody({blocked: [blockedRow()]})})).toBe("inactive,notNeeded,someNoId");
    expect(await cs({"/v1/founder-attention": attBody({blocked: [blockedRow({retryable: false, kind: "FOUNDER_ATTENTION"})]})})).toBe("inactive,notNeeded,zero");
    expect(await cs({"/v1/founder-attention": attBody({blocked: [blockedRow({retryable: undefined})]})})).toBe("inactive,notNeeded,zero");
    // Hangi denetimin nerede yaşadığı söylenir; hiçbir denetimin kendi düğmesi yoktur.
    const {root: r} = await renderView(serve());
    expect(controlOf(r, "stop").textContent).toContain("shell header");
    expect(controlOf(r, "resume").textContent).toContain("stop banner");
    expect(controlOf(r, "retry").textContent).toContain("Control Tower and Inbox");
    expect(all(r).filter(n => n.tagName === "BUTTON").length).toBe(2);
  });
  it("honest empty states: no runs and no blocked packages are readable zeros with explicit text (only when they were READ); an unverified scheduler never makes 'no blocked packages' evidence", async () => {
    let r = (await renderView(serve({"/v1/runs": runsBody([])}))).root;
    expect(allData(r, "opsEmpty", "1").map(n => n.textContent)).toContain("No supervisor runs are recorded.");
    expect(kpiValue(r, "runs")).toBe("0");
    expect(runItems(r).length).toBe(0);
    r = (await renderView(serve())).root;
    expect(allData(r, "opsEmpty", "1").map(n => n.textContent)).toEqual(["No blocked packages are recorded."]);
    r = (await renderView(serve({"/v1/founder-attention": attBody({schedulerVerification: "PENDING"})}))).root;
    expect(byData(r, "opsEmpty", "unverified")!.textContent).toContain("not evidence that nothing is blocked");
    expect(allData(r, "opsEmpty", "1").length).toBe(0);
    expect(field(byId(r, "ops-plane")!, "scheduler")!.dataset.value).toBe("PENDING");
    expect(pills(field(byId(r, "ops-plane")!, "scheduler")!)).toEqual(["NOT_VERIFIED"]);
  });
  it("very long lists are truncated honestly (the first 200 shown, the real total stated) while the figures cover ALL items", async () => {
    const blocked = Array.from({length: 250}, (_, i) => blockedRow({phase: i, at: ago((i + 1) * MIN)}));
    const runs = Array.from({length: 250}, (_, i) => finishedRun(RID(String(i).padStart(3, "0")), "COMPLETE", (i + 2) * H));
    const {root: r} = await renderView(serve({"/v1/runs": runsBody(runs), "/v1/founder-attention": attBody({blocked})}));
    expect(kpiValue(r, "runs")).toBe("250");
    expect(kpiValue(r, "blocked")).toBe("250");
    expect(allData(r, "opsRunList").map(n => n.dataset.opsRunList)).toEqual(["200"]);
    expect(allData(r, "opsBlocked").map(n => n.dataset.opsBlocked)).toEqual(["200"]);
    expect(allData(r, "opsSteps").map(n => n.dataset.opsSteps)).toEqual(["200"]);
    expect(runItems(r).length).toBe(200);
    expect(blockedItems(r).length).toBe(200);
    expect(allData(r, "note", "truncated").map(n => n.textContent)).toEqual(["Showing the first 200 of 250 steps.", "Showing the first 200 of 250 blocked items.", "Showing the newest 200 of 250 runs."]);
    expect(allData(r, "note", "capped")[0].textContent).toContain("at most the newest 100 runs");
    expect(allData(r, "runState").map(n => [n.dataset.runState, n.dataset.n])).toEqual([["COMPLETE", "250"]]);
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
    const {root: r} = await renderView(serve({
      "/v1/control/status": ctlBody({globalStop: {active: true, reason: evil, actor: evil, activatedAt: ago(H)}}),
      "/v1/runs": runsBody([finishedRun(RID("01"), "FATAL", 3 * H, {error: evil})]),
      "/v1/founder-attention": attBody({blocked: [blockedRow({reason: evil})], retry: retryRec(ago(-H), {reason: evil})})
    }));
    expect(all(r).some(n => ["IMG", "SCRIPT", "IFRAME"].includes(n.tagName))).toBe(false);
    expect(r.textContent).toContain(evil);
    expect(read("views", "operations.js")).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root: r} = await renderView(busy(), "tr");
    expect(byId(r, "view-title")!.textContent).toBe("Operasyon ve Kurtarma");
    expect(overallOf(r).dataset.overall).toBe("ATTENTION_NEEDED");
    expect(overallOf(r).textContent).toContain("Dikkat gerekli");
    expect([kpiValue(r, "runs"), kpiValue(r, "stalled"), kpiValue(r, "blocked")]).toEqual(["4", "1", "2"]);
    expect(stepIds(r)).toEqual(["STOP_ACTIVE", "BLOCKED_PACKAGE", "BLOCKED_PACKAGE", "RUN_STALLED", "RETRY_WAITING", "RUN_IN_PROGRESS"]);
    expect(all(stepsOf(r)[0]).find(n => n.tagName === "H3")!.textContent).toBe("Global stop aktif");
    expect(controlOf(r, "stop").textContent).toContain("ACİL DURDUR");
    expect(byData(r, "note", "not-product-verification")!.textContent).toContain("Ürün doğrulaması değildir");
    expect(runFor(r, RID("02")).dataset.liveness).toBe("STALLED");
  });
});

// ---------------- (6) accessibility ----------------
describe("Operations — accessibility", () => {
  it("single labelled h1, exactly five labelled sections, a labelled KPI group, labelled lists and machine-readable times", async () => {
    const {root: r} = await renderView(busy());
    const h1 = all(r).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    const ids5 = ["ops-summary", "ops-recovery", "ops-controls", "ops-plane", "ops-runs"];
    expect(all(r).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(ids5);
    for (const id of ids5) expect(byId(r, byId(r, id)!.getAttribute("aria-labelledby")!), id).toBeTruthy();
    const group = all(r).find(n => n.getAttribute("role") === "group" && cls(n, "ops-kpis"))!;
    expect(group.getAttribute("aria-label")).toBe("Operations figures");
    const tiles = allData(group, "kpi");
    expect(tiles.length).toBe(5);
    for (const t of tiles) {
      expect(t.tagName).toBe("ARTICLE");
      expect(byId(r, t.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
      expect(all(t).some(n => "pill" in n.dataset)).toBe(true);
    }
    const ol = all(r).filter(n => n.tagName === "OL");
    expect(ol.map(n => n.getAttribute("aria-label"))).toEqual(["Recovery steps, most urgent first", "Supervisor runs, newest first"]);
    for (const l of ol) expect(l.children.every(c => c.tagName === "LI")).toBe(true);
    for (const ul of all(r).filter(n => n.tagName === "UL")) expect(ul.getAttribute("aria-label") ?? ul.getAttribute("aria-labelledby"), cls(ul, "ops-counts") ? "counts" : ul.className).toBeTruthy();
    expect(byId(r, byData(r, "runState")!.parent!.getAttribute("aria-labelledby")!)!.textContent).toBe("Runs by recorded status");
    for (const li of [...stepsOf(r), ...runItems(r), ...blockedItems(r), ...allData(r, "control").filter(n => n.tagName === "LI")]) expect(all(li).filter(n => n.tagName === "H3").length).toBe(1);
    for (const t of all(r).filter(n => n.tagName === "TIME")) { expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(t.textContent.length).toBeGreaterThan(3); }
    const bg = all(r).find(n => n.getAttribute("role") === "group" && cls(n, "btn-row"))!;
    expect(bg.getAttribute("aria-label")).toBe("Open the screens that host the controls");
    for (const b of all(bg).filter(n => n.tagName === "BUTTON")) { expect(b.textContent.length).toBeGreaterThan(0); expect(b.getAttribute("type")).toBe("button"); }
    const ids = all(r).map(n => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("definition lists are well-formed (dt/dd pairs) and every state pill carries text (state is never colour alone)", async () => {
    const {root: r} = await renderView(busy());
    const dls = all(r).filter(n => n.tagName === "DL");
    expect(dls.length).toBeGreaterThanOrEqual(1 + 1 + 2 + 4);
    for (const dl of dls) { expect(dl.children.length % 2).toBe(0); dl.children.forEach((c, i) => expect(c.tagName).toBe(i % 2 === 0 ? "DT" : "DD")); }
    for (const p of allData(r, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    for (const li of stepsOf(r)) expect(pills(li).length, li.dataset.step).toBe(1);
    for (const li of runItems(r)) expect(pills(li).length, li.dataset.opsRun).toBe(1);
  });
  it("failure blocks and withheld notes are status regions (role=status) with text, not colour alone", async () => {
    const {root: r} = await renderView(() => { throw new Error("fetch failed"); });
    const blocks = allData(r, "opsState");
    expect(blocks.length).toBe(3);
    for (const b of blocks) { expect(b.getAttribute("role")).toBe("status"); expect(b.textContent).toContain("Offline"); expect(pills(b)).toContain("OFFLINE"); }
    expect(byData(r, "opsPartial")!.getAttribute("role")).toBe("status");
    expect(byData(r, "opsEmpty", "unknown")!.getAttribute("role")).toBe("status");
    for (const w of allData(r, "withheld", "1")) expect(w.getAttribute("role")).toBe("status");
  });
  it("styles.css has container-query, forced-colors and focus coverage for the operations components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("Operasyon ve Kurtarma: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.ops-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    // Anlam renkle taşınmaz: durum rengi yalnız sol kenar vurgusudur; metin/rozet her kartta vardır.
    expect(mine).toMatch(/\.ops-step\[data-step-severity="ACTION"\][^{]*\{border-left-color:var\(--danger\)\}/);
    expect(mine).toMatch(/\.ops-step\[data-step-severity="UNVERIFIED"\]/);
    for (const v of mine.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(css, v).toContain(`${v.slice(4, -1)}:`);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (7) locale parity ----------------
describe("Operations — locale parity and key coverage", () => {
  it("every ops.* / area.operations.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("ops.") || k.startsWith("area.operations.")).sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(150);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.operations.title"]).toBe("Operasyon ve Kurtarma");
    expect(en["area.operations.title"]).toBe("Operations & Recovery");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
    // Yalnız NO_ISSUES_RECORDED açıklaması olumlu dil kullanabilir: diğer dört düzey başlığı/açıklaması olumlu ifade içermez.
    for (const t of ["ATTENTION_NEEDED", "UNKNOWN", "UNVERIFIED", "WATCH"]) for (const k of [`ops.tier.${t}`, `ops.tierDesc.${t}`]) expect(en[k], k).not.toMatch(/no issues|healthy|all[- ]clear|\bfine\b|\bok\b|\bpass(ed)?\b/i);
  });
  it("every literal and enumerated key used by operations.js exists in both dictionaries, and no ops key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("operations-core.js");
    const src = read("views", "operations.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"((?:ops|area\.operations)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.OPS_SOURCES) { need.add(`ops.src.${k}`); need.add(`ops.srcShort.${k}`); }
    for (const k of [...core.UNKNOWN_DETAILS, "REJECTED"]) { need.add(`ops.state.${k}`); need.add(`ops.hint.${k}`); }
    for (const k of core.UNKNOWN_DETAILS) need.add(`ops.reason.${k}`);
    for (const k of ["runs", "inProgress", "stalled", "blocked", "retryable"]) { need.add(`ops.kpi.${k}`); need.add(`ops.kpi.q.${k}`); }
    for (const t of core.TIERS) { need.add(`ops.tier.${t}`); need.add(`ops.tierDesc.${t}`); }
    for (const s of core.SEVERITIES) need.add(`ops.severity.${s}`);
    for (const id of Object.values(core.STEP_IDS).flat() as string[]) { need.add(`ops.step.${id}.title`); need.add(`ops.step.${id}.detail`); }
    for (const k of ["resume", "retry", "founder", "noId", "unknown"]) need.add(`ops.step.where.${k}`);
    for (const c of ["stop", "resume", "retry"]) { need.add(`ops.control.${c}.title`); need.add(`ops.control.where.${c}`); }
    for (const k of ["unknown", "stop.active", "stop.inactive", "resume.relevant", "resume.notNeeded", "retry.rejected", "retry.none", "retry.unverified", "retry.some", "retry.someNoId", "retry.zero"]) need.add(`ops.control.state.${k}`);
    for (const k of [...core.JOURNAL_STATES, "NOT_REPORTED"]) need.add(`ops.journal.${k}`);
    for (const k of ["WAITING", "DUE", "OVERDUE", "UNDETERMINED"]) need.add(`ops.retry.phase.${k}`);
    for (const k of ["VERIFIED", "OTHER", "NOT_REPORTED"]) need.add(`ops.scheduler.${k}`);
    for (const k of ["yes", "no", "unknown"]) need.add(`ops.retryable.${k}`);
    for (const k of core.RUN_GROUPS) need.add(`ops.group.${k}`);
    for (const k of core.LIVENESS) need.add(`ops.live.${k}`);
    need.add("area.operations.title"); need.add("area.operations.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(150);
    // Sözlükte ölü anahtar kalmaz: her ops.* anahtarı görünümde/çekirdekte kullanılır.
    expect(Object.keys(en).filter(k => (k.startsWith("ops.") || k.startsWith("area.operations.")) && !need.has(k))).toEqual([]);
    // Core sabitleri sunucu sözleşmesiyle uyumlu.
    expect(core.UNKNOWN_DETAILS).toEqual(["OFFLINE", "UNAVAILABLE", "ERROR"]);
    expect(core.JOURNAL_STATES).toEqual(["OK", "ABSENT", "TORN_TAIL", "TAMPERED", "UNAVAILABLE"]);
    expect(core.SEVERITIES).toEqual(["ACTION", "UNKNOWN", "UNVERIFIED", "WATCH"]);
    expect(core.LIVENESS).toEqual(["FINISHED", "IN_PROGRESS", "STALLED", "UNDETERMINED"]);
    expect(core.FAIL_CLOSED_STOP_REASONS).toEqual(["GLOBAL_STOP_STATE_UNSAFE", "GLOBAL_STOP_STATE_INVALID_FAIL_CLOSED"]);
    // Her bulgu adımı, çekirdeğin ürettiği kümeden biridir (kümede olmayan adım üretilemez).
    const produced = new Set<string>();
    for (const [, over] of CASES) for (const s of (await assess(over)).out.steps) produced.add(s.id);
    const universe = new Set(Object.values(core.STEP_IDS).flat() as string[]);
    for (const id of produced) expect(universe.has(id), id).toBe(true);
    for (const [sev, ids] of Object.entries(core.STEP_IDS) as Array<[string, string[]]>) for (const id of ids) expect(core.SEVERITIES.includes(sev), id).toBe(true);
  });
});

// ---------------- (8) routing ----------------
describe("Operations — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/operations to the planned host with component 'operations' (no plannedPackage), after posture and before settings, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("operations");
    expect(r).toMatchObject({id: "operations", hash: "#/operations", view: "planned", component: "operations", factory: false, icon: "pulse"});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/operations")).toBe("operations");
    expect(routes.routeFromHash("#/operations/")).toBe("operations");
    expect(routes.routeFromHash("#/operationss")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/Operations")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-12)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "install", "audit", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("operations");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    // Eski rotalar etkilenmez.
    for (const id of ["posture", "readiness", "queue", "executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
    expect(routes.routeById("tower")).toMatchObject({id: "tower", view: "tower", factory: true});
    expect(routes.routeById("inbox")).toMatchObject({id: "inbox", view: "inbox", factory: true});
  });
  it("planned.js delegates the 'operations' component to the real view; app.js VIEWS table has no operations entry and is untouched; the controls' hosts (tower, inbox) are untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as operations from "./operations.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*operations[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("operations.js");
    expect(app).not.toMatch(/\boperations\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    // Denetimleri barındıran görünümler yeni modüllere bağlanmaz (mevcut denetim yolu değişmedi).
    for (const f of ["tower.js", "inbox.js"]) expect(read("views", f)).not.toMatch(/operations/);
    expect(read("shell.js")).not.toMatch(/operations/);
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const rootNode: N = await planned.render(ctx, {id: "operations", component: "operations"});
    expect(cls(rootNode, "view-operations")).toBe(true);
    expect(byId(rootNode, "view-title")!.textContent).toBe("Operations & Recovery");
    // Mevcut devredilen rotalar etkilenmez.
    const e = await planned.render((await mkCtx(serve({"/v1/cockpit": {nonsense: 1}}))).ctx, {id: "executive", component: "executive"});
    expect(cls(e, "view-executive")).toBe(true);
    const q = await planned.render((await mkCtx(serve())).ctx, {id: "queue", component: "queue"});
    expect(cls(q, "view-queue")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.operations.title")).toBe("Operasyon ve Kurtarma");
    expect(i18n.translate("en", "area.operations.desc")).toContain("Read-only.");
  });
});

// //TR: UI-071 2. bağımsız reviewer remediasyonu — "en yeni koşu" seçimi ve belirlenemeyen retry fazının dürüstlüğü (yanlış all-clear regresyonu).
describe("Operations — regression: newest-run selection and retry-phase honesty (UI-071 2nd-reviewer finding)", () => {
  it("picks the latest run by chronological runId (server order), so a FATAL summary WITHOUT a manifest is never hidden behind an older COMPLETE run", async () => {
    const older = finishedRun(RID("01"), "COMPLETE", 10 * H); // has manifest + startedAt
    const newerFatal = {runId: RID("09"), summary: {runId: RID("09"), status: "FATAL", finishedAt: ago(1 * H), packageId: "PKG-001", error: "crash before manifest"}, manifest: null}; // newer runId, no manifest -> no startedAt
    const {out} = await assess({"/v1/runs": runsBody([older, newerFatal])});
    expect(out.runs.latest.runId).toBe(RID("09"));
    expect(out.runs.latest.hasManifest).toBe(false);
    expect(out.runs.latest.group).toBe("ATTENTION");
    expect(out.steps.map((x: any) => x.id)).toContain("LATEST_RUN_ATTENTION");
    expect(out.tier).toBe("ATTENTION_NEEDED");
    expect(out.tier).not.toBe("NO_ISSUES_RECORDED");
  });
  it("surfaces a retry record whose phase cannot be determined (current time unreadable) as UNVERIFIED, never silently all-clear", async () => {
    const {out} = await assess({"/v1/founder-attention": attBody({retry: retryRec(ago(2 * H))})}, NaN);
    expect(out.queue.retry.phase).toBe("UNDETERMINED");
    expect(out.steps.map((x: any) => x.id)).toContain("RETRY_UNDETERMINED");
    expect(out.tier).not.toBe("NO_ISSUES_RECORDED");
  });
});

// //TR: UI-070 Denetim İzi (#/audit) — salt-okunur birleşik olay listesi (en yeni N koşu, yeni-önce) + kanıt referansları; bu dosyadaki fake DOM/ctx yardımcılarını yeniden kullanır. Okunamayan kaynak asla boş-temiz liste değildir, hiçbir yazma/POST yoktur, route app.js (korumalı) değişmeden planned.js üzerinden erişilir.
const AEV = (ts: string | null, event: string, over: Record<string, any> = {}) => ({...(ts === null ? {} : {timestamp: ts}), severity: "INFO", stage: "IMPLEMENT", event, ...over});
const evBody = (runId: string, events: any[], over: Record<string, any> = {}) => ({runId, events, truncated: false, ...over});
const EVID = (id: string, createdAt: string | null, over: Record<string, any> = {}) => ({evidenceId: id, missionId: null, runId: null, kind: "TEST_RESULT", verification: "VERIFIED", createdAt, ...over});
const AUD_RUNS = [finishedRun(RID("01")), finishedRun(RID("02"))];
const auditServe = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {
    "/v1/runs": runsBody(AUD_RUNS),
    [`/v1/runs/${RID("01")}/events`]: evBody(RID("01"), [AEV("2026-10-16T08:00:01.000Z", "a1"), AEV("2026-10-16T08:00:05.000Z", "a2")]),
    [`/v1/runs/${RID("02")}/events`]: evBody(RID("02"), [AEV("2026-10-16T08:00:03.000Z", "b1"), AEV("2026-10-16T08:00:07.000Z", "b2", {severity: "ERROR"})]),
    "/v1/evidence?limit=100": {evidence: [EVID("evd-old-0001", "2026-10-16T08:00:00.000Z"), EVID("evd-new-0002", "2026-10-16T09:00:00.000Z")]},
    ...over
  };
  if (!(p in m)) throw new Error(`${p}: HTTP 404`);
  const v = m[p];
  if (v instanceof Error) throw v;
  return v;
};
async function renderAudit(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "audit.js");
  const m = await mkCtx(getFn, lang);
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, ...m};
}
const auditRows = (r: N) => allData(r, "auditEvent").filter(n => n.tagName === "LI");
const auditLabels = (r: N) => auditRows(r).map(n => all(n).find(c => cls(c, "audit-label"))!.textContent);
function kpiValueAudit(r: N, id: string) {
  const k = allData(r, "kpi").find(n => n.dataset.kpi === `audit-${id}`)!;
  return all(k).find(n => cls(n, "kpi-value"))!.textContent;
}

describe("Audit Trail UI-070 — route, reachability and allow-list", () => {
  it("routes.js maps #/audit to the planned host (component 'audit', no plannedPackage), before settings, with an existing icon; reachable via the ROUTES-driven nav and palette without touching protected files", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("audit");
    expect(r).toMatchObject({id: "audit", hash: "#/audit", view: "planned", component: "audit", factory: false});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/audit")).toBe("audit");
    expect(routes.routeFromHash("#/auditx")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-3)).toEqual(["install", "audit", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("audit");
    expect(read("views", "planned.js")).toContain('import * as audit from "./audit.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*audit[^}]*\}\)/);
    // Nav + palette are driven by ROUTES (no per-route registration); protected app.js is untouched.
    expect(read("shell.js")).toContain("syncNav(doc,el(\"navList\"),ROUTES");
    expect(read("shell.js")).toContain("ROUTES.map(r=>({kind:\"action\",action:\"goto\"");
    expect(read("app.js")).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    expect(read("app.js")).not.toMatch(/audit/);
    const i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) expect(i18n.translate(lang, "area.audit.title")).not.toBe("area.audit.title");
  });
  it("all three GET paths (runs list, per-run events, evidence list with limit) are already admitted by the desktop allow-list; unsafe ids build no path", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    const core = await load("audit-core.js");
    for (const p of ["/v1/runs", core.runEventsPath(RID("01")), core.EVIDENCE_PATH]) expect(allowed(p), String(p)).toBe(true);
    expect(core.runEventsPath("../etc")).toBeNull();
    expect(core.runEventsPath("RUN-x/../../y")).toBeNull();
  });
});

describe("Audit Trail UI-070 — merge, ordering and strict mapping", () => {
  it("merges events of the latest runs newest-first across runs; events without a time go last; ties break by run id then in-run order", async () => {
    const core = await load("audit-core.js");
    const a = core.mapAuditEvents(RID("01"), evBody(RID("01"), [AEV("2026-10-16T08:00:01.000Z", "x"), AEV(null, "no-ts"), AEV("2026-10-16T08:00:05.000Z", "tie-a")]));
    const b = core.mapAuditEvents(RID("02"), evBody(RID("02"), [AEV("2026-10-16T08:00:05.000Z", "tie-b"), AEV("2026-10-16T08:00:03.000Z", "y")]));
    const out = core.buildAudit({runs: {state: "VERIFIED", runs: {total: 2, read: 2, capped: false, ids: [RID("02"), RID("01")]}}, events: {[RID("01")]: a, [RID("02")]: b}, evidence: {state: "ERROR", evidence: null}});
    expect(out.events.map((e: any) => e.event)).toEqual(["tie-b", "tie-a", "y", "x", "no-ts"]);
    expect(out.complete).toBe(false);
  });
  it("reads at most the latest AUDIT_RUN_LIMIT runs (newest run id first) and requests no other event path", async () => {
    const core = await load("audit-core.js");
    const many = Array.from({length: 13}, (_, i) => finishedRun(RID(String(i).padStart(2, "0"))));
    const over: Record<string, any> = {"/v1/runs": runsBody(many)};
    for (let i = 0; i < 13; i++) over[`/v1/runs/${RID(String(i).padStart(2, "0"))}/events`] = evBody(RID(String(i).padStart(2, "0")), [AEV("2026-10-16T08:00:00.000Z", `e${i}`)]);
    const {root, calls} = await renderAudit(auditServe(over));
    const evCalls = calls.filter(c => c.endsWith("/events"));
    expect(evCalls.length).toBe(core.AUDIT_RUN_LIMIT);
    expect(evCalls).not.toContain(`/v1/runs/${RID("00")}/events`);
    expect(evCalls).toContain(`/v1/runs/${RID("12")}/events`);
    expect(auditRows(root).length).toBe(core.AUDIT_RUN_LIMIT);
    expect(byData(root, "note", "older-runs")).toBeTruthy();
  });
  it("rejects a malformed per-run response (wrong run id, non-array, non-object event, bad severity) instead of treating it as empty", async () => {
    const core = await load("audit-core.js");
    for (const bad of [evBody(RID("02"), []), {runId: RID("01")}, evBody(RID("01"), ["x"]), evBody(RID("01"), [AEV("2026-10-16T08:00:00.000Z", "e", {severity: "<b>"})]), null, [], evBody(RID("01"), [], {truncated: "yes"})]) {
      const m = core.mapAuditEvents(RID("01"), bad);
      expect(m.state, JSON.stringify(bad)).toBe("ERROR");
      expect(m.events).toBeNull();
    }
    expect(core.mapAuditRuns({count: 2, runs: [AUD_RUNS[0]]}).state).toBe("ERROR");
    expect(core.mapAuditEvidence({evidence: "nope"}).state).toBe("ERROR");
  });
  it("evidence list: newest first; unreadable entries are counted (not silently dropped)", async () => {
    const core = await load("audit-core.js");
    const m = core.mapAuditEvidence({evidence: [EVID("evd-a-00001", "2026-10-16T08:00:00.000Z"), {nonsense: true}, EVID("evd-b-00002", "2026-10-16T09:00:00.000Z"), EVID("evd-c-00003", null)]});
    expect(m.evidence.items.map((e: any) => e.evidenceId)).toEqual(["evd-b-00002", "evd-a-00001", "evd-c-00003"]);
    expect(m.evidence.skipped).toBe(1);
  });
});

describe("Audit Trail UI-070 — rendering (read-only, honest states)", () => {
  it("renders the merged newest-first list and evidence references with textContent only; no writes; no verdict wording", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const {root, posts} = await renderAudit(auditServe({[`/v1/runs/${RID("02")}/events`]: evBody(RID("02"), [AEV("2026-10-16T08:00:03.000Z", evil), AEV("2026-10-16T08:00:07.000Z", "b2", {severity: "ERROR"})])}));
    expect(cls(root, "view-audit")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Audit Trail");
    expect(auditLabels(root)).toEqual(["IMPLEMENT/b2", "IMPLEMENT/a2", `IMPLEMENT/${evil}`, "IMPLEMENT/a1"]);
    expect(auditRows(root).every(n => !!n.dataset.runId)).toBe(true);
    expect(allData(root, "auditEvidence").filter(n => n.tagName === "LI").map(n => n.dataset.auditEvidence)).toEqual(["evd-new-0002", "evd-old-0001"]);
    expect(byData(root, "auditPartial")).toBeUndefined();
    expect(posts).toEqual([]);
    expect(all(root).filter(n => n.tagName === "BUTTON").length).toBe(0);
    expect(surface(root)).not.toContain(FORBIDDEN);
    for (const id of ["audit-sources", "audit-events", "audit-evidence"]) expect(lines(byId(root, id)!)).not.toMatch(/\b(all clear|healthy|clean|approved)\b/i);
  });
  it("a failed run list shows an honest state: no event rows, no 'no events' text, KPIs show the dash (never 0)", async () => {
    for (const err of [fail("fetch failed"), fail("HTTP 404"), fail("HTTP 500")]) {
      const {root} = await renderAudit(auditServe({"/v1/runs": err}));
      expect(auditRows(root).length).toBe(0);
      expect(byData(root, "auditEmpty", "events")).toBeUndefined();
      expect(byData(root, "auditState")).toBeTruthy();
      expect(byData(root, "auditPartial")!.dataset.auditPartial).toContain("runs");
      expect(kpiValueAudit(root, "events")).toBe("—");
      expect(kpiValueAudit(root, "runs")).toBe("—");
    }
    const bad = await renderAudit(auditServe({"/v1/runs": {count: 1, runs: []}}));
    expect(byData(bad.root, "auditEmpty", "events")).toBeUndefined();
    expect(byData(bad.root, "auditState", "ERROR")).toBeTruthy();
  });
  it("one unreadable run keeps the readable events but marks the list incomplete, names the run, shows dash for the event count and never claims 'none recorded'", async () => {
    const {root} = await renderAudit(auditServe({[`/v1/runs/${RID("01")}/events`]: fail("HTTP 500")}));
    expect(auditLabels(root)).toEqual(["IMPLEMENT/b2", "IMPLEMENT/b1"]);
    expect(byData(root, "note", "incomplete")).toBeTruthy();
    expect(byData(root, "auditFailedRuns")!.dataset.auditFailedRuns).toBe(RID("01"));
    expect(byData(root, "auditPartial")!.dataset.auditPartial).toBe("events");
    expect(kpiValueAudit(root, "events")).toBe("—");
    const onlyBad = await renderAudit(auditServe({[`/v1/runs/${RID("01")}/events`]: fail("HTTP 500"), [`/v1/runs/${RID("02")}/events`]: {runId: "other", events: []}}));
    expect(auditRows(onlyBad.root).length).toBe(0);
    expect(byData(onlyBad.root, "auditEmpty", "events")).toBeUndefined();
  });
  it("a failed evidence list is withheld (not an empty list) while events still render; truly empty readable sources say only 'nothing recorded'", async () => {
    const {root} = await renderAudit(auditServe({"/v1/evidence?limit=100": fail("fetch failed")}));
    expect(auditRows(root).length).toBe(4);
    expect(allData(root, "auditEvidence").length).toBe(0);
    expect(byData(root, "auditEmpty", "evidence")).toBeUndefined();
    expect(byData(root, "auditPartial")!.dataset.auditPartial).toBe("evidence");
    const empty = await renderAudit(auditServe({"/v1/runs": runsBody([]), "/v1/evidence?limit=100": {evidence: []}}));
    expect(byData(empty.root, "auditEmpty", "events")!.textContent).toBe("No runs are recorded, so there are no events to show.");
    expect(byData(empty.root, "auditEmpty", "evidence")).toBeTruthy();
    expect(byData(empty.root, "auditPartial")).toBeUndefined();
  });
  it("EN and TR render without raw i18n keys; audit.* locale keys have exact EN/TR parity", async () => {
    for (const lang of ["en", "tr"]) {
      for (const over of [{}, {"/v1/runs": fail("fetch failed")}, {"/v1/evidence?limit=100": fail("HTTP 404")}, {[`/v1/runs/${RID("01")}/events`]: fail("HTTP 500")}]) {
        const {root} = await renderAudit(auditServe(over), lang);
        expect(surface(root), lang).not.toMatch(/\b(audit|area)\.[A-Za-z.]+\b/);
      }
    }
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = (o: Record<string, string>) => Object.keys(o).filter(k => k.startsWith("audit.") || k === "area.audit.title" || k === "area.audit.desc").sort();
    expect(keys(en).length).toBeGreaterThan(30);
    expect(keys(tr)).toEqual(keys(en));
    for (const k of keys(en)) expect(tr[k].length, k).toBeGreaterThan(0);
  });
});
