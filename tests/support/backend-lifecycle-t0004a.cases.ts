// //TR: Bu vaka dosyası (kayıtlı tests/v7-int-r3-desktop.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0004.A A_UI kısmını sınar: masaüstü
// renderer'ı yerel arka ucun (Control API) çöktüğünü / hiç kullanılamadığını / doğrulanamadığını DÜRÜSTÇE gösterir ve güvenli kurtarma yolu sunar. GERÇEK buildServer
// main.mjs köprüsünün aynası üzerinden (belirteçli kimlik kanıtı) ve GERÇEK shell.js createShell/refresh ile sürülür; zamanlayıcılar elle sürülür. Yeni IPC kanalı yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import crypto from "node:crypto";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32);

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

/** Elle sürülen zamanlayıcılar (gerçek bekleme yok). */
class Timers {
  seq = 0; pending: Array<{id: number; fn: () => unknown; ms: number}> = [];
  setTimeout = (fn: () => unknown, ms: number) => { const id = ++this.seq; this.pending.push({id, fn, ms}); return id; };
  clearTimeout = (id: number) => { this.pending = this.pending.filter(p => p.id !== id); };
}

// index.html'deki shell kancaları (korumalı dosya değişmez; aynı kimlikler kurulur). #topbar şeridin konağıdır.
const HOST: Array<[string, string]> = [["header", "topbar"], ["span", "status"], ["span", "bellIcon"], ["button", "stopBtn"], ["button", "stopCancel"], ["dialog", "stopDialog"], ["button", "stopConfirm"], ["button", "resumeBtn"],
  ["button", "refreshBtn"], ["button", "notifyBtn"], ["span", "notifyCount"], ["button", "langBtn"], ["select", "projectSelect"], ["input", "searchInput"], ["ul", "searchResults"], ["ul", "navList"],
  ["span", "ctxTenant"], ["span", "ctxEnv"], ["span", "ctxPrincipal"], ["span", "ctxApi"], ["time", "ctxRefresh"], ["div", "stopBanner"], ["span", "stopBannerText"], ["p", "stopError"],
  ["div", "feedMount"], ["ol", "stripList"], ["span", "stripRun"], ["main", "main"]];
function mountHost(doc: D) {
  for (const [tag, id] of HOST) { const n = new N(doc, tag); n.setAttribute("id", id); doc.body.append(n); }
  const st = new N(doc, "span"); st.className = "stop-text"; doc.getElementById("stopBtn")!.append(st);
  doc.getElementById("searchResults")!.hidden = true;
}

let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
function startServer(token = TOKEN): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const app = buildServer({controlToken: token, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
/** main.mjs köprüsünün aynası: sunucu yoksa (çökmüş) CONTROL_API_UNREACHABLE; varsa belirtece bağlı kimlik kanıtı doğrulanır, sonra GET. */
function mkBridge(holder: {app: App | null}) {
  return {apiGet: async (p: string) => {
    const app = holder.app; if (!app) throw new Error("CONTROL_API_UNREACHABLE");
    const ch = crypto.randomBytes(32).toString("hex"), r0 = await app.inject({method: "GET", url: `/health?challenge=${ch}`, headers: {host: "127.0.0.1:3210"}});
    if (String(r0.json().controlProof) !== controlChallengeProof(TOKEN, ch)) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
    if (p === "/health") return {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"};
    const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}});
    if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json();
  }};
}
async function mkShell(holder: {app: App | null}, lang = "en") {
  const shellMod = await load("shell.js"), apiMod = await load("api.js"), i18n = await load("i18n.js"), routes = await load("routes.js"), st = await load("state.js");
  const doc = new D(); mountHost(doc);
  const timers = new Timers(), loc = {hash: "#/home"};
  doc.defaultView = {location: loc, history: {state: null, replaceState() {}}, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout};
  const store = st.createStore(null), api = apiMod.createApi({bridge: mkBridge(holder), store});
  const t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t, setLang() {}, onChange() { return () => {}; }}, t, principal: "FOUNDER_LOCAL",
    currentRouteId: () => routes.routeFromHash(loc.hash), navigate() {}, selectProject() {}, stop: async () => undefined, resume: async () => undefined};
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {localStorage: {getItem: () => "1", setItem() {}, removeItem() {}}};
  const shell = shellMod.createShell(ctx);
  try { shell.wireStatic(); } finally { (globalThis as any).window = prevWindow; }
  // app.js'teki refreshAll'un aynası (app.js korumalıdır): önbellek temizlenir, shell.refresh gerçek okumaları yapar ve renderAll çağırır.
  ctx.refreshAll = async () => { store.cache.clear(); await shell.refresh(); };
  return {doc, shell, ctx, timers, t};
}
const banner = (doc: D) => doc.getElementById("backendBanner");
const apiText = (doc: D) => doc.getElementById("ctxApi")!.querySelector(".ctx-api-text")!.textContent;
/** Kullanıcı tıklaması deneme sözünü beklemez; denetleyicinin süren denemesi bitene kadar gerçek olay döngüsünde beklenir. */
async function settle(ctx: any) { const {reconnectorFor} = await load("recovery-panel.js"); for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 5)); if (!reconnectorFor(ctx).snapshot().running) return; } throw new Error("retry did not settle"); }
const btn = (root: N, action: string) => all(root).find(n => n.dataset.backendAction === action)!;

