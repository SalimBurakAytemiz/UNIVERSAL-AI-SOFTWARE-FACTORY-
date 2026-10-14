// //TR: Bu dosya kullanıcı işi için Work OS varlıklarını (Project, Mission, Task), journal kayıt biçimini ve hata kodlarını tanımlar; tek kanonik store şemasının tip sözleşmesidir.
import type {MissionStatus} from "../mission/types.js";

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED";
export interface Scope { tenantId: string }
export interface Project {
  projectId: string; orgId: string; tenantId: string; customerId?: string; name: string;
  repository?: { path?: string; url?: string }; environmentId: string; createdAt: string; createdBy: string;
}
export interface WorkMission {
  missionId: string; projectId: string; tenantId: string; title: string; objective: string;
  acceptanceCriteria: string[]; riskLevel: RiskLevel; status: MissionStatus; createdAt: string; createdBy: string; traceId: string;
}
export interface WorkTask {
  taskId: string; missionId: string; projectId: string; tenantId: string; title: string; status: TaskStatus; dependsOn: string[];
}
export type JournalType = "PROJECT_CREATED" | "MISSION_CREATED" | "TASK_CREATED" | "MISSION_TRANSITIONED";
export interface JournalEntry {
  seq: number; prevHash: string; hash: string; type: JournalType; actor: string; at: string; payload: Record<string, unknown>;
}
export type WorkOsErrorCode =
  | "WORKOS_JOURNAL_TAMPERED" | "WORKOS_NOT_FOUND" | "WORKOS_INVALID_INPUT" | "WORKOS_INVALID_TRANSITION"
  | "WORKOS_UNAVAILABLE" | "WORKOS_IDEMPOTENCY_CONFLICT";
export class WorkOsError extends Error {
  readonly code: WorkOsErrorCode;
  constructor(code: WorkOsErrorCode, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.code = code; this.name = "WorkOsError"; }
}

// //TR: F-B1-004: repository.url içinde userinfo (kullanıcı/parola/token) taşınamaz; secret journal'a yazılmaz.
export function urlHasUserinfo(url: string): boolean { return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*@/.test(url) || /^[^\s/@:]+:[^\s/@]+@/.test(url); }
