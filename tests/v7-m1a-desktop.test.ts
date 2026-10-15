// //TR: Bu test V7-PKG-M1A-MODE masaüstü yüzeylerini gerçek görünüm modülleri + sahte DOM ile doğrular: koşu/görev/teslim/export yüzeylerinde "Testler çalıştırılmadı — NOT_VERIFIED (sandbox doğrulanmadı)" rozeti yalnız test yürütme kanıtı yoksa görünür (sahte veri yok), Ayarlar "Sandbox: UNAVAILABLE — M1a modu" ve ayrı UASCO profillerinin giriş gerekli durumunu gösterir, COMPLETE akışı NOT_EXECUTED beyanını ve değişen test/harness listesini gösterir, her onay için ayrı kutu ister (işaretsizse istek gönderilmez) ve kesin onay nesnelerini gönderir; klavye odağı hiçbir adımda BODY'ye düşmez (focus.js settleFocus).
import {describe, it, expect, beforeEach} from "vitest";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(...p)).href);

// ---------- Sahte DOM (B5 biçimi + settleFocus için öznitelik seçicisi) ----------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; open = false; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get isConnected() { return this.doc.body.contains(this); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; if (node.parent) node.parent.children = node.parent.children.filter(x => x !== node); node.parent = this; this.children.push(node); } }
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

