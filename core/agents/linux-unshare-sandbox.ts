// //TR: Bu dosya ExecutionGate'in SandboxProvider sözleşmesi arkasında ÜCRETSİZ bir Linux sağlayıcısı sunar (util-linux unshare + setpriv; ek paket/bağımlılık yok): kullanıcı+ağ+pid+ipc+uts+mount namespace, ağ yok, kök dosya sistemi salt-okunur, yalnız çalışma dizini (scratch) yazılabilir, tüm yetenekler bırakılır (CapEff=0, no_new_privs), CPU/dosya/adres alanı ulimit'leri, zaman aşımında süreç ağacı öldürme. selfTest() bu özelliklerin HEPSİNİ negatif testlerle kanıtlamazsa sağlayıcı DOGRULANMAMIŞ kalır ve run()/spawn() ana makinede ASLA çalıştırmaz (host-exec reddi). Windows: NOT_IMPLEMENTED. Bu sağlayıcı kernel'i paylaşır, seccomp ve cgroup bellek sınırı yoktur (bkz. docs/authority-requests/LANE-C-linux-sandbox-provider.md).
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {SpawnOptions} from "node:child_process";
import {runProcess} from "../workos/executors.js";
import type {ProcResult} from "../workos/executors.js";
import type {SandboxProvider, SandboxRunOptions} from "../workos/execution-gate.js";

export const LINUX_SANDBOX_ID = "linux-unshare-v1";
export interface LinuxSandboxOptions { unshareBinary?: string; setprivBinary?: string; platform?: NodeJS.Platform; addressSpaceKb?: number; maxFileBlocks?: number }

const NS_FLAGS = ["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--mount-proc", "--fork", "--kill-child=SIGKILL"];
// //TR: Kurulum betiği namespace İÇİNDE çalışır. Argümanlar: cwd cpuSaniye adresKb dosyaBlok komut... Betik çalışma dizinini kendi bağlama noktası yapar, diğer tüm bağlama noktalarını salt-okunur yapar (proc/dev/sys hariç), TMPDIR'i scratch altına koyar, yetenekleri bırakıp komutu exec eder. ro-remount hatası sessiz kalabilir; bu yüzden selfTest salt-okunurluğu ve CapEff=0'ı ayrıca KANITLAR.
const SETUP = [
  "set -eu",
  'cwd="$1"; cpu="$2"; vmkb="$3"; fsz="$4"; shift 4',
  "mount --make-rprivate /",
  'mount --bind "$cwd" "$cwd"',
  'while read -r _ _ _ _ mp _; do case "$mp" in "$cwd"|/proc*|/dev*|/sys*|*\\\\*) continue;; esac; mount -o remount,ro,bind "$mp" 2>/dev/null || true; done < /proc/self/mountinfo',
  'mkdir -p "$cwd/.sbx-tmp"',
  'ulimit -t "$cpu" || exit 126',
  'ulimit -v "$vmkb" || exit 126',
  'ulimit -f "$fsz" || exit 126',
  'export TMPDIR="$cwd/.sbx-tmp"',
  'cd "$cwd"',
  'exec setpriv --no-new-privs --bounding-set=-all --inh-caps=-all "$@"'
].join("\n");

const now = () => new Date().toISOString();
function refusal(argv: string[], why: string): ProcResult {
  const t = now();
  return {argv, exitCode: null, stdout: "", stderr: `SANDBOX_NOT_VERIFIED: ${why}`, startedAt: t, endedAt: t, timedOut: false, aborted: false, spawnError: true};
}
// cwd yalnız güvenli bir mutlak yol olabilir: mountinfo kaçışları (boşluk/ters bölü/satır sonu) betikte eşleşmez ve scratch yanlışlıkla salt-okunur kalırdı -> reddedilir.
function cwdProblem(cwd: unknown): string | null {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd === "/") return "CWD_NOT_ABSOLUTE_OR_ROOT";
  if (/[\s\\]/.test(cwd)) return "CWD_UNSUPPORTED_CHARACTERS";
  try { if (fs.realpathSync(cwd) !== cwd || !fs.statSync(cwd).isDirectory()) return "CWD_NOT_CANONICAL_DIRECTORY"; } catch { return "CWD_MISSING"; }
  return null;
}

