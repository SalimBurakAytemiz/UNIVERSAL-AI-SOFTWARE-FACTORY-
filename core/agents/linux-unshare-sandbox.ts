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
  /** RLIMIT_NPROC (süreç+iş parçacığı) üst sınırı; yalnız supervisor kuid 0 DEĞİLSE çekirdek tarafından uygulanır (varsayılan 4096). */
  maxProcesses?: number;
  /** Salt-okunur bağlanacak ek araç zinciri kökleri (varsayılan: node kurulum önekinin YALNIZ bin ve lib dizinleri, /usr altında değilse; bkz. nodeToolchainRoots). Her kök readOnlyRootProblem'den geçmelidir. */
  readOnlyRoots?: readonly string[];
  /** true: süreç sayısı sınırı çekirdek tarafından uygulanamasa da (supervisor kuid 0) sağlayıcı DOĞRULANABİLİR; bilinçli, belgelenmiş bir kabul (varsayılan false = fail-closed). */
  acceptUnenforcedProcessLimit?: boolean;
}

// //TR: C-LINUX-SANDBOX-EXPORTS: üç sabit Lane B'nin WSL2 sağlayıcısı (core/sandbox/wsl-unshare-sandbox.ts) tarafından AYNEN yeniden kullanılır (betik kopyalanmaz). Değerler değişmedi; yalnız dışa aktarılır. NS_FLAGS dondurulmuştur: dışarıdan değiştirilirse bu sağlayıcının izolasyon bayrakları da değişirdi.
const NS_FLAGS: readonly string[] = Object.freeze(["--user", "--map-root-user", "--net", "--pid", "--ipc", "--uts", "--mount", "--fork", "--kill-child=SIGKILL"]);
const HELPER_PATH = "/usr/sbin:/usr/bin:/sbin:/bin";
export const LINUX_SANDBOX_NS_FLAGS = NS_FLAGS;
export const LINUX_SANDBOX_HELPER_PATH = HELPER_PATH;
const REQUIRED_TOOLS = ["mount", "umount", "pivot_root", "setpriv", "mkdir", "ln", "awk", "sh"] as const;
// //TR: Kurulum betiği namespace İÇİNDE, pid 1 olarak çalışır. Argümanlar: SCRATCH CPU ADRES_KB DOSYA_BLOK KOK_BAGI EK_RO_KOKLER komut... Sıra: özel mount -> tmpfs kök -> ro bağlar -> sentetik /etc -> özel /dev -> özel /tmp -> /work (scratch) -> /proc (+ ro maskeler) -> iç içe userns kapat -> hepsini ro yap -> pivot_root + eski kökü ayır -> DENETİM (ro olmayan bağ varsa 126) -> ulimit -> yetenek bırak ve komutu pid 1 olmayan çocuk olarak çalıştır (gözetmen pid 1 kalır, stdin korunur).
const SETUP = [
  "set -eu; set -f",
  'CALLER_PATH="$PATH"; PATH=' + HELPER_PATH + "; export PATH",
  'SCRATCH="$1"; CPU="$2"; VMKB="$3"; FSZ="$4"; R="$5"; EXTRA_RO="$6"; NPROC="$7"; shift 7',
  // //TR: Yetenekler bırakılmadan ÖNCE çalışacak yardımcılar (setpriv/prlimit) ve denetçi kabuk, sabit HELPER_PATH ile MUTLAK yola çözülür; arayanın PATH'i (proje yazılabilir bir dizin içerebilir) ayrıcalıklı yürütmede ASLA kullanılmaz.
  'SETPRIV=$(command -v setpriv) && SUPSH=$(command -v sh) || exit 126',
  'PRL=$(command -v prlimit 2>/dev/null) || PRL=""',
  // //TR: prlimit best-effort: sunucunun hard NPROC sınırı istenen değerin altındaysa (yükseltmek init userns CAP_SYS_RESOURCE ister) ayar atlanır; komut bu yüzden başarısız OLMAZ.
  'if [ -n "$PRL" ] && ! "$PRL" --nproc="$NPROC" true 2>/dev/null; then PRL=""; fi',
  // //TR: C-SBX-LO-1: yeni net namespace'te lo KAPALIDIR. `ip` sabit HELPER_PATH ile (arayanın PATH'i değil) ve yetenekler bırakılmadan ÖNCE çözülür; yoksa lo kapalı kalır (sağlayıcı yine doğrulanır, capabilities.loopback=false). Yalnız namespace İÇİ loopback açılır: yönlendirme yok, dışarıya yol yok. Başka bir araca (python vb.) geri düşülmez.
  'IPB=$(command -v ip 2>/dev/null) || IPB=""',
  'if [ -n "$IPB" ]; then "$IPB" link set lo up 2>/dev/null || true; fi',
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
  'for n in null zero full random urandom; do : > "$R/dev/$n"; mount --bind "/dev/$n" "$R/dev/$n"; mount -o remount,ro,nosuid,noexec,bind "$R/dev/$n"; done',
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
  "INNER='exec 3<&0; \"$@\" <&3 3<&- & c=$!; wait $c; exit $?'",
  'if [ -n "$PRL" ]; then exec "$PRL" --nproc="$NPROC" "$SETPRIV" --no-new-privs --bounding-set=-all --inh-caps=-all "$SUPSH" -c "$INNER" sh "$@"; fi',
  'exec "$SETPRIV" --no-new-privs --bounding-set=-all --inh-caps=-all "$SUPSH" -c "$INNER" sh "$@"'
].join("\n");
export const LINUX_SANDBOX_SETUP = SETUP;

