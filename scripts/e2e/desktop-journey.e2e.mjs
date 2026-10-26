// //TR: Bu betik gerçek Electron masaüstü uygulamasını (Playwright _electron) geçici veri dizini ve FAKE yürütücü ile sürer: fikir -> intake (web-node) -> plan -> görev -> koşu -> teslim. Her adımda ekrandaki durum doğrulanır ve ekran görüntüsü alınır; GATED_4B adımlar dürüstçe "etkin değil" görünmelidir. Gerçek Claude ve ağ yoktur. Çıkış kodu: 0 = tüm planlı adımlar geçti (NOT_VERIFIED:GATED_4B olabilir), 1 = bir adım ya da başlatma başarısız, 3 = BLOCKED (yalnız HİÇBİR ŞEY başlatılmadan önce denetlenen ön koşul eksik: Playwright, Electron binary'si ya da ekran; PASS sayılmaz), 4 = --require-post-4b iken NOT_VERIFIED ya da NOT_EXECUTED (rotası bu masaüstü derlemesinde kayıtlı/izinli olmadığı için NEDENİYLE çalıştırılamayan) adım var. 20 planlı adım sabit paydadır; planlı ama hiç çalışmayan adım NOT_REACHED sayılır (sonuç FAIL:INCOMPLETE). Son adım (request-ledger) sunucunun istek günlüğünü TÜM yolculuk için sayar. Batch 4b öncesi/sonrası: gerçek main.mjs allow-list'i uygulama içinden yoklanır (detect-routes). Kullanım: node scripts/e2e/desktop-journey.e2e.mjs [--out <dizin>] [--require-post-4b] (Linux başsız ortam: xvfb-run -a node ...).
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..", "..");
const argv = process.argv.slice(2), outArg = argv.indexOf("--out"), requirePost4b = argv.includes("--require-post-4b");
const outDir = path.resolve(outArg >= 0 && argv[outArg + 1] ? argv[outArg + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "uasco-e2e-")));
const shotsDir = path.join(outDir, "screenshots");
fs.mkdirSync(shotsDir, {recursive: true});
// //TR: Veri dizini her zaman YENİ ve benzersizdir (--out altında mevcut bir "data" dizini asla silinmez).
const dataRoot = fs.mkdtempSync(path.join(outDir, "data-"));

// Planlı adımlar (sabit payda). kind: FUNCTIONAL = gerçek işlev sürülür; GATED_ASSERTED = 4b kapısına bağlı iddia (kapalıysa NOT_VERIFIED:GATED_4B); NOT_EXECUTED_ASSERTED = "çalıştırılmadı" durumunun dürüst gösterimi.
const PLAN = [["first-run-dialog", "FUNCTIONAL"], ["detect-routes", "FUNCTIONAL"], ["setup-check", "FUNCTIONAL"], ["intake-idea", "FUNCTIONAL"], ["analysis", "GATED_ASSERTED"], ["plan-gate-closed", "FUNCTIONAL"], ["analysis-stuck-shown", "GATED_ASSERTED"], ["reapprove-once", "GATED_ASSERTED"], ["plan-task-by-hand", "FUNCTIONAL"],
  ["authorize-mission", "FUNCTIONAL"], ["run-engine-truth", "FUNCTIONAL"], ["start-run", "FUNCTIONAL"], ["run-reaches-review", "FUNCTIONAL"], ["test-result-honest", "NOT_EXECUTED_ASSERTED"],
  ["link-run-to-task", "FUNCTIONAL"], ["open-project-workspace", "FUNCTIONAL"], ["delivery-prepare", "FUNCTIONAL"], ["delivery-accept", "FUNCTIONAL"], ["product", "GATED_ASSERTED"], ["request-ledger", "FUNCTIONAL"]];
