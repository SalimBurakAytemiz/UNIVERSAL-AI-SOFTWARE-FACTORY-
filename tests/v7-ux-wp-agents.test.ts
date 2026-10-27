// //TR: Bu test UX WP-AGENTS AI İş Gücü rol kataloğu görünümünü (apps/desktop/renderer/views/workforce.js) ve destekleyen saf modelini (mapRoleCatalogPage/mapRoleDetail) + api.roleCatalog()/roleDetail() + main.mjs allow-list'ini doğrular: katalog yalnız canlı /v1/roles kanonik kaydından (tam-ya-da-boş sayfalama) okunur; 599 rol TANIMI dürüst sayılır ama runtimeStatus UNKNOWN ve proficiencyStatus NOT_EVALUATED (0 sertifikalı) belirgin gösterilir, asla N aktif ajan/sertifikalı işçi ima edilmez; küme/lonca/başlık süzgeci gerçek veriden çalışır; rol tanımı ayrıntısı GET /v1/roles/:roleId'den sorumluluklar/uzmanlık/yasak eylemler/değerlendirme şartnamelerini gösterir; /v1/roles/:roleId yalnız kanonik kimlikle fail-closed allow-list'tedir; workforce.cat.* sözlüğü EN/TR'de birebirdir; eksik/bozuk katalogda dürüst durum, uydurma yok.
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {computeRoleReadiness, loadReadinessInputFromRepo, reconcileLegacyStatusSummary} from "../core/agents/readiness-audit.js";
import {computeRoleStatusSummary} from "../core/agents/role-lifecycle.js";
import {WorkOsStore} from "../core/workos/store.js";
import {ACTIVE_WORKER_STATUSES, RUN_STATUSES as SERVER_RUN_STATUSES} from "../core/workos/run-state.js";

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

interface Feed { roles?: "ok" | "off"; detail?: boolean; statusSummary?: unknown }
async function mkCtx(feed: Feed = {roles: "ok", detail: true}, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], navigated: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    calls.push(p);
    if (p === "/v1/roles/status-summary" && feed.statusSummary !== undefined) { if (feed.statusSummary instanceof Error) throw feed.statusSummary; return feed.statusSummary; }
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

