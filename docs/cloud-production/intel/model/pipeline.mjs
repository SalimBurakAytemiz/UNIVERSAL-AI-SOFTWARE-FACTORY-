//TR: Saf orkestrasyon: girdi paketi + kurallar + overlay + saat -> kanonik model, metrikler, uzlaştırma, ajan fabrikası, verimlilik, hedefler, kararlar, plan, geçmiş ve veri kalitesi. G/Ç yoktur; aynı girdi ve aynı saat aynı nesneyi üretir.
import { cmp, natCmp, tally, uniqSorted, sortKeys } from '../core/canonical-json.mjs';
import { trtDate, hoursBetween, round1, pct, toMs } from '../core/time.mjs';
import { loadBaseline, legacyView, baselineClass, BASELINE_CLASSES } from './baseline.mjs';
import { loadRoadmap } from './roadmap.mjs';
import { loadCoordinator } from './coordinator.mjs';
import { buildIdentity } from './identity.mjs';
import { buildLinks } from './links.mjs';
import { deriveItem, RECON_CLASSES } from './status.mjs';
import { scopeOf } from './scope.mjs';
import { compileRules, classify, workspaceIndex } from './departments.mjs';
import { loadTargets, scanCandidates } from './targets.mjs';
import { buildDecisions } from './decisions.mjs';
import { STATUSES, block, ratios3, roadmapMetrics, evalMvpChain, etaFrom, oct31View, resolveWeights } from '../metrics/metrics.mjs';
import { computeProductivity } from '../metrics/productivity.mjs';
import { computeAgentFactory } from '../metrics/agent-factory.mjs';
import { diffSnapshots, trend } from '../metrics/history.mjs';

export function validateOverlay(raw, refs) {
  const accepted = [], rejected = [];
  const ACTIONS = ['LINK', 'UNLINK', 'SCOPE', 'DEPARTMENT', 'OBSOLETE', 'ALIAS', 'ACCEPTANCE', 'DECISION_STATE'];
  for (const e of raw?.entries || []) {
    const why = [];
    if (!e || typeof e !== 'object') { rejected.push({ entry: e, reasons: ['NOT_AN_OBJECT'] }); continue; }
    if (!ACTIONS.includes(e.action)) why.push('UNKNOWN_ACTION');
    for (const f of ['itemId', 'reason', 'by', 'at']) if (!e[f] || typeof e[f] !== 'string') why.push(`MISSING_${f.toUpperCase()}`);
    if (e.action === 'ACCEPTANCE') {
      const r = refs[e.evidenceRef];
      if (!e.evidenceRef) why.push('ACCEPTANCE_WITHOUT_EVIDENCE_REF');
      else if (!r || !r.exists) why.push('EVIDENCE_REF_UNRESOLVED');
      else if (r.fake) why.push('EVIDENCE_REF_IS_FAKE_EXECUTOR_ARTIFACT');
    }
    if (why.length) rejected.push({ entry: e, reasons: why }); else accepted.push(e);
  }
  return { accepted, rejected };
}

const normExecutor = (raw, map) => { if (!raw) return null; for (const m of map) if (new RegExp(m.re, 'i').test(raw)) return m.value; return 'UNKNOWN'; };
const laneOfBranch = (ref, rules) => { for (const r of rules) if (new RegExp(r.re).test(ref || '')) return r.lane; return null; };
const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => (o[k] === undefined || o[k] === null || o[k] === '' ? '—' : String(o[k])));

