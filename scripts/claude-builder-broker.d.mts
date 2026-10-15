// //TR: claude-builder-broker.mjs saf yardımcılarının tür bildirimi (yalnız testler import eder; broker script olarak çalışır).
export declare const BROKER_ISOLATION_FLAGS: string[];
export declare const PROFILE_CREDENTIAL_STORE: string;
export declare function builderArgs(pol: {allowedTools: string[]; disallowedTools?: string[]; disallowedToolPatterns?: string[]; permissionMode?: string}): string[];
export declare function implementerProfileDir(control: string): string;
export declare function profilePathRefusal(dir: string, env?: NodeJS.ProcessEnv): string | null;
export declare function implementerProfileBlock(dir: string, env?: NodeJS.ProcessEnv): string | null;
export declare function withProfileEnv(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv;
export declare function brokerPlan(control: string): {args: string[]; profile: string; env: NodeJS.ProcessEnv};
