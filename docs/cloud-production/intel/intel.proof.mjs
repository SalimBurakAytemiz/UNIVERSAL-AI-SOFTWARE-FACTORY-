//TR: UASCO Intel V1 toplu kanıt betiği (node docs/cloud-production/intel/intel.proof.mjs). Ağ yoktur: betik kendini ağ korumasıyla (lib/net-guard.mjs, proof kipi: her node sürecine NODE_OPTIONS ile ön yüklenir; git yalnız file protokolü) ve izin listeli ortamla (token/sır yok, iki harf düzeninde ölü vekil, GIT_CONFIG_GLOBAL=/dev/null, imzasız commit) yeniden çalıştırır; GitHub kaynağı enjekte edilir ve çağrı sayısı 0 doğrulanır. Kapsam: alt kanıtlar (P3 P4 P5 P6 P10 P11) + P1 determinizm, P2 taban uzlaştırması (gerçek 19 Ekim blob'u), P7 tazelik/hız (ETag, kaynak başına tazelik, parmak izi, git ref tazeliği), P8 guard/zaman, P9 eski anahtar sürekliliği, P12 mutantlar, P13 ürün kodu kum havuzu (ortam + ağ sondası), P14 sınırlı arşiv.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { miniBundle, S } from './fixtures/mini/bundle.mjs';
import { loadRules } from './lib/gather.mjs';
import { createGithub } from './lib/github.mjs';
import { legacyView, loadBaseline } from './model/baseline.mjs';
import { FIELD_SEMANTICS } from './render/report-json.mjs';
import { sha256 } from './core/canonical-json.mjs';
import { trtDate, trtClock } from './core/time.mjs';
import { verifyOutputs, buildOutputs, pruneArchive } from './intel.mjs';
import { gatherInputs, inputsFingerprint } from './lib/gather.mjs';
import { runReadiness } from './lib/readiness-runner.mjs';
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
  }

  // ---- P13 product-code sandbox: the readiness runner gives v7 code no secrets and no network (fails on 4fe58dd: env leaked, connect reached)
  if (want('P13')) {
    let hits = 0;
    const srv = net.createServer((c) => { hits++; c.destroy(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const saved = {};
    const FAKE = { GH_TOKEN: 'proof-fake-gh', GITHUB_TOKEN: 'proof-fake-github', AWS_SECRET_ACCESS_KEY: 'proof-fake-aws', AWS_ACCESS_KEY_ID: 'proof-fake-akid', MY_API_KEY: 'proof-fake-key', SOME_SECRET_VALUE: 'proof-fake-secret', CLAUDE_CODE_MESSAGING_TOKEN: 'proof-fake-msg' };
    for (const [k, v] of Object.entries(FAKE)) { saved[k] = process.env[k]; process.env[k] = v; }
    const probeRepo = path.join(tmp, 'probe'); fs.mkdirSync(path.join(probeRepo, 'core', 'agents'), { recursive: true }); g(probeRepo, 'init', '-q');
    fs.writeFileSync(path.join(probeRepo, 'core', 'agents', 'probe.mjs'), `
import net from 'node:net'; import dns from 'node:dns'; import cp from 'node:child_process';
const out = { env: Object.keys(process.env).filter((k) => /TOKEN|SECRET|_KEY|KEY_ID|PASSWORD|CREDENTIAL|^GH_|^GITHUB_|^AWS_/i.test(k)).sort(), proxies: ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy'].map((k) => k + '=' + (process.env[k] || '')), net: null, fetch: null, dns: null, curl: null, sh: null };
const code = (e) => (e && (e.code || e.name)) || String(e);
out.net = await new Promise((res) => { try { const s = net.connect(${port}, '127.0.0.1'); s.on('connect', () => { s.destroy(); res('CONNECTED'); }); s.on('error', (e) => res(code(e))); setTimeout(() => res('TIMEOUT'), 2000); } catch (e) { res(code(e)); } });
try { await fetch('http://127.0.0.1:${port}/', { signal: AbortSignal.timeout(1500) }); out.fetch = 'RESPONDED'; } catch (e) { out.fetch = code(e.cause || e); }
try { dns.lookup('example.com', () => {}); out.dns = 'CALLED'; } catch (e) { out.dns = code(e); }
try { cp.execFileSync('curl', ['-sS', 'http://127.0.0.1:${port}/'], { stdio: 'ignore', timeout: 2000 }); out.curl = 'RAN'; } catch (e) { out.curl = code(e); }
try { cp.execSync('true'); out.sh = 'RAN'; } catch (e) { out.sh = code(e); }
export const loadReadinessInputFromRepo = () => ({});
export const computeRoleReadiness = () => ({ schemaVersion: 'probe', authority: 'probe', denominator: 0, totals: {}, stageWired: [], byGuild: [], byCluster: [], reasonCounts: {}, proposedOnly: {}, inputs: { probe: out }, anomalies: [], computedAt: null, digest: 'probe' });
`);
    g(probeRepo, 'add', '-A'); g(probeRepo, 'commit', '-q', '-m', 'probe');
    const rr = runReadiness({ repo: probeRepo, v7sha: g(probeRepo, 'rev-parse', 'HEAD'), tsx: process.execPath, nowIso: '2026-10-26T19:41:00Z', archivePaths: ['core'], module: 'core/agents/probe.mjs', workDir: tmp });
    await new Promise((r) => setTimeout(r, 300));
    srv.close();
    for (const k of Object.keys(FAKE)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    const pr = rr.audit?.inputs?.probe;
    check(`P13 probe ran inside the real runReadiness path (state ${rr.state}${rr.detail ? `: ${String(rr.detail).slice(0, 120)}` : ''})`, rr.state === 'MEASURED' && !!pr);
    check(`M6 no token/key/secret/credential reaches product code (seen: ${pr ? pr.env.join(',') || 'none' : '?'})`, !!pr && pr.env.length === 0);
    check('M6 every proxy variable, both cases, points at the closed port', !!pr && pr.proxies.every((x) => /=http:\/\/127\.0\.0\.1:9$/.test(x)));
    check(`M6 TCP connect, fetch, DNS, curl and a shell are all blocked (net ${pr?.net}, fetch ${pr?.fetch}, dns ${pr?.dns}, curl ${pr?.curl}, sh ${pr?.sh})`, !!pr && pr.net !== 'CONNECTED' && pr.fetch !== 'RESPONDED' && pr.dns === 'INTEL_NET_BLOCKED' && pr.curl === 'INTEL_NET_BLOCKED' && pr.sh === 'INTEL_NET_BLOCKED' && [pr.net, pr.fetch].every((x) => x === 'INTEL_NET_BLOCKED' || rr.sandbox?.isolation === 'netns+guard'));
    check(`M6 the listening socket outside the sandbox saw no connection (hits ${hits})`, hits === 0);
    const rg = runReadiness({ repo: probeRepo, v7sha: g(probeRepo, 'rev-parse', 'HEAD'), tsx: process.execPath, nowIso: '2026-10-26T19:41:00Z', archivePaths: ['core'], module: 'core/agents/probe.mjs', workDir: tmp, netns: false });
    const pg = rg.audit?.inputs?.probe;
    check(`M6 without a network namespace the preload guard alone blocks connect and fetch (net ${pg?.net}, fetch ${pg?.fetch}; isolation ${rg.sandbox?.isolation})`, !!pg && rg.sandbox?.isolation === 'guard' && pg.net === 'INTEL_NET_BLOCKED' && pg.fetch === 'INTEL_NET_BLOCKED' && pg.env.length === 0);
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
      if (!(tt === t || (t === 'number' && tt === 'number') || (p === 'totals.VERIFIED_REMAINING' && (tt === 'string' || tt === 'number')))) typeDiff.push(`${p}:${t}->${tt}`);
    }
    check(`P9 every legacy key path exists (${kp.length} paths; missing: ${missing.slice(0, 5).join(',') || 'none'})`, missing.length === 0);
    check(`P9 every legacy key path keeps its type (diffs: ${typeDiff.slice(0, 5).join(',') || 'none'})`, typeDiff.length === 0);
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
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
