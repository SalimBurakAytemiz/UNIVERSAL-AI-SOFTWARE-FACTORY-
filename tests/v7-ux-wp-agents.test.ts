// //TR: Bu test UX WP-AGENTS AI İş Gücü rol kataloğu görünümünü (apps/desktop/renderer/views/workforce.js) ve destekleyen saf modelini (mapRoleCatalogPage/mapRoleDetail) + api.roleCatalog()/roleDetail() + main.mjs allow-list'ini doğrular: katalog yalnız canlı /v1/roles kanonik kaydından (tam-ya-da-boş sayfalama) okunur; 599 rol TANIMI dürüst sayılır ama runtimeStatus UNKNOWN ve proficiencyStatus NOT_EVALUATED (0 sertifikalı) belirgin gösterilir, asla N aktif ajan/sertifikalı işçi ima edilmez; küme/lonca/başlık süzgeci gerçek veriden çalışır; rol tanımı ayrıntısı GET /v1/roles/:roleId'den sorumluluklar/uzmanlık/yasak eylemler/değerlendirme şartnamelerini gösterir; /v1/roles/:roleId yalnız kanonik kimlikle fail-closed allow-list'tedir; workforce.cat.* sözlüğü EN/TR'de birebirdir; eksik/bozuk katalogda dürüst durum, uydurma yok.
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const readMain = () => fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const block = (tag: string) => { const s = readMain(); const a = s.indexOf(`// ${tag}-BEGIN`), b = s.indexOf(`// ${tag}-END`); if (a < 0 || b < 0) throw new Error(`no ${tag}`); return s.slice(a, b); };
const loadGet = () => new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;

// Minimal fake DOM (createElement/textContent/replaceChildren/events only).
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>(); value = "";
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
  focus() { this.doc.focused = this; }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const byTag = (r: N, t: string) => all(r).filter(n => n.tagName === t.toUpperCase());
const byData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const text = (n: N) => n.textContent;

const RAW = JSON.parse(fs.readFileSync(path.join(root, "registries", "role-definitions.json"), "utf8"));
const REG: any[] = [...RAW.roles].sort((a, b) => (a.roleId < b.roleId ? -1 : 1));
const roleItem = (r: any) => ({roleId: r.roleId, title: r.title, guildId: r.guildId, clusterId: r.clusterId, priority: r.priority, runtimeStatus: r.runtimeStatus, proficiencyStatus: r.proficiencyStatus, certifiedScope: r.certifiedScope, legacyAliasCount: Array.isArray(r.legacyAliases) ? r.legacyAliases.length : 0, gapCount: Array.isArray(r.gapIds) ? r.gapIds.length : 0});
function rolesPage(p: string) {
  const u = new URL("http://x" + p);
  const limit = Number(u.searchParams.get("limit") ?? 50), cursor = u.searchParams.get("cursor");
  const after = cursor ? REG.filter(r => r.roleId > cursor) : REG, page = after.slice(0, limit);
  return {status: RAW.status, notice: RAW.notice, registeredRoles: REG.length, total: REG.length, limit, cursor, nextCursor: after.length > limit ? page[page.length - 1].roleId : null, items: page.map(roleItem)};
}
function roleDetail(id: string) {
  const r = REG.find(x => x.roleId === id); if (!r) return undefined;
  const guild = (RAW.guilds ?? []).find((g: any) => g.guildId === r.guildId) ?? null;
  const cluster = (RAW.clusters ?? []).find((c: any) => c.clusterId === r.clusterId) ?? null;
  return {status: RAW.status, notice: RAW.notice, role: r, guild, cluster, legacyAliases: r.legacyAliases ?? [], gaps: {role: r.gapIds ?? [], guild: guild?.gapIds ?? []}};
}
const COCKPIT = {generatedAt: "2026-10-16T00:00:00.000Z", workforce: {state: "VERIFIED", registeredRoles: 363, registeredRolesAuthority: "LEGACY_REFERENCE_ONLY", canonicalRegisteredRoles: 599, targetRoles: 599, activeWorkerRuns: 0, source: "S"}};
const AGENTS = {registeredRoles: 599, certified: 0, legacyRoles: 363};

