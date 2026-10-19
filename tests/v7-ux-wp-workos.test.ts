// //TR: Bu test UX WP-WORKOS premium görev/koşu katmanının dürüstlüğünü gerçek görünüm modülleriyle (views/work.js + api/model/work-core) ve sahte DOM ile doğrular: görev/koşu özeti KPI'ları (toplam mission, etkin koşu, Kurucu dikkati, gerçekten doğrulanmış koşu), yaşam-döngüsü dağılım şeridi, mission detayındaki koşu akışı zaman çizelgesi ve /v1/evidence kanıt bağlama bölümü yalnız gerçek /v1/missions + /v1/work-runs + /v1/evidence okumalarına bağlanır. Veri yokken (köprü reddi, 404, ağ) ayrık UNAVAILABLE/OFFLINE "—" ile gösterilir, şerit/kart/KPI uydurulmaz; "doğrulanmış koşu" yalnız gerçek test-yürütme kanıtı (VERIFY_TESTS/REGRESSION_TESTS) olan koşuyu sayar (FD-REL-1), SOURCE_GENERATION_COMPLETE/PRODUCT_VERIFIED/PASS metni görünümde icat edilmez; mevcut form/filtre/detay akışı ve geçiş kimlikleri korunur; KPI grup/şerit erişilebilir etiketleri, TR/EN sözlük eşitliği ve token-only stiller kontrol edilir; görünümde HTML enjeksiyonu/ağ/depolama/rastgelelik yoktur.
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; value = ""; checked = false; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
}
class D {
  body: N;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (root: N, id: string) => all(root).find(n => n.id === id) ?? null;
const kpi = (root: N, id: string) => all(root).find(n => n.dataset.kpi === id)!;
const kpiValue = (root: N, id: string) => cls(kpi(root, id), "kpi-value")[0].textContent;
const cls = (n: N, c: string) => all(n).filter(x => x.className.split(" ").includes(c));
const pills = (n: N) => all(n).filter(x => "pill" in x.dataset).map(x => x.dataset.pill);
const byData = (root: N, key: string, val?: string) => all(root).filter(n => key in n.dataset && (val === undefined || n.dataset[key] === val));

const hex = (n: number) => n.toString(16).padStart(24, "0");
const M1 = `msn_${hex(11)}`, M2 = `msn_${hex(12)}`, M3 = `msn_${hex(13)}`, M4 = `msn_${hex(14)}`, M5 = `msn_${hex(15)}`, M6 = `msn_${hex(16)}`;
const EV1 = "ev_test_log_0001", EV2 = "ev_review_0002";
const tm = (n: number) => `2026-10-1${n}T10:00:00.000Z`;

const MISSIONS = {missions: [
  {missionId: M1, projectId: "prj", title: "G1", status: "EXECUTING", riskLevel: "R1", createdAt: tm(1)},
  {missionId: M2, projectId: "prj", title: "G2", status: "COMPLETE", riskLevel: "R1", createdAt: tm(2)},
  {missionId: M3, projectId: "prj", title: "G3", status: "BLOCKED", riskLevel: "R3", createdAt: tm(3)},
  {missionId: M4, projectId: "prj", title: "G4", status: "DRAFT", riskLevel: "R1", createdAt: tm(4)},
  {missionId: M5, projectId: "prj", title: "G5", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R4", createdAt: tm(5)},
  {missionId: M6, projectId: "prj", title: "G6", status: "WEIRD_STATE", riskLevel: "R1", createdAt: tm(6)}
]};
// run3 taşır gerçek test-yürütme kanıtı (VERIFY_TESTS) -> testsExecuted; diğerleri taşımaz
const RUNS = {workRuns: [
  {runId: "run_a1", missionId: M1, status: "RUNNING", startedAt: tm(1)},
  {runId: "run_a2", missionId: M3, status: "STARTING", startedAt: tm(2)},
  {runId: "run_c3", missionId: M2, status: "COMPLETE", startedAt: tm(3), evidence: [{evidenceId: EV1, kind: "VERIFY_TESTS", verification: "VERIFIED"}]}
]};
const FORBIDDEN = ["PRODUCT_VERIFIED —", "SOURCE_GENERATION_COMPLETE", "Acme", "Contoso", "99% uptime", "Sample Mission"];

const fromFix = (fix: Record<string, any>) => (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); };
const FULL: Record<string, any> = {"/v1/missions": MISSIONS, "/v1/projects": {projects: []}, "/v1/work-runs": RUNS};

async function mkCtx(get: (p: string) => any, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return get(p); }, apiPost: async () => ({status: 201, body: {}})};
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, principal: "FOUNDER_LOCAL",
    navigate: (id: string) => { nav.push(id); }, selectProject: () => {},
    rerender: async () => {}, refreshAll: async () => {}, confirm: async () => true, native: null};
  return {ctx, doc, store, calls, nav};
}

