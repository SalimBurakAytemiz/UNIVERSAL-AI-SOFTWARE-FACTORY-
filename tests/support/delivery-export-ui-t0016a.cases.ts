// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-delivery.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0016.A A_UI kısmıdır: masaüstü Project Studio > Teslim
// kartındaki "Teslim paketini dışa aktar" sonucunun kullanıcıya GERÇEK biçimde gösterildiğini doğrular. GERÇEK buildServer gerçek bir teslimi hazırlar + kabul eder; renderer GERÇEK
// delivery-panel görünümünü GERÇEK api.js üzerinden çizer; köprü main.mjs'nin uasco:export-delivery işleyicisini birebir izler ve main.mjs'nin GERÇEK sanitizePostBody + deliveryExportCheck
// fonksiyonlarını kaynaktan değerlendirir. Başarıda kayıt konumu + dosya adı + sha256, başarısızlıkta GERÇEK neden kodu kartta görünür (genel "kayıt okunamadı" metnine çökertilmez).
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {WorkOsStore} from "../../core/workos/store.js";
import {ExecutionGate} from "../../core/workos/execution-gate.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import {setup, okScript, runner, api, HDR, tmpRoot, rmTmp, TOKEN} from "./relfx.js";
import type {Ctx} from "./relfx.js";
import {PROPOSED_DELIVERY_EXPORT_CHECK} from "./delivery-export-aud022.cases.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const block = (name: string): string => { const m = new RegExp(`// ${name}-BEGIN\\n([\\s\\S]*?)// ${name}-END`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs ${name} block not found`); return m[1]; };
const fnSrc = (name: string): string => { const m = new RegExp(`\\nfunction ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n`).exec(MAIN_SRC); if (!m) throw new Error(`main.mjs function ${name} not found`); return m[0]; };
type Check = (body: unknown, runId: string, root: string, f: typeof fs, p: typeof path, c: typeof crypto) => {ok: boolean; reason?: string; sha256?: string; bytes?: Buffer; fileName?: string};
const mainCheck = new Function(`${block("M1A-C2")}\nreturn deliveryExportCheck;`)() as Check;
const proposedCheck = (() => {
  const src = block("M1A-C2"), a = src.indexOf("function deliveryExportCheck("), b = src.indexOf("\n}\n", a) + 3;
  return new Function(`${src.slice(0, a)}${PROPOSED_DELIVERY_EXPORT_CHECK}${src.slice(b)}\nreturn deliveryExportCheck;`)() as Check;
})();
const sanitize = new Function("token", `${fnSrc("scrubText")}${fnSrc("sanitizePostBody")}\nreturn sanitizePostBody;`)(TOKEN) as (status: number, parsed: unknown) => any;

