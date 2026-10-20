<!-- //TR: MOB-4 Android Mobile Companion onay, imzalı attestation ve STOP tasarımı (YALNIZ TASARIM, ETKİN DEĞİL, FD-2026-10-20-MOB-PHASE0): PT-035 düzelmeden mobil onay yok; mobil STOP ve imzalı onay ayrı ayrı değerlendirilir; RESUME masaüstünde kalır; ilk sürüm salt okunurdur. Bu belge hiçbir yetki, endpoint, kimlik doğrulama değişikliği veya kod vermez; gereken Founder izinlerini (FA-MOB-*) ve açık soruları listeler. -->

# MOB-4: Approval, attestation and STOP design (DESIGN ONLY / NOT ENABLED)

> **Status: DESIGN ONLY / NOT ENABLED.** This document is phase-0 documentation under FD-2026-10-20-MOB-PHASE0. It grants nothing, enables nothing, and adds no code, endpoint, auth change or dependency. Every route, field, key and flow below is **PROPOSED**. Release 1 of the Mobile Companion is read-only (SC-25). No mobile approval exists until PT-035 is fixed. Mobile STOP and signed approvals are evaluated separately. RESUME stays desktop-only.

Evidence convention: `file:line` refers to the tree at `origin/v7/integration` `57f3bff`. Anything not checked in code is marked **UNVERIFIED**. External platform facts (Android Keystore, StrongBox, BiometricPrompt) are **UNVERIFIED** here; MOB-9 owns their research and pinning (SC-16).

## 0. Founder decisions that bind this design

| Ref | Decision (FD-2026-10-20-MOB-PHASE0, `:17`, `:42-43`) | Effect here |
|---|---|---|
| FD-a | No mobile approvals until PT-035 is fixed. | Section 3 is a dormant design. Its first build step is the PT-035 fix (MOB-23), not a mobile feature. |
| FD-b | Mobile STOP and signed approvals are evaluated separately. | STOP (section 5) and approvals (section 3) have separate grants (FA-MOB-8 vs FA-MOB-7), separate scopes (`MOBILE_STOP` vs `MOBILE_APPROVE`) and can ship, or be refused, independently. |
| FD-c | RESUME stays desktop-only. | Section 6. No mobile scope, route or UI for RESUME is proposed. |
| FD-d | The first release is read-only. | Only `MOBILE_READ` is issued in release 1 (CONNECTIVITY-AND-PAIRING.md 5.4). Nothing here applies to release 1. |

## 1. Current state (verified in code)

| Fact | Evidence |
|---|---|
| The attestation type has `id`, `approverIdentityId`, `actionDigest`, `targetDigest`, `grantedAt`, `expiresAt`, optional `revokedAt`. No nonce, no signature, no device binding, no consumption record. | `core/authority/approval.ts:2-10` |
| Validation checks trusted approver, digest match, revocation and the `grantedAt`/`expiresAt` window. It does not cap the lifetime (any `expiresAt > grantedAt` passes) and does not prevent reuse within the window. | `core/authority/approval.ts:19-38` (window check `:33-37`) |
| Only `SPEND`, `PRODUCTION_CHANGE`, `DESTRUCTIVE`, `IRREVERSIBLE` and `LEGAL_FINANCIAL_AUTHORITY` require an approval. `MUTATION` does not. | `core/action-gateway/policy.ts:8-10`, `:30-34` |
| Every Work OS write is sent to the gateway as `actionClass:"MUTATION"`, `production:false`, `reversible:true`, so the approval branch is never reached from a route. | `apps/control-api/src/server.ts:166` |
| The policy context is hard-coded permissive: `scopeAllowed`, `dataPolicyAllowed`, `budgetAllowed`, `adapterCertified` all `true`, overridable only by `opts.policyContext`. | `apps/control-api/src/server.ts:165` |
| Tenant is `local` and actor is `FOUNDER_LOCAL` for every request. | `apps/control-api/src/server.ts:156` |
| Write path order: Global Stop (423), then gateway policy (403), then strict schema (400). | `apps/control-api/src/server.ts:187-190` |
| Mission transition body is `{to, reason}` only; `additionalProperties:false`. No expected state, digest or nonce. | `core/workos/schemas.ts:50-51`; route `apps/control-api/src/server.ts:221-226` |
| `POST /v1/control/stop` takes only an optional free-text `reason` (truncated to 1000), writes GLOBAL_STOP with actor `FOUNDER_CONTROL_TOWER`, audits, and stops all dev-runs. It bypasses `workosWrite` and needs only the control token. | `apps/control-api/src/server.ts:142-145` |
| `POST /v1/control/resume` clears GLOBAL_STOP and starts the supervisor detached, with no extra check. | `apps/control-api/src/server.ts:146` |
| `workosStopped()` fails closed: an unreadable/unsafe stop file counts as stopped. | `apps/control-api/src/server.ts:163` |
| The Work OS journal is hash-chained (`prevHash`, `seq`, `entryHash`) and detects tampering on read. | `core/workos/store.ts:190-205` |
| GLOBAL_STOP is local; the cloud routines do not read local state. | `docs/cloud-production/CLOUD_MIGRATION_MANIFEST.md:22` |

