// //TR: Bu dosya (C-RDY-2a) araç/adaptör kimliklerini (kayıt defteri kimlikleri VE bağlama mantıksal kimlikleri) gerçek koda bağlayan KOD DESTEKLİ bir harita ve kayıt-defteri-ile-kod uzlaştırması sağlar: modül dosyası var mı, adlandırılmış dışa aktarım gerçekten bildirilmiş mi, bildirilen üretim çağıranları o dışa aktarımı gerçekten anıyor mu, CI kanıtı hangi sınıf (REAL/FAKE_ONLY/...), yoklama durumu ne. Yoklamalar varsayılan NOT_OBSERVED'dır; hiçbir ikili kurulmaz ve çalıştırılmaz (yalnız dosya okunur). Harita C-RDY-1'in TOOL_READY girdisini (AdapterRealityEntry) üretir; kayıt defterinin implementation alanı HİÇBİR ZAMAN kanıt sayılmaz. Uzlaştırma yalnız RAPOR üretir; registries/** düzenlenmez.
import fs from "node:fs";
import path from "node:path";
import type {AdapterRealityEntry} from "../agents/readiness-audit.js";

// //TR: CI kanıt sınıfı: REAL = bir iş akışı adımı aracı gerçekten çalıştırır (ciTokens iş akışı metninde bulunmalıdır); FAKE_ONLY = CI yalnız sahte uygulamayı çalıştırır; FAKE_BINARY_ONLY = gerçek sarmalayıcı sahte bir ikiliyle sınanır; HARNESS_NOT_CI = yalnız elle/yerel koşan bir koşum; DISCOVERY_ONLY = yalnız bulunur, hiç çalıştırılmaz; IN_PROCESS_RUNTIME = süreç içi gerçek kod (ikili yok); RUNTIME_PREREQUISITE = ana makine ön koşulu, hiçbir iş akışı adımı onu doğrulamaz.
export type CiEvidence = "REAL" | "FAKE_ONLY" | "FAKE_BINARY_ONLY" | "HARNESS_NOT_CI" | "DISCOVERY_ONLY" | "IN_PROCESS_RUNTIME" | "RUNTIME_PREREQUISITE";
export type ProbeObservation = "READY" | "FAILED";
// //TR: REGISTRY = registries/tool-adapters.json kimliği; UNREGISTERED = kodda gerçek ama kayıtta olmayan araç; BINDING = FIRST_DELIVERY_BINDINGS adaptör mantıksal kimliği.
export type RealityOrigin = "REGISTRY" | "UNREGISTERED" | "BINDING";
// //TR: EXPORT = TS/JS modülünde bildirilmiş adlandırılmış dışa aktarım; NPM_PACKAGE = node_modules paketi; SCRIPT_LITERAL = içe aktarılamayan betik (çalıştırır): dosya var ve dışa aktarım adı olarak verilen metin geçiyor.
export type VerifyMode = "EXPORT" | "NPM_PACKAGE" | "SCRIPT_LITERAL";

export interface ProductionCaller { file: string; references: string }
export interface AdapterRealityRecord {
  adapterId: string; origin: RealityOrigin; module: string; mode: VerifyMode; exportName: string; member?: string;
  // //TR: runs=false: kod yalnız bulur/hazırlar, üretimde aracı ÇALIŞTIRMAZ (semgrep). entrypoint=true: modül kendisi çalıştırılan girişdir (betik), içe aktaran çağıran aranmaz.
  runs: boolean; entrypoint?: boolean; callers: readonly ProductionCaller[]; ciEvidence: CiEvidence; ciTokens?: readonly string[]; note: string;
}

const caller = (file: string, references: string): ProductionCaller => ({file, references});
const SEC = "core/workos/security-tools.ts", EXE = "core/workos/executors.ts", RUN = "core/workos/runner.ts", SRV = "apps/control-api/src/server.ts";
const AJV_CALLERS = ["apps/control-api/src/routes/analysis.ts", "apps/control-api/src/routes/memory.ts", "apps/control-api/src/routes/predev-decisions.ts", "apps/control-api/src/routes/product-run.ts", "apps/control-api/src/routes/task-runs.ts", "apps/control-api/src/routes/tasks.ts", "core/workos/intake.ts", "core/workos/plan.ts", "core/workos/schemas.ts"];
const PREDEV_NOTE = "ClaudePreDevBuilder is created by LocalClaudeExecutors for the pre-dev produce stage; one class serves the five artefact kinds";

