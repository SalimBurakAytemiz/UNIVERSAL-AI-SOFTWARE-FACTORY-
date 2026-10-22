// //TR: scripts/local-worker/worker.mjs için TypeScript tip bildirimleri; davranış worker.mjs'tedir.
export declare const ORIGIN: string;
export declare function defaults(env?: Record<string, string | undefined>): {stateDir: string; workRoot: string};
export declare function parse(argv: string[]): any;
export declare function status(o: any, opts?: {probe?: any; now?: number}): any;
export declare function selftest(o: any, opts?: {probe?: any; now?: number}): Promise<any>;
export declare function ensureMirror(o: any): string;
export declare function makeJob(o: any): any;
export declare function prepareDeps(o: any): any;
export declare function runJob(o: any, opts?: {probe?: any; now?: () => number; launch?: (wsb: string) => Promise<void>; killAll?: () => Promise<void>;
  tools?: {nodeDir: string; gitDir: string | null} | null; buildWsb?: (input: any) => string; sleep?: (ms: number) => Promise<void>}): Promise<any>;
export declare function publish(o: any): any;
export declare function main(argv: string[]): Promise<any>;
