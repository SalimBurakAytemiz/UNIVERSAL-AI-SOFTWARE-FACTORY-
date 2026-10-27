// //TR: Bu dosya (C-RDY-2a) araç/adaptör kimliklerini (kayıt defteri kimlikleri VE bağlama mantıksal kimlikleri) gerçek koda bağlayan KOD DESTEKLİ bir harita ve kayıt-defteri-ile-kod uzlaştırması sağlar: modül dosyası var mı, adlandırılmış dışa aktarım gerçekten bildirilmiş mi, bildirilen üretim çağıranları o dışa aktarımı gerçekten anıyor mu, CI kanıtı hangi sınıf (REAL/FAKE_ONLY/...), yoklama durumu ne. Yoklamalar varsayılan NOT_OBSERVED'dır; hiçbir ikili kurulmaz ve çalıştırılmaz (yalnız dosya okunur). Harita C-RDY-1'in TOOL_READY girdisini (AdapterRealityEntry) üretir; kayıt defterinin implementation alanı HİÇBİR ZAMAN kanıt sayılmaz. Uzlaştırma yalnız RAPOR üretir; registries/** düzenlenmez.
import fs from "node:fs";
import path from "node:path";
import type {AdapterRealityEntry} from "../agents/readiness-audit.js";

// //TR: CI kanıt sınıfı: REAL = bir iş akışı adımı aracı gerçekten çalıştırır (ciTokens iş akışı metninde bulunmalıdır); REAL_WHEN_CONFIGURED = bir iş akışı adımı gerçek istemciyi gerçek hizmete karşı çalıştırır AMA yalnız bir kapı (tetikleyici olay, korumalı environment, gizli anahtar/değişken, taslak olmayan aynı depo PR'ı) açıkken; sıradan bir push'ta yeşil CI onun koştuğunu KANITLAMAZ (ciTokens yine iş akışı metninde bulunmalıdır); FAKE_ONLY = CI yalnız sahte uygulamayı çalıştırır; FAKE_BINARY_ONLY = gerçek sarmalayıcı sahte bir ikiliyle sınanır; HARNESS_NOT_CI = yalnız elle/yerel koşan bir koşum; DISCOVERY_ONLY = yalnız bulunur, hiç çalıştırılmaz; IN_PROCESS_RUNTIME = süreç içi gerçek kod (ikili yok); RUNTIME_PREREQUISITE = ana makine ön koşulu, hiçbir iş akışı adımı onu doğrulamaz.
export type CiEvidence = "REAL" | "REAL_WHEN_CONFIGURED" | "FAKE_ONLY" | "FAKE_BINARY_ONLY" | "HARNESS_NOT_CI" | "DISCOVERY_ONLY" | "IN_PROCESS_RUNTIME" | "RUNTIME_PREREQUISITE";
export type ProbeObservation = "READY" | "FAILED";
// //TR: REGISTRY = registries/tool-adapters.json kimliği; UNREGISTERED = kodda gerçek ama kayıtta olmayan araç; BINDING = FIRST_DELIVERY_BINDINGS adaptör mantıksal kimliği.
export type RealityOrigin = "REGISTRY" | "UNREGISTERED" | "BINDING";
// //TR: EXPORT = TS/JS modülünde bildirilmiş adlandırılmış dışa aktarım; NPM_PACKAGE = node_modules paketi; SCRIPT_LITERAL = içe aktarılamayan betik (çalıştırır): dosya var ve dışa aktarım adı olarak verilen ad betiğin KODUNDA (yorum ve dize dışında) geçiyor.
export type VerifyMode = "EXPORT" | "NPM_PACKAGE" | "SCRIPT_LITERAL";

// //TR: references yalnız KOD olarak sayılır: yorumlar ve dize içerikleri boşaltılmış görünümde aranır. literal=true ise references tırnaklı bir dize değişmezi içerir (içe aktarma belirteci ya da betik yolu): yorumlar yine boşaltılır, dize değişmezi gerçek tırnaklarla aranır; başka bir dizenin (ör. hata iletisinin) içindeki kopya eşleşmez.
export interface ProductionCaller { file: string; references: string; literal?: boolean }
export interface AdapterRealityRecord {
  adapterId: string; origin: RealityOrigin; module: string; mode: VerifyMode; exportName: string; member?: string;
  // //TR: runs bir İDDİADIR (elle verilir, çalışma zamanı kanıtı değildir): false = kod yalnız bulur/hazırlar, aracı ÇALIŞTIRMAZ (semgrep). entrypoint=true yalnız SCRIPT_LITERAL betikleri için geçerlidir (betiğin kendisi çalıştırılan giriştir, içe aktaran çağıran aranmaz); EXPORT kütüphanesinde entrypoint ENTRYPOINT_NOT_A_SCRIPT ile reddedilir.
  runs: boolean; entrypoint?: boolean; callers: readonly ProductionCaller[]; ciEvidence: CiEvidence; ciTokens?: readonly string[]; note: string;
}

const caller = (file: string, references: string): ProductionCaller => ({file, references});
// //TR: İçe aktarma çağıranı: `from "pkg"` dize değişmezi gerçek tırnaklarıyla aranır (yorumdaki ya da başka bir dizedeki kopya sayılmaz).
const importer = (file: string, spec: string): ProductionCaller => ({file, references: `from "${spec}"`, literal: true});
const SEC = "core/workos/security-tools.ts", EXE = "core/workos/executors.ts", RUN = "core/workos/runner.ts", SRV = "apps/control-api/src/server.ts";
// //TR: ajv / ajv-formats üretim içe aktaranlarının TAM listesi (test, findPackageImporters taramasıyla eşitliğini sınar). Dışarıda bırakılanlar testte gerekçesiyle sayılır: core/qa/api/strict-json-validator.ts (yalnız testler içe aktarır) ve scripts/runtime-schema-conformance-selftest.mjs (özdenetim betiği).
const AJV_CALLERS = [importer("apps/control-api/src/routes/analysis.ts", "ajv"), importer("apps/control-api/src/routes/memory.ts", "ajv"), importer("apps/control-api/src/routes/predev-decisions.ts", "ajv"), importer("apps/control-api/src/routes/product-run.ts", "ajv"), importer("apps/control-api/src/routes/task-runs.ts", "ajv"), importer("apps/control-api/src/routes/tasks.ts", "ajv"), importer("core/company/common.ts", "ajv"), importer("core/workos/intake.ts", "ajv"), importer("core/workos/plan.ts", "ajv"), importer("core/workos/schemas.ts", "ajv"), importer("automation/factory-supervisor.mjs", "ajv/dist/2020.js"), importer("automation/lib/review-pipeline.mjs", "ajv/dist/2020.js")];
const AJV_FORMATS_CALLERS = ["apps/control-api/src/routes/memory.ts", "core/company/common.ts", "core/workos/schemas.ts", "automation/factory-supervisor.mjs", "automation/lib/review-pipeline.mjs"].map(f => importer(f, "ajv-formats"));
const PREDEV_NOTE = "ClaudePreDevBuilder is created by LocalClaudeExecutors for the pre-dev produce stage; one class serves the five artefact kinds";

