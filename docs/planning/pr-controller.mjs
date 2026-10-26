// //TR: Bu modül tek bir PR için koordinatörün sıradaki eylemlerini hesaplayan saf ve deterministik denetleyicidir (COORD-TRANSITION-AUTONOMY): draft'ı hazıra alma, çatışma/CI/inceleme sorununu PR'ın kendi hattına geri verme, base değişince yalnız etkilenen PR'ı güncelleme, bağımsız doğrulamayı isteme veya yeniden isteme, reviewer kimlik hatasında engelleme (asla CLEAN değil), FOUNDER sınıfında Founder'a bırakma ve yalnız her koşul bu head+base'e bağlı olarak sağlandığında auto-merge'ü açma. GitHub yalnız iki validate kontrolünü zorladığı için uygun olmayan PR'da açık auto-merge kapatılır. Bir PR'ın hatası başka bir PR için asla eylem üretmez. Çıktı yalnız sabit kodlardır.
// Pure: no I/O, no network, no clock. The caller executes the actions in order and stops at the first one that does not succeed.
import {normPath, isHighRisk, pathMatcher} from "./merge-risk.mjs";

export const ACTIONS = Object.freeze(["DISABLE_AUTO_MERGE", "UPDATE_BRANCH", "RESOLVE_CONFLICT", "FIX_CI", "WAIT_CI", "REQUEST_INDEPENDENT_VERIFICATION", "REVERIFY", "REMEDIATE_REVIEW",
  "BLOCK_REVIEW_AUTH", "MARK_READY", "ENABLE_AUTO_MERGE", "FOUNDER_REQUIRED", "POST_MERGE_VERIFY", "NEXT_TASK", "NOOP"]);
export const REASONS = Object.freeze(["STATE_MALFORMED", "INTERNAL_ERROR", "AUTO_MERGE_NOT_ELIGIBLE", "MERGE_CONFLICT", "BRANCH_BEHIND", "BASE_CHANGED_AFFECTED", "CI_FAILED", "CI_PENDING",
  "CI_MISSING", "CI_STALE", "VERIFICATION_MISSING", "VERIFICATION_STALE_HEAD", "VERIFIER_NOT_INDEPENDENT", "VERIFICATION_FAILED", "REVIEWER_AUTH_FAILED", "DRAFT_READY_FOR_REVIEW",
  "ALL_CONDITIONS_MET", "AUTO_MERGE_ARMED", "MERGEABILITY_UNKNOWN", "RISK_TIER_FOUNDER", "RISK_TIER_UNKNOWN", "PRIOR_NEGATIVE_VERDICT", "PRIOR_VERDICT_UNKNOWN", "MERGED_UNVERIFIED",
  "MERGE_COMMIT_UNKNOWN", "MERGED_VERIFIED", "POST_MERGE_MISMATCH"]);
// Actions the PR's own lane carries out on that same PR (or, for NEXT_TASK, by claiming its next task).
const LANE_OWNED = new Set(["RESOLVE_CONFLICT", "FIX_CI", "REMEDIATE_REVIEW", "NEXT_TASK"]);
export const CI_VALUES = Object.freeze(["PASS", "FAIL", "PENDING", "MISSING"]);
export const VERIFICATION_STATUSES = Object.freeze(["PASS", "FAIL", "MISSING", "AUTH_FAILED"]);
export const VERIFICATION_KINDS = Object.freeze(["APP", "PROCESS"]);
export const MERGEABLE_STATES = Object.freeze(["clean", "behind", "dirty", "blocked", "unstable", "has_hooks", "unknown", "draft"]);
const TIERS = ["ROUTINE", "PREAUTHORIZED", "FOUNDER"];
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LANE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const isSha = v => typeof v === "string" && SHA_RE.test(v);
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = v => typeof v === "string";
const FLOORS = pathMatcher(null);

