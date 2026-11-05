// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-inbox.test.ts tarafından içe aktarılır) Builder I'nin Onay merkezi kapısını gerçek buildServer'a karşı doğrular: sunucunun cockpit okuması Global Stop'un etkin olduğunu söylerken ya da sunucu son kararı yeniden denemenin işe yaramadığı bir nedenle (423/401/403) reddettikten sonra kabul/ret düğmeleri görünür nedenle devre dışıdır; ret kodu ham iletiyle değil safeErrorCode ile (data-state-error-code) gösterilir. Köprü main.mjs'in gerçek B4 GET / B5 POST izin listesi bloklarıdır.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", ".."), REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string) => { const a = MAIN_SRC.indexOf(`// ${name}-BEGIN`), b = MAIN_SRC.indexOf(`// ${name}-END`); if (a < 0 || b < 0) throw new Error(`main.mjs ${name} block not found`); return MAIN_SRC.slice(a, b); };
const extraGet = new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const postGates = new Function(`${block("B5-POST-ALLOWLIST")}\nreturn {desktopPostPathAllowed, desktopPostBodyCheck};`)() as {desktopPostPathAllowed: (v: unknown) => boolean; desktopPostBodyCheck: (b: unknown) => {ok: boolean; text?: string; error?: string}};
const TOKEN = "t".repeat(32), RECORDER = "implementer@local.invalid", hdr = {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"};
const IPC = (ch: string, code: string) => `Error invoking remote method '${ch}': Error: ${code}`; // Electron's wrapping of a rejected main-process handler

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
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "disabled") this.disabled = true; } // as in a real DOM, the disabled attribute sets the property
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
const byId = (r: N, id: string) => all(r).find(n => n.id === id);

type App = ReturnType<typeof buildServer>;
let tmp = ""; const apps: App[] = [];

async function setup({postFails = null as null | string} = {}) {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data"); fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir), scope = {tenantId: "tA"};
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "Gate project", environmentId: "env-dev", createdBy: RECORDER});
  const m = store.createMission({tenantId: "tA", projectId: p.projectId, title: "Gate mission", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
  for (const to of ["PREFLIGHT", "FOUNDER_ATTENTION_REQUIRED"] as const) store.transitionMission(scope, m.missionId, to, "seed", RECORDER);
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false}); apps.push(app);
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), forms = await load("forms.js");
  forms.resetAllForms?.();
  const doc = new D(), cache = st.createStore(null), posts: Array<{path: string; status: number}> = [];
  const bridge = {
    apiGet: async (q: string) => { if (!desktopGetPathAllowed(q) && !extraGet(q)) throw new Error(IPC("uasco:api-get", "INVALID_API_PATH")); const r = await app.inject({method: "GET", url: q, headers: hdr}); if (r.statusCode !== 200) throw new Error(IPC("uasco:api-get", `${q}: HTTP ${r.statusCode}`)); return r.json(); },
    apiPost: async (q: string, b: unknown) => {
      if (postFails) throw new Error(IPC("uasco:api-post", postFails));
      if (!postGates.desktopPostPathAllowed(q)) throw new Error(IPC("uasco:api-post", "INVALID_API_PATH"));
      const prepared = postGates.desktopPostBodyCheck(b); if (!prepared.ok) throw new Error(prepared.error);
      const r = await app.inject({method: "POST", url: q, headers: {...hdr, "content-type": "application/json"}, payload: prepared.text});
      posts.push({path: q, status: r.statusCode}); let body: any = {}; try { body = r.json(); } catch { /* non-json */ } return {status: r.statusCode, body};
    }
  };
  const api = apiMod.createApi({bridge, store: cache});
  const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
  // refreshAll is a no-op on purpose: after a refused POST the cockpit read stays as it was (a stale view), so the gate must come from the refusal itself
  const ctx: any = {doc, store: cache, api, i18n: {lang: "en", t}, t, navigate: () => undefined, rerender: async () => undefined, refreshAll: async () => undefined, settleFocus: () => undefined,
    confirm: async () => true, selectProject: () => undefined, principal: "FOUNDER_LOCAL", now: () => Date.now(), renderAttention: () => undefined};
  const inbox = await load("views", "inbox.js");
  const view = async () => { const root: N = await inbox.render(ctx); doc.body.replaceChildren(root); return root; };
  const stop = async () => { const r = await app.inject({method: "POST", url: "/v1/control/stop", headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify({reason: "gate test"})}); expect(r.statusCode).toBe(200); };
  const transitionDirect = async (to: string) => app.inject({method: "POST", url: `/v1/missions/${m.missionId}/transition`, headers: {...hdr, "content-type": "application/json"}, payload: JSON.stringify({to, reason: "direct"})});
  return {app, ctx, view, stop, transitionDirect, mission: m, posts, forms, inbox, cache};
}
const btns = (root: N, mid: string) => ["PREFLIGHT", "BLOCKED"].map(to => byId(root, `ib-${to}-${mid}`)!);

