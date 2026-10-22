// //TR: Bu dosya tester değerlendirmesinin STATİK test çözümlemesidir: yazılan test dosyası ASLA çalıştırılmaz. Metin önce belirteçlere (token) ayrılır; yorumlar atılır, string/template/regex değişmezleri tek opak belirteç olur. Böylece yorum satırındaki, string içindeki, iç içe geri çağrıdaki veya ölü koddaki "assert" metni test sayılmaz. Bu bir buluşsal denetimdir (kötü niyetli rakibe karşı değil, tembel/yanlış testlere karşı); tanınmayan biçim reddedilir, kabul edilmez.
export const MAX_TEST_SOURCE_BYTES = 16 * 1024;

type TokType = "id" | "num" | "str" | "tpl" | "re" | "p";
export interface Tok { t: TokType; v: string; nl: boolean }   // nl: bu belirteçten önce satır sonu var

const PUNCT = [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**"];
// Bu anahtar sözcüklerden sonra gelen "/" bölme değil regex başlangıcıdır.
const REGEX_AFTER = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);
const IDENT = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/uy;
const LINE_END = /[\n\r\u2028\u2029]/;

// //TR: Kaynağı belirteçlere ayırır. Kapanmamış string/yorum/template/regex => null (çözümlenemez; çağıran reddeder).
export function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [], n = src.length;
  let i = 0, nl = false;
  const push = (t: TokType, v: string) => { out.push({t, v, nl}); nl = false; };
  const skipQuoted = (q: string, from: number): number => { for (let j = from; j < n; j++) { const ch = src[j]; if (ch === "\\") j++; else if (ch === q) return j + 1; else if (ch === "\n" || ch === "\r") return -1; } return -1; };
  const skipTemplate = (from: number): number => {
    for (let j = from; j < n; j++) {
      const ch = src[j];
      if (ch === "\\") j++;
      else if (ch === "`") return j + 1;
      else if (ch === "$" && src[j + 1] === "{") {
        let depth = 1; j += 2;
        for (; j < n && depth > 0; j++) {
          const c = src[j];
          if (c === "{") depth++; else if (c === "}") depth--;
          else if (c === "'" || c === '"') { const e = skipQuoted(c, j + 1); if (e < 0) return -1; j = e - 1; }
          else if (c === "`") { const e = skipTemplate(j + 1); if (e < 0) return -1; j = e - 1; }
        }
        if (depth > 0) return -1;
        j--;
      }
    }
    return -1;
  };
  if (src.startsWith("#!")) { while (i < n && !LINE_END.test(src[i])) i++; }
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { if (LINE_END.test(c)) nl = true; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && !LINE_END.test(src[i])) i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); if (e < 0) return null; if (LINE_END.test(src.slice(i, e))) nl = true; i = e + 2; continue; }
    if (c === '"' || c === "'") { const e = skipQuoted(c, i + 1); if (e < 0) return null; push("str", src.slice(i + 1, e - 1)); i = e; continue; }
    if (c === "`") { const e = skipTemplate(i + 1); if (e < 0) return null; push("tpl", src.slice(i + 1, e - 1)); i = e; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(src[j])) { if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-") && !/^0[xX]/.test(src.slice(i, j))) j++; j++; }
      push("num", src.slice(i, j)); i = j; continue;
    }
    // //TR: V8 (CommonJS, modül değil) `<!--` ifadesini HER YERDE, `-->` ifadesini satır başında satır yorumu sayar: bu belirteçler gizli kod yaratır, çözümleme güvenilmez => null (fail closed).
    if (src.startsWith("<!--", i)) return null;
    if (src.startsWith("-->", i) && (nl || out.length === 0)) return null;
    IDENT.lastIndex = i;
    const m = IDENT.exec(src);
    if (m) { push("id", m[0]); i += m[0].length; continue; }
    if (c === "/") {
      const prev = out[out.length - 1];
      // //TR: `}` sonrası "/" blok deyimi sonrası regex mi, nesne/ifade sonrası bölme mi belirsizdir: regex içindeki "assert" metni sayılabilirdi => fail closed.
      if (prev && prev.t === "p" && prev.v === "}") return null;
      const regexAllowed = !prev || (prev.t === "p" && prev.v !== ")" && prev.v !== "]" && prev.v !== "}") || (prev.t === "id" && REGEX_AFTER.has(prev.v));
      if (regexAllowed) {
        let j = i + 1, cls = false;
        for (; j < n; j++) {
          const ch = src[j];
          if (ch === "\\") j++; else if (LINE_END.test(ch)) return null; else if (ch === "[") cls = true; else if (ch === "]") cls = false; else if (ch === "/" && !cls) break;
        }
        if (j >= n) return null;
        j++; while (j < n && /[A-Za-z]/.test(src[j])) j++;
        push("re", src.slice(i, j)); i = j; continue;
      }
    }
    const p = PUNCT.find(x => src.startsWith(x, i)) ?? c;
    push("p", p); i += p.length;
  }
  return out;
}

