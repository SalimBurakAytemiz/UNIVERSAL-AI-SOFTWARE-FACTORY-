//TR: UASCO Intel V1 komut satırı: daily | report | build | guard | diff | verify | restore | install-wrapper. Kenar -> saf çekirdek -> kenar: git/GitHub toplanır, saf model kurulur, çıktılar yazılır, (daily --publish ile) uasco/production-reports'a yalnız ileri sarma ile yayınlanır. Saat bir kez okunur (--now ile enjekte edilebilir). Çıkış kodları: 0 tamam/WAIT/SKIP, 1 INTEL FAIL, 3 guard ABSENT, 6 PUBLISH_RACE.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitTry, showText, fetchRefs } from './lib/git.mjs';
import { loadRules, engineIdentity, loadCache, gatherInputs, inputsFingerprint } from './lib/gather.mjs';
import { publishDaily, restoreLatest, PublishRace } from './lib/publish.mjs';
import { buildAll, compactMetrics } from './model/pipeline.mjs';
import { buildReport } from './render/report-json.mjs';
import { renderMarkdown, SECTION_HEADINGS } from './render/report-md.mjs';
import { inventoryJson, inventoryCsv, CSV_COLUMNS } from './render/inventory.mjs';
import { stableStringify, sha256, cmp } from './core/canonical-json.mjs';
import { trtDate, trtClock } from './core/time.mjs';
import { parseCsv } from './core/csv.mjs';
import { diffSnapshots } from './metrics/history.mjs';
import { RECON_CLASSES } from './model/status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = (() => { const a = process.argv.slice(2); const o = { _: [] }; for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; } else o._.push(a[i]); } return o; })();
const say = (s) => process.stdout.write(`${s}\n`);
const fail = (code, detail) => { say(`INTEL FAIL ${code}${detail ? ` ${detail}` : ''}`); process.exit(1); };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
export const OUT_FILES = { md: 'UASCO_REMAINING_WORK.md', json: 'UASCO_REMAINING_WORK.json', invJson: 'UASCO_WORK_INVENTORY.json', invCsv: 'UASCO_WORK_INVENTORY.csv' };