let forms: any;
beforeEach(async () => { forms = await load("forms.js"); forms.resetAllForms(); (await load("studio-state.js")).resetStudio(); (await load("kanban-core.js")).resetBoard(); });

describe("UX WP-WORKOS honest states (no data)", () => {
  it("shows UNAVAILABLE em-dash KPIs, honest overview note and no lifecycle strip when every read 404s; keeps the mission form", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(() => { throw new Error("x: HTTP 404"); });
    const root = await view.render(ctx);
    for (const id of ["wk-missions", "wk-active", "wk-attention", "wk-verified"]) {
      expect(kpiValue(root, id), id).toBe("—");
      expect(pills(kpi(root, id)), id).toEqual(["UNAVAILABLE"]);
    }
    expect(byId(root, "work-overview-strip")).toBeNull();
    expect(all(root).some(n => n.className.includes("note-unavailable"))).toBe(true);
    expect(byId(root, "mission-form"), "form").not.toBeNull();
    expect(byId(root, "mission-submit"), "submit").not.toBeNull();
    for (const bad of FORBIDDEN) expect(root.textContent, bad).not.toContain(bad);
  });

  it("marks OFFLINE separately from UNAVAILABLE", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(() => { throw new Error("fetch failed"); });
    const root = await view.render(ctx);
    expect(pills(kpi(root, "wk-missions"))).toEqual(["OFFLINE"]);
    expect(kpiValue(root, "wk-missions")).toBe("—");
  });
});

describe("UX WP-WORKOS with real data", () => {
  it("binds the overview KPIs to real reads: total missions, only ACTIVE runs, blocked+attention missions and only test-executed verified runs", async () => {
    const view = await load("views", "work.js");
    const {ctx, calls} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    expect(calls).toContain("/v1/missions");
    expect(calls).toContain("/v1/work-runs");
    expect(kpiValue(root, "wk-missions")).toBe("6");
    expect(kpiValue(root, "wk-active")).toBe("2"); // RUNNING + STARTING, COMPLETE sayılmaz
    expect(kpiValue(root, "wk-attention")).toBe("2"); // BLOCKED + FOUNDER_ATTENTION_REQUIRED
    expect(kpiValue(root, "wk-verified")).toBe("1"); // yalnız VERIFY_TESTS kanıtı olan koşu
    for (const id of ["wk-missions", "wk-active", "wk-attention"]) expect(pills(kpi(root, id)), id).toEqual(["VERIFIED"]);
    for (const bad of FORBIDDEN) expect(root.textContent, bad).not.toContain(bad);
    expect(root.textContent).not.toMatch(/\bPASS(ED)?\b|\bworks\b/);
  });

  it("aggregates the lifecycle strip by category from real mission statuses only", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    const strip = byId(root, "work-overview-strip")!;
    const items = all(strip).filter(n => "category" in n.dataset);
    expect(items.map(n => `${n.dataset.category}:${n.dataset.count}`)).toEqual(["IDLE:1", "ACTIVE:1", "ATTENTION:1", "BLOCKED:1", "DONE:1", "NEUTRAL:1"]);
  });

  it("verified-runs KPI is honestly EMPTY (0) when no run carries test-execution evidence (FD-REL-1)", async () => {
    const view = await load("views", "work.js");
    const noTests = {workRuns: [{runId: "run_x", missionId: M1, status: "RUNNING", startedAt: tm(1)}]};
    const {ctx} = await mkCtx(fromFix({"/v1/missions": MISSIONS, "/v1/projects": {projects: []}, "/v1/work-runs": noTests}));
    const root = await view.render(ctx);
    expect(kpiValue(root, "wk-verified")).toBe("0");
    expect(pills(kpi(root, "wk-verified"))).toEqual(["EMPTY"]);
  });

  it("shows honest empty overview when there are no missions", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(fromFix({"/v1/missions": {missions: []}, "/v1/projects": {projects: []}, "/v1/work-runs": {workRuns: []}}));
    const root = await view.render(ctx);
    expect(kpiValue(root, "wk-missions")).toBe("0");
    expect(pills(kpi(root, "wk-missions"))).toEqual(["EMPTY"]);
    expect(byId(root, "work-overview-strip")).toBeNull();
    expect(root.textContent).toContain("Henüz görev oluşturulmadı.");
  });

  it("renders English copy when asked", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(fromFix(FULL), "en");
    const root = await view.render(ctx);
    expect(root.textContent).toContain("Tasks & agent operations");
    expect(root.textContent).toContain("Mission lifecycle");
  });
});

