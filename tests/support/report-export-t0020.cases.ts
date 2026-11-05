// //TR: Bu vaka dosyası (kayıtlı tests/v7-ux-executive.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0020 rapor dışa aktarmayı sınar: Kurucu Yönetim Özeti
// görünümü GERÇEK buildServer'a karşı (main.mjs GET izin listesi aynası) çizilir, panel aynı okuma sonucundan JSON/Markdown/CSV üretir; yeni okuma/yazma yoktur, okunamayan kaynak 0 değil
// dürüst durumuyla aktarılır, CSV formül enjeksiyonu nötrlenir, Markdown hücreleri kaçışlanır, Blob indirme yoksa "kullanılamıyor" denir.
import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {desktopGetPathAllowed} from "../../automation/lib/control-boundary.mjs";
import {WorkOsStore} from "../../core/workos/store.js";
import {buildServer} from "../../apps/control-api/src/server.js";

const REPO = path.resolve(__dirname, "..", "..");
const REND = path.join(REPO, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(REND, ...p)).href);
const TOKEN = "t".repeat(32), RECORDER = "implementer@local.invalid";
const MAIN_SRC = fs.readFileSync(path.join(REPO, "apps", "desktop", "main.mjs"), "utf8");
const allowBlock = (() => { const a = MAIN_SRC.indexOf("// B4-ALLOWLIST-BEGIN"), b = MAIN_SRC.indexOf("// B4-ALLOWLIST-END"); if (a < 0 || b < 0) throw new Error("main.mjs B4-ALLOWLIST block not found"); return MAIN_SRC.slice(a, b); })();
const extraAllowed = new Function(`${allowBlock}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;
const allows = (p: string) => desktopGetPathAllowed(p) || extraAllowed(p);

class N {
  tagName: string; children: N[] = []; parent: N | null = null; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; className = ""; _text = ""; hidden = false; ls = new Map<string, Array<(e: unknown) => unknown>>(); clicked = 0;
  constructor(public doc: D, tag: string) { this.tagName = tag.toUpperCase(); }
  get id() { return this.attrs.get("id") ?? ""; }
  get textContent(): string { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this._text = String(v); }
  set innerHTML(_v: string) { throw new Error("innerHTML forbidden"); }
  append(...n: Array<N | string | null | undefined>) { for (const c of n) { if (c === null || c === undefined) continue; const node = typeof c === "string" ? this.doc.createTextNode(c) : c; node.parent = this; this.children.push(node); } }
  appendChild(n: N) { this.append(n); return n; }
  prepend(...n: Array<N | string>) { this.append(...n); }
  replaceChildren(...n: Array<N | string>) { this.children = []; this._text = ""; this.append(...n); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  addEventListener(ev: string, fn: (e: unknown) => unknown) { this.ls.set(ev, [...(this.ls.get(ev) ?? []), fn]); }
  fire(ev: string) { for (const fn of this.ls.get(ev) ?? []) fn({preventDefault() {}, currentTarget: this}); }
  click() { this.clicked++; this.doc.clicks.push({href: this.getAttribute("href"), download: this.getAttribute("download"), attached: this.parent !== null}); }
  focus() { /* test double */ }
  get classList() { const s = this; return {add: (c: string) => { s.className = `${s.className} ${c}`.trim(); }, remove: () => undefined, toggle: () => undefined, contains: (c: string) => s.className.split(/\s+/).includes(c)}; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  all(): N[] { return [this, ...this.children.flatMap(c => c.all())]; }
}
class D {
  body: N; clicks: Array<{href: string | null; download: string | null; attached: boolean}> = []; defaultView: any = undefined;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById() { return null; }
}
const byId = (n: N, id: string) => n.all().find(x => x.id === id);

type App = ReturnType<typeof buildServer>;
let tmp = "";
const apps: App[] = [];
function mkApp(): App {
  const runtime = path.join(tmp, "runtime"), dataDir = path.join(tmp, "data");
  fs.mkdirSync(runtime, {recursive: true});
  const store = new WorkOsStore(dataDir);
  const p = store.createProject({tenantId: "tA", orgId: "org1", name: "T0020 project", environmentId: "env-dev", createdBy: RECORDER});
  store.createMission({tenantId: "tA", projectId: p.projectId, title: "=HYPERLINK(\"http://x\")|pipe", objective: "obj", acceptanceCriteria: ["ac"], riskLevel: "R1", createdBy: RECORDER});
  const app = buildServer({controlToken: TOKEN, runtime, repoRoot: REPO, dataDir, tenantId: "tA", port: 3210, logger: false});
  apps.push(app); return app;
}
async function renderExecutive(app: App, opts: {downPaths?: string[]; lang?: string} = {}) {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js"), view = await load("views", "executive.js"), panelMod = await load("views", "report-export-panel.js");
  const gets: string[] = [], posts: string[] = [];
  const bridge = {
    apiGet: async (p: string) => {
      if (!allows(p)) throw new Error("INVALID_API_PATH");
      gets.push(p);
      if (opts.downPaths?.some(d => p.startsWith(d))) throw new Error("CONTROL_API_UNREACHABLE");
      const r = await app.inject({method: "GET", url: p, headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}});
      if (r.statusCode !== 200) throw new Error(`${p}: HTTP ${r.statusCode}`);
      return r.json();
    },
    apiPost: async (p: string) => { posts.push(p); throw new Error("no POST expected"); },
  };
  const lang = opts.lang ?? "en", t = (k: string, v?: unknown) => i18n.translate(lang, k, v);
  const saved: Array<{fileName: string; mime: string; text: string}> = [];
  const ctx: any = {doc: new D(), api: apiMod.createApi({bridge, store: st.createStore(null)}), i18n: {lang, t}, t, navigate: () => undefined, now: () => Date.parse("2026-11-05T10:20:30.000Z"),
    saveFile: (f: {fileName: string; mime: string; text: string}) => { saved.push(f); return {ok: true}; }};
  const root: N = await view.render(ctx);
  const getsAtRender = gets.length;
  const click = (fmt: string) => { byId(root, `executive-export-${fmt}`)!.fire("click"); return saved.at(-1)!; };
  return {root, ctx, gets, posts, saved, click, t, panelMod, getsAtRender};
}

export function registerReportExportT0020Cases(): void {
  describe("UASCO-T0020 executive report export -> real buildServer (no new reads, no writes, honest states)", () => {
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-t0020-")); });
    afterEach(async () => { for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* Windows */ } });

    it("the executive view mounts the export panel with three keyboard-reachable buttons and a live status", async () => {
      const app = mkApp(), e = await renderExecutive(app);
      const p = byId(e.root, "executive-export")!;
      expect(p).toBeTruthy();
      for (const f of ["json", "md", "csv"]) { const b = byId(p, `executive-export-${f}`)!; expect(b.tagName).toBe("BUTTON"); expect(b.getAttribute("type")).toBe("button"); expect(b.textContent).toBe(e.t(`report.btn.${f}`)); }
      expect(byId(p, "executive-export-status")!.getAttribute("role")).toBe("status");
    });

    it("JSON export equals the server's real figures; exporting performs no GET and no POST", async () => {
      const app = mkApp(), e = await renderExecutive(app);
      const f = e.click("json");
      expect(e.gets.length).toBe(e.getsAtRender); // dışa aktarma yeni okuma yapmaz
      expect(e.posts).toEqual([]);
      expect(f.mime).toBe("application/json");
      expect(f.fileName).toBe("uasco-executive-report-20261105T102030.json");
      const rep = JSON.parse(f.text);
      expect(rep.schema).toBe("uasco.executive-report/v1");
      expect(rep.generatedAt).toBe("2026-11-05T10:20:30.000Z");
      const cockpit = (await app.inject({method: "GET", url: "/v1/cockpit", headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json();
      const missions = (await app.inject({method: "GET", url: "/v1/missions", headers: {"x-uasco-control-token": TOKEN, host: "127.0.0.1:3210"}})).json();
      expect(rep.sources).toEqual({cockpit: "VERIFIED", missions: "VERIFIED", workRuns: "VERIFIED", attention: "VERIFIED"});
      expect(rep.kpis.projects).toMatchObject({state: "VERIFIED", value: 1, source: "GET /v1/cockpit"});
      expect(rep.kpis.inProgress).toMatchObject({state: "VERIFIED", value: 0});
      expect(missions.missions.length).toBe(1);
      expect(cockpit).toBeTruthy();
      expect(rep.ledger).toEqual({state: "VERIFIED", total: 0, included: 0, truncated: false, rows: []});
      const status = byId(e.root, "executive-export-status")!;
      expect(status.dataset.exportResult).toBe("HANDED_OFF");
      expect(status.textContent).toBe(e.t("report.handedOff", {file: f.fileName, rows: "0"}));
    });

    it("an unreadable source is exported with its honest state and null value, never 0 (JSON, Markdown, CSV)", async () => {
      const app = mkApp(), e = await renderExecutive(app, {downPaths: ["/v1/work-runs"]});
      const rep = JSON.parse(e.click("json").text);
      expect(rep.sources.workRuns).not.toBe("VERIFIED");
      expect(rep.kpis.runs.value).toBeNull();
      expect(rep.kpis.deliveries.value).toBeNull();
      expect(rep.kpis.runs.state).toBe(rep.sources.workRuns);
      expect(rep.ledger).toMatchObject({state: rep.sources.workRuns, total: null, rows: []});
      const md = e.click("md").text;
      expect(md).toContain(`${e.t("report.md.ledgerState")}: ${rep.sources.workRuns}`);
      expect(md).toMatch(/\| runs \| \w+ \| — \|/);
      const csv = e.click("csv").text;
      expect(csv).toBe("runId,missionId,missionTitle,projectId,status,step,cycle,createdAt,updatedAt,headSha,reviewVerdict,deliveryState,reason\r\n");
    });

    it("Markdown headings follow the UI language (tr) while data cells stay raw", async () => {
      const app = mkApp(), e = await renderExecutive(app, {lang: "tr"});
      const md = e.click("md").text;
      expect(md.startsWith(`# ${e.t("report.md.title")}\n`)).toBe(true);
      expect(md).toContain(`## ${e.t("report.md.kpis")}`);
      expect(md).toContain("| projects | VERIFIED | 1 | GET /v1/cockpit |");
      expect(byId(e.root, "executive-export-status")!.textContent).toContain("kayıt penceresine verildi");
    });
  });

  describe("UASCO-T0020 report core: escaping, injection safety, truncation, fail-closed", () => {
    const row = (over: Record<string, unknown> = {}) => ({runId: "run_" + "a".repeat(24), missionId: "msn_" + "b".repeat(24), missionTitle: "Plain", projectId: "prj_" + "c".repeat(24), status: "RUNNING", step: "IMPLEMENT", cycle: 0,
      createdAt: "2026-11-05T10:00:00.000Z", updatedAt: "2026-11-05T10:05:00.000Z", headSha: null, reviewVerdict: null, deliveryState: "NOT_PREPARED", reason: null, ...over});
    const rep = (rows: unknown[], extra: Record<string, unknown> = {}) => ({schema: "uasco.executive-report/v1", generatedAt: "2026-11-05T10:20:30.000Z", sources: {cockpit: "VERIFIED"}, kpis: {projects: {state: "VERIFIED", value: 1, source: "GET /v1/cockpit"}},
      ledger: {state: "VERIFIED", total: rows.length, included: rows.length, truncated: false, rows, ...extra}});

    it("csvCell neutralises formula injection (=,+,-,@,TAB,CR) and quotes comma/quote/newline per RFC 4180", async () => {
      const {csvCell} = await load("report-export.js");
      expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
      for (const c of ["+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(c).replace(/^"/, "").startsWith("'"), JSON.stringify(c)).toBe(true);
      expect(csvCell("a,b")).toBe("\"a,b\"");
      expect(csvCell("line1\nline2")).toBe("\"line1\nline2\"");
      expect(csvCell("plain")).toBe("plain");
      expect(csvCell(null)).toBe("");
      expect(csvCell(0)).toBe("0");
    });

    it("reportToCsv: header + one CRLF line per row, every hostile cell neutralised", async () => {
      const {reportToCsv, LEDGER_COLUMNS} = await load("report-export.js");
      const csv = reportToCsv(rep([row({missionTitle: "=cmd|' /C calc'!A0", reason: "multi\nline, \"quoted\""})]));
      const lines = csv.split("\r\n");
      expect(lines[0]).toBe(LEDGER_COLUMNS.join(","));
      expect(lines.at(-1)).toBe("");
      expect(csv).toContain("'=cmd|' /C calc'!A0");
      expect(csv).not.toMatch(/(^|,)=cmd/m);
      expect(csv).toContain("\"multi\nline, \"\"quoted\"\"\"");
    });

    it("mdCell escapes pipes and newlines so a cell cannot break the table; null shows —", async () => {
      const {mdCell, reportToMarkdown} = await load("report-export.js");
      expect(mdCell("a|b")).toBe("a\\|b");
      expect(mdCell("a\nb\r\nc")).toBe("a b c");
      expect(mdCell("back\\slash")).toBe("back\\\\slash");
      expect(mdCell(null)).toBe("—");
      const md = reportToMarkdown(rep([row({missionTitle: "x|y\nz"})]));
      const tableRows = md.split("\n").filter((l: string) => l.startsWith("| run_"));
      expect(tableRows.length).toBe(1);
      expect(tableRows[0].split(/(?<!\\)\|/).length - 2).toBe(13); // 13 sütun, kaçışlı | sütun açmaz
      expect(tableRows[0]).toContain("x\\|y z");
    });

    it("truncation is stated in Markdown; empty ledger says so; unknown format is refused (null)", async () => {
      const {reportToMarkdown, renderReport} = await load("report-export.js");
      const t = (k: string, v?: any) => (v ? `${k}:${v.shown}/${v.total}` : k);
      expect(reportToMarkdown(rep([row()], {total: 500, truncated: true}), t)).toContain("report.md.truncated:1/500");
      expect(reportToMarkdown(rep([]), t)).toContain("report.md.ledgerEmpty");
      expect(renderReport(rep([]), "xlsx", t)).toBeNull();
      expect(renderReport(rep([]), "csv", t)).toMatchObject({fileName: "uasco-executive-report-20261105T102030.csv", mime: "text/csv"});
      expect(renderReport({...rep([]), generatedAt: "../../etc/passwd"}, "json", t)!.fileName).toMatch(/^uasco-executive-report-[0-9TZ]*\.json$|^uasco-executive-report-unknown\.json$/);
    });

    it("buildExecutiveReport caps the ledger at MAX_LEDGER_ROWS and marks truncation; non-VERIFIED missions give null titles", async () => {
      const {buildExecutiveReport} = await load("report-export.js"), core = await load("executive-core.js");
      const items = Array.from({length: core.MAX_LEDGER_ROWS + 5}, (_, i) => ({runId: `run_${String(i).padStart(24, "0")}`, missionId: "msn_" + "b".repeat(24), projectId: "prj_" + "c".repeat(24), status: "RUNNING", step: "IMPLEMENT", cycle: 0,
        createdAt: "2026-11-05T10:00:00.000Z", updatedAt: "2026-11-05T10:05:00.000Z", headSha: null, review: null, delivery: {state: "NOT_PREPARED"}, reason: null}));
      const r = buildExecutiveReport({cockpit: {state: "ERROR"}, missions: {state: "OFFLINE"}, workRuns: {state: "VERIFIED", runs: {items, total: items.length}}, attention: {state: "ERROR"}}, {generatedAt: new Date(0)});
      expect(r.ledger).toMatchObject({state: "VERIFIED", total: core.MAX_LEDGER_ROWS + 5, included: core.MAX_LEDGER_ROWS, truncated: true});
      expect(r.ledger.rows.every((x: any) => x.missionTitle === null)).toBe(true);
      expect(r.kpis.projects).toMatchObject({value: null});
      expect(r.kpis.inProgress.state).toBe("OFFLINE");
    });

    it("blobDownload: Blob + object URL + attached <a download> click; URL revoked later; no Blob/URL -> EXPORT_UNAVAILABLE and no click", async () => {
      const {blobDownload} = await load("views", "report-export-panel.js");
      const doc = new D(), created: Array<{parts: unknown[]; type: string}> = [], revoked: string[] = [], timers: Array<() => void> = [];
      doc.defaultView = {Blob: class { constructor(public parts: unknown[], o: {type: string}) { created.push({parts, type: o.type}); } }, URL: {createObjectURL: () => "blob:file:///x", revokeObjectURL: (u: string) => revoked.push(u)}, setTimeout: (fn: () => void) => timers.push(fn)};
      expect(blobDownload(doc, {fileName: "r.csv", mime: "text/csv", text: "a,b\r\n"})).toEqual({ok: true});
      expect(created).toEqual([{parts: ["a,b\r\n"], type: "text/csv;charset=utf-8"}]);
      expect(doc.clicks).toEqual([{href: "blob:file:///x", download: "r.csv", attached: true}]);
      expect(doc.body.children.length).toBe(0); // bağlantı tıklamadan sonra kaldırılır
      expect(revoked).toEqual([]); timers.forEach(f => f()); expect(revoked).toEqual(["blob:file:///x"]);
      const bare = new D(); bare.defaultView = {URL: {}};
      expect(blobDownload(bare, {fileName: "r.csv", mime: "text/csv", text: "x"})).toEqual({ok: false, code: "EXPORT_UNAVAILABLE"});
      expect(bare.clicks).toEqual([]);
    });

    it("panel: a failing saver shows the honest failure code, not 'handed off'", async () => {
      const panelMod = await load("views", "report-export-panel.js"), i18n = await load("i18n.js");
      const t = (k: string, v?: unknown) => i18n.translate("en", k, v);
      const ctx: any = {doc: new D(), t, now: () => 0, saveFile: () => ({ok: false, code: "EXPORT_UNAVAILABLE"})};
      const p: N = panelMod.exportPanel(ctx, {cockpit: {state: "ERROR"}, missions: {state: "ERROR"}, workRuns: {state: "ERROR"}, attention: {state: "ERROR"}});
      byId(p, "executive-export-csv")!.fire("click");
      const s = byId(p, "executive-export-status")!;
      expect(s.dataset.exportResult).toBe("EXPORT_UNAVAILABLE");
      expect(s.textContent).toBe(t("report.failed", {code: "EXPORT_UNAVAILABLE"}));
      expect(panelMod.exportUi.last).toMatchObject({format: "csv", ok: false, code: "EXPORT_UNAVAILABLE"});
    });

    it("report.* keys are in en/tr parity with identical placeholders", async () => {
      const en = (await load("locales", "en.js")).default, tr = (await load("locales", "tr.js")).default;
      const ks = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith("report.")).sort();
      expect(ks(en)).toEqual(ks(tr));
      expect(ks(en).length).toBeGreaterThan(15);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      for (const k of ks(en)) expect(ph(tr[k]), k).toEqual(ph(en[k]));
    });
  });
}
