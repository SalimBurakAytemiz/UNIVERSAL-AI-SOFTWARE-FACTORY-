<!-- //TR: UI-025 "Görev ve koşu zaman çizelgesi" teslim kaydı: kapsam, dürüstlük kuralları ve çalıştırılmayan (NOT_RUN) doğrulamalar. Ürün doğrulaması NOT_VERIFIED. -->

# UI-025 Read-only task and work-run timeline

- **Where:** mission detail on `#/work`, above the status path. No route was added.
- **Data:** only the `GET /v1/missions/:id` and `GET /v1/work-runs` reads the view already makes. No new endpoint, allow-list entry, POST, IPC or storage. No zoom or other state is persisted.
- **Events:** mission created, run started, run checkpoints. Sorted by time, ascending.
- **Honesty:**
  - An event without a timestamp shows UNKNOWN and is placed last; no time is invented.
  - A mission read that is not VERIFIED (including STALE) yields UNKNOWN. If work-runs are unreadable, run events are absent and an UNKNOWN note says so.
- **Rendering:** `h()`/`textContent` only. `data-wtl-kind`, `data-wtl-at` and `data-wtl-state` are new names. The CSS block uses tokens only.
- **Product verification:** NOT_VERIFIED. Windows and the full run-validation are NOT_RUN.
