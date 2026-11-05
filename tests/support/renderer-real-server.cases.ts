// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0006'yı uygular: renderer testlerinde yalnız sahte köprüyle (fake bridge) sınanan 10 rota (home, projects, work, workforce, assurance, delivery, tower, inbox, company, settings) gerçek buildServer'a (Fastify inject) bağlı, main.mjs'in apiGet sözleşmesini (`<yol>: HTTP <durum>` hatası) taklit eden bir köprüyle çizilir; her rota için mutlu yol (gerçek store verisi, her okuma 200, hata durumu yok, istenen yollar sabit) ve bir hata durumu (yanlış kontrol belirteci -> sunucu 403 -> görünüm dürüst hata durumu gösterir, istisna fırlatmaz) doğrulanır. Ücretli/ağ çağrısı yoktur; sunucu loopback inject ile çalışır.
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
function mkApp(seedFn: (dataDir: string) => void = seed): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  seedFn(dataDir);
  // repoRoot = depo: rol kataloğu ve kanıt okumaları gerçek kaynaktan gelir (salt okunur; yazılar runtime/dataDir'e gider)
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
const serverJson = async (app: App, url: string) => { const r = await app.inject({method: "GET", url, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}}); expect(r.statusCode, url).toBe(200); return r.json(); };

/** main.mjs uasco:api-get (main.mjs:321) + verifyServerIdentity + api() ile aynı sözleşme: izin listesi dışı yol INVALID_API_PATH; her okumadan önce
 *  sunucu kimliği belirtece bağlı challenge ile doğrulanır (uyuşmazsa CONTROL_API_IDENTITY_UNVERIFIED); /health için sabit nesne döner; /v1 okuması belirteç
 *  başlığıyla gider, 2xx değilse `${yol}: HTTP ${durum}` hatası. (main.mjs kimliği 2 sn önbelleğe alır; burada her okumada doğrulanır: daha sıkı.) */
async function renderAgainstServer(app: App, view: string, token = TOKEN, lang: "en" | "tr" = "en", extra: Record<string, unknown> = {}) {
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
  const t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  // renderAttention app.js kabuğundandır (app.js içe aktarılınca boot eder): diğer renderer testleri gibi kayıt tutan bir ikame verilir
  const ctx: Record<string, unknown> = {doc, store, api, i18n: {lang, t}, t, navigate: () => undefined, rerender: async () => undefined, refreshAll: async () => undefined,
    settleFocus: () => undefined, confirm: async () => false, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(),
    renderAttention: (_c: unknown, att: {state?: string} | null) => { attention.push(String(att?.state)); }, storage: null, ...extra};
  const mod = await load("views", `${view}.js`);
  const root: N = await mod.render(ctx);
  const paths = [...new Set(seen.map(s => s.path.replace(/\?.*$/, "")))].sort();
  // api.get sonuçları (store.cache): görünümün ne gördüğünü — başarı mı, sınıflanmış hata mı — doğrudan gösterir (hata yutulursa ok:true olurdu)
  // L1 (#323): store.cache is the {at, promise} map api.js itself writes (state.js createStore); if that shape changes this fails loudly instead of silently reading nothing
  const entries = [...store.cache.entries()] as Array<[string, {promise?: Promise<{ok: boolean; state?: string; message?: string}>}]>;
  for (const [k, v] of entries) if (!v || typeof v.promise?.then !== "function") throw new Error(`renderer store.cache shape changed at ${k}: re-sync renderAgainstServer with apps/desktop/renderer/state.js + api.js`);
  const results = await Promise.all(entries.map(async ([k, v]) => ({path: k, ...(await v.promise!)})));
  return {root, seen, paths, attention, refused, thrown, results, text: root.textContent};
}

// //TR: CLOUD-T0005: tower bulut iş panelini GET /v1/cloud/jobs ile okur. Bu yol korumalı main.mjs izin listesine Kurucu kapılı PR ile eklenir; o zamana kadar
// köprü yolu reddeder (INVALID_API_PATH) ve panel dürüst UNAVAILABLE gösterir. Beklenti main.mjs'in gerçek durumundan türetilir; giriş eklenince otomatik sıkılaşır.
const CLOUD_JOBS_PENDING = !desktopAllows("/v1/cloud/jobs");
const pendingRefused = (view: string): string[] => (view === "tower" && CLOUD_JOBS_PENDING ? ["/v1/cloud/jobs"] : []);
// Her rotanın gerçek sunucuda okuduğu yollar (sorgu dizesi hariç). Bir görünüm farklı/kayıtsız bir yol okumaya başlarsa test bunu söyler.
const PATHS: Record<string, string[]> = {
  home: ["/v1/attention", "/v1/cockpit", "/v1/projects", "/v1/run-summaries"],
  projects: ["/v1/deliveries", "/v1/intakes", "/v1/missions", "/v1/projects", "/v1/work-runs"],
  work: ["/v1/missions", "/v1/projects", "/v1/work-runs"],
  workforce: ["/v1/agents", "/v1/cockpit", "/v1/roles", "/v1/roles/status-summary", "/v1/work-runs"],
  assurance: ["/v1/cockpit", "/v1/evidence", "/v1/reviews", "/v1/work-runs"],
  delivery: ["/health", "/v1/attention", "/v1/control/status", "/v1/work-runs"],
  tower: ["/health", "/v1/adapters", "/v1/agents", "/v1/attention", "/v1/capabilities", ...(CLOUD_JOBS_PENDING ? [] : ["/v1/cloud/jobs"]), "/v1/cockpit", "/v1/control/status", "/v1/install", "/v1/phase0", "/v1/retry", "/v1/roles", "/v1/runs", "/v1/scheduler", "/v1/work-runs"],
  inbox: ["/v1/attention", "/v1/cockpit", "/v1/missions", "/v1/work-runs"],
  company: ["/v1/company/accounts", "/v1/company/contacts", "/v1/company/contracts", "/v1/company/invoices", "/v1/company/opportunities", "/v1/company/payments"],
  settings: ["/health", "/v1/adapters", "/v1/capabilities", "/v1/control/status", "/v1/factory", "/v1/system/executors"],
};

