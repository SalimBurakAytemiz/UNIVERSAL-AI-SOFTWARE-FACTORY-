// //TR: Bu test UX WP4 Control Tower 2B haritasını gerçek görünüm modülleriyle doğrular: kanonik rol kaydından sayfalanan /v1/roles ve work-runs verisiyle 10 küme / 51 lonca haritası ile eşdeğer listenin aynı gerçek veriyi göstermesi, GLOBAL_STOP, klavye seçimi, eksik kaynakta dürüst VERİ YOK (uydurma sayı yok), animasyon ve 3B olmaması, güvenli işaretleme dönüşümü ve rol sayfası bütünlüğü.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; style: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
  getAttribute(k: string) { return k === "class" && this.className ? this.className : this.attrs.get(k) ?? null; }
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
const byTag = (n: N, t: string) => all(n).filter(x => x.tagName === t.toUpperCase());

const raw = JSON.parse(fs.readFileSync("registries/role-definitions.json", "utf8"));
const REG_ROLES: Array<{roleId: string; guildId: string; clusterId: string; title: string}> = [...raw.roles].sort((a: any, b: any) => (a.roleId < b.roleId ? -1 : 1));
const GUILD_COUNT: Record<string, number> = {};
for (const r of REG_ROLES) GUILD_COUNT[r.guildId] = (GUILD_COUNT[r.guildId] ?? 0) + 1;

// Sunucunun /v1/roles sayfalama davranışı (roleId artan, imleç = son roleId, limit<=100).
function rolesRoute(p: string) {
  const u = new URL("http://x" + p);
  const limit = Number(u.searchParams.get("limit") ?? 50), cursor = u.searchParams.get("cursor");
  const after = cursor ? REG_ROLES.filter(r => r.roleId > cursor) : REG_ROLES, page = after.slice(0, limit);
  return {status: "X", notice: "n", registeredRoles: REG_ROLES.length, total: REG_ROLES.length, limit, cursor, nextCursor: after.length > limit ? page[page.length - 1].roleId : null,
    items: page.map(r => ({roleId: r.roleId, title: r.title, guildId: r.guildId, clusterId: r.clusterId, priority: "P1"}))};
}
const rid = (i: number) => "run_" + String(i).padStart(24, "0");
const wr = (i: number, status: string, role: string | null) => ({runId: rid(i), missionId: "msn_" + "c".repeat(24), status, role});
const GUILD_OF = new Map(REG_ROLES.map(r => [r.roleId, r.guildId]));

interface Feed {cockpit?: any; roles?: boolean; workRuns?: any[] | null; control?: any; rolesMutate?: (p: any, page: number) => any}
async function mkCtx(feed: Feed, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), navigated: string[] = [], calls: string[] = [];
  let page = 0;
  const bridge = {apiGet: async (p: string) => {
    calls.push(p);
    if (p.startsWith("/v1/roles")) { if (feed.roles === false) throw new Error("INVALID_API_PATH"); const body = rolesRoute(p); return feed.rolesMutate ? feed.rolesMutate(body, page++) : body; }
    if (p === "/v1/cockpit") { if (feed.cockpit === undefined) throw new Error("/v1/cockpit: HTTP 404"); return feed.cockpit; }
    if (p === "/v1/work-runs") { if (!feed.workRuns) throw new Error("/v1/work-runs: HTTP 404"); return {workRuns: feed.workRuns}; }
    if (p === "/v1/control/status") { if (feed.control === undefined) throw new Error("HTTP 404"); return feed.control; }
    throw new Error(`${p}: HTTP 404`);
  }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate: (id: string) => { navigated.push(id); }, principal: "FOUNDER_LOCAL", renderAttention() {}, requestStop() {}, resume() {}};
  return {ctx, doc, navigated, calls};
}
const COCKPIT = (active = false, reason: string | null = null) => ({generatedAt: "2026-10-15T10:00:00.000Z", globalStop: {active, reason}});
const campusOf = (view: N) => all(view).find(n => n.className === "ct-campus")!;
const key = (n: N) => [n.getAttribute("data-guild-id"), n.getAttribute("data-target-roles"), n.getAttribute("data-active-runs"), n.getAttribute("data-state")].join("|");
const rowsSvg = (c: N) => all(c).filter(n => n.attrs.has("data-guild-id") && n.getAttribute("class") === "building").map(key).sort();
const rowsList = (c: N) => byTag(c, "tr").filter(n => n.attrs.has("data-guild-id")).map(key).sort();
const mount = async (feed: Feed, lang = "tr") => {
  const m = await mkCtx(feed, lang), tower = await load("views", "tower.js");
  const view: N = await tower.render(m.ctx);
  return {...m, view, campus: campusOf(view)};
};
const summaryOf = (c: N) => all(c).find(n => n.dataset.ctSummary === "1")!.textContent;

const RUNS = [
  wr(1, "RUNNING", "UASCO-0001"), wr(2, "VERIFYING", "UASCO-0001"), wr(3, "LEASED", "UASCO-0002"), wr(4, "QUEUED", "UASCO-0001"),
  wr(5, "COMPLETED", "UASCO-0001"), wr(6, "RUNNING", "NOT-A-ROLE"), wr(7, "CHECKPOINTING", null)
];