// //TR: Kod destekli harita. Her kayıt tek satırdır; bildirilen her çağıran dosyada gerçekten geçen bir metin olmalıdır (stale bildirim testte yakalanır).
export const ADAPTER_REALITY_RECORDS: readonly AdapterRealityRecord[] = [
  {adapterId: "gitleaks", origin: "REGISTRY", module: SEC, mode: "EXPORT", exportName: "runGitleaks", runs: true, callers: [caller(RUN, "runGitleaks(")], ciEvidence: "FAKE_BINARY_ONLY", note: "secret scan wrapper; CI drives it with a fake gitleaks binary script, never the real tool"},
  {adapterId: "trivy", origin: "REGISTRY", module: SEC, mode: "EXPORT", exportName: "runTrivy", runs: true, callers: [caller(RUN, "runTrivy(")], ciEvidence: "FAKE_ONLY", note: "vulnerability scan wrapper; CI runs only the fake, never the real tool"},
  {adapterId: "semgrep", origin: "REGISTRY", module: SEC, mode: "EXPORT", exportName: "discoverSecurityTools", runs: false, callers: [caller(RUN, "discoverSecurityTools(")], ciEvidence: "DISCOVERY_ONLY", note: "the toolset is discovered and reported but no semgrep scan is ever run"},
  {adapterId: "ajv", origin: "REGISTRY", module: "ajv", mode: "NPM_PACKAGE", exportName: "default", runs: true, callers: AJV_CALLERS.map(f => caller(f, "from \"ajv\"")), ciEvidence: "IN_PROCESS_RUNTIME", note: "in-process JSON schema validation in the control API and Work OS; core/qa/api/strict-json-validator.ts is test-only"},
  {adapterId: "ajv-formats", origin: "REGISTRY", module: "ajv-formats", mode: "NPM_PACKAGE", exportName: "default", runs: true, callers: ["apps/control-api/src/routes/memory.ts", "core/workos/schemas.ts"].map(f => caller(f, "from \"ajv-formats\"")), ciEvidence: "IN_PROCESS_RUNTIME", note: "format keywords for the in-process validators"},
  {adapterId: "playwright", origin: "REGISTRY", module: "scripts/e2e/desktop-journey.e2e.mjs", mode: "SCRIPT_LITERAL", exportName: "_electron", runs: true, entrypoint: true, callers: [], ciEvidence: "HARNESS_NOT_CI", note: "Electron desktop journey harness; run by hand/locally, no workflow runs it"},
  {adapterId: "git", origin: "UNREGISTERED", module: "core/workos/git-async.ts", mode: "EXPORT", exportName: "runGitAsync", runs: true, callers: [caller(RUN, "runGitAsync(")], ciEvidence: "RUNTIME_PREREQUISITE", note: "real git on the host (also automation/lib/git-isolation.mjs); not in registries/tool-adapters.json"},
  {adapterId: "npm", origin: "UNREGISTERED", module: "automation/lib/dependency-install.mjs", mode: "EXPORT", exportName: "ensureDependencies", runs: true, callers: [caller("scripts/ensure-dependencies.mjs", "ensureDependencies(")], ciEvidence: "RUNTIME_PREREQUISITE", note: "dependency install through npm; not in registries/tool-adapters.json"},
  {adapterId: "node", origin: "UNREGISTERED", module: EXE, mode: "EXPORT", exportName: "runNodeScript", runs: true, callers: [caller("core/workos/executor-setup.ts", "runNodeScript(")], ciEvidence: "REAL", ciTokens: ["node scripts/run-validation.mjs"], note: "UASCO's own node scripts run through runNodeScript; CI runs node steps; not in registries/tool-adapters.json"},
  {adapterId: "claude-cli", origin: "UNREGISTERED", module: "scripts/claude-builder-broker.mjs", mode: "SCRIPT_LITERAL", exportName: "brokerPlan", runs: true, callers: [caller(EXE, "claude-builder-broker.mjs")], ciEvidence: "FAKE_ONLY", note: "the local Claude CLI behind the broker script; CI never starts the real CLI; not in registries/tool-adapters.json"},
  {adapterId: "local-claude-implementer", origin: "BINDING", module: EXE, mode: "EXPORT", exportName: "EditOnlyImplementer", runs: true, callers: [caller(EXE, "new EditOnlyImplementer("), caller(SRV, "new LocalClaudeExecutors(")], ciEvidence: "FAKE_ONLY", note: "implementer built by LocalClaudeExecutors.pair(); CI uses FakeExecutors"},
  {adapterId: "local-claude-reviewer", origin: "BINDING", module: EXE, mode: "EXPORT", exportName: "LocalClaudeExecutors", member: "pair", runs: true, callers: [caller(SRV, "new LocalClaudeExecutors(")], ciEvidence: "FAKE_ONLY", note: "reviewer adapter is created inside LocalClaudeExecutors.pair(); CI uses FakeExecutors"},
  {adapterId: "workos-runner", origin: "BINDING", module: RUN, mode: "EXPORT", exportName: "MissionRunner", runs: true, callers: [caller(SRV, "new MissionRunner(")], ciEvidence: "IN_PROCESS_RUNTIME", note: "the real MissionRunner runs in tests with fake executors"},
  {adapterId: "workos-security-stage", origin: "BINDING", module: RUN, mode: "EXPORT", exportName: "MissionRunner", member: "stepSecurity", runs: true, callers: [caller(RUN, "this.stepSecurity(")], ciEvidence: "FAKE_BINARY_ONLY", note: "the SECURITY step; its gitleaks/trivy runs are driven with fakes in CI"},
  {adapterId: "workos-predev-business-analysis", origin: "BINDING", module: "core/workos/predev/claude-builder.ts", mode: "EXPORT", exportName: "ClaudePreDevBuilder", runs: true, callers: [caller(EXE, "new ClaudePreDevBuilder(")], ciEvidence: "FAKE_ONLY", note: PREDEV_NOTE},
  {adapterId: "workos-predev-requirements", origin: "BINDING", module: "core/workos/predev/claude-builder.ts", mode: "EXPORT", exportName: "ClaudePreDevBuilder", runs: true, callers: [caller(EXE, "new ClaudePreDevBuilder(")], ciEvidence: "FAKE_ONLY", note: PREDEV_NOTE},
  {adapterId: "workos-predev-uxspec", origin: "BINDING", module: "core/workos/predev/claude-builder.ts", mode: "EXPORT", exportName: "ClaudePreDevBuilder", runs: true, callers: [caller(EXE, "new ClaudePreDevBuilder(")], ciEvidence: "FAKE_ONLY", note: PREDEV_NOTE},
  {adapterId: "workos-predev-plan", origin: "BINDING", module: "core/workos/predev/claude-builder.ts", mode: "EXPORT", exportName: "ClaudePreDevBuilder", runs: true, callers: [caller(EXE, "new ClaudePreDevBuilder(")], ciEvidence: "FAKE_ONLY", note: PREDEV_NOTE},
  {adapterId: "workos-predev-architecture", origin: "BINDING", module: "core/workos/predev/claude-builder.ts", mode: "EXPORT", exportName: "ClaudePreDevBuilder", runs: true, callers: [caller(EXE, "new ClaudePreDevBuilder(")], ciEvidence: "FAKE_ONLY", note: PREDEV_NOTE},
  {adapterId: "project-studio-prepare-run-delivery", origin: "BINDING", module: "core/workos/project-studio.ts", mode: "EXPORT", exportName: "ProjectStudio", member: "prepareRunDelivery", runs: true, callers: [caller(SRV, "prepareRunDelivery("), caller("core/workos/crew/dev-review.ts", "studio.prepareRunDelivery(")], ciEvidence: "IN_PROCESS_RUNTIME", note: "deterministic delivery preparation, no model"}
];