// Mutlu yolda gerçek sunucu verisinden türetilen, görünüme özgü bir doğrulama.
const HAPPY: Record<string, (app: App, r: Awaited<ReturnType<typeof renderAgainstServer>>) => Promise<void>> = {
  home: async (app, r) => {
    expect(kpiText(r.root, "projects")).toMatch(/^Active Projects1VERIFIED/); expect(kpiText(r.root, "missions")).toMatch(/^Tasks2VERIFIED/);
    // V3-T1027: per-project panel is built from the same server data (seed has no runs and no mission awaiting approval)
    const [prj] = (await serverJson(app, "/v1/projects")).projects as Array<{projectId: string}>;
    const row = all(r.root).find(n => n.dataset.projectCockpit === prj!.projectId)!;
    expect(row.textContent).toBe(`${PROJECT}Runs0No runs yetBlockers0NoneMissions awaiting approval0NoneSpend—Not available: the Control API has no spend endpoint yet.`);
    // UASCO-T0019: the seed has no attention items and no runs, so the feed is an honest EMPTY (badge 0), not a failure
    expect((await serverJson(app, "/v1/attention")).attention.items).toEqual([]);
    expect(all(r.root).find(n => n.id === "home-notify")?.textContent).toBe("Notifications0 unreadMark all as readRead state cannot be saved on this device; every notification shows as unread.No notifications right now.");
  },
  projects: async (_a, r) => { expect(r.text).toContain(PROJECT); expect(kpiText(r.root, "pf-projects")).toMatch(/^Projects1VERIFIED/); expect(kpiText(r.root, "pf-missions")).toMatch(/^Missions2VERIFIED/); },
  work: async (_a, r) => { expect(r.text).toContain(MISSION); expect(r.text).toContain(PROJECT); expect(kpiText(r.root, "wk-missions")).toMatch(/^Missions2VERIFIED/); },
  workforce: async (app, r) => { const n = (await serverJson(app, "/v1/agents")).registeredRoles as number; expect(n).toBeGreaterThan(0); expect(r.text).toContain(`Registered roles${n}`); },
  assurance: async (app, r) => { const total = (await serverJson(app, "/v1/cockpit")).evidence?.total; expect(Number.isSafeInteger(total)).toBe(true); expect(r.text).toContain(`${total}Total evidence`); },
  // //TR: L1 (#318 incelemesi): delivery/inbox/settings mutlu yolları somut sunucu değerlerine bağlanır.
  delivery: async (app, r) => {
    expect(r.text).toContain(`${SYNTHETIC_HEALTH.status} · ${SYNTHETIC_HEALTH.system} · ${SYNTHETIC_HEALTH.serverIdentity}`); // N1b: main.mjs'in sabit /health nesnesi
    const ctl = await serverJson(app, "/v1/control/status"), runs = (await serverJson(app, "/v1/work-runs")).runs as unknown[], att = (await serverJson(app, "/v1/attention")).attention;
    expect(r.text).toContain(ctl.globalStop.active ? "Global Stop is active" : "Global Stop is not active");
    expect(runs.length === 0 ? r.text.includes("No work runs were returned") : !r.text.includes("No work runs were returned")).toBe(true);
    expect(att.items.length === 0 ? r.text.includes("No Founder-attention items are blocked right now.") : true).toBe(true);
  },
  tower: async (app, r) => { const n = (await serverJson(app, "/v1/agents")).registeredRoles as number; expect(r.text).toContain(`${n} target roles`); expect(r.attention).toEqual(["VERIFIED"]); },
  inbox: async (app, r) => {
    for (const s of ["DecisionsVERIFIED", "ApprovalsVERIFIED", "Founder attentionVERIFIED"]) expect(r.text).toContain(s);
    const ck = await serverJson(app, "/v1/cockpit"), bs = (ck.missions?.byStatus ?? {}) as Record<string, number>;
    expect(r.text).toContain(`Blocked missions${bs.BLOCKED ?? 0}`);
    expect(r.text).toContain(`Missions awaiting Founder attention${bs.FOUNDER_ATTENTION_REQUIRED ?? 0}`);
    expect(r.text).toContain(ck.globalStop?.active ? "Global StopVERIFIED Active" : "Global StopVERIFIED Not active");
    if ((ck.awaitingApproval?.items ?? []).length === 0) expect(r.text).toContain("Nothing awaits your approval.");
  },
  company: async (_a, r) => { const states = all(r.root).map(n => n.dataset.companyState).filter(Boolean); expect(states.length).toBeGreaterThan(0); expect(new Set(states)).toEqual(new Set(["EMPTY"])); expect(kpiText(r.root, "company-accounts")).toMatch(/^Accounts0EMPTY/); },
  settings: async (app, r) => {
    expect(r.text).toMatch(/\d+ of \d+ checks pass/);
    const lc = (await serverJson(app, "/v1/system/executors")).executors.LOCAL_CLAUDE;
    expect(typeof lc.enabled).toBe("boolean");
    if (lc.enabled === false) expect(r.text).toContain("Local Claude is not enabled");
    for (const b of (lc.readiness?.implementer?.blockers ?? []) as string[]) { const m = /^CLAUDE_PROFILE_REFUSED:(\w+)$/.exec(b); if (m) expect(r.text).toContain(`(${m[1]})`); }
  },
};

