//TR: cloud CI-equivalent evidence shaper (pure, fail-closed)
// INTERIM cloud evidence only. This is NOT a governance verdict and NOT a
// substitute for the required CI checks or the independent reviewer. It only
// reshapes observed step exit codes into an honest evidence object.
import { pathToFileURL } from 'node:url';

function resultFor(exitCode) {
  if (typeof exitCode !== 'number' || Number.isNaN(exitCode)) return 'UNKNOWN';
  return exitCode === 0 ? 'PASS' : 'FAIL';
}

export function shapeCiEvidence(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const shaped = list.map((s) => ({
    name: s?.name,
    result: resultFor(s?.exitCode),
    durationMs: s?.durationMs,
  }));
  let overall = 'UNKNOWN';
  if (shaped.some((s) => s.result === 'FAIL')) overall = 'FAIL';
  else if (shaped.length > 0 && shaped.every((s) => s.result === 'PASS')) overall = 'PASS';
  return { overall, steps: shaped };
}

// Optional CLI: node docs/cloud-production/ci-equivalent.mjs [cmd ...]
// Each arg is a shell command run as one step; prints the shaped evidence.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { spawnSync } = await import('node:child_process');
  const steps = process.argv.slice(2).map((cmd) => {
    const t = Date.now();
    const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
    return {
      name: cmd,
      exitCode: r.status,
      durationMs: Date.now() - t,
      stdoutTail: String(r.stdout || '').slice(-500),
    };
  });
  const ev = shapeCiEvidence(steps);
  console.log(JSON.stringify(ev, null, 2));
  process.exit(ev.overall === 'PASS' ? 0 : 1);
}