// //TR: Kod destekli harita. Her kayıt tek satırdır; bildirilen her çağıran dosyanın KODUNDA (yorum/dize dışında) gerçekten geçen bir ifade olmalıdır (stale bildirim testte yakalanır). `runs` elle verilen bir İDDİADIR; PRESENT "modül+dışa aktarım metinsel olarak bildirilmiş ve bir üretim çağıranı kodda var" demektir, çalışma zamanı kanıtı DEĞİLDİR.
export const ADAPTER_REALITY_RECORDS: readonly AdapterRealityRecord[] = [
  {adapterId: "gitleaks", origin: "REGISTRY", module: SEC, mode: "EXPORT", exportName: "runGitleaks", runs: true, callers: [caller(RUN, "runGitleaks(")], ciEvidence: "FAKE_BINARY_ONLY", note: "secret scan wrapper; CI drives it with a fake gitleaks binary script, never the real tool"},
  {adapterId: "trivy", origin: "REGISTRY", module: SEC, mode: "EXPORT", exportName: "runTrivy", runs: true, callers: [caller(RUN, "runTrivy(")], ciEvidence: "FAKE_ONLY", note: "vulnerability scan wrapper; CI runs only the fake, never the real tool"},
  {adapterId: "semgrep", origin: "REGISTRY", module: SEC, mode: "EXPORT", exportName: "discoverSecurityTools", runs: false, callers: [caller(RUN, "discoverSecurityTools(")], ciEvidence: "DISCOVERY_ONLY", note: "the toolset is discovered and reported but no semgrep scan is ever run"},
  {adapterId: "ajv", origin: "REGISTRY", module: "ajv", mode: "NPM_PACKAGE", exportName: "default", runs: true, callers: AJV_CALLERS, ciEvidence: "IN_PROCESS_RUNTIME", note: "in-process JSON schema validation in the control API, Work OS, company core and the factory supervisor; core/qa/api/strict-json-validator.ts has only test importers"},
  {adapterId: "ajv-formats", origin: "REGISTRY", module: "ajv-formats", mode: "NPM_PACKAGE", exportName: "default", runs: true, callers: AJV_FORMATS_CALLERS, ciEvidence: "IN_PROCESS_RUNTIME", note: "format keywords for the in-process validators"},
  {adapterId: "github", origin: "REGISTRY", module: "scripts/ci/uasco-review/github.mjs", mode: "EXPORT", exportName: "client", runs: true, callers: [caller("scripts/ci/uasco-review/run.mjs", "client(")], ciEvidence: "REAL_WHEN_CONFIGURED", ciTokens: ["node scripts/ci/uasco-review/run.mjs scope"], note: "GitHub REST client of the independent-review workflow (pull_request_target/workflow_dispatch, environment uasco-review, non-draft same-repo PRs only, so an ordinary push does not exercise it); gh CLI wrappers (command-contracts gh.exe, verify-remote-protection.mjs, configure-github-protection.mjs) are separate host-tool uses"},
  {adapterId: "playwright", origin: "REGISTRY", module: "scripts/e2e/desktop-journey.e2e.mjs", mode: "SCRIPT_LITERAL", exportName: "_electron", runs: true, entrypoint: true, callers: [], ciEvidence: "HARNESS_NOT_CI", note: "Electron desktop journey harness; run by hand/locally, no workflow runs it"},
  {adapterId: "omniroute", origin: "REGISTRY", module: "scripts/discover-omniroute-models.mjs", mode: "SCRIPT_LITERAL", exportName: "fetch", runs: false, entrypoint: true, callers: [], ciEvidence: "DISCOVERY_ONLY", note: "model-gateway discovery: one policy-gated GET <gateway>/models with the OMNIROUTE_API_KEY bearer, run by hand, writes .ai/runtime/OMNIROUTE_MODELS.json; no production code routes a model call through OmniRoute; models/omniroute/client.ts (discoverOmniRouteModels) is outside the scanned roots and imported by nothing; scripts/ensure-omniroute.ps1 (installer, PowerShell, outside the scanned sources) starts the launcher"},
  {adapterId: "git", origin: "UNREGISTERED", module: "core/workos/git-async.ts", mode: "EXPORT", exportName: "runGitAsync", runs: true, callers: [caller(RUN, "runGitAsync(")], ciEvidence: "RUNTIME_PREREQUISITE", note: "real git on the host (also automation/lib/git-isolation.mjs); not in registries/tool-adapters.json"},
  {adapterId: "npm", origin: "UNREGISTERED", module: "automation/lib/dependency-install.mjs", mode: "EXPORT", exportName: "ensureDependencies", runs: true, callers: [caller("scripts/ensure-dependencies.mjs", "ensureDependencies(")], ciEvidence: "REAL", ciTokens: ["node scripts/ensure-dependencies.mjs"], note: "dependency install (npm ci) through ensureDependencies; ci.yml and windows-installer.yml run scripts/ensure-dependencies.mjs; not in registries/tool-adapters.json"},
  {adapterId: "node", origin: "UNREGISTERED", module: EXE, mode: "EXPORT", exportName: "runNodeScript", runs: true, callers: [caller("core/workos/executor-setup.ts", "runNodeScript(")], ciEvidence: "REAL", ciTokens: ["node scripts/run-validation.mjs"], note: "UASCO's own node scripts run through runNodeScript; CI runs node steps; not in registries/tool-adapters.json"},
  {adapterId: "claude-cli", origin: "UNREGISTERED", module: "scripts/claude-builder-broker.mjs", mode: "SCRIPT_LITERAL", exportName: "brokerPlan", runs: true, callers: [{file: EXE, references: "path.join(self.repoRoot, \"scripts\", \"claude-builder-broker.mjs\")", literal: true}], ciEvidence: "FAKE_ONLY", note: "the local Claude CLI behind the broker script; CI never starts the real CLI; not in registries/tool-adapters.json"},
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

// //TR: Kaynak tarayıcısı (modül ÇALIŞTIRILMAZ, yan etki yok). İki görünüm üretir, ikisi de kaynakla AYNI uzunlukta ve aynı satır sayısındadır: code = yorumlar ve dize/şablon/regex İÇERİKLERİ boşluğa çevrilmiş (tırnaklar kalır); literal = yorumlar boşluğa çevrilmiş, dize içerikleri korunmuş ama içlerindeki tırnak karakterleri \u0001 yapılmış (başka bir dizenin içindeki `from "x"` gerçek bir içe aktarma gibi eşleşemez). Dize/şablon/yorum/regex kapanmadan biterse null döner: sınıflandırılamayan kaynak hiçbir şeyi KANITLAMAZ.
export interface CodeViews { code: string; literal: string }
const nl = (c: string) => (c === "\n" || c === "\r" ? c : " ");
// //TR: Tanımlayıcı karakteri (ID_Continue yaklaşığı): harf, sayı, birleşen işaret (\p{M}), bağlayıcı noktalama (\p{Pc}, `_` dahil), `$` ve ZWNJ/ZWJ (U+200C/U+200D). Test, TEK kod noktasına uygulanır; UTF-16 yedek çiftleri (astral tanımlayıcılar) identStart ile birleştirilir.
const IDENT_CHAR = /[\p{L}\p{N}\p{M}\p{Pc}_$\u200C\u200D]/u;
// //TR: `arr[k]` bir tanımlayıcı karakterin SON UTF-16 birimiyse o karakterin başlangıç dizinini döndürür (yedek çift: k-1), değilse -1. Dizi de dize de olabilir.
const identStart = (arr: ArrayLike<string>, k: number): number => {
  if (k < 0) return -1;
  const u = arr[k];
  if (u >= "\uDC00" && u <= "\uDFFF" && arr[k - 1] >= "\uD800" && arr[k - 1] <= "\uDBFF") return IDENT_CHAR.test(arr[k - 1] + u) ? k - 1 : -1;
  return IDENT_CHAR.test(u) ? k : -1;
};
// //TR: `arr[k]` ile biten tanımlayıcı sözcüğün başlangıç dizini (k bir tanımlayıcı karakterse), değilse -1.
const wordStart = (arr: ArrayLike<string>, k: number): number => {
  let first = identStart(arr, k);
  if (first < 0) return -1;
  for (;;) { if (first === 0) return 0; const prev = identStart(arr, first - 1); if (prev < 0) return first; first = prev; }
};
// //TR: Sözcük, bir `.`/`?.` ile geliyorsa (nesne.new) özellik adıdır, anahtar sözcük değildir.
const afterDot = (arr: ArrayLike<string>, start: number): boolean => { let q = start - 1; while (q >= 0 && /\s/.test(arr[q])) q--; return q >= 0 && arr[q] === "."; };
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await", "instanceof"]);
export function codeViews(src: string): CodeViews | null {
  const n = src.length, code: string[] = [], lit: string[] = [];
  const body = (c: string) => { code.push(nl(c)); lit.push(c === "\"" || c === "'" || c === "`" ? "\u0001" : c); };
  const plain = (c: string) => { code.push(c); lit.push(c); };
  const blank = (c: string) => { code.push(nl(c)); lit.push(nl(c)); };
  // //TR: `/` bölme mi regex mi? Öncesindeki anlamlı karaktere bakılır: tanımlayıcı (Unicode, birleşen işaret ve astral dahil) bir anahtar sözcükse (return, typeof ...) ve `.` ile gelen bir özellik adı DEĞİLSE regex; `)` `]` dize kapanışı ve art arda `++`/`--` bölmedir; `if/while/for/with (...)` BAŞLIĞININ `)`'si bölme DEĞİL regex başlatır; TS `!`: bir tanımlayıcıdan (anahtar sözcük değilse), `)` ya da `]`'den sonra (aynı satırda boşlukla ayrılmış olsa da: `x !/ 2`) sonek non-null'dır ve `/` bölmedir, başka her yerde önek NOT'tur (`= !/a/.test(y)`) ve `/` regex'tir; diğer noktalama regex başlatır. Bilinen sınır (PRESENT yönü): bir blok `}` sonrası satır başındaki regex bölme sayılır.
  const wordBefore = (k: number): {word: string; start: number} | null => { const st = wordStart(code, k); return st < 0 ? null : {word: code.slice(st, k + 1).join(""), start: st}; };
  const regexAllowed = (): boolean => {
    let k = code.length - 1;
    while (k >= 0 && /\s/.test(code[k])) k--;
    if (k < 0) return true;
    const p = code[k];
    const w = wordBefore(k);
    if (w !== null) return !afterDot(code, w.start) && REGEX_KEYWORDS.has(w.word);
    if ((p === "+" || p === "-") && code[k - 1] === p) return false;
    if (p === "!") {
      let q = k - 1;
      while (q >= 0 && (code[q] === " " || code[q] === "\t")) q--;
      if (code[q] === ")" || code[q] === "]") return false;
      const before = wordBefore(q);
      if (before === null) return true;
      return !afterDot(code, before.start) && REGEX_KEYWORDS.has(before.word);
    }
    if (p === ")") return k === controlClose;
    return !(p === "]" || p === "\"" || p === "'" || p === "`");
  };
  // //TR: `(` açılışında önceki sözcük if/while/for/with ise o parantez bir kontrol BAŞLIĞIDIR; kapanışının kod dizinini `controlClose` tutar.
  const parens: boolean[] = [];
  let controlClose = -1;
  const controlHeader = (): boolean => { let k = code.length - 1; while (k >= 0 && /\s/.test(code[k])) k--; const w = wordBefore(k); return w !== null && !afterDot(code, w.start) && (w.word === "if" || w.word === "while" || w.word === "for" || w.word === "with"); };
  const frames: number[] = [];
  let depth = 0, inTpl = false, i = 0;
  if (src.startsWith("#!")) while (i < n && src[i] !== "\n") blank(src[i++]);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (inTpl) {
      if (c === "\\") { body(c); i++; if (i < n) body(src[i++]); continue; }
      if (c === "`") { plain(c); i++; inTpl = false; continue; }
      if (c === "$" && d === "{") { plain("$"); plain("{"); i += 2; frames.push(depth); depth = 0; inTpl = false; continue; }
      body(c); i++; continue;
    }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") blank(src[i++]); continue; }
    if (c === "/" && d === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return null; for (; i < end + 2; i++) blank(src[i]); continue; }
    if (c === "\"" || c === "'") {
      plain(c); i++;
      // //TR: Kaçışlı satır sonu (satır devamı) dizeyi bitirmez; CRLF kaynaklarda `\\` + CR + LF üçlüsü birlikte tüketilir.
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") { body(src[i++]); if (i < n) { const e = src[i++]; body(e); if (e === "\r" && src[i] === "\n") body(src[i++]); } continue; }
        if (src[i] === "\n") return null;
        body(src[i++]);
      }
      if (i >= n) return null;
      plain(c); i++; continue;
    }
    if (c === "`") { plain(c); i++; inTpl = true; continue; }
    if (c === "/" && regexAllowed()) {
      let j = i + 1, cls = false, ok = false;
      for (; j < n && src[j] !== "\n"; j++) { const e = src[j]; if (e === "\\") { j++; continue; } if (e === "[") cls = true; else if (e === "]") cls = false; else if (e === "/" && !cls) { ok = true; break; } }
      if (ok) { plain("/"); for (let k = i + 1; k < j; k++) body(src[k]); plain("/"); i = j + 1; continue; }
    }
    if (c === "(") parens.push(controlHeader());
    else if (c === ")") { if (parens.pop() === true) controlClose = code.length; }
    if (c === "{") depth++;
    else if (c === "}") { if (depth === 0 && frames.length > 0) { plain("}"); depth = frames.pop()!; inTpl = true; i++; continue; } depth--; }
    plain(c); i++;
  }
  return inTpl || frames.length > 0 ? null : {code: code.join(""), literal: lit.join("")};
}
// //TR: Bir ifade yalnız tam sözcük olarak aranır (başı/sonu sözcük karakteriyse sınır koşulu eklenir; `runGitleaks(` gibi ifadelerde sondaki parantez sınırdır).
const tokenRe = (t: string, flags = "") => new RegExp(`${/^[\p{L}\p{N}_$]/u.test(t) ? "(?<![\\p{L}\\p{N}_$])" : ""}${escapeRe(t)}${/[\p{L}\p{N}_$]$/u.test(t) ? "(?![\\p{L}\\p{N}_$])" : ""}`, `u${flags}`);

