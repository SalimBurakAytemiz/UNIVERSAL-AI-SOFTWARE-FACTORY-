// //TR: Bu dosya REL-FX-1 kanıta bağlı tamamlama yüklemini (runner REPORT adımıyla aynı yüklem) ve saf deriveOutcomes(run, evidence) okuma modelini tanımlar; kanıt yoksa sonuç dürüstçe NOT_EXECUTED/UNKNOWN olur, hiçbir alan tahminle VERIFIED yazılmaz. Yeni store veya servis yoktur (REL-216).
import type {NotExecutedAcknowledgement, RunCompletionRecord, RunEvidence, SecurityStageSummary, TestChangesAcknowledgement, WorkRun} from "./types.js";

// Doc 3.4 durum sözlüğü (+ FX-2 oracle durumları). PARTIAL güvenlik kapsamı DEGRADED olarak gösterilir.
export type OutcomeState = "VERIFIED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_EXECUTED" | "STALE" | "DEGRADED" | "NOT_APPLICABLE" | "UNVERIFIED_ORACLE" | "UNVERIFIED_VACUOUS";
// //TR: REL-FX c4 (S2): tamamlama biçimi; ACKNOWLEDGED_TEST_CHANGES Founder'ın mevcut test/harness değişikliklerini açıkça onayladığı kabuldür (her yüzeyde NOT VERIFIED etiketlenir).
// //TR: M1a (D-SBX1-PATH-2026-10-15): NOT_EXECUTED_ACKNOWLEDGED, testleri sandbox yokluğundan hiç çalıştırılmamış bir run'ın Founder'ın açık NOT_EXECUTED onayıyla kabulüdür
// (asla doğrulanmış değildir, her yüzeyde NOT_VERIFIED); mevcut test/harness değişikliği onayıyla birlikteyse NOT_EXECUTED_ACKNOWLEDGED_WITH_TEST_CHANGES.
export type CompletionMode = "NOT_COMPLETED" | "EVIDENCE_GUARD" | "ACKNOWLEDGED_TEST_CHANGES" | "NOT_EXECUTED_ACKNOWLEDGED" | "NOT_EXECUTED_ACKNOWLEDGED_WITH_TEST_CHANGES";
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
  | "COMPLETION_SECURITY_EVIDENCE_MISSING" | "COMPLETION_REPORT_EVIDENCE_MISSING" | "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED" | "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"
  | "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT";
export type CompletionEvidenceRefs = RunCompletionRecord;
// COMPLETE isteğinin açık onay nesnesi: {acknowledgeTestChanges: true, testSurfaceSha256: <TEST_SURFACE kanıt logunun sha256'sı>}.
export interface TestChangesAcknowledgementInput { acknowledgeTestChanges: true; testSurfaceSha256: string }
// M1a: functionalAcceptance NOT_EXECUTED olan run'ın COMPLETE isteğindeki açık onay nesnesi: {acknowledgeNotExecuted: true, headSha: <run.headSha>} (test-değişikliği onayına EK, yerine değil).
export interface NotExecutedAcknowledgementInput { acknowledgeNotExecuted: true; headSha: string }
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
const isNotExecutedAckInput = (a: unknown): a is NotExecutedAcknowledgementInput => typeof a === "object" && a !== null && !Array.isArray(a)
  && Object.keys(a).sort().join(",") === "acknowledgeNotExecuted,headSha" && (a as Record<string, unknown>).acknowledgeNotExecuted === true
  && typeof (a as Record<string, unknown>).headSha === "string" && SHA.test((a as Record<string, string>).headSha);
// M1a: run.headSha için sandbox yokluğundan yazılmış NOT_EXECUTED test kanıtları (VERIFY/REGRESSION).
const notExecutedEvidence = (head: string | null, evidence: readonly RunEvidence[]): RunEvidence[] =>
  head ? evidence.filter(e => (e.kind === "VERIFY_TESTS_NOT_EXECUTED" || e.kind === "REGRESSION_TESTS_NOT_EXECUTED") && e.commitSha === head) : [];
const isAckInput = (a: unknown): a is TestChangesAcknowledgementInput => typeof a === "object" && a !== null && !Array.isArray(a)
  && Object.keys(a).sort().join(",") === "acknowledgeTestChanges,testSurfaceSha256" && (a as Record<string, unknown>).acknowledgeTestChanges === true
  && typeof (a as Record<string, unknown>).testSurfaceSha256 === "string" && SHA256.test((a as Record<string, string>).testSurfaceSha256);

