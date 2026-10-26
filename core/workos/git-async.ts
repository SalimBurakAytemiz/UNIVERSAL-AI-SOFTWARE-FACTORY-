// //TR: PAR-03: eşzamansız git. spawnGitSync ile aynı yalıtım (isolatedGitArgs/isolatedGitEnv: global/sistem config yok, boş hooksPath, kimlik/ssh değişkenleri düşer) ama olay döngüsünü bloklamaz: büyük bir klon veya engine commit'i sürerken diğer run'ların heartbeat'i akar. Runner (workspace/klon/diff/HEAD probu) ve builder-output (engine-owned commit) aynı çalıştırıcıyı kullanır. automation/lib/git-isolation.mjs korumalı olduğundan çalıştırıcı burada, o helper'ın izolasyon fonksiyonlarıyla kurulur.
import cp from "node:child_process";
import {isolatedGitArgs, isolatedGitEnv} from "../../automation/lib/git-isolation.mjs";
import type {SpawnedChild} from "./executors.js";

export interface GitRun { status: number | null; stdout: string; stderr: string; aborted?: boolean }

// //TR: `cp.execFile` varsayılan dışa aktarım nesnesinden çağrılır (testler "yavaş git" modelini bu nesne üzerinde vi.spyOn ile kurar). onSpawn: çocuk doğar doğmaz (eşzamanlı) yazar kaydı; fırlatırsa çocuk öldürülür ve status null döner (kayıtsız yazar bırakılmaz). timeoutMs: süre dolarsa SIGKILL, status null.
export function runGitAsync(cwd: string, args: string[], env: NodeJS.ProcessEnv, onSpawn?: (c: SpawnedChild) => void, o: {timeoutMs?: number; shouldAbort?: () => boolean} = {}): Promise<GitRun> {
  return new Promise(resolve => {
    let poll: NodeJS.Timeout | null = null;
    const settle = (r: GitRun) => { if (poll) { clearInterval(poll); poll = null; } resolve(r); };
    try {
      const group = onSpawn !== undefined && process.platform !== "win32"; // yazar git çocuğu kendi grubunda başlar (devirde öldürülebilsin)
      const child = cp.execFile("git", isolatedGitArgs(args), {cwd, env: isolatedGitEnv(env), encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...(o.timeoutMs !== undefined ? {timeout: o.timeoutMs, killSignal: "SIGKILL" as const} : {}), ...(group ? {detached: true} : {})}, (err, stdout, stderr) => {
        const code = err ? (err as cp.ExecFileException).code : 0;
        settle({status: typeof code === "number" ? code : null, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (err?.message ?? "")});
      });
      const kill = () => { try { if (group && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* zaten bitmiş */ } };
      if (onSpawn && child.pid) {
        try { onSpawn({pid: child.pid, pgid: group ? child.pid : null}); } catch (e) {
          kill();
          settle({status: null, stdout: "", stderr: `SPAWN_RECORD_FAILED: ${(e as Error).message}`});
        }
      }
      // //TR: #224 tur 3 (HB-R3-2): shouldAbort (Global Stop, stop(), kaybedilen lease) yoklanır; true olursa çocuk öldürülür ve `aborted` ile hemen dönülür. Yoksa uzun bir klon stop()'u klon süresi kadar bekletirdi.
      if (o.shouldAbort && child.pid) {
        const shouldAbort = o.shouldAbort;
        const check = () => { if (!shouldAbort()) return false; kill(); settle({status: null, stdout: "", stderr: "ABORTED", aborted: true}); return true; };
        if (!check()) { poll = setInterval(check, 100); poll.unref?.(); }
      }
    } catch (e) { settle({status: null, stdout: "", stderr: (e as Error).message}); }
  });
}