// //TR: Dışa aktarım bildirimi KOD görünümünde aranır: `export [default] [async] function|class|const|let|var NAME` ya da `export [type] { a, b as c }` (yalnız DIŞA AKTARILAN ad sayılır: `f as g` için g, f DEĞİL). Yorumdaki ya da dizedeki `export ...` bildirim değildir.
export function declaresExport(source: string, name: string): boolean { return exportIn(codeViews(source), name); }
function exportIn(v: CodeViews | null, name: string): boolean {
  if (v === null) return false;
  if (new RegExp(`^export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${escapeRe(name)}(?![\\p{L}\\p{N}_$])`, "mu").test(v.code)) return true;
  for (const m of v.code.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) { const names = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/); if ((names[1] ?? names[0]).trim() === name) return true; }
  }
  return false;
}
// //TR: Sınıf gövdesinin YALNIZ en üst düzey (süslü derinlik 1) metni; iç içe bloklar boşaltılır ve kapanışları bir `;` sınırı olarak kalır; çok satırlı alan başlatıcılarının devam satırları üye sayılmaz çünkü üye bildirimi bir önceki bildirimin sonundan sonra başlamalıdır (memberIn). Böylece gövdedeki çağrılar üye bildirimi sanılmaz. Sınıf başlığı satır başında aranır (`const x = class K` ya da yorum/dize içindeki `class K` değil).
function classBodyTopLevel(code: string, className: string): string | null {
  const m = new RegExp(`^[ \\t]*(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+${escapeRe(className)}(?![\\p{L}\\p{N}_$])`, "mu").exec(code);
  if (m === null) return null;
  const open = code.indexOf("{", m.index + m[0].length);
  if (open < 0) return null;
  let depth = 0, out = "";
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") { depth++; out += " "; continue; }
    if (ch === "}") { depth--; if (depth === 0) return out; out += depth === 1 ? ";" : " "; continue; }
    if (depth !== 1) { out += nl(ch); continue; }
    out += ch;
  }
  return null;
}
// //TR: Üye (sınıf yöntemi) bildirimi AİT OLDUĞU sınıfın gövdesinde aranır (başka sınıftaki aynı ad sayılmaz): satır başında isteğe bağlı değiştiriciler, isteğe bağlı async, ad ve açılış parantezi.
export function declaresMember(source: string, className: string, member: string): boolean { return memberIn(codeViews(source), className, member); }
function memberIn(v: CodeViews | null, className: string, member: string): boolean {
  const top = v === null ? null : classBodyTopLevel(v.code, className);
  if (top === null) return false;
  // //TR: Üye bildirimi bir DEVAM satırı değilse sayılır (bkz. memberContinues): `x =\n pair(a)`, `reviewer = new\n pair(cfg)`, `x = a >\n pair()` gibi satırlar bir önceki ifadenin devamıdır; `{ } ; ) ]`, ASI ile biten alan `x = 1`, çıplak dekoratör `@dec`, tipli alan `m: Map<string, number>` ve sonek non-null `x = y!` yeni bir bildirim başlatır. Bilinen sınırlar (ABSENT yönü): düzenli ifade değişmezi (`/a/`) ile biten alandan sonraki üye, adı `new`/`in`/`as` gibi bir anahtar sözcük olan alandan (`static new`) sonraki üye, satıra bölünmüş genel tip (`Map<\n string>`) ve işlev tipli alan (`cb: () => Map<A, B>`) gözden kaçar.
  const re = new RegExp(`^[ \\t]*(?:(?:private|public|protected|static|readonly)\\s+)*(?:async\\s+)?${escapeRe(member)}\\s*[(<]`, "gm");
  for (const m of top.matchAll(re)) {
    let k = m.index! - 1;
    while (k >= 0 && /\s/.test(top[k])) k--;
    if (k < 0 || !memberContinues(top, k)) return true;
  }
  return false;
}
// //TR: Önceki anlamlı karakter (dizin k) bir ifadeyi SÜRDÜRÜR mu? İşleçler `= ( , [ ? : * / % & | ^ . < ~` ve `=>`; tek `+`/`-` (art arda `++`/`--` sonektir, devam DEĞİL); `>`/`>>`/`>>>` karşılaştırma ya da kaydırmadır, YALNIZ bir `:` tip açıklamasından sonra açılan `<`'yi kapatıyorsa (`m: Map<string, number>`) bildirim sonudur; `!` önek NOT ise (işleç, `(`, `,`, `=` ya da satır başından sonra, ya da `await !`) devamdır, tanımlayıcı/`)`/`]` sonrası sonek non-null ise değildir; sözcük işleçleri new, typeof, void, delete, in, instanceof, await, yield, as, satisfies, keyof (bir `.`'dan sonra gelen özellik adı OLMADIKÇA: `obj.new`); `void` bir tip açıklamasında (`cb: () => void`) tiptir, devam değildir.
const CONTINUATION_WORDS: ReadonlySet<string> = new Set(["new", "typeof", "void", "delete", "in", "instanceof", "await", "yield", "as", "satisfies", "keyof"]);
function memberContinues(top: string, k: number): boolean {
  const p = top[k];
  if (p === "+" || p === "-") return top[k - 1] !== p;
  if ("=(,[?:*/%&|^.<~".includes(p)) return true;
  if (p === ">") return top[k - 1] === "=" || !closesTypeAngle(top, k);
  if (p === "!") {
    let q = k - 1;
    while (q >= 0 && (top[q] === " " || top[q] === "\t")) q--;
    if (top[q] === ")" || top[q] === "]") return false;
    const st = wordStart(top, q);
    return st < 0 || (CONTINUATION_WORDS.has(top.slice(st, q + 1)) && !afterDot(top, st));
  }
  const st = wordStart(top, k);
  if (st < 0) return false;
  const word = top.slice(st, k + 1);
  if (!CONTINUATION_WORDS.has(word) || afterDot(top, st)) return false;
  if (word === "void") { const before = top.slice(top.lastIndexOf("\n", st) + 1, st).replace(/=>/g, "  "); if (/^[^=]*:[^=]*$/.test(before)) return false; }
  return true;
}
// //TR: Satırın son `>` karakteri, bir `:` tip açıklamasından sonra açılan bir `<`'yi mi kapatıyor? Satır başından son `>`'ye kadar `<`/`>` yığını kurulur (`=>` sayılmaz); son `>`'nin kapattığı `<`'den önce `:` ile yalnız tip karakterleri (harf, sayı, `_ $ . | & [ ]`, boşluk) gelmelidir (`=` ya da başka işleç varsa bir ifadedir). Yeterli `<` yoksa dizin undefined olur, `slice` tüm satırı alır ve satır `>` ile bittiği için düzenli ifade eşleşmez (false: devam).
function closesTypeAngle(top: string, k: number): boolean {
  const line = top.slice(top.lastIndexOf("\n", k) + 1, k + 1);
  const stack: number[] = [];
  for (let i = 0; i < line.length - 1; i++) { if (line[i] === "<") stack.push(i); else if (line[i] === ">" && line[i - 1] !== "=") stack.pop(); }
  return /:[\s\p{L}\p{N}_$.|&[\]]*$/u.test(line.slice(0, stack[stack.length - 1]));
}

