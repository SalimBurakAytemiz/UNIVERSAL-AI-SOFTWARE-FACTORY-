<!-- //TR: MOB-2 tasarım dokümanı (yalnız doküman, FD-2026-10-20-MOB-PHASE0): Android Mobile Companion için bağlantı modeli A (aynı yerel ağ, QR eşleştirme + sertifika sabitlemeli TLS), uzak hedef B (kullanıcının yönettiği VPN/overlay), cihaz başına salt okunur oturum, döndürme/iptal, masaüstündeki tek mevcut kayıt deposunda cihaz kaydı, SC-* tehdit eşlemesi, fail-closed durumlar ve açık sorular. Hiçbir kod, dinleyici, API, kimlik doğrulama değişikliği veya yetki vermez; desktop control plane 127.0.0.1'de kalır. -->

# MOB-2: Connectivity, pairing and device-session design

- **Task:** MOB-2, "Connectivity, pairing and device-session design" (`docs/planning/BACKLOG_CHECKPOINT.json`, entry `MOB-2`).
- **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md` (documentation only, files under `docs/mobile/**` only). Scope record: `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md` (sections 4, 6, 7, 9).
- **Status:** DESIGN ONLY. This document builds nothing, opens no listener, adds no API and changes no authentication. Every component below marked **PROPOSED** does not exist. Implementing any of it needs the grants named in section 12 (FA-MOB-2, FA-MOB-3, FA-MOB-4, FA-MOB-5, FA-MOB-6, FA-MOB-9, FA-MOB-21, FA-MOB-23).
- **It recommends, it does not choose.** Every choice that belongs to the Founder is listed in section 11.
- **Evidence convention:** `path:line` citations were re-checked against this branch (base `6d36547`, descends from `v7/integration` `1d34db7`) unless marked **UNVERIFIED**. No technology version is claimed here; MOB-9 owns version facts (`docs/mobile/TECH-VERSIONS.md`).

## 1. Founder constraints carried into this design

From `FD-2026-10-20-MOB-PHASE0.md`:

1. **Model A first:** same-LAN secure QR pairing plus TLS.
2. **Remote target B later:** a user-managed VPN or secure overlay network, with the same app-level authentication as A.
3. **Rejected / excluded:** an open (public) tunnel (option C) and a cloud relay or second backend (option D).
4. **First release is read-only monitoring.** No mobile approvals before PT-035 is fixed. Mobile STOP and signed approvals are evaluated separately. RESUME stays desktop-only.
5. **No FCM, no paid LLM, no new external account** in the first release.
6. **No second repository, backend or Project Memory.**

Consequence for this document: the only session scope it designs for issue is `MOBILE_READ`. `MOBILE_STOP` and `MOBILE_APPROVE` appear only as reserved names so that the token format does not have to change later (section 5.4); they are never issued under this design.

## 2. Current state (verified)

| Fact | Evidence |
|---|---|
| Dev entry listens on `127.0.0.1` only | `apps/control-api/src/server.ts:738` |
| Packaged entry listens on `127.0.0.1` only | `apps/control-api/src/packaged-entry.ts:79` |
| Every request whose `Host` is not exactly `127.0.0.1:<port>` gets 421 `CONTROL_HOST_REJECTED` | `server.ts:98`; `automation/lib/control-boundary.mjs:8,29` |
| `/health` is unauthenticated and returns an HMAC proof keyed by the control token | `server.ts:99,104`; `control-boundary.mjs:22-25` |
| `/v1/*` needs one shared header `x-uasco-control-token`, compared in constant time | `server.ts:77,100-101`; `control-boundary.mjs:26-28` |
| Every request acts as the fixed actor `FOUNDER_LOCAL`, tenant `local` | `server.ts:156` |
| Packaged app: token is 32 random bytes per launch, never written to disk, given to the backend over stdin | `apps/desktop/main.mjs:12,14,295`; `packaged-entry.ts:63-64` |
| Packaged app: port is a free loopback port chosen at launch | `main.mjs:278,288` |
| Backend exits when the desktop closes its stdin | `packaged-entry.ts:74-75`; `main.mjs:281` |
| Transport is plain HTTP; runtime dependencies are ajv, ajv-formats, fastify only (no TLS, CORS or rate-limit library) | `control-boundary.mjs:20`; `package.json:38-42` |
| No rate limiting in the Control API | grep for `rateLimit` / `rate-limit` under `apps/control-api/src` finds nothing |
| `/v1/control/stop`, `/resume`, `/retry-blocked` need only the token | `server.ts:142-152` |
| Work OS journal is append-only and hash-chained; each entry carries `actor` | `core/workos/store.ts:1,442-444` |
| Canonical sources are Git, the repository and `.ai/` | `ARCHITECTURE-CONSTITUTION.md:34-36` |
| Project Memory has no API, store or screen (DESIGN_ONLY) | `docs/inventory/2026-10-19/MASTER_WORK_INVENTORY.md:219` |
| PT-035: permissive policy context in `workosPolicy` | `server.ts:164-167`; `MASTER_WORK_INVENTORY.md:279` |

There is no device identity, scope, expiry, revocation, TLS, pairing or rate limit today. A phone cannot reach the API as built, and this design does not change that.

## 3. Why the desktop control plane stays bound to 127.0.0.1

The existing listener is the **desktop control plane**. It must stay loopback-only, unchanged, in every option including B:

1. **Its credential is all-powerful.** The single control token unlocks every `/v1/*` route, including STOP, RESUME, retry-blocked and every Work OS write (`server.ts:100-101,142-152`). It has no scope, so it cannot be narrowed for a phone. SC-1 forbids the phone from ever holding it.
2. **Its identity is fixed.** Every call is `FOUNDER_LOCAL` (`server.ts:156`). Any remote caller on this listener would be indistinguishable from the Founder at the keyboard, and the journal `actor` field would be false evidence.
3. **Its Host check is part of the DNS-rebinding defence.** The exact-match `127.0.0.1:<port>` rule (`control-boundary.mjs:29`) only means something while the socket is loopback. Relaxing it to admit a LAN address would weaken a protected boundary for every desktop caller.
4. **`/health` leaks a token-keyed oracle.** It is unauthenticated and returns `HMAC(token, challenge)` (`server.ts:104`). On a LAN it would let any host probe for the control plane and build a chosen-challenge oracle against the full-authority token. SC-2 already says `/health` is not exposed to mobile.
5. **It is plain HTTP with no rate limiting** (section 2). Anything on the LAN could sniff or brute-force it.
6. **PT-035 is unfixed** (`server.ts:164-167`). The authority gate always passes, so the only real protection is "only the local desktop can reach this socket".

So the design rule is: **the control plane never gets a non-loopback bind, a relaxed Host rule, a second token or a mobile route.** Mobile reach, if ever authorised, comes from a separate component.

### 3.1 Requirements for a future, separately authorised LAN-facing component

PROPOSED name: **mobile gateway**. Nothing here is to be built under this task. FA-MOB-3 (listener), FA-MOB-4 (identity), FA-MOB-5 (read projections), FA-MOB-6 and FA-MOB-9 (protected edits and reseal) and FA-MOB-21 (host/firewall) must all exist first. The gateway must satisfy every item:

| # | Requirement | Maps to |
|---|---|---|
| G-1 | Runs **inside the existing Control API process** (no second backend, no second store), as a second listener with its own route table. Recommended over a separate process; the Founder decides (Q-4). | Decision; SC-7 |
| G-2 | Binds to **one explicit interface address** chosen by the Founder on the desktop, never `0.0.0.0` / `::`. Default is off. Enabling it is a desktop-only action. | SC-2 |
| G-3 | **TLS only.** No plain-HTTP port, no redirect from HTTP. Self-signed gateway key generated and kept on the desktop; the phone pins it (section 5.2). | SC-2 |
| G-4 | **Own Host policy:** accepts only the bound address and port (and, for B, the overlay address the Founder registers). The control plane's `hostHeaderAllowed` stays untouched. | SC-2 |
| G-5 | **Per-device authentication only.** The desktop control token is never accepted, never forwarded and never derivable on this listener. The gateway calls internal read functions, not the loopback HTTP API. | SC-1 |
| G-6 | **Allow-list of routes** in a protected file under `automation/lib/` (FA-MOB-6), default deny, exact match or strict-id regex like `desktopGetPathAllowed` (`control-boundary.mjs:30-35`). First release: `GET` read projections only. No `/health` (a separate unauthenticated liveness reply that carries no token-derived proof is allowed if needed). | SC-2, SC-3 |
| G-7 | **Excludes** file content, git diff, raw logs, exports, project import, executor settings (including `GET /v1/system/executors`, which writes `settings.json`), dev-runs, journal repair, company finance/legal, STOP, RESUME, retry-blocked, every write. | SC-3, SC-5, SC-6 |
| G-8 | **Rate limits** on pairing attempts, session authentication and per-device request rate, enforced before route handling, with lock-out after repeated pairing failures. | SC-2 |
| G-9 | **Audit** of every allowed and denied call into the existing secret-free control audit (`server.ts:78`) and pairing/revocation events into the Work OS journal, with the device id as actor; never the session secret. | SC-2, SC-4 |
| G-10 | **Fail-closed lifecycle:** the gateway stops when the backend stops (`packaged-entry.ts:74-75`), when the desktop disables it, when the journal is tampered or unavailable (`store.ts` `isTampered`/`isUnavailable`), and when its key or registry cannot be loaded. | Section 9 |
| G-11 | **No outbound connection.** The gateway never dials out (no relay, no push sender, no telemetry). | Decision (no D, no FCM) |
| G-12 | **Boundary files protected before they change:** `packaged-entry.ts`, the gateway and auth modules, the allow-list (FA-MOB-9). New selftests for Host, TLS-only, allow-list and token isolation. | SC-13, SC-14 |
| G-13 | **Data minimisation:** responses are purpose-built read projections (MOB-3), paginated, with no absolute paths, secrets, stack traces or raw evidence bodies. | SC-3 |

## 4. Topology (model A)

```text
 Desktop PC (Founder)                                        Phone (same LAN)
 ┌──────────────────────────────────────────────────┐
 │ Electron main (main.mjs)                          │
 │   └─ holds control token; shows pairing QR        │      ┌────────────────────┐
 │        (PROPOSED, FA-MOB-23)                      │ QR   │ Mobile Companion   │
 │ Control API process (packaged-entry.ts)           │─────▶│  scans QR (optical,│
 │   ├─ control plane  127.0.0.1:<random>  UNCHANGED │      │  no network)       │
 │   │    token + Host-exact 421                     │      │                    │
 │   └─ mobile gateway <LAN-IP>:<port> TLS  PROPOSED │◀────▶│  pinned TLS,       │
 │        per-device session, read allow-list        │ LAN  │  device session    │
 │ Work OS journal (single existing store)           │      └────────────────────┘
 │   └─ device registry records (PROPOSED)           │
 └──────────────────────────────────────────────────┘
```

- The QR transfer is optical and local: it proves physical presence at the unlocked desktop.
- The phone never talks to the control plane, and the control plane never learns the phone exists except through gateway function calls.

## 5. Pairing and device sessions

### 5.1 Pairing flow (PROPOSED)

1. **Start on the desktop.** The Founder opens "Pair a phone" in the desktop app (UI-173 desktop side, FA-MOB-23). The gateway must already be enabled. The desktop generates a pairing record:
   - `pairingId` (random, ≥128 bits, public);
   - `pairingSecret` (random, ≥128 bits, single use, held only in backend memory as a hash);
   - `expiresAt` (short; proposed default 120 s, Founder Q-7);
   - the gateway certificate SPKI fingerprint (SHA-256).
2. **Show the QR.** The QR encodes the payload in 5.2. The desktop also shows a short human-readable **pairing code** (proposed 6-8 characters, derived from the secret) for manual comparison, and a countdown. The QR is shown only while the window is focused and is cleared on expiry, cancel, blur or success.
3. **Scan on the phone.** The app parses the payload, rejects it if expired by the phone clock beyond a small skew, if the version is unknown, or if any field is missing. It then opens TLS to `host:port` and **pins** the fingerprint from the QR (5.3). Any mismatch aborts before a byte of application data is sent.
4. **Phone key.** The phone generates a device key pair in Android Keystore (non-exportable; hardware-backed where available, UNVERIFIED per device, MOB-9/MOB-1). The private key never leaves the device.
5. **Claim.** Over the pinned channel, the phone sends `pairingId`, a proof of the `pairingSecret` (HMAC over the transcript: `pairingId`, nonce, device public key, gateway fingerprint), the device public key and a device label. The secret itself is never sent in clear even inside TLS, so a captured request cannot be replayed.
6. **Confirm on the desktop.** The desktop shows the device label, the key fingerprint and the pairing code the phone displays. The Founder approves on the desktop (desktop-side presence, not a phone tap). No approval → no device.
7. **Register.** The backend consumes the pairing record (single use: any second claim, success or failure, is rejected and audited), writes a `DEVICE_PAIRED` record (5.6) and returns the first session (5.4).
8. **Lock-out.** Each pairing record allows a small number of failed claims (proposed 3) and then is burned. Repeated burns rate-limit new pairing starts.

### 5.2 QR payload

Proposed canonical form (versioned, compact, no secrets other than the single-use pairing secret):

```text
uasco-pair:v1?id=<pairingId b64url>&s=<pairingSecret b64url>&n=<nonce b64url>
  &h=<gateway host>&p=<port>&fp=<sha256 SPKI fingerprint b64url>&exp=<unix seconds>
```

| Field | Purpose | Rule |
|---|---|---|
| `v1` | format version | unknown version → reject |
| `id` | selects the pairing record | random, ≥128 bits |
| `s` | pairing secret; proves possession of the QR | random, ≥128 bits, single use, never logged, stored only hashed |
| `n` | per-QR nonce bound into the claim transcript | random, ≥96 bits |
| `h`, `p` | where the gateway listens | must equal the gateway's bound address; for B the overlay address (section 7) |
| `fp` | pin for the gateway TLS key | SHA-256 of the SubjectPublicKeyInfo |
| `exp` | expiry | short; server clock is authoritative |

- The QR contains **no** control token, no session token, no project data and no Founder identity.
- A photographed QR is useful only until it expires or is consumed, and only to someone on the same network who also wins the desktop confirmation in step 6.
- Whether to use a JSON body instead of a URI is an implementation detail for MOB-3/MOB-17; the fields and rules are what this design fixes.

### 5.3 TLS and certificate pinning

- The gateway uses a **self-signed key pair generated on the desktop** on first enable, stored in the desktop's per-user data directory (packaged: under `userData`, `main.mjs:22-25`), never in the repository (SC-11).
- The phone **pins the SPKI hash** received in the QR. It does not trust the system or user CA store for this host, so a user-installed or rogue CA cannot intercept. Pinning the key (SPKI), not the certificate, allows certificate renewal without re-pairing.
- Hostname verification is replaced by the pin, because LAN IPs change and there is no public name. Whether Android Network Security Config can express this for IP-literal hosts is **UNVERIFIED** (scope record section 13); MOB-5/MOB-9 decide the mechanism (config versus a custom trust manager).
- **Key rotation:** the desktop can create a next key and announce its SPKI hash to paired devices over the current pinned channel (signed by the current key). The phone accepts the new pin only through that channel. A lost or compromised key → all devices must re-pair (section 6.3).
- No TLS downgrade, no fallback to plain HTTP, no "trust anyway" button on the phone.

### 5.4 Per-device session token

| Property | Design |
|---|---|
| Form | opaque random value (≥256 bits), not a JWT; the server keeps only its hash |
| Binding | bound to `deviceId`; each request also proves possession of the device key (signature over method, path, timestamp and a request nonce), so a stolen bearer value alone is not enough |
| Scope | exactly one of `MOBILE_READ`, `MOBILE_STOP`, `MOBILE_APPROVE`; **first release issues only `MOBILE_READ`**. The other two are reserved names; issuing them needs FA-MOB-8 / FA-MOB-7 and PT-035 fixed |
| Expiry | short access lifetime (proposed 15 min) plus a device-bound refresh with an absolute cap (proposed 7 days) after which the phone must be re-confirmed on the desktop; Founder Q-7 |
| Refresh | needs the device-key signature and a non-revoked registry entry; old session invalidated on refresh (rotation) |
| Principal | the gateway maps the session to actor `MOBILE_DEVICE:<deviceId>`, **never** `FOUNDER_LOCAL` |
| Storage on phone | Android Keystore-protected storage only; app lock (UI-174) gates use; never in logs, crash reports or backups |
| Storage on desktop | hash only, in backend memory; the durable registry stores the device public key, not session secrets (5.6) |

### 5.5 Rotation and revocation

- **Session rotation:** every refresh issues a new session and kills the old one. Reuse of a rotated session is treated as theft: the device is revoked and the event is audited.
- **Revocation (desktop):** the Founder can revoke one device or all devices from the desktop device list (FA-MOB-23). Revocation writes `DEVICE_REVOKED`, drops all live sessions for that device at once, and the gateway checks revocation on every request (no cached "still valid" window).
- **Revocation (phone):** "Unpair this phone" deletes the local key and cache and sends a best-effort revoke; the desktop record is authoritative.
- **Automatic revocation:** pin mismatch reports, session reuse, repeated signature failures, or Founder "revoke all" after a lost phone.
- **Control-token rotation is independent:** the desktop token still changes every launch (`main.mjs:14`); device sessions do not depend on it, so a launch does not unpair phones, and a phone compromise does not touch the token.
- **Gateway key loss / suspicion:** revoke all, regenerate the key, re-pair.

### 5.6 Device registry: single existing store, no second store

The decision forbids a second Project Memory or store. Project Memory itself is DESIGN_ONLY (`MASTER_WORK_INVENTORY.md:219`); the only durable store the backend reads and writes is the hash-chained Work OS journal (`store.ts:1,442-444`).

Design:

- The device registry is **a projection of records in that existing journal**, in the same data directory the desktop already uses (`main.mjs:25,232`). No new file, database or service.
- PROPOSED journal types (would extend `JournalType`, `core/workos/types.ts:39`): `DEVICE_PAIRED`, `DEVICE_SESSION_POLICY_CHANGED`, `DEVICE_REVOKED`, `GATEWAY_KEY_ROTATED`.
- Each record holds: `deviceId`, label, device public key (or its fingerprint plus key), granted scope (`MOBILE_READ`), paired-at, paired-by (desktop actor), revoked-at and reason. It **never** holds the pairing secret, a session secret, the control token or the gateway private key.
- Because the journal is hash-chained, registry history is tamper-evident; a tampered journal makes the gateway fail closed (section 9).
- Live sessions are memory-only. A backend restart drops them; phones refresh with their device key against the registry.
- The repository is public (PT-012); the journal lives in the user data directory, not the repository, so the registry is never committed (SC-11).
- **Open:** whether the Founder's term "Project Memory" here means this Work OS journal, or a future Project Memory store that must host the registry instead (Q-1). Until answered, this design uses the journal because it is the single store that exists.

### 5.7 Read-only first release

- Allowed: `GET` read projections from MOB-3 under `MOBILE_READ`.
- Not allowed from the phone: any approval, STOP, RESUME, retry-blocked, mission creation, drafts, voice, push registration. No mobile approval before PT-035 (`server.ts:164-167`). RESUME stays desktop-only permanently unless the Founder grants otherwise.
- Nothing is queued offline for later sending (SC-7).

## 6. Threat mapping to SC-1..SC-16

| SC | Condition (short) | How this design meets it | Residual / owner |
|---|---|---|---|
| SC-1 | Phone never holds the control token; per-device credential; pairing from desktop with single-use secret | 3 (control plane untouched), G-5, 5.1, 5.4 | Needs FA-MOB-4 |
| SC-2 | No non-loopback listener until TLS + pin, per-device auth, protected allow-list, rate limits, audit; no `/health` | 3.1 G-2..G-9, 5.3 | Needs FA-MOB-3, FA-MOB-6 |
| SC-3 | Allow-list excludes content, diff, logs, exports, imports, executor settings, dev-runs, journal repair, finance/legal writes, `testCommand` | G-6, G-7, G-13 | Route list in MOB-3 |
| SC-4 | Signed, single-use, bound approvals | Not issued: `MOBILE_APPROVE` is reserved only. Device key from 5.1 is reusable later for signatures | MOB-4; FA-MOB-7 |
| SC-5 | PT-035 fixed before any approve centre | 5.7: no approvals in this design | FA-MOB-7 |
| SC-6 | STOP only with step-up; RESUME desktop-only | 5.7: no STOP, no RESUME | MOB-4; FA-MOB-8 |
| SC-7 | No second backend/store; STALE read-only cache; no offline queue | G-1, G-11, 5.6, 9 | UI-177 note conflict (Q in scope record) |
| SC-8 | Push carries no content | No push in this design (no FCM) | FA-MOB-15 |
| SC-9 | Voice on-device only | Out of scope | MOB-7 |
| SC-10 | Free text never parsed as authority | Device label and pairing fields are data; the label is shown with provenance and never grants anything | MOB-3 |
| SC-11 | No keys, secrets or registry committed | 5.3 (key in user data), 5.6 (journal in user data), QR never logged | MOB-11 `.gitignore` |
| SC-12 | Mobile dependencies governed | No dependency named here | FA-MOB-12 |
| SC-13 | No validator weakened | No validator change proposed | — |
| SC-14 | Boundary files protected before change | G-12 | FA-MOB-9 |
| SC-15 | Founder holds release signing key | Unrelated to the TLS pin; the gateway key is not an app-signing key | FA-MOB-20 |
| SC-16 | Technology researched before implementation | No version claims; Keystore, pinning and QR mechanisms deferred to MOB-9 | MOB-9 |

### 6.1 Threats specific to pairing and sessions

| Threat | Mitigation |
|---|---|
| Shoulder-surfed or photographed QR | Short expiry, single use, desktop confirmation with matching code (5.1 steps 6-7), lock-out |
| Rogue access point / ARP spoof / MITM on LAN | SPKI pin from the optical QR; no CA trust; no plain HTTP |
| LAN scanner probing the desktop | Control plane remains loopback; gateway off by default, bound to one interface, no token-derived `/health` proof, rate limits |
| DNS rebinding from a browser on the LAN or phone | Gateway Host policy exact-match; no cookies; per-request device signature a browser cannot produce |
| Stolen session value (logs, backup) | Device-key proof of possession; short life; rotation reuse detection |
| Lost or stolen phone | App lock (UI-174), Keystore-bound key, desktop "revoke" and "revoke all" |
| Compromised phone OS | Out of reach of design; impact limited to `MOBILE_READ` projections; revocation |
| Replay of a pairing claim | Transcript HMAC with nonce and single-use record |
| Pairing brute force | ≥128-bit secret, few attempts per record, rate-limited starts |
| Tampered registry | Hash-chained journal; tamper → gateway fails closed |
| Confused deputy into control plane | Gateway calls internal read functions; never holds or forwards the control token |

## 7. Remote path B: user-managed VPN / overlay (high level)

- **What changes:** only the network path. The phone reaches the gateway over a VPN or overlay network that the Founder runs (a self-hosted WireGuard tunnel, or an overlay mesh the Founder already uses). The gateway binds to the overlay interface address instead of, or in addition to, the LAN address (G-2, G-4).
- **What does not change:** the same gateway, the same pinned TLS, the same per-device sessions, scopes, revocation and registry. The overlay is **transport only, never trust**: being on the overlay grants nothing.
- **Pairing stays local:** pairing is done on the LAN (or with the phone physically at the desktop) and then the phone is allowed to use the overlay address. The QR may carry both addresses; remote pairing over the overlay is not proposed.
- **Excluded:** public tunnel (C), relay or any cloud service storing or forwarding UASCO state (D), port-forwarding of the gateway to the internet, any provider-terminated TLS.
- **Needs before use:** FA-MOB-2 (which overlay, account or self-hosted), FA-MOB-21 (host/firewall), and a Founder answer on whether a new external account is acceptable once the first release is done (the first release allows none).
- **Not designed here:** overlay provider choice, ACLs, key distribution of the overlay itself, and any version facts (MOB-9).

## 8. Gateway lifecycle and PC availability

- Today the backend exits when the desktop app closes (`packaged-entry.ts:74-75`). The gateway, inside the same process (G-1), therefore exists only while the desktop app is open.
- A headless or service mode needs FA-MOB-21 and is not proposed here (open question 2 in the scope record).
- While the PC is off, asleep or the app is closed, the phone shows only its encrypted **STALE** cache, labelled with the time of last sync; nothing can be sent (SC-7).

## 9. Failure and fail-closed states

| State | Detected by | Gateway | Phone |
|---|---|---|---|
| Gateway disabled / not authorised | desktop setting | no listener | `UNREACHABLE` + STALE cache |
| Desktop app closed / PC off | connection refused / timeout | none | `UNREACHABLE` + STALE cache |
| Wrong network (not on LAN / overlay down) | timeout | — | `UNREACHABLE`; never tries another host |
| TLS pin mismatch | phone pin check | — | `PIN_MISMATCH`: hard stop, no retry to the same host without re-pair, show warning; no "continue" |
| TLS key rotated without announcement | pin check | — | same as pin mismatch → re-pair |
| QR expired / consumed / malformed / unknown version | phone parse or gateway | reject, audit | `PAIRING_FAILED`, start again on desktop |
| Pairing attempt limit hit | gateway counter | burn record, rate-limit | `PAIRING_LOCKED` |
| Desktop confirmation declined or timed out | desktop | consume record | `PAIRING_REJECTED` |
| Session expired | gateway | 401 | silent refresh with device key; if refresh fails → `REAUTH_REQUIRED` |
| Device revoked | registry | 401 for every request, drop sessions | wipe session and cache, `DEVICE_REVOKED` |
| Session reuse after rotation | gateway | revoke device, audit | `DEVICE_REVOKED` |
| Signature invalid / clock skew too large | gateway | 401, audit, count | `REAUTH_REQUIRED` after limit |
| Route not on allow-list / scope too low | gateway | 403, audit | show "not available on mobile" |
| Rate limit hit | gateway | 429 | back off |
| Journal tampered or unavailable | `store.ts` `isTampered` / `isUnavailable` | refuse all mobile requests (503), no pairing | `DESKTOP_DEGRADED` + STALE |
| Journal torn tail (read-only) | `store.ts` `isReadOnly` | reads allowed if projections are consistent; pairing and revocation writes refused | read-only banner; pairing unavailable |
| GLOBAL_STOP active | stop file | reads still allowed; status shown | shows STOP state; cannot resume (desktop only) |
| Registry or gateway key cannot be loaded | startup | no listener | `UNREACHABLE` |
| Phone Keystore key invalidated (e.g. new biometric enrolment, OS reset) | phone | — | local wipe, re-pair |

Rule: **every unknown or unexpected state is treated as deny**, and no failure path falls back to the control plane, to plain HTTP, to an unpinned connection, or to a weaker scope.

## 10. Out of scope for MOB-2

- API endpoint shapes and pagination (MOB-3).
- Approval, STOP and step-up design (MOB-4).
- React Native module choice, Keystore and pinning libraries, QR scanning library (MOB-5, MOB-9).
- Screen layouts for UI-173, UI-249 and UI-104 (MOB-6, MOB-7); this document supplies only the states they must render (section 9).
- Test strategy (MOB-8).

## 11. Open questions for the Founder

1. **Registry location.** Is the existing Work OS journal the "single existing Project Memory" for the device registry, or must it wait for a canonical Project Memory store (DESIGN_ONLY today, `MASTER_WORK_INVENTORY.md:219`)?
2. **Gateway enable model.** Off by default, enabled per session by the Founder on the desktop, or remembered across launches?
3. **Interface choice.** Should the Founder pick the LAN interface explicitly, or may the desktop propose the current default-route address for confirmation?
4. **Process placement.** Gateway as a second listener inside the Control API process (recommended, no second backend), or a separate process sharing the same store?
5. **Headless mode.** Should the phone work only while the desktop app is open (today), or is FA-MOB-21 wanted? (scope record Q2)
6. **Desktop confirmation.** Is a desktop confirm click with matching code required for every pairing (recommended), or is QR possession enough?
7. **Lifetimes.** QR expiry (proposed 120 s), access session (15 min), absolute device re-confirmation (7 days), failed-claim limit (3). Accept or set other values?
8. **Number of devices.** One phone only, or several? Should pairing a new phone revoke the old one?
9. **Overlay choice for B.** Self-hosted WireGuard or an overlay service; and is a new external account acceptable after the first release?
10. **Pairing over B.** Confirm pairing is LAN/physical only, never over the overlay.
11. **Minimum Android version / hardware-backed keys.** Should pairing be refused on devices without hardware-backed Keystore? (relates to scope record Q9)
12. **Cache retention.** How long may the STALE cache keep data on the phone, and is it wiped on revoke? (recommended: wiped)
13. **Audit visibility.** Should the desktop show a per-device access history from the audit trail?

## 12. UNVERIFIED items and grants needed

**UNVERIFIED (not confirmed in code or not executable here):**

- Android Network Security Config support for pinning IP-literal hosts (scope record section 13; nothing in this repository to check).
- Availability of hardware-backed Keystore on the Founder's device.
- That a second listener can share the Fastify instance or process cleanly with the existing `onRequest` Host hook (`server.ts:97-102`) without the control-plane hook rejecting gateway requests; checked only that the hook is global to `app` (`server.ts:97`), not how a second listener would be built.
- That Windows firewall prompts or blocks a new LAN listener in the packaged app (FA-MOB-21).
- Behaviour of overlay networks with respect to the gateway's Host policy (address forms, MagicDNS-style names).
- Every library, platform and version fact: deferred to MOB-9.

**Grants this design depends on (none exist yet):** FA-MOB-2 (connectivity A/B), FA-MOB-3 (TLS gateway listener), FA-MOB-4 (pairing, registry, sessions, revocation), FA-MOB-5 (read projections), FA-MOB-6 (allow-list and `server.ts` principal, reseal), FA-MOB-9 (protect boundary files), FA-MOB-21 (host/firewall, headless), FA-MOB-23 (desktop pairing and device-management UI). Implementation packages: MOB-16, MOB-17, MOB-18, MOB-19, MOB-20.

This document grants nothing and changes no code, listener, API or authentication.
