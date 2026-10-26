//TR: Departman sınıflandırması veri kurallarıyla (rules/departments.json): sıralı kurallar, ilk eşleşen kazanır, eşleşme yoksa UNASSIGNED. Her kalem tam bir birincil departman alır; overlay DEPARTMENT kuralların önüne geçer.
export function compileRules(rules) {
  return rules.rules.map((r) => ({ ...r, _title: r.when.titleRegex ? new RegExp(r.when.titleRegex) : null, _area: r.when.areaRegex ? new RegExp(r.when.areaRegex) : null }));
}
export function classify(item, compiled, ctx, overlayDept) {
  const o = overlayDept && overlayDept.get(item.id);
  if (o) return { department: o.value, ruleId: `overlay:${o.by}` };
  const area = item.baseline ? item.baseline.area : '';
  for (const r of compiled) {
    const w = r.when;
    if (w.idPrefix && !w.idPrefix.some((p) => item.id.startsWith(p))) continue;
    if (w.idIn && !w.idIn.includes(item.id)) continue;
    if (w.origin && !w.origin.includes(item.origin)) continue;
    if (w.dimension && !w.dimension.includes(item.dimension)) continue;
    if (w.notInWorkspace && ctx.workspaceMembers.has(item.id)) continue;
    if (w.workspaceIn && !w.workspaceIn.some((ws) => (ctx.workspaceOf.get(item.id) || []).includes(ws))) continue;
    if (r._title && !r._title.test(item.title || '')) continue;
    if (r._area && !r._area.test(area || '')) continue;
    if (w.areaPrefix && !w.areaPrefix.some((p) => String(area).startsWith(p))) continue;
    if (r.mapField) {
      const key = r.mapField === 'domain' ? ctx.domainOf(item) : null;
      const d = key ? r.map[key] : null;
      if (!d) continue;
      return { department: d, ruleId: r.id };
    }
    return { department: r.department, ruleId: r.id };
  }
  return { department: 'UNASSIGNED', ruleId: 'FALLBACK' };
}
export function workspaceIndex(baselineRows) {
  const members = new Set(), of = new Map();
  for (const r of baselineRows.filter((x) => x.id.startsWith('WS-SC-'))) {
    for (const m of String(r.screen_role_phase_ref).matchAll(/UI-\d{3}/g)) { members.add(m[0]); if (!of.has(m[0])) of.set(m[0], []); of.get(m[0]).push(r.id); }
  }
  return { workspaceMembers: members, workspaceOf: of };
}
