//TR: İsteğe bağlı hazırlık ölçümü: v7 ağacından core/registries/knowledge git archive ile geçici dizine çıkarılır ve PR #260 ile gelen computeRoleReadiness (C-RDY-1) tsx ile KUM HAVUZUNDA çalıştırılır: izin listeli asgari ortam (token/anahtar/sır/vekil yok), ağ koruması (lib/net-guard.mjs, her node sürecine ön yüklenir) ve mümkünse ayrı ağ ad alanı (unshare -rn). Rol başına dizi atılır; toplamlar, lonca/küme satırları, neden sayıları ve özet saklanır. tsx yoksa sonuç UNAVAILABLE'dır; ölçüm burada YENİDEN YAZILMAZ (tek yetkili ölçüm C-RDY-1'dir).
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

// ---- sandbox for product code (v7 merged != trusted): minimal allowlisted env (no token, key, secret, credential or proxy of the parent),
// every proxy variable (both cases) pointed at a closed port, the network guard preloaded into every node process, and a fresh network
// namespace (unshare -rn) whenever the host allows it.
export const SANDBOX_VERSION = 'sandbox-v1';
const GUARD = fileURLToPath(new URL('./net-guard.mjs', import.meta.url));
const ENV_ALLOW = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
const DEAD = 'http://127.0.0.1:9';
export function sandboxEnv(base, { allowBinDir = null } = {}) {
  const env = {};
  for (const k of ENV_ALLOW) if (typeof process.env[k] === 'string') env[k] = process.env[k];
  Object.assign(env, {
    HOME: base, TMPDIR: base, TMP: base, TEMP: base, NO_COLOR: '1',
    NODE_OPTIONS: `--import ${pathToFileURL(GUARD).href}`, INTEL_NET_GUARD: 'strict', ESBUILD_WORKER_THREADS: '0',
    HTTPS_PROXY: DEAD, HTTP_PROXY: DEAD, ALL_PROXY: DEAD, https_proxy: DEAD, http_proxy: DEAD, all_proxy: DEAD, NO_PROXY: '', no_proxy: '',
  });
  if (allowBinDir) env.INTEL_NET_GUARD_ALLOW_BIN_DIR = allowBinDir;
  return env;
}
let netnsOk = null;
export function netnsAvailable() {
  if (netnsOk !== null) return netnsOk;
  try { const r = spawnSync('unshare', ['-rn', 'true'], { encoding: 'utf8', timeout: 10000 }); netnsOk = r.status === 0; } catch { netnsOk = false; }
  return netnsOk;
}
const nodeModulesOf = (bin) => { try { let d = path.dirname(fs.realpathSync(bin)); for (let i = 0; i < 8 && d !== path.dirname(d); i++) { if (path.basename(d) === 'node_modules') return d; d = path.dirname(d); } } catch { /* none */ } return null; };
export function sandboxSpawnSync(cmd, args, { base, timeout = 120000, maxBuffer = 1 << 28, allowBinDir = null, netns } = {}) {
  const env = sandboxEnv(base, { allowBinDir });
  const ns = netns === undefined ? netnsAvailable() : !!netns && netnsAvailable();
  const r = ns ? spawnSync('unshare', ['-rn', '--', cmd, ...args], { encoding: 'utf8', maxBuffer, cwd: base, env, timeout }) : spawnSync(cmd, args, { encoding: 'utf8', maxBuffer, cwd: base, env, timeout });
  return { ...r, isolation: ns ? 'netns+guard' : 'guard', envKeys: Object.keys(env).sort() };
}

export function runReadiness({ repo, v7sha, tsx, nowIso, archivePaths, module = 'core/agents/readiness-audit.ts', workDir, netns }) {
  if (!tsx) return { state: 'UNAVAILABLE', reason: 'READINESS_RUNTIME_UNAVAILABLE' };
  const base = fs.mkdtempSync(path.join(workDir || os.tmpdir(), 'intel-rdy-'));
  try {
    const tree = path.join(base, 'repo');
    fs.mkdirSync(tree);
    const arch = spawnSync('git', ['-C', repo, 'archive', '--format=tar', v7sha, ...archivePaths], { maxBuffer: 1 << 30 });
    if (arch.status !== 0) return { state: 'UNAVAILABLE', reason: 'READINESS_ARCHIVE_FAILED' };
    const tar = spawnSync('tar', ['-x', '-C', tree], { input: arch.stdout, maxBuffer: 1 << 30 });
    if (tar.status !== 0) return { state: 'UNAVAILABLE', reason: 'READINESS_EXTRACT_FAILED' };
    const runner = path.join(base, 'run.mjs');
    fs.writeFileSync(runner, RUNNER_SRC);
    const modPath = path.join(tree, module);
    if (!fs.existsSync(modPath)) return { state: 'UNAVAILABLE', reason: 'READINESS_MODULE_ABSENT' };
    const r = sandboxSpawnSync(tsx, [runner, pathToFileURL(modPath).href, tree, nowIso], { base, allowBinDir: nodeModulesOf(tsx), netns });
    const sandbox = { version: SANDBOX_VERSION, isolation: r.isolation, envKeys: r.envKeys };
    if (r.status !== 0) return { state: 'UNAVAILABLE', reason: 'READINESS_RUN_FAILED', detail: String(r.stderr || r.error?.message || '').slice(0, 400), sandbox };
    const audit = JSON.parse(r.stdout);
    return { state: 'MEASURED', source: `${module}@${v7sha.slice(0, 7)} computeRoleReadiness (PR #260)`, audit, sandbox };
  } catch (e) {
    return { state: 'UNAVAILABLE', reason: 'READINESS_RUN_FAILED', detail: String(e.message || e).slice(0, 400) };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
