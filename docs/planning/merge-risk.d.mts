// //TR: docs/planning/merge-risk.mjs için TypeScript tip bildirimleri (testlerin strict typecheck'i için); davranış merge-risk.mjs'tedir.
export type RiskTier = "ROUTINE" | "PREAUTHORIZED" | "FOUNDER";
export interface RiskFileInput { filename: string; status: string; previous_filename?: string | null; baseText?: string | null; headText?: string | null }
export interface RiskInput { files: RiskFileInput[] | unknown; protectedPaths: unknown; headSha?: string | null; headFiles?: string[] }
export interface RiskFileResult { file: string | null; tier: RiskTier; code: string }
export interface RiskResult { tier: RiskTier; files: RiskFileResult[]; classes: string[] }
export declare const PROTECTED_FLOOR: readonly string[];
export declare const PROTECTED_FLOOR_EXACT: readonly string[];
export declare const CI_EXECUTED_FLOOR: readonly (readonly [string, string, boolean])[];
export declare const HIGH_RISK_EXACT: readonly string[];
export declare const HIGH_RISK_PREFIXES: readonly string[];
export declare const HIGH_RISK_PATTERNS: readonly RegExp[];
export declare const TEST_FILE_PATTERN: RegExp;
export declare const RISK_TIERS: readonly RiskTier[];
export declare const PREAUTHORIZED_CLASSES: Readonly<Record<string, string>>;
export declare const CONTENT_CANDIDATES: readonly string[];
export declare const FOUNDER_CODES: readonly string[];
export declare const FILE_CODES: readonly string[];
export declare function normPath(p: unknown): string | null;
export declare function validProtectedPaths(pp: unknown): boolean;
export declare function pathMatcher(protectedPaths: unknown): { protectedHit: (n: string) => boolean; ciCategories: (n: string) => string[] };
export declare function isHighRisk(n: unknown): boolean;
export declare function classifyChange(input: RiskInput | unknown): RiskResult;
