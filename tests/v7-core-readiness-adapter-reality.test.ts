// //TR: Bu test C-RDY-2a Adapter Gerçeklik Haritasını (core/capabilities/adapter-reality.ts) doğrular: her harita girdisinin modülü var, dışa aktarımı dinamik içe aktarmayla görünür ve bildirilen üretim çağıranları o dışa aktarımı gerçekten anıyor (T1); gerçek kayıtlarda kayıt-defteri-ile-kod uzlaştırması (UNDER_REPORTED/UNREGISTERED_REAL/DEAD_CODE) ve yetenek çözümleyicisinin sağlığı gerçeklik haritasından alması (T2); CI dürüstlüğü: iş akışlarında geçmeyen bir araç REAL sayılamaz (T3); 10 bağlama adaptörünün çözülmesi ve bilinmeyen kimliğin ADAPTER_UNRESOLVED olması (T4); C-RDY-1 TOOL_READY'nin yoklama gözlenmeden TRUE olmaması (T5). Hiçbir test kayıt dosyasına yazmaz; hiçbir ikili çalıştırılmaz.
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {ADAPTER_REALITY_RECORDS, DEAD_CODE_PROBES, buildAdapterRealityMap, buildAdapterRealityReport, ciEvidenceProblems, declaresExport, declaresMember, findProductionImporters, loadRegistryAdapters, readWorkflowTexts, reconcileAdapterReality, verifyRecord} from "../core/capabilities/adapter-reality.js";
import type {AdapterRealityRecord, ProbeObservation, RecordVerification, RegistryAdapterRow} from "../core/capabilities/adapter-reality.js";
import {resolveCapabilityFromReality} from "../core/capabilities/resolver.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import {computeRoleReadiness, loadReadinessInputFromRepo} from "../core/agents/readiness-audit.js";

const REPO = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const BINDING_ADAPTER_IDS = FIRST_DELIVERY_BINDINGS.flatMap(b => b.adapters);
const DISTINCT_BINDING_ADAPTERS = [...new Set(BINDING_ADAPTER_IDS)].sort();
const rec = (over: Partial<AdapterRealityRecord> = {}): AdapterRealityRecord => ({
  adapterId: "fixture", origin: "BINDING", module: "core/workos/security-tools.ts", mode: "EXPORT", exportName: "runGitleaks", runs: true, callers: [{file: "core/workos/runner.ts", references: "runGitleaks("}], ciEvidence: "FAKE_ONLY", note: "fixture", ...over
});
const report = (o: {probes?: ReadonlyMap<string, ProbeObservation>; bindingAdapterIds?: readonly string[]; records?: readonly AdapterRealityRecord[]} = {}) =>
  buildAdapterRealityReport(REPO, {bindingAdapterIds: BINDING_ADAPTER_IDS, ...o});
const allReady = (ids: readonly string[]): ReadonlyMap<string, ProbeObservation> => new Map(ids.map(id => [id, "READY" as const]));

