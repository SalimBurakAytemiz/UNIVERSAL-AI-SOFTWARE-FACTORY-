//TR: YALNIZ TANI (merge edilmez): once bir "on" adim kumesini (tests kabugunun tek dosyasi, tum tests kabugu veya tum statik adimlar) KORUNAN runCommand ile calistirir, geride kalan dosya/surec izlerini yazdirir, sonra tests-2'yi ayni runCommand ile calistirip takilmayi ve surec agacini raporlar. Amac Linux'ta yalniz tam run-validation icinde gorulen tests-2 takilmasinin onceki adimlardan kalan durumla iliskisini kanitlamaktir.
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import {runCommand} from "../../automation/lib/command-runner.mjs";
const pre = process.argv[2];
const cfg = JSON.parse(fs.readFileSync("config/validation.json", "utf8"));
const sh = (c) => { try { return cp.execSync(c, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}); } catch (e) { return `(${c} failed: ${e.message.split("\n")[0]})`; } };
const run = async (cmd, args, ms, label) => { const t = Date.now(); const r = await runCommand({cmd, args, cwd: process.cwd(), timeoutMs: ms, logFile: path.resolve(`.ai/runtime/diag-${label}.log`), maxLogBytes: 5 * 1024 * 1024, maxCaptureBytes: 512 * 1024}); console.log(`DIAG_SEQ ${label} status=${r.status} timedOut=${r.timedOut} ms=${Date.now() - t}`); return r; };
const snapshot = (label) => {
  console.log(`\n===== LEFTOVERS after ${label} =====`);
  console.log(sh("git status --porcelain --untracked-files=all | grep -v '^?? .ai/runtime/diag-' | head -60"));
  console.log(sh("ls -la .ai/runtime 2>/dev/null | head -40"));
  console.log(sh("ps -eo pid,ppid,pgid,stat,etime,wchan:25,args --forest | grep -v -E ' ps -eo|Runner\\.|actions-runner|hosted-compute|provjobd|sshd|systemd|containerd|dockerd|walinux|python3 -u' | cut -c1-220 | tail -40"));
  console.log(sh("ls -la /tmp | head -40"));
};
if (pre === "static") { for (const s of cfg.steps) { if (s.id === "tests") break; await run(s.command[0] === "node" ? process.execPath : s.command[0], s.command.slice(1), 600000, s.id); } }
else if (pre === "tests") { const s = cfg.steps.find((x) => x.id === "tests"); await run(process.execPath, s.command.slice(1), 600000, "tests"); }
else if (pre !== "none") { const s = cfg.steps.find((x) => x.id === "tests"); await run(process.execPath, [s.command[1], s.command[2], pre], 600000, "pre-" + path.basename(pre)); }
snapshot(pre);
let done = false;
for (const t of [60, 150]) setTimeout(() => { if (done) return; console.log(`\n===== HANG SAMPLE @${t}s =====`); console.log(sh("ps -eo pid,ppid,pgid,stat,etime,wchan:25,args --forest | grep -E 'node|git|sh ' | grep -v ' ps -eo' | cut -c1-240 | tail -60")); try { console.log(fs.readFileSync(".ai/runtime/diag-tests-2.log", "utf8").replace(/\x1b\[[0-9;]*m/g, "").slice(-2500)); } catch {} }, t * 1000).unref();
const s2 = cfg.steps.find((x) => x.id === "tests-2");
const r = await run(process.execPath, s2.command.slice(1), 240000, "tests-2");
done = true;
console.log((r.stdout || "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /Test Files|Tests |×/.test(l)).slice(-10).join("\n"));
console.log(`DIAG_SEQ_RESULT pre=${pre} tests2_timedOut=${r.timedOut} status=${r.status}`);
process.exit(0);
