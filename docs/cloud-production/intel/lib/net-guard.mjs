//TR: Ağ koruması (NODE_OPTIONS=--import ile ön yüklenir; ürün kodu için asıl sınır readiness-runner'daki ad alanı kum havuzudur, bu koruma derinlemesine savunmadır): Node içinden her TCP/UDP/TLS/HTTP/DNS/fetch/WebSocket bağlantısını, ham soket/süreç bağlamalarını (process.binding tcp_wrap/pipe_wrap/process_wrap/spawn_sync, dlopen) ve izinsiz alt süreci (curl, sh, ...) INTEL_NET_BLOCKED hatasıyla durdurur. Yalnız gerçek yolu (realpath) os.tmpdir() altındaki unix soketleri (tsx IPC) ve yalnız process.execPath (koruma, NODE_OPTIONS ve kip ortamına ZORLA yazılarak devralınır; fork execPath'i de denetlenir) izinlidir. Kipler: strict (hazırlık ölçümü: ek olarak yalnız INTEL_NET_GUARD_ALLOW_BIN_DIR altındaki esbuild ikilisi; Worker ve yerel eklenti yasak) ve proof (kanıtlar: git yalnız GIT_ALLOW_PROTOCOL=file ile, tar, ad alanı kum havuzu için unshare).
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import wt from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

export const NET_BLOCKED = 'INTEL_NET_BLOCKED';
const MODE = process.env.INTEL_NET_GUARD === 'proof' ? 'proof' : 'strict';
const ALLOW_BIN_DIR = process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR ? path.resolve(process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR) : null;
const fail = (what) => { const e = new Error(`${NET_BLOCKED}: ${what} blocked by the Intel network guard`); e.code = NET_BLOCKED; return e; };
const real = (p) => { try { return fs.realpathSync(p); } catch { try { return path.join(fs.realpathSync(path.dirname(path.resolve(p))), path.basename(p)); } catch { return null; } } };
const TMP = real(os.tmpdir()) || path.resolve(os.tmpdir());
// a unix socket is local only when its REAL path (symlinks resolved) is under the temp dir: a symlink in tmpdir to a host socket is refused
const localSocket = (p) => { if (typeof p !== 'string' || !p.length || p.startsWith('\0')) return false; const r = real(p); return !!r && r.startsWith(TMP + path.sep); };
const GUARD_URL = import.meta.url;
const EXEC_REAL = real(process.execPath);

