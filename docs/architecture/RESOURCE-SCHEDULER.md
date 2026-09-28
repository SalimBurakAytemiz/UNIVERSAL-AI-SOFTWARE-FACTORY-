<!-- //TR: Bu dosya fiziksel telefon, browser, VM, GPU, cloud slot ve test environment gibi kısıtlı kaynakların lease/scheduler ile çakışmadan kullanılmasını tanımlar. -->
# Resource Registry & Scheduler

Resource lifecycle:
DISCOVERED -> HEALTH_CHECK -> READY -> LEASED -> BUSY -> RELEASED -> READY

Failure:
DEGRADED / QUARANTINED / OFFLINE / MISSING_TOOL / NO_CREDENTIAL.

Scheduler considers:
capability, platform, health, customer isolation, data policy, cost, quota, lease, queue priority and mission risk.

Builder work is routed between the `LOCAL_CLAUDE` and `CLAUDE_CLOUD_SESSION` execution backends by the fail-closed policy in `docs/architecture/EXECUTION-BACKENDS.md`; host-bound work stays local.