interface Feed { roles?: "ok" | "off"; detail?: boolean }
async function mkCtx(feed: Feed = {roles: "ok", detail: true}, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], navigated: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    calls.push(p);
    if (p.startsWith("/v1/roles/")) { if (feed.detail === false) throw new Error(`${p}: HTTP 404`); const d = roleDetail(p.slice("/v1/roles/".length)); if (!d) throw new Error(`${p}: HTTP 404`); return d; }
    if (p.startsWith("/v1/roles")) { if (feed.roles === "off") throw new Error(`${p}: HTTP 404`); return rolesPage(p); }
    if (p === "/v1/cockpit") return COCKPIT;
    if (p === "/v1/agents") return AGENTS;
    if (p === "/v1/work-runs") return {workRuns: []};
    throw new Error(`${p}: HTTP 404`);
  }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate: (id: string) => navigated.push(id), rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
  return {ctx, doc, api, calls, navigated};
}
const ROUTE = {id: "workforce"};
const renderWf = async (ctx: any) => { const view = await load("views", "workforce.js"); return {view, node: (await view.render(ctx, ROUTE)) as N}; };

describe("UX WP-AGENTS role catalog model (complete-or-empty, no status elevation)", () => {
  it("mapRoleCatalogPage keeps rich-but-safe fields and rejects malformed pages", async () => {
    const m = await load("model.js");
    const page = {total: 1, nextCursor: null, items: [{roleId: "UASCO-0001", title: "T", guildId: "G01", clusterId: "CL01", priority: "P1", runtimeStatus: "UNKNOWN", proficiencyStatus: "NOT_EVALUATED", certifiedScope: null, legacyAliasCount: 2, gapCount: 0}]};
    expect(m.mapRoleCatalogPage(page)).toEqual({total: 1, nextCursor: null, items: [{roleId: "UASCO-0001", guildId: "G01", clusterId: "CL01", title: "T", priority: "P1", runtimeStatus: "UNKNOWN", proficiencyStatus: "NOT_EVALUATED", certifiedScope: null, legacyAliasCount: 2, gapCount: 0}]});
    for (const bad of [null, {items: [], total: -1}, {items: "x", total: 1}, {items: [], total: 0, nextCursor: "x"}, {items: [{roleId: "UASCO-0001", guildId: "G1", clusterId: "CL01"}], total: 1}, {items: [{roleId: "bad", guildId: "G01", clusterId: "CL01"}], total: 1}])
      expect(m.mapRoleCatalogPage(bad)).toBeNull();
    // Durum yükseltilmez: sunucu ne derse taşınır; eksikse dürüst varsayılan UNKNOWN/NOT_EVALUATED.
    const def = m.mapRoleCatalogPage({total: 1, nextCursor: null, items: [{roleId: "UASCO-0002", guildId: "G01", clusterId: "CL01"}]});
    expect(def.items[0]).toMatchObject({runtimeStatus: "UNKNOWN", proficiencyStatus: "NOT_EVALUATED", title: "UASCO-0002"});
  });
  it("mapRoleDetail sanitizes arrays and never elevates evaluation/runtime status", async () => {
    const m = await load("model.js");
    const d = m.mapRoleDetail(roleDetail("UASCO-0001"));
    expect(d.role.runtimeStatus).toBe("UNKNOWN");
    expect(d.role.proficiencyStatus).toBe("NOT_EVALUATED");
    expect(Array.isArray(d.role.responsibilities)).toBe(true);
    expect(d.role.responsibilities.length).toBeGreaterThan(0);
    expect(d.role.forbiddenActions.length).toBeGreaterThan(0);
    expect(d.role.evaluationSpecs.every((e: any) => e.status !== "PASS" && e.status !== "CERTIFIED")).toBe(true);
    for (const bad of [null, {}, {role: null}, {role: {roleId: "bad"}}]) expect(m.mapRoleDetail(bad)).toBeNull();
  });
  it("api.roleCatalog paginates the whole live /v1/roles catalog complete-or-empty", async () => {
    const {api, calls} = await mkCtx();
    const cat = await api.roleCatalog();
    expect(cat.state).toBe("VERIFIED");
    expect(cat.total).toBe(REG.length);
    expect(cat.items.length).toBe(REG.length);
    expect(cat.items.filter((r: any) => r.proficiencyStatus === "CERTIFIED").length).toBe(0);
    expect(new Set(cat.items.map((r: any) => r.runtimeStatus))).toEqual(new Set(["UNKNOWN"]));
    const cursors = REG.filter((_, i) => i % 100 === 99 && i < REG.length - 1).map(r => `/v1/roles?limit=100&cursor=${r.roleId}`);
    expect(calls.filter(c => c.startsWith("/v1/roles?"))).toEqual(["/v1/roles?limit=100", ...cursors]);
  });
  it("api.roleCatalog returns an honest empty state when /v1/roles is unavailable (never a partial 599)", async () => {
    const {api} = await mkCtx({roles: "off"});
    const cat = await api.roleCatalog();
    expect(cat.items).toEqual([]);
    expect(cat.total).toBeNull();
    expect(cat.state).not.toBe("VERIFIED");
  });
  it("api.roleDetail only requests canonical ids and maps the full definition", async () => {
    const {api, calls} = await mkCtx();
    expect((await api.roleDetail("../x")).state).toBe("ERROR");
    expect((await api.roleDetail("UASCO-9")).state).toBe("ERROR");
    expect(calls.some(c => c.startsWith("/v1/roles/"))).toBe(false);
    const d = await api.roleDetail("UASCO-0001");
    expect(d.state).toBe("VERIFIED");
    expect(d.role.roleId).toBe("UASCO-0001");
    expect(calls).toContain("/v1/roles/UASCO-0001");
  });
});

