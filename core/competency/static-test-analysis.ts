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

// //TR: DÜZ ondalık sayı değişmezi (başında tek '-' olabilir) -> sayı; başka her biçim null: yasak olanlar baştaki sıfır (V8 sloppy modda 010 = 8, Number("010") = 10), "-0" (Object.is), ayraç/üstel/başta-sonda nokta, hex ve çok büyük/küçük büyüklük (IEEE-754'te a+b === a-b emilimi: tamsayı kısmı <= maxInt hane, kesir <= 6 hane iken b >= 1e-6 her zaman ulp(a)'dan büyüktür, yani toplam ile fark ayrışır).
function parseNumber(ts: readonly Tok[], maxInt: number): number | null {
  const neg = ts.length === 2 && ts[0].t === "p" && ts[0].v === "-";
  const num = neg ? ts[1] : ts.length === 1 ? ts[0] : undefined;
  if (!num || num.t !== "num") return null;
  const m = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(num.v);
  if (!m || m[1].length > maxInt) return null;
  const v = Number(num.v);
  if (!Number.isFinite(v) || (neg && v === 0)) return null;
  return neg ? -v : v;
}
const MAX_OPERAND_INT_DIGITS = 9, MAX_EXPECTED_INT_DIGITS = 10;
// `<addId>(<n>, <n>)` tam olarak; başka bir şey (iç içe çağrı, değişken, ifade) null.
function parseAddCall(ts: readonly Tok[], addId: string): {a: number; b: number} | null {
  if (ts.length < 6 || ts[0].t !== "id" || ts[0].v !== addId || ts[1].v !== "(" || ts[ts.length - 1].v !== ")") return null;
  const inner = ts.slice(2, -1), comma = inner.findIndex(t => t.t === "p" && t.v === ",");
  if (comma < 0) return null;
  const a = parseNumber(inner.slice(0, comma), MAX_OPERAND_INT_DIGITS), b = parseNumber(inner.slice(comma + 1), MAX_OPERAND_INT_DIGITS);
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
const isStr = (ts: readonly Tok[]) => ts.length === 1 && ts[0].t === "str";   // mesaj bağımsız değişkeni: yalnız düz string (template ifade içerebilir)

export interface AssertionCase { a: number; b: number; expected: number }
export interface AddTestAnalysis {
  addId: string | null;          // require("../src/add") bağlanan tanımlayıcı
  assertIds: string[];           // require("node:assert") bağlanan tanımlayıcılar
  assertCalls: number;           // assert tanımlayıcısıyla başlayan üst düzey çağrı deyimleri (nitelikli ya da değil)
  cases: AssertionCase[];        // nitelikli üst düzey deyimler: assert.<eşitlik>(add(<n>,<n>), <n>[, "mesaj"]) / assert(.ok)(add(<n>,<n>) === <n>[, "mesaj"])
  earlyExit: string | null;      // üst düzey return/kontrol akışı/function/class => neden kodu
  tamper: string | null;         // KAPALI DİLBİLGİSİ dışındaki ilk üst düzey deyim => neden kodu
}

// //TR: Tester golden görevinin KAPALI DİLBİLGİSİ: dosya yalnız (1) iki `const <ad> = require("<izinli modül>")` bildiriminden ve (2) nitelikli assert deyimlerinden oluşur. Bunun dışındaki HER üst düzey deyim (yeniden atama, takma ad, Object.is/prototip kurcalama, process/eval/import, console, blok, başka require...) tamper'dır: dosya kendi iddialarını sessizce etkisiz kılamaz. Nitelikli deyim: yalnız sayı değişmezleriyle add çağrısı, bir eşitlik iddiasının karşılaştırılan tarafında, beklenen değer sayı değişmezi, isteğe bağlı düz string mesaj.
export function analyzeAddTest(toks: readonly Tok[]): AddTestAnalysis {
  const r: AddTestAnalysis = {addId: null, assertIds: [], assertCalls: 0, cases: [], earlyExit: null, tamper: null};
  const stmts = topLevelStatements(toks);
  const isRequireDecl = (s: readonly Tok[]) => s.length === 7 && s[0].t === "id" && s[0].v === "const" && s[1].t === "id" && s[2].v === "=" && s[3].v === "require" && s[4].v === "(" && s[5].t === "str" && s[6].v === ")";
  const decls = new Set<readonly Tok[]>();
  // 1. bağlamalar (yalnız const): assert deyimleri sınıflanmadan önce bilinmeli
  for (const s of stmts) {
    if (s[0].t === "id" && CONTROL.has(s[0].v)) { r.earlyExit ??= `TOP_LEVEL_${s[0].v.toUpperCase()}`; continue; }
    if (!isRequireDecl(s)) continue;
    if (REQ_ADD.has(s[5].v)) { r.addId ??= s[1].v; decls.add(s); } else if (REQ_ASSERT.has(s[5].v)) { r.assertIds.push(s[1].v); decls.add(s); }
  }
  // 2. her üst düzey deyim bildirim ya da nitelikli assert olmalı; ilk ihlal adlandırılır
  const violate = (why: string) => { r.tamper ??= why; };
  for (const s of stmts) {
    if (s[0].t === "id" && CONTROL.has(s[0].v)) continue;   // earlyExit olarak raporlanır
    if (decls.has(s)) continue;
    if (isRequireDecl(s)) { violate(`REQUIRE_SPEC_NOT_ALLOWED:${s[5].v.slice(0, 40)}`); continue; }
    const method = s[0].t === "id" && r.assertIds.includes(s[0].v) ? (s[1]?.v === "(" ? null : s[1]?.v === "." && s[2]?.t === "id" && s[3]?.v === "(" ? s[2].v : undefined) : undefined;
    if (method === undefined) { violate(`STATEMENT_NOT_ALLOWED:${s[0].v.slice(0, 30)}`); continue; }
    const open = method === null ? 1 : 3;
    // eşleşen kapanış parantezi deyimin SON belirteci olmalı (assert(...).x ya da zincir değil)
    let depth = 0, close = -1;
    for (let j = open; j < s.length; j++) { if (s[j].v === "(" && s[j].t === "p") depth++; else if (s[j].v === ")" && s[j].t === "p") { depth--; if (depth === 0) { close = j; break; } } }
    if (close !== s.length - 1) { violate(`STATEMENT_NOT_ALLOWED:${s[0].v.slice(0, 30)}`); continue; }
    r.assertCalls++;
    const args = splitArgs(s.slice(open + 1, close));
    if (args.length > 1 && args[args.length - 1].length === 0) args.pop();   // //TR: son bağımsız değişkenden sonra tek virgül serbest (Prettier/ESLint varsayılanı)
    let found: AssertionCase | null = null;
    if (r.addId !== null && method !== null && EQUAL_METHODS.has(method) && (args.length === 2 || (args.length === 3 && isStr(args[2])))) {
      for (const [x, y] of [[0, 1], [1, 0]]) { const call = parseAddCall(args[x], r.addId), exp = parseNumber(args[y], MAX_EXPECTED_INT_DIGITS); if (call && exp !== null) { found = {...call, expected: exp}; break; } }
    } else if (r.addId !== null && (method === null || method === "ok") && (args.length === 1 || (args.length === 2 && isStr(args[1])))) {
      const op = args[0].findIndex(t => t.t === "p" && (t.v === "===" || t.v === "=="));
      if (op > 0) {
        const left = args[0].slice(0, op), right = args[0].slice(op + 1);
        for (const [x, y] of [[left, right], [right, left]]) { const call = parseAddCall(x, r.addId), exp = parseNumber(y, MAX_EXPECTED_INT_DIGITS); if (call && exp !== null) { found = {...call, expected: exp}; break; } }
      }
    }
    if (found) r.cases.push(found); else violate("ASSERT_FORM_NOT_ALLOWED");
  }
  return r;
}
