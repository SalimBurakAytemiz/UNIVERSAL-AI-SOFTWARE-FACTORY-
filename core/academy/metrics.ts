// //TR: Bu dosya Skill Academy ölçülebilir öğrenme sonuçlarını (599 sözleşmesi §5.3) yalnız kayıtlı öğrenme/kaynak/yeniden kullanım kayıtlarından saf fonksiyonla hesaplar; veri yoksa her metrik null döner (değer uydurulmaz), etiketli veri seti gerektiren precision/recall her zaman null'dır.
import {reviewerIsIndependent} from "./rules.js";
import {PROMOTED_FAMILY, PROMOTED_STATUSES} from "./types.js";
import type {LearningRecord, LearningTrigger, ReuseEvent, SourceRecord, SourceTrust} from "./types.js";

export interface Ratio { numerator: number; denominator: number; rate: number }
export interface AcademyMetrics {
  gapDetect: {total: number; byTrigger: Record<LearningTrigger, number>} | null;
  // Ölçülmüş etiketli veri seti olmadan hesaplanamaz.
  gapDetectPrecision: null; gapDetectRecall: null;
  sourceCredibility: {total: number; byTrust: Record<SourceTrust, number>} | null;
  knowledgeFreshness: Ratio | null;
  labPassRate: Ratio | null;
  promotionReversalRate: Ratio | null;
  reuseSuccess: Ratio | null;
  // Yanlış terfi: bağımsız reviewer'sız, kanıtsız veya yetki etkili terfi. Değişmezler gereği 0 olmalıdır.
  falseCertificationRate: Ratio | null;
  timeToAcquireMs: {count: number; meanMs: number; medianMs: number} | null;
}
export interface MetricsInput { learnings: readonly LearningRecord[]; sources: readonly SourceRecord[]; reuses: readonly ReuseEvent[] }

const ratio = (n: number, d: number): Ratio | null => (d === 0 ? null : {numerator: n, denominator: d, rate: n / d});
const zeroTriggers = (): Record<LearningTrigger, number> => ({REAL_MISSION: 0, CAPABILITY_GAP: 0, RELEASE_DRIFT: 0, FAILED_EVAL: 0});
const zeroTrust = (): Record<SourceTrust, number> => ({OFFICIAL: 0, STANDARD: 0, VENDOR_DOC: 0, ACADEMIC: 0, COMMUNITY_LOWER_TRUST: 0, UNTRUSTED: 0});

export function isFalsePromotion(r: LearningRecord): boolean {
  const pr = r.promotion;
  if (!pr) return true;
  return r.reviewerIdentity === null || !reviewerIsIndependent(r, r.reviewerIdentity) || r.reviewerRunRef === null
    || !pr.reviewerEvidence?.sha256 || pr.supportingSourceIds.length === 0 || r.permissionDelta.length !== 0
    || pr.executable !== false || pr.authorityEffect !== "NONE";
}

export function computeMetrics(input: MetricsInput): AcademyMetrics {
  const {learnings, sources, reuses} = input;
  let gapDetect: AcademyMetrics["gapDetect"] = null;
  if (learnings.length > 0) { const byTrigger = zeroTriggers(); for (const l of learnings) byTrigger[l.trigger] += 1; gapDetect = {total: learnings.length, byTrigger}; }
  let sourceCredibility: AcademyMetrics["sourceCredibility"] = null;
  if (sources.length > 0) { const byTrust = zeroTrust(); for (const s of sources) byTrust[s.sourceTrust] += 1; sourceCredibility = {total: sources.length, byTrust}; }

  const active = learnings.filter(l => PROMOTED_STATUSES.includes(l.status)).length;
  const aging = learnings.filter(l => l.status === "STALE" || l.status === "RECERTIFY_REQUIRED").length;
  const withLab = learnings.filter(l => l.labResult !== null);
  const everPromoted = learnings.filter(l => l.timestamps.promotedAt !== null && PROMOTED_FAMILY.includes(l.status));
  const durations = everPromoted.map(l => Date.parse(l.timestamps.promotedAt as string) - Date.parse(l.timestamps.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const median = durations.length === 0 ? 0 : durations.length % 2 ? durations[(durations.length - 1) / 2] : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;
  return {
    gapDetect, gapDetectPrecision: null, gapDetectRecall: null, sourceCredibility,
    knowledgeFreshness: ratio(active, active + aging),
    labPassRate: ratio(withLab.filter(l => l.labResult?.passed === true).length, withLab.length),
    promotionReversalRate: ratio(everPromoted.filter(l => l.status === "REVOKED").length, everPromoted.length),
    reuseSuccess: ratio(reuses.filter(r => r.outcome === "SUCCESS").length, reuses.length),
    falseCertificationRate: ratio(everPromoted.filter(isFalsePromotion).length, everPromoted.length),
    timeToAcquireMs: durations.length === 0 ? null : {count: durations.length, meanMs: durations.reduce((a, b) => a + b, 0) / durations.length, medianMs: median}
  };
}
