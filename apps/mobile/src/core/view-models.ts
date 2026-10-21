// //TR: MOB-6 ekranları (UI-097 ana sayfa, UI-099 görev akışı, UI-102 ajan takibi, UI-177 çevrimdışı) için saf görünüm modeli işlevleri; eksik veri sayı değil null/—, bağlantı NOT_CONNECTED.
import { ROUTE_CONNECTION, ROUTE_PATHS, type Connection, type MobileRoute, type OfflineReason, type ViewState } from "./types.js";
import type { Snapshot } from "./monitoring-store.js";
import type { CachedRead } from "./stale-cache.js";

export interface Field<T> {
  /** null renders as an em dash, never 0. */
  readonly value: T | null;
  readonly route: MobileRoute;
  readonly source: string;
  readonly connection: Connection;
}

export interface ScreenFrame {
  readonly state: ViewState;
  /** Set only when state is STALE or OFFLINE-with-cache. */
  readonly staleAgeLabel: string | null;
  readonly banner: string | null;
}
/** Internal: frame plus raw data. Raw server data never leaves a view model. */
interface RawFrame extends ScreenFrame { readonly data: Record<string, unknown> | null }
const publicFrame = ({ data: _data, ...rest }: RawFrame): ScreenFrame => rest;

const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, p) => asRecord(a)?.[p], o);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function field<T>(route: MobileRoute, source: string, value: T | null): Field<T> {
  return { value, route, source, connection: ROUTE_CONNECTION[route] };
}

function emptyData(route: MobileRoute, d: Record<string, unknown> | null): boolean {
  if (d === null) return true;
  if (route === "runs" || route === "workers" || route === "projects") return Array.isArray(d.items) && d.items.length === 0;
  return false;
}

/** Maps a store snapshot to the frame every screen shares. A cached read is never VERIFIED. */
function rawFrameOf(route: MobileRoute, snap: Snapshot): RawFrame {
  switch (snap.status) {
    case "LOADING": return { state: "LOADING", staleAgeLabel: null, banner: null, data: null };
    case "DENIED": return { state: "DENIED", staleAgeLabel: null, banner: snap.code, data: null };
    case "LIVE": {
      const env = snap.envelope;
      const d = asRecord(env.data);
      if (env.state === "ERROR") return { state: "ERROR", staleAgeLabel: null, banner: "SERVER_REPORTED_ERROR", data: null };
      if (env.state === "UNAVAILABLE") return { state: "UNAVAILABLE", staleAgeLabel: null, banner: null, data: null };
      if (env.state === "OFFLINE") return { state: "ERROR", staleAgeLabel: null, banner: "SERVER_SENT_OFFLINE", data: null };
      if (emptyData(route, d)) return { state: "EMPTY", staleAgeLabel: null, banner: null, data: null };
      // Server-side STALE (e.g. expired lease) stays STALE; UNKNOWN is not promoted to VERIFIED.
      return { state: env.state === "VERIFIED" ? "VERIFIED" : env.state === "STALE" ? "STALE" : "UNAVAILABLE", staleAgeLabel: null, banner: null, data: d };
    }
    case "OFFLINE": return fromCache("OFFLINE", snap.reason, snap.cached);
    case "ERROR": return fromCache("ERROR", snap.code, snap.cached);
  }
}

function fromCache(base: "OFFLINE" | "ERROR", banner: string, c: CachedRead): RawFrame {
  if (c.state === "STALE" && c.envelope !== null) {
    return { state: "STALE", staleAgeLabel: c.ageLabel, banner, data: asRecord(c.envelope.data) };
  }
  return { state: base, staleAgeLabel: null, banner, data: null };
}

export function frameOf(route: MobileRoute, snap: Snapshot): ScreenFrame { return publicFrame(rawFrameOf(route, snap)); }

// ---- UI-097 Home ----
export interface HomeViewModel {
  readonly frame: ScreenFrame;
  readonly globalStopActive: Field<boolean>;
  readonly globalStopReason: Field<string>;
  readonly scopeNotice: string;
  readonly journalState: Field<string>;
  readonly projectsCount: Field<number>;
  readonly missionsTotal: Field<number>;
  /** Count only: no items, titles or buttons in R1. */
  readonly awaitingApprovalCount: Field<number>;
  readonly activeWorkerRuns: Field<number>;
  /** Not served upstream: always null (UNKNOWN), never 0. */
  readonly runsByStatus: Field<never>;
}
export const STOP_SCOPE_NOTICE = "local Work OS and dev-runs only, not Cloud production";

export function homeViewModel(snap: Snapshot): HomeViewModel {
  const raw0 = rawFrameOf("summary", snap);
  const frame = publicFrame(raw0);
  const d = raw0.data;
  const f = <T>(src: string, v: T | null) => field("summary", src, d === null ? null : v);
  const stop = at(d, "globalStop.active");
  return {
    frame,
    globalStopActive: f("globalStop.active", typeof stop === "boolean" ? stop : null),
    globalStopReason: f("globalStop.reason", str(at(d, "globalStop.reason"))),
    scopeNotice: STOP_SCOPE_NOTICE,
    journalState: f("journal.state", str(at(d, "journal.state"))),
    projectsCount: f("projects.count", num(at(d, "projects.count"))),
    missionsTotal: f("missions.total", num(at(d, "missions.total"))),
    awaitingApprovalCount: f("awaitingApproval.count", num(at(d, "awaitingApproval.count"))),
    activeWorkerRuns: f("workforce.activeWorkerRuns", num(at(d, "workforce.activeWorkerRuns"))),
    runsByStatus: field<never>("summary", "runsByStatus", null),
  };
}

