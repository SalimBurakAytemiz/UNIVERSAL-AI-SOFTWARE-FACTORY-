// //TR: Bu vaka dosyası (kayıtlı tests/v7-b7-installer.test.ts tarafından içe aktarılır; ayrı korumalı kayıt gerektirmez) UASCO-T0109 ürün/dev-plane sınır bekçisidir. Gönderilen ürünün
// giriş noktalarından (masaüstü ana süreç + preload + renderer, Control API sunucusu + paketli giriş, paketli modda çocuk süreç olarak çalışan RUNTIME_SCRIPTS) göreli import grafiği
// (statik, yeniden dışa aktarım, değişmez dinamik import ve require; TypeScript preProcessFile) çıkarılır. POZİTİF izin listesi: erişilen her depo dosyası ya ürüne ait bir önekte
// (apps/desktop/, apps/control-api/, core/) ya da aşağıdaki gerekçeli KNOWN_DEVPLANE_DEPENDENCIES listesinde olmalıdır. Liste bir mandaldır: yeni bir dev-plane bağımlılığı eklenirse test
// düşer; listedeki bir girdi artık erişilmiyorsa da düşer (liste yalnız küçülebilir). docs/, factory-v2, scripts/ci/, .github/, otonomi yürütücüsü, merge-gate ve automation/ altındaki
// listelenmemiş her dosya kesin yasaktır. Ürün dosyalarında değişmez olmayan dinamik import/require (çözülemeyen yükleme) da reddedilir.
import {describe, it, expect} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "..", "..");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Gönderilen ürünün giriş noktaları (paketli kurulumun çalıştırdığı kod). */
export const PRODUCT_ENTRY_POINTS = Object.freeze([
  "apps/desktop/main.mjs",
  "apps/desktop/preload.mjs",
  "apps/desktop/renderer/app.js",
  "apps/control-api/src/server.ts",
  "apps/control-api/src/packaged-entry.ts"
]);
/** Ürüne ait önekler (pozitif izin listesi). */
export const PRODUCT_PREFIXES = Object.freeze(["apps/desktop/", "apps/control-api/", "core/"]);
/** Hiçbir izin listesi girdisinin dahi kapsayamayacağı dev-plane yolları. */
const FORBIDDEN_RE = /^(docs\/|factory-v2\/|scripts\/ci\/|\.github\/|automation\/(?!lib\/))|(^|\/)(merge-gate|autonomy-executor|factory-supervisor)[^/]*$/;

/**
 * Bugün (UASCO-T0109 envanteri, base a38c073f) ürünün erişebildiği dev-plane modülleri; her biri gerekçeli ve ayrıştırma sahibi belirtilmiş.
 * automation/lib/ korumalı güven kökü önekidir (config/protected-paths.json protectedPrefixes) ve doğrudan içe aktaranların çoğu korumalı dosyalardır (server.ts, main.mjs);
 * bu yüzden taşıma/kesme Founder kararı + Founder-tier değişiklik gerektirir. Bu liste YALNIZ küçülebilir.
 */
export const KNOWN_DEVPLANE_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({
  "automation/lib/control-boundary.mjs": "Control token proof, host header and port checks shared by main.mjs/server.ts/packaged-entry.ts (trust-root; move needs Founder-tier).",
  "automation/lib/phase0-contract.mjs": "Transitive via control-boundary (verifyPhase0ForControl).",
  "automation/lib/atomic-json.mjs": "Transitive via control-boundary/phase0-contract (atomic JSON + hash chain).",
  "automation/lib/control-audit.mjs": "Control API audit journal (server.ts).",
  "automation/lib/context-budget.mjs": "Transitive via control-audit.",
  "automation/lib/redaction.mjs": "Transitive via control-audit (trust-root exact path).",
  "automation/lib/env-policy.mjs": "safeChildEnv for child processes (server.ts, core/workos).",
  "automation/lib/git-isolation.mjs": "spawnGitSync for managed repositories (server.ts, core/workos).",
  "automation/lib/global-stop.mjs": "GLOBAL_STOP state shared by the product and the supervisor (server.ts).",
  "automation/lib/process-lock.mjs": "Single-instance Control API lock (server.ts).",
  "automation/lib/retry-authority.mjs": "Factory scheduler retry authority surfaced by the control tower (server.ts).",
  "automation/lib/scheduler.mjs": "Factory scheduler state read/written by control routes (server.ts).",
  "automation/lib/scheduler-completion.mjs": "Factory scheduler completion evidence check (server.ts).",
  "automation/lib/evidence-signing.mjs": "Transitive via scheduler-completion (trust-root exact path).",
  "automation/lib/orchestrator-state.mjs": "Factory orchestrator state shown in the cockpit (server.ts).",
  "automation/lib/failure-classifier.mjs": "Run failure classification (core/workos/runner.ts).",
  "automation/lib/npm-invocation.mjs": "Transitive via the packaged RUNTIME_SCRIPTS (capture-provider-provenance).",
  "scripts/capture-provider-provenance.mjs": "Packaged RUNTIME_SCRIPTS: executed as a child process by core/workos/executor-setup.ts (trust-root).",
  "scripts/claude-builder-broker.mjs": "Packaged RUNTIME_SCRIPTS: LOCAL_CLAUDE executor broker run as a child process (trust-root)."
});