// Kanıt run.headSha'ya bağlıdır: REPORT (CLEAN) + CLEAN REVIEW + BLOCKED olmayan SECURITY_REPORT, hepsi commitSha === run.headSha. Run AWAITING_APPROVAL olmalıdır.
// REL-FX c4: acknowledgement verilmişse (gerekli olsun olmasın) mevcut TEST_SURFACE kanıt logunun sha256'sıyla birebir eşleşmelidir; bayat/eşleşmeyen onay 409'dur.
// Tespit edilen zayıflatma (BLOCKED) onayla da açılmaz (S3).
// M1a (FX-1 genişletmesi, fail-closed): functionalAcceptance NOT_EXECUTED ise notExecutedAcknowledgement {acknowledgeNotExecuted: true, headSha: run.headSha} zorunludur; eksik/bayat/eşleşmeyen
// (veya NOT_EXECUTED olmayan run'a verilen) onay 409 COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT'tır. Test-değişikliği onayı gerekiyorsa o da ayrıca istenir.
export function completionEvidence(run: WorkRun | undefined, evidence: readonly RunEvidence[] = run?.evidence ?? [], acknowledgement?: unknown, notExecutedAcknowledgement?: unknown): CompletionCheck {
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
  // M1a: NOT_EXECUTED onayı yalnız NOT_EXECUTED run için ve yalnız birebir {acknowledgeNotExecuted: true, headSha: run.headSha} biçiminde geçerlidir.
  const notExecuted = fa === "NOT_EXECUTED";
  if (notExecutedAcknowledgement !== undefined ? (!notExecuted || !isNotExecutedAckInput(notExecutedAcknowledgement) || notExecutedAcknowledgement.headSha !== head) : notExecuted)
    return {ok: false, reason: "COMPLETION_NOT_EXECUTED_REQUIRES_ACKNOWLEDGEMENT"};
  const neEv = notExecutedEvidence(head, evidence);
  const neRec: NotExecutedAcknowledgement | undefined = notExecuted
    ? {acknowledgeNotExecuted: true, headSha: head, functionalAcceptance: "NOT_EXECUTED", reason: functionalAcceptanceOf(head, evidence)[1], notExecutedEvidenceIds: neEv.map(e => e.evidenceId)}
    : undefined;
  const tc = testChangesRequirement(head, evidence);
  if (acknowledgement !== undefined && (!isAckInput(acknowledgement) || tc.testSurfaceSha256 === null || acknowledgement.testSurfaceSha256 !== tc.testSurfaceSha256))
    return {ok: false, reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};
  if (!tc.required) return {ok: true, refs: {...refs, ...(neRec ? {notExecutedAcknowledgement: neRec} : {})}};
  if (acknowledgement === undefined || !tc.evidence || tc.testSurfaceSha256 === null) return {ok: false, reason: "COMPLETION_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};
  return {ok: true, refs: {...refs, testChangesAcknowledgement: {acknowledgeTestChanges: true, testSurfaceSha256: tc.testSurfaceSha256, testSurfaceEvidenceId: tc.evidence.evidenceId, changed: tc.changed, functionalAcceptance: fa}, ...(neRec ? {notExecutedAcknowledgement: neRec} : {})}};
}
// //TR: M1a: masaüstünün COMPLETE akışı için salt-okunur gereksinim görünümü (kanıttan türetilir; onay üretmez, kapıyı gevşetmez — karar yine completionEvidence'tadır).
export interface CompletionRequirements {
  headSha: string | null; functionalAcceptance: OutcomeState;
  notExecuted: {required: boolean; reason: string | null};
  testChanges: {required: boolean; testSurfaceSha256: string | null; changed: TestChangesAcknowledgement["changed"]};
}
export function completionRequirements(run: WorkRun, evidence: readonly RunEvidence[] = run.evidence): CompletionRequirements {
  const head = run.headSha && SHA.test(run.headSha) ? run.headSha : null;
  const [fa, why] = functionalAcceptanceOf(head, evidence);
  const tc = testChangesRequirement(head, evidence);
  return {headSha: head, functionalAcceptance: fa, notExecuted: {required: fa === "NOT_EXECUTED", reason: fa === "NOT_EXECUTED" ? why : null},
    testChanges: {required: tc.required, testSurfaceSha256: tc.testSurfaceSha256, changed: tc.changed}};
}

// //TR: REL-FX-2: işlevsel kabul run.headSha için en son TEST_SURFACE kanıtından okunur (BLOCKED / UNVERIFIED_VACUOUS / UNVERIFIED_ORACLE / UNKNOWN); kanıt yoksa
// dürüstçe UNKNOWN'dır. Mission'a sabitlenmiş bağımsız oracle bu dilimde olmadığı için VERIFIED asla üretilmez.
// M1a: silinen/zayıflatılan test (BLOCKED) her zaman önceliklidir; aksi halde run.headSha için VERIFY/REGRESSION NOT_EXECUTED kanıtı varsa durum NOT_EXECUTED'dır
// (TEST_SURFACE başka bir şey söylese veya hiç olmasa bile; asla UNKNOWN-geçti değildir).
function functionalAcceptanceOf(head: string | null, evidence: readonly RunEvidence[]): [OutcomeState, string] {
  const ts = head ? latest(evidence, e => e.kind === "TEST_SURFACE" && e.commitSha === head && !!e.testSurface) : undefined;
  if (ts?.testSurface?.functionalAcceptance === "BLOCKED") return ["BLOCKED", ts.testSurface.reason];
  if (notExecutedEvidence(head, evidence).length) return ["NOT_EXECUTED", "SANDBOX_UNAVAILABLE"];
  if (!ts?.testSurface) return ["UNKNOWN", "NO_TEST_SURFACE_EVIDENCE"];
  return [ts.testSurface.functionalAcceptance, ts.testSurface.reason];
}

// //TR: M1a export/teslim etiketi (VERIFICATION_STATUS.json): yalnız kanıttan türetilir; functionalAcceptance bu dilimde asla VERIFIED olmadığından etiket her zaman NOT_VERIFIED'dır.
// Test yürütmesi kanıtı (VERIFY_TESTS/REGRESSION_TESTS) yoksa testsExecuted=false; neden SANDBOX_UNAVAILABLE (NOT_EXECUTED kanıtı), TESTS_NOT_REACHED (run test adımına gelmedi) veya NO_RUN (commit bir run'a ait değil).
export const M1A_NOT_VERIFIED_LABEL = "NOT_VERIFIED (M1a: tests not executed)";
export interface VerificationSecuritySummary { status: string; blockReason: string | null; gaps: string[]; secrets: {builtin: string; gitleaks: string}; sca: string }
export interface VerificationStatus {
  schemaVersion: 1; runId: string | null; missionId: string | null; headSha: string; functionalAcceptance: OutcomeState; completionMode: CompletionMode;
  testsExecuted: boolean; notExecutedReason: "SANDBOX_UNAVAILABLE" | "TESTS_NOT_REACHED" | "NO_RUN" | null; reviewVerdict: "CLEAN" | "BLOCKED" | null;
  securitySummary: VerificationSecuritySummary | null; label: string;
}
export function verificationStatus(run: WorkRun | null, headSha: string): VerificationStatus {
  if (!run || run.headSha !== headSha) return {schemaVersion: 1, runId: null, missionId: null, headSha, functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "NO_RUN", reviewVerdict: null, securitySummary: null, label: "NOT_VERIFIED"};
  const o = deriveOutcomes(run), ev = run.evidence;
  const testsExecuted = ev.some(e => (e.kind === "VERIFY_TESTS" || e.kind === "REGRESSION_TESTS") && e.commitSha === headSha);
  const notExecutedReason = testsExecuted ? null : notExecutedEvidence(headSha, ev).length ? "SANDBOX_UNAVAILABLE" as const : "TESTS_NOT_REACHED" as const;
  const review = latest(ev, e => e.kind === "REVIEW" && e.commitSha === headSha && e.verdict !== undefined);
  const sec = latest(ev, e => e.kind === "SECURITY_REPORT" && e.commitSha === headSha)?.security;
  return {schemaVersion: 1, runId: run.runId, missionId: run.missionId, headSha, functionalAcceptance: o.functionalAcceptance, completionMode: o.completionMode, testsExecuted, notExecutedReason,
    reviewVerdict: review?.verdict ?? null,
    securitySummary: sec ? {status: sec.status, blockReason: sec.blockReason, gaps: [...sec.gaps], secrets: {builtin: sec.secrets.builtin.status, gitleaks: sec.secrets.gitleaks.status}, sca: sec.sca.status} : null,
    label: notExecutedReason === "SANDBOX_UNAVAILABLE" ? M1A_NOT_VERIFIED_LABEL : "NOT_VERIFIED"};
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

  const c = run.completion;
  const completionMode: CompletionMode = run.status !== "SUCCEEDED" ? "NOT_COMPLETED"
    : c?.notExecutedAcknowledgement ? (c.testChangesAcknowledgement ? "NOT_EXECUTED_ACKNOWLEDGED_WITH_TEST_CHANGES" : "NOT_EXECUTED_ACKNOWLEDGED")
    : c?.testChangesAcknowledgement ? "ACKNOWLEDGED_TEST_CHANGES" : "EVIDENCE_GUARD";
  return {schemaVersion: 1, runId: run.runId, headSha: head, completionMode, execution, functionalAcceptance, security, evidenceIntegrity, recovery, release, customerOutcome, reasons};
}