## 2. What PT-035 is and why approvals are blocked on it

**PT-035** (inventory `docs/inventory/2026-10-19/MASTER_WORK_INVENTORY.md:279`, status AUTHORITY_REQUIRED, P1): *"action gateway wired with permissive defaults (server.ts:156-167 tenant local; scope/data/budget/adapter = true; finance/legal writes skip approval class)"*.

Concretely, `workosPolicy` (`apps/control-api/src/server.ts:164-167`):

1. builds an `ActionPolicyContext` with every policy bit `true` (`:165`);
2. classifies every write as reversible, non-production `MUTATION` (`:166`);
3. so `authorizeAction` never enters the approval branch (`core/action-gateway/policy.ts:30`), and `assertApprovalValid` is never called from a route.

Why mobile approvals must wait for the fix:

- **A signature would guard nothing.** A device-signed approval only matters if the server *requires* it for the action. Today no route requires any approval. A mobile "approve" would be a cosmetic layer over a write any token holder can already make.
- **Class mis-labelling.** Finance/legal or irreversible work reaches the store as `MUTATION`, so a phone could not be restricted to "low-risk classes only" (SC-5): the server cannot tell the classes apart.
- **No per-principal context.** Scope and actor are constant (`:156`), so a device principal (`MOBILE_DEVICE:<deviceId>`, SC-18) could not be given a narrower policy than the desktop.
- **No trusted approver set in routes.** `trustedApproverIdentityIds` is never supplied from a route; where the Founder identity would come from is **UNVERIFIED** (D-MOB FA-MOB-7 lists it as a grant item).

The PT-035 fix (MOB-23, protected `server.ts`, needs FA-MOB-6/FA-MOB-7/FA-MOB-9) must at minimum: derive the policy context from real scope/data/budget/adapter facts; classify each route's action correctly; supply the trusted approver set; and keep all existing desktop approval tests green. **How** that is done is out of scope here; this document only treats it as a hard precondition (gate G0 in section 8).

## 3. Threat model for remote approvals

Extends `docs/mobile/THREAT-MODEL.md` (sections 3, 4.3, 4.4, 4.8). IDs are local to this document.

