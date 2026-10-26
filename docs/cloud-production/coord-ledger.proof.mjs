//TR: TEP-1 koordinatör ledger'ının bağımsız kanıt betiği (node docs/cloud-production/coord-ledger.proof.mjs). Ağ kullanmaz; geçici dizinde çalışır ve onu siler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { POLICY, load, save, reviewCheck, reviewRecord, testKey, testCheck, testRecord, fingerprintCompare, mergeGate } from './coord-ledger.mjs';

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const throws = (fn, msg) => { try { fn(); return false; } catch (e) { return e.message === msg; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-ledger-proof-'));
const S = (c) => c.repeat(40);
try {
  // Reviews: same PR+SHA+policy is never reviewed twice; later SHAs are deltas from the last reviewed head.
  let j = load(path.join(tmp, 'none.json'));
  check('empty ledger -> NEW full review', reviewCheck(j, { pr: 1, sha: S('a') }).state === 'NEW' && reviewCheck(j, { pr: 1, sha: S('a') }).kind === 'full');
  reviewRecord(j, { pr: 1, sha: S('a'), kind: 'full', verdict: 'BLOCKERS', ref: 'wf1' });
  check('same SHA -> DONE (code 0)', reviewCheck(j, { pr: 1, sha: S('a') }).code === 0);
  check('short SHA prefix matches the full SHA', reviewCheck(j, { pr: 1, sha: 'aaaaaaa' }).state === 'DONE');
  check('other PR, same SHA -> NEW', reviewCheck(j, { pr: 2, sha: S('a') }).state === 'NEW');
  const d = reviewCheck(j, { pr: 1, sha: S('b') });
  check('new SHA -> NEW delta from the last reviewed head', d.state === 'NEW' && d.kind === 'delta' && d.base === S('a') && d.round === 2);
  check('duplicate record refused', throws(() => reviewRecord(j, { pr: 1, sha: S('a'), kind: 'full', verdict: 'X', ref: 'r' }), 'ALREADY_RECORDED'));
  check('bad SHA refused', throws(() => reviewCheck(j, { pr: 1, sha: 'zz' }), 'BAD_ARGS'));
  j.reviews.push({ pr: 3, sha: S('c'), kind: 'full', verdict: 'NO_BLOCKERS', ref: 'old', policy: 'TEP-0' });
  check('a record under another policy version is not reused', reviewCheck(j, { pr: 3, sha: S('c') }).state === 'NEW');
  // Round limit: at most POLICY.maxReviewRounds distinct heads per PR; a security finding may exceed it.
  reviewRecord(j, { pr: 1, sha: S('b'), kind: 'delta', base: S('a'), verdict: 'BLOCKERS', ref: 'wf2' });
  reviewRecord(j, { pr: 1, sha: S('d'), kind: 'delta', base: S('b'), verdict: 'BLOCKERS', ref: 'wf3' });
  const lim = reviewCheck(j, { pr: 1, sha: S('e') });
  check(`round ${POLICY.maxReviewRounds + 1} -> ROUND_LIMIT (code 4)`, lim.code === 4 && lim.rounds === POLICY.maxReviewRounds);
  check('--security bypasses the round limit', reviewCheck(j, { pr: 1, sha: S('e'), security: true }).state === 'NEW');
  check('a reviewed head stays DONE after the limit', reviewCheck(j, { pr: 1, sha: S('d') }).state === 'DONE');

  // Merge gate (COORD-002): only a clean record for the CURRENT head opens it; an older head's clean record never does.
  j = load(path.join(tmp, 'none.json'));
  check('merge-gate: no record for the head -> CLOSED (code 5)', mergeGate(j, { pr: 9, sha: S('a') }).code === 5 && mergeGate(j, { pr: 9, sha: S('a') }).reason === 'NO_REVIEW_FOR_HEAD');
  reviewRecord(j, { pr: 9, sha: S('a'), kind: 'full', verdict: 'NO_BLOCKERS', ref: 'r1' });
  check('merge-gate: clean record for the head -> OPEN (code 0)', mergeGate(j, { pr: 9, sha: S('a') }).code === 0);
  check('merge-gate: a newer head with only the older head reviewed -> CLOSED (the #249 case)', mergeGate(j, { pr: 9, sha: S('b') }).reason === 'NO_REVIEW_FOR_HEAD');
  reviewRecord(j, { pr: 9, sha: S('b'), kind: 'delta', base: S('a'), verdict: 'BLOCKERS_HIGH', ref: 'r2' });
  check('merge-gate: blocking verdict -> CLOSED', mergeGate(j, { pr: 9, sha: S('b') }).reason === 'VERDICT_BLOCKING');
  reviewRecord(j, { pr: 9, sha: S('c'), kind: 'delta', base: S('b'), verdict: 'BASE_MERGE_ONLY_EMPTY_DELTA', ref: 'r3' });
  check('merge-gate: base-merge-only record -> OPEN', mergeGate(j, { pr: 9, sha: S('c') }).code === 0);
  check('merge-gate: other PR record never opens this PR', mergeGate(j, { pr: 10, sha: S('a') }).code === 5);
  check('merge-gate: a short SHA is refused (gate needs the exact head)', throws(() => mergeGate(j, { pr: 9, sha: 'aaaaaaa' }), 'BAD_ARGS'));

  // Tests: only a PASS under the same sha+scope+env+deps+config is reused.
  const wt = path.join(tmp, 'repo');
  fs.mkdirSync(wt);
  const git = (...a) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@p', GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@p' } });
  git('init', '-q'); fs.writeFileSync(path.join(wt, 'package-lock.json'), '{"v":1}'); fs.writeFileSync(path.join(wt, 'tsconfig.json'), '{}');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'one');
  j = load(path.join(tmp, 'none.json'));
  const k1 = testKey({ worktree: wt, scope: 'tests/a.test.ts' });
  check('fresh test key -> NEW', testCheck(j, k1.hash).state === 'NEW');
  testRecord(j, k1, { result: 'FAIL', ref: 'run1' });
  check('a FAIL is never reused', testCheck(j, k1.hash).state === 'NEW');
  testRecord(j, k1, { result: 'PASS', ref: 'run2' });
  check('same key PASS -> DONE', testCheck(j, k1.hash).state === 'DONE');
  check('another scope -> NEW', testCheck(j, testKey({ worktree: wt, scope: 'tests/b.test.ts' }).hash).state === 'NEW');
  fs.writeFileSync(path.join(wt, 'package-lock.json'), '{"v":2}');
  check('dirty worktree refused (no key for uncommitted code)', throws(() => testKey({ worktree: wt, scope: 'tests/a.test.ts' }), 'DIRTY_WORKTREE'));
  git('-c', 'commit.gpgsign=false', 'commit', '-qam', 'deps');
  const k2 = testKey({ worktree: wt, scope: 'tests/a.test.ts' });
  check('new commit + dependency change -> new key -> NEW', k2.hash !== k1.hash && k2.key.deps !== k1.key.deps && testCheck(j, k2.hash).state === 'NEW');

  // Fingerprint: order-independent; any head/draft/check change is CHANGED.
  j = load(path.join(tmp, 'none.json'));
  const st = { base: S('1'), prs: [{ number: 5, head: S('2'), draft: true, checks: { 'validate (ubuntu-latest)': 'success', 'validate (windows-latest)': 'in_progress' } }, { number: 4, head: S('3'), draft: false, checks: {} }] };
  check('first fingerprint -> CHANGED', fingerprintCompare(j, st).state === 'CHANGED');
  const reordered = { base: st.base, prs: [st.prs[1], { ...st.prs[0], checks: { 'validate (windows-latest)': 'in_progress', 'validate (ubuntu-latest)': 'success' } }] };
  check('same state, other order -> UNCHANGED', fingerprintCompare(j, reordered).state === 'UNCHANGED');
  check('a check conclusion change -> CHANGED', fingerprintCompare(j, { ...st, prs: [{ ...st.prs[0], checks: { ...st.prs[0].checks, 'validate (windows-latest)': 'failure' } }, st.prs[1]] }).state === 'CHANGED');
  check('a new base SHA -> CHANGED', fingerprintCompare(j, { ...st, base: S('9') }).state === 'CHANGED');

  // CLI + atomic save: exit codes are the contract the controller tick uses.
  const lp = path.join(tmp, 'ledger.json');
  const cli = (...a) => spawnSync(process.execPath, [fileURLToPath(new URL('./coord-ledger.mjs', import.meta.url)), ...a], { encoding: 'utf8', env: { ...process.env, COORD_LEDGER_PATH: lp } });
  check('CLI review-check on empty ledger exits 3 (NEW)', cli('review-check', '--pr', '7', '--sha', S('f')).status === 3);
  check('CLI review-record exits 0', cli('review-record', '--pr', '7', '--sha', S('f'), '--kind', 'full', '--verdict', 'NO_BLOCKERS', '--ref', 'wfX').status === 0);
  check('CLI review-check after record exits 0 (DONE)', cli('review-check', '--pr', '7', '--sha', 'fffffff').status === 0);
  fs.writeFileSync(path.join(tmp, 'st.json'), JSON.stringify(st));
  check('CLI fingerprint first run exits 3, second run exits 0', cli('fingerprint', '--input', path.join(tmp, 'st.json')).status === 3 && cli('fingerprint', '--input', path.join(tmp, 'st.json')).status === 0);
  check('CLI merge-gate exits 0 for a clean head and 5 for an unreviewed one', cli('merge-gate', '--pr', '7', '--sha', S('f')).status === 0 && cli('merge-gate', '--pr', '7', '--sha', S('e')).status === 5);
  check('CLI bad args exit 1 with COORD_LEDGER_ERROR', (() => { const r = cli('review-check', '--pr', 'x', '--sha', 'q'); return r.status === 1 && /COORD_LEDGER_ERROR/.test(r.stderr); })());
  check('saved ledger is valid JSON and no temp file is left', load(lp).reviews.length === 1 && fs.readdirSync(tmp).every((f) => !f.endsWith('.tmp')));
  save(load(lp), lp);
  check('a corrupt ledger is refused, not silently reset', (() => { fs.writeFileSync(lp, '{"schemaVersion":2}'); return throws(() => load(lp), 'LEDGER_INVALID'); })());
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