describe("M1a COMPLETE flow: explicit checkbox per acknowledgement, exact objects, focus never on BODY", () => {
  const get = (tc: boolean) => ({"/v1/missions": {missions: [mission()]}, "/v1/projects": {projects: []}, "/v1/work-runs": {runs: [m1aRun()]}, [`/v1/work-runs?missionId=${MID}`]: {runs: [m1aRun()]},
    [`/v1/missions/${MID}`]: {mission: mission(), tasks: []}, [`/v1/work-runs/${RUN}`]: {run: m1aRun(), outcomes: {functionalAcceptance: "NOT_EXECUTED"}, completionRequirements: reqs(tc)}, "/v1/founder-attention": {blocked: []}});
  it("mission detail: shows the not-executed statement and changed tests/harness; unchecked boxes block the POST; checked boxes send the exact objects", async () => {
    const work = await load(rend, "views", "work.js");
    forms.selection.missionId = MID;
    const {doc, calls, show} = await mkCtx({get: get(true), confirm: true, post: () => ({status: 200, body: {mission: {}}})});
    let w = await show(work);
    const block = byId(w, `ack-block-${MID}`)!;
    expect(block.textContent).toContain("Bu koşunun testleri ÇALIŞTIRILMADI: doğrulanmış bir sandbox yok (SANDBOX_UNAVAILABLE)");
    expect(block.textContent).toContain("tests/a.test.mjs");
    expect(block.textContent).toContain("vitest.config.ts");
    expect(byData(block, "ack").map(n => n.dataset.ack)).toEqual(["notExecuted", "testChanges"]);
    // 1) nothing ticked -> no POST, explicit error, focus on the status block (not BODY)
    byId(w, "tr-COMPLETE")!.fire("click");
    await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toHaveLength(0);
    expect(byId(doc.body, `act-${MID}-status`)!.textContent).toContain("testlerin çalıştırılmadığını (NOT_VERIFIED) onaylayan kutuyu işaretleyin");
    expect(doc.activeElement).not.toBe(doc.body);
    // 2) only the NOT_EXECUTED box -> still refused locally (test-change box missing)
    w = doc.body;
    byId(w, `ack-ne-${MID}`)!.fire("change", {target: {checked: true}});
    byId(w, "tr-COMPLETE")!.fire("click");
    await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toHaveLength(0);
    expect(byId(doc.body, `act-${MID}-status`)!.textContent).toContain("değişen testleri / harness'ı onaylayan kutuyu işaretleyin");
    expect(doc.activeElement).not.toBe(doc.body);
    // 3) both ticked -> confirm dialog carries the statement, POST carries exactly both objects
    byId(doc.body, `ack-tc-${MID}`)!.fire("change", {target: {checked: true}});
    byId(doc.body, "tr-COMPLETE")!.fire("click");
    for (let i = 0; i < 5 && !calls.post.length; i++) await new Promise(r => setTimeout(r, 0));
    expect(calls.confirm.at(-1).body).toContain("Testler ÇALIŞTIRILMADI (doğrulanmış sandbox yok); görev NOT_VERIFIED olarak tamamlanacak.");
    expect(calls.post).toHaveLength(1);
    expect(calls.post[0].path).toBe(`/v1/missions/${MID}/transition`);
    expect(calls.post[0].body).toEqual({to: "COMPLETE", reason: "REPORTING -> COMPLETE (UASCO Desktop)", notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: HEAD}, acknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: TSSHA}});
    await new Promise(r => setTimeout(r, 0));
    expect(doc.activeElement).not.toBe(doc.body);
  });
  it("inbox delivery decision: NOT_EXECUTED only -> one box; server 409 refusal is shown explicitly and focus stays off BODY", async () => {
    const inbox = await load(rend, "views", "inbox.js");
    const {doc, calls, show} = await mkCtx({get: get(false), confirm: true, post: () => ({status: 409, body: {error: "WORKOS_CONFLICT", reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"}})});
    const i = await show(inbox);
    expect(byData(i, "ack").map(n => n.dataset.ack)).toEqual(["notExecuted"]);
    byId(i, `ack-ne-${MID}`)!.fire("change", {target: {checked: true}});
    byId(i, `ib-COMPLETE-${MID}`)!.fire("click");
    for (let k = 0; k < 5 && !calls.post.length; k++) await new Promise(r => setTimeout(r, 0));
    expect(calls.post[0].body).toEqual({to: "COMPLETE", reason: "REPORTING -> COMPLETE (UASCO Desktop)", notExecutedAcknowledgement: {acknowledgeNotExecuted: true, headSha: HEAD}});
    await new Promise(r => setTimeout(r, 0));
    expect(byId(doc.body, `act-${MID}-status`)!.textContent).toContain("COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT");
    expect(doc.activeElement).not.toBe(doc.body);
  });
  it("request builder: acknowledgements only with COMPLETE and only in the exact shape", async () => {
    const core = await load(rend, "work-core.js"), m1a = await load(rend, "m1a.js");
    expect(core.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "BLOCKED", reason: "x", acknowledgements: {notExecuted: {acknowledgeNotExecuted: true, headSha: HEAD}}}).ok).toBe(false);
    expect(core.buildTransitionRequest({missionId: MID, from: "REPORTING", to: "COMPLETE", reason: "x", confirmed: true, acknowledgements: {notExecuted: {acknowledgeNotExecuted: true, headSha: "zz"}}}).ok).toBe(false);
    expect(m1a.buildCompletionAcknowledgements(reqs(false), {notExecuted: false})).toMatchObject({ok: false, errors: {acknowledgement: "err.ackNotExecutedRequired"}});
    expect(m1a.buildCompletionAcknowledgements({...reqs(false), headSha: null}, {notExecuted: true})).toMatchObject({ok: false, errors: {acknowledgement: "err.ackDataMissing"}});
    expect(m1a.buildCompletionAcknowledgements(reqs(false), {notExecuted: true})).toEqual({ok: true, errors: {}, acknowledgements: {notExecuted: {acknowledgeNotExecuted: true, headSha: HEAD}}});
    expect(core.mapCompletionRequirements({headSha: HEAD})).toBeNull();
    const d = core.describePostResult({status: 409, body: {error: "WORKOS_CONFLICT", reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"}});
    expect(d.key).toBe("post.err.409.COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT");
  });
  it("every new M1a dictionary key exists in both languages with non-empty text", async () => {
    const en = (await load(rend, "locales", "en.js")).default, tr = (await load(rend, "locales", "tr.js")).default;
    const keys = Object.keys(en).filter(k => k.startsWith("m1a.") || k.startsWith("err.ack") || k.includes("COMPLETION_") || k === "form.field.acknowledgement");
    expect(keys.length).toBeGreaterThanOrEqual(28);
    for (const k of keys) { expect(typeof tr[k], k).toBe("string"); expect(tr[k].length, k).toBeGreaterThan(0); expect(en[k].length, k).toBeGreaterThan(0); }
    expect(tr["m1a.badge"]).toBe(BADGE_TR);
    expect(en["m1a.badge"]).toBe(BADGE_EN);
  });
});
