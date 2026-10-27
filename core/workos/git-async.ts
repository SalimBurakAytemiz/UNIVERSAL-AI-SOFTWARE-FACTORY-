// //TR: PAR-03: eşzamansız git. spawnGitSync ile aynı yalıtım (isolatedGitArgs/isolatedGitEnv: global/sistem config yok, boş hooksPath, kimlik/ssh değişkenleri düşer) ama olay döngüsünü bloklamaz: büyük bir klon veya engine commit'i sürerken diğer run'ların heartbeat'i akar. Runner (workspace/klon/diff/HEAD probu) ve builder-output (engine-owned commit) aynı çalıştırıcıyı kullanır.
import cp from "node:child_process";
import {isolatedGitArgs, isolatedGitEnv} from "../../automation/lib/git-isolation.mjs";
import type {SpawnedChild} from "./executors.js";

export interface GitRun { status: number | null; stdout: string; stderr: string; aborted?: boolean }

const MAX_BUFFER = 64 * 1024 * 1024;

// //TR: `cp.spawn` varsayılan dışa aktarım nesnesinden çağrılır (testler "yavaş git" modelini bu nesne üzerinde vi.spyOn ile kurar). #224 tur 3: önceki sürüm `cp.execFile(..., {detached: true})` kullanıyordu; execFile `detached` seçeneğini YOK SAYAR (yalnız cwd/env/uid/gid/shell/signal/windowsHide'ı spawn'a iletir), yani yazar git çocuğu hiçbir zaman kendi süreç grubunda başlamadı ve kayıtlı pgid var olmayan bir gruptu (devir/abort/çıkış öldürmeleri ESRCH ile sessizce boşa giderdi). Burada spawn kullanılır (detached gerçekten uygulanır) ve execFile'ın çıktı toplama/maxBuffer/zaman aşımı davranışı korunur.
// onSpawn: çocuk doğar doğmaz (eşzamanlı) yazar kaydı; fırlatırsa çocuk öldürülür ve status null döner (kayıtsız yazar bırakılmaz). timeoutMs: süre dolarsa SIGKILL, status null. shouldAbort: 100 ms'de bir yoklanır; true olursa çocuk (Windows'ta ağaç) öldürülür ve `aborted` ile hemen dönülür.
export function runGitAsync(cwd: string, args: string[], env: NodeJS.ProcessEnv, onSpawn?: (c: SpawnedChild) => void, o: {timeoutMs?: number; shouldAbort?: () => boolean; hardTimeout?: boolean} = {}): Promise<GitRun> {
  return new Promise(resolve => {
    let poll: NodeJS.Timeout | null = null, timer: NodeJS.Timeout | null = null, done = false;
    const settle = (r: GitRun) => {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    try {
      const group = (onSpawn !== undefined || o.hardTimeout === true) && process.platform !== "win32"; // yazar git çocuğu kendi süreç grubunda başlar (devirde öldürülebilsin)
      const child = cp.spawn("git", isolatedGitArgs(args), {cwd, env: isolatedGitEnv(env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...(group ? {detached: true} : {})});
      // //TR: Windows'ta `git` bir sarmalayıcıdır (alt süreçleri ve git-remote-*/index-pack yardımcıları vardır): yalnız kök pid'i öldürmek yardımcıları çalışır bırakırdı; implementer'ın killTree'si gibi taskkill /T /F ile AĞAÇ öldürülür. POSIX'te süreç grubu (onSpawn varsa) ya da çocuk.
      const kill = () => {
        try {
          if (process.platform === "win32" && child.pid) cp.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {windowsHide: true, stdio: "ignore"});
          else if (group && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { /* zaten bitmiş */ }
      };
      // //TR: #224 tur 3 (GA-MAXBUF-1 + delta review): execFile gibi AKIŞ BAŞINA, HAM bayt sayılır (Buffer.length; çıktı çözülmeden önce: UTF-8 olmayan bayt U+FFFD'ye çevrilip üç bayt sayılsaydı geçerli üst sınır ~21 MiB olurdu) ve taşma SONUÇ için son kararlıdır: git çıktıyı yazıp zaten çıkmış olsa bile (kill() boşa gider) kesilmiş çıktı status 0 ile DÖNMEZ; aksi halde boyutlandırılmış bir diff, kesilmiş haliyle sır taramasından geçerdi (fail-open). Taşma = status null. Taşma bir kez işaretlenir, çocuk bir kez öldürülür ve sonraki parçalar atılır; çıktı close'ta tek seferde çözülür.
      const outChunks: Buffer[] = [], errChunks: Buffer[] = [];
      let outBytes = 0, errBytes = 0, overflow = false;
      const collect = (which: "out" | "err") => (chunk: Buffer) => {
        if (overflow) return;
        if (which === "out") outBytes += chunk.length; else errBytes += chunk.length;
        if ((which === "out" ? outBytes : errBytes) > MAX_BUFFER) { overflow = true; kill(); return; }
        (which === "out" ? outChunks : errChunks).push(chunk);
      };
      child.stdout?.on("data", collect("out"));
      child.stderr?.on("data", collect("err"));
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(); // //TR: git'in stdin okuyan bir komutu sonsuza dek beklemesin (EOF)
      child.on("error", e => settle({status: null, stdout: "", stderr: e.message}));
      child.on("close", (code, signal) => {
        if (overflow) { settle({status: null, stdout: "", stderr: "maxBuffer exceeded"}); return; }
        const stdout = Buffer.concat(outChunks).toString("utf8"), stderr = Buffer.concat(errChunks).toString("utf8");
        settle({status: typeof code === "number" ? code : null, stdout, stderr: stderr || (signal ? `terminated by ${signal}` : "")});
      });
      // //TR: hardTimeout (readiness probe, B-NEXT-1): süre dolunca çocuk (POSIX: tüm süreç grubu) öldürülür VE 'close' BEKLENMEDEN status null ile dönülür; boru tutan bir torun 'close'u geciktirip bütçeyi yutamaz.
      if (o.timeoutMs !== undefined) timer = setTimeout(o.hardTimeout === true ? () => { kill(); settle({status: null, stdout: "", stderr: "TIMEOUT"}); } : kill, o.timeoutMs);
      if (onSpawn && child.pid) {
        try { onSpawn({pid: child.pid, pgid: group ? child.pid : null}); } catch (e) {
          kill();
          settle({status: null, stdout: "", stderr: `SPAWN_RECORD_FAILED: ${(e as Error).message}`});
        }
      }
      // //TR: #224 tur 3 (HB-R3-2): shouldAbort (Global Stop, stop(), kaybedilen lease) yoklanır; true olursa çocuk öldürülür ve `aborted` ile hemen dönülür. Yoksa uzun bir klon stop()'u klon süresi kadar bekletirdi.
      if (o.shouldAbort && child.pid && !done) {
        const shouldAbort = o.shouldAbort;
        // //TR: İlk yoklama da zamanlayıcıdandır (hemen değil): abort baştan açıksa bile her çocuk bir makro-görev sonra bırakılır; aksi halde art arda abort edilen adımlar olay döngüsünü hiç bırakmadan dönerdi.
        poll = setInterval(() => { if (!shouldAbort()) return; kill(); settle({status: null, stdout: "", stderr: "ABORTED", aborted: true}); }, 100);
        poll.unref?.();
      }
    } catch (e) { settle({status: null, stdout: "", stderr: (e as Error).message}); }
  });
}
