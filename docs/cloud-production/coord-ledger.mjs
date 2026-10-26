//TR: Koordinatör SHA ledger'ı (TEP-1 token/yürütme verimlilik politikası). Aynı PR+SHA+politika için tamamlanmış incelemeyi, aynı SHA+kapsam+ortam+bağımlılık+konfigürasyon için başarılı testi tekrar ettirmez; PR başına inceleme turunu sınırlar (güvenlik bulgusu sınırı aşar); controller tick'i için durum parmak izi tutar (değişmediyse kısa yol).
// Usage (COORD_LEDGER_PATH overrides the file):
//   node coord-ledger.mjs review-check  --pr N --sha S [--security]        exit 0 DONE | 3 NEW | 4 ROUND_LIMIT
//   node coord-ledger.mjs review-record --pr N --sha S --kind full|delta --verdict V --ref R [--base B]
//   node coord-ledger.mjs test-key      --worktree P --scope X              prints the key JSON + hash
//   node coord-ledger.mjs test-check    --worktree P --scope X              exit 0 DONE(PASS reused) | 3 NEW
//   node coord-ledger.mjs test-record   --worktree P --scope X --result PASS|FAIL --ref R
//   node coord-ledger.mjs merge-gate    --pr N --sha S                     exit 0 OPEN | 5 CLOSED (auto-merge may stay armed only while OPEN)
//   node coord-ledger.mjs fingerprint   [--input state.json]                 exit 0 UNCHANGED | 3 CHANGED (state stored)
//   node coord-ledger.mjs policy
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const POLICY = Object.freeze({
  version: 'TEP-1',
  maxReviewRounds: 3,
  review: { routine: { lenses: 2, skepticsPerFinding: 1 }, founderOrSecurity: { lenses: 3, skepticsPerFinding: 2 } },
  maxRerunsPerHead: 1,
  maxRepairRoundsPerHead: 2,
  ciMonitoring: { mode: 'event-driven', pollFallbackMinutes: [5, 10, 20, 40, 60] },
  testReuse: 'PASS only, key = sha+scope+env+deps+config; required merge checks always run in CI',
  autoMerge: 'armed only while merge-gate is OPEN for the current head; any head change disarms it until that head has a clean review record (COORD-002)',
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ledgerPath = () => process.env.COORD_LEDGER_PATH || path.join(HERE, 'COORD-LEDGER.json');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();

export function load(p = ledgerPath()) {
  if (!fs.existsSync(p)) return { schemaVersion: 1, policy: POLICY.version, reviews: [], tests: [], fingerprint: null };
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.schemaVersion !== 1 || !Array.isArray(j.reviews) || !Array.isArray(j.tests)) throw new Error('LEDGER_INVALID');
  return j;
}
export function save(j, p = ledgerPath()) {
  const t = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(t, JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(t, p);
}

const SHA_RE = /^[0-9a-f]{7,40}$/;
const same = (a, b) => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

export function reviewCheck(j, { pr, sha, security = false }) {
  if (!Number.isInteger(pr) || !SHA_RE.test(sha)) throw new Error('BAD_ARGS');
  const hit = j.reviews.find((r) => r.pr === pr && same(r.sha, sha) && r.policy === POLICY.version);
  if (hit) return { code: 0, state: 'DONE', record: hit };
  const rounds = new Set(j.reviews.filter((r) => r.pr === pr).map((r) => r.sha.slice(0, 7))).size;
  if (rounds >= POLICY.maxReviewRounds && !security) return { code: 4, state: 'ROUND_LIMIT', rounds };
  return { code: 3, state: 'NEW', round: rounds + 1, kind: rounds === 0 ? 'full' : 'delta', base: j.reviews.filter((r) => r.pr === pr).at(-1)?.sha ?? null };
}
export function reviewRecord(j, { pr, sha, kind, verdict, ref, base = null }) {
  if (!Number.isInteger(pr) || !SHA_RE.test(sha) || !['full', 'delta'].includes(kind) || !verdict || !ref) throw new Error('BAD_ARGS');
  if (reviewCheck(j, { pr, sha, security: true }).state === 'DONE') throw new Error('ALREADY_RECORDED');
  j.reviews.push({ pr, sha, kind, base, verdict, ref, policy: POLICY.version, at: now() });
  return j;
}

//TR: Merge kapısı (COORD-002): auto-merge yalnız GÜNCEL head için temiz bir inceleme kaydı varken açık kalabilir; daha eski bir head'in temiz kaydı yeni head'i açmaz (#249: eski head'te kurulan auto-merge, delta incelemesi bitmeden yeni head'i birleştirdi).
const OPEN_VERDICT = /^(NO_BLOCKERS|NO_CODE_BLOCKERS|BASE_MERGE_ONLY)/;
export function mergeGate(j, { pr, sha }) {
  if (!Number.isInteger(pr) || !SHA_RE.test(sha) || sha.length < 40) throw new Error('BAD_ARGS');
  const rec = j.reviews.filter((r) => r.pr === pr && r.policy === POLICY.version && same(r.sha, sha)).at(-1);
  if (!rec) return { code: 5, state: 'CLOSED', reason: 'NO_REVIEW_FOR_HEAD' };
  if (!OPEN_VERDICT.test(rec.verdict)) return { code: 5, state: 'CLOSED', reason: 'VERDICT_BLOCKING', verdict: rec.verdict };
  return { code: 0, state: 'OPEN', record: rec };
}

export function testKey({ worktree, scope }) {
  if (!worktree || !scope) throw new Error('BAD_ARGS');
  const git = (...a) => execFileSync('git', ['-C', worktree, ...a], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=no') !== '') throw new Error('DIRTY_WORKTREE');
  const h = (f) => { const p = path.join(worktree, f); return fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null; };
  const key = { sha: git('rev-parse', 'HEAD'), scope, env: `${process.platform}-${process.arch}-node${process.versions.node}`,
    deps: h('package-lock.json'), config: sha256(['vitest.config.ts', 'vitest.config.mjs', 'config/validation.json', 'tsconfig.json'].map((f) => `${f}:${h(f)}`).join('|')) };
  return { key, hash: sha256(JSON.stringify(key)) };
}
export function testCheck(j, hash) {
  const hit = j.tests.find((t) => t.hash === hash && t.result === 'PASS');
  return hit ? { code: 0, state: 'DONE', record: hit } : { code: 3, state: 'NEW' };
}
export function testRecord(j, { key, hash }, { result, ref }) {
  if (!['PASS', 'FAIL'].includes(result) || !ref) throw new Error('BAD_ARGS');
  j.tests.push({ hash, key, result, ref, at: now() });
  return j;
}

//TR: Parmak izi yalnız karar veren alanlardan hesaplanır (taban SHA, açık PR head/draft, zorunlu kontrol sonuçları); sıra bağımsızdır.
export function fingerprintOf(state) {
  const prs = [...(state.prs || [])].map((p) => ({ n: p.number, h: p.head, d: !!p.draft, c: Object.fromEntries(Object.entries(p.checks || {}).sort()) })).sort((a, b) => a.n - b.n);
  return sha256(JSON.stringify({ base: state.base, prs }));
}
export function fingerprintCompare(j, state) {
  const value = fingerprintOf(state);
  const unchanged = j.fingerprint?.value === value;
  j.fingerprint = { value, at: now(), base: state.base, prs: (state.prs || []).length };
  return { code: unchanged ? 0 : 3, state: unchanged ? 'UNCHANGED' : 'CHANGED', value };
}
function liveState() {
  const api = 'https://api.github.com/repos/salimburakaytemiz/universal-ai-software-factory-';
  const get = (u) => JSON.parse(execFileSync('curl', ['-sf', u], { encoding: 'utf8', maxBuffer: 32 << 20 }));
  const base = get(`${api}/commits/v7/integration`).sha;
  const prs = get(`${api}/pulls?state=open&base=v7/integration&per_page=50`).map((p) => {
    const runs = get(`${api}/commits/${p.head.sha}/check-runs?per_page=100`).check_runs || [];
    const checks = Object.fromEntries(runs.filter((c) => /^validate/.test(c.name)).map((c) => [c.name, c.conclusion || c.status]));
    return { number: p.number, head: p.head.sha, draft: p.draft, checks };
  });
  return { base, prs };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; } }
  return o;
}
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const pr = a.pr !== undefined ? Number(a.pr) : undefined;
  let j = load(); let out;
  switch (cmd) {
    case 'policy': console.log(JSON.stringify(POLICY, null, 2)); return 0;
    case 'review-check': out = reviewCheck(j, { pr, sha: String(a.sha || ''), security: !!a.security }); break;
    case 'review-record': reviewRecord(j, { pr, sha: String(a.sha || ''), kind: a.kind, verdict: a.verdict, ref: a.ref, base: a.base ?? null }); save(j); out = { code: 0, state: 'RECORDED' }; break;
    case 'test-key': out = { code: 0, ...testKey({ worktree: a.worktree, scope: a.scope }) }; break;
    case 'test-check': out = testCheck(j, testKey({ worktree: a.worktree, scope: a.scope }).hash); break;
    case 'test-record': testRecord(j, testKey({ worktree: a.worktree, scope: a.scope }), { result: a.result, ref: a.ref }); save(j); out = { code: 0, state: 'RECORDED' }; break;
    case 'merge-gate': out = mergeGate(j, { pr, sha: String(a.sha || '') }); break;
    case 'fingerprint': out = fingerprintCompare(j, a.input ? JSON.parse(fs.readFileSync(a.input, 'utf8')) : liveState()); save(j); break;
    default: console.error('usage: see header'); return 2;
  }
  console.log(JSON.stringify(out));
  return out.code;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (e) { console.error(`COORD_LEDGER_ERROR ${e.message}`); process.exitCode = 1; }
}
