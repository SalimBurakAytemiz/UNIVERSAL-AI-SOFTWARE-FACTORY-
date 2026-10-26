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

const TSK = "tsk_" + "99".repeat(12);
const ATT_ITEMS = [
  {kind: "RUN_AWAITING_APPROVAL", nextAction: "ACCEPT_DELIVERY", projectId: PID, missionId: MID, runId: RUN, taskId: null, title: "Teslim bekleyen görev", reason: null, since: "2026-10-15T09:00:00.000Z"},
  {kind: "RUN_NEEDS_DECISION", nextAction: "REVIEW_RUN", projectId: PID, missionId: MID2, runId: "run_" + "cd".repeat(12), taskId: null, title: "Başarısız koşu", reason: "Claude quota exhausted", since: "2026-10-15T08:00:00.000Z"},
  {kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", projectId: PID, missionId: MID, runId: null, taskId: TSK, title: "Engelli görev", reason: null, since: null}
];
const attCounts = (over: Record<string, number> = {}) => ({RUN_AWAITING_APPROVAL: 1, MISSION_FOUNDER_ATTENTION: 0, RUN_NEEDS_DECISION: 1, MISSION_AUTHORIZATION_PENDING: 0, MISSION_BLOCKED: 0, TASK_BLOCKED: 1, ...over});
const attention = (items: any[] = ATT_ITEMS, counts: any = attCounts(), truncated = false) => ({attention: {items, counts, truncated, source: "WORKOS"}});
const liveFix = (overrides: Record<string, any> = {}): Record<string, any> => ({
  "/v1/cockpit": {generatedAt: "2026-10-15T10:00:00.000Z", globalStop: {active: false, reason: null},
    missions: {state: "VERIFIED", total: 5, byStatus: {BLOCKED: 2, FOUNDER_ATTENTION_REQUIRED: 1, DRAFT: 2}},
    awaitingApproval: {state: "VERIFIED", items: [{missionId: MID3, projectId: PID, title: "Needs approval", riskLevel: "R3"}]}},
  "/v1/attention": attention(),
  "/v1/missions": {missions: [mission({status: "REPORTING"}), mission({missionId: MID2, title: "Dikkat", status: "FOUNDER_ATTENTION_REQUIRED", riskLevel: "R3"}), mission({missionId: "msn_" + "77".repeat(12), title: "Yürütülüyor", status: "EXECUTING"})]},
  "/v1/work-runs": {workRuns: [{runId: RUN, missionId: MID, status: "AWAITING_APPROVAL"}]},
  [`/v1/work-runs/${RUN}`]: pvDetail("PRODUCT_VERIFIED"),
  ...overrides
});
const fromFix = (fix: Record<string, any>) => (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); };

let forms: any;
beforeEach(async () => { forms = await load("forms.js"); forms.resetAllForms(); });

describe("UX WP-INBOX-APPROVAL — Founder-attention queue bound to real data", () => {
  it("renders each item in severity order with its kind, next action, reason and time (read-only, no write controls); the six kinds are separate counters", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    const panel = byId(root, "inbox-attention-queue")!;
    const items = byData(panel, "attentionItem");
    expect(items.map(n => [n.dataset.attentionKind, n.dataset.nextAction])).toEqual([["RUN_AWAITING_APPROVAL", "ACCEPT_DELIVERY"], ["RUN_NEEDS_DECISION", "REVIEW_RUN"], ["TASK_BLOCKED", "UNBLOCK_TASK"]]);
    expect(items.map(n => n.dataset.attentionItem)).toEqual([RUN, "run_" + "cd".repeat(12), TSK]);
    expect(items[1].textContent).toContain("Run needs a decision"); expect(items[1].textContent).toContain("Review the run"); expect(items[1].textContent).toContain("Claude quota exhausted"); expect(items[1].textContent).toContain("Başarısız koşu");
    expect(items[0].textContent).toContain("Accept the delivery"); expect(items[2].textContent).toContain("Unblock the task"); expect(items[2].textContent).not.toContain("Reason:"); expect(items[0].textContent).toContain("Since");
    expect(byData(panel, "counter").map(n => [n.dataset.counter, n.dataset.value])).toEqual([["RUN_AWAITING_APPROVAL", "1"], ["MISSION_FOUNDER_ATTENTION", "0"], ["RUN_NEEDS_DECISION", "1"], ["MISSION_AUTHORIZATION_PENDING", "0"], ["MISSION_BLOCKED", "0"], ["TASK_BLOCKED", "1"]]);
    expect(byData(panel, "attentionCount")[0].dataset.attentionCount).toBe("3");
    // the VISIBLE counter text (not only the data attribute) equals the server count for every kind (review #192 M13)
    expect(byData(panel, "counter").map(n => n.children[0].textContent)).toEqual(["1", "0", "1", "0", "0", "1"]);
    expect(byData(panel, "counter").map(n => n.textContent)).toEqual(["1 Run awaiting your approval", "0 Mission needs your attention", "1 Run needs a decision", "0 Mission awaiting authorization", "0 Mission blocked", "1 Task blocked"]);
    expect(byData(panel, "attentionCount")[0].textContent).toContain("3 item(s) awaiting Founder attention");
    expect(byData(panel, "attentionTruncated")).toEqual([]); expect(byData(panel, "attentionDropped")).toEqual([]);
    // no write/approve/reject control anywhere in the read-only queue panel
    expect(all(panel).filter(n => n.tagName === "BUTTON").length).toBe(0);
    expect(sourceState(root, "attention")).toBe("ATTENTION");
  });

  it("when every item is unreadable the panel says so instead of claiming an empty queue", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/attention": attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 2, TASK_BLOCKED: 0}))})), lang: "en"});
    const panel = byId(await inbox.render(ctx), "inbox-attention-queue")!;
    expect(panel.textContent).not.toContain("No items are awaiting"); expect(byData(panel, "attentionDropped")[0].dataset.attentionDropped).toBe("1"); expect(byData(panel, "attentionItem")).toEqual([]);
  });
  it("unknown kinds and malformed items are dropped but counted aloud; a truncated list says so", async () => {
    const inbox = await load("views", "inbox.js");
    const items = [...ATT_ITEMS, {kind: "SOMETHING_NEW", nextAction: "REVIEW_RUN", projectId: PID, missionId: MID, runId: RUN, taskId: null, title: "x", reason: null, since: null}, {...ATT_ITEMS[0], title: ""}];
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/attention": attention(items, attCounts({TASK_BLOCKED: 1}))})), lang: "en"});
    const panel = byId(await inbox.render(ctx), "inbox-attention-queue")!;
    expect(byData(panel, "attentionItem")).toHaveLength(3); expect(byData(panel, "attentionDropped")[0].dataset.attentionDropped).toBe("2"); expect(panel.textContent).toContain("2 item(s) from the server could not be read");
    const big = Array.from({length: 200}, (_, i) => ({...ATT_ITEMS[2], taskId: "tsk_" + String(i).padStart(24, "0").replace(/0/g, "a")}));
    const t = await mkCtx({get: fromFix(liveFix({"/v1/attention": attention(big, attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 250}), true)})), lang: "en"});
    const tp = byId(await inbox.render(t.ctx), "inbox-attention-queue")!;
    expect(byData(tp, "attentionTruncated")).toHaveLength(1); expect(tp.textContent).toContain("Showing 200 of 250 items"); expect(tp.textContent).not.toContain("at least"); expect(byData(tp, "attentionCount")[0].textContent).toContain("250 item(s) awaiting Founder attention"); expect(byData(tp, "counter").find(n => n.dataset.counter === "TASK_BLOCKED")!.dataset.value).toBe("250"); expect(byData(tp, "attentionCount")[0].dataset.truncated).toBe("1");
  });

  it("empty Founder-attention is an honest empty state, never zeros presented as items", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/attention": attention([], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0}))})), lang: "en"});
    const root = await inbox.render(ctx);
    const panel = byId(root, "inbox-attention-queue")!;
    expect(byData(panel, "attentionItem").length).toBe(0);
    expect(panel.textContent).toContain("No items are awaiting Founder attention");
    expect(sourceState(root, "attention")).toBe("VERIFIED");
  });

  it("a malformed attention answer is not a false empty-success: no items, source is ERROR", async () => {
    const inbox = await load("views", "inbox.js");
    for (const bad of [{attention: {items: [], counts: attCounts(), truncated: false, source: "SCHEDULER"}}, {attention: {items: [], counts: attCounts(), truncated: "no", source: "WORKOS"}}, {nonsense: true}, attention([], attCounts({TASK_BLOCKED: 4}))]) {
      const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/attention": bad})), lang: "en"});
      const root = await inbox.render(ctx);
      const panel = byId(root, "inbox-attention-queue")!;
      expect(byData(panel, "attentionItem").length).toBe(0);
      expect(panel.textContent).toContain("could not be read");
      expect(sourceState(root, "attention")).toBe("FAILED");
    }
  });
});

