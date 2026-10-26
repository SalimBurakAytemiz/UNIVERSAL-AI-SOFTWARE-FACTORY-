//TR: Bu dosya ExecutionGate'in SandboxProvider sözleşmesi arkasında Windows için ÜCRETSİZ bir sağlayıcı sunar: proje test komutu WSL2 içinde, Linux sağlayıcısının unshare/pivot_root izolasyon betiğiyle çalışır; proje dizini WSL'e KOPYALANIR (/mnt/c asla bağlanmaz), Windows ana makinesinde proje kodu ASLA çalışmaz. selfTest() WSL tarafındaki negatif sondalar geçmeden sağlayıcı kullanılamaz (fail-closed, ana makineye geri düşüş yok).
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import type {SpawnOptions} from "node:child_process";
import type {ProcResult} from "../workos/executors.js";
import type {SandboxChild, SandboxProvider, SandboxRunOptions} from "../workos/execution-gate.js";
import type {BridgeHandle} from "../workos/devrun-bridge.js";
import * as linuxModule from "../agents/linux-unshare-sandbox.js";
import {buildTar, TarError} from "./wsl-tar.js";
import type {TarLimits} from "./wsl-tar.js";

export const WSL_SANDBOX_ID = "wsl-unshare-v1";

/** selfTest()/run() ret nedenleri: sabit kodlar, yol veya sır içermez. */
export type WslUnavailableReason =
  | "PLATFORM_NOT_WIN32" | "WSL_EXE_MISSING" | "WSL_NOT_AVAILABLE" | "WSL_DISTRO_NOT_CONFIGURED" | "WSL_DISTRO_MISSING" | "WSL_VERSION_NOT_2"
  | "INTEROP_ENABLED" | "LINUX_ISOLATION_EXPORTS_MISSING" | "WSL_TOOLS_MISSING" | "NO_NEW_ROOT_MOUNTPOINT" | "SCRATCH_CREATE_FAILED"
  | "PROBE_FAILED" | "SELFTEST_ERROR" | "PROBE_PROCESS_LIMIT_NOT_ENFORCED" | "PROBE_TIMEOUT_NOT_ENFORCED" | "PROBE_TIMEOUT_TREE_SURVIVED" | "PROBE_STDIN_NOT_FORWARDED" | "PROBE_ABORT_NOT_ENFORCED" | "PROBE_ABORT_TREE_SURVIVED" | "INTEROP_PROBE_INCONCLUSIVE"
  | `PROBE_${string}`;

/** Linux sağlayıcısının izolasyon betiği ve bayrakları (tek kaynak: core/agents/linux-unshare-sandbox.ts; Lane C dışa aktarır, burada yeniden yazılmaz). */
export interface LinuxIsolation { nsFlags: readonly string[]; setup: string; helperPath: string }
export function linuxIsolationFromModule(mod: unknown = linuxModule): LinuxIsolation | null {
  const m = mod as Record<string, unknown>;
  const nsFlags = m.LINUX_SANDBOX_NS_FLAGS, setup = m.LINUX_SANDBOX_SETUP, helperPath = m.LINUX_SANDBOX_HELPER_PATH;
  return Array.isArray(nsFlags) && nsFlags.length > 0 && nsFlags.every(f => typeof f === "string") && typeof setup === "string" && setup.length > 0 && typeof helperPath === "string" && helperPath.length > 0
    ? {nsFlags: nsFlags as string[], setup, helperPath} : null;
}

export interface WslRunResult { exitCode: number | null; stdout: Buffer; stderr: Buffer; timedOut: boolean; aborted: boolean; spawnError: boolean; truncated?: boolean }
export interface WslRunOptions { timeoutMs: number; input?: Buffer | string; shouldAbort?: () => boolean }
/** wsl.exe çağrısı (argv, kabuk yok). Testlerde sahte çalıştırıcı enjekte edilir. */
export type WslRunner = (args: string[], o: WslRunOptions) => Promise<WslRunResult>;

export interface WslSandboxOptions {
  wslBinary?: string; distro?: string; platform?: NodeJS.Platform; runner?: WslRunner; isolation?: LinuxIsolation | null;
  addressSpaceKb?: number; maxFileBlocks?: number; maxProcesses?: number; tarLimits?: TarLimits; killGraceMs?: number;
  /** Zaman aşımı sondasında "geç" işaretinin görünmesi için beklenen süre (ms); testlerde 0. */
  /** Dev-run çocuğu ve köprü bağlantıları için wsl.exe başlatıcısı (testlerde sahte). stdio: run için [ignore,pipe,pipe], röle için [pipe,pipe,ignore]. */ spawner?: (args: string[], stdio: cp.StdioOptions) => cp.ChildProcess;
  /** Dev-run en uzun ömrü (ms; varsayılan 6 saat): timeout(SIGKILL) ile sınırlanır. */ devMaxMs?: number; maxBridgeConnections?: number; bridgeIdleMs?: number; bridgeTargetWaitMs?: number;
  /** Sandbox'a salt-okunur bağlanacak ek mutlak dizinler (ör. /opt altındaki node kurulumu); /mnt ve kök yasak. Varsayılan boş: yalnız /usr,/bin,/lib* görünür. */ extraReadOnlyRoots?: string[];
  settleMs?: number; /** Koşu sonrası /work için kb üst sınırı (aşılırsa koşu BAŞARISIZ sayılır ve not düşülür). */ maxWorkKb?: number;
}

const HOST_ONLY_ENV = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "USERNAME", "USERDOMAIN",
  "COMPUTERNAME", "OS", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PUBLIC", "ALLUSERSPROFILE", "WSLENV", "WSL_DISTRO_NAME", "WSL_INTEROP", "PROCESSOR_ARCHITECTURE"]);
const LINUX_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const ROOT_CANDIDATES = ["/srv", "/media"] as const; // /mnt ASLA: orada Windows sürücüleri (drvfs) bağlı olabilir
const SCRATCH_RE = /^\/tmp\/uasco-sbx-[A-Za-z0-9]{6}$/;
/** executors.ts MAX_CAPTURE ile aynı: her akış için 4 MiB. */
export const MAX_CAPTURE = 4 * 1024 * 1024;
const DEFAULT_MAX_WORK_KB = 1024 * 1024;
const now = () => new Date().toISOString();

function refusal(argv: string[], why: string): ProcResult {
  const t = now();
  return {argv, exitCode: null, stdout: "", stderr: `SANDBOX_NOT_VERIFIED: ${why}`, startedAt: t, endedAt: t, timedOut: false, aborted: false, spawnError: true};
}

/** WSL ortamına geçecek ortam: yalnız Linux'ta anlamlı, güvenli adlı değişkenler; Windows'a özgü değişkenler ve PATH düşer (PATH sabittir). */
export function wslEnv(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || HOST_ONLY_ENV.has(k.toUpperCase())) continue;
    if (/[\u0000\r\n]/.test(v) || /(^|[;:=])[A-Za-z]:[\\/]/.test(v) || v.includes("\\\\")) continue;
    out.push(`${k}=${v}`);
  }
  return out;
}

/** Windows'ta çalıştırıcının "node" yerine verdiği process.execPath, WSL içinde `node`'a çevrilir; başka Windows yolu reddedilir. */
export function translateArgv(argv: string[], hostExecPath: string = process.execPath): string[] | null {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some(a => typeof a !== "string" || a.includes("\u0000"))) return null;
  const [first, ...rest] = argv;
  if (first === hostExecPath || /^[A-Za-z]:[\\/].*[\\/]node(\.exe)?$/i.test(first)) return ["node", ...rest];
  if (/^[A-Za-z]:[\\/]/.test(first) || first.includes("\\")) return null;
  return [first, ...rest];
}

