// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-wp-qasec.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0006 uzantısıdır (Builder I): RW-053'ün 10 rotası DIŞINDAKİ 13 masaüstü görünümünü (audit, posture, queue, readiness, operations, executive, academy, domains, integrations, matrix, scheduler, journey, install) gerçek buildServer'a karşı, main.mjs'in gerçek izin listesi ve kimlik el sıkışmasıyla sınar: mutlu yol, her /v1 okumasının 500 döndüğü yol ve belirteç uyuşmazlığı (kimlik doğrulanamaz; sunucu aynı belirteci 403 ile reddeder). İddialar metne değil sınıflanmış durumlara ve data-* özniteliklerine dayanır; böylece açık PR'lardaki metin değişikliklerinden önce ve sonra geçer.
// Split with Builder H's desktop-tour PR (#387, "UASCO-T0006 follow-up"): this file is the renderer -> real-server half only; it mirrors tests/support/renderer-real-server.cases.ts
// (same bridge as main.mjs's uasco:api-get) and adds no product code.
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
const PROJECT = "UASCO-T0006-ext project", MISSION = "UASCO-T0006-ext mission";

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

/** main.mjs uasco:api-get (main.mjs:321) + verifyServerIdentity + api() ile aynı sözleşme: izin listesi dışı yol INVALID_API_PATH; her okumadan önce
 *  sunucu kimliği belirtece bağlı challenge ile doğrulanır (uyuşmazsa CONTROL_API_IDENTITY_UNVERIFIED); /health için sabit nesne döner; /v1 okuması belirteç
 *  başlığıyla gider, 2xx değilse `${yol}: HTTP ${durum}` hatası. (main.mjs kimliği 2 sn önbelleğe alır; burada her okumada doğrulanır: daha sıkı.) */
async function renderAgainstServer(app: App, view: string, token = TOKEN) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), seen: Array<{path: string; status: number}> = [], attention: string[] = [], refused: string[] = [], thrown: string[] = [];
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
  // renderAttention app.js kabuğundandır (app.js içe aktarılınca boot eder): diğer renderer testleri gibi kayıt tutan bir ikame verilir
  const ctx: Record<string, unknown> = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => undefined, rerender: async () => undefined, refreshAll: async () => undefined,
    settleFocus: () => undefined, confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(),
    renderAttention: (_c: unknown, att: {state?: string} | null) => { attention.push(String(att?.state)); }};
  const mod = await load("views", `${view}.js`), routes = await load("routes.js");
  const root: N = await mod.render(ctx, routes.routeById(view));
  const paths = [...new Set(seen.map(s => s.path.replace(/\?.*$/, "")))].sort();
  // api.get sonuçları (store.cache): görünümün ne gördüğünü — başarı mı, sınıflanmış hata mı — doğrudan gösterir (hata yutulursa ok:true olurdu)
  // L1 (#323): store.cache is the {at, promise} map api.js itself writes (state.js createStore); if that shape changes this fails loudly instead of silently reading nothing
  const entries = [...store.cache.entries()] as Array<[string, {promise?: Promise<{ok: boolean; state?: string; message?: string}>}]>;
  for (const [k, v] of entries) if (!v || typeof v.promise?.then !== "function") throw new Error(`renderer store.cache shape changed at ${k}: re-sync renderAgainstServer with apps/desktop/renderer/state.js + api.js`);
  const results = await Promise.all(entries.map(async ([k, v]) => ({path: k, ...(await v.promise!)})));
  return {root, seen, paths, attention, refused, thrown, results, text: root.textContent};
}


const kpiValue = (r: N, key: string) => { const k = all(r).find(n => n.dataset.kpi === key); if (!k) return `<no kpi ${key}>`; return all(k).find(n => n.className.split(/\s+/).includes("kpi-value"))?.textContent ?? `<no value ${key}>`; };
const count = (r: N, k: string) => all(r).filter(n => n.dataset[k] !== undefined).length;
// //TR: Her görünümün kendi sınıflanmış hata işareti (data-<view>-state="ERROR"); keşifte gerçek sunucuya karşı belirlendi. Metin değişse de öznitelik aynı kalır.
const STATE_KEY: Record<string, string> = {audit: "auditState", posture: "postureState", queue: "queueState", readiness: "readinessState", operations: "opsState", executive: "executiveState",
  academy: "academyState", domains: "domainState", integrations: "integState", matrix: "matrixState", scheduler: "schedState", journey: "journeyState", install: "installState"};
