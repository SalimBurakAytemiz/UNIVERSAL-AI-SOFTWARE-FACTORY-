//TR: İsteğe bağlı hazırlık ölçümü: v7 ağacından core/registries/knowledge git archive ile geçici dizine çıkarılır ve PR #260 ile gelen computeRoleReadiness (C-RDY-1) tsx ile KUM HAVUZUNDA çalıştırılır: yeni kullanıcı+ağ+bağlama+süreç ad alanı, pivot_root ile yalnız salt okunur sistem dizinleri ve tek yazılabilir çalışma dizini görünen yeni kök (depo, .git/hooks, motor kaynağı, ana makine soketleri ve diğer süreçlerin /proc'u görünmez), exec öncesi tüm yetkiler düşürülür, izin listeli asgari ortam (token/anahtar/sır/vekil yok) ve derinlemesine savunma olarak ağ koruması (lib/net-guard.mjs). Bu kum havuzu kurulamazsa ürün kodu ÇALIŞTIRILMAZ (UNAVAILABLE / SANDBOX_UNAVAILABLE). Ürün çıktısı güvenilmezdir: yalnız doğrulanmış sayı/enum/kimlik/hex/zaman alanları saklanır, serbest metin ya da beklenmeyen biçim ölçümü reddeder. tsx yoksa sonuç UNAVAILABLE'dır; ölçüm burada YENİDEN YAZILMAZ (tek yetkili ölçüm C-RDY-1'dir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { treeId } from './git.mjs';
import { sha256 } from '../core/canonical-json.mjs';

export function findTsx(explicit, envVar, candidates) {
  for (const c of [explicit, envVar, ...(candidates || [])].filter(Boolean)) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return null;
}
export function readinessKey(repo, v7sha, paths) {
  const ids = paths.map((p) => `${p}:${treeId(repo, v7sha, p) || 'MISSING'}`);
  return sha256(ids.join('\n'));
}

const RUNNER_SRC = `
const [modUrl, repoRoot, nowIso] = process.argv.slice(2);
const m = await import(modUrl);
const a = m.computeRoleReadiness(m.loadReadinessInputFromRepo(repoRoot, { runs: { journal: "ABSENT" }, now: new Date(nowIso) }));
const strip = (g) => ({ id: g.id, kind: g.kind, clusterId: g.clusterId, roles: g.roles, layers: g.layers, stageWired: g.stageWired, proposedOnly: g.proposedOnly });
process.stdout.write(JSON.stringify({ schemaVersion: a.schemaVersion, authority: a.authority, denominator: a.denominator, totals: a.totals, stageWired: a.stageWired,
  byGuild: a.byGuild.map(strip), byCluster: a.byCluster.map(strip), reasonCounts: a.reasonCounts, proposedOnly: a.proposedOnly, inputs: a.inputs, anomalies: a.anomalies, computedAt: a.computedAt, digest: a.digest }));
`;

