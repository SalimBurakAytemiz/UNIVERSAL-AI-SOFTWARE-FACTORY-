//TR: Bu dosya ExecutionGate'in SandboxProvider sözleşmesi arkasında Windows için ÜCRETSİZ bir sağlayıcı sunar: proje test komutu WSL2 içinde, Linux sağlayıcısının unshare/pivot_root izolasyon betiğiyle çalışır; proje dizini WSL'e KOPYALANIR (/mnt/c asla bağlanmaz), Windows ana makinesinde proje kodu ASLA çalışmaz. selfTest() WSL tarafındaki negatif sondalar geçmeden sağlayıcı kullanılamaz (fail-closed, ana makineye geri düşüş yok).
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {SpawnOptions} from "node:child_process";
import type {ProcResult} from "../workos/executors.js";
import type {SandboxProvider, SandboxRunOptions} from "../workos/execution-gate.js";
import * as linuxModule from "../agents/linux-unshare-sandbox.js";
import {buildTar, TarError} from "./wsl-tar.js";
import type {TarLimits} from "./wsl-tar.js";

export const WSL_SANDBOX_ID = "wsl-unshare-v1";

/** selfTest()/run() ret nedenleri: sabit kodlar, yol veya sır içermez. */
export type WslUnavailableReason =
  | "PLATFORM_NOT_WIN32" | "WSL_EXE_MISSING" | "WSL_NOT_AVAILABLE" | "WSL_DISTRO_NOT_CONFIGURED" | "WSL_DISTRO_MISSING" | "WSL_VERSION_NOT_2"
  | "INTEROP_ENABLED" | "LINUX_ISOLATION_EXPORTS_MISSING" | "WSL_TOOLS_MISSING" | "NO_NEW_ROOT_MOUNTPOINT" | "SCRATCH_CREATE_FAILED"
  | "PROBE_FAILED" | "SELFTEST_ERROR"
  | `PROBE_${string}`;

/** Linux sağlayıcısının izolasyon betiği ve bayrakları (tek kaynak: core/agents/linux-unshare-sandbox.ts; Lane C dışa aktarır, burada yeniden yazılmaz). */
export interface LinuxIsolation { nsFlags: readonly string[]; setup: string; helperPath: string }
export function linuxIsolationFromModule(mod: unknown = linuxModule): LinuxIsolation | null {
  const m = mod as Record<string, unknown>;
  const nsFlags = m.LINUX_SANDBOX_NS_FLAGS, setup = m.LINUX_SANDBOX_SETUP, helperPath = m.LINUX_SANDBOX_HELPER_PATH;
  return Array.isArray(nsFlags) && nsFlags.length > 0 && nsFlags.every(f => typeof f === "string") && typeof setup === "string" && setup.length > 0 && typeof helperPath === "string" && helperPath.length > 0
    ? {nsFlags: nsFlags as string[], setup, helperPath} : null;
}

export interface WslRunResult { exitCode: number | null; stdout: Buffer; stderr: Buffer; timedOut: boolean; aborted: boolean; spawnError: boolean }
export interface WslRunOptions { timeoutMs: number; input?: Buffer | string; shouldAbort?: () => boolean }
/** wsl.exe çağrısı (argv, kabuk yok). Testlerde sahte çalıştırıcı enjekte edilir. */
export type WslRunner = (args: string[], o: WslRunOptions) => Promise<WslRunResult>;

export interface WslSandboxOptions {
  wslBinary?: string; distro?: string; platform?: NodeJS.Platform; runner?: WslRunner; isolation?: LinuxIsolation | null;
  addressSpaceKb?: number; maxFileBlocks?: number; maxProcesses?: number; tarLimits?: TarLimits; killGraceMs?: number;
}

const HOST_ONLY_ENV = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "USERNAME", "USERDOMAIN",
  "COMPUTERNAME", "OS", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PUBLIC", "ALLUSERSPROFILE", "WSLENV", "WSL_DISTRO_NAME", "WSL_INTEROP", "PROCESSOR_ARCHITECTURE"]);
const LINUX_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const ROOT_CANDIDATES = ["/srv", "/media"] as const; // /mnt ASLA: orada Windows sürücüleri (drvfs) bağlı olabilir
const SCRATCH_RE = /^\/tmp\/uasco-sbx-[A-Za-z0-9]{6}$/;
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

/** `wsl.exe -l -q` çıktısı UTF-16LE gelebilir (WSL_UTF8 yoksa); NUL'lı ise çöz, satırlara böl. */
export function decodeWslText(b: Buffer): string {
  const s = b.includes(0) ? b.toString("utf16le") : b.toString("utf8");
  return s.replace(/^﻿/, "").replace(/\u0000/g, "");
}

