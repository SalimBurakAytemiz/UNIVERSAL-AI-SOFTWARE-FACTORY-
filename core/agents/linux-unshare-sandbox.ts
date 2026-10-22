// //TR: Bu dosya ExecutionGate'in SandboxProvider sözleşmesi arkasında ÜCRETSİZ bir Linux sağlayıcısı sunar (util-linux unshare + setpriv + pivot_root; ek paket/bağımlılık yok). v2 (bağımsız saldırgan incelemesi sonrası): sandbox ana makinenin kök dosya sistemini GÖRMEZ — tmpfs bir kök kurulur, yalnız /usr,/bin,/lib* (+ node kurulum öneki) salt-okunur bağlanır, sentetik /etc, özel /dev (6 güvenli düğüm + özel /dev/shm), özel /tmp, salt-okunur maskelenmiş /proc ve /sys YOK; çalışma dizini /work olarak yazılabilir tek ana makine yoludur; pivot_root sonrası eski kök ayrılır (ana makine unix soketleri, ev dizinleri, sırlar görünmez). Tüm yetenekler bırakılır (CapEff=0, no_new_privs), iç içe user namespace kapatılır, her çalıştırmada mountinfo denetimi (ro olmayan bağ varsa 126 ile REDDEDER), proje ASLA pid 1 değildir (pid 1 küçük bir gözetmen: proje pdeathsig'ini temizleyemez), yardımcı araçlar sabit PATH ile çözülür. selfTest() bu özelliklerin HEPSİNİ kanarya/negatif sondalarla kanıtlamazsa sağlayıcı DOGRULANMAMIŞ kalır ve run()/spawn() ana makinede ASLA çalıştırmaz. Kalan sınırlar: kernel paylaşılır, seccomp ve cgroup yok, scratch için disk kotası yok, Windows NOT_IMPLEMENTED (bkz. docs/authority-requests/LANE-C-linux-sandbox-provider.md).
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import type {SpawnOptions} from "node:child_process";
import {runProcess} from "../workos/executors.js";
import type {ProcResult} from "../workos/executors.js";
import type {SandboxProvider, SandboxRunOptions} from "../workos/execution-gate.js";

export const LINUX_SANDBOX_ID = "linux-unshare-v2";
export interface LinuxSandboxOptions {
  unshareBinary?: string; platform?: NodeJS.Platform; addressSpaceKb?: number; maxFileBlocks?: number;
  /** Salt-okunur bağlanacak ek araç zinciri kökleri (varsayılan: node kurulum öneki, /usr altında değilse). */
  readOnlyRoots?: readonly string[];
}

