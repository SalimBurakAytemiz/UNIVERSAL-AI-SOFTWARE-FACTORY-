//TR: CP-QUEUE bağımsız kanıt betiği (node docs/cloud-production/queue.proof.mjs)
import { execFileSync } from 'node:child_process';
import { loadQueue, nextDispatchable, STATUSES } from './queue.mjs';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); }
}
const has = (q, code) => loadQueue(q).errors.some((e) => e.code === code);
const T = (o) => ({ owner: 'CLOUD', status: 'READY', authorizedBy: 'founder', ...o });

const valid = { tasks: [
  T({ id: 'A', status: 'DONE' }),
  T({ id: 'B', dependsOn: ['A'] }),
  T({ id: 'C', dependsOn: ['A'] }),
] };
check('valid queue loads ok', loadQueue(valid).ok === true && loadQueue(valid).errors.length === 0);
check('READY without authorizedBy -> UNAUTHORIZED_READY',
  has({ tasks: [T({ id: 'X', authorizedBy: undefined })] }, 'UNAUTHORIZED_READY'));
check('READY with unmet dep -> READY_WITH_UNMET_DEP',
  has({ tasks: [T({ id: 'D', status: 'IN_PROGRESS' }), T({ id: 'X', dependsOn: ['D'] })] }, 'READY_WITH_UNMET_DEP'));
check('READY protectedEdit -> READY_REQUIRES_PROTECTED_EDIT',
  has({ tasks: [T({ id: 'X', protectedEdit: true })] }, 'READY_REQUIRES_PROTECTED_EDIT'));
check('READY requiresNewAuthority -> READY_REQUIRES_NEW_AUTHORITY',
  has({ tasks: [T({ id: 'X', requiresNewAuthority: true })] }, 'READY_REQUIRES_NEW_AUTHORITY'));
check('duplicate id -> DUPLICATE_ID', has({ tasks: [T({ id: 'X' }), T({ id: 'X' })] }, 'DUPLICATE_ID'));
check('dangling dep -> DEP_ABSENT_FROM_BACKLOG',
  has({ tasks: [T({ id: 'X', dependsOn: ['NOPE'] })] }, 'DEP_ABSENT_FROM_BACKLOG'));
check('bad id/owner/status codes',
  has({ tasks: [{ id: '', owner: 'CLOUD', status: 'READY' }] }, 'TASK_ID_INVALID') &&
  has({ tasks: [T({ id: 'X', owner: 'BOT' })] }, 'OWNER_INVALID') &&
  has({ tasks: [T({ id: 'X', status: 'WAT' })] }, 'STATUS_INVALID'));
check('nextDispatchable returns first eligible READY', nextDispatchable(valid)?.id === 'B');
check('skips task in heldLeaseTaskIds', nextDispatchable(valid, ['B'])?.id === 'C');
check('skips task in openPrTaskIds', nextDispatchable(valid, [], ['B'])?.id === 'C');
check('returns null when all READY ids held', nextDispatchable(valid, ['B', 'C']) === null);
check('returns null for invalid queue',
  nextDispatchable({ tasks: [T({ id: 'X', authorizedBy: '' })] }) === null);
check('malformed dependsOn (string) -> DEPS_INVALID and not dispatched',
  has({ tasks: [T({ id: 'D', status: 'IN_PROGRESS' }), T({ id: 'X', dependsOn: 'D' })] }, 'DEPS_INVALID') &&
  nextDispatchable({ tasks: [T({ id: 'D', status: 'IN_PROGRESS' }), T({ id: 'X', dependsOn: 'D' })] }) === null);
check('dependsOn with non-string element -> DEPS_INVALID', has({ tasks: [T({ id: 'X', dependsOn: [1] })] }, 'DEPS_INVALID'));
check("truthy non-boolean protectedEdit ('true') rejected",
  has({ tasks: [T({ id: 'X', protectedEdit: 'true' })] }, 'READY_REQUIRES_PROTECTED_EDIT'));
check('truthy non-boolean requiresNewAuthority (1) rejected',
  has({ tasks: [T({ id: 'X', requiresNewAuthority: 1 })] }, 'READY_REQUIRES_NEW_AUTHORITY'));