// //TR: Bir kaydı doğrular: modül var, dışa aktarım (ve varsa üye) bildirilmiş, bildirilen çağıranlar o ifadeyi KODDA (yorum/dize dışında) gerçekten anıyor. codePath PRESENT YALNIZ çalıştıran (runs) bir kayıt için, modül+dışa aktarım doğrulanmış VE (SCRIPT_LITERAL giriş betiği ya da en az bir üretim çağıranı doğrulanmış) ise. Kaynak sınıflandırılamazsa (kapanmamış dize/yorum) hiçbir şey doğrulanmaz.
// //TR: Bildirilen bir çağıran yalnız ÜRETİM yolu olabilir: depo köküne göreli, normalleşmiş, üretim köklerinden birinin altında, kaynak uzantılı ve test destek dosyası olmayan bir dosya (testler, docs ve depo dışı dosyalar bir çağıran sayılmaz). Test destek kuralı büyük/küçük harfe DUYARSIZDIR: `.test.`/`.spec.` dosyaları, `*-selftest.*` öz sınamaları, `fake-*` sahte donanımları ve tests/test/fixtures/__tests__/__mocks__ dizinleri. `scripts/validate-*.mjs` ve `verify-*.mjs` CI aracıdır ve ÜRETİM sayılır (scripts bir üretim köküdür; scripts/ci/uasco-review/run.mjs de bir bildirilen çağırandır).
const isProductionPath = (file: string): boolean => {
  if (file === "" || path.isAbsolute(file) || file.includes("\\") || path.posix.normalize(file) !== file) return false;
  const segs = file.split("/");
  return PRODUCTION_ROOTS.includes(segs[0]) && !segs.slice(1).some(sg => EXCLUDED_DIRS.has(sg.toLowerCase())) && SOURCE_EXT.test(file) && !isTestSupportName(segs[segs.length - 1]);
};
// //TR: Bir çağrı boyunca aynı dosya birden çok kayıtta geçer (executors.ts, runner.ts): okuma + tarama dosya başına BİR kez yapılır.
type SourceCache = Map<string, {exists: boolean; views: CodeViews | null}>;
function loadSource(file: string, cache: SourceCache): {exists: boolean; views: CodeViews | null} {
  let hit = cache.get(file);
  if (hit === undefined) { const text = readText(file); hit = {exists: text !== null, views: text === null ? null : codeViews(text)}; cache.set(file, hit); }
  return hit;
}
export function verifyRecord(r: AdapterRealityRecord, repoRoot: string, cache: SourceCache = new Map()): RecordVerification {
  const reasons: string[] = [];
  let views: CodeViews | null = null;
  let moduleExists: boolean;
  if (r.mode === "NPM_PACKAGE") moduleExists = readText(path.join(repoRoot, "node_modules", r.module, "package.json")) !== null;
  else { const src = loadSource(path.join(repoRoot, r.module), cache); moduleExists = src.exists; views = src.views; }
  if (!moduleExists) reasons.push("MODULE_MISSING");
  let exportDeclared = false;
  if (moduleExists) {
    if (r.mode === "NPM_PACKAGE") exportDeclared = true;
    else if (views === null) exportDeclared = false;
    else if (r.mode === "SCRIPT_LITERAL") exportDeclared = tokenRe(r.exportName).test(views.code);
    else exportDeclared = exportIn(views, r.exportName) && (r.member === undefined || memberIn(views, r.exportName, r.member));
    if (!exportDeclared) reasons.push("EXPORT_NOT_DECLARED");
  }
  const failedCallers: string[] = [];
  let verifiedCallers = 0;
  let badPaths = 0;
  for (const c of r.callers) {
    if (!isProductionPath(c.file)) { badPaths++; failedCallers.push(`${c.file}:${c.references}`); continue; }
    const cv = loadSource(path.join(repoRoot, c.file), cache).views;
    if (cv !== null && tokenRe(c.references).test(c.literal === true ? cv.literal : cv.code)) verifiedCallers++;
    else failedCallers.push(`${c.file}:${c.references}`);
  }
  if (badPaths > 0) reasons.push("CALLER_NOT_PRODUCTION");
  if (failedCallers.length > badPaths) reasons.push("CALLER_NOT_FOUND");
  if (!r.runs) reasons.push("NEVER_RUNS_IN_PRODUCTION");
  if (r.entrypoint === true && r.mode !== "SCRIPT_LITERAL") reasons.push("ENTRYPOINT_NOT_A_SCRIPT");
  const callerOk = (r.entrypoint === true && r.mode === "SCRIPT_LITERAL") || verifiedCallers >= 1;
  if (!callerOk) reasons.push("NO_PRODUCTION_CALLER");
  const codePath = r.runs && moduleExists && exportDeclared && callerOk ? "PRESENT" : "ABSENT";
  return {adapterId: r.adapterId, moduleExists, exportDeclared, verifiedCallers, failedCallers, codePath, reasons};
}