/** YALNIZ wsl.exe'nin kendi yönetim çıktısı (`--status`, `-l -q`, `-l -v`) için: UTF-16LE gelebilir. Güvenilmeyen test çıktısına UYGULANMAZ (tek NUL baytı akışı bozar): o `toString("utf8")` ile çözülür. */
export function decodeWslText(b: Buffer): string {
  const s = b.includes(0) ? b.toString("utf16le") : b.toString("utf8");
  return s.replace(/^﻿/, "").replace(/\u0000/g, "");
}
const utf8 = (b: Buffer): string => b.toString("utf8");

/** Akış başına üst sınırlı yakalama: sınırdan sonra okumaya (boşaltmaya) devam edilir ama bellekte tutulmaz; truncated işaretlenir. */
export class BoundedCapture {
  private chunks: Buffer[] = []; private size = 0; truncated = false;
  constructor(private readonly max: number = MAX_CAPTURE) {}
  push(d: Buffer): void {
    const room = this.max - this.size;
    if (d.length > room) { if (room > 0) { this.chunks.push(d.subarray(0, room)); this.size += room; } this.truncated = true; return; }
    this.chunks.push(d); this.size += d.length;
  }
  get buffer(): Buffer { return Buffer.concat(this.chunks); }
}

/** Gerçek wsl.exe çalıştırıcısı: kabuk yok, WSL_UTF8=1, zaman aşımı/abort'ta Windows tarafı süreç ağacı BİR KEZ öldürülür (çıkmış sürece asla; PID yeniden kullanımı riski). Linux tarafı temizliği sağlayıcıdadır. */
export function spawnWslRunner(binary: string, killGraceMs = 3000, maxCapture: number = MAX_CAPTURE): WslRunner {
  return (args, o) => new Promise<WslRunResult>(resolve => {
    const out = new BoundedCapture(maxCapture), err = new BoundedCapture(maxCapture);
    let timedOut = false, aborted = false, settled = false, killed = false;
    let child: cp.ChildProcess;
    try { child = cp.spawn(binary, args, {shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {...process.env, WSL_UTF8: "1"}}); }
    catch { resolve({exitCode: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, aborted: false, spawnError: true}); return; }
    const kill = () => {
      if (killed || child.exitCode !== null || child.signalCode !== null) return;
      killed = true;
      // Öldürmeden sonra stdio boru kapanışı (torunlar tutabilir) sınırsız beklenmez: kısa bir ek süreden sonra sonuç döner (Linux tarafı ağacı ayrıca sağlayıcıca öldürülür).
      setTimeout(() => done(result(null, false)), Math.max(200, Math.min(killGraceMs, 3000))).unref();
      try { if (process.platform === "win32" && child.pid) cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true}); else child.kill("SIGKILL"); } catch { /* en iyi çaba */ }
    };
    const result = (code: number | null, spawnError: boolean): WslRunResult => ({exitCode: code, stdout: out.buffer, stderr: err.buffer, timedOut, aborted, spawnError, truncated: out.truncated || err.truncated});
    let poll: NodeJS.Timeout | undefined;
    const done = (r: WslRunResult) => { if (settled) return; settled = true; clearTimeout(timer); if (poll) clearInterval(poll); resolve(r); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs + killGraceMs);
    poll = setInterval(() => { if (o.shouldAbort?.()) { aborted = true; if (poll) clearInterval(poll); kill(); } }, 100);
    child.stdout?.on("data", d => out.push(Buffer.from(d))); child.stderr?.on("data", d => err.push(Buffer.from(d)));
    child.on("error", () => done(result(null, true)));
    child.on("close", code => done(result(code, false)));
    child.on("exit", code => { if (killed) setTimeout(() => done(result(code, false)), 250).unref(); });
    child.stdin?.on("error", () => { /* süreç erken kapanabilir */ });
    if (o.input !== undefined) child.stdin?.end(o.input); else child.stdin?.end();
  });
}

/** Küçük ama GEÇERLİ bir PE32 (DOS başlığı + PE imzası + bölüm + giriş noktası `xor eax,eax; ret`): WSL interop açıksa /init bunu gerçekten başlatmaya çalışır; kapalıysa çekirdek ENOEXEC döndürür. */
export function minimalPe(): Buffer {
  const b = Buffer.alloc(0x400);
  b.write("MZ", 0, "latin1"); b.writeUInt32LE(0x40, 0x3c);
  b.write("PE\0\0", 0x40, "latin1");
  b.writeUInt16LE(0x014c, 0x44); b.writeUInt16LE(1, 0x46); b.writeUInt16LE(0xe0, 0x54); b.writeUInt16LE(0x0103, 0x56);
  const o = 0x58;
  b.writeUInt16LE(0x10b, o); b.writeUInt32LE(0x200, o + 4); b.writeUInt32LE(0x1000, o + 16); b.writeUInt32LE(0x1000, o + 20); b.writeUInt32LE(0x400000, o + 28);
  b.writeUInt32LE(0x1000, o + 32); b.writeUInt32LE(0x200, o + 36); b.writeUInt16LE(4, o + 40); b.writeUInt16LE(4, o + 48);
  b.writeUInt32LE(0x2000, o + 56); b.writeUInt32LE(0x200, o + 60); b.writeUInt16LE(3, o + 68); b.writeUInt32LE(16, o + 92);
  const sh = o + 0xe0;
  b.write(".text", sh, "latin1"); b.writeUInt32LE(0x10, sh + 8); b.writeUInt32LE(0x1000, sh + 12); b.writeUInt32LE(0x200, sh + 16); b.writeUInt32LE(0x200, sh + 20); b.writeUInt32LE(0x60000020, sh + 36);
  b[0x200] = 0x31; b[0x201] = 0xc0; b[0x202] = 0xc3;
  return b;
}

/** AF_VSOCK engeli: `--net` AF_VSOCK'u (Hyper-V hvsocket -> Windows ana makinesi) yalıtmaz. Sandbox İÇİNDE komuttan önce çalışan, yalnız dağıtımda zaten bulunan perl ile (kurulum yok) no_new_privs + seccomp filtresi kurar: socket()/socketpair() ailesi 40 (AF_VSOCK) -> EAFNOSUPPORT; x86_64 ve aarch64 dışı mimaride 125 ile çalıştırmaz (fail-closed). */
export const SECCOMP_PL = [
  'use Config;',
  'my %K=("x86_64"=>[0xC000003E,41,53,157],"aarch64"=>[0xC00000B7,198,199,167]);',
  'my ($arch)=$Config{archname}=~/^(x86_64|aarch64)/;',
  'my $k=$K{$arch//""} or do{print STDERR "SECCOMP_ARCH_UNSUPPORTED\\n";exit 125};',
  'my ($A,$S,$P,$PR)=@$k;',
  'sub I{pack("SCCL",@_)}',
  'my $prog=join("",I(0x20,0,0,4),I(0x15,0,7,$A),I(0x20,0,0,0),I(0x15,1,0,$S),I(0x15,0,2,$P),I(0x20,0,0,16),I(0x15,1,0,40),I(0x06,0,0,0x7fff0000),I(0x06,0,0,0x00050000|97),I(0x06,0,0,0x80000000));',
  'my $fp=pack("S x6 P",10,$prog);',
  'syscall($PR,38,1,0,0,0)==0 or do{print STDERR "SECCOMP_NNP_FAILED\\n";exit 125};',
  'syscall($PR,22,2,$fp)==0 or do{print STDERR "SECCOMP_INSTALL_FAILED\\n";exit 125};',
  'exec {$ARGV[0]} @ARGV or do{print STDERR "SECCOMP_EXEC_FAILED\\n";exit 127};'
].join("\n");

