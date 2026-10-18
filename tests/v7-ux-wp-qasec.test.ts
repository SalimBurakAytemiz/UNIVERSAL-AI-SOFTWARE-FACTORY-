// //TR: Bu test UX WP-QA-SEC Güvence (QA + Güvenlik) görünümünü (apps/desktop/renderer/views/assurance.js) ve saf çekirdeğini (assurance-core.js) doğrular:
// (1) Genel bakış kanıt bütünlüğü GET /v1/cockpit evidence bloğundan gerçek sayılarla, güvenlik duruşu GET /v1/work-runs SECURITY_REPORT kanıtından toplanır; (2) güvenlik statik taraması her koşu için
// secret/bağımlılık/araç durumunu DÜRÜST taşır (gitleaks/trivy/semgrep INSTALLED/NOT_INSTALLED/ERROR; kanıt yoksa NOT_EXECUTED; başka commit'e bağlıysa STALE; asla sahte PASSED/temiz); (3) kanıt yüzeyi (GET /v1/evidence)
// değişmeden çalışır; (4) dinamik QA (test çalıştırma, görsel/API/web/mobil/masaüstü yürütme, cihaz farmı, canlı önizleme) Founder kapısında (FD-REL-1 + cihaz farmı) BLOCKED/NOT_EXECUTED gösterilir, "koş" düğmesi yoktur ve hiçbir yürütme tetiklenmez.
// Görünüm yalnız izinli salt-okunur GET'leri (/v1/cockpit, /v1/work-runs, /v1/evidence[/:id]) çağırır; qa.* sözlüğü EN/TR'de birebirdir; veri HTML olarak yorumlanmaz (yalnız h()/textContent).
import {describe, it, expect, beforeEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const root = path.resolve(__dirname, "..");
const rend = path.join(root, "apps", "desktop", "renderer");
const load = async (...p: string[]): Promise<any> => import(pathToFileURL(path.join(rend, ...p)).href);
const readMain = () => fs.readFileSync(path.join(root, "apps", "desktop", "main.mjs"), "utf8");
const block = (tag: string) => { const s = readMain(); const a = s.indexOf(`// ${tag}-BEGIN`), b = s.indexOf(`// ${tag}-END`); if (a < 0 || b < 0) throw new Error(`no ${tag}`); return s.slice(a, b); };
const loadGet = () => new Function(`${block("B4-ALLOWLIST")}\nreturn desktopExtraGetPathAllowed;`)() as (v: unknown) => boolean;

// Minimal fake DOM (createElement/textContent/replaceChildren/events only).
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
  focus() { this.doc.focused = this; }
  fire(ev: string, e: any = {}) { const evt = {preventDefault() {}, target: this, ...e}; for (const fn of this.ls.get(ev) ?? []) fn(evt); }
}
class D {
  body: N; focused: N | null = null;
  constructor() { this.body = new N(this, "body"); }
  createElement(t: string) { return new N(this, t); }
  createElementNS(_ns: string, t: string) { return new N(this, t); }
  createTextNode(s: string) { const n = new N(this, "#text"); n._text = s; return n; }
  getElementById(id: string) { return all(this.body).find(n => n.id === id) ?? null; }
}
const all = (n: N): N[] => n.children.flatMap(c => [c, ...all(c)]);
const byId = (r: N, id: string) => all(r).find(n => n.id === id) ?? null;
const byTag = (r: N, t: string) => all(r).filter(n => n.tagName === t.toUpperCase());
const byData = (r: N, k: string, v?: string) => all(r).filter(n => k in n.dataset && (v === undefined || n.dataset[k] === v));
const text = (n: N | null) => (n ? n.textContent : "");

// ---- Fixtures: real-shaped GET responses ----
const HEAD1 = "a".repeat(40), HEAD2 = "b".repeat(40), HEAD3 = "c".repeat(40), OTHER = "d".repeat(40);
const runId = (c: string) => `run_${c.repeat(24)}`;
const tool = (t: string, status: string, version: string | null = null) => ({tool: t, status, path: null, version, sha256: null});
const sec = (o: any) => ({schemaVersion: 1, status: o.status, blockReason: o.blockReason ?? null, baseSha: "0".repeat(40), headSha: o.headSha, cycle: o.cycle ?? 1,
  secrets: {builtin: {status: o.builtin ?? "CLEAN", hits: o.builtinHits ?? 0}, gitleaks: {status: o.gitleaks ?? "CLEAN", findings: o.gitleaksFindings ?? 0, items: [], rawReportSha256: null}},
  sca: {status: o.sca ?? "CLEAN", counts: o.counts ?? {}, blocking: o.blocking ?? 0, findings: [], truncated: false, rawReportSha256: null},
  sast: {status: "NOT_AVAILABLE", reason: o.semgrep === "INSTALLED" ? "TOOL_INSTALLED_NOT_INTEGRATED" : "TOOL_NOT_INSTALLED", tool: "semgrep"},
  sbom: {status: "NOT_AVAILABLE", reason: "NOT_IMPLEMENTED"},
  gaps: o.gaps ?? ["SAST:TOOL_NOT_INSTALLED", "SBOM:NOT_IMPLEMENTED"], tools: o.tools ?? [], founderNote: o.note ?? "note"});
