//TR: İsteğe bağlı hazırlık ölçümü: v7 ağacından core/registries/knowledge git archive ile geçici dizine çıkarılır ve PR #260 ile gelen computeRoleReadiness (C-RDY-1) tsx ile çalıştırılır. Rol başına dizi atılır; toplamlar, lonca/küme satırları, neden sayıları ve özet saklanır. tsx yoksa sonuç UNAVAILABLE'dır; ölçüm burada YENİDEN YAZILMAZ (tek yetkili ölçüm C-RDY-1'dir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

export function runReadiness({ repo, v7sha, tsx, nowIso, archivePaths, module = 'core/agents/readiness-audit.ts', workDir }) {
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
    const r = spawnSync(tsx, [runner, `file://${modPath}`, tree, nowIso], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: base, env: { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' }, timeout: 120000 });
    if (r.status !== 0) return { state: 'UNAVAILABLE', reason: 'READINESS_RUN_FAILED', detail: String(r.stderr || '').slice(0, 400) };
    const audit = JSON.parse(r.stdout);
    return { state: 'MEASURED', source: `${module}@${v7sha.slice(0, 7)} computeRoleReadiness (PR #260)`, audit };
  } catch (e) {
    return { state: 'UNAVAILABLE', reason: 'READINESS_RUN_FAILED', detail: String(e.message || e).slice(0, 400) };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