| ID | Threat | Today | Design response (section 4) |
|---|---|---|---|
| AT-R1 | **Replay**: a captured or logged decision is resent, for the same item or a later identical-looking one. | Attestation has no nonce and is reusable until `expiresAt` (`approval.ts:33-37`). | Server-issued single-use challenge nonce; consumption journaled before effect; a second use is refused. |
| AT-R2 | **Stale approval**: the item changes between display and decision (new head SHA, new status, new evidence). | Transition body has no expected state (`schemas.ts:50-51`). | Challenge binds `expectedStatus`, `itemDigest` and `headSha`; mismatch returns 409 and nothing is applied. |
| AT-R3 | **Lifetime abuse**: an attestation minted with a very long window. | No cap (`approval.ts:35`). | Server-set `expiresAt` with a hard maximum (proposed ≤ 120 s, open question Q-3); the client cannot choose it. |
| AT-C1 | **Coercion**: the Founder is forced to approve on the phone. | n/a | Class matrix keeps high-risk classes desktop-only (section 4.6); optional cooling-off/second-channel confirm for any class above the lowest (Q-6); every decision is visible on the desktop and revocable before effect where the action allows it (Q-7). No "duress" signal is promised (Q-8). |
| AT-C2 | **Misleading prompt**: the phone shows a summary that differs from the real action (UI or injected text). | Inbox is computed in the client (D-MOB F5). | The signed payload is the server's canonical `actionDigest`; the phone renders only server fields; free text is shown with provenance and never parsed as authority (SC-10). |
| AT-S1 | **Stolen unlocked device**. | n/a | Per-approval biometric (class-strong) user authentication bound to the key use; no "approve for N minutes" window (Q-4); desktop revocation (SC-26). |
| AT-S2 | **Stolen device, key extraction**. | n/a | Non-exportable hardware-backed key (StrongBox if present, else TEE); key invalidated on biometric enrolment change. Hardware guarantees are **UNVERIFIED** (MOB-9). Attestation of the key at pairing (section 4.1) to reject software keys. |
| AT-S3 | **Stolen session token**. | n/a | Session alone cannot approve: the decision needs a fresh per-challenge signature from the device key (CONNECTIVITY-AND-PAIRING.md 5.4). |
| AT-F1 | **Same-account forgery**: anything holding the desktop control token, or running as the same OS user, forges an approval or writes the device registry. | Every `/v1/*` caller with the token is `FOUNDER_LOCAL` (`server.ts:101`, `:156`). | Device signatures verify against a public key recorded at desktop pairing (physical presence); a forged decision without the private key fails. **Residual:** a same-user process can still act directly through desktop routes or edit runtime/registry files; mobile signing does not and cannot raise the desktop's own trust level (see section 7, residual R-1). |
| AT-F2 | **Cross-item or cross-tenant reuse**: a valid signature for item A applied to item B. | Digest match exists (`approval.ts:31-32`) but is unreachable (PT-035). | Signature covers `itemId`, `actionDigest`, `targetDigest`, `tenantId`, `deviceId` and nonce; verification rebuilds the canonical payload server-side. |
| AT-F3 | **Voice/notification approve**. | n/a | Never possible: no voice or notification action can create a decision (SC-9, SC-10, SC-8). |
| AT-D1 | **Clock skew / offline queue**. | n/a | Server time only; no offline queue (SC-7). Expired challenge = re-request. |

## 4. Proposed signed-approval design (DESIGN ONLY / NOT ENABLED)

### 4.1 Device approval key

| Property | Proposal | Status |
|---|---|---|
| Key | Separate from the request-signing/session key of MOB-2; purpose `APPROVE` only. EC P-256 signing key generated on the phone. | PROPOSED |
| Storage | Android Keystore, non-exportable; StrongBox-backed when the device has it, else TEE; software-only keys are refused. | PROPOSED; platform behaviour **UNVERIFIED** (MOB-9) |
| User auth | Required for every use: class-strong biometric via BiometricPrompt with a `CryptoObject` (ADR-MOB-001 section 5 custom TurboModule); auth validity of one operation; invalidated on new biometric enrolment. | PROPOSED; API semantics **UNVERIFIED** |
| Registration | Created only after a separate desktop step-up that grants `MOBILE_APPROVE` to an already paired device (FA-MOB-4, FA-MOB-7). The phone sends the public key plus its Keystore attestation chain; the desktop shows a fingerprint the Founder confirms. | PROPOSED; how the attestation chain is checked without a Google service call is **UNVERIFIED** (Q-9) |
| Record | Public key, key attestation summary, `deviceId`, registered-at and revoked-at live in the single existing store as journal entries (section 4.5); no second store. | PROPOSED |
| Revocation | Desktop "revoke approve" or "revoke device" (SC-26) invalidates the key at once; checked on every decision. | PROPOSED |

### 4.2 Server-issued challenge

The phone never constructs what it signs. It asks the server for a challenge on one inbox item:

