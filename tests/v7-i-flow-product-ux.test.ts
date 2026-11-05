// UASCO-T0007 (Builder I): flow card + product card UX honesty.
// (1) A RUN stage whose latest run is AWAITING_APPROVAL is shown as "Awaiting approval", not "Blocked"; real blocks stay "Blocked".
// (2) "Start product" is disabled with a visible reason when the server reports the sandbox as UNAVAILABLE; enabled otherwise (positive control).
import {describe, it, expect} from "vitest";
import path from "node:path";
import {pathToFileURL} from "node:url";

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = "";
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  addEventListener() { /* not needed */ }
}
class D {
  body: N; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (root: N, id: string) => all(root).find(n => n.id === id);
const byData = (root: N, k: string, v?: string) => all(root).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));

async function ctxFor(lang: "en" | "tr", api: Record<string, any>) {
  const i18n = await load("i18n.js");
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  return {doc: new D(), t, i18n: {lang, t}, api, rerender: async () => {}, confirm: async () => false, navigate: () => {}, settleFocus: () => {}} as any;
}

// ---------------- (1) flow card ----------------
const PID = "prj_" + "11".repeat(12), RID = "run_" + "22".repeat(12);
const flowBody = (runState: string, runDetail: string | null) => ({flow: {projectId: PID, missionCount: 1, taskCount: 1, latestRunId: RID, stages: [
  {stage: "MISSION", state: "ACTIVE", detail: "REPORTING"}, {stage: "PLAN", state: "DONE", detail: "1/1 DONE"},
  {stage: "RUN", state: runState, detail: runDetail}, {stage: "REVIEW", state: "DONE", detail: "CLEAN_REVIEW_FOR_HEAD"},
  {stage: "DELIVERY", state: "NOT_STARTED", detail: null}]}});

async function renderFlow(lang: "en" | "tr", body: unknown) {
  const fp = await load("views", "flow-panel.js");
  const ctx = await ctxFor(lang, {raw: async () => ({ok: true, data: body})});
  const root = await fp.flowPanel(ctx, PID);
  const li = byData(root, "flowStage", "RUN")!;
  const badge = all(li).find(n => n.className.split(/\s+/).includes("badge"))!;
  return {li, badge};
}

describe("flow card: an AWAITING_APPROVAL run is not shown as Blocked", () => {
  it("pure core: flowDisplayState maps only RUN+BLOCKED+AWAITING_APPROVAL; everything else keeps the server state", async () => {
    const c = await load("project-core.js");
    expect(c.flowDisplayState({stage: "RUN", state: "BLOCKED", detail: "AWAITING_APPROVAL/REPORT"})).toBe("AWAITING_APPROVAL");
    for (const d of ["BLOCKED/IMPLEMENT", "HANDOFF_PENDING/IMPLEMENT", "DEGRADED/VERIFY", null, "", "AWAITING_APPROVAL", "AWAITING_APPROVALX/REPORT", "awaiting_approval/report"])
      expect(c.flowDisplayState({stage: "RUN", state: "BLOCKED", detail: d}), String(d)).toBe("BLOCKED");
    // the server state wins: an AWAITING_APPROVAL detail on another state, or on another stage, is never re-labelled
    expect(c.flowDisplayState({stage: "RUN", state: "ACTIVE", detail: "AWAITING_APPROVAL/REPORT"})).toBe("ACTIVE");
    expect(c.flowDisplayState({stage: "MISSION", state: "BLOCKED", detail: "AWAITING_APPROVAL/REPORT"})).toBe("BLOCKED");
  });
  it("view (en): AWAITING_APPROVAL -> 'Awaiting approval' badge, not the risk colour; the raw server state is kept in data-flow-state", async () => {
    const {li, badge} = await renderFlow("en", flowBody("BLOCKED", "AWAITING_APPROVAL/REPORT"));
    expect(badge.textContent).toBe("Awaiting approval");
    expect(badge.className).not.toContain("badge-risk");
    expect(li.dataset.flowState).toBe("BLOCKED");
    expect(li.dataset.flowDisplayState).toBe("AWAITING_APPROVAL");
  });
  it("view (tr): the same state is localised", async () => {
    const {badge} = await renderFlow("tr", flowBody("BLOCKED", "AWAITING_APPROVAL/REPORT"));
    expect(badge.textContent).toBe("Onay bekliyor");
  });
  it("positive control: a really BLOCKED run is still 'Blocked' in the risk colour", async () => {
    const {li, badge} = await renderFlow("en", flowBody("BLOCKED", "BLOCKED/IMPLEMENT"));
    expect(badge.textContent).toBe("Blocked");
    expect(badge.className).toContain("badge-risk");
    expect(li.dataset.flowDisplayState).toBe("BLOCKED");
  });
});