export function registerBackendLifecycleT0004aCases(): void {
  describe("UASCO-T0004.A A_UI: honest backend crash / unavailable state in the real shell (real buildServer, manual timers)", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0004a-ui-")); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    it("before the first verified health check nothing claims 'connected'; a backend that never came up is UNAVAILABLE (not 'connection lost')", async () => {
      const holder: {app: App | null} = {app: null};
      const e = await mkShell(holder);
      expect(e.shell.data.backend.status).toBe("CHECKING");
      expect(e.shell.data.backend.runningClaimAllowed).toBe(false);
      expect(banner(e.doc)).toBeNull();
      await e.ctx.refreshAll();
      expect(e.shell.data.backend.status).toBe("UNAVAILABLE");
      const b = banner(e.doc)!;
      expect(b.getAttribute("role")).toBe("alert");
      expect(b.parent!.id).toBe("topbar"); // ana içerik yeniden çizilse de kalır
      expect(b.dataset.backendBanner).toBe("UNAVAILABLE");
      expect(b.textContent).toContain(e.t("backend.title.UNAVAILABLE"));
      expect(b.textContent).toContain(e.t("backend.noAutoRestart"));
      expect(apiText(e.doc)).toBe(e.t("ctx.api.OFFLINE"));
      expect(apiText(e.doc)).not.toContain("Connected");
      expect(e.timers.pending.map(p => p.ms)).toEqual([2000]); // otomatik yeniden bağlanma sekmeden bağımsız planlandı
    });

    it("crash after a verified connection -> CONNECTION_LOST banner + 'Connection lost' chip text + details panel with last verified time; restart + 'Retry now' -> banner removed, CONNECTED, data intact", async () => {
      const holder: {app: App | null} = {app: startServer()};
      const created = await holder.app!.inject({method: "POST", url: "/v1/projects", headers: {"content-type": "application/json", "x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, payload: JSON.stringify({name: "Survives crash", environmentId: "env-dev"})});
      expect(created.statusCode).toBe(201);
      const e = await mkShell(holder);
      await e.ctx.refreshAll();
      expect(e.shell.data.backend.status).toBe("CONNECTED");
      expect(e.shell.data.backend.runningClaimAllowed).toBe(true);
      expect(banner(e.doc)).toBeNull(); // pozitif kontrol: sağlıklıyken şerit yok
      expect(apiText(e.doc)).toBe(e.t("ctx.api.VERIFIED"));
      expect(e.timers.pending).toEqual([]);
      // çökme
      await holder.app!.close(); holder.app = null;
      await e.ctx.refreshAll();
      expect(e.shell.data.backend).toMatchObject({status: "CONNECTION_LOST", everConnected: true, lostCount: 1, runningClaimAllowed: false});
      const b = banner(e.doc)!;
      expect(b.dataset.backendBanner).toBe("CONNECTION_LOST");
      expect(b.textContent).toContain(e.t("backend.title.CONNECTION_LOST"));
      expect(apiText(e.doc)).toBe(e.t("ctx.api.LOST"));
      expect(e.doc.getElementById("status")!.textContent).toBe(e.t("ctx.api.LOST"));
      // "Ayrıntılar": sağlık sekmesindeki Recovery Center yaşam döngüsü bloğuyla açılır
      btn(b, "details").fire("click");
      const feed = e.doc.getElementById("feedMount")!;
      const life = all(feed).find(n => n.dataset.backendLifecycle)!;
      expect(life.dataset.backendLifecycle).toBe("CONNECTION_LOST");
      expect(feed.textContent).toContain(e.t("backend.title.CONNECTION_LOST"));
      expect(feed.textContent).toContain(e.t("backend.diag.lastConnected"));
      expect(feed.textContent).not.toContain(e.t("backend.never"));
      expect(feed.textContent).toContain(e.t("backend.guide.reopen"));
      expect(feed.textContent).toContain("control-api.log");
      // hâlâ kapalıyken "Şimdi yeniden dene": dürüst kalır
      await btn(banner(e.doc)!, "retry").fire("click");
      await settle(e.ctx);
      expect(e.shell.data.backend.status).toBe("CONNECTION_LOST");
      expect(banner(e.doc)).not.toBeNull();
      // yeniden başlatma (aynı veri dizini) + "Şimdi yeniden dene"
      holder.app = startServer();
      await btn(banner(e.doc)!, "retry").fire("click");
      await settle(e.ctx);
      expect(e.shell.data.backend.status).toBe("CONNECTED");
      expect(e.shell.data.backend.recoveredAt).not.toBeNull();
      expect(banner(e.doc)).toBeNull();
      expect(apiText(e.doc)).toBe(e.t("ctx.api.VERIFIED"));
      expect(e.doc.getElementById("status")!.textContent).toBe(e.t("recovery.reconnected"));
      expect(e.timers.pending).toEqual([]); // döngü durdu
      expect((await e.ctx.api.projects()).items.map((x: any) => x.name)).toContain("Survives crash");
    });

    it("after repeated failed checks the banner escalates to 'close and reopen UASCO' (the only path that restarts the backend in this version)", async () => {
      const holder: {app: App | null} = {app: null};
      const e = await mkShell(holder);
      for (let i = 0; i < 3; i++) await e.ctx.refreshAll();
      expect(banner(e.doc)!.dataset.backendEscalate).toBe("false");
      expect(banner(e.doc)!.textContent).not.toContain(e.t("backend.guide.reopen"));
      await e.ctx.refreshAll();
      expect(banner(e.doc)!.dataset.backendEscalate).toBe("true");
      expect(banner(e.doc)!.textContent).toContain(e.t("backend.guide.reopen"));
      expect(e.doc.getElementById("topbar")!.children.filter(n => n.id === "backendBanner")).toHaveLength(1); // çoğalmaz
    });

    it("a process that answers but fails the identity proof is UNVERIFIED, never CONNECTED", async () => {
      const holder: {app: App | null} = {app: startServer("w".repeat(32))};
      const e = await mkShell(holder);
      await e.ctx.refreshAll();
      expect(e.shell.data.backend.status).toBe("UNVERIFIED");
      expect(e.shell.data.backend.runningClaimAllowed).toBe(false);
      expect(banner(e.doc)!.dataset.backendBanner).toBe("UNVERIFIED");
      expect(apiText(e.doc)).toBe(e.t("ctx.api.ERROR"));
    });

    it("Turkish locale: banner text comes from tr.js", async () => {
      const holder: {app: App | null} = {app: null};
      const e = await mkShell(holder, "tr");
      await e.ctx.refreshAll();
      expect(banner(e.doc)!.textContent).toContain("Yerel arka uç kullanılamıyor");
      expect(btn(banner(e.doc)!, "retry").textContent).toBe("Şimdi yeniden dene");
    });
  });

  describe("UASCO-T0004.A backend lifecycle core (pure) + scope guards", () => {
    it("observe(): CHECKING -> LOADING keeps CHECKING -> VERIFIED CONNECTED -> OFFLINE CONNECTION_LOST -> VERIFIED (recoveredAt) ; never-connected OFFLINE is UNAVAILABLE; ERROR/unknown is UNVERIFIED", async () => {
      const c = await load("backend-lifecycle-core.js");
      let clock = Date.parse("2026-11-23T10:00:00.000Z");
      const l = c.createBackendLifecycle({now: () => clock});
      expect(l.snapshot()).toMatchObject({status: "CHECKING", everConnected: false, runningClaimAllowed: false});
      expect(l.observe("LOADING").status).toBe("CHECKING");
      expect(l.observe("VERIFIED")).toMatchObject({status: "CONNECTED", runningClaimAllowed: true, lastConnectedAt: "2026-11-23T10:00:00.000Z", failedChecks: 0});
      expect(l.observe("LOADING").status).toBe("CONNECTED");
      clock += 5000;
      expect(l.observe("OFFLINE")).toMatchObject({status: "CONNECTION_LOST", lostCount: 1, failedChecks: 1, downSince: "2026-11-23T10:00:05.000Z", runningClaimAllowed: false});
      clock += 5000;
      expect(l.observe("OFFLINE")).toMatchObject({status: "CONNECTION_LOST", lostCount: 1, failedChecks: 2, downSince: "2026-11-23T10:00:05.000Z"});
      expect(l.observe("LOADING").status).toBe("CONNECTION_LOST"); // okuma sürerken yükseltilmez
      expect(l.observe("VERIFIED")).toMatchObject({status: "CONNECTED", recoveredAt: "2026-11-23T10:00:10.000Z", downSince: null, failedChecks: 0});
      expect(l.observe("ERROR").status).toBe("UNVERIFIED");
      for (const s of ["FAILED", "UNAVAILABLE", undefined, "HEALTHY", 42]) expect(c.createBackendLifecycle().observe(s).status, String(s)).toBe("UNVERIFIED");
      expect(c.createBackendLifecycle().observe("OFFLINE").status).toBe("UNAVAILABLE");
    });
    it("backendStatusModel: fail-closed on garbage, RECONNECTING only while a retry runs, escalation threshold", async () => {
      const c = await load("backend-lifecycle-core.js");
      for (const bad of [null, undefined, {}, {status: "RUNNING"}, {status: "CONNECTED "}]) expect(c.backendStatusModel(bad)).toMatchObject({status: "CHECKING", down: false, runningClaimAllowed: false, showBanner: false});
      expect(c.backendStatusModel({status: "CONNECTED"})).toMatchObject({runningClaimAllowed: true, showBanner: false, phase: "IDLE"});
      expect(c.backendStatusModel({status: "CONNECTION_LOST", failedChecks: 1}, {running: true})).toMatchObject({phase: "RECONNECTING", escalate: false, showBanner: true});
      expect(c.backendStatusModel({status: "UNAVAILABLE", failedChecks: c.ESCALATE_AFTER_FAILED_CHECKS}, {running: false})).toMatchObject({phase: "WAITING", escalate: true});
    });
    it("scope: no new bridge channel — the lifecycle uses only the existing GET /health; preload exposes no backend-process API; en/tr carry every new key", async () => {
      const core = fs.readFileSync(path.join(REND, "backend-lifecycle-core.js"), "utf8");
      expect(core).not.toMatch(/window\.uasco|ipcRenderer|import\s/);
      const preload = fs.readFileSync(path.join(REPO, "apps", "desktop", "preload.mjs"), "utf8");
      expect(preload).not.toMatch(/backend(State|Status|Restart)|restartBackend/i);
      const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
      const keys = Object.keys(en).filter(k => k.startsWith("backend.") || k === "ctx.api.LOST" || k.startsWith("recovery.auto.") || k === "recovery.reconnected");
      expect(keys.length).toBeGreaterThanOrEqual(24);
      for (const k of keys) { expect(typeof tr[k], k).toBe("string"); expect(tr[k], k).not.toBe(en[k]); }
      for (const s of ["CONNECTION_LOST", "UNAVAILABLE", "UNVERIFIED"]) for (const p of ["backend.title.", "backend.desc.", "backend.state."]) expect(en[p + s], p + s).toBeTruthy();
    });
  });
}
