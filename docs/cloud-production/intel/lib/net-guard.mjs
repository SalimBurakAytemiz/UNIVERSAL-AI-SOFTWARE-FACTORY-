//TR: Ağ koruması (NODE_OPTIONS=--import ile ön yüklenir; ürün kodu için asıl sınır readiness-runner'daki ad alanı kum havuzudur, bu koruma derinlemesine savunmadır): Node içinden her TCP/UDP/TLS/HTTP/DNS/fetch/WebSocket bağlantısını, ham soket/süreç bağlamalarını (process.binding tcp_wrap/pipe_wrap/process_wrap/spawn_sync, dlopen) ve izinsiz alt süreci (curl, sh, ...) INTEL_NET_BLOCKED hatasıyla durdurur. Yalnız gerçek yolu (realpath) os.tmpdir() altındaki unix soketleri (tsx IPC) ve yalnız process.execPath (koruma, NODE_OPTIONS ve kip ortamına ZORLA yazılarak devralınır; fork execPath'i de denetlenir) izinlidir. Node alt sürecinde korumadan ÖNCE kod çalıştırabilecek ön yükleme bayrakları (-r/--require/--import/--loader/--experimental-loader) argv ve fork execArgv'de yalnız korumanın kendisini (veya içeriği aynı kopyasını) ya da izinli ikili dizini altındaki dosyayı (tsx preflight/loader), NODE_OPTIONS'ta yalnız korumayı gösterebilir; NODE_OPTIONS node'un kendi ayrıştırmasıyla (yalnız çift tırnak) VE tırnaklar atılmış düz metin olarak iki kez taranır (tek tırnak hilesi reddedilir); --env-file/--env-file-if-exists, yapılandırma dosyası, snapshot ve OpenSSL yapılandırma bayrakları (--openssl-config, --openssl-shared-config) her yerde reddedilir; göreli/çıplak belirteç reddedilir. İzin verilen her alt sürecin ortamından LD_*/DYLD_* ve OPENSSL_CONF/OPENSSL_ENGINES/OPENSSL_MODULES silinir; node alt sürecinin NODE_OPTIONS'u yalnız koruma importudur, diğer alt süreçlerde yalnız koruma importları kalır. process.execve ve process.dlopen her kipte yasaktır. Kipler: strict (hazırlık ölçümü: ek olarak yalnız INTEL_NET_GUARD_ALLOW_BIN_DIR altındaki esbuild ikilisi; Worker ve yerel eklenti yasak) ve proof (kanıtlar: git yalnız GIT_ALLOW_PROTOCOL=file ile, tar, ad alanı kum havuzu için unshare).
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
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

