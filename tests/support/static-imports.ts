// //TR: Bu yardımcı renderer içe aktarma bekçi testlerinin ortak, AST tabanlı statik bağımlılık çıkarıcısıdır (SEC-IMPORT-GUARD): satır biçimine bağlı regex yerine TypeScript derleyici API'si (ScriptKind.JS) ile statik import (yan etkili dahil), export…from yeniden dışa aktarımı, dinamik import() (dize olmayan argüman ayrı NON_LITERAL işaretiyle), require() import x = require(), require'a her başvuru ve import dışı modül yüklemeleri (Worker/SharedWorker, import.meta.resolve, importScripts, serviceWorker.register) kayıtlarını çıkarır; yorum ve dize içindeki "import … from" metni AST gereği sayılmaz. İzin listesi denetimi her izinsiz bağımlılığı adıyla listeleyerek başarısız olur; isteğe bağlı geçişli kapanış yalnız göreli belirteçleri kök dizin içinde izler, kök dışına çıkış, dize olmayan belirteç ve çıplak belirteç fail-closed hatadır. Sözdizimi hatalı (kısmi AST) ya da okunamayan kaynak fail-closed hatadır. Saf yardımcıdır: dosyaya yazmaz.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ImportKind = "static" | "reexport" | "dynamic" | "require" | "import-equals" | "require-reference" | "worker" | "shared-worker" | "import-meta-resolve" | "import-scripts" | "service-worker";
/** import dışı modül yüklemeleri (Worker/SharedWorker, import.meta.resolve, importScripts, serviceWorker.register); allowWorkers olmadan reddedilir. */
export const MODULE_LOAD_KINDS: readonly ImportKind[] = ["worker", "shared-worker", "import-meta-resolve", "import-scripts", "service-worker"];
export interface ImportRecord { kind: ImportKind; specifier: string }
/** Dinamik import()/require() argümanı dize değişmezi değilse belirteç yerine bu işaret raporlanır; hiçbir izin listesi bunu kabul etmez. */
export const NON_LITERAL = "<NON_LITERAL>";
/** Dosya yolu (string) ya da bellekteki kaynak metni ({source}). */
export type ImportInput = string | {source: string; name?: string};

const literalText = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

/** Okunamayan dosya atlanmaz: IMPORT_SOURCE_UNREADABLE ile fırlatılır (fail-closed). */
/** Erişilen özellik adı: a.b ve a["b"] için "b"; aksi halde null. */
const accessedName = (n: ts.Node): string | null =>
  ts.isPropertyAccessExpression(n) ? n.name.text : ts.isElementAccessExpression(n) ? literalText(n.argumentExpression) : null;
const calleeName = (n: ts.Expression): string | null => ts.isIdentifier(n) ? n.text : accessedName(n);
const isImportMeta = (n: ts.Node) => ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword && n.name.text === "meta";
/** Worker betiği: dize değişmezi ya da new URL("<lit>", import.meta.url); başka her şey NON_LITERAL. */
function workerSpecifier(arg: ts.Expression | undefined): string {
  const lit = literalText(arg);
  if (lit !== null) return lit;
  if (arg && ts.isNewExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === "URL" && arg.arguments?.length === 2) {
    const [u, base] = arg.arguments;
    if (ts.isPropertyAccessExpression(base) && base.name.text === "url" && isImportMeta(base.expression)) return literalText(u) ?? NON_LITERAL;
  }
  return NON_LITERAL;
}

function sourceOf(input: ImportInput): {name: string; text: string} {
  if (typeof input !== "string") return {name: input.name ?? "inline.js", text: input.source};
  try { return {name: input, text: fs.readFileSync(input, "utf8")}; }
  catch (e) { throw new Error(`IMPORT_SOURCE_UNREADABLE ${input}: ${e instanceof Error ? e.message : String(e)}`); }
}

