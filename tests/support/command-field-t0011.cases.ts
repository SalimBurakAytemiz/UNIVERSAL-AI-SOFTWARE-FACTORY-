// //TR: Bu vaka dosyası (kayıtlı tests/v7-ps1b-project-studio-ui.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0011'i sınar: tek komut alanı —
// gönderim öncesi doğrulama (istek gönderilmez), önizleme (POST /v1/command-intake, DRAFT), kapılı "Intake oluştur" (POST /v1/intakes), dürüst sonuç (intake kimliği /
// sunucu ret kodu / erişilemez) ve shell girişi (Ctrl+K "Yeni komut", Ctrl+Shift+N). Yazmalar main.mjs B5-POST-ALLOWLIST köprüsünün aynası üzerinden GERÇEK buildServer'a gider.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import crypto from "node:crypto";
import {controlChallengeProof} from "../../automation/lib/control-boundary.mjs";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32);
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string): string => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs ${name} block not found`); return m[1]; };
const fnSrc = (name: string): string => { const m = new RegExp(`\\nfunction ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs function ${name} not found`); return m[0]; };
const {desktopPostPathAllowed: postAllowed, desktopPostBodyCheck} = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as
  {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};
const loadSanitize = (token: string) => new Function("token", `${fnSrc("scrubText")}${fnSrc("sanitizePostBody")}\nreturn sanitizePostBody;`)(token) as (status: number, parsed: unknown) => any;

// ---------- minimal DOM (odak + olay + basit seçici) ----------
type Fn = (e: any) => unknown;
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; value = ""; disabled = false; hidden = false; open = false;
  ls = new Map<string, Fn[]>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get isConnected() { let n: N | null = this; while (n) { if (n === this.doc.body) return true; n = n.parent; } return false; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "disabled") this.disabled = true; if (k === "hidden") this.hidden = true; }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: Fn) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  async fire(ev: string, e: any = {}) { let prevented = false; for (const fn of this.ls.get(ev) ?? []) await fn({preventDefault() { prevented = true; }, currentTarget: this, target: this, ...e}); return prevented; }
  focus() { this.doc.activeElement = this; }
  select() { /* test double */ }
  scrollIntoView() { /* test double */ }
  showModal() { this.open = true; }
  close() { this.open = false; }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
  querySelector(sel: string) { return this.all().slice(1).find(n => sel.startsWith(".") ? n.className.split(/\s+/).includes(sel.slice(1)) : n.id === sel.replace(/^#/, "")) ?? null; }
}
class D {
  body: N; activeElement: N | null = null; ls = new Map<string, Fn[]>(); title = "";
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return this.body.all().find(n => n.id === id) ?? null; }
  querySelector(sel: string) { return this.body.querySelector(sel); }
  addEventListener(ev: string, fn: Fn) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  async fire(ev: string, e: any = {}) { let prevented = false; for (const fn of this.ls.get(ev) ?? []) await fn({preventDefault() { prevented = true; }, ...e}); return prevented; }
}
const byId = (n: N, id: string) => n.all().find(x => x.id === id);
const tick = () => new Promise(r => setTimeout(r, 0));

type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
function mkApp(): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
const inject = async (app: App, method: "GET" | "POST", url: string, payload?: unknown) => app.inject({method, url, headers: {"content-type": "application/json", "x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, ...(payload === undefined ? {} : {payload: JSON.stringify(payload)})});

/** main.mjs uasco:api-post aynası: izin listesi, gövde denetimi, belirtece bağlı kimlik doğrulama, {status, body: sanitize} (4xx fırlatılmaz). */
function mkBridge(app: App, opts: {unreachableOn?: string} = {}) {
  const sanitize = loadSanitize(TOKEN), calls: Array<{path: string; status: number | null; error?: string; body?: unknown}> = [];
  const verify = async () => {
    const challenge = crypto.randomBytes(32).toString("hex");
    const r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
    if (String(r.json().controlProof ?? "") !== controlChallengeProof(TOKEN, challenge)) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
  };
  const apiPost = async (p: string, body: unknown) => {
    try {
      if (!postAllowed(p)) throw new Error("INVALID_API_PATH");
      const prepared = desktopPostBodyCheck(body); if (!prepared.ok) throw new Error(prepared.error);
      await verify();
      if (opts.unreachableOn === p) throw new Error("CONTROL_API_UNREACHABLE");
      const r = await app.inject({method: "POST", url: p, headers: {"content-type": "application/json", "x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}, payload: prepared.text});
      let parsed: unknown = null; try { parsed = JSON.parse(r.body); } catch { parsed = null; }
      calls.push({path: p, status: r.statusCode, body});
      return {status: r.statusCode, body: sanitize(r.statusCode, parsed)};
    } catch (e) { calls.push({path: p, status: null, error: (e as Error).message, body}); throw e; }
  };
  const apiGet = async (p: string) => { const r = await inject(app, "GET", p); if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json(); };
  return {bridge: {apiPost, apiGet}, calls};
}

async function panel(bridge: unknown, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), view = await load("views", "intake.js"), i18n = await load("i18n.js");
  const doc = new D(), api = apiMod.createApi({bridge, store: st.createStore(null)});
  const t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  const nav: string[] = [], settled: string[][] = [];
  const ctx: any = {doc, t, api, navigate: (id: string) => nav.push(id), settleFocus: ({keys}: {keys: string[]}) => { settled.push(keys); },
    rerender: async () => { ctx.node = view.commandIntakePanel(ctx); doc.body.replaceChildren(ctx.node); }};
  Object.assign(view.commandUi, {text: "", busy: false, result: null, previewText: null, created: null, createBusy: false, focusPending: false});
  await ctx.rerender();
  const type = async (s: string) => { const ta = byId(ctx.node, "command-intake-text")!; ta.value = s; await ta.fire("input"); };
  const el = (id: string) => byId(ctx.node, id);
  return {ctx, view, t, nav, settled, type, el, doc};
}
const OK_CMD = "Ayarlar sayfasını geliştir";

export function registerCommandFieldT0011Cases(): void {
  describe("UASCO-T0011 single command field -> real buildServer (preview, create intake, honest result)", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0011-")); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    it("both routes are registered on the server and allow-listed in main.mjs (no new route needed)", async () => {
      expect(postAllowed("/v1/command-intake")).toBe(true);
      expect(postAllowed("/v1/intakes")).toBe(true);
      const app = mkApp();
      expect((await inject(app, "POST", "/v1/command-intake", {text: OK_CMD})).statusCode).toBe(200);
      expect((await inject(app, "POST", "/v1/intakes", {})).statusCode).toBe(400); // kayıtlı: şema reddi, 404 değil
    });

    it("happy path: type -> Ctrl+Enter preview (DRAFT, PROPOSED) -> Create intake -> the real server holds the intake; ids are shown", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app), p = await panel(bridge);
      await p.type(OK_CMD);
      expect(p.el("command-intake-count")!.textContent).toBe(p.t("cmdIntake.count", {n: String(OK_CMD.length), max: "2000"}));
      const prevented = await p.el("command-intake-text")!.fire("keydown", {key: "Enter", ctrlKey: true});
      expect(prevented).toBe(true);
      await tick();
      expect(calls.map(c => [c.path, c.status])).toEqual([["/v1/command-intake", 200]]);
      expect(p.el("command-intake-result")!.dataset).toMatchObject({commandStatus: "DRAFT", commandOutcome: "PROPOSED"});
      const btn = p.el("command-intake-create")!;
      expect(btn.disabled).toBe(false);
      expect(p.el("command-intake-blocked")!.hidden).toBe(true);
      expect(p.settled.at(-1)).toEqual(["id:command-intake-create", "id:command-intake-result"]); // odak oluşturma düğmesine
      await btn.fire("click"); await tick();
      expect(calls.map(c => [c.path, c.status])).toEqual([["/v1/command-intake", 200], ["/v1/intakes", 201]]);
      expect(calls[1].body).toMatchObject({idea: OK_CMD});
      expect(Object.keys(calls[1].body as object).sort()).toEqual(["idea", "idempotencyKey"]);
      const card = p.el("command-intake-created")!;
      const listed = (await inject(app, "GET", "/v1/intakes")).json().intakes;
      expect(listed.length).toBe(1);
      expect(card.dataset.intakeId).toBe(listed[0].intakeId);
      expect(card.textContent).toContain(listed[0].projectId);
      expect(card.textContent).toContain(listed[0].missionId);
      expect((await inject(app, "GET", `/v1/missions/${listed[0].missionId}`)).json().mission.status).toBe("DRAFT");
      expect(p.el("command-intake-create")).toBeUndefined(); // önizleme tüketildi: ikinci oluşturma düğmesi yok
      expect(p.el("command-intake-result")).toBeUndefined();
      await p.el("command-open-mission")!.fire("click");
      expect(p.nav).toEqual(["work"]);
      // programatik ikinci çağrı da istek göndermez
      expect(await p.view.createFromCommand(p.ctx)).toEqual({ok: false, blocked: "NO_PREVIEW"});
      expect(calls.length).toBe(2);
    });

    it("validation before submit: empty, control characters and over-length are refused with the server's codes and NO request is sent", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app), p = await panel(bridge);
      for (const [text, code] of [["   ", "INTAKE_EMPTY"], ["bad\u0007bell", "INTAKE_CONTROL_CHARS"], ["x".repeat(2001), "INTAKE_TOO_LONG"]] as const) {
        expect(await p.view.submitCommand(p.ctx, text), code).toEqual({ok: false});
        expect(p.el("command-intake-error")!.dataset.commandError).toBe(code);
        expect(p.el("command-intake-error")!.textContent).toContain(p.t("cmdIntake.invalid"));
        expect(p.el("command-intake-create")).toBeUndefined();
        // sunucu da aynı kodu verir (istemci denetimi sunucuyu taklit eder, ondan gevşek değildir)
        expect((await inject(app, "POST", "/v1/command-intake", {text})).json().error).toBe(code);
      }
      expect(calls).toEqual([]);
      expect(p.settled.at(-1)).toEqual(["id:command-intake-text"]);
    });

    it("gate: a risky command previews as FOUNDER_ATTENTION_REQUIRED, Create is disabled with the reason, and createFromCommand sends nothing", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app), p = await panel(bridge);
      expect(await p.view.submitCommand(p.ctx, "delete the production database and push --force")).toEqual({ok: true});
      expect(p.el("command-intake-result")!.dataset.commandOutcome).toBe("FOUNDER_ATTENTION_REQUIRED");
      expect(p.el("command-intake-create")!.disabled).toBe(true);
      const note = p.el("command-intake-blocked")!;
      expect(note.hidden).toBe(false);
      expect(note.dataset.blockedReason).toBe("FOUNDER_ATTENTION_REQUIRED");
      expect(note.textContent).toBe(p.t("cmdIntake.blocked.FOUNDER_ATTENTION_REQUIRED"));
      expect(await p.view.createFromCommand(p.ctx)).toEqual({ok: false, blocked: "FOUNDER_ATTENTION_REQUIRED"});
      expect(p.el("command-intake-refused")!.dataset).toMatchObject({refusedKind: "blocked", refusedCode: "FOUNDER_ATTENTION_REQUIRED"});
      expect(calls.map(c => c.path)).toEqual(["/v1/command-intake"]);
      expect((await inject(app, "GET", "/v1/intakes")).json().intakes).toEqual([]);
    });

    it("gate: editing the command after the preview disables Create live (PREVIEW_STALE) without a re-render, and re-enables on the same text", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app), p = await panel(bridge);
      await p.view.submitCommand(p.ctx, OK_CMD);
      const btn = p.el("command-intake-create")!, note = p.el("command-intake-blocked")!;
      expect(btn.disabled).toBe(false);
      await p.type(`${OK_CMD} ve sil`);
      expect(btn.disabled).toBe(true);
      expect(note.hidden).toBe(false);
      expect(note.dataset.blockedReason).toBe("PREVIEW_STALE");
      expect(await p.view.createFromCommand(p.ctx)).toEqual({ok: false, blocked: "PREVIEW_STALE"});
      expect(calls.map(c => c.path)).toEqual(["/v1/command-intake"]);
      const p2 = await panel(bridge);
      await p2.view.submitCommand(p2.ctx, OK_CMD); const b2 = p2.el("command-intake-create")!;
      await p2.type("x"); expect(b2.disabled).toBe(true);
      await p2.type(OK_CMD); expect(b2.disabled).toBe(false);
    });

    it("gate: a PROPOSED command shorter than the intake minimum (10) is blocked as IDEA_TOO_SHORT", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app), p = await panel(bridge);
      expect(await p.view.submitCommand(p.ctx, "test it")).toEqual({ok: true});
      expect(p.el("command-intake-result")!.dataset.commandOutcome).toBe("PROPOSED");
      expect(p.el("command-intake-blocked")!.dataset.blockedReason).toBe("IDEA_TOO_SHORT");
      expect(await p.view.createFromCommand(p.ctx)).toEqual({ok: false, blocked: "IDEA_TOO_SHORT"});
      expect(calls.map(c => c.path)).toEqual(["/v1/command-intake"]);
    });

    it("server refusal: with GLOBAL STOP active the real server answers 423 and the panel shows GLOBAL_STOP_ACTIVE; nothing is created", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app), p = await panel(bridge);
      await p.view.submitCommand(p.ctx, OK_CMD);
      expect((await inject(app, "POST", "/v1/control/stop", {reason: "t0011"})).statusCode).toBe(200);
      expect(await p.view.createFromCommand(p.ctx)).toEqual({ok: false, code: "GLOBAL_STOP_ACTIVE"});
      expect(calls.at(-1)).toMatchObject({path: "/v1/intakes", status: 423});
      const r = p.el("command-intake-refused")!;
      expect(r.dataset).toMatchObject({refusedKind: "refused", refusedCode: "GLOBAL_STOP_ACTIVE"});
      expect(r.getAttribute("role")).toBe("alert");
      expect(r.textContent).toContain("HTTP 423");
      expect(p.el("command-intake-created")).toBeUndefined();
      expect((await inject(app, "GET", "/v1/intakes")).json().intakes).toEqual([]);
    });

    it("unavailable: a thrown CONTROL_API_UNREACHABLE on create fails closed as 'unavailable', never as created", async () => {
      const app = mkApp(), {bridge, calls} = mkBridge(app, {unreachableOn: "/v1/intakes"}), p = await panel(bridge);
      await p.view.submitCommand(p.ctx, OK_CMD);
      expect(await p.view.createFromCommand(p.ctx)).toEqual({ok: false, code: "UNAVAILABLE"});
      expect(calls.at(-1)).toMatchObject({path: "/v1/intakes", status: null, error: "CONTROL_API_UNREACHABLE"});
      expect(p.el("command-intake-refused")!.dataset).toMatchObject({refusedKind: "unavailable", refusedCode: "UNAVAILABLE"});
      expect(p.el("command-intake-refused")!.textContent).toContain(p.t("cmdIntake.unavailable"));
      expect(p.el("command-intake-created")).toBeUndefined();
      expect((await inject(app, "GET", "/v1/intakes")).json().intakes).toEqual([]);
    });
  });

  describe("UASCO-T0011 shell entry: Ctrl+K 'New command' and Ctrl+Shift+N reach the command field", () => {
    const HOST = ["status", "bellIcon", "stopBtn", "stopCancel", "stopDialog", "stopConfirm", "resumeBtn", "refreshBtn", "notifyBtn", "langBtn", "projectSelect", "searchInput", "searchResults"];
    async function mkShell() {
      const shellMod = await load("shell.js"), apiMod = await load("api.js"), i18n = await load("i18n.js"), view = await load("views", "intake.js");
      const doc = new D();
      for (const id of HOST) { const n = new N(doc, id === "searchInput" ? "input" : id === "searchResults" ? "ul" : "button"); n.setAttribute("id", id); doc.body.append(n); }
      const t = (k: string, v?: unknown) => i18n.translate("en", k, v), nav: string[] = [];
      const ctx: any = {doc, t, i18n: {lang: "en", t, setLang() {}, onChange() { return () => {}; }}, api: apiMod.createApi({bridge: {}, store: {cache: new Map(), epoch: 0}}), store: {projectId: null, epoch: 0, cache: new Map(), samples: new Map()},
        principal: "FOUNDER_LOCAL", currentRouteId: () => "home", navigate: (id: string) => nav.push(id), selectProject() {}};
      const prev = (globalThis as any).window; (globalThis as any).window = {localStorage: {getItem: () => "1", setItem() {}, removeItem() {}}};
      const shell = shellMod.createShell(ctx); try { shell.wireStatic(); } finally { (globalThis as any).window = prev; }
      view.commandUi.focusPending = false;
      return {doc, ctx, nav, view, t, shell};
    }
    const opts = (doc: D) => byId(doc.body, "searchResults")!.all().filter(n => n.getAttribute("role") === "option");

    it("the palette lists 'New command' first; Enter on it navigates to Projects and requests focus for the command field", async () => {
      const e = await mkShell(), inp = byId(e.doc.body, "searchInput")!;
      await inp.fire("focus");
      expect(opts(e.doc)[0].textContent).toContain(e.t("palette.newCommand"));
      inp.value = "command"; await inp.fire("input");
      expect(opts(e.doc)[0].textContent).toContain(e.t("palette.newCommand"));
      await inp.fire("keydown", {key: "Enter"});
      expect(e.nav).toEqual(["projects"]);
      expect(e.view.commandUi.focusPending).toBe(true);
    });

    it("Ctrl+Shift+N (and Cmd+Shift+N) from anywhere does the same; plain Ctrl+N, Shift+N and Ctrl+Alt+Shift+N do nothing", async () => {
      const e = await mkShell();
      for (const ev of [{key: "n", ctrlKey: true}, {key: "N", shiftKey: true}, {key: "N", ctrlKey: true, shiftKey: true, altKey: true}]) expect(await e.doc.fire("keydown", ev), JSON.stringify(ev)).toBe(false);
      expect(e.nav).toEqual([]);
      expect(await e.doc.fire("keydown", {key: "N", ctrlKey: true, shiftKey: true})).toBe(true);
      expect(await e.doc.fire("keydown", {key: "N", metaKey: true, shiftKey: true})).toBe(true);
      expect(e.nav).toEqual(["projects", "projects"]);
    });

    it("a pending focus request focuses the command textarea once, after the panel is mounted", async () => {
      const p = await panel({apiPost: async () => ({status: 200, body: {}})});
      p.view.requestCommandFocus();
      await p.ctx.rerender();
      expect(p.view.commandUi.focusPending).toBe(false);
      expect(p.doc.activeElement).toBeNull(); // henüz değil: app.js önce başlığı odaklar
      await tick();
      expect(p.doc.activeElement).toBe(p.el("command-intake-text"));
      p.doc.activeElement = null; await p.ctx.rerender(); await tick();
      expect(p.doc.activeElement).toBeNull(); // tek seferlik
    });
  });

  describe("UASCO-T0011 pure core: checkCommand mirrors the server, commandCreateGate is fail-closed", () => {
    it("checkCommand returns the server's code for each input class (same precedence as core/mission/command-intake.ts)", async () => {
      const core = await load("intake-core.js"), {intakeCommand} = await import("../../core/mission/command-intake.js");
      const cases: unknown[] = [42, null, "", "   ", "a\u0000b", "\u0007   ", "x".repeat(2000), "x".repeat(2001), `${"x".repeat(2001)}\u0001`, "tab\tand\nnewline ok", OK_CMD];
      for (const c of cases) {
        const s = intakeCommand(c), m = core.checkCommand(c);
        expect(m.ok, JSON.stringify(c)?.slice(0, 40)).toBe(s.ok);
        if (!s.ok) expect(m.code).toBe(s.code);
      }
    });
    it("commandCreateGate refuses every non-PROPOSED / authority / stale / non-DRAFT / short case and allows only the clean one", async () => {
      const {commandCreateGate: g} = await load("intake-core.js");
      const P = {status: "DRAFT", outcome: "PROPOSED", authorityRequired: false, authorization: {verified: false}};
      expect(g(P, OK_CMD, OK_CMD)).toEqual({allowed: true, reason: null});
      expect(g(null, OK_CMD, OK_CMD).reason).toBe("NO_PREVIEW");
      expect(g(P, null, OK_CMD).reason).toBe("PREVIEW_STALE");
      expect(g(P, OK_CMD, `${OK_CMD} `).reason).toBe("PREVIEW_STALE");
      expect(g({...P, status: "AUTHORIZED"}, OK_CMD, OK_CMD).reason).toBe("NOT_DRAFT");
      expect(g({...P, authorization: {verified: true}}, OK_CMD, OK_CMD).reason).toBe("NOT_DRAFT");
      expect(g({...P, authorization: undefined}, OK_CMD, OK_CMD).reason).toBe("NOT_DRAFT");
      expect(g({...P, outcome: "FOUNDER_ATTENTION_REQUIRED"}, OK_CMD, OK_CMD).reason).toBe("FOUNDER_ATTENTION_REQUIRED");
      expect(g({...P, authorityRequired: true}, OK_CMD, OK_CMD).reason).toBe("AUTHORITY_REQUIRED");
      expect(g({...P, authorityRequired: undefined}, OK_CMD, OK_CMD).reason).toBe("AUTHORITY_REQUIRED");
      expect(g(P, "  short   ", "  short   ").reason).toBe("IDEA_TOO_SHORT");
    });
    it("every blocked reason and new key exists in en and tr with the same placeholders", async () => {
      const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
      const keys = ["cmdIntake.hint", "cmdIntake.count", "cmdIntake.invalid", "cmdIntake.create", "cmdIntake.created", "cmdIntake.createdNote", "cmdIntake.intakeId", "cmdIntake.refused", "cmdIntake.unavailable", "palette.newCommand", "palette.commandKeyword",
        ...["NO_PREVIEW", "PREVIEW_STALE", "NOT_DRAFT", "FOUNDER_ATTENTION_REQUIRED", "AUTHORITY_REQUIRED", "IDEA_TOO_SHORT", "INVALID_INTAKE"].map(r => `cmdIntake.blocked.${r}`)];
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      for (const k of keys) { expect(typeof en[k], k).toBe("string"); expect(typeof tr[k], k).toBe("string"); expect(ph(tr[k]), k).toEqual(ph(en[k])); }
    });
  });
}
