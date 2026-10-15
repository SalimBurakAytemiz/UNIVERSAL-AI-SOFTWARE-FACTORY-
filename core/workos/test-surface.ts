// //TR: Bu dosya REL-FX-2 test yüzeyi korumasının saf yardımcılarını tanımlar: base..head name-status çıktısını ayrıştırır, test yollarını sabit glob listesiyle (ve test komutunun dosya argümanlarıyla) sınıflar, test harness yapılandırma değişikliklerini (vitest/jest/playwright config, conftest.py, package.json scripts.test, pytest ini bölümleri) test yüzeyi sayar, master change-guard'ın assertion sayımı fikrini ve devre dışı bırakılmış test işaretlerini (skip/only/todo/xit/skipIf, node:test {skip}, pytest/unittest skip) karşılaştırır, ANSI/VT kaçışlarını temizleyerek test koşucusu çıktısından yalnız yürütülen (passed + failed) test sayısını okur ve functionalAcceptance durumunu dürüstçe türetir (bağımsız/sabitlenmiş oracle yoksa asla VERIFIED değildir; okunamayan çıktı UNKNOWN'dır, yürütülmüş sayılmaz).

export type TestChangeStatus = "ADDED" | "MODIFIED" | "DELETED" | "RENAMED";
export interface NameStatusEntry { status: TestChangeStatus; path: string; oldPath?: string }
export interface WeakenedTest { path: string; before: number; after: number; reason: "ASSERTION_COUNT_REDUCED" | "SKIP_OR_ONLY_ADDED" }
export type TestSurfaceAcceptance = "BLOCKED" | "UNVERIFIED_VACUOUS" | "UNVERIFIED_ORACLE" | "UNKNOWN";
export type TestRunFormat = "vitest" | "jest" | "tap" | "pytest" | "cargo" | "dotnet" | "mocha";
// executed = passed + failed (gerçekten yürütülen); skipped/todo/pending/ignored ayrı raporlanır, asla yürütülmüş sayılmaz.
export interface TestRunSummary { format: TestRunFormat; executed: number; passed: number; failed: number; skipped: number; todo: number }
export interface TestSurfaceSummary {
  schemaVersion: 1; baseSha: string; headSha: string; testGlobs: readonly string[]; harnessGlobs: readonly string[];
  added: string[]; modified: string[]; deleted: string[]; renamed: {from: string; to: string}[]; weakened: WeakenedTest[]; trivialAdded: string[]; harness: string[];
  executedTests: number | null; testRun: TestRunSummary | null; oracle: "NONE"; functionalAcceptance: TestSurfaceAcceptance; reason: string; truncated: boolean;
}

// Repo test glob'ları (master change-guard tests/** kuralı + yaygın ekosistem kalıpları). Belgeleme için glob, eşleme için eşdeğer regex.
export const TEST_GLOBS: readonly string[] = ["tests/**", "test/**", "**/tests/**", "**/test/**", "spec/**", "specs/**", "**/spec/**", "**/specs/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/*_spec.*", "**/*Spec.*",
  "**/*.cy.*", "**/*.e2e-spec.*", "**/test_*.py", "**/test.{js,mjs,cjs,ts}"];
// RV-RELFX-C4-002: koşular büyük/küçük harfe duyarsız NTFS'te yürür; test yolu desenleri de duyarsız (i) eşlenir (Tests/, A.Test.ts, TEST_a.py varyantları test sayılır; fail-closed).
const TEST_PATH_RES: readonly RegExp[] = [/(^|\/)tests?\//i, /(^|\/)specs?\//i, /(^|\/)__tests__\//i, /\.(test|spec)\.[A-Za-z0-9]+$/i, /_(test|spec)\.[A-Za-z0-9]+$/i, /[^/]Spec\.[A-Za-z0-9]+$/i,
  /\.cy\.[A-Za-z0-9]+$/i, /\.e2e-spec\.[A-Za-z0-9]+$/i, /(^|\/)test_[^/]*\.py$/i, /(^|\/)test\.(js|mjs|cjs|ts)$/i];