export function registerRendererRealServerCases(): void {
describe("UASCO-T0006: renderer -> real buildServer for the 10 formerly fake-bridge routes (happy path + one error)", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0006-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("covers exactly the 10 routes and every one is a registered desktop view", async () => {
    expect(Object.keys(PATHS).sort()).toEqual(["assurance", "company", "delivery", "home", "inbox", "projects", "settings", "tower", "work", "workforce"]);
    expect(Object.keys(HAPPY).sort()).toEqual(Object.keys(PATHS).sort());
    for (const v of Object.keys(PATHS)) expect(fs.existsSync(path.join(REND, "views", `${v}.js`)), v).toBe(true);
    // N1a/N1b: the bridge mirrors main.mjs's uasco:api-get handler; if that handler's allow-list gate or synthetic /health body drifts, this fails
    const handler = /ipcMain\.handle\("uasco:api-get",async\(event,p\)=>\{requireTrustedSender\(event\);if\(!desktopGetPathAllowed\(p\)&&!desktopExtraGetPathAllowed\(p\)\)throw new Error\("INVALID_API_PATH"\);if\(p==="\/health"\)\{await verifyServerIdentity\(true\);return (\{[^{}]*\})\}return api\(p\)\}\);/.exec(MAIN_SRC);
    expect(handler, "main.mjs uasco:api-get handler changed (L3): re-sync the bridge in tests/support/renderer-real-server.cases.ts (allow-list gate, identity check, synthetic /health) with main.mjs").not.toBeNull();
    expect(new Function(`return ${handler![1]}`)()).toEqual(SYNTHETIC_HEALTH);
    expect(desktopAllows("/v1/not-a-route"), "the allow-list is a real filter").toBe(false);
  });

  for (const view of Object.keys(PATHS)) {
    // //TR: N1 (#323 incelemesi): kimlik GEÇERLİ (doğru belirteç, doğrulanmış /health), ama gerçek sunucu her /v1 rotasını 500 ile yanıtlar (sunucunun kendi
    // kimlik/belirteç onRequest kancalarından SONRA eklenen bir kanca: istek doğrulanır, sonra başarısız olur). Köprü main.mjs gibi `${yol}: HTTP 500` fırlatır;
    // görünümün gördüğü her /v1 sonucu ok:false, ERROR ve tam bu iletidir ve görünüm bir hata durumu gösterir. Yalnız "HTTP <n>" hatalarını yutan bir api.get bunu düşürür.
    it(`${view}: server error path (identity verified, every /v1 route answers HTTP 500) surfaces "<path>: HTTP 500" as a classified ERROR and a failure state`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      app.addHook("onRequest", async (req, reply) => { if (req.url.startsWith("/v1/")) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
      const r = await renderAgainstServer(app, view);
      expect(r.refused, `${view}: allow-list`).toEqual(pendingRefused(view));
      expect(r.thrown.filter(t => /CONTROL_API_IDENTITY_UNVERIFIED|INVALID_API_PATH/.test(t) && !pendingRefused(view).some(p => t.startsWith(`${p} -> `))), `${view}: identity and allow-list hold`).toEqual([]);
      const v1Seen = r.seen.filter(x => x.path.startsWith("/v1/"));
      expect(v1Seen.length, `${view}: /v1 reads reached the server`).toBeGreaterThan(0);
      expect([...new Set(v1Seen.map(x => x.status))], `${view}: every /v1 read answered 500`).toEqual([500]);
      const v1Results = r.results.filter(x => x.path.startsWith("/v1/") && !pendingRefused(view).includes(x.path));
      expect(v1Results.length).toBe(new Set(v1Seen.map(x => x.path)).size);
      for (const x of r.results.filter(x => pendingRefused(view).includes(x.path))) expect([x.path, x.ok, x.state]).toEqual([x.path, false, "UNAVAILABLE"]);
      for (const x of v1Results) expect([view, x.path, x.ok, x.state, x.message]).toEqual([view, x.path, false, "ERROR", `${x.path}: HTTP 500`]);
      for (const x of r.results.filter(x => x.path === "/health")) expect([view, x.ok]).toEqual([view, true]); // main.mjs's own /health still answers
      expect(r.text).not.toContain(PROJECT); expect(r.text).not.toContain(MISSION);
      if (view === "tower") expect(r.attention).toEqual(["ERROR"]);
      expect(failureMarks(r.root).length, `${view}: a failure state is shown`).toBeGreaterThan(0);
    });

    it(`${view}: happy path against the real server (every read 200, no failure state, real data shown)`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view);
      expect(r.paths, `${view} reads`).toEqual(PATHS[view]);
      expect(r.seen.filter(s => s.status !== 200), `${view}: non-200 reads`).toEqual([]);
      expect(r.refused, `${view}: every read passes main.mjs's GET allow-list (N1a)`).toEqual(pendingRefused(view));
      expect(r.thrown.filter(t => !pendingRefused(view).some(p => t.startsWith(`${p} -> `))), `${view}: no bridge failure`).toEqual([]);
      expect(r.results.filter(x => !x.ok && !pendingRefused(view).includes(x.path)).map(x => x.path), `${view}: every api.get result is ok`).toEqual([]);
      for (const x of r.results.filter(x => pendingRefused(view).includes(x.path))) expect([x.path, x.ok, x.state]).toEqual([x.path, false, "UNAVAILABLE"]);
      if (view === "tower") {
        // Kurucu PR'ından önce UNAVAILABLE; sonra (server.ts kaydı, kuyruk null) NOT_CONFIGURED. Her iki durumda da örnek iş kartı yok.
        expect(all(r.root).find(n => n.id === "cloud-jobs-status")?.dataset.cloudJobsState, "tower cloud panel").toBe(CLOUD_JOBS_PENDING ? "UNAVAILABLE" : "NOT_CONFIGURED");
        expect(all(r.root).filter(n => n.dataset.cloudJob !== undefined)).toEqual([]);
      }
      expect(failureMarks(r.root), `${view}: failure states`).toEqual([]);
      await HAPPY[view](app, r);
    });

    // //TR: N2 (#318 incelemesi): hata yolu yalnız "bir hata işareti var" demez; görünümün gördüğü HER okuma sonucu (api.get / store.cache) ok:false ve sınıflanmış ERROR'dur,
    // ileti köprünün gerçek hatasıdır. Üretimde (main.mjs) yanlış belirteç önce kimlik el sıkışmasında yakalanır (CONTROL_API_IDENTITY_UNVERIFIED; /v1'e hiç gidilmez);
    // aynı belirteçle sunucunun her /v1 yolunu 403 ile reddettiği ayrıca doğrudan doğrulanır. Hata yutan bir api.get 10 görünümün hepsinde bu testi düşürür.
    it(`${view}: error path (control token mismatch: identity handshake fails as in main.mjs; the real server refuses the same token with 403) renders an honest, classified failure and never throws`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view, WRONG);
      expect(r.refused, `${view}: allow-list`).toEqual(pendingRefused(view));
      expect(r.results.length, `${view}: reads attempted`).toBeGreaterThan(0);
      // L2 (#323): /health is excluded because main.mjs answers it itself; /v1/roles?cursor=... pages and /v1/deliveries?projectId=... only follow a SUCCESSFUL first read (paging cursor / selected project), so they are not attempted when that read fails
      expect(r.results.map(x => x.path).sort(), `${view}: the same reads as the happy path`).toEqual(expect.arrayContaining(PATHS[view].filter(p => p !== "/health" && !p.includes("/v1/roles") && !p.includes("/v1/deliveries")).map(p => expect.stringMatching(new RegExp(`^${p.replace(/[/.]/g, "\\$&")}(\\?|$)`)))));
      for (const x of r.results.filter(x => !pendingRefused(view).includes(x.path))) expect([view, x.path, x.ok, x.state, x.message]).toEqual([view, x.path, false, "ERROR", "CONTROL_API_IDENTITY_UNVERIFIED"]);
      expect(r.seen, `${view}: nothing was read from /v1 with an unverified identity`).toEqual([]);
      for (const p of new Set(r.results.map(x => x.path).filter(p => p.startsWith("/v1/")))) {
        const direct = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": WRONG, host: "127.0.0.1:3210"}});
        expect([view, p, direct.statusCode]).toEqual([view, p, 403]);
      }
      expect(r.text).not.toContain(PROJECT); expect(r.text).not.toContain(MISSION);
      if (view === "tower") expect(r.attention).toEqual(["ERROR"]);
      expect(failureMarks(r.root).length, `${view}: a failure state is shown`).toBeGreaterThan(0);
    });
  }
});