// ---- sandbox for product code (v7 merged != trusted). The boundary is the OS, not the in-process guard:
//  - fresh user + network + mount + pid namespaces (unshare --user --map-root-user --net --mount --pid --fork --kill-child);
//  - pivot_root into a new tmpfs root that holds ONLY read-only binds of /usr (and /bin,/lib*,/sbin), the node install and the tsx
//    node_modules, a read-only guard dir, a private /tmp, minimal /dev and /etc (passwd/group written here), a fresh /proc of the new
//    pid ns, and the one writable work dir (the extracted tree); the old root is detached (umount -l), so no host path (repo, .git/hooks,
//    engine source, /root, host unix sockets, other processes' /proc) is reachable, and the new root is remounted read-only;
//  - every capability is dropped before exec (setpriv: empty bounding/inheritable/ambient sets, no_new_privs), so product code cannot
//    remount, chroot or pivot; a nested user namespace only sees locked read-only mounts;
//  - minimal allowlisted env (no token/key/secret/credential/proxy of the parent; proxies point at a closed port) + the network guard
//    preloaded into every node process (defence in depth).
// No such sandbox -> the readiness run is refused (UNAVAILABLE / SANDBOX_UNAVAILABLE); there is no guard-only fallback.
export const SANDBOX_VERSION = 'sandbox-v2';
export const SANDBOX_ISOLATION = 'userns+netns+mountns(pivot_root,ro)+pidns+nocaps+guard';
const GUARD_SRC = fileURLToPath(new URL('./net-guard.mjs', import.meta.url));
const ENV_ALLOW = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
const DEAD = 'http://127.0.0.1:9';
export function sandboxEnv(work, { allowBinDir = null, guardFile = GUARD_SRC } = {}) {
  const env = {};
  for (const k of ENV_ALLOW) if (typeof process.env[k] === 'string') env[k] = process.env[k];
  Object.assign(env, {
    HOME: work, TMPDIR: work, TMP: work, TEMP: work, NO_COLOR: '1',
    NODE_OPTIONS: `--import ${pathToFileURL(guardFile).href}`, INTEL_NET_GUARD: 'strict', ESBUILD_WORKER_THREADS: '0',
    HTTPS_PROXY: DEAD, HTTP_PROXY: DEAD, ALL_PROXY: DEAD, https_proxy: DEAD, http_proxy: DEAD, all_proxy: DEAD, NO_PROXY: '', no_proxy: '',
  });
  if (allowBinDir) env.INTEL_NET_GUARD_ALLOW_BIN_DIR = allowBinDir;
  return env;
}
// $1 work dir (rw), $2 new-root mount point, then read-only bind dirs up to '--', then the command. Runs as uid 0 of the new user ns.
const LAUNCH = `set -eu
P=$PATH; PATH=/usr/sbin:/usr/bin:/sbin:/bin
W=$1; NR=$2; shift 2
mount --make-rprivate /
mount -t tmpfs -o mode=0755,size=16m,nosuid,nodev intel-root "$NR"
ro() { mkdir -p "$NR$1"; mount --rbind "$1" "$NR$1"; mount -o remount,bind,ro "$NR$1"; }
ro /usr
for l in bin sbin lib lib32 lib64 libx32; do if [ -L "/$l" ]; then ln -s "$(readlink "/$l")" "$NR/$l"; elif [ -d "/$l" ]; then ro "/$l"; fi; done
mkdir -p "$NR/dev" "$NR/proc" "$NR/tmp" "$NR/etc" "$NR/.old"
mount -t tmpfs -o mode=1777,size=16m,nosuid,nodev intel-tmp "$NR/tmp"
while [ "$1" != "--" ]; do if [ ! -e "$NR$1" ]; then ro "$1"; fi; shift; done
shift
for n in null zero random urandom; do touch "$NR/dev/$n"; mount --bind "/dev/$n" "$NR/dev/$n"; done
printf 'root:x:0:0:root:/nonexistent:/usr/sbin/nologin\\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\\n' > "$NR/etc/passwd"
printf 'root:x:0:\\nnogroup:x:65534:\\n' > "$NR/etc/group"
mkdir -p "$NR$W"
mount --bind "$W" "$NR$W"
mount -t proc -o nosuid,nodev,noexec proc "$NR/proc"
cd "$NR"
pivot_root . .old
umount -l /.old
rmdir /.old
mount -o remount,bind,ro /
cd "$W"
PATH=$P exec setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs -- "$@"
`;
const nodeModulesOf = (bin) => { try { let d = path.dirname(fs.realpathSync(bin)); for (let i = 0; i < 8 && d !== path.dirname(d); i++) { if (path.basename(d) === 'node_modules') return d; d = path.dirname(d); } } catch { /* none */ } return null; };
// read-only binds: the node install (bin/.. of the real execPath) and, when given, the tsx node_modules and the guard dir
const nodeHome = () => { const r = fs.realpathSync(process.execPath); return path.dirname(path.dirname(r)); };
function launchArgs(work, root, roDirs, cmd, args) {
  return ['--user', '--map-root-user', '--net', '--mount', '--pid', '--fork', '--kill-child', '--', '/bin/sh', '-c', LAUNCH, 'intel-sandbox', work, root, ...roDirs, '--', cmd, ...args];
}
let sandboxOk = null;
// The full launcher must start a no-op command; anything else (no userns/mountns, no pivot_root/setpriv) -> unavailable (fail closed).
export function sandboxAvailable() {
  if (sandboxOk !== null) return sandboxOk;
  let base = null;
  try {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-sbx-'));
    fs.mkdirSync(path.join(base, 'work')); fs.mkdirSync(path.join(base, 'root'));
    const r = spawnSync('unshare', launchArgs(path.join(base, 'work'), path.join(base, 'root'), [nodeHome()], process.execPath, ['-e', 'process.exit(0)']), { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH || '/usr/bin:/bin' } });
    sandboxOk = r.status === 0;
  } catch { sandboxOk = false; } finally { if (base) fs.rmSync(base, { recursive: true, force: true }); }
  return sandboxOk;
}
// base/work = writable work dir (HOME/TMPDIR, extracted tree), base/root = new-root mount point, base/guard = read-only guard copy.
export function sandboxSpawnSync(cmd, args, { base, timeout = 120000, maxBuffer = 1 << 28, allowBinDir = null, available = sandboxAvailable } = {}) {
  if (!available()) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('SANDBOX_UNAVAILABLE'), { code: 'SANDBOX_UNAVAILABLE' }), isolation: 'none', envKeys: [] };
  const work = path.join(base, 'work'), root = path.join(base, 'root'), guardDir = path.join(base, 'guard');
  for (const d of [work, root, guardDir]) fs.mkdirSync(d, { recursive: true });
  const guardFile = path.join(guardDir, 'net-guard.mjs');
  fs.copyFileSync(GUARD_SRC, guardFile);
  const env = sandboxEnv(work, { allowBinDir, guardFile });
  const ro = [nodeHome(), guardDir, ...(allowBinDir ? [allowBinDir] : [])];
  const r = spawnSync('unshare', launchArgs(work, root, ro, cmd, args), { encoding: 'utf8', maxBuffer, cwd: work, env, timeout });
  return { ...r, isolation: SANDBOX_ISOLATION, envKeys: Object.keys(env).sort() };
}

