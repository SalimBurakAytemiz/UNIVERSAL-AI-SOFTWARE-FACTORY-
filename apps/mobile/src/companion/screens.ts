// //TR: Mobil Companion ekran modelleri (UASCO-T0083): durum özeti, bekleyen onaylar listesi + ayrıntı, bildirim listesi. Saf işlevler; veri yalnız istemci sonucundan gelir, eksikse null/— olur (sayı uydurulmaz). Onayla/Reddet bugün KAPALIDIR ve nedeni gösterilir: telefon için cihaz kapsamlı, kimliği doğrulanmış bir onay rotası yoktur.
import {ATTENTION_KINDS, PHONE_REACHABILITY, type ApiResult, type AttentionItem, type AttentionKind, type AttentionQueue, type ControlStatus} from "./api-client.js";

export type ScreenState = "OK" | "EMPTY" | "DENIED" | "OFFLINE" | "ERROR";
export interface ScreenHeader { readonly state: ScreenState; readonly banner: string | null; readonly source: string }

const header = <T>(r: ApiResult<T>, source: string, empty: (d: T) => boolean): ScreenHeader =>
  r.kind === "ok" ? {state: empty(r.data) ? "EMPTY" : "OK", banner: null, source}
    : {state: r.kind === "denied" ? "DENIED" : r.kind === "offline" ? "OFFLINE" : "ERROR", banner: r.code, source};

// ---- status overview ------------------------------------------------------------------------------------------------
export interface StatusOverview {
  readonly header: ScreenHeader;
  /** null = unknown (status not read); never shown as "running". */
  readonly globalStop: {readonly active: boolean; readonly reason: string | null} | null;
  readonly journal: {readonly state: string; readonly healthy: boolean; readonly reason: string | null} | null;
  readonly verificationRejected: boolean;
  /** Per-kind counts from the server; null when the queue was not read. */
  readonly attentionCounts: Readonly<Record<AttentionKind, number>> | null;
  readonly attentionTruncated: boolean;
  readonly phoneReachable: boolean;
  readonly reachabilityNote: string;
}

export function statusOverview(status: ApiResult<ControlStatus>, attention: ApiResult<AttentionQueue>): StatusOverview {
  const s = status.kind === "ok" ? status.data : null, a = attention.kind === "ok" ? attention.data : null;
  // Header: the worst of the two reads (a failed status read must not look healthy).
  const h = status.kind !== "ok" ? header(status, "GET /v1/control/status", () => false) : attention.kind !== "ok" ? header(attention, "GET /v1/attention", () => false)
    : {state: "OK" as const, banner: null, source: "GET /v1/control/status + GET /v1/attention"};
  return {
    header: h,
    globalStop: s ? {active: s.globalStop.active, reason: s.globalStop.reason} : null,
    journal: s ? {state: s.journal.state, healthy: s.journal.state === "OK" || s.journal.state === "ABSENT", reason: s.journal.reason} : null,
    verificationRejected: s?.verification === "REJECTED",
    attentionCounts: a ? a.counts : null,
    attentionTruncated: a?.truncated ?? false,
    phoneReachable: PHONE_REACHABILITY.reachable,
    reachabilityNote: PHONE_REACHABILITY.reason,
  };
}

// ---- approvals ------------------------------------------------------------------------------------------------------
/** Attention kinds that ask the Founder for a decision. */
export const APPROVAL_KINDS: readonly AttentionKind[] = ["RUN_AWAITING_APPROVAL", "MISSION_AUTHORIZATION_PENDING", "RUN_NEEDS_DECISION", "MISSION_FOUNDER_ATTENTION"];

