//TR: Saf metrikler. Paydalar her sayıyla birlikte raporlanır. Kısmi entegrasyon (PARTIAL) ayrı sayılır ve entegre sayılmaz; runtime doğrulaması ölçüm kaynağı olmadığı için NOT_MEASURED'dır (%0 değil; kalem düzeyinde ve alt adım sayımında da NOT_MEASURED). Üç ayrı oran (FULL ve MVP için): kod entegrasyonu (PR merge != bitti), çalışma zamanı doğrulaması ve kabul edilmiş tamamlanma. Geliştirme ilerlemesi yalnız coded+integrated+tested'den hesaplanır (UNKNOWN=0, alt sınır) ve asla tamamlanmayla karıştırılmaz. Ağırlıklar critical-path.json weightModel'e bağlıdır; bilinmeyen model eşit ağırlığa kapalı düşer.
import { pct, round1, round2, toMs, trtDate } from '../core/time.mjs';
import { tally, cmp } from '../core/canonical-json.mjs';

export const STATUSES = ['COMPLETED_AND_VERIFIED', 'MERGED_NOT_VERIFIED', 'IMPLEMENTED_NOT_MERGED', 'FOUNDER_ACTION_REQUIRED', 'BLOCKED', 'IN_PROGRESS', 'QUEUED', 'NOT_STARTED', 'UNKNOWN'];
const SUB = ['coded', 'integrated', 'tested', 'runtimeVerified', 'accepted'];
const ratio = (n, d) => ({ n, d, pct: pct(n, d) });
// No runtime-evidence source exists, so the ratio is not computable: it is NOT_MEASURED, never a measured 0 %.
export const NOT_MEASURED = 'NOT_MEASURED';
const notMeasured = (d) => ({ n: NOT_MEASURED, d, pct: NOT_MEASURED });

export function resolveWeights(weightModel, weightsRules) {
  const m = weightsRules.models[weightModel];
  if (m) return { model: weightModel, item: m.item, substep: m.substep, note: m.note, dq: null };
  const fb = weightsRules.models[weightsRules.fallback];
  return { model: weightsRules.fallback, item: fb.item, substep: fb.substep, note: fb.note, dq: { code: 'UNKNOWN_WEIGHT_MODEL', detail: `weightModel ${weightModel} is unknown; failed closed to equal weights` } };
}

export function block(xs, weights) {
  const n = xs.length;
  const statusCounts = tally(xs, (x) => x.status, STATUSES);
  delete statusCounts.OBSOLETE;
  const substeps = {};
  for (const s of SUB) substeps[s] = tally(xs, (x) => x.substeps[s], s === 'integrated' ? ['TRUE', 'FALSE', 'UNKNOWN', 'PARTIAL'] : s === 'runtimeVerified' ? ['TRUE', 'FALSE', 'UNKNOWN', NOT_MEASURED] : ['TRUE', 'FALSE', 'UNKNOWN']);
  const t = (s) => substeps[s].TRUE;
  let dev = 0, devU = 0;
  for (const x of xs) {
    const tr = ['coded', 'integrated', 'tested'].filter((s) => x.substeps[s] === 'TRUE').length * weights.substep;
    const un = ['coded', 'integrated', 'tested'].filter((s) => x.substeps[s] === 'UNKNOWN' || x.substeps[s] === 'PARTIAL').length * weights.substep;
    dev += (weights.item * tr) / (3 * weights.substep); devU += (weights.item * un) / (3 * weights.substep);
  }
  const unknown = statusCounts.UNKNOWN, stale = xs.filter((x) => x.stale).length;
  return {
    n, statusCounts, substeps,
    ratios: {
      codedRatio: ratio(t('coded'), n), integratedRatio: ratio(t('integrated'), n), integratedPartial: substeps.integrated.PARTIAL, testedRatio: ratio(t('tested'), n), testedUnknown: substeps.tested.UNKNOWN,
      runtimeVerifiedRatio: notMeasured(n), acceptedRatio: ratio(t('accepted'), n), completedAccepted: ratio(statusCounts.COMPLETED_AND_VERIFIED, n),
    },
    devProgressLowerBound: pct(dev, n * weights.item), devProgressUnknownShare: pct(devU, n * weights.item),
    unknown, stale, unreconciled: xs.filter((x) => x.status === 'UNKNOWN' || x.stale).length,
  };
}

