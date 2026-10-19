//TR: standalone proof for ci-equivalent.mjs (pure shaper + CLI step result)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

// Index-based on purpose: .every/.some skip array holes, so a hole in the OUTPUT
// would vacuously pass them. Every output step must be a real UNKNOWN object.
const allUnknownByIndex = (r, n) => {
  if (r.steps.length !== n) return false;
  for (let i = 0; i < n; i++) {
    const s = r.steps[i];
    if (typeof s !== 'object' || s === null || s.result !== 'UNKNOWN') return false;
  }
  return true;
};

r = shapeCiEvidence(new Array(3));
check('new Array(3) (all holes) -> UNKNOWN, never PASS', r.overall === 'UNKNOWN' && allUnknownByIndex(r, 3));

const mixed = [st('a', 0)];
mixed.length = 2;
r = shapeCiEvidence(mixed);
check('[pass, <hole>] -> UNKNOWN, hole kept as UNKNOWN step',
  r.overall === 'UNKNOWN' && r.steps.length === 2 && r.steps[0].result === 'PASS' && r.steps[1].result === 'UNKNOWN');

const holeMid = [st('a', 0), , st('c', 0)]; // eslint-disable-line no-sparse-arrays
r = shapeCiEvidence(holeMid);
check('[pass, <hole>, pass] -> UNKNOWN', r.overall === 'UNKNOWN' && r.steps[1].result === 'UNKNOWN');

r = shapeCiEvidence([st('a', 1), , st('c', 0)]); // eslint-disable-line no-sparse-arrays
check('[fail, <hole>, pass] -> FAIL (FAIL still dominates)', r.overall === 'FAIL');

r = shapeCiEvidence([null, null]);
check('null entries -> UNKNOWN', r.overall === 'UNKNOWN' && allUnknownByIndex(r, 2));

r = shapeCiEvidence([st('a', 0), null]);
check('[pass, null] -> UNKNOWN', r.overall === 'UNKNOWN' && r.steps[1].result === 'UNKNOWN');

r = shapeCiEvidence([st('a', 0), undefined, 0, 'ok', [], true]);
check('undefined/primitive/array steps -> UNKNOWN', r.overall === 'UNKNOWN' && r.steps.slice(1).every((s) => s.result === 'UNKNOWN'));

for (const bad of [1.5, 0.5, -0.5, NaN, Infinity, -Infinity]) {
  r = shapeCiEvidence([st('a', bad)]);
  check(`non-integer exitCode ${bad} -> UNKNOWN`, r.steps[0].result === 'UNKNOWN' && r.overall === 'UNKNOWN');
}

r = shapeCiEvidence([st('a', 0), st('b', 0.5)]);
check('[pass, exitCode 0.5] -> UNKNOWN, not PASS', r.overall === 'UNKNOWN');

r = shapeCiEvidence('not-an-array');
check('non-array input -> UNKNOWN', r.overall === 'UNKNOWN' && r.steps.length === 0);

r = shapeCiEvidence([st('a', 0), st('b', 0)]);
check('kind marks output as interim, not CI (PASS)', r.kind === 'INTERIM_LOCAL_NOT_CI' && r.overall === 'PASS');
check('kind present on FAIL/UNKNOWN too',
  shapeCiEvidence([st('a', 1)]).kind === 'INTERIM_LOCAL_NOT_CI' && shapeCiEvidence([]).kind === 'INTERIM_LOCAL_NOT_CI');

r = shapeCiEvidence([{ name: 'a', exitCode: null, signal: 'SIGKILL', error: 'boom' }, { name: 'b', exitCode: 0, signal: 42, error: {} }]);
check('signal/error strings carried through, non-strings dropped',
  r.steps[0].signal === 'SIGKILL' && r.steps[0].error === 'boom' && r.steps[1].signal === null && r.steps[1].error === null && r.overall === 'UNKNOWN');

// CLI: operator-typed literal commands only (never repo/PR text). No shell here;
// the CLI itself runs each arg through a shell, as documented.
const script = fileURLToPath(new URL('./ci-equivalent.mjs', import.meta.url));
const runCli = (...cmds) => {
  const p = spawnSync(process.execPath, [script, ...cmds], { encoding: 'utf8' });
  let ev = null;
  try { ev = JSON.parse(p.stdout); } catch { /* leave null */ }
  return { code: p.status, ev };
};

let c = runCli('exit 0');
check('CLI: exit 0 -> overall PASS, kind INTERIM_LOCAL_NOT_CI, exit 0',
  c.code === 0 && c.ev?.overall === 'PASS' && c.ev.kind === 'INTERIM_LOCAL_NOT_CI' && c.ev.steps[0].signal === null && c.ev.steps[0].error === null);

c = runCli('exit 0', 'exit 3');
check('CLI: one failing command -> overall FAIL, exit 1', c.code === 1 && c.ev?.overall === 'FAIL' && c.ev.steps[1].result === 'FAIL');

// Output beyond spawnSync maxBuffer: Node kills the child (SIGTERM) and sets ENOBUFS.
const flood = `"${process.execPath}" -e "process.stdout.write('x'.repeat(4e6))"`;
c = runCli(flood);
check('CLI: r.error and r.signal recorded in step result, never PASS',
  c.code === 1 && c.ev?.overall === 'UNKNOWN' && c.ev.steps[0].result === 'UNKNOWN'
  && typeof c.ev.steps[0].error === 'string' && c.ev.steps[0].error.includes('ENOBUFS')
  && c.ev.steps[0].signal === 'SIGTERM');

console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
