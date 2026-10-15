// //TR: Bu dosya REL-FX-2 test yüzeyi korumasının saf yardımcılarını tanımlar: base..head name-status çıktısını ayrıştırır, test yollarını sabit glob listesiyle (ve test komutunun dosya argümanlarıyla) sınıflar, master change-guard'ın assertion sayımı fikrini yeniden kullanır, test koşucusu çıktısından yürütülen test sayısını okur ve functionalAcceptance durumunu dürüstçe türetir (bağımsız/sabitlenmiş oracle yoksa asla VERIFIED değildir).

export type TestChangeStatus = "ADDED" | "MODIFIED" | "DELETED" | "RENAMED";
export interface NameStatusEntry { status: TestChangeStatus; path: string; oldPath?: string }
export interface WeakenedTest { path: string; before: number; after: number; reason: "ASSERTION_COUNT_REDUCED" | "SKIP_OR_ONLY_ADDED" }
export type TestSurfaceAcceptance = "BLOCKED" | "UNVERIFIED_VACUOUS" | "UNVERIFIED_ORACLE" | "UNKNOWN";
export interface TestSurfaceSummary {
  schemaVersion: 1; baseSha: string; headSha: string; testGlobs: readonly string[];
  added: string[]; modified: string[]; deleted: string[]; renamed: {from: string; to: string}[]; weakened: WeakenedTest[]; trivialAdded: string[];
  executedTests: number | null; oracle: "NONE"; functionalAcceptance: TestSurfaceAcceptance; reason: string; truncated: boolean;
}

