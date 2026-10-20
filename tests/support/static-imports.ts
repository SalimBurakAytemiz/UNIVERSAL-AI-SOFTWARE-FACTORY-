// //TR: Bu yardımcı renderer içe aktarma bekçi testlerinin ortak, AST tabanlı statik bağımlılık çıkarıcısıdır (SEC-IMPORT-GUARD): satır biçimine bağlı regex yerine TypeScript derleyici API'si (ScriptKind.JS) ile statik import (yan etkili dahil), export…from yeniden dışa aktarımı, dinamik import() (dize olmayan argüman ayrı NON_LITERAL işaretiyle), require() ve import x = require() kayıtlarını çıkarır; yorum ve dize içindeki "import … from" metni AST gereği sayılmaz. İzin listesi denetimi her izinsiz bağımlılığı adıyla listeleyerek başarısız olur; isteğe bağlı geçişli kapanış yalnız göreli belirteçleri kök dizin içinde izler, kök dışına çıkış, dize olmayan belirteç ve çıplak belirteç fail-closed hatadır. Saf yardımcıdır: dosyaya yazmaz.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ImportKind = "static" | "reexport" | "dynamic" | "require" | "import-equals";
export interface ImportRecord { kind: ImportKind; specifier: string }
/** Dinamik import()/require() argümanı dize değişmezi değilse belirteç yerine bu işaret raporlanır; hiçbir izin listesi bunu kabul etmez. */
export const NON_LITERAL = "<NON_LITERAL>";
/** Dosya yolu (string) ya da bellekteki kaynak metni ({source}). */
export type ImportInput = string | {source: string; name?: string};

const literalText = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

function sourceOf(input: ImportInput): {name: string; text: string} {
  return typeof input === "string" ? {name: input, text: fs.readFileSync(input, "utf8")} : {name: input.name ?? "inline.js", text: input.source};
}

/** Kaynak sırasıyla tüm bağımlılık kayıtları. */
export function scanImports(input: ImportInput): ImportRecord[] {
  const {name, text} = sourceOf(input);
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: ImportRecord[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) out.push({kind: "static", specifier: literalText(n.moduleSpecifier) ?? NON_LITERAL});
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) out.push({kind: "reexport", specifier: literalText(n.moduleSpecifier) ?? NON_LITERAL});
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) out.push({kind: "import-equals", specifier: literalText(n.moduleReference.expression) ?? NON_LITERAL});
    else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push({kind: "dynamic", specifier: n.arguments.length === 1 || n.arguments.length === 2 ? literalText(n.arguments[0]) ?? NON_LITERAL : NON_LITERAL});
      else if (ts.isIdentifier(n.expression) && n.expression.text === "require") out.push({kind: "require", specifier: n.arguments.length === 1 ? literalText(n.arguments[0]) ?? NON_LITERAL : NON_LITERAL});
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

export interface AllowOptions { allowDynamic?: boolean; allowReexport?: boolean; allowRequire?: boolean }

/** İzin listesine göre ihlaller ("kind specifier" biçiminde); boş dizi = temiz. */
export function disallowedImports(input: ImportInput, allowed: readonly string[], opts: AllowOptions = {}): string[] {
  const ok = new Set(allowed);
  return scanImports(input).filter(r => {
    if (r.specifier === NON_LITERAL || !ok.has(r.specifier)) return true;
    if (r.kind === "dynamic") return !opts.allowDynamic;
    if (r.kind === "reexport") return !opts.allowReexport;
    if (r.kind === "require" || r.kind === "import-equals") return !opts.allowRequire;
    return false;
  }).map(r => `${r.kind} ${r.specifier}`);
}

/** İzinsiz her bağımlılığı listeleyerek fırlatır. Varsayılan: dinamik import, yeniden dışa aktarım ve require kapalı. */
export function expectOnlyAllowedImports(input: ImportInput, allowed: readonly string[], opts: AllowOptions = {}): void {
  const bad = disallowedImports(input, allowed, opts);
  if (bad.length) throw new Error(`DISALLOWED_IMPORTS in ${sourceOf(input).name}: ${bad.join(", ")}`);
}

const isRelative = (s: string) => s.startsWith("./") || s.startsWith("../");

/** start dosyasının göreli içe aktarma grafiğinin geçişli kapanışı: root'a göre posix yolları, sıralı, start hariç. Kök dışı, dize olmayan ya da çıplak belirteç ve eksik dosya hata fırlatır (fail-closed). */
export function relativeImportClosure(start: string, root: string): string[] {
  const absRoot = path.resolve(root);
  const rel = (f: string) => path.relative(absRoot, f).split(path.sep).join("/");
  const first = path.resolve(start);
  const seen = new Set<string>([first]);
  const queue = [first];
  while (queue.length) {
    const file = queue.shift()!;
    for (const {specifier} of scanImports(file)) {
      if (specifier === NON_LITERAL || !isRelative(specifier)) throw new Error(`CLOSURE_UNRESOLVABLE in ${rel(file)}: ${specifier}`);
      const target = path.resolve(path.dirname(file), specifier);
      if (target !== absRoot && !target.startsWith(absRoot + path.sep)) throw new Error(`CLOSURE_ESCAPES_ROOT in ${rel(file)}: ${specifier}`);
      if (!fs.existsSync(target)) throw new Error(`CLOSURE_MISSING in ${rel(file)}: ${specifier}`);
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  seen.delete(first);
  return [...seen].map(rel).sort();
}
