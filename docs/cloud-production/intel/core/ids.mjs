//TR: Bilinen kimlik taraması: metinden aday kimlikleri çıkarır, büyük harfe çevirir ve bilinen kümede bulunan EN UZUN son eki seçer (claude/lane-a-ui-110 -> UI-110; PQ-008-R1, PQ-008'den ayrıdır; UI-1100, UI-110 değildir). Rakamla bitmeyen bilinen kimlikler (BL-REQ-REL-A gibi) tam sözcük eşleşmesiyle aranır.
import { sha256, cmp } from './canonical-json.mjs';

export const ID_RE = /(?<![A-Za-z0-9])([A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*-\d{1,4}(?:-R\d+)?)(?![0-9])/g;

export function canonicalId(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9+._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// literalIds: known ids that do not end in digits (matched as whole tokens, case-sensitive upper-case).
export function knownIdScan(text, idSet, literalIds = []) {
  const out = new Set();
  const s = String(text ?? '');
  if (!s) return [];
  for (const m of s.matchAll(ID_RE)) {
    const segs = m[1].toUpperCase().split('-');
    for (let i = 0; i < segs.length - 1; i++) {
      const cand = segs.slice(i).join('-');
      if (idSet.has(cand)) { out.add(cand); break; }
    }
  }
  if (literalIds.length) {
    const up = s.toUpperCase();
    for (const id of literalIds) {
      let from = 0;
      for (;;) {
        const i = up.indexOf(id, from);
        if (i < 0) break;
        const before = i === 0 ? '' : up[i - 1];
        const after = up[i + id.length] ?? '';
        if (!/[A-Z0-9-]/.test(before) && !/[A-Z0-9]/.test(after) && after !== '-') { out.add(id); break; }
        from = i + 1;
      }
    }
  }
  return [...out].sort(cmp);
}

const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
export const synthId = (kind, text) => `${kind}-${sha256(norm(text)).slice(0, 8).toUpperCase()}`;

// Exact-id match for known ids that do not end in -<digits> (L-WORKFORCE, CI-GREEN, PKG-LEASE1, CP-DISPATCH-IMPL, C-RDY-2A).
// mode 'title': whole hyphen-token match, compared upper-cased (titles use slug or mixed case: 'v7 pkg-lease1:', 'CI-green:');
// mode 'branch': per '/'-segment, the id must start the segment or follow a '-' and end the segment or be followed by '-<non-digit>'.
// In both modes a following '-<digit>' blocks the match (SEC-IMPORT-GUARD-2 is not SEC-IMPORT-GUARD) and the longest id wins.
export function literalIdScan(text, literalIds, mode = 'title') {
  const ids = [...new Set(literalIds)].sort((a, b) => b.length - a.length || cmp(a, b));
  const out = new Set();
  const s = String(text ?? '');
  if (!s || !ids.length) return [];
  const okAfter = (str, j) => j >= str.length || (str[j] === '-' ? (mode === 'branch' && /[A-Za-z]/.test(str[j + 1] || '')) : !/[A-Za-z0-9]/.test(str[j]));
  if (mode === 'branch') {
    for (const seg of s.split('/')) {
      const up = seg.toUpperCase();
      for (let i = 0; i < up.length; i++) {
        if (i > 0 && up[i - 1] !== '-') continue;
        const hit = ids.find((id) => up.startsWith(id, i) && okAfter(up, i + id.length));
        if (hit) { out.add(hit); i += hit.length - 1; }
      }
    }
  } else {
    const up = s.toUpperCase();
    const taken = new Array(up.length).fill(false);
    for (const id of ids) {
      for (let from = 0; ;) {
        const i = up.indexOf(id, from);
        if (i < 0) break;
        const before = i === 0 ? '' : up[i - 1];
        if (!/[A-Z0-9-]/.test(before) && okAfter(up, i + id.length) && !taken.slice(i, i + id.length).some(Boolean)) { out.add(id); for (let k = i; k < i + id.length; k++) taken[k] = true; }
        from = i + 1;
      }
    }
  }
  return [...out].sort(cmp);
}
export const isLiteralId = (id) => !/-\d{1,4}(?:-R\d+)?$/.test(String(id)) && String(id).includes('-');

// PR numbers referenced as #N in a free-text field.
export const prRefs = (text) => [...String(text ?? '').matchAll(/#(\d{1,5})(?!\d)/g)].map((m) => Number(m[1]));