// //TR: Betikler wsl.exe argv'sine KONMAZ (wsl.exe/CreateProcess alıntılama kırılganlığı): stdin ile `tee` üzerinden WSL'e dosya olarak yazılır ve `sh <dosya>` ile çalışır. Sondalar sandbox İÇİNDE (Linux izolasyon betiğiyle) koşar; çıktı ANAHTAR=değer satırlarıdır, eksik anahtar veya beklenmeyen değer = PROBE_<ANAHTAR> ile ret. NOT: WSL interop tespiti sandbox İÇİNDEN yapılamaz (taze /proc'ta binfmt_misc yoktur); gerçek kapılar OUTER_SCRIPT'in binfmt okuması + geçerli PE'nin sandbox DIŞINDA `bash -c` ile çalıştırılmasıdır (her run()'da yeniden).
export const PROBE_SCRIPT = [
  "set -u",
  String.raw`echo "MNT_C=$([ -e /mnt/c ] && echo present || echo absent)"`,
  String.raw`echo "DRVFS=$(grep -Eci 'drvfs|9p|/mnt/[a-z]( |$)' /proc/self/mountinfo || true)"`,
  String.raw`echo "UNIX_PATH_SOCKETS=$(awk 'NR>1 && $8 ~ /^\// {c++} END{print c+0}' /proc/net/unix)"`,
  String.raw`echo "WSL_RUNTIME_DIRS=$([ -e /run/WSL ] || [ -e /mnt/wslg ] || [ -e /tmp/.X11-unix ] && echo present || echo absent)"`,
  String.raw`for d in /usr /etc /bin; do if ( : > "$d/uasco-probe" ) 2>/dev/null; then echo "RW_$(basename $d)=writable"; else echo "RW_$(basename $d)=ro"; fi; done`,
  String.raw`if ( : > /work/probe.txt ) 2>/dev/null; then echo "WORK=writable"; else echo "WORK=ro"; fi`,
  String.raw`echo "NET_IFACES=$(awk 'NR>2 {n=$1; sub(/:$/,"",n); if (n != "lo") c++} END{print c+0}' /proc/net/dev)"`,
  // Linux sağlayıcısının zorunlu kıldığı değişmezler burada da yeniden doğrulanır (betik uygulanır ama sonuç etkisiz olabilir: ör. setpriv no-op).
  String.raw`if [ "$(awk '/^(CapInh|CapPrm|CapEff|CapBnd|CapAmb):/{print $2}' /proc/self/status | sort -u)" = 0000000000000000 ] && grep -q '^NoNewPrivs:.1' /proc/self/status; then echo "CAPS_DROPPED=ok"; else echo "CAPS_DROPPED=no"; fi`,
  String.raw`if [ "$(awk '{print $7}' /proc/self/stat)" = 0 ] && [ ! -e /dev/tty ]; then echo "NO_CTTY=ok"; else echo "NO_CTTY=no"; fi`,
  String.raw`if unshare -U true 2>/dev/null; then echo "NESTED_USERNS=allowed"; else echo "NESTED_USERNS=blocked"; fi`,
  String.raw`if [ "$(ls /proc | grep -c '^[0-9]')" -lt 20 ]; then echo "PID_NS_PRIVATE=ok"; else echo "PID_NS_PRIVATE=no"; fi`,
  // AF_VSOCK (hvsocket -> Windows ana makinesi): socket(40) yalnız EAFNOSUPPORT/EACCES/EPERM ile reddedilirse "blocked"; başarı veya yorumlayıcı yok = açık/bilinmiyor (fail-closed).
  String.raw`v=unknown; if [ -x /usr/bin/perl ]; then v=$(/usr/bin/perl -e 'if (socket(S,40,1,0)) {print "open"} else {$e=$!+0; print(($e==97||$e==13||$e==1)?"blocked":"unknown")}' 2>/dev/null); fi; echo "VSOCK=$v"`,
  // Linux sağlayıcısındaki zorunlu değişmezlerin kalanı (supervisor, ana makine dizinleri, /proc/sys salt-okunur, ana makine kanaryası).
  String.raw`if [ "$PPID" = 1 ] && [ "$$" != 1 ]; then echo "SUPERVISOR=ok"; else echo "SUPERVISOR=no"; fi`,
  String.raw`h=hidden; for d in /home /root /run /var /sys /mnt; do [ -e "$d" ] && h=present; done; echo "HOST_DIRS=$h"`,
  String.raw`if ! echo 60 > /proc/sys/vm/swappiness 2>/dev/null && ! echo x > /proc/sys/kernel/core_pattern 2>/dev/null && ! echo b > /proc/sysrq-trigger 2>/dev/null; then echo "PROC_SYS_RO=ok"; else echo "PROC_SYS_RO=no"; fi`,
  String.raw`if [ -n "$1" ] && [ ! -e "$1" ]; then echo "HOST_CANARY=hidden"; else echo "HOST_CANARY=visible"; fi`,
  'echo "DONE=1"'
].join("\n") + "\n";
const PROBE_EXPECT: Record<string, (v: string) => boolean> = {
  MNT_C: v => v === "absent", DRVFS: v => v === "0", UNIX_PATH_SOCKETS: v => v === "0",
  WSL_RUNTIME_DIRS: v => v === "absent", RW_usr: v => v === "ro", RW_etc: v => v === "ro", RW_bin: v => v === "ro", WORK: v => v === "writable", NET_IFACES: v => v === "0",
  VSOCK: v => v === "blocked", SUPERVISOR: v => v === "ok", HOST_DIRS: v => v === "hidden", PROC_SYS_RO: v => v === "ok", HOST_CANARY: v => v === "hidden",
  CAPS_DROPPED: v => v === "ok", NO_CTTY: v => v === "ok", NESTED_USERNS: v => v === "blocked", PID_NS_PRIVATE: v => v === "ok", DONE: v => v === "1"
};
export function evaluateProbe(stdout: string): {ok: true} | {ok: false; reason: `PROBE_${string}`} {
  const kv = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
  for (const [k, ok] of Object.entries(PROBE_EXPECT)) { const v = kv.get(k); if (v === undefined || !ok(v)) return {ok: false, reason: `PROBE_${k.toUpperCase()}`}; }
  return {ok: true};
}
// Sandbox DIŞINDA: WSL interop kaydı (okunamayan/bilinmeyen = enabled sayılır: fail-closed), araçlar ve GEÇERLİ bir PE'nin `bash -c` ile çalıştırılması (bash ENOEXEC'te kabuk betiği gibi çalıştırmaz: ikili dosyada 126 + "cannot execute binary file"; env/execvp/dash ise sh'ye düşer, bu yüzden KULLANILMAZ; başka her sonuç = interop açık). Betik S/ctl/outer.sh olarak çalışır; PE S/ctl/probe.exe.
export const OUTER_SCRIPT = [
  "set -u",
  "st=absent",
  String.raw`for p in /proc/sys/fs/binfmt_misc/WSLInterop /proc/sys/fs/binfmt_misc/WSLInterop-late; do if [ -e "$p" ]; then l=""; if read -r l < "$p" 2>/dev/null && [ "$l" = disabled ]; then [ "$st" = enabled ] || st=disabled; else st=enabled; fi; fi; done`,
  'echo "INTEROP=$st"',
  String.raw`ok=ok; for t in unshare setpriv mount pivot_root awk sort grep ls timeout tar mktemp rm sh env tee mkdir bash chmod cat kill pkill pgrep prlimit find du sleep nsenter readlink perl tr dirname; do command -v "$t" >/dev/null 2>&1 || ok=missing; done; echo "TOOLS=$ok"`,
  String.raw`d=$(dirname "$0"); o=$(LC_ALL=C LANGUAGE= /bin/bash -c '"$0"' "$d/probe.exe" 2>&1 >/dev/null); rc=$?; echo "PE_EXEC_RC=$rc"; case "$o" in *"cannot execute binary file"*) echo "PE_ENOEXEC=yes";; *) echo "PE_ENOEXEC=no";; esac`,
  'echo "NODE=$(command -v node 2>/dev/null)"',
  'echo "DONE=1"'
].join("\n") + "\n";