const secEvidence = (s: any, commitSha: string, cycle = 1) => ({evidenceId: `evi_${"1".repeat(32)}`, step: "SECURITY", cycle, kind: "SECURITY_REPORT", argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, commitSha, security: s});
const mkRun = (idc: string, headSha: string | null, evidence: any[], status = "AWAITING_APPROVAL") => ({runId: runId(idc), missionId: `msn_${"0".repeat(24)}`, status, headSha, evidence});

// A: PASSED bound to head; gitleaks+trivy INSTALLED, semgrep NOT_INSTALLED
const RUN_A = mkRun("a", HEAD1, [secEvidence(sec({status: "PASSED", headSha: HEAD1, tools: [tool("gitleaks", "INSTALLED", "8.30.1"), tool("trivy", "INSTALLED", "0.5"), tool("semgrep", "NOT_INSTALLED")]}), HEAD1)]);
// B: PARTIAL (gitleaks NOT_INSTALLED)
const RUN_B = mkRun("b", HEAD2, [secEvidence(sec({status: "PARTIAL", headSha: HEAD2, gitleaks: "NOT_INSTALLED", sca: "PARTIAL", tools: [tool("gitleaks", "NOT_INSTALLED"), tool("trivy", "INSTALLED")]}), HEAD2)]);
// C: BLOCKED secret detected
const RUN_C = mkRun("c", HEAD3, [secEvidence(sec({status: "BLOCKED", blockReason: "SECRET_DETECTED", headSha: HEAD3, gitleaks: "FINDINGS", gitleaksFindings: 2, tools: [tool("gitleaks", "INSTALLED")]}), HEAD3)]);
// D: PASSED but evidence bound to a different commit than headSha -> STALE
const RUN_D = mkRun("d", HEAD1, [secEvidence(sec({status: "PASSED", headSha: OTHER, tools: [tool("gitleaks", "INSTALLED")]}), OTHER)]);
// E: no SECURITY_REPORT evidence -> NOT_EXECUTED
const RUN_E = mkRun("e", HEAD2, [{evidenceId: `evi_${"2".repeat(32)}`, step: "IMPLEMENT", cycle: 1, kind: "IMPLEMENT", argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null}]);
const WORK_RUNS = {workRuns: [RUN_A, RUN_B, RUN_C, RUN_D, RUN_E]};

const COCKPIT = {generatedAt: "2026-10-16T00:00:00.000Z",
  evidence: {state: "VERIFIED", total: 10, verified: 7, mismatch: 1, missing: 2, unverifiable: 0},
  workforce: {state: "VERIFIED", registeredRoles: 599, canonicalRegisteredRoles: 599, targetRoles: 599, activeWorkerRuns: 0}};
const EVI_ID = `evi_${"a".repeat(32)}`;
const EVIDENCE = {evidence: [{evidenceId: EVI_ID, kind: "WORK_RUN_STEP", verification: "VERIFIED", sourcePath: "work-os/x", sha256: "f".repeat(64), createdAt: "2026-10-16T00:00:00.000Z", missionId: `msn_${"0".repeat(24)}`}], nextCursor: null};

// UI-049: real-shaped GET /v1/reviews fixtures (CLEAN independent @head, BLOCKED, CLEAN but NOT independent).
const PRJ = `prj_${"0".repeat(24)}`, MSN = `msn_${"0".repeat(24)}`;
const rid = (c: string) => `evd_${c.repeat(24)}`;
const rrec = (c: string, runC: string, verdict: string, independent: boolean | null, currentHead: boolean) => ({reviewId: rid(c), runId: runId(runC), missionId: MSN, projectId: PRJ, cycle: 1, step: "REVIEW",
  reviewer: {identity: independent === null ? null : "codex"}, implementer: {identity: "claude"}, independent, reviewedCommit: HEAD1, reviewedRange: {baseSha: "0".repeat(40), headSha: HEAD1}, currentHead,
  verdict, startedAt: "2026-10-16T00:00:00.000Z", timestamp: "2026-10-16T00:0" + c.charCodeAt(0) % 10 + ":00.000Z", evidence: {findingsCount: verdict === "BLOCKED" ? 2 : 0}});