// Test harness yapılandırması: bu dosyalar testlerin hangi kapsamda/nasıl koşacağını belirler; değişiklikleri TEST_SURFACE sayılır (harness listesi).
// Koşulsuz: config dosyaları (vite.config.* dahil: vitest test bloğunu taşıyabilir; blok ayrıştırılmaz, fail-closed dosyanın her değişikliği sayılır), conftest.py (her dizinde),
// pytest.ini, tox.ini. Koşullu: package.json yalnız scripts.test/pretest/posttest veya üst düzey jest/mocha/ava anahtarları değişince,
// setup.cfg yalnız [tool:pytest] bölümü, pyproject.toml yalnız [tool.pytest.ini_options] bölümü değişince.
// RV-RELFX-C3-004: ava.config.* ve karma.conf.* koşulsuz harness'tır; package.json'da mission testCommand'ının adlandırdığı betik (npm/pnpm/yarn run <ad>) ve pre/post eşleri de karşılaştırılır.
export const HARNESS_GLOBS: readonly string[] = ["**/vitest.config.*", "**/vite.config.*", "**/vitest.workspace.*", "**/jest.config.*", "**/playwright.config.*", "**/cypress.config.*", "**/ava.config.*", "**/karma.conf.*", "**/.mocharc*", "**/conftest.py", "**/pytest.ini", "**/tox.ini",
  "**/package.json (scripts.test|pretest|posttest, the script named by testCommand and its pre/post, jest, mocha, ava)", "**/setup.cfg ([tool:pytest])", "**/pyproject.toml ([tool.pytest.ini_options])"];
// RV-RELFX-C4-002: koşulsuz harness desenleri de büyük/küçük harfe duyarsız (i) eşlenir (Vitest.config.ts, Conftest.py, PYTEST.INI harness sayılır; fail-closed).
const HARNESS_ALWAYS_RES: readonly RegExp[] = [/(^|\/)(?:vitest|vite|jest|playwright|cypress|ava)\.config\.[A-Za-z0-9.]+$/i, /(^|\/)karma\.conf\.[A-Za-z0-9.]+$/i, /(^|\/)vitest\.workspace\.[A-Za-z0-9.]+$/i, /(^|\/)\.mocharc(?:\.[A-Za-z0-9]+)?$/i,
  /(^|\/)conftest\.py$/i, /(^|\/)(?:pytest|tox)\.ini$/i];
const CODE_RE = /\.(m?[jt]sx?|cjs|cts|mts|py|go|rs|java|cs|kt|rb|php)$/;
const MAX_LIST = 200;
const norm = (p: string) => p.replace(/\\/g, "/");

