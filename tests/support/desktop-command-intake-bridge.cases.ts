// //TR: Bu vaka dosyası (kayıtlı tests/v7-b4-desktop-shell.test.ts tarafından içe aktarılır; korumalı kayıt gerektirmez) POST /v1/command-intake masaüstü köprüsünü doğrular: izin listesi main.mjs'ten okunur (main.mjs DEĞİŞTİRİLMEZ), köprü uasco:api-post/apiPost sözleşmesini taklit eder ve gerçek buildServer'a gider.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof, desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), WRONG = "w".repeat(32);
const ROUTE = "/v1/command-intake";
// //TR: Kurucu PROTECTED_PATH PR'ı gelene kadar olumlu vakalar bu açıklayıcı iletiyle kırmızıdır (main.mjs bu iş paketinde düzenlenmez).
const APPLY_MAIN = "apply main.mjs POST_ROUTE_RES entry /^\\/v1\\/command-intake$/ (Founder-gated PROTECTED_PATH PR); main.mjs is not edited by this test patch";

// ---------- main.mjs blokları (electron vitest içinde içe aktarılamaz; blok/işlev metni okunup yalıtılmış değerlendirilir) ----------
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string): string => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs ${name} block not found`); return m[1]; };
const fnSrc = (name: string): string => { const m = new RegExp(`\\nfunction ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs function ${name} not found`); return m[0]; };
const {desktopPostPathAllowed: postAllowed, desktopPostBodyCheck} = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as
  {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};
const extraGetAllowed = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const getAllowed = (p: string) => desktopGetPathAllowed(p) || extraGetAllowed(p);
// sanitizePostBody/scrubText main.mjs'teki gerçek metinden (token kapanışta) kurulur
const loadSanitize = (token: string) => new Function("token", `${fnSrc("scrubText")}${fnSrc("sanitizePostBody")}\nreturn sanitizePostBody;`)(token) as (status: number, parsed: unknown) => any;

// ---------- minimal DOM ----------
class N {
  tagName: string; children: N[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; value = ""; ls = new Map<string, Array<() => unknown>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string>) { for (const c of n) this.children.push(typeof c === "string" ? this.doc.createTextNode(c) : c); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  addEventListener(ev: string, fn: () => unknown) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  async fire(ev: string) { for (const fn of this.ls.get(ev) ?? []) await fn(); }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class D {
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
}
const byId = (n: N, id: string) => n.all().find(x => x.attrs.get("id") === id);

type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
function mkApp(): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}

/** main.mjs uasco:api-post (main.mjs:322) + apiPost + verifyServerIdentity ile aynı sözleşme: izin listesi dışı yol INVALID_API_PATH; gövde desktopPostBodyCheck;
 *  çağrıdan önce kimlik belirtece bağlı challenge ile doğrulanır (uyuşmazsa CONTROL_API_IDENTITY_UNVERIFIED); POST belirteç başlığıyla gider; ağ hatası
 *  CONTROL_API_UNREACHABLE fırlatır; aksi halde HTTP durumundan bağımsız {status, body: sanitizePostBody(...)} döner (hata FIRLATILMAZ). */
function mkBridge(app: App, opts: {identityToken?: string; headerToken?: string; unreachable?: boolean} = {}) {
  const identityToken = opts.identityToken ?? TOKEN, headerToken = opts.headerToken ?? TOKEN, sanitize = loadSanitize(headerToken);
  const calls: Array<{path: string; status: number | null; error?: string}> = [];
  const verifyServerIdentity = async () => {
    const challenge = crypto.randomBytes(32).toString("hex"), expected = controlChallengeProof(identityToken, challenge);
    const r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    if (r.statusCode !== 200) throw new Error(`health: HTTP ${r.statusCode}`);
    const h = r.json();
    if (h.status !== "HEALTHY" || h.system !== "UNIVERSAL-AI-SOFTWARE-COMPANY-OS" || h.bindHost !== "127.0.0.1" || Number(h.port) !== 3210 || !expected || String(h.controlProof ?? "") !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const apiPost = async (p: string, body: unknown) => {
    try {
      if (!postAllowed(p)) throw new Error("INVALID_API_PATH");
      const prepared = desktopPostBodyCheck(body); if (!prepared.ok) throw new Error(prepared.error);
      await verifyServerIdentity();
      if (opts.unreachable) throw new Error("CONTROL_API_UNREACHABLE");
      const r = await app.inject({method: "POST", url: p, headers: {"content-type": "application/json", "x-uasco-control-token": headerToken, host: "127.0.0.1:3210"}, payload: prepared.text});
      let parsed: unknown = null; try { parsed = JSON.parse(r.body.slice(0, 262144)); } catch { parsed = null; }
      calls.push({path: p, status: r.statusCode});
      return {status: r.statusCode, body: sanitize(r.statusCode, parsed)};
    } catch (e) { calls.push({path: p, status: null, error: (e as Error).message}); throw e; }
  };
  return {bridge: {apiPost, apiGet: async () => { throw new Error("GET not used by the command intake panel"); }}, calls};
}

async function panelCtx(bridge: unknown) {
  const apiMod = await load("api.js"), st = await load("state.js"), view = await load("views", "intake.js");
  const api = apiMod.createApi({bridge, store: st.createStore(null)});
  const ctx: any = {doc: new D(), t: (k: string) => k, api, rerender: async () => { ctx.node = view.commandIntakePanel(ctx); }};
  view.commandUi.result = null; view.commandUi.text = ""; view.commandUi.busy = false;
  await ctx.rerender();
  return {ctx, view};
}

export function registerDesktopCommandIntakeBridgeCases(): void {
  describe("UASCO-T0010 desktop bridge: POST /v1/command-intake allow-list (main.mjs POST_ROUTE_RES)", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-cmdintake-bridge-")); });
    afterEach(async () => { for (const a of apps.splice(0)) await a.close(); fs.rmSync(tmp, {recursive: true, force: true}); });

    it("the POST allow-list accepts exactly /v1/command-intake", () => {
      expect(postAllowed(ROUTE), APPLY_MAIN).toBe(true);
      // tek, çapalı giriş: tam olarak bu literal bir kez bulunur
      expect(MAIN_SRC.split("/^\\/v1\\/command-intake$/").length - 1, APPLY_MAIN).toBe(1);
    });

    it("near-miss, suffixed, query, case and unknown POST paths are refused; GET of the path is not opened", () => {
      for (const p of [`${ROUTE}/x`, `${ROUTE}X`, `${ROUTE}?x`, `${ROUTE}?`, `${ROUTE}#x`, `${ROUTE}/`, `/v1/command-intak`, `/v1/Command-intake`, `/V1/command-intake`, `//v1/command-intake`,
        `/v1//command-intake`, `/x/v1/command-intake`, ` ${ROUTE}`, `${ROUTE} `, `${ROUTE}\n`, `/v1/command-intakes`, `/v1/commands`, `/v1/unknown-post`, ""]) expect(postAllowed(p), JSON.stringify(p)).toBe(false);
      for (const v of [undefined, null, 1, {}, [ROUTE]]) expect(postAllowed(v), String(v)).toBe(false);
      expect(getAllowed(ROUTE), "GET /v1/command-intake must not be opened").toBe(false);
      expect(getAllowed(`${ROUTE}?x`)).toBe(false);
    });

    it("the real renderer panel gets a DRAFT from the real buildServer route through the mirrored main.mjs POST bridge", async () => {
      expect(postAllowed(ROUTE), APPLY_MAIN).toBe(true);
      const app = mkApp(), {bridge, calls} = mkBridge(app), {ctx, view} = await panelCtx(bridge);
      expect(await view.submitCommand(ctx, "Audit the login module")).toEqual({ok: true});
      expect(calls).toEqual([{path: ROUTE, status: 200}]);
      expect(byId(ctx.node, "command-intake-result")?.dataset).toMatchObject({commandStatus: "DRAFT", commandOutcome: "PROPOSED"});
      expect(byId(ctx.node, "command-intake-error")).toBeUndefined();
      // örnek düğmesi de aynı köprüden DRAFT üretir; belirsiz komut netleştirme sorusu getirir
      await ctx.node.all().find((n: N) => n.dataset.commandExample === "0")!.fire("click");
      expect(byId(ctx.node, "command-intake-result")?.dataset.commandStatus).toBe("DRAFT");
      expect(await view.submitCommand(ctx, "build it and then audit it")).toEqual({ok: true});
      expect(byId(ctx.node, "command-intake-clarify")?.dataset.clarifyCode).toBe("KIND_AMBIGUOUS");
      expect(calls.every(c => c.status === 200)).toBe(true);
    });

    it("unverified identity (wrong token in the challenge) shows the error state and never reaches the route", async () => {
      expect(postAllowed(ROUTE), APPLY_MAIN).toBe(true);
      const app = mkApp(), {bridge, calls} = mkBridge(app, {identityToken: WRONG}), {ctx, view} = await panelCtx(bridge);
      expect(await view.submitCommand(ctx, "Audit the login module")).toEqual({ok: false});
      expect(calls).toEqual([{path: ROUTE, status: null, error: "CONTROL_API_IDENTITY_UNVERIFIED"}]);
      expect(byId(ctx.node, "command-intake-result")).toBeUndefined();
      expect(byId(ctx.node, "command-intake-error")?.dataset.commandError).toBe("UNAVAILABLE");
    });

    it("status >= 400 comes back as {status, body} (not thrown): wrong token header 403 and a too-long command 400 show the server code; the 4xx body is sanitized", async () => {
      expect(postAllowed(ROUTE), APPLY_MAIN).toBe(true);
      const app = mkApp();
      const raw = await app.inject({method: "POST", url: ROUTE, headers: {"content-type": "application/json", "x-uasco-control-token": WRONG, host: "127.0.0.1:3210"}, payload: {text: "Audit the login module"}});
      expect(raw.statusCode).toBe(403);
      const wrong = mkBridge(app, {headerToken: WRONG}), a = await panelCtx(wrong.bridge);
      expect(await a.view.submitCommand(a.ctx, "Audit the login module")).toEqual({ok: false});
      expect(wrong.calls).toEqual([{path: ROUTE, status: 403}]);
      expect(byId(a.ctx.node, "command-intake-result")).toBeUndefined();
      expect(byId(a.ctx.node, "command-intake-error")?.dataset.commandError).toBe(raw.json().error);

      const ok = mkBridge(app), b = await panelCtx(ok.bridge);
      const res = await ok.bridge.apiPost(ROUTE, {text: "x".repeat(2001)});
      expect(res).toEqual({status: 400, body: {error: "INTAKE_TOO_LONG"}}); // maxLength alanı sanitizePostBody tarafından düşürülür
      expect(await b.view.submitCommand(b.ctx, "x".repeat(2001))).toEqual({ok: false});
      expect(byId(b.ctx.node, "command-intake-error")?.dataset.commandError).toBe("INTAKE_TOO_LONG");
    });

    it("a thrown CONTROL_API_UNREACHABLE fails closed as an error, never a draft", async () => {
      expect(postAllowed(ROUTE), APPLY_MAIN).toBe(true);
      const app = mkApp(), down = mkBridge(app, {unreachable: true}), {ctx, view} = await panelCtx(down.bridge);
      expect(await view.submitCommand(ctx, "Audit the login module")).toEqual({ok: false});
      expect(down.calls).toEqual([{path: ROUTE, status: null, error: "CONTROL_API_UNREACHABLE"}]);
      expect(byId(ctx.node, "command-intake-error")?.dataset.commandError).toBe("UNAVAILABLE");
      expect(byId(ctx.node, "command-intake-result")).toBeUndefined();
    });

    it("the mirrored bridge refuses non-allow-listed variants with INVALID_API_PATH before any identity check or request", async () => {
      const app = mkApp(), refused = mkBridge(app);
      for (const p of [`${ROUTE}/x`, `${ROUTE}X`, `${ROUTE}?x`, "/v1/unknown-post"]) await expect(refused.bridge.apiPost(p, {text: "a"}), p).rejects.toThrow("INVALID_API_PATH");
      expect(refused.calls.map(c => [c.status, c.error])).toEqual(Array(4).fill([null, "INVALID_API_PATH"]));
    });
  });
}
