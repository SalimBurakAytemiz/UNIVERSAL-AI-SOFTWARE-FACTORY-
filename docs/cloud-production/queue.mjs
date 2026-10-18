//TR: CP-QUEUE saf (pure) bulut görev kuyruğu doğrulayıcı + lease-aware seçici; hiçbir şeyi kendi başına READY ilan etmez
const OWNERS = new Set(['CLOUD', 'LOCAL', 'FOUNDER']);
// IN_REVIEW is deliberate: the real backlog uses it for PRs awaiting independent review (treated like PENDING_REVIEW:
// neither READY nor DONE).
// Exported as a frozen array; the validating Set is private so mutating the export cannot widen validation.
const STATUS_LIST = [
  'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'COMPLETED', 'DRAFT_NOT_READY',
  'PENDING_REVIEW', 'IN_REVIEW', 'PENDING_CI', 'AUTHORITY_REQUIRED', 'NOT_STARTED',
];
const STATUS_SET = new Set(STATUS_LIST);
export const STATUSES = Object.freeze([...STATUS_LIST]);
const DONE = new Set(['DONE', 'COMPLETED']);
// Strict allowlists (not blocklists of invisible characters).
// ids: only ASCII letters, digits and . _ : + - (real ids like 'UI-037+046'); at least one alphanumeric; whitespace/control/zero-width/unicode are rejected.
const ID_RE = /^[A-Za-z0-9._:+-]+$/;
const validId = (v) => typeof v === 'string' && ID_RE.test(v) && /[A-Za-z0-9]/.test(v);
// Placeholder authority values are not authority (compared case-insensitively, trimmed).
// NOTE: this is a SYNTACTIC SANITY CHECK only (shape + obvious placeholder words); it does NOT verify that any real
// authorization exists. Actual authority verification is the supervisor's job.
// Compared after lowercasing/trimming AND after stripping all non-alphanumerics (so 'N/A', 'n.a.', 'to-do', 'T.B.D' collapse).
const PLACEHOLDERS = new Set(['none', 'na', 'null', 'undefined', 'todo', 'tbd', 'tbc', 'unknown', 'pending',
  'xxx', 'false', 'true', 'nobody', 'nil', '-', 'n/a']);
const isPlaceholder = (v) => {
  const t = v.trim().toLowerCase();
  const stripped = t.replace(/[^a-z0-9]/g, '');
  return PLACEHOLDERS.has(t) || PLACEHOLDERS.has(stripped) || /^x+$/.test(stripped) || stripped === '';
};
// authorizedBy: printable ASCII only (U+0020-U+007E), first char a printable non-space, length >= 3, and at least one
// alphanumeric. Non-ASCII authority tokens (e.g. non-Latin names) are NOT accepted, by design: any non-ASCII code point
// (U+3164, U+2800, zero-width, NEL, lone surrogates, ...) could render as blank, so authority must be plain ASCII.
const AUTH_RE = /^[\x21-\x7E][\x20-\x7E]{2,}$/;
const validAuth = (v) => typeof v === 'string' && AUTH_RE.test(v) && /[A-Za-z0-9]/.test(v) &&
  !isPlaceholder(v);

// Snapshot first (TOCTOU defence): all validation and dispatch run on a plain-data deep copy, never on live input.
// Labels: ANY snapshot failure is INPUT_HOSTILE (getter throws, revoked/hostile proxy, ...), except a genuine
// DataCloneError on a non-hostile input (e.g. a function value), which is QUEUE_UNCLONEABLE.
// Fail-closed abort: if the queue (or any one task in it) cannot be cloned, the WHOLE queue is invalid; tasks are not skipped.
function snapshot(input) {
  try {
    return { ok: true, value: structuredClone(input) };
  } catch (e) {
    let hostile = e?.name !== 'DataCloneError';
    if (!hostile) {
      try { if (input !== null && typeof input === 'object') Object.keys(input); } catch { hostile = true; }
    }
    return { ok: false, code: hostile ? 'INPUT_HOSTILE' : 'QUEUE_UNCLONEABLE' };
  }
}

