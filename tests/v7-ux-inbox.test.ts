// //TR: Bu test UX WP-INBOX-APPROVAL Gelen Kutusu / Onaylar görünümünün (apps/desktop/renderer/views/inbox.js) dürüstlüğünü gerçek görünüm modülü + sahte DOM ile doğrular: Founder dikkati kuyruğu yalnız gerçek, allow-list'li GET /v1/founder-attention'dan paket/faz/engel türü/gerekçe/zaman/teknik-yeniden-deneme bağlamıyla SALT-OKUNUR okunur; uyarılar yalnız cockpit alerts bloğundan ve ACİL DURDUR durumundan gelir ve sayı yoksa "—" + ayrık dürüst durum gösterilir (uydurma yok); gerçek onay/ret mekanizması (teslim/dikkat kararları) performTransition ile korunur ve yüksek riskli/geri alınamaz COMPLETE açık onay penceresi gerektirir; görünüm doğrudan POST yapmaz; veri yokken OFFLINE/UNAVAILABLE/FAILED/EMPTY dürüst durumları gösterilir; eklenen inbox.* sözlüğü EN/TR'de birebir ve yer tutucuları eşittir.
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const read = (...p: string[]) => fs.readFileSync(path.join(rend, ...p), "utf8");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const code = (src: string) => src.split(/\r?\n/).filter(l => !l.trim().startsWith("//")).join("\n");

const MID = "msn_" + "ab12".repeat(6);
const MID2 = "msn_" + "cd34".repeat(6);
const MID3 = "msn_" + "ef56".repeat(6);
const PID = "prj_" + "ef56".repeat(6);
const RUN = "run_" + "ab".repeat(12);

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; open = false; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
  focus() { this.doc.focused = this; }
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  get activeElement(): N { return this.focused && this.body.contains(this.focused) ? this.focused : this.body; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (root: N, id: string) => all(root).find(n => n.id === id) ?? null;
const byData = (root: N, k: string, v?: string) => all(root).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const sourceState = (root: N, key: string) => all(root).find(n => n.tagName === "LI" && n.dataset.source === key)?.dataset.sourceState;
const pillsIn = (n: N | undefined | null) => n ? all(n).filter(x => "pill" in x.dataset).map(x => x.dataset.pill) : [];

interface CtxOpts {get?: (p: string) => any; post?: (p: string, b: any) => {status: number; body: any}; confirm?: (o: any) => boolean; lang?: string}
async function mkCtx(o: CtxOpts = {}) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), lang = o.lang ?? "tr";
  const calls = {get: [] as string[], post: [] as Array<{path: string; body: any}>, confirm: [] as any[], navigate: [] as string[]};
  const bridge = {
    apiGet: async (p: string) => { calls.get.push(p); const r = o.get?.(p); if (r === undefined) throw new Error(`${p}: HTTP 404`); return r; },
    apiPost: async (p: string, b: any) => { calls.post.push({path: p, body: b}); const r = o.post?.(p, b); if (!r) throw new Error("CONTROL_API_UNREACHABLE"); return r; }
  };
  const api = apiMod.createApi({bridge, store});
  const tr = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t: tr}, t: tr, navigate: (id: string) => { calls.navigate.push(id); },
    rerender: async () => { store.cache.clear(); }, refreshAll: async () => { store.cache.clear(); },
    confirm: async (opts: any) => { calls.confirm.push(opts); return o.confirm ? o.confirm(opts) : false; }, renderAttention() {}, principal: "FOUNDER_LOCAL"};
  return {ctx, doc, calls};
}

