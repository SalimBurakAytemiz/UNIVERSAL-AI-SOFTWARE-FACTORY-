// //TR: protected-change-grammar.mjs icin TypeScript bildirimi (testler dil bilgisi denetimlerini tip guvenli cagirir); davranis .mjs dosyasindadir.
export declare const DENY_TOKENS: readonly string[];
export declare const ALLOWLIST_MARKERS: readonly (readonly [string, string])[];
export declare function safeExpression(expr: unknown): boolean;
export declare function insertedLines(baseLines: string[], headLines: string[]): number[] | null;
export declare function pathRegexBodyOk(body: unknown): boolean;
export declare function routeRegistrationViolations(baseText: unknown, headText: unknown): string[];
export declare function desktopAllowlistViolations(baseText: unknown, headText: unknown): string[];
