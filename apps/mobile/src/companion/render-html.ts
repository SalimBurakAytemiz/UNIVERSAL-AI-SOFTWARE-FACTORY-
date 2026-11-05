// //TR: Mobil Companion önizleme işleyicisi: ekran modellerini kaçışlı, statik HTML'e çevirir (bileşen testleri ve ekran görüntüsü için). Bu bir React Native/Android derlemesi DEĞİLDİR; betik, ağ çağrısı veya gizli veri içermez. Onayla/Reddet düğmeleri her zaman disabled ve nedenli işlenir.
import type {ApprovalDetail, ApprovalsList, NotificationsList, ScreenHeader, StatusOverview} from "./screens.js";

const ESC: Record<string, string> = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
export const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, ch => ESC[ch]!);
const dash = (v: unknown) => (v === null || v === undefined ? "—" : esc(v));

function head(h: ScreenHeader): string {
  return `<div class="hdr" data-state="${esc(h.state)}"><span class="state">${esc(h.state)}</span>${h.banner ? `<span class="banner">${esc(h.banner)}</span>` : ""}<span class="src">${esc(h.source)}</span></div>`;
}
const page = (title: string, body: string) =>
  `<section class="screen" aria-label="${esc(title)}"><h1>${esc(title)}</h1>${body}</section>`;

export function renderStatus(s: StatusOverview): string {
  const stop = s.globalStop === null ? "—" : s.globalStop.active ? `ACTIVE${s.globalStop.reason ? `: ${esc(s.globalStop.reason)}` : ""}` : "inactive";
  const journal = s.journal === null ? "—" : `${esc(s.journal.state)}${s.journal.reason ? ` (${esc(s.journal.reason)})` : ""}`;
  const counts = s.attentionCounts === null ? "<p class=\"counts\">—</p>"
    : `<ul class="counts">${Object.entries(s.attentionCounts).map(([k, n]) => `<li data-kind="${esc(k)}">${esc(k)}: ${esc(n)}</li>`).join("")}</ul>${s.attentionTruncated ? "<p class=\"trunc\">TRUNCATED</p>" : ""}`;
  return page("Status", `${head(s.header)}<dl><dt>Global STOP</dt><dd data-field="globalStop">${stop}</dd><dt>Work OS journal</dt><dd data-field="journal">${journal}</dd>`
    + `${s.verificationRejected ? "<dt>Verification</dt><dd data-field=\"verification\">REJECTED</dd>" : ""}<dt>Phone link</dt><dd data-field="reach">${s.phoneReachable ? "CONNECTED" : `NOT_CONNECTED: ${esc(s.reachabilityNote)}`}</dd></dl>${counts}`);
}

export function renderApprovals(l: ApprovalsList): string {
  const rows = l.rows.map(r => `<li data-id="${esc(r.id)}"><b>${esc(r.title)}</b><span>${esc(r.kind)}</span><span>${esc(r.nextAction)}</span><time>${dash(r.since)}</time></li>`).join("");
  return page("Pending approvals", `${head(l.header)}<ul class="rows">${rows}</ul>${l.truncated ? "<p class=\"trunc\">TRUNCATED</p>" : ""}`);
}

export function renderApprovalDetail(d: ApprovalDetail): string {
  if (!d.found || !d.item) return page("Approval", "<p class=\"missing\">NOT_FOUND</p>");
  const i = d.item;
  const btn = (label: string, a: NonNullable<ApprovalDetail["approve"]>) =>
    `<button type="button" disabled aria-disabled="true" data-action="${esc(label.toLowerCase())}" title="${esc(a.reason)}">${esc(label)}</button>`;
  return page("Approval", `<dl><dt>Title</dt><dd>${esc(i.title)}</dd><dt>Kind</dt><dd>${esc(i.kind)}</dd><dt>Project</dt><dd>${esc(i.projectId)}</dd><dt>Mission</dt><dd>${esc(i.missionId)}</dd>`
    + `<dt>Run</dt><dd>${dash(i.runId)}</dd><dt>Task</dt><dd>${dash(i.taskId)}</dd><dt>Reason</dt><dd>${dash(i.reason)}</dd><dt>Since</dt><dd>${dash(i.since)}</dd></dl>`
    + `<div class="actions">${btn("Approve", d.approve!)}${btn("Reject", d.reject!)}</div><p class="disabled-reason">${esc(d.approve!.reason)}</p>`
    + `<p class="desktop-route">Desktop route: ${dash(d.approve!.desktopRoute)}</p>`);
}

export function renderNotifications(n: NotificationsList): string {
  const rows = n.rows.map(r => `<li data-id="${esc(r.id)}" data-severity="${esc(r.severity)}"><span>${esc(r.severity)}</span>${esc(r.text)}<time>${dash(r.at)}</time></li>`).join("");
  return page("Notifications", `${head(n.header)}<ul class="rows">${rows}</ul>`);
}

export const PREVIEW_CSS = `body{font:14px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#111}.screen{max-width:390px;margin:0 auto;padding:16px;background:#fff;min-height:100vh}
h1{font-size:20px;margin:0 0 8px}.hdr{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;margin-bottom:12px}.state{font-weight:700}.banner{color:#b00020}.src{color:#666}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px}dt{color:#555}dd{margin:0;word-break:break-word}ul{list-style:none;padding:0}li{border-bottom:1px solid #eee;padding:8px 0;display:flex;flex-direction:column;gap:2px}
.actions{display:flex;gap:8px;margin-top:12px}button[disabled]{opacity:.5;padding:8px 16px}.disabled-reason{font-size:12px;color:#b00020}.trunc{color:#a60}`;
/** Full preview document (no scripts). */
export const previewDocument = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PREVIEW_CSS}</style></head><body>${body}</body></html>`;