`POST /v1/mobile/approvals/challenge` (PROPOSED; MOB-3 owns the schema) → server returns:

```json
{
  "challengeId": "apc_<random>",
  "nonce": "<≥128-bit random, base64url>",
  "itemId": "<inbox item id>",
  "decisionClass": "<one granted class from 4.6>",
  "actionDigest": "<sha256 of the server's canonical action>",
  "targetDigest": "<sha256 of the target>",
  "expectedStatus": "<status the item must still have>",
  "itemDigest": "<sha256 of the item as displayed>",
  "headSha": "<git SHA the decision applies to, when the item has one>",
  "tenantId": "local",
  "deviceId": "<requesting device>",
  "issuedAt": "<server time>",
  "expiresAt": "<server time + max lifetime>",
  "display": { "title": "...", "summary": "...", "provenance": "..." }
}
```

- The challenge is stored server-side as `APPROVAL_CHALLENGE_ISSUED` (section 4.5) before it is returned.
- One open challenge per item per device; a new one supersedes the old.
- `display` is rendering aid only. It is **not** signed and **not** authority (SC-10).

### 4.3 Device signature

The phone signs the canonical JSON (sorted keys, UTF-8, no whitespace; exact canonicalisation is an open design point, Q-2) of:

`{challengeId, nonce, itemId, decisionClass, decision, actionDigest, targetDigest, expectedStatus, itemDigest, headSha, tenantId, deviceId, issuedAt, expiresAt}`

where `decision` is exactly `APPROVE` or `REJECT`. A REJECT is signed too, so a forged rejection cannot block work silently. A free-text `reason` may be sent beside the signature; it is stored with provenance and never changes the decision.

`POST /v1/mobile/approvals/:itemId/decision` (PROPOSED) carries `{challengeId, decision, signature, reason?}`. It never carries `to`, so the current unsigned transition body (`core/workos/schemas.ts:50-51`) is never used for a mobile decision.

### 4.4 Desktop-side verification (in the existing Control API process)

In this order, fail-closed, each failure a fixed error code and an audit entry:

1. Global Stop check (423), as for every write today (`server.ts:188`). **A STOP blocks approvals.**
2. Session valid, scope is `MOBILE_APPROVE`, device not revoked, approve key not revoked (SC-18, SC-26).
3. Challenge exists, belongs to this device and item, is not consumed, is not superseded, and server time `< expiresAt` with `expiresAt - issuedAt ≤ MAX` (AT-R1, AT-R3).
4. `decisionClass` is in the Founder-granted mobile set (section 4.6); otherwise 403 `CLASS_DESKTOP_ONLY`.
5. Rebuild the canonical payload from the **stored** challenge (not from the request) and verify the signature against the registered public key.
6. Re-read the live item: `status === expectedStatus`, recomputed `itemDigest`, `headSha` unchanged; else 409 and the challenge is consumed as `STALE` (AT-R2).
7. Atomically journal `APPROVAL_CONSUMED` (single-use) **before** any effect.
8. Build an `ApprovalAttestation` (extended per FA-MOB-7 with `nonce`, `deviceId`, `signature`, `challengeId`) and pass it through the PT-035-fixed `authorizeAction` with the correctly classified action. The existing transition/delivery logic then runs unchanged; its own evidence gates (for example the COMPLETE evidence gate, `server.ts:225-226`) still apply.
9. Journal the outcome (`APPLIED` or `DENIED:<code>`).

The phone never sees the control token (SC-1); the gateway never maps a device to `FOUNDER_LOCAL` (SC-17, SC-18).

### 4.5 Audit trail in the single existing Project Memory