const endsStatement = (t: Tok | undefined) => t !== undefined && (t.t === "id" || t.t === "num" || t.t === "str" || t.t === "tpl" || t.t === "re" || (t.t === "p" && (t.v === ")" || t.v === "]" || t.v === "}")));
const CONTINUES = new Set(["in", "of", "instanceof", "as"]);
// //TR: Üst düzey (parantez/küme derinliği 0) deyimlere böler: ';' ile veya ASI'nin devam ettirmeyeceği satır sonu ile. İç içe gövdeler dış deyimin parçasıdır.
export function topLevelStatements(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [], depth = 0;
  for (const t of toks) {
    if (depth === 0 && cur.length > 0 && t.nl && endsStatement(cur[cur.length - 1]) && (t.t === "id" || t.t === "num" || t.t === "str") && !CONTINUES.has(t.v)) { out.push(cur); cur = []; }
    cur.push(t);
    if (t.t !== "p") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") depth = Math.max(0, depth - 1);
    else if (t.v === ";" && depth === 0) { out.push(cur); cur = []; }
  }
  if (cur.length > 0) out.push(cur);
  return out.map(s => (s.length > 0 && s[s.length - 1].t === "p" && s[s.length - 1].v === ";" ? s.slice(0, -1) : s)).filter(s => s.length > 0);
}