// //TR: UI-197 Uzman Rol Taksonomisi testleri: ağaç yalnız /v1/roles alanlarından türetilir, sıralama deterministiktir, VERIFIED olmayan katalogda ağaç yerine dürüst not vardır, genom uydurulmaz, taksonomi anahtarları EN/TR'de birebirdir.
describe("UI-197 workforce taxonomy (cluster > guild, derived only from /v1/roles fields)", () => {
  beforeEach(async () => { (await load("views", "workforce.js")).resetWorkforceView(); });
  it("pure core sorts deterministically and counts only existing fields", async () => {
    const {buildTaxonomy} = await load("workforce-taxonomy-core.js");
    const items = [
      {roleId: "R3", clusterId: "C2", guildId: "G9", proficiencyStatus: "NOT_EVALUATED"},
      {roleId: "R1", clusterId: "C10", guildId: "G2", proficiencyStatus: "CERTIFIED"},
      {roleId: "R2", clusterId: "C2", guildId: "G1", proficiencyStatus: "NOT_EVALUATED"},
      {roleId: "R4", clusterId: "C2", guildId: "G1", proficiencyStatus: "NOT_EVALUATED"},
    ];
    const a = buildTaxonomy(items), b = buildTaxonomy([...items].reverse());
    expect(a).toEqual(b);
    expect(a.clusters.map((c: any) => c.clusterId)).toEqual(["C10", "C2"]);
    expect(a.clusters[1].guilds.map((g: any) => `${g.guildId}:${g.roles}`)).toEqual(["G1:2", "G9:1"]);
    expect([a.clusterCount, a.guildCount, a.roleCount]).toEqual([2, 3, 4]);
    expect(a.clusters[0].certified).toBe(1);
    expect(JSON.stringify(a).toLowerCase()).not.toContain("genome");
  });
  it("renders the read-only tree from the live catalog with real totals", async () => {
    const {ctx} = await mkCtx();
    const {node} = await renderWf(ctx);
    const tx = byId(node, "wf-taxonomy")!;
    expect(tx).not.toBeNull();
    const clusters = new Set(REG.map(r => r.clusterId)), guilds = new Set(REG.map(r => `${r.clusterId}/${r.guildId}`));
    expect(byData(tx, "clusterId").length).toBe(clusters.size);
    expect(byData(tx, "guildId").length).toBe(guilds.size);
    expect(text(byData(tx, "taxonomySummary")[0])).toContain(String(REG.length));
    const ids = byData(tx, "clusterId").map(n => n.dataset.clusterId);
    expect(ids).toEqual([...ids].sort());
    expect(byTag(tx, "button").length).toBe(0);
    expect(byTag(tx, "input").length).toBe(0);
  });
  it("shows an honest state note and no tree when the catalog is not VERIFIED", async () => {
    const {ctx} = await mkCtx({roles: "off"});
    const {node} = await renderWf(ctx);
    const tx = byId(node, "wf-taxonomy")!;
    expect(tx).not.toBeNull();
    expect(byData(tx, "clusterId").length).toBe(0);
    expect(byData(tx, "taxonomyState").length).toBe(1);
    // Doğrudan: küme/lonca düğümü yok ve tam olarak TEK durum notu (role=status) var.
    expect(byData(tx, "clusterId").length).toBe(0);
    expect(byData(tx, "guildId").length).toBe(0);
    expect(byData(tx, "taxonomySummary").length).toBe(0);
    expect(all(tx).filter(n => n.attrs.get("role") === "status").length).toBe(1);
    // Yalnız lead + tek durum notu: yinelenen durum mesajı yok.
    expect(byTag(tx, "p").length).toBe(2);
  });
  it("core reports skippedCount for malformed items and never throws", async () => {
    const {buildTaxonomy} = await load("workforce-taxonomy-core.js");
    const ok = {clusterId: "C1", guildId: "G1", proficiencyStatus: "NOT_EVALUATED"};
    const t = buildTaxonomy([ok, null, 5, "x", {clusterId: "C1"}, {guildId: "G1"}, {clusterId: 1, guildId: "G1"}, undefined]);
    expect([t.skippedCount, t.totalCount, t.roleCount]).toEqual([7, 8, 1]);
    const bad = buildTaxonomy([null, 3, {clusterId: "C1"}]);
    expect(bad.clusters).toEqual([]);
    expect([bad.skippedCount, bad.totalCount]).toEqual([3, 3]);
    for (const x of [null, undefined, "x", 3, {}]) expect(buildTaxonomy(x)).toMatchObject({clusters: [], skippedCount: 0, totalCount: 0});
  });
  it("core counts only exact CERTIFIED and keeps case/whitespace ids distinct", async () => {
    const {buildTaxonomy} = await load("workforce-taxonomy-core.js");
    const t = buildTaxonomy([
      {clusterId: "C1", guildId: "G1", proficiencyStatus: "certified"},
      {clusterId: "C1", guildId: "G1", proficiencyStatus: "CERTIFIED"},
      {clusterId: "c1", guildId: "G1", proficiencyStatus: "NOT_EVALUATED"},
      {clusterId: "C1 ", guildId: "G1", proficiencyStatus: "NOT_EVALUATED"},
    ]);
    expect(t.clusters.find((c: any) => c.clusterId === "C1").certified).toBe(1);
    expect(t.clusterCount).toBe(3);
    expect(t.clusters.map((c: any) => c.clusterId).sort()).toEqual(["C1", "C1 ", "c1"]);
  });
  it("core merges duplicate cluster/guild keys and separates pair count from distinct guild ids", async () => {
    const {buildTaxonomy} = await load("workforce-taxonomy-core.js");
    const t = buildTaxonomy([{clusterId: "C1", guildId: "G1"}, {clusterId: "C1", guildId: "G1"}, {clusterId: "C2", guildId: "G1"}]);
    expect(t.clusters[0].guilds).toEqual([{guildId: "G1", roles: 2, certified: 0}]);
    expect([t.guildCount, t.distinctGuildCount, t.roleCount]).toEqual([2, 1, 3]);
  });
  it("view shows a skipped note with numbers, and 'unclassified' (never 'empty') when nothing is classifiable", async () => {
    const mk = async (items: any[]) => { const {ctx} = await mkCtx(); ctx.api.roleCatalog = async () => ({state: "VERIFIED", total: items.length, items}); const {node} = await renderWf(ctx); return byId(node, "wf-taxonomy")!; };
    const good = {roleId: "R1", title: "t", clusterId: "C1", guildId: "G1", proficiencyStatus: "NOT_EVALUATED"};
    const tx1 = await mk([good, {roleId: "R2", title: "t", clusterId: "C1"}]);
    const sk = byData(tx1, "taxonomySkipped");
    expect(sk.length).toBe(1);
    expect(text(sk[0])).toContain("1");
    expect(text(sk[0])).toContain("2");
    expect(text(byData(tx1, "taxonomySummary")[0])).toContain("1");
    const tx0 = await mk([good]);
    expect(byData(tx0, "taxonomySkipped").length).toBe(0);
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tx2 = await mk([{roleId: "R2", title: "t", clusterId: "C1"}, {roleId: "R3", title: "t"}]);
    expect(byData(tx2, "clusterId").length).toBe(0);
    expect(byData(tx2, "taxonomyUnclassified").length).toBe(1);
    expect(text(tx2)).not.toContain("no role definitions");
    expect(text(tx2)).not.toContain(en["workforce.cat.empty"]);
    const tx3 = await mk([]);
    expect(byData(tx3, "taxonomyUnclassified").length).toBe(0);
  });
  it("taxonomy locale keys exist in TR and EN with identical key sets", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tk = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("workforce.taxonomy.")).sort();
    expect(tk(en).length).toBeGreaterThan(3);
    expect(tk(tr)).toEqual(tk(en));
    // Yer tutucu paritesi: her anahtarda {c},{g},{d},{r},{k},{s},{t} kümeleri EN ve TR'de aynıdır.
    const ph = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
    for (const k of tk(en)) expect(ph(tr[k]), k).toBe(ph(en[k]));
    expect(ph(en["workforce.taxonomy.summary"])).toBe("c,d,g,r");
    expect(ph(en["workforce.taxonomy.counts"])).toBe("g,k,r");
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

// //TR: test+states: workforce (functional/negative/a11y) — AI İş Gücü: kokpit/ajan/koşu/katalog okumaları tek tek düştüğünde sayı uydurulmadığını (599 canlı ajan değildir, 0 sertifikalı), rol ayrıntısı okunamazsa ayrıntı uydurulmadığını, eşleşmeyen süzgecin dürüst boş metin verdiğini ve erişilebilirlik sözleşmesini (h1 tabindex, tipli düğmeler, etiketli seçiciler, tablo başlıkları, role=note/status) ve görünümün kullandığı tüm anahtarların TR/EN eşitliğini doğrular.
describe("test+states workforce: negative (independent read failures, no invented figures)", () => {
  // Her okuma bağımsız denetlenir: get(path) undefined dönerse 404, "off" ağ hatası.
  const mkWf = async (over: Record<string, any> = {}, lang = "tr") => {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new D(), store = st.createStore(null), calls: string[] = [];
    const bridge = {apiGet: async (p: string) => {
      calls.push(p);
      const key = p.startsWith("/v1/roles/") ? "detail" : p.startsWith("/v1/roles") ? "roles" : p === "/v1/cockpit" ? "cockpit" : p === "/v1/agents" ? "agents" : p === "/v1/work-runs" ? "runs" : "other";
      if (key in over) { const v = over[key]; if (v === "off") throw new Error("fetch failed"); if (v === "404") throw new Error(`${p}: HTTP 404`); return typeof v === "function" ? v(p) : v; }
      if (key === "detail") { const d = roleDetail(p.slice("/v1/roles/".length)); if (!d) throw new Error(`${p}: HTTP 404`); return d; }
      if (key === "roles") return rolesPage(p);
      if (key === "cockpit") return COCKPIT;
      if (key === "agents") return AGENTS;
      if (key === "runs") return {workRuns: []};
      throw new Error(`${p}: HTTP 404`);
    }};
    const api = apiMod.createApi({bridge, store});
    const t = (k: string, v?: any) => i18n.translate(lang, k, v);
    const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate: () => {}, rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    return {ctx, doc, calls};
  };
  const render = async (over: Record<string, any> = {}, lang = "tr") => { const w = await mkWf(over, lang); const view = await load("views", "workforce.js"); view.resetWorkforceView(); return {...w, view, node: (await view.render(w.ctx, ROUTE)) as N}; };

  it("when cockpit, agents and catalog all fail: em-dash counts, no VERIFIED claim, no role rows, no invented 599", async () => {
    // //TR: Tüm okumalar düşünce hiçbir sayı/rol uydurulmaz.
    const {node} = await render({cockpit: "404", agents: "404", roles: "404", runs: "404"});
    expect(text(byId(node, "wf-reg")!)).toContain("—");
    expect(text(byId(node, "wf-act")!)).toContain("—");
    expect(text(byId(node, "wf-reg")!)).not.toContain("599");
    expect(byData(node, "roleBtn").length).toBe(0);
    expect(byId(node, "wf-browse")).toBeNull();
    expect(text(byId(node, "wf-catalog")!)).not.toContain("599");
    expect(byData(node, "pill", "VERIFIED").length).toBe(0);
    expect(byData(byId(node, "wf-reg")!, "certified").length).toBe(0); // sertifikalı sayısı bilinmiyorsa satır yok
  });
  it("offline (network) failures are distinct from 404 and still invent nothing", async () => {
    const {node} = await render({cockpit: "off", agents: "off", roles: "off", runs: "off"});
    expect(text(byId(node, "wf-reg")!)).toContain("—");
    expect(byData(node, "roleBtn").length).toBe(0);
    expect(byData(node, "runId").length).toBe(0);
  });
  it("a failed /v1/agents keeps the cockpit-derived count labelled and drops the certified line (never 0 certified invented)", async () => {
    const {node} = await render({agents: "404"});
    expect(byData(byId(node, "wf-reg")!, "certified").length).toBe(0);
    expect(byId(node, "wf-reg")).not.toBeNull();
  });
  it("malformed agents payload (negative / non-integer counts) is not shown as a count", async () => {
    const {node} = await render({agents: {registeredRoles: -5, certified: "x", legacyRoles: 1.5}});
    expect(text(byId(node, "wf-reg")!)).not.toContain("-5");
    expect(byData(byId(node, "wf-reg")!, "certified").length).toBe(0);
  });
  it("a malformed or partial role catalog page shows no rows and no partial total (complete-or-empty)", async () => {
    for (const bad of [{items: "x", total: 3}, {total: 600, items: [], nextCursor: null}, null]) {
      const {node} = await render({roles: bad});
      expect(byData(node, "roleBtn").length, JSON.stringify(bad)).toBe(0);
      expect(byId(node, "wf-browse")).toBeNull();
      expect(byData(node, "stat", "roles").length).toBe(0);
    }
  });
  it("an empty (but readable) catalog says so honestly and shows zero stats instead of a table", async () => {
    const {node} = await render({roles: {status: "X", total: 0, items: [], nextCursor: null}});
    expect(byData(node, "roleBtn").length).toBe(0);
    expect(all(node).filter(n => n.tagName === "TABLE" && n.className.includes("wf-cat-table")).length).toBe(0);
  });
  it("selecting a role whose definition read fails shows an honest state and invents no responsibilities", async () => {
    const view = await load("views", "workforce.js");
    const first = REG[0].roleId;
    const w = await mkWf({detail: "404"});
    view.resetWorkforceView();
    let node = (await view.render(w.ctx, ROUTE)) as N;
    byData(node, "roleBtn", first)[0].fire("click");
    node = (await view.render(w.ctx, ROUTE)) as N;
    const detail = byId(node, "wf-detail")!;
    expect(detail.textContent).toContain("Kullanılamıyor");
    expect(all(detail).filter(n => n.className.includes("wf-def")).length).toBe(0);
    expect(byId(node, "wf-detail-close")).toBeNull();
    view.resetWorkforceView();
  });
  it("a search that matches nothing shows the honest no-match text, no table and no results count above zero", async () => {
    const view = await load("views", "workforce.js");
    const w = await mkWf();
    view.resetWorkforceView();
    let node = (await view.render(w.ctx, ROUTE)) as N;
    const q = byId(node, "wf-q")!; q.value = "zzzz-yok-boyle-rol-zzzz"; q.fire("change", {target: q});
    node = (await view.render(w.ctx, ROUTE)) as N;
    expect(byData(node, "roleBtn").length).toBe(0);
    expect(byId(node, "wf-f-clear")).not.toBeNull(); // süzgeç temizlenebilir
    view.resetWorkforceView();
  });
  it("renders role text from the API as text only (no markup nodes)", async () => {
    const hostile = {...rolesPage("/v1/roles?limit=100"), total: 1, nextCursor: null, items: [{...roleItem(REG[0]), title: "<img src=x onerror=1>"}]};
    const {node} = await render({roles: hostile});
    expect(text(node)).toContain("<img src=x onerror=1>");
    expect(all(node).some(n => n.tagName === "IMG" || n.tagName === "SCRIPT")).toBe(false);
  });
});

describe("test+states workforce: accessibility and keyboard", () => {
  it("h1 is unique with tabindex -1; every button is typed; honesty notes carry role=note", async () => {
    // //TR: h1 odak hedefidir; tüm düğmeler tiplidir; anlam notları role=note taşır.
    const {ctx} = await mkCtx();
    const {node} = await renderWf(ctx);
    const h1s = byTag(node, "h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].id).toBe("view-title");
    expect(h1s[0].getAttribute("tabindex")).toBe("-1");
    const btns = byTag(node, "button");
    expect(btns.length).toBeGreaterThan(0);
    for (const b of btns) expect(["button", "submit"], b.id || text(b)).toContain(b.getAttribute("type"));
    const notes = all(node).filter(n => n.className.includes("note-catalog"));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.getAttribute("role")).toBe("note");
  });
  it("filter controls are a labelled group; selects and the search input have labels and an aria-label; the search hint is described-by", async () => {
    const {ctx} = await mkCtx();
    const {node} = await renderWf(ctx);
    const group = all(node).find(n => n.className.includes("wf-filter"))!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")!.length).toBeGreaterThan(0);
    for (const id of ["wf-f-cluster", "wf-f-guild", "wf-q"]) {
      const c = byId(node, id)!;
      expect(c.getAttribute("aria-label")!.length, id).toBeGreaterThan(0);
      expect(all(node).some(n => n.tagName === "LABEL" && n.getAttribute("for") === id), id).toBe(true);
    }
    expect(byId(node, "wf-q")!.getAttribute("aria-describedby")).toBe("wf-q-hint");
    expect(byId(node, "wf-q-hint")).not.toBeNull();
  });
  it("catalog and live-run tables carry captions and column-scoped headers; row buttons have an accessible name and aria-current on the selected role", async () => {
    const view = await load("views", "workforce.js");
    const {ctx} = await mkCtx();
    view.resetWorkforceView();
    let node = (await view.render(ctx, ROUTE)) as N;
    const table = all(node).find(n => n.tagName === "TABLE" && n.className.includes("wf-cat-table"))!;
    expect(all(table).some(n => n.tagName === "CAPTION" && text(n).length > 0)).toBe(true);
    const ths = all(table).filter(n => n.tagName === "TH");
    expect(ths.length).toBe(7);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
    const btn = byData(node, "roleBtn")[0];
    expect(btn.getAttribute("aria-label")!.length).toBeGreaterThan(0);
    expect(btn.getAttribute("aria-current")).toBeNull();
    btn.fire("click");
    node = (await view.render(ctx, ROUTE)) as N;
    expect(byData(node, "roleBtn", btn.dataset.roleBtn)[0].getAttribute("aria-current")).toBe("true");
    const close = byId(node, "wf-detail-close")!;
    expect(close.getAttribute("type")).toBe("button");
    expect(byId(node, "wf-detail-h")!.getAttribute("tabindex")).toBe("-1");
    // //TR: Aynı kimlik iki öğede bulunmaz (panel başlığı wf-detail-t, ayrıntı başlığı wf-detail-h).
    const ids = all(node).map(n => n.id).filter(Boolean);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    close.fire("click");
    node = (await view.render(ctx, ROUTE)) as N;
    expect(byId(node, "wf-detail-close")).toBeNull();
    view.resetWorkforceView();
  });
  it("live runs table is labelled and the status messages for degraded reads are role=status", async () => {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new D(), store = st.createStore(null);
    const live = {workRuns: [{runId: "run_live_0001", missionId: "msn_" + "ab12".repeat(6), status: "RUNNING", role: "qa-engineer", heartbeatAt: "2026-10-16T00:00:00.000Z"}]};
    const bridge = {apiGet: async (p: string) => { if (p === "/v1/work-runs") return live; if (p === "/v1/cockpit") return COCKPIT; if (p === "/v1/agents") return AGENTS; throw new Error(`${p}: HTTP 404`); }};
    const t = (k: string, v?: any) => i18n.translate("tr", k, v);
    const ctx: any = {doc, store, api: apiMod.createApi({bridge, store}), i18n: {lang: "tr", t}, t, navigate: () => {}, rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    const view = await load("views", "workforce.js"); view.resetWorkforceView();
    const node = (await view.render(ctx, ROUTE)) as N;
    const liveTable = all(byId(node, "wf-live")!).find(n => n.tagName === "TABLE")!;
    expect(all(liveTable).some(n => n.tagName === "CAPTION")).toBe(true);
    for (const th of all(liveTable).filter(n => n.tagName === "TH")) expect(th.getAttribute("scope")).toBe("col");
    const degraded = all(node).filter(n => n.className.includes("note-unavailable") || n.className.includes("note-error"));
    expect(degraded.length).toBeGreaterThan(0); // katalog 404
    for (const n of degraded) expect(n.getAttribute("role")).toBe("status");
  });
});

describe("test+states workforce: EN/TR parity for every key the view uses", () => {
  it("whole dictionaries match and every literal key in workforce.js exists in both locales with equal placeholders; English differs from Turkish", async () => {
    // //TR: workforce.js içindeki tüm sabit anahtarlar iki dilde vardır.
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const src = fs.readFileSync(path.join(rend, "views", "workforce.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|emptyNote\(ctx,|defList\(ctx,)\s*"([a-zA-Z0-9_.-]+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/"((?:workforce|run|area\.workforce)\.[A-Za-z0-9_.-]+)"/g)) keys.add(m[1]);
    const real = [...keys].filter(k => !/[${}]/.test(k));
    expect(real.length).toBeGreaterThan(40);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of real) { expect(k in tr && k in en, k).toBe(true); expect(ph(en[k]), k).toBe(ph(tr[k])); expect(tr[k].trim().length, k).toBeGreaterThan(0); expect(en[k].trim().length, k).toBeGreaterThan(0); }
    expect(en["workforce.cat.title"]).not.toBe(tr["workforce.cat.title"]);
  });
  it("English rendering shows the honest-semantics note in English and does not call role definitions live agents", async () => {
    const { ctx } = await mkCtx({roles: "ok", detail: true}, "en");
    const {node} = await renderWf(ctx);
    const sem = byData(node, "semantics", "TARGET_DEFINITIONS")[0];
    expect(sem).toBeDefined();
    expect(text(sem)).toContain("NOT a count of live/active agents");
    expect(text(sem)).not.toMatch(/canlı|çalışan ajan/i);
  });
});

describe("test+states workforce: unique DOM ids (regression: duplicate wf-detail-t)", () => {
  it("no id appears twice in the default and no-catalog renders, and the detail heading has its own id", async () => {
    // //TR: Panel başlığı ile ayrıntı başlığı aynı kimliği paylaşmaz (aria-labelledby belirsizliği olmaz).
    const view = await load("views", "workforce.js");
    for (const feed of [{roles: "ok", detail: true}, {roles: "off", detail: false}] as Feed[]) {
      const {ctx} = await mkCtx(feed);
      view.resetWorkforceView();
      const node = (await view.render(ctx, ROUTE)) as N;
      const ids = all(node).map(n => n.id).filter(Boolean);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), JSON.stringify(feed)).toEqual([]);
      expect(byId(node, "wf-detail-h")).not.toBeNull();
    }
    view.resetWorkforceView();
  });
});

describe("UI-030 worker fleet grid (live / queued / unknown buckets, UNKNOWN stays UNKNOWN)", () => {
  const run = (i: number, status: string, extra: any = {}) => ({runId: `run-${String(i).padStart(4, "0")}`, status, ...extra});
  async function fleetCtx(feed: "ok" | "off" | "err", runs: any[] = [], lang: "en" | "tr" = "en") {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new D(), store = st.createStore(null), navigated: string[] = [];
    const bridge = {apiGet: async (p: string) => {
      if (p === "/v1/cockpit") return COCKPIT;
      if (p === "/v1/agents") return AGENTS;
      if (p === "/v1/work-runs") { if (feed === "off") throw new Error("Failed to fetch"); if (feed === "err") return {workRuns: "bad"}; return {workRuns: runs}; }
      throw new Error(`${p}: HTTP 404`);
    }};
    const t = (k: string, v?: any) => i18n.translate(lang, k, v);
    const ctx: any = {doc, store, api: apiMod.createApi({bridge, store}), i18n: {lang, t}, t, navigate: (id: string) => navigated.push(id), rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    const view = await load("views", "workforce.js"); view.resetWorkforceView();
    return {node: (await view.render(ctx, ROUTE)) as N, navigated, ctx, view};
  }
  const fleetNode = (n: N) => byId(n, "wf-fleet")!;

  // //TR: A-RUNSTATE-1: "COMPLETED" bir sunucu RunStatus'u değildir (artık UNKNOWN kovasına düşer); terminal koşu için gerçek SUCCEEDED/FAILED kullanılır. QUEUED artık canlı değil, ayrı kovadır.
  it("core groups live runs by server worker status, keeps QUEUED as a separate bucket, drops terminal runs and keeps API order", async () => {
    const core = await load("fleet-core.js");
    const g = core.fleetGroups([run(1, "RUNNING"), run(2, "SUCCEEDED"), run(3, "QUEUED"), run(4, "RUNNING"), null, run(5, "FAILED")]);
    expect(g.total).toBe(3); expect(g.shown).toBe(3); expect(g.truncated).toBe(false);
    expect(g.live).toBe(2);
    expect(g.queued).toBe(1);
    expect(g.unknown).toBe(0);
    expect(g.groups.map((x: any) => [x.status, x.bucket, x.count])).toEqual([["RUNNING", "LIVE", 2], ["QUEUED", "QUEUED", 1]]);
    expect(g.groups[0].items.map((r: any) => r.runId)).toEqual(["run-0001", "run-0004"]);
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
    // //TR: A-RUNSTATE-1: kart artık kovasını da taşır (bucket); diğer alanlar aynı.
    expect(core.fleetCard(run(1, "RUNNING"))).toEqual({runId: "run-0001", status: "RUNNING", bucket: "LIVE", role: null, missionId: null, updatedAt: null});
  });
  it("renders a labelled region, grouped list semantics, <time>, UNKNOWN fields and a keyboard-reachable mission link", async () => {
    const {node, navigated} = await fleetCtx("ok", [run(1, "RUNNING", {role: "ROLE.X", missionId: "msn_0123456789abcdef01234567", heartbeatAt: "2026-10-19T10:00:00.000Z"}), run(2, "QUEUED"), run(3, "SUCCEEDED")]);
    const region = fleetNode(node);
    expect(byId(node, "wf-fleet")!.tagName).toBe("SECTION");
    const body = all(region).find(n => n.attrs.get("role") === "region")!;
    expect(body.attrs.get("aria-label")).toBeTruthy();
    expect(byTag(region, "ul").length).toBe(2);
    expect(byTag(region, "li").map(li => li.dataset.fleetRunId).sort()).toEqual(["run-0001", "run-0002"]);
    // //TR: A-RUNSTATE-1: canlı kovalar önce, kuyruk kovası kendi "henüz çalışmıyor" başlığıyla sonra.
    expect(byTag(region, "h3").map(text)).toEqual(["Running (1)", "Queued, not running yet (1)"]);
    const t = byTag(region, "time"); expect(t.length).toBe(1); expect(t[0].attrs.get("datetime")).toBe("2026-10-19T10:00:00.000Z");
    expect(byData(region, "unknown", "1").length).toBe(2);
    const btn = byTag(region, "button").filter(b => b.attrs.get("id") === "wf-fleet-open-run-0001"); expect(btn.length).toBe(1);
    expect(btn[0].attrs.get("type")).toBe("button"); expect(btn[0].attrs.get("aria-label")).toContain("msn_0123456789abcdef01234567"); expect(btn[0].attrs.has("tabindex")).toBe(false);
    btn[0].fire("click"); expect(navigated).toEqual(["work"]);
    expect(text(region)).toContain("not live agents");
  });
  it("shows the showing X of Y note only when truncated and invents no counts", async () => {
    const few = await fleetCtx("ok", [run(1, "RUNNING")]);
    expect(byData(fleetNode(few.node), "truncated").length).toBe(0);
    const many = await fleetCtx("ok", Array.from({length: 60}, (_, i) => run(i, "RUNNING")));
    const note = byData(fleetNode(many.node), "truncated"); expect(note.length).toBe(1);
    // //TR: A-RUNSTATE-1 (#273 LOW): not artık canlı + kuyruk + bilinmeyen kartları adlandırır; diğer durumlar (yeniden deneme vb.) "tüm koşular" gibi okunmaz.
    expect(text(note[0])).toBe("Showing 50 of 60 live, queued and unknown-status runs.");
    expect(byTag(fleetNode(many.node), "li").length).toBe(50);
  });
  it("read failure replaces the grid with the honest state note, never a 0; empty gives an explicit note", async () => {
    const off = await fleetCtx("off"); const r1 = fleetNode(off.node);
    expect(byTag(r1, "ul").length).toBe(0); expect(all(r1).some(n => n.attrs.get("role") === "status")).toBe(true); expect(text(r1)).not.toMatch(/\b0\b/);
    const err = await fleetCtx("err"); const r2 = fleetNode(err.node);
    expect(byTag(r2, "ul").length).toBe(0); expect(all(r2).some(n => n.attrs.get("role") === "status")).toBe(true);
    const empty = await fleetCtx("ok", [run(1, "SUCCEEDED")]);
    expect(text(fleetNode(empty.node))).toContain("There are no live work runs");
    expect(byTag(fleetNode(empty.node), "li").length).toBe(0);
  });
  // //TR: A-RUNSTATE-1 eşlik testi: renderer'ın canlı/kuyruk/durum kümeleri sunucunun core/workos/run-state.ts dosyasından (ACTIVE_WORKER_STATUSES, RUN_STATUSES) gerçekten içe aktarılarak karşılaştırılır; sunucu kümesi değişirse bu test CI'da düşer.
  it("parity: the renderer's live set IS the server ACTIVE_WORKER_STATUSES and its status copy IS the server RUN_STATUSES", async () => {
    const work = await load("work-core.js"), exec = await load("executive-core.js");
    expect([...work.RUN_LIVE_STATES]).toEqual([...ACTIVE_WORKER_STATUSES]);
    expect([...exec.RUN_STATUSES].sort()).toEqual([...SERVER_RUN_STATUSES].sort());
    expect(work.RUN_QUEUED_STATE).toBe("QUEUED");
    expect(SERVER_RUN_STATUSES).toContain("QUEUED");
    expect(ACTIVE_WORKER_STATUSES).not.toContain("QUEUED");
    expect(SERVER_RUN_STATUSES).not.toContain("STARTING");
    expect(SERVER_RUN_STATUSES).not.toContain("REVIEWING");
    expect(work.RUN_LIVE_STATES).toContain("CHECKPOINTING");
    expect(work.RUN_LIVE_STATES).not.toContain("STARTING");
    expect(work.RUN_LIVE_STATES).not.toContain("REVIEWING");
    expect(work.RUN_LIVE_STATES).not.toContain("QUEUED");
  });
  it("runBucket maps every server RunStatus to exactly one bucket and sends anything else to UNKNOWN, never LIVE", async () => {
    const core = await load("fleet-core.js");
    for (const st of SERVER_RUN_STATUSES) {
      const want = (ACTIVE_WORKER_STATUSES as readonly string[]).includes(st) ? "LIVE" : st === "QUEUED" ? "QUEUED" : "OTHER";
      expect(core.runBucket(st), st).toBe(want);
    }
    for (const bad of ["STARTING", "REVIEWING", "COMPLETED", "running", "RUNNING ", "", "—", null, undefined, 7, {}]) {
      expect(core.runBucket(bad), String(bad)).toBe("UNKNOWN");
    }
  });
  it("fleetGroups: live statuses in server order incl. CHECKPOINTING, then QUEUED, then UNKNOWN; unknown never counts as live", async () => {
    const core = await load("fleet-core.js");
    const g = core.fleetGroups([run(1, "VERIFYING"), run(2, "STARTING"), run(3, "QUEUED"), run(4, "CHECKPOINTING"), run(5, "REVIEWING"), run(6, "LEASED"), run(7, "RUNNING"), run(8, "SUCCEEDED"), run(9, "—")]);
    expect(g.groups.map((x: any) => [x.status, x.bucket, x.count])).toEqual([["LEASED", "LIVE", 1], ["RUNNING", "LIVE", 1], ["CHECKPOINTING", "LIVE", 1], ["VERIFYING", "LIVE", 1], ["QUEUED", "QUEUED", 1], ["UNKNOWN", "UNKNOWN", 3]]);
    expect(g.live).toBe(4); expect(g.queued).toBe(1); expect(g.unknown).toBe(3); expect(g.total).toBe(8);
    expect(g.groups[5].items.map((r: any) => r.runId)).toEqual(["run-0002", "run-0005", "run-0009"]);
  });
  it("fleetGroups: the card cap fills live buckets first, so queued/unknown runs never push a live run out; counts stay real", async () => {
    const core = await load("fleet-core.js");
    const g = core.fleetGroups([...Array.from({length: 5}, (_, i) => run(100 + i, "QUEUED")), ...Array.from({length: 50}, (_, i) => run(i, "RUNNING")), run(900, "STARTING")]);
    expect(g.live).toBe(50); expect(g.queued).toBe(5); expect(g.unknown).toBe(1);
    expect(g.shown).toBe(50); expect(g.truncated).toBe(true);
    expect(g.groups.find((x: any) => x.status === "RUNNING").items.length).toBe(50);
    expect(g.groups.find((x: any) => x.status === "QUEUED").items.length).toBe(0);
    expect(g.groups.find((x: any) => x.status === "QUEUED").count).toBe(5);
  });
  it("cards and details carry their own bucket: QUEUED and unknown-status runs are never tagged LIVE", async () => {
    const core = await load("fleet-core.js");
    expect(core.fleetCard(run(1, "QUEUED")).bucket).toBe("QUEUED");
    expect(core.fleetCard(run(2, "STARTING")).bucket).toBe("UNKNOWN");
    expect(core.fleetCard(run(3, "VERIFYING")).bucket).toBe("LIVE");
    const runs = [run(1, "QUEUED"), run(2, "REVIEWING"), run(3, "CHECKPOINTING")];
    expect(core.fleetDetail(runs, "run-0001").bucket).toBe("QUEUED");
    expect(core.fleetDetail(runs, "run-0002").bucket).toBe("UNKNOWN");
    expect(core.fleetDetail(runs, "run-0003").bucket).toBe("LIVE");
  });
  it("a bucket whose cards were all cut by the cap keeps its heading and real count but renders no empty list", async () => {
    const {node} = await fleetCtx("ok", [...Array.from({length: 50}, (_, i) => run(i, "RUNNING")), run(900, "QUEUED"), run(901, "QUEUED"), run(902, "QUEUED")]);
    const region = fleetNode(node);
    expect(byTag(region, "h3").map(text)).toEqual(["Running (50)", "Queued, not running yet (3)"]);
    expect(byTag(region, "ul").length).toBe(1);
    expect(byTag(region, "li").length).toBe(50);
    // //TR: #273 LOW: not canlı + kuyruk + bilinmeyen kartları adlandırır.
    expect(text(byData(region, "truncated", "1")[0])).toBe("Showing 50 of 53 live, queued and unknown-status runs.");
  });
  it("renders QUEUED and unknown-status runs in their own labelled buckets with a summary; the Live runs table lists only live workers", async () => {
    const {node} = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "CHECKPOINTING"), run(3, "QUEUED"), run(4, "STARTING"), run(5, "SUCCEEDED")]);
    const region = fleetNode(node);
    expect(byTag(region, "h3").map(text)).toEqual(["Running (1)", "Checkpointing (1)", "Queued, not running yet (1)", "Unknown status (1)"]);
    expect(text(byData(region, "fleetSummary", "1")[0])).toBe("2 live, 1 queued (not running yet), 1 with an unknown status.");
    expect(byData(region, "kind", "QUEUED").length).toBe(1);
    expect(byData(region, "kind", "UNKNOWN").length).toBe(1);
    expect(text(byData(region, "bucketNote", "QUEUED")[0])).toContain("not live workers");
    expect(text(byData(region, "bucketNote", "UNKNOWN")[0])).toContain("never counted as live");
    expect(byData(region, "bucketNote", "LIVE").length).toBe(0);
    expect(byTag(region, "li").map(li => li.dataset.fleetRunId).sort()).toEqual(["run-0001", "run-0002", "run-0003", "run-0004"]);
    const live = byId(node, "wf-live")!;
    expect(byTag(live, "tr").map(tr => tr.dataset.runId).filter(Boolean)).toEqual(["run-0001", "run-0002"]);
  });
  // //TR: A-RUNSTATE-1 (madde 3): sunucudaki WorkRun'ın kalp atışı alanı YOKTUR (core/workos/types.ts: yalnız leaseExpiresAt). Bu test GERÇEK WorkOsStore'dan üretilmiş WorkRun şeklini kullanır; kartta ve canlı koşu tablosunda kalp atışı BİLİNMİYOR kalır, leaseExpiresAt kalp atışı diye gösterilmez.
  it("heartbeat against the REAL server WorkRun shape: the server sends none, so card, detail and Live runs row stay UNKNOWN (leaseExpiresAt is not a heartbeat)", async () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-rs1-"));
    try {
      const store = new WorkOsStore(path.join(dir, "data"));
      const prj = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
      const msn = store.createMission({tenantId: "tA", projectId: prj.projectId, title: "T", objective: "O", acceptanceCriteria: ["c1"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, msn.missionId, to, "go", "FOUNDER_LOCAL");
      const queued = store.createRun({tenantId: "tA", missionId: msn.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: "FOUNDER_LOCAL"});
      const leased = store.acquireRunLease(queued.runId, 60_000, "FOUNDER_LOCAL");
      const raw = {runs: store.listRuns({tenantId: "tA"})};
      expect(leased.status).toBe("LEASED");
      expect(Object.keys(raw.runs[0]).filter(k => /heartbeat/i.test(k))).toEqual([]);
      expect(typeof raw.runs[0].leaseExpiresAt).toBe("string");
      const work = await load("work-core.js"), core = await load("fleet-core.js");
      const items = work.mapWorkRuns(raw).items;
      expect(items.length).toBe(1);
      const g = core.fleetGroups(items);
      expect(g.groups.map((x: any) => [x.status, x.bucket])).toEqual([["LEASED", "LIVE"]]);
      expect(g.groups[0].items[0].heartbeatAt).toBeNull();
      expect(core.fleetCard(g.groups[0].items[0]).updatedAt).toBeNull();
      expect(core.fleetDetail(items, leased.runId).updatedAt).toBeNull();
      const {node} = await fleetCtx("ok", raw.runs);
      const region = fleetNode(node);
      expect(byTag(region, "time").length).toBe(0);
      expect(byTag(region, "dd").map(text)).toEqual(["UNKNOWN", "UNKNOWN"]);
      const row = byTag(byId(node, "wf-live")!, "tr").find(tr => tr.dataset.runId === leased.runId)!;
      expect(byTag(row, "time").length).toBe(0);
      expect(text(row)).not.toContain(leased.leaseExpiresAt as string);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });
  // ---- #273 round-1 repair (COORD ledger d540bc9) ----
  const mkRealRuns = () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-rs1-"));
    const store = new WorkOsStore(path.join(dir, "data"));
    const prj = store.createProject({tenantId: "tA", orgId: "o1", name: "P", environmentId: "dev", createdBy: "FOUNDER_LOCAL"});
    const msn = store.createMission({tenantId: "tA", projectId: prj.projectId, title: "T", objective: "O", acceptanceCriteria: ["c1"], riskLevel: "R1", createdBy: "FOUNDER_LOCAL"});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission({tenantId: "tA"}, msn.missionId, to, "go", "FOUNDER_LOCAL");
    const queued = store.createRun({tenantId: "tA", missionId: msn.missionId, executor: {implementer: "a", reviewer: "b"}, createdBy: "FOUNDER_LOCAL"});
    const leased = store.acquireRunLease(queued.runId, 60_000, "FOUNDER_LOCAL");
    return {runs: store.listRuns({tenantId: "tA"}), leased, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
  };
  const pillTexts = (n: N) => byTag(n, "li").map(li => [li.dataset.fleetRunId, li.dataset.bucket, text(all(li).find(x => x.className.split(" ").includes("pill"))!)]);

  it("M1/M6 heartbeat: the REAL-shape Live-runs row and the opened detail panel show UNKNOWN, never the lease expiry or the start time under 'Last heartbeat' (en and tr)", async () => {
    const real = mkRealRuns();
    try {
      const lease = real.leased.leaseExpiresAt as string, created = real.leased.createdAt as string;
      expect(typeof lease).toBe("string"); expect(typeof created).toBe("string");
      const work = await load("work-core.js");
      for (const lang of ["en", "tr"] as const) {
        const fmtLease = work.formatDateTime(lease, lang), fmtCreated = work.formatDateTime(created, lang);
        expect(fmtLease).not.toBe("—");
        const {node, ctx, view} = await fleetCtx("ok", real.runs, lang);
        const row = byTag(byId(node, "wf-live")!, "tr").find(tr => tr.dataset.runId === real.leased.runId)!;
        const cells = byTag(row, "td").map(text);
        expect(cells[3], lang).toBe("—");
        expect(text(row), lang).not.toContain(fmtLease);
        expect(text(row), lang).not.toContain(fmtCreated);
        byId(node, `wf-fleet-detail-${real.leased.runId}`)!.fire("click");
        const open = (await view.render(ctx, ROUTE)) as N;
        const panel = byData(open, "fleetDetailFor");
        expect(panel.length, lang).toBe(1);
        const dds = byTag(panel[0], "dd").map(text);
        expect(dds[3], lang).toBe(lang === "en" ? "UNKNOWN" : "BİLİNMİYOR");
        expect(text(panel[0]), lang).not.toContain(fmtLease);
        expect(text(panel[0]), lang).not.toContain(fmtCreated);
        expect(text(fleetNode(open)), lang).not.toContain(fmtLease);
      }
    } finally { real.cleanup(); }
  });

  it("M2: the fleet region label and lead name all three buckets (en and tr, exact text)", async () => {
    const en = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "QUEUED")]);
    const regionEn = all(fleetNode(en.node)).find(n => n.attrs.get("role") === "region")!;
    expect(regionEn.attrs.get("aria-label")).toBe("Worker runs by bucket: live, queued (not running yet) and unknown status");
    expect(text(byTag(regionEn, "p")[0])).toBe("One card per live, queued or unknown-status work run. Only runs in a server worker-active status count as live; queued runs are not running yet and unknown-status runs are never counted as live. A role or heartbeat missing from the data stays UNKNOWN; the role catalog is not live agents.");
    const tr = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "QUEUED")], "tr");
    const regionTr = all(fleetNode(tr.node)).find(n => n.attrs.get("role") === "region")!;
    expect(regionTr.attrs.get("aria-label")).toBe("Kovaya göre işçi koşuları: canlı, kuyrukta (henüz çalışmıyor) ve durumu bilinmeyen");
    expect(text(byTag(regionTr, "p")[0])).toBe("Her canlı, kuyruktaki veya durumu bilinmeyen iş koşusu için bir kart. Yalnız sunucunun işçi-aktif durumundaki koşular canlı sayılır; kuyruktakiler henüz çalışmıyor, durumu bilinmeyenler asla canlı sayılmaz. Veride olmayan rol veya kalp atışı BİLİNMİYOR kalır; rol kataloğu canlı ajan değildir.");
  });

  it("M3: a run list cut at the 500 cap (the server lists the oldest first) never yields definite counts or 'none': 502 runs with the live/queued ones dropped", async () => {
    const work = await load("work-core.js");
    expect(work.WORK_RUNS_CAP).toBe(500);
    const cut = [...Array.from({length: 500}, (_, i) => run(i, "SUCCEEDED")), run(900, "RUNNING"), run(901, "QUEUED")];
    const m = work.mapWorkRuns({workRuns: cut});
    expect(m.truncated).toBe(true);
    expect(m.items.length).toBe(500);
    expect(m.items.some((r: any) => r.status === "RUNNING")).toBe(false);
    const exact = work.mapWorkRuns({workRuns: cut.slice(0, 500)});
    expect(exact.truncated).toBeUndefined();
    expect(Object.keys(exact)).toEqual(["state", "items"]);
    const {node} = await fleetCtx("ok", cut);
    const fleet = fleetNode(node), live = byId(node, "wf-live")!;
    expect(byData(fleet, "listTruncated", "1").length).toBe(1);
    expect(byData(live, "listTruncated", "1").length).toBe(1);
    expect(text(fleet)).not.toContain("There are no live work runs");
    expect(text(live)).not.toContain("There are no live runs right now");
    expect(byData(fleet, "fleetSummary").length).toBe(0);
    expect(text(byData(fleet, "listTruncated", "1")[0])).toBe("Only the first 500 runs were read, so newer live or queued runs may be missing. Counts and \"none\" cannot be stated here; treat them as UNKNOWN.");
    // visible live runs are still listed, but the summary line is replaced by the cut note
    const some = await fleetCtx("ok", [...Array.from({length: 499}, (_, i) => run(i, "SUCCEEDED")), run(900, "RUNNING"), run(901, "SUCCEEDED")]);
    expect(byData(fleetNode(some.node), "listTruncated", "1").length).toBe(1);
    expect(byData(fleetNode(some.node), "fleetSummary").length).toBe(0);
    expect(byTag(fleetNode(some.node), "li").map(li => li.dataset.fleetRunId)).toEqual(["run-0900"]);
    expect(byData(byId(some.node, "wf-live")!, "listTruncated", "1").length).toBe(1);
    expect(byTag(byId(some.node, "wf-live")!, "tr").map(tr => tr.dataset.runId).filter(Boolean)).toEqual(["run-0900"]);
    const fine = await fleetCtx("ok", [run(1, "SUCCEEDED")]);
    expect(byData(fine.node, "listTruncated").length).toBe(0);
    expect(text(fleetNode(fine.node))).toContain("There are no live work runs");
    const tr = await fleetCtx("ok", cut, "tr");
    expect(text(byData(fleetNode(tr.node), "listTruncated", "1")[0])).toBe("Yalnız ilk 500 koşu okundu, bu yüzden daha yeni canlı veya kuyruktaki koşular eksik olabilir. Sayılar ve \"yok\" burada söylenemez; BİLİNMİYOR sayın.");
  });

  it("M5: liveRuns/queuedRuns are checked against EVERY server RunStatus (only ACTIVE_WORKER_STATUSES are live, only QUEUED is queued)", async () => {
    const work = await load("work-core.js");
    const runs = [...SERVER_RUN_STATUSES, "STARTING", "REVIEWING", "COMPLETED", "—"].map((s, i) => ({runId: `run_${i}_000000`, status: s}));
    expect(work.liveRuns(runs).map((r: any) => r.status).sort()).toEqual([...ACTIVE_WORKER_STATUSES].sort());
    expect(work.queuedRuns(runs).map((r: any) => r.status)).toEqual(["QUEUED"]);
    for (const st of SERVER_RUN_STATUSES) {
      const one = [{runId: "run_x_000000", status: st}];
      expect(work.liveRuns(one).length, `live ${st}`).toBe((ACTIVE_WORKER_STATUSES as readonly string[]).includes(st) ? 1 : 0);
      expect(work.queuedRuns(one).length, `queued ${st}`).toBe(st === "QUEUED" ? 1 : 0);
    }
    for (const st of ["RECOVERING", "CREATED", "HANDOFF_PENDING", "RETRY_SCHEDULED", "DEGRADED", "CANCELLING", "AWAITING_APPROVAL"]) {
      expect(work.liveRuns([{status: st}]), st).toEqual([]);
      expect(work.queuedRuns([{status: st}]), st).toEqual([]);
    }
  });

  it("M7: a fleet holding only QUEUED, only UNKNOWN or a mix renders its buckets and summary and never the 'no live runs' note", async () => {
    const q = await fleetCtx("ok", [run(1, "QUEUED"), run(2, "QUEUED")]);
    const fq = fleetNode(q.node);
    expect(byTag(fq, "h3").map(text)).toEqual(["Queued, not running yet (2)"]);
    expect(text(byData(fq, "fleetSummary", "1")[0])).toBe("0 live, 2 queued (not running yet), 0 with an unknown status.");
    expect(text(fq)).not.toContain("There are no live work runs");
    expect(byTag(fq, "li").length).toBe(2);
    const u = await fleetCtx("ok", [run(1, "STARTING")]);
    const fu = fleetNode(u.node);
    expect(byTag(fu, "h3").map(text)).toEqual(["Unknown status (1)"]);
    expect(text(byData(fu, "fleetSummary", "1")[0])).toBe("0 live, 0 queued (not running yet), 1 with an unknown status.");
    expect(text(fu)).not.toContain("There are no live work runs");
    const mix = await fleetCtx("ok", [run(1, "STARTING"), run(2, "QUEUED"), run(3, "REVIEWING")]);
    const fm = fleetNode(mix.node);
    expect(byTag(fm, "h3").map(text)).toEqual(["Queued, not running yet (1)", "Unknown status (2)"]);
    expect(text(byData(fm, "fleetSummary", "1")[0])).toBe("0 live, 1 queued (not running yet), 2 with an unknown status.");
    expect(byData(fm, "fleetSummary").length).toBe(1);
    expect(text(byId(mix.node, "wf-live")!)).toContain("There are no live runs right now");
  });

  it("M8: every card carries its bucket and a pill that matches its own status (no 'Running' pill on queued or unknown cards)", async () => {
    const {node} = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "CHECKPOINTING"), run(3, "QUEUED"), run(4, "STARTING"), run(5, "FOO_BAR")]);
    expect(pillTexts(fleetNode(node))).toEqual([
      ["run-0001", "LIVE", "Running"], ["run-0002", "LIVE", "Checkpointing"], ["run-0003", "QUEUED", "Queued"], ["run-0004", "UNKNOWN", "Starting"], ["run-0005", "UNKNOWN", "FOO_BAR"]]);
    expect(byData(fleetNode(node), "kind", "LIVE").length).toBe(2);
    const unk = byData(fleetNode(node), "kind", "UNKNOWN")[0], que = byData(fleetNode(node), "kind", "QUEUED")[0];
    expect(byTag(unk, "li").map(li => li.dataset.status)).toEqual(["STARTING", "FOO_BAR"]);
    expect(byTag(que, "li").map(li => li.dataset.status)).toEqual(["QUEUED"]);
  });

  it("M9: the Turkish text of the new keys is pinned exactly (titles, notes, summary, showing note, other note, CHECKPOINTING)", async () => {
    const {node} = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "CHECKPOINTING"), run(3, "QUEUED"), run(4, "STARTING"), run(5, "RETRY_SCHEDULED")], "tr");
    const f = fleetNode(node);
    expect(byTag(f, "h3").map(text)).toEqual(["Çalışıyor (1)", "Kontrol noktası alınıyor (1)", "Kuyrukta, henüz çalışmıyor (1)", "Durum bilinmiyor (1)"]);
    expect(text(byData(f, "bucketNote", "QUEUED")[0])).toBe("Bir işçi bekliyor; bunlar canlı işçi değildir.");
    expect(text(byData(f, "bucketNote", "UNKNOWN")[0])).toBe("Durum bu sürümün tanıdığı bir durum değil; asla canlı sayılmaz.");
    expect(text(byData(f, "fleetSummary", "1")[0])).toBe("2 canlı, 1 kuyrukta (henüz çalışmıyor), 1 durumu bilinmiyor.");
    expect(text(byData(f, "fleetOther", "1")[0])).toBe("Başka durumlarda (örneğin yeniden deneme planlı, kurtarılıyor veya onay bekliyor) 1 koşu daha var; filo ızgarasında gösterilmiyor.");
    expect(pillTexts(f).map(x => x[2])).toEqual(["Çalışıyor", "Kontrol noktası alınıyor", "Kuyrukta", "Başlıyor"]);
    const many = await fleetCtx("ok", Array.from({length: 60}, (_, i) => run(i, "RUNNING")), "tr");
    expect(text(byData(fleetNode(many.node), "truncated", "1")[0])).toBe("Canlı, kuyruktaki ve durumu bilinmeyen 60 koşunun 50 tanesi gösteriliyor.");
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    expect(en["mstatus.CHECKPOINTING"]).toBe("Checkpointing");
  });

  it("LOW: known non-live, non-terminal runs (retry scheduled, recovering, awaiting approval ...) are counted in an explicit 'other' note, not silently dropped; en text pinned", async () => {
    const core = await load("fleet-core.js");
    const g = core.fleetGroups([run(1, "RUNNING"), run(2, "RETRY_SCHEDULED"), run(3, "RECOVERING"), run(4, "AWAITING_APPROVAL"), run(5, "SUCCEEDED")]);
    expect(g.other).toBe(4);
    expect(g.total).toBe(1);
    const {node} = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "RETRY_SCHEDULED"), run(3, "RECOVERING")]);
    expect(text(byData(fleetNode(node), "fleetOther", "2")[0])).toBe("2 more run(s) are in other states (for example retry scheduled, recovering or awaiting approval) and are not shown in the fleet grid.");
    const none = await fleetCtx("ok", [run(1, "RUNNING")]);
    expect(byData(fleetNode(none.node), "fleetOther").length).toBe(0);
  });

  it("LOW: data-fleet-summary appears exactly once, and fleetGroups sends non-string statuses to UNKNOWN (never live)", async () => {
    const {node} = await fleetCtx("ok", [run(1, "RUNNING"), run(2, "QUEUED")]);
    expect(byData(node, "fleetSummary").length).toBe(1);
    const core = await load("fleet-core.js");
    const sneaky = [run(1, 7 as any), run(2, {toString: () => "RUNNING"} as any), run(3, ["RUNNING"] as any), run(4, null as any), run(5, undefined as any), run(6, true as any)];
    const g = core.fleetGroups(sneaky);
    expect(g.live).toBe(0); expect(g.queued).toBe(0); expect(g.unknown).toBe(6);
    expect(g.groups.map((x: any) => [x.status, x.bucket, x.count])).toEqual([["UNKNOWN", "UNKNOWN", 6]]);
  });

  it("LOW: the control-tower LIVE_STATUSES literal copy equals the server ACTIVE_WORKER_STATUSES", async () => {
    const tower = await load("control-tower", "locales.js");
    expect([...tower.LIVE_STATUSES]).toEqual([...ACTIVE_WORKER_STATUSES]);
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

describe("UI-032 worker detail panel from the fleet grid (run-level only, UNKNOWN stays UNKNOWN)", () => {
  const run = (i: number, status: string, extra: any = {}) => ({runId: `run-${String(i).padStart(4, "0")}`, status, ...extra});
  it("fleetDetail resolves only runs the grid shows (terminal runs are absent) and always reports telemetry as null", async () => {
    const core = await load("fleet-core.js");
    const runs = [run(1, "RUNNING", {role: "ROLE.X"}), run(2, "SUCCEEDED")];
    // //TR: A-RUNSTATE-1: ayrıntı kovayı da bildirir (bucket).
    expect(core.fleetDetail(runs, "run-0001")).toEqual({runId: "run-0001", status: "RUNNING", bucket: "LIVE", role: "ROLE.X", missionId: null, updatedAt: null, telemetry: null});
    expect(core.fleetDetail(runs, "run-0002")).toBeNull();
    expect(core.fleetDetail(runs, "nope")).toBeNull();
    expect(core.fleetDetail(runs, null)).toBeNull();
    expect(core.fleetDetail(undefined, "run-0001")).toBeNull();
  });
  it("toggle opens a detail panel with UNKNOWN telemetry, keeps data-fleet-detail-for unique, and toggles closed", async () => {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new D(), store = st.createStore(null);
    const bridge = {apiGet: async (p: string) => {
      if (p === "/v1/cockpit") return COCKPIT; if (p === "/v1/agents") return AGENTS;
      if (p === "/v1/work-runs") return {workRuns: [run(1, "RUNNING", {role: "ROLE.X"}), run(2, "QUEUED")]};
      throw new Error(`${p}: HTTP 404`);
    }};
    const t = (k: string, v?: any) => i18n.translate("en", k, v);
    const ctx: any = {doc, store, api: apiMod.createApi({bridge, store}), i18n: {lang: "en", t}, t, navigate: () => {}, rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    const view = await load("views", "workforce.js"); view.resetWorkforceView();
    const before = (await view.render(ctx, ROUTE)) as N;
    expect(byData(before, "fleetDetailFor").length).toBe(0);
    const toggle = byId(before, "wf-fleet-detail-run-0001")!; expect(toggle.attrs.get("aria-expanded")).toBe("false");
    toggle.fire("click");
    const open = (await view.render(ctx, ROUTE)) as N;
    const panel = byData(open, "fleetDetailFor"); expect(panel.length).toBe(1);
    expect(panel[0].dataset.fleetDetailFor).toBe("run-0001");
    expect(text(panel[0])).toContain("No live agent telemetry");
    expect(byData(panel[0], "unknown", "1").length).toBeGreaterThanOrEqual(3);
    expect(byId(open, "wf-fleet-detail-run-0001")!.attrs.get("aria-expanded")).toBe("true");
    byId(open, "wf-fleet-detail-run-0001")!.fire("click");
    expect(byData((await view.render(ctx, ROUTE)) as N, "fleetDetailFor").length).toBe(0);
  });
  it("workforce.fleet.detail.* keys are identical in EN and TR with the same placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("workforce.fleet.detail.")).sort();
    expect(keys(tr)).toEqual(keys(en)); expect(keys(en).length).toBe(6);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys(en)) { expect(ph(tr[k]), k).toEqual(ph(en[k])); expect(tr[k]).toBeTruthy(); }
  });
  it("detail uses a feature-unique data attribute and no forbidden reuse", async () => {
    const src = fs.readFileSync(path.join(rend, "views", "workforce.js"), "utf8");
    const fn = src.slice(src.indexOf("function fleetDetailPanel"), src.indexOf("function fleetBody"));
    expect(fn).toContain("fleetDetailFor");
    expect(fn).not.toMatch(/dataset:\{(runId|fleetRunId)/);
    expect(fn).not.toMatch(/innerHTML/);
  });
});

describe("UI-133 agent identity card on role detail (UNKNOWN without evidence, never certified by default)", () => {
  const open = async (detailOver?: (p: string) => any, agents: any = AGENTS) => {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new D(), store = st.createStore(null), id = REG[0].roleId;
    const bridge = {apiGet: async (p: string) => {
      if (p === "/v1/cockpit") return COCKPIT;
      if (p === "/v1/agents") { if (agents === "404") throw new Error(`${p}: HTTP 404`); return agents; }
      if (p === "/v1/work-runs") return {workRuns: []};
      if (p.startsWith("/v1/roles/")) { const d = detailOver ? detailOver(p) : roleDetail(p.slice("/v1/roles/".length)); if (!d) throw new Error(`${p}: HTTP 404`); return d; }
      if (p.startsWith("/v1/roles")) return rolesPage(p);
      throw new Error(`${p}: HTTP 404`);
    }};
    const t = (k: string, v?: any) => i18n.translate("en", k, v);
    const ctx: any = {doc, store, api: apiMod.createApi({bridge, store}), i18n: {lang: "en", t}, t, navigate: () => {}, rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    const view = await load("views", "workforce.js"); view.resetWorkforceView();
    const first = (await view.render(ctx, ROUTE)) as N;
    byData(first, "roleBtn", id)[0].fire("click");
    return {node: (await view.render(ctx, ROUTE)) as N, id, view};
  };
  it("shows the card with UNKNOWN evidence and not-certified for a NOT_EVALUATED role", async () => {
    const {node, id, view} = await open();
    const card = byData(node, "identityCardFor", id);
    expect(card.length).toBe(1);
    expect(byData(card[0], "identityCertified", "0").length).toBe(1);
    expect(byData(card[0], "identityCertified", "1").length).toBe(0);
    expect(text(card[0])).toContain("not a live agent");
    view.resetWorkforceView();
  });
  it("a CERTIFIED proficiency without a scope and evidence trail is still not shown as certified", async () => {
    const {node, id, view} = await open(p => { const d = JSON.parse(JSON.stringify(roleDetail(p.slice("/v1/roles/".length)))); d.role.proficiencyStatus = "CERTIFIED"; d.role.certifiedScope = null; d.role.evaluationSpecs = []; return d; });
    const card = byData(node, "identityCardFor", id)[0];
    expect(byData(card, "identityCertified", "1").length).toBe(0);
    expect(byData(card, "identityEvidence", "UNKNOWN").length).toBe(1);
    expect(byData(card, "identityUnknown", "1").length).toBeGreaterThanOrEqual(1);
    view.resetWorkforceView();
  });
  it("certified shows only with CERTIFIED + scope + evidence trail from a verified read", async () => {
    const {node, id, view} = await open(p => { const d = JSON.parse(JSON.stringify(roleDetail(p.slice("/v1/roles/".length)))); d.role.proficiencyStatus = "CERTIFIED"; d.role.certifiedScope = "SCOPE.X"; d.role.evaluationSpecs = [{evaluationId: "EV.1", kind: "K", status: "PASSED"}]; return d; });
    const card = byData(node, "identityCardFor", id)[0];
    expect(byData(card, "identityCertified", "1").length).toBe(1);
    expect(byData(card, "identityEvidence", "1").length).toBe(1);
    view.resetWorkforceView();
  });
  it("CERTIFIED with a scope but only UNKNOWN/NOT_EXECUTED specs is not certified, evidence is UNKNOWN and the scope is labelled declared", async () => {
    const {node, id, view} = await open(p => { const d = JSON.parse(JSON.stringify(roleDetail(p.slice("/v1/roles/".length)))); d.role.proficiencyStatus = "CERTIFIED"; d.role.certifiedScope = "SCOPE.X"; d.role.evaluationSpecs = [{evaluationId: "EV.1", kind: "K", status: "UNKNOWN"}, {evaluationId: "EV.2", kind: "K", status: "NOT_EXECUTED"}]; return d; });
    const card = byData(node, "identityCardFor", id)[0];
    expect(byData(card, "identityCertified", "1").length).toBe(0);
    expect(byData(card, "identityEvidence", "UNKNOWN").length).toBe(1);
    expect(byData(card, "identityScope", "declared").length).toBe(1);
    expect(byData(card, "identityScope", "verified").length).toBe(0);
    expect(text(card)).toContain("Declared scope (unverified)");
    view.resetWorkforceView();
  });
  it("a certified role shows the scope as verified with a passing-of-total evidence count", async () => {
    const {node, id, view} = await open(p => { const d = JSON.parse(JSON.stringify(roleDetail(p.slice("/v1/roles/".length)))); d.role.proficiencyStatus = "CERTIFIED"; d.role.certifiedScope = "SCOPE.X"; d.role.evaluationSpecs = [{evaluationId: "EV.1", kind: "K", status: "PASSED"}, {evaluationId: "EV.2", kind: "K", status: "UNKNOWN"}]; return d; });
    const card = byData(node, "identityCardFor", id)[0];
    expect(byData(card, "identityScope", "verified").length).toBe(1);
    expect(text(card)).toContain("1 of 2 evaluation spec(s) passed");
    view.resetWorkforceView();
  });
  it("a failed /v1/agents read shows registry as UNKNOWN, never a count", async () => {
    const {node, id, view} = await open(undefined, "404");
    const card = byData(node, "identityCardFor", id)[0];
    expect(text(card)).not.toContain("registered roles");
    view.resetWorkforceView();
  });
  it("workforce.idcard.* keys are identical in EN and TR with the same placeholders and feature-unique data attributes", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("workforce.idcard.")).sort();
    expect(keys(tr)).toEqual(keys(en)); expect(keys(en).length).toBe(17);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys(en)) { expect(ph(tr[k]), k).toEqual(ph(en[k])); expect(tr[k]).toBeTruthy(); }
    const src = fs.readFileSync(path.join(rend, "views", "workforce.js"), "utf8");
    const fn = src.slice(src.indexOf("function identityCard"), src.indexOf("// //TR: Rol tanımı ayrıntısı"));
    expect(fn).not.toMatch(/innerHTML|dataset:\{(runId|fleetRunId)/);
  });
});

// //TR: UI-028 rol kataloğu sayfalama: 150'den fazla süzülmüş rolde önceki/sonraki sayfa denetimi ve gerçek diziden "A–B / M" aralık notu; sayfa indeksi yalnız modül belleğinde, süzgeç/yedek/sıfırlamada 0'a döner, kısaltılmış katalogda kırpılır; yeni API yolu/yazma yok; yalnız DOĞRULANMIŞ okumada görünür; odak yeniden çizimden sonra [basılan, kardeş] sırasıyla yerleşir; TR/EN eşit.
describe("UI-028 role catalogue paging (renderer-only, honest ranges)", () => {
  const ids = (n: N) => byData(n, "roleBtn").map(b => b.dataset.roleBtn);
  const REG_IDS = REG.map(r => r.roleId);
  // Focus-capable adapter (test-local): activeElement, contains, querySelectorAll, disabled from the attribute.
  class FN extends N {
    get disabled() { return this.attrs.has("disabled"); }
    get isConnected() { return true; }
    // a detached (replaced) subtree is not contained: every ancestor link must still list the child
    contains(n: N | null): boolean { for (let x: N | null = n; x; x = x.parent) { if (x === this) return true; if (!x.parent?.children.includes(x)) return false; } return false; }
    querySelectorAll(_s: string): N[] { return all(this).filter(n => n.id !== "" || "focusKey" in n.dataset); }
    focus() { if (!this.disabled) this.doc.focused = this; }
  }
  class FD extends D {
    get activeElement(): N { return this.focused ?? this.body; }
    createElement(t: string) { return new FN(this, t); }
    createTextNode(s: string) { const n = new FN(this, "#text"); n._text = s; return n; }
  }
  const mk = async (rolesFn?: (p: string) => any, lang = "en", docCls: new () => D = D) => {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    const doc = new docCls(), store = st.createStore(null), calls: string[] = [];
    const bridge = {apiGet: async (p: string) => {
      calls.push(p);
      if (p.startsWith("/v1/roles/")) { const d = roleDetail(p.slice("/v1/roles/".length)); if (!d) throw new Error(`${p}: HTTP 404`); return d; }
      if (p.startsWith("/v1/roles")) { if (rolesFn) { const v = rolesFn(p); if (v === "404") throw new Error(`${p}: HTTP 404`); if (v === "off") throw new Error("fetch failed"); return v; } return rolesPage(p); }
      if (p === "/v1/cockpit") return COCKPIT;
      if (p === "/v1/agents") return AGENTS;
      if (p === "/v1/work-runs") return {workRuns: []};
      throw new Error(`${p}: HTTP 404`);
    }};
    const api = apiMod.createApi({bridge, store}), t = (k: string, v?: any) => i18n.translate(lang, k, v);
    const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate: () => {}, rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
    return {ctx, doc, calls};
  };
  const view = async () => load("views", "workforce.js");
  const synth = (n: number, cluster: string, start = 1000) => Array.from({length: n}, (_, i) => ({roleId: `UASCO-${start + i}`, title: `Synth ${start + i}`, guildId: "G01", clusterId: cluster, priority: "P1", runtimeStatus: "UNKNOWN", proficiencyStatus: "NOT_EVALUATED"}));
  const synthPage = (items: any[]) => (p: string) => { const u = new URL("http://x" + p), cur = u.searchParams.get("cursor"), lim = Number(u.searchParams.get("limit")); const after = cur ? items.filter(r => r.roleId > cur) : items, pg = after.slice(0, lim); return {total: items.length, items: pg, nextCursor: after.length > lim ? pg[pg.length - 1].roleId : null}; };
  const click = (n: N, id: string) => byId(n, id)!.fire("click");

  it("unfiltered 599-role catalogue: exactly one labelled pager, pages 1-4 in registry order with real ranges, no truncated note", async () => {
    const v = await view(); v.resetWorkforceView();
    const {ctx} = await mk();
    let node = (await v.render(ctx, ROUTE)) as N;
    const pagers = byData(node, "catPager");
    expect(pagers.length).toBe(1);
    expect(pagers[0].getAttribute("role")).toBe("group");
    expect(pagers[0].getAttribute("aria-label")).toBe(ctx.t("workforce.cat.page.label"));
    expect(pagers[0].className).toBe("btn-row");
    for (const id of ["wf-cat-prev", "wf-cat-next"]) { const b = byId(node, id)!; expect(b.getAttribute("type")).toBe("button"); expect(b.className).toBe("btn btn-small"); }
    expect(byId(node, "wf-cat-prev")!.getAttribute("aria-label")).toBe(ctx.t("workforce.cat.page.prevLabel"));
    expect(byId(node, "wf-cat-next")!.getAttribute("aria-label")).toBe(ctx.t("workforce.cat.page.nextLabel"));
    const browse = byId(node, "wf-browse")!;
    expect(byData(browse, "results").length).toBe(0);
    expect(byData(browse, "truncated").length).toBe(0);
    expect(ids(node)[0]).toBe(REG_IDS[0]);
    expect(byData(node, "catPage")[0].dataset.catPage).toBe("1");
    expect(byId(node, "wf-cat-prev")!.attrs.has("disabled")).toBe(true);
    const want = [[150, 300], [300, 450], [450, 599]];
    for (let i = 0; i < 3; i++) {
      click(node, "wf-cat-next");
      node = (await v.render(ctx, ROUTE)) as N;
      const got = ids(node);
      expect(got[0]).toBe(REG_IDS[want[i][0]]);
      expect(got[got.length - 1]).toBe(REG_IDS[want[i][1] - 1]);
      const note = byData(node, "catPage");
      expect(note.length).toBe(1);
      expect(note[0].dataset.catPage).toBe(String(i + 2));
      expect(text(note[0])).toBe(ctx.t("workforce.cat.page.range", {from: String(want[i][0] + 1), to: String(want[i][1]), total: "599"}));
      expect(byData(byId(node, "wf-browse")!, "truncated").length).toBe(0);
    }
    expect(byId(node, "wf-cat-next")!.attrs.has("disabled")).toBe(true);
    expect(byId(node, "wf-cat-prev")!.attrs.has("disabled")).toBe(false);
    click(node, "wf-cat-prev");
    node = (await v.render(ctx, ROUTE)) as N;
    expect(ids(node)[0]).toBe(REG_IDS[300]);
    v.resetWorkforceView();
  });

  it("150 roles or fewer (single cluster): no pager, no range note, the existing results note is unchanged", async () => {
    const v = await view(); v.resetWorkforceView();
    const {ctx} = await mk();
    const cl = REG[0].clusterId, n = REG.filter(r => r.clusterId === cl).length;
    expect(n).toBeLessThanOrEqual(150);
    let node = (await v.render(ctx, ROUTE)) as N;
    const sel = byId(node, "wf-f-cluster")!; sel.value = cl; sel.fire("change");
    node = (await v.render(ctx, ROUTE)) as N;
    expect(byData(node, "catPager").length).toBe(0);
    expect(byData(node, "catPage").length).toBe(0);
    expect(text(byData(node, "results")[0])).toBe(ctx.t("workforce.cat.filter.results", {shown: String(n), total: String(n)}));
    v.resetWorkforceView();
  });

  it("page index resets on every filter handler, resetWorkforceView and the cluster fallback; the clamp never shows an empty page; roleId is kept", async () => {
    const v = await view(); v.resetWorkforceView();
    const A = synth(200, "CL07");
    const a = await mk(synthPage(A));
    let node = (await v.render(a.ctx, ROUTE)) as N;
    click(node, "wf-cat-next"); node = (await v.render(a.ctx, ROUTE)) as N;
    expect(text(byData(node, "catPage")[0])).toBe(a.ctx.t("workforce.cat.page.range", {from: "151", to: "200", total: "200"}));
    // clamp: same module state, catalogue shrank to 160 → still a valid last page, never empty
    const small = await mk(synthPage(synth(160, "CL07")));
    node = (await v.render(small.ctx, ROUTE)) as N;
    expect(text(byData(node, "catPage")[0])).toBe(small.ctx.t("workforce.cat.page.range", {from: "151", to: "160", total: "160"}));
    expect(ids(node).length).toBe(10);
    // select a role, page, selection is kept
    click(node, "wf-cat-prev"); node = (await v.render(small.ctx, ROUTE)) as N;
    byData(node, "roleBtn")[0].fire("click"); node = (await v.render(small.ctx, ROUTE)) as N;
    const picked = byId(node, "wf-detail-h")?.dataset.roleId ?? byData(node, "roleId").find(x => x.id === "wf-detail-h")?.dataset.roleId;
    click(node, "wf-cat-next"); node = (await v.render(small.ctx, ROUTE)) as N;
    expect(byId(node, "wf-detail-h")?.dataset.roleId).toBe(picked);
    v.resetWorkforceView();
    // fallback: filter to CL07 on page 2, then a catalogue that lacks CL07 but still has >150 roles must be on page 1 at its first role
    node = (await v.render(a.ctx, ROUTE)) as N;
    const cs = byId(node, "wf-f-cluster")!; cs.value = "CL07"; cs.fire("change");
    node = (await v.render(a.ctx, ROUTE)) as N;
    click(node, "wf-cat-next"); node = (await v.render(a.ctx, ROUTE)) as N;
    expect(byData(node, "catPage")[0].dataset.catPage).toBe("2");
    const B = synth(170, "CL08", 2000);
    const b = await mk(synthPage(B));
    node = (await v.render(b.ctx, ROUTE)) as N;
    expect(byData(node, "catPage")[0].dataset.catPage).toBe("1");
    expect(ids(node)[0]).toBe("UASCO-2000");
    // each filter handler and Clear reset to page 1
    for (const act of [
      (n: N) => { const s = byId(n, "wf-q")!; s.value = "Synth"; s.fire("change"); },
      (n: N) => { const s = byId(n, "wf-f-cluster")!; s.value = "ALL"; s.fire("change"); },
      (n: N) => { const s = byId(n, "wf-f-guild")!; s.value = "ALL"; s.fire("change"); },
      (n: N) => { n && byId(n, "wf-f-clear")?.fire("click"); },
    ]) {
      node = (await v.render(b.ctx, ROUTE)) as N;
      if (byData(node, "catPage")[0].dataset.catPage !== "2") { click(node, "wf-cat-next"); node = (await v.render(b.ctx, ROUTE)) as N; }
      expect(byData(node, "catPage")[0].dataset.catPage).toBe("2");
      act(node);
      node = (await v.render(b.ctx, ROUTE)) as N;
      expect(byData(node, "catPage")[0].dataset.catPage).toBe("1");
    }
    click(node, "wf-cat-next"); node = (await v.render(b.ctx, ROUTE)) as N;
    v.resetWorkforceView();
    node = (await v.render(b.ctx, ROUTE)) as N;
    expect(byData(node, "catPage")[0].dataset.catPage).toBe("1");
    v.resetWorkforceView();
  });

  it("paging adds no API route or query key; the click handler calls no ctx.api method; source uses only the allowed api methods", async () => {
    const v = await view(); v.resetWorkforceView();
    const {ctx, calls} = await mk();
    let node = (await v.render(ctx, ROUTE)) as N;
    const before = calls.length;
    click(node, "wf-cat-next");
    expect(calls.length).toBe(before);
    node = (await v.render(ctx, ROUTE)) as N;
    byData(node, "roleBtn")[0].fire("click");
    node = (await v.render(ctx, ROUTE)) as N;
    click(node, "wf-cat-next"); node = (await v.render(ctx, ROUTE)) as N;
    const okPath = /^(\/v1\/cockpit|\/v1\/agents|\/v1\/work-runs|\/v1\/roles\?limit=100|\/v1\/roles\?limit=100&cursor=UASCO-\d{4}|\/v1\/roles\/UASCO-\d{4}|\/v1\/roles\/status-summary)$/;
    for (const p of calls) { expect(p, p).toMatch(okPath); expect(p).not.toMatch(/page|offset/i); }
    const src = fs.readFileSync(path.join(rend, "views", "workforce.js"), "utf8");
    expect([...new Set([...src.matchAll(/ctx\.api\.(\w+)/g)].map(m => m[1]))].sort()).toEqual(["agentCount", "cockpit", "roleCatalog", "roleDetail", "rolesReadiness", "rolesStatusSummary", "workRuns"]); // rolesReadiness reads the same /v1/roles/status-summary path (cached, no new route)
    expect(src).not.toMatch(/apiPost|window\.uasco|localStorage|sessionStorage|Math\.random|innerHTML/);
    expect(src).not.toContain("workforce.cat.filter.more");
    v.resetWorkforceView();
  });

  it("each pager click sets the page, awaits rerender, then settles focus with [pressed, sibling]; Next onto the last page leaves focus on the enabled Previous", async () => {
    const v = await view(); v.resetWorkforceView();
    const {ctx, doc: d0} = await mk(undefined, "en", FD), doc = d0 as FD;
    const container = doc.createElement("main"); doc.body.append(container);
    const events: string[] = [], keysSeen: string[][] = [];
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let node = (await v.render(ctx, ROUTE)) as N;
    const mount = async () => { node = (await v.render(ctx, ROUTE)) as N; container.replaceChildren(node); };
    ctx.rerender = async () => { events.push("rerender-start"); await gate; await mount(); events.push("rerender-done"); };
    ctx.settleFocus = ({keys}: {keys: string[]}) => { events.push("settle"); keysSeen.push(keys); return (settle as any)(doc, container, {keys}); };
    const {settleFocus: settle} = await load("focus.js");
    await mount();
    const p1 = byId(node, "wf-cat-next")!; p1.fire("click");
    expect(events).toEqual(["rerender-start"]);
    release(); await new Promise(r => setTimeout(r, 0));
    expect(events).toEqual(["rerender-start", "rerender-done", "settle"]);
    expect(keysSeen[0]).toEqual(["id:wf-cat-next", "id:wf-cat-prev"]);
    // go to page 3 then press Next onto page 4 (last): Next becomes disabled, focus must land on Previous
    ctx.rerender = async () => { await mount(); };
    for (let i = 0; i < 2; i++) { byId(node, "wf-cat-next")!.fire("click"); await new Promise(r => setTimeout(r, 0)); }
    expect(byId(node, "wf-cat-next")!.attrs.has("disabled")).toBe(true);
    expect(doc.activeElement.id).toBe("wf-cat-prev");
    byId(node, "wf-cat-prev")!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(keysSeen[keysSeen.length - 1]).toEqual(["id:wf-cat-prev", "id:wf-cat-next"]);
    v.resetWorkforceView();
  });

  it("honest state: no pager or range for a 404, offline, malformed or partial catalogue, or a no-match search; no NaN/undefined in any range", async () => {
    const v = await view();
    for (const roles of ["404", "off", {items: "x", total: 3}, {total: 600, items: [], nextCursor: null}] as any[]) {
      v.resetWorkforceView();
      const {ctx} = await mk(() => roles);
      const node = (await v.render(ctx, ROUTE)) as N;
      expect(byId(node, "wf-browse")).toBeNull();
      expect(byData(node, "catPager").length).toBe(0);
      expect(byData(node, "catPage").length).toBe(0);
    }
    v.resetWorkforceView();
    const {ctx} = await mk();
    let node = (await v.render(ctx, ROUTE)) as N;
    const q = byId(node, "wf-q")!; q.value = "zzzz-no-such-role"; q.fire("change");
    node = (await v.render(ctx, ROUTE)) as N;
    expect(byData(node, "catPager").length).toBe(0);
    expect(text(byId(node, "wf-browse")!)).toContain(ctx.t("workforce.cat.filter.none"));
    v.resetWorkforceView();
    node = (await v.render(ctx, ROUTE)) as N;
    expect(text(byData(node, "catPage")[0])).not.toMatch(/NaN|undefined/);
    v.resetWorkforceView();
  });

  it("default render has no duplicate ids (pager included) and uses only feature-unique data attributes", async () => {
    const v = await view(); v.resetWorkforceView();
    const {ctx} = await mk();
    const node = (await v.render(ctx, ROUTE)) as N;
    const idl = all(node).map(n => n.id).filter(Boolean);
    expect(new Set(idl).size).toBe(idl.length);
    for (const el of [...byData(node, "catPager"), ...byData(node, "catPage")]) { expect("truncated" in el.dataset || "results" in el.dataset || "runId" in el.dataset).toBe(false); }
    v.resetWorkforceView();
  });

  it("locales: new keys are EN/TR-identical in placeholders, TR differs from EN, labels contain the visible text, filter.more is removed", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const keys = ["label", "prev", "next", "prevLabel", "nextLabel", "range"].map(k => `workforce.cat.page.${k}`);
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const k of keys) { expect(en[k], k).toBeTruthy(); expect(tr[k], k).toBeTruthy(); expect(tr[k]).not.toBe(en[k]); expect(ph(tr[k])).toEqual(ph(en[k])); }
    expect(ph(en["workforce.cat.page.range"])).toEqual(["from", "to", "total"]);
    for (const d of [en, tr]) {
      expect(d["workforce.cat.page.prevLabel"]).toContain(d["workforce.cat.page.prev"]);
      expect(d["workforce.cat.page.nextLabel"]).toContain(d["workforce.cat.page.next"]);
      expect("workforce.cat.filter.more" in d).toBe(false);
    }
  });
});

