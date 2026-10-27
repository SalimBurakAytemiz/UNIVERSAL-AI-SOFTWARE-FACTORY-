//TR: UASCO_REMAINING_WORK.json: v0 raporunun TÜM anahtar yolları aynı tiplerle korunur (değerler kanonik modelden hesaplanır), anlamı değişen alanlar fieldSemantics'te adlandırılır ve v0 kuralı aynı girdilerle totals.legacyV0'da yeniden hesaplanır. Yeni bloklar: schemaVersion, freshness, reconciliation, metrics, agentFactory, productivity, targets, decisions, plan, history, dataQuality, trendPoint.
import { pct } from '../core/time.mjs';
import { trtStamp } from '../core/time.mjs';
import { cmp, natCmp, tally } from '../core/canonical-json.mjs';
import { STATUSES } from '../metrics/metrics.mjs';

const summarize = (xs) => {
  const live = xs.filter((x) => x.status !== 'OBSOLETE');
  const byStatus = {}; for (const s of STATUSES) { const n = live.filter((x) => x.status === s).length; if (n) byStatus[s] = n; }
  const done = byStatus.COMPLETED_AND_VERIFIED || 0;
  return { rows: xs.length, unique: xs.filter((x) => x.excluded19 !== 'DUPLICATE').length, live: live.length, byStatus, verifiedCompleted: done, remainingIncludingVerification: live.length - done, mergedNotVerified: byStatus.MERGED_NOT_VERIFIED || 0,
    stale: live.filter((x) => x.stale).length, mvpScope_AT_RISK: live.filter((x) => x.scope === 'MVP').length, deferrable_NOT_DELIVERABLE_or_NONE: live.filter((x) => x.scope !== 'MVP').length };
};
const stripRows = (lv) => { const { rows, ...rest } = lv; return rest; };

