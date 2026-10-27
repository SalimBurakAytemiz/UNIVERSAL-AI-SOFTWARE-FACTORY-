// //TR: Bu test C-RDY-2a Adapter Gerçeklik Haritasını (core/capabilities/adapter-reality.ts) doğrular: her harita girdisinin modülü var, dışa aktarımı dinamik içe aktarmayla görünür ve bildirilen üretim çağıranları o dışa aktarımı KODDA (yorum ve dize içeriği dışında) gerçekten anıyor (T1, tarayıcı ve çağıran fixture'ları); gerçek kayıtlarda kayıt-defteri-ile-kod uzlaştırması (UNDER_REPORTED/UNREGISTERED_REAL/DEAD_CODE), eksiksizlik sayımı (kod destekli bir araç haritanın dışında kalamaz) ve yetenek çözümleyicisinin sağlığı gerçeklik haritasından alması (T2); CI dürüstlüğü: iş akışlarında geçmeyen bir araç REAL sayılamaz, iş akışı anma kümesi açıkça sabitlenir (T3); 10 bağlama adaptörünün çözülmesi ve bilinmeyen kimliğin ADAPTER_UNRESOLVED olması (T4); her girişin yoklama varsayılanı NOT_OBSERVED'dır ve C-RDY-1 TOOL_READY açık bir READY yoklaması olmadan TRUE olmaz (T5). Hiçbir test kayıt dosyasına yazmaz; hiçbir ikili çalıştırılmaz.
import {describe, it, expect, beforeAll, afterAll, vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {ADAPTER_REALITY_RECORDS, CENSUS_EXCLUSIONS, DEAD_CODE_PROBES, buildAdapterRealityMap, buildAdapterRealityReport, censusProblems, censusProduction, ciEvidenceProblems, codeViews, declaresExport, declaresMember, findPackageImporters, findProductionImporters, loadRegistryAdapters, readWorkflowTexts, reconcileAdapterReality, verifyRecord} from "../core/capabilities/adapter-reality.js";
import type {AdapterRealityRecord, ProbeObservation, RecordVerification, RegistryAdapterRow} from "../core/capabilities/adapter-reality.js";
import {resolveCapabilityFromReality} from "../core/capabilities/resolver.js";
import {FIRST_DELIVERY_BINDINGS} from "../core/agents/first-delivery-bindings.js";
import {computeRoleReadiness, loadReadinessInputFromRepo} from "../core/agents/readiness-audit.js";

const REPO = path.resolve(import.meta.dirname, "..");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const BINDING_ADAPTER_IDS = FIRST_DELIVERY_BINDINGS.flatMap(b => b.adapters);
const DISTINCT_BINDING_ADAPTERS = [...new Set(BINDING_ADAPTER_IDS)].sort();
const REGISTRY_CODE_BACKED = ["ajv", "ajv-formats", "github", "gitleaks", "playwright", "trivy"];
const rec = (over: Partial<AdapterRealityRecord> = {}): AdapterRealityRecord => ({
  adapterId: "fixture", origin: "BINDING", module: "core/workos/security-tools.ts", mode: "EXPORT", exportName: "runGitleaks", runs: true, callers: [{file: "core/workos/runner.ts", references: "runGitleaks("}], ciEvidence: "FAKE_ONLY", note: "fixture", ...over
});
const real = (id: string): AdapterRealityRecord => ADAPTER_REALITY_RECORDS.find(r => r.adapterId === id)!;
const report = (o: {probes?: ReadonlyMap<string, ProbeObservation>; bindingAdapterIds?: readonly string[]; records?: readonly AdapterRealityRecord[]} = {}) =>
  buildAdapterRealityReport(REPO, {bindingAdapterIds: BINDING_ADAPTER_IDS, ...o});
const allReady = (ids: readonly string[]): ReadonlyMap<string, ProbeObservation> => new Map(ids.map(id => [id, "READY" as const]));
const messageDrift = (what: string, follow: string) => `${what}: ${follow}`;
// //TR: Dizin listesi işletim sistemi sırasına bağlıdır (bazı dosya sistemleri zaten sıralı döner); sıralamayı sınamak için readdirSync sonuçları TERSİNE çevrilir.
const withReversedDirs = <T>(f: () => T): T => {
  const original = fs.readdirSync;
  const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((...a: unknown[]) => { const r = (original as (...x: unknown[]) => unknown)(...a); return Array.isArray(r) ? [...r].reverse() : r; }) as never);
  try { return f(); } finally { spy.mockRestore(); }
};