function malformed(s) {
  if (!isObj(s)) return true;
  if (typeof s.draft !== "boolean" || typeof s.merged !== "boolean" || typeof s.autoMerge !== "boolean") return true;
  if (!isSha(s.headSha) || !isSha(s.baseSha)) return true;
  if (s.mergeable_state !== undefined && s.mergeable_state !== null && !MERGEABLE_STATES.includes(s.mergeable_state)) return true;
  if (!s.merged) {
    if (!isObj(s.ciRequired) || !CI_VALUES.includes(s.ciRequired.ubuntu) || !CI_VALUES.includes(s.ciRequired.windows)) return true;
    if (s.ciRequired.headSha !== undefined && !isSha(s.ciRequired.headSha)) return true;
  }
  return false;
}

// //TR: Base, doğrulamanın bağlandığı base'den sonra ilerlediyse: değişen base dosyaları biliniyorsa, PR dosyalarıyla kesişmiyorsa ve hiçbiri korunan/CI/yüksek riskli yol değilse PR etkilenmemiştir; bilinmiyorsa etkilenmiş sayılır (fail-closed).
function baseUnaffected(s, v) {
  if (v.baseSha === s.baseSha) return true;
  const d = s.baseDelta;
  if (!isObj(d) || d.fromBaseSha !== v.baseSha || d.toBaseSha !== s.baseSha || !Array.isArray(d.files) || !Array.isArray(s.prFiles) || !d.files.every(isStr) || !s.prFiles.every(isStr)) return false;
  const pr = new Set(s.prFiles.map(normPath));
  if (pr.has(null)) return false;
  return d.files.every(f => { const n = normPath(f); return n !== null && !pr.has(n) && !isHighRisk(n) && !FLOORS.protectedHit(n) && FLOORS.ciCategories(n).length === 0; });
}

