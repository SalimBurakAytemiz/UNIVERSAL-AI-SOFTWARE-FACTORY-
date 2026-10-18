// //TR: Bu test FA-V2-PRODUCT UI-248 "İlk Çalıştırma Kurulum Doğrulaması" salt-okunur ekranını doğrular: (1) GERÇEK control-api (buildServer) — gerçek GET /v1/install, /v1/phase0 ve /v1/system/executors gövdeleri install-core eşleyicilerinden ve görünümden geçer (PENDING ve REJECTED sunucu karar yolları gerçek sunucudan; VERIFIED yolu sözleşme biçimli fikstürle, çünkü gerçek imza/git bağı bu testte kurulamaz); (2) allow-list: üç yol zaten izinli, EXTRA_GET_ROUTES DEĞİŞMEZ, görünüm/çekirdek yazma/fetch/innerHTML/eval/depolama kullanmaz; (3) saf eşleyiciler fail-closed (bozuk/çelişkili kayıt tümden ERROR, yol/özet/imza sızmaz); (4) dürüst durumlar: her kaynak bağımsız düşer, okunamayan sayı "—" olur, VERIFIED yalnız sunucu söylerse; (5) EN/TR anahtar eşitliği ve rota devri (app.js VIEWS değişmez); (6) yasak sabit değer hiçbir yüzeyde ve kaynakta yoktur.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {buildServer} from "../apps/control-api/src/server.js";
import {tmpRoot, rmTmp} from "./support/relfx.js";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const root = path.resolve(__dirname, "..");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const FORBIDDEN = "PRODUCT" + "_VERIFIED"; // yasak sabit değeri bu dosyada da düz yazılmaz; yalnız taranır.

// ---------------- fake DOM (posture/readiness testleri ile aynı desen) ----------------
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
// Bütün render edilmiş metin + öznitelik/dataset değerleri (yasak sabit taraması için).
const surface = (r: N) => all(r).map(n => `${n.textContent}|${n.className}|${[...n.attrs.values()].join(",")}|${Object.values(n.dataset).join(",")}`).join("\n");
const pills = (r: N) => allData(r, "pill").map(n => n.dataset.pill);
const click = (n: N) => { const fns = n.ls.get("click"); expect(fns, "click listener").toBeTruthy(); fns!.forEach(f => f({})); };

async function mkCtx(getFn: (p: string) => any, lang = "en", post?: (p: string, b: unknown) => any) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [], nav: string[] = [], picks: string[] = [];
  const bridge: Record<string, unknown> = {apiGet: async (p: string) => { calls.push(p); return getFn(p); }};
  if (post) bridge.apiPost = async (p: string, b: unknown) => post(p, b);
  const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { nav.push(id); }, selectProject: (id: string) => { picks.push(id); }, rerender: async () => {}, settleFocus: () => {}};
  return {ctx, doc, calls, nav, picks};
}
const fail = (p: string, status = 404) => { throw new Error(`${p}: HTTP ${status}`); };
const pillLabels = (r: N) => allData(r, "pill").map(n => n.textContent);
const card = (r: N, kind: string) => allData(r, "card", kind).find(n => n.tagName === "LI")!;
const sourcesOf = (r: N) => allData(r, "source").filter(n => n.tagName === "LI");
const kpi = (r: N, id: string) => allData(r, "kpi").find(n => n.dataset.kpi === `install-${id}`)!;
const kpiValue = (r: N, id: string) => all(kpi(r, id)).find(n => cls(n, "kpi-value"))!.textContent;
const MISSING = "—";
async function renderView(getFn: (p: string) => any, lang = "en") {
  const view = await load("views", "install.js");
  const m = await mkCtx(getFn, lang);
  const rootNode: N = await view.render(m.ctx);
  return {root: rootNode, ...m};
}

// ---------------- fixtures (sunucu gövdeleriyle aynı biçim; yol/özet/imza/serbest metin sızıntı tuzakları içerir) ----------------
const T0 = "2026-10-16T02:00:00.000Z";
const sha = (c: string) => c.repeat(40);
const SECRET_PATH = "/home/secret-user/.ai/runtime/PREFLIGHT.json";
const SECRET_SIG = "SIGSECRETVALUE" + "Z".repeat(40);
const SECRET_DETAIL = "detail-with-secret-token-abc123";
const PHASE0_OK = () => ({schemaVersion: "1.2.0", generatedAt: T0, installId: "INSTALL-T1", sourceCommit: sha("a"), trustRootManifestSha256: "e".repeat(64),
  inputDigests: {preflight: {path: SECRET_PATH, present: true, sha256: "b".repeat(64)}, validation: {path: "/x/VALIDATION_REPORT.json", present: false, sha256: null}},
  checks: {globalStop: {status: "PASS", detail: SECRET_DETAIL}, processLockIdle: {status: "PASS", detail: "no active supervisor lock"}, remote: {status: "PENDING", detail: "x"}},
  final: "CLEAN_LOCAL_ONLY", sealAlgorithm: "Ed25519", sealSignature: SECRET_SIG, verification: "VERIFIED"});
const INSTALL_OK = () => ({schemaVersion: "1.2.0", generatedAt: T0, installId: "INSTALL-T1",
  components: {preflight: {present: true, file: SECRET_PATH, status: "PASS", sha256: "c".repeat(64)}, remote: {present: false, file: ".ai/runtime/REMOTE_STATUS.json", status: "MISSING", sha256: null}, controlApi: {present: true, file: ".ai/runtime/CONTROL_API_SMOKE.json", status: "PASS", sha256: "d".repeat(64)}},
  phase0Final: "CLEAN_LOCAL_ONLY", phase0SourceCommit: sha("a"), phase0SealSignature: SECRET_SIG, digest: "f".repeat(64), verification: "VERIFIED"});
const INSTALL_PENDING = () => ({phase0Final: "PENDING", verification: "PENDING", components: {}});
const PHASE0_PENDING = () => ({final: "PENDING", verification: "PENDING"});
const INSTALL_REJECTED = () => ({phase0Final: "INVALID", verification: "REJECTED", components: {}, errors: ["INSTALL_REPORT_PHASE0_NOT_VERIFIED", "INSTALL_COMPONENT_DIGEST_MISMATCH:preflight"]});
const PHASE0_REJECTED = () => ({final: "INVALID", verification: "REJECTED", errors: ["PHASE0_NOT_CLEAN", "PHASE0_SIGNATURE_INVALID"]});
const EXECUTORS = (over: Record<string, any> = {}) => ({executors: {LOCAL_CLAUDE: {state: "NOT_CONFIGURED", enabled: false, source: "NONE"}, FAKE: {state: "TEST_ONLY"}}, active: {reason: "x"},
  sandbox: {state: "UNAVAILABLE", reason: "NO_PROVIDER", detail: "M1A_MODE"}, claudeProfiles: {implementer: {state: "READY"}, reviewer: {state: "LOGIN_REQUIRED", reason: "PROFILE_NOT_LOGGED_IN"}}, ...over});