// Repo test glob'ları (master change-guard tests/** kuralı + yaygın ekosistem kalıpları). Belgeleme için glob, eşleme için eşdeğer regex.
export const TEST_GLOBS: readonly string[] = ["tests/**", "test/**", "**/tests/**", "**/test/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/test_*.py", "**/test.{js,mjs,cjs,ts}"];
const TEST_PATH_RES: readonly RegExp[] = [/(^|\/)tests?\//, /(^|\/)__tests__\//, /\.(test|spec)\.[A-Za-z0-9]+$/, /_test\.[A-Za-z0-9]+$/, /(^|\/)test_[^/]*\.py$/, /(^|\/)test\.(js|mjs|cjs|ts)$/];
const CODE_RE = /\.(m?[jt]sx?|cjs|cts|mts|py|go|rs|java|cs|kt|rb|php)$/;
const MAX_LIST = 200;

// Test komutunun (argv) göreli dosya argümanları da test yüzeyidir (ör. ["node", "check.mjs"]).
export function isTestPath(p: string, testCommand: readonly string[] = []): boolean {
  const n = p.replace(/\\/g, "/");
  if (TEST_PATH_RES.some(re => re.test(n))) return true;
  return testCommand.slice(1).some(a => !a.startsWith("-") && /\.[A-Za-z0-9]+$/.test(a) && a.replace(/\\/g, "/").replace(/^\.\//, "") === n);
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
const skipOrOnly = (s: string) => (s.match(/\.(?:skip|only)\s*\(/g) ?? []).length;

// Test koşucusu çıktısından yürütülen test sayısı; tanınmayan biçimde null (sayı uydurulmaz).
export function parseExecutedTestCount(output: string): number | null {
  const s = String(output ?? "");
  const last = (re: RegExp): RegExpMatchArray | null => { const all = [...s.matchAll(re)]; return all.length ? all[all.length - 1] : null; };
  if (/No test files found/i.test(s)) return 0;
  const vitest = last(/^\s*Tests\s+[^\n(]*\((\d+)\)\s*$/gm); if (vitest) return Number(vitest[1]);
  const jest = last(/^Tests:\s+.*?(\d+) total/gm); if (jest) return Number(jest[1]);
  const tap = last(/^(?:#|ℹ) tests (\d+)\s*$/gm); if (tap) return Number(tap[1]);
  if (/=+ no tests ran\b/i.test(s)) return 0;
  const py = last(/^=+ (.+?) in [\d.]+s\b.*=*\s*$/gm);
  if (py) { const n = [...py[1].matchAll(/(\d+) (passed|failed|errors?|skipped|xfailed|xpassed)/g)].reduce((a, m) => a + Number(m[1]), 0); if (n > 0 || /passed|failed/.test(py[1])) return n; }
  const cargo = [...s.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)]; if (cargo.length) return cargo.reduce((a, m) => a + Number(m[1]) + Number(m[2]) + Number(m[3]), 0);
  const dotnet = last(/Total tests: (\d+)/g) ?? last(/Total:\s+(\d+),/g); if (dotnet) return Number(dotnet[1]);
  const mocha = last(/^\s*(\d+) passing\b/gm); if (mocha) { const f = last(/^\s*(\d+) failing\b/gm), p = last(/^\s*(\d+) pending\b/gm); return Number(mocha[1]) + Number(f?.[1] ?? 0) + Number(p?.[1] ?? 0); }
  return null;
}

export interface EvaluateInput {
  baseSha: string; headSha: string; entries: NameStatusEntry[]; contentAt: (ref: string, path: string) => string | null;
  executedTests: number | null; testCommand?: readonly string[];
}
// Öncelik: silinen/zayıflatılan test -> BLOCKED; sıfır yürütülen test veya assertion'sız yeni test -> UNVERIFIED_VACUOUS; dokunulan test yüzeyi -> UNVERIFIED_ORACLE
// (mission'a sabitlenmiş bağımsız oracle yok); dokunulmamış testler -> UNKNOWN. VERIFIED bu dilimde üretilmez.
export function evaluateTestSurface(i: EvaluateInput): TestSurfaceSummary {
  const tc = i.testCommand ?? [], isT = (p: string) => isTestPath(p, tc);
  const added: string[] = [], modified: string[] = [], deleted: string[] = [], renamed: {from: string; to: string}[] = [], weakened: WeakenedTest[] = [], trivialAdded: string[] = [];
  const compare = (beforePath: string, afterPath: string) => {
    if (!CODE_RE.test(afterPath)) return;
    const b = i.contentAt(i.baseSha, beforePath), a = i.contentAt(i.headSha, afterPath);
    if (b === null || a === null) return;
    const nb = assertionCount(b), na = assertionCount(a);
    if (nb > 0 && na < nb) weakened.push({path: afterPath, before: nb, after: na, reason: "ASSERTION_COUNT_REDUCED"});
    else if (skipOrOnly(a) > skipOrOnly(b)) weakened.push({path: afterPath, before: nb, after: na, reason: "SKIP_OR_ONLY_ADDED"});
  };
  for (const e of i.entries) {
    if (e.status === "RENAMED" && e.oldPath !== undefined) {
      const fromT = isT(e.oldPath), toT = isT(e.path);
      if (fromT && !toT) { deleted.push(e.oldPath); continue; } // test glob'u dışına taşımak testi siler
      if (!fromT && !toT) continue;
      if (!fromT) { added.push(e.path); continue; }
      renamed.push({from: e.oldPath, to: e.path}); compare(e.oldPath, e.path); continue;
    }
    if (!isT(e.path)) continue;
    if (e.status === "DELETED") deleted.push(e.path);
    else if (e.status === "ADDED") { added.push(e.path); const a = CODE_RE.test(e.path) ? i.contentAt(i.headSha, e.path) : null; if (a !== null && assertionCount(a) === 0) trivialAdded.push(e.path); }
    else { modified.push(e.path); compare(e.path, e.path); }
  }
  const [functionalAcceptance, reason]: [TestSurfaceAcceptance, string] =
    deleted.length ? ["BLOCKED", "TEST_DELETED"]
    : weakened.length ? ["BLOCKED", "TEST_WEAKENED"]
    : i.executedTests === 0 ? ["UNVERIFIED_VACUOUS", "ZERO_TESTS_EXECUTED"]
    : trivialAdded.length ? ["UNVERIFIED_VACUOUS", "TRIVIAL_TEST_ADDED"]
    : added.length || modified.length || renamed.length ? ["UNVERIFIED_ORACLE", "TEST_SURFACE_CHANGED_NO_PINNED_ORACLE"]
    : ["UNKNOWN", "TESTS_UNCHANGED_NO_PINNED_ORACLE"];
  const cap = <T>(xs: T[]) => xs.slice(0, MAX_LIST);
  const truncated = [added, modified, deleted, renamed, weakened, trivialAdded].some(x => x.length > MAX_LIST);
  return {schemaVersion: 1, baseSha: i.baseSha, headSha: i.headSha, testGlobs: TEST_GLOBS, added: cap(added), modified: cap(modified), deleted: cap(deleted), renamed: cap(renamed), weakened: cap(weakened), trivialAdded: cap(trivialAdded),
    executedTests: i.executedTests, oracle: "NONE", functionalAcceptance, reason, truncated};
}
