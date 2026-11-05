// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0005'i sınar: shell/navigasyon kalitesi —
// bilinmeyen hash için dürüst geri dönüş (sessiz Ana sayfa değil), "Ana içeriğe geç" bağlantısının rotayı korulaması, aramadan Tab ile odağın <body>'ye düşmemesi,
// pencere başlığının etkin alanı adlandırması, her renderer hash/navigate hedefinin kayıtlı bir rotaya çözülmesi ve shell'in gerçek buildServer'a karşı okuduğu her /v1 yolunun kayıtlı (2xx) olması.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import crypto from "node:crypto";
import {controlChallengeProof, desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), RECORDER = "implementer@local.invalid";
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const allowBlock = (() => { const a = MAIN_SRC.indexOf("// B4-ALLOWLIST-BEGIN"), b = MAIN_SRC.indexOf("// B4-ALLOWLIST-END"); if (a < 0 || b < 0) throw new Error("main.mjs B4-ALLOWLIST block not found"); return MAIN_SRC.slice(a, b); })();
const desktopExtraGetPathAllowed = new Function(`${allowBlock}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const desktopAllows = (p: string) => desktopGetPathAllowed(p) || desktopExtraGetPathAllowed(p);

// ---------------- minimal DOM (diğer renderer testleriyle aynı desen; odak ve basit seçici destekli) ----------------
type Fn = (e: any) => void;
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = "";
  ls = new Map<string, Fn[]>(); hidden = false; value = ""; disabled = false; open = false;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get isConnected() { let n: N | null = this; while (n) { if (n === this.doc.body) return true; n = n.parent; } return false; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  get firstChild() { return this.children[0] ?? null; }
  append(...n: Array<N | string | null | undefined>) { for (const c of n) { if (c === null || c === undefined) continue; const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.remove(); node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  insertBefore(n: N, ref: N | null) { n.remove(); n.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  replaceChildren(...n: Array<N | string>) { for (const c of this.children) c.parent = null; this.children = []; this._text = ""; this.append(...n); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  getAttribute(k: string) { return k === "class" ? (this.className || null) : this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  addEventListener(ev: string, fn: Fn) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  removeEventListener() { /* test double */ }
  fire(ev: string, e: any = {}) { let prevented = false; for (const fn of this.ls.get(ev) ?? []) fn({preventDefault() { prevented = true; }, currentTarget: this, target: this, ...e}); return prevented; }
  focus() { if (this.isConnected) this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  select() { /* test double */ }
  scrollIntoView() { /* test double */ }
  showModal() { this.open = true; }
  close() { this.open = false; }
  contains(n: N | null) { while (n) { if (n === this) return true; n = n.parent; } return false; }
  querySelector(sel: string) { return all(this).find(match(sel)) ?? null; }
  querySelectorAll(sel: string) { return all(this).filter(match(sel)); }
  get classList() { const s = this; return {add: (c: string) => { s.className = `${s.className} ${c}`.trim(); }, remove: (c: string) => { s.className = s.className.split(/\s+/).filter(x => x !== c).join(" "); }, toggle: () => undefined, contains: (c: string) => s.className.split(/\s+/).includes(c)}; }
}
const match = (sel: string) => (n: N) => sel.startsWith(".") ? n.className.split(/\s+/).includes(sel.slice(1)) : sel.startsWith("#") ? n.id === sel.slice(1) : n.tagName === sel.toUpperCase();
class D {
  body: N; documentElement: N; activeElement: N | null = null; title = "static"; ls = new Map<string, Fn[]>(); defaultView: any = null;
  constructor() { this.body = new N(this, "body"); this.documentElement = new N(this, "html"); this.activeElement = this.body; }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
  querySelector(sel: string) { return this.body.querySelector(sel); }
  querySelectorAll(sel: string) { return this.body.querySelectorAll(sel); }
  addEventListener(ev: string, fn: Fn) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);

// index.html'deki shell kancaları (korumalı dosya değişmez; yalnız aynı kimlikler kurulur)
const HOST: Array<[string, string, string?]> = [["a", "", "skip-link"], ["span", "status"], ["span", "bellIcon"], ["button", "stopBtn"], ["button", "stopCancel"], ["dialog", "stopDialog"], ["button", "stopConfirm"], ["button", "resumeBtn"],
  ["button", "refreshBtn"], ["button", "notifyBtn"], ["span", "notifyCount"], ["button", "langBtn"], ["select", "projectSelect"], ["input", "searchInput"], ["ul", "searchResults"], ["ul", "navList"],
  ["span", "ctxTenant"], ["span", "ctxEnv"], ["span", "ctxPrincipal"], ["span", "ctxApi"], ["time", "ctxRefresh"], ["div", "stopBanner"], ["span", "stopBannerText"], ["p", "stopError"],
  ["div", "feedMount"], ["ol", "stripList"], ["span", "stripRun"], ["main", "main"]];
function mountHost(doc: D) {
  for (const [tag, id, cls] of HOST) { const n = new N(doc, tag); if (id) n.setAttribute("id", id); if (cls) n.className = cls; if (tag === "a") n.setAttribute("href", "#main"); doc.body.append(n); }
  const st = new N(doc, "span"); st.className = "stop-text"; doc.getElementById("stopBtn")!.append(st);
  doc.getElementById("searchResults")!.hidden = true;
}

const PRJ = "prj_" + "a".repeat(24);
async function mkShell(opts: {hash?: string; bridge?: any; lang?: string} = {}) {
  const shellMod = await load("shell.js"), apiMod = await load("api.js"), i18n = await load("i18n.js"), routes = await load("routes.js"), st = await load("state.js");
  const doc = new D(); mountHost(doc);
  const loc = {hash: opts.hash ?? "#/home"}, replaced: string[] = [];
  doc.defaultView = {location: loc, history: {state: null, replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); loc.hash = url; }}};
  const store = st.createStore(null);
  const bridge = opts.bridge ?? {apiGet: async (p: string) => { if (p === "/v1/projects") return {projects: [{projectId: PRJ, name: "P1", tenantId: "tA", environmentId: "dev"}]}; throw new Error(`${p}: HTTP 404`); }};
  const api = apiMod.createApi({bridge, store});
  const lang = opts.lang ?? "en", t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  const nav: string[] = [];
  const ctx: any = {doc, store, api, i18n: {lang, t, setLang() {}, onChange() { return () => {}; }}, t, principal: "FOUNDER_LOCAL",
    currentRouteId: () => routes.routeFromHash(loc.hash), navigate: (id: string) => nav.push(id), selectProject() {}, refreshAll: async () => undefined, stop: async () => undefined, resume: async () => undefined};
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {localStorage: {getItem: () => "1", setItem() {}, removeItem() {}}};
  const shell = shellMod.createShell(ctx);
  try { shell.wireStatic(); } finally { (globalThis as any).window = prevWindow; }
  const main = doc.getElementById("main")!;
  /** app.js renderRoute'un sırası: main.dataset.route + main.replaceChildren(view) + shell.renderNav() (app.js korumalıdır; burada aynı sıra taklit edilir). */
  const renderRoute = () => {
    const id = ctx.currentRouteId(); main.dataset.route = id;
    const view = new N(doc, "section"), title = new N(doc, "h1"); title.setAttribute("id", "view-title"); title.textContent = t(`area.${id}.title`); view.append(title);
    main.replaceChildren(view); shell.renderNav();
  };
  /** hashchange: app.js önce shell.renderNav(), sonra renderRoute çağırır. */
  const go = (hash: string) => { loc.hash = hash; shell.renderNav(); renderRoute(); };
  return {doc, shell, ctx, routes, loc, replaced, nav, main, renderRoute, go, t};
}
const current = (doc: D) => all(doc.getElementById("navList")!).filter(n => n.getAttribute("aria-current") === "page").map(n => n.dataset.route);
const notice = (doc: D) => doc.getElementById("routeNotice");

export function registerShellNavT0005Cases() {
  describe("UASCO-T0005 shell/nav: unknown routes get an honest fallback, never a silent Home", () => {
    it("routes.unknownRouteHash: null for empty/'#'/every registered route (with or without trailing slash); the hash for anything else", async () => {
      const routes = await load("routes.js");
      for (const h of ["", "#", undefined, null]) expect(routes.unknownRouteHash(h)).toBeNull();
      for (const r of routes.ROUTES) { expect(routes.unknownRouteHash(r.hash), r.id).toBeNull(); expect(routes.unknownRouteHash(`${r.hash}/`), r.id).toBeNull(); }
      for (const h of ["#/nope", "#/Work", "#/projects/x", "#main", "#/home/../x", "#/projects?x=1", "#/firstrun"]) expect(routes.unknownRouteHash(h), h).toBe(h);
      expect(routes.unknownRouteHash("#/" + "x".repeat(200)).length).toBe(80); // bildirimde sınırlı uzunluk
      // routeFromHash sözleşmesi değişmez: bilinmeyen hash hâlâ varsayılan rotadır (app.js korumalıdır)
      expect(routes.routeFromHash("#/nope")).toBe(routes.DEFAULT_ROUTE);
    });

    it("hashchange to an unknown hash: URL is normalised to #/home (replaceState), Home is the only active nav item, and a role=status notice names the requested page", async () => {
      const env = await mkShell({hash: "#/projects"});
      env.renderRoute();
      expect(current(env.doc)).toEqual(["projects"]);
      env.go("#/nope");
      expect(env.replaced).toEqual(["#/home"]);
      expect(env.loc.hash).toBe("#/home");
      expect(current(env.doc)).toEqual(["home"]);
      const n = notice(env.doc)!;
      expect(n).toBeTruthy();
      expect(n.getAttribute("role")).toBe("status");
      expect(n.textContent).toContain("#/nope");
      expect(n.textContent).toContain(env.t("route.unknown", {hash: "#/nope"}));
      expect(env.main.children[0]).toBe(n); // görünümün üstünde, ana içerikte
      expect(env.main.querySelector("#view-title")!.textContent).toBe(env.t("area.home.title"));
      // periyodik yeniden çizim (aynı rota): bildirim kaybolmaz ve çoğalmaz
      env.renderRoute(); env.renderRoute();
      expect(env.main.querySelectorAll("#routeNotice").length).toBe(1);
    });

    it("the notice clears on a real navigation and on Dismiss (focus goes to the view title, not <body>)", async () => {
      const env = await mkShell({hash: "#/home"});
      env.renderRoute(); env.go("#/Work");
      expect(notice(env.doc)).toBeTruthy();
      env.go("#/work");
      expect(notice(env.doc)).toBeNull();
      expect(current(env.doc)).toEqual(["work"]);
      env.go("#/bogus");
      const dismiss = notice(env.doc)!.querySelector("button")!;
      expect(dismiss.textContent).toBe(env.t("route.unknownDismiss"));
      dismiss.fire("click");
      expect(notice(env.doc)).toBeNull();
      expect(env.doc.activeElement?.id).toBe("view-title");
      env.renderRoute();
      expect(notice(env.doc)).toBeNull(); // kapatıldıktan sonra geri gelmez
    });

    it("a registered route never shows the notice and never rewrites the URL", async () => {
      const env = await mkShell({hash: "#/home"});
      const routes = env.routes;
      for (const r of routes.ROUTES) { env.go(r.hash); expect(current(env.doc), r.id).toEqual([r.id]); expect(notice(env.doc), r.id).toBeNull(); }
      env.go("#/settings/");
      expect(current(env.doc)).toEqual(["settings"]);
      expect(env.replaced).toEqual([]);
    });
  });

  describe("UASCO-T0005 shell/nav: active route, window title, keyboard focus", () => {
    it("exactly one nav link carries aria-current=page, its href is the route hash, and the document title names the active area (en + tr)", async () => {
      for (const lang of ["en", "tr"]) {
        const env = await mkShell({hash: "#/inbox", lang});
        env.renderRoute();
        const links = all(env.doc.getElementById("navList")!).filter(n => n.tagName === "A");
        expect(links.length).toBe(env.routes.ROUTES.length);
        expect(links.map(a => a.getAttribute("href"))).toEqual(env.routes.ROUTES.map((r: any) => r.hash));
        expect(current(env.doc)).toEqual(["inbox"]);
        expect(env.doc.title).toBe(env.t("route.docTitle", {title: env.t("area.inbox.title")}));
        expect(env.doc.title).toContain("UASCO");
        env.go("#/tower");
        expect(env.doc.title).toBe(env.t("route.docTitle", {title: env.t("area.tower.title")}));
      }
    });

    it("nav labels fit one line (<= 24 chars, en + tr); shortened links keep the full area name in title and aria-label; nav.short keys are in en/tr parity", async () => {
      const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
      const sk = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("nav.short.")).sort();
      for (const lang of ["en", "tr"]) {
        const env = await mkShell({hash: "#/executive", lang});
        env.renderRoute();
        const links = all(env.doc.getElementById("navList")!).filter(n => n.tagName === "A");
        for (const a of links) {
          const id = a.dataset.route!, full = env.t(`area.${id}.title`), shown = a.querySelector(".nav-label")!.textContent;
          expect(shown.length, `${lang} ${id}: ${shown}`).toBeLessThanOrEqual(24);
          expect(a.getAttribute("title"), id).toBe(full);
          if (shown !== full) { expect(a.getAttribute("aria-label"), id).toBe(full); expect(shown).not.toMatch(/^nav\.short\./); }
          else expect(a.getAttribute("aria-label"), id).toBeNull();
        }
        expect(current(env.doc)).toEqual(["executive"]);
        expect(env.main.querySelector("#view-title")!.textContent).toBe(env.t("area.executive.title")); // görünüm başlığı tam ad kalır
      }
      expect(sk(en)).toEqual(sk(tr));
      expect(sk(en).length).toBeGreaterThan(0);
    });

    it("skip link keeps the current route: default hash navigation is prevented and focus moves to <main>", async () => {
      const env = await mkShell({hash: "#/work"});
      env.renderRoute();
      const skip = env.doc.querySelector(".skip-link")!;
      const prevented = skip.fire("click");
      expect(prevented).toBe(true);
      expect(env.loc.hash).toBe("#/work");
      expect(env.doc.activeElement).toBe(env.main);
    });

    it("Tab from the open command palette closes the listbox before focus moves (no focus drop to <body>); the listbox is out of the tab order", async () => {
      const env = await mkShell({hash: "#/home"});
      const inp = env.doc.getElementById("searchInput")!, box = env.doc.getElementById("searchResults")!;
      expect(box.getAttribute("tabindex")).toBe("-1");
      inp.focus(); inp.fire("focus");
      expect(box.hidden).toBe(false);
      const prevented = inp.fire("keydown", {key: "Tab"});
      expect(prevented).toBe(false); // tarayıcının doğal Tab sırası korunur
      expect(box.hidden).toBe(true);
      expect(inp.getAttribute("aria-expanded")).toBe("false");
      // kapalıyken Tab hiçbir şeyi değiştirmez
      expect(inp.fire("keydown", {key: "Tab"})).toBe(false);
    });

    it("nav feed tabs: ArrowRight/ArrowLeft move selection with roving tabindex (single tab stop)", async () => {
      const env = await mkShell({hash: "#/home"});
      env.shell.renderAll();
      const tabs = () => all(env.doc.getElementById("feedMount")!).filter(n => n.getAttribute("role") === "tab");
      expect(tabs().filter(b => b.getAttribute("tabindex") === "0").length).toBe(1);
      tabs()[0].fire("keydown", {key: "ArrowRight"});
      expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
      expect(tabs().filter(b => b.getAttribute("tabindex") === "0").map(b => b.dataset.tab)).toEqual(["health"]);
      tabs()[1].fire("keydown", {key: "ArrowLeft"}); tabs()[0].fire("keydown", {key: "ArrowLeft"});
      expect(tabs().find(b => b.getAttribute("aria-selected") === "true")!.dataset.tab).toBe("agenda");
    });
  });

  describe("UASCO-T0005 static: every renderer route target resolves to a registered route", () => {
    it("every '#/x' literal, navigate(\"x\") call and navigate:\"x\" option in renderer sources names a registered route", async () => {
      const routes = await load("routes.js");
      const files: string[] = [];
      const walk = (d: string) => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".js")) files.push(p); } };
      walk(REND);
      const targets = new Map<string, string>();
      for (const f of files) {
        const src = fs.readFileSync(f, "utf8").split("\n").filter(l => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join("\n"), rel = path.relative(REND, f);
        for (const m of src.matchAll(/["'`]#\/([A-Za-z0-9_-]*)/g)) targets.set(`${rel} #/${m[1]}`, m[1]);
        for (const m of src.matchAll(/navigate\(\s*["']([^"']+)["']\s*\)/g)) targets.set(`${rel} navigate(${m[1]})`, m[1]);
        for (const m of src.matchAll(/navigate\s*:\s*["']([^"']+)["']/g)) targets.set(`${rel} navigate:${m[1]}`, m[1]);
      }
      expect(targets.size).toBeGreaterThan(20);
      const dead = [...targets].filter(([, id]) => !routes.routeById(id)).map(([k]) => k);
      expect(dead).toEqual([]);
    });
  });

  // ---------------- gerçek buildServer: shell'in her /v1 okuması kayıtlı bir sunucu rotasına çözülür ----------------
  let tmp = "";
  const apps: Array<ReturnType<typeof buildServer>> = [];
  describe("UASCO-T0005 shell -> real buildServer: every shell /v1 read is allow-listed and registered (2xx), nav reflects real data", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0005-")); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    it("shell.refresh() against the real server: no 404/refused path, projects count badge comes from the real cockpit, active route + title stay correct", async () => {
      const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
      fs.mkdirSync(runtime, {recursive: true});
      const ws = new WorkOsStore(dataDir);
      const p = ws.createProject({tenantId: "tA", orgId: "org1", name: "T0005 project", environmentId: "env-dev", createdBy: RECORDER});
      ws.createMission({tenantId: "tA", projectId: p.projectId, title: "T0005 mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
      const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
      apps.push(app);
      const seen: Array<{path: string; status: number}> = [], refused: string[] = [];
      const bridge = {apiGet: async (pth: string) => {
        if (!desktopAllows(pth)) { refused.push(pth); throw new Error("INVALID_API_PATH"); }
        if (pth === "/health") {
          const challenge = crypto.randomBytes(32).toString("hex"), r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
          expect(String(r.json().controlProof)).toBe(controlChallengeProof(TOKEN, challenge));
          seen.push({path: pth, status: r.statusCode}); return {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"};
        }
        const r = await app.inject({method: "GET", url: pth, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}});
        seen.push({path: pth, status: r.statusCode});
        if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${pth}: HTTP ${r.statusCode}`);
        return r.json();
      }};
      const env = await mkShell({hash: "#/projects", bridge});
      const ok = await env.shell.refresh();
      expect(ok).toBe(true);
      env.renderRoute();
      expect(refused).toEqual([]);
      const bad = seen.filter(s => s.status < 200 || s.status > 299).map(s => `${s.path} -> ${s.status}`);
      expect(bad).toEqual([]);
      const reads = [...new Set(seen.map(s => s.path.replace(/\?.*$/, "")))];
      for (const r of ["/health", "/v1/projects", "/v1/cockpit", "/v1/missions"]) expect(reads, r).toContain(r);
      expect(current(env.doc)).toEqual(["projects"]);
      const projLink = all(env.doc.getElementById("navList")!).find(n => n.tagName === "A" && n.dataset.route === "projects")!;
      const badge = projLink.querySelector(".nav-count")!;
      expect(badge.hidden).toBe(false);
      expect(badge.textContent).toBe("1");
      expect(badge.getAttribute("aria-label")).toBe(env.t("nav.count", {n: 1}));
      expect(env.doc.title).toBe(env.t("route.docTitle", {title: env.t("area.projects.title")}));
      expect(notice(env.doc)).toBeNull();
    });
  });
}
