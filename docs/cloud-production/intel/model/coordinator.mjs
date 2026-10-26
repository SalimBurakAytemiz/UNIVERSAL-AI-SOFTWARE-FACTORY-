//TR: Koordinatör kayıtlarını (PRODUCTION-QUEUE, COORD-LEDGER, dispatch, Wave 0, backlog, LANES) saf olarak normalize eder. Kayıtlardaki durum alanları KANIT DEĞİLDİR; yalnız bağlam ve bağlantı (PR numarası, dal başı) sağlar. Kimliği olmayan founderQueue kayıtlarına metin özetinden türetilmiş kimlik verilir.
import { synthId, prRefs } from '../core/ids.mjs';
import { cmp } from '../core/canonical-json.mjs';

const textOf = (f) => String(f.action ?? f.item ?? f.text ?? '');
// Longest ASCII-safe prefix (no quote/backslash/control/non-ASCII) of at least 12 chars, used as a git pickaxe literal.
export function asciiLiteral(text, max = 56) {
  const m = /^[ -!#-[\]-~]+/.exec(String(text ?? ''));
  const s = m ? m[0].slice(0, max).trimEnd() : '';
  return s.length >= 12 ? s : null;
}
export const founderQueueId = (f) => f.id || synthId('FQ', `${textOf(f)} | ${f.why ?? ''}`);

export function decisionLiterals(queue, wave0) {
  const out = [];
  for (const f of queue?.founderQueue || []) out.push({ id: founderQueueId(f), literal: asciiLiteral(textOf(f)), paths: ['docs/cloud-production/PRODUCTION-QUEUE.json'] });
  for (const d of queue?.integrationQueue?.founderDecisions || []) { const m = /^(D\d+)\b/.exec(d); if (m) out.push({ id: m[1], literal: asciiLiteral(d), paths: ['docs/cloud-production/PRODUCTION-QUEUE.json'] }); }
  for (const d of wave0?.founderDecisions || []) { const m = /^(FD-\d+)\b/.exec(d); if (m) out.push({ id: m[1], literal: asciiLiteral(d), paths: ['docs/cloud-production/dispatch'] }); }
  return out;
}

const SHA = /^[0-9a-f]{7,40}$/;
const headOf = (v) => { const m = /^([0-9a-f]{7,40})\b/.exec(String(v ?? '')); return m ? m[1] : null; };
export function headRefsOf(queue) {
  const out = new Set();
  for (const t of queue?.tasks || []) for (const k of ['finalSha', 'head', 'claimSha']) { const h = headOf(t[k]); if (h) out.add(h); }
  for (const d of Object.values(queue?.productionLanes?.deliverables || {})) { const h = headOf(d.head); if (h) out.add(h); }
  for (const d of Object.values(queue?.coordinatorBuild || {})) { const h = headOf(d.head); if (h) out.add(h); }
  return [...out].sort(cmp);
}
const prNum = (v) => { if (typeof v === 'number') return v; const m = /^\s*#?(\d{1,5})\b/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };

export function loadCoordinator({ queue, ledger, dispatch, wave0, backlog, lanesJson, queueHistory }) {
  const q = queue || {};
  const queueTasks = [...(q.tasks || [])].sort((a, b) => cmp(String(a.id), String(b.id))).map((t) => ({
    id: t.id, source: String(t.source ?? ''), title: String(t.title ?? ''), status: t.status, lane: t.lane ?? null, owner: t.owner ?? null, branch: t.branch ?? null,
    pr: prNum(t.pr), head: headOf(t.finalSha) || headOf(t.head), startedAt: t.startedAt ?? null, integration: t.integration ?? null,
  }));
  const deliverables = Object.entries(q.productionLanes?.deliverables || {}).map(([key, d]) => ({
    key, pr: prNum(d.pr), prText: String(d.pr ?? ''), branch: d.branch ?? null, head: headOf(d.head), status: d.status ?? null, verifiedAt: d.verifiedAt ?? null, note: String(d.note ?? ''),
  })).sort((a, b) => cmp(a.key, b.key));
  const coordinatorBuild = Object.entries(q.coordinatorBuild || {}).map(([key, d]) => ({
    key, pr: prNum(d.pr), branch: d.branch ?? null, head: headOf(d.head), status: d.status ?? null, owner: d.owner ?? null, note: String(d.note ?? ''),
  })).sort((a, b) => cmp(a.key, b.key));
  const founderQueue = (q.founderQueue || []).map((f) => ({ id: founderQueueId(f), synthesized: !f.id, text: textOf(f), why: f.why ?? null, priority: f.priority ?? null, kind: f.kind ?? null }));
  const integrationDecisions = (q.integrationQueue?.founderDecisions || []).map((d) => { const m = /^(D\d+)\b/.exec(d); return m ? { id: m[1], text: d } : null; }).filter(Boolean);
  const wave0Packages = [...(wave0?.packages || [])].sort((a, b) => cmp(String(a.id), String(b.id))).map((p) => ({ id: p.id, priority: p.priority ?? null, order: p.order ?? null, title: String(p.title ?? ''), dependsOn: Array.isArray(p.dependsOn) ? p.dependsOn.map(String) : [] }));
  const wave0FounderDecisions = (wave0?.founderDecisions || []).map((d) => { const m = /^(FD-\d+)\b/.exec(d); return m ? { id: m[1], text: d } : null; }).filter(Boolean);
  const ib = q.integrationBoard || {};
  const backlogTasks = [...(backlog?.tasks || [])].sort((a, b) => cmp(String(a.id), String(b.id))).map((t) => ({ id: t.id, title: String(t.title ?? ''), status: t.status, owner: t.owner ?? null, dependsOn: t.dependsOn || [], notes: String(t.notes ?? ''), package: t.package ?? null }));
  return {
    queueTasks, deliverables, coordinatorBuild, founderQueue, integrationDecisions, wave0Packages, wave0FounderDecisions,
    autoMergeEvidence: (q.autoMergeEvidence || []).map((x) => ({ pr: prNum(x.pr), mergeCommit: x.mergeCommit ?? null, mergedAt: x.mergedAt ?? null })),
    integrationBoard: { merges: (ib.merges || []).map((m) => ({ pr: prNum(m.pr), merge: m.merge ?? null, at: m.at ?? null, postMerge: String(m.postMerge ?? ''), by: m.by ?? null })), prs: (ib.prs || []).map((p) => ({ pr: prNum(p.pr), owner: p.owner ?? null, kind: p.kind ?? null, state: String(p.state ?? '') })) },
    ledgerReviews: (ledger?.reviews || []).map((r) => ({ pr: r.pr, sha: r.sha, kind: r.kind, verdict: r.verdict, at: r.at })),
    backlogTasks,
    capacity: { queueBuilderCap: q.builderCap ?? null, queueMaxOpenPrs: q.maxOpenPrs ?? null, lanesBuilderCap: lanesJson?.capacity?.builderCap ?? null, sources: { queueBuilderCap: 'PRODUCTION-QUEUE.json builderCap', queueMaxOpenPrs: 'PRODUCTION-QUEUE.json maxOpenPrs', lanesBuilderCap: 'docs/planning/LANES.json capacity.builderCap' } },
    productionLanesStartedAt: q.productionLanes?.startedAt ?? null,
    dispatchTexts: dispatch || {},
    queueHistory: [...(queueHistory || [])].sort((a, b) => cmp(a.at, b.at) || cmp(a.sha, b.sha)),
    queueText: JSON.stringify(q),
    ledgerText: JSON.stringify(ledger || {}),
    prNum,
  };
}
export { prNum, prRefs, SHA };
