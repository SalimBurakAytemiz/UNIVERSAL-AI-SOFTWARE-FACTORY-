// //TR: Bu test (Builder I) Kuyruk ve Hazırlık ekranlarında koşu durumunun okunur etiketle gösterildiğini ve Control Tower bulut işleri panelinin yerelleştirildiğini, ham IPC hata metni göstermediğini gerçek control-api ile doğrular.
// Builder I — Control Tower / Operations UX, against the REAL control-api (buildServer + app.inject) behind the desktop
// bridge's own GET/POST allow-lists. Each test pins one defect fix and carries a positive control:
//  (1) Queue and Readiness show a run's status as its readable label (mstatus.*), the raw code kept in data/title;
//  (2) Control Tower's cloud-jobs panel is localised (en/tr) and never shows the bridge's raw IPC error text, only a fixed code.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../core/workos/store.js";
import {buildServer} from "../apps/control-api/src/server.js";

vi.setConfig({testTimeout: 60_000, hookTimeout: 60_000});

const rend = path.resolve(__dirname, "..", "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const mainSrc = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string) => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(mainSrc); if (!m) throw new Error(`missing ${name}`); return m[1]; };
const extraGet = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const postGates = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  disabled?: boolean; isConnected = true;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "disabled") this.disabled = true; }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  contains(n: N | null): boolean { for (let c = n; c; c = c.parent) if (c === this) return true; return false; }
  focus() { /* test double */ } scrollIntoView() { /* test double */ }
}
class D {
  body: N; activeElement: N | null = null; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id);
const byData = (r: N, k: string, v?: string) => all(r).find(n => k in n.dataset && (v === undefined || n.dataset[k] === v));

const TOKEN = "t".repeat(32), hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, RECORDER = "implementer@local.invalid";
const ENV_KEYS = ["UASCO_WORKOS_EXECUTOR", "UASCO_WORKOS_RUNNER", "UASCO_CONTROL_ROOT"];
let tmp = ""; const saved: Record<string, string | undefined> = {}; const apps: Array<ReturnType<typeof buildServer>> = [];
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-i-tower-")); for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  const forms = await load("forms.js"); forms.resetAllForms?.();
  const st = await load("studio-state.js"); st.closeProject?.();
});


const IPC = (code: string) => `Error invoking remote method 'uasco:api-get': Error: ${code}`; // how Electron wraps a rejected main-process handler

async function setup(lang: "en" | "tr" = "en", {awaiting = true} = {}) {
  const sb = fs.mkdtempSync(path.join(tmp, "b-")), dataDir = path.join(sb, "data"), runtime = path.join(sb, "runtime"), controlRoot = path.join(sb, "control");
  for (const d of [runtime, controlRoot]) fs.mkdirSync(d, {recursive: true});
  const store = new WorkOsStore(dataDir), scope = {tenantId: "tA"};
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "Tower", environmentId: "env-dev", createdBy: RECORDER});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "Book club", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
  for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, m.missionId, to, "go", RECORDER);
  const r = store.createRun({tenantId: "tA", missionId: m.missionId, executor: {implementer: "IMPL", reviewer: "REV"}, createdBy: RECORDER});
  if (awaiting) {
    const leaseId = store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string;
    for (const s of ["RUNNING", "CHECKPOINTING", "AWAITING_APPROVAL"]) store.transitionRun(r.runId, leaseId, s as any, "t", "ENGINE", s === "RUNNING" ? {patch: {baseSha: "b".repeat(40), headSha: "a".repeat(40)}} : {});
  }
  const app = buildServer({controlToken: TOKEN, runtime, dataDir, tenantId: "tA", port: 3210, logger: false, controlRoot, runner: {enabled: false}}); apps.push(app);
  const baseGet = (await import("../automation/lib/control-boundary.mjs")).desktopGetPathAllowed as (v: unknown) => boolean;
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), cache = st.createStore(null);
  const bridge = {
    apiGet: async (p: string) => { if (!baseGet(p) && !extraGet(p)) throw new Error(IPC("INVALID_API_PATH")); const r = await app.inject({method: "GET", url: p, headers: hdr}); if (r.statusCode !== 200) throw new Error(IPC(`${p}: HTTP ${r.statusCode}`)); return r.json(); },
    apiPost: async () => ({status: 403, body: {error: "TEST_NO_WRITES"}})
  };
  const api = apiMod.createApi({bridge, store: cache});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store: cache, api, i18n: {lang, t}, t, navigate: () => {}, rerender: async () => {}, refreshAll: async () => {}, confirm: async () => false, selectProject() {}, renderAttention() {}, requestStop() {}, principal: "FOUNDER_LOCAL", settleFocus: () => {}};
  const routes = await load("routes.js"), planned = await load("views", "planned.js");
  const view = async (id: string) => { const root: N = await planned.render(ctx, routes.routeById(id)); doc.body.replaceChildren(root); return root; };
  return {app, ctx, doc, run: r, mission: m, view};
}

