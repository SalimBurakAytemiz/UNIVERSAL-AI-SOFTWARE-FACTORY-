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

// PR numbers referenced as #N in a free-text field.
export const prRefs = (text) => [...String(text ?? '').matchAll(/#(\d{1,5})(?!\d)/g)].map((m) => Number(m[1]));
