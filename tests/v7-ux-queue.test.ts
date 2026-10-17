// //TR: Bu test FA-V2-PRODUCT UI-211 "İnsan Onayı Bekleyen İş Kuyruğu" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek tohumlanmış Work OS verisinden (PREFLIGHT, FOUNDER_ATTENTION_REQUIRED, REPORTING + AWAITING_APPROVAL koşusu, mission'ı REPORTING olmayan AWAITING_APPROVAL koşusu) dönen GET /v1/missions + /v1/work-runs + /v1/founder-attention yanıtları eşleyicilerden ve görünümden geçer; kuyruk öğeleri, öncelik düzeyleri ve bekleme süreleri gerçek zaman damgalarından türer; (2) yalnız zaten izinli üç GET kullanılır, yeni uç nokta/POST/toplu eylem yoktur ve korumalı dosyalar değişmez; (3) saf eşleyiciler fail-closed'dır (bozuk kimlik/enum/biçim/zaman damgası/yinelenen kimlik tüm okumayı ERROR yapar) ve durumları yükseltmez; (4) kuyruk türetimi kayıtlı durumdan yapılır, öncelik/bekleme sıralaması belirleyicidir, SLA değeri uydurulmaz; (5) görünüm dürüstlüğü: okunamayan kaynak varsa sayılar gösterilmez ve kuyruk "boş" denmez, boş kuyruk dürüst boş durumdur, yasak ürün-doğrulandı sabiti hiçbir senaryoda üretilmez, HTML yorumlanmaz; (6) erişilebilirlik; (7) TR/EN anahtar eşitliği; (8) rota delegasyonu (app.js VIEWS değişmez).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (executive/journey testi ile aynı desen) ----------------
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
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `queue-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const itemsOf = (r: N) => allData(r, "queueItem").filter(n => n.tagName === "LI");
const itemFor = (r: N, key: string) => itemsOf(r).find(n => n.dataset.queueItem === key)!;
const field = (li: N, key: string) => allData(li, "field").find(n => n.dataset.field === key);
const click = (n: N) => { const fns = n.ls.get("click"); expect(fns, "click listener").toBeTruthy(); fns!.forEach(f => f({})); };

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
async function mkCtx(getFn: (p: string) => any, lang = "en", nowMs: number = NOW, post?: (p: string, b: unknown) => any) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [];
  const bridge: Record<string, unknown> = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  if (post) bridge.apiPost = async (p: string, b: unknown) => post(p, b);
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { nav.push(id); }, rerender: async () => {}, settleFocus: () => {}, now: () => nowMs};
  return {ctx, doc, calls, nav};
}
const fail = (p: string, status = 404) => { throw new Error(`${p}: HTTP ${status}`); };
async function renderView(getFn: (p: string) => any, lang = "en", nowMs: number = NOW) {
  const queue = await load("views", "queue.js");
  const m = await mkCtx(getFn, lang, nowMs);
  const root: N = await queue.render(m.ctx);
  return {root, ...m};
}

// ---------------- fixtures (sözleşme biçiminde) ----------------
const hex = (c: string) => c.repeat(12);
const MSN = (c: string) => "msn_" + hex(c);
const RUN = (c: string) => "run_" + hex(c);
const PRJ = "prj_" + hex("11");
const M_FA = MSN("a1"), M_PF = MSN("b2"), M_PF2 = MSN("c3"), M_REP = MSN("d4"), M_EXE = MSN("e5"), M_DONE = MSN("f6"), M_REP2 = MSN("a7");
const R_REP = RUN("a1"), R_GATE = RUN("b2"), R_BUSY = RUN("c3"), R_OK = RUN("d4");
const missionRow = (missionId: string, over: Record<string, any> = {}) => ({missionId, projectId: PRJ, tenantId: "tA", title: "Mission", objective: "o", acceptanceCriteria: ["ac"], status: "EXECUTING", riskLevel: "R1", createdAt: "2026-10-01T00:00:00.000Z", createdBy: "x", traceId: "trc_" + "aa".repeat(12), ...over});
// Kuyrukta: FOUNDER_ATTENTION (6 sa), AUTHORIZATION R4 (3 gün), AUTHORIZATION R0 (30 dk), DELIVERY_DECISION (koşu 2 sa), RUN_GATE (koşu tam 7 gün). Kuyrukta DEĞİL: COMPLETE, REPORTING + RUNNING koşu.
const MISSIONS = {missions: [
  missionRow(M_FA, {title: "Needs founder", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R3", createdAt: "2026-10-17T06:00:00.000Z"}),
  missionRow(M_PF, {title: "Needs authorization", status: "PREFLIGHT", riskLevel: "R4", createdAt: "2026-10-14T12:00:00.000Z"}),
  missionRow(M_PF2, {title: "Small preflight", status: "PREFLIGHT", riskLevel: "R0", createdAt: "2026-10-17T11:30:00.000Z"}),
  missionRow(M_REP, {title: "Ready to deliver", status: "REPORTING", riskLevel: "R2", createdAt: "2026-10-01T00:00:00.000Z"}),
  missionRow(M_EXE, {title: "Executing with gate", status: "EXECUTING", riskLevel: "R1", createdAt: "2026-10-01T00:00:00.000Z"}),
  missionRow(M_DONE, {title: "Finished", status: "COMPLETE", riskLevel: "R1", createdAt: "2026-09-01T00:00:00.000Z"}),
  missionRow(M_REP2, {title: "Reporting without a gate", status: "REPORTING", riskLevel: "R1", createdAt: "2026-10-01T00:00:00.000Z"})]};
const runRow = (runId: string, missionId: string, over: Record<string, any> = {}) => ({runId, missionId, projectId: PRJ, tenantId: "tA", status: "AWAITING_APPROVAL", step: "REPORT", remediationCycle: 1, evidence: [], createdAt: "2026-10-16T00:00:00.000Z", createdBy: "x", updatedAt: "2026-10-17T10:00:00.000Z", ...over});
const RUNS = {runs: [
  runRow(R_REP, M_REP, {updatedAt: "2026-10-17T10:00:00.000Z"}),
  runRow(R_GATE, M_EXE, {updatedAt: "2026-10-10T12:00:00.000Z"}),
  runRow(R_BUSY, M_REP2, {status: "RUNNING", step: "IMPLEMENT", updatedAt: "2026-10-17T11:59:00.000Z"}),
  runRow(R_OK, M_DONE, {status: "SUCCEEDED", updatedAt: "2026-10-16T09:00:00.000Z"})]};
const attentionBody = (blocked: any[] = ATTENTION_ITEMS, over: Record<string, any> = {}) => ({blocked, retryableKinds: [], schedulerVerification: "VERIFIED", ...over});
const ATTENTION_ITEMS = [
  {phase: 3, packageId: "PKG-A", kind: "REVIEW_PENDING_PROVIDER_QUOTA", reason: "provider quota", at: "2026-10-17T08:00:00.000Z", retryable: true},
  {phase: 0, kind: "FOUNDER_ATTENTION", retryable: false}];
const PATHS = ["/v1/founder-attention", "/v1/missions", "/v1/work-runs"];
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/missions": MISSIONS, "/v1/work-runs": RUNS, "/v1/founder-attention": attentionBody(), ...over};
  return p in m ? m[p] : fail(p);
};
const K = {fa: `mission:${M_FA}`, pf: `mission:${M_PF}`, pf2: `mission:${M_PF2}`, rep: `run:${R_REP}`, gate: `run:${R_GATE}`, pkg: "attention:PKG-A|3", ph0: "attention:|0"};
const H = 3600000, D1 = 86400000;

// ---------------- (1) GENUINE control-api -> mappers -> queue -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const RECORDER = "implementer@local.invalid";
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-queue-")); });
afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(): App {
  fs.mkdirSync(runtime(), {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), repoRoot: tmp, dataDir: dataDir(), tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const evBase = (step: string, cycle: number, kind: string) => ({step, cycle, kind, argv: ["x"], startedAt: "2026-10-16T08:00:00.000Z", endedAt: "2026-10-16T08:00:01.000Z", exitCode: 0, logPath: null, logSha256: null}) as any;

// Gerçek Work OS store: PREFLIGHT, FOUNDER_ATTENTION_REQUIRED, REPORTING + AWAITING_APPROVAL koşusu, EXECUTING-benzeri mission + AWAITING_APPROVAL koşusu, çalışan koşu, taslak.
async function seedRealStore() {
  const store = new WorkOsStore(dataDir());
  const tenantId = "tA", scope = {tenantId};
  const p = store.createProject({tenantId, orgId: "org1", name: "Queue", environmentId: "env-dev", createdBy: RECORDER});
  const mk = (title: string, riskLevel: "R0" | "R1" | "R2" | "R3" | "R4" = "R1") => store.createMission({tenantId, projectId: p.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel, createdBy: RECORDER}).missionId;
  const walk = (id: string, path: string[]) => { for (const to of path) store.transitionMission(scope, id, to as any, "go", RECORDER); };
  const start = (missionId: string, tag: string) => {
    const r = store.createRun({tenantId, missionId, executor: {implementer: `IMPL-${tag}`, reviewer: `REV-${tag}`}, createdBy: RECORDER});
    return {runId: r.runId, leaseId: store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string};
  };
  const to = (r: {runId: string; leaseId: string}, status: any, opts: any = {}) => store.transitionRun(r.runId, r.leaseId, status, "t", "ENGINE", opts);
  const BASE = "b".repeat(40), V0 = "a".repeat(40);
  const awaiting = (r: {runId: string; leaseId: string}) => {
    to(r, "RUNNING", {patch: {baseSha: BASE, headSha: V0}});
    store.addRunEvidence(r.runId, r.leaseId, {...evBase("IMPLEMENT", 0, "IMPLEMENT"), baseSha: BASE, commitSha: V0}, "ENGINE");
    to(r, "CHECKPOINTING"); to(r, "AWAITING_APPROVAL");
  };
  const pre = mk("Real preflight", "R2"); walk(pre, ["PREFLIGHT"]);
  await sleep(8);
  const fa = mk("Real founder attention", "R3"); walk(fa, ["PREFLIGHT", "FOUNDER_ATTENTION_REQUIRED"]);
  await sleep(8);
  const rep = mk("Real delivery"); walk(rep, ["PREFLIGHT", "AUTHORIZED"]);
  const rr = start(rep, "R"); awaiting(rr);
  walk(rep, ["EXECUTING", "VERIFYING", "REVIEWING", "REGRESSION", "REPORTING"]); // createRun mission'ı zaten PLANNED yapar
  await sleep(8);
  const gate = mk("Real gate"); walk(gate, ["PREFLIGHT", "AUTHORIZED"]);
  const gr = start(gate, "G"); awaiting(gr);
  await sleep(8);
  const busy = mk("Real busy"); walk(busy, ["PREFLIGHT", "AUTHORIZED"]);
  const br = start(busy, "B"); to(br, "RUNNING", {patch: {baseSha: BASE, headSha: V0}});
  mk("Real draft");
  return {pre, fa, rep, gate, busy, repRun: rr.runId, gateRun: gr.runId, busyRun: br.runId};
}

describe("Queue — GENUINE control-api read-models flow through mappers, queue derivation and view", () => {
  it("real seeded Work OS data becomes a prioritized queue with real wait times; non-waiting work is never listed", async () => {
    const s = await seedRealStore();
    const app = mkApp();
    const core = await load("queue-core.js");
    const raw = {missions: await getJson(app, "/v1/missions"), runs: await getJson(app, "/v1/work-runs"), attention: await getJson(app, "/v1/founder-attention")};
    const mm = core.mapQueueMissions(raw.missions), rm = core.mapQueueWorkRuns(raw.runs), am = core.mapQueueAttention(raw.attention);
    for (const r of [mm, rm, am]) expect(r.state).toBe("VERIFIED");
    expect(mm.missions.total).toBe(6);
    expect(rm.runs).toMatchObject({total: 3, awaiting: 2});
    // Zamanlayıcı durumu yok: sunucu bunu PENDING bildirir ve engelli paket listesi boştur (gerçek sıfır).
    expect(raw.attention.schedulerVerification).toBe("PENDING");
    expect(am.attention).toMatchObject({total: 0, schedulerVerification: "PENDING"});

    const nowMs = Date.now() + 2 * H; // gerçek kayıtlar ~şimdi yazıldı: tüm bekleme süreleri ≈ 2 saat
    const q = core.buildQueue({missions: mm, runs: rm, attention: am}, nowMs);
    expect(q.complete).toBe(true);
    expect(q.items.map((i: any) => i.key).sort()).toEqual([`mission:${s.pre}`, `mission:${s.fa}`, `run:${s.repRun}`, `run:${s.gateRun}`].sort());
    const by = (key: string) => q.items.find((i: any) => i.key === key);
    expect(by(`mission:${s.fa}`)).toMatchObject({kind: "FOUNDER_ATTENTION", priority: 1, title: "Real founder attention", riskLevel: "R3", basis: "MISSION_CREATED", missionStatus: "FOUNDER_ATTENTION_REQUIRED"});
    expect(by(`run:${s.repRun}`)).toMatchObject({kind: "DELIVERY_DECISION", priority: 2, title: "Real delivery", missionStatus: "REPORTING", runStatus: "AWAITING_APPROVAL", basis: "RUN_UPDATED"});
    expect(by(`run:${s.gateRun}`)).toMatchObject({kind: "RUN_GATE", priority: 2, title: "Real gate", missionStatus: "PLANNED"});
    expect(by(`mission:${s.pre}`)).toMatchObject({kind: "AUTHORIZATION", priority: 3, riskLevel: "R2", missionStatus: "PREFLIGHT"});
    // Gerçek zaman damgalarından türeyen süre: kayıttaki since ile nowMs farkıdır (uydurma sabit yok).
    for (const i of q.items) { expect(i.waitMs, i.key).toBe(nowMs - Date.parse(i.since)); expect(i.waitMs).toBeGreaterThanOrEqual(2 * H); expect(i.waitMs).toBeLessThan(2 * H + 120000); expect(i.band).toBe("UNDER_1D"); }
    expect(q.groups.map((g: any) => g.items.length)).toEqual([1, 2, 1]);
    // Öncelik içinde en uzun bekleyen önce: iki koşudan daha eski güncellenen (REPORTING'e geçmeden yazılan) önce gelir.
    const tier2 = q.groups[1].items;
    expect(tier2.map((i: any) => i.waitMs)).toEqual([...tier2.map((i: any) => i.waitMs)].sort((a: number, b: number) => b - a));
    expect(q.counts).toMatchObject({total: 4, byPriority: {1: 1, 2: 2, 3: 1}, byBand: {UNDER_1H: 0, UNDER_1D: 4, UNDER_7D: 0, OVER_7D: 0, UNKNOWN: 0}});

    const queue = await load("views", "queue.js"), forms = await load("forms.js");
    const {ctx, calls, nav} = await mkCtx(async p => getJson(app, p), "en", nowMs);
    const view: N = await queue.render(ctx);
    expect(calls.slice().sort()).toEqual(PATHS);
    expect(itemsOf(view).map(n => n.dataset.queueItem)).toEqual(q.items.map((i: any) => i.key));
    expect(kpiValue(view, "total")).toBe("4");
    expect(kpiValue(view, "p1")).toBe("1");
    expect(kpiValue(view, "p2")).toBe("2");
    expect(kpiValue(view, "p3")).toBe("1");
    const fa = itemFor(view, `mission:${s.fa}`);
    expect(fa.dataset.kind).toBe("FOUNDER_ATTENTION");
    expect(fa.textContent).toContain("Real founder attention");
    expect(field(fa, "risk")!.textContent).toBe("R3");
    expect(field(fa, "waiting")!.textContent).toContain("2 h 0 min");
    expect(allData(fa, "waitMs")[0].dataset.waitMs).toBe(String(by(`mission:${s.fa}`).waitMs));
    expect(field(itemFor(view, `run:${s.gateRun}`), "run")!.textContent).toContain(s.gateRun);
    // Gerçek PENDING zamanlayıcı doğrulaması dürüstçe belirtilir; toplam yine de gerçek bir sıfırdır (engelli paket yok).
    expect(byData(view, "note", "scheduler-verification")!.textContent).toBe("Scheduler verification: PENDING");
    // Gezinme MEVCUT akışlara: mission -> Work (seçim ayarlanır), Gelen Kutusu -> inbox. Hiçbir geçiş/POST yok.
    click(all(fa).find(n => n.tagName === "BUTTON" && n.dataset.navigate === "work")!);
    expect(nav).toEqual(["work"]);
    expect(forms.selection.missionId).toBe(s.fa);
    click(all(fa).find(n => n.tagName === "BUTTON" && n.dataset.navigate === "inbox")!);
    expect(nav).toEqual(["work", "inbox"]);
    const gate = itemFor(view, `run:${s.gateRun}`);
    expect(all(gate).filter(n => n.tagName === "BUTTON").map(n => n.dataset.navigate)).toEqual(["work"]); // RUN_GATE: Gelen Kutusu karar sunmaz
    expect(surface(view)).not.toContain(FORBIDDEN);
    expect(pills(view)).not.toContain(FORBIDDEN);
  });
  it("a real Work OS with no waiting work shows an honest empty queue (a real zero), and the empty claim needs all three sources", async () => {
    const store = new WorkOsStore(dataDir());
    const p = store.createProject({tenantId: "tA", orgId: "org1", name: "Only a project", environmentId: "env-dev", createdBy: RECORDER});
    store.createMission({tenantId: "tA", projectId: p.projectId, title: "Draft only", objective: "o", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
    const app = mkApp();
    const {root} = await renderView(async p2 => getJson(app, p2), "en", Date.now());
    expect(itemsOf(root).length).toBe(0);
    expect(byData(root, "queueEmpty", "1")!.textContent).toContain("Nothing is awaiting human approval.");
    expect(kpiValue(root, "total")).toBe("0");
    expect(kpiValue(root, "p1")).toBe("0");
    expect(allData(root, "queueState").length).toBe(0);
    expect(allData(root, "tierEmpty").length).toBe(0);
    expect(allData(root, "queueTier").length).toBe(0);
    expect(surface(root)).not.toContain(FORBIDDEN);
  });
});

// ---------------- (2) allow-list: only already-allow-listed read-only GETs ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Queue — only already-allow-listed read-only GETs are used (protected files unchanged)", () => {
  it("all three GET paths are already admitted by the desktop allow-list; nothing new is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    for (const p of PATHS) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/queue", "/v1/approvals", "/v1/approvals/queue", "/v1/missions?x=1", "/v1/work-runs/", "/v1/founder-attention?x=1"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes("queue")).toBe(false);
    expect(mainSrc).not.toContain("/v1/queue");
    expect(fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8")).not.toContain("/v1/queue");
    expect(fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")).not.toContain("/v1/queue");
  });
  it("queue.js / queue-core.js never write and never reach outside ctx.api: no post, bridge, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "queue.js"), read("queue-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions/);
    }
    const imports = [...read("views", "queue.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort();
    expect(imports).toEqual(["../components.js", "../forms.js", "../model.js", "../queue-core.js", "../work-core.js"]);
    expect([...read("queue-core.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort()).toEqual(["./executive-core.js", "./work-core.js"]);
    for (const m of ["queueAttention", "queueMissions", "queueWorkRuns"]) expect(read("views", "queue.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur (yeni POST yolu eklenmez); kuyruk erişimcileri yalnız sabit GET yollarını okur.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const accessors = read("api.js").split(String.fromCharCode(10)).filter(l => /^\s*async queue(Attention|Missions|WorkRuns)\(\)/.test(l));
    expect(accessors.length).toBe(3);
    for (const l of accessors) { expect(l).not.toMatch(/post\(|apiPost|force/); expect(l).toMatch(/await get\((ATTENTION|MISSIONS|WORK_RUNS)_PATH\)/); }
  });
  it("the api layer requests exactly the three fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls} = await mkCtx(serve());
    const core = await load("queue-core.js");
    expect(core.QUEUE_SOURCE_PATHS).toEqual({attention: "/v1/founder-attention", missions: "/v1/missions", workRuns: "/v1/work-runs"});
    expect(core.QUEUE_SOURCES).toEqual(["attention", "missions", "workRuns"]);
    expect((await ctx.api.queueAttention()).state).toBe("VERIFIED");
    expect((await ctx.api.queueMissions()).state).toBe("VERIFIED");
    expect((await ctx.api.queueWorkRuns()).state).toBe("VERIFIED");
    expect(calls).toEqual(["/v1/founder-attention", "/v1/missions", "/v1/work-runs"]);
    for (const m of ["queueAttention", "queueMissions", "queueWorkRuns"]) expect(ctx.api[m].length).toBe(0);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ["queueAttention", "queueMissions", "queueWorkRuns"]) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    expect((await ctx.api.queueAttention()).state).toBe("ERROR");
    expect((await ctx.api.queueMissions()).state).toBe("ERROR");
    expect((await ctx.api.queueWorkRuns()).state).toBe("ERROR");
  });
});

// ---------------- (3) pure mappers ----------------
describe("Queue — pure mappers are fail-closed and never elevate state", () => {
  it("mapQueueMissions accepts the contract shape verbatim; one bad row, duplicate id or wrong envelope fails the WHOLE read", async () => {
    const core = await load("queue-core.js");
    const ok = core.mapQueueMissions(MISSIONS);
    expect(ok.state).toBe("VERIFIED");
    expect(ok.missions.total).toBe(7);
    expect(ok.missions.items[0]).toEqual({missionId: M_FA, projectId: PRJ, title: "Needs founder", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R3", createdAt: "2026-10-17T06:00:00.000Z"});
    expect(core.mapQueueMissions({missions: []})).toEqual({state: "VERIFIED", missions: {total: 0, items: []}});
    const bad = (over: Record<string, any>) => core.mapQueueMissions({missions: [missionRow(M_FA), missionRow(M_PF, over)]});
    for (const [name, over] of Object.entries({id: {missionId: "msn_zz"}, project: {projectId: "p"}, status: {status: "DONE"}, risk: {riskLevel: "R9"}, createdAt: {createdAt: "yesterday"}, createdAtMissing: {createdAt: undefined}, title: {title: ""}, titleType: {title: 5}, statusMissing: {status: undefined}} as Record<string, any>)) {
      expect(bad(over), name).toEqual({state: "ERROR", missions: null});
    }
    expect(core.mapQueueMissions({missions: [missionRow(M_FA), missionRow(M_FA)]})).toEqual({state: "ERROR", missions: null});
    expect(core.mapQueueMissions({missions: [null]})).toEqual({state: "ERROR", missions: null});
    expect(core.mapQueueMissions({missions: [{...missionRow(M_FA), missionId: [M_FA]}]})).toEqual({state: "ERROR", missions: null});
    for (const raw of [null, undefined, [], "x", 1, {}, {missions: {}}, {missions: "x"}]) expect(core.mapQueueMissions(raw), String(raw)).toEqual({state: "ERROR", missions: null});
  });
  it("mapQueueWorkRuns accepts the contract shape, counts awaiting runs, and one bad run fails the WHOLE read", async () => {
    const core = await load("queue-core.js");
    const ok = core.mapQueueWorkRuns(RUNS);
    expect(ok.state).toBe("VERIFIED");
    expect(ok.runs).toMatchObject({total: 4, awaiting: 2});
    expect(ok.runs.items[0]).toEqual({runId: R_REP, missionId: M_REP, projectId: PRJ, status: "AWAITING_APPROVAL", step: "REPORT", createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-17T10:00:00.000Z"});
    expect(core.mapQueueWorkRuns({runs: []})).toEqual({state: "VERIFIED", runs: {total: 0, awaiting: 0, items: []}});
    const bad = (over: Record<string, any>) => core.mapQueueWorkRuns({runs: [runRow(R_REP, M_REP), runRow(R_GATE, M_EXE, over)]});
    for (const [name, over] of Object.entries({runId: {runId: "run_x"}, mission: {missionId: "msn_x"}, project: {projectId: "x"}, status: {status: "WAITING"}, step: {step: "DEPLOY"}, created: {createdAt: "x"}, updated: {updatedAt: undefined}, updatedType: {updatedAt: 5}} as Record<string, any>)) {
      expect(bad(over), name).toEqual({state: "ERROR", runs: null});
    }
    expect(core.mapQueueWorkRuns({runs: [runRow(R_REP, M_REP), runRow(R_REP, M_REP)]})).toEqual({state: "ERROR", runs: null});
    for (const raw of [null, [], "x", {}, {runs: {}}, {runs: [1]}]) expect(core.mapQueueWorkRuns(raw), JSON.stringify(raw)).toEqual({state: "ERROR", runs: null});
  });
  it("mapQueueAttention carries real blocked items verbatim; a REJECTED scheduler is UNAVAILABLE (never zero); anything malformed is ERROR", async () => {
    const core = await load("queue-core.js");
    const ok = core.mapQueueAttention(attentionBody());
    expect(ok.state).toBe("VERIFIED");
    expect(ok.attention).toEqual({total: 2, schedulerVerification: "VERIFIED", items: [
      {packageId: "PKG-A", phase: 3, kind: "REVIEW_PENDING_PROVIDER_QUOTA", at: "2026-10-17T08:00:00.000Z", reason: "provider quota", retryable: true},
      {packageId: null, phase: 0, kind: "FOUNDER_ATTENTION", at: null, reason: null, retryable: false}]});
    expect(core.mapQueueAttention({blocked: []}).attention).toEqual({total: 0, items: [], schedulerVerification: null});
    expect(core.mapQueueAttention({blocked: [], schedulerVerification: "PENDING"}).attention.schedulerVerification).toBe("PENDING");
    expect(core.mapQueueAttention({blocked: [], schedulerVerification: "REJECTED", error: "SCHEDULER_STATE_INVALID"})).toEqual({state: "UNAVAILABLE", attention: null});
    // phase string (paket kimliği biçimi) ve yalnız packageId kabul edilir.
    expect(core.mapQueueAttention({blocked: [{phase: "P3", kind: "X"}, {packageId: "PKG-Z", kind: "X"}]}).state).toBe("VERIFIED");
    const err = {state: "ERROR", attention: null};
    const one = (item: any) => core.mapQueueAttention({blocked: [item]});
    expect(one({kind: "X"}), "no identity").toEqual(err);
    expect(one({packageId: "PKG-A"}), "no kind").toEqual(err);
    expect(one({packageId: "PKG-A", kind: "bad kind!"})).toEqual(err);
    expect(one({packageId: "PKG-A", kind: ["X"]})).toEqual(err);
    expect(one({packageId: "has space", kind: "X"})).toEqual(err);
    expect(one({packageId: 5, kind: "X"})).toEqual(err);
    expect(one({phase: -1, kind: "X"})).toEqual(err);
    expect(one({phase: 1.5, kind: "X"})).toEqual(err);
    expect(one({phase: {}, kind: "X"})).toEqual(err);
    expect(one({packageId: "PKG-A", kind: "X", at: "not-a-date"})).toEqual(err);
    expect(one({packageId: "PKG-A", kind: "X", at: 123})).toEqual(err);
    expect(one({packageId: "PKG-A", kind: "X", reason: 5})).toEqual(err);
    expect(one({packageId: "PKG-A", kind: "X", retryable: "yes"})).toEqual(err);
    expect(one("x")).toEqual(err);
    expect(core.mapQueueAttention({blocked: [{packageId: "PKG-A", phase: 1, kind: "X"}, {packageId: "PKG-A", phase: 1, kind: "Y"}]}), "duplicate").toEqual(err);
    expect(core.mapQueueAttention({blocked: [], schedulerVerification: "bad value"})).toEqual(err);
    for (const raw of [null, undefined, [], "x", 1, {}, {blocked: {}}, {blocked: "x"}]) expect(core.mapQueueAttention(raw), JSON.stringify(raw)).toEqual(err);
  });
  it("waitSince derives elapsed time only from a usable timestamp; band edges are exact; future or missing times are unknown (never invented)", async () => {
    const core = await load("queue-core.js");
    expect(core.WAIT_BAND_IDS).toEqual(["UNDER_1H", "UNDER_1D", "UNDER_7D", "OVER_7D"]);
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    expect(core.waitSince(at(0), NOW)).toEqual({waitMs: 0, band: "UNDER_1H"});
    expect(core.waitSince(at(H - 1), NOW).band).toBe("UNDER_1H");
    expect(core.waitSince(at(H), NOW).band).toBe("UNDER_1D");
    expect(core.waitSince(at(D1 - 1), NOW).band).toBe("UNDER_1D");
    expect(core.waitSince(at(D1), NOW).band).toBe("UNDER_7D");
    expect(core.waitSince(at(7 * D1 - 1), NOW).band).toBe("UNDER_7D");
    expect(core.waitSince(at(7 * D1), NOW)).toEqual({waitMs: 7 * D1, band: "OVER_7D"});
    expect(core.waitSince(new Date(NOW + 1000).toISOString(), NOW)).toEqual({waitMs: null, band: null});
    for (const bad of [null, undefined, "", "garbage", 5]) expect(core.waitSince(bad, NOW), String(bad)).toEqual({waitMs: null, band: null});
    expect(core.waitSince(at(H), Number.NaN)).toEqual({waitMs: null, band: null});
    expect(core.bandOf(-1)).toBeNull();
    expect(core.bandOf(Number.NaN)).toBeNull();
    expect(core.waitParts(90061000)).toEqual({d: 1, h: 1, m: 1, totalMinutes: 1501});
    expect(core.waitParts(59999)).toEqual({d: 0, h: 0, m: 0, totalMinutes: 0});
    expect(core.waitParts(-1)).toBeNull();
    expect(core.waitParts(null)).toBeNull();
  });
});

// ---------------- (4) queue derivation ----------------
async function derive(over: Record<string, any> = {}, nowMs = NOW) {
  const core = await load("queue-core.js");
  const body = {"/v1/missions": MISSIONS, "/v1/work-runs": RUNS, "/v1/founder-attention": attentionBody(), ...over};
  const res = {missions: core.mapQueueMissions(body["/v1/missions"]), runs: core.mapQueueWorkRuns(body["/v1/work-runs"]), attention: core.mapQueueAttention(body["/v1/founder-attention"])};
  return {core, res, q: core.buildQueue(res, nowMs)};
}
describe("Queue — derivation is from recorded state only, deterministic, and never invents SLA or counts", () => {
  it("lists exactly the recorded waiting work, grouped by priority and ordered longest-wait first with unknown waits last", async () => {
    const {q} = await derive();
    expect(q.complete).toBe(true);
    expect(q.unreadable).toEqual([]);
    expect(q.groups.map((g: any) => [g.priority, g.items.map((i: any) => i.key)])).toEqual([
      [1, [K.fa, K.pkg, K.ph0]],
      [2, [K.gate, K.rep]],
      [3, [K.pf, K.pf2]]]);
    const by = (k: string) => q.items.find((i: any) => i.key === k);
    expect(by(K.fa)).toMatchObject({kind: "FOUNDER_ATTENTION", waitMs: 6 * H, band: "UNDER_1D", basis: "MISSION_CREATED", riskLevel: "R3", title: "Needs founder"});
    expect(by(K.pkg)).toMatchObject({kind: "BLOCKED_PACKAGE", waitMs: 4 * H, basis: "BLOCKED_AT", packageId: "PKG-A", phase: 3, blockerKind: "REVIEW_PENDING_PROVIDER_QUOTA", reason: "provider quota", retryable: true, title: null, riskLevel: null});
    expect(by(K.ph0)).toMatchObject({kind: "BLOCKED_PACKAGE", waitMs: null, band: null, basis: null, since: null, packageId: null, phase: 0, retryable: false});
    expect(by(K.gate)).toMatchObject({kind: "RUN_GATE", waitMs: 7 * D1, band: "OVER_7D", basis: "RUN_UPDATED", title: "Executing with gate", missionStatus: "EXECUTING", step: "REPORT"});
    expect(by(K.rep)).toMatchObject({kind: "DELIVERY_DECISION", waitMs: 2 * H, band: "UNDER_1D", missionStatus: "REPORTING", riskLevel: "R2"});
    expect(by(K.pf)).toMatchObject({kind: "AUTHORIZATION", waitMs: 3 * D1, band: "UNDER_7D", riskLevel: "R4"});
    expect(by(K.pf2)).toMatchObject({kind: "AUTHORIZATION", waitMs: 30 * 60000, band: "UNDER_1H", riskLevel: "R0"});
    // Kuyrukta olmayanlar: COMPLETE mission, çalışan/başarılı koşu, kapısı olmayan REPORTING mission, EXECUTING mission'ın kendisi.
    const keys = q.items.map((i: any) => i.key);
    for (const k of [`mission:${M_DONE}`, `mission:${M_REP2}`, `mission:${M_EXE}`, `mission:${M_REP}`, `run:${R_BUSY}`, `run:${R_OK}`]) expect(keys, k).not.toContain(k);
    expect(q.counts).toEqual({total: 7, byPriority: {1: 3, 2: 2, 3: 2}, byBand: {UNDER_1H: 1, UNDER_1D: 3, UNDER_7D: 1, OVER_7D: 1, UNKNOWN: 1}, longestWaitMs: 7 * D1});
    expect(q.schedulerVerification).toBe("VERIFIED");
  });
  it("the same inputs always give the same order; equal waits fall back to higher risk and then to the identifier", async () => {
    const same = {missions: [
      missionRow(MSN("a1"), {status: "PREFLIGHT", riskLevel: "R1", createdAt: "2026-10-17T10:00:00.000Z"}),
      missionRow(MSN("b2"), {status: "PREFLIGHT", riskLevel: "R4", createdAt: "2026-10-17T10:00:00.000Z"}),
      missionRow(MSN("c3"), {status: "PREFLIGHT", riskLevel: "R4", createdAt: "2026-10-17T10:00:00.000Z"}),
      missionRow(MSN("d4"), {status: "PREFLIGHT", riskLevel: "R0", createdAt: "2026-10-17T09:00:00.000Z"})]};
    const a = (await derive({"/v1/missions": same, "/v1/work-runs": {runs: []}, "/v1/founder-attention": attentionBody([])})).q;
    const b = (await derive({"/v1/missions": {missions: [...same.missions].reverse()}, "/v1/work-runs": {runs: []}, "/v1/founder-attention": attentionBody([])})).q;
    const order = (q: any) => q.items.map((i: any) => i.key);
    // En uzun bekleyen (R0, 3 sa) önce; eşit beklemelerde R4 > R1; R4'ler arasında kimlik sırası.
    expect(order(a)).toEqual([`mission:${MSN("d4")}`, `mission:${MSN("b2")}`, `mission:${MSN("c3")}`, `mission:${MSN("a1")}`]);
    expect(order(b)).toEqual(order(a));
  });
  it("kind is decided from the recorded mission status; a run whose mission is unknown or unreadable is a RUN_GATE with no invented title", async () => {
    const orphan = {runs: [runRow(RUN("99"), MSN("99"), {updatedAt: "2026-10-17T11:00:00.000Z"})]};
    const unknown = (await derive({"/v1/work-runs": orphan})).q;
    expect(unknown.items.find((i: any) => i.key === `run:${RUN("99")}`)).toMatchObject({kind: "RUN_GATE", title: null, missionKnown: false, missionStatus: null, riskLevel: null, waitMs: H});
    // mission listesi okunamaz: REPORTING/PREFLIGHT/FOUNDER_ATTENTION sınıflaması yapılamaz; koşular yine kapı bekleyen koşu olarak listelenir.
    const noMissions = (await derive({"/v1/missions": {nonsense: 1}})).q;
    expect(noMissions.complete).toBe(false);
    expect(noMissions.items.map((i: any) => i.key).sort()).toEqual([K.rep, K.gate, K.pkg, K.ph0].sort());
    expect(noMissions.items.find((i: any) => i.key === K.rep)).toMatchObject({kind: "RUN_GATE", title: null, missionKnown: false});
    // koşu listesi okunamaz: REPORTING mission'ın teslim kararı bilinemez, listelenmez.
    const noRuns = (await derive({"/v1/work-runs": {runs: "x"}})).q;
    expect(noRuns.items.map((i: any) => i.key).sort()).toEqual([K.fa, K.pf, K.pf2, K.pkg, K.ph0].sort());
    // founder-attention okunamaz: yalnız mission/koşu öğeleri.
    const noAtt = (await derive({"/v1/founder-attention": {schedulerVerification: "REJECTED"}})).q;
    expect(noAtt.items.map((i: any) => i.key).sort()).toEqual([K.fa, K.pf, K.pf2, K.rep, K.gate].sort());
  });
  it("an incomplete queue never reports counts, totals or a longest wait (null), and names the unreadable sources", async () => {
    for (const [over, unreadable, state] of [
      [{"/v1/founder-attention": {schedulerVerification: "REJECTED"}}, ["attention"], "UNAVAILABLE"],
      [{"/v1/missions": {x: 1}}, ["missions"], "ERROR"],
      [{"/v1/work-runs": {runs: [{}]}}, ["workRuns"], "ERROR"],
      [{"/v1/missions": {x: 1}, "/v1/work-runs": {x: 1}, "/v1/founder-attention": {x: 1}}, ["attention", "missions", "workRuns"], "ERROR"]] as const) {
      const {q} = await derive(over as any);
      expect(q.complete).toBe(false);
      expect(q.counts).toBeNull();
      expect(q.unreadable).toEqual(unreadable);
      expect(q.incompleteState).toBe(state);
    }
    const {core, res} = await derive();
    const offline = core.buildQueue({...res, runs: {state: "OFFLINE", runs: null}}, NOW);
    expect(offline.sources.workRuns.state).toBe("OFFLINE");
    expect(offline.incompleteState).toBe("OFFLINE");
    expect(core.buildQueue({missions: null, runs: undefined, attention: {}}, NOW).complete).toBe(false);
  });
  it("waits and bands are never faked: missing or future timestamps are unknown, and an empty complete queue has real zeros", async () => {
    const future = {missions: [missionRow(M_PF, {status: "PREFLIGHT", createdAt: "2026-10-18T00:00:00.000Z"})]};
    const {q} = await derive({"/v1/missions": future, "/v1/work-runs": {runs: []}, "/v1/founder-attention": attentionBody([])});
    expect(q.items[0]).toMatchObject({waitMs: null, band: null});
    expect(q.counts).toMatchObject({total: 1, longestWaitMs: null, byBand: {UNKNOWN: 1, UNDER_1H: 0}});
    const empty = (await derive({"/v1/missions": {missions: []}, "/v1/work-runs": {runs: []}, "/v1/founder-attention": attentionBody([])})).q;
    expect(empty.complete).toBe(true);
    expect(empty.items).toEqual([]);
    expect(empty.counts).toEqual({total: 0, byPriority: {1: 0, 2: 0, 3: 0}, byBand: {UNDER_1H: 0, UNDER_1D: 0, UNDER_7D: 0, OVER_7D: 0, UNKNOWN: 0}, longestWaitMs: null});
    expect(empty.groups.map((g: any) => g.items.length)).toEqual([0, 0, 0]);
  });
  it("priority is only a documented display order derived from the item kind (no recorded field is claimed)", async () => {
    const core = await load("queue-core.js");
    expect(core.QUEUE_KINDS).toEqual(["FOUNDER_ATTENTION", "BLOCKED_PACKAGE", "DELIVERY_DECISION", "RUN_GATE", "AUTHORIZATION"]);
    expect(core.PRIORITY_OF_KIND).toEqual({FOUNDER_ATTENTION: 1, BLOCKED_PACKAGE: 1, DELIVERY_DECISION: 2, RUN_GATE: 2, AUTHORIZATION: 3});
    expect(core.PRIORITIES).toEqual([1, 2, 3]);
    const src = read("queue-core.js");
    expect(src).not.toMatch(/\bsla(Target|Breach|Deadline|Status)\b|\boverdue\b|\bbreached\b/i);
    // Çekirdek, bağımsız kopya yerine yürütme çekirdeğinden gelen koşu enum'larını kullanır; eşitlik executive testiyle de korunur.
    const exec = await load("executive-core.js");
    expect(core.MISSIONS_PATH).toBe(exec.MISSIONS_PATH);
    expect(core.WORK_RUNS_PATH).toBe(exec.WORK_RUNS_PATH);
    expect(core.ATTENTION_PATH).toBe(exec.ATTENTION_PATH);
  });
});

// ---------------- (5) view honesty ----------------
describe("Queue — view honesty", () => {
  it("renders summary (section A) before the queue (section B) with real figures, grouped by priority and ordered longest wait first", async () => {
    const {root, calls} = await renderView(serve());
    expect(calls.slice().sort()).toEqual(PATHS);
    const sections = all(root).filter(n => n.tagName === "SECTION").map(n => n.id);
    expect(sections).toEqual(["queue-summary", "queue-list"]);
    expect(kpiValue(root, "total")).toBe("7");
    expect(kpiValue(root, "p1")).toBe("3");
    expect(kpiValue(root, "p2")).toBe("2");
    expect(kpiValue(root, "p3")).toBe("2");
    expect(itemsOf(root).map(n => n.dataset.queueItem)).toEqual([K.fa, K.pkg, K.ph0, K.gate, K.rep, K.pf, K.pf2]);
    expect(allData(root, "queueTier").map(n => [n.dataset.queueTier, n.dataset.count])).toEqual([["1", "3"], ["2", "2"], ["3", "2"]]);
    expect(byData(root, "longestWait")!.dataset.longestWait).toBe(String(7 * D1));
    expect(byData(root, "longestWait")!.textContent).toContain("7 d 0 h");
    expect(allData(root, "band").filter(n => n.tagName === "LI" && "bandCount" in n.dataset).map(n => [n.dataset.band, n.dataset.bandCount])).toEqual([["UNDER_1H", "1"], ["UNDER_1D", "3"], ["UNDER_7D", "1"], ["OVER_7D", "1"], ["UNKNOWN", "1"]]);
    // Her öğe: ne onay bekliyor, hangi mission/koşu, ne kadar bekledi, dürüst durum.
    const fa = itemFor(root, K.fa);
    expect(fa.textContent).toContain("Needs founder");
    expect(pills(fa)).toContain("ATTENTION");
    expect(field(fa, "needs")!.textContent).toContain("FOUNDER_ATTENTION_REQUIRED");
    expect(field(fa, "mission")!.textContent).toContain(M_FA);
    expect(field(fa, "waiting")!.textContent).toContain("6 h 0 min");
    expect(field(fa, "waiting")!.textContent).toContain("since the mission was created (no status-change time is recorded)");
    const pkg = itemFor(root, K.pkg);
    expect(pkg.textContent).toContain("PKG-A");
    expect(field(pkg, "blocker")!.textContent).toContain("REVIEW_PENDING_PROVIDER_QUOTA");
    expect(field(pkg, "reason")!.textContent).toBe("provider quota");
    expect(field(pkg, "retryable")!.textContent).toContain("Allowed (as reported by the server)");
    expect(field(pkg, "waiting")!.textContent).toContain("4 h 0 min");
    expect(field(pkg, "waiting")!.textContent).toContain("since it was recorded as blocked");
    // Süresi bilinmeyen öğe: "—" ve açık "bilinmiyor" metni, uydurma süre yok.
    const ph0 = itemFor(root, K.ph0);
    expect(ph0.textContent).toContain("Phase 0");
    expect(field(ph0, "waiting")!.textContent).toBe("Unknown — no usable recorded time");
    expect(allData(ph0, "waitMs")[0].dataset.waitMs).toBe("—");
    expect(ph0.dataset.band).toBe("UNKNOWN");
    const gate = itemFor(root, K.gate);
    expect(field(gate, "run")!.textContent).toContain(R_GATE);
    expect(field(gate, "run")!.textContent).toContain("AWAITING_APPROVAL");
    expect(field(gate, "waiting")!.textContent).toContain("7 d 0 h");
    expect(field(gate, "waiting")!.textContent).toContain("since the run's last recorded update");
    expect(gate.dataset.band).toBe("OVER_7D");
    expect(itemFor(root, K.rep).dataset.kind).toBe("DELIVERY_DECISION");
    expect(field(itemFor(root, K.rep), "risk")!.textContent).toBe("R2");
    expect(field(itemFor(root, K.pf2), "waiting")!.textContent).toContain("30 min");
    // Salt-okunur, SLA uydurmaz: öğelerde SLA/gecikme/son tarih sözcüğü yok; açıklama notları var.
    for (const li of itemsOf(root)) expect(li.textContent, li.dataset.queueItem).not.toMatch(/\bSLA\b|overdue|breach|deadline|at risk|on track/i);
    expect(byData(root, "note", "no-sla")!.textContent).toContain("No SLA target is recorded");
    expect(byData(root, "note", "no-bulk")!.textContent).toContain("There is no bulk action");
    expect(byData(root, "note", "actions")!.textContent).toContain("Nothing is approved from this queue.");
    expect(byData(root, "honesty", "1")!.textContent).toContain("No SLA targets are recorded");
    expect(byData(root, "readonly", "1")).toBeTruthy();
    expect(allData(root, "queueState").length).toBe(0);
    expect(byData(root, "queuePartial")).toBeUndefined();
  });
  it("EVERY scenario in EN and TR renders without the verified-product constant (even though the API carries it) and without raw i18n keys", async () => {
    const completion = {headSha: "c".repeat(40), productVerification: {state: FORBIDDEN}};
    const carrying = {runs: [...RUNS.runs, runRow(RUN("e5"), M_DONE, {status: "SUCCEEDED", completion})]};
    const scenarios: Array<[string, (p: string) => any]> = [
      ["full", serve()], ["carrying-forbidden", serve({"/v1/work-runs": carrying})],
      ["offline", () => { throw new Error("fetch failed"); }], ["unavailable", () => fail("x", 404)], ["error", () => fail("x", 500)], ["malformed", () => ({nonsense: true})],
      ["empty", serve({"/v1/work-runs": {runs: []}, "/v1/missions": {missions: []}, "/v1/founder-attention": attentionBody([])})],
      ["partial-attention", serve({"/v1/founder-attention": {schedulerVerification: "REJECTED", blocked: []}})],
      ["partial-missions", (p: string) => (p === "/v1/missions" ? fail(p, 500) : serve()(p))],
      ["partial-runs", (p: string) => (p === "/v1/work-runs" ? fail(p, 404) : serve()(p))]];
    for (const lang of ["en", "tr"]) for (const [name, fn] of scenarios) {
      const {root} = await renderView(fn, lang);
      const label = `${lang}/${name}`;
      expect(surface(root), label).not.toContain(FORBIDDEN);
      expect(root.textContent, label).not.toMatch(/product[\s_-]*verified/i);
      expect(lines(root), label).not.toMatch(/\b(queue|area\.queue)\.[A-Za-z]+(\.[A-Za-z_0-9]+)*\b/);
      expect(pills(root), label).not.toContain(FORBIDDEN);
    }
  });
  it("each source fails independently with its own honest state; healthy sources stay intact and figures are withheld", async () => {
    // founder-attention reddedildi (UNAVAILABLE): mission/koşu öğeleri listelenir, sayılar gösterilmez, kuyruk eksik bildirilir.
    let r = await renderView(serve({"/v1/founder-attention": {schedulerVerification: "REJECTED", blocked: []}}));
    expect(allData(r.root, "queueState").map(n => [n.dataset.source, n.dataset.queueState])).toEqual([["attention", "UNAVAILABLE"]]);
    expect(allData(r.root, "source").filter(n => n.tagName === "LI").map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["attention", "UNAVAILABLE"], ["missions", "VERIFIED"], ["workRuns", "VERIFIED"]]);
    expect(itemsOf(r.root).map(n => n.dataset.queueItem)).toEqual([K.fa, K.gate, K.rep, K.pf, K.pf2]);
    for (const id of ["total", "p1", "p2", "p3"]) { expect(kpiValue(r.root, id), id).toBe("—"); expect(kpi(r.root, id).dataset.state, id).toBe("UNAVAILABLE"); }
    expect(byData(r.root, "queuePartial")!.dataset.queuePartial).toBe("attention");
    expect(byData(r.root, "queuePartial")!.textContent).toContain("Founder attention could not be read");
    expect(byData(r.root, "longestWait")!.dataset.longestWait).toBe("—");
    expect(allData(r.root, "bandCount").every(n => n.dataset.bandCount === "—")).toBe(true);
    expect(allData(r.root, "tierEmpty").length).toBe(0);
    expect(byData(r.root, "queueState")!.textContent).toContain("GET /v1/founder-attention");
    // mission listesi bozuk (ERROR): hiçbir mission öğesi yok; koşular başlıksız ve açıkça "mission okunamadı" ile listelenir.
    r = await renderView(serve({"/v1/missions": {missions: [{...MISSIONS.missions[0], riskLevel: "R9"}]}}));
    expect(allData(r.root, "queueState").map(n => [n.dataset.source, n.dataset.queueState])).toEqual([["missions", "ERROR"]]);
    expect(itemsOf(r.root).map(n => n.dataset.queueItem)).toEqual([K.pkg, K.ph0, K.gate, K.rep]);
    expect(itemFor(r.root, K.rep).dataset.kind).toBe("RUN_GATE");
    expect(field(itemFor(r.root, K.rep), "mission")!.textContent).toContain("Mission title unavailable: the mission list could not be read");
    expect(kpiValue(r.root, "total")).toBe("—");
    expect(kpi(r.root, "total").dataset.state).toBe("ERROR");
    // koşu listesi çevrimdışı: REPORTING mission'ın teslim kararı bilinemez, listelenmez.
    r = await renderView((p: string) => (p === "/v1/work-runs" ? (() => { throw new Error("fetch failed"); })() : serve()(p)));
    expect(allData(r.root, "queueState").map(n => [n.dataset.source, n.dataset.queueState])).toEqual([["workRuns", "OFFLINE"]]);
    expect(itemsOf(r.root).map(n => n.dataset.queueItem)).toEqual([K.fa, K.pkg, K.ph0, K.pf, K.pf2]);
    expect(kpi(r.root, "total").dataset.state).toBe("OFFLINE");
    expect(pills(kpi(r.root, "total"))).toContain("OFFLINE");
  });
  it("when everything is unreadable no item and no figure is shown, and the queue is never called empty", async () => {
    for (const [fn, st] of [[() => { throw new Error("fetch failed"); }, "OFFLINE"], [() => fail("x", 404), "UNAVAILABLE"], [() => fail("x", 500), "ERROR"], [() => ({nonsense: true}), "ERROR"]] as const) {
      const {root} = await renderView(fn as any);
      expect(itemsOf(root).length).toBe(0);
      expect(allData(root, "queueState").map(n => n.dataset.queueState)).toEqual([st, st, st]);
      for (const id of ["total", "p1", "p2", "p3"]) expect(kpiValue(root, id), id).toBe("—");
      expect(byData(root, "queueEmpty", "unknown")!.textContent).toBe("None of the three sources could be read, so nothing can be said about the queue; it is not reported as empty.");
      expect(byData(root, "queueEmpty", "1")).toBeUndefined();
      expect(root.textContent).not.toContain("Nothing is awaiting human approval");
      expect(allData(root, "tierEmpty").length).toBe(0);
    }
  });
  it("a malformed record rejects only its own source: no partial figures or partial list from that source", async () => {
    const badRun = {runs: [RUNS.runs[0], {...RUNS.runs[1], step: "NOT_A_STEP"}]};
    const {root} = await renderView(serve({"/v1/work-runs": badRun}));
    expect(allData(root, "queueState").map(n => [n.dataset.source, n.dataset.queueState])).toEqual([["workRuns", "ERROR"]]);
    expect(itemsOf(root).map(n => n.dataset.queueItem)).toEqual([K.fa, K.pkg, K.ph0, K.pf, K.pf2]); // sağlam ilk koşu bile gösterilmez
    expect(kpiValue(root, "total")).toBe("—");
    const badAtt = await renderView(serve({"/v1/founder-attention": attentionBody([ATTENTION_ITEMS[0], {kind: "X"}])}));
    expect(allData(badAtt.root, "queueState").map(n => [n.dataset.source, n.dataset.queueState])).toEqual([["attention", "ERROR"]]);
    expect(itemsOf(badAtt.root).some(n => n.dataset.kind === "BLOCKED_PACKAGE")).toBe(false);
  });
  it("honest empty state: nothing waiting is a readable zero with explicit text, not a made-up number", async () => {
    const calm = {missions: [missionRow(M_EXE), missionRow(M_DONE, {status: "COMPLETE"})]};
    const {root} = await renderView(serve({"/v1/missions": calm, "/v1/work-runs": {runs: [runRow(R_BUSY, M_EXE, {status: "RUNNING", step: "IMPLEMENT"})]}, "/v1/founder-attention": attentionBody([])}));
    expect(itemsOf(root).length).toBe(0);
    expect(byData(root, "queueEmpty", "1")!.textContent).toBe("Nothing is awaiting human approval. All three read-only sources were read successfully and none lists an item that needs a decision.");
    expect(kpiValue(root, "total")).toBe("0");
    expect(allData(root, "tierEmpty").length).toBe(0);
    expect(allData(root, "queueTier").length).toBe(0);
    expect(allData(root, "band").filter(n => "bandCount" in n.dataset).every(n => n.dataset.bandCount === "0")).toBe(true);
    expect(byData(root, "longestWait")!.dataset.longestWait).toBe("—");
    expect(allData(root, "queueState").length).toBe(0);
  });
  it("an empty result from a partly unreadable queue is never called empty, and an empty tier says whether the queue is complete", async () => {
    const calm = {missions: [missionRow(M_EXE)]}, noRuns = {runs: []};
    let r = await renderView(serve({"/v1/missions": calm, "/v1/work-runs": noRuns, "/v1/founder-attention": {schedulerVerification: "REJECTED", blocked: []}}));
    expect(itemsOf(r.root).length).toBe(0);
    expect(byData(r.root, "queueEmpty", "unknown")!.textContent).toBe("No items were found in the readable sources, but the queue cannot be called empty because Founder attention could not be read.");
    expect(byData(r.root, "queueEmpty", "1")).toBeUndefined();
    expect(kpiValue(r.root, "total")).toBe("—");
    // Yalnız PREFLIGHT mission: 1. ve 2. düzey boştur; tam kuyrukta "öğe yok", eksik kuyrukta "okunabilen kaynaklarda öğe yok (kuyruk eksik)".
    const pre = {missions: [missionRow(M_PF, {status: "PREFLIGHT", createdAt: "2026-10-17T11:00:00.000Z"})]};
    r = await renderView(serve({"/v1/missions": pre, "/v1/work-runs": noRuns, "/v1/founder-attention": attentionBody([])}));
    expect(allData(r.root, "tierEmpty").map(n => [n.dataset.tierEmpty, n.textContent])).toEqual([["1", "No items at this priority."], ["2", "No items at this priority."]]);
    expect(allData(r.root, "queueTier").map(n => n.dataset.queueTier)).toEqual(["3"]);
    expect(kpiValue(r.root, "p1")).toBe("0");
    expect(kpiValue(r.root, "p3")).toBe("1");
    r = await renderView(serve({"/v1/missions": pre, "/v1/work-runs": {runs: "x"}, "/v1/founder-attention": attentionBody([])}));
    expect(allData(r.root, "tierEmpty").map(n => n.textContent)).toEqual(["No items at this priority in the readable sources (the queue is incomplete).", "No items at this priority in the readable sources (the queue is incomplete)."]);
    expect(kpiValue(r.root, "p1")).toBe("—");
    // Tier başlığındaki sayı yalnız LİSTELENEN öğe sayısıdır (toplam iddiası değil).
    expect(allData(r.root, "priority").filter(n => n.tagName === "DIV").map(n => all(n).find(c => c.tagName === "H3")!.textContent)).toEqual([
      "Priority 1 — Blocked work needing the Founder 0 listed", "Priority 2 — Delivery and run-gate decisions 0 listed", "Priority 3 — Authorization to start 1 listed"]);
  });
  it("very long queues are truncated honestly (the first 200 shown, the real total stated)", async () => {
    const many = {missions: Array.from({length: 205}, (_, i) => missionRow("msn_" + i.toString(16).padStart(24, "0"), {status: "PREFLIGHT", title: `T${i}`, createdAt: new Date(NOW - (i + 1) * 60000).toISOString()}))};
    const {root} = await renderView(serve({"/v1/missions": many, "/v1/work-runs": {runs: []}, "/v1/founder-attention": attentionBody([])}));
    expect(itemsOf(root).length).toBe(200);
    expect(byData(root, "note", "truncated")!.textContent).toBe("Showing the first 200 of 205 items (priority first, longest wait first within a priority).");
    expect(kpiValue(root, "total")).toBe("205");
    expect(itemsOf(root)[0].dataset.queueItem).toBe("mission:msn_" + (204).toString(16).padStart(24, "0")); // en uzun bekleyen
    expect(allData(root, "queueTier").map(n => [n.dataset.queueTier, n.dataset.count])).toEqual([["3", "200"]]);
    expect(allData(root, "tierEmpty").map(n => n.dataset.tierEmpty)).toEqual(["1", "2"]);
    expect(byData(root, "tierEmpty", "1")!.textContent).toBe("No items at this priority.");
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const m = {missions: [missionRow(M_PF, {status: "PREFLIGHT", title: "<b>x</b>"})]};
    const a = attentionBody([{packageId: "PKG-A", kind: "X", reason: "<img src=x onerror=alert(1)>", at: "2026-10-17T08:00:00.000Z"}]);
    const {root} = await renderView(serve({"/v1/missions": m, "/v1/work-runs": {runs: []}, "/v1/founder-attention": a}));
    expect(all(root).some(n => n.tagName === "IMG" || n.tagName === "B")).toBe(false);
    expect(root.textContent).toContain("<b>x</b>");
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root} = await renderView(serve(), "tr");
    expect(byId(root, "view-title")!.textContent).toBe("İnsan Onayı Bekleyen İş Kuyruğu");
    expect(kpiValue(root, "total")).toBe("7");
    expect(itemsOf(root).map(n => n.dataset.queueItem)).toEqual([K.fa, K.pkg, K.ph0, K.gate, K.rep, K.pf, K.pf2]);
    expect(field(itemFor(root, K.fa), "waiting")!.textContent).toContain("6 sa 0 dk");
    expect(field(itemFor(root, K.gate), "waiting")!.textContent).toContain("7 g 0 sa");
    expect(field(itemFor(root, K.ph0), "waiting")!.textContent).toBe("Bilinmiyor — kullanılabilir kayıtlı zaman yok");
    expect(root.textContent).toContain("Toplu eylem yoktur");
    expect(root.textContent).toContain("Öncelik 1");
  });
  it("navigation buttons only navigate to existing flows and never POST or fabricate a decision", async () => {
    const posts: unknown[][] = [];
    const queue = await load("views", "queue.js"), forms = await load("forms.js");
    const {ctx, nav, calls} = await mkCtx(serve(), "en", NOW, (p, b) => { posts.push([p, b]); return {status: 200, body: {}}; });
    const root: N = await queue.render(ctx);
    const buttons = all(root).filter(n => n.tagName === "BUTTON");
    expect(buttons.length).toBeGreaterThan(0);
    // Mission'lı 6 öğe -> Work; Gelen Kutusu: RUN_GATE hariç 6 öğe (3 mission/koşu + 2 paket + ...); RUN_GATE yalnız Work.
    expect(buttons.filter(n => n.dataset.navigate === "work").length).toBe(5);
    expect(buttons.filter(n => n.dataset.navigate === "inbox").length).toBe(6);
    for (const b of buttons) click(b);
    expect(nav.length).toBe(buttons.length);
    expect(new Set(nav)).toEqual(new Set(["work", "inbox"]));
    expect(forms.selection.missionId).toBe(M_PF2);
    expect(posts).toEqual([]);
    expect(calls.every(c => PATHS.includes(c))).toBe(true);
    expect(buttons.every(b => b.getAttribute("type") === "button")).toBe(true);
    // Hiçbir onay/ret/kabul düğmesi yok: yalnız gezinme.
    expect(buttons.map(b => b.textContent).every(t => /^(Open mission in Work|Open in Inbox)$/.test(t))).toBe(true);
    expect(all(root).some(n => n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "FORM" || n.tagName === "SELECT")).toBe(false);
    expect(byData(root, "note", "no-bulk")).toBeTruthy();
  });
});

// ---------------- (6) accessibility ----------------
describe("Queue — accessibility", () => {
  it("single labelled h1, exactly two labelled sections, a labelled KPI group, labelled lists per priority and machine-readable times", async () => {
    const {root} = await renderView(serve());
    const h1 = all(root).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    expect(all(root).filter(n => n.tagName === "SECTION").map(n => n.id)).toEqual(["queue-summary", "queue-list"]);
    for (const id of ["queue-summary", "queue-list"]) {
      const sec = byId(root, id)!;
      expect(byId(root, sec.getAttribute("aria-labelledby")!), id).toBeTruthy();
    }
    const group = all(root).find(n => n.getAttribute("role") === "group" && cls(n, "queue-kpis"))!;
    expect(group.getAttribute("aria-label")).toBe("Queue figures");
    const tiles = allData(group, "kpi");
    expect(tiles.length).toBe(4);
    for (const t of tiles) {
      expect(t.tagName).toBe("ARTICLE");
      expect(byId(root, t.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
      expect(all(t).some(n => "pill" in n.dataset)).toBe(true);
    }
    const lists = all(root).filter(n => n.tagName === "OL");
    expect(lists.length).toBe(3);
    for (const ol of lists) { expect(byId(root, ol.getAttribute("aria-labelledby")!)!.tagName, "tier heading").toBe("H3"); expect(ol.children.every(c => c.tagName === "LI")).toBe(true); }
    for (const li of itemsOf(root)) {
      expect(all(li).filter(n => n.tagName === "H4").length).toBe(1);
      for (const t of all(li).filter(n => n.tagName === "TIME")) { expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(t.textContent.length).toBeGreaterThan(3); }
      const grp = all(li).find(n => n.getAttribute("role") === "group")!;
      expect(grp.getAttribute("aria-label")).toMatch(/^Actions for /);
      for (const b of all(grp).filter(n => n.tagName === "BUTTON")) { expect(b.textContent.length).toBeGreaterThan(0); expect(b.id).toMatch(/^q-(open|inbox)-[A-Za-z0-9_-]+$/); }
    }
    for (const ul of all(root).filter(n => n.tagName === "UL" && (cls(n, "company-sources") || cls(n, "queue-bands")))) expect(ul.getAttribute("aria-label")).toBeTruthy();
    // Kimlikler benzersiz.
    const ids = all(root).map(n => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("definition lists are well-formed (dt/dd pairs) and every state pill carries text (state is never colour alone)", async () => {
    const {root} = await renderView(serve());
    const dls = all(root).filter(n => n.tagName === "DL");
    expect(dls.length).toBe(7);
    for (const dl of dls) {
      expect(dl.children.length % 2, "dl pairs").toBe(0);
      dl.children.forEach((c, i) => expect(c.tagName).toBe(i % 2 === 0 ? "DT" : "DD"));
    }
    for (const p of allData(root, "pill")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    for (const li of itemsOf(root)) expect(pills(li).some(p => p === "ATTENTION" || p === "WAITING"), li.dataset.queueItem).toBe(true);
  });
  it("failure blocks are status regions (role=status) with text, not colour alone", async () => {
    const {root} = await renderView(() => { throw new Error("fetch failed"); });
    const blocks = allData(root, "queueState");
    expect(blocks.length).toBe(3);
    for (const b of blocks) { expect(b.getAttribute("role")).toBe("status"); expect(b.textContent).toContain("Offline"); expect(pills(b)).toContain("OFFLINE"); }
    expect(byData(root, "queueEmpty")!.getAttribute("role")).toBe("status");
    expect(byData(root, "queuePartial")!.getAttribute("role")).toBe("status");
  });
  it("styles.css has container-query, forced-colors and focus coverage for the queue components and uses tokens only (no raw colours)", () => {
    const css = read("styles.css");
    const start = css.indexOf("İnsan Onayı Bekleyen İş Kuyruğu: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.queue-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    // Anlam renkle taşınmaz: öncelik rengi yalnız sol kenar vurgusudur; metin/rozet her öğede vardır.
    expect(mine).toMatch(/\.queue-item\[data-priority="1"\]\{border-left-color:var\(--danger\)\}/);
    for (const v of mine.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(css, v).toContain(`${v.slice(4, -1)}:`);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (7) locale parity ----------------
describe("Queue — locale parity and key coverage", () => {
  it("every queue.* / area.queue.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("queue.") || k.startsWith("area.queue.")).sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(80);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.queue.title"]).toBe("İnsan Onayı Bekleyen İş Kuyruğu");
    expect(en["area.queue.title"]).toBe("Human-Approval Queue");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
  });
  it("every literal and enumerated key used by queue.js exists in both dictionaries", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("queue-core.js");
    const src = read("views", "queue.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|emptyNote\(ctx,)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"(queue\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of ["total", "p1", "p2", "p3"]) need.add(`queue.kpi.${k}`);
    for (const k of ["total", "p1", "p2", "p3"]) need.add(`queue.kpi.q.${k}`);
    for (const k of core.QUEUE_SOURCES) { need.add(`queue.src.${k}`); need.add(`queue.srcShort.${k}`); }
    for (const k of core.QUEUE_KINDS) { need.add(`queue.kind.${k}`); need.add(`queue.kindDesc.${k}`); }
    for (const k of [...core.WAIT_BAND_IDS, "UNKNOWN"]) need.add(`queue.band.${k}`);
    for (const k of core.WAIT_BASES) need.add(`queue.basis.${k}`);
    for (const p of core.PRIORITIES) { need.add(`queue.tier.${p}`); need.add(`queue.tier.${p}.desc`); }
    for (const k of ["OFFLINE", "UNAVAILABLE", "ERROR"]) { need.add(`queue.state.${k}`); need.add(`queue.hint.${k}`); }
    for (const k of ["needs", "mission", "run", "package", "phase", "blocker", "reason", "retryable", "risk", "waiting", "band"]) need.add(`queue.field.${k}`);
    for (const k of ["dh", "hm", "m", "lt1m", "unknown"]) need.add(`queue.wait.${k}`);
    need.add("area.queue.title"); need.add("area.queue.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(70);
    // Sözlükte ölü anahtar kalmaz: her queue.* anahtarı görünümde/çekirdekte kullanılır.
    const used = (k: string) => need.has(k);
    expect(Object.keys(en).filter(k => (k.startsWith("queue.") || k.startsWith("area.queue.")) && !used(k))).toEqual([]);
  });
});

// ---------------- (8) routing ----------------
describe("Queue — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/queue to the planned host with component 'queue' (no plannedPackage), after executive and before settings, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("queue");
    expect(r).toMatchObject({id: "queue", hash: "#/queue", view: "planned", component: "queue", factory: false, icon: "clock"});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/queue")).toBe("queue");
    expect(routes.routeFromHash("#/queue/")).toBe("queue");
    expect(routes.routeFromHash("#/queues")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-6)).toEqual(["company", "academy", "journey", "executive", "queue", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("queue");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    // Eski rotalar etkilenmez.
    for (const id of ["executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
  });
  it("planned.js delegates the 'queue' component to the real view; app.js VIEWS table has no queue entry and is untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as queue from "./queue.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*queue[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("queue.js");
    expect(app).not.toMatch(/\bqueue\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const root: N = await planned.render(ctx, {id: "queue", component: "queue"});
    expect(cls(root, "view-queue")).toBe(true);
    expect(byId(root, "view-title")!.textContent).toBe("Human-Approval Queue");
    // Mevcut devredilen rotalar etkilenmez.
    const e = await planned.render((await mkCtx(serve({"/v1/cockpit": {nonsense: 1}}))).ctx, {id: "executive", component: "executive"});
    expect(cls(e, "view-executive")).toBe(true);
    const j = await planned.render((await mkCtx(serve())).ctx, {id: "journey", component: "journey"});
    expect(cls(j, "view-journey")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.queue.title")).toBe("İnsan Onayı Bekleyen İş Kuyruğu");
    expect(i18n.translate("en", "area.queue.desc")).toContain("Read-only.");
  });
});
