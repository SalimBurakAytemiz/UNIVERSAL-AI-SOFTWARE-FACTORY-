// //TR: Bu test UX WP-DELIVERY Teslimat & SRE görünümünün (apps/desktop/renderer/views/delivery.js) dürüstlüğünü gerçek görünüm modülü + sahte DOM ile doğrular: operasyonel sağlık (GET /health, /v1/control/status, /v1/founder-attention) ve yayın hazırlığı (GET /v1/work-runs) yalnız gerçek, allow-list'li veriden okunur; test yürütme kanıtı yoksa koşu NOT_VERIFIED kalır, asla COMPLETE/PASS/VERIFIED gösterilmez; gerçek üretim deploy BLOCKED ve canlı SRE izleme NOT_CONNECTED olarak Founder kapısını anarak gösterilir (sahte buton veya uydurma uptime/SLO/metrik yok); veri yokken ayrık dürüst durumlar gösterilir; rota WP3 gibi planned.js üzerinden devreder; delivery.* sözlüğü EN/TR'de birebirdir.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
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
}
class D {
  body: N;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byData = (root: N, k: string) => all(root).find(n => k in n.dataset);
const sourceState = (root: N, key: string) => all(root).find(n => n.tagName === "LI" && n.dataset.source === key)?.dataset.sourceState;
const pillsIn = (n: N | undefined) => n ? all(n).filter(x => "pill" in x.dataset).map(x => x.dataset.pill) : [];
const rows = (root: N) => all(root).filter(n => n.tagName === "TR" && "deliveryRun" in n.dataset);

const RUN = "run_" + "ab".repeat(12);
const RUN2 = "run_" + "cd".repeat(12);

async function mkCtx(get: (p: string) => any, lang = "en", now: () => number = () => 1_760_000_000_000) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => { calls.push(p); return get(p); }};
  const api = apiMod.createApi({bridge, store, now});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, principal: "FOUNDER_LOCAL", rerender: async () => {}};
  return {ctx, doc, calls};
}

// PQ-001: sunucunun kesin kuralı (core/workos/outcomes.ts productVerificationOf): head SHA için VERIFY_TESTS + REGRESSION_TESTS, exit 0, sandbox tanığı, yürütülen test sayısı > 0.
const HEAD = "a".repeat(40), OTHER = "b".repeat(40);
const tev = (kind: string, extra: Record<string, any> = {}) => ({evidenceId: "evd_" + kind.toLowerCase().replace(/_/g, "").padEnd(12, "0").slice(0, 12), kind, commitSha: HEAD, exitCode: 0, sandboxProviderId: "sbx.fake", ...extra});
const surface = (extra: Record<string, any> = {}) => tev("TEST_SURFACE", {exitCode: null, sandboxProviderId: undefined, testSurface: {functionalAcceptance: "UNVERIFIED_ORACLE", executedTests: 12, modified: [], deleted: [], renamed: [], harness: [], weakened: [], ...extra}});
const fullEvidence = (over: Record<string, any> = {}) => [tev("VERIFY_TESTS", over.verify), tev("REGRESSION_TESTS", over.regression), surface(over.surface)];
const HEALTHY = {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"};
const liveFix = (overrides: Record<string, any> = {}): Record<string, any> => ({
  "/health": HEALTHY,
  "/v1/control/status": {globalStop: {active: false, reason: null}},
  "/v1/attention": {attention: {items: [], counts: {RUN_AWAITING_APPROVAL: 0, MISSION_FOUNDER_ATTENTION: 0, RUN_NEEDS_DECISION: 0, MISSION_AUTHORIZATION_PENDING: 0, MISSION_BLOCKED: 0, TASK_BLOCKED: 0}, truncated: false, source: "WORKOS"}},
  "/v1/work-runs": {workRuns: [
    {runId: RUN, missionId: "msn_" + "ab".repeat(12), status: "RUNNING", startedAt: "2026-10-15T10:00:00.000Z", evidence: []},
    {runId: RUN2, missionId: "msn_" + "cd".repeat(12), status: "REVIEWING", startedAt: "2026-10-15T11:00:00.000Z", headSha: HEAD, evidence: fullEvidence()}
  ]},
  ...overrides
});
const fromFix = (fix: Record<string, any>) => (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); };

