<!-- //TR: MOB-1 Android Mobile Companion tehdit modeli (yalnız doküman, FD-2026-10-20-MOB-PHASE0): varlıklar, güven sınırları (telefon, LAN/overlay, 127.0.0.1'e bağlı masaüstü kontrol düzlemi, tek token, FOUNDER_LOCAL), saldırgan modelleri, sınır başına STRIDE ve kalan riskler. Hiçbir yetki vermez; kod, API, dinleyici veya kimlik doğrulama değişikliği onaylamaz. -->

# MOB-1 Mobile Companion threat model (docs only)

- **Task:** MOB-1, "Mobile threat model and pre-coding security conditions". Companion file: [`SECURITY-CONDITIONS.md`](SECURITY-CONDITIONS.md).
- **Authority:** `docs/planning/authority/FD-2026-10-20-MOB-PHASE0.md` (documentation only, `docs/mobile/**` only). Scope record: `docs/planning/authority/D-2026-10-20-MOBILE-ANDROID.md` (cited below as **D-MOB**).
- **This document grants nothing.** It approves no code, dependency, API, listener, auth change, protected edit, external service or paid resource. Every endpoint, module or mechanism named here that does not exist in the repository is **PROPOSED**.
- **Evidence base:** branch `claude/mob-1` at claim commit `7fa1df0` (descends from `v7/integration`). Citations use `path:line`. **VERIFIED** means the cited line was re-read for this document. **UNVERIFIED** means the claim was not confirmed in the code; the file:line that was checked is given.
- **No technology versions are claimed here.** Version facts belong to MOB-9 (`docs/mobile/TECH-VERSIONS.md`).

## 0. Founder decisions this model is built on

From FD-2026-10-20-MOB-PHASE0 (`FD-2026-10-20-MOB-PHASE0.md:11-19`, `:39-46`):

| # | Decision | Consequence for this model |
|---|---|---|
| FD-a | Connectivity **model A** first: same-LAN secure QR pairing plus TLS. | The first network boundary to model is the home/office LAN. |
| FD-b | Remote target **model B**: a user-managed VPN or secure overlay. **No open tunnel** and **no second backend**. | Option C (public tunnel) and D (cloud relay) are out of scope as designs; they appear only as *rejected* paths whose absence must be tested. |
| FD-c | The first release is **read-only monitoring**. | Release 1 has no write capability from the phone at all. |
| FD-d | **No mobile approvals before PT-035 is fixed.** Mobile STOP and signed approvals are evaluated separately. **RESUME stays desktop-only.** | Approval and STOP threats are modelled so the later design (MOB-4) has a baseline, but they are *not* release-1 surfaces. |
| FD-e | **No FCM, no paid LLM and no new external account** in the first release. | Push, voice and assistant threats are carried as future surfaces only. |

Release 1 is therefore: **pairing + TLS + per-device read-only session + read-only projections**, on LAN (model A), later reachable through a user-managed overlay (model B).

## 1. Assets