const rrun = (runC: string, reviewState: string, latest: string | null) => ({runId: runId(runC), missionId: MSN, projectId: PRJ, status: "AWAITING_APPROVAL", step: "REVIEW", headSha: latest ? HEAD1 : null, reviewState, latestReviewId: latest, reviewCount: latest ? 1 : 0});
const REVIEWS = {source: "WORK_OS_JOURNAL_RUN_EVIDENCE", notice: "n",
  summary: {runs: 3, reviews: 3, runsByReviewState: {CLEAN: 1, BLOCKED: 1, INDEPENDENCE_UNVERIFIED: 1}, reviewsByVerdict: {CLEAN: 2, BLOCKED: 1}, truncated: false},
  reviews: [rrec("a", "a", "CLEAN", true, true), rrec("b", "b", "BLOCKED", true, true), rrec("c", "c", "CLEAN", false, true)],
  runs: [rrun("a", "CLEAN", rid("a")), rrun("b", "BLOCKED", rid("b")), rrun("c", "INDEPENDENCE_UNVERIFIED", rid("c"))]};
const REVIEWS_EMPTY = {source: "WORK_OS_JOURNAL_RUN_EVIDENCE", notice: "n", summary: {runs: 0, reviews: 0, runsByReviewState: {}, reviewsByVerdict: {}, truncated: false}, reviews: [], runs: []};

// UI-050: evidence list with mission+run, mission only, run only, and neither (real list fields only).
const MSN2 = `msn_${"1".repeat(24)}`;
const lev = (c: string, extra: Record<string, unknown>) => ({evidenceId: `evi_${c.repeat(32)}`, kind: "WORK_RUN_STEP", verification: "VERIFIED", sourcePath: "work-os/x", sha256: "f".repeat(64), createdAt: "2026-10-16T00:00:00.000Z", ...extra});
const LINEAGE_EVIDENCE = {evidence: [
  lev("1", {missionId: MSN, runId: runId("a")}), lev("2", {missionId: MSN, runId: runId("a")}), lev("3", {missionId: MSN, runId: runId("b")}),
  lev("4", {missionId: MSN2}), lev("5", {runId: runId("a")}), lev("6", {})], nextCursor: null};

// UI-051: work runs carrying real-shaped test evidence (f=EXECUTED, g=FAILED, h=UNVERIFIED, i=tests bound to another commit, j=surface BLOCKED, k=NOT_EXECUTED record, e=no test evidence).
const tev = (id: string, kind: string, commitSha: string, o: any = {}) => ({evidenceId: `evi_${id.repeat(32)}`, step: "VERIFY", cycle: 1, kind, argv: [], startedAt: "", endedAt: "", exitCode: 0, logPath: null, logSha256: null, commitSha, ...o});
const tsurf = (id: string, commitSha: string, acceptance: string, n: number | null) => tev(id, "TEST_SURFACE", commitSha, {testSurface: {functionalAcceptance: acceptance, executedTests: n}});
const SBX = {sandboxProviderId: "docker-local"};
const TEST_RUNS = {runs: [
  mkRun("f", HEAD1, [tev("7", "VERIFY_TESTS", HEAD1, SBX), tev("8", "REGRESSION_TESTS", HEAD1, SBX), tsurf("9", HEAD1, "UNVERIFIED_ORACLE", 12)]),
  mkRun("g", HEAD1, [tev("a", "VERIFY_TESTS", HEAD1, {...SBX, exitCode: 1}), tev("b", "REGRESSION_TESTS", HEAD1, SBX), tsurf("c", HEAD1, "UNVERIFIED_ORACLE", 5)]),
  mkRun("h", HEAD1, [tev("d", "VERIFY_TESTS", HEAD1), tev("e", "REGRESSION_TESTS", HEAD1), tsurf("1", HEAD1, "UNVERIFIED_ORACLE", 3)]),
  mkRun("i", HEAD2, [tev("2", "VERIFY_TESTS", HEAD1, SBX), tev("3", "REGRESSION_TESTS", HEAD1, SBX), tsurf("4", HEAD1, "UNVERIFIED_ORACLE", 9)]),
  mkRun("j", HEAD1, [tev("5", "VERIFY_TESTS", HEAD1, SBX), tev("6", "REGRESSION_TESTS", HEAD1, SBX), tsurf("7", HEAD1, "BLOCKED", 4)]),
  mkRun("k", HEAD1, [tev("8", "VERIFY_TESTS_NOT_EXECUTED", HEAD1, {exitCode: null})]),
  RUN_E]};

