// //TR: Bu vaka dosyası (kayıtlı tests/v7-int-r3-desktop.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0004.A'yı sınar: Control API çöktüğünde Recovery Center
// otomatik yeniden bağlanmayı üstel beklemeyle (2/4/8/16/30 sn) planlar ve gösterir; GERÇEK buildServer kapatılıp aynı veri diziniyle yeniden başlatılınca döngü sağlığı GET /health'ten okur,
// bir kez "yeniden bağlandı" bildirir ve durur; veri korunur. Zamanlayıcılar elle sürülür (gerçek bekleme yok).
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

class N {
  tagName: string; children: N[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: unknown) => unknown>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string | null | undefined>) { for (const c of n) { if (c === null || c === undefined) continue; this.children.push(typeof c === "string" ? this.doc.createTextNode(c) : c); } }
  appendChild(n: N) { this.append(n); return n; }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: unknown) => unknown) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  async fire(ev: string) { for (const fn of this.ls.get(ev) ?? []) await fn({preventDefault() {}}); }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
/** Elle sürülen zamanlayıcılar: planlananlar sırayla tutulur, run() en eskisini çalıştırır. */
class Timers {
  seq = 0; pending: Array<{id: number; fn: () => unknown; ms: number}> = []; cancelled: number[] = [];
  setTimeout = (fn: () => unknown, ms: number) => { const id = ++this.seq; this.pending.push({id, fn, ms}); return id; };
  clearTimeout = (id: number) => { this.cancelled.push(id); this.pending = this.pending.filter(p => p.id !== id); };
  async run() { const p = this.pending.shift(); if (!p) throw new Error("no pending timer"); await p.fn(); return p.ms; }
}
class D {
  status: N; defaultView: any; constructor(public timers: Timers) { this.status = new N(this, "p"); this.status.setAttribute("id", "status"); this.defaultView = {setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout}; }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return id === "status" ? this.status : null; }
}
const byData = (n: N, k: string) => n.all().find(x => k in x.dataset);

let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
function startServer(): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
/** main.mjs köprüsünün aynası: sunucu yoksa (çökmüş) CONTROL_API_UNREACHABLE; varsa belirtece bağlı kimlik doğrulaması ve GET. */
function mkBridge(holder: {app: App | null}) {
  const calls: string[] = [];
  return {calls, bridge: {apiGet: async (p: string) => {
    calls.push(p);
    const app = holder.app; if (!app) throw new Error("CONTROL_API_UNREACHABLE");
    const ch = crypto.randomBytes(32).toString("hex"), r0 = await app.inject({method: "GET", url: `/health?challenge=${ch}`, headers: {host: "127.0.0.1:3210"}});
    if (String(r0.json().controlProof) !== controlChallengeProof(TOKEN, ch)) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
    if (p === "/health") return {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"};
    const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}});
    if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json();
  }}};
}
/** Kabuğun yaptığını taklit eder: refreshAll sağlığı okur; düşükse Recovery panelini yeniden çizer (shell.js renderFeed ile aynı koşul). */
async function mkCtx(holder: {app: App | null}, lang = "en", withLocale = true) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), panelMod = await load("recovery-panel.js"), core = await load("recovery-core.js");
  const timers = new Timers(), doc = new D(timers), store = st.createStore(null), {bridge, calls} = mkBridge(holder);
  let clock = Date.parse("2026-11-05T12:00:00.000Z");
  const t = withLocale ? (k: string, v?: unknown) => i18n.translate(lang, k, v) : (k: string) => k;
  const ctx: any = {doc, t, i18n: {lang, t}, api: apiMod.createApi({bridge, store, now: () => clock}), now: () => clock, panel: null as N | null, refreshes: 0,
    async refreshAll() { ctx.refreshes++; store.cache.clear(); const h = await ctx.api.health(); ctx.panel = core.shouldShowApiRecovery(h.state) ? panelMod.recoveryPanel(ctx, {routeId: "home", health: h.state, reason: "API_DOWN"}) : null; }};
  return {ctx, timers, calls, panelMod, core, advance: (ms: number) => { clock += ms; }};
}

