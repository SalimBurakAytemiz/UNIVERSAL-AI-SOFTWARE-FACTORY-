//TR: cloud CI-equivalent evidence shaper (pure, fail-closed)
// INTERIM cloud evidence only. This is NOT a governance verdict and NOT a
// substitute for the required CI checks or the independent reviewer. It only
// reshapes observed step exit codes into an honest evidence object.
// Every output carries kind:"INTERIM_LOCAL_NOT_CI" so even an overall PASS can
// never be relayed as real CI.
import { pathToFileURL } from 'node:url';

// Only a genuine integer exit code is evidence; anything else is UNKNOWN.
function resultFor(exitCode) {
  if (!Number.isInteger(exitCode)) return 'UNKNOWN';
  return exitCode === 0 ? 'PASS' : 'FAIL';
}

// A step must be a non-null, non-array object; a hole, null, or primitive is
// UNKNOWN (never PASS).
function shapeStep(s) {
  const ok = typeof s === 'object' && s !== null && !Array.isArray(s);
  return {
    name: ok ? s.name : undefined,
    result: ok ? resultFor(s.exitCode) : 'UNKNOWN',
    durationMs: ok ? s.durationMs : undefined,
    signal: ok && typeof s.signal === 'string' ? s.signal : null,
    error: ok && typeof s.error === 'string' ? s.error : null,
  };
}

export function shapeCiEvidence(steps) {
  const list = Array.isArray(steps) ? steps : [];
  // Index-based on purpose: .map/.some/.every skip array holes, so a sparse
  // array (new Array(n), [x, <hole>]) would otherwise shrink to a fabricated PASS.
  const shaped = Array.from({ length: list.length }, (_, i) => shapeStep(list[i]));
  let overall = 'UNKNOWN';
  if (shaped.some((s) => s.result === 'FAIL')) overall = 'FAIL';
  else if (shaped.length > 0 && shaped.every((s) => s.result === 'PASS')) overall = 'PASS';
  return { kind: 'INTERIM_LOCAL_NOT_CI', overall, steps: shaped };
}

// Optional CLI: node docs/cloud-production/ci-equivalent.mjs [cmd ...]
// Each arg is a shell command run as one step; prints the shaped evidence.
// SECURITY: shell:true is for OPERATOR-TYPED commands only. Never pass repo,
// PR, issue, or any other untrusted text as an argument (shell injection).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { spawnSync } = await import('node:child_process');
  const steps = process.argv.slice(2).map((cmd) => {
    const t = Date.now();
    const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
    return {
      name: cmd,
      exitCode: r.status,
      signal: r.signal ?? null,
      error: r.error ? String(r.error.message ?? r.error) : null,
      durationMs: Date.now() - t,
      stdoutTail: String(r.stdout || '').slice(-500),
    };
  });
  const ev = shapeCiEvidence(steps);
  console.log(JSON.stringify(ev, null, 2));
  process.exit(ev.overall === 'PASS' ? 0 : 1);
}
