// //TR: autonomous-authority.mjs icin TypeScript bildirimi (control-api / Founder Cockpit / testler ayni kanonik motoru tip guvenli kullanir).
export declare const AUTO: "AUTO_AUTHORIZED_BY_POLICY";
export declare const BLOCKED: "BLOCKED_BY_POLICY";
export declare const POLICY_PATH: string;
export declare const MANIFEST_PATH: string;
export declare const POLICY_SCHEMA_VERSION: string;
export declare const ROUTINE_ACTION_CLASSES: readonly string[];
export declare const PROTECTED_CHANGE_CLASSES: readonly string[];
export declare const NEVER_AUTO_CLASSES: readonly string[];
export declare const ROLES: readonly string[];
export declare const POLICY_CORE_PATHS: readonly string[];
export type Status = "AUTO_AUTHORIZED_BY_POLICY" | "BLOCKED_BY_POLICY";
export interface Principal { role: string; sessionId: string; identity: string }
export interface AuthorityRequest {
  requestId: string; actionClass: string; principal: Principal; repository: string; branch: string; baseBranch: string;
  taskId: string; riskLevel: number; headSha?: string; changedFiles?: string[]; attempt?: number;
  checkpoint?: { headSha: string; ref: string };
}
export interface Decision {
  status: Status; reasons: string[]; grantId: string | null; policyId: string | null; policyVersion: number | null;
  policySha256: string | null; requestId: string | null; requestDigest: string | null; boundTo: Record<string, unknown> | null;
  decidedAt: string | null; decisionDigest: string;
}
export interface SealStatus { ok: boolean; reason: string; policySha256?: string; expected?: string; actual?: string }
// //TR: Dar korunan-degisiklik girdisi; icerikler cagiran oturum tarafindan degerlendirilen SHA'daki git blob'larindan okunur, motor kararlari kendisi yeniden hesaplar.
export interface ProtectedChangeInput {
  classId: string; file: string; baseText: string; headText: string;
  headFileExists?: (path: string) => boolean; headFileBytes?: (path: string) => Buffer | Uint8Array | string | null;
}
export interface DecideContext {
  policy: any; seal: SealStatus; now: Date; protectedPaths?: any; lease?: any; protectedChanges?: ProtectedChangeInput[];
}
export declare function digestOf(value: unknown): string;
export declare function matchPattern(pattern: string, value: string): boolean;
export declare function isCanonicalPath(file: unknown): boolean;
export declare function isProtectedPath(protectedPaths: any, file: string): boolean;
export declare function validatePolicy(policy: any): string[];
export declare function policySealStatus(input: { policyText: string | null; manifestText: string | null }): SealStatus;
export declare function loadSealedPolicy(repoDir: string): { seal: SealStatus; policy: any };
export declare function decide(req: AuthorityRequest | any, ctx?: Partial<DecideContext>): Decision;
export declare function backoffMs(policy: any, attempt: number): number | null;
export declare function verifyDecision(decision: Decision | any, req: AuthorityRequest | any, ctx?: Partial<DecideContext>): { ok: boolean; reason: string };
export declare function evaluateRequiredChecks(policy: any, checkRuns: any[], sha: string): string[];
export declare function evaluateMerge(ev?: any, ctx?: Partial<DecideContext>): { status: Status; merge: "AUTHORIZED" | "BLOCKED"; reasons: string[]; evaluatedSha: string | null; policyVersion: number | null; policySha256: string | null; decisionDigest: string };
export declare function evaluateProtectedChange(input?: any): { status: Status; classId: string | null; file: string | null; headSha: string | null; reasons: string[]; decisionDigest: string };
export declare function toCockpitRecord(decision: any): { display: "AUTO_AUTHORIZED" | "BLOCKED"; status: Status; actionClass: string | null; taskId: string | null; headSha: string | null; reasons: string[]; policyVersion: number | null; decisionDigest: string | null; decidedAt: string | null };