export function registerBackendReconnectT0004aCases(): void {
  describe("UASCO-T0004.A backend crash/restart: Recovery Center auto-reconnect (real buildServer, manual timers)", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0004a-")); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    it("crash -> panel shows the countdown; retries back off 2 -> 4 -> 8 s while down; restart on the same data -> one 'reconnected' announcement, loop stops, data intact", async () => {
      const holder: {app: App | null} = {app: startServer()};
      const before = await holder.app!.inject({method: "POST", url: "/v1/projects", headers: {"content-type": "application/json", "x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, payload: JSON.stringify({name: "Survives restart", environmentId: "env-dev"})});
      expect(before.statusCode).toBe(201);
      const e = await mkCtx(holder);
      await e.ctx.refreshAll();
      expect(e.ctx.panel).toBeNull(); // sağlıklı: panel yok, döngü yok (pozitif kontrol)
      expect(e.timers.pending).toEqual([]);
      // çökme
      await holder.app!.close(); holder.app = null;
      await e.ctx.refreshAll();
      const p1: N = e.ctx.panel;
      expect(p1.dataset.recovery).toBe("API_DOWN");
      expect(byData(p1, "recoveryAuto")!.dataset).toMatchObject({recoveryAuto: "scheduled", recoveryAttempt: "1", recoveryInSeconds: "2"});
      expect(p1.textContent).toContain("Automatic retry 1 in 2 s");
      expect(e.timers.pending.map(p => p.ms)).toEqual([2000]);
      // yeniden çizim (ör. periyodik yenileme) ikinci zamanlayıcı kurmaz
      await e.ctx.refreshAll();
      expect(e.timers.pending.map(p => p.ms)).toEqual([2000]);
      // hâlâ kapalı: 2 s -> 4 s -> 8 s
      e.advance(2000); expect(await e.timers.run()).toBe(2000);
      expect(e.timers.pending.map(p => p.ms)).toEqual([4000]);
      expect(byData(e.ctx.panel, "recoveryAuto")!.dataset.recoveryAttempt).toBe("2");
      e.advance(4000); expect(await e.timers.run()).toBe(4000);
      expect(e.timers.pending.map(p => p.ms)).toEqual([8000]);
      expect(e.ctx.doc.status.textContent).toBe("");
      // yeniden başlatma: aynı veri dizini
      holder.app = startServer();
      e.advance(8000); await e.timers.run();
      expect(e.timers.pending).toEqual([]); // döngü durdu
      expect(e.ctx.panel).toBeNull();
      expect(e.ctx.doc.status.textContent).toBe("Control API reachable again; data refreshed.");
      const projects = (await e.ctx.api.projects()).items.map((x: any) => x.name);
      expect(projects).toContain("Survives restart");
      // sonraki çökmede sayaç baştan başlar (2 s)
      await holder.app!.close(); holder.app = null;
      e.ctx.doc.status.textContent = "";
      await e.ctx.refreshAll();
      expect(e.timers.pending.map(p => p.ms)).toEqual([2000]);
      expect(byData(e.ctx.panel, "recoveryAuto")!.dataset.recoveryAttempt).toBe("1");
    });

    it("'Retry' cancels the pending wait and tries immediately; while the server is still down the next wait continues the back-off", async () => {
      const holder: {app: App | null} = {app: null};
      const e = await mkCtx(holder);
      await e.ctx.refreshAll();
      expect(e.timers.pending.map(p => p.ms)).toEqual([2000]);
      const firstId = e.timers.seq;
      const before = e.ctx.refreshes;
      await e.ctx.panel.all().find((n: N) => n.dataset.recovery === "retry")!.fire("click");
      expect(e.timers.cancelled).toContain(firstId);
      expect(e.ctx.refreshes).toBe(before + 1);
      expect(e.timers.pending.map(p => p.ms)).toEqual([4000]);
    });

    it("a server that answers but fails identity (not OFFLINE) is NOT treated as recovered: the loop keeps backing off, no 'reconnected' announcement", async () => {
      const holder: {app: App | null} = {app: null};
      const e = await mkCtx(holder);
      await e.ctx.refreshAll();
      expect(e.timers.pending.map(p => p.ms)).toEqual([2000]);
      // sunucu geri geldi ama kimlik doğrulanamıyor (yanlış belirteçle başlatılmış başka bir süreç gibi)
      const imposter = buildServer({controlToken: "w".repeat(32), runtime: path.join(tmp, "runtime"), repoRoot: REPO, dataDir: path.join(tmp, "data"), tenantId: "tA", port: 3210, logger: false});
      apps.push(imposter); holder.app = imposter;
      await e.timers.run();
      expect(e.ctx.doc.status.textContent).toBe("");
      expect(e.timers.pending.map(p => p.ms)).toEqual([4000]);
      expect(e.ctx.panel).not.toBeNull();
      expect(e.ctx.panel.dataset.recovery).toBe("API_DOWN");
    });

    it("a VIEW_FAILED panel never starts the reconnect loop; an API_DOWN panel with health LOADING/VERIFIED is not shown at all", async () => {
      const holder: {app: App | null} = {app: null};
      const e = await mkCtx(holder);
      const v = e.panelMod.recoveryPanel(e.ctx, {routeId: "home", health: "OFFLINE", reason: "VIEW_FAILED"});
      expect(byData(v, "recoveryAuto")).toBeUndefined();
      expect(e.timers.pending).toEqual([]);
      expect(e.core.shouldShowApiRecovery("LOADING")).toBe(false);
    });

    it("strings: locale keys win when they exist; otherwise the module's en/tr fallback is used (never a raw key)", async () => {
      const holder: {app: App | null} = {app: null};
      const tr = await mkCtx(holder, "tr");
      await tr.ctx.refreshAll();
      expect(tr.ctx.panel.textContent).toContain("Otomatik yeniden deneme 1, 2 sn içinde");
      expect(tr.ctx.panel.textContent).not.toMatch(/recovery\.auto\./);
      expect(tr.panelMod.recoveryText({t: (k: string) => (k === "recovery.reconnected" ? "FROM LOCALE" : k), i18n: {lang: "en"}}, "recovery.reconnected")).toBe("FROM LOCALE");
      expect(tr.panelMod.recoveryText({t: (k: string) => k, i18n: {lang: "en"}}, "recovery.auto.next", {n: 3, s: 8})).toBe("Automatic retry 3 in 8 s");
    });
  });

  describe("UASCO-T0004.A reconnect core (pure)", () => {
    it("reconnectDelayMs: 2, 4, 8, 16 s then capped at 30 s; invalid attempts use the first wait", async () => {
      const c = await load("recovery-core.js");
      expect([0, 1, 2, 3, 4, 5, 50].map(c.reconnectDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
      for (const bad of [-1, 1.5, NaN, undefined, "2"]) expect(c.reconnectDelayMs(bad), String(bad)).toBe(2000);
    });
    it("createReconnector: idempotent noteDown, back-off while unhealthy, single onRecovered and reset, stop() cancels", async () => {
      const c = await load("recovery-core.js");
      const t = new Timers(); let healthy = false, recovered = 0, attempts = 0, clock = 0;
      const r = c.createReconnector({schedule: t.setTimeout, cancel: t.clearTimeout, now: () => clock, attemptOnce: async () => { attempts++; }, isHealthy: async () => healthy, onRecovered: () => { recovered++; }});
      r.noteDown(); r.noteDown(); r.noteDown();
      expect(t.pending.map(p => p.ms)).toEqual([2000]);
      expect(r.snapshot()).toMatchObject({active: true, attempt: 0, nextAt: 2000, running: false});
      await t.run(); await t.run(); await t.run();
      expect(attempts).toBe(3); expect(t.pending.map(p => p.ms)).toEqual([16000]);
      healthy = true; await t.run();
      expect(recovered).toBe(1); expect(t.pending).toEqual([]); expect(r.snapshot()).toMatchObject({active: false, attempt: 0, nextAt: null});
      healthy = false; r.noteDown(); expect(t.pending.map(p => p.ms)).toEqual([2000]);
      r.stop(); expect(t.pending).toEqual([]); expect(r.snapshot().active).toBe(false);
      // stop() bir deneme sürerken çağrılırsa deneme bitince yeni bekleme PLANLANMAZ
      const t3 = new Timers(); let release: () => void = () => {};
      const r3 = c.createReconnector({schedule: t3.setTimeout, cancel: t3.clearTimeout, now: () => 0, attemptOnce: () => new Promise<void>(res => { release = res; }), isHealthy: async () => false, onRecovered: () => {}});
      r3.noteDown(); const running = t3.run();
      expect(r3.snapshot().running).toBe(true);
      r3.stop(); release(); await running;
      expect(t3.pending).toEqual([]); expect(r3.snapshot().active).toBe(false);
      // sağlık okuması hata verirse sağlıksız sayılır (fail-closed); deneme hatası döngüyü durdurmaz
      const t2 = new Timers(); let rec2 = 0;
      const r2 = c.createReconnector({schedule: t2.setTimeout, cancel: t2.clearTimeout, now: () => 0, attemptOnce: async () => { throw new Error("x"); }, isHealthy: async () => { throw new Error("y"); }, onRecovered: () => { rec2++; }});
      r2.noteDown(); await t2.run();
      expect(rec2).toBe(0); expect(t2.pending.map(p => p.ms)).toEqual([4000]);
    });
  });
}
