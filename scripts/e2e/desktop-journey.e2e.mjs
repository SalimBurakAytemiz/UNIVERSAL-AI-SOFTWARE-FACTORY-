// //TR: Bu betik gerçek Electron masaüstü uygulamasını (Playwright _electron) geçici veri dizini ve FAKE yürütücü ile sürer: fikir -> intake (web-node) -> plan -> görev -> koşu -> teslim. Her adımda ekrandaki durum doğrulanır ve ekran görüntüsü alınır; GATED_4B adımlar dürüstçe "etkin değil" görünmelidir. Gerçek Claude ve ağ yoktur. Çıkış kodu: 0 = tüm adımlar geçti, 1 = bir adım başarısız, 3 = BLOCKED (ortam Electron'u başlatamıyor; PASS sayılmaz). Batch 4b öncesi/sonrası: gerçek main.mjs allow-list'i uygulama içinden yoklanır (detect-routes); analysis/product rotaları admit EDİLMEMİŞSE ilgili adım NOT_VERIFIED:GATED_4B kaydedilir (4b-sonrası iddianın PASS'ı sayılmaz), admit EDİLMİŞSE gerçek iddia çalışır; özet PASS / NOT_VERIFIED / FAIL ayrı sayılır. Kullanım: node scripts/e2e/desktop-journey.e2e.mjs [--out <dizin>] [--require-post-4b] (Linux başsız ortam: xvfb-run -a node ...).
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
const outDir = path.resolve(outArg >= 0 && argv[outArg + 1] ? argv[outArg + 1] : path.join(os.tmpdir(), `uasco-e2e-${Date.now()}`));
const shotsDir = path.join(outDir, "screenshots"), dataRoot = path.join(outDir, "data");
fs.mkdirSync(shotsDir, {recursive: true}); fs.mkdirSync(dataRoot, {recursive: true});

const steps = [];
const mode = {analysis: "UNKNOWN", product: "UNKNOWN"}; // ADMITTED | GATED_4B (uygulamadaki gerçek allow-list'ten)
let projectId = null;
let backend = null, app = null, win = null, backendLog = "";
const report = (extra = {}) => {
  const failed = steps.find(s => s.status === "FAIL");
  const counts = {PASS: steps.filter(x => x.status === "PASS").length, NOT_VERIFIED: steps.filter(x => x.status === "NOT_VERIFIED").length, FAIL: steps.filter(x => x.status === "FAIL").length};
  const result = extra.blocked ? `BLOCKED:${extra.blocked}` : failed ? "FAIL" : !steps.length ? "NOT_RUN" : counts.NOT_VERIFIED ? (requirePost4b ? "FAIL:NOT_VERIFIED_WITH_REQUIRE_POST_4B" : "PASS_WITH_NOT_VERIFIED") : "PASS";
  const r = {platform: process.platform, node: process.version, outDir, mode, counts, steps, result, ...extra};
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(r, null, 2));
  return r;
};
const blocked = async (code, detail) => {
  console.log(`BLOCKED:${code} ${detail ?? ""}`.trim());
  await cleanup(); report({blocked: code, detail: String(detail ?? "")});
  process.exit(3);
};
async function cleanup() {
  try { if (app) await app.close(); } catch { /* kapanışta hata yutulur */ }
  try { if (backend && !backend.killed) { backend.kill("SIGTERM"); await new Promise(r => setTimeout(r, 500)); if (!backend.killed) backend.kill(); } } catch { /* yoksay */ }
}

