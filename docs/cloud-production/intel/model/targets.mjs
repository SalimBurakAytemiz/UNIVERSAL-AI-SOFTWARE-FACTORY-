//TR: Hedefler: rules/targets.json içindeki beyan edilmiş hedefler (kaynak yolu, ref, satır ve doğrulama metni ile) ve kaynak taramasından çıkan aday hedefler. Aday tarama: anahtar sözcüğün 80 karakter yakınındaki tarihler. İncelenmemiş adaylar bölüm J'de listelenir, asla atılmaz. Hedef durumu şimdiki zamana göre hesaplanır; kabul kanıtı olmadan geçmiş tarih PASSED_WITHOUT_ACCEPTANCE_EVIDENCE olur.
import { sha256, cmp } from '../core/canonical-json.mjs';
import { trtDate, trtClock } from '../core/time.mjs';

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const DATE_RES = [
  { re: /\b(20\d\d)-(\d\d)-(\d\d)\b/g, f: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  { re: /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, f: (m) => `2026-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}` },
];
export function scanCandidates(texts, keywordRegex) {
  const kw = new RegExp(keywordRegex, 'g');
  const out = new Map();
  for (const [key, text] of Object.entries(texts).sort((a, b) => cmp(a[0], b[0]))) {
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      if (!kw.test(line)) { kw.lastIndex = 0; return; }
      kw.lastIndex = 0;
      const kwPos = [...line.matchAll(kw)].map((m) => m.index);
      for (const { re, f } of DATE_RES) {
        for (const m of line.matchAll(re)) {
          if (!kwPos.some((p) => Math.abs(p - m.index) <= 80)) continue;
          const date = f(m);
          const id = `TC-${sha256(`${key}:${i + 1}:${date}`).slice(0, 8).toUpperCase()}`;
          if (!out.has(id)) out.set(id, { id, date, source: { ref: key.split(':')[0], path: key.slice(key.indexOf(':') + 1), line: i + 1 }, excerpt: line.trim().slice(0, 160) });
        }
      }
    });
  }
  return [...out.values()].sort((a, b) => cmp(a.source.path, b.source.path) || a.source.line - b.source.line || cmp(a.date, b.date));
}

export function loadTargets(rulesTargets, texts, nowIso, acceptedKeys, tz) {
  const dq = [];
  const lineOk = (s) => { const t = texts[`${s.ref}:${s.path}`]; if (t === undefined) return 'SOURCE_UNREADABLE'; const l = String(t).split('\n')[s.line - 1] || ''; return l.includes(s.match) ? 'VERIFIED' : 'LINE_MISMATCH'; };
  const today = trtDate(nowIso, tz), clock = trtClock(nowIso, tz);
  // ranges are kept as ranges; a quantile has passed only after the END of its date/time range
  const endDate = (q) => q.dateRange?.to || q.date || null, endTime = (q) => q.timeRange?.to || q.time || null;
  const passed = (q) => { const d = endDate(q); if (!d) return false; if (today > d) return true; if (today < d) return false; const t = endTime(q); return t ? clock >= t : false; };
  const targets = rulesTargets.targets.map((t) => {
    const quantiles = t.quantiles.map((q) => {
      const v = lineOk(q.source); if (v !== 'VERIFIED') dq.push({ code: `TARGET_SOURCE_${v}`, ref: `${t.id}/${q.q}`, detail: `${q.source.ref}:${q.source.path}:${q.source.line}` });
      const rv = q.rangeSource ? lineOk(q.rangeSource) : null; if (rv && rv !== 'VERIFIED') dq.push({ code: `TARGET_RANGE_SOURCE_${rv}`, ref: `${t.id}/${q.q}`, detail: `${q.rangeSource.ref}:${q.rangeSource.path}:${q.rangeSource.line}` });
      return { ...q, dateRange: q.dateRange ?? null, timeRange: q.timeRange ?? null, sourceCheck: v, rangeSourceCheck: rv, passed: passed(q) };
    });
    const cv = t.confidenceSource ? lineOk(t.confidenceSource) : null; if (cv && cv !== 'VERIFIED') dq.push({ code: `TARGET_CONFIDENCE_SOURCE_${cv}`, ref: t.id, detail: `${t.confidenceSource.ref}:${t.confidenceSource.path}:${t.confidenceSource.line}` });
    const primary = quantiles[0];
    const met = !!(t.acceptanceKey && acceptedKeys.has(t.acceptanceKey));
    let state = t.supersededBy ? 'SUPERSEDED' : met ? 'MET_WITH_EVIDENCE' : primary.passed ? 'PASSED_WITHOUT_ACCEPTANCE_EVIDENCE' : 'PENDING';
    return { id: t.id, label: t.label, kind: t.kind || 'TARGET', date: primary.date ?? null, range: primary.dateRange ?? null, quantile: primary.q, quantiles, confidence: t.confidence, confidenceSource: t.confidenceSource ? { ...t.confidenceSource, check: cv } : null, source: primary.source, statedAt: t.statedAt, state, supersededBy: t.supersededBy ?? null, acceptanceKey: t.acceptanceKey ?? null };
  });
  const flags = (rulesTargets.flags || []).map((f) => ({ id: f.id, text: f.text, check: lineOk(f.check) }));
  return { targets, flags, dq };
}