export interface ActionAvailability {
  readonly enabled: false;
  readonly reason: string;
  /** The existing desktop route that performs this decision today, if any (shown for traceability; the companion never calls it). */
  readonly desktopRoute: string | null;
}
/** Desktop routes that exist today for each next action (all require the desktop control token on 127.0.0.1). */
const DESKTOP_ROUTE: Readonly<Record<AttentionItem["nextAction"], string | null>> = {
  ACCEPT_DELIVERY: "POST /v1/work-runs/:id/delivery/accept",
  PREPARE_DELIVERY: "POST /v1/work-runs/:id/delivery/prepare",
  AUTHORIZE_MISSION: "POST /v1/missions/:id/transition",
  REVIEW_RUN: null, REVIEW_MISSION: null, UNBLOCK_TASK: "POST /v1/tasks/:id/transition",
  RESUME_RUN: null,   // resume is a store operation without an HTTP route yet (Founder item)
};
export const MOBILE_APPROVAL_DISABLED_REASON = "NO_DEVICE_SCOPED_APPROVAL_ROUTE: approve/reject from the phone needs an authenticated, device-scoped /v1/mobile approval route behind the gateway (UASCO-T0084); the desktop control token is never placed on the phone";

export function approvalAction(item: AttentionItem): {approve: ActionAvailability; reject: ActionAvailability} {
  const a: ActionAvailability = {enabled: false, reason: MOBILE_APPROVAL_DISABLED_REASON, desktopRoute: DESKTOP_ROUTE[item.nextAction]};
  return {approve: a, reject: a};
}

export interface ApprovalRow { readonly id: string; readonly kind: AttentionKind; readonly title: string; readonly projectId: string; readonly since: string | null; readonly nextAction: string }
export interface ApprovalsList { readonly header: ScreenHeader; readonly rows: readonly ApprovalRow[]; readonly truncated: boolean }

/** Stable row id from the server identifiers only (no client-side numbering). */
export const itemId = (i: AttentionItem): string => [i.kind, i.missionId, i.runId ?? "-", i.taskId ?? "-"].join(":");

export function approvalsList(r: ApiResult<AttentionQueue>): ApprovalsList {
  const items = r.kind === "ok" ? r.data.items.filter(i => APPROVAL_KINDS.includes(i.kind)) : [];
  return {header: header(r, "GET /v1/attention", () => items.length === 0), truncated: r.kind === "ok" && r.data.truncated,
    rows: items.map(i => ({id: itemId(i), kind: i.kind, title: i.title, projectId: i.projectId, since: i.since, nextAction: i.nextAction}))};
}

export interface ApprovalDetail {
  readonly found: boolean;
  readonly item: AttentionItem | null;
  readonly approve: ActionAvailability | null;
  readonly reject: ActionAvailability | null;
}
export function approvalDetail(r: ApiResult<AttentionQueue>, id: string): ApprovalDetail {
  const item = r.kind === "ok" ? r.data.items.find(i => APPROVAL_KINDS.includes(i.kind) && itemId(i) === id) ?? null : null;
  if (!item) return {found: false, item: null, approve: null, reject: null};
  const act = approvalAction(item);
  return {found: true, item, approve: act.approve, reject: act.reject};
}

// ---- notifications ---------------------------------------------------------------------------------------------------
/** No notification route exists: the list is DERIVED from the attention queue and says so. */
export const NOTIFICATION_SOURCE = "DERIVED_FROM GET /v1/attention (no /v1/mobile/notifications route exists)";
const SEVERITY: Readonly<Record<AttentionKind, "ACTION" | "BLOCKED" | "INFO">> = {
  RUN_AWAITING_APPROVAL: "ACTION", MISSION_AUTHORIZATION_PENDING: "ACTION", RUN_NEEDS_DECISION: "ACTION", MISSION_FOUNDER_ATTENTION: "ACTION",
  MISSION_BLOCKED: "BLOCKED", TASK_BLOCKED: "BLOCKED",
};
export interface NotificationRow { readonly id: string; readonly severity: "ACTION" | "BLOCKED" | "INFO"; readonly text: string; readonly at: string | null }
export interface NotificationsList { readonly header: ScreenHeader; readonly rows: readonly NotificationRow[] }

export function notificationsList(r: ApiResult<AttentionQueue>): NotificationsList {
  const items = r.kind === "ok" ? r.data.items : [];
  return {header: header(r, NOTIFICATION_SOURCE, () => items.length === 0),
    rows: items.map(i => ({id: itemId(i), severity: SEVERITY[i.kind], text: `${i.kind}: ${i.title}${i.reason ? ` (${i.reason})` : ""}`, at: i.since}))};
}

export const KNOWN_KINDS = ATTENTION_KINDS;