describe("UX WP-DELIVERY — real operational health + release readiness", () => {
  it("binds the health strip to the four real read-only sources and verifies them", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx(fromFix(liveFix()));
    const root = await delivery.render(ctx);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(root, k), k).toBe("VERIFIED");
    expect(byData(root, "health")!.textContent).toContain("HEALTHY");
    expect(byData(root, "control")!.textContent).toContain("Global Stop is not active");
    expect(byData(root, "attention")!.textContent).toContain("No Founder-attention items");
  });

  it("shows a run with test-execution evidence as PRODUCT_VERIFIED and one without as NOT_VERIFIED (never COMPLETE/PASS)", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx(fromFix(liveFix()));
    const root = await delivery.render(ctx);
    const rs = rows(root);
    expect(rs.length).toBe(2);
    const r1 = rs.find(r => r.dataset.deliveryRun === RUN)!, r2 = rs.find(r => r.dataset.deliveryRun === RUN2)!;
    expect(r1.dataset.product).toBe("NOT_VERIFIED");
    expect(pillsIn(r1)).toContain("NOT_VERIFIED");
    expect(r1.textContent).toContain("Tests not executed");
    expect(r2.dataset.product).toBe("PRODUCT_VERIFIED");
    expect(pillsIn(r2)).toContain("PRODUCT_VERIFIED");
    // no run row claims COMPLETE/PASS (the honest lead copy may mention them, but never a row)
    const table = all(root).find(n => n.tagName === "TABLE" && n.dataset.deliveryTable === "runs")!;
    expect(table.textContent).not.toMatch(/\bCOMPLETE\b|\bPASS\b/);
    // points to the real export bridge, does not export here
    expect(root.textContent).toContain("Project Studio > Delivery");
  });

  it("PQ-001: shows PRODUCT_VERIFIED only on the server's exact rule; every partial or failing evidence set stays NOT_VERIFIED", async () => {
    const delivery = await load("views", "delivery.js");
    const cases: Array<[string, any, string]> = [
      ["full evidence", {headSha: HEAD, evidence: fullEvidence()}, "PRODUCT_VERIFIED"],
      ["failing exit code", {headSha: HEAD, evidence: fullEvidence({verify: {exitCode: 1}})}, "NOT_VERIFIED"],
      ["non-head SHA", {headSha: HEAD, evidence: fullEvidence({verify: {commitSha: OTHER}, regression: {commitSha: OTHER}})}, "NOT_VERIFIED"],
      ["one suite only (VERIFY_TESTS)", {headSha: HEAD, evidence: [tev("VERIFY_TESTS"), surface()]}, "NOT_VERIFIED"],
      ["one suite only (REGRESSION_TESTS)", {headSha: HEAD, evidence: [tev("REGRESSION_TESTS"), surface()]}, "NOT_VERIFIED"],
      ["zero executed count", {headSha: HEAD, evidence: fullEvidence({surface: {executedTests: 0}})}, "NOT_VERIFIED"],
      ["unknown executed count", {headSha: HEAD, evidence: fullEvidence({surface: {executedTests: null}})}, "NOT_VERIFIED"],
      ["no sandbox attestation", {headSha: HEAD, evidence: fullEvidence({verify: {sandboxProviderId: undefined}})}, "NOT_VERIFIED"],
      ["no TEST_SURFACE", {headSha: HEAD, evidence: [tev("VERIFY_TESTS"), tev("REGRESSION_TESTS")]}, "NOT_VERIFIED"],
      ["blocked test surface", {headSha: HEAD, evidence: fullEvidence({surface: {functionalAcceptance: "BLOCKED"}})}, "NOT_VERIFIED"],
      ["test changes need independent verification", {headSha: HEAD, evidence: fullEvidence({surface: {modified: ["tests/a.test.ts"]}})}, "NOT_VERIFIED"],
      ["no head SHA on the run", {evidence: fullEvidence()}, "NOT_VERIFIED"],
      ["bare kind without any proof", {headSha: HEAD, evidence: [{kind: "VERIFY_TESTS"}]}, "NOT_VERIFIED"]
    ];
    const ids = cases.map((_, i) => "run_" + String(i + 1).padStart(2, "0").repeat(12));
    const runs = cases.map(([, c], i) => ({runId: ids[i], missionId: "msn_" + "ab".repeat(12), status: "REVIEWING", startedAt: "2026-10-15T10:00:00.000Z", ...c}));
    const {ctx} = await mkCtx(fromFix(liveFix({"/v1/work-runs": {workRuns: runs}})));
    const root = await delivery.render(ctx);
    for (const [i, [name, , want]] of cases.entries()) {
      const row = rows(root).find(r => r.dataset.deliveryRun === ids[i])!;
      expect(row.dataset.product, name).toBe(want);
      expect(pillsIn(row), name).toContain(want);
    }
  });

  it("shows production deploy as BLOCKED and live SRE as NOT_CONNECTED citing the Founder gates, with no fabricated metrics or working buttons", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx(fromFix(liveFix()));
    const root = await delivery.render(ctx);
    const deploy = all(root).find(n => n.id === "delivery-deploy")!, sre = all(root).find(n => n.id === "delivery-sre")!;
    expect(pillsIn(all(deploy).find(n => n.dataset.gate === "deploy"))).toEqual(["BLOCKED"]);
    expect(deploy.textContent).toContain("real-deploy authority");
    expect(pillsIn(all(sre).find(n => n.dataset.gate === "sre"))).toEqual(["NOT_CONNECTED"]);
    expect(sre.textContent).toContain("FD-REL-1");
    expect(sre.textContent).toContain("No uptime, SLO or incident metric");
    // no buttons anywhere (read-only view; deploy is never a working button)
    expect(all(root).filter(n => n.tagName === "BUTTON").length).toBe(0);
    // no invented percentage/uptime numbers
    expect(root.textContent).not.toMatch(/\d+(\.\d+)?\s?%/);
  });

  it("shows honest non-verified states and no run rows when the Control API is unreachable, while gates stay explicit", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx(() => { throw new Error("fetch failed"); });
    const root = await delivery.render(ctx);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(root, k), k).toBe("OFFLINE");
    expect(rows(root).length).toBe(0);
    expect(all(root).filter(n => n.tagName === "TABLE").length).toBe(0);
    // gates remain honest even with no backend
    expect(pillsIn(all(root).find(n => n.dataset.gate === "deploy"))).toEqual(["BLOCKED"]);
    expect(pillsIn(all(root).find(n => n.dataset.gate === "sre"))).toEqual(["NOT_CONNECTED"]);
    expect(root.textContent).not.toMatch(/\d+(\.\d+)?\s?%/);
  });

  it("surfaces an ACTIVE Global Stop with its reason (STOPPED), not a running state", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx(fromFix(liveFix({"/v1/control/status": {globalStop: {active: true, reason: "FOUNDER_HOLD"}}})));
    const root = await delivery.render(ctx);
    expect(sourceState(root, "control")).toBe("STOPPED");
    expect(byData(root, "control")!.textContent).toContain("FOUNDER_HOLD");
  });

  it("distinguishes OFFLINE / UNAVAILABLE / FAILED for the health signal", async () => {
    const delivery = await load("views", "delivery.js");
    const cases: Array<[string, Error, string]> = [
      ["offline", new Error("fetch failed"), "OFFLINE"],
      ["404", new Error("/health: HTTP 404"), "UNAVAILABLE"],
      ["500", new Error("/health: HTTP 500"), "FAILED"]
    ];
    for (const [name, err, want] of cases) {
      const {ctx} = await mkCtx((p) => { if (p === "/health") throw err; return liveFix()[p] ?? (() => { throw new Error("404"); })(); });
      const root = await delivery.render(ctx);
      expect(sourceState(root, "health"), name).toBe(want);
    }
  });
});

