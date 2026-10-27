//TR: Sentetik mini girdi paketi (ağsız kanıtlar için): her durum öncelik kuralını, kimlik taramasını (lane-a-ui-009 -> UI-009, UI-1100 != UI-110, PQ-008-R1 != PQ-008), gövde anmasının yalnız 'merge edildi' iddialı satırı desteklemesini, FAKE kabul kanıtının reddini ve PQ-007 tipi çelişkiyi kapsar. Ağ yoktur; tüm SHA'lar sentetiktir.
import crypto from 'node:crypto';

const S = (x) => crypto.createHash('sha256').update(String(x)).digest('hex').slice(0, 40);
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const COLS = ['id', 'title', 'requirement_ref', 'area', 'screen_role_phase_ref', 'frontend_files', 'backend_files_or_endpoints', 'prs', 'branch_sha', 'status', 'test_result', 'review_result', 'merge_status', 'ui_connected', 'api_connected', 'product_verified', 'missing_functions', 'dependencies', 'authority_needed', 'responsible_env_agent', 'priority', 'effort', 'confidence', 'oct31_impact', 'evidence'];
const dimOf = (id) => (id.startsWith('UI-') ? 'screens' : id.startsWith('WS-SC-') ? 'workspaces' : id.startsWith('UX-DEC-') ? 'ux-decisions' : id.startsWith('PH-') ? 'phases' : id.startsWith('F-LAB-') ? 'labs' : id.startsWith('G-EP-') ? 'endpoints' : id.startsWith('I-DP-') ? 'data-persistence' : id.startsWith('PT-') ? 'tasks' : id.startsWith('BL-REQ-') ? 'requirement-sets' : 'roles');