const failed = (r: N, view: string) => all(r).filter(n => n.dataset[STATE_KEY[view]] === "ERROR").length;
// Her rotanın gerçek sunucuda okuduğu yollar (sorgu dizesi hariç). Bir görünüm farklı/kayıtsız bir yol okumaya başlarsa test bunu söyler.
const PATHS: Record<string, string[]> = {
  audit: ["/v1/evidence", "/v1/runs"],
  posture: ["/v1/cockpit", "/v1/reviews", "/v1/work-runs"],
  queue: ["/v1/attention", "/v1/missions", "/v1/work-runs"],
  readiness: ["/v1/cockpit", "/v1/missions", "/v1/reviews", "/v1/work-runs"],
  operations: ["/v1/attention", "/v1/control/status", "/v1/runs"],
  executive: ["/v1/attention", "/v1/cockpit", "/v1/missions", "/v1/work-runs"],
  academy: ["/v1/academy"],
  domains: ["/v1/domains"],
  integrations: ["/v1/adapters", "/v1/capabilities", "/v1/fabrics"],
  matrix: ["/v1/cockpit", "/v1/missions", "/v1/projects", "/v1/work-runs"],
  scheduler: ["/v1/scheduler"],
  journey: ["/v1/missions"],
  install: ["/v1/install", "/v1/phase0", "/v1/system/executors"],
};
type R = Awaited<ReturnType<typeof renderAgainstServer>>;
// //TR: Mutlu yolda gerçek sunucu verisinden türetilen, görünüme özgü ve metinden bağımsız (KPI değeri / data-* sayısı) doğrulama.
const HAPPY: Record<string, (app: App, r: R) => Promise<void>> = {
  audit: async (app, r) => {
    const ev = (await serverJson(app, "/v1/evidence?limit=100")).evidence as Array<{evidenceId: string}>, ids = new Set(ev.map(e => e.evidenceId));
    expect(ids.size).toBeGreaterThan(0);
    expect(new Set(all(r.root).filter(n => n.dataset.auditEvidence !== undefined).map(n => n.dataset.auditEvidence))).toEqual(ids);
    expect(kpiValue(r.root, "audit-evidence")).toBe(String(ids.size));
    expect(kpiValue(r.root, "audit-runs")).toBe(String((await serverJson(app, "/v1/runs")).count));
  },
  posture: async (app, r) => {
    expect(kpiValue(r.root, "posture-total")).toBe(String(((await serverJson(app, "/v1/work-runs")).runs as unknown[]).length));
    expect(kpiValue(r.root, "posture-integrity")).toBe(String((await serverJson(app, "/v1/cockpit")).evidence.verified));
  },
  queue: async (app, r) => {
    const ms = (await serverJson(app, "/v1/missions")).missions as Array<{status: string}>, runs = (await serverJson(app, "/v1/work-runs")).runs as Array<{status: string}>, att = (await serverJson(app, "/v1/attention")).attention;
    expect(ms.length).toBe(2);
    const expected = ms.filter(m => m.status === "PREFLIGHT" || m.status === "FOUNDER_ATTENTION_REQUIRED").length + runs.filter(x => x.status === "AWAITING_APPROVAL").length + att.items.length;
    expect(kpiValue(r.root, "queue-total")).toBe(String(expected));
  },
  readiness: async (app, r) => { expect(kpiValue(r.root, "readiness-total")).toBe(String(((await serverJson(app, "/v1/work-runs")).runs as unknown[]).length)); },
  operations: async (app, r) => {
    expect(kpiValue(r.root, "ops-runs")).toBe(String((await serverJson(app, "/v1/runs")).count));
    expect(all(r.root).some(n => n.dataset.controlState === "ERROR")).toBe(false);
  },
  executive: async (app, r) => {
    expect(kpiValue(r.root, "executive-projects")).toBe(String(((await serverJson(app, "/v1/projects")).projects as unknown[]).length));
    expect(kpiValue(r.root, "executive-missions")).toBe(String(((await serverJson(app, "/v1/missions")).missions as unknown[]).length));
  },
  academy: async (app, r) => {
    expect(kpiValue(r.root, "academy-curricula")).toBe(String(((await serverJson(app, "/v1/academy")).learnings as unknown[]).length));
    expect(kpiValue(r.root, "academy-certified")).toBe("0"); // the Academy certifies no one
  },
  domains: async (app, r) => {
    const ds = (await serverJson(app, "/v1/domains")).domains as Array<{id: string}>;
    expect(ds.length).toBeGreaterThan(0);
    expect(all(r.root).filter(n => n.dataset.domainItem !== undefined).map(n => n.dataset.domainItem)).toEqual(ds.map(d => d.id));
  },
  integrations: async (app, r) => {
    const a = (await serverJson(app, "/v1/adapters")).adapters as unknown[], c = (await serverJson(app, "/v1/capabilities")).capabilities as unknown[], f = (await serverJson(app, "/v1/fabrics")).fabrics as unknown[];
    expect(count(r.root, "integItem")).toBe(a.length + c.length + f.length);
  },
  matrix: async (app, r) => {
    const ps = (await serverJson(app, "/v1/projects")).projects as unknown[];
    expect(kpiValue(r.root, "matrix-projects")).toBe(String(ps.length));
    expect(count(r.root, "matrixRow")).toBe(ps.length);
    expect(kpiValue(r.root, "matrix-evidence")).toBe(String((await serverJson(app, "/v1/cockpit")).evidence.verified));
  },
  scheduler: async (app, r) => {
    const s = await serverJson(app, "/v1/scheduler");
    if (s.verification !== "VERIFIED") { expect(count(r.root, "schedPhase")).toBe(0); expect(all(r.root).some(n => n.dataset.schedState === s.verification)).toBe(true); } // nothing invented before the scheduler is verified
    else expect(count(r.root, "schedPhase")).toBe((s.phases as unknown[]).length);
  },
  journey: async (app, r) => {
    expect(((await serverJson(app, "/v1/missions")).missions as unknown[]).length).toBe(2);
    expect(all(r.root).some(n => n.dataset.journey === "no-mission")).toBe(true); // missions exist but none is selected: honest "no mission", no invented rail
    expect(count(r.root, "journeyRail")).toBe(0);
  },
  install: async (app, r) => {
    const ex = (await serverJson(app, "/v1/system/executors")).executors as Record<string, unknown>;
    expect(all(r.root).filter(n => n.dataset.executor !== undefined).map(n => n.dataset.executor).sort()).toEqual(Object.keys(ex).sort());
  },
};

