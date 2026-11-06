// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-wp-workos.test.ts tarafından içe aktarılır) UASCO-T0006 alt panel uzantısıdır (Builder I): rotası olmayan ve yalnız sahte köprüyle sınanan beş alt paneli (proje bilgisi, ilk koşu hazırlığı, yürütme motoru, araç hazırlığı, yürütücüler + yönlendirme) gerçek buildServer'a karşı main.mjs'in gerçek izin listesi ve kimlik el sıkışmasıyla sınar: mutlu yol (sunucu verisinden türetilmiş öznitelik denetimi), her /v1 okumasının 500 döndüğü yol ve belirteç uyuşmazlığı (403). İddialar metne değil sınıflanmış durumlara ve data-* özniteliklerine dayanır.
// Local bridge on purpose (mirrors main.mjs and tests/support/renderer-real-server.cases.ts); Builder G's shared tests/support/real-bridge.ts is not on main yet and will fold this in later.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import crypto from "node:crypto";
import {controlChallengeProof, desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), WRONG = "w".repeat(32), RECORDER = "implementer@local.invalid";
// //TR: #318 incelemesi N1a: renderer okumalarını main.mjs'in uasco:api-get işleyicisi süzer (desktopGetPathAllowed || desktopExtraGetPathAllowed). İkincisi korumalı main.mjs'in
// B4-ALLOWLIST bloğundadır ve dışa aktarılmaz: main.mjs DEĞİŞTİRİLMEDEN blok okunup değerlendirilir (tests/v7-ux-shell.test.ts ile aynı yöntem).
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const allowBlock = (() => { const a = MAIN_SRC.indexOf("// B4-ALLOWLIST-BEGIN"), b = MAIN_SRC.indexOf("// B4-ALLOWLIST-END"); if (a < 0 || b < 0) throw new Error("main.mjs B4-ALLOWLIST block not found"); return MAIN_SRC.slice(a, b); })();
const desktopExtraGetPathAllowed = new Function(`${allowBlock}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const desktopAllows = (p: string) => desktopGetPathAllowed(p) || desktopExtraGetPathAllowed(p);
// //TR: N1b: üretimde /health gövdesi sunucudan değil main.mjs'ten gelir (kimlik doğrulandıktan sonra sabit nesne); köprü bunu aynen taklit eder.
const SYNTHETIC_HEALTH = {status: "HEALTHY", system: "UNIVERSAL-AI-SOFTWARE-COMPANY-OS", serverIdentity: "VERIFIED"};
const PROJECT = "UASCO-T0006 subpanel project", MISSION = "UASCO-T0006 subpanel mission";

// ---------------- minimal DOM (diğer renderer testleriyle aynı desen) ----------------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = "";
  ls = new Map<string, Array<(e: unknown) => void>>(); style: Record<string, string> = {}; hidden = false; value = ""; checked = false; disabled = false;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string | null | undefined>) { for (const c of n) { if (c === null || c === undefined) continue; const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  prepend(...n: Array<N | string>) { this.append(...n); }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: unknown) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  focus() { /* test double */ }
  scrollIntoView() { /* test double */ }
  remove() { /* test double */ }
  get classList() { const s = this; return {add: (c: string) => { s.className = `${s.className} ${c}`.trim(); }, remove: () => undefined, toggle: () => undefined, contains: (c: string) => s.className.split(/\s+/).includes(c)}; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
class D {
  body: N; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById() { return null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const kpiText = (r: N, key: string) => all(r).find(n => n.dataset.kpi === key)?.textContent ?? `<no kpi ${key}>`;
// hata işaretleri: ortak durum notları (note-error / note-failed) ve Company OS kaynak durumları
const failureMarks = (r: N) => all(r).filter(n => /\bnote-(error|failed|offline)\b/.test(n.className) || ["ERROR", "OFFLINE"].includes(n.dataset.companyState ?? "")).map(n => `${n.className}|${n.dataset.companyState ?? ""}`);

type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];

let PID = "";
function seed(dataDir: string) {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: PROJECT, environmentId: "env-dev", createdBy: RECORDER});
  PID = p.projectId;
  store.createMission({tenantId: "tA", projectId: p.projectId, title: MISSION, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
  store.createMission({tenantId: "tA", projectId: p.projectId, title: `${MISSION} 2`, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R2", createdBy: RECORDER});
}
function mkApp(): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  seed(dataDir);
  // repoRoot = depo: rol kataloğu ve kanıt okumaları gerçek kaynaktan gelir (salt okunur; yazılar runtime/dataDir'e gider)
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
const serverJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}}); expect(r.statusCode, url).toBe(200); return r.json(); };


/** main.mjs uasco:api-get ile aynı sözleşme (renderer-real-server.cases.ts ile birebir): izin listesi, belirtece bağlı kimlik el sıkışması, sabit /health, `${yol}: HTTP ${durum}`. */
async function mkCtx(app: App, token = TOKEN) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{path: string; status: number}> = [], refused: string[] = [], thrown: string[] = [];
  const verifyServerIdentity = async () => {
    const challenge = crypto.randomBytes(32).toString("hex"), expected = controlChallengeProof(token, challenge);
    const r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    if (r.statusCode !== 200) throw new Error(`health: HTTP ${r.statusCode}`);
    const h = r.json();
    if (h.status !== "HEALTHY" || h.system !== "UNIVERSAL-AI-SOFTWARE-COMPANY-OS" || h.bindHost !== "127.0.0.1" || Number(h.port) !== 3210 || !expected || String(h.controlProof ?? "") !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const bridge = {apiGet: async (p: string) => {
    try {
      if (!desktopAllows(p)) { refused.push(p); throw new Error("INVALID_API_PATH"); }
      await verifyServerIdentity();
      if (p === "/health") { seen.push({path: p, status: 200}); return {...SYNTHETIC_HEALTH}; }
      const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": token, host: "127.0.0.1:3210"}});
      seen.push({path: p, status: r.statusCode});
      if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    } catch (e) { thrown.push(`${p} -> ${(e as Error).message}`); throw e; }
  }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  const ctx: Record<string, unknown> = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, rerender: async () => undefined, refreshAll: async () => undefined,
    settleFocus: () => undefined, confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  const results = async () => { const entries = [...store.cache.entries()] as Array<[string, {promise?: Promise<{ok: boolean; state?: string; message?: string}>}]>;
    for (const [k, v] of entries) if (!v || typeof v.promise?.then !== "function") throw new Error(`renderer store.cache shape changed at ${k}`);
    return Promise.all(entries.map(async ([k, v]) => ({path: k, ...(await v.promise!)}))); };
  return {ctx, doc, api, seen, refused, thrown, results};
}
type Ctx = Awaited<ReturnType<typeof mkCtx>>;
// Her alt panel: gerçek okumalardan sonra kökü üretir (async panel doğrudan çağrılır; senkron panel önce kendi okumasını alır, üst görünümün yaptığı gibi).
const PANELS: Record<string, (c: Ctx) => Promise<N>> = {
  knowledge: async c => (await load("views", "knowledge-panel.js")).knowledgePanel(c.ctx, PID),
  readiness: async c => (await load("views", "run-readiness.js")).runReadinessBlock(c.ctx, PID),
  engine: async c => (await load("views", "run-engine.js")).runEngineBlock(c.ctx, await c.api.executors()),
  tools: async c => (await load("views", "tools-panel.js")).toolsPanel(c.ctx, {ready: await c.api.rolesReadiness()}),
  executors: async c => { const m = await load("views", "executors-panel.js"); const r = new N(c.doc, "div"); r.append(await m.executorsPanel(c.ctx), await m.routingPanel(c.ctx)); return r; },
};
const nodes = (r: N) => [r, ...all(r)];
const ds = (r: N, k: string) => nodes(r).filter(n => n.dataset[k] !== undefined).map(n => n.dataset[k]);
const noteError = (r: N) => nodes(r).some(n => /\bnote-error\b/.test(n.className));
// Her panelin okuduğu yollar (proje kimliği yer tutucusuyla).
const PATHS: Record<string, string[]> = {
  knowledge: ["/v1/projects/:pid/knowledge"], readiness: ["/v1/projects/:pid/readiness"], engine: ["/v1/system/executors"],
  tools: ["/v1/roles/status-summary"], executors: ["/v1/adapters", "/v1/capabilities", "/v1/system/executors"],
};
const pathsOf = (c: Ctx) => [...new Set(c.seen.map(s => s.path.replace(/\?.*$/, "").replace(PID, ":pid")))].sort();
// Hata yolunda panelin sınıflanmış işareti (metinden bağımsız): ya panel kendi ERROR/UNKNOWN durumunu yazar ya da veri bölümü hiç çizilmez.
const FAILED: Record<string, (r: N) => void> = {
  knowledge: r => { expect(ds(r, "knowledgeSection")).toEqual([]); },
  readiness: r => { expect(ds(r, "runReadiness")).toEqual(["ERROR"]); expect(ds(r, "readyCheck")).toEqual([]); },
  engine: r => { expect(ds(r, "runEngine")).toEqual(["UNKNOWN"]); expect(ds(r, "engineSandbox")).toEqual(["UNKNOWN"]); expect(ds(r, "engineBlocker")).toEqual([]); },
  tools: r => { expect(ds(r, "toolsFact")).toEqual([]); expect(ds(r, "toolsState")).toEqual([]); },
  executors: r => { expect(ds(r, "sandboxState")).toEqual(["UNKNOWN"]); expect(ds(r, "executor")).toEqual([]); expect(ds(r, "registryRow")).toEqual([]); },
};
const HAPPY: Record<string, (app: App, r: N) => Promise<void>> = {
  knowledge: async (app, r) => {
    const k = (await serverJson(app, `/v1/projects/${PID}/knowledge`)).knowledge;
    expect(ds(r, "knowledgeMemoryState")).toEqual([k.memory.state]); expect(ds(r, "knowledgeEvidenceState")).toEqual([k.evidence.state]);
    expect(nodes(r).find(n => n.dataset.stat === "memory-total")?.dataset.value ?? nodes(r).find(n => n.dataset.stat === "memory-total")?.textContent).toMatch(new RegExp(`^${k.memory.total}`));
  },
  readiness: async (app, r) => {
    const rd = (await serverJson(app, `/v1/projects/${PID}/readiness`)).readiness as {ready: boolean; checks: Array<{id: string; state: string}>};
    expect(ds(r, "readyCheck")).toEqual(rd.checks.map(c => c.id)); expect(ds(r, "readyState")).toEqual(rd.checks.map(c => c.state));
    expect(ds(r, "runReadiness")).toEqual([rd.ready ? "READY" : "BLOCKED"]);
  },
  engine: async (app, r) => {
    const ex = await serverJson(app, "/v1/system/executors");
    expect(ds(r, "engineSandbox")).toEqual([ex.sandbox.state]); expect(ds(r, "engineActive")).toEqual([ex.active.reason]);
    expect(ds(r, "engineProfile").sort()).toEqual(Object.keys(ex.claudeProfiles).sort());
  },
  tools: async (app, r) => {
    const rd = (await serverJson(app, "/v1/roles/status-summary")).readiness, tr = rd.totals.TOOL_READY;
    expect(ds(r, "denominator")).toContain(String(rd.denominator));
    const counts = Object.fromEntries(nodes(r).filter(n => n.dataset.toolsState !== undefined).map(n => [n.dataset.toolsState, n.dataset.count]));
    expect(counts).toMatchObject({TRUE: String(tr.TRUE), FALSE: String(tr.FALSE), UNKNOWN: String(tr.UNKNOWN)});
  },
  executors: async (app, r) => {
    const ex = await serverJson(app, "/v1/system/executors"), caps = (await serverJson(app, "/v1/capabilities")).capabilities as Array<{id: string}>, ads = (await serverJson(app, "/v1/adapters")).adapters as Array<{id: string}>;
    expect(ds(r, "sandboxState")).toEqual([ex.sandbox.state]); expect(ds(r, "executor").sort()).toEqual(Object.keys(ex.executors).sort());
    const known = new Set([...caps.map(c => c.id), ...ads.map(a => a.id)]), rows = ds(r, "registryRow");
    expect(rows.length).toBeGreaterThan(0); expect(rows.every(id => known.has(id!))).toBe(true);
  },
};

export function registerRendererRealServerSubpanelCases(): void {
describe("UASCO-T0006 sub-panels: renderer -> real buildServer for the five non-routed panels (happy path, HTTP 500, identity 403)", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0006s-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("covers exactly the five panels; each module exists and exports the rendered function", async () => {
    expect(Object.keys(PANELS).sort()).toEqual(["engine", "executors", "knowledge", "readiness", "tools"]);
    expect(Object.keys(HAPPY).sort()).toEqual(Object.keys(PANELS).sort()); expect(Object.keys(FAILED).sort()).toEqual(Object.keys(PANELS).sort());
    for (const [f, fn] of [["knowledge-panel", "knowledgePanel"], ["run-readiness", "runReadinessBlock"], ["run-engine", "runEngineBlock"], ["tools-panel", "toolsPanel"], ["executors-panel", "executorsPanel"], ["executors-panel", "routingPanel"]])
      expect(typeof (await load("views", `${f}.js`))[fn], `${f}.${fn}`).toBe("function");
    expect(desktopAllows("/v1/not-a-route")).toBe(false);
  });

  for (const panel of Object.keys(PANELS)) {
    it(`${panel}: happy path (every read 200 and allow-listed, every api.get ok, data matches the real server)`, { timeout: 120_000 }, async () => {
      const app = mkApp(), c = await mkCtx(app), root = await PANELS[panel](c);
      expect(pathsOf(c)).toEqual(PATHS[panel]);
      expect(c.seen.filter(s => s.status !== 200)).toEqual([]); expect(c.refused).toEqual([]); expect(c.thrown).toEqual([]);
      expect((await c.results()).filter(x => !x.ok).map(x => x.path)).toEqual([]);
      expect(noteError(root), `${panel}: no error note`).toBe(false);
      await HAPPY[panel](app, root);
    });
    it(`${panel}: server error path (identity verified, every /v1 read answers HTTP 500) is a classified ERROR with an error note and no data section`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      app.addHook("onRequest", async (req, reply) => { if (req.url.startsWith("/v1/")) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
      const c = await mkCtx(app), root = await PANELS[panel](c);
      expect(pathsOf(c)).toEqual(PATHS[panel]); expect([...new Set(c.seen.map(s => s.status))]).toEqual([500]);
      for (const x of await c.results()) expect([panel, x.path, x.ok, x.state, x.message]).toEqual([panel, x.path, false, "ERROR", `${x.path}: HTTP 500`]);
      expect(noteError(root), `${panel}: error note`).toBe(true);
      FAILED[panel](root);
    });
    it(`${panel}: identity path (token mismatch: the handshake fails as in main.mjs; the real server refuses the same token with 403) is a classified ERROR, nothing read`, { timeout: 120_000 }, async () => {
      const app = mkApp(), c = await mkCtx(app, WRONG), root = await PANELS[panel](c);
      expect(c.seen).toEqual([]);
      const res = await c.results(); expect(res.length).toBe(PATHS[panel].length);
      for (const x of res) {
        expect([panel, x.path, x.ok, x.state, x.message]).toEqual([panel, x.path, false, "ERROR", "CONTROL_API_IDENTITY_UNVERIFIED"]);
        const d = await app.inject({method: "GET", url: x.path, headers: {"x-uasco-control-token": WRONG, host: "127.0.0.1:3210"}}); expect([panel, x.path, d.statusCode]).toEqual([panel, x.path, 403]);
      }
      expect(noteError(root), `${panel}: error note`).toBe(true);
      FAILED[panel](root);
    });
  }
});
}
