//TR: reports/local/remaining-work.mjs ince sarmalayıcısının kanonik kaynağı: Intel V1 motorunu bulur (UASCO_INTEL_DIR, pqw çalışma ağacı, claude/coord-intel-v1 çalışma ağacı, aksi halde motoru içeren ilk ref'ten git archive ile ağaç sha'sına göre önbelleğe çıkarılmış kopya) ve `intel.mjs report` çalıştırır; --force ve --now aynen geçirilir.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const REPO = '/home/user/UNIVERSAL-AI-SOFTWARE-FACTORY-';
const SCRATCH = '/tmp/claude-0/-home-user-UNIVERSAL-AI-SOFTWARE-FACTORY-/2b112f87-31d8-5a52-96d5-8b4fa41b948c/scratchpad';
const SUB = 'docs/cloud-production/intel';
const has = (d) => !!d && fs.existsSync(path.join(d, 'intel.mjs'));
let dir = [process.env.UASCO_INTEL_DIR, path.join(SCRATCH, 'pqw', SUB), path.join('/dev/shm/wintel', SUB)].find(has);
if (!dir) {
  for (const ref of ['origin/uasco/production-queue', 'claude/coord-intel-v1']) {
    const t = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '-q', `${ref}:${SUB}`], { encoding: 'utf8' });
    if (t.status !== 0) continue;
    const root = path.join(SCRATCH, `intel-engine-${t.stdout.trim().slice(0, 12)}`);
    if (!has(path.join(root, SUB))) { fs.mkdirSync(root, { recursive: true }); const tar = spawnSync('git', ['-C', REPO, 'archive', ref, SUB], { maxBuffer: 1 << 28 }); spawnSync('tar', ['-x', '-C', root], { input: tar.stdout }); }
    dir = path.join(root, SUB); break;
  }
}
if (!has(dir)) { process.stdout.write('INTEL FAIL ENGINE_NOT_FOUND\n'); process.exit(1); }
const argv = process.argv.slice(2);
const pass = argv.flatMap((a, i) => (a === '--force' ? ['--force'] : a === '--now' && argv[i + 1] ? ['--now', argv[i + 1]] : []));
const r = spawnSync(process.execPath, [path.join(dir, 'intel.mjs'), 'report', '--repo', REPO, '--out', path.join(REPO, 'reports/local'), ...pass], { stdio: 'inherit' });
process.exit(r.status ?? 1);
