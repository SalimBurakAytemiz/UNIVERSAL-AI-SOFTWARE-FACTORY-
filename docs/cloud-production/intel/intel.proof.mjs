//TR: UASCO Intel V1 toplu kanıt betiği (node docs/cloud-production/intel/intel.proof.mjs). Ağ yoktur: betik kendini ağ korumasıyla (lib/net-guard.mjs, proof kipi: her node sürecine NODE_OPTIONS ile ön yüklenir; git yalnız file protokolü) ve izin listeli ortamla (token/sır yok, iki harf düzeninde ölü vekil, GIT_CONFIG_GLOBAL=/dev/null, imzasız commit) yeniden çalıştırır; GitHub kaynağı enjekte edilir ve çağrı sayısı 0 doğrulanır. Kapsam: alt kanıtlar (P3 P4 P5 P6 P10 P11) + P1 determinizm, P2 taban uzlaştırması (gerçek 19 Ekim blob'u), P7 tazelik/hız (ETag, kaynak başına tazelik, parmak izi, git ref tazeliği), P8 guard/zaman, P9 eski anahtar sürekliliği, P12 mutantlar, P13 ürün kodu kum havuzu (ortam, ağ, koruma atlatma, /proc, ana makine dosya sistemi ve soket sondaları; kum havuzu yoksa çalıştırmama; çıktı şeması), P14 sınırlı arşiv.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { miniBundle, S } from './fixtures/mini/bundle.mjs';
import { loadRules } from './lib/gather.mjs';
import { createGithub } from './lib/github.mjs';
import { legacyView, loadBaseline } from './model/baseline.mjs';
import { FIELD_SEMANTICS } from './render/report-json.mjs';
import { sha256 } from './core/canonical-json.mjs';
import { trtDate, trtClock } from './core/time.mjs';
import { verifyOutputs, buildOutputs, pruneArchive } from './intel.mjs';
import { gatherInputs, inputsFingerprint } from './lib/gather.mjs';
import { runReadiness, sandboxAvailable, sandboxSpawnSync, validateAudit, SANDBOX_ISOLATION } from './lib/readiness-runner.mjs';
import net from 'node:net';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();
const want = (k) => !ONLY || ONLY === k;
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
// Allowlisted env (no token/key/secret of the caller), dead proxies in both cases, hermetic git (no global/system config, no signing), and the
// network guard preloaded into every node process. The whole proof re-executes itself under it.
const DEAD = 'http://127.0.0.1:9';
const NOENV = {
  ...Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'].filter((k) => typeof process.env[k] === 'string').map((k) => [k, process.env[k]])),
  HTTPS_PROXY: DEAD, HTTP_PROXY: DEAD, ALL_PROXY: DEAD, https_proxy: DEAD, http_proxy: DEAD, all_proxy: DEAD, NO_PROXY: '', no_proxy: '',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'proof', GIT_AUTHOR_EMAIL: 'p@example.invalid', GIT_COMMITTER_NAME: 'proof', GIT_COMMITTER_EMAIL: 'p@example.invalid',
  NODE_OPTIONS: `--import ${new URL('./lib/net-guard.mjs', import.meta.url).href}`, INTEL_NET_GUARD: 'proof',
  INTEL_REPO: process.env.INTEL_REPO || path.dirname(fileURLToPath(import.meta.url)),
};
if (process.env.INTEL_NET_GUARD_ACTIVE !== 'proof') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: NOENV });
  process.exit(r.status ?? 1);
}
const { rules } = loadRules(HERE);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-proof-'));
const outputs = (bundle) => {
  const o = buildOutputs({ inputs: bundle.inputs, rules, overlay: bundle.overlay, meta: bundle.meta, nowIso: new Date(bundle.nowIso).toISOString() });
  return { m: o.model, json: o.files['UASCO_REMAINING_WORK.json'], md: o.files['UASCO_REMAINING_WORK.md'], inv: o.files['UASCO_WORK_INVENTORY.json'], csv: o.files['UASCO_WORK_INVENTORY.csv'] };
};
const digest = (o) => [o.json, o.md, o.inv, o.csv].map(sha256).join(',');
const shuffle = (xs, seed) => { const a = [...xs]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: NOENV, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

try {
  // ---- sub-proofs
  if (want('sub')) for (const p of ['model/status.proof.mjs', 'model/departments.proof.mjs', 'metrics/metrics.proof.mjs', 'metrics/history.proof.mjs', 'render/render.proof.mjs', 'lib/publish.proof.mjs']) {
    const r = spawnSync(process.execPath, [path.join(HERE, p)], { encoding: 'utf8', env: NOENV });
    const sum = /SUMMARY: (\d+) passed, (\d+) failed/.exec(r.stdout || '');
    check(`${p} (${sum ? `${sum[1]} passed, ${sum[2]} failed` : 'no summary'})`, r.status === 0 && sum && sum[2] === '0');
  }

  // ---- P1 determinism
  if (want('P1')) {
    const a = outputs(miniBundle()), b = outputs(miniBundle());
    check('P1 two builds with the same inputs and clock are byte-identical (md, json, inventory json, csv)', digest(a) === digest(b));
    const sh = miniBundle();
    const I = sh.inputs;
    I.github.pulls = shuffle(I.github.pulls, 7); I.github.runs = shuffle(I.github.runs, 3); I.v7.commits = shuffle(I.v7.commits, 5); I.v7.reachable = shuffle(I.v7.reachable, 11);
    I.inventory.json.items = shuffle(I.inventory.json.items, 13); I.backlog.tasks = shuffle(I.backlog.tasks, 17); I.coordinator.queue.tasks = shuffle(I.coordinator.queue.tasks, 19);
    I.roadmap.contracts = shuffle(I.roadmap.contracts, 23); I.coordinator.queueHistory = shuffle(I.coordinator.queueHistory, 29); I.coordinator.queue.founderQueue = shuffle(I.coordinator.queue.founderQueue, 31); I.wave0.packages = shuffle(I.wave0.packages, 37);
    check('P1 shuffled input arrays give identical outputs', digest(outputs(sh)) === digest(a));
    const bundlePath = path.join(tmp, 'mini-bundle.json'); fs.writeFileSync(bundlePath, JSON.stringify(miniBundle()));
    const runTz = (tz, now, out) => spawnSync(process.execPath, [path.join(HERE, 'intel.mjs'), 'build', '--fixtures', bundlePath, '--out', out, '--now', now], { encoding: 'utf8', env: { ...NOENV, TZ: tz } });
    const files = (d) => ['UASCO_REMAINING_WORK.md', 'UASCO_REMAINING_WORK.json', 'UASCO_WORK_INVENTORY.json', 'UASCO_WORK_INVENTORY.csv'].map((f) => sha256(fs.readFileSync(path.join(d, f))));
    const u = runTz('UTC', '2026-10-26T19:41:00Z', path.join(tmp, 'tzU')), n = runTz('America/New_York', '2026-10-26T19:41:00Z', path.join(tmp, 'tzN'));
    check('P1 TZ=UTC and TZ=America/New_York give identical outputs', u.status === 0 && n.status === 0 && files(path.join(tmp, 'tzU')).join() === files(path.join(tmp, 'tzN')).join());
    check('P1 CLI build output equals the in-process build', files(path.join(tmp, 'tzU')).join() === [a.md, a.json, a.inv, a.csv].map(sha256).join());
    const later = miniBundle(); later.nowIso = '2026-10-26T20:41:00Z';
    const c = outputs(later);
    check('P1 a different --now keeps the inventory blobs byte-identical', c.inv === a.inv && c.csv === a.csv);
    const ra = JSON.parse(a.json), rc = JSON.parse(c.json);
    check('P1 a different --now changes the header but not the reconciliation, totals or core metrics', ra.generatedAt !== rc.generatedAt && JSON.stringify(ra.reconciliation) === JSON.stringify(rc.reconciliation) && JSON.stringify(ra.totals) === JSON.stringify(rc.totals) && JSON.stringify(ra.metrics.full) === JSON.stringify(rc.metrics.full));
  }

  // ---- P2 baseline reconciliation on the real 19-Oct inventory (pinned blobs; missing blob = FAIL)
  if (want('P2')) {
    const repo = process.env.INTEL_REPO || HERE;
    const blob = (id) => { try { return execFileSync('git', ['-C', repo, 'cat-file', 'blob', id], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return null; } };
    const invT = blob(rules.sources.inventory.jsonBlob), csvT = blob(rules.sources.inventory.csvBlob);
    check('P2 pinned inventory blobs 3240cf32 (json) and bb712197 (csv) are readable', !!invT && !!csvT);
    if (invT && csvT) {
      const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'baseline-pr-states-2026-10-26.json'), 'utf8'));
      const prMap = new Map(fx.prs.map((p) => [p.number, p]));
      const rows = loadBaseline(csvT, JSON.parse(invT));
      const lv = legacyView(rows, prMap);
      const A = lv.allWorkDimensions;
      check(`P2 v0 anchor: live ${A.live}, MVP ${A.mvpScope_AT_RISK}, deferrable ${A.deferrable_NOT_DELIVERABLE_or_NONE}`, A.live === 741 && A.mvpScope_AT_RISK === 354 && A.deferrable_NOT_DELIVERABLE_or_NONE === 387);
      check(`P2 v0 anchor: STALE ${A.stale} + UNKNOWN ${A.byStatus.UNKNOWN} = unreconciled ${lv.UNRECONCILED_WORK}`, A.stale === 499 && A.byStatus.UNKNOWN === 37 && lv.UNRECONCILED_WORK === 536);
      const live = lv.rows.filter((r) => !['DUPLICATE', 'OBSOLETE'].includes(r.now));
      const mnv = live.filter((r) => r.now === 'MERGED_NOT_VERIFIED'), mnvPr = mnv.filter((r) => r.prs.length), mnvStale = mnv.filter((r) => !r.prs.length);
      check(`P2 v0 anchor: MERGED_NOT_VERIFIED ${mnv.length} = ${mnvPr.length} (PR) + ${mnvStale.length} (status only)`, mnv.length === 323 && mnvPr.length === 205 && mnvStale.length === 118);
      const mv = live.filter((r) => r.oct31 === 'AT_RISK');
      const mvPr = mv.filter((r) => r.now === 'MERGED_NOT_VERIFIED' && r.prs.length).length, mvUnk = mv.filter((r) => r.now === 'UNKNOWN').length, mvStale = mv.filter((r) => r.flags.includes('STALE_SINCE_2026-10-19')).length;
      check(`P2 v0 anchor: MVP ${mvPr}/${mvUnk}/${mvStale} (PR-merged / UNKNOWN / STALE)`, mvPr === 189 && mvUnk === 21 && mvStale === 144);
      // full engine on the real inventory + fixture PR states (all other inputs empty)
      const B = miniBundle();
      const pulls = fx.prs.map((p) => ({ number: p.number, state: p.state, draft: false, title: '', headRef: '', headSha: null, base: p.base, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', closedAt: null, mergedAt: p.mergedAt, mergeCommitSha: p.mergeCommitSha, autoMerge: false, user: null, url: '', bodyTokens: [], bodySha: '' }));
      Object.assign(B.inputs, { inventory: { json: JSON.parse(invT), csvText: csvT }, dependencyMap: { keystones: {}, edges: [] } });
      B.inputs.github = { ...B.inputs.github, pulls, runs: [], checks: {}, prFiles: {} };
      B.inputs.v7 = { ...B.inputs.v7, reachable: fx.prs.filter((p) => p.mergeCommitInV7).map((p) => p.mergeCommitSha), commits: [], routes: [], ipc: [], literalIntro: {} };
      B.inputs.coordinator = { ...B.inputs.coordinator, queue: { builderCap: 3, tasks: [], founderQueue: [], integrationQueue: { founderDecisions: [] }, productionLanes: { deliverables: {} }, coordinatorBuild: {}, integrationBoard: { prs: [], merges: [] } }, dispatch: {}, queueHistory: [] };
      B.inputs.backlog = { tasks: [] }; B.inputs.wave0 = { packages: [], founderDecisions: [] }; B.overlay = { entries: [] };
      const o = outputs(B), r = JSON.parse(o.json), rec = r.reconciliation;
      const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
      check(`P2 engine: baseline partition sums FULL ${sum(rec.baselinePartition, 'full')} / MVP ${sum(rec.baselinePartition, 'mvp')}`, sum(rec.baselinePartition, 'full') === 741 && sum(rec.baselinePartition, 'mvp') === 354);
      const bp = Object.fromEntries(rec.baselinePartition.map((p) => [p.baselineClass, [p.full, p.mvp, p.deferrable]]));
      check('P2 engine: partition rows match the design measurement (170/156/14, 35/33/2, 118/100/18, 37/21/16, 210/10/200, 139/8/131, 25/21/4, 5/4/1, 2/1/1)', JSON.stringify([bp.PR_MERGED_ALL, bp.PR_MERGED_PARTIAL, bp.STALE_STATUS_SAYS_MERGED, bp.PR_CLOSED_UNMERGED_ONLY, bp.STALE_FOUNDER, bp.STALE_NOT_STARTED, bp.STALE_IN_PROGRESS, bp.STALE_IMPLEMENTED_NOT_TESTED, bp.STALE_BLOCKED]) === JSON.stringify([[170, 156, 14], [35, 33, 2], [118, 100, 18], [37, 21, 16], [210, 10, 200], [139, 8, 131], [25, 21, 4], [5, 4, 1], [2, 1, 1]]));
      check(`P2 engine: overlap both ${rec.overlap.both.full}/${rec.overlap.both.mvp}, 323-only ${rec.overlap.a323only.full}/${rec.overlap.a323only.mvp}, 536-only ${rec.overlap.a536only.full}/${rec.overlap.a536only.mvp}`, rec.overlap.both.full === 118 && rec.overlap.both.mvp === 100 && rec.overlap.a323only.full === 205 && rec.overlap.a323only.mvp === 189 && rec.overlap.a536only.full === 418 && rec.overlap.a536only.mvp === 65);
      check('P2 engine: r323 has exactly 323 unique ids', rec.r323.length === 323 && new Set(rec.r323.map((x) => x.id)).size === 323);
      const tm = (mx) => Object.values(mx).reduce((s, x) => s + Object.values(x).reduce((a, n) => a + n, 0), 0);
      check('P2 engine: transition matrix rows sum to 741 (FULL) and 354 (MVP)', tm(rec.transitionMatrix.full) === 741 && tm(rec.transitionMatrix.mvp) === 354);
      check('P2 engine: every item has exactly one status and one reconClass; verify invariants pass', verifyOutputs(r, JSON.parse(o.inv), o.md, o.csv).length === 0);
      check('P2 engine: totals.legacyV0 equals the independent v0 recomputation', JSON.stringify(r.totals.legacyV0.allWorkDimensions) === JSON.stringify(lv.allWorkDimensions) && r.totals.legacyV0.UNRECONCILED_WORK === 536);
      check('P2 engine: 24 rows excluded (6 DUPLICATE + 18 OBSOLETE)', rec.excluded === 24 && rec.excludedByStatus.DUPLICATE === 6 && rec.excludedByStatus.OBSOLETE === 18);
      fs.writeFileSync(path.join(tmp, 'p2-report.json'), o.json);
    }
  }

  // ---- P7 freshness and rate (injected fetcher; no network)
  if (want('P7')) {
    const boom = async () => { throw new Error('ECONNREFUSED (proof)'); };
    const gh = createGithub({ api: 'https://api.github.invalid/repos/x/y', fetcher: boom });
    const cached = [{ number: 1, state: 'open', updatedAt: '2026-10-20T00:00:00Z' }];
    const r = await gh.fetchPullsIncremental(cached, '2026-10-20T00:00:00Z');
    check('P7 throwing fetcher: pulls incomplete, cached table kept, cursor kept', r.complete === false && r.pulls.length === 1 && r.cursor === '2026-10-20T00:00:00Z' && gh.state.errors.length === 1);
    const st = miniBundle(); st.inputs.github.freshness = { state: 'STALE_CACHE', asOf: '2026-10-25T21:00:00Z', error: 'ECONNREFUSED' };
    const so = outputs(st);
    check('P7 STALE_CACHE still builds the report and every GitHub figure is marked (as of <asOf>)', /GitHub verisi STALE_CACHE \(as of 2026-10-25T21:00:00Z\)/.test(so.md) && JSON.parse(so.json).freshness.github.state === 'STALE_CACHE');
    const low = createGithub({ api: 'https://api.github.invalid/r', rateReserve: 500, fetcher: async () => ({ status: 200, json: [], rateRemaining: 100 }) });
    await low.getJson('/a'); const second = await low.getJson('/b');
    check('P7 rateRemaining below the reserve stops fetching (PARTIAL)', second.error === 'RATE_RESERVE' && low.state.partial === true && low.state.calls === 1);
    const etagged = createGithub({ api: 'https://api.github.invalid/r', etags: { 'https://api.github.invalid/r/pulls?state=all&sort=updated&direction=desc&per_page=100&page=1': 'W/"e1"' }, fetcher: async (url, etag) => (etag === 'W/"e1"' ? { status: 304, json: null } : { status: 200, json: [] }) });
    const er = await etagged.fetchPullsIncremental(cached, '2026-10-20T00:00:00Z');
    check('P7 ETag 304 on page 1: one call, table unchanged', etagged.state.calls === 1 && etagged.state.notModified === 1 && er.pulls.length === 1);
    const page = [{ number: 2, state: 'open', draft: false, title: 'UI-001 new', head: { ref: 'claude/ui-001', sha: S('h2') }, base: { ref: 'v7/integration' }, created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T01:00:00Z', closed_at: null, merged_at: null, merge_commit_sha: null, body: 'mentions UI-002' },
      { number: 1, state: 'closed', draft: false, title: 'old', head: { ref: 'x', sha: S('h1') }, base: { ref: 'v7/integration' }, created_at: '2026-10-19T00:00:00Z', updated_at: '2026-10-25T00:00:00Z', closed_at: '2026-10-25T00:00:00Z', merged_at: '2026-10-25T00:00:00Z', merge_commit_sha: S('m1'), body: '' }];
    const inc = createGithub({ api: 'https://api.github.invalid/r', fetcher: async () => ({ status: 200, json: page, etag: 'W/"e2"' }) });
    const ir = await inc.fetchPullsIncremental(cached, '2026-10-20T00:00:00Z');
    check('P7 incremental merge: PR #1 updated, PR #2 added, cursor advanced, body kept only as tokens', ir.pulls.length === 2 && ir.pulls[0].mergedAt === '2026-10-25T00:00:00Z' && ir.pulls[1].bodyTokens.includes('UI-002') && !('body' in ir.pulls[1]) && ir.cursor === '2026-10-26T01:00:00Z');
    check('P7 offline builds make 0 GitHub calls', outputs(miniBundle()).m.inputs.github.calls === 0);

    // M4: a page-1 ETag from an INCOMPLETE pull pass must not make the next run skip the pages it never fetched (fails on 4fe58dd)
    const C0 = '2026-10-20T00:00:00Z';
    const ghPr = (n, upd, mergedAt) => ({ number: n, state: mergedAt ? 'closed' : 'open', draft: false, title: `t${n}`, head: { ref: `b${n}`, sha: S(`h${n}`) }, base: { ref: 'v7/integration' }, created_at: '2026-10-19T00:00:00Z', updated_at: upd, closed_at: mergedAt, merged_at: mergedAt, merge_commit_sha: mergedAt ? S(`m${n}`) : null, body: '' });
    const serverPrs = [...Array.from({ length: 100 }, (_, i) => ghPr(150 - i, `2026-10-22T${String(23 - Math.floor(i / 5)).padStart(2, '0')}:${String(59 - (i % 5)).padStart(2, '0')}:00Z`, null)),
      ...Array.from({ length: 50 }, (_, i) => ghPr(50 - i, `2026-10-21T12:${String(59 - i).padStart(2, '0')}:00Z`, '2026-10-21T12:00:00Z'))];
    let failPage2 = true, pullCalls = 0;
    const pullsFetcher = async (url, etag) => {
      pullCalls++;
      const page = Number(/[?&]page=(\d+)/.exec(url)[1]);
      const items = serverPrs.slice((page - 1) * 100, page * 100);
      const et = `W/"${sha256(JSON.stringify(items)).slice(0, 8)}"`;
      if (page === 2 && failPage2) throw new Error('ECONNRESET (proof)');
      if (etag && etag === et) return { status: 304, json: null, etag: et };
      return { status: 200, json: items, etag: et };
    };
    const stale50 = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, state: 'open', mergedAt: null, updatedAt: '2026-10-19T00:00:00Z', headSha: S(`h${i + 1}`), base: 'v7/integration' }));
    const g1 = createGithub({ api: 'https://api.github.invalid/r', fetcher: pullsFetcher });
    const run1 = await g1.fetchPullsIncremental(stale50, C0);
    check('M4 run 1: page 2 fails -> incomplete, cursor kept, and NO page-1 ETag persisted', run1.complete === false && run1.cursor === C0 && Object.keys(g1.state.etags).length === 0);
    failPage2 = false;
    const g2 = createGithub({ api: 'https://api.github.invalid/r', fetcher: pullsFetcher, etags: g1.state.etags });
    const run2 = await g2.fetchPullsIncremental(run1.pulls, run1.cursor);
    const fixed = run2.pulls.filter((p) => p.number <= 50);
    check('M4 run 2 (server unchanged): pages 1 and 2 are fetched and all 50 merged PRs are refreshed (no 304 skip)', run2.complete === true && g2.state.notModified === 0 && fixed.length === 50 && fixed.every((p) => p.mergedAt === '2026-10-21T12:00:00Z'));
    const g3 = createGithub({ api: 'https://api.github.invalid/r', fetcher: pullsFetcher, etags: g2.state.etags });
    const run3 = await g3.fetchPullsIncremental(run2.pulls, run2.cursor);
    check('M4 run 3 after a complete pass: the persisted page-1 ETag gives one 304 call', run3.complete === true && g3.state.calls === 1 && g3.state.notModified === 1 && Object.keys(g2.state.etags).length === 1);
    // LOW: open-PR file lists are paginated (fails on 4fe58dd: capped at 100)
    const fileFetcher = async (url) => { const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] || 1); const n = page === 1 ? 100 : page === 2 ? 100 : 7; return { status: 200, json: Array.from({ length: page <= 3 ? n : 0 }, (_, i) => ({ filename: page === 3 && i === 6 ? '.github/workflows/ci.yml' : `f${page}-${i}` })) }; };
    const gf = createGithub({ api: 'https://api.github.invalid/r', fetcher: fileFetcher });
    const files = await gf.fetchPrFiles(9);
    check('LOW PR file list follows pagination past 100 files (207 files, the protected file on page 3 is seen)', Array.isArray(files) && files.length === 207 && files.includes('.github/workflows/ci.yml'));

    // M5: per-source freshness through the real gatherInputs on a synthetic repo; check-runs fail, the cached CI is served and marked (fails on 4fe58dd)
    const syn = path.join(tmp, 'syn'); fs.mkdirSync(syn); g(syn, 'init', '-q');
    fs.mkdirSync(path.join(syn, 'inv')); fs.writeFileSync(path.join(syn, 'inv', 'i.json'), JSON.stringify({ items: [] })); fs.writeFileSync(path.join(syn, 'inv', 'i.csv'), 'id,title\n');
    g(syn, 'add', '-A'); g(syn, 'commit', '-q', '-m', 'syn');
    for (const r of ['origin/v7/integration', 'origin/uasco/production-queue', 'origin/uasco/production-reports']) g(syn, 'update-ref', `refs/remotes/${r}`, 'HEAD');
    const rulesSyn = JSON.parse(JSON.stringify(rules));
    rulesSyn.sources.inventory.jsonBlob = g(syn, 'rev-parse', 'HEAD:inv/i.json'); rulesSyn.sources.inventory.csvBlob = g(syn, 'rev-parse', 'HEAD:inv/i.csv'); rulesSyn.config.tsxCandidates = [];
    const OPEN_HEAD = S('syn-open-head');
    const ghStub = async (url) => {
      if (/\/pulls\?state=all/.test(url)) return { status: 200, json: /page=1$/.test(url) ? [{ ...ghPr(7, '2026-10-26T10:00:00Z', null), head: { ref: 'claude/lane-a-x', sha: OPEN_HEAD } }] : [] };
      if (/\/actions\/runs\?/.test(url)) return { status: 200, json: { workflow_runs: [] } };
      if (/\/check-runs/.test(url)) throw new Error('HTTP 403 secondary rate limit (proof stub)');
      if (/\/files\?/.test(url)) return { status: 200, json: [] };
      return { status: 200, json: { merged_by: null } };
    };
    const oldChecks = [{ name: 'validate (ubuntu-latest)', status: 'in_progress', conclusion: null, startedAt: '2026-10-25T00:00:00Z', completedAt: null }];
    const { inputs: gi } = await gatherInputs({ repo: syn, engineDir: HERE, outDir: path.join(tmp, 'syn-out'), nowIso: '2026-10-26T19:41:00Z', rules: rulesSyn, overlay: { entries: [] }, tsx: null, cache: { checks: { [OPEN_HEAD]: oldChecks }, checksAt: { [OPEN_HEAD]: '2026-10-25T00:00:00Z' } }, cacheFrom: 'proof', priorSnapshots: [], fetcher: ghStub, workDir: tmp });
    const sc = gi.github.sources?.checks;
    check('M5 a failed check-runs call marks that source (STALE_CACHE: 1/1 failed) and the overall GitHub state PARTIAL, not FRESH', gi.github.freshness.state === 'PARTIAL' && !!sc && sc.state === 'STALE_CACHE' && sc.failed === 1 && gi.github.sources.pulls.state === 'FRESH');
    check('M5 the cached CI served after the failure carries its age (cacheAsOf 2026-10-25T00:00:00Z, 43.7 h) and is listed in staleChecks', sc && sc.servedFromCache === 1 && sc.cacheAsOf === '2026-10-25T00:00:00Z' && sc.cacheAgeHours === 43.7 && gi.github.staleChecks[OPEN_HEAD] === '2026-10-25T00:00:00Z' && JSON.stringify(gi.github.checks[OPEN_HEAD]) === JSON.stringify(oldChecks));
    check('M5 git refs that this run did not fetch are UNFETCHED (not FRESH)', gi.meta.refsFetch?.ran === false);
    // R2 LOW: freshness labels (fails on 4e1a897): every call of a source failed with nothing cached -> UNAVAILABLE (not STALE_CACHE);
    // the overall error names the first non-FRESH source with ITS OWN error (not the last error of any source)
    const ghStub2 = async (url) => {
      if (/\/pulls\?state=all/.test(url)) return { status: 200, json: /page=1$/.test(url) ? [{ ...ghPr(7, '2026-10-26T10:00:00Z', null), head: { ref: 'claude/lane-a-x', sha: OPEN_HEAD } }, ghPr(8, '2026-10-26T09:00:00Z', '2026-10-26T09:00:00Z')] : [] };
      if (/\/actions\/runs\?/.test(url)) return { status: 200, json: { workflow_runs: [] } };
      if (/\/check-runs/.test(url)) throw new Error('CHECKS-502 (proof stub)');
      if (/\/files\?/.test(url)) throw new Error('FILES-RESET (proof stub)');
      throw new Error('MERGEDBY-FAIL (proof stub)');
    };
    const { inputs: g2i } = await gatherInputs({ repo: syn, engineDir: HERE, outDir: path.join(tmp, 'syn-out2'), nowIso: '2026-10-26T19:41:00Z', rules: rulesSyn, overlay: { entries: [] }, tsx: null, cache: {}, cacheFrom: 'proof', priorSnapshots: [], fetcher: ghStub2, workDir: tmp });
    const s2 = g2i.github.sources;
    check(`R2 every call failed and nothing served from cache -> UNAVAILABLE (check-runs ${s2.checks.state}, open-PR files ${s2.prFiles.state}, merged_by ${s2.mergedBy.state}) (4e1a897: STALE_CACHE)`, s2.checks.state === 'UNAVAILABLE' && s2.checks.servedFromCache === 0 && s2.prFiles.state === 'UNAVAILABLE' && s2.mergedBy.state === 'UNAVAILABLE' && s2.pulls.state === 'FRESH' && g2i.github.freshness.state === 'PARTIAL');
    check(`R2 the overall error is the first bad source's own error (${g2i.github.freshness.error}) (4e1a897: check-runs: MERGEDBY-FAIL)`, /^check-runs: CHECKS-502/.test(g2i.github.freshness.error || '') && /CHECKS-502/.test(s2.checks.lastError || '') && /MERGEDBY-FAIL/.test(s2.mergedBy.lastError || ''));
    const mb2 = miniBundle(); mb2.inputs.github.sources = s2; mb2.inputs.github.freshness = g2i.github.freshness;
    const md2 = outputs(mb2).md;
    check('R2 section J labels the overall GitHub row by its real rule (PR table based), not "worst source"', /\| GitHub REST \(genel: PR tablosu yenilenemezse STALE_CACHE\/UNAVAILABLE, başka kaynak eksikse PARTIAL; kaynak satırlarına bakın\) \| PARTIAL \|/.test(md2) && !/en kötü kaynak/.test(md2) && /\| GitHub: check-runs \| UNAVAILABLE \|/.test(md2));
    const mb = miniBundle();
    mb.inputs.github.sources = gi.github.sources; mb.inputs.github.freshness = gi.github.freshness; mb.inputs.github.staleChecks = { [S('head5')]: '2026-10-25T00:00:00Z' }; mb.inputs.github.checks[S('head5')] = oldChecks;
    const mo = outputs(mb), mr = JSON.parse(mo.json);
    check('M5 section J lists every GitHub source with its state and the age of cached data; the open PR CI is marked as cached', /\| GitHub: check-runs \| STALE_CACHE \| 1 çağrı, 1 başarısız; önbellekten 1 kayıt \(as of 2026-10-25T00:00:00Z, 43,7 sa önce\)/.test(mo.md) && mr.openPrs.find((p) => p.number === 5)?.ciSource === 'STALE_CACHE' && /\[önbellek, as of 2026-10-25T00:00:00Z\]/.test(mo.md) && mr.dataQuality.sectionConfidence.F === 'MEDIUM');
    // LOW: git-ref freshness comes from the fetch this run did (fails on 4fe58dd: always FRESH)
    const refState = (rf) => { const b2 = miniBundle(); b2.inputs.meta.refsFetch = rf; return JSON.parse(outputs(b2).json).freshness.v7; };
    const rU = refState({ ran: false, ok: null, at: null, error: null, lastFetchHeadAt: '2026-10-24T08:00:00Z' }), rF = refState({ ran: true, ok: true, at: '2026-10-26T19:41:00Z', error: null, lastFetchHeadAt: null }), rS = refState({ ran: true, ok: false, at: null, error: 'fatal: unable to access', lastFetchHeadAt: '2026-10-24T08:00:00Z' });
    check('LOW git refs: no fetch -> UNFETCHED with the FETCH_HEAD time; fetch ok -> FRESH; fetch failed -> STALE', rU.state === 'UNFETCHED' && rU.lastFetchAt === '2026-10-24T08:00:00Z' && rF.state === 'FRESH' && rF.fetchedAt === '2026-10-26T19:41:00Z' && rS.state === 'STALE');
    // LOW: the input fingerprint covers every output-affecting input but not call accounting (fails on 4fe58dd: checks/texts ignored)
    const fpOf = (mut) => { const b3 = miniBundle(); mut(b3.inputs); return inputsFingerprint(b3.inputs, b3.meta, { nowIso: b3.nowIso, tz: 'Europe/Istanbul' }); };
    const fp0 = fpOf(() => {});
    check('LOW fingerprint changes when check-run conclusions, reports texts or open-PR files change', fp0 !== fpOf((I) => { I.github.checks[S('head1')] = I.github.checks[S('head1')].map((c) => ({ ...c, conclusion: 'failure' })); }) && fp0 !== fpOf((I) => { I.texts['reports:docs/cloud-production/reports/PRODUCTION-LOG.md'] = 'appended'; }) && fp0 !== fpOf((I) => { I.github.prFiles[30] = ['x']; }));
    check('LOW fingerprint ignores GitHub call accounting and the FRESH asOf clock', fp0 === fpOf((I) => { I.github.calls = 99; I.github.notModified = 7; I.github.rateRemaining = 4000; I.github.freshness.asOf = '2026-10-26T20:00:00Z'; }));
    // R2 LOW: a warm rerun on identical data (other FETCH_HEAD mtime, fewer calls attempted / served from cache) keeps the fingerprint (fails on 4e1a897)
    const warm = (fetchHead, attempted, served) => (I) => { I.meta.refsFetch = { ran: false, ok: null, at: null, error: null, lastFetchHeadAt: fetchHead }; I.github.sources = { pulls: { source: 'pulls', state: 'FRESH', attempted, failed: 0, servedFromCache: served, cacheAsOf: null, cacheAgeHours: null, note: null, lastError: null } }; };
    check('R2 fingerprint ignores the FETCH_HEAD mtime and per-source attempted / servedFromCache (warm rerun, identical data)', fpOf(warm('2026-10-24T08:00:00Z', 3, 0)) === fpOf(warm('2026-10-26T19:00:00Z', 1, 0)) && fpOf(warm('2026-10-24T08:00:00Z', 3, 0)) !== fpOf((I) => { warm('2026-10-24T08:00:00Z', 3, 0)(I); I.github.sources.pulls.state = 'PARTIAL'; }));
  }

  // ---- P13 product-code sandbox: the readiness runner gives v7 code no secrets and no network (fails on 4fe58dd: env leaked, connect reached)
  if (want('P13')) {
    // host-side observers: a TCP listener, a unix socket outside every sandbox dir, a root-only secret file and an escape-marker path
    let hits = 0, sockHits = 0;
    const srv = net.createServer((c) => { hits++; c.destroy(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const hostSock = path.join(tmp, 'host.sock');
    const usrv = net.createServer((c) => { sockHits++; c.destroy(); });
    await new Promise((r) => usrv.listen(hostSock, r));
    const secretFile = path.join(tmp, 'root-only-secret'); fs.writeFileSync(secretFile, 'proof-fake-secret-file\n', { mode: 0o600 });
    // the marker path is on the host filesystem outside /tmp (the sandbox's /tmp is a private tmpfs, so a write there never reaches the host)
    const marker = path.join(HERE, `.intel-escape-marker-${process.pid}`);
    const hooksDir = path.join(path.resolve(HERE, g(HERE, 'rev-parse', '--git-common-dir')), 'hooks');
    const saved = {};
    const FAKE = { GH_TOKEN: 'proof-fake-gh', GITHUB_TOKEN: 'proof-fake-github', AWS_SECRET_ACCESS_KEY: 'proof-fake-aws', AWS_ACCESS_KEY_ID: 'proof-fake-akid', MY_API_KEY: 'proof-fake-key', SOME_SECRET_VALUE: 'proof-fake-secret', CLAUDE_CODE_MESSAGING_TOKEN: 'proof-fake-msg' };
    for (const [k, v] of Object.entries(FAKE)) { saved[k] = process.env[k]; process.env[k] = v; }
    const J = JSON.stringify;
    const probeRepo = path.join(tmp, 'probe'); fs.mkdirSync(path.join(probeRepo, 'core', 'agents'), { recursive: true }); g(probeRepo, 'init', '-q');
    // every result is an enum code / count, so it travels through the validated audit schema (inputs.*)
    const probeSrc = (extraInputs = '') => `
import net from 'node:net'; import dns from 'node:dns'; import cp from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const C = (e) => { const c = String((e && (e.code || e.name)) || e).toUpperCase().replace(/[^A-Z0-9_]/g, '_'); return /^[A-Z]/.test(c) ? c.slice(0, 60) : 'E_' + c.slice(0, 58); };
const tryC = (f) => { try { const v = f(); return v === undefined ? 'RAN' : v; } catch (e) { return C(e); } };
const o = {};
o.envSecretKeys = Object.keys(process.env).filter((k) => /TOKEN|SECRET|_KEY|KEY_ID|PASSWORD|CREDENTIAL|^GH_|^GITHUB_|^AWS_/i.test(k)).length;
o.proxiesDead = ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy'].every((k) => process.env[k] === 'http://127.0.0.1:9');
o.net = await new Promise((res) => { try { const s = net.connect(${port}, '127.0.0.1'); s.on('connect', () => { s.destroy(); res('CONNECTED'); }); s.on('error', (e) => res(C(e))); setTimeout(() => res('TIMEOUT'), 2000); } catch (e) { res(C(e)); } });
try { await fetch('http://127.0.0.1:${port}/', { signal: AbortSignal.timeout(1500) }); o.fetch = 'RESPONDED'; } catch (e) { o.fetch = C(e.cause || e); }
o.dns = tryC(() => { dns.lookup('example.com', () => {}); return 'CALLED'; });
o.curl = tryC(() => { cp.execFileSync('curl', ['-sS', 'http://127.0.0.1:${port}/'], { stdio: 'ignore', timeout: 2000 }); });
o.sh = tryC(() => { cp.execSync('true'); });
// bypass 1: a node child with a caller-chosen env (no NODE_OPTIONS) must still carry the guard
o.childNoGuardEnv = tryC(() => { const r = cp.spawnSync(process.execPath, ['-e', "const n=require('net');let d=0;const f=(x)=>{if(!d){d=1;console.log(String(x).toUpperCase().replace(/[^A-Z0-9_]/g,'_'));process.exit(0)}};try{const s=n.connect(${port},'127.0.0.1');s.on('connect',()=>f('CONNECTED'));s.on('error',(e)=>f(e.code||'ERR'));setTimeout(()=>f('TIMEOUT'),1500)}catch(e){f(e.code||'ERR')}"], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 }); return (r.stdout || '').trim() || 'NO_OUTPUT'; });
// bypass 2: fork with a foreign execPath (curl)
o.forkCurl = await new Promise((res) => { try { const ch = cp.fork('http://127.0.0.1:${port}/fork-curl', [], { execPath: '/usr/bin/curl', execArgv: ['--noproxy', '*', '-sS'], stdio: 'ignore' }); ch.on('exit', () => res('RAN')); ch.on('error', (e) => res(C(e))); } catch (e) { res(C(e)); } });
// bypass 3: raw TCP / process bindings
o.bindingTcp = tryC(() => { const b = process.binding('tcp_wrap'); return typeof b.TCP === 'function' ? 'BINDING_AVAILABLE' : 'NO_TCP'; });
o.bindingSpawn = tryC(() => { process.binding('spawn_sync'); return 'BINDING_AVAILABLE'; });
// bypass 4: an executable merely NAMED node
o.fakeNode = tryC(() => { const d = path.join(os.tmpdir(), 'fake-bin'); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'node'); fs.writeFileSync(f, '#!/bin/sh\\necho FAKE_NODE_RAN\\n', { mode: 0o755 }); const r = cp.spawnSync(f, [], { encoding: 'utf8' }); return /FAKE_NODE_RAN/.test(r.stdout || '') ? 'RAN' : 'NOT_RUN'; });
// bypass 5: the parent's (or any visible process's) environment through /proc
o.procEnvironSecretHits = (() => { let n = 0; for (const d of tryC(() => fs.readdirSync('/proc')) instanceof Array ? fs.readdirSync('/proc') : []) { if (!/^\\d+$/.test(d)) continue; try { if (/proof-fake/.test(fs.readFileSync('/proc/' + d + '/environ', 'latin1'))) n++; } catch { /* unreadable */ } } return n; })();
o.ppidEnviron = tryC(() => { const t = fs.readFileSync('/proc/' + process.ppid + '/environ', 'latin1'); return /proof-fake/.test(t) ? 'SECRET_VISIBLE' : 'NO_SECRET'; });
// bypass 6: host filesystem: root-only file, a write outside the sandbox, the engine source and the repo hooks
o.readSecret = tryC(() => { fs.readFileSync(${J(secretFile)}); return 'READ_OK'; });
o.writeOutside = tryC(() => { fs.writeFileSync(${J(marker)}, 'x'); return 'WRITE_OK'; });
o.engineWritable = tryC(() => { fs.accessSync(${J(path.join(HERE, 'lib'))}, fs.constants.W_OK); return 'W_OK'; });
o.repoHooksWritable = tryC(() => { fs.accessSync(${J(hooksDir)}, fs.constants.W_OK); return 'W_OK'; });
// bypass 7: a symlink in the sandbox tmpdir to a host unix socket
o.symlinkSock = await new Promise((res) => { try { const l = path.join(os.tmpdir(), 'l.sock'); fs.symlinkSync(${J(hostSock)}, l); const s = net.connect({ path: l }); s.on('connect', () => { s.destroy(); res('CONNECTED'); }); s.on('error', (e) => res(C(e))); setTimeout(() => res('TIMEOUT'), 2000); } catch (e) { res(C(e)); } });
${extraInputs}
export const loadReadinessInputFromRepo = () => ({});
export const computeRoleReadiness = () => ({ schemaVersion: '0.0.1', authority: 'PROBE', denominator: 0, totals: {}, stageWired: { TRUE: 0, FALSE: 0, UNKNOWN: 0, NOT_APPLICABLE: 0, denominator: 0, measured: false }, byGuild: [], byCluster: [], reasonCounts: {}, proposedOnly: {}, inputs: o, anomalies: 0, computedAt: null, digest: '${'0'.repeat(64)}' });
`;
    fs.writeFileSync(path.join(probeRepo, 'core', 'agents', 'probe.mjs'), probeSrc());
    fs.writeFileSync(path.join(probeRepo, 'core', 'agents', 'launder.mjs'), probeSrc("o.note = 'free text: ' + (process.env.PATH || '');"));
    g(probeRepo, 'add', '-A'); g(probeRepo, 'commit', '-q', '-m', 'probe');
    const head = g(probeRepo, 'rev-parse', 'HEAD');
    const RR = (module, extra = {}) => runReadiness({ repo: probeRepo, v7sha: head, tsx: process.execPath, nowIso: '2026-10-26T19:41:00Z', archivePaths: ['core'], module, workDir: tmp, ...extra });
    const sbxOk = sandboxAvailable();
    if (sbxOk) {
      const rr = RR('core/agents/probe.mjs');
      await new Promise((r) => setTimeout(r, 300));
      const pr = rr.audit?.inputs;
      check(`P13 probe ran inside the real runReadiness path in the namespace sandbox (state ${rr.state}${rr.detail ? `: ${String(rr.detail).slice(0, 120)}` : ''}; isolation ${rr.sandbox?.isolation})`, rr.state === 'MEASURED' && !!pr && rr.sandbox?.isolation === SANDBOX_ISOLATION);
      check(`M6 no token/key/secret/credential reaches product code (secret-like env keys: ${pr?.envSecretKeys})`, !!pr && pr.envSecretKeys === 0);
      check('M6 every proxy variable, both cases, points at the closed port', !!pr && pr.proxiesDead === true);
      check(`M6 TCP connect, fetch, DNS, curl and a shell are all blocked (net ${pr?.net}, fetch ${pr?.fetch}, dns ${pr?.dns}, curl ${pr?.curl}, sh ${pr?.sh})`, !!pr && pr.net !== 'CONNECTED' && pr.fetch !== 'RESPONDED' && pr.dns === 'INTEL_NET_BLOCKED' && pr.curl === 'INTEL_NET_BLOCKED' && pr.sh === 'INTEL_NET_BLOCKED');
      check(`R2 guard bypasses fail inside the sandbox (node child with caller env ${pr?.childNoGuardEnv}, fork execPath=curl ${pr?.forkCurl}, process.binding tcp_wrap ${pr?.bindingTcp} / spawn_sync ${pr?.bindingSpawn}, file named node ${pr?.fakeNode}) (fails on 4e1a897: CONNECTED / RAN / BINDING_AVAILABLE)`, !!pr && pr.childNoGuardEnv === 'INTEL_NET_BLOCKED' && pr.forkCurl === 'INTEL_NET_BLOCKED' && pr.bindingTcp === 'INTEL_NET_BLOCKED' && pr.bindingSpawn === 'INTEL_NET_BLOCKED' && pr.fakeNode === 'INTEL_NET_BLOCKED');
      check(`R2 no visible process environment carries a parent secret (/proc environ hits ${pr?.procEnvironSecretHits}, ppid ${pr?.ppidEnviron})`, !!pr && pr.procEnvironSecretHits === 0 && pr.ppidEnviron !== 'SECRET_VISIBLE');
      check(`R2 host filesystem is out of reach: root-only file ${pr?.readSecret}, write outside ${pr?.writeOutside}, engine source ${pr?.engineWritable}, repo .git/hooks ${pr?.repoHooksWritable} (fails on 4e1a897: READ_OK / WRITE_OK / W_OK)`, !!pr && pr.readSecret !== 'READ_OK' && pr.writeOutside !== 'WRITE_OK' && !fs.existsSync(marker) && pr.engineWritable !== 'W_OK' && pr.repoHooksWritable !== 'W_OK');
      check(`R2 a symlink in the sandbox tmpdir to a host unix socket does not connect (${pr?.symlinkSock}; host socket saw ${sockHits}) (fails on 4e1a897: CONNECTED)`, !!pr && pr.symlinkSock !== 'CONNECTED' && sockHits === 0);
      check(`M6 the listening socket outside the sandbox saw no connection (hits ${hits})`, hits === 0);
      // the OS boundary holds without the node guard: a shell inside the same launcher tries the classic escapes
      const ob = path.join(tmp, 'os-probe'); fs.mkdirSync(ob);
      const esc = `/usr/intel-escape-${process.pid}`;
      const sh = [
        `curl -sS --max-time 2 --noproxy '*' http://127.0.0.1:${port}/os-curl >/dev/null 2>&1 && echo curl=RAN || echo curl=FAILED`,
        `n=0; for f in /proc/[0-9]*/environ; do if tr '\\0' '\\n' < "$f" 2>/dev/null | grep -q proof-fake; then n=$((n+1)); fi; done; echo environ=$n`,
        `[ -e ${J(path.join(HERE, 'lib', 'net-guard.mjs'))} ] && echo engine=VISIBLE || echo engine=ABSENT`,
        `[ -e ${J(secretFile)} ] && echo secret=VISIBLE || echo secret=ABSENT`,
        `touch ${J(marker)} 2>/dev/null && echo marker=WRITTEN || echo marker=DENIED`,
        `mount -o remount,rw /usr 2>/dev/null && echo remount=RW || echo remount=DENIED`,
        `unshare -Urm sh -c 'mount -o remount,rw,bind /usr && touch ${esc}' >/dev/null 2>&1 && echo nested=RW || echo nested=DENIED`,
        `mkdir -p x && chroot x /bin/true 2>/dev/null && echo chroot=OK || echo chroot=DENIED`,
        `touch /usr/intel-escape-direct 2>/dev/null && echo usrwrite=OK || echo usrwrite=DENIED`,
      ].join('\n');
      const os1 = sandboxSpawnSync('/bin/sh', ['-c', sh], { base: ob });
      const kv = Object.fromEntries(String(os1.stdout || '').trim().split('\n').map((l) => l.split('=')));
      fs.rmSync(ob, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 200));
      check(`R2 OS boundary without the guard (shell in the launcher): curl ${kv.curl}, /proc environ hits ${kv.environ}, engine ${kv.engine}, secret ${kv.secret}, marker ${kv.marker}, remount ${kv.remount}, nested userns ${kv.nested}, chroot ${kv.chroot}, /usr write ${kv.usrwrite}`,
        os1.status === 0 && kv.curl === 'FAILED' && kv.environ === '0' && kv.engine === 'ABSENT' && kv.secret === 'ABSENT' && kv.marker === 'DENIED' && !fs.existsSync(marker) && kv.remount === 'DENIED' && kv.nested === 'DENIED' && !fs.existsSync(esc) && kv.chroot === 'DENIED' && kv.usrwrite === 'DENIED' && !fs.existsSync('/usr/intel-escape-direct') && hits === 0);
      // laundering: product free text never reaches cache.json / published files
      const rl = RR('core/agents/launder.mjs');
      check(`R2 product output with free text is rejected, nothing of it is kept (state ${rl.state}, reason ${rl.reason}) (fails on 4e1a897: MEASURED with the text in audit.inputs)`, rl.state === 'UNAVAILABLE' && rl.reason === 'READINESS_OUTPUT_INVALID' && !rl.audit && !JSON.stringify(rl).includes('free text'));
    } else check('P13 namespace sandbox unavailable on this host: the readiness run must refuse (checked below)', true);
    // fail closed: without the namespace sandbox product code is not run at all (fails on 4e1a897: guard-only MEASURED)
    hits = 0;
    const rn = RR('core/agents/probe.mjs', { sandboxCheck: () => false });
    await new Promise((r) => setTimeout(r, 200));
    check(`R2 no namespace sandbox -> UNAVAILABLE / SANDBOX_UNAVAILABLE and the probe never ran (state ${rn.state}, reason ${rn.reason}, hits ${hits})`, rn.state === 'UNAVAILABLE' && rn.reason === 'SANDBOX_UNAVAILABLE' && !rn.audit && hits === 0 && !fs.existsSync(marker));
    srv.close(); usrv.close();
    for (const k of Object.keys(FAKE)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    // guard unit cases (no sandbox): strict guard in a child whose TMPDIR is an inner dir; a symlink there to an outer socket is refused,
    // a real socket inside works (tsx IPC), and the env/fork/binding/fake-node bypasses fail (fails on 4e1a897: path.resolve, env kept, fork passed through)
    const inner = path.join(tmp, 'gu-inner'); fs.mkdirSync(inner);
    const outerSock = path.join(tmp, 'gu-outer.sock'), innerSock = path.join(inner, 'in.sock');
    let outerHits = 0, innerHits = 0, tcpHits = 0;
    const os2 = net.createServer((c) => { outerHits++; c.destroy(); }); await new Promise((r) => os2.listen(outerSock, r));
    const is2 = net.createServer((c) => { innerHits++; c.destroy(); }); await new Promise((r) => is2.listen(innerSock, r));
    const ts2 = net.createServer((c) => { tcpHits++; c.destroy(); }); await new Promise((r) => ts2.listen(0, '127.0.0.1', r));
    const tport = ts2.address().port;
    fs.symlinkSync(outerSock, path.join(inner, 'link.sock'));
    // R3: preloads that would run before the guard (a --require preload runs even before NODE_OPTIONS --import): each one tries a TCP connect
    // and writes a marker; only a preload under the allowed bin dir (tsx's preflight/loader) may run (fails on f0f537c: the preloads ran, guard inactive)
    const guBin = path.join(tmp, 'gu-bin'); fs.mkdirSync(guBin);
    const preFile = path.join(inner, 'pre.cjs'), preMark = path.join(tmp, 'gu-pre.mark'), okFile = path.join(guBin, 'ok.cjs'), okMark = path.join(tmp, 'gu-ok.mark');
    fs.writeFileSync(preFile, `require('fs').appendFileSync(${J(preMark)}, 'RAN:' + (process.env.INTEL_NET_GUARD_ACTIVE || 'none') + '\\n'); try { const s = require('net').connect(PORT_PLACEHOLDER, '127.0.0.1'); s.on('error', () => {}); s.on('connect', () => s.destroy()); } catch {}\n`);
    fs.writeFileSync(okFile, `require('fs').appendFileSync(${J(okMark)}, 'OK\\n');\n`);
    const gsrc = `import net from 'node:net'; import cp from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const C = (e) => String((e && (e.code || e.name)) || e);
const conn = (o) => new Promise((res) => { try { const s = net.connect(o); s.on('connect', () => { s.destroy(); res('CONNECTED'); }); s.on('error', (e) => res(C(e))); setTimeout(() => res('TIMEOUT'), 1500); } catch (e) { res(C(e)); } });
const o = { active: process.env.INTEL_NET_GUARD_ACTIVE };
o.link = await conn({ path: ${J(path.join(inner, 'link.sock'))} });
o.inner = await conn({ path: ${J(innerSock)} });
o.child = (() => { try { const r = cp.spawnSync(process.execPath, ['-e', "const n=require('net');let d=0;const f=(x)=>{if(!d){d=1;console.log(String(x));process.exit(0)}};try{const s=n.connect(${tport},'127.0.0.1');s.on('connect',()=>f('CONNECTED'));s.on('error',(e)=>f(e.code||'ERR'))}catch(e){f(e.code||'ERR')}"], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 }); return (r.stdout || '').trim() || 'NO_OUTPUT'; } catch (e) { return C(e); } })();
o.fork = await new Promise((res) => { try { const ch = cp.fork('http://127.0.0.1:${tport}/fork', [], { execPath: '/usr/bin/curl', execArgv: ['--noproxy', '*', '-sS'], stdio: 'ignore' }); ch.on('exit', () => res('RAN')); ch.on('error', (e) => res(C(e))); } catch (e) { res(C(e)); } });
o.binding = (() => { try { process.binding('tcp_wrap'); return 'BINDING_AVAILABLE'; } catch (e) { return C(e); } })();
o.fakeNode = (() => { try { const f = path.join(${J(inner)}, 'node'); fs.writeFileSync(f, '#!/bin/sh\\necho RAN\\n', { mode: 0o755 }); return (cp.spawnSync(f, [], { encoding: 'utf8' }).stdout || '').trim() || 'NO_OUTPUT'; } catch (e) { return C(e); } })();
o.internals = (() => { try { cp.spawnSync(process.execPath, ['--expose-internals', '-e', '0']); return 'RAN'; } catch (e) { return C(e); } })();
const sp = (args, env) => { try { cp.spawnSync(process.execPath, args, { env: { PATH: process.env.PATH, ...(env || {}) }, encoding: 'utf8', timeout: 5000 }); return 'SPAWNED'; } catch (e) { return C(e); } };
o.preArgv = sp(['--require', ${J(preFile)}, '-e', '0']);
o.preShort = sp(['-r', ${J(preFile)}, '-e', '0']);
o.preEnv = sp(['-e', '0'], { NODE_OPTIONS: '--require ' + ${J(preFile)} });
o.preImport = sp(['--import=' + ${J(pathToFileURL(preFile).href)}, '-e', '0']);
o.preRel = sp(['--require', './pre.cjs', '-e', '0']);
o.preFork = await new Promise((res) => { try { const ch = cp.fork(${J(path.join(inner, 'noop.mjs'))}, [], { execArgv: ['--require', ${J(preFile)}], stdio: 'ignore' }); ch.on('exit', () => res('RAN')); ch.on('error', (e) => res(C(e))); } catch (e) { res(C(e)); } });
o.preAllowed = sp(['--require', ${J(okFile)}, '-e', '0']);
await new Promise((r) => setTimeout(r, 300));
console.log(JSON.stringify(o));`;
    fs.writeFileSync(preFile, fs.readFileSync(preFile, 'utf8').replace('PORT_PLACEHOLDER', String(tport)));
    fs.writeFileSync(path.join(inner, 'noop.mjs'), '');
    const gfile = path.join(tmp, 'guard-unit.mjs'); fs.writeFileSync(gfile, gsrc);
    const gr = spawnSync(process.execPath, [gfile], { encoding: 'utf8', cwd: inner, env: { PATH: NOENV.PATH, TMPDIR: inner, NODE_OPTIONS: `--import ${new URL('./lib/net-guard.mjs', import.meta.url).href}`, INTEL_NET_GUARD: 'strict', INTEL_NET_GUARD_ALLOW_BIN_DIR: guBin }, timeout: 30000 });
    let gu = null; try { gu = JSON.parse(String(gr.stdout).trim().split('\n').pop()); } catch { gu = null; }
    await new Promise((r) => setTimeout(r, 200));
    os2.close(); is2.close(); ts2.close();
    check(`R2 guard: a tmpdir symlink to an outer unix socket is refused by realpath (${gu?.link}, outer hits ${outerHits}); a real tmpdir socket still connects (${gu?.inner}, inner hits ${innerHits}; guard ${gu?.active}) (fails on 4e1a897: CONNECTED)`, !!gu && gu.active === 'strict' && gu.link === 'INTEL_NET_BLOCKED' && outerHits === 0 && gu.inner === 'CONNECTED' && innerHits === 1);
    check(`R2 guard: node child with a caller env (${gu?.child}), fork execPath=curl (${gu?.fork}), process.binding tcp_wrap (${gu?.binding}), a file named node (${gu?.fakeNode}), --expose-internals (${gu?.internals}) are all blocked; TCP listener hits ${tcpHits}`, !!gu && gu.child === 'INTEL_NET_BLOCKED' && gu.fork === 'INTEL_NET_BLOCKED' && gu.binding === 'INTEL_NET_BLOCKED' && gu.fakeNode === 'INTEL_NET_BLOCKED' && gu.internals === 'INTEL_NET_BLOCKED' && tcpHits === 0);
    const preRan = fs.existsSync(preMark) ? fs.readFileSync(preMark, 'utf8').trim().split('\n') : [];
    check(`R3 guard: node children cannot preload code ahead of the guard: --require (${gu?.preArgv}), -r (${gu?.preShort}), caller NODE_OPTIONS --require (${gu?.preEnv}), --import= file URL (${gu?.preImport}), a relative specifier (${gu?.preRel}) and fork execArgv --require (${gu?.preFork}) are blocked; preload runs ${preRan.length} (${preRan.join(',') || 'none'}), TCP hits ${tcpHits} (f0f537c: preloads ran with the guard inactive)`,
      !!gu && ['preArgv', 'preShort', 'preEnv', 'preImport', 'preRel', 'preFork'].every((k) => gu[k] === 'INTEL_NET_BLOCKED') && preRan.length === 0 && tcpHits === 0);
    check(`R3 guard control: a preload under the allowed bin dir (tsx preflight/loader shape) still runs (${gu?.preAllowed}, marker ${fs.existsSync(okMark) ? 'written' : 'missing'})`, !!gu && gu.preAllowed === 'SPAWNED' && fs.existsSync(okMark));
    // audit schema: numbers / enums / ids / hex / timestamps only
    const okA = { schemaVersion: '1.0.0', authority: 'AUTHORITATIVE_READINESS_MEASUREMENT', denominator: 2, totals: { DEFINED: { TRUE: 2, FALSE: 0, UNKNOWN: 0, NOT_APPLICABLE: 0, denominator: 2, measured: true } }, stageWired: { TRUE: 0, FALSE: 2, UNKNOWN: 0, NOT_APPLICABLE: 0, denominator: 2, measured: false }, byGuild: [{ id: 'G01', kind: 'GUILD', clusterId: 'CL01', roles: 2, layers: {}, proposedOnly: { withCandidateSkills: 1 } }], byCluster: [], reasonCounts: { 'EXECUTABLE.stageWired': { NO_CODE_PATH: 2 } }, proposedOnly: { source: 'PROPOSED_DERIVED_NOT_RUNTIME', profiles: 2 }, inputs: { journal: 'ABSENT', roleDefinitionsSha256: 'a'.repeat(64), skillIds: 3 }, anomalies: 0, computedAt: '2026-10-26T23:32:07.997Z', digest: 'b'.repeat(64) };
    const vA = validateAudit(okA), vB = validateAudit({ ...okA, inputs: { ...okA.inputs, journal: 'ghp_ABC def' } }), vC = validateAudit({ ...okA, extra: 1 }), vD = validateAudit({ ...okA, reasonCounts: { 'x y': { A: 1 } } });
    check('R2 audit schema keeps a well-formed audit and rejects free text, unknown keys and invalid keys', vA.ok && JSON.stringify(vA.audit.inputs) === JSON.stringify(okA.inputs) && !vB.ok && !vC.ok && !vD.ok && !JSON.stringify(vB.errors).includes('ghp_'));
  }

  // ---- P14 bounded local archive: newest intel snapshot per TRT date, legacy-v0 never pruned (fails on 4fe58dd: grew without bound)
  if (want('P14')) {
    const od = path.join(tmp, 'arch-out');
    const put = (d, j) => { fs.mkdirSync(path.join(od, 'archive', d), { recursive: true }); fs.writeFileSync(path.join(od, 'archive', d, 'UASCO_REMAINING_WORK.json'), JSON.stringify(j)); };
    put('20261026T200549Z', { generatedAt: '2026-10-26T20:05:49Z', totals: {} });
    put('20261025T100000Z', { generatedAt: '2026-10-25T10:00:00Z', schemaVersion: 'intel-1.0.0', trendPoint: {} });
    put('20261025T120000Z', { generatedAt: '2026-10-25T12:00:00Z', schemaVersion: 'intel-1.0.0', trendPoint: {} });
    put('20261027T193000Z', { generatedAt: '2026-10-27T19:30:00Z', schemaVersion: 'intel-1.0.0', trendPoint: {} });
    const dropped = pruneArchive(od, { tz: 'Europe/Istanbul', archiveMaxDays: 60 });
    const left = fs.readdirSync(path.join(od, 'archive')).sort();
    check(`P14 same-TRT-date intel duplicates pruned to the newest, legacy-v0 kept (left ${left.join(',')})`, JSON.stringify(dropped) === '["20261025T100000Z"]' && JSON.stringify(left) === '["20261025T120000Z","20261026T200549Z","20261027T193000Z"]');
    put('20261028T193000Z', { generatedAt: '2026-10-28T19:30:00Z', schemaVersion: 'intel-1.0.0', trendPoint: {} });
    pruneArchive(od, { tz: 'Europe/Istanbul', archiveMaxDays: 2 });
    check('P14 at most archiveMaxDays intel dates are kept (oldest intel date dropped, legacy-v0 kept)', JSON.stringify(fs.readdirSync(path.join(od, 'archive')).sort()) === '["20261026T200549Z","20261027T193000Z","20261028T193000Z"]');
  }

  // ---- P8 guard and time
  if (want('P8')) {
    check('P8 20:59:59Z belongs to the same TRT date, 21:00:00Z to the next', trtDate('2026-10-26T20:59:59Z') === '2026-10-26' && trtDate('2026-10-26T21:00:00Z') === '2026-10-27');
    check('P8 19:41Z is 22:41 TRT', trtClock('2026-10-26T19:41:00Z') === '22:41');
    const bare = path.join(tmp, 'r.git'); g(tmp, 'init', '-q', '--bare', bare);
    const seed = path.join(tmp, 'seed'); fs.mkdirSync(seed); g(seed, 'init', '-q'); g(seed, 'checkout', '-q', '-b', 'uasco/production-reports');
    fs.mkdirSync(path.join(seed, 'docs/cloud-production/reports/daily/2026-10-27'), { recursive: true }); fs.writeFileSync(path.join(seed, 'docs/cloud-production/reports/daily/2026-10-27/manifest.json'), '{}\n');
    g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'daily'); g(seed, 'remote', 'add', 'origin', bare); g(seed, 'push', '-q', 'origin', 'uasco/production-reports');
    const work = path.join(tmp, 'w'); g(tmp, 'clone', '-q', bare, work);
    const cli = (...a) => spawnSync(process.execPath, [path.join(HERE, 'intel.mjs'), ...a], { encoding: 'utf8', env: NOENV });
    const w = cli('daily', '--publish', '--repo', work, '--out', path.join(tmp, 'o'), '--now', '2026-10-26T19:00:00Z');
    check('P8 before notBefore -> INTEL WAIT, exit 0', w.status === 0 && w.stdout.trim() === 'INTEL WAIT 22:00 TRT');
    const s = cli('daily', '--publish', '--repo', work, '--out', path.join(tmp, 'o'), '--now', '2026-10-27T19:45:00Z');
    check('P8 manifest present (22:45 TRT on 2026-10-27) -> INTEL SKIP <date> PRESENT <sha7>, exit 0', s.status === 0 && /^INTEL SKIP 2026-10-27 PRESENT [0-9a-f]{7}$/.test(s.stdout.trim()));
    const a0 = cli('daily', '--publish', '--repo', work, '--out', path.join(tmp, 'o'), '--now', '2026-10-26T21:30:00Z');
    check('P8 00:30 TRT belongs to the next TRT day and waits for its own 22:41', a0.status === 0 && a0.stdout.trim() === 'INTEL WAIT 00:30 TRT');
    const ga = cli('guard', '--date', '2026-10-28', '--repo', work), gp = cli('guard', '--date', '2026-10-27', '--repo', work);
    check('P8 guard: ABSENT exits 3, PRESENT exits 0', ga.status === 3 && /ABSENT/.test(ga.stdout) && gp.status === 0 && /PRESENT/.test(gp.stdout));
  }

  // ---- P9 legacy continuity
  if (want('P9')) {
    const kp = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'legacy-keypaths.json'), 'utf8')).keyPaths;
    const r = JSON.parse(outputs(miniBundle()).json);
    const type = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    const get = (obj, p) => { const parts = p.split('.'); let cur = [obj]; for (const part of parts) { const arr = part.endsWith('[]'); const k = arr ? part.slice(0, -2) : part; cur = cur.flatMap((o) => (o && typeof o === 'object' && k in o ? [o[k]] : [])); if (arr) cur = cur.flatMap((v) => (Array.isArray(v) && v.length ? [v[0]] : [])); } return cur; };
    const missing = [], typeDiff = [];
    for (const { path: p, type: t } of kp) {
      if (p.includes('[]') && get(r, p.split('[]')[0] + '[]').length === 0) continue;
      const v = get(r, p);
      if (!v.length) { missing.push(p); continue; }
      const tt = type(v[0]);
      // documented UNKNOWN markers (FIELD_SEMANTICS): an open PR whose file list could not be fetched has founder 'UNKNOWN' and protectedFiles null
      const unknownFiles = /^openPrs\[\]\.(founder|protectedFiles)$/.test(p) && r.openPrs[0]?.protectedFilesKnown === false && (p.endsWith('founder') ? v[0] === 'UNKNOWN' : v[0] === null);
      if (!(tt === t || unknownFiles || (t === 'number' && tt === 'number') || (p === 'totals.VERIFIED_REMAINING' && (tt === 'string' || tt === 'number')))) typeDiff.push(`${p}:${t}->${tt}`);
    }
    check(`P9 every legacy key path exists (${kp.length} paths; missing: ${missing.slice(0, 5).join(',') || 'none'})`, missing.length === 0);
    check(`P9 every legacy key path keeps its type (diffs: ${typeDiff.slice(0, 5).join(',') || 'none'})`, typeDiff.length === 0);
    const known = r.openPrs.filter((x) => x.protectedFilesKnown === true), unk = r.openPrs.filter((x) => x.protectedFilesKnown === false);
    check(`P9 open PRs with a known file list keep the legacy types (founder boolean, protectedFiles number: ${known.length}); only file-list-UNKNOWN PRs carry the UNKNOWN markers (${unk.length})`, known.length > 0 && known.every((x) => typeof x.founder === 'boolean' && typeof x.protectedFiles === 'number') && unk.every((x) => (x.founder === 'UNKNOWN' || x.founder === true) && x.protectedFiles === null));
    const need = ['totals.allWorkDimensions.byStatus', 'totals.UNRECONCILED_WORK', 'totals.VERIFICATION_PENDING_MERGED', 'inputs.wave0', 'fingerprint', 'mvp', 'openPrs[].founder', 'fullScope.resolvers', 'fullScope.toolAdaptersImplemented_perWave0', 'eta'];
    check('P9 fieldSemantics names every refined field', need.every((k) => k in FIELD_SEMANTICS) && JSON.stringify(r.fieldSemantics) === JSON.stringify(FIELD_SEMANTICS));
    check('P9 totals.legacyV0 is present with the v0 summary shape', ['rows', 'unique', 'live', 'byStatus', 'stale', 'mvpScope_AT_RISK'].every((k) => k in r.totals.legacyV0.allWorkDimensions));
  }

  // ---- P12 mutants: each mutation must fail at least one proof
  if (want('P12')) {
    const MUT = [
      { name: 'swap precedence rules 5 (FOUNDER) and 6 (BLOCKED)', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("else if (openDecisions.length || ebc === 'STALE_FOUNDER'", "else if (queueStates.includes('BLOCKED') || backlogStates.includes('BLOCKED') || ebc === 'STALE_BLOCKED') { status = 'BLOCKED'; rule = 6; }\n  else if (openDecisions.length || ebc === 'STALE_FOUNDER'") },
      { name: 'H1: treat every 19-Oct prs reference as EXPLICIT (the v0 rule)', file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("if (r.strength === 'EXPLICIT') explicit.set(", "if (true) explicit.set(") },
      { name: 'H1: count PARTIAL as integrated', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const integrated = integratedBy.length > 0 && !partial;', 'const integrated = integratedBy.length > 0;') },
      { name: 'M1: start from any linked PR incl. closed-unmerged', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('return !!(p && (p.mergedAt || p.state === \'open\'));', 'return !!p;') },
      { name: 'count DUPLICATE rows as live', file: 'model/identity.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("if (r.status19 === 'DUPLICATE' || r.status19 === 'OBSOLETE') { it.excluded", "if (r.status19 === 'OBSOLETE') { it.excluded") },
      { name: 'add body-only promotion for non-claim rows', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const relink = [...recExplicit, ...overlayL, ...tb];', 'const relink = [...recExplicit, ...overlayL, ...tb, ...body];') },
      { name: 'drop the UNASSIGNED fallback', file: 'model/departments.mjs', proof: 'model/departments.proof.mjs', apply: (s) => s.replace("return { department: 'UNASSIGNED', ruleId: 'FALLBACK' };", "return { department: 'DESKTOP_UX', ruleId: 'FALLBACK' };") },
      { name: 'R2-M1: any commit naming the id sets the start (bookkeeping commits included)', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('l.at && (integMsg.has(l.ref) || isOwnCommit(commitSubjects.get(l.ref), id, resolver, ownCommit))', 'l.at') },
      { name: 'R2-M1: start commits for items that are not coded', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const ownStartCommits = coded !== T ? [] : [', 'const ownStartCommits = [') },
      { name: 'R2-H1: PARTIAL short-circuits independent evidence', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const s1 = pick([...recExplicit, ...overlayL], integratedPr), s2 = pick(tb, integratedPr);\n    const plus', 'const s1 = [], s2 = [];\n    const plus') },
      { name: 'R2-H1: ignore annotations that name another item', file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('        if (ids.length) return ids[0];', '        if (false) return ids[0];') },
      { name: 'R3-M1: no slug normalisation of 19-Oct annotations (claude/l-assurance-ui034 names nothing)', file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const ids = resolver.resolveText(deslug(ann));', 'const ids = resolver.resolveText(ann);') },
      { name: "R3-M1: a PR whose own title names another item is not other-item", file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('return ownOther.length ? ownOther[0] : null;', 'return null;') },
      { name: 'R3-M1: ignore the 19-Oct prToWorkItems assignment', file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace(" || (prToWorkItems[`#${n}`] || []).includes(it.id)", '') },
      { name: 'R3-M2: bookkeeping PR titles count as ID_IN_TITLE evidence again', file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("if (field !== 'body' && isBk(n, it.id, field))", 'if (false)') },
      { name: "R3-M2: ignore 'DONE' status clauses in wave titles", file: 'model/links.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("return b === 'ALL' || (field === 'title' && !!b && b.has(id));", "return b === 'ALL';") },
      { name: 'R3-L1: other-item references corroborate a merged claim again', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("sw = pick(invWeak.filter((l) => !l.source.startsWith('inventory.prs:other-item:')), integratedPr)", 'sw = pick(invWeak, integratedPr)') },
      { name: 'R3-L2: WEAK-only rows reported as EVIDENCED_BY_PR', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("weakOnly ? 'CORROBORATED_BY_WEAK_REF' : ", '') },
      { name: 'R3-L2: D.2 hides the WEAK PRs of a WEAK-only row', file: 'render/report-md.mjs', proof: 'render/render.proof.mjs', apply: (s) => s.replace("x.prs.map((n) => `#${n}`).join(', ') || ((x.weakPrs || []).length ?", "x.prs.map((n) => `#${n}`).join(', ') || ((x.weakPrs || []).length && false ?") },
      { name: 'R3-L3: the integrating commit does not date the start', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('(integMsg.has(l.ref) || isOwnCommit(', '(isOwnCommit(') },
      { name: 'R3-L3: bookkeeping head word ends at \\b (matches before -)', file: 'rules/link-patterns.json', proof: 'model/status.proof.mjs', apply: (s) => s.replace('|dispatch)(?![-\\\\w])', '|dispatch)\\\\b') },
      { name: 'R3-L3: no earlierMention for an unattributed earlier commit', file: 'model/pipeline.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const earlierMention = em ?', 'const earlierMention = false ?') },
      { name: 'R2-LOW: WEAK corroboration credits tested / CI / merge dates', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace('const integPrs = weakOnly ? [] :', 'const integPrs =') },
      { name: 'R2-LOW: runtimeVerified back to a measured FALSE', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("const runtimeVerified = live ? 'NOT_MEASURED' : U;", 'const runtimeVerified = live ? F : U;') },
      { name: 'R2-LOW: open PR without a file list shown as founder false', file: 'render/report-json.mjs', proof: 'render/render.proof.mjs', apply: (s) => s.replace(": filesKnown ? false : 'UNKNOWN';", ': false;') },
      { name: 'count status-only merged claims as integrated', file: 'model/status.mjs', proof: 'model/status.proof.mjs', apply: (s) => s.replace("else { reconClass = 'STATUS_ONLY_UNVERIFIED'; confidence = 'LOW';", "else { reconClass = 'STATUS_ONLY_UNVERIFIED'; integratedBy = inv.length ? inv : [{ kind: 'COMMIT', ref: 'x', strength: 'X' }]; confidence = 'LOW';") },
    ];
    for (const mu of MUT) {
      const dir = path.join(tmp, `mut-${sha256(mu.name).slice(0, 6)}`);
      fs.cpSync(HERE, dir, { recursive: true });
      const f = path.join(dir, mu.file); const src = fs.readFileSync(f, 'utf8'); const mut = mu.apply(src);
      if (mut === src) { check(`P12 mutant applies: ${mu.name}`, false); continue; }
      fs.writeFileSync(f, mut);
      const r = spawnSync(process.execPath, [path.join(dir, mu.proof)], { encoding: 'utf8', env: { ...NOENV, INTEL_REPO: HERE } });
      check(`P12 mutant killed: ${mu.name} (${mu.proof} exit ${r.status})`, r.status !== 0 && /FAIL /.test(r.stdout));
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of fs.readdirSync(HERE).filter((n) => n.startsWith('.intel-escape-marker-'))) fs.rmSync(path.join(HERE, f), { force: true });
}
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
