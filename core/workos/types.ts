// //TR: Bu dosya kullanıcı işi için Work OS varlıklarını (Project, Mission, Task, Run), journal kayıt biçimini ve hata kodlarını tanımlar; tek kanonik store şemasının tip sözleşmesidir.
import type {MissionStatus} from "../mission/types.js";
import type {TestSurfaceSummary} from "./test-surface.js";

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED";
export interface Scope { tenantId: string }
export interface Project {
  projectId: string; orgId: string; tenantId: string; customerId?: string; name: string;
  repository?: { path?: string; url?: string; managed?: boolean }; environmentId: string; createdAt: string; createdBy: string;
  // B3a: doğrulama komutu yalnız argv dizisidir (shell string değil); çalıştırılabilir dosya runner allowlist'inde olmalıdır.
  testCommand?: string[];
  // PS-1A Project Studio: aynı Project kaydının isteğe bağlı alanları (ikinci store yok). managed=true ise repository.path <dataDir>/projects/<id>/repo yönetilen deposudur.
  template?: ProjectTemplate; projectType?: ProjectType; techStack?: string[]; targetOS?: string[]; acceptanceCriteria?: string[];
  budget?: { maxRuns?: number; maxTokens?: number }; devCommand?: string[];
}
export type ProjectTemplate = "web-node" | "node-lib" | "empty";
export type ProjectType = "web" | "api" | "library" | "cli" | "desktop" | "mobile" | "native" | "other";
// PS-1A export kaydı: journal'daki kanıt öğesi (mutlak yol yok; file dataDir'e görelidir).
export interface ProjectExport {
  exportId: string; projectId: string; tenantId: string; commit: string; sha256: string; size: number; file: string; createdAt: string; createdBy: string;
  runId: string | null; contents: { readme: boolean; testReport: boolean; securityReport: boolean; runReport: boolean };
  secretScan: { scanner: "builtin"; status: "CLEAN"; entriesScanned: number };
}
export interface WorkMission {
  missionId: string; projectId: string; tenantId: string; title: string; objective: string;
  acceptanceCriteria: string[]; riskLevel: RiskLevel; status: MissionStatus; createdAt: string; createdBy: string; traceId: string;
  testCommand?: string[];
}
export interface WorkTask {
  taskId: string; missionId: string; projectId: string; tenantId: string; title: string; status: TaskStatus; dependsOn: string[];
}
export type JournalType = "PROJECT_CREATED" | "MISSION_CREATED" | "TASK_CREATED" | "MISSION_TRANSITIONED"
  | "RUN_CREATED" | "RUN_LEASE" | "RUN_TRANSITION" | "RUN_CHECKPOINT" | "RUN_EVIDENCE"
  | "PROJECT_REPOSITORY_SET" | "PROJECT_EXPORT_RECORDED";
export interface JournalEntry {
  seq: number; prevHash: string; hash: string; type: JournalType; actor: string; at: string; payload: Record<string, unknown>;
}
export type WorkOsErrorCode =
  | "WORKOS_JOURNAL_TAMPERED" | "WORKOS_NOT_FOUND" | "WORKOS_INVALID_INPUT" | "WORKOS_INVALID_TRANSITION"
  | "WORKOS_UNAVAILABLE" | "WORKOS_IDEMPOTENCY_CONFLICT" | "WORKOS_CONFLICT" | "WORKOS_LEASE_FENCED"
  // REL-FX-4: TORN_TAIL salt-okunur modu ve append sırasında disk dolu (yarım satır bırakılmaz).
  | "WORKOS_READ_ONLY" | "WORKOS_DISK_FULL";
export class WorkOsError extends Error {
  readonly code: WorkOsErrorCode;
  constructor(code: WorkOsErrorCode, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.code = code; this.name = "WorkOsError"; }
}

// //TR: F-B1-004: repository.url içinde userinfo (kullanıcı/parola/token) taşınamaz; secret journal'a yazılmaz.
export function urlHasUserinfo(url: string): boolean { return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*@/.test(url) || /^[^\s/@:]+:[^\s/@]+@/.test(url); }

// //TR: B3a mission runner: worker run varlığı aynı Work OS journal içinde yaşar (ikinci store yok). Run durumları Master §06 listesidir; geçişler core/workos/run-state.ts allowlist tablosuyla sınırlıdır.
export type RunStatus =
  | "CREATED" | "QUEUED" | "LEASED" | "RUNNING" | "CHECKPOINTING" | "VERIFYING" | "SUCCEEDED" | "RETRY_SCHEDULED" | "DEGRADED"
  | "HANDOFF_PENDING" | "AWAITING_APPROVAL" | "BLOCKED" | "QUARANTINED" | "CANCELLING" | "CANCELLED" | "RECOVERING" | "RECOVERY_FAILED" | "FAILED";