- **No second store** (D-MOB `:35`, SC-7). All approval events go to the existing hash-chained Work OS journal (`core/workos/store.ts:190-205`) with actor `MOBILE_DEVICE:<deviceId>`. That this journal *is* the "canonical Project Memory" named in D-MOB `:26` is **UNVERIFIED**; the Founder confirms the target store in Q-1.
- Proposed entry kinds: `APPROVAL_KEY_REGISTERED`, `APPROVAL_KEY_REVOKED`, `APPROVAL_CHALLENGE_ISSUED`, `APPROVAL_CONSUMED`, `APPROVAL_DECISION_APPLIED`, `APPROVAL_DECISION_DENIED`, `MOBILE_STOP_ACTIVATED`.
- Entries store digests, ids, the signature and the server-side verification result. They never store session secrets, private keys or raw biometric data.
- The control audit file (`control-api-events.jsonl`, `server.ts:78`) also receives a secret-free line, as existing writes do.
- Replay defence relies on the journal: "consumed" is decided by a journal entry, so a restart cannot reopen a nonce.

### 4.6 Decision-class matrix (for the Founder to fill)

Default for every row is **DESKTOP-ONLY**. Mobile is possible only for a row the Founder marks in FA-MOB-7.

| Class (from BACKLOG MOB-4 scope) | Proposed default | Notes |
|---|---|---|
| FOUNDER_ATTENTION_REQUIRED: retry technical blocker | candidate for mobile | Lowest risk; existing guard `canRetryBlockedKind` (`server.ts:151`) still applies. |
| FOUNDER_ATTENTION_REQUIRED: reject | candidate for mobile | Signed REJECT. |
| PREFLIGHT → AUTHORIZED | DESKTOP-ONLY | Starts work; Founder decides (Q-5). |
| Delivery accept | DESKTOP-ONLY | SC-5. |
| Retry of a non-technical blocker | DESKTOP-ONLY | Already refused by the server (`server.ts:151`). |
| R3 / R4 decisions | DESKTOP-ONLY | SC-5. |
| COMPLETE | DESKTOP-ONLY | SC-5; evidence gate stays server-side. |
| Finance / legal (`LEGAL_FINANCIAL_AUTHORITY`, `SPEND`) | DESKTOP-ONLY | SC-5. |
| `PRODUCTION_CHANGE`, `DESTRUCTIVE`, `IRREVERSIBLE` | DESKTOP-ONLY | Not proposed for mobile at all. |

## 5. Mobile STOP (separately evaluated; DESIGN ONLY / NOT ENABLED)

### 5.1 Desktop STOP vs proposed mobile STOP

| Aspect | Desktop STOP today | Proposed mobile STOP |
|---|---|---|
| Route | `POST /v1/control/stop` (`server.ts:142`) | `POST /v1/mobile/control/stop` (PROPOSED), a thin wrapper that calls the same `activateGlobalStop` logic; no new stop mechanism |
| Authority | control token only; bypasses `workosWrite` (D-MOB `:104`) | session with `MOBILE_STOP` scope (FA-MOB-8) + fresh device signature + step-up |
| Step-up | none | class-strong biometric per action (no device-credential fallback, Q-4); confirm screen showing the blast radius |
| Reason | optional, defaults to "Founder requested stop" (`:142`) | **required**, length-limited, stored with provenance, never parsed (SC-6, SC-10) |
| Actor | `FOUNDER_CONTROL_TOWER` (`:142`) | `MOBILE_DEVICE:<deviceId>` in the journal and control audit |
| Effect | GLOBAL_STOP file + all dev-runs stopped (`:143-144`) | identical effect; nothing broader, nothing narrower in v1 (per-scope stop is a later question, Q-10) |
| Scope of halt | local Work OS and dev-runs; not Cloud production (`CLOUD_MIGRATION_MANIFEST.md:22`) | same; the UI must say so in plain words (SC-6) |
| Replay | not applicable (token only) | single-use server nonce, short expiry; replaying a STOP is idempotent anyway (already stopped) and is audited |
| Offline | n/a | never queued (SC-7); if the desktop is unreachable the phone says "STOP NOT SENT" |

### 5.2 Why STOP is fail-safe, and where it is not

