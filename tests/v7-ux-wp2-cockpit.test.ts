// //TR: Bu test UX WP2 premium Founder Cockpit'inin dürüstlüğünü gerçek görünüm modülleriyle doğrular: /v1/cockpit verisi yokken (404) KPI karoları "—" ve UNAVAILABLE/DOĞRULANMADI gösterir, referans görseldeki uydurma sayılar (Alex, 12 proje, 47 ajan, %96,8) hiçbir yerde çıkmaz; delta ve grafik yalnız gerçek örnekle çizilir; KPI karoları klavye ile ilgili ekrana gider; durum rozetleri ikon+metin ve ayrıktır.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
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
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
}
class D {
  body: N;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const kpis = (root: N) => all(root).filter(n => "kpi" in n.dataset);
const kpi = (root: N, id: string) => kpis(root).find(n => n.dataset.kpi === id)!;
const cls = (n: N, c: string) => all(n).filter(x => x.className.split(" ").includes(c));

async function mkCtx(get: (p: string) => any, lang = "tr", principal: string | null = "FOUNDER_LOCAL") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), navigated: string[] = [];
  const bridge = {apiGet: async (p: string) => { const r = get(p); if (r === undefined) throw new Error(`${p}: HTTP 404`); return r; }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate: (id: string) => { navigated.push(id); }, principal};
  return {ctx, doc, store, navigated};
}
const PID = "prj_" + "a1".repeat(12);
const REAL = {
  generatedAt: "2026-10-15T10:00:00.000Z", globalStop: {active: false, reason: null},
  projects: {state: "VERIFIED", count: 3},
  missions: {state: "VERIFIED", total: 5, byStatus: {EXECUTING: 2, BLOCKED: 1, COMPLETE: 2}},
  awaitingApproval: {state: "VERIFIED", items: [{missionId: "msn_" + "b".repeat(24), projectId: PID, title: "T", riskLevel: "R2"}]},
  orchestrator: {state: "VERIFIED", asOf: "2026-10-15T09:00:00.000Z", packages: {total: 4, byStatus: {MERGED: 4}}, source: "ORCHESTRATOR_STATE"},
  workforce: {state: "VERIFIED", registeredRoles: 7, canonicalRegisteredRoles: 7, targetRoles: 9, activeWorkerRuns: 1, source: "REG"},
  evidence: {state: "VERIFIED", total: 10, verified: 6, mismatch: 1, missing: 1, unverifiable: 2, sources: {}}
};
const FAKE_REFERENCE = ["Alex", "Chen", "47", "96,8", "96.8", "%96"];

