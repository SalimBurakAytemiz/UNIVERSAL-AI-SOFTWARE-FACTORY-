// //TR: Bu test B4 premium Desktop shell'inin saf fonksiyonlarını (i18n anahtar eşitliği, route tablosu, KPI/durum biçimleyici, cockpit sözleşme eşleyicisi, GET allow-list) ve statik güvenlik/a11y özelliklerini (CSP, landmark, skip link, ACİL DURDUR, inline script yokluğu) jsdom olmadan doğrular.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const desk = path.join(root, "apps", "desktop");
const rend = path.join(desk, "renderer");
const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(...p)).href);
const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

const code = (src: string) => src.split(/\r?\n/).filter(l => !l.startsWith("//")).join("\n");
const FACTORY =["home", "projects", "work", "workforce", "assurance", "delivery", "tower", "inbox"];

describe("B4 i18n", () => {
  it("tr and en have identical keys and no empty values", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    for (const dict of [tr, en]) for (const [k, v] of Object.entries(dict)) { expect(typeof v, k).toBe("string"); expect(v.trim().length, k).toBeGreaterThan(0); }
    for (const k of Object.keys(tr)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      expect(ph(en[k]), `placeholders ${k}`).toBe(ph(tr[k]));
    }
  });
  it("defaults to tr, falls back to tr then key, interpolates, and persists language with try/catch", async () => {
    const i18n = await load(rend, "i18n.js");
    expect(i18n.DEFAULT_LANG).toBe("tr");
    expect(i18n.translate("tr", "stop.button")).toBe("ACİL DURDUR");
    expect(i18n.translate("en", "stop.button")).not.toBe("ACİL DURDUR");
    expect(i18n.translate("en", "no.such.key")).toBe("no.such.key");
    expect(i18n.translate("tr", "route.announce", {title: "X"})).toContain("X");
    const mem = new Map<string, string>();
    const storage = {getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }};
    const a = i18n.createI18n(storage);
    expect(a.lang).toBe("tr");
    a.setLang("en");
    expect(i18n.createI18n(storage).lang).toBe("en");
    const broken = {getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }};
    const b = i18n.createI18n(broken);
    expect(b.lang).toBe("tr");
    expect(() => b.setLang("en")).not.toThrow();
  });
  it("every dynamic and static key used by the renderer exists in the dictionary", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const routes = await load(rend, "routes.js");
    const need = new Set<string>();
    for (const r of routes.ROUTES) { need.add(`area.${r.id}.title`); need.add(`area.${r.id}.desc`); if (r.plannedPackage || r.view === "planned") for (const i of [1, 2, 3]) need.add(`area.${r.id}.plan${i}`); }
    for (const k of ["LOADING", "EMPTY", "STALE", "OFFLINE", "ERROR", "UNVERIFIED", "VERIFIED"]) need.add(`chip.${k}`);
    for (const k of ["LOADING", "EMPTY", "VERIFIED", "STALE", "UNAVAILABLE", "ERROR", "OFFLINE"]) need.add(`state.${k}`);
    for (const k of ["VERIFIED", "LOADING", "OFFLINE", "ERROR"]) need.add(`ctx.api.${k}`);
    for (const k of ["flow", "health", "agenda"]) need.add(`feed.tab.${k}`);
    for (const k of ["route", "project", "mission"]) need.add(`search.kind.${k}`);
    for (const k of walk(rend).filter(f => f.endsWith(".js") && !f.includes("locales"))) {
      const src = fs.readFileSync(k, "utf8");
      for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:|hintKey:|text:ctx\.t\()\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
      for (const m of src.matchAll(/"((?:kpi|map|home|work|inbox|tower|stop|feed|strip|search|ctx|settings|shortcut|projects|workforce|planned|tile|spark|cockpit|attention|notify|lang|nav|skip|action|empty|brand|app|route)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    }
    const html = read(rend, "index.html");
    for (const m of html.matchAll(/data-i18n(?:-aria|-placeholder|-title)?="([^"]+)"/g)) need.add(m[1]);
    const missing = [...need].filter(k => !(k in tr) && !/[${]/.test(k));
    expect(missing).toEqual([]);
  });
});

describe("B4 routes and navigation", () => {
  it("has the 8 Factory areas in order, then Company OS and Settings, each with route, hash, labels", async () => {
    const routes = await load(rend, "routes.js");
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    expect(routes.FACTORY_AREA_ORDER).toEqual(FACTORY);
    expect(routes.ROUTES.map((r: any) => r.id)).toEqual([...FACTORY, "company", "settings"]);
    for (const r of routes.ROUTES) {
      expect(r.hash).toBe(`#/${r.id}`);
      expect(routes.routeFromHash(r.hash)).toBe(r.id);
      expect(tr[`area.${r.id}.title`]).toBeTruthy();
      expect(en[`area.${r.id}.title`]).toBeTruthy();
      if (r.view === "planned") expect(r.plannedPackage, r.id).toMatch(/^B\d+$/);
    }
    expect(tr["area.home.title"]).toContain("Ana Sayfa");
    expect(tr["area.work.title"]).toContain("Work OS");
    expect(tr["area.workforce.title"]).toBe("AI İş Gücü");
    expect(tr["area.assurance.title"]).toContain("Güvence");
    expect(tr["area.delivery.title"]).toContain("Teslimat");
    expect(tr["area.inbox.title"]).toContain("Gelen Kutusu");
  });
  it("unknown or malformed hashes fall back to the default route", async () => {
    const routes = await load(rend, "routes.js");
    for (const h of ["", "#", "#/evil", "#/home/../x", "#/HOME", undefined, null, "#/projects?x=1"]) expect(routes.routeFromHash(h)).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/projects")).toBe("projects");
    expect(routes.routeFromHash("#/projects/")).toBe("projects");
  });
  it("every route resolves to an existing view module (nothing silently disabled)", async () => {
    const routes = await load(rend, "routes.js");
    const app = read(rend, "app.js");
    for (const r of routes.ROUTES) {
      expect(fs.existsSync(path.join(rend, "views", `${r.view}.js`)), r.id).toBe(true);
      expect(app).toContain(`import * as ${r.view} from "./views/${r.view}.js"`);
    }
  });
});

describe("B4 KPI / state model", () => {
  it("formatCount never renders a number for missing, null, negative, fractional or string input", async () => {
    const m = await load(rend, "model.js");
    for (const v of [undefined, null, NaN, -1, 1.5, "3", {}, [], Infinity]) expect(m.formatCount(v)).toBe("—");
    expect(m.formatCount(0)).toBe("0");
    expect(m.formatCount(7)).toBe("7");
  });
  it("404/501 map to UNAVAILABLE, network to OFFLINE, other HTTP to ERROR", async () => {
    const m = await load(rend, "model.js");
    expect(m.classifyFailure(new Error("/v1/cockpit: HTTP 404")).state).toBe("UNAVAILABLE");
    expect(m.classifyFailure(new Error("x: HTTP 501")).state).toBe("UNAVAILABLE");
    expect(m.classifyFailure(new Error("x: HTTP 500")).state).toBe("ERROR");
    expect(m.classifyFailure(new Error("fetch failed")).state).toBe("OFFLINE");
    expect(m.classifyFailure(new Error("BRIDGE_UNAVAILABLE")).state).toBe("OFFLINE");
    expect(m.classifyFailure("odd").state).toBe("ERROR");
  });
  it("emptyCockpit (404) carries no numbers anywhere", async () => {
    const m = await load(rend, "model.js");
    const c = m.emptyCockpit("UNAVAILABLE");
    for (const b of [c.projects, c.missions, c.approvals, c.orchestrator, c.workforce, c.alerts]) { expect(b.state).toBe("UNAVAILABLE"); expect(b.value).toBeNull(); expect(m.formatCount(b.value)).toBe("—"); }
    expect(c.workforce.registeredRoles).toBeNull();
    expect(c.workforce.targetRoles).toBeNull();
    expect(c.workforce.activeWorkerRuns).toBeNull();
    expect(c.approvals.items).toEqual([]);
    expect(c.legacySchedulerAuthority).toBe(false);
  });
  it("mapCockpit follows the GET /v1/cockpit contract", async () => {
    const m = await load(rend, "model.js");
    const raw = {
      generatedAt: "2026-10-14T10:00:00.000Z", globalStop: {active: true, reason: "founder"},
      projects: {state: "VERIFIED", count: 2},
      missions: {state: "VERIFIED", total: 5, byStatus: {DRAFT: 3, BLOCKED: 1, FOUNDER_ATTENTION_REQUIRED: 1}},
      awaitingApproval: {state: "VERIFIED", items: [{missionId: "msn_" + "a".repeat(24), projectId: "prj_" + "b".repeat(24), title: "T", riskLevel: "R2"}]},
      orchestrator: {state: "STALE", asOf: "2026-10-13T00:00:00.000Z", packages: {total: 9, byStatus: {MERGED: 7, PENDING: 2}}, source: "ORCHESTRATOR_STATE"},
      workforce: {state: "VERIFIED", registeredRoles: 12, targetRoles: 599, activeWorkerRuns: 0, source: "AGENT_REGISTRY"},
      legacy: {scheduler: {authority: true, note: "must be ignored"}}
    };
    const c = m.mapCockpit(raw);
    expect(c.projects.value).toBe(2);
    expect(c.missions.value).toBe(5);
    expect(c.missions.byStatus).toEqual({DRAFT: 3, BLOCKED: 1, FOUNDER_ATTENTION_REQUIRED: 1});
    expect(c.approvals.value).toBe(1);
    expect(c.approvals.items[0].riskLevel).toBe("R2");
    expect(c.orchestrator.state).toBe("STALE");
    expect(c.orchestrator.value).toBe(9);
    expect(c.orchestrator.asOf).toBe("2026-10-13T00:00:00.000Z");
    expect(c.workforce.registeredRoles).toBe(12);
    expect(c.workforce.targetRoles).toBe(599);
    expect(c.workforce.activeWorkerRuns).toBe(0);
    expect(c.alerts.value).toBe(3);
    expect(c.globalStop.active).toBe(true);
    expect(c.legacySchedulerAuthority).toBe(false);
  });
  it("mapCockpit drops numbers from UNAVAILABLE/ERROR blocks, invalid values and malformed input", async () => {
    const m = await load(rend, "model.js");
    const c = m.mapCockpit({
      projects: {state: "UNAVAILABLE", count: 4}, missions: {state: "ERROR", total: 9, byStatus: {DRAFT: 9}},
      awaitingApproval: {state: "UNAVAILABLE", items: [{missionId: "msn_x"}]},
      orchestrator: {state: "UNAVAILABLE", packages: {total: 3}}, workforce: {state: "UNAVAILABLE", registeredRoles: 5, targetRoles: 599, activeWorkerRuns: 2}
    });
    expect(c.projects.value).toBeNull();
    expect(c.missions.value).toBeNull();
    expect(c.missions.byStatus).toEqual({});
    expect(c.approvals.value).toBeNull();
    expect(c.approvals.items).toEqual([]);
    expect(c.orchestrator.value).toBeNull();
    expect(c.workforce.registeredRoles).toBeNull();
    expect(c.workforce.activeWorkerRuns).toBeNull();
    expect(c.alerts.value).toBeNull();
    const bad = m.mapCockpit({projects: {state: "VERIFIED", count: "7"}, missions: {state: "MADE_UP", total: 3}});
    expect(bad.projects.value).toBeNull();
    expect(bad.missions.state).toBe("ERROR");
    expect(bad.missions.value).toBeNull();
    for (const junk of [null, undefined, 3, "x", []]) expect(m.mapCockpit(junk).projects.value).toBeNull();
  });
  it("registered roles and active workers are separate fields", async () => {
    const m = await load(rend, "model.js");
    const c = m.mapCockpit({workforce: {state: "VERIFIED", registeredRoles: 599, targetRoles: 599, activeWorkerRuns: null, source: "S"}});
    expect(c.workforce.registeredRoles).toBe(599);
    expect(c.workforce.activeWorkerRuns).toBeNull();
    const comp = read(rend, "views", "home.js");
    expect(comp).toContain("duo-registered");
    expect(comp).toContain("duo-active");
  });
  it("chip kinds follow DSK-061-08 and sparkline needs two real samples", async () => {
    const m = await load(rend, "model.js");
    expect(m.CHIP_KINDS).toEqual(["LOADING", "EMPTY", "STALE", "OFFLINE", "ERROR", "UNVERIFIED", "VERIFIED"]);
    expect(m.chipFor(null)).toBe("LOADING");
    expect(m.chipFor({loading: true, state: "VERIFIED", value: 3})).toBe("LOADING");
    expect(m.chipFor({state: "VERIFIED", value: 0})).toBe("EMPTY");
    expect(m.chipFor({state: "VERIFIED", value: 2})).toBe("VERIFIED");
    expect(m.chipFor({state: "STALE", value: 2})).toBe("STALE");
    expect(m.chipFor({state: "UNAVAILABLE", value: null})).toBe("UNVERIFIED");
    expect(m.chipFor({state: "OFFLINE"})).toBe("OFFLINE");
    expect(m.chipFor({state: "ERROR"})).toBe("ERROR");
    expect(m.sparkPoints([])).toBe("");
    expect(m.sparkPoints([4])).toBe("");
    expect(m.sparkPoints([1, 3, 2]).split(" ").length).toBe(3);
    expect(m.pushSample([1], null)).toEqual([1]);
    expect(m.pushSample([1], 2)).toEqual([1, 2]);
  });
  it("projects/missions mappers keep only valid records", async () => {
    const m = await load(rend, "model.js");
    expect(m.mapProjects({}).state).toBe("ERROR");
    expect(m.mapProjects({projects: [{projectId: "prj_1", name: "A"}, {name: "no id"}]}).items.length).toBe(1);
    expect(m.mapMissions({missions: [{missionId: "msn_1", createdAt: "2026-01-01T00:00:00.000Z"}, {missionId: "msn_2", createdAt: "2026-02-01T00:00:00.000Z"}]}).items[0].missionId).toBe("msn_2");
  });
});

describe("B4 store (project switch invalidates)", () => {
  it("changing the project clears the cache, bumps the epoch and persists; invalid ids are rejected", async () => {
    const st = await load(rend, "state.js");
    const mem = new Map<string, string>();
    const store = st.createStore({getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }});
    const id = "prj_" + crypto.randomBytes(12).toString("hex");
    store.cache.set("/v1/missions", {at: 1, promise: Promise.resolve(1)});
    const e0 = store.epoch;
    let notified = 0;
    store.onChange(() => { notified++; });
    expect(store.selectProject(id)).toBe(true);
    expect(store.cache.size).toBe(0);
    expect(store.epoch).toBe(e0 + 1);
    expect(notified).toBe(1);
    expect(mem.get(st.PROJECT_STORAGE_KEY)).toBe(id);
    expect(store.selectProject(id)).toBe(false);
    expect(store.selectProject("not-a-project")).toBe(true);
    expect(store.projectId).toBeNull();
  });
});

