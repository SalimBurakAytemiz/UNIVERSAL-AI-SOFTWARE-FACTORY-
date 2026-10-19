// //TR: Bu test UX WP-FIRSTRUN ilk-açılış kurulum/onboarding sihirbazını (apps/desktop/renderer/views/firstrun.js) doğrular: (1) güvenli per-user tercih kapısı — "görülmedi" ise açılır, "görüldü" ise açılmaz, depo yoksa dürüst varsayılan; (2) adımlar (welcome/connection/verify/ready) ve ileri/geri/atla/bitir gezinmesi; (3) bağlantı durumu YALNIZ gerçek sunucu sinyalinden (WP-SETTINGS claudeConnectionState) — profil READY ise CONNECTED, LOGIN_REQUIRED/REFUSED ise NOT_CONNECTED, bilinmeyen/eksikse NOT_VERIFIED; gerçek giriş sinyali olmadan CONNECTED/"Connected"/"Bağlı" ASLA gösterilmez (K-1); arka uç yok/doğrulanmamışsa dürüst UNAVAILABLE; (4) doğrulama adımı durumu yeniden okur ve CONNECTED yalnız tüm profiller READY iken; (5) güvenlik — sihirbaz giriş YAPMAZ (window.uasco yok, .post yok), yalnız giriş komutunu metin olarak gösterir, korumalı/yönetilen dosya yazmaz, yalnız zaten allow-list'li GET /v1/system/executors okur, yeni GET eklenmez (main.mjs EXTRA_GET_ROUTES değişmez); (6) kapı değildir — atla/Esc/bitir güvenli tercihi işaretler ve dialog'u kapatır, uygulamayı engellemez; (7) a11y (modal dialog rol/aria, odaklanabilir adım başlığı, odak adım değişiminde başlığa gider); (8) firstrun.* sözlüğü EN/TR'de birebirdir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {desktopGetPathAllowed} from "../automation/lib/control-boundary.mjs";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const readMain = () => fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const block = (tag: string) => { const s = readMain(); const a = s.indexOf(`// ${tag}-BEGIN`), b = s.indexOf(`// ${tag}-END`); if (a < 0 || b < 0) throw new Error(`no ${tag}`); return s.slice(a, b); };
const loadGet = () => new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;

// Minimal fake DOM (createElement/textContent/replaceChildren/events + dialog + fire).
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>(); value = ""; open = false;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
  removeAttribute(k: string) { this.attrs.delete(k); if (k === "class") this.className = ""; }
  getAttribute(k: string) { return k === "class" && this.className ? this.className : this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { for (const fn of this.ls.get(ev) ?? []) fn({preventDefault() {}, ...e}); }
  focus() { this.doc.focused = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
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
const within = (r: N | null) => (r ? all(r) : []);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const text = (n: N) => n.textContent;
const LOGIN = "$env:CLAUDE_CONFIG_DIR='C:/Users/u/.uasco/impl'; claude";

interface Feed { execOff?: boolean; profiles?: Record<string, any> | null; }
function execResponse(feed: Feed) {
  const profiles = feed.profiles === undefined
    ? {implementer: {state: "READY", reason: null, loginCommand: LOGIN}, reviewer: {state: "LOGIN_REQUIRED", reason: "LOGIN_REQUIRED", loginCommand: LOGIN}}
    : feed.profiles;
  return {executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: null}, sandbox: {state: "UNAVAILABLE", reason: "M1A_MODE"}, claudeProfiles: profiles};
}
function makeFakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, _map: m};
}
async function mkCtx(feed: Feed = {}, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {
    apiGet: async (p: string) => { calls.push(p); if (p === "/v1/system/executors") { if (feed.execOff) throw new Error(`${p}: HTTP 503`); return execResponse(feed); } throw new Error(`${p}: HTTP 404`); },
    apiPost: async () => { throw new Error("NO_POST_IN_FIRSTRUN"); },
  };
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t, setLang: () => {}}, t, navigate: () => {}, principal: "FOUNDER_LOCAL"};
  return {ctx, doc, api, calls};
}

