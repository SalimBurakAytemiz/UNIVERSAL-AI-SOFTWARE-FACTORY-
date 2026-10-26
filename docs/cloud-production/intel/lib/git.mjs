//TR: Saf olmayan git kenarı: tüm okumalar bir kez çözülmüş SHA'lar üzerinden `git show/cat-file` ile yapılır; çalışma ağacına asla dokunulmaz ve yazılmaz (yayın hariç, o publish.mjs'dedir).
import { execFileSync, spawnSync } from 'node:child_process';

const MAXBUF = 1 << 30;
export function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: MAXBUF, input: opts.input, env: opts.env ? { ...process.env, ...opts.env } : process.env, stdio: ['pipe', 'pipe', 'pipe'] });
}
export function gitTry(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: MAXBUF, input: opts.input, env: opts.env ? { ...process.env, ...opts.env } : process.env });
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '', status: r.status };
}
const toIso = (s) => new Date(s.trim()).toISOString();

export function fetchRefs(repo, remoteBranches) {
  return gitTry(repo, ['fetch', '-q', 'origin', ...remoteBranches]);
}
export function resolveRef(repo, ref) {
  const r = gitTry(repo, ['log', '-1', '--format=%H %cI', ref]);
  if (!r.ok) return null;
  const [sha, at] = r.out.trim().split(' ');
  return { sha, at: toIso(at) };
}
export function resolveRefs(repo, refs) {
  const o = {};
  for (const k of Object.keys(refs)) o[k] = resolveRef(repo, refs[k]);
  return o;
}
export function showText(repo, sha, path) {
  const r = gitTry(repo, ['show', `${sha}:${path}`]);
  return r.ok ? r.out : null;
}
export function showJson(repo, sha, path) {
  const t = showText(repo, sha, path);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return null; }
}
export function catBlob(repo, blobId) {
  const r = gitTry(repo, ['cat-file', 'blob', blobId]);
  return r.ok ? r.out : null;
}
export function objectId(repo, spec) {
  const r = gitTry(repo, ['rev-parse', '--verify', '-q', spec]);
  return r.ok ? r.out.trim() : null;
}
export const blobId = (repo, sha, path) => objectId(repo, `${sha}:${path}`);
export const treeId = (repo, sha, path) => objectId(repo, `${sha}:${path}`);
export function lsTree(repo, sha, path = '', recursive = true) {
  const r = gitTry(repo, ['ls-tree', ...(recursive ? ['-r'] : []), sha, ...(path ? ['--', path] : [])]);
  if (!r.ok) return [];
  return r.out.split('\n').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); const [mode, type, id] = meta.split(' '); return { mode, type, id, path: p }; });
}
// Read many blobs at once: specs = ["<sha>:<path>", ...] -> Map spec -> text (missing specs are absent).
export function readBlobs(repo, specs) {
  const out = new Map();
  if (!specs.length) return out;
  const r = spawnSync('git', ['-C', repo, 'cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: MAXBUF });
  const buf = r.stdout;
  let pos = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    if (/ missing$| ambiguous$/.test(header)) continue;
    const size = Number(header.split(' ')[2]);
    out.set(spec, buf.subarray(pos, pos + size).toString('utf8'));
    pos += size + 1;
  }
  return out;
}
export function revList(repo, sha) {
  const r = gitTry(repo, ['rev-list', sha]);
  return r.ok ? r.out.split('\n').filter(Boolean) : [];
}
// Commits reachable from `ref` (oldest last), optionally only those not reachable from fromSha.
export function logCommits(repo, ref, fromSha = null, paths = []) {
  const range = fromSha ? `${fromSha}..${ref}` : ref;
  const r = gitTry(repo, ['log', '--format=%H%x1f%cI%x1f%s%x1f%b%x1e', range, ...(paths.length ? ['--', ...paths] : [])]);
  if (!r.ok) return [];
  return r.out.split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean).map((s) => { const [sha, at, subject, body] = s.split('\x1f'); return { sha, at: toIso(at), subject, body: (body || '').trim() }; });
}
export function isAncestor(repo, sha, ref) {
  return gitTry(repo, ['merge-base', '--is-ancestor', sha, ref]).status === 0;
}
export function pickaxeFirst(repo, ref, literal, paths) {
  const r = gitTry(repo, ['log', `-S${literal}`, '--format=%H %cI', '--reverse', ref, '--', ...paths]);
  if (!r.ok) return null;
  const first = r.out.split('\n').find(Boolean);
  if (!first) return null;
  const [sha, at] = first.split(' ');
  return { sha, at: toIso(at) };
}
export function fileHistory(repo, ref, path) {
  const r = gitTry(repo, ['log', '--format=%H %cI', '--reverse', ref, '--', path]);
  if (!r.ok) return [];
  return r.out.split('\n').filter(Boolean).map((l) => { const [sha, at] = l.split(' '); return { sha, at: toIso(at) }; });
}
// Resolve (possibly short) object names to full commit shas; missing/ambiguous -> null.
export function resolveCommits(repo, names) {
  const out = {};
  const uniq = [...new Set(names.filter((n) => typeof n === 'string' && /^[0-9a-f]{7,40}$/.test(n)))];
  if (!uniq.length) return out;
  const r = spawnSync('git', ['-C', repo, 'cat-file', '--batch-check=%(objectname) %(objecttype)'], { input: uniq.map((n) => `${n}^{commit}`).join('\n') + '\n', encoding: 'utf8', maxBuffer: MAXBUF });
  const lines = (r.stdout || '').split('\n');
  uniq.forEach((n, i) => { const l = lines[i] || ''; const m = /^([0-9a-f]{40}) commit$/.exec(l.trim()); out[n] = m ? m[1] : null; });
  return out;
}
export function commitDates(repo, fullShas) {
  const out = {};
  const uniq = [...new Set(fullShas.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 200) {
    const chunk = uniq.slice(i, i + 200);
    const r = gitTry(repo, ['show', '-s', '--format=%H %cI', ...chunk]);
    if (!r.ok) continue;
    for (const l of r.out.split('\n').filter(Boolean)) { const [sha, at] = l.split(' '); if (/^[0-9a-f]{40}$/.test(sha)) out[sha] = toIso(at); }
  }
  return out;
}
export function statusPorcelain(repo, path) {
  const r = gitTry(repo, ['status', '--porcelain', '--', path]);
  return r.ok ? r.out : null;
}
export function headTree(repo, path) {
  return objectId(repo, `HEAD:${path}`);
}