describe("UX WP2 cockpit honesty (no backend data)", () => {
  it("every KPI shows an em-dash and UNAVAILABLE/DOGRULANMADI when /v1/cockpit returns 404, with no delta, sparkline polyline, bars or reference numbers", async () => {
    const home = await load("views", "home.js");
    const {ctx} = await mkCtx(() => undefined);
    const root = await home.render(ctx, {id: "home"});
    const cards = kpis(root);
    expect(cards.map(c => c.dataset.kpi)).toEqual(["projects", "missions", "approvals", "alerts", "evidence", "workforce"]);
    for (const c of cards) {
      expect(c.dataset.state, c.dataset.kpi).toBe("UNAVAILABLE");
      expect(c.textContent, c.dataset.kpi).toContain("UNAVAILABLE");
      expect(c.textContent, c.dataset.kpi).toContain("—");
      expect(cls(c, "kpi-delta").length, c.dataset.kpi).toBe(0);
      expect(cls(c, "minibars").length, c.dataset.kpi).toBe(0);
      expect(all(c).filter(n => n.tagName === "POLYLINE").length, c.dataset.kpi).toBe(0);
      expect(all(c).some(n => n.dataset.pill === "UNAVAILABLE"), c.dataset.kpi).toBe(true);
      expect(cls(c, "kpi-risk").length + (c.className.includes("kpi-risk") ? 1 : 0), c.dataset.kpi).toBe(0);
    }
    for (const c of cards.filter(x => x.dataset.kpi !== "workforce")) expect(cls(c, "kpi-value")[0].textContent, c.dataset.kpi).toBe("—");
    expect(cls(kpi(root, "workforce"), "kpi-value").map(n => n.textContent)).toEqual(["—", "—"]);
    expect(kpi(root, "projects").textContent).toContain("DOĞRULANMADI");
    const whole = root.textContent;
    for (const bad of FAKE_REFERENCE) expect(whole, bad).not.toContain(bad);
    expect(whole).toContain("Cockpit servisi henüz kullanılamıyor");
  });

  it("the hero takes identity only from the real principal and never invents a name", async () => {
    const home = await load("views", "home.js");
    const a = await mkCtx(() => undefined);
    const root = await home.render(a.ctx, {id: "home"});
    const idChip = all(root).find(n => "identity" in n.dataset)!;
    expect(idChip.dataset.identity).toBe("FOUNDER_LOCAL");
    expect(idChip.textContent).toContain("Kurucu");
    expect(all(root).some(n => "tenant" in n.dataset)).toBe(false);
    const b = await mkCtx(() => undefined, "tr", null);
    const root2 = await home.render(b.ctx, {id: "home"});
    expect(all(root2).some(n => "identity" in n.dataset)).toBe(false);
    expect(root2.textContent).toContain("Veri zamanı: —");
  });

  it("an OFFLINE cockpit shows OFFLINE pills, not numbers", async () => {
    const home = await load("views", "home.js");
    const {ctx} = await mkCtx(() => { throw new Error("fetch failed"); });
    const root = await home.render(ctx, {id: "home"});
    for (const c of kpis(root)) { expect(c.dataset.state).toBe("OFFLINE"); expect(all(c).some(n => n.dataset.pill === "OFFLINE")).toBe(true); }
  });

  it("the loading skeleton has no numbers", async () => {
    const home = await load("views", "home.js");
    const {ctx} = await mkCtx(() => undefined);
    const root = home.skeleton(ctx);
    for (const c of kpis(root)) expect(c.dataset.state).toBe("LOADING");
    expect(root.textContent).not.toMatch(/\d{2,}/);
  });
});

describe("UX WP2 cockpit with real data", () => {
  it("binds each KPI to the cockpit read model and draws bars only from returned breakdowns; one sample gives no delta or sparkline", async () => {
    const home = await load("views", "home.js");
    const {ctx} = await mkCtx(p => (p === "/v1/cockpit" ? REAL : p === "/v1/projects" ? {projects: [{projectId: PID, name: "Uygulama", tenantId: "t1", environmentId: "local"}]} : undefined));
    const root = await home.render(ctx, {id: "home"});
    const val = (id: string) => cls(kpi(root, id), "kpi-value").map(n => n.textContent);
    expect(val("projects")).toEqual(["3"]);
    expect(val("missions")).toEqual(["5"]);
    expect(val("approvals")).toEqual(["1"]);
    expect(val("alerts")).toEqual(["1"]);
    expect(val("evidence")).toEqual(["6"]);
    expect(val("workforce")).toEqual(["7", "1"]);
    expect(cls(kpi(root, "missions"), "minibars").length).toBe(1);
    expect(cls(kpi(root, "evidence"), "minibars").length).toBe(1);
    expect(cls(kpi(root, "projects"), "minibars").length).toBe(0);
    for (const c of kpis(root)) { expect(cls(c, "kpi-delta").length, c.dataset.kpi).toBe(0); expect(all(c).filter(n => n.tagName === "POLYLINE").length, c.dataset.kpi).toBe(0); }
    expect(kpi(root, "alerts").className).toContain("kpi-risk");
    expect(kpi(root, "evidence").className).toContain("kpi-risk");
    expect(kpi(root, "workforce").className).toContain("kpi-live");
    expect(kpi(root, "projects").className).not.toMatch(/kpi-risk|kpi-live/);
    expect(kpi(root, "projects").textContent).toContain("COCKPIT:projects");
    expect(all(root).find(n => "tenant" in n.dataset)!.textContent).toContain("t1");
    for (const bad of FAKE_REFERENCE) expect(root.textContent, bad).not.toContain(bad);
  });

  it("draws a signed delta and sparkline only from two or more real session samples, labelled as session", async () => {
    const home = await load("views", "home.js");
    const {ctx, store} = await mkCtx(p => (p === "/v1/cockpit" ? REAL : undefined));
    store.samples.set("projects", [1, 3]);
    store.samples.set("alerts", [3, 1]);
    store.samples.set("missions", [5]);
    const root = await home.render(ctx, {id: "home"});
    const d = cls(kpi(root, "projects"), "kpi-delta")[0];
    expect(d.textContent).toContain("+2");
    expect(d.textContent).toContain("oturum");
    expect(all(kpi(root, "projects")).filter(n => n.tagName === "POLYLINE").length).toBe(1);
    expect(cls(kpi(root, "alerts"), "kpi-delta")[0].textContent).toContain("−2");
    expect(cls(kpi(root, "alerts"), "kpi-delta")[0].className).toContain("delta-good");
    expect(cls(kpi(root, "missions"), "kpi-delta").length).toBe(0);
  });

  it("does not draw a delta for a block that is not live even if old samples remain", async () => {
    const home = await load("views", "home.js");
    const {ctx, store} = await mkCtx(() => undefined);
    store.samples.set("projects", [1, 3]);
    const root = await home.render(ctx, {id: "home"});
    expect(cls(kpi(root, "projects"), "kpi-delta").length).toBe(0);
  });

  it("KPI drill-down navigates to the existing screen by click and by Enter/Space and is keyboard focusable", async () => {
    const home = await load("views", "home.js");
    const {ctx, navigated} = await mkCtx(p => (p === "/v1/cockpit" ? REAL : undefined));
    const root = await home.render(ctx, {id: "home"});
    const expected: Record<string, string> = {projects: "projects", missions: "work", approvals: "inbox", alerts: "work", evidence: "assurance", workforce: "workforce"};
    for (const [id, route] of Object.entries(expected)) {
      const c = kpi(root, id);
      expect(c.getAttribute("tabindex"), id).toBe("0");
      expect(c.getAttribute("role"), id).toBe("link");
      expect(c.dataset.drill, id).toBe(route);
      navigated.length = 0;
      c.fire("click");
      c.fire("keydown", {key: "Enter"});
      c.fire("keydown", {key: " "});
      c.fire("keydown", {key: "a"});
      expect(navigated, id).toEqual([route, route, route]);
    }
  });
});

