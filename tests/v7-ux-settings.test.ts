// //TR: Bu test UX WP-SETTINGS Ayarlar görünümünü (apps/desktop/renderer/views/settings.js) ve saf yardımcılarını doğrular: (1) Claude bağlantı durumu yalnız gerçek giriş sinyalinden türetilir — profil READY ise CONNECTED, LOGIN_REQUIRED/REFUSED ise NOT_CONNECTED, bilinmeyen/eksikse NOT_VERIFIED; gerçek giriş sinyali olmadan CONNECTED ASLA gösterilmez (K-1); arka uç yok/doğrulanmamışsa dürüst UNAVAILABLE ve hiçbir yerde "Connected" yazmaz. (2) Otonomi/yönetişim bölümü SALT-OKUNUR'dur: Global Stop otonomi anahtarı ve fail-closed yürütme kapısı gerçek sinyallerden gelir; korumalı politika yüzeye açılmaz, burada düzenlenemez ve bu bölümde HİÇBİR form kontrolü (input/select/textarea/button) yoktur — hiçbir yönetilen/korumalı dosya yazılmaz. (3) Uygulama/güvenlik duruşu /health kimliği + /v1/factory build alanlarından SIKI doğrulamayla okunur, uyumsuz değer "—" olur (uydurma yok). Ayarlar yalnız zaten allow-list'li GET'leri (/v1/system/executors, /v1/control/status, /health, /v1/factory) okur; yeni GET eklenmez (main.mjs EXTRA_GET_ROUTES değişmez). settings.conn/gov/app sözlüğü EN/TR'de birebirdir.
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

// Minimal fake DOM (createElement/textContent/replaceChildren/events only).
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>(); value = "";
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  // Real-DOM-like: innerHTML parses tags into element nodes so a markup-injecting renderer is actually caught.
  set innerHTML(v: string) {
    this.children = []; this._text = "";
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g; let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(String(v)))) { if (m.index > last) this.append(String(v).slice(last, m.index)); if (!m[1]) this.append(new N(this.doc, m[2])); last = re.lastIndex; }
    if (last < String(v).length) this.append(String(v).slice(last));
  }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
  getAttribute(k: string) { return k === "class" && this.className ? this.className : this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  focus() { this.doc.focused = this; }
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
const within = (r: N | null) => (r ? all(r) : []);
const text = (n: N) => n.textContent;

const HEALTH = {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"};
const FACTORY = {schemaVersion: "1.2.0", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", state: "V6_AUDIT_REMEDIATION_IN_PROGRESS"};
const LOGIN = "$env:CLAUDE_CONFIG_DIR='C:/Users/u/.uasco/impl'; claude";

interface Feed {
  caps?: any; adapters?: any; execOff?: boolean; profiles?: Record<string, any> | null; controlActive?: boolean | null; controlReason?: string; controlOff?: boolean; healthOff?: boolean; factoryOff?: boolean; sandbox?: any;
}
function execResponse(feed: Feed) {
  const profiles = feed.profiles === undefined
    ? {implementer: {state: "READY", reason: null, loginCommand: LOGIN}, reviewer: {state: "LOGIN_REQUIRED", reason: "LOGIN_REQUIRED", loginCommand: LOGIN}}
    : feed.profiles;
  return {executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: null}, sandbox: feed.sandbox ?? {state: "UNAVAILABLE", reason: "M1A_MODE"}, claudeProfiles: profiles};
}
async function mkCtx(feed: Feed = {}, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    calls.push(p);
    if (p === "/v1/system/executors") { if (feed.execOff) throw new Error(`${p}: HTTP 503`); return execResponse(feed); }
    if (p === "/v1/control/status") { if (feed.controlOff) throw new Error(`${p}: HTTP 503`); return {globalStop: {active: feed.controlActive === true, reason: feed.controlActive ? (feed.controlReason ?? "FOUNDER_STOP") : null}, workos: {ok: true}}; }
    if (p === "/health") { if (feed.healthOff) throw new Error(`${p}: HTTP 503`); return HEALTH; }
    if (p === "/v1/factory") { if (feed.factoryOff) throw new Error(`${p}: HTTP 503`); return FACTORY; }
    if (p === "/v1/capabilities" && feed.caps !== undefined) return feed.caps;
    if (p === "/v1/adapters" && feed.adapters !== undefined) return feed.adapters;
    throw new Error(`${p}: HTTP 404`);
  }, apiPost: async () => { throw new Error("NO_POST_IN_TEST"); }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t, setLang: () => {}}, t, navigate: () => {}, rerender: async () => {}, refreshAll: async () => {}, confirm: async () => false, principal: "FOUNDER_LOCAL"};
  return {ctx, doc, api, calls};
}
const ROUTE = {id: "settings"};
const renderView = async (ctx: any) => { const v = await load("views", "settings.js"); return (await v.render(ctx, ROUTE)) as N; };

describe("UX WP-SETTINGS pure derivation (honest, no status elevation)", () => {
  it("claudeConnectionState: CONNECTED only from a real READY sign-in (K-1)", async () => {
    const s = await load("views", "settings.js");
    expect(s.claudeConnectionState({role: "implementer", state: "READY"})).toBe("CONNECTED");
    for (const st of ["LOGIN_REQUIRED", "REFUSED"]) expect(s.claudeConnectionState({state: st})).toBe("NOT_CONNECTED");
    for (const bad of [null, undefined, {}, {state: null}, {state: "SOMETHING"}, {state: "PENDING"}]) expect(s.claudeConnectionState(bad)).toBe("NOT_VERIFIED");
  });
  it("gatePillKind: AVAILABLE->VERIFIED, UNAVAILABLE->NOT_VERIFIED (fail-closed), else UNAVAILABLE", async () => {
    const s = await load("views", "settings.js");
    expect(s.gatePillKind({state: "AVAILABLE"})).toBe("VERIFIED");
    expect(s.gatePillKind({state: "UNAVAILABLE"})).toBe("NOT_VERIFIED");
    for (const bad of [null, undefined, {}, {state: "X"}]) expect(s.gatePillKind(bad)).toBe("UNAVAILABLE");
  });
  it("sanitizeAppFacts: only strict real fields survive, bad values drop to null (no fabrication)", async () => {
    const s = await load("views", "settings.js");
    const good = s.sanitizeAppFacts({state: "VERIFIED", data: HEALTH}, {ok: true, data: FACTORY});
    expect(good).toMatchObject({system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverVerified: true, schemaVersion: "1.2.0", state: "V6_AUDIT_REMEDIATION_IN_PROGRESS", available: true});
    const bad = s.sanitizeAppFacts({state: "VERIFIED", data: {system: "<script>", serverIdentity: "NOPE"}}, {ok: true, data: {schemaVersion: "x.y", state: "lower case"}});
    expect(bad).toMatchObject({system: null, serverVerified: false, schemaVersion: null, state: null, available: true});
    expect(s.sanitizeAppFacts({state: "ERROR"}, {ok: false}).available).toBe(false);
  });
});

describe("UX WP-SETTINGS connection section (real sign-in signal only)", () => {
  it("shows CONNECTED for a READY implementer and NOT_CONNECTED for a LOGIN_REQUIRED reviewer, with cost/personal guidance", async () => {
    const {ctx} = await mkCtx({}, "en");
    const node = await renderView(ctx);
    const panel = byId(node, "settings-connection")!;
    expect(panel).not.toBeNull();
    const impl = within(panel).find(n => n.dataset.connProfile === "implementer")!;
    const rev = within(panel).find(n => n.dataset.connProfile === "reviewer")!;
    expect(impl.dataset.conn).toBe("CONNECTED");
    expect(text(impl)).toContain("Connected");
    expect(rev.dataset.conn).toBe("NOT_CONNECTED");
    expect(text(rev)).toContain("NOT_CONNECTED");
    const pt = text(panel);
    expect(pt).toContain("quota"); // cost/subscription note
    expect(pt.toLowerCase()).toContain("personal"); // personal profile never auto-used
  });
  it("never shows CONNECTED without a READY sign-in signal (K-1) and is honestly UNAVAILABLE when the backend is down", async () => {
    const {ctx} = await mkCtx({execOff: true}, "en");
    const node = await renderView(ctx);
    expect(text(node)).not.toContain("Connected");
    // Bağlantı paneli dürüst durum notu gösterir, profil kartı yoktur.
    const panel = byId(node, "settings-connection")!;
    expect(within(panel).filter(n => "connProfile" in n.dataset).length).toBe(0);
    // Reviewer READY değilse CONNECTED yoktur.
    const {ctx: ctx2} = await mkCtx({profiles: {implementer: {state: "LOGIN_REQUIRED"}, reviewer: {state: "REFUSED"}}}, "en");
    const n2 = await renderView(ctx2);
    expect(text(byId(n2, "settings-connection")!)).not.toContain("Connected");
  });
});