const THREE = ["/v1/install", "/v1/phase0", "/v1/system/executors"];
const serve = (over: Record<string, any> = {}) => (p: string) => {
  const m: Record<string, any> = {"/v1/install": INSTALL_OK(), "/v1/phase0": PHASE0_OK(), "/v1/system/executors": EXECUTORS(), ...over};
  if (!(p in m)) return fail(p);
  const v = m[p];
  return typeof v === "function" ? v(p) : v; // işlev geçersiz kılma: okuma hatası (throw) benzetimi
};
const down = (status = 500) => () => fail("x", status);
/** Üç gövdeyi gerçek eşleyicilerden geçirip birleşik modeli üretir. */
async function assess(o: {install?: any; phase0?: any; executors?: any} = {}) {
  const core = await load("install-core.js"), proj = await load("project-core.js");
  const res = {install: core.mapInstallReport(o.install ?? INSTALL_OK()), phase0: core.mapPhase0Report(o.phase0 ?? PHASE0_OK()), executors: proj.mapExecutors(o.executors ?? EXECUTORS())};
  return {core, res, out: core.buildInstall(res)};
}
/** Hiçbir yüzeyde yasak sabit, sızan yol/özet/imza/ayrıntı ya da ham i18n anahtarı olmaz. */
function expectClean(rootNode: N, label: string) {
  const s = surface(rootNode);
  expect(s, label).not.toContain(FORBIDDEN);
  expect(s, label).not.toMatch(/product[\s_-]*verified/i);
  for (const leak of [SECRET_PATH, SECRET_SIG, SECRET_DETAIL, "secret-user", "b".repeat(64), "c".repeat(64), "SIGSECRET"]) expect(s, `${label}/${leak.slice(0, 12)}`).not.toContain(leak);
  expect(s, label).not.toMatch(/\b(?:install|area\.install)\.[a-zA-Z]+\.[A-Za-z.]+\b(?<!\.js)/);
}

