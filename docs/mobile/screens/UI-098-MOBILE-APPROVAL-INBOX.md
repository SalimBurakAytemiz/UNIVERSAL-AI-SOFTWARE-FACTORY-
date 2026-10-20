<!-- //TR: MOB-7 ekran spesifikasyonu UI-098 Mobil Onay Gelen Kutusu (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): ilk sürümde yoktur; PT-035 düzeltilmeden ve APPROVAL-AND-STOP.md içindeki FA-MOB izinleri verilmeden açılmaz; onay yalnız MOB-4 imzalı challenge tasarımıyla olur; serbest metin veya sesle onay yolu yoktur. Bu belge hiçbir yetki, endpoint veya kod vermez. -->

# UI-098 Mobile approval inbox (DESIGN ONLY / NOT ENABLED)

> **DESIGN ONLY / NOT ENABLED.** Phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing and adds no code, route, auth change or dependency. **Not in release 1.** Blocked on PT-035 and the grants in `docs/mobile/APPROVAL-AND-STOP.md` section 9.

Evidence: `file:line` on `origin/v7/integration` `7ee55d9`. **PROPOSED** = route or flow that does not exist. **UNVERIFIED** = not checked in code.

## 1. Purpose and target function

- Lists items that wait for a Founder decision, so the Founder can open one in UI-175.
- Target function F5 (D-MOB section 5, `D-2026-10-20-MOBILE-ANDROID.md:144`); inventory row `SCREEN_AUDIT_252.csv:99` (AUTHORITY_REQUIRED, no code).
- The list itself never decides anything. Every decision goes through UI-175 and the signed challenge of MOB-4.

## 2. Release and gating

| Item | Value |
|---|---|
| Release | **Not release 1.** Release 1 shows only the count `awaitingApproval.count` on the dashboard (MOB-3 section 4.1, 4.10). |
| Hard precondition | PT-035 fixed (`apps/control-api/src/server.ts:164-167`; `MASTER_WORK_INVENTORY.md:279`), gate G0 in MOB-4 section 8 |
| Build packages | MOB-23 (server inbox, PT-035 fix), MOB-24 (client) (D-MOB section 11) |

## 3. Authority dependency

FA-MOB-1, FA-MOB-2, FA-MOB-3, FA-MOB-4 (scope `MOBILE_APPROVE`), FA-MOB-5 (read projection), FA-MOB-6, FA-MOB-7 (signed approvals, PT-035 fix, server inbox with `expectedStatus`/`itemDigest`, mobile decision-class set), FA-MOB-9, FA-MOB-12. Approve-key registration on the desktop is "FA-MOB-23 extended" (PROPOSED, not in D-MOB; MOB-4 section 9). None is granted.

## 4. Data source

| Source | Status | Evidence |
|---|---|---|
| `GET /v1/mobile/inbox` | PROPOSED, **not** in the release-1 set; must be a server-side projection, never re-derived on the phone | MOB-3 section 4.10; ADR-MOB-001 section 6 |
| Today's inbox | exists only in the desktop renderer (`deriveInbox`) from `GET /v1/missions` and `GET /v1/work-runs` | `apps/desktop/renderer/work-core.js:302-320`; `server.ts:207`, `:274` |
| Today's count | `awaitingApproval` in `GET /v1/cockpit` (missions in `PREFLIGHT` or `FOUNDER_ATTENTION_REQUIRED`) | `server.ts:683`, `:728-731` |

The phone must not call `/v1/missions` or `/v1/work-runs` to rebuild the list; the desktop derivation emits action descriptors (`work-core.js:309-315`) the phone must not hold.

## 5. Fields (per item)

| Field | Source | Notes |
|---|---|---|
| `itemId`, `kind` (`DELIVERY_DECISION`, `FOUNDER_ATTENTION`) | PROPOSED inbox; kinds from `work-core.js:311`, `:315` | fixed enum |
| `title` | `missions[].title` (`server.ts:683`) | untrusted text with provenance label (SC-10), max 200 chars (MOB-3 3.4) |
| `riskLevel` | `missions[].riskLevel` (`server.ts:683`) | missing → `—`, never guessed |
| `decisionClass` | PROPOSED (MOB-4 4.6) | rows marked DESKTOP-ONLY show "Decide on the desktop" and no control |
| `expectedStatus`, `itemDigest` | PROPOSED (FA-MOB-7) | not shown; carried to UI-175 |
| `age` | PROPOSED | from server time only |

## 6. Actions

- **Open detail** (navigate to UI-175). Read-only.
- **Refresh** (foreground pull, MOB-3 3.6).
- **No approve, reject, swipe-to-approve, bulk approve or notification approve.** No free-text or voice entry exists on this screen (SC-9, SC-10).

## 7. Step-up authentication points

- App unlock (UI-174) before the list is shown.
- No step-up here: the list makes no decision. Step-up happens per decision in UI-175.

## 8. Security conditions

SC-1, SC-3 (raw transition route never on the allow-list), SC-4, SC-5, SC-7 (no offline queue), SC-8 (a notification may point here but carries no content), SC-9, SC-10, SC-17, SC-18, SC-19, SC-20 (`FLAG_SECURE`), SC-25 (absent in release 1), SC-26.

## 9. States

| State | Trigger | Rendered |
|---|---|---|
| Loading | first fetch | skeleton rows, no counts |
| Empty | 200 with zero items | "Nothing waits for you" |
| Error | 500 `INTERNAL_ERROR`, 503 `DESKTOP_DEGRADED` | `—` plus fixed error code; no stale decisions offered |
| OFFLINE | network failure (phone-local, MOB-3 3.3) | cached list greyed, every Open-detail disabled |
| STALE | cached copy, desktop unreachable | STALE badge with age; items read-only; no detail opens |
| UNAVAILABLE | route absent (release 1, or grant missing) | "Approvals are not available on mobile" — this is the **release-1 state** |
| Denied | 403 `MOBILE_SCOPE_INSUFFICIENT`, 404 (route not on allow-list), 401 `DEVICE_REVOKED` | fixed text; revoked → wipe and re-pair (MOB-2 section 9) |
| GLOBAL_STOP | stop active (`server.ts:188`) | banner "Approvals blocked while STOP is active" (MOB-4 4.4 step 1) |

Missing values show `—` or an honest pill, never a number (`apps/desktop/renderer/model.js:1-3`).

## 10. UNVERIFIED and open

- Inbox item shape and paging are PROPOSED; MOB-3 owns the schema when FA-MOB-7 exists.
- Which decision classes ever appear as mobile-decidable: MOB-4 Q-5.