export function ratios3(full, mvp) {
  return {
    codeIntegrationRatio: { label: 'PR merged ≠ done', full: full.ratios.integratedRatio, mvp: mvp.ratios.integratedRatio, partial: { full: full.ratios.integratedPartial, mvp: mvp.ratios.integratedPartial }, measured: true,
      reason: 'integrated = every EXPLICIT PR merged into v7/integration, or independent evidence: queue/deliverable/overlay PR, PR title/branch naming the id or record head in v7 (HIGH/MEDIUM); for a 19-Oct merged claim also v7 commit/route evidence (MEDIUM), a PR body mention (LOW) or a WEAK 19-Oct reference to another PR (LOW; integrated only, never tested/CI/merge date; never a reference assigned to another item); a bookkeeping PR or commit (backlog write-back, planning, READY marking) never counts; PARTIAL (some EXPLICIT PRs merged, the rest closed unmerged, no independent evidence) is counted separately and never as integrated' },
    runtimeVerificationRatio: { full: full.ratios.runtimeVerifiedRatio, mvp: mvp.ratios.runtimeVerifiedRatio, measured: false, state: NOT_MEASURED, reason: 'NO_RUNTIME_EVIDENCE_SOURCE: no real-run evidence record exists in git or GitHub; FAKE executor CI, JSON status fields and installer-created artifacts are excluded' },
    acceptedCompletionRatio: { full: full.ratios.acceptedRatio, mvp: mvp.ratios.acceptedRatio, measured: true, source: 'overlay ACCEPTANCE records with a resolvable, non-FAKE evidenceRef', reason: `${full.ratios.acceptedRatio.n} accepted item(s) with an acceptance record; product_verified is NO on 1364/1364 inventory rows` },
  };
}

export function roadmapMetrics(roadmap, itemsById, derived) {
  const phaseItems = new Map();
  for (const x of derived) if (x.roadmapPhase !== null && x.roadmapPhase !== undefined && x.status !== 'OBSOLETE') { if (!phaseItems.has(x.roadmapPhase)) phaseItems.set(x.roadmapPhase, []); phaseItems.get(x.roadmapPhase).push(x); }
  const byPhase = roadmap.phases.map((p) => {
    const xs = phaseItems.get(p.phase) || [];
    const integ = xs.filter((x) => x.substeps.integrated === 'TRUE').length;
    const own = itemsById.get(p.id);
    return { phase: p.phase, id: p.id, title: p.title, period: p.period, wave: p.wave, package: p.package, criticalPath: p.criticalPath, priority: p.priority, contractState: p.contractState,
      closedByEvidence: p.closedByEvidence, exitToken: p.exitToken, itemStatus: own ? own.status : null, status19: own ? own.status19 : null, oct31: own ? own.oct31 : null, linkedItems: xs.length, integratedItems: integ,
      phaseDevSignal: xs.length ? pct(integ, xs.length) : 'UNKNOWN', plannedStart: null, plannedEnd: null, actualStart: own ? own.actual.start : null,
      actualStartState: own && own.actual.start ? 'KNOWN' : 'UNKNOWN', actualStartSource: own ? own.actual.startSource : null, actualEnd: null };
  });
  const closed = byPhase.filter((p) => p.closedByEvidence).length;
  const byWave = roadmap.waves.map((w) => { const ps = byPhase.filter((p) => w.phaseIds.includes(p.phase)); const c = ps.filter((p) => p.closedByEvidence).length; return { wave: w.id, phases: ps.length, closed: c, progress: ps.length ? pct(c, ps.length) : 'UNKNOWN', linkedItems: ps.reduce((s, p) => s + p.linkedItems, 0), integratedItems: ps.reduce((s, p) => s + p.integratedItems, 0) }; });
  const byPeriod = roadmap.periods.map((pd) => { const ps = byPhase.filter((p) => pd.phases.includes(p.phase)); return { period: pd.period, title: pd.title, phases: ps.length, closed: ps.filter((p) => p.closedByEvidence).length }; });
  const pkgs = roadmap.packages.map((k) => ({ id: k.id, phases: k.phaseIds.length, closed: k.phaseIds.every((n) => byPhase.find((p) => p.phase === n)?.closedByEvidence) && k.phaseIds.length > 0 }));
  const cpIds = roadmap.criticalPath.phaseIds;
  const cp = cpIds.map((n) => byPhase.find((p) => p.phase === n)).filter(Boolean);
  const firstOpen = cp.find((p) => !p.closedByEvidence) || null;
  return {
    phases: { total: byPhase.length, closedByEvidence: closed, contractStatePlanned: byPhase.filter((p) => p.contractState === 'PLANNED').length, note: 'contract state PLANNED is a record, never progress' },
    byPhase, byWave, byPeriod, packages: { total: pkgs.length, closed: pkgs.filter((k) => k.closed).length },
    criticalPath: { length: cp.length, closed: cp.filter((p) => p.closedByEvidence).length, weightModel: roadmap.criticalPath.weightModel,
      firstOpenCriticalPhase: firstOpen ? { id: firstOpen.id, title: firstOpen.title, itemStatus: firstOpen.itemStatus, status19: firstOpen.status19 } : null,
      atRisk: cp.filter((p) => p.oct31 === 'AT_RISK').length, withIntegratedLinkedWork: cp.filter((p) => p.integratedItems > 0).length, founderBlocked: cp.filter((p) => p.itemStatus === 'FOUNDER_ACTION_REQUIRED').length },
    schedule: { phaseAdherence: { state: 'UNKNOWN', ratio: 'UNKNOWN', numerator: 0, denominator: 0, reason: 'no planned dates in SRCSET-DATES-v1' } },
  };
}

