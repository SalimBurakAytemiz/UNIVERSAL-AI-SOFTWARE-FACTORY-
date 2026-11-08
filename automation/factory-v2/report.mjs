// //TR: Factory V2 Founder kontrol raporu: tek komutla (factory report) paylaşımlı günlükten gerçek işçi oturumları (aktif/bekleyen/boşta/kayıp), her oturumun görevi ve ilerlemesi, görev kuyruğu ve bağımlılıklar, PR/review/CI/merge durumu, kota ve kapasite (ölçülmediyse UNKNOWN), Founder kararı bekleyen işler, ürün kanıtı (ekran görüntüsü, E2E) ve kalan işler/engeller tek belgede üretilir. Rapor hiçbir şeyi uydurmaz: kaynağı olmayan alan UNKNOWN olarak gösterilir.
export const UNKNOWN = "UNKNOWN";
const FOUNDER_RE = /FOUNDER|PROTECTED|GOVERNANCE|SECURITY|AUTHORIZATION|SCOPE_VIOLATION/i;

/**
 * Pure report over: journal (StateJournal), backlog (tasks with id/name/deps/area), supervisor ({state, sessionId, epoch, target, mode}),
 * github ({openPrs:[{number,title,headSha,baseRef,draft,checks:{name:conclusion},binding:{verdict,head,base}|null,founderWaiting}]}|null),
 * quota (object|null), acceptance ([{id,status,condition}]|null), now.
 */
