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
const SELFTEST = argv.includes("--selftest");
const routes = onlyArg >= 0 && argv[onlyArg + 1] ? argv[onlyArg + 1].split(",").filter(r => ROUTES.includes(r)) : ROUTES;
export const LANGS = Object.freeze(["en", "tr"]);
export const WIDTHS = Object.freeze([1280, 1024, 800]);
const HEIGHT = 800;
export const CHECKS = Object.freeze(["h1", "noHorizontalOverflow", "noRawBridgeError", "noUntranslatedKey", "stickyNavUnderTopbar", "keyboardReach", "focusVisible", "noFocusTrap", "contrastAA"]);
export const TAB_LIMIT = 60;
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
async function cleanup() {
  try { if (app) await Promise.race([app.close(), sleep(15000)]); } catch { /* yoksay */ }
  try { if (backend && backend.exitCode === null) { backend.kill("SIGTERM"); await sleep(500); if (backend.exitCode === null) backend.kill("SIGKILL"); } } catch { /* yoksay */ }
  try { fs.rmSync(dataRoot, {recursive: true, force: true}); } catch { /* yoksay */ }
}
process.on("exit", () => { try { if (backend && backend.exitCode === null) backend.kill("SIGKILL"); } catch { /* yoksay */ } try { fs.rmSync(dataRoot, {recursive: true, force: true}); } catch { /* yoksay */ } });

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
// ---- (f) klavye erişimi + (g) görünür odak + (h) odak tuzağı + (i) WCAG AA kontrast ----
// //TR: Tarayıcı tarafı: main ve nav içindeki görünür etkileşimli öğeler etiketlenir (data-tour-k); Tab en çok TAB_LIMIT kez basılır, her adımda odaklanan öğe ve odak göstergesi (outline genişliği ≥2px ya da box-shadow) kaydedilir.
const tagInteractive = () => win.evaluate(() => {
  const SEL = "a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]";
  const vis = n => { const r = n.getBoundingClientRect(), cs = getComputedStyle(n); const closedDetails = n.closest("details:not([open])"); if (closedDetails && !(n.tagName === "SUMMARY" && n.parentElement === closedDetails)) return false; // kapalı <details> içeriği Tab ile ulaşılamaz ve görünmez
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !n.closest("[hidden],[inert],dialog:not([open])"); };
  const desc = n => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${n.dataset.focusKey && !n.id ? `[data-focus-key=${n.dataset.focusKey}]` : ""}${(n.innerText || n.getAttribute("aria-label") || "").trim() ? ` "${(n.innerText || n.getAttribute("aria-label")).trim().replace(/\s+/g, " ").slice(0, 30)}"` : ""}`;
  let i = 0; const out = [];
  for (const scope of [document.getElementById("nav"), document.getElementById("main")]) {
    if (!scope) continue;
    for (const n of scope.querySelectorAll(SEL)) {
      if (n.disabled || n.getAttribute("tabindex") === "-1" || n.getAttribute("aria-hidden") === "true" || !vis(n)) continue;
      n.dataset.tourK = String(i++); out.push({k: n.dataset.tourK, desc: desc(n), scope: scope.id});
    }
  }
  return out;
});
const focusInfo = () => win.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return {k: null, desc: "body", visible: null};
  const cs = getComputedStyle(a), ow = parseFloat(cs.outlineWidth) || 0;
  const visible = (cs.outlineStyle !== "none" && ow >= 2) || (cs.boxShadow && cs.boxShadow !== "none");
  return {k: a.dataset.tourK ?? null, desc: `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""}`, visible, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, shadow: cs.boxShadow};
});
async function keyboardWalk() {
  const expected = await tagInteractive();
  // //TR: Gezinme belgenin başından başlar: üst çubuğun ilk odaklanabilir öğesine odak verilir (blur, sıralı gezinme başlangıç noktasını main içinde bırakır ve uzun sayfalarda nav'a hiç dönülmezdi).
  const started = await win.evaluate(() => { window.scrollTo(0, 0); const f = document.querySelector("#topbar a[href],#topbar button:not([disabled]),#topbar input,#topbar select,#topbar [tabindex]:not([tabindex='-1'])"); if (f) { f.focus(); return true; } document.activeElement?.blur?.(); return false; });
  const seen = new Map(), order = [], noFocusRing = [], path = [];
  let prev = null, stuck = 0, maxStuck = 0, presses = 0;
  for (; presses < TAB_LIMIT; presses++) {
    await win.keyboard.press("Tab");
    const f = await focusInfo();
    const id = f.k ?? `x:${f.desc}`;
    if (id === prev) { stuck++; maxStuck = Math.max(maxStuck, stuck); } else stuck = 0;
    prev = id; order.push(id); path.push(f.desc);
    if (f.k !== null && !seen.has(f.k)) { seen.set(f.k, f); if (f.visible === false) noFocusRing.push(`${f.desc} (outline ${f.outline}, shadow ${f.shadow})`); }
    if (expected.length && expected.every(e => seen.has(e.k))) break;
  }
  // //TR: Ulaşılamayan = sırada kendisinden SONRAKİ bir öğeye ulaşıldığı hâlde atlanan öğe (gerçek atlama). TAB_LIMIT'e takılan, son ulaşılandan sonraki öğeler ayrıca "limit" olarak bildirilir, başarısızlık sayılmaz.
  const lastReached = Math.max(-1, ...[...seen.keys()].map(Number));
  const skipped = expected.filter(e => !seen.has(e.k) && Number(e.k) < lastReached);
  const beyond = expected.filter(e => !seen.has(e.k) && Number(e.k) > lastReached);
  await win.evaluate(() => { for (const n of document.querySelectorAll("[data-tour-k]")) delete n.dataset.tourK; document.activeElement?.blur?.(); });
  // odak tuzağı: aynı öğede ardışık ≥2 Tab ya da beklenen öğeler bitmeden yalnız ≤2 öğe arasında dönen son 10 adım
  const tail = order.slice(-10), cycling = order.length >= 10 && new Set(tail).size <= 2 && expected.some(e => !seen.has(e.k));
  return {started, path, expected: expected.length, reached: seen.size, presses: presses + 1, skipped: skipped.map(e => e.desc), beyond: beyond.length, noFocusRing, trap: maxStuck >= 2 || cycling ? `focus stayed on ${prev} for ${maxStuck + 1} presses${cycling ? " (cycling)" : ""}` : null};
}
const contrastScan = () => win.evaluate(() => {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const lum = ({r, g, b}) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => ({r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1});
  // etkin arka plan: ata zinciri boyunca saydam olmayan ilk arka plan rengi (yarı saydamlar karıştırılır); görsel/gradyan varsa ölçülemez (null)
  // //TR: Gradyan arka planda her renk durağı ayrı aday arka plan sayılır ve EN KÖTÜ kontrast alınır; url() görseli ölçülemez (null).
  const allColors = s => [...String(s).matchAll(/rgba?\([^)]+\)/g)].map(m => parse(m[0])).filter(Boolean);
  const bgOf = n => {
    const layers = [];
    for (let e = n; e; e = e.parentElement) {
      const cs = getComputedStyle(e), img = cs.backgroundImage;
      if (img && img !== "none") {
        if (/url\(/.test(img)) return null;
        const stops = allColors(img); if (stops.length) layers.push({stops});
      }
      const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push({stops: [c]}); if (c.a >= 1 && !(img && img !== "none")) break; if (c.a >= 1) break; }
    }
    let cands = [{r: 255, g: 255, b: 255, a: 1}];
    for (const l of layers.reverse()) cands = l.stops.flatMap(st => cands.map(b => blend(st, b)));
    return cands.slice(0, 64);
  };
  const fails = []; let checked = 0, unknown = 0;
  for (const scope of [document.getElementById("topbar"), document.getElementById("nav"), document.getElementById("main")]) {
    if (!scope) continue;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const done = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement; if (!el || done.has(el) || !t.textContent.trim()) continue; done.add(el);
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || el.closest("[hidden],.sr-only,dialog:not([open])") || el.closest("button:disabled,[aria-disabled=true],input:disabled")) continue;
      const fg = parse(cs.color), bgs = bgOf(el);
      if (!fg || !bgs || !bgs.length) { unknown++; continue; }
      const op = parseFloat(cs.opacity);
      let ratio = Infinity, bg = bgs[0];
      for (const b of bgs) { const c = blend({...fg, a: fg.a * (isNaN(op) ? 1 : op)}, b), L1 = lum(c), L2 = lum(b), q = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); if (q < ratio) { ratio = q; bg = b; } }
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, large = size >= 24 || (bold && size >= 18.66);
      checked++;
      if (ratio < (large ? 3 : 4.5)) fails.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${t.textContent.trim().replace(/\s+/g, " ").slice(0, 28)}" ${ratio.toFixed(2)}:1 (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}), ${size}px${bold ? " bold" : ""}, need ${large ? 3 : 4.5})`);
    }
  }
  return {checked, unknown, fails};
});
export function evaluateA11y(k, c) {
  const res = {};
  res.keyboardReach = k.skipped.length ? {status: "FAIL", evidence: `${k.skipped.length} of ${k.expected} skipped by Tab: ${k.skipped.slice(0, 6).join("; ")}`, tabPath: k.path} : {status: "PASS", ...(k.beyond ? {note: `${k.beyond} element(s) after the ${TAB_LIMIT}-press limit not visited`} : {})};
  res.focusVisible = k.noFocusRing.length ? {status: "FAIL", evidence: `${k.noFocusRing.length} focused element(s) without a visible focus ring: ${k.noFocusRing.slice(0, 4).join("; ")}`} : {status: "PASS"};
  res.noFocusTrap = k.trap ? {status: "FAIL", evidence: `${k.trap}; last focus path: ${k.path.slice(-12).join(" > ")}`} : {status: "PASS"};
  res.contrastAA = c.fails.length ? {status: "FAIL", evidence: `${c.fails.length} of ${c.checked} text element(s) below AA: ${c.fails.slice(0, 5).join("; ")}`} : {status: "PASS", ...(c.unknown ? {note: `${c.unknown} over an image/gradient not measured`} : {})};
  return res;
}
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
  win = await app.firstWindow();
  await win.waitForSelector("main", {state: "attached", timeout: 30000});
  await win.evaluate(() => { localStorage.setItem("uasco.lang", "en"); }); await win.reload(); // tek başlangıç yüklemesi; dil değişimi sonra yalnız #langBtn ile
  await win.waitForSelector("main", {state: "attached", timeout: 30000}); await sleep(1500);
  if (await win.$("#firstRunDialog[open]")) { await win.keyboard.press("Escape"); await sleep(500); }
  // //TR: --selftest: kontrollerin gerçekten FAIL verebildiği kanıtlanır: main'e düşük kontrastlı metin, odak halkası olmayan bir düğme ve kendini geri odaklayan bir tuzak eklenir; dördü de FAIL olmalı; sonra kaldırılır ve sonuç report.json'a yazılır.
  let selftest = null;
  if (SELFTEST) {
    // CSP inline stil özniteliklerini ve eklenen <style> öğelerini engeller: stiller CSSOM ile (el.style.setProperty) verilir.
    const inject = withTrap => win.evaluate(trapOn => {
      document.getElementById("tour-selftest")?.remove();
      const m = document.getElementById("main"), box = document.createElement("div"), mk = (tag, id, text) => { const n = document.createElement(tag); if (id) n.id = id; n.textContent = text; if (tag === "button") n.type = "button"; box.append(n); return n; };
      box.id = "tour-selftest"; box.style.setProperty("background", "#ffffff", "important"); box.style.setProperty("background-image", "none", "important");
      const p = mk("p", "tour-st-low", "low contrast selftest text"); p.style.setProperty("color", "#bbbbbb", "important"); p.style.setProperty("font-size", "14px", "important");
      const ring = mk("button", "tour-st-ring", "no ring"); for (const k of ["outline", "box-shadow"]) ring.style.setProperty(k, "none", "important");
      const jump = mk("button", "tour-st-jump", "jumps over next"), skipped = mk("button", "tour-st-skipped", "skipped"), after = mk("button", "tour-st-after", "after");
      jump.addEventListener("keydown", e => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); after.focus(); } });
      if (trapOn) after.addEventListener("keydown", e => { if (e.key === "Tab") { e.preventDefault(); after.focus(); } });
      void skipped; m.prepend(box);
    }, withTrap);
    await visit(routes[0]);
    await inject(false);
    const c = await contrastScan(), k1 = await keyboardWalk(), a1 = evaluateA11y(k1, c);
    await inject(true);
    const k2 = await keyboardWalk(), a2 = evaluateA11y(k2, c);
    await win.evaluate(() => document.getElementById("tour-selftest")?.remove());
    selftest = {contrastAA: a1.contrastAA.status, focusVisible: a1.focusVisible.status, keyboardReach: a1.keyboardReach.status, noFocusTrap: a2.noFocusTrap.status,
      evidence: {contrast: a1.contrastAA.evidence, ring: a1.focusVisible.evidence, reach: a1.keyboardReach.evidence, trap: a2.noFocusTrap.evidence}};
    const ok = ["contrastAA", "focusVisible", "keyboardReach", "noFocusTrap"].every(x => selftest[x] === "FAIL") && /tour-st-low|low contrast/.test(selftest.evidence.contrast) && /tour-st-ring/.test(selftest.evidence.ring) && /skipped/.test(selftest.evidence.reach);
    console.log(`SELFTEST ${ok ? "PASS (all four injected defects detected)" : "FAIL (a check did not detect its injected defect)"} ${JSON.stringify(selftest).slice(0, 900)}`);
    if (!ok) { fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({selftest, result: "SELFTEST_FAIL"}, null, 2)); return 2; }
    await visit(routes[0]);
  }
  const results = [];
  for (const lang of LANGS) {
    await setLang(lang);
    for (const w of WIDTHS) {
      await setWidth(w);
      for (const route of routes) {
        await visit(route);
        let m, checks;
        try { m = await measure(); checks = evaluateChecks(m); const cs = await contrastScan(); const kw = await keyboardWalk(); Object.assign(checks, evaluateA11y(kw, cs)); } catch (e) { checks = Object.fromEntries(CHECKS.map(c => [c, {status: "FAIL", evidence: `measure failed: ${String(e?.message ?? e).slice(0, 200)}`}])); m = null; }
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
  const report = {platform: process.platform, node: process.version, scope: "Linux xvfb only; not Windows acceptance", seeded, selftest, routes, langs: LANGS, widths: WIDTHS, pages: results.length, byCheck, failures, results, result: failures.length ? "FAIL" : "PASS"};
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`RESULT ${report.result} pages=${results.length} failures=${failures.length} ${JSON.stringify(byCheck)} out=${outDir}`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try { code = await main(); } catch (e) { console.log(`FAIL startup: ${String(e?.message ?? e).slice(0, 500)} ${backendLog.slice(-300)}`); code = 1; }
  await cleanup();
  process.exit(code);
}
