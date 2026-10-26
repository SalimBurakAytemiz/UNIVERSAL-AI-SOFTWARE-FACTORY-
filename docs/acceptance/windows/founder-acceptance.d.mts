// //TR: founder-acceptance.mjs için TypeScript tür bildirimi (testler bu betiği içe aktarır); davranış yoktur.
export const DEFAULT_REPO: string;
export const TEST_FILE: string;
export const REAL_TESTS: ReadonlyArray<{id: string; title: string; match: RegExp}>;
export function decodeWslText(b: unknown): string;
export function parseWslList(text: string): string[];
export function parseWslVerbose(text: string): Array<{name: string; version: number}>;
export function parseWslConf(text: string): {interopEnabled: boolean; appendWindowsPath: boolean; interopExplicit: boolean; appendExplicit: boolean};
export function wslConfFixCommands(distro: string): string;
export function preflight(distro: string | null, deps: any): Promise<any[]>;
export function mapVitestJson(json: unknown): any[];
export function verdictOf(checks: any[], sha: string | null, repo?: {shaSource: string; dirty: boolean | null}): any;
export function renderTable(report: any): string;
export function runAcceptance(o: any, deps: any): Promise<any>;
export function sha256File(f: string): string | null;
export function parseArgs(argv: string[], env?: NodeJS.ProcessEnv): any;
export const INTEROP_SCRIPT: string;