describe("UX WP-DELIVERY — routing + dictionary", () => {
  it("delivery route delegates to the real component with no plannedPackage, and planned.js hosts it", async () => {
    const routes = await load("routes.js");
    const r = routes.routeById("delivery");
    expect(r.view).toBe("planned");
    expect(r.component).toBe("delivery");
    expect("plannedPackage" in r).toBe(false);
    expect(read("views", "planned.js")).toContain('import * as delivery from "./delivery.js"');
  });

  it("every delivery.* key exists in both EN and TR with non-empty text", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = Object.keys(en).filter(k => k.startsWith("delivery."));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(typeof en[k], `en ${k}`).toBe("string");
      expect(en[k].length, `en ${k}`).toBeGreaterThan(0);
      expect(typeof tr[k], `tr ${k}`).toBe("string");
      expect(tr[k].length, `tr ${k}`).toBeGreaterThan(0);
    }
  });

  it("the view reads only allow-listed read-only GET paths (no writes, no company/project paths)", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx, calls} = await mkCtx(fromFix(liveFix()));
    await delivery.render(ctx);
    expect([...new Set(calls)].sort()).toEqual(["/health", "/v1/attention", "/v1/control/status", "/v1/work-runs"]);
  });
});

// //TR: Ek sertleştirme: 500/bozuk yanıt/boş koşu listesi hiçbir sahte "sağlıklı" ya da koşu üretmez; h1 odaklanabilir, düğme yoktur (kapılar sahte buton içermez), tablo caption + scope=col taşır; delivery.* anahtarları EN/TR'de birebir ve yer tutucular eşleşir.
describe("UX WP-DELIVERY — negative paths, accessibility and locale parity", () => {
  it("HTTP 500 on every source is FAILED (not UNAVAILABLE, not VERIFIED) with no rows and no health claim", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx((p: string) => { throw new Error(`${p}: HTTP 500`); });
    const root = await delivery.render(ctx);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(root, k), k).toBe("FAILED");
    expect(rows(root).length).toBe(0);
    expect(all(root).some(n => n.dataset.health === "VERIFIED" || n.dataset.product === "PRODUCT_VERIFIED")).toBe(false);
    expect(root.textContent).not.toContain("HEALTHY");
  });
  it("malformed payloads never render a verified health line, a running claim or run rows", async () => {
    const delivery = await load("views", "delivery.js");
    for (const bad of ["garbage", null, 5, [], {}]) {
      const {ctx} = await mkCtx(() => bad);
      const root = await delivery.render(ctx);
      const tag = JSON.stringify(bad);
      expect(rows(root).length, tag).toBe(0);
      expect(all(root).some(n => n.dataset.health === "VERIFIED"), tag).toBe(false);
      expect(all(root).some(n => n.dataset.product === "PRODUCT_VERIFIED"), tag).toBe(false);
      // Kapılar bozuk veride de dürüst kalır.
      expect(pillsIn(all(root).find(n => n.dataset.gate === "deploy")), tag).toEqual(["BLOCKED"]);
    }
  });
  it("an empty but verified run list shows the honest empty note (no table, no rows)", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx(fromFix(liveFix({"/v1/work-runs": {workRuns: []}})));
    const root = await delivery.render(ctx);
    expect(sourceState(root, "runs")).toBe("VERIFIED");
    expect(rows(root).length).toBe(0);
    expect(all(root).filter(n => n.tagName === "TABLE").length).toBe(0);
    expect(root.textContent).toContain(ctx.t("delivery.release.none"));
  });
  it("a run whose test evidence is not execution evidence is never PRODUCT_VERIFIED (TR and EN)", async () => {
    const delivery = await load("views", "delivery.js");
    for (const lang of ["en", "tr"]) {
      const fix = liveFix({"/v1/work-runs": {workRuns: [{runId: RUN, missionId: "msn_" + "ab".repeat(12), status: "COMPLETE", startedAt: "2026-10-15T10:00:00.000Z", evidence: [{kind: "IMPLEMENT"}, {kind: "SECURITY_REPORT"}]}]}});
      const {ctx} = await mkCtx(fromFix(fix), lang);
      const root = await delivery.render(ctx);
      const r = rows(root);
      expect(r.length, lang).toBe(1);
      expect(r[0].dataset.product, lang).toBe("NOT_VERIFIED");
    }
  });
  it("is accessible: single focusable h1, no buttons (gates are not fake actions), labelled source list, table caption and scope=col, in EN and TR", async () => {
    const delivery = await load("views", "delivery.js");
    for (const lang of ["en", "tr"]) {
      const {ctx} = await mkCtx(fromFix(liveFix()), lang);
      const root = await delivery.render(ctx);
      const h1 = all(root).filter(n => n.tagName === "H1");
      expect(h1.length, lang).toBe(1);
      expect(h1[0].getAttribute("tabindex"), lang).toBe("-1");
      expect(h1[0].id).toBe("view-title");
      expect(all(root).filter(n => n.tagName === "BUTTON").length, lang).toBe(0);
      const ul = all(root).find(n => n.tagName === "UL" && n.getAttribute("aria-label"))!;
      expect(ul.getAttribute("aria-label")!.length).toBeGreaterThan(0);
      const t = all(root).find(n => n.tagName === "TABLE")!;
      expect(t.children.some(c => c.tagName === "CAPTION" && c.textContent.length > 0), lang).toBe(true);
      for (const th of all(t).filter(n => n.tagName === "TH")) expect(th.getAttribute("scope"), lang).toBe("col");
      // Her panel başlığı bölümü etiketler.
      for (const s of all(root).filter(n => n.tagName === "SECTION")) expect(s.getAttribute("aria-labelledby"), s.id).toBe(`${s.id}-t`);
    }
  });
  it("delivery.* and area.delivery.* have identical key sets and {placeholders} in EN and TR", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>, tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const pick = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("delivery.") || k.startsWith("area.delivery.")).sort();
    expect(pick(tr)).toEqual(pick(en));
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of pick(en)) expect(ph(tr[k]), k).toBe(ph(en[k]));
    // Görünümün dinamik kullandığı durum anahtarları da iki dilde vardır.
    const src = read("views", "delivery.js");
    for (const m of src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"/g)) { expect(en[m[1]], m[1]).toBeTruthy(); expect(tr[m[1]], m[1]).toBeTruthy(); }
  });
});

