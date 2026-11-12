// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-wp-qasec.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) DSK-T0006 (UI-038..UI-045) proje başına test stratejisi ve kapsam panelini doğrular:
// saf çekirdek (test-strategy-core.js: gruplama, testCommand, ürün doğrulama ekseni), TEST_SURFACE dosya/özet eşlemesi (assurance-core.js) ve GERÇEK buildServer + gerçek WorkOsStore kayıtları üzerinden render.
// Değişmezler: test kaydı yoksa NOT_EXECUTED; EXECUTED asla PRODUCT_VERIFIED değildir (ürün ekseni yalnız sunucu productVerification alanından); laboratuvarlar kanıtsız NOT_EXECUTED/BLOCKED; POST yok; veri yalnız metin.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {controlChallengeProof, desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), WRONG = "w".repeat(32), RECORDER = "FOUNDER_LOCAL", BASE = "b".repeat(40), HEAD = "a".repeat(40);
// //TR: main.mjs B4-ALLOWLIST bloğu değiştirilmeden okunup değerlendirilir (diğer gerçek-sunucu vakalarıyla aynı yöntem).
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const allowBlock = (() => { const a = MAIN_SRC.indexOf("// B4-ALLOWLIST-BEGIN"), b = MAIN_SRC.indexOf("// B4-ALLOWLIST-END"); if (a < 0 || b < 0) throw new Error("no B4-ALLOWLIST"); return MAIN_SRC.slice(a, b); })();
const extraAllowed = new Function(`${allowBlock}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const desktopAllows = (p: string) => desktopGetPathAllowed(p) || extraAllowed(p);

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; ls = new Map<string, Array<(e: any) => void>>(); value = "";
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  append(...n: Array<N | string>) { for (const c of n) { const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); if (k === "class") this.className = String(v); }
  getAttribute(k: string) { return k === "class" && this.className ? this.className : this.attrs.get(k) ?? null; }
  addEventListener(ev: string, fn: (e: any) => void) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  focus() { /* test double */ }
  fire(ev: string) { for (const fn of this.ls.get(ev) ?? []) fn({preventDefault() {}, target: this}); }
}
class D {
  body: N; constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById() { return null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const byData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const panelText = (r: N, id: string) => byId(r, id)?.textContent ?? "";
const stateNotes = (r: N, id: string) => all(byId(r, id)!).filter(n => /\bnote-[a-z_]+\b/.test(n.className) && n.getAttribute("role") === "status").map(n => n.className.match(/note-([a-z_]+)/)![1]);

// ---- saf çekirdek fixture'ları (mapTestReports çıktı biçimi) ----
const PRJ = (c: string) => `prj_${c.repeat(24)}`;
const rr = (id: string, projectId: string, state: string, records: any[] = [], executedTests: number | null = null) => ({runId: `run_${id.repeat(24)}`, missionId: `msn_${id.repeat(24)}`, projectId, headSha: HEAD, state, records, executedTests});

export function registerDskT0006Cases() {
  describe("DSK-T0006 test-strategy-core (pure grouping, no inferred results)", () => {
    it("groups runs per project newest-first, counts every test state, and orders projects by their newest run", async () => {
      const core = await load("test-strategy-core.js");
      const surf = {kind: "TEST_SURFACE", atHead: true, files: {added: ["a.test.ts"], modified: [], deleted: [], renamed: [], total: 1, truncated: false}, testRun: null};
      const g = core.groupTestsByProject({state: "VERIFIED", truncated: false, runs: [
        rr("1", PRJ("1"), "NOT_EXECUTED"), rr("2", PRJ("2"), "EXECUTED", [surf], 4), rr("3", PRJ("1"), "FAILED"), rr("4", "bogus", "EXECUTED")]});
      expect(g.state).toBe("VERIFIED");
      expect(g.projects.map((p: any) => p.projectId)).toEqual([PRJ("1"), PRJ("2")]);        // project 1 holds the newest valid run (index 2)
      expect(g.projects[0].runs.map((r: any) => r.state)).toEqual(["FAILED", "NOT_EXECUTED"]);
      expect(g.projects[0].counts).toEqual({EXECUTED: 0, FAILED: 1, BLOCKED: 0, UNVERIFIED: 0, NOT_EXECUTED: 1});
      expect(g.projects[0].surface).toBeNull();                                             // no TEST_SURFACE record -> no test files are invented
      expect(g.projects[1].surface.files.added).toEqual(["a.test.ts"]);
      expect(g.unassigned).toBe(1);                                                          // invalid project id is never folded into a group
      expect(core.groupTestsByProject({state: "OFFLINE", runs: []})).toMatchObject({state: "OFFLINE", projects: []});
      expect(core.groupTestsByProject(null).state).toBe("ERROR");
    });

    it("productAxisOf reads only the server axis; unknown values and failed reads are never PRODUCT_VERIFIED", async () => {
      const core = await load("test-strategy-core.js");
      expect(core.productAxisOf({state: "VERIFIED", run: {productVerification: "NOT_VERIFIED"}})).toEqual({state: "VERIFIED", axis: "NOT_VERIFIED"});
      expect(core.productAxisOf({state: "VERIFIED", run: {productVerification: "VERIFIED"}})).toEqual({state: "VERIFIED", axis: null});
      expect(core.productAxisOf({state: "VERIFIED", run: {productVerification: null}}).axis).toBeNull();
      expect(core.productAxisOf({state: "OFFLINE", run: null})).toEqual({state: "OFFLINE", axis: null});
      expect(core.LAB_CATEGORIES.map((l: any) => l.ui)).toEqual(["UI-040", "UI-041", "UI-042", "UI-043", "UI-044", "UI-045"]);
      for (const l of core.LAB_CATEGORIES) expect(["NOT_EXECUTED", "BLOCKED"]).toContain(l.state);
    });

    it("projectStrategy carries the declared testCommand verbatim, or states that none is declared", async () => {
      const core = await load("test-strategy-core.js");
      const raw = {ok: true, data: {projects: [{projectId: PRJ("1"), name: "P1", testCommand: ["npm", "test"]}, {projectId: PRJ("2"), name: "P2"}]}};
      expect(core.projectStrategy(raw, PRJ("1"))).toEqual({state: "VERIFIED", name: "P1", testCommand: ["npm", "test"]});
      expect(core.projectStrategy(raw, PRJ("2")).testCommand).toBeNull();
      expect(core.projectStrategy(raw, PRJ("3")).state).toBe("NOT_FOUND");
      expect(core.projectStrategy({ok: false, state: "OFFLINE"}, PRJ("1")).state).toBe("OFFLINE");
    });

    it("assurance-core maps TEST_SURFACE file lists and a parsed test run only when the counts are consistent", async () => {
      const core = await load("assurance-core.js");
      const run = (ts: any) => ({runId: `run_${"e".repeat(24)}`, missionId: `msn_${"e".repeat(24)}`, projectId: PRJ("e"), status: "RUNNING", step: "VERIFY", remediationCycle: 0, createdAt: "2026-10-16T08:00:00.000Z", updatedAt: "2026-10-16T08:00:00.000Z", baseSha: BASE, headSha: HEAD,
        evidence: [{evidenceId: `evi_${"1".repeat(32)}`, step: "VERIFY", cycle: 0, kind: "TEST_SURFACE", argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, commitSha: HEAD, testSurface: ts}]});
      const ok = core.mapTestReports({ok: true, data: {runs: [run({functionalAcceptance: "UNVERIFIED_ORACLE", executedTests: 3, added: ["t/a.test.ts", 7], modified: ["t/b.test.ts"], deleted: [], renamed: [{from: "x", to: "t/c.test.ts"}], testRun: {format: "vitest", executed: 3, passed: 2, failed: 1, skipped: 4, todo: 0}})]}});
      const rec = ok.runs[0].records[0];
      expect(ok.runs[0].projectId).toBe(PRJ("e"));
      expect(rec.files).toEqual({added: ["t/a.test.ts"], modified: ["t/b.test.ts"], deleted: [], renamed: ["t/c.test.ts"], total: 3, truncated: false});
      expect(rec.testRun).toEqual({format: "vitest", executed: 3, passed: 2, failed: 1, skipped: 4, todo: 0});
      const bad = core.mapTestReports({ok: true, data: {runs: [run({functionalAcceptance: "UNKNOWN", executedTests: 3, testRun: {format: "vitest", executed: 5, passed: 2, failed: 1, skipped: 0, todo: 0}})]}});
      expect(bad.runs[0].records[0].testRun).toBeNull();                                    // executed != passed + failed -> never shown
    });
  });

  describe("DSK-T0006 test strategy panel over the REAL Control API (renderer -> real buildServer)", () => {
    let tmp = "";
    const apps: Array<{close: () => Promise<unknown>}> = [];
    beforeEach(async () => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-ts-")); (await load("views", "assurance.js")).resetAssuranceView(); });
    afterEach(async () => { (await load("views", "assurance.js")).resetAssuranceView(); for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });
    const evBase = (step: string, kind: string) => ({step, cycle: 0, kind, argv: ["x"], startedAt: "2026-10-16T08:00:00.000Z", endedAt: "2026-10-16T08:00:01.000Z", exitCode: 0, logPath: null, logSha256: null}) as any;
    /** Gerçek store: proje (opsiyonel testCommand), mission, koşu, lease, IMPLEMENT + (opsiyonel) sandbox tanıklı VERIFY/REGRESSION + TEST_SURFACE kanıtı. */
    function seed(o: {name: string; testCommand?: string[]; tests: boolean; files?: string[]}) {
      const store = new WorkOsStore(path.join(tmp, "data")), tenantId = "tA", scope = {tenantId};
      const p = store.createProject({tenantId, orgId: "org1", name: o.name, environmentId: "env-dev", createdBy: RECORDER, ...(o.testCommand ? {testCommand: o.testCommand} : {})});
      const m = store.createMission({tenantId, projectId: p.projectId, title: "T", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
      for (const to of ["PREFLIGHT", "AUTHORIZED"] as const) store.transitionMission(scope, m.missionId, to, "go", RECORDER);
      const r = store.createRun({tenantId, missionId: m.missionId, executor: {implementer: "IMPL", reviewer: "REV"}, createdBy: RECORDER});
      const leaseId = store.acquireRunLease(r.runId, 600_000, "ENGINE").leaseId as string;
      store.transitionRun(r.runId, leaseId, "RUNNING", "t", "ENGINE", {patch: {baseSha: BASE, headSha: HEAD}});
      store.addRunEvidence(r.runId, leaseId, {...evBase("IMPLEMENT", "IMPLEMENT"), baseSha: BASE, commitSha: HEAD}, "ENGINE");
      if (o.tests) {
        for (const k of ["VERIFY_TESTS", "REGRESSION_TESTS"]) store.addRunEvidence(r.runId, leaseId, {...evBase("VERIFY", k), commitSha: HEAD, sandboxProviderId: "docker-local"}, "ENGINE");
        store.addRunEvidence(r.runId, leaseId, {...evBase("VERIFY", "TEST_SURFACE"), baseSha: BASE, commitSha: HEAD, testSurface: {schemaVersion: 1, baseSha: BASE, headSha: HEAD, testGlobs: [], harnessGlobs: [], added: o.files ?? [], modified: [], deleted: [], renamed: [], weakened: [], trivialAdded: [], harness: [],
          executedTests: 7, testRun: {format: "vitest", executed: 7, passed: 7, failed: 0, skipped: 1, todo: 0}, oracle: "NONE", functionalAcceptance: "UNVERIFIED_ORACLE", reason: "r", truncated: false}} as any, "ENGINE");
      }
      return {projectId: p.projectId, runId: r.runId};
    }
    function mkApp() {
      fs.mkdirSync(path.join(tmp, "runtime"), {recursive: true}); fs.mkdirSync(path.join(tmp, "repo"), {recursive: true});
      const app = buildServer({controlToken: TOKEN, runtime: path.join(tmp, "runtime"), repoRoot: path.join(tmp, "repo"), dataDir: path.join(tmp, "data"), tenantId: "tA", port: 3210, logger: false});
      apps.push(app); return app;
    }
    /** main.mjs uasco:api-get ile aynı sözleşme: izin listesi, belirtece bağlı kimlik doğrulaması, 2xx dışı -> hata; POST asla. */
    async function render(app: ReturnType<typeof buildServer>, token = TOKEN, select?: string) {
      const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), view = await load("views", "assurance.js");
      const calls: string[] = [];
      const verify = async () => {
        const challenge = crypto.randomBytes(32).toString("hex"), expected = controlChallengeProof(token, challenge);
        const r = await app.inject({method: "GET", url: `/health?challenge=${challenge}`, headers: {host: "127.0.0.1:3210"}});
        const h = r.json();
        if (r.statusCode !== 200 || h.status !== "HEALTHY" || !expected || h.controlProof !== expected) throw new Error("CONTROL_API_IDENTITY_UNVERIFIED");
      };
      const bridge = {apiGet: async (p: string) => {
        calls.push(p);
        if (!desktopAllows(p)) throw new Error("INVALID_API_PATH");
        await verify();
        const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": token, host: "127.0.0.1:3210"}});
        if (r.statusCode < 200 || r.statusCode > 299) throw new Error(`${p}: HTTP ${r.statusCode}`);
        return r.json();
      }, apiPost: async (p: string) => { throw new Error(`POST must never be called (${p})`); }};
      const doc = new D(), store = st.createStore(null), api = apiMod.createApi({bridge, store});
      const t = (k: string, v?: any) => i18n.translate("en", k, v);
      const ctx: any = {doc, store, api, i18n: {lang: "en", t}, t, navigate: () => {}, principal: "FOUNDER_LOCAL", rerender: () => {}, settleFocus: () => {}};
      let root = (await view.render(ctx)) as N;
      if (select) { byId(root, `ts-${select}`)!.fire("click"); calls.length = 0; root = (await view.render(ctx)) as N; }
      return {root, calls};
    }

    it("happy path: a project with real sandbox-attested test evidence shows its test command, test files and EXECUTED, and the product axis exactly as the server derives it (separate field)", async () => {
      const a = seed({name: "Shop", testCommand: ["npm", "test"], tests: true, files: ["tests/cart.test.ts", "<img src=x onerror=alert(1)>.test.ts"]});
      const b = seed({name: "Blog", tests: false});
      const app = mkApp();
      const first = await render(app);
      expect(byData(first.root, "strategyProject").map(n => n.dataset.strategyProject).sort()).toEqual([a.projectId, b.projectId].sort());
      expect(byData(first.root, "strategyProject", a.projectId)[0].dataset.testState).toBe("EXECUTED");
      expect(byData(first.root, "strategyProject", b.projectId)[0].dataset.testState).toBe("NOT_EXECUTED");
      expect(first.calls).not.toContain("/v1/projects");                                    // the list adds no read of its own
      const {root: r, calls} = await render(app, TOKEN, a.projectId);
      expect([...new Set(calls)]).toEqual(expect.arrayContaining(["/v1/projects", `/v1/work-runs/${a.runId}`]));
      for (const p of calls) expect(desktopAllows(p), p).toBe(true);
      const d = byId(r, "as-teststrat-detail")!;
      expect(byData(d, "testCommand")[0].textContent).toBe("npm test");
      expect(byData(d, "testFiles", "added")[0].textContent).toContain("tests/cart.test.ts");
      expect(all(d).some(n => n.tagName === "IMG")).toBe(false);                            // a path is text, never markup
      expect(byData(d, "testState")[0].dataset.testState).toBe("EXECUTED");
      expect(byData(d, "testRun", "1")[0].textContent).toContain("7 passed");
      // the product axis is the server's own productVerification of GET /v1/work-runs/:id, never derived from the test state in the renderer
      const srv = (await app.inject({method: "GET", url: `/v1/work-runs/${a.runId}`, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json();
      expect(typeof srv.delivery.productVerification.state).toBe("string");
      expect(byData(d, "productAxis")[0].dataset.productAxis).toBe(srv.delivery.productVerification.state);
      expect(byData(d, "axisSeparation", "1")).toHaveLength(1);
      expect(byData(d, "lab").map(n => n.dataset.labState)).toEqual(["NOT_EXECUTED", "NOT_EXECUTED", "BLOCKED", "NOT_EXECUTED", "NOT_EXECUTED", "NOT_EXECUTED"]);
    });

    it("no test evidence: the project is NOT_EXECUTED with no invented files or counts, and no declared command is stated as such", async () => {
      const b = seed({name: "Blog", tests: false});
      const {root: r} = await render(mkApp(), TOKEN, b.projectId);
      const d = byId(r, "as-teststrat-detail")!;
      expect(byData(d, "testNotExecuted", "1")).toHaveLength(1);
      expect(byData(d, "testCases", "none")).toHaveLength(1);
      expect(byData(d, "testCommand", "0")).toHaveLength(1);
      expect(byData(d, "testRun", "0")).toHaveLength(1);
      expect(byData(d, "productAxis")[0].dataset.productAxis).toBe("NOT_VERIFIED");
    });

    it("empty factory: zero runs is stated as no history, never as a pass", async () => {
      const {root: r} = await render(mkApp());
      expect(panelText(r, "as-teststrat")).toContain("No work runs recorded yet");
      expect(byData(r, "strategyProject")).toHaveLength(0);
    });

    it("error: a wrong bridge token makes the panel an honest error with no project rows", async () => {
      seed({name: "Shop", tests: true});
      const {root: r} = await render(mkApp(), WRONG);
      expect(stateNotes(r, "as-teststrat")).toEqual(["error"]);
      expect(byData(r, "strategyProject")).toHaveLength(0);
    });

    it("locale parity: every assurance.teststrat.* key exists in EN and TR and none is empty", async () => {
      const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
      const ks = (o: any) => Object.keys(o).filter(k => k.startsWith("assurance.teststrat.")).sort();
      expect(ks(en).length).toBeGreaterThan(30);
      expect(ks(tr)).toEqual(ks(en));
      for (const k of ks(en)) { expect(en[k].length, k).toBeGreaterThan(0); expect(tr[k].length, k).toBeGreaterThan(0); }
    });
  });
}
