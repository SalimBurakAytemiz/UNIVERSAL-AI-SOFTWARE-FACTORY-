// //TR: Bu dosya Project Studio'nun küçük, özgün ve bağımlılıksız başlangıç şablonlarını tanımlar: web-node (PORT'u env'den okuyan küçük http sunucusu + index sayfası + node:assert testi), node-lib (saf fonksiyon + node:assert testi) ve empty (yalnız README/.gitignore; çalıştırılabilir kod olmadığı için test komutu yok).
import type {ProjectTemplate, ProjectType} from "./types.js";

export interface TemplateSpec { files: Record<string, string>; testCommand?: string[]; devCommand?: string[]; projectType: ProjectType }

const pkgName = (name: string) => (name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 60) || "project");
const mdSafe = (name: string) => name.replace(/[\r\n]+/g, " ").replace(/[<>`]/g, "").slice(0, 200);
// //TR: V3-T1012.a: bağımlılıksız şablonun kilit dosyası; npm'in --package-lock-only ile ürettiği lockfileVersion 3 biçimiyle birebir aynıdır, böylece teslimde `npm ci` ağ gerektirmeden çalışır.
export const lockfileFor = (name: string) => JSON.stringify({name, version: "0.1.0", lockfileVersion: 3, requires: true, packages: {"": {name, version: "0.1.0", license: "UNLICENSED"}}}, null, 2) + "\n";
// //TR: Kök dizindeki dosya adlarından (ve package.json içeriğinden) teslimin kilit dosyası durumu: package.json yoksa NOT_APPLICABLE; tutarlı bir kilit yoksa MISSING ya da INCONSISTENT.
export type LockfileManager = "npm" | "yarn" | "pnpm";
// //TR: Founder karar A: npm, Yarn ve pnpm kilitleri. package.json `packageManager` (corepack) bildiriyorsa o yöneticinin kilidi zorunludur; yalnız başka bir yöneticinin kilidi
// geçmez (MANAGER_MISMATCH). Bildirim yoksa tek bir yöneticinin kilidi yeter; birden çok yöneticinin kilidi sessizce kabul edilmez (MULTIPLE_LOCKS). Desteklenmeyen yönetici: UNSUPPORTED_MANAGER.
export const LOCKFILES: Readonly<Record<LockfileManager, readonly string[]>> = {npm: ["package-lock.json", "npm-shrinkwrap.json"], yarn: ["yarn.lock"], pnpm: ["pnpm-lock.yaml"]};
export const INSTALL_COMMAND: Readonly<Record<LockfileManager, string>> = {npm: "npm ci", yarn: "yarn install --immutable", pnpm: "pnpm install --frozen-lockfile"};
export interface LockfileCheck {
  status: "PRESENT" | "MISSING" | "NOT_APPLICABLE" | "INCONSISTENT";
  manager: LockfileManager | null; declared: string | null; lockfiles: string[];
  reason: "MANAGER_MISMATCH" | "MULTIPLE_LOCKS" | "UNSUPPORTED_MANAGER" | null; installCommand: string | null;
}
const MANAGERS = Object.keys(LOCKFILES) as LockfileManager[];
// packageManager "<name>@<version>[+hash]" -> name; geçersiz JSON / alan yok / dize değil -> null (bildirim yok sayılır: eski npm davranışı aynen kalır).
export function declaredPackageManager(packageJson: string | null | undefined): string | null {
  if (typeof packageJson !== "string") return null;
  let pm: unknown;
  try { pm = (JSON.parse(packageJson) as {packageManager?: unknown})?.packageManager; } catch { return null; }
  if (typeof pm !== "string" || !pm.trim()) return null;
  return pm.trim().split("@")[0]!.toLowerCase();
}
export function lockfileCheck(rootFiles: readonly string[], packageJson?: string | null): LockfileCheck {
  const lockfiles = MANAGERS.flatMap(m => LOCKFILES[m].filter(f => rootFiles.includes(f)));
  const present = MANAGERS.filter(m => LOCKFILES[m].some(f => rootFiles.includes(f)));
  const out = (status: LockfileCheck["status"], manager: LockfileManager | null, declared: string | null, reason: LockfileCheck["reason"] = null): LockfileCheck =>
    ({status, manager, declared, lockfiles, reason, installCommand: status === "PRESENT" && manager ? INSTALL_COMMAND[manager] : null});
  if (!rootFiles.includes("package.json")) return out("NOT_APPLICABLE", null, null);
  const declared = declaredPackageManager(packageJson);
  if (declared !== null) {
    if (!(MANAGERS as string[]).includes(declared)) return out("INCONSISTENT", null, declared, "UNSUPPORTED_MANAGER");
    const m = declared as LockfileManager;
    if (present.includes(m)) return out("PRESENT", m, declared);
    return present.length ? out("INCONSISTENT", m, declared, "MANAGER_MISMATCH") : out("MISSING", m, declared);
  }
  if (present.length > 1) return out("INCONSISTENT", null, null, "MULTIPLE_LOCKS");
  return present.length ? out("PRESENT", present[0]!, null) : out("MISSING", null, null);
}
/** Geriye uyumlu kısa biçim (yalnız durum). */
export function lockfileStatus(rootFiles: readonly string[], packageJson?: string | null): LockfileCheck["status"] { return lockfileCheck(rootFiles, packageJson).status; }
const htmlEsc = (s: string) => s.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c] as string));

export function renderTemplate(template: ProjectTemplate, projectName: string): TemplateSpec {
  const pkg = pkgName(projectName), title = mdSafe(projectName);
  const gitignore = "node_modules/\n.env\n*.log\n";
  switch (template) {
    case "web-node": return {
      projectType: "web", testCommand: ["node", "test.js"], devCommand: ["node", "server.js"],
      files: {
        "package.json": JSON.stringify({name: pkg, version: "0.1.0", private: true, description: "Web starter created by UASCO Project Studio", main: "server.js", scripts: {start: "node server.js", test: "node test.js"}, license: "UNLICENSED"}, null, 2) + "\n",
        "package-lock.json": lockfileFor(pkg),
        "server.js": [
          "\"use strict\";",
          "// Minimal dependency-free web server. PORT comes from the environment; it binds to the loopback interface only.",
          "const http = require(\"node:http\");",
          "const fs = require(\"node:fs\");",
          "const path = require(\"node:path\");",
          "",
          "const INDEX = path.join(__dirname, \"public\", \"index.html\");",
          "",
          "function createServer() {",
          "  return http.createServer((req, res) => {",
          "    const url = new URL(req.url || \"/\", \"http://localhost\");",
          "    if (req.method === \"GET\" && url.pathname === \"/health\") {",
          "      res.writeHead(200, {\"content-type\": \"application/json\"});",
          "      res.end(JSON.stringify({status: \"ok\"}));",
          "      return;",
          "    }",
          "    if (req.method === \"GET\" && (url.pathname === \"/\" || url.pathname === \"/index.html\")) {",
          "      res.writeHead(200, {\"content-type\": \"text/html; charset=utf-8\"});",
          "      res.end(fs.readFileSync(INDEX));",
          "      return;",
          "    }",
          "    res.writeHead(404, {\"content-type\": \"text/plain; charset=utf-8\"});",
          "    res.end(\"Not found\");",
          "  });",
          "}",
          "",
          "if (require.main === module) {",
          "  const port = Number(process.env.PORT || 3000);",
          "  createServer().listen(port, \"127.0.0.1\", () => console.log(`listening on http://127.0.0.1:${port}`));",
          "}",
          "",
          "module.exports = {createServer};",
          ""
        ].join("\n"),
        "public/index.html": `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${htmlEsc(title)}</title>\n</head>\n<body>\n  <main>\n    <h1>${htmlEsc(title)}</h1>\n    <p>Your project is running.</p>\n  </main>\n</body>\n</html>\n`,
        "test.js": [
          "\"use strict\";",
          "const assert = require(\"node:assert/strict\");",
          "const http = require(\"node:http\");",
          "const {createServer} = require(\"./server.js\");",
          "",
          "const get = (port, p) => new Promise((resolve, reject) => {",
          "  http.get({host: \"127.0.0.1\", port, path: p}, res => {",
          "    let body = \"\";",
          "    res.setEncoding(\"utf8\");",
          "    res.on(\"data\", c => { body += c; });",
          "    res.on(\"end\", () => resolve({status: res.statusCode, body}));",
          "  }).on(\"error\", reject);",
          "});",
          "",
          "const server = createServer().listen(0, \"127.0.0.1\", async () => {",
          "  try {",
          "    const port = server.address().port;",
          "    const index = await get(port, \"/\");",
          "    assert.equal(index.status, 200);",
          "    assert.match(index.body, /<h1>/);",
          "    const health = await get(port, \"/health\");",
          "    assert.deepEqual(JSON.parse(health.body), {status: \"ok\"});",
          "    assert.equal((await get(port, \"/missing\")).status, 404);",
          "    console.log(\"all tests passed\");",
          "  } catch (e) {",
          "    console.error(e);",
          "    process.exitCode = 1;",
          "  } finally {",
          "    server.close();",
          "  }",
          "});",
          ""
        ].join("\n"),
        "README.md": `# ${title}\n\nA small dependency-free Node.js web starter created by UASCO Project Studio.\n\n- Run: \`node server.js\` (reads \`PORT\`, default 3000, binds 127.0.0.1)\n- Test: \`node test.js\`\n`,
        ".gitignore": gitignore
      }
    };
    case "node-lib": return {
      projectType: "library", testCommand: ["node", "test.js"],
      files: {
        "package.json": JSON.stringify({name: pkg, version: "0.1.0", private: true, description: "Library starter created by UASCO Project Studio", main: "index.js", scripts: {test: "node test.js"}, license: "UNLICENSED"}, null, 2) + "\n",
        "package-lock.json": lockfileFor(pkg),
        "index.js": [
          "\"use strict\";",
          "// Turns a title into a URL-friendly slug.",
          "function slugify(input) {",
          "  return String(input)",
          "    .normalize(\"NFKD\")",
          "    .replace(/[\\u0300-\\u036f]/g, \"\")",
          "    .toLowerCase()",
          "    .replace(/[^a-z0-9]+/g, \"-\")",
          "    .replace(/^-+|-+$/g, \"\");",
          "}",
          "",
          "module.exports = {slugify};",
          ""
        ].join("\n"),
        "test.js": [
          "\"use strict\";",
          "const assert = require(\"node:assert/strict\");",
          "const {slugify} = require(\"./index.js\");",
          "",
          "assert.equal(slugify(\"Hello World\"), \"hello-world\");",
          "assert.equal(slugify(\"  Crème brûlée!  \"), \"creme-brulee\");",
          "assert.equal(slugify(\"\"), \"\");",
          "console.log(\"all tests passed\");",
          ""
        ].join("\n"),
        "README.md": `# ${title}\n\nA small dependency-free Node.js library starter created by UASCO Project Studio.\n\n- Test: \`node test.js\`\n`,
        ".gitignore": gitignore
      }
    };
    case "empty": return {
      projectType: "other",
      files: {"README.md": `# ${title}\n\nEmpty project created by UASCO Project Studio.\n`, ".gitignore": gitignore}
    };
  }
}
