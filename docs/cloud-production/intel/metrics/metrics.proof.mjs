//TR: P6 metrik ayrımı kanıtı (ağsız): acceptedRatio merge'leri yok sayar; runtime oranı NOT_MEASURED'dır (%0 değil); PARTIAL entegre sayılmaz; medyan çift n'de iki ortanın ortalamasıdır; devProgress yalnız coded/integrated/tested kullanır; UNIT ağırlık modelinde eşit ağırlık notu vardır; bilinmeyen weightModel eşit ağırlığa kapalı düşer ve DQ üretir; ölçülmemiş hazırlık katmanı 0 olarak gösterilmez; ETA yalnız ölçülmüş hızdan.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { block, resolveWeights, etaFrom, ratios3 } from './metrics.mjs';
import { median, quantile } from './productivity.mjs';
import { computeAgentFactory } from './agent-factory.mjs';
import { loadRules } from '../lib/gather.mjs';
import { miniBundle } from '../fixtures/mini/bundle.mjs';
import { buildAll } from '../model/pipeline.mjs';
import { buildReport } from '../render/report-json.mjs';
import { renderMarkdown } from '../render/report-md.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}`); } };
const { rules } = loadRules(path.join(HERE, '..'));
const sub = (c, i, t, a = 'FALSE') => ({ coded: c, integrated: i, tested: t, runtimeVerified: 'FALSE', accepted: a });
const W = resolveWeights('UNIT_WEIGHT_UNTIL_RUNTIME_DURATION_DATA_EXISTS', rules.weights);
const xs = [
  { status: 'MERGED_NOT_VERIFIED', substeps: sub('TRUE', 'TRUE', 'TRUE'), stale: false },
  { status: 'MERGED_NOT_VERIFIED', substeps: sub('TRUE', 'TRUE', 'UNKNOWN'), stale: false },
  { status: 'UNKNOWN', substeps: sub('UNKNOWN', 'UNKNOWN', 'UNKNOWN'), stale: true },
  { status: 'NOT_STARTED', substeps: sub('FALSE', 'FALSE', 'FALSE'), stale: true },
];
const bl = block(xs, W);
check('acceptedRatio ignores merges (2 merged, 0 accepted -> 0)', bl.ratios.acceptedRatio.n === 0 && bl.ratios.integratedRatio.n === 2);
check('devProgress lower bound uses coded+integrated+tested only, UNKNOWN=0: (3+2)/3/4 = 41.7%', bl.devProgressLowerBound === 41.7);
check('devProgress unknown share: (1+3)/3/4 = 33.3%', bl.devProgressUnknownShare === 33.3);
check('testedUnknown is reported separately from testedRatio', bl.ratios.testedRatio.n === 1 && bl.ratios.testedUnknown === 2);
const acc = [...xs, { status: 'COMPLETED_AND_VERIFIED', substeps: sub('FALSE', 'FALSE', 'FALSE', 'TRUE'), stale: false }];
const b2 = block(acc, W);
check('accepted completion counts only accepted (not coded/integrated)', b2.ratios.acceptedRatio.n === 1 && b2.devProgressLowerBound === block(xs.concat([{ status: 'X', substeps: sub('FALSE', 'FALSE', 'FALSE'), stale: false }]), W).devProgressLowerBound);
check('UNIT weight model carries the equal-weight limitation note', /every item and every substep weighs 1/.test(W.note) && W.dq === null);
const W2 = resolveWeights('DURATION_WEIGHTED_V9', rules.weights);
check('unknown weightModel fails closed to equal weights with a DQ warning', W2.model === 'UNIT_WEIGHT_UNTIL_RUNTIME_DURATION_DATA_EXISTS' && W2.dq && W2.dq.code === 'UNKNOWN_WEIGHT_MODEL');
const r3 = ratios3(bl, bl);
check('three ratios are separate; runtime is NOT_MEASURED (never a measured 0), acceptance is a measured count with its source', r3.codeIntegrationRatio.measured === true && r3.runtimeVerificationRatio.measured === false && r3.runtimeVerificationRatio.state === 'NOT_MEASURED' && !!r3.runtimeVerificationRatio.reason && r3.acceptedCompletionRatio.measured === true && !!r3.acceptedCompletionRatio.source);
check('LOW runtime ratio is NOT_MEASURED, not 0 % (fails on 4fe58dd: {n:0,pct:0})', bl.ratios.runtimeVerifiedRatio.n === 'NOT_MEASURED' && bl.ratios.runtimeVerifiedRatio.pct === 'NOT_MEASURED' && r3.runtimeVerificationRatio.full.pct === 'NOT_MEASURED');
// PARTIAL integration is a separate bucket: not TRUE, counted in the UNKNOWN share of dev progress
const bp = block([...xs, { status: 'UNKNOWN', substeps: sub('TRUE', 'PARTIAL', 'UNKNOWN'), stale: false }], W);
check('H1 PARTIAL integration is tallied separately and never counted as integrated', bp.substeps.integrated.PARTIAL === 1 && bp.ratios.integratedRatio.n === 2 && bp.ratios.integratedPartial === 1);
check('H1 PARTIAL counts in the dev-progress UNKNOWN share, not in the lower bound: lower (3+2+1)/3/5 = 40 %, unknown (1+3+2)/3/5 = 40 %', bp.devProgressLowerBound === 40 && bp.devProgressUnknownShare === 40);
// conventional median (fails on 4fe58dd: lower-middle element)
check('LOW median of an even sample is the mean of the two middle values (1.585, 1.726 -> 1.6555)', Math.abs(median([1.726, 0.5, 1.585, 9]) - 1.6555) < 1e-9 && median([3, 1, 2]) === 2 && median([]) === null && quantile([1, 2, 3, 4], 0.9) === 4);
// agent factory: unmeasured layers are never shown as 0
const reg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'fixtures', 'registries-mini', 'registries.json'), 'utf8'));
const afU = computeAgentFactory({ registries: reg, readiness: { state: 'UNAVAILABLE', reason: 'READINESS_RUNTIME_UNAVAILABLE' }, wave0: { packages: [] }, rules: rules['agent-factory'], resolvers: [], itemsById: new Map() });
check('readiness unavailable: every layer TRUE is UNKNOWN, never 0', afU.layers.every((l) => l.TRUE === 'UNKNOWN' && l.measured === false));
const sample = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'fixtures', 'readiness-sample.json'), 'utf8'));
const afM = computeAgentFactory({ registries: reg, readiness: sample, wave0: { packages: [] }, rules: rules['agent-factory'], resolvers: [], itemsById: new Map() });
check('readiness measured: DEFINED 599/599 TRUE, RUNNING measured:false', afM.layers.find((l) => l.layer === 'DEFINED').TRUE === 599 && afM.layers.find((l) => l.layer === 'RUNNING').measured === false);
check("Founder column 'tested' is UNKNOWN (no C-RDY-1 layer)", afM.founderColumns.find((c) => c.column === 'tested').value === 'UNKNOWN');
check('registry claims are kept in a separate labelled block', afM.registryClaims.label === 'registry claim, not evidence');
// rendered: an unmeasured layer is not printed as 0
const b = miniBundle(); b.inputs.readiness = sample;
const m = buildAll(b.inputs, rules, b.overlay, b.meta, b.nowIso);
const md = renderMarkdown(JSON.parse(JSON.stringify(buildReport(m, { ...b.meta, nowIso: b.nowIso, compactMetrics: {} }))));
const runRow = md.split('\n').find((l) => l.startsWith('| RUNNING |'));
check('MD: RUNNING row shows UNKNOWN in the TRUE column, not 0', !!runRow && runRow.split('|')[2].trim() === 'UNKNOWN');
const toolRow = md.split('\n').find((l) => l.startsWith('| TOOL_READY |'));
check('MD: TOOL_READY (measured:false) is not rendered as 0', !!toolRow && toolRow.split('|')[2].trim() === 'UNKNOWN');
// ETA from measured velocity only
const pts = (vals) => vals.map((v, i) => ({ date: `2026-10-${String(20 + i).padStart(2, '0')}`, semantics: 'intel-1', mvpAccepted: v }));
check('ETA_UNKNOWN with fewer than 3 snapshots', etaFrom(pts([0, 1]), 'mvpAccepted', 10, '2026-10-27T00:00:00Z', 3, 3, 'x').reason === 'INSUFFICIENT_HISTORY');
check('ETA_UNKNOWN with zero velocity', etaFrom(pts([0, 0, 0, 0]), 'mvpAccepted', 10, '2026-10-27T00:00:00Z', 3, 3, 'x').reason === 'ZERO_OR_NEGATIVE_VELOCITY');
const e = etaFrom(pts([0, 1, 2, 3]), 'mvpAccepted', 10, '2026-10-24T00:00:00Z', 3, 3, 'x');
check('ETA measured from velocity 1/day: remaining 10 -> +10 days', e.state === 'MEASURED' && e.eta === '2026-11-03');
check('legacy-v0 points never feed velocity', etaFrom(pts([0, 1, 2, 3]).map((p) => ({ ...p, semantics: 'legacy-v0' })), 'mvpAccepted', 10, '2026-10-24T00:00:00Z', 3, 3, 'x').state === 'ETA_UNKNOWN');
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
