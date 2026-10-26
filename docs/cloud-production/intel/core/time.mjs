//TR: Saat dilimi hesapları her zaman açık timeZone ile yapılır (TZ ortam değişkeni kullanılmaz). Saat dışarıdan enjekte edilir; burada Date.now() çağrılmaz.
const DEFAULT_TZ = 'Europe/Istanbul';
const fmtCache = new Map();
const fmt = (tz) => {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  return fmtCache.get(tz);
};
export function zoneParts(iso, tz = DEFAULT_TZ) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`BAD_TIME:${iso}`);
  const p = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}
export const trtDate = (iso, tz = DEFAULT_TZ) => { const p = zoneParts(iso, tz); return `${p.year}-${p.month}-${p.day}`; };
export const trtClock = (iso, tz = DEFAULT_TZ) => { const p = zoneParts(iso, tz); return `${p.hour}:${p.minute}`; };
export const trtStamp = (iso, tz = DEFAULT_TZ) => { const p = zoneParts(iso, tz); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} TRT`; };
export const isoUtc = (v) => { const ms = Date.parse(v); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
export const toMs = (v) => { const ms = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(ms) ? ms : NaN; };

export function windowStart(nowIso, w, startIso) {
  const now = toMs(nowIso);
  if (w === '1h') return new Date(now - 3600e3).toISOString();
  if (w === '24h') return new Date(now - 24 * 3600e3).toISOString();
  if (w === '7d') return new Date(now - 7 * 24 * 3600e3).toISOString();
  if (w === 'start') return startIso || null;
  throw new Error(`BAD_WINDOW:${w}`);
}
export const hoursBetween = (a, b) => { const x = toMs(a), y = toMs(b); return Number.isFinite(x) && Number.isFinite(y) ? (y - x) / 3600e3 : null; };
export const round1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
export const round2 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
export function pct(n, d) {
  if (typeof n !== 'number' || typeof d !== 'number' || !Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 'UNKNOWN';
  return Math.round(1000 * n / d) / 10;
}
// "HH:MM" >= "HH:MM" comparison (zero-padded, so code-unit order is time order).
export const clockBefore = (a, b) => a < b;
export function addDays(dateStr, n) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + n * 864e5;
  return new Date(ms).toISOString().slice(0, 10);
}