describe("UX WP-SETTINGS governance DISPLAY is read-only (no governance bypass)", () => {
  it("reflects the real Global Stop autonomy switch and fail-closed gate, labelled read-only, with NO editable control", async () => {
    const {ctx} = await mkCtx({controlActive: false}, "en");
    const node = await renderView(ctx);
    const gov = byId(node, "settings-governance")!;
    expect(gov).not.toBeNull();
    expect(text(gov).toLowerCase()).toContain("read-only");
    expect(within(gov).some(n => n.dataset.autonomy === "ACTIVE")).toBe(true);
    // Risk tiers/approval gates/autonomy limits are Founder-governed and not exposed/editable here.
    expect(text(gov).toLowerCase()).toContain("risk tiers");
    expect(text(gov).toLowerCase()).toContain("founder");
    // HARD CONSTRAINT: hiçbir form kontrolü (düzenleme) yoktur.
    const controls = within(gov).filter(n => ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(n.tagName));
    expect(controls.length).toBe(0);
  });
  it("shows the autonomy switch as STOPPED with reason when Global Stop is active, UNAVAILABLE when control is down", async () => {
    const {ctx} = await mkCtx({controlActive: true}, "en");
    const gov = byId(await renderView(ctx), "settings-governance")!;
    const cell = within(gov).find(n => n.dataset.autonomy)!;
    expect(cell.dataset.autonomy).toBe("STOPPED");
    expect(text(gov)).toContain("FOUNDER_STOP");
    const {ctx: ctx2} = await mkCtx({controlOff: true}, "en");
    const gov2 = byId(await renderView(ctx2), "settings-governance")!;
    expect(within(gov2).find(n => n.dataset.autonomy)!.dataset.autonomy).toBe("UNAVAILABLE");
  });
});

describe("UX WP-SETTINGS app & security posture (real identity, honest empty)", () => {
  it("binds system + verified server identity + build/state to real data and shows the unsigned/fail-closed posture", async () => {
    const {ctx} = await mkCtx({}, "en");
    const app = byId(await renderView(ctx), "settings-app")!;
    expect(app).not.toBeNull();
    const at = text(app);
    expect(at).toContain("UNIVERSAL-AI-SOFTWARE-COMPANY-OS");
    expect(at).toContain("1.2.0");
    expect(at).toContain("V6_AUDIT_REMEDIATION_IN_PROGRESS");
    expect(within(app).some(n => n.dataset.posture === "unsigned")).toBe(true);
    expect(within(app).some(n => n.dataset.posture === "gate")).toBe(true);
    expect(at.toLowerCase()).toContain("unsigned");
    expect(at.toLowerCase()).toContain("fail-closed");
  });
  it("shows an honest dash when build facts are malformed and honest UNAVAILABLE when /health is down (no fabrication)", async () => {
    const {ctx} = await mkCtx({factoryOff: true}, "en");
    const app = byId(await renderView(ctx), "settings-app")!;
    expect(text(app)).toContain("\u2014"); // em dash for missing build/schema
    expect(text(app)).not.toContain("1.2.0");
    const {ctx: ctx2} = await mkCtx({healthOff: true}, "en");
    const app2 = byId(await renderView(ctx2), "settings-app")!;
    // Kimlik yoksa sistem adı gösterilmez.
    expect(text(app2)).not.toContain("UNIVERSAL-AI-SOFTWARE-COMPANY-OS");
  });
});

describe("UX WP-SETTINGS reads only already-allow-listed GETs (no new GET route added)", () => {
  it("every GET the settings view issues is already allow-listed, so main.mjs EXTRA_GET_ROUTES is unchanged", async () => {
    const {ctx, calls} = await mkCtx({}, "en");
    await renderView(ctx);
    const extra = loadGet();
    const gets = [...new Set(calls)];
    expect(gets.sort()).toEqual(["/health", "/v1/adapters", "/v1/capabilities", "/v1/control/status", "/v1/factory", "/v1/system/executors"]); // PQ-005: iki kayıt okuması (zaten allow-list'te) eklendi; aşağıdaki allow-list doğrulaması bunları da kapsar
    for (const p of gets) expect(desktopGetPathAllowed(p) || extra(p), p).toBe(true);
    // Dürüstlük: settings.js hiçbir yazma (POST) çağrısı yapmaz.
    const src = fs.readFileSync(path.join(rend, "views", "settings.js"), "utf8");
    expect(src.includes(".post(")).toBe(false);
    expect(src.includes("window.uasco")).toBe(false);
  });
  it("main.mjs EXTRA_GET_ROUTES still contains only the known pre-existing routes (no settings/policy GET added)", () => {
    const b = block("B4-ALLOWLIST");
    const m = b.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)!;
    const routes = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort();
    expect(routes).toEqual([
      "/v1/cockpit", "/v1/company/accounts", "/v1/company/contacts", "/v1/company/contracts",
      "/v1/company/invoices", "/v1/company/opportunities", "/v1/company/payments",
      "/v1/evidence", "/v1/missions", "/v1/projects", "/v1/roles", "/v1/work-runs"
    ]);
  });
});

describe("UX WP-SETTINGS locale parity", () => {
  it("every settings key used in the view exists in both TR and EN, and the new settings.conn/gov/app key sets are identical", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const src = fs.readFileSync(path.join(rend, "views", "settings.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/"(settings\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(15);
    for (const k of keys) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); }
    const sub = (d: Record<string, string>, pre: string) => Object.keys(d).filter(k => k.startsWith(pre)).sort();
    for (const pre of ["settings.conn.", "settings.gov.", "settings.app."]) expect(sub(tr, pre), pre).toEqual(sub(en, pre));
  });
});

// //TR: test+states: settings (functional/negative/a11y) — bozuk profil/sağlık yanıtlarında asla CONNECTED/VERIFIED gösterilmediğini, tüm okumalar düşünce dürüst durumları, dil düğmelerinin klavye/aria sözleşmesini (h1 tabindex, tipli düğmeler, aria-pressed) ve görünümün kullandığı tüm anahtarların TR/EN eşitliğini doğrular.
describe("test+states settings: negative (no fabricated Connected/Verified)", () => {
  it("malformed or unknown claudeProfiles never produce a CONNECTED card", async () => {
    // //TR: Küçük harfli/yanlış biçimli durumlar, dizi ve null profiller bağlı sayılmaz.
    const feeds: Array<Record<string, any> | null> = [
      null, {}, {implementer: null, reviewer: 7},
      {implementer: {state: "ready"}, reviewer: {state: "Connected"}},
      {implementer: {state: "READY_BUT_NOT"}, reviewer: {}},
      {implementer: {state: {x: 1}}, reviewer: {state: ["READY"]}}
    ];
    for (const profiles of feeds) {
      const {ctx} = await mkCtx({profiles: profiles as any}, "en");
      const node = await renderView(ctx);
      const conn = byId(node, "settings-connection")!;
      expect(within(conn).filter(n => n.dataset.conn === "CONNECTED").length, JSON.stringify(profiles)).toBe(0);
      expect(text(conn), JSON.stringify(profiles)).not.toContain("Connected");
    }
  });
  it("when every read fails: no VERIFIED/Connected anywhere, fail-closed gate is UNAVAILABLE, build facts are em-dashes", async () => {
    for (const lang of ["tr", "en"]) {
      const {ctx} = await mkCtx({execOff: true, controlOff: true, healthOff: true, factoryOff: true}, lang);
      const node = await renderView(ctx);
      expect(within(node).filter(n => n.dataset.pill === "VERIFIED").length, lang).toBe(0);
      expect(within(node).filter(n => n.dataset.conn === "CONNECTED").length, lang).toBe(0);
      expect(within(node).find(n => "autonomy" in n.dataset)!.dataset.autonomy).toBe("UNAVAILABLE");
      expect(within(node).find(n => "gate" in n.dataset && n.tagName === "DIV")!.dataset.gate).toBe("UNAVAILABLE");
      const app = text(byId(node, "settings-app")!);
      expect(app).not.toContain("UNIVERSAL-AI-SOFTWARE-COMPANY-OS");
      expect(app).not.toContain("1.2.0");
      expect(byId(node, "settings-lang")).not.toBeNull(); // dil ve kısayollar yine kullanılabilir
      expect(byId(node, "settings-principal")).not.toBeNull();
    }
  });
  it("healthy /health but failed /v1/factory still shows the verified identity, with the build state and schema as em-dashes", async () => {
    const {ctx} = await mkCtx({factoryOff: true}, "en");
    const node = await renderView(ctx);
    const kv = within(byId(node, "settings-app")!).filter(n => n.tagName === "DD" && n.className.includes("mono")).map(n => text(n));
    expect(kv).toContain("UNIVERSAL-AI-SOFTWARE-COMPANY-OS");
    expect(kv.filter(t => t === "—").length).toBe(2);
  });
  it("a fail-closed sandbox is never presented as an available gate even when the executor read is healthy", async () => {
    const {ctx} = await mkCtx({sandbox: {state: "UNAVAILABLE", reason: "M1A_MODE"}}, "en");
    const node = await renderView(ctx);
    const gates = within(node).filter(n => n.dataset.gate !== undefined);
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) expect(g.dataset.gate).toBe("NOT_VERIFIED");
  });
  it("renders API-provided text as text only (no markup nodes)", async () => {
    // Global-stop reason is the API string the view renders verbatim (governance panel), via the real api.js mapping path.
    const payloads = ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "<iframe src=javascript:alert(1)></iframe>", `"quoted" & 'single' &amp; <b>`];
    for (const payload of payloads) {
      const {ctx} = await mkCtx({controlActive: true, controlReason: payload}, "en");
      const node = await renderView(ctx);
      expect(within(node).filter(n => n.textContent === ` ${payload}`).length, `payload reaches DOM verbatim: ${payload}`).toBeGreaterThan(0);
      expect(within(node).filter(n => ["IMG", "SCRIPT", "IFRAME"].includes(n.tagName)).map(n => n.tagName)).toEqual([]);
    }
  });
});

