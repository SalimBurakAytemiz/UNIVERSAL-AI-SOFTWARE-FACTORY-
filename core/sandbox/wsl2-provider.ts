// //TR: DSK-T0007 Windows WSL2 sandbox sağlayıcısı. Yalnız UASCO'ya AYRILMIŞ "UASCO-Sandbox" dağıtımı kullanılır (kullanıcının dağıtımı asla); Windows sürücüsü otomatik bağlama ve interop kapalıdır (/etc/wsl.conf birebir denetlenir). Her süreç konuk İÇİNDE repodaki Linux izolasyonuyla (unshare + pivot_root + salt-okunur kök + ulimit/nproc, yetkiler bırakılmış) ve AĞSIZ bir namespace'te çalışır; model sürecinin tek çıkışı çalışma dizinine bağlanan unix soketi üzerinden konuktaki izin listeli CONNECT proxy'sidir (egress-proxy). Çalışma alanı ve YALNIZ ilgili rol profili tar ile içeri aktarılır, değişiklikler geri alınır; Windows yolu konuğa hiç geçmez (mapModelProcess). Öz-test (negatif sondalar) geçmeden hiçbir şey çalışmaz (NOT_EXECUTED); iptal/Acil Durdur süreç ağacını öldürür, gerekirse dağıtımı kapatır (wsl --terminate). Bu modül burada yalnız sahte wsl çalıştırıcısıyla sınanır; GERÇEK izolasyon yalnız uyumlu bir Windows makinesindeki kabul koşusuyla kanıtlanır.
import cp from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import type {SpawnOptions, ChildProcess} from "node:child_process";
import type {SandboxProvider, SandboxRunOptions} from "../workos/execution-gate.js";
import type {ProcResult} from "../workos/executors.js";
import {LINUX_ISOLATION} from "../agents/linux-unshare-sandbox.js";

export const WSL_DISTRO = "UASCO-Sandbox";
export const WSL2_SANDBOX_ID = "wsl2-uasco-v1";
/** Exact /etc/wsl.conf the dedicated distribution must carry (checked byte for byte). */
export const WSL_CONF = ["[automount]", "enabled=false", "mountFsTab=false", "", "[interop]", "enabled=false", "appendWindowsPath=false", "", "[user]", "default=uasco", ""].join("\n");
/** Guest layout (Linux paths only). */
export const GUEST = Object.freeze({node: "/opt/uasco/node/bin/node", claude: "/opt/uasco/claude/bin/claude", app: "/opt/uasco/app", sbx: "/opt/uasco/sbx", runs: "/var/uasco/runs", home: "/home/uasco"});
export const RELAY_PORT = 18443;
export type WslRefusal = "PLATFORM_NOT_WIN32" | "WSL_EXE_MISSING" | "DISTRO_MISSING" | "DISTRO_NOT_WSL2" | "WSL_CONF_MISMATCH" | "AUTOMOUNT_ACTIVE" | "INTEROP_ACTIVE"
  | "GUEST_TOOLS_MISSING" | "GUEST_PIN_MISMATCH" | `PROBE_${string}` | "SELFTEST_ERROR";