// ---- prior snapshots (archive/ and published daily dirs)
function parseV0Header(mdText, json) {
  const md = String(mdText || '');
  const stamp = /\*\*Oluşturulma:\*\* ([0-9-]+ [0-9:]+) TRT/.exec(md);
  const shas = /v7\/integration `([0-9a-f]{7,40})`, uasco\/production-queue `([0-9a-f]{7,40})`/.exec(md);
  return { mdStamp: stamp ? stamp[1].slice(0, 16) : null, mdBase: shas ? shas[1] : null, mdQueue: shas ? shas[2] : null,
    jsonStamp: json?.generatedAtTRT ? String(json.generatedAtTRT).slice(0, 16) : null, jsonBase: json?.inputs?.baseSha ? json.inputs.baseSha.slice(0, 7) : null, jsonQueue: json?.inputs?.queueSha ? json.inputs.queueSha.slice(0, 7) : null };
}
export function compactPrior(source, json, mdText, invJson, tz) {
  if (!json || !json.generatedAt) return null;
  const date = trtDate(json.generatedAt, tz);
  if (json.schemaVersion && json.trendPoint) {
    return { source, date, generatedAt: json.generatedAt, semantics: json.trendPoint.semantics || 'intel-1', trendPoint: json.trendPoint, metrics: json.snapshotMetrics || null,
      items: invJson ? invJson.items.map((x) => ({ id: x.id, status: x.status, reconClass: x.reconClass, scope: x.scope, department: x.department, substeps: x.substeps, links: x.links })) : null };
  }
  const t = json.totals?.allWorkDimensions || {};
  return { source, date, generatedAt: json.generatedAt, semantics: 'legacy-v0', legacyHeader: parseV0Header(mdText, json),
    trendPoint: { date, generatedAt: json.generatedAt, semantics: 'legacy-v0', liveNow: t.live ?? null, mvpN: t.mvpScope_AT_RISK ?? null, fullIntegrated: t.mergedNotVerified ?? null, mvpIntegrated: null, fullAccepted: t.verifiedCompleted ?? null, mvpAccepted: null, unreconciled: json.totals?.UNRECONCILED_WORK ?? null, unknown: t.byStatus?.UNKNOWN ?? null, mergesPerDay: json.mergesRecordedToday ?? null },
    metrics: { liveBaseline: t.live, mvp: t.mvpScope_AT_RISK, mergedNotVerified: t.mergedNotVerified, unknown: t.byStatus?.UNKNOWN, unreconciled: json.totals?.UNRECONCILED_WORK, stale: t.stale, accepted: t.verifiedCompleted, founder: t.byStatus?.FOUNDER_ACTION_REQUIRED, notStarted: t.byStatus?.NOT_STARTED },
    items: null };
}
function loadPriors(repo, outDir, reportsRef, dailyDir, tz) {
  const out = [];
  const arch = path.join(outDir, 'archive');
  if (fs.existsSync(arch)) for (const d of fs.readdirSync(arch).sort(cmp)) {
    const p = path.join(arch, d);
    const j = readJson(path.join(p, OUT_FILES.json)); if (!j) continue;
    let md = null; try { md = fs.readFileSync(path.join(p, OUT_FILES.md), 'utf8'); } catch { /* none */ }
    const c = compactPrior(`archive:${d}`, j, md, readJson(path.join(p, OUT_FILES.invJson)), tz); if (c) out.push(c);
  }
  const r = gitTry(repo, ['ls-tree', '--name-only', `${reportsRef}:${dailyDir}`]);
  if (r.ok) for (const d of r.out.split('\n').filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(cmp)) {
    const j = (() => { try { return JSON.parse(showText(repo, reportsRef, `${dailyDir}/${d}/${OUT_FILES.json}`)); } catch { return null; } })();
    const inv = (() => { try { return JSON.parse(showText(repo, reportsRef, `${dailyDir}/${d}/${OUT_FILES.invJson}`)); } catch { return null; } })();
    const c = compactPrior(`daily:${d}`, j, showText(repo, reportsRef, `${dailyDir}/${d}/${OUT_FILES.md}`), inv, tz); if (c) out.push(c);
  }
  return out;
}
function archivePrevious(outDir, nowIso) {
  const j = path.join(outDir, OUT_FILES.json);
  if (!fs.existsSync(j)) return null;
  const h = sha256(fs.readFileSync(j));
  const arch = path.join(outDir, 'archive');
  if (fs.existsSync(arch)) for (const d of fs.readdirSync(arch)) { try { if (sha256(fs.readFileSync(path.join(arch, d, OUT_FILES.json))) === h) return { dir: path.join(arch, d), existed: true }; } catch { /* next */ } }
  // Stamp = the archived report's own generatedAt (UTC), made unique; an existing archive dir is never overwritten.
  const gen = (() => { try { return new Date(JSON.parse(fs.readFileSync(j, 'utf8')).generatedAt).toISOString(); } catch { return nowIso; } })();
  const base = gen.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  let dir = path.join(arch, base);
  for (let k = 2; fs.existsSync(dir); k++) dir = path.join(arch, `${base}-${k}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of [OUT_FILES.json, OUT_FILES.md, OUT_FILES.invJson, OUT_FILES.invCsv, 'UASCO_DELTA.json', 'remaining-work.mjs']) { const s = path.join(outDir, f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, f)); }
  return { dir, existed: false };
}

// ---- invariants (verify)
export function verifyOutputs(report, inv, md, csvText) {
  const bad = [];
  const st = new Set(['COMPLETED_AND_VERIFIED', 'MERGED_NOT_VERIFIED', 'IMPLEMENTED_NOT_MERGED', 'FOUNDER_ACTION_REQUIRED', 'BLOCKED', 'IN_PROGRESS', 'QUEUED', 'NOT_STARTED', 'UNKNOWN', 'OBSOLETE']);
  const rc = new Set(RECON_CLASSES);
  for (const x of inv.items) {
    if (!st.has(x.status)) bad.push(`STATUS:${x.id}`);
    if (!rc.has(x.reconClass)) bad.push(`RECON_CLASS:${x.id}:${x.reconClass}`);
    const unk = x.status === 'UNKNOWN' || Object.values(x.substeps).includes('UNKNOWN');
    if (unk && x.status !== 'OBSOLETE' && !(x.missingEvidence && x.missingEvidence.length)) bad.push(`MISSING_EVIDENCE:${x.id}`);
  }
  const ids = inv.items.map((x) => x.id); if (new Set(ids).size !== ids.length) bad.push('DUPLICATE_ITEM_IDS');
  const rec = report.reconciliation;
  const sf = rec.baselinePartition.reduce((a, p) => a + p.full, 0), sm = rec.baselinePartition.reduce((a, p) => a + p.mvp, 0);
  if (sf !== rec.live741) bad.push(`PARTITION_FULL:${sf}!=${rec.live741}`);
  if (sm !== rec.mvp354) bad.push(`PARTITION_MVP:${sm}!=${rec.mvp354}`);
  const cf = rec.currentPartition.reduce((a, p) => a + p.full, 0), cm = rec.currentPartition.reduce((a, p) => a + p.mvp, 0);
  if (cf !== rec.live741 || cm !== rec.mvp354) bad.push(`RECON_PARTITION:${cf}/${cm}`);
  const tmf = Object.values(rec.transitionMatrix.full).reduce((a, o) => a + Object.values(o).reduce((x, n) => x + n, 0), 0), tmm = Object.values(rec.transitionMatrix.mvp).reduce((a, o) => a + Object.values(o).reduce((x, n) => x + n, 0), 0);
  if (tmf !== rec.live741 || tmm !== rec.mvp354) bad.push(`TRANSITION_MATRIX:${tmf}/${tmm}`);
  if (rec.r323.length !== rec.mergedNotVerifiedV0 || new Set(rec.r323.map((x) => x.id)).size !== rec.r323.length) bad.push(`R323:${rec.r323.length}`);
  const ov = rec.overlap; if (ov.a323only.full + ov.both.full + ov.a536only.full + ov.neither.full !== rec.live741) bad.push('OVERLAP_SUM');
  if (ov.a323only.full + ov.both.full !== rec.mergedNotVerifiedV0 || ov.both.full + ov.a536only.full !== rec.unreconciledV0) bad.push('OVERLAP_SETS');
  if (!report.dataQuality.departmentInvariant.ok) bad.push(`DEPARTMENTS:${report.dataQuality.departmentInvariant.violations.join(',')}`);
  const heads = md.split('\n').filter((l) => /^## [A-J]\. /.test(l));
  if (heads.join('\n') !== SECTION_HEADINGS.join('\n')) bad.push('MD_HEADINGS');
  if (!md.startsWith('<!-- //TR:')) bad.push('MD_TR_LINE');
  const rows = parseCsv(csvText); if (rows[0].join(',') !== CSV_COLUMNS.join(',') || rows.length - 1 !== inv.items.length) bad.push('CSV_SHAPE');
  return bad;
}

export function buildOutputs({ inputs, rules, overlay, meta, nowIso }) {
  const model = buildAll(inputs, rules, overlay, meta, nowIso);
  const cm = compactMetrics(model.metrics.baseline741, model.metrics.full, model.metrics.mvp);
  const report = buildReport(model, { ...meta, nowIso, compactMetrics: cm });
  const dq = [];
  let jsonText = stableStringify(report, dq);
  if (dq.length) { report.dataQuality.dq.push(...dq.map((d) => ({ code: 'NON_FINITE_NUMBER_NULLED', ref: d.path, detail: d.value }))); jsonText = stableStringify(report); }
  const md = renderMarkdown(JSON.parse(jsonText), { listCap: rules.config.mdListCap });
  const inv = inventoryJson(model, { inputsShort: { baseSha: inputs.meta.refs.v7.sha, queueSha: inputs.meta.refs.queue.sha, inventoryBlob: inputs.meta.inventoryBlob } });
  const invText = stableStringify(inv, dq);
  const csv = inventoryCsv(model);
  const delta = { '//TR': 'Önceki anlık görüntüye göre fark (history.diff kopyası).', generatedAt: nowIso, previous: report.history.previous, diff: report.history.diff };
  return { model, report, files: { [OUT_FILES.md]: md, [OUT_FILES.json]: jsonText, [OUT_FILES.invJson]: invText, [OUT_FILES.invCsv]: csv }, delta: stableStringify(delta), dq };
}
function writeOutputs(outDir, files, extra = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [n, c] of Object.entries({ ...files, ...extra })) { const p = path.join(outDir, n); fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.${process.pid}.tmp`; fs.writeFileSync(t, c); fs.renameSync(t, p); }
}
// Engine identity for meta/manifest: a dirty working copy is marked DIRTY with its changed files and a hash of the files that really ran.
export function engineMeta(id) {
  const dirtyFiles = id.dirty ? id.dirty.split('\n').map((l) => l.trim()).filter(Boolean).sort() : [];
  return { engineTree: id.engineTree, engineDirty: dirtyFiles.length > 0, engineDirtyFiles: dirtyFiles, engineWorkHash: dirtyFiles.length ? id.workHash : null,
    rulesBlobIds: id.rulesWorkingBlobIds || id.rulesBlobIds, overlayBlobId: id.overlayBlobId, wave0BlobId: id.wave0BlobId };
}
// Bounded local archive: per TRT date keep only the newest intel snapshot (legacy-v0 archives are never pruned) and at most archiveMaxDays dates.
export function pruneArchive(outDir, C) {
  const arch = path.join(outDir, 'archive');
  if (!fs.existsSync(arch)) return [];
  const rows = [];
  for (const d of fs.readdirSync(arch).sort(cmp)) {
    const j = readJson(path.join(arch, d, OUT_FILES.json));
    if (!j || !j.generatedAt) continue;
    rows.push({ d, legacy: !(j.schemaVersion && j.trendPoint), date: trtDate(j.generatedAt, C.tz), at: j.generatedAt });
  }
  const intel = rows.filter((r) => !r.legacy).sort((a, b) => cmp(b.at, a.at) || cmp(b.d, a.d));
  const keep = new Set(), dates = [];
  for (const r of intel) { if (dates.includes(r.date)) continue; if (dates.length >= (C.archiveMaxDays || 60)) continue; dates.push(r.date); keep.add(r.d); }
  const drop = intel.filter((r) => !keep.has(r.d)).map((r) => r.d);
  for (const d of drop) fs.rmSync(path.join(arch, d), { recursive: true, force: true });
  return drop;
}
function manifestOf({ date, nowIso, meta, inputs, fingerprint, files, reused, from }) {
  return { '//TR': 'Günlük çıktı manifestosu; en son yazılır, varlığı guard işaretidir.', date, now: nowIso, engineTree: meta.engineTree, engineDirty: !!meta.engineDirty, engineDirtyFiles: meta.engineDirtyFiles || [], engineWorkHash: meta.engineWorkHash || null, rulesBlobIds: meta.rulesBlobIds, overlayBlobId: meta.overlayBlobId, wave0BlobId: meta.wave0BlobId,
    inputs: { v7: inputs.meta.refs.v7.sha, queue: inputs.meta.refs.queue.sha, reports: inputs.meta.refs.reports.sha, inventoryBlob: inputs.meta.inventoryBlob, csvBlob: inputs.meta.csvBlob }, fingerprint,
    files: Object.fromEntries(Object.entries(files).sort((a, b) => cmp(a[0], b[0])).map(([n, c]) => [n, sha256(c)])), reused: !!reused, from: from || null };
}