interface Feed { cockpit?: "ok" | "unavail"; workRuns?: "ok" | "off" | "tests"; evidence?: "ok" | "off" | "lineage"; reviews?: "ok" | "off" | "empty" | "bad" }
async function mkCtx(feed: Feed = {}, lang = "tr") {
  const apiMod = await load("api.js"), st = await load("state.js"), i18n = await load("i18n.js");
  const doc = new D(), store = st.createStore(null), calls: string[] = [];
  const bridge = {apiGet: async (p: string) => {
    calls.push(p);
    if (p === "/v1/cockpit") { if (feed.cockpit === "unavail") throw new Error(`${p}: HTTP 404`); return COCKPIT; }
    if (p === "/v1/work-runs") { if (feed.workRuns === "off") throw new Error(`${p}: HTTP 404`); return feed.workRuns === "tests" ? TEST_RUNS : WORK_RUNS; }
    if (p === "/v1/reviews" || p.startsWith("/v1/reviews/")) {
      if (feed.reviews === "off") throw new Error(`${p}: HTTP 404`);
      if (p === "/v1/reviews") return feed.reviews === "empty" ? REVIEWS_EMPTY : feed.reviews === "bad" ? {source: "WRONG"} : REVIEWS;
      const rec = REVIEWS.reviews.find(r => p === `/v1/reviews/${r.reviewId}`);
      if (!rec) throw new Error(`${p}: HTTP 404`);
      return {source: "WORK_OS_JOURNAL_RUN_EVIDENCE", notice: "n", review: {...rec, evidence: {recordedVerdict: rec.verdict === "NO_VERDICT" ? null : rec.verdict, invalidated: null, findingsCount: rec.verdict === "BLOCKED" ? 2 : 0, findings: rec.verdict === "BLOCKED" ? ["<img src=x onerror=alert(1)> finding one", "finding two"] : null, exitCode: 0, timedOut: false, logSha256: null, note: null}}, run: REVIEWS.runs[0]};
    }
    if (p.startsWith("/v1/evidence/")) return {evidence: EVIDENCE.evidence[0], summary: {}, tail: null, tailWithheld: null};
    if (p.startsWith("/v1/evidence")) { if (feed.evidence === "off") throw new Error(`${p}: HTTP 404`); if (p.includes("runId=")) return {evidence: [lev("7", {runId: runId("f")})], nextCursor: null}; return feed.evidence === "lineage" ? LINEAGE_EVIDENCE : EVIDENCE; }
    throw new Error(`${p}: HTTP 404`);
  }};
  const api = apiMod.createApi({bridge, store});
  const t = (k: string, v?: any) => i18n.translate(lang, k, v);
  const ctx: any = {doc, store, api, i18n: {lang, t}, t, navigate: () => {}, rerender: () => {}, settleFocus: () => {}, principal: "FOUNDER_LOCAL"};
  return {ctx, doc, api, calls};
}
const renderAssurance = async (ctx: any) => { const view = await load("views", "assurance.js"); return {view, node: (await view.render(ctx)) as N}; };

describe("UX WP-QA-SEC assurance-core (honest security mapping, no elevation)", () => {
  it("maps a PASSED security stage bound to the run head and never fabricates a product pass", async () => {
    const core = await load("assurance-core.js");
    const r = core.mapRunSecurity(RUN_A);
    expect(r.scanned).toBe(true);
    expect(r.scanStatus).toBe("PASSED");
    expect(r.commitBound).toBe(true);
    expect(r.secrets.gitleaks.status).toBe("CLEAN");
    expect(r.sast.status).toBe("NOT_AVAILABLE");
    expect(r.tools.find((t: any) => t.tool === "semgrep").status).toBe("NOT_INSTALLED");
  });
  it("keeps PARTIAL/BLOCKED verbatim and NEVER upgrades a missing scan to passed", async () => {
    const core = await load("assurance-core.js");
    expect(core.mapRunSecurity(RUN_B).scanStatus).toBe("PARTIAL");
    expect(core.mapRunSecurity(RUN_B).secrets.gitleaks.status).toBe("NOT_INSTALLED");
    const c = core.mapRunSecurity(RUN_C);
    expect(c.scanStatus).toBe("BLOCKED");
    expect(c.blockReason).toBe("SECRET_DETECTED");
    const e = core.mapRunSecurity(RUN_E);
    expect(e.scanned).toBe(false);
    expect(e.scanStatus).toBe("NOT_EXECUTED");
    expect(e.scanStatus).not.toBe("PASSED");
  });
  it("marks a scan bound to another commit as STALE, never a current pass", async () => {
    const core = await load("assurance-core.js");
    const d = core.mapRunSecurity(RUN_D);
    expect(d.stageStatus).toBe("PASSED");
    expect(d.commitBound).toBe(false);
    expect(d.scanStatus).toBe("STALE");
  });
  it("aggregates honestly and mapSecurityScans returns an honest state when the read fails", async () => {
    const core = await load("assurance-core.js");
    const scans = core.mapSecurityScans({ok: true, data: WORK_RUNS});
    expect(scans.state).toBe("VERIFIED");
    expect(scans.aggregate.byStatus).toEqual({PASSED: 1, PARTIAL: 1, BLOCKED: 1, STALE: 1, NOT_EXECUTED: 1});
    expect(scans.aggregate.blocked).toBe(1);
    const off = core.mapSecurityScans({ok: false, state: "OFFLINE"});
    expect(off.state).toBe("OFFLINE");
    expect(off.runs).toEqual([]);
  });
  it("evidenceIntegrity only reads live blocks and never invents counts", async () => {
    const core = await load("assurance-core.js");
    expect(core.evidenceIntegrity(COCKPIT.evidence)).toMatchObject({live: true, total: 10, verified: 7, mismatch: 1, missing: 2});
    const dead = core.evidenceIntegrity({state: "UNAVAILABLE", total: null});
    expect(dead.live).toBe(false);
    expect(dead.total).toBeNull();
  });
});