export function buildAll(inputs, rules, overlayRaw, meta, nowIsoRaw) {
  const nowIso = new Date(nowIsoRaw).toISOString();
  const C = rules.config, SM = rules['status-map'], LP = rules['link-patterns'];
  const dq = [];
  const overlay = validateOverlay(overlayRaw, inputs.overlayRefs || {});
  const pulls = new Map(inputs.github.pulls.map((p) => [p.number, p]));
  const reachable = new Set(inputs.v7.reachable);
  const baselineRows = loadBaseline(inputs.inventory.csvText, inputs.inventory.json);
  const csvMissing = baselineRows.filter((r) => !r.inCsv).length;
  if (csvMissing) dq.push({ code: 'INVENTORY_CSV_ROWS_MISSING', detail: `${csvMissing} JSON items absent from the CSV` });
  const roadmap = loadRoadmap(inputs.roadmap, rules.sources);
  const coordinator = loadCoordinator({ queue: inputs.coordinator.queue, ledger: inputs.coordinator.ledger, dispatch: inputs.coordinator.dispatch, wave0: inputs.wave0, backlog: inputs.backlog, lanesJson: inputs.lanesJson, queueHistory: inputs.coordinator.queueHistory });
  const identity = buildIdentity({ baseline: baselineRows, roadmap, coordinator, dependencyMap: inputs.dependencyMap, overlay });
  const { shortMap, headDates } = inputs.v7;
  for (const it of identity.items) for (const r of it.records) { r.headFull = r.head ? shortMap[r.head] ?? null : null; r.headAt = r.headFull ? headDates[r.headFull] ?? null : null; }
  const supportTexts = [['queue:PRODUCTION-QUEUE.json', coordinator.queueText], ['ledger:COORD-LEDGER.json', coordinator.ledgerText], ...Object.entries(coordinator.dispatchTexts).sort((a, b) => cmp(a[0], b[0])).map(([k, v]) => [`dispatch:${k}`, v])];
  const links = buildLinks(identity.items, { pulls, commits: inputs.v7.commits, routes: inputs.v7.routes, ipc: inputs.v7.ipc, literalIntro: inputs.v7.literalIntro, reachable, shortMap, headDates,
    resolver: identity.resolver, ledgerReviews: coordinator.ledgerReviews, supportTexts, overlayLinks: overlay.accepted.filter((o) => o.action === 'LINK'), linkPatterns: LP, v7sha: inputs.meta.refs.v7.sha });
  const unlinks = new Set(overlay.accepted.filter((o) => o.action === 'UNLINK').map((o) => `${o.itemId}|${o.value}`));
  const linksByItem = new Map();
  for (const l of links) { if (unlinks.has(`${l.itemId}|${l.ref}`)) continue; if (!linksByItem.has(l.itemId)) linksByItem.set(l.itemId, []); linksByItem.get(l.itemId).push(l); }
  const decisions = buildDecisions({ coordinator, resolver: identity.resolver, pulls, firstSeen: inputs.coordinator.decisionFirstSeen, nowIso, overlayState: new Map(overlay.accepted.filter((o) => o.action === 'DECISION_STATE').map((o) => [o.itemId, o])), staleHours: C.staleInProgressHours });
  const decisionsByItem = new Map();
  for (const d of decisions) for (const id of d.blocksItems) { if (!decisionsByItem.has(id)) decisionsByItem.set(id, []); decisionsByItem.get(id).push(d); }
  const acceptance = new Map(overlay.accepted.filter((o) => o.action === 'ACCEPTANCE').map((o) => [o.itemId, o]));
  const runsBySha = new Map();
  for (const r of inputs.github.runs.filter((r) => r.name === C.ciWorkflowName && r.event === 'push' && r.headBranch === C.integrationBranch).sort((a, b) => a.id - b.id)) { if (!runsBySha.has(r.headSha)) runsBySha.set(r.headSha, []); runsBySha.get(r.headSha).push(r); }
  const dispatchedWave0 = new Set(Object.keys(coordinator.dispatchTexts).map((p) => (/dispatch\/([^/]+)\.md$/.exec(p) || [])[1]).filter(Boolean));
  const ctx = { pulls, reachable, checks: inputs.github.checks, runsBySha, statusMap: SM, decisionsByItem, nowIso, staleHours: C.staleInProgressHours, acceptance, requiredChecks: C.requiredChecks, dispatchedWave0 };

  // ---- per item
  const compiled = compileRules(rules.departments);
  const ws = workspaceIndex(baselineRows);
  const phaseById = new Map(roadmap.phases.map((p) => [p.phase, p]));
  const deptCtx = { ...ws, domainOf: (it) => (it.roadmapPhase !== null && phaseById.get(it.roadmapPhase)?.domain) || String(it.baseline?.area || '').split(' / ')[0] };
  const overlayScope = new Map(overlay.accepted.filter((o) => o.action === 'SCOPE').map((o) => [o.itemId, o]));
  const overlayDept = new Map(overlay.accepted.filter((o) => o.action === 'DEPARTMENT').map((o) => [o.itemId, o]));
  const deptDefaultLane = new Map(rules.departments.departments.map((d) => [d.id, d.defaultLane]));
  const ibOwner = new Map(coordinator.integrationBoard.prs.filter((p) => p.pr).map((p) => [p.pr, p.owner]));
  const T = rules['next-actions'].templates;
  const items = identity.items.map((it) => {
    const ls = linksByItem.get(it.id) || [];
    const d = deriveItem(it, ls, ctx);
    const { scope, scopeRule } = scopeOf(it, rules.scope, overlayScope);
    const { department, ruleId } = classify(it, compiled, deptCtx, overlayDept);
    const ph = it.roadmapPhase !== null ? phaseById.get(it.roadmapPhase) : null;
    const strongPrs = d.linkedPrs.map((n) => pulls.get(n)).filter(Boolean);
    const lanePr = [...strongPrs].sort((a, b) => cmp(b.mergedAt || b.createdAt, a.mergedAt || a.createdAt) || b.number - a.number).find((p) => laneOfBranch(p.headRef, LP.laneBranchRules));
    const lane = lanePr ? laneOfBranch(lanePr.headRef, LP.laneBranchRules) : (deptDefaultLane.get(department) ?? null);
    const qOwner = it.records.find((r) => r.kind === 'QUEUE_TASK' && r.owner)?.owner, bOwner = it.records.find((r) => r.kind === 'BACKLOG' && r.owner)?.owner;
    const ibo = strongPrs.map((p) => ibOwner.get(p.number)).find(Boolean);
    const owner = qOwner || bOwner || it.owner || ibo || null;
    const execRaw = it.executorRaw || qOwner || null;
    const commitDates = ls.filter((l) => l.kind === 'COMMIT' && l.at && d.substeps.coded === 'TRUE' && (l.strength === 'EXPLICIT' || d.commitEvidence)).map((l) => l.at);
    const prCreated = strongPrs.map((p) => p.createdAt);
    const integratedMerged = d.integratedPrs.map((n) => pulls.get(n).mergedAt);
    const start = [...prCreated, ...commitDates].sort(cmp)[0] || null;
    const lastMergedAt = integratedMerged.sort(cmp).slice(-1)[0] || null;
    const firstPrCreated = prCreated.sort(cmp)[0] || null;
    const openDec = (decisionsByItem.get(it.id) || []).filter((x) => x.state === 'OPEN');
    const ciRuns = uniqSorted(d.integratedPrs.flatMap((n) => inputs.github.runs.filter((r) => r.name === C.ciWorkflowName && r.headSha === pulls.get(n).headSha).map((r) => r.id)));
    const nextAction = fill(T[d.status] || T.UNKNOWN, { id: it.id, prs: d.linkedPrs.map((n) => `#${n}`).join(','), decision: openDec[0]?.id || d.blockers[0] || 'kayıt', blockers: d.blockers.join(', '), lane, missing: (d.missingEvidence[0] || '').slice(0, 120) });
    return {
      id: it.id, title: it.title, description: it.description, dimension: it.dimension, origin: it.origin, department, departmentRule: ruleId,
      roadmapPhase: it.roadmapPhase, relatedPhases: it.relatedPhases, wave: ph ? ph.wave : null, period: ph ? ph.period : null,
      milestone: scope === 'MVP' ? rules.scope.milestones.MVP : it.origin === 'WAVE0' ? rules.scope.milestones.WAVE0 : null, scope, scopeRule,
      owner, lane, executor: normExecutor(execRaw, SM.executorMap), dependsOn: it.dependsOn,
      planned: { start: null, end: null, sourcesChecked: rules.sources.datesSourceSet.id },
      actual: { start, lastMergedAt, done: d.substeps.accepted === 'TRUE' ? (acceptance.get(it.id)?.at ?? null) : null },
      status: d.status, statusRule: d.rule, reconClass: d.reconClass, baselineClass: d.baselineClass, evidenceClass: d.evidenceClass, matchKind: d.matchKind,
      substeps: d.substeps, evidence: d.evidence, links: ls.map((l) => l.id).sort(cmp), blockers: d.blockers, founderDecision: openDec[0]?.id ?? null, nextAction,
      sizeEstimate: it.effort ? `${it.effort} (analyst estimate, 19-Oct)` : null,
      measuredDurationHours: firstPrCreated && lastMergedAt ? round1(hoursBetween(firstPrCreated, lastMergedAt)) : null, cost: null,
      confidence: d.confidence, stale: d.stale, missingEvidence: d.missingEvidence, aliases: it.aliases,
      priority: it.priority, oct31: it.oct31, prs: d.linkedPrs, integratedPrs: d.integratedPrs, openPrs: d.openPrs, mergeCommits: d.mergeCommits, mergedAt: d.mergedAt,
      commits: uniqSorted(ls.filter((l) => l.kind === 'COMMIT' && /^[0-9a-f]{40}$/.test(l.ref)).map((l) => l.ref.slice(0, 7))), ciRuns,
      status19: it.baseline ? it.baseline.status19 : null, area: it.baseline ? it.baseline.area : null, removedByOverlay: !!it.removed, excluded19: it.excluded,
      commitEvidence: d.commitEvidence, candidateLinks: d.candidateLinks, supportingRefs: d.supportingRefs, records: it.records.map((r) => `${r.kind}:${r.ref}:${r.status ?? 'none'}:${r.relation}`).sort(cmp),
    };
  });
  const byId = new Map(items.map((x) => [x.id, x]));
  const live = items.filter((x) => x.status !== 'OBSOLETE');
  for (const x of live) { x.openDependsOn = x.dependsOn.filter((d) => byId.get(d)?.status !== 'COMPLETED_AND_VERIFIED').length; x.devOpenDependsOn = x.dependsOn.filter((d) => byId.get(d)?.substeps.integrated !== 'TRUE').length; }
  const base = live.filter((x) => x.origin === 'BASELINE_2026_10_19');
  const mvp = live.filter((x) => x.scope === 'MVP');
  const baseMvp = base.filter((x) => x.scope === 'MVP');

  // ---- weights + blocks
  const weights = resolveWeights(roadmap.criticalPath.weightModel, rules.weights);
  if (weights.dq) dq.push(weights.dq);
  const full = block(live, weights), fullBase = block(base, weights), mvpB = block(mvp, weights), mvpBase = block(baseMvp, weights);
  const deps = rules.departments.departments.map((d) => d.id);
  const byDepartment = deps.map((dep) => {
    const xs = live.filter((x) => x.department === dep), xm = xs.filter((x) => x.scope === 'MVP'), xb = xs.filter((x) => x.origin === 'BASELINE_2026_10_19');
    const openPrs = uniqSorted(xs.flatMap((x) => x.openPrs));
    const next = xs.filter((x) => !['MERGED_NOT_VERIFIED', 'COMPLETED_AND_VERIFIED'].includes(x.status)).sort((a, b) => (a.scope === 'MVP' ? 0 : 1) - (b.scope === 'MVP' ? 0 : 1) || natCmp(a.priority || 'P9', b.priority || 'P9') || cmp(a.id, b.id))[0];
    return { department: dep, label: rules.departments.departments.find((d) => d.id === dep).label, full: block(xs, weights), baseline741: block(xb, weights), mvp: block(xm, weights), openPrs, blockers: xs.filter((x) => x.blockers.length).length, nextItem: next ? next.id : null,
      topUnmatched: dep === 'UNASSIGNED' ? Object.entries(tally(xs, (x) => (x.origin === 'BASELINE_2026_10_19' ? `${x.dimension}:${String(x.area || '').split(' / ')[0] || 'none'}` : `added:${x.origin}`))).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 8).map(([k, v]) => ({ key: k, n: v })) : undefined };
  });
  // invariant: department sums == totals
  const sumCheck = (sel, total) => { const bad = []; for (const s of STATUSES) { const sum = byDepartment.reduce((a, d) => a + d[sel].statusCounts[s], 0); if (sum !== total.statusCounts[s]) bad.push(`${sel}.${s}:${sum}!=${total.statusCounts[s]}`); } const n = byDepartment.reduce((a, d) => a + d[sel].n, 0); if (n !== total.n) bad.push(`${sel}.n:${n}!=${total.n}`); for (const k of ['coded', 'integrated', 'tested', 'accepted']) { const sum = byDepartment.reduce((a, d) => a + d[sel].substeps[k].TRUE, 0); if (sum !== total.substeps[k].TRUE) bad.push(`${sel}.${k}:${sum}`); } return bad; };
  const deptInvariant = [...sumCheck('full', full), ...sumCheck('mvp', mvpB), ...sumCheck('baseline741', fullBase)];
  // lanes table (PR branch prefix)
  const laneRows = ['A', 'B', 'C', 'COORD', null].map((L) => { const xs = live.filter((x) => x.lane === L); return { lane: L ?? 'NONE', items: xs.length, statusCounts: tally(xs, (x) => x.status, STATUSES) }; });

  // ---- reconciliation
  const legacy = legacyView(baselineRows, pulls);
  const legacyById = new Map(legacy.rows.map((r) => [r.id, r]));
  const v0Unrec = new Set(legacy.rows.filter((r) => !['DUPLICATE', 'OBSOLETE'].includes(r.now) && (r.now === 'UNKNOWN' || r.flags.includes('STALE_SINCE_2026-10-19'))).map((r) => r.id));
  const v0Mnv = new Set(legacy.rows.filter((r) => r.now === 'MERGED_NOT_VERIFIED').map((r) => r.id));
  const bcls = BASELINE_CLASSES.filter((c) => !c.startsWith('EXCLUDED'));
  const v0StatusOf = (c) => ({ PR_MERGED_ALL: 'MERGED_NOT_VERIFIED', PR_MERGED_PARTIAL: 'MERGED_NOT_VERIFIED', STALE_STATUS_SAYS_MERGED: 'MERGED_NOT_VERIFIED', PR_CLOSED_UNMERGED_ONLY: 'UNKNOWN', PR_OPEN: 'IMPLEMENTED_NOT_MERGED', STALE_FOUNDER: 'FOUNDER_ACTION_REQUIRED', STALE_NOT_STARTED: 'NOT_STARTED', STALE_IN_PROGRESS: 'IN_PROGRESS', STALE_IMPLEMENTED_NOT_TESTED: 'IMPLEMENTED_NOT_MERGED', STALE_BLOCKED: 'BLOCKED', STALE_PENDING: 'UNKNOWN', STALE_OTHER: 'UNKNOWN' })[c];
  const baselinePartition = bcls.map((c) => ({ baselineClass: c, v0Status: v0StatusOf(c), full: base.filter((x) => x.baselineClass === c).length, mvp: baseMvp.filter((x) => x.baselineClass === c).length, deferrable: base.filter((x) => x.baselineClass === c && x.scope !== 'MVP').length }));
  const rcls = RECON_CLASSES.filter((c) => !c.startsWith('EXCLUDED') && !c.startsWith('ADDED'));
  const currentPartition = rcls.map((c) => ({ reconClass: c, full: base.filter((x) => x.reconClass === c).length, mvp: baseMvp.filter((x) => x.reconClass === c).length }));
  const matrix = (xs) => Object.fromEntries(bcls.map((b) => [b, Object.fromEntries(rcls.map((r) => [r, xs.filter((x) => x.baselineClass === b && x.reconClass === r).length]).filter(([, n]) => n))]).filter(([, o]) => Object.keys(o).length));
  const r323 = base.filter((x) => v0Mnv.has(x.id)).map((x) => ({ id: x.id, dimension: x.dimension, scope: x.scope, baselineClass: x.baselineClass, evidenceClass: x.evidenceClass, reconClass: x.reconClass, status: x.status,
    prs: x.integratedPrs.length ? x.integratedPrs : x.prs, mergeCommits: x.mergeCommits, mergedAt: x.mergedAt, commitEvidence: x.commitEvidence, missingEvidence: x.evidenceClass === 'STATUS_ONLY_UNVERIFIED' ? x.missingEvidence : [] }));
  const ov = (set) => ({ full: base.filter((x) => set(x)).length, mvp: baseMvp.filter((x) => set(x)).length });
  const overlap = { both: ov((x) => v0Mnv.has(x.id) && v0Unrec.has(x.id)), a323only: ov((x) => v0Mnv.has(x.id) && !v0Unrec.has(x.id)), a536only: ov((x) => !v0Mnv.has(x.id) && v0Unrec.has(x.id)), neither: ov((x) => !v0Mnv.has(x.id) && !v0Unrec.has(x.id)) };
  const statusEvents = base.filter((x) => legacyById.get(x.id) && legacyById.get(x.id).now !== x.status).map((x) => ({ id: x.id, v0: legacyById.get(x.id).now, now: x.status, reconClass: x.reconClass })).sort((a, b) => cmp(a.id, b.id));
  const added = live.filter((x) => x.origin !== 'BASELINE_2026_10_19');
  const removed = items.filter((x) => x.removedByOverlay);
  const reconciliation = {
    anchor: { id: 'BL-2026-10-26', generatedAt: '2026-10-26T20:05:49Z', baseSha: '8c45845', queueSha: '33baea5', inventoryBlob: rules.sources.inventory.jsonBlob, rule: legacy.rule },
    live741: base.length, mvp354: baseMvp.length, deferrable387: base.filter((x) => x.scope !== 'MVP').length, unreconciledV0: v0Unrec.size, mergedNotVerifiedV0: v0Mnv.size,
    excluded: items.filter((x) => x.excluded19).length, excludedByStatus: tally(items.filter((x) => x.excluded19), (x) => x.excluded19),
    baselinePartition, currentPartition, transitionMatrix: { full: matrix(base), mvp: matrix(baseMvp) }, r323, overlap,
    liveNow: { baseline: base.length, removed: removed.length, added: added.length, value: base.length - removed.length + added.length, addedByOrigin: tally(added, (x) => x.origin), removedIds: removed.map((x) => x.id) },
    addedItems: added.map((x) => ({ id: x.id, origin: x.origin, title: String(x.title || '').slice(0, 100), reason: identity.idEvents.find((e) => e.event === 'ADDED' && e.itemId === x.id)?.reason ?? null, status: x.status })),
    idEvents: identity.idEvents, statusEvents,
  };

  // ---- roadmap, chain, oct31, ETA
  const rm = roadmapMetrics(roadmap, byId, live.concat(items.filter((x) => x.id.startsWith('PH-') && x.status === 'OBSOLETE')));
  const accKeys = new Set(overlay.accepted.filter((o) => o.action === 'ACCEPTANCE' && o.value).map((o) => o.value));
  const chain = evalMvpChain(rules['mvp-chain'].steps, { pulls, runs: inputs.github.runs, pathsPresent: inputs.pathsPresent, decisions, acceptedKeys: accKeys, acceptedItems: full.statusCounts.COMPLETED_AND_VERIFIED });
  const v7Pulls = inputs.github.pulls.filter((p) => p.base === C.integrationBranch);
  const merged7d = v7Pulls.filter((p) => p.mergedAt && toMs(nowIso) - toMs(p.mergedAt) <= 7 * 864e5).length;
  const oct31 = oct31View(mvp, mvpB, chain, decisions, coordinator.capacity, round1(merged7d / 7), { DEFERRED: base.filter((x) => x.scope === 'DEFERRED').length, FULL: base.filter((x) => x.scope === 'FULL').length, total: base.filter((x) => x.scope !== 'MVP').length });
  const today = trtDate(nowIso, C.tz);
  const merged24 = v7Pulls.filter((p) => p.mergedAt && toMs(nowIso) - toMs(p.mergedAt) <= 864e5).length;
  const trendPoint = { date: today, generatedAt: nowIso, semantics: 'intel-1', liveNow: full.n, mvpN: mvpB.n, fullIntegrated: full.substeps.integrated.TRUE, mvpIntegrated: mvpB.substeps.integrated.TRUE, fullAccepted: full.substeps.accepted.TRUE, mvpAccepted: mvpB.substeps.accepted.TRUE, unreconciled: fullBase.unreconciled, unknown: full.statusCounts.UNKNOWN, mergesPerDay: merged24 };
  const priorPoints = (inputs.prior || []).map((p) => p.trendPoint).filter(Boolean);
  const points = [...priorPoints.filter((p) => p.date !== today), trendPoint];
  const eta = {
    mvpAcceptance: etaFrom(points, 'mvpAccepted', mvpB.n - mvpB.substeps.accepted.TRUE, nowIso, C.trendMinSnapshots, C.trendMinSpanDays, 'MVP accepted completion'),
    mvpIntegrationOnly: etaFrom(points, 'mvpIntegrated', mvpB.n - mvpB.substeps.integrated.TRUE, nowIso, C.trendMinSnapshots, C.trendMinSpanDays, 'code integration only, not completion'),
  };
  const targetsOut = loadTargets(rules.targets, inputs.texts, nowIso, accKeys, C.tz);
  dq.push(...targetsOut.dq);
  const reviewed = new Set(rules.targets.reviewedCandidates || []);
  const candidates = scanCandidates(Object.fromEntries(Object.entries(inputs.texts).filter(([k]) => rules.sources.targetScanFiles.some((f) => `${f.ref}:${f.path}` === k))), rules.sources.targetKeywordRegex).map((c) => ({ ...c, reviewed: reviewed.has(c.id) }));

  // ---- agent factory, productivity
  const agentFactory = computeAgentFactory({ registries: inputs.registries, readiness: inputs.readiness, wave0: inputs.wave0, rules: rules['agent-factory'], resolvers: inputs.resolvers, itemsById: byId });
  const productivity = computeProductivity({ pulls, runs: inputs.github.runs, timings: inputs.github.timings, jobs: inputs.github.jobs, runDetail: inputs.github.runDetail, queueHistory: coordinator.queueHistory, decisions, integrationBoard: coordinator.integrationBoard, nowIso, startIso: inputs.github.startAnchor, secondAnchor: coordinator.productionLanesStartedAt, config: C, statusMap: SM });

  // ---- plan (section H)
  const cpSet = new Set(roadmap.criticalPath.phaseIds);
  const prIdx = (p) => { const i = rules['next-actions'].priorityOrder.indexOf(p); return i < 0 ? 9 : i; };
  const planKey = (a, b) => (cpSet.has(a.roadmapPhase) ? 0 : 1) - (cpSet.has(b.roadmapPhase) ? 0 : 1) || (a.scope === 'MVP' ? 0 : 1) - (b.scope === 'MVP' ? 0 : 1) || prIdx(a.priority) - prIdx(b.priority) || (a.blockers.length ? 1 : 0) - (b.blockers.length ? 1 : 0) || cmp(a.id, b.id);
  const actionable = ['IMPLEMENTED_NOT_MERGED', 'IN_PROGRESS', 'QUEUED', 'NOT_STARTED', 'UNKNOWN', 'BLOCKED'];
  const plan = {
    order: rules['next-actions'].order, builderCap: coordinator.capacity, topNPerLane: C.planTopNPerLane,
    lanes: rules['next-actions'].lanes.map((L) => ({ lane: L, items: live.filter((x) => x.lane === L && actionable.includes(x.status)).sort(planKey).slice(0, C.planTopNPerLane).map((x) => ({ id: x.id, status: x.status, scope: x.scope, priority: x.priority, criticalPath: cpSet.has(x.roadmapPhase), blockers: x.blockers.length, action: x.nextAction })) })),
    verification: mvp.filter((x) => x.status === 'MERGED_NOT_VERIFIED').sort(planKey).slice(0, rules['next-actions'].verificationLane.topN).map((x) => ({ id: x.id, action: fill(rules['next-actions'].verificationLane.template, { id: x.id, prs: x.integratedPrs.map((n) => `#${n}`).join(',') }) })),
    verificationTotal: mvp.filter((x) => x.status === 'MERGED_NOT_VERIFIED').length,
    founderDecisions: decisions.filter((d) => d.state === 'OPEN').sort((a, b) => (b.ageHours ?? -1) - (a.ageHours ?? -1) || natCmp(a.id, b.id)).map((d) => ({ id: d.id, ageHours: d.ageHours, action: fill(rules['next-actions'].decisionTemplate, { id: d.id, ageHours: d.ageHours ?? 'UNKNOWN', text: d.text.slice(0, 140) }) })),
  };

  // ---- history
  const curCompact = { items: items.map((x) => ({ id: x.id, status: x.status, reconClass: x.reconClass, scope: x.scope, department: x.department, substeps: x.substeps, links: x.links })), metrics: compactMetrics(fullBase, full, mvpB) };
  const prevs = (inputs.prior || []).filter((p) => p.date < today).sort((a, b) => cmp(a.date, b.date) || cmp(a.generatedAt, b.generatedAt));
  const prev = prevs[prevs.length - 1] || null;
  let prevCompact = null;
  if (prev) prevCompact = prev.items ? { items: prev.items, metrics: prev.metrics } : { items: legacy.rows.filter((r) => !['DUPLICATE', 'OBSOLETE'].includes(r.now) || true).map((r) => ({ id: r.id, status: r.now === 'DUPLICATE' ? 'OBSOLETE' : r.now })), metrics: prev.metrics };
  const diff = prev ? diffSnapshots(prevCompact, { items: curCompact.items.map((x) => (prev.items ? x : { id: x.id, status: x.status })), metrics: curCompact.metrics }) : null;
  const history = { previous: prev ? { source: prev.source, date: prev.date, generatedAt: prev.generatedAt, semantics: prev.trendPoint?.semantics ?? null, itemsReconstructed: !prev.items } : null, diff, trend: trend(points, today, C.historyDays) };

  // ---- data quality
  const strongPrSet = new Set(live.flatMap((x) => x.prs));
  const unattributedPrs = v7Pulls.filter((p) => p.mergedAt && !strongPrSet.has(p.number)).map((p) => p.number).sort((a, b) => a - b);
  const contradictions = [];
  for (const t of coordinator.queueTasks) { const p = t.pr ? pulls.get(t.pr) : null; if (p && p.mergedAt && !SM.queueFinalStates.includes(t.status)) contradictions.push({ code: 'QUEUE_STATUS_BEHIND_GITHUB', ref: t.id, detail: `queue status ${t.status} but #${p.number} merged ${p.mergedAt}` }); }
  if (coordinator.capacity.queueBuilderCap !== coordinator.capacity.lanesBuilderCap) contradictions.push({ code: 'BUILDER_CAP_MISMATCH', ref: 'builderCap', detail: `PRODUCTION-QUEUE.json builderCap ${coordinator.capacity.queueBuilderCap} vs docs/planning/LANES.json capacity.builderCap ${coordinator.capacity.lanesBuilderCap}` });
  for (const f of coordinator.founderQueue) { const m = /(\d+)-builder cap/.exec(f.text); if (m && Number(m[1]) !== coordinator.capacity.queueBuilderCap) contradictions.push({ code: 'FOUNDER_QUEUE_CAP_TEXT', ref: f.id, detail: `founderQueue text '${m[0]}' vs builderCap ${coordinator.capacity.queueBuilderCap}` }); }
  for (const dl of coordinator.deliverables) { const full40 = dl.head ? shortMap[dl.head] : null; const inV7 = !!(full40 && reachable.has(full40)); const p = dl.pr ? pulls.get(dl.pr) : null; if ((inV7 && (/not integrated|branch only/i.test(`${dl.note} ${dl.prText}`) || (p && !p.mergedAt))) || (p && p.mergedAt && SM.deliverableTestedStates.includes(dl.status))) contradictions.push({ code: 'DELIVERABLE_RECORD_BEHIND_GIT', ref: dl.key, detail: p && p.mergedAt ? `record status ${dl.status} while #${p.number} merged ${p.mergedAt}${inV7 ? ` and head ${dl.head} is an ancestor of v7/integration` : ''}` : `head ${dl.head} is an ancestor of v7/integration while the record says '${(dl.note || dl.prText).slice(0, 60)}'${p && !p.mergedAt ? ` and #${p.number} is ${p.state} unmerged` : ''}` }); }
  const ibCounts = tally(coordinator.integrationBoard.prs.filter((p) => p.pr), (p) => String(p.pr));
  for (const [n, c] of Object.entries(ibCounts)) if (c > 1) contradictions.push({ code: 'INTEGRATION_BOARD_DUPLICATE_PR', ref: `#${n}`, detail: `${c} entries in integrationBoard.prs` });
  for (const f of targetsOut.flags) if (f.check === 'VERIFIED') { const pc = inputs.pinnedCommits?.['9dbb708']; if (pc && pc.at.slice(0, 10) < '2026-10-15') contradictions.push({ code: f.id, ref: '9dbb708', detail: `commit date ${pc.at} precedes the document's 'Prepared: 2026-10-15'` }); }
  for (const x of live) for (const e of x.evidence.filter((e) => e.strength === 'MERGED_OUTSIDE_V7')) contradictions.push({ code: 'PR_MERGED_OUTSIDE_V7', ref: x.id, detail: `${e.ref} merged but its merge commit is not reachable from v7/integration` });
  contradictions.sort((a, b) => cmp(a.code, b.code) || natCmp(a.ref, b.ref));
  const v0Report = (inputs.prior || []).find((p) => p.source && p.legacyHeader);
  const corrections = computeCorrections({ base, legacy, agentFactory, inputs, v0Report, meta: inputs.meta });
  const sectionConfidence = (xs) => { const u = xs.filter((x) => x.status === 'UNKNOWN' || x.stale).length; return !xs.length ? 'LOW' : u / xs.length > 0.5 ? 'LOW' : u > 0 ? 'MEDIUM' : 'HIGH'; };
  const dataQuality = {
    freshness: { v7: { state: 'FRESH', ...inputs.meta.refs.v7 }, queue: { state: 'FRESH', ...inputs.meta.refs.queue }, reports: { state: 'FRESH', ...inputs.meta.refs.reports }, github: { ...inputs.github.freshness, calls: inputs.github.calls, notModified: inputs.github.notModified, rateRemaining: inputs.github.rateRemaining, errors: inputs.github.errors }, readiness: { state: inputs.readiness.state, reason: inputs.readiness.reason ?? null }, cache: inputs.meta.cacheFrom },
    unreconciled536: { v0: v0Unrec.size, byBaselineClass: tally(base.filter((x) => v0Unrec.has(x.id)), (x) => x.baselineClass), nowByStatus: tally(base.filter((x) => v0Unrec.has(x.id)), (x) => x.status, STATUSES) },
    statusOnlyUnverified: base.filter((x) => x.reconClass === 'STATUS_ONLY_UNVERIFIED').length,
    candidateLinks: live.filter((x) => x.candidateLinks.length).map((x) => ({ id: x.id, candidates: x.candidateLinks })),
    unattributedPrs, unattributedPrCount: unattributedPrs.length,
    rejectedOverlay: overlay.rejected,
    unassigned: { full: full.n ? pct(byDepartment.find((d) => d.department === 'UNASSIGNED').full.n, full.n) : 'UNKNOWN', n: byDepartment.find((d) => d.department === 'UNASSIGNED').full.n, top: byDepartment.find((d) => d.department === 'UNASSIGNED').topUnmatched },
    unreviewedTargetCandidates: candidates.filter((c) => !c.reviewed).length,
    contradictions,
    legacyResidue: { roadmapMd363Agent: roadmap.residue.roadmapMd363Agent, roadmapMd40Departments: roadmap.residue.roadmapMd40Departments, legacyPhaseTitles: roadmap.residue.legacyTitles, contractsWithCodexReview: `${roadmap.residue.contractsCodexReview}/${roadmap.phases.length}` },
    corrections,
    sectionConfidence: { A: sectionConfidence(live), B: rm.phases.closedByEvidence ? 'MEDIUM' : sectionConfidence(base.filter((x) => x.id.startsWith('PH-'))), C: sectionConfidence(live), D: sectionConfidence(base), E: agentFactory.state === 'MEASURED' ? 'HIGH' : 'LOW', F: inputs.github.freshness.state === 'FRESH' ? 'HIGH' : 'MEDIUM', G: 'MEDIUM', H: 'MEDIUM', I: points.length >= 3 ? 'MEDIUM' : 'LOW', J: 'HIGH' },
    departmentInvariant: deptInvariant.length ? { ok: false, violations: deptInvariant } : { ok: true },
    dq,
    attachments: ['UASCO_WORK_INVENTORY.json', 'UASCO_WORK_INVENTORY.csv'],
  };
  return { items, links: links.filter((l) => !unlinks.has(`${l.itemId}|${l.ref}`)), live, base, mvp, decisions, coordinator, roadmap, rm, chain, oct31, eta, targets: targetsOut.targets, targetCandidates: candidates, targetFlags: targetsOut.flags,
    agentFactory, productivity, plan, history, dataQuality, reconciliation, trendPoint, legacy, weights,
    metrics: { full, baseline741: fullBase, mvp: mvpB, mvpBaseline: mvpBase, ratios3: ratios3(full, mvpB), ratios3Baseline: ratios3(fullBase, mvpBase), byDepartment, lanes: laneRows, ...rm, weights: { model: weights.model, note: weights.note } },
    pulls, inputs, overlay };
}

export function compactMetrics(fullBase, full, mvp) {
  return { liveBaseline: fullBase.n, liveNow: full.n, mvp: mvp.n, mergedNotVerified: fullBase.statusCounts.MERGED_NOT_VERIFIED, integrated: fullBase.substeps.integrated.TRUE, mvpIntegrated: mvp.substeps.integrated.TRUE,
    unknown: fullBase.statusCounts.UNKNOWN, unreconciled: fullBase.unreconciled, stale: fullBase.stale, accepted: fullBase.substeps.accepted.TRUE, founder: fullBase.statusCounts.FOUNDER_ACTION_REQUIRED, notStarted: fullBase.statusCounts.NOT_STARTED };
}

function computeCorrections({ base, legacy, agentFactory, inputs, v0Report }) {
  const out = [];
  const c1 = base.filter((x) => x.baselineClass === 'STALE_IMPLEMENTED_NOT_TESTED');
  out.push({ id: 'C-1', holds: c1.length > 0 && c1.every((x) => !x.prs.length || x.baselineClass === 'STALE_IMPLEMENTED_NOT_TESTED'), text: `v0 MD labels IMPLEMENTED_NOT_MERGED as 'bağlı PR açık'; the ${c1.length} rows are stale 19-Oct IMPLEMENTED_NOT_TESTED rows with no inventory PR`, ids: c1.map((x) => x.id) });
  const res = agentFactory.resolvers;
  out.push({ id: 'C-2', holds: res.some((r) => r.present), text: `v0 says 'resolvers NOT_IMPLEMENTED'; present: ${res.filter((r) => r.present).map((r) => r.id).join(', ') || 'none'}; absent: ${res.filter((r) => !r.present).map((r) => `${r.id}${r.wave0Package ? ` (${r.wave0Package})` : ''}`).join(', ') || 'none'}` });
  if (v0Report && v0Report.legacyHeader) {
    const h = v0Report.legacyHeader;
    out.push({ id: 'C-3', holds: !!(h.mdStamp && h.jsonStamp && (h.mdStamp !== h.jsonStamp || h.mdBase !== h.jsonBase)), text: `v0 MD is not rendered from the JSON: MD ${h.mdStamp} at ${h.mdBase}/${h.mdQueue}; JSON ${h.jsonStamp} at ${h.jsonBase}/${h.jsonQueue}` });
    out.push({ id: 'C-4', holds: !!(h.jsonQueue && !inputs.meta.refs.queue.sha.startsWith(h.jsonQueue)), text: `v0 inputs.queueSha ${h.jsonQueue} vs current queue tip ${inputs.meta.refs.queue.sha.slice(0, 7)}` });
  } else { out.push({ id: 'C-3', holds: 'UNKNOWN', text: 'v0 MD/JSON pair not available in the archive' }); out.push({ id: 'C-4', holds: 'UNKNOWN', text: 'v0 JSON not available in the archive' }); }
  const so = base.filter((x) => x.baselineClass === 'STALE_STATUS_SAYS_MERGED');
  out.push({ id: 'C-5', holds: so.length > 0, text: `${so.length} v0 MERGED_NOT_VERIFIED rows had no PR or commit evidence in v0; now classified individually: ${Object.entries(tally(so, (x) => x.reconClass)).map(([k, v]) => `${k} ${v}`).join(', ')}` });
  return out;
}
export { sortKeys };
