//TR: UASCO_REMAINING_WORK.md: yalnız rapor JSON nesnesinden üretilir (elle yazılmış sayı yoktur; düzeltme C-3). Bölümler A–J sırasıyla; başlıklar Türkçe, kimlikler İngilizce; önce yönetici özeti.
const esc = (v) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const P = (x) => (x === 'UNKNOWN' || x === null || x === undefined ? 'UNKNOWN' : `%${String(x).replace('.', ',')}`);
const N = (x) => (typeof x === 'number' && !Number.isInteger(x) ? String(x).replace('.', ',') : x ?? '—');
const R = (r) => (!r ? '—' : r.n === 'NOT_MEASURED' ? `NOT_MEASURED (payda ${r.d}; ölçüm kaynağı yok)` : `${r.n}/${r.d} (${P(r.pct)})`);
const qWhen = (q) => `${q.dateRange ? `${q.dateRange.from}..${q.dateRange.to}` : q.date || 'UNKNOWN'}${q.timeRange ? ` ${q.timeRange.from}–${q.timeRange.to} TSİ` : q.time ? ` ${q.time} TSİ` : ''}`;
const sha7 = (s) => (s ? String(s).slice(0, 7) : '—');
const table = (head, rows) => [`| ${head.map(esc).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const list = (xs, cap) => (xs.length > cap ? `${xs.slice(0, cap).join(', ')} … (+${xs.length - cap})` : xs.join(', ') || '—');
const ST = ['MERGED_NOT_VERIFIED', 'IMPLEMENTED_NOT_MERGED', 'FOUNDER_ACTION_REQUIRED', 'BLOCKED', 'IN_PROGRESS', 'QUEUED', 'NOT_STARTED', 'UNKNOWN', 'COMPLETED_AND_VERIFIED'];

export const SECTION_HEADINGS = [
  '## A. Founder Yönetici Panosu (Founder Executive Dashboard)',
  '## B. Roadmap İlerlemesi (Roadmap Progress)',
  '## C. Departman İlerlemesi (Department Progress)',
  '## D. Ürün Tamamlanma (Product Completion)',
  '## E. Ajan Fabrikası (Agent Factory)',
  '## F. Mühendislik Verimliliği (Engineering Productivity)',
  '## G. Engeller ve Founder Kararları (Blockers and Founder Decisions)',
  '## H. Yarının Yürütme Planı (Tomorrow\'s Execution Plan)',
  '## I. Tarihsel Trend (Historical Trend)',
  '## J. Veri Kalitesi ve Güven (Data Quality and Confidence)',
];

export function renderMarkdown(r, { listCap = 40 } = {}) {
  const M = r.metrics, F = M.full, B = M.baseline741, V = M.mvp, rec = r.reconciliation, dq = r.dataQuality, fr = r.freshness, gh = fr.github;
  const asOf = gh.state === 'FRESH' ? '' : ` (as of ${gh.asOf || 'UNKNOWN'})`;
  const L = [];
  L.push('<!-- //TR: UASCO günlük proje istihbarat raporu (deterministik, tek kaynak) -->');
  L.push('# UASCO: Kalan İş ve Proje İstihbaratı (Intel V1, deterministik)', '');
  L.push(`- **Oluşturulma:** ${r.generatedAtTRT} (${r.generatedAt})`);
  L.push(`- **Kaynak SHA'lar:** v7/integration \`${sha7(r.inputs.baseSha)}\`, uasco/production-queue \`${sha7(r.inputs.queueSha)}\`, uasco/production-reports \`${sha7(r.meta.refs.reports.sha)}\`, envanter blob'u \`${sha7(r.inputs.inventoryBlob)}\` (2026-10-19; tarihsel taban, güncel gerçek değil)`);
  L.push(`- **Yöntem:** \`docs/cloud-production/intel/intel.mjs\` (motor ağacı \`${sha7(r.meta.engineTree)}\`${r.meta.engineDirty ? `; **DIRTY**: çalışan kopya HEAD'den farklı (${r.meta.engineDirtyFiles.length} dosya), çalışma özeti \`${String(r.meta.engineWorkHash || '').slice(0, 12)}…\`` : ''}; semantik ${r.meta.semantics || '—'})`);
  L.push(`  - ${r.githubCalls} salt okuma GitHub çağrısı (${gh.notModified} adet 304); GitHub verisi ${gh.state}${asOf}; LLM yok.`);
  L.push(`  - Girdi parmak izi \`${String(r.fingerprint).slice(0, 12)}…\`; yeniden kullanım: ${r.meta.reused ? 'evet' : 'hayır'}.`);
  L.push('- **Veri yolu:** `reports/local/UASCO_REMAINING_WORK.json`; ek: `UASCO_WORK_INVENTORY.json` ve `UASCO_WORK_INVENTORY.csv`', '');
  L.push('**Kural:** JSON durum alanları, FAKE yürütücü çalıştırmaları, installer CI ve backlog "DONE" kanıt değildir. "PR merge edildi" tamamlandı demek değildir; tamamlanma yalnız ürün kabul kanıtıyla sayılır. 19 Ekim "prs" metninde yalnız notsuz tekil ve kalemle eşleşen PR referansı EXPLICIT kanıttır; aralık, iç içe, "consumer / relies on / tests only / reviews on / precedent" gibi notlu ya da başka kalemin PR\'ı WEAK\'tir ve ilerleme iddiası olmayan satırı yükseltmez. İstisna (etiketli): MVP zincirindeki Desktop adımı installer CI başarısını yalnız derleme kanıtı olarak kullanır.', '');
  L.push('**Terimler:** "FULL" sütunu TÜM canlı kalemlerdir; kalem kapsamı "FULL_ONLY" ise yalnız tam üründe gereken (31 Ekim etkisi NONE) alt kümedir. "MVP (liveNow)" 19 Ekim AT_RISK satırları + açık kuralla MVP olan eklenen kalemlerdir.', '');

  // ---- A
  L.push(SECTION_HEADINGS[0], '');
  const ra = M.ratios3, rb = r.metrics.ratios3Baseline;
  L.push('**PR merge edildi ≠ bitti.** Üç oran ayrı tutulur; hiçbiri diğerine karışmaz.', '');
  const VB = M.mvpBaseline;
  const cols4 = (f) => [f(F), f(B), f(V), f(VB)];
  L.push(table(['Ölçüt', 'FULL (liveNow)', 'FULL (19 Ekim tabanı)', 'MVP (liveNow)', 'MVP (19 Ekim tabanı)'], [
    ['Canlı iş (payda)', ...cols4((x) => x.n)],
    ['Kod entegrasyonu: tüm EXPLICIT PR merge / v7 commit kanıtı (codeIntegrationRatio)', R(ra.codeIntegrationRatio.full), R(rb.codeIntegrationRatio.full), R(ra.codeIntegrationRatio.mvp), R(rb.codeIntegrationRatio.mvp)],
    ['Kısmi entegrasyon (PARTIAL; entegre sayılmaz)', ...cols4((x) => x.substeps.integrated.PARTIAL ?? 0)],
    ['Gerçekten tamamlandı + ürün kabulü (acceptedCompletionRatio)', R(ra.acceptedCompletionRatio.full), R(rb.acceptedCompletionRatio.full), R(ra.acceptedCompletionRatio.mvp), R(rb.acceptedCompletionRatio.mvp)],
    ['Runtime doğrulandı (runtimeVerificationRatio)', R(ra.runtimeVerificationRatio.full), R(rb.runtimeVerificationRatio.full), R(ra.runtimeVerificationRatio.mvp), R(rb.runtimeVerificationRatio.mvp)],
    ['CI ile test edildi (testedRatio)', ...cols4((x) => `${R(x.ratios.testedRatio)}; UNKNOWN ${x.ratios.testedUnknown}`)],
    ['Geliştirme ilerlemesi alt sınırı (coded+integrated+tested, UNKNOWN/PARTIAL=0)', ...cols4((x) => `${P(x.devProgressLowerBound)} (UNKNOWN/PARTIAL payı ${P(x.devProgressUnknownShare)})`)],
    ['Uzlaşmamış (UNKNOWN veya STALE)', ...cols4((x) => x.unreconciled)],
    ['UNKNOWN durum', ...cols4((x) => x.statusCounts.UNKNOWN)],
  ]), '');
  L.push(`- Kod entegrasyonu: ${ra.codeIntegrationRatio.reason}.`);
  L.push(`- Runtime doğrulama: ${ra.runtimeVerificationRatio.reason}.`);
  L.push(`- Kabul: ${ra.acceptedCompletionRatio.reason} (kaynak: ${ra.acceptedCompletionRatio.source}).`);
  const MS = rec.mvpScope;
  L.push(`- MVP paydası: ${MS.value} = 19 Ekim AT_RISK ${MS.baseline} + açık kuralla MVP olan eklenen ${MS.addedMvp.length}${MS.addedMvp.length ? ` (${MS.addedMvp.map((x) => `${x.id}: ${x.rule}`).join('; ')})` : ''}; eklenen diğer ${MS.addedNotMvp} kalem FULL_ONLY (${MS.addedDefaultReason}). Kontrol edilen kurallar: ${MS.rulesChecked.map((x) => `${x.id} ${x.matched}`).join(', ')}.`);
  L.push(`- Ağırlık: ${M.weights.model}: ${M.weights.note}.`);
  L.push(`- **31 Ekim riski:** ${r.oct31Risk}. **ETA:** ${r.eta} (${r.metrics.eta.mvpAcceptance.reason || r.metrics.eta.mvpAcceptance.state}).`);
  const chainBlocks = r.metrics.mvpChain.filter((s) => s.status === 'BLOCKED').map((s) => ({ id: `MVP:${s.id}`, text: `${s.step} BLOCKED — ${s.evidence}${s.open.length ? `; açık: ${s.open.join('; ')}` : ''}` }));
  const FB = r.plan.founderBlocked || [];
  const topBlock = [...chainBlocks, ...FB.filter((x) => x.priority === 'P0').map((x) => ({ id: x.id, text: `${x.status || 'BLOCKED'}, sahibi ${x.owner || '—'}${x.requiresNewAuthority ? ', yeni yetki gerekli' : ''}: ${x.title}` })), ...r.plan.founderDecisions.map((d) => ({ id: d.id, ageHours: d.ageHours, text: r.decisions.find((x) => x.id === d.id).text }))].slice(0, 5);
  L.push(`- **Bekleyen Founder kararları:** ${r.decisions.filter((d) => d.state === 'OPEN').length} açık (kanıtla çözülmüş ${r.decisions.filter((d) => d.state === 'RESOLVED_BY_EVIDENCE').length}).`);
  L.push(`- **Founder engelleri (BLOCKED ya da kaydı BLOCKED olan FOUNDER_ACTION_REQUIRED; sahibi FOUNDER veya yeni yetki gerekli):** ${FB.length}${FB.length ? ` (${FB.slice(0, 8).map((x) => `${x.id}${x.priority ? ` ${x.priority}` : ''}`).join(', ')}${FB.length > 8 ? ', …' : ''})` : ''}.`);
  L.push('- **İlk 5 engel (önce BLOCKED MVP adımları, sonra P0 Founder engelleri, sonra en eski açık Founder kararı):**');
  for (const d of topBlock) L.push(`  - ${d.id}${d.ageHours !== undefined ? ` (${N(d.ageHours ?? 'UNKNOWN')} sa)` : ''}: ${esc(d.text.slice(0, 160))}`);
  L.push(`- **Tazelik:** v7 \`${sha7(fr.v7.sha)}\` @${fr.v7.at} (${fr.v7.state}); kuyruk \`${sha7(fr.queue.sha)}\` @${fr.queue.at} (${fr.queue.state}); GitHub ${gh.state}${Object.values(gh.sources || {}).some((x) => x.state !== 'FRESH') ? ` (${Object.values(gh.sources).filter((x) => x.state !== 'FRESH').map((x) => `${x.source} ${x.state}`).join(', ')})` : ''} (${gh.calls} çağrı, kalan kota ${gh.rateRemaining ?? 'UNKNOWN'}); hazırlık ölçümü ${fr.readiness.state}.`, '');

  // ---- B
  L.push(SECTION_HEADINGS[1], '');
  const RM = M.roadmap, CP = M.criticalPath;
  L.push(`- Kanıtla kapanan faz (PHASE_NNN_VERIFIED attestation): **${RM.phases.closedByEvidence}/${RM.phases.total}**. Sözleşme state PLANNED: ${RM.phases.contractStatePlanned}/${RM.phases.total} (${RM.phases.note}).`);
  L.push(`- Review paketleri kapanan: ${RM.packages.closed}/${RM.packages.total}. Kritik yol: **${CP.closed}/${CP.length}** kapandı; ilk açık kritik faz ${CP.firstOpenCriticalPhase ? `${CP.firstOpenCriticalPhase.id} (${CP.firstOpenCriticalPhase.title}; kalem durumu ${CP.firstOpenCriticalPhase.itemStatus}, 19 Ekim durumu ${CP.firstOpenCriticalPhase.status19 ?? '—'}; faz kapanışı attestation ister)` : '—'}.`);
  L.push(`- Kritik yolda AT_RISK faz: ${CP.atRisk}; entegre bağlı işi olan: ${CP.withIntegratedLinkedWork}; Founder'a bağlı: ${CP.founderBlocked}. Ağırlık modeli: ${CP.weightModel}.`, '');
  L.push(table(['Wave', 'Faz', 'Kanıtla kapanan', 'İlerleme', 'Bağlı kalem', 'Entegre bağlı kalem'], RM.byWave.map((w) => [w.wave, w.phases, w.closed, P(w.progress), w.linkedItems, w.integratedItems])), '');
  L.push(table(['Dönem', 'Başlık', 'Faz', 'Kapanan'], RM.byPeriod.map((p) => [p.period, p.title, p.phases, p.closed])), '');
  const O = M.oct31;
  L.push('**31 Ekim MVP görünümü**', '');
  L.push(table(['Ölçüt', 'Değer'], [
    ['Tamamlandı (kabul)', `${O.done.accepted}/${O.done.of}`], ['Entegre (kod)', `${O.integrated.n}/${O.integrated.of}`], ['Eksik (MVP, entegre değil)', O.missing],
    ['MVP zinciri DONE', `${O.mvpChainDone.done}/${O.mvpChainDone.of}`], ['Founder kararına bağlı MVP kalemi', O.founderBlocked], ['Açık Founder kararı', O.openDecisions],
    ['Ertelenebilir (DEFERRED + FULL_ONLY; 19 Ekim tabanı)', `${O.deferrable.total} (DEFERRED ${O.deferrable.DEFERRED} + FULL_ONLY ${O.deferrable.FULL_ONLY})`],
    ['Kapasite', `builderCap ${O.capacity.queueBuilderCap} (${O.capacity.sources.queueBuilderCap}) / ${O.capacity.lanesBuilderCap} (${O.capacity.sources.lanesBuilderCap}); maxOpenPrs ${O.capacity.queueMaxOpenPrs}; merge/gün (7g) ${N(O.capacity.mergesPerDay7d)}`],
  ]), '');
  L.push('**MVP zinciri (9 adım; DONE yalnız kabul kanıtıyla)**', '');
  L.push(table(['Adım', 'Durum', 'Kanıt', 'Açık iş'], r.mvp.map((s) => [s.step, s.status, s.evidence, s.open.join('; ') || '—'])), '');
  for (const s of M.mvpChain.filter((x) => x.evidenceException)) L.push(`- İstisna (${s.id}): ${s.evidenceException}; adım IMPLEMENTED_NOT_VERIFIED'ın ötesine geçemez.`);
  if (M.mvpChain.some((x) => x.evidenceException)) L.push('');
  const E = M.eta;
  L.push(`- ETA (MVP kabul): ${E.mvpAcceptance.state}${E.mvpAcceptance.reason ? ` (${E.mvpAcceptance.reason}, ${E.mvpAcceptance.points} nokta)` : ` ${E.mvpAcceptance.eta}`}. Yalnız kod entegrasyonu ETA'sı (tamamlanma değil): ${E.mvpIntegrationOnly.state}${E.mvpIntegrationOnly.reason ? ` (${E.mvpIntegrationOnly.reason})` : ` ${E.mvpIntegrationOnly.eta}`}.`, '');
  L.push('**Hedefler (hepsi kaynağıyla; aşılmış olanlar da)**', '');
  L.push(table(['Id', 'Hedef', 'Tarih', 'Nicelik (aralıklar kaynaktaki gibi)', 'Güven', 'Durum', 'Kaynak'], r.targets.map((t) => [t.id, t.label, t.date || (t.range ? `${t.range.from}..${t.range.to}` : 'UNKNOWN'), t.quantiles.map((q) => `${q.q} ${qWhen(q)}`).join('; '), `${t.confidence}${t.confidenceSource ? ` (satır ${t.confidenceSource.line}, ${t.confidenceSource.check})` : ''}`, t.state, `${t.source.path}@${t.source.ref}:${t.quantiles.map((q) => q.rangeSource ? `${q.source.line}/${q.rangeSource.line}` : q.source.line).join(',')} (${t.quantiles.every((q) => q.sourceCheck === 'VERIFIED' && (q.rangeSourceCheck ?? 'VERIFIED') === 'VERIFIED') ? 'VERIFIED' : 'CHECK_FAILED'})`])), '');
  L.push(`- Program uyumu (faz): ${M.schedule.phaseAdherence.state}: ${M.schedule.phaseAdherence.reason} (payda ${M.schedule.phaseAdherence.denominator}).`);
  L.push(`- Planlanan başlangıç/bitiş: 149 fazın hepsinde null; kontrol edilen kaynak kümesi ${M.datesChecked.sourceSet}; bulunan tarih alanı: ${M.datesChecked.fieldsFound.length ? M.datesChecked.fieldsFound.join(', ') : 'yok'}; scheduler updatedAt ${M.datesChecked.schedulerUpdatedAt ?? 'null'}. Hiçbir tarih enterpolasyonla üretilmedi.`);
  const withStart = M.byPhase.filter((p) => p.actualStart).length;
  L.push(`- Gerçek başlangıç (yalnız kalemin kendi kanıtı: merge edilmiş/açık kendi PR'ı; kodlanmış kalem için konu başında kimliğini adlandıran kendi commit'i, entegrasyon kanıtı olarak kabul edilen commit'i veya kayıt başı; kapanmış-merge edilmemiş PR, WEAK referans, başka kaleme atanmış PR, backlog write-back/planlama/READY işaretleme PR'ı ve backlog/planlama kayıt commit'i asla) bilinen faz: ${withStart}/${M.byPhase.length}; UNKNOWN ${M.byPhase.length - withStart} (kontrol edilen kaynaklar: ${(r.reconciliation.startSourcesChecked || []).join('; ') || 'kalem actual.startSourcesChecked'}). Gerçek bitiş yalnız attestation tarihidir (bugün UNKNOWN).`, '');

  // ---- C
  L.push(SECTION_HEADINGS[2], '');
  L.push('Her kalemin tek birincil departmanı vardır (rules/departments.json; ilk eşleşen kural). Satırların toplamı toplamlara eşittir; UNASSIGNED ayrı gösterilir.', '');
  const drows = M.byDepartment.map((d) => [d.label, d.full.n, ...ST.slice(0, 8).map((s) => d.full.statusCounts[s]), R(d.full.ratios.integratedRatio), R(d.mvp.ratios.integratedRatio), R(d.full.ratios.acceptedRatio), d.openPrs.map((n) => `#${n}`).join(', ') || '—', d.blockers, d.nextItem || '—']);
  drows.push(['**Toplam**', F.n, ...ST.slice(0, 8).map((s) => F.statusCounts[s]), R(F.ratios.integratedRatio), R(V.ratios.integratedRatio), R(F.ratios.acceptedRatio), '', M.byDepartment.reduce((a, d) => a + d.blockers, 0), '']);
  L.push(table(['Departman', 'Kalem', 'MNV', 'IMPL', 'FOUNDER', 'BLOCKED', 'IN_PROG', 'QUEUED', 'NOT_ST', 'UNKNOWN', 'Kod ent. FULL', 'Kod ent. MVP', 'Kabul', 'Açık PR', 'Engelli', 'Sıradaki'], drows), '');
  const un = dq.unassigned;
  L.push(`- UNASSIGNED: ${un.n} kalem (${P(un.full)}); en sık eşlenmeyen: ${(un.top || []).map((t) => `${t.key} ${t.n}`).join(', ') || '—'}.`);
  L.push(`- Departman toplam değişmezi: ${dq.departmentInvariant.ok ? 'GEÇTİ' : `İHLAL: ${dq.departmentInvariant.violations.join('; ')}`}.`, '');
  L.push('**Lane (PR dalı öneki; departman değildir)**', '');
  L.push(table(['Lane', 'Kalem', 'MNV', 'IMPL', 'FOUNDER', 'UNKNOWN', "Merge edilen PR (v0 kuralı)", 'Açık PR'], M.lanes.map((l) => { const lg = r.lanes.find((x) => x.lane === l.lane); return [l.lane, l.items, l.statusCounts.MERGED_NOT_VERIFIED, l.statusCounts.IMPLEMENTED_NOT_MERGED, l.statusCounts.FOUNDER_ACTION_REQUIRED, l.statusCounts.UNKNOWN, lg ? lg.mergedPrs : '—', lg ? lg.openPrs.map((n) => `#${n}`).join(', ') || '—' : '—']; })), '');

  // ---- D
  L.push(SECTION_HEADINGS[3], '');
  L.push('### D.1 Boyut bazında (19 Ekim tabanı, kanonik durum)', '');
  L.push(table(['Boyut', 'Canlı', 'MNV', 'IMPL', 'FOUNDER', 'BLOCKED', 'NOT_STARTED', 'UNKNOWN', 'STALE', 'MVP'], Object.entries(r.totals.byDimension).map(([k, v]) => [k, v.live, v.byStatus.MERGED_NOT_VERIFIED || 0, v.byStatus.IMPLEMENTED_NOT_MERGED || 0, v.byStatus.FOUNDER_ACTION_REQUIRED || 0, v.byStatus.BLOCKED || 0, v.byStatus.NOT_STARTED || 0, v.byStatus.UNKNOWN || 0, v.stale, v.mvpScope_AT_RISK])), '');
  const T = r.totals.allWorkDimensions, LV = r.totals.legacyV0;
  L.push(`- Toplam canlı ${T.live} (satır ${T.rows}; benzersiz ${T.unique}); MVP ${T.mvpScope_AT_RISK}; ertelenebilir ${T.deferrable_NOT_DELIVERABLE_or_NONE}. v0 kuralı aynı girdilerle: MERGED_NOT_VERIFIED ${LV.allWorkDimensions.mergedNotVerified}, UNRECONCILED ${LV.UNRECONCILED_WORK} (STALE ${LV.allWorkDimensions.stale} + UNKNOWN ${LV.allWorkDimensions.byStatus.UNKNOWN || 0}).`, '');
  L.push(`### D.2 323 uzlaştırma tablosu (v0 MERGED_NOT_VERIFIED satırları; ${rec.r323.length} satır)`, '');
  L.push(table(['Id', 'Boyut', 'Kapsam', 'baselineClass', 'evidenceClass', 'PR', 'Merge commit', 'Merge tarihi', 'Commit kanıtı', 'Eksik kanıt'], rec.r323.map((x) => [x.id, x.dimension, x.scope, x.baselineClass, x.evidenceClass, x.prs.map((n) => `#${n}`).join(', ') || ((x.weakPrs || []).length ? `WEAK: ${x.weakPrs.slice(0, 5).map((n) => `#${n}`).join(', ')}${x.weakPrs.length > 5 ? ` … (+${x.weakPrs.length - 5})` : ''}` : '—'), x.mergeCommits.join(', ') || '—', x.mergedAt.map((d) => d.slice(0, 10)).join(', ') || '—', x.commitEvidence ? `${x.commitEvidence.sha7} ${String(x.commitEvidence.at || '').slice(0, 10)} ${x.commitEvidence.matchKind}` : '—', (x.missingEvidence.find((m) => /^no PR\/commit\/route/.test(m)) || x.missingEvidence.find((m) => /^tested: integration rests only on WEAK/.test(m)) || x.missingEvidence[0] || '—')])), '');
  L.push('### D.3 Bölüntü tabloları (741 / 354) ve örtüşme', '');
  L.push(table(['baselineClass', 'v0 durumu', 'FULL', 'MVP', 'Ertelenebilir'], [...rec.baselinePartition.filter((p) => p.full).map((p) => [p.baselineClass, p.v0Status, p.full, p.mvp, p.deferrable]), ['**Toplam**', '', rec.baselinePartition.reduce((a, p) => a + p.full, 0), rec.baselinePartition.reduce((a, p) => a + p.mvp, 0), rec.baselinePartition.reduce((a, p) => a + p.deferrable, 0)]]), '');
  L.push(table(['reconClass (bugün)', 'FULL', 'MVP'], [...rec.currentPartition.filter((p) => p.full).map((p) => [p.reconClass, p.full, p.mvp]), ['**Toplam**', rec.currentPartition.reduce((a, p) => a + p.full, 0), rec.currentPartition.reduce((a, p) => a + p.mvp, 0)]]), '');
  const ovl = rec.overlap;
  L.push(`- Örtüşme (v0 323 ile v0 536): yalnız 323 = ${ovl.a323only.full} (MVP ${ovl.a323only.mvp}); ikisi = ${ovl.both.full} (MVP ${ovl.both.mvp}); yalnız 536 = ${ovl.a536only.full} (MVP ${ovl.a536only.mvp}); hiçbiri = ${ovl.neither.full} (MVP ${ovl.neither.mvp}). Toplam ${ovl.a323only.full + ovl.both.full + ovl.a536only.full + ovl.neither.full} / MVP ${ovl.a323only.mvp + ovl.both.mvp + ovl.a536only.mvp + ovl.neither.mvp}.`);
  L.push(`- liveNow = ${rec.liveNow.baseline} − ${rec.liveNow.removed} çıkarılan + ${rec.liveNow.added} eklenen = **${rec.liveNow.value}** (eklenenler: ${Object.entries(rec.liveNow.addedByOrigin).map(([k, v]) => `${k} ${v}`).join(', ') || 'yok'}).`, '');
  L.push(table(['Eklenen kalem', 'Köken', 'Durum', 'Kapsam', 'Gerekçe'], rec.addedItems.slice(0, listCap * 2).map((x) => [x.id, x.origin, x.status, `${x.scope} (${x.scopeRule})`, x.reason])), rec.addedItems.length > listCap * 2 ? `\n… (+${rec.addedItems.length - listCap * 2}; tamamı JSON reconciliation.addedItems)` : '', '');
  L.push('### D.4 Ekran, çalışma alanı ve endpoint kanıtı', '');
  const dimEv = (dim) => { const xs = (r.reconciliation.r323 || []).filter((x) => x.dimension === dim); return xs; };
  const ev = ['screens', 'workspaces', 'ux-decisions', 'endpoints', 'data-persistence'].map((d) => { const b = r.totals.byDimension[d]; const xs = dimEv(d); return [d, b ? b.live : 0, xs.filter((x) => x.evidenceClass === 'EVIDENCED_BY_PR').length, xs.filter((x) => x.evidenceClass === 'EVIDENCED_BY_COMMIT').length, xs.filter((x) => x.evidenceClass === 'STATUS_ONLY_UNVERIFIED').length]; });
  L.push(table(['Boyut', 'Canlı', '323 içinde PR kanıtlı', '323 içinde commit/route kanıtlı', '323 içinde yalnız durum alanı'], ev), '');

  // ---- E
  L.push(SECTION_HEADINGS[4], '');
  const AF = r.agentFactory;
  L.push(`- Kaynak: ${AF.state === 'MEASURED' ? `${AF.source}; authority ${AF.authority}; digest \`${String(AF.digest).slice(0, 12)}…\`` : `UNAVAILABLE (${AF.reason}); katmanlar UNKNOWN`}. Roller iş toplamına girmez.`);
  if (fr.readiness.sandbox && fr.readiness.sandbox.isolation !== 'none') L.push(`- Ürün kodu kum havuzunda çalıştı: ${fr.readiness.sandbox.version}, yalıtım ${fr.readiness.sandbox.isolation}; ortam yalnız ${fr.readiness.sandbox.envKeys.length} izinli anahtar (token/anahtar/sır yok); çıktıdan yalnız doğrulanmış sayı/enum alanları saklandı.`);
  else if (fr.readiness.reason === 'SANDBOX_UNAVAILABLE') L.push('- Ürün kodu ÇALIŞTIRILMADI: bu makinede ad alanı kum havuzu kurulamadı (SANDBOX_UNAVAILABLE); korumasız çalıştırma yoktur.');
  L.push(`- Rol ${AF.roles.denominator}, lonca ${AF.roles.guilds}, küme ${AF.roles.clusters}.`, '');
  L.push(table(['Katman', 'TRUE', 'FALSE', 'UNKNOWN', 'Payda', 'Ölçüldü', 'Nedenler'], AF.layers.map((l) => [l.layer, l.measured ? l.TRUE : 'UNKNOWN', l.measured ? l.FALSE : `(${l.FALSE})`, l.UNKNOWN, l.denominator, l.measured ? 'evet' : 'HAYIR (ölçülmeyen katman 0 gösterilmez)', l.reasons ? Object.entries(l.reasons).map(([k, v]) => `${k} ${v}`).join(', ') || '—' : (l.reason || '—')])), '');
  L.push(table(['Founder sütunu', 'Katman', 'TRUE / payda', 'Not'], AF.founderColumns.map((c) => [c.column, c.layer || '—', c.layer && c.measured ? `${c.TRUE}/${c.denominator}` : 'UNKNOWN (ölçülmedi)', c.note || '—'])), '');
  const RCl = AF.registryClaims;
  L.push(`- Değerlendirme spec'i: ${AF.evaluationSpecs.defined} tanımlı; kanıtla çalıştırılan (EVALUATED) ${AF.evaluationSpecs.executedByEvidence}. Kayıt iddiası (kanıt değil): evaluationSpecsExecuted ${RCl.evaluationSpecsExecuted}, boundRoles ${RCl.boundRoles}, withCandidateSkills ${RCl.withCandidateSkills} (PROPOSED).`);
  L.push(`- Adapter: ${AF.adapters.defined} tanımlı; implement edilen ${AF.adapters.implemented} (${AF.adapters.implementedReason}); yürütülen ${AF.adapters.executed}, doğrulanan ${AF.adapters.verified} (${AF.adapters.probeReason}). Kayıt iddiası: status ${Object.entries(RCl.adapterStatus).map(([k, v]) => `${k} ${v}`).join(', ')}; implementation ${Object.entries(RCl.adapterImplementation).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  L.push(table(['Resolver', 'Yol', 'Mevcut', 'İlk commit', 'İçe aktaran test', 'Wave 0'], AF.resolvers.map((x) => [x.id, x.path, x.present ? 'PRESENT' : 'ABSENT', x.introducedBy ? `${x.introducedBy.sha7} ${x.introducedBy.at.slice(0, 10)}` : '—', x.testedByFiles, x.wave0Package || '—'])), '');
  L.push(table(['Wave 0 paketi', 'Öncelik', 'Durum (kalem modeli)', 'PR', 'Başlık'], AF.wave0Packages.map((p) => [p.id, p.priority, p.status, p.prs.map((n) => `#${n}`).join(', ') || '—', p.title])), '');
  if (Array.isArray(AF.byCluster)) L.push(table(['Küme', 'Rol', 'DEFINED', 'PROFILED', 'KNOWLEDGE', 'TOOL_READY', 'EXECUTABLE', 'EVALUATED', 'CERTIFIED', 'RUNNING'], AF.byCluster.map((c) => { const v = (L) => (c.layers[L].measured ? c.layers[L].TRUE : 'UNKNOWN'); return [c.id, c.roles, v('DEFINED'), v('PROFILED'), v('KNOWLEDGE_READY'), `${v('TOOL_READY')} (U ${c.layers.TOOL_READY.UNKNOWN})`, v('EXECUTABLE'), v('EVALUATED'), v('INTERNALLY_CERTIFIED'), `${v('RUNNING')} (U ${c.layers.RUNNING.UNKNOWN})`]; })), '');
  L.push(`- Lonca bazında ayrıntı: JSON agentFactory.byGuild (${Array.isArray(AF.byGuild) ? AF.byGuild.length : 0} satır). Sürekli öğrenme: ${AF.continuousLearning}.`, '');

  // ---- F
  L.push(SECTION_HEADINGS[5], '');
  const PR = r.productivity;
  L.push(`- Başlangıç çapası: ${PR.sinceStart.anchor} (${PR.sinceStart.anchorSource}); ikinci çapa ${PR.sinceStart.secondAnchor} (${PR.sinceStart.secondAnchorSource}).`);
  L.push(`- PR toplamı ${PR.totals.prs} (v7/integration tabanlı ${PR.totals.v7Prs}: merge ${PR.totals.merged}, açık ${PR.totals.open}, merge edilmeden kapanan ${PR.totals.closedUnmerged})${asOf}.`, '');
  L.push(table(['Pencere', 'Açılan PR', 'Merge PR', 'Açılış→merge sa (medyan/p90)', 'İlk CI başarısı', 'Yeniden çalıştırma', 'CI süresi dk (medyan/p90; yöntem)', 'Runner dk', 'Kuyruk bloke sa'], PR.windows.map((w) => [w.window, w.prsOpened, w.prsMerged, `${N(w.openToMergeHours.median)}/${N(w.openToMergeHours.p90)} (n ${w.openToMergeHours.n})`, `${w.firstCiSuccess.success}/${w.firstCiSuccess.of} (${P(w.firstCiSuccess.rate)})`, `${w.reruns.runsWithRerun}/${w.reruns.ciRuns} (${P(w.reruns.ratio)})`, `${N(w.ciDurationMinutes.median)}/${N(w.ciDurationMinutes.p90)} (TIMING ${w.ciDurationMinutes.methods.TIMING}, APPROX ${w.ciDurationMinutes.methods.APPROX})`, w.runnerMinutes.value === 'UNKNOWN' ? 'UNKNOWN' : `${N(w.runnerMinutes.value)} (kapsam ${w.runnerMinutes.coverage})`, N(w.queueBlockedHours.value)])), '');
  L.push(`- Kuyruk bloke süresi etiketi: ${PR.windows[0].queueBlockedHours.label}. Founder karar yaşı: açık ${PR.founderDecisionAgeHours.open}, medyan ${N(PR.founderDecisionAgeHours.median)} sa, en eski ${N(PR.founderDecisionAgeHours.max)} sa.`);
  L.push(`- Merge reformu: kayıtlı merge ${PR.mergeReform.recordedMerges}, post-merge VERIFIED ${PR.mergeReform.postMergeVerified}; koordinatör 'at' ile GitHub merged_at farkı ${N(PR.mergeReform.coordinatorAtVsGithubMergedAtSeconds.min)}–${N(PR.mergeReform.coordinatorAtVsGithubMergedAtSeconds.max)} sn (otorite: ${PR.mergeReform.authority}).`);
  L.push(`- Token ve maliyet: ${PR.tokensAndCost.value} (${PR.tokensAndCost.reason}). Çalıştırma ayrıntısı: timing ${PR.runDetail.timingFetched}/${PR.runDetail.timing24hCandidates} (24s), jobs ${PR.runDetail.jobsFetched}/${PR.runDetail.jobs7dCandidates} (7g).`, '');

  // ---- G
  L.push(SECTION_HEADINGS[6], '');
  L.push(table(['PR', 'Lane', 'CI', 'Korumalı dosya', 'Founder', 'Yapılacak'], r.openPrs.map((p) => [`#${p.number}`, p.lane, `${p.ci} (u ${p.ubuntu}, w ${p.windows})${p.ciSource === 'STALE_CACHE' ? ` [önbellek, as of ${p.ciAsOf}]` : ''}`, p.protectedFilesKnown === false ? 'UNKNOWN (dosya listesi alınamadı)' : p.protectedFiles, p.founder === true ? 'evet' : p.founder === 'UNKNOWN' ? 'UNKNOWN (dosya listesi yok)' : 'hayır', (r.founder.find((f) => f.pr === p.number) || (r.founderFilesUnknown || []).find((f) => f.pr === p.number) || {}).action || '—'])), '');
  L.push('**Founder kuyruğu: BLOCKED kalemler ve kaydı BLOCKED olan FOUNDER_ACTION_REQUIRED kalemler (sahibi FOUNDER veya yeni yetki gerekli; P0 önce):**', '');
  L.push(FB.length ? table(['Kalem', 'Durum', 'Öncelik', 'Sahip', 'Yeni yetki', 'Kapsam', 'Engel', 'Başlık'], FB.map((x) => [x.id, x.status || 'BLOCKED', x.priority || '—', x.owner || '—', x.requiresNewAuthority ? 'evet' : 'hayır', x.scope, x.blockers.join(', ') || '—', x.title])) : '- Founder sahipli BLOCKED kalem yok.', '');
  L.push(table(['Karar', 'Kaynak', 'Durum', 'İlk görülme', 'Yaş (sa)', 'Çözüm kanıtı', 'Metin'], r.decisions.map((d) => [d.id + (d.synthesized ? ' (türetilmiş id)' : ''), d.source.replace('PRODUCTION-QUEUE.json ', 'queue '), d.state + (d.stale ? ' (STALE)' : ''), d.firstSeenAt ? `${d.firstSeenAt.slice(0, 16)} ${d.firstSeenCommit}` : 'UNKNOWN', N(d.ageHours ?? 'UNKNOWN'), d.resolution || (d.refsAllFinal ? 'tüm referans PR kapalı (karar metni kanıtla eşleşmedi)' : '—'), d.text.slice(0, 160)])), '');

  // ---- H
  L.push(SECTION_HEADINGS[7], '');
  L.push(`Sıralama (deterministik): ${r.plan.order.join(' → ')}. Lane başına ilk ${r.plan.topNPerLane} (builderCap ${r.plan.builderCap.queueBuilderCap} kuyruk / ${r.plan.builderCap.lanesBuilderCap} LANES.json).`, '');
  for (const l of r.plan.lanes) {
    L.push(`**Lane ${l.lane}**`, '');
    L.push(l.items.length ? table(['Kalem', 'Durum', 'Kapsam', 'Öncelik', 'Kritik yol', 'Eylem'], l.items.map((x) => [x.id, x.status, x.scope, x.priority || '—', x.criticalPath ? 'evet' : 'hayır', x.action])) : '- Bu lane için eylem yapılabilir kalem yok.', '');
  }
  L.push(`**Doğrulama hattı** (MERGED_NOT_VERIFIED MVP kalemleri için kabul kontrolü; toplam ${r.plan.verificationTotal}, ilk ${r.plan.verification.length}):`, '');
  for (const v of r.plan.verification) L.push(`- ${v.action}`);
  L.push('', '**Founder engelleri (BLOCKED ya da kaydı BLOCKED olan FOUNDER_ACTION_REQUIRED; sahibi FOUNDER veya yeni yetki gerekli; P0 önce):**', '');
  for (const x of (r.plan.founderBlocked || []).slice(0, listCap)) L.push(`- ${esc(x.action)}`);
  if (!(r.plan.founderBlocked || []).length) L.push('- yok');
  L.push('', '**Founder kararları (en eski önce):**', '');
  for (const d of r.plan.founderDecisions.slice(0, listCap)) L.push(`- ${esc(d.action)}`);
  L.push('');

  // ---- I
  L.push(SECTION_HEADINGS[8], '');
  const H = r.history;
  L.push(`- Önceki anlık görüntü: ${H.previous ? `${H.previous.source} (${H.previous.date}, ${H.previous.semantics || 'semantik bilinmiyor'}${H.previous.itemsReconstructed ? '; kalem durumları v0 kuralıyla yeniden kuruldu' : ''})` : 'yok'}.`, '');
  if (H.ruleChange) L.push(`- **Kural değişikliği:** önceki görüntü ${H.previous.semantics || 'bilinmeyen'} semantiğinde, bu görüntü ${H.semantics}. Aşağıdaki kalem değişimleri ve metrik farkları proje olaylarıyla yeni kanıt kurallarına göre yeniden sınıflandırmayı karıştırır; günlük ilerleme değildir. Trend sütunlarının paydası da semantiğe göre değişir (v0: 741, intel: liveNow).`, '');
  if (H.diff) {
    L.push(`- Fark: eklenen ${H.diff.counts.added}, çıkarılan ${H.diff.counts.removed}, değişen ${H.diff.counts.changed} kalem; metrik farkı ${H.diff.counts.metricDeltas}.`, '');
    L.push(`- Ayrıntı: ${'`'}UASCO_DELTA.json${'`'} ve JSON history.diff.`, '');
    L.push(table(['Metrik', 'Önce', 'Şimdi', 'Fark'], Object.entries(H.diff.metricDeltas).map(([k, v]) => [k, v.prev, v.cur, v.delta])), '');
    const chg = {}; for (const c of H.diff.changedItems) for (const x of c.changes) { const k = `${x.field}: ${x.prev} → ${x.cur}`; chg[k] = (chg[k] || 0) + 1; }
    L.push(table(['Değişim', 'Kalem'], Object.entries(chg).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, listCap).map(([k, v]) => [k, v])), '');
  }
  L.push(table(['Tarih', 'Semantik', 'FULL entegre', 'MVP entegre', 'Kabul', 'Uzlaşmamış', 'UNKNOWN', 'Merge/gün'], H.trend.map((p) => p.state === 'MISSING' ? [p.date, 'MISSING', '', '', '', '', '', ''] : [p.date, p.semantics, p.fullIntegrated ?? '—', p.mvpIntegrated ?? '—', p.fullAccepted ?? '—', p.unreconciled ?? '—', p.unknown ?? '—', p.mergesPerDay ?? '—'])), '');
  L.push('- v0 noktası (2026-10-26) eski semantiktedir: "entegre" sütunu orada v0 MERGED_NOT_VERIFIED sayısıdır (durum alanı dahil).', '');

  // ---- J
  L.push(SECTION_HEADINGS[9], '');
  const refDet = (x) => `${x.sha} @${x.at}; ${x.state === 'FRESH' ? `bu çalıştırmada fetch edildi ${x.fetchedAt}` : x.state === 'UNFETCHED' ? `bu çalıştırmada fetch yok; son FETCH_HEAD ${x.lastFetchAt || 'UNKNOWN'}` : `fetch başarısız${x.error ? ` (${x.error})` : ''}; son FETCH_HEAD ${x.lastFetchAt || 'UNKNOWN'}`}`;
  const srcRows = Object.values(gh.sources || {}).map((x) => [`GitHub: ${x.source}`, x.state, `${x.attempted} çağrı, ${x.failed} başarısız${x.servedFromCache ? `; önbellekten ${x.servedFromCache} kayıt (as of ${x.cacheAsOf || 'UNKNOWN'}${x.cacheAgeHours !== null && x.cacheAgeHours !== undefined ? `, ${N(x.cacheAgeHours)} sa önce` : ''})` : ''}${x.note ? `; ${x.note}` : ''}${x.lastError ? `; son hata ${x.lastError}` : ''}`]);
  L.push(table(['Kaynak', 'Durum', 'Ayrıntı'], [['v7/integration', fr.v7.state, refDet(fr.v7)], ['uasco/production-queue', fr.queue.state, refDet(fr.queue)], ['uasco/production-reports', fr.reports.state, refDet(fr.reports)], ['GitHub REST (genel: PR tablosu yenilenemezse STALE_CACHE/UNAVAILABLE, başka kaynak eksikse PARTIAL; kaynak satırlarına bakın)', gh.state, `asOf ${gh.asOf}; ${gh.calls} çağrı; 304 ${gh.notModified}; kalan ${gh.rateRemaining ?? 'UNKNOWN'}${gh.error ? `; hata ${gh.error}` : ''}`], ...srcRows, ['Hazırlık ölçümü (C-RDY-1)', fr.readiness.state, `${fr.readiness.reason || '—'}${fr.readiness.sandbox ? `; kum havuzu ${fr.readiness.sandbox.isolation}` : ''}`], ['Önbellek', fr.cache, '']]), '');
  L.push(`- v0 536 uzlaşmamış iş: baselineClass dağılımı ${Object.entries(dq.unreconciled536.byBaselineClass).map(([k, v]) => `${k} ${v}`).join(', ')}; bugünkü durumları ${Object.entries(dq.unreconciled536.nowByStatus).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  L.push(`- STATUS_ONLY_UNVERIFIED: ${dq.statusOnlyUnverified}. Aday bağlantı (yalnız gövde veya commit anması; yükseltme yapmaz): ${dq.candidateLinks.length} kalem. Hiçbir kaleme bağlanmayan merge edilmiş PR: ${dq.unattributedPrCount} (${list(dq.unattributedPrs.map((n) => `#${n}`), listCap)}).`);
  L.push(`- Reddedilen overlay kaydı: ${dq.rejectedOverlay.length}. UNASSIGNED payı: ${P(dq.unassigned.full)}. İncelenmemiş hedef adayı: ${dq.unreviewedTargetCandidates} (JSON targetCandidates).`, '');
  L.push('**Geçiş matrisi (baselineClass × reconClass)**', '');
  const tm = rec.transitionMatrix;
  const cols = [...new Set(Object.values(tm.full).flatMap((o) => Object.keys(o)))].sort();
  L.push(table(['baselineClass', ...cols, 'FULL', 'MVP'], [...Object.keys(tm.full).map((b) => [b, ...cols.map((c) => `${tm.full[b][c] || 0}${tm.mvp[b] && tm.mvp[b][c] ? ` (${tm.mvp[b][c]})` : ''}`), Object.values(tm.full[b]).reduce((a, n) => a + n, 0), Object.values(tm.mvp[b] || {}).reduce((a, n) => a + n, 0)]),
    ['**Toplam**', ...cols.map((c) => Object.values(tm.full).reduce((a, o) => a + (o[c] || 0), 0)), Object.values(tm.full).reduce((a, o) => a + Object.values(o).reduce((x, n) => x + n, 0), 0), Object.values(tm.mvp).reduce((a, o) => a + Object.values(o).reduce((x, n) => x + n, 0), 0)]]), '');
  L.push('- Hücre: FULL (MVP).', '');
  L.push('**Çelişkiler**', '');
  L.push(dq.contradictions.length ? table(['Kod', 'Ref', 'Ayrıntı'], dq.contradictions.map((c) => [c.code, c.ref, c.detail])) : '- yok', '');
  const lr = dq.legacyResidue;
  L.push(`- Eski model kalıntısı: ROADMAP.md '363 Agent' ${lr.roadmapMd363Agent} kez, '40 departments' ${lr.roadmapMd40Departments} kez; eski başlıklı fazlar ${lr.legacyPhaseTitles.join('; ') || '—'}; sözleşme review[] içinde Codex: ${lr.contractsWithCodexReview}.`, '');
  L.push('**Düzeltmeler (v0 raporuna göre)**', '');
  for (const c of dq.corrections) L.push(`- ${c.id} (${c.holds === true ? 'geçerli' : c.holds === false ? 'geçersiz' : 'UNKNOWN'}): ${esc(c.text)}`);
  L.push('', `- Bölüm güveni: ${Object.entries(dq.sectionConfidence).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  if (dq.dq.length) L.push(`- DQ kayıtları: ${dq.dq.map((d) => `${d.code}${d.ref ? `(${d.ref})` : ''}`).join(', ')}.`);
  L.push(`- Ek: ${dq.attachments.map((a) => `\`${a}\``).join(', ')} (her kalem: durum, uzlaştırma sınıfı, alt adımlar, kanıt, eksik kanıt).`, '');
  return L.join('\n') + '\n';
}