// ---------------- (2) product card ----------------
const HEAD = "a".repeat(40);
const dv = {status: "STOPPED", pid: null, port: null, preview: {state: "UNAVAILABLE", url: null}, logTail: "", deliveryRunId: null, bridged: null};
async function renderProduct(lang: "en" | "tr", sandbox: unknown) {
  const core = await load("project-core.js"), pc = await load("views", "product-card.js");
  const product = core.mapRunProduct({product: {runId: RID, deliveredHeadSha: HEAD, devrun: dv, tiedToThisRun: false}}, RID);
  expect(product.state).toBe("VERIFIED");
  const ctx = await ctxFor(lang, {
    runProduct: async () => product,
    workRunDetail: async () => ({state: "VERIFIED", run: {delivery: {sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE"}}}}),
    executors: async () => (sandbox === undefined ? {state: "ERROR"} : {state: "VERIFIED", sandbox})
  });
  const card = await pc.productCard(ctx, {projectId: PID, name: "P"}, {runId: RID});
  return {card, start: byId(card, "product-start")};
}

describe("product card: Start is disabled with a visible reason when the server reports the sandbox UNAVAILABLE", () => {
  it("UNAVAILABLE (en): Start is shown, disabled, described by a visible reason naming SANDBOX_UNAVAILABLE", async () => {
    const {card, start} = await renderProduct("en", {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE"});
    expect(card.dataset.productOffer).toBe("START"); // the route's own condition still offers it
    expect(start).toBeDefined();
    expect(start!.hasAttribute("disabled")).toBe(true);
    expect(start!.dataset.productStartBlocked).toBe("SANDBOX_UNAVAILABLE");
    const why = byId(card, "product-start-why")!;
    expect(why).toBeDefined();
    expect(start!.getAttribute("aria-describedby")).toBe("product-start-why");
    expect(why.textContent).toContain("SANDBOX_UNAVAILABLE");
    expect(why.textContent).toContain("Start is disabled");
  });
  it("UNAVAILABLE (tr): the reason is localised", async () => {
    const {card} = await renderProduct("tr", {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE"});
    expect(byId(card, "product-start-why")!.textContent).toContain("SANDBOX_UNAVAILABLE");
    expect(byId(card, "product-start-why")!.textContent).toContain("devre dışı");
  });
  it("positive control: AVAILABLE -> Start enabled, no disabled reason", async () => {
    const {card, start} = await renderProduct("en", {state: "AVAILABLE", providerId: "docker"});
    expect(start!.hasAttribute("disabled")).toBe(false);
    expect(start!.dataset.productStartBlocked).toBeUndefined();
    expect(byId(card, "product-start-why")).toBeUndefined();
  });
  it("UNKNOWN sandbox (executors read failed): Start stays enabled; the server decides (no guess either way)", async () => {
    const {card, start} = await renderProduct("en", undefined);
    expect(start!.hasAttribute("disabled")).toBe(false);
    expect(byId(card, "product-start-why")).toBeUndefined();
  });
});