// ---- UI-099 Task flow ----
export interface RunItem {
  readonly runId: Field<string>; readonly missionId: Field<string>; readonly status: Field<string>;
  readonly createdAt: Field<string>;
  /** No upstream field: always null (UNAVAILABLE). */
  readonly startedAt: Field<string>;
  readonly outcomeCode: Field<string>; readonly deliveryState: Field<string>;
}
export interface TaskFlowViewModel { readonly frame: ScreenFrame; readonly items: readonly RunItem[]; readonly nextCursor: string | null; }

export function taskFlowViewModel(snap: Snapshot): TaskFlowViewModel {
  const raw0 = rawFrameOf("runs", snap);
  const frame = publicFrame(raw0);
  const raw = raw0.data?.items;
  const items = Array.isArray(raw) ? raw.map((r): RunItem => ({
    runId: field("runs", "runId", str(at(r, "runId"))), missionId: field("runs", "missionId", str(at(r, "missionId"))),
    status: field("runs", "status", str(at(r, "status"))), createdAt: field("runs", "createdAt", str(at(r, "createdAt"))),
    startedAt: field<string>("runs", "startedAt", null),
    outcomeCode: field("runs", "outcome.code", str(at(r, "outcome.code"))), deliveryState: field("runs", "delivery.state", str(at(r, "delivery.state"))),
  })) : [];
  return { frame, items, nextCursor: str(at(snap.status === "LIVE" ? snap.envelope : null, "page.nextCursor")) };
}

// ---- UI-102 Agent tracking ----
export interface WorkerItem {
  readonly runId: Field<string>; readonly executorRole: Field<string>; readonly status: Field<string>;
  /** Past expiry shows a STALE badge, not "stuck". */
  readonly leaseBadge: "STALE" | "CURRENT" | "UNKNOWN";
  /** No upstream source: always UNKNOWN in R1. */
  readonly liveness: "UNKNOWN";
}
export interface AgentTrackingViewModel {
  readonly frame: ScreenFrame; readonly activeWorkerRuns: Field<number>; readonly canonicalRoles: Field<number>;
  readonly items: readonly WorkerItem[]; readonly cloudSessions: "UNKNOWN";
}

export function agentTrackingViewModel(snap: Snapshot, nowMs: number): AgentTrackingViewModel {
  const raw0 = rawFrameOf("workers", snap);
  const frame = publicFrame(raw0);
  const d = raw0.data;
  const raw = d?.items;
  const items = Array.isArray(raw) ? raw.map((r): WorkerItem => {
    const exp = str(at(r, "leaseExpiresAt")); const t = exp === null ? NaN : Date.parse(exp);
    return {
      runId: field("workers", "runId", str(at(r, "runId"))), executorRole: field("workers", "executorRole", str(at(r, "executorRole"))),
      status: field("workers", "status", str(at(r, "status"))),
      leaseBadge: Number.isNaN(t) ? "UNKNOWN" : t < nowMs ? "STALE" : "CURRENT", liveness: "UNKNOWN",
    };
  }) : [];
  return {
    frame, items, cloudSessions: "UNKNOWN",
    activeWorkerRuns: field("workers", "activeWorkerRuns", num(at(d, "activeWorkerRuns"))),
    canonicalRoles: field("workers", "canonicalRoles", num(at(d, "canonicalRoles"))),
  };
}

// ---- UI-177 Offline ----
const OFFLINE_TEXT: Readonly<Record<OfflineReason, string>> = {
  UNREACHABLE: "The desktop cannot be reached. The desktop app must be open on the PC.",
  PIN_MISMATCH: "The desktop identity does not match the pairing.",
  DESKTOP_DEGRADED: "The desktop reports a degraded journal.",
  DEVICE_REVOKED: "This device was revoked.",
  REAUTH_REQUIRED: "Sign-in is required again.",
};
export interface OfflineViewModel {
  readonly offline: boolean; readonly reason: OfflineReason | null; readonly text: string | null;
  readonly cachedState: "STALE" | "UNAVAILABLE" | null; readonly lastSyncLabel: string | null;
  readonly journalStateAtLastSync: string | null;
  /** Nothing is queued for later: always false. */
  readonly queuesWrites: false;
}
export function offlineViewModel(snap: Snapshot): OfflineViewModel {
  const base = { queuesWrites: false } as const;
  if (snap.status !== "OFFLINE") return { ...base, offline: false, reason: null, text: null, cachedState: null, lastSyncLabel: null, journalStateAtLastSync: null };
  const c = snap.cached;
  return {
    ...base, offline: true, reason: snap.reason, text: OFFLINE_TEXT[snap.reason], cachedState: c.state,
    lastSyncLabel: c.state === "STALE" ? c.ageLabel : null,
    journalStateAtLastSync: c.envelope?.journal?.state ?? null,
  };
}

export function routePath(route: MobileRoute): string { return ROUTE_PATHS[route]; }
