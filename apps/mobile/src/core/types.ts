// //TR: Mobil Companion salt okunur çekirdek tipleri: MOB-3 ÖNERİLEN rota adları, dürüst durumlar, zarf ve enjekte okuyucu arayüzü (ağ, depolama ve eylem yok).
/** MOB-3 PROPOSED route names. None exists yet: every route is NOT_CONNECTED. */
export const MOBILE_ROUTES = ["summary", "projects", "workers", "runs", "timeline", "reports", "ops", "changes", "notifications"] as const;
export type MobileRoute = (typeof MOBILE_ROUTES)[number];

/** Upstream path shown for traceability only; the core never calls it. */
export const ROUTE_PATHS: Readonly<Record<MobileRoute, string>> = {
  summary: "GET /v1/mobile/summary",
  projects: "GET /v1/mobile/projects",
  workers: "GET /v1/mobile/workers",
  runs: "GET /v1/mobile/runs",
  timeline: "GET /v1/mobile/missions/:missionId/timeline",
  reports: "GET /v1/mobile/reports",
  ops: "GET /v1/mobile/ops",
  changes: "GET /v1/mobile/changes",
  notifications: "GET /v1/mobile/notifications",
};

/** No /v1/mobile/* route exists (MOB-3 is PROPOSED); flip per route only when one is implemented. */
export type Connection = "NOT_CONNECTED" | "CONNECTED";
export const ROUTE_CONNECTION: Readonly<Record<MobileRoute, Connection>> = {
  summary: "NOT_CONNECTED", projects: "NOT_CONNECTED", workers: "NOT_CONNECTED", runs: "NOT_CONNECTED", timeline: "NOT_CONNECTED",
  reports: "NOT_CONNECTED", ops: "NOT_CONNECTED", changes: "NOT_CONNECTED", notifications: "NOT_CONNECTED",
};

/** Server contract states (MOB-3 3.3) plus phone-side OFFLINE. */
export type ContractState = "VERIFIED" | "STALE" | "UNAVAILABLE" | "UNKNOWN" | "ERROR" | "OFFLINE";
/** What a screen may render. */
export type ViewState = "LOADING" | "EMPTY" | "ERROR" | "OFFLINE" | "STALE" | "UNAVAILABLE" | "DENIED" | "VERIFIED";

export interface Envelope {
  readonly contract: "uasco.mobile.v1";
  readonly route: MobileRoute;
  readonly generatedAt: string;
  readonly state: ContractState;
  readonly journal?: { readonly state: string; readonly seq?: number };
  readonly data: unknown;
  readonly page?: { readonly limit: number; readonly nextCursor: string | null; readonly truncated: boolean };
  readonly notice?: string | null;
}

export interface CacheEntry {
  readonly route: MobileRoute;
  readonly key: string;
  /** Epoch ms at which the phone fetched the envelope. */
  readonly fetchedAtMs: number;
  readonly envelope: Envelope;
}

export type LiveResult =
  | { readonly kind: "ok"; readonly envelope: Envelope }
  | { readonly kind: "offline"; readonly reason: OfflineReason }
  | { readonly kind: "denied"; readonly code: string }
  | { readonly kind: "error"; readonly code: string };

export type OfflineReason = "UNREACHABLE" | "PIN_MISMATCH" | "DESKTOP_DEGRADED" | "DEVICE_REVOKED" | "REAUTH_REQUIRED";

/** Injected, read-only. The core never imports a network or storage API. */
export interface MonitoringReader {
  readLive(route: MobileRoute, key: string): Promise<LiveResult>;
  readCache(route: MobileRoute, key: string): Promise<CacheEntry | null>;
}

export type Clock = () => number;
