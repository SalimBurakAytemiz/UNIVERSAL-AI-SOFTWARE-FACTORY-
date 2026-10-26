//TR: Kalem -> kanıt bağlantıları: PR (EXPLICIT: 19 Ekim 'prs' alanında notsuz tekil ve kimlik kapısından geçen referans; INVENTORY_WEAK: aralık/iç içe/rol notlu/kapıdan geçmeyen; başlıkta / dalda (rakamla bitmeyen kimlikler tam eşleşmeyle) / gövdede kimlik), commit (v7 commit mesajında kimlik; kayıtlı dal başının v7 atası olması), HEAD'de route/IPC literal'i (pickaxe ile ilk getiren commit), koordinatör kayıtları, ledger incelemeleri ve destekleyici metin anmaları. Bağlar (itemId, kind, ref) ile sıralanır.
import { sha256, cmp } from '../core/canonical-json.mjs';
import { inventoryPrRefs } from './baseline.mjs';

export const linkId = (l) => `L-${sha256(`${l.itemId}|${l.kind}|${l.ref}|${l.strength}|${l.source}`).slice(0, 12)}`;

export function buildLinks(items, ctx) {
  const { pulls, commits, routes, ipc, literalIntro, reachable, shortMap, headDates, resolver, ledgerReviews, supportTexts, overlayLinks, linkPatterns, v7sha, statusMap } = ctx;
  const IP = linkPatterns.inventoryPrs;
  const titlePrRe = new RegExp(IP.itemTitleNamesPrRegex, 'g');
  const out = [];
  const add = (l) => { l.id = linkId(l); out.push(l); };
  const prAt = (p) => p.mergedAt || p.createdAt || null;

  // inverted indexes: item id -> PR mentions by field
  const byTitle = new Map(), byBranch = new Map(), byBody = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const p of pulls.values()) {
    for (const id of resolver.resolveText(p.title)) push(byTitle, id, p.number);
    for (const id of resolver.resolveText(p.headRef || '')) push(byBranch, id, p.number);
    for (const id of resolver.resolveLiteral(p.title, 'title')) push(byTitle, id, p.number);
    for (const id of resolver.resolveLiteral(p.headRef || '', 'branch')) push(byBranch, id, p.number);
    for (const id of resolver.resolveTokens(p.bodyTokens)) push(byBody, id, p.number);
  }
  const byCommit = new Map();
  for (const c of commits) for (const id of resolver.resolveText(`${c.subject}\n${c.body}`)) push(byCommit, id, c);
  const support = new Map();
  for (const [src, text] of supportTexts) for (const id of resolver.resolveText(text)) push(support, id, src);
  const routeIdx = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]));
  const ipcIdx = new Map(ipc.map((r) => [r.channel, r]));
  const epRe = new RegExp(linkPatterns.endpointTitleRegex), ipcRe = new RegExp(linkPatterns.ipcTitleRegex);

  for (const it of items) {
    if (it.excluded) continue;
    const explicit = new Map(); // n -> source
    const weak = new Map(); // n -> reason (19-Oct prs references that are not EXPLICIT)
    if (it.baseline) {
      const names = (m, n) => (m.get(it.id) || []).includes(n);
      const titlePrs = new Set([...String(it.baseline.title || '').matchAll(titlePrRe)].map((m) => Number(m[1])));
      const claimsMerged = statusMap.baselineMergedClaim.includes(it.baseline.status19);
      const gate = (n) => (names(byTitle, n) || names(byBranch, n) || names(byBody, n) ? 'PR_NAMES_ITEM' : titlePrs.has(n) ? 'ITEM_TITLE_NAMES_PR' : claimsMerged ? 'STATUS19_CLAIMS_MERGED' : null);
      for (const r of inventoryPrRefs(it.baseline, pulls, IP, gate)) { if (r.strength === 'EXPLICIT') explicit.set(r.n, `inventory.prs[${r.gate}]`); else weak.set(r.n, r.reason); }
    }
    for (const r of it.records) if (r.pr && pulls.has(r.pr)) { const src = `${r.kind.toLowerCase()}:${r.ref}.pr`; if (!explicit.has(r.pr) || explicit.get(r.pr).startsWith('inventory.prs')) explicit.set(r.pr, explicit.has(r.pr) ? `${explicit.get(r.pr)}+${src}` : src); }
    for (const [n, src] of [...explicit.entries()].sort((a, b) => a[0] - b[0])) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'EXPLICIT', source: src, at: prAt(pulls.get(n)) });
    for (const [n, why] of [...weak.entries()].sort((a, b) => a[0] - b[0])) if (!explicit.has(n)) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'INVENTORY_WEAK', source: `inventory.prs:${why}`, at: prAt(pulls.get(n)) });
    for (const o of overlayLinks.filter((x) => x.itemId === it.id)) { const n = Number(String(o.value).replace('#', '')); if (pulls.has(n)) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'OVERLAY', source: `overlay:${o.by}`, at: prAt(pulls.get(n)) }); }
    for (const [m, strength] of [[byTitle, 'ID_IN_TITLE'], [byBranch, 'ID_IN_BRANCH'], [byBody, 'ID_IN_BODY']]) {
      for (const n of [...new Set(m.get(it.id) || [])].sort((a, b) => a - b)) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength, source: strength === 'ID_IN_BODY' ? 'pr.body' : strength === 'ID_IN_TITLE' ? 'pr.title' : 'pr.head.ref', at: prAt(pulls.get(n)) });
    }
    for (const c of [...new Map((byCommit.get(it.id) || []).map((c) => [c.sha, c])).values()].sort((a, b) => cmp(a.at, b.at) || cmp(a.sha, b.sha))) add({ itemId: it.id, kind: 'COMMIT', ref: c.sha, strength: 'ID_IN_COMMIT_MESSAGE', source: 'v7 commit message', at: c.at });
    for (const r of it.records) {
      add({ itemId: it.id, kind: r.kind === 'QUEUE_TASK' ? 'QUEUE_TASK' : r.kind === 'QUEUE_TASK_REPAIR' ? 'QUEUE_TASK_REPAIR' : 'COORD_RECORD', ref: `${r.kind}:${r.ref}`, strength: r.relation === 'SELF' ? 'SELF' : r.relation, source: `${r.kind} status ${r.status ?? 'none'}`, at: r.startedAt ?? null });
      if (r.head) {
        const full = shortMap[r.head] ?? null;
        if (full && reachable.has(full)) add({ itemId: it.id, kind: 'COMMIT', ref: full, strength: 'EXPLICIT', source: `${r.kind.toLowerCase()}:${r.ref}.head in v7/integration`, at: headDates[full] ?? null });
      }
    }
    if (it.baseline && it.id.startsWith('G-EP-')) {
      const m = epRe.exec(it.title || ''), mi = ipcRe.exec(it.title || '');
      if (m) { const r = routeIdx.get(`${m[1]} ${m[2]}`); if (r) { const intro = literalIntro[`ROUTE ${r.method} ${r.path}`]; add({ itemId: it.id, kind: 'COMMIT', ref: intro?.sha ?? `${v7sha}:${r.file}`, strength: 'ROUTE_LITERAL_AT_HEAD', source: `${r.method} ${r.path} @ ${r.file}`, at: intro?.at ?? null }); } }
      else if (mi) { const r = ipcIdx.get(mi[1]); if (r) { const intro = literalIntro[`IPC ${r.channel}`]; add({ itemId: it.id, kind: 'COMMIT', ref: intro?.sha ?? `${v7sha}:${r.file}`, strength: 'IPC_CHANNEL_LITERAL_AT_HEAD', source: `ipc ${r.channel} @ ${r.file}`, at: intro?.at ?? null }); } }
    }
    for (const src of [...new Set(support.get(it.id) || [])].sort(cmp)) add({ itemId: it.id, kind: 'COORD_RECORD', ref: src, strength: src.startsWith('ledger') ? 'LEDGER_TEXT' : src.startsWith('dispatch') ? 'DISPATCH_TEXT' : 'QUEUE_TEXT', source: 'text mention (supporting only)', at: null });
  }
  // ledger reviews for PRs linked by EXPLICIT/title/branch
  const reviewsByPr = new Map(); for (const r of ledgerReviews) push(reviewsByPr, r.pr, r);
  const strong = out.filter((l) => l.kind === 'PR' && ['EXPLICIT', 'ID_IN_TITLE', 'ID_IN_BRANCH', 'OVERLAY'].includes(l.strength));
  const seen = new Set();
  for (const l of strong) for (const r of reviewsByPr.get(l.pr) || []) { const k = `${l.itemId}|${r.pr}|${r.sha}|${r.kind}`; if (seen.has(k)) continue; seen.add(k); add({ itemId: l.itemId, kind: 'LEDGER_REVIEW', ref: `#${r.pr}@${String(r.sha).slice(0, 7)}:${r.kind}:${r.verdict}`, strength: 'LEDGER', source: 'COORD-LEDGER.json', at: r.at ?? null }); }
  out.sort((a, b) => cmp(a.itemId, b.itemId) || cmp(a.kind, b.kind) || cmp(a.ref, b.ref) || cmp(a.strength, b.strength) || cmp(a.source, b.source));
  return out;
}
