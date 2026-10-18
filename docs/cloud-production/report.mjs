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

// Hard cap on list sizes, checked from .length BEFORE any copy so a huge sparse array cannot stall the report.
const MAX_ITEMS = 100000;
// Snapshot a list WITHOUT ever touching the iterator (an own Symbol.iterator could be infinite or generate millions of
// items): read length once, apply the cap, then copy by index a[0..n-1] (holes read as undefined). The copy is shallow,
// so later mutation of the caller's array cannot change the report. A throwing proxy/getter => state 2 (hostile).
// Returns { state: 0 ok | 1 over cap | 2 hostile, items }.
const readList = (a) => {
  try {
    const n = a.length;
    if (!Number.isSafeInteger(n) || n < 0) return { state: 2, items: null };
    if (n > MAX_ITEMS) return { state: 1, items: null };
    const items = new Array(n);
    for (let i = 0; i < n; i++) items[i] = a[i];
    return { state: 0, items };
  } catch { return { state: 2, items: null }; }
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

// Blocker text: t.blocker if a non-empty string, else t.notes if a non-empty string, else 'unspecified'; capped at 200 chars.
// Reading a hostile field (throwing getter, ...) must never throw. Output is safe()-escaped at render time.
//
// SECURITY NOTE: blocker/notes are free text and MUST NOT contain secrets. Authors must never put credentials in them.
// As a last line of defence only, redactSecrets() masks a few well-known token shapes and key=value credential pairs.
// This is a BEST-EFFORT DENYLIST, NOT A GUARANTEE: unknown token formats, split/encoded values and prose secrets pass through.
// It is intentionally simple (linear-time regexes, applied to at most 2000 chars) and applies to notes/blocker only.
const BLOCKER_CAP = 200;
const REDACT_SCAN_CAP = 2000;
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
  /[A-Za-z0-9_-]*(?:authorization|password|passwd|secret|token)[A-Za-z0-9_-]*[ \t]*[:=][ \t]*(?:(?:bearer|basic)[ \t]+)?[^\s,;"']+/gi,
];
export const redactSecrets = (v) => {
  let out = v.length > REDACT_SCAN_CAP ? v.slice(0, REDACT_SCAN_CAP) : v;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
};
const blockerText = (t) => {
  for (const k of ["blocker", "notes"]) {
    try {
      const v = t[k];
      if (typeof v === "string" && v.length > 0) {
        const r = redactSecrets(v); // redact BEFORE capping so a token straddling the cap is not half-leaked
        return r.length > BLOCKER_CAP ? r.slice(0, BLOCKER_CAP) : r;
      }
    } catch { /* unreadable field: try the next source */ }
  }
  return "unspecified";
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
  let prsL = null;
  if (!Array.isArray(prs)) unknowns.push("prs");
  else if (!periodOk) newPrs = UNKNOWN;
  else if ((prsL = readList(prs)).state !== 0) unknowns.push("prs[]"); // over cap or hostile: UNKNOWN, never iterated
  else {
    let times = null;
    let keys = null;
    try {
      const list = prsL.items; // holes already read as undefined
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
    else {
      const l = readList(qt); // cap check, then indexed copy; never the iterator
      qtasks = l.state === 0 ? l.items : undefined;
    }
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
    if (Array.isArray(fl)) {
      const l = readList(fl);
      if (l.state === 0) failures = l.items; // snapshot: later caller mutation cannot change the report
    }
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

// Escapes any value to a single-line JSON token, capped at SAFE_CAP chars; never throws (circular, BigInt, ...).
const SAFE_CAP = 200;
const MAX_RENDER_ITEMS = 1000;
const safe = (v) => {
  try {
    let j = JSON.stringify(v);
    if (typeof j !== "string") return "[unserializable]";
    if (j.length > SAFE_CAP) {
      j = j.slice(0, SAFE_CAP);
      const last = j.charCodeAt(j.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) j = j.slice(0, -1); // do not leave a lone high surrogate
      j += "...(truncated)";
    }
    // U+2028/U+2029 (line separators), '<' and '&' are escaped so the token cannot break lines or inject HTML.
    return j.replace(/[\u2028\u2029<&]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  } catch {
    return "[unserializable]";
  }
};
// Plain-string variant for unknown labels: same cap, no JSON quoting.
const capStr = (x) => { const t = String(x); return t.length > SAFE_CAP ? t.slice(0, SAFE_CAP) + "...(truncated)" : t; };

export function renderMarkdown(r) {
  try {
    return renderMarkdownUnsafe(r);
  } catch {
    return "# Production Report\n- [unrenderable]\n"; // hostile report object (revoked proxy, throwing getters)
  }
}

function renderMarkdownUnsafe(r) {
  // Indexed snapshot (never the iterator); over-cap or hostile lists throw into guard() => "[unrenderable]".
  const items = (a) => { const l = readList(a); if (l.state !== 0) throw new Error("unrenderable list"); return l.items; };
  // At most MAX_RENDER_ITEMS items are rendered, then a fixed "(+N more)" marker.
  const cut = (xs, f, sep) => {
    const shown = xs.length > MAX_RENDER_ITEMS ? xs.slice(0, MAX_RENDER_ITEMS) : xs;
    const out = shown.map((x) => f(x)).join(sep);
    return xs.length > MAX_RENDER_ITEMS ? `${out}${sep}(+${xs.length - MAX_RENDER_ITEMS} more)` : out;
  };
  const list = (a, f) => { const xs = items(a); return xs.length ? cut(xs, f, "; ") : "none"; };
  return [
    "# Production Report",
    `- Period: ${guard(() => `${safe(r.period.start)} → ${safe(r.period.end)}`)}`,
    `- Completed tasks: ${show(r.completedTasks)}`,
    `- New PRs: ${show(r.newPrs)}`,
    `- Active implementers: ${show(r.activeImplementers)}`,
    `- Failures: ${show(r.failures, (a) => { const n = items(a).length; return `${n}${n ? " (" + list(a, safe) + ")" : ""}`; })}`,
    `- Bottlenecks: ${show(r.bottlenecks, (a) => list(a, (b) => `${safe(b.id)}: ${safe(b.blocker)}`))}`,
    `- Unknowns: ${guard(() => (items(r.unknowns).length ? cut(items(r.unknowns), capStr, ", ") : "none"))}`,
    "",
  ].join("\n");
}