export const NET_BLOCKED = 'INTEL_NET_BLOCKED';
const MODE = process.env.INTEL_NET_GUARD === 'proof' ? 'proof' : 'strict';
const ALLOW_BIN_DIR = process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR ? path.resolve(process.env.INTEL_NET_GUARD_ALLOW_BIN_DIR) : null;
const fail = (what) => { const e = new Error(`${NET_BLOCKED}: ${what} blocked by the Intel network guard`); e.code = NET_BLOCKED; return e; };
const real = (p) => { try { return fs.realpathSync(p); } catch { try { return path.join(fs.realpathSync(path.dirname(path.resolve(p))), path.basename(p)); } catch { return null; } } };
const TMP = real(os.tmpdir()) || path.resolve(os.tmpdir());
// a unix socket is local only when its REAL path (symlinks resolved) is under the temp dir: a symlink in tmpdir to a host socket is refused
const localSocket = (p) => { if (typeof p !== 'string' || !p.length || p.startsWith('\0')) return false; const r = real(p); return !!r && r.startsWith(TMP + path.sep); };
const GUARD_URL = import.meta.url;
const GUARD_REAL = real(fileURLToPath(GUARD_URL));
const EXEC_REAL = real(process.execPath);
const sha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const GUARD_SHA = GUARD_REAL ? sha(GUARD_REAL) : null;

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
// native addons and process-image replacement bypass every JS-level hook: blocked in both modes
process.dlopen = blockFn('process.dlopen');
if (typeof process.execve === 'function') process.execve = blockFn('process.execve');

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
// preloads run before (a --require preload even before) the guard's own --import: only the guard itself or a file under the allowed bin dir
// (tsx's preflight.cjs / loader.mjs) may be preloaded; a relative or bare specifier cannot be checked and is refused
const PRELOAD_FLAG = /^(?:-r|--require|--import|--loader|--experimental-loader)(?:=([\s\S]*))?$/;
// flags that load code or environment (NODE_OPTIONS included) from a file before or instead of the guard: refused everywhere; an OpenSSL
// configuration file can load an engine / provider shared object into the child before any JS runs (--openssl-config, --openssl-shared-config)
const FILE_FLAG = /^--(?:env-file(?:-if-exists)?|experimental-(?:default-)?config-file|snapshot-blob|openssl-(?:shared-)?config)(?:=|$)/;
const ALLOW_BIN_REAL = ALLOW_BIN_DIR ? real(ALLOW_BIN_DIR) || ALLOW_BIN_DIR : null;
const specFile = (spec) => { let f = String(spec ?? ''); if (f.startsWith('file:')) { try { f = fileURLToPath(f); } catch { return null; } } return path.isAbsolute(f) ? real(f) : null; };
// the guard itself, or a byte-identical copy of it (the readiness sandbox preloads a read-only copy)
const isGuard = (spec) => { const r = specFile(spec); return !!r && (r === GUARD_REAL || (!!GUARD_SHA && sha(r) === GUARD_SHA)); };
const preloadOk = (spec, allowBin) => { const r = specFile(spec); return !!r && (isGuard(spec) || (allowBin && !!ALLOW_BIN_REAL && r.startsWith(ALLOW_BIN_REAL + path.sep))); };
const badPreload = (tokens, allowBin = true) => {
  for (let i = 0; i < tokens.length; i++) {
    const t = String(tokens[i]);
    if (FILE_FLAG.test(t)) return t.split('=')[0];
    const m = PRELOAD_FLAG.exec(t);
    if (!m) continue;
    const flag = t.split('=')[0], v = m[1] !== undefined ? m[1] : tokens[++i];
    if (!preloadOk(v, allowBin)) return `${flag} ${path.basename(String(v ?? ''))}`;
  }
  return null;
};
// NODE_OPTIONS as node itself splits it: spaces separate, only double quotes group (backslash escapes inside them); single quotes are literal
const nodeOptTokens = (s) => {
  const out = []; let cur = null, q = false; const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    let c = str[i];
    if (c === '\\' && q) { c = str[++i] ?? ''; }
    else if (c === '"') { q = !q; cur = cur ?? ''; continue; }
    else if (c === ' ' && !q) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? '') + c;
  }
  if (cur !== null) out.push(cur);
  return out;
};
// checked twice: as node parses it, and as plain words with every quote and backslash dropped (a quoting trick that hides a preload from
// one reading is refused, never passed through); only the guard may be preloaded here
const flatTokens = (s) => String(s ?? '').replace(/["'\\]/g, ' ').split(/\s+/).filter(Boolean);
const optionsPreload = (s) => badPreload(nodeOptTokens(s), false) || badPreload(flatTokens(s), false);
const guardImports = (s) => { const t = nodeOptTokens(s), out = []; for (let i = 0; i < t.length; i++) { const m = /^--import(?:=([\s\S]*))?$/.exec(t[i]); if (m) { const v = m[1] !== undefined ? m[1] : t[++i]; if (isGuard(v)) out.push(`--import ${v}`); } } return out; };
// every allowed child: no LD_*/DYLD_* (dynamic-loader preloads), no OPENSSL_CONF / OPENSSL_ENGINES / OPENSSL_MODULES (an OpenSSL config
// file or engine / provider directory can load a shared object into the child before any JS runs) and no foreign NODE_OPTIONS; a node child
// gets exactly the guard import, any other child keeps only guard imports already there (the sandbox launcher passes the guard copy to the node inside it)
const OPENSSL_ENV = /^OPENSSL_(?:CONF|ENGINES|MODULES)$/i;
const childEnv = (env, node) => {
  const e = { ...(env || process.env) };
  for (const k of Object.keys(e)) if (/^(?:LD_|DYLD_)/i.test(k)) delete e[k];
  for (const k of Object.keys(e)) if (OPENSSL_ENV.test(k)) delete e[k];
  const bp = optionsPreload(e.NODE_OPTIONS);
  if (bp) throw fail(`${node ? 'node child' : 'child'} NODE_OPTIONS preload ${bp}`);
  if (node) e.NODE_OPTIONS = `--import ${GUARD_URL}`;
  else { const keep = guardImports(e.NODE_OPTIONS); if (keep.length) e.NODE_OPTIONS = keep.join(' '); else delete e.NODE_OPTIONS; }
  return e;
};
const guardEnv = (env) => {
  const e = childEnv(env, true);
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
    const bp = badPreload(argv);
    if (bp) throw fail(`child_process.${name} node preload ${bp}`);
    withOpts(rest, (o) => ({ ...o, env: guardEnv(o.env) }));
  } else if (path.basename(String(file)) === 'git') withOpts(rest, (o) => ({ ...o, env: { ...childEnv(o.env, false), GIT_ALLOW_PROTOCOL: 'file' } }));
  else withOpts(rest, (o) => ({ ...o, env: childEnv(o.env, false) }));
  return orig.call(this, file, ...rest);
};
cp.spawn = guardCp('spawn', cp.spawn);
cp.spawnSync = guardCp('spawnSync', cp.spawnSync);
cp.execFile = guardCp('execFile', cp.execFile);
cp.execFileSync = guardCp('execFileSync', cp.execFileSync);
cp.exec = guardCp('exec', cp.exec, true);
cp.execSync = guardCp('execSync', cp.execSync, true);
const origFork = cp.fork;
// fork: execPath must be this node binary, execArgv may not expose internals or preload foreign code, and the guard env is forced
cp.fork = function guardedFork(modulePath, ...rest) {
  const oi = rest.findIndex((x) => x && typeof x === 'object' && !Array.isArray(x));
  const o = oi >= 0 ? rest[oi] : {};
  if (o.execPath !== undefined && !isNode(o.execPath)) throw fail(`child_process.fork execPath ${path.basename(String(o.execPath))}`);
  if (o.shell) throw fail('child_process.fork with shell');
  const xa = Array.isArray(o.execArgv) ? o.execArgv : process.execArgv;
  if (xa.some((a) => BAD_NODE_FLAG.test(String(a)))) throw fail('child_process.fork execArgv');
  const bp = badPreload(xa);
  if (bp) throw fail(`child_process.fork execArgv preload ${bp}`);
  withOpts(rest, (x) => ({ ...x, execPath: process.execPath, env: guardEnv(x.env) }));
  return origFork.call(this, modulePath, ...rest);
};
// worker threads do not run --import preloads, so strict mode forbids them (ESBUILD_WORKER_THREADS=0 keeps esbuild in-process)
if (MODE === 'strict') wt.Worker = class { constructor() { throw fail('worker_threads.Worker'); } };
syncBuiltinESMExports();
process.env.INTEL_NET_GUARD_ACTIVE = MODE;