export class LinuxUnshareSandboxProvider implements SandboxProvider {
  readonly id = LINUX_SANDBOX_ID;
  private verified = false;
  private probing: Promise<{ok: boolean; detail?: string}> | null = null;
  constructor(private readonly o: LinuxSandboxOptions = {}) {}
  private get unshare(): string { return this.o.unshareBinary ?? "unshare"; }
  private args(cwd: string, timeoutMs: number, command: string[]): string[] {
    const cpu = Math.max(1, Math.ceil(timeoutMs / 1000)) + 5;
    return [...NS_FLAGS, "sh", "-c", SETUP, "sh", cwd, String(cpu), String(this.o.addressSpaceKb ?? 16 * 1024 * 1024), String(this.o.maxFileBlocks ?? 2 * 1024 * 1024), ...command];
  }
  /** Doğrulanmamış sağlayıcı hiçbir şey çalıştırmaz (ana makineye geri düşüş yok). */
  run(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    if (!this.verified) return Promise.resolve(refusal(argv, "selfTest has not passed"));
    return this.exec(argv, opts);
  }
  spawn(command: string, args: string[], opts: SpawnOptions): cp.ChildProcess {
    if (!this.verified) throw new Error("SANDBOX_NOT_VERIFIED: selfTest has not passed");
    const cwd = typeof opts.cwd === "string" ? opts.cwd : "";
    const problem = cwdProblem(cwd);
    if (problem) throw new Error(`SANDBOX_REFUSED: ${problem}`);
    return cp.spawn(this.unshare, this.args(cwd, 600_000, [command, ...args]), {...opts, shell: false});
  }
  private exec(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    const problem = cwdProblem(opts.cwd);
    if (problem) return Promise.resolve(refusal(argv, problem));
    if (!Array.isArray(argv) || argv.length === 0 || argv.some(a => typeof a !== "string")) return Promise.resolve(refusal(argv ?? [], "ARGV_INVALID"));
    return runProcess([this.unshare, ...this.args(opts.cwd, opts.timeoutMs, argv)], {cwd: opts.cwd, env: opts.env, timeoutMs: opts.timeoutMs, input: opts.input, shouldAbort: opts.shouldAbort});
  }
  selfTest(): Promise<{ok: boolean; detail?: string}> {
    return this.probing ??= this.probe().then(r => { this.verified = r.ok; return r; }, () => { this.verified = false; return {ok: false, detail: "SELFTEST_ERROR"}; });
  }
  private async probe(): Promise<{ok: boolean; detail?: string}> {
    if ((this.o.platform ?? process.platform) !== "linux") return {ok: false, detail: "PLATFORM_NOT_LINUX_NOT_IMPLEMENTED"};
    const v = cp.spawnSync(this.unshare, ["--version"], {encoding: "utf8"});
    const m = /(\d+)\.(\d+)/.exec(String(v.stdout ?? ""));
    if (v.error || v.status !== 0 || !m) return {ok: false, detail: "UNSHARE_MISSING"};
    if (Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 35)) return {ok: false, detail: "UNSHARE_TOO_OLD"};
    const sp = cp.spawnSync(this.o.setprivBinary ?? "setpriv", ["--version"], {encoding: "utf8"});
    if (sp.error || sp.status !== 0) return {ok: false, detail: "SETPRIV_MISSING"};
    const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-selftest-"));
    const env: NodeJS.ProcessEnv = {PATH: process.env.PATH ?? "/usr/bin:/bin"};
    try {
      const pos = await this.exec(["sh", "-c", "echo sandbox_ok"], {cwd: ws, env, timeoutMs: 20_000});
      if (pos.exitCode !== 0 || !pos.stdout.includes("sandbox_ok")) return {ok: false, detail: "SELFTEST_NAMESPACES_UNAVAILABLE"};
      // Negatif kanıtlar tek betikte: pid 1, kök salt-okunur, scratch yazılabilir, remount rw reddi, yetenek yok, ağ arayüzü yok.
      const probe = [
        '[ "$$" = 1 ] && echo pid_ns_ok',
        'touch p && touch "$TMPDIR/t" && echo scratch_ok',
        '! touch /usr/.sbx 2>/dev/null && ! touch /etc/.sbx 2>/dev/null && ! touch "$(dirname "$PWD")/.sbx" 2>/dev/null && echo root_ro_ok',
        '! mount -o remount,rw / 2>/dev/null && echo remount_denied',
        '[ "$(awk \'/^CapEff:/{print $2}\' /proc/self/status)" = 0000000000000000 ] && echo caps_dropped',
        '[ -z "$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " " | grep -v "^lo$")" ] && echo net_none'
      ].join("; ");
      const iso = await this.exec(["sh", "-c", probe], {cwd: ws, env, timeoutMs: 20_000});
      for (const token of ["pid_ns_ok", "scratch_ok", "root_ro_ok", "remount_denied", "caps_dropped", "net_none"]) if (!iso.stdout.includes(token)) return {ok: false, detail: `SELFTEST_${token.toUpperCase()}_FAILED`};
      if (!fs.existsSync(path.join(ws, "p"))) return {ok: false, detail: "SELFTEST_SCRATCH_NOT_HOST_VISIBLE"};
      const t0 = Date.now();
      const to = await this.exec(["sh", "-c", "sleep 61.37 & sleep 61.37"], {cwd: ws, env, timeoutMs: 1500});
      if (!to.timedOut || Date.now() - t0 > 15_000) return {ok: false, detail: "SELFTEST_TIMEOUT_NOT_ENFORCED"};
      for (let i = 0; i < 20 && hostHasProcess("61.37"); i++) await new Promise(r => setTimeout(r, 150));
      if (hostHasProcess("61.37")) return {ok: false, detail: "SELFTEST_PROCESS_TREE_SURVIVED"};
      return {ok: true};
    } finally { fs.rmSync(ws, {recursive: true, force: true}); }
  }
}

/** Ana makinede (bu namespace'te) argv ELEMANLARINDAN biri tam olarak belirtece eşit olan süreç var mı (yalnız selfTest/test için; komut metni içinde geçen belirteç sayılmaz). */
export function hostHasProcess(token: string): boolean {
  try {
    for (const d of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try { if (fs.readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").includes(token) && Number(d) !== process.pid) return true; } catch { /* süreç bitti */ }
    }
  } catch { /* /proc yok */ }
  return false;
}