// //TR: LANE-A Ajan Fabrikası durumu (GET /v1/roles/status-summary): beş sayaç AYRI gösterilir, sıkı eşleme, okunamayan durumda sayı uydurulmaz.
describe("LANE-A Agent Factory status panel", () => {
  const SHA = "ab".repeat(32);
  const guild = (id: string, over: Record<string, any> = {}) => ({guildId: id, registered: 10, implemented: 4, tested: 3, certified: 1, running: 0, ...over});
  const sum = (over: Record<string, any> = {}, extra: Record<string, any> = {}) => ({statusSummary: {target: 599, registered: 599, implemented: 40, tested: 12, certified: 3, running: 0, byGuild: [guild("zeta"), guild("alpha", {registered: 7})], computedAt: "2026-10-22T03:00:00Z", basis: {roleDefinitionsSha256: SHA, bindingsCount: 25}, ...over}, ...extra});
  const render = async (res: any, lang = "en") => { const {ctx} = await mkCtx({roles: "ok", detail: true}, lang); ctx.api.rolesStatusSummary = async () => res; return (await renderWf(ctx)).node; };

  it("maps the real shape; the five counters stay separate and by-guild rows are sorted by guild id", async () => {
    const c = await load("agent-factory-core.js");
    expect(c.STATUS_SUMMARY_PATH).toBe("/v1/roles/status-summary");
    expect(c.FACTORY_COUNTERS).toEqual(["registered", "implemented", "tested", "certified", "running"]);
    const r = c.mapStatusSummary(sum());
    expect(r.state).toBe("VERIFIED");
    expect(r.summary).toMatchObject({target: 599, registered: 599, implemented: 40, tested: 12, certified: 3, running: 0, computedAt: "2026-10-22T03:00:00Z", basis: {roleDefinitionsSha256: SHA, bindingsCount: 25}});
    expect(r.summary.byGuild.map((g: any) => g.guildId)).toEqual(["alpha", "zeta"]);
    expect(r.summary.byGuild[0].registered).toBe(7);
    expect(Object.keys(r.summary).sort()).toEqual(["basis", "byGuild", "certified", "computedAt", "implemented", "registered", "running", "target", "tested"]);
  });
  it("any missing or wrongly typed field makes the whole read ERROR (no coercion)", async () => {
    const c = await load("agent-factory-core.js");
    const bads: any[] = [null, [], {}, {statusSummary: null}, {statusSummary: []}, sum({target: 0}), sum({target: "599"}), sum({target: 1.5}), sum({target: c.MAX_COUNT + 1}), sum({byGuild: "x"}), sum({byGuild: null}),
      sum({computedAt: "yesterday"}), sum({computedAt: 5}), sum({computedAt: undefined}), sum({basis: null}), sum({basis: {roleDefinitionsSha256: SHA}}), sum({basis: {bindingsCount: 1}}),
      sum({basis: {roleDefinitionsSha256: "AB".repeat(32), bindingsCount: 1}}), sum({basis: {roleDefinitionsSha256: "ab".repeat(31), bindingsCount: 1}}), sum({basis: {roleDefinitionsSha256: [SHA], bindingsCount: 1}}),
      sum({basis: {roleDefinitionsSha256: SHA, bindingsCount: -1}}), sum({basis: {roleDefinitionsSha256: SHA, bindingsCount: "1"}}), sum({basis: {roleDefinitionsSha256: SHA, bindingsCount: c.MAX_COUNT + 1}}),
      sum({byGuild: [guild("a"), guild("a")]}), sum({byGuild: [guild("")]}), sum({byGuild: [guild("-x")]}), sum({byGuild: [guild(["alpha"] as any)]}), sum({byGuild: [null]}), sum({byGuild: [guild("a", {running: undefined})]})];
    for (const k of c.FACTORY_COUNTERS) { bads.push(sum({[k]: undefined}), sum({[k]: -1}), sum({[k]: 1.5}), sum({[k]: "5"}), sum({[k]: null}), sum({[k]: c.MAX_COUNT + 1}), sum({byGuild: [guild("a", {[k]: "5"})]}), sum({byGuild: [guild("a", {[k]: -1})]})); }
    bads.forEach((b, i) => { const r = c.mapStatusSummary(b); expect([i, r.state, r.summary]).toEqual([i, "ERROR", null]); });
  });
  it("limits are exact: counters 0..MAX_COUNT, target 1..MAX_COUNT, at most MAX_GUILDS guilds, bindings 0, computedAt with milliseconds", async () => {
    const c = await load("agent-factory-core.js");
    expect(c.mapStatusSummary(sum({registered: 0, implemented: 0, tested: 0, certified: 0, running: 0, target: 1, byGuild: [], basis: {roleDefinitionsSha256: SHA, bindingsCount: 0}})).state).toBe("VERIFIED");
    expect(c.mapStatusSummary(sum({registered: c.MAX_COUNT, target: c.MAX_COUNT})).state).toBe("VERIFIED");
    expect(c.mapStatusSummary(sum({byGuild: Array.from({length: c.MAX_GUILDS}, (_, i) => guild(`g${i}`))})).state).toBe("VERIFIED");
    expect(c.mapStatusSummary(sum({byGuild: Array.from({length: c.MAX_GUILDS + 1}, (_, i) => guild(`g${i}`))})).state).toBe("ERROR");
    expect(c.mapStatusSummary(sum({basis: {roleDefinitionsSha256: SHA, bindingsCount: c.MAX_COUNT}})).state).toBe("VERIFIED");
    expect(c.mapStatusSummary(sum({computedAt: "2026-10-22T03:00:00.123Z"})).state).toBe("VERIFIED");
    expect(c.mapStatusSummary(sum({computedAt: "2026-10-22T03:00:00"})).state).toBe("ERROR");
    expect(c.mapStatusSummary(sum({computedAt: "2026-02-30T03:00:00Z"})).state).toBe("ERROR");
  });
  it("renders five separate counters, the target, a by-guild table and the basis; nothing is summed", async () => {
    const node = await render(await (await load("agent-factory-core.js")).mapStatusSummary(sum()));
    const stats = byData(node, "stat").filter(n => n.dataset.stat.startsWith("factory-"));
    // //TR: A1 (koordinatör kararı, FAIL-CLOSED): hazırlık okunamadığı için runningMeasured belirlenemez; "çalışan" sayacı sayı olarak gösterilmez (eski beklenti "0" idi). Diğer dört sayaç değişmedi.
    expect(stats.map(n => [n.dataset.stat, n.dataset.value])).toEqual([["factory-registered", "599"], ["factory-implemented", "40"], ["factory-tested", "12"], ["factory-certified", "3"], ["factory-running", "UNKNOWN"]]);
    expect(byData(node, "factoryTarget")[0].dataset.factoryTarget).toBe("599");
    expect(byData(node, "factoryGuild").map(n => n.dataset.factoryGuild)).toEqual(["alpha", "zeta"]);
    expect(text(byData(node, "factoryBasis")[0])).toContain("abababababab…"); expect(text(byData(node, "factoryBasis")[0])).not.toContain(SHA);
    expect(text(byData(node, "factoryBasis")[0])).toContain("25 bindings");
    expect(byData(node, "semantics", "SEPARATE_COUNTERS")).toHaveLength(1);
    expect(text(byId(node, "wf-factory")!)).toContain("never added up");
  });
  it("shows a state note and NO figures when the endpoint is missing (default 404), offline or malformed", async () => {
    const { ctx } = await mkCtx({roles: "ok", detail: true}, "en");
    const real = (await renderWf(ctx)).node;
    for (const node of [real, await render({state: "OFFLINE", summary: null}), await render({state: "ERROR", summary: null}), await render(undefined)]) {
      const p = byId(node, "wf-factory")!;
      expect(p).not.toBeNull();
      expect(byData(p, "stat").filter(n => n.dataset.stat.startsWith("factory-"))).toEqual([]);
      expect(byData(p, "factoryGuild")).toEqual([]); expect(byData(p, "factoryTarget")).toEqual([]);
      expect(text(p)).toContain("GET /v1/roles/status-summary");
    }
    expect(text(byId(real, "wf-factory")!)).toMatch(/unavailable/i);
  });
  it("an empty guild list says so; en and tr have the same factory keys with the same placeholders", async () => {
    const node = await render((await load("agent-factory-core.js")).mapStatusSummary(sum({byGuild: []})));
    expect(byData(node, "factoryTable")).toEqual([]); expect(text(byId(node, "wf-factory")!)).toContain("no guild breakdown");
    const en = (await load("locales", "en.js")).default as Record<string, string>, tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const keys = Object.keys(en).filter(k => k.startsWith("workforce.factory."));
    expect(keys).toHaveLength(14);
    const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(Object.keys(tr).filter(k => k.startsWith("workforce.factory."))).toHaveLength(14);
  });
});