// ---- product output is untrusted: only validated numeric / enum / id / hex / timestamp fields are kept; any free text, unknown shape or
// unexpected value rejects the whole audit (UNAVAILABLE / READINESS_OUTPUT_INVALID). Error paths name the engine's schema, never product keys.
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/, DOTCODE = /^[A-Za-z][A-Za-z0-9_]{0,47}(?:\.[A-Za-z][A-Za-z0-9_]{0,47})?$/, CAMEL = /^[a-z][A-Za-z0-9]{0,47}$/, ID = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
const HEX64 = /^[0-9a-f]{64}$/, SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/, ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isInt = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1e7;
export function validateAudit(a) {
  const errs = [];
  const bad = (p) => { if (errs.length < 20) errs.push(p); return undefined; };
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const int = (v, p) => (isInt(v) ? v : bad(p));
  const re = (v, rx, p) => (typeof v === 'string' && rx.test(v) ? v : bad(p));
  const counts = (v, p) => {
    if (!obj(v)) return bad(p);
    const o = {};
    for (const k of Object.keys(v)) if (!['TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE', 'denominator', 'measured'].includes(k)) bad(`${p}.<unexpected key>`);
    for (const k of ['TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE', 'denominator']) if (v[k] !== undefined) o[k] = int(v[k], `${p}.${k}`);
    if (typeof v.measured !== 'boolean') bad(`${p}.measured`); else o.measured = v.measured;
    return o;
  };
  const map = (v, p, keyRx, valFn, max = 64) => {
    if (!obj(v)) return bad(p);
    const ks = Object.keys(v); if (ks.length > max) return bad(`${p}.<too many keys>`);
    const o = {};
    for (const k of ks) { if (!keyRx.test(k)) { bad(`${p}.<invalid key>`); continue; } o[k] = valFn(v[k], `${p}.<value>`); }
    return o;
  };
  const scalar = (v, p) => (isInt(v) ? v : typeof v === 'boolean' ? v : typeof v === 'string' && (CODE.test(v) || HEX64.test(v)) ? v : bad(p));
  const group = (xs, p) => {
    if (!Array.isArray(xs) || xs.length > 2000) return bad(p);
    return xs.map((g, i) => {
      if (!obj(g)) return bad(`${p}[]`);
      for (const k of Object.keys(g)) if (!['id', 'kind', 'clusterId', 'roles', 'layers', 'stageWired', 'proposedOnly'].includes(k)) bad(`${p}[].<unexpected key>`);
      return { id: re(g.id, ID, `${p}[].id`), kind: re(g.kind, CODE, `${p}[].kind`), clusterId: g.clusterId === null || g.clusterId === undefined ? null : re(g.clusterId, ID, `${p}[].clusterId`), roles: int(g.roles, `${p}[].roles`),
        layers: map(g.layers, `${p}[].layers`, CODE, counts), ...(g.stageWired !== undefined ? { stageWired: counts(g.stageWired, `${p}[].stageWired`) } : {}), ...(g.proposedOnly !== undefined ? { proposedOnly: map(g.proposedOnly, `${p}[].proposedOnly`, CAMEL, (v, q) => int(v, q)) } : {}) };
    });
  };
  if (!obj(a)) return { ok: false, errors: ['audit'] };
  const KNOWN = ['schemaVersion', 'authority', 'denominator', 'totals', 'stageWired', 'byGuild', 'byCluster', 'reasonCounts', 'proposedOnly', 'inputs', 'anomalies', 'computedAt', 'digest'];
  for (const k of Object.keys(a)) if (!KNOWN.includes(k)) bad('audit.<unexpected key>');
  const out = {
    schemaVersion: re(a.schemaVersion, SEMVER, 'schemaVersion'), authority: re(a.authority, CODE, 'authority'), denominator: int(a.denominator, 'denominator'),
    totals: map(a.totals, 'totals', CODE, counts), stageWired: counts(a.stageWired, 'stageWired'),
    byGuild: group(a.byGuild, 'byGuild'), byCluster: group(a.byCluster, 'byCluster'),
    reasonCounts: map(a.reasonCounts, 'reasonCounts', DOTCODE, (v, q) => map(v, q, CODE, (n, r) => int(n, r), 256)),
    proposedOnly: map(a.proposedOnly, 'proposedOnly', CAMEL, scalar), inputs: map(a.inputs, 'inputs', CAMEL, scalar),
    anomalies: int(a.anomalies, 'anomalies'), computedAt: a.computedAt === null ? null : re(a.computedAt, ISO, 'computedAt'), digest: re(a.digest, HEX64, 'digest'),
  };
  return errs.length ? { ok: false, errors: errs } : { ok: true, audit: out };
}

