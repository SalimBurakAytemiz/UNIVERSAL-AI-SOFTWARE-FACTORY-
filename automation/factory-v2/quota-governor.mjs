// //TR: Factory V2 kota yöneticisi ve geri basınç: haftalık kota, oturum/sağlayıcı limiti, sıfırlama zamanı ve CI/review/merge kuyruklarına göre etkin Builder sayısını histerezisle belirler; kota bittiğinde yeni Claude çağrısı başlatmaz (deterministik iş ve mevcut CI sürer), sıfırlamaya yakın yalnız bitirilebilir/checkpoint'lenebilir işleri seçer. Limitleri aşmaz, ödeme yapmaz.
export const MODES = Object.freeze(["NORMAL", "HIGH", "SESSION_LIMITED", "EXHAUSTED", "RECOVERING"]);

/**
 * Quota mode from observed telemetry. usage: {weeklyUsedPct|null, sessionLimited, retryAfterMs, resetAt(ms)|null, providerHealthy}
 * Unknown telemetry is reported as ESTIMATED, never as observed.
 */
export function quotaMode(u, now = Date.now()) {
  if (u?.sessionLimited && (u.retryAfterMs ?? 0) > 0) return {mode: "SESSION_LIMITED", resumeAt: now + u.retryAfterMs};
  if (u?.weeklyUsedPct != null && u.weeklyUsedPct >= 100) return {mode: "EXHAUSTED", resumeAt: u.resetAt ?? null};
  if (u?.providerHealthy === false) return {mode: "RECOVERING", resumeAt: now + (u.retryAfterMs ?? 60_000)};
  if (u?.weeklyUsedPct != null && u.weeklyUsedPct >= 90) return {mode: "HIGH", resumeAt: null};
  return {mode: "NORMAL", resumeAt: null};
}

/**
 * Builder concurrency decision with backpressure and hysteresis.
 * s: {target, current, readyBacklog, reviewQueue, ciQueue, mergeQueue, reviewerSlots, quota:{mode}, hoursToReset}
 * Rules: never above target or readyBacklog; queue saturation lowers by one step per decision (scale down fast only on EXHAUSTED);
 * scale up one step only when all queues are below the low watermark (prevents flapping).
 */
export function decideBuilders(s, cfg = {}) {
  const hi = cfg.highWatermark ?? 2, lo = cfg.lowWatermark ?? 1; // per reviewer slot
  const q = s.quota?.mode ?? "NORMAL";
  const reasons = [];
  if (q === "EXHAUSTED" || q === "SESSION_LIMITED") return {builders: 0, redirect: [], reasons: [`QUOTA_${q}`], modelCallsAllowed: false};
  let n = s.current ?? s.target;
  const perRev = (s.reviewQueue ?? 0) / Math.max(1, s.reviewerSlots ?? 4);
  const ciSat = (s.ciQueue ?? 0) >= (cfg.ciHigh ?? 2 * (s.target ?? 8));
  const mergeSat = (s.mergeQueue ?? 0) >= (cfg.mergeHigh ?? 6);
  const saturated = perRev >= hi || ciSat || mergeSat;
  const calm = perRev < lo && !((s.ciQueue ?? 0) >= (cfg.ciLow ?? s.target ?? 8)) && (s.mergeQueue ?? 0) < (cfg.mergeLow ?? 3);
  const redirect = [];
  if (saturated) { n = Math.max(cfg.minBuilders ?? 1, n - 1); reasons.push("BACKPRESSURE"); if (perRev >= hi) redirect.push("REVIEW_REMEDIATION"); if (mergeSat) redirect.push("INTEGRATION"); if (ciSat) redirect.push("CI_TRIAGE"); }
  else if (calm && n < s.target) { n += 1; reasons.push("SCALE_UP_STEP"); }
  if (q === "HIGH" || q === "RECOVERING") { n = Math.min(n, Math.ceil(s.target / 2)); reasons.push(`QUOTA_${q}`); }
  n = Math.min(n, s.target, Math.max(0, s.readyBacklog ?? s.target));
  if ((s.readyBacklog ?? 1) < (s.target ?? 8)) reasons.push("BACKLOG_LIMITED");
  return {builders: n, redirect, reasons, modelCallsAllowed: true, preferCompletable: (s.hoursToReset ?? 99) < (cfg.nearResetHours ?? 6)};
}

/** Near reset: only tasks whose estimate fits the remaining window (or that checkpoint cleanly) are started. */
export function pickForWindow(tasks, hoursToReset) {
  return tasks.filter(t => (t.estimateHours ?? 1) <= hoursToReset || t.checkpointable === true);
}
