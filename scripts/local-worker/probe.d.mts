// //TR: scripts/local-worker/probe.mjs için TypeScript tip bildirimleri; davranış probe.mjs'tedir.
export declare const SANDBOX_EDITIONS: readonly string[];
export declare function interpretProbe(raw: any, opts?: {now?: number}): any;
export interface ProbeError { code: string | null; status: number | null; signal: string | null; durationMs: number; stdoutBytes: number; stderrTail: string }
export declare const redactGuids: (text: unknown) => string;
export declare function probeHost(opts?: {run?: any; now?: number; platform?: string}): any;