const KIND = Object.fromEntries(PLAN);
const steps = [];
const mode = {analysis: "UNKNOWN", product: "UNKNOWN"}; // ADMITTED | GATED_4B (uygulamadaki gerçek allow-list'ten)
const meta = {playwright: null, electron: null, noSandbox: false};
let projectId = null, sandboxRow = null, serverSandbox = null, serverPv = null, startup = null, apiPort = null, apiToken = null; // startup: başlatma hatası PLAN dışıdır, ayrı raporlanır
let backend = null, app = null, win = null, backendLog = "", mainLog = "", cleanupP = null;
const tail = (s, n) => String(s).slice(-n);
const mainLogFile = path.join(outDir, "electron-main.log"); // -r scripts/e2e/main-log-hook.cjs: ana süreç çıktısı başlangıçtan itibaren
const mainOutput = n => { let f = ""; try { f = fs.readFileSync(mainLogFile, "utf8"); } catch { /* yok */ } return tail(f || mainLog, n); };
// //TR: Çapraz kontrol okumaları uygulamadan (köprü/main.mjs) BAĞIMSIZDIR: Node doğrudan 127.0.0.1 Control API'sine belirteçle gider.
async function serverPost(p, body) {
  let res;
  try { res = await fetch(`http://127.0.0.1:${apiPort}${p}`, {method: "POST", headers: {"x-uasco-control-token": apiToken, "content-type": "application/json"}, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(20000)}); } catch (e) { throw new Check(`direct server write ${p} failed: ${e?.message ?? e}`); }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Check(`direct server write ${p} answered ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
  return json;
}
// //TR: Sunucunun kendi istek günlüğü (yalnız bu test arka ucunda): hangi POST'ların GERÇEKTEN gittiği buradan sayılır, ekrandaki metinden değil.
const requestCount = async (method, re) => ((await serverGet("/__e2e/requests"))?.requests ?? []).filter(r => r.method === method && re.test(r.url)).length;
// //TR: detect-routes olmayan bir kimlikle yoklama yapar; sayım yalnız bu yolculuğun GERÇEK görevine bakar.
const expectCount = (what, got, want) => must(got === want, `expected exactly ${want} ${what}, got ${got}`); // sayı hatası gerçek sayıyı gösterir
const stepRe = id => new RegExp(`^/v1/missions/${id}/analysis/step$`), planRe = id => new RegExp(`^/v1/missions/${id}/analysis/plan$`);
const missionIdOf = async () => { const ms = (await serverGet(`/v1/missions?projectId=${projectId}`))?.missions ?? []; must(ms.length === 1, `expected one mission in the project, got ${ms.length}`); return ms[0].missionId; };
const predevArtifacts = async missionId => Object.entries((await serverGet(`/v1/predev/${missionId}`))?.predev?.artifacts ?? {}).map(([kind, a]) => ({kind, state: a.state, version: a.version, artifactId: a.artifactId}));
async function serverGet(p) {
  let res;
  try { res = await fetch(`http://127.0.0.1:${apiPort}${p}`, {headers: {"x-uasco-control-token": apiToken}, signal: AbortSignal.timeout(10000)}); } catch (e) { throw new Check(`direct server read ${p} failed: ${e?.message ?? e}`); }
  if (!res.ok) throw new Check(`direct server read ${p} answered ${res.status}`);
  return res.json();
}
const report = (extra = {}) => {
  const done = new Set(steps.map(s => s.name));
  const notReached = PLAN.filter(([n]) => !done.has(n)).map(([name, kind]) => ({name, kind, status: "NOT_REACHED"})); // planlı ama HİÇ çalışmadı (önceki adım düştü)
  const all = [...steps, ...notReached];
  const failed = steps.some(s => s.status === "FAIL") || startup !== null;
  const counts = {PASS: all.filter(x => x.status === "PASS").length, NOT_VERIFIED: all.filter(x => x.status === "NOT_VERIFIED").length, FAIL: all.filter(x => x.status === "FAIL").length, NOT_EXECUTED: all.filter(x => x.status === "NOT_EXECUTED").length, NOT_REACHED: notReached.length, planned: PLAN.length}; // NOT_EXECUTED = nedeniyle çalıştırılamayan adım (rota kayıtlı değil); NOT_REACHED = hiç çalışmayan; tablo ve sayılar aynı durum adlarını kullanır
  const result = extra.blocked ? `BLOCKED:${extra.blocked}` : failed ? "FAIL" : notReached.length === PLAN.length ? "NOT_RUN" : notReached.length ? "FAIL:INCOMPLETE" : counts.NOT_VERIFIED || counts.NOT_EXECUTED ? (requirePost4b ? "FAIL:NOT_VERIFIED_WITH_REQUIRE_POST_4B" : "PASS_WITH_NOT_VERIFIED") : "PASS";
  const r = {platform: process.platform, node: process.version, outDir, ...meta, mode, counts, steps: all, startup, result, ...extra};
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(r, null, 2));
  return r;
};
// BLOCKED yalnız hiçbir şey başlatılmadan önce denetlenen ön koşullar için kullanılır.
const blocked = (code, detail) => { console.log(`BLOCKED:${code} ${detail ?? ""}`.trim()); report({blocked: code, detail: String(detail ?? "")}); fs.rmSync(dataRoot, {recursive: true, force: true}); process.exit(3); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => (cleanupP ??= doCleanup()); // aynı süren temizlik her çağıranca beklenir (finish() ve sinyal birlikte)
async function doCleanup() {
  try { if (app) { const proc = app.process(); await Promise.race([app.close(), sleep(15000).then(() => { throw new Error("close timeout"); })]).catch(() => { try { proc.kill("SIGKILL"); } catch { /* yoksay */ } }); } } catch { /* kapanışta hata yutulur */ }
  try {
    if (backend && backend.exitCode === null && backend.signalCode === null) {
      const exited = new Promise(r => backend.once("exit", r)); backend.kill("SIGTERM");
      await Promise.race([exited, sleep(5000)]);
      if (backend.exitCode === null && backend.signalCode === null) { backend.kill("SIGKILL"); await Promise.race([exited, sleep(2000)]); }
    }
  } catch { /* yoksay */ }
  try { fs.rmSync(dataRoot, {recursive: true, force: true}); } catch { /* yoksay */ }
}
// //TR: Sinyal gelirse çıkış kodu her koşulda 130/143 olur (koşan adımın hatası yarışmaz); temizlik tamamlanmadan çıkılmaz.
let sigExit = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { sigExit = sig === "SIGINT" ? 130 : 143; try { if (backend && backend.exitCode === null) backend.kill("SIGTERM"); } catch { /* yoksay */ } cleanup().finally(() => process.exit(sigExit)); }); // arka uç ÖNCE durdurulur, sonra uygulama beklenir
// //TR: Her çıkış yolunda (hata, process.exit) arka uç hâlâ yaşıyorsa SIGKILL ve veri dizini senkron silinir: geride süreç ya da dizin kalmaz.
process.on("exit", () => { try { if (backend && backend.exitCode === null && backend.signalCode === null) backend.kill("SIGKILL"); } catch { /* yoksay */ } try { fs.rmSync(dataRoot, {recursive: true, force: true}); } catch { /* yoksay */ } });

// ---- ortam: Playwright (yeni bağımlılık eklenmez; ön kurulu playwright ya da playwright-core) ----
function loadPlaywright() {
  const req = createRequire(import.meta.url), explicit = process.env.PLAYWRIGHT_MODULE_DIR;
  // PLAYWRIGHT_MODULE_DIR verilmişse YALNIZ oradan yüklenir; /opt yedeği yalnız Linux'ta ve dizin verilmemişken.
  const roots = explicit ? [explicit] : [undefined, ...(process.platform === "linux" ? ["/opt/node-tools/node_modules"] : [])];
  for (const root of roots) for (const name of ["playwright", "playwright-core"]) {
    try {
      const file = root ? path.join(root, name) : name, m = req(file);
      if (m && m._electron) { let version = null; try { version = req(`${file}/package.json`).version; } catch { /* yok */ } meta.playwright = {name, version, path: root ? file : req.resolve(name)}; return m; }
    } catch { /* sıradaki */ }
  }
  return null;
}
// //TR: Repo'nun kendi Electron'u: önce mühürlü provision (scripts/provision-electron.mjs çıktısı, checksum doğrulamalı). Yedek: node_modules/electron/path.txt'in gösterdiği binary (require("electron") ÇALIŞTIRILMAZ: index.js eksik binary'yi mühür dışında indirebilir). CI'da (CI=true) yalnız provision kabul edilir. Hata ayrıntısı BLOCKED metnine girer.
async function electronBinary() {
  let provisionError = null;
  try {
    const m = await import(pathToFileURL(path.join(repo, "automation", "lib", "electron-provision.mjs")).href);
    const exe = await m.verifyProvisionedElectron(repo);
    const p = typeof exe === "string" ? exe : exe?.exePath ?? exe?.exe;
    if (typeof p === "string" && fs.existsSync(p)) return {path: p, source: "provisioned", provisionError: null};
    provisionError = "provisioned path missing";
  } catch (e) { provisionError = String(e?.message ?? e).split("\n")[0]; }
  if (process.env.CI) return {error: `CI requires the provisioned Electron (scripts/provision-electron.mjs): ${provisionError}`};
  try {
    const pkgDir = path.join(repo, "node_modules", "electron"), rel = fs.readFileSync(path.join(pkgDir, "path.txt"), "utf8").trim();
    const p = path.join(pkgDir, "dist", rel);
    if (rel && fs.existsSync(p)) return {path: p, source: "node_modules/electron", provisionError};
  } catch { /* yok */ }
  return {error: `no Electron binary (provision error: ${provisionError}); run scripts/provision-electron.mjs`};
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on("error", rej); s.listen({host: "127.0.0.1", port: 0}, () => { const p = s.address().port; s.close(() => res(p)); }); });
// Alt süreçlere yalnız gereken ortam geçer (GIT_*, *_TOKEN, proxy, NODE_OPTIONS vb. geçmez).
const ENV_ALLOW = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "LANG", "LC_ALL", "ComSpec", "PATHEXT", "windir"];
const childEnv = extra => ({...Object.fromEntries(ENV_ALLOW.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])), ...extra});

