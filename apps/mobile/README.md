<!-- //TR: Mobil Companion salt okunur izleme çekirdeği (PQ-008): saf TypeScript, bağımlılık yok; yalnız unit test seviyesi, entegre değil. -->
# Mobile Companion: monitoring core (PQ-008)

Pure TypeScript under `src/core/`: read-only store, view models and STALE/OFFLINE cache rules for UI-097, UI-099, UI-102, UI-177 (MOB-6).

- No React Native or other dependency, no `fetch`/WebSocket, no storage API. Data comes through the injected `MonitoringReader` (`types.ts`).
- Every field maps to a MOB-3 **PROPOSED** route and is `NOT_CONNECTED` (`ROUTE_CONNECTION`) until that route exists.
- States: LOADING, EMPTY, ERROR, OFFLINE, STALE (with age), UNAVAILABLE, DENIED. A cached read is always STALE, never VERIFIED (ADR-MOB-001 section 5).
- No approve, STOP, RESUME, retry-queue or any write surface.

Test: `npx vitest run apps/mobile/src/core/monitoring.test.ts`. Status: TESTED (unit, local); not INTEGRATED.

## Companion screens (UASCO-T0083)

Pure TypeScript under `src/companion/` (still no React Native/Android toolchain or dependency in this repo):

- `api-client.ts`: typed, **read-only** client (GET only) for routes that exist today: `GET /v1/attention`, `GET /v1/control/status`. Transport is injected; the app never embeds a credential. Responses are parsed strictly: a malformed body is an error, never a partial list.
- `screens.ts`: status overview, pending approvals list + detail, notification list. Notifications are **derived** from `/v1/attention` (no notification route exists) and labelled so.
- Approve/Reject are **disabled** with the reason `NO_DEVICE_SCOPED_APPROVAL_ROUTE`: the existing decision routes need the desktop control token on 127.0.0.1, which must never be on a phone.
- `render-html.ts`: escaped static preview renderer, used by component tests and screenshots. It is not an RN/Android build.
- Phone reachability: `NOT_CONNECTED` (`LOOPBACK_ONLY_NO_MOBILE_GATEWAY`) until the `/v1/mobile` gateway (UASCO-T0084) exists.

Tests: `npx vitest run apps/mobile` (unit + component) and `npx vitest run tests/mobile-companion-contract.test.ts` (client against the real control-api in-process).
