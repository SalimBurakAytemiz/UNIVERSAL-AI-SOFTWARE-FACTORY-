//TR: Saf olmayan toplama kenarı: git ve GitHub'dan tek bir girdi paketi (inputs bundle) kurar. Saf çekirdek yalnız bu paketi görür; aynı paket + aynı saat => bayt bayt aynı çıktı. Önbellek (cache.json) ETag'leri, imleçleri, değişmez check/timing/job kayıtlarını ve pickaxe sonuçlarını taşır.
import fs from 'node:fs';
import path from 'node:path';
import { git, gitTry, resolveRefs, showText, showJson, catBlob, blobId, lsTree, readBlobs, revList, logCommits, pickaxeFirst, fileHistory, resolveCommits, commitDates, objectId } from './git.mjs';
import { createGithub, pool } from './github.mjs';
import { findTsx, readinessKey, runReadiness } from './readiness-runner.mjs';
import { sha256, digestOf, cmp } from '../core/canonical-json.mjs';
import { trtDate } from '../core/time.mjs';
import { decisionLiterals, headRefsOf } from '../model/coordinator.mjs';

const RULE_FILES = ['config', 'sources', 'status-map', 'link-patterns', 'scope', 'departments', 'targets', 'mvp-chain', 'next-actions', 'agent-factory', 'weights'];

export function loadRules(engineDir) {
  const rules = {};
  for (const n of RULE_FILES) rules[n] = JSON.parse(fs.readFileSync(path.join(engineDir, 'rules', `${n}.json`), 'utf8'));
  const overlay = JSON.parse(fs.readFileSync(path.join(engineDir, 'overlay', 'reconciliation.json'), 'utf8'));
  return { rules, overlay };
}
export function engineIdentity(engineDir) {
  const top = gitTry(engineDir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { engineTree: 'UNTRACKED', dirty: null, rulesBlobIds: {}, overlayBlobId: null, wave0BlobId: null };
  const root = top.out.trim();
  const rel = path.relative(root, engineDir).split(path.sep).join('/');
  const tree = objectId(root, `HEAD:${rel}`);
  const st = gitTry(root, ['status', '--porcelain', '--', rel]);
  const ids = {};
  for (const n of RULE_FILES) ids[n] = objectId(root, `HEAD:${rel}/rules/${n}.json`) || 'UNTRACKED';
  const blobOfFile = (p) => gitTry(root, ['hash-object', p]).out.trim() || null;
  return { engineTree: tree || 'UNTRACKED', dirty: st.ok ? st.out.trim() : null, rulesBlobIds: ids,
    overlayBlobId: blobOfFile(path.join(engineDir, 'overlay', 'reconciliation.json')), wave0BlobId: blobOfFile(path.join(engineDir, 'inputs', 'wave0-baseline.json')),
    rulesWorkingBlobIds: Object.fromEntries(RULE_FILES.map((n) => [n, blobOfFile(path.join(engineDir, 'rules', `${n}.json`))])) };
}

export function loadCache(outDir, repo, reportsRef, dailyDir) {
  const local = path.join(outDir, '.intel-cache', 'cache.json');
  try { return { cache: JSON.parse(fs.readFileSync(local, 'utf8')), from: 'local' }; } catch { /* next */ }
  const r = gitTry(repo, ['ls-tree', '--name-only', `${reportsRef}:${dailyDir}`]);
  if (r.ok) {
    const dates = r.out.split('\n').filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const d of dates.reverse()) { const t = showText(repo, reportsRef, `${dailyDir}/${d}/cache.json`); if (t) { try { return { cache: JSON.parse(t), from: `daily:${d}` }; } catch { /* next */ } } }
  }
  return { cache: {}, from: 'cold' };
}

const compactQueueTasks = (q) => (q?.tasks || []).map((t) => ({ id: t.id, status: t.status })).sort((a, b) => cmp(a.id, b.id));

function parsePeriods(md) {
  const periods = []; let cur = null;
  for (const line of String(md || '').split('\n')) {
    let m = /^## PERIOD ([A-Z]) — (.+)$/.exec(line);
    if (m) { cur = { period: m[1], title: m[2].trim(), phases: [] }; periods.push(cur); continue; }
    m = /^### Phase (\d+) — /.exec(line);
    if (m && cur) cur.phases.push(Number(m[1]));
  }
  return periods;
}

