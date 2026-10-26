// //TR: Korunan iki dosyadaki dar, Founder tarafından önceden yetkilendirilmiş değişiklik sınıflarının saf ve deterministik dil bilgisi denetimi: apps/control-api/src/server.ts için yalnız ekleme olan route kaydı (ROUTE_REGISTRATION_APPEND) ve apps/desktop/main.mjs için yalnız B4/B5 izin listesi bölgelerine çapalı yol deseni ekleme (DESKTOP_ALLOWLIST_APPEND). Girdi base ve head dosya metnidir; çıktı yalnız sabit kodlardır (dosya veya PR metni asla kopyalanmaz). Dil bilgisine uymayan her satır, silinen/değişen her satır ve okunamayan her bölge bir ihlaldir (fail-closed).
// Pure: no I/O, no clock. Every returned string is a fixed code. An empty list means the change has exactly the class's shape.

const splitLines = t => t.split("\n");
// //TR: Bağımlılık ifadelerinde ve içe aktarılan adlarda yasak alt dizgiler: süreç, modül yükleme, ağ, sandbox/ExecutionGate kabloları, dinleme, gizli değerler, dosya silme/yazma ve nesne/prototip kaçışları. Eşleşme büyük/küçük harf duyarsızdır (Object.setPrototypeOf, SANDBOX da yakalanır); yalnız "exec" duyarlıdır, çünkü server.ts'in kendi getExecutors/getExecSetup erişimcileri meşrudur ve child_process.exec* başka belirteçlerle de yakalanır.
export const DENY_TOKENS = Object.freeze(["process.", "require(", "import(", "child_process", "spawn", "exec", "eval", "Function(", "fetch(", "http", "sandbox", "Sandbox", "ExecutionGate",
  "executionGate", "acceptUnenforced", "addHook", "app.register(", "listen", "env", "token", "secret", "password", "0.0.0.0", "::", "unlink", "rm(", "writeFile",
  // Stricter than the minimum list: no other way to reach globals, prototypes, modules, timers, the file system, child processes or the app object.
  "globalThis", "global", "constructor", "prototype", "__proto__", "Reflect", "Proxy", "Function", "import", "require", "opts", "app.", "laneDeps", "Token", "Secret", "Password",
  "Buffer", "fs.", "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "async", "await", "yield", "delete", "with(", "arguments", "Worker", "Atomics", "SharedArrayBuffer",
  "cp.", "fork", "fastify"]);
export const CASE_SENSITIVE_DENY_TOKENS = Object.freeze(["exec"]);
const denied = s => { const l = s.toLowerCase(); return DENY_TOKENS.some(t => (CASE_SENSITIVE_DENY_TOKENS.includes(t) ? s.includes(t) : l.includes(t.toLowerCase()))); };

const ROUTE_IMPORT_RE = /^import \{(register[A-Z][A-Za-z0-9]*Routes)\} from "\.\/routes\/([a-z0-9]+(?:-[a-z0-9]+)*)\.js";$/;
const CORE_IMPORT_RE = /^import \{([A-Za-z_][A-Za-z0-9_]*(?:,[A-Za-z_][A-Za-z0-9_]*)*)\} from "\.\.\/\.\.\/\.\.\/core\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\.js";$/;
const REGISTER_PLAIN_RE = /^(register[A-Z][A-Za-z0-9]*Routes)\(app,laneDeps\);$/;
const REGISTER_LAZY_RE = /^(register[A-Z][A-Za-z0-9]*Routes)\(app,\{\.\.\.laneDeps,([A-Za-z_][A-Za-z0-9_]*):\(\)=>(.+)\}\);$/;
const REGISTER_ANY_RE = /^register[A-Z][A-Za-z0-9]*Routes\(app,/;
const LANE_DEPS_RE = /^const laneDeps=\{(.*)\};$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BLOCK_COMMENT_RE = /\/\*|\*\//;

// //TR: JS/TS satırı yalnız LF ile değil CR, U+2028 ve U+2029 ile de biter: "// " yorumunun içindeki böyle bir karakterden sonrası koddur. Bu yüzden eklenen her satır (yorumlar dahil) önce bu karakterler, diğer kontrol karakterleri ve görünmez biçim/bidi karakterleri (\p{Cf}) için reddedilir.
const LINE_TERMINATOR_RE = /[\r\u2028\u2029]/;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/u;
export const lineCharViolation = l => (LINE_TERMINATOR_RE.test(l) ? "LINE_TERMINATOR_IN_LINE" : CONTROL_CHAR_RE.test(l) ? "CONTROL_CHARACTER_IN_LINE" : null);

// //TR: Eklenen bir "//" yorumu araç yönergesi taşıyamaz: @ts-nocheck/@ts-ignore gibi TypeScript pragmaları tüm dosyanın typecheck kapsamını kapatabilir; eslint/istanbul/c8/v8/prettier/biome/tslint yönergeleri, "///" üçlü eğik çizgi ve "//#"/"//@" kaynak yönergeleri de reddedilir. Yorum blok yorum açamaz veya kapatamaz.
const COMMENT_PRAGMA_RE = /@|eslint|istanbul|prettier|biome|tslint|jshint|jscs|deno-|sourcemappingurl|sourceurl|coverage|\bc8\b|\bv8\b/i;
// The text after the leading "//" of a whole-line comment: null when it is plain text.
export function commentViolation(rest) {
  if (typeof rest !== "string") return "COMMENT_NOT_IN_GRAMMAR";
  if (BLOCK_COMMENT_RE.test(rest) || /^[/#!]/.test(rest)) return "COMMENT_NOT_IN_GRAMMAR";
  return COMMENT_PRAGMA_RE.test(rest) ? "COMMENT_PRAGMA" : null;
}

// //TR: Tembel bağımlılık ifadesi dil bilgisi (tek satır, ASCII): tanımlayıcı, ".ad"/"?.ad" özellik zinciri, çağrı "(...)"/"?.(...)", "new Ad.Ad(...)", "a ?? b", nesne "{ad:ifade, ad}", dizi "[ifade]" ve parametresiz iç ok "()=>ifade" (gövdesi "{" ile başlayamaz). Literal, operatör, atama, tırnak, ters bölü, virgül dizisi ve ayrılmış sözcük yoktur; ifade tamamen tüketilmelidir, bu yüzden üst düzeyde virgül (ek nesne özelliği, hemen değerlendirilen kod) imkânsızdır.
const RESERVED = new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "finally", "for", "function", "if",
  "import", "in", "instanceof", "let", "new", "return", "static", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield", "await", "async", "arguments", "eval",
  "implements", "interface", "package", "private", "protected", "public", "of", "as", "satisfies", "keyof", "infer", "is", "declare", "module", "namespace", "require", "type"]);
const PUNCT = ["?.", "??", "=>", "(", ")", "{", "}", "[", "]", ",", ":", "."];
function tokens(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === " ") { i++; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({id: id[0]}); i += id[0].length; continue; }
    const p = PUNCT.find(x => s.startsWith(x, i));
    if (!p) return null;
    out.push({p}); i += p.length;
  }
  return out;
}
// true when s is one complete lazy-dependency expression of the grammar above (an arrow body: it may not start with "{").
export function lazyExpressionOk(s) {
  if (typeof s !== "string" || s === "" || s.length > 2000 || !/^[\x20-\x7e]+$/.test(s)) return false;
  const t = tokens(s);
  if (t === null || t.length === 0) return false;
  let i = 0, depth = 0;
  const isP = v => t[i]?.p === v, eat = v => (isP(v) ? (i++, true) : false);
  const name = () => { const x = t[i]; if (x?.id !== undefined && !RESERVED.has(x.id)) { i++; return true; } return false; };
  const list = (close, item) => { if (eat(close)) return true; do { if (!item()) return false; } while (eat(",")); return eat(close); };
  const args = () => eat("(") && list(")", expr);
  const body = () => !isP("{") && expr();
  function primary() {
    if (eat("(")) return eat(")") && eat("=>") && body();
    if (eat("{")) return list("}", () => name() && (!eat(":") || expr()));
    if (eat("[")) return list("]", expr);
    return name();
  }
  function tails() {
    for (;;) {
      if (eat(".")) { if (!name()) return false; }
      else if (eat("?.")) { if (!(isP("(") ? args() : name())) return false; }
      else if (isP("(")) { if (!args()) return false; }
      else return true;
    }
  }
  function unary() {
    if (t[i]?.id === "new") { i++; if (!name()) return false; while (eat(".")) if (!name()) return false; return args() && tails(); }
    return primary() && tails();
  }
  function expr() {
    if (++depth > 64) return false;
    let ok = unary();
    while (ok && eat("??")) ok = unary();
    depth--;
    return ok;
  }
  return body() && i === t.length;
}
// //TR: Güvenli tembel bağımlılık ifadesi = dil bilgisine tam uyar ve hiçbir yasak belirteci içermez.
export const safeExpression = expr => lazyExpressionOk(expr) && !denied(expr);

