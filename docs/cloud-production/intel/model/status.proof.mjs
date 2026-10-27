//TR: P5 durum ve kanıt kanıtı (tablo güdümlü, ağsız): merge != tamamlandı; 19 Ekim 'prs' metnindeki rol notlu/aralık/iç içe/başka kalemin PR'ı WEAK'tir ve ilerleme iddiasız satırı yükseltmez; kısmi merge PARTIAL'dır; gerçek başlangıç yalnız kalemin kendi kanıtından (kayıt/planlama commit'i değil, kodlanmış kalemin konu başı kimliği adlandıran kendi commit'i); kısmi EXPLICIT küme bağımsız kanıtı (başlık/dal PR'ı) gölgelemez; başka kaleme atanmış 19 Ekim notu WEAK'tir; WEAK destek yalnız integrated verir; runtimeVerified kalem düzeyinde NOT_MEASURED'dır; rakamla bitmeyen kimlikler başlık/dalda tam eşleşir; backlog DONE, sözleşme PLANNED, kanıtsız PRODUCT_ACCEPTED, FAKE yürütücü ve installer çıktıları runtimeVerified/accepted üretmez; kanıtsız ACCEPTANCE overlay'i reddedilir; gövde anması yalnız 'merge edildi' iddialı satırı destekler; öncelik sırası; PQ-007 çelişkisi; en uzun bilinen kimlik eşleşmesi. intel-1.4 PR sahiplik kuralı (K1-K7): haritanın başka kaleme atadığı test+states PR'ı OTHER_ITEM/WEAK'tir, başlangıç/son merge/tested yalnız kalemin kendi PR'ından; SHARED PR her sahip için OWN; kapıdan geçen UNASSIGNED PR EXPLICIT kalır; başlık/harita çatışması ikisi için OWN ve MEDIUM; MERGED_NOT_VERIFIED eylem metni yalnız entegre eden merge edilmiş PR'ları sayar; Founder kuyruğu BLOCKED + FOUNDER/yeni yetki kalemlerini ve kaydı BLOCKED + FOUNDER/yeni yetki olan FOUNDER_ACTION_REQUIRED kalemlerini listeler (K7b/K7c); kayıt tutma PR'ının gövdesi de kanıt değildir. intel-1.5 (K12): yalnız belge değiştiren PR'ın gövdesi ve belge commit'i hiçbir satırı kodlanmış/entegre/test edilmiş/tarihli yapmaz; başlık/dal yalnız belge teslimi olan satır için OWN kalır; dosya listesi bilinmeyen PR/commit bugünkü kuralla kalır ve missingEvidence'a yazılır.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { miniBundle } from '../fixtures/mini/bundle.mjs';
import { loadRules } from '../lib/gather.mjs';
import { buildAll } from './pipeline.mjs';
import { knownIdScan, literalIdScan } from '../core/ids.mjs';
import { parseInventoryPrs, inventoryPrRefs } from './baseline.mjs';
import { isOwnCommit } from './status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const b = miniBundle();
const { rules } = loadRules(path.join(HERE, '..'));
const m = buildAll(b.inputs, rules, b.overlay, b.meta, b.nowIso);
const by = new Map(m.items.map((x) => [x.id, x]));
const st = (id) => by.get(id)?.status, rc = (id) => by.get(id)?.reconClass;

