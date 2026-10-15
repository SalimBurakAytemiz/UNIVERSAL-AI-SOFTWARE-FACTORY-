// //TR: Bu dosya REL-FX-1 kanıta bağlı tamamlama yüklemini (runner REPORT adımıyla aynı yüklem) ve saf deriveOutcomes(run, evidence) okuma modelini tanımlar; kanıt yoksa sonuç dürüstçe NOT_EXECUTED/UNKNOWN olur, hiçbir alan tahminle VERIFIED yazılmaz. Yeni store veya servis yoktur (REL-216).
import type {RunCompletionRecord, RunEvidence, SecurityStageSummary, TestChangesAcknowledgement, WorkRun} from "./types.js";

// Doc 3.4 durum sözlüğü (+ FX-2 oracle durumları). PARTIAL güvenlik kapsamı DEGRADED olarak gösterilir.
export type OutcomeState = "VERIFIED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_EXECUTED" | "STALE" | "DEGRADED" | "NOT_APPLICABLE" | "UNVERIFIED_ORACLE" | "UNVERIFIED_VACUOUS";
// //TR: REL-FX c4 (S2): tamamlama biçimi; ACKNOWLEDGED_TEST_CHANGES Founder'ın mevcut test/harness değişikliklerini açıkça onayladığı kabuldür (her yüzeyde NOT VERIFIED etiketlenir).
export type CompletionMode = "NOT_COMPLETED" | "EVIDENCE_GUARD" | "ACKNOWLEDGED_TEST_CHANGES";
export interface RunOutcomes {
  schemaVersion: 1; runId: string; headSha: string | null; completionMode: CompletionMode;
  execution: OutcomeState; functionalAcceptance: OutcomeState; security: OutcomeState; evidenceIntegrity: OutcomeState;
  recovery: OutcomeState; release: OutcomeState; customerOutcome: OutcomeState;
  // Her alan için sabit, yol/secret içermeyen sebep kodu.
  reasons: Record<"execution" | "functionalAcceptance" | "security" | "evidenceIntegrity" | "recovery" | "release" | "customerOutcome", string>;
}

const latest = (ev: readonly RunEvidence[], pred: (e: RunEvidence) => boolean): RunEvidence | undefined => { for (let i = ev.length - 1; i >= 0; i--) if (pred(ev[i])) return ev[i]; return undefined; };

// //TR: runner stepReport ile paylaşılan yüklem: en son CLEAN REVIEW kanıtı run.headSha içindir ve run.headSha için BLOCKED olmayan bir SECURITY_REPORT vardır.
export type ReviewSecurityCheck =
  | {ok: true; review: RunEvidence; security: RunEvidence & {security: SecurityStageSummary}}
  | {ok: false; reason: "REVIEW_EVIDENCE_MISSING" | "SECURITY_EVIDENCE_MISSING"};
export function reviewAndSecurityFor(headSha: string | null, evidence: readonly RunEvidence[]): ReviewSecurityCheck {
  const review = latest(evidence, e => e.kind === "REVIEW" && e.verdict === "CLEAN");
  if (!headSha || !review || review.commitSha !== headSha) return {ok: false, reason: "REVIEW_EVIDENCE_MISSING"};
  const secEv = latest(evidence, e => e.kind === "SECURITY_REPORT" && e.commitSha === headSha);
  if (!secEv || !secEv.security || secEv.security.status === "BLOCKED") return {ok: false, reason: "SECURITY_EVIDENCE_MISSING"};
  return {ok: true, review, security: secEv as RunEvidence & {security: SecurityStageSummary}};
}

// //TR: COMPLETE kapısının sabit 409 sebep kodları (API ve store aynı kodu döner).
export type CompletionRefusal =
  | "COMPLETION_NO_RUN" | "COMPLETION_RUN_NOT_AWAITING_APPROVAL" | "COMPLETION_HEAD_SHA_MISSING" | "COMPLETION_REVIEW_EVIDENCE_MISSING"
  | "COMPLETION_SECURITY_EVIDENCE_MISSING" | "COMPLETION_REPORT_EVIDENCE_MISSING" | "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED" | "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT";