| Id | Asset | Where it lives today | Why it matters |
|---|---|---|---|
| A-1 | **Desktop control token** (`x-uasco-control-token`) | Generated per launch in the desktop main process (`apps/desktop/main.mjs:14`, VERIFIED); delivered to the backend over stdin (`main.mjs:295`, VERIFIED); compared in `tokenOk` (`apps/control-api/src/server.ts:77`, VERIFIED). | It is the **only** credential of the Control API and carries full `FOUNDER_LOCAL` authority. Whoever holds it can STOP, RESUME, retry-blocked and write Work OS. |
| A-2 | **FOUNDER_LOCAL authority** | Every request runs as actor `FOUNDER_LOCAL`, tenant `local` (`server.ts:156`, VERIFIED). | No per-caller principal exists, so any accepted request is the Founder. |
| A-3 | **Work OS journal** (hash-chained) | Verified on read with seq/prevHash/hash chain (`core/workos/store.ts:192-204`, VERIFIED); `lastSeq` getter (`store.ts:131`, VERIFIED, not exposed by any route). | Canonical operational state. Integrity and freshness of what the phone shows depend on it. |
| A-4 | **GLOBAL_STOP state** | `GLOBAL_STOP.json` under the runtime dir; set by `/v1/control/stop`, cleared by `/v1/control/resume` (`server.ts:142-146`, VERIFIED). | Safety switch. Local only: cloud routines do not read local state (`docs/cloud-production/CLOUD_MIGRATION_MANIFEST.md:22`, cited by D-MOB `:165`). |
| A-5 | **Approval decisions and attestations** | `ApprovalAttestation` = id, approver, action/target digests, grantedAt, expiresAt, optional revokedAt (`core/authority/approval.ts:2-10`, VERIFIED); checked in `assertApprovalValid` (`approval.ts:19-38`, VERIFIED). | No signature, nonce, single-use record or maximum lifetime cap exists (only `expires>granted` and `expires>now`, `approval.ts:35-37`). Replayable within its window. |
| A-6 | **Project data shown to the phone** | Missions, runs, evidence, reviews, projects (`server.ts` reads; D-MOB section 5). | Repository is PUBLIC (PT-012, D-MOB `:190`), but run evidence, logs, diffs and local paths may not be. Confidentiality on a lost phone. |
| A-7 | **Per-device credential and pinned server identity** (PROPOSED) | Do not exist. Would be created by pairing (FA-MOB-4) and TLS (FA-MOB-3). | Their theft or substitution is the main release-1 attack on the phone side. |
| A-8 | **TLS private key of the mobile gateway** (PROPOSED) | Does not exist. | Theft lets a LAN attacker impersonate the desktop to a paired phone. |
| A-9 | **Pairing secret** (PROPOSED, single-use, shown as QR) | Does not exist. | Theft before use lets an attacker pair as a device. |
| A-10 | **Device registry and audit trail** (PROPOSED) | Does not exist. The control audit exists (`server.ts:78`, `control-api-events.jsonl`, VERIFIED) but records no caller identity. | Needed for revocation and forensics. |
| A-11 | **Release signing key** (future) | Not in repo. FA-MOB-20. | A stolen key lets a malicious APK replace the real app. |
| A-12 | **Founder availability / safety** | n/a | Denial of the monitoring view or false "all green" data delays Founder reaction. |

## 2. Trust boundaries

```
 [Phone app]  --TB-1 (device/OS)--  [Android OS, Keystore, other apps]
     |
   TB-2  network: same LAN (model A)  /  user-managed overlay (model B)
     |
 [PROPOSED mobile TLS gateway, in the Control API process]   <-- does not exist
     |
   TB-3  gateway -> control plane (per-device principal -> route allow-list)
     |
 [Control API, 127.0.0.1 only, Host-exact 421, single token, FOUNDER_LOCAL]
     |
   TB-4  control plane -> Work OS journal / runtime files / supervisor
     |
 [Desktop app (Electron) owns token and backend lifetime]  -- TB-5 desktop UI / pairing QR (physical presence)
```

