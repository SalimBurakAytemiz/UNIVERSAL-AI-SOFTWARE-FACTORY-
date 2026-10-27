<!-- //TR: UI-026 "Görev Denetçisi" teslim kaydı: kapsam, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Ürün doğrulaması NOT_VERIFIED. -->

# UI-026 Read-only task detail inspector

- **Where:** mission detail on `#/work`. Each task in the Tasks list is a button; selecting it opens the inspector, selecting it again closes it. No route was added.
- **Data:** only the `GET /v1/missions/:id`, `GET /v1/work-runs` and (for the selected task) `GET /v1/tasks/:id/runs` reads the view already makes. No new endpoint, allow-list entry, POST, IPC or storage. The selection is kept in memory only.
- **Fields shown:** task id, title, status, parent mission (title, status, risk) and the number of runs linked to the mission.
- **Honesty:**
  - Assignee, due date and description are not in the server `WorkTask` (only taskId, missionId, projectId, tenantId, title, status and dependsOn exist) and always show UNKNOWN. Dependencies are shown when the mission read carries `dependsOn`, otherwise UNKNOWN.
  - The "Run link" row (A-UI026-1) lists the task's linked runs (run id and status, at most 5, then "+N more") from the same `GET /v1/tasks/:id/runs` read the task-runs panel below uses (no second read). A VERIFIED empty read says "No run is linked to this task."; an unreadable or malformed read stays UNKNOWN. The "Mission runs" count remains a mission-level count.
  - A mission read that is not VERIFIED (including STALE) yields UNKNOWN. A task missing from the read yields EMPTY. Unreadable work-runs give an UNKNOWN run count.
- **Rendering:** `h()`/`textContent` only. `data-task-inspect`, `data-task-field` and `data-task-inspector` are new names. The CSS block uses tokens only.
- **Product verification:** NOT_VERIFIED. Windows and the full run-validation are NOT_RUN.
