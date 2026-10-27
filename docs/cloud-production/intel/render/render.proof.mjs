//TR: P10 çıktı kanıtı (ağsız): MD başlıkları A–J tam bu sırada; runtime NOT_MEASURED, FULL/FULL_ONLY ayrımı, hedef aralıkları, installer istisnası, PARTIAL satırı ve MVP payda gerekçesi panoda; çapa sayılar JSON alanlarına eşit; CSV sabit sütun sırasıyla JSON kalemlerine geri dönüşür; //TR ilk satırları/ilk anahtarları mevcut; CSV'de yorum satırı yok. K7: Founder kuyruğu A (sayı + ilk 5'te P0), G (tablo) ve H (eylem) bölümlerinde görünür.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { miniBundle } from '../fixtures/mini/bundle.mjs';
import { loadRules } from '../lib/gather.mjs';
import { buildAll } from '../model/pipeline.mjs';
import { buildReport } from './report-json.mjs';
import { renderMarkdown, SECTION_HEADINGS } from './report-md.mjs';
import { inventoryJson, inventoryCsv, CSV_COLUMNS } from './inventory.mjs';
import { stableStringify } from '../core/canonical-json.mjs';
import { parseCsv } from '../core/csv.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const { rules } = loadRules(path.join(HERE, '..'));
const b = miniBundle();
const m = buildAll(b.inputs, rules, b.overlay, b.meta, b.nowIso);
const jsonText = stableStringify(buildReport(m, { ...b.meta, nowIso: b.nowIso, compactMetrics: {} }));
const r = JSON.parse(jsonText);
const md = renderMarkdown(r);
const heads = md.split('\n').filter((l) => /^## [A-Z]\. /.test(l));
check('MD has headings A-J exactly in order', JSON.stringify(heads) === JSON.stringify(SECTION_HEADINGS) && heads.map((h) => h[3]).join('') === 'ABCDEFGHIJ');
check('MD first line is the //TR comment', md.split('\n')[0] === '<!-- //TR: UASCO günlük proje istihbarat raporu (deterministik, tek kaynak) -->');
check('MD executive summary (A) comes first', md.indexOf(SECTION_HEADINGS[0]) < md.indexOf(SECTION_HEADINGS[1]));
const row = (label) => md.split('\n').find((l) => l.startsWith(`| ${label}`));
const rows0 = () => parseCsv(inventoryCsv(m)).slice(1);
const inv = inventoryJson(m, { inputsShort: {} });
check('anchor: live denominators equal JSON metrics (FULL liveNow, FULL 19-Oct, MVP liveNow, MVP 19-Oct)', row('Canlı iş (payda)') === `| Canlı iş (payda) | ${r.metrics.full.n} | ${r.metrics.baseline741.n} | ${r.metrics.mvp.n} | ${r.metrics.mvpBaseline.n} |`);
// R2 LOW: an open PR without a file list is founder UNKNOWN (never 'hayır' / 0); a known file list keeps the legacy boolean/number (fails on 4e1a897)
const op5 = r.openPrs.find((p) => p.number === 5), op30 = r.openPrs.find((p) => p.number === 30);
check('R2 open PR #5 without a file list: founder UNKNOWN, protectedFiles null, MD row UNKNOWN (4e1a897: founder false / 0 / hayır)', !!op5 && op5.protectedFilesKnown === false && op5.founder === 'UNKNOWN' && op5.protectedFiles === null && /^\| #5 \|.*\| UNKNOWN \(dosya listesi alınamadı\) \| UNKNOWN \(dosya listesi yok\) \|/m.test(md) && !r.founder.some((f) => f.pr === 5) && r.founderFilesUnknown.some((f) => f.pr === 5 && /file list UNKNOWN/.test(f.action)));
check('R2 open PR #30 with a known protected file keeps the legacy types (founder true, protectedFiles 1)', !!op30 && op30.founder === true && op30.protectedFiles === 1 && op30.protectedFilesKnown === true);
check('R2 inventory JSON carries corroboratingWeakPrs (WEAK-only corroboration listed apart from integratedPrs)', (inv.items.find((x) => x.id === 'UI-025') || {}).corroboratingWeakPrs?.join() === '6' && (inv.items.find((x) => x.id === 'UI-025') || {}).integratedPrs?.length === 0);
// R3 LOW (fails on f0f537c): a WEAK-only row is visible as such in the 323 table, the CSV and the JSON docs; bookkeeping PRs are named in the docs
{
  const d2 = md.split('\n').find((l) => l.startsWith('| UI-025 | screens |'));
  const cr = rows0().find((c) => c[0] === 'UI-025');
  check("R3 D.2 row of the WEAK-only UI-025 shows CORROBORATED_BY_WEAK_REF, 'WEAK: #6' and the WEAK reason (f0f537c: EVIDENCED_BY_PR | — | ... | —)", !!d2 && d2.includes('| CORROBORATED_BY_WEAK_REF | WEAK: #6 |') && /WEAK 19-Oct reference/.test(d2));
  check("R3 CSV has a corroboratingWeakPrs column: '#6' for UI-025, empty for an EXPLICIT row (UI-001)", CSV_COLUMNS.includes('corroboratingWeakPrs') && !!cr && cr[CSV_COLUMNS.indexOf('corroboratingWeakPrs')] === '#6' && rows0().find((c) => c[0] === 'UI-001')[CSV_COLUMNS.indexOf('corroboratingWeakPrs')] === '');
  check('R3 JSON field docs name bookkeeping PRs and the ownership rule (another item\'s PR never counts) and document actual.earlierMention; the ratio reason excludes both (intel-1.4 wording)', /BOOKKEEPING_PR/.test(r.fieldSemantics['items[].substeps.integrated']) && /another item's PR never counts/.test(r.fieldSemantics['items[].substeps.integrated']) && /ownership rule/.test(r.fieldSemantics['items[].substeps.integrated']) && !!r.fieldSemantics['items[].actual.earlierMention'] && /a PR owned only by other items never counts/.test(r.metrics.ratios3.codeIntegrationRatio.reason) && /bookkeeping PR or commit/.test(r.metrics.ratios3.codeIntegrationRatio.reason));
}
// K7 (R3-L1): the Founder queue view is rendered: A counts it and puts the P0 blocker among the first five, G has a table row per item, H lists
// the action (03ed064: DESIGN-EVIDENCE-X appeared in no Founder view)
{
  const secOf = (letter) => { const a = md.indexOf(`## ${letter}. `); const b = md.indexOf('\n## ', a + 4); return md.slice(a, b < 0 ? undefined : b); };
  const A = secOf('A'), G = secOf('G'), H = secOf('H');
  check("K7 MD Founder view: section A counts 3 Founder blockers and lists DESIGN-EVIDENCE-X P0 among the first five; section G has a row for each of DESIGN-EVIDENCE-X / FD-SIGN-X / RESEAL-X; section H lists their actions; LOCAL-BLOCKED-X is in none (03ed064: absent)",
    /Founder engelleri \(BLOCKED; sahibi FOUNDER veya yeni yetki gerekli\):\*\* 3 \(DESIGN-EVIDENCE-X P0, FD-SIGN-X, RESEAL-X\)/.test(A) && /^  - DESIGN-EVIDENCE-X: BLOCKED, sahibi FOUNDER, yeni yetki gerekli/m.test(A)
    && ['DESIGN-EVIDENCE-X', 'FD-SIGN-X', 'RESEAL-X'].every((id) => new RegExp(`^\\| ${id} \\|`, 'm').test(G) && new RegExp(`^- ${id}: Founder engeli`, 'm').test(H)) && !/LOCAL-BLOCKED-X/.test(A + G + H.replace(/\*\*Lane[\s\S]*?\*\*Doğrulama/, '')) && Array.isArray(r.plan.founderBlocked) && !!r.fieldSemantics['plan.founderBlocked']);
}
// LOW label fixes (each fails on 4fe58dd)
check('LOW runtime row shows NOT_MEASURED, never 0/n (%0)', /^\| Runtime doğrulandı \(runtimeVerificationRatio\) \| NOT_MEASURED/.test(row('Runtime doğrulandı') || '') && !/\| 0\/\d+ \(%0\)/.test(row('Runtime doğrulandı') || ''));
check("LOW 'FULL' has one meaning: the scope subset is FULL_ONLY (31 Ekim view and inventory scope)", md.includes('Ertelenebilir (DEFERRED + FULL_ONLY; 19 Ekim tabanı)') && !md.includes('(DEFERRED + FULL)') && inv.items.every((x) => x.scope !== 'FULL'));
check('LOW target ranges are shown as ranges (M0 P80 16:00–17:00, M2 P80 2026-11-10..2026-11-12) with the stated confidence line', md.includes('P80 2026-10-15 16:00–17:00 TSİ') && md.includes('P80 2026-11-10..2026-11-12') && /\| T-M0 \|[^\n]*\| MEDIUM \(satır 78/.test(md));
check('LOW installer CI in the MVP chain is labelled as an exception', md.includes('İstisna (DESKTOP_INSTALLER): EXCEPTION: installer CI = build evidence only'));
check('H1 PARTIAL integration has its own dashboard row', !!row('Kısmi entegrasyon (PARTIAL; entegre sayılmaz)') && row('Kısmi entegrasyon (PARTIAL; entegre sayılmaz)').includes(`| ${r.metrics.full.substeps.integrated?.PARTIAL} |`));
check('M3 MVP denominator change is reported with its reasons', !!r.reconciliation.mvpScope && md.includes(`- MVP paydası: ${r.reconciliation.mvpScope.value} = 19 Ekim AT_RISK ${r.reconciliation.mvpScope.baseline} + açık kuralla MVP olan eklenen ${r.reconciliation.mvpScope.addedMvp.length}`));
check('M1 phase actual-start line names the sources checked and the UNKNOWN count', /bilinen faz: \d+\/\d+; UNKNOWN \d+ \(kontrol edilen kaynaklar: inventory\.prs EXPLICIT PR/.test(md));
const ci = r.metrics.ratios3.codeIntegrationRatio;
check('anchor: code integration ratio equals JSON', row('Kod entegrasyonu').includes(`${ci.full.n}/${ci.full.d}`) && row('Kod entegrasyonu').includes(`${ci.mvp.n}/${ci.mvp.d}`));
check('anchor: closed phases equals JSON', md.includes(`**${r.metrics.roadmap.phases.closedByEvidence}/${r.metrics.roadmap.phases.total}**`));
check('anchor: 323-table row count equals reconciliation.r323', md.includes(`${r.reconciliation.r323.length} satır)`));
check('anchor: oct31 risk equals JSON', md.includes(`**31 Ekim riski:** ${r.oct31Risk}.`));
check('anchor: department total row equals JSON totals', row('**Toplam**').startsWith(`| **Toplam** | ${r.metrics.full.n} | ${r.metrics.full.statusCounts.MERGED_NOT_VERIFIED} |`));
check('anchor: MVP chain rows equal JSON mvp[]', r.mvp.every((s) => md.includes(`| ${s.step} | ${s.status} |`)));
check('report JSON first key is //TR', Object.keys(r)[0] === '//TR');
check('inventory JSON first key is //TR and items are sorted by id', Object.keys(inv)[0] === '//TR' && inv.items.every((x, i, a) => i === 0 || a[i - 1].id < x.id));
const csv = inventoryCsv(m);
const rows = parseCsv(csv);
check('CSV has no comment line: first line is the fixed header', rows[0].join(',') === CSV_COLUMNS.join(','));
check('CSV row count equals inventory items', rows.length - 1 === inv.items.length);
const idx = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, i]));
const rt = rows.slice(1).every((cols, i) => { const x = inv.items[i]; return cols[idx.id] === x.id && cols[idx.status] === x.status && cols[idx.reconClass] === x.reconClass && cols[idx.scope] === x.scope && cols[idx.prs] === x.prs.map((n) => `#${n}`).join(';') && cols[idx.missingEvidence] === [...x.missingEvidence].sort().join(';') && cols[idx.integrated] === x.substeps.integrated && cols[idx.department] === x.department; });
check('CSV round-trips to the JSON items (id, status, reconClass, scope, prs, missingEvidence, substeps, department)', rt);
check('render is deterministic (same JSON -> same MD bytes)', renderMarkdown(JSON.parse(jsonText)) === md && inventoryCsv(m) === csv);
check('no Math.random / toLocaleString in render or model code paths', !/Math\.random|toLocale/.test(md));
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
