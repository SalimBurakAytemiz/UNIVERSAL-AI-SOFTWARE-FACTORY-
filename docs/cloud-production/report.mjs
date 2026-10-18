//TR: CP-REPORT pure 60-minute production report core (fail-closed, no I/O)
const UNKNOWN = "UNKNOWN";
const DONE = new Set(["DONE", "COMPLETED"]);

// Copy of the queue STATUSES set from queue.mjs (case- and whitespace-sensitive on purpose).
// LIMITATION: this branch (CP-REPORT) does not contain queue.mjs (it lives on the separate CP-QUEUE branch), so a static
// import would break this module here. report.proof.mjs compares this set to ./queue.mjs STATUSES whenever that file
// exists (i.e. after both branches are integrated) and reports an explicit SKIP otherwise. Once both are merged, replace
// this copy with: import { STATUSES } from "./queue.mjs";
// IN_REVIEW is deliberate (the real backlog uses it for PRs awaiting independent review; like PENDING_REVIEW it is neither
// READY nor DONE). Exported as a frozen array; the validating Set stays private so mutating the export cannot widen validation.
const STATUS_LIST = [
  "READY", "IN_PROGRESS", "BLOCKED", "DONE", "COMPLETED", "DRAFT_NOT_READY",
  "PENDING_REVIEW", "IN_REVIEW", "PENDING_CI", "AUTHORITY_REQUIRED", "NOT_STARTED",
];
const STATUS_SET = new Set(STATUS_LIST);
export const STATUSES = Object.freeze([...STATUS_LIST]);

// Same id policy as queue.mjs: ASCII letters/digits and . _ : + - with at least one alphanumeric.
const ID_RE = /^[A-Za-z0-9._:+-]+$/;
const validId = (v) => typeof v === "string" && ID_RE.test(v) && /[A-Za-z0-9]/.test(v);

// Hard cap on list sizes, checked from .length BEFORE any Array.from so a huge sparse array cannot stall the report.
const MAX_ITEMS = 100000;
// 0 = ok, 1 = over cap, 2 = length unreadable/invalid (hostile)
const lenState = (a) => {
  try {
    const n = a.length;
    if (!Number.isSafeInteger(n) || n < 0) return 2;
    return n > MAX_ITEMS ? 1 : 0;
  } catch { return 2; }
};

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

// Reading/stringifying a hostile blocker (throwing getter or toString, Symbol, ...) must never throw.
const blockerText = (t) => {
  try {
    const b = t.blocker;
    return b ? String(b) : "unspecified";
  } catch {
    return "unspecified";
  }
};

// PR identity key: a safe positive integer (number) or its canonical decimal string; everything else is malformed (null).
// Number 1 and string "1" share the key "1" so they are detected as duplicates.
const prKey = (n) => {
  if (typeof n === "number") return Number.isSafeInteger(n) && n >= 1 ? String(n) : null;
  if (typeof n === "string") return /^[1-9][0-9]*$/.test(n) && Number.isSafeInteger(Number(n)) ? n : null;
  return null;
};

