//TR: P5 durum ve kanıt kanıtı (tablo güdümlü, ağsız): merge != tamamlandı; backlog DONE, sözleşme PLANNED, kanıtsız PRODUCT_ACCEPTED, FAKE yürütücü ve installer çıktıları runtimeVerified/accepted üretmez; kanıtsız ACCEPTANCE overlay'i reddedilir; gövde anması yalnız 'merge edildi' iddialı satırı destekler; öncelik sırası; PQ-007 çelişkisi; en uzun bilinen kimlik eşleşmesi.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { miniBundle } from '../fixtures/mini/bundle.mjs';
import { loadRules } from '../lib/gather.mjs';
import { buildAll } from './pipeline.mjs';
import { knownIdScan } from '../core/ids.mjs';

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
  ['UI-001', 'MERGED_NOT_VERIFIED', 'EXPLICIT_PR_MERGED_ALL', 3], ['UI-002', 'MERGED_NOT_VERIFIED', 'EXPLICIT_PR_MERGED_PARTIAL', 3],
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
check('merged != COMPLETED: merged PR items are MERGED_NOT_VERIFIED with accepted FALSE', ['UI-001', 'UI-002', 'UI-110'].every((id) => st(id) === 'MERGED_NOT_VERIFIED' && by.get(id).substeps.accepted === 'FALSE'));
check('backlog DONE without evidence: UNKNOWN, never accepted or runtimeVerified', st('CP-DONE-ONLY') === 'UNKNOWN' && by.get('CP-DONE-ONLY').substeps.accepted === 'FALSE' && by.get('CP-DONE-ONLY').substeps.runtimeVerified === 'FALSE');
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
check('tested: both required checks success -> TRUE; a failure -> FALSE; absent -> UNKNOWN', by.get('UI-001').substeps.tested === 'TRUE' && by.get('UI-002').substeps.tested === 'FALSE' && by.get('UI-003').substeps.tested === 'UNKNOWN');
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