// ---------- Sahte DOM (v7-m1a-desktop biçimi) ----------
class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; value = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>();
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get isConnected() { return this.doc.body.contains(this); }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; if (node.parent) node.parent.children = node.parent.children.filter(x => x !== node); node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children.forEach(c => { c.parent = null; }); this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  removeEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, (this.ls.get(ev) ?? []).filter(x => x !== fn)); }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
  focus() { if (this.tagName !== "#TEXT" && this.isConnected) this.doc.focused = this; }
  contains(n: N | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  querySelectorAll(sel: string): N[] {
    const keys = sel.split(",").map(s => s.trim().replace(/^\[|\]$/g, ""));
    const has = (n: N, k: string) => k.startsWith("data-") ? k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()) in n.dataset : n.attrs.has(k);
    return all(this).filter(n => keys.some(k => has(n, k)));
  }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  get documentElement() { return this.body; }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string): N | null { return all(this.body).find(n => n.id === id) ?? null; }
  get activeElement(): N { return this.focused && this.body.contains(this.focused) ? this.focused : this.body; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const byData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

let tmp = "";
const apps: Array<{close: () => Promise<unknown>}> = [];
type App = ReturnType<typeof api>;

/** Gerçek teslim: web-node şablon projesi + mission + sahte executor koşusu + POST prepare + POST accept (NOT_VERIFIED kaynak kabulü). */
async function acceptedDelivery(c: Ctx) {
  const app = api(c, {sandbox: undefined}); apps.push(app);
  const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "T0016A App", environmentId: "dev", template: "web-node", idempotencyKey: "t0016a"}});
  expect(created.statusCode, created.body).toBe(201);
  const pid = created.json().project.projectId as string;
  const mc = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: pid, title: "Add feature", objective: "feature.txt says ok", acceptanceCriteria: ["reviewed"], riskLevel: "R1"}});
  const missionId = mc.json().mission.missionId as string;
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await app.inject({method: "POST", url: `/v1/missions/${missionId}/transition`, headers: HDR, payload: {to, reason: "go"}})).statusCode).toBe(200);
  const fake = new FakeExecutors(okScript({implement: () => ({files: {"feature.txt": "ok\n"}})})), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
  const r0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  await runner({...c, store, missionId}, fake, {executionGate: new ExecutionGate(null)}).tick();
  const runId = r0.runId;
  const prep = await app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/prepare`, headers: HDR, payload: {}});
  expect(prep.statusCode, prep.body).toBe(201);
  const art = prep.json().artifact;
  const reqs = prep.json().delivery?.acceptanceRequirements ?? {};
  const acceptance: Record<string, unknown> = {runId: art.runId, missionId: art.missionId, sourceCommit: art.sourceCommit, exportArtifactHash: art.exportArtifactHash, acknowledgeNotExecuted: true};
  if (reqs.testChanges?.required) { acceptance.acknowledgeTestChanges = true; acceptance.testSurfaceSha256 = reqs.testChanges.testSurfaceSha256; }
  const acc = await app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/accept`, headers: HDR, payload: {acceptance}});
  expect(acc.statusCode, acc.body).toBe(200);
  return {app, pid, runId, hash: art.exportArtifactHash as string, root: path.join(c.dataDir, "deliveries")};
}

/** main.mjs uasco:export-delivery işleyicisinin birebir izi (ipcMain/dialog yerine enjekte edilen kaydetme yolu); `check` main.mjs'nin GERÇEK ya da önerilen deliveryExportCheck'idir. */
function mainBridge(app: App, root: string, check: Check, savePath: () => string | null) {
  const calls: string[] = [];
  return {calls, async exportDelivery(runId: string) {
    calls.push(runId);
    const r = await app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/export`, headers: HDR, payload: {}});
    let parsed: unknown = null; try { parsed = JSON.parse(r.body); } catch { parsed = null; }
    const res = {status: r.statusCode, body: sanitize(r.statusCode, parsed)};
    if (res.status !== 200) return {exported: false, reason: typeof res.body?.error === "string" ? res.body.error : "DELIVERY_UNAVAILABLE"};
    const chk = check(res.body, runId, root, fs, path, crypto); if (!chk.ok) return {exported: false, reason: chk.reason};
    const filePath = savePath(); if (!filePath) return {exported: false, reason: "CANCELLED"};
    try { fs.writeFileSync(filePath, chk.bytes!); const back = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); if (back !== chk.sha256) { fs.rmSync(filePath, {force: true}); return {exported: false, reason: "DELIVERY_ARTIFACT_HASH_MISMATCH"}; } }
    catch { return {exported: false, reason: "DELIVERY_WRITE_FAILED"}; }
    return {exported: true, sha256: chk.sha256, fileName: path.basename(filePath), savedTo: filePath};
  }};
}

/** Gerçek renderer: api.js (GET köprüsü gerçek sunucuya inject eder) + delivery-panel görünümü + focus.js. */
async function rendererCtx(app: App, pid: string, native: unknown, lang = "en") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), focus = await load("focus.js"), dp = await load("views", "delivery-panel.js");
  const doc = new D(), store = st.createStore(null);
  const bridge = {apiGet: async (p: string) => { const r = await app.inject({method: "GET", url: p, headers: HDR}); if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`); return r.json(); }};
  const capi = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const view = {render: async (c: any) => dp.runDeliveriesPanel(c, await c.api.deliveries(pid))};
  const ctx: any = {doc, store, api: capi, native, i18n: {lang, t}, t, navigate() {}, principal: "FOUNDER_LOCAL", selectProject() {}, renderAttention() {},
    refreshAll: async () => { await ctx.rerender(); }, confirm: async () => false,
    rerender: async () => { store.cache.clear(); doc.body.replaceChildren(await view.render(ctx)); },
    settleFocus: (opts: any) => focus.settleFocus(doc, doc.body, opts)};
  doc.body.replaceChildren(await view.render(ctx));
  return {ctx, doc, t};
}
const resultOf = (doc: D, runId: string) => byData(byData(doc.body, "deliveryRun", runId)[0], "exportResult")[0];