// //TR: Eklenen bir import satırının bağladığı ad, mevcut server.ts metninde hiç geçmemeli ve bir JS/Node/TS global adı olmamalıdır; aksi hâlde modül kapsamındaki import (ör. {process}, {JSON}) mevcut güvenlik kodunun anlamını değiştirir (gölgeleme).
export const GLOBAL_NAMES = Object.freeze(["process", "global", "globalThis", "window", "self", "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Date", "RegExp",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "Promise",
  "Proxy", "Reflect", "Function", "Intl", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
  "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "Buffer", "console", "setTimeout", "setInterval",
  "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "structuredClone", "fetch", "Request", "Response", "Headers", "AbortController", "AbortSignal", "Event",
  "EventTarget", "crypto", "performance", "require", "module", "exports", "__dirname", "__filename", "undefined", "NaN", "Infinity", "eval", "isNaN", "isFinite", "parseInt", "parseFloat",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape", "Blob", "File", "FormData", "WebAssembly", "navigator", "atob", "btoa", "Iterator",
  "Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract", "NonNullable", "ReturnType", "Parameters", "InstanceType", "Awaited", "PromiseLike", "ArrayLike",
  "Iterable", "AsyncIterable", "NodeJS"]);
const usedIn = (text, n) => new RegExp(`(?<![A-Za-z0-9_$])${n}(?![A-Za-z0-9_$])`).test(text);
const shadows = (baseText, n) => GLOBAL_NAMES.includes(n) || n in globalThis || usedIn(baseText, n);

