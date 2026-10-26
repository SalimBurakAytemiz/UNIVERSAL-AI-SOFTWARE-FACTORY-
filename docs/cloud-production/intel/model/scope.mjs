//TR: Kapsam: 19 Ekim oct31_impact -> MVP / DEFERRED / FULL_ONLY (rules/scope.json). Eklenen kalemler yalnız açık kaynakla MVP olur (MVP zinciri PR'ı, Wave 0 mvp bayrağı, kuyruk MVP işareti); aksi halde gerekçesiyle FULL_ONLY. Overlay her zaman son sözdür ve gerekçesiyle kaydedilir.
// ctx: { mvpChainPrs: Map<prNumber, stepId>, linkedPrs: number[] }
export function scopeOf(item, rules, overlayScope, ctx = {}) {
  const o = overlayScope.get(item.id);
  if (o) return { scope: o.value, scopeRule: `overlay:${o.by}`, scopeReason: o.reason };
  if (item.baseline) { const s = rules.oct31Map[item.oct31]; return s ? { scope: s, scopeRule: `oct31_impact=${item.oct31}`, scopeReason: '19-Oct inventory oct31_impact' } : { scope: 'FULL_ONLY', scopeRule: `oct31_impact=${item.oct31} (unmapped -> FULL_ONLY)`, scopeReason: 'unmapped oct31_impact' }; }
  const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
  for (const r of rules.addedItemRules || []) {
    if (r.when === 'linkedPrInMvpChain') {
      const hit = (ctx.linkedPrs || []).filter((n) => ctx.mvpChainPrs && ctx.mvpChainPrs.has(n)).sort((a, b) => a - b)[0];
      if (hit !== undefined) return { scope: r.scope, scopeRule: `${r.id}:${ctx.mvpChainPrs.get(hit)}#${hit}`, scopeReason: fill(r.reason, { step: ctx.mvpChainPrs.get(hit), pr: hit }) };
    } else if (r.when === 'wave0MvpFlag') {
      if (item.records.some((x) => x.kind === 'WAVE0' && x.mvp === true)) return { scope: r.scope, scopeRule: r.id, scopeReason: r.reason };
    } else if (r.when === 'queueMvpMarker') {
      if (item.records.some((x) => (x.kind === 'QUEUE_TASK' || x.kind === 'QUEUE_TASK_REPAIR') && x.mvp === true)) return { scope: r.scope, scopeRule: r.id, scopeReason: r.reason };
    } else if ((r.idPrefix || []).some((p) => item.id.startsWith(p)) || (r.origin || []).includes(item.origin)) return { scope: r.scope, scopeRule: r.id, scopeReason: r.reason || r.id };
  }
  return { scope: rules.addedDefault || 'FULL_ONLY', scopeRule: 'added-default', scopeReason: rules.addedDefaultReason || 'no MVP rule matched' };
}
// PR number -> MVP-chain step id, from every PR the chain names.
export function mvpChainPrIndex(steps) {
  const m = new Map();
  const put = (n, id) => { if (typeof n === 'number' && !m.has(n)) m.set(n, id); };
  for (const s of steps || []) {
    for (const p of [...(s.implementedWhen || []), ...(s.blockedWhen || []), ...(s.inProgressWhen || [])]) for (const n of [...(p.prMerged || []), ...(p.prOpen || [])]) put(n, s.id);
    for (const o of s.openItems || []) put(o.openWhilePrOpen, s.id);
  }
  return m;
}
