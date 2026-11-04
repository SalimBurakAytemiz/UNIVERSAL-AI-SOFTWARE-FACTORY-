// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0006'yı uygular: renderer testlerinde yalnız sahte köprüyle (fake bridge) sınanan 10 rota (home, projects, work, workforce, assurance, delivery, tower, inbox, company, settings) gerçek buildServer'a (Fastify inject) bağlı, main.mjs'in apiGet sözleşmesini (`<yol>: HTTP <durum>` hatası) taklit eden bir köprüyle çizilir; her rota için mutlu yol (gerçek store verisi, her okuma 200, hata durumu yok, istenen yollar sabit) ve bir hata durumu (yanlış kontrol belirteci -> sunucu 403 -> görünüm dürüst hata durumu gösterir, istisna fırlatmaz) doğrulanır. Ücretli/ağ çağrısı yoktur; sunucu loopback inject ile çalışır.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), WRONG = "w".repeat(32), RECORDER = "implementer@local.invalid";
const PROJECT = "UASCO-T0006 project", MISSION = "UASCO-T0006 mission";

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

function seed(dataDir: string) {
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: PROJECT, environmentId: "env-dev", createdBy: RECORDER});
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

/** main.mjs apiGet ile aynı sözleşme: belirteç başlığı, 2xx değilse `${yol}: HTTP ${durum}` hatası, JSON gövde. */
async function renderAgainstServer(app: App, view: string, token = TOKEN) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{path: string; status: number}> = [], attention: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": token, host: "127.0.0.1:3210"}});
    seen.push({path: p, status: r.statusCode});
    if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
    return r.json();
  }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  // renderAttention app.js kabuğundandır (app.js içe aktarılınca boot eder): diğer renderer testleri gibi kayıt tutan bir ikame verilir
  const ctx: Record<string, unknown> = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, rerender: async () => undefined, refreshAll: async () => undefined,
    settleFocus: () => undefined, confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(),
    renderAttention: (_c: unknown, att: {state?: string} | null) => { attention.push(String(att?.state)); }};
  const mod = await load("views", `${view}.js`);
  const root: N = await mod.render(ctx);
  const paths = [...new Set(seen.map(s => s.path.replace(/\?.*$/, "")))].sort();
  return {root, seen, paths, attention, text: root.textContent};
}

// Her rotanın gerçek sunucuda okuduğu yollar (sorgu dizesi hariç). Bir görünüm farklı/kayıtsız bir yol okumaya başlarsa test bunu söyler.
const PATHS: Record<string, string[]> = {
  home: ["/v1/cockpit", "/v1/projects"],
  projects: ["/v1/deliveries", "/v1/intakes", "/v1/missions", "/v1/projects", "/v1/work-runs"],
  work: ["/v1/missions", "/v1/projects", "/v1/work-runs"],
  workforce: ["/v1/agents", "/v1/cockpit", "/v1/roles", "/v1/roles/status-summary", "/v1/work-runs"],
  assurance: ["/v1/cockpit", "/v1/evidence", "/v1/reviews", "/v1/work-runs"],
  delivery: ["/health", "/v1/attention", "/v1/control/status", "/v1/work-runs"],
  tower: ["/health", "/v1/adapters", "/v1/agents", "/v1/attention", "/v1/capabilities", "/v1/cockpit", "/v1/control/status", "/v1/install", "/v1/phase0", "/v1/retry", "/v1/roles", "/v1/runs", "/v1/scheduler", "/v1/work-runs"],
  inbox: ["/v1/attention", "/v1/cockpit", "/v1/missions", "/v1/work-runs"],
  company: ["/v1/company/accounts", "/v1/company/contacts", "/v1/company/contracts", "/v1/company/invoices", "/v1/company/opportunities", "/v1/company/payments"],
  settings: ["/health", "/v1/adapters", "/v1/capabilities", "/v1/control/status", "/v1/factory", "/v1/system/executors"],
};

