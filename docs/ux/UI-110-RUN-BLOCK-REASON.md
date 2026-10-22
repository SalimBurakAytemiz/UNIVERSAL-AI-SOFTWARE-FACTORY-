<!-- //TR: UI-110 — durdurulmuş/başarısız koşuların sunucu kayıtlı nedeni (yalnız renderer, salt-okunur GET /v1/work-runs). -->
# UI-110 — Run stop/failure reason

- #/executive Execution Ledger, Return Summary and #/readiness run cards show the server-recorded `WorkRun.reason` for FAILED, RECOVERY_FAILED, BLOCKED, QUARANTINED, CANCELLING and CANCELLED runs, as plain text; a null reason shows the em dash.
- Source: existing `GET /v1/work-runs` only. No new endpoint, POST, IPC or storage.
- Still open: reason on the #/work mission list/board and mission-level BLOCKED reasons.
- This document makes no product-verification claim.