describe("B4 GET bridge allow-list", () => {
  it("allows only the fixed B4 routes with strict id patterns and rejects everything else", async () => {
    const a = await load(desk, "get-allowlist.mjs");
    const pid = "prj_" + crypto.randomBytes(12).toString("hex");
    const mid = "msn_" + crypto.randomBytes(12).toString("hex");
    for (const ok of ["/v1/cockpit", "/v1/projects", "/v1/missions", `/v1/missions?projectId=${pid}`, `/v1/missions/${mid}`]) expect(a.desktopExtraGetPathAllowed(ok), ok).toBe(true);
    for (const bad of ["/v1/evil", "/v1/cockpit/", "/v1/cockpit?x=1", "/v1/missions?projectId=x", `/v1/missions?projectId=${pid}&x=1`, `/v1/missions/${mid}/transition`, `/v1/missions/${mid}/../x`,
      "/v1/missions/msn_zz", "http://evil.invalid/v1/cockpit", "//evil/v1/cockpit", "/v1/control/stop", "/v1/control/resume", "", "/", "v1/cockpit", "/v1/cockpit\n", "/v1/cockpit%2f..", "/v1/" + "a".repeat(200)])
      expect(a.desktopExtraGetPathAllowed(bad), JSON.stringify(bad)).toBe(false);
    for (const nonString of [undefined, null, 1, {}, [], ["/v1/cockpit"]]) expect(a.desktopExtraGetPathAllowed(nonString)).toBe(false);
  });
  it("main wires the allow-list on the IPC GET handler, keeps the sender check, and never exposes the token to the renderer", () => {
    const main = read(desk, "main.mjs");
    const preload = read(desk, "preload.mjs");
    expect(main).toContain('from "./get-allowlist.mjs"');
    expect(main).toMatch(/uasco:api-get",async\(event,p\)=>\{requireTrustedSender\(event\);if\(!desktopGetPathAllowed\(p\)&&!desktopExtraGetPathAllowed\(p\)\)throw/);
    expect(main).toContain("x-uasco-control-token");
    expect(main).toContain("UNTRUSTED_IPC_SENDER");
    expect(code(preload)).not.toMatch(/token|process\.env/i);
    expect(preload).not.toContain("ipcRenderer.send");
    for (const f of walk(rend).filter(x => x.endsWith(".js") || x.endsWith(".html"))) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toContain("x-uasco-control-token");
      expect(s, f).not.toContain("UASCO_CONTROL_TOKEN");
      expect(s, f).not.toMatch(/\bfetch\s*\(/);
      expect(s, f).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    }
  });
  it("renderer api only issues GET paths the main process allows", async () => {
    const a = await load(desk, "get-allowlist.mjs");
    const boundary = await load(root, "automation", "lib", "control-boundary.mjs");
    const api = await load(rend, "api.js");
    const st = await load(rend, "state.js");
    const calls: string[] = [];
    const bridge = {apiGet: async (p: string) => { calls.push(p); throw new Error(`${p}: HTTP 404`); }};
    const store = st.createStore(null);
    store.selectProject("prj_" + "0".repeat(24));
    const client = api.createApi({bridge, store});
    await Promise.all([client.cockpit(), client.projects(), client.missions(), client.control(), client.attention(), client.health(), client.runs(), client.runEvents("RUN-abc-1"), client.runEvents("../x")]);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const p of calls) expect(boundary.desktopGetPathAllowed(p) || a.desktopExtraGetPathAllowed(p), p).toBe(true);
    const r = await client.cockpit();
    expect(r.state).toBe("UNAVAILABLE");
    expect(r.data.projects.value).toBeNull();
    const noBridge = api.createApi({bridge: undefined, store: st.createStore(null)});
    expect((await noBridge.cockpit()).state).toBe("OFFLINE");
  });
});