// Mutlu yolda gerçek sunucu verisinden türetilen, görünüme özgü bir doğrulama.
const HAPPY: Record<string, (app: App, r: Awaited<ReturnType<typeof renderAgainstServer>>) => Promise<void>> = {
  home: async (_a, r) => { expect(kpiText(r.root, "projects")).toMatch(/^Active Projects1VERIFIED/); expect(kpiText(r.root, "missions")).toMatch(/^Tasks2VERIFIED/); },
  projects: async (_a, r) => { expect(r.text).toContain(PROJECT); expect(kpiText(r.root, "pf-projects")).toMatch(/^Projects1VERIFIED/); expect(kpiText(r.root, "pf-missions")).toMatch(/^Missions2VERIFIED/); },
  work: async (_a, r) => { expect(r.text).toContain(MISSION); expect(r.text).toContain(PROJECT); expect(kpiText(r.root, "wk-missions")).toMatch(/^Missions2VERIFIED/); },
  workforce: async (app, r) => { const n = (await serverJson(app, "/v1/agents")).registeredRoles as number; expect(n).toBeGreaterThan(0); expect(r.text).toContain(`Registered roles${n}`); },
  assurance: async (app, r) => { const total = (await serverJson(app, "/v1/cockpit")).evidence?.total; expect(Number.isSafeInteger(total)).toBe(true); expect(r.text).toContain(`${total}Total evidence`); },
  delivery: async (_a, r) => { expect(r.text).toContain("Operational health"); expect(r.seen.find(s => s.path === "/health")?.status).toBe(200); },
  tower: async (app, r) => { const n = (await serverJson(app, "/v1/agents")).registeredRoles as number; expect(r.text).toContain(`${n} target roles`); expect(r.attention).toEqual(["VERIFIED"]); },
  inbox: async (_a, r) => { for (const s of ["DecisionsVERIFIED", "ApprovalsVERIFIED", "Founder attentionVERIFIED"]) expect(r.text).toContain(s); },
  company: async (_a, r) => { const states = all(r.root).map(n => n.dataset.companyState).filter(Boolean); expect(states.length).toBeGreaterThan(0); expect(new Set(states)).toEqual(new Set(["EMPTY"])); expect(kpiText(r.root, "company-accounts")).toMatch(/^Accounts0EMPTY/); },
  settings: async (_a, r) => { expect(r.text).toMatch(/\d+ of \d+ checks pass/); },
};

export function registerRendererRealServerCases(): void {
describe("UASCO-T0006: renderer -> real buildServer for the 10 formerly fake-bridge routes (happy path + one error)", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0006-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("covers exactly the 10 routes and every one is a registered desktop view", async () => {
    expect(Object.keys(PATHS).sort()).toEqual(["assurance", "company", "delivery", "home", "inbox", "projects", "settings", "tower", "work", "workforce"]);
    expect(Object.keys(HAPPY).sort()).toEqual(Object.keys(PATHS).sort());
    for (const v of Object.keys(PATHS)) expect(fs.existsSync(path.join(REND, "views", `${v}.js`)), v).toBe(true);
  });

  for (const view of Object.keys(PATHS)) {
    it(`${view}: happy path against the real server (every read 200, no failure state, real data shown)`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view);
      expect(r.paths, `${view} reads`).toEqual(PATHS[view]);
      expect(r.seen.filter(s => s.status !== 200), `${view}: non-200 reads`).toEqual([]);
      expect(failureMarks(r.root), `${view}: failure states`).toEqual([]);
      await HAPPY[view](app, r);
    });

    it(`${view}: error path (wrong control token -> the real server answers 403) renders an honest failure state and never throws`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view, WRONG);
      const v1 = r.seen.filter(s => s.path.startsWith("/v1/"));
      expect(v1.length, `${view}: /v1 reads`).toBeGreaterThan(0);
      expect([...new Set(v1.map(s => s.status))], `${view}: every /v1 read is refused`).toEqual([403]);
      expect(r.text).not.toContain(PROJECT); expect(r.text).not.toContain(MISSION);
      if (view === "tower") expect(r.attention).toEqual(["ERROR"]);
      expect(failureMarks(r.root).length, `${view}: a failure state is shown`).toBeGreaterThan(0);
    });
  }
});
}
