// Builder I — Company OS / Skill Academy / Domains UX, against the REAL control-api (buildServer + app.inject) behind the desktop
// bridge's own GET/POST allow-lists. Each test pins one defect fix and carries a positive control:
//  A failed read no longer prints the bridge's raw error message (Electron's "Error invoking remote method ..." wrapping
//  carries paths and internals); only a fixed CODE or "HTTP nnn" is shown, free text is dropped. Healthy reads show no code line.
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
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-i-company-")); for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  const forms = await load("forms.js"); forms.resetAllForms?.();
  const st = await load("studio-state.js"); st.closeProject?.();
});


const IPC = (code: string) => `Error invoking remote method 'uasco:api-get': Error: ${code}`; // how Electron wraps a rejected main-process handler



async function setup(lang: "en" | "tr" = "en", fail: Record<string, string> = {}) {
  const sb = fs.mkdtempSync(path.join(tmp, "b-")), dataDir = path.join(sb, "data"), runtime = path.join(sb, "runtime"), controlRoot = path.join(sb, "control");
  for (const d of [runtime, controlRoot]) fs.mkdirSync(d, {recursive: true});
  new WorkOsStore(dataDir);
  const app = buildServer({controlToken: TOKEN, runtime, dataDir, tenantId: "tA", port: 3210, logger: false, controlRoot, runner: {enabled: false}}); apps.push(app);
  const baseGet = (await import("../automation/lib/control-boundary.mjs")).desktopGetPathAllowed as (v: unknown) => boolean;
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), cache = st.createStore(null), seen: Record<string, number> = {};
  const bridge = {
    apiGet: async (p: string) => {
      if (!baseGet(p) && !extraGet(p)) throw new Error(IPC("INVALID_API_PATH"));
      const r = await app.inject({method: "GET", url: p, headers: hdr}); seen[p] = r.statusCode;
      // `fail` stands in for a server-side failure of that route; the wrapping is Electron's own for a rejected handler
      const status = fail[p] !== undefined ? fail[p] : r.statusCode === 200 ? null : String(r.statusCode);
      if (status !== null) throw new Error(IPC(`${p}: HTTP ${status}`));
      return r.json();
    },
    apiPost: async () => ({status: 403, body: {error: "TEST_NO_WRITES"}})
  };
  const api = apiMod.createApi({bridge, store: cache});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store: cache, api, i18n: {lang, t}, t, navigate: () => {}, rerender: async () => {}, refreshAll: async () => {}, confirm: async () => false, selectProject() {}, renderAttention() {}, requestStop() {}, principal: "FOUNDER_LOCAL", settleFocus: () => {}};
  const routes = await load("routes.js"), planned = await load("views", "planned.js");
  const view = async (id: string) => { const root: N = await planned.render(ctx, routes.routeById(id)); doc.body.replaceChildren(root); return root; };
  return {app, ctx, view, seen};
}
const leaked = (root: N) => all(root).some(n => /Error invoking remote method|uasco:api-get|\/v1\/[a-z]+.*: HTTP/.test(n.textContent) && n.children.length === 0);
const codes = (root: N) => all(root).filter(n => n.dataset.errorCode !== undefined).map(n => [n.dataset.errorCode, n.textContent]);

describe("Company OS / Academy / Domains — real reads succeed and show no error code (control)", () => {
  it("all three screens read the real control-api (HTTP 200) and show no code line", async () => {
    const s = await setup("en");
    for (const id of ["company", "academy", "domains"]) {
      const root = await s.view(id);
      expect(codes(root), id).toEqual([]);
      expect(leaked(root), id).toBe(false);
    }
    expect(s.seen["/v1/academy"]).toBe(200); expect(s.seen["/v1/domains"]).toBe(200); expect(s.seen["/v1/company/accounts"]).toBe(200);
  });
});

describe("Company OS / Academy / Domains — a failed read shows only the HTTP status, never the raw bridge message", () => {
  for (const [id, p, stateKey] of [["academy", "/v1/academy", "academyState"], ["domains", "/v1/domains", "domainState"], ["company", "/v1/company/accounts", "companyState"]] as const) {
    it(`${id}: HTTP 500 on ${p} -> a state block plus the code 'HTTP 500' only`, async () => {
      const s = await setup("en", {[p]: "500"});
      const root = await s.view(id);
      expect(all(root).some(n => n.dataset[stateKey] !== undefined && n.dataset[stateKey] !== "VERIFIED"), "the failure path was not exercised").toBe(true);
      expect(codes(root)).toContainEqual(["HTTP 500", "HTTP 500"]);
      expect(leaked(root)).toBe(false);
      expect(all(root).some(n => n.textContent.includes("Error invoking remote method"))).toBe(false);
    });
  }
  it("a path the desktop allow-list rejects shows the code INVALID_API_PATH only", async () => {
    const s = await setup("en"); const comp = await load("views", "academy.js");
    s.ctx.api = {...s.ctx.api, academy: async () => ({state: "UNAVAILABLE", learnings: [], sources: [], reuses: 0, globalKnowledge: [], byStatus: {}, metrics: null, message: IPC("INVALID_API_PATH")})};
    const root: N = await comp.render(s.ctx);
    const c = codes(root); expect(c.length).toBeGreaterThan(0); expect(c.every(([k, txt]) => k === "INVALID_API_PATH" && txt === "INVALID_API_PATH")).toBe(true);
    expect(leaked(root)).toBe(false);
  });
});

describe("safeErrorCode (pure)", () => {
  it("keeps a fixed code, extracts the last CODE or the HTTP status from wrapped text, drops free text", async () => {
    const {safeErrorCode} = await load("error-code.js");
    expect(safeErrorCode("COMPANY_RESPONSE_INVALID")).toBe("COMPANY_RESPONSE_INVALID");
    expect(safeErrorCode(IPC("INVALID_API_PATH"))).toBe("INVALID_API_PATH");
    expect(safeErrorCode(IPC("/v1/academy: HTTP 503"))).toBe("HTTP 503");
    expect(safeErrorCode("fetch failed at /home/user/secret")).toBe("");
    expect(safeErrorCode("<img src=x onerror=alert(1)>")).toBe("");
    for (const v of [null, undefined, "", 5]) expect(safeErrorCode(v as any)).toBe("");
  });
});
