// //TR: Bu betik gerçek Electron masaüstü uygulamasında her kabuk rotasını (23 rota) EN ve TR dillerinde (#langBtn ile, yeniden yükleme YOK) ve 1280/1024/800 genişliklerinde gezer (UASCO-T0006 izleme; ürün QA). Önyükleme desktop-journey.e2e.mjs ile aynı desendir: geçici veri dizini, FAKE yürütücülü gerçek Control API (scripts/e2e/fake-backend.ts), gerçek API üzerinden tohumlanan bir proje + mission; ücretli/ağ çağrısı yoktur. Her sayfa için: (a) main bir h1 ile çizilir, (b) yatay sayfa taşması yoktur, (c) ham köprü hata metni yoktur, (d) çevrilmemiş i18n anahtarı görünmez, (e) yapışkan gezinmenin üstü üst çubuğun altına ±1px eşittir (kaydırmadan önce ve sonra). Her rota/dil/genişlik için ekran görüntüsü ve kontrol başına PASS/FAIL içeren report.json yazılır; herhangi bir FAIL'de çıkış kodu sıfır değildir. Yalnız Linux xvfb; Windows kabulü DEĞİLDİR. Bulgular düzeltilmez, raporlanır.
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..", "..");
const argv = process.argv.slice(2), outArg = argv.indexOf("--out"), onlyArg = argv.indexOf("--routes");
const outDir = path.resolve(outArg >= 0 && argv[outArg + 1] ? argv[outArg + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "uasco-tour-")));
const shotsDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotsDir, {recursive: true});
const dataRoot = fs.mkdtempSync(path.join(outDir, "data-"));
export const ROUTES = Object.freeze(["home", "projects", "work", "inbox", "workforce", "assurance", "audit", "posture", "delivery", "tower", "queue", "readiness", "operations", "executive", "company", "academy", "domains", "journey", "matrix", "scheduler", "integrations", "install", "settings"]);
// //TR: #387 B1: bilinmeyen rota adı sessizce süzülmez (0 sayfa = sahte PASS olurdu): reddedilir ve çıkış kodu 2 olur; boş liste de reddedilir.
export function parseRoutes(arg, all = ROUTES) {
  if (arg === undefined) return {ok: true, routes: [...all]};
  const asked = String(arg).split(",").map(x => x.trim()).filter(Boolean), unknown = asked.filter(r => !all.includes(r));
  if (!asked.length) return {ok: false, error: "--routes is empty"};
  if (unknown.length) return {ok: false, error: `unknown route(s): ${unknown.join(", ")} (known: ${all.join(", ")})`};
  return {ok: true, routes: [...new Set(asked)]};
}
const routeArg = onlyArg >= 0 ? (argv[onlyArg + 1] ?? "") : undefined, parsedRoutes = parseRoutes(routeArg);
const routes = parsedRoutes.ok ? parsedRoutes.routes : [];
export const LANGS = Object.freeze(["en", "tr"]);
export const WIDTHS = Object.freeze([1280, 1024, 800]);
const HEIGHT = 800;
export const CHECKS = Object.freeze(["h1", "noHorizontalOverflow", "noRawBridgeError", "noUntranslatedKey", "stickyNavUnderTopbar"]);
// (c) ham köprü/IPC hata metni
export const RAW_ERROR_RES = Object.freeze([/Error invoking remote method/i, /uasco:api-/, /\/v1\/\S*: HTTP \d{3}/]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let app = null, win = null, backend = null, backendLog = "";

// ---- (d) i18n anahtar kümesi: gerçek sözlükten (en) okunur; görünen metinde AYNEN bir anahtar ya da bilinen bir anahtar ad alanıyla başlayan a.b.c biçimi FAIL'dir ----
const enDict = (await import(pathToFileURL(path.join(repo, "apps", "desktop", "renderer", "locales", "en.js")).href)).default;
const KEYS = new Set(Object.keys(enDict)), NAMESPACES = new Set([...KEYS].map(k => k.split(".")[0]));
const KEY_TOKEN_RE = /(?<![\w./-])[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_-]+){1,}(?![\w/-])/g;
/** Görünen metindeki çevrilmemiş anahtar adayları: tam anahtar ya da bilinen ad alanı + en az iki nokta (a.b.c). */
export function untranslatedKeys(text) {
  const out = new Set();
  for (const m of String(text).matchAll(KEY_TOKEN_RE)) {
    const tok = m[0].replace(/\.$/, ""), parts = tok.split(".");
    if (KEYS.has(tok) || (parts.length >= 3 && NAMESPACES.has(parts[0]))) out.add(tok);
  }
  return [...out];
}

