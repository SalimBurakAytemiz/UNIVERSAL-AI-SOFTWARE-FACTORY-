// //TR: Bu modül tek bir PR için koordinatörün sıradaki eylemlerini hesaplayan saf ve deterministik denetleyicidir (COORD-TRANSITION-AUTONOMY): draft'ı hazıra alma, çatışma/CI/inceleme sorununu PR'ın kendi hattına geri verme, base ilerleyince PR'ı birleştirmeye veya doğrulamaya hazır olduğu anda güncelleme (merge-gate ile aynı base kuralı: pulls.base.sha == base ucu == kararın base'i), bağımsız doğrulamayı isteme veya yeniden isteme, reviewer kimlik hatasında engelleme (asla CLEAN değil), FOUNDER sınıfında ve önceki retde Founder'a bırakma ve yalnız her koşul bu head+base'e bağlı olarak sağlandığında head'e bağlı birleştirme (MERGE_HEAD: merge API'si sha=headSha ile, merge-gate MERGE kararından sonra). GitHub auto-merge head'e bağlı değildir (ortak hesabın sonraki push'u onu kapatmaz; #218 kanıtı), bu yüzden koordinatör onu hiç açmaz; bu head'de açıldığı kanıtlanmayan her açık auto-merge'ü ve PR'a push yapacak her eylemden önce açık auto-merge'ü kapatır. Bir PR'ın hatası başka bir PR için asla eylem üretmez. Çıktı yalnız sabit kodlardır.
// Pure: no I/O, no network, no clock. The caller executes the actions in order and stops at the first one that does not succeed.

export const ACTIONS = Object.freeze(["DISABLE_AUTO_MERGE", "UPDATE_BRANCH", "RESOLVE_CONFLICT", "FIX_CI", "WAIT_CI", "REQUEST_INDEPENDENT_VERIFICATION", "REVERIFY", "REMEDIATE_REVIEW",
  "BLOCK_REVIEW_AUTH", "MARK_READY", "MERGE_HEAD", "FOUNDER_REQUIRED", "POST_MERGE_VERIFY", "NEXT_TASK", "NOOP"]);
export const REASONS = Object.freeze(["STATE_MALFORMED", "INTERNAL_ERROR", "AUTO_MERGE_NOT_BOUND_TO_HEAD", "AUTO_MERGE_BEFORE_PUSH", "MERGE_CONFLICT", "BRANCH_BEHIND", "BASE_MOVED",
  "CI_FAILED", "CI_PENDING", "CI_MISSING", "CI_STALE", "CI_HEAD_UNKNOWN", "VERIFICATION_MISSING", "VERIFICATION_MALFORMED", "VERIFICATION_STALE_HEAD", "VERIFICATION_STALE_BASE",
  "VERIFIER_NOT_INDEPENDENT", "VERIFICATION_FAILED", "REVIEWER_AUTH_FAILED", "DRAFT_READY_FOR_REVIEW", "ALL_CONDITIONS_MET", "MERGEABILITY_UNKNOWN", "RISK_TIER_FOUNDER",
  "RISK_TIER_UNKNOWN", "RISK_TIER_STALE", "PRIOR_NEGATIVE_VERDICT", "PRIOR_VERDICT_UNKNOWN", "PRIOR_VERDICT_STALE", "MERGED_UNVERIFIED", "MERGE_COMMIT_UNKNOWN", "MERGED_VERIFIED",
  "POST_MERGE_MISMATCH"]);
// Actions the PR's own lane carries out on that same PR (or, for NEXT_TASK, by claiming its next task).
const LANE_OWNED = new Set(["RESOLVE_CONFLICT", "FIX_CI", "REMEDIATE_REVIEW", "NEXT_TASK"]);
// Actions that push a new head to the PR (the lane's fix, or the coordinator's update from the base).
export const PUSH_ACTIONS = Object.freeze(["RESOLVE_CONFLICT", "FIX_CI", "REMEDIATE_REVIEW", "UPDATE_BRANCH"]);
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
const PUSHES = new Set(PUSH_ACTIONS);

function malformed(s) {
  // Without a valid PR number no action can be applied to the right PR.
  if (!isObj(s) || !isPr(s.pr)) return true;
  if (typeof s.draft !== "boolean" || typeof s.merged !== "boolean" || typeof s.autoMerge !== "boolean") return true;
  if (!isSha(s.headSha) || !isSha(s.baseSha)) return true;
  if (s.mergeable_state !== undefined && s.mergeable_state !== null && !MERGEABLE_STATES.includes(s.mergeable_state)) return true;
  if (!s.merged) {
    // The base the PR's CI merge ref was built from (pulls/{n}.base.sha): without it the gate's BASE_DRIFT rule cannot be applied.
    if (!isSha(s.prBaseSha)) return true;
    if (!isObj(s.ciRequired) || !CI_VALUES.includes(s.ciRequired.ubuntu) || !CI_VALUES.includes(s.ciRequired.windows)) return true;
    if (s.ciRequired.headSha !== undefined && !isSha(s.ciRequired.headSha)) return true;
  }
  return false;
}