export function buildReport({journal, backlog = [], supervisor = {}, github = null, quota = null, acceptance = null, now = Date.now()}) {
  journal.reload?.();
  const workers = [...journal.workers.values()];
  const tasks = [...journal.tasks.values()];
  const byTask = new Map(); for (const w of workers) (byTask.get(w.taskId) ?? byTask.set(w.taskId, []).get(w.taskId)).push(w);
  const target = supervisor.target ?? {};
  const roleSessions = role => {
    const ws = workers.filter(w => w.role === role);
    const running = ws.filter(w => w.status === "RUNNING"), pending = ws.filter(w => w.status === "PENDING_SPAWN");
    const cap = role === "BUILDER" ? target.builders : target.reviewers;
    return {capacity: cap ?? UNKNOWN, running: running.length, pendingSpawn: pending.length, idleSlots: typeof cap === "number" ? Math.max(0, cap - running.length - pending.length) : UNKNOWN,
      lost: ws.filter(w => w.status === "LOST").length, completed: ws.filter(w => w.status === "COMPLETED").length};
  };
  const sessions = workers.filter(w => ["RUNNING", "PENDING_SPAWN"].includes(w.status)).map(w => {
    const t = journal.get(w.taskId);
    return {intentId: w.intentId, role: w.role, status: w.status === "RUNNING" ? "ACTIVE" : "AWAITING_SPAWN", sessionId: w.sessionId ?? null, taskId: w.taskId, attempt: w.attempt,
      taskState: t?.state ?? UNKNOWN, branch: w.branch ?? null, ageMin: Math.round((now - (w.boundAt ?? w.createdAt ?? now)) / 60_000),
      modelRequested: w.routing?.requestedModel ?? UNKNOWN, modelClass: w.routing?.modelClass ?? UNKNOWN, modelServed: w.model?.servedModel ?? UNKNOWN, costUsdReported: w.model?.costUsdReported ?? UNKNOWN};
  });
  const blockedSessions = workers.filter(w => w.status === "LOST" && journal.get(w.taskId) && !["VERIFIED", "MERGED", "FAILED"].includes(journal.get(w.taskId).state))
    .map(w => ({intentId: w.intentId, role: w.role, sessionId: w.sessionId ?? null, taskId: w.taskId, reason: w.reason ?? null}));
  const doneIds = new Set(tasks.filter(t => ["MERGED", "VERIFIED"].includes(t.state)).map(t => t.taskId));
  const taskRows = tasks.map(t => {
    const ws = byTask.get(t.taskId) ?? [], cur = ws.filter(w => w.attempt === t.attempt);
    const spec = backlog.find(b => b.id === t.taskId);
    return {taskId: t.taskId, name: t.data.name ?? spec?.name ?? null, area: t.data.area ?? spec?.domain ?? null, state: t.state, attempt: t.attempt,
      owners: cur.filter(w => ["RUNNING", "PENDING_SPAWN", "RESULT_ACCEPTED"].includes(w.status)).map(w => `${w.role}:${w.sessionId ?? "pending"}`),
      deps: spec?.deps ?? [], waitingOn: (spec?.deps ?? []).filter(d => !doneIds.has(d)),
      pr: t.facts?.PR ?? (t.data.pr ? {number: t.data.pr} : null), ci: t.facts?.CI ?? null,
      review: t.facts?.REVIEW ?? (t.data.verdicts?.length ? {verdicts: t.data.verdicts.map(v => `${v.focus ?? ""}:${v.status}`)} : null),
      merge: t.facts?.MERGE ?? (t.data.resultSha ? {resultSha: t.data.resultSha} : null), headSha: t.data.headSha ?? null,
      blocker: t.state === "BLOCKED" || t.state === "FAILED" ? (t.data.reason ?? t.data.lastError ?? t.data.mergeBlock ?? UNKNOWN) : null,
      evidence: t.facts?.EVIDENCE ?? []};
  });
  const queued = backlog.filter(b => !journal.get(b.id) || journal.get(b.id).state === "QUEUED").map(b => ({taskId: b.id, name: b.name ?? null, deps: b.deps ?? [], waitingOn: (b.deps ?? []).filter(d => !doneIds.has(d))}));
  const founderDecisions = [
    ...taskRows.filter(t => t.state === "BLOCKED" && FOUNDER_RE.test(JSON.stringify(t.blocker))).map(t => ({kind: "TASK_BLOCKED", taskId: t.taskId, reason: t.blocker})),
    ...(github?.openPrs ?? []).filter(p => p.founderWaiting).map(p => ({kind: "PR_FOUNDER_AUTHORITY", pr: p.number, title: p.title, headSha: p.headSha})),
    ...(acceptance ?? []).filter(a => a.status !== "MET").map(a => ({kind: "CUTOVER_CONDITION", id: a.id, status: a.status, condition: a.condition}))
  ];
  const productEvidence = taskRows.flatMap(t => t.evidence.map(e => ({taskId: t.taskId, ...e})));
  // per model: only platform-reported figures (get_session usage.cost_usd); a worker without an observation is counted as unknown, never estimated
  const models = {};
  for (const w of workers.filter(x => x.routing)) {
    const k = w.model?.servedModel ?? `${w.routing.requestedModel} (not yet observed)`;
    const m = models[k] ??= {workers: 0, costUsdReported: 0, unknownCost: 0};
    m.workers++;
    if (typeof w.model?.costUsdReported === "number") m.costUsdReported += w.model.costUsdReported; else m.unknownCost++;
  }
  return {
    generatedAt: new Date(now).toISOString(),
    supervisor: {mode: supervisor.mode ?? UNKNOWN, state: supervisor.state ?? UNKNOWN, sessionId: supervisor.sessionId ?? UNKNOWN, epoch: supervisor.epoch ?? UNKNOWN, ledgerSeq: journal.seq},
    capacity: {builders: roleSessions("BUILDER"), reviewers: roleSessions("REVIEWER"), mergePreparers: target.mergePreparers ?? UNKNOWN, mergeWriters: target.mergeWriters ?? UNKNOWN},
    sessions, blockedSessions,
    tasks: {counts: Object.fromEntries([...new Set(tasks.map(t => t.state))].sort().map(s => [s, tasks.filter(t => t.state === s).length])), rows: taskRows},
    queue: queued,
    github: github ? {openPrs: github.openPrs} : UNKNOWN,
    quota: quota ?? UNKNOWN,
    founderDecisions, productEvidence: productEvidence.length ? productEvidence : [], models,
    remaining: {open: taskRows.filter(t => !["VERIFIED", "MERGED", "FAILED"].includes(t.state)).length + queued.filter(q => !journal.get(q.taskId)).length,
      blockers: taskRows.filter(t => t.blocker).map(t => ({taskId: t.taskId, blocker: t.blocker}))}
  };
}