// ---- ortam (desktop-journey ile aynı) ----
function loadPlaywright() {
  const req = createRequire(import.meta.url), explicit = process.env.PLAYWRIGHT_MODULE_DIR;
  const roots = explicit ? [explicit] : [undefined, ...(process.platform === "linux" ? ["/opt/node-tools/node_modules"] : [])];
  for (const root of roots) for (const name of ["playwright", "playwright-core"]) {
    try { const m = req(root ? path.join(root, name) : name); if (m && m._electron) return m; } catch { /* sıradaki */ }
  }
  return null;
}
async function electronBinary() {
  try {
    const m = await import(pathToFileURL(path.join(repo, "automation", "lib", "electron-provision.mjs")).href);
    const exe = await m.verifyProvisionedElectron(repo), p = typeof exe === "string" ? exe : exe?.exePath ?? exe?.exe;
    if (typeof p === "string" && fs.existsSync(p)) return p;
  } catch { /* yedek */ }
  try { const dir = path.join(repo, "node_modules", "electron"), rel = fs.readFileSync(path.join(dir, "path.txt"), "utf8").trim(), p = path.join(dir, "dist", rel); if (rel && fs.existsSync(p)) return p; } catch { /* yok */ }
  return null;
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on("error", rej); s.listen({host: "127.0.0.1", port: 0}, () => { const p = s.address().port; s.close(() => res(p)); }); });
const ENV_ALLOW = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "LANG", "LC_ALL", "ComSpec", "PATHEXT", "windir"];
const childEnv = extra => ({...Object.fromEntries(ENV_ALLOW.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])), ...extra});
// //TR: #387 B2: desktop-journey ile aynı temizlik deseni: sıra arka uç (SIGTERM, 5 sn içinde çıkmazsa SIGKILL) -> Electron (close, 15 sn; olmazsa süreç SIGKILL) -> geçici veri dizini. Aynı süren temizlik her çağırana aynı söz olarak döner (finish ve sinyal birlikte).
let cleanupP = null, sigExit = null;
const cleanup = () => (cleanupP ??= doCleanup());
async function doCleanup() {
  try {
    if (backend && backend.exitCode === null && backend.signalCode === null) {
      const exited = new Promise(r => backend.once("exit", r)); backend.kill("SIGTERM");
      await Promise.race([exited, sleep(5000)]);
      if (backend.exitCode === null && backend.signalCode === null) { backend.kill("SIGKILL"); await Promise.race([exited, sleep(2000)]); }
    }
  } catch { /* yoksay */ }
  try {
    if (app) {
      const proc = app.process(), gone = () => proc.exitCode !== null || proc.signalCode !== null, exited = gone() ? Promise.resolve() : new Promise(r => proc.once("exit", r));
      await Promise.race([app.close(), sleep(15000).then(() => { throw new Error("close timeout"); })]).catch(() => { try { proc.kill("SIGKILL"); } catch { /* yoksay */ } });
      // close() süreç gerçekten çıkmadan döner: süreç çıkana kadar beklenir (5 sn), çıkmazsa SIGKILL (selfcheck bunu yakaladı)
      await Promise.race([exited, sleep(5000)]);
      if (!gone()) { try { proc.kill("SIGKILL"); } catch { /* yoksay */ } await Promise.race([exited, sleep(2000)]); }
    }
  } catch { /* yoksay */ }
  try { fs.rmSync(dataRoot, {recursive: true, force: true}); } catch { /* yoksay */ }
}
// Sinyal gelirse çıkış kodu her koşulda 130 (SIGINT) / 143 (SIGTERM) olur; temizlik tamamlanmadan çıkılmaz.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { sigExit = sig === "SIGINT" ? 130 : 143; cleanup().finally(() => process.exit(sigExit)); });
// Her çıkış yolunda arka uç ve Electron hâlâ yaşıyorsa SIGKILL, veri dizini senkron silinir: geride süreç ya da dizin kalmaz.
process.on("exit", () => {
  try { if (backend && backend.exitCode === null && backend.signalCode === null) backend.kill("SIGKILL"); } catch { /* yoksay */ }
  try { const p = app?.process?.(); if (p && p.exitCode === null && p.signalCode === null) p.kill("SIGKILL"); } catch { /* yoksay */ }
  try { fs.rmSync(dataRoot, {recursive: true, force: true}); } catch { /* yoksay */ }
});

