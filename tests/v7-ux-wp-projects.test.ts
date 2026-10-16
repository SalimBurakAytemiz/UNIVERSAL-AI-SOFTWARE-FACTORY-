// //TR: Bu test UX WP-PROJECTS premium portföy katmanının dürüstlüğünü gerçek görünüm modülleriyle doğrular: portföy özeti KPI'ları, portföy durumu şeridi ve proje kartları yalnız gerçek /v1/projects + /v1/missions + /v1/work-runs okumalarına bağlanır; proje listesi yokken (köprü reddi, 404, ağ) ayrık UNAVAILABLE/OFFLINE durumu "—" ile gösterilir, kart/şerit render edilmez; projeler canlı ama görev/koşu verisi canlı değilken kart içinde dürüst "veri canlı değil" denir, sayı/koşu uydurulmaz; görevler projelere gerçek projectId ile, koşular görev üzerinden eşlenir; etkin koşu yalnız ACTIVE kategorisindeki koşulardır; mevcut sihirbaz/içe aktarma/B5 form kimlikleri ve "Aç" akışı korunur; KPI satırı/grup/erişilebilir etiketler, TR/EN sözlük eşitliği ve token-only stiller kontrol edilir; görünümde HTML enjeksiyonu/ağ/depolama/rastgelelik yoktur.
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
const cards = (root: N) => all(root).filter(n => n.className.split(" ").includes("pf-card"));
const cardFor = (root: N, pid: string) => cards(root).find(c => c.dataset.projectId === pid)!;

const hex = (n: number) => n.toString(16).padStart(24, "0");
const P1 = `prj_${hex(1)}`, P2 = `prj_${hex(2)}`;
const M1 = `msn_${hex(11)}`, M2 = `msn_${hex(12)}`, M3 = `msn_${hex(13)}`, M4 = `msn_${hex(14)}`, M5 = `msn_${hex(15)}`;
const tm = (n: number) => `2026-10-1${n}T10:00:00.000Z`;

const PROJECTS = {projects: [
  {projectId: P1, name: "Mağaza", tenantId: "t1", environmentId: "local", createdAt: tm(1), repository: {path: "C:\\Projeler\\magaza"}},
  {projectId: P2, name: "Pazar", tenantId: "t1", environmentId: "staging", createdAt: tm(2), repository: {path: "C:\\Projeler\\pazar"}}
]};
const MISSIONS = {missions: [
  {missionId: M1, projectId: P1, title: "G1", status: "EXECUTING", riskLevel: "R1", createdAt: tm(1)},
  {missionId: M2, projectId: P1, title: "G2", status: "COMPLETE", riskLevel: "R1", createdAt: tm(2)},
  {missionId: M3, projectId: P2, title: "G3", status: "BLOCKED", riskLevel: "R3", createdAt: tm(3)},
  {missionId: M4, projectId: P2, title: "G4", status: "DRAFT", riskLevel: "R1", createdAt: tm(4)},
  {missionId: M5, projectId: P2, title: "G5", status: "WEIRD_STATE", riskLevel: "R1", createdAt: tm(5)}
]};
const RUNS = {workRuns: [
  {runId: "run_p1a", missionId: M1, status: "RUNNING", startedAt: tm(1)},
  {runId: "run_p1b", missionId: M1, status: "COMPLETE", startedAt: tm(3)},
  {runId: "run_p2a", missionId: M3, status: "STARTING", startedAt: tm(2)}
]};
const FAKE = ["Acme", "Contoso", "Globex", "Sample Project", "Demo Store", "99%", "uptime"];

const fromFix = (fix: Record<string, any>) => (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); };
const FULL: Record<string, any> = {"/v1/projects": PROJECTS, "/v1/missions": MISSIONS, "/v1/work-runs": RUNS};

