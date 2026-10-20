<!-- //TR: UI-182 teslim kartı kaynak sapması (stale/valid) durumu için kısa UX notu. -->
# UI-182 — Delivery card source drift

`deliverySourceState(d)` compares `artifact.sourceCommit` with the run head (`d.sourceCommit`), both already read by the renderer. Read-only; GET only.

| State | Condition | Card |
| --- | --- | --- |
| NOT_PREPARED | no artifact | no note |
| VALID | both 40-hex and equal | note: built from the current head (no verification claim) |
| STALE | both 40-hex, differ | note names both commits; open-accept hidden, dialog accept disabled, prepare stays |
| UNKNOWN | head missing/invalid | note: validity not claimed; same blocking |

An accepted record for an earlier commit shows a read-only note. `err.deliveryStale` replaces `err.deliveryNotPrepared` only for STALE. If the delivery read is not VERIFIED the existing state note is kept and no drift claim is rendered.