const cell = v => (v === null || v === undefined ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\|/g, "\\|").slice(0, 120);
export function renderMarkdown(r) {
  const L = [];
  L.push(`# UASCO Factory V2 report (${r.generatedAt})`, "");
  L.push(`Supervisor: ${r.supervisor.sessionId} | mode ${r.supervisor.mode} | state ${r.supervisor.state} | epoch ${r.supervisor.epoch} | ledger seq ${r.supervisor.ledgerSeq}`, "");
  L.push("## Capacity and sessions", "| Role | Capacity | Active | Awaiting spawn | Idle slots | Lost | Completed |", "|---|---|---|---|---|---|---|");
  for (const [k, v] of [["Builders", r.capacity.builders], ["Reviewers", r.capacity.reviewers]]) L.push(`| ${k} | ${cell(v.capacity)} | ${v.running} | ${v.pendingSpawn} | ${cell(v.idleSlots)} | ${v.lost} | ${v.completed} |`);
  L.push(`| Merge preparers | ${cell(r.capacity.mergePreparers)} | in-process | - | - | - | - |`, `| Merge writer | ${cell(r.capacity.mergeWriters)} | in-process | - | - | - | - |`, "");
  if (r.sessions.length) { L.push("| Session | Role | Status | Task | Task state | Model requested / served | Age (min) |", "|---|---|---|---|---|---|---|"); for (const s of r.sessions) L.push(`| ${cell(s.sessionId ?? s.intentId)} | ${s.role} | ${s.status} | ${cell(s.taskId)} a${s.attempt} | ${s.taskState} | ${cell(s.modelRequested)} / ${cell(s.modelServed)} | ${s.ageMin} |`); L.push(""); }
  if (Object.keys(r.models ?? {}).length) {
    L.push("Models (served model, platform-reported cost; UNKNOWN where not reported):");
    for (const [k, v] of Object.entries(r.models)) L.push(`- ${k}: ${v.workers} worker(s), USD ${v.costUsdReported.toFixed(4)} reported${v.unknownCost ? `, ${v.unknownCost} without a reported cost` : ""}`);
    L.push("");
  }
  if (r.blockedSessions.length) { L.push("Lost sessions with unfinished tasks:"); for (const s of r.blockedSessions) L.push(`- ${cell(s.sessionId ?? s.intentId)} (${s.role}) task ${s.taskId}: ${cell(s.reason)}`); L.push(""); }
  L.push("## Tasks", `Counts: ${cell(r.tasks.counts)}`, "", "| Task | Area | State | Owners | PR | Review | CI | Merge | Blocker |", "|---|---|---|---|---|---|---|---|---|");
  for (const t of r.tasks.rows) L.push(`| ${cell(t.taskId)} ${cell(t.name)} | ${cell(t.area)} | ${t.state} a${t.attempt} | ${cell(t.owners.join(", "))} | ${cell(t.pr)} | ${cell(t.review)} | ${cell(t.ci)} | ${cell(t.merge)} | ${cell(t.blocker)} |`);
  L.push("", "## Queue and dependencies"); for (const q of r.queue) L.push(`- ${q.taskId} ${cell(q.name)}${q.waitingOn.length ? ` (waiting on ${q.waitingOn.join(", ")})` : ""}`);
  if (!r.queue.length) L.push("- (empty)");
  L.push("", "## Open PRs, review and CI");
  if (r.github === UNKNOWN) L.push("UNKNOWN (GitHub not queried)");
  else for (const p of r.github.openPrs) L.push(`- #${p.number} ${cell(p.title)} head ${String(p.headSha).slice(0, 8)} -> ${p.baseRef}${p.draft ? " (draft)" : ""}; review: ${p.binding ? `${p.binding.verdict} @${String(p.binding.head).slice(0, 8)}` : "none bound to head"}; CI: ${cell(p.checks)}`);
  L.push("", "## Quota", r.quota === UNKNOWN ? "UNKNOWN (no measured quota source)" : cell(r.quota));
  L.push("", "## Founder decisions"); for (const d of r.founderDecisions) L.push(`- ${d.kind}: ${cell(d.taskId ?? d.pr ?? d.id)} ${cell(d.reason ?? d.title ?? d.condition)}`); if (!r.founderDecisions.length) L.push("- none");
  L.push("", "## Product evidence (screenshots, E2E, test results)"); for (const e of r.productEvidence) L.push(`- ${e.taskId}: ${cell(e.kind)} ${cell(e.path ?? e.url ?? e.result ?? e.summary)}`); if (!r.productEvidence.length) L.push("- none recorded");
  L.push("", "## Remaining", `Open tasks: ${r.remaining.open}`); for (const b of r.remaining.blockers) L.push(`- blocker ${b.taskId}: ${cell(b.blocker)}`);
  return L.join("\n") + "\n";
}

/** Parse the acceptance table of docs/factory-v2/CUTOVER-ACCEPTANCE.md into rows (id, condition, status). */
export function parseAcceptance(md) {
  return String(md).split("\n").map(l => /^\|\s*([AB]\d+)\s*\|\s*(.+?)\s*\|\s*([A-Z_]+)(?:\s*\([^)]*\))?\s*\|/.exec(l)).filter(Boolean).map(m => ({id: m[1], condition: m[2], status: m[3]}));
}
