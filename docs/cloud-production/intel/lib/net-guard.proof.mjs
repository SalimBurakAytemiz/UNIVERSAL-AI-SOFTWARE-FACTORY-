//TR: Ağ koruması alt kanıtı (ağsız; node lib/net-guard.proof.mjs): yanındaki lib/net-guard.mjs ile ön yüklenmiş bir sonda süreci (strict ve proof kipleri) korumadan önce kod çalıştırma yollarını dener. K8: NODE_OPTIONS içinde tek tırnakla gizlenmiş --require (node tek tırnağı gruplamaz), bütünüyle tek tırnaklı, tırnaklı yol, çift tırnakla bölünmüş bayrak, argv / fork execArgv / NODE_OPTIONS --env-file(-if-exists) -> hepsi INTEL_NET_BLOCKED ve ön yükleme hiç çalışmaz; korumanın kendisi kabul edilir ve node alt sürecinin NODE_OPTIONS'u yalnız koruma importudur. K9: izin verilen node ve (strict) esbuild alt süreçlerine LD_*/DYLD_* ve yabancı NODE_OPTIONS geçmez. K10: process.execve ve process.dlopen her iki kipte engellidir. intel.proof.mjs bu dosyayı alt kanıt olarak çalıştırır ve P12g'de her koruma mutantında kendi korumasıyla yeniden çalıştırır.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD_URL = pathToFileURL(path.join(HERE, 'net-guard.mjs')).href;
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-proof-')));
const J = JSON.stringify;
try {
  const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
  const fakeEsbuild = path.join(bin, 'esbuild');
  fs.writeFileSync(fakeEsbuild, '#!/bin/sh\nenv\n', { mode: 0o755 });
  const mark = path.join(tmp, 'pre.mark');
  const pre = path.join(tmp, 'pre.cjs');
  fs.writeFileSync(pre, `require('fs').appendFileSync(${J(mark)}, 'PRELOAD_RAN\\n');\n`);
  const envFile = path.join(tmp, 'pre.env');
  fs.writeFileSync(envFile, `NODE_OPTIONS=--require ${pre}\n`);
  fs.writeFileSync(path.join(tmp, 'noop.mjs'), '');
  const probe = path.join(tmp, 'probe.mjs');
  fs.writeFileSync(probe, `import cp from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
const C = (e) => String((e && (e.code || e.name)) || e);
const o = { active: process.env.INTEL_NET_GUARD_ACTIVE || 'none' };
// K10 process-image replacement runs alone (when it is not blocked this process becomes /bin/sh and prints EXECVE_RAN)
if (process.argv[2] === 'execve') { try { process.execve('/bin/sh', ['/bin/sh', '-c', 'echo EXECVE_RAN'], { PATH: process.env.PATH }); o.execve = 'RAN'; } catch (e) { o.execve = C(e); } console.log(JSON.stringify(o)); process.exit(0); }
const sp = (args, env) => { try { const r = cp.spawnSync(process.execPath, args, { env: { PATH: process.env.PATH, ...(env || {}) }, encoding: 'utf8', timeout: 8000 }); return 'SPAWNED:' + String(r.stdout || '').trim().slice(0, 300); } catch (e) { return C(e); } };
const PRE = ${J(pre)}, ENVF = ${J(envFile)}, GUARD = ${J(GUARD_URL)};
// K8: NODE_OPTIONS preloads hidden by quoting (node groups only double quotes), and env-file indirection
o.k8singleInside = sp(['-e', '0'], { NODE_OPTIONS: "--title='a --require " + PRE + " b'" });
o.k8singleWhole = sp(['-e', '0'], { NODE_OPTIONS: "'--require " + PRE + "'" });
o.k8quotedPath = sp(['-e', '0'], { NODE_OPTIONS: "--require '" + PRE + "'" });
o.k8splitFlag = sp(['-e', '0'], { NODE_OPTIONS: '"--req"uire ' + PRE });
o.k8envFileArgv = sp(['--env-file=' + ENVF, '-e', '0']);
o.k8envFileIfExists = sp(['--env-file-if-exists', ENVF, '-e', '0']);
o.k8envFileOptions = sp(['-e', '0'], { NODE_OPTIONS: '--env-file=' + ENVF });
o.k8forkEnvFile = await new Promise((res) => { try { const ch = cp.fork(${J(path.join(tmp, 'noop.mjs'))}, [], { execArgv: ['--env-file=' + ENVF], stdio: 'ignore' }); ch.on('exit', () => res('RAN')); ch.on('error', (e) => res(C(e))); } catch (e) { res(C(e)); } });
// control: the guard itself is accepted, and a node child's NODE_OPTIONS is exactly the guard import (benign extras dropped)
o.k8guardOnly = sp(['-e', 'console.log(process.env.NODE_OPTIONS)'], { NODE_OPTIONS: '--max-old-space-size=64 --import ' + GUARD });
// K9: no dynamic-loader preload reaches an allowed child
o.k9node = sp(['-e', 'console.log(JSON.stringify({ ld: Object.keys(process.env).filter((k) => /^(LD_|DYLD_)/i.test(k)), no: process.env.NODE_OPTIONS }))'], { LD_PRELOAD: '/nonexistent/intel-ld.so', LD_LIBRARY_PATH: ${J(tmp)}, DYLD_INSERT_LIBRARIES: '/nonexistent/x.dylib' });
o.k9bin = (() => { if (o.active !== 'strict') return 'SKIPPED'; try { const r = cp.spawnSync(${J(fakeEsbuild)}, [], { env: { PATH: process.env.PATH, LD_PRELOAD: '/nonexistent/intel-ld.so', LD_AUDIT: '/nonexistent/a.so', DYLD_INSERT_LIBRARIES: '/x', NODE_OPTIONS: '--max-old-space-size=64 --import ' + GUARD }, encoding: 'utf8', timeout: 8000 }); return String(r.stdout || '').split('\\n').filter((l) => /^(LD_|DYLD_|NODE_OPTIONS=)/i.test(l)).join(';') || 'CLEAN'; } catch (e) { return C(e); } })();
// K10: native addon loading
o.dlopen = (() => { try { process.dlopen({ exports: {} }, ${J(path.join(tmp, 'x.node'))}); return 'LOADED'; } catch (e) { return C(e); } })();
console.log(JSON.stringify(o));
`);
  const run = (mode, ...args) => {
    const r = spawnSync(process.execPath, [probe, ...args], { encoding: 'utf8', cwd: tmp, timeout: 60000, env: { PATH: process.env.PATH, TMPDIR: tmp, NODE_OPTIONS: `--import ${GUARD_URL}`, INTEL_NET_GUARD: mode, INTEL_NET_GUARD_ALLOW_BIN_DIR: bin } });
    const last = String(r.stdout || '').trim().split('\n').pop();
    try { return { o: JSON.parse(last), raw: last }; } catch { return { o: null, raw: last }; }
  };
  for (const mode of ['strict', 'proof']) {
    const { o, raw } = run(mode);
    const ex = run(mode, 'execve');
    const B = (k) => !!o && o[k] === 'INTEL_NET_BLOCKED';
    check(`${mode}: probe ran under the guard (${o ? o.active : `no JSON: ${String(raw).slice(0, 60)}`})`, !!o && o.active === mode);
    check(`K8 ${mode}: NODE_OPTIONS preload hidden in single quotes (--title='a --require x b' ${o?.k8singleInside}; whole '...' ${o?.k8singleWhole}; --require '<path>' ${o?.k8quotedPath}; "--req"uire ${o?.k8splitFlag}) is refused (03ed064: SPAWNED, preload ran)`, ['k8singleInside', 'k8singleWhole', 'k8quotedPath', 'k8splitFlag'].every(B));
    check(`K8 ${mode}: --env-file indirection is refused (argv ${o?.k8envFileArgv}, --env-file-if-exists ${o?.k8envFileIfExists}, NODE_OPTIONS ${o?.k8envFileOptions}, fork execArgv ${o?.k8forkEnvFile}) (03ed064: SPAWNED / RAN)`, ['k8envFileArgv', 'k8envFileIfExists', 'k8envFileOptions', 'k8forkEnvFile'].every(B));
    check(`K8 ${mode}: control: the guard itself is accepted and a node child's NODE_OPTIONS is exactly the guard import (${o?.k8guardOnly})`, !!o && o.k8guardOnly === `SPAWNED:--import ${GUARD_URL}`);
    let k9 = null; try { k9 = JSON.parse(String(o?.k9node || '').replace(/^SPAWNED:/, '')); } catch { k9 = null; }
    check(`K9 ${mode}: LD_*/DYLD_* never reach an allowed node child and its NODE_OPTIONS is the guard import only (${o?.k9node}) (03ed064: LD_PRELOAD passed)`, !!k9 && Array.isArray(k9.ld) && k9.ld.length === 0 && k9.no === `--import ${GUARD_URL}`);
    if (mode === 'strict') check(`K9 strict: an allowed non-node child (esbuild under the bin dir) gets no LD_*/DYLD_* and only the guard import in NODE_OPTIONS (${o?.k9bin})`, !!o && (o.k9bin === 'CLEAN' || o.k9bin === `NODE_OPTIONS=--import ${GUARD_URL}`));
    check(`K10 ${mode}: process.execve is blocked (${ex.o ? ex.o.execve : `no JSON: ${String(ex.raw).slice(0, 40)}`}) (03ed064: the probe became /bin/sh, EXECVE_RAN)`, !!ex.o && ex.o.active === mode && ex.o.execve === 'INTEL_NET_BLOCKED');
    check(`K10 ${mode}: process.dlopen is blocked (${o?.dlopen}) (03ed064: blocked in strict only; proof mode reached the loader)`, B('dlopen'));
  }
  const ran = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim().split('\n').length : 0;
  check(`K8 no refused preload ever ran (marker lines ${ran})`, ran === 0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
