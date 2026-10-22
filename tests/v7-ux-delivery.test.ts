// //TR: Bu test UX WP-DELIVERY Teslimat & SRE görünümünün (apps/desktop/renderer/views/delivery.js) dürüstlüğünü gerçek görünüm modülü + sahte DOM ile doğrular: operasyonel sağlık (GET /health, /v1/control/status, /v1/founder-attention) ve yayın hazırlığı (GET /v1/work-runs) yalnız gerçek, allow-list'li veriden okunur; test yürütme kanıtı yoksa koşu NOT_VERIFIED kalır, asla COMPLETE/PASS/VERIFIED gösterilmez; gerçek üretim deploy BLOCKED ve canlı SRE izleme NOT_CONNECTED olarak Founder kapısını anarak gösterilir (sahte buton veya uydurma uptime/SLO/metrik yok); veri yokken ayrık dürüst durumlar gösterilir; rota WP3 gibi planned.js üzerinden devreder; delivery.* sözlüğü EN/TR'de birebirdir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

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
  "/v1/founder-attention": {blocked: []},
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
    expect([...new Set(calls)].sort()).toEqual(["/health", "/v1/control/status", "/v1/founder-attention", "/v1/work-runs"]);
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