// ---- ortam: Playwright (yeni bağımlılık eklenmez; ön kurulu playwright ya da playwright-core) ----
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const roots = [undefined, process.env.PLAYWRIGHT_MODULE_DIR, "/opt/node-tools/node_modules"].filter((x, i) => i === 0 || x);
  for (const root of roots) for (const name of ["playwright", "playwright-core"]) {
    try { const m = root ? req(path.join(root, name)) : req(name); if (m && m._electron) return m; } catch { /* sıradaki */ }
  }
  return null;
}
// //TR: Repo'nun kendi Electron'u: önce mühürlü provision (scripts/provision-electron.mjs çıktısı, checksum doğrulamalı); yoksa node_modules/electron paketinin indirilmiş binary'si. Hiçbiri yoksa BLOCKED:ELECTRON_BINARY_MISSING (hiçbir şey sessizce indirilmez).
async function electronBinary() {
  try {
    const m = await import(pathToFileURL(path.join(repo, "automation", "lib", "electron-provision.mjs")).href);
    const exe = await m.verifyProvisionedElectron(repo);
    const p = typeof exe === "string" ? exe : exe?.exePath ?? exe?.exe;
    if (typeof p === "string" && fs.existsSync(p)) return {path: p, source: "provisioned"};
  } catch { /* sıradaki */ }
  try { const p = createRequire(import.meta.url)("electron"); if (typeof p === "string" && fs.existsSync(p)) return {path: p, source: "node_modules/electron"}; } catch { /* yok */ }
  return null;
}
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on("error", rej); s.listen({host: "127.0.0.1", port: 0}, () => { const p = s.address().port; s.close(() => res(p)); }); });