export function registerInboxGateCases(): void {
describe("Builder I — Approval center gate against the real control-api (Global Stop / non-retriable refusal disable the decision buttons; refusal code via safeErrorCode)", () => {
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-gate-")); });
  afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

  it("control: no Global Stop -> retry and reject are active with no gate; a real retry transition succeeds and shows no refusal code", { timeout: 60_000 }, async () => {
    const s = await setup();
    const root = await s.view();
    const [retry, reject] = btns(root, s.mission.missionId);
    expect(retry).toBeDefined(); expect(reject).toBeDefined();
    for (const b of [retry, reject]) { expect(b.disabled, b.id).toBe(false); expect(b.getAttribute("aria-describedby")).toBeNull(); expect(b.dataset.decisionGate).toBeUndefined(); }
    expect(byId(root, `ib-gate-${s.mission.missionId}`)).toBeUndefined();
    for (const fn of retry.ls.get("click") ?? []) await fn({});
    expect(s.posts.map(p => p.status)).toEqual([200]);
    const after = await s.view();
    expect(all(after).some(n => n.dataset.stateErrorCode !== undefined)).toBe(false);
  });

  it("Global Stop active (server's own cockpit) -> both buttons disabled, described by a visible GLOBAL_STOP_ACTIVE reason; the server itself refuses the transition with 423", { timeout: 60_000 }, async () => {
    const s = await setup();
    await s.stop();
    const root = await s.view();
    const why = byId(root, `ib-gate-${s.mission.missionId}`)!;
    expect(why).toBeDefined(); expect(why.dataset.decisionGateWhy).toBe("GLOBAL_STOP_ACTIVE");
    expect(why.textContent).toContain("Global Stop is active"); expect(why.textContent).toContain("GLOBAL_STOP_ACTIVE");
    for (const b of btns(root, s.mission.missionId)) { expect(b.disabled, b.id).toBe(true); expect(b.getAttribute("aria-describedby")).toBe(`ib-gate-${s.mission.missionId}`); expect(b.dataset.decisionGate).toBe("GLOBAL_STOP_ACTIVE"); }
    const direct = await s.transitionDirect("PREFLIGHT");
    expect([direct.statusCode, direct.json().error]).toEqual([423, "GLOBAL_STOP_ACTIVE"]);
  });

  it("stale view: the stop lands after render, the press is refused 423 by the real server -> the refusal code GLOBAL_STOP_ACTIVE is shown via data-state-error-code and the buttons are gated", { timeout: 60_000 }, async () => {
    const s = await setup();
    const root = await s.view();
    const [retry] = btns(root, s.mission.missionId);
    expect(retry.disabled).toBe(false);
    await s.stop();
    for (const fn of retry.ls.get("click") ?? []) await fn({});
    expect(s.posts.map(p => p.status)).toEqual([423]);
    const after = await s.view(); // cockpit read is still the cached pre-stop one: the gate must come from the refusal
    const code = all(after).find(n => n.dataset.stateErrorCode !== undefined)!;
    expect([code.dataset.stateErrorCode, code.textContent]).toEqual(["GLOBAL_STOP_ACTIVE", "GLOBAL_STOP_ACTIVE"]);
    const why = byId(after, `ib-gate-${s.mission.missionId}`)!;
    expect(why.dataset.decisionGateWhy).toBe("GLOBAL_STOP_ACTIVE"); expect(why.textContent).toContain("retrying will not help");
    for (const b of btns(after, s.mission.missionId)) expect(b.disabled, b.id).toBe(true);
  });

  it("bridge failure (Electron IPC-wrapped): only the code is shown, never the raw message; not a non-retriable refusal, so no gate", { timeout: 60_000 }, async () => {
    const s = await setup({postFails: "INVALID_API_PATH"});
    const root = await s.view();
    for (const fn of btns(root, s.mission.missionId)[0].ls.get("click") ?? []) await fn({});
    const after = await s.view();
    expect(all(after).filter(n => n.dataset.stateErrorCode !== undefined).map(n => n.textContent)).toEqual(["INVALID_API_PATH"]);
    expect(all(after).some(n => n.children.length === 0 && /Error invoking remote method|uasco:api-post/.test(n.textContent))).toBe(false);
    expect(byId(after, `ib-gate-${s.mission.missionId}`)).toBeUndefined();
    for (const b of btns(after, s.mission.missionId)) expect(b.disabled, b.id).toBe(false);
  });

  it("layer pins: performTransition stores only the safe refusal code; the card re-sanitizes whatever status it is given", { timeout: 60_000 }, async () => {
    const s = await setup({postFails: "INVALID_API_PATH"});
    const wa = await load("work-actions.js"), sid = wa.actionStatusId(s.mission.missionId);
    await wa.performTransition(s.ctx, {missionId: s.mission.missionId, title: "Gate mission", from: "FOUNDER_ATTENTION_REQUIRED", to: "PREFLIGHT", reason: "", statusId: sid});
    expect(s.forms.drafts.status[sid].refusal).toEqual({status: null, code: "INVALID_API_PATH"}); // never the IPC-wrapped text
    s.forms.drafts.status[sid] = {ok: false, key: "post.err.generic", vars: {status: "—"}, errors: null, refusal: {status: 403, code: IPC("uasco:api-post", "/v1/x: HTTP 403")}};
    const root = await s.view();
    expect(all(root).filter(n => n.dataset.stateErrorCode !== undefined).map(n => n.textContent)).toEqual(["HTTP 403"]);
    expect(byId(root, `ib-gate-${s.mission.missionId}`)!.dataset.decisionGateWhy).toBe("HTTP 403");
    expect(all(root).some(n => n.children.length === 0 && /Error invoking remote method/.test(n.textContent))).toBe(false);
  });
  it("pure decisionGate: known active stop gates; 423/401/403 refusals gate with their safe code; 409, a thrown bridge error, success and unknown stop state do not", async () => {
    const {decisionGate} = await load("views", "inbox.js");
    expect(decisionGate({known: true, active: true}, undefined)).toEqual({code: "GLOBAL_STOP_ACTIVE", key: "inbox.gate.GLOBAL_STOP_ACTIVE"});
    for (const status of [423, 401, 403]) expect(decisionGate({known: true, active: false}, {ok: false, refusal: {status, code: "SOME_CODE"}})).toEqual({code: "SOME_CODE", key: "inbox.gate.REFUSED"});
    expect(decisionGate(null, {ok: false, refusal: {status: 403, code: "free text at /home/x"}})).toEqual({code: "HTTP 403", key: "inbox.gate.REFUSED"}); // free text never reaches the reason
    for (const st of [{ok: false, refusal: {status: 409, code: "WORKOS_CONFLICT"}}, {ok: false, refusal: {status: null, code: "INVALID_API_PATH"}}, {ok: true, refusal: null}, undefined])
      expect(decisionGate({known: false, active: true}, st as any), JSON.stringify(st)).toBeNull();
  });
});
}
