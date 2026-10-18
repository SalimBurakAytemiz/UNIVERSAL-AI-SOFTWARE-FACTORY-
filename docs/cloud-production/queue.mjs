//TR: CP-QUEUE saf (pure) bulut görev kuyruğu doğrulayıcı + lease-aware seçici; hiçbir şeyi kendi başına READY ilan etmez
const OWNERS = new Set(['CLOUD', 'LOCAL', 'FOUNDER']);
const STATUSES = new Set([
  'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'COMPLETED', 'DRAFT_NOT_READY',
  'PENDING_REVIEW', 'PENDING_CI', 'AUTHORITY_REQUIRED', 'NOT_STARTED',
]);
const DONE = new Set(['DONE', 'COMPLETED']);

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
    const id = t && typeof t.id === 'string' && t.id.length > 0 ? t.id : null;
    if (id === null) { err(null, 'TASK_ID_INVALID', 'id must be a non-empty string'); continue; }
    if (seen.has(id)) err(id, 'DUPLICATE_ID', `duplicate id ${id}`);
    else byId.set(id, t);
    seen.add(id);
  }
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string' || t.id.length === 0) continue;
    const id = t.id;
    if (!OWNERS.has(t.owner)) err(id, 'OWNER_INVALID', `owner ${String(t.owner)}`);
    if (!STATUSES.has(t.status)) err(id, 'STATUS_INVALID', `status ${String(t.status)}`);
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const d of deps) {
      if (!byId.has(d)) err(id, 'DEP_ABSENT_FROM_BACKLOG', `dependency ${String(d)} not in backlog`);
    }
    if (t.status === 'READY') {
      if (typeof t.authorizedBy !== 'string' || t.authorizedBy.length === 0) {
        err(id, 'UNAUTHORIZED_READY', 'READY requires non-empty authorizedBy');
      }
      for (const d of deps) {
        const dt = byId.get(d);
        if (dt && !DONE.has(dt.status)) err(id, 'READY_WITH_UNMET_DEP', `dependency ${d} is ${dt.status}`);
      }
      if (t.protectedEdit === true) err(id, 'READY_REQUIRES_PROTECTED_EDIT', 'protectedEdit is true');
      if (t.requiresNewAuthority === true) err(id, 'READY_REQUIRES_NEW_AUTHORITY', 'requiresNewAuthority is true');
    }
  }
  return { ok: errors.length === 0, errors, tasks };
}

export function nextDispatchable(queue, heldLeaseTaskIds = [], openPrTaskIds = []) {
  const loaded = loadQueue(queue);
  if (!loaded.ok) return null;
  const held = new Set(heldLeaseTaskIds);
  const open = new Set(openPrTaskIds);
  for (const t of loaded.tasks) {
    if (t.status === 'READY' && !held.has(t.id) && !open.has(t.id)) return t;
  }
  return null;
}