export type CompletionEvidenceRefs = RunCompletionRecord;
// COMPLETE isteğinin açık onay nesnesi: {acknowledgeTestChanges: true, testSurfaceSha256: <TEST_SURFACE kanıt logunun sha256'sı>}.
export interface TestChangesAcknowledgementInput { acknowledgeTestChanges: true; testSurfaceSha256: string }
export type CompletionCheck = {ok: true; refs: CompletionEvidenceRefs} | {ok: false; reason: CompletionRefusal};
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// //TR: REL-FX c4 (S1/S4): run.headSha için en son TEST_SURFACE kanıtında mevcut (base'de var olan) bir test dosyası değişti/silindi/yeniden adlandırıldıysa veya
// herhangi bir harness/yapılandırma değişikliği varsa COMPLETE açık onay ister. Yalnız yeni eklenen test dosyaları onay istemez (mevcut testi zayıflatmaz; UNVERIFIED_ORACLE kalır).
// Metin desenli devre dışı test dedektörü yalnız risk sinyalidir; garanti bu yapısal kuraldır (desen kaçışları onaysız tamamlamaya dönüşmez).
export interface TestChangesRequirement { required: boolean; evidence: RunEvidence | null; testSurfaceSha256: string | null; changed: TestChangesAcknowledgement["changed"] }
export function testChangesRequirement(head: string | null, evidence: readonly RunEvidence[]): TestChangesRequirement {
  const ev = head ? latest(evidence, e => e.kind === "TEST_SURFACE" && e.commitSha === head && !!e.testSurface) : undefined;
  const t = ev?.testSurface;
  const changed = {modified: [...(t?.modified ?? [])], deleted: [...(t?.deleted ?? [])], renamed: (t?.renamed ?? []).map(r => ({from: r.from, to: r.to})), harness: [...(t?.harness ?? [])], truncated: t?.truncated === true};
  const required = !!t && (changed.modified.length + changed.deleted.length + changed.renamed.length + changed.harness.length > 0 || t.weakened.length > 0);
  return {required, evidence: ev ?? null, testSurfaceSha256: ev && typeof ev.logSha256 === "string" && SHA256.test(ev.logSha256) ? ev.logSha256 : null, changed};
}
const isAckInput = (a: unknown): a is TestChangesAcknowledgementInput => typeof a === "object" && a !== null && !Array.isArray(a)
  && Object.keys(a).sort().join(",") === "acknowledgeTestChanges,testSurfaceSha256" && (a as Record<string, unknown>).acknowledgeTestChanges === true
  && typeof (a as Record<string, unknown>).testSurfaceSha256 === "string" && SHA256.test((a as Record<string, string>).testSurfaceSha256);

// Kanıt run.headSha'ya bağlıdır: REPORT (CLEAN) + CLEAN REVIEW + BLOCKED olmayan SECURITY_REPORT, hepsi commitSha === run.headSha. Run AWAITING_APPROVAL olmalıdır.
// REL-FX c4: acknowledgement verilmişse (gerekli olsun olmasın) mevcut TEST_SURFACE kanıt logunun sha256'sıyla birebir eşleşmelidir; bayat/eşleşmeyen onay 409'dur.
// Tespit edilen zayıflatma (BLOCKED) onayla da açılmaz (S3).
export function completionEvidence(run: WorkRun | undefined, evidence: readonly RunEvidence[] = run?.evidence ?? [], acknowledgement?: unknown): CompletionCheck {
  if (!run) return {ok: false, reason: "COMPLETION_NO_RUN"};
  if (run.status !== "AWAITING_APPROVAL") return {ok: false, reason: "COMPLETION_RUN_NOT_AWAITING_APPROVAL"};
  const head = run.headSha;
  if (!head || !SHA.test(head)) return {ok: false, reason: "COMPLETION_HEAD_SHA_MISSING"};
  const rs = reviewAndSecurityFor(head, evidence);
  if (!rs.ok) return {ok: false, reason: rs.reason === "REVIEW_EVIDENCE_MISSING" ? "COMPLETION_REVIEW_EVIDENCE_MISSING" : "COMPLETION_SECURITY_EVIDENCE_MISSING"};
  const report = latest(evidence, e => e.kind === "REPORT" && e.commitSha === head);
  if (!report || report.exitCode !== 0 || report.verdict !== "CLEAN") return {ok: false, reason: "COMPLETION_REPORT_EVIDENCE_MISSING"};
  const fa = functionalAcceptanceOf(head, evidence)[0];
  if (fa === "BLOCKED") return {ok: false, reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"};
  const refs: CompletionEvidenceRefs = {headSha: head, reportEvidenceId: report.evidenceId, reviewEvidenceId: rs.review.evidenceId, securityEvidenceId: rs.security.evidenceId};
  const tc = testChangesRequirement(head, evidence);
  if (acknowledgement !== undefined && (!isAckInput(acknowledgement) || tc.testSurfaceSha256 === null || acknowledgement.testSurfaceSha256 !== tc.testSurfaceSha256))
    return {ok: false, reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};
  if (!tc.required) return {ok: true, refs};
  if (acknowledgement === undefined || !tc.evidence || tc.testSurfaceSha256 === null) return {ok: false, reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};
  return {ok: true, refs: {...refs, testChangesAcknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tc.testSurfaceSha256, testSurfaceEvidenceId: tc.evidence.evidenceId, changed: tc.changed, functionalAcceptance: fa}}};
}