function resolveSpecifier(from: string, spec: string): string | null {
  const b = path.resolve(path.dirname(from), spec);
  for (const c of [b, b.replace(/\.js$/, ".ts"), b.replace(/\.mjs$/, ".mts"), `${b}.ts`, `${b}.js`, `${b}.mjs`, path.join(b, "index.ts"), path.join(b, "index.js")])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
// değişmez olmayan dinamik import/require (yorumlar ve dizeler kabaca ayıklanmış metinde)
const NON_LITERAL_LOAD_RE = /(?<![\w$.])(?:import|require)\s*\(\s*(?![\s"'`)]|`[^`$]*`)/;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

export interface ProductGraph { files: string[]; parent: Map<string, string>; problems: string[] }
/** Ürün giriş noktalarının (+ verilen çocuk-süreç script'lerinin) göreli import kapanışı; çözülemeyen göreli belirteç ve değişmez olmayan yükleme sorun olarak raporlanır. */
export function productImportGraph(entries: readonly string[], executed: readonly string[] = []): ProductGraph {
  const parent = new Map<string, string>(), problems: string[] = [], queue: string[] = [];
  for (const e of [...entries, ...executed]) { const abs = path.resolve(ROOT, e); if (!fs.existsSync(abs)) { problems.push(`ENTRY_MISSING ${e}`); continue; } parent.set(abs, "ENTRY"); queue.push(abs); }
  while (queue.length) {
    const file = queue.shift()!, src = fs.readFileSync(file, "utf8");
    if (NON_LITERAL_LOAD_RE.test(stripComments(src).replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""'))) problems.push(`NON_LITERAL_LOAD in ${rel(file)}`);
    for (const {fileName: spec} of ts.preProcessFile(src, true, true).importedFiles) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue; // node:/paket belirteçleri depo dosyası değildir
      const target = resolveSpecifier(file, spec);
      if (!target) { problems.push(`UNRESOLVED ${spec} in ${rel(file)}`); continue; }
      if (!parent.has(target)) { parent.set(target, rel(file)); queue.push(target); }
    }
  }
  return {files: [...parent.keys()].map(rel).sort(), parent, problems};
}

/** Paketli modda çocuk süreç olarak çalışan UASCO script'leri (scripts/build-installer.mjs RUNTIME_SCRIPTS, tek kaynak). */
const runtimeScripts = async (): Promise<{RUNTIME_SCRIPTS: string[]}> => import(pathToFileURL(path.join(ROOT, "scripts", "build-installer.mjs")).href);

export function registerDevplaneBoundaryT0109Cases(): void {
  describe("UASCO-T0109: shipped product entry points reach no dev-plane code beyond the shrinking, justified allow-list", () => {
    it("the import closure of the product entry points (plus packaged RUNTIME_SCRIPTS) stays inside product prefixes or the KNOWN_DEVPLANE_DEPENDENCIES ratchet", async () => {
      const {RUNTIME_SCRIPTS} = await runtimeScripts();
      const g = productImportGraph(PRODUCT_ENTRY_POINTS, RUNTIME_SCRIPTS);
      expect(g.problems.filter(p => !p.startsWith("NON_LITERAL_LOAD"))).toEqual([]);
      expect(g.files.length).toBeGreaterThan(PRODUCT_ENTRY_POINTS.length);
      const outside = g.files.filter(f => !PRODUCT_PREFIXES.some(p => f.startsWith(p)));
      const why = (f: string) => `${f} <- ${g.parent.get(path.join(ROOT, f))}`;
      // 1) kesin yasak yollar hiçbir koşulda erişilmez
      expect(outside.filter(f => FORBIDDEN_RE.test(f)).map(why)).toEqual([]);
      // 2) listelenmemiş yeni dev-plane bağımlılığı yok
      expect(outside.filter(f => !(f in KNOWN_DEVPLANE_DEPENDENCIES)).map(why)).toEqual([]);
      // 3) mandal: listedeki her girdi hâlâ erişiliyor (kesildiyse listeden çıkarılmalı)
      expect(Object.keys(KNOWN_DEVPLANE_DEPENDENCIES).filter(f => !outside.includes(f))).toEqual([]);
      for (const f of Object.keys(KNOWN_DEVPLANE_DEPENDENCIES)) expect(FORBIDDEN_RE.test(f), f).toBe(false);
    });

    it("product files (apps/desktop, apps/control-api, core) contain no non-literal dynamic import/require that the boundary guard cannot resolve", async () => {
      const {RUNTIME_SCRIPTS} = await runtimeScripts();
      const g = productImportGraph(PRODUCT_ENTRY_POINTS, RUNTIME_SCRIPTS);
      const productLoads = g.problems.filter(p => p.startsWith("NON_LITERAL_LOAD") && PRODUCT_PREFIXES.some(x => p.includes(` in ${x}`)));
      expect(productLoads).toEqual([]);
    });

    it("the guard is not vacuous: a synthetic product file importing docs/, factory-v2 or an unlisted automation module is caught; a non-literal import is flagged", () => {
      // Sentetik dizin depo İÇİNDE (git-ignore'lu node_modules/ altında) açılır: os.tmpdir() başka bir sürücüdeyse (Windows CI: C: vs D:) path.relative mutlak "D:/..." verir ve
      // göreli belirteç olmadığı için bekçi onu atlar (test boşa geçerdi). Belirtecin gerçekten göreli olduğu ayrıca doğrulanır.
      const base = path.join(ROOT, "node_modules");
      fs.mkdirSync(base, {recursive: true});
      const dir = fs.mkdtempSync(path.join(base, ".t0109-guard-")), up = path.relative(dir, ROOT).split(path.sep).join("/");
      try {
        expect(up.startsWith("../") && !path.isAbsolute(up) && !/^[A-Za-z]:/.test(up), up).toBe(true);
        fs.writeFileSync(path.join(dir, "entry.ts"), `import "./ok.js";\nimport x from "${up}/automation/lib/scheduler.mjs";\nconst m = "${up}/x"; await import(m);\nexport default x;\n`);
        fs.writeFileSync(path.join(dir, "ok.ts"), `export const ok = 1;\nimport "${up}/automation/lib/dependency-install.mjs";\n`);
        const g = productImportGraph([path.join(dir, "entry.ts")]);
        const synthetic = `${rel(dir)}/`;
        expect(g.files).toEqual(expect.arrayContaining([`${synthetic}entry.ts`, `${synthetic}ok.ts`]));
        const outside = g.files.filter(f => !f.startsWith(synthetic) && !PRODUCT_PREFIXES.some(p => f.startsWith(p)));
        expect(outside).toContain("automation/lib/dependency-install.mjs");
        expect(outside.filter(f => !(f in KNOWN_DEVPLANE_DEPENDENCIES))).toContain("automation/lib/dependency-install.mjs");
        expect(g.problems.some(p => p.startsWith("NON_LITERAL_LOAD") && p.includes("entry.ts"))).toBe(true);
        for (const f of ["docs/planning/x.md", "factory-v2/run.mjs", "scripts/ci/uasco-review/run.mjs", ".github/workflows/ci.yml", "automation/factory-supervisor.mjs", "scripts/merge-gate.mjs"]) expect(FORBIDDEN_RE.test(f), f).toBe(true);
        for (const f of ["core/workos/runner.ts", "apps/desktop/main.mjs", "automation/lib/scheduler.mjs"]) expect(FORBIDDEN_RE.test(f), f).toBe(false);
      } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });
  });
}
