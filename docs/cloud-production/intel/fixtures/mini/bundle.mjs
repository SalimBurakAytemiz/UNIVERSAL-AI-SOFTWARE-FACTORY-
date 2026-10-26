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
  ];
  const mergedHeads = pulls.filter((p) => p.mergedAt);
  const commits = [{ sha: S('c-ui005'), at: '2026-10-15T00:00:00Z', subject: 'fix UI-005 crash', body: '' }, { sha: S('c-route'), at: '2026-09-23T00:00:00Z', subject: 'control api', body: '' }];
  const reachable = [...mergedHeads.map((p) => p.mergeCommitSha), ...commits.map((c) => c.sha), S('head-lane-a-x')];
  const checks = {};
  checks[S('head1')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: '2026-10-18T01:20:00Z' }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: '2026-10-18T01:40:00Z' }];
  checks[S('head8')] = [{ name: 'validate (ubuntu-latest)', status: 'completed', conclusion: 'success', startedAt: '2026-10-18T01:00:00Z', completedAt: null }, { name: 'validate (windows-latest)', status: 'completed', conclusion: 'failure', startedAt: '2026-10-18T01:00:00Z', completedAt: null }];
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
    ],
    founderQueue: [{ id: 'FQ-PQ-009', priority: '0', kind: 'FOUNDER_ONLY', action: 'Merge #25 (lockfile-only fix).' }, { item: 'Raise the 2-builder cap', why: 'explicit Founder limit' }, { item: 'UASCO-AUD-005 sandbox substrate decision', why: 'hardware' }],
    integrationQueue: { founderDecisions: ['D1 (blocks everything): repair review secrets; affects UI-007.', 'D2: merge permission for #20, after review.'] },
    productionLanes: { startedAt: '2026-10-21T07:23:41Z', deliverables: { 'LANE-A-x': { pr: 'branch only (PR limit)', branch: 'claude/lane-a-x', head: S('head-lane-a-x').slice(0, 7), status: 'TESTED', note: 'branch only' }, 'LANE-B-y': { pr: 'branch only (PR limit)', branch: 'claude/lane-b-y', head: S('head-lane-b-y').slice(0, 7), status: 'TESTED' } } },
    coordinatorBuild: { 'COORD-Z': { branch: 'claude/coord-z', head: S('head-coord-z').slice(0, 7), status: 'IN_PROGRESS', owner: 'coord' }, 'COORD-FIRST-DELIVERY-WIRING': { pr: '143', branch: 'claude/coord-first-delivery-wiring', status: 'MERGED', owner: 'coord' } },
    integrationBoard: { prs: [{ pr: 30, owner: 'COORDINATOR', kind: 'x', state: 'DRAFT' }, { pr: 30, owner: 'COORDINATOR', kind: 'x', state: 'DRAFT' }], merges: [{ pr: 24, merge: S('merge24').slice(0, 7), by: 'auto', at: '2026-10-26T21:00:13Z', postMerge: 'VERIFIED' }] },
    autoMergeEvidence: [],
  };
  const shortMap = {}; const headDates = {};
  for (const h of ['head20', 'head-lane-a-x', 'head-lane-b-y', 'head-coord-z']) { shortMap[S(h).slice(0, 7)] = S(h); headDates[S(h)] = '2026-10-20T00:00:00Z'; }
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
    inventory: { json: { items }, csvText: csv },
    dependencyMap: { keystones: { 'K-CI': { resolvedBy: ['PT-001'] } }, edges: [{ from: 'PT-001', to: 'K-CI', type: 'depends-on' }] },
    roadmap,
    coordinator: { queue, ledger: { reviews: [{ pr: 24, sha: S('head24'), kind: 'full', verdict: 'NO_BLOCKERS', at: '2026-10-26T20:00:00Z' }] }, dispatch: { 'docs/cloud-production/dispatch/C-RDY-1.md': 'C-RDY-1 dispatch text' }, queueHistory: [
      { sha: S('q1'), at: '2026-10-21T01:00:00Z', tasks: [{ id: 'PQ-002', status: 'BLOCKED' }] }, { sha: S('q2'), at: '2026-10-21T05:00:00Z', tasks: [{ id: 'PQ-002', status: 'CLAIMED' }] }],
      decisionFirstSeen: { 'FQ-PQ-009': { sha: S('q1'), at: '2026-10-21T01:00:00Z' }, D1: { sha: S('q1'), at: '2026-10-21T21:23:25Z' } } },
    backlog, lanesJson: { capacity: { builderCap: 4 } }, protectedPaths: { exactPaths: ['apps/desktop/main.mjs'], protectedPrefixes: ['.github/'] }, wave0,
    registries: { roleDefs: { counts: { roles: 3, guilds: 1, clusters: 1, evaluationSpecs: 6, evaluationSpecsExecuted: 0, certified: 0, gapIds: 0 }, guilds: 1, clusters: 1, roles: 3 }, profiles: { counts: { boundRoles: 1, withCandidateSkills: 1 } }, adapters: { count: 2, byStatus: { REGISTERED: 2 }, byImplementation: { NOT_IMPLEMENTED: 2 } } },
    resolvers: [{ id: 'CAPABILITY_RESOLVER', path: 'core/capabilities/resolver.ts', symbol: 'resolveCapability', present: true, introducedBy: { sha: S('c-route'), at: '2026-09-23T00:00:00Z' }, tests: [], wave0Package: null }, { id: 'ROLE_CONTEXT_RESOLVER', path: 'core/agents/role-context.ts', symbol: 'resolveRoleContext', present: false, introducedBy: null, tests: [], wave0Package: 'C-CTX-1' }],
    pathsPresent: { '.github/workflows/desktop-journey-e2e.yml': false },
    v7: { reachable, commits, routes: [{ method: 'GET', path: '/health', quote: '"', file: 'apps/control-api/src/server.ts' }], ipc: [{ channel: 'uasco:stop', quote: '"', file: 'apps/desktop/main.mjs' }],
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