async function cmdReport({ publish = false } = {}) {
  const repo = args.repo || '/home/user/UNIVERSAL-AI-SOFTWARE-FACTORY-';
  const outDir = args.out || path.join(repo, 'reports/local');
  const { rules, overlay } = loadRules(HERE);
  if (args.tz) rules.config.tz = args.tz;
  if (args['not-before']) rules.config.notBefore = args['not-before'];
  const C = rules.config;
  let refsFetch = { ran: false };
  if (publish || args.fetch) { const fr = fetchRefs(repo, Object.values(C.remoteBranches)); refsFetch = { ran: true, ok: fr.ok, error: fr.ok ? null : String(fr.err || '').trim().split('\n')[0] }; }
  const nowIso = args.now ? new Date(args.now).toISOString() : new Date().toISOString();
  const date = trtDate(nowIso, C.tz);
  if (publish) {
    if (trtClock(nowIso, C.tz) < C.notBefore && !args.force) { say(`INTEL WAIT ${trtClock(nowIso, C.tz)} TRT`); return 0; }
    const m = gitTry(repo, ['rev-parse', '--verify', '-q', `${C.refs.reports}:${C.dailyDir}/${date}/manifest.json`]);
    if (m.ok && !args.force) { const c = gitTry(repo, ['log', '-1', '--format=%h', C.refs.reports, '--', `${C.dailyDir}/${date}/manifest.json`]); say(`INTEL SKIP ${date} PRESENT ${c.out.trim()}`); return 0; }
  }
  const id = engineIdentity(HERE);
  if (publish && id.dirty) fail('DIRTY_ENGINE', id.dirty.split('\n')[0]);
  const meta = engineMeta(id);
  if (args.archive !== 'false') { const a = archivePrevious(outDir, nowIso); if (a && !a.existed) say(`INTEL ARCHIVE ${a.dir}`); const pr = pruneArchive(outDir, C); if (pr.length) say(`INTEL ARCHIVE PRUNED ${pr.length}`); }
  const priors = loadPriors(repo, outDir, C.refs.reports, C.dailyDir, C.tz);
  const { cache, from } = loadCache(outDir, repo, C.refs.reports, C.dailyDir);
  let inputs, cacheOut;
  try { ({ inputs, cache: cacheOut } = await gatherInputs({ repo, engineDir: HERE, outDir, nowIso, rules, overlay, tsx: args.tsx, cache, cacheFrom: from, priorSnapshots: priors, workDir: args['work-dir'], refsFetch, log: (s) => process.stderr.write(`${s}\n`) })); }
  catch (e) { fail('GATHER', String(e.message || e).slice(0, 200)); }
  inputs.overlayRefs = resolveOverlayRefs(repo, overlay);
  const fingerprint = inputsFingerprint(inputs, meta, { nowIso, tz: C.tz });
  const prevJson = readJson(path.join(outDir, OUT_FILES.json));
  meta.fingerprint = fingerprint; meta.reused = !!(prevJson && prevJson.fingerprint === fingerprint);
  const out = await buildOutputs({ inputs, rules, overlay, meta, nowIso });
  const bad = verifyOutputs(out.report, JSON.parse(out.files[OUT_FILES.invJson]), out.files[OUT_FILES.md], out.files[OUT_FILES.invCsv]);
  if (bad.length) fail('INVARIANT', bad.slice(0, 8).join(';'));
  const cacheText = stableStringify({ '//TR': 'Intel V1 artımlı önbellek: ETag, imleç, PR/run/check tabloları, pickaxe ve hazırlık özeti.', ...cacheOut });
  const manifest = manifestOf({ date, nowIso, meta, inputs, fingerprint, files: { ...out.files, 'cache.json': cacheText }, reused: meta.reused, from: meta.reused ? prevJson.generatedAt : null });
  writeOutputs(outDir, out.files, { 'UASCO_DELTA.json': out.delta, '.intel-cache/cache.json': cacheText, '.intel-cache/manifest.json': stableStringify(manifest) });
  if (args['dump-inputs']) fs.writeFileSync(args['dump-inputs'], JSON.stringify({ inputs, meta, nowIso }));
  const R = out.report;
  const head = `fp=${fingerprint.slice(0, 12)} calls=${inputs.github.calls} reused=${meta.reused} github=${inputs.github.freshness.state}`;
  if (!publish) { say(`INTEL REPORT ${date} ${head} live=${R.metrics.full.n} baseline=${R.metrics.baseline741.n} mvp=${R.metrics.mvp.n} integrated=${R.metrics.baseline741.substeps.integrated.TRUE} unknown=${R.metrics.baseline741.statusCounts.UNKNOWN} accepted=${R.metrics.full.substeps.accepted.TRUE}`); return 0; }
  const files = [...C.publishPaths.filter((n) => n !== 'manifest.json').map((n) => ({ name: n, content: n === 'cache.json' ? cacheText : out.files[n] })), { name: 'manifest.json', content: stableStringify(manifest) }];
  const dir = fs.existsSync(path.join(outDir, '.intel-cache')) && args.force && gitTry(repo, ['rev-parse', '--verify', '-q', `${C.refs.reports}:${C.dailyDir}/${date}/manifest.json`]).ok ? `${date}/r2` : date;
  try {
    const res = publishDaily({ repo, branch: C.remoteBranches.reports, dailyDir: C.dailyDir, date: dir, files, msg: `report: UASCO daily intel ${date} (TRT) [skip ci]` });
    if (res.skipped) { say(`INTEL SKIP ${date} PRESENT ${String(res.existing || '').slice(0, 7)}`); return 0; }
    say(`INTEL DONE ${date} ${res.commit.slice(0, 7)} ${head}`); return 0;
  } catch (e) { if (e instanceof PublishRace) { say('INTEL FAIL PUBLISH_RACE'); return 6; } fail('PUBLISH', String(e.message || e).slice(0, 200)); }
  return 0;
}
function resolveOverlayRefs(repo, overlay) {
  const out = {};
  for (const e of overlay.entries || []) if (e.evidenceRef) {
    const t = gitTry(repo, ['cat-file', '-t', e.evidenceRef]);
    const body = t.ok && t.out.trim() === 'blob' ? gitTry(repo, ['cat-file', 'blob', e.evidenceRef]).out : '';
    out[e.evidenceRef] = { exists: t.ok, type: t.ok ? t.out.trim() : null, fake: /FAKE executor|FakeExecutors|"executor"\s*:\s*"FAKE"/.test(body) };
  }
  return out;
}

