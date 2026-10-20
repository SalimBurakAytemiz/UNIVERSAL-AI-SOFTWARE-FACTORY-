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
