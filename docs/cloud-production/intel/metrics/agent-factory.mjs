//TR: Ajan fabrikası (bölüm E): hazırlık katmanları yalnız C-RDY-1 computeRoleReadiness ölçümünden (PR #260) gelir; her katman TRUE/FALSE/UNKNOWN/payda/measured ile gösterilir ve ölçülmemiş katman ASLA 0 gösterilmez. Kayıt defteri iddiaları (evaluationSpecsExecuted, adapter implementation, runtimeStatus) ayrı 'registry claim, not evidence' sütunundadır. Rol ve spec'ler iş toplamlarına girmez.
import { canonicalId } from '../core/ids.mjs';
export function computeAgentFactory({ registries, readiness, wave0, rules, resolvers, itemsById }) {
  const layers = rules.layers;
  const measured = readiness && readiness.state === 'MEASURED';
  const a = measured ? readiness.audit : null;
  const layerRow = (L) => {
    if (!a) return { layer: L, TRUE: 'UNKNOWN', FALSE: 'UNKNOWN', UNKNOWN: 'UNKNOWN', denominator: registries.roleDefs.roles || 'UNKNOWN', measured: false, reason: readiness?.reason || 'READINESS_RUNTIME_UNAVAILABLE' };
    const c = a.totals[L];
    return { layer: L, TRUE: c.TRUE, FALSE: c.FALSE, UNKNOWN: c.UNKNOWN, NOT_APPLICABLE: c.NOT_APPLICABLE, denominator: c.denominator, measured: c.measured, reasons: a.reasonCounts[L] || {} };
  };
  const totals = layers.map(layerRow);
  const founderColumns = rules.founderColumns.map((fc) => {
    if (!fc.layer) return { column: fc.column, layer: null, value: 'UNKNOWN', measured: false, note: fc.note };
    const r = totals.find((t) => t.layer === fc.layer);
    return { column: fc.column, layer: fc.layer, TRUE: r.TRUE, denominator: r.denominator, measured: r.measured, note: fc.note ?? null };
  });
  const group = (rows) => (rows || []).map((g) => ({ id: g.id, clusterId: g.clusterId, roles: g.roles, layers: Object.fromEntries(layers.map((L) => [L, { TRUE: g.layers[L].TRUE, FALSE: g.layers[L].FALSE, UNKNOWN: g.layers[L].UNKNOWN, denominator: g.layers[L].denominator, measured: g.layers[L].measured }])) }));
  const rc = registries.roleDefs.counts || {};
  const pc = registries.profiles.counts || {};
  const w0 = [...(wave0?.packages || [])].sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)).map((p) => { const it = itemsById.get(canonicalId(p.id)); return { id: p.id, priority: p.priority, title: String(p.title || '').slice(0, 90), status: it ? it.status : 'UNKNOWN', prs: it ? it.integratedPrs.concat(it.openPrs) : [] }; });
  return {
    source: measured ? readiness.source : null, state: measured ? 'MEASURED' : 'UNAVAILABLE', reason: measured ? null : (readiness?.reason || 'READINESS_RUNTIME_UNAVAILABLE'),
    authority: a ? a.authority : null, digest: a ? a.digest : null, computedAt: a ? a.computedAt : null, inputs: a ? a.inputs : null,
    roles: { denominator: a ? a.denominator : (registries.roleDefs.roles || 'UNKNOWN'), guilds: registries.roleDefs.guilds, clusters: registries.roleDefs.clusters },
    layers: totals, founderColumns,
    byGuild: a ? group(a.byGuild) : 'UNKNOWN', byCluster: a ? group(a.byCluster) : 'UNKNOWN',
    proposedOnly: a ? a.proposedOnly : 'UNKNOWN',
    registryClaims: { label: 'registry claim, not evidence', evaluationSpecs: rc.evaluationSpecs ?? null, evaluationSpecsExecuted: rc.evaluationSpecsExecuted ?? null, runtimeReady: rc.runtimeReady ?? null, certified: rc.certified ?? null,
      boundRoles: pc.boundRoles ?? null, withCandidateSkills: pc.withCandidateSkills ?? null, adapterStatus: registries.adapters.byStatus, adapterImplementation: registries.adapters.byImplementation, gapIds: rc.gapIds ?? null },
    evaluationSpecs: { defined: rc.evaluationSpecs ?? 'UNKNOWN', executedByEvidence: a ? a.totals.EVALUATED.TRUE : 'UNKNOWN', note: 'executed count comes from EVALUATED evidence, not from the registry' },
    adapters: { defined: registries.adapters.count, implemented: a && a.inputs.adapterReality === 'SUPPLIED' ? 'SEE_READINESS' : 'UNKNOWN', implementedReason: 'adapterReality input NOT_SUPPLIED until C-RDY-2a', executed: 'UNKNOWN', verified: 'UNKNOWN', probeReason: 'probes not observed' },
    resolvers: resolvers.map((r) => ({ id: r.id, path: r.path, symbol: r.symbol, present: r.present, introducedBy: r.introducedBy ? { sha7: r.introducedBy.sha.slice(0, 7), at: r.introducedBy.at } : null, testedByFiles: r.tests.length, tests: r.tests, wave0Package: r.wave0Package })),
    wave0Packages: w0,
    continuousLearning: 'NOT_FOUND',
  };
}
