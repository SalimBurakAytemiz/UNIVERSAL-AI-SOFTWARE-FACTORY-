// //TR: Bu dosya Project Studio'nun küçük, özgün ve bağımlılıksız başlangıç şablonlarını tanımlar: web-node (PORT'u env'den okuyan küçük http sunucusu + index sayfası + node:assert testi), node-lib (saf fonksiyon + node:assert testi) ve empty (yalnız README/.gitignore; çalıştırılabilir kod olmadığı için test komutu yok).
import type {ProjectTemplate, ProjectType} from "./types.js";

export interface TemplateSpec { files: Record<string, string>; testCommand?: string[]; devCommand?: string[]; projectType: ProjectType }

const pkgName = (name: string) => (name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 60) || "project");
const mdSafe = (name: string) => name.replace(/[\r\n]+/g, " ").replace(/[<>`]/g, "").slice(0, 200);
const htmlEsc = (s: string) => s.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c] as string));

export function renderTemplate(template: ProjectTemplate, projectName: string): TemplateSpec {
  const pkg = pkgName(projectName), title = mdSafe(projectName);
  const gitignore = "node_modules/\n.env\n*.log\n";
  switch (template) {
    case "web-node": return {
      projectType: "web", testCommand: ["node", "test.js"], devCommand: ["node", "server.js"],
      files: {
        "package.json": JSON.stringify({name: pkg, version: "0.1.0", private: true, description: "Web starter created by UASCO Project Studio", main: "server.js", scripts: {start: "node server.js", test: "node test.js"}, license: "UNLICENSED"}, null, 2) + "\n",
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
          "const test = require(\"node:test\");",
          "const assert = require(\"node:assert/strict\");",
          "const {createServer} = require(\"./server.js\");",
          "",
          "// The request handler is called directly, without sockets: these tests must also pass inside a network-isolated sandbox where loopback is down.",
          "// node:test prints a machine-readable summary (tests/pass/fail counts) that the UASCO runner uses to prove the tests really ran.",
          "const handler = createServer().listeners(\"request\")[0];",
          "const call = (method, url) => {",
          "  const out = {status: 0, headers: {}, body: \"\"};",
          "  handler({method, url}, {",
          "    writeHead(status, headers) { out.status = status; out.headers = headers || {}; },",
          "    end(chunk) { out.body += chunk === undefined ? \"\" : String(chunk); }",
          "  });",
          "  return out;",
          "};",
          "",
          "test(\"GET / serves the index page\", () => {",
          "  const index = call(\"GET\", \"/\");",
          "  assert.equal(index.status, 200);",
          "  assert.match(index.body, /<h1>/);",
          "});",
          "",
          "test(\"GET /health answers ok\", () => {",
          "  const health = call(\"GET\", \"/health\");",
          "  assert.equal(health.status, 200);",
          "  assert.deepEqual(JSON.parse(health.body), {status: \"ok\"});",
          "});",
          "",
          "test(\"unknown paths answer 404\", () => {",
          "  assert.equal(call(\"GET\", \"/missing\").status, 404);",
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