async function mkCtx(get: (p: string) => any, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], selected: string[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return get(p); }, apiPost: async () => ({status: 201, body: {}})};
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, principal: "FOUNDER_LOCAL",
    navigate: () => {}, selectProject: (id: string) => { selected.push(id); store.selectProject(id); },
    rerender: async () => {}, refreshAll: async () => {}, confirm: async () => true, native: null};
  return {ctx, doc, store, calls, selected};
}

beforeEach(async () => { (await load("forms.js")).resetAllForms(); (await load("studio-state.js")).resetStudio(); });

describe("UX WP-PROJECTS honest states (no project data)", () => {
  it("shows UNAVAILABLE em-dash KPIs, honest state notes and no project cards when every read 404s", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(() => { throw new Error("x: HTTP 404"); });
    const root = await view.render(ctx);
    for (const id of ["pf-projects", "pf-environments", "pf-missions", "pf-runs"]) {
      expect(kpiValue(root, id), id).toBe("—");
      expect(pills(kpi(root, id)), id).toEqual(["UNAVAILABLE"]);
    }
    expect(cards(root).length).toBe(0);
    expect(all(root).some(n => n.className.includes("note-unavailable"))).toBe(true);
    for (const bad of FAKE) expect(root.textContent, bad).not.toContain(bad);
    // sihirbaz/içe aktarma/B5 formu yine durur
    for (const id of ["studio-wizard-form", "studio-import-form", "project-form", "project-submit"]) expect(byId(root, id), id).not.toBeNull();
  });

  it("marks OFFLINE separately from UNAVAILABLE", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(() => { throw new Error("fetch failed"); });
    const root = await view.render(ctx);
    expect(pills(kpi(root, "pf-projects"))).toEqual(["OFFLINE"]);
    expect(kpiValue(root, "pf-projects")).toBe("—");
    expect(cards(root).length).toBe(0);
  });

  it("keeps projects live but renders honest per-card notes (no invented missions or runs) when missions and runs are unavailable", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(fromFix({"/v1/projects": PROJECTS}));
    const root = await view.render(ctx);
    expect(kpiValue(root, "pf-projects")).toBe("2");
    expect(kpiValue(root, "pf-environments")).toBe("2");
    expect(kpiValue(root, "pf-missions")).toBe("—");
    expect(pills(kpi(root, "pf-missions"))).toEqual(["UNAVAILABLE"]);
    expect(kpiValue(root, "pf-runs")).toBe("—");
    expect(cards(root).length).toBe(2);
    const c1 = cardFor(root, P1);
    expect(c1.textContent).toContain("Görev verisi canlı değil");
    expect(c1.textContent).toContain("Koşu verisi canlı değil");
    // kart içinde hiç durum rozeti/koşu kimliği uydurulmaz
    expect(pills(c1)).toEqual([]);
    expect(all(c1).some(n => n.className.includes("pf-strip"))).toBe(false);
  });
});