// //TR: Harita girdisi: kayıtlar doğrulanır; yoklama varsayılanı HER giriş için NOT_OBSERVED'dır (gözlem yalnız çağıranın verdiği probes ile gelir, hiçbir şey çalıştırılmaz).
export function buildAdapterRealityMap(i: {records: readonly AdapterRealityRecord[]; repoRoot: string; probes?: ReadonlyMap<string, ProbeObservation>}): {entries: ReadonlyMap<string, AdapterRealityEntry>; verifications: ReadonlyMap<string, RecordVerification>} {
  const entries = new Map<string, AdapterRealityEntry>(), verifications = new Map<string, RecordVerification>(), cache: SourceCache = new Map();
  for (const r of i.records) {
    if (entries.has(r.adapterId)) throw new Error(`ADAPTER_REALITY_DUPLICATE_ID:${r.adapterId}`);
    const v = verifyRecord(r, i.repoRoot, cache);
    verifications.set(r.adapterId, v);
    entries.set(r.adapterId, {adapterId: r.adapterId, codePath: v.codePath, probe: i.probes?.get(r.adapterId) ?? "NOT_OBSERVED"});
  }
  return {entries, verifications};
}

export type RealityFinding = "UNDER_REPORTED" | "OVER_REPORTED" | "UNREGISTERED_REAL" | "DEAD_CODE" | "ADAPTER_UNRESOLVED";
export interface RegistryAdapterRow { id: string; category: string; status: string; implementation: string }
export interface RealityFindingRow { finding: RealityFinding; id: string; detail: string }
export interface DeadCodeProbe { module: string; exports: readonly string[] }
export interface DeadCodeResult { module: string; exports: readonly string[]; importers: readonly string[] }
export interface AdapterReconciliation {
  registry: {total: number; defined: number; implemented: number};
  codeBackedRegistryIds: readonly string[]; unregisteredReal: readonly string[]; deadCode: readonly string[]; unresolvedBindingAdapters: readonly string[];
  findings: readonly RealityFindingRow[]; counts: Readonly<Record<RealityFinding, number>>;
}

