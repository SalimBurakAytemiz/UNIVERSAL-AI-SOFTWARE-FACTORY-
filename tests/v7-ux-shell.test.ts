// //TR: Bu test UX WP-SHELL-REFINE kalıcı shell katmanını doğrular: (1) global Inspector çekmecesi (apps/desktop/renderer/inspector.js) — {kind,id} referansı için GERÇEK ayrıntıyı YALNIZ zaten allow-list'li GET'lerle (/v1/projects, /v1/missions/:id, /v1/work-runs/:id, /v1/roles/:id) okur; geçersiz kimlik istek üretmez; kayıt yok/404 => dürüst UNAVAILABLE, veri UYDURULMAZ; modal <dialog> rol/aria, odaklanabilir başlık, Esc/kapat ve çağırana geri-odak; yeni GET/yazma yoktur (main.mjs EXTRA_GET_ROUTES değişmez). (2) Ctrl+K komut paleti (shell.js) — mevcut "aramayla gezin" (proje/mission) korunur, üstüne EYLEMLER grubu eklenir: her rota için go-to-view, geçerli seçim için Inspector aç, global STOP_ALL; klavye (ok/enter) ve gruplu combobox/listbox a11y korunur. (3) STOP_ALL paletten yalnız MEVCUT ACİL DURDUR onay penceresini (openStopDialog) yeniden kullanır — yeni/onaysız/yazma denetimi EKLENMEZ. (4) palette.*/inspector.* sözlüğü EN/TR'de birebirdir. (5) statik güvenlik: inspector.js fetch/innerHTML/window.uasco/apiGet/apiPost kullanmaz.
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {desktopGetPathAllowed} from "../automation/lib/control-boundary.mjs";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const readRend = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const readMain = () => fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const block = (tag: string) => { const s = readMain(); const a = s.indexOf(`// ${tag}-BEGIN`), b = s.indexOf(`// ${tag}-END`); if (a < 0 || b < 0) throw new Error(`no ${tag}`); return s.slice(a, b); };
const loadGet = () => new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const allowGet = (p: string) => desktopGetPathAllowed(p) || loadGet()(p);

const PRJ = "prj_" + "a".repeat(24), MSN = "msn_" + "b".repeat(24), RUN = "run_" + "c".repeat(24), ROLE = "UASCO-0007";