// Top-level keys of the one-line laneDeps object literal ("a,b,c:()=>x()"). null when it cannot be read unambiguously.
function laneDepsKeys(line) {
  const m = LANE_DEPS_RE.exec(line);
  if (!m) return null;
  const parts = [];
  let depth = 0, cur = "";
  for (const c of m[1]) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth < 0) return null; }
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += c;
  }
  if (depth !== 0) return null;
  parts.push(cur);
  const keys = new Set();
  for (const p of parts) { const k = p.includes(":") ? p.slice(0, p.indexOf(":")) : p; if (!IDENT_RE.test(k) || keys.has(k)) return null; keys.add(k); }
  return keys;
}

// //TR: Head metni, base satırlarının sırası korunarak araya satır eklenmiş hâli olmalıdır (silinen veya değişen satır yok). Dönen dizi head'de eklenen satırların indeksleridir; null = saf ekleme değil.
export function insertedLines(baseLines, headLines) {
  const added = [];
  let j = 0;
  for (let i = 0; i < headLines.length; i++) {
    if (j < baseLines.length && headLines[i] === baseLines[j]) j++;
    else added.push(i);
  }
  return j === baseLines.length ? added : null;
}

// //TR: server.ts satır düzeyinde ancak hiçbir yapı satırlar arasına yayılmıyorsa güvenle okunur: satır sonunda hâlâ açık bir şablon dizgisi (${...} içinden iç içe olanlar dahil), sondaki "\\" satır devamı veya satırlar arasında açılan/kapanan blok yorum. Böyle bir aralığa eklenen satır dizgi veya yorum içeriği olur; bu yüzden base veya head'de böyle bir satır varsa dosya bu sınıf için okunamaz (fail-closed). Tam satır "//" yorumları kod değildir ve sayılmaz (önceki her satır temiz bittiği için gerçekten yorumdurlar).
function templateOpenAtEnd(l) {
  const st = [];
  for (let i = 0; i < l.length; i++) {
    const c = l[i], top = st.at(-1);
    if (top === "`") {
      if (c === "\\") i++;
      else if (c === "`") st.pop();
      else if (c === "$" && l[i + 1] === "{") { st.push(0); i++; }
    } else if (c === "`") st.push("`");
    else if (typeof top === "number") { if (c === "{") st[st.length - 1]++; else if (c === "}") { if (top === 0) st.pop(); else st[st.length - 1]--; } }
  }
  return st.length > 0;
}
const blockCommentSpans = l => { const o = l.lastIndexOf("/*"), c = l.indexOf("*/"); return (o >= 0 && !l.slice(o + 2).includes("*/")) || (c >= 0 && !l.slice(0, c).includes("/*")); };
export const serverLineSpans = l => !l.trim().startsWith("//") && (templateOpenAtEnd(l) || l.endsWith("\\") || blockCommentSpans(l));

