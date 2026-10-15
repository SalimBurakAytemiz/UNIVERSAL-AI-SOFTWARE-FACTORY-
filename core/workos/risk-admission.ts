// //TR: Bu dosya REL-FX-3 run kabul kuralını tanımlar: yalnız mission kaydının riskLevel alanı (R0-R2) host üzerinde run başlatabilir; R3/R4 Founder kararı (D-REL-2) ve OS sandbox olmadan reddedilir. Hedef metni düzeyi düşüremez. D-REL-1 Founder'da beklerken R0-R2 için geçici host yürütme bildirimi üretilir.
import type {RiskLevel} from "./types.js";

export const RISK_REFUSAL = "RISK_REQUIRES_FOUNDER_DECISION_AND_OS_SANDBOX";
export const HOST_ADMITTED_RISK_LEVELS: readonly RiskLevel[] = ["R0", "R1", "R2"];
// Bilinmeyen/eksik değer de reddedilir (fail-closed).
export const riskAdmitted = (level: unknown): boolean => typeof level === "string" && (HOST_ADMITTED_RISK_LEVELS as readonly string[]).includes(level);

export interface HostExecutionNotice { code: "HOST_EXECUTION_WITHOUT_OS_SANDBOX"; decision: "D-REL-1"; decisionStatus: "PENDING_FOUNDER"; riskLevel: RiskLevel; text: string }
export function hostExecutionNotice(riskLevel: RiskLevel): HostExecutionNotice {
  return {code: "HOST_EXECUTION_WITHOUT_OS_SANDBOX", decision: "D-REL-1", decisionStatus: "PENDING_FOUNDER", riskLevel,
    text: "Generated code and its tests run on this computer under your user account without an OS sandbox (interim; Founder decision D-REL-1 pending). R3/R4 missions are refused."};
}
