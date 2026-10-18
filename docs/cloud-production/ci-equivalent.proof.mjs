//TR: standalone proof for ci-equivalent.mjs (pure shaper only)
import { shapeCiEvidence } from './ci-equivalent.mjs';

const st = (name, exitCode) => ({ name, exitCode, durationMs: 1, stdoutTail: '' });
let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`PASS ${label}`); }
  else { failed++; console.log(`FAIL ${label}`); }
}

let r = shapeCiEvidence([st('a', 0), st('b', 0)]);
check('all exit0 -> overall PASS', r.overall === 'PASS' && r.steps.every((s) => s.result === 'PASS'));

r = shapeCiEvidence([st('a', 0), st('b', 1)]);
check('one exit1 -> overall FAIL', r.overall === 'FAIL' && r.steps[1].result === 'FAIL');

r = shapeCiEvidence([{ name: 'a', durationMs: 1 }]);
check('missing exitCode -> step+overall UNKNOWN', r.steps[0].result === 'UNKNOWN' && r.overall === 'UNKNOWN');

r = shapeCiEvidence([]);
check('empty steps -> UNKNOWN', r.overall === 'UNKNOWN');

r = shapeCiEvidence([st('a', 0), st('b', null)]);
check('PASS+UNKNOWN -> UNKNOWN', r.overall === 'UNKNOWN');

r = shapeCiEvidence([st('a', '0')]);
check('string "0" -> UNKNOWN (strict)', r.steps[0].result === 'UNKNOWN' && r.overall === 'UNKNOWN');

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
