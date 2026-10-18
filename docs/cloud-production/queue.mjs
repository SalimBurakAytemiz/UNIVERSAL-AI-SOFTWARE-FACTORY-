//TR: CP-QUEUE saf (pure) bulut görev kuyruğu doğrulayıcı + lease-aware seçici; hiçbir şeyi kendi başına READY ilan etmez
const OWNERS = new Set(['CLOUD', 'LOCAL', 'FOUNDER']);
export const STATUSES = new Set([
  'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'COMPLETED', 'DRAFT_NOT_READY',
  'PENDING_REVIEW', 'PENDING_CI', 'AUTHORITY_REQUIRED', 'NOT_STARTED',
]);
const DONE = new Set(['DONE', 'COMPLETED']);
// Strict allowlists (not blocklists of invisible characters).
// ids: only ASCII letters, digits and . _ : - ; whitespace/control/zero-width/unicode are rejected.
const ID_RE = /^[A-Za-z0-9._:-]+$/;
const validId = (v) => typeof v === 'string' && ID_RE.test(v);
// authorizedBy: printable ASCII only (U+0020-U+007E), first char a printable non-space, length >= 3, and at least one
// alphanumeric. Non-ASCII authority tokens (e.g. non-Latin names) are NOT accepted, by design: any non-ASCII code point
// (U+3164, U+2800, zero-width, NEL, lone surrogates, ...) could render as blank, so authority must be plain ASCII.
const AUTH_RE = /^[\x21-\x7E][\x20-\x7E]{2,}$/;
const validAuth = (v) => typeof v === 'string' && AUTH_RE.test(v) && /[A-Za-z0-9]/.test(v);

export function loadQueue(obj) {
  const errors = [];
  const err = (taskId, code, detail) => errors.push({ taskId, code, detail });
  if (obj === null || typeof obj !== 'object' || !Array.isArray(obj.tasks)) {
    err(null, 'QUEUE_INVALID', 'queue must be an object with a tasks array');
    return { ok: false, errors, tasks: [] };
  }
  const tasks = obj.tasks;
  const byId = new Map();
  const seen = new Set();
  for (const t of tasks) {
    const id = t && validId(t.id) ? t.id : null;
    if (id === null) { err(null, 'TASK_ID_INVALID', 'id must match /^[A-Za-z0-9._:-]+$/'); continue; }
    if (seen.has(id)) err(id, 'DUPLICATE_ID', `duplicate id ${id}`);
    else byId.set(id, t);
    seen.add(id);
  }
  for (const t of tasks) {
    if (!t || !validId(t.id)) continue;
    const id = t.id;
    if (!OWNERS.has(t.owner)) err(id, 'OWNER_INVALID', `owner ${String(t.owner)}`);
    if (!STATUSES.has(t.status)) err(id, 'STATUS_INVALID', `status ${String(t.status)}`);
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
  const loaded = loadQueue(queue);
  if (!loaded.ok) return null;
  if (!OWNERS.has(owner)) return null;
  const idList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!idList(heldLeaseTaskIds) || !idList(openPrTaskIds)) return null;
  const held = new Set(heldLeaseTaskIds);
  const open = new Set(openPrTaskIds);
  for (const t of loaded.tasks) {
    if (t.status === 'READY' && t.owner === owner && !held.has(t.id) && !open.has(t.id)) {
      // Deep copy: nested arrays/objects (e.g. dependsOn) must not alias the caller's queue.
      try { return structuredClone(t); } catch { return null; }
    }
  }
  return null;
}
