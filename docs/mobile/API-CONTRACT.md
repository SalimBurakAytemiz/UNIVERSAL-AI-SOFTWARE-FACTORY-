<!-- //TR: MOB-3 Android Mobile Companion salt okunur API sözleşmesi (yalnız doküman, FD-2026-10-20-MOB-PHASE0): ÖNERİLEN /v1/mobile/* GET projeksiyonları, masaüstü renderer'ın bugün kullandığı mevcut GET uç noktalarına dosya:satır kanıtıyla eşlenir; cihaz kapsamlı MOBILE_READ oturumu, dürüst durumlar (UNKNOWN, UNAVAILABLE, STALE), sayfalama ve sınırlar, hata kodları, hız sınırları, kapsam dışı yazma/onay/STOP/RESUME listesi, SC-* eşlemesi ve açık sorular. Hiçbir uç nokta uygulanmış veya yetkilendirilmiş değildir; kod, dinleyici, API veya kimlik doğrulama değişikliği vermez. -->

# MOB-3: Mobile read-only API contract (PROPOSED, docs only)

- **Task:** MOB-3, "Mobile API contract specification (PROPOSED endpoints)" (`docs/planning/BACKLOG_CHECKPOINT.json`, entry `MOB-3`).
- **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md` (documentation only, files under `docs/mobile/**` only). Scope record: `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md` sections 4, 5, 9-11 (cited as **D-MOB**).
- **Inputs:** `docs/mobile/THREAT-MODEL.md`, `docs/mobile/SECURITY-CONDITIONS.md` (SC-1..SC-26), `docs/mobile/CONNECTIVITY-AND-PAIRING.md` (cited as **MOB-2**), `docs/mobile/ADR-MOB-001-REACT-NATIVE-ANDROID.md`, `docs/mobile/TECH-VERSIONS.md`.
- **Status: PROPOSED.** Nothing in this document is implemented or authorised. No `/v1/mobile/*` route exists. Implementing any of it needs, at minimum, FA-MOB-3 (TLS gateway listener), FA-MOB-4 (device sessions), FA-MOB-5 (read projections) and FA-MOB-6 (protected `server.ts` edit, allow-list, reseal). This document grants nothing.
- **Evidence convention:** every `path:line` was re-read on base `57f3bff` (`origin/v7/integration`). Claims not re-read in code are marked **UNVERIFIED**. `server.ts` means `apps/control-api/src/server.ts`; `api.js` means `apps/desktop/renderer/api.js`; `main.mjs` means `apps/desktop/main.mjs`. No technology version is claimed here; versions belong to `TECH-VERSIONS.md`.

## 1. Founder constraints carried

- **Release 1 is read-only monitoring.** Every release-1 route is `GET`. No approval, transition, delivery, STOP, RESUME, retry or draft route is reachable from the phone (SC-25).
- **No mobile approvals before PT-035** (`server.ts:164-167` hard-codes the policy context). Mobile STOP is evaluated separately (MOB-4, FA-MOB-8). RESUME is desktop-only.
- **Connectivity model A first** (same-LAN QR pairing plus pinned TLS, MOB-2 sections 4-5), model B (user-managed VPN/overlay) later with the same app-level authentication. No tunnel, no relay, no second backend, no second store (SC-7, SC-24).
- **No FCM, no paid LLM, no new external account in release 1.** The notification feed below is in-app pull only.

## 2. Current-state facts this contract must respect (VERIFIED)

| Fact | Evidence |
|---|---|
| The control plane listens on `127.0.0.1` only | `server.ts:739` (`app.listen({host:"127.0.0.1",port})`); `apps/control-api/src/packaged-entry.ts:79` per D-MOB, not re-read (**UNVERIFIED** here) |
| Every request with a Host other than exactly `127.0.0.1:<port>` gets 421 `CONTROL_HOST_REJECTED` | `server.ts:97-98`; `automation/lib/control-boundary.mjs:29` |
| `/v1/*` needs the single shared `x-uasco-control-token`; missing token config 503, wrong token 403 `FORBIDDEN` | `server.ts:77`, `:100-101` |
| Every request runs as `FOUNDER_LOCAL` in tenant `local` | `server.ts:156` |
| `/health` is unauthenticated and returns a token-derived proof | `server.ts:104` |
| Plain HTTP, 64 KiB body limit, no TLS | `server.ts:66` |
| Contract states on the server: `VERIFIED`, `STALE`, `UNAVAILABLE`, `ERROR` | `server.ts:669` (`CockpitState`) |
| Contract states in the renderer: the same four | `apps/desktop/renderer/model.js:2` (`CONTRACT_STATES`) |
| Journal health: `OK`, `ABSENT`, `TORN_TAIL`, `TAMPERED`, `UNAVAILABLE` | `core/workos/store.ts:134-140` |
| Journal sequence exists but is not exposed by any route | `core/workos/store.ts:131` (`lastSeq` getter) |
| Known Work OS errors return fixed bodies; tampered/unavailable journal is 503; unknown errors are a generic 500 | `server.ts:169-183` |
| The renderer reaches the API only through main-process allow-lists (static set and regexes) | `main.mjs:36` (`EXTRA_GET_ROUTES`), `main.mjs:103-107`, `main.mjs:265`; `control-boundary.mjs:9-11`, `:30-36` |

Consequence: **a phone cannot reach any of this today**, and the mobile contract is not "the desktop API over TLS". It is a separate, purpose-built, allow-listed projection set served by a future gateway that never presents or forwards the control token and never forges the loopback Host (SC-1, SC-17; MOB-2 G-4, G-5).

## 3. Common contract (applies to every PROPOSED route)

### 3.1 Transport and authentication

| Item | PROPOSED rule | Source |
|---|---|---|
| Base | `https://<bound-LAN-address>:<gateway-port>/v1/mobile/` on the gateway listener only; never on the loopback listener | MOB-2 G-1..G-4 |
| TLS | pinned SPKI from the pairing QR; no plain HTTP, no redirect, no fallback | MOB-2 section 5.3; SC-2 |
| Method | `GET` and `HEAD` only in release 1. Any other method → 405 on an allow-listed path, 404 elsewhere | SC-25 |
| Credential | device-scoped session token with scope `MOBILE_READ`, plus a per-request device-key signature over method, path, timestamp and nonce | MOB-2 section 5.4 |
| Headers (PROPOSED names) | `Authorization: Bearer <session>`; `x-uasco-mobile-device: <deviceId>`; `x-uasco-mobile-ts`; `x-uasco-mobile-nonce`; `x-uasco-mobile-sig` | MOB-2 section 5.4 (header names are new in this document) |
| Forbidden | `x-uasco-control-token` on the gateway → rejected with 401 and audited; the gateway never reads `controlToken` | SC-1, SC-17 |
| Principal | `MOBILE_DEVICE:<deviceId>`, never `FOUNDER_LOCAL` | SC-18; MOB-2 section 5.4 |
| Tenant | Today the only tenant is `local` (`server.ts:156`). The device principal maps to the tenant recorded at pairing. Open question Q-3 | — |
| `/health` | not served on the gateway (404) | SC-2 |

### 3.2 Response envelope

Every 200 response uses one envelope so the app can render honest states without guessing:

```json
{
  "contract": "uasco.mobile.v1",
  "route": "summary",
  "generatedAt": "2026-10-20T10:00:00.000Z",
  "state": "VERIFIED",
  "journal": { "state": "OK", "seq": 1234 },
  "etag": "W/\"m1-1234-…\"",
  "data": { },
  "page": { "limit": 25, "nextCursor": null, "truncated": false },
  "notice": null
}
```

- `state` is the route-level state. `data` blocks carry their own `state` where sources differ (as `/v1/cockpit` already does per block, `server.ts:675-687`, `:709-722`, `:724-727`).
- `journal.state` is copied from `journalHealth()` (`store.ts:134-140`). `journal.seq` is `lastSeq` (`store.ts:131`); exposing it is new (FA-MOB-5).
- `page` appears only on list routes.
- `notice` is a fixed server string (like `REVIEWS_NOTICE`, `server.ts:646`), never free text from data.

### 3.3 Honest states

| State | Meaning | Rendered as | Where it comes from |
|---|---|---|---|
| `VERIFIED` | read from the authoritative source on this request | values | `CockpitState` (`server.ts:669`) |
| `STALE` | the source answered, but its own freshness marker is old (for example an expired orchestrator lease, `server.ts:703-704`); **or**, on the phone only, a cached copy shown while the desktop is unreachable, with its fetch time | values plus a STALE badge and age | server and phone (SC-7) |
| `UNAVAILABLE` | the source does not exist in this installation (for example no journal yet: `server.ts:678`, `:719`) | `—`, never `0` | `CockpitState` |
| `UNKNOWN` | **new in this contract.** The server cannot compute the value with the data it holds (for example worker liveness, cloud sessions, GitHub CI). Distinct from `UNAVAILABLE`, which means the source is missing | `UNKNOWN`, never a guess | PROPOSED |
| `ERROR` | the source exists but could not be read or failed validation | `—` plus error | `CockpitState` |

Rules:

- Missing or failed data is `null` with a state, never a number (same rule as the renderer, `model.js:1` comment; cockpit evidence nulls, `server.ts:726`).
- A `TAMPERED` or `UNAVAILABLE` journal makes every Work OS-backed route answer 503 `DESKTOP_DEGRADED` (MOB-2 section 9). `TORN_TAIL` keeps reads available with `journal.state:"TORN_TAIL"` and a read-only banner (MOB-2 section 9). The desktop route already reports this through `/v1/control/status` (`server.ts:119-120`).
- The phone adds `OFFLINE` locally for network failure (ADR-MOB-001 section 5); the server never sends it.

### 3.4 Pagination, ETag and caps

| Rule | PROPOSED value | Existing precedent |
|---|---|---|
| Cursor | opaque, base64url, at most 512 characters, bound to the route, the filter and the device; rejected on any other route (400 `INVALID_CURSOR`) | `/v1/evidence` cursor `[A-Za-z0-9_-]{1,1500}` (`server.ts:446`); `/v1/roles` key cursor (`server.ts:561-562`) |
| `limit` | default 25, minimum 1, maximum 100; anything else 400 `INVALID_LIMIT` | `/v1/roles` 1..100 default 50 (`server.ts:556-557`); `/v1/evidence` 1..100 (`server.ts:447-448`) |
| Order | stable server order by `(updatedAt desc, id desc)`; the cursor encodes the last key, so a page never repeats or skips while the journal is unchanged | `/v1/reviews` sorts by timestamp then id (`server.ts:644`) |
| `truncated` | true when a server-side hard cap cut the source before paging | `/v1/reviews` `truncated` with `REVIEWS_MAX=500` (`server.ts:606`, `:647`) |
| ETag | weak ETag over `(contract, route, filter, journal seq, digest of non-journal inputs)`; `If-None-Match` → 304 with no body | none today; `lastSeq` not exposed (`store.ts:131`) |
| `since` | journal sequence; only on `/v1/mobile/changes` | none today |
| Response size | at most 256 KiB per response; a projection that would exceed it shrinks the page and sets `truncated` | none today (D-MOB: `/v1/projects`, `/v1/work-runs` unpaginated) |
| String fields | titles capped at 200 characters, reasons at 300, ids by their canonical regex; all marked untrusted text (SC-10) | `scrubText` 300 chars in `main.mjs:211-214` |
| Never included | absolute paths, tokens, secrets, stack traces, raw evidence bodies, log tails, file content, diffs | MOB-2 G-13; SC-3 |

ETag caveat (**UNVERIFIED**): several sources are not in the journal (`GLOBAL_STOP.json` at `server.ts:674`, orchestrator state `server.ts:689-707`, role registry files `server.ts:715-716`). An ETag based on `lastSeq` alone would miss their changes, so the digest of those inputs must be part of the ETag. Whether that is cheap enough on every request is unmeasured.

### 3.5 Error codes

Every error body is `{"error":"<CODE>"}` plus at most a fixed `reason` code, like the existing `workosFail` (`server.ts:169-183`). No message text, path or stack.

| HTTP | Code | When | Status of the code |
|---|---|---|---|
| 304 | — | `If-None-Match` matches | PROPOSED |
| 400 | `INVALID_CURSOR`, `INVALID_LIMIT`, `INVALID_PROJECT_ID`, `INVALID_MISSION_ID`, `INVALID_RUN_ID`, `INVALID_SINCE`, `INVALID_FILTER` | bad query or path parameter | reuses existing codes (`server.ts:208`, `:218`, `:275`, `:446-448`, `:463`); `INVALID_SINCE` is new |
| 401 | `MOBILE_SESSION_INVALID`, `MOBILE_SESSION_EXPIRED`, `MOBILE_SIGNATURE_INVALID`, `MOBILE_CLOCK_SKEW`, `DEVICE_REVOKED`, `CONTROL_TOKEN_NOT_ACCEPTED` | credential problems (MOB-2 section 9) | PROPOSED |
| 403 | `MOBILE_SCOPE_INSUFFICIENT` | a known mobile route needs a scope the session lacks (no release-1 route does) | PROPOSED |
| 404 | `NOT_FOUND` (route), `WORKOS_NOT_FOUND` (entity) | unknown or excluded route; missing entity in the device's tenant | `WORKOS_NOT_FOUND` exists (`server.ts:179`, `:219`) |
| 405 | `METHOD_NOT_ALLOWED` | non-GET/HEAD on an allow-listed path | PROPOSED (SC-25) |
| 421 | `MOBILE_HOST_REJECTED` | Host/SNI not the bound gateway address | PROPOSED (gateway's own policy, SC-17) |
| 429 | `MOBILE_RATE_LIMITED` with `Retry-After` | section 3.6 | PROPOSED |
| 503 | `DESKTOP_DEGRADED` with reason `JOURNAL_TAMPERED` or `JOURNAL_UNAVAILABLE`; `GATEWAY_NOT_READY` | journal unsafe; gateway inputs missing | maps existing 503 cases (`server.ts:179`) |
| 500 | `INTERNAL_ERROR` | anything else | existing (`server.ts:183`) |

Open question Q-5: SC-3 and SC-25 say excluded routes answer 404 or 405; MOB-2 section 9 says "route not on allow-list → 403". This contract proposes **404 for every path not on the allow-list** (no route enumeration) and **403 only for scope**, and asks the Founder to confirm.

### 3.6 Rate limits

No rate-limiting dependency exists (D-MOB section 4, `package.json:38-42`; not re-read, **UNVERIFIED** here). All values are PROPOSED and enforced by the gateway before route handling (MOB-2 G-8):

| Bucket | Limit | Notes |
|---|---|---|
| Per device, all routes | 60 requests/minute, burst 10 | HEAD and 304 count |
| Per device, `reports` | 6 requests/minute | the evidence summary re-hashes all evidence bytes on every request (`server.ts:437` comment); the gateway should serve a short-lived (proposed 30 s) server-side memo |
| Per device, `changes` | 1 request per 15 s | foreground polling only; no background service in release 1 |
| Per source address, unauthenticated failures | 10/minute, then lock-out per MOB-2 section 5 | pairing limits are MOB-2's |
| Global gateway | 300 requests/minute | protects the desktop process |

Exceeding a bucket → 429 `MOBILE_RATE_LIMITED`, `Retry-After` in seconds, audited with the device id (SC-18).

## 4. PROPOSED release-1 routes

All routes: method `GET` (and `HEAD`), scope `MOBILE_READ`, envelope of section 3.2, errors of section 3.5, limits of section 3.6. "Renderer use" names the existing renderer call that already reads the same source, which is the evidence that the projection maps onto an existing desktop GET.

### 4.1 `GET /v1/mobile/summary` (F1 dashboard; UI-097, UI-103)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/cockpit` | `server.ts:728-731` (blocks from `cockpitStop` `:674`, `cockpitWorkos` `:675-687`, `cockpitOrchestrator` `:689-707`, `cockpitWorkforce` `:710-722`, `cockpitEvidence` `:724-727`) | `api.js:47`; `executive-core.js:4` (`COCKPIT_PATH`) |
| `GET /v1/control/status` | `server.ts:119-120` | `api.js:50`; `operations-core.js:5` |

Response `data`:

| Field | Type | Source | State rule |
|---|---|---|---|
| `globalStop.active`, `globalStop.reason` | bool, fixed code or null | `cockpitStop` `:674` | unsafe stop file is reported as active `GLOBAL_STOP_STATE_UNSAFE` (`:674`), never hidden |
| `globalStop.scopeNotice` | fixed string "local Work OS and dev-runs only, not Cloud production" | SC-6 | always |
| `projects.count` | int or null | `cockpitWorkos` `:682` region | `UNAVAILABLE` without journal (`:676-678`) |
| `missions.total`, `missions.byStatus` | int, map | `:682` | same |
| `awaitingApproval.count` | int or null | `:683` (missions in `PREFLIGHT` or `FOUNDER_ATTENTION_REQUIRED`) | count only; **no items and no action descriptors in release 1** (section 5) |
| `workforce.activeWorkerRuns`, `workforce.canonicalRoles` | int or null | `:710-722` | `UNAVAILABLE`/`ERROR` as the cockpit block |
| `orchestrator.state`, `orchestrator.asOf`, `orchestrator.packagesByStatus` | state, time, map | `:689-707` | `STALE` on expired lease (`:703-704`); probably `UNAVAILABLE` in the installed app (D-MOB, **UNVERIFIED**) |
| `evidence.total/verified/mismatch/missing/unverifiable` | int or null | `:724-727` | nulls on `ERROR` (`:726`) |
| `runsByStatus` | map or `UNKNOWN` | not served today (D-MOB F1 gap) | `UNKNOWN` until a store count exists |
| `legacy` | omitted | `:730` legacy scheduler snapshot is not authority | — |

Pagination: none (single object). Cap: 16 KiB.

### 4.2 `GET /v1/mobile/projects?cursor&limit` (F2; UI-103, UI-180)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/projects` | `server.ts:194` (`listProjects`, `store.ts:874`) | `api.js:48`; `matrix-core.js:6` |
| `GET /v1/missions?projectId` | `server.ts:207-210` (`listMissions`, `store.ts:876`) | `api.js:49` |
| `GET /v1/deliveries?projectId` | `server.ts:287-290` | `api.js:85`; `apps/desktop/renderer/delivery-core.js:11` |

Item shape: `{projectId, name (untrusted), state, missions:{total, byStatus}, activeRuns, awaitingApproval, lastActivityAt}`. No repository path, no `repository` object (the source `Project` carries a local `path`, set at `server.ts:361`), no template detail.

- Pagination: cursor and `limit` per section 3.4. The source is unpaginated today, so the projection pages in the gateway.
- Per-project rollup is new (D-MOB F2 gap). `activeRuns` per project is `UNKNOWN` until the store offers it; computing it by scanning `listRuns` (`store.ts:740`) per request is the cost to measure (**UNVERIFIED**).
- Single tenant (`server.ts:156`): the list is the device tenant's projects. Server-side project scoping for UI-180 is open question Q-3.

### 4.3 `GET /v1/mobile/workers?cursor&limit` (F3; UI-102, UI-178)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/agents` | `server.ts:110-113` (503 `ROLE_REGISTRY_UNAVAILABLE` at `:111`) | `api.js:89` |
| `GET /v1/roles?cursor&limit` | `server.ts:549-562` | `api.js:90` (pages of 100) |
| `cockpit.workforce` | `server.ts:710-722` | via `api.js:47` |
| run lease fields | `core/workos/types.ts:131-143` per D-MOB (**UNVERIFIED** here) | — |

Item shape: `{runId, missionId, projectId, status, executorRole, leaseExpiresAt, liveness}` for runs in active worker statuses (the cockpit counts LEASED, RUNNING, CHECKPOINTING, VERIFYING, `server.ts:709` comment; `countActiveWorkerRuns`, `store.ts:744`), plus a header block `{canonicalRoles, activeWorkerRuns}`.

- `liveness` is `UNKNOWN` in release 1: no heartbeat or stuck-lease flag exists (D-MOB F3 gap). A lease past `leaseExpiresAt` may be shown as `STALE`, not as "stuck" (**UNVERIFIED**: lease field names not re-read).
- Cloud sessions are not visible to the desktop; they are reported as `UNKNOWN`, not as zero.
- **Excluded:** `GET /v1/system/executors` (`server.ts:426`). D-MOB and the inventory report that this GET writes `settings.json` (FRONTEND_BACKEND_MATRIX line 142); not re-traced here (**UNVERIFIED**), so it is excluded on either reading (SC-3, SC-19).

### 4.4 `GET /v1/mobile/runs?missionId&status&cursor&limit` (F4; UI-099)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/work-runs?missionId` | `server.ts:274-277` (`listRuns`, `store.ts:740`) | `api.js:62-63`; `executive-core.js:4` (`WORK_RUNS_PATH`) |
| `GET /v1/work-runs/:id` | `server.ts:278-282` (`deriveOutcomes`, `deliveryView`) | `api.js:64` |
| `GET /v1/runs` (supervisor runs, top 100) | `server.ts:124-128` | `api.js:53`; `operations-core.js:6` |

Item shape: `{runId, missionId, projectId, status, startedAt, updatedAt, outcome:{state, code}, delivery:{state}, evidence:{count, byKind}}`.

- The source returns full run objects including evidence (D-MOB, MATRIX line 146); the projection returns counts by kind, never evidence bodies or log tails.
- `status` filter accepts only values of the run status enum (**UNVERIFIED**: enum file not re-read; D-MOB cites `types.ts:67-69` for recovery statuses).
- Detail route `GET /v1/mobile/runs/:runId` returns the same item plus `outcomes` (codes only) from `server.ts:281`. 404 `WORKOS_NOT_FOUND` for another tenant's or a missing run, like `server.ts:281`.

### 4.5 `GET /v1/mobile/missions/:missionId/timeline?cursor&limit` (F4; UI-099)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/missions/:id` | `server.ts:217-220` | `api.js:59` |
| `GET /v1/predev/:missionId` | `server.ts:587-591` | `api.js:142` |
| `GET /v1/crew/:missionId` | `server.ts:592-601` | `api.js:143` |

Response: `{mission:{missionId, projectId, title (untrusted), status, riskLevel}, events:[{at, kind, fromStatus, toStatus, actorClass}]}`.

- `tasks[]` is always empty today (D-MOB: `store.ts:570`, MATRIX line 59; **UNVERIFIED** here), so the contract does not promise tasks.
- Transition `reason` text is free text: shown as untrusted with provenance (SC-10), capped at 300 characters, never parsed.
- `actorClass` is `FOUNDER_LOCAL`, `RUNNER` or `MOBILE_DEVICE` (later), never a token or a session id.
- Whether a per-mission event history can be projected from the journal without a new store index is **UNVERIFIED**.

### 4.6 `GET /v1/mobile/reports?missionId&runId&cursor&limit` (F8)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/reviews` | `server.ts:637-649` (capped at `REVIEWS_MAX=500`, `:606`) | `api.js:155`; `readiness-core.js:6` |
| `GET /v1/evidence?kind&missionId&runId&cursor&limit` | `server.ts:440-453` | `api.js:66-73`; `audit-core.js:6` |
| `cockpit.evidence` | `server.ts:724-727` | via `api.js:47` |

Response: `{reviews:{byVerdict, runsByReviewState, items:[{reviewId, runId, verdict, at}]}, evidence:{total, verified, mismatch, missing, unverifiable}, ci:{state:"UNKNOWN"}}`.

- No evidence bodies, no log tails (the evidence index keeps up to a 4 KB redacted log tail, `server.ts:437` comment; excluded here), no file paths.
- `ci.state` is `UNKNOWN`: GitHub Actions CI is not served (D-MOB F8; FA-MOB-19). F8 has no mobile screen id yet (D-MOB section 11, GAP).
- Evidence re-hashing per request (`server.ts:437`) is the reason for the tighter rate limit and memo in section 3.6.

### 4.7 `GET /v1/mobile/ops` (F9 read part; UI-176 read part, UI-178)

| Source endpoint | Server evidence | Renderer use |
|---|---|---|
| `GET /v1/control/status` | `server.ts:119-120` | `api.js:50`; `operations-core.js:5` |
| `GET /v1/runs` | `server.ts:124-128` | `operations-core.js:6` |
| `GET /v1/founder-attention` | `server.ts:122` | `api.js:51` |

Response: `{globalStop:{active, reason}, journal:{state, reason}, supervisorRuns:{count, latest:[{runId, status}]}, blocked:{count, kinds}}`.

- Read only. The phone shows STOP state and journal health; it cannot STOP, RESUME, retry-blocked or repair (section 5).
- `blocked` items show kind codes only; `retryable` flags from `server.ts:122` are omitted, because they describe an action the phone cannot take.
- Journal `TAMPERED` here is surfaced as `TAMPERED`, not hidden (SC-19), even though other Work OS routes answer 503.

### 4.8 `GET /v1/mobile/changes?since&limit` (F6 change cursor)

- **Source:** none. The journal sequence exists (`store.ts:131`) but no route exposes it.
- Response: `{journal:{state, seq}, changed:["summary","projects","runs",…], since, next}`: only the names of projections whose inputs changed since `since`, never content. The app then refetches those routes with `If-None-Match`.
- `since` greater than the current sequence, or from another journal epoch → 400 `INVALID_SINCE` and the app does a full refresh.
- Non-journal inputs (stop file, orchestrator state, registries) are reported through the same digest as the ETag (section 3.4, **UNVERIFIED** cost).
- Polling only, foreground only, 15 s minimum (section 3.6). No SSE, WebSocket or push in release 1 (none exists, D-MOB section 4).

### 4.9 `GET /v1/mobile/notifications?cursor&limit` (F6 in-app feed; UI-100 in-app, UI-178)

- **Source:** derived from the same inputs as `summary`, `runs` and `ops`; no existing route (D-MOB F6). The audit file `control-api-events.jsonl` (`server.ts:78`) is **not** served.
- Item shape: `{notificationId, at, kind, ref:{route, id}, severity}` where `kind` is a fixed enum (for example `GLOBAL_STOP_ACTIVE`, `JOURNAL_DEGRADED`, `RUN_FAILED`, `AWAITING_FOUNDER`). No free text; the app resolves `ref` through the read routes.
- Delivery is in-app pull only. No FCM, no push token, no background sender (FD; SC-8 dormant). Push registration routes are out of scope (section 5).
- Whether notifications need durable ids (and therefore journal records) or can be recomputed per request is **UNVERIFIED** and open (Q-8).

### 4.10 Routes not proposed for release 1

- `GET /v1/mobile/inbox`: the approval inbox is derived only in the renderer today (`apps/desktop/renderer/work-core.js:294-313`, `deriveInbox`, which emits accept/reject action descriptors). It belongs to F5 (FA-MOB-7) and is not in the FA-MOB-5 read set (D-MOB section 9). Release 1 shows only `awaitingApproval.count` in `summary`. A later read-only inbox must be a server-side projection, never re-derived on the phone (ADR-MOB-001 section 6).
- Project Memory: none, until the desktop/backend defines it (DESIGN_ONLY, D-MOB section 4).

## 5. OUT OF SCOPE for release 1

### 5.1 Write, approval, STOP and RESUME routes

None of these is on the release-1 allow-list. Through the gateway every one answers 404 (or 405 on an allow-listed path), and the app ships no control for it (SC-25).

| Existing route | Evidence | Mobile status | Gate before it could ever be considered |
|---|---|---|---|
| `POST /v1/missions/:id/transition` | `server.ts:221-224` | OUT | PT-035 fixed (`server.ts:164-167`); FA-MOB-7 (signed single-use approvals, SC-4, SC-5); FA-MOB-4 scope `MOBILE_APPROVE`; MOB-4 design |
| `POST /v1/work-runs/:id/delivery/prepare`, `/accept` | `server.ts:295-315` | OUT | same as above; delivery acceptance stays desktop-only unless the Founder grants otherwise (SC-5) |
| `POST /v1/work-runs/:id/delivery/export` | `server.ts:316-320` | OUT, also SC-3 export | not planned |
| `POST /v1/control/stop` | `server.ts:142-145` | OUT | FA-MOB-8; step-up and required reason (SC-6); scope `MOBILE_STOP`; MOB-4/MOB-25; "local only, not Cloud production" notice |
| `POST /v1/control/resume` | `server.ts:146` | OUT, **desktop-only** in every phase | Founder decision only (FD-2026-10-20-MOB-PHASE0) |
| `POST /v1/control/retry-blocked` | `server.ts:147-152` | OUT | not planned; would need its own grant |
| `POST /v1/missions` (accepts `testCommand`) | `server.ts:211-215`; `core/workos/schemas.ts:36-40` per SC-3 | OUT | FA-MOB-16/17 drafts only; `testCommand` forbidden (SC-3, SC-9) |
| `POST /v1/missions/:id/runs` | `server.ts:260-272` | OUT | not planned |
| `POST /v1/projects` | `server.ts:195-205` | OUT | not planned |
| PROPOSED `POST /v1/mobile/approvals/challenge`, `/approvals/:itemId/decision` | D-MOB F5 | OUT | FA-MOB-4, FA-MOB-6, FA-MOB-7, FA-MOB-9; PT-035 |
| PROPOSED `POST /v1/mobile/control/stop` | D-MOB F9 | OUT | FA-MOB-6, FA-MOB-8 |
| PROPOSED push-token register/delete | D-MOB F6 | OUT | FA-MOB-15 (no FCM in release 1) |
| PROPOSED `POST/GET /v1/mobile/drafts`, `/drafts/:id/promote` | D-MOB F7 | OUT | FA-MOB-16, FA-MOB-17 |

### 5.2 Existing reads excluded from the phone in every phase (SC-3)

| Route | Evidence | Reason |
|---|---|---|
| `GET /v1/projects/:id/files`, `/file` | `server.ts:382`, `:387` | file content |
| `GET /v1/projects/:id/git/diff` | `server.ts:398` | git diff |
| `GET /v1/projects/:id/git/log` | `server.ts:392` | commit text and refs; not needed for monitoring (this document's choice) |
| `GET /v1/runs/:runId/events`, `/logs`, `/logs/:name` | `server.ts:129`, `:133`, `:137` | raw logs and raw event files |
| `GET /v1/projects/:id/exports`, `/exports/:exportId`; `POST .../export` | `server.ts:405`, `:415`, `:416` | exports |
| `POST /v1/projects/:id/import` | `server.ts:344` | project import |
| `GET /v1/system/executors`; `POST .../local-claude/enable` | `server.ts:426-427` | executor settings; reported write on GET (**UNVERIFIED**) |
| `GET /v1/projects/:id/devrun`; `POST .../devrun/*` | `server.ts:367`, `:369` | dev-runs |
| `POST /v1/system/workos/journal/repair-torn-tail` | `server.ts:661` | journal repair, desktop-only |
| `/v1/company/*` reads and writes | `server.ts:466-531` | finance/legal; writes excluded by SC-3, reads not in the FA-MOB-5 set |
| `GET /health` | `server.ts:104` | token-derived proof oracle (SC-2) |
| `GET /v1/factory`, `/phase0`, `/install`, `/scheduler`, `/capabilities`, `/fabrics`, `/adapters`, `/domains`, `/academy*`, `/retry` | `server.ts:105-121`, `:577-579` | not needed for release-1 monitoring; default deny |

## 6. Reuse table (route → existing endpoint → store/server function)

| PROPOSED route | Existing endpoint(s) | Function it projects | Renderer reads today |
|---|---|---|---|
| `summary` | `/v1/cockpit`, `/v1/control/status` | `cockpitStop` `server.ts:674`; `cockpitWorkos` `:675`; `cockpitWorkforce` `:710` (`countActiveWorkerRuns` `store.ts:744`); `cockpitEvidence` `:724`; `journalHealth` `store.ts:134` | `api.js:47`, `:50` |
| `projects` | `/v1/projects`, `/v1/missions`, `/v1/deliveries` | `listProjects` `store.ts:874`; `listMissions` `store.ts:876`; `listRuns` `store.ts:740` | `api.js:48-49`, `:85` |
| `workers` | `/v1/agents`, `/v1/roles`, `cockpit.workforce` | role registry summary `server.ts:111`; `countActiveWorkerRuns` `store.ts:744` | `api.js:89-90` |
| `runs` | `/v1/work-runs`, `/v1/work-runs/:id`, `/v1/runs` | `listRuns` `store.ts:740`; `deriveOutcomes`/`deliveryView` `server.ts:281` | `api.js:53`, `:62-64` |
| `missions/:id/timeline` | `/v1/missions/:id`, `/v1/predev/:id`, `/v1/crew/:id` | `getMission` `server.ts:219`; `preDevReadModel` `:590`; crew ledger `:595-600` | `api.js:59`, `:142-143` |
| `reports` | `/v1/reviews`, `/v1/evidence`, `cockpit.evidence` | `reviewRecord`/`runReviewSummary` `server.ts:643-645`; `EvidenceIndex` `:438` | `api.js:66-73`, `:155` |
| `ops` | `/v1/control/status`, `/v1/runs`, `/v1/founder-attention` | `globalStopState`, `workosHealth` `server.ts:119-120`; `schedulerView` `:122` | `api.js:50-53` |
| `changes` | none | `lastSeq` `store.ts:131` (new exposure) | — |
| `notifications` | none | derived from the rows above | — |

The desktop main-process allow-lists already admit every source GET used here (`control-boundary.mjs:9-11`; `main.mjs:36`, `:103-107`); the mobile allow-list is a **separate** protected list (FA-MOB-6) and does not extend them.

## 7. Mapping to security conditions

| SC | How this contract satisfies it |
|---|---|
| SC-1 | Section 3.1: device session only; control token rejected on the gateway |
| SC-2 | Section 3.1: TLS-only gateway; `/health` 404; rate limits section 3.6; audit of allowed and denied calls |
| SC-3 | Section 5.2: every excluded class listed with its route |
| SC-4, SC-5 | Section 5.1: no approval route; gated on PT-035 and FA-MOB-7 (dormant) |
| SC-6 | Section 5.1: no STOP or RESUME route; `summary.globalStop.scopeNotice` text; RESUME desktop-only |
| SC-7 | Section 3.3: STALE is a phone-side cache label; no write route exists, so nothing can be queued |
| SC-8 | Section 4.9: notifications carry kinds and refs, no content; no push in release 1 (dormant) |
| SC-9 | No draft or voice route (section 5.1, dormant) |
| SC-10 | Sections 3.4, 4.5: free text capped, marked untrusted, never parsed |
| SC-17 | Section 3.1: own Host/SNI policy (421 `MOBILE_HOST_REJECTED`); never forwards to loopback with the token |
| SC-18 | Section 3.1: principal `MOBILE_DEVICE:<deviceId>`; 429/401/403/404 audited with device id |
| SC-19 | Sections 3.4, 4.x: paginated, size-capped, no absolute paths, journal health in every envelope, no write-on-GET source (executors excluded) |
| SC-21 | Section 3.5: expired session → 401 `MOBILE_SESSION_EXPIRED` |
| SC-23, SC-24 | Base URL is the explicitly bound gateway address only; same contract over model B, no overlay identity accepted |
| SC-25 | Section 3.1: GET/HEAD only; section 5.1 table |
| SC-26 | Section 3.5: `DEVICE_REVOKED` on the next request |
| SC-11..SC-16, SC-20, SC-22 | Not API matters; owned by MOB-2, MOB-5, MOB-8, MOB-9 and the implementation packages |

Acceptance tests that an implementation (MOB-16, MOB-18) would need, derived from this contract (PROPOSED, no test is written here):

1. Allow-list table test: every allow-listed entry is a `GET` route from section 4; every other registered route returns 404 through the gateway (SC-3, SC-25).
2. Non-GET sweep: every method other than GET/HEAD on every path → 404/405.
3. Envelope schema test for each route, including `state` values from section 3.3 only.
4. No-absolute-path and no-secret scan over every response from a fixture journal.
5. Pagination test: `limit` 0, 101 and non-numeric → 400; cursor from another route → 400; full walk yields each item exactly once.
6. ETag test: unchanged journal and inputs → 304; a stop-file change alone changes the ETag.
7. TAMPERED fixture: Work OS routes 503 `DESKTOP_DEGRADED`; `ops` reports `TAMPERED`.
8. No-write sweep: hash the data directory before and after calling every route (SC-19).
9. Rate-limit test: bucket overflow → 429 with `Retry-After`, audited with device id.

## 8. Open questions for the Founder

- **Q-1** Is `awaitingApproval.count` in `summary` acceptable for release 1, given that the phone cannot act on it? (Recommended: yes, count only, with "decide on the desktop".)
- **Q-2** Should release 1 include `reports` at all while CI status is `UNKNOWN` and F8 has no screen id (D-MOB section 11 GAP)?
- **Q-3** Tenancy and scoping: which tenant does a device session map to, and is server-side per-project scoping (UI-180) needed in release 1, or is the single `local` tenant enough?
- **Q-4** Proposed numbers: page default 25 / max 100, 256 KiB response cap, 60/min per device, 15 s change polling. Accept or set others?
- **Q-5** Excluded route status: 404 everywhere (this contract) versus 403 (MOB-2 section 9). Confirm 404.
- **Q-6** Should `HEAD` be allowed, or `GET` only?
- **Q-7** Is exposing the journal sequence (`lastSeq`) to the phone acceptable, given it reveals activity volume?
- **Q-8** Notifications: recomputed per request (no new journal records) or durable ids recorded in the journal?
- **Q-9** Should the supervisor runs list (`/v1/runs`, file-based, `server.ts:124-128`) be shown at all, or only Work OS runs?
- **Q-10** Versioning: is `/v1/mobile/*` with `contract:"uasco.mobile.v1"` the right scheme, and how long must the gateway keep an old contract for an un-updated phone?
- Carried from the scope record and MOB-2: Project Memory location (D-MOB Q12); headless mode (Q2, FA-MOB-21); CI report source (Q11, FA-MOB-19); no-offline-queue confirmation (Q22).

## 9. UNVERIFIED items

- `packaged-entry.ts:79` loopback bind and `package.json:38-42` dependency list: cited from D-MOB, not re-read.
- `GET /v1/system/executors` writing `settings.json`: cited from D-MOB and FRONTEND_BACKEND_MATRIX line 142, not re-traced. Excluded regardless.
- `tasks[]` always empty (`store.ts:570`), run lease fields (`core/workos/types.ts:131-143`), run status enum (`types.ts:67-69`), `testCommand` in `schemas.ts:36-40`: cited from D-MOB / SC-3, not re-read.
- Orchestrator block `UNAVAILABLE` in the installed app.
- Cost of per-request projections: per-project rollups over `listRuns`, the non-journal ETag digest, per-mission timeline from the journal, evidence re-hash.
- Whether a mission event history can be built without a new store index.
- Whether the gateway can share the Fastify process without the global loopback `onRequest` hook (`server.ts:97`) rejecting its requests (MOB-2 section 12).
- All header names, codes, limits and shapes marked PROPOSED are design proposals with no implementation.

## 10. Grants this contract depends on (none exist)

FA-MOB-2 (connectivity), FA-MOB-3 (TLS gateway listener), FA-MOB-4 (device sessions and scopes), FA-MOB-5 (read projections), FA-MOB-6 (protected `server.ts` route registration, per-request principal, mobile allow-list, reseal), FA-MOB-9 (protect boundary files). Later and out of release 1: FA-MOB-7 (approvals, with PT-035), FA-MOB-8 (STOP), FA-MOB-15 (push), FA-MOB-16/17 (drafts), FA-MOB-19 (CI source). Implementation packages: MOB-16, MOB-18, MOB-21, MOB-22, MOB-26.

This document describes, but does not edit, the protected `server.ts`. It grants nothing and changes no code, listener, API or authentication.