describe("UX WP-QA-SEC assurance view (real data, honest states)", () => {
  beforeEach(async () => { (await load("views", "assurance.js")).resetAssuranceView(); const f = (await load("forms.js")); f.selection.evidenceId = null; f.selection.missionId = null; });

  it("renders the evidence integrity overview from cockpit.evidence with real counts", async () => {
    const {ctx} = await mkCtx();
    const {node} = await renderAssurance(ctx);
    const panel = byId(node, "qa-evidence")!;
    expect(text(byData(panel, "stat", "total")[0])).toContain("10");
    expect(text(byData(panel, "stat", "verified")[0])).toContain("7");
    expect(text(byData(panel, "stat", "mismatch")[0])).toContain("1");
  });
  it("renders the security scan table with honest per-run status and never a fabricated clean", async () => {
    const {ctx, calls} = await mkCtx();
    const {node} = await renderAssurance(ctx);
    const rowOf = (idc: string) => byData(node, "runId", runId(idc))[0];
    expect(rowOf("a").dataset.scan).toBe("PASSED");
    expect(rowOf("b").dataset.scan).toBe("PARTIAL");
    expect(rowOf("c").dataset.scan).toBe("BLOCKED");
    expect(rowOf("d").dataset.scan).toBe("STALE");
    expect(rowOf("e").dataset.scan).toBe("NOT_EXECUTED");
    // The not-executed run must never carry a PASSED scan pill.
    expect(byData(rowOf("e"), "scan", "PASSED")).toEqual([]);
    // semgrep NOT_INSTALLED surfaced verbatim.
    const semgrep = byData(node, "tool", "semgrep").find(n => n.dataset.toolStatus === "NOT_INSTALLED");
    expect(semgrep).toBeTruthy();
    expect(calls.sort()).toEqual(["/v1/cockpit", "/v1/evidence?limit=100", "/v1/reviews", "/v1/work-runs"]);
  });
  it("opens a per-run security detail with gitleaks/trivy/gaps, honestly", async () => {
    const {ctx} = await mkCtx();
    await renderAssurance(ctx);
    byId((await renderAssurance(ctx)).node, `sec-${runId("c")}`)!; // ensure row button exists
    (await load("views", "assurance.js")); // selection via module state
    // Select run C and re-render.
    const first = await renderAssurance(ctx);
    (byId(first.node, `sec-${runId("c")}`) as N).fire("click");
    const {node} = await renderAssurance(ctx);
    const detail = byId(node, "qa-secdetail")!;
    expect(text(detail)).toContain("SECRET_DETECTED");
    expect(byData(detail, "scan", "BLOCKED").length).toBeGreaterThan(0);
  });
  it("keeps the evidence surface (GET /v1/evidence) working with verification chips", async () => {
    const {ctx} = await mkCtx();
    const {node} = await renderAssurance(ctx);
    const list = byId(node, "assurance-list")!;
    expect(byId(list, `ev-${EVI_ID}`)).toBeTruthy();
    expect(byData(list, "chip", "VERIFIED").length).toBeGreaterThan(0);
  });
  it("shows honest UNAVAILABLE/OFFLINE states instead of inventing data", async () => {
    const {ctx} = await mkCtx({cockpit: "unavail", workRuns: "off"});
    const {node} = await renderAssurance(ctx);
    expect(byId(node, "qa-evidence")!.textContent.length).toBeGreaterThan(0);
    // No security rows are rendered when the work-runs read fails.
    expect(byData(node, "runId").length).toBe(0);
  });
});

