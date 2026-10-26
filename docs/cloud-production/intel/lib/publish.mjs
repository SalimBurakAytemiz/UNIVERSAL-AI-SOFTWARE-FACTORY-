//TR: Günlük çıktıları uasco/production-reports dalına checkout yapmadan git plumbing ile yayınlar: geçici index, yalnız daily/<tarih>/ yolları, commit-tree, yalnız ileri sarma (fast-forward) push. Asla force push yok. İleri sarma reddedilirse bir kez yeni ebeveyn üzerine yeniden kurar; her denemede yeni ebeveynde aynı günün manifest.json'u varsa hiçbir şey itmez (SKIP, karşılaştır-ve-değiştir); ikinci başarısızlık PUBLISH_RACE (çıkış 6). restoreLatest en yeni günlük dizini yerel klasöre geri yükler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitTry } from './git.mjs';

export class PublishRace extends Error { constructor(m) { super(m); this.code = 'PUBLISH_RACE'; } }

function buildCommit(repo, parent, dirPath, files, msg, env) {
  const idx = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'intel-idx-')), 'index');
  const e = { ...env, GIT_INDEX_FILE: idx };
  try {
    if (parent) { const rt = gitTry(repo, ['read-tree', parent], { env: e }); if (!rt.ok) throw new Error(`READ_TREE_FAILED:${rt.err.trim()}`); }
    for (const f of files) {
      const h = gitTry(repo, ['hash-object', '-w', '--stdin'], { input: f.content, env: e });
      if (!h.ok) throw new Error(`HASH_OBJECT_FAILED:${f.name}`);
      const u = gitTry(repo, ['update-index', '--add', '--cacheinfo', `100644,${h.out.trim()},${dirPath}/${f.name}`], { env: e });
      if (!u.ok) throw new Error(`UPDATE_INDEX_FAILED:${f.name}:${u.err.trim()}`);
    }
    const t = gitTry(repo, ['write-tree'], { env: e });
    if (!t.ok) throw new Error('WRITE_TREE_FAILED');
    const c = gitTry(repo, ['commit-tree', t.out.trim(), ...(parent ? ['-p', parent] : []), '-m', msg], { env: e });
    if (!c.ok) throw new Error(`COMMIT_TREE_FAILED:${c.err.trim()}`);
    return c.out.trim();
  } finally { fs.rmSync(path.dirname(idx), { recursive: true, force: true }); }
}

// files: [{name, content}] (content written last-to-first is irrelevant: one commit). Returns {commit, parent, attempts}.
// Compare-and-swap on the guard file: every attempt (including the non-fast-forward retry) re-reads the freshly fetched parent; if
// <dailyDir>/<date>/<guardFile> already exists there, another run published this date and nothing is pushed ({ skipped, existing }).
export function publishDaily({ repo, remote = 'origin', branch = 'uasco/production-reports', dailyDir, date, files, msg, env = {}, beforePush = null, guardFile = 'manifest.json' }) {
  const dirPath = `${dailyDir}/${date}`;
  let attempts = 0;
  for (;;) {
    attempts++;
    const f = gitTry(repo, ['fetch', '-q', remote, branch], { env });
    if (!f.ok) throw new Error(`FETCH_FAILED:${f.err.trim()}`);
    const parent = gitTry(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`], { env }).out.trim() || null;
    if (parent && guardFile && gitTry(repo, ['cat-file', '-e', `${parent}:${dirPath}/${guardFile}`], { env }).ok) {
      const by = gitTry(repo, ['log', '-1', '--format=%H', parent, '--', `${dirPath}/${guardFile}`], { env }).out.trim() || parent;
      return { skipped: true, existing: by, parent, attempts };
    }
    const commit = buildCommit(repo, parent, dirPath, files, msg, env);
    if (beforePush) beforePush(attempts);
    const p = gitTry(repo, ['push', '-q', remote, `${commit}:refs/heads/${branch}`], { env });
    if (p.ok) return { commit, parent, attempts };
    const nonFf = /non-fast-forward|fetch first|rejected|stale info/i.test(p.err);
    if (!nonFf) throw new Error(`PUSH_FAILED:${p.err.trim().slice(0, 300)}`);
    if (attempts >= 2) throw new PublishRace(`PUBLISH_RACE:${p.err.trim().slice(0, 200)}`);
  }
}

export function restoreLatest({ repo, ref, dailyDir, outDir }) {
  const r = gitTry(repo, ['ls-tree', '--name-only', `${ref}:${dailyDir}`]);
  if (!r.ok) return null;
  const dates = r.out.split('\n').filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const latest = dates[dates.length - 1];
  if (!latest) return null;
  fs.mkdirSync(outDir, { recursive: true });
  const restored = [];
  for (const name of ['UASCO_REMAINING_WORK.md', 'UASCO_REMAINING_WORK.json', 'UASCO_WORK_INVENTORY.json', 'UASCO_WORK_INVENTORY.csv']) {
    const s = gitTry(repo, ['show', `${ref}:${dailyDir}/${latest}/${name}`]);
    if (s.ok) { fs.writeFileSync(path.join(outDir, name), s.out); restored.push(name); }
  }
  const c = gitTry(repo, ['show', `${ref}:${dailyDir}/${latest}/cache.json`]);
  if (c.ok) { fs.mkdirSync(path.join(outDir, '.intel-cache'), { recursive: true }); fs.writeFileSync(path.join(outDir, '.intel-cache', 'cache.json'), c.out); restored.push('.intel-cache/cache.json'); }
  return { date: latest, restored };
}
