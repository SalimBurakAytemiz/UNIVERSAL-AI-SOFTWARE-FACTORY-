// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-wp-projects.test.ts tarafından içe aktarılır) UASCO-T0006'nın bulduğu gerçek sunucu kusurunu ve düzeltmesini doğrular: Proje Stüdyosu sihirbazı POST /v1/projects gövdesinde environmentId göndermiyordu, gerçek sunucu her seferinde 400 INVALID_BODY döndürüyordu (yalnız sahte köprülü testler bunu görmedi). Artık sihirbazda görünür, "local" ile önceden doldurulmuş bir Ortam alanı vardır; boş/geçersiz değer gönderilmez. Köprü main.mjs'in gerçek B5 POST izin listesi + gövde denetimi ve apiPost'un kimlik el sıkışmasıdır.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof, desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", ".."), REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string) => { const a = MAIN_SRC.indexOf(`// ${name}-BEGIN`), b = MAIN_SRC.indexOf(`// ${name}-END`); if (a < 0 || b < 0) throw new Error(`main.mjs ${name} block not found`); return MAIN_SRC.slice(a, b); };
const extraGet = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const postGates = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};
const TOKEN = "t".repeat(32), WRONG = "w".repeat(32), hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const IPC = (ch: string, code: string) => `Error invoking remote method '${ch}': Error: ${code}`;

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
type App = ReturnType<typeof buildServer>;
let tmp = ""; const apps: App[] = [];
function mkApp(): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data"); fs.mkdirSync(runtime, {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false}); apps.push(app); return app;
}
const projects = async (app: App) => (await app.inject({method: "GET", url: "/v1/projects", headers: hdr})).json().projects as Array<{projectId: string; name: string; environmentId: string}>;
/** main.mjs uasco:api-post (main.mjs:324) + apiPost (main.mjs:277): B5 yol/gövde denetimi, ardından belirtece bağlı kimlik el sıkışması; uyuşmazlıkta istek hiç gitmez. */
async function setup(app: App, token = TOKEN) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js"), studio = await load("studio-state.js");
  forms.resetAllForms?.(); studio.resetWizard(); studio.resetIdea?.(); studio.studio.lastCreated = null;
  const doc = new D(), cache = st.createStore(null), posts: Array<{path: string; status: number; body: unknown}> = [];
  const verifyServerIdentity = async () => {
    const challenge = crypto.randomBytes(32).toString("hex"), expected = controlChallengeProof(token, challenge);
    const r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    const h = r.json(); if (r.statusCode !== 200 || h.status !== "HEALTHY" || !expected || String(h.controlProof ?? "") !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const bridge = {
    apiGet: async (q: string) => { if (!desktopGetPathAllowed(q) && !extraGet(q)) throw new Error(IPC("uasco:api-get", "INVALID_API_PATH")); await verifyServerIdentity(); const r = await app.inject({method: "GET", url: q, headers: {...hdr, "x-uasco-control-token": token}}); if (r.statusCode !== 200) throw new Error(IPC("uasco:api-get", `${q}: HTTP ${r.statusCode}`)); return r.json(); },
    apiPost: async (q: string, b: unknown) => {
      if (!postGates.desktopPostPathAllowed(q)) throw new Error(IPC("uasco:api-post", "INVALID_API_PATH"));
      const prepared = postGates.desktopPostBodyCheck(b); if (!prepared.ok) throw new Error(IPC("uasco:api-post", String(prepared.error)));
      try { await verifyServerIdentity(); } catch (e) { throw new Error(IPC("uasco:api-post", (e as Error).message)); }
      const r = await app.inject({method: "POST", url: q, headers: {...hdr, "x-uasco-control-token": token, "content-type": "application/json"}, payload: prepared.text});
      let body: any = {}; try { body = r.json(); } catch { /* non-json */ } posts.push({path: q, status: r.statusCode, body}); return {status: r.statusCode, body};
    }
  };
  const api = apiMod.createApi({bridge, store: cache});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  const ctx: any = {doc, store: cache, api, i18n: {lang: "en", t}, t, navigate: () => undefined, rerender: async () => undefined, refreshAll: async () => undefined, settleFocus: () => undefined,
    confirm: async () => true, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  const sw = await load("views", "studio-wizard.js");
  const panel = (): N => sw.wizardPanel(ctx);
  return {ctx, api, posts, forms, studio, sw, panel, t};
}
const statusOf = (s: Awaited<ReturnType<typeof setup>>) => s.forms.drafts.status[s.sw.WIZARD_FORM];

export function registerWizardRealServerCases(): void {
describe("UASCO-T0006: Project Studio wizard -> real buildServer (environmentId defect + fix; happy, 500, identity 403, validation)", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-wiz-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("defect pin: the pre-fix wizard body (no environmentId) is refused by the real server with 400 INVALID_BODY; the fixed body is created (201)", { timeout: 60_000 }, async () => {
    const app = mkApp(), core = await load("project-core.js");
    const old = await app.inject({method: "POST", url: "/v1/projects", headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify({name: "Old shape", template: "web-node"})});
    expect([old.statusCode, old.json().error]).toEqual([400, "INVALID_BODY"]); expect(old.json().detail).toContain("environmentId");
    const req = core.buildWizardRequest({name: "New shape", template: "web-node", environmentId: "local"});
    expect(req.ok).toBe(true); expect(req.body.environmentId).toBe("local");
    const fixed = await app.inject({method: "POST", url: req.path, headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify(req.body)});
    expect(fixed.statusCode).toBe(201); expect(fixed.json().project).toMatchObject({name: "New shape", environmentId: "local"});
  });

  it("the wizard shows a visible, prefilled, required Environment field with the intake default", async () => {
    const app = mkApp(), s = await setup(app);
    expect(s.studio.DEFAULT_ENVIRONMENT_ID).toBe("local");
    expect(fs.readFileSync(path.join(REPO, "core", "workos", "intake.ts"), "utf8")).toContain('environmentId: deps.environmentId ?? "local"'); // the default is the server-side intake default, not a guess
    const root = s.panel(), input = all(root).find(n => n.id === "studio-env")!;
    expect(input).toBeDefined(); expect(input.value || input.getAttribute("value")).toBe("local");
    expect(all(root).some(n => n.tagName === "LABEL" && n.textContent.startsWith("Environment id"))).toBe(true);
    expect(all(root).some(n => n.textContent.startsWith("Required by the server."))).toBe(true);
  });

  it("happy path: submitWizard through main.mjs's real B5 POST gate creates the project on the real server with environmentId local", { timeout: 60_000 }, async () => {
    const app = mkApp(), s = await setup(app);
    Object.assign(s.studio.wizard, {name: "Book club", template: "web-node"});
    const r = await s.sw.submitWizard(s.ctx);
    expect(r).toEqual({ok: true});
    expect(s.posts.map(p => [p.path, p.status])).toEqual([["/v1/projects", 201]]);
    const ps = await projects(app);
    expect(ps.map(p => [p.name, p.environmentId])).toEqual([["Book club", "local"]]);
    expect(s.studio.studio.lastCreated?.projectId).toBe(ps[0].projectId);
    expect(statusOf(s)).toMatchObject({ok: true, key: "studio.wizard.created"});
  });

  it("server error path: the real server answers 500 -> an honest error status, nothing created, no lastCreated", { timeout: 60_000 }, async () => {
    const app = mkApp();
    app.addHook("onRequest", async (req, reply) => { if (req.method === "POST" && req.url.startsWith("/v1/")) return reply.code(500).send({error: "INJECTED_SERVER_FAILURE"}); });
    const s = await setup(app);
    Object.assign(s.studio.wizard, {name: "Book club", template: "web-node"});
    expect(await s.sw.submitWizard(s.ctx)).toEqual({ok: false});
    expect(s.posts.map(p => p.status)).toEqual([500]);
    expect(statusOf(s).ok).toBe(false);
    expect(await projects(app)).toEqual([]); expect(s.studio.studio.lastCreated ?? null).toBeNull();
  });

  it("identity path: token mismatch -> the handshake fails before anything is posted (as main.mjs apiPost), an error status, nothing created; the real server refuses that token with 403", { timeout: 60_000 }, async () => {
    const app = mkApp(), s = await setup(app, WRONG);
    Object.assign(s.studio.wizard, {name: "Book club", template: "web-node"});
    expect(await s.sw.submitWizard(s.ctx)).toEqual({ok: false});
    expect(s.posts).toEqual([]);
    expect(statusOf(s).ok).toBe(false);
    expect(await projects(app)).toEqual([]);
    const direct = await app.inject({method: "POST", url: "/v1/projects", headers: {"x-uasco-control-token": WRONG, host: "127.0.0.1:3210", "content-type": "application/json"}, payload: JSON.stringify({name: "x", environmentId: "local", template: "web-node"})});
    expect(direct.statusCode).toBe(403);
  });

  it("validation: an empty environment is never sent and shows a required message; an invalid one shows the existing format message", { timeout: 60_000 }, async () => {
    for (const [env, key] of [["", "studio.err.envRequired"], ["   ", "studio.err.envRequired"], ["bad env!", "err.envInvalid"]] as const) {
      const app = mkApp(), s = await setup(app);
      Object.assign(s.studio.wizard, {name: "Book club", template: "web-node", environmentId: env});
      expect(await s.sw.submitWizard(s.ctx), JSON.stringify(env)).toEqual({ok: false, validation: true});
      expect(s.posts).toEqual([]);
      expect(statusOf(s).errors).toMatchObject({environmentId: key});
      expect(s.t(key)).not.toBe(key); // the message exists in the locale
      const core = await load("project-core.js"); expect(core.buildWizardRequest({name: "x", template: "web-node", environmentId: env}).ok).toBe(false);
      await app.close();
    }
  });
});
}