/**
 * //TR: ROUTE_REGISTRATION_APPEND dil bilgisi (apps/control-api/src/server.ts): yalnız eklenen satırlar; her biri route içe aktarma, core'dan adlandırılmış içe aktarma,
 * registerXxxRoutes(app,laneDeps); veya registerXxxRoutes(app,{...laneDeps,<yeni anahtar>:()=><güvenli ifade>}); ya da yönergesiz "// " yorumu / boş satırdır. Kayıt satırları
 * tek "const laneDeps=" satırından sonra, mevcut kayıt bloğunun içinde olmalı, içe aktarılmış bir route fonksiyonunu tam bir kez kaydetmeli ve laneDeps anahtarlarını ezmemelidir.
 * İçe aktarılan her ad yenidir (base metninde geçmez, global değildir, iki kez bağlanmaz).
 */
export function routeRegistrationViolations(baseText, headText) {
  if (typeof baseText !== "string" || typeof headText !== "string") return ["CONTENT_MISSING"];
  const base = splitLines(baseText), head = splitLines(headText);
  if ([...base, ...head].some(serverLineSpans)) return ["SERVER_UNREADABLE"];
  const added = insertedLines(base, head);
  if (added === null) return ["NOT_PURELY_ADDITIVE"];
  if (added.length === 0) return ["NO_CHANGE"];
  const r = [];
  const depsIdx = head.map((l, i) => (l.startsWith("const laneDeps=") ? i : -1)).filter(i => i >= 0);
  if (depsIdx.length !== 1 || base.filter(l => l.startsWith("const laneDeps=")).length !== 1) return ["LANE_DEPS_NOT_UNIQUE"];
  const deps = depsIdx[0], depKeys = laneDepsKeys(head[deps]);
  if (depKeys === null) return ["LANE_DEPS_UNREADABLE"];
  const importedRoutes = new Set(head.map(l => ROUTE_IMPORT_RE.exec(l)?.[1]).filter(Boolean));
  const bound = new Set();
  const bind = names => { for (const n of names) { if (shadows(baseText, n) || bound.has(n)) r.push("IMPORT_SHADOWS_NAME"); bound.add(n); } };
  const registrations = [];
  for (const i of added) {
    const l = head[i];
    // Checked before anything else, comments included: a CR, U+2028 or U+2029 ends a JS line, so the rest of a "comment" would run as code.
    const cv = lineCharViolation(l);
    if (cv) { r.push(cv); continue; }
    if (l === "") continue;
    if (l.startsWith("// ")) { const c = commentViolation(l.slice(2)); if (c) r.push(c); continue; }
    let m;
    if ((m = ROUTE_IMPORT_RE.exec(l))) {
      if (i > deps) r.push("IMPORT_AFTER_LANE_DEPS");
      if (base.some(b => ROUTE_IMPORT_RE.exec(b)?.[1] === m[1])) r.push("ROUTE_ALREADY_IMPORTED");
      bind([m[1]]);
      continue;
    }
    if ((m = CORE_IMPORT_RE.exec(l))) {
      if (i > deps) r.push("IMPORT_AFTER_LANE_DEPS");
      if (denied(m[1]) || denied(m[2]) || /^(?:authority|sandbox)(?:\/|$)/.test(m[2]) || m[2].includes("execution-gate")) r.push("CORE_IMPORT_DENIED");
      bind(m[1].split(","));
      continue;
    }
    const plain = REGISTER_PLAIN_RE.exec(l), lazy = plain ? null : REGISTER_LAZY_RE.exec(l);
    if (!plain && !lazy) { r.push("LINE_NOT_IN_GRAMMAR"); continue; }
    registrations.push(i);
    const name = (plain ?? lazy)[1];
    if (i <= deps) { r.push("REGISTER_BEFORE_LANE_DEPS"); continue; }
    // Inside the registration block: the nearest earlier code line is laneDeps itself or another registration call.
    let k = i - 1;
    while (k > deps && (head[k] === "" || head[k].startsWith("// "))) k--;
    if (!(k === deps || REGISTER_ANY_RE.test(head[k]))) r.push("REGISTER_OUTSIDE_BLOCK");
    if (!importedRoutes.has(name)) r.push("REGISTER_NOT_IMPORTED");
    if (head.filter(h => h.startsWith(`${name}(`)).length !== 1 || base.some(b => b.startsWith(`${name}(`))) r.push("REGISTER_DUPLICATE");
    if (lazy) {
      // The grammar admits exactly one new key besides the spread: the object is "{...laneDeps,<key>:()=><expression>}" and the expression is consumed whole.
      if (depKeys.has(lazy[2]) || lazy[2] === "app" || lazy[2] === "__proto__") r.push("LANE_DEP_OVERRIDE");
      if (!safeExpression(lazy[3])) r.push("DEPENDENCY_EXPRESSION_DENIED");
    }
  }
  if (!registrations.length) r.push("NO_REGISTRATION_ADDED");
  return [...new Set(r)];
}