// Hard cap on queue size, checked on the INPUT's own data property before any clone is attempted.
const MAX_TASKS = 100000;
function lengthOfOwnTasks(input) {
  // Only a plain own data property is inspected (no getter is invoked, so single-read TOCTOU behaviour is preserved).
  try {
    if (input === null || typeof input !== 'object') return -1;
    const d = Object.getOwnPropertyDescriptor(input, 'tasks');
    if (d && 'value' in d && Array.isArray(d.value)) return d.value.length;
  } catch { /* handled by snapshot */ }
  return -1;
}

// Hard cap on collected errors: the list never exceeds MAX_ERRORS entries; the last one is an ERRORS_TRUNCATED aggregate.
const MAX_ERRORS = 1000;
// Hard cap on dependsOn.length per task, checked BEFORE any iteration (a sparse array can claim length 2**32-1).
const MAX_DEPS = 1000;

export function loadQueue(input) {
  const errors = [];
  let truncated = false;
  const err = (taskId, code, detail) => {
    if (truncated) return;
    if (errors.length >= MAX_ERRORS - 1) {
      truncated = true;
      errors.push({ taskId: null, code: 'ERRORS_TRUNCATED', detail: `more than ${MAX_ERRORS - 1} errors; remaining errors omitted` });
      return;
    }
    errors.push({ taskId, code, detail });
  };
  err.full = () => truncated;
  if (lengthOfOwnTasks(input) > MAX_TASKS) {
    err(null, 'QUEUE_TOO_LARGE', `tasks.length exceeds ${MAX_TASKS}`);
    return { ok: false, errors, tasks: [] };
  }
  const snap = snapshot(input);
  if (!snap.ok) {
    err(null, snap.code, 'queue could not be safely snapshotted; whole queue rejected (fail-closed abort, not skip)');
    return { ok: false, errors, tasks: [] };
  }
  const obj = snap.value;
  if (obj === null || typeof obj !== 'object' || !Array.isArray(obj.tasks)) {
    err(null, 'QUEUE_INVALID', 'queue must be an object with a tasks array');
    return { ok: false, errors, tasks: [] };
  }
  const tasks = obj.tasks;
  if (tasks.length > MAX_TASKS) {
    err(null, 'QUEUE_TOO_LARGE', `tasks.length exceeds ${MAX_TASKS}`);
    return { ok: false, errors, tasks: [] };
  }
  try {
    validateTasks(tasks, err);
  } catch {
    errors.length = 0;
    err(null, 'INPUT_HOSTILE', 'validation aborted on unexpected input; whole queue rejected');
    return { ok: false, errors, tasks: [] };
  }
  // ok=false never carries tasks.
  if (errors.length > 0) return { ok: false, errors, tasks: [] };
  return { ok: true, errors, tasks };
}