// //TR: #192 incelemesi: aşağıdaki iki blok (uyarılar kokpite bağlı / onay eylemleri) dikkat kuyruğundan bağımsız korumalardır; taban sürümden aynen geri konuldu, yeni /v1/attention fixture'ıyla çalışır.
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
    expect([...new Set(calls.get)].sort()).toEqual(["/v1/attention", "/v1/cockpit", "/v1/missions", "/v1/work-runs", `/v1/work-runs/${RUN}`].sort());
    expect(calls.post).toEqual([]);
    expect(calls.confirm).toEqual([]);
  });

  it("every new inbox.* key exists in EN and TR with identical placeholders", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = ["inbox.eyebrow", "inbox.readonly", "inbox.sources", "inbox.src.decisions", "inbox.src.approvals", "inbox.src.attention", "inbox.src.alerts",
      "inbox.alerts", "inbox.alerts.lead", "inbox.alerts.none", "inbox.alerts.count", "inbox.alerts.unavailable", "inbox.alerts.blocked", "inbox.alerts.attention", "inbox.alerts.stop", "inbox.alerts.stopActive", "inbox.alerts.stopInactive",
      "inbox.attention", "inbox.attention.lead", "inbox.attention.none", "inbox.attention.unavailable", "inbox.attention.count",
      "inbox.attention.item.reason"];
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

// //TR: Aşağıdaki bloklar Gelen Kutusu için negatif (bozuk/404 yanıt => uydurma yok), erişilebilirlik ve EN/TR eşitlik testlerini ekler.
const sourceStripLabel = (root: N) => all(root).find(n => n.tagName === "UL" && (n.attrs.get("aria-label") ?? "").length > 0)?.attrs.get("aria-label");

describe("test+states: inbox — negative (no fabricated values)", () => {
  // //TR: Mission listesi 404 ise karar kuyruğu uydurulmaz; dürüst durum gösterilir, karar kartı yoktur.
  it("missions endpoint failing yields no decision cards and a non-VERIFIED decisions source", async () => {
    const inbox = await load("views", "inbox.js");
    const fix = liveFix(); delete fix["/v1/missions"];
    const {ctx} = await mkCtx({get: fromFix(fix), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byData(root, "decisionMission").length).toBe(0);
    expect(sourceState(root, "decisions")).not.toBe("VERIFIED");
    expect(sourceState(root, "decisions")).not.toBe("WAITING");
  });

  // //TR: Work-runs okunamazsa teslim kararı (COMPLETE) sunulmaz; yalnız dikkat kararı kalır.
  it("work-runs failing never offers a delivery decision or COMPLETE", async () => {
    const inbox = await load("views", "inbox.js");
    const fix = liveFix(); delete fix["/v1/work-runs"];
    const {ctx} = await mkCtx({get: fromFix(fix), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byData(root, "decision", "DELIVERY_DECISION").length).toBe(0);
    expect(all(root).some(n => n.id.startsWith("ib-COMPLETE-"))).toBe(false);
    expect(byId(root, "inbox-decisions")!.textContent).toContain(ctx.t("inbox.runsUnavailable"));
  });

  // //TR: Run ayrıntısı NOT_VERIFIED ise kabul (COMPLETE) düğmesi yoktur ve açıklama gösterilir.
  it("a NOT_VERIFIED run hides COMPLETE and explains why (never Verified without proof)", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({[`/v1/work-runs/${RUN}`]: pvDetail("NOT_VERIFIED")})), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byId(root, `ib-COMPLETE-${MID}`)).toBeNull();
    expect(byId(root, `ib-complete-na-${MID}`)).not.toBeNull();
  });

  // //TR: Run ayrıntısı 404 ise de COMPLETE sunulmaz.
  it("run detail 404 never offers COMPLETE", async () => {
    const inbox = await load("views", "inbox.js");
    const fix = liveFix(); delete fix[`/v1/work-runs/${RUN}`];
    const {ctx} = await mkCtx({get: fromFix(fix), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byId(root, `ib-COMPLETE-${MID}`)).toBeNull();
  });

  // //TR: /v1/attention 404 ise kuyruk kalemi uydurulmaz ve kaynak VERIFIED değildir.
  it("attention 404 shows no items and is not VERIFIED", async () => {
    const inbox = await load("views", "inbox.js");
    const fix = liveFix(); delete fix["/v1/attention"];
    const {ctx} = await mkCtx({get: fromFix(fix), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byData(byId(root, "inbox-attention-queue")!, "attentionItem").length).toBe(0);
    expect(sourceState(root, "attention")).not.toBe("VERIFIED");
    expect(sourceState(root, "attention")).not.toBe("ATTENTION");
  });

  // //TR: Cockpit bozuk (eksik awaitingApproval) ise onay sayısı uydurulmaz.
  it("malformed cockpit payload does not fabricate approvals or alert counts", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/cockpit": {generatedAt: "x", globalStop: "garbage", missions: "nope"}})), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byData(byId(root, "inbox-approvals")!, "approval").length).toBe(0);
    expect(sourceState(root, "approvals")).not.toBe("WAITING");
    expect(sourceState(root, "alerts")).not.toBe("ATTENTION");
    expect(byId(root, "inbox-alerts-status")?.dataset.alertsTotal ?? "—").toBe("—");
  });

  // //TR: Cockpit onay bekleyen listesi doluysa kart açılır ve düğme gezinir.
  it("approvals list renders a typed open button that navigates to work", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx, calls} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    const b = byId(root, `ap-open-${MID3}`)!;
    expect(b.attrs.get("type")).toBe("button");
    b.fire("click");
    expect(calls.navigate).toEqual(["work"]);
    expect(calls.post).toEqual([]);
  });

  // //TR: HTML içeren API metni düğüm olarak yorumlanmaz; yalnız metin olarak görünür.
  it("API strings containing markup stay inert text", async () => {
    const inbox = await load("views", "inbox.js");
    const evil = "<img src=x onerror=alert(1)>";
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/attention": attention([{...ATT_ITEMS[1], title: evil, reason: evil}], attCounts({RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}))})), lang: "en"});
    const root = await inbox.render(ctx);
    expect(all(root).some(n => n.tagName === "IMG")).toBe(false);
    expect(byId(root, "inbox-attention-queue")!.textContent).toContain(evil);
  });
});

