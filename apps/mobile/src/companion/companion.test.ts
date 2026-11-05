// //TR: Mobil Companion birim + bileşen testleri (UASCO-T0083): katı yanıt ayrıştırma (bozuk = hata), salt okunur istemci durum eşlemesi, ekran modelleri, onay eylemlerinin nedenli KAPALI olması ve kaçışlı önizleme işlemesi. Ağ ve gerçek sunucu yok (sahte taşıma).
import {describe, expect, it} from "vitest";
import {COMPANION_ROUTES, PHONE_REACHABILITY, createCompanionClient, parseAttention, parseControlStatus, type AttentionItem, type CompanionTransport} from "./api-client.js";
import {APPROVAL_KINDS, MOBILE_APPROVAL_DISABLED_REASON, NOTIFICATION_SOURCE, approvalAction, approvalDetail, approvalsList, itemId, notificationsList, statusOverview} from "./screens.js";
import {esc, previewDocument, renderApprovalDetail, renderApprovals, renderNotifications, renderStatus} from "./render-html.js";

const ZERO = {RUN_AWAITING_APPROVAL: 0, RUN_NEEDS_DECISION: 0, MISSION_FOUNDER_ATTENTION: 0, MISSION_AUTHORIZATION_PENDING: 0, MISSION_BLOCKED: 0, TASK_BLOCKED: 0};
const item = (o: Partial<AttentionItem> = {}): AttentionItem => ({kind: "RUN_AWAITING_APPROVAL", nextAction: "ACCEPT_DELIVERY", projectId: "prj_1", missionId: "msn_1",
  runId: "run_1", taskId: null, title: "Deliver feature", reason: null, since: "2026-11-05T10:00:00.000Z", ...o});
const queueBody = (items: AttentionItem[], counts = ZERO, truncated = false) => ({attention: {items, counts, truncated, source: "WORKOS"}});
const transport = (routes: Record<string, {status: number; body: unknown} | Error>): CompanionTransport & {calls: string[]} => {
  const calls: string[] = [];
  return {calls, async get(p) { calls.push(p); const r = routes[p]; if (!r) return {status: 404, body: {}}; if (r instanceof Error) throw r; return r; }};
};
const STATUS_OK = {globalStop: {active: false}, workos: {state: "OK", reason: null, tornTail: null}};

