// //TR: Bu test V7-PKG-M1A-MODE (cycle 2: D-M1A-STATE-MODEL-2026-10-15 + D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15) masaüstü yüzeylerini gerçek görünüm modülleri + sahte DOM ile doğrular: koşu/görev/teslim/export yüzeylerinde "Testler çalıştırılmadı — NOT_VERIFIED (sandbox doğrulanmadı)" rozeti yalnız test yürütme kanıtı yoksa görünür (sahte veri yok), Ayarlar "Sandbox: UNAVAILABLE — M1a modu" ve ayrı UASCO profillerinin giriş gerekli durumunu gösterir, COMPLETE akışı NOT_EXECUTED beyanını ve değişen test/harness listesini gösterir, her onay için ayrı kutu ister (işaretsizse istek gönderilmez) ve kesin onay nesnelerini gönderir; klavye odağı hiçbir adımda BODY'ye düşmez (focus.js settleFocus).
import {describe, it, expect, beforeEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(...p)).href);
const read = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8");

// ---------- Sahte DOM (B5 biçimi + settleFocus için öznitelik seçicisi) ----------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; open = false; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get isConnected() { return this.doc.body.contains(this); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; if (node.parent) node.parent.children = node.parent.children.filter(x => x !== node); node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  removeEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, (this.ls.get(ev) ?? []).filter(x => x !== fn)); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
  focus() { if (this.tagName !== "#TEXT" && this.isConnected) this.doc.focused = this; }
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  // yalnız "[a],[b]" biçimli öznitelik seçicileri (focus.js'in kullandığı)
  querySelectorAll(sel: string): N[] {
    const keys = sel.split(",").map(s => s.trim().replace(/^\[|\]$/g, ""));
    const has = (n: N, k: string) => k.startsWith("data-") ? k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()) in n.dataset : n.attrs.has(k);
    return all(this).filter(n => keys.some(k => has(n, k)));
  }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  get documentElement() { return this.body; }
  createElement(t: string) { return new N(this, t); }
  // //TR: UX WP-WORKOS: Görev yüzeyi de WP2 kpiTile/statePill/missionPill (SVG ikon) bileşenlerini kullandığından sahte DOM, gerçek document gibi createElementNS sağlar (b5/WP2/WP3/WP4 harness'leriyle aynı); doğrulama gevşetilmez.
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  get activeElement(): N { return this.focused && this.body.contains(this.focused) ? this.focused : this.body; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const byData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));

const MID = "msn_" + "ab12".repeat(6), PID = "prj_" + "cd34".repeat(6), RUN = "run_" + "ef56".repeat(6), RUN2 = "run_" + "0a0b".repeat(6);
const HEAD = "1".repeat(40), TSSHA = "2".repeat(64);
const BADGE_TR = "Testler çalıştırılmadı — NOT_VERIFIED (sandbox doğrulanmadı)", BADGE_EN = "Tests not executed — NOT_VERIFIED (sandbox not verified)";
const ev = (kind: string, i: number) => ({evidenceId: `evd_${String(i).padStart(12, "0")}`, step: "VERIFY", cycle: 0, kind});
const m1aRun = (extra: any = {}) => ({runId: RUN, missionId: MID, projectId: PID, status: "AWAITING_APPROVAL", step: "REPORT", headSha: HEAD, executor: {implementer: "I", reviewer: "R"}, checkpoints: [],
  evidence: [ev("IMPLEMENT", 1), ev("VERIFY_TESTS_NOT_EXECUTED", 2), ev("TEST_SURFACE", 3), ev("SECURITY_REPORT", 4), ev("REVIEW", 5), ev("REGRESSION_TESTS_NOT_EXECUTED", 6), ev("REPORT", 7)], ...extra});
const execRun = () => m1aRun({runId: RUN2, status: "SUCCEEDED", evidence: [ev("IMPLEMENT", 1), ev("VERIFY_TESTS", 2), ev("REGRESSION_TESTS", 3), ev("REPORT", 4)]});
const reqs = (tc = false) => ({headSha: HEAD, functionalAcceptance: "NOT_EXECUTED", notExecuted: {required: true, reason: "SANDBOX_UNAVAILABLE"},
  testChanges: {required: tc, testSurfaceSha256: TSSHA, changed: {modified: tc ? ["tests/a.test.mjs"] : [], deleted: [], renamed: [], harness: tc ? ["vitest.config.ts"] : [], truncated: false}}});
const mission = (extra: any = {}) => ({missionId: MID, projectId: PID, title: "Görev A", objective: "Hedef", acceptanceCriteria: ["k1"], riskLevel: "R1", status: "REPORTING", createdAt: "2026-10-15T09:00:00.000Z", ...extra});