check('explicit false protectedEdit/requiresNewAuthority accepted',
  loadQueue({ tasks: [T({ id: 'X', protectedEdit: false, requiresNewAuthority: false })] }).ok === true);
check('whitespace-only authorizedBy -> UNAUTHORIZED_READY',
  has({ tasks: [T({ id: 'X', authorizedBy: '   ' })] }, 'UNAUTHORIZED_READY'));
check('non-array heldLeaseTaskIds (string) fails closed to null', nextDispatchable(valid, 'B') === null);
check('non-array openPrTaskIds (non-iterable) fails closed to null', nextDispatchable(valid, [], 5) === null);
check('module does not mutate/declare ready', valid.tasks[0].status === 'DONE');

// Advisory remediation proofs
check('protectedEdit null rejected', has({ tasks: [T({ id: 'X', protectedEdit: null })] }, 'READY_REQUIRES_PROTECTED_EDIT'));
check("protectedEdit 'false' string rejected", has({ tasks: [T({ id: 'X', protectedEdit: 'false' })] }, 'READY_REQUIRES_PROTECTED_EDIT'));
check('non-string authorizedBy (number/object) rejected',
  has({ tasks: [T({ id: 'X', authorizedBy: 5 })] }, 'UNAUTHORIZED_READY') &&
  has({ tasks: [T({ id: 'X', authorizedBy: { a: 1 } })] }, 'UNAUTHORIZED_READY'));
check('Set / object lists fail closed to null',
  nextDispatchable(valid, new Set(['B'])) === null && nextDispatchable(valid, [], { B: 1 }) === null);
check('duplicate-id queue is never dispatched', nextDispatchable({ tasks: [T({ id: 'X' }), T({ id: 'X' })] }) === null);
const mixed = { tasks: [T({ id: 'F', owner: 'FOUNDER' }), T({ id: 'L', owner: 'LOCAL' }), T({ id: 'C1' })] };
check('owner filter: default CLOUD skips FOUNDER/LOCAL READY', nextDispatchable(mixed)?.id === 'C1');
check('owner filter: only FOUNDER task -> null for cloud',
  nextDispatchable({ tasks: [T({ id: 'F', owner: 'FOUNDER' })] }) === null);
check('owner filter: explicit owner selects LOCAL', nextDispatchable(mixed, [], [], 'LOCAL')?.id === 'L');
check('owner filter: unknown owner param -> null', nextDispatchable(mixed, [], [], 'BOT') === null);
check('zero-width-only authorizedBy rejected',
  has({ tasks: [T({ id: 'X', authorizedBy: '\u200B' })] }, 'UNAUTHORIZED_READY') &&
  has({ tasks: [T({ id: 'X', authorizedBy: ' \u200B\uFEFF ' })] }, 'UNAUTHORIZED_READY'));
check('authorizedBy with trailing zero-width rejected (ASCII allowlist)', has({ tasks: [T({ id: 'X', authorizedBy: 'abc\u200B' })] }, 'UNAUTHORIZED_READY'));
check('untrimmed ids -> TASK_ID_INVALID',
  has({ tasks: [T({ id: ' X' })] }, 'TASK_ID_INVALID') && has({ tasks: [T({ id: 'X\n' })] }, 'TASK_ID_INVALID'));
check('held/open compared exactly (no trim)', nextDispatchable(valid, ['B '])?.id === 'B' && nextDispatchable(valid, [], [' B'])?.id === 'B');
const live = nextDispatchable(valid);
live.status = 'DONE';
check('returns copy, not live task', valid.tasks[1].status === 'READY');

// Strict allowlist proofs
const auth = (a) => has({ tasks: [T({ id: 'X', authorizedBy: a })] }, 'UNAUTHORIZED_READY');
const cps = { U3164: '\u3164', U2800: '\u2800', U115F: '\u115F', UFFA0: '\uFFA0', U034F: '\u034F', UFE0F: '\uFE0F',
  NUL: '\0', ESC: '\x1b', LONE_SURROGATE: '\uD800', U0085: '\u0085' };
