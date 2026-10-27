//TR: İş envanteri eki: UASCO_WORK_INVENTORY.json (kalemler id'ye göre sıralı + bağlantılar) ve aynı kalemlerin sabit sütun sıralı CSV'si (bilinmeyen tarih CSV'de UNKNOWN; JSON'da null + startSourcesChecked). Bu dosyalarda zaman damgası yoktur; değişmeyen günlerde aynı git blob'u yeniden kullanılır.
import { toCsv } from '../core/csv.mjs';
import { cmp } from '../core/canonical-json.mjs';

export const CSV_COLUMNS = ['id', 'title', 'dimension', 'origin', 'department', 'departmentRule', 'roadmapPhase', 'wave', 'milestone', 'scope', 'owner', 'lane', 'executor', 'dependsOn', 'plannedStart', 'plannedEnd', 'actualStart', 'lastMergedAt', 'actualDone',
  'status', 'reconClass', 'baselineClass', 'evidenceClass', 'coded', 'integrated', 'tested', 'runtimeVerified', 'accepted', 'prs', 'corroboratingWeakPrs', 'mergeCommits', 'commits', 'ciRuns', 'blockers', 'founderDecision', 'nextAction', 'sizeEstimate', 'measuredDurationHours', 'cost', 'confidence', 'stale', 'missingEvidence', 'description'];

export function inventoryItem(x) {
  return {
    id: x.id, title: x.title, description: x.description, dimension: x.dimension, origin: x.origin, department: x.department, departmentRule: x.departmentRule,
    roadmapPhase: x.roadmapPhase, relatedPhases: x.relatedPhases, wave: x.wave, period: x.period, milestone: x.milestone, scope: x.scope, scopeRule: x.scopeRule, owner: x.owner, lane: x.lane, executor: x.executor,
    dependsOn: x.dependsOn, planned: x.planned, actual: x.actual, status: x.status, status19: x.status19, statusRule: x.statusRule, reconClass: x.reconClass, baselineClass: x.baselineClass, evidenceBaselineClass: x.evidenceBaselineClass ?? null, evidenceClass: x.evidenceClass, matchKind: x.matchKind,
    scopeReason: x.scopeReason ?? null, weakInventoryRefs: x.weakInventoryRefs || [],
    substeps: x.substeps, evidence: x.evidence, links: x.links, blockers: x.blockers, founderDecision: x.founderDecision, nextAction: x.nextAction, sizeEstimate: x.sizeEstimate,
    measuredDurationHours: x.measuredDurationHours, cost: x.cost, confidence: x.confidence, stale: x.stale, missingEvidence: x.missingEvidence, aliases: x.aliases,
    priority: x.priority, oct31: x.oct31, prs: x.prs, integratedPrs: x.integratedPrs, corroboratingWeakPrs: x.corroboratingWeakPrs || [], openPrs: x.openPrs, mergeCommits: x.mergeCommits, mergedAt: x.mergedAt, commits: x.commits, ciRuns: x.ciRuns,
    commitEvidence: x.commitEvidence, candidateLinks: x.candidateLinks, supportingRefs: x.supportingRefs, records: x.records, openDependsOn: x.openDependsOn ?? null, devOpenDependsOn: x.devOpenDependsOn ?? null,
  };
}
export function inventoryJson(model, meta) {
  return {
    '//TR': 'UASCO iş envanteri eki (Intel V1): her kalem tek durum, tek uzlaştırma sınıfı, kanıt merdiveni alt adımları ve kanıt/eksik kanıt listeleriyle. Zaman damgası içermez.',
    schemaVersion: 'intel-1.0.0', inputs: meta.inputsShort,
    counts: { items: model.items.length, live: model.live.length, links: model.links.length },
    items: [...model.items].sort((a, b) => cmp(a.id, b.id)).map(inventoryItem),
    links: model.links.map((l) => ({ id: l.id, itemId: l.itemId, kind: l.kind, ref: l.ref, strength: l.strength, source: l.source, at: l.at })),
  };
}
export function inventoryCsv(model) {
  const rows = [...model.items].sort((a, b) => cmp(a.id, b.id)).map((x) => ({
    ...x, dependsOn: [...x.dependsOn].sort(cmp), plannedStart: x.planned.start ?? 'UNKNOWN', plannedEnd: x.planned.end ?? 'UNKNOWN', actualStart: x.actual.start ?? 'UNKNOWN', lastMergedAt: x.actual.lastMergedAt, actualDone: x.actual.done,
    coded: x.substeps.coded, integrated: x.substeps.integrated, tested: x.substeps.tested, runtimeVerified: x.substeps.runtimeVerified, accepted: x.substeps.accepted,
    prs: x.prs.map((n) => `#${n}`), corroboratingWeakPrs: (x.corroboratingWeakPrs || []).map((n) => `#${n}`), mergeCommits: [...x.mergeCommits].sort(cmp), commits: [...x.commits].sort(cmp), ciRuns: x.ciRuns.map(String), blockers: [...x.blockers].sort(cmp), missingEvidence: [...x.missingEvidence].sort(cmp),
    stale: x.stale ? 'true' : 'false', description: x.description ? String(x.description).replace(/\r?\n/g, ' ') : '',
  }));
  return toCsv(rows, CSV_COLUMNS);
}