describe("B4 index.html (static)", () => {
  const html = read(rend, "index.html");
  it("keeps lang=tr, CSP no looser than before, and has no inline script/style or event handlers", () => {
    expect(html).toMatch(/<html lang="tr">/);
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).toBe("default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|http:|https:/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) { expect(s[1]).toMatch(/\bsrc="\.\/[a-z]+\.js"/); expect(s[2].trim()).toBe(""); }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/(?:src|href)="https?:/i);
  });
  it("has landmarks, a skip link targeting main, a live status region and an accessible stop dialog", () => {
    expect(html).toMatch(/<a class="skip-link" href="#main"/);
    expect(html).toMatch(/<header\b/);
    expect(html).toMatch(/<nav\b[^>]*data-i18n-aria="nav\.label"/);
    expect(html).toMatch(/<main\b[^>]*id="main"/);
    expect(html).toMatch(/<aside\b/);
    expect(html).toMatch(/<footer\b/);
    expect(html).toMatch(/role="search"/);
    expect(html).toMatch(/id="status"[^>]*role="status"[^>]*aria-live="polite"|id="status"[^>]*aria-live="polite"[^>]*role="status"|role="status"[^>]*aria-live="polite"[^>]*id="status"/);
    expect(html).toMatch(/<dialog id="stopDialog"[^>]*aria-labelledby="stopDialogTitle"[^>]*aria-describedby="stopDialogDesc"/);
    expect(html).toMatch(/id="stopBanner" role="alert"/);
    expect(html).toContain("Ctrl K");
  });
  it("has the context bar controls and the always-present ACİL DURDUR control inside the top bar", () => {
    for (const id of ["ctxTenant", "projectSelect", "ctxEnv", "ctxPrincipal", "ctxApi", "ctxRefresh", "stopBtn", "resumeBtn", "stopConfirm", "stopCancel", "searchInput"]) expect(html, id).toContain(`id="${id}"`);
    const top = /<header class="topbar"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(top).toContain('id="stopBtn"');
    expect(top).toContain('data-i18n="stop.button"');
    const css = read(rend, "styles.css");
    const stopRules = css.split("}").filter(r => /\.btn-stop|\.actions|\.topbar/.test(r));
    for (const r of stopRules) expect(r, r).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
    expect(css).not.toMatch(/\.btn-stop[^{]*\{[^}]*display\s*:\s*none/);
  });
  it("every data-i18n attribute value exists in both dictionaries", async () => {
    const tr = (await load(rend, "locales", "tr.js")).default as Record<string, string>;
    const en = (await load(rend, "locales", "en.js")).default as Record<string, string>;
    const keys = [...html.matchAll(/data-i18n(?:-aria|-placeholder|-title)?="([^"]+)"/g)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(en[k], k).toBeTruthy(); }
  });
});