describe("UASCO-T0083 companion API client (read-only, strict)", () => {
  it("parses the real /v1/attention and /v1/control/status shapes; positive controls", () => {
    const q = parseAttention(queueBody([item(), item({kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", taskId: "tsk_1", runId: null})], {...ZERO, RUN_AWAITING_APPROVAL: 1, TASK_BLOCKED: 1}));
    expect(q?.items.length).toBe(2);
    expect(q?.counts.TASK_BLOCKED).toBe(1);
    expect(parseControlStatus(STATUS_OK)).toEqual({globalStop: {active: false, reason: null}, journal: {state: "OK", reason: null}, verification: null});
    expect(parseControlStatus({globalStop: {active: true, reason: "GLOBAL_STOP_STATE_UNSAFE"}, verification: "REJECTED", workos: {state: "OK", reason: null}}))
      .toEqual({globalStop: {active: true, reason: "GLOBAL_STOP_STATE_UNSAFE"}, journal: {state: "OK", reason: null}, verification: "REJECTED"});
  });

  it("a malformed response is rejected as a whole (no partial or invented list)", () => {
    const good = queueBody([item()], {...ZERO, RUN_AWAITING_APPROVAL: 1});
    const bad: unknown[] = [
      null, {}, {attention: {...good.attention, source: "SCHEDULER"}}, {attention: {...good.attention, truncated: "no"}},
      {attention: {...good.attention, counts: {...ZERO, TASK_BLOCKED: -1}}}, {attention: {...good.attention, counts: {RUN_AWAITING_APPROVAL: 1}}},
      queueBody([item({kind: "SOMETHING" as never})]), queueBody([item({nextAction: "MERGE" as never})]), queueBody([item({missionId: ""})]),
      queueBody([item({runId: 5 as never})]), queueBody([item(), "x" as never]),
    ];
    expect(parseAttention(good)).not.toBeNull();
    for (const b of bad) expect(parseAttention(b), JSON.stringify(b)).toBeNull();
    for (const b of [null, {globalStop: {active: "no"}, workos: {state: "OK"}}, {globalStop: {active: false}}, {globalStop: {active: false}, workos: {state: "FINE"}}])
      expect(parseControlStatus(b)).toBeNull();
  });

  it("maps transport outcomes: 200 ok, 403 denied, 421 host denied, 503, other HTTP, malformed and thrown (offline); GET only on existing routes", async () => {
    const t = transport({"/v1/attention": {status: 200, body: queueBody([])}, "/v1/control/status": {status: 403, body: {error: "FORBIDDEN"}}});
    const c = createCompanionClient(t);
    expect(await c.attention()).toEqual({kind: "ok", data: {items: [], counts: ZERO, truncated: false, source: "WORKOS"}});
    expect(await c.controlStatus()).toEqual({kind: "denied", code: "FORBIDDEN"});
    expect(t.calls).toEqual([COMPANION_ROUTES.attention.path, COMPANION_ROUTES.controlStatus.path]);
    const cases: Array<[{status: number; body: unknown} | Error, unknown]> = [
      [{status: 421, body: {}}, {kind: "denied", code: "HOST_REJECTED"}], [{status: 503, body: {}}, {kind: "error", code: "SERVER_NOT_READY"}],
      [{status: 500, body: {}}, {kind: "error", code: "HTTP_500"}], [{status: 200, body: {attention: null}}, {kind: "error", code: "MALFORMED_RESPONSE"}],
      [new Error("ECONNREFUSED"), {kind: "offline", code: "UNREACHABLE"}],
    ];
    for (const [r, want] of cases) expect(await createCompanionClient(transport({"/v1/attention": r})).attention()).toEqual(want);
    expect(Object.keys(c).sort()).toEqual(["attention", "controlStatus"]);   // no write method exists
    expect(Object.values(COMPANION_ROUTES).every(r => r.method === "GET" && r.exists)).toBe(true);
    expect(PHONE_REACHABILITY.reachable).toBe(false);
  });
});

describe("UASCO-T0083 companion screens", () => {
  const q = (items: AttentionItem[], truncated = false) => ({kind: "ok" as const, data: parseAttention(queueBody(items, ZERO, truncated))!});
  const st = {kind: "ok" as const, data: parseControlStatus(STATUS_OK)!};

  it("status overview: values only from the reads; a failed status read is never shown as healthy; unknown stays null", () => {
    const ok = statusOverview(st, q([item()]));
    expect(ok.header.state).toBe("OK");
    expect(ok.globalStop).toEqual({active: false, reason: null});
    expect(ok.journal).toEqual({state: "OK", healthy: true, reason: null});
    expect(ok.phoneReachable).toBe(false);
    const down = statusOverview({kind: "offline", code: "UNREACHABLE"}, q([item()]));
    expect(down.header).toEqual({state: "OFFLINE", banner: "UNREACHABLE", source: "GET /v1/control/status"});
    expect(down.globalStop).toBeNull();
    expect(down.journal).toBeNull();
    const noQueue = statusOverview(st, {kind: "error", code: "MALFORMED_RESPONSE"});
    expect(noQueue.header.state).toBe("ERROR");
    expect(noQueue.attentionCounts).toBeNull();
    expect(statusOverview({kind: "ok", data: {...st.data, journal: {state: "TAMPERED", reason: "HASH_MISMATCH"}}}, q([])).journal?.healthy).toBe(false);
  });

  it("approvals list keeps only decision kinds; detail resolves by server ids; approve/reject are DISABLED with the reason (positive: item found)", () => {
    const items = [item(), item({kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", runId: null, taskId: "tsk_9", title: "Blocked task"}),
      item({kind: "MISSION_AUTHORIZATION_PENDING", nextAction: "AUTHORIZE_MISSION", runId: null, missionId: "msn_2", title: "Authorize"})];
    const l = approvalsList(q(items));
    expect(l.rows.map(r => r.kind)).toEqual(["RUN_AWAITING_APPROVAL", "MISSION_AUTHORIZATION_PENDING"]);
    expect(l.rows.every(r => APPROVAL_KINDS.includes(r.kind))).toBe(true);
    const d = approvalDetail(q(items), l.rows[0].id);
    expect(d.found).toBe(true);
    expect(d.approve).toEqual({enabled: false, reason: MOBILE_APPROVAL_DISABLED_REASON, desktopRoute: "POST /v1/work-runs/:id/delivery/accept"});
    expect(d.reject?.enabled).toBe(false);
    expect(approvalDetail(q(items), itemId(items[1])).found).toBe(false);   // a blocked task is not an approval
    expect(approvalDetail(q(items), "nope").found).toBe(false);
    expect(approvalDetail({kind: "denied", code: "FORBIDDEN"}, l.rows[0].id).found).toBe(false);
    expect(approvalsList(q([])).header.state).toBe("EMPTY");
    expect(approvalsList({kind: "denied", code: "FORBIDDEN"})).toEqual({header: {state: "DENIED", banner: "FORBIDDEN", source: "GET /v1/attention"}, rows: [], truncated: false});
    for (const k of ["ACCEPT_DELIVERY", "PREPARE_DELIVERY", "REVIEW_RUN", "REVIEW_MISSION", "AUTHORIZE_MISSION", "UNBLOCK_TASK"] as const)
      expect(approvalAction(item({nextAction: k})).approve.enabled).toBe(false);
  });

  it("notifications are derived from the attention queue and labelled so; severity by kind; empty and error states", () => {
    const n = notificationsList(q([item({reason: "PROVIDER_QUOTA"}), item({kind: "MISSION_BLOCKED", nextAction: "REVIEW_MISSION", runId: null})]));
    expect(n.header.source).toBe(NOTIFICATION_SOURCE);
    expect(n.rows.map(r => r.severity)).toEqual(["ACTION", "BLOCKED"]);
    expect(n.rows[0].text).toBe("RUN_AWAITING_APPROVAL: Deliver feature (PROVIDER_QUOTA)");
    expect(notificationsList(q([])).header.state).toBe("EMPTY");
    expect(notificationsList({kind: "offline", code: "UNREACHABLE"}).rows).toEqual([]);
  });
});

describe("UASCO-T0083 preview renderer (component level)", () => {
  const evil = item({title: `<img src=x onerror=alert(1)>"'&`, reason: "<script>x</script>"});
  const q = {kind: "ok" as const, data: parseAttention(queueBody([evil]))!};

  it("escapes every server string; approve/reject buttons are rendered disabled with the reason; no script in the document", () => {
    const list = renderApprovals(approvalsList(q)), detail = renderApprovalDetail(approvalDetail(q, itemId(evil))), notes = renderNotifications(notificationsList(q));
    for (const html of [list, detail, notes]) { expect(html).not.toMatch(/<img|<script/i); expect(html).toContain(esc(evil.title)); }
    expect(detail.match(/<button[^>]*disabled aria-disabled="true"/g)?.length).toBe(2);
    expect(detail).toContain(esc(MOBILE_APPROVAL_DISABLED_REASON));
    expect(previewDocument("t", detail)).not.toMatch(/<script/i);
    expect(renderApprovalDetail(approvalDetail(q, "missing"))).toContain("NOT_FOUND");
    const nul = item({runId: null, taskId: null, reason: null, since: null}), qn = {kind: "ok" as const, data: parseAttention(queueBody([nul]))!};
    const dn = renderApprovalDetail(approvalDetail(qn, itemId(nul)));
    for (const k of ["Run", "Task", "Reason", "Since"]) expect(dn).toContain(`<dt>${k}</dt><dd>—</dd>`);   // unknown is an em dash, never 0
  });

  it("status renders unknown values as an em dash (never a number) and the phone link as NOT_CONNECTED", () => {
    const html = renderStatus(statusOverview({kind: "offline", code: "UNREACHABLE"}, {kind: "offline", code: "UNREACHABLE"}));
    expect(html).toContain('data-field="globalStop">—<');
    expect(html).toContain('data-field="journal">—<');
    expect(html).toContain("NOT_CONNECTED: LOOPBACK_ONLY_NO_MOBILE_GATEWAY");
    expect(html).toContain('<p class="counts">—</p>');
  });
});
