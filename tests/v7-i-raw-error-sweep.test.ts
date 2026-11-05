// Builder I — raw-error sweep, against the REAL control-api (buildServer + app.inject) behind the desktop
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
beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-i-sweep-")); for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ }
  const forms = await load("forms.js"); forms.resetAllForms?.();
  const st = await load("studio-state.js"); st.closeProject?.();
});


const IPC = (code: string) => `Error invoking remote method 'uasco:api-get': Error: ${code}`; // how Electron wraps a rejected main-process handler



async function setup(lang: "en" | "tr" = "en", fail: Record<string, string> | "ALL" = {}) {
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
      const status = fail === "ALL" ? "500" : fail[p] !== undefined ? fail[p] : r.statusCode === 200 ? null : String(r.statusCode);
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
const leaked = (root: N) => all(root).some(n => n.children.length === 0 && /Error invoking remote method|uasco:api-get|\/v1\/\S*: HTTP/.test(n.textContent));
const codes = (root: N) => all(root).filter(n => n.dataset.errorCode !== undefined).map(n => [n.dataset.errorCode, n.textContent]);

const VIEWS = ["journey", "scheduler", "operations", "install", "matrix", "integrations"] as const;

describe("raw-error sweep — healthy real reads show no error code (control)", () => {
  for (const id of VIEWS) it(`${id}: no code line and no leaked bridge text`, async () => {
    const s = await setup("en");
    const root = await s.view(id);
    expect(codes(root), id).toEqual([]);
    expect(leaked(root), id).toBe(false);
  });
});

describe("raw-error sweep — every GET answered HTTP 500 (IPC-wrapped): only the status code is shown", () => {
  for (const id of VIEWS) it(`${id}: a code line reads exactly 'HTTP 500'; no 'Error invoking remote method', channel or path text`, async () => {
    const s = await setup("en", "ALL");
    const root = await s.view(id);
    const c = codes(root);
    expect(c.length, `${id}: the failure path was not exercised (no code line)`).toBeGreaterThan(0);
    expect(c.every(([k, txt]) => k === "HTTP 500" && txt === "HTTP 500"), JSON.stringify(c)).toBe(true);
    expect(leaked(root), id).toBe(false);
    expect(all(root).some(n => n.textContent.includes("Error invoking remote method")), id).toBe(false);
  });
  it("cloud jobs (loadCloudJobs + cloudJobsPanel): the rejected path keeps only INVALID_API_PATH, a 500 keeps only HTTP 500", async () => {
    const cc = await load("views", "cloud-connection.js");
    const ok = await setup("en");
    const un = await cc.loadCloudJobs(ok.ctx.api); // /v1/cloud/jobs is not on the desktop allow-list at this base
    expect([un.state, un.code]).toEqual(["UNAVAILABLE", "INVALID_API_PATH"]);
    const p: N = cc.cloudJobsPanel(ok.ctx, un);
    expect(byData(p, "cloudJobsCode")!.textContent).toBe("INVALID_API_PATH");
    expect(p.textContent).not.toContain("Error invoking remote method");
    const s5 = await setup("en", "ALL");
    s5.ctx.api = {...s5.ctx.api, get: async (path: string) => ({ok: false, state: "ERROR", status: 500, message: IPC(`${path}: HTTP 500`)})};
    const e = await cc.loadCloudJobs(s5.ctx.api);
    expect([e.state, e.code]).toEqual(["ERROR", "HTTP 500"]);
  });
});

// Static guard: no renderer module renders an error object's or result's `.message` (or a bare `message`) straight into the DOM.
// Files touched by an open PR are allow-listed here and reported as follow-ups (they are fixed or will be fixed in their own PR).
const OPEN_PR_FOLLOW_UPS = new Set([
  "views/audit.js", "views/posture.js",            // #371
  "views/queue.js", "views/readiness.js", "views/tower.js", // #377
  "views/company.js", "views/academy.js", "views/domains.js", // #382 (fixed there)
  "views/executive.js"                              // #374
]);
// Exact line-level exemptions: not a bridge/IPC error but server job data already passed through sanitizeServerText; whether the
// remote cloud job view should show any worker text is a cloud-policy follow-up (cd77e80), not a raw-error sink.
const EXEMPT: Array<[string, RegExp]> = [["views/cloud-connection.js", /^j\.message\?h\(doc,"p",\{class:"note",text:j\.message\}\):null,$/]];
const SINK_RES = [/text:\s*[\w$?.]*\.message\b/, /text:\s*(message|msg|err|error)\b/, /textContent\s*=\s*[^;]*\.message\b/, /text:\s*String\((e|err|error)\)/];
function rendererFiles(dir = rend, rel = ""): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(d => d.isDirectory() ? (d.name === "locales" ? [] : rendererFiles(path.join(dir, d.name), rel ? `${rel}/${d.name}` : d.name)) : d.name.endsWith(".js") ? [rel ? `${rel}/${d.name}` : d.name] : []);
}
export function rawSinks(src: string): string[] { return src.split("\n").filter(l => !l.trim().startsWith("//") && SINK_RES.some(re => re.test(l))).map(l => l.trim().slice(0, 160)); }

describe("raw-error sweep — static guard over every renderer module", () => {
  it("no module outside the open-PR follow-up list renders a raw `.message` into the DOM", () => {
    const files = rendererFiles();
    expect(files.length).toBeGreaterThan(50);
    const hits = files.filter(f => !OPEN_PR_FOLLOW_UPS.has(f)).flatMap(f => rawSinks(fs.readFileSync(path.join(rend, f), "utf8")).filter(l => !EXEMPT.some(([ef, re]) => ef === f && re.test(l))).map(l => `${f}: ${l}`));
    expect(hits).toEqual([]);
  });
  it("the guard catches the sink shapes it claims to (positive controls)", () => {
    for (const bad of ['res.message?h(doc,"p",{class:"note mono",text:res.message}):null', 'h(doc,"p",{text:message})', 'el.textContent = r.error.message;', 'h(doc,"p",{text:String(e)})', 'h(doc,"p",{text: res?.message})'])
      expect(rawSinks(bad), bad).not.toEqual([]);
    for (const good of ['h(doc,"p",{dataset:{errorCode:safeErrorCode(res.message)},text:safeErrorCode(res.message)})', '// text:res.message in a comment', 'h(doc,"p",{text:ctx.t("x")})'])
      expect(rawSinks(good), good).toEqual([]);
  });
  it("each exemption still matches exactly one line (a stale exemption fails)", () => {
    for (const [f, re] of EXEMPT) expect(rawSinks(fs.readFileSync(path.join(rend, f), "utf8")).filter(l => re.test(l)).length, f).toBe(1);
  });
  it("every allow-listed follow-up file exists (the list does not hide a renamed file)", () => {
    for (const f of OPEN_PR_FOLLOW_UPS) expect(fs.existsSync(path.join(rend, f)), f).toBe(true);
  });
});
