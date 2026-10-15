// //TR: Bu dosya REL-FX-1 kanıta bağlı tamamlama yüklemini (runner REPORT adımıyla aynı yüklem) ve saf deriveOutcomes(run, evidence) okuma modelini tanımlar; kanıt yoksa sonuç dürüstçe NOT_EXECUTED/UNKNOWN olur, hiçbir alan tahminle VERIFIED yazılmaz. M1a c2: kaynak üretimi (SOURCE_GENERATION_COMPLETE) ve ürün doğrulaması (PRODUCT_VERIFIED) iki ayrı eksendir; teslim artefaktı ve NOT_VERIFIED kaynak teslimi kabulü kapıları buradadır. Yeni store veya servis yoktur (REL-216).
import type {DeliveryArtifactRecord, RunCompletionRecord, RunEvidence, SecurityStageSummary, SourceDeliveryAcceptance, TestChangesAcknowledgement, WorkRun} from "./types.js";

// Doc 3.4 durum sözlüğü (+ FX-2 oracle durumları). PARTIAL güvenlik kapsamı DEGRADED olarak gösterilir.
export type OutcomeState = "VERIFIED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_EXECUTED" | "STALE" | "DEGRADED" | "NOT_APPLICABLE" | "UNVERIFIED_ORACLE" | "UNVERIFIED_VACUOUS";
// //TR: Tamamlama biçimi (D-M1A-STATE-MODEL-2026-10-15): EVIDENCE_GUARD = FX-1 kanıtı + productVerification === PRODUCT_VERIFIED. Cycle-1'in NOT_EXECUTED_ACKNOWLEDGED ve REL-FX c4'ün
// ACKNOWLEDGED_TEST_CHANGES tamamlama yolları kaldırıldı: hiçbir onay COMPLETE üretmez veya test kanıtının yerine geçmez.
export type CompletionMode = "NOT_COMPLETED" | "EVIDENCE_GUARD";

