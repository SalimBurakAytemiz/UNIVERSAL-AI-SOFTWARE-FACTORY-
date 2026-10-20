<!-- //TR: UI-132 kapanış ve devir kontrol listesi tasarım notu (salt-okunur, yalnız renderer). -->
# UI-132 — Project closure and handover checklist (#/projects)

Read-only, renderer-only. Per project, six items derived from existing reads (`/v1/projects`, `/v1/missions`, `/v1/work-runs`, `/v1/deliveries?projectId=`): has missions, all missions done, no active runs, no failed/blocked missions, source delivery complete, product verified.

- States: `MET`, `OPEN`, `UNKNOWN`. A read that is not live yields `UNKNOWN`, never `MET`.
- Delivery stays source-level: product verification is `MET` only if the server itself reports `PRODUCT_VERIFIED`; otherwise `OPEN` (NOT_VERIFIED).
- No sign-off/approve action (that would need a new endpoint). No new endpoint, storage, IPC or POST.
- Logic: `apps/desktop/renderer/closure-core.js` (pure); view: `views/projects.js`; tests: `tests/v7-ux-wp-projects.test.ts`.