// //TR: C-SBX-LO-1: sağlayıcının kanıtlanmış yetenekleri. loopback yalnız sandbox İÇİNDE 127.0.0.1 üzerinde dinle+bağlan gerçekten çalıştıysa true'dur (selfTest kanıtı); NOT_PROBED = selfTest henüz geçmedi.
export type LinuxLoopbackReason = "LOOPBACK_TOOL_MISSING" | "LOOPBACK_PROBE_NODE_UNAVAILABLE" | "NOT_PROBED";
export interface LinuxSandboxCapabilities { loopback: boolean; loopbackReason: LinuxLoopbackReason | null }
const NOT_PROBED: LinuxSandboxCapabilities = Object.freeze({loopback: false, loopbackReason: "NOT_PROBED" as const});
// //TR: Sandbox İÇİNDE `node -e` ile çalışır (argv[1] = ana makinedeki 127.0.0.1 dinleyicisinin portu): 127.0.0.1 üzerinde dinle+bağlan "pong" okur -> loopback_ok; 1.1.1.1:53, 8.8.8.8:53, 93.184.216.34:80 ve ana makine loopback portuna bağlantıların HEPSİ başarısız olmalı -> outbound_blocked, herhangi biri başarılıysa outbound_connected.
export const LINUX_SANDBOX_LOOPBACK_PROBE = [
  'const net = require("net");',
  'console.log("probe_started");',
  'const attempt = (host, port) => new Promise(res => { const s = net.connect({host, port, timeout: 1500}); const done = ok => { s.destroy(); res(ok); }; s.once("connect", () => done(true)); s.once("timeout", () => done(false)); s.once("error", () => done(false)); });',
  "(async () => {",
  "  const hostPort = Number(process.argv[1]);",
  '  const srv = net.createServer(c => c.end("pong"));',
  '  const up = await new Promise(r => { srv.once("error", () => r(false)); srv.listen(0, "127.0.0.1", () => r(true)); });',
  "  let lo = false;",
  '  if (up) lo = await new Promise(r => { let got = ""; const c = net.connect({host: "127.0.0.1", port: srv.address().port, timeout: 1500}); c.on("data", d => { got += d; }); c.once("close", () => r(got === "pong")); c.once("error", () => r(false)); c.once("timeout", () => { c.destroy(); r(false); }); });',
  "  srv.close();",
  '  console.log(lo ? "loopback_ok" : "loopback_failed");',
  '  const targets = [["1.1.1.1", 53], ["8.8.8.8", 53], ["93.184.216.34", 80]];',
  '  if (Number.isInteger(hostPort) && hostPort > 0) targets.push(["127.0.0.1", hostPort]);',
  "  const r = await Promise.all(targets.map(([h, p]) => attempt(h, p)));",
  '  console.log(r.some(Boolean) ? "outbound_connected" : "outbound_blocked");',
  "  process.exit(0);",
  "})();"
].join("\n");
/** Sandbox içi yönlendirme sondasının çıktısı (`no_route_out` = başlık hariç hiç rota yok); aksi halde dışarıya çıkış yolu vardır. */
export function networkRouteProblem(isoStdout: string): string | null {
  return isoStdout.split("\n").some(l => l.trim() === "no_route_out") ? null : "SELFTEST_ROUTE_OUT_EXISTS";
}
/** LC-LO-01: sandbox içi `netns=<readlink /proc/self/ns/net>` satırı ana makinenin net namespace bağlantısından FARKLI olmalı; satır yok/boşsa kanıtsızdır (fail-closed), eşitse ağ ana makineyle paylaşılıyordur. */
export function netnsProblemOf(isoStdout: string, hostNetns: string | null): string | null {
  const line = isoStdout.split("\n").map(l => l.trim()).find(l => l.startsWith("netns="));
  const inside = line ? line.slice("netns=".length).trim() : "";
  if (!inside || !hostNetns) return "SELFTEST_NETNS_NOT_VERIFIED";
  return inside === hostNetns ? "SELFTEST_NETNS_SHARED" : null;
}
export function hostNetns(): string | null { try { return fs.readlinkSync("/proc/self/ns/net"); } catch { return null; } }
/** selfTest kararı (saf): sandbox içi sonda çıktısı + ana makine dinleyicisinin bağlantı sayısı + `ip` ana makinede (sabit HELPER_PATH) var mı. Dışarı bağlanabilmek veya ana makine loopback'ine erişmek her zaman başarısızlıktır; loopback yokluğu yalnız `ip` VARKEN başarısızlıktır (lo açılmalıydı). */
// //TR: LC-LO-01: sonda hiç başlamadıysa (probe_started yok) YALNIZ "komut bulunamadı" (çıkış 127, zaman aşımı yok: sandbox içinde node görünmüyor) loopback yok sayılır; çökme, zaman aşımı, başka çıkış kodu ya da sessiz başarı sonucu kanıtsız bırakır ve fail-closed olur (ana makine/dış bağlantı negatif sondası hiç koşmadan AVAILABLE denmez).
export function loopbackVerdict(i: {ipPresent: boolean; stdout: string; hostConnections: number; exitCode: number | null; timedOut: boolean}): {ok: true; capabilities: LinuxSandboxCapabilities} | {ok: false; detail: string} {
  if (i.hostConnections > 0) return {ok: false, detail: "SELFTEST_HOST_LOOPBACK_REACHED"};
  const has = (t: string) => i.stdout.split("\n").some(l => l.trim() === t);
  if (!has("probe_started")) {
    if (i.exitCode === 127 && !i.timedOut) return {ok: true, capabilities: {loopback: false, loopbackReason: i.ipPresent ? "LOOPBACK_PROBE_NODE_UNAVAILABLE" : "LOOPBACK_TOOL_MISSING"}};
    return {ok: false, detail: "SELFTEST_LOOPBACK_PROBE_FAILED"};
  }
  if (has("outbound_connected")) return {ok: false, detail: "SELFTEST_OUTBOUND_CONNECT_SUCCEEDED"};
  if (!has("outbound_blocked")) return {ok: false, detail: "SELFTEST_OUTBOUND_NOT_VERIFIED"};
  const lo = has("loopback_ok");
  if (i.ipPresent && !lo) return {ok: false, detail: "SELFTEST_LOOPBACK_NOT_AVAILABLE"};
  return {ok: true, capabilities: lo ? {loopback: true, loopbackReason: null} : {loopback: false, loopbackReason: "LOOPBACK_TOOL_MISSING"}};
}

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
// //TR: Ek salt-okunur kök doğrulaması (F1): geniş kökler, ev dizini (veya onu içeren kök) ve hassas girdiler (.ssh, .claude, ...) reddedilir; /tmp,/dev,/proc,/work altındaki kökler zaten sonradan monte edilen özel bağlarla gizlenir.
const SAFE_PATH = /^[A-Za-z0-9._+@/-]+$/;
const BROAD_ROOTS = new Set(["/", "/opt", "/home", "/root", "/srv", "/var", "/mnt", "/media", "/run", "/tmp", "/etc", "/dev", "/proc", "/sys", "/boot", "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/work", "/usr/local"]);
const SENSITIVE_NAMES = [".ssh", ".claude", ".aws", ".gnupg", ".kube", ".docker", ".config", ".npmrc", ".netrc", ".git-credentials", ".env"];
const homeDirs = (): string[] => [...new Set([os.homedir(), process.env.HOME ?? "", process.env.USERPROFILE ?? ""].filter(h => h && path.isAbsolute(h)))];
export function readOnlyRootProblem(root: unknown, homes: readonly string[] = homeDirs()): string | null {
  if (typeof root !== "string" || !path.isAbsolute(root) || !SAFE_PATH.test(root) || root !== path.normalize(root) || (root.length > 1 && root.endsWith("/"))) return "ROOT_UNSUPPORTED_PATH";
  if (BROAD_ROOTS.has(root) || /^\/home\/[^/]+$/.test(root) || root === "/root" || /^\/(proc|sys|dev|run|boot)(\/|$)/.test(root)) return "ROOT_TOO_BROAD";
  if (under("/tmp", root) || under("/work", root)) return "ROOT_HIDDEN_BY_PRIVATE_MOUNT";
  for (const h of homes) if (under(root, h)) return "ROOT_CONTAINS_HOME";
  try { if (fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory()) return "ROOT_NOT_CANONICAL_DIRECTORY"; } catch { return "ROOT_MISSING"; }
  for (const n of SENSITIVE_NAMES) if (fs.existsSync(path.join(root, n))) return "ROOT_HAS_SENSITIVE_ENTRY";
  return null;
}
/** node kurulum önekinden YALNIZ bin ve lib dizinleri bağlanır (önek ev dizini/geniş dizin/hassas girdili ise hiçbir şey bağlanmaz; node o zaman sandbox içinde bulunmaz — sızıntıdan iyidir). */
export function nodeToolchainRoots(execPath: string = process.execPath, homes: readonly string[] = homeDirs()): {roots: string[]; problem?: string} {
  let real: string;
  try { real = fs.realpathSync(execPath); } catch { return {roots: [], problem: "NODE_PATH_UNRESOLVABLE"}; }
  const binDir = path.dirname(real), prefix = path.dirname(binDir);
  if (path.basename(binDir) !== "bin") return {roots: [], problem: "NODE_NOT_IN_BIN_DIRECTORY"};
  if (under("/usr", prefix)) return {roots: []}; // /usr zaten salt-okunur bağlıdır
  if (!fs.existsSync(path.join(prefix, "lib", "node_modules")) && !fs.existsSync(path.join(prefix, "include", "node"))) return {roots: [], problem: "NODE_PREFIX_LAYOUT_UNRECOGNIZED"};
  const pp = readOnlyRootProblem(prefix, homes);
  if (pp) return {roots: [], problem: `NODE_PREFIX_${pp}`};
  const roots: string[] = [];
  for (const d of [path.join(prefix, "bin"), path.join(prefix, "lib")]) {
    try { if (!fs.statSync(d).isDirectory()) continue; } catch { continue; }
    const p = readOnlyRootProblem(d, homes);
    if (p) return {roots: [], problem: `NODE_PREFIX_${p}`};
    roots.push(d);
  }
  return {roots};
}
// Her kök için, sandbox içinde üst dizin listesinin YALNIZ kökün yoluna götüren bileşenleri içermesi gerektiğini söyleyen beklenti (F1 kanıtı: kardeş/üst dizin içeriği sızmaz).
function ancestorListings(roots: readonly string[]): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const r of roots) {
    const parts = r.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) { const a = "/" + parts.slice(0, i).join("/"); (m.get(a) ?? m.set(a, new Set()).get(a)!).add(parts[i]); }
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
}
function resolveTool(name: string): string | null {
  for (const dir of HELPER_PATH.split(":")) { const p = path.join(dir, name); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* sonraki */ } }
  return null;
}