export function runReadiness({ repo, v7sha, tsx, nowIso, archivePaths, module = 'core/agents/readiness-audit.ts', workDir, sandboxCheck = sandboxAvailable }) {
  if (!tsx) return { state: 'UNAVAILABLE', reason: 'READINESS_RUNTIME_UNAVAILABLE' };
  if (!sandboxCheck()) return { state: 'UNAVAILABLE', reason: 'SANDBOX_UNAVAILABLE', detail: 'no user+network+mount+pid namespace sandbox on this host; product code is not run without it', sandbox: { version: SANDBOX_VERSION, isolation: 'none', envKeys: [] } };
  const base = fs.mkdtempSync(path.join(workDir || os.tmpdir(), 'intel-rdy-'));
  try {
    const work = path.join(base, 'work'), tree = path.join(work, 'repo');
    fs.mkdirSync(tree, { recursive: true });
    const arch = spawnSync('git', ['-C', repo, 'archive', '--format=tar', v7sha, ...archivePaths], { maxBuffer: 1 << 30 });
    if (arch.status !== 0) return { state: 'UNAVAILABLE', reason: 'READINESS_ARCHIVE_FAILED' };
    const tar = spawnSync('tar', ['-x', '-C', tree], { input: arch.stdout, maxBuffer: 1 << 30 });
    if (tar.status !== 0) return { state: 'UNAVAILABLE', reason: 'READINESS_EXTRACT_FAILED' };
    const runner = path.join(work, 'run.mjs');
    fs.writeFileSync(runner, RUNNER_SRC);
    const modPath = path.join(tree, module);
    if (!fs.existsSync(modPath)) return { state: 'UNAVAILABLE', reason: 'READINESS_MODULE_ABSENT' };
    const r = sandboxSpawnSync(tsx, [runner, pathToFileURL(modPath).href, tree, nowIso], { base, allowBinDir: nodeModulesOf(tsx), available: sandboxCheck });
    const sandbox = { version: SANDBOX_VERSION, isolation: r.isolation, envKeys: r.envKeys };
    // product stderr/stdout text is never persisted: only the exit status / signal / error code
    if (r.status !== 0) return { state: 'UNAVAILABLE', reason: r.error?.code === 'SANDBOX_UNAVAILABLE' ? 'SANDBOX_UNAVAILABLE' : 'READINESS_RUN_FAILED', detail: `exit ${r.status ?? 'none'}${r.signal ? ` signal ${r.signal}` : ''}${r.error?.code ? ` ${String(r.error.code).replace(/[^A-Z0-9_]/g, '')}` : ''}`, sandbox };
    let raw; try { raw = JSON.parse(r.stdout); } catch { return { state: 'UNAVAILABLE', reason: 'READINESS_OUTPUT_INVALID', detail: 'stdout is not JSON', sandbox }; }
    const v = validateAudit(raw);
    if (!v.ok) return { state: 'UNAVAILABLE', reason: 'READINESS_OUTPUT_INVALID', detail: `schema violations: ${v.errors.join(', ')}`.slice(0, 400), sandbox };
    return { state: 'MEASURED', source: `${module}@${v7sha.slice(0, 7)} computeRoleReadiness (PR #260)`, audit: v.audit, sandbox };
  } catch (e) {
    return { state: 'UNAVAILABLE', reason: 'READINESS_RUN_FAILED', detail: String(e.code || e.name || 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