describe("UI-049 assurance Reviews panel (real verdicts, honest states)", () => {
  beforeEach(async () => { (await load("views", "assurance.js")).resetAssuranceView(); const f = (await load("forms.js")); f.selection.evidenceId = null; f.selection.missionId = null; });

  it("lists real verdicts with run and mission, never upgrading a non-independent CLEAN", async () => {
    const {ctx} = await mkCtx({}, "en");
    const {node} = await renderAssurance(ctx);
    const panel = byId(node, "as-reviews")!;
    const rows = byData(panel, "reviewId");
    expect(rows.map(r => r.dataset.verdict).sort()).toEqual(["BLOCKED", "CLEAN", "CLEAN"]);
    const rowA = byData(panel, "reviewId", rid("a"))[0], rowC = byData(panel, "reviewId", rid("c"))[0];
    expect(text(rowA)).toContain(runId("a")); expect(text(rowA)).toContain(MSN);
    expect(byData(rowA, "pill", "VERIFIED").length).toBe(1);
    // CLEAN but independence not proven: must NOT be a verified pill.
    expect(byData(rowC, "pill", "VERIFIED").length).toBe(0);
    expect(byData(rowC, "pill", "STALE").length).toBe(1);
    expect(byData(byData(panel, "reviewId", rid("b"))[0], "pill", "BLOCKED").length).toBe(1);
  });
  it("opens the detail from GET /v1/reviews/:id and renders findings as text, not HTML", async () => {
    const {ctx, calls} = await mkCtx({}, "en");
    const first = await renderAssurance(ctx);
    (byId(first.node, `rev-${rid("b")}`) as N).fire("click");
    const {node} = await renderAssurance(ctx);
    expect(calls).toContain(`/v1/reviews/${rid("b")}`);
    const d = byId(node, "as-reviews-detail")!;
    expect(text(d)).toContain(rid("b"));
    expect(byData(d, "verdict", "BLOCKED").length).toBe(1);
    const li = byTag(byData(d, "findings")[0], "li");
    expect(li.length).toBe(2);
    expect(text(li[0])).toContain("<img src=x");
    expect(byTag(d, "img").length).toBe(0);
  });
  it("shows an honest empty state and invents no verdict", async () => {
    const {ctx} = await mkCtx({reviews: "empty"}, "en");
    const {node} = await renderAssurance(ctx);
    const panel = byId(node, "as-reviews")!;
    expect(byData(panel, "reviewId").length).toBe(0);
    expect(byData(panel, "verdict").length).toBe(0);
    expect(text(panel)).toContain("No independent review has been recorded yet.");
  });
  it("shows UNAVAILABLE and ERROR states instead of rows", async () => {
    for (const reviews of ["off", "bad"] as const) {
      const {ctx} = await mkCtx({reviews}, "en");
      const {node} = await renderAssurance(ctx);
      const panel = byId(node, "as-reviews")!;
      expect(byData(panel, "reviewId").length, reviews).toBe(0);
      expect(byTag(panel, "table").length, reviews).toBe(0);
      expect(panel.textContent.length).toBeGreaterThan(0);
    }
  });
  it("mapReviewDetail fails closed on malformed or foreign payloads", async () => {
    const core = await load("assurance-core.js");
    expect(core.mapReviewDetail(null).state).toBe("ERROR");
    expect(core.mapReviewDetail({source: "X", review: {}}).state).toBe("ERROR");
    const good = {source: "WORK_OS_JOURNAL_RUN_EVIDENCE", review: {...REVIEWS.reviews[0], evidence: {findings: null}}};
    expect(core.mapReviewDetail(good).state).toBe("VERIFIED");
    expect(core.mapReviewDetail({...good, review: {...good.review, verdict: "PASS"}}).state).toBe("ERROR");
    expect(core.mapReviewDetail({...good, review: {...good.review, reviewId: "evd_zz"}}).state).toBe("ERROR");
  });
  it("assuranceReview refuses non-canonical ids without calling the bridge", async () => {
    const {api, calls} = await mkCtx({}, "en");
    expect((await api.assuranceReview("../x")).state).toBe("ERROR");
    expect(calls.filter((c: string) => c.startsWith("/v1/reviews"))).toEqual([]);
  });
  it("review routes are already allow-listed read-only GETs (no new route)", () => {
    const ok = loadGet();
    for (const p of ["/v1/reviews", `/v1/reviews/${rid("a")}`]) expect(ok(p), p).toBe(true);
    expect(ok(`/v1/reviews/${rid("a")}/`)).toBe(false);
  });
  it("assurance.reviews.* keys exist in EN and TR with matching placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const ks = Object.keys(en).filter(k => k.startsWith("assurance.reviews."));
    expect(ks.length).toBeGreaterThan(30);
    expect(ks.sort()).toEqual(Object.keys(tr).filter(k => k.startsWith("assurance.reviews.")).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of ks) expect(ph(en[k]), k).toBe(ph(tr[k]));
  });
});

