// //TR: DSK-T0001 gerçek Electron uçtan uca testi (FAKE_EXECUTOR): gerçek Control API (scripts/e2e-fake-executor-api.mjs ile server.ts buildServer + FakeExecutors + sahte güvenlik tarayıcıları, sandbox YOK) ve gerçek Electron (main.mjs, preload, renderer) başlatılır; UI gerçek tıklamalarla CDP üzerinden sürülür: sihirbazda proje -> ilk mission -> elle görev planı -> AUTHORIZED (onay penceresi) -> koşu başlat -> koşu kartı, test sonucu (NOT_EXECUTED beklenir) ve koşu farkı. Kanıt yalnız FAKE_EXECUTOR kanıtıdır: gerçek model, gerçek sandbox veya test yürütmesi kanıtı DEĞİLDİR. Token/gövde içeriği rapora yazılmaz.
// Usage (Linux): provision Electron (scripts/provision-electron.mjs), then run as a NON-root user so the Chromium sandbox stays on:
//   xvfb-run -a node scripts/e2e-desktop-fake-delivery-electron.mjs <repoDir> <report.json> <electronBinary>
// Scratch data, HOME and the Electron log live under os.homedir() (or UASCO_E2E_HOME). SIGINT/SIGTERM/SIGHUP/exit kill the detached API and Electron process groups.
import cp from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import crypto from "node:crypto"; import path from "node:path";
const W = path.resolve(process.argv[2]), OUT = path.resolve(process.argv[3]), ELECTRON = path.resolve(process.argv[4]);
const port = 34000 + crypto.randomInt(0, 2000), cdpPort = 36000 + crypto.randomInt(0, 2000), token = crypto.randomBytes(32).toString("hex");
const HOME_DIR = process.env.UASCO_E2E_HOME ? path.resolve(process.env.UASCO_E2E_HOME) : os.homedir();
fs.mkdirSync(HOME_DIR, {recursive: true});
const data = fs.mkdtempSync(path.join(HOME_DIR, "fx-data-"));
const {safeChildEnv} = await import(path.join(W, "automation/lib/env-policy.mjs"));
const env = {...safeChildEnv(path.join(W, "config/environment-policy.json"), {provider: "DETERMINISTIC"}), CONTROL_API_PORT: String(port), UASCO_CONTROL_TOKEN: token, UASCO_DATA_DIR: path.join(data, "workos"), UASCO_E2E_RUNTIME: path.join(data, "runtime"), HOME: HOME_DIR};
// Honesty label carried by every report: this run proves the desktop flow with a deterministic fake implementer/reviewer only.
export const EVIDENCE_LABEL = Object.freeze({evidenceClass: "FAKE_EXECUTOR", executor: "FakeExecutors (core/workos/executors.ts), no model call, 0 USD", securityTools: "FAKE_SECURITY_TOOLS (core/workos/security-tools.ts fakeSecurity)", sandbox: "NONE (sandbox:null) -> tests NOT_EXECUTED",
  notEvidenceOf: ["real-model output", "real sandbox execution", "test execution or product verification", "real security scanning"]});