describe("test+states: inbox — accessibility", () => {
  // //TR: h1 odaklanabilir (tabindex=-1), tüm düğmeler type=button, gruplar etiketli, durum alanları role=status.
  it("h1 is focusable, every button is typed, groups are labelled and status regions announce", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    const h1s = all(root).filter(n => n.tagName === "H1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].attrs.get("tabindex")).toBe("-1");
    expect(h1s[0].id).toBe("view-title");
    const buttons = all(root).filter(n => n.tagName === "BUTTON");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.attrs.get("type"), b.id).toBe("button");
    const groups = all(root).filter(n => n.attrs.get("role") === "group");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect((g.attrs.get("aria-label") ?? "").length, "group label").toBeGreaterThan(0);
    expect(sourceStripLabel(root)).toBeTruthy();
    expect(byId(root, "inbox-alerts-status")!.attrs.get("role")).toBe("status");
  });

  // //TR: Düğmeler yerel <button> öğesidir (Enter/Space yerel click üretir); odak anahtarları kararlıdır.
  it("action buttons are native buttons with stable focus keys (keyboard activation is native)", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    for (const b of all(root).filter(n => n.tagName === "BUTTON")) expect(b.dataset.focusKey, b.id).toBe(b.id);
  });
});

describe("test+states: inbox — EN/TR parity for every key the view uses", () => {
  // //TR: Görünüm kaynağındaki tüm inbox.* anahtarları ve inbox.* sözlük kümesi EN ve TR'de aynıdır; yer tutucular eşittir.
  it("inbox.* key sets are identical in EN and TR and every literal key used by the view exists with placeholder parity", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const pick = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("inbox.")).sort();
    expect(pick(tr)).toEqual(pick(en));
    const src = read("views", "inbox.js");
    const used = [...new Set([...src.matchAll(/["']((?:inbox|area\.inbox|attention|work\.transition|m1a\.complete)\.[\w.]+)["']/g)].map(m => m[1]))];
    expect(used.length).toBeGreaterThan(10);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of used) {
      expect(typeof en[k], `en ${k}`).toBe("string");
      expect(typeof tr[k], `tr ${k}`).toBe("string");
      expect(ph(tr[k]), `placeholders ${k}`).toBe(ph(en[k]));
    }
  });
});

// UI-113 — "Approval required" state panel (self-contained block; renderer-only, no new action).
describe("UI-113 — Approval required panel on #/inbox", () => {
  const NOW = Date.parse("2026-10-16T10:00:00.000Z");
  const apItems = (n: number) => Array.from({length: n}, (_, i) => ({missionId: "msn_" + i.toString(16).padStart(24, "0"), projectId: PID, title: `M${i}`, riskLevel: "R2"}));
  const cockpit = (items: any[], extra: any = {}) => ({generatedAt: "2026-10-15T10:00:00.000Z", globalStop: {active: false, reason: null}, missions: {state: "VERIFIED", total: 1, byStatus: {}}, awaitingApproval: {state: "VERIFIED", items}, ...extra});
  const fix = (items: any[], over: Record<string, any> = {}) => liveFix({"/v1/cockpit": cockpit(items), ...over});
  const panelOf = (root: N) => byId(root, "inbox-required")!;

  it("core: derives risk, run, age, approve/reject outcomes from existing transition rules; impact is UNKNOWN", async () => {
    const core = await load("approval-core.js");
    const res = core.deriveApprovalRequired({
      cockpit: {state: "OK", data: {approvals: {state: "VERIFIED", items: [{missionId: MID, title: "Görev A", riskLevel: "R2"}]}}},
      missions: {state: "VERIFIED", items: [{missionId: MID, status: "REPORTING", riskLevel: "R2", createdAt: "2026-10-14T10:00:00.000Z"}]},
      runs: {state: "VERIFIED", items: [{runId: RUN, missionId: MID, status: "AWAITING_APPROVAL", startedAt: "2026-10-16T08:30:00.000Z"}]}, now: NOW});
    expect(res.state).toBe("READY");
    const r = res.rows[0];
    expect(r.run).toEqual({runId: RUN, status: "AWAITING_APPROVAL"});
    expect(r.age).toEqual({days: 0, hours: 1, minutes: 30});
    expect(r.sinceBasis).toBe("RUN_STARTED");
    expect(r.outcome.approve).toEqual([{to: "COMPLETE", highRisk: true, irreversible: true}]);
    expect(r.outcome.reject.map((x: any) => x.to)).toEqual(["BLOCKED"]); // REPORTING allows COMPLETE and BLOCKED only
    expect(r.impact).toBe("UNKNOWN");
  });

  it("core: flags match work-core (AUTHORIZED high-risk but reversible; unknown status stays UNKNOWN)", async () => {
    const core = await load("approval-core.js"), wc = await load("work-core.js");
    const o = core.transitionOutcome("PREFLIGHT");
    expect(o.approve).toEqual([{to: "AUTHORIZED", highRisk: wc.requiresConfirm("AUTHORIZED"), irreversible: false}]);
    expect(core.transitionOutcome("REPORTING").approve[0].irreversible).toBe(wc.allowedNext("COMPLETE").length === 0);
    expect(core.transitionOutcome("EXECUTING").approve).toEqual([]);
    expect(core.transitionOutcome(null).known).toBe(false);
    expect(core.transitionOutcome("NOPE").known).toBe(false);
    expect(core.ageOf("not-a-date", NOW)).toBeNull();
    expect(core.ageOf("2030-01-01T00:00:00.000Z", NOW)).toBeNull();
  });

  it("renders irreversible/high-risk text, run + status, <time datetime>, approve/reject text and UNKNOWN impact", async () => {
    const inbox = await load("views", "inbox.js");
    const f = fix([{missionId: MID, projectId: PID, title: "Görev A", riskLevel: "R2"}]);
    const {ctx, calls} = await mkCtx({lang: "en", get: fromFix(f)});
    const root = await inbox.render(ctx);
    const row = byData(panelOf(root), "required", MID)[0];
    expect(row.dataset.irreversible).toBe("1");
    expect(row.dataset.highRisk).toBe("1");
    const fact = (k: string) => byData(row, "fact", k)[0].textContent;
    expect(fact("transition")).toContain("Irreversible");
    expect(fact("transition")).toContain("High risk");
    expect(fact("run")).toContain(RUN);
    expect(fact("approve")).toContain("→");
    expect(fact("reject")).toContain("→");
    expect(fact("impact")).toContain("UNKNOWN");
    const time = all(row).find(n => n.tagName === "TIME")!;
    expect(time.getAttribute("datetime")).toBe("2026-10-14T09:00:00.000Z");
    expect(calls.post).toEqual([]);
  });

  it("a cockpit approval whose mission/run is not readable shows UNKNOWN, not a guess", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({lang: "en", get: fromFix(fix(apItems(1), {"/v1/work-runs": {workRuns: []}}))});
    const row = byData(panelOf(await inbox.render(ctx)), "required")[0];
    expect(byData(row, "fact", "transition")[0].textContent).toContain("UNKNOWN");
    expect(byData(row, "fact", "run")[0].textContent).toContain("No linked work run");
    expect(all(row).some(n => n.tagName === "TIME")).toBe(false);
    const {ctx: c2} = await mkCtx({lang: "en", get: (p: string) => { if (p === "/v1/work-runs") throw new Error("HTTP 500"); return fromFix(fix(apItems(1)))(p); }});
    expect(byData(byData(panelOf(await inbox.render(c2)), "required")[0], "fact", "run")[0].textContent).toContain("UNKNOWN");
  });

  it("caps at 50 rows with a 'showing X of Y' note", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({lang: "en", get: fromFix(fix(apItems(60)))});
    const p = panelOf(await inbox.render(ctx));
    expect(byData(p, "required").length).toBe(50);
    expect(byData(p, "requiredTruncated")[0].textContent).toContain("50 of 60");
    const {ctx: c2} = await mkCtx({lang: "en", get: fromFix(fix(apItems(3)))});
    const p2 = panelOf(await inbox.render(c2));
    expect(byData(p2, "required").length).toBe(3);
    expect(byData(p2, "requiredTruncated")).toEqual([]);
  });

  it("empty is explicit; OFFLINE / ERROR read failures use the honest state note, never a 0", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({lang: "en", get: fromFix(fix([]))});
    const p = panelOf(await inbox.render(ctx));
    expect(p.textContent).toContain("Nothing awaits your approval");
    expect(byData(p, "required")).toEqual([]);
    const off = await mkCtx({lang: "en", get: () => { throw new Error("CONTROL_API_UNREACHABLE"); }});
    const po = panelOf(await inbox.render(off.ctx));
    expect(byData(po, "required")).toEqual([]);
    expect(all(po).some(n => n.tagName === "P" && n.getAttribute("role") === "status")).toBe(true);
    expect(po.textContent).not.toContain("awaiting approval.");
    const core = await load("approval-core.js");
    expect(core.deriveApprovalRequired({cockpit: {state: "OK", data: {approvals: {state: "ERROR", items: []}}}}).state).toBe("ERROR");
    expect(core.deriveApprovalRequired({cockpit: {state: "OFFLINE", data: {approvals: {state: "UNAVAILABLE", items: []}}}}).state).toBe("OFFLINE");
  });

  it("performs no POST: buttons only focus the existing approval card; request list unchanged", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx, doc, calls} = await mkCtx({get: fromFix(fix([{missionId: MID3, projectId: PID, title: "Needs approval", riskLevel: "R3"}])), post: () => ({status: 200, body: {}})});
    const root = await inbox.render(ctx);
    doc.body.append(root);
    const getsBefore = [...calls.get];
    byId(root, `req-goto-${MID3}`)!.fire("click");
    expect(doc.focused).toBe(byId(root, `ap-card-${MID3}`));
    expect(calls.post).toEqual([]);
    expect(calls.confirm).toEqual([]);
    expect(calls.get).toEqual(getsBefore);
    const src = code(read("approval-core.js")) + code(read("views", "inbox.js"));
    expect(src).not.toMatch(/innerHTML|\.post\(|localStorage|sessionStorage|fetch\(/);
  });

  it("a11y: labelled region, h2/h3 headings, labelled list, focusable target card and labelled goto button", async () => {
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({lang: "en", get: fromFix(fix([{missionId: MID3, projectId: PID, title: "Needs approval", riskLevel: "R3"}]))});
    const root = await inbox.render(ctx), p = panelOf(root);
    expect(p.tagName).toBe("SECTION");
    expect(p.getAttribute("aria-labelledby")).toBe("inbox-required-t");
    expect(byId(p, "inbox-required-t")!.tagName).toBe("H2");
    expect(all(p).filter(n => n.tagName === "H3").length).toBe(1);
    expect(all(p).find(n => n.tagName === "UL")!.getAttribute("aria-label")).toBe("Approval required");
    expect(byId(root, `ap-card-${MID3}`)!.getAttribute("tabindex")).toBe("-1");
    const btn = byId(p, `req-goto-${MID3}`)!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-label")).toContain("Needs approval");
    const idx = (id: string) => all(root).findIndex(n => n.id === id);
    expect(idx("inbox-required")).toBeLessThan(idx("inbox-approvals"));
  });

  it("every inbox.required.* key exists in EN and TR with identical placeholders", async () => {
    const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
    const keys = Object.keys(en).filter(k => k === "inbox.required" || k.startsWith("inbox.required."));
    const trKeys = Object.keys(tr).filter(k => k === "inbox.required" || k.startsWith("inbox.required."));
    expect(keys.length).toBeGreaterThan(20);
    expect(trKeys.sort()).toEqual([...keys].sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) {
      expect(en[k].length, k).toBeGreaterThan(0);
      expect(ph(tr[k]), k).toBe(ph(en[k]));
      if (!["inbox.required.transitionValue", "inbox.required.runValue"].includes(k)) expect(tr[k], `tr differs ${k}`).not.toBe(en[k]);
    }
  });
});