// //TR: REL-FX-2: işlevsel kabul run.headSha için en son TEST_SURFACE kanıtından okunur (BLOCKED / UNVERIFIED_VACUOUS / UNVERIFIED_ORACLE / UNKNOWN); kanıt yoksa
// dürüstçe UNKNOWN'dır. Mission'a sabitlenmiş bağımsız oracle bu dilimde olmadığı için VERIFIED asla üretilmez.
function functionalAcceptanceOf(head: string | null, evidence: readonly RunEvidence[]): [OutcomeState, string] {
  const ts = head ? latest(evidence, e => e.kind === "TEST_SURFACE" && e.commitSha === head && !!e.testSurface) : undefined;
  if (!ts?.testSurface) return ["UNKNOWN", "NO_TEST_SURFACE_EVIDENCE"];
  return [ts.testSurface.functionalAcceptance, ts.testSurface.reason];
}

// Saf okuma modeli: yalnız run kaydı ve kanıt listesinden türetilir; yan etkisi yoktur, journal'a yazmaz.
export function deriveOutcomes(run: WorkRun, evidence: readonly RunEvidence[] = run.evidence): RunOutcomes {
  const head = run.headSha && SHA.test(run.headSha) ? run.headSha : null;
  const reasons = {} as RunOutcomes["reasons"];
  const set = <K extends keyof RunOutcomes["reasons"]>(k: K, v: [OutcomeState, string]): OutcomeState => { reasons[k] = v[1]; return v[0]; };

  const report = head ? latest(evidence, e => e.kind === "REPORT" && e.commitSha === head && e.exitCode === 0) : undefined;
  const implemented = evidence.some(e => e.kind === "IMPLEMENT");
  const execution = set("execution",
    run.status === "SUCCEEDED" || (report && run.status === "AWAITING_APPROVAL") ? ["VERIFIED", "REPORT_EVIDENCE_FOR_HEAD"]
    : run.status === "FAILED" || run.status === "RECOVERY_FAILED" ? ["FAILED", run.status]
    : run.status === "BLOCKED" || run.status === "QUARANTINED" ? ["BLOCKED", run.status]
    : run.status === "CANCELLED" ? (implemented ? ["UNKNOWN", "CANCELLED_AFTER_IMPLEMENT"] : ["NOT_EXECUTED", "CANCELLED"])
    : !implemented ? ["NOT_EXECUTED", "NO_IMPLEMENT_EVIDENCE"] : ["UNKNOWN", "RUN_IN_PROGRESS"]);

  const functionalAcceptance = set("functionalAcceptance", functionalAcceptanceOf(head, evidence));

  const secHead = head ? latest(evidence, e => e.kind === "SECURITY_REPORT" && e.commitSha === head) : undefined;
  const secAny = latest(evidence, e => e.kind === "SECURITY_REPORT");
  const st = secHead?.security?.status;
  const security = set("security",
    st === "PASSED" ? ["VERIFIED", "SECURITY_PASSED"] : st === "PARTIAL" ? ["DEGRADED", "SECURITY_COVERAGE_PARTIAL"] : st === "BLOCKED" ? ["BLOCKED", secHead?.security?.blockReason ?? "SECURITY_BLOCKED"]
    : secAny ? ["STALE", "SECURITY_EVIDENCE_FOR_OTHER_COMMIT"] : ["NOT_EXECUTED", "NO_SECURITY_EVIDENCE"]);

  // B10A kanıt indeksi bağımsız olarak doğrulanana kadar bütünlük bilinmiyor kabul edilir.
  const evidenceIntegrity = set("evidenceIntegrity", ["UNKNOWN", "EVIDENCE_INDEX_NOT_VERIFIED"]);

  const recoveries = evidence.filter(e => e.kind === "RECOVERY");
  const recovery = set("recovery",
    run.status === "RECOVERY_FAILED" ? ["FAILED", run.reason?.startsWith("RECOVERY_BUDGET_EXHAUSTED") ? "RECOVERY_BUDGET_EXHAUSTED" : "RECOVERY_FAILED"]
    : recoveries.length === 0 ? ["NOT_APPLICABLE", "NO_RECOVERY_NEEDED"]
    : recoveries.every(e => e.exitCode === 0) ? ["VERIFIED", "RECOVERED_FROM_CHECKPOINT"] : ["FAILED", "RECOVERY_PROBLEMS"]);

  // Runner hiçbir merge/push/release yapmaz; teslim Founder'dadır.
  const release = set("release", ["NOT_EXECUTED", run.status === "SUCCEEDED" ? "ACCEPTED_NOT_RELEASED" : "DELIVERY_DECISION_PENDING_FOUNDER"]);
  const customerOutcome = set("customerOutcome", ["UNKNOWN", "NO_CUSTOMER_SIGNAL"]);

  const completionMode: CompletionMode = run.status !== "SUCCEEDED" ? "NOT_COMPLETED" : run.completion?.testChangesAcknowledgement ? "ACKNOWLEDGED_TEST_CHANGES" : "EVIDENCE_GUARD";
  return {schemaVersion: 1, runId: run.runId, headSha: head, completionMode, execution, functionalAcceptance, security, evidenceIntegrity, recovery, release, customerOutcome, reasons};
}
