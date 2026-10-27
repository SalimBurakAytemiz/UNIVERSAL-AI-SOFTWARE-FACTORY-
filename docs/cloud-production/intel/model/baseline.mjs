//TR: 19 Ekim envanterini (JSON + CSV, sabitlenmiş blob'lar) yükler; remaining-work.mjs v0 reconcile() kuralının DONDURULMUŞ kopyasını (v0 çapası) ve her satır için tek bir baselineClass üretir. Kanıt modeli için serbest metin 'prs' alanını tipli referanslara ayırır (tekil / aralık / iç içe / rol notlu / başka kaleme atanmış); yalnız notsuz tekil, başka bilinen kalemi adlandırmayan ve kimlik kapısından geçen referans EXPLICIT'tir, gerisi WEAK. Roller (E-ROLE) iş kalemi değildir.
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
  const nums = [...String(row.prs || '').matchAll(/#(\d{1,4})/g)].map((m) => Number(m[1])).filter((n) => prMap.has(n));
  return classOfPrs(row, nums.map((n) => prMap.get(n)));
}
// Same ladder over an explicit PR list (the evidence model passes only EXPLICIT inventory references; the v0 view passes every #N).
export function classOfPrs(row, st) {
  if (row.status19 === 'DUPLICATE') return 'EXCLUDED_DUPLICATE';
  if (row.status19 === 'OBSOLETE') return 'EXCLUDED_OBSOLETE';
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

// ---- Typed parse of the 19-Oct free-text `prs` field (the v0 regex above stays frozen for the legacy view).
// Each #N becomes { n, form: SINGLE|RANGE, nested, role, segment }:
//  - segments are split on ';' outside () and [];
//  - a #N inside () or [] is NESTED (it describes another PR inside an annotation);
//  - #A-#B is a RANGE (expanded to its members, span <= maxRangeSpan);
//  - refs separated only by ',', '+', '/', '&', spaces share the annotation that follows the last of them;
//  - the annotation is the text after the ref (or group) up to the next top-level ref, with [..] review notes removed and the
//    part of a parenthetical from a nested #N onwards removed; the segment prefix (text before its first ref) applies to every ref;
//  - role = first match of rules/link-patterns.json inventoryPrs.roleAnnotationRegex in prefix + annotation (consumer, relies on, ...).
export function parseInventoryPrs(text, P) {
  const s = String(text ?? '');
  const roleRe = new RegExp(P.roleAnnotationRegex, 'i');
  const groupSep = new RegExp(P.groupSeparatorRegex);
  const maxSpan = P.maxRangeSpan;
  const segs = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(' || ch === '[') depth++; else if ((ch === ')' || ch === ']') && depth > 0) depth--; if (ch === ';' && depth === 0) { segs.push(cur); cur = ''; } else cur += ch; }
  segs.push(cur);
  const out = [];
  for (const seg of segs) {
    const depthAt = []; let d = 0;
    for (let i = 0; i < seg.length; i++) { depthAt[i] = d; const ch = seg[i]; if (ch === '(' || ch === '[') d++; else if ((ch === ')' || ch === ']') && d > 0) d--; }
    const refs = [];
    for (const m of seg.matchAll(/#(\d{1,4})(?:\s*[-\u2013]\s*#?(\d{1,4}))?(?!\d)/g)) {
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
      refs.push({ a, b: b !== null && b > a && b - a <= maxSpan ? b : null, start: m.index, end: m.index + m[0].length, nested: depthAt[m.index] > 0 });
    }
    // annotation text with nested-ref clauses and [..] notes removed
    const clean = (from, to) => {
      let t = '';
      for (let i = from; i < to; i++) {
        if (seg[i] === '[') { let k = i, dd = 0; for (; k < seg.length; k++) { if (seg[k] === '[') dd++; else if (seg[k] === ']') { dd--; if (dd === 0) break; } } i = k; continue; }
        const nr = refs.find((r) => r.nested && r.start === i);
        if (nr) { const base = depthAt[i]; let k = i; for (; k < seg.length; k++) { if ((seg[k] === ')' || seg[k] === ']') && depthAt[k] === base) break; } i = k - 1; continue; }
        t += seg[i];
      }
      return t;
    };
    const top = refs.filter((r) => !r.nested);
    const prefix = top.length ? clean(0, top[0].start) : '';
    for (let i = 0; i < top.length; i++) {
      let j = i;
      while (j < top.length - 1 && groupSep.test(clean(top[j].end, top[j + 1].start))) j++;
      const ann = clean(top[j].end, j + 1 < top.length ? top[j + 1].start : seg.length);
      const rm = roleRe.exec(`${prefix} ${ann}`);
      top[i].role = rm ? rm[0].toLowerCase() : null;
      top[i].annotation = `${prefix} ${ann}`.replace(/\s+/g, ' ').trim();
    }
    for (const r of refs) {
      const role = r.nested ? 'nested' : r.role;
      const nums = r.b !== null ? Array.from({ length: r.b - r.a + 1 }, (_, k) => r.a + k) : [r.a];
      for (const n of nums) out.push({ n, form: r.b !== null ? 'RANGE' : 'SINGLE', range: r.b !== null ? `#${r.a}-#${r.b}` : null, nested: r.nested, role, annotation: r.nested ? null : (r.annotation ?? ''), segment: seg.trim().slice(0, 120) });
    }
  }
  return out;
}
// Per PR number: EXPLICIT when at least one SINGLE, non-nested, role-free reference exists whose annotation does not assign the PR to
// another known item (otherItemOf(n, annotation) -> that item's id or null) AND the gate holds (PR title/branch/body names the item, the
// item's own 19-Oct title names the PR, or the 19-Oct status already claims merged/integrated); otherwise WEAK with the first reason found
// ('other-item:<ID>' when the annotation names another item). Unknown PR numbers are dropped.
export function inventoryPrRefs(row, prMap, P, gate, otherItemOf = () => null) {
  const byN = new Map();
  for (const r of parseInventoryPrs(row.prs, P)) { if (!prMap.has(r.n)) continue; if (!byN.has(r.n)) byN.set(r.n, []); byN.get(r.n).push(r); }
  const out = [];
  for (const [n, rs] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
    const plain = rs.filter((r) => r.form === 'SINGLE' && !r.nested && !r.role);
    const other = plain.map((r) => otherItemOf(n, r.annotation || '')).find(Boolean) || null;
    const cand = plain.find((r) => !otherItemOf(n, r.annotation || ''));
    const g = cand ? gate(n) : null;
    if (cand && g) out.push({ n, strength: 'EXPLICIT', gate: g, reason: null });
    else {
      const r0 = rs.find((r) => r.form === 'RANGE') || rs.find((r) => r.nested) || rs.find((r) => r.role) || rs[0];
      const reason = cand ? 'no-id-match' : other ? `other-item:${other}` : r0.form === 'RANGE' ? `range ${r0.range}` : r0.nested ? 'nested' : `role:${r0.role}`;
      out.push({ n, strength: 'WEAK', gate: null, reason });
    }
  }
  return out;
}

export function partition(rows, keyFn, scopeFn) {
  const classes = [...new Set(rows.map(keyFn))].sort(cmp);
  const full = tally(rows, keyFn, classes), mvp = tally(rows.filter((r) => scopeFn(r) === 'MVP'), keyFn, classes);
  return { classes, full, mvp, totalFull: rows.length, totalMvp: rows.filter((r) => scopeFn(r) === 'MVP').length };
}
