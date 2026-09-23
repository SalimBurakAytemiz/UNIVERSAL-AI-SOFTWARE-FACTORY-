// //TR: Bu dosya bütün build/audit/test/security/operate görevleri için ortak Mission, DataClass ve lifecycle TypeScript tiplerini tanımlar.
export type DataClass =
  | "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "PII" | "FINANCIAL" | "SECRET";

export type MissionStatus =
  | "DRAFT" | "PREFLIGHT" | "AUTHORIZED" | "PLANNED" | "EXECUTING" | "VERIFYING"
  | "REVIEWING" | "REMEDIATING" | "REGRESSION" | "REPORTING" | "COMPLETE"
  | "BLOCKED" | "FOUNDER_ATTENTION_REQUIRED";

export interface Mission {
  id: string;
  type: string;
  objective: string;
  environment: string;
  dataClassification: DataClass;
  authorization: { verified: boolean; provenance?: string };
  scope: { targets: string[]; exclusions?: string[] };
  status: MissionStatus;
  stopConditions?: string[];
}