describe("test+states settings: accessibility and keyboard", () => {
  it("h1 is unique and the programmatic focus target (tabindex -1)", async () => {
    const {ctx} = await mkCtx();
    const node = await renderView(ctx);
    const h1s = within(node).filter(n => n.tagName === "H1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].id).toBe("view-title");
    expect(h1s[0].getAttribute("tabindex")).toBe("-1");
    expect(text(h1s[0]).length).toBeGreaterThan(0);
  });
  it("language buttons are typed buttons in a labelled group with aria-pressed matching the active language, and click switches language", async () => {
    for (const lang of ["tr", "en"]) {
      const {ctx} = await mkCtx({}, lang);
      const picked: string[] = [];
      ctx.i18n.setLang = (l: string) => { picked.push(l); };
      const node = await renderView(ctx);
      const group = within(byId(node, "settings-lang")!).find(n => n.getAttribute("role") === "group")!;
      expect(group.getAttribute("aria-label")!.length).toBeGreaterThan(0);
      const btns = within(group).filter(n => n.tagName === "BUTTON");
      expect(btns.length).toBe(2);
      for (const b of btns) {
        expect(b.getAttribute("type")).toBe("button");
        expect(b.getAttribute("aria-pressed")).toBe(b.dataset.lang === lang ? "true" : "false");
        expect(text(b).length).toBeGreaterThan(0);
      }
      const other = btns.find(b => b.dataset.lang !== lang)!;
      for (const l of (other as any).ls.get("click") ?? []) l({});
      expect(picked).toEqual([other.dataset.lang]);
    }
  });
  it("status notes in degraded states expose role=status and every button on the page is explicitly typed", async () => {
    const {ctx} = await mkCtx({execOff: true, controlOff: true, healthOff: true});
    const node = await renderView(ctx);
    const notes = within(node).filter(n => n.className.includes("note-unavailable") || n.className.includes("note-error") || n.className.includes("note-offline"));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.getAttribute("role")).toBe("status");
    for (const b of within(node).filter(n => n.tagName === "BUTTON")) expect(["button", "submit"], b.id || text(b)).toContain(b.getAttribute("type"));
  });
  it("keyboard shortcuts are rendered as kbd elements inside a definition list", async () => {
    const {ctx} = await mkCtx();
    const node = await renderView(ctx);
    const keys = within(byId(node, "settings-keys")!);
    expect(keys.filter(n => n.tagName === "KBD").map(text)).toEqual(expect.arrayContaining(["Ctrl+K", "Esc", "Tab"]));
    expect(keys.some(n => n.tagName === "DL")).toBe(true);
  });
});

describe("test+states settings: EN/TR parity for every key the view uses", () => {
  it("whole dictionaries have identical key sets, and every literal settings.js key exists in both with equal placeholders", async () => {
    // //TR: Görünümde geçen tüm sabit anahtarlar iki dilde de tanımlıdır, yer tutucular eşittir.
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const src = fs.readFileSync(path.join(rend, "views", "settings.js"), "utf8");
    const keys = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) keys.add(m[1]);
    keys.add("area.settings.title"); keys.add("lang.tr"); keys.add("lang.en"); keys.add("state.UNAVAILABLE"); keys.add("pill.NOT_CONNECTED"); keys.add("pill.NOT_VERIFIED");
    expect(keys.size).toBeGreaterThan(15);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(k in tr && k in en, k).toBe(true); expect(ph(en[k]), k).toBe(ph(tr[k])); expect(tr[k].trim().length, k).toBeGreaterThan(0); expect(en[k].trim().length, k).toBeGreaterThan(0); }
  });
});

describe("UI-114 settings state legend (static, state-free)", () => {
  const legendOf = (node: N) => within(node).find(n => n.attrs.get("id") === "settings-legend")!;
  const FORBIDDEN_DATA = ["pill", "state", "gate", "autonomy", "conn", "connProfile", "profile", "posture", "chip", "verification"];
  // //TR: Açıklama paneli yapı olarak PILL_KINDS sırasını izler; her dt bir örnek rozet, her dd tanım taşır.
  it("structure: one dl, one dt/dd pair per PILL_KINDS entry in order, keyed by data-legend-kind", async () => {
    const {PILL_KINDS} = await load("model.js");
    for (const lang of ["tr", "en"]) {
      const {ctx} = await mkCtx({}, lang);
      const lg = legendOf(await renderView(ctx));
      expect(lg, lang).toBeTruthy();
      const nodes = within(lg);
      expect(nodes.filter(n => n.tagName === "DL").length).toBe(1);
      expect(nodes.filter(n => n.tagName === "DT").length).toBe(PILL_KINDS.length);
      expect(nodes.filter(n => n.tagName === "DD").length).toBe(PILL_KINDS.length);
      expect(nodes.filter(n => n.dataset.legendKind !== undefined).map(n => n.dataset.legendKind)).toEqual([...PILL_KINDS]);
      expect((nodes.find(n => n.tagName === "DL")!.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
    }
  });
  it("honesty: no live-state dataset keys, no title/H1/controls inside the legend", async () => {
    for (const lang of ["tr", "en"]) {
      const {ctx} = await mkCtx({}, lang);
      const lg = legendOf(await renderView(ctx));
      for (const n of within(lg)) {
        for (const k of FORBIDDEN_DATA) expect(k in n.dataset, `${lang} ${k}`).toBe(false);
        expect(n.getAttribute("title"), lang).toBeFalsy();
        expect(["H1", "INPUT", "SELECT", "TEXTAREA", "BUTTON"]).not.toContain(n.tagName);
      }
      const note = within(lg).find(n => n.tagName === "P" && n.className.includes("note"))!;
      expect(note.getAttribute("role")).toBeFalsy();
      expect(note.className).not.toMatch(/note-/);
    }
  });
  it("state-free: identical between healthy and all-reads-fail feeds; no digits, no raw key, no 'Connected'", async () => {
    for (const lang of ["tr", "en"]) {
      const a = legendOf(await renderView((await mkCtx({}, lang)).ctx));
      const b = legendOf(await renderView((await mkCtx({execOff: true, controlOff: true, healthOff: true, factoryOff: true}, lang)).ctx));
      expect(text(a), lang).toBe(text(b));
      expect(within(a).map(n => n.dataset.legendKind)).toEqual(within(b).map(n => n.dataset.legendKind));
      expect(text(a)).not.toMatch(/\d/);
      expect(text(a)).not.toContain("settings.legend.");
      if (lang === "en") expect(text(a)).not.toContain("Connected");
    }
  });
  it("locale parity: exactly 16 settings.legend.* keys per locale, non-empty, no placeholders", async () => {
    const {PILL_KINDS} = await load("model.js");
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const want = ["settings.legend.lead", "settings.legend.title", ...PILL_KINDS.map((k: string) => `settings.legend.${k}`)].sort();
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const d of [en, tr]) expect(Object.keys(d).filter(k => k.startsWith("settings.legend.")).sort()).toEqual(want);
    for (const k of want) {
      expect(en[k].trim().length, k).toBeGreaterThan(0); expect(tr[k].trim().length, k).toBeGreaterThan(0);
      expect(ph(en[k]), k).toBe(ph(tr[k])); expect(ph(en[k]), k).toBe("");
    }
  });
  it("semantics: VERIFIED, NOT_VERIFIED, NOT_EXECUTED and PRODUCT_VERIFIED stay distinct", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>, en = (await load("locales", "en.js")).default as Record<string, string>;
    const e = (k: string) => en[`settings.legend.${k}`];
    expect(e("PRODUCT_VERIFIED")).toContain("verified sandbox"); expect(e("PRODUCT_VERIFIED")).toContain("passed");
    expect(e("NOT_EXECUTED")).toContain("not run");
    expect(e("NOT_VERIFIED")).toContain("not verified");
    expect(e("VERIFIED")).toContain("not product verification");
    expect(en["settings.legend.lead"]).toContain("reference");
    expect(tr["settings.legend.PRODUCT_VERIFIED"]).toContain("sandbox");
    expect(new Set(["VERIFIED", "NOT_VERIFIED", "NOT_EXECUTED", "PRODUCT_VERIFIED"].map(e)).size).toBe(4);
  });
  it("settings.js source stays free of innerHTML, web storage, randomness and timers", () => {
    const src = fs.readFileSync(path.join(rend, "views", "settings.js"), "utf8");
    for (const w of ["innerHTML", "localStorage", "sessionStorage", "indexedDB", "Math.random", "setTimeout", "setInterval"]) expect(src.includes(w), w).toBe(false);
  });
});

