//TR: P3 departman kanıtı (ağsız): FULL ve MVP için her durum ve her metrik sayısının departmanlar (UNASSIGNED dahil) üzerinden toplamı toplama eşittir; her ruleId kurallarda vardır; eşleşmeyen kalem UNASSIGNED'a düşer; bir kural silinince dağılım değişir ama toplamlar korunur. Gerçek 19 Ekim envanterinde (sabitlenmiş blob) 741 kalem 12 departmana tam dağılır.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { miniBundle } from '../fixtures/mini/bundle.mjs';
import { loadRules } from '../lib/gather.mjs';
import { buildAll } from './pipeline.mjs';
import { compileRules, classify, workspaceIndex } from './departments.mjs';
import { loadBaseline } from './baseline.mjs';
import { STATUSES } from '../metrics/metrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const { rules } = loadRules(path.join(HERE, '..'));
const sums = (m) => {
  const bad = [];
  for (const sel of ['full', 'mvp', 'baseline741']) {
    const tot = sel === 'full' ? m.metrics.full : sel === 'mvp' ? m.metrics.mvp : m.metrics.baseline741;
    for (const s of STATUSES) if (m.metrics.byDepartment.reduce((a, d) => a + d[sel].statusCounts[s], 0) !== tot.statusCounts[s]) bad.push(`${sel}.${s}`);
    for (const k of ['coded', 'integrated', 'tested', 'runtimeVerified', 'accepted']) for (const v of ['TRUE', 'FALSE', 'UNKNOWN']) if (m.metrics.byDepartment.reduce((a, d) => a + d[sel].substeps[k][v], 0) !== tot.substeps[k][v]) bad.push(`${sel}.${k}.${v}`);
    if (m.metrics.byDepartment.reduce((a, d) => a + d[sel].n, 0) !== tot.n) bad.push(`${sel}.n`);
    if (m.metrics.byDepartment.reduce((a, d) => a + d[sel].unreconciled, 0) !== tot.unreconciled) bad.push(`${sel}.unreconciled`);
  }
  return bad;
};
const b = miniBundle();
const m = buildAll(b.inputs, rules, b.overlay, b.meta, b.nowIso);
check('mini: department sums equal totals (FULL, MVP, baseline; statuses and substeps)', sums(m).length === 0);
check('mini: invariant flag in dataQuality is ok', m.dataQuality.departmentInvariant.ok === true);
const ruleIds = new Set([...rules.departments.rules.map((r) => r.id), 'FALLBACK']);
check('every departmentRule on an item exists in rules/departments.json', m.items.every((x) => ruleIds.has(x.departmentRule) || String(x.departmentRule).startsWith('overlay:')));
check('every department is one of the Founder list', m.items.every((x) => rules.departments.departments.some((d) => d.id === x.department)));
check('unmatched items land in UNASSIGNED (BL-REQ-DEV, PH-004 BUSINESS_COMMUNICATION, PQ-001)', ['BL-REQ-DEV', 'PH-004', 'PQ-001'].every((id) => m.items.find((x) => x.id === id).department === 'UNASSIGNED'));
check('R01: a UI screen outside every WS-SC member list is MOBILE', m.items.find((x) => x.id === 'UI-018').department === 'MOBILE' && m.items.find((x) => x.id === 'UI-018').departmentRule === 'R01');
check('R14: PH by contract domain (TRUST_CORE -> COORDINATOR_GOVERNANCE, EXECUTION -> AI_AGENT_WORKFLOW)', m.items.find((x) => x.id === 'PH-000').department === 'COORDINATOR_GOVERNANCE' && m.items.find((x) => x.id === 'PH-003').department === 'AI_AGENT_WORKFLOW');
check('R12 before R14: PH Game -> GAMING_STUDIO', m.items.find((x) => x.id === 'PH-002').department === 'GAMING_STUDIO');
// delete a rule: distribution changes, sums hold
const cut = JSON.parse(JSON.stringify(rules));
cut.departments.rules = cut.departments.rules.filter((r) => r.id !== 'R02');
const m2 = buildAll(b.inputs, cut, b.overlay, b.meta, b.nowIso);
const dist = (mm) => JSON.stringify(mm.metrics.byDepartment.map((d) => [d.department, d.full.n]));
check('deleting R02 changes the distribution', dist(m2) !== dist(m));
check('deleting R02 keeps the sums', sums(m2).length === 0 && m2.metrics.full.n === m.metrics.full.n);
// real inventory (pinned blobs, local git objects; a missing blob is a FAIL, never a skip)
const repo = process.env.INTEL_REPO || path.join(HERE, '..');
const blob = (id) => { try { return execFileSync('git', ['-C', repo, 'cat-file', 'blob', id], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return null; } };
const invT = blob(rules.sources.inventory.jsonBlob), csvT = blob(rules.sources.inventory.csvBlob);
check('real 19-Oct inventory blobs are readable locally', !!invT && !!csvT);
if (invT && csvT) {
  const rows = loadBaseline(csvT, JSON.parse(invT)).filter((r) => !r.isRole && !['DUPLICATE', 'OBSOLETE'].includes(r.status19));
  const comp = compileRules(rules.departments);
  const ws = workspaceIndex(rows);
  const items = rows.map((r) => ({ id: r.id, title: r.title, baseline: r, origin: 'BASELINE_2026_10_19', dimension: r.dimension, roadmapPhase: r.id.startsWith('PH-') ? Number(r.id.slice(3)) : null }));
  const counts = {}; for (const it of items) { const d = classify(it, comp, { ...ws, domainOf: (x) => String(x.baseline.area).split(' / ')[0] }).department; counts[d] = (counts[d] || 0) + 1; }
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  check(`real baseline: 741 live rows classified into departments (sum ${total})`, total === 741 && rows.length === 741);
  check(`real baseline: R13b moves the 6 STUDIOS phases out of UNASSIGNED (UNASSIGNED ${counts.UNASSIGNED})`, counts.UNASSIGNED === 39);
}
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
