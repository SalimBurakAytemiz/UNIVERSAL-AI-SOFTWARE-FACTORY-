// //TR: Bu modül tek bir PR için koordinatörün sıradaki eylemlerini hesaplayan saf ve deterministik denetleyicidir (COORD-TRANSITION-AUTONOMY): draft'ı hazıra alma, çatışma/CI/inceleme sorununu PR'ın kendi hattına geri verme, base değişince yalnız etkilenen PR'ı güncelleme, bağımsız doğrulamayı isteme veya yeniden isteme, reviewer kimlik hatasında engelleme (asla CLEAN değil), FOUNDER sınıfında ve önceki retde Founder'a bırakma ve yalnız her koşul bu head+base'e bağlı olarak sağlandığında head'e bağlı birleştirme (MERGE_HEAD: merge API'si sha=headSha ile). GitHub auto-merge head'e bağlı değildir (ortak hesabın sonraki push'u onu kapatmaz; #218 kanıtı), bu yüzden koordinatör onu hiç açmaz ve bu head'de açıldığı kanıtlanmayan her açık auto-merge'ü kapatır. Bir PR'ın hatası başka bir PR için asla eylem üretmez. Çıktı yalnız sabit kodlardır.
// Pure: no I/O, no network, no clock. The caller executes the actions in order and stops at the first one that does not succeed.
import {normPath, isHighRisk, pathMatcher} from "./merge-risk.mjs";

export const ACTIONS = Object.freeze(["DISABLE_AUTO_MERGE", "UPDATE_BRANCH", "RESOLVE_CONFLICT", "FIX_CI", "WAIT_CI", "REQUEST_INDEPENDENT_VERIFICATION", "REVERIFY", "REMEDIATE_REVIEW",
  "BLOCK_REVIEW_AUTH", "MARK_READY", "MERGE_HEAD", "FOUNDER_REQUIRED", "POST_MERGE_VERIFY", "NEXT_TASK", "NOOP"]);
export const REASONS = Object.freeze(["STATE_MALFORMED", "INTERNAL_ERROR", "AUTO_MERGE_NOT_BOUND_TO_HEAD", "MERGE_CONFLICT", "BRANCH_BEHIND", "BASE_CHANGED_AFFECTED", "CI_FAILED",
  "CI_PENDING", "CI_MISSING", "CI_STALE", "CI_HEAD_UNKNOWN", "VERIFICATION_MISSING", "VERIFICATION_STALE_HEAD", "VERIFIER_NOT_INDEPENDENT", "VERIFICATION_FAILED", "REVIEWER_AUTH_FAILED",
  "DRAFT_READY_FOR_REVIEW", "ALL_CONDITIONS_MET", "MERGEABILITY_UNKNOWN", "RISK_TIER_FOUNDER", "RISK_TIER_UNKNOWN", "PRIOR_NEGATIVE_VERDICT", "PRIOR_VERDICT_UNKNOWN",
  "MERGED_UNVERIFIED", "MERGE_COMMIT_UNKNOWN", "MERGED_VERIFIED", "POST_MERGE_MISMATCH"]);
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
const isPr = v => Number.isSafeInteger(v) && v > 0;
const FLOORS = pathMatcher(null);

function malformed(s) {
  // Without a valid PR number no action can be applied to the right PR.
  if (!isObj(s) || !isPr(s.pr)) return true;
  if (typeof s.draft !== "boolean" || typeof s.merged !== "boolean" || typeof s.autoMerge !== "boolean") return true;
  if (!isSha(s.headSha) || !isSha(s.baseSha)) return true;
  if (s.mergeable_state !== undefined && s.mergeable_state !== null && !MERGEABLE_STATES.includes(s.mergeable_state)) return true;
  if (!s.merged) {
    if (!isObj(s.ciRequired) || !CI_VALUES.includes(s.ciRequired.ubuntu) || !CI_VALUES.includes(s.ciRequired.windows)) return true;
    if (s.ciRequired.headSha !== undefined && !isSha(s.ciRequired.headSha)) return true;
  }
  return false;
}

