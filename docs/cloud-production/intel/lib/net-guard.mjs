//TR: Ağ koruması (NODE_OPTIONS=--import ile ön yüklenir): Node içinden her TCP/UDP/TLS/HTTP/DNS/fetch/WebSocket bağlantısını ve izinsiz alt süreci (curl, sh, ...) INTEL_NET_BLOCKED hatasıyla durdurur. Yalnız os.tmpdir() altındaki unix soketleri (tsx IPC) ve node'un kendisi (koruma devralınır) izinlidir. Kipler: strict (hazırlık ölçümü: ek olarak yalnız INTEL_NET_GUARD_ALLOW_BIN_DIR altındaki esbuild ikilisi; Worker yasak) ve proof (kanıtlar: git yalnız GIT_ALLOW_PROTOCOL=file ile, tar, ağsız ad alanı için unshare).
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
import { syncBuiltinESMExports } from 'node:module';

export const NET_BLOCKED = 'INTEL_NET_BLOCKED';
const MODE = process.env.INTEL_NET_GUARD === 'proof' ? 'proof' : 'strict';
const ALLOW_BIN_DIR = process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR ? path.resolve(process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR) : null;
const fail = (what) => { const e = new Error(`${NET_BLOCKED}: ${what} blocked by the Intel network guard`); e.code = NET_BLOCKED; return e; };
const TMP = path.resolve(os.tmpdir());
const localSocket = (p) => typeof p === 'string' && p.length > 0 && path.resolve(p).startsWith(TMP + path.sep);

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

// ---- child processes: node itself (inherits this guard via NODE_OPTIONS); proof: git (file protocol only) and tar; strict: the esbuild binary
const allowed = (file) => {
  const f = String(file ?? '');
  const b = path.basename(f);
  if (f === process.execPath || b === 'node') return true;
  if (MODE === 'proof') return b === 'git' || b === 'tar' || b === 'unshare';
  return !!(ALLOW_BIN_DIR && b === 'esbuild' && path.resolve(f).startsWith(ALLOW_BIN_DIR + path.sep));
};
const guardCp = (name, orig, shell = false) => function guardedChild(file, ...rest) {
  if (shell) throw fail(`child_process.${name} (shell)`);
  const oi = rest.findIndex((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (oi >= 0 && rest[oi].shell) throw fail(`child_process.${name} with shell`);
  if (!allowed(file)) throw fail(`child_process.${name} ${path.basename(String(file ?? ''))}`);
  if (path.basename(String(file)) === 'git') {
    const o = { ...(oi >= 0 ? rest[oi] : {}) };
    o.env = { ...(o.env || process.env), GIT_ALLOW_PROTOCOL: 'file' };
    if (oi >= 0) rest[oi] = o; else { const ci = rest.findIndex((x) => typeof x === 'function'); if (ci >= 0) rest.splice(ci, 0, o); else rest.push(o); }
  }
  return orig.call(this, file, ...rest);
};
cp.spawn = guardCp('spawn', cp.spawn);
cp.spawnSync = guardCp('spawnSync', cp.spawnSync);
cp.execFile = guardCp('execFile', cp.execFile);
cp.execFileSync = guardCp('execFileSync', cp.execFileSync);
cp.exec = guardCp('exec', cp.exec, true);
cp.execSync = guardCp('execSync', cp.execSync, true);
const origFork = cp.fork;
cp.fork = function guardedFork(...args) { return origFork.apply(this, args); };
// worker threads do not run --import preloads, so strict mode forbids them (ESBUILD_WORKER_THREADS=0 keeps esbuild in-process)
if (MODE === 'strict') wt.Worker = class { constructor() { throw fail('worker_threads.Worker'); } };
syncBuiltinESMExports();
process.env.INTEL_NET_GUARD_ACTIVE = MODE;