const PLANTED = ["ghp_", "0123456789abcdefghijklmnopqrstuvwxyzAB"].join("");
const cockpitSeed = (dataDir: string) => {
  const store = new WorkOsStore(dataDir), tenantId = "tA", scope = {tenantId};
  const a = store.createProject({tenantId, orgId: "org1", name: "Alpha", environmentId: "env-dev", createdBy: RECORDER});
  store.createProject({tenantId, orgId: "org1", name: "Beta", environmentId: "env-dev", createdBy: RECORDER});
  const mk = (title: string, riskLevel: "R1" | "R2" | "R3" = "R1") => store.createMission({tenantId, projectId: a.projectId, title, objective: "obj", acceptanceCriteria: ["ac"], riskLevel, createdBy: RECORDER}).missionId;
  const walk = (id: string, p: string[]) => { for (const to of p) store.transitionMission(scope, id, to as any, "go", RECORDER); };
  walk(mk("Needs sign-off", "R3"), ["PREFLIGHT"]);
  const start = (title: string) => { const m = mk(title); walk(m, ["PREFLIGHT", "AUTHORIZED"]); const r = store.createRun({tenantId, missionId: m, executor: {implementer: `I-${title}`, reviewer: `R-${title}`}, createdBy: RECORDER}); return {runId: r.runId, leaseId: store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string}; };
  const busy = start("busy"); store.transitionRun(busy.runId, busy.leaseId, "RUNNING", "go", "ENGINE");
  const stuck = start("stuck"); store.transitionRun(stuck.runId, stuck.leaseId, "RUNNING", "go", "ENGINE");
  store.transitionRun(stuck.runId, stuck.leaseId, "BLOCKED", `needs credentials token=${PLANTED}`, "ENGINE");
};
// //TR: V3-T1027: Ana Sayfa proje bazlı cockpit paneli GERÇEK buildServer'a karşı: yüklü (gerçek koşu/engel/onay), boş, hata (500), kullanılamıyor (404) ve tr dili.
// Harcama için kayıtlı uç nokta yoktur; hücre her durumda dürüst UNAVAILABLE'dır ve sayı içermez.
describe("V3-T1027: home per-project cockpit (runs, blockers, pending approvals, spend) against the real buildServer", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t1027-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
  const panelOf = (r: {root: N}) => all(r.root).find(n => n.id === "home-projects")!;
  const cellOf = (row: N, key: string) => all(row).find(n => n.dataset.pc === key)!;
  const rowsOf = (r: {root: N}) => all(panelOf(r)).filter(n => n.dataset.projectCockpit !== undefined);

  it("loaded: per-project runs by status, blockers with redacted reasons, pending approvals and an honest spend gap match the server", { timeout: 120_000 }, async () => {
    const app = mkApp(cockpitSeed);
    const r = await renderAgainstServer(app, "home");
    expect(r.paths).toEqual(["/v1/attention", "/v1/cockpit", "/v1/projects", "/v1/run-summaries"]);
    expect(r.refused).toEqual([]); expect(r.thrown).toEqual([]); expect(failureMarks(r.root)).toEqual([]);
    const projects = (await serverJson(app, "/v1/projects")).projects as Array<{projectId: string; name: string}>;
    const runs = (await serverJson(app, "/v1/run-summaries?limit=100")).page.runs as Array<{projectId: string; status: string}>;
    const ck = await serverJson(app, "/v1/cockpit");
    expect(all(panelOf(r)).find(n => n.dataset.projectCockpitState !== undefined)?.dataset.projectCockpitState).toBe("VERIFIED");
    expect(rowsOf(r).map(n => n.dataset.projectCockpit).sort()).toEqual(projects.map(p => p.projectId).sort());
    for (const p of projects) {
      const row = rowsOf(r).find(n => n.dataset.projectCockpit === p.projectId)!;
      const mine = runs.filter(x => x.projectId === p.projectId), blocked = mine.filter(x => ["BLOCKED", "QUARANTINED", "RECOVERY_FAILED"].includes(x.status));
      const pend = (ck.awaitingApproval.items as Array<{projectId: string}>).filter(x => x.projectId === p.projectId);
      expect(all(cellOf(row, "runs")).find(n => n.className === "pc-value")?.textContent, p.name).toBe(String(mine.length));
      expect(all(cellOf(row, "blockers")).find(n => n.className === "pc-value")?.textContent, p.name).toBe(String(blocked.length));
      expect(all(cellOf(row, "approvals")).find(n => n.className === "pc-value")?.textContent, p.name).toBe(String(pend.length));
      expect([cellOf(row, "spend").dataset.pcState, cellOf(row, "spend").textContent]).toEqual(["UNAVAILABLE", "Spend—Not available: the Control API has no spend endpoint yet."]);
    }
    const alpha = rowsOf(r).find(n => n.textContent.startsWith("Alpha"))!, beta = rowsOf(r).find(n => n.textContent.startsWith("Beta"))!;
    expect(cellOf(alpha, "runs").textContent).toMatch(/^Runs2(Blocked|BLOCKED)[^·]*1 · .*1$/);
    expect(cellOf(alpha, "blockers").textContent).toContain("needs credentials token=");
    expect(panelOf(r).textContent).not.toContain(PLANTED);
    expect(cellOf(alpha, "approvals").textContent).toContain("Needs sign-off · R3");
    expect(beta.textContent).toBe("BetaRuns0No runs yetBlockers0NoneMissions awaiting approval0NoneSpend—Not available: the Control API has no spend endpoint yet.");
    expect(all(panelOf(r)).some(n => n.dataset.pcPartial !== undefined)).toBe(false);
    // the spend cell never shows a number in any row
    for (const row of rowsOf(r)) expect(cellOf(row, "spend").textContent).not.toMatch(/\d/);
  });

  it("empty: a real server with no projects renders an honest empty state (not a failure)", { timeout: 120_000 }, async () => {
    const app = mkApp(() => undefined);
    const r = await renderAgainstServer(app, "home");
    expect(r.thrown).toEqual([]); expect(failureMarks(r.root)).toEqual([]);
    expect(all(panelOf(r)).find(n => n.dataset.projectCockpitState !== undefined)?.dataset.projectCockpitState).toBe("EMPTY");
    expect(panelOf(r).textContent).toBe("Projects at a glanceNo projects yet.");
  });

  for (const [code, state, text] of [[500, "ERROR", "Error"], [404, "UNAVAILABLE", "Unavailable (UNAVAILABLE)"]] as const) {
    it(`${state.toLowerCase()}: /v1/run-summaries answers ${code}; runs and blockers say ${state}, approvals and projects stay real, spend stays an honest gap`, { timeout: 120_000 }, async () => {
      const app = mkApp(cockpitSeed);
      app.addHook("onRequest", async (req, reply) => { if (req.url.startsWith("/v1/run-summaries")) return reply.code(code).send({error: "INJECTED"}); });
      const r = await renderAgainstServer(app, "home");
      expect(r.results.find(x => x.path.startsWith("/v1/run-summaries"))).toMatchObject({ok: false, state, message: `/v1/run-summaries?limit=100: HTTP ${code}`});
      expect(rowsOf(r)).toHaveLength(2);
      for (const row of rowsOf(r)) {
        for (const k of ["runs", "blockers"]) expect([k, cellOf(row, k).dataset.pcState, cellOf(row, k).textContent]).toEqual([k, state, `${k === "runs" ? "Runs" : "Blockers"}${text}`]);
        expect(cellOf(row, "approvals").dataset.pcState).toBe("VERIFIED");
        expect(cellOf(row, "spend").dataset.pcState).toBe("UNAVAILABLE");
      }
      expect(cellOf(rowsOf(r).find(n => n.textContent.startsWith("Alpha"))!, "approvals").textContent).toContain("Needs sign-off · R3");
      expect(failureMarks(r.root).length > 0).toBe(code === 500);
    });
  }

  it("approvals error: when /v1/cockpit fails the approvals cell says ERROR (never 0) while runs and blockers stay real", { timeout: 120_000 }, async () => {
    const app = mkApp(cockpitSeed);
    app.addHook("onRequest", async (req, reply) => { if (req.url === "/v1/cockpit") return reply.code(500).send({error: "INJECTED"}); });
    const r = await renderAgainstServer(app, "home");
    expect(rowsOf(r)).toHaveLength(2);
    for (const row of rowsOf(r)) expect([cellOf(row, "approvals").dataset.pcState, cellOf(row, "approvals").textContent]).toEqual(["ERROR", "Missions awaiting approvalError"]);
    const alpha = rowsOf(r).find(n => n.textContent.startsWith("Alpha"))!;
    expect([cellOf(alpha, "runs").dataset.pcState, all(cellOf(alpha, "runs")).find(n => n.className === "pc-value")?.textContent]).toEqual(["VERIFIED", "2"]);
    expect(all(cellOf(alpha, "blockers")).find(n => n.className === "pc-value")?.textContent).toBe("1");
  });

  it("projects unavailable: when /v1/projects fails the panel shows the classified state and no rows", { timeout: 120_000 }, async () => {
    const app = mkApp(cockpitSeed);
    app.addHook("onRequest", async (req, reply) => { if (req.url === "/v1/projects") return reply.code(500).send({error: "INJECTED"}); });
    const r = await renderAgainstServer(app, "home");
    expect(rowsOf(r)).toEqual([]);
    expect(all(panelOf(r)).find(n => n.dataset.projectCockpitState !== undefined)?.dataset.projectCockpitState).toBe("ERROR");
    expect(panelOf(r).textContent).toBe("Projects at a glanceError");
  });

  it("partial: with more runs than one page (101 real runs, limit 100) both the Runs and Blockers cells label the counts as partial", { timeout: 180_000 }, async () => {
    const app = mkApp((dataDir: string) => {
      cockpitSeed(dataDir);
      const store = new WorkOsStore(dataDir), tenantId = "tA", scope = {tenantId};
      const [a] = store.listProjects(scope).filter(p => p.name === "Alpha");
      for (let i = 0; i < 99; i++) {
        const m = store.createMission({tenantId, projectId: a!.projectId, title: `bulk ${i}`, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER}).missionId;
        for (const to of ["PREFLIGHT", "AUTHORIZED"]) store.transitionMission(scope, m, to as any, "go", RECORDER);
        store.createRun({tenantId, missionId: m, executor: {implementer: `I-b${i}`, reviewer: `R-b${i}`}, createdBy: RECORDER});
      }
    });
    const page = (await serverJson(app, "/v1/run-summaries?limit=100")).page;
    expect([page.runs.length, page.total, typeof page.nextCursor]).toEqual([100, 101, "string"]);
    const r = await renderAgainstServer(app, "home");
    const alpha = rowsOf(r).find(n => n.textContent.startsWith("Alpha"))!;
    for (const k of ["runs", "blockers"]) expect([k, all(cellOf(alpha, k)).find(n => n.dataset.pcPartial === k)?.textContent]).toEqual([k, "Counted from the latest 100 of 101 runs."]);
    expect(failureMarks(r.root)).toEqual([]);
  });

  it("approvals over 200 (#363 LOW-2): the KPI tile and every project's approvals cell say the list is truncated; counts are never silently short", { timeout: 180_000 }, async () => {
    const app = mkApp((dataDir: string) => {
      cockpitSeed(dataDir);
      const store = new WorkOsStore(dataDir), tenantId = "tA", scope = {tenantId};
      const [a] = store.listProjects(scope).filter(p => p.name === "Alpha");
      for (let i = 0; i < 204; i++) {
        const m = store.createMission({tenantId, projectId: a!.projectId, title: `wait ${i}`, objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER}).missionId;
        store.transitionMission(scope, m, "PREFLIGHT" as any, "go", RECORDER);
      }
    });
    const total = ((await serverJson(app, "/v1/cockpit")).awaitingApproval.items as unknown[]).length;
    expect(total).toBe(205);
    const r = await renderAgainstServer(app, "home");
    expect(kpiText(r.root, "approvals")).toContain("Only the first 200 of 205 are counted here; open the Inbox for all.");
    for (const row of rowsOf(r)) expect(all(cellOf(row, "approvals")).find(n => n.dataset.pcPartial === "approvals")?.textContent, row.textContent.slice(0, 5)).toBe("Counted from the first 200 of 205 pending approvals.");
    expect(failureMarks(r.root)).toEqual([]);
  });

  it("approvals at or under 200: no truncation note on the KPI tile or any project cell (positive control)", { timeout: 120_000 }, async () => {
    const app2 = mkApp(cockpitSeed);
    const r2 = await renderAgainstServer(app2, "home");
    expect(kpiText(r2.root, "approvals")).not.toContain("Only the first");
    expect(all(panelOf(r2)).some(n => n.dataset.pcPartial === "approvals")).toBe(false);
  });

  it("mapCockpit truncation flag is additive: approvals.value/items keep their old meaning for every other caller (shell badge, inbox, executive)", async () => {
    const model = await load("model.js");
    const item = (i: number) => ({missionId: `msn_${String(i).padStart(24, "0")}`, projectId: "prj_a", title: `t${i}`, riskLevel: "R1"});
    const raw = (n: number) => ({generatedAt: "2026-11-05T10:00:00.000Z", awaitingApproval: {state: "VERIFIED", items: Array.from({length: n}, (_, i) => item(i))}, projects: {state: "VERIFIED", count: 1}, missions: {state: "VERIFIED", total: n, byStatus: {PREFLIGHT: n}}});
    const at = model.mapCockpit(raw(200)), over = model.mapCockpit(raw(250));
    expect([at.approvals.value, at.approvals.items.length, at.approvals.truncated, at.approvals.total]).toEqual([200, 200, false, 200]);
    expect([over.approvals.value, over.approvals.items.length, over.approvals.truncated, over.approvals.total]).toEqual([200, 200, true, 250]);
    // nothing else in the model changes with truncation
    const strip = (c: any) => ({...c, approvals: {...c.approvals, truncated: undefined, total: undefined}, missions: undefined});
    expect(strip(over)).toEqual(strip(at));
    for (const st of ["ERROR", "UNAVAILABLE"]) { const c = model.mapCockpit({awaitingApproval: {state: st, items: [item(1)]}}); expect([c.approvals.value, c.approvals.items, c.approvals.truncated, c.approvals.total]).toEqual([null, [], false, null]); }
    expect(model.emptyCockpit().approvals.items).toEqual([]);
  });

  it("tr: the panel is localized from the real server render", { timeout: 120_000 }, async () => {
    const app = mkApp(cockpitSeed);
    const r = await renderAgainstServer(app, "home", TOKEN, "tr");
    const beta = rowsOf(r).find(n => n.textContent.startsWith("Beta"))!;
    expect(panelOf(r).textContent.startsWith("Projelere genel bakış")).toBe(true);
    expect(beta.textContent).toBe("BetaKoşular0Henüz koşu yokEngeller0YokOnay bekleyen görevler0YokHarcama—Kullanılamıyor: Control API'de henüz harcama uç noktası yok.");
  });

  it("pure core: partial pages, unknown statuses and malformed bodies are honest", async () => {
    const core = await load("project-cockpit-core.js");
    expect(core.mapRunSummaries({page: {runs: [], nextCursor: null, total: 0}})).toEqual({state: "VERIFIED", runs: [], total: 0, partial: false});
    for (const bad of [null, {}, {page: {}}, {page: {runs: [], total: -1, nextCursor: null}}, {page: {runs: [], total: 1.5, nextCursor: null}}, {page: {runs: {}, total: 0, nextCursor: null}}, {page: {runs: [], total: 0, nextCursor: 5}}])
      expect(core.mapRunSummaries(bad).state, JSON.stringify(bad)).toBe("ERROR");
    const m = core.mapRunSummaries({page: {runs: [{runId: "run_1", projectId: "prj_a", status: "WEIRD"}, {runId: "run_2", projectId: "prj_a", status: "BLOCKED", reason: "x"}], nextCursor: "c", total: 250}});
    expect(m).toMatchObject({state: "VERIFIED", total: 250, partial: true}); expect(m.runs[0].status).toBe("UNKNOWN");
    const pc = core.buildProjectCockpit({projects: {state: "VERIFIED", items: [{projectId: "prj_a", name: "A"}]}, approvals: {state: "STALE", items: [{projectId: "prj_a", missionId: "m", title: "T", riskLevel: "R1"}]}, runs: m});
    expect(pc.rows[0]).toMatchObject({runs: {state: "VERIFIED", count: 2, partial: true, shown: 2, total: 250}, blockers: {count: 1}, approvals: {state: "STALE", count: 1}, spend: {state: "UNAVAILABLE", reason: "NO_SPEND_ENDPOINT"}});
    // LOW-1: client-side re-redaction is pinned independently of the server's redactSecrets
    const raw = core.buildProjectCockpit({projects: {state: "VERIFIED", items: [{projectId: "prj_a", name: "A"}]}, approvals: {state: "VERIFIED", items: []},
      runs: {state: "VERIFIED", partial: false, total: 1, runs: [{runId: "run_x", projectId: "prj_a", status: "BLOCKED", reason: `token=${PLANTED}`}]}});
    expect(raw.rows[0].blockers.count).toBe(1); expect(JSON.stringify(raw)).not.toContain(PLANTED);
    expect(core.buildProjectCockpit({projects: {state: "OFFLINE", items: []}, approvals: {state: "VERIFIED", items: []}, runs: m})).toEqual({state: "OFFLINE", rows: []});
    expect(core.buildProjectCockpit({projects: {state: "VERIFIED", items: [{projectId: "prj_a", name: "A"}]}, approvals: {state: "UNAVAILABLE", items: []}, runs: {state: "OFFLINE"}}).rows[0])
      .toMatchObject({runs: {state: "OFFLINE"}, blockers: {state: "OFFLINE"}, approvals: {state: "UNAVAILABLE"}});
  });
});