export function registerRendererRealServerExtCases(): void {
describe("UASCO-T0006 extension: renderer -> real buildServer for the 13 views outside the RW-053 ten (happy path, HTTP 500, identity 403)", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0006x-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("covers exactly these 13 views, every one a registered route, none of them one of the RW-053 ten", async () => {
    const routes = await load("routes.js");
    expect(Object.keys(PATHS).sort()).toEqual(["academy", "audit", "domains", "executive", "install", "integrations", "journey", "matrix", "operations", "posture", "queue", "readiness", "scheduler"]);
    expect(Object.keys(HAPPY).sort()).toEqual(Object.keys(PATHS).sort()); expect(Object.keys(STATE_KEY).sort()).toEqual(Object.keys(PATHS).sort());
    for (const v of Object.keys(PATHS)) { expect(routes.routeById(v)?.id, v).toBe(v); expect(fs.existsSync(path.join(REND, "views", `${v}.js`)), v).toBe(true); }
    for (const v of ["home", "projects", "work", "workforce", "assurance", "delivery", "tower", "inbox", "company", "settings"]) expect(Object.keys(PATHS)).not.toContain(v);
    expect(desktopAllows("/v1/not-a-route"), "the allow-list is a real filter").toBe(false);
  });

  for (const view of Object.keys(PATHS)) {
    it(`${view}: happy path against the real server (every read 200 and allow-listed, no classified failure, real data shown)`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view);
      expect(r.paths, `${view} reads`).toEqual(PATHS[view]);
      expect(r.seen.filter(s => s.status !== 200), `${view}: non-200 reads`).toEqual([]);
      expect(r.refused, `${view}: every read passes main.mjs's GET allow-list`).toEqual([]);
      expect(r.thrown, `${view}: no bridge failure`).toEqual([]);
      expect(r.results.filter(x => !x.ok).map(x => x.path), `${view}: every api.get result is ok`).toEqual([]);
      expect(failed(r.root, view), `${view}: classified failure`).toBe(0);
      await HAPPY[view](app, r);
    });

    // //TR: Kimlik GEÇERLİ ama gerçek sunucu her /v1 rotasını 500 ile yanıtlar (kimlik/belirteç kancalarından SONRA eklenen kanca). Görünümün gördüğü her /v1 sonucu ok:false ve
    // sınıflanmış ERROR'dur ve görünüm kendi data-<view>-state="ERROR" işaretini gösterir; sunucu verisi gösterilmez.
    it(`${view}: server error path (identity verified, every /v1 route answers HTTP 500) is a classified ERROR with the view's failure state`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      app.addHook("onRequest", async (req, reply) => { if (req.url.startsWith("/v1/")) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
      const r = await renderAgainstServer(app, view);
      expect(r.refused).toEqual([]);
      expect(r.thrown.filter(t => /CONTROL_API_IDENTITY_UNVERIFIED|INVALID_API_PATH/.test(t)), `${view}: identity and allow-list hold`).toEqual([]);
      const v1Seen = r.seen.filter(x => x.path.startsWith("/v1/"));
      expect(v1Seen.length, `${view}: /v1 reads reached the server`).toBeGreaterThan(0);
      expect([...new Set(v1Seen.map(x => x.status))], `${view}: every /v1 read answered 500`).toEqual([500]);
      const v1 = r.results.filter(x => x.path.startsWith("/v1/"));
      expect(v1.length).toBe(new Set(v1Seen.map(x => x.path)).size);
      for (const x of v1) expect([view, x.path, x.ok, x.state]).toEqual([view, x.path, false, "ERROR"]);
      expect(r.text).not.toContain(PROJECT); expect(r.text).not.toContain(MISSION);
      expect(failed(r.root, view), `${view}: the view's classified failure state is shown`).toBeGreaterThan(0);
    });

    // //TR: Belirteç uyuşmazlığı: main.mjs gibi kimlik el sıkışması başarısız olur (CONTROL_API_IDENTITY_UNVERIFIED; /v1'e hiç gidilmez); aynı belirteci gerçek sunucu her /v1 yolunda 403 ile reddeder.
    it(`${view}: identity path (control token mismatch: the handshake fails as in main.mjs, the real server refuses the same token with 403) is a classified ERROR, nothing read`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view, WRONG);
      expect(r.refused).toEqual([]);
      expect(r.results.length, `${view}: reads attempted`).toBeGreaterThan(0);
      expect(r.results.map(x => x.path.replace(/\?.*$/, "")).sort()).toEqual(expect.arrayContaining(PATHS[view]));
      for (const x of r.results) expect([view, x.path, x.ok, x.state, x.message]).toEqual([view, x.path, false, "ERROR", "CONTROL_API_IDENTITY_UNVERIFIED"]);
      expect(r.seen, `${view}: nothing was read from /v1 with an unverified identity`).toEqual([]);
      for (const p of new Set(r.results.map(x => x.path).filter(p => p.startsWith("/v1/")))) {
        const direct = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": WRONG, host: "127.0.0.1:3210"}});
        expect([view, p, direct.statusCode]).toEqual([view, p, 403]);
      }
      expect(r.text).not.toContain(PROJECT); expect(r.text).not.toContain(MISSION);
      expect(failed(r.root, view), `${view}: the view's classified failure state is shown`).toBeGreaterThan(0);
    });
  }
});
}