interface Opts {get: Record<string, any>; post?: (p: string, b: any) => {status: number; body: any}; confirm?: boolean; lang?: string}
async function mkCtx(o: Opts) {
  const apiMod = await load(rend, "api.js"), st = await load(rend, "state.js"), i18n = await load(rend, "i18n.js"), focus = await load(rend, "focus.js");
  const doc = new D(), store = st.createStore(null), lang = o.lang ?? "tr";
  const calls = {post: [] as Array<{path: string; body: any}>, confirm: [] as any[]};
  const bridge = {
    apiGet: async (p: string) => { const r = o.get[p]; if (r === undefined) throw new Error(`${p}: HTTP 404`); return typeof r === "function" ? r() : r; },
    apiPost: async (p: string, b: any) => { calls.post.push({path: p, body: b}); const r = o.post?.(p, b); if (!r) throw new Error("CONTROL_API_UNREACHABLE"); return r; }
  };
  const api = apiMod.createApi({bridge, store});
  let view: any = null;
  const ctx: any = {doc, store, api, i18n: {lang, t: (k: string, v?: any) => i18n.translate(lang, k, v)}, t: (k: string, v?: any) => i18n.translate(lang, k, v),
    navigate() {}, refreshAll: async () => { await ctx.rerender(); }, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL",
    confirm: async (opts: any) => { calls.confirm.push(opts); return o.confirm === true; },
    // gerçek uygulama gibi: yeniden çizim görünümü yeniden kurar (odaklı düğüm DOM'dan çıkar)
    rerender: async () => { store.cache.clear(); if (view) doc.body.replaceChildren(await view.render(ctx)); },
    settleFocus: (opts: any) => focus.settleFocus(doc, doc.body, opts)};
  const show = async (v: any) => { view = v; doc.body.replaceChildren(await v.render(ctx)); return doc.body; };
  return {ctx, doc, calls, show};
}
let forms: any;
beforeEach(async () => { forms = await load(rend, "forms.js"); forms.resetAllForms(); });

