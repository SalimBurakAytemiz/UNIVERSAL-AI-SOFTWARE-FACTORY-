<!-- //TR: UI-026 "Görev Denetçisi" teslim kaydı: kapsam, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Ürün doğrulaması NOT_VERIFIED. -->

# UI-026 Read-only task detail inspector

- **Where:** mission detail on `#/work`. Each task in the Tasks list is a button; selecting it opens the inspector, selecting it again closes it. No route was added.
- **Data:** only the `GET /v1/missions/:id`, `GET /v1/work-runs` and (for the selected task) `GET /v1/tasks/:id/runs` reads the view already makes. No new endpoint, allow-list entry, POST, IPC or storage. The selection is kept in memory only.
- **Fields shown:** task id, title, status, parent mission (title, status, risk) and the number of runs linked to the mission.
- **Honesty:**
  - Assignee, due date and description are not in the server `WorkTask` (only taskId, missionId, projectId, tenantId, title, status and dependsOn exist) and always show UNKNOWN. Dependencies are shown when the mission read carries `dependsOn`, otherwise UNKNOWN.
  - The "Run link" row (A-UI026-1) lists the task's linked runs (run id and status; the NEWEST 5, so the governing run, which is the last one linked, is always shown and flagged with `data-task-run-link-governing="1"` (a data attribute for tests and assistive tooling; there is no visible label), plus a "+N older linked run(s) not shown" note) from the same `GET /v1/tasks/:id/runs` read the task-runs panel below uses (no second read). A VERIFIED empty read says "No run is linked to this task."; an unreadable or malformed read stays UNKNOWN. The "Mission runs" count remains a mission-level count.
  - A mission read that is not VERIFIED (including STALE) yields UNKNOWN. A task missing from the read yields EMPTY. Unreadable work-runs give an UNKNOWN run count.
- **Link integrity:** every link in the read must belong to the selected task and its mission; a link for another task or mission turns the whole read into ERROR, so the row stays UNKNOWN and no foreign run is shown. A late answer for a previously selected task is never shown for the newly selected one.
- **Rendering:** `h()`/`textContent` only. `data-task-inspect`, `data-task-field` and `data-task-inspector` are new names. The Run link row adds `data-task-run-links` (`none` | `linked`), `data-task-run-link` (the run id) with `data-task-run-link-governing` (`1` on the governing run) and `data-run-link-more` (the number of older links not shown); `data-run-link` is used by `views/run-link.js` for a mission id and is deliberately not reused here. The CSS block uses tokens only.
- **Product verification:** NOT_VERIFIED. Windows and the full run-validation are NOT_RUN.