// //TR: LANE-A Founder dikkat kuyruğu (GET /v1/attention, Lane B): sıkı eşleme, bozuk öğe atma, sayaç/truncated doğrulaması, eski tüketicilere kayıpsız çeviri.
describe("LANE-A Founder attention core (GET /v1/attention)", () => {
  const item = (over: Record<string, any> = {}) => ({...ATT_ITEMS[1], ...over});
  const q = (items: any[], counts: any, truncated: any = false, over: Record<string, any> = {}) => ({attention: {items, counts, truncated, source: "WORKOS", ...over}});
  const c = async () => load("attention-core.js");
  it("exposes the server's severity order and the kind-to-action rule", async () => {
    const m = await c();
    expect(m.ATTENTION_PATH).toBe("/v1/attention");
    expect(m.ATTENTION_KINDS).toEqual(["RUN_AWAITING_APPROVAL", "MISSION_FOUNDER_ATTENTION", "RUN_NEEDS_DECISION", "MISSION_AUTHORIZATION_PENDING", "MISSION_BLOCKED", "TASK_BLOCKED"]);
    expect(m.ACTIONS_FOR_KIND).toEqual({RUN_AWAITING_APPROVAL: ["PREPARE_DELIVERY", "ACCEPT_DELIVERY"], MISSION_FOUNDER_ATTENTION: ["REVIEW_MISSION"], RUN_NEEDS_DECISION: ["REVIEW_RUN"], MISSION_AUTHORIZATION_PENDING: ["AUTHORIZE_MISSION"], MISSION_BLOCKED: ["REVIEW_MISSION"], TASK_BLOCKED: ["UNBLOCK_TASK"]});
    expect([...new Set(Object.values(m.ACTIONS_FOR_KIND).flat())].sort()).toEqual([...m.NEXT_ACTIONS].sort());
    expect(m.ATTENTION_MAX_ITEMS).toBe(200);
  });
  it("sorts by severity (server order kept inside a kind) and keeps the counters separate", async () => {
    const m = await c();
    const mixed = [item({kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", taskId: TSK, runId: null, title: "t1"}), item({title: "r1"}), item({kind: "MISSION_BLOCKED", nextAction: "REVIEW_MISSION", runId: null, title: "mb"}), item({title: "r2"}), item({kind: "RUN_AWAITING_APPROVAL", nextAction: "PREPARE_DELIVERY", title: "a"})];
    const r = m.mapAttentionQueue(q(mixed, attCounts({RUN_AWAITING_APPROVAL: 1, RUN_NEEDS_DECISION: 2, MISSION_BLOCKED: 1, TASK_BLOCKED: 1})));
    expect(r.state).toBe("VERIFIED"); expect(r.queue.items.map((i: any) => i.title)).toEqual(["a", "r1", "r2", "mb", "t1"]);
    expect(r.queue).toMatchObject({total: 5, truncated: false, dropped: 0, shownCounts: {RUN_NEEDS_DECISION: 2, TASK_BLOCKED: 1, MISSION_FOUNDER_ATTENTION: 0}});
  });
  it("drops (and counts) unknown kinds, kind/action mismatches and malformed items; keeps good ones", async () => {
    const m = await c();
    const drops: any[] = [item({kind: "NEW_KIND"}), item({nextAction: "ACCEPT_DELIVERY"}), item({nextAction: "NOPE"}), item({projectId: "prj_x"}), item({missionId: "msn_x"}), item({projectId: ["prj_" + "ab".repeat(12)]}), item({runId: ["run1"]}), item({runId: 5}), item({runId: undefined}),
      item({taskId: "tsk_x"}), item({taskId: 5}), item({kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", runId: null, taskId: null}), item({missionId: [MID]}), item({kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", runId: null, taskId: [TSK]}), item({taskId: [TSK]}), item({runId: null}), item({kind: "RUN_AWAITING_APPROVAL", nextAction: "PREPARE_DELIVERY", runId: null}), item({title: ""}), item({title: "   "}), item({title: "t".repeat(201)}), item({title: 5}),
      item({reason: ""}), item({reason: "r".repeat(301)}), item({reason: 5}), item({since: "yesterday"}), item({since: "2026-02-30T03:00:00Z"}), item({since: 5}), null, "x", [], 5];
    const r = m.mapAttentionQueue(q([item(), ...drops], attCounts({RUN_NEEDS_DECISION: 99})));
    expect(r.state).toBe("VERIFIED"); expect(r.queue.items).toHaveLength(1); expect(r.queue.dropped).toBe(drops.length);
    const ok = m.mapAttentionQueue(q([item({title: "t".repeat(200), reason: "r".repeat(300), since: "2026-10-22T03:00:00.123Z"}), item({reason: null, since: null, runId: "RUN-abc-1"})], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 2, TASK_BLOCKED: 0})));
    expect(ok.queue.items).toHaveLength(2); expect(ok.queue.dropped).toBe(0);
  });
  it("a bad envelope, counter set, truncated flag or source makes the whole read ERROR", async () => {
    const m = await c(), none = attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0});
    const bads: any[] = [null, [], {}, {attention: null}, {attention: []}, q([], none, false, {source: "SCHEDULER"}), q([], none, false, {source: undefined}), q([], none, "no"), {attention: {items: [], counts: none, source: "WORKOS"}}, q("x" as any, none), q({} as any, none),
      q([], null), q([], []), q([], {...none, EXTRA: 0}), q([], (({TASK_BLOCKED, ...r}) => r)(none)), q([], {...none, TASK_BLOCKED: "0"}), q([], {...none, TASK_BLOCKED: -1}), q([], {...none, TASK_BLOCKED: 1.5}), q([], {...none, TASK_BLOCKED: 1000001}), q([], {...none, TASK_BLOCKED: null}),
      q(Array.from({length: 201}, () => item()), attCounts({RUN_NEEDS_DECISION: 201}), true),
      q([item()], attCounts({RUN_NEEDS_DECISION: 0, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0})), q([item()], attCounts({RUN_NEEDS_DECISION: 1, RUN_AWAITING_APPROVAL: 1, TASK_BLOCKED: 0})), q([item()], attCounts({RUN_NEEDS_DECISION: 2, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0})),
      q([item()], attCounts({RUN_NEEDS_DECISION: 1, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}), true), q(Array.from({length: 200}, () => item()), attCounts({RUN_NEEDS_DECISION: 200, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}), true)];
    bads.forEach((b, i) => { const r = m.mapAttentionQueue(b); expect([i, r.state, r.queue]).toEqual([i, "ERROR", null]); });
    // a non-numeric counter is rejected even when a dropped item relaxes the sum rules
    expect(m.mapAttentionQueue(q([item(), item({kind: "NEW"})], {...attCounts({RUN_NEEDS_DECISION: 1, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}), MISSION_BLOCKED: "5"})).state).toBe("ERROR");
    expect(m.mapAttentionQueue(q([item(), item({kind: "NEW"})], {...attCounts({RUN_NEEDS_DECISION: 1, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}), MISSION_BLOCKED: -1})).state).toBe("ERROR");
    // truncated means exactly 200 shown and more than 200 in total
    expect(m.mapAttentionQueue(q(Array.from({length: 199}, () => item()), attCounts({RUN_NEEDS_DECISION: 199, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 101}), true)).state).toBe("ERROR");
    expect(m.mapAttentionQueue(q([], none)).state).toBe("VERIFIED");
    expect(m.mapAttentionQueue(q(Array.from({length: 200}, () => item()), attCounts({RUN_NEEDS_DECISION: 200, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 1}), true)).state).toBe("VERIFIED");
    expect(m.mapAttentionQueue(q([], {...none, TASK_BLOCKED: 1000000})).state).toBe("ERROR"); // 1000000 is a valid counter, but then the list must hold the items
    expect(m.mapAttentionQueue(q(Array.from({length: 200}, () => item()), attCounts({RUN_NEEDS_DECISION: 1000000, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}), true)).state).toBe("VERIFIED");
  });
  it("with dropped items the invariants relax, but a kind can never show more items than its counter says", async () => {
    const m = await c();
    expect(m.mapAttentionQueue(q([item(), item({kind: "NEW"})], attCounts({RUN_NEEDS_DECISION: 5, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}))).state).toBe("VERIFIED");
    expect(m.mapAttentionQueue(q([item(), item(), item({kind: "NEW"})], attCounts({RUN_NEEDS_DECISION: 1, RUN_AWAITING_APPROVAL: 0, TASK_BLOCKED: 0}))).state).toBe("ERROR");
  });
  it("translates items to the legacy blocker row without losing kind or reason and never grants retry", async () => {
    const m = await c();
    expect(m.attentionAsBlocked(item())).toEqual({packageId: "run_" + "cd".repeat(12), kind: "RUN_NEEDS_DECISION", reason: "Claude quota exhausted", at: "2026-10-15T08:00:00.000Z", retryable: false, nextAction: "REVIEW_RUN", missionId: MID2});
    expect(m.attentionAsBlocked(item({kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", taskId: TSK, runId: null})).packageId).toBe(TSK);
    expect(m.attentionAsBlocked(item({kind: "MISSION_BLOCKED", nextAction: "REVIEW_MISSION", runId: null, taskId: null})).packageId).toBe(MID2);
  });
  it("the api serves legacy consumers and the full queue from the new path only; a refused path is UNAVAILABLE", async () => {
    const apiMod = await load("api.js"), st = await load("state.js");
    const mk = (fn: (p: string) => any) => { const calls: string[] = []; return {calls, api: apiMod.createApi({bridge: {apiGet: async (p: string) => { calls.push(p); return fn(p); }}, store: st.createStore(null)})}; };
    const ok = mk(() => attention()); const r = await ok.api.attention();
    expect(ok.calls).toEqual(["/v1/attention"]); expect(r.state).toBe("VERIFIED"); expect(r.blocked).toHaveLength(3); expect(r.queue.total).toBe(3); expect(r.blocked.every((b: any) => b.retryable === false)).toBe(true);
    const refused = await mk(() => { throw new Error("INVALID_API_PATH"); }).api.attention(); expect(refused).toMatchObject({state: "UNAVAILABLE", blocked: [], queue: null});
    const miss = await mk(() => { throw new Error("x: HTTP 404"); }).api.attention(); expect(miss).toMatchObject({state: "UNAVAILABLE", blocked: [], queue: null});
    const bad = await mk(() => ({attention: {items: [], counts: {}, truncated: false, source: "WORKOS"}})).api.attention(); expect(bad).toMatchObject({state: "ERROR", blocked: [], queue: null});
    const off = await mk(() => { throw new Error("fetch failed"); }).api.attention(); expect(off.state).toBe("OFFLINE");
  });
  it("en and tr have the same attention keys and placeholders; every kind and action has a label", async () => {
    const en = (await load("locales", "en.js")).default as Record<string, string>, tr = (await load("locales", "tr.js")).default as Record<string, string>, m = await c();
    const keys = Object.keys(en).filter(k => k.startsWith("attention."));
    const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) { expect(tr[k], k).toBeTruthy(); expect(ph(tr[k]), k).toBe(ph(en[k])); }
    expect(Object.keys(tr).filter(k => k.startsWith("attention.")).sort()).toEqual([...keys].sort());
    for (const k of m.ATTENTION_KINDS) expect(en[`attention.kind.${k}`], k).toBeTruthy();
    for (const a of m.NEXT_ACTIONS) { expect(en[`attention.next.${a}`], a).toBeTruthy(); expect(tr[`attention.next.${a}`], a).toBeTruthy(); }
  });
});

// //TR: #192 incelemesi (HIGH/MED): kuyruk özeti sunucu sayaçlarından gelir; kesik ya da okunamayan öğe asla "boş/VERIFIED" okunmaz; Gelen Kutusu şeridi, Teslimat ve Tower aynı özeti kullanır; eski kopya liste kalktı; öğe türleri ham kod değil etiket gösterir.
describe("LANE-A attention consumers: honest summary in Inbox strip, Delivery and Tower (review #192)", () => {
  const cmod = () => load("attention-core.js");
  const big = (n: number) => Array.from({length: n}, (_, i) => ({...ATT_ITEMS[2], taskId: "tsk_" + (i + 1).toString(16).padStart(24, "a")}));
  const truncatedFix = () => liveFix({"/v1/attention": attention(big(200), attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 201}), true)});
  const droppedFix = () => liveFix({"/v1/attention": attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 1, TASK_BLOCKED: 0}))});
  const delFix = (att: any) => ({"/health": {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"}, "/v1/control/status": {globalStop: {active: false, reason: null}}, "/v1/attention": att, "/v1/work-runs": {workRuns: []}});
  it("attentionSummary uses the server counters: complete+empty is VERIFIED, truncated or dropped is never empty, unreadable is UNREADABLE", async () => {
    const c = await cmod();
    const q = (raw: any) => c.mapAttentionQueue(raw);
    expect(c.attentionSummary(q(attention([], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0}))))).toMatchObject({kind: "VERIFIED", total: 0, shown: 0, truncated: false, dropped: 0});
    expect(c.attentionSummary(q(attention())).kind).toBe("ATTENTION");
    expect(c.attentionSummary(q(attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 1, TASK_BLOCKED: 0}))))).toMatchObject({kind: "ATTENTION", total: 1, shown: 0, dropped: 1});
    expect(c.attentionSummary(q(attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0}))))).toMatchObject({kind: "ATTENTION", total: 0, dropped: 1}); // inconsistent server: still not empty
    expect(c.attentionSummary(q(attention(big(200), attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 250}), true)))).toMatchObject({kind: "ATTENTION", total: 250, shown: 200, truncated: true});
    for (const bad of [null, undefined, {state: "OFFLINE"}, {state: "VERIFIED", queue: null}]) expect(c.attentionSummary(bad).kind).toBe("UNREADABLE");
  });
  it("the Inbox source strip says ATTENTION (never VERIFIED) when every item is unreadable or the list is truncated", async () => {
    const inbox = await load("views", "inbox.js");
    for (const fix of [droppedFix(), truncatedFix()]) { const {ctx} = await mkCtx({get: fromFix(fix), lang: "en"}); expect(sourceState(await inbox.render(ctx), "attention")).toBe("ATTENTION"); }
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/attention": attention([], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0}))})), lang: "en"});
    expect(sourceState(await inbox.render(ctx), "attention")).toBe("VERIFIED");
  });
  it("tr: Delivery and Inbox use the Turkish noun and the exact-count truncation text (no 'En az', no 'mission' noun) for a truncated list", async () => {
    const delivery = await load("views", "delivery.js"), inbox = await load("views", "inbox.js");
    const fx = attention(big(200), attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 250}), true);
    const d = await mkCtx({get: fromFix(delFix(fx)), lang: "tr"}); const line = byId(await delivery.render(d.ctx), "delivery-attention-status")!;
    expect(line.textContent).toContain("250 öğe Founder dikkatini bekliyor"); expect(line.textContent).toContain("görevler, koşular ve missionlar"); expect(line.textContent).toContain("250 öğeden 200 tanesi gösteriliyor"); expect(line.textContent).not.toMatch(/En az|en az/);
    const i = await mkCtx({get: fromFix(liveFix({"/v1/attention": fx})), lang: "tr"}); const panel = byId(await inbox.render(i.ctx), "inbox-attention-queue")!;
    expect(panel.textContent).toContain("250 öğeden 200 tanesi gösteriliyor"); expect(panel.textContent).not.toMatch(/En az|en az/); expect(byData(panel, "attentionCount")[0].textContent).toContain("250 öğe Founder dikkati bekliyor");
  });
  it("Delivery shows the server's total with the right noun for a truncated list (201 tasks), never the shown count as 'missions'", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx({get: fromFix(delFix(attention(big(200), attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 201}), true))), lang: "en"});
    const root = await delivery.render(ctx), line = byId(root, "delivery-attention-status")!;
    expect(line.dataset.attention).toBe("201"); expect(line.textContent).toContain("201 item(s) are awaiting Founder attention"); expect(line.textContent).not.toContain("mission(s)"); expect(line.textContent).not.toContain("200 item(s)");
    expect(line.textContent).toContain("Showing 200 of 201 items"); expect(sourceState(root, "attention")).toBe("ATTENTION");
    for (const lang of ["en", "tr"]) { const lead = (await load("locales", `${lang}.js`).then(m => m.default as Record<string, string>))["delivery.health.lead"]; expect(lead, lang).toContain("/v1/attention"); expect(lead, lang).not.toContain("founder-attention"); } // the strip names the live source
  });
  it("Delivery never says 'none' while the server counts items that could not be read", async () => {
    const delivery = await load("views", "delivery.js");
    const {ctx} = await mkCtx({get: fromFix(delFix(attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 1, TASK_BLOCKED: 0})))), lang: "en"});
    const root = await delivery.render(ctx), line = byId(root, "delivery-attention-status")!;
    expect(line.textContent).not.toContain("No Founder-attention items"); expect(line.textContent).toContain("1 item(s) are awaiting Founder attention"); expect(line.textContent).toContain("1 item(s) from the server could not be read"); expect(sourceState(root, "attention")).toBe("ATTENTION");
    // a server that counts none but sends an item we cannot read: still not "none"
    const odd = await mkCtx({get: fromFix(delFix(attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0})))), lang: "en"});
    const orow = byId(await delivery.render(odd.ctx), "delivery-attention-status")!;
    expect(orow.textContent).not.toContain("No Founder-attention items"); expect(orow.textContent).toContain("counted items awaiting Founder attention that could not be read");
    const empty = await mkCtx({get: fromFix(delFix(attention([], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0})))), lang: "en"});
    const er = await delivery.render(empty.ctx); expect(byId(er, "delivery-attention-status")!.textContent).toContain("No Founder-attention items"); expect(sourceState(er, "attention")).toBe("VERIFIED");
  });
  it("the legacy blocker rows show a label for every attention kind in en and tr (no raw TASK_BLOCKED), and the Inbox lists the items once (no 'legacy scheduler snapshot' copy)", async () => {
    const comp = await load("components.js"), i18n = await load("i18n.js"), c = await cmod();
    for (const lang of ["en", "tr"]) {
      const t = (k: string, v?: any) => i18n.translate(lang, k, v);
      for (const k of c.ATTENTION_KINDS) { const lab = comp.statusLabel({t}, k); expect(lab, `${lang} ${k}`).toBe(t(`attention.kind.${k}`)); expect(lab).not.toBe(k); }
    }
    const inbox = await load("views", "inbox.js");
    const {ctx} = await mkCtx({get: fromFix(liveFix()), lang: "en"});
    const root = await inbox.render(ctx);
    expect(byId(root, "inbox-legacy-p")).toBeNull(); expect(byId(root, "inbox-attention")).toBeNull(); expect(root.textContent).not.toMatch(/legacy scheduler|LEGACY_SNAPSHOT/i);
    expect(all(root).filter(n => n.textContent === "Engelli görev" && n.tagName === "H3").length).toBe(1);
    expect(read("views", "inbox.js").split("\n")[0]).not.toMatch(/Legacy blocker listesi \(yeniden deneme eylemiyle\) değişmeden korunur/); // the header no longer promises the removed legacy list / retry action
  });
  it("Tower says the list is cut or partly unreadable, and never 'no pending blockers' when the server counted unreadable items", async () => {
    const tower = await load("views", "tower.js");
    const run = async (fix: any) => { const {ctx} = await mkCtx({get: (p: string) => { if (p in fix) return fix[p]; throw new Error(`${p}: HTTP 404`); }, lang: "en"}); ctx.requestStop = () => {}; ctx.requestResume = () => {}; ctx.renderAttention = (el: N, att: any) => { el.textContent = att.blocked.length ? `${att.blocked.length} rows` : "No pending blockers."; }; return byId(await tower.render(ctx), "tower-attention")!; };
    const cut = await run({"/v1/attention": attention(big(200), attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 250}), true)});
    expect(byData(cut, "attentionTruncated")).toHaveLength(1); expect(cut.textContent).toContain("Showing 200 of 250 items");
    const drop = await run({"/v1/attention": attention([{kind: "NEW"}], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 1, TASK_BLOCKED: 0}))});
    expect(drop.textContent).not.toContain("No pending blockers"); expect(drop.textContent).toContain("could not be read"); expect(byData(drop, "attentionDropped")).toHaveLength(1);
    const none = await run({"/v1/attention": attention([], attCounts({RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, TASK_BLOCKED: 0}))});
    expect(none.textContent).toContain("No pending blockers"); expect(byData(none, "attentionTruncated")).toEqual([]);
  });
});
