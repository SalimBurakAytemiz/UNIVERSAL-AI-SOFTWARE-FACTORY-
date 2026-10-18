//TR: CP-QUEUE bağımsız kanıt betiği (node docs/cloud-production/queue.proof.mjs)
import { loadQueue, nextDispatchable } from './queue.mjs';

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

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