describe("C-RDY-2a adapter-reality", () => {
  let tmp = "";
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-rdy2a-")); });
  afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });
  // //TR: Fixture kökü: verilen göreli dosyaları geçici bir dizine yazar (her çağrı yeni dizin).
  const fx = (files: Record<string, string>, prefix = "fx-"): string => {
    const root = fs.mkdtempSync(path.join(tmp, prefix));
    for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), body); }
    return root;
  };

  // //TR: Dinamik içe aktarma ile dışa aktarımın GERÇEKTEN çalışma zamanında göründüğünü doğrular (betikler içe aktarılmaz: SCRIPT_LITERAL yalnız dosya + metin).
  const exportVisible = async (r: AdapterRealityRecord): Promise<boolean> => {
    if (r.mode === "SCRIPT_LITERAL") return fs.statSync(path.join(REPO, r.module)).isFile();
    const m: Record<string, unknown> = await import(/* @vite-ignore */ r.mode === "NPM_PACKAGE" ? r.module : pathToFileURL(path.join(REPO, r.module)).href);
    const exp = m[r.exportName];
    if (typeof exp !== "function") return false;
    return r.member === undefined || typeof (exp as {prototype?: Record<string, unknown>}).prototype?.[r.member] === "function";
  };

  it("every map entry: module, export and production callers exist", async () => {
    expect(ADAPTER_REALITY_RECORDS).toHaveLength(22);
    expect(new Set(ADAPTER_REALITY_RECORDS.map(r => r.adapterId)).size).toBe(22);
    const counts = (o: string) => ADAPTER_REALITY_RECORDS.filter(r => r.origin === o).length;
    expect([counts("REGISTRY"), counts("UNREGISTERED"), counts("BINDING")]).toEqual([8, 4, 10]);
    for (const r of ADAPTER_REALITY_RECORDS) {
      const v = verifyRecord(r, REPO);
      expect(v.moduleExists, `${r.adapterId} module`).toBe(true);
      expect(v.exportDeclared, `${r.adapterId} export`).toBe(true);
      expect(v.failedCallers, `${r.adapterId} callers`).toEqual([]);
      expect(v.verifiedCallers, `${r.adapterId} verified callers`).toBe(r.callers.length);
      expect(await exportVisible(r), `${r.adapterId} dynamic import`).toBe(true);
      // //TR: semgrep ve omniroute yalnız bulunur/keşfedilir (runs false): kod yolu ABSENT; diğer her kayıt PRESENT.
      expect(v.codePath, r.adapterId).toBe(["omniroute", "semgrep"].includes(r.adapterId) ? "ABSENT" : "PRESENT");
    }
    expect(verifyRecord(real("semgrep"), REPO).reasons).toContain("NEVER_RUNS_IN_PRODUCTION");
    // //TR: omniroute: keşif betiği (tek GET <gateway>/models) gerçek ve bildirilmiş, ama üretimde modelleri onunla çağıran kod yok: runs false, tek neden NEVER_RUNS_IN_PRODUCTION.
    expect(verifyRecord(real("omniroute"), REPO)).toMatchObject({moduleExists: true, exportDeclared: true, verifiedCallers: 0, failedCallers: [], codePath: "ABSENT", reasons: ["NEVER_RUNS_IN_PRODUCTION"]});
    // //TR: Var olmayan dışa aktarımlı bir fixture hem metin doğrulamasında hem dinamik içe aktarmada başarısız olur.
    const ghost = rec({exportName: "noSuchExport"});
    expect(verifyRecord(ghost, REPO)).toMatchObject({moduleExists: true, exportDeclared: false, codePath: "ABSENT", reasons: ["EXPORT_NOT_DECLARED"]});
    expect(await exportVisible(ghost)).toBe(false);
    // //TR: Var olmayan sınıf üyesi (yöntem) de hem metin doğrulamasında hem dinamik içe aktarmada başarısız olur; var olan üye (prepareRunDelivery) doğrulanır.
    const studio = {exportName: "ProjectStudio", module: "core/workos/project-studio.ts", callers: [{file: "core/workos/crew/dev-review.ts", references: "studio.prepareRunDelivery("}]};
    expect(verifyRecord(rec({...studio, member: "noSuchMethod"}), REPO)).toMatchObject({exportDeclared: false, codePath: "ABSENT", reasons: ["EXPORT_NOT_DECLARED"]});
    expect(verifyRecord(rec({...studio, member: "prepareRunDelivery"}), REPO)).toMatchObject({exportDeclared: true, codePath: "PRESENT"});
    expect(await exportVisible(rec({...studio, member: "noSuchMethod"}))).toBe(false);
    // //TR: Üretilmiş (sahte) çağıran: dosya gerçek ama anılan ifade yok -> çağıran doğrulanmaz, kod yolu ABSENT (çağıran kontrolü atlanamaz).
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
    // //TR: Giriş betiği (entrypoint) yalnız SCRIPT_LITERAL betiklerde çağıran istemez; bir EXPORT kütüphanesindeki entrypoint:true çağıran gereksinimini ATLATAMAZ (ENTRYPOINT_NOT_A_SCRIPT). Modül yok -> ABSENT.
    expect(verifyRecord(real("playwright"), REPO).codePath).toBe("PRESENT");
    expect(verifyRecord(rec({entrypoint: true, callers: []}), REPO)).toMatchObject({codePath: "ABSENT", reasons: ["ENTRYPOINT_NOT_A_SCRIPT", "NO_PRODUCTION_CALLER"]});
    expect(verifyRecord(rec({adapterId: "gitleaks", origin: "REGISTRY", entrypoint: true, callers: []}), REPO).codePath).toBe("ABSENT");
    expect(verifyRecord(rec({entrypoint: true}), REPO)).toMatchObject({codePath: "PRESENT", reasons: ["ENTRYPOINT_NOT_A_SCRIPT"]});
    // //TR: entrypoint YALNIZ SCRIPT_LITERAL için geçerlidir: bir NPM_PACKAGE kaydında da çağıran gereksinimini atlatamaz (N12).
    const pkgRoot = fx({"node_modules/ajv/package.json": "{}"});
    expect(verifyRecord(rec({mode: "NPM_PACKAGE", module: "ajv", exportName: "default", entrypoint: true, callers: []}), pkgRoot)).toMatchObject({moduleExists: true, exportDeclared: true, codePath: "ABSENT", reasons: ["ENTRYPOINT_NOT_A_SCRIPT", "NO_PRODUCTION_CALLER"]});
    expect(verifyRecord(rec({module: "core/workos/no-such-module.ts"}), REPO)).toMatchObject({moduleExists: false, codePath: "ABSENT", reasons: ["MODULE_MISSING"]});
    expect(verifyRecord(rec({runs: false}), REPO).codePath).toBe("ABSENT");
    expect(verifyRecord(rec({mode: "NPM_PACKAGE", module: "no-such-package-xyz", exportName: "default", callers: []}), REPO)).toMatchObject({moduleExists: false, codePath: "ABSENT"});
    expect(verifyRecord(rec({mode: "SCRIPT_LITERAL", module: "scripts/e2e/desktop-journey.e2e.mjs", exportName: "noSuchLiteralInTheScript", entrypoint: true, callers: []}), REPO)).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
  });

  it("the scanner blanks comments, string bodies and regex bodies and refuses unterminated sources", () => {
    const src = [
      "const a = 1; // call(x)",
      "/* call(y) */ const b = \"call(z)\" + 'it\\'s' + `t ${call(w)} u`;",
      "const r = /x[\"']call\\(/g; const q = a / 2; call(after);",
      "run(`outer ${`inner ${call(deep)}`} tail call(tpl)`);",
      "const s = \"//not a comment\"; const t = '*/'; call(last);"
    ].join("\n");
    const v = codeViews(src)!;
    expect(v).not.toBeNull();
    expect(v.code).toHaveLength(src.length);
    expect(v.literal).toHaveLength(src.length);
    expect(v.code.split("\n")).toHaveLength(5);
    // //TR: KOD görünümünde yalnız gerçek çağrılar kalır (şablon ifadesi `${...}` kod sayılır; yorum, dize, regex ve şablon metni sayılmaz).
    const callsIn = (view: string) => [...view.matchAll(/call\((\w+)\)/g)].map(m => m[1]);
    expect(callsIn(v.code)).toEqual(["w", "after", "deep", "last"]);
    // //TR: LITERAL görünümünde dize içerikleri korunur (yorumlar yine yok); dize içindeki tırnaklar \u0001 olur.
    expect(callsIn(v.literal)).toEqual(["z", "w", "after", "deep", "tpl", "last"]);
    expect(v.literal).not.toContain("call(x)");
    expect(v.literal).not.toContain("call(y)");
    const quoted = codeViews("const s = 'import x from \"./a.js\"';")!;
    expect(quoted.literal).not.toContain("from \"./a.js\"");
    expect(codeViews("#!/usr/bin/env node\nconst k = 1;")!.code).toBe("                   \nconst k = 1;");
    // //TR: Bölme/regex ayrımı ile şablon ve kaçış dalları: her fixture'dan sonra gelen `call(...)` KOD olarak görünmelidir (aksi hâlde tarayıcı yanlış sınıflandırmıştır, kapanmamış dize null verir). G1 regex anahtar sözcükten sonra, G2 şablon ifadesi içindeki nesne değişmezi `}`, G4 `)`/`]` sonrası bölme, N8 şablonda kaçışlı `${` ve kaçışlı ters tırnak; ayrıca art arda ++/--, TS `!`, anahtar sözcük adlı özellik ve Unicode tanımlayıcı.
    const divisionCases: Array<[string, string[]]> = [
      ["function f(x) { return /a\"b/.test(x); }\ncall(g1);", ["g1"]],
      ["const t = `a ${ {k: \"}\"}.k + call(g2in) } b`;\ncall(g2);", ["g2in", "g2"]],
      ["const q = (a) / call(g4a) / b;\nconst r = arr[0] / call(g4b) / 2;", ["g4a", "g4b"]],
      ["let n = a++ / call(inc) / 2; let m = b-- / call(dec) / 2;", ["inc", "dec"]],
      ["const v = x! / call(nn) / 2; const w = !/a\"b/.test(y);\ncall(nn2);", ["nn", "nn2"]],
      ["const r = obj.return / call(prop) / 2; const s = o.typeof / call(prop2) / 3;", ["prop", "prop2"]],
      ["const café = 4; const z = café / call(uni) / 2;", ["uni"]],
      ["const m = `x \\${call(esc)} y \\` ${call(real)} z`;\ncall(after);", ["real", "after"]],
      // //TR: Tur 3 (M2/L4): rakamla biten sayıdan sonra `/` bölmedir (trace-core.js `t%86400/3600`); `+`/`-` tek başına regex başlatır (yalnız art arda `++`/`--` bölmedir); `)!` ve `]!` TS non-null sonrası bölmedir; `.` öncesi boşluk/satır sonu özellik adını (return) anahtar sözcük yapmaz.
      ["const q = 86400 / call(dig) / 2;", ["dig"]],
      ["const t = 5 % 86400/3600; const u = 7 / call(dig2) / 2;", ["dig2"]],
      ["const a = x + /a\"b/.test(y);\nconst b = x - /a\"b/.test(y);\ncall(plus);", ["plus"]],
      ["const a = (b)! / call(nn3) / 2;", ["nn3"]],
      ["const c = arr[0]! / call(nn4) / 2;", ["nn4"]],
      ["const r = a\n  .return / call(ws1) / 2;", ["ws1"]],
      ["const r = a . return / call(ws2) / 2; const s = b\n.typeof / call(ws3) / 2;", ["ws2", "ws3"]]
    ];
    for (const [text, expected] of divisionCases) expect(callsIn(codeViews(text)?.code ?? ""), text).toEqual(expected);
    // //TR: Kapanmamış dize/yorum/şablon sınıflandırılamaz: null (hiçbir şeyi kanıtlamaz).
    for (const bad of ["const a = \"open", "/* open", "const t = `open", "const x = `${call(1)"]) expect(codeViews(bad), bad).toBeNull();
  });

  it("callers and literals count only as code: comments and strings do not", () => {
    const BROKER = "scripts/claude-builder-broker.mjs", EXEC = "core/workos/executors.ts", brokerCall = "path.join(self.repoRoot, \"scripts\", \"claude-builder-broker.mjs\")";
    // //TR: claude-cli: yalnız yorum ve hata iletisi dizeleri (tam path.join metni dahil) varken çağıran DOĞRULANMAZ; gerçek kod satırı eklenince doğrulanır.
    const cli = real("claude-cli");
    const base = {[BROKER]: "export function brokerPlan() {}\n"};
    const onlyMentions = fx({...base, [EXEC]: `// ${brokerCall}\n/* claude-builder-broker.mjs */\nthrow new Error("claude-builder-broker.mjs is missing");\nconst msg = '${brokerCall}';\nconst m2 = \`${brokerCall}\`;\n`});
    expect(verifyRecord(cli, onlyMentions)).toMatchObject({verifiedCallers: 0, codePath: "ABSENT", reasons: ["CALLER_NOT_FOUND", "NO_PRODUCTION_CALLER"]});
    expect(verifyRecord(cli, fx({...base, [EXEC]: `// note\nconst argv = [${brokerCall}];\n`}))).toMatchObject({verifiedCallers: 1, codePath: "PRESENT"});
    // //TR: Betiğin kendisinde dışa aktarım adı yalnız yorum/dize içinde geçiyorsa bildirilmiş sayılmaz (SCRIPT_LITERAL kodda aranır).
    const callerLine = {[EXEC]: `const argv = [${brokerCall}];\n`};
    expect(verifyRecord(cli, fx({[BROKER]: "// brokerPlan\nconst s = \"brokerPlan\";\n", ...callerLine}))).toMatchObject({exportDeclared: false, codePath: "ABSENT", reasons: ["EXPORT_NOT_DECLARED"]});
    const pw = real("playwright"), PW = "scripts/e2e/desktop-journey.e2e.mjs";
    expect(verifyRecord(pw, fx({[PW]: "// Playwright _electron harness\nfail(\"no playwright with _electron found\");\n"}))).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    expect(verifyRecord(pw, fx({[PW]: "// _electron\nconst app = await pw._electron.launch({});\n"}))).toMatchObject({exportDeclared: true, codePath: "PRESENT"});
    // //TR: Çağrı ifadesi (runGitleaks() yalnız yorumda, dizede ya da şablon METNİNDE geçerse sayılmaz; şablon ifadesi `${...}` içindeki çağrı koddur.
    const lib = {"core/workos/security-tools.ts": "export function runGitleaks() {}\n"};
    const runner = (body: string) => fx({...lib, "core/workos/runner.ts": body});
    for (const body of ["// await runGitleaks(dir);\n", "/* runGitleaks( */\n", "throw new Error(\"runGitleaks( failed\");\n", "const m = `runGitleaks( failed`;\n", "const s = 'x ' + \"runGitleaks(\";\n"]) {
      expect(verifyRecord(rec(), runner(body)), body).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
    }
    for (const body of ["await runGitleaks(dir);\n", "const m = `failed ${runGitleaks(dir)}`;\n", "// note\nconst r = runGitleaks(dir);\n"]) {
      expect(verifyRecord(rec(), runner(body)), body).toMatchObject({verifiedCallers: 1, codePath: "PRESENT"});
    }
    expect(verifyRecord(rec(), runner("await notrunGitleaks(dir);\n"))).toMatchObject({verifiedCallers: 0}); // //TR: tam sözcük sınırı
    // //TR: Tur 3 (M3): önceki karakter `_`, `$` ya da rakam olan ad (`_runGitleaks(`, `$runGitleaks(`, `9runGitleaks(`, `éRunGitleaks` benzeri) o çağıranı doğrulamaz; sonraki karakter `_`, `$`, rakam ya da harf ise ad eşleşmez.
    for (const name of ["_runGitleaks", "$runGitleaks", "9runGitleaks", "ürunGitleaks"]) expect(verifyRecord(rec(), runner(`await ${name}(dir);\n`)), name).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});

    // //TR: İçe aktarma çağıranı: `from "ajv"` yalnız gerçek içe aktarmadır; yorum, başka bir dize ve alt yol (`ajv/dist/2020.js`) `from "ajv"` DEĞİLDİR.
    const ajv = rec({adapterId: "ajv", mode: "NPM_PACKAGE", module: "ajv", exportName: "default", callers: [{file: "core/a.ts", references: "from \"ajv\"", literal: true}]});
    const pkg = {"node_modules/ajv/package.json": "{}"};
    expect(verifyRecord(ajv, fx({...pkg, "core/a.ts": "// import A from \"ajv\";\nconst s = 'import A from \"ajv\"';\nimport B from \"ajv/dist/2020.js\";\n"}))).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
    expect(verifyRecord(ajv, fx({...pkg, "core/a.ts": "// note\nimport A from \"ajv\";\n"}))).toMatchObject({verifiedCallers: 1, codePath: "PRESENT"});
    // //TR: Şablonda kaçışlı `\${...}` bir ifade DEĞİLDİR (N8): içindeki çağrı kod sayılmaz.
    expect(verifyRecord(rec(), runner("const m = `x \\${runGitleaks(dir)} y`;\n"))).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
    // //TR: Kaynağı sınıflandırılamayan (kapanmamış dize) MODÜL dışa aktarımı kanıtlamaz (N11); tam sözcük sınırı: önek/sonek benzeri adlar eşleşmez (N13, N28).
    expect(verifyRecord(rec(), fx({"core/workos/security-tools.ts": "export function runGitleaks() {}\nconst broken = \"open\n", "core/workos/runner.ts": "await runGitleaks(dir);\n"}))).toMatchObject({moduleExists: true, exportDeclared: false, codePath: "ABSENT", reasons: ["EXPORT_NOT_DECLARED"]});
    const scriptLit = (body: string) => verifyRecord(rec({mode: "SCRIPT_LITERAL", module: "scripts/e2e/desktop-journey.e2e.mjs", exportName: "_electron", entrypoint: true, callers: []}), fx({"scripts/e2e/desktop-journey.e2e.mjs": body}));
    expect(scriptLit("const _electronUnused = 1;\n")).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    expect(scriptLit("const x_electron = 1;\n")).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    expect(scriptLit("const app = pw._electron.launch({});\n")).toMatchObject({exportDeclared: true, codePath: "PRESENT"});
    for (const tail of ["2", "_", "$", "é", "٣"]) expect(scriptLit(`const _electron${tail} = 1;\n`), tail).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    for (const lead of ["$", "9", "é", "٣"]) expect(scriptLit(`const ${lead}_electron = 1;\n`), lead).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    // //TR: Sözcük sınırı Unicode'dur: `café` içindeki `caf` ve `éx` içindeki `x` bir ad olarak eşleşmez.
    const unicodeLit = (name: string, body: string) => verifyRecord(rec({mode: "SCRIPT_LITERAL", module: "scripts/e2e/desktop-journey.e2e.mjs", exportName: name, entrypoint: true, callers: []}), fx({"scripts/e2e/desktop-journey.e2e.mjs": body}));
    expect(unicodeLit("caf", "const café = 1;\n")).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    expect(unicodeLit("x", "const éx = 1;\n")).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    expect(unicodeLit("café", "const café = 1;\n")).toMatchObject({exportDeclared: true, codePath: "PRESENT"});
    expect(verifyRecord(rec(), fx({"core/workos/security-tools.ts": "function runGitleaksLegacy(){}\nexport {runGitleaksLegacy};\n", "core/workos/runner.ts": "await runGitleaks(dir);\n"}))).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    expect(verifyRecord(rec(), fx({"core/workos/security-tools.ts": "export function runGitleaksLegacy() {}\n", "core/workos/runner.ts": "await runGitleaks(dir);\n"}))).toMatchObject({exportDeclared: false, codePath: "ABSENT"});
    // //TR: Bildirilen çağıran yalnız ÜRETİM yolu olabilir: testler, docs, __tests__, node_modules, kaynak olmayan dosya, kök dışı/mutlak/normalleşmemiş yol bir çağıran SAYILMAZ (dosyada çağrı olsa bile).
    const call = "await runGitleaks(dir);\n";
    const pathRoot = fx({"core/workos/security-tools.ts": "export function runGitleaks() {}\n", "core/workos/runner.ts": call, "tests/x.test.ts": call, "core/x.test.ts": call, "core/__tests__/x.ts": call, "docs/x.ts": call, "core/node_modules/x.ts": call, "core/workos/runner.md": call, "core/abs.ts": call,
      "core/x\\..\\..\\tests\\helper.ts": call, "tests/helpers/h.ts": call, "core/dist/x.js": call,
      "core/Case.TEST.ts": call, "core/a.spec.ts": call, "core/B.SPEC.js": call, "core/a.test.mjs": call, "core/a.spec.cjs": call, "core/a.test.js": call,
      "scripts/a-selftest.mjs": call, "core/a-SELFTEST.ts": call, "core/fake-harness.mjs": call, "core/FAKE-x.mjs": call,
      "core/fixtures/f.ts": call, "core/Fixtures/g.ts": call, "core/fixture/f.ts": call, "core/Tests/t.ts": call, "core/test/t.ts": call, "core/tests/t.ts": call,
      "core/__mocks__/m.ts": call, "core/__TESTS__/x.ts": call, "core/Node_Modules/x.ts": call, "core/DIST/x.js": call,
      "scripts/validate-x.mjs": call, "scripts/verify-x.mjs": call, "core/my-fake-tool.mjs": call, "core/contest/x.ts": call, "core/tests.ts": call, "core/prefixed-selftest-tool.mjs": call, "core/nofixtures.ts": call});
    fs.writeFileSync(path.join(path.dirname(pathRoot), "outside.ts"), call);
    for (const bad of ["tests/x.test.ts", "core/x.test.ts", "core/__tests__/x.ts", "docs/x.ts", "core/node_modules/x.ts", "core/workos/runner.md", "../outside.ts", path.join(pathRoot, "core/abs.ts"), "core/../core/workos/runner.ts", "core/./workos/runner.ts", "core//workos/runner.ts", "core\\workos\\runner.ts", "",
      // //TR: Tur 3 (M1/L2): ters eğik çizgili `core/x\..\..\tests\helper.ts` (Windows'ta tests\helper.ts'ye çözülür), tests/ altındaki test OLMAYAN dosya, dist; büyük/küçük harf duyarsız .TEST./.spec./-selftest/fake-/fixtures/tests/__mocks__ yolları.
      "core/x\\..\\..\\tests\\helper.ts", "tests/helpers/h.ts", "core/dist/x.js", "core/Case.TEST.ts", "core/a.spec.ts", "core/B.SPEC.js", "core/a.test.mjs", "core/a.spec.cjs", "core/a.test.js",
      "scripts/a-selftest.mjs", "core/a-SELFTEST.ts", "core/fake-harness.mjs", "core/FAKE-x.mjs", "core/fixtures/f.ts", "core/Fixtures/g.ts", "core/fixture/f.ts", "core/Tests/t.ts", "core/test/t.ts", "core/tests/t.ts",
      "core/__mocks__/m.ts", "core/__TESTS__/x.ts", "core/Node_Modules/x.ts", "core/DIST/x.js"]) {
      expect(verifyRecord(rec({callers: [{file: bad, references: "runGitleaks("}]}), pathRoot), JSON.stringify(bad)).toMatchObject({verifiedCallers: 0, failedCallers: [`${bad}:runGitleaks(`], codePath: "ABSENT", reasons: ["CALLER_NOT_PRODUCTION", "NO_PRODUCTION_CALLER"]});
    }
    expect(verifyRecord(rec({callers: [{file: "core/workos/runner.ts", references: "runGitleaks("}, {file: "tests/x.test.ts", references: "runGitleaks("}]}), pathRoot)).toMatchObject({verifiedCallers: 1, codePath: "PRESENT", reasons: ["CALLER_NOT_PRODUCTION"]});
    // //TR: Kural açıkça belirtilir ve sabitlenir: `scripts/validate-*.mjs` / `verify-*.mjs` CI aracıdır ve ÜRETİM çağıranı SAYILIR (scripts bir üretim köküdür); ada `fake-`/`selftest`/`test`/`fixtures` benzeyen ama kuralı sağlamayan yollar da üretimdir.
    for (const good of ["scripts/validate-x.mjs", "scripts/verify-x.mjs", "core/my-fake-tool.mjs", "core/contest/x.ts", "core/tests.ts", "core/prefixed-selftest-tool.mjs", "core/nofixtures.ts"]) {
      expect(verifyRecord(rec({callers: [{file: good, references: "runGitleaks("}]}), pathRoot), good).toMatchObject({verifiedCallers: 1, failedCallers: [], codePath: "PRESENT", reasons: []});
    }
    // //TR: Sınıflandırılamayan (kapanmamış dize) çağıran dosyası hiçbir şeyi doğrulamaz.
    expect(verifyRecord(rec(), runner("await runGitleaks(dir);\nconst broken = \"open\n"))).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
  });

  it("export and member detection read declarations, not mentions", () => {
    const src = ["export function a() {}", "export async function b() {}", "export class C {\n  private async stepX(a) {}\n  prepare(x: number) {}\n  static make<T>() {}\n  readonly notAMethod = 1;\n  run() {\n    helperCall(1);\n  }\n}", "export const d = 1;", "export { e, f as g };", "export type { T1, T2 as T3 };", "// export function hidden() {}", "function local() {}", "const mention = 'export function nothing'",
      "export class LocalClaudeExecutors {\n  other() {}\n}", "export class FakeExecutors {\n  pair() {}\n}"].join("\n");
    for (const n of ["a", "b", "C", "d", "e", "g", "T1", "T3", "LocalClaudeExecutors", "FakeExecutors"]) expect(declaresExport(src, n), n).toBe(true);
    // //TR: `export { f as g }` YALNIZ g'yi dışa aktarır, f'yi değil (önceki sabitleme f=true yanlıştı ve düzeltildi); T2 de yalnız T3 olarak görünür.
    for (const n of ["hidden", "local", "nothing", "ab", "f", "T2"]) expect(declaresExport(src, n), n).toBe(false);
    for (const m of ["stepX", "prepare", "make"]) expect(declaresMember(src, "C", m), m).toBe(true);
    // //TR: Gövdedeki çağrı (helperCall) ve alan bildirimi üye DEĞİLDİR.
    for (const m of ["notAMethod", "missing", "step", "helperCall"]) expect(declaresMember(src, "C", m), m).toBe(false);
    // //TR: Üye AİT OLDUĞU sınıfta aranır: FakeExecutors.pair, LocalClaudeExecutors.pair'i doğrulamaz.
    expect(declaresMember(src, "FakeExecutors", "pair")).toBe(true);
    expect(declaresMember(src, "LocalClaudeExecutors", "pair")).toBe(false);
    expect(declaresMember(src, "NoSuchClass", "pair")).toBe(false);
    expect(declaresExport("export function broken() {\nconst s = \"open;\n", "broken")).toBe(false);
    // //TR: Çok satırlı alan başlatıcıları ve devam satırları üye DEĞİLDİR; yalnız önceki bildirimin sonundan sonra başlayan bildirim üyedir; `const x = class K` ya da yorumdaki `class K` yerine satır başındaki sınıf başlığı kullanılır.
    const k1 = ["export class K {", "  field = foo(", "    pair(1)", "  );", "  other =", "    pair2(a);", "  cb = (a) =>", "    pair3(a);", "  pair4() {}", "}"].join("\n");
    for (const m of ["pair", "pair2", "pair3"]) expect(declaresMember(k1, "K", m), m).toBe(false);
    expect(declaresMember(k1, "K", "pair4")).toBe(true);
    const k2 = "const x = class K { fake() {} };\n// class K { ghost() {} }\nexport class K {\n  real() {}\n}\n";
    expect(declaresMember(k2, "K", "fake")).toBe(false);
    expect(declaresMember(k2, "K", "ghost")).toBe(false);
    expect(declaresMember(k2, "K", "real")).toBe(true);
  });

  it("reconciliation on real registries", () => {
    const r = report();
    const rc = r.reconciliation;
    expect(rc.registry).toEqual({total: 194, defined: 194, implemented: 0});
    expect(rc.codeBackedRegistryIds, messageDrift("code-backed registry ids changed", "a new record, a lost caller or a registry edit changed the map: update this pin, LANE-C-MAP.md and the census exclusions together")).toEqual(REGISTRY_CODE_BACKED);
    expect(rc.findings.filter(f => f.finding === "UNDER_REPORTED").map(f => f.id)).toEqual(REGISTRY_CODE_BACKED);
    expect(rc.counts, messageDrift("a finding count changed", "UNDER_REPORTED moves with the code-backed registry ids, DEAD_CODE with a production importer of the resolver (the B1 wiring), UNREGISTERED_REAL with the recorded host tools: update the matching record, pin and LANE-C-MAP.md together")).toEqual({UNDER_REPORTED: 6, OVER_REPORTED: 0, UNREGISTERED_REAL: 4, DEAD_CODE: 1, ADAPTER_UNRESOLVED: 0});
    expect(rc.unregisteredReal).toEqual(["claude-cli", "git", "node", "npm"]);
    expect(rc.deadCode, messageDrift("core/capabilities/resolver.ts gained a production importer", "that is the B1 wiring: flip the DEAD_CODE pin, remove the resolver from DEAD_CODE_PROBES and name the wiring PR in LANE-C-MAP.md")).toEqual(["core/capabilities/resolver.ts"]);
    expect(rc.unresolvedBindingAdapters).toEqual([]);
    // //TR: semgrep kayıtlıdır ve kodda yalnız bulunur: kod destekli değil, bulgu yok. Kayıt defteri hiçbir adaptörü uygulanmış saymaz.
    expect(rc.codeBackedRegistryIds).not.toContain("semgrep");
    expect(rc.findings.some(f => f.id === "semgrep")).toBe(false);
    // //TR: omniroute da kayıtlıdır ve kodda yalnız keşfedilir (runs false): kod destekli değil, bulgu yok.
    expect(rc.codeBackedRegistryIds).not.toContain("omniroute");
    expect(rc.findings.some(f => f.id === "omniroute")).toBe(false);
    expect(r.deadCode).toEqual([{module: "core/capabilities/resolver.ts", exports: ["resolveCapability", "resolveCapabilityFromReality"], importers: []}]);
    expect(r.ciProblems).toEqual([]);
    // //TR: Kod destekli kimlikler sabit kodlanmış DEĞİLDİR: gerçek adlı bir kimliğin modülü yok edilirse (ABSENT) kod destekli listeden ve UNDER_REPORTED'dan düşer.
    for (const id of REGISTRY_CODE_BACKED) {
      const gone = report({records: ADAPTER_REALITY_RECORDS.map(x => x.adapterId === id ? {...x, module: "core/workos/no-such-module.ts", mode: "EXPORT" as const} : x)}).reconciliation;
      expect(gone.codeBackedRegistryIds, id).toEqual(REGISTRY_CODE_BACKED.filter(x => x !== id));
      expect(gone.counts.UNDER_REPORTED, id).toBe(5);
    }
    const noClaude = report({records: ADAPTER_REALITY_RECORDS.map(x => x.adapterId === "git" ? {...x, module: "core/workos/no-such-module.ts"} : x)}).reconciliation;
    expect(noClaude.unregisteredReal).toEqual(["claude-cli", "node", "npm"]);
    // //TR: Yetenek çözümleyicisi: sağlık gerçeklik haritasından gelir. Kayıt satırları araç olarak verilir (implementation hep NOT_IMPLEMENTED); yoklama gözlenmeden hiçbiri çözülmez.
    const tools = loadRegistryAdapters(REPO).map(a => ({id: a.id, category: a.category, capabilities: [a.category], implementation: a.implementation}));
    for (const cap of ["SECRETS", "SUPPLY_CHAIN", "BROWSER", "API_SCHEMA", "SAST", "SCM"]) expect(resolveCapabilityFromReality(cap, tools, [], r.entries).tools, cap).toEqual([]);
    const ready = report({probes: allReady(["gitleaks", "trivy", "playwright", "ajv", "semgrep", "git", "github", "omniroute"])}).entries;
    expect(resolveCapabilityFromReality("SECRETS", tools, [], ready).tools.map(t => t.id)).toEqual(["gitleaks"]);
    expect(resolveCapabilityFromReality("SUPPLY_CHAIN", tools, [], ready).tools.map(t => t.id)).toEqual(["trivy"]);
    expect(resolveCapabilityFromReality("BROWSER", tools, [], ready).tools.map(t => t.id)).toEqual(["playwright"]);
    expect(resolveCapabilityFromReality("API_SCHEMA", tools, [], ready).tools.map(t => t.id)).toEqual(["ajv"]);
    expect(resolveCapabilityFromReality("SCM", tools, [], ready).tools.map(t => t.id)).toEqual(["github"]);
    // //TR: semgrep'in yoklaması READY olsa bile kod yolu ABSENT olduğundan çözülmez; git için kayıt satırı yok (haritada UNREGISTERED) çözülmez; FAILED yoklama çözülmez.
    expect(resolveCapabilityFromReality("SAST", tools, [], ready).tools).toEqual([]);
    expect(resolveCapabilityFromReality("MODEL_GATEWAY", tools, [], ready).tools).toEqual([]);
    expect(resolveCapabilityFromReality("SECRETS", tools, [], report({probes: new Map<string, ProbeObservation>([["gitleaks", "FAILED"]])}).entries).tools).toEqual([]);
    // //TR: Kaynaklar (resources) değişmedi: ready bayrağı ve yetenek eşleşmesi.
    expect(resolveCapabilityFromReality("X", [], [{id: "r1", capabilities: ["X"], ready: true}, {id: "r2", capabilities: ["X"], ready: false}], new Map()).resources.map(x => x.id)).toEqual(["r1"]);
  });

  it("census: every registry id and command that real code mentions is mapped or justified", () => {
    const ids = loadRegistryAdapters(REPO).map(a => a.id);
    const census = censusProduction(REPO, ids);
    expect(census.unparseable, "a production source the scanner cannot parse proves nothing").toEqual([]);
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS), messageDrift("a registry id or command with real code is not in the reality map", "add a record (code-backed tools) or a justified CENSUS_EXCLUSIONS entry (mere names) in core/capabilities/adapter-reality.ts")).toEqual([]);
    // //TR: Kayıtlı ve kodda geçen kimlikler tam olarak kayıtlar + gerekçeli dışlamalardır (örneğin github kaydı eksik olsaydı sayım bunu adıyla söylerdi).
    const mappedRegistry = ADAPTER_REALITY_RECORDS.filter(r => r.origin === "REGISTRY").map(r => r.adapterId);
    expect([...census.registryIds.keys()].sort()).toEqual([...mappedRegistry, ...Object.keys(CENSUS_EXCLUSIONS.registryIds)].sort());
    expect([...census.commands.keys()].sort()).toEqual(["git", ...Object.keys(CENSUS_EXCLUSIONS.commands)].sort());
    const without = (id: string) => ADAPTER_REALITY_RECORDS.filter(r => r.adapterId !== id);
    expect(censusProblems(census, without("github"))).toEqual([expect.stringMatching(/^REGISTRY_ID_UNMAPPED:github:/)]);
    expect(censusProblems(census, without("git"))).toEqual([expect.stringMatching(/^COMMAND_UNMAPPED:git:/)]);
    const excl = CENSUS_EXCLUSIONS;
    const { docker: _docker, ...noDocker } = excl.registryIds;
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS, {registryIds: noDocker, commands: excl.commands})).toEqual([expect.stringMatching(/^REGISTRY_ID_UNMAPPED:docker:/)]);
    const { tar: _tar, ...noTar } = excl.commands;
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS, {registryIds: excl.registryIds, commands: noTar})).toEqual([expect.stringMatching(/^COMMAND_UNMAPPED:tar:/)]);
    // //TR: Dışlama listesi dürüst kalır: kaydedilmiş bir kimliği dışlamak, artık geçmeyen bir kimliği dışlamak ve gerekçesiz dışlama sorundur.
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS, {registryIds: {...excl.registryIds, gitleaks: "x"}, commands: excl.commands})).toEqual(["REGISTRY_ID_EXCLUSION_ALSO_MAPPED:gitleaks"]);
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS, {registryIds: {...excl.registryIds, kafka: "x"}, commands: excl.commands})).toEqual(["REGISTRY_ID_EXCLUSION_STALE:kafka"]);
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS, {registryIds: {...excl.registryIds, spark: " "}, commands: excl.commands})).toEqual(["REGISTRY_ID_EXCLUSION_WITHOUT_REASON:spark"]);
    expect(censusProblems(census, ADAPTER_REALITY_RECORDS, {registryIds: excl.registryIds, commands: {...excl.commands, nosuchcmd: "x"}})).toEqual(["COMMAND_EXCLUSION_STALE:nosuchcmd"]);
    expect(censusProblems({...census, unparseable: ["core/broken.ts"]}, ADAPTER_REALITY_RECORDS)).toEqual(["SOURCE_UNPARSEABLE:core/broken.ts"]);
    // //TR: Bilinen kör nokta: PowerShell (.ps1) betikleri taranmaz (tarayıcı JS/TS içindir); bu sabitlenmiştir, .ps1 taraması eklenirse bu pin ve MAP birlikte güncellenir.
    const ps1Root = fx({"scripts/start-tool.ps1": "Start-Process acme-tool\n", "scripts/x.mjs": "const a = 1;\n"});
    expect([...censusProduction(ps1Root, ["acme-tool"]).registryIds.keys()]).toEqual([]);
    // //TR: Fixture: tam sözcük, büyük/küçük harf duyarsız, dizeler dahil, yorumlar/test dosyaları/kendi modülü hariç; spawn ailesinin ilk dize argümanı komuttur.
    const root = fx({
      "core/x.ts": "// acme-tool in a comment\nconst name = \"Acme-Tool\";\nspawnSync(\"acme-run\", []);\nconst other = \"acme-tools and myacme-tool\";\n",
      "core/x.test.ts": "const t = \"acme-tool-test-only\";\nspawn(\"never-counted\", []);\n",
      "core/__tests__/y.ts": "const t = \"acme-test-dir\";\n",
      "core/capabilities/adapter-reality.ts": "const own = \"acme-self\";\n",
      "scripts/z.mjs": "const v = `${spawn(\"acme-run\", [])}`;\nconst bad = \"open\n"
    });
    const fxCensus = censusProduction(root, ["acme-tool", "acme-tools", "acme-test-dir", "acme-self", "acme-tool-test-only"]);
    expect([...fxCensus.registryIds.entries()]).toEqual([["acme-tool", ["core/x.ts"]], ["acme-tools", ["core/x.ts"]]]);
    expect([...fxCensus.commands.entries()]).toEqual([["acme-run", ["core/x.ts"]]]);
    expect(fxCensus.unparseable).toEqual(["scripts/z.mjs"]);
    expect(censusProblems(fxCensus, [], {registryIds: {}, commands: {}})).toEqual(["COMMAND_UNMAPPED:acme-run:core/x.ts", "REGISTRY_ID_UNMAPPED:acme-tool:core/x.ts", "REGISTRY_ID_UNMAPPED:acme-tools:core/x.ts", "SOURCE_UNPARSEABLE:scripts/z.mjs"]);
  });

  it("package importers: the ajv caller lists are complete (excluded importers are named)", () => {
    // //TR: Kayıtlardaki ajv/ajv-formats çağıran listeleri üretim içe aktaranların TAM kümesidir; yalnız aşağıdaki iki dosya gerekçeyle dışarıdadır.
    const EXCLUDED: Record<string, string> = {
      "core/qa/api/strict-json-validator.ts": "imported only by tests/strict-json-validator.test.ts; no production importer",
      "scripts/runtime-schema-conformance-selftest.mjs": "self-test script, not a runtime path"
    };
    for (const pkg of ["ajv", "ajv-formats"]) {
      const callers = real(pkg).callers.map(c => c.file).sort();
      const importers = findPackageImporters(REPO, pkg);
      expect(callers, `${pkg} callers`).toEqual(importers.filter(f => EXCLUDED[f] === undefined));
      expect(importers.filter(f => EXCLUDED[f] !== undefined).length, `${pkg} exclusions still import it`).toBeGreaterThan(0);
    }
    const root = fx({"core/a.ts": "import A from \"ajv\";\n", "core/b.mjs": "import Ajv2020 from \"ajv/dist/2020.js\";\n", "core/c.ts": "// import A from \"ajv\";\nconst s = 'from \"ajv\"';\nimport F from \"ajv-formats\";\n", "core/d.test.ts": "import A from \"ajv\";\n", "core/node_modules/ajv/index.js": "import A from \"ajv\";\n"});
    expect(findPackageImporters(root, "ajv")).toEqual(["core/a.ts", "core/b.mjs"]);
    expect(findPackageImporters(root, "ajv-formats")).toEqual(["core/c.ts"]);
  });

  it("dead code needs a real production import; comments, strings, tests and vendored directories do not count", () => {
    const probe = DEAD_CODE_PROBES[0];
    const body = {
      "core/capabilities/resolver.ts": "export function resolveCapability() {}\n",
      "tests/uses-it.test.ts": "import {resolveCapability} from \"../core/capabilities/resolver.js\";\n",
      "tests/helpers/uses-it.ts": "import {resolveCapability} from \"../../core/capabilities/resolver.js\";\n",
      "core/other.ts": "// import {resolveCapability} from \"./capabilities/resolver.js\";\n/* from \"capabilities/resolver\" */\n * from \"capabilities/resolver\"\nconst s = \"capabilities/resolver\";\nconst t = 'import x from \"./capabilities/resolver.js\"';\n",
      "core/capabilities/trailing.ts": "const a = 1; // import {resolveCapability} from \"./resolver.js\";\nconst b = 2; /* from \"./resolver.js\" */\n",
      "core/capabilities/uses.test.ts": "import {resolveCapability} from \"./resolver.js\";\n",
      "core/__tests__/uses.ts": "import {resolveCapability} from \"../capabilities/resolver.js\";\n",
      "core/node_modules/x/index.js": "import a from \"../../capabilities/resolver.js\";\n",
      "apps/dist/x.js": "import a from \"../../core/capabilities/resolver.js\";\n",
      "core/elsewhere/user.ts": "import {resolveCapability} from \"./resolver.js\";\nimport {x} from \"../elsewhere/resolver\";\n",
      "core/elsewhere/resolver.ts": "export const resolveCapability = 1;\n"
    };
    const root = fx(body);
    // //TR: Hiçbiri gerçek bir üretim içe aktaranı değildir: yorum/dize/test/__tests__/node_modules/dist (üretim köklerinin İÇİNDE de), tests/ altındaki yardımcı (test olmayan) dosya (tests bir üretim kökü DEĞİLDİR) ve başka dizindeki `./resolver.js`.
    expect(findProductionImporters(root, probe)).toEqual([]);
    const w = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), text); };
    w("apps/control-api/src/real.ts", "import {resolveCapability} from \"../../../core/capabilities/resolver.js\";\n");
    w("scripts/real.mjs", "const m = await import(\"../core/capabilities/resolver.js\");\n");
    w("automation/lib/real.cjs", "const m = require(\"../../core/capabilities/resolver\");\n");
    w("core/capabilities/sibling.ts", "import {resolveCapability} from \"./resolver.js\";\nexport {resolveCapability};\n");
    expect(findProductionImporters(root, probe)).toEqual(["apps/control-api/src/real.ts", "automation/lib/real.cjs", "core/capabilities/sibling.ts", "scripts/real.mjs"]);
    // //TR: Üretim içe aktaranı olan modül DEAD_CODE değildir; olmayan DEAD_CODE'dur.
    const base = {registry: [] as RegistryAdapterRow[], records: [] as AdapterRealityRecord[], verifications: new Map<string, RecordVerification>(), bindingAdapterIds: [] as string[]};
    expect(reconcileAdapterReality({...base, deadCode: [{module: probe.module, exports: probe.exports, importers: ["apps/control-api/src/real.ts"]}]}).counts.DEAD_CODE).toBe(0);
    expect(reconcileAdapterReality({...base, deadCode: [{module: probe.module, exports: probe.exports, importers: []}]}).deadCode).toEqual([probe.module]);
  });

  it("reconciliation findings on fixtures: UNDER, OVER, UNREGISTERED, UNRESOLVED", () => {
    const row = (id: string, implementation: string, status = "REGISTERED"): RegistryAdapterRow => ({id, category: "X", status, implementation});
    const present = (adapterId: string): RecordVerification => ({adapterId, moduleExists: true, exportDeclared: true, verifiedCallers: 1, failedCallers: [], codePath: "PRESENT", reasons: []});
    const absent = (adapterId: string): RecordVerification => ({...present(adapterId), codePath: "ABSENT", reasons: ["MODULE_MISSING"]});
    const records = ["a", "b", "c", "d", "e"].map(adapterId => rec({adapterId, origin: adapterId === "e" ? "UNREGISTERED" : "REGISTRY"}));
    const verifications = new Map<string, RecordVerification>([["a", present("a")], ["b", present("b")], ["c", absent("c")], ["d", absent("d")], ["e", present("e")]]);
    const rc = reconcileAdapterReality({
      registry: [row("a", "NOT_IMPLEMENTED"), row("b", "IMPLEMENTED"), row("c", "IMPLEMENTED"), row("d", "NOT_IMPLEMENTED"), row("z", "PARTIAL"), row("q", "NOT_IMPLEMENTED", "DRAFT")],
      records, verifications, bindingAdapterIds: ["a", "ghost", "ghost"], deadCode: []
    });
    // a: code-backed but registry says not implemented -> UNDER; b: both agree -> nothing; c: registry says implemented, no code -> OVER; d: neither -> nothing; z: implemented and not mapped -> OVER; e: real code, no registry row -> UNREGISTERED; ghost -> UNRESOLVED
    expect(rc.findings.map(f => `${f.finding}:${f.id}`)).toEqual(["ADAPTER_UNRESOLVED:ghost", "OVER_REPORTED:c", "OVER_REPORTED:z", "UNDER_REPORTED:a", "UNREGISTERED_REAL:e"]);
    expect(rc.counts).toEqual({UNDER_REPORTED: 1, OVER_REPORTED: 2, UNREGISTERED_REAL: 1, DEAD_CODE: 0, ADAPTER_UNRESOLVED: 1});
    expect(rc.codeBackedRegistryIds).toEqual(["a", "b"]);
    expect(rc.unregisteredReal).toEqual(["e"]);
    expect(rc.unresolvedBindingAdapters).toEqual(["ghost"]);
    // //TR: defined yalnız status REGISTERED olanları sayar (DRAFT satırı sayılmaz); implemented NOT_IMPLEMENTED olmayanları sayar.
    expect(rc.registry).toEqual({total: 6, defined: 5, implemented: 3});
  });

  it("CI honesty: the workflow mention set is pinned and REAL needs a token that a workflow really holds", () => {
    const wfDir = path.join(REPO, ".github", "workflows");
    const names = fs.readdirSync(wfDir).filter(n => /\.ya?ml$/.test(n)).sort();
    const texts = readWorkflowTexts(REPO);
    expect(texts.length).toBe(names.length);
    expect(names).toEqual(["ci.yml", "uasco-independent-review.yml", "windows-installer.yml"]);
    // //TR: İş akışlarında geçen kayıt-defteri/harita kimlikleri AÇIKÇA sabitlenir. gitleaks/trivy/playwright/semgrep hiçbir iş akışında geçmez; biri geçerse (ör. gitleaks/trivy'yi CI'a ekleyen bir PR, #251 gibi) bu pin adıyla patlar ve ciEvidence sınıfını gözden geçirmek gerekir.
    const ids = [...new Set([...loadRegistryAdapters(REPO).map(a => a.id), ...ADAPTER_REALITY_RECORDS.map(r => r.adapterId)])].sort();
    const mentions: Record<string, string[]> = {};
    for (const id of ids) {
      const re = new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`, "i");
      const hits = names.filter((_, k) => re.test(texts[k]));
      if (hits.length > 0) mentions[id] = hits;
    }
    expect(mentions, messageDrift("a workflow now mentions another tool", "classify that tool's ciEvidence in adapter-reality.ts (REAL needs ciTokens that a workflow holds) and update this pin; do not leave a REAL claim without a token")).toEqual({
      github: ["ci.yml", "uasco-independent-review.yml", "windows-installer.yml"],
      node: ["ci.yml", "uasco-independent-review.yml", "windows-installer.yml"],
      npm: ["ci.yml", "windows-installer.yml"]
    });
    for (const tool of ["gitleaks", "trivy", "playwright", "semgrep", "omniroute"]) expect(real(tool).ciEvidence, tool).not.toBe("REAL");
    expect(real("omniroute").ciEvidence).toBe("DISCOVERY_ONLY");
    expect(real("trivy").ciEvidence).toBe("FAKE_ONLY");
    expect(real("gitleaks").ciEvidence).toBe("FAKE_BINARY_ONLY");
    expect(real("playwright").ciEvidence).toBe("HARNESS_NOT_CI");
    expect(real("semgrep").ciEvidence).toBe("DISCOVERY_ONLY");
    // //TR: github: iş akışı gerçek istemciyi çalıştırır ama yalnız kapı açıkken (environment, olay, taslak olmayan aynı depo PR'ı): REAL_WHEN_CONFIGURED. npm ve node: CI gerçekten çalıştırır (REAL).
    expect(real("github").ciEvidence).toBe("REAL_WHEN_CONFIGURED");
    expect(real("npm").ciEvidence).toBe("REAL");
    expect(real("node").ciEvidence).toBe("REAL");
    expect(real("git").ciEvidence).toBe("RUNTIME_PREREQUISITE");
    expect(ciEvidenceProblems(ADAPTER_REALITY_RECORDS, texts)).toEqual([]);
    // //TR: REAL yalnız iş akışında gerçekten geçen jetonla savunulur: bulunmayan jeton ve jetonsuz REAL (ya da REAL_WHEN_CONFIGURED) sorundur; diğer sınıflar sorun üretmez.
    expect(ciEvidenceProblems([rec({adapterId: "x", ciEvidence: "REAL", ciTokens: ["definitely-not-in-any-workflow"]})], texts)).toEqual(["x:CI_TOKEN_NOT_IN_WORKFLOWS:definitely-not-in-any-workflow"]);
    expect(ciEvidenceProblems([rec({adapterId: "x", ciEvidence: "REAL_WHEN_CONFIGURED", ciTokens: ["definitely-not-in-any-workflow"]})], texts)).toEqual(["x:CI_TOKEN_NOT_IN_WORKFLOWS:definitely-not-in-any-workflow"]);
    // //TR: Her jeton ayrı ayrı savunulur: ilk jeton workflow'da olsa da ikincisi yoksa (ya da tersi) sorun, ikinci jetonun adıyla döner (N14).
    expect(ciEvidenceProblems([rec({adapterId: "two", ciEvidence: "REAL", ciTokens: ["present-token", "missing-token"]})], ["... present-token ..."])).toEqual(["two:CI_TOKEN_NOT_IN_WORKFLOWS:missing-token"]);
    expect(ciEvidenceProblems([rec({adapterId: "two", ciEvidence: "REAL", ciTokens: ["missing-token", "present-token"]})], ["... present-token ..."])).toEqual(["two:CI_TOKEN_NOT_IN_WORKFLOWS:missing-token"]);
    expect(ciEvidenceProblems([rec({adapterId: "y", ciEvidence: "REAL"})], texts)).toEqual(["y:REAL_WITHOUT_CI_TOKENS"]);
    expect(ciEvidenceProblems([rec({adapterId: "y", ciEvidence: "REAL_WHEN_CONFIGURED"})], texts)).toEqual(["y:REAL_WITHOUT_CI_TOKENS"]);
    expect(ciEvidenceProblems([rec({adapterId: "z", ciEvidence: "FAKE_ONLY", ciTokens: ["nope"]})], texts)).toEqual([]);
    expect(ciEvidenceProblems([rec({adapterId: "w", ciEvidence: "REAL", ciTokens: ["gitleaks-unreal"]})], ["... gitleaks-unreal ..."])).toEqual([]);
    // //TR: Sahte bir iş akışı kümesinde trivy anılırsa REAL jetonu ile savunulabilir; anılmadan REAL işaretlemek bu fonksiyonla yakalanır.
    const trivyAsReal = ADAPTER_REALITY_RECORDS.map(r => r.adapterId === "trivy" ? {...r, ciEvidence: "REAL" as const} : r);
    expect(ciEvidenceProblems(trivyAsReal, texts)).toEqual(["trivy:REAL_WITHOUT_CI_TOKENS"]);
    // //TR: .yaml uzantılı iş akışları da okunur; yorum satırları ve satır sonu yorumları kanıt sayılmaz; .md dosyası okunmaz.
    const wfRoot = fx({".github/workflows/a.yaml": "jobs:\n  t:\n    steps:\n      - run: node tools/real-step.mjs\n", ".github/workflows/b.yml": "# node tools/commented.mjs\n- run: echo ok # node tools/trailing.mjs\n", ".github/workflows/README.md": "node tools/readme.mjs\n"});
    const wf = readWorkflowTexts(wfRoot);
    expect(wf).toHaveLength(2);
    const tokenRec = (t: string) => rec({adapterId: "t", ciEvidence: "REAL", ciTokens: [t]});
    expect(ciEvidenceProblems([tokenRec("node tools/real-step.mjs")], wf)).toEqual([]);
    for (const t of ["node tools/commented.mjs", "node tools/trailing.mjs", "node tools/readme.mjs"]) expect(ciEvidenceProblems([tokenRec(t)], wf), t).toEqual([`t:CI_TOKEN_NOT_IN_WORKFLOWS:${t}`]);
    expect(readWorkflowTexts(fx({}))).toEqual([]);
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

  it("every entry defaults to NOT_OBSERVED and a tool resolves only with an explicit READY probe", () => {
    const {entries} = buildAdapterRealityMap({records: ADAPTER_REALITY_RECORDS, repoRoot: REPO});
    expect(entries.size).toBe(22);
    // //TR: Varsayılan HER giriş için NOT_OBSERVED'dır (kayıt, kayıtsız-gerçek ve bağlama kökenli girişlerin hepsi): git/npm/node/claude-cli dahil.
    for (const [id, e] of entries) expect(e.probe, id).toBe("NOT_OBSERVED");
    expect([...new Set(ADAPTER_REALITY_RECORDS.map(r => r.origin))].sort()).toEqual(["BINDING", "REGISTRY", "UNREGISTERED"]);
    // //TR: Tek bir adaptör için verilen yoklama yalnız onu değiştirir; diğer hepsi NOT_OBSERVED kalır.
    for (const target of ["git", "gitleaks", "workos-runner"]) {
      const one = buildAdapterRealityMap({records: ADAPTER_REALITY_RECORDS, repoRoot: REPO, probes: new Map<string, ProbeObservation>([[target, "READY"]])}).entries;
      for (const [id, e] of one) expect(e.probe, `${target}:${id}`).toBe(id === target ? "READY" : "NOT_OBSERVED");
    }
    // //TR: Çözümleyici: yoklama yokken hiçbir araç çözülmez; yalnız kendi READY yoklaması olan ve kod yolu PRESENT olan araç çözülür (semgrep ve omniroute ABSENT: READY bile yetmez).
    for (const r of ADAPTER_REALITY_RECORDS) {
      const tools = [{id: r.adapterId, category: "X", capabilities: ["CAP"]}];
      expect(resolveCapabilityFromReality("CAP", tools, [], entries).tools, `${r.adapterId} unprobed`).toEqual([]);
      const probed = new Map(entries).set(r.adapterId, {...entries.get(r.adapterId)!, probe: "READY"});
      expect(resolveCapabilityFromReality("CAP", tools, [], probed).tools.map(t => t.id), `${r.adapterId} READY`).toEqual(["omniroute", "semgrep"].includes(r.adapterId) ? [] : [r.adapterId]);
    }
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

  it("scanner golden views: exact code and literal views, line preservation and every slash decision", () => {
    // //TR: Tam eşitlik: dize içindeki her üç tırnak türü literal görünümde \u0001 olur (code görünümünde gövde boş); regex gövdesi code'da boş, literal'da (tırnaklar maskeli) korunur; shebang iki görünümde de boş.
    const show = (v: string) => v.replace(/\u0001/g, "¤");
    const g1 = codeViews("const s = \"a'b`c\"; const t = 'x\"y';")!;
    expect(show(g1.code)).toBe("const s = \"     \"; const t = '   ';");
    expect(show(g1.literal)).toBe("const s = \"a¤b¤c\"; const t = 'x¤y';");
    const g2 = codeViews("const r = /a\"b/g;")!;
    expect(show(g2.code)).toBe("const r = /   /g;");
    expect(show(g2.literal)).toBe("const r = /a¤b/g;");
    const g3 = codeViews("#!/usr/bin/env node\nconst k = \"v\";")!;
    expect(g3.code).toBe("                   \nconst k = \" \";");
    expect(g3.literal).toBe("                   \nconst k = \"v\";");
    // //TR: Satır sayısı ve CR/LF çok satırlı yorum, dize ve şablonda KORUNUR (kod görünümü kaynakla aynı uzunlukta ve aynı satır dizilimindedir).
    const multi = "a /* x\r\ny */ b\r\n`p\r\nq\nr` + \"s\\\r\nt\";\r\n";
    const mv = codeViews(multi)!;
    for (const view of [mv.code, mv.literal]) {
      expect(view).toHaveLength(multi.length);
      expect([...view].map(c => (c === "\n" || c === "\r" ? c : ".")).join("")).toBe([...multi].map(c => (c === "\n" || c === "\r" ? c : ".")).join(""));
    }
    // //TR: Bölme/regex kararları: dize ve şablondan sonra `/` bölmedir; `)` sonrası satır başı/sekme ardından `/` bölmedir; kaynağın başındaki `/` regex'tir; `/*/` yorumu hemen kapanmaz; `}` sonrası satır başındaki tek `/` regex değil bölmedir (sonraki satırdaki `/` ile eşleşmez); iç içe şablon ifadesi dış derinliği geri yükler.
    const calls = (text: string) => [...codeViews(text)!.code.matchAll(/call\((\w+)\)/g)].map(m => m[1]);
    expect(calls("const a = \"s\" / call(d1) / 2;\nconst b = `t` / call(d2) / 3;")).toEqual(["d1", "d2"]);
    expect(calls("const c = (a)\n/ call(d3) / 2; const d = (b)\t/ call(d4) / 2;")).toEqual(["d3", "d4"]);
    expect(calls("/a\"b/.test(x);\ncall(s9);")).toEqual(["s9"]);
    expect(calls("/*/ call(hidden) */ call(shown);")).toEqual(["shown"]);
    const loneSlash = "const o = {}\n/ call(d5);\ncall(d6) / 2;";
    expect(calls(loneSlash)).toEqual(["d5", "d6"]);
    expect(codeViews(loneSlash)!.code).toHaveLength(loneSlash.length);
    expect(calls("const t = `o ${ {k: `i ${ 1 } j`}.k + call(s21) } p`;")).toEqual(["s21"]);
  });

  it("declaration forms: default, let/var, generators, type modifiers, multi-line lists, member modifiers, template text", () => {
    const src = ["export default function dflt() {}", "export let lv = 1;", "export var vv = 2;", "export function* gen() {}", "export { type T4, V4 };", "export {\n  a1,\n  b1 as c1\n};", "const t = `\nexport function inTpl() {}\nexport { inList };\n`;"].join("\n");
    for (const n of ["dflt", "lv", "vv", "gen", "T4", "V4", "a1", "c1"]) expect(declaresExport(src, n), n).toBe(true);
    for (const n of ["b1", "inTpl", "inList", "type", "export"]) expect(declaresExport(src, n), n).toBe(false);
    const cls = ["export class Mm {", "  public pubM() {}", "  protected protM() {}", "  spaced () {}", "}", "const t = `", "class Tpl {", "  fake() {}", "}", "`;"].join("\n");
    for (const m of ["pubM", "protM", "spaced"]) expect(declaresMember(cls, "Mm", m), m).toBe(true);
    expect(declaresMember(cls, "Tpl", "fake")).toBe(false);
    // //TR: Tur 3 (L1): dışa aktarım adı ve sınıf adı Unicode sözcük sınırıyla eşleşir: `runGitleaksé`/`runGitleaks٣`/`runGitleaks_`/`runGitleaks$` `runGitleaks` DEĞİLDİR; `Kü` sınıfı `K` sınıfı DEĞİLDİR.
    for (const tail of ["é", "٣", "_", "$", "2"]) expect(declaresExport(`export const runGitleaks${tail} = 1;`, "runGitleaks"), tail).toBe(false);
    expect(declaresExport("export const runGitleaks = 1;", "runGitleaks")).toBe(true);
    expect(declaresExport("export const runGitleaksé = 1;", "runGitleaksé")).toBe(true);
    for (const tail of ["ü", "٣", "_", "$", "2"]) expect(declaresMember(`export class K${tail} {\n  pair() {}\n}`, "K", "pair"), tail).toBe(false);
    expect(declaresMember("export class Kü {\n  pair() {}\n}", "Kü", "pair")).toBe(true);
    // //TR: Tur 3 (L4): sınıf başlığı biçimleri (abstract / default / declare / bunların birleşimi, girintili başlık) ve gövde ayrıştırması.
    for (const header of ["export abstract class K", "export default class K", "declare class K", "export declare abstract class K", "abstract class K", "  export class K", "\texport class K"]) expect(declaresMember(`${header} {\n  pair() {}\n}`, "K", "pair"), header).toBe(true);
    // //TR: Tur 3 (L3): üye bir DEVAM satırı değilse sayılır. ASI ile biten alan (`x = 1`), çıplak dekoratör (`@dec`), noktalı virgülsüz tipli alan (`m: Map<string, number>`), sonek `++`/`--`, dize/kapanan nesne/dizi/çağrı sonrası üye GERÇEKTİR.
    const memberAfter = (prev: string) => declaresMember(`export class K {\n  ${prev}\n  pair() {}\n}`, "K", "pair");
    for (const prev of ["x = 1", "@dec", "private m: Map<string, number>", "x = i++", "x = i--", "x = 'a'", "x = `a`", "x = [1]", "@d(1)", "x = {a: 1}", "x = a >= b ? c : d", "x: number;", "x = foo()", "y = a > b"]) expect(memberAfter(prev), prev).toBe(true);
    // //TR: Devam işaretleriyle biten satırdan sonra gelen `pair(` bir önceki ifadenin devamıdır, üye DEĞİLDİR: `= ( , [ ? : + - * / % & | ^ . <` ve `=>`.
    for (const prev of ["x =", "x = foo(", "x = foo(a,", "x = [", "x = c ?", "x = c ? 1 :", "x = a +", "x = a -", "x = a *", "x = a /", "x = a %", "x = a &", "x = a |", "x = a ^", "x = a.", "x = a <", "x = (a) =>"]) expect(memberAfter(prev), prev).toBe(false);
  });

  it("exact tokens and record data: case, regex metacharacters, caller references, reason order, probes of absent records", () => {
    const lib = {"core/workos/security-tools.ts": "export function runGitleaks() {}\n"};
    const runner = (body: string) => fx({...lib, "core/workos/runner.ts": body});
    expect(verifyRecord(rec(), runner("RUNGITLEAKS(dir);\n"))).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
    const studioRec = rec({exportName: "ProjectStudio", module: "core/workos/project-studio.ts", callers: [{file: "core/workos/crew/dev-review.ts", references: "studio.prepareRunDelivery("}]});
    const studioRoot = (call: string) => fx({"core/workos/project-studio.ts": "export class ProjectStudio {\n  prepareRunDelivery() {}\n}\n", "core/workos/crew/dev-review.ts": call});
    expect(verifyRecord(studioRec, studioRoot("studioXprepareRunDelivery(dir);\n"))).toMatchObject({verifiedCallers: 0, codePath: "ABSENT"});
    expect(verifyRecord(studioRec, studioRoot("studio.prepareRunDelivery(dir);\n"))).toMatchObject({verifiedCallers: 1, codePath: "PRESENT"});
    // //TR: Gerçek kayıt verisi pinlenir: güvenlik üçlüsünün çağıran başvuruları, sınıf üyesi, CI sınıfları ve github jetonu (başka bir çalışan sembole/jetona kaydırılamaz).
    expect(real("gitleaks").callers).toEqual([{file: "core/workos/runner.ts", references: "runGitleaks("}]);
    expect(real("trivy").callers).toEqual([{file: "core/workos/runner.ts", references: "runTrivy("}]);
    expect(real("semgrep").callers).toEqual([{file: "core/workos/runner.ts", references: "discoverSecurityTools("}]);
    expect(real("local-claude-reviewer")).toMatchObject({exportName: "LocalClaudeExecutors", member: "pair"});
    expect([real("ajv").ciEvidence, real("ajv-formats").ciEvidence]).toEqual(["IN_PROCESS_RUNTIME", "IN_PROCESS_RUNTIME"]);
    expect(real("github").ciTokens).toEqual(["node scripts/ci/uasco-review/run.mjs scope"]);
    // //TR: Neden sırası sabittir ve entrypoint:false bir uyarı DEĞİLDİR.
    expect(verifyRecord(rec({module: "core/workos/no-such-module.ts", runs: false, entrypoint: true, callers: [{file: "core/workos/runner.ts", references: "noSuchSymbolFixture("}]}), REPO).reasons).toEqual(["MODULE_MISSING", "CALLER_NOT_FOUND", "NEVER_RUNS_IN_PRODUCTION", "ENTRYPOINT_NOT_A_SCRIPT", "NO_PRODUCTION_CALLER"]);
    expect(verifyRecord(rec({entrypoint: false}), REPO)).toMatchObject({codePath: "PRESENT", reasons: []});
    // //TR: Kod yolu ABSENT olan kayıt da kendisine verilen yoklamayı korur; node_modules/<paket> dizini package.json olmadan paket sayılmaz; rapor verilen kayıtları kullanır (CI sorunu ve uzlaştırma).
    const gone = buildAdapterRealityMap({records: [rec({adapterId: "gone", module: "core/workos/no-such-module.ts"})], repoRoot: REPO, probes: new Map<string, ProbeObservation>([["gone", "READY"]])}).entries.get("gone");
    expect(gone).toEqual({adapterId: "gone", codePath: "ABSENT", probe: "READY"});
    expect(verifyRecord(rec({mode: "NPM_PACKAGE", module: "pkgx", exportName: "default", callers: []}), fx({"node_modules/pkgx/readme.md": "x"}))).toMatchObject({moduleExists: false, reasons: ["MODULE_MISSING", "NO_PRODUCTION_CALLER"]});
    const extra = rec({adapterId: "xtool", origin: "UNREGISTERED", ciEvidence: "REAL", ciTokens: ["nope-token"]});
    const custom = report({records: [...ADAPTER_REALITY_RECORDS, extra]});
    expect(custom.ciProblems).toEqual(["xtool:CI_TOKEN_NOT_IN_WORKFLOWS:nope-token"]);
    expect(custom.reconciliation.unregisteredReal).toEqual(["claude-cli", "git", "node", "npm", "xtool"]);
  });

  it("reconciliation details: exact finding texts, sorted lists, code-point tie-break, implemented counts, unresolved vs registry ids", () => {
    const row = (id: string, implementation: string, status = "REGISTERED"): RegistryAdapterRow => ({id, category: "X", status, implementation});
    const v = (adapterId: string, codePath: "PRESENT" | "ABSENT"): RecordVerification => ({adapterId, moduleExists: true, exportDeclared: true, verifiedCallers: 1, failedCallers: [], codePath, reasons: []});
    const records = [rec({adapterId: "u", origin: "REGISTRY"}), rec({adapterId: "o", origin: "REGISTRY"}), rec({adapterId: "B1", origin: "REGISTRY"}), rec({adapterId: "a1", origin: "REGISTRY"}), rec({adapterId: "empty", origin: "REGISTRY"}), rec({adapterId: "ru", origin: "UNREGISTERED"}), rec({adapterId: "x", origin: "UNREGISTERED"})];
    const verifications = new Map<string, RecordVerification>([["u", v("u", "PRESENT")], ["o", v("o", "ABSENT")], ["B1", v("B1", "ABSENT")], ["a1", v("a1", "ABSENT")], ["empty", v("empty", "ABSENT")], ["ru", v("ru", "PRESENT")], ["x", v("x", "PRESENT")]]);
    const rc = reconcileAdapterReality({
      registry: [row("u", "NOT_IMPLEMENTED"), row("o", "IMPLEMENTED"), row("B1", "IMPLEMENTED"), row("a1", "IMPLEMENTED"), row("empty", ""), row("ru", "NOT_IMPLEMENTED"), row("n", "PARTIAL"), row("d1", "IMPLEMENTED", "DRAFT")],
      records, verifications, bindingAdapterIds: ["zeta", "alpha", "n", "u"],
      deadCode: [{module: "core/z.ts", exports: ["a", "b"], importers: []}, {module: "core/a.ts", exports: ["c"], importers: []}]
    });
    expect(rc.findings).toEqual([
      {finding: "ADAPTER_UNRESOLVED", id: "alpha", detail: "binding adapter id has no reality-map record"},
      {finding: "ADAPTER_UNRESOLVED", id: "n", detail: "binding adapter id has no reality-map record"},
      {finding: "ADAPTER_UNRESOLVED", id: "zeta", detail: "binding adapter id has no reality-map record"},
      {finding: "DEAD_CODE", id: "core/a.ts", detail: "no production importer for c"},
      {finding: "DEAD_CODE", id: "core/z.ts", detail: "no production importer for a, b"},
      {finding: "OVER_REPORTED", id: "B1", detail: "registry implementation IMPLEMENTED but no verified code path"},
      {finding: "OVER_REPORTED", id: "a1", detail: "registry implementation IMPLEMENTED but no verified code path"},
      {finding: "OVER_REPORTED", id: "d1", detail: "registry implementation IMPLEMENTED but the adapter is not in the reality map"},
      {finding: "OVER_REPORTED", id: "empty", detail: "registry implementation  but no verified code path"},
      {finding: "OVER_REPORTED", id: "n", detail: "registry implementation PARTIAL but the adapter is not in the reality map"},
      {finding: "OVER_REPORTED", id: "o", detail: "registry implementation IMPLEMENTED but no verified code path"},
      {finding: "UNDER_REPORTED", id: "ru", detail: "registry implementation NOT_IMPLEMENTED but a verified code path exists"},
      {finding: "UNDER_REPORTED", id: "u", detail: "registry implementation NOT_IMPLEMENTED but a verified code path exists"},
      {finding: "UNREGISTERED_REAL", id: "x", detail: "real code path, no registry row"}
    ]);
    expect(rc.deadCode).toEqual(["core/a.ts", "core/z.ts"]);
    expect(rc.unresolvedBindingAdapters).toEqual(["alpha", "n", "zeta"]);
    // //TR: Uygulanmış sayısı durumdan bağımsızdır (DRAFT satır dahil) ve boş dize uygulanmış sayılır; kayıtsız-köken kaydı kayıt satırı olan bir kimlikle de kayıt defteri kod destekli listesine girer.
    expect(rc.registry).toEqual({total: 8, defined: 7, implemented: 6});
    expect(rc.codeBackedRegistryIds).toEqual(["ru", "u"]);
  });

  it("importer scan details: extensions, test flavours, self import, hidden directories, word boundaries, unparseable files, bare specifiers", () => {
    const probe = DEAD_CODE_PROBES[0];
    const imp = "import {resolveCapability} from \"./capabilities/resolver.js\";\n", rimp = imp.replace("./", "../");
    const root = fx({
      "core/capabilities/resolver.ts": "import {x} from \"./resolver.js\";\nexport function resolveCapability() {}\n",
      "core/.git/hook.ts": "import {resolveCapability} from \"../capabilities/resolver.js\";\n",
      "core/m1.mts": "import {resolveCapability} from \"./capabilities/resolver.js\";\n",
      "core/bare.ts": "import {resolveCapability} from \"./capabilities/resolver\";\n",
      "core/t1.test.js": imp, "core/t2.test.mjs": imp, "core/t3.test.cjs": imp, "core/t4.test.mts": imp,
      // //TR: Tur 3: büyük/küçük harf duyarsız test destek yolları içe aktaran SAYILMAZ (spec, selftest, fake-, fixtures, tests, test, fixture, __mocks__); adı benzeyen ama kuralı sağlamayan dosyalar SAYILIR.
      "core/B.SPEC.ts": imp, "core/y-selftest.mjs": imp, "core/Y-SELFTEST.ts": imp, "core/fake-x.mjs": imp, "core/FAKE-y.ts": imp,
      "core/fixtures/a.ts": rimp, "core/Fixtures/b.ts": rimp, "core/tests/c.ts": rimp, "core/Test/d.ts": rimp, "core/fixture/e.ts": rimp, "core/__mocks__/f.ts": rimp, "core/DIST/g.ts": rimp, "core/Node_Modules/h.ts": rimp,
      "core/contest/x.ts": rimp, "core/tests.ts": imp, "core/my-fake-tool.mjs": imp, "core/prefixed-selftest-tool.mjs": imp,
      "core/prefixed.ts": "const a = xfrom(\"./capabilities/resolver.js\"); reimport(\"./capabilities/resolver.js\"); prerequire(\"./capabilities/resolver.js\");\n",
      "core/broken.ts": "import {resolveCapability} from \"./capabilities/resolver.js\";\nconst broken = \"open\n"
    });
    expect(findProductionImporters(root, probe)).toEqual(["core/bare.ts", "core/contest/x.ts", "core/m1.mts", "core/my-fake-tool.mjs", "core/prefixed-selftest-tool.mjs", "core/tests.ts"]);
    // //TR: Uzantısız belirteç .mjs modülüne çözülür (uzantılar iki tarafta aynı biçimde atılır).
    expect(findProductionImporters(fx({"scripts/lib.mjs": "export const a = 1;\n", "scripts/user.mjs": "import {a} from \"./lib\";\n"}), {module: "scripts/lib.mjs", exports: ["a"]})).toEqual(["scripts/user.mjs"]);
    // //TR: Sınıflandırılamayan dosya paket içe aktaranı sayılmaz.
    expect(findPackageImporters(fx({"core/p.ts": "import A from \"ajv\";\nconst broken = \"open\n", "core/q.ts": "import A from \"ajv\";\n"}), "ajv")).toEqual(["core/q.ts"]);
  });

  it("census details: spawn family, word boundaries, regex metacharacters, case, de-duplication, sorting, exclusion reasons", () => {
    const root = fx({
      "core/b.ts": "const m = \"acme-tool\"; const exact = \"a.b\";\n",
      "core/a.ts": "execFile(\"tool-ef\", []); execFileSync('Tool.EXE', []); spawn( \"sp-tool\", []); spawnSync(`ss-tool`, []); const myspawn = (x, y) => 0; myspawn(\"not-a-cmd\", []);\nconst m1 = \"acme-tool\"; const m2 = \"acme-tool\"; const dots = \"aXb\"; const lower = \"mixed-case\";\n",
      "core/z-broken.ts": "const x = \"open\n", "automation/m-broken.mjs": "const w = \"open\n", "core/a-broken.ts": "const y = \"open\n"
    });
    const c = withReversedDirs(() => censusProduction(root, ["acme-tool", "a.b", "Mixed-Case"]));
    expect([...c.registryIds.entries()]).toEqual([["acme-tool", ["core/a.ts", "core/b.ts"]], ["Mixed-Case", ["core/a.ts"]], ["a.b", ["core/b.ts"]]]);
    expect([...c.commands.entries()]).toEqual([["tool-ef", ["core/a.ts"]], ["Tool.EXE", ["core/a.ts"]], ["sp-tool", ["core/a.ts"]], ["ss-tool", ["core/a.ts"]]]);
    expect(c.unparseable).toEqual(["automation/m-broken.mjs", "core/a-broken.ts", "core/z-broken.ts"]);
    const none = {registryIds: {}, commands: {}};
    expect(censusProblems({...c, unparseable: []}, [], none).filter(p => p.startsWith("REGISTRY_ID_UNMAPPED:acme-tool"))).toEqual(["REGISTRY_ID_UNMAPPED:acme-tool:core/a.ts"]);
    // //TR: Eşlenmiş ama görülmeyen bir kimlik için dışlama yalnız ALSO_MAPPED verir (STALE değil); boş gerekçe UNMAPPED değil WITHOUT_REASON verir.
    expect(censusProblems({registryIds: new Map(), commands: new Map(), unparseable: []}, [rec({adapterId: "ghost-id"})], {registryIds: {"ghost-id": "reason"}, commands: {}})).toEqual(["REGISTRY_ID_EXCLUSION_ALSO_MAPPED:ghost-id"]);
    expect(censusProblems({...c, commands: new Map(), unparseable: []}, [rec({adapterId: "a.b"}), rec({adapterId: "Mixed-Case"})], {registryIds: {"acme-tool": ""}, commands: {}})).toEqual(["REGISTRY_ID_EXCLUSION_WITHOUT_REASON:acme-tool"]);
  });

  it("workflow and registry readers: indented YAML comments, name order, every adapter row is validated", () => {
    const wfRoot = fx({".github/workflows/c.yml": "- run: echo C-MARK\n", ".github/workflows/a.yaml": "jobs:\n    #node tools/indented.mjs\n  x: A-MARK\n", ".github/workflows/e.yml": "- run: echo E-MARK\n", ".github/workflows/b.yml": "- run: echo B-MARK\n", ".github/workflows/d.yaml": "- run: echo D-MARK\n"});
    const wf = withReversedDirs(() => readWorkflowTexts(wfRoot));
    expect(wf.map(t => /([A-E])-MARK/.exec(t)![1])).toEqual(["A", "B", "C", "D", "E"]);
    expect(wf[0]).not.toContain("indented.mjs");
    const good = {id: "a", category: "C", status: "REGISTERED", implementation: "NOT_IMPLEMENTED"};
    const load = (rows: unknown[]) => { const r = fx({"registries/tool-adapters.json": JSON.stringify({adapters: rows})}); return () => loadRegistryAdapters(r); };
    expect(load([good, good])()).toHaveLength(2);
    for (const bad of [{...good, id: 1}, {...good, status: 1}, {...good, implementation: 1}]) {
      expect(load([bad]), JSON.stringify(bad)).toThrow("ADAPTER_REGISTRY_UNAVAILABLE:registries/tool-adapters.json");
      expect(load([good, bad]), `second ${JSON.stringify(bad)}`).toThrow("ADAPTER_REGISTRY_UNAVAILABLE:registries/tool-adapters.json");
    }
  });

  it("registry loader fails closed", () => {
    const rel = "registries/tool-adapters.json";
    const root = (body: string | null) => { const r = fs.mkdtempSync(path.join(tmp, "reg-")); if (body !== null) { fs.mkdirSync(path.join(r, "registries")); fs.writeFileSync(path.join(r, rel), body); } return r; };
    for (const body of [null, "{not json", JSON.stringify({adapters: "none"}), JSON.stringify({adapters: []}), JSON.stringify({adapters: [{id: "x"}]})]) expect(() => loadRegistryAdapters(root(body)), String(body)).toThrow(`ADAPTER_REGISTRY_UNAVAILABLE:${rel}`);
    expect(loadRegistryAdapters(root(JSON.stringify({adapters: [{id: "x", category: "C", status: "REGISTERED", implementation: "NOT_IMPLEMENTED"}]})))).toHaveLength(1);
    expect(loadRegistryAdapters(REPO)).toHaveLength(194);
  });
});