// [id, title, status19, prs, oct31, area, screen_role_phase_ref]
export const ROWS = [
  ['UI-001', 'Cockpit', 'INTEGRATED_NOT_VERIFIED', '#1', 'AT_RISK', 'cockpit', 'UI-001'],
  ['UI-002', 'Settings', 'INTEGRATED_NOT_VERIFIED', '#2; #3', 'AT_RISK', 'settings', 'UI-002'],
  ['UI-003', 'Return summary', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'x', 'UI-003'],
  ['UI-004', 'Body only merged claim', 'MERGED_NOT_INTEGRATED', 'none', 'AT_RISK', 'x', 'UI-004'],
  ['UI-005', 'Commit message claim', 'INTEGRATED_NOT_VERIFIED', 'none', 'NONE', 'x', 'UI-005'],
  ['G-EP-001', 'GET /health (READ)', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'G-backend-api', 'shell'],
  ['G-EP-002', 'IPC uasco:stop - Global Stop', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'G-backend-api (desktop main-process IPC)', 'app.js'],
  ['G-EP-003', 'POST /v1/absent (WRITE)', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'G-backend-api', 'x'],
  ['UI-006', 'Status only', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'x', 'UI-006'],
  ['UI-007', 'Founder stale', 'AUTHORITY_REQUIRED', 'none', 'NOT_DELIVERABLE', 'x', 'UI-007'],
  ['UI-008', 'Founder stale with body-only mention', 'AUTHORITY_REQUIRED', 'none', 'NOT_DELIVERABLE', 'x', 'UI-008'],
  ['UI-009', 'Relinked by branch', 'AUTHORITY_REQUIRED', 'none', 'AT_RISK', 'x', 'UI-009'],
  ['UI-010', 'Design only', 'DESIGN_ONLY', 'none', 'NONE', 'x', 'UI-010'],
  ['UI-011', 'Stale in progress', 'IN_PROGRESS', 'none', 'AT_RISK', 'x', 'UI-011'],
  ['UI-012', 'Implemented not tested', 'IMPLEMENTED_NOT_TESTED', 'none', 'AT_RISK', 'x', 'UI-012'],
  ['UI-013', 'Blocked', 'BLOCKED', 'none', 'NONE', 'x', 'UI-013'],
  ['UI-014', 'Closed only (PR #4)', 'PENDING_CI', '#4', 'AT_RISK', 'x', 'UI-014'],
  ['UI-015', 'Duplicate row', 'DUPLICATE', 'none', 'NONE', 'x', 'UI-015'],
  ['UI-016', 'Obsolete row', 'OBSOLETE', 'none', 'NONE', 'x', 'UI-016'],
  ['UI-017', 'Open PR (PR #5)', 'PENDING_REVIEW', '#5', 'AT_RISK', 'x', 'UI-017'],
  ['UI-110', 'Queue merged', 'AUTHORITY_REQUIRED', 'none', 'AT_RISK', 'x', 'UI-110'],
  ['I-DP-001', 'Project memory', 'DESIGN_ONLY', 'none', 'AT_RISK', 'I-data-persistence', 'x'],
  ['UI-018', 'Mobile home', 'DESIGN_ONLY', 'none', 'NOT_DELIVERABLE', 'mobile', 'UI-018'],
  ['PH-000', 'Private repo and toolchain baseline', 'AUTHORITY_REQUIRED', 'none', 'AT_RISK', 'TRUST_CORE / Period A', 'Phase 0'],
  ['PH-001', 'Canonical primitive registry', 'DESIGN_ONLY', '#31 (UI-DOMAIN-PACKS read-only catalog screen, open)', 'NONE', 'TRUST_CORE / Period A', 'Phase 1'],
  ['PH-002', 'Game Studio', 'DESIGN_ONLY', 'none', 'NOT_DELIVERABLE', 'SPECIALIZED_DOMAIN / Period N', 'Phase 2'],
  ['PH-003', 'Mission OS', 'DESIGN_ONLY', 'none', 'NONE', 'EXECUTION / Period B', 'Phase 3'],
  ['PH-004', 'Company OS', 'DESIGN_ONLY', 'none', 'NONE', 'BUSINESS_COMMUNICATION / Period B', 'Phase 4'],
  ['PT-001', 'Base CI green', 'BLOCKED', 'none', 'AT_RISK', 'platform/CI', 'L'],
  ['F-LAB-01', 'Game Execution & Device Lab', 'DESIGN_ONLY', 'none', 'NOT_DELIVERABLE', 'labs', 'UASCO-FAB-1; ROADMAP phases 2,3-4'],
  ['BL-REQ-DEV', 'Desktop requirements band', 'DESIGN_ONLY', 'none', 'NONE', 'Requirements (Master V2)', 'x'],
  ['WS-SC-01', 'SC-01 Global Desktop Shell', 'INTEGRATED_NOT_VERIFIED', '#1', 'AT_RISK', 'B-desktop-workspace', '3 screens: UI-001,UI-002,UI-003,UI-004,UI-005,UI-006,UI-007,UI-008,UI-009,UI-010,UI-011,UI-012,UI-013,UI-014,UI-015,UI-016,UI-017,UI-019,UI-020,UI-110'],
  ['UX-DEC-001', 'Cockpit decision', 'AUTHORITY_REQUIRED', 'none', 'NONE', 'C-ux-decision', 'SC-02'],
  ['UI-019', 'Accepted with evidence', 'INTEGRATED_NOT_VERIFIED', '#1', 'AT_RISK', 'x', 'UI-019'],
  ['UI-020', 'Fake acceptance', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'x', 'UI-020'],
  // typed 19-Oct prs references (H1): annotated / range / other-item / nested refs are WEAK and never upgrade a no-progress row
  ['UI-021', 'Consumer-annotated merged PR, no progress claim', 'DESIGN_ONLY', '#6 (open, consumer)', 'AT_RISK', 'x', 'UI-021'],
  ['UI-022', 'Range reference, no progress claim', 'AUTHORITY_REQUIRED', '#1-#2 (open; UASCO own UI a11y tests only)', 'AT_RISK', 'x', 'UI-022'],
  ['UI-023', 'Another item PR, no progress claim', 'DESIGN_ONLY', '#10 (UI-003 return summary, merged)', 'AT_RISK', 'x', 'UI-023'],
  ['UI-024', 'PR names the item', 'IN_PROGRESS', '#7', 'AT_RISK', 'x', 'UI-024'],
  ['UI-025', 'Merged claim with only a consumer reference', 'INTEGRATED_NOT_VERIFIED', '#6 (open, consumer)', 'AT_RISK', 'x', 'UI-025'],
  ['UI-026', 'Integrated with failing CI', 'INTEGRATED_NOT_VERIFIED', '#8', 'AT_RISK', 'x', 'UI-026'],
  ['UI-027', 'Nested reference, progress claim', 'IN_PROGRESS', '#4 (closed; #7 builds on it)', 'AT_RISK', 'x', 'UI-027'],
  // round 2: a partial EXPLICIT set with the item's own merged PR (UI-132 shape); a merged-claim row whose 19-Oct annotations name other
  // items (PH-045 shape); the two items those PRs belong to
  ['UI-028', 'Partial explicit set, own merged PR names the item', 'INTEGRATED_NOT_VERIFIED', '#40 claude/test-states (open); #41 claude/test-states-2 (open)', 'AT_RISK', 'x', 'UI-028'],
  ['UI-029', 'Evidence lineage', 'INTEGRATED_NOT_VERIFIED', '#43', 'AT_RISK', 'x', 'UI-029'],
  ['UI-030', 'Per-run test report', 'INTEGRATED_NOT_VERIFIED', '#44', 'AT_RISK', 'x', 'UI-030'],
  ['UI-031', 'Capture/Evidence Bus (PRs of other items)', 'INTEGRATED_NOT_VERIFIED', '#43 (UI-029 evidence lineage, open); #44 (UI-030 per-run test report, open)', 'AT_RISK', 'x', 'UI-031'],
  // round 3: other items' PRs cited in branch-slug form (UI-148 shape: #46's own title names no item, only the slug assigns it), a plain
  // reference whose PR title names another item (UI-133 shape), the 19-Oct prToWorkItems map assigning that PR to the row (control), a
  // PARTIAL set whose closed PR is another item's (UI-137 shape), a body-only integrating commit (UI-011 shape) and an unattributed
  // commit before the item's own PR (UI-205 shape)
  ['UI-032', 'Review decision records (PRs of other items, slug form)', 'INTEGRATED_NOT_VERIFIED', '#45 claude/l-assurance-ui033 (open); #46 claude/l-assurance-ui034 (open)', 'AT_RISK', 'x', 'UI-032'],
  ['UI-033', 'Reviews panel', 'PENDING_CI', '#45[OPEN@abc1234: re-review, not CLEAN]', 'AT_RISK', 'x', 'UI-033'],
  ['UI-034', 'Evidence graph', 'PENDING_CI', 'none', 'AT_RISK', 'x', 'UI-034'],
  ['UI-035', 'Agent identity card (plain reference to another item PR)', 'INTEGRATED_NOT_VERIFIED', '#47 claude/test-states-workforce (open); #48 (open)', 'AT_RISK', 'x', 'UI-035'],
  ['UI-036', 'Role taxonomy', 'PENDING_CI', '#48', 'AT_RISK', 'x', 'UI-036'],
  ['UI-037', 'Workforce view (19-Oct map assigns #48 to it)', 'INTEGRATED_NOT_VERIFIED', '#48 (open)', 'AT_RISK', 'x', 'UI-037'],
  ['UI-038', 'Checkpoint resume (closed PR of another item)', 'INTEGRATED_NOT_VERIFIED', '#47 claude/test-states-workforce (open); #49 claude/l-tower-trace-ui039 (open)', 'AT_RISK', 'x', 'UI-038'],
  ['UI-039', 'Trace waterfall', 'PENDING_CI', '#49', 'AT_RISK', 'x', 'UI-039'],
  ['UI-040', 'Journey strip (body-only integrating commit)', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'x', 'UI-040'],
  ['UI-041', 'Command matrix (own PR after an unattributed commit)', 'INTEGRATED_NOT_VERIFIED', '#57', 'AT_RISK', 'x', 'UI-041'],
  // intel-1.4 PR ownership rule: a test+states PR the 19-Oct map assigns to a PT row, cited by a UI row that later got its own PR (UI-133
  // shape) and by an MVP row with no own PR (UI-137 shape); a PR the map lists for two rows (SHARED); a PR whose title names one row while
  // the map lists another (conflict)
  ['UI-042', 'Workforce identity (another item test+states PR, own later PR)', 'INTEGRATED_NOT_VERIFIED', '#58 claude/test-states-workforce-2 (open)', 'AT_RISK', 'x', 'UI-042'],
  ['PT-090', 'test+states: workforce-2 (19-Oct map owner of #58)', 'INTEGRATED_NOT_VERIFIED', '#58', 'NONE', 'platform/tests', 'L'],
  ['UI-047', 'Tower stage list (only other items PRs, one closed)', 'INTEGRATED_NOT_VERIFIED', '#58 claude/test-states-workforce-2 (open); #49 claude/l-tower-trace-ui039 (open)', 'AT_RISK', 'x', 'UI-047'],
  ['UI-043', 'Shared PR row A (map lists UI-043 and UI-044)', 'INTEGRATED_NOT_VERIFIED', '#61', 'AT_RISK', 'x', 'UI-043'],
  ['UI-044', 'Shared PR row B', 'INTEGRATED_NOT_VERIFIED', '#61 (open)', 'AT_RISK', 'x', 'UI-044'],
  ['UI-045', 'Map-assigned row of a title/map conflict PR', 'INTEGRATED_NOT_VERIFIED', '#60', 'AT_RISK', 'x', 'UI-045'],
  ['UI-046', 'Title-named row of a title/map conflict PR', 'PENDING_CI', 'none', 'AT_RISK', 'x', 'UI-046'],
  // intel-1.5 docs-only rule (K12): a merged-claim row named only in a DOCS_ONLY PR body and a docs-only commit (G-EP-001 / UI-005 shape),
  // a no-claim row named by a DOCS_ONLY PR title, a merged-claim row named in a code PR body (control); Founder view (K7c): a stale
  // AUTHORITY_REQUIRED row whose own backlog record is BLOCKED, owned by FOUNDER and needs new authority (UI-004 shape, P0)
  ['UI-048', 'Endpoint evidence target (docs-only PR body + docs-only commit, merged claim)', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'x', 'UI-048'],
  ['UI-049', 'Wiring target named by a docs-only PR title (no progress claim)', 'DESIGN_ONLY', 'none', 'AT_RISK', 'x', 'UI-049'],
  ['UI-050', 'Merged claim named in a code PR body (control)', 'INTEGRATED_NOT_VERIFIED', 'none', 'AT_RISK', 'x', 'UI-050'],
  ['UI-051', 'Founder command center (UI-004 shape)', 'AUTHORITY_REQUIRED', 'none', 'AT_RISK', 'x', 'UI-051'],
  ['E-ROLE-UASCO-0001', 'Role (not a work item)', 'DESIGN_ONLY', 'none', 'NONE', 'roles', 'x'],
];