describe("UX WP4 control tower 2D map with real data", () => {
  it("mounts a 10-cluster / 51-guild map and an equivalent list from the paged /v1/roles feed, cockpit global stop and work-runs", async () => {
    const {campus, calls} = await mount({cockpit: COCKPIT(), workRuns: RUNS});
    const cursors = REG_ROLES.filter((_, i) => i % 100 === 99 && i < REG_ROLES.length - 1).map(r => `/v1/roles?limit=100&cursor=${r.roleId}`);
    expect(calls.filter(c => c.startsWith("/v1/roles"))).toEqual(["/v1/roles?limit=100", ...cursors]);
    expect(campus.dataset.globalState).toBe("RUNNING");
    expect(campus.dataset.districts).toBe("10");
    expect(campus.dataset.buildings).toBe("51");
    const svg = rowsSvg(campus), list = rowsList(campus);
    expect(svg).toHaveLength(51);
    expect(list).toEqual(svg);
    expect(new Set(svg.map(r => r.split("|")[0])).size).toBe(51);
    for (const r of svg) { const [g, target, active, state] = r.split("|"); expect(Number(target)).toBe(GUILD_COUNT[g]); expect(state).toBe("VERIFIED"); expect(active).toMatch(/^\d+$/); }
    // aktif run yalnız rol kimliği kayıtlı loncaya eşleniyorsa binaya yazılır; diğerleri atanamayan sayılır
    const g1 = GUILD_OF.get("UASCO-0001")!, g2 = GUILD_OF.get("UASCO-0002")!;
    const act = (g: string) => Number(svg.find(r => r.startsWith(g + "|"))!.split("|")[2]);
    if (g1 === g2) expect(act(g1)).toBe(3);
    else { expect(act(g1)).toBe(2); expect(act(g2)).toBe(1); }
    expect(svg.reduce((s, r) => s + Number(r.split("|")[2]), 0)).toBe(3);
    const summary = summaryOf(campus);
    expect(summary).toContain("10 küme");
    expect(summary).toContain("51 lonca");
    expect(summary).toContain(`${REG_ROLES.length} hedef rol`);
    expect(summary).toContain("3 aktif run");
    expect(campus.textContent).toContain("Binaya atanamayan aktif run: 2");
  });

  it("shows the english locale on the same data", async () => {
    const {campus} = await mount({cockpit: COCKPIT(), workRuns: RUNS}, "en");
    expect(summaryOf(campus)).toContain("10 clusters · 51 guilds");
    expect(campus.textContent).toContain("Campus list (2D equivalent view)");
  });

  it("marks the whole campus STOPPED with an alert overlay when cockpit.globalStop is active, and falls back to /v1/control/status when the cockpit is absent", async () => {
    const stopped = await mount({cockpit: COCKPIT(true, "Founder stop"), workRuns: []});
    expect(stopped.campus.dataset.globalState).toBe("STOPPED");
    expect(all(stopped.campus).some(n => n.getAttribute("class") === "stopped-overlay" && n.getAttribute("role") === "alert")).toBe(true);
    expect(stopped.campus.textContent).toContain("Founder stop");
    const viaControl = await mount({control: {globalStop: {active: true, reason: "from control"}}, workRuns: []});
    expect(viaControl.campus.dataset.globalState).toBe("STOPPED");
    expect(viaControl.campus.textContent).toContain("from control");
  });

  it("selects a guild by keyboard on the map and by click on the list with the same detail, and opens existing screens only", async () => {
    const {campus, navigated} = await mount({cockpit: COCKPIT(), workRuns: RUNS});
    const b = all(campus).filter(n => n.getAttribute("class") === "building");
    expect(b.every(n => n.getAttribute("tabindex") === "0" && n.getAttribute("role") === "button" && n.getAttribute("aria-label"))).toBe(true);
    const first = b[0], id = first.getAttribute("data-guild-id")!;
    const detail = () => all(campus).find(n => n.id === "ct-detail")!.textContent;
    expect(detail()).toContain("Ayrıntı için");
    first.fire("keydown", {key: "a"});
    expect(first.getAttribute("aria-pressed")).not.toBe("true");
    let prevented = false;
    first.fire("keydown", {key: "Enter", preventDefault() { prevented = true; }});
    expect(prevented).toBe(true);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    const btn = all(campus).find(n => n.dataset.ctGuild === id)!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(detail()).toContain(`Seçili lonca: ${id}`);
    expect(detail()).toContain(String(GUILD_COUNT[id]));
    const other = all(campus).find(n => n.dataset.ctGuild && n.dataset.ctGuild !== id)!;
    other.fire("click");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(detail()).toContain(`Seçili lonca: ${other.dataset.ctGuild}`);
    all(campus).find(n => n.id === "ct-open-workforce")!.fire("click");
    all(campus).find(n => n.id === "ct-open-work")!.fire("click");
    expect(navigated).toEqual(["workforce", "work"]);
  });

  it("has no animation and no 3D: reduce-motion is always on, no animate/canvas/script nodes, the notice says no 3D yet", async () => {
    const {campus, view} = await mount({cockpit: COCKPIT(), workRuns: RUNS});
    const tags = all(view).map(n => n.tagName.toLowerCase());
    expect(tags.filter(t => t === "animate" || t === "animatetransform" || t === "canvas" || t === "iframe" || t === "script")).toEqual([]);
    expect(all(campus).some(n => n.getAttribute("class") === "building" && n.getAttribute("data-active-runs") !== "0")).toBe(true);
    expect(all(campus).find(n => n.dataset.ct3d === "none")!.textContent).toMatch(/3B görünüm henüz yoktur/);
    const en = await mount({cockpit: COCKPIT(), workRuns: RUNS}, "en");
    expect(all(en.campus).find(n => n.dataset.ct3d === "none")!.textContent).toMatch(/no 3D view yet/);
    for (const f of ["control-tower/mount.js", "control-tower/feed.js", "control-tower/markup.js", "views/tower.js"]) {
      expect(read(...f.split("/")), f).not.toMatch(/WebGL|webgl|THREE\.|three\.js|getContext\(|<animate|requestAnimationFrame|setInterval/);
    }
    expect(read("control-tower/mount.js")).toContain("reducedMotion: true");
  });
});

describe("UX WP4 honest empty states (no fabricated counts)", () => {
  it("shows no clusters, guilds or counts when the role feed is absent (bridge rejects /v1/roles)", async () => {
    const {campus, calls} = await mount({cockpit: COCKPIT(), roles: false, workRuns: RUNS});
    expect(calls.filter(c => c.startsWith("/v1/roles"))).toEqual(["/v1/roles?limit=100"]);
    expect(campus.dataset.districts).toBe("0");
    expect(rowsSvg(campus)).toEqual([]);
    expect(rowsList(campus)).toEqual([]);
    expect(campus.dataset.campusState).toBe("UNAVAILABLE");
    const summary = summaryOf(campus);
    expect(summary).toContain("Rol kataloğu verisi yok");
    expect(summary).not.toMatch(/\d/);
    const feeds = all(campus).find(n => n.getAttribute("class") === "note ct-feeds")!;
    expect(feeds.dataset.catalog).toBe("false");
    expect(feeds.textContent).toContain("rol kataloğu veri yok");
    expect(all(campus).filter(n => n.getAttribute("class") === "count").length).toBe(0);
    for (const fake of ["14 ajan", "32 görev", "14 agents", "32 tasks"]) expect(campus.textContent).not.toContain(fake);
  });

  it("shows NO DATA per building when cockpit and work-runs are absent but the catalog is known; target roles are not claimed as verified", async () => {
    const {campus} = await mount({workRuns: null});
    expect(campus.dataset.globalState).toBe("UNAVAILABLE");
    const rows = rowsSvg(campus);
    expect(rows).toHaveLength(51);
    expect(rows.every(r => /\|na\|na\|UNAVAILABLE$/.test(r))).toBe(true);
    expect(rowsList(campus)).toEqual(rows);
  });

  it("keeps target roles but shows active runs as no data when only the run feed is missing", async () => {
    const {campus} = await mount({cockpit: COCKPIT(), workRuns: null});
    const rows = rowsSvg(campus);
    expect(rows).toHaveLength(51);
    expect(rows.map(r => r.split("|")).every(([, target, active]) => target !== "na" && active === "na")).toBe(true);
    expect(rowsList(campus)).toEqual(rows);
  });

  it("treats a role feed whose pages do not add up as unavailable instead of showing partial counts", async () => {
    const shortPage = await mount({cockpit: COCKPIT(), workRuns: [], rolesMutate: (p, i) => (i === 2 ? {...p, items: p.items.slice(0, -1)} : p)});
    expect(rowsSvg(shortPage.campus)).toEqual([]);
    const badTotal = await mount({cockpit: COCKPIT(), workRuns: [], rolesMutate: (p, i) => (i === 1 ? {...p, total: p.total + 1} : p)});
    expect(rowsSvg(badTotal.campus)).toEqual([]);
    const badItem = await mount({cockpit: COCKPIT(), workRuns: [], rolesMutate: (p) => ({...p, items: p.items.map((x: any) => ({...x, guildId: "bad"}))})});
    expect(rowsSvg(badItem.campus)).toEqual([]);
    const dup = await mount({cockpit: COCKPIT(), workRuns: [], rolesMutate: (p, i) => (i === 1 ? {...p, items: [p.items[0], ...p.items], total: p.total + 1} : p)});
    expect(rowsSvg(dup.campus)).toEqual([]);
  });
});

describe("UX WP4 feed and markup units", () => {
  it("attributes runs only through registered role ids, counts nothing for non-live statuses and never guesses", async () => {
    const feed = await load("control-tower", "feed.js");
    const roles = {state: "VERIFIED", items: [{roleId: "UASCO-0001", guildId: "G01", clusterId: "CL01"}, {roleId: "UASCO-0002", guildId: "G02", clusterId: "CL01"}]};
    const input = feed.buildCampusInput({cockpit: {data: {globalStop: {known: true, active: false, reason: null}}}, roles, workRuns: {state: "VERIFIED", items: [
      {runId: "r1", status: "RUNNING", role: "UASCO-0001"}, {runId: "r2", status: "RUNNING", role: "UASCO-0002"}, {runId: "r3", status: "RUNNING", role: "BUILDER"}, {runId: "r4", status: "QUEUED", role: "UASCO-0001"}]}});
    expect(input.catalog).toEqual({clusters: [{clusterId: "CL01", name: "CL01"}], guilds: [{guildId: "G01", name: "G01", clusterId: "CL01"}, {guildId: "G02", name: "G02", clusterId: "CL01"}], roles: {G01: 1, G02: 1}});
    expect(input.runs.map((r: any) => r.guildId)).toEqual(["G01", "G02", null, "G01"]);
    const model = (await load("control-tower", "model.js")).buildCampusModel(input);
    expect(model.totals).toMatchObject({activeRuns: 2, unattributedActiveRuns: 1, targetRoles: 2});
    expect(feed.catalogFromRoles({state: "ERROR", items: []})).toBeNull();
    expect(feed.catalogFromRoles({state: "VERIFIED", items: []})).toBeNull();
    expect(feed.runsFromWorkRuns({state: "UNAVAILABLE", items: []}, roles)).toBeNull();
    expect(feed.globalStopSource({data: {globalStop: {known: false, active: false}}}, {state: "ERROR"})).toBeNull();
  });

  it("converts only the escaped campus markup to DOM and rejects scripts, event handlers, links and unbalanced input", async () => {
    const {markupToNodes} = await load("control-tower", "markup.js");
    const doc = new D();
    const ok = markupToNodes(doc, '<svg viewBox="0 0 1 1"><g class="building" data-guild-id="G&quot;1"><title>a &lt;b&gt; &amp; c</title></g></svg>');
    expect(ok).toHaveLength(1);
    expect(all(ok[0]).find(n => n.tagName === "TITLE")!.textContent).toBe("a <b> & c");
    expect(all(ok[0]).find(n => n.tagName === "G")!.getAttribute("data-guild-id")).toBe('G"1');
    for (const bad of ["<svg><script>x</script></svg>", '<svg><g onclick="x"></g></svg>', '<svg><a href="javascript:x"></a></svg>', '<svg><rect style="x"/></svg>', '<svg><g href="x"/></svg>', "<svg><g></svg>", "text only", "<table><tr><td>a</table>", '<svg><image src="x"/></svg>']) expect(markupToNodes(doc, bad), bad).toBeNull();
    const html = markupToNodes(doc, '<section class="ct-list"><p role="status">x</p></section>');
    expect(html![0].tagName).toBe("SECTION");
  });

  it("maps and validates /v1/roles pages", async () => {
    const m = await load("model.js");
    const page = {items: [{roleId: "UASCO-0001", guildId: "G01", clusterId: "CL01", title: "ignored"}], total: 1, nextCursor: null};
    expect(m.mapRolesPage(page)).toEqual({items: [{roleId: "UASCO-0001", guildId: "G01", clusterId: "CL01"}], total: 1, nextCursor: null});
    for (const bad of [null, {items: [], total: -1}, {items: "x", total: 1}, {items: [], total: 0, nextCursor: "x"}, {items: [{roleId: "UASCO-0001", guildId: "G1", clusterId: "CL01"}], total: 1}]) expect(m.mapRolesPage(bad)).toBeNull();
  });

  it("has en/tr parity for every tower.map key and every key used by the view", async () => {
    const trD = (await load("locales", "tr.js")).default as Record<string, string>, enD = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = Object.keys(trD).filter(k => k.startsWith("tower.map."));
    expect(keys.length).toBeGreaterThan(15);
    expect(Object.keys(enD).filter(k => k.startsWith("tower.map.")).sort()).toEqual(keys.sort());
    const used = new Set<string>();
    for (const f of ["control-tower/mount.js", "views/tower.js"]) for (const m of read(...f.split("/")).matchAll(/"(tower\.map\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter(k => !(k in trD && k in enD))).toEqual([]);
  });
});

// //TR: UX hardening — Day-0 bölümü (health/stop/runs/events/logs) için fonksiyonel, negatif ve erişilebilirlik testleri; veri yoksa uydurma değer yok, hata durumu "Log yok" diye gizlenmez.
type Routes = Record<string, any>;
async function mkDay0(routes: Routes, lang = "en", confirmAnswer: boolean | "missing" = true, now?: number) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    calls.push(p);
    const r = routes[p];
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error(`${p}: HTTP 404`);
    return typeof r === "function" ? r() : r;
  }};
  const api = apiMod.createApi({bridge, store}), t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const stops: string[] = [];
  const confirms: any[] = [];
  const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate() {}, principal: "FOUNDER_LOCAL", renderAttention() {}, requestStop() { stops.push("stop"); }, resume() { stops.push("resume"); }};
  if (now !== undefined) ctx.now = () => now;
  if (confirmAnswer !== "missing") ctx.confirm = async (o: any) => { confirms.push(o); return confirmAnswer; };
  const tower = await load("views", "tower.js");
  const view: N = await tower.render(ctx);
  return {ctx, view, calls, stops, t, confirms};
}
const byId = (v: N, id: string) => all(v).find(n => n.id === id)!;
const flush = () => new Promise(r => setTimeout(r, 0));