/** Gerçek wsl.exe çalıştırıcısı: kabuk yok, WSL_UTF8=1, zaman aşımı/abort'ta Windows tarafı süreç ağacı öldürülür. */
export function spawnWslRunner(binary: string, killGraceMs = 3000): WslRunner {
  return (args, o) => new Promise<WslRunResult>(resolve => {
    const out: Buffer[] = [], err: Buffer[] = [];
    let timedOut = false, aborted = false, settled = false;
    let child: cp.ChildProcess;
    try { child = cp.spawn(binary, args, {shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: {...process.env, WSL_UTF8: "1"}}); }
    catch { resolve({exitCode: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, aborted: false, spawnError: true}); return; }
    const kill = () => { try { if (process.platform === "win32" && child.pid) cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true}); else child.kill("SIGKILL"); } catch { /* en iyi çaba */ } };
    const done = (r: WslRunResult) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(poll); resolve(r); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs + killGraceMs);
    const poll = setInterval(() => { if (o.shouldAbort?.()) { aborted = true; kill(); } }, 100);
    child.stdout?.on("data", d => out.push(Buffer.from(d))); child.stderr?.on("data", d => err.push(Buffer.from(d)));
    child.on("error", () => done({exitCode: null, stdout: Buffer.concat(out), stderr: Buffer.concat(err), timedOut, aborted, spawnError: true}));
    child.on("close", code => done({exitCode: code, stdout: Buffer.concat(out), stderr: Buffer.concat(err), timedOut, aborted, spawnError: false}));
    child.stdin?.on("error", () => { /* süreç erken kapanabilir */ });
    if (o.input !== undefined) child.stdin?.end(o.input); else child.stdin?.end();
  });
}

// //TR: Betikler wsl.exe argv'sine KONMAZ (wsl.exe/CreateProcess alıntılama kırılganlığı): stdin ile `tee` üzerinden WSL'e dosya olarak yazılır ve `sh <dosya>` ile çalışır. Sondalar sandbox İÇİNDE (Linux izolasyon betiğiyle) koşar; çıktı ANAHTAR=değer satırlarıdır, eksik anahtar veya beklenmeyen değer = PROBE_<ANAHTAR> ile ret.
const PROBE_SCRIPT = [
  "set -u",
  String.raw`echo "MNT_C=$([ -e /mnt/c ] && echo present || echo absent)"`,
  String.raw`echo "DRVFS=$(grep -Eci 'drvfs|9p|/mnt/[a-z]( |$)' /proc/self/mountinfo || true)"`,
  String.raw`echo "INTEROP_FILE=$([ -e /proc/sys/fs/binfmt_misc/WSLInterop ] || [ -e /proc/sys/fs/binfmt_misc/WSLInterop-late ] && echo present || echo absent)"`,
  String.raw`printf 'MZ\220\000\003\000' > /work/probe.exe; chmod +x /work/probe.exe 2>/dev/null`,
  String.raw`/work/probe.exe >/dev/null 2>&1; echo "PE_EXEC_RC=$?"`,
  String.raw`echo "UNIX_PATH_SOCKETS=$(awk 'NR>1 && $8 ~ /^\// {c++} END{print c+0}' /proc/net/unix)"`,
  String.raw`echo "WSL_RUNTIME_DIRS=$([ -e /run/WSL ] || [ -e /mnt/wslg ] || [ -e /tmp/.X11-unix ] && echo present || echo absent)"`,
  String.raw`for d in /usr /etc /bin; do if ( : > "$d/uasco-probe" ) 2>/dev/null; then echo "RW_$(basename $d)=writable"; else echo "RW_$(basename $d)=ro"; fi; done`,
  String.raw`if ( : > /work/probe.txt ) 2>/dev/null; then echo "WORK=writable"; else echo "WORK=ro"; fi`,
  String.raw`echo "NET_IFACES=$(awk 'NR>2 {n=$1; sub(/:$/,"",n); if (n != "lo") c++} END{print c+0}' /proc/net/dev)"`,
  'echo "DONE=1"'
].join("\n") + "\n";
const PROBE_EXPECT: Record<string, (v: string) => boolean> = {
  MNT_C: v => v === "absent", DRVFS: v => v === "0", INTEROP_FILE: v => v === "absent", PE_EXEC_RC: v => v === "126" || v === "127", UNIX_PATH_SOCKETS: v => v === "0",
  WSL_RUNTIME_DIRS: v => v === "absent", RW_usr: v => v === "ro", RW_etc: v => v === "ro", RW_bin: v => v === "ro", WORK: v => v === "writable", NET_IFACES: v => v === "0", DONE: v => v === "1"
};
export function evaluateProbe(stdout: string): {ok: true} | {ok: false; reason: `PROBE_${string}`} {
  const kv = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) { const i = line.indexOf("="); if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
  for (const [k, ok] of Object.entries(PROBE_EXPECT)) { const v = kv.get(k); if (v === undefined || !ok(v)) return {ok: false, reason: `PROBE_${k.toUpperCase()}`}; }
  return {ok: true};
}
// Sandbox DIŞINDA (yalnız okuma): WSL interop kayıt dosyası ve araçlar. Çıktı: INTEROP=absent|disabled|enabled, TOOLS=ok|missing, DONE=1
const OUTER_SCRIPT = [
  "set -u",
  "st=absent",
  String.raw`for p in /proc/sys/fs/binfmt_misc/WSLInterop /proc/sys/fs/binfmt_misc/WSLInterop-late; do if [ -e "$p" ]; then if grep -qi '^enabled' "$p" 2>/dev/null; then st=enabled; else st=disabled; fi; fi; done`,
  'echo "INTEROP=$st"',
  String.raw`ok=ok; for t in unshare setpriv mount pivot_root awk timeout tar mktemp rm sh env tee mkdir; do command -v "$t" >/dev/null 2>&1 || ok=missing; done; echo "TOOLS=$ok"`,
  'echo "DONE=1"'
].join("\n") + "\n";

