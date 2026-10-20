// //TR: Bu test FA-V2-PRODUCT (WP-ACADEMY) Skill Academy salt-okunur dikey kesitini doğrular: (1) CONTROL-API — GET /v1/academy gerçek Work OS journal'ından tenant kapsamlı akademi okuma-modelini döner (boşsa dürüst boş dizi + null metrikler; yazma yok); GET /v1/academy/:id adreslenebilir lrn_/src_ kaydı döner, geçersiz kimlik 400, eksik/başka tenant 404; token yoksa 403; POST yok (404). (2) ALLOW-LIST — apps/desktop/main.mjs B4-ALLOWLIST izole değerlendirilir ve saldırgan girdilere karşı fail-closed: yalnız çıplak /v1/academy ve /v1/academy/(lrn|src)_<24hex> kabul; sorgu, sondaki eğik çizgi, alt yol, yanlış önek/büyük-küçük/uzunluk, non-hex ve her POST reddedilir; EXTRA_GET_ROUTES kümesi büyümez (güvenlik anlık görüntüsü ux-shell/firstrun korunur). (3) GÖRÜNÜM — views/academy.js yalnız GET /v1/academy'ye bağlanır, HİÇBİR veri uydurmaz; DÜRÜSTLÜK: bir öğrenme/yetkinlik kataloğudur, sertifika/eğitim kanıtı DEĞİLDİR — sertifikalı daima 0, proficiency NOT_EVALUATED, terfi yalnız salt-okunur bilgi/çalıştırılamaz aday (authorityEffect NONE), backend boş/okunamazsa dürüst EMPTY/UNAVAILABLE. (4) academy.* sözlüğü EN/TR'de birebirdir.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {SkillAcademy} from "../core/academy/academy.js";
import {buildServer} from "../apps/control-api/src/server.js";

const sha = (v: unknown) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const REGISTRY = path.resolve("registries/role-definitions.json");

// ---------------- (1) CONTROL-API ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: App[] = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-uxacad-")); });
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
function mkApp(tenantId = "tA"): App {
  fs.mkdirSync(runtime(), {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), dataDir: dataDir(), tenantId, port: 3210, logger: false});
  apps.push(app); return app;
}
const get = (app: App, url: string, headers: Record<string, string> = hdr) => app.inject({method: "GET", url, headers});
// Aynı dataDir'e akademi kaydı tohumlar; sunucu store'u journal'ı yeniden okur (ikinci store yok, aynı hash zinciri).
function seedSource(tenantId = "tA", text = "Node.js fs.realpathSync resolves symlinks before containment.") {
  const store = new WorkOsStore(dataDir());
  const academy = new SkillAcademy(store, {repoRoot: path.join(tmp, "repo"), registryFile: REGISTRY});
  return academy.registerSource({tenantId}, {url: "https://nodejs.org/api/fs.html", version: "22.11.0", publisher: "OpenJS Foundation", sourceTrust: "OFFICIAL", license: "MIT", sha256: sha(text), freshnessTTLDays: 30}, "researcher").entity;
}