describe("WP-FIRSTRUN safe per-user gate (one-time auto-open, honest fallback)", () => {
  it("opens only when the safe preference is unseen; a seen flag closes the gate; no storage => still opens (honest)", async () => {
    const fr = await load("views", "firstrun.js");
    const seen = makeFakeStorage({[fr.FIRSTRUN_STORAGE_KEY]: "1"});
    const unseen = makeFakeStorage();
    expect(fr.firstRunSeen(seen)).toBe(true);
    expect(fr.firstRunSeen(unseen)).toBe(false);
    expect(fr.shouldAutoOpenFirstRun(seen)).toBe(false);
    expect(fr.shouldAutoOpenFirstRun(unseen)).toBe(true);
    expect(fr.shouldAutoOpenFirstRun(null)).toBe(true); // depo yoksa: emin değil -> yine açılabilir, veri uydurulmaz
    expect(fr.markFirstRunSeen(unseen)).toBe(true);
    expect(fr.firstRunSeen(unseen)).toBe(true);
  });
  it("maybeOpenFirstRun opens a modal once when unseen and does nothing when already seen; never throws without a window", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx, doc} = await mkCtx();
    const store = makeFakeStorage();
    const w = (globalThis as any).window;
    try {
      (globalThis as any).window = {localStorage: store};
      const c = fr.maybeOpenFirstRun(ctx);
      expect(c).not.toBeNull();
      expect(doc.body.children.some(n => n.id === "firstRunDialog")).toBe(true);
      expect(c.dialog.open).toBe(true); // showModal çağrıldı
      // İkinci açılış: tercih artık "görüldü" -> açılmaz.
      (globalThis as any).window = {localStorage: makeFakeStorage({[fr.FIRSTRUN_STORAGE_KEY]: "1"})};
      const {ctx: ctx2, doc: doc2} = await mkCtx();
      expect(fr.maybeOpenFirstRun(ctx2)).toBeNull();
      expect(doc2.body.children.some(n => n.id === "firstRunDialog")).toBe(false);
    } finally { (globalThis as any).window = w; }
  });
});

describe("WP-FIRSTRUN wizard steps, navigation and a11y", () => {
  it("is a labelled modal dialog, walks welcome->connection->verify->ready, and moves focus to the step title on change", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx, doc} = await mkCtx({}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start();
    expect(c.dialog.tagName).toBe("DIALOG");
    expect(c.dialog.getAttribute("role")).toBe("dialog");
    expect(c.dialog.getAttribute("aria-modal")).toBe("true");
    expect(c.dialog.getAttribute("aria-labelledby")).toBe("firstRunTitle");
    expect(c.dialog.getAttribute("aria-describedby")).toBe("firstRunLead");
    // welcome
    expect(within(c.dialog).some(n => n.dataset.frStep === "welcome")).toBe(true);
    expect(byId(c.dialog, "firstRunStepTitle")!.getAttribute("tabindex")).toBe("-1");
    const next = () => byId(c.dialog, "firstRunNext")!.fire("click");
    next(); // -> connection
    expect(c.step).toBe(1);
    expect(doc.focused!.id).toBe("firstRunStepTitle"); // odak adım başlığına gitti
    expect(within(c.dialog).some(n => n.dataset.frStep === "connection")).toBe(true);
    next(); // -> verify
    expect(within(c.dialog).some(n => n.dataset.frStep === "verify")).toBe(true);
    next(); // -> ready
    expect(within(c.dialog).some(n => n.dataset.frStep === "ready")).toBe(true);
    // ready adımında Bitir var, Atla/İleri yok
    expect(byId(c.dialog, "firstRunFinish")).not.toBeNull();
    expect(byId(c.dialog, "firstRunSkip")).toBeNull();
    expect(byId(c.dialog, "firstRunNext")).toBeNull();
    // Geri welcome'a kadar çalışır
    byId(c.dialog, "firstRunBack")!.fire("click");
    expect(c.step).toBe(2);
  });
});