export interface RecordVerification {
  adapterId: string; moduleExists: boolean; exportDeclared: boolean; verifiedCallers: number; failedCallers: readonly string[];
  codePath: AdapterRealityEntry["codePath"]; reasons: readonly string[];
}

const readText = (file: string): string | null => { try { return fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : null; } catch { return null; } };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// //TR: Dışa aktarım bildirimi metin düzeyinde aranır (modül ÇALIŞTIRILMAZ, yan etki yok): `export [async] function|class|const|let|var NAME` ya da `export { ... NAME ... }`.
export function declaresExport(source: string, name: string): boolean {
  const n = escapeRe(name);
  return new RegExp(`^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${n}\\b`, "m").test(source) || new RegExp(`^export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`, "m").test(source);
}
// //TR: Üye (sınıf yöntemi) bildirimi: satır başında isteğe bağlı değiştiriciler, isteğe bağlı async, ad ve açılış parantezi.
export function declaresMember(source: string, member: string): boolean {
  return new RegExp(`^\\s*(?:(?:private|public|protected|static|readonly)\\s+)*(?:async\\s+)?${escapeRe(member)}\\s*[(<]`, "m").test(source);
}

// //TR: Bir kaydı doğrular: modül var, dışa aktarım (ve varsa üye) bildirilmiş, bildirilen çağıranlar o metni gerçekten anıyor. codePath PRESENT YALNIZ çalıştıran (runs) bir kayıt için, modül+dışa aktarım doğrulanmış VE (giriş betiği ya da en az bir üretim çağıranı doğrulanmış) ise.
export function verifyRecord(r: AdapterRealityRecord, repoRoot: string): RecordVerification {
  const reasons: string[] = [];
  let source: string | null;
  let moduleExists: boolean;
  if (r.mode === "NPM_PACKAGE") { moduleExists = readText(path.join(repoRoot, "node_modules", r.module, "package.json")) !== null; source = null; }
  else { source = readText(path.join(repoRoot, r.module)); moduleExists = source !== null; }
  if (!moduleExists) reasons.push("MODULE_MISSING");
  let exportDeclared = false;
  if (moduleExists) {
    if (r.mode === "NPM_PACKAGE") exportDeclared = true;
    else if (r.mode === "SCRIPT_LITERAL") exportDeclared = source!.includes(r.exportName);
    else exportDeclared = declaresExport(source!, r.exportName) && (r.member === undefined || declaresMember(source!, r.member));
    if (!exportDeclared) reasons.push("EXPORT_NOT_DECLARED");
  }
  const failedCallers: string[] = [];
  let verifiedCallers = 0;
  for (const c of r.callers) {
    const text = readText(path.join(repoRoot, c.file));
    if (text !== null && text.includes(c.references)) verifiedCallers++;
    else failedCallers.push(`${c.file}:${c.references}`);
  }
  if (failedCallers.length > 0) reasons.push("CALLER_NOT_FOUND");
  if (!r.runs) reasons.push("NEVER_RUNS_IN_PRODUCTION");
  const callerOk = r.entrypoint === true || verifiedCallers >= 1;
  if (!callerOk) reasons.push("NO_PRODUCTION_CALLER");
  const codePath = r.runs && moduleExists && exportDeclared && callerOk ? "PRESENT" : "ABSENT";
  return {adapterId: r.adapterId, moduleExists, exportDeclared, verifiedCallers, failedCallers, codePath, reasons};
}