describe("UX WP2 model and components", () => {
  it("kpiTrend needs two real samples; formatDelta is signed", async () => {
    const m = await load("model.js");
    expect(m.kpiTrend([])).toBeNull();
    expect(m.kpiTrend([4])).toBeNull();
    expect(m.kpiTrend([null, undefined, 4])).toBeNull();
    expect(m.kpiTrend([1, 4, 3]).delta).toBe(2);
    expect(m.kpiTrend([2, 2]).direction).toBe("flat");
    expect(m.formatDelta(3)).toBe("+3");
    expect(m.formatDelta(-3)).toBe("−3");
    expect(m.formatDelta(0)).toBe("±0");
    expect(m.formatDelta(NaN)).toBe("—");
  });
  it("mapCockpit reads the evidence block only from VERIFIED/STALE states and emptyCockpit carries no evidence numbers", async () => {
    const m = await load("model.js");
    expect(m.mapCockpit(REAL).evidence).toMatchObject({state: "VERIFIED", value: 6, total: 10, verified: 6, mismatch: 1, missing: 1, unverifiable: 2});
    const bad = m.mapCockpit({evidence: {state: "UNAVAILABLE", total: 5, verified: 5, mismatch: 0, missing: 0, unverifiable: 0}}).evidence;
    expect([bad.value, bad.total, bad.verified, bad.mismatch, bad.missing, bad.unverifiable]).toEqual([null, null, null, null, null, null]);
    const e = m.emptyCockpit("UNAVAILABLE").evidence;
    expect([e.value, e.total, e.verified]).toEqual([null, null, null]);
    expect(m.mapCockpit({evidence: {state: "VERIFIED", total: "9", verified: -1}}).evidence.verified).toBeNull();
  });
  it("pill kinds keep ERROR, UNAVAILABLE, OFFLINE and STALE distinct", async () => {
    const m = await load("model.js");
    expect(m.pillKindFor(null)).toBe("LOADING");
    expect(m.pillKindFor({state: "ERROR"})).toBe("FAILED");
    expect(m.pillKindFor({state: "UNAVAILABLE", value: null})).toBe("UNAVAILABLE");
    expect(m.pillKindFor({state: "OFFLINE"})).toBe("OFFLINE");
    expect(m.pillKindFor({state: "STALE", value: 3})).toBe("STALE");
    expect(m.pillKindFor({state: "VERIFIED", value: 0})).toBe("EMPTY");
    expect(m.pillKindFor({state: "VERIFIED", value: 2})).toBe("VERIFIED");
    expect(m.missionPillKind("BLOCKED")).toBe("BLOCKED");
    expect(m.missionPillKind("FAILED")).toBe("FAILED");
    expect(m.missionPillKind("SOMETHING_NEW")).toBe("NEUTRAL");
    expect(m.PILL_KINDS).toEqual(expect.arrayContaining(["FAILED", "BLOCKED", "DENIED", "STALE", "OFFLINE", "NOT_CONNECTED", "UNAVAILABLE", "NOT_EXECUTED", "NOT_VERIFIED", "PRODUCT_VERIFIED"]));
  });
  it("each status pill has an icon and its own text; the ten distinct kinds never share a label or an icon path", async () => {
    const comp = await load("components.js"), icons = await load("icons.js");
    const {ctx} = await mkCtx(() => undefined);
    const kinds = ["FAILED", "BLOCKED", "DENIED", "STALE", "OFFLINE", "NOT_CONNECTED", "UNAVAILABLE", "NOT_EXECUTED", "NOT_VERIFIED", "PRODUCT_VERIFIED"];
    const labels = new Set<string>(), paths = new Set<string>();
    for (const k of kinds) {
      const p = comp.statePill(ctx, k);
      expect(p.dataset.pill).toBe(k);
      expect(all(p).some(n => n.tagName === "SVG")).toBe(true);
      labels.add(p.textContent);
      paths.add(all(p).find(n => n.tagName === "PATH")!.attrs.get("d")!);
    }
    expect(labels.size).toBe(kinds.length);
    expect(paths.size).toBe(kinds.length);
    expect(labels.has("PRODUCT_VERIFIED")).toBe(true);
    expect(icons.ICON_NAMES).toEqual(expect.arrayContaining(["ban", "lock", "plug", "wifioff", "help", "dashedcircle", "xcircle"]));
  });
  it("timeline items carry time, project attribution only when given, and a status pill", async () => {
    const comp = await load("components.js");
    const {ctx} = await mkCtx(() => undefined);
    const withAttr = comp.timelineItem(ctx, {time: "10:00:00", iso: "2026-10-15T10:00:00.000Z", title: "Görev A", attribution: "Proje: Uygulama", pill: comp.missionPill(ctx, "BLOCKED")});
    expect(withAttr.textContent).toContain("Proje: Uygulama");
    expect(withAttr.textContent).toContain("BLOCKED");
    expect(all(withAttr).some(n => n.dataset.pill === "BLOCKED")).toBe(true);
    const without = comp.timelineItem(ctx, {time: "10:00:00", title: "Görev B", pill: comp.missionPill(ctx, "EXECUTING")});
    expect(cls(without, "tl-attr").length).toBe(0);
  });
  it("both languages have every new key and the renderer sources use no inline style or HTML injection", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const src = ["views/home.js", "components.js", "shell.js"].map(f => read(...f.split("/"))).join("\n");
    const need = new Set<string>();
    for (const m of src.matchAll(/"((?:kpi|pill|home|feed)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of ["FAILED", "BLOCKED", "DENIED", "STALE", "OFFLINE", "NOT_CONNECTED", "UNAVAILABLE", "NOT_EXECUTED", "NOT_VERIFIED", "PRODUCT_VERIFIED", "LOADING", "EMPTY", "VERIFIED", "ACTIVE", "WAITING", "ATTENTION", "DONE", "STOPPED", "IDLE", "NEUTRAL"]) need.add(`pill.${k}`);
    expect([...need].filter(k => !/[${]/.test(k) && !(k in tr && k in en))).toEqual([]);
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\bstyle\s*:|setAttribute\(\s*["']style/);
    expect(read("styles.css")).toMatch(/\.kpi-risk\{[^}]*glow-risk/);
  });
});
