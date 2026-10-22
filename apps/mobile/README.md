<!-- //TR: Mobil Companion salt okunur izleme çekirdeği (PQ-008): saf TypeScript, bağımlılık yok; yalnız unit test seviyesi, entegre değil. -->
# Mobile Companion: monitoring core (PQ-008)

Pure TypeScript under `src/core/`: read-only store, view models and STALE/OFFLINE cache rules for UI-097, UI-099, UI-102, UI-177 (MOB-6).

- No React Native or other dependency, no `fetch`/WebSocket, no storage API. Data comes through the injected `MonitoringReader` (`types.ts`).
- Every field maps to a MOB-3 **PROPOSED** route and is `NOT_CONNECTED` (`ROUTE_CONNECTION`) until that route exists.
- States: LOADING, EMPTY, ERROR, OFFLINE, STALE (with age), UNAVAILABLE, DENIED. A cached read is always STALE, never VERIFIED (ADR-MOB-001 section 5).
- No approve, STOP, RESUME, retry-queue or any write surface.

Test: `npx vitest run apps/mobile/src/core/monitoring.test.ts`. Status: TESTED (unit, local); not INTEGRATED.