// //TR: UASCO-T0019: Ana Sayfa bildirim akışı GERÇEK buildServer'a karşı: /v1/attention + /v1/run-summaries'ten türetilen bildirimler, türe göre gruplar, okunmamış rozeti,
// renderer deposunda okundu bilgisi (depo yoksa dürüst not), gerçek hedef ekran + seçili görev ile derin bağlantı; boş, hata (500), kullanılamıyor (404) ve tr.
describe("UASCO-T0019: home notification feed (unread/read, groups, deep links) against the real buildServer", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0019-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
  const notifySeed = (dataDir: string) => {
    cockpitSeed(dataDir);
    const store = new WorkOsStore(dataDir), tenantId = "tA", scope = {tenantId};
    const [a] = store.listProjects(scope).filter(p => p.name === "Alpha");
    const m = store.createMission({tenantId, projectId: a!.projectId, title: "halt", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER}).missionId;
    for (const to of ["PREFLIGHT", "AUTHORIZED"]) store.transitionMission(scope, m, to as any, "go", RECORDER);
    const r = store.createRun({tenantId, missionId: m, executor: {implementer: "I-halt", reviewer: "R-halt"}, createdBy: RECORDER});
    const leaseId = store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string;
    store.transitionRun(r.runId, leaseId, "RUNNING", "go", "ENGINE"); store.transitionRun(r.runId, leaseId, "CANCELLING", "stop", "ENGINE"); store.transitionRun(r.runId, leaseId, "CANCELLED", `operator stop token=${PLANTED}`, "ENGINE");
  };
  const memStorage = () => { const m = new Map<string, string>(); return {m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }}; };
  const feedOf = (r: {root: N}) => all(r.root).find(n => n.id === "home-notify")!;
  const stateOf = (r: {root: N}) => all(feedOf(r)).find(n => n.dataset.notifyState !== undefined)?.dataset.notifyState;
  const itemsOf = (r: {root: N}) => all(feedOf(r)).filter(n => n.dataset.notifyId !== undefined);
  const badgeOf = (r: {root: N}) => all(feedOf(r)).find(n => n.dataset.notifyUnread !== undefined)!;
  const navSpy = () => { const calls: string[] = []; return {calls, navigate: (id: string) => { calls.push(id); }}; };

  it("loaded: every notification is derived from the real /v1/attention + /v1/run-summaries, grouped by type with an unread badge; a run already in attention is not repeated", { timeout: 120_000 }, async () => {
    const app = mkApp(notifySeed), st = memStorage();
    const r = await renderAgainstServer(app, "home", TOKEN, "en", {storage: st});
    expect(r.thrown).toEqual([]); expect(failureMarks(r.root)).toEqual([]);
    const att = (await serverJson(app, "/v1/attention")).attention.items as Array<{kind: string; title: string; runId: string | null; missionId: string}>;
    const runs = (await serverJson(app, "/v1/run-summaries?limit=100")).page.runs as Array<{runId: string; status: string; missionId: string}>;
    const claimed = new Set(att.map(x => x.runId).filter(Boolean));
    const runItems = runs.filter(x => ["SUCCEEDED", "FAILED", "BLOCKED", "QUARANTINED", "RECOVERY_FAILED", "CANCELLED"].includes(x.status) && !claimed.has(x.runId));
    expect(att.length).toBeGreaterThan(0); expect(runItems.map(x => x.status)).toEqual(["CANCELLED"]);
    expect(stateOf(r)).toBe("VERIFIED");
    expect(itemsOf(r)).toHaveLength(att.length + runItems.length);
    expect(badgeOf(r).dataset.notifyUnread).toBe(String(att.length + runItems.length));
    expect(badgeOf(r).textContent).toBe(`${att.length + runItems.length} unread`);
    const groupOfKind: Record<string, string> = {RUN_AWAITING_APPROVAL: "APPROVAL", MISSION_AUTHORIZATION_PENDING: "APPROVAL", RUN_NEEDS_DECISION: "DECISION", MISSION_FOUNDER_ATTENTION: "DECISION", MISSION_BLOCKED: "BLOCKED", TASK_BLOCKED: "BLOCKED"};
    const want: Record<string, number> = {}; for (const x of att) want[groupOfKind[x.kind]!] = (want[groupOfKind[x.kind]!] ?? 0) + 1; if (runItems.length) want.RUN = runItems.length;
    const groups = all(feedOf(r)).filter(n => n.dataset.notifyGroup !== undefined);
    expect(Object.fromEntries(groups.map(g => [g.dataset.notifyGroup, all(g).filter(n => n.dataset.notifyId !== undefined).length]))).toEqual(want);
    expect(groups.map(g => g.dataset.notifyGroup)).toEqual(["APPROVAL", "DECISION", "BLOCKED", "RUN", "DELIVERY"].filter(g => want[g]));
    // deep-link targets: approvals/decisions -> inbox, run results -> work; each carries its real mission
    for (const it of itemsOf(r)) {
      const btn = all(it).find(n => n.tagName === "BUTTON")!, id = it.dataset.notifyId!;
      const route = id.startsWith("att:MISSION_AUTHORIZATION_PENDING") || id.startsWith("att:RUN_AWAITING_APPROVAL") || id.startsWith("att:RUN_NEEDS_DECISION") || id.startsWith("att:MISSION_FOUNDER_ATTENTION") ? "inbox" : id.startsWith("run:") ? "work" : id.startsWith("dlv:") ? "delivery" : "work";
      expect([id, btn.dataset.notifyRoute]).toEqual([id, route]);
      const src = id.startsWith("run:") ? runs.find(x => id.startsWith(`run:${x.runId}:`)) : att.find(x => id.includes(`:${x.runId ?? x.missionId}:`));
      expect([id, btn.dataset.notifyMission]).toEqual([id, src!.missionId]);
    }
    expect(feedOf(r).textContent).toContain("Run cancelled"); expect(feedOf(r).textContent).toContain("operator stop token=");
    expect(feedOf(r).textContent).not.toContain(PLANTED);
    expect(feedOf(r).textContent).toContain("Mission awaiting authorization"); expect(feedOf(r).textContent).toContain("Needs sign-off");
  });

  it("deep link + read state: opening an item stores it as read, selects its mission and navigates; re-render shows it read and the badge drops; mark-all clears the badge", { timeout: 120_000 }, async () => {
    const app = mkApp(notifySeed), st = memStorage(), nav = navSpy(), forms = await load("forms.js");
    forms.selection.missionId = null;
    const r1 = await renderAgainstServer(app, "home", TOKEN, "en", {storage: st, navigate: nav.navigate});
    const total = itemsOf(r1).length, first = itemsOf(r1).find(n => n.dataset.notifyId!.startsWith("run:"))!;
    const btn = all(first).find(n => n.tagName === "BUTTON")!;
    (btn as any).ls.get("click")[0]({});
    expect(nav.calls).toEqual(["work"]);
    expect(forms.selection.missionId).toBe(btn.dataset.notifyMission);
    expect(JSON.parse(st.m.get("uasco.notify.read.v1")!)).toEqual([first.dataset.notifyId]);
    const r2 = await renderAgainstServer(app, "home", TOKEN, "en", {storage: st, navigate: nav.navigate});
    expect(badgeOf(r2).dataset.notifyUnread).toBe(String(total - 1));
    const again = itemsOf(r2).find(n => n.dataset.notifyId === first.dataset.notifyId)!;
    expect(again.dataset.notifyRead).toBe("1"); expect(again.textContent).toContain("Read · ");
    expect(itemsOf(r2).at(-1)!.dataset.notifyId).toBe(first.dataset.notifyId); // read items sort after unread
    const markAll = all(feedOf(r2)).find(n => n.dataset.notifyMarkAll !== undefined)!;
    expect(markAll.attrs.has("disabled")).toBe(false);
    (markAll as any).ls.get("click")[0]({});
    const r3 = await renderAgainstServer(app, "home", TOKEN, "en", {storage: st});
    expect([badgeOf(r3).dataset.notifyUnread, badgeOf(r3).textContent]).toEqual(["0", "0 unread"]);
    expect(itemsOf(r3).every(n => n.dataset.notifyRead === "1")).toBe(true);
    expect(all(feedOf(r3)).find(n => n.dataset.notifyMarkAll !== undefined)!.attrs.has("disabled")).toBe(true);
    // an approval opens the inbox with its mission selected
    const appr = itemsOf(r3).find(n => n.dataset.notifyId!.startsWith("att:MISSION_AUTHORIZATION_PENDING"))!;
    const ab = all(appr).find(n => n.tagName === "BUTTON")!; const nav2 = navSpy();
    const r4 = await renderAgainstServer(app, "home", TOKEN, "en", {storage: st, navigate: nav2.navigate});
    (all(itemsOf(r4).find(n => n.dataset.notifyId === appr.dataset.notifyId)!).find(n => n.tagName === "BUTTON") as any).ls.get("click")[0]({});
    expect(nav2.calls).toEqual(["inbox"]); expect(forms.selection.missionId).toBe(ab.dataset.notifyMission);
  });

  it("no storage / broken storage: honest note, everything unread, mark-all disabled, deep links still work", { timeout: 120_000 }, async () => {
    const app = mkApp(notifySeed);
    for (const storage of [null, {getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }}]) {
      const nav = navSpy();
      const r = await renderAgainstServer(app, "home", TOKEN, "en", {storage, navigate: nav.navigate});
      expect(all(feedOf(r)).some(n => n.dataset.notifyNoStore === "1")).toBe(true);
      expect(feedOf(r).textContent).toContain("Read state cannot be saved on this device; every notification shows as unread.");
      expect(itemsOf(r).every(n => n.dataset.notifyRead === "0")).toBe(true);
      expect(badgeOf(r).dataset.notifyUnread).toBe(String(itemsOf(r).length));
      expect(all(feedOf(r)).find(n => n.dataset.notifyMarkAll !== undefined)!.attrs.has("disabled")).toBe(true);
      (all(itemsOf(r)[0]!).find(n => n.tagName === "BUTTON") as any).ls.get("click")[0]({});
      expect(nav.calls).toHaveLength(1);
    }
  });

  it("empty: a real server with nothing to report shows an honest EMPTY feed with a 0 badge (not a failure)", { timeout: 120_000 }, async () => {
    const app = mkApp(() => undefined);
    const r = await renderAgainstServer(app, "home", TOKEN, "en", {storage: memStorage()});
    expect(stateOf(r)).toBe("EMPTY"); expect(failureMarks(r.root)).toEqual([]);
    expect(feedOf(r).textContent).toBe("Notifications0 unreadMark all as readNo notifications right now.");
  });

  for (const [code, state, text] of [[500, "ERROR", "Error"], [404, "UNAVAILABLE", "Unavailable (UNAVAILABLE)"]] as const) {
    it(`attention ${code}: the feed is PARTIAL, says "Approvals and blockers: ${text}", and still lists the real run results`, { timeout: 120_000 }, async () => {
      const app = mkApp(notifySeed);
      app.addHook("onRequest", async (req, reply) => { if (req.url === "/v1/attention") return reply.code(code).send({error: "INJECTED"}); });
      const r = await renderAgainstServer(app, "home", TOKEN, "en", {storage: memStorage()});
      expect(stateOf(r)).toBe("PARTIAL");
      expect(all(feedOf(r)).find(n => n.dataset.notifySource === "attention")?.textContent).toBe(`Approvals and blockers: ${text}`);
      expect(all(feedOf(r)).find(n => n.dataset.notifySource === "attention")?.className).toBe(`note note-${state.toLowerCase()}`);
      // with attention down nothing claims the runs, so every finished run is listed from the real server
      const runs = (await serverJson(app, "/v1/run-summaries?limit=100")).page.runs as Array<{status: string}>;
      expect(itemsOf(r).map(n => n.dataset.notifyId!.split(":")[0])).toEqual(runs.filter(x => ["CANCELLED", "FAILED", "BLOCKED"].includes(x.status)).map(() => "run"));
      expect(all(feedOf(r)).some(n => n.dataset.notifyGroup === "APPROVAL")).toBe(false);
    });
  }

  it("both sources fail: the feed says ERROR, the badge is unknown (—), never 0", { timeout: 120_000 }, async () => {
    const app = mkApp(notifySeed);
    app.addHook("onRequest", async (req, reply) => { if (req.url === "/v1/attention" || req.url.startsWith("/v1/run-summaries")) return reply.code(500).send({error: "INJECTED"}); });
    const r = await renderAgainstServer(app, "home", TOKEN, "en", {storage: memStorage()});
    expect(stateOf(r)).toBe("ERROR"); expect(itemsOf(r)).toEqual([]);
    expect([badgeOf(r).dataset.notifyUnread, badgeOf(r).textContent]).toEqual(["", "—"]);
    expect(all(feedOf(r)).find(n => n.dataset.notifyMarkAll !== undefined)!.attrs.has("disabled")).toBe(true);
    expect(failureMarks(feedOf(r)).length).toBeGreaterThan(0);
  });

  it("keyboard reach (60-Tab budget): Home starts with skip buttons that move focus to each long panel's heading, so every panel is reachable in a few presses", { timeout: 120_000 }, async () => {
    const app = mkApp(notifySeed);
    const r = await renderAgainstServer(app, "home", TOKEN, "en", {storage: memStorage()});
    const home = await load("views", "home.js");
    // a tab stop: native focusable (button, link with href, form field) or tabindex >= 0; never disabled or tabindex -1
    const isStop = (n: N) => !n.attrs.has("disabled") && n.attrs.get("tabindex") !== "-1" && (["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(n.tagName) || (n.tagName === "A" && n.attrs.has("href")) || Number(n.attrs.get("tabindex")) >= 0);
    const stops = all(r.root).filter(isStop);
    const targets = home.HOME_SKIP_TARGETS.map(([id]: [string]) => id);
    expect(targets).toEqual(["home-notify", "home-projects", "home-map", "home-orch"]);
    // the skip buttons are the first tab stops on the page, in panel order
    expect(stops.slice(0, targets.length).map(n => n.dataset.skipTo)).toEqual(targets);
    expect(all(r.root).find(n => n.tagName === "NAV" && n.className === "home-skip")?.attrs.get("aria-label")).toBe("Jump to a section");
    for (const [i, id] of targets.entries()) {
      const btn = stops[i]!, sec = all(r.root).find(n => n.id === id)!, head = sec.children[0]!;
      expect([id, head.tagName, head.id]).toEqual([id, "H2", `${id}-t`]);
      let focused = false; (head as any).focus = () => { focused = true; };
      (btn as any).ls.get("click")[0]({});
      expect([id, focused, head.attrs.get("tabindex")]).toEqual([id, true, "-1"]);
      // presses to land in the panel: Tab to its skip button (i+1) + Enter
      expect(i + 2, id).toBeLessThanOrEqual(60);
      expect(btn.textContent).toBe(`Jump to ${head.textContent}`);
    }
    // without the skip links, panels that hold no tab stop (projects, orchestrator) cannot be reached with Tab at all
    const inside = (id: string) => all(all(r.root).find(n => n.id === id)!).filter(isStop).length;
    expect(inside("home-projects")).toBe(0); expect(inside("home-orch")).toBe(0);
    // and the whole page stays within the per-page budget of 60 tab stops on this real seed
    expect(stops.length).toBeLessThanOrEqual(60);
  });

  it("tr: the feed is localized from the real server render", { timeout: 120_000 }, async () => {
    const app = mkApp(notifySeed);
    const r = await renderAgainstServer(app, "home", TOKEN, "tr", {storage: memStorage()});
    expect(feedOf(r).textContent.startsWith(`Bildirimler${itemsOf(r).length} okunmamışTümünü okundu say`)).toBe(true);
    expect(feedOf(r).textContent).toContain("Yetki bekleyen görev"); expect(feedOf(r).textContent).toContain("Koşu iptal edildi");
  });

  it("pure core: delivery stage links to delivery, dedupe by id and claimed run, order, corrupt/capped storage, unread helper", async () => {
    const core = await load("notifications-core.js");
    const run = (runId: string, status: string, delivery: Record<string, boolean> = {}, updatedAt = "2026-11-05T10:00:00.000Z") => ({runId, projectId: "prj_a", missionId: "msn_a", status, reason: null, updatedAt, delivery: {artifactPrepared: false, sourceAccepted: false, productVerified: false, ...delivery}});
    const runs = {state: "VERIFIED", partial: false, runs: [run("r1", "SUCCEEDED", {artifactPrepared: true, sourceAccepted: true}), run("r2", "RUNNING", {}, "2026-11-05T11:00:00.000Z"), run("r3", "FAILED", {}, "2026-11-05T09:00:00.000Z")]};
    const attention = {state: "VERIFIED", queue: {truncated: false, dropped: 0, items: [{kind: "RUN_NEEDS_DECISION", nextAction: "REVIEW_RUN", projectId: "prj_a", missionId: "msn_a", runId: "r3", taskId: null, title: "T", reason: null, since: "2026-11-05T12:00:00.000Z"}]}};
    const f = core.buildNotifications({attention, runs, read: {available: true, ids: new Set(["dlv:r1:sourceAccepted"])}});
    expect(f.items.map((n: any) => [n.id, n.route, n.read])).toEqual([
      ["att:RUN_NEEDS_DECISION:r3:2026-11-05T12:00:00.000Z", "inbox", false], ["run:r1:SUCCEEDED:2026-11-05T10:00:00.000Z", "work", false], ["dlv:r1:sourceAccepted", "delivery", true]]);
    expect([f.unread, f.state, f.groups]).toEqual([2, "VERIFIED", {DECISION: {count: 1, unread: 1}, RUN: {count: 1, unread: 1}, DELIVERY: {count: 1, unread: 0}}]);
    expect(core.notificationsUnread(f)).toBe(2); expect(core.notificationsUnread(core.buildNotifications({attention: {state: "OFFLINE"}, runs: {state: "OFFLINE"}}))).toBe(null);
    expect(core.buildNotifications({attention, runs: {...runs, partial: true}, read: {available: true, ids: new Set()}}).partial).toBe(true);
    expect(core.buildNotifications({attention: {...attention, queue: {...attention.queue, truncated: true}}, runs, read: {available: true, ids: new Set()}}).partial).toBe(true);
    const bad = {getItem: () => "{not json", setItem: () => undefined};
    expect(core.loadReadIds(bad).available).toBe(false);
    expect(core.loadReadIds({getItem: () => JSON.stringify({x: 1})})).toEqual({available: true, ids: new Set()});
    expect([...core.loadReadIds({getItem: () => JSON.stringify(["ok:1", 5, "bad id with spaces", "ok:2"])}).ids]).toEqual(["ok:1", "ok:2"]);
    const big = new Set(Array.from({length: 600}, (_, i) => `n:${i}`)); const m = new Map<string, string>();
    expect(core.saveReadIds({setItem: (k: string, v: string) => { m.set(k, v); }}, big)).toBe(true);
    const saved = JSON.parse(m.get(core.NOTIFY_READ_KEY)!); expect(saved).toHaveLength(500); expect(saved[0]).toBe("n:100");
    expect(core.saveReadIds({setItem: () => { throw new Error("quota"); }}, big)).toBe(false);
    expect(core.saveReadIds(null, big)).toBe(false);
    // defence in depth: reasons are re-redacted client-side even if a server ever sent one raw
    const leak = core.buildNotifications({attention: {state: "VERIFIED", queue: {truncated: false, dropped: 0, items: [{...attention.queue.items[0], runId: "r9", reason: `api_key=${PLANTED}`}]}},
      runs: {state: "VERIFIED", partial: false, runs: [{...run("r8", "FAILED"), reason: `token=${PLANTED}`}]}, read: {available: true, ids: new Set()}});
    expect(leak.items).toHaveLength(2); expect(JSON.stringify(leak.items)).not.toContain(PLANTED);
  });
});
}