// table: id -> [status, reconClass, statusRule]
const TABLE = [
  ['UI-015', 'OBSOLETE', 'EXCLUDED_DUPLICATE', 1], ['UI-016', 'OBSOLETE', 'EXCLUDED_OBSOLETE', 1],
  ['UI-019', 'COMPLETED_AND_VERIFIED', 'ACCEPTED_WITH_EVIDENCE', 2],
  ['UI-001', 'MERGED_NOT_VERIFIED', 'EXPLICIT_PR_MERGED_ALL', 3], ['UI-002', 'UNKNOWN', 'EXPLICIT_PR_MERGED_PARTIAL', 10],
  ['UI-003', 'MERGED_NOT_VERIFIED', 'CORROBORATED_BY_PR', 3], ['UI-004', 'MERGED_NOT_VERIFIED', 'CORROBORATED_BY_PR', 3],
  ['UI-005', 'MERGED_NOT_VERIFIED', 'CORROBORATED_BY_COMMIT', 3], ['G-EP-001', 'MERGED_NOT_VERIFIED', 'CORROBORATED_BY_COMMIT', 3], ['G-EP-002', 'MERGED_NOT_VERIFIED', 'CORROBORATED_BY_COMMIT', 3],
  ['UI-009', 'MERGED_NOT_VERIFIED', 'RELINKED_MERGED_PR', 3], ['UI-110', 'MERGED_NOT_VERIFIED', 'RELINKED_MERGED_PR', 3], ['I-DP-001', 'MERGED_NOT_VERIFIED', 'RELINKED_MERGED_PR', 3],
  ['UI-017', 'IMPLEMENTED_NOT_MERGED', 'EXPLICIT_PR_OPEN', 4], ['LANE-B-Y', 'IMPLEMENTED_NOT_MERGED', 'ADDED_DELIVERABLE', 4],
  ['UI-007', 'FOUNDER_ACTION_REQUIRED', 'STALE_NO_EVIDENCE_NONPROGRESS', 5], ['PH-000', 'FOUNDER_ACTION_REQUIRED', 'STALE_NO_EVIDENCE_NONPROGRESS', 5], ['MOB-11', 'FOUNDER_ACTION_REQUIRED', 'ADDED_BACKLOG', 5],
  ['UI-013', 'BLOCKED', 'STALE_NO_EVIDENCE_NONPROGRESS', 6], ['PT-001', 'BLOCKED', 'STALE_NO_EVIDENCE_NONPROGRESS', 6],
  ['PQ-002', 'IN_PROGRESS', 'ADDED_QUEUE', 7],
  ['PQ-001', 'QUEUED', 'ADDED_QUEUE', 8], ['SEC-X', 'QUEUED', 'ADDED_BACKLOG', 8], ['C-CTX-1', 'QUEUED', 'ADDED_WAVE0', 8],
  ['UI-010', 'NOT_STARTED', 'STALE_NO_EVIDENCE_NONPROGRESS', 9], ['BL-REQ-DEV', 'NOT_STARTED', 'STALE_NO_EVIDENCE_NONPROGRESS', 9],
  ['UI-006', 'UNKNOWN', 'STATUS_ONLY_UNVERIFIED', 10], ['G-EP-003', 'UNKNOWN', 'STATUS_ONLY_UNVERIFIED', 10], ['UI-014', 'UNKNOWN', 'PR_CLOSED_UNMERGED_ONLY', 10],
  ['UI-011', 'UNKNOWN', 'STALE_NO_EVIDENCE_PROGRESS_CLAIM', 10], ['UI-012', 'UNKNOWN', 'STALE_NO_EVIDENCE_PROGRESS_CLAIM', 10], ['COORD-Z', 'UNKNOWN', 'ADDED_COORDINATOR_BUILD', 10],
  ['PQ-003', 'UNKNOWN', 'ADDED_QUEUE', 10], ['CP-DONE-ONLY', 'UNKNOWN', 'ADDED_BACKLOG', 10], ['UI-020', 'UNKNOWN', 'STATUS_ONLY_UNVERIFIED', 10],
];
for (const [id, s, r, rule] of TABLE) check(`precedence: ${id} -> ${s} / ${r} (rule ${rule})`, st(id) === s && rc(id) === r && by.get(id).statusRule === rule);
check('every rule 1..10 is exercised by the table', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => TABLE.some((t) => t[3] === n)));
check('every item has exactly one status and one reconClass', m.items.every((x) => typeof x.status === 'string' && typeof x.reconClass === 'string'));
check('merged != COMPLETED: merged PR items are MERGED_NOT_VERIFIED with accepted FALSE', ['UI-001', 'UI-024', 'UI-110'].every((id) => st(id) === 'MERGED_NOT_VERIFIED' && by.get(id).substeps.accepted === 'FALSE'));
check('backlog DONE without evidence: UNKNOWN, never accepted or runtimeVerified', st('CP-DONE-ONLY') === 'UNKNOWN' && by.get('CP-DONE-ONLY').substeps.accepted === 'FALSE' && by.get('CP-DONE-ONLY').substeps.runtimeVerified === 'NOT_MEASURED');
check('queue PRODUCT_ACCEPTED without evidence is not accepted', by.get('PQ-003').substeps.accepted === 'FALSE' && st('PQ-003') !== 'COMPLETED_AND_VERIFIED');
check('contract state PLANNED is never a closure (0 phases closed)', m.rm.phases.closedByEvidence === 0 && m.rm.phases.contractStatePlanned === 5);
check('no item is runtimeVerified (no real-run evidence source; FAKE/installer excluded)', m.items.every((x) => x.substeps.runtimeVerified !== 'TRUE'));
check('installer CI success does not make any item accepted', m.items.filter((x) => x.substeps.accepted === 'TRUE').map((x) => x.id).join(',') === 'UI-019');
check('ACCEPTANCE overlay with a FAKE-executor evidenceRef is rejected and listed', m.overlay.rejected.some((r) => r.entry.itemId === 'UI-020' && r.reasons.includes('EVIDENCE_REF_IS_FAKE_EXECUTOR_ARTIFACT')) && st('UI-020') !== 'COMPLETED_AND_VERIFIED');
check('overlay entry without reason is rejected', m.overlay.rejected.some((r) => r.entry.itemId === 'UI-006' && r.reasons.includes('MISSING_REASON')) && by.get('UI-006').scope === 'MVP' && by.get('UI-006').scopeRule.startsWith('oct31'));
check('body-only mention corroborates a merged-claim row at LOW confidence', rc('UI-004') === 'CORROBORATED_BY_PR' && by.get('UI-004').matchKind === 'BODY' && by.get('UI-004').confidence === 'LOW');
check('body-only mention does not promote a non-claim row (kept as candidate link)', st('UI-008') === 'FOUNDER_ACTION_REQUIRED' && by.get('UI-008').candidateLinks.includes('body:#12'));
check('PQ-007-style contradiction QUEUE_STATUS_BEHIND_GITHUB detected', m.dataQuality.contradictions.some((c) => c.code === 'QUEUE_STATUS_BEHIND_GITHUB' && c.ref === 'PQ-007'));
check('queue task citing an inventory id is RELATED, not a new item', !by.has('PQ-007') && m.reconciliation.idEvents.some((e) => e.event === 'RELATED' && e.itemId === 'I-DP-001' && e.sourceId === 'PQ-007'));
check('repair task PQ-008-R1 attaches as QUEUE_TASK_REPAIR, not as PQ-008', !by.has('PQ-008-R1') && by.get('UI-018').records.some((r) => r.startsWith('QUEUE_TASK_REPAIR:PQ-008-R1')));
check('every UNKNOWN status or UNKNOWN substep carries missingEvidence', m.items.filter((x) => x.status !== 'OBSOLETE' && (x.status === 'UNKNOWN' || Object.values(x.substeps).includes('UNKNOWN'))).every((x) => x.missingEvidence.length > 0));
check('tested: both required checks success -> TRUE; a failure -> FALSE; absent -> UNKNOWN', by.get('UI-001').substeps.tested === 'TRUE' && by.get('UI-026').substeps.tested === 'FALSE' && by.get('UI-003').substeps.tested === 'UNKNOWN');
// ---- H1: typed 19-Oct prs references (fails on 4fe58dd: every #N was EXPLICIT/HIGH)
const sub = (id) => by.get(id).substeps;
check('H1 consumer-annotated merged PR does not upgrade a DESIGN_ONLY row (UI-021: NOT_STARTED, integrated FALSE, WEAK role:consumer)', st('UI-021') === 'NOT_STARTED' && sub('UI-021').integrated === 'FALSE' && sub('UI-021').coded === 'FALSE' && (by.get('UI-021').weakInventoryRefs || []).join() === '#6 role:consumer' && by.get('UI-021').prs.length === 0);
check('H1 range reference #1-#2 is WEAK (UI-022: FOUNDER_ACTION_REQUIRED, integrated FALSE)', st('UI-022') === 'FOUNDER_ACTION_REQUIRED' && sub('UI-022').integrated === 'FALSE' && (by.get('UI-022').weakInventoryRefs || [null]).every((w) => / range #1-#2$/.test(w)));
check("H1 reference to another item's merged PR is WEAK (UI-023 cites #10 '(UI-003 return summary, merged)': NOT_STARTED, WEAK other-item:UI-003)", st('UI-023') === 'NOT_STARTED' && sub('UI-023').integrated === 'FALSE' && (by.get('UI-023').weakInventoryRefs || []).join() === '#10 other-item:UI-003');
check('H1 a PR whose title names the item is EXPLICIT for an IN_PROGRESS row (UI-024 #7 -> MERGED_NOT_VERIFIED, HIGH)', st('UI-024') === 'MERGED_NOT_VERIFIED' && rc('UI-024') === 'EXPLICIT_PR_MERGED_ALL' && by.get('UI-024').confidence === 'HIGH');
check("H1 the item's own title naming the PR ('(PR #5)') is EXPLICIT (UI-017 -> EXPLICIT_PR_OPEN)", rc('UI-017') === 'EXPLICIT_PR_OPEN' && st('UI-017') === 'IMPLEMENTED_NOT_MERGED');
// intel-1.4 ownership rule: a WEAK reference never enters integratedBy (03ed064: CORROBORATED_BY_PR / INVENTORY_TEXT_WEAK / integrated TRUE)
check('H1/K-WEAK a WEAK reference supports nothing, even on a merged-claim row (UI-025: STATUS_ONLY_UNVERIFIED, integrated/coded UNKNOWN, LOW, #6 listed as corroboration only)', rc('UI-025') === 'STATUS_ONLY_UNVERIFIED' && by.get('UI-025').matchKind === null && by.get('UI-025').confidence === 'LOW' && by.get('UI-025').substeps.integrated === 'UNKNOWN' && by.get('UI-025').substeps.coded === 'UNKNOWN' && by.get('UI-025').corroboratingWeakPrs.join() === '6');
check('H1 a #N nested in another ref\'s annotation is WEAK; the ownership rule labels it first (UI-027 #7 = UI-024\'s PR -> other-item:UI-024; #4 no-id-match)', (by.get('UI-027').weakInventoryRefs || []).join() === '#4 no-id-match,#7 other-item:UI-024' && sub('UI-027').integrated === 'FALSE');
check('H1 PARTIAL is not integrated: UI-002 (#2 merged, #3 closed) has integrated PARTIAL, status not MERGED_NOT_VERIFIED, and the PARTIAL count is separate', sub('UI-002').integrated === 'PARTIAL' && st('UI-002') !== 'MERGED_NOT_VERIFIED' && m.metrics.full.substeps.integrated?.PARTIAL === 1 && m.metrics.full.substeps.integrated.TRUE === m.items.filter((x) => x.status !== 'OBSOLETE' && x.substeps.integrated === 'TRUE').length && by.get('UI-002').missingEvidence.some((x) => /^integrated: PARTIAL/.test(x)));
check('H1 v0 partition is unchanged: UI-021/UI-022/UI-023 keep baselineClass PR_MERGED_ALL (legacy view), evidenceBaselineClass is stale', ['UI-021', 'UI-022', 'UI-023'].every((id) => by.get(id).baselineClass === 'PR_MERGED_ALL' && /^STALE_/.test(by.get(id).evidenceBaselineClass || '')));
// ---- LOW: coded needs code that exists (merged/open PR, head); a closed-unmerged PR alone leaves coded UNKNOWN
check('coded: closed-unmerged-only PR gives coded UNKNOWN with missingEvidence (UI-014)', sub('UI-014').coded === 'UNKNOWN' && by.get('UI-014').missingEvidence.some((x) => /^coded: only closed-unmerged PR\(s\) #4/.test(x)));
// ---- M1: actual start only from the item's own evidence
check('M1 PH-001 cites a closed-unmerged PR of another item (#31): actual start UNKNOWN with sourcesChecked, phase actualStart null', by.get('PH-001').actual.start === null && by.get('PH-001').actual.startState === 'UNKNOWN' && (by.get('PH-001').actual.startSourcesChecked || []).length >= 5 && m.rm.byPhase.find((p) => p.id === 'PH-001').actualStart === null);
check('M1 UI-024 starts at its own merged PR #7 createdAt (2026-10-17T07:00:00Z)', by.get('UI-024').actual.start === '2026-10-17T07:00:00Z' && by.get('UI-024').actual.startSource === 'PR #7 createdAt');
check('M1 a closed-unmerged PR never sets a start (UI-014 #4 closed)', by.get('UI-014').actual.start === null);
// ---- R2 (round-2 review of 4e1a897): each check below fails on 4e1a897 and passes after the fix
const X = (id) => by.get(id);
// M1 regression: a commit that only mentions the id (planning/backlog bookkeeping, another item's spec) never sets a start; a coded item's own commit does
check("R2-M1 MOB-11 (not coded) named only by 'planning: register MOB-11 as non-READY': start UNKNOWN with sourcesChecked (4e1a897: 2026-10-16T04:58:36Z)", X('MOB-11').substeps.coded !== 'TRUE' && X('MOB-11').actual.start === null && (X('MOB-11').actual.startSourcesChecked || []).length >= 5);
check("R2-M1 UI-024 (coded) starts at its own PR #7, not at the earlier 'backlog: ... UI-024 READY' or 'MOB-6: screen specs' commits (4e1a897: 2026-10-16T05:14:33Z)", X('UI-024').actual.start === '2026-10-17T07:00:00Z' && X('UI-024').actual.startSource === 'PR #7 createdAt');
check("R2-M1 UI-028's own commit 'UI-028: closure checklist core' (subject head names the id) is a valid start", X('UI-028').actual.start === '2026-10-17T03:00:00Z' && /OWN_COMMIT/.test(X('UI-028').actual.startSource || ''));
check('R2-M1 a record head of a non-coded item (LANE-B-REQ, AUTHORITY_REQUEST) sets no start; a coded branch-only head is labelled as not in v7 (LANE-B-Y)', X('LANE-B-REQ').substeps.coded === 'FALSE' && X('LANE-B-REQ').actual.start === null && /on its branch \(not in v7\/integration\)/.test(X('LANE-B-Y').actual.startSource || ''));
// H1 regression: PARTIAL no longer short-circuits independent integrating evidence
check('R2-H1 UI-028 (#40 merged, #41 closed; own PR #42 "UI-028: ..." merged into v7) is integrated: MERGED_NOT_VERIFIED / CORROBORATED_BY_PR / TITLE (4e1a897: UNKNOWN / PARTIAL)', st('UI-028') === 'MERGED_NOT_VERIFIED' && sub('UI-028').integrated === 'TRUE' && rc('UI-028') === 'CORROBORATED_BY_PR' && X('UI-028').matchKind === 'TITLE' && X('UI-028').integratedPrs.includes(42) && !X('UI-028').missingEvidence.some((x) => /PARTIAL/.test(x)));
check('R2-H1 control: UI-002 (#2 merged, #3 closed, no independent evidence) stays PARTIAL with the independent-evidence note', sub('UI-002').integrated === 'PARTIAL' && rc('UI-002') === 'EXPLICIT_PR_MERGED_PARTIAL' && X('UI-002').missingEvidence.some((x) => /no independent evidence/.test(x)));
// H1 residual: an annotation naming another known item assigns the PR to that item, even on a merged-claim row
check('R2-H1 UI-031 (merged claim) cites #43 (UI-029 ...) and #44 (UI-030 ...): WEAK other-item, never EXPLICIT/HIGH, start not from #43 createdAt (4e1a897: EXPLICIT_PR_MERGED_ALL / HIGH / 2026-10-18T16:03:05Z)', (X('UI-031').weakInventoryRefs || []).join() === '#43 other-item:UI-029,#44 other-item:UI-030' && rc('UI-031') !== 'EXPLICIT_PR_MERGED_ALL' && X('UI-031').confidence === 'LOW' && X('UI-031').actual.start === null && !m.links.some((l) => l.itemId === 'UI-031' && l.kind === 'PR' && l.strength === 'EXPLICIT') && m.links.some((l) => l.itemId === 'UI-029' && l.ref === '#43' && l.strength === 'EXPLICIT'));
// LOW: WEAK corroboration sets integrated only (no tested, CI runs, merge dates or integratedPrs from other items' PRs)
check('R2-LOW WEAK-only row (UI-025 #6 consumer; UI-031 is covered by R3-L1): integrated UNKNOWN (intel-1.4: never TRUE from a WEAK ref), tested UNKNOWN, integratedPrs/ciRuns/lastMergedAt/start empty, PRs listed as corroboratingWeakPrs (4e1a897: tested TRUE, integratedPrs [6])', ['UI-025'].every((id) => sub(id).integrated === 'UNKNOWN' && sub(id).tested === 'UNKNOWN' && X(id).integratedPrs.length === 0 && X(id).ciRuns.length === 0 && X(id).actual.lastMergedAt === null && X(id).actual.start === null && X(id).corroboratingWeakPrs.length > 0 && X(id).matchKind === null && X(id).missingEvidence.some((x) => /WEAK 19-Oct reference/.test(x))) && X('UI-025').corroboratingWeakPrs.join() === '6');
// LOW: runtime is NOT_MEASURED per item and in the substep tally (no measured FALSE)
check('R2-LOW every live item has runtimeVerified NOT_MEASURED and the tally has no FALSE (4e1a897: FALSE on every item)', m.items.filter((x) => x.status !== 'OBSOLETE').every((x) => x.substeps.runtimeVerified === 'NOT_MEASURED') && m.metrics.full.substeps.runtimeVerified.NOT_MEASURED === m.metrics.full.n && m.metrics.full.substeps.runtimeVerified.FALSE === 0 && m.metrics.mvp.substeps.runtimeVerified.FALSE === 0);

// ---- R3 (round-3 review of f0f537c): each check below fails on f0f537c and passes after the fix
const L = (id, ref) => m.links.filter((l) => l.itemId === id && l.ref === ref).map((l) => l.strength).sort().join();
// M1: other items' PRs cited in branch-slug form, or whose own title/branch names another item, are WEAK other-item (never EXPLICIT/HIGH, never a start)
check("R3-M1 UI-032 cites '#45 claude/l-assurance-ui033' and '#46 claude/l-assurance-ui034' (slug form; #46's own title names no item): WEAK other-item:UI-033 / other-item:UI-034, STATUS_ONLY_UNVERIFIED, integrated UNKNOWN, start UNKNOWN (f0f537c: EXPLICIT_PR_MERGED_ALL / HIGH / start 2026-10-18T16:02:59Z)",
  (X('UI-032').weakInventoryRefs || []).join() === '#45 other-item:UI-033,#46 other-item:UI-034' && rc('UI-032') === 'STATUS_ONLY_UNVERIFIED' && sub('UI-032').integrated === 'UNKNOWN' && X('UI-032').actual.start === null && X('UI-032').integratedPrs.length === 0 && !m.links.some((l) => l.itemId === 'UI-032' && l.kind === 'PR' && l.strength === 'EXPLICIT'));
check("R3-M1 UI-035 cites a plain '#48 (open)' whose own title 'L-WORKFORCE UI-036: ...' names another item and the 19-Oct map lists UI-036/UI-037: WEAK other-item:UI-036,UI-037,L-WORKFORCE (title + map owners); integrated by its own #47 only, start #47 createdAt (f0f537c: integratedPrs [47,48], start 'PR #48 createdAt' 2026-10-18T15:55:05Z)",
  (X('UI-035').weakInventoryRefs || []).join() === '#48 other-item:UI-036,UI-037,L-WORKFORCE' && X('UI-035').integratedPrs.join() === '47' && X('UI-035').actual.start === '2026-10-19T00:36:54Z' && X('UI-035').actual.startSource === 'PR #47 createdAt' && L('UI-036', '#48').includes('EXPLICIT'));
check('R3-M1 control: the 19-Oct prToWorkItems map assigns #48 to UI-037, so it stays EXPLICIT there (MERGED_NOT_VERIFIED, integratedPrs [48]) although the PR title names UI-036',
  L('UI-037', '#48') === 'EXPLICIT' && st('UI-037') === 'MERGED_NOT_VERIFIED' && X('UI-037').integratedPrs.join() === '48' && !(X('UI-037').weakInventoryRefs || []).length);
check("R3-M1 UI-038 (#47 merged, #49 closed 'L-TOWER-TRACE UI-039' cited as claude/l-tower-trace-ui039): #49 is UI-039's, not a missing part of UI-038 -> EXPLICIT_PR_MERGED_ALL via #47 (f0f537c: EXPLICIT_PR_MERGED_PARTIAL / UNKNOWN)",
  (X('UI-038').weakInventoryRefs || []).join() === '#49 other-item:UI-039' && rc('UI-038') === 'EXPLICIT_PR_MERGED_ALL' && sub('UI-038').integrated === 'TRUE' && X('UI-038').integratedPrs.join() === '47');
// M2 + M3: a bookkeeping PR (backlog write-back / planning / READY marking / '(backlog only)' / id only in a 'DONE' status clause) is never evidence
check("R3-M3 Founder blocker DESIGN-EVIDENCE-X named only by 'Backlog write-back 5: ... + P0 DESIGN-EVIDENCE-X + ...' (#50): BLOCKED (rule 6), coded/integrated FALSE, start UNKNOWN, #50 BOOKKEEPING_PR listed as a candidate (f0f537c: MERGED_NOT_VERIFIED / HIGH / TITLE / integratedPrs [50])",
  st('DESIGN-EVIDENCE-X') === 'BLOCKED' && X('DESIGN-EVIDENCE-X').statusRule === 6 && sub('DESIGN-EVIDENCE-X').coded === 'FALSE' && sub('DESIGN-EVIDENCE-X').integrated === 'FALSE' && X('DESIGN-EVIDENCE-X').integratedPrs.length === 0 && X('DESIGN-EVIDENCE-X').actual.start === null && L('DESIGN-EVIDENCE-X', '#50') === 'BOOKKEEPING_PR' && X('DESIGN-EVIDENCE-X').candidateLinks.includes('bookkeeping:#50') && X('DESIGN-EVIDENCE-X').blockers.some((b) => /BLOCKED/.test(b)));
check("R3-M2 MOB-12 starts at its own dispatch-claim commit (07:49:13Z), not at the earlier write-back PR #50 'MOB-12..31 non-READY' (f0f537c: 'PR #50 createdAt' 04:59:08Z); integratedPrs [51] only",
  X('MOB-12').actual.start === '2026-10-20T07:49:13Z' && /OWN_COMMIT/.test(X('MOB-12').actual.startSource || '') && X('MOB-12').integratedPrs.join() === '51' && L('MOB-12', '#50') === 'BOOKKEEPING_PR');
check("R3-M2 SEC-X (backlog READY) named by 'Integration wave B13: batch-5 desktop READY tasks + SEC-X follow-up (backlog only)' stays QUEUED (f0f537c: MERGED_NOT_VERIFIED via #52)",
  st('SEC-X') === 'QUEUED' && sub('SEC-X').integrated === 'FALSE' && L('SEC-X', '#52') === 'BOOKKEEPING_PR' && X('SEC-X').actual.start === null);
check("R3-M2 UI-028: 'Backlog: UI-028 DONE write-back' (#53) and the wave naming it only in 'backlog #53 (UI-028 DONE, batch 3)' (#54) are bookkeeping: integratedPrs [40,42], lastMergedAt = own #42 2026-10-20T01:00:56Z (f0f537c: [40,42,53,54], 01:51:49Z)",
  X('UI-028').integratedPrs.join() === '40,42' && X('UI-028').actual.lastMergedAt === '2026-10-20T01:00:56Z' && L('UI-028', '#53') === 'BOOKKEEPING_PR' && L('UI-028', '#54') === 'BOOKKEEPING_PR');
check("R3-M2 control: a wave member named outside the status clause stays ID_IN_TITLE ('#42 UI-024' in #54); a write-back naming UI-010 'non-READY' no longer vetoes NOT_STARTED",
  L('UI-024', '#54') === 'ID_IN_TITLE' && st('UI-010') === 'NOT_STARTED' && L('UI-010', '#50') === 'BOOKKEEPING_PR');
// LOW status:69: a reference assigned to another item corroborates nothing (PH-045 shape)
check("R3-L1 UI-031 (merged claim) whose only refs are #43/#44 of UI-029/UI-030: STATUS_ONLY_UNVERIFIED, coded/integrated UNKNOWN, no corroboratingWeakPrs (f0f537c: CORROBORATED_BY_PR / INVENTORY_TEXT_WEAK / integrated TRUE)",
  rc('UI-031') === 'STATUS_ONLY_UNVERIFIED' && sub('UI-031').integrated === 'UNKNOWN' && sub('UI-031').coded === 'UNKNOWN' && X('UI-031').corroboratingWeakPrs.length === 0 && st('UI-031') === 'UNKNOWN' && X('UI-031').missingEvidence.some((x) => /other-item:UI-029/.test(x)));
// LOW pipeline:170: WEAK-only rows are visible as such (evidenceClass, r323 row with the WEAK PRs and the reason)
{
  const r = m.reconciliation.r323.find((x) => x.id === 'UI-025');
  check("R3-L2 WEAK-only UI-025: evidenceClass CORROBORATED_BY_WEAK_REF (not EVIDENCED_BY_PR); its r323 row carries weakPrs [6] and the WEAK reason; the action collects evidence, it never calls the row integrated (f0f537c: EVIDENCED_BY_PR, prs [], missingEvidence [], 'PR —')",
    X('UI-025').evidenceClass === 'CORROBORATED_BY_WEAK_REF' && !!r && r.evidenceClass === 'CORROBORATED_BY_WEAK_REF' && (r.weakPrs || []).join() === '6' && r.missingEvidence.some((x) => /WEAK 19-Oct reference/.test(x)) && X('UI-025').status === 'UNKNOWN' && !/entegre/.test(X('UI-025').nextAction));
}
// LOW status:218: the commit the ladder accepts as integrating evidence dates the start; an unattributed earlier commit is reported; head word ends the token
check("R3-L3 UI-040 integrated only by the body-only commit 'v7 ux-projects: ...' (Covers ... UI-040): start 2026-10-16T02:37:50Z from that INTEGRATING_COMMIT (f0f537c: start UNKNOWN)",
  rc('UI-040') === 'CORROBORATED_BY_COMMIT' && X('UI-040').actual.start === '2026-10-16T02:37:50Z' && /INTEGRATING_COMMIT/.test(X('UI-040').actual.startSource || ''));
check("R3-L3 UI-041 starts at its own PR #57 (2026-10-17T16:10:07Z) and reports the earlier unattributed commit naming it (earlierMention 2026-10-16T02:37:50Z) instead of using it (f0f537c: no earlierMention)",
  X('UI-041').actual.start === '2026-10-17T16:10:07Z' && X('UI-041').actual.earlierMention?.at === '2026-10-16T02:37:50Z' && /^[0-9a-f]{7}$/.test(X('UI-041').actual.earlierMention?.commit || '') && X('UI-024').actual.earlierMention === null);
{
  const lit = (ids) => ({ resolveText: (t) => ids.filter((i) => String(t).includes(i)) });
  const R = rules['link-patterns'].ownCommitStart;
  check("R3-L3 bookkeeping head word ends the token: 'COORD-INTEGRATION-L1: ...' and 'LANE-A: ...' subjects are own commits; 'coord: ...', 'dispatch: ...' and 'backlog: ...' are not; 'dispatch-claim: MOB-1' is (f0f537c: COORD-/LANE- rejected)",
    isOwnCommit('COORD-INTEGRATION-L1: cross-lane wiring', 'COORD-INTEGRATION-L1', lit(['COORD-INTEGRATION-L1']), R) && isOwnCommit('LANE-A: task status UI', 'LANE-A', lit(['LANE-A']), R)
    && !isOwnCommit('coord: ledger review for COORD-INTEGRATION-L1', 'COORD-INTEGRATION-L1', lit(['COORD-INTEGRATION-L1']), R) && !isOwnCommit('dispatch: MOB-1 claimed', 'MOB-1', lit(['MOB-1']), R)
    && !isOwnCommit('backlog: MOB-1 READY', 'MOB-1', lit(['MOB-1']), R) && isOwnCommit('dispatch-claim: MOB-1', 'MOB-1', lit(['MOB-1']), R));
}

// ---- intel-1.4 PR ownership rule (round-3 strategy change; K1-K7 of the coordinator checklist). Each K check names what 03ed064 produced.
{
  const PRL = (id) => m.links.filter((l) => l.itemId === id && l.kind === 'PR');
  // K1: the 19-Oct map assigning a test+states PR to a PT row makes it OTHER_ITEM for a UI row citing it (03ed064: EXPLICIT/HIGH via STATUS19)
  check("K1 UI-042 cites '#58 claude/test-states-workforce-2 (open)'; the 19-Oct map lists only PT-090 for #58: WEAK other-item:PT-090, never EXPLICIT (03ed064: EXPLICIT_PR_MERGED_ALL via #58, HIGH)",
    (X('UI-042').weakInventoryRefs || []).join() === '#58 other-item:PT-090' && L('UI-042', '#58') === 'INVENTORY_WEAK' && rc('UI-042') !== 'EXPLICIT_PR_MERGED_ALL');
  check('K1 the same PR is the PT row\'s own: PT-090 EXPLICIT #58, EXPLICIT_PR_MERGED_ALL, integratedPrs [58] (test+states PRs now attributed to PT rows)',
    L('PT-090', '#58') === 'EXPLICIT' && rc('PT-090') === 'EXPLICIT_PR_MERGED_ALL' && X('PT-090').integratedPrs.join() === '58');
  // K2: start / lastMergedAt / tested / integratedPrs come only from the row's own PR #59 (03ed064: #58 createdAt 00:36:54Z, #58 merge, tested FALSE from #58 Windows)
  check("K2 UI-042 (UI-133 shape) is integrated by its own #59 only: CORROBORATED_BY_PR / TITLE / HIGH, integratedPrs [59], start 'PR #59 createdAt' 2026-10-20T08:00:00Z, lastMergedAt 2026-10-21T10:00:00Z, tested TRUE (03ed064: integratedPrs [58], start 2026-10-19T00:36:54Z from #58, lastMergedAt #58, tested FALSE)",
    rc('UI-042') === 'CORROBORATED_BY_PR' && X('UI-042').matchKind === 'TITLE' && X('UI-042').confidence === 'HIGH' && X('UI-042').integratedPrs.join() === '59' && X('UI-042').prs.join() === '59' && X('UI-042').actual.start === '2026-10-20T08:00:00Z' && X('UI-042').actual.startSource === 'PR #59 createdAt' && X('UI-042').actual.lastMergedAt === '2026-10-21T10:00:00Z' && sub('UI-042').tested === 'TRUE' && !X('UI-042').ciRuns.length);
  check("K2 UI-047 (UI-137 shape, MVP) cites only other items' PRs (#58 PT-090, #49 UI-039 closed): STATUS_ONLY_UNVERIFIED, coded/integrated/tested UNKNOWN, no start, no lastMergedAt, no linked PR (03ed064: EXPLICIT_PR_MERGED_ALL via #58, HIGH, start #58)",
    rc('UI-047') === 'STATUS_ONLY_UNVERIFIED' && sub('UI-047').integrated === 'UNKNOWN' && sub('UI-047').coded === 'UNKNOWN' && sub('UI-047').tested === 'UNKNOWN' && X('UI-047').actual.start === null && X('UI-047').actual.lastMergedAt === null && X('UI-047').prs.length === 0 && X('UI-047').integratedPrs.length === 0 && (X('UI-047').weakInventoryRefs || []).join() === '#49 other-item:UI-039,#58 other-item:PT-090' && X('UI-047').scope === 'MVP');
  // K3: a SHARED PR (map lists two rows) is OWN for each (no under-report)
  check('K3 SHARED #61 (19-Oct map lists UI-043 and UI-044): EXPLICIT for both, both MERGED_NOT_VERIFIED / EXPLICIT_PR_MERGED_ALL / HIGH with integratedPrs [61], no other-item ref',
    ['UI-043', 'UI-044'].every((id) => L(id, '#61') === 'EXPLICIT' && rc(id) === 'EXPLICIT_PR_MERGED_ALL' && st(id) === 'MERGED_NOT_VERIFIED' && X(id).confidence === 'HIGH' && X(id).integratedPrs.join() === '61' && !(X(id).weakInventoryRefs || []).length));
  // K4: an UNASSIGNED PR (no title/branch/body/map/record evidence for any item) that passes STATUS19_CLAIMS_MERGED stays EXPLICIT
  check("K4 UNASSIGNED #1 ('PR 1', branch claude/lane-a-cockpit, no map entry) on merged-claim rows UI-001 / WS-SC-01: EXPLICIT inventory.prs[STATUS19_CLAIMS_MERGED], MERGED_NOT_VERIFIED / HIGH (no under-report)",
    ['UI-001', 'WS-SC-01'].every((id) => PRL(id).some((l) => l.ref === '#1' && l.strength === 'EXPLICIT' && l.source === 'inventory.prs[STATUS19_CLAIMS_MERGED]') && st(id) === 'MERGED_NOT_VERIFIED' && X(id).confidence === 'HIGH' && X(id).integratedPrs.join() === '1'));
  // K5: title names only UI-046 while the map lists only UI-045: OWN for both, MEDIUM, conflict note (03ed064: both HIGH, no note)
  const cNote = /^#60: title\/branch names UI-046 while the 19-Oct prToWorkItems map lists UI-045 \(ownership conflict/;
  check('K5 title/map conflict #60: the map-listed row UI-045 keeps #60 as EXPLICIT (MERGED_NOT_VERIFIED, integratedPrs [60]) at confidence MEDIUM with the conflict note (03ed064: HIGH, no note)',
    L('UI-045', '#60') === 'EXPLICIT' && st('UI-045') === 'MERGED_NOT_VERIFIED' && X('UI-045').integratedPrs.join() === '60' && X('UI-045').confidence === 'MEDIUM' && (X('UI-045').ownershipNotes || []).some((n) => cNote.test(n)));
  check('K5 title/map conflict #60: the title-named row UI-046 keeps #60 as ID_IN_TITLE (RELINKED_MERGED_PR / TITLE) at confidence MEDIUM with the conflict note (03ed064: HIGH, no note)',
    L('UI-046', '#60') === 'ID_IN_TITLE' && rc('UI-046') === 'RELINKED_MERGED_PR' && X('UI-046').confidence === 'MEDIUM' && (X('UI-046').ownershipNotes || []).some((n) => cNote.test(n)));
  // K6: the MERGED_NOT_VERIFIED action text lists only merged PRs in integratedBy (03ed064: 'entegre (PR #40,#41,#42)', #41 closed unmerged)
  check("K6 UI-028 action text lists only its integrating merged PRs: 'UI-028: entegre (PR #40,#42); ...' and never the closed-unmerged #41 (03ed064: #40,#41,#42)",
    /^UI-028: entegre \(PR #40,#42\);/.test(X('UI-028').nextAction) && !/#41/.test(X('UI-028').nextAction) && m.items.filter((x) => x.status === 'MERGED_NOT_VERIFIED').every((x) => { const mm = /entegre \(PR ([^)]*)\)/.exec(x.nextAction); const ns = mm ? [...mm[1].matchAll(/#(\d+)/g)].map((y) => Number(y[1])) : []; return ns.every((n) => x.integratedPrs.includes(n) && !!m.pulls.get(n)?.mergedAt); }));
  // K7: the Founder queue view lists every BLOCKED item owned by FOUNDER or needing new authority, and (K7c) every FOUNDER_ACTION_REQUIRED
  // item whose own record is BLOCKED with owner FOUNDER or new authority, P0 first (03ed064: no such view; 56e1791: BLOCKED items only)
  const FBv = m.plan.founderBlocked || [];
  const fbIds = FBv.map((x) => x.id);
  check(`K7 Founder queue view: DESIGN-EVIDENCE-X (P0, owner FOUNDER, requiresNewAuthority), UI-051 (P0), UI-007 (P1), FD-QUEUE-X, FD-SIGN-X (owner FOUNDER), RESEAL-X (requiresNewAuthority) in that order; LOCAL-BLOCKED-X and 19-Oct BLOCKED rows without Founder ownership are not (${fbIds.join(',') || 'none'}) (03ed064: plan.founderBlocked absent)`,
    fbIds.join() === 'DESIGN-EVIDENCE-X,UI-051,UI-007,FD-QUEUE-X,FD-SIGN-X,RESEAL-X' && FBv[0].priority === 'P0' && FBv[0].owner === 'FOUNDER' && FBv[0].requiresNewAuthority === true && FBv.every((x) => st(x.id) === x.status && ['BLOCKED', 'FOUNDER_ACTION_REQUIRED'].includes(x.status)) && st('LOCAL-BLOCKED-X') === 'BLOCKED' && !fbIds.includes('LOCAL-BLOCKED-X') && !fbIds.includes('UI-013') && !fbIds.includes('PT-001'));
  // K7b: founderOwned is what keeps an item whose lane queue owner precedes its FOUNDER backlog owner (owner field 'lane-a')
  check(`K7b FD-QUEUE-X (queue task owner lane-a precedes the FOUNDER backlog owner): owner ${X('FD-QUEUE-X')?.owner}, founderOwned ${X('FD-QUEUE-X')?.founderOwned}, BLOCKED and in the Founder view (a view on the owner field alone drops it)`,
    X('FD-QUEUE-X').owner === 'lane-a' && X('FD-QUEUE-X').founderOwned === true && st('FD-QUEUE-X') === 'BLOCKED' && fbIds.includes('FD-QUEUE-X'));
  // K7c: a FOUNDER_ACTION_REQUIRED row whose own backlog record is BLOCKED, owned by FOUNDER and needs new authority (live UI-004 P0)
  const fb51 = FBv.find((x) => x.id === 'UI-051');
  check(`K7c UI-051 (UI-004 shape: 19-Oct AUTHORITY_REQUIRED, own backlog record BLOCKED + FOUNDER + requiresNewAuthority, record priority P0) is FOUNDER_ACTION_REQUIRED and listed in the Founder view as P0 with its status; UI-007 (BLOCKED FOUNDER record UI-007+008) too; FOUNDER_ACTION_REQUIRED rows without such a record (UI-008, PH-000, MOB-11) are not (56e1791: UI-051 and UI-007 in no Founder view)`,
    st('UI-051') === 'FOUNDER_ACTION_REQUIRED' && !!fb51 && fb51.priority === 'P0' && fb51.status === 'FOUNDER_ACTION_REQUIRED' && fb51.requiresNewAuthority === true && fb51.owner === 'FOUNDER' && fbIds.indexOf('UI-051') === 1
      && fbIds.includes('UI-007') && st('UI-007') === 'FOUNDER_ACTION_REQUIRED' && ['UI-008', 'PH-000', 'MOB-11'].every((id) => st(id) === 'FOUNDER_ACTION_REQUIRED' && !fbIds.includes(id)));
  // a whole-title bookkeeping PR's body mention never corroborates a merged claim (live: UI-187 via '#70 Backlog: ... write-back' body)
  check("K-BK the body of the write-back PR #53 ('Backlog: UI-028 DONE write-back ...') names the merged-claim row UI-006: BOOKKEEPING_PR, UI-006 stays STATUS_ONLY_UNVERIFIED / integrated UNKNOWN with bookkeeping:#53 as a candidate (03ed064: CORROBORATED_BY_PR / BODY via #53, integrated TRUE)",
    L('UI-006', '#53') === 'BOOKKEEPING_PR' && rc('UI-006') === 'STATUS_ONLY_UNVERIFIED' && sub('UI-006').integrated === 'UNKNOWN' && X('UI-006').candidateLinks.includes('bookkeeping:#53') && X('UI-006').integratedPrs.length === 0);
  // the binding rule over the whole fixture: no row is integrated / dated / tested through a PR that is not its own
  const otherRefs = (id) => new Set((X(id).weakInventoryRefs || []).filter((w) => / other-item:/.test(w)).map((w) => Number(w.slice(1, w.indexOf(' ')))));
  check('K-ALL no live row has another item\'s PR (an other-item ref) in prs, integratedPrs, openPrs, ownStart or as its actual.startSource',
    m.items.filter((x) => x.status !== 'OBSOLETE').every((x) => { const o = otherRefs(x.id); return [...x.prs, ...x.integratedPrs, ...x.openPrs].every((n) => !o.has(n)) && ![...o].some((n) => x.actual.startSource === `PR #${n} createdAt`); }));
}

// ---- intel-1.5 docs-only rule (K12): a DOCS_ONLY PR (every changed file is documentation / report / evidence) and its docs-only commits
// never make a row coded, integrated, tested, dated or CI-credited, unless the row's own deliverable is documentation. Each check names
// what 56e1791 produced on this fixture.
{
  const LK = (id, ref) => m.links.filter((l) => l.itemId === id && l.ref === ref);
  const docsCommit = m.links.find((l) => l.itemId === 'UI-048' && l.kind === 'COMMIT');
  check("K12a UI-048 (merged claim) is named only in the body of DOCS_ONLY #62 ('LANE-B: endpoint evidence map (docs only)', docs/lanes/*.json + *.md): DOCS_ONLY_WEAK 'docs-only-body', STATUS_ONLY_UNVERIFIED / CORROBORATED_BY_WEAK_REF with corroboratingWeakPrs [62]; coded / integrated / tested UNKNOWN, no integratedPrs, start, lastMergedAt or CI runs (56e1791: CORROBORATED_BY_PR / BODY via #62, integrated and tested TRUE, lastMergedAt 2026-10-21T01:58:47Z)",
    LK('UI-048', '#62').length === 1 && LK('UI-048', '#62')[0].strength === 'DOCS_ONLY_WEAK' && LK('UI-048', '#62')[0].source === 'docs-only-body' && rc('UI-048') === 'STATUS_ONLY_UNVERIFIED' && X('UI-048').evidenceClass === 'CORROBORATED_BY_WEAK_REF'
      && X('UI-048').corroboratingWeakPrs.join() === '62' && ['coded', 'integrated', 'tested'].every((k) => sub('UI-048')[k] === 'UNKNOWN') && !X('UI-048').integratedPrs.length && !X('UI-048').prs.length
      && X('UI-048').actual.start === null && X('UI-048').actual.lastMergedAt === null && !X('UI-048').ciRuns.length && X('UI-048').candidateLinks.includes('docs-only:#62') && X('UI-048').missingEvidence.some((x) => /^docs-only mention\(s\) PR #62 \(docs-only-body\)/.test(x)));
  check("K12b the docs-only commit of #62 ('docs(lanes): endpoint evidence repair (UI-048 consistency)', docs files only) is DOCS_ONLY_WEAK 'docs-only-commit': never the integrating commit or a start (live 0db05ce shape; without it UI-048 falls back to CORROBORATED_BY_COMMIT dated 2026-10-21T01:12:59Z)",
    !!docsCommit && docsCommit.strength === 'DOCS_ONLY_WEAK' && docsCommit.source === 'docs-only-commit' && X('UI-048').commitEvidence === null && X('UI-048').candidateLinks.includes(`docs-only-commit:${docsCommit.ref.slice(0, 7)}`) && X('UI-048').actual.start === null);
  check("K12c UI-049 (no progress claim, code row) is named by the TITLE and BRANCH of DOCS_ONLY #63 ('UI-049: wiring list (docs)'): both DOCS_ONLY_WEAK ('docs-only-title' / 'docs-only-branch'), NOT_STARTED, coded/integrated FALSE, no start, no linked PR (56e1791: RELINKED_MERGED_PR / TITLE, integrated TRUE, start 2026-10-21T02:00:00Z from #63)",
    LK('UI-049', '#63').map((l) => `${l.strength}:${l.source}`).sort().join() === 'DOCS_ONLY_WEAK:docs-only-branch,DOCS_ONLY_WEAK:docs-only-title' && st('UI-049') === 'NOT_STARTED' && sub('UI-049').coded === 'FALSE' && sub('UI-049').integrated === 'FALSE' && X('UI-049').actual.start === null && !X('UI-049').prs.length);
  check("K12d no under-report: MOB-40, whose own backlog record lists only docs/mobile/*.md, keeps DOCS_ONLY #64 ('MOB-40: mobile threat model (docs only)') as ID_IN_TITLE / ID_IN_BRANCH marked DOC_DELIVERABLE:BACKLOG_FILES: MERGED_NOT_VERIFIED / TITLE / HIGH, integratedPrs [64], start 'PR #64 createdAt' (MOB-12 keeps #51 by its document title: DOC_DELIVERABLE:TITLE)",
    LK('MOB-40', '#64').every((l) => ['ID_IN_TITLE', 'ID_IN_BRANCH'].includes(l.strength) && l.docsOnly === 'DOC_DELIVERABLE:BACKLOG_FILES') && LK('MOB-40', '#64').length === 2 && st('MOB-40') === 'MERGED_NOT_VERIFIED' && X('MOB-40').matchKind === 'TITLE' && X('MOB-40').confidence === 'HIGH' && X('MOB-40').integratedPrs.join() === '64' && X('MOB-40').actual.startSource === 'PR #64 createdAt'
      && LK('MOB-12', '#51').some((l) => l.strength === 'ID_IN_TITLE' && l.docsOnly === 'DOC_DELIVERABLE:TITLE') && st('MOB-12') === 'MERGED_NOT_VERIFIED');
  check("K12e controls: a body mention in a code PR (#65, apps/** file) still corroborates the merged claim of UI-050 at LOW (CORROBORATED_BY_PR / BODY, integratedPrs [65]); coordinator code under docs/ (#66 docs/planning/dispatch.mjs) is NOT docs-only, so CP-DISPATCH-X stays MERGED_NOT_VERIFIED / TITLE via #66",
    rc('UI-050') === 'CORROBORATED_BY_PR' && X('UI-050').matchKind === 'BODY' && X('UI-050').confidence === 'LOW' && X('UI-050').integratedPrs.join() === '65' && LK('UI-050', '#65')[0]?.strength === 'ID_IN_BODY'
      && st('CP-DISPATCH-X') === 'MERGED_NOT_VERIFIED' && X('CP-DISPATCH-X').integratedPrs.join() === '66' && LK('CP-DISPATCH-X', '#66').every((l) => ['ID_IN_TITLE', 'ID_IN_BRANCH'].includes(l.strength) && !l.docsOnly && !l.prFiles));
  check("K12f file list UNKNOWN keeps today's rule and is recorded: UI-004 (body of #11, no file list) stays CORROBORATED_BY_PR / BODY with the link marked prFiles UNKNOWN and missingEvidence naming #11; UI-005 (integrating commit without a file list) stays CORROBORATED_BY_COMMIT with missingEvidence naming the commit (no silent upgrade or downgrade)",
    rc('UI-004') === 'CORROBORATED_BY_PR' && LK('UI-004', '#11')[0]?.prFiles === 'UNKNOWN' && X('UI-004').missingEvidence.some((x) => /^docs-only check not run: file list of PR #11 UNKNOWN/.test(x))
      && rc('UI-005') === 'CORROBORATED_BY_COMMIT' && X('UI-005').missingEvidence.some((x) => /^docs-only check not run: file list of v7 commit [0-9a-f]{7} UNKNOWN/.test(x)));
  check('K12-ALL no live row is integrated, tested, dated or CI-credited through a DOCS_ONLY_WEAK link (PR or commit)',
    m.items.filter((x) => x.status !== 'OBSOLETE').every((x) => { const dw = m.links.filter((l) => l.itemId === x.id && l.strength === 'DOCS_ONLY_WEAK'); const prs = new Set(dw.filter((l) => l.kind === 'PR').map((l) => l.pr)); const shas = new Set(dw.filter((l) => l.kind === 'COMMIT').map((l) => l.ref.slice(0, 7)));
      return [...x.integratedPrs, ...x.prs].every((n) => !prs.has(n)) && ![...prs].some((n) => x.actual.startSource === `PR #${n} createdAt`) && !(x.commitEvidence && shas.has(x.commitEvidence.sha7)) && ![...shas].some((h) => String(x.actual.startSource || '').includes(h)); }));
}

// ---- M2: exact-id match for ids without trailing digits (PR title / branch)
check('M2 L-WORKFORCE linked to #26 by exact id in the title (ID_IN_TITLE) and is MERGED_NOT_VERIFIED', st('L-WORKFORCE') === 'MERGED_NOT_VERIFIED' && m.links.some((l) => l.itemId === 'L-WORKFORCE' && l.ref === '#26' && l.strength === 'ID_IN_TITLE'));
check("M2 CI-GREEN matched in title 'CI-green:' and branch feature/ci-green-fixes; PKG-LEASE1 in title 'v7 pkg-lease1:'", m.links.some((l) => l.itemId === 'CI-GREEN' && l.ref === '#27' && l.strength === 'ID_IN_BRANCH') && st('CI-GREEN') === 'MERGED_NOT_VERIFIED' && st('PKG-LEASE1') === 'MERGED_NOT_VERIFIED');
check('M2 SEC-IMPORT-GUARD-2 (title and branch) is not SEC-IMPORT-GUARD', !m.links.some((l) => l.itemId === 'SEC-IMPORT-GUARD' && l.ref === '#29') && st('SEC-IMPORT-GUARD') === 'UNKNOWN');
check('M2 literal scan: longest id wins, -<digit> blocks, slug branches match', literalIdScan('claude/pkg-lease1-wiring', ['PKG-LEASE1', 'PKG-LEASE1-WIRING'], 'branch').join() === 'PKG-LEASE1-WIRING' && literalIdScan('claude/lane-c-rdy-2a', ['C-RDY-2A'], 'branch').join() === 'C-RDY-2A' && literalIdScan('SEC-IMPORT-GUARD-2: x', ['SEC-IMPORT-GUARD'], 'title').length === 0 && literalIdScan('L-WORKFORCE UI-197', ['L-WORKFORCE'], 'title').join() === 'L-WORKFORCE');
// ---- M3: added items become MVP only by an explicit source (fails on 4fe58dd: every added item was FULL)
check('M3 an added item whose record PR is named by the MVP chain (#143, GITHUB_DELIVERY) is MVP with the rule as reason', by.get('COORD-FIRST-DELIVERY-WIRING').scope === 'MVP' && by.get('COORD-FIRST-DELIVERY-WIRING').scopeRule === 'MVP_CHAIN_PR:GITHUB_DELIVERY#143' && (m.reconciliation.mvpScope?.addedMvp || []).some((x) => x.id === 'COORD-FIRST-DELIVERY-WIRING'));
check('M3 other added items stay FULL_ONLY with the default reason; MVP denominator = baseline MVP + added MVP', by.get('COORD-Z').scope === 'FULL_ONLY' && /no explicit MVP source/.test(by.get('COORD-Z').scopeReason || '') && !!m.reconciliation.mvpScope && m.metrics.mvp.n === m.metrics.mvpBaseline.n + m.reconciliation.mvpScope.addedMvp.length && m.reconciliation.mvpScope.value === m.metrics.mvp.n);
// ---- parser unit cases on the real 19-Oct annotation shapes
const P = rules['link-patterns'].inventoryPrs;
const pr = (t) => parseInventoryPrs(t, P).map((r) => `${r.n}${r.form === 'RANGE' ? 'R' : ''}${r.nested ? 'N' : ''}:${r.role || '-'}`).join(' ');
check('parser: "#24, #25, #26 (open, consumers)" -> all three consumer', pr('#24, #25, #26 (open, consumers)') === '24:consumers 25:consumers 26:consumers');
check('parser: "#10 (merged...); #10 (merged); consumer scripts/merge-via-gate.mjs only on #11; #10" -> #11 consumer, #10 unannotated', pr('#10 (merged 2026-10-18T05:09Z, merge commit e12dbdd); #10 (merged); consumer scripts/merge-via-gate.mjs only on #11; #10') === '10:- 10:- 11:consumer 10:-');
check('parser: "#15 (#31 stacks on it); #17 (current); #14 (DUPLICATE, closed unmerged, superseded by #17)" -> #31 nested, #14 duplicate', pr('#15 (#31 stacks on it); #17 (current); #14 (DUPLICATE, closed unmerged, superseded by #17)') === '15:- 31N:nested 17:- 14:duplicate 17N:nested');
check('parser: "38 open PRs (live): #8, #15-#17" -> prefix role on all, range expanded', pr('38 open PRs (live): #8, #15-#17') === '8:open prs 15R:open prs 16R:open prs 17R:open prs');
check('parser: review notes in [..] never become roles ("#26[OPEN@x; review@head: scoped CLEAN (targeted tests only)]")', pr('#26[OPEN@0a60c14; review@head: scoped CLEAN COMMENT (code review + targeted tests only)]') === '26:-');
check('parser: "#6 + #7 (merged a5e2a68, cd4b104; #/operations; one work item)" -> both unannotated (";" inside () does not split)', pr('#6 + #7 (merged a5e2a68, cd4b104; #/operations; one work item)') === '6:- 7:-');
{
  const prMap = new Map([[25, {}], [26, {}]]);
  const other = (n, ann) => ((/UI-050/.test(ann) ? 'UI-050' : /UI-051/.test(ann) ? 'UI-051' : null));
  const refs = inventoryPrRefs({ prs: '#25 (UI-050 evidence lineage, open); #26 (UI-051 per-run test report, open)' }, prMap, P, () => 'STATUS19_CLAIMS_MERGED', other);
  check("R2 parser: '#25 (UI-050 evidence lineage, open); #26 (UI-051 ...)' on a merged-claim row -> WEAK other-item:UI-050 / other-item:UI-051 even with the STATUS19 gate", refs.map((r) => `${r.n}:${r.strength}:${r.reason}`).join() === '25:WEAK:other-item:UI-050,26:WEAK:other-item:UI-051');
}
check('push CI success on the integrating commit is not acceptance', by.get('C-RDY-1').status === 'MERGED_NOT_VERIFIED' && by.get('C-RDY-1').substeps.accepted === 'FALSE');
// known-id longest match
const ids = new Set(['UI-110', 'PQ-008', 'PQ-008-R1', 'UI-009', 'C-RDY-1']);
check('lane-a-ui-110 -> UI-110', knownIdScan('claude/lane-a-ui-110', ids).join() === 'UI-110');
check('PQ-008-R1 stays distinct from PQ-008', knownIdScan('fix PQ-008-R1', ids).join() === 'PQ-008-R1' && knownIdScan('PQ-008 only', ids).join() === 'PQ-008');
check('UI-1100 is not UI-110', knownIdScan('claude/lane-a-ui-1100', ids).length === 0);
check('lane-c-rdy-1 -> C-RDY-1', knownIdScan('claude/lane-c-rdy-1', ids).join() === 'C-RDY-1');
check('PR #21 (branch lane-a-ui-1100) is not linked to UI-110', !m.links.some((l) => l.itemId === 'UI-110' && l.ref === '#21'));
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