/** POSIX tek tırnak alıntısı (run.sh içine yazılan her değer bununla alıntılanır; wsl.exe argv'sine değer konmaz). */
export const shq = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

export class WslUnshareSandboxProvider implements SandboxProvider {
  readonly id = WSL_SANDBOX_ID;
  private verified = false;
  private probing: Promise<{ok: boolean; detail?: string}> | null = null;
  /** Son selfTest sonucu (sabit neden kodu); ExecutionGate yalnız "SELF_TEST_FAILED" gösterir, kesin neden buradan okunur. */
  lastSelfTest: {ok: boolean; detail?: string} | null = null;
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

  /** WSL tarafında geçici dizin: S (mktemp), S/work (proje kopyası, sandbox /work), S/ctl (betikler). Yalnız doğrudan exec; değer içeren argüman yok. */
  private async prepare(): Promise<string | null> {
    const r = await this.wsl(["/usr/bin/mktemp", "-d", "/tmp/uasco-sbx-XXXXXX"], 15_000);
    const S = decodeWslText(r.stdout).trim();
    if (r.exitCode !== 0 || !SCRATCH_RE.test(S)) return null;
    const m = await this.wsl(["/bin/mkdir", `${S}/work`, `${S}/ctl`], 15_000);
    if (m.exitCode !== 0) { await this.cleanup(S); return null; }
    return S;
  }
  private async put(S: string, name: string, text: string): Promise<boolean> {
    const r = await this.wsl(["/usr/bin/tee", `${S}/ctl/${name}`], 20_000, text);
    return r.exitCode === 0;
  }
  private async cleanup(S: string): Promise<void> {
    try { await this.wsl(["/usr/bin/pkill", "-KILL", "-f", "--", S], 15_000); } catch { /* en iyi çaba */ }
    try { await this.wsl(["/bin/rm", "-rf", "--", S], 15_000); } catch { /* en iyi çaba */ }
  }
  /** setup.sh + run.sh yazar; run.sh: env -i + timeout(SIGKILL) + unshare + Linux izolasyon betiği + alıntılı komut. */
  private async stageSandbox(S: string, timeoutMs: number, env: string[], command: string[]): Promise<"OK" | "LINUX_ISOLATION_EXPORTS_MISSING" | "STAGE_FAILED"> {
    const iso = this.isolation;
    if (!iso) return "LINUX_ISOLATION_EXPORTS_MISSING";
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000)), cpu = secs + 5;
    const nproc = Math.max(16, Math.floor(this.o.maxProcesses ?? 4096));
    const parts = ["exec", "/usr/bin/env", "-i", shq(`PATH=${LINUX_PATH}`), ...env.map(shq), "/usr/bin/timeout", "--signal=KILL", "--kill-after=3", String(secs), "/usr/bin/unshare", ...iso.nsFlags.map(shq), "/bin/sh", shq(`${S}/ctl/setup.sh`),
      shq(`${S}/work`), String(cpu), String(this.o.addressSpaceKb ?? 16 * 1024 * 1024), String(this.o.maxFileBlocks ?? 2 * 1024 * 1024), shq(this.newRoot), "''", String(nproc), ...command.map(shq)];
    return (await this.put(S, "setup.sh", iso.setup.endsWith("\n") ? iso.setup : iso.setup + "\n")) && (await this.put(S, "run.sh", `#!/bin/sh\n${parts.join(" ")}\n`)) ? "OK" : "STAGE_FAILED";
  }

  run(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    if (!this.verified) return Promise.resolve(refusal(argv, "selfTest has not passed"));
    return this.exec(argv, opts);
  }
  spawn(_command: string, _args: string[], _opts: SpawnOptions): cp.ChildProcess {
    throw new Error(this.verified ? "SANDBOX_REFUSED: SPAWN_NOT_SUPPORTED_IN_WSL_V1" : "SANDBOX_NOT_VERIFIED: selfTest has not passed");
  }

  private async exec(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    const startedAt = now();
    const fail = (why: string): ProcResult => ({...refusal(argv ?? [], why), startedAt});
    const command = translateArgv(argv);
    if (!command) return fail("ARGV_INVALID_OR_HOST_PATH");
    if (!opts.env || typeof opts.env !== "object") return fail("ENV_REQUIRED");
    const cwd = opts.cwd;
    if (typeof cwd !== "string" || !path.isAbsolute(cwd) || path.parse(cwd).root === cwd) return fail("CWD_NOT_ABSOLUTE_OR_ROOT");
    try { if (!fs.statSync(cwd).isDirectory()) return fail("CWD_NOT_DIRECTORY"); } catch { return fail("CWD_MISSING"); }
    const home = os.homedir();
    if (home && (path.resolve(cwd) === path.resolve(home) || path.resolve(home).startsWith(path.resolve(cwd) + path.sep))) return fail("CWD_IS_HOME_OR_ANCESTOR");
    let tar: Buffer, skipped = 0;
    try { const t = buildTar(cwd, this.o.tarLimits); tar = t.archive; skipped = t.skippedLinks; } catch (e) { return fail(e instanceof TarError ? e.code : "COPY_FAILED"); }
    const S = await this.prepare();
    if (!S) return fail("SCRATCH_CREATE_FAILED");
    try {
      const x = await this.wsl(["/bin/tar", "-x", "--no-same-owner", "--no-same-permissions", "-C", `${S}/work`], 120_000, tar);
      if (x.exitCode !== 0) return fail("COPY_IN_FAILED");
      const st = await this.stageSandbox(S, opts.timeoutMs, wslEnv(opts.env), command);
      if (st !== "OK") return fail(st);
      const t0 = Date.now();
      const r = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], opts.timeoutMs, opts.input, opts.shouldAbort);
      const elapsed = Date.now() - t0;
      const timedOut = r.timedOut || ((r.exitCode === 137 || r.exitCode === 124) && elapsed >= opts.timeoutMs * 0.9);
      const note = skipped > 0 ? `\n[sandbox] ${skipped} symbolic link(s)/special file(s) were not copied into WSL\n` : "";
      return {argv, exitCode: timedOut ? null : r.exitCode, stdout: decodeWslText(r.stdout), stderr: decodeWslText(r.stderr) + note, startedAt, endedAt: now(), timedOut, aborted: r.aborted, spawnError: r.spawnError};
    } finally { await this.cleanup(S); }
  }

  selfTest(): Promise<{ok: boolean; detail?: string}> {
    return this.probing ??= this.probe().then(r => { this.verified = r.ok; this.lastSelfTest = r; return r; }, () => { this.verified = false; this.lastSelfTest = {ok: false, detail: "SELFTEST_ERROR"}; return this.lastSelfTest; });
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
    const S = await this.prepare();
    if (!S) return no("SCRATCH_CREATE_FAILED");
    try {
      if (!(await this.put(S, "outer.sh", OUTER_SCRIPT))) return no("PROBE_FAILED");
      const outer = await this.wsl(["/bin/sh", `${S}/ctl/outer.sh`], 30_000);
      const o = decodeWslText(outer.stdout);
      if (outer.exitCode !== 0 || !/^DONE=1$/m.test(o)) return no("PROBE_FAILED");
      if (!/^INTEROP=(absent|disabled)$/m.test(o)) return no("INTEROP_ENABLED");
      if (!/^TOOLS=ok$/m.test(o)) return no("WSL_TOOLS_MISSING");
      let root: string | null = null;
      for (const c of ROOT_CANDIDATES) if (!root && (await this.wsl(["/usr/bin/test", "-d", c], 15_000)).exitCode === 0) root = c;
      if (!root) return no("NO_NEW_ROOT_MOUNTPOINT");
      this.newRoot = root;
      const st = await this.stageSandbox(S, 60_000, [], ["/bin/sh", "-c", PROBE_SCRIPT]);
      if (st !== "OK") return no(st === "STAGE_FAILED" ? "PROBE_FAILED" : st);
      const r = await this.wsl(["/bin/sh", `${S}/ctl/run.sh`], 60_000);
      if (r.exitCode !== 0) return no("PROBE_FAILED");
      const ev = evaluateProbe(decodeWslText(r.stdout));
      return ev.ok ? {ok: true} : {ok: false, detail: ev.reason};
    } finally { await this.cleanup(S); }
  }
}