// ---- tohum: GERÇEK API (fake-backend üzerinde gerçek buildServer) ----
async function seed(port, token) {
  const post = async (p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {method: "POST", headers: {"content-type": "application/json", "x-uasco-control-token": token}, body: JSON.stringify(body)});
    let j = null; try { j = await r.json(); } catch { /* boş */ }
    return {status: r.status, body: j};
  };
  const pr = await post("/v1/projects", {name: "Tour project", environmentId: "env-dev", template: "web-node", devCommand: ["node", "server.js"]});
  const projectId = pr.body?.project?.projectId ?? null;
  const ms = projectId ? await post("/v1/missions", {projectId, title: "Tour mission", objective: "Show a list of books", acceptanceCriteria: ["the list renders"], riskLevel: "R1"}) : {status: null, body: null};
  return {project: {status: pr.status, projectId}, mission: {status: ms.status, missionId: ms.body?.mission?.missionId ?? null}};
}

// ---- sayfa ölçümü (tarayıcıda) ----
const measure = () => win.evaluate(() => {
  const main = document.getElementById("main"), h1 = main?.querySelector("h1"), de = document.documentElement;
  const top = document.getElementById("topbar"), nav = document.getElementById("nav");
  const rect = n => n ? n.getBoundingClientRect() : null;
  const before = {top: rect(top), nav: rect(nav)};
  // (e) kaydırmadan sonra da: sayfa kaydırılabiliyorsa en alta kaydırılır, ölçülür, geri alınır
  const scroller = document.scrollingElement || de, y0 = scroller.scrollTop;
  scroller.scrollTop = scroller.scrollHeight;
  const after = {top: rect(top), nav: rect(nav), scrolled: scroller.scrollTop - y0};
  scroller.scrollTop = y0;
  const bounds = r => r ? {top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10} : null;
  // (b) kanıt: sağ kenarı görünüm genişliğini aşan en geniş öğeler (yaprağa en yakın olanlar), seçici biçiminde
  const cw = de.clientWidth, desc = n => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
  const over = [...document.querySelectorAll("main *")].filter(n => n.getBoundingClientRect().right > cw + 1 && ![...n.children].some(c => c.getBoundingClientRect().right > cw + 1))
    .slice(0, 4).map(n => `${desc(n)} (right ${Math.round(n.getBoundingClientRect().right)}px${n.closest("[id]") && n.closest("[id]") !== n ? ` in #${n.closest("[id]").id}` : ""})`);
  return {
    h1: h1 ? (h1.innerText || "").trim() : null, busy: main?.getAttribute("aria-busy") ?? null,
    lang: de.lang, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, overflowers: over,
    text: (main?.innerText ?? "") + "\n" + (document.getElementById("topbar")?.innerText ?? "") + "\n" + (document.getElementById("nav")?.innerText ?? ""),
    before: {top: bounds(before.top), nav: bounds(before.nav)}, after: {top: bounds(after.top), nav: bounds(after.nav), scrolled: after.scrolled},
  };
});
export function evaluateChecks(m) {
  const res = {};
  res.h1 = m.h1 ? {status: "PASS"} : {status: "FAIL", evidence: `main has no h1 (aria-busy=${m.busy})`};
  res.noHorizontalOverflow = m.scrollWidth <= m.clientWidth + 1 ? {status: "PASS"} : {status: "FAIL", evidence: `scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth} + 1${m.overflowers?.length ? `; widest: ${m.overflowers.join(", ")}` : ""}`};
  // (c) kanıt: eşleşmenin çevresindeki metin (satır)
  const raw = RAW_ERROR_RES.flatMap(re => { const x = re.exec(m.text); if (!x) return []; const a = m.text.lastIndexOf("\n", x.index) + 1, b = m.text.indexOf("\n", x.index); return [m.text.slice(a, b < 0 ? undefined : b).trim().slice(0, 220)]; });
  res.noRawBridgeError = raw.length ? {status: "FAIL", evidence: [...new Set(raw)].join(" | ").slice(0, 500)} : {status: "PASS"};
  const keys = untranslatedKeys(m.text);
  res.noUntranslatedKey = keys.length ? {status: "FAIL", evidence: keys.slice(0, 10).join(", ")} : {status: "PASS"};
  const gap = s => s.top && s.nav ? Math.abs(s.nav.top - s.top.bottom) : null;
  const g0 = gap(m.before), g1 = gap(m.after);
  if (g0 === null || g1 === null) res.stickyNavUnderTopbar = {status: "FAIL", evidence: "topbar or nav not found"};
  else res.stickyNavUnderTopbar = g0 <= 1 && g1 <= 1 ? {status: "PASS"} : {status: "FAIL", evidence: `nav.top - topbar.bottom: ${(m.before.nav.top - m.before.top.bottom).toFixed(1)}px at rest, ${(m.after.nav.top - m.after.top.bottom).toFixed(1)}px after scrolling ${m.after.scrolled}px`};
  return res;
}

async function setWidth(w) {
  await app.evaluate(({BrowserWindow}, [width, height]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(width, height); }, [w, HEIGHT]);
  await win.waitForFunction(width => Math.abs(window.innerWidth - width) <= 2, w, {timeout: 10000}).catch(() => undefined);
  await sleep(300);
}
async function setLang(lang) {
  const cur = await win.evaluate(() => document.documentElement.lang);
  if (cur !== lang) { await win.click("#langBtn"); await win.waitForFunction(l => document.documentElement.lang === l, lang, {timeout: 10000}); await sleep(700); }
}
async function visit(route) {
  await win.evaluate(h => { location.hash = h; }, `#/${route}`);
  await win.waitForFunction(r => { const m = document.getElementById("main"); return !!m && m.dataset.route === r && m.getAttribute("aria-busy") !== "true"; }, route, {timeout: 20000}).catch(() => undefined);
  await sleep(600);
}

async function main() {
  if (!parsedRoutes.ok) { console.log(`FAIL args: ${parsedRoutes.error}`); return 2; }
  const pw = loadPlaywright(), exe = await electronBinary();
  if (!pw || !exe) { console.log(`BLOCKED ${!pw ? "PLAYWRIGHT_MISSING" : "ELECTRON_BINARY_MISSING"}`); return 3; }
  if (process.platform !== "linux") { console.log("BLOCKED LINUX_ONLY (xvfb tour; not Windows acceptance)"); return 3; }
  const port = await freePort(), token = crypto.randomBytes(24).toString("hex");
  backend = spawn(process.execPath, ["--import", "tsx", path.join("scripts", "e2e", "fake-backend.ts")], {cwd: repo, env: childEnv({CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token, E2E_DATA_ROOT: dataRoot}), stdio: ["ignore", "pipe", "pipe"]});
  backend.stdout.on("data", d => { backendLog += d; }); backend.stderr.on("data", d => { backendLog += d; });
  for (let i = 0; i < 300 && !backendLog.includes("E2E_BACKEND_READY"); i++) await sleep(200);
  if (!backendLog.includes("E2E_BACKEND_READY")) { console.log(`FAIL startup: backend not ready ${backendLog.slice(-400)}`); return 1; }
  const seeded = await seed(port, token);
  console.log(`SEED project=${seeded.project.status}:${seeded.project.projectId} mission=${seeded.mission.status}:${seeded.mission.missionId}`);
  const noSandbox = process.getuid?.() === 0 || process.env.E2E_NO_SANDBOX === "1";
  app = await pw._electron.launch({executablePath: exe, args: [path.join("apps", "desktop", "main.mjs"), `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`, ...(noSandbox ? ["--no-sandbox"] : []), "--disable-gpu"], cwd: repo, env: childEnv({CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token}), timeout: 60000});
  console.log(`PIDS backend=${backend.pid} electron=${app.process().pid} data=${dataRoot}`); // --selfcheck bu satırla artık süreç/dizin kalmadığını doğrular
  win = await app.firstWindow();
  await win.waitForSelector("main", {state: "attached", timeout: 30000});
  await win.evaluate(() => { localStorage.setItem("uasco.lang", "en"); }); await win.reload(); // tek başlangıç yüklemesi; dil değişimi sonra yalnız #langBtn ile
  await win.waitForSelector("main", {state: "attached", timeout: 30000}); await sleep(1500);
  if (await win.$("#firstRunDialog[open]")) { await win.keyboard.press("Escape"); await sleep(500); }
  const results = [];
  for (const lang of LANGS) {
    await setLang(lang);
    for (const w of WIDTHS) {
      await setWidth(w);
      for (const route of routes) {
        await visit(route);
        let m, checks;
        try { m = await measure(); checks = evaluateChecks(m); } catch (e) { checks = Object.fromEntries(CHECKS.map(c => [c, {status: "FAIL", evidence: `measure failed: ${String(e?.message ?? e).slice(0, 200)}`}])); m = null; }
        if (m && m.lang !== lang) checks.h1 = {status: "FAIL", evidence: `document lang ${m.lang} != ${lang}`};
        const file = `${route}-${lang}-${w}.png`;
        try { await win.screenshot({path: path.join(shotsDir, file), timeout: 10000}); } catch { /* görüntü alınamadı */ }
        const fails = CHECKS.filter(c => checks[c].status === "FAIL");
        results.push({route, lang, width: w, h1: m?.h1 ?? null, checks, screenshot: file});
        console.log(`${fails.length ? "FAIL" : "PASS"} ${route} ${lang} ${w}${fails.length ? ` — ${fails.map(c => `${c}: ${checks[c].evidence}`).join(" ; ")}` : ""}`);
      }
    }
  }
  const failures = results.flatMap(r => CHECKS.filter(c => r.checks[c].status === "FAIL").map(c => ({route: r.route, lang: r.lang, width: r.width, check: c, evidence: r.checks[c].evidence, screenshot: r.screenshot})));
  const byCheck = Object.fromEntries(CHECKS.map(c => [c, {pass: results.filter(r => r.checks[c].status === "PASS").length, fail: results.filter(r => r.checks[c].status === "FAIL").length}]));
  const report = {platform: process.platform, node: process.version, scope: "Linux xvfb only; not Windows acceptance", seeded, routes, langs: LANGS, widths: WIDTHS, pages: results.length, byCheck, failures, results, result: failures.length || !results.length ? "FAIL" : "PASS"};
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`RESULT ${report.result} pages=${results.length} failures=${failures.length} ${JSON.stringify(byCheck)} out=${outDir}`);
  // //TR: #387 B1: hiç sayfa gezilmediyse sonuç PASS sayılmaz.
  if (!results.length) { console.log("FAIL no pages were visited"); return 1; }
  return failures.length ? 1 : 0;
}