// //TR: UASCO-RW-053 (Teslimat & SRE dilimi): görünüm sahte köprü yerine GERÇEK Control API (buildServer) yanıtlarıyla çizilir. Test köprüsü main.mjs "uasco:api-get" işleyicisini aynen
// taklit eder: masaüstü GET allow-list'i (control-boundary + main B4-ALLOWLIST bloğu), /health için challenge + controlProof kimlik doğrulaması ve sentezlenmiş gövde, diğer yollar için
// kontrol token'ı ve "<yol>: HTTP <kod>" hata biçimi. Mutlu yol + gerçek hata durumları (yanlış token -> 403 + kimlik doğrulanamaz; token yapılandırılmamış -> 503).
describe("UASCO-RW-053 — Delivery & SRE view over the REAL Control API (renderer -> real buildServer)", () => {
  const root = path.resolve(__dirname, "..");
  const mainSrc = fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
  const TOKEN = "t".repeat(32);
  let PORT = 3210;
  let tmp = "";
  const apps: Array<{close: () => Promise<unknown>}> = [];
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-dlv-")); });
  afterEach(async () => { PORT = 3210; for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
  const dataDir = () => path.join(tmp, "data"), runtimeDir = () => path.join(tmp, "runtime");
  function mkApp(controlToken = TOKEN) {
    fs.mkdirSync(runtimeDir(), {recursive: true});
    const app = buildServer({controlToken, runtime: runtimeDir(), repoRoot: tmp, dataDir: dataDir(), tenantId: "tA", port: PORT, logger: false});
    apps.push(app); return app;
  }
  async function allowList() {
    const m = /\/\/ B4-ALLOWLIST-BEGIN\n([\s\S]*?)\/\/ B4-ALLOWLIST-END/.exec(mainSrc);
    expect(m, "main.mjs B4-ALLOWLIST block").not.toBeNull();
    const extra = new Function(`${m![1]}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
    const boundary = await import(pathToFileURL(path.join(root, "automation", "lib", "control-boundary.mjs")).href);
    return {allowed: (p: string) => boundary.desktopGetPathAllowed(p) || extra(p), proof: boundary.controlChallengeProof as (t: string, c: string) => string | null};
  }
  /** main.mjs uasco:api-get + verifyServerIdentity + api() birebir: token'ı köprü bilir (renderer bilmez). */
  type Transport = (url: string, headers: Record<string, string>) => Promise<{statusCode: number; json: () => any}>;
  const injectT = (app: ReturnType<typeof buildServer>): Transport => async (url, headers) => app.inject({method: "GET", url, headers});
  // main.mjs ile aynı: gerçek HTTP fetch (sunucu kapalıysa gerçek "fetch failed" hatası -> OFFLINE)
  const httpT = (base: string): Transport => async (url, headers) => { const r = await fetch(base + url, {headers, redirect: "error", cache: "no-store"}); const body = await r.text(); return {statusCode: r.status, json: () => JSON.parse(body)}; };
  async function realBridge(app: ReturnType<typeof buildServer>, bridgeToken = TOKEN, transport: Transport = injectT(app)) {
    const {allowed, proof} = await allowList();
    const calls: string[] = [];
    const verify = async () => {
      const challenge = crypto.randomBytes(32).toString("hex"), expected = proof(bridgeToken, challenge);
      if (!expected) throw new Error("CONTROL_TOKEN_NOT_CONFIGURED");
      const r = await transport(`/health?challenge=${challenge}`, {host: `127.0.0.1:${PORT}`});
      if (r.statusCode !== 200) throw new Error(`health: HTTP ${r.statusCode}`);
      const h = r.json();
      if (h.status !== "HEALTHY" || h.system !== "UNIVERSAL-AI-SOFTWARE-COMPANY-OS" || h.bindHost !== "127.0.0.1" || Number(h.port) !== PORT || h.controlProof !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
    };
    const bridge = {apiGet: async (p: string) => {
      calls.push(p);
      if (!allowed(p)) throw new Error("INVALID_API_PATH");
      if (p === "/health") { await verify(); return {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"}; }
      if (!p.startsWith("/v1/")) throw new Error("CONTROL_API_PATH_INVALID");
      await verify();
      const r = await transport(p, {"x-uasco-control-token": bridgeToken, host: `127.0.0.1:${PORT}`});
      if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    }, apiPost: async (p: string) => { throw new Error(`POST must never be called (${p})`); }};
    return {bridge, calls, allowed};
  }
  async function renderReal(app: ReturnType<typeof buildServer>, bridgeToken = TOKEN, lang = "en", transport?: Transport) {
    const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), view = await load("views", "delivery.js");
    const {bridge, calls, allowed} = await realBridge(app, bridgeToken, transport);
    const doc = new D(), store = st.createStore(null);
    const api = apiMod.createApi({bridge, store, now: () => 1_760_000_000_000});
    const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
    const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: () => {}, principal: "FOUNDER_LOCAL", rerender: async () => {}};
    const rootNode: N = await view.render(ctx);
    return {root: rootNode, calls, allowed};
  }
  const READS = ["/health", "/v1/control/status", "/v1/attention", "/v1/work-runs"];
  let EN: Record<string, string> = {};
  beforeEach(async () => { EN = (await load("locales", "en.js")).default; });
  const i18nEn = (k: string) => { expect(EN[k], k).toBeTruthy(); return EN[k]; };
  const RECORDER = "FOUNDER_LOCAL";
  function seedRun() {
    const store = new WorkOsStore(dataDir()), tenantId = "tA", scope = {tenantId};
    const p = store.createProject({tenantId, orgId: "org1", name: "Delivery", environmentId: "env-dev", createdBy: RECORDER});
    const m = store.createMission({tenantId, projectId: p.projectId, title: "Ship it", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
    for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, m.missionId, to, "go", RECORDER);
    return store.createRun({tenantId, missionId: m.missionId, executor: {implementer: "IMPL", reviewer: "REV"}, createdBy: RECORDER});
  }

  it("happy path, empty factory: the four real sources verify; health is the identity-checked server; no runs means an honest empty note, never a fake row", async () => {
    const app = mkApp();
    const {root: r, calls, allowed} = await renderReal(app);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(r, k), k).toBe("VERIFIED");
    expect(byData(r, "health")!.textContent).toContain("HEALTHY · UNIVERSAL-AI-SOFTWARE-COMPANY-OS · VERIFIED");
    expect(byData(r, "control")!.dataset.control).toBe("RUNNING");
    expect(byData(r, "attention")!.dataset.attention).toBe("0");
    expect(rows(r)).toHaveLength(0);
    expect(r.textContent).toContain(i18nEn("delivery.release.none"));
    expect(all(r).find(n => n.dataset.gate === "deploy")!.dataset.gateState).toBe("BLOCKED");
    expect(all(r).find(n => n.dataset.gate === "sre")!.dataset.gateState).toBe("NOT_CONNECTED");
    // only the four allow-listed read-only GETs, each exactly once; every one is admitted by the real desktop allow-list
    expect([...calls].sort()).toEqual([...READS].sort());
    for (const p of calls) expect(allowed(p), p).toBe(true);
  });

  it("happy path with real records: a real queued run appears with its real status and NOT_VERIFIED product; a real Global Stop shows as STOPPED with its reason", async () => {
    const run = seedRun();
    const app = mkApp();
    const before = await renderReal(app);
    const row = rows(before.root).find(n => n.dataset.deliveryRun === run.runId);
    expect(row, "the real run is listed").toBeTruthy();
    expect(row!.dataset.product).toBe("NOT_VERIFIED");                     // no test execution evidence -> never PRODUCT_VERIFIED
    expect(pillsIn(row)).toContain("NOT_VERIFIED");
    expect(pillsIn(row)).not.toContain("PRODUCT_VERIFIED");
    expect(row!.textContent).toContain(run.runId);
    expect(rows(before.root)).toHaveLength(1);
    const stop = await app.inject({method: "POST", url: "/v1/control/stop", headers: {"x-uasco-control-token": TOKEN, host: `127.0.0.1:${PORT}`, "content-type": "application/json"}, payload: {reason: "maintenance window"}});
    expect(stop.statusCode).toBe(200);
    const after = await renderReal(app);
    expect(byData(after.root, "control")!.dataset.control).toBe("STOPPED");
    expect(sourceState(after.root, "control")).toBe("STOPPED");
    expect(byData(after.root, "control")!.textContent).toContain("maintenance window");
  });

  it("error: the bridge holds a wrong token -> the bridge's identity proof fails before any /v1 read (and the server itself would answer 403); nothing is shown as VERIFIED and no table is drawn", async () => {
    seedRun();
    const app = mkApp();
    // the server's own answer to the wrong token, asserted directly: the renderer never gets this far because the bridge stops at the identity check
    for (const url of ["/v1/control/status", "/v1/attention", "/v1/work-runs"]) {
      const direct = await app.inject({method: "GET", url, headers: {"x-uasco-control-token": "w".repeat(32), host: `127.0.0.1:${PORT}`}});
      expect(direct.statusCode, url).toBe(403);
    }
    const {root: r, calls} = await renderReal(app, "w".repeat(32));
    expect([...calls].sort()).toEqual([...READS].sort());                             // the view did try its four reads; each failed at the bridge identity check
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(r, k), k).toBe("FAILED");
    expect(byData(r, "health")!.dataset.health).toBe("FAILED");
    expect(byData(r, "health")!.textContent).not.toContain("HEALTHY");
    expect(rows(r)).toHaveLength(0);
    expect(pillsIn(r)).not.toContain("VERIFIED");
    expect(pillsIn(r)).not.toContain("PRODUCT_VERIFIED");
    // the gated panels never turn into something else because reads failed
    expect(all(r).find(n => n.dataset.gate === "deploy")!.dataset.gateState).toBe("BLOCKED");
    expect(all(r).find(n => n.dataset.gate === "sre")!.dataset.gateState).toBe("NOT_CONNECTED");
  });

  it("error: the server has no control token configured -> /v1 reads are a real 503 and the identity proof is absent; all sources FAILED (never VERIFIED, never 'none')", async () => {
    const app = mkApp("");
    const direct = await app.inject({method: "GET", url: "/v1/work-runs", headers: {"x-uasco-control-token": TOKEN, host: `127.0.0.1:${PORT}`}});
    expect(direct.statusCode).toBe(503);
    const {root: r} = await renderReal(app);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(r, k), k).toBe("FAILED");
    expect(r.textContent).not.toContain(i18nEn("delivery.release.none"));
    expect(byData(r, "attention")!.dataset.attention).not.toBe("0");
  });

  it("error: the Control API process goes away -> real HTTP fetch fails and every source is OFFLINE (distinct from FAILED); Turkish strings render too", async () => {
    seedRun();
    // like the packaged app: the server is built for, and listens on, the same loopback port (host check and identity proof bind to it)
    PORT = await new Promise<number>((res, rej) => { const srv = net.createServer(); srv.once("error", rej); srv.listen(0, "127.0.0.1", () => { const a = srv.address() as {port: number}; srv.close(() => res(a.port)); }); });
    const app = mkApp();
    await app.listen({port: PORT, host: "127.0.0.1"});
    const t = httpT(`http://127.0.0.1:${PORT}`);
    const up = await renderReal(app, TOKEN, "tr", t);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(up.root, k), k).toBe("VERIFIED");
    expect(rows(up.root)).toHaveLength(1);
    await app.close();
    const down = await renderReal(app, TOKEN, "tr", t);
    for (const k of ["health", "control", "attention", "runs"]) expect(sourceState(down.root, k), k).toBe("OFFLINE");
    expect(rows(down.root)).toHaveLength(0);
    expect(pillsIn(down.root)).not.toContain("VERIFIED");
  });

  it("the desktop allow-list rejects paths this view must never read (writes, other runs routes, retired attention), so the view cannot widen its reach", async () => {
    const {allowed} = await allowList();
    for (const p of READS) expect(allowed(p), p).toBe(true);
    for (const p of ["/v1/control/stop", "/v1/deploy", "/v1/sre", "/v1/work-runs/", "/v1/attention?x=1", "/health?challenge=1"]) expect(allowed(p), p).toBe(false);
    const src = read("views", "delivery.js");
    expect(src).not.toMatch(/\.post\(|apiPost|\bfetch\(|XMLHttpRequest|innerHTML|insertAdjacentHTML/);
  });
});