export const FIELD_SEMANTICS = {
  'totals.allWorkDimensions.byStatus': 'canonical status under the evidence ladder: MERGED_NOT_VERIFIED needs a linked PR whose merge commit is an ancestor of v7/integration, or v7 commit/route evidence; status-only progress claims move to UNKNOWN (see totals.legacyV0 for the v0 rule)',
  'totals.*.stale': 'items whose status still rests on the 19-Oct status field (reconClass STALE_NO_EVIDENCE_* or STATUS_ONLY_UNVERIFIED); v0 counted every row without a linked PR',
  'totals.UNRECONCILED_WORK': 'baseline live items with status UNKNOWN or stale under the evidence model (v0: STALE + UNKNOWN by the v0 rule)',
  'totals.VERIFICATION_PENDING_MERGED': 'canonical MERGED_NOT_VERIFIED count (evidence-backed); v0 counted status-only rows too',
  'totals.VERIFIED_REMAINING': "'UNKNOWN' while nothing is accepted and UNKNOWN/stale items remain; otherwise live minus accepted",
  'totals.KNOWN_OPEN_WORK.openPrs': 'open PRs (all bases), as in v0',
  'inputs.wave0': 'git blob id of docs/cloud-production/intel/inputs/wave0-baseline.json (v0: the string read/UNAVAILABLE for an ephemeral scratchpad file)',
  'inputs.queueSha': 'origin/uasco/production-queue tip read by this run',
  fingerprint: 'sha256 over the whole normalized inputs bundle (git refs, inventory, coordinator records, PRs, runs, check-runs, files, merged_by, timings/jobs, texts, readiness, priors older than today, freshness states) + rules/overlay/wave0 blob ids + engine tree (and working-file hash when DIRTY); excluded: the clock (FRESH asOf, cache ages, fetch time) and GitHub call accounting; v0 covered SHAs + open PR heads only',
  'items[].substeps.integrated': "TRUE when every EXPLICIT PR of the item merged into v7/integration; or, when the EXPLICIT set is incomplete or absent, independent evidence (queue/deliverable/overlay PR, PR title/branch naming the id, record head in v7; for a 19-Oct merged claim also v7 commit/route evidence, PR body mention or a WEAK 19-Oct reference at LOW confidence). WEAK corroboration sets integrated only: tested stays UNKNOWN and integratedPrs/ciRuns/lastMergedAt stay empty (the PRs are listed in corroboratingWeakPrs). 'PARTIAL' when only some EXPLICIT PRs merged, the rest closed unmerged, and no independent evidence exists (never counted as integrated); a WEAK 19-Oct reference (range, nested, role-annotated, assigned to another item, gate failed) never upgrades a row without a merged claim",
  'items[].substeps.runtimeVerified': "NOT_MEASURED for every live item (UNKNOWN when excluded): no runtime-evidence source exists, so no measured FALSE is shown; the substep tally has a NOT_MEASURED bucket",
  'items[].corroboratingWeakPrs': 'PRs of WEAK 19-Oct references that corroborate a merged claim (integrated only, LOW); never integratedPrs, so their CI runs and merge dates are not credited to the item',
  'items[].actual.start': 'earliest createdAt of a merged or open strong PR of the item itself; for a coded item also its own v7 commit (subject head names the id; backlog/planning/queue/ledger bookkeeping commits excluded) or its coordinator record head (labelled in v7/integration or on its branch); UNKNOWN (null) with actual.startSourcesChecked otherwise; closed-unmerged PRs, WEAK references and commits that merely mention the id never set a start',
  'items[].scope': "MVP / DEFERRED / FULL_ONLY. Baseline: 19-Oct oct31_impact (FULL_ONLY = impact NONE). Added items: MVP only by an explicit source (MVP-chain PR, Wave 0 mvp flag, queue MVP marker), else FULL_ONLY with scopeReason. The dashboard column 'FULL' means ALL live items, not scope FULL_ONLY",
  'metrics.mvp': 'live MVP-scope items = 19-Oct AT_RISK rows + added items made MVP by an explicit rule (reconciliation.mvpScope lists them with reasons); metrics.mvpBaseline is the 19-Oct-only MVP set',
  'metrics.ratios3.runtimeVerificationRatio': "NOT_MEASURED (n and pct are the string NOT_MEASURED): no runtime-evidence source exists; it is never shown as a measured 0 %",
  'freshness.github.sources': 'per-source freshness (pulls, runs, check-runs, run timing/jobs, open-PR files, merged_by): FRESH, PARTIAL (some calls failed; cached data served with cacheAsOf / cacheAgeHours), STALE_CACHE (every call failed and cached data was served) or UNAVAILABLE (every call failed and nothing was served from cache: the data is missing, not stale); lastError is the last error of that source\'s own calls. freshness.github.state is PR-table based: STALE_CACHE / UNAVAILABLE only when the PR table itself was not refreshed, PARTIAL when any other source is not FRESH',
  'freshness.v7.state': 'FRESH only when this run fetched the refs successfully (fetchedAt); UNFETCHED when no fetch ran (lastFetchAt = FETCH_HEAD time); STALE when the fetch failed',
  githubCalls: 'GitHub REST calls of this run including 304 Not Modified answers',
  mvp: 'computed from rules/mvp-chain.json predicates against GitHub/git state (v0: hand-written)',
  mvpCritical: 'open items of the computed MVP chain',
  'openPrs[].founder': 'true when protected files changed, FOUNDER-TIER/PROTECTED is in the title, or an OPEN Founder decision references the PR (v0 hard-coded #66); false only when the file list is known; the string UNKNOWN (and protectedFiles null, protectedFilesKnown false) when the file list could not be fetched and no title/decision rule applies',
  founderFilesUnknown: 'open PRs whose file list could not be fetched (founder UNKNOWN); kept out of founder[] so that list keeps its legacy meaning and types',
  'fullScope.executableRoles_bound': 'registry claim (role-execution-profiles counts.boundRoles), not evidence; measured EXECUTABLE is agentFactory.layers',
  'fullScope.runningRoles': 'readiness RUNNING layer; UNKNOWN while no run journal is read',
  'fullScope.toolAdaptersImplemented_perWave0': 'registry claim: adapters whose implementation field is not NOT_IMPLEMENTED; canonical value is agentFactory.adapters.implemented (UNKNOWN until C-RDY-2a)',
  'fullScope.resolvers': 'derived from git ls-tree of v7/integration plus tests importing each resolver (correction C-2)',
  'coverage.toolExecutionCoverage': 'registry claim ratio, not evidence',
  'coverage.evaluationCoverage': 'registry claim ratio (evaluationSpecsExecuted/evaluationSpecs); evidence is agentFactory.evaluationSpecs.executedByEvidence',
  eta: "ETA from measured velocity only (>=3 daily snapshots over >=3 days); else 'ETA_UNKNOWN'",
  oct31Risk: 'BLOCKED if any MVP-chain step is BLOCKED, else AT_RISK while MVP items are unintegrated, ON_TRACK only when all MVP items are accepted',
  mergesRecordedToday: 'integrationBoard.merges with `at` on the UTC date of this run (coordinator record), as in v0',
};