/** POSIX tek tırnak alıntısı (run.sh içine yazılan her değer bununla alıntılanır; wsl.exe argv'sine değer konmaz). */
export const shq = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

// Yaşam döngüsü sondaları (Linux sağlayıcısındaki zorunlu sondaların karşılığı), aynı stageSandbox/run.sh yolundan geçer.
const FORK_PROBE_LIMIT = 48;
const FORK_PROBE = 'ok=0; fail=0; i=0; while [ $i -lt 150 ]; do if (sleep 25 &) 2>/dev/null; then ok=$((ok+1)); else fail=$((fail+1)); fi; i=$((i+1)); done; echo ok=$ok fail=$fail';
const TIMEOUT_PROBE_MS = 2000;
const TIMEOUT_PROBE = 'trap "" TERM HUP; ( trap "" TERM HUP; sleep 5; : > /work/late.txt ) & ( setsid sh -c \'trap "" TERM HUP; sleep 5; : > /work/late2.txt\' & ) ; sleep 60';
export const ABORT_PROBE = TIMEOUT_PROBE.replace(/late/g, "abort-late");
const ABORT_PROBE_MS = 30_000, ABORT_AFTER_MS = 1000, ABORT_RETURN_BOUND_MS = 15_000;
const STDIN_PROBE = "read -r l; echo got=$l";

/** Sandbox zincirini öldürür: kayıtlı timeout süreç grubuna YALNIZ hâlâ bizimse (cmdline S'yi içeriyorsa) SIGKILL; lider çıkmışsa pgid yeniden kullanılmış olabilir, grup öldürülmez (pid ad alanı çökünce zaten dağılır). Çıktı: PGID=<n|none>. */
export const killScript = (S: string): string => [
  "#!/bin/sh",
  `S=${shq(S)}`,
  'p=$(cat "$S/ctl/pid" 2>/dev/null)',
  'case "$p" in ""|*[!0-9]*) echo "PGID=none"; exit 0;; esac',
  'if [ "$p" -gt 1 ] && [ -r "/proc/$p/cmdline" ] && tr "\\000" " " < "/proc/$p/cmdline" | grep -qF -- "$S"; then /bin/kill -KILL -- "-$p" 2>/dev/null; fi',
  'echo "PGID=$p"'
].join("\n") + "\n";
/** Bayat dizin süpürmesi: yalnız yaşı eşiği aşan VE argv'sinde S geçen süreç KALMAMIŞ dizinler silinir (canlı koşunun dizinine dokunulmaz). */
export const sweepScript = (mmin: number): string => [
  "for d in /tmp/uasco-sbx-??????; do",
  '  [ -d "$d" ] || continue',
  `  [ -n "$(find "$d" -maxdepth 0 -mmin +${Math.max(1, Math.floor(mmin))} 2>/dev/null)" ] || continue`,
  '  pgrep -f -- "$d" >/dev/null 2>&1 && continue',
  '  chmod -R u+rwX -- "$d" 2>/dev/null; rm -rf -- "$d"',
  "done"
].join("\n") + "\n";

/** WSL içi sabit röle: argv[2] portundaki 127.0.0.1'e bağlanır (sandbox ağ ad alanında çalışır). */
export const WSL_RELAY_JS = 'const n=require("node:net");const s=n.connect({host:"127.0.0.1",port:Number(process.argv[2])});process.stdin.pipe(s);s.pipe(process.stdout);s.on("error",()=>process.exit(1));s.on("close",()=>process.exit(0));process.stdin.on("end",()=>s.end());\n';
/** Sandbox DIŞINDA (WSL) çalışır: hedef pid'in ağ ad alanı bu sürecinkinden FARKLI olmalı (aynıysa nsenter WSL loopback'ine bağlanırdı); pid/port yalnız rakam. */
export const relayScript = (S: string, node: string): string => [
  "#!/bin/sh",
  "p=$1; port=$2",
  'case "$p$port" in *[!0-9]*|"") exit 98;; esac',
  '[ -d "/proc/$p" ] || exit 96',
  '[ "$(/usr/bin/readlink "/proc/$p/ns/net")" != "$(/usr/bin/readlink /proc/self/ns/net)" ] || exit 97',
  `exec /usr/bin/nsenter -U --preserve-credentials -n -t "$p" ${shq(node)} ${shq(`${S}/ctl/relay.js`)} "$port"`
].join("\n") + "\n";

export class WslUnshareSandboxProvider implements SandboxProvider {
  readonly id = WSL_SANDBOX_ID;
  private verified = false;
  private probing: Promise<{ok: boolean; detail?: string}> | null = null;
  /** Son selfTest sonucu (sabit neden kodu); ExecutionGate yalnız "SELF_TEST_FAILED" gösterir, kesin neden buradan okunur. */
  lastSelfTest: {ok: boolean; detail?: string} | null = null;
  /** ExecutionGate her authorize()/status()'ta sorar: sağlayıcı kendini doğrulanmamış yaptıysa (interop açıldı, temizlik başarısız) AVAILABLE gösterilmez. */
  isVerified(): boolean { return this.verified; }
  constructor(private readonly o: WslSandboxOptions = {}) {}
  private get platform(): NodeJS.Platform { return this.o.platform ?? process.platform; }
  private get distro(): string | undefined { const d = this.o.distro ?? process.env.UASCO_WSL_DISTRO; return d && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(d) ? d : undefined; }
  private get runner(): WslRunner { return this.o.runner ??= spawnWslRunner(this.o.wslBinary ?? "wsl.exe", this.o.killGraceMs); }
  private get isolation(): LinuxIsolation | null { return this.o.isolation === undefined ? linuxIsolationFromModule() : this.o.isolation; }

  private wsl(args: string[], timeoutMs: number, input?: Buffer | string, shouldAbort?: () => boolean): Promise<WslRunResult> {
    const d = this.distro;
    return this.runner(["-d", d ?? "", "--exec", ...args], {timeoutMs, input, shouldAbort});
  }
  private newRoot = "/srv";
  private extraRoots(): string[] { return (this.o.extraReadOnlyRoots ?? []).filter(r => /^\/[A-Za-z0-9_.\/-]{1,200}$/.test(r) && r !== "/" && !r.startsWith("/mnt") && !r.includes("..") && !r.includes(":")).map(r => r.replace(/\/+$/, "")); }
  private nodePath: string | null = null;
  /** ISOLATED: sandbox kendi ağ ad alanındadır; dev-run ürünü yalnız bridge() ile erişilebilir. */
  readonly network = "ISOLATED" as const;
  private readonly live = new WeakMap<object, {S: string}>();