// ---- DESKTOP_ALLOWLIST_APPEND ----
export const ALLOWLIST_MARKERS = Object.freeze([["// B4-ALLOWLIST-BEGIN", "// B4-ALLOWLIST-END"], ["// B5-POST-ALLOWLIST-BEGIN", "// B5-POST-ALLOWLIST-END"]]);
// //TR: Çapalı yol deseni: ^ ile başlar, $ ile biter; her segment "\/" + küçük harf/rakam/tire literali, "önek_[0-9a-f]{24}" kimliği veya "(?:a|b)" literal seçimi. Bayrak, ".", "*", "+", "?", "[^", geri başvuru yok.
const SEGMENT = String.raw`\\\/(?:[a-z0-9-]+|[a-z]+_\[0-9a-f\]\{24\}|\(\?:[a-z0-9-]+(?:\|[a-z0-9-]+)+\))`;
const PATH_REGEX_BODY = new RegExp(String.raw`^\^(?:${SEGMENT})+\$$`);
export const pathRegexBodyOk = body => typeof body === "string" && body.length <= 200 && PATH_REGEX_BODY.test(body);

// A regular-expression literal starting at s[pos] === "/": returns {text, body, end} or null. Escapes and character classes are honoured; no newline.
function regexLiteral(s, pos) {
  if (s[pos] !== "/") return null;
  let i = pos + 1, inClass = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") return null;
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") inClass = true;
    else if (c === "/") break;
  }
  if (i >= s.length || i === pos + 1) return null;
  return {text: s.slice(pos, i + 1), body: s.slice(pos + 1, i), end: i + 1};
}

const REGEX_DECL_HEAD_RE = /^const ([A-Z][A-Z0-9_]*_RE)=\//;
// `const NAME_RE=/body/;` on one line, nothing else: returns {name, body} or null.
function regexDecl(line) {
  const m = REGEX_DECL_HEAD_RE.exec(line);
  if (!m) return null;
  const lit = regexLiteral(line, m[0].length - 1);
  if (!lit || line.slice(lit.end) !== ";") return null;
  return {name: m[1], body: lit.body};
}

