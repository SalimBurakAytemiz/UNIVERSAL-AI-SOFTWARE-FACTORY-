//TR: P5 durum ve kanıt kanıtı (tablo güdümlü, ağsız): merge != tamamlandı; 19 Ekim 'prs' metnindeki rol notlu/aralık/iç içe/başka kalemin PR'ı WEAK'tir ve ilerleme iddiasız satırı yükseltmez; kısmi merge PARTIAL'dır; gerçek başlangıç yalnız kalemin kendi kanıtından; rakamla bitmeyen kimlikler başlık/dalda tam eşleşir; backlog DONE, sözleşme PLANNED, kanıtsız PRODUCT_ACCEPTED, FAKE yürütücü ve installer çıktıları runtimeVerified/accepted üretmez; kanıtsız ACCEPTANCE overlay'i reddedilir; gövde anması yalnız 'merge edildi' iddialı satırı destekler; öncelik sırası; PQ-007 çelişkisi; en uzun bilinen kimlik eşleşmesi.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { miniBundle } from '../fixtures/mini/bundle.mjs';
import { loadRules } from '../lib/gather.mjs';
import { buildAll } from './pipeline.mjs';
import { knownIdScan, literalIdScan } from '../core/ids.mjs';
import { parseInventoryPrs } from './baseline.mjs';

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
check('tested: both required checks success -> TRUE; a failure -> FALSE; absent -> UNKNOWN', by.get('UI-001').substeps.tested === 'TRUE' && by.get('UI-026').substeps.tested === 'FALSE' && by.get('UI-003').substeps.tested === 'UNKNOWN');
// ---- H1: typed 19-Oct prs references (fails on 4fe58dd: every #N was EXPLICIT/HIGH)
const sub = (id) => by.get(id).substeps;
check('H1 consumer-annotated merged PR does not upgrade a DESIGN_ONLY row (UI-021: NOT_STARTED, integrated FALSE, WEAK role:consumer)', st('UI-021') === 'NOT_STARTED' && sub('UI-021').integrated === 'FALSE' && sub('UI-021').coded === 'FALSE' && (by.get('UI-021').weakInventoryRefs || []).join() === '#6 role:consumer' && by.get('UI-021').prs.length === 0);
check('H1 range reference #1-#2 is WEAK (UI-022: FOUNDER_ACTION_REQUIRED, integrated FALSE)', st('UI-022') === 'FOUNDER_ACTION_REQUIRED' && sub('UI-022').integrated === 'FALSE' && (by.get('UI-022').weakInventoryRefs || [null]).every((w) => / range #1-#2$/.test(w)));
check("H1 unannotated reference to another item's merged PR is WEAK (UI-023 cites #10 'UI-003: ...': NOT_STARTED)", st('UI-023') === 'NOT_STARTED' && sub('UI-023').integrated === 'FALSE' && (by.get('UI-023').weakInventoryRefs || []).join() === '#10 no-id-match');
check('H1 a PR whose title names the item is EXPLICIT for an IN_PROGRESS row (UI-024 #7 -> MERGED_NOT_VERIFIED, HIGH)', st('UI-024') === 'MERGED_NOT_VERIFIED' && rc('UI-024') === 'EXPLICIT_PR_MERGED_ALL' && by.get('UI-024').confidence === 'HIGH');
check("H1 the item's own title naming the PR ('(PR #5)') is EXPLICIT (UI-017 -> EXPLICIT_PR_OPEN)", rc('UI-017') === 'EXPLICIT_PR_OPEN' && st('UI-017') === 'IMPLEMENTED_NOT_MERGED');
check('H1 a WEAK reference only supports a merged-claim row, at LOW confidence (UI-025: CORROBORATED_BY_PR / INVENTORY_TEXT_WEAK / LOW)', rc('UI-025') === 'CORROBORATED_BY_PR' && by.get('UI-025').matchKind === 'INVENTORY_TEXT_WEAK' && by.get('UI-025').confidence === 'LOW');
check('H1 a #N nested in another ref\'s annotation is WEAK (UI-027 #7 nested; #4 no-id-match)', (by.get('UI-027').weakInventoryRefs || []).join() === '#4 no-id-match,#7 nested' && sub('UI-027').integrated === 'FALSE');
check('H1 PARTIAL is not integrated: UI-002 (#2 merged, #3 closed) has integrated PARTIAL, status not MERGED_NOT_VERIFIED, and the PARTIAL count is separate', sub('UI-002').integrated === 'PARTIAL' && st('UI-002') !== 'MERGED_NOT_VERIFIED' && m.metrics.full.substeps.integrated?.PARTIAL === 1 && m.metrics.full.substeps.integrated.TRUE === m.items.filter((x) => x.status !== 'OBSOLETE' && x.substeps.integrated === 'TRUE').length && by.get('UI-002').missingEvidence.some((x) => /^integrated: PARTIAL/.test(x)));
check('H1 v0 partition is unchanged: UI-021/UI-022/UI-023 keep baselineClass PR_MERGED_ALL (legacy view), evidenceBaselineClass is stale', ['UI-021', 'UI-022', 'UI-023'].every((id) => by.get(id).baselineClass === 'PR_MERGED_ALL' && /^STALE_/.test(by.get(id).evidenceBaselineClass || '')));
// ---- LOW: coded needs code that exists (merged/open PR, head); a closed-unmerged PR alone leaves coded UNKNOWN
check('coded: closed-unmerged-only PR gives coded UNKNOWN with missingEvidence (UI-014)', sub('UI-014').coded === 'UNKNOWN' && by.get('UI-014').missingEvidence.some((x) => /^coded: only closed-unmerged PR\(s\) #4/.test(x)));
// ---- M1: actual start only from the item's own evidence
check('M1 PH-001 cites a closed-unmerged PR of another item (#31): actual start UNKNOWN with sourcesChecked, phase actualStart null', by.get('PH-001').actual.start === null && by.get('PH-001').actual.startState === 'UNKNOWN' && (by.get('PH-001').actual.startSourcesChecked || []).length >= 5 && m.rm.byPhase.find((p) => p.id === 'PH-001').actualStart === null);
check('M1 UI-024 starts at its own merged PR #7 createdAt (2026-10-17T07:00:00Z)', by.get('UI-024').actual.start === '2026-10-17T07:00:00Z' && by.get('UI-024').actual.startSource === 'PR #7 createdAt');
check('M1 a closed-unmerged PR never sets a start (UI-014 #4 closed)', by.get('UI-014').actual.start === null);
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
