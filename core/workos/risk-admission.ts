// //TR: Bu dosya REL-FX-3 run kabul kuralını tanımlar: yalnız mission kaydının riskLevel alanı (R0-R2) run başlatabilir; R3/R4 Founder kararı (D-REL-2) ve OS sandbox olmadan reddedilir. Hedef metni düzeyi düşüremez. V7-PKG-M1A-MODE (RV-INTR4-C1-OBS-1): yürütme bildirimi artık yürütmenin YALNIZ doğrulanmış sandbox içinde olduğunu, ana makinede asla olmadığını ve doğrulanmış sandbox yoksa test ve önizlemenin NOT_EXECUTED (NOT_VERIFIED) olduğunu söyler (FD-REL-1-REJECT-HOST-EXEC-2026-10-15, D-SBX1-PATH-2026-10-15).
import type {RiskLevel} from "./types.js";

export const RISK_REFUSAL = "RISK_REQUIRES_FOUNDER_DECISION_AND_OS_SANDBOX";
export const HOST_ADMITTED_RISK_LEVELS: readonly RiskLevel[] = ["R0", "R1", "R2"];
// Bilinmeyen/eksik değer de reddedilir (fail-closed).
export const riskAdmitted = (level: unknown): boolean => typeof level === "string" && (HOST_ADMITTED_RISK_LEVELS as readonly string[]).includes(level);

export interface HostExecutionNotice {
  code: "EXECUTION_SANDBOX_ONLY"; decision: "FD-REL-1-REJECT-HOST-EXEC-2026-10-15"; decisionStatus: "DECIDED"; hostExecution: "NEVER"; withoutVerifiedSandbox: "NOT_EXECUTED";
  riskLevel: RiskLevel; text: string;
}
export function hostExecutionNotice(riskLevel: RiskLevel): HostExecutionNotice {
  return {code: "EXECUTION_SANDBOX_ONLY", decision: "FD-REL-1-REJECT-HOST-EXEC-2026-10-15", decisionStatus: "DECIDED", hostExecution: "NEVER", withoutVerifiedSandbox: "NOT_EXECUTED", riskLevel,
    text: "Project code (AI-generated code, its tests and the live preview) is executed only inside a verified OS sandbox; host execution never happens on this computer. Without a verified sandbox, tests and preview are NOT_EXECUTED and results are labelled NOT_VERIFIED. R3/R4 missions are refused."};
}