const ARRAY_HEAD_RE = /^const ([A-Z][A-Z0-9_]*)=\[/;
// Units of a region: a whole array declaration (column 0 "const NAME=[" up to the first line ending in "];") or a single line.
function regionUnits(lines) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    const m = ARRAY_HEAD_RE.exec(lines[i]);
    if (!m) { out.push({kind: "line", text: lines[i]}); i++; continue; }
    let j = i;
    while (j < lines.length && !lines[j].trimEnd().endsWith("];")) j++;
    if (j === lines.length) return null;
    out.push({kind: "array", name: m[1], lines: lines.slice(i, j + 1)});
    i = j + 1;
  }
  return out;
}

// Elements of an array unit: identifiers and regex literals separated by commas; whole-line "//" comments are kept apart. null when unreadable.
function arrayElements(unit) {
  const first = unit.lines[0], prefix = `const ${unit.name}=[`;
  const parts = unit.lines.map((l, i) => (i === 0 ? l.slice(prefix.length) : l));
  const last = parts.length - 1, endTrim = parts[last].trimEnd();
  if (!first.startsWith(prefix) || !endTrim.endsWith("];")) return null;
  parts[last] = endTrim.slice(0, -2);
  const comments = [], code = [];
  for (const p of parts) (p.trim().startsWith("//") ? comments : code).push(p.trim().startsWith("//") ? p.trim() : p);
  const s = code.join("\n"), tokens = [];
  let pos = 0, expectElem = true, sawComma = false;
  const ws = () => { while (pos < s.length && /[ \t\n]/.test(s[pos])) pos++; };
  for (ws(); pos < s.length; ws()) {
    if (expectElem) {
      if (s[pos] === "/") {
        const lit = regexLiteral(s, pos);
        if (!lit || /[A-Za-z0-9_$]/.test(s[lit.end] ?? "")) return null;
        tokens.push({kind: "re", text: lit.text, body: lit.body}); pos = lit.end;
      } else {
        const m = /^[A-Z][A-Z0-9_]*/.exec(s.slice(pos));
        if (!m || /[A-Za-z0-9_$]/.test(s[pos + m[0].length] ?? "")) return null;
        tokens.push({kind: "id", text: m[0]}); pos += m[0].length;
      }
      expectElem = false; sawComma = false;
    } else {
      if (s[pos] !== ",") return null;
      pos++; expectElem = true; sawComma = true;
    }
  }
  if (sawComma) return null;
  return {tokens, comments};
}

const isSubsequence = (a, b) => { let j = 0; for (const x of b) if (j < a.length && x === a[j]) j++; return j === a.length; };

function regionViolations(baseLines, headLines, baseText, r) {
  // Every head line of the region, comments included, before anything else: a CR, U+2028 or U+2029 inside a "// " line would end the comment and run the rest as code.
  for (const l of headLines) { const cv = lineCharViolation(l); if (cv) { r.push(cv); return; } }
  // //TR: Çok satırlı şablon dizgisi, satır devamı veya çok satırlı blok yorum içeren bölge satır düzeyinde güvenle okunamaz (eklenen bir satırın anlamı değişebilir).
  // A whole-line "//" comment can hold any text; on a code line every "/*" must be closed on the same line and no "*/" may close an earlier one.
  const blockSpans = l => { if (l.trim().startsWith("//")) return false; const o = l.lastIndexOf("/*"), c = l.indexOf("*/"); return (o >= 0 && !l.slice(o + 2).includes("*/")) || (c >= 0 && !l.slice(0, c).includes("/*")); };
  if ([...baseLines, ...headLines].some(l => l.includes("`") || l.endsWith("\\") || blockSpans(l))) { r.push("REGION_UNREADABLE"); return; }
  const bu = regionUnits(baseLines), hu = regionUnits(headLines);
  if (bu === null || hu === null) { r.push("REGION_UNREADABLE"); return; }
  // New regex constants declared in this region of the head (name unused anywhere in the base file).
  const newRegex = new Set();
  const matched = [];
  let j = 0;
  for (const u of hu) {
    const b = bu[j];
    const same = b !== undefined && (u.kind === "line" ? b.kind === "line" && b.text === u.text : b.kind === "array" && b.name === u.name);
    if (same) { matched.push([b, u]); j++; continue; }
    if (u.kind === "array") { r.push("ARRAY_ADDED_OR_MOVED"); continue; }
    const t = u.text;
    if (t.trim() === "") continue;
    if (t.trim().startsWith("//")) { const c = commentViolation(t.trim().slice(2)); if (c) r.push(c); continue; }
    const d = regexDecl(t);
    if (!d) { r.push("LINE_NOT_IN_GRAMMAR"); continue; }
    if (!pathRegexBodyOk(d.body)) r.push("REGEX_NOT_ANCHORED_PATH");
    if (new RegExp(`\\b${d.name}\\b`).test(baseText) || newRegex.has(d.name)) r.push("REGEX_NAME_NOT_NEW");
    newRegex.add(d.name);
  }
  if (j !== bu.length) r.push("EXISTING_CONTENT_REMOVED");
  for (const [b, u] of matched) {
    if (u.kind === "line") continue;
    if (b.lines.join("\n") === u.lines.join("\n")) continue;
    const be = arrayElements(b), he = arrayElements(u);
    if (!be || !he) { r.push("ARRAY_UNREADABLE"); continue; }
    if (he.tokens.length <= be.tokens.length && JSON.stringify(he.tokens) !== JSON.stringify(be.tokens)) { r.push("ARRAY_NOT_APPEND_ONLY"); continue; }
    if (!be.tokens.every((t, i) => he.tokens[i]?.text === t.text)) { r.push("ARRAY_NOT_APPEND_ONLY"); continue; }
    if (!isSubsequence(be.comments, he.comments)) r.push("ARRAY_COMMENT_REMOVED");
    for (const c of he.comments) { const v = be.comments.includes(c) ? null : commentViolation(c.slice(2)); if (v) r.push(v); }
    for (const t of he.tokens.slice(be.tokens.length)) {
      if (t.kind === "id" && !newRegex.has(t.text)) r.push("ARRAY_APPENDS_UNKNOWN_IDENTIFIER");
      if (t.kind === "re" && !pathRegexBodyOk(t.body)) r.push("REGEX_NOT_ANCHORED_PATH");
    }
  }
}

