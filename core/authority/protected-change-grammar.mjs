// //TR: Korunan iki dosyadaki dar, Founder tarafından önceden yetkilendirilmiş değişiklik sınıflarının saf ve deterministik dil bilgisi denetimi: apps/control-api/src/server.ts için yalnız ekleme olan route kaydı (ROUTE_REGISTRATION_APPEND) ve apps/desktop/main.mjs için yalnız B4/B5 izin listesi bölgelerine çapalı yol deseni ekleme (DESKTOP_ALLOWLIST_APPEND). Girdi base ve head dosya metnidir; çıktı yalnız sabit kodlardır (dosya veya PR metni asla kopyalanmaz). Dil bilgisine uymayan her satır, silinen/değişen her satır ve okunamayan her bölge bir ihlaldir (fail-closed).
// Pure: no I/O, no clock. Every returned string is a fixed code. An empty list means the change has exactly the class's shape.

const splitLines = t => t.split("\n");
// //TR: Bağımlılık ifadelerinde yasak alt dizgiler (büyük/küçük harf duyarlı): süreç, modül yükleme, ağ, sandbox/ExecutionGate kabloları, dinleme, gizli değerler, dosya silme/yazma ve nesne/prototip kaçışları.
export const DENY_TOKENS = Object.freeze(["process.", "require(", "import(", "child_process", "spawn", "exec", "eval", "Function(", "fetch(", "http", "sandbox", "Sandbox", "ExecutionGate",
  "executionGate", "acceptUnenforced", "addHook", "app.register(", "listen", "env", "token", "secret", "password", "0.0.0.0", "::", "unlink", "rm(", "writeFile",
  // Stricter than the minimum list: no other way to reach globals, prototypes, modules, timers, the file system or the app object.
  "globalThis", "global", "constructor", "prototype", "__proto__", "Reflect", "Proxy", "Function", "import", "require", "opts", "app.", "laneDeps", "Token", "Secret", "Password",
  "Buffer", "fs.", "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "async", "await", "yield", "delete", "with(", "arguments", "Worker", "Atomics", "SharedArrayBuffer"]);
const denied = s => DENY_TOKENS.some(t => s.includes(t));

const ROUTE_IMPORT_RE = /^import \{(register[A-Z][A-Za-z0-9]*Routes)\} from "\.\/routes\/([a-z0-9]+(?:-[a-z0-9]+)*)\.js";$/;
const CORE_IMPORT_RE = /^import \{([A-Za-z_][A-Za-z0-9_]*(?:,[A-Za-z_][A-Za-z0-9_]*)*)\} from "\.\.\/\.\.\/\.\.\/core\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\.js";$/;
const REGISTER_PLAIN_RE = /^(register[A-Z][A-Za-z0-9]*Routes)\(app,laneDeps\);$/;
const REGISTER_LAZY_RE = /^(register[A-Z][A-Za-z0-9]*Routes)\(app,\{\.\.\.laneDeps,([A-Za-z_][A-Za-z0-9_]*):\(\)=>(.+)\}\);$/;
const REGISTER_ANY_RE = /^register[A-Z][A-Za-z0-9]*Routes\(app,/;
const LANE_DEPS_RE = /^const laneDeps=\{(.*)\};$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PAIRS = {")": "(", "]": "[", "}": "{"};
const BLOCK_COMMENT_RE = /\/\*|\*\//;

// //TR: Ayraçlar dengeli, derinlik hiç negatife düşmez ve sonda sıfırdır; tırnak, ters bölü, noktalı virgül, eğik çizgi, atama (=> dışında), ++/-- ve ASCII dışı karakter yoktur. Böylece ifade dış nesneyi/çağrıyı kapatıp yeni deyim ekleyemez.
export function safeExpression(expr) {
  if (typeof expr !== "string" || expr === "" || expr.length > 2000 || !/^[\x20-\x7e]+$/.test(expr)) return false;
  if (/["'`\\;/#]/.test(expr) || expr.replaceAll("=>", "").includes("=") || expr.includes("++") || expr.includes("--") || denied(expr)) return false;
  const stack = [];
  for (const c of expr) {
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (Object.hasOwn(PAIRS, c)) { if (stack.pop() !== PAIRS[c]) return false; }
  }
  return stack.length === 0;
}

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

/**
 * //TR: ROUTE_REGISTRATION_APPEND dil bilgisi (apps/control-api/src/server.ts): yalnız eklenen satırlar; her biri route içe aktarma, core'dan adlandırılmış içe aktarma,
 * registerXxxRoutes(app,laneDeps); veya registerXxxRoutes(app,{...laneDeps,<yeni anahtar>:()=><güvenli ifade>}); ya da "// " yorumu / boş satırdır. Kayıt satırları
 * tek "const laneDeps=" satırından sonra, mevcut kayıt bloğunun içinde olmalı, içe aktarılmış bir route fonksiyonunu tam bir kez kaydetmeli ve laneDeps anahtarlarını ezmemelidir.
 */
export function routeRegistrationViolations(baseText, headText) {
  if (typeof baseText !== "string" || typeof headText !== "string") return ["CONTENT_MISSING"];
  const base = splitLines(baseText), head = splitLines(headText);
  const added = insertedLines(base, head);
  if (added === null) return ["NOT_PURELY_ADDITIVE"];
  if (added.length === 0) return ["NO_CHANGE"];
  const r = [];
  const depsIdx = head.map((l, i) => (l.startsWith("const laneDeps=") ? i : -1)).filter(i => i >= 0);
  if (depsIdx.length !== 1 || base.filter(l => l.startsWith("const laneDeps=")).length !== 1) return ["LANE_DEPS_NOT_UNIQUE"];
  const deps = depsIdx[0], depKeys = laneDepsKeys(head[deps]);
  if (depKeys === null) return ["LANE_DEPS_UNREADABLE"];
  const addedSet = new Set(added);
  const importedRoutes = new Set(head.map(l => ROUTE_IMPORT_RE.exec(l)?.[1]).filter(Boolean));
  for (const i of added) {
    const l = head[i];
    if (l === "") continue;
    // A comment line may never open or close a block comment (it could otherwise turn commented-out text into code).
    if (l.startsWith("// ")) { if (BLOCK_COMMENT_RE.test(l)) r.push("COMMENT_NOT_IN_GRAMMAR"); continue; }
    let m;
    if ((m = ROUTE_IMPORT_RE.exec(l))) {
      if (i > deps) r.push("IMPORT_AFTER_LANE_DEPS");
      if (base.some(b => ROUTE_IMPORT_RE.exec(b)?.[1] === m[1])) r.push("ROUTE_ALREADY_IMPORTED");
      continue;
    }
    if ((m = CORE_IMPORT_RE.exec(l))) {
      if (i > deps) r.push("IMPORT_AFTER_LANE_DEPS");
      if (denied(m[1]) || denied(m[2]) || /^(?:authority|sandbox)(?:\/|$)/.test(m[2]) || m[2].includes("execution-gate")) r.push("CORE_IMPORT_DENIED");
      continue;
    }
    const plain = REGISTER_PLAIN_RE.exec(l), lazy = plain ? null : REGISTER_LAZY_RE.exec(l);
    if (!plain && !lazy) { r.push("LINE_NOT_IN_GRAMMAR"); continue; }
    const name = (plain ?? lazy)[1];
    if (i <= deps) { r.push("REGISTER_BEFORE_LANE_DEPS"); continue; }
    // Inside the registration block: the nearest earlier code line is laneDeps itself or another registration call.
    let k = i - 1;
    while (k > deps && (head[k] === "" || head[k].startsWith("// "))) k--;
    if (!(k === deps || REGISTER_ANY_RE.test(head[k]))) r.push("REGISTER_OUTSIDE_BLOCK");
    if (!importedRoutes.has(name)) r.push("REGISTER_NOT_IMPORTED");
    if (head.filter(h => h.startsWith(`${name}(`)).length !== 1 || base.some(b => b.startsWith(`${name}(`))) r.push("REGISTER_DUPLICATE");
    if (lazy) {
      if (depKeys.has(lazy[2]) || lazy[2] === "app") r.push("LANE_DEP_OVERRIDE");
      if (!safeExpression(lazy[3])) r.push("DEPENDENCY_EXPRESSION_DENIED");
    }
  }
  if (!added.some(i => addedSet.has(i) && (REGISTER_PLAIN_RE.test(head[i]) || REGISTER_LAZY_RE.test(head[i])))) r.push("NO_REGISTRATION_ADDED");
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
    if (t.trim().startsWith("//")) { if (BLOCK_COMMENT_RE.test(t)) r.push("COMMENT_NOT_IN_GRAMMAR"); continue; }
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
    if (he.comments.some(c => !be.comments.includes(c) && BLOCK_COMMENT_RE.test(c))) r.push("COMMENT_NOT_IN_GRAMMAR");
    for (const t of he.tokens.slice(be.tokens.length)) {
      if (t.kind === "id" && !newRegex.has(t.text)) r.push("ARRAY_APPENDS_UNKNOWN_IDENTIFIER");
      if (t.kind === "re" && !pathRegexBodyOk(t.body)) r.push("REGEX_NOT_ANCHORED_PATH");
    }
  }
}

/**
 * //TR: DESKTOP_ALLOWLIST_APPEND dil bilgisi (apps/desktop/main.mjs): işaretli B4/B5 bölgelerinin dışı bayt bayt aynıdır; bölge içinde mevcut her birim sırasıyla korunur,
 * yalnız yorum/boş satır, yeni ve çapalı "const NAME_RE=/^...$/;" bildirimleri ve mevcut dizilerin sonuna bu adlar veya çapalı yol desenleri eklenebilir. Fonksiyon, sorgu kuralı,
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
