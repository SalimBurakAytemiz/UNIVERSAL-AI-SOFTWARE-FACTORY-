// //TR: Bu dosya browser, telefon, VM, cloud slot ve diğer execution kaynaklarının health/capability/lease sözleşmesini tanımlar.
export type ResourceHealth =
  | "UNKNOWN" | "READY" | "DEGRADED" | "QUARANTINED" | "OFFLINE" | "MISSING_TOOL" | "NO_CREDENTIAL";

export interface ExecutionResource {
  id: string;
  kind: string;
  health: ResourceHealth;
  capabilities: string[];
  customerId?: string;
  metadata?: Record<string, unknown>;
}

export interface ResourceLease {
  resourceId: string;
  missionId: string;
  acquiredAt: string;
  expiresAt: string;
}
