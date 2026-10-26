// //TR: docs/planning/merge-gate.mjs için TypeScript tip bildirimleri (testlerin strict typecheck'i için; denetleyici ile kapının uyum senaryosu bunu kullanır); davranış merge-gate.mjs'tedir.
export interface GateResult {
  decision: "MERGE" | "BLOCK" | "INTERNAL_ERROR"; expectedHeadSha: string | null; expectedBaseSha: string | null; reasons: string[];
  identityIndependence: string; trust: string; mode: string; riskTier: "ROUTINE" | "PREAUTHORIZED" | "FOUNDER"; riskClasses: string[];
}
export type Binding = { verdict: string; head: string; base: string; session: string } | { code: string } | null;
export interface PostMergeResult { decision: "VERIFIED" | "MISMATCH"; reasons: string[]; basis: "EXACT" | "ANCESTRY_PROVEN" | "NONE" }
export declare const EXIT: { MERGE: number; BLOCK: number; INTERNAL_ERROR: number };
export declare const REQUIRED_CONTEXTS: readonly string[];
export declare const CHECK_APP: string;
export declare const DEFAULT_BASE_REF: string;
export declare const CI_WORKFLOW_PATH: string;
export declare const BINDING_RE: RegExp;
export declare const INVISIBLE_RE: RegExp;
export declare function parseBinding(body: unknown): Binding;
export declare function evaluateMergeGate(evidence: unknown, policy?: unknown): GateResult;
export declare function verifyPostMerge(x: unknown): PostMergeResult;
export declare function normalisePolicy(policy?: unknown): { mode: string; trusted: Set<string>; expectedBaseRef: string };
export declare function runCli(argv: string[]): { exit: number; res: unknown };