// //TR: M1a c2 (D-M1A-STATE-MODEL-2026-10-15): iki bağımsız eksen, yalnız kanıttan türetilir ve kesinlikle ayrıdır. Kaynak üretimi (SOURCE_GENERATION_COMPLETE) ürünün çalıştığını
// ASLA söylemez; ürün doğrulaması (PRODUCT_VERIFIED) yalnız doğrulanmış sandbox içinde gerçekten yürütülmüş testlerden gelir (M1a'da sağlayıcı olmadığından erişilemez).
export type SourceGenerationState = "NOT_STARTED" | "IN_PROGRESS" | "SOURCE_GENERATION_COMPLETE" | "BLOCKED" | "FAILED";
export type ProductVerificationState = "NOT_VERIFIED" | "PRODUCT_VERIFIED" | "FAILED";
// Founder'ın istediği birebir etiketler (API sonuçları, masaüstü, VERIFICATION_STATUS, teslim README'si).
export const M1A_LABELS = {
  SOURCE_GENERATION_COMPLETE: "SOURCE_GENERATION_COMPLETE — Kaynak kod üretildi",
  NOT_VERIFIED_SANDBOX: "NOT_VERIFIED — Ürün doğrulanmadı (testler çalıştırılmadı: sandbox yok)",
  SOURCE_DELIVERY_ACCEPTED: "Kaynak teslimi kabul edildi — ürün DOĞRULANMADI",
  NO_RUN_NOT_VERIFIED: "NO_RUN/NOT_VERIFIED — Proje dışa aktarımı; bir koşu teslimi değildir, ürün doğrulanmadı"
} as const;
const SOURCE_LABELS: Record<SourceGenerationState, string> = {
  NOT_STARTED: "NOT_STARTED — Kaynak kod üretimi başlamadı", IN_PROGRESS: "IN_PROGRESS — Kaynak kod üretimi sürüyor",
  SOURCE_GENERATION_COMPLETE: M1A_LABELS.SOURCE_GENERATION_COMPLETE, BLOCKED: "BLOCKED — Kaynak kod üretimi engellendi", FAILED: "FAILED — Kaynak kod üretimi başarısız"
};
export function productVerificationLabel(state: ProductVerificationState, reason: string): string {
  if (state === "PRODUCT_VERIFIED") return "PRODUCT_VERIFIED — Ürün doğrulandı (testler doğrulanmış sandbox içinde çalıştı ve geçti)";
  if (state === "FAILED") return "FAILED — Ürün doğrulaması başarısız (testler başarısız)";
  return reason === "NOT_EXECUTED:SANDBOX_UNAVAILABLE" ? M1A_LABELS.NOT_VERIFIED_SANDBOX : "NOT_VERIFIED — Ürün doğrulanmadı";
}
export interface SourceGenerationRefs { implementEvidenceId: string; securityEvidenceId: string; reviewEvidenceId: string; reportEvidenceId: string }
export interface SourceGeneration { state: SourceGenerationState; reason: string; label: string; refs: SourceGenerationRefs | null }
export interface ProductVerificationRefs { verifyEvidenceId: string; regressionEvidenceId: string; testSurfaceEvidenceId: string }
export interface ProductVerification { state: ProductVerificationState; reason: string; label: string; refs: ProductVerificationRefs | null }
export type SourceDeliveryState = "NOT_PREPARED" | "ARTIFACT_PREPARED" | "SOURCE_DELIVERY_ACCEPTED";
export interface SourceDeliveryView { state: SourceDeliveryState; label: string | null; exportArtifactHash: string | null; sourceCommit: string | null }
export interface RunOutcomes {
  schemaVersion: 1; runId: string; headSha: string | null; completionMode: CompletionMode;
  execution: OutcomeState; functionalAcceptance: OutcomeState; security: OutcomeState; evidenceIntegrity: OutcomeState;
  recovery: OutcomeState; release: OutcomeState; customerOutcome: OutcomeState;
  // Her alan için sabit, yol/secret içermeyen sebep kodu.
  reasons: Record<"execution" | "functionalAcceptance" | "security" | "evidenceIntegrity" | "recovery" | "release" | "customerOutcome", string>;
  // M1a c2: iki bağımsız eksen + kaynak teslimi durumu (yalnız kanıt/journal'dan türetilir).
  sourceGeneration: SourceGeneration; productVerification: ProductVerification; sourceDelivery: SourceDeliveryView;
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
  | "COMPLETION_SECURITY_EVIDENCE_MISSING" | "COMPLETION_REPORT_EVIDENCE_MISSING" | "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED" | "COMPLETION_PRODUCT_NOT_VERIFIED";
export type CompletionEvidenceRefs = RunCompletionRecord;
export type CompletionCheck = {ok: true; refs: CompletionEvidenceRefs} | {ok: false; reason: CompletionRefusal};
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// //TR: REL-FX c4 (S1/S4): run.headSha için en son TEST_SURFACE kanıtında mevcut (base'de var olan) bir test dosyası değişti/silindi/yeniden adlandırıldıysa veya
// herhangi bir harness/yapılandırma değişikliği varsa açık test-değişikliği onayı gerekir. M1a c2: bu onay yalnız NOT_VERIFIED kaynak teslimi kabulünde geçerlidir; böyle bir run
// PRODUCT_VERIFIED olamaz (onay test kanıtının yerine geçmez), dolayısıyla COMPLETE de olamaz. Yalnız yeni eklenen test dosyaları onay istemez (UNVERIFIED_ORACLE kalır).
// Metin desenli devre dışı test dedektörü yalnız risk sinyalidir; garanti bu yapısal kuraldır.
export interface TestChangesRequirement { required: boolean; evidence: RunEvidence | null; testSurfaceSha256: string | null; changed: TestChangesAcknowledgement["changed"] }
export function testChangesRequirement(head: string | null, evidence: readonly RunEvidence[]): TestChangesRequirement {
  const ev = head ? latest(evidence, e => e.kind === "TEST_SURFACE" && e.commitSha === head && !!e.testSurface) : undefined;
  const t = ev?.testSurface;
  const changed = {modified: [...(t?.modified ?? [])], deleted: [...(t?.deleted ?? [])], renamed: (t?.renamed ?? []).map(r => ({from: r.from, to: r.to})), harness: [...(t?.harness ?? [])], truncated: t?.truncated === true};
  const required = !!t && (changed.modified.length + changed.deleted.length + changed.renamed.length + changed.harness.length > 0 || t.weakened.length > 0);
  return {required, evidence: ev ?? null, testSurfaceSha256: ev && typeof ev.logSha256 === "string" && SHA256.test(ev.logSha256) ? ev.logSha256 : null, changed};
}
// M1a: run.headSha için sandbox yokluğundan yazılmış NOT_EXECUTED test kanıtları (VERIFY/REGRESSION).
const notExecutedEvidence = (head: string | null, evidence: readonly RunEvidence[]): RunEvidence[] =>
  head ? evidence.filter(e => (e.kind === "VERIFY_TESTS_NOT_EXECUTED" || e.kind === "REGRESSION_TESTS_NOT_EXECUTED") && e.commitSha === head) : [];
const testsExecutedFor = (head: string | null, ev: readonly RunEvidence[]): boolean => !!head && ev.some(e => (e.kind === "VERIFY_TESTS" || e.kind === "REGRESSION_TESTS") && e.commitSha === head);
const isPlainObj = (a: unknown): a is Record<string, unknown> => typeof a === "object" && a !== null && !Array.isArray(a);
const isTestChangesAckInput = (a: unknown): a is {acknowledgeTestChanges: true; testSurfaceSha256: string} => isPlainObj(a)
  && Object.keys(a).sort().join(",") === "acknowledgeTestChanges,testSurfaceSha256" && a.acknowledgeTestChanges === true
  && typeof a.testSurfaceSha256 === "string" && SHA256.test(a.testSurfaceSha256);

// //TR: M1a c2: doğrulanmış sandbox tanığı. Runner yalnız SBX kapısı izin verdiğinde VERIFY_TESTS/REGRESSION_TESTS yazar ve kapı kararındaki providerId'yi sandboxProviderId olarak kaydeder;
// tanıksız test kanıtı (ör. SBX kapısından önceki ana makine koşuları) ürün doğrulaması sayılmaz.
const sandboxAttested = (e: RunEvidence): boolean => typeof e.sandboxProviderId === "string" && /^[A-Za-z0-9._:@/-]{1,200}$/.test(e.sandboxProviderId);
// //TR: Ürün doğrulaması (yalnız kanıttan): run.headSha için VERIFY_TESTS ve REGRESSION_TESTS doğrulanmış sandbox içinde gerçekten yürütülmüş (tanıklı), ikisi de exit 0, TEST_SURFACE'te
// yürütülen test sayısı > 0, BLOCKED test yüzeyi yok ve onay gerektiren (mevcut test/harness) değişiklik yok. Aksi halde NOT_VERIFIED (+ sebep) veya testler başarısızsa FAILED.
// M1a'da sağlayıcı olmadığından PRODUCT_VERIFIED erişilemez; hiçbir onay bu sonucu üretemez veya yerine geçemez (fonksiyon onay girdisi almaz).
export function productVerificationOf(head: string | null, evidence: readonly RunEvidence[]): ProductVerification {
  const pv = (state: ProductVerificationState, reason: string, refs: ProductVerificationRefs | null = null): ProductVerification => ({state, reason, label: productVerificationLabel(state, reason), refs});
  if (!head || !SHA.test(head)) return pv("NOT_VERIFIED", "NOT_EXECUTED:NO_HEAD_COMMIT");
  const ts = latest(evidence, e => e.kind === "TEST_SURFACE" && e.commitSha === head && !!e.testSurface);
  if (ts?.testSurface?.functionalAcceptance === "BLOCKED") return pv("NOT_VERIFIED", `TEST_SURFACE_BLOCKED:${ts.testSurface.reason}`.slice(0, 120));
  if (notExecutedEvidence(head, evidence).length) return pv("NOT_VERIFIED", "NOT_EXECUTED:SANDBOX_UNAVAILABLE");
  const v = latest(evidence, e => e.kind === "VERIFY_TESTS" && e.commitSha === head), g = latest(evidence, e => e.kind === "REGRESSION_TESTS" && e.commitSha === head);
  if ((v && v.exitCode !== 0) || (g && g.exitCode !== 0)) return pv("FAILED", "TESTS_FAILED");
  if (!v || !g) return pv("NOT_VERIFIED", "NOT_EXECUTED:TESTS_NOT_REACHED");
  if (!sandboxAttested(v) || !sandboxAttested(g)) return pv("NOT_VERIFIED", "SANDBOX_ATTESTATION_MISSING");
  const n = ts?.testSurface?.executedTests;
  if (!ts || typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) return pv("NOT_VERIFIED", n === 0 ? "ZERO_TESTS_EXECUTED" : "EXECUTED_TEST_COUNT_UNKNOWN");
  if (testChangesRequirement(head, evidence).required) return pv("NOT_VERIFIED", "TEST_CHANGES_REQUIRE_INDEPENDENT_VERIFICATION");
  return pv("PRODUCT_VERIFIED", "TESTS_EXECUTED_IN_VERIFIED_SANDBOX", {verifyEvidenceId: v.evidenceId, regressionEvidenceId: g.evidenceId, testSurfaceEvidenceId: ts.evidenceId});
}
// //TR: Kaynak üretimi (yalnız kanıttan): SOURCE_GENERATION_COMPLETE = run.headSha'da run tabanından (baseSha) FARKLI bir builder commit'i (IMPLEMENT kanıtı; şablon değil gerçek üretilmiş çıktı)
// + BLOCKED olmayan statik SECURITY_REPORT + CLEAN bağımsız REVIEW + CLEAN REPORT, hepsi run.headSha'ya bağlı; run Founder kararında (AWAITING_APPROVAL) veya kabul edilmiş (SUCCEEDED).
// Silinen/zayıflatılan test (BLOCKED test yüzeyi) kaynak teslimini de engeller (REL-FX S3 korunur). Ağaç düzeyindeki "şablonla aynı" denetimi teslim hazırlığında git ile yapılır (NO_GENERATED_SOURCE).
const NOT_STARTED_STATUSES = new Set(["CREATED", "QUEUED", "LEASED"]);
export function sourceGenerationOf(run: WorkRun, evidence: readonly RunEvidence[] = run.evidence): SourceGeneration {
  const sg = (state: SourceGenerationState, reason: string, refs: SourceGenerationRefs | null = null): SourceGeneration => ({state, reason: reason.slice(0, 120), label: SOURCE_LABELS[state], refs});
  const st = run.status, why = run.reason ?? st;
  if (st === "FAILED" || st === "RECOVERY_FAILED" || st === "CANCELLED") return sg("FAILED", why);
  if (st === "BLOCKED" || st === "QUARANTINED") return sg("BLOCKED", why);
  if (st !== "AWAITING_APPROVAL" && st !== "SUCCEEDED") return NOT_STARTED_STATUSES.has(st) && !evidence.some(e => e.kind === "IMPLEMENT") ? sg("NOT_STARTED", st) : sg("IN_PROGRESS", st);
  const head = run.headSha;
  if (!head || !SHA.test(head) || !run.baseSha || !SHA.test(run.baseSha)) return sg("BLOCKED", "SOURCE_HEAD_SHA_MISSING");
  if (head === run.baseSha) return sg("BLOCKED", "NO_GENERATED_SOURCE");
  const impl = latest(evidence, e => e.kind === "IMPLEMENT" && e.commitSha === head && e.exitCode === 0);
  if (!impl) return sg("BLOCKED", "BUILDER_COMMIT_EVIDENCE_MISSING");
  const rs = reviewAndSecurityFor(head, evidence);
  if (!rs.ok) return sg("BLOCKED", rs.reason);
  const report = latest(evidence, e => e.kind === "REPORT" && e.commitSha === head);
  if (!report || report.exitCode !== 0 || report.verdict !== "CLEAN") return sg("BLOCKED", "REPORT_EVIDENCE_MISSING");
  const ts = latest(evidence, e => e.kind === "TEST_SURFACE" && e.commitSha === head && !!e.testSurface);
  if (ts?.testSurface?.functionalAcceptance === "BLOCKED") return sg("BLOCKED", `TEST_SURFACE_BLOCKED:${ts.testSurface.reason}`);
  return sg("SOURCE_GENERATION_COMPLETE", "SOURCE_EVIDENCE_FOR_HEAD", {implementEvidenceId: impl.evidenceId, securityEvidenceId: rs.security.evidenceId, reviewEvidenceId: rs.review.evidenceId, reportEvidenceId: report.evidenceId});
}

// Kanıt run.headSha'ya bağlıdır: REPORT (CLEAN) + CLEAN REVIEW + BLOCKED olmayan SECURITY_REPORT, hepsi commitSha === run.headSha. Run AWAITING_APPROVAL olmalıdır.
// Tespit edilen zayıflatma (BLOCKED) açılmaz (S3). D-M1A-STATE-MODEL-2026-10-15: ürün düzeyi COMPLETE ayrıca productVerification === PRODUCT_VERIFIED ister
// (aksi halde 409 COMPLETION_PRODUCT_NOT_VERIFIED). Fonksiyon hiçbir onay girdisi almaz: onay COMPLETE üretemez.
export function completionEvidence(run: WorkRun | undefined, evidence: readonly RunEvidence[] = run?.evidence ?? []): CompletionCheck {
  if (!run) return {ok: false, reason: "COMPLETION_NO_RUN"};
  if (run.status !== "AWAITING_APPROVAL") return {ok: false, reason: "COMPLETION_RUN_NOT_AWAITING_APPROVAL"};
  const head = run.headSha;
  if (!head || !SHA.test(head)) return {ok: false, reason: "COMPLETION_HEAD_SHA_MISSING"};
  const rs = reviewAndSecurityFor(head, evidence);
  if (!rs.ok) return {ok: false, reason: rs.reason === "REVIEW_EVIDENCE_MISSING" ? "COMPLETION_REVIEW_EVIDENCE_MISSING" : "COMPLETION_SECURITY_EVIDENCE_MISSING"};
  const report = latest(evidence, e => e.kind === "REPORT" && e.commitSha === head);
  if (!report || report.exitCode !== 0 || report.verdict !== "CLEAN") return {ok: false, reason: "COMPLETION_REPORT_EVIDENCE_MISSING"};
  if (functionalAcceptanceOf(head, evidence)[0] === "BLOCKED") return {ok: false, reason: "COMPLETION_FUNCTIONAL_ACCEPTANCE_BLOCKED"};
  const pv = productVerificationOf(head, evidence);
  if (pv.state !== "PRODUCT_VERIFIED" || !pv.refs) return {ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"};
  return {ok: true, refs: {headSha: head, reportEvidenceId: report.evidenceId, reviewEvidenceId: rs.review.evidenceId, securityEvidenceId: rs.security.evidenceId, productVerification: {state: "PRODUCT_VERIFIED", ...pv.refs}}};
}

// //TR: M1a c2 teslim artefaktı hazırlığı kapısı (saf kısım): run SOURCE_GENERATION_COMPLETE olmalı ve kaynak kabulü yapılmışsa artefakt değiştirilemez. Ağaç/şablon denetimi git ile studio'dadır.
export type DeliveryPrepareRefusal = "SOURCE_GENERATION_NOT_COMPLETE" | "NO_GENERATED_SOURCE" | "DELIVERY_ALREADY_ACCEPTED";
export function deliveryPrepareCheck(run: WorkRun | undefined): {ok: true; sourceGeneration: SourceGeneration} | {ok: false; reason: DeliveryPrepareRefusal; detail: string} {
  if (!run) return {ok: false, reason: "SOURCE_GENERATION_NOT_COMPLETE", detail: "NO_RUN"};
  const sg = sourceGenerationOf(run);
  if (sg.state !== "SOURCE_GENERATION_COMPLETE") return {ok: false, reason: sg.reason === "NO_GENERATED_SOURCE" ? "NO_GENERATED_SOURCE" : "SOURCE_GENERATION_NOT_COMPLETE", detail: `${sg.state}:${sg.reason}`.slice(0, 160)};
  if (run.sourceDelivery) return {ok: false, reason: "DELIVERY_ALREADY_ACCEPTED", detail: run.sourceDelivery.exportArtifactHash};
  return {ok: true, sourceGeneration: sg};
}
// Kayıt biçimi: artifactPath = deliveries/<runId>/<exportArtifactHash>.zip (dataDir'e göreli; mutlak yol yok).
export const deliveryArtifactPath = (runId: string, hash: string): string => `deliveries/${runId}/${hash}.zip`;
export function validDeliveryArtifactRecord(x: unknown): x is DeliveryArtifactRecord {
  if (!isPlainObj(x) || Object.keys(x).sort().join(",") !== "artifactPath,exportArtifactHash,missionId,runId,sourceCommit,treeSha") return false;
  return typeof x.runId === "string" && /^run_[0-9a-f]{24}$/.test(x.runId) && typeof x.missionId === "string" && /^msn_[0-9a-f]{24}$/.test(x.missionId)
    && typeof x.sourceCommit === "string" && SHA.test(x.sourceCommit) && typeof x.treeSha === "string" && SHA.test(x.treeSha)
    && typeof x.exportArtifactHash === "string" && SHA256.test(x.exportArtifactHash) && x.artifactPath === deliveryArtifactPath(x.runId, x.exportArtifactHash);
}

// //TR: M1a c2 Founder NOT_VERIFIED kaynak teslimi kabulü (Founder koşulu 2): kabul nesnesi birebir {runId, missionId, sourceCommit, exportArtifactHash, acknowledgeNotExecuted: true}
// (+ test/harness değiştiyse birebir testChangesAcknowledgement {acknowledgeTestChanges: true, testSurfaceSha256}). Her alan GÜNCEL DELIVERY_ARTIFACT_PREPARED kaydı ve run ile eşit olmalıdır;
// başka run, başka artefakt, bayat kayıt veya ikinci kullanım reddedilir (409, journal değişmez). Kabul productVerification'ı ASLA değiştirmez ve COMPLETE üretmez.
export type SourceDeliveryRefusal =
  | "DELIVERY_NO_RUN" | "DELIVERY_ACCEPTANCE_INVALID" | "DELIVERY_RUN_NOT_AWAITING_APPROVAL" | "DELIVERY_MISSION_NOT_REPORTING" | "DELIVERY_NOT_LATEST_RUN"
  | "SOURCE_GENERATION_NOT_COMPLETE" | "DELIVERY_PRODUCT_VERIFIED_USE_COMPLETE" | "DELIVERY_ARTIFACT_NOT_PREPARED" | "DELIVERY_ACCEPTANCE_MISMATCH"
  | "DELIVERY_ALREADY_ACCEPTED" | "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT";
export type SourceDeliveryCheck = {ok: true; record: Omit<SourceDeliveryAcceptance, "acceptedAt">} | {ok: false; reason: SourceDeliveryRefusal};
const ACCEPT_KEYS = "acknowledgeNotExecuted,exportArtifactHash,missionId,runId,sourceCommit";
export interface SourceDeliveryContext { run: WorkRun | undefined; missionStatus: string | null; latestRunId: string | null }
export function sourceDeliveryAcceptanceCheck(ctx: SourceDeliveryContext, acceptance: unknown): SourceDeliveryCheck {
  const {run} = ctx;
  if (!run) return {ok: false, reason: "DELIVERY_NO_RUN"};
  if (!isPlainObj(acceptance)) return {ok: false, reason: "DELIVERY_ACCEPTANCE_INVALID"};
  const keys = Object.keys(acceptance).sort().join(","), tcIn = acceptance.testChangesAcknowledgement;
  if (keys !== ACCEPT_KEYS && keys !== `${ACCEPT_KEYS},testChangesAcknowledgement`) return {ok: false, reason: "DELIVERY_ACCEPTANCE_INVALID"};
  if (acceptance.acknowledgeNotExecuted !== true || (tcIn !== undefined && !isTestChangesAckInput(tcIn))) return {ok: false, reason: "DELIVERY_ACCEPTANCE_INVALID"};
  for (const k of ["runId", "missionId", "sourceCommit", "exportArtifactHash"]) if (typeof acceptance[k] !== "string") return {ok: false, reason: "DELIVERY_ACCEPTANCE_INVALID"};
  if (acceptance.runId !== run.runId || acceptance.missionId !== run.missionId) return {ok: false, reason: "DELIVERY_ACCEPTANCE_MISMATCH"};
  if (run.sourceDelivery) return {ok: false, reason: "DELIVERY_ALREADY_ACCEPTED"};
  if (run.status !== "AWAITING_APPROVAL") return {ok: false, reason: "DELIVERY_RUN_NOT_AWAITING_APPROVAL"};
  if (ctx.missionStatus !== "REPORTING") return {ok: false, reason: "DELIVERY_MISSION_NOT_REPORTING"};
  if (ctx.latestRunId !== run.runId) return {ok: false, reason: "DELIVERY_NOT_LATEST_RUN"};
  const sg = sourceGenerationOf(run);
  if (sg.state !== "SOURCE_GENERATION_COMPLETE" || !run.headSha) return {ok: false, reason: "SOURCE_GENERATION_NOT_COMPLETE"};
  const head = run.headSha, pv = productVerificationOf(head, run.evidence);
  if (pv.state === "PRODUCT_VERIFIED") return {ok: false, reason: "DELIVERY_PRODUCT_VERIFIED_USE_COMPLETE"};
  const rec = run.deliveryArtifact;
  if (!rec) return {ok: false, reason: "DELIVERY_ARTIFACT_NOT_PREPARED"};
  if (rec.runId !== run.runId || rec.missionId !== run.missionId || rec.sourceCommit !== head || acceptance.sourceCommit !== rec.sourceCommit || acceptance.exportArtifactHash !== rec.exportArtifactHash)
    return {ok: false, reason: "DELIVERY_ACCEPTANCE_MISMATCH"};
  const tc = testChangesRequirement(head, run.evidence);
  if (tcIn !== undefined && (!tc.required || tc.testSurfaceSha256 === null || (tcIn as {testSurfaceSha256: string}).testSurfaceSha256 !== tc.testSurfaceSha256)) return {ok: false, reason: "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};
  if (tc.required && (tcIn === undefined || !tc.evidence || tc.testSurfaceSha256 === null)) return {ok: false, reason: "DELIVERY_TEST_CHANGES_REQUIRE_ACKNOWLEDGEMENT"};
  const fa = functionalAcceptanceOf(head, run.evidence)[0];
  return {ok: true, record: {runId: run.runId, missionId: run.missionId, sourceCommit: head, exportArtifactHash: rec.exportArtifactHash, acknowledgements: {
    notExecuted: {acknowledgeNotExecuted: true, productVerification: "NOT_VERIFIED", reason: pv.reason, notExecutedEvidenceIds: notExecutedEvidence(head, run.evidence).map(e => e.evidenceId)},
    ...(tc.required && tc.evidence && tc.testSurfaceSha256 ? {testChanges: {acknowledgeTestChanges: true as const, testSurfaceSha256: tc.testSurfaceSha256, testSurfaceEvidenceId: tc.evidence.evidenceId, changed: tc.changed, functionalAcceptance: fa}} : {})}}};
}
// //TR: Masaüstü teslim akışı için salt-okunur görünüm (kanıttan türetilir; onay üretmez, kapıyı gevşetmez — karar store/route'tadır).
export interface DeliveryView {
  runId: string; missionId: string; projectId: string; status: string; sourceCommit: string | null; sourceGeneration: SourceGeneration; productVerification: ProductVerification; testsExecuted: boolean;
  artifact: DeliveryArtifactRecord | null; accepted: SourceDeliveryAcceptance | null;
  testChanges: {required: boolean; testSurfaceSha256: string | null; changed: TestChangesAcknowledgement["changed"]};
  labels: {sourceGeneration: string; productVerification: string; sourceDelivery: string | null};
}
export function deliveryView(run: WorkRun): DeliveryView {
  const head = run.headSha && SHA.test(run.headSha) ? run.headSha : null;
  const sg = sourceGenerationOf(run), pv = productVerificationOf(head, run.evidence), tc = testChangesRequirement(head, run.evidence);
  return {runId: run.runId, missionId: run.missionId, projectId: run.projectId, status: run.status, sourceCommit: head, sourceGeneration: sg, productVerification: pv, testsExecuted: testsExecutedFor(head, run.evidence),
    artifact: run.deliveryArtifact ?? null, accepted: run.sourceDelivery ?? null, testChanges: {required: tc.required, testSurfaceSha256: tc.testSurfaceSha256, changed: tc.changed},
    labels: {sourceGeneration: sg.label, productVerification: pv.label, sourceDelivery: run.sourceDelivery ? M1A_LABELS.SOURCE_DELIVERY_ACCEPTED : null}};
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

// //TR: M1a c2 teslim artefaktı VERIFICATION_STATUS.json (schemaVersion 2): yalnız kanıttan türetilir; iki eksen ve etiketler ayrı taşınır. Founder kabulü artefaktın İÇİNDE DEĞİLDİR
// (hash kararlı kalır; kabul journal'daki SOURCE_DELIVERY_ACCEPTED kaydıdır). Zaman damgası veya makine yolu içermez.
export const M1A_NOT_VERIFIED_LABEL = M1A_LABELS.NOT_VERIFIED_SANDBOX;
export interface VerificationSecuritySummary { status: string; blockReason: string | null; gaps: string[]; secrets: {builtin: string; gitleaks: string}; sca: string }
const securitySummaryOf = (sec: SecurityStageSummary | undefined): VerificationSecuritySummary | null =>
  sec ? {status: sec.status, blockReason: sec.blockReason, gaps: [...sec.gaps], secrets: {builtin: sec.secrets.builtin.status, gitleaks: sec.secrets.gitleaks.status}, sca: sec.sca.status} : null;
export interface DeliveryVerificationStatus {
  schemaVersion: 2; kind: "RUN_DELIVERY_ARTIFACT"; runId: string; missionId: string; projectId: string; sourceCommit: string; treeSha: string; baseCommit: string;
  sourceGeneration: SourceGenerationState; productVerification: ProductVerificationState; productVerificationReason: string;
  reviewVerdict: "CLEAN"; reviewEvidenceId: string; securitySummary: VerificationSecuritySummary | null; testsExecuted: boolean; notExecutedReason: string | null;
  labels: {sourceGeneration: string; productVerification: string; sourceDeliveryOnAcceptance: string; acceptanceRecord: string};
}
export function deliveryVerificationStatus(run: WorkRun, treeSha: string): DeliveryVerificationStatus {
  const sg = sourceGenerationOf(run);
  if (sg.state !== "SOURCE_GENERATION_COMPLETE" || !sg.refs || !run.headSha || !run.baseSha) throw new Error("SOURCE_GENERATION_NOT_COMPLETE");
  const head = run.headSha, pv = productVerificationOf(head, run.evidence), exec = testsExecutedFor(head, run.evidence), refs = sg.refs;
  const sec = run.evidence.find(e => e.evidenceId === refs.securityEvidenceId)?.security;
  return {schemaVersion: 2, kind: "RUN_DELIVERY_ARTIFACT", runId: run.runId, missionId: run.missionId, projectId: run.projectId, sourceCommit: head, treeSha, baseCommit: run.baseSha,
    sourceGeneration: sg.state, productVerification: pv.state, productVerificationReason: pv.reason, reviewVerdict: "CLEAN", reviewEvidenceId: refs.reviewEvidenceId,
    securitySummary: securitySummaryOf(sec), testsExecuted: exec, notExecutedReason: exec ? null : pv.reason.startsWith("NOT_EXECUTED:") ? pv.reason.slice("NOT_EXECUTED:".length) : null,
    labels: {sourceGeneration: sg.label, productVerification: pv.label, sourceDeliveryOnAcceptance: M1A_LABELS.SOURCE_DELIVERY_ACCEPTED,
      acceptanceRecord: "Founder acceptance is recorded separately in the UASCO journal (SOURCE_DELIVERY_ACCEPTED), never inside this artifact."}};
}
// //TR: Varsayılan proje dışa aktarımı (eski PS-1A yolu) bir koşu teslimi DEĞİLDİR: her zaman NO_RUN/NOT_VERIFIED etiketlenir (üretici koşu bilgisi yalnız bilgilendirmedir).
export interface VerificationStatus {
  schemaVersion: 2; kind: "PROJECT_EXPORT"; runDelivery: "NO_RUN"; producedByRunId: string | null; missionId: string | null; headSha: string;
  productVerification: "NOT_VERIFIED"; functionalAcceptance: OutcomeState; completionMode: CompletionMode;
  testsExecuted: boolean; notExecutedReason: "SANDBOX_UNAVAILABLE" | "TESTS_NOT_REACHED" | "NO_RUN" | null; reviewVerdict: "CLEAN" | "BLOCKED" | null;
  securitySummary: VerificationSecuritySummary | null; label: string;
}
export function verificationStatus(run: WorkRun | null, headSha: string): VerificationStatus {
  const label = M1A_LABELS.NO_RUN_NOT_VERIFIED;
  if (!run || run.headSha !== headSha) return {schemaVersion: 2, kind: "PROJECT_EXPORT", runDelivery: "NO_RUN", producedByRunId: null, missionId: null, headSha, productVerification: "NOT_VERIFIED", functionalAcceptance: "NOT_EXECUTED", completionMode: "NOT_COMPLETED", testsExecuted: false, notExecutedReason: "NO_RUN", reviewVerdict: null, securitySummary: null, label};
  const o = deriveOutcomes(run), ev = run.evidence;
  const testsExecuted = testsExecutedFor(headSha, ev);
  const notExecutedReason = testsExecuted ? null : notExecutedEvidence(headSha, ev).length ? "SANDBOX_UNAVAILABLE" as const : "TESTS_NOT_REACHED" as const;
  const review = latest(ev, e => e.kind === "REVIEW" && e.commitSha === headSha && e.verdict !== undefined);
  return {schemaVersion: 2, kind: "PROJECT_EXPORT", runDelivery: "NO_RUN", producedByRunId: run.runId, missionId: run.missionId, headSha, productVerification: "NOT_VERIFIED",
    functionalAcceptance: o.functionalAcceptance, completionMode: o.completionMode, testsExecuted, notExecutedReason, reviewVerdict: review?.verdict ?? null,
    securitySummary: securitySummaryOf(latest(ev, e => e.kind === "SECURITY_REPORT" && e.commitSha === headSha)?.security), label};
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

  // Runner hiçbir merge/push/release yapmaz; teslim Founder'dadır. Kaynak teslimi kabulü bir release değildir ve ürünü doğrulamaz.
  const release = set("release", ["NOT_EXECUTED", run.status === "SUCCEEDED" ? "ACCEPTED_NOT_RELEASED" : run.sourceDelivery ? "SOURCE_DELIVERY_ACCEPTED_NOT_VERIFIED" : "DELIVERY_DECISION_PENDING_FOUNDER"]);
  const customerOutcome = set("customerOutcome", ["UNKNOWN", "NO_CUSTOMER_SIGNAL"]);

  const completionMode: CompletionMode = run.status === "SUCCEEDED" && run.completion ? "EVIDENCE_GUARD" : "NOT_COMPLETED";
  const sourceGeneration = sourceGenerationOf(run, evidence), productVerification = productVerificationOf(head, evidence);
  const sourceDelivery: SourceDeliveryView = run.sourceDelivery ? {state: "SOURCE_DELIVERY_ACCEPTED", label: M1A_LABELS.SOURCE_DELIVERY_ACCEPTED, exportArtifactHash: run.sourceDelivery.exportArtifactHash, sourceCommit: run.sourceDelivery.sourceCommit}
    : run.deliveryArtifact ? {state: "ARTIFACT_PREPARED", label: null, exportArtifactHash: run.deliveryArtifact.exportArtifactHash, sourceCommit: run.deliveryArtifact.sourceCommit}
    : {state: "NOT_PREPARED", label: null, exportArtifactHash: null, sourceCommit: null};
  return {schemaVersion: 1, runId: run.runId, headSha: head, completionMode, execution, functionalAcceptance, security, evidenceIntegrity, recovery, release, customerOutcome, reasons,
    sourceGeneration, productVerification, sourceDelivery};
}