function validateTasks(tasks, err) {
  const n = tasks.length;
  const byId = new Map();
  const seen = new Set();
  let badIds = 0;
  for (let i = 0; i < n; i++) {
    const t = tasks[i];
    const id = t && validId(t.id) ? t.id : null;
    if (id === null) { badIds++; continue; }
    if (seen.has(id)) err(id, 'DUPLICATE_ID', `duplicate id ${id}`);
    else byId.set(id, t);
    seen.add(id);
  }
  // One aggregate error (never one per hole/entry): a sparse or garbage array cannot flood the error list.
  if (badIds > 0) err(null, 'TASK_ID_INVALID', `${badIds} task(s) with missing/invalid id; id must match /^[A-Za-z0-9._:+-]+$/ with an alphanumeric`);
  for (let i = 0; i < n; i++) {
    const t = tasks[i];
    if (!t || !validId(t.id)) continue;
    const id = t.id;
    if (err.full()) break;
    if (!OWNERS.has(t.owner)) err(id, 'OWNER_INVALID', `owner ${String(t.owner)}`);
    if (!STATUS_SET.has(t.status)) err(id, 'STATUS_INVALID', `status ${String(t.status)}`);
    // Fail closed: dependsOn must be absent or an array of non-empty strings; anything else is invalid, never "no deps".
    // Length is read once (try/catch) and capped BEFORE iterating; an indexed loop is used, never for...of / .every.
    let depsValid = true;
    const deps = [];
    if (t.dependsOn !== undefined) {
      let len = -1;
      try { if (Array.isArray(t.dependsOn)) len = t.dependsOn.length; } catch { len = -1; }
      if (!Number.isInteger(len) || len < 0 || len > MAX_DEPS) depsValid = false;
      else {
        for (let j = 0; j < len; j++) {
          const d = t.dependsOn[j];
          if (typeof d !== 'string' || d.length === 0) { depsValid = false; break; }
          deps.push(d);
        }
      }
    }
    if (!depsValid) { err(id, 'DEPS_INVALID', `dependsOn must be an array of at most ${MAX_DEPS} non-empty strings`); deps.length = 0; }
    // One aggregate error per task for absent dependencies.
    let absent = 0; let firstAbsent = null;
    for (let j = 0; j < deps.length; j++) {
      if (!byId.has(deps[j])) { if (absent === 0) firstAbsent = deps[j]; absent++; }
    }
    if (absent > 0) err(id, 'DEP_ABSENT_FROM_BACKLOG', `${absent} dependenc${absent === 1 ? 'y' : 'ies'} not in backlog (first: ${firstAbsent.slice(0, 80)})`);
    if (t.status === 'READY') {
      if (!validAuth(t.authorizedBy)) {
        err(id, 'UNAUTHORIZED_READY', 'READY requires authorizedBy: printable ASCII, length >= 3, with an alphanumeric');
      }
      for (let j = 0; j < deps.length; j++) {
        const d = deps[j];
        const dt = byId.get(d);
        if (dt && !DONE.has(dt.status)) err(id, 'READY_WITH_UNMET_DEP', `dependency ${d} is ${dt.status}`);
      }
      // Only an absent field or the boolean false is acceptable; truthy strings/numbers must not slip through.
      if (t.protectedEdit !== undefined && t.protectedEdit !== false) {
        err(id, 'READY_REQUIRES_PROTECTED_EDIT', `protectedEdit must be absent or false, got ${String(t.protectedEdit)}`);
      }
      if (t.requiresNewAuthority !== undefined && t.requiresNewAuthority !== false) {
        err(id, 'READY_REQUIRES_NEW_AUTHORITY', `requiresNewAuthority must be absent or false, got ${String(t.requiresNewAuthority)}`);
      }
    }
  }
}

export function nextDispatchable(queue, heldLeaseTaskIds = [], openPrTaskIds = [], owner = 'CLOUD') {
  // loadQueue validates a snapshot and returns that snapshot's tasks; dispatch uses only those.
  const loaded = loadQueue(queue);
  if (!loaded.ok) return null;
  if (!OWNERS.has(owner)) return null;
  const idList = (v) => {
    try {
      if (!Array.isArray(v)) return null;
      const c = structuredClone(v);
      return c.every((x) => typeof x === 'string') ? c : null;
    } catch { return null; }
  };
  const heldList = idList(heldLeaseTaskIds);
  const openList = idList(openPrTaskIds);
  if (!heldList || !openList) return null;
  const held = new Set(heldList);
  const open = new Set(openList);
  for (const t of loaded.tasks) {
    if (t.status === 'READY' && t.owner === owner && !held.has(t.id) && !open.has(t.id)) {
      // Deep copy: nested arrays/objects (e.g. dependsOn) must not alias the caller's queue.
      try { return structuredClone(t); } catch { return null; }
    }
  }
  return null;
}