const NS_FLAGS = ["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL"];
const HELPER_PATH = "/usr/sbin:/usr/bin:/sbin:/bin";
const REQUIRED_TOOLS = ["mount", "umount", "pivot_root", "setpriv", "mkdir", "ln", "awk", "sh"] as const;
// //TR: Kurulum betiği namespace İÇİNDE, pid 1 olarak çalışır. Argümanlar: SCRATCH CPU ADRES_KB DOSYA_BLOK KOK_BAGI EK_RO_KOKLER komut... Sıra: özel mount -> tmpfs kök -> ro bağlar -> sentetik /etc -> özel /dev -> özel /tmp -> /work (scratch) -> /proc (+ ro maskeler) -> iç içe userns kapat -> hepsini ro yap -> pivot_root + eski kökü ayır -> DENETİM (ro olmayan bağ varsa 126) -> ulimit -> yetenek bırak ve komutu pid 1 olmayan çocuk olarak çalıştır (gözetmen pid 1 kalır, stdin korunur).
const SETUP = [
  "set -eu; set -f",
  'CALLER_PATH="$PATH"; PATH=' + HELPER_PATH + "; export PATH",
  'SCRATCH="$1"; CPU="$2"; VMKB="$3"; FSZ="$4"; R="$5"; EXTRA_RO="$6"; shift 6',
  "mount --make-rprivate /",
  'mount -t tmpfs -o mode=755,size=16m tmpfs "$R"',
  'mkdir "$R/usr" "$R/etc" "$R/dev" "$R/proc" "$R/tmp" "$R/work"',
  'robind() { mkdir -p "$R$1"; mount --bind "$1" "$R$1"; mount -o remount,ro,nosuid,nodev,bind "$R$1"; }',
  "robind /usr",
  'for l in /bin /sbin /lib /lib32 /lib64 /libx32; do if [ -L "$l" ]; then ln -s "$(readlink "$l")" "$R$l"; elif [ -d "$l" ]; then robind "$l"; fi; done',
  'oldifs="$IFS"; IFS=:; for p in $EXTRA_RO; do if [ -n "$p" ] && [ -d "$p" ]; then robind "$p"; fi; done; IFS="$oldifs"',
  "printf 'root:x:0:0:root:/tmp:/bin/sh\\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\\n' > \"$R/etc/passwd\"",
  "printf 'root:x:0:\\nnogroup:x:65534:\\n' > \"$R/etc/group\"",
  "printf 'hosts: files\\npasswd: files\\ngroup: files\\n' > \"$R/etc/nsswitch.conf\"",
  'for f in /etc/ld.so.cache /etc/ld.so.conf /etc/localtime; do if [ -f "$f" ]; then : > "$R$f"; mount --bind "$f" "$R$f"; mount -o remount,ro,nosuid,nodev,bind "$R$f"; fi; done',
  'for d in /etc/alternatives /etc/ld.so.conf.d; do if [ -d "$d" ]; then robind "$d"; fi; done',
  'mount -t tmpfs -o mode=755,size=1m tmpfs "$R/dev"',
  'for n in null zero full random urandom tty; do : > "$R/dev/$n"; mount --bind "/dev/$n" "$R/dev/$n"; mount -o remount,ro,nosuid,noexec,bind "$R/dev/$n"; done',
  'mkdir "$R/dev/shm"; mount -t tmpfs -o mode=1777,size=64m,nosuid,nodev,noexec tmpfs "$R/dev/shm"',
  'ln -s /proc/self/fd "$R/dev/fd"; ln -s /proc/self/fd/0 "$R/dev/stdin"; ln -s /proc/self/fd/1 "$R/dev/stdout"; ln -s /proc/self/fd/2 "$R/dev/stderr"',
  'mount -t tmpfs -o mode=1777,size=256m,nosuid,nodev tmpfs "$R/tmp"',
  'mount --bind "$SCRATCH" "$R/work"; mount -o remount,nosuid,nodev,bind "$R/work"',
  'mount -t proc -o nosuid,nodev,noexec proc "$R/proc"',
  'for p in sys sysrq-trigger irq bus fs; do if [ -e "$R/proc/$p" ]; then mount --bind "$R/proc/$p" "$R/proc/$p"; mount -o remount,ro,nosuid,nodev,noexec,bind "$R/proc/$p"; fi; done',
  'for p in kcore keys timer_list sched_debug kmsg; do if [ -e "$R/proc/$p" ]; then mount --bind /dev/null "$R/proc/$p"; mount -o remount,ro,nosuid,noexec,bind "$R/proc/$p"; fi; done',
  "echo 0 > /proc/sys/user/max_user_namespaces 2>/dev/null || true",
  'for m in "$R/proc" "$R/dev" "$R"; do mount -o remount,ro,bind "$m"; done',
  'cd "$R"; pivot_root . .; umount -l .; cd /',
  "bad=$(awk '{mp=$5; if (mp==\"/work\"||mp==\"/tmp\"||mp==\"/dev/shm\") next; if ($6 !~ /(^|,)ro(,|$)/) print mp}' /proc/self/mountinfo)",
  '[ -z "$bad" ] || { echo "SANDBOX_AUDIT_FAILED: $bad" >&2; exit 126; }',
  'ulimit -t "$CPU" && ulimit -v "$VMKB" && ulimit -f "$FSZ" || exit 126',
  'export TMPDIR=/tmp HOME=/tmp PATH="$CALLER_PATH"',
  "cd /work",
  "exec setpriv --no-new-privs --bounding-set=-all --inh-caps=-all sh -c 'exec 3<&0; \"$@\" <&3 3<&- & c=$!; wait $c; exit $?' sh \"$@\""
].join("\n");