async function cmdBuild() {
  const bundle = readJson(args.fixtures || args.inputs);
  if (!bundle) fail('BAD_FIXTURES', String(args.fixtures || args.inputs));
  const { rules, overlay } = loadRules(HERE);
  const nowIso = new Date(args.now || bundle.nowIso).toISOString();
  const meta = { ...bundle.meta };
  const inputs = bundle.inputs;
  meta.fingerprint = meta.fingerprint || inputsFingerprint(inputs, meta, { nowIso, tz: rules.config.tz });
  const out = await buildOutputs({ inputs, rules, overlay: bundle.overlay || overlay, meta, nowIso });
  const bad = verifyOutputs(out.report, JSON.parse(out.files[OUT_FILES.invJson]), out.files[OUT_FILES.md], out.files[OUT_FILES.invCsv]);
  if (bad.length) fail('INVARIANT', bad.slice(0, 8).join(';'));
  writeOutputs(args.out, out.files, { 'UASCO_DELTA.json': out.delta });
  say(`INTEL BUILD ${trtDate(nowIso)} fp=${String(meta.fingerprint).slice(0, 12)} items=${out.model.items.length}`);
  return 0;
}
function cmdVerify() {
  const d = args._[1] || args.out;
  const r = readJson(path.join(d, OUT_FILES.json)), inv = readJson(path.join(d, OUT_FILES.invJson));
  const md = fs.readFileSync(path.join(d, OUT_FILES.md), 'utf8'), csv = fs.readFileSync(path.join(d, OUT_FILES.invCsv), 'utf8');
  const bad = verifyOutputs(r, inv, md, csv);
  say(bad.length ? `INTEL VERIFY FAIL ${bad.join(';')}` : `INTEL VERIFY OK items=${inv.items.length}`);
  return bad.length ? 1 : 0;
}
function cmdGuard() {
  const repo = args.repo || '/home/user/UNIVERSAL-AI-SOFTWARE-FACTORY-';
  const { rules } = loadRules(HERE);
  const date = args.date || trtDate(new Date(args.now || Date.now()).toISOString(), rules.config.tz);
  const ok = gitTry(repo, ['rev-parse', '--verify', '-q', `${rules.config.refs.reports}:${rules.config.dailyDir}/${date}/manifest.json`]).ok;
  say(`INTEL GUARD ${date} ${ok ? 'PRESENT' : 'ABSENT'}`);
  return ok ? 0 : 3;
}
function cmdDiff() {
  const a = readJson(args._[1]), b = readJson(args._[2]);
  const comp = (j) => ({ items: (j.items || []).map((x) => ({ id: x.id, status: x.status, reconClass: x.reconClass, scope: x.scope, department: x.department, substeps: x.substeps, links: x.links })), metrics: j.snapshotMetrics || {} });
  say(JSON.stringify(diffSnapshots(comp(a), comp(b)), null, 2));
  return 0;
}
function cmdRestore() {
  const repo = args.repo || '/home/user/UNIVERSAL-AI-SOFTWARE-FACTORY-';
  const { rules } = loadRules(HERE);
  const r = restoreLatest({ repo, ref: rules.config.refs.reports, dailyDir: rules.config.dailyDir, outDir: args.out || path.join(repo, 'reports/local') });
  say(r ? `INTEL RESTORE ${r.date} ${r.restored.join(',')}` : 'INTEL RESTORE NONE');
  return r ? 0 : 3;
}
function cmdInstallWrapper() {
  const out = args.out || '/home/user/UNIVERSAL-AI-SOFTWARE-FACTORY-/reports/local';
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'remaining-work.wrapper.mjs'), path.join(out, 'remaining-work.mjs'));
  say(`INTEL WRAPPER ${path.join(out, 'remaining-work.mjs')}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = args._[0];
  const run = { daily: () => cmdReport({ publish: !!args.publish }), report: () => cmdReport({ publish: false }), build: cmdBuild, guard: cmdGuard, diff: cmdDiff, verify: cmdVerify, restore: cmdRestore, 'install-wrapper': cmdInstallWrapper }[cmd];
  if (!run) { say('usage: intel.mjs daily|report|build|guard|diff|verify|restore|install-wrapper [--repo R] [--out D] [--now ISO] [--force] [--publish]'); process.exit(1); }
  Promise.resolve(run()).then((code) => process.exit(code || 0)).catch((e) => { say(`INTEL FAIL BUILD ${String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)}`); process.exit(1); });
}