function parse(name: string, text: string): {sf: ts.SourceFile; diagnostics: string[]} {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // createSourceFile hoşgörülüdür: sözdizimi hatasında kısmi AST döner. parseDiagnostics (TS 5.9) yoksa API değişmiştir; sessizce geçilmez.
  const diags = (sf as unknown as {parseDiagnostics?: readonly ts.Diagnostic[]}).parseDiagnostics;
  if (!Array.isArray(diags)) throw new Error(`IMPORT_PARSE_DIAGNOSTICS_UNAVAILABLE ${name}`);
  return {sf, diagnostics: diags.map(d => `${d.start === undefined ? "?" : sf.getLineAndCharacterOfPosition(d.start).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)};
}

/** Sözdizimi (parse) tanılamaları; boş dizi = temiz ayrıştırma. */
export function syntaxDiagnostics(input: ImportInput): string[] {
  const {name, text} = sourceOf(input);
  return parse(name, text).diagnostics;
}

/** Kaynak sırasıyla tüm bağımlılık kayıtları. Sözdizimi hatası varsa kısmi AST'ye güvenilmez: IMPORT_PARSE_ERROR ile fırlatır (fail-closed). */
export function scanImports(input: ImportInput): ImportRecord[] {
  const {name, text} = sourceOf(input);
  const {sf, diagnostics} = parse(name, text);
  if (diagnostics.length) throw new Error(`IMPORT_PARSE_ERROR ${name} line ${diagnostics[0]}`);
  const out: ImportRecord[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) out.push({kind: "static", specifier: literalText(n.moduleSpecifier) ?? NON_LITERAL});
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) out.push({kind: "reexport", specifier: literalText(n.moduleSpecifier) ?? NON_LITERAL});
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) out.push({kind: "import-equals", specifier: literalText(n.moduleReference.expression) ?? NON_LITERAL});
    else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) out.push({kind: "dynamic", specifier: n.arguments.length === 1 || n.arguments.length === 2 ? literalText(n.arguments[0]) ?? NON_LITERAL : NON_LITERAL});
      else if (ts.isIdentifier(callee) && callee.text === "require") {
        out.push({kind: "require", specifier: n.arguments.length === 1 ? literalText(n.arguments[0]) ?? NON_LITERAL : NON_LITERAL});
        n.arguments.forEach(visit); // çağrılan require tanımlayıcısı require-reference olarak ikinci kez sayılmaz
        return;
      }
      else if (accessedName(callee) === "resolve" && isImportMeta((callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression)) out.push({kind: "import-meta-resolve", specifier: literalText(n.arguments[0]) ?? NON_LITERAL});
      else if (calleeName(callee) === "importScripts") for (const a of n.arguments.length ? n.arguments : [undefined]) out.push({kind: "import-scripts", specifier: literalText(a) ?? NON_LITERAL});
      else if (accessedName(callee) === "register" && accessedName((callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression) === "serviceWorker") out.push({kind: "service-worker", specifier: literalText(n.arguments[0]) ?? NON_LITERAL});
    }
    else if (ts.isNewExpression(n) && (calleeName(n.expression) === "Worker" || calleeName(n.expression) === "SharedWorker")) out.push({kind: calleeName(n.expression) === "Worker" ? "worker" : "shared-worker", specifier: workerSpecifier(n.arguments?.[0])});
    // require'a çağrı dışı HER başvuru (globalThis.require, const r = require, window["require"]) bağımlılıktır; dize/yorum metni AST gereği sayılmaz.
    else if ((ts.isIdentifier(n) && n.text === "require") || (ts.isElementAccessExpression(n) && literalText(n.argumentExpression) === "require")) {
      out.push({kind: "require-reference", specifier: "require"});
      if (ts.isElementAccessExpression(n)) { visit(n.expression); return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Her türden bağımlılığın belirteçleri (kaynak sırası); eski regex'in yerine geçer ama import…from dışındaki türleri de içerir, böylece yeni bir bağımlılık hiçbir sözdizimiyle listeden kaçamaz. */
export function moduleSpecifiers(input: ImportInput): string[] {
  return scanImports(input).map(r => r.specifier);
}

export interface AllowOptions { allowDynamic?: boolean; allowReexport?: boolean; allowRequire?: boolean; allowWorkers?: boolean }

/** İzin listesine göre ihlaller ("kind specifier" biçiminde); boş dizi = temiz. */
export function disallowedImports(input: ImportInput, allowed: readonly string[], opts: AllowOptions = {}): string[] {
  const ok = new Set(allowed);
  return scanImports(input).filter(r => {
    if (r.specifier === NON_LITERAL || !ok.has(r.specifier)) return true;
    if (r.kind === "dynamic") return !opts.allowDynamic;
    if (r.kind === "reexport") return !opts.allowReexport;
    if (r.kind === "require" || r.kind === "import-equals" || r.kind === "require-reference") return !opts.allowRequire;
    if (MODULE_LOAD_KINDS.includes(r.kind)) return !opts.allowWorkers;
    return false;
  }).map(r => `${r.kind} ${r.specifier}`);
}

/** İzinsiz her bağımlılığı listeleyerek fırlatır. Varsayılan: dinamik import, yeniden dışa aktarım, require ve Worker/modül yüklemeleri kapalı. */
export function expectOnlyAllowedImports(input: ImportInput, allowed: readonly string[], opts: AllowOptions = {}): void {
  const bad = disallowedImports(input, allowed, opts);
  if (bad.length) throw new Error(`DISALLOWED_IMPORTS in ${sourceOf(input).name}: ${bad.join(", ")}`);
}

const isRelative = (s: string) => s.startsWith("./") || s.startsWith("../");

/** start dosyasının göreli içe aktarma grafiğinin geçişli kapanışı: root'a göre posix yolları, sıralı, start hariç. Kök dışı (sembolik bağ çözülmüş gerçek yol dahil), dize olmayan ya da çıplak belirteç ve eksik dosya hata fırlatır (fail-closed). */
export function relativeImportClosure(start: string, root: string): string[] {
  const absRoot = fs.realpathSync(path.resolve(root));
  const rel = (f: string) => path.relative(absRoot, f).split(path.sep).join("/");
  const first = fs.realpathSync(path.resolve(start));
  const seen = new Set<string>([first]);
  const queue = [first];
  while (queue.length) {
    const file = queue.shift()!;
    for (const {specifier} of scanImports(file)) {
      if (specifier === NON_LITERAL || !isRelative(specifier)) throw new Error(`CLOSURE_UNRESOLVABLE in ${rel(file)}: ${specifier}`);
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!resolved.startsWith(absRoot + path.sep)) throw new Error(`CLOSURE_ESCAPES_ROOT in ${rel(file)}: ${specifier}`);
      if (!fs.existsSync(resolved)) throw new Error(`CLOSURE_MISSING in ${rel(file)}: ${specifier}`);
      const target = fs.realpathSync(resolved);
      if (!target.startsWith(absRoot + path.sep)) throw new Error(`CLOSURE_ESCAPES_ROOT in ${rel(file)}: ${specifier}`);
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  seen.delete(first);
  return [...seen].map(rel).sort();
}
