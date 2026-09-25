// //TR: Bu declaration Control API TypeScript katmanının shared control-boundary helper fonksiyonlarını strict typecheck altında kullanmasını sağlar.
export function parseControlPort(value: unknown, fallback?: number): number;
export function controlOrigin(port: unknown): string;
export function controlTokenFingerprint(token: unknown): string | null;
export function controlChallengeProof(token: unknown, challenge: unknown): string | null;
export function secureStringEqual(a: unknown, b: unknown): boolean;
export function hostHeaderAllowed(value: unknown, port: unknown): boolean;
export function desktopGetPathAllowed(value: unknown): boolean;
export function resolveExistingPathUnder(root: string, ...parts: string[]): string;
export function resolveWritablePathUnder(root: string, ...parts: string[]): string;
export function verifyPhase0ForControl(repoRoot: string, report: any): {ok:boolean;errors:string[];current?:unknown};
export function verifyInstallReportForControl(repoRoot: string, report: any, phase0: any): {ok:boolean;errors:string[]};