// //TR: Harita girdisi: kayıtlar doğrulanır; yoklama varsayılanı NOT_OBSERVED'dır (gözlem yalnız çağıranın verdiği probes ile gelir, hiçbir şey çalıştırılmaz).
export function buildAdapterRealityMap(i: {records: readonly AdapterRealityRecord[]; repoRoot: string; probes?: ReadonlyMap<string, ProbeObservation>}): {entries: ReadonlyMap<string, AdapterRealityEntry>; verifications: ReadonlyMap<string, RecordVerification>} {
  const entries = new Map<string, AdapterRealityEntry>(), verifications = new Map<string, RecordVerification>();
  for (const r of i.records) {
    if (entries.has(r.adapterId)) throw new Error(`ADAPTER_REALITY_DUPLICATE_ID:${r.adapterId}`);
    const v = verifyRecord(r, i.repoRoot);
    verifications.set(r.adapterId, v);
    entries.set(r.adapterId, {adapterId: r.adapterId, codePath: v.codePath, probe: i.probes?.get(r.adapterId) ?? "NOT_OBSERVED"});
  }
  return {entries, verifications};
}

export type RealityFinding = "UNDER_REPORTED" | "OVER_REPORTED" | "UNREGISTERED_REAL" | "DEAD_CODE" | "ADAPTER_UNRESOLVED";
export interface RegistryAdapterRow { id: string; category: string; status: string; implementation: string }
export interface RealityFindingRow { finding: RealityFinding; id: string; detail: string }
export interface DeadCodeProbe { module: string; exports: readonly string[]; importerSpec: string }
export interface DeadCodeResult { module: string; exports: readonly string[]; importers: readonly string[] }
export interface AdapterReconciliation {
  registry: {total: number; defined: number; implemented: number};
  codeBackedRegistryIds: readonly string[]; unregisteredReal: readonly string[]; deadCode: readonly string[]; unresolvedBindingAdapters: readonly string[];
  findings: readonly RealityFindingRow[]; counts: Readonly<Record<RealityFinding, number>>;
}

