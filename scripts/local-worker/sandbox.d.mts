// //TR: scripts/local-worker/sandbox.mjs için TypeScript tip bildirimleri; davranış sandbox.mjs'tedir.
export declare const SANDBOX_EXE: string; export declare const SANDBOX_PROCESSES: readonly string[];
export declare const IN: {readonly src: string; readonly deps: string; readonly tools: string; readonly worker: string; readonly ctl: string; readonly out: string};
export declare class SandboxError extends Error { code: string; constructor(code: string); }
export declare function checkHostFolder(p: string, opts: {workRoot: string; toolRoots?: string[]; profile?: string; readOnly: boolean}): string;
export declare function buildWsb(input: {memoryMB: number; mapped: {host: string; sandbox: string; readOnly?: boolean}[]; logonCommand: string; workRoot: string; toolRoots?: string[]; profile?: string}): string;
export declare function logonFor(script: string): string;
export declare function selftestScript(input: {hostProfile: string}): string;
export declare function jobScript(input: {steps: string[]}): string;
export declare function runSandbox(input: {wsbFile: string; outDir: string; timeoutMs: number; launch: (wsb: string) => Promise<void>; killAll: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>; now?: () => number; pollMs?: number}): Promise<{outcome: "DONE" | "TIMEOUT" | "LAUNCH_FAILED"; elapsedMs: number}>;
