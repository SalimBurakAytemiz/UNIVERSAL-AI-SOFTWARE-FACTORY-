//TR: Mühendislik verimliliği (bölüm F): 1s/24s/7g/başlangıçtan beri pencerelerinde açılan/merge edilen PR, açılış->merge saatleri (medyan, p90), ilk CI başarı oranı, yeniden çalıştırmalar, CI süreleri (TIMING veya APPROX etiketli), runner dakikaları (jobs API, yalnız 7g, tavanlı), kuyruk kaydı bloke süreleri (commit ayrıntısında 'koordinatör kaydı zamanı'), Founder karar yaşı ve merge reformu. Token/maliyet kaydı olmadığı için UNKNOWN.
import { windowStart, hoursBetween, round1, toMs, pct } from '../core/time.mjs';
import { cmp } from '../core/canonical-json.mjs';

export const quantile = (xs, q) => { const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; return s[Math.max(0, Math.ceil(q * s.length) - 1)]; };
const inWin = (iso, a, b) => { const t = toMs(iso); return Number.isFinite(t) && t >= toMs(a) && t <= toMs(b); };

export function computeProductivity({ pulls, runs, timings, jobs, runDetail, queueHistory, decisions, integrationBoard, nowIso, startIso, secondAnchor, config, statusMap }) {
  const v7 = [...pulls.values()].filter((p) => p.base === config.integrationBranch);
  const ci = runs.filter((r) => r.name === config.ciWorkflowName);
  const firstCi = new Map();
  for (const r of ci.filter((r) => r.event === 'pull_request' && r.status === 'completed' && r.runAttempt === 1).sort((a, b) => cmp(a.createdAt, b.createdAt) || a.id - b.id)) {
    const targets = r.prs.length ? r.prs : v7.filter((p) => p.headRef === r.headBranch).map((p) => p.number);
    for (const n of targets) if (!firstCi.has(n)) firstCi.set(n, r);
  }
  const blockedIntervals = (() => {
    const out = []; const open = new Map();
    for (const c of queueHistory) {
      if (!c.tasks) continue;
      const cur = new Map(c.tasks.map((t) => [t.id, t.status]));
      for (const [id, s] of cur) { const was = open.get(id); const isB = statusMap.queueBlockedStates.includes(s); if (isB && !was) open.set(id, { id, status: s, from: c.at }); if (!isB && was) { out.push({ ...was, to: c.at }); open.delete(id); } }
      for (const [id, was] of [...open]) if (!cur.has(id)) { out.push({ ...was, to: c.at }); open.delete(id); }
    }
    for (const was of open.values()) out.push({ ...was, to: null });
    return out.sort((a, b) => cmp(a.id, b.id) || cmp(a.from, b.from));
  })();
  const windows = config.productivityWindows.map((w) => {
    const ws = windowStart(nowIso, w, startIso);
    const opened = v7.filter((p) => inWin(p.createdAt, ws, nowIso));
    const merged = v7.filter((p) => p.mergedAt && inWin(p.mergedAt, ws, nowIso));
    const o2m = merged.map((p) => hoursBetween(p.createdAt, p.mergedAt));
    const fc = opened.map((p) => firstCi.get(p.number)).filter(Boolean);
    const ciW = ci.filter((r) => inWin(r.createdAt, ws, nowIso));
    const done = ciW.filter((r) => r.status === 'completed');
    const durs = done.map((r) => { const t = timings[r.id]; if (t) return { m: t.runDurationMs / 60000, method: 'TIMING' }; const a = hoursBetween(r.runStartedAt, r.updatedAt); return a === null ? null : { m: a * 60, method: 'APPROX' }; }).filter(Boolean);
    const withJobs = done.filter((r) => jobs[r.id]);
    const runnerMin = withJobs.reduce((s, r) => s + jobs[r.id].reduce((t, j) => t + Math.max(0, (hoursBetween(j.startedAt, j.completedAt) || 0) * 60), 0), 0);
    const blockedH = blockedIntervals.reduce((s, b) => { const a = Math.max(toMs(b.from), toMs(ws)); const e = Math.min(b.to ? toMs(b.to) : toMs(nowIso), toMs(nowIso)); return s + (e > a ? (e - a) / 3600e3 : 0); }, 0);
    return {
      window: w, from: ws, to: nowIso,
      prsOpened: opened.length, prsMerged: merged.length,
      openToMergeHours: { median: round1(quantile(o2m, 0.5)), p90: round1(quantile(o2m, 0.9)), n: o2m.length },
      firstCiSuccess: { success: fc.filter((r) => r.conclusion === 'success').length, of: fc.length, rate: pct(fc.filter((r) => r.conclusion === 'success').length, fc.length), prsWithoutFirstRun: opened.length - fc.length },
      reruns: { runsWithRerun: ciW.filter((r) => r.runAttempt > 1).length, ciRuns: ciW.length, ratio: pct(ciW.filter((r) => r.runAttempt > 1).length, ciW.length) },
      ciDurationMinutes: { median: round1(quantile(durs.map((d) => d.m), 0.5)), p90: round1(quantile(durs.map((d) => d.m), 0.9)), n: durs.length, methods: { TIMING: durs.filter((d) => d.method === 'TIMING').length, APPROX: durs.filter((d) => d.method === 'APPROX').length } },
      runnerMinutes: w === '7d' || w === '24h' || w === '1h' ? { value: withJobs.length === done.length ? round1(runnerMin) : (withJobs.length ? round1(runnerMin) : 'UNKNOWN'), coverage: `${withJobs.length}/${done.length}`, complete: withJobs.length === done.length, source: 'jobs API (7d window, capped)' } : { value: 'UNKNOWN', reason: 'jobs API fetched for the 7d window only' },
      queueBlockedHours: { value: round1(blockedH), label: 'coordinator-record time (PRODUCTION-QUEUE.json commit granularity)' },
    };
  });
  const openDec = decisions.filter((d) => d.state === 'OPEN' && d.ageHours !== null);
  const ver = integrationBoard.merges.filter((m) => /^VERIFIED/.test(m.postMerge));
  const atDiffs = integrationBoard.merges.filter((m) => m.at && pulls.get(m.pr)?.mergedAt).map((m) => Math.abs((toMs(m.at) - toMs(pulls.get(m.pr).mergedAt)) / 1000));
  return {
    sinceStart: { anchor: startIso, anchorSource: 'earliest created_at among PRs with base v7/integration', secondAnchor: secondAnchor || null, secondAnchorSource: 'PRODUCTION-QUEUE.json productionLanes.startedAt' },
    totals: { prs: [...pulls.values()].length, v7Prs: v7.length, merged: v7.filter((p) => p.mergedAt).length, open: v7.filter((p) => p.state === 'open').length, closedUnmerged: v7.filter((p) => p.state === 'closed' && !p.mergedAt).length },
    windows,
    runDetail,
    blockedIntervals: blockedIntervals.map((b) => ({ ...b, hours: round1(hoursBetween(b.from, b.to || nowIso)) })),
    founderDecisionAgeHours: { open: openDec.length, median: round1(quantile(openDec.map((d) => d.ageHours), 0.5)), max: round1(quantile(openDec.map((d) => d.ageHours), 1)) },
    mergeReform: { recordedMerges: integrationBoard.merges.length, postMergeVerified: ver.length, coordinatorAtVsGithubMergedAtSeconds: { min: atDiffs.length ? round1(Math.min(...atDiffs)) : null, max: atDiffs.length ? round1(Math.max(...atDiffs)) : null, n: atDiffs.length }, authority: 'GitHub merged_at' },
    tokensAndCost: { value: 'UNKNOWN', reason: 'no token or cost records exist in git or GitHub' },
  };
}
