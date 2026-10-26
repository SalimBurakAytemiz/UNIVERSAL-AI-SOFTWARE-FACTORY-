//TR: RFC 4180 CSV okuyucu (1364 satırlık envanterde kanıtlanmış ayrıştırıcının birebir aktarımı) ve sabit sütun sıralı yazıcı (\n satır sonu, gerektiğinde tırnak).
export function parseCsv(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}
export function parseCsvRecords(t) {
  const rows = parseCsv(t);
  const h = rows[0] || [];
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const cell = (v) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows, columns) {
  const out = [columns.map(cell).join(',')];
  for (const r of rows) out.push(columns.map((c) => cell(r[c])).join(','));
  return out.join('\n') + '\n';
}