// //TR: Base, doğrulamanın bağlandığı base'den sonra ilerlediyse: değişen base dosyaları biliniyorsa, PR dosyalarıyla AD olarak kesişmiyorsa ve hiçbiri korunan/CI/yüksek riskli yol değilse PR etkilenmemiştir; bilinmiyorsa veya PR dosya listesi boşsa etkilenmiş sayılır (fail-closed). Bu yalnız ad kesişimidir, içe aktarma grafiği değildir (COORD-TRANSITION-AUTONOMY sapma listesinde).
function baseUnaffected(s, v) {
  if (v.baseSha === s.baseSha) return true;
  const d = s.baseDelta;
  if (!isObj(d) || d.fromBaseSha !== v.baseSha || d.toBaseSha !== s.baseSha || !Array.isArray(d.files) || !Array.isArray(s.prFiles) || !d.files.every(isStr) || !s.prFiles.every(isStr)) return false;
  if (s.prFiles.length === 0 || d.files.length === 0) return false;
  const pr = new Set(s.prFiles.map(normPath));
  if (pr.has(null)) return false;
  return d.files.every(f => { const n = normPath(f); return n !== null && !pr.has(n) && !isHighRisk(n) && !FLOORS.protectedHit(n) && FLOORS.ciCategories(n).length === 0; });
}