describe("B4 renderer safety and a11y (static)", () => {
  const files = walk(rend).filter(f => f.endsWith(".js"));
  it("never uses innerHTML/outerHTML/insertAdjacentHTML/eval/document.write", () => {
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/);
    }
  });
  it("app.js keeps the legacy-selftest markers and wires stop/resume to the existing IPC", () => {
    const app = read(rend, "app.js");
    expect(app).toContain("replaceChildren");
    expect(app).toContain("window.uasco.stop(");
    expect(app).toContain("window.uasco.resume(");
    expect(app).toContain("if(x.retryable===true)");
    expect(app).not.toContain("QUOTA_EXHAUSTED");
    const shell = read(rend, "shell.js");
    expect(shell).toContain('showModal');
    expect(shell).toContain("ctx.stop()");
    expect(shell).toMatch(/key\.toLowerCase\(\)==="k"/);
    expect(shell).toMatch(/e\.key==="Escape"/);
    expect(shell).toContain("aria-current");
  });
  it("styles define focus-visible, reduced-motion, forced-colors, and responsive breakpoints", () => {
    const css = read(rend, "styles.css");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion:reduce");
    expect(css).toContain("forced-colors:active");
    expect(css).toMatch(/\.sr-only/);
    expect(css).toMatch(/\.skip-link/);
    expect(css).toMatch(/max-width:1100px/);
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/);
  });
  it("key text/background token pairs meet WCAG AA contrast (>= 4.5:1)", () => {
    const css = read(rend, "styles.css");
    const tok = (n: string) => new RegExp(`--${n}:(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? "";
    const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const pairs: [string, string][] = [["text", "bg"], ["text", "surface"], ["text", "surface-2"], ["muted", "bg"], ["muted", "surface"], ["muted", "surface-2"], ["muted", "bg-2"], ["accent", "bg"], ["accent", "surface"], ["on-danger", "danger-bg"], ["danger", "bg-2"], ["ok", "bg-2"], ["warn", "bg-2"], ["accent-2", "bg-2"]];
    for (const [fg, bg] of pairs) { expect(tok(fg), fg).toMatch(/^#/); expect(tok(bg), bg).toMatch(/^#/); expect(ratio(tok(fg), tok(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5); }
  });
  it("planned areas render an honest planned-package panel; no fake agent counts in sources", () => {
    const comp = read(rend, "components.js");
    expect(comp).toContain("plannedPanel");
    for (const f of files) {
      const s = code(fs.readFileSync(f, "utf8"));
      if (f.includes("locales")) continue;
      expect(s, f).not.toMatch(/\b(599|1[0-9]{3})\b\s*(agents|ajan)/i);
    }
  });
});