export const NOW = '2026-10-26T19:41:00Z';
const pr = (n, o) => ({ number: n, state: 'closed', draft: false, title: `PR ${n}`, headRef: `claude/x-${n}`, headSha: S(`head${n}`), base: 'v7/integration', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', closedAt: '2026-10-20T00:00:00Z', mergedAt: null, mergeCommitSha: null, autoMerge: false, user: 'u', url: `https://example.invalid/pull/${n}`, bodyTokens: [], bodySha: S(`body${n}`), ...o });
const merged = (n, at, o = {}) => pr(n, { mergedAt: at, mergeCommitSha: S(`merge${n}`), ...o });

export function miniBundle() {
  const items = ROWS.map(([id, title, status, prs, oct31]) => ({ id, dimension: dimOf(id), title, status, priority: 'P1', oct31_impact: oct31, ui: 'YES', api: 'YES', product_verified: 'NO', prs }));
  const csv = [COLS.join(','), ...ROWS.map(([id, title, status, prs, oct31, area, ref]) => COLS.map((c) => csvCell({ id, title, area, screen_role_phase_ref: ref, prs, status, oct31_impact: oct31, priority: 'P1', effort: 'S', confidence: 'HIGH', responsible_env_agent: id.startsWith('PH-') ? 'Founder + host' : 'cloud implementer', missing_functions: `missing for ${id}` }[c] ?? '')).join(','))].join('\n') + '\n';
  const pulls = [
    merged(1, '2026-10-18T04:00:00Z', { headRef: 'claude/lane-a-cockpit' }),
    merged(2, '2026-10-18T05:00:00Z'),
    pr(3), pr(4),
    pr(5, { state: 'open', closedAt: null, updatedAt: '2026-10-26T10:00:00Z', headRef: 'claude/lane-b-open' }),
    merged(6, '2026-10-18T06:00:00Z', { title: 'consumer screen' }),
    merged(7, '2026-10-18T07:00:00Z', { title: 'UI-024: real work', createdAt: '2026-10-17T07:00:00Z' }),
    merged(8, '2026-10-18T08:00:00Z', { title: 'wave 8' }),
    merged(10, '2026-10-19T10:00:00Z', { title: 'UI-003: return summary', headRef: 'claude/ui-003' }),
    merged(26, '2026-10-22T06:00:00Z', { title: 'L-WORKFORCE UI-197: read-only taxonomy', headRef: 'claude/l-workforce-ui197' }),
    merged(27, '2026-10-22T07:00:00Z', { title: 'CI-green: process-leak fix', headRef: 'feature/ci-green-fixes' }),
    merged(28, '2026-10-22T08:00:00Z', { title: 'v7 pkg-lease1: atomic lease', headRef: 'claude/atomic-lease' }),
    merged(29, '2026-10-22T09:00:00Z', { title: 'SEC-IMPORT-GUARD-2: follow-up', headRef: 'claude/sec-import-guard-2' }),
    pr(31, { title: 'UI-DOMAIN-PACKS read-only catalog', headRef: 'claude/l-domains', createdAt: '2026-10-18T21:59:29Z' }),
    merged(143, '2026-10-22T10:00:00Z', { title: 'COORD-FIRST-DELIVERY-WIRING: first-delivery chain', headRef: 'claude/coord-first-delivery-wiring' }),
    merged(11, '2026-10-19T11:00:00Z', { title: 'wave', bodyTokens: ['UI-004'] }),
    merged(12, '2026-10-19T12:00:00Z', { title: 'wave 2', bodyTokens: ['UI-008'] }),
    merged(13, '2026-10-19T13:00:00Z', { title: 'fix', headRef: 'claude/lane-a-ui-009' }),
    merged(20, '2026-10-22T02:09:57Z', { title: 'UI-110 reasons', headRef: 'claude/ui-110' }),
    merged(21, '2026-10-22T03:00:00Z', { title: 'unrelated', headRef: 'claude/lane-a-ui-1100' }),
    merged(22, '2026-10-22T04:02:05Z', { title: 'PQ-007 project memory', headRef: 'claude/pq-007' }),
    merged(23, '2026-10-22T01:13:13Z', { title: 'PQ-008 mobile core', headRef: 'claude/pq-008' }),
    merged(24, '2026-10-26T21:00:13Z', { title: 'C-RDY-1 readiness', headRef: 'claude/lane-c-rdy-1' }),
    merged(25, '2026-10-21T13:24:56Z', { title: 'lockfile', headRef: 'claude/pq-009' }),
    pr(30, { state: 'open', closedAt: null, updatedAt: '2026-10-26T18:00:00Z', title: 'founder tier', headRef: 'claude/coord-protected' }),
    merged(40, '2026-10-19T14:00:00Z', { title: 'test states projects', headRef: 'claude/test-states' }), pr(41, { title: 'test states studio', headRef: 'claude/test-states-2' }),
    merged(42, '2026-10-20T01:00:56Z', { title: 'UI-028: read-only closure checklist', headRef: 'claude/ui-028' }),
    merged(43, '2026-10-18T20:00:00Z', { title: 'L-ASSURANCE UI-029: evidence lineage', headRef: 'claude/l-assurance-lineage', createdAt: '2026-10-18T16:03:05Z' }),
    merged(44, '2026-10-18T21:00:00Z', { title: 'L-ASSURANCE UI-030: per-run test report', headRef: 'claude/l-assurance-report', createdAt: '2026-10-18T16:05:00Z' }),
    // round 3: PRs of other items cited by 19-Oct rows; #46 names its item nowhere itself (only UI-032's slug annotation assigns it to UI-034)
    merged(45, '2026-10-19T22:48:25Z', { title: 'L-ASSURANCE UI-033: reviews panel', headRef: 'claude/l-assurance-ui033', createdAt: '2026-10-18T16:02:59Z' }),
    merged(46, '2026-10-19T22:48:25Z', { title: 'L-ASSURANCE: evidence lineage (stacked)', headRef: 'claude/l-assurance-lineage-2', createdAt: '2026-10-18T16:03:05Z' }),
    merged(47, '2026-10-19T14:30:00Z', { title: 'test+states: workforce', headRef: 'claude/test-states-workforce', createdAt: '2026-10-19T00:36:54Z' }),
    merged(48, '2026-10-19T14:40:00Z', { title: 'L-WORKFORCE UI-036: role taxonomy', headRef: 'claude/l-workforce-ui036', createdAt: '2026-10-18T15:55:05Z' }),
    pr(49, { title: 'L-TOWER-TRACE UI-039: stage timeline', headRef: 'claude/l-tower-trace-ui039', createdAt: '2026-10-18T15:58:00Z' }),
    // round 3: bookkeeping PRs (backlog write-back / READY marking / a wave naming an id only in a 'DONE' status clause) and the items' own work
    merged(50, '2026-10-20T05:50:27Z', { title: 'Backlog write-back 5: UI-024 DONE + UI-010 non-READY + P0 DESIGN-EVIDENCE-X + D-2026-10-20-MOBILE (MOB-12..31 non-READY)', headRef: 'claude/backlog-writeback-5', createdAt: '2026-10-20T04:59:08Z' }),
    merged(51, '2026-10-20T10:54:56Z', { title: 'MOB-12: threat model (docs only)', headRef: 'claude/mob-12', createdAt: '2026-10-20T07:54:44Z' }),
    merged(52, '2026-10-20T16:30:22Z', { title: 'Integration wave B13: batch-5 desktop READY tasks + SEC-X follow-up (backlog only)', headRef: 'claude/integration-wave-b13', createdAt: '2026-10-20T15:10:13Z' }),
    merged(53, '2026-10-20T01:51:48Z', { title: 'Backlog: UI-028 DONE write-back + batch 3 (UI-029)', headRef: 'claude/backlog-batch-3', createdAt: '2026-10-20T01:20:00Z', bodyTokens: ['UI-006'] }),
    merged(54, '2026-10-20T01:51:49Z', { title: 'Integration wave B2: #42 UI-024 + backlog #53 (UI-028 DONE, batch 3)', headRef: 'claude/integration-wave-b2', createdAt: '2026-10-20T01:30:00Z' }),
    merged(57, '2026-10-17T16:17:05Z', { title: 'UI-041: command matrix follow-up', headRef: 'claude/ui-041', createdAt: '2026-10-17T16:10:07Z' }),
    // intel-1.4 ownership rule (map entries in inventory.json.prToWorkItems below)
    merged(58, '2026-10-19T22:48:25Z', { title: 'test+states: workforce-2 (functional/negative/a11y)', headRef: 'claude/test-states-workforce-2', createdAt: '2026-10-19T00:36:54Z' }),
    merged(59, '2026-10-21T10:00:00Z', { title: 'UI-042: workforce identity card', headRef: 'claude/ui-042', createdAt: '2026-10-20T08:00:00Z' }),
    merged(60, '2026-10-19T12:30:00Z', { title: 'L-TOWER UI-046: stage timeline', headRef: 'claude/l-tower-ui046', createdAt: '2026-10-18T12:00:00Z' }),
    merged(61, '2026-10-19T13:30:00Z', { title: 'Shared wiring (functional)', headRef: 'claude/shared-wiring', createdAt: '2026-10-18T13:00:00Z' }),
    // intel-1.5 docs-only rule (K12): file lists in v7.mergedPrFiles below
    merged(62, '2026-10-21T01:58:47Z', { title: 'LANE-B: endpoint evidence map (docs only)', headRef: 'claude/lane-b-endpoint-evidence-1', createdAt: '2026-10-21T01:26:00Z', bodyTokens: ['UI-048'] }),
    merged(63, '2026-10-21T03:00:00Z', { title: 'UI-049: wiring list (docs)', headRef: 'claude/ui-049-wiring-docs', createdAt: '2026-10-21T02:00:00Z' }),
    merged(64, '2026-10-21T04:00:00Z', { title: 'MOB-40: mobile threat model (docs only)', headRef: 'claude/mob-40', createdAt: '2026-10-21T03:30:00Z' }),
    merged(65, '2026-10-21T05:00:00Z', { title: 'wave 65 (code)', headRef: 'claude/wave-65', createdAt: '2026-10-21T04:30:00Z', bodyTokens: ['UI-050'] }),
    merged(66, '2026-10-21T06:00:00Z', { title: 'CP-DISPATCH-X: dispatcher', headRef: 'claude/cp-dispatch-x', createdAt: '2026-10-21T05:30:00Z' }),
  ];
  const mergedHeads = pulls.filter((p) => p.mergedAt);
  // changed files (v7.mergedPrFiles): code by default; bookkeeping / docs PRs list docs; #11 (UI-004's body-only PR) has NO list (UNKNOWN)
  const DOCS = { 50: ['docs/planning/BACKLOG_CHECKPOINT.json'], 51: ['docs/mobile/THREAT-MODEL.md'], 52: ['docs/planning/BACKLOG_CHECKPOINT.json'], 53: ['docs/planning/BACKLOG_CHECKPOINT.json'],
    62: ['docs/lanes/LANE-B-ENDPOINT-EVIDENCE.json', 'docs/lanes/LANE-B-ENDPOINT-EVIDENCE.md'], 63: ['docs/authority-requests/UI-049-wiring.md'], 64: ['docs/mobile/THREAT-MODEL-40.md'],
    66: ['docs/planning/dispatch.mjs', 'docs/planning/dispatch.proof.mjs'] };
  const mergedPrFiles = Object.fromEntries(mergedHeads.filter((p) => p.number !== 11).map((p) => [p.number, { method: 'DIRECT_MERGE', files: DOCS[p.number] || [`apps/desktop/renderer/views/pr-${p.number}.js`] }]));
  const commits = [{ sha: S('c-ui005'), at: '2026-10-15T00:00:00Z', subject: 'fix UI-005 crash', body: '' }, { sha: S('c-route'), at: '2026-09-23T00:00:00Z', subject: 'control api', body: '' },
    // M1 (round 2): bookkeeping commits that only mention ids never set a start; an item's own commit (subject head names it) does
    { sha: S('c-plan'), at: '2026-10-16T04:58:36Z', subject: 'planning: register MOB-11 as non-READY', body: '' },
    { sha: S('c-backlog'), at: '2026-10-16T05:14:33Z', subject: 'backlog: makes UI-024 READY (docs only)', body: '' },
    { sha: S('c-spec'), at: '2026-10-16T06:00:00Z', subject: 'MOB-6: screen specs (design only)', body: 'covers the UI-024 screen' },
    { sha: S('c-own'), at: '2026-10-17T03:00:00Z', subject: 'UI-028: closure checklist core', body: '' },
    // round 3: a coded item's own dispatch claim; an unattributed implementing commit that names its screens only in the body
    { sha: S('c-claim'), at: '2026-10-20T07:49:13Z', subject: 'dispatch-claim: MOB-12', body: '' },
    { sha: S('c-ux'), at: '2026-10-16T02:37:50Z', subject: 'v7 ux-projects: premium portfolio', body: 'Covers screens UI-040 (journey strip) and UI-041 (command matrix)' },
    // K12: a commit of the docs-only PR #62 whose message names UI-048 (0db05ce shape: 'docs(lanes): ... Docs only.')
    { sha: S('c-docs'), at: '2026-10-21T01:12:59Z', subject: 'docs(lanes): endpoint evidence repair (UI-048 consistency)', body: 'Docs only.' }];
  const reachable = [...mergedHeads.map((p) => p.mergeCommitSha), ...commits.map((c) => c.sha), S('head-lane-a-x')];
  // per-commit changed files (v7.commitFiles): code by default, the K12 docs commit lists docs only; c-ui005 (UI-005's integrating commit) has NO list
  const commitFiles = Object.fromEntries(commits.filter((c) => c.sha !== S('c-ui005')).map((c) => [c.sha, c.sha === S('c-docs') ? ['docs/lanes/LANE-B-ENDPOINT-EVIDENCE.md'] : ['apps/desktop/renderer/app.js']]));
  const checks = {};
  checks[S('head1')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: '2026-10-18T01:20:00Z' }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: '2026-10-18T01:40:00Z' }];
  checks[S('head8')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: null }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'failure', startedAt: '2026-10-18T01:00:00Z', completedAt: null }];
  for (const n of [6, 43, 44, 62, 63, 65]) checks[S(`head${n}`)] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: '2026-10-18T01:20:00Z' }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: '2026-10-18T01:40:00Z' }];
  // #58 (another item's test+states PR) failed on Windows; the row's own #59 is green
  checks[S('head58')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-19T01:00:00Z', completedAt: '2026-10-19T01:20:00Z' }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'failure', startedAt: '2026-10-19T01:00:00Z', completedAt: '2026-10-19T01:40:00Z' }];
  checks[S('head59')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-21T01:00:00Z', completedAt: '2026-10-21T01:20:00Z' }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-21T01:00:00Z', completedAt: '2026-10-21T01:40:00Z' }];
  checks[S('head2')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: null }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'failure', startedAt: '2026-10-18T01:00:00Z', completedAt: null }];
  const runs = [
    { id: 1001, name: 'CI', event: 'pull_request', status: 'completed', conclusion: 'success', runAttempt: 1, headSha: S('head24'), headBranch: 'claude/lane-c-rdy-1', createdAt: '2026-10-26T18:00:00Z', updatedAt: '2026-10-26T18:25:00Z', runStartedAt: '2026-10-26T18:00:10Z', prs: [24] },
    { id: 1002, name: 'CI', event: 'push', status: 'completed', conclusion: 'success', runAttempt: 2, headSha: S('merge24'), headBranch: 'v7/integration', createdAt: '2026-10-26T21:01:00Z', updatedAt: '2026-10-26T21:30:00Z', runStartedAt: '2026-10-26T21:01:05Z', prs: [] },
    { id: 1003, name: 'Windows Installer', event: 'push', status: 'completed', conclusion: 'success', runAttempt: 1, headSha: S('merge24'), headBranch: 'v7/integration', createdAt: '2026-10-26T21:01:00Z', updatedAt: '2026-10-26T21:20:00Z', runStartedAt: '2026-10-26T21:01:05Z', prs: [] },
  ];
  const queue = {
    builderCap: 3, maxOpenPrs: 10,
    tasks: [
      { id: 'UI-110', source: 'BACKLOG_CHECKPOINT (READY)', status: 'INTEGRATED', pr: '20', finalSha: S('head20').slice(0, 7), owner: 'builder' },
      { id: 'PQ-007', source: 'Inventory I-DP-001 Project Memory (DESIGN_ONLY)', status: 'TESTED', pr: '22', lane: 'B' },
      { id: 'PQ-008', source: 'docs/mobile MOB-6 (UI-018)', status: 'INTEGRATED', pr: '23', lane: 'C' },
      { id: 'PQ-008-R1', source: 'Review rejection of PR #23', status: 'INTEGRATED', pr: '23', lane: 'C' },
      { id: 'PQ-001', source: 'UASCO-AUD-072 (P2)', title: 'Renderer honesty', status: 'QUEUED', lane: 'A' },
      { id: 'PQ-002', source: 'UASCO-AUD-129 (P3)', title: 'Tower test', status: 'CLAIMED', lane: 'A', startedAt: '2026-10-26T12:00:00Z' },
      { id: 'PQ-003', source: 'UASCO-AUD-065', title: 'Accepted by record only', status: 'PRODUCT_ACCEPTED', lane: 'A' },
      { id: 'PQ-009', source: 'CI root cause', title: 'vite bump', status: 'INTEGRATED', pr: '25', lane: 'C' },
      { id: 'FD-QUEUE-X', source: 'Founder-owned blocker', title: 'Queue copy of FD-QUEUE-X', status: 'BLOCKED', owner: 'lane-a', lane: 'A' },
    ],
    founderQueue: [{ id: 'FQ-PQ-009', priority: '0', kind: 'FOUNDER_ONLY', action: 'Merge #25 (lockfile-only fix).' }, { item: 'Raise the 2-builder cap', why: 'explicit Founder limit' }, { item: 'UASCO-AUD-005 sandbox substrate decision', why: 'hardware' }],
    integrationQueue: { founderDecisions: ['D1 (blocks everything): repair review secrets; affects UI-007.', 'D2: merge permission for #20, after review.'] },
    productionLanes: { startedAt: '2026-10-21T07:23:41Z', deliverables: { 'LANE-A-x': { pr: 'branch only (PR limit)', branch: 'claude/lane-a-x', head: S('head-lane-a-x').slice(0, 7), status: 'TESTED', note: 'branch only' }, 'LANE-B-y': { pr: 'branch only (PR limit)', branch: 'claude/lane-b-y', head: S('head-lane-b-y').slice(0, 7), status: 'TESTED' }, 'LANE-B-REQ': { pr: 'branch only', branch: 'claude/lane-b-req', head: S('head-lane-b-req').slice(0, 7), status: 'AUTHORITY_REQUEST', note: 'authority request only' } } },
    coordinatorBuild: { 'COORD-Z': { branch: 'claude/coord-z', head: S('head-coord-z').slice(0, 7), status: 'IN_PROGRESS', owner: 'coord' }, 'COORD-FIRST-DELIVERY-WIRING': { pr: '143', branch: 'claude/coord-first-delivery-wiring', status: 'MERGED', owner: 'coord' } },
    integrationBoard: { prs: [{ pr: 30, owner: 'COORDINATOR', kind: 'x', state: 'DRAFT' }, { pr: 30, owner: 'COORDINATOR', kind: 'x', state: 'DRAFT' }], merges: [{ pr: 24, merge: S('merge24').slice(0, 7), by: 'auto', at: '2026-10-26T21:00:13Z', postMerge: 'VERIFIED' }] },
    autoMergeEvidence: [],
  };
  const shortMap = {}; const headDates = {};
  for (const h of ['head20', 'head-lane-a-x', 'head-lane-b-y', 'head-coord-z', 'head-lane-b-req']) { shortMap[S(h).slice(0, 7)] = S(h); headDates[S(h)] = '2026-10-20T00:00:00Z'; }
  const backlog = { tasks: [
    { id: 'MOB-6', title: 'Screen specs', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    { id: 'MOB-11', title: 'Repo validation scope', status: 'AUTHORITY_REQUIRED', owner: 'FOUNDER', dependsOn: ['MOB-6'] },
    { id: 'SEC-X', title: 'Import guard follow-up', status: 'READY', owner: 'CLOUD', dependsOn: [] },
    { id: 'UI-007+008', title: 'Two screens', status: 'BLOCKED', owner: 'FOUNDER', dependsOn: [] },
    { id: 'UI-010', title: 'Design only screen', status: 'DRAFT_NOT_READY', owner: 'LOCAL', dependsOn: [] },
    { id: 'CP-DONE-ONLY', title: 'Done by record only', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    // exact-id matching (M2): literal ids (no trailing -digits) found in PR titles/branches
    { id: 'L-WORKFORCE', title: 'Workforce lane', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    { id: 'CI-GREEN', title: 'CI green', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    { id: 'PKG-LEASE1', title: 'Lease package', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    { id: 'SEC-IMPORT-GUARD', title: 'Import guard', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    // round 3: a Founder blocker registered by a write-back PR (DESIGN-EVIDENCE-UNAVAILABLE shape); an item whose first title link is that PR (MOB-1 shape)
    { id: 'DESIGN-EVIDENCE-X', title: 'P0 blocker: approved design reference package not available', status: 'BLOCKED', owner: 'FOUNDER', priority: 'P0', requiresNewAuthority: true, dependsOn: [] },
    // Founder queue view (R3-L1): a BLOCKED Founder-owned item without new authority, a BLOCKED item needing new authority, a plain BLOCKED item
    { id: 'FD-SIGN-X', title: 'Release signing decision', status: 'BLOCKED', owner: 'FOUNDER', requiresNewAuthority: false, dependsOn: [] },
    { id: 'RESEAL-X', title: 'Trust-root reseal', status: 'BLOCKED', owner: 'LOCAL', requiresNewAuthority: true, dependsOn: [] },
    { id: 'LOCAL-BLOCKED-X', title: 'Locally blocked task', status: 'BLOCKED', owner: 'LOCAL', requiresNewAuthority: false, dependsOn: [] },
    { id: 'MOB-12', title: 'Mobile threat model', status: 'DONE', owner: 'CLOUD', dependsOn: [] },
    // K12: a documentation deliverable (its backlog files are all docs) and coordinator code under docs/ (NOT documentation)
    { id: 'MOB-40', title: 'Mobile threat model (phase 0)', status: 'DONE', owner: 'CLOUD', files: ['docs/mobile/THREAT-MODEL-40.md'], dependsOn: [] },
    { id: 'CP-DISPATCH-X', title: 'Dispatcher', status: 'DONE', owner: 'CLOUD', files: ['docs/planning/dispatch.mjs', 'docs/planning/dispatch.proof.mjs'], dependsOn: [] },
    // K7c / K7b: UI-004 shape (19-Oct AUTHORITY_REQUIRED row, own backlog record BLOCKED + FOUNDER + new authority, P0) and a BLOCKED item whose
    // queue owner (lane-a) precedes its FOUNDER backlog owner
    { id: 'UI-051', title: 'Founder command center', status: 'BLOCKED', owner: 'FOUNDER', priority: 'P0', requiresNewAuthority: true, dependsOn: [] },
    { id: 'FD-QUEUE-X', title: 'Founder-owned blocker with a lane queue task', status: 'BLOCKED', owner: 'FOUNDER', requiresNewAuthority: false, dependsOn: [] },
  ] };
  const wave0 = { packages: [{ id: 'C-RDY-1', priority: 'P0', order: 1, title: 'Role Readiness Auditor', dependsOn: [] }, { id: 'C-CTX-1', priority: 'P0', order: 2, title: 'Role Context Resolver', dependsOn: ['C-RDY-1'] }], founderDecisions: ['FD-1 Legacy alias approval: decide canonical skills; blocks C-BIND-1.'] };
  const contracts = [0, 1, 2, 3, 4].map((n) => ({ phase: n, title: ROWS.find((r) => r[0] === `PH-${String(n).padStart(3, '0')}`)[1], domain: ['TRUST_CORE', 'TRUST_CORE', 'SPECIALIZED_DOMAIN', 'EXECUTION', 'BUSINESS_COMMUNICATION'][n], state: 'PLANNED', dependsOn: n ? [n - 1] : [], riskLevel: 2, reviewProfile: 'STANDARD', review: ['independent Codex package review'], requiredArtifacts: [] }));
  const roadmap = {
    graph: { nodes: contracts.map((c) => ({ phase: c.phase, title: c.title, dependsOn: c.dependsOn, priority: c.phase < 3 ? 'CRITICAL_PATH' : 'NORMAL' })) }, contracts,
    waves: { waves: [{ id: 'W1', phaseIds: [0, 1, 2] }, { id: 'W2', phaseIds: [3, 4] }] }, criticalPath: { weightModel: 'UNIT_WEIGHT_UNTIL_RUNTIME_DURATION_DATA_EXISTS', phaseIds: [0, 1, 2], length: 3 },
    lanes: { lanes: [{ id: 'L1', phaseIds: [0, 1, 2, 3, 4] }] }, packages: { packages: [{ id: 'PKG-001', title: 'p', phaseIds: [1, 2], state: 'PLANNED', dependsOnPackages: [] }] }, schedulerTemplate: { updatedAt: null },
    periods: [{ period: 'A', title: 'Trust', phases: [0, 1, 2] }, { period: 'B', title: 'Org', phases: [3, 4] }], residue: { roadmapMd363: 1, roadmapMd40Dept: 1 }, attestations: [], dateFieldsFound: [],
  };
  const inputs = {
    schema: 'intel-inputs-1',
    meta: { refs: { v7: { sha: S('v7'), at: '2026-10-26T21:10:18Z' }, queue: { sha: S('queue'), at: '2026-10-26T21:00:00Z' }, reports: { sha: S('reports'), at: '2026-10-26T21:14:41Z' } }, inventoryBlob: S('inv'), csvBlob: S('csv'), inventoryBlobAtHead: S('inv'), cacheFrom: 'fixture' },
    inventory: { json: { items, prToWorkItems: { '#48': ['UI-036', 'UI-037'], '#58': ['PT-090'], '#60': ['UI-045'], '#61': ['UI-043', 'UI-044'] } }, csvText: csv },
    dependencyMap: { keystones: { 'K-CI': { resolvedBy: ['PT-001'] } }, edges: [{ from: 'PT-001', to: 'K-CI', type: 'depends-on' }] },
    roadmap,
    coordinator: { queue, ledger: { reviews: [{ pr: 24, sha: S('head24'), kind: 'full', verdict: 'NO_BLOCKERS', at: '2026-10-26T20:00:00Z' }] }, dispatch: { 'docs/cloud-production/dispatch/C-RDY-1.md': 'C-RDY-1 dispatch text' }, queueHistory: [
      { sha: S('q1'), at: '2026-10-21T01:00:00Z', tasks: [{ id: 'PQ-002', status: 'BLOCKED' }] }, { sha: S('q2'), at: '2026-10-21T05:00:00Z', tasks: [{ id: 'PQ-002', status: 'CLAIMED' }] }],
      decisionFirstSeen: { 'FQ-PQ-009': { sha: S('q1'), at: '2026-10-21T01:00:00Z' }, D1: { sha: S('q1'), at: '2026-10-21T21:23:25Z' } } },
    backlog, lanesJson: { capacity: { builderCap: 4 } }, protectedPaths: { exactPaths: ['apps/desktop/main.mjs'], protectedPrefixes: ['.github/'] }, wave0,
    registries: { roleDefs: { counts: { roles: 3, guilds: 1, clusters: 1, evaluationSpecs: 6, evaluationSpecsExecuted: 0, certified: 0, gapIds: 0 }, guilds: 1, clusters: 1, roles: 3 }, profiles: { counts: { boundRoles: 1, withCandidateSkills: 1 } }, adapters: { count: 2, byStatus: { REGISTERED: 2 }, byImplementation: { NOT_IMPLEMENTED: 2 } } },
    resolvers: [{ id: 'CAPABILITY_RESOLVER', path: 'core/capabilities/resolver.ts', symbol: 'resolveCapability', present: true, introducedBy: { sha: S('c-route'), at: '2026-09-23T00:00:00Z' }, tests: [], wave0Package: null }, { id: 'ROLE_CONTEXT_RESOLVER', path: 'core/agents/role-context.ts', symbol: 'resolveRoleContext', present: false, introducedBy: null, tests: [], wave0Package: 'C-CTX-1' }],
    pathsPresent: { '.github/workflows/desktop-journey-e2e.yml': false },
    v7: { reachable, commits, mergedPrFiles, commitFiles, routes: [{ method: 'GET', path: '/health', quote: '"', file: 'apps/control-api/src/server.ts' }], ipc: [{ channel: 'uasco:stop', quote: '"', file: 'apps/desktop/main.mjs' }],
      literalIntro: { 'ROUTE GET /health': { sha: S('c-route'), at: '2026-09-23T00:00:00Z' }, 'IPC uasco:stop': { sha: S('c-route'), at: '2026-09-23T00:00:00Z' } }, shortMap, headDates },
    github: { pulls, runs, checks, timings: { 1001: { runDurationMs: 1500000 } }, jobs: {}, runDetail: { timing24hCandidates: 1, timingFetched: 1, jobs7dCandidates: 1, jobsFetched: 0 }, prFiles: { 30: ['.github/workflows/ci.yml'] }, mergedBy: {}, freshness: { state: 'FRESH', asOf: NOW, error: null }, calls: 0, notModified: 0, rateRemaining: null, startAnchor: '2026-10-18T00:00:00Z', errors: [] },
    readiness: { state: 'UNAVAILABLE', reason: 'READINESS_RUNTIME_UNAVAILABLE' },
    texts: {}, pinnedCommits: {}, prior: [],
    overlayRefs: { [S('evidence-real')]: { exists: true, type: 'blob', fake: false }, [S('evidence-fake')]: { exists: true, type: 'blob', fake: true } },
  };
  const overlay = { entries: [
    { itemId: 'UI-019', action: 'ACCEPTANCE', value: 'MVP_UI_019', reason: 'real acceptance run recorded', by: 'coordinator', at: '2026-10-26T18:00:00Z', evidenceRef: S('evidence-real') },
    { itemId: 'UI-020', action: 'ACCEPTANCE', value: 'X', reason: 'fake run', by: 'coordinator', at: '2026-10-26T18:00:00Z', evidenceRef: S('evidence-fake') },
    { itemId: 'UI-006', action: 'SCOPE', value: 'MVP', by: 'coordinator', at: '2026-10-26T18:00:00Z' },
  ] };
  const meta = { engineTree: S('engine'), rulesBlobIds: { config: S('rules') }, overlayBlobId: S('overlay'), wave0BlobId: S('wave0'), fingerprint: S('fingerprint').padEnd(64, '0'), reused: false };
  return { inputs, overlay, meta, nowIso: NOW };
}
export { S };