export async function gatherInputs({ repo, engineDir, outDir, nowIso, rules, overlay, tsx: tsxOpt, cache: cacheIn, cacheFrom, priorSnapshots, fetcher = null, workDir, log = () => {} }) {
  const S = rules.sources, C = rules.config;
  const refs = resolveRefs(repo, C.refs);
  for (const k of ['v7', 'queue', 'reports']) if (!refs[k]) throw new Error(`REF_UNRESOLVED:${C.refs[k]}`);
  const v7 = refs.v7.sha, qsha = refs.queue.sha;
  const cache = JSON.parse(JSON.stringify(cacheIn || {}));
  cache.schemaVersion = 'intel-cache-1';

  // ---- 19-Oct inventory at pinned blobs (immutable; a missing blob is an error, never a skip)
  const invText = catBlob(repo, S.inventory.jsonBlob), csvText = catBlob(repo, S.inventory.csvBlob);
  if (!invText || !csvText) throw new Error('INVENTORY_BLOB_MISSING');
  const invAtHead = blobId(repo, v7, S.inventory.jsonPath);
  const dependencyMap = showJson(repo, v7, S.inventory.dependencyMapPath);

  // ---- roadmap
  const R = S.roadmap;
  const contractFiles = lsTree(repo, v7, R.contractsDir).filter((e) => /phase-\d{3}\.json$/.test(e.path)).map((e) => e.path).sort(cmp);
  const blobs = readBlobs(repo, contractFiles.map((p) => `${v7}:${p}`));
  const dateFieldsFound = [];
  const contracts = contractFiles.map((p) => {
    const j = JSON.parse(blobs.get(`${v7}:${p}`));
    for (const f of S.dateFieldCandidates) if (j[f] !== undefined) dateFieldsFound.push(`${p}:${f}`);
    return { phase: j.phase, title: j.title, domain: j.domain, state: j.state, dependsOn: j.dependsOn || [], riskLevel: j.riskLevel ?? null, reviewProfile: j.reviewProfile ?? null, review: j.review || [], requiredArtifacts: j.requiredArtifacts || [] };
  });
  const roadmapMd = showText(repo, v7, R.roadmapMd) || '';
  const tree = lsTree(repo, v7, '');
  const attRe = new RegExp(S.attestationNamePattern);
  const roadmap = {
    graph: showJson(repo, v7, R.graph), contracts, waves: showJson(repo, v7, R.waves), criticalPath: showJson(repo, v7, R.criticalPath),
    lanes: showJson(repo, v7, R.lanes), packages: showJson(repo, v7, R.packages), schedulerTemplate: showJson(repo, v7, R.schedulerTemplate),
    periods: parsePeriods(roadmapMd),
    residue: { roadmapMd363: (roadmapMd.match(/363 Agent/g) || []).length, roadmapMd40Dept: (roadmapMd.match(/40 departments/g) || []).length },
    attestations: tree.filter((e) => attRe.test(e.path)).map((e) => e.path).sort(cmp),
    dateFieldsFound,
  };
  for (const k of ['graph', 'waves', 'criticalPath', 'lanes', 'packages', 'schedulerTemplate']) {
    const v = roadmap[k];
    if (v) for (const f of S.dateFieldCandidates) if (v[f] !== undefined && v[f] !== null) dateFieldsFound.push(`${R[k]}:${f}`);
  }
  if (roadmap.schedulerTemplate && roadmap.schedulerTemplate.updatedAt) dateFieldsFound.push(`${R.schedulerTemplate}:updatedAt`);

  // ---- coordinator records (queue branch)
  const queue = showJson(repo, qsha, S.coordinator.queue);
  const ledger = showJson(repo, qsha, S.coordinator.ledger);
  const dispatch = {};
  for (const e of lsTree(repo, qsha, S.coordinator.dispatchDir)) if (/\.md$/.test(e.path)) dispatch[e.path] = showText(repo, qsha, e.path);
  const backlog = showJson(repo, v7, S.backlog);
  const lanesJson = showJson(repo, v7, S.lanesJson);
  const protectedPaths = showJson(repo, v7, S.protectedPaths);
  const wave0Raw = JSON.parse(fs.readFileSync(path.join(engineDir, S.wave0Input), 'utf8'));

  // queue history (commit granularity), cached per commit sha
  cache.queueHistory = cache.queueHistory || {};
  const qh = fileHistory(repo, qsha, S.coordinator.queue);
  const missingQ = qh.filter((c) => !cache.queueHistory[c.sha]);
  if (missingQ.length) {
    const qb = readBlobs(repo, missingQ.map((c) => `${c.sha}:${S.coordinator.queue}`));
    for (const c of missingQ) { let tasks = null; try { tasks = compactQueueTasks(JSON.parse(qb.get(`${c.sha}:${S.coordinator.queue}`))); } catch { tasks = null; } cache.queueHistory[c.sha] = { at: c.at, tasks }; }
  }
  const queueHistory = qh.map((c) => ({ sha: c.sha, at: c.at, tasks: cache.queueHistory[c.sha]?.tasks ?? null }));

  // decision first-seen (pickaxe, cached forever per literal+paths)
  cache.pickaxe = cache.pickaxe || {};
  const pk = (ref, literal, paths) => {
    const key = `${ref === qsha ? 'queue' : ref === v7 ? 'v7' : ref}|${literal}|${paths.join(',')}`;
    if (!(key in cache.pickaxe) || cache.pickaxe[key] === null) cache.pickaxe[key] = pickaxeFirst(repo, ref, literal, paths);
    return cache.pickaxe[key];
  };
  const decisionFirstSeen = {};
  for (const d of decisionLiterals(queue, wave0Raw)) decisionFirstSeen[d.id] = d.literal ? pk(qsha, d.literal, d.paths) : null;

  // ---- v7 code facts
  const reachable = revList(repo, v7);
  const commits = logCommits(repo, v7).map((c) => ({ sha: c.sha, at: c.at, subject: c.subject, body: c.body.slice(0, 4000) }));
  cache.lastScannedCommit = v7;
  const routeFiles = tree.filter((e) => e.path.startsWith(`${S.routeSourceDir}/`) && /\.(ts|mjs|js)$/.test(e.path)).map((e) => e.path).sort(cmp);
  const ipcFiles = tree.filter((e) => e.path.startsWith(`${S.ipcFileGlob}/`) && !e.path.slice(S.ipcFileGlob.length + 1).includes('/') && /\.mjs$/.test(e.path)).map((e) => e.path).sort(cmp);
  const codeBlobs = readBlobs(repo, [...routeFiles, ...ipcFiles].map((p) => `${v7}:${p}`));
  const LP = rules['link-patterns'];
  const routeRe = new RegExp(LP.routeRegistrationRegex, 'g'), ipcRe = new RegExp(LP.ipcRegistrationRegex, 'g');
  const routes = [], ipc = [];
  for (const f of routeFiles) for (const m of (codeBlobs.get(`${v7}:${f}`) || '').matchAll(routeRe)) routes.push({ method: m[1].toUpperCase(), path: m[3], quote: m[2], file: f });
  for (const f of ipcFiles) for (const m of (codeBlobs.get(`${v7}:${f}`) || '').matchAll(ipcRe)) ipc.push({ channel: m[2], quote: m[1], file: f });
  const uniqBy = (xs, k) => { const s = new Map(); for (const x of xs) if (!s.has(k(x))) s.set(k(x), x); return [...s.values()]; };
  const routesU = uniqBy(routes, (r) => `${r.method} ${r.path}`).sort((a, b) => cmp(`${a.method} ${a.path}`, `${b.method} ${b.path}`));
  const ipcU = uniqBy(ipc, (r) => r.channel).sort((a, b) => cmp(a.channel, b.channel));
  const literalIntro = {};
  for (const r of routesU) literalIntro[`ROUTE ${r.method} ${r.path}`] = pk(v7, `${r.quote}${r.path}${r.quote}`, [S.routeSourceDir]);
  for (const r of ipcU) literalIntro[`IPC ${r.channel}`] = pk(v7, `${r.quote}${r.channel}${r.quote}`, ipcFiles);

  // resolvers (present at head + introducing commit + test files importing them)
  const AF = rules['agent-factory'];
  const testFiles = tree.filter((e) => e.path.startsWith(`${AF.testDir}/`) && /\.(ts|mjs|js)$/.test(e.path)).map((e) => e.path);
  const tb = readBlobs(repo, testFiles.map((p) => `${v7}:${p}`));
  const resolvers = AF.resolvers.map((r) => {
    const present = tree.some((e) => e.path === r.path);
    const stem = r.path.replace(/\.ts$/, '').split('/').slice(-2).join('/');
    const tests = present ? testFiles.filter((p) => { const t = tb.get(`${v7}:${p}`) || ''; return t.includes(stem) && t.includes(r.symbol); }).sort(cmp) : [];
    const intro = present ? fileHistory(repo, v7, r.path)[0] || null : null;
    return { id: r.id, path: r.path, symbol: r.symbol, present, introducedBy: intro, tests, wave0Package: r.wave0Package ?? null };
  });
  const pathsPresent = {};
  for (const s of rules['mvp-chain'].steps) for (const o of s.openItems || []) if (o.openWhilePathAbsent) pathsPresent[o.openWhilePathAbsent] = tree.some((e) => e.path === o.openWhilePathAbsent);

  // registries (counts only; status fields are claims, not evidence)
  const roleDefs = showJson(repo, v7, S.registries.roleDefinitions);
  const profiles = showJson(repo, v7, S.registries.profiles);
  const adapters = showJson(repo, v7, S.registries.toolAdapters);
  const tallyField = (xs, f) => { const o = {}; for (const x of xs || []) { const k = String(x[f]); o[k] = (o[k] || 0) + 1; } return Object.fromEntries(Object.entries(o).sort((a, b) => cmp(a[0], b[0]))); };
  const registries = {
    roleDefs: { counts: roleDefs?.counts ?? null, guilds: (roleDefs?.guilds || []).length, clusters: (roleDefs?.clusters || []).length, roles: (roleDefs?.roles || []).length },
    profiles: { counts: profiles?.counts ?? null },
    adapters: { count: (adapters?.adapters || []).length, byStatus: tallyField(adapters?.adapters, 'status'), byImplementation: tallyField(adapters?.adapters, 'implementation') },
  };

  // heads recorded by coordinator records -> full sha + date (ancestry is decided in the pure core against `reachable`)
  const heads = headRefsOf(queue);
  const shortMap = resolveCommits(repo, heads);
  const headDates = commitDates(repo, Object.values(shortMap).filter(Boolean));

  // ---- GitHub
  const gh = createGithub({ api: C.githubApi, rateReserve: C.rateReserve, concurrency: C.fetchConcurrency, fetcher, etags: cache.etags || {} });
  let freshness = { state: 'FRESH', asOf: nowIso, error: null };
  const pullsC = cache.pulls || { cursor: null, table: [] };
  const pr = await gh.fetchPullsIncremental(pullsC.table, pullsC.cursor);
  if (!pr.complete) freshness = { state: pr.pulls.length ? 'STALE_CACHE' : 'STALE_CACHE', asOf: cache.pulls?.asOf || null, error: gh.state.errors.slice(-1)[0] || 'PULLS_INCOMPLETE' };
  cache.pulls = { cursor: pr.cursor, table: pr.pulls, asOf: pr.complete ? nowIso : (cache.pulls?.asOf || null) };
  const pulls = pr.pulls;
  const v7Pulls = pulls.filter((p) => p.base === C.integrationBranch);
  const startAnchor = v7Pulls.reduce((m, p) => (!m || p.createdAt < m ? p.createdAt : m), null);
  const runsC = cache.runs || { cursor: null, table: [] };
  const cutoff = runsC.cursor ? new Date(Date.parse(runsC.cursor) - 864e5).toISOString() : startAnchor;
  const ru = await gh.fetchRunsIncremental(runsC.table, cutoff);
  const runs = ru.runs.filter((r) => !startAnchor || r.createdAt >= startAnchor);
  if (!ru.complete && freshness.state === 'FRESH') freshness = { state: 'PARTIAL', asOf: nowIso, error: gh.state.errors.slice(-1)[0] || 'RUNS_INCOMPLETE' };
  cache.runs = { cursor: ru.complete ? runs.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), runsC.cursor || '') : runsC.cursor, table: runs };

  cache.checks = cache.checks || {};
  const checkShas = [...new Set(pulls.filter((p) => (p.mergedAt && p.base === C.integrationBranch) || p.state === 'open').map((p) => p.headSha).filter(Boolean))].sort(cmp);
  const openHeads = new Set(pulls.filter((p) => p.state === 'open').map((p) => p.headSha));
  const needChecks = checkShas.filter((s) => !cache.checks[s] || openHeads.has(s)).slice(0, C.maxCheckCalls);
  await pool(needChecks, C.fetchConcurrency, async (s) => { const c = await gh.fetchChecks(s); if (c) cache.checks[s] = c; });
  const checks = Object.fromEntries(checkShas.filter((s) => cache.checks[s]).map((s) => [s, cache.checks[s]]));

  // run details: timing (24h CI runs) + jobs (7d CI runs), newest first, shared cap; completed runs only (immutable -> cached forever)
  cache.timings = cache.timings || {}; cache.jobs = cache.jobs || {};
  const nowMs = Date.parse(nowIso);
  const ciRuns = runs.filter((r) => r.name === C.ciWorkflowName && r.status === 'completed').sort((a, b) => b.id - a.id);
  const in24 = ciRuns.filter((r) => nowMs - Date.parse(r.createdAt) <= 864e5);
  const in7d = ciRuns.filter((r) => nowMs - Date.parse(r.createdAt) <= 7 * 864e5);
  let budget = C.maxRunDetailCalls;
  const needT = in24.filter((r) => !cache.timings[r.id]).slice(0, budget); budget -= needT.length;
  const needJ = in7d.filter((r) => !cache.jobs[r.id]).slice(0, Math.max(0, budget));
  await pool(needT, C.fetchConcurrency, async (r) => { const t = await gh.fetchRunTiming(r.id); if (t) cache.timings[r.id] = t; });
  await pool(needJ, C.fetchConcurrency, async (r) => { const j = await gh.fetchJobs(r.id); if (j) cache.jobs[r.id] = j; });
  const keepIds = new Set(runs.map((r) => String(r.id)));
  for (const k of Object.keys(cache.timings)) if (!keepIds.has(k)) delete cache.timings[k];
  for (const k of Object.keys(cache.jobs)) if (!keepIds.has(k)) delete cache.jobs[k];
  const timings = Object.fromEntries(in24.filter((r) => cache.timings[r.id]).map((r) => [r.id, cache.timings[r.id]]));
  const jobs = Object.fromEntries(in7d.filter((r) => cache.jobs[r.id]).map((r) => [r.id, cache.jobs[r.id]]));
  const runDetail = { timing24hCandidates: in24.length, timingFetched: Object.keys(timings).length, jobs7dCandidates: in7d.length, jobsFetched: Object.keys(jobs).length };

  cache.prFiles = cache.prFiles || {};
  const openPrs = pulls.filter((p) => p.state === 'open');
  await pool(openPrs.filter((p) => !cache.prFiles[`${p.number}@${p.headSha}`]), C.fetchConcurrency, async (p) => { const f = await gh.fetchPrFiles(p.number); if (f) cache.prFiles[`${p.number}@${p.headSha}`] = f; });
  const prFiles = Object.fromEntries(openPrs.filter((p) => cache.prFiles[`${p.number}@${p.headSha}`]).map((p) => [p.number, cache.prFiles[`${p.number}@${p.headSha}`]]));
  for (const k of Object.keys(cache.prFiles)) { const [n, s] = k.split('@'); if (!openPrs.some((p) => String(p.number) === n && p.headSha === s)) delete cache.prFiles[k]; }

  cache.mergedBy = cache.mergedBy || {};
  const needMB = pulls.filter((p) => p.mergedAt && cache.mergedBy[p.number] === undefined).sort((a, b) => cmp(b.mergedAt, a.mergedAt)).slice(0, C.maxMergedByCalls);
  await pool(needMB, C.fetchConcurrency, async (p) => { const m = await gh.fetchMergedBy(p.number); if (m !== undefined) cache.mergedBy[p.number] = m; });
  const mergedBy = Object.fromEntries(pulls.filter((p) => cache.mergedBy[p.number] !== undefined).map((p) => [p.number, cache.mergedBy[p.number]]));

  if (gh.state.partial && freshness.state === 'FRESH') freshness = { state: 'PARTIAL', asOf: nowIso, error: 'RATE_RESERVE' };
  if (gh.state.errors.length && freshness.state === 'FRESH' && !pr.complete) freshness = { state: 'STALE_CACHE', asOf: cache.pulls.asOf, error: gh.state.errors.slice(-1)[0] };
  cache.etags = gh.state.etags;

  // ---- readiness (C-RDY-1), cached per (tree ids, TRT date)
  const tsx = findTsx(tsxOpt, process.env.INTEL_TSX, C.tsxCandidates);
  const rk = readinessKey(repo, v7, S.readinessArchivePaths) + `|${trtDate(nowIso, C.tz)}`;
  let readiness;
  if (cache.readiness && cache.readiness.key === rk && cache.readiness.result?.state === 'MEASURED') readiness = cache.readiness.result;
  else { readiness = runReadiness({ repo, v7sha: v7, tsx, nowIso, archivePaths: S.readinessArchivePaths, module: AF.readinessModule, workDir }); if (readiness.state === 'MEASURED') cache.readiness = { key: rk, result: readiness }; }

  // ---- target scan + source lines for target verification
  const refOf = (r) => (r === 'v7' ? v7 : r === 'queue' ? qsha : r === 'reports' ? refs.reports.sha : r);
  const texts = {};
  for (const f of S.targetScanFiles) { const t = showText(repo, refOf(f.ref), f.path); if (t !== null) texts[`${f.ref}:${f.path}`] = t; }
  for (const t of [...rules.targets.targets.flatMap((x) => x.quantiles.map((q) => q.source)), ...rules.targets.flags.map((f) => f.check)]) {
    const k = `${t.ref}:${t.path}`; if (!(k in texts)) { const s = showText(repo, refOf(t.ref), t.path); if (s !== null) texts[k] = s; }
  }
  const pinnedCommits = {};
  for (const p of S.datesSourceSet.pinned) { const r = gitTry(repo, ['log', '-1', '--format=%H %cI', p.ref]); if (r.ok) { const [sha, at] = r.out.trim().split(' '); pinnedCommits[p.ref] = { sha, at: new Date(at).toISOString() }; } }

  const github = { pulls, runs, checks, timings, jobs, runDetail, prFiles, mergedBy, freshness, calls: gh.state.calls, notModified: gh.state.notModified, rateRemaining: gh.state.rateRemaining, startAnchor, errors: gh.state.errors.slice(0, 20) };
  log(`gather: pulls=${pulls.length} runs=${runs.length} checks=${Object.keys(checks).length} calls=${gh.state.calls} (304=${gh.state.notModified}) readiness=${readiness.state}`);

  const inputs = {
    schema: 'intel-inputs-1',
    meta: { refs, inventoryBlob: S.inventory.jsonBlob, csvBlob: S.inventory.csvBlob, inventoryBlobAtHead: invAtHead, cacheFrom: cacheFrom || 'cold' },
    inventory: { json: JSON.parse(invText), csvText },
    dependencyMap, roadmap,
    coordinator: { queue, ledger, dispatch, queueHistory, decisionFirstSeen },
    backlog, lanesJson, protectedPaths, wave0: wave0Raw, registries, resolvers, pathsPresent,
    v7: { reachable, commits, routes: routesU, ipc: ipcU, literalIntro, shortMap, headDates },
    github, readiness, texts, pinnedCommits,
    prior: priorSnapshots || [],
  };
  return { inputs, cache };
}

export function inputsFingerprint(inputs, meta) {
  const g = inputs.github;
  return sha256(JSON.stringify({
    v7: inputs.meta.refs.v7.sha, queue: inputs.meta.refs.queue.sha, inventoryBlob: inputs.meta.inventoryBlob, csvBlob: inputs.meta.csvBlob,
    rules: meta.rulesBlobIds, overlay: meta.overlayBlobId, wave0: meta.wave0BlobId, engineTree: meta.engineTree,
    pulls: digestOf(g.pulls.map((p) => [p.number, p.state, p.draft, p.headSha, p.mergedAt])),
    runs: digestOf(g.runs.map((r) => [r.id, r.status, r.conclusion, r.runAttempt])),
    readiness: inputs.readiness?.audit?.digest ?? inputs.readiness?.state ?? null,
  }));
}