// //TR: Ölü kod adayları: dışa aktarımı olan ama hiçbir ÜRETİM dosyasının içe aktarmadığı modüller. Yetenek çözümleyicisinin şu an üretim içe aktaranı yoktur (testler üretim sayılmaz); B1 gibi bir bağlama onu içe aktarırsa DEAD_CODE sayısı değişir ve test bunu adıyla söyler.
export const DEAD_CODE_PROBES: readonly DeadCodeProbe[] = [{module: "core/capabilities/resolver.ts", exports: ["resolveCapability", "resolveCapabilityFromReality"]}];
const PRODUCTION_ROOTS = ["apps", "core", "scripts", "automation"];
// //TR: Taranan kaynak uzantıları YALNIZ ts/mts/mjs/cjs/js'dir. PowerShell (.ps1) kurulum betikleri (ör. scripts/ensure-omniroute.ps1 OmniRoute başlatıcısını açar) taranmaz: tarayıcı JS/TS sözdizimi içindir, bu bilinen kör noktadır ve haritada/sayımda görünmez (testte sabitlenmiştir).
const SOURCE_EXT = /\.(?:ts|mts|mjs|cjs|js)$/;
// //TR: Test destek dosyaları üretim kodu DEĞİLDİR (büyük/küçük harfe duyarsız): `*.test.*`, `*.spec.*`, `*-selftest.*`, `fake-*`; dizinler: node_modules, dist, __tests__, __mocks__, fixtures, fixture, tests, test. Üretim köklerinin içinde de taranmaz.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$|-selftest\.[cm]?[jt]s$|^fake-/i;
const isTestSupportName = (name: string) => TEST_FILE.test(name);
// //TR: Üretim tarafından İÇE AKTARILAN veri dizinleri (core/competency/evaluation-pipeline.ts `core/workos/predev/fixtures/**` içe aktarır) ad kuralı `fixtures` olsa da üretim kaynağı taramasında (sayım, içe aktaran taramaları) YÜRÜNÜR; aksi hâlde sayım bu kaynakları görmezdi (eksik raporlama). Çağıran yolu kuralı (isProductionPath) değişmez.
const WALKED_DATA_DIRS: ReadonlySet<string> = new Set(["core/workos/predev/fixtures"]);
const EXCLUDED_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", "__tests__", "__mocks__", "fixtures", "fixture", "tests", "test"]);
function listSources(dir: string, repoRoot: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  // //TR: Dizin girdileri ada göre sıralanır (işletim sistemi sırasından bağımsız, belirli çıktı ve ileti).
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = path.join(dir, e.name);
    if (e.name === ".git" || (EXCLUDED_DIRS.has(e.name.toLowerCase()) && !WALKED_DATA_DIRS.has(rel(repoRoot, p)))) continue;
    if (e.isDirectory()) listSources(p, repoRoot, out); else if (e.isFile() && SOURCE_EXT.test(e.name) && !isTestSupportName(e.name)) out.push(p);
  }
  return out;
}
const productionFiles = (repoRoot: string): string[] => PRODUCTION_ROOTS.flatMap(root => listSources(path.join(repoRoot, root), repoRoot));
const rel = (repoRoot: string, f: string) => path.relative(repoRoot, f).split(path.sep).join("/");
// //TR: İçe aktarma belirteçleri (from "x", import("x"), import "x", require("x")) literal görünümünden okunur: yorumdaki ve başka bir dizenin içindeki belirteç sayılmaz.
const importSpecifiers = (literal: string): string[] => [...literal.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*(["'])([^"'\n]+)\1/g)].map(m => m[2]);
const stripExt = (p: string) => p.replace(/\.(?:ts|mts|mjs|cjs|js)$/, "");
// //TR: Üretim içe aktaranlar: üretim köklerinde, modülün kendisi dışında, modülü GÖRELİ belirteçle (aynı dizindeki `./resolver.js` dahil) gerçekten içe aktaran dosyalar; belirteç içe aktaran dosyanın dizinine göre çözülür. Yorum/dize içindekiler, tests/ ve docs/ sayılmaz.
export function findProductionImporters(repoRoot: string, probe: DeadCodeProbe): string[] {
  const target = stripExt(path.resolve(repoRoot, probe.module)), base = path.basename(target);
  const out: string[] = [];
  for (const f of productionFiles(repoRoot)) {
    if (stripExt(path.resolve(f)) === target) continue;
    const text = readText(f);
    if (text === null || !text.includes(base)) continue;
    const v = codeViews(text);
    if (v !== null && importSpecifiers(v.literal).some(sp => sp.startsWith(".") && stripExt(path.resolve(path.dirname(f), sp)) === target)) out.push(rel(repoRoot, f));
  }
  return out.sort();
}
// //TR: Bir paketi (ya da alt yolunu) içe aktaran ÜRETİM dosyaları: kayıtlardaki çağıran listelerinin eksiksizliğini sınamak için.
export function findPackageImporters(repoRoot: string, pkg: string): string[] {
  const out: string[] = [];
  for (const f of productionFiles(repoRoot)) {
    const text = readText(f);
    if (text === null || !text.includes(pkg)) continue;
    const v = codeViews(text);
    if (v !== null && importSpecifiers(v.literal).some(sp => sp === pkg || sp.startsWith(`${pkg}/`))) out.push(rel(repoRoot, f));
  }
  return out.sort();
}

export function loadRegistryAdapters(repoRoot: string): RegistryAdapterRow[] {
  const relPath = "registries/tool-adapters.json";
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), "utf8"));
    const rows = doc?.adapters;
    if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r: unknown) => typeof (r as RegistryAdapterRow)?.id === "string" && typeof (r as RegistryAdapterRow)?.status === "string" && typeof (r as RegistryAdapterRow)?.implementation === "string")) throw new Error("shape");
    return rows as RegistryAdapterRow[];
  } catch { throw new Error(`ADAPTER_REGISTRY_UNAVAILABLE:${relPath}`); }
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