for (const [n, c] of Object.entries(cps)) {
  check(`authorizedBy rejects ${n} (alone, padded, and embedded)`,
    auth(c) && auth(`abc${c}`) && auth(`${c}abc`) && auth(`ab${c}cd`) && auth(c.repeat(5)));
}
check('authorizedBy rejects non-ASCII letters (by design)', auth('M\u00FCller') && auth('\u5F20\u4E09\u4E00'));
check('authorizedBy rejects too short / leading space / no alnum / newline / tab',
  auth('ab') && auth(' abc') && auth('   ') && auth('!!!') && auth('abc\n') && auth('a\tb') && auth('abc\r'));
check('authorizedBy accepts plain ASCII tokens', ['founder', 'a b', 'user@example.com', 'x-1'].every((a) => !auth(a)));
const badId = (i) => has({ tasks: [T({ id: i })] }, 'TASK_ID_INVALID');
check('ids with space, NUL, newline, trailing/leading ZWSP rejected',
  badId('a b') && badId('a\0b') && badId('a\nb') && badId('a\u200B') && badId('\u200Ba'));
check('ids with unicode / empty / slash rejected', badId('\u00E9') && badId('') && badId('a/b') && badId('a\u3164'));
check('ids with . _ : - accepted', loadQueue({ tasks: [T({ id: 'CP-1.a_b:c' })] }).ok === true);
const dq = { tasks: [T({ id: 'A', status: 'DONE' }), T({ id: 'B', dependsOn: ['A'] })] };
const got = nextDispatchable(dq);
got.dependsOn.push('ZZZ'); got.dependsOn[0] = 'MUTATED';
check('mutating returned dependsOn does not touch the input queue',
  dq.tasks[1].dependsOn.length === 1 && dq.tasks[1].dependsOn[0] === 'A' && got.dependsOn !== dq.tasks[1].dependsOn);
check('STATUSES is exported as a frozen array with the exact queue statuses',
  Array.isArray(STATUSES) && Object.isFrozen(STATUSES) && STATUSES.length === 11 && STATUSES.includes('READY') &&
  STATUSES.includes('NOT_STARTED') && STATUSES.includes('IN_REVIEW') && !STATUSES.includes('done'));
{
  let threw = false;
  try { STATUSES.push('EVIL'); } catch { threw = true; }
  try { STATUSES[0] = 'EVIL'; } catch { /* strict mode throws */ }
  check('mutating exported STATUSES does not widen validation',
    threw && !STATUSES.includes('EVIL') && has({ tasks: [T({ id: 'X', status: 'EVIL' })] }, 'STATUS_INVALID'));
}

// Delta-2 proofs: real backlog ids/statuses, id allowlist, TOCTOU, hostile input, placeholders
const REAL_IDS = ["UI-236", "UI-049", "UI-211", "CI-GREEN", "UI-227", "UI-037+046", "UI-205", "UI-071", "UI-074", "UI-248", "pkg-lease1", "pkg-lease1-wiring", "RESEAL-SERIALIZATION", "BACKLOG-SOURCE-REBASELINE", "UI-023", "UI-016", "UI-004", "UI-027+UI-220", "WP-COMPANY-WRITE", "FD-REL-1-GATED-SET", "RELEASE-SIGNATURE-PHASE0", "DOC-TRUTH-CANONICAL-STATUS", "ADVISORIES-F-PKGE-002-F-PKGR-001", "SCREEN-EVIDENCE-DEBT", "P0-REMAINDER-AUDIT", "P1-P2-BACKLOG-AUDIT", "HOME-DELIVERY-STATE", "PLANNED-SCAFFOLD-CLEANUP", "L-WORKFORCE", "L-TOWER-TRACE", "L-ASSURANCE", "L-ROUTES", "B2-UI-023", "B2-UI-124", "B2-UI-246", "B2-T-APPROVAL", "B2-T-RESOLVER", "B2-T-TEMPLATES", "B2-T-PREDEV", "B2-T-ACADEMY", "B2-T-COMPANY", "B2-T-SELFTESTS", "B2-SBOM", "CP-DISPATCH-IMPL", "CP-NODE24-ENV"];
const REAL_STATUSES = ['DONE', 'IN_REVIEW', 'BLOCKED', 'DRAFT_NOT_READY', 'AUTHORITY_REQUIRED'];
const realTasks = REAL_IDS.map((id, i) => ({ id, owner: 'LOCAL', status: REAL_STATUSES[i % REAL_STATUSES.length] }));
const rl = loadQueue({ tasks: realTasks });
check('ALL real backlog ids (incl. UI-037+046, UI-027+UI-220) accepted; no TASK_ID_INVALID',
  REAL_IDS.length === 45 && REAL_IDS.includes('UI-037+046') && REAL_IDS.includes('UI-027+UI-220') &&
  !rl.errors.some((e) => e.code === 'TASK_ID_INVALID' || e.code === 'STATUS_INVALID'));
