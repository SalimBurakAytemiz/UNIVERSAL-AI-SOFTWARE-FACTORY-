//TR: 149 roadmap fazını DAG, sözleşmeler, build wave, kritik yol, paralel lane, review paketi ve ROADMAP.md dönemleriyle birleştirir. Sözleşme state alanı (PLANNED) KAYITTIR, ilerleme değildir. Planlanan tarih alanı yoksa null kalır ve kontrol edilen kaynak kümesi kaydedilir; hiçbir tarih enterpolasyonla üretilmez.
import { cmp } from '../core/canonical-json.mjs';

export const phaseId = (n) => `PH-${String(n).padStart(3, '0')}`;
export function loadRoadmap(r, sourcesRules) {
  const nodes = new Map((r.graph?.nodes || []).map((n) => [n.phase, n]));
  const contracts = new Map((r.contracts || []).map((c) => [c.phase, c]));
  const waveOf = new Map(); for (const w of r.waves?.waves || []) for (const p of w.phaseIds || []) waveOf.set(p, w.id);
  const laneOf = new Map(); for (const l of r.lanes?.lanes || []) for (const p of l.phaseIds || []) laneOf.set(p, l.id);
  const pkgOf = new Map(); for (const k of r.packages?.packages || []) for (const p of k.phaseIds || []) pkgOf.set(p, k.id);
  const periodOf = new Map(); for (const pd of r.periods || []) for (const p of pd.phases) periodOf.set(p, pd.period);
  const cp = new Set(r.criticalPath?.phaseIds || []);
  const attested = new Set((r.attestations || []).map((p) => { const m = /phase-(\d{3})-review-attestation\.json$/.exec(p); return m ? Number(m[1]) : null; }).filter((x) => x !== null));
  const nums = [...new Set([...nodes.keys(), ...contracts.keys()])].sort((a, b) => a - b);
  const phases = nums.map((n) => {
    const nd = nodes.get(n) || {}, c = contracts.get(n) || {};
    return {
      phase: n, id: phaseId(n), title: c.title ?? nd.title ?? null, period: periodOf.get(n) ?? null, domain: c.domain ?? null, wave: waveOf.get(n) ?? null, lane: laneOf.get(n) ?? null,
      package: pkgOf.get(n) ?? null, criticalPath: cp.has(n), priority: nd.priority ?? null, dependsOn: (nd.dependsOn || c.dependsOn || []).slice().sort((a, b) => a - b),
      riskLevel: c.riskLevel ?? null, reviewProfile: c.reviewProfile ?? null, exitToken: `PHASE_${String(n).padStart(3, '0')}_VERIFIED`, contractState: c.state ?? null,
      closedByEvidence: attested.has(n), codexReview: (c.review || []).some((x) => /codex/i.test(x)),
    };
  });
  const waves = (r.waves?.waves || []).map((w) => ({ id: w.id, phaseIds: (w.phaseIds || []).slice() }));
  const packages = (r.packages?.packages || []).map((k) => ({ id: k.id, title: k.title, phaseIds: k.phaseIds || [], state: k.state ?? null, dependsOnPackages: k.dependsOnPackages || [] }));
  const periods = (r.periods || []).map((p) => ({ period: p.period, title: p.title, phases: p.phases.slice() }));
  const edges = phases.reduce((s, p) => s + p.dependsOn.length, 0);
  return {
    phases, waves, packages, periods, edges,
    criticalPath: { phaseIds: (r.criticalPath?.phaseIds || []).slice(), weightModel: r.criticalPath?.weightModel ?? null, length: r.criticalPath?.length ?? null },
    datesChecked: { sourceSet: sourcesRules.datesSourceSet.id, fieldsFound: (r.dateFieldsFound || []).slice().sort(cmp), schedulerUpdatedAt: r.schedulerTemplate?.updatedAt ?? null },
    residue: { roadmapMd363Agent: r.residue?.roadmapMd363 ?? 0, roadmapMd40Departments: r.residue?.roadmapMd40Dept ?? 0, contractsCodexReview: phases.filter((p) => p.codexReview).length,
      legacyTitles: phases.filter((p) => /363|40 departments/.test(p.title || '')).map((p) => `${p.id}: ${p.title}`) },
  };
}
