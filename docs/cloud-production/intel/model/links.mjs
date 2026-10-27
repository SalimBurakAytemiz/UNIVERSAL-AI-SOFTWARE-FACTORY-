//TR: Kalem -> kanıt bağlantıları. PR SAHİPLİĞİ (tek kural, bir PR'ın bir satıra atandığı her yerde): P'nin Y için sahiplik kanıtı = P'nin başlığı/dalı (dal biçimi 'ui049' dahil) ya da gövdesi (gövde gücünde) Y'yi adlandırır, 19 Ekim prToWorkItems haritası P için Y'yi listeler veya bir koordinatör kaydı/overlay LINK P'yi Y için adlandırır. OWN: X için kanıt var (başka kalemler için de varsa SHARED: her biri için OWN; başlık yalnız Y'yi adlandırırken harita X'i listeliyorsa ÇATIŞMA: ikisi için de OWN, güven en çok MEDIUM ve not); OTHER_ITEM: kanıt yalnız başka kalemler için -> referans WEAK 'other-item:<kimlikler>' (biçimi ne olursa olsun; yalnız destek, asla kanıt); UNASSIGNED: hiçbir kalem için kanıt yok -> mevcut kapılar (19 Ekim notunun başka kalemi adlandırması dahil). PR (EXPLICIT: 19 Ekim 'prs' alanında notsuz tekil, OTHER_ITEM olmayan ve kimlik kapısından geçen referans; INVENTORY_WEAK: aralık/iç içe/rol notlu/başka kaleme ait/kapıdan geçmeyen; başlıkta / dalda (rakamla bitmeyen kimlikler tam eşleşmeyle) / gövdede kimlik; kayıt tutma PR'ı (backlog:/write-back/'(backlog only)' başlığı ya da 'UI-132 DONE' gibi durum ibaresi) BOOKKEEPING_PR olur ve kanıt değildir; YALNIZ BELGE değiştiren PR (DOCS_ONLY: değişen her dosya docs/** veya reports/** altında belge/kanıt uzantılı ya da *.md; dosya listesi v7'ye merge edilmiş PR için yerel git'ten, açık PR için GitHub'dan) gövdesiyle hiçbir satıra, başlığı/dalıyla yalnız kendi teslimi belge olan satıra (backlog kaydının files listesi tamamen belge, kayıt type'ı veya files listesi yokken başlık) OWN kanıt verir, aksi halde DOCS_ONLY_WEAK 'docs-only-body/-title/-branch' olur; aynı kural yalnız belge değiştiren v7 commit'inin mesaj anmasına uygulanır ('docs-only-commit'); dosya listesi bilinmeyen PR/commit bugünkü kuralla kalır ve işaretlenir), commit (v7 commit mesajında kimlik; kayıtlı dal başının v7 atası olması), HEAD'de route/IPC literal'i (pickaxe ile ilk getiren commit), koordinatör kayıtları, ledger incelemeleri ve destekleyici metin anmaları. Bağlar (itemId, kind, ref) ile sıralanır.
import { sha256, cmp } from '../core/canonical-json.mjs';
import { inventoryPrRefs } from './baseline.mjs';
import { isLiteralId } from '../core/ids.mjs';

export const linkId = (l) => `L-${sha256(`${l.itemId}|${l.kind}|${l.ref}|${l.strength}|${l.source}`).slice(0, 12)}`;