const now = () => new Date().toISOString();
function refusal(argv: string[], why: string): ProcResult {
  const t = now();
  return {argv, exitCode: null, stdout: "", stderr: `SANDBOX_NOT_VERIFIED: ${why}`, startedAt: t, endedAt: t, timedOut: false, aborted: false, spawnError: true};
}
// cwd yalnız güvenli bir mutlak, kanonik dizin olabilir (boşluk/ters bölü/satır sonu reddedilir; kökün kendisi olamaz).
function cwdProblem(cwd: unknown): string | null {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd === "/") return "CWD_NOT_ABSOLUTE_OR_ROOT";
  if (/[\s\\:]/.test(cwd)) return "CWD_UNSUPPORTED_CHARACTERS";
  try { if (fs.realpathSync(cwd) !== cwd || !fs.statSync(cwd).isDirectory()) return "CWD_NOT_CANONICAL_DIRECTORY"; } catch { return "CWD_MISSING"; }
  return null;
}
const under = (parent: string, child: string): boolean => child === parent || child.startsWith(parent.endsWith("/") ? parent : parent + "/");
function resolveTool(name: string): string | null {
  for (const dir of HELPER_PATH.split(":")) { const p = path.join(dir, name); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* sonraki */ } }
  return null;
}

export class LinuxUnshareSandboxProvider implements SandboxProvider {
  readonly id = LINUX_SANDBOX_ID;
  private verified = false;
  private probing: Promise<{ok: boolean; detail?: string}> | null = null;
  private shell = "/bin/sh";
  constructor(private readonly o: LinuxSandboxOptions = {}) {}
  private get unshare(): string { return this.o.unshareBinary ?? resolveTool("unshare") ?? "/usr/bin/unshare"; }
  private extraRoots(): string[] {
    const roots = this.o.readOnlyRoots ? [...this.o.readOnlyRoots] : [path.dirname(path.dirname(process.execPath))];
    return [...new Set(roots.filter(r => path.isAbsolute(r) && r !== "/" && !/[:\s\\]/.test(r) && !under("/usr", r) && fs.existsSync(r)))].sort();
  }
  /** Yeni kök için ana makinede VAR olan ve hiçbir kaynak yolun (scratch, ek kök) altında/üstünde olmayan bir bağlama noktası. */
  private newRootMount(cwd: string, extras: string[]): string | null {
    for (const c of ["/mnt", "/srv", "/media"]) {
      try { if (!fs.statSync(c).isDirectory()) continue; } catch { continue; }
      if ([cwd, ...extras].every(s => !under(c, s) && !under(s, c))) return c;
    }
    return null;
  }
  private args(cwd: string, timeoutMs: number, command: string[]): string[] | null {
    const extras = this.extraRoots(), root = this.newRootMount(cwd, extras);
    if (!root) return null;
    const cpu = Math.max(1, Math.ceil(timeoutMs / 1000)) + 5;
    return [...NS_FLAGS, this.shell, "-c", SETUP, "sh", cwd, String(cpu), String(this.o.addressSpaceKb ?? 16 * 1024 * 1024), String(this.o.maxFileBlocks ?? 2 * 1024 * 1024), root, extras.join(":"), ...command];
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
    if (!opts.env || typeof opts.env !== "object") throw new Error("SANDBOX_REFUSED: ENV_REQUIRED"); // asla ana makine process.env'i miras alınmaz
    const a = this.args(cwd, 600_000, [command, ...args]);
    if (!a) throw new Error("SANDBOX_REFUSED: NO_NEW_ROOT_MOUNTPOINT");
    return cp.spawn(this.unshare, a, {...opts, shell: false});
  }
  private exec(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    const problem = cwdProblem(opts.cwd);
    if (problem) return Promise.resolve(refusal(argv, problem));
    if (!Array.isArray(argv) || argv.length === 0 || argv.some(a => typeof a !== "string")) return Promise.resolve(refusal(argv ?? [], "ARGV_INVALID"));
    if (!opts.env || typeof opts.env !== "object") return Promise.resolve(refusal(argv, "ENV_REQUIRED"));
    const a = this.args(opts.cwd, opts.timeoutMs, argv);
    if (!a) return Promise.resolve(refusal(argv, "NO_NEW_ROOT_MOUNTPOINT"));
    return runProcess([this.unshare, ...a], {cwd: opts.cwd, env: opts.env, timeoutMs: opts.timeoutMs, input: opts.input, shouldAbort: opts.shouldAbort});
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
    for (const t of REQUIRED_TOOLS) if (!resolveTool(t)) return {ok: false, detail: `REQUIRED_TOOL_MISSING_${t.toUpperCase()}`};
    this.shell = resolveTool("sh") ?? "/bin/sh";
    const ws = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-selftest-"));
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-sbx-outside-"));
    const hostShm = path.join("/dev/shm", `uasco-sbx-canary-${process.pid}-${Date.now()}`), shmProbe = `uasco-sbx-private-${process.pid}-${Date.now()}`;
    const env: NodeJS.ProcessEnv = {PATH: HELPER_PATH};
    let server: net.Server | null = null, connections = 0;
    try {
      // Ana makine kanaryaları: dosya, dinleyen unix soketi, host /dev/shm dosyası. Sandbox bunların HİÇBİRİNİ görmemeli.
      const canary = path.join(outside, "canary.txt"); fs.writeFileSync(canary, "HOST-SECRET");
      const sock = path.join(outside, "s.sock");
      server = net.createServer(s => { connections++; s.destroy(); });
      await new Promise<void>((res, rej) => { server!.once("error", rej); server!.listen(sock, () => res()); });
      try { fs.writeFileSync(hostShm, "HOST-SHM"); } catch { /* /dev/shm yoksa o kanarya atlanır */ }
      const pos = await this.exec(["sh", "-c", "echo sandbox_ok"], {cwd: ws, env, timeoutMs: 20_000});
      if (pos.exitCode !== 0 || !pos.stdout.includes("sandbox_ok")) return {ok: false, detail: pos.stderr.includes("SANDBOX_AUDIT_FAILED") ? "SELFTEST_MOUNT_AUDIT_FAILED" : "SELFTEST_NAMESPACES_UNAVAILABLE"};
      const probe = [
        '[ "$PPID" = 1 ] && [ "$$" != 1 ] && echo supervisor_ok',
        `[ ! -e ${JSON.stringify(canary)} ] && [ ! -e ${JSON.stringify(sock)} ] && [ ! -e ${JSON.stringify(hostShm)} ] && echo host_fs_hidden`,
        '[ ! -e /home ] && [ ! -e /root ] && [ ! -e /run ] && [ ! -e /var ] && [ ! -e /sys ] && [ ! -e /mnt ] && echo host_dirs_hidden',
        '[ ! -w /usr ] && ! touch /usr/.sbx 2>/dev/null && ! touch /etc/.sbx 2>/dev/null && ! touch /.sbx 2>/dev/null && ! touch /dev/.sbx 2>/dev/null && echo root_ro_ok',
        `touch p && echo q > /tmp/t && echo s > /dev/shm/${shmProbe} && echo scratch_ok`,
        "! echo 60 > /proc/sys/vm/swappiness 2>/dev/null && ! echo x > /proc/sys/kernel/core_pattern 2>/dev/null && ! echo b > /proc/sysrq-trigger 2>/dev/null && echo proc_sys_ro_ok",
        "awk '{mp=$5; if (mp==\"/work\"||mp==\"/tmp\"||mp==\"/dev/shm\") next; if ($6 !~ /(^|,)ro(,|$)/) bad=1} END{exit bad}' /proc/self/mountinfo && echo mount_audit_ok",
        "[ \"$(awk '/^(CapInh|CapPrm|CapEff|CapBnd|CapAmb):/{print $2}' /proc/self/status | sort -u)\" = 0000000000000000 ] && grep -q '^NoNewPrivs:.1' /proc/self/status && echo caps_dropped_all",
        '[ -z "$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " " | grep -v "^lo$")" ] && echo net_none',
        "! unshare -U true 2>/dev/null && echo nested_userns_blocked",
        '[ "$(ls /proc | grep -c "^[0-9]")" -lt 20 ] && echo pid_ns_private'
      ].join("; ");
      const iso = await this.exec(["sh", "-c", probe], {cwd: ws, env, timeoutMs: 20_000});
      for (const token of ["supervisor_ok", "host_fs_hidden", "host_dirs_hidden", "root_ro_ok", "scratch_ok", "proc_sys_ro_ok", "mount_audit_ok", "caps_dropped_all", "net_none", "nested_userns_blocked", "pid_ns_private"]) if (!iso.stdout.includes(token)) return {ok: false, detail: `SELFTEST_${token.toUpperCase()}_FAILED`};
      if (!fs.existsSync(path.join(ws, "p"))) return {ok: false, detail: "SELFTEST_SCRATCH_NOT_HOST_VISIBLE"};
      if (fs.existsSync(hostShm) && fs.readFileSync(hostShm, "utf8") !== "HOST-SHM") return {ok: false, detail: "SELFTEST_HOST_SHM_TAMPERED"};
      if (fs.readdirSync("/dev/shm").some(n => n === shmProbe)) return {ok: false, detail: "SELFTEST_SHM_NOT_PRIVATE"};
      if (connections !== 0) return {ok: false, detail: "SELFTEST_HOST_SOCKET_REACHED"};
      // Süreç ağacı: SIGTERM'i yok sayan, setsid yapan, pdeathsig'ini temizlemeye çalışan ve zaman aşımından sonra dosya yazmayı deneyen düşman çocuk.
      const evil = 'perl -e \'syscall(157,1,0); $SIG{TERM}="IGNORE"; $SIG{HUP}="IGNORE"; setpgrp; sleep 3; open(F,">late.txt"); print F 1; close F; exec("sleep","62.41")\' & exec sleep 62.41';
      const fallback = 'trap "" TERM HUP; (sleep 3; : > late.txt; exec sleep 62.41) & exec sleep 62.41';
      const t0 = Date.now();
      const to = await this.exec(["sh", "-c", `if command -v perl >/dev/null 2>&1; then ${evil}; else ${fallback}; fi`], {cwd: ws, env, timeoutMs: 1500});
      if (!to.timedOut || Date.now() - t0 > 15_000) return {ok: false, detail: "SELFTEST_TIMEOUT_NOT_ENFORCED"};
      await new Promise(r => setTimeout(r, 4500));
      if (fs.existsSync(path.join(ws, "late.txt"))) return {ok: false, detail: "SELFTEST_CHILD_SURVIVED_TIMEOUT"};
      for (let i = 0; i < 20 && hostHasProcess("62.41"); i++) await new Promise(r => setTimeout(r, 150));
      if (hostHasProcess("62.41")) return {ok: false, detail: "SELFTEST_PROCESS_TREE_SURVIVED"};
      // stdin geçişi (runner test girdisi verebilir)
      const sin = await this.exec(["sh", "-c", "read -r l; echo got=$l"], {cwd: ws, env, timeoutMs: 20_000, input: "PIPED\n"});
      if (!sin.stdout.includes("got=PIPED")) return {ok: false, detail: "SELFTEST_STDIN_NOT_FORWARDED"};
      return {ok: true};
    } finally {
      try { server?.close(); } catch { /* kapalı */ }
      fs.rmSync(ws, {recursive: true, force: true}); fs.rmSync(outside, {recursive: true, force: true}); fs.rmSync(hostShm, {force: true});
    }
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