// //TR: Ölü kod adayları: dışa aktarımı olan ama hiçbir ÜRETİM dosyasının içe aktarmadığı modüller. Yetenek çözümleyicisinin şu an üretim içe aktaranı yoktur (testler üretim sayılmaz).
export const DEAD_CODE_PROBES: readonly DeadCodeProbe[] = [{module: "core/capabilities/resolver.ts", exports: ["resolveCapability", "resolveCapabilityFromReality"], importerSpec: "capabilities/resolver"}];
const PRODUCTION_ROOTS = ["apps", "core", "scripts", "automation"];
const SOURCE_EXT = /\.(?:ts|mts|mjs|cjs|js)$/;
function listSources(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listSources(p, out); else if (e.isFile() && SOURCE_EXT.test(e.name)) out.push(p);
  }
  return out;
}
// //TR: Yorum satırları (// ve * ile başlayan) içe aktarma sayılmaz: yorumdaki bir `from "..."` üretim kullanımı DEĞİLDİR.
const withoutCommentLines = (text: string): string => text.split("\n").filter(l => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).join("\n");
// //TR: Üretim içe aktaranlar: apps/core/scripts/automation altında, modülün kendisi dışında, gerçek bir import/require/from ifadesiyle (dize değil) modülü anan dosyalar. tests/ ve docs/ taranmaz.
export function findProductionImporters(repoRoot: string, probe: DeadCodeProbe): string[] {
  const re = new RegExp(`(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*["'][^"']*${escapeRe(probe.importerSpec)}(?:\\.js|\\.ts)?["']`);
  const own = path.resolve(repoRoot, probe.module);
  const out: string[] = [];
  for (const root of PRODUCTION_ROOTS) for (const f of listSources(path.join(repoRoot, root))) {
    if (path.resolve(f) === own) continue;
    const text = readText(f);
    if (text !== null && re.test(withoutCommentLines(text))) out.push(path.relative(repoRoot, f).split(path.sep).join("/"));
  }
  return out.sort();
}

export function loadRegistryAdapters(repoRoot: string): RegistryAdapterRow[] {
  const rel = "registries/tool-adapters.json";
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
    const rows = doc?.adapters;
    if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r: unknown) => typeof (r as RegistryAdapterRow)?.id === "string" && typeof (r as RegistryAdapterRow)?.status === "string" && typeof (r as RegistryAdapterRow)?.implementation === "string")) throw new Error("shape");
    return rows as RegistryAdapterRow[];
  } catch { throw new Error(`ADAPTER_REGISTRY_UNAVAILABLE:${rel}`); }
}

