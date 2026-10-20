<!-- //TR: MOB-1 Android Mobile Companion kodlama öncesi güvenlik koşulları (yalnız doküman, FD-2026-10-20-MOB-PHASE0): SC-1..SC-16 korunur ve test edilebilir kabul kanıtına çevrilir, SC-17..SC-26 tehdit modelinden eklenir; her koşul için kanıt ve sağlaması gereken faz verilir. Hiçbir koşul bu dokümanla bağlayıcı olmaz ve hiçbir yetki verilmez. -->

# MOB-1 Mobile Companion pre-coding security conditions (docs only)

- **Task:** MOB-1. Companion file: [`THREAT-MODEL.md`](THREAT-MODEL.md) (threat ids AT-*, TB-*, RR-* refer to it).
- **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md` (docs only, `docs/mobile/**` only). Source of SC-1..SC-16: `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md:211-248` (cited as **D-MOB**).
- **Status: PROPOSED.** These conditions become binding only when the Founder accepts them as part of FA-MOB-1 (D-MOB `:213`). This document grants nothing: no code, dependency, API, listener, auth change, protected edit, external service or paid resource.
- **Evidence convention:** a condition is anchored either to an existing code fact (`path:line`, re-read for this document = **VERIFIED**) or marked **PROPOSED** (the mechanism does not exist) or **UNVERIFIED** (not confirmed in code; the file:line checked is given). No technology version is claimed; MOB-9 owns versions.

## 0. Founder decisions applied (FD-2026-10-20-MOB-PHASE0)

- **Connectivity:** model A first (same-LAN QR pairing + TLS); remote target model B (user-managed VPN/overlay). No open tunnel, no second backend.
- **Release 1 is read-only monitoring.** No mobile approvals before PT-035 is fixed. Mobile STOP and signed approvals are evaluated separately. RESUME stays desktop-only.
- **No FCM, no paid LLM, no new external account in release 1.** Push, voice and assistant stay in the architecture and need their own grant.

Consequently SC-4, SC-6, SC-8 and SC-9 are **dormant** for release 1: they must be satisfied only before the corresponding surface is ever enabled, and their release-1 evidence is *absence* of the surface (SC-25).

## 1. Phases

Phase numbers follow D-MOB section 10 (`D-2026-10-20-MOBILE-ANDROID.md:319-333`).

| Phase | Content | Packages |
|---|---|---|
| P0 | Docs/spec (this phase) | MOB-1..MOB-9 |
| P1 | Repo guards | MOB-11, MOB-12, MOB-15 |
| P2 | Scaffold and CI | MOB-13, MOB-14 |
| P3 | Server read models and identity | MOB-16, MOB-17, MOB-18, MOB-19 |
| P4 | App read surfaces (**release 1 ends here**) | MOB-20, MOB-21, MOB-22, MOB-26 |
| P5 | Write paths (approvals, STOP) | MOB-23, MOB-24, MOB-25 |
| P6 | External services (push, voice, assistant) | MOB-27, MOB-28, MOB-29 |
| P7 | Release and lab | MOB-30, MOB-31 |

"Must hold by" means: no package of that phase (or later) may merge while the condition's acceptance evidence is missing.

## 2. Conditions

Each condition: **statement** · **anchor** (code fact or PROPOSED) · **acceptance evidence** (testable) · **must hold by** · **threats** · **grant**.

### SC-1 The phone never holds the desktop control token

- **Statement:** mobile uses only a per-device credential issued at pairing. Pairing starts on the desktop (physical presence), uses a single-use secret, and the phone never receives, derives or stores `x-uasco-control-token`. No dev path (`adb reverse`, dev token) places the token on a device unless Q25 is answered yes by the Founder.
- **Anchor:** token generated per launch (`apps/desktop/main.mjs:14`), delivered over stdin only (`main.mjs:295`), single credential (`apps/control-api/src/server.ts:77`) mapped to `FOUNDER_LOCAL` (`server.ts:156`). All VERIFIED. Pairing/device credential: PROPOSED.
- **Acceptance evidence:**
  1. Server test: a request on the mobile listener carrying a valid `x-uasco-control-token` and no device credential is rejected (401/403) and audited as denied.
  2. Static check in mobile CI: no source, resource or build config under `apps/mobile/**` references `x-uasco-control-token` or `UASCO_CONTROL_TOKEN`.
  3. Pairing test: the pairing endpoint is accepted only after a desktop-side "start pairing" action; a second use of the same secret fails; an expired secret fails.
- **Must hold by:** P3 (MOB-17); static check from P2 (MOB-13/14).
- **Threats:** TB-0 S/E, TB-3 S, TB-5 S, AT-2/AT-3/AT-8, RR-12.
- **Grant:** FA-MOB-4.

### SC-2 No listener beyond 127.0.0.1 until the gateway preconditions exist

- **Statement:** no non-loopback listener exists until all of: TLS with a pinned certificate; per-device authentication; a mobile route allow-list in a protected location; rate limits on pairing and authentication; audit of allowed and denied calls with device id. `/health` is not exposed on the mobile listener.
- **Anchor:** loopback binds `server.ts:738`, `apps/control-api/src/packaged-entry.ts:79`; Host-exact 421 `server.ts:98`, `automation/lib/control-boundary.mjs:29`; plain HTTP `server.ts:66`; no TLS/CORS/rate-limit dependency `package.json:38-42`; `/health` proof oracle `server.ts:104`, `control-boundary.mjs:22-25`. All VERIFIED.
- **Acceptance evidence:**
  1. Test: with the mobile gateway disabled (default), the process opens no socket on any address other than `127.0.0.1` (enumerate listening sockets in a selftest).
  2. Test: the gateway refuses to start if any of {certificate, device registry, allow-list, rate-limiter, audit sink} is missing (fail closed, explicit error code).
  3. TLS test: a client without the pinned fingerprint fails the handshake; plaintext HTTP on the gateway port is refused.
  4. Test: `GET /health` on the gateway returns 404; on loopback it is unchanged.
  5. Test: N+1 failed pairing/auth attempts within the window return 429 and are audited.
- **Must hold by:** P3 (MOB-18), before any non-loopback bind is merged.
- **Threats:** TB-0 T/I/D, TB-2 S/T/I/D, AT-1, AT-4, AT-5.
- **Grant:** FA-MOB-3, FA-MOB-6, FA-MOB-21 (firewall).

### SC-3 The mobile allow-list excludes high-risk data and actions

- **Statement:** the allow-list excludes file content, git diff, raw logs and exports; project import, executor enable/settings, dev-runs and journal repair; company finance and legal writes; mission creation with `testCommand`.
- **Anchor:** `testCommand` accepted by `missionCreateSchema` (`core/workos/schemas.ts:36-40`, VERIFIED). `GET /v1/system/executors` writes `settings.json` (D-MOB `:202`, FRONTEND_BACKEND_MATRIX line 142; UNVERIFIED here, route not re-read). Allow-list: PROPOSED (protected location under `automation/lib/`, FA-MOB-6).
- **Acceptance evidence:**
  1. Allow-list selftest: the list is exact (no prefix/wildcard), and a table test enumerates every route registered on the Fastify instance and asserts each is either on the list or returns 404 on the gateway.
  2. Negative tests for each excluded class above (one representative route each) through the gateway → 404/403.
- **Must hold by:** P3 (MOB-16/18).
- **Threats:** TB-0 I/E, TB-3 T/I, TB-4 I.
- **Grant:** FA-MOB-5, FA-MOB-6.

### SC-4 Every mobile approval is bound, single-use, short-lived and device-signed (dormant in release 1)

- **Statement:** a mobile approval is bound to a server-created request, `expectedStatus` and `itemDigest`, a single-use nonce, a short server-enforced maximum lifetime, and a signature from a non-exportable Android Keystore key that requires biometric unlock. The server records consumption in the hash-chained Work OS journal with the device id as actor.
- **Anchor:** `ApprovalAttestation` has no signature, nonce, single-use record or maximum-lifetime cap (`core/authority/approval.ts:2-10`, `:19-38`, VERIFIED; only `expires>granted` and `expires>now`, `:35-37`). Transition body is only `{to, reason}` (`core/workos/schemas.ts:49-52`, VERIFIED). Journal chain exists (`core/workos/store.ts:192-204`, VERIFIED). Everything else PROPOSED.
- **Acceptance evidence (before P5 merges):**
  1. Replay test: the same signed decision submitted twice → second is rejected; journal shows exactly one consumption.
  2. Staleness test: decision with a wrong `expectedStatus` or `itemDigest` → rejected.
  3. Lifetime test: decision after the server maximum (value = Q7) → rejected, even if the client-supplied expiry is later.
  4. Signature test: unsigned, wrongly signed, or signed by a revoked device key → rejected.
  5. Release-1 evidence: no approval route on the allow-list (SC-25).
- **Must hold by:** P5 (MOB-23/24). Not enabled before PT-035 is fixed (FD-d).
- **Threats:** TB-3 T/E later, AT-5, AT-2r.
- **Open questions:** Q6, Q7.
- **Grant:** FA-MOB-4, FA-MOB-7, FA-MOB-9.

### SC-5 PT-035 is fixed before any approval centre is built

- **Statement:** PT-035 is fixed before any approve centre exists. R3/R4 decisions, COMPLETE, delivery acceptance and finance/legal classes stay desktop-only unless the Founder grants otherwise.
- **Anchor:** `workosPolicy` hard-codes `actionClass:"MUTATION"`, `production:false`, `reversible:true` and an all-true `ActionPolicyContext` (`server.ts:164-167`, VERIFIED).
- **Acceptance evidence:**
  1. Policy tests show that at least one route reaches an approval-requiring class and is refused without a valid attestation.
  2. The PT-035 fix package is merged (DONE in backlog) before any MOB-23 branch is claimed.
  3. Release 1: SC-25 evidence.
- **Must hold by:** before P5 starts.
- **Threats:** TB-0 E, TB-3 E, RR-6.
- **Grant:** FA-MOB-7 (and the PT-035 package's own grant).

### SC-6 STOP from the phone only with step-up and reason; RESUME desktop-only (dormant in release 1)

- **Statement:** STOP is allowed from the phone only with step-up (biometric) and a required reason. RESUME stays desktop-only. The UI states that STOP halts only local Work OS and dev-runs, not Cloud production.
- **Anchor:** `/v1/control/stop` and `/resume` need only the token and bypass `workosWrite` (`server.ts:142-146`, VERIFIED); STOP stops dev-runs (`server.ts:143-145`, VERIFIED); cloud routines do not read local state (`docs/cloud-production/CLOUD_MIGRATION_MANIFEST.md:22`).
- **Acceptance evidence:**
  1. Release 1: `/v1/control/stop`, `/resume`, `/retry-blocked` are not on the mobile allow-list (gateway → 404).
  2. P5: mobile STOP without step-up proof or with an empty reason → rejected; any RESUME through the gateway → 404 in every phase unless separately granted.
  3. UI spec (MOB-7) and screenshot test show the "local only, not Cloud production" text on the STOP screen.
- **Must hold by:** release-1 part P3; STOP part P5 (MOB-25).
- **Threats:** TB-3 E, RR-5.
- **Grant:** FA-MOB-8.

### SC-7 No second backend or store; read-only STALE cache; no offline queue

- **Statement:** no second backend or store. The phone keeps only an encrypted read-only cache labelled STALE. Nothing is queued offline for later sending (no approvals, no STOP).
- **Anchor:** Founder decision (D-MOB `:85`, FD-b). Project Memory has no API (D-MOB `:175`). UI-177 "offline queue" note conflicts (`docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:178`, cited by D-MOB `:360`; not re-read here).
- **Acceptance evidence:**
  1. App test: with the network down, every write control is disabled and no request is persisted for later replay (inspect app storage after an attempted action).
  2. App test: cached views carry a STALE badge with the age of the last successful fetch.
  3. Storage test: the cache file is encrypted at rest with a Keystore-held key and is excluded from backup.
- **Must hold by:** P4 (MOB-20/21).
- **Threats:** TB-1 T/I, RR-13.
- **Open question:** Q22.

### SC-8 Push carries no content (dormant in release 1)

- **Statement:** push messages carry only an opaque reference; lock-screen visibility is private; provider credentials never enter the public repository.
- **Anchor:** no push exists; repository is PUBLIC (PT-012, D-MOB `:190`). FD-e: no FCM in release 1.
- **Acceptance evidence:** release 1: no push SDK in the dependency tree and no `google-services.json` (CI check). P6: payload schema test (only an opaque id), notification visibility private.
- **Must hold by:** P2 for the absence check; P6 (MOB-27) for the rest.
- **Grant:** FA-MOB-15.

### SC-9 Voice is on-device, untrusted and inert (dormant in release 1)

- **Statement:** speech-to-text runs on the device only and fails closed; transcripts are untrusted PII and stay LOCAL; voice may create only inert drafts, never approve, never set `testCommand`.
- **Anchor:** `PII: ["LOCAL"]` routing (`core/policy/data-routing.ts:5-13`, VERIFIED); `testCommand` in `missionCreateSchema` (`schemas.ts:36-40`, VERIFIED).
- **Acceptance evidence:** release 1: no `RECORD_AUDIO` permission in the merged manifest (CI check). P6: STT-unavailable → feature disabled; draft endpoint rejects `testCommand`; no approval path from a draft.
- **Must hold by:** P2 for the permission check; P6 (MOB-28).
- **Open question:** Q9. **Grant:** FA-MOB-16, FA-MOB-17.

### SC-10 Free text is never authority

- **Statement:** free text (titles, reasons, PR text, commit messages, later voice/assistant output) is never parsed as authority, and is shown with its provenance.
- **Anchor:** agents cannot act as Founder; Founder authority only through sealed policy and `approval.ts` records (`core/authority/autonomous-authority.mjs:214-215`, VERIFIED).
- **Acceptance evidence:**
  1. Render test: a mission titled "FOUNDER APPROVED — STOP CLEARED" is displayed as plain text with a source label, in a visually distinct text region, never as a status chip.
  2. Code review checklist item: no mobile code branches on the content of free-text fields.
- **Must hold by:** P4 (MOB-21).
- **Threats:** AT-6.

### SC-11 Secrets never committed; nested `.gitignore` before the first scaffold commit

- **Statement:** keystores, `google-services.json`, pairing secrets and the device registry are never committed. `apps/mobile/.gitignore` exists before the first scaffold commit.
- **Anchor:** root `.gitignore` ignores none of `*.keystore`, `*.jks`, `.gradle`, `local.properties`, `google-services.json` (`.gitignore:2-15`, VERIFIED). `scripts/secret-sanity.mjs:4-12` has no keystore or Firebase pattern (VERIFIED).
- **Acceptance evidence:**
  1. The first MOB-13 commit contains `apps/mobile/.gitignore` with those patterns; `git check-ignore` test for each pattern.
  2. Secret-sanity extended with keystore/Firebase-key patterns (FA-MOB-11) and a fixture test proving detection.
  3. Runtime: device registry and pairing secrets live under the runtime/userData directory, never in the repo tree.
- **Must hold by:** P1 (MOB-11) for the scanner; P2 (MOB-13) for `.gitignore`.
- **Threats:** TB-7 I. **Grant:** FA-MOB-11.

### SC-12 Mobile dependencies governed before entry

- **Statement:** exact pins, `ignore-scripts`, an audit gate, lockfile integrity, Gradle dependency verification and a wrapper checksum, before any mobile dependency enters the repository.
- **Anchor:** guards read only the root lockfile; policy allows only `registry.npmjs.org` (D-MOB `:184-185`; UNVERIFIED here, files not re-read).
- **Acceptance evidence:** CI fails on a non-exact version, a lockfile mismatch, an install script, an audit finding above the agreed level, a Gradle artifact missing from `verification-metadata.xml`, or a wrapper checksum mismatch (one negative fixture each).
- **Must hold by:** P1 (MOB-12), before P2 scaffolding.
- **Threats:** AT-7, RR-11. **Open questions:** Q16, Q17, Q20. **Grant:** FA-MOB-12, FA-MOB-14.

### SC-13 No validator, typecheck or scan silently weakened

- **Statement:** any scoping change for `apps/mobile` is an explicit, Founder-authorised protected edit followed by a reseal.
- **Anchor:** root `tsconfig.json` includes `apps/**/*.ts` (D-MOB `:182`); walkers skip `node_modules/` only at the root (D-MOB `:183`; `scripts/secret-sanity.mjs:13` VERIFIED: `ignorePrefixes` are root-relative).
- **Acceptance evidence:** diff of P1 shows every scope change in a protected file with a reseal record; a fixture secret placed in `apps/mobile/src/` is still detected; root `tsc` still covers all previously covered files (file-count comparison before/after).
- **Must hold by:** P1 (MOB-11).
- **Threats:** AT-8. **Open questions:** Q18, Q20. **Grant:** FA-MOB-10, FA-MOB-11.

### SC-14 Security-boundary files protected before they change

- **Statement:** `packaged-entry.ts`, `core/authority/approval.ts`, `core/action-gateway/policy.ts`, and the new gateway, pairing, device-registry and allow-list modules are added to protected paths before they are changed.
- **Anchor:** `server.ts` and `main.mjs` are protected (`config/protected-paths.json:21-22`, VERIFIED); `automation/lib/` is listed (`:144`, VERIFIED). No entry matches `packaged-entry.ts`, `core/authority/` or `core/action-gateway/` (grep of `config/protected-paths.json`, VERIFIED).
- **Acceptance evidence:** protected-paths test lists each file; a builder-mode change to any of them is refused by the change guard.
- **Must hold by:** P1 (MOB-15), before P3.
- **Threats:** AT-8, TB-5 T. **Grant:** FA-MOB-9.

### SC-15 Founder holds the release signing key

- **Statement:** the Founder holds the release signing key; the template's public debug keystore is never used for a release; the signing job never runs on `pull_request`.
- **Anchor:** template behaviour reported by research (D-MOB `:273-276`, UNVERIFIED in repo; no mobile tree exists).
- **Acceptance evidence:** release-build check fails if the signing certificate fingerprint equals the debug keystore's; workflow lint asserts the signing job triggers exclude `pull_request`; no keystore file in the repo (SC-11).
- **Must hold by:** P2 for the debug-key release check; P7 (MOB-30) for custody.
- **Open question:** Q19. **Grant:** FA-MOB-20.

### SC-16 Technology knowledge researched and pinned before implementation

- **Statement:** technology knowledge for the chosen stack is researched, with pinned versions, before primary implementation.
- **Anchor:** activation rule requires researched and certified facets (`knowledge/technologies/react-native.json:118`, cited by D-MOB `:191`; not re-read here, UNVERIFIED).
- **Acceptance evidence:** `docs/mobile/TECH-VERSIONS.md` (MOB-9) exists and is reviewed; the later registry update is merged under its own grant before P2.
- **Must hold by:** P0 (MOB-9) for the document; before P2 for the registry.
- **Open question:** Q16.

### SC-17 The gateway never forges loopback identity (new)

- **Statement:** the mobile gateway does not rewrite `Host` to `127.0.0.1:<port>` or otherwise satisfy the loopback hook on behalf of a phone. It has its own Host/SNI policy and its own principal; it does not call the loopback API with the control token.
- **Anchor:** Host-exact check is the only loopback guard (`control-boundary.mjs:29`, `server.ts:98`, VERIFIED).
- **Acceptance evidence:** test: a gateway request with `Host: 127.0.0.1:<port>` is rejected by the gateway's own Host/SNI policy; code review asserts the gateway path never reads `controlToken`.
- **Must hold by:** P3 (MOB-18). **Threats:** TB-0 S, TB-3 S. **Grant:** FA-MOB-3.

### SC-18 Per-device principal and device-attributed audit (new; refines SC-2 audit)

- **Statement:** every gateway request runs as a principal derived from the device credential (device id, scopes), not as `FOUNDER_LOCAL`. Pairing, revocation, allowed and denied calls are audited with device id; the audit never contains credentials.
- **Anchor:** fixed actor `FOUNDER_LOCAL` (`server.ts:156`, VERIFIED); audit has no caller identity (`server.ts:78`, VERIFIED).
- **Acceptance evidence:** audit lines for one allowed and one denied gateway call contain the device id and no secret material (regex check against the credential).
- **Must hold by:** P3 (MOB-17/18). **Threats:** TB-0 R, TB-2 R, TB-3 S/R, TB-5 R. **Grant:** FA-MOB-4, FA-MOB-6.

### SC-19 Read projections are bounded and side-effect-free (new)

- **Statement:** mobile reads go only through PROPOSED `/v1/mobile/*` projections that are paginated, size-bounded, carry no absolute paths, include journal health (OK/TORN_TAIL/TAMPERED/UNAVAILABLE), and perform no writes. No existing route that writes on GET (e.g. executors) is reachable.
- **Anchor:** unpaginated full-object reads (D-MOB `:170`); journal health exists (`server.ts:119-120`, VERIFIED); `lastSeq` not exposed (`store.ts:131`, VERIFIED).
- **Acceptance evidence:** tests: page size cap enforced; response size cap; no file under the runtime/data dir changes during a full projection sweep (hash before/after); TAMPERED journal fixture is surfaced as TAMPERED, not hidden.
- **Must hold by:** P3 (MOB-16). **Threats:** TB-0 I/D, TB-3 T/I/D, TB-4 I/D. **Grant:** FA-MOB-5.

### SC-20 Android component hygiene (new)

- **Statement:** only the launcher activity is exported; no deep link or intent can start or complete pairing; sensitive screens set `FLAG_SECURE` and reject obscured touches (tapjacking); no WebView loads remote content.
- **Anchor:** PROPOSED (no mobile code).
- **Acceptance evidence:** merged-manifest check in CI (exported components list = launcher only, no pairing intent filter); instrumentation/Maestro test that a pairing intent from another app is ignored; screenshot attempt on the session screen yields a blank frame.
- **Must hold by:** P4 (MOB-20). **Threats:** TB-1 S, AT-3. **Open question:** Q14 (real-device runs).

### SC-21 Credential storage and session lifetime (new)

- **Statement:** the device credential key is non-exportable in Android Keystore (hardware-backed where available), app data is excluded from backup and device transfer, session tokens are short-lived and renewed with the device key, and app unlock requires device authentication after a configurable idle period.
- **Anchor:** PROPOSED. Hardware backing per device UNVERIFIED (RR-2).
- **Acceptance evidence:** manifest check `allowBackup=false` and data-extraction rules exclude all app data; test that a copied credential file is unusable on another emulator; server rejects an expired session token.
- **Must hold by:** P4 (MOB-20); server side P3 (MOB-17). **Threats:** TB-1 I/E, AT-2, AT-2r, RR-1. **Open question:** Q9.

### SC-22 Pairing protocol properties (new; design detail is MOB-2)

- **Statement:** the QR carries the gateway certificate fingerprint and a high-entropy single-use secret with a short TTL; the desktop shows the pairing request and the Founder confirms it on the desktop; the phone pins the fingerprint from the QR (trust on first *scan*, not first connect).
- **Anchor:** PROPOSED (no pairing exists).
- **Acceptance evidence:** tests: wrong fingerprint → phone aborts; reused/expired secret → server rejects; pairing completes only after desktop confirmation; pairing attempts rate-limited (SC-2.5).
- **Must hold by:** P3 (MOB-17, MOB-19). **Threats:** TB-2 S, AT-1, AT-5. **Grant:** FA-MOB-4, FA-MOB-23.

### SC-23 Explicit interface binding, off by default (new)

- **Statement:** the gateway is disabled by default, enabled from the desktop, binds only to an explicitly chosen interface address (never `0.0.0.0`/`::`), and turns itself off when that interface disappears.
- **Anchor:** today binds are hard-coded loopback (`server.ts:738`, `packaged-entry.ts:79`, VERIFIED).
- **Acceptance evidence:** test: configuration with `0.0.0.0` or `::` is refused; fresh install has no gateway socket; disabling from the desktop closes the socket.
- **Must hold by:** P3 (MOB-18). **Threats:** TB-2 E. **Grant:** FA-MOB-3, FA-MOB-21.

### SC-24 No public tunnel or relay; the overlay is an untrusted network (new)

- **Statement:** no public tunnel and no cloud relay (FD-b). In model B the overlay is treated like an untrusted LAN: the same pinned TLS and device authentication apply end-to-end; no overlay-provided identity is accepted as authentication.
- **Anchor:** Founder decision `FD-2026-10-20-MOB-PHASE0.md:13`, `:41`.
- **Acceptance evidence:** no tunnel/relay SDK or account in the dependency tree or config (CI check); model B test: a peer on the overlay without a device credential is rejected exactly like a LAN peer.
- **Must hold by:** P3 for the absence check; before model B is enabled for the rest. **Threats:** TB-2 (model B), AT-4, RR-10. **Grant:** FA-MOB-2.

### SC-25 Release 1 is provably read-only (new; implements FD-c/FD-d)

- **Statement:** in release 1 the mobile allow-list contains only read routes. No approval, transition, delivery, STOP, RESUME, retry-blocked, mission-create or draft route is reachable from the phone, and the app contains no write control.
- **Anchor:** write routes needing only the token (`server.ts:142-152`, VERIFIED); transition route (`schemas.ts:49-52`, VERIFIED).
- **Acceptance evidence:** allow-list test asserts every entry is `GET`; a table test sends every non-GET method to every registered route through the gateway and expects 404/405; app UI test finds no write control.
- **Must hold by:** P3 (gateway) and P4 (app). **Threats:** TB-0 E, TB-3 E.

### SC-26 Revocation from the desktop (new)

- **Statement:** the Founder can list and revoke paired devices from the desktop; revocation takes effect on the next request and survives restart.
- **Anchor:** PROPOSED (no device registry).
- **Acceptance evidence:** test: revoke → next request with that device's session rejected; restart backend → still rejected; revocation audited (SC-18).
- **Must hold by:** P3 (MOB-17, MOB-19). **Threats:** TB-5 E, RR-1, RR-9. **Grant:** FA-MOB-4, FA-MOB-23.

## 3. Summary matrix

| SC | Short name | R1 active | Must hold by | Anchor kind |
|---|---|---|---|---|
| SC-1 | No control token on phone | yes | P2 (static) / P3 | code fact |
| SC-2 | Gateway preconditions | yes | P3 | code fact |
| SC-3 | Allow-list exclusions | yes | P3 | code fact + PROPOSED |
| SC-4 | Signed single-use approvals | dormant | P5 | code fact (gap) |
| SC-5 | PT-035 first | dormant (enforced by SC-25) | before P5 | code fact |
| SC-6 | STOP step-up, RESUME desktop | release-1 part yes | P3 / P5 | code fact |
| SC-7 | No second store, no offline queue | yes | P4 | decision + inventory (UNVERIFIED line) |
| SC-8 | Content-free push | absence check | P2 / P6 | PROPOSED |
| SC-9 | Voice local and inert | absence check | P2 / P6 | code fact |
| SC-10 | Free text not authority | yes | P4 | code fact |
| SC-11 | Secrets never committed | yes | P1 / P2 | code fact |
| SC-12 | Dependency governance | yes | P1 | UNVERIFIED (D-MOB) |
| SC-13 | No silent weakening | yes | P1 | code fact |
| SC-14 | Protect boundary files | yes | P1 | code fact |
| SC-15 | Founder signing key | yes | P2 / P7 | UNVERIFIED (research) |
| SC-16 | Researched technology | yes | P0 / before P2 | UNVERIFIED (`react-native.json:118`) |
| SC-17 | No forged loopback identity | yes | P3 | code fact |
| SC-18 | Per-device principal and audit | yes | P3 | code fact |
| SC-19 | Bounded side-effect-free reads | yes | P3 | code fact |
| SC-20 | Android component hygiene | yes | P4 | PROPOSED |
| SC-21 | Credential storage and session | yes | P3 / P4 | PROPOSED |
| SC-22 | Pairing protocol properties | yes | P3 | PROPOSED |
| SC-23 | Explicit bind, off by default | yes | P3 | code fact |
| SC-24 | No tunnel/relay; overlay untrusted | yes | P3 / model B | decision |
| SC-25 | Release 1 read-only | yes | P3 / P4 | code fact |
| SC-26 | Revocation from desktop | yes | P3 | PROPOSED |

## 4. Open questions that affect these conditions

Kept as explicit questions (D-MOB section 14; numbers unchanged). Answered ones (1, 3, 4, 5, 8, 10, 15) are applied in section 0.

- **Q2** headless/service mode (SC-23, RR-4) · **Q6** authoritative approver identity (SC-4) · **Q7** approval maximum lifetime; signed rejections (SC-4) · **Q9** minimum Android version (SC-9, SC-21) · **Q11** CI report source and what the phone shows with the PC off (SC-7) · **Q12** Project Memory location (SC-19 scope) · **Q13** FD-REL-1 blocker (sandbox gate, `server.ts:245`, VERIFIED) · **Q14** real devices/device farm (SC-20, SC-21 testing) · **Q16** RN line, bare vs Expo modules (SC-12, SC-16) · **Q17** standalone lockfile vs workspaces (SC-12) · **Q18** mobile CI and merge-gating check (SC-12, SC-13) · **Q19** distribution and signing custody (SC-15) · **Q20** mobile installs in local tree (SC-13) · **Q21** vendor vs import renderer logic · **Q22** no offline queue confirmation (SC-7) · **Q23** screen IDs for F8 and assistant · **Q24** backlog write-back placement · **Q25** `adb reverse` dev path (SC-1).