describe("UI-050 evidence lineage (mission -> run -> evidence from list fields only)", () => {
  beforeEach(async () => { (await load("views", "assurance.js")).resetAssuranceView(); const f = (await load("forms.js")); f.selection.evidenceId = null; f.selection.missionId = null; });

  it("buildLineage creates edges only from present fields and never infers", async () => {
    const {buildLineage} = await load("assurance-core.js");
    const L = buildLineage(LINEAGE_EVIDENCE.evidence);
    expect(L.total).toBe(6);
    const m1 = L.missions.find((m: any) => m.missionId === MSN), m2 = L.missions.find((m: any) => m.missionId === MSN2);
    expect(m1.runs.map((r: any) => [r.runId, r.evidence.length])).toEqual([[runId("a"), 2], [runId("b"), 1]]);
    // mission-only item stays on the mission with NO run; it is not attached to any run.
    expect(m2.runs).toEqual([]); expect(m2.noRun.map((e: any) => e.evidenceId)).toEqual([`evi_${"4".repeat(32)}`]);
    // run-only item is NOT adopted by MSN even though run a belongs to MSN elsewhere.
    expect(L.orphanRuns.map((r: any) => [r.runId, r.evidence.length])).toEqual([[runId("a"), 1]]);
    expect(m1.runs[0].evidence.map((e: any) => e.evidenceId)).not.toContain(`evi_${"5".repeat(32)}`);
    expect(L.ungrouped.map((e: any) => e.evidenceId)).toEqual([`evi_${"6".repeat(32)}`]);
    expect(buildLineage(null).total).toBe(0);
  });
  it("renders the grouped tree and shows missing ids as ungrouped", async () => {
    const {ctx} = await mkCtx({evidence: "lineage"}, "en");
    const {node} = await renderAssurance(ctx);
    const p = byId(node, "as-lineage")!;
    expect(byData(p, "lineage", "mission").length).toBe(2);
    const m1 = byData(p, "missionId", MSN).find(n => n.dataset.lineage === "mission")!;
    expect(byData(m1, "lineage", "run").length).toBe(2);
    expect(byData(m1, "lineage", "evidence").length).toBe(3);
    expect(byData(p, "lineage", "orphanRuns").length).toBe(1);
    const un = byData(p, "lineage", "ungrouped")[0];
    expect(byData(un, "lineage", "evidence").length).toBe(1);
    expect(text(byData(p, "lineageScope")[0])).toContain("6");
  });
  it("honest empty and unavailable states, no invented groups", async () => {
    const empty = await mkCtx({}, "en");
    const a = await renderAssurance(empty.ctx);
    // default fixture has one mission-only item: one mission, no runs invented.
    expect(byData(byId(a.node, "as-lineage")!, "lineage", "run").length).toBe(0);
    expect(byData(byId(a.node, "as-lineage")!, "lineage", "norun").length).toBe(1);
    const off = await mkCtx({evidence: "off"}, "en");
    const b = await renderAssurance(off.ctx);
    expect(byData(byId(b.node, "as-lineage")!, "lineage").length).toBe(0);
  });
  it("assurance.lineage.* keys have EN/TR parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const ks = Object.keys(en).filter(k => k.startsWith("assurance.lineage."));
    expect(ks.length).toBeGreaterThanOrEqual(9);
    expect(ks.sort()).toEqual(Object.keys(tr).filter(k => k.startsWith("assurance.lineage.")).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of ks) expect(ph(en[k]), k).toBe(ph(tr[k]));
  });
});