// //TR: LANE-A PQ-004: tema kontrast laboratuvarı — oranlar stil sayfasındaki token değerlerinden hesaplanır; okunamayan değer UNKNOWN olur, hiçbir oran elle yazılmaz.
describe("PQ-004 theme contrast lab (read-only)", () => {
  const css = fs.readFileSync(path.join(rend, "styles.css"), "utf8");
  const rootBlock = /:root\{([\s\S]*?)\n\}/.exec(css)![1];
  const tokens: Record<string, string> = {};
  for (const m of rootBlock.matchAll(/(--[A-Za-z0-9_-]+):([^;]+);/g)) tokens[m[1]] = m[2].trim();
  const lumRef = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(s => s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const refRatio = (a: string, b: string) => { const x = lumRef(a), y = lumRef(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  it("computes known WCAG ratios and grade boundaries", async () => {
    const c = await load("contrast-core.js");
    expect(c.contrastRatio(c.parseHex("#000"), c.parseHex("#ffffff"))).toBeCloseTo(21, 5);
    expect(c.contrastRatio(c.parseHex("#777777"), c.parseHex("#ffffff"))).toBeCloseTo(4.48, 2);
    expect(c.gradeContrast(4.5, "text")).toBe("AA");
    expect(c.gradeContrast(4.49, "text")).toBe("FAIL");
    expect(c.gradeContrast(7, "text")).toBe("AAA");
    expect(c.gradeContrast(3, "ui")).toBe("AA");
    expect(c.gradeContrast(2.99, "ui")).toBe("FAIL");
    expect(c.gradeContrast(NaN, "text")).toBe("UNKNOWN");
  });
  it("rejects non-opaque or malformed colors (no invented ratio) and resolves var() aliases without looping", async () => {
    const c = await load("contrast-core.js");
    for (const v of ["rgba(1,2,3,.5)", "red", "#12", "#gggggg", "", null, undefined, 5]) expect(c.parseHex(v)).toBeNull();
    expect(c.resolveToken({"--a": "var(--b)", "--b": "#ABCDEF"}, "--a")).toBe("#ABCDEF");
    expect(c.resolveToken({"--a": "var(--b)", "--b": "var(--a)"}, "--a")).toBeNull();
    expect(c.resolveToken({}, "--a")).toBeNull();
    const rows = c.computeContrastRows({});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.ratio === null && r.level === "UNKNOWN")).toBe(true);
    expect(c.readTokens({defaultView: {getComputedStyle: () => { throw new Error("x"); }}, documentElement: {}})).toEqual({});
  });
  it("rows computed from the real styles.css :root tokens match an independent computation and none is UNKNOWN", async () => {
    const c = await load("contrast-core.js");
    const rows = c.computeContrastRows(tokens);
    for (const r of rows) {
      expect(r.level, r.key).not.toBe("UNKNOWN");
      const f = c.resolveToken(tokens, r.fg), b = c.resolveToken(tokens, r.bg);
      expect(r.ratio, r.key).toBeCloseTo(refRatio(f, b), 6);
    }
    expect(rows.find((r: any) => r.key === "text-bg").level).toBe("AAA");
  });
  it("renders one row per pair with a result label, makes no requests and shows UNKNOWN when tokens cannot be read", async () => {
    const settings = await load("views", "settings.js"), c = await load("contrast-core.js");
    const {ctx, calls} = await mkCtx();
    const before = calls.length;
    const root = settings.contrastPanel(ctx, tokens) as N;
    const rows = within(root).filter(n => n.dataset.contrastRow);
    expect(rows.length).toBe(c.CONTRAST_PAIRS.length);
    expect(rows.find(n => n.dataset.contrastRow === "text-bg")!.dataset.contrastLevel).toBe("AAA");
    expect(text(root)).toContain("AAA");
    const blind = settings.contrastPanel(ctx, {}) as N;
    const unk = within(blind).filter(n => n.dataset.contrastRow);
    expect(unk.every(n => n.dataset.contrastLevel === "UNKNOWN")).toBe(true);
    expect(text(blind)).toContain("—");
    expect(calls.length).toBe(before);
    const dflt = settings.contrastPanel(ctx) as N; // sahte DOM'da defaultView yok: okunamaz -> UNKNOWN
    expect(within(dflt).filter(n => n.dataset.contrastLevel === "UNKNOWN").length).toBe(c.CONTRAST_PAIRS.length);
  });
  it("is part of the Settings view with en/tr keys present", async () => {
    const settings = await load("views", "settings.js"), en = await load("locales", "en.js"), tr = await load("locales", "tr.js");
    const {ctx} = await mkCtx({}, "en");
    const root = await settings.render(ctx) as N;
    expect(byId(root, "settings-contrast")).not.toBeNull();
    const keys = Object.keys(en.default ?? en.EN ?? en).filter(k => k.startsWith("settings.contrast."));
    expect(keys.length).toBeGreaterThanOrEqual(13);
    const trAll = tr.default ?? tr.TR ?? tr;
    for (const k of keys) expect(trAll[k], k).toBeTruthy();
  });
});

// //TR: LANE-A PQ-005: sağlayıcı/model yönlendirme görünümü — yalnız mevcut GET'ler; kayıt değerleri aynen, etkin/bağlı yükseltmesi yok, model uydurulmaz.
describe("PQ-005 provider & model routing view (read-only)", () => {
  const CAPS = {capabilities: [{id: "UASCO-CAP-001", name: "Mission OS", status: "REGISTERED", activation: "ON_DEMAND", implementation: "NOT_IMPLEMENTED"}, {id: "UASCO-CAP-002", name: "Intake", status: "REGISTERED", activation: "ON_DEMAND", implementation: "PARTIAL"}]};
  const ADS = {adapters: [{id: "playwright", category: "BROWSER", status: "REGISTERED", implementation: "NOT_IMPLEMENTED", requiresCertification: true}, {id: "x-tool", category: "BUILD", status: "REGISTERED", implementation: "NOT_IMPLEMENTED"}]};
  const panelOf = async (feed: Feed) => { const {ctx, calls} = await mkCtx(feed, "en"); const m = await load("views", "executors-panel.js"); return {node: (await m.routingPanel(ctx)) as N, calls}; };

  it("maps registries strictly: valid entries verbatim, any malformed entry or shape makes the whole read ERROR", async () => {
    const c = await load("routing-core.js");
    expect(c.mapCapabilities(CAPS)).toMatchObject({state: "VERIFIED", total: 2});
    expect(c.mapAdapters(ADS).items[1].requiresCertification).toBeNull();
    for (const bad of [null, {}, {capabilities: "x"}, {capabilities: [{...CAPS.capabilities[0], status: "registered"}]}, {capabilities: [{...CAPS.capabilities[0], id: "../x"}]}, {capabilities: [CAPS.capabilities[0], null]}, {capabilities: [{...CAPS.capabilities[0], name: ""}]}]) expect(c.mapCapabilities(bad).state).toBe("ERROR");
    for (const bad of [null, {adapters: {}}, {adapters: [{...ADS.adapters[0], category: "browser"}]}]) expect(c.mapAdapters(bad).state).toBe("ERROR");
    expect(c.countBy(c.mapCapabilities(CAPS).items, "implementation")).toEqual([{value: "NOT_IMPLEMENTED", count: 1}, {value: "PARTIAL", count: 1}]);
  });
  it("each capability and adapter field check rejects an invalid value on its own (status, activation, implementation, category, id, name)", async () => {
    const c = await load("routing-core.js");
    const cap = CAPS.capabilities[0], ad = ADS.adapters[0];
    // Her alan tek başına bozulduğunda tüm okuma ERROR olur (kısmi görünüm yok).
    for (const field of ["status", "activation", "implementation"]) {
      for (const bad of ["registered", "", "1ABC", "A-B", "A B", 5, null, undefined, "A".repeat(41), ["REGISTERED"], {toString: () => "REGISTERED"}]) {
        expect(c.mapCapabilities({capabilities: [{...cap, [field]: bad}]}).state, `cap ${field}=${String(bad)}`).toBe("ERROR");
      }
      const missing: any = {...cap}; delete missing[field];
      expect(c.mapCapabilities({capabilities: [missing]}).state, `cap missing ${field}`).toBe("ERROR");
    }
    for (const field of ["category", "status", "implementation"]) {
      for (const bad of ["browser", "", "1ABC", "A-B", 5, null, undefined, "A".repeat(41)]) {
        expect(c.mapAdapters({adapters: [{...ad, [field]: bad}]}).state, `ad ${field}=${String(bad)}`).toBe("ERROR");
      }
      const missing: any = {...ad}; delete missing[field];
      expect(c.mapAdapters({adapters: [missing]}).state, `ad missing ${field}`).toBe("ERROR");
    }
    for (const bad of ["", "-x", "a b", "a/b", 5, null, "x".repeat(81), ["abc"], {toString: () => "abc"}]) {
      expect(c.mapCapabilities({capabilities: [{...cap, id: bad}]}).state, `cap id=${String(bad)}`).toBe("ERROR");
      expect(c.mapAdapters({adapters: [{...ad, id: bad}]}).state, `ad id=${String(bad)}`).toBe("ERROR");
    }
    for (const bad of ["", 5, null, undefined, "x".repeat(121), "a\u0001b"]) expect(c.mapCapabilities({capabilities: [{...cap, name: bad}]}).state, `cap name=${String(bad)}`).toBe("ERROR");
    // Geçerli sınır değerleri kabul edilir; bozuk bir kayıt geçerli kayıtları da düşürür (kısmi görünüm yok).
    expect(c.mapCapabilities({capabilities: [{...cap, status: "A".repeat(40)}]}).state).toBe("VERIFIED");
    expect(c.mapCapabilities({capabilities: [cap, {...cap, id: "UASCO-CAP-009", activation: "bad"}]}).state).toBe("ERROR");
    expect(c.mapAdapters({adapters: [{...ad, requiresCertification: "yes"}]}).items[0].requiresCertification).toBeNull();
    // Görünüm: bozuk activation yalnız o kayıt bloğunu ERROR yapar, satır göstermez.
  });
  it("a capability with an invalid activation, status or implementation makes the rendered block an honest non-VERIFIED state with no rows", async () => {
    for (const field of ["activation", "status", "implementation"]) {
      const caps = {capabilities: [{...CAPS.capabilities[0], [field]: "not valid"}]};
      const {node} = await panelOf({caps, adapters: ADS});
      const rows = within(node).filter(n => n.dataset.registryRow && n.dataset.registryRow.startsWith("UASCO-CAP"));
      expect(rows.length, field).toBe(0);
      const block = within(node).find(n => n.dataset.routingBlock === "routing-caps")!;
      expect(text(block), field).not.toContain("Mission OS");
    }
  });
  it("routing rows carry reported states verbatim and list blockers; READY everywhere is 'none reported', never 'active'", async () => {
    const c = await load("routing-core.js");
    const exec = {state: "VERIFIED", items: [{id: "LOCAL_CLAUDE", state: "READY"}], sandbox: {state: "AVAILABLE"}, profiles: [{role: "implementer", state: "READY"}, {role: "reviewer", state: "LOGIN_REQUIRED"}]};
    const rows = c.buildRoutingRows(exec);
    expect(rows.map((r: any) => [r.role, r.blockers])).toEqual([["implementer", []], ["reviewer", ["PROFILE_LOGIN_REQUIRED"]]]);
    expect(rows.every((r: any) => r.model === null)).toBe(true);
    const none = c.buildRoutingRows({state: "VERIFIED", items: [], sandbox: null, profiles: []});
    expect(none[0].blockers).toEqual(["EXECUTOR_NOT_REPORTED", "PROFILE_NOT_REPORTED", "SANDBOX_UNKNOWN"]);
    expect(c.buildRoutingRows({state: "UNAVAILABLE"})).toEqual([]);
  });
  it("renders routes and both registries from the existing GETs only, with no POST and no promotion of registry values", async () => {
    const {node, calls} = await panelOf({caps: CAPS, adapters: ADS});
    expect(node.id).toBe("settings-routing");
    const roles = within(node).filter(n => n.dataset.routingRole);
    expect(roles.map(n => n.dataset.routingRole)).toEqual(["implementer", "reviewer"]);
    expect(text(roles[1])).toContain("LOGIN_REQUIRED");
    expect(within(node).filter(n => n.dataset.registryRow).length).toBe(4);
    const t = text(node);
    expect(t).toContain("NOT_IMPLEMENTED"); expect(t).toContain("REGISTERED");
    expect(/\b(ACTIVE|CONNECTED)\b/.test(t)).toBe(false);
    expect(new Set(calls)).toEqual(new Set(["/v1/system/executors", "/v1/capabilities", "/v1/adapters"]));
    const src = fs.readFileSync(path.join(rend, "views", "executors-panel.js"), "utf8");
    expect(src.split("export async function routingPanel")[1].includes(".post(")).toBe(false);
  });
  it("shows honest states when the registry reads fail or are malformed, and caps long tables with a disclosed count", async () => {
    const off = await panelOf({});
    expect(within(off.node).filter(n => n.dataset.routingBlock).length).toBe(2);
    expect(within(off.node).filter(n => n.dataset.registryRow).length).toBe(0);
    const bad = await panelOf({caps: {capabilities: [{id: "x"}]}, adapters: ADS});
    expect(within(bad.node).filter(n => n.dataset.registryRow).length).toBe(2); // yalnız bağdaştırıcılar; yetenekler ERROR notu
    const many = {capabilities: Array.from({length: 75}, (_, i) => ({id: `CAP-${i}`, name: `n${i}`, status: "REGISTERED", activation: "ON_DEMAND", implementation: "NOT_IMPLEMENTED"}))};
    const big = await panelOf({caps: many, adapters: ADS});
    expect(within(big.node).filter(n => n.dataset.registryRow && n.dataset.registryRow.startsWith("CAP-")).length).toBe(60);
    expect(text(big.node)).toContain("Showing 60 of 75");
  });
  it("routing strings exist in en and tr", async () => {
    const en = await load("locales", "en.js"), tr = await load("locales", "tr.js");
    const E = en.default ?? en.EN ?? en, T = tr.default ?? tr.TR ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("routing."));
    expect(keys.length).toBe(27);
    for (const k of keys) expect(T[k], k).toBeTruthy();
  });
});

