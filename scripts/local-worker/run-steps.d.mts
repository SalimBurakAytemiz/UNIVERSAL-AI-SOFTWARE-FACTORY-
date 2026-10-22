// //TR: scripts/local-worker/run-steps.mjs için TypeScript tip bildirimleri; davranış run-steps.mjs'tedir.
export declare const STEP_TIMEOUT_MS: number;
export declare function runSteps(input: {repo: string; steps: string[]; out: string; runnerRoot?: string}): Promise<{schema: string; configSha256: string; platform: string; steps: {id: string; status: string; exitCode: number | null; timedOut: boolean; durationMs: number | null}[]}>;