| Id | Boundary | Current fact | Status |
|---|---|---|---|
| TB-0 | **Loopback control plane** (today's only boundary) | Listens on `127.0.0.1` only: `server.ts:738` and `apps/control-api/src/packaged-entry.ts:79` (VERIFIED). `onRequest` returns **421** unless `Host` equals exactly `127.0.0.1:<port>` (`server.ts:98`; `automation/lib/control-boundary.mjs:8,29`, VERIFIED). `/v1/*` without configured token → 503, wrong token → 403 (`server.ts:100-101`, VERIFIED). Plain HTTP (`server.ts:66`, Fastify without TLS options, VERIFIED). Runtime deps are only ajv, ajv-formats, fastify (`package.json:38-42`, VERIFIED): no TLS, CORS or rate-limit plugin. `bodyLimit` is 64 KiB (`server.ts:66`). | Exists |
| TB-0a | **`/health` exception** | Unauthenticated; returns `controlProof = HMAC-SHA256(token, challenge)` for any 64-hex challenge (`server.ts:104`; `control-boundary.mjs:22-25`, VERIFIED). | Exists. On loopback it lets the desktop verify it talks to its own backend. Exposed to a network it is a **token-proof oracle**: an attacker can request `HMAC(token, c)` for chosen `c`. It does not reveal the token (HMAC-SHA256 with a 256-bit random key, `main.mjs:14`), but it confirms liveness, fingerprints the instance and would validate an offline guess of a weak dev token (dev mode uses `UASCO_CONTROL_TOKEN` from env, `main.mjs:14`, `server.ts:70`). |
| TB-1 | **Phone ↔ Android OS and other apps** | No mobile code exists. | PROPOSED |
| TB-2 | **Phone ↔ network ↔ desktop** | Not reachable today: loopback bind + Host-exact 421 (TB-0). D-MOB `:151`. | PROPOSED (model A first, model B later) |
| TB-3 | **Mobile gateway ↔ control plane** | No per-request principal; the single token maps to `FOUNDER_LOCAL` (`server.ts:156`). `/v1/control/stop`, `/resume`, `/retry-blocked` bypass `workosWrite` and need only the token (`server.ts:142-152`, VERIFIED). `workosPolicy` hard-codes `MUTATION`, `production:false`, `reversible:true` and an all-true context (`server.ts:164-167`, VERIFIED) = **PT-035**. | Exists (desktop side); mobile side PROPOSED |
| TB-4 | **Control plane ↔ journal/runtime** | Journal hash chain verified (`store.ts:192-204`). Runtime path containment via `resolveExistingPathUnder` (`server.ts:79`, `:120`). | Exists |
| TB-5 | **Desktop UI ↔ Founder (physical presence)** | Desktop IPC GET allow-list (`control-boundary.mjs:9-11,30-35`, VERIFIED). No pairing UI exists (FA-MOB-23). | Exists; pairing PROPOSED |
| TB-6 | **Overlay provider ↔ LAN/phone** (model B) | No overlay exists or is configured. | PROPOSED, needs FA-MOB-2 |
| TB-7 | **Build/supply chain ↔ APK** | No mobile tree, lockfile or Gradle files. Supply-chain policy allows only `registry.npmjs.org` (D-MOB `:185`). | PROPOSED, needs FA-MOB-12/14 |

**Key structural fact.** Today the *only* thing separating "anyone on the LAN" from "full Founder authority" is the loopback bind plus the Host-exact check. The token is a shared bearer secret with no device identity, scope, expiry or revocation (D-MOB `:154-156`). Any design that simply widens the bind, or puts A-1 on the phone, collapses TB-2 and TB-3 into one bearer secret. This is why SC-1 and SC-2 are the first conditions.

## 3. Attacker models

| Id | Attacker | Capabilities assumed | Not assumed |
|---|---|---|---|
| AT-1 | **LAN attacker / co-tenant** (shared Wi-Fi, guest network, compromised IoT device, malicious router) | Sees and injects LAN traffic; ARP/DNS/mDNS spoofing; rogue access point; scans ports; can connect to any LAN-reachable listener; can be present during pairing. | Physical access to the desktop; ability to read the desktop screen. |
| AT-2 | **Stolen or lost phone** (locked) | Physical possession; can attempt unlock, reboot, attach USB; can try the app while within LAN range. | Knowledge of the device unlock secret or biometric. |
| AT-2r | **Rooted / unlocked phone** (stolen and unlocked, or the Founder's own phone rooted, or compromised by an OS exploit) | Reads app sandbox files, hooks app code (Frida-class), reads process memory, uses Keystore keys *through* the app while unlocked. | Extracting a hardware-backed non-exportable key's raw material (UNVERIFIED per device; depends on StrongBox/TEE availability, MOB-9). |
| AT-3 | **Malicious app on the same phone** | Runs as a different Android UID; can use exported components, intents, deep links, accessibility services (if granted), screen overlays (tapjacking), clipboard, shared storage, local network. | Root. |
| AT-4 | **Compromised or curious overlay** (model B provider, its control plane, or a compromised node in the user's tailnet/WireGuard mesh) | Sees overlay metadata; can add/route a node into the overlay; can MITM if app-level TLS is not pinned; can reach any service bound to the overlay interface. | Breaking pinned TLS with a private key it does not hold. |
| AT-5 | **Replay attacker** (any of AT-1/AT-4 with captured traffic, or a malicious app with captured requests) | Re-sends previously valid requests, pairing codes, session tokens or approval payloads; reorders them; delays them. | Forging new signatures. |
| AT-6 | **Prompt/text injection author** (anyone who can write repo text, PR text, mission titles, reasons, commit messages; later voice input) | Places text that the phone renders next to Founder controls, or that later voice/assistant features might parse. | Direct API access. |
| AT-7 | **Supply-chain attacker** (npm, Gradle/Maven, RN template, CI) | Publishes or compromises a dependency, Gradle plugin, wrapper or build step that ends up in the APK. | Repository write access. |
| AT-8 | **Insider-agent** (an AI builder/agent with repo write on a branch; every agent shares one GitHub identity, FD record `:6`) | Writes code or docs that widen the listener, add routes, embed the token, or weaken validators. | Merging without independent review; Founder's non-agent channel. |

Release-1 primary attackers: **AT-1, AT-2, AT-2r, AT-3, AT-5, AT-8**. AT-4 becomes primary when model B is enabled. AT-6 matters already for read-only rendering (spoofed "approved" text, fake status). AT-7 matters from the first scaffold.

## 4. STRIDE per boundary

Notation: **Thr** = threat, **Mit** = condition in `SECURITY-CONDITIONS.md` that mitigates it. R1 = release 1 (read-only). Later = only when a later grant enables the surface.

### 4.1 TB-0 / TB-0a: loopback control plane (as it would be if exposed)

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| S | Anyone who reaches the port with A-1 is `FOUNDER_LOCAL` (`server.ts:77,156`). If the token reached the phone, a stolen phone or malicious app becomes the Founder. | R1 | SC-1, SC-2 |
| S | Host-exact check (`control-boundary.mjs:29`) only defends DNS-rebinding/browser paths; it is not an identity. A gateway that rewrites `Host` to `127.0.0.1:<port>` would bypass it silently. | R1 | SC-2, SC-17 |
| T | Plain HTTP (`server.ts:66`): on any non-loopback path, request and response bodies can be altered. | R1 | SC-2 |
| R | Control audit records events but no caller identity (`server.ts:78`). All callers are indistinguishable. | R1 | SC-2, SC-18 |
| I | `/health` is a HMAC proof oracle and instance fingerprint (`server.ts:104`). | R1 | SC-2 |
| I | Unpaginated full-object reads (`/v1/work-runs`, `/v1/projects`, D-MOB `:170`) would leak far more than a dashboard needs. | R1 | SC-3, SC-19 |
| D | No rate limit (`package.json:38-42`). A network-exposed endpoint is cheap to flood; every evidence request re-hashes evidence (D-MOB `:207`). | R1 | SC-2, SC-19 |
| E | The token unlocks STOP, RESUME, retry-blocked (`server.ts:142-152`) and every Work OS write, and PT-035 makes every write a reversible non-production `MUTATION` (`server.ts:164-167`). | R1 (must stay unreachable) / Later | SC-1, SC-3, SC-5 |

### 4.2 TB-1: phone ↔ Android OS and other apps

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| S | Malicious app (AT-3) invokes an exported activity/deep link to trigger pairing with an attacker-supplied QR payload, or overlays a fake pairing/approval screen (tapjacking). | R1 | SC-20 |
| T | Rooted phone (AT-2r) edits the cached read model so the Founder sees false state. Impact limited because the cache is read-only and labelled STALE. | R1 | SC-7 |
| R | Without a device-bound key, actions taken by a cloned credential cannot be attributed. | Later (writes) | SC-4, SC-18 |
| I | Session credential or cached data read from app storage, backups (`allowBackup`), screenshots/recents thumbnails, logs, clipboard, notification text. | R1 | SC-7, SC-8, SC-21 |
| D | OS kills the app / battery restrictions; not a security threat beyond availability. | R1 | Accepted (section 5) |
| E | Credential exported from the sandbox to another device (AT-2r) and used from there. | R1 | SC-1, SC-21 |

### 4.3 TB-2: phone ↔ network ↔ desktop (model A LAN; model B overlay)

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| S | LAN attacker (AT-1) impersonates the desktop (ARP/DNS/mDNS spoofing, rogue AP) to a phone that does not pin the server identity; collects the session credential. | R1 | SC-2, SC-22 |
| S | LAN attacker present during pairing races the phone with the QR secret it observed (shoulder surfing, camera) or brute-forces a short code. | R1 | SC-1, SC-22 |
| T | MITM alters responses (false green status, hidden STOP state). | R1 | SC-2 |
| R | Network-level identity (IP/MAC) is not a principal; replay from another LAN host indistinguishable. | R1 | SC-18 |
| I | Passive sniffing of plaintext; TLS metadata (SNI, IP, timing) visible to LAN and overlay. | R1 | SC-2; metadata accepted (section 5) |
| D | Flooding the gateway; pairing endpoint brute force; Wi-Fi deauth. | R1 | SC-2 (rate limits); deauth accepted |
| E | Gateway bound to `0.0.0.0` instead of the chosen interface exposes it on every network the PC joins (public Wi-Fi, VPN adapters). | R1 | SC-23 |
| S/T/I | **Model B:** overlay provider or a rogue overlay node (AT-4) reaches the gateway or MITMs it if app TLS is not pinned end-to-end. | Later (B) | SC-2, SC-22, SC-24 |
| E | **Rejected options**: a public tunnel or cloud relay makes the gateway Internet-reachable or terminates TLS at a third party. | Never (FD-b) | SC-24 |

### 4.4 TB-3: mobile gateway ↔ control plane

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| S | Gateway forwards mobile requests using A-1 internally, so every phone request becomes `FOUNDER_LOCAL` (`server.ts:156`). | R1 | SC-1, SC-18 |
| T | Read requests smuggle writes (method override, path traversal, query that maps to a mutating route, e.g. `GET /v1/system/executors` writes `settings.json`, D-MOB `:202`). | R1 | SC-3, SC-19 |
| R | Device id not recorded as actor. | R1 | SC-18 |
| I | Allow-list too broad (file content, diffs, raw logs, exports). | R1 | SC-3 |
| D | Mobile polling triggers expensive full-evidence re-hash. | R1 | SC-19 |
| E | Any write route reachable from the phone in release 1; any approval path before PT-035 is fixed; RESUME from the phone. | R1 must be impossible | SC-5, SC-6, SC-25 |
| T/E | **Later (approvals):** replay of an `ApprovalAttestation` within `expiresAt` (no nonce/single-use, `approval.ts:19-38`); stale approval applied to a changed item (transition body is only `{to, reason}`, `core/workos/schemas.ts:49-52`). | Later | SC-4, SC-5 |
| E | **Later (STOP):** STOP from phone triggers dev-run stop and is local only (`server.ts:142-145`; manifest `:22`); Founder may believe Cloud production stopped. | Later | SC-6 |

### 4.5 TB-4: control plane ↔ journal / runtime

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| T | Mobile path writes to the journal outside the hash chain. | Later | SC-4 (journal consumption) |
| I | Projections leak absolute paths or quarantine paths. Status route already limits to relative paths (comment at `server.ts:118`). | R1 | SC-3, SC-19 |
| D | Torn-tail or TAMPERED journal shown as healthy on the phone. | R1 | SC-19 (projection must carry journal health) |

### 4.6 TB-5: desktop UI ↔ Founder (pairing origin)

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| S | Pairing initiated remotely (from the phone or LAN) instead of from the desktop. | R1 | SC-1 |
| T | Pairing QR replaced by a malicious desktop-side renderer change (AT-8). `main.mjs` is protected (`config/protected-paths.json:22`, VERIFIED); renderer files are partly protected (D-MOB `:317`). | R1 | SC-14, SC-13 |
| R | Pairing/revocation not audited. | R1 | SC-18 |
| E | Device management UI lets a device grant itself scopes. | R1 | SC-1, SC-26 |

### 4.7 TB-6 / TB-7: overlay and supply chain

| STRIDE | Threat | Scope | Mit |
|---|---|---|---|
| T/E | Malicious npm/Gradle dependency or wrapper in the APK exfiltrates the session credential or cached data. | R1 | SC-12, SC-13 |
| T | Release signed with the template's public debug key; anyone can publish an "update". | R1 | SC-15 |
| I | Keystores, `local.properties`, `google-services.json` committed to a PUBLIC repo; root `.gitignore` covers none of them (`.gitignore:2-15`, VERIFIED). | R1 | SC-11 |
| E | Technology facts assumed current without verification. | R1 | SC-16 |

### 4.8 Future surfaces (not release 1; modelled for MOB-4/MOB-7)

| Surface | Threat | Mit |
|---|---|---|
| Push (no FCM in R1, FD-e) | Payload content on lock screen and with the provider; provider credential in the public repo. | SC-8 |
| Voice / assistant (no paid LLM in R1, FD-e) | Remote STT streams audio; transcript treated as a command; injected text approves or sets `testCommand` (`schemas.ts:36-40`). | SC-9, SC-10 |
| Free text as authority (AT-6) | Titles, reasons, PR text saying "Founder approved" rendered as authority. | SC-10 |

## 5. Residual risks (accepted, transferred or open)

| Id | Residual risk | Why it remains | Owner / question |
|---|---|---|---|
| RR-1 | **Unlocked rooted phone (AT-2r) can use the session while unlocked.** A non-exportable key prevents cloning, not use. Read-only in R1 limits impact to confidentiality of A-6. | Inherent to any mobile client. | Founder accepts; mitigated by short session lifetime and remote revocation from desktop (SC-21, SC-26). |
| RR-2 | **Hardware-backed key availability varies by device** (TEE/StrongBox). | Device-dependent; UNVERIFIED (no mobile code; MOB-9 territory). | Open question 9 (minimum Android version). |
| RR-3 | **Traffic metadata** (that the phone talks to the PC, when, how much) is visible to LAN observers and to an overlay provider. | TLS hides content, not metadata. | Accepted for model A; model B provider choice is open (FA-MOB-2). |
| RR-4 | **Phone is useless while the PC/desktop app is off**: backend exits with the desktop app (`packaged-entry.ts:74-77`, VERIFIED). The phone shows only a STALE cache and cannot STOP. | No headless mode (FA-MOB-21). | Open question 2. |
| RR-5 | **STOP is local only.** Even a future mobile STOP does not stop Cloud production (manifest `:22`). | Architecture; Cloud routines do not read local state. | Open questions 4, 11. Must be stated in UI (SC-6). |
| RR-6 | **PT-035 remains** (`server.ts:164-167`): the server cannot distinguish risk classes, so no approval surface is safe. | Fix is a separate AUTHORITY_REQUIRED package. | FD-d; open question 5 answered (fix first), open questions 6, 7 open. |
| RR-7 | **Single Founder identity, no second factor on the desktop side.** Pairing assumes whoever is at the desktop is the Founder. | Desktop has no user authentication beyond OS login (UNVERIFIED: no desktop login code found; checked `apps/desktop/main.mjs:12-16`). | Accepted for R1; revisit with FA-MOB-7. |
| RR-8 | **Agent-authored code** (AT-8): all agents share one GitHub identity (FD record `:6`). | Governance, not code. | Mitigated by protected paths + independent review (SC-13, SC-14); residual. |
| RR-9 | **Self-signed pinned TLS has no external revocation.** Key compromise of A-8 requires re-pairing every device. | No PKI by design (no external account, FD-e). | Accepted; rotation procedure is a MOB-2 deliverable. |
| RR-10 | **Overlay compromise (model B)** can route a node to the gateway; app-level auth and pinning still hold, but DoS and scanning are possible. | Third-party/managed infra. | FA-MOB-2; open question 1 answered in kind (B), provider still open. |
| RR-11 | **Supply chain of RN/Gradle** cannot be reduced to zero; governance only reduces it. | Ecosystem. | SC-12, FA-MOB-12/14; open questions 16, 17. |
| RR-12 | **`adb reverse` dev path** would put a full-authority token on a device (D-MOB `:127`, UNVERIFIED, not run). | Not designed. | Open question 25; forbidden by default (SC-1). |
| RR-13 | **UI-177 "offline queue"** design note (`docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:178`, cited by D-MOB `:360`) conflicts with SC-7. | Inventory text. | Open question 22. |

## 6. Open questions carried (from D-MOB section 14)

Answered by FD-2026-10-20-MOB-PHASE0: **1** (A then B), **3, 4** (read-only first; STOP/approvals separately; RESUME desktop-only), **5** (fix PT-035 first), **8** (no FCM in R1), **10** (no paid LLM in R1), **15** (docs READY rule for MOB-1..9).

Still open and relevant to this threat model (kept as questions):

- **Q2.** Phone only while the desktop app is open, or a headless/service mode on the PC (FA-MOB-21)? → RR-4.
- **Q6.** Which identity record is authoritative for mobile approvals in `trustedApproverIdentityIds`? → TB-3 later, SC-4.
- **Q7.** Maximum lifetime of a mobile approval challenge; is a rejection also signed and journaled? → SC-4.
- **Q9.** Minimum Android version (on-device STT, hardware-backed Keystore)? → RR-2, SC-21.
- **Q11.** CI report source; anything shown while the PC is off besides a STALE cache? → RR-4, RR-5.
- **Q12.** Where does canonical Project Memory live? Until defined, the phone cannot show it. → A-6 scope.
- **Q13.** Does this decision clear the FD-REL-1 blocker named in the G-SCR-MOBILE rows (in code FD-REL-1 is the sandbox gate, `server.ts:245`, VERIFIED)?
- **Q14.** Is UI-144 (real devices / paid farm) in scope? → testing of SC-20/21.
- **Q16, Q17.** RN version line and project layout (standalone lockfile vs workspaces). → AT-7, SC-12. (Versions are MOB-9's.)
- **Q18.** Mobile CI workflow and merge-gating check name. → SC-12, SC-13.
- **Q19.** Distribution channel and signing-key custody. → A-11, SC-15.
- **Q20.** Will mobile dependencies be installed in the supervisor/local working tree? → SC-13 (FA-MOB-11 first).
- **Q21.** Vendor or import renderer pure-logic modules? → AT-8 coupling.
- **Q22.** Confirm nothing is ever queued offline. → RR-13, SC-7.
- **Q23.** New screen IDs for F8 reports and the assistant?
- **Q24.** Backlog write-back placement (coordinator; informational here).
- **Q25.** May the `adb reverse` dev path be used? → RR-12, SC-1.

## 7. New security-boundary files (input to MOB-15)

Files that form, or will form, the mobile security boundary. Protection status was checked against `config/protected-paths.json` (163 lines).

| File | Role | Protected today |
|---|---|---|
| `apps/control-api/src/server.ts` | Hook, token, actor, routes, PT-035 | Yes (`protected-paths.json:21`) |
| `automation/lib/control-boundary.mjs` | Host check, `/health` proof, token compare | Yes, via `automation/lib/` (`protected-paths.json:144`) — prefix semantics UNVERIFIED (checked only the entry text) |
| `apps/desktop/main.mjs` | Token generation and delivery; future pairing QR | Yes (`protected-paths.json:22`) |
| `apps/control-api/src/packaged-entry.ts` | Bind host and lifetime | **No** (no match in `protected-paths.json`) |
| `core/authority/approval.ts` | Approval validity | **No** (no `core/` entry in `protected-paths.json`) |
| `core/action-gateway/policy.ts` | Action policy | **No** (no `core/` entry; file content not re-read here, UNVERIFIED) |
| PROPOSED gateway, pairing, device-registry and mobile allow-list modules | New boundary | Must be added before first change (SC-14) |