describe("UI-051 per-run test report (recorded evidence else NOT_EXECUTED, never a pass without evidence)", () => {
  beforeEach(async () => { (await load("views", "assurance.js")).resetAssuranceView(); const f = (await load("forms.js")); f.selection.evidenceId = null; f.selection.missionId = null; });
  const stateOf = (node: N, c: string) => byData(node, "testRun", runId(c))[0]?.dataset.testState;

  it("testStateOf/mapTestReports derive status only from head-bound attested evidence", async () => {
    const core = await load("assurance-core.js");
    const m = core.mapTestReports({ok: true, data: TEST_RUNS});
    const st = (c: string) => m.runs.find((r: any) => r.runId === runId(c)).state;
    expect([st("f"), st("g"), st("h"), st("i"), st("j"), st("k"), st("e")]).toEqual(["EXECUTED", "FAILED", "UNVERIFIED", "NOT_EXECUTED", "BLOCKED", "NOT_EXECUTED", "NOT_EXECUTED"]);
    expect(m.runs.find((r: any) => r.runId === runId("f")).executedTests).toBe(12);
    // Run with no test evidence has zero records and is NOT_EXECUTED.
    expect(m.runs.find((r: any) => r.runId === runId("e")).records).toEqual([]);
    expect(core.mapTestReports({ok: false, state: "UNAVAILABLE"})).toEqual({state: "UNAVAILABLE", runs: []});
    expect(core.mapTestReports({ok: true, data: {}}).state).toBe("ERROR");
  });
  it("renders EXECUTED only for the evidenced run; stale/missing/zero-count never read as executed", async () => {
    const {ctx} = await mkCtx({workRuns: "tests"}, "en");
    const {node} = await renderAssurance(ctx);
    const p = byId(node, "as-testrep")!;
    expect(byData(p, "testRun").length).toBe(7);
    expect(stateOf(p, "f")).toBe("EXECUTED");
    for (const c of ["i", "k", "e"]) expect(stateOf(p, c), c).toBe("NOT_EXECUTED");
    expect(stateOf(p, "g")).toBe("FAILED");
    expect(stateOf(p, "h")).toBe("UNVERIFIED");
    expect(byData(p, "testState", "EXECUTED").filter(n => n.tagName === "TR").length).toBe(1);
    // The word PASS/PASSED is never produced by this panel.
    expect(/\bPASS(ED)?\b/.test(text(p))).toBe(false);
  });
  it("detail lists the recorded test evidence and cross-checks the evidence index by exact id", async () => {
    const {ctx, calls} = await mkCtx({workRuns: "tests"}, "en");
    const first = await renderAssurance(ctx);
    (byId(first.node, `tr-${runId("f")}`) as N).fire("click");
    const {node} = await renderAssurance(ctx);
    expect(calls.some((c: string) => c.startsWith("/v1/evidence?") && c.includes(`runId=${runId("f")}`))).toBe(true);
    const d = byId(node, "as-testrep-detail")!;
    expect(byData(d, "testRecord", "VERIFY_TESTS").length).toBe(1);
    expect(byData(d, "testRecord", "REGRESSION_TESTS").length).toBe(1);
    // Only the VERIFY_TESTS id (evi_7...) is in the index; the others are shown as not indexed, not as verified.
    expect(byData(d, "chip", "VERIFIED").length).toBe(1);
    expect(byData(d, "indexState", "NOT_INDEXED").length).toBeGreaterThan(0);
  });
  it("a run with no test evidence shows NOT_EXECUTED and no records in detail", async () => {
    const {ctx} = await mkCtx({workRuns: "tests"}, "en");
    const first = await renderAssurance(ctx);
    (byId(first.node, `tr-${runId("e")}`) as N).fire("click");
    const {node} = await renderAssurance(ctx);
    const d = byId(node, "as-testrep-detail")!;
    expect(byData(d, "testState", "NOT_EXECUTED").length).toBeGreaterThan(0);
    expect(byData(d, "testNotExecuted").length).toBe(1);
    expect(byData(d, "testRecord").length).toBe(0);
  });
  it("shows honest UNAVAILABLE and empty states", async () => {
    const off = await mkCtx({workRuns: "off"}, "en");
    const a = await renderAssurance(off.ctx);
    expect(byData(byId(a.node, "as-testrep")!, "testRun").length).toBe(0);
    expect(byTag(byId(a.node, "as-testrep")!, "table").length).toBe(0);
  });
  it("assurance.testreport.* keys have EN/TR parity", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const ks = Object.keys(en).filter(k => k.startsWith("assurance.testreport."));
    expect(ks.length).toBeGreaterThan(30);
    expect(ks.sort()).toEqual(Object.keys(tr).filter(k => k.startsWith("assurance.testreport.")).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of ks) expect(ph(en[k]), k).toBe(ph(tr[k]));
  });
});

describe("UX WP-QA-SEC dynamic QA gate (Founder-gated, never a fake run)", () => {
  beforeEach(async () => { (await load("views", "assurance.js")).resetAssuranceView(); });
  it("lists dynamic QA capabilities as BLOCKED/NOT_EXECUTED with no run button and no execution control", async () => {
    const {ctx} = await mkCtx();
    const {node} = await renderAssurance(ctx);
    const panel = byId(node, "qa-dynamic")!;
    const gates = byData(panel, "gate");
    expect(gates.length).toBeGreaterThanOrEqual(9);
    for (const g of gates) expect(["BLOCKED", "NOT_EXECUTED"]).toContain(g.dataset.state);
    // Device farm + mobile + live preview are BLOCKED (paid device farm / FD-REL-1).
    expect(byData(panel, "gate", "deviceFarm")[0].dataset.state).toBe("BLOCKED");
    expect(byData(panel, "gate", "livePreview")[0].dataset.state).toBe("BLOCKED");
    // There is NO button in the dynamic QA panel: nothing can trigger execution.
    expect(byTag(panel, "button").length).toBe(0);
    // The gate note cites FD-REL-1 and the SOURCE_GENERATION_COMPLETE != PRODUCT_VERIFIED distinction.
    const note = byData(panel, "gateNote")[0];
    expect(text(note)).toContain("FD-REL-1");
    expect(text(note)).toContain("PRODUCT_VERIFIED");
  });
});

describe("UX WP-QA-SEC allow-list and i18n", () => {
  it("only requires already allow-listed read-only GETs (no new route needed)", () => {
    const ok = loadGet();
    for (const p of ["/v1/cockpit", "/v1/work-runs", "/v1/evidence", "/v1/evidence?limit=100", `/v1/evidence/evi_${"a".repeat(32)}`]) expect(ok(p), p).toBe(true);
  });
  it("qa.* keys are present and identical in EN and TR with matching placeholders", async () => {
    const tr = (await load("locales", "tr.js")).default as Record<string, string>;
    const en = (await load("locales", "en.js")).default as Record<string, string>;
    const qa = Object.keys(tr).filter(k => k.startsWith("qa."));
    expect(qa.length).toBeGreaterThan(40);
    expect(qa.sort()).toEqual(Object.keys(en).filter(k => k.startsWith("qa.")).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of qa) { expect(en[k], k).toBeTruthy(); expect(ph(en[k]), k).toBe(ph(tr[k])); }
  });
});
