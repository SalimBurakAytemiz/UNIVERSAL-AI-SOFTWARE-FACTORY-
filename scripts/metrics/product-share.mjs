// //TR: Bu script UASCO-T0121 (RW-049) için son N birleşmiş PR'daki değişen satırların ürün kodu payını ölçer: yolları scripts/metrics/product-share.rules.json'daki (G7 §12 kuralı) sınıflama kurallarıyla sınıflar, ağ kullanmadan temel dalın git log'undaki "Merge pull request #N" birleşme commit'lerinin ilk-ebeveyn diff'ini (numstat) okur veya testler için enjekte edilen PR listesini kullanır ve tek satır JSON yazar. ≥%40 / 30 PR hedefi yalnız bilgilendirme durumudur; CI kapısı değildir ve çıkış kodunu etkilemez.
// usage: node scripts/metrics/product-share.mjs [--window 30] [--ref origin/v7/integration] [--rules <file>] [--input <prs.json>]
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

export const RULES_SCHEMA = "uasco.product-share-rules/v1";
export const OUTPUT_SCHEMA = "uasco.product-share/v1";
export const DEFAULT_RULES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "product-share.rules.json");
const PR_MERGE_RE = /^Merge pull request #(\d+)\b/;

export function globToRegExp(glob) {
  let re = "", i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 3; } else { re += ".*"; i += 2; }
    } else if (c === "*") { re += "[^/]*"; i++; }
    else if (c === "?") { re += "[^/]"; i++; }
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) throw new Error(`RULES_INVALID: unbalanced { in ${glob}`);
      re += "(?:" + glob.slice(i + 1, end).split(",").map((p) => p.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|") + ")";
      i = end + 1;
    } else { re += /[.+^$()|[\]\\]/.test(c) ? "\\" + c : c; i++; }
  }
  return new RegExp("^" + re + "$");
}

export function loadRules(rules) {
  if (!rules || rules.schema !== RULES_SCHEMA) throw new Error(`RULES_INVALID: schema must be ${RULES_SCHEMA}`);
  if (!Array.isArray(rules.rules) || rules.rules.length === 0) throw new Error("RULES_INVALID: rules[] empty");
  if (!Array.isArray(rules.productClasses) || rules.productClasses.length === 0) throw new Error("RULES_INVALID: productClasses[] empty");
  if (typeof rules.defaultClass !== "string" || !rules.defaultClass) throw new Error("RULES_INVALID: defaultClass");
  const compiled = rules.rules.map((r, idx) => {
    if (typeof r.class !== "string" || !Array.isArray(r.include) || r.include.length === 0) throw new Error(`RULES_INVALID: rule ${idx}`);
    return {cls: r.class, inc: r.include.map(globToRegExp), exc: (r.exclude ?? []).map(globToRegExp)};
  });
  const classes = new Set([...compiled.map((r) => r.cls), rules.defaultClass]);
  for (const p of rules.productClasses) if (!classes.has(p)) throw new Error(`RULES_INVALID: product class ${p} has no rule`);
  return {
    productClasses: new Set(rules.productClasses),
    target: rules.target ?? null,
    classify(file) {
      const f = String(file).replace(/\\/g, "/").replace(/^\.\//, "");
      for (const r of compiled) if (r.inc.some((x) => x.test(f)) && !r.exc.some((x) => x.test(f))) return r.cls;
      return rules.defaultClass;
    },
  };
}

// For a rename, numstat prints "old => new" or "dir/{old => new}/rest"; the new path is classified.
export function renamedTarget(p) {
  const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) return (brace[1] + brace[3] + brace[4]).replace(/\/\//g, "/");
  const arrow = p.split(" => ");
  return arrow.length === 2 ? arrow[1] : p;
}

export function parseNumstat(text) {
  const files = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!m) throw new Error(`NUMSTAT_UNPARSEABLE: ${line}`);
    const binary = m[1] === "-" || m[2] === "-";
    files.push({path: renamedTarget(m[3]), added: binary ? 0 : Number(m[1]), deleted: binary ? 0 : Number(m[2]), binary});
  }
  return files;
}

