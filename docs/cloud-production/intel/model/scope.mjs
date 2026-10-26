//TR: Kapsam: 19 Ekim oct31_impact -> MVP / DEFERRED / FULL (rules/scope.json). Eklenen kalemler yalnız kural veya overlay SCOPE ile MVP olur; aksi halde FULL. Overlay her zaman son sözdür ve gerekçesiyle kaydedilir.
export function scopeOf(item, rules, overlayScope) {
  const o = overlayScope.get(item.id);
  if (o) return { scope: o.value, scopeRule: `overlay:${o.by}` };
  if (item.baseline) { const s = rules.oct31Map[item.oct31]; return s ? { scope: s, scopeRule: `oct31_impact=${item.oct31}` } : { scope: 'FULL', scopeRule: `oct31_impact=${item.oct31} (unmapped -> FULL)` }; }
  for (const r of rules.addedItemRules || []) {
    if ((r.idPrefix || []).some((p) => item.id.startsWith(p)) || (r.origin || []).includes(item.origin)) return { scope: r.scope, scopeRule: r.id };
  }
  return { scope: rules.addedDefault || 'FULL', scopeRule: 'added-default' };
}