describe("LANE-A A-SETUP-1: 'Ready to build?' setup check (read-only, only what the app reports)", () => {
  const PROV = "PROVIDER_PROVENANCE_NOT_READY";
  const CMD = (r: string) => `$env:CLAUDE_CONFIG_DIR='C:\\Users\\f\\.uasco\\${r}'; claude`;
  const role = (blockers: string[] = [], profile = "READY", r = "implementer", extra: any = {}) => ({ready: blockers.length === 0, blockers, blocker: blockers[0] ?? null, founderAction: "Found C:\\x\\claude.cmd", profile, loginCommand: CMD(r), loginHint: "free", ...extra});
  const body = (over: any = {}) => ({executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND", path: "C:\\x\\claude.exe", kind: "EXECUTABLE"}, readiness: {implementer: role([]), reviewer: role([], "READY", "reviewer")}}, FAKE: {state: "TEST_ONLY"}},
    active: {reason: "LOCAL_CLAUDE"}, sandbox: {state: "AVAILABLE", reason: null, detail: null, providerId: "wsl-unshare-v1"}, claudeProfiles: {implementer: {state: "READY", loginCommand: CMD("implementer")}, reviewer: {state: "READY", loginCommand: CMD("reviewer")}}, ...over});
  const lc = (over: any, rd: any = undefined) => ({executors: {LOCAL_CLAUDE: {state: "READY", ...over, ...(rd !== undefined ? {readiness: rd} : {})}, FAKE: {state: "TEST_ONLY"}}});
  const mapped = async (b: any) => (await load("project-core.js")).mapExecutors(b);
  const rowsOf = async (b: any) => Object.fromEntries((await load("setup-check-core.js")).buildSetupChecks(await mapped(b)).rows.map((r: any) => [r.id, r]));
  it("shows PASS for the six rows only when the app reports each one (the product bridge stays UNKNOWN until a real start)", async () => {
    const c = await load("setup-check-core.js");
    const res = c.buildSetupChecks(await mapped(body()));
    expect(res.rows.map((r: any) => [r.id, r.state])).toEqual([["CLI", "PASS"], ["EXECUTOR", "PASS"], ["IMPLEMENTER", "PASS"], ["REVIEWER", "PASS"], ["SANDBOX", "PASS"], ["PRODUCT", "UNKNOWN"]]);
    expect(res).toMatchObject({pass: 5, blocked: 0, unknown: 1, kind: "UNKNOWN", readable: true});
    expect(res.rows[4].providerId).toBe("wsl-unshare-v1"); expect(res.rows[5].reasons).toEqual(["BRIDGE_NOT_TESTED"]);
    expect(c.SETUP_ROWS).toEqual(["CLI", "EXECUTOR", "IMPLEMENTER", "REVIEWER", "SANDBOX", "PRODUCT"]);
    expect(c.ACCEPTANCE_COMMAND).toBe("node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu");
    for (const bad of [null, undefined, {state: "UNAVAILABLE", items: []}, {state: "ERROR", items: []}]) {
      const u = c.buildSetupChecks(bad);
      expect(u.rows.map((r: any) => r.state)).toEqual(Array(6).fill("UNKNOWN")); expect(u).toMatchObject({readable: false, pass: 0, blocked: 0, unknown: 6, kind: "UNKNOWN"}); expect(u.rows[0].reasons).toEqual(["EXECUTOR_STATUS_UNREADABLE"]);
    }
  });
  it("Claude CLI row: any non-sign-in blocker of either role makes it BLOCKED (also a deleted launcher with cli FOUND); both roles clean means PASS even if the CLI is only missing from PATH; without readiness it falls back to cli.state", async () => {
    const CLI_NF = "CLAUDE_CLI_NOT_FOUND", SHIM = "CLAUDE_CLI_SHIM_UNSUPPORTED";
    const both = (a: string[], b: string[] = a) => ({implementer: role(a), reviewer: role(b, "READY", "reviewer")});
    const cli = async (c: any, rd: any) => (await rowsOf({...body(), ...lc({cli: c}, rd)})).CLI;
    // the review's payload: cli FOUND, both roles ready:false with CLAUDE_CLI_NOT_FOUND (the verified launcher file was deleted) -> BLOCKED and the headline says so
    expect(await cli({state: "FOUND"}, both([CLI_NF]))).toMatchObject({state: "BLOCKED", reasons: [CLI_NF]});
    const head = await panelFor({...body(), ...lc({cli: {state: "FOUND"}}, both([CLI_NF]))});
    expect(within(head).find(n => n.dataset.setupKind)!.dataset.setupKind).toBe("BLOCKED"); expect(within(head).find(n => n.dataset.setupKind)!.dataset.setupBlocked).not.toBe("0");
    expect(await cli({state: "SHIM_UNSUPPORTED"}, both([SHIM]))).toMatchObject({state: "BLOCKED", reasons: [SHIM]});
    expect(await cli({state: "NOT_FOUND"}, both([CLI_NF]))).toMatchObject({state: "BLOCKED", reasons: [CLI_NF]});
    expect(await cli({state: "FOUND"}, both([CLI_NF], []))).toMatchObject({state: "BLOCKED", reasons: [CLI_NF]}); // one role is enough
    expect(await cli({state: "FOUND"}, both([], [SHIM]))).toMatchObject({state: "BLOCKED", reasons: [SHIM]});
    expect(await cli({state: "FOUND"}, both(["SOME_NEW_CLI_CODE"]))).toMatchObject({state: "BLOCKED", reasons: ["SOME_NEW_CLI_CODE"]}); // a code this version does not know still blocks
    expect(await cli({state: "FOUND"}, both([CLI_NF, "CLAUDE_PROFILE_LOGIN_REQUIRED"], [CLI_NF]))).toMatchObject({reasons: [CLI_NF]}); // deduplicated, sign-in codes excluded
    // L1: the server adds no CLI blocker (verified launcher on record) although the CLI is not on PATH -> PASS, with the PATH fact as a note
    expect(await cli({state: "NOT_FOUND"}, both([]))).toMatchObject({state: "PASS", reasons: [], note: "NOT_FOUND"});
    expect(await cli({state: "SHIM_UNSUPPORTED"}, both([]))).toMatchObject({state: "PASS", note: "SHIM_UNSUPPORTED"});
    expect(await cli({state: "FOUND"}, both([]))).toMatchObject({state: "PASS", note: null});
    expect(await cli(undefined, both([]))).toMatchObject({state: "PASS"}); // no cli object, both roles clean
    expect(await cli({state: "FOUND"}, {implementer: role(["CLAUDE_PROFILE_LOGIN_REQUIRED"], "LOGIN_REQUIRED"), reviewer: role([], "READY", "reviewer")})).toMatchObject({state: "PASS"}); // a sign-in problem is not a CLI problem
    // the panel keeps the PATH fact visible as a note on the PASS row (and shows no note when the CLI was found)
    for (const [st, want] of [["NOT_FOUND", "was not found on PATH"], ["SHIM_UNSUPPORTED", ".cmd/.bat launcher was found on PATH"]] as const) {
      const p = await panelFor({...body(), ...lc({cli: {state: st}}, both([]))});
      expect(rowNode(p, "CLI").dataset.setupState).toBe("PASS"); expect(within(rowNode(p, "CLI")).find(n => n.dataset.setupNote)!.dataset.setupNote).toBe(st); expect(text(rowNode(p, "CLI"))).toContain(want);
    }
    expect(within(rowNode(await panelFor(body()), "CLI")).some(n => n.dataset.setupNote)).toBe(false);
    // launcher-proof codes
    expect(await cli({state: "FOUND"}, both([PROV]))).toMatchObject({state: "BLOCKED", reasons: [PROV]});
    expect(await cli({state: "FOUND"}, {implementer: role(["CLAUDE_PACKAGE_PROVENANCE_REQUIRED"]), reviewer: role(["CLAUDE_LAUNCHER_PROVENANCE_CHANGED"], "READY", "reviewer")})).toMatchObject({reasons: ["CLAUDE_PACKAGE_PROVENANCE_REQUIRED", "CLAUDE_LAUNCHER_PROVENANCE_CHANGED"]});
    // without readiness: cli.state decides, nothing is invented
    expect(await cli({state: "NOT_FOUND"}, null)).toMatchObject({state: "BLOCKED", reasons: [CLI_NF]});
    expect(await cli({state: "SHIM_UNSUPPORTED"}, null)).toMatchObject({state: "BLOCKED", reasons: [SHIM]});
    expect(await cli({state: "FOUND"}, null)).toMatchObject({state: "UNKNOWN", reasons: ["LAUNCHER_PROOF_NOT_REPORTED"]});
    expect(await cli(undefined, null)).toMatchObject({state: "UNKNOWN", reasons: ["CLI_STATUS_NOT_REPORTED"]});
    expect(await cli({state: "WEIRD"}, null)).toMatchObject({state: "UNKNOWN"});
    // one role unreadable: a visible blocker still blocks, otherwise it is not PASS
    expect(await cli({state: "FOUND"}, {implementer: role([]), reviewer: null})).toMatchObject({state: "UNKNOWN", reasons: ["LAUNCHER_PROOF_NOT_REPORTED"]});
    expect(await cli({state: "FOUND"}, {implementer: null, reviewer: role([], "READY", "reviewer")})).toMatchObject({state: "UNKNOWN"});
    expect(await cli({state: "FOUND"}, {implementer: role([CLI_NF]), reviewer: null})).toMatchObject({state: "BLOCKED", reasons: [CLI_NF]});
  });
  it("executor row (L2): Local Claude not enabled is BLOCKED with EXECUTOR_NOT_ENABLED and a fix that points to the existing Enable action; enabled is PASS; unreported is UNKNOWN", async () => {
    const ex = async (active: any, state: string) => (await rowsOf({...body({active}), ...lc({cli: {state: "FOUND"}, state}, {implementer: role([]), reviewer: role([], "READY", "reviewer")})})).EXECUTOR;
    expect(await ex({reason: "EXECUTOR_NOT_CONFIGURED"}, "NOT_CONFIGURED")).toMatchObject({state: "BLOCKED", reasons: ["EXECUTOR_NOT_ENABLED"]});
    expect(await ex({reason: "EXECUTOR_UNKNOWN"}, "NOT_CONFIGURED")).toMatchObject({state: "BLOCKED", reasons: ["EXECUTOR_UNKNOWN"]});
    expect(await ex({reason: "EXECUTOR_CONFIG_INVALID"}, "READY")).toMatchObject({state: "BLOCKED", reasons: ["EXECUTOR_CONFIG_INVALID"]});
    expect(await ex({reason: "LOCAL_CLAUDE"}, "READY")).toMatchObject({state: "PASS", reasons: []});
    expect(await ex({reason: "LOCAL_CLAUDE"}, "NOT_CONFIGURED")).toMatchObject({state: "PASS"}); // the server's own active executor wins
    expect(await ex(undefined, "NOT_CONFIGURED")).toMatchObject({state: "BLOCKED", reasons: ["EXECUTOR_NOT_ENABLED"]}); // no active field: the state decides
    expect(await ex(undefined, "PROVENANCE_MISSING")).toMatchObject({state: "BLOCKED", reasons: ["EXECUTOR_NOT_ENABLED"]});
    expect(await ex(undefined, "READY")).toMatchObject({state: "UNKNOWN", reasons: ["ACTIVE_EXECUTOR_NOT_REPORTED"]});
    const none = (await rowsOf({executors: {FAKE: {state: "TEST_ONLY"}}, sandbox: {state: "AVAILABLE", providerId: "x"}})).EXECUTOR;
    expect(none).toMatchObject({state: "UNKNOWN", reasons: ["EXECUTOR_STATUS_NOT_REPORTED"]});
    // the panel: headline BLOCKED, plain words, the fix names the existing Enable button, and there is still no button here
    const root = await panelFor({...body({active: {reason: "EXECUTOR_NOT_CONFIGURED"}}), ...lc({cli: {state: "FOUND"}, state: "NOT_CONFIGURED"}, {implementer: role([]), reviewer: role([], "READY", "reviewer")})});
    const row = rowNode(root, "EXECUTOR");
    expect(row.dataset.setupState).toBe("BLOCKED"); expect(text(row)).toContain("Local Claude is not enabled"); expect(within(row).find(n => n.dataset.setupFix)!.dataset.setupFix).toBe("setup.fix.EXECUTOR"); expect(text(row)).toContain("Press Enable in the executors panel");
    expect(within(root).find(n => n.dataset.setupKind)!.dataset.setupKind).toBe("BLOCKED"); expect(within(root).filter(n => n.tagName === "BUTTON").length).toBe(0);
  });
  it("sign-in rows: READY is PASS, LOGIN_REQUIRED / expired / REFUSED are BLOCKED with the Founder's own command as text, unknown or missing data is UNKNOWN", async () => {
    const r = async (impl: any, rev: any, prof: any = undefined) => rowsOf({...body(), ...lc({cli: {state: "FOUND"}}, {implementer: impl, reviewer: rev}), claudeProfiles: prof});
    const ok = role([], "READY", "reviewer");
    const a = await r(role(["CLAUDE_PROFILE_LOGIN_REQUIRED"], "LOGIN_REQUIRED"), ok, {implementer: {state: "LOGIN_REQUIRED", loginCommand: CMD("implementer")}, reviewer: {state: "READY", loginCommand: CMD("reviewer")}});
    expect(a.IMPLEMENTER).toMatchObject({state: "BLOCKED", reasons: ["CLAUDE_PROFILE_LOGIN_REQUIRED"], login: CMD("implementer")}); expect(a.REVIEWER).toMatchObject({state: "PASS", login: null});
    const b = await r(role([], "READY"), role(["CLAUDE_PROFILE_LOGIN_EXPIRED"], "READY", "reviewer"));
    expect(b.REVIEWER).toMatchObject({state: "BLOCKED", reasons: ["CLAUDE_PROFILE_LOGIN_EXPIRED"], login: CMD("reviewer")}); expect(b.IMPLEMENTER.state).toBe("PASS");
    const c = await r(role(["CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"], "REFUSED", "implementer", {loginCommand: null}), ok);
    expect(c.IMPLEMENTER).toMatchObject({state: "BLOCKED", reasons: ["CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"], login: null});
    const d = await r(role([], "REFUSED", "implementer", {loginCommand: null}), ok, {implementer: {state: "REFUSED", reason: "PROFILE_DIR_FORBIDDEN"}, reviewer: {state: "READY"}});
    expect(d.IMPLEMENTER).toMatchObject({state: "BLOCKED", reasons: ["CLAUDE_PROFILE_REFUSED:PROFILE_DIR_FORBIDDEN"]});
    const e = await r(role([], "SOMETHING"), ok); expect(e.IMPLEMENTER).toMatchObject({state: "BLOCKED", reasons: ["CLAUDE_PROFILE_STATE:SOMETHING"]});
    const f = await rowsOf({...body(), claudeProfiles: undefined, executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND"}}, FAKE: {state: "TEST_ONLY"}}}); // neither profiles nor readiness
    expect(f.IMPLEMENTER).toMatchObject({state: "UNKNOWN", reasons: ["PROFILE_STATUS_NOT_REPORTED"]}); expect(f.REVIEWER.state).toBe("UNKNOWN");
    const g = await rowsOf({...body(), executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND"}}, FAKE: {state: "TEST_ONLY"}}, claudeProfiles: {implementer: {state: "lowercase"}, reviewer: {state: "READY"}}});
    expect(g.IMPLEMENTER).toMatchObject({state: "UNKNOWN", reasons: ["PROFILE_STATE_UNRECOGNISED"]}); expect(g.REVIEWER.state).toBe("PASS");
    const h = await rowsOf({...body(), executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND"}}, FAKE: {state: "TEST_ONLY"}}}); // profiles alone are enough for PASS
    expect(h.IMPLEMENTER.state).toBe("PASS");
    const lp = await rowsOf({...body(), executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND"}}, FAKE: {state: "TEST_ONLY"}}, claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", loginCommand: CMD("implementer")}, reviewer: {state: "READY"}}}); // no readiness reading
    expect(lp.IMPLEMENTER).toMatchObject({state: "BLOCKED", reasons: ["CLAUDE_PROFILE_LOGIN_REQUIRED"], login: CMD("implementer")});
  });
  it("sandbox and product rows: AVAILABLE passes with the provider, UNAVAILABLE is BLOCKED with the exact reason and detail and blocks the product, a missing report is UNKNOWN", async () => {
    const un = await rowsOf(body({sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "SELF_TEST_FAILED", providerId: null}}));
    expect(un.SANDBOX).toMatchObject({state: "BLOCKED", reasons: ["SANDBOX_UNAVAILABLE", "SELF_TEST_FAILED"], providerId: null}); expect(un.PRODUCT).toMatchObject({state: "BLOCKED", reasons: ["SANDBOX_UNAVAILABLE"]});
    const nodetail = await rowsOf(body({sandbox: {state: "UNAVAILABLE", reason: null, detail: null}})); expect(nodetail.SANDBOX.reasons).toEqual(["SANDBOX_UNAVAILABLE"]);
    const none = await rowsOf(body({sandbox: undefined}));
    expect(none.SANDBOX).toMatchObject({state: "UNKNOWN", reasons: ["SANDBOX_STATUS_NOT_REPORTED"]}); expect(none.PRODUCT).toMatchObject({state: "UNKNOWN", reasons: ["SANDBOX_STATUS_NOT_REPORTED"]});
    const weird = await rowsOf(body({sandbox: {state: "MAYBE"}})); expect(weird.SANDBOX.state).toBe("UNKNOWN");
    const mixed = (await load("setup-check-core.js")).buildSetupChecks(await mapped({...body({sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER"}}), executors: {LOCAL_CLAUDE: {state: "READY"}, FAKE: {state: "TEST_ONLY"}}})); // CLI row unknown + sandbox blocked
    expect(mixed.unknown).toBeGreaterThan(0); expect(mixed.blocked).toBeGreaterThan(0); expect(mixed.kind).toBe("BLOCKED"); // a blocked row outranks unknown ones
    const all5 = (await load("setup-check-core.js")).buildSetupChecks(await mapped(body({sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER"}}))); expect(all5).toMatchObject({blocked: 2, pass: 4, kind: "BLOCKED"});
  });
  const panelFor = async (b: any, lang = "en") => {
    const {ctx} = await mkCtx({}, lang); const m = await load("views", "setup-check.js");
    return (await m.setupCheckPanel(ctx, b === null ? null : await mapped(b))) as N;
  };
  const rowNode = (root: N, id: string) => within(root).find(n => n.dataset.setupRow === id)!;
  it("renders the six rows with states and exact reasons in plain words, the Founder's login command only as text, the acceptance command as text, and never a button that runs something", async () => {
    const root = await panelFor(body({executors: {LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", cli: {state: "SHIM_UNSUPPORTED", path: "C:\\x\\claude.cmd"}, readiness: {implementer: role(["CLAUDE_CLI_SHIM_UNSUPPORTED", "CLAUDE_PROFILE_LOGIN_REQUIRED"], "LOGIN_REQUIRED"), reviewer: role(["CLAUDE_CLI_SHIM_UNSUPPORTED"], "READY", "reviewer")}}, FAKE: {state: "TEST_ONLY"}},
      claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", loginCommand: CMD("implementer")}, reviewer: {state: "READY", loginCommand: CMD("reviewer")}}, sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "SELF_TEST_ERROR", providerId: null}}));
    expect(root.id).toBe("settings-setup");
    expect(within(root).filter(n => n.dataset.setupRow).map(n => [n.dataset.setupRow, n.dataset.setupState])).toEqual([["CLI", "BLOCKED"], ["EXECUTOR", "PASS"], ["IMPLEMENTER", "BLOCKED"], ["REVIEWER", "PASS"], ["SANDBOX", "BLOCKED"], ["PRODUCT", "BLOCKED"]]);
    const head = within(root).find(n => n.dataset.setupKind)!;
    expect(head.dataset).toMatchObject({setupKind: "BLOCKED", setupPass: "2", setupBlocked: "4", setupUnknown: "0"}); expect(text(head)).toContain("2 of 6 checks pass, 4 blocked, 0 unknown");
    expect(text(rowNode(root, "CLI"))).toContain("npm .cmd/.bat launcher"); expect(text(rowNode(root, "CLI"))).toContain("Install the native Claude Code CLI");
    expect(text(rowNode(root, "IMPLEMENTER"))).toContain("not signed in"); expect(text(rowNode(root, "IMPLEMENTER"))).toContain("Sign in yourself");
    const login = within(root).filter(n => n.dataset.setupLogin); expect(login.map(n => n.dataset.setupLogin)).toEqual(["IMPLEMENTER"]); expect(text(login[0])).toBe(CMD("implementer"));
    expect(text(rowNode(root, "SANDBOX"))).toContain("No verified sandbox exists"); expect(text(rowNode(root, "SANDBOX"))).toContain("self-test could not run"); expect(text(rowNode(root, "SANDBOX"))).toContain("WSL2");
    expect(text(rowNode(root, "PRODUCT"))).toContain("cannot run without a verified sandbox");
    const kit = within(root).find(n => n.dataset.setupKit)!; expect(text(kit)).toBe("node docs/acceptance/windows/founder-acceptance.mjs --distro Ubuntu"); expect(kit.tagName).toBe("PRE");
    expect(within(root).filter(n => n.tagName === "BUTTON" || n.tagName === "A").length).toBe(0); // nothing here runs or changes anything
    expect(text(rowNode(root, "IMPLEMENTER"))).toContain("To sign in, run this command"); expect(text(rowNode(root, "REVIEWER"))).not.toContain("To sign in");
    const fixOf = (id: string) => within(rowNode(root, id)).find(n => n.dataset.setupFix)?.dataset.setupFix ?? null;
    expect([fixOf("CLI"), fixOf("EXECUTOR"), fixOf("IMPLEMENTER"), fixOf("REVIEWER"), fixOf("SANDBOX"), fixOf("PRODUCT")]).toEqual(["setup.fix.CLI.install", null, "setup.fix.profile.login", null, "setup.fix.SANDBOX", "setup.fix.PRODUCT.blocked"]); // a PASS row has no fix text
    const badgeCls = (id: string) => String(within(rowNode(root, id)).find(n => String(n.className).split(" ").includes("badge"))!.className);
    expect(badgeCls("REVIEWER")).toContain("badge-ok"); expect(badgeCls("CLI")).toContain("badge-risk"); expect(badgeCls("CLI")).not.toContain("badge-ok"); expect(badgeCls("REVIEWER")).not.toContain("badge-risk");
    const refused = await panelFor(body({executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND"}, readiness: {implementer: role(["CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN"], "REFUSED", "implementer", {loginCommand: null}), reviewer: role([PROV], "READY", "reviewer")}}, FAKE: {state: "TEST_ONLY"}}, claudeProfiles: undefined, sandbox: undefined}));
    expect(text(within(refused).find(n => n.dataset.setupReason === "CLAUDE_PROFILE_REFUSED:SETTINGS_NOT_WRITTEN")!)).toContain("(SETTINGS_NOT_WRITTEN)");
    expect(within(rowNode(refused, "IMPLEMENTER")).find(n => n.dataset.setupFix)!.dataset.setupFix).toBe("setup.fix.profile.refused");
    expect(within(rowNode(refused, "CLI")).find(n => n.dataset.setupFix)!.dataset.setupFix).toBe("setup.fix.CLI.launcher");
    expect(within(rowNode(refused, "SANDBOX")).find(n => n.dataset.setupFix)!.dataset.setupFix).toBe("setup.fix.UNKNOWN");
    expect(String(within(rowNode(refused, "SANDBOX")).find(n => String(n.className).split(" ").includes("badge"))!.className)).not.toMatch(/badge-ok|badge-risk/); // UNKNOWN is neutral
    expect(text(root)).not.toMatch(/claude\.cmd|C:\\x/); // the server's paths and free text are never shown
  });
  it("L3: the acceptance command is shown as text with a note that the file may not exist in this build yet; L4: token-like values in the login command or the provider id are masked or hidden", async () => {
    const root = await panelFor(body());
    expect(text(within(root).find(n => n.dataset.setupKitPending)!)).toContain("has not been merged into your build yet");
    const TOKEN = "sk-ant-api03-ABCDEFGHIJKLMNOP1234567", core = await load("project-core.js");
    const dirty = `$env:CLAUDE_CONFIG_DIR='C:\\Users\\f\\.uasco\\implementer'; $env:ANTHROPIC_API_KEY='${TOKEN}'; claude`;
    const exec = core.mapExecutors({...body({claudeProfiles: {implementer: {state: "LOGIN_REQUIRED", loginCommand: dirty}, reviewer: {state: "READY", loginCommand: CMD("reviewer")}}, sandbox: {state: "AVAILABLE", providerId: TOKEN}}),
      executors: {LOCAL_CLAUDE: {state: "READY", cli: {state: "FOUND"}, readiness: {implementer: role(["CLAUDE_PROFILE_LOGIN_REQUIRED"], "LOGIN_REQUIRED", "implementer", {loginCommand: dirty}), reviewer: role([], "READY", "reviewer")}}, FAKE: {state: "TEST_ONLY"}}});
    expect(JSON.stringify(exec)).not.toContain("sk-ant"); // profiles, readiness and sandbox mappers all mask
    expect(exec.profiles[0].loginCommand).toContain("[REDACTED]"); expect(exec.profiles[0].loginCommand.startsWith("$env:CLAUDE_CONFIG_DIR='")).toBe(true); expect(exec.profiles[0].loginCommand).toContain("claude");
    expect(exec.readiness.implementer.loginCommand).toContain("[REDACTED]"); expect(exec.sandbox.providerId).toBeNull();
    // ordinary values pass through untouched
    expect(core.mapExecutors(body()).profiles[0].loginCommand).toBe(CMD("implementer")); expect(core.mapExecutors(body()).readiness.implementer.loginCommand).toBe(CMD("implementer")); expect(core.mapExecutors(body()).sandbox.providerId).toBe("wsl-unshare-v1");
    // and the panel built from it never contains the token, while the sandbox row stays PASS without a provider name
    const ctx2 = await mkCtx({}, "en"); const panel = (await (await load("views", "setup-check.js")).setupCheckPanel(ctx2.ctx, exec)) as N;
    expect(text(panel)).not.toContain("sk-ant"); expect(text(panel)).toContain("[REDACTED]"); expect(within(panel).some(n => n.dataset.setupProvider)).toBe(false);
  });
  it("an all-PASS reading says so without claiming a verified product; unknown and unreadable readings never show PASS; unknown reasons stay raw and flagged", async () => {
    const pass = await panelFor(body({sandbox: {state: "AVAILABLE", providerId: "wsl-unshare-v1"}}));
    const errCtx = await mkCtx({}, "en"); const err = (await (await load("views", "setup-check.js")).setupCheckPanel(errCtx.ctx, null)) as N; expect(text(err)).toContain("Error"); // no reading at all is also UNKNOWN, with the generic error note
    expect(within(pass).find(n => n.dataset.setupKind)!.dataset.setupKind).toBe("UNKNOWN"); // the bridge is untested
    expect(text(rowNode(pass, "SANDBOX"))).toContain("wsl-unshare-v1"); expect(text(rowNode(pass, "PRODUCT"))).toContain("Start the product after a delivery");
    expect(within(pass).some(n => n.dataset.setupLogin)).toBe(false);
    const c = await load("setup-check-core.js");
    const offCtx = await mkCtx({}, "en");
    const off = (await (await load("views", "setup-check.js")).setupCheckPanel(offCtx.ctx, {state: "UNAVAILABLE", items: []})) as N;
    expect(within(off).find(n => n.dataset.setupKind)!.dataset.setupKind).toBe("UNKNOWN"); expect(within(off).every(n => !n.dataset.setupState || n.dataset.setupState === "UNKNOWN")).toBe(true);
    expect(text(off)).toContain("not available to the desktop"); expect(text(rowNode(off, "CLI"))).toContain("could not be read");
    const odd = await panelFor(body({sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "BRAND_NEW_DETAIL"}}));
    expect(text(within(odd).find(n => n.dataset.setupReason === "BRAND_NEW_DETAIL")!)).toBe("BRAND_NEW_DETAIL (not recognised)");
  });
  it("is the first block of Settings, reads no extra path, and has complete Turkish text", async () => {
    const {ctx, calls} = await mkCtx({}, "en"); const v = await load("views", "settings.js");
    const root = (await v.render(ctx, ROUTE)) as N;
    const idx = (id: string) => all(root).findIndex(n => n.id === id);
    expect(idx("settings-setup")).toBeGreaterThan(-1); expect(idx("settings-setup")).toBeLessThan(idx("settings-connection"));
    expect(new Set(calls)).toEqual(new Set(["/health", "/v1/adapters", "/v1/capabilities", "/v1/control/status", "/v1/factory", "/v1/system/executors"]));
    const en = await load("locales", "en.js"), tr = await load("locales", "tr.js"), E = en.default ?? en, T = tr.default ?? tr;
    const keys = Object.keys(E).filter(k => k.startsWith("setup."));
    expect(keys.length).toBe(48);
    for (const k of keys) expect(T[k], k).toBeTruthy();
    const trRoot = await panelFor(body(), "tr");
    expect(text(rowNode(trRoot, "CLI"))).toContain("Claude CLI (yerel kurulum)"); expect(text(trRoot)).toContain("Windows kabul denetimi");
  });
});