describe("UX WP-PROJECTS with real data", () => {
  it("binds portfolio KPIs to the real reads: projects, distinct environments, total missions and only ACTIVE runs", async () => {
    const view = await load("views", "projects.js");
    const {ctx, calls} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    expect(calls).toContain("/v1/projects");
    expect(calls).toContain("/v1/missions");
    expect(calls).toContain("/v1/work-runs");
    expect(kpiValue(root, "pf-projects")).toBe("2");
    expect(kpiValue(root, "pf-environments")).toBe("2");
    expect(kpiValue(root, "pf-missions")).toBe("5");
    expect(kpiValue(root, "pf-runs")).toBe("2"); // RUNNING + STARTING, COMPLETE sayılmaz
    for (const id of ["pf-projects", "pf-environments", "pf-missions", "pf-runs"]) expect(pills(kpi(root, id)), id).toEqual(["VERIFIED"]);
    for (const bad of FAKE) expect(root.textContent, bad).not.toContain(bad);
  });

  it("aggregates the portfolio status strip by lifecycle category from real mission statuses only", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    const strip = byId(root, "projects-journey-strip")!;
    const items = all(strip).filter(n => "category" in n.dataset);
    expect(items.map(n => `${n.dataset.category}:${n.dataset.count}`)).toEqual(["IDLE:1", "ACTIVE:1", "BLOCKED:1", "DONE:1", "NEUTRAL:1"]);
  });

  it("renders dense project cards: real context facts, per-project mission distribution and the latest run via mission->project mapping", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    const c1 = cardFor(root, P1), c2 = cardFor(root, P2);
    expect(c1.textContent).toContain("Mağaza");
    expect(c1.textContent).toContain("local");
    expect(c1.textContent).toContain("C:\\Projeler\\magaza");
    expect(c1.textContent).toContain(P1);
    // P1 görev dağılımı: EXECUTING->ACTIVE, COMPLETE->DONE
    const s1 = byId(root, `pf-strip-${P1}`)!;
    expect(all(s1).filter(n => "category" in n.dataset).map(n => `${n.dataset.category}:${n.dataset.count}`)).toEqual(["ACTIVE:1", "DONE:1"]);
    // P1 son koşu: run_p1b (COMPLETE, en geç başlayan) -> DONE kategorisi + koşu kimliği
    const run1 = cls(c1, "pf-runline")[0];
    expect(run1.textContent).toContain("run_p1b");
    expect(pills(run1)).toEqual(["DONE"]);
    // P2 dağılımı ve son koşu (run_p2a, STARTING -> ACTIVE)
    const s2 = byId(root, `pf-strip-${P2}`)!;
    expect(all(s2).filter(n => "category" in n.dataset).map(n => `${n.dataset.category}:${n.dataset.count}`)).toEqual(["IDLE:1", "BLOCKED:1", "NEUTRAL:1"]);
    const run2 = cls(c2, "pf-runline")[0];
    expect(run2.textContent).toContain("run_p2a");
    expect(pills(run2)).toEqual(["ACTIVE"]);
  });

  it("shows honest empty states: no missions -> per-card and journey empty text; a project with no runs says so", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(fromFix({"/v1/projects": PROJECTS, "/v1/missions": {missions: []}, "/v1/work-runs": {workRuns: []}}));
    const root = await view.render(ctx);
    expect(kpiValue(root, "pf-missions")).toBe("0");
    expect(pills(kpi(root, "pf-missions"))).toEqual(["EMPTY"]);
    expect(root.textContent).toContain("Henüz görev oluşturulmadı.");
    const c1 = cardFor(root, P1);
    expect(c1.textContent).toContain("Bu projenin henüz görevi yok.");
    expect(c1.textContent).toContain("Bu proje için henüz koşu başlamadı.");
  });

  it("renders English copy when asked", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(fromFix(FULL), "en");
    const root = await view.render(ctx);
    expect(root.textContent).toContain("Company & product portfolio");
    expect(root.textContent).toContain("Portfolio status");
    expect(root.textContent).toContain("Project portfolio");
  });
});

