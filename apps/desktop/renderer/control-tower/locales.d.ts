// //TR: Bu bildirim dosyası locales.js için tip sözleşmesini verir; yalnızca tsc typecheck içindir.
export const LIVE_STATUSES: readonly string[];
export const STRINGS: Readonly<Record<"tr" | "en", Readonly<Record<string, string>>>>;
export function pickLocale(locale?: string): "tr" | "en";
export function tr(locale: string | undefined, key: string, vars?: Record<string, string | number>): string;
export function esc(value: unknown): string;
export function truncate(value: unknown, max: number): string;