// ---- sockets: only unix sockets under the temp dir (tsx IPC); every host:port connect throws before any packet is sent
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const a0 = args[0];
  const opts = Array.isArray(a0) ? a0[0] : a0 && typeof a0 === 'object' ? a0 : null;
  const p = opts ? opts.path : typeof a0 === 'string' && !/^\d+$/.test(a0) ? a0 : null;
  if (p && localSocket(p)) return origConnect.apply(this, args);
  throw fail(`net connect ${opts ? `${opts.host ?? ''}:${opts.port ?? ''}` : String(a0)}`);
};
const blockFn = (what) => () => { throw fail(what); };
tls.connect = blockFn('tls.connect');
for (const [mod, name] of [[http, 'http'], [https, 'https']]) {
  for (const fn of ['request', 'get']) {
    const orig = mod[fn];
    mod[fn] = function guardedRequest(...args) {
      const o = args.find((x) => x && typeof x === 'object' && !(x instanceof URL));
      if (name === 'http' && o && localSocket(o.socketPath)) return orig.apply(this, args);
      throw fail(`${name}.${fn}`);
    };
  }
}
http2.connect = blockFn('http2.connect');
dgram.createSocket = blockFn('dgram.createSocket');
// IP literals resolve locally (no query is sent), so listen('127.0.0.1') keeps working; every name lookup is blocked
const origLookup = dns.lookup;
dns.lookup = function guardedLookup(host, ...rest) { if (typeof host === 'string' && net.isIP(host)) return origLookup.call(this, host, ...rest); throw fail(`dns.lookup ${host}`); };
for (const fn of ['lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'resolvePtr', 'resolveNaptr', 'resolveSoa', 'resolveCaa', 'reverse']) {
  if (typeof dns[fn] === 'function') dns[fn] = blockFn(`dns.${fn}`);
  if (dns.promises && typeof dns.promises[fn] === 'function') dns.promises[fn] = async () => { throw fail(`dns.promises.${fn}`); };
}
if (dns.promises) { const pl = dns.promises.lookup; dns.promises.lookup = async (host, ...rest) => { if (typeof host === 'string' && net.isIP(host)) return pl(host, ...rest); throw fail(`dns.promises.lookup ${host}`); }; }
if (dns.Resolver) dns.Resolver = class { constructor() { throw fail('dns.Resolver'); } };
globalThis.fetch = async () => { throw fail('fetch'); };
for (const g of ['WebSocket', 'EventSource']) if (g in globalThis) globalThis[g] = class { constructor() { throw fail(g); } };

// ---- raw bindings: the public process.binding() hands out the socket/process wraps that net/child_process are built on
const BLOCKED_BINDINGS = new Set(['tcp_wrap', 'udp_wrap', 'pipe_wrap', 'stream_wrap', 'tls_wrap', 'js_stream', 'cares_wrap', 'process_wrap', 'spawn_sync', 'http_parser', 'uv']);
const origBinding = process.binding;
process.binding = function guardedBinding(name) { if (BLOCKED_BINDINGS.has(String(name))) throw fail(`process.binding ${name}`); return origBinding.call(this, name); };
if (typeof process._linkedBinding === 'function') process._linkedBinding = blockFn('process._linkedBinding');
if (MODE === 'strict') process.dlopen = blockFn('process.dlopen');

// ---- child processes: only this node binary (the guard, its mode and NODE_OPTIONS are FORCED into the child's env, so a caller-supplied
// env cannot drop them); proof: git (file protocol only), tar and unshare; strict: the esbuild binary under the allowed bin dir
const isNode = (file) => { const f = String(file ?? ''); return f === process.execPath || (!!EXEC_REAL && real(f) === EXEC_REAL); };
const allowed = (file) => {
  const f = String(file ?? '');
  const b = path.basename(f);
  if (isNode(f)) return true;
  if (MODE === 'proof') return b === 'git' || b === 'tar' || b === 'unshare';
  const r = ALLOW_BIN_DIR ? real(f) : null;
  return !!(r && b === 'esbuild' && r.startsWith(ALLOW_BIN_DIR + path.sep));
};
const BAD_NODE_FLAG = /^--(?:expose[-_]internals|allow[-_]natives[-_]syntax)(?:=|$)/;
const guardEnv = (env) => {
  const e = { ...(env || process.env) };
  const imp = `--import ${GUARD_URL}`;
  const no = String(e.NODE_OPTIONS || '');
  e.NODE_OPTIONS = no.includes(imp) ? no : `${imp}${no ? ` ${no}` : ''}`;
  // a child may tighten proof -> strict, never loosen strict -> proof; under strict the allowed bin dir is the parent's
  e.INTEL_NET_GUARD = MODE === 'strict' || e.INTEL_NET_GUARD === 'strict' ? 'strict' : 'proof';
  if (MODE === 'strict') { if (process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR) e.INTEL_NET_GUARD_ALLOW_BIN_DIR = process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR; else delete e.INTEL_NET_GUARD_ALLOW_BIN_DIR; }
  if (e.INTEL_NET_GUARD === 'strict') e.ESBUILD_WORKER_THREADS = '0';
  return e;
};
const withOpts = (rest, fn) => {
  const oi = rest.findIndex((x) => x && typeof x === 'object' && !Array.isArray(x));
  const o = fn({ ...(oi >= 0 ? rest[oi] : {}) });
  if (oi >= 0) rest[oi] = o; else { const ci = rest.findIndex((x) => typeof x === 'function'); if (ci >= 0) rest.splice(ci, 0, o); else rest.push(o); }
  return rest;
};
const guardCp = (name, orig, shell = false) => function guardedChild(file, ...rest) {
  if (shell) throw fail(`child_process.${name} (shell)`);
  const oi = rest.findIndex((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (oi >= 0 && rest[oi].shell) throw fail(`child_process.${name} with shell`);
  if (!allowed(file)) throw fail(`child_process.${name} ${path.basename(String(file ?? ''))}`);
  if (isNode(file)) {
    const argv = Array.isArray(rest[0]) ? rest[0] : [];
    if (argv.some((a) => BAD_NODE_FLAG.test(String(a)))) throw fail(`child_process.${name} node ${argv.find((a) => BAD_NODE_FLAG.test(String(a)))}`);
    withOpts(rest, (o) => ({ ...o, env: guardEnv(o.env) }));
  } else if (path.basename(String(file)) === 'git') withOpts(rest, (o) => ({ ...o, env: { ...(o.env || process.env), GIT_ALLOW_PROTOCOL: 'file' } }));
  return orig.call(this, file, ...rest);
};
cp.spawn = guardCp('spawn', cp.spawn);
cp.spawnSync = guardCp('spawnSync', cp.spawnSync);
cp.execFile = guardCp('execFile', cp.execFile);
cp.execFileSync = guardCp('execFileSync', cp.execFileSync);
cp.exec = guardCp('exec', cp.exec, true);
cp.execSync = guardCp('execSync', cp.execSync, true);
const origFork = cp.fork;
// fork: execPath must be this node binary, execArgv may not expose internals, and the guard env is forced
cp.fork = function guardedFork(modulePath, ...rest) {
  const oi = rest.findIndex((x) => x && typeof x === 'object' && !Array.isArray(x));
  const o = oi >= 0 ? rest[oi] : {};
  if (o.execPath !== undefined && !isNode(o.execPath)) throw fail(`child_process.fork execPath ${path.basename(String(o.execPath))}`);
  if (o.shell) throw fail('child_process.fork with shell');
  const xa = Array.isArray(o.execArgv) ? o.execArgv : process.execArgv;
  if (xa.some((a) => BAD_NODE_FLAG.test(String(a)))) throw fail('child_process.fork execArgv');
  withOpts(rest, (x) => ({ ...x, execPath: process.execPath, env: guardEnv(x.env) }));
  return origFork.call(this, modulePath, ...rest);
};
// worker threads do not run --import preloads, so strict mode forbids them (ESBUILD_WORKER_THREADS=0 keeps esbuild in-process)
if (MODE === 'strict') wt.Worker = class { constructor() { throw fail('worker_threads.Worker'); } };
syncBuiltinESMExports();
process.env.INTEL_NET_GUARD_ACTIVE = MODE;
