//TR: Kanıt merdiveni (coded -> integrated -> tested -> runtimeVerified -> accepted) ve durum önceliği. 19 Ekim 'prs' metni yalnız EXPLICIT referanslarla sınıf belirler; PR sahiplik kuralı (model/links.mjs): integratedBy, integratedPrs, strongPrs, gerçek başlangıç, lastMergedAt, tested/CI ve coded'a yalnız kalemin KENDİ (OWN/SHARED) PR'ı veya kapıdan geçen UNASSIGNED PR girer; OTHER_ITEM ve WEAK referanslar hiçbir basamağa girmez (merge iddialı satırda yalnız corroboratingWeakPrs olarak listelenir, kanıt değildir); başlık/harita çatışmalı PR'a dayanan kalemin güveni en çok MEDIUM'dur ve ownershipNotes taşır; kayıt tutma PR'ı (BOOKKEEPING_PR: backlog write-back, planlama, READY işaretleme) ve kayıt tutma commit'i hiçbir basamakta kanıt değildir; kısmen merge edilmiş EXPLICIT PR kümesi önce bağımsız kanıtla (kayıt/overlay/başlık/dal PR'ı, v7'deki kayıt başı, merge iddiasında commit/route) aranır, yoksa integrated=PARTIAL'dır. Gerçek başlangıç yalnız kalemin kendi kanıtından: güçlü PR (kayıt tutma PR'ları hariç), kodlanmış kalemin konu başı kimliği adlandıran kendi commit'i (backlog/planlama kayıt commit'leri hariç), kanıt merdiveninin entegrasyon kanıtı olarak kabul ettiği commit ve kodlanmış kalemin kayıt başı. runtimeVerified ölçüm kaynağı olmadığı için NOT_MEASURED'dır. İlk doğru kural kazanır: OBSOLETE, COMPLETED_AND_VERIFIED (çözümlenen kabul kanıtı), MERGED_NOT_VERIFIED (v7 atası merge/commit/route kanıtı), IMPLEMENTED_NOT_MERGED, FOUNDER_ACTION_REQUIRED, BLOCKED, IN_PROGRESS (taze talep), QUEUED, NOT_STARTED, UNKNOWN. JSON durum alanları, FAKE yürütücü, installer CI, backlog DONE ve sözleşme state'i ASLA kanıt değildir; kanıtsız ilerleme iddiası UNKNOWN olur ve missingEvidence taşır.
import { uniqSorted, cmp } from '../core/canonical-json.mjs';
import { baselineClass, classOfPrs } from './baseline.mjs';
import { toMs } from '../core/time.mjs';

export const RECON_CLASSES = ['EXPLICIT_PR_MERGED_ALL', 'EXPLICIT_PR_MERGED_PARTIAL', 'EXPLICIT_PR_OPEN', 'CORROBORATED_BY_PR', 'CORROBORATED_BY_COMMIT', 'STATUS_ONLY_UNVERIFIED', 'PR_CLOSED_UNMERGED_ONLY',
  'RELINKED_MERGED_PR', 'RELINKED_HEAD_IN_V7', 'RELINKED_OPEN_PR', 'QUEUED_BY_COORDINATOR', 'STALE_NO_EVIDENCE_NONPROGRESS', 'STALE_NO_EVIDENCE_PROGRESS_CLAIM', 'ACCEPTED_WITH_EVIDENCE',
  'EXCLUDED_DUPLICATE', 'EXCLUDED_OBSOLETE', 'ADDED_BACKLOG', 'ADDED_WAVE0', 'ADDED_QUEUE', 'ADDED_DELIVERABLE', 'ADDED_COORDINATOR_BUILD', 'ADDED_OVERLAY'];
const T = 'TRUE', F = 'FALSE', U = 'UNKNOWN';