describe("WP-FIRSTRUN connection + verify show ONLY real sign-in state (K-1, no fabrication)", () => {
  it("connection step shows CONNECTED for a READY implementer, NOT_CONNECTED for a LOGIN_REQUIRED reviewer, with login-as-text + cost/personal guidance", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx, doc, calls} = await mkCtx({}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start();
    c.goTo(1);
    const impl = within(c.dialog).find(n => n.dataset.frProfile === "implementer")!;
    const rev = within(c.dialog).find(n => n.dataset.frProfile === "reviewer")!;
    expect(impl.dataset.conn).toBe("CONNECTED");
    expect(text(impl)).toContain("Connected");
    expect(rev.dataset.conn).toBe("NOT_CONNECTED");
    expect(text(rev)).toContain("NOT_CONNECTED");
    // Giriş komutu YALNIZ metin olarak (çalıştırılmaz).
    const loginPre = within(c.dialog).find(n => n.dataset.frLogin === "implementer")!;
    expect(text(loginPre)).toContain("claude");
    const body = text(c.dialog);
    expect(body).toContain("quota"); // sağlayıcı kota/abonelik notu
    expect(body.toLowerCase()).toContain("personal"); // kişisel profil asla otomatik kullanılmaz
    // Yalnız zaten allow-list'li GET /v1/system/executors okunur; başka GET yok.
    expect([...new Set(calls)]).toEqual(["/v1/system/executors"]);
    expect(desktopGetPathAllowed("/v1/system/executors") || loadGet()("/v1/system/executors")).toBe(true);
  });
  it("verify step reports CONNECTED only when ALL profiles are READY; otherwise NOT_CONNECTED; honest UNAVAILABLE when the backend is down (never 'Connected')", async () => {
    const fr = await load("views", "firstrun.js");
    // Karışık: biri READY biri değil -> NOT_CONNECTED
    const mixed = await mkCtx({}, "en");
    const c1 = fr.createFirstRunController(mixed.ctx, {storage: makeFakeStorage()});
    await c1.start(); c1.goTo(2);
    expect(within(c1.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("NOT_CONNECTED");
    // Hepsi READY -> CONNECTED
    const bothReady = await mkCtx({profiles: {implementer: {state: "READY"}, reviewer: {state: "READY"}}}, "en");
    const c2 = fr.createFirstRunController(bothReady.ctx, {storage: makeFakeStorage()});
    await c2.start(); c2.goTo(2);
    expect(within(c2.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("CONNECTED");
    // Arka uç yok -> dürüst UNAVAILABLE, asla "Connected"/CONNECTED profil kartı yok
    const off = await mkCtx({execOff: true}, "en");
    const c3 = fr.createFirstRunController(off.ctx, {storage: makeFakeStorage()});
    await c3.start(); c3.goTo(2);
    expect(within(c3.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("UNAVAILABLE");
    expect(text(c3.dialog)).not.toContain("Connected");
    expect(within(c3.dialog).filter(n => "frProfile" in n.dataset && n.dataset.conn === "CONNECTED").length).toBe(0);
    // "Verify again" sadece gerçek durumu yeniden okur (yine bir GET), asla POST yok.
    off.calls.length = 0;
    await c3.verify();
    expect(off.calls.filter(p => p === "/v1/system/executors").length).toBeGreaterThanOrEqual(1);
  });
  it("never shows CONNECTED when neither profile is READY (K-1)", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx} = await mkCtx({profiles: {implementer: {state: "LOGIN_REQUIRED"}, reviewer: {state: "REFUSED"}}}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start(); c.goTo(1);
    expect(text(c.dialog)).not.toContain("Connected");
    c.goTo(2);
    expect(within(c.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("NOT_CONNECTED");
  });
});

describe("WP-FIRSTRUN is NOT a gate and performs NO login / no managed write (security)", () => {
  it("skip, finish and Esc all mark the safe preference seen and close the dialog (app still opens)", async () => {
    const fr = await load("views", "firstrun.js");
    for (const act of ["skip", "finish", "esc"]) {
      const {ctx} = await mkCtx({}, "en");
      const storage = makeFakeStorage();
      let doneReason: string | null = null;
      const c = fr.createFirstRunController(ctx, {storage, onDone: (r: string) => { doneReason = r; }});
      await c.start();
      if (act === "skip") c.skip();
      else if (act === "finish") c.finish();
      else c.dialog.fire("cancel");
      expect(fr.firstRunSeen(storage)).toBe(true);
      expect(c.dialog.open).toBe(false);
      expect(doneReason === null ? "" : doneReason).not.toBe("");
    }
  });
  it("firstrun.js never calls a write (.post) and never touches window.uasco; it only reads the already-allow-listed executors GET; main.mjs EXTRA_GET_ROUTES is unchanged", () => {
    const src = fs.readFileSync(path.join(rend, "views", "firstrun.js"), "utf8");
    expect(src.includes(".post(")).toBe(false);
    expect(src.includes("window.uasco")).toBe(false);
    expect(src.includes("innerHTML")).toBe(false);
    const b = block("B4-ALLOWLIST");
    const m = b.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)!;
    const routes = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort();
    expect(routes).toEqual([
      "/v1/cockpit", "/v1/company/accounts", "/v1/company/contacts", "/v1/company/contracts",
      "/v1/company/invoices", "/v1/company/opportunities", "/v1/company/payments",
      "/v1/evidence", "/v1/missions", "/v1/projects", "/v1/roles", "/v1/work-runs",
    ]);
  });
});

describe("WP-FIRSTRUN locale parity", () => {
  it("every firstrun.* key used in the wizard exists in both TR and EN, and the firstrun.* key set is identical", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const src = fs.readFileSync(path.join(rend, "views", "firstrun.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/"(firstrun\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]);
    // Dinamik anahtarlar (firstrun.step.${key}.title/body) için adımları da ekle.
    for (const k of ["welcome", "connection", "verify", "ready"]) { keys.add(`firstrun.step.${k}.title`); keys.add(`firstrun.step.${k}.body`); }
    expect(keys.size).toBeGreaterThan(15);
    for (const k of keys) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); }
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("firstrun.")).sort();
    expect(sub(tr)).toEqual(sub(en));
  });
});

// //TR: UX hardening — ilk-açılış sihirbazı: yükleme durumu, boş profil, adım sınırları, kurtarma (tekrar doğrula) ve erişilebilir düğmeler; "bağlı" asla uydurulmaz.
describe("UX hardening: firstrun loading, empty, retry and a11y", () => {
  it("shows a LOADING status (not profiles, not Connected) before the executors read completes", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx} = await mkCtx({}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    c.goTo(1);
    const t0 = text(c.dialog);
    expect(t0).toContain(ctx.t("state.LOADING"));
    expect(within(c.dialog).filter(n => "frProfile" in n.dataset).length).toBe(0);
    expect(t0).not.toContain("Connected");
  });
  it("with no profiles the connection step says none and the verify step is NOT_CONNECTED (an empty list is not 'all connected')", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx} = await mkCtx({profiles: {}}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start(); c.goTo(1);
    expect(text(c.dialog)).toContain(ctx.t("settings.conn.none"));
    c.goTo(2);
    expect(within(c.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("NOT_CONNECTED");
  });
  it("clamps step navigation to the valid range and keeps Back off the first step and Finish only on the last", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx} = await mkCtx({}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start();
    c.goTo(-5); expect(c.step).toBe(0); expect(byId(c.dialog, "firstRunBack")).toBeNull(); expect(byId(c.dialog, "firstRunFinish")).toBeNull();
    c.goTo(99); expect(c.step).toBe(fr.FIRSTRUN_STEPS.length - 1);
    expect(byId(c.dialog, "firstRunFinish")).not.toBeNull(); expect(byId(c.dialog, "firstRunNext")).toBeNull(); expect(byId(c.dialog, "firstRunSkip")).toBeNull();
  });
  it("recovers: after the backend comes back, 'verify again' replaces UNAVAILABLE with the real state", async () => {
    const fr = await load("views", "firstrun.js"), apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
    let up = false;
    const doc = new D(), store = st.createStore(null);
    const api = apiMod.createApi({store, bridge: {apiGet: async (p: string) => { if (up && p === "/v1/system/executors") return execResponse({profiles: {implementer: {state: "READY"}, reviewer: {state: "READY"}}}); throw new Error(`${p}: HTTP 503`); }}});
    const t = (k: string, v?: any) => i18n.translate("en", k, v);
    const ctx: any = {doc, store, api, i18n: {lang: "en", t, setLang: () => {}}, t, navigate: () => {}, principal: "FOUNDER_LOCAL"};
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start(); c.goTo(2);
    expect(within(c.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("UNAVAILABLE");
    up = true;
    byId(c.dialog, "firstRunVerify")!.fire("click"); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(within(c.dialog).find(n => n.dataset.frVerify)!.dataset.frVerify).toBe("CONNECTED");
  });
  it("every footer control is a typed button and each step is a labelled section", async () => {
    const fr = await load("views", "firstrun.js");
    const {ctx} = await mkCtx({}, "en");
    const c = fr.createFirstRunController(ctx, {storage: makeFakeStorage()});
    await c.start();
    for (let i = 0; i < fr.FIRSTRUN_STEPS.length; i++) {
      c.goTo(i);
      for (const b of within(c.dialog).filter(n => n.tagName === "BUTTON")) expect(b.getAttribute("type")).toBe("button");
      expect(within(c.dialog).find(n => n.tagName === "SECTION")!.getAttribute("aria-labelledby")).toBe("firstRunStepTitle");
    }
  });
});
