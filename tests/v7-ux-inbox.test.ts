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

  // //TR: founder-attention 404 ise kuyruk kalemi uydurulmaz ve kaynak VERIFIED değildir.
  it("founder-attention 404 shows no items and is not VERIFIED", async () => {
    const inbox = await load("views", "inbox.js");
    const fix = liveFix(); delete fix["/v1/founder-attention"];
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
    const {ctx} = await mkCtx({get: fromFix(liveFix({"/v1/founder-attention": {blocked: [{packageId: evil, phase: 1, kind: "K", reason: evil, at: "2026-10-15T09:00:00.000Z", retryable: false}], schedulerVerification: "VERIFIED"}})), lang: "en"});
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