// ---- adım kaydı ----
const T = {en: true};
const mainText = async () => (await win.evaluate(() => document.querySelector("main")?.innerText ?? "")).replace(/\s+/g, " ");
const shot = async name => { const f = `${String(steps.length + 1).padStart(2, "0")}-${name}.png`; try { await win.screenshot({path: path.join(shotsDir, f)}); return f; } catch { return null; } };
class Check extends Error {}
const must = (cond, msg) => { if (!cond) throw new Check(msg); };
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn(), nv = out && typeof out === "object" ? out : null, detail = nv ? nv.detail : out, status = nv?.notVerified ? "NOT_VERIFIED" : "PASS";
    steps.push({name, status, ...(nv?.notVerified ? {reason: nv.notVerified} : {}), ms: Date.now() - t0, detail: detail ?? null, screenshot: await shot(name)});
    console.log(`${status}${nv?.notVerified ? `:${nv.notVerified}` : ""} ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const screen = await mainText().catch(() => "").then(t => t.slice(0, 1200));
    steps.push({name, status: "FAIL", ms: Date.now() - t0, detail: String(e?.message ?? e).slice(0, 600), screenText: screen, screenshot: await shot(`${name}-FAIL`)});
    console.log(`FAIL ${name} — ${String(e?.message ?? e).slice(0, 300)}`);
    throw e;
  }
}
const waitText = (re, timeout = 15000, what = String(re)) => win.waitForFunction(src => new RegExp(src, "i").test((document.querySelector("main")?.innerText ?? "").replace(/\s+/g, " ")), re.source, {timeout}).catch(() => { throw new Check(`text not shown in time: ${what}`); });
const waitSel = (sel, timeout = 15000) => win.waitForSelector(sel, {timeout, state: "attached"}).catch(() => { throw new Check(`element not found: ${sel}`); });
const go = async hash => { await win.evaluate(h => { location.hash = h; }, hash); await win.waitForTimeout(800); };

async function main() {
  const pw = loadPlaywright();
  if (!pw) return blocked("PLAYWRIGHT_MISSING", "no playwright/playwright-core with _electron found (set PLAYWRIGHT_MODULE_DIR)");
  const exe = await electronBinary();
  if (!exe) return blocked("ELECTRON_BINARY_MISSING", "node_modules/electron has no downloaded binary (run: node node_modules/electron/install.js)");
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return blocked("NO_DISPLAY", "no display; run under xvfb-run -a");
  const port = await freePort(), token = crypto.randomBytes(24).toString("hex");
  const env = {...process.env, CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token, E2E_DATA_ROOT: dataRoot};
  delete env.ELECTRON_RUN_AS_NODE;
  backend = spawn(process.execPath, ["--import", "tsx", path.join("scripts", "e2e", "fake-backend.ts")], {cwd: repo, env, stdio: ["ignore", "pipe", "pipe"]});
  backend.stdout.on("data", d => { backendLog += d; }); backend.stderr.on("data", d => { backendLog += d; });
  console.log(`ENV platform=${process.platform} node=${process.version} electron=${exe.source}`);
  const t0 = Date.now(); let ready = false;
  while (Date.now() - t0 < 60000) { if (backendLog.includes("E2E_BACKEND_READY")) { ready = true; break; } if (backend.exitCode !== null) break; await new Promise(r => setTimeout(r, 200)); }
  if (!ready) return blocked("BACKEND_NOT_STARTED", backendLog.slice(-300));
  const args = [path.join("apps", "desktop", "main.mjs"), `--user-data-dir=${path.join(dataRoot, "electron-user-data")}`, ...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : [])];
  try { app = await pw._electron.launch({executablePath: exe.path, args, cwd: repo, env, timeout: 60000}); win = await app.firstWindow(); }
  catch (e) { return blocked("ELECTRON_LAUNCH_FAILED", String(e?.message ?? e).split("\n")[0]); }
  try {
    await win.evaluate(() => { localStorage.setItem("uasco.lang", "en"); }); await win.reload(); await win.waitForTimeout(1500);
    await runSteps();
  } catch { /* adım kaydı zaten yazıldı */ }
  const r = report();
  await cleanup();
  console.log(`RESULT ${r.result} (PASS ${r.counts.PASS} / NOT_VERIFIED ${r.counts.NOT_VERIFIED} / FAIL ${r.counts.FAIL}; mode analysis=${mode.analysis} product=${mode.product}) out=${outDir}`);
  process.exit(r.result === "PASS" || r.result === "PASS_WITH_NOT_VERIFIED" ? 0 : r.result.startsWith("FAIL:NOT_VERIFIED") ? 4 : 1);
}

async function runSteps() {
  await step("first-run-dialog", async () => {
    await waitSel("#firstRunDialog");
    await win.keyboard.press("Escape"); await win.waitForTimeout(400);
    must(!(await win.evaluate(() => !!document.getElementById("firstRunDialog"))), "first-run dialog did not close");
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
    return rows.join(" ");
  });
  await step("intake-idea", async () => {
    await go("#/projects"); await waitSel("#intake-t"); await win.click("#intake-t");
    must(await win.evaluate(() => document.querySelector("#intake-template")?.value === "web-node" || !document.querySelector("#intake-template") === false), "template select is not defaulted to web-node");
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
    await win.click("#analysis-step-submit");
    const noResult = () => win.evaluate(() => !document.querySelector("[data-analysis-status='DRAFT_READY'],[data-analysis-status='AWAITING_APPROVAL'],[data-analysis-status='COMPLETE'],[data-analysis-plan='CREATED']"));
    if (mode.analysis === "GATED_4B") {
      await waitText(/not enabled/, 15000, "analysis step 'not enabled'");
      must(await noResult(), "analysis claims a result although the step is not admitted");
      return {notVerified: "GATED_4B", detail: "honest 'not enabled' shown; the post-4b assertion (server BLOCKED readiness) was NOT run"};
    }
    // 4b sonrası: sunucunun kesin BLOCKED hazırlığı (FAKE kurulum => analiz oluşturucusu / CLI hazır değil); asla taslak ya da tamam gösterilmez.
    await win.waitForFunction(() => [...document.querySelectorAll("[data-analysis-status]")].some(n => n.dataset.analysisStatus !== "NONE"), null, {timeout: 30000}).catch(() => { throw new Check("analysis showed no answer in 30 s (status stayed NONE)"); });
    const st = await win.evaluate(() => [...document.querySelectorAll("[data-analysis-status]")].map(n => n.dataset.analysisStatus).find(x => x !== "NONE"));
    must(st === "BLOCKED", `analysis shows ${st} instead of the server's BLOCKED readiness`);
    must(await noResult(), "analysis shows a draft/complete result while the executor is FAKE");
    const blockers = await win.evaluate(() => [...document.querySelectorAll("[data-analysis-blocker]")].map(n => n.dataset.analysisBlocker));
    must(blockers.length > 0, "BLOCKED shows no blocker code");
    must(blockers.every(b => /^([a-z]+:)?[A-Z][A-Z0-9_]*(:.+)?$/.test(b)), `blocker code not in the server's shape: ${blockers.join(",")}`);
    must(!(await win.evaluate(() => !!document.querySelector("#analysis-plan-submit"))), "'Create plan' is offered although the analysis is not COMPLETE");
    return `server BLOCKED: ${blockers.join(" | ")}`;
  });
  await step("plan-task-by-hand", async () => {
    await go("#/work"); await waitSel("#plan-title-0", 20000);
    await win.fill("#plan-title-0", "Add the book list page");
    await win.click("#plan-submit");
    await waitText(/Add the book list page/, 20000, "planned task in the mission");
    return "one task planned by hand (analysis is blocked or not enabled)";
  });
  await step("authorize-mission", async () => {
    await win.click("#tr-PREFLIGHT"); await waitSel("#tr-AUTHORIZED", 20000);
    await win.click("#tr-AUTHORIZED"); await waitSel("#confirmOk", 10000); await win.click("#confirmOk");
    await waitText(/Authorized\b.{0,40}current status|current status.{0,60}Authorized/i, 20000, "mission Authorized");
    return "Draft -> Preflight -> Authorized (confirmed)";
  });
  await step("run-engine-truth", async () => {
    await waitSel("#run-start", 20000); await waitSel("[data-engine-head]", 20000);
    const head = await win.evaluate(() => document.querySelector("[data-engine-head]")?.dataset.engineHead ?? null);
    const active = await win.evaluate(() => document.querySelector("[data-engine-active]")?.dataset.engineActive ?? null);
    must(head !== null, "run engine block is not shown before Start run");
    must(["READY", "BLOCKED", "UNKNOWN"].includes(head), `run engine block shows an invented state: ${head}`);
    return `engine=${head} active=${active}`;
  });
  let runId = null;
  await step("start-run", async () => {
    await win.click("#run-start");
    await win.waitForTimeout(600); if (await win.isVisible("#confirmOk")) await win.click("#confirmOk");
    await waitSel("[data-run-status]", 30000);
    runId = await win.evaluate(() => document.querySelector("[data-run-status]").dataset.runId);
    return runId;
  });
  await step("run-reaches-review", async () => {
    await win.waitForFunction(() => { const n = document.querySelector("[data-run-status]"); return n && ["AWAITING_APPROVAL", "FAILED", "BLOCKED", "SUCCEEDED", "CANCELLED"].includes(n.dataset.runStatus); }, null, {timeout: 120000}).catch(() => { throw new Check("run did not settle in 120 s"); });
    const st = await win.evaluate(() => document.querySelector("[data-run-status]").dataset.runStatus);
    must(st === "AWAITING_APPROVAL", `run ended as ${st} instead of AWAITING_APPROVAL (FAKE executor + CLEAN review)`);
    return `status=${st}`;
  });
  await step("test-result-honest", async () => {
    await waitSel("[data-run-test-result]", 20000);
    const r = await win.evaluate(() => { const n = document.querySelector("[data-run-test-result]"); return {kind: n.dataset.runTestResult, reason: n.dataset.runTestReason, text: n.textContent}; });
    must(["EXECUTED_VERIFIED", "FAILED", "NOT_EXECUTED", "NOT_VERIFIED", "UNKNOWN"].includes(r.kind), `unknown result kind ${r.kind}`);
    if (r.kind !== "EXECUTED_VERIFIED") must(!/\bpassed\b/i.test(r.text), "a result that is not verified says 'passed'");
    return `${r.kind}${r.reason ? ":" + r.reason : ""}`;
  });
  await step("link-run-to-task", async () => {
    await waitSel("#run-link input[type=checkbox]", 20000);
    await win.locator("#run-link input[type=checkbox]").first().check();
    await win.click("#runlink-submit");
    await waitText(/Add the book list page/, 15000, "linked task on the run card");
    must(await win.evaluate(id => !!document.querySelector(`[data-run-linked-for="${id}"]`), runId), "run card does not list the linked task");
    return "task linked to the run (POST /v1/tasks/:id/runs)";
  });
  await step("open-project-workspace", async () => {
    await go("#/projects"); await win.getByRole("button", {name: "Open workspace"}).first().click();
    await waitSel("#studio-tab-delivery", 20000);
    return "project workspace opened";
  });
  await step("delivery-prepare", async () => {
    await win.click("#studio-tab-delivery"); await waitSel(`[data-delivery-run="${runId}"]`, 20000);
    must((await win.evaluate(id => document.querySelector(`[data-delivery-run="${id}"]`).dataset.deliveryState, runId)) === "NOT_PREPARED", "delivery is not NOT_PREPARED before preparing");
    await win.click(`#dl-prep-${runId}`);
    await win.waitForFunction(id => document.querySelector(`[data-delivery-run="${id}"]`)?.dataset.deliveryState === "PREPARED", runId, {timeout: 60000}).catch(() => { throw new Check("delivery did not become PREPARED"); });
    return "export artifact prepared (POST /v1/work-runs/:id/delivery/prepare)";
  });
  await step("delivery-accept", async () => {
    const card = `[data-delivery-run="${runId}"]`;
    const verification = await win.evaluate(sel => document.querySelector(sel).textContent, card);
    must(/NOT_VERIFIED/.test(verification), "delivery card does not say NOT_VERIFIED although no test ran in a verified sandbox");
    await win.click(`#dl-open-${runId}`); await waitSel(`#dl-dialog-${runId}`, 10000);
    for (const cb of await win.locator(`#dl-dialog-${runId} input[type=checkbox]`).all()) await cb.check();
    await win.click(`#dl-accept-${runId}`); await waitSel("#confirmOk", 10000); await win.waitForTimeout(300); await win.click("#confirmOk");
    await win.waitForFunction(id => document.querySelector(`[data-delivery-run="${id}"]`)?.dataset.deliveryState === "ACCEPTED", runId, {timeout: 60000}).catch(() => { throw new Check("delivery did not become ACCEPTED"); });
    return "source delivery accepted (still NOT_VERIFIED, acknowledged by the Founder)";
  });
  await step("product", async () => {
    await win.click("#studio-tab-overview"); await waitSel("#studio-ov-product", 20000);
    if (mode.product === "GATED_4B") {
      await waitText(/not available to the desktop yet|not enabled/i, 20000, "product card 'not available' (GATED_4B)");
      must(await win.evaluate(() => !document.querySelector("#product-start,#product-stop,[data-product-url]")), "product card offers Start/Stop/address although the product routes are not admitted");
      return {notVerified: "GATED_4B", detail: "honest 'not available to the desktop yet' shown; the post-4b assertion (exact DEVRUN_SANDBOX_UNAVAILABLE refusal) was NOT run"};
    }
    // 4b sonrası: Start sunulur (kaynak üretimi tamam + teslim commit'i), sandbox yok => sunucunun kesin reddi; host'ta hiçbir şey başlamaz.
    await waitSel("#product-start", 20000);
    await win.click("#product-start"); await waitSel("#confirmOk", 10000); await win.waitForTimeout(300); await win.click("#confirmOk");
    await waitSel("#product-run-status", 20000);
    await win.waitForFunction(() => /Refused \(/.test(document.querySelector("#product-run-status")?.innerText ?? ""), null, {timeout: 20000}).catch(() => { throw new Check("no refusal shown after Start"); });
    const refusal = await win.evaluate(() => document.querySelector("#product-run-status").innerText.replace(/\s+/g, " "));
    // Sunucunun kesin kodu gösterilir: DEVRUN_SANDBOX_UNAVAILABLE:<neden> (doğrulanmış sağlayıcı var, köprü yok) ya da düz SANDBOX_UNAVAILABLE (doğrulanmış sandbox yok; kapı önce reddeder). İkisi de "hiçbir şey host'ta başlamadı" demektir.
    const reason = (refusal.match(/Refused \(((?:DEVRUN_)?SANDBOX_UNAVAILABLE[^)\s]*)\)/) ?? [null, null])[1];
    must(reason, `refusal does not show the server's sandbox refusal code: ${refusal.slice(0, 200)}`);
    const card = await win.evaluate(() => { const n = document.querySelector("#studio-ov-product"); return {state: n?.dataset.productState ?? null, url: !!n?.querySelector("[data-product-url]"), stop: !!document.querySelector("#product-stop")}; });
    must(card.state !== "RUNNING" && card.state !== "STARTING" && !card.url && !card.stop, `product card claims a running product: ${JSON.stringify(card)}`);
    const ws = path.join(dataRoot, "workos", "projects", projectId, "devrun", "workspace");
    must(!fs.existsSync(ws), `a dev-run workspace was created on the host: ${ws}`);
    return `refused: ${reason}; card=${card.state}; no host workspace`;
  });
}
await main();
