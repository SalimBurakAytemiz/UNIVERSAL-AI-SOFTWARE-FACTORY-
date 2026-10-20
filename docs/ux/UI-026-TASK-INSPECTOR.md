<!-- //TR: UI-026 "Görev Denetçisi" teslim kaydı: kapsam, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. Ürün doğrulaması NOT_VERIFIED. -->

# UI-026 Read-only task detail inspector

- **Where:** mission detail on `#/work`. Each task in the Tasks list is a button; selecting it opens the inspector, selecting it again closes it. No route was added.
- **Data:** only the `GET /v1/missions/:id` and `GET /v1/work-runs` reads the view already makes. No new endpoint, allow-list entry, POST, IPC or storage. The selection is kept in memory only.
- **Fields shown:** task id, title, status, parent mission (title, status, risk) and the number of runs linked to the mission.
- **Honesty:**
  - Assignee, due date, dependencies and description are not in the API and always show UNKNOWN.
  - The run-to-task link does not exist server-side, so it shows UNKNOWN. The run count is labelled as mission-level.
  - A mission read that is not VERIFIED (including STALE) yields UNKNOWN. A task missing from the read yields EMPTY. Unreadable work-runs give an UNKNOWN run count.
- **Rendering:** `h()`/`textContent` only. `data-task-inspect`, `data-task-field` and `data-task-inspector` are new names. The CSS block uses tokens only.
- **Product verification:** NOT_VERIFIED. Windows and the full run-validation are NOT_RUN.