// //TR: LANE-A A1 (Master V2 Wave 0): 8 katmanlı rol hazırlığı paneli. Fixture'lar GERÇEK çekirdekten (computeRoleReadiness + reconcileLegacyStatusSummary) üretilir; bozuk varyantlar elle yazılır. Hazırlık tek doğrudur: çalıştırma günlüğü yokken "çalışan" sayısı hiçbir yerde sayı olarak görünmez, ölçülemeyen katman çıplak 0 olmaz, katmanlar toplanmaz/yüzdelenmez.
describe("LANE-A A1 role readiness panel (8 layers)", () => {
  const REPO = path.resolve(__dirname, "..");
  const NOW = new Date("2026-10-26T00:00:00Z");
  const cache = new Map<string, any>();
  const fixture = (journal: "ABSENT" | "PRESENT") => {
    if (!cache.has(journal)) {
      const runs = journal === "ABSENT" ? {journal: "ABSENT" as const} : {journal: "PRESENT" as const, runs: []};
      const i = loadReadinessInputFromRepo(REPO, {runs, now: NOW}), audit = computeRoleReadiness(i);
      const legacy = computeRoleStatusSummary({roles: i.roles, guildIds: i.guilds.map(g => g.guildId), roleDefinitionsSha256: i.roleDefinitionsSha256, bindings: i.bindings, verify: i.verify, runs: journal === "PRESENT" ? [] : [], now: NOW});
      cache.set(journal, {statusSummary: legacy, statusSummaryStatus: "DEPRECATED_LEGACY_PROJECTION", readiness: audit, reconciliation: reconcileLegacyStatusSummary(legacy, audit)});
    }
    return cache.get(journal);
  };
  // the same payload without the bulky per-role / per-group arrays (the mapper never reads them), deep-copied so variants can be edited
  const slim = (journal: "ABSENT" | "PRESENT" = "ABSENT") => { const f = fixture(journal), {roles: _r, byGuild: _g, byCluster: _c, reasonCounts: _x, ...r} = f.readiness; return structuredClone({...f, readiness: r}); };
  const ERR = {state: "ERROR", readiness: null, reconciliation: null};
  const page = async (feed: Feed, lang = "en") => { const m = await mkCtx(feed, lang); const out = await renderWf(m.ctx); return {...m, node: out.node, panel: byId(out.node, "wf-readiness")!, factory: byId(out.node, "wf-factory")!}; };
  const rowOf = (panel: N, layer: string) => byData(panel, "readinessLayer", layer)[0];
  // everything a node carries: text, class, every attribute and every data-* value (so a number hidden in title / aria-* / data-* is found too)
  const everything = (n: N): string => [n, ...all(n)].map(x => [x._text, x.className, ...x.attrs.values(), ...Object.values(x.dataset)].join("\u0001")).join("\u0002");
  const hasNumber = (hay: string, n: number) => new RegExp(`(?<![0-9.,])${n}(?![0-9])`).test(hay);

  it("maps the real core output for journal ABSENT and PRESENT: eight layers in the fixed order, each count with its denominator and measured flag", async () => {
    const c = await load("agent-factory-core.js");
    expect(c.READINESS_LAYERS).toEqual(["DEFINED", "PROFILED", "KNOWLEDGE_READY", "TOOL_READY", "EXECUTABLE", "EVALUATED", "INTERNALLY_CERTIFIED", "RUNNING"]);
    const a = c.mapReadiness(fixture("ABSENT"));
    expect(a.state).toBe("VERIFIED");
    expect(a.readiness.layers.map((l: any) => l.layer)).toEqual(c.READINESS_LAYERS);
    expect(a.readiness.layers.every((l: any) => l.denominator === 599)).toBe(true);
    expect(a.readiness.layers.find((l: any) => l.layer === "RUNNING")).toEqual({layer: "RUNNING", TRUE: 0, FALSE: 0, UNKNOWN: 599, NOT_APPLICABLE: 0, denominator: 599, measured: false});
    expect(a.readiness.layers.find((l: any) => l.layer === "TOOL_READY")).toMatchObject({TRUE: 0, FALSE: 590, UNKNOWN: 9, measured: false});
    expect(a.readiness.inputs).toEqual({journal: "ABSENT", adapterReality: "NOT_SUPPLIED", reachableStages: "NOT_SUPPLIED"});
    expect(a.reconciliation).toEqual({consistent: true, mismatchCount: 0, runningMeasured: false, implementedStageWired: "UNKNOWN"});
    expect(Object.keys(a.readiness).sort()).toEqual(["anomalies", "authority", "computedAt", "denominator", "digest", "inputs", "layers", "proposedOnly", "stageWired"]);
    const p = c.mapReadiness(fixture("PRESENT"));
    expect(p.state).toBe("VERIFIED");
    expect(p.readiness.layers.find((l: any) => l.layer === "RUNNING")).toMatchObject({TRUE: 0, FALSE: 599, UNKNOWN: 0, measured: true});
    expect(p.reconciliation.runningMeasured).toBe(true);
  });

  it("any malformed or oversize payload is ERROR with no partial numbers", async () => {
    const c = await load("agent-factory-core.js");
    const edit = (f: (x: any) => void, journal: "ABSENT" | "PRESENT" = "ABSENT") => { const x = slim(journal); f(x); return x; };
    const bads: Array<[string, any]> = [["null", null], ["array", []], ["empty", {}], ["no readiness", edit(x => { delete x.readiness; })], ["no reconciliation", edit(x => { delete x.reconciliation; })],
      ["schema", edit(x => { x.readiness.schemaVersion = "2.0.0"; })], ["authority", edit(x => { x.readiness.authority = "TRUSTED"; })], ["top status", edit(x => { x.statusSummaryStatus = "AUTHORITATIVE"; })],
      ["missing layer", edit(x => { delete x.readiness.totals.RUNNING; })], ["extra layer", edit(x => { x.readiness.totals.EXTRA = structuredClone(x.readiness.totals.DEFINED); })],
      ["renamed layer", edit(x => { x.readiness.totals.RUNNIN = x.readiness.totals.RUNNING; delete x.readiness.totals.RUNNING; })],
      ["negative count", edit(x => { x.readiness.totals.DEFINED.TRUE = -1; })], ["float count", edit(x => { x.readiness.totals.DEFINED.TRUE = 1.5; })], ["string count", edit(x => { x.readiness.totals.DEFINED.TRUE = "599"; })],
      ["oversize count", edit(x => { x.readiness.totals.DEFINED.TRUE = c.MAX_COUNT + 1; })], ["oversize denominator", edit(x => { x.readiness.denominator = c.MAX_COUNT + 1; })],
      ["layer denominator differs", edit(x => { x.readiness.totals.PROFILED.denominator = 598; })], ["states do not sum to the denominator", edit(x => { x.readiness.totals.PROFILED.FALSE = 598; })],
      ["measured flipped true", edit(x => { x.readiness.totals.RUNNING.measured = true; })], ["measured flipped false", edit(x => { x.readiness.totals.DEFINED.measured = false; })], ["measured not boolean", edit(x => { x.readiness.totals.DEFINED.measured = "true"; })],
      ["no stageWired", edit(x => { delete x.readiness.stageWired; })], ["bad proposed source", edit(x => { x.readiness.proposedOnly.source = "RUNTIME"; })], ["bad proposed count", edit(x => { x.readiness.proposedOnly.profiles = -1; })],
      ["bad journal", edit(x => { x.readiness.inputs.journal = "MAYBE"; })], ["bad adapters", edit(x => { x.readiness.inputs.adapterReality = "YES"; })], ["bad digest", edit(x => { x.readiness.digest = "xyz"; })],
      ["bad computedAt", edit(x => { x.readiness.computedAt = "yesterday"; })], ["negative anomalies", edit(x => { x.readiness.anomalies = -1; })],
      ["roles oversize", edit(x => { x.readiness.roles = new Array(c.MAX_ROLES + 1).fill(0); })], ["roles not array", edit(x => { x.readiness.roles = {}; })], ["byGuild oversize", edit(x => { x.readiness.byGuild = new Array(c.MAX_GUILDS + 1).fill(0); })],
      ["reconciliation status", edit(x => { x.reconciliation.status = "OK"; })], ["reconciliation authority", edit(x => { x.reconciliation.authority = "legacy"; })], ["consistent contradicts mismatches", edit(x => { x.reconciliation.consistent = false; })],
      ["mismatches oversize", edit(x => { x.reconciliation.mismatches = new Array(c.MAX_MISMATCHES + 1).fill("a"); x.reconciliation.consistent = false; })], ["mismatch not string", edit(x => { x.reconciliation.mismatches = [1]; x.reconciliation.consistent = false; })],
      ["runningMeasured contradicts the journal", edit(x => { x.reconciliation.runningMeasured = true; })], ["implementedMeaning", edit(x => { x.reconciliation.implementedMeaning = "WIRED"; })],
      ["implementedStageWired contradicts the stages", edit(x => { x.reconciliation.implementedStageWired = 8; })],
      ["states sum ABOVE the denominator (TRUE 600 of 599)", edit(x => { x.readiness.totals.DEFINED.TRUE = 600; })],
      ["journal ABSENT but RUNNING has a TRUE", edit(x => { x.readiness.totals.RUNNING.TRUE = 1; x.readiness.totals.RUNNING.UNKNOWN = 598; })],
      ["journal ABSENT but RUNNING is measured FALSE", edit(x => { x.readiness.totals.RUNNING.FALSE = 599; x.readiness.totals.RUNNING.UNKNOWN = 0; x.readiness.totals.RUNNING.measured = true; })],
      ["stages not supplied but stageWired has a TRUE", edit(x => { x.readiness.stageWired.TRUE = 1; x.readiness.stageWired.FALSE = 590; })],
      ["proposed profiles above the denominator", edit(x => { x.readiness.proposedOnly.profiles = 600; })],
      ["proposed candidate skills above the profiles", edit(x => { x.readiness.proposedOnly.withCandidateSkills = 600; })],
      ["proposed candidate adapters above the profiles", edit(x => { x.readiness.proposedOnly.withCandidateToolAdapters = 600; })],
      ["proposed source ABSENT with profiles", edit(x => { x.readiness.proposedOnly.source = "ABSENT"; })],
      ["readinessError next to a readiness object", edit(x => { x.readinessError = "ROLE_READINESS_UNAVAILABLE"; })],
      ["readiness null with an unknown readinessError", {...slim("ABSENT"), readiness: null, reconciliation: null, readinessError: "SOMETHING_ELSE"}],
      ["readiness null without readinessError", {...slim("ABSENT"), readiness: null, reconciliation: null}],
      ["only reconciliation null", {...slim("ABSENT"), reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"}],
      ["only reconciliation null, no readinessError", {...slim("ABSENT"), reconciliation: null}],
      ["readiness null with a reconciliation object", {...slim("ABSENT"), readiness: null}],
      ["readiness null with a reconciliation object and the exact readinessError", {...slim("ABSENT"), readiness: null, readinessError: "ROLE_READINESS_UNAVAILABLE"}],
      ["readiness undefined, reconciliation null, the exact readinessError", (() => { const x: any = {...slim("ABSENT"), reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"}; delete x.readiness; return x; })()],
      ["readinessError of the wrong type", {...slim("ABSENT"), readiness: null, reconciliation: null, readinessError: 503}],
      ["journal PRESENT but RUNNING is unmeasured", edit(x => { Object.assign(x.readiness.totals.RUNNING, {TRUE: 0, FALSE: 598, UNKNOWN: 1, measured: false}); }, "PRESENT")],
      ["proposed profiles one above the denominator", edit(x => { x.readiness.proposedOnly.profiles = 600; })],
      ["proposed candidate skills one above the profiles (still below the denominator)", edit(x => { x.readiness.proposedOnly.profiles = 300; x.readiness.proposedOnly.withCandidateSkills = 301; })],
      ["proposed candidate adapters one above the profiles (still below the denominator)", edit(x => { x.readiness.proposedOnly.profiles = 300; x.readiness.proposedOnly.withCandidateToolAdapters = 301; })]];
    for (const [name, bad] of bads) expect(c.mapReadiness(bad), name).toEqual(ERR);
    expect(c.mapReadiness({...slim("ABSENT"), readiness: null, reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"})).toEqual({state: "UNAVAILABLE", readiness: null, reconciliation: null, reason: "ROLE_READINESS_UNAVAILABLE"}); // the #262 contract
    for (const [k, v] of [["withCandidateSkills", 300], ["withCandidateToolAdapters", 300]] as const) expect(c.mapReadiness(edit(x => { x.readiness.proposedOnly.profiles = 300; x.readiness.proposedOnly[k] = v; })).state, `${k} == profiles is accepted`).toBe("VERIFIED");
    expect(c.mapReadiness(edit(x => { x.readiness.proposedOnly.profiles = 599; })).state).toBe("VERIFIED"); // profiles == denominator is accepted
    expect(c.mapReadiness(fixture("ABSENT")).state).toBe("VERIFIED"); // the full audit (with roles/byGuild/byCluster) maps too; those arrays are never read
    expect(c.mapReadiness(edit(x => { x.readiness.roles = new Array(c.MAX_ROLES).fill(0); })).state).toBe("VERIFIED");
  });

  it("journal ABSENT: RUNNING says Unknown, and the legacy running number is nowhere in the DOM (not in the stat, not in the by-guild table)", async () => {
    const raw = slim("ABSENT"); raw.statusSummary.running = 4242; raw.statusSummary.byGuild[0].running = 4343;
    const {panel, factory, node, calls} = await page({roles: "ok", detail: true, statusSummary: raw});
    const running = rowOf(panel, "RUNNING");
    expect(text(running)).toContain("Unknown – no run journal");
    expect(text(running)).toContain("UNKNOWN 599 of 599");
    expect(text(running)).not.toContain("TRUE");
    expect(running.dataset.measured).toBe("false");
    const stat = byData(factory, "stat", "factory-running")[0];
    expect(stat.dataset.value).toBe("UNKNOWN");
    expect(text(stat.children[0])).toBe("Unknown – no run journal");
    expect(text(node)).not.toContain("4242");
    expect(text(node)).not.toContain("4343");
    expect(everything(node)).not.toContain("4242"); // not in any attribute or data-* value either
    expect(everything(node)).not.toContain("4343");
    for (const row of byData(factory, "factoryGuild")) expect(text(row.children[5]), row.dataset.factoryGuild).toBe("Unknown – no run journal");
    expect(calls.filter(p => p === "/v1/roles/status-summary")).toHaveLength(1); // one HTTP read serves both mappers
  });

  it("journal PRESENT: measured layers show TRUE and FALSE with the denominator, unmeasured layers show UNKNOWN next to TRUE, and the legacy implemented label says code path", async () => {
    const {panel, factory, node} = await page({roles: "ok", detail: true, statusSummary: slim("PRESENT")});
    expect(text(rowOf(panel, "DEFINED"))).toContain("TRUE 599, FALSE 0 of 599");
    expect(text(rowOf(panel, "EXECUTABLE"))).toContain("TRUE 8, FALSE 591 of 599");
    expect(text(rowOf(panel, "RUNNING"))).toContain("TRUE 0, FALSE 599 of 599");
    expect(text(rowOf(panel, "RUNNING"))).not.toContain("Unknown");
    expect(text(rowOf(panel, "TOOL_READY"))).toContain("TRUE 0, FALSE 590, UNKNOWN 9 of 599");
    expect(text(rowOf(panel, "TOOL_READY"))).toContain("not fully measured");
    expect(rowOf(panel, "TOOL_READY").dataset.measured).toBe("false");
    expect(text(rowOf(panel, "STAGE_WIRED"))).toContain("TRUE 0, FALSE 591, UNKNOWN 8 of 599");
    expect(byData(panel, "readinessLayer").map(n => n.dataset.readinessLayer)).toEqual(["DEFINED", "PROFILED", "KNOWLEDGE_READY", "TOOL_READY", "EXECUTABLE", "EVALUATED", "INTERNALLY_CERTIFIED", "RUNNING", "STAGE_WIRED"]);
    for (const n of byData(panel, "readinessLayer")) expect(text(n), n.dataset.readinessLayer).toContain("of 599");
    expect(byData(panel, "readinessDenominator")[0].dataset.readinessDenominator).toBe("599");
    expect(text(byData(panel, "readinessDenominator")[0])).toBe("Role definitions: 599");
    expect(byData(factory, "stat", "factory-running")[0].dataset.value).toBe("0"); // measured: the legacy running count is shown
    expect(text(byData(factory, "stat", "factory-implemented")[0])).toContain("Implemented: code path (includes unwired stages)");
    expect(byData(factory, "legacyProjection", "DEPRECATED_LEGACY_PROJECTION")).toHaveLength(1);
    expect(text(node)).toContain("only truth");
  });

  it("no percentage, ratio or summed total is rendered anywhere in the workforce view (text and attributes), and unmeasured layers never show a bare zero", async () => {
    for (const journal of ["ABSENT", "PRESENT"] as const) {
      const f = slim(journal), {panel, factory, node} = await page({roles: "ok", detail: true, statusSummary: f});
      const view = everything(node);
      expect(view, journal).not.toContain("%");
      for (const p of [panel, factory]) {
        expect(everything(p), journal).not.toMatch(/\b0\.\d+\b/);
        expect(everything(p), journal).not.toMatch(/\bshare\b|\bratio\b/i); // (the lead sentence says layers are never turned into percentages, so the word itself is allowed; the "%" sign is not)
      }
      const layers = Object.values(f.readiness.totals) as any[];
      const legit = new Set<number>(layers.flatMap(l => [l.TRUE, l.FALSE, l.UNKNOWN, l.NOT_APPLICABLE, l.denominator]));
      const sums = [layers.reduce((a, l) => a + l.TRUE, 0), layers.reduce((a, l) => a + l.FALSE, 0), layers.reduce((a, l) => a + l.UNKNOWN, 0), layers.reduce((a, l) => a + l.denominator, 0),
        layers.reduce((a, l) => a + l.TRUE + l.FALSE, 0)].filter(n => !legit.has(n));
      expect(sums.length, journal).toBeGreaterThan(2);
      for (const n of sums) expect(hasNumber(view, n), `${journal}: ${n}`).toBe(false);
      for (const row of byData(panel, "readinessLayer").filter(n => n.dataset.measured === "false")) expect(text(row), `${journal} ${row.dataset.readinessLayer}`).toMatch(/UNKNOWN \d+ of 599/);
    }
  });

  it("an unreadable or malformed answer shows an unavailable state and no figures (HTTP 503 included), and the legacy counters are marked unverified", async () => {
    const cases: Array<[string, unknown]> = [["503 ROLE_READINESS_UNAVAILABLE", new Error("/v1/roles/status-summary: HTTP 503")], ["404", new Error("/v1/roles/status-summary: HTTP 404")],
      ["malformed readiness with a valid legacy block", (() => { const x = slim("ABSENT"); x.readiness.totals.RUNNING.measured = true; return x; })()]];
    for (const [name, feedValue] of cases) {
      const {ctx, panel, factory} = await page({roles: "ok", detail: true, statusSummary: feedValue});
      const en = (await load("locales", "en.js")).default as Record<string, string>, comps = await load("components.js");
      const state = (await ctx.api.rolesReadiness()).state;
      expect(text(panel), name).toBe([en["workforce.ready.title"], en["workforce.ready.lead"], text(comps.stateNote(ctx, state)), en["workforce.ready.unavailable"], "GET /v1/roles/status-summary"].join("")); // exact: not a single readiness figure
      expect(text(panel).replace(en["workforce.ready.title"], "").replace(en["workforce.ready.lead"], "").replace("/v1/roles/status-summary", "").match(/[0-9]/), name).toBeNull(); // no digit outside the fixed title / lead sentence / path
      expect(byData(panel, "readinessLayer"), name).toEqual([]);
      expect(byData(panel, "readinessDenominator"), name).toEqual([]);
      expect(byData(panel, "readiness", "UNAVAILABLE"), name).toHaveLength(1);
      expect(text(panel), name).toContain("no counts are shown");
      if (name.startsWith("malformed")) expect(byData(factory, "legacyProjection", "UNVERIFIED"), name).toHaveLength(1);
      if (!name.startsWith("malformed")) expect(byData(factory, "stat").filter(n => n.dataset.stat.startsWith("factory-")), name).toEqual([]); // the legacy block is unreadable too: no figures at all
    }
  });

  it("readiness unavailable (malformed, with a valid legacy block): fail-closed, the legacy running count is Unknown in the stat and in every by-guild cell, the other four counters stay", async () => {
    const raw = slim("PRESENT"); raw.readiness.totals.RUNNING.measured = false; // malformed readiness => ERROR, so runningMeasured cannot be established
    raw.statusSummary.running = 4242; raw.statusSummary.byGuild[0].running = 4343;
    const {factory, node} = await page({roles: "ok", detail: true, statusSummary: raw});
    expect(byData(factory, "legacyProjection", "UNVERIFIED")).toHaveLength(1);
    const stat = byData(factory, "stat", "factory-running")[0];
    expect(stat.dataset.value).toBe("UNKNOWN");
    // //TR: neden doğru olmalı: hazırlık okunamıyorsa günlüğün olup olmadığı bilinmez, bu yüzden "no run journal" DEĞİL "readiness unavailable" denir
    expect(text(stat.children[0])).toBe("Unknown – readiness unavailable");
    expect(text(node)).not.toContain("4242");
    expect(text(node)).not.toContain("4343");
    expect(everything(node)).not.toContain("4242");
    expect(everything(node)).not.toContain("4343");
    for (const row of byData(factory, "factoryGuild")) expect(text(row.children[5]), row.dataset.factoryGuild).toBe("Unknown – readiness unavailable");
    expect(byData(factory, "stat").filter(n => n.dataset.stat.startsWith("factory-")).map(n => [n.dataset.stat, n.dataset.value]).filter(([k]) => k !== "factory-running"))
      .toEqual([["factory-registered", "599"], ["factory-implemented", String(raw.statusSummary.implemented)], ["factory-tested", String(raw.statusSummary.tested)], ["factory-certified", String(raw.statusSummary.certified)]]);
    expect(text(byData(factory, "stat", "factory-implemented")[0])).toContain("code path (includes unwired stages)");
  });

  it("proposed profiles are shown in their own box, outside the layer table, and only when the audit has them", async () => {
    const {panel} = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")});
    const box = byData(panel, "readinessProposed")[0];
    expect(box).toBeDefined();
    expect(text(box)).toContain("Proposed profiles: 599 of 599; with candidate skills: 197 of 599; with candidate tool adapters: 164 of 599.");
    expect(text(box)).toContain("not counted in any layer");
    expect(all(byId(panel, "wf-readiness-layers")!).includes(box)).toBe(false);
    const table = byId(panel, "wf-readiness-layers")!, tbody = all(table).filter(n => n.tagName === "TBODY")[0];
    expect(tbody.children).toHaveLength(9); // 8 layers + the wired-stages row, nothing else
    expect(text(rowOf(panel, "PROFILED").children[0])).toBe("Profiled");
    expect(text(rowOf(panel, "PROFILED").children[1])).toBe("TRUE 0, FALSE 599 of 599"); // pinned exactly: no proposed figure rides on the layer
    expect(text(rowOf(panel, "PROFILED").children[2])).toBe("measured");
    expect(everything(table)).not.toMatch(/197|164|proposed/i);
    expect(all(table).filter(n => n.tagName === "TH" && n.attrs.get("scope") === "col").map(text)).toEqual(["Layer", "Counts", "Measurement"]);
    expect(text(all(table).filter(n => n.tagName === "CAPTION")[0])).toBe("8 layers + wired stages");
    const none = slim("ABSENT"); none.readiness.proposedOnly = {source: "ABSENT", profiles: 0, withCandidateSkills: 0, withCandidateToolAdapters: 0};
    expect(byData((await page({roles: "ok", detail: true, statusSummary: none})).panel, "readinessProposed")).toEqual([]);
  });

  it("the #262 contract: readiness null + readinessError is an unavailable state with the reason, legacy running stays Unknown, no figure anywhere", async () => {
    const raw = {...slim("ABSENT"), readiness: null, reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"}; raw.statusSummary.running = 4242; raw.statusSummary.byGuild[0].running = 4343;
    const {ctx, panel, factory, node} = await page({roles: "ok", detail: true, statusSummary: raw});
    const en = (await load("locales", "en.js")).default as Record<string, string>, comps = await load("components.js");
    expect((await ctx.api.rolesReadiness()).state).toBe("UNAVAILABLE");
    expect(text(panel)).toBe([en["workforce.ready.title"], en["workforce.ready.lead"], text(comps.stateNote(ctx, "UNAVAILABLE")), en["workforce.ready.unavailable"], "Reason: ROLE_READINESS_UNAVAILABLE", "GET /v1/roles/status-summary"].join(""));
    expect(byData(panel, "readinessReason")[0].dataset.readinessReason).toBe("ROLE_READINESS_UNAVAILABLE");
    expect(byData(panel, "readinessLayer")).toEqual([]);
    expect(byData(factory, "legacyProjection", "UNVERIFIED")).toHaveLength(1);
    expect(byData(factory, "stat", "factory-running")[0].dataset.value).toBe("UNKNOWN");
    expect(text(byData(factory, "stat", "factory-running")[0].children[0])).toBe("Unknown – readiness unavailable");
    expect(everything(node)).not.toContain("4242");
    expect(everything(node)).not.toContain("4343");
  });

  it("the legacy implemented counter says 'code path (includes unwired stages)' wherever it appears: stat and by-guild header, in the verified, unavailable and legacy-only states", async () => {
    const label = "Implemented: code path (includes unwired stages)";
    const legacyOnly: any = slim("ABSENT"); delete legacyOnly.readiness; delete legacyOnly.reconciliation; delete legacyOnly.statusSummaryStatus; // an older server: the legacy block only
    const unavailable = {...slim("ABSENT"), readiness: null, reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"};
    for (const [name, raw] of [["verified", slim("PRESENT")], ["unavailable", unavailable], ["legacy-only", legacyOnly]] as Array<[string, any]>) {
      const {factory} = await page({roles: "ok", detail: true, statusSummary: raw});
      expect(text(byData(factory, "stat", "factory-implemented")[0]), name).toContain(label);
      const heads = all(byId(factory, "wf-factory-guilds")!).filter(n => n.tagName === "TH" && n.attrs.get("scope") === "col").map(text);
      expect(heads, name).toEqual(["Guild", "Registered", label, "Tested", "Certified", "Running now"]);
    }
  });

  it("NOT_APPLICABLE branches render with the denominator in en and tr (measured and unmeasured)", async () => {
    const raw = slim("PRESENT");
    Object.assign(raw.readiness.totals.DEFINED, {TRUE: 590, FALSE: 0, UNKNOWN: 0, NOT_APPLICABLE: 9});
    Object.assign(raw.readiness.totals.TOOL_READY, {TRUE: 0, FALSE: 580, UNKNOWN: 9, NOT_APPLICABLE: 10, measured: false});
    for (const [lang, defined, tool, na] of [["en", "TRUE 590, FALSE 0, not applicable 9 of 599", "TRUE 0, FALSE 580, UNKNOWN 9, not applicable 10 of 599", "en"], ["tr", "TRUE 590, FALSE 0, uygulanamaz 9 / 599", "TRUE 0, FALSE 580, UNKNOWN 9, uygulanamaz 10 / 599", "tr"]] as const) {
      const {panel} = await page({roles: "ok", detail: true, statusSummary: raw}, lang);
      expect(text(rowOf(panel, "DEFINED").children[1]), na).toBe(defined);
      expect(text(rowOf(panel, "TOOL_READY").children[1]), na).toBe(tool);
    }
  });

  it("the Turkish panel renders the key rows exactly (RUNNING unknown, a measured row, an unmeasured row, the unavailable state, the proposed box)", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, comps = await load("components.js");
    const {panel} = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")}, "tr");
    expect(text(rowOf(panel, "RUNNING").children[1])).toBe("Bilinmiyor – çalıştırma günlüğü yok · UNKNOWN 599 / 599");
    expect(text(rowOf(panel, "DEFINED").children[1])).toBe("TRUE 599, FALSE 0 / 599");
    expect(text(rowOf(panel, "TOOL_READY").children[1])).toBe("TRUE 0, FALSE 590, UNKNOWN 9 / 599");
    expect(text(rowOf(panel, "TOOL_READY").children[2])).toBe("tam ölçülmedi");
    expect(text(byData(panel, "readinessProposed")[0])).toContain("Önerilen profil: 599 / 599; aday becerisi olan: 197 / 599; aday araç bağdaştırıcısı olan: 164 / 599.");
    expect(text(byData(panel, "readinessDenominator")[0])).toBe("Rol tanımı: 599");
    const un = await page({roles: "ok", detail: true, statusSummary: new Error("/v1/roles/status-summary: HTTP 503")}, "tr");
    expect(text(un.panel)).toBe([tr["workforce.ready.title"], tr["workforce.ready.lead"], text(comps.stateNote(un.ctx, (await un.ctx.api.rolesReadiness()).state)), tr["workforce.ready.unavailable"], "GET /v1/roles/status-summary"].join(""));
  });

  it("reconciliation, authority, inputs and anomalies are rendered from the payload, not assumed (literal expectations, en and tr)", async () => {
    // //TR: Beklenen metinler ŞABLONDAN türetilmez, birebir sabit yazılır (şablonu bozan mutantlar böylece ölür).
    const note = (f: N) => text(byData(f, "legacyProjection", "DEPRECATED_LEGACY_PROJECTION")[0]);
    const EN_HEAD = "The five counters below are a deprecated legacy projection; the 8 layers above are the only truth. ";
    const TR_HEAD = "Aşağıdaki beş sayaç eski ve kullanımdan kalkan bir izdüşümdür; tek doğru yukarıdaki 8 katmandır. ";
    const absent = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")});
    expect(note(absent.factory)).toBe(EN_HEAD + "They are consistent with readiness on the measured layers: yes (0 mismatches); running is not measured, so it is not compared.");
    expect(byData(absent.factory, "legacyProjection", "DEPRECATED_LEGACY_PROJECTION")[0].dataset.consistent).toBe("true");
    expect(text(byData(absent.panel, "readinessInputs")[0])).toBe("Inputs: run journal absent; adapter reality not supplied; reachable stages not supplied");
    expect(text(byData(absent.panel, "readinessAnomalies")[0])).toBe("Readiness anomalies: 0");
    expect(byData(absent.panel, "readinessAuthority")).toEqual([]);
    const present = await page({roles: "ok", detail: true, statusSummary: slim("PRESENT")});
    expect(note(present.factory)).toBe(EN_HEAD + "Legacy and readiness are consistent: yes (0 mismatches).");
    // a payload that says otherwise: mismatches, supplied inputs, anomalies, a non-authoritative measurement
    const odd = slim("PRESENT");
    Object.assign(odd.reconciliation, {consistent: false, mismatches: ["total.implemented:8!=7", "total.tested:0!=1"], implementedStageWired: odd.readiness.stageWired.TRUE});
    Object.assign(odd.readiness.inputs, {adapterReality: "SUPPLIED", reachableStages: "SUPPLIED"});
    Object.assign(odd.readiness, {anomalies: 3, authority: "NON_AUTHORITATIVE_PROMOTED_STATUS_OVERRIDE"});
    const o = await page({roles: "ok", detail: true, statusSummary: odd});
    expect(note(o.factory)).toBe(EN_HEAD + "Legacy and readiness are consistent: no (2 mismatches).");
    expect(byData(o.factory, "legacyProjection", "DEPRECATED_LEGACY_PROJECTION")[0].dataset.consistent).toBe("false");
    expect(text(byData(o.panel, "readinessInputs")[0])).toBe("Inputs: run journal present; adapter reality supplied; reachable stages supplied");
    expect(text(byData(o.panel, "readinessAnomalies")[0])).toBe("Readiness anomalies: 3");
    expect(text(byData(o.panel, "readinessAuthority")[0])).toBe("Non-authoritative: the promoted-status set was overridden.");
    // the same disagreement with the run journal ABSENT (the unmeasured-running wording)
    const oddAbsent = slim("ABSENT");
    Object.assign(oddAbsent.reconciliation, {consistent: false, mismatches: ["total.implemented:8!=7", "total.tested:0!=1"]});
    const oa = await page({roles: "ok", detail: true, statusSummary: oddAbsent});
    expect(note(oa.factory)).toBe(EN_HEAD + "They are consistent with readiness on the measured layers: no (2 mismatches); running is not measured, so it is not compared.");
    expect(byData(oa.factory, "legacyProjection", "DEPRECATED_LEGACY_PROJECTION")[0].dataset.consistent).toBe("false");
    // Turkish, all four
    expect(note((await page({roles: "ok", detail: true, statusSummary: oddAbsent}, "tr")).factory)).toBe(TR_HEAD + "Ölçülen katmanlarda hazırlıkla tutarlı: hayır (2 uyuşmazlık); çalışan ölçülmediği için karşılaştırılmaz.");
    expect(note((await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")}, "tr")).factory)).toBe(TR_HEAD + "Ölçülen katmanlarda hazırlıkla tutarlı: evet (0 uyuşmazlık); çalışan ölçülmediği için karşılaştırılmaz.");
    expect(note((await page({roles: "ok", detail: true, statusSummary: odd}, "tr")).factory)).toBe(TR_HEAD + "Eski sayaçlar ile hazırlık tutarlı: hayır (2 uyuşmazlık).");
    expect(note((await page({roles: "ok", detail: true, statusSummary: slim("PRESENT")}, "tr")).factory)).toBe(TR_HEAD + "Eski sayaçlar ile hazırlık tutarlı: evet (0 uyuşmazlık).");
  });

  it("the status summary and the readiness share ONE read by construction (not by the cache TTL)", async () => {
    const apiMod = await load("api.js"), st = await load("state.js");
    let clock = 1_760_000_000_000; const hits: string[] = [];
    const api = apiMod.createApi({bridge: {apiGet: async (p: string) => { hits.push(p); await new Promise(r => setTimeout(r, 5)); return slim("ABSENT"); }}, store: st.createStore(null), now: () => (clock += 60_000)}); // every clock read is a minute later: any TTL cache expires between the two calls
    const [a, b] = await Promise.all([api.rolesStatusSummary(), api.rolesReadiness()]);
    expect([a.state, b.state]).toEqual(["VERIFIED", "VERIFIED"]);
    expect(hits).toEqual(["/v1/roles/status-summary"]);
  });

  it("proposedOnly shows each count against ITS OWN base (profiles of the denominator, candidates of the profiles), en and tr", async () => {
    const f = slim("ABSENT"); Object.assign(f.readiness.proposedOnly, {profiles: 300, withCandidateSkills: 197, withCandidateToolAdapters: 164});
    const en = await page({roles: "ok", detail: true, statusSummary: f}), tr = await page({roles: "ok", detail: true, statusSummary: f}, "tr");
    expect(text(byData(en.panel, "readinessProposed")[0])).toBe("Proposed profiles (not runtime)Proposed profiles: 300 of 599; with candidate skills: 197 of 300; with candidate tool adapters: 164 of 300. These are proposals only and are not counted in any layer.");
    expect(text(byData(tr.panel, "readinessProposed")[0])).toBe("Önerilen profiller (çalışma zamanı değil)Önerilen profil: 300 / 599; aday becerisi olan: 197 / 300; aday araç bağdaştırıcısı olan: 164 / 300. Bunlar yalnız önerilerdir ve hiçbir katmanda sayılmaz.");
  });

  it("the Turkish unavailable state renders the reason line, the caption and the column headers; the English and Turkish table headers are pinned", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, comps = await load("components.js");
    const contract = {...slim("ABSENT"), readiness: null, reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"};
    const un = await page({roles: "ok", detail: true, statusSummary: contract}, "tr");
    expect(text(un.panel)).toBe([tr["workforce.ready.title"], tr["workforce.ready.lead"], text(comps.stateNote(un.ctx, "UNAVAILABLE")), tr["workforce.ready.unavailable"], "Neden: ROLE_READINESS_UNAVAILABLE", "GET /v1/roles/status-summary"].join(""));
    expect(text(byData(un.panel, "readinessReason")[0])).toBe("Neden: ROLE_READINESS_UNAVAILABLE");
    const heads = (panel: N) => all(byId(panel, "wf-readiness-layers")!).filter(n => n.tagName === "TH" && n.attrs.get("scope") === "col").map(text);
    const caption = (panel: N) => text(all(byId(panel, "wf-readiness-layers")!).filter(n => n.tagName === "CAPTION")[0]);
    const ok = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")}, "tr"), okEn = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")});
    expect(heads(ok.panel)).toEqual(["Katman", "Sayılar", "Ölçüm"]);
    expect(caption(ok.panel)).toBe("8 katman + bağlı aşamalar");
    expect(heads(okEn.panel)).toEqual(["Layer", "Counts", "Measurement"]);
    expect(caption(okEn.panel)).toBe("8 layers + wired stages");
    expect(text(rowOf(ok.panel, "DEFINED").children[2])).toBe("ölçüldü");
  });

  it("the running 'Unknown' carries a reason that is true: no run journal (readiness readable, journal absent) vs readiness unavailable (journal unknown), en and tr; a present journal shows the number", async () => {
    const cell = (f: N) => text(byData(f, "stat", "factory-running")[0].children[0]);
    const guild = (f: N) => byData(f, "factoryGuild").map(r => text(r.children[5]));
    const absent = slim("ABSENT"), unavailable = {...slim("PRESENT"), readiness: null, reconciliation: null, readinessError: "ROLE_READINESS_UNAVAILABLE"}; // a journal EXISTS, readiness is unavailable
    for (const [lang, noJournal, unavail] of [["en", "Unknown – no run journal", "Unknown – readiness unavailable"], ["tr", "Bilinmiyor – çalıştırma günlüğü yok", "Bilinmiyor – hazırlık okunamıyor"]] as const) {
      const a = await page({roles: "ok", detail: true, statusSummary: absent}, lang), u = await page({roles: "ok", detail: true, statusSummary: unavailable}, lang);
      expect(cell(a.factory), lang).toBe(noJournal);
      expect(new Set(guild(a.factory)), lang).toEqual(new Set([noJournal]));
      expect(cell(u.factory), lang).toBe(unavail);
      expect(new Set(guild(u.factory)), lang).toEqual(new Set([unavail]));
    }
    const present = await page({roles: "ok", detail: true, statusSummary: slim("PRESENT")});
    expect(cell(present.factory)).toBe("0");
  });

  it("the shared status read is released after completion and after a rejected read, and an invalidation or epoch change starts a fresh read", async () => {
    const apiMod = await load("api.js"), st = await load("state.js");
    const make = (answer: () => Promise<any>) => { let clock = 1_760_000_000_000; const hits: string[] = []; const store = st.createStore(null);
      const api = apiMod.createApi({bridge: {apiGet: async (p: string) => { hits.push(p); return answer(); }}, store, now: () => (clock += 60_000)}); return {api, store, hits}; };
    const slow = () => new Promise(r => setTimeout(() => r(slim("ABSENT")), 10));
    // released after completion: a later (not concurrent) call reads again
    const done = make(slow);
    await Promise.all([done.api.rolesStatusSummary(), done.api.rolesReadiness()]);
    expect(done.hits).toHaveLength(1);
    await done.api.rolesReadiness();
    expect(done.hits).toHaveLength(2);
    // released after a rejected read (the bridge throws): the failure is a state, and the next call reads again
    const failing = make(async () => { throw new Error("/v1/roles/status-summary: HTTP 503"); });
    const [f1, f2] = await Promise.all([failing.api.rolesStatusSummary(), failing.api.rolesReadiness()]);
    expect([f1.state === "VERIFIED", f2.state === "VERIFIED"]).toEqual([false, false]);
    expect(failing.hits).toHaveLength(1);
    await failing.api.rolesStatusSummary();
    expect(failing.hits).toHaveLength(2);
    // an invalidation (cache cleared, epoch bumped) while a read is in flight: the next call starts a fresh read
    const inv = make(slow);
    const first = inv.api.rolesStatusSummary();
    inv.store.invalidate();
    const second = inv.api.rolesReadiness();
    await Promise.all([first, second]);
    expect(inv.hits).toHaveLength(2);
    // a cache clear alone (what a successful write does) also ends the sharing
    const clr = make(slow);
    const c1 = clr.api.rolesStatusSummary();
    clr.store.cache.clear();
    const c2 = clr.api.rolesReadiness();
    await Promise.all([c1, c2]);
    expect(clr.hits).toHaveLength(2);
  });

  // //TR: #263 son tur (F1-F5): tablo YAPISI sabitlenir (doğrudan çocuklar tam [CAPTION, THEAD, TBODY]; başlık metinleri THEAD>TR>TH içinden okunur), RUNNING için "tamamen UNKNOWN ama günlük VAR" durumu ERROR, by-guild başlığının tr etiketleri, bayat okuma serbest bırakma koruması ve readinessError ile geçerli readiness birleşimleri.
  it("both tables have the exact structure [CAPTION, THEAD, TBODY] and their header cells are read from THEAD > TR > TH (readiness layers and factory by-guild, en and tr)", async () => {
    const structure = (table: N) => {
      const kids = table.children.map(c => c.tagName), thead = table.children.find(c => c.tagName === "THEAD")!;
      return {kids, trs: thead.children.map(c => c.tagName), heads: thead.children[0].children.map(c => `${c.tagName}:${c.attrs.get("scope")}:${text(c)}`), caption: text(table.children.find(c => c.tagName === "CAPTION")!)};
    };
    const th = (scopeCols: string[]) => scopeCols.map(t => `TH:col:${t}`);
    const expected = {
      en: {ready: {caption: "8 layers + wired stages", heads: th(["Layer", "Counts", "Measurement"])}, factory: {caption: "By guild", heads: th(["Guild", "Registered", "Implemented: code path (includes unwired stages)", "Tested", "Certified", "Running now"])}},
      tr: {ready: {caption: "8 katman + bağlı aşamalar", heads: th(["Katman", "Sayılar", "Ölçüm"])}, factory: {caption: "Loncaya göre", heads: th(["Lonca", "Kayıtlı", "Uygulanmış: kod yolu (bağlanmamış aşamaları içerir)", "Test edilmiş", "Sertifikalı", "Şu an çalışan"])}}};
    for (const lang of ["en", "tr"] as const) {
      const pg = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")}, lang);
      for (const [name, id] of [["ready", "wf-readiness-layers"], ["factory", "wf-factory-guilds"]] as const) {
        const st = structure(byId(pg.node, id)!);
        expect(st.kids, `${lang} ${name}`).toEqual(["CAPTION", "THEAD", "TBODY"]);
        expect(st.trs, `${lang} ${name}`).toEqual(["TR"]);
        expect(st.heads, `${lang} ${name}`).toEqual(expected[lang][name].heads);
        expect(st.caption, `${lang} ${name}`).toBe(expected[lang][name].caption);
      }
    }
  });

  it("RUNNING that is entirely UNKNOWN while the journal is PRESENT is an ERROR (not just UNKNOWN = 1)", async () => {
    const c = await load("agent-factory-core.js"), x = slim("PRESENT");
    Object.assign(x.readiness.totals.RUNNING, {TRUE: 0, FALSE: 0, UNKNOWN: 599, NOT_APPLICABLE: 0, measured: false});
    expect(c.mapReadiness(x)).toEqual(ERR);
  });

  it("a valid readiness object next to a readinessError of any kind is an ERROR (null, a number, another string, the exact string)", async () => {
    const c = await load("agent-factory-core.js");
    for (const bad of [null, 503, "OTHER", "ROLE_READINESS_UNAVAILABLE", "", false, {}]) expect(c.mapReadiness({...slim("ABSENT"), readinessError: bad}), String(bad)).toEqual(ERR);
  });

  it("a read that finishes after it was superseded does not release the newer shared read", async () => {
    const apiMod = await load("api.js"), st = await load("state.js");
    let clock = 1_760_000_000_000; const hits: string[] = [], pending: Array<(v: unknown) => void> = [];
    const store = st.createStore(null);
    const api = apiMod.createApi({bridge: {apiGet: (p: string) => new Promise(r => { hits.push(p); pending.push(r); })}, store, now: () => (clock += 60_000)});
    const a = api.rolesStatusSummary();      // A starts
    store.invalidate();                      // the cache and the epoch change
    const b = api.rolesStatusSummary();      // B starts (a fresh read)
    expect(hits).toHaveLength(2);
    pending[0](slim("ABSENT")); await a;     // A completes: it must not release B
    const c = api.rolesReadiness();          // a third call shares B
    expect(hits).toHaveLength(2);
    pending[1](slim("ABSENT"));
    expect([(await b).state, (await c).state]).toEqual(["VERIFIED", "VERIFIED"]);
    expect(hits).toHaveLength(2);
  });

  it("en and tr have the same readiness keys with the same placeholders, and the Turkish panel says Bilinmiyor", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>, tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const keys = Object.keys(en).filter(k => k.startsWith("workforce.ready."));
    expect(keys.length).toBeGreaterThan(30);
    const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(Object.keys(tr).filter(k => k.startsWith("workforce.ready.")).sort()).toEqual(keys.slice().sort());
    const {panel} = await page({roles: "ok", detail: true, statusSummary: slim("ABSENT")}, "tr");
    expect(text(rowOf(panel, "RUNNING"))).toContain("Bilinmiyor – çalıştırma günlüğü yok");
    expect(text(rowOf(panel, "TOOL_READY"))).toContain("TRUE 0, FALSE 590, UNKNOWN 9 / 599");
  });
});