const mission = (extra: any = {}) => ({missionId: MID, projectId: PID, title: "Görev A", objective: "Hedef", acceptanceCriteria: ["k1", "k2"], riskLevel: "R2", status: "AUTHORIZED", createdAt: "2026-10-14T09:00:00.000Z", ...extra});
const pvDetail = (state: "PRODUCT_VERIFIED" | "NOT_VERIFIED") => ({run: {runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"}, outcomes: {}, delivery: {runId: "run_" + "0".repeat(24), missionId: MID,
  sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", reason: "x", label: "SOURCE_GENERATION_COMPLETE"}, productVerification: {state, reason: "x", label: null}, testChanges: {}}});

const BLOCKED = [
  {packageId: "V6-PKG-X1", phase: 3, kind: "RISK_ADMISSION_REQUIRED", reason: "Risk level R5 needs Founder admission", at: "2026-10-15T09:00:00.000Z", retryable: false},
  {packageId: "V6-PKG-T4", phase: 7, kind: "PROVIDER_QUOTA_EXHAUSTED", reason: "Claude quota exhausted", at: "2026-10-15T08:00:00.000Z", retryable: true}
];
const liveFix = (overrides: Record<string, any> = {}): Record<string, any> => ({
  "/v1/cockpit": {generatedAt: "2026-10-15T10:00:00.000Z", globalStop: {active: false, reason: null},
    missions: {state: "VERIFIED", total: 5, byStatus: {BLOCKED: 2, FOUNDER_ATTENTION_REQUIRED: 1, DRAFT: 2}},
    awaitingApproval: {state: "VERIFIED", items: [{missionId: MID3, projectId: PID, title: "Needs approval", riskLevel: "R3"}]}},
  "/v1/founder-attention": {blocked: BLOCKED, schedulerVerification: "VERIFIED", retryableKinds: ["PROVIDER_QUOTA_EXHAUSTED"]},
  "/v1/missions": {missions: [mission({status: "REPORTING"}), mission({missionId: MID2, title: "Dikkat", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R3"}), mission({missionId: "msn_" + "77".repeat(12), title: "Yürütülüyor", status: "EXECUTING"})]},
  "/v1/work-runs": {workRuns: [{runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"}]},
  [`/v1/work-runs/${RUN}`]: pvDetail("PRODUCT_VERIFIED"),
  ...overrides
});
const fromFix = (fix: Record<string, any>) => (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); };

let forms: any;
beforeEach(async () => { forms = await load("forms.js"); forms.resetAllForms(); });

describe("UX WP-INBOX-APPROVAL — Founder-attention queue bound to real data", () => {
  it("renders each gated item with package, blocker kind, reason, time and technical-retry context (read-only, no write controls)", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    const panel = byId(root, "inbox-attention-queue")!;
    const items = byData(panel, "attentionItem");
    expect(items.length).toBe(2);
    const x1 = items.find(n => n.dataset.attentionItem === "V6-PKG-X1")!, t4 = items.find(n => n.dataset.attentionItem === "V6-PKG-T4")!;
    expect(x1.textContent).toContain("V6-PKG-X1");
    expect(x1.textContent).toContain("RISK_ADMISSION_REQUIRED");
    expect(x1.textContent).toContain("Risk level R5 needs Founder admission");
    expect(x1.dataset.retryable).toBe("0");
    expect(x1.textContent).toContain("Not technically retryable");
    expect(t4.dataset.retryable).toBe("1");
    expect(t4.textContent).toContain("PROVIDER_QUOTA_EXHAUSTED");
    expect(t4.textContent).toContain("Technically retryable");
    expect(t4.textContent).not.toContain("Not technically retryable");
    expect(panel.textContent).toContain("Blocked at");
    // no write/approve/reject control anywhere in the read-only queue panel
    expect(all(panel).filter(n => n.tagName === "BUTTON").length).toBe(0);
    expect(sourceState(root, "attention")).toBe("ATTENTION");
  });

  it("empty Founder-attention is an honest empty state, never zeros presented as items", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/founder-attention": {blocked: [], schedulerVerification: "VERIFIED"}})), lang: "en"});
    const root = await inbox.render(ctx);
    const panel = byId(root, "inbox-attention-queue")!;
    expect(byData(panel, "attentionItem").length).toBe(0);
    expect(panel.textContent).toContain("No items are awaiting Founder attention");
    expect(sourceState(root, "attention")).toBe("VERIFIED");
  });

  it("a REJECTED scheduler verification is UNAVAILABLE (not a false empty-success)", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/founder-attention": {blocked: [], schedulerVerification: "REJECTED"}})), lang: "en"});
    const root = await inbox.render(ctx);
    const panel = byId(root, "inbox-attention-queue")!;
    expect(byData(panel, "attentionItem").length).toBe(0);
    expect(panel.textContent).toContain("could not be read");
    expect(sourceState(root, "attention")).toBe("UNAVAILABLE");
  });
});

describe("UX WP-INBOX-APPROVAL — alerts bound to the cockpit, no fabrication", () => {
  it("shows the real blocked/attention counts and the Global Stop state, inventing no numbers or percentages", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    const alerts = byId(root, "inbox-alerts")!;
    expect(byData(alerts, "fact", "blocked")[0].textContent).toContain("2");
    expect(byData(alerts, "fact", "attention")[0].textContent).toContain("1");
    const stop = byData(alerts, "fact", "stop")[0];
    expect(pillsIn(stop)).toContain("VERIFIED");
    expect(stop.textContent).toContain("Not active");
    expect(byId(root, "inbox-alerts-status")!.dataset.alertsTotal).toBe("3");
    expect(alerts.textContent).not.toMatch(/\d+(\.\d+)?\s?%/);
    expect(sourceState(root, "alerts")).toBe("ATTENTION");
  });

  it("surfaces an ACTIVE Global Stop with its reason (STOPPED)", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/cockpit": {generatedAt: "2026-10-15T10:00:00.000Z", globalStop: {active: true, reason: "FOUNDER_HOLD"},
      missions: {state: "VERIFIED", total: 2, byStatus: {DRAFT: 2}}, awaitingApproval: {state: "VERIFIED", items: []}}})), lang: "en"});
    const root = await inbox.render(ctx);
    const stop = byData(byId(root, "inbox-alerts")!, "fact", "stop")[0];
    expect(pillsIn(stop)).toContain("STOPPED");
    expect(stop.textContent).toContain("FOUNDER_HOLD");
  });

  it("when the cockpit is unreachable, alerts are honestly unavailable with no numbers", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: () => { throw new Error("fetch failed"); }, lang: "en"});
    const root = await inbox.render(ctx);
    const alerts = byId(root, "inbox-alerts")!;
    expect(alerts.textContent).toContain("could not be read");
    expect(byData(alerts, "fact").length).toBe(0);
    expect(alerts.textContent).not.toMatch(/\b\d+\b/);
    for (const k of ["decisions", "approvals", "attention", "alerts"]) expect(sourceState(root, k), k).toBe("OFFLINE");
  });
});