export function buildReport(input) {
  let fields = {};
  try {
    const inp = input && typeof input === "object" ? input : {};
    const { periodStart, periodEnd, prs, queue, runFacts } = inp;
    fields = { periodStart, periodEnd, prs, queue, runFacts };
  } catch {
    fields = {}; // hostile getter on input: everything unknown
  }
  const { periodStart, periodEnd, prs, queue, runFacts } = fields;
  const unknowns = [];
  const start = toMs(periodStart);
  const end = toMs(periodEnd);
  // An inverted window is invalid, not an empty one.
  const periodOk = Number.isFinite(start) && Number.isFinite(end) && start <= end;
  if (!periodOk) unknowns.push("period");

  let newPrs = UNKNOWN;
  if (!Array.isArray(prs)) unknowns.push("prs");
  else if (lenState(prs) !== 0) unknowns.push("prs[]"); // over cap or hostile length: UNKNOWN, no iteration
  else if (!periodOk) newPrs = UNKNOWN;
  else {
    let times = null;
    let keys = null;
    try {
      const list = Array.from(prs); // visits sparse-array holes as undefined
      times = list.map((p) => toMs(p && p.createdAt));
      keys = list.map((p) => prKey(p && p.number));
    } catch {
      times = null; // hostile getters/proxies: treat as unobservable, never throw
    }
    // A PR with an unparseable createdAt cannot be placed in or out of the window: never report a confident undercount.
    if (times === null || times.some((t) => Number.isNaN(t))) {
      newPrs = UNKNOWN;
      unknowns.push("prs[].createdAt");
    } else if (keys.some((k) => k === null) || new Set(keys).size !== keys.length) {
      // Missing/malformed number cannot be de-duplicated; duplicate numbers would double count: surface, do not guess.
      newPrs = UNKNOWN;
      unknowns.push("prs[].number");
    } else newPrs = times.filter((t) => t >= start && t <= end).length;
  }

  let completedTasks = UNKNOWN;
  let bottlenecks = UNKNOWN;
  let qtasks = null;
  try {
    const qt = queue ? queue.tasks : undefined;
    if (!Array.isArray(qt)) qtasks = null;
    else if (lenState(qt) !== 0) qtasks = undefined; // checked before Array.from
    else qtasks = Array.from(qt);
  } catch { qtasks = undefined; }
  if (qtasks === null) unknowns.push("queue");
  else {
    // Snapshot each task exactly once (hostile getters/proxies must not throw or change between reads).
    let snap = null;
    try {
      snap = (qtasks || []).map((t) => (t && typeof t === "object"
        ? { id: t.id, status: t.status, blocker: blockerText(t) }
        : null));
    } catch { snap = null; }
    const bad = qtasks === undefined || snap === null || snap.some(
      (t) => t === null || typeof t.status !== "string" || !STATUS_SET.has(t.status) || typeof t.id !== "string" || t.id.length === 0,
    );
    if (bad) {
      // Malformed entries are surfaced, never silently dropped or counted as "not done".
      unknowns.push("queue.tasks[]");
    } else if (snap.some((t) => !validId(t.id))) {
      unknowns.push("queue.tasks[].id"); // id outside the queue.mjs id policy
    } else if (new Set(snap.map((t) => t.id)).size !== snap.length) {
      unknowns.push("queue.tasks[].id");
    } else {
      completedTasks = snap.filter((t) => DONE.has(t.status)).length;
      bottlenecks = snap
        .filter((t) => t.status === "BLOCKED")
        .map((t) => ({ id: t.id, blocker: t.blocker }));
    }
  }

  let activeImplementers = UNKNOWN;
  let failures = UNKNOWN;
  try {
    const rf = runFacts && typeof runFacts === "object" ? runFacts : null;
    const ai = rf ? rf.activeImplementers : undefined;
    const fl = rf ? rf.failures : undefined;
    if (Number.isSafeInteger(ai) && ai >= 0 && !Object.is(ai, -0)) activeImplementers = ai;
    if (Array.isArray(fl)) failures = fl;
  } catch { /* hostile runFacts: stays UNKNOWN */ }
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

// Rendering must never throw, even for a hostile report object (throwing getters, revoked proxies, ...).
const guard = (f) => { try { return f(); } catch { return "[unrenderable]"; } };
const show = (v, f = String) => guard(() => (v === UNKNOWN ? "UNKNOWN (not observed)" : f(v)));

// Escapes any value to a single-line JSON token; never throws (circular, BigInt, ...).
const safe = (v) => {
  try {
    const j = JSON.stringify(v);
    if (typeof j !== "string") return "[unserializable]";
    // U+2028/U+2029 (line separators), '<' and '&' are escaped so the token cannot break lines or inject HTML.
    return j.replace(/[\u2028\u2029<&]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  } catch {
    return "[unserializable]";
  }
};

export function renderMarkdown(r) {
  try {
    return renderMarkdownUnsafe(r);
  } catch {
    return "# Production Report\n- [unrenderable]\n"; // hostile report object (revoked proxy, throwing getters)
  }
}

function renderMarkdownUnsafe(r) {
  const list = (a, f) => (a.length ? Array.from(a, (x) => f(x)).join("; ") : "none");
  return [
    "# Production Report",
    `- Period: ${guard(() => `${safe(r.period.start)} → ${safe(r.period.end)}`)}`,
    `- Completed tasks: ${show(r.completedTasks)}`,
    `- New PRs: ${show(r.newPrs)}`,
    `- Active implementers: ${show(r.activeImplementers)}`,
    `- Failures: ${show(r.failures, (a) => `${a.length}${a.length ? " (" + list(a, safe) + ")" : ""}`)}`,
    `- Bottlenecks: ${show(r.bottlenecks, (a) => list(a, (b) => `${safe(b.id)}: ${safe(b.blocker)}`))}`,
    `- Unknowns: ${guard(() => (r.unknowns.length ? Array.from(r.unknowns, String).join(", ") : "none"))}`,
    "",
  ].join("\n");
}
