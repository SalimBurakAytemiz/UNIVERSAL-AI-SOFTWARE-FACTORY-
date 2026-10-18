//TR: CP-REPORT pure 60-minute production report core (fail-closed, no I/O)
const UNKNOWN = "UNKNOWN";
const DONE = new Set(["DONE", "COMPLETED"]);

const toMs = (v) => {
  const t = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

export function buildReport(input) {
  const inp = input && typeof input === "object" ? input : {};
  const { periodStart, periodEnd, prs, queue, runFacts } = inp;
  const unknowns = [];
  const start = toMs(periodStart);
  const end = toMs(periodEnd);
  const periodOk = Number.isFinite(start) && Number.isFinite(end);
  if (!periodOk) unknowns.push("period");

  let newPrs = UNKNOWN;
  if (!Array.isArray(prs)) unknowns.push("prs");
  else if (!periodOk) newPrs = UNKNOWN;
  else newPrs = prs.filter((p) => {
    const t = toMs(p && p.createdAt);
    return t >= start && t <= end;
  }).length;

  let completedTasks = UNKNOWN;
  let bottlenecks = UNKNOWN;
  if (!queue || !Array.isArray(queue.tasks)) unknowns.push("queue");
  else {
    const tasks = queue.tasks.filter((t) => t && typeof t === "object");
    const st = (t) => String(t.status ?? "").toUpperCase();
    completedTasks = tasks.filter((t) => DONE.has(st(t))).length;
    bottlenecks = tasks
      .filter((t) => st(t) === "BLOCKED")
      .map((t) => ({ id: t.id, blocker: t.blocker ? String(t.blocker) : "unspecified" }));
  }

  const rf = runFacts && typeof runFacts === "object" ? runFacts : null;
  const activeImplementers =
    rf && typeof rf.activeImplementers === "number" && Number.isFinite(rf.activeImplementers)
      ? rf.activeImplementers
      : UNKNOWN;
  const failures = rf && Array.isArray(rf.failures) ? rf.failures : UNKNOWN;
  if (activeImplementers === UNKNOWN) unknowns.push("activeImplementers");
  if (failures === UNKNOWN) unknowns.push("failures");

  return {
    period: { start: periodStart ?? UNKNOWN, end: periodEnd ?? UNKNOWN },
    completedTasks,
    newPrs,
    activeImplementers,
    failures,
    bottlenecks,
    unknowns,
  };
}

const show = (v, f = String) => (v === UNKNOWN ? "UNKNOWN (not observed)" : f(v));

export function renderMarkdown(r) {
  const list = (a, f) => (a.length ? a.map(f).join("; ") : "none");
  return [
    "# Production Report",
    `- Period: ${r.period.start} → ${r.period.end}`,
    `- Completed tasks: ${show(r.completedTasks)}`,
    `- New PRs: ${show(r.newPrs)}`,
    `- Active implementers: ${show(r.activeImplementers)}`,
    `- Failures: ${show(r.failures, (a) => `${a.length}${a.length ? " (" + list(a, (x) => (typeof x === "string" ? x : JSON.stringify(x))) + ")" : ""}`)}`,
    `- Bottlenecks: ${show(r.bottlenecks, (a) => list(a, (b) => `${b.id}: ${b.blocker}`))}`,
    `- Unknowns: ${r.unknowns.length ? r.unknowns.join(", ") : "none"}`,
    "",
  ].join("\n");
}
