// //TR: Mobil Companion (UASCO-T0083) tipli, SALT OKUNUR API istemcisi: yalnız bugün VAR OLAN control-api rotalarını (GET /v1/attention, GET /v1/control/status) okur; taşıma enjekte edilir, gizli anahtar paket içinde yoktur, yanıtlar katı doğrulanır (bozuk yanıt = hata, uydurma veri yok). Telefondan erişim ağ geçidi (UASCO-T0084) gelene dek yoktur.

/** Existing server routes the companion reads. Both exist today but bind to 127.0.0.1 behind the desktop control token: not reachable from a phone. */
export const COMPANION_ROUTES = {
  attention: {method: "GET", path: "/v1/attention", exists: true},
  controlStatus: {method: "GET", path: "/v1/control/status", exists: true},
} as const;
export type CompanionRoute = keyof typeof COMPANION_ROUTES;

/** Why a phone cannot reach these routes today. Flip only when the device-scoped gateway (UASCO-T0084) exists. */
export const PHONE_REACHABILITY = {
  reachable: false,
  reason: "LOOPBACK_ONLY_NO_MOBILE_GATEWAY",
  detail: "control-api binds 127.0.0.1 with a Host check and the desktop control token; /v1/mobile + gateway (UASCO-T0084) is not built",
} as const;

/** Injected transport. The companion never embeds a credential: the transport (desktop-tethered dev harness or a future gateway) owns auth. */
export interface CompanionTransport {
  get(path: string): Promise<{status: number; body: unknown}>;
}

export type ApiResult<T> =
  | {kind: "ok"; data: T}
  | {kind: "denied"; code: string}
  | {kind: "offline"; code: string}
  | {kind: "error"; code: string};

export const ATTENTION_KINDS = ["RUN_AWAITING_APPROVAL", "RUN_NEEDS_DECISION", "MISSION_FOUNDER_ATTENTION", "MISSION_AUTHORIZATION_PENDING", "MISSION_BLOCKED", "TASK_BLOCKED"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export const NEXT_ACTIONS = ["PREPARE_DELIVERY", "ACCEPT_DELIVERY", "REVIEW_RUN", "REVIEW_MISSION", "AUTHORIZE_MISSION", "UNBLOCK_TASK"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export interface AttentionItem {
  readonly kind: AttentionKind; readonly nextAction: NextAction; readonly projectId: string; readonly missionId: string;
  readonly runId: string | null; readonly taskId: string | null; readonly title: string; readonly reason: string | null; readonly since: string | null;
}
export interface AttentionQueue { readonly items: readonly AttentionItem[]; readonly counts: Readonly<Record<AttentionKind, number>>; readonly truncated: boolean; readonly source: "WORKOS" }

export const JOURNAL_STATES = ["OK", "ABSENT", "TORN_TAIL", "TAMPERED", "UNAVAILABLE"] as const;
export interface ControlStatus {
  readonly globalStop: {readonly active: boolean; readonly reason: string | null};
  readonly journal: {readonly state: (typeof JOURNAL_STATES)[number]; readonly reason: string | null};
  /** Present when the server could not verify the stop artifact (it then reports an active, fail-closed stop). */
  readonly verification: "REJECTED" | null;
}

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300;
const clip = (v: string | null, n: number) => (v === null ? null : v.slice(0, n));

export function parseAttentionItem(v: unknown): AttentionItem | null {
  const o = rec(v);
  if (!o) return null;
  if (!(ATTENTION_KINDS as readonly unknown[]).includes(o.kind) || !(NEXT_ACTIONS as readonly unknown[]).includes(o.nextAction)) return null;
  if (!nonEmpty(o.projectId) || !nonEmpty(o.missionId) || typeof o.title !== "string") return null;
  if (!strOrNull(o.runId) || !strOrNull(o.taskId) || !strOrNull(o.reason) || !strOrNull(o.since)) return null;
  return {kind: o.kind as AttentionKind, nextAction: o.nextAction as NextAction, projectId: o.projectId, missionId: o.missionId, runId: o.runId, taskId: o.taskId,
    title: o.title.slice(0, 200), reason: clip(o.reason, 500), since: o.since};
}

/** Strict: a malformed queue is an error, never a partially invented list. */
export function parseAttention(body: unknown): AttentionQueue | null {
  const q = rec(rec(body)?.attention);
  if (!q || q.source !== "WORKOS" || typeof q.truncated !== "boolean" || !Array.isArray(q.items)) return null;
  const c = rec(q.counts);
  if (!c) return null;
  const counts = {} as Record<AttentionKind, number>;
  for (const k of ATTENTION_KINDS) { const n = c[k]; if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return null; counts[k] = n; }
  const items: AttentionItem[] = [];
  for (const raw of q.items) { const it = parseAttentionItem(raw); if (!it) return null; items.push(it); }
  return {items, counts, truncated: q.truncated, source: "WORKOS"};
}

export function parseControlStatus(body: unknown): ControlStatus | null {
  const o = rec(body), gs = rec(o?.globalStop), wo = rec(o?.workos);
  if (!o || !gs || typeof gs.active !== "boolean" || !wo || !(JOURNAL_STATES as readonly unknown[]).includes(wo.state)) return null;
  const reason = typeof gs.reason === "string" ? gs.reason.slice(0, 300) : null;
  return {globalStop: {active: gs.active, reason}, journal: {state: wo.state as ControlStatus["journal"]["state"], reason: typeof wo.reason === "string" ? wo.reason.slice(0, 300) : null},
    verification: o.verification === "REJECTED" ? "REJECTED" : null};
}

export interface CompanionClient {
  attention(): Promise<ApiResult<AttentionQueue>>;
  controlStatus(): Promise<ApiResult<ControlStatus>>;
}

/** Read-only client: GET only; no write method exists on this interface. */
export function createCompanionClient(t: CompanionTransport): CompanionClient {
  async function read<T>(route: CompanionRoute, parse: (b: unknown) => T | null): Promise<ApiResult<T>> {
    let res: {status: number; body: unknown};
    try { res = await t.get(COMPANION_ROUTES[route].path); } catch { return {kind: "offline", code: "UNREACHABLE"}; }
    if (res.status === 401 || res.status === 403) return {kind: "denied", code: "FORBIDDEN"};
    if (res.status === 421) return {kind: "denied", code: "HOST_REJECTED"};
    if (res.status === 503) return {kind: "error", code: "SERVER_NOT_READY"};
    if (res.status !== 200) return {kind: "error", code: `HTTP_${res.status}`};
    const data = parse(res.body);
    return data === null ? {kind: "error", code: "MALFORMED_RESPONSE"} : {kind: "ok", data};
  }
  return {attention: () => read("attention", parseAttention), controlStatus: () => read("controlStatus", parseControlStatus)};
}