describe("UX WP-AGENTS main.mjs allow-list (fail-closed /v1/roles/:roleId)", () => {
  it("allows the canonical single-role GET and the list GET, rejects id/segment/query tricks", () => {
    const ok = loadGet();
    for (const p of ["/v1/roles", "/v1/roles?limit=100", "/v1/roles?limit=100&cursor=UASCO-0001", "/v1/roles/UASCO-0001", "/v1/roles/UASCO-0599"]) expect(ok(p), p).toBe(true);
    const bad = ["/v1/roles/", "/v1/roles/UASCO-001", "/v1/roles/UASCO-00001", "/v1/roles/uasco-0001", "/v1/roles/UASCO-0001/", "/v1/roles/UASCO-0001?x=1", "/v1/roles/UASCO-0001/extra", "/v1/roles/UASCO-0001/../company/accounts",
      "/v1/roles/UASCO-0001%2f..", "/v1/roles/../cockpit", "/v1/roles?guildId=G01", "/v1/roles?q=x", "/v1/roles?clusterId=CL01", "/v1/roles?limit=100&foo=1", "/V1/roles/UASCO-0001", "//evil/v1/roles/UASCO-0001"];
    for (const p of bad) expect(ok(p), JSON.stringify(p)).toBe(false);
    for (const nonString of [undefined, null, 1, {}, []]) expect(ok(nonString)).toBe(false);
  });
});

