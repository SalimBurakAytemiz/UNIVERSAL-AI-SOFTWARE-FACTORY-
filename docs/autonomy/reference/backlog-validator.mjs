//TR: Canonical backlog/queue icin FAIL-CLOSED dogrulayici (B5 guvenlik yarisi): bir gorev ancak authorizedBy (bos degil) varsa ve tum dependsOn gorevleri DONE ise READY olabilir; aksi halde UNAUTHORIZED_READY / READY_WITH_UNMET_DEP hatasi. Ayrica yapi, bilinen status/owner, dup id ve dependency butunlugu denetlenir. Bu modul hicbir gorevi READY ILAN ETMEZ; yalniz yetkisiz/yanlis READY'yi reddeder. Saf fonksiyondur (I/O yok), orkestratore baglanmamistir (korunan cekirdek = FA-LEASE2). Canonical backlog docs/planning altina Founder kaynak secimi + yetki karariyla konur; bu yalniz onu guvenli tutan validator.
export const OWNERS = Object.freeze(["CLOUD", "LOCAL", "FOUNDER"]);
export const STATUSES = Object.freeze(["IN_PROGRESS", "READY", "PENDING_REVIEW", "PENDING_CI", "PENDING_LOCAL", "AUTHORITY_REQUIRED", "BLOCKED", "NOT_STARTED", "DESIGN_ONLY", "DONE", "DRAFT_NOT_READY", "IN_REVIEW", "COMPLETED"]);
const DONE_STATES = new Set(["DONE", "COMPLETED"]);

// validateBacklog(obj) -> {ok, errors:[{taskId,code,detail}]}. Fail-closed: anything unrecognized is an error.
export function validateBacklog(obj) {
  const errors = [];
  const push = (taskId, code, detail) => errors.push({ taskId, code, detail });
  if (!obj || typeof obj !== "object") return { ok: false, errors: [{ taskId: null, code: "NOT_AN_OBJECT", detail: "backlog must be an object" }] };
  const tasks = obj.tasks;
  if (!Array.isArray(tasks)) return { ok: false, errors: [{ taskId: null, code: "TASKS_NOT_ARRAY", detail: "backlog.tasks must be an array" }] };
  if (tasks.length === 0) return { ok: false, errors: [{ taskId: null, code: "EMPTY_BACKLOG", detail: "backlog.tasks is empty" }] };

  const ids = new Set();
  const doneIds = new Set();
  for (const t of tasks) if (t && typeof t.id === "string" && DONE_STATES.has(t.status)) doneIds.add(t.id);
  // a dep id is "done" only if some task with that id exists and NO task with that id is unfinished
  for (const t of tasks) if (t && typeof t.id === "string" && !DONE_STATES.has(t.status)) doneIds.delete(t.id);

  for (const t of tasks) {
    if (!t || typeof t !== "object") { push(null, "TASK_NOT_OBJECT", String(t)); continue; }
    const id = t.id;
    if (typeof id !== "string" || id === "") { push(null, "TASK_ID_INVALID", JSON.stringify(id ?? null)); continue; }
    if (ids.has(id)) push(id, "DUPLICATE_ID", id);
    ids.add(id);
    if (!OWNERS.includes(t.owner)) push(id, "OWNER_INVALID", String(t.owner));
    if (!STATUSES.includes(t.status)) push(id, "STATUS_INVALID", String(t.status));
    if (t.dependsOn !== undefined && !Array.isArray(t.dependsOn)) push(id, "DEPENDSON_NOT_ARRAY", JSON.stringify(t.dependsOn));
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const d of deps) if (typeof d !== "string" || d === "") push(id, "DEP_ID_INVALID", JSON.stringify(d));

    // The core safety invariants for READY:
    if (t.status === "READY") {
      if (typeof t.authorizedBy !== "string" || t.authorizedBy.trim() === "")
        push(id, "UNAUTHORIZED_READY", "a task may be READY only with a non-empty authorizedBy (Founder/governance authorization)");
      const unmet = deps.filter((d) => !doneIds.has(d));
      if (unmet.length) push(id, "READY_WITH_UNMET_DEP", `READY task depends on not-DONE/absent: ${unmet.join(",")}`);
    }
  }
  // referential integrity: every dependency id should exist in the backlog (fail-closed on dangling deps)
  for (const t of tasks) {
    if (!t || typeof t.id !== "string") continue;
    for (const d of (Array.isArray(t.dependsOn) ? t.dependsOn : []))
      if (typeof d === "string" && d !== "" && !ids.has(d)) push(t.id, "DEP_ABSENT_FROM_BACKLOG", d);
  }
  return { ok: errors.length === 0, errors };
}