check('all real backlog statuses accepted', REAL_STATUSES.every((s) => STATUSES.includes(s)));
check('IN_REVIEW is neither READY nor dispatched',
  nextDispatchable({ tasks: [T({ id: 'X', status: 'IN_REVIEW' })] }) === null &&
  loadQueue({ tasks: [T({ id: 'X', status: 'IN_REVIEW' })] }).ok === true);
check('IN_REVIEW dependency does not satisfy a READY dependent (not DONE)',
  has({ tasks: [T({ id: 'D', status: 'IN_REVIEW' }), T({ id: 'X', dependsOn: ['D'] })] }, 'READY_WITH_UNMET_DEP'));
{
  let live = null;
  try {
    live = JSON.parse(execFileSync('git', ['show', 'origin/claude/pensive-mayer-16pnt2:docs/planning/BACKLOG_CHECKPOINT.json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { /* ref not available: fixture above is the proof; not counted as pass/fail */ }
  if (live) {
    const lq = loadQueue({ tasks: live.tasks.map((t) => ({ id: t.id, owner: t.owner, status: t.status })) });
    check('LIVE origin backlog file: no id/status/owner rejected',
      !lq.errors.some((e) => ['TASK_ID_INVALID', 'STATUS_INVALID', 'OWNER_INVALID'].includes(e.code)));
    check('LIVE origin backlog authorizedBy strings pass',
      live.tasks.filter((t) => t.authorizedBy).every((t) => !auth(t.authorizedBy)));
  } else console.log('SKIP live origin backlog read (ref unavailable); fixture proofs apply');
}
check('real authorizedBy strings pass',
  !auth('FOUNDER-AUTHORIZATION:2026-10-18 in-session (Home Delivery state + planned scaffolding cleanup)') &&
  !auth('FOUNDER-APPROVAL:2026-10-18 in-session message (scope-limited; no protected edit, no new backend, no spend, no reseal)') &&
  !auth('FOUNDER-DIRECTIVE:2026-10-18 Cloud-only dispatch/next-step infra within current limits') &&
  !auth('FOUNDER-DIRECTIVE:2026-10-18 Cloud Node 24 permanent environment'));
check('ids with + accepted, lone punctuation rejected',
  loadQueue({ tasks: [T({ id: 'UI-037+046' })] }).ok === true &&
  ['.', '..', '-', ':', '+', '_', '+-.', '._:'].every((i) => badId(i)));
for (const ph of ['none', 'N/A', 'null', 'Undefined', 'TODO', 'tbd', 'None ', 'TBD']) {
  check(`placeholder authorizedBy '${ph}' rejected`, auth(ph));
}
check('authorizedBy containing a placeholder word within real text still accepted', !auth('founder none-needed ok'));

// TOCTOU: stateful getters must not produce a tainted dispatch
{
  let n = 0;
  const q = { tasks: [{ id: 'X', owner: 'CLOUD', status: 'READY', authorizedBy: 'founder',
    get protectedEdit() { return n++ === 0 ? undefined : true; } }] };
  const r = nextDispatchable(q);
  check('TOCTOU protectedEdit (undefined then true): not dispatched tainted', r === null || r.protectedEdit !== true);
  check('TOCTOU protectedEdit: dispatched copy is exactly the validated snapshot', r === null || r.protectedEdit === undefined);
  let m = 0;
  const q2 = { tasks: [{ id: 'Y', owner: 'CLOUD', status: 'READY', protectedEdit: false,
    get authorizedBy() { return m++ === 0 ? 'founder' : 'ㅤㅤㅤ'; } }] };
  const r2 = nextDispatchable(q2);
  check('TOCTOU authorizedBy (valid then U+3164): never dispatched with tainted value',
    r2 === null || r2.authorizedBy === 'founder');
  let k = 0;
  const q3 = { get tasks() { return k++ === 0 ? [T({ id: 'Z' })] : [T({ id: 'Z', protectedEdit: true })]; } };
  const r3 = nextDispatchable(q3);
  check('TOCTOU tasks getter: dispatch matches a single read', r3 === null || (r3.protectedEdit === undefined && k <= 1));
}

// Hostile input
{
  const throwing = { tasks: [{ id: 'X', owner: 'CLOUD', status: 'READY', get authorizedBy() { throw new Error('boom'); } }] };
  let r; let threw = false;
  try { r = loadQueue(throwing); } catch { threw = true; }
  check('throwing getter -> ok=false INPUT_HOSTILE, no throw', !threw && r.ok === false && r.errors.some((e) => e.code === 'INPUT_HOSTILE'));
  check('nextDispatchable on throwing getter -> null', (() => { try { return nextDispatchable(throwing) === null; } catch { return false; } })());
  const { proxy, revoke } = Proxy.revocable({ tasks: [] }, {});
  revoke();
  threw = false;
  try { r = loadQueue(proxy); } catch { threw = true; }
  check('revoked proxy -> ok=false INPUT_HOSTILE, no throw', !threw && r.ok === false && r.errors.some((e) => e.code === 'INPUT_HOSTILE'));
  const hostileTasks = { get tasks() { throw new Error('boom'); } };
  threw = false;
  try { r = loadQueue(hostileTasks); } catch { threw = true; }
  check('throwing tasks getter -> INPUT_HOSTILE', !threw && r.errors.some((e) => e.code === 'INPUT_HOSTILE'));
  const unclone = { tasks: [T({ id: 'A' }), T({ id: 'B', fn: () => 1 })] };
  r = loadQueue(unclone);
  check('one uncloneable task invalidates whole queue (fail-closed abort, not skip): QUEUE_UNCLONEABLE, no tasks, no dispatch',
    r.ok === false && r.tasks.length === 0 && r.errors.some((e) => e.code === 'QUEUE_UNCLONEABLE') && nextDispatchable(unclone) === null);
  const hostileList = [];
  Object.defineProperty(hostileList, 0, { get() { throw new Error('boom'); }, enumerable: true });
  check('hostile held/open lists fail closed to null', nextDispatchable(valid, hostileList) === null && nextDispatchable(valid, [], hostileList) === null);
}

// Review remediation: size cap, sparse arrays, ok=false => tasks:[], placeholder variants
{
  const sparse = []; sparse.length = 2 ** 28;
  let t0 = Date.now(); let r; let threw = false;
  try { r = loadQueue({ tasks: sparse }); } catch { threw = true; }
  check('sparse 2**28 array: no throw, < 1 s, QUEUE_TOO_LARGE, ok=false, tasks=[]',
    !threw && Date.now() - t0 < 1000 && r.ok === false && r.tasks.length === 0 && r.errors.length === 1 && r.errors[0].code === 'QUEUE_TOO_LARGE');
  const big = new Array(100001).fill(null).map((_, i) => T({ id: `I${i}` }));
  check('tasks.length 100001 -> QUEUE_TOO_LARGE', has({ tasks: big }, 'QUEUE_TOO_LARGE'));
  check('tasks.length exactly 100000 accepted', loadQueue({ tasks: big.slice(0, 100000) }).ok === true);
  const mid = []; mid.length = 50000;
  t0 = Date.now(); r = loadQueue({ tasks: mid });
  check('sparse array under cap: single aggregate TASK_ID_INVALID, not one per hole',
    Date.now() - t0 < 1000 && r.ok === false && r.errors.length === 1 && r.errors[0].code === 'TASK_ID_INVALID');
  check('ok=false always returns tasks:[]',
    [{ tasks: [T({ id: 'X', owner: 'BAD' })] }, { tasks: mid }, null, { tasks: 'x' }].every((q) => { const l = loadQueue(q); return l.ok === false && Array.isArray(l.tasks) && l.tasks.length === 0; }));
  const odd = { tasks: [{ id: 'A', owner: 'CLOUD', status: 'DONE', get dependsOn() { throw new Error('boom'); } }] };
  check('throwing getter inside a task: INPUT_HOSTILE, no throw', (() => { try { const l = loadQueue(odd); return !l.ok && l.errors.some((e) => e.code === 'INPUT_HOSTILE'); } catch { return false; } })());
  check('function value (non-hostile DataCloneError) -> QUEUE_UNCLONEABLE',
    has({ tasks: [T({ id: 'A', f: () => 1 })] }, 'QUEUE_UNCLONEABLE'));
  for (const ph of ['unknown', 'pending', 'xxx', 'XXXX', 'false', 'true', 'nobody', 'nil', 'tbc', 'na', 'N.A.', 'to-do', '---', 'Unknown ']) {
    check(`placeholder variant authorizedBy '${ph}' rejected`, auth(ph));
  }
  check('real text containing placeholder-ish words still accepted', !auth('founder pending-review ok'));
}

// Review remediation 2: dependsOn / error-count bounds
{
  let t0 = Date.now(); let r; let threw = false;
  const sp = Object.assign([], { length: 2 ** 32 - 1 });
  try { r = loadQueue({ tasks: [T({ id: 'S', dependsOn: sp })] }); } catch { threw = true; }
  check('dependsOn sparse length 2**32-1: no throw, < 1 s, DEPS_INVALID',
    !threw && Date.now() - t0 < 1000 && r.ok === false && r.errors.some((e) => e.code === 'DEPS_INVALID'));
  const dense = new Array(5e6).fill('A');
  t0 = Date.now(); threw = false;
  try { r = loadQueue({ tasks: [T({ id: 'A', status: 'DONE' }), T({ id: 'B', dependsOn: dense })] }); } catch { threw = true; }
  check('dependsOn dense 5e6 strings: < 1 s, DEPS_INVALID (cap checked before iteration)',
    !threw && Date.now() - t0 < 1000 && r.ok === false && r.errors.some((e) => e.code === 'DEPS_INVALID'));
  check('dependsOn exactly 1000 accepted, 1001 rejected',
    loadQueue({ tasks: [T({ id: 'A', status: 'DONE' }), T({ id: 'B', dependsOn: new Array(1000).fill('A') })] }).ok === true &&
    has({ tasks: [T({ id: 'A', status: 'DONE' }), T({ id: 'B', dependsOn: new Array(1001).fill('A') })] }, 'DEPS_INVALID'));
  const abs = loadQueue({ tasks: [T({ id: 'B', status: 'DONE', dependsOn: ['X1', 'X2', 'X3'] })] });
  check('DEP_ABSENT_FROM_BACKLOG aggregated: one error per task with a count',
    abs.errors.filter((e) => e.code === 'DEP_ABSENT_FROM_BACKLOG').length === 1 && /^3 dependencies/.test(abs.errors[0].detail));
  const many = Array.from({ length: 1e5 }, (_, i) => T({ id: `M${i}`, owner: 'BAD', status: 'BAD', dependsOn: 7 }));
  t0 = Date.now(); r = loadQueue({ tasks: many });
  check('1e5 invalid tasks: errors <= 1000, final ERRORS_TRUNCATED, < 2 s',
    Date.now() - t0 < 2000 && r.ok === false && r.errors.length <= 1000 && r.errors[r.errors.length - 1].code === 'ERRORS_TRUNCATED');
  check('few errors: no ERRORS_TRUNCATED entry', !has({ tasks: [T({ id: 'X', owner: 'BAD' })] }, 'ERRORS_TRUNCATED'));
}

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