// //TR: --selfcheck: betiğin kendisini alt süreç olarak çalıştırıp iki engeli doğrular: (1) bilinmeyen --routes -> çıkış 2, PASS yok, rapor yok; boş --routes -> 2; (2) çalışırken SIGTERM -> çıkış 143, arka uç ve Electron süreçleri ölü, geçici veri dizini silinmiş.
async function selfcheck() {
  const self = fileURLToPath(import.meta.url), results = [];
  const run = (args, {killOn = null, sig = "SIGTERM"} = {}) => new Promise(res => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-tour-sc-"));
    const c = spawn(process.execPath, [self, "--out", out, ...args], {cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    let log = "", killed = false;
    c.stdout.on("data", d => { log += d; if (killOn && !killed && killOn.test(log)) { killed = true; setTimeout(() => c.kill(sig), 1500); } }); c.stderr.on("data", d => { log += d; });
    c.on("exit", (code, signal) => res({code, signal, log, out}));
  });
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const check = (name, ok, detail) => { results.push({name, ok, detail}); console.log(`${ok ? "PASS" : "FAIL"} selfcheck ${name} — ${detail}`); };
  const bad = await run(["--routes", "home,nope"]);
  check("unknown-route", bad.code === 2 && /FAIL args: unknown route\(s\): nope/.test(bad.log) && !/^RESULT PASS/m.test(bad.log) && !fs.existsSync(path.join(bad.out, "report.json")), `exit ${bad.code}; ${bad.log.trim().split("\n").pop()}`);
  const empty = await run(["--routes", ""]);
  check("empty-routes", empty.code === 2 && /--routes is empty/.test(empty.log), `exit ${empty.code}`);
  for (const sig of ["SIGTERM", "SIGINT"]) {
    const t = await run(["--routes", "home"], {killOn: /^PIDS backend=\d+ electron=\d+ data=\S+$/m, sig});
    const m = /^PIDS backend=(\d+) electron=(\d+) data=(\S+)$/m.exec(t.log);
    await sleep(500);
    const want = sig === "SIGTERM" ? 143 : 130;
    const ok = !!m && t.code === want && !alive(Number(m[1])) && !alive(Number(m[2])) && !fs.existsSync(m[3]);
    check(`${sig.toLowerCase()}-cleanup`, ok, m ? `exit ${t.code} (want ${want}); backend ${m[1]} ${alive(Number(m[1])) ? "ALIVE" : "dead"}; electron ${m[2]} ${alive(Number(m[2])) ? "ALIVE" : "dead"}; data dir ${fs.existsSync(m[3]) ? "LEFT BEHIND" : "removed"}` : `no PIDS line (exit ${t.code})`);
  }
  for (const r of [bad, empty]) fs.rmSync(r.out, {recursive: true, force: true});
  return results.every(r => r.ok) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && argv.includes("--selfcheck")) {
  fs.rmSync(dataRoot, {recursive: true, force: true});
  const code = await selfcheck();
  console.log(`SELFCHECK ${code === 0 ? "PASS" : "FAIL"}`);
  process.exit(code);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try { code = await main(); } catch (e) { console.log(`FAIL startup: ${String(e?.message ?? e).slice(0, 500)} ${backendLog.slice(-300)}`); code = 1; }
  await cleanup();
  process.exit(code);
}
