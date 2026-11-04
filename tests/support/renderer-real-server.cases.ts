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
  const mod = await load("views", `${view}.js`);
  const root: N = await mod.render(ctx);
  const paths = [...new Set(seen.map(s => s.path.replace(/\?.*$/, "")))].sort();
  // api.get sonuçları (store.cache): görünümün ne gördüğünü — başarı mı, sınıflanmış hata mı — doğrudan gösterir (hata yutulursa ok:true olurdu)
  const results = await Promise.all([...store.cache.entries()].map(async ([k, v]: [string, {promise: Promise<{ok: boolean; state?: string; message?: string}>}]) => ({path: k, ...(await v.promise)})));
  return {root, seen, paths, attention, refused, thrown, results, text: root.textContent};
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
    expect(handler, "main.mjs uasco:api-get handler shape").not.toBeNull();
    expect(new Function(`return ${handler![1]}`)()).toEqual(SYNTHETIC_HEALTH);
    expect(desktopAllows("/v1/not-a-route"), "the allow-list is a real filter").toBe(false);
  });

  for (const view of Object.keys(PATHS)) {
    it(`${view}: happy path against the real server (every read 200, no failure state, real data shown)`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view);
      expect(r.paths, `${view} reads`).toEqual(PATHS[view]);
      expect(r.seen.filter(s => s.status !== 200), `${view}: non-200 reads`).toEqual([]);
      expect(r.refused, `${view}: every read passes main.mjs's GET allow-list (N1a)`).toEqual([]);
      expect(r.thrown, `${view}: no bridge failure`).toEqual([]);
      expect(r.results.filter(x => !x.ok).map(x => x.path), `${view}: every api.get result is ok`).toEqual([]);
      expect(failureMarks(r.root), `${view}: failure states`).toEqual([]);
      await HAPPY[view](app, r);
    });

    // //TR: N2 (#318 incelemesi): hata yolu yalnız "bir hata işareti var" demez; görünümün gördüğü HER okuma sonucu (api.get / store.cache) ok:false ve sınıflanmış ERROR'dur,
    // ileti köprünün gerçek hatasıdır. Üretimde (main.mjs) yanlış belirteç önce kimlik el sıkışmasında yakalanır (CONTROL_API_IDENTITY_UNVERIFIED; /v1'e hiç gidilmez);
    // aynı belirteçle sunucunun her /v1 yolunu 403 ile reddettiği ayrıca doğrudan doğrulanır. Hata yutan bir api.get 10 görünümün hepsinde bu testi düşürür.
    it(`${view}: error path (control token mismatch: identity handshake fails as in main.mjs; the real server refuses the same token with 403) renders an honest, classified failure and never throws`, { timeout: 120_000 }, async () => {
      const app = mkApp();
      const r = await renderAgainstServer(app, view, WRONG);
      expect(r.refused, `${view}: allow-list`).toEqual([]);
      expect(r.results.length, `${view}: reads attempted`).toBeGreaterThan(0);
      expect(r.results.map(x => x.path).sort(), `${view}: the same reads as the happy path`).toEqual(expect.arrayContaining(PATHS[view].filter(p => p !== "/health" && !p.includes("/v1/roles") && !p.includes("/v1/deliveries")).map(p => expect.stringMatching(new RegExp(`^${p.replace(/[/.]/g, "\\$&")}(\\?|$)`)))));
      for (const x of r.results) expect([view, x.path, x.ok, x.state, x.message]).toEqual([view, x.path, false, "ERROR", "CONTROL_API_IDENTITY_UNVERIFIED"]);
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
}