function decideOne(s) {
  const lane = isObj(s) && isStr(s.lane) && LANE_RE.test(s.lane) ? s.lane : null;
  const pr = isObj(s) && isPr(s.pr) ? s.pr : null;
  const out = [];
  const act = (action, reason, extra) => { if (!out.some(a => a.action === action && a.reason === reason)) out.push({action, lane: LANE_OWNED.has(action) ? lane : null, reason, ...extra}); };
  // //TR: Açık bir GitHub auto-merge, ancak bu head'de açıldığı kanıtlanırsa (autoMergeArmedHead === headSha; yalnız Founder açar) bırakılır; aksi hâlde her durumda önce kapatılır, çünkü sonraki her head'i yalnız iki validate kontrolüyle birleştirir.
  const armedOnHead = isObj(s) && isSha(s.autoMergeArmedHead) && s.autoMergeArmedHead === s.headSha;
  const done = () => {
    if (s.autoMerge === true && !armedOnHead) out.unshift({action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_BOUND_TO_HEAD"});
    return {pr, actions: out};
  };
  if (malformed(s)) { if (isObj(s) && s.autoMerge === true) out.push({action: "DISABLE_AUTO_MERGE", lane: null, reason: "AUTO_MERGE_NOT_BOUND_TO_HEAD"}); act("NOOP", "STATE_MALFORMED"); return {pr, actions: out}; }
  // Merged: verify the merge, then (only then) the lane takes its next task.
  if (s.merged) {
    if (s.postMerge === "MISMATCH") act("FOUNDER_REQUIRED", "POST_MERGE_MISMATCH");
    else if (s.postMerge === "VERIFIED") act("NEXT_TASK", "MERGED_VERIFIED");
    else { act("POST_MERGE_VERIFY", isSha(s.mergeCommit) ? "MERGED_UNVERIFIED" : "MERGE_COMMIT_UNKNOWN"); act("NEXT_TASK", "MERGED_UNVERIFIED"); }
    return {pr, actions: out};
  }
  // //TR: FOUNDER sınıfı ve önceki ret her zaman FOUNDER_REQUIRED'dır; denetleyicide Founder onayını temsil eden bir girdi yoktur (ortak hesapta Founder ile otomasyon ayırt edilemez). Founder birleştirir veya bu head'de kendisi auto-merge açar.
  const tier = TIERS.includes(s.riskTier) ? s.riskTier : null;
  let blockedByAuthority = tier === null || tier === "FOUNDER";
  if (tier === "FOUNDER") act("FOUNDER_REQUIRED", "RISK_TIER_FOUNDER");
  if (s.priorNegative === true) { act("FOUNDER_REQUIRED", "PRIOR_NEGATIVE_VERDICT"); blockedByAuthority = true; }
  else if (s.priorNegative !== false) blockedByAuthority = true;
  const ms = s.mergeable_state ?? "unknown";
  if (ms === "dirty") { act("RESOLVE_CONFLICT", "MERGE_CONFLICT"); return done(); }
  if (ms === "behind") { act("UPDATE_BRANCH", "BRANCH_BEHIND"); return done(); }
  // CI counts only when it is bound to this exact head (a missing head binding is not this head's CI).
  const ci = s.ciRequired, vals = [ci.ubuntu, ci.windows];
  if (ci.headSha === undefined) { act("WAIT_CI", "CI_HEAD_UNKNOWN"); return done(); }
  if (ci.headSha !== s.headSha) { act("WAIT_CI", "CI_STALE"); return done(); }
  if (vals.includes("FAIL")) { act("FIX_CI", "CI_FAILED"); return done(); }
  if (vals.includes("PENDING")) { act("WAIT_CI", "CI_PENDING"); return done(); }
  if (vals.includes("MISSING")) { act("WAIT_CI", "CI_MISSING"); return done(); }
  // CI is green on this head and nothing conflicts: a draft becomes ready (its ready_for_review event starts the App review of this head).
  if (s.draft) act("MARK_READY", "DRAFT_READY_FOR_REVIEW");
  const list = (Array.isArray(s.independentVerification) ? s.independentVerification : [s.independentVerification]).filter(isObj)
    .filter(v => VERIFICATION_STATUSES.includes(v.status) && VERIFICATION_KINDS.includes(v.kind) && isSha(v.headSha) && isSha(v.baseSha));
  // An independent verdict: the reviewer App, or a separate process review explicitly recorded as an independent session (never the builder's own).
  const trusted = v => v.kind === "APP" || (v.kind === "PROCESS" && v.independentSession === true);
  const onHead = v => v.headSha === s.headSha;
  // //TR: Bu head'e bağlı herhangi bir FAIL kararı (App veya süreç, bağımsız olsun olmasın) başka bir PASS ile oylanıp geçilemez: hat düzeltir; aynı head'de ayrıca bir PASS varsa bu, aynı içerikte ret sonrası yeniden incelemedir ve Founder'a gider.
  if (list.some(v => v.status === "FAIL" && onHead(v))) {
    if (list.some(v => v.status === "PASS" && onHead(v))) act("FOUNDER_REQUIRED", "PRIOR_NEGATIVE_VERDICT");
    act("REMEDIATE_REVIEW", "VERIFICATION_FAILED");
    return done();
  }
  const pass = list.find(v => v.status === "PASS" && trusted(v) && onHead(v) && baseUnaffected(s, v));
  if (!pass) {
    if (list.some(v => v.status === "AUTH_FAILED" && onHead(v))) act("BLOCK_REVIEW_AUTH", "REVIEWER_AUTH_FAILED");
    else if (list.some(v => v.status === "PASS" && trusted(v) && onHead(v))) act("UPDATE_BRANCH", "BASE_CHANGED_AFFECTED");
    else if (list.some(v => v.status === "PASS" && trusted(v))) act("REVERIFY", "VERIFICATION_STALE_HEAD");
    else if (list.some(v => v.status === "PASS")) act("REQUEST_INDEPENDENT_VERIFICATION", "VERIFIER_NOT_INDEPENDENT");
    else if (!s.draft) act("REQUEST_INDEPENDENT_VERIFICATION", "VERIFICATION_MISSING");
    return done();
  }
  if (blockedByAuthority) {
    if (tier === null) act("NOOP", "RISK_TIER_UNKNOWN");
    else if (s.priorNegative !== true && s.priorNegative !== false) act("NOOP", "PRIOR_VERDICT_UNKNOWN");
    return done();
  }
  if (ms === "unknown") { act("NOOP", "MERGEABILITY_UNKNOWN"); return done(); }
  // Every condition holds on this exact head and base: CI PASS on the head, a trusted PASS bound to head and base, no FAIL on the head, no conflict, tier not FOUNDER,
  // no prior negative. The merge is bound to the head: the merge API call carries sha = headSha, so GitHub refuses it once the head has moved.
  act("MERGE_HEAD", "ALL_CONDITIONS_MET", {headSha: s.headSha});
  return done();
}

/**
 * //TR: state = {pr, lane, draft, headSha, baseSha, mergeable_state, ciRequired:{ubuntu, windows, headSha}, independentVerification:{status, headSha, baseSha, kind, independentSession?} | [...],
 * riskTier, autoMerge, autoMergeArmedHead?, merged, mergeCommit?, postMerge?, priorNegative, baseDelta?:{fromBaseSha, toBaseSha, files}, prFiles?}.
 * Dönüş {pr, actions:[{action, lane, reason, headSha?}]}; MERGE_HEAD her zaman birleştirilecek head'i taşır.
 */
export function nextActions(state) {
  try { return decideOne(state); } catch { return {pr: null, actions: [{action: "NOOP", lane: null, reason: "INTERNAL_ERROR"}]}; }
}

// One plan per PR, each computed on its own state only: a failure, conflict or malformed record of one PR never changes another PR's actions.
export function planAll(states) {
  return (Array.isArray(states) ? states : []).map(nextActions);
}