export interface WslRunResult { exitCode: number | null; stdout: Buffer; stderr: Buffer; timedOut: boolean; aborted: boolean }
export type WslRunner = (args: string[], o: {input?: Buffer | string; timeoutMs: number; shouldAbort?: () => boolean}) => Promise<WslRunResult>;
export interface Wsl2Options {
  platform?: NodeJS.Platform; runner?: WslRunner; systemRoot?: string;
  /** sha256 pins of the guest toolchain written at provisioning (node binary, claude CLI entry). */
  pins?: {node: string; claude: string};
  /** Host path roots the mapper translates (the app install dir and the UASCO control root). */
  hostAppRoot?: string; hostControlRoot?: string;
  /** Host-side archive helpers (default: the system tar; on Windows the absolute System32\\tar.exe). */
  hostTar?: (dir: string, exclude?: string[]) => Buffer;
}
const sysTar = (systemRoot?: string) => process.platform === "win32" ? path.win32.join(systemRoot ?? process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
export const defaultHostTar = (systemRoot?: string) => (dir: string, exclude: string[] = []): Buffer => {
  const r = cp.spawnSync(sysTar(systemRoot), ["-c", "-f", "-", ...exclude.flatMap(e => ["--exclude", e]), "-C", dir, "."], {maxBuffer: 1024 * 1024 * 1024, windowsHide: true});
  if (r.status !== 0) throw new Error("HOST_TAR_FAILED"); return r.stdout;
};

/** `wsl.exe -l -v` prints UTF-16LE; returns rows {name, state, version, isDefault}. */
export function parseWslList(raw: Buffer | string): Array<{name: string; state: string; version: number; isDefault: boolean}> {
  const text = typeof raw === "string" ? raw : (raw.length > 1 && raw[1] === 0 ? raw.toString("utf16le") : raw.toString("utf8"));
  return text.replace(/\u0000/g, "").split(/\r?\n/).slice(1).map(l => /^\s*(\*)?\s*(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(l)).filter(Boolean)
    .map(m => ({name: m![2], state: m![3], version: Number(m![4]), isDefault: m![1] === "*"}));
}
export const wslExe = (systemRoot = process.env.SystemRoot ?? "C:\\Windows"): string => path.win32.join(systemRoot, "System32", "wsl.exe");

/** Default runner: absolute wsl.exe, no shell, bounded capture; abort/timeout kill the tree (taskkill) and stop the distro's run processes. */
export function defaultWslRunner(exe: string): WslRunner {
  return (args, o) => new Promise(resolve => {
    const child = cp.spawn(exe, args, {shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
    const out: Buffer[] = [], err: Buffer[] = []; let size = 0, timedOut = false, aborted = false, done = false;
    const cap = (a: Buffer[]) => (d: Buffer) => { size += d.length; if (size <= 64 * 1024 * 1024) a.push(d); };
    child.stdout.on("data", cap(out)); child.stderr.on("data", cap(err));
    const kill = () => { if (child.pid) cp.spawnSync(path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"], {windowsHide: true, stdio: "ignore"}); };
    const t = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
    const poll = o.shouldAbort ? setInterval(() => { if (o.shouldAbort!()) { aborted = true; kill(); } }, 250) : null;
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(t); if (poll) clearInterval(poll); resolve({exitCode: code, stdout: Buffer.concat(out), stderr: Buffer.concat(err), timedOut, aborted}); };
    child.on("error", () => finish(null)); child.on("close", c => finish(c));
    if (o.input !== undefined) child.stdin.end(o.input); else child.stdin.end();
  });
}

const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
/** The isolation script with loopback brought up BEFORE capabilities are dropped (the relay needs 127.0.0.1 inside the netns). */
export function guestIsolationScript(): string {
  const anchor = 'SETPRIV=$(command -v setpriv) && SUPSH=$(command -v sh) || exit 126';
  if (!LINUX_ISOLATION.setup.includes(anchor)) throw new Error("LINUX_ISOLATION_ANCHOR_MISSING");
  return LINUX_ISOLATION.setup.replace(anchor, `${anchor}\nIPB=$(command -v ip) || exit 126; "$IPB" link set lo up || exit 126`);
}
/** Inner relay: listens on 127.0.0.1:PORT inside the netns, forwards to the egress unix socket, runs the model command with HTTPS_PROXY and exits with its code. */
export const RELAY_JS = [
  'const net=require("node:net"),cp=require("node:child_process");const [port,sock,...cmd]=process.argv.slice(2);',
  'const srv=net.createServer(c=>{const u=net.connect(sock);c.pipe(u);u.pipe(c);u.on("error",()=>c.destroy());c.on("error",()=>u.destroy());});',
  'srv.listen(Number(port),"127.0.0.1",()=>{const env={...process.env,HTTPS_PROXY:"http://127.0.0.1:"+port,HTTP_PROXY:"http://127.0.0.1:"+port,NO_PROXY:""};',
  'const ch=cp.spawn(cmd[0],cmd.slice(1),{stdio:"inherit",env});ch.on("exit",(c,s)=>{srv.close();process.exit(c===null?137:c);});});'
].join("");
/** Allowed environment inside the guest (everything else, incl. any Windows variable or API key, is dropped). */
export const GUEST_ENV_KEYS = ["CLAUDE_CONFIG_DIR", "UASCO_CONTROL_ROOT", "UASCO_PAID_API_ALLOWED", "UASCO_PROVIDER", "UASCO_WRITER_RUN", "UASCO_WRITER_LEASE", "LANG", "TERM"];

/** Probe script run INSIDE the isolated namespace; each line KEY=VALUE, evaluated fail-closed. */
export const PROBE_SCRIPT = [
  'p(){ printf "%s=%s\\n" "$1" "$2"; }',
  '[ -e /mnt/c ] && p mnt_c present || p mnt_c absent',
  '[ -e /proc/sys/fs/binfmt_misc/WSLInterop ] || [ -e /proc/sys/fs/binfmt_misc/WSLInterop-late ] && p interop present || p interop absent',
  'grep -qiE " (drvfs|9p) " /proc/self/mountinfo && p windows_mounts present || p windows_mounts absent',
  'ls /home 2>/dev/null | grep -q . && p home_visible yes || p home_visible no',
  '(echo x > /etc/uasco_probe) 2>/dev/null && p root_write yes || p root_write no',
  '(echo x > /work/.probe && rm -f /work/.probe) 2>/dev/null && p work_write yes || p work_write no',
  `${GUEST.node} -e 'const s=require("net").connect({host:"1.1.1.1",port:443,timeout:3000});s.on("connect",()=>{console.log("direct_egress=open");process.exit(0)});s.on("error",()=>{console.log("direct_egress=blocked");process.exit(0)});s.on("timeout",()=>{console.log("direct_egress=blocked");process.exit(0)})'`,
  'env | grep -qiE "^(ANTHROPIC_API_KEY|USERPROFILE|APPDATA|WSLENV|GITHUB_TOKEN)=" && p env_leak yes || p env_leak no',
  'grep -q "^CapEff:\\s*0*$" /proc/self/status && p caps dropped || p caps present',
  'p done 1'
].join("\n");
const PROBE_EXPECT: Record<string, string> = {mnt_c: "absent", interop: "absent", windows_mounts: "absent", home_visible: "no", root_write: "no", work_write: "yes", direct_egress: "blocked", env_leak: "no", caps: "dropped", done: "1"};
export function evaluateProbe(stdout: string): {ok: true} | {ok: false; reason: `PROBE_${string}`} {
  const kv = new Map(stdout.split(/\r?\n/).map(l => /^([a-z_]+)=(\S+)$/.exec(l)).filter(Boolean).map(m => [m![1], m![2]] as [string, string]));
  for (const [k, v] of Object.entries(PROBE_EXPECT)) if (kv.get(k) !== v) return {ok: false, reason: `PROBE_${k.toUpperCase()}`};
  return {ok: true};
}
export const checkWslConf = (text: string): boolean => text.replace(/\r\n/g, "\n").trim() === WSL_CONF.trim();

/** One run's guest scratch: /var/uasco/runs/<key>/{repo,profile,.egress.sock}; the key is derived (no host path text reaches the guest). */
/** Fresh random key per mapping: two simultaneous tasks (even on the same host path) never share a guest scratch or a host mapping. */
export const runKey = (): string => crypto.randomBytes(12).toString("hex");

export class Wsl2SandboxProvider implements SandboxProvider {
  readonly id = WSL2_SANDBOX_ID;
  readonly linuxGuest = true;
  lastRefusal: WslRefusal | null = null;
  private verified = false;
  private readonly hostOf = new Map<string, {cwd: string; profile: string | null}>();
  private readonly inFlight = new Set<string>();
  private probing: Promise<{ok: boolean; detail?: string}> | null = null;
  constructor(private readonly o: Wsl2Options = {}) {}
  private get runner(): WslRunner { return this.o.runner ?? defaultWslRunner(wslExe(this.o.systemRoot)); }
  /** Every guest command runs in the dedicated distro as root of its own isolation (never the user's distro, never via a shell on the host). */
  private exec(cmd: string[], o: {input?: Buffer | string; timeoutMs?: number; shouldAbort?: () => boolean} = {}) {
    return this.runner(["-d", WSL_DISTRO, "-u", "root", "--exec", ...cmd], {timeoutMs: o.timeoutMs ?? 60_000, input: o.input, shouldAbort: o.shouldAbort});
  }
  selfTest(): Promise<{ok: boolean; detail?: string}> {
    return this.probing ??= this.probe().then(r => { this.verified = r.ok; this.lastRefusal = r.ok ? null : (r.detail as WslRefusal); return r; }, () => { this.verified = false; this.lastRefusal = "SELFTEST_ERROR"; return {ok: false, detail: "SELFTEST_ERROR"}; });
  }
  private async probe(): Promise<{ok: boolean; detail?: WslRefusal}> {
    if ((this.o.platform ?? process.platform) !== "win32" && !this.o.runner) return {ok: false, detail: "PLATFORM_NOT_WIN32"};
    const list = await this.runner(["-l", "-v"], {timeoutMs: 30_000});
    if (list.exitCode === null) return {ok: false, detail: "WSL_EXE_MISSING"};
    const row = parseWslList(list.stdout).find(r => r.name === WSL_DISTRO);
    if (!row) return {ok: false, detail: "DISTRO_MISSING"};
    if (row.version !== 2) return {ok: false, detail: "DISTRO_NOT_WSL2"};
    const conf = await this.exec(["/bin/cat", "/etc/wsl.conf"]);
    if (conf.exitCode !== 0 || !checkWslConf(conf.stdout.toString("utf8"))) return {ok: false, detail: "WSL_CONF_MISMATCH"};
    const outer = await this.exec(["/bin/sh", "-c", "[ -e /mnt/c ] && echo AUTOMOUNT; [ -e /proc/sys/fs/binfmt_misc/WSLInterop ] && echo INTEROP; for t in unshare setpriv ip tar; do command -v $t >/dev/null || echo MISSING; done; sha256sum " + sq(GUEST.node) + " " + sq(GUEST.claude)]);
    const ot = outer.stdout.toString("utf8");
    if (/AUTOMOUNT/.test(ot)) return {ok: false, detail: "AUTOMOUNT_ACTIVE"};
    if (/INTEROP/.test(ot)) return {ok: false, detail: "INTEROP_ACTIVE"};
    if (/MISSING/.test(ot) || outer.exitCode !== 0) return {ok: false, detail: "GUEST_TOOLS_MISSING"};
    if (!this.o.pins || !ot.includes(this.o.pins.node) || !ot.includes(this.o.pins.claude)) return {ok: false, detail: "GUEST_PIN_MISMATCH"};
    const pr = await this.isolated("selftest", ["/bin/sh", "-c", PROBE_SCRIPT], {env: {}, timeoutMs: 60_000});
    const ev = evaluateProbe(pr.stdout.toString("utf8"));
    return ev.ok ? {ok: true} : {ok: false, detail: ev.reason};
  }
  /** Runs `argv` inside the isolated, network-less namespace of the guest scratch dir (no egress unless `egress`). */
  private isolated(key: string, argv: string[], o: {env: NodeJS.ProcessEnv; timeoutMs: number; input?: string; shouldAbort?: () => boolean; egress?: boolean}) {
    const scratch = `${GUEST.runs}/${key}`, cpu = Math.max(1, Math.ceil(o.timeoutMs / 1000)) + 5;
    const env = Object.entries(o.env).filter(([k]) => GUEST_ENV_KEYS.includes(k)).map(([k, v]) => `${k}=${v}`);
    const inner = o.egress ? [GUEST.node, `${GUEST.sbx}/relay.cjs`, String(RELAY_PORT), "/work/.egress.sock", ...argv] : argv;
    // egress: the allow-list proxy runs in the guest's OUTER namespace on a unix socket inside the scratch dir (seen as /work/.egress.sock inside); it is killed when the run ends
    const proxy = o.egress ? `${GUEST.node} ${GUEST.sbx}/egress.cjs ${sq(`${scratch}/.egress.sock`)} & PP=$!; trap 'kill $PP 2>/dev/null' EXIT; ` : "";
    const script = `mkdir -p ${sq(scratch)} && ${proxy}${o.egress ? "" : "exec "}/usr/bin/env -i PATH=/usr/bin:/bin HOME=${GUEST.home} ${env.map(sq).join(" ")} /usr/bin/unshare ${LINUX_ISOLATION.nsFlags.join(" ")} /bin/sh -c "$0" sh ${sq(scratch)} ${cpu} ${16 * 1024 * 1024} ${2 * 1024 * 1024} /mnt ${sq("/opt/uasco")} 256 ${inner.map(sq).join(" ")}`;
    return this.exec(["/bin/sh", "-c", script, guestIsolationScript()], {timeoutMs: o.timeoutMs, input: o.input, shouldAbort: o.shouldAbort});
  }
  /** Windows host -> Linux guest mapping. Only known roots map; anything else is refused (null). */
  mapModelProcess(argv: string[], o: {cwd: string; env: NodeJS.ProcessEnv}): {argv: string[]; cwd: string; env: NodeJS.ProcessEnv} | null {
    let key = runKey(); while (this.hostOf.has(key)) key = runKey();
    const app = this.o.hostAppRoot, root = `${GUEST.runs}/${key}`;
    this.hostOf.set(key, {cwd: o.cwd, profile: typeof o.env.CLAUDE_CONFIG_DIR === "string" ? o.env.CLAUDE_CONFIG_DIR : null});
    const mapArg = (a: string, i: number): string | null => {
      if (i === 0) return /node(\.exe)?$/i.test(a) || a === process.execPath ? GUEST.node : /claude(\.exe|\.cmd)?$/i.test(a) ? GUEST.claude : null;
      if (app && path.win32.resolve(a).toLowerCase().startsWith(path.win32.resolve(app).toLowerCase() + "\\")) return `${GUEST.app}/${path.win32.relative(app, a).replace(/\\/g, "/")}`;
      return /^[A-Za-z]:[\\/]|\\/.test(a) ? null : a;
    };
    const out: string[] = [];
    for (const [i, a] of argv.entries()) { const m = mapArg(a, i); if (m === null) return null; out.push(m); }
    const env: NodeJS.ProcessEnv = {...Object.fromEntries(Object.entries(o.env).filter(([k]) => GUEST_ENV_KEYS.includes(k))), CLAUDE_CONFIG_DIR: "/work/profile", UASCO_CONTROL_ROOT: "/opt/uasco/control"};
    return {argv: out, cwd: `${root}/repo`, env};
  }
  run(argv: string[], opts: SandboxRunOptions): Promise<ProcResult> {
    const at = new Date().toISOString();
    const refuse = (why: string): ProcResult => ({argv, exitCode: null, stdout: "", stderr: `NOT_EXECUTED: ${why}`, startedAt: at, endedAt: new Date().toISOString(), timedOut: false, aborted: false, spawnError: true});
    if (!this.verified) return Promise.resolve(refuse("SANDBOX_NOT_VERIFIED"));
    const m = /^\/var\/uasco\/runs\/([0-9a-f]{24})\/repo$/.exec(opts.cwd);
    if (!m) return Promise.resolve(refuse("CWD_NOT_MAPPED"));
    if (argv.some(a => /^[A-Za-z]:[\\/]|\\/.test(a))) return Promise.resolve(refuse("WINDOWS_PATH_IN_ARGV"));
    const key = m[1], host = this.hostOf.get(key);
    if (!host) return Promise.resolve(refuse("RUN_NOT_MAPPED"));
    if (this.inFlight.has(key)) return Promise.resolve(refuse("RUN_KEY_IN_USE")); // one mapping = one run
    this.inFlight.add(key);
    return this.runMapped(key, host, argv, opts, at).catch((e: Error) => refuse(/^(UNSAFE_|TAR_)/.test(e?.message ?? "") ? e.message : "TRANSFER_FAILED")).finally(() => this.inFlight.delete(key));
  }
  /** In: workspace (incl. .git) and ONLY the role profile; run isolated; out: workspace changes (mirror, .git excluded on the host side) and refreshed credentials; scratch always removed. */
  private async runMapped(key: string, host: {cwd: string; profile: string | null}, argv: string[], opts: SandboxRunOptions, at: string): Promise<ProcResult> {
    const tar = this.o.hostTar ?? defaultHostTar(this.o.systemRoot), scratch = `${GUEST.runs}/${key}`;
    const put = async (sub: string, data: Buffer) => { const r = await this.exec(["/bin/sh", "-c", `rm -rf ${sq(`${scratch}/${sub}`)} && mkdir -p ${sq(`${scratch}/${sub}`)} && tar -x -f - -C ${sq(`${scratch}/${sub}`)}`], {input: data, timeoutMs: 300_000}); if (r.exitCode !== 0) throw new Error("PUT"); };
    try {
      await put("repo", tar(host.cwd));
      if (host.profile) await put("profile", tar(host.profile));
      const egress = argv[0] === GUEST.node || argv[0] === GUEST.claude;
      const r = await this.isolated(key, ["/bin/sh", "-c", 'cd /work/repo && exec "$@"', "sh", ...argv], {env: opts.env, timeoutMs: opts.timeoutMs, input: opts.input, shouldAbort: opts.shouldAbort, egress});
      if (r.aborted || opts.shouldAbort?.()) await this.stopAll();
      // Guest output is UNTRUSTED: parsed by our own strict reader (no host tar, no links, no traversal), validated in full before any host write.
      const back = await this.exec(["/bin/sh", "-c", `cd ${sq(`${scratch}/repo`)} && find . -path ./.git -prune -o -type f -print && printf '\\0' && { find . -mindepth 1 -path ./.git -prune -o \\( -type f -o -type d \\) -print0 | tar -c -f - --format=ustar --no-recursion --null -T -; }`], {timeoutMs: 300_000});
      const sep = back.stdout.indexOf(0);
      if (back.exitCode !== 0 || sep < 0) throw new Error("TAR_BACK_FAILED");
      safeMirror(host.cwd, back.stdout.subarray(0, sep).toString("utf8").split("\n").filter(Boolean), back.stdout.subarray(sep + 1));
      if (host.profile) { const c = await this.exec(["/bin/sh", "-c", `cd ${sq(`${scratch}/profile`)} && [ -f .credentials.json ] && [ ! -L .credentials.json ] && tar -c -f - --format=ustar .credentials.json`], {timeoutMs: 60_000}); if (c.exitCode === 0 && c.stdout.length) safeCredentialsBack(host.profile, c.stdout); }
      return {argv, exitCode: r.aborted || r.timedOut ? null : r.exitCode, stdout: r.stdout.toString("utf8"), stderr: r.stderr.toString("utf8"), startedAt: at, endedAt: new Date().toISOString(), timedOut: r.timedOut, aborted: r.aborted, spawnError: r.exitCode === null && !r.timedOut && !r.aborted};
    } finally {
      await this.exec(["/bin/rm", "-rf", scratch], {timeoutMs: 60_000}).catch(() => undefined);
      this.hostOf.delete(key);
    }
  }
  /** Global Stop / cancel: kill every isolated run process; if that fails, terminate the whole distro. */
  async stopAll(): Promise<void> {
    const r = await this.exec(["/bin/sh", "-c", `pkill -KILL -f ${sq(GUEST.runs)} || true`], {timeoutMs: 10_000});
    if (r.exitCode !== 0) await this.runner(["--terminate", WSL_DISTRO], {timeoutMs: 30_000});
  }
  spawn(_c: string, _a: string[], _o: SpawnOptions): ChildProcess { throw new Error("WSL2_SPAWN_NOT_SUPPORTED: use run()"); }
}

// ---------- Untrusted guest archive -> Windows host (path traversal / link / outside-write safe) ----------
export const TAR_LIMITS = Object.freeze({maxEntries: 20_000, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024});
export interface TarEntry { path: string; type: "file" | "dir"; data: Buffer }
/** Relative, forward-slash, no ".."/"."/empty segment, no absolute/drive/backslash/NUL/colon, no .git, no Windows-reserved names. Returns the canonical path or null. */
export function safeRelPath(raw: string): string | null {
  const p = raw.replace(/^\.\//, "").replace(/\/$/, "");
  if (!p || p.length > 1024 || /[\\\u0000:*?"<>|]/.test(p) || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return null;
  const parts = p.split("/");
  for (const s of parts) if (!s || s === "." || s === ".." || /[. ]$/.test(s) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) return null;
  if (parts[0].toLowerCase() === ".git") return null;
  return parts.join("/");
}
const field = (h: Buffer, o: number, n: number) => h.subarray(o, o + n).toString("latin1").replace(/\0.*$/s, "");
/** Strict ustar reader: only regular files and directories; any link, device, fifo, pax/GNU extension, bad checksum or limit breach rejects the WHOLE archive. */
export function readTarSafe(buf: Buffer): {ok: true; entries: TarEntry[]} | {ok: false; reason: string} {
  const out: TarEntry[] = []; let off = 0, total = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) return {ok: true, entries: out};
    const sum = [...h].reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
    if (Number.parseInt(field(h, 148, 8).trim() || "x", 8) !== sum) return {ok: false, reason: "TAR_BAD_CHECKSUM"};
    if (!field(h, 257, 6).startsWith("ustar")) return {ok: false, reason: "TAR_NOT_USTAR"};
    const t = String.fromCharCode(h[156] || 48);
    if (t !== "0" && t !== "5") return {ok: false, reason: `UNSAFE_TAR_TYPE_${t === "1" ? "HARDLINK" : t === "2" ? "SYMLINK" : t === "x" || t === "g" ? "PAX" : t === "L" || t === "K" ? "GNU_LONG" : "SPECIAL"}`};
    const name = [field(h, 345, 155), field(h, 0, 100)].filter(Boolean).join("/");
    const rel = safeRelPath(name);
    if (rel === null) return {ok: false, reason: "UNSAFE_TAR_PATH"};
    const size = Number.parseInt(field(h, 124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || size > TAR_LIMITS.maxFileBytes || (t === "5" && size !== 0)) return {ok: false, reason: "UNSAFE_TAR_SIZE"};
    total += size; if (total > TAR_LIMITS.maxTotalBytes || out.length >= TAR_LIMITS.maxEntries) return {ok: false, reason: "UNSAFE_TAR_LIMIT"};
    const start = off + 512, end = start + size;
    if (end > buf.length) return {ok: false, reason: "TAR_TRUNCATED"};
    out.push({path: rel, type: t === "5" ? "dir" : "file", data: t === "5" ? Buffer.alloc(0) : Buffer.from(buf.subarray(start, end))});
    off = start + Math.ceil(size / 512) * 512;
  }
  return {ok: false, reason: "TAR_TRUNCATED"};
}
/** Every existing component from the root down to the target must be a real directory (never a link/junction); the target, if present, a regular file. */
function hostPathSafe(root: string, rel: string, target: "file" | "dir"): boolean {
  let cur = root; const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st: fs.Stats; try { st = fs.lstatSync(cur); } catch { return true; } // the rest does not exist yet: created as real dirs/files
    if (st.isSymbolicLink()) return false;
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) return false;
    if (last && (target === "dir" ? !st.isDirectory() : !st.isFile())) return false;
  }
  return true;
}
/** Mirror the guest workspace onto the host workspace: validate everything first, then delete host files absent in the guest (never .git, never through links), then write. Nothing outside `hostDir` is touched. */
export function safeMirror(hostDir: string, guestFiles: string[], tarData: Buffer): void {
  const root = fs.realpathSync(hostDir);
  const t = readTarSafe(tarData); if (!t.ok) throw new Error(t.reason);
  const keep = new Set<string>();
  for (const f of guestFiles) { const r = safeRelPath(f); if (r === null) throw new Error("UNSAFE_FILE_LIST"); keep.add(r); }
  for (const e of t.entries) if (!hostPathSafe(root, e.path, e.type)) throw new Error("UNSAFE_HOST_LINK");
  for (const e of t.entries) if (e.type === "file" && !keep.has(e.path)) throw new Error("UNSAFE_UNLISTED_FILE");
  const walk = (rel: string): string[] => fs.readdirSync(path.join(root, rel), {withFileTypes: true}).flatMap(d => {
    const r = rel ? `${rel}/${d.name}` : d.name; if (!rel && d.name === ".git") return [];
    return d.isDirectory() && !d.isSymbolicLink() ? walk(r) : [r];
  });
  for (const f of walk("")) if (!keep.has(f)) fs.rmSync(path.join(root, f), {force: true}); // removes a link itself, never its target
  for (const e of t.entries) {
    const dest = path.join(root, e.path);
    if (path.relative(root, dest).startsWith("..")) throw new Error("UNSAFE_TAR_PATH");
    if (e.type === "dir") { fs.mkdirSync(dest, {recursive: true}); continue; }
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    if (!hostPathSafe(root, e.path, "file")) throw new Error("UNSAFE_HOST_LINK"); // re-check just before the write
    fs.writeFileSync(dest, e.data, {flag: "w"});
  }
}
/** Only `.credentials.json`, a regular file, into a real (non-link) profile dir. */
export function safeCredentialsBack(profileDir: string, tarData: Buffer): void {
  const t = readTarSafe(tarData); if (!t.ok) throw new Error(t.reason);
  if (t.entries.length !== 1 || t.entries[0].path !== ".credentials.json" || t.entries[0].type !== "file") throw new Error("UNSAFE_CREDENTIALS_ARCHIVE");
  const st = fs.lstatSync(profileDir); if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("UNSAFE_HOST_LINK");
  const dest = path.join(profileDir, ".credentials.json");
  try { if (fs.lstatSync(dest).isSymbolicLink()) throw new Error("UNSAFE_HOST_LINK"); } catch (e) { if ((e as Error).message === "UNSAFE_HOST_LINK") throw e; }
  fs.writeFileSync(dest, t.entries[0].data, {mode: 0o600});
}

/** Provisioning plan for the dedicated distro (every artifact sha256-pinned; refused without pins). */
export interface ProvisionInput { installDir: string; rootfs: {path: string; sha256: string}; node: {path: string; sha256: string}; claude: {path: string; sha256: string}; appScriptsTar: {path: string; sha256: string}; nodeBinarySha256: string; claudeBinarySha256: string }
/** The pinned official artifacts (core/sandbox/wsl2-artifacts.json): download locations and exact hashes. */
export const WSL2_ARTIFACTS = JSON.parse(fs.readFileSync(new URL("./wsl2-artifacts.json", import.meta.url), "utf8")) as Record<"rootfs" | "node" | "claude", {url: string; sha256: string; binarySha256?: string}>;
const HEX64 = /^[0-9a-f]{64}$/;
export function provisionPlan(i: ProvisionInput): {ok: true; steps: Array<{what: string; args: string[]; guest: boolean; input?: string; inputFile?: string; verify?: {path: string; sha256: string}}>} | {ok: false; error: string} {
  for (const [k, v] of Object.entries({rootfs: i.rootfs, node: i.node, claude: i.claude, app: i.appScriptsTar})) if (!v || !HEX64.test(v.sha256) || typeof v.path !== "string" || !v.path) return {ok: false, error: `PIN_MISSING_${k.toUpperCase()}`};
  if (!HEX64.test(i.nodeBinarySha256 ?? "") || !HEX64.test(i.claudeBinarySha256 ?? "")) return {ok: false, error: "PIN_MISSING_BINARY"};
  // only the official pinned artifacts (an unknown rootfs/node/claude, even with a self-consistent hash, is untrusted)
  for (const [k, v] of [["rootfs", i.rootfs], ["node", i.node], ["claude", i.claude]] as const) if (v.sha256 !== WSL2_ARTIFACTS[k].sha256) return {ok: false, error: `ARTIFACT_NOT_PINNED_${k.toUpperCase()}`};
  if (i.nodeBinarySha256 !== WSL2_ARTIFACTS.node.binarySha256 || i.claudeBinarySha256 !== WSL2_ARTIFACTS.claude.binarySha256) return {ok: false, error: "ARTIFACT_NOT_PINNED_BINARY"};
  if (!/^[A-Za-z]:\\/.test(i.installDir)) return {ok: false, error: "INSTALL_DIR_NOT_ABSOLUTE_WINDOWS"};
  const g = (what: string, cmd: string, input?: string) => ({what, args: ["-d", WSL_DISTRO, "-u", "root", "--exec", "/bin/sh", "-c", cmd], guest: true, ...(input !== undefined ? {input} : {})});
  return {ok: true, steps: [
    {what: "import the dedicated distro (never the user's)", args: ["--import", WSL_DISTRO, i.installDir, i.rootfs.path, "--version", "2"], guest: false, verify: i.rootfs},
    g("write wsl.conf (no automount, no interop)", "cat > /etc/wsl.conf", WSL_CONF),
    {what: "restart to apply wsl.conf", args: ["--terminate", WSL_DISTRO], guest: false},
    g("user and layout", `id uasco >/dev/null 2>&1 || useradd -m uasco; mkdir -p /opt/uasco/node /opt/uasco/claude /opt/uasco/app /opt/uasco/sbx /opt/uasco/control ${GUEST.runs} && chmod 0755 /opt/uasco && chmod 0700 ${GUEST.runs}`),
    g("install relay", `cat > ${GUEST.sbx}/relay.cjs`, RELAY_JS),
    {what: "install the pinned Linux node", args: ["-d", WSL_DISTRO, "-u", "root", "--exec", "/bin/sh", "-c", `echo ${i.node.sha256}  - > /tmp/n.sha; tee /tmp/node.tar.xz | sha256sum -c /tmp/n.sha >/dev/null && tar -x -J -f /tmp/node.tar.xz -C /opt/uasco/node --strip-components=1`], guest: true, inputFile: i.node.path, verify: i.node} as never,
    {what: "install the pinned Linux Claude Code CLI", args: ["-d", WSL_DISTRO, "-u", "root", "--exec", "/bin/sh", "-c", `echo ${i.claude.sha256}  - > /tmp/c.sha; tee /tmp/claude.tgz | sha256sum -c /tmp/c.sha >/dev/null && tar -x -z -f /tmp/claude.tgz -C /opt/uasco/claude --strip-components=1 package/claude && chmod 0755 /opt/uasco/claude/claude && mkdir -p /opt/uasco/claude/bin && ln -sf ../claude /opt/uasco/claude/bin/claude`], guest: true, inputFile: i.claude.path, verify: i.claude} as never,
    {what: "install the pinned app scripts (broker, egress proxy)", args: ["-d", WSL_DISTRO, "-u", "root", "--exec", "/bin/sh", "-c", `echo ${i.appScriptsTar.sha256}  - > /tmp/a.sha; tee /tmp/app.tar | sha256sum -c /tmp/a.sha >/dev/null && rm -rf /opt/uasco/app && mkdir -p /opt/uasco/app && tar -x -f /tmp/app.tar -C /opt/uasco/app && cp /opt/uasco/app/sbx/egress.cjs ${GUEST.sbx}/egress.cjs`], guest: true, inputFile: i.appScriptsTar.path, verify: i.appScriptsTar} as never,
    g("guest control root: broker config + guest-side Claude provenance (the launcher inside the guest, pinned binary hash)",
      `mkdir -p /opt/uasco/control/config /opt/uasco/control/.ai/runtime && cp /opt/uasco/app/config/automation.json /opt/uasco/app/config/builder-execution-policy.json /opt/uasco/app/config/environment-policy.json /opt/uasco/control/config/ && V=$(${GUEST.claude} --version | head -n1) && ${GUEST.node} -e 'require("fs").writeFileSync("/opt/uasco/control/.ai/runtime/PROVIDER_PROVENANCE.json",JSON.stringify({final:"PASS",claude:{provenanceLevel:"STANDALONE_LAUNCHER",resolvedPath:"/opt/uasco/claude/claude",launcherSha256:process.argv[1],version:process.argv[2]}}))' ${i.claudeBinarySha256} "$V" && chmod -R a-w /opt/uasco/control`),
    g("verify the guest toolchain pins (binary sha256 from wsl2-artifacts.json)", `echo "${i.nodeBinarySha256}  ${GUEST.node}\n${i.claudeBinarySha256}  ${GUEST.claude}" | sha256sum -c -`)
  ]};
}

/** Executes a provision plan (host wsl.exe only; artifacts streamed from pinned files, verified inside the guest). Stops at the first failing step. */
export async function provision(plan: ReturnType<typeof provisionPlan>, runner: WslRunner, readFile: (p: string) => Buffer = p => fs.readFileSync(p), sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex")): Promise<{ok: true} | {ok: false; step: string}> {
  if (!plan.ok) return {ok: false, step: plan.error};
  for (const st of plan.steps) {
    // the artifact is verified on the HOST before it is imported/streamed (missing, changed or unpinned = stop); the guest re-verifies after transfer
    if (st.verify) { let b: Buffer; try { b = readFile(st.verify.path); } catch { return {ok: false, step: `ARTIFACT_MISSING:${st.what}`}; } if (sha256(b) !== st.verify.sha256) return {ok: false, step: `ARTIFACT_HASH_MISMATCH:${st.what}`}; }
    const input = st.inputFile ? readFile(st.inputFile) : st.input;
    const r = await runner(st.args, {timeoutMs: 600_000, input});
    if (r.exitCode !== 0) return {ok: false, step: st.what};
  }
  return {ok: true};
}
