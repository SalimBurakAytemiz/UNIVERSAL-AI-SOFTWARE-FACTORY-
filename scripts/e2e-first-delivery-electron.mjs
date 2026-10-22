// //TR: COORD-FIRST-DELIVERY-WIRING gerçek Electron uçtan uca testi: gerçek Control API (server.ts) + gerçek Electron (main.mjs, preload, renderer) başlatılır; renderer içinde gerçek preload köprüsü (window.uasco) ve gerçek UI tıklamaları CDP ile sürülür. Token ana süreçte kalır; harness yalnız sonuç özetini yazar (token/gövde içeriği yazılmaz).
// Usage (Linux): provision Electron (scripts/provision-electron.mjs after a verified install), then run as a NON-root user so the Chromium sandbox stays on:
//   xvfb-run -a node scripts/e2e-first-delivery-electron.mjs <repoDir> <report.json> <electronBinary>
// The --disable-gpu/--disable-dev-shm-usage switches only adapt Chromium to headless containers; UASCO_SMOKE is NOT set (smoke mode quits the app after 500 ms).
// Scratch data, HOME and the Electron log live under the running user's home (os.homedir()); set UASCO_E2E_HOME to use another writable directory. SIGINT/SIGTERM/SIGHUP/exit kill the detached API and Electron process groups.
import cp from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import crypto from "node:crypto"; import path from "node:path";
const W = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]), ELECTRON = path.resolve(process.argv[4]);
const port = 34000 + crypto.randomInt(0, 2000), cdpPort = 36000 + crypto.randomInt(0, 2000), token = crypto.randomBytes(32).toString("hex");
const HOME_DIR = process.env.UASCO_E2E_HOME ? path.resolve(process.env.UASCO_E2E_HOME) : os.homedir();
fs.mkdirSync(HOME_DIR, {recursive: true});
const data = fs.mkdtempSync(path.join(HOME_DIR, "fd-data-"));
const {safeChildEnv} = await import(path.join(W, "automation/lib/env-policy.mjs"));
const env = {...safeChildEnv(path.join(W, "config/environment-policy.json"), {provider: "DETERMINISTIC"}), CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token, UASCO_DATA_DIR: path.join(data, "workos"), HOME: HOME_DIR};
const steps = []; const record = (name, ok, detail = "") => { steps.push({name, ok: !!ok, detail: String(detail).slice(0, 300)}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const log = (m) => console.log(`.. ${m}`);
setTimeout(() => { record("watchdog", false, "TIMEOUT_240S"); finish(1); }, 240000).unref?.();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const marker = path.join(W, ".ai/runtime/DESKTOP_SMOKE_READY.json"); try { fs.rmSync(marker, {force: true}); } catch {}
const api = cp.spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "apps/control-api/src/server.ts"], {cwd: W, env, stdio: ["ignore", "pipe", "pipe"], detached: true});
let apiErr = ""; api.stderr.on("data", d => { apiErr = (apiErr + d).slice(-2000); });
let desktop = null, ws = null;
// Both children run in their own process groups (detached), so a Ctrl+C / CI cancel / crash of this harness would not reach them: kill the groups on every way out.
const killGroups = () => { for (const c of [desktop, api]) { try { if (c?.pid) process.kill(-c.pid, "SIGKILL"); } catch {} } };
const finish = (code) => {
  const report = {"//TR": "COORD-FIRST-DELIVERY-WIRING gerçek Electron E2E sonucu (token/gövde içeriği yazılmaz).", at: new Date().toISOString(), status: steps.length && steps.every(s => s.ok) ? "PASS" : "FAIL", steps};
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  try { ws?.close(); } catch {} killGroups();
  setTimeout(() => process.exit(code), 500);
};
process.on("exit", killGroups);
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(sig, () => { killGroups(); record("harness interrupted", false, sig); finish(code); });
try {
  let up = false; for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/health?challenge=${"a".repeat(64)}`)).ok; } catch {} if (!up) await sleep(500); }
  record("control-api started (real server.ts)", up, up ? "" : apiErr.slice(-300)); if (!up) throw new Error("API_DOWN");
  const denv = {...env, ...(process.env.DISPLAY ? {DISPLAY: process.env.DISPLAY} : {}), ...(process.env.XAUTHORITY ? {XAUTHORITY: process.env.XAUTHORITY} : {})};
  desktop = cp.spawn(ELECTRON, [`--remote-debugging-port=${cdpPort}`, "--disable-gpu", "--disable-dev-shm-usage", "apps/desktop/main.mjs"], {cwd: W, env: denv, stdio: ["ignore", "pipe", "pipe"], detached: true});
  let derr = ""; const dlog = fs.createWriteStream(path.join(HOME_DIR, "fd-electron-stderr.log")); desktop.stderr.on("data", d => { derr = (derr + d).slice(-2000); dlog.write(d); }); desktop.stdout.on("data", d => dlog.write(d));
  log("electron spawned");
  desktop.on("exit", (code, sig) => log(`ELECTRON EXIT code=${code} signal=${sig}`));
  api.on("exit", (code, sig) => log(`API EXIT code=${code} signal=${sig}`));
  let target = null; for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(t => t.type === "page" && /renderer\/index\.html/.test(t.url)); } catch {} if (!target) await sleep(500); }
  log(`cdp target ${target ? "found" : "missing"}`);
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
  const ev = async (expression) => { const id = ++seq; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true}})); const r = await Promise.race([new Promise(res => pending.set(id, res)), sleep(20000).then(() => ({timeout: true}))]); if (r.timeout) { log(`EVAL_TIMEOUT: ${expression.slice(0, 120)}`); if (!globalThis.__paused) { globalThis.__paused = true; await probe(); } return {ok: false, e: "EVAL_TIMEOUT"}; } if (r.error) { log(`CDP_ERROR ${JSON.stringify(r.error).slice(0, 200)}`); return {ok: false, e: "CDP_ERROR"}; } if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "EVAL_ERROR"); return r.result?.result?.value; };
  const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({id, method, params})); return Promise.race([new Promise(res => pending.set(id, res)), sleep(10000).then(() => ({timeout: true}))]); };
  const probe = async () => {
    const t = async (u) => { try { const r = await fetch(u, {signal: AbortSignal.timeout(5000)}); return `${r.status}`; } catch (e) { return `ERR ${e.name}`; } };
    log(`PROBE api /health: ${await t(`http://127.0.0.1:${port}/health?challenge=${"a".repeat(64)}`)}; cdp /json/version: ${await t(`http://127.0.0.1:${cdpPort}/json/version`)}`);
    const ps = cp.spawnSync("ps", ["-o", "pid,pcpu,stat,wchan:20,args", "-u", os.userInfo().username], {encoding: "utf8"}).stdout.split("\n").filter(l => /server\.ts|electron/.test(l)).map(l => l.slice(0, 140));
    log("PROBE ps:\n   " + ps.join("\n   "));
  };
  let health = null; for (let i = 0; i < 40 && !(health?.ok); i++) { health = await ev(`try{return {ok:true,v:await window.uasco.apiGet("/health")}}catch(e){return {ok:false,e:String(e&&e.message||e)}}`); if (!health?.ok) await sleep(500); }
  record("real Electron renderer up; main process proves Control API identity (forced challenge-proof via window.uasco /health)", health?.ok && health.v?.serverIdentity === "VERIFIED" && health.v?.status === "HEALTHY", JSON.stringify(health));
  if (!health?.ok) throw new Error("DESKTOP_IDENTITY");
  const bridge = (kind, p, body) => (log(`bridge ${kind} ${p}`), ev(`try{const v=await window.uasco.${kind}(${JSON.stringify(p)}${body === undefined ? "" : "," + JSON.stringify(body)});return {ok:true,v}}catch(e){return {ok:false,e:String(e&&e.message||e)}}`));
  const IDEA = "A small web app where I can track my daily reading with a streak counter";
  const created = await bridge("apiPost", "/v1/intakes", {idea: IDEA, title: "Reading tracker"});
  const intake = created.v?.body?.intake;
  record("POST /v1/intakes through the real preload bridge creates project + first mission", created.ok && created.v.status === 201 && /^itk_/.test(intake?.intakeId ?? ""), JSON.stringify({status: created.v?.status, e: created.e}));
  const list = await bridge("apiGet", "/v1/intakes"), one = await bridge("apiGet", `/v1/intakes/${intake.intakeId}`);
  record("GET /v1/intakes and /v1/intakes/:id admitted and served", list.ok && JSON.stringify(list.v).includes(intake.intakeId) && one.ok && JSON.stringify(one.v).includes(intake.projectId), JSON.stringify({l: list.e, o: one.e}));
  const plan = await bridge("apiPost", `/v1/missions/${intake.missionId}/plan`, {tasks: [{title: "Giriş ekranı"}, {title: "API", dependsOn: [0]}]});
  record("POST /v1/missions/:id/plan admitted and stored", plan.ok && plan.v.status >= 200 && plan.v.status < 300, JSON.stringify({status: plan.v?.status, e: plan.e}));
  const tasksRes = await bridge("apiGet", `/v1/missions/${intake.missionId}/tasks`);
  const tasks = tasksRes.v?.tasks ?? tasksRes.v?.body?.tasks ?? [];
  record("GET /v1/missions/:id/tasks returns the two planned tasks", tasks.length === 2 && tasks[1].dependsOn?.[0] === tasks[0].taskId, JSON.stringify({n: tasks.length, e: tasksRes.e}));
  const [t1, t2] = tasks;
  const tr = (id, to) => bridge("apiPost", `/v1/tasks/${id}/transition`, {to, reason: `e2e ${to}`});
  const gated = await tr(t2.taskId, "IN_PROGRESS");
  record("dependency gate: task 2 cannot start before task 1 is done (409)", gated.ok && gated.v.status === 409 && gated.v.body?.reason === "TASK_DEPENDENCIES_NOT_DONE", JSON.stringify({s: gated.v?.status, r: gated.v?.body?.reason}));
  const a = await tr(t1.taskId, "IN_PROGRESS"), b = await tr(t1.taskId, "DONE"), c = await tr(t2.taskId, "IN_PROGRESS");
  record("task 1 PENDING->IN_PROGRESS->DONE, then task 2 starts", [a, b, c].every(x => x.ok && x.v.status === 200), JSON.stringify([a, b, c].map(x => x.v?.status ?? x.e)));
  const g1 = await bridge("apiGet", `/v1/tasks/${t1.taskId}`), flow = await bridge("apiGet", `/v1/projects/${intake.projectId}/flow`);
  record("GET /v1/tasks/:id and /v1/projects/:id/flow admitted and served", g1.ok && JSON.stringify(g1.v).includes('"DONE"') && flow.ok, JSON.stringify({g: g1.e, f: flow.e}));
  const refusals = [await bridge("apiGet", "/v1/intakes?x=1"), await bridge("apiGet", `/v1/tasks/${t1.taskId}/`), await bridge("apiPost", `/v1/intakes/${intake.intakeId}`, {}), await bridge("apiGet", `/v1/tasks/${t1.taskId}/transition`), await bridge("apiPost", "/v1/intakes", {idea: "x".repeat(33000)})];
  record("bridge refuses near misses, wrong method and a body over 32 KB before any HTTP call", refusals.every(r => !r.ok) && refusals[4].e.includes("API_BODY_TOO_LARGE") && refusals.slice(0, 4).every(r => r.e.includes("INVALID_API_PATH")), JSON.stringify(refusals.map(r => r.e ?? "ADMITTED")));
  // Görev-koşu bağı: gerçek bir mission koşusu kaydı açılır (yalnız kayıt; sandbox yürütmesi başlatılmaz), UI'dan göreve bağlanır, bridge ile doğrulanır.
  const runRes = await bridge("apiPost", `/v1/missions/${intake.missionId}/runs`, {});
  const runId = runRes.v?.body?.run?.runId ?? runRes.v?.run?.runId ?? null;
  record("POST /v1/missions/:id/runs creates a run record for the task-run link (no execution started by this step)", runRes.ok && runRes.v?.status === 201 && /^run_[0-9a-f]{24}$/.test(runId ?? ""), JSON.stringify({status: runRes.v?.status, e: runRes.e, body: runRes.v?.body?.error ?? null}));
  // UI: Görevler ekranında mission seç, görevi seç, durum paneli üzerinden görev 2'yi DONE yap (gerçek tıklama).
  log("ui phase");
  // Veriler köprüyle (UI dışından) oluşturulduğu için renderer önbelleği bayattır; ekran taze açılır gibi sayfa yeniden yüklenir.
  await send("Page.reload", {ignoreCache: true}); await sleep(2500);
  await ev(`location.hash="#/work";return true`); await sleep(2000);
  const clicked = await ev(`for(let i=0;i<40;i++){const b=document.querySelector('[data-mission-id="${intake.missionId}"]');if(b){b.click();return true}await new Promise(r=>setTimeout(r,250))}return false`); await sleep(1200);
  const opened = clicked && await ev(`for(let i=0;i<40;i++){const b=document.querySelector('[data-task-inspect="${t2.taskId}"]');if(b){b.click();return true}await new Promise(r=>setTimeout(r,250))}return false`); await sleep(1000);
  log("VIEW " + JSON.stringify(await ev(`const m=document.querySelector("main")||document.body;const keys=new Set();m.querySelectorAll("*").forEach(n=>{for(const k in n.dataset)keys.add(k)});return {text:m.innerText.replace(/\\s+/g," ").slice(0,700),dataKeys:[...keys].slice(0,40)}`)));
  log("DOM " + JSON.stringify(await ev(`return {hash:location.hash,clicked:${clicked},opened:${opened},detail:!!document.getElementById("work-detail"),missionBtns:document.querySelectorAll("[data-mission-id]").length,taskBtns:[...document.querySelectorAll("[data-task-inspect]")].map(b=>b.dataset.taskInspect+":"+b.getAttribute("aria-pressed")),inspector:document.getElementById("task-inspector")?.dataset.taskInspector??null,panel:!!document.getElementById("task-status"),title:document.querySelector("#work-detail h3")?.textContent??null}`)));
  const panel = await ev(`const p=document.getElementById("task-status");return p?{task:p.dataset.taskStatus,targets:[...p.querySelectorAll("[data-task-to]")].map(b=>b.dataset.taskTo)}:null`);
  record("UI: #/work shows the mission, the task and its status panel with the allowed targets", opened && panel?.task === t2.taskId && JSON.stringify(panel.targets) === JSON.stringify(["DONE", "BLOCKED", "PENDING"]), JSON.stringify(panel));
  const emptyRuns = await bridge("apiGet", `/v1/tasks/${t2.taskId}/runs`);
  record("GET /v1/tasks/:id/runs admitted (allow-list) and lists no link before linking", emptyRuns.ok && emptyRuns.v?.status === 200 && JSON.stringify(emptyRuns.v).includes('"runs":[]'), JSON.stringify({s: emptyRuns.v?.status, e: emptyRuns.e}));
  const picked = await ev(`for(let i=0;i<40;i++){const s=document.getElementById("taskruns-run");if(s&&[...s.options].some(o=>o.value==="${runId}")){s.value="${runId}";s.dispatchEvent(new Event("change",{bubbles:true}));s.dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("taskruns-submit").click();return true}await new Promise(r=>setTimeout(r,250))}return false`); await sleep(2000);
  const linkedApi = await bridge("apiGet", `/v1/tasks/${t2.taskId}/runs`);
  const listedUi = await ev(`for(let i=0;i<20;i++){const li=document.querySelector('[data-task-run="${runId}"]');if(li)return {text:li.textContent.slice(0,200)};await new Promise(r=>setTimeout(r,250))}return null`);
  record("UI: linking a run from 'Runs for this task' stores the link (bridge GET) and the run is then listed in the panel", picked === true && linkedApi.ok && JSON.stringify(linkedApi.v).includes(runId) && listedUi !== null, JSON.stringify({picked, api: linkedApi.e ?? linkedApi.v?.status, listedUi}));
  await ev(`const i=document.getElementById("taskst-reason");if(i){i.value="kabul testi gecti";i.dispatchEvent(new Event("input",{bubbles:true}))}document.getElementById("taskst-DONE").click();return true`); await sleep(300);
  // LANE-A task-done-confirm: DONE is final, so the click first opens the confirmation dialog (#confirmDialog); nothing may change before it is accepted.
  const dlg = await ev(`for(let i=0;i<40;i++){const d=document.getElementById("confirmDialog");if(d&&d.open)return {open:true,ok:!!document.getElementById("confirmOk"),title:(document.getElementById("confirmDialogTitle")?.textContent??"").slice(0,80)};await new Promise(r=>setTimeout(r,250))}return {open:false}`);
  const before = await bridge("apiGet", `/v1/tasks/${t2.taskId}`);
  record("UI: 'Mark as Done' opens a confirmation first and the task is not DONE before it is accepted", dlg?.open === true && dlg.ok === true && before.ok && before.v?.task?.status === "IN_PROGRESS", JSON.stringify({dlg, status: before.v?.task?.status ?? before.e}));
  await ev(`const b=document.getElementById("confirmOk");if(b)b.click();return !!b`); await sleep(2000);
  const after = await bridge("apiGet", `/v1/tasks/${t2.taskId}`), status = await ev(`const s=document.getElementById("task-status-status");return s?{result:s.dataset.result??null,text:s.textContent.slice(0,200)}:null`);
  // "shows the result" = the UI reports SUCCESS (data-result="ok"): an error text or an ev() failure object ({ok:false,e}) must not pass.
  record("UI: accepting the confirmation moves task 2 to DONE through the real bridge and shows the result", after.ok && JSON.stringify(after.v).includes('"DONE"') && status?.result === "ok" && typeof status.text === "string" && status.text.length > 0, JSON.stringify({status}));
  finish(steps.every(s => s.ok) ? 0 : 1);
} catch (e) { record("harness", false, e.message); finish(1); }
