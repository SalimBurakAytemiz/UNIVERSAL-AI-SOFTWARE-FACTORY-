//TR: Kimlik modeli: 19 Ekim satırları, backlog, Wave 0 paketleri, kuyruk görevleri, lane teslimatları ve coordinatorBuild kayıtlarını tek kalem kümesinde birleştirir. Olaylar: ADDED (yeni kimlik + gerekçe), MERGED (kaynak kimlik mevcut kalemle aynı), RELATED (kaynak metni mevcut kimlik(ler)i anıyor: yeni kalem değil, bağlantı), REMOVED (yalnız overlay OBSOLETE), EXCLUDED (19 Ekim DUPLICATE/OBSOLETE). Roller ve değerlendirme spec'leri kalem olmaz.
import { canonicalId, knownIdScan, literalIdScan, isLiteralId } from '../core/ids.mjs';
import { cmp, uniqSorted } from '../core/canonical-json.mjs';
import { phaseId } from './roadmap.mjs';

const ORDER = ['BASELINE_2026_10_19', 'BACKLOG', 'WAVE0', 'QUEUE', 'DELIVERABLE', 'COORDINATOR_BUILD', 'OVERLAY'];

export function createResolver() {
  const items = new Set();            // canonical item ids
  const alias = new Map();            // alias -> Set(item ids)
  const literal = [];                 // ids without trailing digits (e.g. BL-REQ-REL-A)
  const keys = () => { const s = new Set(items); for (const k of alias.keys()) s.add(k); return s; };
  let keyCache = null;
  const api = {
    addItem(id) { items.add(id); keyCache = null; if (!/\d$/.test(id) && /^BL-REQ-/.test(id)) literal.push(id); },
    addAlias(a, ids) { if (items.has(a)) return; const s = alias.get(a) || new Set(); for (const i of ids) s.add(i); alias.set(a, s); keyCache = null; },
    has: (id) => items.has(id),
    targets(k) { if (items.has(k)) return [k]; return [...(alias.get(k) || [])].sort(cmp); },
    resolveText(text) { keyCache = keyCache || keys(); return uniqSorted(knownIdScan(text, keyCache, literal).flatMap((k) => api.targets(k))); },
    resolveTokens(tokens) {
      keyCache = keyCache || keys();
      const out = new Set();
      for (const t of tokens || []) {
        if (keyCache.has(t)) { for (const x of api.targets(t)) out.add(x); continue; }
        const segs = t.split('-');
        for (let i = 1; i < segs.length - 1; i++) { const c = segs.slice(i).join('-'); if (keyCache.has(c)) { for (const x of api.targets(c)) out.add(x); break; } }
      }
      return [...out].sort(cmp);
    },
    aliasEntries: () => [...alias.entries()].map(([a, s]) => [a, [...s].sort(cmp)]).sort((x, y) => cmp(x[0], y[0])),
    // exact-id match for ids that do not end in -<digits> (rules/link-patterns.json literalIdMatch); PR title/branch only
    resolveLiteral(text, mode) { keyCache = keyCache || keys(); return uniqSorted(literalIdScan(text, [...keyCache].filter(isLiteralId), mode).flatMap((k) => api.targets(k))); },
  };
  return api;
}

const parseLabPhases = (s) => {
  const m = /ROADMAP phases ([0-9,\s-]+)/.exec(String(s || ''));
  if (!m) return [];
  const out = [];
  for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
    const r = /^(\d+)-(\d+)$/.exec(part);
    if (r) { for (let i = Number(r[1]); i <= Number(r[2]); i++) out.push(i); }
    else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return [...new Set(out)].sort((a, b) => a - b);
};

