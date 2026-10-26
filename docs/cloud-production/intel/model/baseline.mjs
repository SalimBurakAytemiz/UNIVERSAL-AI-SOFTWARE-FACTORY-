//TR: 19 Ekim envanterini (JSON + CSV, sabitlenmiş blob'lar) yükler; remaining-work.mjs v0 reconcile() kuralının DONDURULMUŞ kopyasını (v0 çapası) ve her satır için tek bir baselineClass üretir. Roller (E-ROLE) iş kalemi değildir.
import { parseCsvRecords } from '../core/csv.mjs';
import { cmp, tally } from '../core/canonical-json.mjs';

const ROLE = (id) => String(id).startsWith('E-ROLE');
export function loadBaseline(csvText, invJson) {
  const recs = new Map(parseCsvRecords(csvText).map((r) => [r.id, r]));
  const rows = [];
  for (const x of invJson?.items || []) {
    const c = recs.get(x.id) || {};
    rows.push({
      id: x.id, dimension: x.dimension, title: x.title ?? c.title ?? '', area: c.area ?? '', requirement_ref: c.requirement_ref ?? '', screen_role_phase_ref: c.screen_role_phase_ref ?? '',
      frontend_files: c.frontend_files ?? '', backend_files_or_endpoints: c.backend_files_or_endpoints ?? '', prs: String(x.prs ?? c.prs ?? ''), status19: x.status, priority: x.priority ?? c.priority ?? null,
      effort: c.effort || null, confidence: c.confidence || null, oct31: x.oct31_impact ?? c.oct31_impact ?? null, product_verified: x.product_verified ?? c.product_verified ?? null,
      missing_functions: c.missing_functions || null, dependencies: c.dependencies || '', responsible_env_agent: c.responsible_env_agent || '', isRole: ROLE(x.id), inCsv: recs.has(x.id),
    });
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---- Frozen v0 anchor: exact copy of reports/local/remaining-work.mjs (2026-10-26) MAP + reconcile() + summarize().
export const V0_MAP = Object.freeze({ AUTHORITY_REQUIRED: 'FOUNDER_ACTION_REQUIRED', BLOCKED: 'BLOCKED', NOT_STARTED: 'NOT_STARTED', DESIGN_ONLY: 'NOT_STARTED', IN_PROGRESS: 'IN_PROGRESS', OBSOLETE: 'OBSOLETE', DUPLICATE: 'DUPLICATE', INTEGRATED_NOT_VERIFIED: 'MERGED_NOT_VERIFIED', MERGED_NOT_INTEGRATED: 'MERGED_NOT_VERIFIED', IMPLEMENTED_NOT_TESTED: 'IMPLEMENTED_NOT_MERGED', PENDING_CI: 'UNKNOWN', PENDING_REVIEW: 'UNKNOWN' });
// prMap: Map number -> {state, merged_at|mergedAt}
const mergedOf = (p) => p.merged_at ?? p.mergedAt ?? null;
export function legacyReconcile(x, prMap) {
  const nums = [...String(x.prs || '').matchAll(/#(\d{1,4})/g)].map((m) => Number(m[1])).filter((n) => prMap.has(n));
  const st = nums.map((n) => prMap.get(n)); const flags = [];
  let s;
  if (x.status19 === 'DUPLICATE' || x.status19 === 'OBSOLETE') s = V0_MAP[x.status19];
  else if (String(x.product_verified).toUpperCase() === 'YES') s = 'COMPLETED_AND_VERIFIED';
  else if (st.some((p) => p.state === 'open')) s = 'IMPLEMENTED_NOT_MERGED';
  else if (st.length && st.every((p) => mergedOf(p))) s = 'MERGED_NOT_VERIFIED';
  else if (st.some((p) => mergedOf(p))) { s = 'MERGED_NOT_VERIFIED'; flags.push('PARTIAL_PR_SET_MERGED'); }
  else if (st.length) { s = 'UNKNOWN'; flags.push('LINKED_PRS_CLOSED_UNMERGED'); }
  else { s = V0_MAP[x.status19] || 'UNKNOWN'; flags.push('STALE_SINCE_2026-10-19'); }
  if (x.status19 === 'AUTHORITY_REQUIRED' && s !== 'FOUNDER_ACTION_REQUIRED') flags.push('FOUNDER_FLAG');
  return { id: x.id, dimension: x.dimension, priority: x.priority, oct31: x.oct31, hist: x.status19, now: s, prs: nums, flags };
}
export function legacyView(baselineRows, prMap) {
  const rows = baselineRows.map((x) => legacyReconcile(x, prMap));
  const t = (xs) => xs.reduce((a, x) => (a[x.now] = (a[x.now] || 0) + 1, a), {});
  const live = (xs) => xs.filter((r) => !['DUPLICATE', 'OBSOLETE'].includes(r.now));
  const summarize = (xs) => { const l = live(xs); const tt = t(l); const done = tt.COMPLETED_AND_VERIFIED || 0;
    return { rows: xs.length, unique: xs.filter((r) => r.now !== 'DUPLICATE').length, live: l.length, byStatus: tt, verifiedCompleted: done, remainingIncludingVerification: l.length - done, mergedNotVerified: tt.MERGED_NOT_VERIFIED || 0, stale: l.filter((r) => r.flags.includes('STALE_SINCE_2026-10-19')).length,
      mvpScope_AT_RISK: l.filter((r) => r.oct31 === 'AT_RISK').length, deferrable_NOT_DELIVERABLE_or_NONE: l.filter((r) => r.oct31 !== 'AT_RISK').length }; };
  const work = rows.filter((r) => r.dimension !== 'roles');
  const dims = [...new Set(work.map((r) => r.dimension))];
  const allWork = summarize(work);
  return {
    rule: 'reports/local/remaining-work.mjs v0 reconcile() (2026-10-26), frozen copy',
    allWorkDimensions: allWork, uniqueTasks_PT: summarize(work.filter((r) => r.dimension === 'tasks')),
    byDimension: Object.fromEntries(dims.map((d) => [d, summarize(work.filter((r) => r.dimension === d))])),
    UNRECONCILED_WORK: live(work).filter((r) => r.now === 'UNKNOWN' || r.flags.includes('STALE_SINCE_2026-10-19')).length,
    VERIFICATION_PENDING_MERGED: allWork.mergedNotVerified,
    rows: work,
  };
}

export const BASELINE_CLASSES = ['PR_MERGED_ALL', 'PR_MERGED_PARTIAL', 'STALE_STATUS_SAYS_MERGED', 'PR_CLOSED_UNMERGED_ONLY', 'PR_OPEN', 'STALE_FOUNDER', 'STALE_NOT_STARTED', 'STALE_IN_PROGRESS', 'STALE_IMPLEMENTED_NOT_TESTED', 'STALE_BLOCKED', 'STALE_PENDING', 'STALE_OTHER', 'EXCLUDED_DUPLICATE', 'EXCLUDED_OBSOLETE'];
export function baselineClass(row, prMap) {
  if (row.status19 === 'DUPLICATE') return 'EXCLUDED_DUPLICATE';
  if (row.status19 === 'OBSOLETE') return 'EXCLUDED_OBSOLETE';
  const nums = [...String(row.prs || '').matchAll(/#(\d{1,4})/g)].map((m) => Number(m[1])).filter((n) => prMap.has(n));
  const st = nums.map((n) => prMap.get(n));
  if (st.some((p) => p.state === 'open')) return 'PR_OPEN';
  if (st.length && st.every((p) => mergedOf(p))) return 'PR_MERGED_ALL';
  if (st.some((p) => mergedOf(p))) return 'PR_MERGED_PARTIAL';
  if (st.length) return 'PR_CLOSED_UNMERGED_ONLY';
  switch (row.status19) {
    case 'INTEGRATED_NOT_VERIFIED': case 'MERGED_NOT_INTEGRATED': return 'STALE_STATUS_SAYS_MERGED';
    case 'AUTHORITY_REQUIRED': return 'STALE_FOUNDER';
    case 'DESIGN_ONLY': case 'NOT_STARTED': return 'STALE_NOT_STARTED';
    case 'IN_PROGRESS': return 'STALE_IN_PROGRESS';
    case 'IMPLEMENTED_NOT_TESTED': return 'STALE_IMPLEMENTED_NOT_TESTED';
    case 'BLOCKED': return 'STALE_BLOCKED';
    case 'PENDING_CI': case 'PENDING_REVIEW': return 'STALE_PENDING';
    default: return 'STALE_OTHER';
  }
}
export const inventoryPrNums = (row, prMap) => [...new Set([...String(row.prs || '').matchAll(/#(\d{1,4})/g)].map((m) => Number(m[1])).filter((n) => prMap.has(n)))].sort((a, b) => a - b);

export function partition(rows, keyFn, scopeFn) {
  const classes = [...new Set(rows.map(keyFn))].sort(cmp);
  const full = tally(rows, keyFn, classes), mvp = tally(rows.filter((r) => scopeFn(r) === 'MVP'), keyFn, classes);
  return { classes, full, mvp, totalFull: rows.length, totalMvp: rows.filter((r) => scopeFn(r) === 'MVP').length };
}
