//TR: Geçmiş: önceki anlık görüntüyle alan düzeyinde fark (eklenen/çıkarılan/değişen kalemler ve metrik farkları) ve son 30 günlük trend noktaları. Eksik günler MISSING olarak işaretlenir. Aynı içerik farklı sırayla verilirse fark boştur.
import { cmp } from '../core/canonical-json.mjs';
import { addDays } from '../core/time.mjs';

const FIELDS = ['status', 'reconClass', 'scope', 'department'];
const SUBS = ['coded', 'integrated', 'tested', 'runtimeVerified', 'accepted'];
const flat = (o, p = '', out = {}) => { for (const k of Object.keys(o || {}).sort(cmp)) { const v = o[k]; const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else if (typeof v === 'number') out[key] = v; } return out; };

// snapshot = { items: [{id, status, reconClass, scope, department, substeps, links}], metrics: {...numbers} }
export function diffSnapshots(prev, cur) {
  const P = new Map((prev?.items || []).map((x) => [x.id, x])), C = new Map((cur?.items || []).map((x) => [x.id, x]));
  const addedItems = [...C.keys()].filter((k) => !P.has(k)).sort(cmp);
  const removedItems = [...P.keys()].filter((k) => !C.has(k)).sort(cmp);
  const changedItems = [];
  for (const id of [...C.keys()].filter((k) => P.has(k)).sort(cmp)) {
    const a = P.get(id), b = C.get(id), ch = [];
    for (const f of FIELDS) if (a[f] !== undefined && b[f] !== undefined && a[f] !== b[f]) ch.push({ field: f, prev: a[f], cur: b[f] });
    if (a.substeps && b.substeps) for (const s of SUBS) if (a.substeps[s] !== undefined && a.substeps[s] !== b.substeps[s]) ch.push({ field: `substeps.${s}`, prev: a.substeps[s], cur: b.substeps[s] });
    if (Array.isArray(a.links) && Array.isArray(b.links)) { const x = [...a.links].sort(cmp).join(','), y = [...b.links].sort(cmp).join(','); if (x !== y) ch.push({ field: 'links', prev: a.links.length, cur: b.links.length }); }
    if (ch.length) changedItems.push({ id, changes: ch });
  }
  const pm = flat(prev?.metrics), cm = flat(cur?.metrics);
  const metricDeltas = {};
  for (const k of [...new Set([...Object.keys(pm), ...Object.keys(cm)])].sort(cmp)) if (k in pm && k in cm && pm[k] !== cm[k]) metricDeltas[k] = { prev: pm[k], cur: cm[k], delta: Math.round((cm[k] - pm[k]) * 1000) / 1000 };
  return { addedItems, removedItems, changedItems, metricDeltas, counts: { added: addedItems.length, removed: removedItems.length, changed: changedItems.length, metricDeltas: Object.keys(metricDeltas).length } };
}

export function trend(points, today, days = 30) {
  const byDate = new Map();
  for (const p of points) { const prev = byDate.get(p.date); if (!prev || cmp(prev.generatedAt || '', p.generatedAt || '') < 0) byDate.set(p.date, p); }
  const dates = [...byDate.keys()].sort(cmp);
  const first = dates.length ? (dates[0] > addDays(today, -(days - 1)) ? dates[0] : addDays(today, -(days - 1))) : today;
  const out = [];
  for (let d = first; d <= today; d = addDays(d, 1)) out.push(byDate.get(d) || { date: d, state: 'MISSING' });
  return out;
}
