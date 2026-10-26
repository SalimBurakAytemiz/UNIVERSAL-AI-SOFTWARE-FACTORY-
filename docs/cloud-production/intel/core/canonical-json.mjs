//TR: Kanonik JSON yazımı ve sha256 özetleri. Anahtar sırası çağıranın kurduğu sıradır; dinamik anahtarlı haritalar sortKeys ile sıralanır. NaN, Infinity ve -0 reddedilir: null yazılır ve bir veri kalitesi (DQ) kaydı eklenir.
import crypto from 'node:crypto';

export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Code-unit comparator (never locale-aware).
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const cmpBy = (...keys) => (x, y) => {
  for (const k of keys) {
    const a = typeof k === 'function' ? k(x) : x[k];
    const b = typeof k === 'function' ? k(y) : y[k];
    if (typeof a === 'number' && typeof b === 'number') { if (a !== b) return a - b; continue; }
    const c = cmp(String(a ?? ''), String(b ?? ''));
    if (c) return c;
  }
  return 0;
};

// Replace non-finite numbers and -0 with null, recording each occurrence in dq (array of {path, value}).
export function sanitize(v, dq = [], path = '$') {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Object.is(v, -0)) { dq.push({ path, value: String(Object.is(v, -0) ? '-0' : v) }); return null; }
    return v;
  }
  if (Array.isArray(v)) return v.map((x, i) => sanitize(x, dq, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { if (v[k] !== undefined) o[k] = sanitize(v[k], dq, `${path}.${k}`); }
    return o;
  }
  return v;
}

export function stableStringify(obj, dq = []) {
  return JSON.stringify(sanitize(obj, dq), null, 2) + '\n';
}

// Deep copy with object keys sorted (code-unit). Used for digests of arbitrary inputs and for dynamic-key maps.
export function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort(cmp)) o[k] = sortKeysDeep(v[k]);
    return o;
  }
  return v;
}
export const sortKeys = (o) => { const r = {}; for (const k of Object.keys(o).sort(cmp)) r[k] = o[k]; return r; };
export const digestOf = (v) => sha256(JSON.stringify(sortKeysDeep(v)));

// Tally into an object whose keys follow `order` first (all listed keys present, zero-filled), then any other keys sorted.
export function tally(items, keyFn, order = []) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); m.set(k, (m.get(k) || 0) + 1); }
  const o = {};
  for (const k of order) o[k] = m.get(k) || 0;
  for (const k of [...m.keys()].filter((k) => !order.includes(k)).sort(cmp)) o[k] = m.get(k);
  return o;
}
// Natural compare (digit runs numerically) for display ids such as D2 < D10, FD-2 < FD-10; ties fall back to code-unit order.
export const natCmp = (a, b) => {
  const x = String(a).split(/(\d+)/), y = String(b).split(/(\d+)/);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny && Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
    return cmp(x[i], y[i]);
  }
  return x.length - y.length || cmp(String(a), String(b));
};
export const uniqSorted = (xs) => [...new Set(xs)].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : cmp(String(a), String(b))));