// ---------------- (1) GENUINE control-api -> mappers -> view ----------------
const TOKEN = "t".repeat(32);
const hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
let tmp = "";
type App = ReturnType<typeof buildServer>;
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = tmpRoot("uasco-install-"); });
afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(tmp); });
const runtime = () => path.join(tmp, "runtime");
function mkApp(): App {
  fs.mkdirSync(runtime(), {recursive: true});
  // repoRoot geçici dizindir: gerçek kurulum raporu/Phase-0 raporu yoktur (dürüst PENDING), gerçek depoya bakılmaz.
  const app = buildServer({controlToken: TOKEN, runtime: runtime(), repoRoot: tmp, dataDir: path.join(tmp, "data"), tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
const getJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: hdr}); if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`); return r.json(); };

describe("Install — GENUINE control-api bodies flow through mappers and the view", () => {
  it("fresh runtime: the real server answers PENDING for both reports; the view shows PENDING verbatim, withholds counts (—, never 0) and never shows VERIFIED", async () => {
    const app = mkApp();
    const raw = {install: await getJson(app, "/v1/install"), phase0: await getJson(app, "/v1/phase0"), executors: await getJson(app, "/v1/system/executors")};
    expect(raw.install).toMatchObject({verification: "PENDING", phase0Final: "PENDING"});
    expect(raw.phase0).toMatchObject({verification: "PENDING", final: "PENDING"});
    const {out, res} = await assess({install: raw.install, phase0: raw.phase0, executors: raw.executors});
    for (const r of Object.values(res) as any[]) expect(r.state).toBe("VERIFIED"); // OKUMA başarılı; karar PENDING
    expect(out.install).toMatchObject({verification: "PENDING", phase0Final: "PENDING", components: []});
    expect(out.phase0).toMatchObject({verification: "PENDING", final: "PENDING"});
    expect(out.executors.items.map((x: any) => x.id).sort()).toEqual(["FAKE", "LOCAL_CLAUDE"]);

    const {ctx, calls} = await mkCtx(async p => getJson(app, p));
    const view = await load("views", "install.js");
    const rootNode: N = await view.render(ctx);
    expect(calls.slice().sort()).toEqual([...THREE].sort());
    expect(card(rootNode, "install").dataset.verification).toBe("PENDING");
    expect(card(rootNode, "phase0").dataset.verification).toBe("PENDING");
    expect(pills(card(rootNode, "install"))).toEqual(["WAITING"]);
    expect(pillLabels(card(rootNode, "install"))).toEqual(["PENDING"]);
    expect(kpiValue(rootNode, "total")).toBe(MISSING);
    expect(kpiValue(rootNode, "present")).toBe(MISSING);
    expect(allData(rootNode, "component").length).toBe(0);
    expect(allData(rootNode, "check").length).toBe(0);
    // Gerçek yürütücü gövdesi: sunucunun durumu AYNEN; bağlı/hazır uydurulmaz.
    const lc = allData(rootNode, "executor", "LOCAL_CLAUDE")[0];
    expect(["NOT_CONFIGURED", "CLI_NOT_FOUND", "PROVENANCE_MISSING"]).toContain(lc.dataset.state);
    expect(pills(lc)).not.toContain("VERIFIED");
    expect(pills(lc)).not.toContain("ACTIVE");
    expect(pills(allData(rootNode, "executor", "FAKE")[0])).toEqual(["NOT_VERIFIED"]);
    expect(pills(card(rootNode, "install"))).not.toContain("VERIFIED");
    expectClean(rootNode, "real-pending");
  });
  it("a real bad INSTALL_REPORT.json / PHASE0_ACCEPTANCE.json is REJECTED by the server; the view shows REJECTED verbatim with the server's error codes and never VERIFIED", async () => {
    const app = mkApp();
    fs.writeFileSync(path.join(runtime(), "INSTALL_REPORT.json"), JSON.stringify({schemaVersion: "1.2.0", installId: "INSTALL-T1", components: {preflight: {present: true, file: SECRET_PATH, status: "PASS", sha256: "c".repeat(64)}}, phase0Final: "CLEAN", digest: "0".repeat(64)}));
    fs.writeFileSync(path.join(runtime(), "PHASE0_ACCEPTANCE.json"), JSON.stringify({schemaVersion: "1.2.0", final: "BLOCKED", installId: "INSTALL-T1", sealSignature: SECRET_SIG}));
    const raw = {install: await getJson(app, "/v1/install"), phase0: await getJson(app, "/v1/phase0")};
    expect(raw.install.verification).toBe("REJECTED");
    expect(raw.phase0.verification).toBe("REJECTED");
    const {ctx} = await mkCtx(async p => getJson(app, p));
    const view = await load("views", "install.js");
    const rootNode: N = await view.render(ctx);
    const ic = card(rootNode, "install"), pc = card(rootNode, "phase0");
    expect(ic.dataset.verification).toBe("REJECTED"); expect(pc.dataset.verification).toBe("REJECTED");
    expect(pc.dataset.final).toBe("INVALID");
    expect(pills(ic)).toEqual(["BLOCKED"]); expect(pillLabels(ic)).toEqual(["REJECTED"]);
    const codes = allData(rootNode, "errorCode").map(n => n.dataset.errorCode!);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c === "ERROR_DETAIL_WITHHELD" || /^[A-Z][A-Z0-9_]*(:[A-Za-z0-9_.-]+)?$/.test(c), c).toBe(true);
    expect(codes.some(c => /PHASE0_NOT_CLEAN/.test(c))).toBe(true);
    expect(kpiValue(rootNode, "total")).toBe(MISSING);
    // Kaynak şeridinin "Read OK" rozeti VERIFIED türündedir (yalnız okuma başarısı); karar rozeti asla.
    const verifiedPills = allData(rootNode, "pill", "VERIFIED").filter(n => !n.textContent.includes("Read OK"));
    expect(verifiedPills.length).toBe(0);
    expectClean(rootNode, "real-rejected");
  });
});

// ---------------- (2) allow-list + source guards ----------------
const blockOf = (name: string) => {
  const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc);
  expect(m, name).not.toBeNull();
  return m![1];
};
describe("Install — only already-allow-listed read-only GETs are used (protected files unchanged)", () => {
  it("all three GET paths are already admitted by the desktop allow-list; nothing new is (EXTRA_GET_ROUTES frozen)", async () => {
    const extra = new Function(`${blockOf("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    const allowed = (v: string) => boundary.desktopGetPathAllowed(v) || extra(v) || /^\/v1\/system\/executors$/.test(v) && mainSrc.includes('if(value==="/v1/system/executors")return true;');
    for (const p of THREE) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/install/", "/v1/install?x=1", "/v1/phase0/", "/v1/phase0?x=1", "/v1/firstrun", "/v1/install/verify", "/v1/system/install"]) expect(allowed(p), p).toBe(false);
    const set = mainSrc.match(/const EXTRA_GET_ROUTES=new Set\(\[([^\]]*)\]\)/)![1];
    expect(set).toBe('"/v1/cockpit","/v1/projects","/v1/missions","/v1/work-runs","/v1/evidence","/v1/roles","/v1/company/accounts","/v1/company/contacts","/v1/company/opportunities","/v1/company/invoices","/v1/company/payments","/v1/company/contracts"');
    expect(set.includes("install")).toBe(false);
    expect(set.includes("phase0")).toBe(false);
    // Allow-list yalnız zaten var olan yoldur: desktop sınırında ve server'da yeni bir install-verify yolu eklenmedi.
    for (const f of [mainSrc, fs.readFileSync(path.join(root, "apps", "control-api", "src", "server.ts"), "utf8"), fs.readFileSync(path.join(root, "automation", "lib", "control-boundary.mjs"), "utf8")]) {
      expect(f).not.toContain("/v1/install/verify");
      expect(f).not.toContain("/v1/firstrun");
    }
  });
  it("install.js / install-core.js never write and never reach outside ctx.api: no post, bridge, fetch/XHR, eval, HTML sinks, storage; imports are read-only modules", () => {
    for (const src of [read("views", "install.js"), read("install-core.js")]) {
      expect(src).not.toMatch(/\.post\(|window\.uasco|\bbridge\b|apiPost|apiGet|\bfetch\(|XMLHttpRequest|\beval\(|innerHTML|outerHTML|insertAdjacentHTML|new Function|localStorage|sessionStorage/);
      expect(src).not.toContain(FORBIDDEN);
      expect(src).not.toMatch(/transition|performTransition|work-actions|createMission|startRun|enableLocalClaude|buildEnableExecutorRequest/);
    }
    expect([...read("views", "install.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort()).toEqual(["../components.js", "../install-core.js", "../model.js", "../work-core.js"]);
    expect([...read("install-core.js").matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]).sort()).toEqual(["./executive-core.js", "./project-core.js"]);
    for (const m of ["installInstall", "installPhase0", "executors"]) expect(read("views", "install.js")).toContain(`api.${m}(`);
    // api.js: tek apiPost çağrısı korunur; yeni erişimciler yalnız sabit GET yollarını okur; executors() kopyalanmaz.
    expect(read("api.js").match(/bridge\.apiPost\(/g)?.length).toBe(1);
    const lines = read("api.js").split(String.fromCharCode(10));
    const accessors = lines.filter(l => /^\s*async install(Install|Phase0)\(\)/.test(l));
    expect(accessors.length).toBe(2);
    for (const l of accessors) { expect(l).not.toMatch(/post\(|apiPost|force|store\.projectId/); expect(l).toMatch(/await get\((INSTALL|PHASE0)_PATH\)/); }
    expect(lines.filter(l => /^\s*async executors\(\)/.test(l)).length).toBe(1);
    expect(lines.filter(l => /await get\(EXECUTORS_PATH\)/.test(l)).length).toBe(1);
  });
  it("the api layer requests exactly the three fixed paths, with no query string and no caller-chosen path", async () => {
    const {ctx, calls} = await mkCtx(serve());
    const core = await load("install-core.js");
    expect(core.INSTALL_SOURCE_PATHS).toEqual({install: "/v1/install", phase0: "/v1/phase0", executors: "/v1/system/executors"});
    expect(core.INSTALL_SOURCES).toEqual(["install", "phase0", "executors"]);
    expect(Object.isFrozen(core.INSTALL_SOURCES)).toBe(true);
    expect(Object.isFrozen(core.INSTALL_SOURCE_PATHS)).toBe(true);
    expect((await ctx.api.installInstall()).state).toBe("VERIFIED");
    expect((await ctx.api.installPhase0()).state).toBe("VERIFIED");
    expect((await ctx.api.executors()).state).toBe("VERIFIED");
    expect(calls).toEqual(THREE);
    for (const m of ["installInstall", "installPhase0"]) expect(ctx.api[m].length).toBe(0);
  });
  it("read failures are classified honestly by the api layer: OFFLINE / UNAVAILABLE / ERROR, and a malformed 200 is ERROR", async () => {
    const ms = ["installInstall", "installPhase0", "executors"];
    for (const [thrown, expected] of [["fetch failed", "OFFLINE"], ["x: HTTP 404", "UNAVAILABLE"], ["x: HTTP 500", "ERROR"]] as const) {
      const {ctx} = await mkCtx(() => { throw new Error(thrown); });
      for (const m of ms) expect((await ctx.api[m]()).state, `${thrown}/${m}`).toBe(expected);
    }
    const {ctx} = await mkCtx(() => ({nonsense: true}));
    for (const m of ms) expect((await ctx.api[m]()).state, m).toBe("ERROR");
  });
});

// ---------------- (3) pure mappers: fail-closed ----------------
describe("Install — pure mappers are fail-closed and never elevate state", () => {
  it("mapInstallReport carries the server verdict AS IS and drops paths, digests and signatures", async () => {
    const core = await load("install-core.js");
    const r = core.mapInstallReport(INSTALL_OK());
    expect(r.state).toBe("VERIFIED");
    expect(r.install).toMatchObject({verification: "VERIFIED", phase0Final: "CLEAN_LOCAL_ONLY", installId: "INSTALL-T1", generatedAt: T0, schemaVersion: "1.2.0", sourceCommit: "a".repeat(12)});
    expect(r.install.components).toEqual([{id: "preflight", present: true, status: "PASS"}, {id: "remote", present: false, status: "MISSING"}, {id: "controlApi", present: true, status: "PASS"}]);
    const json = JSON.stringify(r);
    for (const leak of [SECRET_PATH, SECRET_SIG, "c".repeat(64), "REMOTE_STATUS.json", "digest", "phase0SealSignature"]) expect(json).not.toContain(leak);
    expect(core.mapInstallReport(INSTALL_PENDING())).toEqual({state: "VERIFIED", install: {verification: "PENDING", phase0Final: "PENDING", installId: null, generatedAt: null, schemaVersion: null, sourceCommit: null, components: [], errors: []}});
    expect(core.mapInstallReport(INSTALL_REJECTED()).install).toMatchObject({verification: "REJECTED", phase0Final: "INVALID", errors: ["INSTALL_REPORT_PHASE0_NOT_VERIFIED", "INSTALL_COMPONENT_DIGEST_MISMATCH:preflight"]});
    // Serbest metin hata iletisi (yol sızabilir) taşınmaz.
    const free = core.mapInstallReport({...INSTALL_REJECTED(), errors: [`ENOENT: no such file ${SECRET_PATH}`]});
    expect(free.install.errors).toEqual(["ERROR_DETAIL_WITHHELD"]);
    expect(JSON.stringify(free)).not.toContain(SECRET_PATH);
  });
  it("mapPhase0Report carries final/verification AS IS and drops signature, input paths/digests and free-text details", async () => {
    const core = await load("install-core.js");
    const r = core.mapPhase0Report(PHASE0_OK());
    expect(r.state).toBe("VERIFIED");
    expect(r.phase0).toMatchObject({verification: "VERIFIED", final: "CLEAN_LOCAL_ONLY", installId: "INSTALL-T1", signed: true, sourceCommit: "a".repeat(12), inputs: {total: 2, present: 1}});
    expect(r.phase0.checks).toEqual([{name: "globalStop", status: "PASS"}, {name: "processLockIdle", status: "PASS"}, {name: "remote", status: "PENDING"}]);
    const json = JSON.stringify(r);
    for (const leak of [SECRET_PATH, SECRET_SIG, SECRET_DETAIL, "b".repeat(64), "e".repeat(64), "sealSignature", "trustRootManifest"]) expect(json).not.toContain(leak);
    // Düz değerli kontroller (eski biçim) de kabul edilir.
    expect(core.mapPhase0Report({...PHASE0_OK(), checks: {fixture: "PASS"}}).phase0.checks).toEqual([{name: "fixture", status: "PASS"}]);
    expect(core.mapPhase0Report(PHASE0_PENDING()).phase0).toMatchObject({verification: "PENDING", final: "PENDING", checks: [], signed: false, inputs: null});
    expect(core.mapPhase0Report(PHASE0_REJECTED()).phase0).toMatchObject({verification: "REJECTED", final: "INVALID", errors: ["PHASE0_NOT_CLEAN", "PHASE0_SIGNATURE_INVALID"]});
  });
  it("malformed, unknown or contradictory install reports make the WHOLE read ERROR — no partial list, no elevation", async () => {
    const core = await load("install-core.js");
    const bad = {state: "ERROR", install: null};
    const mut = (f: (x: any) => void, base: () => any = INSTALL_OK) => { const x = base(); f(x); return core.mapInstallReport(x); };
    for (const raw of [null, undefined, "x", 7, [], {}, {verification: "VERIFIED"}, {nonsense: true}]) expect(core.mapInstallReport(raw), JSON.stringify(raw)).toEqual(bad);
    expect(mut(x => { x.verification = "OK"; })).toEqual(bad);
    expect(mut(x => { x.verification = "verified"; })).toEqual(bad);
    expect(mut(x => { delete x.verification; })).toEqual(bad);
    expect(mut(x => { x.components = []; })).toEqual(bad);
    expect(mut(x => { x.components.preflight = null; })).toEqual(bad);
    expect(mut(x => { x.components.preflight.present = "yes"; })).toEqual(bad);
    expect(mut(x => { delete x.components.preflight.status; })).toEqual(bad);
    expect(mut(x => { x.components["bad key!"] = {present: true, status: "PASS"}; })).toEqual(bad);
    // Çelişki: VERIFIED ama Phase-0 temiz değil / kimlik, zaman, şema eksik / hata var.
    expect(mut(x => { x.phase0Final = "PENDING"; })).toEqual(bad);
    expect(mut(x => { x.phase0Final = "INVALID"; })).toEqual(bad);
    expect(mut(x => { delete x.phase0Final; })).toEqual(bad);
    expect(mut(x => { x.installId = "nope"; })).toEqual(bad);
    expect(mut(x => { x.generatedAt = "not a date"; })).toEqual(bad);
    expect(mut(x => { delete x.schemaVersion; })).toEqual(bad);
    expect(mut(x => { x.phase0SourceCommit = "xyz"; })).toEqual(bad);
    expect(mut(x => { x.errors = ["SOME_CODE"]; })).toEqual(bad);
    // Çelişki: PENDING ama bileşen/hata var; REJECTED ama hata listesi yok ya da temiz final.
    expect(mut(x => { x.components = {a: {present: true, status: "PASS"}}; }, INSTALL_PENDING)).toEqual(bad);
    expect(mut(x => { x.errors = ["X_Y"]; }, INSTALL_PENDING)).toEqual(bad);
    expect(mut(x => { delete x.errors; }, INSTALL_REJECTED)).toEqual(bad);
    expect(mut(x => { x.phase0Final = "CLEAN"; }, INSTALL_REJECTED)).toEqual(bad);
    expect(mut(x => { x.errors = "boom"; }, INSTALL_REJECTED)).toEqual(bad);
    expect(mut(x => { x.errors = [1]; }, INSTALL_REJECTED)).toEqual(bad);
    expect(mut(x => { x.components = {a: {present: true, status: "PASS"}}; }, INSTALL_REJECTED)).toEqual(bad);
    // Sınır: çok fazla bileşen tümden reddedilir.
    expect(mut(x => { x.components = Object.fromEntries(Array.from({length: 65}, (_, i) => [`c${i}`, {present: true, status: "PASS"}])); })).toEqual(bad);
  });
  it("malformed, unknown or contradictory Phase-0 reports make the WHOLE read ERROR", async () => {
    const core = await load("install-core.js");
    const bad = {state: "ERROR", phase0: null};
    const mut = (f: (x: any) => void, base: () => any = PHASE0_OK) => { const x = base(); f(x); return core.mapPhase0Report(x); };
    for (const raw of [null, undefined, "x", 7, [], {}, {verification: "VERIFIED"}, {nonsense: true}]) expect(core.mapPhase0Report(raw), JSON.stringify(raw)).toEqual(bad);
    expect(mut(x => { x.verification = "OK"; })).toEqual(bad);
    expect(mut(x => { delete x.final; })).toEqual(bad);
    expect(mut(x => { x.final = "BLOCKED"; })).toEqual(bad); // VERIFIED ama final temiz değil: yükseltme yok
    expect(mut(x => { x.final = "PENDING"; })).toEqual(bad);
    expect(mut(x => { x.checks = []; })).toEqual(bad);
    expect(mut(x => { x.checks.globalStop = {detail: "x"}; })).toEqual(bad);
    expect(mut(x => { x.checks.globalStop = 5; })).toEqual(bad);
    expect(mut(x => { delete x.sealSignature; })).toEqual(bad);
    expect(mut(x => { x.sealSignature = ""; })).toEqual(bad);
    expect(mut(x => { x.sourceCommit = "short"; })).toEqual(bad);
    expect(mut(x => { x.installId = "x"; })).toEqual(bad);
    expect(mut(x => { x.inputDigests = {a: {present: "1"}}; })).toEqual(bad);
    expect(mut(x => { x.inputDigests = []; })).toEqual(bad);
    expect(mut(x => { x.errors = ["E_X"]; })).toEqual(bad);
    expect(mut(x => { x.errors = ["E_X"]; }, PHASE0_PENDING)).toEqual(bad);
    expect(mut(x => { delete x.errors; }, PHASE0_REJECTED)).toEqual(bad);
    expect(mut(x => { x.final = "CLEAN"; }, PHASE0_REJECTED)).toEqual(bad);
    expect(mut(x => { x.errors = "boom"; }, PHASE0_REJECTED)).toEqual(bad);
    expect(mut(x => { x.checks = Object.fromEntries(Array.from({length: 65}, (_, i) => [`c${i}`, "PASS"])); })).toEqual(bad);
  });
  it("buildInstall carries every verdict separately: no overall install claim, unreadable sources are null (never empty), cross-check never reconciles", async () => {
    const {out, core} = await assess();
    expect(out.complete).toBe(true);
    expect(out.unreadable).toEqual([]);
    expect(out.counts).toEqual({total: 3, present: 2});
    expect(out.reconcile).toEqual({install: "CLEAN_LOCAL_ONLY", phase0: "CLEAN_LOCAL_ONLY", agree: true});
    expect(Object.keys(out).some(k => /overall|complete(d)?Install|healthy|ready/i.test(k) && k !== "complete")).toBe(false);
    const mismatch = (await assess({phase0: {...PHASE0_OK(), final: "CLEAN"}})).out;
    expect(mismatch.reconcile).toEqual({install: "CLEAN_LOCAL_ONLY", phase0: "CLEAN", agree: false});
    // Okunamayan kaynak: null (boş/0 değil), birleşik karar yok.
    const res = {install: {state: "OFFLINE", install: null}, phase0: {state: "UNAVAILABLE", phase0: null}, executors: {state: "ERROR", items: []}};
    const o = core.buildInstall(res);
    expect(o.install).toBeNull(); expect(o.phase0).toBeNull(); expect(o.executors).toBeNull(); expect(o.counts).toBeNull(); expect(o.reconcile).toBeNull();
    expect(o.sources).toEqual({install: {state: "OFFLINE"}, phase0: {state: "UNAVAILABLE"}, executors: {state: "ERROR"}});
    expect(o.complete).toBe(false);
    // VERIFIED ama gövdesi eksik okuma ERROR sayılır.
    const odd = core.buildInstall({install: {state: "VERIFIED"}, phase0: {state: "VERIFIED", phase0: null}, executors: {state: "VERIFIED"}});
    expect(odd.sources).toEqual({install: {state: "ERROR"}, phase0: {state: "ERROR"}, executors: {state: "ERROR"}});
    // Kapalı küme: yalnız sunucunun üç kararı.
    expect(core.VERIFICATIONS).toEqual(["VERIFIED", "PENDING", "REJECTED"]);
    expect(core.CLEAN_FINALS).toEqual(["CLEAN", "CLEAN_LOCAL_ONLY"]);
    expect(core.UNKNOWN_DETAILS).toEqual(["OFFLINE", "UNAVAILABLE", "ERROR"]);
  });
});

// ---------------- (4) view honesty ----------------
describe("Install — view honesty", () => {
  it("VERIFIED reports: verdicts verbatim with VERIFIED pills only because the server said so; components and checks listed without paths, digests or signatures", async () => {
    const {root: r, calls} = await renderView(serve());
    expect(calls.slice().sort()).toEqual([...THREE].sort());
    expect(byId(r, "view-title")!.textContent).toBe("First-run install verification");
    expect(cls(r, "view-install")).toBe(true);
    const ic = card(r, "install"), pc = card(r, "phase0");
    expect(ic.dataset).toMatchObject({verification: "VERIFIED", final: "CLEAN_LOCAL_ONLY"});
    expect(pc.dataset).toMatchObject({verification: "VERIFIED", final: "CLEAN_LOCAL_ONLY"});
    expect(pills(ic)).toEqual(["VERIFIED"]); expect(pillLabels(ic)).toEqual(["VERIFIED"]);
    expect(pills(pc)).toEqual(["VERIFIED"]);
    expect(allData(ic, "verbatim").map(n => n.textContent)).toContain("CLEAN_LOCAL_ONLY");
    expect(byData(r, "reconcile", "agree")).toBeTruthy();
    expect(kpiValue(r, "total")).toBe("3");
    expect(kpiValue(r, "present")).toBe("2");
    expect(allData(r, "component").map(n => [n.dataset.component, n.dataset.present, n.dataset.status])).toEqual([["preflight", "1", "PASS"], ["remote", "0", "MISSING"], ["controlApi", "1", "PASS"]]);
    expect(allData(r, "check").map(n => [n.dataset.check, n.dataset.status])).toEqual([["globalStop", "PASS"], ["processLockIdle", "PASS"], ["remote", "PENDING"]]);
    expect(byData(r, "field", "inputs")!.dataset).toMatchObject({total: "2", present: "1"});
    expect(byData(r, "fact", "signed")).toBeTruthy();
    expect(allData(r, "component", "remote")[0].children.length).toBeGreaterThan(0);
    expect(pills(allData(r, "component", "remote")[0])).toEqual(["NOT_EXECUTED"]); // yok = çalışmadı; asla başarı rozeti değil
    expectClean(r, "verified");
  });
  it("EXPLICIT: server verdicts are never elevated — PENDING and REJECTED never show a VERIFIED pill, and one VERIFIED report does not make the other one VERIFIED", async () => {
    for (const [label, over] of [
      ["both pending", {"/v1/install": INSTALL_PENDING(), "/v1/phase0": PHASE0_PENDING()}],
      ["both rejected", {"/v1/install": INSTALL_REJECTED(), "/v1/phase0": PHASE0_REJECTED()}],
      ["install ok, phase0 pending", {"/v1/phase0": PHASE0_PENDING()}],
      ["install rejected, phase0 ok", {"/v1/install": INSTALL_REJECTED()}],
    ] as const) {
      const {root: r} = await renderView(serve(over as any));
      const ic = card(r, "install"), pc = card(r, "phase0");
      const want = (b: any, fallback: string) => b.verification;
      const i = (over as any)["/v1/install"]?.verification ?? "VERIFIED", p = (over as any)["/v1/phase0"]?.verification ?? "VERIFIED";
      expect(ic.dataset.verification, label).toBe(i); expect(pc.dataset.verification, label).toBe(p);
      expect(pills(ic).includes("VERIFIED"), label).toBe(i === "VERIFIED"); expect(pills(pc).includes("VERIFIED"), label).toBe(p === "VERIFIED");
      void want;
      if (i !== "VERIFIED") { expect(kpiValue(r, "total"), label).toBe(MISSING); expect(allData(r, "component").length, label).toBe(0); }
      if (p !== "VERIFIED") expect(allData(r, "check").length, label).toBe(0);
      expectClean(r, label);
    }
    // Çapraz denetim uyuşmazlığı düzeltilmez: iki değer de gösterilir.
    const {root: mm} = await renderView(serve({"/v1/phase0": {...PHASE0_OK(), final: "CLEAN"}}));
    const note = byData(mm, "reconcile", "mismatch")!;
    expect(note.dataset).toMatchObject({install: "CLEAN_LOCAL_ONLY", phase0: "CLEAN"});
    expect(note.textContent).toContain("CLEAN_LOCAL_ONLY"); expect(note.textContent).toContain("CLEAN");
  });
  it("executors: states are carried verbatim; ACTIVE (ready) only when the server says READY / AVAILABLE; nothing is connected by default", async () => {
    const {root: r} = await renderView(serve());
    const lc = allData(r, "executor", "LOCAL_CLAUDE")[0];
    expect(lc.dataset.state).toBe("NOT_CONFIGURED");
    expect(pills(lc)).toEqual(["NOT_CONNECTED"]); expect(pillLabels(lc)).toEqual(["NOT_CONFIGURED"]);
    expect(pills(allData(r, "executor", "FAKE")[0])).toEqual(["NOT_VERIFIED"]);
    expect(byData(r, "sandbox", "UNAVAILABLE")).toBeTruthy();
    expect(pills(byData(r, "fact", "sandbox")!)).toEqual(["UNAVAILABLE"]);
    expect(allData(r, "profile").map(n => [n.dataset.profile, n.dataset.state])).toEqual([["implementer", "READY"], ["reviewer", "LOGIN_REQUIRED"]]);
    expect(pills(allData(r, "profile", "reviewer")[0])).toEqual(["NEUTRAL"]); // bilinmeyen durum NEUTRAL, bağlı değil
    const ready = (await renderView(serve({"/v1/system/executors": EXECUTORS({executors: {LOCAL_CLAUDE: {state: "READY"}}, sandbox: {state: "AVAILABLE", providerId: "p1"}})}))).root;
    expect(pills(allData(ready, "executor", "LOCAL_CLAUDE")[0])).toEqual(["ACTIVE"]);
    expect(pillLabels(allData(ready, "executor", "LOCAL_CLAUDE")[0])).toEqual(["READY"]);
    expect(pills(byData(ready, "fact", "sandbox")!)).toEqual(["ACTIVE"]);
    // Sandbox tanınmayan biçimde: bilinmiyor (AVAILABLE uydurulmaz).
    const unk = (await renderView(serve({"/v1/system/executors": EXECUTORS({sandbox: {state: "WEIRD"}})}))).root;
    expect(byData(unk, "sandbox", "unknown")).toBeTruthy();
    expect(pills(byData(unk, "fact", "sandbox")!)).toEqual(["NEUTRAL"]);
    // Yürütücü listesi boş: gerçek ve okunabilir, sıfır ile karıştırılmaz.
    const none = (await renderView(serve({"/v1/system/executors": EXECUTORS({executors: {}})}))).root;
    expect(byData(none, "executorsEmpty", "1")).toBeTruthy();
  });
  it("EVERY scenario in EN and TR renders without the forbidden constant, without leaked paths/digests/signatures and without raw i18n keys", async () => {
    const scenarios: Array<[string, Record<string, any>]> = [
      ["verified", {}],
      ["pending", {"/v1/install": INSTALL_PENDING(), "/v1/phase0": PHASE0_PENDING()}],
      ["rejected", {"/v1/install": INSTALL_REJECTED(), "/v1/phase0": PHASE0_REJECTED()}],
      ["offline", {"/v1/install": () => fail("fetch failed"), "/v1/phase0": () => { throw new Error("fetch failed"); }, "/v1/system/executors": () => { throw new Error("fetch failed"); }}],
      ["mixed-down", {"/v1/install": down(404), "/v1/phase0": down(500), "/v1/system/executors": { nonsense: true }}],
      ["api-carries-constant", {"/v1/system/executors": EXECUTORS({extra: FORBIDDEN}), "/v1/install": {...INSTALL_OK(), note: FORBIDDEN}}],
    ];
    for (const lang of ["en", "tr"]) for (const [label, over] of scenarios) {
      const {root: r} = await renderView(serve(over), lang);
      expectClean(r, `${lang}/${label}`);
      expect(surface(r), `${lang}/${label}`).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b|\[object/);
    }
  });
  it("each source fails independently with its own honest state; healthy sources stay intact, only dependent figures are withheld (—, never 0)", async () => {
    const cases: Array<[string, Record<string, any>, string[], string]> = [
      ["install offline", {"/v1/install": () => { throw new Error("fetch failed"); }}, ["install"], "OFFLINE"],
      ["install 404", {"/v1/install": down(404)}, ["install"], "UNAVAILABLE"],
      ["install 500", {"/v1/install": down(500)}, ["install"], "ERROR"],
      ["phase0 500", {"/v1/phase0": down(500)}, ["phase0"], "ERROR"],
      ["executors 404", {"/v1/system/executors": down(404)}, ["executors"], "UNAVAILABLE"],
    ];
    for (const [label, over, bad, st] of cases) {
      const {root: r} = await renderView(serve(over));
      for (const k of ["install", "phase0", "executors"]) {
        const li = sourcesOf(r).find(n => n.dataset.source === k)!;
        expect(li.dataset.sourceState, `${label}/${k}`).toBe(bad.includes(k) ? st : "VERIFIED");
      }
      const blocks = allData(r, "installState");
      expect(blocks.map(b => [b.dataset.source, b.dataset.installState]), label).toEqual(bad.map(k => [k, st]));
      for (const b of blocks) expect(b.getAttribute("role")).toBe("status");
      expect(byData(r, "installPartial")!.dataset.installPartial).toBe(bad.join(","));
      if (bad[0] === "install") {
        expect(card(r, "install").dataset.verification).toBe("UNREAD");
        expect(kpiValue(r, "total")).toBe(MISSING); expect(kpiValue(r, "present")).toBe(MISSING);
        expect(allData(r, "component").length).toBe(0);
        expect(card(r, "phase0").dataset.verification).toBe("VERIFIED"); // sağlam kaynak etkilenmez
        expect(byData(r, "reconcile")).toBeUndefined(); // karşılaştırma yalnız iki rapor da okunduysa
      }
      if (bad[0] === "phase0") { expect(card(r, "phase0").dataset.verification).toBe("UNREAD"); expect(allData(r, "check").length).toBe(0); expect(card(r, "install").dataset.verification).toBe("VERIFIED"); expect(kpiValue(r, "total")).toBe("3"); }
      if (bad[0] === "executors") { expect(allData(r, "executor").length).toBe(0); expect(byData(r, "executorsEmpty")).toBeUndefined(); expect(card(r, "install").dataset.verification).toBe("VERIFIED"); }
      expect(pills(card(r, bad[0] === "executors" ? "install" : bad[0])).includes("VERIFIED"), label).toBe(bad[0] === "executors");
      expectClean(r, label);
    }
  });
  it("when everything is unreadable nothing is verified, connected, empty or zero", async () => {
    const {root: r} = await renderView(() => { throw new Error("fetch failed"); });
    expect(sourcesOf(r).map(n => n.dataset.sourceState)).toEqual(["OFFLINE", "OFFLINE", "OFFLINE"]);
    expect(card(r, "install").dataset.verification).toBe("UNREAD"); expect(card(r, "phase0").dataset.verification).toBe("UNREAD");
    expect(kpiValue(r, "total")).toBe(MISSING); expect(kpiValue(r, "present")).toBe(MISSING);
    for (const bad of ["component", "check", "executor", "profile", "executorsEmpty", "componentsEmpty", "checksEmpty"]) expect(allData(r, bad).length, bad).toBe(0);
    expect(pills(r)).not.toContain("VERIFIED"); expect(pills(r)).not.toContain("ACTIVE"); expect(pills(r)).not.toContain("DONE");
    expect(allData(r, "pill").filter(n => /verified|connected/i.test(n.textContent)).length).toBe(0);
    expectClean(r, "all-down");
  });
  it("a malformed record rejects only its own source: no partial figures from it, the other sources stay readable", async () => {
    const badInstall = INSTALL_OK(); (badInstall.components as any).preflight.present = "yes";
    const {root: r} = await renderView(serve({"/v1/install": badInstall}));
    expect(sourcesOf(r).map(n => [n.dataset.source, n.dataset.sourceState])).toEqual([["install", "ERROR"], ["phase0", "VERIFIED"], ["executors", "VERIFIED"]]);
    expect(allData(r, "component").length).toBe(0); expect(kpiValue(r, "total")).toBe(MISSING);
    expect(card(r, "phase0").dataset.verification).toBe("VERIFIED");
    // VERIFIED ama çelişkili (Phase-0 temiz değil) rapor da tümden reddedilir.
    const {root: c} = await renderView(serve({"/v1/phase0": {...PHASE0_OK(), final: "BLOCKED"}}));
    expect(sourcesOf(c).find(n => n.dataset.source === "phase0")!.dataset.sourceState).toBe("ERROR");
    expect(pills(card(c, "phase0"))).not.toContain("VERIFIED");
  });
  it("API text is rendered as text only (no markup interpretation)", async () => {
    const inj = INSTALL_OK(); (inj.components as any).preflight.status = "<img src=x onerror=alert(1)>";
    const ph = PHASE0_OK(); (ph.checks as any).globalStop = {status: "<b>PASS</b>"};
    const {root: r} = await renderView(serve({"/v1/install": inj, "/v1/phase0": ph}));
    expect(all(r).some(n => ["IMG", "B", "SCRIPT", "IFRAME"].includes(n.tagName))).toBe(false);
    expect(allData(r, "component", "preflight")[0].textContent).toContain("<img src=x onerror=alert(1)>");
    expect(allData(r, "check", "globalStop")[0].textContent).toContain("<b>PASS</b>");
  });
  it("renders the same facts in Turkish (localized labels, same data)", async () => {
    const {root: r} = await renderView(serve(), "tr");
    expect(byId(r, "view-title")!.textContent).toBe("İlk çalıştırma kurulum doğrulaması");
    expect(card(r, "install").dataset.verification).toBe("VERIFIED");
    expect(pillLabels(card(r, "install"))).toEqual(["VERIFIED"]); // sunucu kararı çevrilmez, AYNEN gösterilir
    expect(kpiValue(r, "total")).toBe("3");
    expect(surface(r)).toContain("Kurulum bileşenleri");
    expect(allData(r, "component").length).toBe(3);
  });
  it("the only action navigates to the existing Settings screen — it never POSTs or changes anything", async () => {
    const view = await load("views", "install.js");
    const posts: string[] = [];
    const m = await mkCtx(serve(), "en", (p) => { posts.push(p); return {}; });
    const r: N = await view.render(m.ctx);
    const buttons = all(r).filter(n => n.tagName === "BUTTON");
    expect(buttons.map(b => b.id)).toEqual(["install-open-settings"]);
    expect(all(r).filter(n => ["INPUT", "FORM", "SELECT", "TEXTAREA"].includes(n.tagName)).length).toBe(0);
    click(buttons[0]);
    expect(m.nav).toEqual(["settings"]);
    expect(posts).toEqual([]);
    expect(m.calls.every(p => THREE.includes(p))).toBe(true);
  });
});

// ---------------- (5) locale parity and key coverage ----------------
describe("Install — locale parity and key coverage", () => {
  const sub = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("install.") || k.startsWith("area.install.")).sort();
  it("every install.* / area.install.* key is identical and non-empty in TR and EN, with identical placeholders; whole dictionaries stay in parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    expect(sub(tr)).toEqual(sub(en));
    expect(sub(tr).length).toBeGreaterThan(60);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of sub(tr)) { expect(tr[k], `tr ${k}`).toBeTruthy(); expect(en[k], `en ${k}`).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(tr["area.install.title"]).toBe("İlk çalıştırma kurulum doğrulaması");
    expect(en["area.install.title"]).toBe("First-run install verification");
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const k of sub(tr)) for (const d of [tr, en]) { expect(d[k], k).not.toContain(FORBIDDEN); expect(d[k], k).not.toMatch(/product[\s_-]*verified/i); }
    // Dürüstlük: hiçbir metin kurulumu "tamam/hazır/sağlıklı" ilan etmez.
    const claim = /\bhealthy\b|all clear|install(ation)? (is )?complete|\bsuccessfully\b|sağlıklı|kurulum tamam(landı)?\b/i;
    for (const k of sub(en).filter(k => k !== "install.verify.lead")) { expect(en[k], k).not.toMatch(claim); expect(tr[k], k).not.toMatch(claim); }
    // Tek istisna: genel bir "kurulum tamam" iddiasının YAPILMADIĞINI söyleyen olumsuzlama.
    expect(en["install.verify.lead"]).toContain("never combines");
    // Doğrulama kararları çevrilmez: ham sunucu değeri her iki dilde de metinde geçer.
    for (const v of ["VERIFIED", "PENDING", "REJECTED"]) { expect(en[`install.verdict.${v}`]).toContain(v); expect(tr[`install.verdict.${v}`]).toContain(v); }
  });
  it("every literal and enumerated key used by install.js exists in both dictionaries, and no install key is dead", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const core = await load("install-core.js");
    const src = read("views", "install.js");
    const need = new Set<string>();
    for (const m of src.matchAll(/(?:\bt\(|labelKey:|titleKey:)\s*"([a-zA-Z0-9_.]+)"/g)) need.add(m[1]);
    for (const k of core.INSTALL_SOURCES) { need.add(`install.src.${k}`); need.add(`install.srcShort.${k}`); }
    for (const k of core.UNKNOWN_DETAILS) { need.add(`install.state.${k}`); need.add(`install.hint.${k}`); }
    for (const k of core.VERIFICATIONS) need.add(`install.verdict.${k}`);
    for (const k of ["install", "phase0"]) need.add(`install.card.${k}`);
    for (const k of ["final", "phase0Final", "installId", "generatedAt", "schema", "sourceCommit", "signed"]) need.add(`install.field.${k}`);
    for (const b of ["components", "checks"]) for (const k of ["UNREAD", "PENDING", "REJECTED"]) need.add(`install.${b}.withheld.${k}`);
    for (const k of ["total", "present"]) { need.add(`install.kpi.${k}`); need.add(`install.kpi.q.${k}`); }
    for (const k of ["agree", "mismatch"]) need.add(`install.reconcile.${k}`);
    for (const k of ["signed.yes", "signed.no", "component.present", "component.absent", "exec.withheld"]) need.add(`install.${k}`);
    need.add("area.install.title"); need.add("area.install.desc");
    expect([...need].filter(k => !(k in en))).toEqual([]);
    expect([...need].filter(k => !(k in tr))).toEqual([]);
    expect(need.size).toBeGreaterThan(60);
    // Sözlükte ölü anahtar kalmaz: her install.* anahtarı görünümde/çekirdekte kullanılır.
    expect(Object.keys(en).filter(k => (k.startsWith("install.") || k.startsWith("area.install.")) && !need.has(k))).toEqual([]);
    // Yeniden kullanılan mevcut anahtarlar iki dilde de vardır.
    for (const k of ["exec.testOnlyNote", "exec.profile.role.implementer", "exec.profile.role.reviewer", "exec.name.LOCAL_CLAUDE", "exec.name.FAKE"]) { expect(k in en, k).toBe(true); expect(k in tr, k).toBe(true); }
  });
});

// ---------------- (6) routing ----------------
describe("Install — route delegation (app.js VIEWS unchanged)", () => {
  it("routes.js maps #/install to the planned host with component 'install' (no plannedPackage), distinct from the firstrun wizard, reusing an existing icon", async () => {
    const routes = await load("routes.js"), icons = await load("icons.js");
    const r = routes.routeById("install");
    expect(r).toMatchObject({id: "install", hash: "#/install", view: "planned", component: "install", factory: false, icon: "check"});
    expect(Object.isFrozen(routes.ROUTES)).toBe(true);
    expect(r.plannedPackage).toBeUndefined();
    expect(icons.ICON_NAMES).toContain(r.icon);
    expect(routes.routeFromHash("#/install")).toBe("install");
    expect(routes.routeFromHash("#/install/")).toBe("install");
    expect(routes.routeFromHash("#/installx")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeFromHash("#/Install")).toBe(routes.DEFAULT_ROUTE);
    expect(routes.routeById("firstrun")).toBeNull(); // firstrun (ilk açılış sihirbazı) rota DEĞİLDİR ve yeniden kullanılmaz
    expect(routes.ROUTES.filter((x: any) => x.id === "install").length).toBe(1);
    expect(routes.ROUTES.at(-1).id).toBe("settings");
    expect(routes.FACTORY_AREA_ORDER).not.toContain("install");
    expect(routes.ROUTES.filter((x: any) => x.factory).length).toBe(8);
    for (const id of ["matrix", "operations", "posture", "readiness", "queue", "executive", "journey", "academy", "company", "delivery"]) expect(routes.routeById(id).component).toBe(id);
    expect(routes.routeById("assurance")).toMatchObject({id: "assurance", hash: "#/assurance", view: "assurance", factory: true});
    expect(read("routes.js")).toMatch(/\/\/ \/\/TR: FA-V2-PRODUCT \(UI-248/);
  });
  it("planned.js delegates the 'install' component to the real view; app.js VIEWS table has no install entry and is untouched", async () => {
    expect(read("views", "planned.js")).toContain('import * as install from "./install.js"');
    expect(read("views", "planned.js")).toMatch(/Object\.freeze\(\{[^}]*install[^}]*\}\)/);
    const app = read("app.js");
    expect(app).not.toContain("install.js");
    expect(app).not.toMatch(/\binstall\b/);
    expect(app).toContain("const VIEWS={home,projects,work,workforce,assurance,planned,tower,inbox,settings};");
    const planned = await load("views", "planned.js");
    const {ctx} = await mkCtx(serve());
    const rootNode: N = await planned.render(ctx, {id: "install", component: "install"});
    expect(cls(rootNode, "view-install")).toBe(true);
    expect(byId(rootNode, "view-title")!.textContent).toBe("First-run install verification");
    // Mevcut devredilen rotalar etkilenmez.
    const mx = await planned.render((await mkCtx(() => ({nonsense: 1}))).ctx, {id: "matrix", component: "matrix"});
    expect(cls(mx, "view-matrix")).toBe(true);
    const op = await planned.render((await mkCtx(() => ({nonsense: 1}))).ctx, {id: "operations", component: "operations"});
    expect(cls(op, "view-operations")).toBe(true);
  });
  it("the navigation label and palette entry come from the localized area title (no planned-package panel)", async () => {
    const routes = await load("routes.js"), i18n = await load("i18n.js");
    for (const lang of ["en", "tr"]) for (const r of routes.ROUTES) expect(i18n.translate(lang, `area.${r.id}.title`), `${lang}/${r.id}`).not.toBe(`area.${r.id}.title`);
    expect(i18n.translate("tr", "area.install.title")).toBe("İlk çalıştırma kurulum doğrulaması");
    expect(i18n.translate("en", "area.install.desc")).toContain("Read-only.");
  });
});

// ---------------- (7) forbidden constant scan ----------------
describe("Install — the forbidden verified-product constant never appears in new source or rendered surface", () => {
  it("none of the new/edited renderer sources contains it, and the test fixtures that carry it as API data never reach the surface", async () => {
    for (const f of [["install-core.js"], ["views", "install.js"], ["locales", "en.js"].slice(0, 0).length ? [] : ["views", "planned.js"]]) expect(read(...(f as string[])), f.join("/")).not.toContain(FORBIDDEN);
    // Ortamdan bağımsız: CI checkout'unda origin/v7/integration yok; bu paketin eklediği satırlar içerikle seçilip taranır.
    const sel: [string[], RegExp][] = [[["locales", "en.js"], /"(area\.)?install\./], [["locales", "tr.js"], /"(area\.)?install\./], [["routes.js"], /install|phase0/i], [["api.js"], /install|phase0/i]];
    const added = sel.flatMap(([f, re]) => read(...f).split("\n").filter(l => re.test(l)));
    expect(added.length).toBeGreaterThanOrEqual(150);
    for (const l of added) expect(l, l.slice(0, 80)).not.toContain(FORBIDDEN);
    const {root: r} = await renderView(serve({"/v1/install": {...INSTALL_OK(), note: FORBIDDEN}, "/v1/phase0": {...PHASE0_OK(), productVerification: {status: FORBIDDEN}}}));
    expect(surface(r)).not.toContain(FORBIDDEN);
  });
});