describe("UX WP-AGENTS workforce catalog view (honest semantics, real data only)", () => {
  let reset: () => void;
  beforeEach(async () => { const v = await load("views", "workforce.js"); reset = v.resetWorkforceView; reset(); });

  it("renders an overview bound to the live catalog: real total, UNKNOWN runtime and 0 certified / NOT_EVALUATED, never implies active agents; keeps the honest KPI panels and drops the stale planned panel", async () => {
    const {ctx} = await mkCtx();
    const {node} = await renderWf(ctx);
    // Üst dürüst panel korunur.
    expect(byId(node, "wf-reg")).not.toBeNull();
    expect(byId(node, "wf-act")).not.toBeNull();
    expect(byId(node, "wf-live")).not.toBeNull();
    // Katalog paneli canlı veriye bağlıdır; eski planlı panel yoktur.
    expect(byData(node, "planned").length).toBe(0);
    const cat = byId(node, "wf-catalog")!;
    expect(cat).not.toBeNull();
    const rolesStat = byData(cat, "stat", "roles")[0];
    expect(text(rolesStat)).toContain(String(REG.length));
    const certStat = byData(cat, "stat", "certified")[0];
    expect(certStat.dataset.certified).toBe("0");
    expect(text(certStat)).toContain("NOT_EVALUATED");
    const sem = byData(cat, "semantics", "TARGET_DEFINITIONS")[0];
    expect(text(sem)).toContain(String(REG.length));
    expect(text(sem)).toContain("UNKNOWN");
    // Dürüstlük: anlam bandı rol TANIMI olduğunu ve yeterliliğin NOT_EVALUATED (0 sertifikalı) olduğunu açıkça söyler; canlı/aktif ajan sayısı değildir.
    expect(text(sem)).toContain("TANIMI");
    expect(text(sem)).toContain("NOT_EVALUATED");
  });

  it("filters the catalog by cluster/guild/title from real data (client-side, allow-list only has limit/cursor)", async () => {
    const {ctx} = await mkCtx();
    const first = await renderWf(ctx);
    const clusterSel = byId(first.node, "wf-f-cluster")!;
    const someCluster = REG[0].clusterId;
    // Küme süzgecini uygula (change olayı modül durumunu değiştirir).
    clusterSel.fire("change", {target: {value: someCluster}});
    const node2 = (await (await load("views", "workforce.js")).render(ctx, ROUTE)) as N;
    const rows = byData(node2, "roleId").filter(n => n.tagName === "TR");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => REG.find(x => x.roleId === r.dataset.roleId)!.clusterId === someCluster)).toBe(true);
    // Başlık araması
    const q = byId(node2, "wf-q")!;
    const needle = REG[0].title.slice(0, 6);
    q.fire("change", {target: {value: needle}});
    const node3 = (await (await load("views", "workforce.js")).render(ctx, ROUTE)) as N;
    const rows3 = byData(node3, "roleId").filter(n => n.tagName === "TR");
    expect(rows3.length).toBeGreaterThan(0);
    expect(rows3.every(r => { const role = REG.find(x => x.roleId === r.dataset.roleId)!; return `${role.roleId} ${role.title} ${role.guildId} ${role.clusterId}`.toLocaleLowerCase("tr").includes(needle.toLocaleLowerCase("tr")); })).toBe(true);
  });

  it("opens a role definition detail with responsibilities, specialization, forbidden actions and evaluation specs, all honest and from GET /v1/roles/:roleId", async () => {
    const {ctx, calls} = await mkCtx();
    await renderWf(ctx);
    const id = REG[0].roleId;
    const node2 = (await (await load("views", "workforce.js")).render(ctx, ROUTE)) as N;
    const btn = byData(node2, "roleBtn", id)[0];
    expect(btn).toBeTruthy();
    btn.fire("click");
    expect(calls).not.toContain(`/v1/roles/${id}`); // seçim durumu kuruldu, fetch sonraki render'da
    const node3 = (await (await load("views", "workforce.js")).render(ctx, ROUTE)) as N;
    expect(calls).toContain(`/v1/roles/${id}`);
    const detail = byId(node3, "wf-detail")!;
    const dt = text(detail);
    expect(dt).toContain(REG[0].title);
    expect(byData(detail, "notRuntime").length).toBe(1);
    // Sorumluluklar / yasak eylemler gerçek katalogdan.
    expect(dt).toContain(REG[0].responsibilities[0].slice(0, 12));
    expect(dt).toContain(REG[0].forbiddenActions[0].slice(0, 10));
    // Değerlendirme şartnameleri yürütülmemiş; PASS/CERTIFIED gösterilmez.
    expect(dt).not.toMatch(/\bPASS\b|CERTIFIED/);
    expect(dt.toLowerCase()).toContain("unknown");
  });

  it("shows an honest state (no fabricated 599) when the live catalog is unavailable", async () => {
    const {ctx} = await mkCtx({roles: "off"});
    const {node} = await renderWf(ctx);
    const cat = byId(node, "wf-catalog")!;
    expect(byData(cat, "stat", "roles").length).toBe(0);
    expect(text(cat)).not.toContain(String(REG.length));
  });
});

