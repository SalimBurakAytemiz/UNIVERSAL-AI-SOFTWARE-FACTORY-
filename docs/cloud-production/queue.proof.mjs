//TR: CP-QUEUE bağımsız kanıt betiği (node docs/cloud-production/queue.proof.mjs)
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
check('STATUSES is exported with the exact queue statuses',
  STATUSES instanceof Set && STATUSES.size === 10 && STATUSES.has('READY') && STATUSES.has('NOT_STARTED') && !STATUSES.has('done'));

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