describe("UX WP-INBOX-APPROVAL — approval actions preserved with confirmation; no direct POST from the view", () => {
  it("keeps the two real decision kinds in order and offers COMPLETE only for a PRODUCT_VERIFIED run", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx, calls} = await mkCtx({get: fromFix(liveFix()), post: () => ({status: 200, body: {}})});
    const root = await inbox.render(ctx);
    expect(byData(root, "decisionMission").map(n => [n.dataset.decision, n.dataset.decisionMission])).toEqual([["DELIVERY_DECISION", MID], ["FOUNDER_ATTENTION", MID2]]);
    expect(byId(root, `ib-COMPLETE-${MID}`)).not.toBeNull();
    expect(byId(root, `ib-PREFLIGHT-${MID2}`)).not.toBeNull();
    expect(calls.post).toEqual([]);
    expect(calls.confirm).toEqual([]);
    expect(root.textContent).toContain("otomatik onaylanmaz"); // noAuto principle present (TR default copy)
  });

  it("accept (COMPLETE) requires the confirm dialog before it POSTs the transition; the view itself never calls api.post", async () => {
    let answer = false;
    const inbox = await load("views", "inbox.js");
    const {ctx, calls} = await mkCtx({get: fromFix(liveFix()), confirm: () => answer, post: () => ({status: 200, body: {}})});
    const root = await inbox.render(ctx);
    byId(root, `ib-COMPLETE-${MID}`)!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.confirm.length).toBe(1);
    expect(calls.confirm[0].target).toContain(MID);
    expect(calls.post).toEqual([]);
    answer = true;
    byId(root, `ib-COMPLETE-${MID}`)!.fire("click"); await new Promise(r => setTimeout(r, 0));
    expect(calls.post).toEqual([{path: `/v1/missions/${MID}/transition`, body: {to: "COMPLETE", reason: "REPORTING -> COMPLETE (UASCO Desktop)"}}]);
    // the view source performs no direct POST and schedules no timers
    expect(code(read("views", "inbox.js"))).not.toMatch(/api\.post|\.post\(/);
    expect(code(read("views", "inbox.js"))).not.toMatch(/setInterval|setTimeout/);
  });
});

describe("UX WP-INBOX-APPROVAL — read-only surface + dictionary parity", () => {
  it("reads only allow-listed read-only GET paths and writes nothing during render", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx, calls} = await mkCtx({get: fromFix(liveFix())});
    await inbox.render(ctx);
    expect([...new Set(calls.get)].sort()).toEqual(["/v1/cockpit", "/v1/founder-attention", "/v1/missions", "/v1/work-runs", `/v1/work-runs/${RUN}`].sort());
    expect(calls.post).toEqual([]);
    expect(calls.confirm).toEqual([]);
  });

  it("every new inbox.* key exists in EN and TR with identical placeholders", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = ["inbox.eyebrow", "inbox.readonly", "inbox.sources", "inbox.src.decisions", "inbox.src.approvals", "inbox.src.attention", "inbox.src.alerts",
      "inbox.alerts", "inbox.alerts.lead", "inbox.alerts.none", "inbox.alerts.count", "inbox.alerts.unavailable", "inbox.alerts.blocked", "inbox.alerts.attention", "inbox.alerts.stop", "inbox.alerts.stopActive", "inbox.alerts.stopInactive",
      "inbox.attention", "inbox.attention.lead", "inbox.attention.none", "inbox.attention.unavailable", "inbox.attention.count", "inbox.attention.retryable", "inbox.attention.notRetryable",
      "inbox.attention.item.phase", "inbox.attention.item.reason", "inbox.attention.item.when", "inbox.attention.item.unknown"];
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) {
      expect(typeof en[k], `en ${k}`).toBe("string");
      expect(en[k].length, `en ${k}`).toBeGreaterThan(0);
      expect(typeof tr[k], `tr ${k}`).toBe("string");
      expect(tr[k].length, `tr ${k}`).toBeGreaterThan(0);
      expect(ph(tr[k]), `placeholders ${k}`).toBe(ph(en[k]));
    }
  });
});