describe("WP-ACADEMY — GET /v1/academy read-only control-api route", () => {
  it("returns the honest empty read-model on a fresh store (empty arrays, null metrics, no write)", async () => {
    const app = mkApp();
    const r = await get(app, "/v1/academy");
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.learnings).toEqual([]);
    expect(b.sources).toEqual([]);
    expect(b.reuses).toEqual([]);
    expect(b.globalKnowledge).toEqual([]);
    // §5.3: veri yokken metrik null (uydurulmaz); yanlış sertifika oranı null (0/0), asla sahte bir sayı değil.
    expect(b.metrics.gapDetect).toBeNull();
    expect(b.metrics.falseCertificationRate).toBeNull();
    expect(b.metrics.gapDetectPrecision).toBeNull();
  });
  it("reflects a really-registered source and serves it by addressable id", async () => {
    const src = seedSource();
    expect(src.sourceId).toMatch(/^src_[0-9a-f]{24}$/);
    const app = mkApp();
    const list = (await get(app, "/v1/academy")).json();
    expect(list.sources.length).toBe(1);
    expect(list.sources[0].sourceId).toBe(src.sourceId);
    expect(list.metrics.sourceCredibility.total).toBe(1);
    expect(list.learnings).toEqual([]); // kaynak kaydı öğrenme/sertifika anlamına gelmez
    const one = await get(app, `/v1/academy/${src.sourceId}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().source.sourceId).toBe(src.sourceId);
  });
  it("another tenant never sees a tenant-scoped source", async () => {
    seedSource("tA");
    const app = mkApp("tB");
    expect((await get(app, "/v1/academy")).json().sources).toEqual([]);
  });
  it("rejects malformed ids (400) and honestly 404s unknown records", async () => {
    const app = mkApp();
    for (const bad of ["bad", "lrn_zzz", "LRN_" + "a".repeat(24), "lrn_" + "a".repeat(23), "lrn_" + "a".repeat(25), "xrn_" + "a".repeat(24), "lrn_" + "ag".repeat(12)])
      expect((await get(app, `/v1/academy/${bad}`)).statusCode, bad).toBe(400);
    expect((await get(app, `/v1/academy/lrn_${"a".repeat(24)}`)).statusCode).toBe(404);
    expect((await get(app, `/v1/academy/src_${"a".repeat(24)}`)).statusCode).toBe(404);
  });
  it("requires the control token and exposes no write (POST is not a route)", async () => {
    const app = mkApp();
    expect((await get(app, "/v1/academy", {host: "127.0.0.1:3210"})).statusCode).toBe(403);
    const post = await app.inject({method: "POST", url: "/v1/academy", headers: hdr, payload: {}});
    expect(post.statusCode).toBe(404);
  });
});

// ---------------- (2) ALLOW-LIST (adversarial, isolated) ----------------
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string, ret: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return new Function(`${m![1]}\nreturn ${ret};`)() as (v: unknown) => boolean;
};
const LRN = "lrn_" + "ab".repeat(12);
const SRC = "src_" + "cd".repeat(12);

describe("WP-ACADEMY — read-only allow-list is fail-closed", () => {
  const getAllowed = block("B4-ALLOWLIST", "desktopExtraGetPathAllowed");
  const postAllowed = block("B5-POST-ALLOWLIST", "desktopPostPathAllowed");

  it("accepts exactly the bare list path and canonical lrn_/src_ detail ids", () => {
    expect(getAllowed("/v1/academy")).toBe(true);
    expect(getAllowed(`/v1/academy/${LRN}`)).toBe(true);
    expect(getAllowed(`/v1/academy/${SRC}`)).toBe(true);
  });
  it("rejects ANY query string on the list path (it takes no parameters)", () => {
    for (const q of ["?", "?x=1", "?id=" + LRN, `?limit=1`, "?cursor=abc"]) expect(getAllowed(`/v1/academy${q}`), q).toBe(false);
  });
  it("rejects wrong prefix, wrong case, wrong length, non-hex and query on detail ids", () => {
    const bad = [
      `/v1/academy/${LRN.toUpperCase()}`,
      `/v1/academy/LRN_${"ab".repeat(12)}`,
      `/v1/academy/lrn_${"ab".repeat(11)}`,   // 22 hex
      `/v1/academy/lrn_${"ab".repeat(13)}`,   // 26 hex
      `/v1/academy/xrn_${"ab".repeat(12)}`,   // wrong prefix
      `/v1/academy/prj_${"ab".repeat(12)}`,   // unrelated prefix
      `/v1/academy/lrn_${"ag".repeat(12)}`,   // non-hex 'g'
      `/v1/academy/${LRN}?x=1`                // query on detail
    ];
    for (const p of bad) expect(getAllowed(p), p).toBe(false);
  });
  it("rejects trailing slashes, sub-paths and near-miss list paths", () => {
    for (const p of ["/v1/academy/", `/v1/academy/${LRN}/`, `/v1/academy/${LRN}/sources`, "/v1/academies", "/v1/academy/sources", `/v1/academy/${SRC}/x`])
      expect(getAllowed(p), p).toBe(false);
  });
  it("never allows a write (POST) to any academy path", () => {
    for (const p of ["/v1/academy", `/v1/academy/${LRN}`, `/v1/academy/${SRC}`]) expect(postAllowed(p), `POST ${p}`).toBe(false);
  });
  it("does NOT grow the EXTRA_GET_ROUTES set (security snapshot stays frozen; academy is admitted by a dedicated pattern)", () => {
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set.includes("/v1/academy")).toBe(false);
  });
});

// ---------------- (3) VIEW (honesty, fake DOM) ----------------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  // Gerçek DOM gibi: innerHTML etiketleri ayrıştırıp eleman düğümü üretir (savunma testinin mutasyonda gerçekten kırılması için).
  set innerHTML(v: string) {
    this.children = []; this._text = "";
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g; let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(String(v)))) { if (m.index > last) this.append(String(v).slice(last, m.index)); if (!m[1]) this.append(new N(this.doc, m[2])); last = re.lastIndex; }
    if (last < String(v).length) this.append(String(v).slice(last));
  }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
}
class D { body: N; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; } }
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byData = (root: N, k: string, v?: string) => all(root).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const byId = (root: N, id: string) => all(root).find(n => n.id === id);
const kpi = (root: N, id: string) => all(root).find(n => n.dataset.kpi === id);

async function mkCtx(getFn: (p: string) => any, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, rerender: async () => {}};
  return {ctx, doc, calls};
}
const fail = (p: string) => { throw new Error(`${p}: HTTP 404`); };
const PROMOTED = {learningId: "lrn_" + "11".repeat(12), roleId: "UASCO-0001", guildId: "G01", status: "PROMOTED_KNOWLEDGE", trigger: "CAPABILITY_GAP", hypothesis: "realpath before containment",
  promotion: {knowledgeStatus: "READONLY_KNOWLEDGE", executable: false, authorityEffect: "NONE", reviewerEvidence: {sha256: "a".repeat(64)}, promotedAt: "2026-10-15T00:00:00.000Z"}};
const OPEN = {learningId: "lrn_" + "22".repeat(12), roleId: "UASCO-0002", guildId: "G01", status: "GAP_DETECTED", trigger: "REAL_MISSION", hypothesis: "h", promotion: null};
const liveAcademy = (over: Record<string, any> = {}) => ({
  learnings: [PROMOTED, OPEN], sources: [{sourceId: "src_" + "33".repeat(12), sourceTrust: "OFFICIAL", status: "ACTIVE", scope: {global: false}}],
  reuses: [], globalKnowledge: [{learningId: PROMOTED.learningId, roleId: "UASCO-0001", guildId: "G01", hypothesis: "h", knowledgeStatus: "READONLY_KNOWLEDGE"}],
  metrics: {gapDetect: {total: 2, byTrigger: {REAL_MISSION: 1, CAPABILITY_GAP: 1, RELEASE_DRIFT: 0, FAILED_EVAL: 0}}, gapDetectPrecision: null, gapDetectRecall: null,
    sourceCredibility: {total: 1, byTrust: {OFFICIAL: 1, STANDARD: 0, VENDOR_DOC: 0, ACADEMIC: 0, COMMUNITY_LOWER_TRUST: 0, UNTRUSTED: 0}},
    knowledgeFreshness: {numerator: 1, denominator: 1, rate: 1}, labPassRate: null, promotionReversalRate: {numerator: 0, denominator: 1, rate: 0},
    reuseSuccess: null, falseCertificationRate: {numerator: 0, denominator: 1, rate: 0}, timeToAcquireMs: null},
  ...over
});

describe("WP-ACADEMY — Skill Academy view honesty", () => {
  it("binds only to GET /v1/academy and renders the read-model", async () => {
    const academy = await load("views", "academy.js");
    const {ctx, doc, calls} = await mkCtx(p => (p === "/v1/academy" ? liveAcademy() : fail(p)));
    const root = await academy.render(ctx);
    expect(calls).toEqual(["/v1/academy"]);
    expect(byId(root, "view-title")!.getAttribute("tabindex")).toBe("-1");
    void doc;
  });
  it("shows a learning/competency CATALOG, never certification: certified is 0 and proficiency is NOT_EVALUATED", async () => {
    const academy = await load("views", "academy.js");
    const {ctx} = await mkCtx(() => liveAcademy());
    const root = await academy.render(ctx);
    const cert = kpi(root, "academy-certified")!;
    expect(cert.textContent).toContain("0");
    expect(cert.textContent).not.toMatch(/certified\s*:\s*[1-9]/i);
    expect(byData(root, "proficiency", "NOT_EVALUATED")).toBeTruthy();
    // Dürüstlük uyarısı açıkça görünür.
    expect(byData(root, "honesty")!.textContent.toLowerCase()).toContain("catalog");
  });
  it("a promoted learning is shown as read-only knowledge with authority NONE and is never 'certified'/'trained'", async () => {
    const academy = await load("views", "academy.js");
    const {ctx} = await mkCtx(() => liveAcademy());
    const root = await academy.render(ctx);
    const row = all(root).find(n => n.dataset.learning === PROMOTED.learningId)!;
    expect(row.dataset.promoted).toBe("1");
    expect(row.textContent).toContain("READONLY_KNOWLEDGE");
    expect(byData(row, "authority", "NONE")).toBeTruthy();
    expect(byData(row, "executable", "false")).toBeTruthy();
    expect(row.textContent).not.toMatch(/certified|trained|sertifika/i);
  });
  it("honest EMPTY when the backend verifiably has no records (nothing invented)", async () => {
    const academy = await load("views", "academy.js");
    const empty = {learnings: [], sources: [], reuses: [], globalKnowledge: [], metrics: {gapDetect: null, gapDetectPrecision: null, gapDetectRecall: null, sourceCredibility: null, knowledgeFreshness: null, labPassRate: null, promotionReversalRate: null, reuseSuccess: null, falseCertificationRate: null, timeToAcquireMs: null}};
    const {ctx} = await mkCtx(p => (p === "/v1/academy" ? empty : fail(p)));
    const root = await academy.render(ctx);
    expect(kpi(root, "academy-curricula")!.textContent).toContain("0");
    // Metrikler veri yokken "No data" gösterir, uydurma sayı yok.
    expect(byData(root, "academyMetrics")!.textContent).toContain("No data");
    expect(all(root).some(n => n.dataset.learning)).toBe(false);
  });
  it("honest UNAVAILABLE when the read fails; no fabricated data", async () => {
    const academy = await load("views", "academy.js");
    const {ctx} = await mkCtx(() => fail("/v1/academy")); // 404 -> UNAVAILABLE
    const root = await academy.render(ctx);
    expect(byData(root, "academyState", "UNAVAILABLE")).toBeTruthy();
    expect(all(root).some(n => n.dataset.learning)).toBe(false);
  });
});

// ---------------- (4) locale parity ----------------
describe("WP-ACADEMY — academy.* locale parity (TR/EN identical)", () => {
  it("every academy.* key is identical and non-empty in TR and EN", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("academy.") || k === "area.academy.title" || k === "area.academy.desc").sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(20);
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); }
  });
});

// ---------------- (5) negative / a11y / parity hardening ----------------
// //TR: Olumsuz yollar: 404/5xx/ağ hatası/bozuk yanıt hiçbir sahte değer üretmez; sertifikalı KPI'sı yalnız doğrulanmış okumada 0, aksi halde asla sayı değil.
describe("WP-ACADEMY — negative paths never fabricate or claim verification", () => {
  const kinds: Array<[string, (p: string) => any, string]> = [
    ["HTTP 404", p => { throw new Error(`${p}: HTTP 404`); }, "UNAVAILABLE"],
    ["HTTP 500", p => { throw new Error(`${p}: HTTP 500`); }, "ERROR"],
    ["network failure", () => { throw new Error("fetch failed"); }, "OFFLINE"],
    ["malformed (string)", () => "not-an-object", "ERROR"],
    ["malformed (null)", () => null, "ERROR"]
  ];
  for (const [name, fn, state] of kinds) {
    it(`${name} -> ${state}: no rows, no metrics, certified KPI is not a verified 0`, async () => {
      const academy = await load("views", "academy.js");
      const {ctx} = await mkCtx(fn);
      const root = await academy.render(ctx);
      const st = all(root).filter(n => n.dataset.academyState);
      expect(st.length).toBeGreaterThan(0);
      for (const s of st) expect(s.dataset.academyState).toBe(state);
      expect(all(root).some(n => n.dataset.learning || n.dataset.source || n.dataset.knowledge)).toBe(false);
      expect(byData(root, "academyMetrics")).toBeUndefined();
      expect(all(root).some(n => /^(Verified)$/.test(n.textContent.trim()) && n.className.includes("pill"))).toBe(false);
      expect(kpi(root, "academy-certified")!.dataset.state).not.toBe("VERIFIED");
      // Dürüstlük notu hata durumunda da görünür; proficiency daima NOT_EVALUATED.
      expect(byData(root, "honesty")).toBeTruthy();
      expect(byData(root, "proficiency", "NOT_EVALUATED")).toBeTruthy();
    });
  }
  it("a live read with some malformed records drops them instead of inventing fields", async () => {
    const academy = await load("views", "academy.js");
    const {ctx} = await mkCtx(() => liveAcademy({learnings: [PROMOTED, {learningId: "bad"}, null, 5]}));
    const root = await academy.render(ctx);
    const rows = all(root).filter(n => n.dataset.learning);
    expect(rows.map(r => r.dataset.learning)).toEqual([PROMOTED.learningId]);
  });
  it("hostile text in API data is rendered as text, never as markup", async () => {
    const academy = await load("views", "academy.js");
    // Görünüm API verisini birebir yalnız hata mesajında (stateBlock → res.message) gösterir; yük gerçek api.js yolundan (bridge hatası) geçer.
    const payloads = ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "<iframe src=javascript:alert(1)></iframe>", `"quoted" & 'single' &amp; <b>`];
    for (const payload of payloads) {
      const {ctx} = await mkCtx(() => { throw new Error(payload); });
      const root = await academy.render(ctx);
      const carriers = all(root).filter(n => n.textContent === payload);
      expect(carriers.length, `payload reaches DOM verbatim: ${payload}`).toBeGreaterThan(0);
      expect(all(root).filter(n => ["IMG", "SCRIPT", "IFRAME"].includes(n.tagName)).map(n => n.tagName)).toEqual([]);
    }
  });
});

// //TR: Erişilebilirlik: h1 odaklanabilir, tablolar caption+scope=col taşır, durum bloğu role=status, KPI grubu etiketli, düğme yok/yazılı.
describe("WP-ACADEMY — accessibility", () => {
  it("h1 is focusable, KPI group and note regions are labelled, tables have caption and col headers", async () => {
    const academy = await load("views", "academy.js");
    const {ctx} = await mkCtx(() => liveAcademy());
    const root = await academy.render(ctx);
    const h1s = all(root).filter(n => n.tagName === "H1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].getAttribute("tabindex")).toBe("-1");
    const grp = all(root).find(n => n.getAttribute("role") === "group")!;
    expect((grp.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
    expect(byData(root, "honesty")!.getAttribute("role")).toBe("note");
    // UI-035: yaşam döngüsü tablosu eklendi (3→4); aynı caption/th scope=col denetimleri yeni tabloya da uygulanır.
    const tables = all(root).filter(n => n.tagName === "TABLE");
    expect(tables.length).toBe(4);
    for (const t of tables) {
      const cap = t.children.find(c => c.tagName === "CAPTION")!;
      expect(cap.textContent.length).toBeGreaterThan(0);
      const ths = all(t).filter(n => n.tagName === "TH");
      expect(ths.length).toBeGreaterThan(0);
      for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
    }
  });
  it("failure state is announced via role=status and any button is explicitly type=button", async () => {
    const academy = await load("views", "academy.js");
    const {ctx} = await mkCtx(() => fail("/v1/academy"));
    const root = await academy.render(ctx);
    for (const s of all(root).filter(n => n.dataset.academyState)) expect(s.getAttribute("role")).toBe("status");
    for (const b of all(root).filter(n => n.tagName === "BUTTON")) expect(b.getAttribute("type")).toBe("button");
  });
});

// //TR: EN/TR eşitliği: görünümün kullandığı anahtarların yer tutucuları ({x}) iki dilde aynıdır.
describe("WP-ACADEMY — placeholder parity", () => {
  it("every academy.* key has identical {placeholder} sets in EN and TR, and state/hint keys exist for every failure state", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const k of Object.keys(en).filter(k => k.startsWith("academy."))) expect(ph(tr[k]), k).toEqual(ph(en[k]));
    for (const s of ["UNAVAILABLE", "OFFLINE", "ERROR"]) {
      for (const d of [tr, en]) { expect(d[`academy.state.${s}`], s).toBeTruthy(); expect(d[`academy.hint.${s}`], s).toContain("{source}"); }
    }
  });
  describe("UI-201 evidence library", () => {
    const LRN = PROMOTED.learningId, SRC = "src_" + "33".repeat(12), GONE = "src_" + "99".repeat(12);
    const evLearning = {...PROMOTED, sourceIds: [SRC, GONE, "evil<script>", SRC], labRunRefs: ["run-1", 5, null], negativeEvalRefs: ["neg-1"], reviewerRunRef: "rr-1",
      labResult: {passed: true, deterministicTestRefs: ["t1", "t2"], recordedAt: "2026-10-14T00:00:00.000Z"}, drift: [{}],
      promotion: {...PROMOTED.promotion, supportingSourceIds: [SRC], reviewerEvidence: {ref: `audit/evidence/skill-academy/${LRN}/REVIEWER.json#sha256=${"a".repeat(64)}`, sha256: "a".repeat(64)}}};
    const reuse = {reuseId: "ru1", learningId: LRN, outcome: "SUCCESS", missionRef: "m-1", evidenceRef: "e", at: "2026-10-16T00:00:00.000Z"};
    it("maps hostile/malformed evidence fail-closed and bounded", async () => {
      const core = await load("academy-core.js");
      const bad = core.mapAcademy({learnings: [{...PROMOTED, sourceIds: Array.from({length: 80}, (_, i) => "src_" + i.toString(16).padStart(24, "0")).concat(["<img>"]), labRunRefs: Array(80).fill("r".repeat(999)),
        labResult: {passed: "yes", deterministicTestRefs: "x"}, promotion: {...PROMOTED.promotion, reviewerEvidence: {ref: "../../etc/passwd#sha256=" + "a".repeat(64), sha256: "a".repeat(64)}}}], reuses: [reuse, {learningId: "bad"}, null]});
      const e = bad.learnings[0].evidence;
      expect(e.sourceIds.length).toBe(50); expect(e.labRunRefs.length).toBe(50); expect(e.labRunRefs[0].length).toBe(200);
      expect(e.labResult).toEqual({passed: null, testRefCount: 0, recordedAt: null}); expect(e.reviewerRef).toBeNull(); expect(e.linkage).toBe("NOT_VERIFIED");
      expect(bad.reuseEvents.length).toBe(1);
      const ok = core.mapAcademy({learnings: [evLearning], reuses: [reuse]}).learnings[0];
      expect(ok.evidence.sourceIds).toEqual([SRC, GONE]); expect(ok.evidence.labRunRefs).toEqual(["run-1"]); expect(ok.evidence.reviewerRef.sha256Short).toBe("a".repeat(12));
      expect(ok.evidence.driftCount).toBe(1); expect([ok.executable, ok.authorityEffect]).toEqual([false, "NONE"]);
      expect(core.mapAcademy(null).reuseEvents).toEqual([]);
    });
    it("renders per-learning details with UNKNOWN cross-ref, reuse events and NOT_VERIFIED, calling only /v1/academy", async () => {
      const academy = await load("views", "academy.js");
      const {ctx, calls} = await mkCtx(p => (p === "/v1/academy" ? liveAcademy({learnings: [evLearning, OPEN], reuses: [reuse]}) : fail(p)));
      const root = await academy.render(ctx);
      expect(calls).toEqual(["/v1/academy"]);
      const items = all(root).filter(n => n.tagName === "DETAILS" && "evidenceLearning" in n.dataset);
      expect(items.length).toBe(2);
      const xr = all(root).filter(n => "evidenceXref" in n.dataset).map(n => n.dataset.evidenceXref);
      expect(xr).toContain("FOUND"); expect(xr).toContain("UNKNOWN");
      expect(all(root).filter(n => "evidenceReuse" in n.dataset).length).toBe(1);
      expect(all(root).filter(n => n.dataset.evidenceLinkage === "NOT_VERIFIED").length).toBe(2);
      expect(all(root).some(n => n.tagName === "SUMMARY")).toBe(true);
    });
    it("renders failure and empty states honestly and keeps certified 0", async () => {
      const academy = await load("views", "academy.js");
      const f = await mkCtx(p => fail(p)); const rf = await academy.render(f.ctx);
      expect(all(rf).filter(n => "evidenceLearning" in n.dataset).length).toBe(0); expect(byId(rf, "academy-evidence")).toBeTruthy();
      const e = await mkCtx(p => (p === "/v1/academy" ? liveAcademy({learnings: []}) : fail(p))); const re = await academy.render(e.ctx);
      expect(all(re).filter(n => "evidenceLearning" in n.dataset).length).toBe(0);
    });
    it("adds only feature-unique academy-evidence-* classes that no other view uses", async () => {
      const css = fs.readFileSync(path.join(rend, "styles.css"), "utf8");
      const mine = [...new Set([...css.matchAll(/\.(academy-evidence-[a-z0-9-]+)/g)].map(m => m[1]))];
      expect(mine.length).toBeGreaterThanOrEqual(4);
      const viewDir = path.join(rend, "views");
      for (const c of mine) {
        // Base kuralları .evidence-* ile çakışmamalı: aynı seçici yalnız academy-evidence ön ekiyle var.
        expect(css.split(new RegExp("\\." + c + "(?![a-z0-9-])")).length - 1, c).toBeGreaterThan(0);
        for (const f of fs.readdirSync(viewDir).filter(n => n.endsWith(".js") && n !== "academy.js")) {
          expect(fs.readFileSync(path.join(viewDir, f), "utf8").includes(c), `${f} uses ${c}`).toBe(false);
        }
      }
      const acad = fs.readFileSync(path.join(viewDir, "academy.js"), "utf8");
      expect(/class:"evidence-/.test(acad)).toBe(false);
      for (const c of mine) expect(acad.includes(c), c).toBe(true);
      // Taban .evidence-item/.evidence-list kuralları dokunulmamış kalır (taban 4 seçici: list, item, item:hover, forced-colors).
      expect((css.match(/(^|[^-\w])\.evidence-(item|list)\b/gm) ?? []).length).toBe(4);
    });
    it("has EN/TR parity for academy.evidence.*", async () => {
      const en = (await load("locales", "en.js")).default ?? (await load("locales", "en.js")); const tr = (await load("locales", "tr.js")).default ?? (await load("locales", "tr.js"));
      const keys = (d: any) => Object.keys(d).filter(k => k.startsWith("academy.evidence.")).sort();
      expect(keys(en).length).toBeGreaterThan(10); expect(keys(tr)).toEqual(keys(en));
    });
  });
});

describe("UI-035 learning lifecycle counts", () => {
  const rows = (root: N) => all(root).filter(n => "academyLifecycleStatus" in n.dataset);
  it("lists all 14 statuses in core order with counts summing to learnings.length (verified)", async () => {
    const academy = await load("views", "academy.js"), core = await load("academy-core.js");
    const {ctx, calls} = await mkCtx(p => (p === "/v1/academy" ? liveAcademy({learnings: [PROMOTED, OPEN, {...OPEN, learningId: "lrn_" + "44".repeat(12)}, {learningId: "bad"}]}) : fail(p)));
    const root = await academy.render(ctx);
    expect(calls).toEqual(["/v1/academy"]);
    const rs = rows(root);
    expect(rs.map(r => r.dataset.academyLifecycleStatus)).toEqual([...core.LEARNING_STATUSES]);
    expect(rs.length).toBe(14);
    expect(rs.reduce((a, r) => a + Number(r.dataset.academyLifecycleCount), 0)).toBe(3);
    expect(rs.find(r => r.dataset.academyLifecycleStatus === "GAP_DETECTED")!.dataset.academyLifecycleCount).toBe("2");
    expect(rs.find(r => r.dataset.academyLifecycleStatus === "REVOKED")!.dataset.academyLifecycleCount).toBe("0");
    const panel = byId(root, "academy-lifecycle")!;
    expect(all(panel).some(n => ["BUTTON", "A", "FORM"].includes(n.tagName))).toBe(false);
    expect(all(panel).find(n => n.tagName === "CAPTION")).toBeTruthy();
    expect(all(panel).filter(n => n.tagName === "TH").every(n => n.getAttribute("scope") === "col")).toBe(true);
    expect(panel.textContent).not.toMatch(/academy\.lifecycle\./);
    expect(panel.textContent).not.toMatch(/certified|trained/i);
    expect(kpi(root, "academy-certified")!.textContent).toContain("0");
    expect(kpi(root, "academy-certified")!.textContent).toContain("NOT_VERIFIED");
    expect(rs.filter(r => r.dataset.academyLifecyclePromoted === "1").map(r => r.dataset.academyLifecycleStatus)).toEqual(core.PROMOTED_STATUSES);
  });
  it("shows state block and no counts when not verified; empty note on zero learnings", async () => {
    const academy = await load("views", "academy.js");
    for (const fn of [() => { throw new Error("fetch failed"); }, () => fail("/v1/academy"), () => null]) {
      const {ctx} = await mkCtx(fn); const root = await academy.render(ctx);
      expect(rows(root).length).toBe(0);
      expect(all(byId(root, "academy-lifecycle")!).some(n => n.getAttribute("role") === "status")).toBe(true);
    }
    const {ctx} = await mkCtx(() => liveAcademy({learnings: []})); const root = await academy.render(ctx);
    expect(rows(root).length).toBe(0);
    expect(byId(root, "academy-lifecycle")!.textContent).not.toMatch(/academy\.lifecycle\./);
  });
  it("has EN/TR parity for academy.lifecycle.*", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const ks = (d: any) => Object.keys(d).filter(k => k.startsWith("academy.lifecycle.")).sort();
    expect(ks(en).length).toBe(5); expect(ks(tr)).toEqual(ks(en));
  });
});