- STOP only removes capability: while active, every Work OS write returns 423 (`server.ts:188`), and an unreadable stop file also counts as stopped (`:163`). A wrongly sent STOP costs time, not integrity.
- It is still a **denial-of-service lever**: a stolen device with `MOBILE_STOP` can halt the factory repeatedly. Mitigations: per-action biometric, rate limit, desktop revocation, and RESUME being desktop-only (so an attacker cannot toggle STOP/RESUME to mask activity).
- A mobile STOP **does not** stop Cloud production or cloud routines. Claiming otherwise in the UI would be a false safety signal.
- Failure of the mobile path must never be read as "stopped": the phone shows STOP as active only after the server confirms the GLOBAL_STOP state (`/v1/control/status`, `server.ts:120`).

### 5.3 Why STOP and approvals are evaluated separately (FD-b)

STOP is monotone (it only reduces what can happen) and needs no PT-035 fix to be meaningful, because its effect does not depend on the action gateway. Approvals increase what can happen and are meaningless until PT-035 is fixed. Separate scopes, separate grants and separate packages (MOB-25 vs MOB-23/MOB-24) let the Founder accept one and refuse the other.

## 6. Why RESUME is excluded

- **Founder decision FD-c.** RESUME stays desktop-only.
- **It increases capability.** `POST /v1/control/resume` clears GLOBAL_STOP and starts the supervisor detached with no further check (`server.ts:146`). It is the most powerful single control action and must require physical presence.
- **It undoes the safety lever.** If a stolen or coerced phone could resume, mobile STOP would no longer be a reliable kill switch; the Founder could not trust a STOP sent from the phone after a theft.
- **Context is on the desktop.** Deciding to resume needs the journal health, torn-tail state and blocker view (`server.ts:120`), which the phone shows only as a projection and possibly STALE (SC-7).
- **Consequence for the design:** no `MOBILE_RESUME` scope, no resume route under `/v1/mobile/*`, and the mobile allow-list must exclude `/v1/control/resume` explicitly (SC-3). The phone UI shows "Resume on the desktop" as text only.

## 7. Residual risks

| ID | Risk | Status |
|---|---|---|
| R-1 | Same-OS-user process holding the control token can still do anything the desktop can (AT-F1). Mobile signing does not fix desktop trust. | Accepted/transferred to the desktop trust model; out of MOB-4 scope. |
| R-2 | Hardware key guarantees vary by device; StrongBox may be absent. | Open; MOB-9 research, Q-9. |
| R-3 | Coercion cannot be fully prevented by technology. | Accepted; mitigated by the class matrix. |
| R-4 | Mobile STOP as a nuisance/DoS lever. | Mitigated (5.2); Founder accepts or refuses via FA-MOB-8. |
| R-5 | Canonical JSON mismatch between phone and server causes false rejections. | Open; Q-2, contract tests in MOB-23/MOB-24. |

## 8. Mapping to the SC-* conditions

| SC | How this design satisfies it | Gate |
|---|---|---|
| SC-1 | Phone holds only device session + device keys, never the control token (4.4). | P3 |
| SC-2 | No route here exists until the gateway preconditions exist (MOB-2). | P3 |
| SC-3 | Allow-list excludes `/v1/control/resume`, the raw transition route and all DESKTOP-ONLY classes (4.6, 6). | P3 |
| SC-4 | Server challenge, `expectedStatus` + `itemDigest`, single-use nonce, server-enforced max lifetime, non-exportable biometric-bound key, journaled consumption with device actor (4.2-4.5). | P5 |
| SC-5 | **G0:** PT-035 fixed first (section 2); high-risk classes desktop-only (4.6). | before P5 |
| SC-6 | STOP with step-up and required reason; UI states local-only scope; RESUME desktop-only (5, 6). | P3 / P5 |
| SC-7 | No second store; no offline queue for approvals or STOP (4.5, 5.1). | P4 |
| SC-8 | A notification may point to an inbox item but carries no content and offers no approve action (AT-F3). | P6 |
| SC-9 | No voice approve or STOP. | P6 |
| SC-10 | `display` and `reason` are never authority; shown with provenance (4.2, 4.3). | P4 |
| SC-14 | `approval.ts`, `policy.ts` and the new gateway/auth modules become protected before change (FA-MOB-9). | P1 |
| SC-17 | Device never mapped to `FOUNDER_LOCAL`. | P3 |
| SC-18 | Actor `MOBILE_DEVICE:<deviceId>` on every approval/STOP entry. | P3 |
| SC-21 | Approve key separate from session key; Keystore-only storage. | P3 / P4 |
| SC-25 | Release 1 issues only `MOBILE_READ`; nothing in this document is reachable in release 1. | P3 / P4 |
| SC-26 | Desktop revocation of device and approve key, checked on every decision. | P3 |