// //TR: Bir karar kaydı yalnız şu biçimdeyse okunur: bilinen durum ve tür, geçerli küçük harfli head SHA'sı; PASS için geçerli base SHA'sı (FAIL, MISSING, AUTH_FAILED için base boş olabilir: check run base taşımaz). Başka bir head'e ait olduğu KANITLANMAYAN her bozuk kayıt birleştirmeyi engeller; FAIL durumlu her kayıt (türü, base'i veya head'i bozuk olsa bile) bu head'de bir FAIL sayılır.
const wellFormed = v => isObj(v) && VERIFICATION_STATUSES.includes(v.status) && VERIFICATION_KINDS.includes(v.kind) && isSha(v.headSha)
  && (v.status === "PASS" ? isSha(v.baseSha) : v.baseSha === undefined || v.baseSha === null || isSha(v.baseSha));

function decideOne(s) {
  const lane = isObj(s) && isStr(s.lane) && LANE_RE.test(s.lane) ? s.lane : null;
  const pr = isObj(s) && isPr(s.pr) ? s.pr : null;
  const out = [];
  const act = (action, reason, extra) => { if (!out.some(a => a.action === action && a.reason === reason)) out.push({action, lane: LANE_OWNED.has(action) ? lane : null, reason, ...extra}); };
  // //TR: Açık bir GitHub auto-merge yalnız bu head'de açıldığı kanıtlanırsa (autoMergeArmedHead === headSha; yalnız Founder açar) ve plan PR'a push yapmıyorsa bırakılır. Aksi hâlde önce kapatılır: sonraki her head'i yalnız iki validate kontrolüyle birleştirir ve bir push head'i değiştirir.
  const armedOnHead = isObj(s) && isSha(s.autoMergeArmedHead) && s.autoMergeArmedHead === s.headSha;
  const done = () => {
    if (s.autoMerge === true && (!armedOnHead || out.some(a => PUSHES.has(a.action))))
      out.unshift({action: "DISABLE_AUTO_MERGE", lane: null, reason: armedOnHead ? "AUTO_MERGE_BEFORE_PUSH" : "AUTO_MERGE_NOT_BOUND_TO_HEAD"});
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
  // //TR: Risk sınıfı ve önceki ret kaydı yalnız hesaplandıkları head için geçerlidir (riskTierHeadSha / priorNegativeHeadSha === headSha); eski bir head'in sınıfı veya kaydı bilinmiyor sayılır ve birleştirme olmaz.
  // FOUNDER sınıfı ve önceki ret her zaman FOUNDER_REQUIRED'dır; denetleyicide Founder onayını temsil eden bir girdi yoktur (ortak hesapta Founder ile otomasyon ayırt edilemez). Founder birleştirir veya bu head'de kendisi auto-merge açar.
  const tierBound = isSha(s.riskTierHeadSha) && s.riskTierHeadSha === s.headSha;
  const tier = tierBound && TIERS.includes(s.riskTier) ? s.riskTier : null;
  const priorBound = isSha(s.priorNegativeHeadSha) && s.priorNegativeHeadSha === s.headSha;
  const prior = priorBound && typeof s.priorNegative === "boolean" ? s.priorNegative : null;
  if (tier === "FOUNDER") act("FOUNDER_REQUIRED", "RISK_TIER_FOUNDER");
  if (prior === true) act("FOUNDER_REQUIRED", "PRIOR_NEGATIVE_VERDICT");
  const blockedByAuthority = tier === null || tier === "FOUNDER" || prior !== false;
  // Why the coordinator may not merge when no Founder action was reported: an unknown or stale tier or prior record (the plan is never empty).
  const authorityNoop = () => {
    if (tier === null) act("NOOP", TIERS.includes(s.riskTier) ? "RISK_TIER_STALE" : "RISK_TIER_UNKNOWN");
    else if (prior === null) act("NOOP", typeof s.priorNegative === "boolean" ? "PRIOR_VERDICT_STALE" : "PRIOR_VERDICT_UNKNOWN");
  };
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
  // //TR: Negatif karar denetimi FİLTRELENMEMİŞ liste üzerindedir: başka bir head'e ait olduğu kanıtlanmayan (geçerli ve farklı headSha) her FAIL kaydı bu head'deki bir FAIL'dır ve hiçbir PASS onu oylayıp geçemez; aynı head'de ayrıca bir PASS varsa bu, ret sonrası yeniden incelemedir ve Founder'a gider. Ardından okunamayan her kayıt (bilinmeyen durum/tür, PASS'te eksik base, bozuk SHA) birleştirmeyi durdurur.
  const raw = s.independentVerification;
  const entries = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  const otherHead = v => isObj(v) && isSha(v.headSha) && v.headSha !== s.headSha;
  if (entries.some(v => isObj(v) && v.status === "FAIL" && !otherHead(v))) {
    if (entries.some(v => isObj(v) && v.status === "PASS" && v.headSha === s.headSha)) act("FOUNDER_REQUIRED", "PRIOR_NEGATIVE_VERDICT");
    act("REMEDIATE_REVIEW", "VERIFICATION_FAILED");
    return done();
  }
  if (entries.some(v => !wellFormed(v) && !otherHead(v))) { act("NOOP", "VERIFICATION_MALFORMED"); return done(); }
  // //TR: Merge-gate ile aynı base kuralı: PR'ın CI'ı pulls.base.sha ile kurulan merge ref üzerinde koştu; base ucu ondan ilerlediyse (gate: BASE_DRIFT) koordinatörün birleştirebileceği PR, doğrulanmadan veya birleştirilmeden önce güncellenir (yeni head, yeni CI, yeni doğrulama). Dosya adı kesişimiyle "etkilenmedi" istisnası yoktur: adlar bir bağımlılık grafiği değildir ve gate de böyle bir istisna tanımaz. Henüz hazır olmayan PR'lara (CI kırmızı/bekliyor, çatışma, negatif veya okunamayan karar) ve FOUNDER sınıfı/önceki retli PR'lara (güncellemeyi Founder seçer) base hareketi dokunmaz.
  const mayMerge = !blockedByAuthority;
  if (mayMerge && s.prBaseSha !== s.baseSha) { act("UPDATE_BRANCH", "BASE_MOVED"); return done(); }
  // CI is green on this head, it was built on the current base and no verdict blocks: a draft becomes ready (its ready_for_review event starts the App review of this head).
  if (s.draft) act("MARK_READY", "DRAFT_READY_FOR_REVIEW");
  const list = entries.filter(wellFormed);
  // An independent verdict: the reviewer App, or a separate process review explicitly recorded as an independent session (never the builder's own).
  const trusted = v => v.kind === "APP" || (v.kind === "PROCESS" && v.independentSession === true);
  const onHead = v => v.headSha === s.headSha;
  const pass = list.find(v => v.status === "PASS" && trusted(v) && onHead(v) && v.baseSha === s.baseSha);
  if (!pass) {
    // A trusted PASS on this head bound to another base: re-verified against the current base only when the coordinator may merge (the Founder decides otherwise).
    if (list.some(v => v.status === "PASS" && trusted(v) && onHead(v))) { if (mayMerge) act("REVERIFY", "VERIFICATION_STALE_BASE"); else authorityNoop(); }
    else if (list.some(v => v.status === "AUTH_FAILED" && onHead(v))) act("BLOCK_REVIEW_AUTH", "REVIEWER_AUTH_FAILED");
    else if (list.some(v => v.status === "PASS" && trusted(v))) act("REVERIFY", "VERIFICATION_STALE_HEAD");
    else if (list.some(v => v.status === "PASS")) act("REQUEST_INDEPENDENT_VERIFICATION", "VERIFIER_NOT_INDEPENDENT");
    else if (!s.draft) act("REQUEST_INDEPENDENT_VERIFICATION", "VERIFICATION_MISSING");
    return done();
  }
  if (blockedByAuthority) { authorityNoop(); return done(); }
  if (ms === "unknown") { act("NOOP", "MERGEABILITY_UNKNOWN"); return done(); }
  // Every condition holds on this exact head and base: CI PASS on the head and built on this base, a trusted PASS bound to head and base, no FAIL or unreadable verdict
  // on the head, no conflict, tier not FOUNDER and no prior negative (both computed for this head). The merge is bound to the head: the coordinator runs the merge
  // gate for this head and base (MERGE_GATE.md) and calls the merge API with sha = headSha, so GitHub refuses it once the head has moved.
  act("MERGE_HEAD", "ALL_CONDITIONS_MET", {headSha: s.headSha});
  return done();
}

/**
 * //TR: state = {pr, lane, draft, headSha, baseSha (base dalının ucu, en son okunan), prBaseSha (pulls/{n}.base.sha), mergeable_state, ciRequired:{ubuntu, windows, headSha},
 * independentVerification:{status, headSha, baseSha, kind, independentSession?} | [...], riskTier, riskTierHeadSha, autoMerge, autoMergeArmedHead?, merged, mergeCommit?, postMerge?,
 * priorNegative, priorNegativeHeadSha}. Girdi eşlemesi COORD-TRANSITION-AUTONOMY.md "Controller inputs" bölümündedir.
 * Dönüş {pr, actions:[{action, lane, reason, headSha?}]}; MERGE_HEAD her zaman birleştirilecek head'i taşır.
 */
export function nextActions(state) {
  try { return decideOne(state); } catch { return {pr: null, actions: [{action: "NOOP", lane: null, reason: "INTERNAL_ERROR"}]}; }
}

// One plan per PR, each computed on its own state only: a failure, conflict or malformed record of one PR never changes another PR's actions.
export function planAll(states) {
  return (Array.isArray(states) ? states : []).map(nextActions);
}