  /** WSL tarafında geçici dizin: S (mktemp), S/work (proje kopyası, sandbox /work), S/ctl (betikler). Yalnız doğrudan exec; değer içeren argüman yok. */
  private async prepare(): Promise<string | null> {
    const r = await this.wsl(["/usr/bin/mktemp", "-d", "/tmp/uasco-sbx-XXXXXX"], 15_000);
    const S = decodeWslText(r.stdout).trim();
    if (r.exitCode !== 0 || !SCRATCH_RE.test(S)) return null;
    const m = await this.wsl(["/bin/mkdir", `${S}/work`, `${S}/ctl`], 15_000);
    if (m.exitCode !== 0) { await this.cleanup(S); return null; }
    return S;
  }
  private async put(S: string, name: string, data: string | Buffer): Promise<boolean> {
    const r = await this.wsl(["/usr/bin/tee", `${S}/ctl/${name}`], 20_000, data);
    return r.exitCode === 0;
  }
  /** Linux tarafı ağacı öldürme (abort'ta hemen, temizlikte yine): kill.sh (yalnız hâlâ bizim olan grup) + pkill. Dönen: kill.sh'in bildirdiği pgid (varsa) ve hata kodu. */
  private async killTree(S: string): Promise<{pgid: string | null; bad: string | null}> {
    const k = await this.wsl(["/bin/sh", `${S}/ctl/kill.sh`], 15_000);
    const pgid = /^PGID=(\d+)$/m.exec(utf8(k.stdout))?.[1] ?? null;
    const pk = await this.wsl(["/usr/bin/pkill", "-KILL", "-f", "--", S], 15_000);
    return {pgid, bad: pk.exitCode !== 0 && pk.exitCode !== 1 ? "PKILL_FAILED" : null};
  }
  /** Temizlik: (1) ağacı öldür, (2) sürecin KALMADIĞINI doğrula (pgrep: yalnız çıkış 1 = yok; başka her kod = doğrulanamadı = hata; hem argv hem pgid ile), (3) chmod -R u+rwX + rm -rf, (4) dizinin gittiğini doğrula. Başarısızlık neden koduyla döner (yutulmaz). */
  private async cleanup(S: string): Promise<string | null> {
    let bad: string | null = null;
    try {
      const k = await this.killTree(S); bad = k.bad;
      const gone = async (args: string[]): Promise<string | null> => {
        let rc: number | null = 0;
        for (let i = 0; i < 5 && rc === 0; i++) { rc = (await this.wsl(["/usr/bin/pgrep", ...args], 15_000)).exitCode; if (rc === 0) await new Promise(r => setTimeout(r, 200)); }
        return rc === 1 ? null : rc === 0 ? "PROCESS_SURVIVED" : "PGREP_FAILED";
      };
      bad ??= await gone(["-f", "--", S]);
      if (k.pgid && Number(k.pgid) > 1) bad ??= await gone(["-g", k.pgid]);
      await this.wsl(["/bin/chmod", "-R", "u+rwX", "--", S], 15_000);
      await this.wsl(["/bin/rm", "-rf", "--", S], 15_000);
      if ((await this.wsl(["/usr/bin/test", "!", "-e", S], 15_000)).exitCode !== 0) bad ??= "SCRATCH_NOT_REMOVED";
    } catch { bad ??= "CLEANUP_ERROR"; }
    return bad;
  }
  /** Bayat uasco-sbx-* dizinlerini (çökme sonrası kalan) temizler; eşik en uzun koşu süresinden büyüktür ve canlı süreci olan dizine dokunulmaz; en iyi çaba. */
  private async sweepStale(): Promise<void> {
    try { await this.wsl(["/bin/sh", "-s"], 60_000, sweepScript(Math.ceil(Math.max(this.o.devMaxMs ?? 6 * 3600_000, 2 * 3600_000) / 60_000) + 30)); } catch { /* en iyi çaba */ }
  }
  /** setup.sh + run.sh yazar. run.sh: env -i + (pid yazan sh -> exec timeout(SIGKILL)) + unshare + Linux izolasyon betiği + alıntılı komut; BAŞTA exec YOK (timeout'ta kabuk 137 ile çıkar), rc dosyaya da yazılır. */
  private async stageSandbox(S: string, timeoutMs: number, env: string[], command: string[], nprocOverride?: number): Promise<"OK" | "LINUX_ISOLATION_EXPORTS_MISSING" | "STAGE_FAILED"> {
    const iso = this.isolation;
    if (!iso) return "LINUX_ISOLATION_EXPORTS_MISSING";
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000)), cpu = secs + 5;
    const nproc = nprocOverride ?? Math.max(16, Math.floor(this.o.maxProcesses ?? 4096));
    const chain = ["/usr/bin/timeout", "--signal=KILL", "--kill-after=3", String(secs), "/usr/bin/unshare", ...iso.nsFlags.map(shq), "/bin/sh", shq(`${S}/ctl/setup.sh`),
      shq(`${S}/work`), String(cpu), String(this.o.addressSpaceKb ?? 16 * 1024 * 1024), String(this.o.maxFileBlocks ?? 2 * 1024 * 1024), shq(this.newRoot), shq(this.extraRoots().join(":")), String(nproc), ...["/usr/bin/perl", "-e", SECCOMP_PL, "--", ...command].map(shq)];
    const line = ["/usr/bin/env", "-i", shq(`PATH=${LINUX_PATH}`), ...env.map(shq), "/bin/sh", "-c", shq('echo $$ > "$1"; shift; exec "$@"'), "sh", shq(`${S}/ctl/pid`), ...chain].join(" ");
    const runSh = `#!/bin/sh\n${line}\nrc=$?\necho "$rc" > ${shq(`${S}/ctl/rc`)}\nexit "$rc"\n`;
    return (await this.put(S, "setup.sh", iso.setup.endsWith("\n") ? iso.setup : iso.setup + "\n")) && (await this.put(S, "run.sh", runSh)) && (await this.put(S, "kill.sh", killScript(S))) ? "OK" : "STAGE_FAILED";
  }
  private isTimeout(r: WslRunResult, timeoutMs: number, elapsed: number): boolean {
    return r.timedOut || ((r.exitCode === 137 || r.exitCode === 124) && elapsed >= timeoutMs * 0.9);
  }
  /** Interop sandbox DIŞINDA denetlenir (kernel-geneli kayıt); her run()'da ve selfTest'te yeniden. null = güvenli, aksi halde neden kodu. */
  private async interopCheck(S: string): Promise<WslUnavailableReason | null> {
    if (!(await this.put(S, "outer.sh", OUTER_SCRIPT)) || !(await this.put(S, "probe.exe", minimalPe()))) return "PROBE_FAILED";
    if ((await this.wsl(["/bin/chmod", "+x", `${S}/ctl/probe.exe`], 15_000)).exitCode !== 0) return "PROBE_FAILED";
    const outer = await this.wsl(["/bin/sh", `${S}/ctl/outer.sh`], 30_000);
    const o = utf8(outer.stdout);
    if (outer.exitCode !== 0 || !/^DONE=1$/m.test(o)) return "PROBE_FAILED";
    if (!/^INTEROP=(absent|disabled)$/m.test(o)) return "INTEROP_ENABLED";
    // PE probe: yalnız 126 + "cannot execute binary file" = kapalı. Çalıştırılamadı (126 başka metin, 127) = KESİN OLMAYAN (fail-closed, ayrı kod: yanlış teşhis yok); başka her rc = PE çalıştı = interop AÇIK.
    const peRc = /^PE_EXEC_RC=(\d+)$/m.exec(o)?.[1], noexec = /^PE_ENOEXEC=yes$/m.test(o);
    if (!(peRc === "126" && noexec)) return peRc === "126" || peRc === "127" ? "INTEROP_PROBE_INCONCLUSIVE" : "INTEROP_ENABLED";
    if (!/^TOOLS=ok$/m.test(o)) return "WSL_TOOLS_MISSING";
    // Linux tarafı `node` MUTLAK ve /mnt dışında olmalı (Windows node.exe asla; dev-run röle betiği bu yolla çalışır).
    // ... ve sandbox'ın GÖRDÜĞÜ ağaçta olmalı (/usr,/bin,/sbin veya extraReadOnlyRoots); aksi halde komut sandbox içinde bulunamaz.
    const nm = /^NODE=(\/[A-Za-z0-9_.\/+-]{1,200})$/m.exec(o);
    if (!nm || nm[1].startsWith("/mnt/") || !(/^\/(usr|bin|sbin)\//.test(nm[1]) || this.extraRoots().some(r => nm[1].startsWith(r + "/")))) return "WSL_TOOLS_MISSING";
    this.nodePath = nm[1];
    return null;
  }

  run(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    if (!this.verified) return Promise.resolve(refusal(argv, "selfTest has not passed"));
    return this.exec(argv, opts);
  }
  spawn(_command: string, _args: string[], _opts: SpawnOptions): cp.ChildProcess {
    throw new Error(this.verified ? "SANDBOX_REFUSED: SPAWN_NOT_SUPPORTED_IN_WSL_V1" : "SANDBOX_NOT_VERIFIED: selfTest has not passed");
  }

  private realSpawner(): (args: string[], stdio: cp.StdioOptions) => cp.ChildProcess {
    return this.o.spawner ?? ((args, stdio) => cp.spawn(this.o.wslBinary ?? "wsl.exe", args, {shell: false, windowsHide: true, stdio, env: {...process.env, WSL_UTF8: "1"}}));
  }
  private killLocal(child: cp.ChildProcess): void {
    try { if (child.exitCode !== null || child.signalCode !== null) return; if (process.platform === "win32" && child.pid) cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true}); else child.kill("SIGKILL"); } catch { /* en iyi çaba */ }
  }

  /** shouldAbort ilk kez true döndüğünde Linux tarafı ağacı HEMEN (boru kapanışını beklemeden) öldürülür. */
  private abortWith(S: string, should?: () => boolean): (() => boolean) | undefined {
    if (!should) return undefined;
    let issued = false;
    return () => { const v = should(); if (v && !issued) { issued = true; void this.killTree(S).catch(() => undefined); } return v; };
  }
  /** Dev-run için: run() ile AYNI izolasyon (kopyala-içeri + setup.sh + unshare/pivot_root), ama süreç çalışır bırakılır. Eşzamansız hazırlık gerektiği için spawn() yerine spawnAsync() kullanılır. Çıkışta (durdurma/çökme/abort) Linux tarafı timeout süreç grubu + dizin temizlenir (`sandboxTeardown`). */
  async spawnAsync(command: string, args: string[], opts: SpawnOptions): Promise<SandboxChild> {
    if (!this.verified) throw new Error("SANDBOX_NOT_VERIFIED: selfTest has not passed");
    const chk = this.checkInputs([command, ...args], opts.cwd, opts.env);
    if ("why" in chk) throw new Error(`SANDBOX_REFUSED: ${chk.why}`);
    let tar: Buffer;
    try { tar = buildTar(opts.cwd as string, this.o.tarLimits).archive; } catch (e) { throw new Error(`SANDBOX_REFUSED: ${e instanceof TarError ? e.code : "COPY_FAILED"}`); }
    const S = await this.prepare();
    if (!S) throw new Error("SANDBOX_REFUSED: SCRATCH_CREATE_FAILED");
    try {
      // Interop her başlatmada yeniden denetlenir (kernel-geneli kayıt çalışma zamanında açılabilir).
      const interop = await this.interopCheck(S);
      if (interop) {
        if (interop === "INTEROP_ENABLED" || interop === "WSL_TOOLS_MISSING") { this.verified = false; this.probing = null; this.lastSelfTest = {ok: false, detail: interop}; }
        throw new Error(`SANDBOX_REFUSED: ${interop}`);
      }
      if ((await this.wsl(["/bin/tar", "-x", "--no-same-owner", "--no-same-permissions", "-C", `${S}/work`], 120_000, tar)).exitCode !== 0) throw new Error("SANDBOX_REFUSED: COPY_IN_FAILED");
      const st = await this.stageSandbox(S, this.o.devMaxMs ?? 6 * 3600_000, wslEnv(opts.env as NodeJS.ProcessEnv), chk.command);
      if (st !== "OK") throw new Error(`SANDBOX_REFUSED: ${st}`);
      if (!this.nodePath || !(await this.put(S, "relay.js", WSL_RELAY_JS)) || !(await this.put(S, "relay.sh", relayScript(S, this.nodePath)))) throw new Error("SANDBOX_REFUSED: STAGE_FAILED");
    } catch (e) { await this.cleanup(S); throw e; }
    let child: SandboxChild;
    try { child = this.realSpawner()(["-d", this.distro ?? "", "--exec", "/bin/sh", `${S}/ctl/run.sh`], ["ignore", "pipe", "pipe"]) as SandboxChild; }
    catch { await this.cleanup(S); throw new Error("SANDBOX_REFUSED: SPAWN_FAILED"); }
    let tornDown = false;
    child.sandboxTeardown = new Promise<void>(res => {
      const go = () => { if (tornDown) return; tornDown = true; this.cleanup(S).then(bad => { if (bad) { this.verified = false; this.probing = null; this.lastSelfTest = {ok: false, detail: `CLEANUP_${bad}`}; } }, () => undefined).finally(res); };
      child.once("exit", go); child.once("error", go);
    });
    this.live.set(child, {S});
    return child;
  }

  /** Windows ana makinesinde YALNIZ 127.0.0.1:<port> dinler (0.0.0.0 ve WSL localhost yönlendirmesi YOK). Her bağlantı için `wsl.exe --exec /bin/sh relay.sh <pid> <port>` çalışır; stdio üzerinden WSL içindeki sabit röleye (nsenter -U -n) iletilir. Yalnız ana makine -> sandbox yönü vardır. */
  async bridge(child: cp.ChildProcess, port: number): Promise<BridgeHandle> {
    const rec = this.live.get(child);
    if (!rec) throw new Error("BRIDGE_TARGET_UNKNOWN");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("BRIDGE_PORT_INVALID");
    // Hedef: timeout sürecinin (pid dosyası) çocuğu olan unshare; ağ ad alanına o girer. Hazır olana dek kısa süre beklenir.
    let target: string | null = null;
    for (let i = 0, n = Math.ceil((this.o.bridgeTargetWaitMs ?? 10_000) / 250); i < n && !target && child.exitCode === null; i++) {
      const pidTxt = utf8((await this.wsl(["/bin/cat", `${rec.S}/ctl/pid`], 15_000)).stdout).trim();
      if (/^[0-9]{1,9}$/.test(pidTxt)) {
        const kids = utf8((await this.wsl(["/usr/bin/pgrep", "-P", pidTxt], 15_000)).stdout).trim().split(/\s+/).filter(x => /^[0-9]{1,9}$/.test(x));
        if (kids.length > 0) target = kids[0];
      }
      if (!target) await new Promise(r => setTimeout(r, 250));
    }
    if (!target) throw new Error("BRIDGE_TARGET_MISSING");
    const max = this.o.maxBridgeConnections ?? 32, idleMs = this.o.bridgeIdleMs ?? 120_000, spawner = this.realSpawner();
    const live = new Set<net.Socket>(), kids = new Set<cp.ChildProcess>();
    const server = net.createServer(sock => {
      if (live.size >= max || child.exitCode !== null || child.signalCode !== null) { sock.destroy(); return; }
      live.add(sock); sock.setTimeout(idleMs, () => sock.destroy());
      const r = spawner(["-d", this.distro ?? "", "--exec", "/bin/sh", `${rec.S}/ctl/relay.sh`, target as string, String(port)], ["pipe", "pipe", "ignore"]);
      kids.add(r);
      const end = () => { live.delete(sock); kids.delete(r); sock.destroy(); this.killLocal(r); };
      sock.on("close", end); sock.on("error", end); r.on("close", end); r.on("error", end);
      r.stdin?.on("error", () => { /* erken kapanış */ }); r.stdout?.on("error", () => { /* erken kapanış */ });
      if (r.stdin && r.stdout) { sock.pipe(r.stdin); r.stdout.pipe(sock); } else end();
    });
    await new Promise<void>((res, rej) => { server.once("error", rej); server.listen(port, "127.0.0.1", () => res()); });
    return {port, close: () => { try { server.close(); } catch { /* kapalı */ } for (const s of live) s.destroy(); for (const k of kids) this.killLocal(k); live.clear(); kids.clear(); }};
  }

  /** run() ve spawnAsync() için ortak girdi denetimi: argv çevirisi, ortam zorunlu, cwd mutlak/kök değil/dizin/ev dizini veya atası değil. */
  private checkInputs(argv: string[], cwd: unknown, env: unknown): {command: string[]} | {why: string} {
    const command = translateArgv(argv);
    if (!command) return {why: "ARGV_INVALID_OR_HOST_PATH"};
    if (!env || typeof env !== "object") return {why: "ENV_REQUIRED"};
    if (typeof cwd !== "string" || !path.isAbsolute(cwd) || path.parse(cwd).root === cwd) return {why: "CWD_NOT_ABSOLUTE_OR_ROOT"};
    try { if (!fs.statSync(cwd).isDirectory()) return {why: "CWD_NOT_DIRECTORY"}; } catch { return {why: "CWD_MISSING"}; }
    const home = os.homedir();
    if (home && (path.resolve(cwd) === path.resolve(home) || path.resolve(home).startsWith(path.resolve(cwd) + path.sep))) return {why: "CWD_IS_HOME_OR_ANCESTOR"};
    return {command};
  }
  private async exec(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    const startedAt = now();
    const fail = (why: string): ProcResult => ({...refusal(argv ?? [], why), startedAt});
    const chk = this.checkInputs(argv, opts.cwd, opts.env);
    if ("why" in chk) return fail(chk.why);
    const command = chk.command;
    const cwd = opts.cwd;
    let tar: Buffer, skipped = 0;
    try { const t = buildTar(cwd, this.o.tarLimits); tar = t.archive; skipped = t.skippedLinks; } catch (e) { return fail(e instanceof TarError ? e.code : "COPY_FAILED"); }
    const S = await this.prepare();
    if (!S) return fail("SCRATCH_CREATE_FAILED");
    let res: ProcResult;
    try { res = await this.inside(S, argv, opts, command, tar, skipped, startedAt, fail); } catch { res = fail("RUN_FAILED"); }
    const bad = await this.cleanup(S);
    if (!bad) return res;
    // Temizlik başarısızlığı yutulmaz: sonuç başarısız sayılır ve sağlayıcı doğrulanmamış olur (yeniden selfTest gerekir).
    this.verified = false; this.probing = null; this.lastSelfTest = {ok: false, detail: `CLEANUP_${bad}`};
    return {...res, exitCode: res.exitCode === 0 ? 1 : res.exitCode, stderr: `${res.stderr}\n[sandbox] CLEANUP_FAILED: ${bad}\n`};
  }
  private async inside(S: string, argv: string[], opts: SandboxRunOptions, command: string[], tar: Buffer, skipped: number, startedAt: string, fail: (why: string) => ProcResult): Promise<ProcResult> {
    // Interop her koşuda yeniden denetlenir: kernel-geneli kayıt çalışma zamanında açılabilir; açıksa bu sağlayıcı artık DOĞRULANMAMIŞtır.
    const interop = await this.interopCheck(S);
    if (interop) {
      if (interop === "INTEROP_ENABLED" || interop === "WSL_TOOLS_MISSING") { this.verified = false; this.probing = null; this.lastSelfTest = {ok: false, detail: interop}; }
      return fail(interop);
    }
    const x = await this.wsl(["/bin/tar", "-x", "--no-same-owner", "--no-same-permissions", "-C", `${S}/work`], 120_000, tar);
    if (x.exitCode !== 0) return fail("COPY_IN_FAILED");
    const st = await this.stageSandbox(S, opts.timeoutMs, wslEnv(opts.env), command);
    if (st !== "OK") return fail(st);
    const t0 = Date.now();
    const r = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], opts.timeoutMs, opts.input, this.abortWith(S, opts.shouldAbort));
    const elapsed = Date.now() - t0;
    const timedOut = this.isTimeout(r, opts.timeoutMs, elapsed);
    // Önce Linux tarafı ağacı öldürülür (abort/zaman aşımı/çökme sonrası kalan olmasın), SONRA boyut ölçülür ve rc okunur.
    await this.killTree(S).catch(() => undefined);
    let note = skipped > 0 ? `\n[sandbox] ${skipped} symbolic link(s)/special file(s) were not copied into WSL\n` : "";
    if (r.truncated) note += `\n[sandbox] output truncated at ${MAX_CAPTURE} bytes per stream\n`;
    let exitCode = timedOut ? null : r.exitCode;
    const du = await this.wsl(["/usr/bin/du", "-sk", "--", `${S}/work`], 30_000);
    const kb = Number(/^(\d+)/.exec(utf8(du.stdout))?.[1] ?? Number.NaN);
    // du'nun çıkış kodu da sayılır: okunamayan alt dizin = eksik toplam = BİLİNMİYOR.
    if (du.exitCode !== 0 || du.timedOut || !Number.isFinite(kb) || kb > (this.o.maxWorkKb ?? DEFAULT_MAX_WORK_KB)) { note += `\n[sandbox] WORK_SIZE_EXCEEDED_OR_UNKNOWN\n`; if (exitCode === 0) exitCode = 1; }
    // rc dosyası: 0 yalnız Linux tarafı da tam "0" yazdıysa kabul edilir (wsl.exe 0 dönüp koşu bitmemişse PASS sayılmaz).
    if (exitCode === 0 && !r.aborted) {
      const rc = utf8((await this.wsl(["/bin/cat", `${S}/ctl/rc`], 15_000)).stdout).trim();
      if (rc !== "0") { note += `\n[sandbox] RC_MISMATCH (wsl.exe 0, linux rc '${rc.slice(0, 12)}')\n`; exitCode = 1; }
    }
    return {argv, exitCode, stdout: utf8(r.stdout), stderr: utf8(r.stderr) + note, startedAt, endedAt: now(), timedOut, aborted: r.aborted, spawnError: r.spawnError};
  }

  selfTest(): Promise<{ok: boolean; detail?: string}> {
    return this.probing ??= this.probe().then(r => { this.verified = r.ok; this.lastSelfTest = r; return r; }, () => { this.verified = false; this.lastSelfTest = {ok: false, detail: "SELFTEST_ERROR"}; return this.lastSelfTest; });
  }
  private async lifecycleProbes(S: string): Promise<`PROBE_${string}` | null> {
    const stage = async (timeoutMs: number, cmd: string, nproc?: number) => (await this.stageSandbox(S, timeoutMs, [], ["/bin/sh", "-c", cmd], nproc)) === "OK";
    // (1) süreç sayısı sınırı GERÇEKTEN uygulanıyor mu (kuid 0 RLIMIT_NPROC'tan muaftır: root varsayılan kullanıcı ise ret; kabul bayrağı YOK)
    if (!(await stage(30_000, FORK_PROBE, FORK_PROBE_LIMIT))) return "PROBE_FAILED";
    const lim = utf8((await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], 30_000)).stdout);
    const okN = Number(/ok=(\d+)/.exec(lim)?.[1] ?? Number.NaN), failN = Number(/fail=(\d+)/.exec(lim)?.[1] ?? Number.NaN);
    if (!(Number.isFinite(okN) && Number.isFinite(failN) && failN > 0 && okN <= FORK_PROBE_LIMIT)) return "PROBE_PROCESS_LIMIT_NOT_ENFORCED";
    // (2) zaman aşımı TÜM ağacı öldürür (TERM'i yok sayan çocuk + geç işaret dosyası)
    if (!(await stage(TIMEOUT_PROBE_MS, TIMEOUT_PROBE))) return "PROBE_FAILED";
    const t0 = Date.now();
    const to = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], TIMEOUT_PROBE_MS);
    if (!this.isTimeout(to, TIMEOUT_PROBE_MS, Date.now() - t0)) return "PROBE_TIMEOUT_NOT_ENFORCED";
    await new Promise(r => setTimeout(r, this.o.settleMs ?? 4000));
    for (const f of ["late.txt", "late2.txt"]) if ((await this.wsl(["/usr/bin/test", "!", "-e", `${S}/work/${f}`], 15_000)).exitCode !== 0) return "PROBE_TIMEOUT_TREE_SURVIVED";
    if ((await this.wsl(["/usr/bin/pgrep", "-f", "--", S], 15_000)).exitCode !== 1) return "PROBE_TIMEOUT_TREE_SURVIVED";
    // (2b) abort yolu (shouldAbort): ~1 sn sonra abort; run() sınır içinde aborted ile dönmeli, Linux ağacı öldürülmeli, geç işaretler görünmemeli, temizlik doğrulanmalı
    if (!(await stage(ABORT_PROBE_MS, ABORT_PROBE))) return "PROBE_FAILED";
    const a0 = Date.now();
    const ab = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], ABORT_PROBE_MS, undefined, this.abortWith(S, () => Date.now() - a0 > ABORT_AFTER_MS));
    if (!ab.aborted || Date.now() - a0 > ABORT_RETURN_BOUND_MS) return "PROBE_ABORT_NOT_ENFORCED";
    await new Promise(r => setTimeout(r, this.o.settleMs ?? 4000));
    for (const f of ["abort-late.txt", "abort-late2.txt"]) if ((await this.wsl(["/usr/bin/test", "!", "-e", `${S}/work/${f}`], 15_000)).exitCode !== 0) return "PROBE_ABORT_TREE_SURVIVED";
    if ((await this.wsl(["/usr/bin/pgrep", "-f", "--", S], 15_000)).exitCode !== 1) return "PROBE_ABORT_TREE_SURVIVED";
    // (3) stdin iletimi
    if (!(await stage(20_000, STDIN_PROBE))) return "PROBE_FAILED";
    const sin = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], 20_000, "PIPED\n");
    if (!utf8(sin.stdout).includes("got=PIPED")) return "PROBE_STDIN_NOT_FORWARDED";
    return null;
  }
  private async probe(): Promise<{ok: boolean; detail?: string}> {
    const no = (detail: WslUnavailableReason) => ({ok: false, detail});
    if (this.platform !== "win32") return no("PLATFORM_NOT_WIN32");
    const st = await this.runner(["--status"], {timeoutMs: 20_000});
    if (st.spawnError) return no("WSL_EXE_MISSING");
    if (st.exitCode !== 0) return no("WSL_NOT_AVAILABLE");
    const distro = this.distro;
    if (!distro) return no("WSL_DISTRO_NOT_CONFIGURED");
    const list = await this.runner(["-l", "-q"], {timeoutMs: 20_000});
    if (list.exitCode !== 0 || !decodeWslText(list.stdout).split(/\r?\n/).map(l => l.trim()).includes(distro)) return no("WSL_DISTRO_MISSING");
    const ver = await this.runner(["-l", "-v"], {timeoutMs: 20_000});
    const row = decodeWslText(ver.stdout).split(/\r?\n/).map(l => l.replace(/^\*/, "").trim().split(/\s+/)).find(c => c[0] === distro);
    if (ver.exitCode !== 0 || !row || row[row.length - 1] !== "2") return no("WSL_VERSION_NOT_2");
    if (!this.isolation) return no("LINUX_ISOLATION_EXPORTS_MISSING");
    await this.sweepStale();
    const S = await this.prepare();
    if (!S) return no("SCRATCH_CREATE_FAILED");
    let res: {ok: boolean; detail?: string};
    try { res = await this.probeIn(S); } catch (e) { await this.cleanup(S); throw e; }
    // selfTest kendi temizliğini de kanıtlar: temizlik başarısızsa sağlayıcı DOĞRULANMAZ.
    const bad = await this.cleanup(S);
    return res.ok && bad ? no(`PROBE_CLEANUP_${bad}` as WslUnavailableReason) : res;
  }
  private async probeIn(S: string): Promise<{ok: boolean; detail?: string}> {
    const no = (detail: WslUnavailableReason) => ({ok: false, detail});
    {
      const interop = await this.interopCheck(S);
      if (interop) return no(interop);
      let root: string | null = null;
      for (const c of ROOT_CANDIDATES) if (!root && (await this.wsl(["/usr/bin/test", "-d", c], 15_000)).exitCode === 0) root = c;
      if (!root) return no("NO_NEW_ROOT_MOUNTPOINT");
      this.newRoot = root;
      // Ana makine kanaryası: sandbox DIŞINDAKİ bu dosya sandbox içinden görünmemeli (yol $1 olarak verilir).
      if (!(await this.put(S, "canary.txt", "HOST-CANARY"))) return no("PROBE_FAILED");
      const st = await this.stageSandbox(S, 60_000, [], ["/bin/sh", "-c", PROBE_SCRIPT, "sh", `${S}/ctl/canary.txt`]);
      if (st !== "OK") return no(st === "STAGE_FAILED" ? "PROBE_FAILED" : st);
      const r = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], 60_000);
      if (r.exitCode !== 0) return no("PROBE_FAILED");
      const ev = evaluateProbe(utf8(r.stdout));
      if (!ev.ok) return {ok: false, detail: ev.reason};
      const life = await this.lifecycleProbes(S);
      return life ? {ok: false, detail: life} : {ok: true};
    }
  }
}