SC-11, SC-12, SC-13, SC-15, SC-16, SC-19, SC-20, SC-22, SC-23, SC-24 are not changed by this design; they still apply to any build.

## 9. Founder grants needed before any of this could be built

None of these is granted by this document or by FD-2026-10-20-MOB-PHASE0. IDs are from D-2026-10-20-MOBILE-ANDROID `:235-257`.

| Grant | Needed for | Required for approvals | Required for mobile STOP |
|---|---|---|---|
| FA-MOB-1 | Founder confirmation + `apps/mobile/**` build scope | yes | yes |
| FA-MOB-2 | Connectivity model (A/B) | yes | yes |
| FA-MOB-3 | TLS gateway listener | yes | yes |
| FA-MOB-4 | Pairing, device registry, scopes incl. `MOBILE_STOP`/`MOBILE_APPROVE`, revocation | yes | yes |
| FA-MOB-6 | Protected `server.ts` route registration, per-request principal, allow-list, reseal | yes | yes |
| FA-MOB-7 | **Signed single-use approvals**: extend `approval.ts`; fix PT-035; server inbox with `expectedStatus`/`itemDigest`; the mobile decision-class set (4.6); Founder identity in `trustedApproverIdentityIds` | yes | no |
| FA-MOB-8 | **Remote STOP** from the phone; confirmation that RESUME stays desktop-only | no | yes |
| FA-MOB-9 | Protect `approval.ts`, `policy.ts`, `packaged-entry.ts` and new modules; reseal | yes | yes |
| FA-MOB-12 | Supply-chain admission for any native module used for Keystore/biometric signing | yes | yes |
| FA-MOB-23 | Desktop UI for approve-key registration, fingerprint confirmation and revocation | yes | yes (revocation) |

Order: FA-MOB-1 → FA-MOB-9 (protect) → PT-035 fix under FA-MOB-7/FA-MOB-6 (G0) → approval centre (MOB-23) → client (MOB-24). Mobile STOP (MOB-25) needs FA-MOB-8 and the transport grants but not G0.

## 10. Open questions for the Founder

1. **Q-1** Is the Work OS journal (`core/workos/store.ts`) the "canonical Project Memory" for approval and STOP audit, or is another existing store meant? (UNVERIFIED)
2. **Q-2** Which canonical-JSON rule (for example RFC 8785) should phone and server share?
3. **Q-3** Maximum challenge lifetime: 60 s, 120 s, or other?
4. **Q-4** Biometric only, or also device PIN as fallback, for approve and for STOP?
5. **Q-5** Which rows of the class matrix (4.6), if any, may ever be decided from the phone?
6. **Q-6** For any mobile-allowed class, is a second confirmation on the desktop or a cooling-off delay wanted?
7. **Q-7** Should a mobile APPROVE be cancellable from the desktop for a short window before it takes effect?
8. **Q-8** Is a duress signal wanted at all? (Not proposed; it adds complexity and false assurance.)
9. **Q-9** Is a StrongBox-only policy acceptable (fewer devices), or is TEE-backed acceptable? How is the key attestation chain verified offline? (UNVERIFIED)
10. **Q-10** Is a per-project or per-run stop ever wanted from the phone, or only the global STOP?
11. **Q-11** Should mobile STOP be allowed in a release before any mobile approval exists (FD-b allows separating them)?

## 11. UNVERIFIED items

- That the Work OS journal is the canonical Project Memory (Q-1).
- Android Keystore / StrongBox / BiometricPrompt behaviour, key attestation format and offline verification (MOB-9, Q-9).
- Where the Founder's approver identity for `trustedApproverIdentityIds` comes from after the PT-035 fix.
- The exact route schemas named here; MOB-3 owns them and they are PROPOSED.