export type RunStep = "WORKSPACE" | "IMPLEMENT" | "VERIFY" | "SECURITY" | "REVIEW" | "REGRESSION" | "REPORT";
// //TR: B3C güvenlik aşaması sözleşmesi: TOOL_LISTED != INSTALLED != PERMITTED != TESTED (599 §4.3). Araç yoksa dürüst durum yazılır, sahte "geçti" yazılmaz.
export type SecurityToolName = "gitleaks" | "trivy" | "semgrep";
export type SecurityToolStatus = "INSTALLED" | "NOT_INSTALLED" | "ERROR";
export interface SecurityToolInfo { tool: SecurityToolName; status: SecurityToolStatus; path: string | null; version: string | null; sha256: string | null; reason?: string }
export type SecurityStageStatus = "PASSED" | "PARTIAL" | "BLOCKED";
export interface SecurityVulnFinding { package: string; version: string; id: string; severity: string; fixedVersion: string | null; target: string }
export interface SecuritySecretFinding { ruleId: string; file: string; line: number; commit: string }
// B3C-C2-F1: gitleaks iki geçişle çalışır: git geçmişi (varsayılan global yol allowlist'i etkin) + eklenen satırlar akışı (stdin; yol allowlist'i uygulanamaz). SKIPPED: önceki geçiş hatalı olduğu için çalıştırılmadı.
export interface GitleaksPassSummary { status: "CLEAN" | "FINDINGS" | "ERROR" | "SKIPPED"; reason?: string; findings: number; rawReportSha256: string | null }
export interface SecurityStageSummary {
  schemaVersion: 1; status: SecurityStageStatus; blockReason: "SECRET_DETECTED" | "VULNERABLE_DEPENDENCY" | "SECURITY_TOOL_ERROR" | null; baseSha: string; headSha: string; cycle: number;
  secrets: {
    builtin: { status: "CLEAN" | "FINDINGS"; hits: number };
    gitleaks: { status: "CLEAN" | "FINDINGS" | "NOT_INSTALLED" | "ERROR"; reason?: string; findings: number; items: SecuritySecretFinding[]; rawReportSha256: string | null; passes?: { git: GitleaksPassSummary; addedLines: GitleaksPassSummary } };
  };
  sca: {
    status: "CLEAN" | "FINDINGS" | "PARTIAL" | "NOT_INSTALLED" | "ERROR"; reason?: string; dbState?: string; counts: Record<string, number>; blocking: number;
    findings: SecurityVulnFinding[]; truncated: boolean; rawReportSha256: string | null;
  };
  sast: { status: "NOT_AVAILABLE"; reason: string; tool: "semgrep" };
  sbom: { status: "NOT_AVAILABLE"; reason: string };
  gaps: string[]; tools: SecurityToolInfo[]; founderNote: string;
}
export interface RunCheckpoint { step: RunStep; cycle: number; at: string; data: Record<string, unknown> }
export interface SecretHit { kind: string; file: string; line: number }
// Kanıt kaydı: komut argv'si, başlangıç/bitiş, çıkış kodu, log yolu + sha256, üretilen commit, reviewer kimliği/kararı. Env değerleri ve secret içerikleri asla yazılmaz.
export interface RunEvidence {
  evidenceId: string; step: RunStep | "RECOVERY" | "CANCEL"; cycle: number; kind: string; argv: string[];
  startedAt: string; endedAt: string; exitCode: number | null; timedOut?: boolean;
  logPath: string | null; logSha256: string | null; baseSha?: string; commitSha?: string;
  executorIdentity?: string; reviewerIdentity?: string; verdict?: "CLEAN" | "BLOCKED"; findingsCount?: number; secretHits?: SecretHit[]; note?: string;
  // B3C: yalnız SECURITY_REPORT kanıtında; redakte edilmiş güvenlik aşaması özeti (secret değeri asla içermez).
  security?: SecurityStageSummary;
  // REL-FX-2: yalnız TEST_SURFACE kanıtında; base..head test yüzeyi sınıflaması ve functionalAcceptance durumu (dosya içeriği yazılmaz).
  testSurface?: TestSurfaceSummary;
}
export interface WorkRun {
  runId: string; missionId: string; projectId: string; tenantId: string; roleId: string | null;
  executor: { implementer: string; reviewer: string };
  leaseId: string | null; leaseExpiresAt: string | null; attempt: number; status: RunStatus; step: RunStep;
  remediationCycle: number; retryCount: number; retryAt: string | null; reason: string | null;
  baseSha: string | null; headSha: string | null; workBranch: string | null;
  checkpoints: RunCheckpoint[]; evidence: RunEvidence[]; createdAt: string; createdBy: string; updatedAt: string;
}