// MVP chain evaluation: DONE needs acceptance; BLOCKED by open blocker PRs/decisions/steps; IN_PROGRESS by open PRs; IMPLEMENTED_NOT_VERIFIED when every implementedWhen predicate holds.
export function evalMvpChain(steps, ctx) {
  const { pulls, runs, pathsPresent, decisions, acceptedKeys, acceptedItems } = ctx;
  const out = [];
  const byId = new Map();
  for (const s of steps) {
    const ev = [], open = [];
    const pred = (p) => {
      if (p.workflowSuccess) { const w = p.workflowSuccess; const tag = w.evidenceException ? ` [${w.evidenceException}]` : ''; const rs = runs.filter((r) => r.name === w.name && r.headBranch === w.branch && r.event === w.event && r.status === 'completed').sort((a, b) => b.id - a.id); const r = rs[0]; if (!r) return { ok: null, ev: `no completed ${w.name} ${w.event} run on ${w.branch}${tag}` }; return { ok: r.conclusion === 'success', ev: `${w.name} ${w.event} run ${r.id} @${r.headSha.slice(0, 7)} ${r.conclusion}${tag}`, exception: w.evidenceException || null }; }
      if (p.prMerged) { const ps = p.prMerged.map((n) => pulls.get(n)); if (ps.some((x) => !x)) return { ok: null, ev: `PR ${p.prMerged.map((n) => `#${n}`).join(',')} not found` }; return { ok: ps.every((x) => x.mergedAt), ev: ps.map((x) => `#${x.number} ${x.mergedAt ? `merged ${x.mergeCommitSha.slice(0, 7)}` : x.state}`).join(', ') }; }
      if (p.prOpen) { const ps = p.prOpen.map((n) => pulls.get(n)).filter(Boolean); return { ok: ps.some((x) => x.state === 'open'), ev: ps.map((x) => `#${x.number} ${x.state === 'open' ? 'open' : x.mergedAt ? 'merged' : 'closed'}`).join(', ') }; }
      if (p.decisionTextOpen) { const ds = decisions.filter((d) => d.text.includes(p.decisionTextOpen)); return { ok: ds.some((d) => d.state === 'OPEN'), ev: ds.map((d) => `${d.id} ${d.state}`).join(', ') || `no decision mentions ${p.decisionTextOpen}` }; }
      if (p.stepBlocked) { const st = byId.get(p.stepBlocked); return { ok: st === 'BLOCKED', ev: `${p.stepBlocked} ${st}` }; }
      if (p.itemsAccepted !== undefined) return { ok: acceptedItems >= p.itemsAccepted, ev: `${acceptedItems} item(s) COMPLETED_AND_VERIFIED` };
      return { ok: null, ev: 'unknown predicate' };
    };
    const impl = (s.implementedWhen || []).map(pred), blk = (s.blockedWhen || []).map(pred), prog = (s.inProgressWhen || []).map(pred);
    for (const r of [...impl, ...blk, ...prog.filter((x) => x.ok)]) ev.push(r.ev);
    for (const o of s.openItems || []) {
      if (o.openWhilePathAbsent) { if (!pathsPresent[o.openWhilePathAbsent]) open.push(`${o.id} (${o.openWhilePathAbsent} not on v7/integration)`); }
      else if (o.openWhilePrOpen) { const p = pulls.get(o.openWhilePrOpen); if (p && p.state === 'open') open.push(`${o.id} (open)`); }
      else open.push(o.text ? `${o.id} (${o.text})` : o.id);
    }
    let status;
    if (acceptedKeys.has(s.acceptanceKey)) status = 'DONE';
    else if (blk.some((r) => r.ok)) status = 'BLOCKED';
    else if (prog.some((r) => r.ok)) status = 'IN_PROGRESS';
    else if (impl.length && impl.every((r) => r.ok === true)) status = 'IMPLEMENTED_NOT_VERIFIED';
    else if (impl.some((r) => r.ok === null)) status = 'UNKNOWN';
    else status = 'NOT_STARTED';
    byId.set(s.id, status);
    const exceptions = impl.map((r) => r.exception).filter(Boolean);
    out.push({ id: s.id, step: s.label, status, evidence: ev.join('; '), open, acceptanceKey: s.acceptanceKey, evidenceException: exceptions[0] || null });
  }
  return out;
}

// ETA only from measured velocity: >= minSnapshots daily points spanning >= minSpanDays with v > 0.
export function etaFrom(points, key, remaining, nowIso, minSnapshots, minSpanDays, label, semantics = 'intel-1') {
  const ps = points.filter((p) => p.semantics === semantics && typeof p[key] === 'number').sort((a, b) => cmp(a.date, b.date));
  if (ps.length < minSnapshots) return { state: 'ETA_UNKNOWN', reason: 'INSUFFICIENT_HISTORY', points: ps.length, label };
  const a = ps[0], b = ps[ps.length - 1];
  const days = (toMs(`${b.date}T00:00:00Z`) - toMs(`${a.date}T00:00:00Z`)) / 864e5;
  if (days < minSpanDays) return { state: 'ETA_UNKNOWN', reason: 'INSUFFICIENT_HISTORY', points: ps.length, spanDays: days, label };
  const v = (b[key] - a[key]) / days;
  if (!(v > 0)) return { state: 'ETA_UNKNOWN', reason: 'ZERO_OR_NEGATIVE_VELOCITY', velocityPerDay: round2(v), points: ps.length, label };
  const etaMs = toMs(nowIso) + (remaining / v) * 864e5;
  return { state: 'MEASURED', velocityPerDay: round2(v), remaining, eta: new Date(etaMs).toISOString().slice(0, 10), points: ps.length, spanDays: days, label };
}

export function oct31View(mvpItems, mvpBlock, chain, decisions, capacity, mergesPerDay7d, deferrable) {
  const notIntegrated = mvpItems.filter((x) => x.substeps.integrated !== 'TRUE');
  const risk = chain.some((s) => s.status === 'BLOCKED') ? 'BLOCKED' : notIntegrated.length > 0 ? 'AT_RISK' : mvpItems.every((x) => x.substeps.accepted === 'TRUE') ? 'ON_TRACK' : 'AT_RISK';
  return {
    oct31Risk: risk, done: { accepted: mvpBlock.substeps.accepted.TRUE, of: mvpBlock.n }, integrated: { n: mvpBlock.substeps.integrated.TRUE, of: mvpBlock.n },
    missing: notIntegrated.length, missingIds: notIntegrated.map((x) => x.id).sort(cmp),
    mvpChainDone: { done: chain.filter((s) => s.status === 'DONE').length, of: chain.length },
    founderBlocked: mvpItems.filter((x) => x.status === 'FOUNDER_ACTION_REQUIRED').length, openDecisions: decisions.filter((d) => d.state === 'OPEN').length,
    deferrable, capacity: { ...capacity, mergesPerDay7d },
  };
}
export const dayOf = (iso, tz) => trtDate(iso, tz);
export { round1 };