describe("Queue — the run status is a readable label, not a bare enum code", () => {
  it("en: an AWAITING_APPROVAL run reads 'Awaiting approval'; the raw code is in the pill's title and data", async () => {
    const s = await setup("en");
    const root = await s.view("queue");
    const pill = all(root).find(n => n.dataset.runStatusCode !== undefined)!;
    expect(pill).toBeDefined();
    expect(pill.dataset.runStatusCode).toBe("AWAITING_APPROVAL");
    expect(pill.getAttribute("title")).toBe("AWAITING_APPROVAL");
    expect(pill.textContent).toBe("Awaiting approval");
    expect(all(root).some(n => n.dataset.pill !== undefined && n.textContent === "AWAITING_APPROVAL")).toBe(false);
  });
  it("tr: localised", async () => {
    const s = await setup("tr");
    expect(all(await s.view("queue")).find(n => n.dataset.runStatusCode !== undefined)!.textContent).toBe("Onay bekliyor");
  });
  it("controls: a status missing from the dictionary stays its raw code; a QUEUED run is not in the approval queue", async () => {
    const comp = await load("components.js"), s = await setup("en", {awaiting: false});
    expect(comp.statusLabel(s.ctx, "SOME_NEW_STATUS")).toBe("SOME_NEW_STATUS");
    expect(all(await s.view("queue")).some(n => n.dataset.runStatusCode !== undefined)).toBe(false);
  });
});

describe("Readiness — the run gate shows the readable run state", () => {
  it("en and tr: the run gate and the missing list read the label; data-gate-detail keeps the raw code", async () => {
    for (const [lang, want] of [["en", "Awaiting approval"], ["tr", "Onay bekliyor"]] as const) {
      const s = await setup(lang);
      const root = await s.view("readiness");
      const gate = all(root).find(n => n.tagName === "DD" && n.dataset.gateDetail === "AWAITING_APPROVAL")!;
      expect(gate, lang).toBeDefined();
      expect(all(gate).find(n => n.dataset.pill !== undefined)!.textContent).toBe(want);
      const missing = all(root).find(n => n.tagName === "LI" && n.dataset.gate === "run" && n.dataset.gateDetail === "AWAITING_APPROVAL")!;
      expect(missing, lang).toBeDefined();
      expect(missing.textContent).toContain(want);
      expect(missing.textContent).not.toContain("AWAITING_APPROVAL");
    }
  });
});

describe("Control Tower — cloud jobs panel: localised, and no raw IPC error text", () => {
  const panelOf = (root: N) => byId(root, "cloud-jobs-status")!;
  it("en: the real bridge rejects /v1/cloud/jobs; the panel reads English and shows only the code INVALID_API_PATH", async () => {
    const s = await setup("en");
    const root: N = await (await load("views", "tower.js")).render(s.ctx);
    const p = panelOf(root);
    expect(p.dataset.cloudJobsState).toBe("UNAVAILABLE");
    expect(all(p).find(n => n.tagName === "H4")!.textContent).toBe("Cloud jobs");
    expect(byData(p, "cloudJobsStatus")!.textContent).toBe("Cloud job status is not available in this desktop build (UNAVAILABLE).");
    expect(byData(p, "cloudJobsCode")!.textContent).toBe("INVALID_API_PATH");
    expect(p.textContent).not.toContain("Error invoking remote method");
    expect(p.textContent).not.toContain("uasco:api-get");
  });
  it("tr: the panel reads Turkish", async () => {
    const s = await setup("tr");
    const p = panelOf(await (await load("views", "tower.js")).render(s.ctx));
    expect(all(p).find(n => n.tagName === "H4")!.textContent).toBe("Bulut işleri");
    expect(byData(p, "cloudJobsStatus")!.textContent).toBe("Bulut iş durumu bu masaüstü derlemesinde açık değil (UNAVAILABLE).");
  });
  it("pure: safeCloudCode keeps a fixed code, extracts the last CODE or HTTP status from a wrapped message, and drops free text", async () => {
    const {safeCloudCode} = await load("views", "tower.js");
    expect(safeCloudCode({state: "ERROR", code: "CLOUD_JOBS_MALFORMED"}).code).toBe("CLOUD_JOBS_MALFORMED");
    expect(safeCloudCode({state: "UNAVAILABLE", code: IPC("INVALID_API_PATH")}).code).toBe("INVALID_API_PATH");
    expect(safeCloudCode({state: "ERROR", code: IPC("/v1/cloud/jobs: HTTP 500")}).code).toBe("HTTP 500");
    expect(safeCloudCode({state: "ERROR", code: "something went wrong at /home/user/x"}).code).toBe("");
    expect(safeCloudCode({state: "OK", code: ""}).code).toBe("");
    expect(safeCloudCode(null)).toBeNull();
  });
});
