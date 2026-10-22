//TR: Bu dosya Founder dikkat kuyruğunu yalnız Work OS store'daki doğrulanmış kayıtlardan türetir (karar bekleyen mission/koşu, engelli mission/görev, başarısız koşu); eski scheduler kaynağı kullanılmaz, kayıt yoksa liste boştur ve hiçbir öğe uydurulmaz.
import type {Scope, WorkRun} from "./types.js";
import type {WorkOsStore} from "./store.js";
import {redactSecrets} from "./secret-scan.js";

export type AttentionKind =
  | "RUN_AWAITING_APPROVAL" | "RUN_NEEDS_DECISION" | "MISSION_FOUNDER_ATTENTION" | "MISSION_AUTHORIZATION_PENDING" | "MISSION_BLOCKED" | "TASK_BLOCKED";
export type NextAction = "PREPARE_DELIVERY" | "ACCEPT_DELIVERY" | "REVIEW_RUN" | "REVIEW_MISSION" | "AUTHORIZE_MISSION" | "UNBLOCK_TASK";
export interface AttentionItem {
  kind: AttentionKind; nextAction: NextAction; projectId: string; missionId: string; runId: string | null; taskId: string | null;
  title: string; reason: string | null; since: string | null;
}
export interface AttentionQueue { items: AttentionItem[]; counts: Record<AttentionKind, number>; truncated: boolean; source: "WORKOS" }

export const ATTENTION_MAX_ITEMS = 200;
const KINDS: readonly AttentionKind[] = ["RUN_AWAITING_APPROVAL", "RUN_NEEDS_DECISION", "MISSION_FOUNDER_ATTENTION", "MISSION_AUTHORIZATION_PENDING", "MISSION_BLOCKED", "TASK_BLOCKED"];
// Karar gerektiren koşu sonları: başarısız/engelli koşu Founder'ın yeniden deneme veya iptal kararını bekler.
const RUN_DECISION = new Set<WorkRun["status"]>(["FAILED", "RECOVERY_FAILED", "QUARANTINED", "BLOCKED"]);
// Önem sırası: Founder'ın şimdi eylemi gereken öğeler önce.
const RANK: Record<AttentionKind, number> = {
  RUN_AWAITING_APPROVAL: 0, MISSION_FOUNDER_ATTENTION: 1, RUN_NEEDS_DECISION: 2, MISSION_AUTHORIZATION_PENDING: 3, MISSION_BLOCKED: 4, TASK_BLOCKED: 5
};
const clean = (s: string | null | undefined, max: number): string | null => (typeof s === "string" && s.trim() ? redactSecrets(s).slice(0, max) : null);

export function deriveAttention(store: WorkOsStore, scope: Scope): AttentionQueue {
  const missions = store.listMissions(scope);
  const live = missions.filter(m => m.status !== "COMPLETE");
  const items: AttentionItem[] = [];
  const mission = (id: string) => missions.find(m => m.missionId === id);
  const counts = Object.fromEntries(KINDS.map(k => [k, 0])) as Record<AttentionKind, number>;
  const push = (i: AttentionItem) => { items.push(i); counts[i.kind]++; };

  for (const m of live) {
    const base = {projectId: m.projectId, missionId: m.missionId, runId: null, taskId: null, title: m.title.slice(0, 200), reason: null, since: null};
    if (m.status === "FOUNDER_ATTENTION_REQUIRED") push({...base, kind: "MISSION_FOUNDER_ATTENTION", nextAction: "REVIEW_MISSION"});
    else if (m.status === "PREFLIGHT") push({...base, kind: "MISSION_AUTHORIZATION_PENDING", nextAction: "AUTHORIZE_MISSION", since: m.createdAt});
    else if (m.status === "BLOCKED") push({...base, kind: "MISSION_BLOCKED", nextAction: "REVIEW_MISSION", since: m.createdAt});
    for (const t of store.listTasks(scope, m.missionId)) {
      if (t.status === "BLOCKED") push({...base, kind: "TASK_BLOCKED", nextAction: "UNBLOCK_TASK", taskId: t.taskId, title: t.title.slice(0, 200)});
    }
  }
  // Koşular: her mission için yalnız EN SON koşu değerlendirilir (eski başarısız koşu, yeni koşu varken dikkat istemez).
  const latest = new Map<string, WorkRun>();
  for (const r of store.listRuns(scope)) {
    const cur = latest.get(r.missionId);
    if (!cur || r.createdAt.localeCompare(cur.createdAt) > 0) latest.set(r.missionId, r);
  }
  for (const r of latest.values()) {
    const m = mission(r.missionId);
    if (!m || m.status === "COMPLETE") continue;
    const base = {projectId: r.projectId, missionId: r.missionId, runId: r.runId, taskId: null, title: m.title.slice(0, 200), reason: clean(r.reason, 300), since: r.updatedAt};
    if (r.status === "AWAITING_APPROVAL") {
      // Kabul edilmiş kaynak teslimi varsa karar verilmiştir; öğe kuyruktan düşer (acceptance mission'ı COMPLETE yapmaz, ama Founder kararı tamamdır).
      if (r.sourceDelivery) continue;
      push({...base, kind: "RUN_AWAITING_APPROVAL", nextAction: r.deliveryArtifact ? "ACCEPT_DELIVERY" : "PREPARE_DELIVERY"});
    } else if (RUN_DECISION.has(r.status)) push({...base, kind: "RUN_NEEDS_DECISION", nextAction: "REVIEW_RUN"});
  }
  items.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.since ?? "").localeCompare(a.since ?? "") || a.missionId.localeCompare(b.missionId) || (a.taskId ?? "").localeCompare(b.taskId ?? ""));
  const truncated = items.length > ATTENTION_MAX_ITEMS;
  return {items: items.slice(0, ATTENTION_MAX_ITEMS), counts, truncated, source: "WORKOS"};
}
