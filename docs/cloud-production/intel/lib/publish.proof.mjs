//TR: P11 yayın kanıtı (geçici bare depoda, ağsız): yalnız daily/<tarih>/ yolları değişir; benzetilen ileri-sarma yarışı bir kez yeniden denenir ve başarır; ikinci yarış PUBLISH_RACE verir; force push asla yapılmaz (uzak dal her zaman önceki ucun torunudur); kirli motor ağacı yayını reddeder (DIRTY_ENGINE).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishDaily, PublishRace } from './publish.mjs';
import { engineIdentity } from './gather.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-publish-proof-'));
const env = { GIT_AUTHOR_NAME: 'proof', GIT_AUTHOR_EMAIL: 'proof@example.invalid', GIT_COMMITTER_NAME: 'proof', GIT_COMMITTER_EMAIL: 'proof@example.invalid', HTTPS_PROXY: 'http://127.0.0.1:9' };
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
try {
  const bare = path.join(tmp, 'remote.git'); g(tmp, 'init', '-q', '--bare', bare);
  const seed = path.join(tmp, 'seed'); fs.mkdirSync(seed); g(seed, 'init', '-q'); g(seed, 'checkout', '-q', '-b', 'uasco/production-reports');
  fs.mkdirSync(path.join(seed, 'docs/cloud-production/reports/2026-10-26'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'docs/cloud-production/reports/PRODUCTION-LOG.md'), 'log\n');
  fs.writeFileSync(path.join(seed, 'docs/cloud-production/reports/2026-10-26/HEARTBEAT-1.md'), 'hb\n');
  g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'seed'); g(seed, 'remote', 'add', 'origin', bare); g(seed, 'push', '-q', 'origin', 'uasco/production-reports');
  const work = path.join(tmp, 'work'); g(tmp, 'clone', '-q', bare, work);
  const files = [{ name: 'UASCO_REMAINING_WORK.md', content: '# r\n' }, { name: 'manifest.json', content: '{}\n' }];
  const dailyDir = 'docs/cloud-production/reports/daily';
  const before = g(work, 'ls-remote', 'origin', 'refs/heads/uasco/production-reports').split('\t')[0];
  const r1 = publishDaily({ repo: work, dailyDir, date: '2026-10-27', files, msg: 'report: UASCO daily intel 2026-10-27 (TRT) [skip ci]', env });
  const changed = g(work, 'diff', '--name-only', before, r1.commit).split('\n');
  check('only daily/<date>/ paths change', changed.length === 2 && changed.every((f) => f.startsWith(`${dailyDir}/2026-10-27/`)));
  check('heartbeat files and PRODUCTION-LOG.md are untouched', g(work, 'show', `${r1.commit}:docs/cloud-production/reports/PRODUCTION-LOG.md`) === 'log' && g(work, 'show', `${r1.commit}:docs/cloud-production/reports/2026-10-26/HEARTBEAT-1.md`) === 'hb');
  check('publish is a fast-forward of the previous tip', g(work, 'merge-base', '--is-ancestor', before, r1.commit) === '' && r1.parent === before);
  check('commit message follows the convention', g(work, 'log', '-1', '--format=%s', r1.commit) === 'report: UASCO daily intel 2026-10-27 (TRT) [skip ci]');
  // race once: a competing heartbeat commit lands between fetch and push -> rebuild on the new parent, retry once
  const other = path.join(tmp, 'other'); g(tmp, 'clone', '-q', bare, other); g(other, 'checkout', '-q', 'uasco/production-reports');
  let competitorTip = null;
  const compete = (n) => { fs.writeFileSync(path.join(other, `docs/cloud-production/reports/2026-10-26/HEARTBEAT-c${n}.md`), `c${n}\n`); g(other, 'add', '-A'); g(other, 'commit', '-q', '-m', `heartbeat ${n}`); g(other, 'push', '-q', 'origin', 'HEAD:uasco/production-reports'); competitorTip = g(other, 'rev-parse', 'HEAD'); };
  const r2 = publishDaily({ repo: work, dailyDir, date: '2026-10-28', files, msg: 'r2', env, beforePush: (attempt) => { if (attempt === 1) compete(1); } });
  check('a single non-fast-forward race is retried once and succeeds', r2.attempts === 2 && g(work, 'merge-base', '--is-ancestor', competitorTip, r2.commit) === '');
  check('the competing heartbeat commit is preserved (no force push)', g(work, 'show', `${r2.commit}:docs/cloud-production/reports/2026-10-26/HEARTBEAT-c1.md`) === 'c1');
  g(other, 'pull', '-q', 'origin', 'uasco/production-reports');
  let race = null;
  try { publishDaily({ repo: work, dailyDir, date: '2026-10-29', files, msg: 'r3', env, beforePush: (attempt) => compete(10 + attempt) }); } catch (e) { race = e; }
  check('a second race exits as PUBLISH_RACE', race instanceof PublishRace && race.code === 'PUBLISH_RACE');
  const tip = g(work, 'ls-remote', 'origin', 'refs/heads/uasco/production-reports').split('\t')[0];
  check('after a lost race the remote tip is the competitor (nothing overwritten)', tip === competitorTip);
  const src = fs.readFileSync(path.join(HERE, 'publish.mjs'), 'utf8');
  check('publish.mjs never issues a force push', !/--force|\s-f\b|\+refs\/heads|\+\$\{commit\}/.test(src));
  // DIRTY_ENGINE: a dirty engine tree refuses to publish
  const eng = path.join(tmp, 'engine'); fs.mkdirSync(eng); g(eng, 'init', '-q');
  fs.cpSync(path.join(HERE, '..'), path.join(eng, 'docs/cloud-production/intel'), { recursive: true });
  g(eng, 'add', '-A'); g(eng, 'commit', '-q', '-m', 'engine');
  check('clean engine tree reports no dirt', !engineIdentity(path.join(eng, 'docs/cloud-production/intel')).dirty);
  fs.appendFileSync(path.join(eng, 'docs/cloud-production/intel/rules/config.json'), ' ');
  check('dirty engine tree is detected', !!engineIdentity(path.join(eng, 'docs/cloud-production/intel')).dirty);
  const run = spawnSync(process.execPath, [path.join(eng, 'docs/cloud-production/intel/intel.mjs'), 'daily', '--publish', '--repo', work, '--out', path.join(tmp, 'out'), '--now', '2026-10-26T19:45:00Z'], { encoding: 'utf8', env: { ...process.env, ...env } });
  check('daily --publish from a dirty engine exits 1 with INTEL FAIL DIRTY_ENGINE', run.status === 1 && /INTEL FAIL DIRTY_ENGINE/.test(run.stdout));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