describe("UX WP-WORKOS mission detail: run flow timeline and evidence linking", () => {
  const detailFix = (evidence?: any) => ({
    ...FULL,
    [`/v1/missions/${M1}`]: {mission: {missionId: M1, projectId: "prj", title: "G1", objective: "Hedef", acceptanceCriteria: ["k1"], riskLevel: "R1", status: "EXECUTING", createdAt: tm(1)}, tasks: []},
    [`/v1/work-runs?missionId=${M1}`]: {workRuns: [
      {runId: "run_a1", missionId: M1, status: "RUNNING", startedAt: tm(1), step: {name: "doğrulama", index: 2, total: 4}, role: "qa-engineer"},
      {runId: "run_a0", missionId: M1, status: "COMPLETE", startedAt: tm(3)}
    ]},
    [`/v1/work-runs/run_a1`]: {workRun: {runId: "run_a1", missionId: M1, status: "RUNNING", startedAt: tm(1)}},
    [`/v1/work-runs/run_a0`]: {workRun: {runId: "run_a0", missionId: M1, status: "COMPLETE", startedAt: tm(3)}},
    ...(evidence !== undefined ? {[`/v1/evidence?missionId=${M1}&limit=12`]: evidence} : {})
  });

  it("renders a chronological run-flow timeline (newest first) with status pills and honest NOT_VERIFIED badges", async () => {
    const view = await load("views", "work.js");
    forms.selection.missionId = M1;
    const {ctx} = await mkCtx(fromFix(detailFix()));
    const root = await view.render(ctx);
    const tl = byId(root, "work-run-timeline")!;
    expect(tl).not.toBeNull();
    const titles = cls(tl, "tl-title").map(n => n.textContent);
    expect(titles).toEqual(["run_a0", "run_a1"]); // en yeni (tm3) önce
    // zaman çizelgesi durum + adımı gösterir; doğrulama iddiası (PRODUCT_VERIFIED/PASS) uydurulmaz
    expect(tl.textContent).toContain("doğrulama");
    expect(tl.textContent).not.toMatch(/PRODUCT_VERIFIED —|\bPASS(ED)?\b/);
  });

  it("links real /v1/evidence records to the assurance view with an honest verification chip; no evidence is invented", async () => {
    const view = await load("views", "work.js");
    forms.selection.missionId = M1;
    const evidence = {evidence: [
      {evidenceId: EV1, missionId: M1, runId: "run_a1", kind: "TEST_LOG", verification: "VERIFIED", sourcePath: "/repo/log.txt", createdAt: tm(1)},
      {evidenceId: EV2, missionId: M1, runId: "run_a1", kind: "REVIEW", verification: "MISMATCH", createdAt: tm(2)}
    ]};
    const {ctx, calls, nav} = await mkCtx(fromFix(detailFix(evidence)));
    const root = await view.render(ctx);
    expect(calls).toContain(`/v1/evidence?missionId=${M1}&limit=12`);
    const listNode = byId(root, "work-evidence-list")!;
    const itemIds = byData(listNode, "evidenceId").filter(n => n.className.includes("evidence-item")).map(n => n.dataset.evidenceId);
    expect(itemIds).toEqual([EV1, EV2]);
    expect(listNode.textContent).toContain("TEST_LOG");
    expect(listNode.textContent).toContain(EV1);
    expect(listNode.textContent).toContain("/repo/log.txt");
    // kanıta tıklamak seçimi işaretler ve Güvence görünümüne gider (uydurma eylem yok)
    const link = all(listNode).find(n => n.tagName === "BUTTON" && n.textContent.includes(EV1))!;
    link.fire("click");
    expect(forms.selection.evidenceId).toBe(EV1);
    expect(nav).toEqual(["assurance"]);
  });

  it("shows an honest UNAVAILABLE note (no invented evidence) when /v1/evidence 404s for the selected mission", async () => {
    const view = await load("views", "work.js");
    forms.selection.missionId = M1;
    const {ctx} = await mkCtx(fromFix(detailFix())); // evidence yolu fixture'da yok -> 404
    const root = await view.render(ctx);
    expect(byId(root, "work-evidence-list")).toBeNull();
    const detail = byId(root, "work-detail")!;
    expect(detail.textContent).toContain("Kanıt verisi şu an kullanılamıyor.");
  });

  it("keeps an honest empty evidence note when the mission has no evidence records", async () => {
    const view = await load("views", "work.js");
    forms.selection.missionId = M1;
    const {ctx} = await mkCtx(fromFix(detailFix({evidence: []})));
    const root = await view.render(ctx);
    expect(byId(root, "work-detail")!.textContent).toContain("Bu mission için henüz kanıt kaydı yok.");
  });
});