describe("C-RDY-2a adapter-reality", () => {
  let tmp = "";
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-rdy2a-")); });
  afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

  // //TR: Dinamik içe aktarma ile dışa aktarımın GERÇEKTEN çalışma zamanında göründüğünü doğrular (betikler içe aktarılmaz: SCRIPT_LITERAL yalnız dosya + metin).
  const exportVisible = async (r: AdapterRealityRecord): Promise<boolean> => {
    if (r.mode === "SCRIPT_LITERAL") return fs.statSync(path.join(REPO, r.module)).isFile();
    const m: Record<string, unknown> = await import(/* @vite-ignore */ r.mode === "NPM_PACKAGE" ? r.module : pathToFileURL(path.join(REPO, r.module)).href);
    const exp = m[r.exportName];
    if (typeof exp !== "function") return false;
    return r.member === undefined || typeof (exp as {prototype?: Record<string, unknown>}).prototype?.[r.member] === "function";
  };

  it("every map entry: module, export and production callers exist", async () => {
    expect(ADAPTER_REALITY_RECORDS).toHaveLength(20);
    expect(new Set(ADAPTER_REALITY_RECORDS.map(r => r.adapterId)).size).toBe(20);
    const counts = (o: string) => ADAPTER_REALITY_RECORDS.filter(r => r.origin === o).length;
    expect([counts("REGISTRY"), counts("UNREGISTERED"), counts("BINDING")]).toEqual([6, 4, 10]);
    for (const r of ADAPTER_REALITY_RECORDS) {
      const v = verifyRecord(r, REPO);
      expect(v.moduleExists, `${r.adapterId} module`).toBe(true);
      expect(v.exportDeclared, `${r.adapterId} export`).toBe(true);
      expect(v.failedCallers, `${r.adapterId} callers`).toEqual([]);
      expect(v.verifiedCallers, `${r.adapterId} verified callers`).toBe(r.callers.length);
      expect(await exportVisible(r), `${r.adapterId} dynamic import`).toBe(true);
      // //TR: semgrep yalnız bulunur (runs false): kod yolu ABSENT; diğer her kayıt PRESENT.
      expect(v.codePath, r.adapterId).toBe(r.adapterId === "semgrep" ? "ABSENT" : "PRESENT");
    }
    expect(verifyRecord(ADAPTER_REALITY_RECORDS.find(r => r.adapterId === "semgrep")!, REPO).reasons).toContain("NEVER_RUNS_IN_PRODUCTION");
    // //TR: Var olmayan dışa aktarımlı bir fixture hem metin doğrulamasında hem dinamik içe aktarmada başarısız olur.
    const ghost = rec({exportName: "noSuchExport"});
    expect(verifyRecord(ghost, REPO)).toMatchObject({moduleExists: true, exportDeclared: false, codePath: "ABSENT", reasons: ["EXPORT_NOT_DECLARED"]});
    expect(await exportVisible(ghost)).toBe(false);
    // //TR: Var olmayan sınıf üyesi (yöntem) de hem metin doğrulamasında hem dinamik içe aktarmada başarısız olur; var olan üye (prepareRunDelivery) doğrulanır.
    const studio = {exportName: "ProjectStudio", module: "core/workos/project-studio.ts", callers: [{file: "core/workos/crew/dev-review.ts", references: "studio.prepareRunDelivery("}]};
    expect(verifyRecord(rec({...studio, member: "noSuchMethod"}), REPO)).toMatchObject({exportDeclared: false, codePath: "ABSENT", reasons: ["EXPORT_NOT_DECLARED"]});
    expect(verifyRecord(rec({...studio, member: "prepareRunDelivery"}), REPO)).toMatchObject({exportDeclared: true, codePath: "PRESENT"});
    expect(await exportVisible(rec({...studio, member: "noSuchMethod"}))).toBe(false);
    // //TR: Üretilmiş (sahte) çağıran: dosya gerçek ama anılan metin yok -> çağıran doğrulanmaz, kod yolu ABSENT (çağıran kontrolü atlanamaz).
    const fabricated = verifyRecord(rec({callers: [{file: "core/workos/runner.ts", references: "thisCallIsFabricatedByTheFixture("}]}), REPO);
    expect(fabricated).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
    expect(fabricated.failedCallers).toEqual(["core/workos/runner.ts:thisCallIsFabricatedByTheFixture("]);
    expect(fabricated.reasons).toEqual(["CALLER_NOT_FOUND", "NO_PRODUCTION_CALLER"]);
    expect(verifyRecord(rec({callers: [{file: "core/workos/no-such-file.ts", references: "runGitleaks("}]}), REPO).codePath).toBe("ABSENT");
    expect(verifyRecord(rec({callers: []}), REPO)).toMatchObject({codePath: "ABSENT", reasons: ["NO_PRODUCTION_CALLER"]});
    // //TR: Bir çağıran doğrulanıp biri doğrulanmazsa kod yolu PRESENT kalır ama bayat bildirim failedCallers'ta görünür (T1 bunu CI'da yakalar).
    const stale = verifyRecord(rec({callers: [{file: "core/workos/runner.ts", references: "runGitleaks("}, {file: "core/workos/runner.ts", references: "goneSymbol("}]}), REPO);
    expect(stale).toMatchObject({verifiedCallers: 1, codePath: "PRESENT"});
    expect(stale.failedCallers).toEqual(["core/workos/runner.ts:goneSymbol("]);
    // //TR: Giriş betiği (entrypoint) çağıran istemez; ama giriş betiği olmayan ve çağıransız kayıt ABSENT'tir. Modül yok -> ABSENT.
    expect(verifyRecord(ADAPTER_REALITY_RECORDS.find(r => r.adapterId === "playwright")!, REPO).codePath).toBe("PRESENT");
    expect(verifyRecord(rec({module: "core/workos/no-such-module.ts"}), REPO)).toMatchObject({moduleExists: false, codePath: "ABSENT"});
    expect(verifyRecord(rec({runs: false}), REPO).codePath).toBe("ABSENT");
    expect(verifyRecord(rec({mode: "NPM_PACKAGE", module: "no-such-package-xyz", exportName: "default", callers: []}), REPO)).toMatchObject({moduleExists: false, codePath: "ABSENT"});
    expect(verifyRecord(rec({mode: "SCRIPT_LITERAL", module: "scripts/e2e/desktop-journey.e2e.mjs", exportName: "noSuchLiteralInTheScript", entrypoint: true, callers: []}), REPO)).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
  });

  it("export and member detection read declarations, not mentions", () => {
    const src = ["export function a() {}", "export async function b() {}", "export class C {\n  private async stepX(a) {}\n  prepare(x: number) {}\n  static make<T>() {}\n  readonly notAMethod = 1;\n}", "export const d = 1;", "export { e, f as g };", "// export function hidden() {}", "function local() {}", "const mention = 'export function nothing'"].join("\n");
    for (const n of ["a", "b", "C", "d", "e", "g"]) expect(declaresExport(src, n), n).toBe(true);
    for (const n of ["hidden", "local", "nothing", "ab", "f"]) expect(declaresExport(src, n), n).toBe(n === "f" ? true : false);
    for (const m of ["stepX", "prepare", "make"]) expect(declaresMember(src, m), m).toBe(true);
    for (const m of ["notAMethod", "missing", "step"]) expect(declaresMember(src, m), m).toBe(false);
  });

  it("reconciliation on real registries", () => {
    const r = report();
    const rc = r.reconciliation;
    expect(rc.registry).toEqual({total: 194, defined: 194, implemented: 0});
    expect(rc.codeBackedRegistryIds).toEqual(["ajv", "ajv-formats", "gitleaks", "playwright", "trivy"]);
    expect(rc.findings.filter(f => f.finding === "UNDER_REPORTED").map(f => f.id)).toEqual(["ajv", "ajv-formats", "gitleaks", "playwright", "trivy"]);
    expect(rc.counts).toEqual({UNDER_REPORTED: 5, OVER_REPORTED: 0, UNREGISTERED_REAL: 4, DEAD_CODE: 1, ADAPTER_UNRESOLVED: 0});
    expect(rc.unregisteredReal).toEqual(["claude-cli", "git", "node", "npm"]);
    expect(rc.deadCode).toEqual(["core/capabilities/resolver.ts"]);
    expect(rc.unresolvedBindingAdapters).toEqual([]);
    // //TR: semgrep kayıtlıdır ve kodda yalnız bulunur: kod destekli değil, bulgu yok. Kayıt defteri hiçbir adaptörü uygulanmış saymaz.
    expect(rc.codeBackedRegistryIds).not.toContain("semgrep");
    expect(rc.findings.some(f => f.id === "semgrep")).toBe(false);
    expect(r.deadCode).toEqual([{module: "core/capabilities/resolver.ts", exports: ["resolveCapability", "resolveCapabilityFromReality"], importers: []}]);
    expect(r.ciProblems).toEqual([]);
    // //TR: Yetenek çözümleyicisi: sağlık gerçeklik haritasından gelir. Kayıt satırları araç olarak verilir (implementation hep NOT_IMPLEMENTED); yoklama gözlenmeden hiçbiri çözülmez.
    const tools = loadRegistryAdapters(REPO).map(a => ({id: a.id, category: a.category, capabilities: [a.category], implementation: a.implementation}));
    for (const cap of ["SECRETS", "SUPPLY_CHAIN", "BROWSER", "API_SCHEMA", "SAST"]) expect(resolveCapabilityFromReality(cap, tools, [], r.entries).tools, cap).toEqual([]);
    const ready = report({probes: allReady(["gitleaks", "trivy", "playwright", "ajv", "semgrep", "git"])}).entries;
    expect(resolveCapabilityFromReality("SECRETS", tools, [], ready).tools.map(t => t.id)).toEqual(["gitleaks"]);
    expect(resolveCapabilityFromReality("SUPPLY_CHAIN", tools, [], ready).tools.map(t => t.id)).toEqual(["trivy"]);
    expect(resolveCapabilityFromReality("BROWSER", tools, [], ready).tools.map(t => t.id)).toEqual(["playwright"]);
    expect(resolveCapabilityFromReality("API_SCHEMA", tools, [], ready).tools.map(t => t.id)).toEqual(["ajv"]);
    // //TR: semgrep'in yoklaması READY olsa bile kod yolu ABSENT olduğundan çözülmez; haritada olmayan araç (git için kayıt satırı yok) çözülmez; FAILED yoklama çözülmez.
    expect(resolveCapabilityFromReality("SAST", tools, [], ready).tools).toEqual([]);
    expect(resolveCapabilityFromReality("SCM", tools, [], ready).tools).toEqual([]);
    expect(resolveCapabilityFromReality("SECRETS", tools, [], report({probes: new Map<string, ProbeObservation>([["gitleaks", "FAILED"]])}).entries).tools).toEqual([]);
    // //TR: Kaynaklar (resources) değişmedi: ready bayrağı ve yetenek eşleşmesi.
    expect(resolveCapabilityFromReality("X", [], [{id: "r1", capabilities: ["X"], ready: true}, {id: "r2", capabilities: ["X"], ready: false}], new Map()).resources.map(x => x.id)).toEqual(["r1"]);
  });

  it("dead code needs a real production import; comments, strings and tests do not count", () => {
    const root = fs.mkdtempSync(path.join(tmp, "dc-"));
    const w = (rel: string, body: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), body); };
    const probe = DEAD_CODE_PROBES[0];
    w("core/capabilities/resolver.ts", "export function resolveCapability() {}\n");
    w("tests/uses-it.test.ts", "import {resolveCapability} from \"../core/capabilities/resolver.js\";\n");
    w("core/other.ts", "// import {resolveCapability} from \"./capabilities/resolver.js\";\n/* from \"capabilities/resolver\" */\n * from \"capabilities/resolver\"\nconst s = \"capabilities/resolver\";\n");
    w("node_modules/x/index.js", "import a from \"../../core/capabilities/resolver.js\";\n");
    expect(findProductionImporters(root, probe)).toEqual([]);
    w("apps/control-api/src/real.ts", "import {resolveCapability} from \"../../../core/capabilities/resolver.js\";\n");
    w("scripts/real.mjs", "const m = await import(\"../core/capabilities/resolver.js\");\n");
    w("automation/lib/real.cjs", "const m = require(\"../../core/capabilities/resolver\");\n");
    expect(findProductionImporters(root, probe)).toEqual(["apps/control-api/src/real.ts", "automation/lib/real.cjs", "scripts/real.mjs"]);
    // //TR: Üretim içe aktaranı olan modül DEAD_CODE değildir; olmayan DEAD_CODE'dur.
    const base = {registry: [] as RegistryAdapterRow[], records: [] as AdapterRealityRecord[], verifications: new Map<string, RecordVerification>(), bindingAdapterIds: [] as string[]};
    expect(reconcileAdapterReality({...base, deadCode: [{module: probe.module, exports: probe.exports, importers: ["apps/control-api/src/real.ts"]}]}).counts.DEAD_CODE).toBe(0);
    expect(reconcileAdapterReality({...base, deadCode: [{module: probe.module, exports: probe.exports, importers: []}]}).deadCode).toEqual([probe.module]);
  });

  it("reconciliation findings on fixtures: UNDER, OVER, UNREGISTERED, UNRESOLVED", () => {
    const row = (id: string, implementation: string): RegistryAdapterRow => ({id, category: "X", status: "REGISTERED", implementation});
    const present = (adapterId: string): RecordVerification => ({adapterId, moduleExists: true, exportDeclared: true, verifiedCallers: 1, failedCallers: [], codePath: "PRESENT", reasons: []});
    const absent = (adapterId: string): RecordVerification => ({...present(adapterId), codePath: "ABSENT", reasons: ["MODULE_MISSING"]});
    const records = ["a", "b", "c", "d", "e"].map(adapterId => rec({adapterId, origin: adapterId === "e" ? "UNREGISTERED" : "REGISTRY"}));
    const verifications = new Map<string, RecordVerification>([["a", present("a")], ["b", present("b")], ["c", absent("c")], ["d", absent("d")], ["e", present("e")]]);
    const rc = reconcileAdapterReality({
      registry: [row("a", "NOT_IMPLEMENTED"), row("b", "IMPLEMENTED"), row("c", "IMPLEMENTED"), row("d", "NOT_IMPLEMENTED"), row("z", "PARTIAL")],
      records, verifications, bindingAdapterIds: ["a", "ghost", "ghost"], deadCode: []
    });
    // a: code-backed but registry says not implemented -> UNDER; b: both agree -> nothing; c: registry says implemented, no code -> OVER; d: neither -> nothing; z: implemented and not mapped -> OVER; e: real code, no registry row -> UNREGISTERED; ghost -> UNRESOLVED
    expect(rc.findings.map(f => `${f.finding}:${f.id}`)).toEqual(["ADAPTER_UNRESOLVED:ghost", "OVER_REPORTED:c", "OVER_REPORTED:z", "UNDER_REPORTED:a", "UNREGISTERED_REAL:e"]);
    expect(rc.counts).toEqual({UNDER_REPORTED: 1, OVER_REPORTED: 2, UNREGISTERED_REAL: 1, DEAD_CODE: 0, ADAPTER_UNRESOLVED: 1});
    expect(rc.codeBackedRegistryIds).toEqual(["a", "b"]);
    expect(rc.unregisteredReal).toEqual(["e"]);
    expect(rc.unresolvedBindingAdapters).toEqual(["ghost"]);
    expect(rc.registry).toEqual({total: 5, defined: 5, implemented: 3});
  });

  it("CI honesty", () => {
    const texts = readWorkflowTexts(REPO);
    expect(texts.length).toBeGreaterThan(0);
    const mentioned = (tool: string) => texts.some(t => new RegExp(tool, "i").test(t));
    for (const tool of ["gitleaks", "trivy", "playwright", "semgrep"]) {
      const r = ADAPTER_REALITY_RECORDS.find(x => x.adapterId === tool)!;
      // //TR: İş akışlarında hiç geçmeyen bir araç REAL sayılamaz (bir iş akışı geçerse sınıf yükseltilebilir; bu test o zaman güncellenir).
      if (!mentioned(tool)) expect(r.ciEvidence, tool).not.toBe("REAL");
    }
    expect(ADAPTER_REALITY_RECORDS.find(r => r.adapterId === "trivy")!.ciEvidence).toBe("FAKE_ONLY");
    expect(ADAPTER_REALITY_RECORDS.find(r => r.adapterId === "gitleaks")!.ciEvidence).toBe("FAKE_BINARY_ONLY");
    expect(ADAPTER_REALITY_RECORDS.find(r => r.adapterId === "playwright")!.ciEvidence).toBe("HARNESS_NOT_CI");
    expect(ADAPTER_REALITY_RECORDS.find(r => r.adapterId === "semgrep")!.ciEvidence).toBe("DISCOVERY_ONLY");
    expect(ciEvidenceProblems(ADAPTER_REALITY_RECORDS, texts)).toEqual([]);
    // //TR: REAL yalnız iş akışında gerçekten geçen jetonla savunulur: bulunmayan jeton ve jetonsuz REAL sorundur; REAL olmayan kayıt sorun üretmez.
    expect(ciEvidenceProblems([rec({adapterId: "x", ciEvidence: "REAL", ciTokens: ["definitely-not-in-any-workflow"]})], texts)).toEqual(["x:CI_TOKEN_NOT_IN_WORKFLOWS:definitely-not-in-any-workflow"]);
    expect(ciEvidenceProblems([rec({adapterId: "y", ciEvidence: "REAL"})], texts)).toEqual(["y:REAL_WITHOUT_CI_TOKENS"]);
    expect(ciEvidenceProblems([rec({adapterId: "z", ciEvidence: "FAKE_ONLY", ciTokens: ["nope"]})], texts)).toEqual([]);
    expect(ciEvidenceProblems([rec({adapterId: "w", ciEvidence: "REAL", ciTokens: ["gitleaks-unreal"]})], ["... gitleaks-unreal ..."])).toEqual([]);
    // //TR: Sahte bir iş akışı kümesinde trivy anılırsa REAL jetonu ile savunulabilir; anılmadan REAL işaretlemek (mutant M1) bu fonksiyonla yakalanır.
    const trivyAsReal = ADAPTER_REALITY_RECORDS.map(r => r.adapterId === "trivy" ? {...r, ciEvidence: "REAL" as const} : r);
    expect(ciEvidenceProblems(trivyAsReal, texts)).toEqual(["trivy:REAL_WITHOUT_CI_TOKENS"]);
  });

  it("binding adapters resolve; unknown ids are ADAPTER_UNRESOLVED", () => {
    expect(DISTINCT_BINDING_ADAPTERS).toHaveLength(10);
    const r = report();
    for (const id of DISTINCT_BINDING_ADAPTERS) {
      const record = ADAPTER_REALITY_RECORDS.find(x => x.adapterId === id);
      expect(record?.origin, id).toBe("BINDING");
      expect(r.entries.get(id), id).toMatchObject({adapterId: id, codePath: "PRESENT", probe: "NOT_OBSERVED"});
    }
    expect(r.reconciliation.unresolvedBindingAdapters).toEqual([]);
    expect(r.reconciliation.counts.ADAPTER_UNRESOLVED).toBe(0);
    const unknown = report({bindingAdapterIds: [...BINDING_ADAPTER_IDS, "no-such-adapter", "no-such-adapter"]});
    expect(unknown.reconciliation.unresolvedBindingAdapters).toEqual(["no-such-adapter"]);
    expect(unknown.reconciliation.findings.filter(f => f.finding === "ADAPTER_UNRESOLVED")).toEqual([{finding: "ADAPTER_UNRESOLVED", id: "no-such-adapter", detail: "binding adapter id has no reality-map record"}]);
    expect(unknown.reconciliation.counts.ADAPTER_UNRESOLVED).toBe(1);
    // //TR: Haritada olmayan kimlik için giriş de üretilmez (C-RDY-1 onu ADAPTER_UNRESOLVED görür); yinelenen kayıt kimliği hatadır.
    expect(unknown.entries.has("no-such-adapter")).toBe(false);
    expect(() => buildAdapterRealityMap({records: [rec({adapterId: "dup"}), rec({adapterId: "dup"})], repoRoot: REPO})).toThrow("ADAPTER_REALITY_DUPLICATE_ID:dup");
  });

  it("TOOL_READY needs an observed probe (C-RDY-1 integration)", () => {
    const tool = (entries: ReturnType<typeof report>["entries"]) => computeRoleReadiness(loadReadinessInputFromRepo(REPO, {runs: {journal: "ABSENT"}, adapterReality: entries, now: NOW})).totals.TOOL_READY;
    const count = (c: {TRUE: number; FALSE: number; UNKNOWN: number}) => ({TRUE: c.TRUE, FALSE: c.FALSE, UNKNOWN: c.UNKNOWN});
    // //TR: Her yoklama NOT_OBSERVED iken kod yolu PRESENT olsa bile TOOL_READY UNKNOWN 9'dur (asla TRUE 9).
    expect(count(tool(report().entries))).toEqual({TRUE: 0, FALSE: 590, UNKNOWN: 9});
    // //TR: Her bağlama adaptörü için READY yoklama taslağıyla TRUE 9.
    expect(count(tool(report({probes: allReady(DISTINCT_BINDING_ADAPTERS)}).entries))).toEqual({TRUE: 9, FALSE: 590, UNKNOWN: 0});
    // //TR: Yarım gözlem UNKNOWN kalır (bir adaptör gözlenmedi); FAILED FALSE yapar; hiç yoklama olmadan harita TRUE üretmez.
    const partial = new Map<string, ProbeObservation>(DISTINCT_BINDING_ADAPTERS.filter(id => id !== "workos-predev-plan").map(id => [id, "READY" as const]));
    expect(count(tool(report({probes: partial}).entries))).toEqual({TRUE: 8, FALSE: 590, UNKNOWN: 1});
    const failed = new Map(partial).set("workos-predev-plan", "FAILED");
    const failedAudit = computeRoleReadiness(loadReadinessInputFromRepo(REPO, {runs: {journal: "ABSENT"}, adapterReality: report({probes: failed}).entries, now: NOW}));
    expect(failedAudit.roles.find(x => x.roleId === "UASCO-0019")!.layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["PROBE_FAILED"]});
    // //TR: Kod yolu ABSENT olan (modülü olmayan) bir adaptör READY yoklamayla bile TRUE yapmaz: ADAPTER_CODE_ABSENT.
    const records = ADAPTER_REALITY_RECORDS.map(r => r.adapterId === "workos-predev-plan" ? {...r, module: "core/workos/predev/no-such-module.ts"} : r);
    const absentAudit = computeRoleReadiness(loadReadinessInputFromRepo(REPO, {runs: {journal: "ABSENT"}, adapterReality: report({records, probes: allReady(DISTINCT_BINDING_ADAPTERS)}).entries, now: NOW}));
    expect(absentAudit.roles.find(x => x.roleId === "UASCO-0019")!.layers.TOOL_READY).toEqual({state: "FALSE", reasons: ["ADAPTER_CODE_ABSENT"]});
    expect(absentAudit.totals.TOOL_READY.TRUE).toBe(8);
  });

  it("registry loader fails closed", () => {
    const rel = "registries/tool-adapters.json";
    const root = (body: string | null) => { const r = fs.mkdtempSync(path.join(tmp, "reg-")); if (body !== null) { fs.mkdirSync(path.join(r, "registries")); fs.writeFileSync(path.join(r, rel), body); } return r; };
    for (const body of [null, "{not json", JSON.stringify({adapters: "none"}), JSON.stringify({adapters: []}), JSON.stringify({adapters: [{id: "x"}]})]) expect(() => loadRegistryAdapters(root(body)), String(body)).toThrow(`ADAPTER_REGISTRY_UNAVAILABLE:${rel}`);
    expect(loadRegistryAdapters(root(JSON.stringify({adapters: [{id: "x", category: "C", status: "REGISTERED", implementation: "NOT_IMPLEMENTED"}]})))).toHaveLength(1);
    expect(loadRegistryAdapters(REPO)).toHaveLength(194);
  });
});
