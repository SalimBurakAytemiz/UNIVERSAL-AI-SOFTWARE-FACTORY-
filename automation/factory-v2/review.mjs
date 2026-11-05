// //TR: Factory V2 risk-farkındalıklı review dağıtıcısı ve verdict bütünlüğü: düşük risk tek bağımsız reviewer, güvenlik/çapraz-sistem riski ilgili odak reviewer'larını ekler; verdict yalnız tam base+head SHA'ya bağlıysa, reviewer kimliği Builder'dan farklıysa, önceki blocker'lar açıkça çözülmüşse ve durum gerçek bir CLEAN ise birleştirmeye yetki verir. Auth/rate-limit/model hatası asla CLEAN'e dönüşmez.
const SHA = /^[0-9a-f]{40}$/;
export const FAILURE_VERDICTS = Object.freeze(["REVIEWER_AUTH_REJECTED", "RATE_LIMITED", "MODEL_UNAVAILABLE", "TIMEOUT", "ERROR", "INCOMPLETE"]);

/** Risk class from changed paths and task metadata (deterministic). */
export function riskOf({paths = [], tier = "T1", domain = null} = {}) {
  const p = paths.join(" ").toLowerCase();
  const security = domain === "SECURITY" || /auth|secret|sandbox|redact|token|credential|policy|permission|trust/.test(p)
    || paths.some(x => /^(config|prompts|\.github|automation\/lib|governance|docs\/planning\/(autonomy|authority))\//.test(String(x))); // trust-root areas are always security review
  const crossSystem = /orchestr|lease|scheduler|merge|supervisor|journal|runner|concurren|worker/.test(p) || domain === "CLOUD_EXECUTION";
  const high = tier === "T2" || security || crossSystem;
  return {level: high ? "HIGH" : tier === "T0" ? "LOW" : "MEDIUM", security, crossSystem};
}

/**
 * Required reviewer focuses. Always >=1 independent reviewer (governance: the governed CLAUDE_REVIEWER);
 * HIGH risk requires >=2 independent reviewers (dual review) with the matching focuses.
 */
export function requiredFocuses(risk) {
  const f = new Set(["ARCHITECTURE_CORRECTNESS"]);
  if (risk.level !== "LOW") f.add("QUALITY_ACCEPTANCE");
  if (risk.security) f.add("SECURITY_ISOLATION");
  if (risk.crossSystem) f.add("ADVERSARIAL_CROSS_SYSTEM");
  return [...f];
}

/** Pick idle reviewer slots for the required focuses; reviewers whose identity equals the builder's are never eligible. */
export function allocateReviewers(required, idleReviewers, builderIdentity) {
  const picks = [], free = idleReviewers.filter(r => r.identity !== builderIdentity && r.id !== builderIdentity);
  // Specialist first; otherwise any idle independent reviewer takes the focus (specialisation is a preference, independence is not).
  const order = [...required].sort((a, b) => free.filter(r => r.focus === a).length - free.filter(r => r.focus === b).length);
  for (const [k, focus] of order.entries()) {
    let i = free.findIndex(r => r.focus === focus);
    if (i < 0) { const later = order.slice(k + 1); i = free.findIndex(r => !later.includes(r.focus)); if (i < 0 && free.length) i = 0; }
    if (i < 0) return {complete: false, picks, missing: required.filter(x => !picks.some(p => p.focus === x))};
    picks.push({...free.splice(i, 1)[0], focus, specialist: false});
  }
  for (const p of picks) p.specialist = idleReviewers.find(r => r.id === p.id)?.focus === p.focus;
  return {complete: true, picks, missing: []};
}

/**
 * Does the set of verdicts authorize merging exactly (baseSha, headSha)?
 * verdict: {reviewerId, reviewerIdentity, focus, status: CLEAN|CHANGES_REQUESTED|<failure>, baseSha, headSha, blockers:[{id}], resolves:[id]}
 */
export function reviewAuthorizes({verdicts = [], required = [], baseSha, headSha, builderIdentity, priorBlockers = []}) {
  const reasons = [];
  if (!SHA.test(baseSha ?? "") || !SHA.test(headSha ?? "")) reasons.push("SHA_UNBOUND");
  if (!Array.isArray(required) || required.length === 0) reasons.push("REVIEW_REQUIREMENTS_MISSING"); // no requirement is never "nothing to check"
  const current = verdicts.filter(v => v.headSha === headSha && v.baseSha === baseSha);
  if (verdicts.some(v => v.headSha !== headSha)) reasons.push(...(current.length ? [] : ["STALE_REVIEW"]));
  for (const v of current) {
    if (v.reviewerIdentity === builderIdentity || v.reviewerId === builderIdentity) reasons.push(`SELF_REVIEW:${v.reviewerId}`);
    if (FAILURE_VERDICTS.includes(v.status)) reasons.push(`REVIEW_FAILED:${v.status}`);
    else if (v.status !== "CLEAN") reasons.push(`NOT_CLEAN:${v.reviewerId}:${v.status}`);
    if ((v.blockers ?? []).length) reasons.push(`OPEN_BLOCKERS:${v.reviewerId}`);
  }
  const clean = current.filter(v => v.status === "CLEAN" && !(v.blockers ?? []).length && v.reviewerIdentity !== builderIdentity && v.reviewerId !== builderIdentity);
  if (!clean.length) reasons.push("NO_CLEAN_REVIEW_AT_HEAD");
  for (const f of required ?? []) if (!clean.some(v => v.focus === f)) reasons.push(`MISSING_FOCUS:${f}`);
  const distinct = new Set(clean.map(v => v.reviewerIdentity));
  if (required.length >= 2 && distinct.size < 2) reasons.push("DUAL_REVIEW_NOT_INDEPENDENT");
  const resolved = new Set(clean.flatMap(v => v.resolves ?? []));
  for (const b of priorBlockers) if (!resolved.has(b.id)) reasons.push(`UNRESOLVED_PRIOR_BLOCKER:${b.id}`);
  return {authorized: reasons.length === 0, reasons: [...new Set(reasons)]};
}