// Test komutunun (argv) göreli dosya argümanları da test yüzeyidir (ör. ["node", "check.mjs"]; RV-RELFX-C3-004: --config=x.mjs biçimindeki seçenek değerleri dahil).
export function isTestPath(p: string, testCommand: readonly string[] = []): boolean {
  const n = norm(p);
  if (TEST_PATH_RES.some(re => re.test(n))) return true;
  const fileArgs = testCommand.slice(1).map(a => (a.startsWith("-") ? (a.includes("=") ? a.slice(a.indexOf("=") + 1) : "") : a));
  return fileArgs.some(a => a !== "" && /\.[A-Za-z0-9]+$/.test(a) && norm(a).replace(/^\.\//, "") === n);
}
// Mission testCommand'ının adlandırdığı package.json betikleri: npm/pnpm/yarn run|run-script <ad>, npm test|t|tst, yarn/pnpm <ad>. Bilinmeyen biçimde boş liste (yalnız scripts.test karşılaştırılır).
export function testCommandScripts(testCommand: readonly string[] = []): string[] {
  const [exe, ...rest] = testCommand;
  if (exe !== "npm" && exe !== "pnpm" && exe !== "yarn") return [];
  const args = rest.filter(a => !a.startsWith("-"));
  const name = args[0] === "run" || args[0] === "run-script" ? args[1] : args[0] === "t" || args[0] === "tst" ? "test" : exe !== "npm" || args[0] === "test" ? args[0] : undefined;
  return name ? [`pre${name}`, name, `post${name}`] : [];
}

// INI/TOML bölüm metni (başlıktan bir sonraki başlığa kadar); bölüm yoksa null.
function iniSection(s: string | null, header: string): string | null {
  if (s === null) return null;
  const lines = s.replace(/\r\n?/g, "\n").split("\n"), i = lines.findIndex(l => l.trim() === header);
  if (i < 0) return null;
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (/^\s*\[/.test(l)) break; out.push(l.trimEnd()); }
  return out.join("\n").trim();
}
// package.json test betikleri ve test koşucusu yapılandırma anahtarları (jest/mocha/ava); ayrıştırılamazsa ham metin döner (karşılaştırma fail-closed: ham metin farkı değişiklik sayılır).
function testScripts(s: string | null, named: readonly string[] = []): string | null {
  if (s === null) return null;
  try {
    const j = JSON.parse(s) as {scripts?: Record<string, unknown>; jest?: unknown; mocha?: unknown; ava?: unknown}; const sc = j?.scripts ?? {};
    const own = (k: string) => (Object.prototype.hasOwnProperty.call(sc, k) ? sc[k] : null);
    return JSON.stringify([own("test"), own("pretest"), own("posttest"), j?.jest ?? null, j?.mocha ?? null, j?.ava ?? null, ...named.map(own)]);
  } catch { return `UNPARSEABLE:${s}`; }
}
// Harness yapılandırma değişikliği mi? contentAt yalnız koşullu dosyalarda okunur (before: base'deki eski yol, after: head'deki yol).
export function isHarnessChange(e: NameStatusEntry, baseSha: string, headSha: string, contentAt: (ref: string, path: string) => string | null, testCommand: readonly string[] = []): boolean {
  const after = norm(e.path), before = norm(e.oldPath ?? e.path);
  if ([after, before].some(p => HARNESS_ALWAYS_RES.some(re => re.test(p)))) return true;
  const b = (p: string) => (e.status === "ADDED" ? null : contentAt(baseSha, p)), a = (p: string) => (e.status === "DELETED" ? null : contentAt(headSha, p));
  const named = (p: string, n: string) => (p.split("/").pop() ?? "").toLowerCase() === n.toLowerCase(); // RV-RELFX-C4-002: taban ad eşlemesi büyük/küçük harfe duyarsız (Package.json, Setup.cfg, PyProject.toml; fail-closed)
  const differs = (n: string, view: (s: string | null) => string | null) => view(named(before, n) ? b(before) : null) !== view(named(after, n) ? a(after) : null);
  const scripts = testCommandScripts(testCommand);
  if (named(after, "package.json") || named(before, "package.json")) return differs("package.json", x => testScripts(x, scripts));
  if (named(after, "setup.cfg") || named(before, "setup.cfg")) return differs("setup.cfg", x => iniSection(x, "[tool:pytest]"));
  if (named(after, "pyproject.toml") || named(before, "pyproject.toml")) return differs("pyproject.toml", x => iniSection(x, "[tool.pytest.ini_options]"));
  return false;
}

// `git diff --name-status -z --find-renames` çıktısı: durum NUL yol [NUL yeni-yol]. Bilinmeyen durumlar (C, T, U, X) değiştirilmiş sayılır (yok sayılmaz).
export function parseNameStatusZ(out: string): NameStatusEntry[] {
  const t = out.split("\0"); const res: NameStatusEntry[] = [];
  for (let i = 0; i < t.length;) {
    const code = t[i++]; if (!code) continue;
    const k = code[0];
    if (k === "R" || k === "C") { const from = t[i++] ?? "", to = t[i++] ?? ""; if (k === "R") res.push({status: "RENAMED", path: to, oldPath: from}); else res.push({status: "ADDED", path: to}); continue; }
    const p = t[i++] ?? "";
    res.push({status: k === "A" ? "ADDED" : k === "D" ? "DELETED" : "MODIFIED", path: p});
  }
  return res;
}

// automation/lib/change-guard.mjs assertionCount fikri (orada export edilmez; korumalı dosya değiştirilmez): expect/assert çağrıları + assert.<yöntem>(.
export function assertionCount(s = ""): number { return (s.match(/\b(?:expect|assert(?:\.\w+)?|assertEquals|assertTrue|assertFalse)\s*\(/g) ?? []).length; }
// Testi devre dışı bırakan/daraltan işaretler: .skip/.only/.todo/.skipIf/.runIf( ve zincirli biçimleri (it.skip.each(t)(, describe.skip.each(, test.only.each(;
// vitest/jest/mocha/node:test t.skip, pytest.skip), xit/xdescribe/xtest/fit/fdescribe( (xit.each( dahil), node:test/vitest seçenek nesnesi {skip|todo|only: <false olmayan>}
// ve kısaltması { skip } / { todo } / { only } (adlı ilk argümandan sonra veya adsız ilk argüman olarak: test({ skip: true }, fn)), pytest.mark.skip/skipif/xfail (parantezli/parantezsiz), unittest skip/skipIf/skipUnless/expectedFailure,
// self.skipTest(, Go t.Skip(, Rust #[ignore], JUnit @Disabled/@Ignore, xUnit Skip = "...". Sayı artışı (mevcut testte) zayıflatmadır.
// REL-FX c4: bu dedektör yalnız en iyi çaba risk sinyalidir (BLOCKED etiketi); garanti COMPLETE kapısındaki yapısal onay kuralıdır (outcomes.ts testChangesRequirement):
// mevcut test/harness değişikliği desen kaçırılsa da Founder onayı olmadan tamamlanamaz. c4 desen düzeltmeleri: değiştirici zincirinden sonra tagged template (it.skip.each`...`,
// xit.each`...`; RV-RELFX-C3-001), üye alıcılı node:test alt testi t.test(ad, {skip|todo|only}, fn) (RV-RELFX-C3-002), takma adlı pytest/unittest biçimleri (mark.skip/skipif/xfail,
// @<alias>.skip, çıplak skip(/xfail(, importorskip(, SkipTest; RV-RELFX-C3-003).
const DISABLED_RES: readonly RegExp[] = [
  /\.(?:skip|only|todo|skipIf|runIf)\b(?:\.\w+)*\s*[(`]/g,
  /(?<![.\w$])[xf](?:it|describe|test|context|specify)(?:\.\w+)*\s*[(`]/g,
  /(?<![.\w$])(?:[A-Za-z_$][\w$]*\.)*(?:it|test|describe|suite|specify|context)(?:\.\w+)*\s*\(\s*(?:(?:`[^`]*`|'[^']*'|"[^"]*"|[\w.]+)\s*,\s*)?\{[^{}]*?(?<=[{,]\s*)(?:["']?(?:skip|todo|only)["']?\s*:(?!\s*(?:false\b|null\b|undefined\b|0\b|''|""|[,}]))|(?:skip|todo|only)\s*(?=[,}]))/g,
  /\bmark\.(?:skip|skipif|xfail)\b/g,
  /\bunittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b/g,
  /^\s*@(?:skip|skipIf|skipUnless|expectedFailure|skipif|xfail)\b/gm,
  /^\s*@[A-Za-z_][\w.]*\.(?:skip|skipIf|skipUnless|expectedFailure)\b/gm,
  /(?<![.\w$])(?:skip|xfail)\s*\(/g,
  /\.xfail\s*\(/g,
  /\bimportorskip\s*\(/g,
  /\bSkipTest\b/g,
  /\bskipTest\s*\(/g,
  /\.Skip(?:Now|f)?\s*\(/g,
  /#\[ignore\b/g,
  /@(?:Disabled|Ignore)\b/g,
  /\bSkip\s*=\s*"/g
];
export function disabledTestMarkers(s = ""): number { return DISABLED_RES.reduce((n, re) => n + (s.match(re) ?? []).length, 0); }

// ANSI/VT kaçışları: OSC (ESC ] ... BEL|ST, 8-bit OSC), CSI (ESC [ / 8-bit CSI ... son bayt), diğer 2 baytlık ESC dizileri; CR'ler satır sonuna çevrilir.
const ANSI_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u009d[^\u0007\u009c]*(?:\u0007|\u009c)|(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]/g;
export function stripAnsi(s: string): string { return String(s ?? "").replace(ANSI_RE, "").replace(/\r\n?/g, "\n"); }

// Sayım: tanınan kategoriler toplamı bilinen toplamla uyuşmuyorsa ve hiç yürütülen test görünmüyorsa sonuç belirsizdir (null; asla yürütülmüş sayılmaz).
function summary(format: TestRunFormat, passed: number, failed: number, skipped: number, todo: number, total?: number): TestRunSummary | null {
  if (total !== undefined && passed + failed + skipped + todo !== total && passed + failed === 0) return null;
  return {format, executed: passed + failed, passed, failed, skipped, todo};
}
function tally(text: string, buckets: Record<string, "passed" | "failed" | "skipped" | "todo">): {passed: number; failed: number; skipped: number; todo: number} {
  const c = {passed: 0, failed: 0, skipped: 0, todo: 0};
  for (const m of text.matchAll(/(\d+)\s+([A-Za-z]+)/g)) { const b = buckets[m[2].toLowerCase()]; if (b) c[b] += Number(m[1]); }
  return c;
}
// Akış kuralı (RV-RELFX-C2-002): koşucular özetini sabit bir akışa yazar: vitest/node:test TAP/pytest/cargo/dotnet/mocha stdout'a, jest (varsayılan raporlayıcı) stderr'e.
// Sıfır-test işaretleri (No test files found / No tests found / no tests ran) her iki akışta kabul edilir (yalnız 0 yürütme bildirir, asla geçti iddiası değildir).
export type TestOutputStream = "stdout" | "stderr" | "any";
const STREAM_FORMATS: Record<TestOutputStream, readonly TestRunFormat[]> = {stdout: ["vitest", "tap", "pytest", "cargo", "dotnet", "mocha"], stderr: ["jest"], any: ["vitest", "jest", "tap", "pytest", "cargo", "dotnet", "mocha"]};
const SUMMARY_CONFLICT = Symbol("SUMMARY_CONFLICT");
// undefined: tanınan özet yok; null: özet tanındı ama okunamadı veya çelişkili (aynı akışta farklı içerikli birden çok tek-özet satırı); aksi halde özet.
function scanTestRun(output: string, stream: TestOutputStream): TestRunSummary | null | undefined {
  const s = stripAnsi(output), allow = (f: TestRunFormat) => STREAM_FORMATS[stream].includes(f);
  // Tek özet basan koşucular (vitest, jest, TAP, pytest, mocha): test kodunun bastığı sahte özet gerçeğinden farklıysa sonuç çelişkilidir (son satır seçilmez).
  const one = (re: RegExp): RegExpMatchArray | null => { const all = [...s.matchAll(re)]; if (new Set(all.map(m => m[0].trim())).size > 1) throw SUMMARY_CONFLICT; return all.length ? all[all.length - 1] : null; };
  const last = (re: RegExp): RegExpMatchArray | null => { const all = [...s.matchAll(re)]; return all.length ? all[all.length - 1] : null; };
  try {
    // vitest: "Tests  2 passed (2)" veya passWithNoTests ile "Tests  no tests" (RV-RELFX-C2-003: 0 yürütme, UNVERIFIED_VACUOUS).
    const vitest = allow("vitest") ? one(/^\s*Tests\s+(?:(.+?)\s*\((\d+)\)|(no tests))\s*$/gm) : null;
    if (vitest) { if (vitest[3]) return summary("vitest", 0, 0, 0, 0); const c = tally(vitest[1], {passed: "passed", failed: "failed", skipped: "skipped", todo: "todo"}); return summary("vitest", c.passed, c.failed, c.skipped, c.todo, Number(vitest[2])); }
    if (/No test files found/i.test(s)) return summary("vitest", 0, 0, 0, 0);
    const jest = allow("jest") ? one(/^\s*Tests:\s+(.*?)(\d+) total\s*$/gm) : null;
    if (jest) { const c = tally(jest[1], {passed: "passed", failed: "failed", skipped: "skipped", todo: "todo", pending: "skipped"}); return summary("jest", c.passed, c.failed, c.skipped, c.todo, Number(jest[2])); }
    if (/^\s*No tests found\b/m.test(s)) return summary("jest", 0, 0, 0, 0);
    if (allow("tap")) {
      const tapKey = (k: string): number | null => { const m = one(new RegExp(`^\\s*(?:#|ℹ) ${k} (\\d+)\\s*$`, "gm")); return m ? Number(m[1]) : null; };
      const tapTests = tapKey("tests");
      if (tapTests !== null) {
        const pass = tapKey("pass"), fail = tapKey("fail");
        if (pass === null && fail === null) return tapTests === 0 ? summary("tap", 0, 0, 0, 0) : null;
        return summary("tap", pass ?? 0, fail ?? 0, tapKey("skipped") ?? tapKey("skip") ?? 0, tapKey("todo") ?? 0);
      }
    }
    if (/^=*\s*no tests ran\b/im.test(s)) return summary("pytest", 0, 0, 0, 0);
    // pytest: xpassed/xfailed gövdesi yürütülmüş testlerdir (sırasıyla passed/failed kovasına), error(s) failed sayılır; deselected yürütülmemiştir (skipped).
    const PYW = "(?:passed|failed|errors?|skipped|xfailed|xpassed|deselected|warnings?|rerun)";
    const py = allow("pytest") ? one(new RegExp(`^=*\\s*(\\d+ ${PYW}(?:, \\d+ ${PYW})*) in [\\d.]+s\\b.*$`, "gm")) : null;
    if (py) { const c = tally(py[1], {passed: "passed", xpassed: "passed", failed: "failed", xfailed: "failed", error: "failed", errors: "failed", skipped: "skipped", deselected: "skipped"}); return summary("pytest", c.passed, c.failed, c.skipped, c.todo); }
    // cargo/dotnet her test ikilisi/projesi için ayrı özet basar (toplanır; çelişki kuralı uygulanmaz).
    const cargo = allow("cargo") ? [...s.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)] : [];
    if (cargo.length) return summary("cargo", ...cargo.reduce<[number, number, number]>((a, m) => [a[0] + Number(m[1]), a[1] + Number(m[2]), a[2] + Number(m[3])], [0, 0, 0]), 0);
    if (allow("dotnet")) {
      const dn = [...s.matchAll(/Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/g)];
      if (dn.length) { const t = dn.reduce((a, m) => [a[0] + Number(m[2]), a[1] + Number(m[1]), a[2] + Number(m[3]), a[3] + Number(m[4])], [0, 0, 0, 0]); return summary("dotnet", t[0], t[1], t[2], 0, t[3]); }
      const dnTotal = last(/Total tests:\s*(\d+)/g);
      if (dnTotal) {
        const k = (n: string) => { const m = last(new RegExp(`^\\s*${n}:\\s*(\\d+)\\s*$`, "gm")); return m ? Number(m[1]) : null; };
        const p = k("Passed"), f = k("Failed");
        if (p === null && f === null) return Number(dnTotal[1]) === 0 ? summary("dotnet", 0, 0, 0, 0) : null;
        return summary("dotnet", p ?? 0, f ?? 0, k("Skipped") ?? 0, 0, Number(dnTotal[1]));
      }
    }
    const mocha = allow("mocha") ? one(/^\s*(\d+) passing\b/gm) : null;
    if (mocha) { const f = one(/^\s*(\d+) failing\b/gm), p = one(/^\s*(\d+) pending\b/gm); return summary("mocha", Number(mocha[1]), Number(f?.[1] ?? 0), Number(p?.[1] ?? 0), 0); }
    return undefined;
  } catch (e) { if (e === SUMMARY_CONFLICT) return null; throw e; }
}
// Tek metinden özet (akış bilinmiyor; tüm biçimler); tanınmayan, okunamayan veya çelişkili özet null (sayı uydurulmaz).
// Biçim önceliği: vitest, jest, node:test TAP, pytest, cargo, dotnet, mocha.
export function parseTestRunSummary(output: string, stream: TestOutputStream = "any"): TestRunSummary | null { return scanTestRun(output, stream) ?? null; }
// Koşucu stdout/stderr'i ayrı ayrı, akış kuralına göre okunur (birleştirilip son satır seçilmez). Akışlardan biri okunamaz/çelişkiliyse veya iki akış
// farklı özet veriyorsa sonuç null'dır (UNKNOWN; yürütülmüş sayılmaz).
export function parseTestRunStreams(stdout: string, stderr: string): TestRunSummary | null {
  const o = scanTestRun(String(stdout ?? ""), "stdout"), e = scanTestRun(String(stderr ?? ""), "stderr");
  if (o === null || e === null) return null;
  if (o && e) return JSON.stringify(o) === JSON.stringify(e) ? o : null;
  return o ?? e ?? null;
}
// Yürütülen (passed + failed) test sayısı; tanınmayan biçimde null.
export function parseExecutedTestCount(output: string): number | null { return parseTestRunSummary(output)?.executed ?? null; }

export interface EvaluateInput {
  baseSha: string; headSha: string; entries: NameStatusEntry[]; contentAt: (ref: string, path: string) => string | null;
  executedTests: number | null; testRun?: TestRunSummary | null; testCommand?: readonly string[];
}
// Öncelik: silinen/zayıflatılan (assertion azaltma veya devre dışı bırakma) test -> BLOCKED; sıfır yürütülen test veya assertion'sız yeni test -> UNVERIFIED_VACUOUS;
// okunamayan koşucu çıktısı -> UNKNOWN (yürütülmüş sayılmaz); dokunulan test yüzeyi/harness -> UNVERIFIED_ORACLE (mission'a sabitlenmiş bağımsız oracle yok);
// test yüzeyi değişikliği tespit edilmedi -> UNKNOWN. VERIFIED bu dilimde üretilmez.
export function evaluateTestSurface(i: EvaluateInput): TestSurfaceSummary {
  const tc = i.testCommand ?? [], isT = (p: string) => isTestPath(p, tc);
  const added: string[] = [], modified: string[] = [], deleted: string[] = [], renamed: {from: string; to: string}[] = [], weakened: WeakenedTest[] = [], trivialAdded: string[] = [], harness: string[] = [];
  const compare = (beforePath: string, afterPath: string) => {
    if (!CODE_RE.test(afterPath)) return;
    const b = i.contentAt(i.baseSha, beforePath), a = i.contentAt(i.headSha, afterPath);
    if (b === null || a === null) return;
    const nb = assertionCount(b), na = assertionCount(a);
    if (nb > 0 && na < nb) weakened.push({path: afterPath, before: nb, after: na, reason: "ASSERTION_COUNT_REDUCED"});
    else if (disabledTestMarkers(a) > disabledTestMarkers(b)) weakened.push({path: afterPath, before: nb, after: na, reason: "SKIP_OR_ONLY_ADDED"});
  };
  for (const e of i.entries) {
    // RV-RELFX-C4-001: harness sınıflaması test-yolu dalından bağımsızdır. Harness kontrolü her name-status girişinde (RENAMED'de hem eski hem yeni yolda, isHarnessChange içinde)
    // önce çalışır: sabit harness listesine uyan EKLENEN veya bir test dizinine YENİDEN ADLANDIRILAN bir yapılandırma dosyası (ör. tests/vitest.config.ts, tests/conftest.py),
    // bir test dizini altında olsa bile harness sayılır ve onay gerektirir (testChangesRequirement.required). Harness OLMAYAN yeni test dosyaları aşağıda S4 onaysız yolunu korur.
    if (isHarnessChange(e, i.baseSha, i.headSha, i.contentAt, tc)) { harness.push(e.path); continue; }
    if (e.status === "RENAMED" && e.oldPath !== undefined) {
      const fromT = isT(e.oldPath), toT = isT(e.path);
      if (fromT && !toT) { deleted.push(e.oldPath); continue; } // test glob'u dışına taşımak testi siler
      if (!fromT && !toT) continue; // harness olmayan, test olmayan taşıma: yüzey dışı
      if (!fromT) { added.push(e.path); continue; } // harness olmayan, test dizinine eklenen yeni test (S4 onaysız)
      renamed.push({from: e.oldPath, to: e.path}); compare(e.oldPath, e.path); continue;
    }
    if (!isT(e.path)) continue; // harness olmayan, test olmayan değişiklik: yüzey dışı
    if (e.status === "DELETED") deleted.push(e.path);
    else if (e.status === "ADDED") { added.push(e.path); const a = CODE_RE.test(e.path) ? i.contentAt(i.headSha, e.path) : null; if (a !== null && assertionCount(a) === 0) trivialAdded.push(e.path); }
    else { modified.push(e.path); compare(e.path, e.path); }
  }
  const [functionalAcceptance, reason]: [TestSurfaceAcceptance, string] =
    deleted.length ? ["BLOCKED", "TEST_DELETED"]
    : weakened.length ? ["BLOCKED", "TEST_WEAKENED"]
    : i.executedTests === 0 ? ["UNVERIFIED_VACUOUS", "ZERO_TESTS_EXECUTED"]
    : trivialAdded.length ? ["UNVERIFIED_VACUOUS", "TRIVIAL_TEST_ADDED"]
    : i.executedTests === null ? ["UNKNOWN", "EXECUTED_TEST_COUNT_UNPARSEABLE"]
    : added.length || modified.length || renamed.length || harness.length ? ["UNVERIFIED_ORACLE", "TEST_SURFACE_CHANGED_NO_PINNED_ORACLE"]
    : ["UNKNOWN", "NO_TEST_SURFACE_CHANGE_DETECTED_NO_PINNED_ORACLE"];
  const cap = <T>(xs: T[]) => xs.slice(0, MAX_LIST);
  const truncated = [added, modified, deleted, renamed, weakened, trivialAdded, harness].some(x => x.length > MAX_LIST);
  return {schemaVersion: 1, baseSha: i.baseSha, headSha: i.headSha, testGlobs: TEST_GLOBS, harnessGlobs: HARNESS_GLOBS, added: cap(added), modified: cap(modified), deleted: cap(deleted), renamed: cap(renamed), weakened: cap(weakened), trivialAdded: cap(trivialAdded), harness: cap(harness),
    executedTests: i.executedTests, testRun: i.testRun ?? null, oracle: "NONE", functionalAcceptance, reason, truncated};
}
