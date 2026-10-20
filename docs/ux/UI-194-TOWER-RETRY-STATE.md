<!-- //TR: UI-194 Control Tower yeniden deneme olgusu: dürüst okuma/geçersiz durumları ve Operasyon ile paylaşılan faz sınıflaması. -->
# UI-194 Tower retry fact

Source: `GET /v1/retry` only (no new endpoint). `data-retry-state` values:

| State | Meaning |
|---|---|
| OFFLINE / UNAVAILABLE / ERROR | Read failed: dash plus state text, never "No pending retry". |
| NONE | Read ok, data null: "No pending retry". |
| INVALID | `{status:"INVALID"}` or record failing `validateRetryRecord`: no package, no time. |
| WAITING / DUE / OVERDUE / UNDETERMINED | `classifyRetryPhase` from `operations-core.js` (same function as #/operations); time only from `retryAt` minus `ctx.now()`. |

The free-text reason is not rendered. DUE/OVERDUE never claim recovery. No circuit-breaker, provider or SLA data exists.