export function buildReport(m, meta) {
  const now = new Date(meta.nowIso).toISOString();
  const baselineAll = m.items.filter((x) => x.origin === 'BASELINE_2026_10_19');
  const dims = [...new Set(baselineAll.map((x) => x.dimension))];
  const allWork = summarize(baselineAll);
  const unknownOrStale = m.base.filter((x) => x.status === 'UNKNOWN' || x.stale).length;
  const pulls = [...m.pulls.values()];
  const open = pulls.filter((p) => p.state === 'open').sort((a, b) => a.number - b.number);
  const prot = m.inputs.protectedPaths || {};
  const isProt = (f) => (prot.exactPaths || []).includes(f) || (prot.protectedPrefixes || []).some((x) => f.startsWith(x));
  const decisionRefs = new Set(m.decisions.filter((d) => d.state === 'OPEN').flatMap((d) => d.refs.map((r) => Number(r.slice(1)))));
  const openPrs = open.map((p) => {
    const runs = m.inputs.github.checks[p.headSha] || null;
    const staleAt = (m.inputs.github.staleChecks || {})[p.headSha];
    const c = (n) => { if (!runs) return 'NOT_REPORTED'; const r = runs.filter((x) => x.name === n).sort((a, b) => cmp(b.startedAt || '', a.startedAt || ''))[0]; return r ? (r.conclusion || r.status) : 'NOT_REPORTED'; };
    const files = m.inputs.github.prFiles[p.number] || [];
    const u = c('validate (ubuntu-latest)'), w = c('validate (windows-latest)');
    const ci = [u, w].includes('failure') ? 'FAILED' : (u === 'success' && w === 'success') ? 'GREEN' : 'PENDING';
    const lane = /lane-a/.test(p.headRef) ? 'A' : /lane-b/.test(p.headRef) ? 'B' : /lane-c/.test(p.headRef) ? 'C' : /coord/.test(p.headRef) ? 'COORD' : 'OTHER';
    const filesKnown = Object.prototype.hasOwnProperty.call(m.inputs.github.prFiles, p.number);
    // without a file list the protected-file rule cannot be evaluated: founder is UNKNOWN unless a title/decision rule already applies
    const founder = /FOUNDER-TIER|PROTECTED/.test(p.title) || decisionRefs.has(p.number) || (filesKnown && files.some(isProt)) ? true : filesKnown ? false : 'UNKNOWN';
    return { number: p.number, lane, title: p.title.slice(0, 90), head: (p.headSha || '').slice(0, 7), draft: p.draft, autoMerge: p.autoMerge, ci, ciSource: staleAt !== undefined ? 'STALE_CACHE' : runs ? 'FRESH' : 'NONE', ciAsOf: staleAt !== undefined ? (staleAt || 'UNKNOWN') : null, ubuntu: u, windows: w, protectedFiles: filesKnown ? files.filter(isProt).length : null, protectedFilesKnown: filesKnown, founder, url: p.url };
  });
  const lanes = ['A', 'B', 'C', 'COORD'].map((L) => { const mm = pulls.filter((p) => p.mergedAt && (L === 'COORD' ? /coord/.test(p.headRef) : new RegExp(`lane-${L.toLowerCase()}`).test(p.headRef)));
    const o = openPrs.filter((p) => p.lane === L); return { lane: L, mergedPrs: mm.length, openPrs: o.map((p) => p.number), ciFailed: o.filter((p) => p.ci === 'FAILED').map((p) => p.number), founder: o.filter((p) => p.founder === true).map((p) => p.number), founderUnknown: o.filter((p) => p.founder === 'UNKNOWN').map((p) => p.number) }; });
  const mvp = m.chain.map((s) => ({ step: s.step, status: s.status, evidence: s.evidence, open: s.open }));
  const mvpCritical = [...new Set(m.chain.flatMap((s) => s.open))];
  const reg = m.inputs.registries, rc = reg.roleDefs.counts || {}, pc = reg.profiles.counts || {};
  const af = m.agentFactory;
  const implClaim = Object.entries(reg.adapters.byImplementation).filter(([k]) => k !== 'NOT_IMPLEMENTED').reduce((s, [, v]) => s + v, 0);
  const running = af.layers.find((l) => l.layer === 'RUNNING');
  const fullScope = { canonicalRoles: rc.roles, guilds: rc.guilds, executableRoles_bound: pc.boundRoles, runningRoles: running && running.measured ? running.TRUE : `UNKNOWN (${af.state === 'MEASURED' ? 'RUNNING not measured: no run journal' : 'readiness unavailable'})`, certifiedRoles: rc.certified,
    evaluationSpecs: rc.evaluationSpecs, evaluationSpecsExecuted: rc.evaluationSpecsExecuted, gapIds: rc.gapIds, toolAdapters: reg.adapters.count, toolAdaptersImplemented_perWave0: implClaim,
    resolvers: af.resolvers.map((r) => `${r.id} ${r.present ? 'PRESENT' : 'ABSENT'}${r.wave0Package && !r.present ? ` (${r.wave0Package})` : ''}`).join('; '), continuousLearning: 'NOT_FOUND', wave0PackagesPlanned: (m.inputs.wave0.packages || []).length };
  const coverage = { mvpStepsDone: `${m.chain.filter((s) => s.status === 'DONE').length}/${m.chain.length}`, roleProfileCoverage_bound: pct(pc.boundRoles, rc.roles), roleCandidateSkills_proposed: pct(pc.withCandidateSkills, rc.roles),
    toolExecutionCoverage: pct(implClaim, reg.adapters.count), evaluationCoverage: pct(rc.evaluationSpecsExecuted, rc.evaluationSpecs), desktopFunctionalAcceptance: `UNKNOWN (accepted items ${m.metrics.full.substeps.accepted.TRUE}; 19-Oct: 0 product-verified screens; no acceptance record)` };
  const founder = openPrs.filter((p) => p.founder === true).map((p) => ({ pr: p.number, ci: p.ci, protectedFiles: p.protectedFiles, action: p.ci === 'GREEN' ? 'review, approve, merge (draft -> ready)' : 'wait for CI; do not merge red', url: p.url }));
  // open PRs whose file list could not be fetched: the Founder flag is UNKNOWN, so they are listed apart (never silently 'no')
  const founderFilesUnknown = openPrs.filter((p) => p.founder === 'UNKNOWN').map((p) => ({ pr: p.number, ci: p.ci, action: 'file list UNKNOWN: check for protected files before any merge', url: p.url }));
  const pushRuns = m.inputs.github.runs.filter((r) => r.headBranch === 'v7/integration' && r.event === 'push').sort((a, b) => b.id - a.id);
  const inst = pushRuns.find((r) => r.name === 'Windows Installer'), ciPush = pushRuns.find((r) => r.name === 'CI');
  const today = now.slice(0, 10);
  const eta = m.eta.mvpAcceptance.state === 'MEASURED' ? m.eta.mvpAcceptance.eta : 'ETA_UNKNOWN';
  const r = {
    '//TR': 'UASCO günlük proje istihbarat raporu ve anlık görüntüsü (Intel V1, deterministik, tek kaynak). Tüm sayılar kaynak alanına izlenebilir; JSON durum alanları yürütme kanıtı değildir; merge != kabul.',
    generatedAt: now, generatedAtTRT: trtStamp(now), fingerprint: meta.fingerprint,
    inputs: { baseSha: m.inputs.meta.refs.v7.sha, queueSha: m.inputs.meta.refs.queue.sha, inventoryBlob: m.inputs.meta.inventoryBlob, wave0: meta.wave0BlobId || 'UNKNOWN' },
    githubCalls: m.inputs.github.calls,
    totals: {
      note: 'Canonical inventory = the 2026-10-19 snapshot (historical baseline, not current truth) reconciled item by item against GitHub PR state, v7/integration commits and route literals, plus items added since by the queue, backlog, Wave 0, lane deliverables and coordinatorBuild. A status field is never evidence. Roles (599) are not work items.',
      allWorkDimensions: allWork, uniqueTasks_PT: summarize(baselineAll.filter((x) => x.dimension === 'tasks')),
      byDimension: Object.fromEntries(dims.map((d) => [d, summarize(baselineAll.filter((x) => x.dimension === d))])),
      VERIFIED_REMAINING: allWork.verifiedCompleted === 0 && unknownOrStale > 0 ? 'UNKNOWN' : allWork.remainingIncludingVerification,
      KNOWN_OPEN_WORK: { openPrs: open.length, coordinatorWave0Packages: (m.inputs.wave0.packages || []).length, mvpCriticalItems: mvpCritical.length },
      UNRECONCILED_WORK: m.metrics.baseline741.unreconciled, VERIFICATION_PENDING_MERGED: m.metrics.baseline741.statusCounts.MERGED_NOT_VERIFIED,
      legacyV0: stripRows(m.legacy),
    },
    lanes, openPrs, mvp, mvpCritical, fullScope, coverage,
    oct31Risk: m.oct31.oct31Risk, eta, founder, founderFilesUnknown, founderQueueRecords: m.coordinator.founderQueue.length,
    ledger: { reviews: m.coordinator.ledgerReviews.length, prs: new Set(m.coordinator.ledgerReviews.map((x) => x.pr)).size },
    mergesRecordedToday: m.coordinator.integrationBoard.merges.filter((x) => String(x.at || '').startsWith(today)).length,
    lastPush: { ci: ciPush ? `${ciPush.headSha.slice(0, 7)} ${ciPush.conclusion || ciPush.status}` : 'UNKNOWN', installer: inst ? `${inst.headSha.slice(0, 7)} ${inst.conclusion || inst.status} (run ${inst.id})` : 'UNKNOWN' },
    wave0Packages: [...(m.inputs.wave0.packages || [])].sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99) || cmp(String(a.id), String(b.id))).map((p) => ({ id: p.id, priority: p.priority, title: String(p.title || '').slice(0, 80) })),
    // ---- Intel V1 additions
    schemaVersion: 'intel-1.0.0',
    fieldSemantics: FIELD_SEMANTICS,
    meta: { engineTree: meta.engineTree, engineDirty: !!meta.engineDirty, engineDirtyFiles: meta.engineDirtyFiles || [], engineWorkHash: meta.engineWorkHash || null, rulesBlobIds: meta.rulesBlobIds, overlayBlobId: meta.overlayBlobId, reused: meta.reused, refs: m.inputs.meta.refs, refsFetch: m.inputs.meta.refsFetch || null, inventoryCsvBlob: m.inputs.meta.csvBlob, cacheFrom: m.inputs.meta.cacheFrom, semantics: m.history.semantics },
    freshness: m.dataQuality.freshness,
    reconciliation: m.reconciliation,
    metrics: {
      denominators: { liveNow: m.metrics.full.n, baseline741: m.metrics.baseline741.n, mvp: m.metrics.mvp.n, mvpBaseline: m.metrics.mvpBaseline.n },
      full: m.metrics.full, baseline741: m.metrics.baseline741, mvp: m.metrics.mvp, mvpBaseline: m.metrics.mvpBaseline, ratios3: m.metrics.ratios3, ratios3Baseline: m.metrics.ratios3Baseline,
      byDepartment: m.metrics.byDepartment, lanes: m.metrics.lanes,
      roadmap: { phases: m.rm.phases, byWave: m.rm.byWave, byPeriod: m.rm.byPeriod, packages: m.rm.packages }, byPhase: m.rm.byPhase, criticalPath: m.rm.criticalPath, schedule: { ...m.rm.schedule, targets: m.targets.map((t) => ({ id: t.id, state: t.state, date: t.date })) },
      oct31: m.oct31, mvpChain: m.chain, eta: m.eta, weights: m.metrics.weights, datesChecked: m.roadmap.datesChecked,
    },
    agentFactory: m.agentFactory, productivity: m.productivity,
    targets: m.targets, targetFlags: m.targetFlags, targetCandidates: m.targetCandidates,
    decisions: m.decisions, plan: m.plan, history: m.history, dataQuality: { ...m.dataQuality, freshness: undefined },
    trendPoint: m.trendPoint, snapshotMetrics: meta.compactMetrics,
  };
  return r;
}
export { natCmp, tally };
