// //TR: Bu dosya Mission lifecycle geçişlerini allowlist ile sınırlar ve DRAFT'tan doğrudan COMPLETE gibi kanıtsız/sahte atlamaları engeller.
import type { MissionStatus } from "./types.js";

const transitions: Record<MissionStatus, MissionStatus[]> = {
  DRAFT: ["PREFLIGHT","BLOCKED"],
  PREFLIGHT: ["AUTHORIZED","BLOCKED","FOUNDER_ATTENTION_REQUIRED"],
  AUTHORIZED: ["PLANNED","BLOCKED"],
  PLANNED: ["EXECUTING","BLOCKED"],
  EXECUTING: ["VERIFYING","BLOCKED","FOUNDER_ATTENTION_REQUIRED"],
  VERIFYING: ["REVIEWING","REMEDIATING","BLOCKED"],
  REVIEWING: ["REMEDIATING","REGRESSION","BLOCKED","FOUNDER_ATTENTION_REQUIRED"],
  REMEDIATING: ["VERIFYING","BLOCKED","FOUNDER_ATTENTION_REQUIRED"],
  REGRESSION: ["REPORTING","REMEDIATING","BLOCKED"],
  REPORTING: ["COMPLETE","BLOCKED"],
  COMPLETE: [],
  BLOCKED: ["PREFLIGHT","FOUNDER_ATTENTION_REQUIRED"],
  FOUNDER_ATTENTION_REQUIRED: ["PREFLIGHT","BLOCKED"]
};

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return transitions[from].includes(to);
}
export function assertTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransition(from,to)) throw new Error(`Invalid mission transition: ${from} -> ${to}`);
}