// //TR: Ondalık sayı değişmezi (başında tek '-' olabilir) -> sayı; başka her biçim (hex, üstel, ifade) null.
function parseNumber(ts: readonly Tok[]): number | null {
  const neg = ts.length === 2 && ts[0].t === "p" && ts[0].v === "-";
  const num = neg ? ts[1] : ts.length === 1 ? ts[0] : undefined;
  if (!num || num.t !== "num" || !/^\d+(?:\.\d+)?$/.test(num.v)) return null;
  const v = Number(num.v);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
// `<addId>(<n>, <n>)` tam olarak; başka bir şey (iç içe çağrı, değişken, ifade) null.
function parseAddCall(ts: readonly Tok[], addId: string): {a: number; b: number} | null {
  if (ts.length < 6 || ts[0].t !== "id" || ts[0].v !== addId || ts[1].v !== "(" || ts[ts.length - 1].v !== ")") return null;
  const inner = ts.slice(2, -1), comma = inner.findIndex(t => t.t === "p" && t.v === ",");
  if (comma < 0) return null;
  const a = parseNumber(inner.slice(0, comma)), b = parseNumber(inner.slice(comma + 1));
  return a === null || b === null ? null : {a, b};
}
function splitArgs(ts: readonly Tok[]): Tok[][] {
  const args: Tok[][] = [[]];
  let depth = 0;
  for (const t of ts) {
    if (t.t === "p" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
    else if (t.t === "p" && (t.v === ")" || t.v === "]" || t.v === "}")) depth--;
    if (depth === 0 && t.t === "p" && t.v === ",") args.push([]); else args[args.length - 1].push(t);
  }
  return args;
}
const EQUAL_METHODS = new Set(["strictEqual", "equal", "deepStrictEqual", "deepEqual"]);
const CONTROL = new Set(["if", "else", "for", "while", "do", "switch", "try", "catch", "finally", "with", "return", "throw", "break", "continue", "debugger", "function", "class"]);
const REQ_ADD = new Set(["../src/add", "../src/add.js"]);
const REQ_ASSERT = new Set(["node:assert", "assert", "node:assert/strict", "assert/strict"]);
// //TR: Kapalı dünya: görev yalnız bu iki modüle ihtiyaç duyar. Ortamı/yürütmeyi dinamik değiştirebilen tanımlayıcılar (process, eval, Function, globalThis...) görevde HİÇ yer almaz.
const DENIED_IDS = new Set(["process", "globalThis", "global", "eval", "Function", "module", "exports", "import"]);

export interface AssertionCase { a: number; b: number; expected: number }
export interface AddTestAnalysis {
  addId: string | null;          // require("../src/add") bağlanan tanımlayıcı
  assertIds: string[];           // require("node:assert") bağlanan tanımlayıcılar
  assertCalls: number;           // assert tanımlayıcısıyla başlayan üst düzey çağrı deyimleri (nitelikli ya da değil)
  cases: AssertionCase[];        // nitelikli üst düzey deyimler: assert.<eşitlik>(add(<n>,<n>), <n>) / assert(.ok)(add(<n>,<n>) === <n>)
  earlyExit: string | null;      // üst düzey return/kontrol akışı/function/class => neden kodu
  tamper: string | null;         // kapalı dünya ihlali (yeniden bağlama, takma ad, izinli olmayan require, yasaklı tanımlayıcı) => neden kodu
}

// //TR: Tester golden görevinin biçimini çözümler. Yalnız ÜST DÜZEY deyimler sayılır (geri çağrı/if/döngü içindekiler değil); add çağrısı yalnız sayı değişmezleriyle ve bir eşitlik iddiasının karşılaştırılan tarafında olmalıdır.
export function analyzeAddTest(toks: readonly Tok[]): AddTestAnalysis {
  const r: AddTestAnalysis = {addId: null, assertIds: [], assertCalls: 0, cases: [], earlyExit: null, tamper: null};
  const allowed = new Set<Tok>();   // bağlama adının/`require`ın/assert başının izinli konumları (kimlik ile)
  const stmts = topLevelStatements(toks);
  for (const s of stmts) {
    if (s[0].t === "id" && CONTROL.has(s[0].v)) { r.earlyExit ??= `TOP_LEVEL_${s[0].v.toUpperCase()}`; continue; }
    // const <id> = require("<spec>"): YALNIZ const (let/var yeniden atanabilir; görev metni const der)
    if (s.length === 7 && s[0].t === "id" && s[0].v === "const" && s[1].t === "id" && s[2].v === "=" && s[3].v === "require" && s[4].v === "(" && s[5].t === "str" && s[6].v === ")") {
      if (REQ_ADD.has(s[5].v)) { r.addId ??= s[1].v; allowed.add(s[1]); allowed.add(s[3]); }
      else if (REQ_ASSERT.has(s[5].v)) { r.assertIds.push(s[1].v); allowed.add(s[1]); allowed.add(s[3]); }
    }
  }
  for (const s of stmts) {
    if (s[0].t !== "id" || !r.assertIds.includes(s[0].v)) continue;
    const method = s[1]?.v === "(" ? null : s[1]?.v === "." && s[2]?.t === "id" && s[3]?.v === "(" ? s[2].v : undefined;
    if (method === undefined) continue;
    const open = method === null ? 1 : 3;
    // eşleşen kapanış parantezi deyimin SON belirteci olmalı (assert(...).x ya da zincir değil)
    let depth = 0, close = -1;
    for (let j = open; j < s.length; j++) { if (s[j].v === "(" && s[j].t === "p") depth++; else if (s[j].v === ")" && s[j].t === "p") { depth--; if (depth === 0) { close = j; break; } } }
    if (close !== s.length - 1) continue;
    r.assertCalls++;
    allowed.add(s[0]);
    for (let j = open + 1; j < close; j++) if (r.addId !== null && s[j].t === "id" && s[j].v === r.addId && s[j + 1]?.v === "(") allowed.add(s[j]);
    if (r.addId === null) continue;
    const args = splitArgs(s.slice(open + 1, close));
    if (args.length < 1 || args.length > 3) continue;
    let found: AssertionCase | null = null;
    if (method !== null && EQUAL_METHODS.has(method) && args.length >= 2) {
      for (const [x, y] of [[0, 1], [1, 0]]) { const call = parseAddCall(args[x], r.addId), exp = parseNumber(args[y]); if (call && exp !== null) { found = {...call, expected: exp}; break; } }
    } else if (method === null || method === "ok") {
      const op = args[0].findIndex(t => t.t === "p" && (t.v === "===" || t.v === "=="));
      if (op > 0) {
        const left = args[0].slice(0, op), right = args[0].slice(op + 1);
        for (const [x, y] of [[left, right], [right, left]]) { const call = parseAddCall(x, r.addId), exp = parseNumber(y); if (call && exp !== null) { found = {...call, expected: exp}; break; } }
      }
    }
    if (found) r.cases.push(found);
  }
  // //TR: Kapalı dünya denetimi: bağlama adları yalnız bildirimde ve üst düzey assert çağrılarında geçer; `require` yalnız izinli iki bildirimde geçer; yasaklı tanımlayıcı yoktur. Aksi halde (yeniden atama, takma ad, require/process/eval ile ortamı değiştirme) test sessizce hiçbir şeyi sınamayabilir => tamper.
  for (const t of toks) {
    if (t.t !== "id" || r.tamper !== null) continue;
    if (DENIED_IDS.has(t.v)) r.tamper = `DENIED_IDENTIFIER:${t.v}`;
    else if (t.v === "require" && !allowed.has(t)) r.tamper = "REQUIRE_OUTSIDE_ALLOWED_DECLARATION";
    else if ((t.v === r.addId || r.assertIds.includes(t.v)) && !allowed.has(t)) r.tamper = `BOUND_NAME_REUSED:${t.v}`;
  }
  return r;
}