export function deriveItem(it, links, ctx) {
  const { pulls, reachable, checks, runsBySha, statusMap: SM, decisionsByItem, nowIso, staleHours, acceptance, requiredChecks, dispatchedWave0, commitSubjects = new Map(), resolver = null, ownCommit = null, bookkeepingPr = null } = ctx;
  const id = it.id;
  const prL = links.filter((l) => l.kind === 'PR');
  const pr = (l) => pulls.get(l.pr);
  const integratedPr = (p) => !!(p && p.mergedAt && p.mergeCommitSha && reachable.has(p.mergeCommitSha));
  const mergedElsewhere = (p) => !!(p && p.mergedAt && !(p.mergeCommitSha && reachable.has(p.mergeCommitSha)));
  const isOpen = (p) => !!p && p.state === 'open';
  const inv = prL.filter((l) => l.strength === 'EXPLICIT' && l.source.startsWith('inventory.prs'));
  const invWeak = prL.filter((l) => l.strength === 'INVENTORY_WEAK');
  // merged WEAK references that are not another item's PR: listed on a status-only merged claim as corroboration only (never evidence)
  const weakCorr = invWeak.filter((l) => !l.source.startsWith('inventory.prs:other-item:') && integratedPr(pr(l)));
  const recExplicit = prL.filter((l) => l.strength === 'EXPLICIT' && /(^|\+)(queue_task|deliverable|coordinator_build):/.test(l.source));
  const overlayL = prL.filter((l) => l.strength === 'OVERLAY');
  const tb = prL.filter((l) => l.strength === 'ID_IN_TITLE' || l.strength === 'ID_IN_BRANCH');
  const body = prL.filter((l) => l.strength === 'ID_IN_BODY');
  const isBkCommit = (l) => !!(ownCommit && new RegExp(ownCommit.bookkeepingSubjectRegex, 'i').test(commitSubjects.get(l.ref) || ''));
  // a backlog/planning/queue/ledger bookkeeping commit only records the item: never integration or start evidence
  const commitMsgAll = links.filter((l) => l.kind === 'COMMIT' && l.strength === 'ID_IN_COMMIT_MESSAGE');
  const commitMsg = commitMsgAll.filter((l) => !isBkCommit(l));
  const bookkeeping = prL.filter((l) => l.strength === 'BOOKKEEPING_PR');
  const headLinks = links.filter((l) => l.kind === 'COMMIT' && l.strength === 'EXPLICIT');
  const literal = links.filter((l) => l.kind === 'COMMIT' && (l.strength === 'ROUTE_LITERAL_AT_HEAD' || l.strength === 'IPC_CHANNEL_LITERAL_AT_HEAD'));
  const supporting = links.filter((l) => l.kind === 'COORD_RECORD' && /_TEXT$/.test(l.strength));
  const recs = it.records;
  const recStates = (kind) => recs.filter((r) => r.kind === kind).map((r) => r.status);
  const queueStates = [...recStates('QUEUE_TASK'), ...recStates('QUEUE_TASK_REPAIR')];
  const backlogStates = recStates('BACKLOG');
  const delivStates = [...recStates('DELIVERABLE'), ...recStates('COORDINATOR_BUILD')];
  const bc = it.baseline ? baselineClass(it.baseline, pulls) : null;          // v0 view: every #N in the 19-Oct prs text (frozen; partition/legacy only)
  const ebc = it.baseline ? classOfPrs(it.baseline, inv.map(pr)) : null;      // evidence model: EXPLICIT inventory references only
  const evidence = [], missing = [], blockers = [];
  let reconClass = null, integratedBy = [], matchKind = null, confidence = 'MEDIUM', partial = false;
  const pick = (ls, pred) => ls.filter((l) => pred(pr(l)));
  const evPr = (ls) => { for (const l of ls) { const p = pr(l); evidence.push({ kind: 'PR', ref: `#${p.number}`, at: p.mergedAt || p.createdAt, strength: l.strength, mergeCommit: p.mergeCommitSha ? p.mergeCommitSha.slice(0, 7) : null, state: p.mergedAt ? 'merged' : p.state }); } };
  const evC = (ls) => { for (const l of ls) evidence.push({ kind: 'COMMIT', ref: /^[0-9a-f]{40}$/.test(l.ref) ? l.ref.slice(0, 7) : l.ref, at: l.at, strength: l.strength, source: l.source }); };

  // ---- reconciliation class (exactly one)
  const acc = acceptance.get(id) || null;
  if (it.excluded) reconClass = it.excluded === 'DUPLICATE' ? 'EXCLUDED_DUPLICATE' : 'EXCLUDED_OBSOLETE';
  else if (it.removed) reconClass = 'EXCLUDED_OBSOLETE';
  else if (!it.baseline) reconClass = `ADDED_${it.origin}`;
  else if (ebc === 'PR_MERGED_ALL') { reconClass = 'EXPLICIT_PR_MERGED_ALL'; integratedBy = pick(inv, integratedPr); matchKind = 'EXPLICIT'; confidence = 'HIGH'; }
  else if (ebc === 'PR_MERGED_PARTIAL') {
    // the EXPLICIT inventory set is incomplete (some merged, the rest closed unmerged): independent integrating evidence still counts
    // (record/overlay PR, title/branch PR, record head in v7; for a merged claim also v7 commit/route evidence); PARTIAL only without it
    const invM = pick(inv, integratedPr), claim = SM.baselineMergedClaim.includes(it.baseline.status19);
    const s1 = pick([...recExplicit, ...overlayL], integratedPr), s2 = pick(tb, integratedPr);
    const plus = (ls) => [...ls, ...invM.filter((l) => !ls.some((x) => x.pr === l.pr))];
    if (s1.length) { reconClass = claim ? 'CORROBORATED_BY_PR' : 'RELINKED_MERGED_PR'; integratedBy = plus(s1); matchKind = 'EXPLICIT_QUEUE_OR_DELIVERABLE'; confidence = 'HIGH'; }
    else if (s2.length) { reconClass = claim ? 'CORROBORATED_BY_PR' : 'RELINKED_MERGED_PR'; integratedBy = plus(s2); matchKind = s2.some((l) => l.strength === 'ID_IN_TITLE') ? 'TITLE' : 'BRANCH'; confidence = 'HIGH'; }
    else if (headLinks.length) { reconClass = claim ? 'CORROBORATED_BY_COMMIT' : 'RELINKED_HEAD_IN_V7'; integratedBy = [...invM, ...headLinks]; matchKind = 'RECORD_HEAD'; confidence = 'MEDIUM'; }
    else if (claim && commitMsg.length) { reconClass = 'CORROBORATED_BY_COMMIT'; integratedBy = [...invM, ...commitMsg]; matchKind = 'COMMIT_MESSAGE'; confidence = 'MEDIUM'; }
    else if (claim && literal.length) { reconClass = 'CORROBORATED_BY_COMMIT'; integratedBy = [...invM, ...literal]; matchKind = literal[0].strength === 'ROUTE_LITERAL_AT_HEAD' ? 'ROUTE_LITERAL' : 'IPC_LITERAL'; confidence = 'MEDIUM'; }
    else { reconClass = 'EXPLICIT_PR_MERGED_PARTIAL'; integratedBy = invM; matchKind = 'EXPLICIT'; confidence = 'HIGH'; partial = true; }
  } else if (ebc === 'PR_OPEN') { reconClass = 'EXPLICIT_PR_OPEN'; confidence = 'HIGH'; }
  else if (ebc === 'STALE_STATUS_SAYS_MERGED') {
    // ownership rule: WEAK references (another item's PR, or a range / nested / role / unmatched reference) never enter integratedBy
    const s1 = pick([...recExplicit, ...overlayL], integratedPr), s2 = pick(tb, integratedPr), s2b = pick(body, integratedPr);
    if (s1.length) { reconClass = 'CORROBORATED_BY_PR'; integratedBy = s1; matchKind = 'EXPLICIT_QUEUE_OR_DELIVERABLE'; confidence = 'HIGH'; }
    else if (s2.length) { reconClass = 'CORROBORATED_BY_PR'; integratedBy = s2; matchKind = s2.some((l) => l.strength === 'ID_IN_TITLE') ? 'TITLE' : 'BRANCH'; confidence = 'HIGH'; }
    else if (s2b.length) { reconClass = 'CORROBORATED_BY_PR'; integratedBy = s2b; matchKind = 'BODY'; confidence = 'LOW'; }
    else if (headLinks.length) { reconClass = 'CORROBORATED_BY_COMMIT'; integratedBy = headLinks; matchKind = 'RECORD_HEAD'; confidence = 'MEDIUM'; }
    else if (commitMsg.length) { reconClass = 'CORROBORATED_BY_COMMIT'; integratedBy = commitMsg; matchKind = 'COMMIT_MESSAGE'; confidence = 'MEDIUM'; }
    else if (literal.length) { reconClass = 'CORROBORATED_BY_COMMIT'; integratedBy = literal; matchKind = literal[0].strength === 'ROUTE_LITERAL_AT_HEAD' ? 'ROUTE_LITERAL' : 'IPC_LITERAL'; confidence = 'MEDIUM'; }
    else { reconClass = 'STATUS_ONLY_UNVERIFIED'; confidence = 'LOW'; missing.push(`no PR/commit/route evidence for ${id}; the 19-Oct status ${it.baseline.status19 === 'INTEGRATED_NOT_VERIFIED' ? 'INV' : 'MNI'} is a status field, not evidence${weakCorr.length ? `; WEAK 19-Oct reference(s) ${weakCorr.map((l) => `#${l.pr} (${l.source.slice('inventory.prs:'.length)})`).join(', ')} are corroboration only, never evidence` : ''}`); }
  } else {
    const relink = [...recExplicit, ...overlayL, ...tb];
    const rm = pick(relink, integratedPr), ro = pick(relink, isOpen);
    if (rm.length) { reconClass = 'RELINKED_MERGED_PR'; integratedBy = rm; matchKind = rm.some((l) => l.strength === 'EXPLICIT') ? 'EXPLICIT_QUEUE_OR_DELIVERABLE' : rm.some((l) => l.strength === 'ID_IN_TITLE') ? 'TITLE' : 'BRANCH'; confidence = 'HIGH'; }
    else if (headLinks.length) { reconClass = 'RELINKED_HEAD_IN_V7'; integratedBy = headLinks; matchKind = 'RECORD_HEAD'; confidence = 'MEDIUM'; }
    else if (ro.length) { reconClass = 'RELINKED_OPEN_PR'; confidence = 'HIGH'; }
    else if (ebc === 'PR_CLOSED_UNMERGED_ONLY') { reconClass = 'PR_CLOSED_UNMERGED_ONLY'; confidence = 'LOW'; }
    else if (queueStates.some((s) => ['QUEUED', 'WAITING_BASE', 'REPAIR_QUEUED'].includes(s)) || backlogStates.includes('READY')) reconClass = 'QUEUED_BY_COORDINATOR';
    else if (SM.baselineNonProgress.includes(it.baseline.status19)) { reconClass = 'STALE_NO_EVIDENCE_NONPROGRESS'; confidence = 'MEDIUM'; }
    else { reconClass = 'STALE_NO_EVIDENCE_PROGRESS_CLAIM'; confidence = 'LOW'; }
  }
  // acceptance overrides the class but keeps the integration evidence found above
  if (acc && !it.excluded && !it.removed) reconClass = 'ACCEPTED_WITH_EVIDENCE';
  // added items: evidence by policy (EXPLICIT/title/branch/overlay PR, or record head in v7)
  if (!it.baseline && !it.removed) {
    const strongL = [...prL.filter((l) => l.strength === 'EXPLICIT'), ...overlayL, ...tb];
    const m = pick(strongL, integratedPr);
    if (m.length) { integratedBy = m; matchKind = m.some((l) => l.strength === 'EXPLICIT') ? 'EXPLICIT' : m.some((l) => l.strength === 'ID_IN_TITLE') ? 'TITLE' : 'BRANCH'; confidence = 'HIGH'; }
    else if (headLinks.length) { integratedBy = headLinks; matchKind = 'RECORD_HEAD'; confidence = 'MEDIUM'; }
  }

  // ownership conflict (title/branch name one item, the 19-Oct map lists another): OWN for both, confidence at most MEDIUM, recorded
  const ownershipNotes = uniqSorted([...integratedBy, ...(['EXPLICIT_PR_OPEN', 'RELINKED_OPEN_PR'].includes(reconClass) ? prL.filter((l) => ['EXPLICIT', 'ID_IN_TITLE', 'ID_IN_BRANCH', 'OVERLAY'].includes(l.strength) && pr(l) && pr(l).state === 'open') : [])].filter((l) => l.kind === 'PR' && l.ownershipConflict).map((l) => l.ownershipConflict));
  if (ownershipNotes.length && confidence === 'HIGH') confidence = 'MEDIUM';

  // ---- substeps
  const live = !it.excluded && !it.removed;
  // only OWN / gated UNASSIGNED PRs are in integratedBy: they alone give integratedPrs, tested / CI runs and merge dates
  const statusOnlyWeak = reconClass === 'STATUS_ONLY_UNVERIFIED' && weakCorr.length > 0;
  const integPrs = integratedBy.filter((l) => l.kind === 'PR').map(pr);
  const integCommits = integratedBy.filter((l) => l.kind === 'COMMIT');
  const strongPrs = [...(it.baseline ? inv : []), ...recExplicit, ...overlayL, ...tb, ...(!it.baseline ? prL.filter((l) => l.strength === 'EXPLICIT') : [])];
  const strongOpen = pick(strongPrs, isOpen);
  const strongMergedElsewhere = pick(strongPrs, mergedElsewhere);
  const strongMergedAny = pick(strongPrs, (p) => !!(p && p.mergedAt));
  const strongClosedOnly = pick(strongPrs, (p) => !!(p && p.state !== 'open' && !p.mergedAt));
  const testedHeadOnly = recs.some((r) => (r.kind === 'DELIVERABLE' || r.kind === 'COORDINATOR_BUILD') && SM.deliverableTestedStates.includes(r.status) && r.head);
  const integrated = integratedBy.length > 0 && !partial;
  // Claims (status fields / coordinator records) never count as evidence; an unsupported claim makes the substep UNKNOWN instead of FALSE.
  const claimsIntegrated = ebc === 'STALE_STATUS_SAYS_MERGED' || backlogStates.some((s) => ['DONE', 'COMPLETED'].includes(s)) || queueStates.some((s) => SM.queueFinalStates.includes(s)) || delivStates.some((s) => ['MERGED', 'VERIFIED'].includes(s));
  const claimsCoded = claimsIntegrated || (it.baseline && SM.baselineProgressClaim.includes(it.baseline.status19)) || backlogStates.includes('IN_REVIEW')
    || queueStates.some((s) => ['CODE_IMPLEMENTED', 'TESTED', 'CLAIMED', 'IN_PROGRESS', 'REVIEW_REJECTED'].includes(s)) || delivStates.some((s) => SM.deliverableTestedStates.includes(s) || ['PR_OPEN', 'IN_PROGRESS'].includes(s));
  const progressClaimNoEvidence = !integrated && (claimsIntegrated || (claimsCoded && !strongPrs.length && !testedHeadOnly && !headLinks.length));
  let coded = F, integ = F, tested = F;
  if (!live) { coded = U; integ = U; tested = U; }
  else {
    // coded needs code that exists somewhere: an integrated/merged/open PR, a tested record head or a v7 head; a closed-unmerged PR alone is not enough
    if (integrated || partial || strongMergedAny.length || strongOpen.length || testedHeadOnly || headLinks.length) coded = T;
    else if (strongClosedOnly.length) { coded = U; missing.push(`coded: only closed-unmerged PR(s) ${strongClosedOnly.map((l) => `#${l.pr}`).join(',')}; no merged or open PR, branch head or commit evidence for ${id}`); }
    else if (claimsCoded) { coded = U; missing.push(`coded: ${it.baseline && SM.baselineProgressClaim.concat(SM.baselineMergedClaim).includes(it.baseline.status19) ? `19-Oct status ${it.baseline.status19}` : `record ${recs.map((r) => `${r.kind}:${r.status}`).join(',')}`} claims code; no linked PR, branch head or commit found`); }
    if (integrated) integ = T;
    else if (partial) {
      integ = 'PARTIAL';
      const notMerged = inv.filter((l) => !integratedPr(pr(l))).map((l) => `#${l.pr}`);
      missing.push(`integrated: PARTIAL: ${integratedBy.map((l) => `#${l.pr}`).join(',') || 'none'} merged into v7/integration, ${notMerged.join(',')} not merged; no independent evidence (record/overlay/title/branch PR, record head in v7${SM.baselineMergedClaim.includes(it.baseline.status19) ? ', v7 commit/route' : ''}) found; ${id} counts as integrated only when every EXPLICIT PR is merged or such evidence exists`);
    } else if (claimsIntegrated || strongMergedElsewhere.length) { integ = U; missing.push(strongMergedElsewhere.length ? `integrated: PR ${strongMergedElsewhere.map((p) => `#${p.number}`).join(',')} merged but its merge commit is not an ancestor of v7/integration` : `integrated: merge into v7/integration claimed by a status field or record; no merge commit or v7 commit evidence for ${id}`); }
    if (integ === T) {
      const res = [];
      for (const p of integPrs) {
        const cr = checks[p.headSha];
        if (!cr) { res.push(U); continue; }
        const st = requiredChecks.map((n) => { const xs = cr.filter((c) => c.name === n); const last = xs[xs.length - 1]; return last ? (last.status !== 'completed' ? 'pending' : last.conclusion) : 'absent'; });
        evidence.push({ kind: 'CHECK', ref: `#${p.number}@${p.headSha.slice(0, 7)}`, at: p.mergedAt, strength: requiredChecks.map((n, i) => `${n}=${st[i]}`).join(';') });
        res.push(st.every((s) => s === 'success') ? T : st.some((s) => s === 'pending') ? U : F);
      }
      for (const l of integCommits) {
        const sha = /^[0-9a-f]{40}$/.test(l.ref) ? l.ref : null;
        const rs = sha ? (runsBySha.get(sha) || []) : [];
        if (!rs.length) { res.push(U); continue; }
        const last = rs[rs.length - 1];
        evidence.push({ kind: 'CI_RUN', ref: String(last.id), at: last.createdAt, strength: `push CI ${last.conclusion ?? last.status}` });
        res.push(last.status !== 'completed' ? U : last.conclusion === 'success' ? T : F);
      }
      tested = res.includes(T) ? T : res.includes(U) ? U : F;
      if (tested === U) missing.push(`tested: no completed required check-runs (${requiredChecks.join(' + ')}) or push CI found for the integrating head(s) of ${id}`);
    } else if (integ === U || integ === 'PARTIAL') { tested = U; missing.push(`tested: depends on ${integ === 'PARTIAL' ? 'partial' : 'unresolved'} integration evidence`); }
  }
  // no runtime-evidence source exists: per item NOT_MEASURED (never a measured FALSE), matching the ratio
  const runtimeVerified = live ? 'NOT_MEASURED' : U;
  const accepted = acc ? T : live ? F : U;
  evPr(integratedBy.filter((l) => l.kind === 'PR')); evC(integCommits);
  for (const l of strongOpen) evidence.push({ kind: 'PR', ref: `#${l.pr}`, at: pr(l).createdAt, strength: l.strength, state: 'open' });
  if (acc) evidence.push({ kind: 'ACCEPTANCE', ref: acc.evidenceRef, at: acc.at, strength: 'OVERLAY' });

  // ---- decisions / blockers
  const openDecisions = (decisionsByItem.get(id) || []).filter((d) => d.state === 'OPEN');
  for (const d of openDecisions) blockers.push(`DECISION:${d.id}`);
  for (const r of recs) if (['BLOCKED', 'AUTHORITY_REQUIRED', 'FOUNDER_QUEUE', 'AUTHORITY_REQUEST', 'REVIEW_REJECTED'].includes(r.status)) blockers.push(`${r.kind}:${r.ref}:${r.status}`);
  if (ebc === 'STALE_FOUNDER') blockers.push('19-OCT:AUTHORITY_REQUIRED (stale)');
  if (ebc === 'STALE_BLOCKED') blockers.push('19-OCT:BLOCKED (stale)');

  // ---- status precedence (first true rule wins)
  const fresh = (iso) => { const t = toMs(iso); return Number.isFinite(t) && (toMs(nowIso) - t) <= staleHours * 3600e3; };
  const claimFresh = recs.some((r) => ((r.kind === 'QUEUE_TASK' || r.kind === 'QUEUE_TASK_REPAIR') && ['CLAIMED', 'IN_PROGRESS', 'REVIEW_REJECTED'].includes(r.status) || (r.kind === 'COORDINATOR_BUILD' && SM.deliverableInProgressStates.includes(r.status))) && (fresh(r.startedAt) || fresh(r.headAt)))
    || strongPrs.some((l) => isOpen(pr(l)) && fresh(pr(l).updatedAt));
  let status, rule;
  const isW0 = it.origin === 'WAVE0';
  if (!live) { status = 'OBSOLETE'; rule = 1; }
  else if (acc) { status = 'COMPLETED_AND_VERIFIED'; rule = 2; }
  else if (integ === T) { status = 'MERGED_NOT_VERIFIED'; rule = 3; }
  else if (strongOpen.length || (testedHeadOnly && !integrated)) { status = 'IMPLEMENTED_NOT_MERGED'; rule = 4; }
  else if (openDecisions.length || ebc === 'STALE_FOUNDER' || backlogStates.includes('AUTHORITY_REQUIRED') || queueStates.includes('FOUNDER_QUEUE') || delivStates.some((s) => SM.deliverableAuthorityStates.includes(s))) { status = 'FOUNDER_ACTION_REQUIRED'; rule = 5; }
  else if (queueStates.includes('BLOCKED') || backlogStates.includes('BLOCKED') || ebc === 'STALE_BLOCKED') { status = 'BLOCKED'; rule = 6; }
  else if (claimFresh) { status = 'IN_PROGRESS'; rule = 7; }
  else if (queueStates.some((s) => ['QUEUED', 'WAITING_BASE', 'REPAIR_QUEUED'].includes(s)) || backlogStates.includes('READY') || (isW0 && !dispatchedWave0.has(id))) { status = 'QUEUED'; rule = 8; }
  else if ((ebc === 'STALE_NOT_STARTED' || (backlogStates.includes('DRAFT_NOT_READY') && !progressClaimNoEvidence)) && !prL.some((l) => !['ID_IN_BODY', 'INVENTORY_WEAK', 'BOOKKEEPING_PR'].includes(l.strength))) { status = 'NOT_STARTED'; rule = 9; }
  else { status = 'UNKNOWN'; rule = 10; }
  if (status === 'UNKNOWN') {
    if (reconClass === 'PR_CLOSED_UNMERGED_ONLY') missing.push(`linked PR(s) ${inv.map((l) => l.ref).join(',')} closed without merge; no merged or open PR, commit or route evidence for ${id}`);
    else if (reconClass === 'STALE_NO_EVIDENCE_PROGRESS_CLAIM') missing.push(`19-Oct status ${it.baseline.status19} claims progress; no PR, branch, commit or fresh claim found since; a status field is not evidence`);
    else if (isW0 && dispatchedWave0.has(id)) missing.push(`dispatched (dispatch/${id}.md) but no PR, branch or commit evidence for ${id}`);
    else if (!it.baseline) missing.push(`${recs.map((r) => `${r.kind}:${r.ref} status ${r.status ?? 'none'}`).join('; ') || 'no record'} is a coordinator record, not evidence; no PR/branch/commit evidence for ${id}`);
    if (!missing.length) missing.push(`no evidence rule matched for ${id}`);
  }
  const weakNotUsed = invWeak.filter((l) => !integratedBy.includes(l));
  if (weakNotUsed.length && (status === 'UNKNOWN' || reconClass === 'STALE_NO_EVIDENCE_NONPROGRESS' || reconClass === 'STALE_NO_EVIDENCE_PROGRESS_CLAIM')) missing.push(`19-Oct prs text cites ${weakNotUsed.map((l) => `#${l.pr} (${l.source.slice('inventory.prs:'.length)})`).join(', ')} only as WEAK reference(s); a WEAK reference never upgrades ${id}`);
  if (status === 'UNKNOWN' && confidence !== 'LOW') confidence = 'LOW';
  if (strongMergedElsewhere.length) evidence.push(...strongMergedElsewhere.map((p) => ({ kind: 'PR', ref: `#${p.number}`, at: p.mergedAt, strength: 'MERGED_OUTSIDE_V7', state: 'merged' })));
  const stale = !!(it.baseline && ['STALE_NO_EVIDENCE_NONPROGRESS', 'STALE_NO_EVIDENCE_PROGRESS_CLAIM', 'STATUS_ONLY_UNVERIFIED'].includes(reconClass));
  // own evidence that the item itself started: merged or open strong PRs (never closed-unmerged, never WEAK refs); for a CODED item only:
  // its own v7 commits (subject head names the id, bookkeeping subjects such as backlog:/planning: excluded) and its coordinator record heads
  const ownStartPrs = strongPrs.filter((l) => { const p = pr(l); return !!(p && (p.mergedAt || p.state === 'open')); }).map(pr);
  // a commit the ladder accepted as this item's integrating evidence (CORROBORATED_BY_COMMIT via the message) dates it as well
  const integMsg = new Set(integCommits.filter((l) => l.strength === 'ID_IN_COMMIT_MESSAGE').map((l) => l.ref));
  const ownStartCommits = coded !== T ? [] : [
    ...commitMsg.filter((l) => l.at && (integMsg.has(l.ref) || isOwnCommit(commitSubjects.get(l.ref), id, resolver, ownCommit))).map((l) => ({ ref: l.ref, at: l.at, strength: integMsg.has(l.ref) && !isOwnCommit(commitSubjects.get(l.ref), id, resolver, ownCommit) ? 'INTEGRATING_COMMIT (accepted integration evidence)' : 'OWN_COMMIT (subject head names the id)' })),
    ...recs.filter((r) => r.headFull && r.headAt).map((r) => ({ ref: r.headFull, at: r.headAt, strength: `RECORD_HEAD ${r.kind}:${r.ref} ${reachable.has(r.headFull) ? 'in v7/integration' : 'on its branch (not in v7/integration)'}` }))];
  // earlier unattributed v7 commits that name the id only in the message body (the subject names no known item; no merge or bookkeeping
  // subject): never a start (no per-commit file list proves they implement it), reported so a later own start reads as an upper bound
  const bkTitle = bookkeepingPr ? new RegExp(bookkeepingPr.wholeTitleRegex, bookkeepingPr.wholeTitleFlags || '') : null;
  const ownStartRefs = new Set(ownStartCommits.map((l) => l.ref));
  const namesNoItem = (sj) => !!resolver && !resolver.resolveText(sj).length && !resolver.resolveLiteral(sj, 'title').length;
  const earlierMentions = coded !== T ? [] : commitMsg.filter((l) => { const sj = commitSubjects.get(l.ref) || ''; return l.at && !ownStartRefs.has(l.ref) && !/^Merge /.test(sj) && !(bkTitle && bkTitle.test(sj)) && namesNoItem(sj); }).map((l) => ({ ref: l.ref, at: l.at }));
  const commitEvidence = integCommits.length ? { sha7: /^[0-9a-f]{40}$/.test(integCommits[0].ref) ? integCommits[0].ref.slice(0, 7) : integCommits[0].ref, at: integCommits[0].at, matchKind } : null;
  return {
    status, rule, reconClass, baselineClass: bc, evidenceBaselineClass: ebc, matchKind,
    evidenceClass: !live ? 'EXCLUDED' : partial ? 'PARTIAL_PR_MERGE' : statusOnlyWeak ? 'CORROBORATED_BY_WEAK_REF' : integratedBy.some((l) => l.kind === 'PR') ? 'EVIDENCED_BY_PR' : integCommits.length ? 'EVIDENCED_BY_COMMIT' : strongOpen.length ? 'OPEN_PR_ONLY' : (status === 'UNKNOWN' || progressClaimNoEvidence) ? 'STATUS_ONLY_UNVERIFIED' : 'NO_PROGRESS_CLAIM',
    substeps: { coded, integrated: integ, tested, runtimeVerified, accepted },
    integratedPrs: uniqSorted(integPrs.map((p) => p.number)), corroboratingWeakPrs: statusOnlyWeak ? uniqSorted(weakCorr.map((l) => l.pr)) : [], mergeCommits: uniqSorted(integPrs.map((p) => p.mergeCommitSha.slice(0, 7))), mergedAt: uniqSorted(integPrs.map((p) => p.mergedAt)),
    commitEvidence, supportingRefs: uniqSorted(supporting.map((l) => l.ref)),
    candidateLinks: uniqSorted([...(ebc !== 'STALE_STATUS_SAYS_MERGED' ? pick(body, (p) => p && p.mergedAt).map((l) => `body:#${l.pr}`) : []), ...(!['CORROBORATED_BY_COMMIT'].includes(reconClass) && !integrated ? commitMsgAll.map((l) => `commit:${l.ref.slice(0, 7)}`) : []),
      ...pick(invWeak, (p) => p && p.mergedAt).filter((l) => !integratedBy.includes(l)).map((l) => `inventory-weak:#${l.pr}`), ...bookkeeping.map((l) => `bookkeeping:#${l.pr}`)]),
    weakInventoryRefs: invWeak.map((l) => `#${l.pr} ${l.source.slice('inventory.prs:'.length)}`).sort(),
    ownStart: { prs: ownStartPrs.map((p) => ({ number: p.number, createdAt: p.createdAt })), commits: ownStartCommits.map((l) => ({ ref: l.ref, at: l.at, strength: l.strength })), earlierMentions },
    evidence: evidence.sort((a, b) => cmp(a.kind, b.kind) || cmp(String(a.ref), String(b.ref)) || cmp(a.strength || '', b.strength || '')),
    missingEvidence: uniqSorted(missing), blockers: uniqSorted(blockers), confidence, stale, ownershipNotes,
    openPrs: uniqSorted(strongOpen.map((l) => l.pr)),
    linkedPrs: uniqSorted(strongPrs.map((l) => l.pr)),
  };
}

// A commit is the item's own when its subject head (text up to the first ': ' plus the next word, or the first three words) names the id
// and the subject is not a bookkeeping edit (rules/link-patterns.json ownCommitStart.bookkeepingSubjectRegex).
export function subjectHead(subject) {
  const s = String(subject || '');
  const i = s.indexOf(': ');
  return i >= 0 ? `${s.slice(0, i)}: ${s.slice(i + 2).split(/\s+/)[0] || ''}` : s.split(/\s+/).slice(0, 3).join(' ');
}
export function isOwnCommit(subject, id, resolver, rule) {
  if (!subject || !resolver || !rule) return false;
  if (new RegExp(rule.bookkeepingSubjectRegex, 'i').test(subject)) return false;
  return resolver.resolveText(subjectHead(subject)).includes(id);
}
