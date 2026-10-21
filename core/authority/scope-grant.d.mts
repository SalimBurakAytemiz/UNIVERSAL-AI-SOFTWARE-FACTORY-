// //TR: scope-grant.mjs icin TypeScript bildirimi (CLI kontrolcusu ve testler ayni saf degerlendiriciyi tip guvenli kullanir).
export type ScopeGrantCode = "GRANT_INVALID" | "GRANT_NOT_ACTIVE" | "GRANT_EXPIRED" | "NEVER_DELEGABLE_PATH" | "PROTECTED_CHANGE_OUTSIDE_GRANT" | "RESEAL_OUTSIDE_GRANT";
export interface ScopeGrantViolation {code: ScopeGrantCode; path?: string}
export interface ScopeGrantResult {ok: boolean; violations: ScopeGrantViolation[]}
export interface ScopeGrantInput {
  grant: unknown;
  protectedPolicy: unknown;
  changedFiles: unknown;
  manifestBefore?: unknown;
  manifestAfter?: unknown;
  now: unknown;
}
export declare const SCOPE_GRANT_CODES: readonly ScopeGrantCode[];
export declare const MANIFEST_PATH: string;
export declare const NEVER_DELEGABLE_EXACT: readonly string[];
export declare const NEVER_DELEGABLE_PREFIXES: readonly string[];
export declare function evaluateScopeGrant(input: ScopeGrantInput): ScopeGrantResult;
