<!-- //TR: UASCO Master V2 kontrollü kapanış ham doğrulama kaydı -->
# G9 — Master V2 kontrollü kapanış: ham doğrulama kaydı (2026-11-02 ≈05:57Z-06:15Z)

Oturum: session_015dYwb2fTtgsPy3wpVN9rYC. Yalnız okuma ve rapor yazımı; trigger/PR/secret/ayar değişikliği yok.

| # | Kontrol | Araç | Sonuç |
| --- | --- | --- | --- |
| 1 | Rutinler | list_triggers (limit 100) | 11 rutin, 11'i enabled=false. trig_018vLbG82sUcp6ncPhRurka5 updated 05:40:11Z, last_fired 05:30:03Z; trig_01NJCi2PSTJxh6rMMLewLvGM updated 05:40:15Z, last_fired 05:38:44Z; controller/lane tick'leri updated 02:27:25Z; heartbeat 05:16:43Z |
| 2 | Açık PR | list_pull_requests state=open | 10: #294 81fecb0, #293 ee2facb, #292 43776e1 (non-draft); #291 4b4eee0, #288 7bf22e5, #282 b13e23d, #251 f40bea3, #247 323c14f, #231 c9a3e2d, #66 ffeaf79 (draft) |
| 3 | Integration head | git ls-remote / PR base.sha | v7/integration 0b71650fa88b9802968562c63ca33f8b56e9648b |
| 4 | Waiting runs | actions_list status=waiting | total_count 1: 39687649214 (IR, 2026-10-21) |
| 5 | #293 IR run | actions_get 41381085962 | completed success 05:43:09Z; founder-authority job 125071926978 success 05:42:07-11Z; ai-review 125115982300 success; finish success |
| 6 | #293 IR check | get_check_run 125071908981 | conclusion failure: VERDICT_MISSING, REVIEWER_AUTH_REJECTED (reviewer OAuth token reddedildi) |
| 7 | #293 required | pull_request_read get_check_runs | validate (ubuntu-latest) success, validate (windows-latest) success, shard 1-3 success, installer success; mergeable_state unstable |
| 8 | #293 ledger | coord-ledger.mjs merge-gate --pr 293 --sha ee2facb… @2e92b366 | exit 5 CLOSED VERDICT_BLOCKING |
| 9 | #294 CI | actions_list jobs 41393881832 + get_job_logs 125111026076 | ubuntu FAIL (run-validation), shard1 FAIL `DEPENDENCY_AUDIT_BLOCKERS:11`, shard 2-3 success, aggregator FAIL; IR 41393879807 success |
| 10 | Oturumlar | list_sessions, get_session | Lane A/B/C IDLE (05:17Z); koordinatör IDLE, disconnected, cost_usd 4549.72 |
| 11 | Lease refs | git ls-remote origin 'refs/uasco/*' | 0 |
| 12 | Zamanlanmış workflow | grep cron/schedule .github/workflows/*.yml @0b71650 | 0 |
| 13 | Kod spot kontrolleri @0b71650 | sed/grep | packaged-entry.ts:52-57 sandbox seçeneği yok; crew/coordinator.ts yalnız predev placeholder/validators'ta anılıyor; routeModel/chooseProvider üretim çağıranı yalnız core/policy/model-routing.ts; command-intake importer 0; adapter-reality.ts:40 OmniRoute "imported by nothing"; apps/core/models'ta PR/push API 0 |
| 14 | Founder-PC | — | Erişim yok → V6 supervisor, Task Scheduler, yerel worker, Cowork yerel görevleri UNKNOWN |