describe("UX hardening: tower day-0 functional", () => {
  const RUN = "RUN-ABC-1";
  const base: Routes = {
    "/health": {status: "ok", system: "uasco"},
    "/v1/runs": {runs: [{runId: RUN, summary: {status: "COMPLETED"}}]},
    [`/v1/runs/${RUN}/events`]: {events: [{timestamp: "t1", severity: "INFO", stage: "s", event: "e", details: {a: 1}}]},
    [`/v1/runs/${RUN}/logs`]: {logs: [{name: "a.log", size: 12}]},
    [`/v1/runs/${RUN}/logs/a.log`]: {text: "hello-log", truncated: false},
  };
  it("shows verified health and wires Stop/Resume buttons to the context", async () => {
    const m = await mkDay0(base);
    expect(byId(m.view, "health").textContent).toBe("ok · uasco");
    byId(m.view, "towerStop").fire("click"); byId(m.view, "towerResume").fire("click");
    expect(m.stops).toEqual(["stop"]);
    await flush();
    expect(m.stops).toEqual(["stop", "resume"]);
    expect(m.confirms).toHaveLength(1);
    expect(m.confirms[0].body).toBe(m.t("resume.confirm.body"));
  });
  it("Resume is not called when confirm resolves false or ctx.confirm is missing (fail-closed)", async () => {
    for (const ans of [false, "missing"] as const) {
      const m = await mkDay0(base, "en", ans);
      byId(m.view, "towerResume").fire("click"); await flush();
      expect(m.stops).toEqual([]);
    }
  });
  it("loads events and a log on click and shows loading text first", async () => {
    const m = await mkDay0(base);
    const runBtn = byId(m.view, "tower-runs").children.flatMap(c => all(c)).find(n => n.tagName === "BUTTON")!;
    runBtn.fire("click");
    expect(byId(m.view, "events").textContent).toBe(m.t("tower.loading"));
    await flush(); await flush();
    expect(byId(m.view, "selectedRun").textContent).toBe(RUN);
    expect(byId(m.view, "events").textContent).toContain("[INFO] s/e");
    const logBtn = byTag(byId(m.view, "logButtons"), "button")[0];
    expect(logBtn.textContent).toContain("a.log");
    logBtn.fire("click"); await flush(); await flush();
    expect(byId(m.view, "logText").textContent).toBe("hello-log");
  });
});