describe("UX WP-PROJECTS studio entry and a11y", () => {
  it("preserves the open-project flow (selectProject + workspace) and the select button pressed state", async () => {
    const view = await load("views", "projects.js"), st = await load("studio-state.js");
    // Seçili projenin "Seç" düğmesi basılı ve devre dışıdır (studio kapalıyken, proje önceden seçili render edilerek)
    const pre = await mkCtx(fromFix(FULL));
    pre.store.selectProject(P1);
    const root2 = await view.render(pre.ctx);
    const c1 = cardFor(root2, P1);
    const selBtn = all(c1).find(n => n.tagName === "BUTTON" && n.getAttribute("aria-pressed") !== null)!;
    expect(selBtn.getAttribute("aria-pressed")).toBe("true");
    expect(selBtn.hasAttribute("disabled")).toBe(true);
    expect(c1.textContent).toContain("Etkin bağlam");
    // Seçili olmayan projenin "Seç" düğmesi basılı değildir
    expect(all(cardFor(root2, P2)).find(n => n.tagName === "BUTTON" && n.getAttribute("aria-pressed") !== null)!.getAttribute("aria-pressed")).toBe("false");
    // Aç akışı: selectProject çağrılır ve studio o projeyi açar
    const {ctx, selected} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    expect(byId(root, `open-${P1}`), "open button").not.toBeNull();
    byId(root, `open-${P1}`)!.fire("click");
    expect(st.studio.projectId).toBe(P1);
    expect(selected).toEqual([P1]);
  });

  it("exposes view-title, an accessible KPI group and cards labelled by their heading", async () => {
    const view = await load("views", "projects.js");
    const {ctx} = await mkCtx(fromFix(FULL));
    const root = await view.render(ctx);
    expect(byId(root, "view-title")!.tagName).toBe("H1");
    const group = all(root).find(n => n.getAttribute("role") === "group" && n.className.includes("kpi-row"))!;
    expect(group.getAttribute("aria-label")).toBe("Portföy özeti");
    const c1 = cardFor(root, P1);
    expect(c1.getAttribute("aria-labelledby")).toBe(`pf-card-${P1}-t`);
    expect(byId(root, `pf-card-${P1}-t`)!.tagName).toBe("H3");
    // şerit erişilebilir ad taşır
    expect(byId(root, "projects-journey-strip")!.getAttribute("role")).toBe("group");
    expect(byId(root, "projects-journey-strip")!.getAttribute("aria-label")).toContain("Portföy durumu");
  });
});

describe("UX WP-PROJECTS static safety and wiring", () => {
  it("has no HTML injection, network, storage or randomness in the view, and keeps the //TR header", () => {
    const src = read("views", "projects.js");
    const code = src.split(/\r?\n/).filter(l => !l.startsWith("//")).join("\n");
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|Math\.random/);
    expect(src.startsWith("// //TR:")).toBe(true);
    for (const bad of FAKE) expect(src, bad).not.toContain(bad);
    // view yalnız salt-okunur GET'leri okur (allMissions/workRuns) ve POST'u yalnız mevcut form akışından yapar
    expect(src).toMatch(/ctx\.api\.allMissions\(\)/);
    expect(src).toMatch(/ctx\.api\.workRuns\(\)/);
  });

  it("every translation key used by the new portfolio copy exists in TR and EN with matching placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const need = ["projects.eyebrow", "projects.subtitle", "projects.active", "projects.kpiGroup",
      "projects.kpi.projects", "projects.kpi.environments", "projects.kpi.missions", "projects.kpi.activeRuns",
      "projects.kpi.q.projects", "projects.kpi.q.environments", "projects.kpi.q.missions", "projects.kpi.q.activeRuns",
      "projects.journey.title", "projects.journey.lead", "projects.journey.empty",
      "projects.matrix.title", "projects.matrix.lead", "projects.card.missions", "projects.card.missionsUnavailable",
      "projects.card.noMissions", "projects.card.latestRun", "projects.card.noRun", "projects.card.runUnavailable"];
    const missing = need.filter(k => !(k in tr) || !(k in en));
    expect(missing).toEqual([]);
    for (const k of need) expect((en[k].match(/\{\w+\}/g) ?? []).sort().join(","), k).toBe((tr[k].match(/\{\w+\}/g) ?? []).sort().join(","));
  });

  it("styles define the portfolio classes with token colours only and a forced-colors fallback", () => {
    const css = read("styles.css");
    for (const c of [".pf-strip", ".pf-cards", ".pf-card", ".pf-card-head", ".pf-card-label", ".pf-runline", ".view-projects"]) expect(css, c).toContain(c);
    const block = css.slice(css.indexOf("UX WP-PROJECTS"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).toContain("forced-colors");
  });
});