export function buildLinks(items, ctx) {
  const { pulls, commits, routes, ipc, literalIntro, reachable, shortMap, headDates, resolver, ledgerReviews, supportTexts, overlayLinks, linkPatterns, v7sha, statusMap, prToWorkItems = {}, mergedPrFiles = {}, openPrFiles = {}, commitFiles = null } = ctx;
  const IP = linkPatterns.inventoryPrs;
  const titlePrRe = new RegExp(IP.itemTitleNamesPrRegex, 'g');
  // branch-slug ids ('claude/l-assurance-ui049', 'feature/ui074-providers') -> canonical form before resolving (other-item test only)
  const deslug = (t) => (IP.slugIdRegex ? String(t ?? '').replace(new RegExp(IP.slugIdRegex, 'gi'), (_, p, d) => `${p.toUpperCase()}-${d}`) : String(t ?? ''));
  const BK = linkPatterns.bookkeepingPr || null;
  const bkWhole = BK ? new RegExp(BK.wholeTitleRegex, BK.wholeTitleFlags || '') : null;
  const bkClause = BK ? new RegExp(BK.statusClauseRegex, 'g') : null;
  const titleIds = (t) => [...new Set([...resolver.resolveText(t), ...resolver.resolveLiteral(t, 'title')])];
  const out = [];
  const add = (l) => { l.id = linkId(l); out.push(l); };
  const addPr = (l) => { const c = conflictOf(l.pr, l.itemId); if (c) l.ownershipConflict = c; add(l); };
  const prAt = (p) => p.mergedAt || p.createdAt || null;

  // inverted indexes: item id -> PR mentions by field
  const byTitle = new Map(), byBranch = new Map(), byBody = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const prOwnIds = new Map();   // PR -> ids its own title/branch names (branch slugs included): whose PR it is
  const bkIds = new Map();      // PR -> ids for which its title/branch links are bookkeeping (whole title, or named only in a status clause)
  const canon = (id) => (resolver.has(id) ? [id] : resolver.targets(id));
  for (const p of pulls.values()) {
    for (const id of resolver.resolveText(p.title)) push(byTitle, id, p.number);
    for (const id of resolver.resolveText(p.headRef || '')) push(byBranch, id, p.number);
    for (const id of resolver.resolveLiteral(p.title, 'title')) push(byTitle, id, p.number);
    for (const id of resolver.resolveLiteral(p.headRef || '', 'branch')) push(byBranch, id, p.number);
    for (const id of resolver.resolveTokens(p.bodyTokens)) push(byBody, id, p.number);
    prOwnIds.set(p.number, new Set([...titleIds(p.title), ...resolver.resolveText(deslug(p.headRef || '')), ...resolver.resolveLiteral(p.headRef || '', 'branch')]));
    if (BK) {
      const t = String(p.title || '');
      if (bkWhole.test(t)) bkIds.set(p.number, 'ALL');
      else {
        const clauses = [...t.matchAll(bkClause)].map((m) => m[0]);
        if (clauses.length) { const rest = clauses.reduce((a, c) => a.split(c).join(' '), t); const keep = new Set(titleIds(rest)); bkIds.set(p.number, new Set(titleIds(clauses.join(' ')).filter((id) => !keep.has(id)))); }
      }
    }
  }
  const isBk = (n, id, field) => { const b = bkIds.get(n); return b === 'ALL' || (field === 'title' && !!b && b.has(id)); };
  // ---- DOCS_ONLY PRs (rules docsOnlyPr): every changed file is documentation / report / evidence. File lists: merged into v7 from local git,
  // open from the GitHub files API; any other PR's list is UNKNOWN (null) and keeps the pre-docs-only rule (recorded by the status ladder)
  const DO = linkPatterns.docsOnlyPr || null;
  const docRe = DO ? new RegExp(DO.docFileRegex, DO.docFileFlags || '') : null;
  const DD = DO ? DO.docDeliverable || {} : {};
  const ddTitleRe = DD.titleRegex ? new RegExp(DD.titleRegex, DD.titleFlags || '') : null;
  const ddTypes = new Set((DD.types || []).map((t) => String(t).toUpperCase()));
  const isDocFile = (f) => !!docRe && docRe.test(String(f));
  const filesOf = (n) => { const m = mergedPrFiles[n]; if (m && Array.isArray(m.files)) return m.files; const o = openPrFiles[n]; const p = pulls.get(n); return Array.isArray(o) && p && p.state === 'open' ? o : null; };
  const docsOnly = (n) => { if (!DO) return false; const f = filesOf(n); return f === null ? null : f.length > 0 && f.every(isDocFile); };
  // the same test for a v7 commit whose message names the id (a docs-only PR's own commits carry the same mention); no list -> UNKNOWN
  const commitDocsOnly = (sha) => { if (!DO) return false; const f = commitFiles ? commitFiles[sha] : undefined; return !Array.isArray(f) ? null : f.length > 0 && f.every(isDocFile); };
  // the row's own deliverable is documentation: its own BACKLOG record lists only documentation files; without such a list, a document
  // record type or a document title (rules docsOnlyPr.docDeliverable); a files list with any code file means a code deliverable
  const docDeliverable = (it) => {
    if (!DO) return null;
    const own = it.records.filter((r) => r.kind === 'BACKLOG' && (r.relation === 'SELF' || r.relation === 'MERGED'));
    const listed = own.filter((r) => Array.isArray(r.files) && r.files.length);
    if (listed.length) return listed.every((r) => r.files.every(isDocFile)) ? 'BACKLOG_FILES' : null;
    if (own.some((r) => r.type && ddTypes.has(String(r.type).toUpperCase()))) return 'BACKLOG_TYPE';
    return ddTitleRe && ddTitleRe.test(String(it.title || '')) ? 'TITLE' : null;
  };
  // link marks (do not change the link id): docsOnly = the PR is DOCS_ONLY and kept for a documentation deliverable; prFiles UNKNOWN = the
  // docs-only test could not run for a link that rests on the PR's own text (kept under the pre-docs-only rule)
  const filesMark = (n, textLink, dd) => { if (!DO || !textLink) return {}; const d = docsOnly(n); return d === true ? { docsOnly: `DOC_DELIVERABLE:${dd}` } : d === null ? { prFiles: 'UNKNOWN' } : {}; };
  // ---- PR ownership index (one rule for every PR -> row attribution): P -> items with ownership evidence by source
  const own = new Map();
  const O = (n) => { if (!own.has(n)) own.set(n, { tb: new Set(), body: new Set(), map: new Set(), rec: new Set() }); return own.get(n); };
  for (const p of pulls.values()) { for (const id of prOwnIds.get(p.number)) O(p.number).tb.add(id); for (const id of resolver.resolveTokens(p.bodyTokens)) O(p.number).body.add(id); }
  for (const [k, ids] of Object.entries(prToWorkItems || {})) { const n = Number(String(k).replace('#', '')); if (pulls.has(n)) for (const id of ids || []) for (const c of canon(String(id))) O(n).map.add(c); }
  for (const it of items) for (const r of it.records) if (r.pr && pulls.has(r.pr)) O(r.pr).rec.add(it.id);
  for (const o of overlayLinks) { const n = Number(String(o.value).replace('#', '')); if (pulls.has(n)) O(n).rec.add(o.itemId); }
  const idOrder = (a, b) => (isLiteralId(a) ? 1 : 0) - (isLiteralId(b) ? 1 : 0) || cmp(a, b);   // numbered ids first (UI-051, not L-ASSURANCE)
  const ownership = (n, x) => {
    const e = own.get(n);
    if (!e) return { kind: 'UNASSIGNED', others: [], conflict: null };
    const all = new Set([...e.tb, ...e.body, ...e.map, ...e.rec]);
    const others = [...all].filter((id) => id !== x).sort(idOrder);
    // an index entry exists only once some item has evidence on P (O() is called with an id), so all.size >= 1 here
    if (!all.has(x)) return { kind: 'OTHER_ITEM', others, conflict: null };
    // title/branch name only items the map does not list (or the reverse): OWN for both, confidence capped at MEDIUM, recorded
    const tb = [...e.tb].sort(idOrder), mp = [...e.map].sort(idOrder);
    const conflict = (e.tb.has(x) || e.map.has(x)) && tb.length && mp.length && !tb.some((id) => e.map.has(id)) ? `#${n}: title/branch names ${tb.join(',')} while the 19-Oct prToWorkItems map lists ${mp.join(',')} (ownership conflict: OWN for both, confidence at most MEDIUM)` : null;
    return { kind: others.length ? 'SHARED' : 'OWN', others, conflict };
  };
  const conflictOf = (n, x) => ownership(n, x).conflict;
  const byCommit = new Map();
  for (const c of commits) for (const id of resolver.resolveText(`${c.subject}\n${c.body}`)) push(byCommit, id, c);
  const support = new Map();
  for (const [src, text] of supportTexts) for (const id of resolver.resolveText(text)) push(support, id, src);
  const routeIdx = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]));
  const ipcIdx = new Map(ipc.map((r) => [r.channel, r]));
  const epRe = new RegExp(linkPatterns.endpointTitleRegex), ipcRe = new RegExp(linkPatterns.ipcTitleRegex);

  for (const it of items) {
    if (it.excluded) continue;
    const dd = docDeliverable(it);
    const explicit = new Map(); // n -> source
    const weak = new Map(); // n -> reason (19-Oct prs references that are not EXPLICIT)
    if (it.baseline) {
      const names = (m, n) => (m.get(it.id) || []).includes(n);
      const titlePrs = new Set([...String(it.baseline.title || '').matchAll(titlePrRe)].map((m) => Number(m[1])));
      const claimsMerged = statusMap.baselineMergedClaim.includes(it.baseline.status19);
      // PR_NAMES_ITEM through a DOCS_ONLY PR: only its title / branch, and only for a documentation deliverable (a body mention never)
      const namesItem = (n) => { const tb = names(byTitle, n) || names(byBranch, n); return docsOnly(n) === true ? tb && !!dd : tb || names(byBody, n); };
      const gate = (n) => (namesItem(n) ? 'PR_NAMES_ITEM' : titlePrs.has(n) ? 'ITEM_TITLE_NAMES_PR' : claimsMerged ? 'STATUS19_CLAIMS_MERGED' : null);
      const gateMiss = (n) => (docsOnly(n) !== true ? null : names(byTitle, n) ? 'docs-only-title' : names(byBranch, n) ? 'docs-only-branch' : names(byBody, n) ? 'docs-only-body' : null);
      // ownership rule: OTHER_ITEM (evidence only for other items) -> WEAK other-item:<ids> whatever the reference form
      const ownerOf = (n) => { const o = ownership(n, it.id); return o.kind === 'OTHER_ITEM' ? o.others.join(',') : null; };
      // UNASSIGNED PR only (no title/branch/body/map/record evidence for any item): the 19-Oct annotation may still name another known item
      // ('#25 (UI-050 evidence lineage)', slug form 'claude/l-assurance-ui049'); then the reference is never EXPLICIT for this row
      const otherItemOf = (n, ann) => {
        if (ownership(n, it.id).kind !== 'UNASSIGNED') return null;
        const ids = resolver.resolveText(deslug(ann));
        if (ids.includes(it.id)) return null;
        return ids.length ? ids[0] : null;
      };
      for (const r of inventoryPrRefs(it.baseline, pulls, IP, gate, otherItemOf, ownerOf, gateMiss)) { if (r.strength === 'EXPLICIT') explicit.set(r.n, `inventory.prs[${r.gate}]`); else weak.set(r.n, r.reason); }
    }
    for (const r of it.records) if (r.pr && pulls.has(r.pr)) { const src = `${r.kind.toLowerCase()}:${r.ref}.pr`; if (!explicit.has(r.pr) || explicit.get(r.pr).startsWith('inventory.prs')) explicit.set(r.pr, explicit.has(r.pr) ? `${explicit.get(r.pr)}+${src}` : src); }
    for (const [n, src] of [...explicit.entries()].sort((a, b) => a[0] - b[0])) addPr({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'EXPLICIT', source: src, at: prAt(pulls.get(n)), ...filesMark(n, src.startsWith('inventory.prs[PR_NAMES_ITEM]'), dd) });
    for (const [n, why] of [...weak.entries()].sort((a, b) => a[0] - b[0])) if (!explicit.has(n)) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'INVENTORY_WEAK', source: `inventory.prs:${why}`, at: prAt(pulls.get(n)) });
    for (const o of overlayLinks.filter((x) => x.itemId === it.id)) { const n = Number(String(o.value).replace('#', '')); if (pulls.has(n)) addPr({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'OVERLAY', source: `overlay:${o.by}`, at: prAt(pulls.get(n)) }); }
    for (const [m, strength] of [[byTitle, 'ID_IN_TITLE'], [byBranch, 'ID_IN_BRANCH'], [byBody, 'ID_IN_BODY']]) {
      const field = strength === 'ID_IN_TITLE' ? 'title' : strength === 'ID_IN_BRANCH' ? 'branch' : 'body';
      for (const n of [...new Set(m.get(it.id) || [])].sort((a, b) => a - b)) {
        const src = field === 'body' ? 'pr.body' : field === 'title' ? 'pr.title' : 'pr.head.ref';
        // a backlog write-back / planning / READY-marking PR only records the item: never evidence that it was coded, integrated or started
        // (a whole-title bookkeeping PR's body mention included: it never corroborates a merged claim either)
        if (isBk(n, it.id, field)) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'BOOKKEEPING_PR', source: `${src} (bookkeeping: ${bkIds.get(n) === 'ALL' ? 'title' : 'status clause'})`, at: prAt(pulls.get(n)) });
        // a DOCS_ONLY PR: a body mention is never evidence; a title / branch naming the row is OWN only for a documentation deliverable
        else if (docsOnly(n) === true && (field === 'body' || !dd)) add({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength: 'DOCS_ONLY_WEAK', source: `docs-only-${field}`, at: prAt(pulls.get(n)) });
        else addPr({ itemId: it.id, kind: 'PR', ref: `#${n}`, pr: n, strength, source: src, at: prAt(pulls.get(n)), ...filesMark(n, true, dd) });
      }
    }
    for (const c of [...new Map((byCommit.get(it.id) || []).map((c) => [c.sha, c])).values()].sort((a, b) => cmp(a.at, b.at) || cmp(a.sha, b.sha))) {
      // a DOCS_ONLY commit's message mention is never integration or start evidence unless the row's own deliverable is documentation
      const d = commitDocsOnly(c.sha);
      if (d === true && !dd) add({ itemId: it.id, kind: 'COMMIT', ref: c.sha, strength: 'DOCS_ONLY_WEAK', source: 'docs-only-commit', at: c.at });
      else add({ itemId: it.id, kind: 'COMMIT', ref: c.sha, strength: 'ID_IN_COMMIT_MESSAGE', source: 'v7 commit message', at: c.at, ...(!DO ? {} : d === true ? { docsOnly: `DOC_DELIVERABLE:${dd}` } : d === null ? { commitFiles: 'UNKNOWN' } : {}) });
    }
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