export class LinuxUnshareSandboxProvider implements SandboxProvider {
  readonly id = LINUX_SANDBOX_ID;
  private verified = false;
  private probing: Promise<{ok: boolean; detail?: string}> | null = null;
  private shell = "/bin/sh";
  private caps: LinuxSandboxCapabilities = NOT_PROBED;
  constructor(private readonly o: LinuxSandboxOptions = {}) {}
  /** selfTest'in KANITLADIĞI yetenekler (selfTest geçmeden: NOT_PROBED). */
  // //TR: LC-LO-02: her okumada DONDURULMUŞ kopya: işlem içi bir tutucu loopback=true yapıp nsenter köprüsünün kilidini açamaz.
  get capabilities(): LinuxSandboxCapabilities { return Object.freeze({...this.caps}); }
  private get unshare(): string { return this.o.unshareBinary ?? resolveTool("unshare") ?? "/usr/bin/unshare"; }
  /** Bağlanacak ek kökler (doğrulanmış); reddedilen kökler asla bağlanmaz. Çözümlenemeyen/reddedilen varsayılan node öneki `toolchain().problem` ile görünür. */
  toolchain(): {roots: string[]; problem?: string} {
    if (!this.o.readOnlyRoots) return nodeToolchainRoots();
    const ok = [...new Set(this.o.readOnlyRoots.filter(r => !under("/usr", String(r)) && readOnlyRootProblem(r) === null))].sort();
    const nested = ok.filter(r => !ok.some(o => o !== r && under(o, r)));
    return {roots: nested, ...(nested.length < this.o.readOnlyRoots.length ? {problem: "SOME_ROOTS_REFUSED"} : {})};
  }
  private extraRoots(): string[] { return this.toolchain().roots; }
  /** Yeni kök için ana makinede VAR olan ve hiçbir kaynak yolun (scratch, ek kök) altında/üstünde olmayan bir bağlama noktası. */
  private newRootMount(cwd: string, extras: string[]): string | null {
    for (const c of ["/mnt", "/srv", "/media"]) {
      try { if (!fs.statSync(c).isDirectory()) continue; } catch { continue; }
      if ([cwd, ...extras].every(s => !under(c, s) && !under(s, c))) return c;
    }
    return null;
  }
  private args(cwd: string, timeoutMs: number, command: string[], nprocOverride?: number): string[] | null {
    const extras = this.extraRoots(), root = this.newRootMount(cwd, extras);
    if (!root) return null;
    const cpu = Math.max(1, Math.ceil(timeoutMs / 1000)) + 5;
    return [...NS_FLAGS, this.shell, "-c", SETUP, "sh", cwd, String(cpu), String(this.o.addressSpaceKb ?? 16 * 1024 * 1024), String(this.o.maxFileBlocks ?? 2 * 1024 * 1024), root, extras.join(":"), String(Math.max(16, Math.floor(nprocOverride ?? this.o.maxProcesses ?? 4096))), ...command];
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
    // detached = yeni oturum: kontrol eden terminal sandbox'a MİRAS KALMAZ (F2, TIOCSTI); çağıran süreç grubunu -pid ile öldürebilir (F5).
    return cp.spawn(this.unshare, a, {...opts, shell: false, detached: true});
  }
  private exec(argv: string[], opts: SandboxRunOptions, nprocOverride?: number): Promise<ProcResult> {
    const problem = cwdProblem(opts.cwd);
    if (problem) return Promise.resolve(refusal(argv, problem));
    if (!Array.isArray(argv) || argv.length === 0 || argv.some(a => typeof a !== "string")) return Promise.resolve(refusal(argv ?? [], "ARGV_INVALID"));
    if (!opts.env || typeof opts.env !== "object") return Promise.resolve(refusal(argv, "ENV_REQUIRED"));
    const a = this.args(opts.cwd, opts.timeoutMs, argv, nprocOverride);
    if (!a) return Promise.resolve(refusal(argv, "NO_NEW_ROOT_MOUNTPOINT"));
    // newSession: yeni oturum (terminal miras yok) + zaman aşımında tüm süreç GRUBUNA SIGKILL (ns-init dahil; pdeathsig'e güvenilmez, F5).
    return runProcess([this.unshare, ...a], {cwd: opts.cwd, env: opts.env, timeoutMs: opts.timeoutMs, input: opts.input, shouldAbort: opts.shouldAbort, newSession: true});
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
    let server: net.Server | null = null, connections = 0, acceptedUnenforced = false;
    let hostLo: net.Server | null = null, loConnections = 0, proven: LinuxSandboxCapabilities = NOT_PROBED;
    this.caps = NOT_PROBED;
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
        // Üst düzey ana makine dizinleri yoktur; yalnız bir ek kökün YOLUNDAki üst düzey dizin (ör. /var/tmp/x için /var) bulunabilir ve içeriği aşağıdaki ancestor-listing kanıtıyla sınırlanır.
        `${["/home", "/root", "/run", "/var", "/sys", "/mnt"].filter(d => !this.extraRoots().some(r => r.startsWith(d + "/"))).map(d => `[ ! -e ${d} ]`).concat("true").join(" && ")} && echo host_dirs_hidden`,
        '[ ! -w /usr ] && ! touch /usr/.sbx 2>/dev/null && ! touch /etc/.sbx 2>/dev/null && ! touch /.sbx 2>/dev/null && ! touch /dev/.sbx 2>/dev/null && echo root_ro_ok',
        `touch p && echo q > /tmp/t && echo s > /dev/shm/${shmProbe} && echo scratch_ok`,
        "! echo 60 > /proc/sys/vm/swappiness 2>/dev/null && ! echo x > /proc/sys/kernel/core_pattern 2>/dev/null && ! echo b > /proc/sysrq-trigger 2>/dev/null && echo proc_sys_ro_ok",
        "awk '{mp=$5; if (mp==\"/work\"||mp==\"/tmp\"||mp==\"/dev/shm\") next; if ($6 !~ /(^|,)ro(,|$)/) bad=1} END{exit bad}' /proc/self/mountinfo && echo mount_audit_ok",
        "[ \"$(awk '/^(CapInh|CapPrm|CapEff|CapBnd|CapAmb):/{print $2}' /proc/self/status | sort -u)\" = 0000000000000000 ] && grep -q '^NoNewPrivs:.1' /proc/self/status && echo caps_dropped_all",
        '[ -z "$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " " | grep -v "^lo$")" ] && echo net_none',
        // LC-LO-01: sandbox'ın net namespace'i ana makinenin ki OLMAMALI (karşılaştırma ana makinede, aşağıda).
        'echo "netns=$(readlink /proc/self/ns/net)"',
        // C-SBX-LO-1: lo açık olsa da yönlendirme tablosunda (başlık satırı hariç) HİÇ rota yoktur: dışarıya çıkış yolu yok.
        '[ -z "$(tail -n +2 /proc/net/route)" ] && echo no_route_out',
        // F2: kontrol eden terminal yok (tty_nr = 0) ve /dev/tty düğümü yok -> TIOCSTI ile ana makine kabuğuna girdi basılamaz.
        `[ "$(awk '{print $7}' /proc/self/stat)" = 0 ] && [ ! -e /dev/tty ] && echo no_ctty`,
        // F1: ek salt-okunur köklerin üst dizinleri YALNIZ kökün yoluna giden bileşenleri içerir (kardeş/ana dizin içeriği, .ssh vb. görünmez).
        `${[...ancestorListings(this.extraRoots())].map(([a, names]) => `[ "$(ls -A ${a} | LC_ALL=C sort | tr '\\n' ' ')" = "${names.join(" ")} " ]`).concat("true").join(" && ")} && echo extra_roots_isolated`,
        "! unshare -U true 2>/dev/null && echo nested_userns_blocked",
        '[ "$(ls /proc | grep -c "^[0-9]")" -lt 20 ] && echo pid_ns_private'
      ].join("; ");
      const iso = await this.exec(["sh", "-c", probe], {cwd: ws, env, timeoutMs: 20_000});
      for (const token of ["supervisor_ok", "host_fs_hidden", "host_dirs_hidden", "root_ro_ok", "scratch_ok", "proc_sys_ro_ok", "mount_audit_ok", "caps_dropped_all", "net_none", "no_ctty", "extra_roots_isolated", "nested_userns_blocked", "pid_ns_private"]) if (!iso.stdout.includes(token)) return {ok: false, detail: `SELFTEST_${token.toUpperCase()}_FAILED`};
      const routeProblem = networkRouteProblem(iso.stdout);
      if (routeProblem) return {ok: false, detail: routeProblem};
      const netnsProblem = netnsProblemOf(iso.stdout, hostNetns());
      if (netnsProblem) return {ok: false, detail: netnsProblem};
      if (!fs.existsSync(path.join(ws, "p"))) return {ok: false, detail: "SELFTEST_SCRATCH_NOT_HOST_VISIBLE"};
      if (fs.existsSync(hostShm) && fs.readFileSync(hostShm, "utf8") !== "HOST-SHM") return {ok: false, detail: "SELFTEST_HOST_SHM_TAMPERED"};
      if (fs.readdirSync("/dev/shm").some(n => n === shmProbe)) return {ok: false, detail: "SELFTEST_SHM_NOT_PRIVATE"};
      if (connections !== 0) return {ok: false, detail: "SELFTEST_HOST_SOCKET_REACHED"};
      // C-SBX-LO-1: sandbox İÇİNDE loopback çalışıyor mu ve dışarıya (internet + ana makinenin 127.0.0.1 dinleyicisi) hiçbir bağlantı kurulamıyor mu.
      hostLo = net.createServer(s => { loConnections++; s.destroy(); });
      const loPort = await new Promise<number>((res, rej) => { hostLo!.once("error", rej); hostLo!.listen(0, "127.0.0.1", () => res((hostLo!.address() as net.AddressInfo).port)); });
      const lp = await this.exec([process.execPath, "-e", LINUX_SANDBOX_LOOPBACK_PROBE, String(loPort)], {cwd: ws, env, timeoutMs: 20_000});
      const verdict = loopbackVerdict({ipPresent: resolveTool("ip") !== null, stdout: lp.stdout, hostConnections: loConnections, exitCode: lp.exitCode, timedOut: lp.timedOut});
      if (!verdict.ok) return {ok: false, detail: verdict.detail};
      proven = verdict.capabilities;
      // F3: süreç sayısı sınırı GERÇEKTEN uygulanıyor mu (küçük bir sınırla aynı yoldan): sınırı aşan çatallar başarısız olmalı. Çekirdek init-user kuid 0'ı RLIMIT_NPROC'tan muaf tutar; supervisor root ise sınır uygulanamaz ve (acceptUnenforcedProcessLimit olmadıkça) sağlayıcı DOGRULANMAZ.
      const NPROC_PROBE = 48;
      const forks = 'ok=0; fail=0; i=0; while [ $i -lt 150 ]; do if (sleep 25 &) 2>/dev/null; then ok=$((ok+1)); else fail=$((fail+1)); fi; i=$((i+1)); done; echo ok=$ok fail=$fail';
      const lim = await this.exec(["sh", "-c", forks], {cwd: ws, env, timeoutMs: 30_000}, NPROC_PROBE);
      const okN = Number(/ok=(\d+)/.exec(lim.stdout)?.[1] ?? Number.NaN), failN = Number(/fail=(\d+)/.exec(lim.stdout)?.[1] ?? Number.NaN);
      const nprocEnforced = Number.isFinite(okN) && Number.isFinite(failN) && failN > 0 && okN <= NPROC_PROBE;
      if (!nprocEnforced && !this.o.acceptUnenforcedProcessLimit) return {ok: false, detail: "SELFTEST_PROCESS_LIMIT_NOT_ENFORCED"};
      acceptedUnenforced = !nprocEnforced;
      // Süreç ağacı: SIGTERM'i yok sayan, setsid yapan, pdeathsig'ini temizlemeye çalışan ve zaman aşımından sonra dosya yazmayı deneyen düşman çocuk.
      const evil = 'perl -e \'syscall(157,1,0); syscall(101,16,1,0,0); $SIG{TERM}="IGNORE"; $SIG{HUP}="IGNORE"; setpgrp; sleep 3; open(F,">late.txt"); print F 1; close F; exec("sleep","62.41")\' & exec sleep 62.41';
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
      this.caps = proven;
      return acceptedUnenforced ? {ok: true, detail: "PROCESS_LIMIT_NOT_ENFORCED_ACCEPTED"} : {ok: true};
    } finally {
      try { server?.close(); } catch { /* kapalı */ }
      try { hostLo?.close(); } catch { /* kapalı */ }
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