// ---- adım kaydı ----
const mainText = async () => (await win.evaluate(() => document.querySelector("main")?.innerText ?? "")).replace(/\s+/g, " ");
const shot = async name => { const f = `${String(steps.length + 1).padStart(2, "0")}-${name}.png`; try { await win.screenshot({path: path.join(shotsDir, f), timeout: 10000}); return f; } catch { return null; } };
class Check extends Error {}
const must = (cond, msg) => { if (!cond) throw new Check(msg); };
async function step(name, fn) {
  const t0 = Date.now(), kind = KIND[name];
  try {
    const out = await fn(), nv = out && typeof out === "object" ? out : null, detail = nv ? nv.detail : out, status = nv?.notExecuted ? "NOT_EXECUTED" : nv?.notVerified ? "NOT_VERIFIED" : "PASS", why = nv?.notExecuted ?? nv?.notVerified ?? null; // notExecuted: ADIM çalıştırılamadı (rota kayıtlı değil), nedeniyle raporlanır, asla PASS değil
    steps.push({name, kind, status, ...(why ? {reason: why} : {}), ms: Date.now() - t0, detail: detail ?? null, screenshot: await shot(name)});
    console.log(`${status}${why ? `:${why}` : ""} ${name} [${kind}]${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const screen = await Promise.race([mainText(), sleep(5000).then(() => "")]).catch(() => "").then(t => t.slice(0, 1200));
    steps.push({name, kind, status: "FAIL", ms: Date.now() - t0, detail: String(e?.message ?? e).slice(0, 600), screenText: screen, screenshot: await shot(`${name}-FAIL`)});
    console.log(`FAIL ${name} [${kind}] — ${String(e?.message ?? e).slice(0, 300)}`);
    throw e;
  }
}
const waitText = (re, timeout = 15000, what = String(re), scope = "main") => win.waitForFunction(([src, sel]) => { const n = document.querySelector(sel); return !!n && new RegExp(src, "i").test((n.innerText ?? "").replace(/\s+/g, " ")); }, [re.source, scope], {timeout}).catch(() => { throw new Check(`text not shown in time: ${what}`); });
const waitSel = (sel, timeout = 15000) => win.waitForSelector(sel, {timeout, state: "attached"}).catch(() => { throw new Check(`element not found: ${sel}`); });
const waitFn = (fn, arg, timeout, what) => win.waitForFunction(fn, arg, {timeout}).catch(() => { throw new Check(`not reached in time: ${what}`); });
const go = async hash => { await win.evaluate(h => { location.hash = h; }, hash); await win.waitForSelector("main", {state: "attached", timeout: 15000}); await win.waitForTimeout(800); };
// Onay penceresi: açık <dialog> (#confirmDialog[open]) beklenir, sonra onaylanır; pencere kapanana kadar beklenir.
async function confirmDialog(what, required = true) {
  const opened = await win.waitForSelector("#confirmDialog[open]", {timeout: required ? 10000 : 3000, state: "attached"}).then(() => true).catch(() => false);
  if (!opened) { if (required) throw new Check(`confirm dialog did not open: ${what}`); return false; }
  await win.click("#confirmOk"); await waitFn(() => !document.querySelector("#confirmDialog[open]"), null, 10000, `confirm dialog closed: ${what}`);
  return true;
}

async function main() {
  const pw = loadPlaywright();
  if (!pw) return blocked("PLAYWRIGHT_MISSING", "no playwright/playwright-core with _electron found (set PLAYWRIGHT_MODULE_DIR)");
  const exe = await electronBinary();
  if (exe.error) return blocked("ELECTRON_BINARY_MISSING", exe.error);
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return blocked("NO_DISPLAY", "no display; run under xvfb-run -a");
  let electronVersion = null; try { electronVersion = fs.readFileSync(path.join(path.dirname(exe.path), "version"), "utf8").trim() || null; } catch { /* sürüm dosyası yok */ }
  meta.electron = {source: exe.source, path: exe.path, version: electronVersion, provisionError: exe.provisionError ?? null};
  // Buradan sonra hiçbir hata BLOCKED sayılmaz: başlatma hataları FAIL (çıkış 1) olarak adımlara ve günlüğe yazılır.
  const startupFail = async detail => {
    const clean = String(detail).replace(/\u001b\[[0-9;]*m/g, ""), errs = clean.split("\n").filter(l => /\[err\]/.test(l) && !/dbus|Debugger|For help/.test(l)).map(l => l.replace(/^\s*-\s*/, "").trim()).slice(-6);
    startup = {status: "FAIL", detail: tail(clean, 1500), electronErrLines: errs, backendLog: tail(backendLog, 1500), electronLog: mainOutput(1500)};
    console.log(`FAIL startup (outside the ${PLAN.length} planned steps) — ${clean.split("\n")[0].slice(0, 200)}${errs.length ? ` | electron: ${errs.join(" / ").slice(0, 400)}` : ""}`);
  };
  try {
    const port = await freePort(), token = crypto.randomBytes(24).toString("hex"); apiPort = port; apiToken = token;
    const env = childEnv({CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token, E2E_DATA_ROOT: dataRoot});
    backend = spawn(process.execPath, ["--import", "tsx", path.join("scripts", "e2e", "fake-backend.ts")], {cwd: repo, env, stdio: ["ignore", "pipe", "pipe"]});
    backend.stdout.on("data", d => { backendLog += d; }); backend.stderr.on("data", d => { backendLog += d; });
    console.log(`ENV platform=${process.platform} node=${process.version} electron=${exe.source} playwright=${meta.playwright.name}@${meta.playwright.version}`);
    const t0 = Date.now(); let ready = false;
    while (Date.now() - t0 < 60000) { if (backendLog.includes("E2E_BACKEND_READY")) { ready = true; break; } if (backend.exitCode !== null) break; await sleep(200); }
    if (!ready) { await startupFail(`fake backend did not become ready (exit=${backend.exitCode}): ${backendLog.slice(-600)}`); return finish(); }
    meta.noSandbox = process.platform === "linux" && (process.getuid?.() === 0 || process.env.E2E_NO_SANDBOX === "1");
    const args = ["-r", path.join(here, "main-log-hook.cjs"), path.join("apps", "desktop", "main.mjs"), `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`, ...(meta.noSandbox ? ["--no-sandbox"] : []), ...(process.platform === "linux" ? ["--disable-gpu"] : [])];
    fs.writeFileSync(mainLogFile, ""); // eski bir koşunun başlatma günlüğü (aynı --out) bu koşunun raporuna karışmasın
    app = await pw._electron.launch({executablePath: exe.path, args, cwd: repo, env: childEnv({CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token, E2E_MAIN_LOG: mainLogFile}), timeout: 60000});
    for (const st of [app.process().stdout, app.process().stderr]) st?.on("data", d => { mainLog = tail(mainLog + d, 4000); }); // Electron ana süreç çıktısı (başlatma hatasında rapora girer)
    win = await app.firstWindow();
    await win.waitForSelector("main", {state: "attached", timeout: 30000}); // gerçek belge yüklenmeden evaluate çağrılmaz
    await win.evaluate(() => { localStorage.setItem("uasco.lang", "en"); }); await win.reload();
    await win.waitForSelector("main", {state: "attached", timeout: 30000}); await win.waitForTimeout(1500);
  } catch (e) { await startupFail(`${e?.message ?? e}\nelectron main-process output tail: ${mainOutput(800) || "(none)"}\nbackend log tail: ${tail(backendLog, 600)}`); return finish(); }
  try { await runSteps(); } catch { /* adım kaydı zaten yazıldı */ }
  return finish();
}
async function finish() {
  const r = report();
  await cleanup();
  const c = r.counts;
  console.log(`RESULT ${r.result} (PASS ${c.PASS} / NOT_VERIFIED ${c.NOT_VERIFIED} / FAIL ${c.FAIL} / NOT_EXECUTED ${c.NOT_EXECUTED} / NOT_REACHED ${c.NOT_REACHED} of ${c.planned} planned; mode analysis=${mode.analysis} product=${mode.product}) out=${outDir}`);
  process.exit(sigExit ?? (r.result === "PASS" || r.result === "PASS_WITH_NOT_VERIFIED" ? 0 : r.result.startsWith("FAIL:NOT_VERIFIED") ? 4 : 1));
}

async function runSteps() {
  await step("first-run-dialog", async () => {
    await waitSel("#firstRunDialog");
    await win.keyboard.press("Escape"); await waitFn(() => !document.getElementById("firstRunDialog"), null, 5000, "first-run dialog closed");
    return "wizard shown on first start and skipped (Esc)";
  });
  await step("detect-routes", async () => {
    // Uygulamadaki GERÇEK allow-list'i yokla (köprü): admit edilmeyen yol INVALID_API_PATH ile reddedilir; admit edilen yol sunucuya gider (olmayan kimlik => 404, hiçbir şey değişmez).
    const probe = (kind, p, body) => win.evaluate(async ([kind, p, body]) => { try { if (kind === "GET") await window.uasco.apiGet(p); else await window.uasco.apiPost(p, body); return "ADMITTED"; } catch (e) { return /INVALID_API_PATH/.test(String(e?.message ?? e)) ? "GATED_4B" : "ADMITTED"; } }, [kind, p, body]);
    mode.product = await probe("GET", `/v1/work-runs/run_${"0".repeat(24)}/product`);
    mode.analysis = await probe("POST", `/v1/missions/msn_${"0".repeat(24)}/analysis/step`, {});
    return `analysis=${mode.analysis} product=${mode.product}`;
  });
  await step("setup-check", async () => {
    await go("#/settings"); await waitSel("[data-setup-row]");
    const rows = await win.evaluate(() => [...document.querySelectorAll("[data-setup-row]")].map(n => `${n.dataset.setupRow}=${n.dataset.setupState}`));
    const ids = rows.map(r => r.split("=")[0]);
    must(["CLI", "EXECUTOR", "IMPLEMENTER", "REVIEWER", "SANDBOX", "PRODUCT"].every(x => ids.includes(x)), `setup rows incomplete: ${rows.join(",")}`);
    must(rows.every(r => /=(PASS|BLOCKED|UNKNOWN)$/.test(r)), `setup row with an invented state: ${rows.join(",")}`);
    sandboxRow = (rows.find(r => r.startsWith("SANDBOX=")) ?? "").split("=")[1] ?? null;
    // SANDBOX satırı sunucunun kendi okumasıyla çapraz kontrol edilir (ekrandaki satır tek başına kanıt değildir).
    const ex = {sb: (await serverGet("/v1/system/executors"))?.sandbox ?? null};
    serverSandbox = ex.sb && typeof ex.sb.state === "string" ? ex.sb.state : null;
    const want = serverSandbox === null ? "UNKNOWN" : serverSandbox === "AVAILABLE" ? "PASS" : "BLOCKED";
    must(sandboxRow === want, `setup row SANDBOX=${sandboxRow} disagrees with the server's sandbox state ${serverSandbox} (expected ${want})`);
    return `${rows.join(" ")} (server sandbox=${serverSandbox})`;
  });
  await step("intake-idea", async () => {
    await go("#/projects"); await waitSel("#intake-t"); await win.click("#intake-t");
    await waitSel("#intake-template");
    must((await win.evaluate(() => document.querySelector("#intake-template").value)) === "web-node", "template select is not defaulted to web-node");
    await win.fill("#intake-idea", "A book club app: members suggest books and vote");
    await win.click("#intake-submit"); await waitSel("#intake-result");
    await waitText(/Created from your idea/, 20000, "intake result");
    const t = await mainText();
    must(/web-node/i.test(t), "intake result does not show the web-node template");
    must(/no task was planned and no run started/i.test(t), "intake result does not say that nothing was planned or run");
    projectId = (t.match(/prj_[0-9a-f]{24}/) ?? [null])[0];
    must(projectId, "intake result does not show the project id");
    return (await win.evaluate(() => document.querySelector("#intake-result")?.dataset.intakeId)) ?? "intake created";
  });
  await step("analysis", async () => {
    await win.click("#intake-open-mission"); await win.waitForTimeout(800);
    await go("#/journey"); await waitSel("#analysis-step-submit", 20000);
    // Yalnız GÖRÜNTÜLEMEK ücretli çağrı başlatmaz: Yolculuk çizildi, henüz hiçbir analiz adımı istenmedi.
    const jm = await missionIdOf();
    expectCount("analysis step requests merely by viewing the Journey (a paid call would have started)", await requestCount("POST", stepRe(jm)), 0);
    await win.click("#analysis-step-submit");
    const noResult = () => win.evaluate(() => !document.querySelector("#analysis-step [data-analysis-status='DRAFT_READY'], #analysis-step [data-analysis-status='AWAITING_APPROVAL'], #analysis-step [data-analysis-status='COMPLETE'], #analysis-step [data-analysis-plan='CREATED']"));
    if (mode.analysis === "GATED_4B") {
      await waitText(/not enabled/, 15000, "analysis step 'not enabled'", "#analysis-step");
      must(await noResult(), "analysis claims a result although the step is not admitted");
      return {notVerified: "GATED_4B", detail: "honest 'not enabled' shown in the analysis block; the post-4b assertion (server BLOCKED readiness) was NOT run"};
    }
    // 4b sonrası: sunucunun kesin BLOCKED hazırlığı (FAKE kurulum => analiz oluşturucusu / CLI hazır değil); asla taslak ya da tamam gösterilmez.
    await waitFn(() => [...document.querySelectorAll("#analysis-step [data-analysis-status]")].some(n => n.dataset.analysisStatus !== "NONE"), null, 30000, "analysis answer (status stayed NONE)");
    const st = await win.evaluate(() => [...document.querySelectorAll("#analysis-step [data-analysis-status]")].map(n => n.dataset.analysisStatus).find(x => x !== "NONE"));
    must(st === "BLOCKED", `analysis shows ${st} instead of the server's BLOCKED readiness`);
    must(await noResult(), "analysis shows a draft/complete result while the executor is FAKE");
    const blockers = await win.evaluate(() => [...document.querySelectorAll("#analysis-step [data-analysis-blocker]")].map(n => n.dataset.analysisBlocker));
    must(blockers.length > 0, "BLOCKED shows no blocker code");
    must(blockers.every(b => /^([a-z]+:)?[A-Z][A-Z0-9_]*(:.+)?$/.test(b)), `blocker code not in the server's shape: ${blockers.join(",")}`);
    must(!(await win.evaluate(() => !!document.querySelector("#analysis-plan-submit"))), "'Create plan' is offered although the analysis is not COMPLETE");
    // Ücretli çağrı BAŞLAMADI: yalnız tıklanan tek istek gitti ve ön-geliştirme kaydında hiçbir artefakt üretilmedi (sunucunun kendi okuması).
    expectCount("analysis step request after the one click", await requestCount("POST", stepRe(await missionIdOf())), 1);
    const pre = await predevArtifacts(await missionIdOf());
    must(pre.every(a => a.state === "NOT_STARTED"), `an artefact exists after a BLOCKED step (a paid call started?): ${JSON.stringify(pre)}`);
    return `server BLOCKED: ${blockers.join(" | ")}`;
  });
  await step("plan-gate-closed", async () => {
    await waitSel("#analysis-step", 10000);
    must(await win.evaluate(() => !!document.querySelector('#analysis-step [data-analysis-plan-gate="CLOSED"]')), "the Create plan gate is not shown as CLOSED");
    must(await win.evaluate(() => !document.querySelector("#analysis-plan-submit")), "Create plan is offered although the analysis is not COMPLETE");
    must(await win.evaluate(() => !document.querySelector("#analysis-step [data-analysis-status='COMPLETE']")), "the analysis block claims COMPLETE");
    expectCount("plan requests before COMPLETE", await requestCount("POST", planRe(await missionIdOf())), 0);
    return mode.analysis === "GATED_4B" ? "the DOM gate is the PASS basis (no button, gate CLOSED, status not COMPLETE); 'no plan request' is NOT evidence here: the route is not admitted, so the desktop could not send one anyway" : "Create plan stays gated (no button, gate CLOSED, no plan request reached the server) until the analysis is COMPLETE";
  });
  let seeded = null, stuckMission = null, stepsAfterStuck = null;
  await step("analysis-stuck-shown", async () => {
    if (mode.analysis === "GATED_4B") return {notExecuted: "GATED_4B", detail: "the analysis route is not admitted by this desktop build; the stuck-artefact assertions were NOT run"};
    stuckMission = await missionIdOf();
    // Tohum: onay yazılmış ama faz ilerlememiş (kesintiye uğramış onay); sunucunun GERÇEK rotası bunu ANALYSIS_PHASE_NOT_ADVANCED + kind/artifactId ile yanıtlar.
    seeded = await serverPost("/__e2e/seed-stuck-artefact", {missionId: stuckMission});
    must(seeded.kind === "BusinessAnalysis" && /^pda_[0-9a-f]{24}$/.test(seeded.artifactId), `unexpected seed: ${JSON.stringify(seeded)}`);
    const before = JSON.stringify(await predevArtifacts(stuckMission)), stepsBefore = await requestCount("POST", stepRe(stuckMission));
    await win.click("#analysis-step-submit");
    await waitSel("#analysis-step [data-analysis-stuck]", 20000);
    const box = await win.evaluate(() => { const n = document.querySelector("#analysis-step [data-analysis-stuck]"); return n ? {stuck: n.dataset.analysisStuck, artifact: n.dataset.artifact} : null; });
    must(box && box.stuck === seeded.kind && box.artifact === seeded.artifactId, `the stuck block names ${JSON.stringify(box)} instead of the server's ${seeded.kind}/${seeded.artifactId}`);
    const blockers = await win.evaluate(() => [...document.querySelectorAll("#analysis-step [data-analysis-blocker]")].map(n => n.dataset.analysisBlocker));
    must(blockers.length === 1 && blockers[0] === "ANALYSIS_PHASE_NOT_ADVANCED", `blockers: ${blockers.join(",")}`);
    must(await win.evaluate(() => !document.querySelector("#analysis-step [data-analysis-status='BUILDER_FAILED'], #analysis-step [data-analysis-status='REJECTED']")), "the stuck artefact is shown as a failure");
    must(await win.evaluate(() => !!document.querySelector("#analysis-reapprove-submit") && !!document.querySelector("#analysis-reapprove-evidence")), "no Re-approve button / evidence field");
    stepsAfterStuck = await requestCount("POST", stepRe(stuckMission));
    expectCount("analysis step request for the stuck answer (the one click)", stepsAfterStuck - stepsBefore, 1);
    must(JSON.stringify(await predevArtifacts(stuckMission)) === before, "the pre-development record changed while only showing the stuck artefact (a paid call started?)");
    expectCount("approvals before the Founder presses Re-approve", await requestCount("POST", /\/predev\/artifacts\/[^/]+\/approve$/), 0);
    return `${box.stuck} ${box.artifact} shown as a Founder action; no paid call, no approval posted`;
  });
  await step("reapprove-once", async () => {
    if (mode.analysis === "GATED_4B") return {notExecuted: "GATED_4B", detail: "depends on the analysis route (not admitted); the Re-approve assertions were NOT run"};
    const approve = /\/predev\/artifacts\/([^/]+)\/approve$/;
    await win.click("#analysis-reapprove-submit"); // no evidence typed: nothing may be posted
    await waitSel("#analysis-reapprove-status[data-result='invalid']", 10000);
    expectCount("approve requests without Founder-typed evidence", await requestCount("POST", approve), 0);
    await win.fill("#analysis-reapprove-evidence", "e2e-evidence-1");
    await win.click("#analysis-reapprove-submit", {clickCount: 2}); // a double click must still post exactly once
    await waitSel("#analysis-reapprove-status[data-result='ok']", 20000);
    const posted = ((await serverGet("/__e2e/requests"))?.requests ?? []).filter(r => r.method === "POST" && approve.test(r.url));
    expectCount("Re-approve request (a double click must post once)", posted.length, 1);
    must(posted[0].url === `/v1/missions/${stuckMission}/predev/artifacts/${seeded.artifactId}/approve` && posted[0].status >= 200 && posted[0].status < 300, `approve request: ${JSON.stringify(posted[0])}`);
    must(await win.evaluate(() => !document.querySelector("#analysis-step [data-analysis-stuck]")), "the stuck block is still shown after a successful Re-approve");
    const phase = (await serverGet(`/v1/predev/${stuckMission}`))?.predev?.phase;
    must(phase && phase !== seeded.phase, `the server's phase did not advance (still ${phase})`);
    expectCount("analysis step requests after Re-approve (it must not start one)", await requestCount("POST", stepRe(stuckMission)), stepsAfterStuck);
    return `approve posted once (${posted[0].status}); phase ${seeded.phase} -> ${phase}; no analysis step was started`;
  });
  await step("plan-task-by-hand", async () => {
    await go("#/work"); await waitSel("#plan-title-0", 20000);
    await win.fill("#plan-title-0", "Add the book list page");
    await win.click("#plan-submit");
    await waitText(/Add the book list page/, 20000, "planned task in the mission");
    return "one task planned by hand (analysis is blocked or not enabled)";
  });
  await step("authorize-mission", async () => {
    // Zaman çizelgesindeki ölçülebilir durum beklenir (sr-only metni değil): önce PREFLIGHT, onay penceresinden sonra AUTHORIZED "current".
    const cur = s => `ol.status-timeline li[data-step="${s}"][data-state="current"]`;
    await waitSel("#tr-PREFLIGHT", 20000); await win.click("#tr-PREFLIGHT"); await waitSel(cur("PREFLIGHT"), 20000);
    await waitSel("#tr-AUTHORIZED", 20000); await win.click("#tr-AUTHORIZED"); await confirmDialog("authorize mission");
    await waitSel(cur("AUTHORIZED"), 20000);
    // Ekran değil sunucu: görev zamanı sonrasında görev kaydı GERÇEKTEN AUTHORIZED olmalı.
    const ms = (await serverGet(`/v1/missions?projectId=${projectId}`))?.missions ?? [];
    must(ms.length === 1, `expected one mission in the project, got ${ms.length}`);
    const m = {status: (await serverGet(`/v1/missions/${ms[0].missionId}`))?.mission?.status ?? null};
    must(m.status === "AUTHORIZED", `the server's mission status is ${m.status}, not AUTHORIZED`);
    return `Draft -> Preflight -> Authorized (confirmed; timeline current; server status ${m.status})`;
  });
  await step("run-engine-truth", async () => {
    await waitSel("#run-start:not([disabled])", 20000); await waitSel("[data-engine-head]", 20000);
    const head = await win.evaluate(() => document.querySelector("[data-engine-head]")?.dataset.engineHead ?? null);
    const active = await win.evaluate(() => document.querySelector("[data-engine-active]")?.dataset.engineActive ?? null);
    must(head !== null, "run engine block is not shown before Start run");
    must(["READY", "BLOCKED", "UNKNOWN"].includes(head), `run engine block shows an invented state: ${head}`);
    return `engine=${head} active=${active}`;
  });
  let runId = null, plannedTaskId = null;
  await step("start-run", async () => {
    await waitSel("#run-start:not([disabled])", 20000);
    await win.click("#run-start"); await confirmDialog("start run", false);
    await waitSel("[data-run-status]", 30000);
    runId = await win.evaluate(() => document.querySelector("[data-run-status]").dataset.runId);
    must(/^run_[0-9a-f]{24}$/.test(runId ?? ""), `unexpected run id: ${runId}`);
    return runId;
  });
  await step("run-reaches-review", async () => {
    await waitFn(() => { const n = document.querySelector("[data-run-status]"); return n && ["AWAITING_APPROVAL", "FAILED", "BLOCKED", "SUCCEEDED", "CANCELLED"].includes(n.dataset.runStatus); }, null, 120000, "run settled in 120 s");
    const st = await win.evaluate(() => document.querySelector("[data-run-status]").dataset.runStatus);
    must(st === "AWAITING_APPROVAL", `run ended as ${st} instead of AWAITING_APPROVAL (FAKE executor + CLEAN review)`);
    return `status=${st}`;
  });
  await step("test-result-honest", async () => {
    await waitSel("[data-run-test-result]", 20000);
    const r = await win.evaluate(() => { const n = document.querySelector("[data-run-test-result]"); return {kind: n.dataset.runTestResult, reason: n.dataset.runTestReason, text: n.textContent}; });
    // Beklenti SUNUCUDAN türetilir (köprü GET /v1/work-runs/:id); ekrandaki setup satırı ya da test satırı tek başına kanıt değildir. Her zaman okunur.
    const wr = await serverGet(`/v1/work-runs/${runId}`), srv = {pv: wr?.delivery?.productVerification ?? null, te: wr?.delivery?.testsExecuted ?? null};
    const {pv, te} = srv;
    must(pv && typeof pv.state === "string" && typeof pv.reason === "string" && typeof te === "boolean", `server delivery view has no usable productVerification/testsExecuted: ${JSON.stringify(srv)}`);
    if (serverSandbox !== "AVAILABLE") must(te === false && pv.state === "NOT_VERIFIED" && pv.reason === "NOT_EXECUTED:SANDBOX_UNAVAILABLE", `without a verified sandbox (sandbox=${serverSandbox}) the server must say NOT_VERIFIED/NOT_EXECUTED:SANDBOX_UNAVAILABLE with testsExecuted=false, got ${pv.state}/${pv.reason}/testsExecuted=${te}`);
    serverPv = pv;
    let exp;
    if (pv.state === "PRODUCT_VERIFIED") { must(te === true, "server says PRODUCT_VERIFIED but testsExecuted is not true"); exp = {kind: "EXECUTED_VERIFIED", reason: pv.reason}; }
    else if (pv.state === "FAILED") { must(te === true, "server says FAILED but testsExecuted is not true"); exp = {kind: "FAILED", reason: pv.reason}; }
    else if (pv.state === "NOT_VERIFIED") {
      const n = pv.reason.startsWith("NOT_EXECUTED:");
      must(n || te === true, `server says testsExecuted=false but the reason is not NOT_EXECUTED:*: ${pv.reason}`);
      exp = n ? {kind: te ? "NOT_VERIFIED" : "NOT_EXECUTED", reason: pv.reason.slice("NOT_EXECUTED:".length)} : {kind: "NOT_VERIFIED", reason: pv.reason};
    } else throw new Check(`server productVerification state ${pv.state} is not one the journey knows`);
    must(r.kind === exp.kind && r.reason === exp.reason, `the test row shows ${r.kind}:${r.reason} but the server says ${exp.kind}:${exp.reason} (productVerification ${pv.state}/${pv.reason}, testsExecuted=${te})`);
    if (r.kind !== "EXECUTED_VERIFIED") must(!/\bpassed\b/i.test(r.text), "a result that is not verified says 'passed'");
    return `${r.kind}${r.reason ? ":" + r.reason : ""} (server: ${pv.state}/${pv.reason}, testsExecuted=${te})`;
  });
  await step("link-run-to-task", async () => {
    const panel = `[data-run-linked-for="${runId}"]`;
    await waitSel("#run-link input[type=checkbox]", 20000);
    plannedTaskId = await win.evaluate(() => (document.querySelector("#run-link")?.innerText.match(/tsk_[0-9a-f]{24}/) ?? [null])[0]);
    must(plannedTaskId, "run-link panel does not show the planned task id");
    // Önceki durum: bu koşu henüz hiçbir göreve bağlı değildir (dürüst "bağlı görev yok").
    await waitSel(panel, 20000);
    must(await win.evaluate(sel => !document.querySelector(`${sel} [data-run-linked-task]`), panel), "the run is already linked to a task before the link was made");
    await win.locator("#run-link input[type=checkbox]").first().check();
    await win.click("#runlink-submit");
    await waitSel(`${panel} [data-run-linked-task="${plannedTaskId}"]`, 20000);
    must(await win.evaluate(sel => !document.querySelector(`${sel} [data-run-linked="none"], ${sel} [data-run-linked="unavailable"], ${sel} [data-run-linked="error"]`), panel), "the run card still reports no/unavailable/error links after linking");
    return `task ${plannedTaskId} linked to the run (POST /v1/tasks/:id/runs)`;
  });
  await step("open-project-workspace", async () => {
    await go("#/projects"); await win.getByRole("button", {name: "Open workspace"}).first().click();
    await waitSel("#studio-tab-delivery", 20000);
    return "project workspace opened";
  });
  await step("delivery-prepare", async () => {
    await win.click("#studio-tab-delivery"); await waitSel(`[data-delivery-run="${runId}"]`, 20000);
    must((await win.evaluate(id => document.querySelector(`[data-delivery-run="${id}"]`).dataset.deliveryState, runId)) === "NOT_PREPARED", "delivery is not NOT_PREPARED before preparing");
    // Teslim kartındaki ürün ekseni, sunucunun (doğrudan okunan) koşu kaydındaki productVerification ile aynı olmalı.
    const card = await win.evaluate(id => { const n = document.querySelector(`[data-delivery-run="${id}"] [data-axis="productVerification"]`); return n ? {state: n.dataset.axisState, reason: n.dataset.axisReason} : null; }, runId);
    must(card && card.state === serverPv?.state && card.reason === serverPv?.reason, `the delivery card shows productVerification ${card?.state}/${card?.reason} but the server's work-run says ${serverPv?.state}/${serverPv?.reason}`);
    await win.click(`#dl-prep-${runId}`);
    await waitFn(id => document.querySelector(`[data-delivery-run="${id}"]`)?.dataset.deliveryState === "PREPARED", runId, 60000, "delivery PREPARED");
    return "export artifact prepared (POST /v1/work-runs/:id/delivery/prepare)";
  });
  await step("delivery-accept", async () => {
    const card = `[data-delivery-run="${runId}"]`;
    must(/NOT_VERIFIED/.test(await win.evaluate(sel => document.querySelector(sel).textContent, card)), "delivery card does not say NOT_VERIFIED although no test ran in a verified sandbox");
    await win.click(`#dl-open-${runId}`); await waitSel(`#dl-dialog-${runId}`, 10000);
    // Doğrulanmamış ürünün kabulü için onay kutusu (ack-ne) VAR ve işaretli olmalıdır.
    await waitSel(`#ack-ne-${runId}`, 5000);
    for (const cb of await win.locator(`#dl-dialog-${runId} input[type=checkbox]`).all()) await cb.check();
    must(await win.evaluate(id => document.getElementById(`ack-ne-${id}`)?.checked === true, runId), "the NOT_VERIFIED acknowledgement (ack-ne) is not checked before accepting");
    await win.click(`#dl-accept-${runId}`); await confirmDialog("accept delivery");
    await waitFn(id => document.querySelector(`[data-delivery-run="${id}"]`)?.dataset.deliveryState === "ACCEPTED", runId, 60000, "delivery ACCEPTED");
    must(/NOT_VERIFIED/.test(await win.evaluate(sel => document.querySelector(sel).textContent, card)), "after acceptance the delivery card no longer says NOT_VERIFIED");
    await go("#/work"); await waitSel("ol.status-timeline", 20000);
    must(await win.evaluate(() => !document.querySelector('ol.status-timeline li[data-step="COMPLETE"][data-state="current"]')), "accepting the source delivery completed the mission (it must not)");
    return "source delivery accepted (NOT_VERIFIED acknowledged, still NOT_VERIFIED, mission not Complete)";
  });
  await step("product", async () => {
    await go("#/projects");
    if (!(await win.$("#studio-tab-overview"))) await win.getByRole("button", {name: "Open workspace"}).first().click(); // the studio of the project may already be open
    await waitSel("#studio-tab-overview", 20000);
    await win.click("#studio-tab-overview"); await waitSel("#studio-ov-product", 20000);
    if (mode.product === "GATED_4B") {
      await waitText(/not available to the desktop yet|not enabled/i, 20000, "product card 'not available' (GATED_4B)", "#studio-ov-product");
      must(await win.evaluate(() => !document.querySelector("#studio-ov-product #product-start, #studio-ov-product #product-stop, #studio-ov-product [data-product-url]")), "product card offers Start/Stop/address although the product routes are not admitted");
      return {notVerified: "GATED_4B", detail: "honest 'not available to the desktop yet' shown in the product card; the post-4b assertion (exact SANDBOX_UNAVAILABLE refusal) was NOT run"};
    }
    // 4b sonrası: Start sunulur (kaynak üretimi tamam + teslim commit'i), sandbox yok => sunucunun kesin reddi; host'ta hiçbir şey başlamaz.
    await waitSel("#studio-ov-product #product-start", 20000);
    const startRe = new RegExp(`^/v1/work-runs/${runId}/product/start$`);
    expectCount("product start requests before the Founder pressed Start", await requestCount("POST", startRe), 0);
    await win.click("#product-start"); await confirmDialog("start product");
    await waitSel("#product-run-status[data-result]", 20000);
    const ui = await win.evaluate(() => { const c = document.querySelector("#studio-ov-product"); return {result: document.querySelector("#product-run-status")?.dataset.result ?? null, state: c?.dataset.productState ?? null, reason: c?.querySelector("[data-product-reason]")?.dataset.productReason ?? null, url: !!c?.querySelector("[data-product-url]"), stop: !!document.querySelector("#product-stop")}; });
    // Sunucu: tek bir başlatma isteği gitti ve düz 409 SANDBOX_UNAVAILABLE ile reddedildi (doğrulanmış sandbox yok); ekran bunu BAŞARI olarak göstermez.
    const starts = ((await serverGet("/__e2e/requests"))?.requests ?? []).filter(r => r.method === "POST" && startRe.test(r.url));
    expectCount("product start request", starts.length, 1); must(starts[0].status === 409, `the product start was answered ${starts[0].status}, not 409`);
    const prod = (await serverGet(`/v1/work-runs/${runId}/product`))?.product;
    must(prod && prod.devrun?.status !== "RUNNING" && prod.devrun?.status !== "STARTING", `the server reports a running product: ${JSON.stringify(prod?.devrun)}`);
    must(ui.result === "error", `the refused start is shown as '${ui.result}' instead of an error`);
    must(ui.state !== "RUNNING" && ui.state !== "STARTING" && !ui.url && !ui.stop, `product card claims a running product: ${JSON.stringify(ui)}`);
    const reason = ui.reason;
    must(typeof reason === "string" && /^(DEVRUN_)?SANDBOX_UNAVAILABLE/.test(reason), `the card shows reason ${reason} instead of the server's sandbox refusal`);
    const card = ui;
    const ws = path.join(dataRoot, "workos", "projects", projectId, "devrun", "workspace");
    must(!fs.existsSync(ws), `a dev-run workspace was created on the host: ${ws}`);
    return `refused: ${reason}; card=${card.state}; no host workspace`;
  });
  await step("request-ledger", async () => {
    // Yolculuk bittiğinde sunucunun kendi günlüğü sayılır: "başlatılmadı" iddiaları yalnız bir an için değil TÜM yolculuk için geçerli olmalı.
    const mid = await missionIdOf(), gated = mode.analysis === "GATED_4B", gatedProduct = mode.product === "GATED_4B";
    const reqs = (await serverGet("/__e2e/requests"))?.requests ?? [];
    const n = (method, re) => reqs.filter(r => r.method === method && re.test(r.url)).length;
    // Pozitif kontrol (HER kipte): defter boş ya da yanlış kapsamlıysa aşağıdaki "0" sayıları boşuna geçerdi; yolculuğun kendi yazma istekleri defterde GÖRÜNMELİ.
    const acceptRe = new RegExp(`^/v1/work-runs/${runId}/delivery/accept$`), runsRe = new RegExp(`^/v1/missions/${mid}/runs$`);
    expectCount("2xx delivery accept requests (positive control: the ledger holds the journey's own writes)", reqs.filter(r => r.method === "POST" && acceptRe.test(r.url) && r.status >= 200 && r.status < 300).length, 1);
    must(n("POST", runsRe) >= 1, `positive control: expected at least 1 run start request for the journey mission, got ${n("POST", runsRe)}`);
    const approveRe = new RegExp(`^/v1/missions/${mid}/predev/artifacts/[^/]+/approve$`), startRe = new RegExp(`^/v1/work-runs/${runId}/product/start$`);
    expectCount("analysis step requests in the whole journey", n("POST", stepRe(mid)), gated ? 0 : stepsAfterStuck);
    expectCount("approve requests in the whole journey", n("POST", approveRe), gated ? 0 : 1);
    expectCount("analysis plan requests in the whole journey", n("POST", planRe(mid)), 0);
    expectCount("product start requests in the whole journey", n("POST", startRe), gatedProduct ? 0 : 1);
    // Kontrol rotaları belirteçsiz/yanlış belirteçle 403, bilinmeyen görev tohumu 404 verir (sunucunun /v1/ kancası bu yolları kapsamaz).
    const raw = (p, init) => fetch(`http://127.0.0.1:${apiPort}${p}`, {...init, signal: AbortSignal.timeout(10000)}).then(r => r.status);
    const bad = [await raw("/__e2e/requests"), await raw("/__e2e/requests", {headers: {"x-uasco-control-token": "x".repeat(apiToken.length)}}), await raw("/__e2e/seed-stuck-artefact", {method: "POST", headers: {"content-type": "application/json"}, body: "{}"})];
    must(bad.every(c => c === 403), `the /__e2e control routes answered ${bad.join(",")} without a valid token (expected 403 each)`);
    const unknown = await raw("/__e2e/seed-stuck-artefact", {method: "POST", headers: {"content-type": "application/json", "x-uasco-control-token": apiToken}, body: JSON.stringify({missionId: "msn_" + "0".repeat(24)})});
    must(unknown === 404, `seeding an unknown mission answered ${unknown}, expected 404`);
    const zeros = [gated ? "analysis step, approve" : null, "plan", gatedProduct ? "product start" : null].filter(Boolean);
    return `journey mission/run only: analysis step ${n("POST", stepRe(mid))}, approve ${n("POST", approveRe)}, plan ${n("POST", planRe(mid))}, product start ${n("POST", startRe)}; positive control: 1 accepted delivery, ${n("POST", runsRe)} run start(s); control routes: 403 without a token, 404 for an unknown mission${gated || gatedProduct ? `; NOT evidence in this mode: the zeros for ${zeros.join(" / ")} (the desktop cannot send those requests while their routes are not admitted); plan == 0 is a negative guard that only a post-4b run can falsify` : "; plan == 0 is a negative guard (falsified only by a planted plan request)"}`;
  });
}
await main();