describe("UX WP-AGENTS locale parity and route", () => {
  it("every new workforce.cat.* key exists in both TR and EN", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const src = fs.readFileSync(path.join(rend, "views", "workforce.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/"(workforce\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(10);
    for (const k of keys) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); }
    // TR ve EN'de workforce.cat.* anahtar kümesi birebir aynıdır.
    const cat = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("workforce.cat.")).sort();
    expect(cat(tr)).toEqual(cat(en));
  });
  it("the workforce route is a real view with no planned package", async () => {
    const routes = await load("routes.js");
    const r = routes.ROUTES.find((x: any) => x.id === "workforce");
    expect(r.view).toBe("workforce");
    expect("plannedPackage" in r).toBe(false);
  });
});

describe("UI-030 active worker fleet grid (live runs only, UNKNOWN stays UNKNOWN)", () => {
  const run = (i: number, status: string, extra: any = {}) => ({runId: `run-${String(i).padStart(4, "0")}`, status, ...extra});
  async function fleetCtx(feed: "ok" | "off" | "err", runs: any[] = []) {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new D(), store = st.createStore(null), navigated: string[] = [];
    const bridge = {apiGet: async (p: string) => {
      if (p === "/v1/cockpit") return COCKPIT;
      if (p === "/v1/agents") return AGENTS;
      if (p === "/v1/work-runs") { if (feed === "off") throw new Error("Failed to fetch"); if (feed === "err") return {workRuns: "bad"}; return {workRuns: runs}; }
      throw new Error(`${p}: HTTP 404`);
    }};
    const t = (k: string, v?: any) => i18n.translate("en", k, v);
    const ctx: any = {doc, store, api: apiMod.createApi({bridge, store}), i18n: {lang: "en", t}, t, navigate: (id: string) => navigated.push(id), rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    const view = await load("views", "workforce.js"); view.resetWorkforceView();
    return {node: (await view.render(ctx, ROUTE)) as N, navigated};
  }
  const fleetNode = (n: N) => byId(n, "wf-fleet")!;

  it("core groups only live runs by status bucket, drops terminal runs and keeps API order", async () => {
    const core = await load("fleet-core.js");
    const g = core.fleetGroups([run(1, "RUNNING"), run(2, "COMPLETED"), run(3, "QUEUED"), run(4, "RUNNING"), null, run(5, "FAILED")]);
    expect(g.total).toBe(3); expect(g.shown).toBe(3); expect(g.truncated).toBe(false);
    expect(g.groups.map((x: any) => [x.status, x.count])).toEqual([["QUEUED", 1], ["RUNNING", 2]]);
    expect(g.groups[1].items.map((r: any) => r.runId)).toEqual(["run-0001", "run-0004"]);
    expect(core.fleetGroups(undefined).total).toBe(0);
  });
  it("core caps at 50 cards while bucket counts and total stay real", async () => {
    const core = await load("fleet-core.js");
    const g = core.fleetGroups(Array.from({length: 70}, (_, i) => run(i, i < 40 ? "RUNNING" : "QUEUED")));
    expect(core.MAX_FLEET_CARDS).toBe(50);
    expect(g.total).toBe(70); expect(g.shown).toBe(50); expect(g.truncated).toBe(true);
    expect(g.groups.reduce((n: number, x: any) => n + x.items.length, 0)).toBe(50);
    expect(g.groups.reduce((n: number, x: any) => n + x.count, 0)).toBe(70);
  });
  it("core card carries only real fields; absent ones are null, never invented", async () => {
    const core = await load("fleet-core.js");
    expect(core.fleetCard(run(1, "RUNNING"))).toEqual({runId: "run-0001", status: "RUNNING", role: null, missionId: null, updatedAt: null});
  });
  it("renders a labelled region, grouped list semantics, <time>, UNKNOWN fields and a keyboard-reachable mission link", async () => {
    const {node, navigated} = await fleetCtx("ok", [run(1, "RUNNING", {role: "ROLE.X", missionId: "msn_0123456789abcdef01234567", heartbeatAt: "2026-10-19T10:00:00.000Z"}), run(2, "QUEUED"), run(3, "COMPLETED")]);
    const region = fleetNode(node);
    expect(byId(node, "wf-fleet")!.tagName).toBe("SECTION");
    const body = all(region).find(n => n.attrs.get("role") === "region")!;
    expect(body.attrs.get("aria-label")).toBeTruthy();
    expect(byTag(region, "ul").length).toBe(2);
    expect(byTag(region, "li").map(li => li.dataset.fleetRunId).sort()).toEqual(["run-0001", "run-0002"]);
    expect(byTag(region, "h3").map(text)).toEqual(["Queued (1)", "Running (1)"]);
    const t = byTag(region, "time"); expect(t.length).toBe(1); expect(t[0].attrs.get("datetime")).toBe("2026-10-19T10:00:00.000Z");
    expect(byData(region, "unknown", "1").length).toBe(2);
    const btn = byTag(region, "button"); expect(btn.length).toBe(1);
    expect(btn[0].attrs.get("type")).toBe("button"); expect(btn[0].attrs.get("aria-label")).toContain("msn_0123456789abcdef01234567"); expect(btn[0].attrs.has("tabindex")).toBe(false);
    btn[0].fire("click"); expect(navigated).toEqual(["work"]);
    expect(text(region)).toContain("not live agents");
  });
  it("shows the showing X of Y note only when truncated and invents no counts", async () => {
    const few = await fleetCtx("ok", [run(1, "RUNNING")]);
    expect(byData(fleetNode(few.node), "truncated").length).toBe(0);
    const many = await fleetCtx("ok", Array.from({length: 60}, (_, i) => run(i, "RUNNING")));
    const note = byData(fleetNode(many.node), "truncated"); expect(note.length).toBe(1);
    expect(text(note[0])).toBe("Showing 50 of 60 live runs.");
    expect(byTag(fleetNode(many.node), "li").length).toBe(50);
  });
  it("read failure replaces the grid with the honest state note, never a 0; empty gives an explicit note", async () => {
    const off = await fleetCtx("off"); const r1 = fleetNode(off.node);
    expect(byTag(r1, "ul").length).toBe(0); expect(all(r1).some(n => n.attrs.get("role") === "status")).toBe(true); expect(text(r1)).not.toMatch(/\b0\b/);
    const err = await fleetCtx("err"); const r2 = fleetNode(err.node);
    expect(byTag(r2, "ul").length).toBe(0); expect(all(r2).some(n => n.attrs.get("role") === "status")).toBe(true);
    const empty = await fleetCtx("ok", [run(1, "COMPLETED")]);
    expect(text(fleetNode(empty.node))).toContain("There are no live work runs");
    expect(byTag(fleetNode(empty.node), "li").length).toBe(0);
  });
  it("workforce.fleet.* keys are identical in EN and TR with the same placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("workforce.fleet.")).sort();
    expect(keys(tr)).toEqual(keys(en)); expect(keys(en).length).toBeGreaterThanOrEqual(10);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys(en)) { expect(ph(tr[k]), k).toEqual(ph(en[k])); expect(tr[k]).toBeTruthy(); }
    expect(tr["workforce.fleet.unknown"]).not.toBe(en["workforce.fleet.unknown"]);
  });
});

describe("UI-030 fleet card does not collide with live-run rows", () => {
  it("fleet cards use data-fleet-run-id so data-run-id stays unique to the live-runs table", async () => {
    const src = fs.readFileSync(path.join(rend, "views", "workforce.js"), "utf8");
    const fleet = src.slice(src.indexOf("function fleetBody"), src.indexOf("const statusChip"));
    expect(fleet).toContain("fleetRunId");
    expect(fleet).not.toMatch(/dataset:\{runId/);
  });
});
