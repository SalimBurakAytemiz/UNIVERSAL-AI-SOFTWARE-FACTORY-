//TR: YALNIZ TANI (merge edilmez): config/validation.json'daki bir test adiminin dosya araligini KORUNAN automation/lib/command-runner.mjs runCommand ile (run-validation ile ayni sekilde: detached + pipe) calistirir; takilma olursa 60/150/300. saniyede surec agacini, wchan durumlarini ve log kuyrugunu yazdirir. Amac Linux'ta yalniz run-validation altinda gorulen takilmanin kaynagini bulmaktir.
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import {runCommand} from "../../automation/lib/command-runner.mjs";
const [id, a, b, ...extra] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync("config/validation.json", "utf8"));
const step = cfg.steps.find((s) => s.id === id);
const files = step.command.slice(3).slice(Number(a), Number(b));
const log = path.resolve(".ai/runtime/diag-runcmd.log");
fs.mkdirSync(path.dirname(log), {recursive: true});
console.log(`DIAG_RUNCMD ${id} [${a},${b}) files=${files.length} extra=${extra.join(" ")}\n${files.join("\n")}`);
let done = false;
const sample = (t) => setTimeout(() => {
  if (done) return;
  console.log(`\n===== SAMPLE @${t}s =====`);
  try { console.log(cp.execSync("ps -eo pid,ppid,pgid,sid,stat,etime,wchan:28,args --forest | grep -v ' ps -eo' | cut -c1-260", {encoding: "utf8"})); } catch (e) { console.log("ps failed", e.message); }
  try { const t2 = fs.readFileSync(log, "utf8").replace(/\x1b\[[0-9;]*m/g, ""); console.log("----- log tail -----\n" + t2.slice(-3000)); } catch {}
}, t * 1000).unref();
[60, 150, 300].forEach(sample);
const t0 = Date.now();
const r = await runCommand({cmd: process.execPath, args: [step.command[1], step.command[2], ...extra, ...files], cwd: process.cwd(), timeoutMs: 420000, logFile: log, maxLogBytes: 5 * 1024 * 1024, maxCaptureBytes: 512 * 1024});
done = true;
const out = (r.stdout || "").replace(/\x1b\[[0-9;]*m/g, "");
console.log(out.split("\n").filter((l) => /Test Files|Tests |×|FAIL/.test(l)).slice(-15).join("\n"));
console.log(`DIAG_RUNCMD_RESULT ${id} [${a},${b}) status=${r.status} timedOut=${r.timedOut} ms=${Date.now() - t0}`);
process.exit(0);