function decideOne(s) {
  const lane = isObj(s) && isStr(s.lane) && LANE_RE.test(s.lane) ? s.lane : null;
  const pr = isObj(s) && Number.isSafeInteger(s.pr) && s.pr > 0 ? s.pr : null;
  const out = [];
  const act = (action, reason) => out.push({action, lane: LANE_OWNED.has(action) ? lane : null, reason});
  const done = (eligible) => {
    if (s.autoMerge === true && !eligible) out.unshift({action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_ELIGIBLE"});
    if (!out.length) out.push({action: "NOOP", lane: null, reason: "AUTO_MERGE_ARMED"});
    return {pr, actions: out};
  };
  if (malformed(s)) { if (isObj(s) && s.autoMerge === true) out.push({action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_ELIGIBLE"}); act("NOOP", "STATE_MALFORMED"); return {pr, actions: out}; }
  // Merged: verify the merge, then (only then) the lane takes its next task.
  if (s.merged) {
    if (s.postMerge === "MISMATCH") act("FOUNDER_REQUIRED", "POST_MERGE_MISMATCH");
    else if (s.postMerge === "VERIFIED") act("NEXT_TASK", "MERGED_VERIFIED");
    else { act("POST_MERGE_VERIFY", isSha(s.mergeCommit) ? "MERGED_UNVERIFIED" : "MERGE_COMMIT_UNKNOWN"); act("NEXT_TASK", "MERGED_UNVERIFIED"); }
    return {pr, actions: out};
  }
  const founderOk = isSha(s.founderApprovedHead) && s.founderApprovedHead === s.headSha;
  const tier = TIERS.includes(s.riskTier) ? s.riskTier : null;
  let blockedByAuthority = false;
  if (tier === null) { blockedByAuthority = true; }
  else if (tier === "FOUNDER" && !founderOk) { act("FOUNDER_REQUIRED", "RISK_TIER_FOUNDER"); blockedByAuthority = true; }
  if (s.priorNegative === true && !founderOk) { act("FOUNDER_REQUIRED", "PRIOR_NEGATIVE_VERDICT"); blockedByAuthority = true; }
  else if (s.priorNegative !== true && s.priorNegative !== false) blockedByAuthority = true;
  const ms = s.mergeable_state ?? "unknown";
  if (ms === "dirty") { act("RESOLVE_CONFLICT", "MERGE_CONFLICT"); return done(false); }
  if (ms === "behind") { act("UPDATE_BRANCH", "BRANCH_BEHIND"); return done(false); }
  const ci = s.ciRequired, stale = ci.headSha !== undefined && ci.headSha !== s.headSha, vals = [ci.ubuntu, ci.windows];
  if (stale) { act("WAIT_CI", "CI_STALE"); return done(false); }
  if (vals.includes("FAIL")) { act("FIX_CI", "CI_FAILED"); return done(false); }
  if (vals.includes("PENDING")) { act("WAIT_CI", "CI_PENDING"); return done(false); }
  if (vals.includes("MISSING")) { act("WAIT_CI", "CI_MISSING"); return done(false); }
  // CI is green on this head and nothing conflicts: a draft becomes ready (its ready_for_review event starts the App review of this head).
  if (s.draft) act("MARK_READY", "DRAFT_READY_FOR_REVIEW");
  const list = (Array.isArray(s.independentVerification) ? s.independentVerification : [s.independentVerification]).filter(isObj)
    .filter(v => VERIFICATION_STATUSES.includes(v.status) && VERIFICATION_KINDS.includes(v.kind) && isSha(v.headSha) && isSha(v.baseSha));
  // An independent verdict: the reviewer App, or a separate process review explicitly recorded as an independent session (never the builder's own).
  const trusted = v => v.kind === "APP" || (v.kind === "PROCESS" && v.independentSession === true);
  const onHead = v => v.headSha === s.headSha;
  const pass = list.find(v => v.status === "PASS" && trusted(v) && onHead(v) && baseUnaffected(s, v));
  if (!pass) {
    if (list.some(v => v.status === "FAIL" && onHead(v))) act("REMEDIATE_REVIEW", "VERIFICATION_FAILED");
    else if (list.some(v => v.status === "AUTH_FAILED" && onHead(v))) act("BLOCK_REVIEW_AUTH", "REVIEWER_AUTH_FAILED");
    else if (list.some(v => v.status === "PASS" && trusted(v) && onHead(v))) act("UPDATE_BRANCH", "BASE_CHANGED_AFFECTED");
    else if (list.some(v => v.status === "PASS" && trusted(v))) act("REVERIFY", "VERIFICATION_STALE_HEAD");
    else if (list.some(v => v.status === "PASS")) act("REQUEST_INDEPENDENT_VERIFICATION", "VERIFIER_NOT_INDEPENDENT");
    else if (!s.draft) act("REQUEST_INDEPENDENT_VERIFICATION", "VERIFICATION_MISSING");
    return done(false);
  }
  if (blockedByAuthority) {
    if (tier === null) act("NOOP", "RISK_TIER_UNKNOWN");
    else if (s.priorNegative !== true && s.priorNegative !== false) act("NOOP", "PRIOR_VERDICT_UNKNOWN");
    return done(false);
  }
  if (ms === "unknown") { act("NOOP", "MERGEABILITY_UNKNOWN"); return done(false); }
  // Every condition holds on this exact head and base: CI PASS, independent PASS, no conflict, tier not FOUNDER (or the Founder approved this head), no prior negative.
  if (!s.autoMerge) act("ENABLE_AUTO_MERGE", "ALL_CONDITIONS_MET");
  else act("NOOP", "AUTO_MERGE_ARMED");
  return done(true);
}

/**
 * //TR: state = {pr, lane, draft, headSha, baseSha, mergeable_state, ciRequired:{ubuntu, windows, headSha?}, independentVerification:{status, headSha, baseSha, kind, independentSession?} | [...],
 * riskTier, autoMerge, merged, mergeCommit?, postMerge?, priorNegative, founderApprovedHead?, baseDelta?:{fromBaseSha, toBaseSha, files}, prFiles?}. Dönüş {pr, actions:[{action, lane, reason}]}.
 */
export function nextActions(state) {
  try { return decideOne(state); } catch { return {pr: null, actions: [{action: "NOOP", lane: null, reason: "INTERNAL_ERROR"}]}; }
}

// One plan per PR, each computed on its own state only: a failure, conflict or malformed record of one PR never changes another PR's actions.
export function planAll(states) {
  return (Array.isArray(states) ? states : []).map(nextActions);
}
