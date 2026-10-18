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
const PLACEHOLDERS = new Set(['none', 'n/a', 'null', 'undefined', 'todo', 'tbd']);
// authorizedBy: printable ASCII only (U+0020-U+007E), first char a printable non-space, length >= 3, and at least one
// alphanumeric. Non-ASCII authority tokens (e.g. non-Latin names) are NOT accepted, by design: any non-ASCII code point
// (U+3164, U+2800, zero-width, NEL, lone surrogates, ...) could render as blank, so authority must be plain ASCII.
const AUTH_RE = /^[\x21-\x7E][\x20-\x7E]{2,}$/;
const validAuth = (v) => typeof v === 'string' && AUTH_RE.test(v) && /[A-Za-z0-9]/.test(v) &&
  !PLACEHOLDERS.has(v.trim().toLowerCase());

// Snapshot first (TOCTOU defence): all validation and dispatch run on a plain-data deep copy, never on live input.
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

export function loadQueue(input) {
  const errors = [];
  const err = (taskId, code, detail) => errors.push({ taskId, code, detail });
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
  const byId = new Map();
  const seen = new Set();
  for (const t of tasks) {
    const id = t && validId(t.id) ? t.id : null;
    if (id === null) { err(null, 'TASK_ID_INVALID', 'id must match /^[A-Za-z0-9._:+-]+$/ with an alphanumeric'); continue; }
    if (seen.has(id)) err(id, 'DUPLICATE_ID', `duplicate id ${id}`);
    else byId.set(id, t);
    seen.add(id);
  }
  for (const t of tasks) {
    if (!t || !validId(t.id)) continue;
    const id = t.id;
    if (!OWNERS.has(t.owner)) err(id, 'OWNER_INVALID', `owner ${String(t.owner)}`);
    if (!STATUS_SET.has(t.status)) err(id, 'STATUS_INVALID', `status ${String(t.status)}`);
    // Fail closed: dependsOn must be absent or an array of non-empty strings; anything else is invalid, never "no deps".
    const depsValid = t.dependsOn === undefined ||
      (Array.isArray(t.dependsOn) && t.dependsOn.every((d) => typeof d === 'string' && d.length > 0));
    if (!depsValid) err(id, 'DEPS_INVALID', 'dependsOn must be an array of non-empty strings');
    const deps = depsValid && t.dependsOn !== undefined ? t.dependsOn : [];
    for (const d of deps) {
      if (!byId.has(d)) err(id, 'DEP_ABSENT_FROM_BACKLOG', `dependency ${String(d)} not in backlog`);
    }
    if (t.status === 'READY') {
      if (!validAuth(t.authorizedBy)) {
        err(id, 'UNAUTHORIZED_READY', 'READY requires authorizedBy: printable ASCII, length >= 3, with an alphanumeric');
      }
      for (const d of deps) {
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
  return { ok: errors.length === 0, errors, tasks };
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