describe("UX hardening: tower day-0 negative / honest states", () => {
  it("never invents values when every endpoint fails", async () => {
    const m = await mkDay0({});
    expect(byId(m.view, "health").textContent).not.toMatch(/ok|uasco/);
    const facts = all(m.view).filter(n => n.dataset.fact);
    expect(facts.length).toBeGreaterThanOrEqual(7);
    const model = await load("model.js");
    for (const f of facts) expect(f.textContent).toContain(model.MISSING);
    expect(byId(m.view, "tower-runs").textContent).not.toMatch(/RUN-/);
  });
  it("tower.retry shows the honest read-failure state, never 'No pending retry' (UI-194)", async () => {
    const m = await mkDay0({});
    const f = all(m.view).find(n => n.dataset.fact === "tower.retry")!;
    expect(["OFFLINE", "UNAVAILABLE", "ERROR"]).toContain(f.dataset.retryState);
    expect(f.textContent).toContain(m.t(`state.${f.dataset.retryState}`));
    expect(f.textContent).not.toContain(m.t("tower.noRetry"));
  });
  const retryFact = async (data: any, now = Date.parse("2026-10-20T12:00:00Z")) => {
    const m = await mkDay0({"/v1/retry": data}, "en", true, now);
    return {m, f: all(m.view).find(n => n.dataset.fact === "tower.retry")!};
  };
  it("tower.retry: null is NONE; INVALID payloads and bad records print no package or time (UI-194)", async () => {
    const none = await retryFact(null);
    expect(none.f.dataset.retryState).toBe("NONE");
    expect(none.f.textContent).toContain(none.m.t("tower.noRetry"));
    for (const bad of [{status: "INVALID", error: "SUPERVISOR_RETRY_STATE_UNSAFE"}, {packageId: "PKG-001", phaseIds: [1], retryAt: "nope"}, {packageId: "bad id!", retryAt: "2026-10-20T13:00:00Z"}, {packageId: "PKG-001", phaseIds: ["x"], retryAt: "2026-10-20T13:00:00Z"}, "text", []]) {
      const {m, f} = await retryFact(bad);
      expect(f.dataset.retryState, JSON.stringify(bad)).toBe("INVALID");
      expect(f.textContent).toContain(m.t("tower.retry.invalid"));
      expect(f.textContent).not.toMatch(/PKG-001|2026-|nope/);
      expect(f.textContent).not.toContain(m.t("tower.noRetry"));
    }
  });
  it("tower.retry classifies a valid record with the shared retry-core function and never claims recovery (UI-194)", async () => {
    const ops = await load("retry-core.js");
    const rec = (retryAt: string) => ({packageId: "PKG-007", phaseIds: [3, 4], retryAt, reason: "SECRET-FREE-TEXT"});
    const cases: Array<[string, string]> = [["2026-10-20T13:30:00Z", "WAITING"], ["2026-10-20T11:55:00Z", "DUE"], ["2026-10-20T11:00:00Z", "OVERDUE"]];
    for (const [at, phase] of cases) {
      const now = Date.parse("2026-10-20T12:00:00Z");
      expect(ops.classifyRetryPhase(ops.validateRetryRecord(rec(at)), now).phase).toBe(phase);
      const {m, f} = await retryFact(rec(at), now);
      expect(f.dataset.retryState).toBe(phase);
      expect(f.textContent).toContain("PKG-007");
      expect(f.textContent).toContain("3,4");
      expect(f.textContent).toContain(at);
      expect(f.textContent).not.toContain("SECRET-FREE-TEXT");
      expect(f.textContent).not.toMatch(/recovered|healthy|resumed|circuit|429|SLA|provider/i);
      expect(m.calls.filter(c => c === "/v1/retry")).toHaveLength(1);
    }
    expect((await retryFact(rec("2026-10-20T13:30:00Z"))).f.textContent).toContain("1 h 30 min");
    expect(ops.classifyRetryPhase(ops.validateRetryRecord(rec("2026-10-20T13:30:00Z")), NaN).phase).toBe("UNDETERMINED");
  });
  it("tower retry locale keys keep identical placeholders in en and tr (UI-194)", async () => {
    const trD = (await load("locales", "tr.js")).default as Record<string, string>, enD = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = Object.keys(enD).filter(k => k.startsWith("tower.retry."));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(trD).filter(k => k.startsWith("tower.retry.")).sort()).toEqual(keys.sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys) expect(ph(trD[k]), k).toBe(ph(enD[k]));
    expect(read("operations-core.js")).not.toMatch(/confirm\(|apiPost|\.post\(|bridge\./);
  });
  it("shows the empty note for zero runs and the state note (not the empty note) for a failed run feed", async () => {
    const empty = await mkDay0({"/v1/runs": {runs: []}});
    expect(byId(empty.view, "tower-runs").textContent).toContain(empty.t("tower.noRuns"));
    const failed = await mkDay0({});
    expect(byId(failed.view, "tower-runs").textContent).not.toContain(failed.t("tower.noRuns"));
    expect(all(byId(failed.view, "tower-runs")).some(n => n.attrs.get("role") === "status")).toBe(true);
  });
  it("reports a failed log list as an error state, not as 'no logs'", async () => {
    const m = await mkDay0({"/v1/runs": {runs: [{runId: "RUN-X"}]}});
    byTag(byId(m.view, "tower-runs"), "button")[0].fire("click"); await flush(); await flush();
    const lb = byId(m.view, "logButtons");
    expect(lb.textContent).not.toContain(m.t("tower.noLogs"));
    expect(all(lb).some(n => n.attrs.get("role") === "status")).toBe(true);
  });
  it("reports an empty log list as 'no logs' and a failed events fetch as a state", async () => {
    const m = await mkDay0({"/v1/runs": {runs: [{runId: "RUN-Y"}]}, "/v1/runs/RUN-Y/logs": {logs: []}});
    byTag(byId(m.view, "tower-runs"), "button")[0].fire("click"); await flush(); await flush();
    expect(byId(m.view, "logButtons").textContent).toContain(m.t("tower.noLogs"));
    expect(byId(m.view, "events").textContent).not.toBe(m.t("tower.loading"));
    expect(byId(m.view, "events").textContent).not.toContain("[INFO]");
  });
  it("marks a stopped system from /v1/control/status", async () => {
    const m = await mkDay0({"/v1/control/status": {globalStop: {active: true, reason: "because"}}});
    expect(byId(m.view, "stopState").textContent).toContain("because");
  });
});

describe("UX hardening: tower accessibility and locale parity", () => {
  it("exposes a focusable heading, labelled scrollable logs and typed buttons", async () => {
    const m = await mkDay0({"/v1/runs": {runs: [{runId: "RUN-Z"}]}});
    expect(byId(m.view, "view-title").tagName).toBe("H1");
    expect(byId(m.view, "view-title").getAttribute("tabindex")).toBe("-1");
    for (const id of ["events", "logText"]) { const n = byId(m.view, id); expect(n.getAttribute("tabindex")).toBe("0"); expect((n.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0); }
    for (const b of byTag(m.view, "button")) expect(b.getAttribute("type")).toBe("button");
    for (const s of byTag(m.view, "section")) expect(s.getAttribute("aria-labelledby") ?? s.getAttribute("aria-label")).toBeTruthy();
  });
  it("has identical en/tr key sets for tower.* and equal placeholders", async () => {
    const trD = (await load("locales", "tr.js")).default as Record<string, string>, enD = (await load("locales", "en.js")).default as Record<string, string>;
    const ph = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort();
    const keys = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("tower.")).sort();
    expect(keys(trD)).toEqual(keys(enD));
    for (const k of keys(enD)) expect(ph(trD[k])).toEqual(ph(enD[k]));
    const used = [...read("views", "tower.js").matchAll(/"(tower\.[A-Za-z0-9_.]+)"/g)].map(m => m[1]);
    expect(used.filter(k => !(k in trD && k in enD))).toEqual([]);
  });
});

// //TR: PQ-002 / UI-206 — Tower "scheduler" olgusu: doğrulanmış okumada yalnız gerçek tamamlanan/toplam faz sayısı, UNAVAILABLE/ERROR/eksik veride uydurma sayı yok, dürüst "—".
describe("UX hardening: tower scheduler fact (UI-206)", () => {
  const schedFact = async (routes: Routes) => {
    const m = await mkDay0(routes);
    return {m, f: all(m.view).find(n => n.dataset.fact === "tower.scheduler")!};
  };
  const valueOf = (f: N) => all(f).find(n => n.className === "fact-value")!.textContent;
  it("VERIFIED: shows the real completed/total phase count and the scheduler label", async () => {
    const {m, f} = await schedFact({"/v1/scheduler": {phases: [{status: "COMPLETED"}, {status: "RUNNING"}, {status: "COMPLETED"}, {status: "QUEUED"}]}});
    expect(f).toBeDefined();
    expect(valueOf(f)).toBe("2/4");
    expect(f.textContent).toContain(m.t("tower.scheduler"));
    expect(m.calls.filter(c => c === "/v1/scheduler")).toHaveLength(1);
  });
  it("VERIFIED with zero phases shows 0/0, not a missing marker or an invented number", async () => {
    const {f} = await schedFact({"/v1/scheduler": {phases: []}});
    expect(valueOf(f)).toBe("0/0");
  });
  it("UNAVAILABLE: a 404 read shows the honest missing marker, never a number", async () => {
    const model = await load("model.js");
    const {f} = await schedFact({});
    expect(valueOf(f)).toBe(model.MISSING);
    expect(f.textContent).not.toMatch(/\d/);
  });
  it("ERROR: a failing read shows the honest missing marker, never a number", async () => {
    const model = await load("model.js");
    const {f} = await schedFact({"/v1/scheduler": new Error("/v1/scheduler: HTTP 500")});
    expect(valueOf(f)).toBe(model.MISSING);
    expect(f.textContent).not.toMatch(/\d/);
  });
  it("missing data: a payload without a phases list shows the missing marker or its status text, never a fabricated count", async () => {
    const model = await load("model.js");
    for (const payload of [{}, {phases: "x"}, {phases: null}, null, []]) {
      const {f} = await schedFact({"/v1/scheduler": payload});
      expect(valueOf(f), JSON.stringify(payload)).toBe(model.MISSING);
    }
    const st = await schedFact({"/v1/scheduler": {status: "NOT_STARTED"}});
    expect(valueOf(st.f)).toBe("NOT_STARTED");
    expect(valueOf(st.f)).not.toMatch(/\d/);
  });
});

// //TR: UI-226 aşama zaman çizelgesi testleri: yalnız gerçek timestamp/stage alanlarından ofset ve süre, geçersiz timestamp "yerleştirilemeyen", süre uydurulmaz, metin eşdeğer liste, mevcut <pre> değişmez, en/tr tower.trace anahtar eşitliği.
describe("UI-226 stage timeline from real event timestamps", () => {
  const EV: any[] = [
    {timestamp: "2026-10-18T10:00:00.000Z", stage: "PLAN", event: "start"},
    {timestamp: "2026-10-18T10:00:02.000Z", stage: "PLAN", event: "end"},
    {timestamp: "2026-10-18T10:00:01.000Z", stage: "BUILD", event: "start"},
    {timestamp: "2026-10-18T10:00:05.000Z", stage: "BUILD", event: "end"},
    {timestamp: "not-a-date", stage: "BUILD", event: "bad"},
    {stage: "VERIFY", event: "nots"},
    {timestamp: "2026-10-18T10:00:04.000Z", event: "nostage"}
  ];
  it("computes offsets and durations only from valid timestamps and lists the rest as unplaced", async () => {
    const core = await load("trace-core.js"), tl = core.buildStageTimeline(EV);
    expect(tl.spanMs).toBe(5000);
    expect(tl.stages.map((s: any) => [s.stage, s.count, s.offsetMs, s.durationMs])).toEqual([["PLAN", 2, 0, 2000], ["BUILD", 2, 1000, 4000], ["", 1, 4000, 0]]);
    expect(tl.stages[1].startPct).toBe(20);
    expect(tl.stages[1].widthPct).toBe(80);
    expect(tl.unplaced.map((u: any) => [u.index, u.stage, u.event])).toEqual([[4, "BUILD", "bad"], [5, "VERIFY", "nots"]]);
    expect(core.buildStageTimeline([{stage: "X"}, null, 5])).toEqual({stages: [], unplaced: [{index: 0, stage: "X", event: ""}, {index: 1, stage: "", event: ""}, {index: 2, stage: "", event: ""}], originMs: null, spanMs: 0});
    expect(core.buildStageTimeline(undefined).stages).toEqual([]);
    expect(core.buildStageTimeline([{timestamp: "2026-10-18T10:00:00Z", stage: "A"}]).stages[0]).toMatchObject({offsetMs: 0, durationMs: 0, widthPct: 0});
  });
  it("renders text-equivalent list, unplaced list and keeps the raw events <pre> unchanged", async () => {
    const m = await mkCtx({cockpit: COCKPIT(), workRuns: []}), tower = await load("views", "tower.js");
    const orig = m.ctx.api.raw;
    m.ctx.api = {...m.ctx.api, runs: async () => ({state: "VERIFIED", runs: [{runId: "RUN-1"}]}), raw: async (p: string) => p.endsWith("/events") ? {ok: true, state: "VERIFIED", data: {events: EV}} : orig(p)};
    const view: N = await tower.render(m.ctx);
    const btn = all(view).find(n => n.tagName === "BUTTON" && n.textContent.startsWith("RUN-1"))!;
    btn.fire("click");
    await new Promise(r => setTimeout(r, 20));
    const tlEl = all(view).find(n => n.id === "stageTimeline")!, pre = all(view).find(n => n.id === "events")!;
    const items = byTag(tlEl, "li").map(n => n.textContent);
    expect(items).toHaveLength(5);
    expect(items[0]).toContain("PLAN: 2");
    expect(items[1]).toContain("BUILD: 2");
    expect(items.filter(t => t.includes("VERIFY/nots") || t.includes("BUILD/bad"))).toHaveLength(2);
    expect(all(tlEl).filter(n => n.className === "tw-trace-bar")).toHaveLength(3);
    expect(pre.textContent).toBe(EV.map(x => `${x.timestamp ?? ""} [INFO] ${x.stage ?? ""}/${x.event ?? ""} {}`).join("\n"));
  });
  it("accepts only full ISO timestamps with an explicit offset and validates the calendar", async () => {
    const core = await load("trace-core.js");
    for (const bad of ["2026-10-18T10:00:00", "2026-10-18T10:00", "2026-10-18 10:00:00Z", "2026-10-18", "2026-02-30T10:00:00Z", "2026-13-01T10:00:00Z", "2026-10-18T24:00:00Z", "2026-10-18T10:60:00Z", "2026-10-18T10:00:60Z", "2026-10-18T10:00:00+24:00", "2026-10-18T10:00:00+0200", "2026-10-18T10:00Z junk", 5, null]) expect(core.parseTs(bad), String(bad)).toBeNull();
    const t = Date.UTC(2026, 9, 18, 10, 0, 0);
    expect(core.parseTs("2026-10-18T10:00:00Z")).toBe(t);
    expect(core.parseTs("2026-10-18T10:00Z")).toBe(t);
    expect(core.parseTs("2026-10-18T12:00:00+02:00")).toBe(t);
    expect(core.parseTs("2026-10-18T05:30:00-04:30")).toBe(t);
    expect(core.parseTs("2026-10-18T10:00:00.250Z")).toBe(t + 250);
    expect(core.parseTs("2028-02-29T00:00:00Z")).toBe(Date.UTC(2028, 1, 29));
    expect(core.parseTs("2026-02-29T00:00:00Z")).toBeNull();
    const tl = core.buildStageTimeline([{timestamp: "2026-10-18T10:00:00", stage: "A", event: "naive"}, {timestamp: "2026-02-30T10:00:00Z", stage: "A", event: "feb30"}]);
    expect(tl.stages).toEqual([]);
    expect(tl.unplaced.map((u: any) => u.event)).toEqual(["naive", "feb30"]);
  });
  it("timestamp field limits are exact: month 1..12, hour <= 23, minute <= 59, second <= 59, offset hour <= 23 and offset minute <= 59", async () => {
    const core = await load("trace-core.js");
    for (const ok of ["2026-01-05T00:00:00Z", "2026-12-05T23:59:59Z", "2026-10-18T10:00:00+23:59", "2026-10-18T10:00:00-23:59"]) expect(core.parseTs(ok), ok).not.toBeNull();
    for (const bad of ["2026-00-05T00:00:00Z", "2026-13-05T00:00:00Z", "2026-10-18T24:00:00Z", "2026-10-18T10:60:00Z", "2026-10-18T10:00:60Z", "2026-10-18T10:00:00+24:00", "2026-10-18T10:00:00+23:60"]) expect(core.parseTs(bad), bad).toBeNull();
  });
  it("zero duration is shown as 0 ms and a zero-span timeline has finite zero percentages", async () => {
    const core = await load("trace-core.js");
    expect(core.formatMs(0)).toBe("0 ms");
    expect(core.formatMs(-1)).toBe("");
    const tl = core.buildStageTimeline([{timestamp: "2026-10-18T10:00:00Z", stage: "A", event: "e"}]);
    expect(tl.stages.map((x: any) => [x.startPct, x.widthPct])).toEqual([[0, 0]]);
  });
  it("formats durations by rounding to whole seconds before splitting and adds hour and day units", async () => {
    const {formatMs} = await load("trace-core.js");
    expect(formatMs(59999)).toBe("1 min 0 s");
    expect(formatMs(119999)).toBe("2 min 0 s");
    expect(formatMs(999.6)).toBe("1.0 s");
    expect(formatMs(999.4)).toBe("999 ms");
    expect(formatMs(1500)).toBe("1.5 s");
    expect(formatMs(59949)).toBe("59.9 s");
    expect(formatMs(61000)).toBe("1 min 1 s");
    expect(formatMs(3599999)).toBe("1 h 0 min");
    expect(formatMs(3600000)).toBe("1 h 0 min");
    expect(formatMs(3 * 86400000)).toBe("3 d 0 h");
    expect(formatMs(86400000 + 5 * 3600000)).toBe("1 d 5 h");
    expect(formatMs(-1)).toBe("");
    expect(formatMs(NaN)).toBe("");
  });
  it("groups trimmed stage names, treats blank as no-stage and orders first-time ties by stage name then first index", async () => {
    const core = await load("trace-core.js"), T = "2026-10-18T10:00:00Z";
    const tl = core.buildStageTimeline([{timestamp: T, stage: " B "}, {timestamp: T, stage: "B"}, {timestamp: T, stage: "   "}, {timestamp: T, stage: "A"}, {timestamp: T}]);
    expect(tl.stages.map((s: any) => [s.stage, s.count])).toEqual([["", 2], ["A", 1], ["B", 2]]);
    const rev = core.buildStageTimeline([{timestamp: T, stage: "B"}, {timestamp: T, stage: "A"}]);
    expect(rev.stages.map((s: any) => s.stage)).toEqual(["A", "B"]);
    expect(core.buildStageTimeline([{stage: "  X  "}]).unplaced[0].stage).toBe("X");
  });
  it("assigns bar left/width through the style object and shows a visible truncation note with slice-relative unplaced numbers", async () => {
    const m = await mkCtx({cockpit: COCKPIT(), workRuns: []}, "en"), tower = await load("views", "tower.js");
    const orig = m.ctx.api.raw;
    const evs: any[] = [];
    for (let i = 0; i < 250; i++) evs.push({timestamp: i === 249 ? "bad" : new Date(Date.UTC(2026, 9, 18, 10, 0, i)).toISOString(), stage: i < 225 ? "PLAN" : "BUILD", event: "e" + i});
    let data: any[] = evs;
    m.ctx.api = {...m.ctx.api, runs: async () => ({state: "VERIFIED", runs: [{runId: "RUN-1"}]}), raw: async (p: string) => p.endsWith("/events") ? {ok: true, state: "VERIFIED", data: {events: data}} : orig(p)};
    const view: N = await tower.render(m.ctx);
    const btn = all(view).find(n => n.tagName === "BUTTON" && n.textContent.startsWith("RUN-1"))!;
    btn.fire("click");
    await new Promise(r => setTimeout(r, 20));
    let tlEl = all(view).find(n => n.id === "stageTimeline")!;
    const note = all(tlEl).find(n => n.dataset.truncated === "1")!;
    expect(note.textContent).toBe("Timeline covers the last 200 of 250 events; unplaced event numbers count within these 200.");
    expect(byTag(tlEl, "li").map(n => n.textContent).find(t => t.includes("e249"))).toContain("#200 BUILD/e249");
    const bars = all(tlEl).filter(n => n.className === "tw-trace-bar");
    expect(bars).toHaveLength(2);
    expect(bars[0].style.left).toBe("0.00%");
    expect(bars[0].style.width).toMatch(/^\d+\.\d{2}%$/);
    expect(bars[1].style.left).toMatch(/^\d+\.\d{2}%$/);
    expect(Number.parseFloat(bars[1].style.left)).toBeGreaterThan(0);
    data = evs.slice(0, 200);
    btn.fire("click");
    await new Promise(r => setTimeout(r, 20));
    tlEl = all(view).find(n => n.id === "stageTimeline")!;
    expect(all(tlEl).some(n => n.dataset.truncated === "1")).toBe(false);
  });
  it("has en/tr parity for tower.trace keys and every key used by the view", async () => {
    const trD = (await load("locales", "tr.js")).default as Record<string, string>, enD = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = Object.keys(trD).filter(k => k.startsWith("tower.trace."));
    expect(keys).toHaveLength(9);
    expect(Object.keys(enD).filter(k => k.startsWith("tower.trace.")).sort()).toEqual(keys.sort());
    const used = new Set<string>();
    for (const m of read("views", "tower.js").matchAll(/"(tower\.trace\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    expect([...used].sort()).toEqual(keys.sort());
  });
});