export function registerDeliveryExportUiT0016aCases(): void {
  describe("UASCO-T0016.A (A_UI): desktop delivery export shows the real outcome (real buildServer + real main.mjs functions + real renderer panel)", () => {
    vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
    let forms: any;
    beforeEach(async () => { tmp = tmpRoot("uasco-t0016a-"); forms = await load("forms.js"); forms.resetAllForms(); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(tmp); });

    it("today's main.mjs: clicking export shows the exact failure code (DELIVERY_ARTIFACT_MISSING, AUD-022) in a structured result block, never success and never the generic 'record could not be read'", async () => {
      const c = setup(tmp), d = await acceptedDelivery(c);
      const out = path.join(tmp, "out.zip"), native = mainBridge(d.app, d.root, mainCheck, () => out);
      const {doc, t} = await rendererCtx(d.app, d.pid, native);
      const card = byData(doc.body, "deliveryRun", d.runId)[0];
      expect(card.dataset.deliveryState).toBe("ACCEPTED");
      byId(doc.body, `dl-export-${d.runId}`)!.fire("click");
      await tick();
      expect(native.calls).toEqual([d.runId]);
      const res = resultOf(doc, d.runId);
      const unscrubbedOk = mainCheck(JSON.parse((await d.app.inject({method: "POST", url: `/v1/work-runs/${d.runId}/delivery/export`, headers: HDR, payload: {}})).body), d.runId, d.root, fs, path, crypto).ok;
      expect(unscrubbedOk).toBe(true); // tek neden main.mjs'nin temizlenmiş yoludur (D kısmı)
      if (res.dataset.exportResult === "EXPORTED") {
        // main.mjs düzeltildiyse (UASCO-T0016.D) aynı kart gerçek konumu gösterir
        expect(byData(res, "exportField", "savedTo")[0].textContent).toBe(out);
      } else {
        expect(res.dataset).toMatchObject({exportResult: "FAILED", exportReason: "DELIVERY_ARTIFACT_MISSING"});
        expect(byData(res, "exportField", "code")[0].textContent).toBe("DELIVERY_ARTIFACT_MISSING");
        const status = byId(doc.body, `dl-${d.runId}-status`)!;
        expect(status.dataset.result).toBe("error");
        expect(status.attrs.get("role")).toBe("alert");
        expect(status.textContent).toBe(t("m1a.delivery.reason.DELIVERY_ARTIFACT_MISSING"));
        expect(status.textContent).not.toBe(t("m1a.delivery.reason.DELIVERY_UNAVAILABLE"));
        expect(fs.existsSync(out)).toBe(false);
      }
      expect(doc.activeElement).not.toBe(doc.body);
    });

    it("with the proposed Founder-tier main.mjs check: export succeeds and the card shows the real saved location, file name and the re-verified SHA-256 of the bytes on disk (en + tr)", async () => {
      const c = setup(tmp), d = await acceptedDelivery(c);
      for (const lang of ["en", "tr"]) {
        forms.resetAllForms();
        const out = path.join(tmp, `UASCO-teslim-${lang}.zip`), native = mainBridge(d.app, d.root, proposedCheck, () => out);
        const {doc, t} = await rendererCtx(d.app, d.pid, native, lang);
        byId(doc.body, `dl-export-${d.runId}`)!.fire("click");
        await tick();
        const res = resultOf(doc, d.runId);
        expect(res.dataset.exportResult).toBe("EXPORTED");
        const disk = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
        expect(disk).toBe(d.hash);
        expect(byData(res, "exportField", "savedTo")[0].textContent).toBe(out);
        expect(byData(res, "exportField", "fileName")[0].textContent).toBe(path.basename(out));
        expect(byData(res, "exportField", "sha256")[0].textContent).toBe(disk);
        expect(res.textContent).toContain(t("m1a.delivery.exportResult.savedTo"));
        const status = byId(doc.body, `dl-${d.runId}-status`)!;
        expect(status.dataset.result).toBe("ok");
        expect(status.textContent).toContain(out);
        expect(status.textContent).toContain(disk);
      }
    });

    it("failure paths keep their real reason: cancelled save dialog, server 404 (unknown run state) and an unrecognised main-process code are shown verbatim; a bridge exception is BRIDGE_ERROR; no claim of success without a hash", async () => {
      const c = setup(tmp), d = await acceptedDelivery(c);
      // kaydetme diyaloğu iptal
      let r = await rendererCtx(d.app, d.pid, mainBridge(d.app, d.root, proposedCheck, () => null));
      byId(r.doc.body, `dl-export-${d.runId}`)!.fire("click"); await tick();
      expect(resultOf(r.doc, d.runId).dataset).toMatchObject({exportResult: "FAILED", exportReason: "CANCELLED"});
      // gerçek sunucu hatası: koşu deposundan silinmiş artefakt -> sunucunun kendi kodu aynen taşınır
      fs.rmSync(path.join(d.root, d.runId), {recursive: true, force: true});
      forms.resetAllForms();
      const realNative = mainBridge(d.app, d.root, proposedCheck, () => path.join(tmp, "never.zip"));
      const direct = await realNative.exportDelivery(d.runId);
      expect(direct.exported).toBe(false);
      r = await rendererCtx(d.app, d.pid, realNative);
      byId(r.doc.body, `dl-export-${d.runId}`)!.fire("click"); await tick();
      const res = resultOf(r.doc, d.runId);
      expect(res.dataset.exportReason).toBe((direct as any).reason);
      expect(byData(res, "exportField", "code")[0].textContent).toBe((direct as any).reason);
      expect(fs.existsSync(path.join(tmp, "never.zip"))).toBe(false);
      // tanınmayan ama güvenli biçimli kod: genel metne çökertilmez, aynen gösterilir
      forms.resetAllForms();
      r = await rendererCtx(d.app, d.pid, {exportDelivery: async () => ({exported: false, reason: "EXPORT_BLOCKED_SECRET"})});
      byId(r.doc.body, `dl-export-${d.runId}`)!.fire("click"); await tick();
      expect(resultOf(r.doc, d.runId).dataset.exportReason).toBe("EXPORT_BLOCKED_SECRET");
      expect(byId(r.doc.body, `dl-${d.runId}-status`)!.textContent).toBe(r.t("m1a.delivery.reason.UNRECOGNISED", {code: "EXPORT_BLOCKED_SECRET"}));
      // köprü istisnası
      forms.resetAllForms();
      r = await rendererCtx(d.app, d.pid, {exportDelivery: async () => { throw new Error("INVALID_RUN_ID"); }});
      byId(r.doc.body, `dl-export-${d.runId}`)!.fire("click"); await tick();
      expect(resultOf(r.doc, d.runId).dataset.exportReason).toBe("BRIDGE_ERROR");
      // hash'siz "başarı" kabul edilmez
      forms.resetAllForms();
      r = await rendererCtx(d.app, d.pid, {exportDelivery: async () => ({exported: true, savedTo: "/x.zip"})});
      byId(r.doc.body, `dl-export-${d.runId}`)!.fire("click"); await tick();
      expect(resultOf(r.doc, d.runId).dataset).toMatchObject({exportResult: "FAILED", exportReason: "DELIVERY_RESULT_INVALID"});
    });

    it("pure core: describeExportResult/exportMessage classify bridge answers fail-closed; unsafe reason text becomes UNKNOWN; the export button is disabled while an export is in flight", async () => {
      const core = await load("delivery-core.js"), H = "e".repeat(64);
      expect(core.describeExportResult({exported: true, sha256: H, savedTo: "C:\\x\\a.zip", fileName: "a.zip"})).toEqual({ok: true, code: "EXPORTED", known: true, savedTo: "C:\\x\\a.zip", fileName: "a.zip", sha256: H});
      expect(core.describeExportResult({exported: true, sha256: "zz", savedTo: "/a"}).code).toBe("DELIVERY_RESULT_INVALID");
      expect(core.describeExportResult({exported: true, sha256: H}).code).toBe("DELIVERY_RESULT_INVALID");
      expect(core.describeExportResult(null).code).toBe("DELIVERY_RESULT_INVALID");
      expect(core.describeExportResult(undefined, {thrown: true}).code).toBe("BRIDGE_ERROR");
      expect(core.describeExportResult(undefined, {noBridge: true}).code).toBe("NO_BRIDGE");
      expect(core.describeExportResult({exported: false, reason: "<img src=x>"}).code).toBe("UNKNOWN");
      expect(core.describeExportResult({exported: false, reason: "[path] boom"}).code).toBe("UNKNOWN");
      for (const code of core.DELIVERY_EXPORT_REASONS) expect(core.exportMessage(core.describeExportResult({exported: false, reason: code})).key).toBe(`m1a.delivery.reason.${code}`);
      expect(core.exportMessage(core.describeExportResult({exported: false, reason: "SOMETHING_NEW"}))).toEqual({key: "m1a.delivery.reason.UNRECOGNISED", vars: {code: "SOMETHING_NEW"}});
      // locale parity for every new key
      const en = (await load("locales", "en.js")).default ?? (await load("locales", "en.js")).en, tr = (await load("locales", "tr.js")).default ?? (await load("locales", "tr.js")).tr;
      const keys = [...core.DELIVERY_EXPORT_REASONS.map((c: string) => `m1a.delivery.reason.${c}`), "m1a.delivery.reason.UNRECOGNISED", ...["ok", "failed", "savedTo", "fileName", "sha256", "code"].map(k => `m1a.delivery.exportResult.${k}`)];
      for (const k of keys) { expect(typeof en[k], k).toBe("string"); expect(typeof tr[k], k).toBe("string"); }
      // in-flight: second click is ignored and the button is disabled
      const c = setup(tmp), d = await acceptedDelivery(c);
      let release: (v: unknown) => void = () => {}; let n = 0;
      const native = {exportDelivery: () => { n++; return new Promise(res => { release = res; }); }};
      const r = await rendererCtx(d.app, d.pid, native);
      const dp = await load("views", "delivery-panel.js");
      const p1 = dp.exportDelivery(r.ctx, {runId: d.runId});
      await r.ctx.rerender();
      expect(byId(r.doc.body, `dl-export-${d.runId}`)!.attrs.has("disabled")).toBe(true);
      expect(await dp.exportDelivery(r.ctx, {runId: d.runId})).toEqual({ok: false, busy: true});
      release({exported: false, reason: "CANCELLED"});
      expect(await p1).toMatchObject({ok: false, code: "CANCELLED"});
      expect(n).toBe(1);
      expect(byId(r.doc.body, `dl-export-${d.runId}`)!.attrs.has("disabled")).toBe(false);
    });
  });
}