// Minimal fake DOM (createElement[NS]/textContent/replaceChildren/events + dialog + fire + focus).
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>(); value = ""; open = false; disabled = false;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get isConnected() { let n: N | null = this; while (n) { if (n === this.doc.body) return true; n = n.parent; } return false; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
  removeAttribute(k: string) { this.attrs.delete(k); if (k === "class") this.className = ""; }
  getAttribute(k: string) { return k === "class" && this.className ? this.className : this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { for (const fn of this.ls.get(ev) ?? []) fn({ preventDefault() {}, currentTarget: this, ...e }); }
  focus() { this.doc.focused = this; }
  select() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
}
class D {
  body: N; focused: N | null = null; documentElement: N; ls = new Map<string, Array<(e: any) => void>>();
  constructor() { this.body = new N(this, "body"); this.documentElement = new N(this, "html"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { for (const fn of this.ls.get(ev) ?? []) fn({ preventDefault() {}, ...e }); }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const within = (r: N | null) => (r ? all(r) : []);
const text = (n: N) => n.textContent;

function missionDetailResponse() { return { mission: { missionId: MSN, projectId: PRJ, title: "Mission Bir", objective: "Amaç X", acceptanceCriteria: ["k1", "k2"], status: "EXECUTING", riskLevel: "R2", createdAt: "2026-10-16T10:00:00.000Z" }, tasks: [{ taskId: "t1", title: "Görev 1", status: "DONE" }] }; }
function runDetailResponse() { return { workRun: { runId: RUN, missionId: MSN, status: "REVIEWING", step: "REVIEW", role: "builder", startedAt: "2026-10-16T09:00:00.000Z", executor: { reviewer: "UASCO-REVIEWER" }, evidence: [] } }; }
function roleDetailResponse() { return { role: { roleId: ROLE, title: "Mimar", guildId: "G01", clusterId: "CL01", lifecycle: "ACTIVE", priority: "P1", runtimeStatus: "UNKNOWN", proficiencyStatus: "NOT_EVALUATED", certifiedScope: "kapsam", responsibilities: ["r1"], evaluationSpecs: [] } }; }
function projectsResponse() { return { projects: [{ projectId: PRJ, name: "Proje Bir", tenantId: "ten_1", environmentId: "dev", createdAt: "2026-10-16T08:00:00.000Z", repository: { path: "/repo/x" } }] }; }

function makeBridge(overrides: Record<string, (p: string) => any> = {}) {
  const calls: string[] = [], posts: string[] = [];
  const bridge = {
    apiGet: async (p: string) => {
      calls.push(p);
      if (overrides[p]) return overrides[p](p);
      if (p === "/v1/projects") return projectsResponse();
      if (p === `/v1/missions/${MSN}`) return missionDetailResponse();
      if (p === `/v1/work-runs/${RUN}`) return runDetailResponse();
      if (p === `/v1/roles/${ROLE}`) return roleDetailResponse();
      throw new Error(`${p}: HTTP 404`);
    },
    apiPost: async (p: string) => { posts.push(p); return { status: 200, body: {} }; },
  };
  return { bridge, calls, posts };
}
async function mkCtx(bridgeSpec = makeBridge(), lang = "tr") {
  const apiMod = await load("api.js"), i18n = await load("i18n.js");
  const doc = new D();
  const store: any = { projectId: null, epoch: 0, cache: new Map(), samples: new Map(), lastRefreshAt: null, markRefreshed() {} };
  const api = apiMod.createApi({ bridge: bridgeSpec.bridge, store });
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const nav: string[] = [], sel: Array<string | null> = [];
  const ctx: any = { doc, store, api, i18n: { lang, t, setLang() {}, onChange() { return () => {}; } }, t, principal: "FOUNDER_LOCAL",
    navigate: (id: string) => nav.push(id), selectProject: (id: string | null) => sel.push(id), currentRouteId: () => "home" };
  return { ctx, doc, api, nav, sel, calls: bridgeSpec.calls, posts: bridgeSpec.posts };
}

const flat = (r: Record<string, string>) => Object.keys(r).sort();

describe("WP-SHELL-REFINE Inspector: real detail via already-allow-listed GETs only, honest states, no fabrication", () => {
  it("isInspectableRef accepts the four kinds with valid ids and rejects bad kinds/ids", async () => {
    const ins = await load("inspector.js");
    expect(ins.isInspectableRef({ kind: "mission", id: MSN })).toBe(true);
    expect(ins.isInspectableRef({ kind: "run", id: RUN })).toBe(true);
    expect(ins.isInspectableRef({ kind: "role", id: ROLE })).toBe(true);
    expect(ins.isInspectableRef({ kind: "project", id: PRJ })).toBe(true);
    expect(ins.isInspectableRef({ kind: "mission", id: "nope" })).toBe(false);
    expect(ins.isInspectableRef({ kind: "agent", id: ROLE })).toBe(false);
    expect(ins.isInspectableRef(null)).toBe(false);
  });
  it("fetches each kind via the existing allow-listed GET; every path it requests is allow-listed; invalid id makes no request", async () => {
    const ins = await load("inspector.js");
    const { ctx, calls } = await mkCtx();
    expect((await ins.fetchInspectorDetail(ctx, { kind: "mission", id: MSN })).entity.title).toBe("Mission Bir");
    expect((await ins.fetchInspectorDetail(ctx, { kind: "run", id: RUN })).entity.runId).toBe(RUN);
    expect((await ins.fetchInspectorDetail(ctx, { kind: "role", id: ROLE })).entity.roleId).toBe(ROLE);
    expect((await ins.fetchInspectorDetail(ctx, { kind: "project", id: PRJ })).entity.name).toBe("Proje Bir");
    for (const p of calls) expect(allowGet(p), p).toBe(true);
    calls.length = 0;
    expect((await ins.fetchInspectorDetail(ctx, { kind: "mission", id: "bad" })).state).toBe("ERROR");
    expect(calls.length).toBe(0); // geçersiz kimlik istek üretmez
  });
  it("honest states: a project not present in the real list is UNAVAILABLE (not fabricated); a 404 mission is UNAVAILABLE with null entity", async () => {
    const ins = await load("inspector.js");
    const { ctx } = await mkCtx();
    const missing = await ins.fetchInspectorDetail(ctx, { kind: "project", id: "prj_" + "f".repeat(24) });
    expect(missing.state).toBe("UNAVAILABLE");
    expect(missing.entity).toBe(null);
    // 404 mission: classifyFailure -> UNAVAILABLE, entity null
    const b2 = makeBridge({ [`/v1/missions/${MSN}`]: () => { throw new Error("HTTP 404"); } });
    const { ctx: ctx2 } = await mkCtx(b2);
    const m = await ins.fetchInspectorDetail(ctx2, { kind: "mission", id: MSN });
    expect(m.state).toBe("UNAVAILABLE");
    expect(m.entity).toBe(null);
  });
  it("drawer is a labelled modal dialog, focuses its title on open, renders real fields, and Esc/close return focus to the invoker", async () => {
    const ins = await load("inspector.js");
    const { ctx, doc } = await mkCtx();
    const inspector = ins.createInspector(ctx);
    expect(inspector.dialog.tagName).toBe("DIALOG");
    expect(inspector.dialog.getAttribute("role")).toBe("dialog");
    expect(inspector.dialog.getAttribute("aria-modal")).toBe("true");
    expect(inspector.dialog.getAttribute("aria-labelledby")).toBe("inspectorTitle");
    expect(inspector.dialog.getAttribute("aria-describedby")).toBe("inspectorSub");
    const invoker = new N(doc, "button"); doc.body.append(invoker); invoker.focus();
    inspector.open({ kind: "mission", id: MSN }, invoker);
    expect(inspector.isOpen).toBe(true);
    expect(inspector.dialog.open).toBe(true); // showModal -> native focus trap
    const title = doc.getElementById("inspectorTitle")!;
    expect(title.getAttribute("tabindex")).toBe("-1");
    expect(doc.focused).toBe(title); // odak başlığa gitti
    await new Promise(r => setTimeout(r, 0)); // async yükleme
    expect(text(doc.getElementById("inspectorTitle")!)).toBe("Mission Bir"); // gerçek ad başlıkta
    const body = text(doc.getElementById("inspectorBody")!);
    expect(body).toContain("Amaç X");
    expect(body).toContain("Görev 1");
    // Esc kapatır ve odak çağırana döner
    inspector.dialog.fire("keydown", { key: "Escape" });
    expect(inspector.isOpen).toBe(false);
    expect(inspector.dialog.open).toBe(false);
    expect(doc.focused).toBe(invoker);
  });
  it("drawer shows an honest state note (never fabricated detail) when the server does not verify", async () => {
    const ins = await load("inspector.js");
    const b = makeBridge({ [`/v1/roles/${ROLE}`]: () => { throw new Error("fetch failed"); } });
    const { ctx, doc } = await mkCtx(b);
    const inspector = ins.createInspector(ctx);
    inspector.open({ kind: "role", id: ROLE }, null);
    await new Promise(r => setTimeout(r, 0));
    const body = text(doc.getElementById("inspectorBody")!);
    expect(body).not.toContain("Mimar");
  });
});

// Shell host DOM with exactly the ids wireStatic + the palette touch.
const HOST_IDS = ["status", "bellIcon", "stopBtn", "stopCancel", "stopDialog", "stopConfirm", "resumeBtn", "refreshBtn", "notifyBtn", "langBtn", "projectSelect", "searchInput", "searchResults"];
function mountHost(doc: D) {
  for (const id of HOST_IDS) { const n = new N(doc, id === "projectSelect" ? "select" : id === "searchInput" ? "input" : id === "stopDialog" ? "dialog" : id === "searchResults" ? "ul" : "button"); n.setAttribute("id", id); doc.body.append(n); }
  // stopBtn needs a .stop-text child only if renderStop runs; palette path does not call renderStop.
}
async function mkShell(lang = "tr") {
  const shellMod = await load("shell.js"), apiMod = await load("api.js"), i18n = await load("i18n.js"), forms = await load("forms.js");
  const doc = new D(); mountHost(doc);
  const store: any = { projectId: null, epoch: 0, cache: new Map(), samples: new Map(), lastRefreshAt: null, markRefreshed() {} };
  const { bridge, calls, posts } = makeBridge();
  const api = apiMod.createApi({ bridge, store });
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const nav: string[] = [], sel: Array<string | null> = [];
  const ctx: any = { doc, store, api, i18n: { lang, t, setLang() {}, onChange() { return () => {}; } }, t, principal: "FOUNDER_LOCAL",
    navigate: (id: string) => nav.push(id), selectProject: (id: string | null) => { sel.push(id); }, currentRouteId: () => "home" };
  // window seeded as "firstrun seen" so maybeOpenFirstRun does nothing during wireStatic.
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = { localStorage: { getItem: () => "1", setItem() {}, removeItem() {} } };
  const shell = shellMod.createShell(ctx);
  shell.data.projects = { state: "VERIFIED", items: [{ projectId: PRJ, name: "Proje Bir" }] };
  shell.data.missions = { state: "VERIFIED", items: [{ missionId: MSN, projectId: PRJ, title: "Mission Bir", status: "EXECUTING" }] };
  shell.wireStatic();
  (globalThis as any).window = prevWindow;
  return { shell, doc, ctx, nav, sel, calls, posts, forms, routes: await load("routes.js"), t };
}
const options = (doc: D) => within(doc.getElementById("searchResults")).filter(n => n.getAttribute("role") === "option");
const groups = (doc: D) => within(doc.getElementById("searchResults")).filter(n => n.className === "search-group");

describe("WP-SHELL-REFINE Ctrl+K command palette: actions section + preserved search-to-navigate + grouped a11y", () => {
  let env: Awaited<ReturnType<typeof mkShell>>;
  beforeEach(async () => { env = await mkShell(); env.forms.selection.missionId = MSN; });

  it("empty palette (Ctrl+K / focus) lists the ACTIONS group: go-to-view for all 10 routes, open-inspector for the current selection, and global STOP_ALL", () => {
    const { doc, routes } = env;
    doc.getElementById("searchInput")!.fire("focus");
    const opts = options(doc);
    expect(opts.length).toBe(routes.ROUTES.length + 2); // 10 go-to + inspect + stopall
    expect(groups(doc).map(g => text(g))).toContain(env.t("palette.group.action"));
    // Her 10 rota için bir go-to-view eylemi
    for (const r of routes.ROUTES) expect(opts.some(o => text(o).includes(env.t(`area.${r.id}.title`))), r.id).toBe(true);
    const labels = opts.map(o => text(o)).join(" | ");
    expect(labels).toContain(env.t("palette.stopAll"));
    expect(labels).toContain("Mission Bir"); // inspect current selection
    // combobox/listbox semantiği
    const inp = doc.getElementById("searchInput")!;
    expect(inp.getAttribute("aria-expanded")).toBe("true");
    expect(opts.every(o => /^searchOpt-\d+$/.test(o.id))).toBe(true);
    expect(opts.filter(o => o.getAttribute("aria-selected") === "true").length).toBe(1);
    expect(inp.getAttribute("aria-activedescendant")).toBe("searchOpt-0");
  });

  it("typing still navigates to real projects/missions (search-to-navigate preserved) under a Results group", () => {
    const { doc, nav, sel } = env;
    const inp = doc.getElementById("searchInput")!; inp.value = "Proje Bir"; inp.fire("input");
    const resGroup = groups(doc).map(g => text(g));
    expect(resGroup).toContain(env.t("palette.group.result"));
    const projOpt = options(doc).find(o => text(o).includes("Proje Bir") && o.dataset.kind === "project")!;
    expect(projOpt).toBeTruthy();
    projOpt.fire("mousedown");
    expect(sel).toContain(PRJ);
    expect(nav).toContain("projects");
  });

  it("arrow/enter keyboard navigation selects and runs an action (go-to-view navigates)", () => {
    const { doc, nav } = env;
    const inp = doc.getElementById("searchInput")!; inp.fire("focus");
    inp.fire("keydown", { key: "ArrowDown" });
    expect(inp.getAttribute("aria-activedescendant")).toBe("searchOpt-1");
    inp.fire("keydown", { key: "Enter" });
    expect(nav.length).toBe(1); // bir go-to-view eylemi çalıştı
  });

  it("STOP_ALL from the palette reuses the EXISTING stop dialog + confirmation and adds NO write/side-effect", () => {
    const { doc, posts } = env;
    doc.getElementById("searchInput")!.fire("focus");
    const stopOpt = options(doc).find(o => text(o).includes(env.t("palette.stopAll")))!;
    expect(stopOpt).toBeTruthy();
    const stopDialog = doc.getElementById("stopDialog")!;
    expect(stopDialog.open).toBe(false);
    stopOpt.fire("mousedown");
    expect(stopDialog.open).toBe(true); // mevcut ACİL DURDUR onay penceresi açıldı
    expect(posts.length).toBe(0); // palet hiçbir yazma/durdurma POST'u yapmadı (onay beklenir)
  });

  it("open-inspector action opens the drawer for the current selection and loads real detail via an allow-listed GET", async () => {
    const { doc, calls } = env;
    doc.getElementById("searchInput")!.fire("focus");
    const insOpt = options(doc).find(o => o.dataset.kind === "action" && text(o).includes("Mission Bir"))!;
    expect(insOpt).toBeTruthy();
    insOpt.fire("mousedown");
    const drawer = doc.getElementById("inspectorDrawer")!;
    expect(drawer).toBeTruthy();
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    await new Promise(r => setTimeout(r, 0));
    expect(text(doc.getElementById("inspectorDrawer")!)).toContain("Mission Bir");
    expect(text(doc.getElementById("inspectorBody")!)).toContain("Amaç X");
    expect(calls).toContain(`/v1/missions/${MSN}`);
    for (const p of calls) expect(allowGet(p), p).toBe(true);
  });

  it("the shell exposes openInspector (the entity-row entry point) and wires it into feed rows", () => {
    const { shell } = env;
    expect(typeof shell.openInspector).toBe("function");
    const src = readRend("shell.js");
    expect(src).toContain("inspectBtn({kind:\"mission\"");
    expect(src).toMatch(/if\(hit\.action==="stopall"\)openStopDialog\(\)/); // STOP_ALL mevcut mekanizmayı yeniden kullanır
  });
});

describe("WP-SHELL-REFINE: no new GET route, static safety, and locale parity", () => {
  it("main.mjs EXTRA_GET_ROUTES is unchanged (no new allow-listed GET was added for this work package)", () => {
    const b = block("B4-ALLOWLIST");
    const m = b.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)!;
    const routes = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort();
    expect(routes).toEqual([
      "/v1/cockpit", "/v1/company/accounts", "/v1/company/contacts", "/v1/company/contracts",
      "/v1/company/invoices", "/v1/company/opportunities", "/v1/company/payments",
      "/v1/evidence", "/v1/missions", "/v1/projects", "/v1/roles", "/v1/work-runs",
    ]);
  });
  it("inspector.js never uses fetch/innerHTML/window.uasco/apiGet/apiPost (reads only through ctx.api)", () => {
    const src = readRend("inspector.js");
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function\s*\(/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src.includes("window.uasco")).toBe(false);
    expect(src).not.toMatch(/\bbridge\b|apiPost|apiGet/);
    expect(src.includes(".post(")).toBe(false);
  });
  it("palette.* and inspector.* keys are identical in TR and EN, and every static key used exists in both", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const subset = (d: Record<string, string>) => flat(d).filter(k => k.startsWith("palette.") || k.startsWith("inspector."));
    expect(subset(tr)).toEqual(subset(en));
    // Dinamik anahtarlar için tam set beklentisi (inspector.kind.*, palette.group.*, palette.kind.*)
    for (const k of ["project", "mission", "run", "role"]) { expect(tr[`inspector.kind.${k}`], k).toBeTruthy(); expect(en[`inspector.kind.${k}`], k).toBeTruthy(); }
    for (const g of ["action", "result"]) { expect(tr[`palette.group.${g}`]).toBeTruthy(); expect(en[`palette.group.${g}`]).toBeTruthy(); }
    for (const kd of ["action", "project", "mission"]) { expect(tr[`palette.kind.${kd}`]).toBeTruthy(); expect(en[`palette.kind.${kd}`]).toBeTruthy(); }
    // shell.js + inspector.js içindeki statik t("...") anahtarlarının tümü her iki sözlükte var
    const src = readRend("shell.js") + "\n" + readRend("inspector.js");
    const used = new Set<string>();
    for (const mm of src.matchAll(/\bt\(\s*"((?:palette|inspector)\.[A-Za-z0-9_.]+)"/g)) used.add(mm[1]);
    expect(used.size).toBeGreaterThan(5);
    for (const k of used) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); }
  });
});

describe("UI-251 Recovery Center: fail-closed core, honest alert panel, retry/home actions, boundary wiring, locale parity", () => {
  const KNOWN = ["home", "work", "delivery"];
  it("core: whitelists route and health, never trusts free text, unknown health is not healthy (fail-closed)", async () => {
    const c = await load("recovery-core.js");
    const m = c.recoveryModel({ reason: "API_DOWN", routeId: "C:\\Users\\x\\secret", health: "weird", knownRouteIds: KNOWN });
    expect(m.routeId).toBe("unknown"); expect(m.health).toBe("UNKNOWN"); expect(m.apiDown).toBe(true); expect(m.pill).toBe("NOT_VERIFIED");
    expect(c.recoveryModel({ reason: "nope", routeId: "work", health: "OFFLINE", knownRouteIds: KNOWN })).toMatchObject({ reason: "VIEW_FAILED", routeId: "work", pill: "OFFLINE", apiDown: true });
    expect(c.recoveryModel({}).routeId).toBe("unknown");
    expect(c.shouldShowApiRecovery("VERIFIED")).toBe(false); expect(c.shouldShowApiRecovery("LOADING")).toBe(false);
    for (const s of ["OFFLINE", "ERROR", "FAILED", "UNAVAILABLE", "garbage", undefined]) expect(c.shouldShowApiRecovery(s), String(s)).toBe(true);
  });
  it("panel: role=alert labelled region, names the failure, diagnostics = route id + health only, buttons have text", async () => {
    const { recoveryPanel } = await load("recovery-panel.js");
    const { ctx, doc } = await mkCtx();
    const p = recoveryPanel(ctx, { routeId: "delivery", health: "OFFLINE", reason: "VIEW_FAILED", titleId: "view-title" });
    doc.body.append(p);
    expect(p.getAttribute("role")).toBe("alert");
    const title = doc.getElementById("view-title")!;
    expect(p.getAttribute("aria-labelledby")).toBe("view-title"); expect(title.tagName).toBe("H2"); expect(title.getAttribute("tabindex")).toBe("-1");
    const txt = text(p);
    expect(txt).toContain("delivery"); expect(txt).toContain("Çevrimdışı");
    expect(within(p).some(n => n.className.startsWith("spill"))).toBe(true);
    const btn = within(p).find(n => n.tagName === "BUTTON")!, link = within(p).find(n => n.tagName === "A")!;
    expect(text(btn).length).toBeGreaterThan(0); expect(text(link).length).toBeGreaterThan(0);
    expect(link.getAttribute("href")).toBe("#/home");
    expect(txt).not.toMatch(/Error:|\bat .*\(|token|\/home\//i);
  });
  it("retry uses ctx.rerender for view failures and ctx.refreshAll for API-down; keyboard-focusable native button", async () => {
    const { recoveryPanel } = await load("recovery-panel.js");
    const { ctx, doc } = await mkCtx();
    const calls: string[] = [];
    ctx.rerender = () => { calls.push("rerender"); }; ctx.refreshAll = (o: any) => { calls.push(`refresh:${o?.force}`); };
    for (const [reason, want] of [["VIEW_FAILED", "rerender"], ["API_DOWN", "refresh:true"]] as const) {
      const p = recoveryPanel(ctx, { routeId: "home", health: "ERROR", reason }); doc.body.append(p);
      const btn = within(p).find(n => n.tagName === "BUTTON")!;
      expect(btn.getAttribute("type")).toBe("button"); btn.focus(); expect(doc.focused).toBe(btn);
      btn.fire("click"); expect(calls.pop()).toBe(want);
    }
  });
  it("planned.js boundary: a throwing view yields the Recovery panel (view-title focus target) instead of propagating", async () => {
    const planned = await load("views", "planned.js");
    const { ctx } = await mkCtx();
    ctx.doc.createElement = ctx.doc.createElement.bind(ctx.doc);
    const node = await planned.render({ ...ctx, api: { health: async () => ({ state: "OFFLINE" }) } }, { id: "delivery", component: "delivery" });
    const alert = within(node).find(n => n.getAttribute("role") === "alert");
    expect(alert).toBeTruthy(); expect(within(node).some(n => n.id === "view-title")).toBe(true);
    expect(text(node)).toContain("delivery");
  });
  it("shell.js shows the panel only through shouldShowApiRecovery; sources avoid innerHTML and the forbidden claim", () => {
    expect(readRend("shell.js")).toContain("shouldShowApiRecovery(data.health.state)");
    for (const f of ["recovery-core.js", "recovery-panel.js"]) {
      const src = readRend(f);
      expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|\bfetch\s*\(|window\.uasco|apiPost/);
      expect(src).not.toMatch(/PRODUCT_VERIFIED|product verified/i);
      expect(src.split("\n")[0].startsWith("// //TR:")).toBe(true);
    }
  });
  it("recovery.* keys are identical in TR and EN with identical placeholders; every static key used exists", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => flat(d).filter(k => k.startsWith("recovery."));
    expect(sub(tr)).toEqual(sub(en)); expect(sub(tr).length).toBeGreaterThan(10);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) expect(ph(tr[k]), k).toBe(ph(en[k]));
    for (const r of ["VIEW_FAILED", "API_DOWN"]) for (const p of ["title", "desc"]) expect(tr[`recovery.${p}.${r}`]).toBeTruthy();
    for (const s of ["VERIFIED", "LOADING", "OFFLINE", "ERROR", "FAILED", "UNAVAILABLE", "UNKNOWN"]) expect(tr[`recovery.health.${s}`]).toBeTruthy();
  });
});