// prs: [{number, mergeSha?, files:[{path, added, deleted, binary?}]}], newest first. The window is the first `window` entries.
export function computeShare(prs, rulesDoc, {window = rulesDoc?.target?.windowPrs ?? 30, ref = null, source = "injected"} = {}) {
  if (!Number.isSafeInteger(window) || window <= 0) throw new Error("WINDOW_INVALID");
  const rules = loadRules(rulesDoc);
  const used = prs.slice(0, window);
  const byClass = {};
  let total = 0, product = 0, productPrs = 0, binaryFiles = 0;
  for (const pr of used) {
    let touchedProduct = false;
    for (const f of pr.files) {
      if (!Number.isSafeInteger(f.added) || !Number.isSafeInteger(f.deleted) || f.added < 0 || f.deleted < 0) throw new Error(`LINES_INVALID: #${pr.number} ${f.path}`);
      const cls = rules.classify(f.path);
      const n = f.added + f.deleted;
      if (f.binary) binaryFiles++;
      byClass[cls] = (byClass[cls] ?? 0) + n;
      total += n;
      if (rules.productClasses.has(cls)) { product += n; if (n > 0) touchedProduct = true; }
    }
    if (touchedProduct) productPrs++;
  }
  const share = total === 0 ? null : Math.round((product / total) * 10000) / 10000;
  const t = rules.target;
  let target = null;
  if (t && typeof t.minProductShare === "number") {
    const enough = used.length >= (t.windowPrs ?? 0);
    const status = share === null || !enough ? "INSUFFICIENT_DATA" : share >= t.minProductShare ? "MET" : "NOT_MET";
    target = {minProductShare: t.minProductShare, windowPrs: t.windowPrs ?? null, mode: "INFORMATIONAL", status};
  }
  const nums = used.map((p) => p.number).filter((n) => Number.isSafeInteger(n));
  return {
    schema: OUTPUT_SCHEMA,
    source,
    ref,
    window: {requested: window, prs: used.length, newestPr: nums.length ? Math.max(...nums) : null, oldestPr: nums.length ? Math.min(...nums) : null},
    lines: {total, product, byClass: Object.fromEntries(Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b)))},
    productShare: share,
    prs: {total: used.length, touchingProduct: productPrs},
    binaryFiles,
    target,
    note: "Lines = additions + deletions of each PR merge commit versus its first parent (binary files count 0). Informational only; not a gate.",
  };
}

const git = (cwd, args) => {
  const r = spawnSync("git", args, {cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024});
  if (r.status !== 0) throw new Error(`GIT_FAILED: git ${args.join(" ")}: ${(r.stderr || "").trim()}`);
  return r.stdout;
};

// Reads merged PRs from git with no network: first-parent "Merge pull request #N" commits on `ref`, newest first.
export function collectFromGit({cwd = process.cwd(), ref = "HEAD", window = 30} = {}) {
  const prs = [];
  const log = git(cwd, ["log", "--first-parent", "--merges", "--format=%H%x09%s", ref]);
  for (const line of log.split("\n")) {
    if (prs.length >= window) break;
    const [sha, subject = ""] = line.split("\t");
    const m = subject.match(PR_MERGE_RE);
    if (!sha || !m) continue;
    prs.push({number: Number(m[1]), mergeSha: sha, files: parseNumstat(git(cwd, ["diff", "--numstat", "-M", `${sha}^1`, sha]))});
  }
  return prs;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!["--window", "--ref", "--rules", "--input"].includes(a) || i + 1 >= argv.length) throw new Error(`USAGE: unknown or incomplete option ${a}`);
    o[a.slice(2)] = argv[++i];
  }
  return o;
}

export function main(argv = process.argv.slice(2), out = console, cwd = process.cwd()) {
  try {
    const o = parseArgs(argv);
    const rulesDoc = JSON.parse(fs.readFileSync(o.rules ? path.resolve(cwd, o.rules) : DEFAULT_RULES_FILE, "utf8"));
    const window = o.window === undefined ? (rulesDoc?.target?.windowPrs ?? 30) : Number(o.window);
    if (!Number.isSafeInteger(window) || window <= 0) throw new Error("WINDOW_INVALID");
    let prs, source, ref = null;
    if (o.input) { prs = JSON.parse(fs.readFileSync(path.resolve(cwd, o.input), "utf8")); source = "injected"; }
    else { ref = o.ref ?? "HEAD"; prs = collectFromGit({cwd, ref, window}); source = "git"; }
    out.log(JSON.stringify(computeShare(prs, rulesDoc, {window, ref, source})));
    return 0;
  } catch (e) {
    out.error(`PRODUCT_SHARE: FAIL ${e?.message ?? e}`);
    return String(e?.message ?? "").startsWith("USAGE") ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
