//TR: CP-REPORT pure 60-minute production report core (fail-closed, no I/O)
const UNKNOWN = "UNKNOWN";
const DONE = new Set(["DONE", "COMPLETED"]);

// Exact copy of the queue STATUSES set from queue.mjs (case- and whitespace-sensitive on purpose).
const STATUSES = new Set([
  "READY", "IN_PROGRESS", "BLOCKED", "DONE", "COMPLETED", "DRAFT_NOT_READY",
  "PENDING_REVIEW", "PENDING_CI", "AUTHORITY_REQUIRED", "NOT_STARTED",
]);

const ISO = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(\.\d+)?(Z|([+-])(\d\d):(\d\d))$/;
// Only strict ISO-8601 strings with a real calendar date are parseable; numbers/Dates/other strings are NaN.
const toMs = (v) => {
  if (typeof v !== "string") return NaN;
  const m = ISO.exec(v);
  if (!m) return NaN;
  const [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (h > 23 || mi > 59 || sec > 59) return NaN;
  if (m[8] !== "Z" && (Number(m[10]) > 23 || Number(m[11]) > 59)) return NaN;
  const c = new Date(Date.UTC(2000, mo - 1, d));
  c.setUTCFullYear(y);
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return NaN;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
};

export function buildReport(input) {
  const inp = input && typeof input === "object" ? input : {};
  const { periodStart, periodEnd, prs, queue, runFacts } = inp;
  const unknowns = [];
  const start = toMs(periodStart);
  const end = toMs(periodEnd);
  // An inverted window is invalid, not an empty one.
  const periodOk = Number.isFinite(start) && Number.isFinite(end) && start <= end;
  if (!periodOk) unknowns.push("period");

  let newPrs = UNKNOWN;
  if (!Array.isArray(prs)) unknowns.push("prs");
  else if (!periodOk) newPrs = UNKNOWN;
  else {
    const list = Array.from(prs); // visits sparse-array holes as undefined
    const times = list.map((p) => toMs(p && p.createdAt));
    // A PR with an unparseable createdAt cannot be placed in or out of the window: never report a confident undercount.
    if (times.some((t) => Number.isNaN(t))) {
      newPrs = UNKNOWN;
      unknowns.push("prs[].createdAt");
    } else {
      const nums = list.map((p) => p.number).filter((n) => n !== undefined).map((n) => `${typeof n}:${String(n)}`);
      if (new Set(nums).size !== nums.length) {
        // Duplicate PR numbers would double count: surface, do not guess.
        newPrs = UNKNOWN;
        unknowns.push("prs[].number");
      } else newPrs = times.filter((t) => t >= start && t <= end).length;
    }
  }

  let completedTasks = UNKNOWN;
  let bottlenecks = UNKNOWN;
  if (!queue || !Array.isArray(queue.tasks)) unknowns.push("queue");
  else {
    const tasks = Array.from(queue.tasks); // holes become undefined -> malformed
    const bad = tasks.some(
      (t) => !t || typeof t !== "object" || typeof t.status !== "string" || !STATUSES.has(t.status) ||
        typeof t.id !== "string" || t.id.length === 0,
    );
    if (bad) {
      // Malformed entries are surfaced, never silently dropped or counted as "not done".
      unknowns.push("queue.tasks[]");
    } else if (new Set(tasks.map((t) => t.id)).size !== tasks.length) {
      unknowns.push("queue.tasks[].id");
    } else {
      completedTasks = tasks.filter((t) => DONE.has(t.status)).length;
      bottlenecks = tasks
        .filter((t) => t.status === "BLOCKED")
        .map((t) => ({ id: t.id, blocker: t.blocker ? String(t.blocker) : "unspecified" }));
    }
  }

  const rf = runFacts && typeof runFacts === "object" ? runFacts : null;
  const activeImplementers =
    rf && Number.isSafeInteger(rf.activeImplementers) && rf.activeImplementers >= 0 && !Object.is(rf.activeImplementers, -0)
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

// Escapes any value to a single-line JSON token; never throws (circular, BigInt, ...).
const safe = (v) => {
  try {
    const j = JSON.stringify(v);
    return j === undefined ? "[unserializable]" : j;
  } catch {
    return "[unserializable]";
  }
};

export function renderMarkdown(r) {
  const list = (a, f) => (a.length ? a.map(f).join("; ") : "none");
  return [
    "# Production Report",
    `- Period: ${safe(r.period.start)} → ${safe(r.period.end)}`,
    `- Completed tasks: ${show(r.completedTasks)}`,
    `- New PRs: ${show(r.newPrs)}`,
    `- Active implementers: ${show(r.activeImplementers)}`,
    `- Failures: ${show(r.failures, (a) => `${a.length}${a.length ? " (" + list(a, safe) + ")" : ""}`)}`,
    `- Bottlenecks: ${show(r.bottlenecks, (a) => list(a, (b) => `${safe(b.id)}: ${safe(b.blocker)}`))}`,
    `- Unknowns: ${r.unknowns.length ? r.unknowns.join(", ") : "none"}`,
    "",
  ].join("\n");
}