// //TR: Uzlaştırma: kayıt defteri iddiası (implementation) ile KANITLANMIŞ kod yolu karşılaştırılır. Kod destekli ama kayıtta NOT_IMPLEMENTED = UNDER_REPORTED; kayıt uygulanmış diyor ama kod yolu yok = OVER_REPORTED; kodda gerçek ama kayıtta olmayan = UNREGISTERED_REAL; üretim içe aktaranı olmayan modül = DEAD_CODE; bağlamanın adaptör kimliği haritada yok = ADAPTER_UNRESOLVED. Yalnız rapor üretir.
export function reconcileAdapterReality(i: {registry: readonly RegistryAdapterRow[]; records: readonly AdapterRealityRecord[]; verifications: ReadonlyMap<string, RecordVerification>; bindingAdapterIds: readonly string[]; deadCode: readonly DeadCodeResult[]}): AdapterReconciliation {
  const findings: RealityFindingRow[] = [];
  const registryById = new Map(i.registry.map(r => [r.id, r] as const));
  const codeBacked = (id: string) => i.verifications.get(id)?.codePath === "PRESENT";
  const codeBackedRegistryIds: string[] = [], unregisteredReal: string[] = [];
  for (const r of i.records) {
    if (r.origin === "BINDING") continue;
    const row = registryById.get(r.adapterId);
    if (!row) { if (codeBacked(r.adapterId)) { unregisteredReal.push(r.adapterId); findings.push({finding: "UNREGISTERED_REAL", id: r.adapterId, detail: "real code path, no registry row"}); } continue; }
    const implemented = row.implementation !== "NOT_IMPLEMENTED";
    if (codeBacked(r.adapterId)) {
      codeBackedRegistryIds.push(r.adapterId);
      if (!implemented) findings.push({finding: "UNDER_REPORTED", id: r.adapterId, detail: `registry implementation ${row.implementation} but a verified code path exists`});
    } else if (implemented) findings.push({finding: "OVER_REPORTED", id: r.adapterId, detail: `registry implementation ${row.implementation} but no verified code path`});
  }
  // //TR: Kayıt defterinde uygulanmış görünen ama haritada hiç kaydı olmayan adaptör de OVER_REPORTED'dır (kod kanıtı yok).
  const mapped = new Set(i.records.map(r => r.adapterId));
  for (const row of i.registry) if (row.implementation !== "NOT_IMPLEMENTED" && !mapped.has(row.id)) findings.push({finding: "OVER_REPORTED", id: row.id, detail: `registry implementation ${row.implementation} but the adapter is not in the reality map`});
  const unresolved = [...new Set(i.bindingAdapterIds)].filter(id => !mapped.has(id)).sort();
  for (const id of unresolved) findings.push({finding: "ADAPTER_UNRESOLVED", id, detail: "binding adapter id has no reality-map record"});
  const deadCode: string[] = [];
  for (const d of i.deadCode) if (d.importers.length === 0) { deadCode.push(d.module); findings.push({finding: "DEAD_CODE", id: d.module, detail: `no production importer for ${d.exports.join(", ")}`}); }
  findings.sort((a, b) => (a.finding < b.finding ? -1 : a.finding > b.finding ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts: Record<RealityFinding, number> = {UNDER_REPORTED: 0, OVER_REPORTED: 0, UNREGISTERED_REAL: 0, DEAD_CODE: 0, ADAPTER_UNRESOLVED: 0};
  for (const f of findings) counts[f.finding]++;
  return {
    registry: {total: i.registry.length, defined: i.registry.filter(r => r.status === "REGISTERED").length, implemented: i.registry.filter(r => r.implementation !== "NOT_IMPLEMENTED").length},
    codeBackedRegistryIds: codeBackedRegistryIds.sort(), unregisteredReal: unregisteredReal.sort(), deadCode: deadCode.sort(), unresolvedBindingAdapters: unresolved, findings, counts
  };
}

// //TR: CI dürüstlüğü: ciEvidence REAL ise ciTokens'in her biri bir iş akışı metninde bulunmalıdır; bulunmuyorsa (ya da ciTokens yoksa) sorun döner. REAL olmayan kayıtlar için sorun üretilmez (iddia daha zayıftır).
export function ciEvidenceProblems(records: readonly AdapterRealityRecord[], workflowTexts: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (r.ciEvidence !== "REAL") continue;
    const tokens = r.ciTokens ?? [];
    if (tokens.length === 0) out.push(`${r.adapterId}:REAL_WITHOUT_CI_TOKENS`);
    for (const t of tokens) if (!workflowTexts.some(w => w.includes(t))) out.push(`${r.adapterId}:CI_TOKEN_NOT_IN_WORKFLOWS:${t}`);
  }
  return out;
}
export function readWorkflowTexts(repoRoot: string): string[] {
  const dir = path.join(repoRoot, ".github", "workflows");
  let names: string[];
  try { names = fs.readdirSync(dir).filter(n => /\.ya?ml$/.test(n)).sort(); } catch { return []; }
  return names.map(n => readText(path.join(dir, n))).filter((t): t is string => t !== null);
}

export interface AdapterRealityReport {
  entries: ReadonlyMap<string, AdapterRealityEntry>; verifications: ReadonlyMap<string, RecordVerification>;
  reconciliation: AdapterReconciliation; ciProblems: readonly string[]; deadCode: readonly DeadCodeResult[];
}
// //TR: Tek çağrıda harita + uzlaştırma + CI dürüstlüğü. bindingAdapterIds çağıran tarafından verilir (FIRST_DELIVERY_BINDINGS adaptörleri); bu modül çekirdek/ajan modüllerine değer olarak bağımlı olmaz.
export function buildAdapterRealityReport(repoRoot: string, o: {bindingAdapterIds: readonly string[]; probes?: ReadonlyMap<string, ProbeObservation>; records?: readonly AdapterRealityRecord[]}): AdapterRealityReport {
  const records = o.records ?? ADAPTER_REALITY_RECORDS;
  const {entries, verifications} = buildAdapterRealityMap({records, repoRoot, ...(o.probes ? {probes: o.probes} : {})});
  const deadCode = DEAD_CODE_PROBES.map(p => ({module: p.module, exports: p.exports, importers: findProductionImporters(repoRoot, p)}));
  const reconciliation = reconcileAdapterReality({registry: loadRegistryAdapters(repoRoot), records, verifications, bindingAdapterIds: o.bindingAdapterIds, deadCode});
  return {entries, verifications, reconciliation, ciProblems: ciEvidenceProblems(records, readWorkflowTexts(repoRoot)), deadCode};
}