describe("M1a NOT_VERIFIED badge (evidence-derived, no fake data)", () => {
  it("run card shows the badge when no test-execution evidence exists and not when VERIFY/REGRESSION tests executed", async () => {
    const core = await load(rend, "work-core.js"), work = await load(rend, "views", "work.js");
    const {ctx} = await mkCtx({get: {}});
    const notRun = core.mapWorkRun(m1aRun()), executed = core.mapWorkRun(execRun());
    expect(notRun).toMatchObject({testsExecuted: false, testsNotExecuted: true, headSha: HEAD});
    expect(executed).toMatchObject({testsExecuted: true, testsNotExecuted: false});
    const a = work.runCard(ctx, notRun), b = work.runCard(ctx, executed);
    expect(byData(a, "m1aBadge", "run").map(n => n.textContent)).toEqual([BADGE_TR]);
    expect(byData(b, "m1aBadge")).toHaveLength(0);
    // a run blocked before any test step (e.g. IMPLEMENT CLAUDE_PROFILE_LOGIN_REQUIRED) is also NOT_VERIFIED
    expect(byData(work.runCard(ctx, core.mapWorkRun({runId: RUN, status: "BLOCKED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", evidence: [ev("IMPLEMENT", 1)], checkpoints: []})), "m1aBadge")).toHaveLength(1);
  });

  it("mission list, mission detail, run timeline, inbox delivery decision and Studio exports show the badge (English too)", async () => {
    const work = await load(rend, "views", "work.js"), inbox = await load(rend, "views", "inbox.js"), wsp = await load(rend, "views", "studio-workspace.js");
    forms.selection.missionId = MID;
    const get = {"/v1/missions": {missions: [mission()]}, "/v1/projects": {projects: [{projectId: PID, name: "App"}]}, "/v1/work-runs": {runs: [m1aRun()]}, [`/v1/work-runs?missionId=${MID}`]: {runs: [m1aRun()]},
      [`/v1/missions/${MID}`]: {mission: mission(), tasks: []}, [`/v1/work-runs/${RUN}`]: {run: m1aRun(), outcomes: {functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED"}, completionRequirements: reqs()},
      "/v1/founder-attention": {blocked: []}};
    for (const [lang, label] of [["tr", BADGE_TR], ["en", BADGE_EN]] as const) {
      forms.resetAllForms(); forms.selection.missionId = MID;
      const {show} = await mkCtx({get, lang});
      const w = await show(work);
      expect(byData(w, "m1aBadge", "mission").length).toBeGreaterThanOrEqual(2); // list row + detail header
      expect(byData(w, "m1aBadge", "run")).toHaveLength(1);
      for (const n of byData(w, "m1aBadge")) expect(n.textContent).toBe(label);
      const i = await show(inbox);
      expect(byData(i, "m1aBadge", "delivery").map(n => n.textContent)).toEqual([label]);
    }
    const core = await load(rend, "project-core.js");
    const ex = core.mapExports({exports: [{exportId: "exp_" + "1".repeat(24), createdAt: "2026-10-15T00:00:00Z", commit: HEAD, size: 10, verification: {label: "NOT_VERIFIED (M1a: tests not executed)", testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE"}},
      {exportId: "exp_" + "2".repeat(24), createdAt: "2026-10-14T00:00:00Z", commit: HEAD, size: 10}, {exportId: "exp_" + "3".repeat(24), createdAt: "2026-10-13T00:00:00Z", commit: HEAD, size: 10, verification: {label: "NOT_VERIFIED", testsExecuted: true}}]});
    expect(ex.items.map((x: any) => x.verification?.testsExecuted ?? null)).toEqual([false, null, true]);
    expect(typeof wsp.renderWorkspace).toBe("function");
  });
});

describe("M1a Settings sandbox state", () => {
  it("shows 'Sandbox: UNAVAILABLE — M1a modu' and both UASCO profiles LOGIN_REQUIRED with their own login commands", async () => {
    const settings = await load(rend, "views", "settings.js");
    const cmd = (r: string) => `$env:CLAUDE_CONFIG_DIR='C:\\Users\\u\\AppData\\Roaming\\UASCO\\claude-profiles\\${r}'; claude`;
    const {show} = await mkCtx({get: {"/v1/system/executors": {executors: [{id: "LOCAL_CLAUDE", state: "READY"}], active: {reason: "LOCAL_CLAUDE"}, sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null},
      claudeProfiles: {implementer: {role: "implementer", state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: cmd("implementer")}, reviewer: {role: "reviewer", state: "LOGIN_REQUIRED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", loginCommand: cmd("reviewer")}}}}});
    const s = await show(settings);
    const sb = byId(s, "settings-sandbox")!;
    expect(sb.dataset.sandboxState).toBe("UNAVAILABLE");
    expect(sb.textContent).toContain("Sandbox: UNAVAILABLE — M1a modu");
    expect(sb.textContent).toContain("bu bilgisayarda asla çalıştırılmaz");
    expect(byData(s, "profile").map(n => [n.dataset.profile, n.dataset.state])).toEqual([["implementer", "LOGIN_REQUIRED"], ["reviewer", "LOGIN_REQUIRED"]]);
    expect(byData(s, "loginCommand").map(n => n.textContent)).toEqual([cmd("implementer"), cmd("reviewer")]);
  });
  it("never invents AVAILABLE: missing or malformed sandbox data shows 'unknown'", async () => {
    const core = await load(rend, "project-core.js");
    expect(core.mapSandbox(undefined)).toBeNull();
    expect(core.mapSandbox({state: "available"})).toBeNull();
    expect(core.mapExecutors({executors: [], sandbox: {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null}}).sandbox).toEqual({state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: "NO_VERIFIED_PROVIDER", providerId: null});
    const settings = await load(rend, "views", "settings.js");
    const {show} = await mkCtx({get: {"/v1/system/executors": {executors: []}}});
    expect(byId(await show(settings), "settings-sandbox")!.dataset.sandboxState).toBe("UNKNOWN");
  });
});

// ---------- M1a c2 (D-M1A-STATE-MODEL-2026-10-15 + D-M1A-ACCEPTANCE-CONDITIONS-2026-10-15) ----------
const SG = "SOURCE_GENERATION_COMPLETE — Kaynak kod üretildi", NV = "NOT_VERIFIED — Ürün doğrulanmadı (testler çalıştırılmadı: sandbox yok)", ACC = "Kaynak teslimi kabul edildi — ürün DOĞRULANMADI";
const H1 = "a".repeat(64), H2 = "b".repeat(64), TREE = "3".repeat(40);
const deliveryOf = (o: any = {}) => ({runId: RUN, missionId: MID, projectId: PID, status: "AWAITING_APPROVAL", sourceCommit: HEAD,
  sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", reason: "SOURCE_EVIDENCE_FOR_HEAD", label: SG}, productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: NV}, testsExecuted: false,
  artifact: {runId: RUN, missionId: MID, sourceCommit: HEAD, treeSha: TREE, exportArtifactHash: H1, artifactPath: `deliveries/${RUN}/${H1}.zip`}, accepted: null, fileState: "VERIFIED",
  testChanges: {required: false, testSurfaceSha256: TSSHA, changed: {modified: [], deleted: [], renamed: [], harness: [], truncated: false}}, labels: {sourceGeneration: SG, productVerification: NV, sourceDelivery: null}, ...o});
const tcChanged = {required: true, testSurfaceSha256: TSSHA, changed: {modified: ["tests/a.test.mjs"], deleted: [], renamed: [], harness: ["vitest.config.ts"], truncated: false}};
const blockedDelivery = () => deliveryOf({runId: RUN2, status: "BLOCKED", sourceCommit: null, artifact: null, fileState: null, sourceGeneration: {state: "BLOCKED", reason: "CLAUDE_PROFILE_LOGIN_REQUIRED", label: "BLOCKED — Kaynak kod üretimi engellendi"},
  productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:NO_HEAD_COMMIT", label: "NOT_VERIFIED — Ürün doğrulanmadı"}});
const runDetail = (pv: "NOT_VERIFIED" | "PRODUCT_VERIFIED") => ({run: m1aRun(), outcomes: {functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED"},
  delivery: deliveryOf(pv === "PRODUCT_VERIFIED" ? {productVerification: {state: "PRODUCT_VERIFIED", reason: "TESTS_EXECUTED_IN_VERIFIED_SANDBOX", label: "PRODUCT_VERIFIED — Ürün doğrulandı (testler doğrulanmış sandbox içinde çalıştı ve geçti)"}, testsExecuted: true} : {})});
const tick = async (n = 6, until?: () => boolean) => { for (let i = 0; i < n && !(until?.()); i++) await new Promise(r => setTimeout(r, 0)); };

describe("M1a c2 COMPLETE is never offered for an unverified product (no acknowledgement path)", () => {
  const get = (pv: "NOT_VERIFIED" | "PRODUCT_VERIFIED") => ({"/v1/missions": {missions: [mission()]}, "/v1/projects": {projects: []}, "/v1/work-runs": {runs: [m1aRun()]}, [`/v1/work-runs?missionId=${MID}`]: {runs: [m1aRun()]},
    [`/v1/missions/${MID}`]: {mission: mission(), tasks: []}, [`/v1/work-runs/${RUN}`]: runDetail(pv), "/v1/founder-attention": {blocked: []}});
  it("mission detail and inbox: NOT_VERIFIED run -> no COMPLETE button, an honest note with both axis labels; PRODUCT_VERIFIED run -> COMPLETE is offered and posts no acknowledgement", async () => {
    const work = await load(rend, "views", "work.js"), inbox = await load(rend, "views", "inbox.js");
    forms.selection.missionId = MID;
    const {show} = await mkCtx({get: get("NOT_VERIFIED")});
    const w = await show(work);
    expect(byId(w, "tr-COMPLETE")).toBeNull();
    expect(byId(w, "tr-BLOCKED")).not.toBeNull();
    const na = byId(w, `complete-na-${MID}`)!;
    expect(na.dataset.completeOffered).toBe("false");
    expect(na.textContent).toContain(SG);
    expect(na.textContent).toContain(NV);
    expect(na.textContent).toContain("COMPLETE mümkün değildir");
    expect(byData(w, "ack")).toHaveLength(0);
    const i = await show(inbox);
    expect(byId(i, `ib-COMPLETE-${MID}`)).toBeNull();
    expect(byData(i, "action", "accept")).toHaveLength(0);
    expect(byId(i, `ib-complete-na-${MID}`)).not.toBeNull();
    expect(byId(i, `ib-BLOCKED-${MID}`)).not.toBeNull();
    // with sandbox-verified tests the button exists; its POST body never carries an acknowledgement
    forms.resetAllForms(); forms.selection.missionId = MID;
    const v = await mkCtx({get: get("PRODUCT_VERIFIED"), confirm: true, post: () => ({status: 200, body: {mission: {}}})});
    const w2 = await v.show(work);
    expect(byId(w2, `complete-na-${MID}`)).toBeNull();
    byId(w2, "tr-COMPLETE")!.fire("click");
    await tick(6, () => v.calls.post.length > 0);
    expect(v.calls.post).toEqual([{path: `/v1/missions/${MID}/transition`, body: {to: "COMPLETE", reason: "REPORTING -> COMPLETE (UASCO Desktop)"}}]);
  });
  it("request builder refuses any acknowledgement on a transition; mapping never invents PRODUCT_VERIFIED; refusals are explicit", async () => {
    const core = await load(rend, "work-core.js"), dc = await load(rend, "delivery-core.js");
    expect(core.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "COMPLETE", reason: "x", confirmed: true, acknowledgements: {notExecuted: {acknowledgeNotExecuted: true, headSha: HEAD}}})).toMatchObject({ok: false, errors: {acknowledgement: "err.ackNotForTransition"}});
    expect(core.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "COMPLETE", reason: "x", confirmed: true})).toMatchObject({ok: true, body: {to: "COMPLETE", reason: "x"}});
    expect(core.mapWorkRunDetail({run: m1aRun(), delivery: {productVerification: {state: "VERIFIED"}}}).run.productVerification).toBeNull();
    expect(dc.canOfferComplete({productVerification: null})).toBe(false);
    expect(dc.canOfferComplete(core.mapWorkRunDetail(runDetail("NOT_VERIFIED")).run)).toBe(false);
    expect(dc.canOfferComplete(core.mapWorkRunDetail(runDetail("PRODUCT_VERIFIED")).run)).toBe(true);
    for (const reason of ["COMPLETION_PRODUCT_NOT_VERIFIED", "DELIVERY_ACCEPTANCE_MISMATCH", "DELIVERY_ALREADY_ACCEPTED", "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"])
      expect(core.describePostResult({status: 409, body: {error: "WORKOS_CONFLICT", reason}}).key).toBe(`post.err.409.${reason}`);
    for (const error of ["NO_GENERATED_SOURCE", "SOURCE_GENERATION_NOT_COMPLETE", "DELIVERY_ARTIFACT_HASH_MISMATCH"])
      expect(core.describePostResult({status: 409, body: {error}}).key).toBe(`post.err.409.${error}`);
  });
});

describe("M1a c2 Studio > Delivery: run deliveries (prepare, bound acceptance dialog, hash-verified export)", () => {
  const listOf = (...ds: any[]) => ({deliveries: ds});
  async function panelCtx(o: {deliveries: () => any; post?: (p: string, b: any) => {status: number; body: any}; confirm?: boolean; native?: any}) {
    const dp = await load(rend, "views", "delivery-panel.js");
    const m = await mkCtx({get: {[`/v1/deliveries?projectId=${PID}`]: () => o.deliveries()}, post: o.post, confirm: o.confirm});
    m.ctx.native = o.native;
    const view = {render: async (c: any) => dp.runDeliveriesPanel(c, await c.api.deliveries(PID))};
    const root = await m.show(view);
    return {...m, dp, root};
  }
  it("lists SOURCE_GENERATION_COMPLETE runs with runId, sourceCommit and the artifact hash; other runs only with their axis labels; the project export is labelled NO_RUN/NOT_VERIFIED", async () => {
    const {root} = await panelCtx({deliveries: () => listOf(deliveryOf(), blockedDelivery())});
    const card = byData(root, "deliveryRun", RUN)[0];
    expect(card.dataset.deliveryState).toBe("PREPARED");
    for (const s of [RUN, MID, HEAD, H1, SG, NV]) expect(card.textContent).toContain(s);
    expect(byId(root, `dl-prep-${RUN}`)).not.toBeNull();
    expect(byId(root, `dl-open-${RUN}`)).not.toBeNull();
    expect(byId(root, `dl-export-${RUN}`)).toBeNull(); // export only after the acceptance
    expect(byData(root, "deliveryRun", RUN2)).toHaveLength(0);
    const other = byData(root, "otherRun", RUN2)[0];
    expect(other.textContent).toContain("BLOCKED — Kaynak kod üretimi engellendi");
    expect(other.textContent).toContain("NOT_VERIFIED — Ürün doğrulanmadı");
    expect(all(other).some(n => n.tagName === "BUTTON")).toBe(false);
    expect(root.textContent).not.toMatch(/PRODUCT_VERIFIED —|\bPASS(ED)?\b|\bworks\b/);
    const none = await panelCtx({deliveries: () => listOf(blockedDelivery())});
    expect(none.root.textContent).toContain("SOURCE_GENERATION_COMPLETE durumunda koşu yok");
    const tr = (await load(rend, "locales", "tr.js")).default;
    expect(tr["studio.export.title"]).toContain("NO_RUN/NOT_VERIFIED");
    expect(tr["m1a.export.noRun"]).toContain("NO_RUN/NOT_VERIFIED");
    expect(read(rend, "views", "studio-workspace.js")).toContain("runDeliveriesPanel(ctx,deliveries)");
  });
  it("prepare posts an empty body to the run's prepare route; a 409 NO_GENERATED_SOURCE is shown explicitly; focus never drops to BODY", async () => {
    const {root, doc, calls} = await panelCtx({deliveries: () => listOf(deliveryOf({artifact: null, fileState: null})), post: () => ({status: 409, body: {error: "NO_GENERATED_SOURCE"}})});
    byId(root, `dl-prep-${RUN}`)!.fire("click");
    await tick(8, () => calls.post.length > 0);
    await tick();
    expect(calls.post).toEqual([{path: `/v1/work-runs/${RUN}/delivery/prepare`, body: {}}]);
    expect(byId(doc.body, `dl-${RUN}-status`)!.textContent).toContain("NO_GENERATED_SOURCE");
    expect(doc.activeElement).not.toBe(doc.body);
  });
  it("acceptance dialog: shows runId, mission, commit, artifact hash, the not-executed statement and changed tests with one checkbox per acknowledgement; unticked boxes send nothing; ticked boxes send exactly the bound object", async () => {
    const {root, doc, calls} = await panelCtx({deliveries: () => listOf(deliveryOf({testChanges: tcChanged})), confirm: true, post: () => ({status: 200, body: {}})});
    byId(root, `dl-open-${RUN}`)!.fire("click");
    await tick();
    const dlg = byId(doc.body, `dl-dialog-${RUN}`)!;
    for (const s of [RUN, MID, HEAD, H1, NV, "ÇALIŞTIRILMADI", "tests/a.test.mjs", "vitest.config.ts"]) expect(dlg.textContent).toContain(s);
    expect(byData(dlg, "ack").map(n => n.dataset.ack)).toEqual(["notExecuted", "testChanges"]);
    expect(doc.activeElement).not.toBe(doc.body);
    // 1) nothing ticked
    byId(doc.body, `dl-accept-${RUN}`)!.fire("click");
    await tick();
    expect(calls.post).toHaveLength(0);
    expect(byId(doc.body, `dl-${RUN}-status`)!.textContent).toContain("testlerin çalıştırılmadığını (NOT_VERIFIED) onaylayan kutuyu işaretleyin");
    expect(doc.activeElement).not.toBe(doc.body);
    // 2) only the NOT_EXECUTED box
    byId(doc.body, `ack-ne-${RUN}`)!.fire("change", {target: {checked: true}});
    byId(doc.body, `dl-accept-${RUN}`)!.fire("click");
    await tick();
    expect(calls.post).toHaveLength(0);
    expect(byId(doc.body, `dl-${RUN}-status`)!.textContent).toContain("değişen testleri / harness'ı onaylayan kutuyu işaretleyin");
    // 3) both: confirm dialog names the run, commit and artifact; the POST carries exactly the bound acceptance
    byId(doc.body, `ack-tc-${RUN}`)!.fire("change", {target: {checked: true}});
    byId(doc.body, `dl-accept-${RUN}`)!.fire("click");
    await tick(10, () => calls.post.length > 0);
    expect(calls.confirm.at(-1).target).toBe(`${RUN} · ${HEAD} · ${H1}`);
    expect(calls.confirm.at(-1).body).toContain(ACC);
    expect(calls.post).toEqual([{path: `/v1/work-runs/${RUN}/delivery/accept`, body: {acceptance: {runId: RUN, missionId: MID, sourceCommit: HEAD, exportArtifactHash: H1, acknowledgeNotExecuted: true,
      testChangesAcknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: TSSHA}}}}]);
    await tick();
    expect(doc.activeElement).not.toBe(doc.body);
  });
  it("RV-M1A-C1-OBS-1: ticks are keyed by runId + missionId + sourceCommit + exportArtifactHash (+ testSurfaceSha256) and reset when any of them changes", async () => {
    let current = deliveryOf();
    const {root, doc, calls, ctx} = await panelCtx({deliveries: () => listOf(current), confirm: true, post: () => ({status: 200, body: {}})});
    const m1a = await load(rend, "m1a.js"), dc = await load(rend, "delivery-core.js");
    byId(root, `dl-open-${RUN}`)!.fire("click");
    await tick();
    byId(doc.body, `ack-ne-${RUN}`)!.fire("change", {target: {checked: true}});
    expect(m1a.deliveryAckState(dc.mapDelivery(current)).notExecuted).toBe(true);
    // a re-prepared/different artifact (new hash) for the same run: the old tick must not carry over
    for (const next of [deliveryOf({artifact: {...deliveryOf().artifact, exportArtifactHash: H2, artifactPath: `deliveries/${RUN}/${H2}.zip`}}), deliveryOf({sourceCommit: "4".repeat(40), artifact: {...deliveryOf().artifact, sourceCommit: "4".repeat(40)}}),
      deliveryOf({testChanges: {...tcChanged, testSurfaceSha256: "5".repeat(64)}})]) {
      byId(doc.body, `ack-ne-${RUN}`)!.fire("change", {target: {checked: true}});
      current = next;
      await ctx.rerender();
      const box = byId(doc.body, `ack-ne-${RUN}`)!;
      expect(box.attrs.has("checked")).toBe(false);
      expect(m1a.deliveryAckState(dc.mapDelivery(current)).notExecuted).toBe(false);
      byId(doc.body, `dl-accept-${RUN}`)!.fire("click");
      await tick();
      expect(calls.post).toHaveLength(0);
    }
    // a stale checks object (key of another artifact) is refused by the builder itself
    const d = dc.mapDelivery(deliveryOf());
    expect(dc.buildAcceptanceRequest(d, {key: dc.deliveryAckKey(dc.mapDelivery(deliveryOf({artifact: {...deliveryOf().artifact, exportArtifactHash: H2}}))), notExecuted: true})).toMatchObject({ok: false, errors: {acknowledgement: "err.ackStale"}});
    expect(dc.buildAcceptanceRequest(d, {key: dc.deliveryAckKey(d), notExecuted: true})).toEqual({ok: true, path: `/v1/work-runs/${RUN}/delivery/accept`, body: {acceptance: {runId: RUN, missionId: MID, sourceCommit: HEAD, exportArtifactHash: H1, acknowledgeNotExecuted: true}}});
    expect(dc.buildAcceptanceRequest({...d, artifact: null}, {key: dc.deliveryAckKey({...d, artifact: null}), notExecuted: true})).toMatchObject({ok: false, errors: {acknowledgement: "err.deliveryNotPrepared"}});
    expect(dc.mapDelivery({...deliveryOf(), sourceGeneration: {state: "COMPLETE"}})).toBeNull();
    expect(dc.mapDelivery({...deliveryOf(), runId: "run_x"})).toBeNull();
  });
  it("UI-182: deliverySourceState classifies NOT_PREPARED / VALID / STALE / UNKNOWN from data already read; buildAcceptanceRequest returns err.deliveryStale only for STALE", async () => {
    const dc = await load(rend, "delivery-core.js");
    const HEAD2 = "4".repeat(40);
    const d = dc.mapDelivery(deliveryOf());
    expect(dc.deliverySourceState({...d, artifact: null})).toBe("NOT_PREPARED");
    expect(dc.deliverySourceState(d)).toBe("VALID");
    expect(dc.deliverySourceState({...d, sourceCommit: HEAD2})).toBe("STALE");
    expect(dc.deliverySourceState({...d, sourceCommit: null})).toBe("UNKNOWN");
    expect(dc.deliverySourceState({...d, sourceCommit: "zz"})).toBe("UNKNOWN");
    const stale = {...d, sourceCommit: HEAD2};
    expect(dc.buildAcceptanceRequest(stale, {key: dc.deliveryAckKey(stale), notExecuted: true})).toEqual({ok: false, errors: {acknowledgement: "err.deliveryStale"}});
    expect(dc.buildAcceptanceRequest({...d, artifact: null}, null)).toMatchObject({errors: {acknowledgement: "err.deliveryNotPrepared"}});
    expect(dc.buildPrepareRequest(d)).toEqual({ok: true, path: `/v1/work-runs/${RUN}/delivery/prepare`, body: {}});
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    for (const k of Object.keys(en).filter(k => k.startsWith("m1a.delivery.src") || k === "err.deliveryStale")) {
      expect(typeof tr[k], k).toBe("string");
      expect((en[k].match(/\{\w+\}/g) ?? []).sort(), k).toEqual((tr[k].match(/\{\w+\}/g) ?? []).sort());
    }
  });
  it("UI-182: the card carries data-source-state with a role=note; STALE/UNKNOWN hide the open-accept button, keep prepare, VALID claims no verification; an earlier-commit acceptance is a read-only note", async () => {
    const HEAD2 = "4".repeat(40);
    const valid = await panelCtx({deliveries: () => listOf(deliveryOf())});
    const vc = byData(valid.root, "deliveryRun", RUN)[0];
    expect(vc.dataset.sourceState).toBe("VALID");
    const vn = all(vc).find(n => n.attrs.get("role") === "note")!;
    expect(vn.textContent).toContain("güncel koşu head");
    expect(vn.textContent).not.toMatch(/PRODUCT_VERIFIED|COMPLETE|PASS/);
    expect(byId(valid.root, `dl-open-${RUN}`)).not.toBeNull();
    const stale = await panelCtx({deliveries: () => listOf(deliveryOf({sourceCommit: HEAD2}))});
    const sc = byData(stale.root, "deliveryRun", RUN)[0];
    expect(sc.dataset.sourceState).toBe("STALE");
    const sn = all(sc).find(n => n.attrs.get("role") === "note")!;
    expect(sn.textContent).toContain(HEAD);
    expect(sn.textContent).toContain(HEAD2);
    expect(sn.textContent).toContain("yeniden hazırlayın");
    expect(byId(stale.root, `dl-open-${RUN}`)).toBeNull();
    expect(byId(stale.root, `dl-prep-${RUN}`)!.attrs.has("disabled")).toBe(false);
    const unk = await panelCtx({deliveries: () => listOf(deliveryOf({sourceCommit: null}))});
    const uc = byData(unk.root, "deliveryRun", RUN)[0];
    expect(uc.dataset.sourceState).toBe("UNKNOWN");
    expect(all(uc).find(n => n.attrs.get("role") === "note")!.textContent).toContain("okunamıyor");
    expect(byId(unk.root, `dl-open-${RUN}`)).toBeNull();
    const acc = await panelCtx({deliveries: () => listOf(deliveryOf({sourceCommit: HEAD2, accepted: {runId: RUN, missionId: MID, sourceCommit: HEAD, exportArtifactHash: H1, acceptedAt: "2026-10-15T10:00:00.000Z", acknowledgements: {}}}))});
    expect(byData(acc.root, "sourceAcceptedEarlier", "true")).toHaveLength(1);
    expect(byId(acc.root, `dl-open-${RUN}`)).toBeNull();
    const none = await panelCtx({deliveries: () => ({deliveries: [deliveryOf({artifact: null})]})});
    expect(byData(none.root, "deliveryRun", RUN)[0].dataset.sourceState).toBe("NOT_PREPARED");
    const off = await panelCtx({deliveries: () => ({})});
    expect(byData(off.root, "sourceState")).toHaveLength(0);
  });
  it("after acceptance: the accepted label, no prepare/accept actions, and 'Teslim paketini dışa aktar' calls the main-process bridge with the run id only (success, mismatch, no bridge)", async () => {
    const accepted = deliveryOf({accepted: {runId: RUN, missionId: MID, sourceCommit: HEAD, exportArtifactHash: H1, acceptedAt: "2026-10-15T10:00:00.000Z", acknowledgements: {}}});
    const native = {calls: [] as any[], next: {exported: true, sha256: H1, fileName: "UASCO-teslim.zip", savedTo: "C:\\x\\UASCO-teslim.zip"} as any, async exportDelivery(id: string) { native.calls.push(id); return native.next; }};
    const {root, doc} = await panelCtx({deliveries: () => listOf(accepted), native});
    const card = byData(root, "deliveryRun", RUN)[0];
    expect(card.dataset.deliveryState).toBe("ACCEPTED");
    expect(card.textContent).toContain(ACC);
    expect(byId(root, `dl-prep-${RUN}`)).toBeNull();
    expect(byId(root, `dl-open-${RUN}`)).toBeNull();
    byId(root, `dl-export-${RUN}`)!.fire("click");
    await tick();
    expect(native.calls).toEqual([RUN]);
    expect(byId(doc.body, `dl-${RUN}-status`)!.textContent).toContain(H1);
    expect(doc.activeElement).not.toBe(doc.body);
    native.next = {exported: false, reason: "DELIVERY_ARTIFACT_HASH_MISMATCH"};
    byId(doc.body, `dl-export-${RUN}`)!.fire("click");
    await tick();
    expect(byId(doc.body, `dl-${RUN}-status`)!.textContent).toContain("hiçbir bayt verilmedi");
    const nob = await panelCtx({deliveries: () => listOf(accepted)});
    byId(nob.root, `dl-export-${RUN}`)!.fire("click");
    await tick();
    expect(byId(nob.doc.body, `dl-${RUN}-status`)!.textContent).toContain("dışa aktarılamıyor");
  });
});

describe("M1a c2 protected main-process wiring (pure blocks evaluated in isolation)", () => {
  const mainSrc = read(root, "apps", "desktop", "main.mjs");
  const block = (name: string, ret: string, ...params: string[]) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); expect(m, name).not.toBeNull(); return (vals: unknown[]) => new Function(...params, `${m![1]}\nreturn ${ret};`)(...vals); };
  it("identity: only the packaged product name 'UASCO Test' selects the TEST AppUserModelID and window title; the release identity is unchanged", () => {
    const b = block("M1A-C2", "{desktopIdentity,windowTitleFor,deliveryExportCheck,deliveryExportFileName}")([]) as any;
    expect(b.desktopIdentity("UASCO")).toEqual({variant: "release", appUserModelId: "com.uasco.desktop", titleSuffix: ""});
    expect(b.desktopIdentity("UASCO Test")).toEqual({variant: "test", appUserModelId: "com.uasco.desktop.test", titleSuffix: " — UASCO Test"});
    for (const n of ["uasco", "UASCO test", "", undefined]) expect(b.desktopIdentity(n).appUserModelId).toBe("com.uasco.desktop");
    expect(b.windowTitleFor("UASCO", b.desktopIdentity("UASCO Test"))).toBe("UASCO — UASCO Test");
    expect(b.windowTitleFor("UASCO", b.desktopIdentity("UASCO"))).toBe("UASCO");
    expect(mainSrc).toContain("app.setAppUserModelId(desktopIdentity(app.getName()).appUserModelId)");
  });
  it("delivery export check: only the record's own file under <data>/deliveries with the recorded sha256 is handed out", async () => {
    const fs = await import("node:fs"), os = await import("node:os"), crypto = await import("node:crypto");
    const b = block("M1A-C2", "{deliveryExportCheck}")([]) as any;
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "m1a-c2-exp-")), rootDir = path.join(tmp, "deliveries");
    try {
      const bytes = Buffer.from("PK-fake-archive"), hash = crypto.createHash("sha256").update(bytes).digest("hex"), file = path.join(rootDir, RUN, `${hash}.zip`);
      fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
      const rec = {runId: RUN, missionId: MID, sourceCommit: HEAD, treeSha: TREE, exportArtifactHash: hash, artifactPath: `deliveries/${RUN}/${hash}.zip`};
      const body = {artifact: rec, sha256: hash, fileState: "VERIFIED", path: file};
      const ok = b.deliveryExportCheck(body, RUN, rootDir, fs, path, crypto);
      expect(ok).toMatchObject({ok: true, sha256: hash, fileName: `UASCO-teslim-${RUN}-${hash.slice(0, 12)}.zip`});
      expect(Buffer.compare(ok.bytes, bytes)).toBe(0);
      expect(b.deliveryExportCheck(body, RUN2, rootDir, fs, path, crypto).reason).toBe("DELIVERY_RECORD_INVALID");
      expect(b.deliveryExportCheck({...body, sha256: H2}, RUN, rootDir, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_HASH_MISMATCH");
      const outside = path.join(tmp, "elsewhere.zip"); fs.writeFileSync(outside, bytes);
      expect(b.deliveryExportCheck({...body, path: outside}, RUN, rootDir, fs, path, crypto).reason).toBe("DELIVERY_PATH_REJECTED");
      fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from("x")]));
      expect(b.deliveryExportCheck(body, RUN, rootDir, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_HASH_MISMATCH");
      fs.rmSync(file);
      expect(b.deliveryExportCheck(body, RUN, rootDir, fs, path, crypto).reason).toBe("DELIVERY_ARTIFACT_MISSING");
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
  });
  it("UX WP4 c2: GET /v1/roles is allowed read-only with only limit/cursor query; writes and other forms stay rejected", () => {
    const get = block("B4-ALLOWLIST", "desktopExtraGetPathAllowed")([]) as (v: unknown) => boolean;
    const post = block("B5-POST-ALLOWLIST", "desktopPostPathAllowed")([]) as (v: unknown) => boolean;
    for (const ok of ["/v1/roles", "/v1/roles?limit=50", "/v1/roles?limit=50&cursor=abc_DEF-1.2", "/v1/roles?cursor=abc"]) expect(get(ok), ok).toBe(true);
    for (const bad of ["/v1/roles?", "/v1/roles?limit=0", "/v1/roles?limit=1000", "/v1/roles?limit=5&limit=6", "/v1/roles?x=1", "/v1/roles?limit=5&x=1", "/v1/roles?cursor=a%2Fb", "/v1/roles/", "/v1/roles/role_x", "/v1/roleset", "/v1/roles?limit=5#x", "/v1/roles/../cockpit", "/v1/role"]) expect(get(bad), bad).toBe(false);
    expect(post("/v1/roles")).toBe(false);
    expect(get("/v1/secrets")).toBe(false);
  });
  it("allow-lists: GET delivery views and POST prepare/accept are allowed with strict ids; export is never a renderer POST; the IPC handler checks the sender and takes only a run id", () => {
    const get = block("B4-ALLOWLIST", "desktopExtraGetPathAllowed")([]) as (v: unknown) => boolean;
    const RID = "run_" + "ab".repeat(12), P = "prj_" + "cd".repeat(12);
    expect(get(`/v1/work-runs/${RID}/delivery`)).toBe(true);
    expect(get(`/v1/deliveries?projectId=${P}`)).toBe(true);
    for (const bad of [`/v1/work-runs/${RID}/delivery/export`, "/v1/work-runs/run_x/delivery", "/v1/deliveries", `/v1/deliveries?projectId=${P}&x=1`]) expect(get(bad), bad).toBe(false);
    const post = block("B5-POST-ALLOWLIST", "desktopPostPathAllowed")([]) as (v: unknown) => boolean;
    expect(post(`/v1/work-runs/${RID}/delivery/prepare`)).toBe(true);
    expect(post(`/v1/work-runs/${RID}/delivery/accept`)).toBe(true);
    expect(post(`/v1/work-runs/${RID}/delivery/export`)).toBe(false);
    expect(post("/v1/work-runs/run_x/delivery/accept")).toBe(false);
    const i = mainSrc.indexOf('ipcMain.handle("uasco:export-delivery"'), h = mainSrc.slice(i, mainSrc.indexOf("\n});", i));
    expect(h).toMatch(/^ipcMain\.handle\("uasco:export-delivery",async\(event,runId\)=>\{\s*requireTrustedSender\(event\);/);
    expect(h).toContain("DELIVERY_RUN_ID_RE.test(runId)");
    expect(h).toContain("deliveryExportCheck(res.body,runId,path.join(dataDirRoot(),\"deliveries\"),fs,path,crypto)");
    expect(h).toContain("if(back!==chk.sha256)");
  });
});

describe("M1a dictionary", () => {
  it("every new M1a dictionary key exists in both languages with non-empty text", async () => {
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    const keys = Object.keys(en).filter(k => k.startsWith("m1a.") || k.startsWith("err.ack") || k.includes("COMPLETION_") || k === "form.field.acknowledgement");
    expect(keys.length).toBeGreaterThanOrEqual(28);
    for (const k of keys) { expect(typeof tr[k], k).toBe("string"); expect(tr[k].length, k).toBeGreaterThan(0); expect(en[k].length, k).toBeGreaterThan(0); }
    expect(tr["m1a.badge"]).toBe(BADGE_TR);
    expect(en["m1a.badge"]).toBe(BADGE_EN);
    // M1a c2: the Founder's exact labels; the acknowledgement-based COMPLETE texts are gone
    for (const lang of [tr, en]) expect(lang["m1a.delivery.acceptedLabel"]).toBe("Kaynak teslimi kabul edildi — ürün DOĞRULANMADI");
    for (const k of ["m1a.confirm.notExecuted", "err.ackOnlyComplete", "post.err.409.COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT", "post.err.409.COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"]) { expect(tr[k], k).toBeUndefined(); expect(en[k], k).toBeUndefined(); }
    expect(tr["m1a.sandbox.unavailable"]).toBe("Sandbox: UNAVAILABLE — M1a modu");
  });
});