const steps = []; const record = (name, ok, detail = "") => { steps.push({name, ok: !!ok, detail: String(detail).slice(0, 400)}); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const log = (m) => console.log(`.. ${m}`);
setTimeout(() => { record("watchdog", false, "TIMEOUT_300S"); finish(1); }, 300000).unref?.();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = cp.spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/e2e-fake-executor-api.mjs"], {cwd: W, env, stdio: ["ignore", "pipe", "pipe"], detached: true});
let apiErr = "", apiOut = ""; api.stderr.on("data", d => { apiErr = (apiErr + d).slice(-2000); }); api.stdout.on("data", d => { apiOut = (apiOut + d).slice(-2000); });
let desktop = null, ws = null, finished = false;
const killGroups = () => { for (const c of [desktop, api]) { try { if (c?.pid) process.kill(-c.pid, "SIGKILL"); } catch {} } };
const finish = (code) => {
  if (finished) return; finished = true;
  const report = {"//TR": "DSK-T0001 FAKE_EXECUTOR gerçek Electron E2E sonucu (token/gövde içeriği yazılmaz; gerçek model/sandbox kanıtı değildir).", at: new Date().toISOString(), ...EVIDENCE_LABEL, status: steps.length && steps.every(s => s.ok) ? "PASS" : "FAIL", steps};
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  try { ws?.close(); } catch {} killGroups();
  setTimeout(() => process.exit(code), 500);
};
process.on("exit", killGroups);
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(sig, () => { killGroups(); record("harness interrupted", false, sig); finish(code); });
try {
  let up = false; for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/health?challenge=${"a".repeat(64)}`)).ok; } catch {} if (!up) await sleep(500); }
  record("control-api started (real server.ts buildServer, FAKE_EXECUTOR, no sandbox)", up && /"executor":"FAKE_EXECUTOR"/.test(apiOut) && /"sandbox":"NONE"/.test(apiOut), up ? apiOut.trim().slice(0, 200) : apiErr.slice(-300)); if (!up) throw new Error("API_DOWN");
  const denv = {...env, ...(process.env.DISPLAY ? {DISPLAY: process.env.DISPLAY} : {}), ...(process.env.XAUTHORITY ? {XAUTHORITY: process.env.XAUTHORITY} : {})};
  desktop = cp.spawn(ELECTRON, [`--remote-debugging-port=${cdpPort}`, "--disable-gpu", "--disable-dev-shm-usage", "apps/desktop/main.mjs"], {cwd: W, env: denv, stdio: ["ignore", "pipe", "pipe"], detached: true});
  const dlog = fs.createWriteStream(path.join(HOME_DIR, "fx-electron-stderr.log")); desktop.stderr.on("data", d => dlog.write(d)); desktop.stdout.on("data", d => dlog.write(d));
  desktop.on("exit", (code, sig) => log(`ELECTRON EXIT code=${code} signal=${sig}`));
  let target = null; for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(t => t.type === "page" && /renderer\/index\.html/.test(t.url)); } catch {} if (!target) await sleep(500); }
  if (!target) throw new Error("CDP_TARGET_MISSING");
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
  const ev = async (expression, ms = 30000) => { const id = ++seq; ws.send(JSON.stringify({id, method: "Runtime.evaluate", params: {expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true}})); const r = await Promise.race([new Promise(res => pending.set(id, res)), sleep(ms).then(() => ({timeout: true}))]); if (r.timeout) return {ok: false, e: "EVAL_TIMEOUT"}; if (r.error) return {ok: false, e: "CDP_ERROR"}; if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "EVAL_ERROR"); return r.result?.result?.value; };
  const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({id, method, params})); return Promise.race([new Promise(res => pending.set(id, res)), sleep(10000).then(() => ({timeout: true}))]); };
  const bridge = (kind, p, body) => ev(`try{const v=await window.uasco.${kind}(${JSON.stringify(p)}${body === undefined ? "" : "," + JSON.stringify(body)});return {ok:true,v}}catch(e){return {ok:false,e:String(e&&e.message||e)}}`);
  // In-page helpers: wait for a selector, set a form control the way a user would (value + input/change events), click.
  const H = `const W$=async(s,n=80)=>{for(let i=0;i<n;i++){const e=document.querySelector(s);if(e)return e;await new Promise(r=>setTimeout(r,250))}return null};const SET=(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))};`;
  const ui = (body) => ev(H + body);
  let health = null; for (let i = 0; i < 40 && !(health?.ok); i++) { health = await bridge("apiGet", "/health"); if (!health?.ok) await sleep(500); }
  record("real Electron renderer up; main process proves Control API identity via window.uasco /health", health?.ok && health.v?.serverIdentity === "VERIFIED", JSON.stringify(health));
  if (!health?.ok) throw new Error("DESKTOP_IDENTITY");
  const exec = await bridge("apiGet", "/v1/system/executors");
  record("GET /v1/system/executors reports the FAKE executor pair and no verified sandbox", exec.ok && JSON.stringify(exec.v).includes("FAKE") && exec.v?.sandbox?.state === "UNAVAILABLE", JSON.stringify({kind: exec.v?.active ?? exec.v?.kind ?? null, sandbox: exec.v?.sandbox?.state ?? exec.e}));

  // 1) Project wizard (#/projects -> "New project")
  const NAME = `Reading tracker ${crypto.randomBytes(3).toString("hex")}`;
  await ui(`location.hash="#/projects";return true`); await sleep(1500);
  const wiz = await ui(`const d=await W$("#studio-wizard");if(!d)return {ok:false,e:"NO_WIZARD"};d.open=true;d.dispatchEvent(new Event("toggle"));
    const tpl=await W$("#studio-template-web-node");if(!tpl)return {ok:false,e:"NO_TEMPLATE"};tpl.click();
    SET(await W$("#studio-name"),${JSON.stringify(NAME)});SET(await W$("#studio-env"),"dev");
    const c=await W$("#studio-criteria-0");if(c)SET(c,"The streak counter shows consecutive reading days");
    (await W$("#studio-wizard-submit")).click();
    const idea=await W$("#studio-idea[data-idea-project]",120);return idea?{ok:true,projectId:idea.dataset.ideaProject}:{ok:false,e:"NO_IDEA_PANEL",status:(document.getElementById("studio-wizard-status")?.textContent??"").slice(0,200)}`);
  const projectId = wiz?.projectId ?? null;
  const projList = projectId ? await bridge("apiGet", "/v1/projects") : null, proj = {ok: projList?.ok === true, v: {project: (projList?.v?.projects ?? []).find(p => p.projectId === projectId)}};
  record("UI wizard: 'New project' (web-node template) creates the project (server record, managed repository)", wiz?.ok && /^prj_[0-9a-f]{24}$/.test(projectId ?? "") && proj?.ok && proj.v?.project?.name === NAME && proj.v?.project?.repository?.managed === true, JSON.stringify({wiz, name: proj?.v?.project?.name, managed: proj?.v?.project?.repository?.managed}));
  if (!projectId) throw new Error("NO_PROJECT");

  // 2) First mission from the wizard's idea panel
  const idea = await ui(`SET(await W$("#studio-idea-objective"),"Show how many days in a row I have read");const c=await W$("#studio-idea-criteria-0");if(c&&!c.value)SET(c,"The streak counter shows consecutive reading days");
    const r=await W$("#studio-idea-risk");if(r)SET(r,"R1");(await W$("#studio-idea-submit")).click();
    const o=await W$("#studio-idea-open[data-idea-mission]",120);return o?{ok:true,missionId:o.dataset.ideaMission}:{ok:false,e:"NO_MISSION",status:(document.getElementById("studio-idea-status")?.textContent??"").slice(0,200)}`);
  const missionId = idea?.missionId ?? null;
  const m0 = missionId ? await bridge("apiGet", `/v1/missions/${missionId}`) : null;
  record("UI wizard: the idea panel creates the first mission for the new project", idea?.ok && m0?.ok && m0.v?.mission?.projectId === projectId && m0.v?.mission?.status === "DRAFT", JSON.stringify({idea, status: m0?.v?.mission?.status ?? m0?.e}));
  if (!missionId) throw new Error("NO_MISSION");

  // 3) Manual task plan in #/work
  const plan = await ui(`(await W$("#studio-idea-open")).click();const t0=await W$("#plan-title-0",120);if(!t0)return {ok:false,e:"NO_PLAN_FORM",hash:location.hash};SET(t0,"Store reading days");
    (await W$("#plan-add")).click();const t1=await W$("#plan-title-1");SET(t1,"Show the streak counter");SET(await W$("#plan-deps-1"),"1");
    (await W$("#plan-submit")).click();const b=await W$("[data-task-inspect]",120);return {ok:!!b,hash:location.hash,n:document.querySelectorAll("[data-task-inspect]").length}`);
  const tasks = await bridge("apiGet", `/v1/missions/${missionId}/tasks`);
  const tl = tasks.v?.tasks ?? [];
  record("UI #/work: the manual plan form stores two tasks (task 2 depends on task 1)", plan?.ok && tl.length === 2 && tl[1].dependsOn?.[0] === tl[0].taskId, JSON.stringify({plan, n: tl.length}));

  // 4) Authorize: DRAFT -> PREFLIGHT, then PREFLIGHT -> AUTHORIZED through the confirmation dialog
  const mstat = async () => (await bridge("apiGet", `/v1/missions/${missionId}`)).v?.mission?.status ?? null;
  await ui(`const b=await W$("#tr-PREFLIGHT");if(b)b.click();return !!b`);
  for (let i = 0; i < 20 && await mstat() !== "PREFLIGHT"; i++) await sleep(250);
  const dlg = await ui(`const b=await W$("#tr-AUTHORIZED",120);if(!b)return {open:false,e:"NO_AUTHORIZE_BUTTON"};b.click();for(let i=0;i<40;i++){const d=document.getElementById("confirmDialog");if(d&&d.open)return {open:true};await new Promise(r=>setTimeout(r,250))}return {open:false}`);
  const beforeOk = await mstat();
  await ui(`const b=document.getElementById("confirmOk");if(b)b.click();return !!b`);
  let authorized = null; for (let i = 0; i < 40 && authorized !== "AUTHORIZED"; i++) { authorized = await mstat(); if (authorized !== "AUTHORIZED") await sleep(250); }
  record("UI: 'Authorize' asks for confirmation first, and only after accepting is the mission AUTHORIZED", dlg?.open === true && beforeOk === "PREFLIGHT" && authorized === "AUTHORIZED", JSON.stringify({dlg, beforeOk, authorized}));

  // 5) Start a run from the UI; the FAKE runner drives it to its terminal state
  const started = await ui(`const b=await W$("#run-start:not([disabled])",120);if(!b)return {ok:false,e:"RUN_START_DISABLED"};b.click();return {ok:true}`);
  let runId = null; for (let i = 0; i < 40 && !runId; i++) { const l = await bridge("apiGet", `/v1/work-runs?missionId=${missionId}`); runId = l.v?.runs?.[0]?.runId ?? null; if (!runId) await sleep(250); }
  record("UI: 'Start run' creates a run with the FAKE implementer/reviewer", started?.ok && /^run_[0-9a-f]{24}$/.test(runId ?? ""), JSON.stringify({started, runId}));
  if (!runId) throw new Error("NO_RUN");
  let detail = null; for (let i = 0; i < 240; i++) { detail = await bridge("apiGet", `/v1/work-runs/${runId}`); if (["AWAITING_APPROVAL", "BLOCKED", "FAILED"].includes(detail.v?.run?.status)) break; await sleep(500); }
  const run = detail?.v?.run, kinds = (run?.evidence ?? []).map(e => e.kind);
  record("server: the FAKE run reaches AWAITING_APPROVAL with VERIFY tests NOT_EXECUTED (no sandbox) and functionalAcceptance NOT_EXECUTED", run?.status === "AWAITING_APPROVAL" && run.executor?.implementer === "FAKE_IMPLEMENTER" && kinds.includes("VERIFY_TESTS_NOT_EXECUTED") && !kinds.includes("VERIFY_TESTS") && detail.v?.outcomes?.functionalAcceptance === "NOT_EXECUTED", JSON.stringify({status: run?.status, step: run?.step, reason: run?.reason, executor: run?.executor, fa: detail?.v?.outcomes?.functionalAcceptance}));

  // 6) Run card, test report row and the run's diff, read from the rendered UI after a fresh load
  await send("Page.reload", {ignoreCache: true}); await sleep(2500);
  const card = await ui(`location.hash="#/work";const m=await W$('[data-mission-id="${missionId}"]',120);if(!m)return {ok:false,e:"NO_MISSION_ROW"};m.click();
    const c=await W$('#run-card-${runId}[data-run-status]',120);if(!c)return {ok:false,e:"NO_RUN_CARD"};
    for(let i=0;i<80&&!c.querySelector("[data-run-test-result]:not([data-run-test-result='UNKNOWN'])");i++)await new Promise(r=>setTimeout(r,250));
    const t=c.querySelector("[data-run-test-result]");return {ok:true,status:c.dataset.runStatus,fakeReviewer:c.textContent.includes("FAKE_REVIEWER"),test:t?{kind:t.dataset.runTestResult,reason:t.dataset.runTestReason,text:t.textContent.slice(0,200)}:null,notVerified:!!c.querySelector("[data-axis-state='NOT_VERIFIED'],.badge-risk")}`);
  record("UI run card shows the run as AWAITING_APPROVAL with the FAKE reviewer identity", card?.ok && card.status === "AWAITING_APPROVAL" && card.fakeReviewer === true, JSON.stringify({ok: card?.ok, e: card?.e, status: card?.status, fakeReviewer: card?.fakeReviewer}));
  record("UI test report row says NOT_EXECUTED (SANDBOX_UNAVAILABLE), never a pass", card?.test?.kind === "NOT_EXECUTED" && /SANDBOX_UNAVAILABLE/.test(card.test.reason ?? "") && !/PRODUCT_VERIFIED|EXECUTED_VERIFIED/.test(card.test.kind), JSON.stringify(card?.test));
  const diff = await ui(`const b=await W$("#run-diff-show-${runId}",80);if(!b)return {ok:false,e:"NO_DIFF_BUTTON"};b.click();const v=await W$("#run-diff-view-${runId}",120);if(!v)return {ok:false,e:"NO_DIFF_VIEW",state:document.getElementById("run-diff-${runId}")?.dataset.runDiff??null};
    return {ok:true,state:document.getElementById("run-diff-${runId}").dataset.runDiff,files:[...document.querySelectorAll("#run-diff-files-${runId} [data-run-diff-file]")].map(x=>x.dataset.runDiffFile),added:[...v.querySelectorAll(".diff-add")].map(x=>x.textContent).slice(0,20)}`);
  record("UI run diff (base..head) lists the FAKE_EXECUTOR files and their added lines", diff?.ok && diff.state === "VERIFIED" && diff.files.includes("src/streak.js") && diff.files.includes("FAKE_EXECUTOR.md") && diff.added.some(l => l.includes("export const streak")), JSON.stringify(diff));
  finish(steps.every(s => s.ok) ? 0 : 1);
} catch (e) { record("harness", false, e.message); finish(1); }