// //TR: CI dürüstlüğü: ciEvidence REAL ya da REAL_WHEN_CONFIGURED ise ciTokens'in her biri bir iş akışı metninde (yorum satırları hariç) bulunmalıdır; bulunmuyorsa (ya da ciTokens yoksa) sorun döner. Diğer sınıflar için sorun üretilmez (iddia daha zayıftır).
export function ciEvidenceProblems(records: readonly AdapterRealityRecord[], workflowTexts: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (r.ciEvidence !== "REAL" && r.ciEvidence !== "REAL_WHEN_CONFIGURED") continue;
    const tokens = r.ciTokens ?? [];
    if (tokens.length === 0) out.push(`${r.adapterId}:REAL_WITHOUT_CI_TOKENS`);
    for (const t of tokens) if (!workflowTexts.some(w => w.includes(t))) out.push(`${r.adapterId}:CI_TOKEN_NOT_IN_WORKFLOWS:${t}`);
  }
  return out;
}
// //TR: Bir YAML iş akışında yorum satırları (# ile başlayan) ve " #" ile başlayan satır sonu yorumları kanıt sayılmaz.
const withoutYamlComments = (text: string): string => text.split("\n").filter(l => !/^\s*#/.test(l)).map(l => l.replace(/\s#\s.*$/, "")).join("\n");
export function readWorkflowTexts(repoRoot: string): string[] {
  const dir = path.join(repoRoot, ".github", "workflows");
  let names: string[];
  try { names = fs.readdirSync(dir).filter(n => /\.ya?ml$/.test(n)).sort(); } catch { return []; }
  return names.map(n => readText(path.join(dir, n))).filter((t): t is string => t !== null).map(withoutYamlComments);
}

// //TR: Eksiksizlik sayımı (census): kayıt defterindeki bir kimlik üretim kaynağında (yorum hariç, dizeler dahil, tam sözcük) geçiyor ve haritada KAYDI yok ise ya da kaynakta tam sözcük olarak çağrılan bir komut (child_process ailesinin ilk dize argümanı) kayıtsız ve gerekçesiz ise sayım sorun döner: gerçek koda sahip bir araç sessizce haritanın dışında kalamaz. Gerekçeli dışlamalar CENSUS_EXCLUSIONS'tadır; artık geçmeyen ya da sonradan kaydedilen bir dışlama da sorundur (liste dürüst kalır). Değişkenle çözülen komut adları (ör. run("gh", ...)) bu sayımla görülmez.
export interface ProductionCensus { registryIds: ReadonlyMap<string, readonly string[]>; commands: ReadonlyMap<string, readonly string[]>; unparseable: readonly string[] }
const SPAWN_CALL = /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*(["'`])([A-Za-z0-9_.-]+)\1/g;
const SELF_MODULE = "core/capabilities/adapter-reality.ts";
export function censusProduction(repoRoot: string, registryIds: readonly string[]): ProductionCensus {
  const byLower = new Map(registryIds.map(id => [id.toLowerCase(), id] as const));
  const idRe = new RegExp(`(?<![A-Za-z0-9_-])(?:${[...byLower.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})(?![A-Za-z0-9_-])`, "gi");
  const ids = new Map<string, string[]>(), commands = new Map<string, string[]>(), unparseable: string[] = [];
  const add = (m: Map<string, string[]>, k: string, f: string) => { const l = m.get(k); if (l === undefined) m.set(k, [f]); else if (!l.includes(f)) l.push(f); };
  for (const f of productionFiles(repoRoot)) {
    const file = rel(repoRoot, f);
    if (file === SELF_MODULE) continue;
    const text = readText(f);
    const v = text === null ? null : codeViews(text);
    if (v === null) { unparseable.push(file); continue; }
    for (const m of v.literal.matchAll(idRe)) add(ids, byLower.get(m[0].toLowerCase())!, file);
    for (const m of v.literal.matchAll(SPAWN_CALL)) add(commands, m[2], file);
  }
  return {registryIds: ids, commands, unparseable: unparseable.sort()};
}
export interface CensusExclusions { registryIds: Readonly<Record<string, string>>; commands: Readonly<Record<string, string>> }
// //TR: Gerekçeli dışlamalar: bu adlar üretim kaynağında geçer ama o aracı SÜREN bir kod yolu yoktur (kayıt bilerek eklenmez). Her gerekçe dosyalarla birlikte test tarafından yeniden sayılır; artık geçmeyen dışlama sorundur.
export const CENSUS_EXCLUSIONS: CensusExclusions = {
  registryIds: {
    spark: "UI sparkline CSS class and i18n keys (apps/desktop/renderer); not the Spark tool",
    docker: "'.docker' is a secret-directory deny-list entry (sandbox.mjs, linux-unshare-sandbox.ts) and 'docker' a presence name: scripts/doctor.mjs checks it with which/where and scripts/preflight.mjs runs `docker --version` for a baseline report; no code drives docker for work",
    appium: "presence name only: scripts/doctor.mjs checks it with which/where and scripts/preflight.mjs runs `appium --version` for a baseline report; no code drives it for work",
    adb: "presence name only: scripts/doctor.mjs checks it with which/where and scripts/preflight.mjs runs `adb --version` for a baseline report; no code drives it for work",
    helm: "presence name only: scripts/doctor.mjs checks it with which/where and scripts/preflight.mjs runs `helm --version` for a baseline report; no code drives it for work",
    ffmpeg: "presence name only: scripts/doctor.mjs checks it with which/where and scripts/preflight.mjs runs `ffmpeg --version` for a baseline report; no code drives it for work",
    gradle: "name in the TEST_COMMAND_EXECUTABLES allow-list (core/workos/schemas.ts) that only validates a project-configured test command; no gradle adapter is wired",
    cargo: "allow-list name for project-configured test commands, a test-output format with a summary-line parser (core/workos/test-surface.ts) and a presence name (scripts/doctor.mjs which/where, scripts/preflight.mjs `--version`); no cargo adapter is wired",
    cypress: "harness config-file glob in core/workos/test-surface.ts; no code runs cypress"
  },
  commands: {
    getconf: "POSIX configuration query in core/workos/devrun.ts; host utility, not an adapter",
    taskkill: "Windows process-tree kill used by the process runners; host utility, not an adapter",
    "powershell.exe": "Windows PowerShell host for process/identity queries and the writer guard; host utility, not an adapter",
    ps: "process listing in scripts/e2e-first-delivery-electron.mjs; host utility, not an adapter",
    where: "Windows executable lookup in the local worker; host utility, not an adapter",
    tar: "archive extraction in the local worker; host utility, not an adapter"
  }
};
export function censusProblems(census: ProductionCensus, records: readonly AdapterRealityRecord[], exclusions: CensusExclusions = CENSUS_EXCLUSIONS): string[] {
  const out: string[] = [], mapped = new Set(records.map(r => r.adapterId));
  const check = (kind: "REGISTRY_ID" | "COMMAND", seen: ReadonlyMap<string, readonly string[]>, excluded: Readonly<Record<string, string>>) => {
    for (const [k, files] of seen) if (!mapped.has(k) && excluded[k] === undefined) out.push(`${kind}_UNMAPPED:${k}:${files[0]}`);
    for (const k of Object.keys(excluded)) {
      if (mapped.has(k)) out.push(`${kind}_EXCLUSION_ALSO_MAPPED:${k}`);
      else if (!seen.has(k)) out.push(`${kind}_EXCLUSION_STALE:${k}`);
      if (excluded[k].trim() === "") out.push(`${kind}_EXCLUSION_WITHOUT_REASON:${k}`);
    }
  };
  check("REGISTRY_ID", census.registryIds, exclusions.registryIds);
  check("COMMAND", census.commands, exclusions.commands);
  for (const f of census.unparseable) out.push(`SOURCE_UNPARSEABLE:${f}`);
  return out.sort();
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
