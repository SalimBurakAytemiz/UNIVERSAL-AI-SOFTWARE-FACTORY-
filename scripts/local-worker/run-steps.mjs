// //TR: Yerel test işçisinin adım koşucusu: Windows Sandbox İÇİNDE (ağ kapalı, kaynak salt-okunur) kopyalanmış commit'te canonical config/validation.json adımlarından yalnız istenenleri, korumalı automation/lib/command-runner.mjs ile run-validation.mjs'in aynı sabit 600 sn adım sınırı ve log sınırlarıyla çalıştırır; teşhis için hatadan sonra da devam eder ve adım raporunu yazar. Sonuç PASS/FAIL'i kendisi ilan etmez; işçi rapordan türetir.
// Usage: node run-steps.mjs --repo <dir> --steps a,b --out <dir> [--runner-root <dir>]   Exit: 0 report written, 2 usage/config error.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL, fileURLToPath} from "node:url";

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const STEP_TIMEOUT_MS = 600000; // same fixed per-step limit as scripts/run-validation.mjs

export async function runSteps({repo, steps, out, runnerRoot = repo}) {
  const cfgRaw = fs.readFileSync(path.join(repo, "config/validation.json"));
  const cfg = JSON.parse(cfgRaw.toString("utf8"));
  const byId = new Map(cfg.steps.map(s => [s.id, s]));
  for (const id of steps) if (!STEP_ID.test(id) || !byId.has(id)) throw Object.assign(new Error(`UNKNOWN_STEP:${id}`), {code: 2});
  const lib = f => import(pathToFileURL(path.join(runnerRoot, "automation/lib", f)).href);
  const {runCommand} = await lib("command-runner.mjs");
  const {assertInstalledDependencyState} = await lib("dependency-install.mjs");
  fs.mkdirSync(out, {recursive: true});
  const report = {schema: "uasco.local-step-report/1", configSha256: crypto.createHash("sha256").update(cfgRaw).digest("hex"), platform: process.platform, steps: []};
  for (const id of steps) {
    const step = byId.get(id);
    if (Array.isArray(step.platforms) && !step.platforms.includes(process.platform)) { report.steps.push({id, status: "NOT_RUN_PLATFORM", exitCode: null, timedOut: false, durationMs: 0}); continue; }
    if (step.requiresDependencies) {
      try { assertInstalledDependencyState(repo); } catch { report.steps.push({id, status: "BLOCKED", exitCode: null, timedOut: false, durationMs: 0}); continue; }
    }
    const r = await runCommand({cmd: step.command[0], args: step.command.slice(1), cwd: repo, timeoutMs: STEP_TIMEOUT_MS, logFile: path.join(out, `step-${id}.log`),
      maxLogBytes: 5 * 1024 * 1024, maxCaptureBytes: 64 * 1024});
    report.steps.push({id, status: r.status === 0 && r.timedOut !== true ? "PASS" : "FAIL", exitCode: r.status ?? null, timedOut: r.timedOut === true, durationMs: r.durationMs ?? null});
  }
  fs.writeFileSync(path.join(out, "STEP_REPORT.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const repo = opt("--repo"), out = opt("--out"), steps = (opt("--steps") ?? "").split(",").filter(Boolean);
  if (!repo || !out || !steps.length) { console.error("usage: run-steps.mjs --repo <dir> --steps a,b --out <dir>"); process.exit(2); }
  try { const r = await runSteps({repo: path.resolve(repo), steps, out: path.resolve(out), runnerRoot: path.resolve(opt("--runner-root") ?? repo)}); console.log(`LOCAL_STEPS ${r.steps.map(s => `${s.id}=${s.status}`).join(" ")}`); }
  catch (e) { console.error(`LOCAL_STEPS_ERROR ${e.message}`); process.exit(2); }
}
