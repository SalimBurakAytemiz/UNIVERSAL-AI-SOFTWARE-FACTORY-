// //TR: docs/planning/pr-controller.mjs için TypeScript tip bildirimleri (testlerin strict typecheck'i için); davranış pr-controller.mjs'tedir.
export interface ControllerAction { action: string; lane: string | null; reason: string; headSha?: string }
export interface ControllerPlan { pr: number | null; actions: ControllerAction[] }
export interface Verification { status: string; headSha: string; baseSha: string; kind: string; independentSession?: boolean }
export interface PrState {
  pr?: number; lane?: string; draft: boolean; headSha: string; baseSha: string; mergeable_state?: string | null;
  ciRequired: { ubuntu: string; windows: string; headSha?: string };
  independentVerification?: Verification | Verification[] | null; riskTier?: string; autoMerge: boolean; autoMergeArmedHead?: string | null; merged: boolean; mergeCommit?: string;
  postMerge?: "VERIFIED" | "MISMATCH"; priorNegative?: boolean | null;
  baseDelta?: { fromBaseSha: string; toBaseSha: string; files: string[] }; prFiles?: string[];
}
export declare const ACTIONS: readonly string[];
export declare const REASONS: readonly string[];
export declare const CI_VALUES: readonly string[];
export declare const VERIFICATION_STATUSES: readonly string[];
export declare const VERIFICATION_KINDS: readonly string[];
export declare const MERGEABLE_STATES: readonly string[];
export declare function nextActions(state: PrState | unknown): ControllerPlan;
export declare function planAll(states: (PrState | unknown)[] | unknown): ControllerPlan[];
