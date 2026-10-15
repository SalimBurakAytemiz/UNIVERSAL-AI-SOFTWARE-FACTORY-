// //TR: Bu test INT-R3 masaüstü düzeltmelerini doğrular: D-M1-07 kanonik rol sayıları (eski 363 kayıt "kayıtlı rol" diye gösterilmez, yalnız LEGACY_REFERENCE_ONLY notu) ve SBX-GATE'in dürüst BLOCKED/SANDBOX_UNAVAILABLE gösterimi (koşu kartı nedeni, dev-run 409 iletisi); gerçek görünüm modülleri sahte DOM ile çalıştırılır.
import {describe, it, expect} from "vitest";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(...p)).href);

// ---------- Sahte DOM (B5 testindeki en küçük biçim) ----------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; open = false; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
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
  focus() { this.doc.focused = this; }
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  get activeElement(): N { return this.focused && this.body.contains(this.focused) ? this.focused : this.body; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const byData = (r: N, k: string) => all(r).filter(n => k in n.dataset);

async function mkCtx(get: (p: string) => any, lang = "en") {
  const apiMod = await load(rend, "api.js"), st = await load(rend, "state.js"), i18n = await load(rend, "i18n.js");
  const doc = new D(), store = st.createStore(null);
  const bridge = {apiGet: async (p: string) => { const r = get(p); if (r === undefined) throw new Error(`${p}: HTTP 404`); return r; }, apiPost: async () => { throw new Error("CONTROL_API_UNREACHABLE"); }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate() {}, rerender: async () => {}, refreshAll: async () => {}, confirm: async () => false, selectProject() {}, renderAttention() {}, principal: "FOUNDER_LOCAL"};
  return {ctx, doc};
}
const mount = (doc: D, node: N) => { doc.body.replaceChildren(node); return node; };

// Entegre sunucunun gerçek şekli (WFR-03): count = eski 363 kayıt, registeredRoles = kanonik 599.
const AGENTS = {count: 363, agents: [], registeredRoles: 599, legacyRoles: 363, certified: 0, roleRegistry: {authority: "CANONICAL", legacyAuthority: "LEGACY_REFERENCE_ONLY"}};
const COCKPIT = {generatedAt: "2026-10-15T00:00:00.000Z", workforce: {state: "VERIFIED", registeredRoles: 363, registeredRolesAuthority: "LEGACY_REFERENCE_ONLY", canonicalRegisteredRoles: 599, targetRoles: 599, activeWorkerRuns: 0, source: "S"}};

describe("INT-R3 D-M1-07 canonical role counts in the desktop", () => {
  it("maps the cockpit workforce tile to the canonical count and keeps the labelled legacy count out of 'registered roles'", async () => {
    const m = await load(rend, "model.js");
    const c = m.mapCockpit(COCKPIT);
    expect(c.workforce.registeredRoles).toBe(599);
    expect(c.workforce.value).toBe(599);
    expect(c.workforce.legacyRoles).toBe(363);
    // canonical missing + legacy labelled: no number is invented and 363 is never shown as registered
    const n = m.mapCockpit({workforce: {...COCKPIT.workforce, canonicalRegisteredRoles: null}});
    expect(n.workforce.registeredRoles).toBeNull();
    expect(n.workforce.legacyRoles).toBe(363);
  });
  it("reads registeredRoles/certified from GET /v1/agents and never uses the legacy count as the registered count", async () => {
    const {ctx} = await mkCtx(p => (p === "/v1/agents" ? AGENTS : undefined));
    expect(await ctx.api.agentCount()).toEqual({state: "VERIFIED", count: 599, registeredRoles: 599, certified: 0, legacyRoles: 363});
    const {ctx: legacyOnly} = await mkCtx(p => (p === "/v1/agents" ? {count: 363} : undefined));
    expect((await legacyOnly.api.agentCount()).registeredRoles).toBeNull();
  });
  it("workforce screen shows 599 registered, the certified count and 363 only as a LEGACY_REFERENCE_ONLY note", async () => {
    const {ctx, doc} = await mkCtx(p => (p === "/v1/agents" ? AGENTS : p === "/v1/cockpit" ? COCKPIT : p === "/v1/work-runs" ? {workRuns: []} : undefined));
    const view = await load(rend, "views", "workforce.js");
    const r = mount(doc, await view.render(ctx, {id: "workforce", plannedPackage: "B3"}));
    const reg = byId(r, "wf-reg")!;
    expect(reg.textContent).toContain("599");
    expect(reg.textContent).toContain("Certified: 0");
    const legacy = byData(reg, "legacyReference");
    expect(legacy).toHaveLength(1);
    expect(legacy[0].textContent).toContain("363");
    expect(legacy[0].textContent).toContain("LEGACY_REFERENCE_ONLY");
    expect(all(reg).find(n => n.className === "kpi-value")!.textContent).toBe("599");
  });
  it("control tower role registry fact shows registered/certified/legacy separately (WFR-03 intent of the superseded app.js line)", async () => {
    const {ctx, doc} = await mkCtx(p => (p === "/v1/agents" ? AGENTS : undefined));
    const view = await load(rend, "views", "tower.js");
    const r = mount(doc, await view.render(ctx));
    const fact = all(r).find(n => n.dataset.fact === "tower.agents")!;
    expect(fact.textContent).toContain("599 registered · 0 certified · 363 legacy reference");
  });
  it("home cockpit tile renders the canonical registered count", async () => {
    const m = await load(rend, "model.js");
    const c = m.mapCockpit(COCKPIT);
    expect(c.workforce.registeredRoles).not.toBe(363);
  });
});

describe("INT-R3 SBX-GATE honest BLOCKED reason in the desktop", () => {
  it("maps 409 SANDBOX_UNAVAILABLE to an explicit message in both languages (not the generic conflict text)", async () => {
    const core = await load(rend, "work-core.js");
    const d = core.describePostResult({status: 409, body: {error: "SANDBOX_UNAVAILABLE", reason: "NO_VERIFIED_PROVIDER"}});
    expect(d).toEqual({ok: false, key: "post.err.409.SANDBOX_UNAVAILABLE", vars: {status: 409}});
    for (const lang of ["en", "tr"]) {
      const dict = (await load(rend, "locales", `${lang}.js`)).default as Record<string, string>;
      expect(dict["post.err.409.SANDBOX_UNAVAILABLE"]).toContain("SANDBOX_UNAVAILABLE");
      expect(dict["run.reason.SANDBOX_UNAVAILABLE"].length).toBeGreaterThan(20);
      expect(dict["run.reason"].length).toBeGreaterThan(0);
    }
  });
  it("the run card shows the BLOCKED status with the SANDBOX_UNAVAILABLE reason and explanation; runs without a reason show no reason row", async () => {
    const core = await load(rend, "work-core.js"), work = await load(rend, "views", "work.js");
    const {ctx, doc} = await mkCtx(() => undefined);
    const blocked = core.mapWorkRun({runId: "run_0123456789abcdef01234567", missionId: "msn_" + "ab12".repeat(6), status: "BLOCKED", step: "VERIFY", reason: "SANDBOX_UNAVAILABLE", evidence: [{evidenceId: "evd_0123456789ab", kind: "VERIFY_TESTS_NOT_EXECUTED"}], checkpoints: []});
    expect(blocked.reason).toBe("SANDBOX_UNAVAILABLE");
    const card = mount(doc, work.runCard(ctx, blocked));
    expect(card.dataset.runStatus).toBe("BLOCKED");
    const dd = all(card).find(n => n.dataset.runReason === "SANDBOX_UNAVAILABLE")!;
    expect(dd.textContent).toContain("SANDBOX_UNAVAILABLE — no verified sandbox is available");
    expect(card.textContent).toContain("VERIFY_TESTS_NOT_EXECUTED");
    const clean = core.mapWorkRun({runId: "run_0123456789abcdef01234568", status: "RUNNING", checkpoints: []});
    expect(clean.reason).toBeNull();
    expect(all(mount(doc, work.runCard(ctx, clean))).some(n => "runReason" in n.dataset)).toBe(false);
  });
});
