// //TR: Bu test FA-V2-PRODUCT UI-074 "Provider Hub" salt-okunur dikey kesitini doğrular: (1) GERÇEK control-api — gerçek yürütücü kurulumu (kontrol kökü, provenance dosyası, kalıcı ayar, gerçek UASCO Claude profil dizinleri ve kimlik deposu varlığı, gerçek global stop dosyası) üzerinden dönen GET /v1/system/executors + GET /v1/control/status gövdeleri saf eşleyicilerden (providers-core.js) ve görünümden (views/providers.js) geçer; olumlu kontrol gerçek kanıtla READY olur ve her gerçek değişiklikte düşer. (2) İZİN LİSTESİ — iki GET zaten izinlidir (main.mjs/server.ts/app.js/control-boundary.mjs DEĞİŞMEZ, EXTRA_GET_ROUTES büyümez, yeni uç nokta/POST/IPC yok); görünüm yalnız bu iki GET'i okur ve hiçbir şeyi bağlamaz/etkinleştirmez. (3) SAF EŞLEYİCİ — bozuk/boş/çelişkili/yinelenen kayıt TÜM okumayı ERROR yapar, durumlar yükseltilmez, gizli alanlar (profil yolu, giriş komutu, anahtar/token) çıktıya taşınmaz. (4) TÜRETİM — sağlayıcı READY'si yalnız gerçek olumlu kanıttan; genel düzey TÜM beklenen sağlayıcılar üzerinden every/sayımla türer, tek bir "en yeni/temsilci" öğeye ve zaman damgasına bağlı DEĞİLDİR (eksik/bozuk zaman damgası bir öğeyi zararsız konuma sıralayamaz); tüm kombinasyonlar için READY ancak ve ancak her koşul sağlanırken verilir. (5) GÖRÜNÜM — dürüst boş/OFFLINE/UNAVAILABLE/ERROR durumları, başarısız sağlayıcı bağlantısı ekranı engellemez, gizli bilgi hiçbir yerde görünmez, ürün doğrulama sabiti hiçbir yerde üretilmez, API metni HTML değil metin olarak render edilir. (6) ERİŞİLEBİLİRLİK, TR/EN sözlük eşitliği ve rota devri (app.js VIEWS değişmez).
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {buildServer} from "../apps/control-api/src/server.js";
import {claudeProfileDir, CLAUDE_CREDENTIAL_STORE_FILE} from "../core/workos/claude-profiles.js";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const lib = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(root, "automation", "lib", ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (operations/posture/readiness testleri ile aynı desen) ----------------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  focused = false;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  focus() { this.focused = true; }
  scrollIntoView() { /* test double */ }
}
class D {
  body: N; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byData = (r: N, k: string, v?: string) => all(r).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const allData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const byId = (r: N, id: string) => all(r).find(n => n.id === id);
const cls = (n: N, c: string) => n.className.split(/\s+/).includes(c);
// Bütün render edilmiş metin + öznitelik/dataset değerleri (yasak sabit ve gizli bilgi taraması için).
const surface = (r: N) => all(r).map(n => `${n.textContent}|${n.className}|${[...n.attrs.values()].join(",")}|${Object.values(n.dataset).join(",")}`).join("\n");
const pills = (r: N) => allData(r, "pill").map(n => n.dataset.pill);
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `prov-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const overallOf = (r: N) => byData(r, "overall")!;
const cards = (r: N) => allData(r, "provider").filter(n => n.tagName === "LI" && n.dataset.providerKind !== "TEST");
const cardFor = (r: N, id: string) => cards(r).find(n => n.dataset.provider === id)!;
const findingEls = (r: N) => allData(r, "finding").filter(n => n.tagName === "LI");
const findingIds = (r: N) => findingEls(r).map(n => n.dataset.finding);
const field = (li: N, key: string) => allData(li, "field").find(n => n.dataset.field === key);
const sourcesOf = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const click = (n: N) => { const fns = n.ls.get("click"); expect(fns, "click listener").toBeTruthy(); fns!.forEach(f => f({})); };

// ---------------- fixtures (sözleşme biçiminde) ----------------
const CAPTURED = "2026-10-15T00:00:00.000Z";
// Sunucunun GÖNDERDİĞİ ama arayüzün ASLA göstermemesi gereken değerler (gizli bilgi taraması).
const SECRET_PATH = "C:\\Users\\victim\\AppData\\uasco-secret-profile\\implementer";
const SECRET_CMD = "$env:CLAUDE_CONFIG_DIR='C:\\Users\\victim\\AppData\\uasco-secret-profile\\implementer'; claude login";
const SECRET_KEY = ["sk", "ant", "api03", "ZZZZ0123456789SECRETKEY"].join("-"); // çalışma anında kurulur: kaynakta anahtar-benzeri değişmez yoktur (gizli bilgi tarayıcısı)
const LEAKS = ["victim", "uasco-secret-profile", "CLAUDE_CONFIG_DIR", "claude login", SECRET_KEY, "sk-ant"];
const profile = (role: string, over: Record<string, any> = {}) => ({role, state: "READY", settings: "PRESENT", credentialStore: "PRESENT", dir: SECRET_PATH, loginCommand: SECRET_CMD, loginHint: "run it yourself", apiKey: SECRET_KEY, token: SECRET_KEY, ...over});
const lc = (over: Record<string, any> = {}) => ({state: "READY", enabled: true, source: "SETTING", version: "2.1.292 (Claude Code)", provenanceCapturedAt: CAPTURED, ...over});
const LC_CLI_MISSING = () => ({state: "CLI_NOT_FOUND", enabled: false, source: "NONE"});
const LOGIN = {state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", settings: "PRESENT", credentialStore: "ABSENT"};
const execBody = (over: Record<string, any> = {}) => ({
  executors: {LOCAL_CLAUDE: lc(), FAKE: {state: "TEST_ONLY"}}, active: {reason: "LOCAL_CLAUDE"},
  sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: null, providerId: null},
  claudeProfiles: {implementer: profile("implementer"), reviewer: profile("reviewer")}, ...over
});
const ctlBody = (over: Record<string, any> = {}) => ({globalStop: {active: false}, workos: {state: "OK", reason: null, tornTail: null}, ...over});
const stopBody = (over: Record<string, any> = {}) => ctlBody({globalStop: {active: true, reason: "Founder requested stop", actor: "FOUNDER", activatedAt: "2026-10-17T11:00:00.000Z", ...over}});
const fail = (msg: string) => new Error(msg);
const EXE = "/v1/system/executors", CTL = "/v1/control/status";
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {[EXE]: execBody(), [CTL]: ctlBody(), ...over};
  if (!(p in m)) throw new Error(`${p}: HTTP 404`);
  const v = m[p];
  if (v instanceof Error) throw v;
  return v;
};

async function mkCtx(getFn: (p: string) => any, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [], posts: string[] = [];
  // Köprü: yazma/denetim çağrıları ASLA beklenmez; gelirse kaydedilir ve test başarısız olur.
  const bridge: Record<string, unknown> = {
    apiGet: async (p: string) => { calls.push(p); return getFn(p); },
    apiPost: async (p: string) => { posts.push(`apiPost ${p}`); throw new Error("POST must never be called"); },
    stop: async () => { posts.push("stop"); }, resume: async () => { posts.push("resume"); }, retryBlocked: async () => { posts.push("retryBlocked"); }
  };
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { nav.push(id); }, rerender: async () => {}, settleFocus: () => {},
    confirm: async () => { posts.push("confirm"); return false; }, refreshAll: async () => { posts.push("refreshAll"); },
    stop: async () => { posts.push("ctx.stop"); }, resume: async () => { posts.push("ctx.resume"); }, requestStop: () => { posts.push("ctx.requestStop"); }};
  return {ctx, doc, calls, nav, posts};
}
async function renderView(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "providers.js");
  const m = await mkCtx(getFn, lang);
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, ...m};
}
/** Ham sunucu gövdelerinden doğrudan saf eşleyiciler ile türetim (DOM'suz). */
async function derive(execRaw: any, ctlRaw: any = ctlBody(), opts: {executors?: string; control?: string} = {}) {
  const core = await load("providers-core.js"), ops = await load("operations-core.js");
  const executors = opts.executors ? {state: opts.executors, providers: null} : core.mapProvidersExecutors(execRaw);
  const control = opts.control ? {state: opts.control, control: null} : ops.mapOperationsControl(ctlRaw);
  return {core, executors, control, out: core.buildProviders({executors, control})};
}
/** "Hazır" görünmemesi gereken her durumda: genel göstergede olumlu ifade, başarı rozeti ve READY işareti yoktur. */
function expectNotReady(r: N, label: string) {
  const o = overallOf(r);
  expect(o.dataset.overall, label).not.toBe("READY");
  expect(allData(r, "overall", "READY").length, label).toBe(0);
  expect(o.textContent, label).not.toMatch(/healthy|all[- ]clear|\bfine\b|\bok\b|\bpass(ed)?\b|all expected providers ready|hazır$/i);
  expect(pills(o), label).not.toContain("VERIFIED");
  expect(pills(o), label).not.toContain("DONE");
  expect(allData(r, "provEmpty", "ready").length, label).toBe(0);
  expect(r.textContent, label).not.toContain("No open findings in the reported state");
  expect(surface(r), label).not.toContain(FORBIDDEN);
}
function expectNoLeaks(r: N, label: string) {
  const s = surface(r);
  for (const leak of LEAKS) expect(s, `${label}: ${leak}`).not.toContain(leak);
}

// ---------------- (1) GENUINE control-api -> mappers -> derivation -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-prov-")); });
afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
const control = () => path.join(tmp, "control");
const dataDir = () => path.join(tmp, "data");
const runtime = () => path.join(tmp, "runtime");
const cliPath = () => path.join(tmp, "bin", process.platform === "win32" ? "claude.exe" : "claude");
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
/** Gerçek yürütücü kurulumu: kontrol kökü (+yapılandırma kopyası), sahte CLI başlatıcısı, geçerli provenance ve kalıcı etkin ayarı (POST olmadan; gerçek dosyalar). */
function seedExecutor({cli = true, provenance = true, enabled = true}: {cli?: boolean; provenance?: boolean; enabled?: boolean} = {}) {
  fs.mkdirSync(path.join(control(), "config"), {recursive: true});
  fs.copyFileSync(path.join(root, "config", "execution-backends.json"), path.join(control(), "config", "execution-backends.json"));
  if (cli) { fs.mkdirSync(path.dirname(cliPath()), {recursive: true}); fs.writeFileSync(cliPath(), "fake launcher bytes"); }
  if (provenance) {
    fs.mkdirSync(path.join(control(), ".ai", "runtime"), {recursive: true});
    fs.writeFileSync(path.join(control(), ".ai", "runtime", "PROVIDER_PROVENANCE.json"), JSON.stringify({final: "PASS", capturedAt: CAPTURED, claude: {status: "PASS", provenanceLevel: "STANDALONE_LAUNCHER", resolvedPath: cliPath(), version: "9.9.9 (fake)", launcherSha256: sha(cliPath())}}));
  }
  if (enabled) {
    fs.mkdirSync(path.join(dataDir(), "settings"), {recursive: true});
    fs.writeFileSync(path.join(dataDir(), "settings", "executors.json"), JSON.stringify({localClaude: {enabled: true, enabledAt: CAPTURED, enabledBy: "test", launcherSha256: null, provenanceCapturedAt: null}}));
  }
}
function mkApp(cli: boolean): App {
  fs.mkdirSync(runtime(), {recursive: true}); fs.mkdirSync(control(), {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), repoRoot: root, controlRoot: control(), dataDir: dataDir(), tenantId: "tA", port: 3210, logger: false, executorSetup: {findClaudeCli: () => (cli ? cliPath() : null)}});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };
const realGet = (app: App) => async (p: string) => getJson(app, p);
async function realAssess(app: App) {
  const core = await load("providers-core.js"), ops = await load("operations-core.js");
  const raw = {executors: await getJson(app, EXE), control: await getJson(app, CTL)};
  const res = {executors: core.mapProvidersExecutors(raw.executors), control: ops.mapOperationsControl(raw.control)};
  return {core, raw, res, out: core.buildProviders(res)};
}
const signIn = (role: string) => fs.writeFileSync(path.join(claudeProfileDir(control(), role as any), CLAUDE_CREDENTIAL_STORE_FILE), "{}"); // yalnız VARLIK (içerik asla okunmaz)
const signOut = (role: string) => fs.rmSync(path.join(claudeProfileDir(control(), role as any), CLAUDE_CREDENTIAL_STORE_FILE), {force: true});

describe("Provider Hub — GENUINE control-api read-models flow through mappers, derivation and view", () => {
  it("a fresh real runtime (no CLI, nobody signed in) passes the strict mappers and is NOT READY: not installed, two profiles not connected, no executor selected — and no profile path or login command ever reaches the view", { timeout: 60_000 }, async () => {
    const app = mkApp(false);
    const {raw, res, out} = await realAssess(app);
    expect(raw.executors.executors).toEqual({LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", enabled: false, source: "NONE"}, FAKE: {state: "TEST_ONLY"}});
    expect(raw.executors.active).toEqual({reason: "EXECUTOR_NOT_CONFIGURED"});
    // Gerçek sunucu yanıtı gizli-benzeri alanları GERÇEKTEN taşır (yol + giriş komutu); eşleyici bunları düşürür.
    expect(JSON.stringify(raw.executors.claudeProfiles)).toContain("CLAUDE_CONFIG_DIR");
    expect(raw.executors.claudeProfiles.implementer).toMatchObject({state: "LOGIN_REQUIRED", settings: "PRESENT", credentialStore: "ABSENT"});
    expect(res.executors.state).toBe("VERIFIED");
    expect(res.control.state).toBe("VERIFIED");
    expect(JSON.stringify(res.executors)).not.toContain("CLAUDE_CONFIG_DIR");
    expect(JSON.stringify(res.executors)).not.toContain(control().replace(/\\/g, "\\\\"));
    expect(out.tier).toBe("NOT_READY");
    expect(out.providers.map((p: any) => [p.id, p.status])).toEqual([["LOCAL_CLAUDE", "NOT_INSTALLED"], ["CLAUDE_IMPLEMENTER", "NOT_CONNECTED"], ["CLAUDE_REVIEWER", "NOT_CONNECTED"]]);
    expect(out.routing).toMatchObject({mode: "NONE", reason: "EXECUTOR_NOT_CONFIGURED"});
    expect(out.findings.map((f: any) => f.id)).toEqual(["PROVIDER_NOT_INSTALLED", "PROVIDER_NOT_CONNECTED", "PROVIDER_NOT_CONNECTED", "ROUTING_NONE"]);
    expect(out.counts).toEqual({total: 3, ready: 0, notReady: 3, refused: 0, unverified: 0});
    const {root: r, posts} = await renderView(realGet(app));
    expect(overallOf(r).dataset.overall).toBe("NOT_READY");
    expectNotReady(r, "fresh");
    expect(cardFor(r, "LOCAL_CLAUDE").dataset.providerStatus).toBe("NOT_INSTALLED");
    expect(cardFor(r, "CLAUDE_REVIEWER").dataset.providerStatus).toBe("NOT_CONNECTED");
    expect(field(cardFor(r, "CLAUDE_REVIEWER"), "credential")!.dataset.value).toBe("ABSENT");
    expect(kpiValue(r, "ready")).toBe("0"); // gerçek sıfır: OKUNDU ve sıfırdır
    expectNoLeaks(r, "fresh");
    expect(posts).toEqual([]);
  });

  it("POSITIVE CONTROL on the real server: READY only with a real CLI + valid provenance + persisted enablement + two signed-in UASCO profiles + inactive Global Stop — and each real change takes it away again", { timeout: 90_000 }, async () => {
    seedExecutor();
    const app = mkApp(true);
    await getJson(app, EXE); // gerçek profil dizinlerini kurar
    signIn("implementer"); signIn("reviewer");
    const base = await realAssess(app);
    expect(base.raw.executors.executors.LOCAL_CLAUDE).toMatchObject({state: "READY", enabled: true, source: "SETTING", version: "9.9.9 (fake)", provenanceCapturedAt: CAPTURED});
    expect(base.raw.executors.active).toEqual({reason: "LOCAL_CLAUDE"});
    expect(base.raw.executors.claudeProfiles.reviewer).toMatchObject({state: "READY", settings: "PRESENT", credentialStore: "PRESENT"});
    expect(base.raw.control.globalStop).toEqual({active: false});
    expect(base.out.findings).toEqual([]);
    expect(base.out.tier).toBe("READY");
    expect(base.out.counts).toEqual({total: 3, ready: 3, notReady: 0, refused: 0, unverified: 0});
    const ready = await renderView(realGet(app));
    expect(overallOf(ready.root).dataset.overall).toBe("READY");
    expect(pills(overallOf(ready.root))).toContain("VERIFIED");
    expect(byData(ready.root, "provEmpty", "ready")).toBeTruthy();
    expect(cards(ready.root).map(c => [c.dataset.provider, c.dataset.providerStatus, c.dataset.positive])).toEqual([["LOCAL_CLAUDE", "READY", "1"], ["CLAUDE_IMPLEMENTER", "READY", "1"], ["CLAUDE_REVIEWER", "READY", "1"]]);
    expect(kpiValue(ready.root, "total")).toBe("3");
    expect(kpiValue(ready.root, "ready")).toBe("3");
    expect(field(cardFor(ready.root, "LOCAL_CLAUDE"), "version")!.textContent).toBe("9.9.9 (fake)");
    expect(field(cardFor(ready.root, "CLAUDE_IMPLEMENTER"), "credential")!.dataset.value).toBe("PRESENT"); // yalnız varlık
    expect(surface(ready.root)).not.toContain(FORBIDDEN);
    expectNoLeaks(ready.root, "ready");

    // (a) GERÇEK global stop dosyası -> HALTED (sağlayıcılar hazır kalsa da hiçbir şey yönlendirilmez).
    const gs = await lib("global-stop.mjs"), stopFile = path.join(runtime(), "GLOBAL_STOP.json");
    gs.activateGlobalStop(stopFile, "Founder requested from the providers test", "FOUNDER_CONTROL_TOWER");
    const stopped = await realAssess(app);
    expect(stopped.out.tier).toBe("HALTED");
    expect(stopped.out.counts.ready).toBe(3);
    expect(stopped.out.findings.map((f: any) => f.id)).toEqual(["STOP_ACTIVE"]);
    const stoppedView = await renderView(realGet(app));
    expectNotReady(stoppedView.root, "stop");
    expect(overallOf(stoppedView.root).dataset.overall).toBe("HALTED");
    gs.clearGlobalStop(stopFile, "FOUNDER");
    expect((await realAssess(app)).out.tier).toBe("READY");

    // (b) Gerçek kimlik deposu dosyası kaldırılır -> o profil bağlı değil.
    signOut("reviewer");
    const out = await realAssess(app);
    expect(out.out.tier).toBe("NOT_READY");
    expect(out.out.findings.map((f: any) => [f.id, f.params.providerId])).toEqual([["PROVIDER_NOT_CONNECTED", "CLAUDE_REVIEWER"]]);
    const outView = await renderView(realGet(app));
    expectNotReady(outView.root, "signed out");
    expect(cardFor(outView.root, "CLAUDE_REVIEWER").dataset.positive).toBe("0");
    expect(cardFor(outView.root, "CLAUDE_IMPLEMENTER").dataset.positive).toBe("1");
    signIn("reviewer");
    expect((await realAssess(app)).out.tier).toBe("READY");

    // (c) Başlatıcı baytları değişir: provenance artık eşleşmez (gerçek durum PROVENANCE_MISSING) AMA sunucu önbelleği hâlâ LOCAL_CLAUDE yönlendirir -> gerçek ayrışma, hazır SAYILMAZ.
    fs.writeFileSync(cliPath(), "launcher replaced after provenance was captured");
    const stale = await realAssess(app);
    expect(stale.raw.executors.executors.LOCAL_CLAUDE.state).toBe("PROVENANCE_MISSING");
    expect(stale.raw.executors.active).toEqual({reason: "LOCAL_CLAUDE"});
    expect(stale.out.tier).toBe("UNVERIFIED");
    expect(stale.out.findings.map((f: any) => f.id).sort()).toEqual(["PROVIDER_NOT_VERIFIED", "ROUTING_MISMATCH"]);
    expectNotReady((await renderView(realGet(app))).root, "stale route");
  });

  it("a real unsafe Global Stop file is reported fail-closed (HALTED, fail-closed wording) and a real CLI that was never enabled stays NOT_CONNECTED", { timeout: 60_000 }, async () => {
    seedExecutor({enabled: false});
    fs.mkdirSync(runtime(), {recursive: true});
    fs.writeFileSync(path.join(runtime(), "GLOBAL_STOP.json"), "{ not json");
    const app = mkApp(true);
    const {raw, out} = await realAssess(app);
    expect(raw.executors.executors.LOCAL_CLAUDE).toEqual({state: "NOT_CONFIGURED", enabled: false, source: "NONE", version: "9.9.9 (fake)", provenanceCapturedAt: CAPTURED});
    expect(out.providers[0]).toMatchObject({id: "LOCAL_CLAUDE", status: "NOT_CONNECTED", positive: false});
    expect(out.gate.state).toBe("ACTIVE");
    expect(out.tier).toBe("HALTED");
    const r = (await renderView(realGet(app))).root;
    expectNotReady(r, "unsafe stop");
    expect(findingIds(r)[0]).toMatch(/^STOP_(ACTIVE|FAIL_CLOSED)$/);
  });
});

// ---------------- (2) allow-list: nothing new, nothing written ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Provider Hub — only already-allow-listed read-only GETs are used (protected files unchanged, no new control path)", () => {
  it("both GET paths are already admitted by the desktop allow-list; nothing new is (no new endpoint, EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await lib("control-boundary.mjs");
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v);
    expect(allowed(EXE), EXE).toBe(true);
    expect(extra(EXE), EXE).toBe(true); // projectStudioGetAllowed (B4 bloğu) zaten izinler
    expect(boundary.desktopGetPathAllowed(CTL), CTL).toBe(true);
    for (const p of ["/v1/providers", "/v1/provider", "/v1/routing", "/v1/system/providers", "/v1/system/routing", "/v1/system/executors/", "/v1/system/executors?x=1", "/v1/system/executors/local-claude", "/v1/system/executors/local-claude/enable", "/v1/control/status?x=1", "/v1/control/stop"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes(EXE)).toBe(false);
    const serverSrc = fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8");
    for (const f of [mainSrc, serverSrc, fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8"), fs.readFileSync(path.join(root, "apps", "desktop", "preload.mjs"), "utf8")]) {
      expect(f).not.toMatch(/\/v1\/providers?\b|\/v1\/routing|\/v1\/system\/providers|uasco:providers?|uasco:provider-hub/);
    }
    // Sunucuda yürütücü rotası tek bir GET'tir ve yeni bir yazma rotası yoktur (etkinleştirme POST'u zaten vardı).
    expect(serverSrc.match(/app\.get\("\/v1\/system\/executors"/g)?.length).toBe(1);
    // Sistem altındaki yazma rotaları yalnız önceden var olanlardır; sağlayıcı/yönlendirme/yürütücü için yeni bir yazma rotası eklenmedi.
    expect((serverSrc.match(/app\.post\("\/v1\/system\/[^"]+"/g) ?? []).filter(x => /provider|rout|executor/.test(x))).toEqual(['app.post("/v1/system/executors/local-claude/enable"']);
    expect([...mainSrc.matchAll(/ipcMain\.handle\("(uasco:[a-z-]+)"/g)].map(m => m[1]).filter(s => /provider|executor|route|routing|connect|enable/.test(s))).toEqual([]);
  });
  it("providers.js / providers-core.js never write and never reach outside ctx.api: no post, bridge, stop/resume/retry/confirm, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "providers.js"), read("providers-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toMatch(/ctx\.stop\b|ctx\.resume\b|requestStop|retryBlocked|\.stop\(|\.resume\(|uasco:|confirm\(|enableLocalClaude|buildEnableExecutorRequest|refreshAll/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions|forms\.js|executors-panel/);
      // Gizli alanlar (yol, giriş komutu, anahtar/token) bu modüllerde okunmaz.
      expect(src).not.toMatch(/\.loginCommand|\.loginHint|\.dir\b|\.apiKey|\.token\b|process\.env|readFileSync/);
    }
    expect([...read("views", "providers.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort()).toEqual(["../components.js", "../model.js", "../providers-core.js", "../work-core.js"]);
    expect([...read("providers-core.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort()).toEqual(["./operations-core.js"]);
    for (const m of ["providersExecutors", "operationsControl"]) expect(read("views", "providers.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur (yeni POST yolu eklenmez); sağlayıcı erişimcisi yalnız sabit GET yolunu okur.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const accessors = read("api.js").split(String.fromCharCode(10)).filter(l => /^\s*async providersExecutors\(\)/.test(l));
    expect(accessors.length).toBe(1);
    expect(accessors[0]).not.toMatch(/post\(|apiPost|force/);
    expect(accessors[0]).toMatch(/await get\(PROVIDERS_PATH\)/);
  });
  it("zaman damgası hiçbir sıralama/karar anahtarı değildir: çekirdek ve görünüm Date.parse / getTime / zaman karşılaştırması kullanmaz (yalnız tek bir biçim doğrulayıcı new Date)", () => {
    for (const src of [read("providers-core.js"), read("views/providers.js")]) {
      expect(src).not.toMatch(/Date\.parse|getTime\(\)\s*[<>-]|Date\.now|\.localeCompare/);
    }
    expect(read("providers-core.js").match(/new Date\(/g)?.length).toBe(1);
    expect(read("views/providers.js")).not.toMatch(/new Date\(/);
    // Her sort() sabit kimlik sırası (idOrder) ya da bulgu önem sırası (rankOf) kullanır; zamana dayalı anahtar yok.
    for (const m of read("providers-core.js").matchAll(/\.sort\(([^\n]*)\)/g)) expect(m[1], m[0]).toMatch(/eo\(|po\(|rankOf|a\.i-b\.i|kind==="TEST"/);
  });
  it("the api layer requests exactly the two fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls, posts} = await mkCtx(serve());
    const core = await load("providers-core.js");
    expect(core.PROVIDER_SOURCE_PATHS).toEqual({executors: EXE, control: CTL});
    expect(core.PROVIDER_SOURCES).toEqual(["executors", "control"]);
    expect((await load("project-core.js")).EXECUTORS_PATH).toBe(core.EXECUTORS_PATH);
    expect((await ctx.api.providersExecutors()).state).toBe("VERIFIED");
    expect((await ctx.api.operationsControl()).state).toBe("VERIFIED");
    expect(calls).toEqual([EXE, CTL]);
    expect(ctx.api.providersExecutors.length).toBe(0);
    expect(posts).toEqual([]);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      expect((await ctx.api.providersExecutors()).state, thrown).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    expect((await ctx.api.providersExecutors()).state).toBe("ERROR");
  });
  it("a render never invokes any stop / resume / retry / confirm / POST path, even when its buttons are pressed; buttons only navigate to the existing screens", async () => {
    const r = await renderView(serve({[CTL]: stopBody(), [EXE]: execBody({claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: profile("reviewer")}})}));
    const buttons = all(r.root).filter(n => n.tagName === "BUTTON");
    expect(buttons.map(b => b.dataset.navigate).sort()).toEqual(["operations", "settings", "tower"]);
    for (const b of buttons) click(b);
    expect(r.nav.sort()).toEqual(["operations", "settings", "tower"]);
    expect(r.posts).toEqual([]);
    expect(all(r.root).filter(n => n.tagName === "FORM" || n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT")).toEqual([]);
    expect(r.calls.sort()).toEqual([CTL, EXE]);
  });
});

// ---------------- (3) pure mappers: fail-closed ----------------
const objOf = (rec: Record<string, any>, key = "LOCAL_CLAUDE") => ({[key]: rec});
const BAD: Array<[string, any]> = [
  ["null", null], ["undefined", undefined], ["string", "x"], ["number", 42], ["empty array", []], ["array of records", [execBody()]], ["empty object", {}],
  ["executors null", execBody({executors: null})], ["executors []", execBody({executors: []})], ["executors {}", execBody({executors: {}})], ["executors string", execBody({executors: "READY"})],
  ["executor id lower-case", execBody({executors: {local_claude: lc()}})], ["executor id with path", execBody({executors: {"../x": lc()}})],
  ["executor record string", execBody({executors: {LOCAL_CLAUDE: "READY"}})], ["executor record array", execBody({executors: {LOCAL_CLAUDE: []}})], ["executor record null", execBody({executors: {LOCAL_CLAUDE: null}})],
  ["state missing", execBody({executors: objOf({enabled: true})})], ["state lower-case", execBody({executors: objOf(lc({state: "ready"}))})], ["state number", execBody({executors: objOf(lc({state: 5}))})], ["state with markup", execBody({executors: objOf(lc({state: "<IMG>"}))})],
  ["enabled string", execBody({executors: objOf(lc({enabled: "yes"}))})], ["source unknown", execBody({executors: objOf(lc({source: "WEB"}))})], ["version number", execBody({executors: objOf(lc({version: 5}))})],
  ["captured unparseable", execBody({executors: objOf(lc({provenanceCapturedAt: "not-a-date"}))})], ["captured number", execBody({executors: objOf(lc({provenanceCapturedAt: 12345}))})],
  ["READY but not enabled (contradiction)", execBody({executors: objOf(lc({enabled: false, source: "NONE"}))})],
  ["NOT_CONFIGURED but enabled (contradiction)", execBody({executors: objOf(lc({state: "NOT_CONFIGURED", enabled: true, source: "SETTING"}))})],
  ["disabled yet source SETTING (contradiction)", execBody({executors: objOf(lc({state: "CLI_NOT_FOUND", enabled: false, source: "SETTING"}))})],
  ["enabled yet source NONE (contradiction)", execBody({executors: objOf(lc({enabled: true, source: "NONE"}))})],
  ["FAKE reports READY (contradiction)", execBody({executors: {LOCAL_CLAUDE: lc(), FAKE: {state: "READY"}}})],
  ["record id differs from key", execBody({executors: {LOCAL_CLAUDE: lc({id: "FAKE"})}})],
  ["duplicate executor ids (array form)", execBody({executors: [{id: "LOCAL_CLAUDE", ...lc()}, {id: "LOCAL_CLAUDE", ...lc({state: "NOT_CONFIGURED", enabled: false, source: "NONE"})}]})],
  ["array record without id", execBody({executors: [lc()]})],
  ["more than 20 executors", execBody({executors: Object.fromEntries(Array.from({length: 21}, (_, i) => [`EX_${i}`, {state: "NOT_CONFIGURED", enabled: false, source: "NONE"}]))})],
  ["active string", execBody({active: "LOCAL_CLAUDE"})], ["active array", execBody({active: []})], ["active without reason", execBody({active: {}})], ["active reason number", execBody({active: {reason: 5}})], ["active reason lower-case", execBody({active: {reason: "local_claude"}})], ["active reason markup", execBody({active: {reason: "<b>x</b>"}})],
  ["profile string", execBody({claudeProfiles: {implementer: "READY"}})], ["profile without state", execBody({claudeProfiles: {implementer: {}}})], ["profile state lower-case", execBody({claudeProfiles: {implementer: {state: "ready"}}})],
  ["profile READY but credential store ABSENT (contradiction)", execBody({claudeProfiles: {implementer: profile("implementer", {credentialStore: "ABSENT"})}})],
  ["profile LOGIN_REQUIRED but credential store PRESENT (contradiction)", execBody({claudeProfiles: {implementer: profile("implementer", {state: "LOGIN_REQUIRED", credentialStore: "PRESENT"})}})],
  ["profile settings unknown value", execBody({claudeProfiles: {implementer: profile("implementer", {settings: "WEIRD"})}})], ["profile credentialStore unknown value", execBody({claudeProfiles: {implementer: profile("implementer", {credentialStore: "MAYBE"})}})],
  ["profile reason is a path", execBody({claudeProfiles: {implementer: profile("implementer", {state: "REFUSED", reason: SECRET_PATH, credentialStore: "ABSENT"})}})],
  ["profile reason number", execBody({claudeProfiles: {implementer: profile("implementer", {reason: 5})}})],
  ["profile role key invalid", execBody({claudeProfiles: {Implementer: profile("implementer")}})], ["profile role differs from key", execBody({claudeProfiles: {implementer: profile("reviewer")}})],
  ["profiles error is not a code", execBody({claudeProfiles: {error: 5}})], ["profiles error is a path", execBody({claudeProfiles: {error: SECRET_PATH}})],
  ["profiles error mixed with roles (contradiction)", execBody({claudeProfiles: {error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE", implementer: profile("implementer")}})],
  ["duplicate profile roles (array form)", execBody({claudeProfiles: [profile("implementer"), profile("implementer", LOGIN)]})], ["profiles string", execBody({claudeProfiles: "READY"})]
];
describe("Provider Hub — pure mappers are fail-closed (whole read is ERROR, never partial)", () => {
  it("every malformed, empty, contradictory or duplicated shape rejects the WHOLE read", async () => {
    const core = await load("providers-core.js");
    expect(BAD.length).toBeGreaterThan(55);
    for (const [label, raw] of BAD) expect(core.mapProvidersExecutors(raw), label).toEqual({state: "ERROR", providers: null});
  });
  it("one bad record spoils an otherwise valid read: no half-trusted sibling survives, and valid shapes (object and array forms, extra unknown fields) are accepted", async () => {
    const core = await load("providers-core.js");
    const good = execBody();
    expect(core.mapProvidersExecutors(good).state).toBe("VERIFIED");
    expect(core.mapProvidersExecutors(execBody({claudeProfiles: {implementer: profile("implementer"), reviewer: {state: "ready"}}}))).toEqual({state: "ERROR", providers: null});
    expect(core.mapProvidersExecutors(execBody({executors: {LOCAL_CLAUDE: lc(), FAKE: {state: "TEST_ONLY"}, OTHER: "broken"}}))).toEqual({state: "ERROR", providers: null});
    const asArrays = execBody({executors: [{id: "LOCAL_CLAUDE", ...lc()}, {id: "FAKE", state: "TEST_ONLY"}], claudeProfiles: [profile("implementer"), profile("reviewer")]});
    const a = core.mapProvidersExecutors(asArrays), o = core.mapProvidersExecutors(good);
    expect(a.state).toBe("VERIFIED");
    expect(a).toEqual(o);
    const extras = execBody({futureField: {x: 1}, executors: {LOCAL_CLAUDE: lc({futureField: "x"}), FAKE: {state: "TEST_ONLY"}}});
    expect(core.mapProvidersExecutors(extras)).toEqual(o);
  });
  it("secrets never leave the mapper: path, login command, hint, api key and token fields are not carried, and the raw input is not mutated", async () => {
    const core = await load("providers-core.js");
    const raw = execBody(), before = structuredClone(raw);
    const m = core.mapProvidersExecutors(raw);
    expect(m.state).toBe("VERIFIED");
    expect(raw).toEqual(before);
    const json = JSON.stringify(m);
    for (const leak of LEAKS) expect(json, leak).not.toContain(leak);
    expect(m.providers.profiles.items[0]).toEqual({id: "CLAUDE_IMPLEMENTER", kind: "PROFILE", role: "implementer", serverState: "READY", status: "READY", positive: true, reason: null, enabled: null, source: null, version: null, capturedAt: null, credentialStore: "PRESENT", settings: "PRESENT"});
    // Sürüm metni yol/komut/markup içeriyorsa düşürülür (gösterilmez); okuma bozulmaz.
    for (const v of [SECRET_PATH, SECRET_CMD, "<img src=x onerror=alert(1)>", "a/b", "C:\\x", "x".repeat(200)]) {
      expect(core.mapProvidersExecutors(execBody({executors: {LOCAL_CLAUDE: lc({version: v})}})).providers.executors[0].version, v).toBeNull();
    }
    expect(core.mapProvidersExecutors(execBody({executors: {LOCAL_CLAUDE: lc({version: "2.1.292 (Claude Code)"})}})).providers.executors[0].version).toBe("2.1.292 (Claude Code)");
  });
  it("an unreadable claudeProfiles block is carried as UNAVAILABLE (not as 'no profiles'); a missing one as NOT_REPORTED; the order is the fixed id order", async () => {
    const core = await load("providers-core.js");
    const un = core.mapProvidersExecutors(execBody({claudeProfiles: {error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE"}}));
    expect(un.providers.profiles).toEqual({state: "UNAVAILABLE", error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE", items: []});
    const none = core.mapProvidersExecutors(execBody({claudeProfiles: undefined}));
    expect(none.providers.profiles).toEqual({state: "NOT_REPORTED", error: null, items: []});
    expect(core.mapProvidersExecutors(execBody({claudeProfiles: {}})).providers.profiles.state).toBe("NOT_REPORTED");
    const shuffled = core.mapProvidersExecutors(execBody({executors: {FAKE: {state: "TEST_ONLY"}, ZED: {state: "NOT_CONFIGURED", enabled: false, source: "NONE"}, ALPHA: {state: "UNSUPPORTED"}, LOCAL_CLAUDE: lc()}, claudeProfiles: {tester: profile("tester"), reviewer: profile("reviewer"), implementer: profile("implementer")}}));
    expect(shuffled.providers.executors.map((e: any) => e.id)).toEqual(["LOCAL_CLAUDE", "ALPHA", "ZED", "FAKE"]);
    expect(shuffled.providers.profiles.items.map((p: any) => p.role)).toEqual(["implementer", "reviewer", "tester"]);
  });
});

// ---------------- (4) honest-state classification ----------------
describe("Provider Hub — honest states: a provider is READY only on real positive evidence", () => {
  const status = async (rec: any) => (await load("providers-core.js")).mapProvidersExecutors(execBody({executors: {LOCAL_CLAUDE: rec}})).providers.executors[0];
  const pstatus = async (rec: any) => (await load("providers-core.js")).mapProvidersExecutors(execBody({claudeProfiles: {implementer: rec}})).providers.profiles.items[0];
  it("local executor: every recorded server state maps to exactly one honest status; unknown tokens stay UNKNOWN with the raw token preserved; only READY+enabled is positive", async () => {
    const table: Array<[string, any, string, boolean, string | null]> = [
      ["READY + enabled", lc(), "READY", true, null],
      ["READY, enablement not reported", {state: "READY"}, "NOT_VERIFIED", false, "ENABLEMENT_NOT_REPORTED"],
      ["NOT_CONFIGURED", {state: "NOT_CONFIGURED", enabled: false, source: "NONE"}, "NOT_CONNECTED", false, null],
      ["NOT_CONNECTED", {state: "NOT_CONNECTED"}, "NOT_CONNECTED", false, null],
      ["PROVENANCE_MISSING", {state: "PROVENANCE_MISSING", enabled: true, source: "SETTING"}, "NOT_VERIFIED", false, null],
      ["CLI_NOT_FOUND", {state: "CLI_NOT_FOUND", enabled: false, source: "NONE"}, "NOT_INSTALLED", false, null],
      ["NOT_INSTALLED", {state: "NOT_INSTALLED"}, "NOT_INSTALLED", false, null],
      ["UNSUPPORTED", {state: "UNSUPPORTED"}, "UNSUPPORTED", false, null],
      ["LICENSE_REQUIRED", {state: "LICENSE_REQUIRED"}, "LICENSE_REQUIRED", false, null],
      ["a state this screen has never seen", {state: "QUANTUM_READY"}, "UNKNOWN", false, null]
    ];
    for (const [label, rec, st, pos, reason] of table) {
      const e = await status(rec);
      expect({status: e.status, positive: e.positive, reason: e.reason}, label).toEqual({status: st, positive: pos, reason});
      expect(e.serverState, label).toBe(rec.state);
      expect(e.positive === true, label).toBe(e.status === "READY");
    }
  });
  it("profile: READY needs the credential store AND the settings file PRESENT (the same rule the run gate applies); anything weaker is NOT_VERIFIED, never ready", async () => {
    const table: Array<[string, any, string, boolean, string | null]> = [
      ["READY + both present", profile("implementer"), "READY", true, null],
      ["READY, credential store not reported", {state: "READY", settings: "PRESENT"}, "NOT_VERIFIED", false, "EVIDENCE_NOT_REPORTED"],
      ["READY, settings not reported", {state: "READY", credentialStore: "PRESENT"}, "NOT_VERIFIED", false, "EVIDENCE_NOT_REPORTED"],
      ["READY, settings MISSING", profile("implementer", {settings: "MISSING"}), "NOT_VERIFIED", false, "SETTINGS_MISSING"],
      ["READY, settings MODIFIED", profile("implementer", {settings: "MODIFIED"}), "NOT_VERIFIED", false, "SETTINGS_MODIFIED"],
      ["LOGIN_REQUIRED", LOGIN, "NOT_CONNECTED", false, "CLAUDE_PROFILE_LOGIN_REQUIRED"],
      ["REFUSED", {state: "REFUSED", reason: "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG", settings: "MISSING", credentialStore: "ABSENT"}, "REFUSED", false, "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG"],
      ["REFUSED without a reason", {state: "REFUSED"}, "REFUSED", false, null],
      ["a state this screen has never seen", {state: "FUTURE_STATE"}, "UNKNOWN", false, null],
      ["TEST_ONLY is not a profile state", {state: "TEST_ONLY"}, "UNKNOWN", false, null]
    ];
    for (const [label, rec, st, pos, reason] of table) {
      const p = await pstatus(rec);
      expect({status: p.status, positive: p.positive, reason: p.reason}, label).toEqual({status: st, positive: pos, reason});
      expect(p.positive === true, label).toBe(p.status === "READY");
    }
  });
  it("FAKE is a test executor: never counted as a provider, never READY, listed separately; a test-only state on LOCAL_CLAUDE does not satisfy the expected local provider", async () => {
    const {out} = await derive(execBody());
    expect(out.testOnly.map((e: any) => [e.id, e.status, e.positive])).toEqual([["FAKE", "TEST_ONLY", false]]);
    expect(out.providers.map((p: any) => p.id)).toEqual(["LOCAL_CLAUDE", "CLAUDE_IMPLEMENTER", "CLAUDE_REVIEWER"]);
    expect(out.counts.total).toBe(3);
    const t = await derive(execBody({executors: {LOCAL_CLAUDE: {state: "TEST_ONLY"}, FAKE: {state: "TEST_ONLY"}}}));
    expect(t.out.providers[0]).toMatchObject({id: "LOCAL_CLAUDE", status: "UNKNOWN", reason: "NOT_REPORTED", positive: false});
    expect(t.out.tier).not.toBe("READY");
  });
  it("a reported but unexpected provider joins the aggregate: an extra READY one counts, an extra NOT-READY one blocks READY", async () => {
    const ok = await derive(execBody({executors: {LOCAL_CLAUDE: lc(), EXTRA_CLI: lc({enabled: true}), FAKE: {state: "TEST_ONLY"}}}));
    expect(ok.out.providers.map((p: any) => p.id)).toEqual(["LOCAL_CLAUDE", "EXTRA_CLI", "CLAUDE_IMPLEMENTER", "CLAUDE_REVIEWER"]);
    expect(ok.out.tier).toBe("READY");
    const bad = await derive(execBody({executors: {LOCAL_CLAUDE: lc(), EXTRA_CLI: {state: "LICENSE_REQUIRED"}}}));
    expect(bad.out.tier).toBe("NOT_READY");
    expect(bad.out.findings.map((f: any) => f.id)).toEqual(["PROVIDER_LICENSE_REQUIRED"]);
    const prof = await derive(execBody({claudeProfiles: {implementer: profile("implementer"), reviewer: profile("reviewer"), tester: profile("tester", LOGIN)}}));
    expect(prof.out.tier).toBe("NOT_READY");
    expect(prof.out.providers.at(-1)).toMatchObject({id: "CLAUDE_TESTER", status: "NOT_CONNECTED"});
  });
});

// ---------------- (5) derivation ----------------
describe("Provider Hub — derivation: findings come from records, the level is the worst finding, READY needs complete positive evidence", () => {
  it("each scenario yields exactly the findings its records justify, worst first, with the level of the worst", async () => {
    const cases: Array<[string, any, any, string, string[]]> = [
      ["positive control", execBody(), ctlBody(), "READY", []],
      ["a refused profile outranks everything else", execBody({executors: {LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", enabled: false, source: "NONE"}}, claudeProfiles: {implementer: {state: "REFUSED", reason: "PROFILE_PATH_IS_LINK", settings: "MISSING", credentialStore: "ABSENT"}, reviewer: profile("reviewer")}}), stopBody(), "BLOCKED", ["PROVIDER_REFUSED", "STOP_ACTIVE", "PROVIDER_NOT_INSTALLED", "ROUTING_MISMATCH"]],
      ["global stop active, providers fine", execBody(), stopBody(), "HALTED", ["STOP_ACTIVE"]],
      ["global stop fail-closed (REJECTED verification)", execBody(), {globalStop: {active: true, reason: "GLOBAL_STOP_STATE_UNSAFE"}, verification: "REJECTED", workos: {state: "OK", reason: null, tornTail: null}}, "HALTED", ["STOP_FAIL_CLOSED"]],
      ["one profile not signed in", execBody({claudeProfiles: {implementer: profile("implementer"), reviewer: profile("reviewer", LOGIN)}}), ctlBody(), "NOT_READY", ["PROVIDER_NOT_CONNECTED"]],
      ["license gated extra provider", execBody({executors: {LOCAL_CLAUDE: lc(), ACME: {state: "LICENSE_REQUIRED"}}}), ctlBody(), "NOT_READY", ["PROVIDER_LICENSE_REQUIRED"]],
      ["unsupported extra provider", execBody({executors: {LOCAL_CLAUDE: lc(), ACME: {state: "UNSUPPORTED"}}}), ctlBody(), "NOT_READY", ["PROVIDER_UNSUPPORTED"]],
      ["no executor selected although everything else is fine", execBody({active: {reason: "EXECUTOR_NOT_CONFIGURED"}}), ctlBody(), "NOT_READY", ["ROUTING_NONE"]],
      ["only the test executor is selected", execBody({active: {reason: "FAKE"}}), ctlBody(), "NOT_READY", ["ROUTING_TEST_ONLY"]],
      ["active route not reported", execBody({active: undefined}), ctlBody(), "UNVERIFIED", ["ROUTING_UNKNOWN"]],
      ["active route is a reason this screen does not know", execBody({active: {reason: "SOMETHING_NEW"}}), ctlBody(), "UNVERIFIED", ["ROUTING_UNKNOWN"]],
      ["profiles block unreadable", execBody({claudeProfiles: {error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE"}}), ctlBody(), "UNVERIFIED", ["PROVIDER_UNKNOWN", "PROVIDER_UNKNOWN"]],
      ["profiles block missing", execBody({claudeProfiles: undefined}), ctlBody(), "UNVERIFIED", ["PROVIDER_UNKNOWN", "PROVIDER_UNKNOWN"]],
      ["local executor not reported", execBody({executors: {FAKE: {state: "TEST_ONLY"}}}), ctlBody(), "UNVERIFIED", ["PROVIDER_UNKNOWN", "ROUTING_MISMATCH"]]
    ];
    for (const [label, raw, ctl, tier, ids] of cases) {
      const {out} = await derive(raw, ctl);
      expect(out.tier, label).toBe(tier);
      const got = out.findings.map((f: any) => f.id);
      expect(got.slice().sort(), label).toEqual(ids.slice().sort());
      const order = ["BLOCKED", "HALTED", "UNKNOWN", "NOT_READY", "UNVERIFIED"];
      const sev = out.findings.map((f: any) => order.indexOf(f.severity));
      expect(sev, label).toEqual(sev.slice().sort((a: number, b: number) => a - b));
      if (tier !== "READY") expect(out.findings[0].severity, label).toBe(tier);
      expect(out.tier === "READY", label).toBe(out.findings.length === 0);
    }
  });
  it("counts exist only when the executors source was read (null, never 0); they always add up; unreadable sources are listed by name", async () => {
    const down = await derive(null, ctlBody(), {executors: "OFFLINE"});
    expect(down.out.counts).toBeNull();
    expect(down.out.providers).toBeNull();
    expect(down.out.testOnly).toBeNull();
    expect(down.out.routing).toBeNull();
    expect(down.out.unreadable).toEqual(["executors"]);
    expect(down.out.unknownState).toBe("OFFLINE");
    expect(down.out.tier).toBe("UNKNOWN");
    expect(down.out.findings.map((f: any) => [f.id, f.params.source, f.params.state])).toEqual([["SOURCE_UNREADABLE", "executors", "OFFLINE"]]);
    const mixes = [execBody(), execBody({claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: {state: "REFUSED"}}}), execBody({claudeProfiles: undefined, executors: {LOCAL_CLAUDE: {state: "PROVENANCE_MISSING"}}}), execBody({executors: {LOCAL_CLAUDE: lc(), X: {state: "UNSUPPORTED"}, Y: {state: "Q"}}})];
    for (const m of mixes) {
      const {out} = await derive(m);
      const c = out.counts;
      expect(c.ready + c.notReady + c.refused + c.unverified, JSON.stringify(c)).toBe(c.total);
      expect(c.total).toBe(out.providers.length);
    }
  });
  it("the Global Stop gate is a second source: unreadable gate means UNKNOWN even when every provider is ready; both unreadable is UNKNOWN; an active stop outranks an unreadable provider source", async () => {
    for (const st of ["OFFLINE", "UNAVAILABLE", "ERROR"]) {
      const d = await derive(execBody(), ctlBody(), {control: st});
      expect(d.out.counts.ready, st).toBe(3);
      expect(d.out.tier, st).not.toBe("READY");
      expect(d.out.tier, st).toBe("UNKNOWN");
      expect(d.out.gate, st).toBeNull();
      expect(d.out.findings.map((f: any) => [f.id, f.params.source, f.params.state]), st).toEqual([["SOURCE_UNREADABLE", "control", st]]);
    }
    const both = await derive(null, null, {executors: "ERROR", control: "OFFLINE"});
    expect(both.out.tier).toBe("UNKNOWN");
    expect(both.out.unknownState).toBe("OFFLINE");
    expect(both.out.unreadable).toEqual(["executors", "control"]);
    const stopped = await derive(null, stopBody(), {executors: "UNAVAILABLE"});
    expect(stopped.out.tier).toBe("HALTED");
    // Bozuk ama "okunmuş" bir yanıt da okunamayan kaynaktır (gövdesi kullanılamaz).
    const core = await load("providers-core.js");
    const weird = core.buildProviders({executors: {state: "VERIFIED"}, control: {state: "VERIFIED", control: {active: "no"}}});
    expect(weird.sources).toEqual({executors: {state: "ERROR"}, control: {state: "ERROR"}});
    expect(weird.tier).toBe("UNKNOWN");
    expect(core.buildProviders(undefined).tier).toBe("UNKNOWN");
    expect(core.buildProviders({}).tier).toBe("UNKNOWN");
    expect(core.buildProviders({executors: null, control: null}).tier).toBe("UNKNOWN");
  });
  it("the routing mode is derived from the recorded reason only: the real local executor, the test executor, no executor, or unrecognised — never assumed", async () => {
    const core = await load("providers-core.js");
    expect(["LOCAL_CLAUDE", "FAKE", "EXECUTOR_NOT_CONFIGURED", "EXECUTOR_UNKNOWN", "EXECUTOR_CONFIG_INVALID", "PROVENANCE_MISSING", "SOMETHING_NEW", null].map(r => core.routingModeOf(r))).toEqual(["LOCAL_CLAUDE", "TEST_ONLY", "NONE", "NONE", "NONE", "NONE", "UNKNOWN", "NOT_REPORTED"]);
    expect(core.NO_EXECUTOR_REASONS).toEqual(["EXECUTOR_NOT_CONFIGURED", "EXECUTOR_UNKNOWN", "EXECUTOR_CONFIG_INVALID", "PROVENANCE_MISSING"]);
    expect(core.ROUTING_MODES).toEqual(["LOCAL_CLAUDE", "TEST_ONLY", "NONE", "UNKNOWN", "NOT_REPORTED"]);
    expect(core.PROVIDER_STATUSES).toEqual(["READY", "NOT_CONNECTED", "NOT_VERIFIED", "NOT_INSTALLED", "UNSUPPORTED", "LICENSE_REQUIRED", "REFUSED", "TEST_ONLY", "UNKNOWN"]);
    expect(core.SEVERITIES).toEqual(["BLOCKED", "HALTED", "UNKNOWN", "NOT_READY", "UNVERIFIED"]);
    expect(core.TIERS).toEqual(["BLOCKED", "HALTED", "UNKNOWN", "NOT_READY", "UNVERIFIED", "READY"]);
    expect(core.EXPECTED_PROVIDERS).toEqual(["LOCAL_CLAUDE", "CLAUDE_IMPLEMENTER", "CLAUDE_REVIEWER"]);
    // Her üretilebilen bulgu kimliği, çekirdeğin ilan ettiği kümeden biridir ve önem düzeyiyle eşleşir.
    const universe = new Map<string, string>();
    for (const [sev, ids] of Object.entries(core.FINDING_IDS) as Array<[string, string[]]>) for (const id of ids) universe.set(id, sev);
    const seen = new Set<string>();
    for (const raw of [execBody({active: {reason: "FAKE"}}), execBody({active: {reason: "EXECUTOR_UNKNOWN"}}), execBody({active: undefined}), execBody({executors: {LOCAL_CLAUDE: {state: "PROVENANCE_MISSING"}}}),
      execBody({executors: {LOCAL_CLAUDE: lc(), A: {state: "UNSUPPORTED"}, B: {state: "LICENSE_REQUIRED"}, C: {state: "NOT_INSTALLED"}, D: {state: "NOT_CONNECTED"}, E: {state: "WHAT"}}, claudeProfiles: {implementer: {state: "REFUSED"}, reviewer: LOGIN}})]) {
      for (const f of (await derive(raw)).out.findings) { seen.add(f.id); expect(universe.get(f.id), f.id).toBe(f.severity); }
    }
    for (const f of (await derive(execBody(), stopBody())).out.findings) seen.add(f.id);
    for (const f of (await derive(execBody(), {globalStop: {active: true}, verification: "REJECTED"})).out.findings) seen.add(f.id);
    for (const f of (await derive(null, null, {executors: "OFFLINE", control: "ERROR"})).out.findings) seen.add(f.id);
    expect([...seen].filter(id => !universe.has(id))).toEqual([]);
    expect(universe.size).toBe(14);
  });
});

// ---------------- (6) ANTI-FALSE-ALL-CLEAR ----------------
describe("Provider Hub — anti false-all-clear: the aggregate never rests on one representative item or on a timestamp", () => {
  const LC: Record<string, any> = {READY: lc(), NOT_CONFIGURED: lc({state: "NOT_CONFIGURED", enabled: false, source: "NONE"}), CLI_NOT_FOUND: lc({state: "CLI_NOT_FOUND", enabled: false, source: "NONE"}), PROVENANCE_MISSING: lc({state: "PROVENANCE_MISSING"}), ABSENT: undefined};
  const PR: Record<string, any> = {
    READY: (r: string) => profile(r), LOGIN_REQUIRED: (r: string) => profile(r, LOGIN), REFUSED: (r: string) => ({state: "REFUSED", reason: "PROFILE_PATH_IS_LINK", settings: "MISSING", credentialStore: "ABSENT"}),
    NO_SETTINGS: (r: string) => profile(r, {settings: "MISSING"}), ABSENT: undefined
  };
  const ROUTE: Record<string, any> = {LOCAL_CLAUDE: {reason: "LOCAL_CLAUDE"}, FAKE: {reason: "FAKE"}, NONE: {reason: "EXECUTOR_NOT_CONFIGURED"}, WEIRD: {reason: "SOMETHING_ELSE"}, ABSENT: undefined};
  const GATE: Record<string, any> = {INACTIVE: ctlBody(), ACTIVE: stopBody(), UNREADABLE: "OFFLINE"};
  const build = (l: string, i: string, v: string, a: string) => {
    const executors: Record<string, any> = {FAKE: {state: "TEST_ONLY"}};
    if (LC[l] !== undefined) executors.LOCAL_CLAUDE = LC[l];
    const claudeProfiles: Record<string, any> = {};
    if (PR[i]) claudeProfiles.implementer = PR[i]("implementer");
    if (PR[v]) claudeProfiles.reviewer = PR[v]("reviewer");
    return execBody({executors, claudeProfiles, active: ROUTE[a]});
  };
  it("EXHAUSTIVE: across 1875 combinations of local executor x implementer x reviewer x route x gate, READY occurs if and only if every condition holds — and 'no findings' coincides exactly with READY", async () => {
    const core = await load("providers-core.js"), ops = await load("operations-core.js");
    let n = 0, ready = 0;
    for (const l of Object.keys(LC)) for (const i of Object.keys(PR)) for (const v of Object.keys(PR)) for (const a of Object.keys(ROUTE)) for (const g of Object.keys(GATE)) {
      const executors = core.mapProvidersExecutors(build(l, i, v, a));
      expect(executors.state, `${l}/${i}/${v}/${a}`).toBe("VERIFIED");
      const control = GATE[g] === "OFFLINE" ? {state: "OFFLINE", control: null} : ops.mapOperationsControl(GATE[g]);
      const out = core.buildProviders({executors, control});
      const expected = l === "READY" && i === "READY" && v === "READY" && a === "LOCAL_CLAUDE" && g === "INACTIVE";
      expect(out.tier === "READY", `${l}/${i}/${v}/${a}/${g} -> ${out.tier}`).toBe(expected);
      expect(out.findings.length === 0, `${l}/${i}/${v}/${a}/${g}`).toBe(expected);
      if (out.tier === "READY") { ready++; expect(out.providers.every((p: any) => p.positive && p.status === "READY")).toBe(true); }
      n++;
    }
    expect(n).toBe(5 * 5 * 5 * 5 * 3);
    expect(ready).toBe(1);
  });
  it("position independence: the same single broken provider yields the same non-READY level whichever slot it occupies and in whatever key/array order the server lists things", async () => {
    const core = await load("providers-core.js");
    const slots: Array<(bad: boolean) => any> = [
      bad => execBody({executors: {LOCAL_CLAUDE: bad ? LC.NOT_CONFIGURED : LC.READY, FAKE: {state: "TEST_ONLY"}}}),
      bad => execBody({claudeProfiles: {implementer: bad ? PR.LOGIN_REQUIRED("implementer") : PR.READY("implementer"), reviewer: PR.READY("reviewer")}}),
      bad => execBody({claudeProfiles: {implementer: PR.READY("implementer"), reviewer: bad ? PR.LOGIN_REQUIRED("reviewer") : PR.READY("reviewer")}})
    ];
    for (const [k, mk] of slots.entries()) {
      expect((await derive(mk(false))).out.tier, `slot ${k} good`).toBe("READY");
      const bad = await derive(mk(true));
      expect(bad.out.tier, `slot ${k} bad`).toBe("NOT_READY");
      // Yerel yürütücü bozukken yönlendirme hâlâ LOCAL_CLAUDE dediği için ayrışma bulgusu da gelir; profil yuvalarında yalnız bağlantı bulgusu vardır.
      expect(bad.out.findings.map((f: any) => f.id), `slot ${k}`).toEqual(k === 0 ? ["PROVIDER_NOT_CONNECTED", "ROUTING_MISMATCH"] : ["PROVIDER_NOT_CONNECTED"]);
      // aynı veri, ters anahtar sırası ve dizi biçiminde: aynı sonuç
      const raw = mk(true);
      const reversed = {...raw, executors: Object.fromEntries(Object.entries(raw.executors).reverse()), claudeProfiles: Object.fromEntries(Object.entries(raw.claudeProfiles).reverse())};
      const asArrays = {...raw, executors: Object.entries(raw.executors).map(([id, r]: [string, any]) => ({id, ...r})).reverse(), claudeProfiles: Object.entries(raw.claudeProfiles).map(([role, r]: [string, any]) => ({...r, role})).reverse()};
      for (const variant of [reversed, asArrays]) {
        const v = core.buildProviders({executors: core.mapProvidersExecutors(variant), control: {state: "VERIFIED", control: {active: false}}});
        expect(v.tier, `slot ${k} variant`).toBe("NOT_READY");
        expect(v.findings.map((f: any) => [f.id, f.key]), `slot ${k} variant`).toEqual(bad.out.findings.map((f: any) => [f.id, f.key]));
        expect(v.providers.map((p: any) => p.id)).toEqual(bad.out.providers.map((p: any) => p.id));
      }
    }
  });
  it("a missing or unparseable timestamp can neither hide a broken provider nor sort it to a benign position: with no timestamps at all the broken one is still found; an unparseable one rejects the whole read", async () => {
    const stripped = execBody({executors: {LOCAL_CLAUDE: {state: "NOT_CONFIGURED", enabled: false, source: "NONE"}}});
    expect((await derive(stripped)).out.tier).toBe("NOT_READY");
    // READY yürütücüde zaman damgası/sürüm hiç yoksa: zaman damgasına bağlı bir karar olmadığından hazırlık değişmez (olumlu kanıt zamandan türemez).
    const noTime = await derive(execBody({executors: {LOCAL_CLAUDE: {state: "READY", enabled: true, source: "SETTING"}}}));
    expect(noTime.out.providers[0]).toMatchObject({status: "READY", capturedAt: null, version: null});
    expect(noTime.out.tier).toBe("READY");
    // Bir sağlayıcı bozukken diğerlerinin zaman damgaları (çok yeni / çok eski / yok) sonucu iyileştiremez.
    for (const cap of [undefined, "1970-01-01T00:00:00.000Z", "2999-12-31T23:59:59.000Z"]) {
      const d = await derive(execBody({executors: {LOCAL_CLAUDE: lc({provenanceCapturedAt: cap}), FAKE: {state: "TEST_ONLY"}}, claudeProfiles: {implementer: PR.LOGIN_REQUIRED("implementer"), reviewer: PR.READY("reviewer")}}));
      expect(d.out.tier, String(cap)).toBe("NOT_READY");
    }
    for (const cap of ["", "yesterday", "2026-13-45T99:99:99Z", "not a date"]) {
      const d = await derive(execBody({executors: {LOCAL_CLAUDE: lc({provenanceCapturedAt: cap})}}));
      expect(d.executors, JSON.stringify(cap)).toEqual({state: "ERROR", providers: null});
      expect(d.out.tier, JSON.stringify(cap)).toBe("UNKNOWN");
      expect(d.out.counts).toBeNull();
    }
  });
  it("one broken condition at a time flips the SAME otherwise-READY fixture away from READY (positive control), and restoring it restores READY", async () => {
    const good = execBody();
    expect((await derive(good)).out.tier).toBe("READY");
    const breaks: Array<[string, any, any, any]> = [
      ["local executor disabled", execBody({executors: {LOCAL_CLAUDE: LC.NOT_CONFIGURED}}), ctlBody(), {}],
      ["local executor CLI missing", execBody({executors: {LOCAL_CLAUDE: LC.CLI_NOT_FOUND}}), ctlBody(), {}],
      ["local executor provenance missing", execBody({executors: {LOCAL_CLAUDE: LC.PROVENANCE_MISSING}}), ctlBody(), {}],
      ["implementer signed out", execBody({claudeProfiles: {implementer: PR.LOGIN_REQUIRED("implementer"), reviewer: PR.READY("reviewer")}}), ctlBody(), {}],
      ["reviewer refused", execBody({claudeProfiles: {implementer: PR.READY("implementer"), reviewer: PR.REFUSED("reviewer")}}), ctlBody(), {}],
      ["reviewer settings missing", execBody({claudeProfiles: {implementer: PR.READY("implementer"), reviewer: PR.NO_SETTINGS("reviewer")}}), ctlBody(), {}],
      ["profiles block gone", execBody({claudeProfiles: undefined}), ctlBody(), {}],
      ["profiles block unreadable", execBody({claudeProfiles: {error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE"}}), ctlBody(), {}],
      ["route is the test executor", execBody({active: {reason: "FAKE"}}), ctlBody(), {}],
      ["route is none", execBody({active: {reason: "EXECUTOR_NOT_CONFIGURED"}}), ctlBody(), {}],
      ["route not reported", execBody({active: undefined}), ctlBody(), {}],
      ["global stop active", good, stopBody(), {}],
      ["global stop source offline", good, ctlBody(), {control: "OFFLINE"}],
      ["executors source offline", good, ctlBody(), {executors: "OFFLINE"}],
      ["executors source malformed", {executors: []}, ctlBody(), {}]
    ];
    for (const [label, raw, ctl, opts] of breaks) {
      const out = (await derive(raw, ctl, opts)).out;
      expect(out.tier, label).not.toBe("READY");
      expect(out.findings.length, label).toBeGreaterThan(0);
      expect((await derive(good)).out.tier, `${label} (restored)`).toBe("READY");
    }
  });
});

// ---------------- (7) view ----------------
describe("Provider Hub — view: honest empty / offline / unavailable / error states, failed connections never block the screen", () => {
  it("POSITIVE CONTROL view: READY only with complete evidence — three ready cards, no findings, readiness notes present", async () => {
    const r = await renderView(serve());
    expect(overallOf(r.root).dataset.overall).toBe("READY");
    expect(pills(overallOf(r.root))).toContain("VERIFIED");
    expect(findingEls(r.root)).toEqual([]);
    expect(byData(r.root, "provEmpty", "ready")).toBeTruthy();
    expect(cards(r.root).every(c => c.dataset.positive === "1")).toBe(true);
    expect(kpiValue(r.root, "total")).toBe("3");
    expect(kpiValue(r.root, "ready")).toBe("3");
    expect(kpiValue(r.root, "notReady")).toBe("0");
    expect(kpiValue(r.root, "unverified")).toBe("0");
    // Her durumda "canlı yoklama değil" ve "ürün doğrulaması değil" notları vardır.
    expect(byData(r.root, "note", "not-live-probe")).toBeTruthy();
    expect(byData(r.root, "note", "not-product-verification")).toBeTruthy();
    expect(byData(r.root, "note", "unreported")!.textContent).toContain("not reported");
    expect(byData(r.root, "unreported", "1")).toBeTruthy();
    expect(byData(r.root, "readonly", "1")).toBeTruthy();
    expect(byData(r.root, "honesty", "1")!.getAttribute("role")).toBe("note");
    expect(sourcesOf(r.root).map(li => [li.dataset.source, li.dataset.sourceState])).toEqual([["executors", "VERIFIED"], ["control", "VERIFIED"]]);
    expect(allData(r.root, "field", "route")[0].dataset.value).toBe("LOCAL_CLAUDE");
    expect(allData(r.root, "field", "gate")[0].dataset.value).toBe("inactive");
    expect(r.posts).toEqual([]);
  });
  it("EVERY non-ready scenario shows no positive overall wording, no READY mark, no success pill and no empty-ready note", async () => {
    const scenarios: Array<[string, Record<string, any>]> = [
      ["local executor not enabled", {[EXE]: execBody({executors: {LOCAL_CLAUDE: {state: "NOT_CONFIGURED", enabled: false, source: "NONE"}}})}],
      ["cli missing", {[EXE]: execBody({executors: {LOCAL_CLAUDE: {state: "CLI_NOT_FOUND", enabled: false, source: "NONE"}}})}],
      ["implementer signed out", {[EXE]: execBody({claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: profile("reviewer")}})}],
      ["reviewer refused", {[EXE]: execBody({claudeProfiles: {implementer: profile("implementer"), reviewer: {state: "REFUSED", reason: "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG", settings: "MISSING", credentialStore: "ABSENT"}}})}],
      ["profiles unreadable", {[EXE]: execBody({claudeProfiles: {error: "CLAUDE_PROFILE_STATUS_UNAVAILABLE"}})}],
      ["route is the test executor", {[EXE]: execBody({active: {reason: "FAKE"}})}],
      ["route not reported", {[EXE]: execBody({active: undefined})}],
      ["global stop active", {[CTL]: stopBody()}],
      ["executors offline", {[EXE]: fail("fetch failed")}],
      ["executors unavailable", {[EXE]: fail("x: HTTP 404")}],
      ["executors error", {[EXE]: fail("x: HTTP 500")}],
      ["executors malformed", {[EXE]: {nonsense: true}}],
      ["executors empty list", {[EXE]: execBody({executors: []})}],
      ["gate offline", {[CTL]: fail("fetch failed")}],
      ["gate malformed", {[CTL]: {nonsense: true}}]
    ];
    for (const [label, over] of scenarios) {
      const r = await renderView(serve(over));
      expectNotReady(r.root, label);
      expect(r.root.tagName).toBe("DIV");
      expect(byId(r.root, "view-title")!.textContent).toBe("Provider Hub");
      expect(r.posts).toEqual([]);
    }
  });
  it("a failed provider connection (executors source down) does NOT block the screen: honest state block, counts are — (never 0), providers withheld, the gate is still shown; the app route keeps working", async () => {
    for (const [thrown, state] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const r = await renderView(serve({[EXE]: fail(thrown)}));
      expect(overallOf(r.root).dataset.overall).toBe("UNKNOWN");
      expect(byData(r.root, "provState", state), state).toBeTruthy();
      expect(sourcesOf(r.root).map(li => li.dataset.sourceState)).toEqual([state, "VERIFIED"]);
      for (const k of ["total", "ready", "notReady", "unverified"]) expect(kpiValue(r.root, k), `${state}/${k}`).toBe("—");
      expect(cards(r.root)).toEqual([]);
      expect(byData(r.root, "withheld", "1")).toBeTruthy();
      expect(byData(r.root, "provEmpty", "unknown")).toBeTruthy();
      expect(allData(r.root, "field", "gate")[0].dataset.value).toBe("inactive"); // bağımsız kaynak etkilenmez
      expect(findingIds(r.root)).toEqual(["SOURCE_UNREADABLE"]);
    }
    // Her iki kaynak da düşse bile ekran açılır.
    const both = await renderView(() => { throw new Error("fetch failed"); });
    expect(byId(both.root, "view-title")!.textContent).toBe("Provider Hub");
    expect(overallOf(both.root).dataset.overall).toBe("UNKNOWN");
    expect(findingIds(both.root)).toEqual(["SOURCE_UNREADABLE", "SOURCE_UNREADABLE"]);
    expect(byData(both.root, "provPartial")!.dataset.provPartial).toBe("executors,control");
    // Köprü hiç yoksa ya da api erişimcileri patlarsa da ekran açılır (kendi hatası dürüst ERROR olur).
    const view = await load("views", "providers.js");
    const m = await mkCtx(serve());
    m.ctx.api = {providersExecutors: () => { throw new Error("boom"); }, operationsControl: async () => { throw new Error("boom"); }};
    const bare = await view.render(m.ctx);
    expect(overallOf(bare).dataset.overall).toBe("UNKNOWN");
    const none = await mkCtx(serve());
    none.ctx.api = {};
    expect(overallOf(await view.render(none.ctx)).dataset.overall).toBe("UNKNOWN");
    const odd = await mkCtx(serve());
    odd.ctx.api = {providersExecutors: async () => 42, operationsControl: async () => null};
    expect(overallOf(await view.render(odd.ctx)).dataset.overall).toBe("UNKNOWN");
  });
  it("the Global Stop gate shows its real state, fail-closed wording and no free text from the stop reason; a gate read failure shows an honest withheld note", async () => {
    const a = await renderView(serve({[CTL]: stopBody({reason: "<b>Founder note</b>"})}));
    expect(allData(a.root, "field", "gate")[0].dataset.value).toBe("active");
    expect(overallOf(a.root).dataset.overall).toBe("HALTED");
    expect(surface(a.root)).not.toContain("Founder note");
    const fc = await renderView(serve({[CTL]: {globalStop: {active: true, reason: "GLOBAL_STOP_STATE_UNSAFE"}, verification: "REJECTED", workos: {state: "OK", reason: null, tornTail: null}}}));
    expect(allData(fc.root, "field", "gate")[0].dataset.value).toBe("failClosed");
    expect(findingIds(fc.root)).toEqual(["STOP_FAIL_CLOSED"]);
    expect(findingEls(fc.root)[0].textContent).toContain("fail-closed");
    const down = await renderView(serve({[CTL]: fail("fetch failed")}));
    expect(allData(down.root, "withheld", "1").some(n => n.dataset.source === "control")).toBe(true);
    expect(allData(down.root, "field", "gate")).toEqual([]);
    expect(overallOf(down.root).dataset.overall).toBe("UNKNOWN");
    // Yürütücüler okunabildiği için sağlayıcı kartları ve sayıları yine görünür.
    expect(cards(down.root).length).toBe(3);
    expect(kpiValue(down.root, "ready")).toBe("3");
  });
  it("secrets never reach the screen: neither the profile path, the login command, the API key / token, nor credential content — only presence is shown; this holds in both languages", async () => {
    for (const lang of ["en", "tr"]) {
      for (const body of [execBody(), execBody({claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: profile("reviewer", {state: "REFUSED", reason: "PROFILE_PATH_IS_PERSONAL_CLAUDE_CONFIG", credentialStore: "ABSENT", settings: "MISSING"})}})]) {
        const r = await renderView(serve({[EXE]: body}), lang);
        expectNoLeaks(r.root, lang);
        expect(r.root.textContent).not.toMatch(/sk-|api[_-]?key|password|Bearer/i);
      }
    }
    const r = await renderView(serve());
    const cred = field(cardFor(r.root, "CLAUDE_IMPLEMENTER"), "credential")!;
    expect(cred.dataset.value).toBe("PRESENT");
    expect(cred.textContent).toContain("never read or shown");
    // Profil kartında yol/komut alanı hiç yoktur.
    expect(allData(cardFor(r.root, "CLAUDE_IMPLEMENTER"), "field").map(n => n.dataset.field)).toEqual(["kind", "serverState", "credential", "settings", "next"]);
    expect(allData(cardFor(r.root, "LOCAL_CLAUDE"), "field").map(n => n.dataset.field)).toEqual(["kind", "serverState", "enabled", "source", "version", "captured", "next"]);
    expect(all(r.root).filter(n => n.tagName === "PRE" || n.tagName === "CODE")).toEqual([]);
  });
  it("API text is rendered as text, never as HTML; strings that could carry markup are rejected by the mapper or shown verbatim as inert text", async () => {
    const r = await renderView(serve({[EXE]: execBody({executors: {LOCAL_CLAUDE: lc({state: "NEW_STATE_FROM_FUTURE", enabled: false, source: "NONE", version: "<img src=x onerror=alert(1)>"})}})}));
    expect(all(r.root).filter(n => n.tagName === "IMG" || n.tagName === "SCRIPT" || n.tagName === "IFRAME")).toEqual([]);
    expect(surface(r.root)).not.toContain("<img");
    const card = cardFor(r.root, "LOCAL_CLAUDE");
    expect(card.dataset.providerStatus).toBe("UNKNOWN");
    expect(field(card, "serverState")!.textContent).toBe("NEW_STATE_FROM_FUTURE"); // ham, güvenli desenli değer olduğu gibi (metin olarak)
    expect(field(card, "version")!.textContent).toBe("—");
    const markup = await renderView(serve({[EXE]: execBody({active: {reason: "<script>alert(1)</script>"}})}));
    expect(overallOf(markup.root).dataset.overall).toBe("UNKNOWN");
    expect(all(markup.root).filter(n => n.tagName === "SCRIPT")).toEqual([]);
    expect(surface(markup.root)).not.toContain("<script");
  });
  it("test-only executors are listed apart with their own honest note and never in the provider list, counts or KPI", async () => {
    const r = await renderView(serve());
    const test = allData(r.root, "provTest")[0];
    expect(test).toBeTruthy();
    expect(allData(test, "provider").map(n => n.dataset.provider)).toEqual(["FAKE"]);
    expect(allData(test, "provider")[0].dataset.providerStatus).toBe("TEST_ONLY");
    expect(allData(test, "provider")[0].dataset.positive).toBe("0");
    expect(allData(r.root, "provProviders")[0].dataset.provProviders).toBe("3");
    expect(byData(r.root, "note", "test-only")).toBeTruthy();
    const lonely = await renderView(serve({[EXE]: execBody({executors: {LOCAL_CLAUDE: lc()}})}));
    expect(byData(lonely.root, "note", "test-only")).toBeUndefined();
    expect(overallOf(lonely.root).dataset.overall).toBe("READY");
  });
  it("finding cards carry severity, key and an honest 'where to act' note; the order is worst first; counts line matches", async () => {
    const r = await renderView(serve({[CTL]: stopBody(), [EXE]: execBody({executors: {LOCAL_CLAUDE: LC_CLI_MISSING()}, claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: {state: "REFUSED", reason: "PROFILE_PATH_IS_LINK", credentialStore: "ABSENT", settings: "MISSING"}}, active: {reason: "EXECUTOR_NOT_CONFIGURED"}})}));
    const els = findingEls(r.root);
    expect(els.map(e => [e.dataset.finding, e.dataset.findingSeverity])).toEqual([["PROVIDER_REFUSED", "BLOCKED"], ["STOP_ACTIVE", "HALTED"], ["PROVIDER_NOT_INSTALLED", "NOT_READY"], ["PROVIDER_NOT_CONNECTED", "NOT_READY"], ["ROUTING_NONE", "NOT_READY"]]);
    expect(els.map(e => e.dataset.findingIndex)).toEqual(["0", "1", "2", "3", "4"]);
    expect(overallOf(r.root).dataset.overall).toBe("BLOCKED");
    expect(byData(r.root, "note", "finding-counts")!.textContent).toBe("Open findings — blocked: 1, halted: 1, unknown: 0, not ready: 3, not verified: 0.");
    expect(allData(els[0], "field", "where")[0].textContent).toContain("Settings");
    expect(allData(els[1], "field", "where")[0].textContent).toContain("Control Tower");
    expect(allData(els[4], "field", "detail")[0].textContent).toContain("EXECUTOR_NOT_CONFIGURED");
    expect(findingEls(r.root).every(e => all(e).some(n => n.tagName === "H3"))).toBe(true);
    expect(cardFor(r.root, "CLAUDE_REVIEWER").dataset.providerStatus).toBe("REFUSED");
    expect(field(cardFor(r.root, "CLAUDE_REVIEWER"), "reason")!.textContent).toContain("link");
    expect(surface(r.root)).not.toContain(FORBIDDEN);
  });
  it("Turkish rendering is fully localized and just as honest", async () => {
    const r = await renderView(serve({[EXE]: execBody({claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: profile("reviewer")}})}), "tr");
    expect(byId(r.root, "view-title")!.textContent).toBe("Sağlayıcı Merkezi");
    expect(overallOf(r.root).dataset.overall).toBe("NOT_READY");
    expectNotReady(r.root, "tr");
    expect(overallOf(r.root).textContent).toContain("Hazır değil");
    expect(findingEls(r.root)[0].textContent).toContain("bağlı değil");
    expect(r.root.textContent).not.toMatch(/prov\.[a-zA-Z]/);
    const en = await renderView(serve({[EXE]: execBody({claudeProfiles: {implementer: profile("implementer", LOGIN), reviewer: profile("reviewer")}})}), "en");
    expect(r.root.textContent).not.toBe(en.root.textContent);
    const ready = await renderView(serve(), "tr");
    expect(overallOf(ready.root).dataset.overall).toBe("READY");
    expect(overallOf(ready.root).textContent).toContain("Beklenen tüm sağlayıcılar hazır");
  });
  it("accessibility: one h1 focus target, labelled sections, labelled lists, text on every pill, status roles on states, real buttons with focus keys", async () => {
    for (const over of [{[EXE]: fail("fetch failed")}, {}, {[CTL]: stopBody()}]) {
    const r = await renderView(serve(over));
    const h1 = all(r.root).filter(n => n.tagName === "H1");
    expect(h1.length).toBe(1);
    expect(h1[0].id).toBe("view-title");
    expect(h1[0].getAttribute("tabindex")).toBe("-1");
    const sections = all(r.root).filter(n => n.tagName === "SECTION");
    expect(sections.map(s => s.id)).toEqual(["prov-summary", "prov-findings", "prov-providers", "prov-routing", "prov-boundary"]);
    for (const s of sections) { const lab = s.getAttribute("aria-labelledby")!; expect(byId(r.root, lab), s.id).toBeTruthy(); expect(byId(r.root, lab)!.tagName).toBe("H2"); }
    for (const l of all(r.root).filter(n => n.tagName === "UL" || n.tagName === "OL")) expect(l.getAttribute("aria-label") ?? l.getAttribute("aria-labelledby"), l.className).toBeTruthy();
    for (const p of allData(r.root, "pill").filter(n => n.tagName === "SPAN")) expect(p.textContent.trim().length, p.dataset.pill).toBeGreaterThan(0);
    for (const st of allData(r.root, "provState")) expect(st.getAttribute("role")).toBe("status");
    for (const b of all(r.root).filter(n => n.tagName === "BUTTON")) { expect(b.getAttribute("type")).toBe("button"); expect(b.textContent.trim().length).toBeGreaterThan(0); expect(b.dataset.focusKey).toBe(b.id); }
    expect(allData(r.root, "boundary").map(n => n.dataset.boundary)).toEqual(["noAction", "noSecrets", "noPersonal", "noBlock"]);
    expect(allData(r.root, "boundary").find(n => n.dataset.boundary === "noPersonal")!.textContent).toContain("personal Claude profile");
    }
  });
});

// ---------------- (8) CSS ----------------
describe("Provider Hub — styles", () => {
  it("the Provider Hub CSS block reuses existing tokens only (no new colour tokens, no literal colours), supports forced colours and narrow containers, and keeps meaning out of colour", () => {
    const css = read("styles.css");
    const start = css.indexOf("Provider Hub: KPI satırı");
    expect(start).toBeGreaterThan(0);
    const mine = css.slice(start);
    expect(mine).toMatch(/@media \(forced-colors:active\)\{[^@]*\.prov-[^@]*Highlight/);
    expect(mine).toMatch(/:focus-visible\{outline:3px solid Highlight\}/);
    expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(mine).not.toMatch(/--[a-z0-9-]+\s*:/); // yeni özel özellik (token) tanımlanmaz
    expect(mine).toMatch(/@container \(max-width:40rem\)/);
    expect(mine).toMatch(/\.prov-finding\[data-finding-severity="BLOCKED"\]/);
    expect(mine).not.toMatch(/var\(--ok\)/); // olumlu kart renkle işaretlenmez: anlam rozet metnindedir (Komuta Matrisi testiyle aynı kural)
    for (const v of mine.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(css, v).toContain(`${v.slice(4, -1)}:`);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\}\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  });
});

// ---------------- (9) locale parity ----------------
describe("Provider Hub — locale parity and key coverage", () => {
  it("every prov.* / area.providers.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity; no product-verification wording anywhere", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("prov.") || k.startsWith("area.providers.")).sort();
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(150);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.providers.title"]).toBe("Sağlayıcı Merkezi");
    expect(en["area.providers.title"]).toBe("Provider Hub");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); expect(k, k).not.toContain(FORBIDDEN); }
    // Yalnız READY açıklaması olumlu dil kullanabilir; diğer düzeylerin başlığı/açıklaması olumlu ifade içermez.
    for (const t of ["BLOCKED", "HALTED", "UNKNOWN", "NOT_READY", "UNVERIFIED"]) for (const k of [`prov.tier.${t}`, `prov.tierDesc.${t}`]) expect(en[k], k).not.toMatch(/no issues|healthy|all[- ]clear|\bfine\b|\bok\b|\bpass(ed)?\b|\bready\b(?<!not ready)/i);
    // READY açıklaması "canlı yoklama değil" uyarısını taşır.
    expect(en["prov.tierDesc.READY"]).toMatch(/not a live probe/);
    expect(tr["prov.tierDesc.READY"]).toMatch(/canlı yoklama/);
    // Güvenlik değişmezleri sözlükte açıkça yazılıdır.
    expect(en["prov.boundary.noPersonal"]).toMatch(/never reads or falls back to your personal Claude profile/);
    expect(en["prov.boundary.noSecrets"]).toMatch(/Secrets are never shown/);
    expect(tr["prov.boundary.noPersonal"]).toMatch(/kişisel Claude profilinizi asla okumaz/);
  });
  it("every literal and enumerated key used by providers.js exists in both dictionaries, and no prov key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("providers-core.js");
    const src = read("views", "providers.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const m of src.matchAll(/"((?:prov|area\.providers)\.[A-Za-z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.PROVIDER_SOURCES) { need.add(`prov.src.${k}`); need.add(`prov.srcShort.${k}`); }
    for (const k of core.UNKNOWN_DETAILS) { need.add(`prov.state.${k}`); need.add(`prov.hint.${k}`); need.add(`prov.why.${k}`); }
    for (const k of ["total", "ready", "notReady", "unverified"]) { need.add(`prov.kpi.${k}`); need.add(`prov.kpi.q.${k}`); }
    for (const t of core.TIERS) { need.add(`prov.tier.${t}`); need.add(`prov.tierDesc.${t}`); }
    for (const s of core.SEVERITIES) need.add(`prov.severity.${s}`);
    for (const id of Object.values(core.FINDING_IDS).flat() as string[]) { need.add(`prov.finding.${id}.title`); need.add(`prov.finding.${id}.detail`); }
    for (const k of ["settings", "tower"]) need.add(`prov.where.${k}`);
    for (const k of [...core.EXPECTED_PROVIDERS, "FAKE"]) need.add(`prov.name.${k}`);
    for (const k of ["EXECUTOR", "PROFILE", "TEST"]) need.add(`prov.kind.${k}`);
    for (const k of ["kind", "serverState", "reason", "enabled", "source", "version", "captured", "credential", "settings", "route", "gate"]) need.add(`prov.field.${k}`);
    for (const k of ["PRESENT", "ABSENT"]) need.add(`prov.credential.${k}`);
    for (const k of ["PRESENT", "MISSING", "MODIFIED"]) need.add(`prov.settings.${k}`);
    for (const k of core.PROVIDER_STATUSES) { need.add(`prov.status.${k}`); need.add(`prov.next.${k}`); }
    for (const k of core.KNOWN_REASON_CODES) need.add(`prov.reason.${k}`);
    for (const k of core.ROUTING_MODES) { need.add(`prov.route.${k}`); need.add(`prov.route.explain.${k}`); }
    for (const k of ["noAction", "noSecrets", "noPersonal", "noBlock"]) need.add(`prov.boundary.${k}`);
    for (const k of ["settings", "operations", "tower"]) need.add(`prov.action.${k}`);
    need.add("area.providers.title"); need.add("area.providers.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(150);
    // Sözlükte ölü anahtar kalmaz: her prov.* anahtarı görünümde/çekirdekte kullanılır.
    expect(Object.keys(en).filter(k => (k.startsWith("prov.") || k.startsWith("area.providers.")) && !need.has(k))).toEqual([]);
    // Bilinen neden kodlarının her biri sunucu/çekirdek kaynağında gerçekten üretilir (uydurma kod yok).
    const profilesSrc = fs.readFileSync(path.join(root, "core", "workos", "claude-profiles.ts"), "utf8");
    for (const code of core.KNOWN_REASON_CODES.filter((c: string) => /^(PROFILE_PATH_|CREDENTIAL_STORE_|CLAUDE_PROFILE_)/.test(c))) {
      expect(profilesSrc + fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8"), code).toContain(code);
    }
    // Üretilen her bulgu için başlık ve ayrıntı gerçekten çözülür (anahtar adı sızmaz).
    const vars = {provider: "P", serverState: "S", reason: "R", source: "src", state: "st"};
    const i18n = await load("i18n.js");
    for (const id of Object.values(core.FINDING_IDS).flat() as string[]) for (const lang of ["en", "tr"]) for (const part of ["title", "detail"]) expect(i18n.translate(lang, `prov.finding.${id}.${part}`, vars)).not.toMatch(/\{\w+\}|prov\.finding/);
  });
});

// ---------------- (10) routing ----------------
describe("Provider Hub — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/providers to the planned host with component 'providers' (no plannedPackage), after operations and before settings, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("providers");
    expect(r).toMatchObject({id: "providers", hash: "#/providers", view: "planned", component: "providers", factory: false, icon: "plug"});
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/providers")).toBe("providers");
    expect(routes.routeFromHash("#/providers/")).toBe("providers");
    expect(routes.routeFromHash("#/providerss")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/Providers")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/provider-hub")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.ROUTES.map((x: any) => x.id).slice(-11)).toEqual(["company", "academy", "journey", "executive", "queue", "readiness", "posture", "matrix", "operations", "providers", "settings"]);
    expect(routes.FACTORY_AREA_ORDER).not.toContain("providers");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    expect(routes.ROUTES.length).toBe(19);
    // Eski rotalar etkilenmez.
    for (const id of ["operations", "matrix", "posture", "readiness", "queue", "executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
    expect(routes.routeById("settings")).toMatchObject({id: "settings", view: "settings", factory: false});
    expect(routes.routeById("tower")).toMatchObject({id: "tower", view: "tower", factory: true});
  });
  it("planned.js delegates the 'providers' component to the real view; app.js VIEWS table has no providers entry and is untouched; settings, tower and shell are untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as providers from "./providers.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*providers[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("providers.js");
    expect(app).not.toMatch(/\bproviders\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    // Mevcut Ayarlar/AI yürütücüleri yolu (etkinleştirme dahil) yeni modüle bağlanmaz ve değişmeden çalışır.
    for (const f of ["settings.js", "executors-panel.js", "tower.js", "inbox.js"]) expect(read("views", f)).not.toMatch(/providers/);
    expect(read("shell.js")).not.toMatch(/providers/);
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const rootNode: N = await planned.render(ctx, {id: "providers", component: "providers"});
    expect(cls(rootNode, "view-providers")).toBe(true);
    expect(byId(rootNode, "view-title")!.textContent).toBe("Provider Hub");
    // Mevcut devredilen rotalar etkilenmez.
    const o = await planned.render((await mkCtx(serve({"/v1/runs": {count: 0, runs: []}, "/v1/founder-attention": {blocked: [], retryableKinds: [], schedulerVerification: "VERIFIED"}}))).ctx, {id: "operations", component: "operations"});
    expect(cls(o, "view-operations")).toBe(true);
    // Bilinmeyen bileşen planlı panele düşer (sessizce devre dışı bırakılmaz).
    const unknown = await planned.render((await mkCtx(serve())).ctx, {id: "providers", component: "nonexistent"});
    expect(cls(unknown, "view-providers")).toBe(false);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel); the settings executors panel still renders unchanged", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.providers.title")).toBe("Sağlayıcı Merkezi");
    expect(i18n.translate("en", "area.providers.desc")).toContain("Read-only.");
    const settings = await load("views", "settings.js");
    const m = await mkCtx(serve({"/health": {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"}, "/v1/factory": {schemaVersion: "1.0.0", state: "BUILD"}}));
    (m.ctx as any).principal = "FOUNDER_LOCAL";
    const s: N = await settings.render(m.ctx);
    expect(byId(s, "settings-executors")).toBeTruthy();
    expect(byId(s, "settings-connection")).toBeTruthy();
    expect(allData(s, "executor").map(n => n.dataset.executor)).toEqual(["LOCAL_CLAUDE", "FAKE"]);
    expect(m.posts).toEqual([]);
  });
  it("no new file or key anywhere contains the product-verification constant", () => {
    for (const f of [path.join(rend, "providers-core.js"), path.join(rend, "views", "providers.js"), __filename]) expect(fs.readFileSync(f, "utf8"), f).not.toContain(FORBIDDEN);
  });
});