/**
 * //TR: DESKTOP_ALLOWLIST_APPEND dil bilgisi (apps/desktop/main.mjs): işaretli B4/B5 bölgelerinin dışı bayt bayt aynıdır; bölge içinde mevcut her birim sırasıyla korunur,
 * yalnız yönergesiz yorum/boş satır, yeni ve çapalı "const NAME_RE=/^...$/;" bildirimleri ve mevcut dizilerin sonuna bu adlar veya çapalı yol desenleri eklenebilir. Fonksiyon, sorgu kuralı,
 * Set, Electron güvenlik ayarı veya mevcut desen değişikliği her zaman ihlaldir.
 */
export function desktopAllowlistViolations(baseText, headText) {
  if (typeof baseText !== "string" || typeof headText !== "string") return ["CONTENT_MISSING"];
  if (baseText === headText) return ["NO_CHANGE"];
  const base = splitLines(baseText), head = splitLines(headText);
  const at = lines => {
    const idx = [];
    for (const [b, e] of ALLOWLIST_MARKERS) {
      const bi = lines.map((l, i) => (l === b ? i : -1)).filter(i => i >= 0), ei = lines.map((l, i) => (l === e ? i : -1)).filter(i => i >= 0);
      if (bi.length !== 1 || ei.length !== 1 || bi[0] >= ei[0]) return null;
      idx.push(bi[0], ei[0]);
    }
    return idx.every((x, i) => i === 0 || x > idx[i - 1]) ? idx : null;
  };
  const bi = at(base), hi = at(head);
  if (!bi || !hi) return ["ALLOWLIST_MARKERS_INVALID"];
  const r = [];
  const outside = (lines, i) => [lines.slice(0, i[0] + 1), lines.slice(i[1], i[2] + 1), lines.slice(i[3])].map(x => x.join("\n"));
  const bo = outside(base, bi), ho = outside(head, hi);
  if (bo.some((x, k) => x !== ho[k])) r.push("CHANGE_OUTSIDE_ALLOWLIST");
  regionViolations(base.slice(bi[0] + 1, bi[1]), head.slice(hi[0] + 1, hi[1]), baseText, r);
  regionViolations(base.slice(bi[2] + 1, bi[3]), head.slice(hi[2] + 1, hi[3]), baseText, r);
  return [...new Set(r)];
}