// //TR: UI-023 Görev Kanban Panosu: pano yalnız mevcut GET /v1/missions satırlarını yaşam-döngüsü sütunlarına dağıtır; varsayılan düzen liste kalır, tanınmayan durum atılmaz, geçiş panodan yapılmaz (mission ayrıntısı açılır).
const boardRender = async (fix: Record<string, any> = FULL, lang = "en") => {
  const view = await load("views", "work.js");
  const m = await mkCtx(fromFix(fix), lang);
  let reruns = 0; m.ctx.rerender = async () => { reruns++; };
  const root = await view.render(m.ctx);
  return {view, root, ...m, reruns: () => reruns};
};
const columns = (root: N) => byData(root, "boardColumn").map(n => `${n.dataset.boardColumn}:${n.dataset.count}`);

describe("UI-023 mission Kanban board (renderer-only, honest columns)", () => {
  it("core: lifecycle columns always shown (0 when empty), off-path statuses only when present, unrecognised statuses kept in their own last column; every mission placed exactly once", async () => {
    const kb = await load("kanban-core.js"), wc = await load("work-core.js");
    const cols = kb.boardColumns(MISSIONS.missions);
    expect(cols.map((c: any) => c.status)).toEqual([...wc.MISSION_PATH, "BLOCKED", "FOUNDER_ATTENTION_REQUIRED", "UNRECOGNIZED"]);
    expect(cols.reduce((n: number, c: any) => n + c.count, 0)).toBe(MISSIONS.missions.length);
    expect(cols.find((c: any) => c.status === "UNRECOGNIZED")).toMatchObject({known: false, count: 1});
    expect(cols.find((c: any) => c.status === "UNRECOGNIZED").items[0].status).toBe("WEIRD_STATE");
    expect(cols.filter((c: any) => c.known && wc.MISSION_PATH.includes(c.status) && c.count === 0).length).toBe(wc.MISSION_PATH.length - 3);
    expect(kb.boardColumns([]).map((c: any) => c.status)).toEqual([...wc.MISSION_PATH]);
    expect(kb.boardColumns(null).every((c: any) => c.count === 0)).toBe(true);
    expect(kb.OFF_PATH_STATUSES.every((s: string) => wc.MISSION_STATUSES.includes(s) && !wc.MISSION_PATH.includes(s))).toBe(true);
    const many = Array.from({length: 55}, (_, i) => ({missionId: `msn_${hex(100 + i)}`, projectId: "prj", title: `T${i}`, status: "EXECUTING", riskLevel: "R1", createdAt: tm(1)}));
    const ex = kb.boardColumns(many).find((c: any) => c.status === "EXECUTING");
    expect([ex.count, ex.items.length, ex.truncated]).toEqual([55, kb.MAX_CARDS_PER_COLUMN, true]);
    expect(kb.boardLayout()).toBe("list");
    expect(kb.setBoardLayout("grid")).toBe(false);
    expect(kb.boardLayout()).toBe("list");
    expect(kb.setBoardLayout("board")).toBe(true);
    kb.resetBoard();
    expect(kb.boardLayout()).toBe("list");
  });

  it("the default layout is still the list (filter bar + table); the layout toggle is a labelled group of pressed-state buttons", async () => {
    const {root} = await boardRender();
    expect(byData(root, "filter")[0].dataset.filter).toBe("ALL");
    expect(byData(root, "missionId").length).toBe(6);
    expect(byId(root, "work-board")).toBeNull();
    const toggle = all(root).find(n => cls(n, "layout-toggle").length === 0 && n.className.includes("layout-toggle"))!;
    expect([toggle.getAttribute("role"), toggle.getAttribute("aria-label")]).toEqual(["group", "Mission layout"]);
    expect(byData(root, "layout").map(n => [n.dataset.layout, n.getAttribute("aria-pressed"), n.getAttribute("type"), n.textContent])).toEqual([["list", "true", "button", "List"], ["board", "false", "button", "Board"]]);
  });

  it("switching to Board re-renders into lifecycle columns with real counts; list-only controls disappear; unrecognised status keeps its raw value", async () => {
    const first = await boardRender();
    byData(first.root, "layout", "board")[0].fire("click");
    expect(first.reruns()).toBe(1);
    const {root} = await boardRender();
    expect(byData(root, "filter").length).toBe(0);
    expect(byData(root, "missionId").length).toBe(0);
    expect(columns(root)).toEqual(["DRAFT:1", "PREFLIGHT:0", "AUTHORIZED:0", "PLANNED:0", "EXECUTING:1", "VERIFYING:0", "REVIEWING:0", "REGRESSION:0", "REPORTING:0", "COMPLETE:1", "BLOCKED:1", "FOUNDER_ATTENTION_REQUIRED:1", "UNRECOGNIZED:1"]);
    expect(byData(root, "boardMission").map(n => n.dataset.boardMission).sort()).toEqual([M1, M2, M3, M4, M5, M6].sort());
    const odd = byData(root, "boardColumn", "UNRECOGNIZED")[0];
    expect(odd.textContent).toContain("Unrecognised status");
    expect(odd.textContent).toContain("WEIRD_STATE");
    expect(byData(root, "layout", "board")[0].getAttribute("aria-pressed")).toBe("true");
    expect(byData(root, "note", "board-honesty")[0].textContent).toContain("mission detail");
    for (const bad of FORBIDDEN) expect(root.textContent, bad).not.toContain(bad);
  });

  it("a card opens the existing mission detail (selection + re-render); the board itself issues no POST and no extra GET", async () => {
    (await load("kanban-core.js")).setBoardLayout("board");
    const {root, calls, reruns} = await boardRender();
    expect([...new Set(calls)].sort()).toEqual(["/v1/missions", "/v1/projects", "/v1/work-runs"]);
    const card = byData(root, "boardMission", M1)[0];
    const btn = all(card).find(n => n.tagName === "BUTTON")!;
    expect([btn.getAttribute("type"), btn.textContent, btn.dataset.focusKey]).toEqual(["button", "G1", `kb-${M1}`]);
    btn.fire("click");
    expect(forms.selection.missionId).toBe(M1);
    expect(reruns()).toBe(1);
    const again = await boardRender();
    expect(byData(again.root, "boardMission", M1)[0].dataset.selected).toBe("1");
    expect(all(byData(again.root, "boardMission", M1)[0]).find(n => n.tagName === "BUTTON")!.getAttribute("aria-current")).toBe("true");
  });

  it("accessibility: labelled board group, sections labelled by their h3, labelled card lists, machine-readable times, empty columns say so in text", async () => {
    (await load("kanban-core.js")).setBoardLayout("board");
    const {root} = await boardRender();
    const board = byId(root, "work-board")!;
    expect([board.getAttribute("role"), board.getAttribute("aria-label")]).toEqual(["group", "Mission board by lifecycle status, 6 missions"]);
    for (const sec of byData(root, "boardColumn")) {
      expect(sec.tagName).toBe("SECTION");
      const head = byId(root, sec.getAttribute("aria-labelledby")!)!;
      expect(head.tagName).toBe("H3");
      expect(head.textContent).toContain(sec.dataset.count!);
      const list = all(sec).find(n => n.tagName === "UL");
      if (Number(sec.dataset.count)) { expect(list!.getAttribute("aria-label")).toMatch(/: \d+ missions$/); }
      else { expect(list).toBeUndefined(); expect(sec.textContent).toContain("No missions."); }
    }
    for (const t of all(board).filter(n => n.tagName === "TIME")) expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const tr = await boardRender(FULL, "tr");
    expect(byId(tr.root, "work-board")!.getAttribute("aria-label")).toBe("Yaşam döngüsü durumuna göre görev panosu, 6 görev");
  });

  it("honest states win over the board: unreadable missions show the state note, an empty list shows the empty note", async () => {
    (await load("kanban-core.js")).setBoardLayout("board");
    const down = await boardRender({"/v1/projects": {projects: []}, "/v1/work-runs": RUNS});
    expect(byId(down.root, "work-board")).toBeNull();
    expect(byData(down.root, "boardColumn").length).toBe(0);
    const empty = await boardRender({...FULL, "/v1/missions": {missions: []}});
    expect(byId(empty.root, "work-board")).toBeNull();
  });

  it("locale keys exist in TR and EN with identical placeholders; the core has no network, storage, randomness or HTML sinks; CSS uses tokens and has a forced-colors fallback", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = Object.keys(en).filter(k => k.startsWith("work.board."));
    expect(keys.sort()).toEqual(Object.keys(tr).filter(k => k.startsWith("work.board.")).sort());
    expect(keys.length).toBe(9);
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect((en[k].match(/\{\w+\}/g) ?? []).sort().join(","), k).toBe((tr[k].match(/\{\w+\}/g) ?? []).sort().join(",")); }
    const core = read("kanban-core.js");
    expect(core.startsWith("// //TR:")).toBe(true);
    expect(core.split(/\r?\n/).filter(l => !l.startsWith("//")).join("\n")).not.toMatch(/innerHTML|fetch\(|XMLHttpRequest|localStorage|sessionStorage|Math\.random|Date\.now|apiPost|\bpost\(/);
    const css = read("styles.css"), block = css.slice(css.indexOf("UI-023 Görev Kanban Panosu"), css.indexOf("UX WP-AGENTS"));
    expect(block.length).toBeGreaterThan(200);
    expect(block).toContain(".kanban-cols{");
    expect(block).toContain("forced-colors");
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

describe("UX WP-WORKOS a11y and static safety", () => {
  it("exposes view-title, an accessible KPI group and a labelled lifecycle strip", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    expect(byId(root, "view-title")!.tagName).toBe("H1");
    const group = all(root).find(n => n.getAttribute("role") === "group" && n.className.includes("kpi-row"))!;
    expect(group.getAttribute("aria-label")).toBe("Görev & koşu özeti");
    const strip = byId(root, "work-overview-strip")!;
    expect(strip.getAttribute("role")).toBe("group");
    expect(strip.getAttribute("aria-label")).toContain("Görev yaşam döngüsü");
  });

  it("preserves the mission filter bar and table so the existing list flow is unbroken", async () => {
    const view = await load("views", "work.js");
    const {ctx} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    expect(byData(root, "filter").map(n => n.dataset.filter)[0]).toBe("ALL");
    expect(byData(root, "missionId").length).toBe(6);
  });

  it("has no HTML injection, network, storage or randomness in the view and keeps the //TR header", () => {
    const src = read("views", "work.js");
    const code = src.split(/\r?\n/).filter(l => !l.startsWith("//")).join("\n");
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Math\.random/);
    expect(src.startsWith("// //TR:")).toBe(true);
    expect(src).toMatch(/ctx\.api\.missions\(\)/);
    expect(src).toMatch(/ctx\.api\.workRuns\(\)/);
    expect(src).toMatch(/ctx\.api\.evidenceList\(/);
    // fabrikasyon/marka metinleri yalnız yorum-dışı kodda aranır (başlık yorumu dürüstlük kuralını anlatırken bu tokenleri anabilir)
    for (const bad of FORBIDDEN) expect(code, bad).not.toContain(bad);
  });

  it("every translation key used by the new work-os copy exists in TR and EN with matching placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const need = ["work.eyebrow", "work.subtitle", "work.kpiGroup",
      "work.kpi.missions", "work.kpi.activeRuns", "work.kpi.attention", "work.kpi.verifiedRuns",
      "work.kpi.q.missions", "work.kpi.q.activeRuns", "work.kpi.q.attention", "work.kpi.q.verifiedRuns",
      "work.overview.title", "work.overview.lead", "work.overview.empty",
      "work.runtl.title", "work.runtl.lead",
      "work.evidence.title", "work.evidence.lead", "work.evidence.none", "work.evidence.unavailable"];
    const missing = need.filter(k => !(k in tr) || !(k in en));
    expect(missing).toEqual([]);
    for (const k of need) expect((en[k].match(/\{\w+\}/g) ?? []).sort().join(","), k).toBe((tr[k].match(/\{\w+\}/g) ?? []).sort().join(","));
  });

  it("styles define the work-os classes with token colours only and a forced-colors fallback", () => {
    const css = read("styles.css");
    for (const c of [".view-work", ".run-timeline", ".evidence-list", ".evidence-item", ".evidence-head", ".evidence-meta"]) expect(css, c).toContain(c);
    const block = css.slice(css.indexOf("UX WP-WORKOS"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).toContain("forced-colors");
  });
});
