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
  execOff?: boolean; profiles?: Record<string, any> | null; controlActive?: boolean | null; controlReason?: string; controlOff?: boolean; healthOff?: boolean; factoryOff?: boolean; sandbox?: any;
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
    expect(gets.sort()).toEqual(["/health", "/v1/control/status", "/v1/factory", "/v1/system/executors"]);
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