export function buildIdentity({ baseline, roadmap, coordinator, dependencyMap, overlay }) {
  const res = createResolver();
  const items = new Map();
  const idEvents = [];
  const ev = (event, itemId, source, sourceId, reason) => idEvents.push({ event, itemId, source, sourceId, reason });
  const phaseByNum = new Map(roadmap.phases.map((p) => [p.phase, p]));
  const newItem = (id, base) => {
    const it = { id, title: '', description: null, dimension: null, origin: null, baseline: null, excluded: null, removed: null, records: [], aliases: [], priority: null, oct31: null, effort: null,
      executorRaw: null, owner: null, laneHint: null, dependsOnRaw: [], roadmapPhase: null, relatedPhases: [], ...base };
    items.set(id, it); res.addItem(id); return it;
  };

  // 1) baseline rows (roles are not work items)
  for (const r of baseline.filter((x) => !x.isRole)) {
    const it = newItem(r.id, { title: r.title, description: r.missing_functions, dimension: r.dimension, origin: 'BASELINE_2026_10_19', baseline: r, priority: r.priority, oct31: r.oct31, effort: r.effort, executorRaw: r.responsible_env_agent });
    if (r.status19 === 'DUPLICATE' || r.status19 === 'OBSOLETE') { it.excluded = r.status19; ev('EXCLUDED', r.id, 'BASELINE_2026_10_19', r.id, `19-Oct status ${r.status19}`); }
    if (r.id.startsWith('PH-')) it.roadmapPhase = Number(r.id.slice(3));
    if (r.id.startsWith('PT-')) { const ph = uniqSorted([...`${r.title} ${r.requirement_ref} ${r.screen_role_phase_ref} ${r.dependencies} ${r.backend_files_or_endpoints} ${r.frontend_files} ${r.area}`.matchAll(/PH-(\d{3})/g)].map((m) => Number(m[1]))); if (ph.length) { it.roadmapPhase = ph[0]; it.relatedPhases = ph.slice(1); } }
    if (r.id.startsWith('F-LAB-')) { const ph = parseLabPhases(r.screen_role_phase_ref); if (ph.length) { it.roadmapPhase = ph[0]; it.relatedPhases = ph.slice(1); } }
  }
  // dependsOn: PH from the DAG; PT from dependency-map (keystones expanded to resolvedBy)
  for (const p of roadmap.phases) { const it = items.get(p.id); if (it) it.dependsOnRaw.push(...p.dependsOn.map(phaseId)); }
  const ks = dependencyMap?.keystones || {};
  for (const e of dependencyMap?.edges || []) {
    if (e.type !== 'depends-on' || !items.has(e.from)) continue;
    if (/^K-/.test(e.to)) { for (const t of ks[e.to]?.resolvedBy || []) items.get(e.from).dependsOnRaw.push(t); }
    else items.get(e.from).dependsOnRaw.push(e.to);
  }

  const attach = (ids, rec) => { for (const i of ids) items.get(i).records.push(rec); };
  const relateOrAdd = (rawId, textForScan, source, mkItem, rec) => {
    const cid = canonicalId(rawId);
    if (res.has(cid)) { attach([cid], { ...rec, relation: 'MERGED' }); if (cid !== rawId) items.get(cid).aliases.push(rawId); ev('MERGED', cid, source, rawId, 'source id resolves to an existing item'); return [cid]; }
    const targets = res.resolveText(textForScan);
    if (targets.length) { attach(targets, { ...rec, relation: 'RELATED' }); res.addAlias(cid, targets); for (const t of targets) ev('RELATED', t, source, rawId, `source text cites ${t}`); return targets; }
    const it = mkItem(cid);
    it.records.push({ ...rec, relation: 'SELF' });
    if (cid !== rawId) { it.aliases.push(rawId); }
    ev('ADDED', cid, source, rawId, rec.reason || 'no inventory id');
    return [cid];
  };

  // 2) backlog (docs/planning/BACKLOG_CHECKPOINT.json)
  for (const t of coordinator.backlogTasks) {
    relateOrAdd(t.id, t.id, 'BACKLOG', (cid) => newItem(cid, { title: t.title, description: t.notes || null, dimension: 'backlog', origin: 'BACKLOG', owner: t.owner }),
      { kind: 'BACKLOG', ref: t.id, status: t.status, owner: t.owner, dependsOn: t.dependsOn, priority: t.priority ?? null, requiresNewAuthority: t.requiresNewAuthority === true, files: t.files ?? null, type: t.type ?? null, reason: `backlog id ${t.id} not in the 19-Oct inventory` });
  }
  // 3) Wave 0 packages
  for (const p of coordinator.wave0Packages) {
    relateOrAdd(p.id, p.id, 'WAVE0', (cid) => newItem(cid, { title: p.title, description: p.title, dimension: 'wave0-packages', origin: 'WAVE0', priority: p.priority }),
      { kind: 'WAVE0', ref: p.id, status: null, dependsOn: p.dependsOn, mvp: p.mvp === true, reason: 'Master V2 Wave 0 package (inputs/wave0-baseline.json)' });
  }
  // 4) queue tasks: id match -> MERGED; repair (-R<n>) -> repair record on the base task's items; source cites ids -> RELATED; else ADDED
  for (const t of coordinator.queueTasks) {
    const rec = { kind: 'QUEUE_TASK', ref: t.id, status: t.status, pr: t.pr, head: t.head, branch: t.branch, owner: t.owner, lane: t.lane, startedAt: t.startedAt, mvp: t.mvp === true, reason: 'queue task with no inventory id in its source' };
    const rm = /^(.*)-R\d+$/.exec(t.id);
    if (rm && !res.has(canonicalId(t.id))) {
      const targets = res.targets(canonicalId(rm[1]));
      if (targets.length) { attach(targets, { ...rec, kind: 'QUEUE_TASK_REPAIR', relation: 'RELATED' }); res.addAlias(canonicalId(t.id), targets); for (const x of targets) ev('RELATED', x, 'QUEUE', t.id, `repair of ${rm[1]}`); continue; }
    }
    relateOrAdd(t.id, t.source, 'QUEUE', (cid) => newItem(cid, { title: t.title || t.source, description: t.source || null, dimension: 'queue-tasks', origin: 'QUEUE', owner: t.owner, laneHint: t.lane }), rec);
  }
  // 5) lane deliverables
  for (const d of coordinator.deliverables) {
    relateOrAdd(d.key, d.key, 'DELIVERABLE', (cid) => newItem(cid, { title: d.key, description: d.note || null, dimension: 'lane-deliverables', origin: 'DELIVERABLE' }),
      { kind: 'DELIVERABLE', ref: d.key, status: d.status, pr: d.pr, head: d.head, branch: d.branch, reason: 'lane deliverable with no inventory id' });
  }
  // 6) coordinatorBuild entries
  for (const d of coordinator.coordinatorBuild) {
    relateOrAdd(d.key, d.key, 'COORDINATOR_BUILD', (cid) => newItem(cid, { title: d.key, description: d.note || null, dimension: 'coordinator-build', origin: 'COORDINATOR_BUILD', owner: d.owner }),
      { kind: 'COORDINATOR_BUILD', ref: d.key, status: d.status, pr: d.pr, head: d.head, branch: d.branch, owner: d.owner, reason: 'coordinatorBuild entry with no inventory id' });
  }
  // 7) overlay ALIAS / OBSOLETE (validated upstream)
  for (const o of overlay.accepted.filter((x) => x.action === 'ALIAS' && items.has(x.itemId))) { res.addAlias(canonicalId(o.value), [o.itemId]); items.get(o.itemId).aliases.push(o.value); ev('MERGED', o.itemId, 'OVERLAY', o.value, o.reason); }
  for (const o of overlay.accepted.filter((x) => x.action === 'OBSOLETE' && items.has(x.itemId))) { const it = items.get(o.itemId); if (!it.excluded) { it.removed = { reason: o.reason, by: o.by, at: o.at }; ev('REMOVED', o.itemId, 'OVERLAY', o.itemId, o.reason); } }

  // record-level dependsOn (backlog / wave0) -> item ids
  for (const it of items.values()) {
    for (const r of it.records) for (const d of r.dependsOn || []) it.dependsOnRaw.push(...res.resolveText(String(d)));
    it.dependsOn = uniqSorted(it.dependsOnRaw.filter((x) => items.has(x) && x !== it.id));
    it.aliases = uniqSorted(it.aliases);
    delete it.dependsOnRaw;
  }
  idEvents.sort((a, b) => cmp(a.itemId, b.itemId) || ORDER.indexOf(a.source) - ORDER.indexOf(b.source) || cmp(a.event, b.event) || cmp(a.sourceId, b.sourceId));
  return { items: [...items.values()].sort((a, b) => cmp(a.id, b.id)), idEvents, resolver: res, phaseByNum };
}
