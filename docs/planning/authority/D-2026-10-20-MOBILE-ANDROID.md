<!-- //TR: Founder kararı D-2026-10-20-MOBILE-ANDROID (20 Ekim 2026): UASCO Mobile Companion yalnızca Android olacak, React Native + TypeScript ile, mevcut tek repo içinde (tercihen apps/mobile/) geliştirilecek. Bu kaydı bir ajan yazdı ve kayıt kendini doğrulamaz. Kararın kendisi dışında hiçbir şeyi onaylamaz. Yeni API, kimlik doğrulama, dış servis, protected-file, CI, imzalama, ücretli servis ve kodlamaya başlama için ayrı Founder yetkisi gerekir. -->

# D-2026-10-20-MOBILE-ANDROID: Android-only React Native Mobile Companion

- **Date:** 2026-10-20.
- **Provenance:** the Founder gave this decision in-session to the coordinator session `session_01DmTHw4gBA3wvY1tKM9bk2e` on 2026-10-20 (around 04:10Z). The read-only planning workflow that produced this record received it verbatim.
- **The record proves nothing on its own.** It follows the convention of `docs/planning/authority/FD-2026-10-19-MAX-CLOUD-PRODUCTION.md:5-9`. An agent wrote this file, and every agent shares one GitHub identity. It becomes binding only when the Founder confirms it through a channel an agent cannot produce and the independent reviewer records that confirmation.
- **Status:** the scope decision is recorded. Nothing else here is approved, verified, READY or started. Every work package in section 10 is DRAFT_NOT_READY or AUTHORITY_REQUIRED. MOB-0 (this record) and MOB-10 (registering MOB-1..MOB-31 in `docs/planning/BACKLOG_CHECKPOINT.json` as non-READY, owner FOUNDER, `requiresNewAuthority: true`) are delivered by the same coordinator write-back PR that adds this file, so the backlog file changes in one serialized PR only.
- **Evidence base:** a read-only checkout of `v7/integration` at `0d0b2b9`, which descends from `f12918f`.
  - `git diff f12918f 0d0b2b9` touches only 7 renderer files, 2 `docs/ux` records, 2 tests and `docs/planning/BACKLOG_CHECKPOINT.json`. Every other citation is therefore identical at `f12918f`.
  - `BACKLOG_CHECKPOINT.json` line numbers are taken at `0d0b2b9`.
  - Citations use the form `path:line`.
  - **UNVERIFIED** marks a claim that was not confirmed in the repository.
  - **PROPOSED** marks an endpoint or module that does not exist.

## 1. Decision

Verbatim excerpt (Turkish original):

> UASCO Mobile Companion kapsamını kesinleştiriyorum.
> Platform: Yalnızca Android.
> Teknoloji: React Native + TypeScript.
> iOS, Swift, iPhone sürümü veya Apple dağıtım altyapısı geliştirilmeyecek.
> Mobile Companion mevcut tek UASCO repository'sinin içinde, tercihen `apps/mobile/` altında geliştirilecek.
> Yeni repository, bağımsız kontrol merkezi, ikinci backend veya ikinci Project Memory oluşturulmayacak.
> Android uygulaması mevcut UASCO Control API, kanonik Project Memory, görev yönetimi ve yetki mekanizmalarıyla güvenli şekilde entegre olacak.
> Mevcut Cloud üretimini durdurma.
> Gerçek uygulama kodlaması, güvenlik koşulları ve bağımlılıklar netleştirildikten sonra onaylı iş sırasıyla yürütülecek.

In substance:

1. **Platform:** Android only. No iOS, Swift, iPhone build or Apple distribution infrastructure.
2. **Technology:** React Native + TypeScript.
3. **Location:** the single existing UASCO repository, preferably `apps/mobile/`.
4. **Excluded:** a new repository, an independent control centre, a second backend, a second Project Memory.
5. **Integration:** secure integration with the existing UASCO Control API, the canonical Project Memory, task management and the authority mechanisms.
6. **Target functions:**
   - F1 Founder Mobile Dashboard
   - F2 multi-project status
   - F3 agent and worker monitoring
   - F4 task and workflow tracking
   - F5 secure approve/reject centre
   - F6 push notifications
   - F7 voice command and AI assistant UI
   - F8 CI, QA and Security reports
   - F9 operations and recovery states
7. **Cloud production:** keeps running and is not stopped.
8. **Sequencing:** real coding starts only after the security conditions and dependencies are settled, and follows an approved order.

## 2. What this record does NOT authorise

Each item below needs its own explicit Founder grant. The FA-MOB ids refer to section 9.

- **Coding:** starting any code in `apps/mobile/**` or anywhere else (FA-MOB-1).
- **READY status:** marking any MOB task READY. D-2026-10-19-A covers only `apps/desktop/renderer/**` (`FD-2026-10-19-MAX-CLOUD-PRODUCTION.md:61`).
- **API surface:** new or changed Control API endpoints, route registrations or allow-lists (FA-MOB-5, FA-MOB-6, FA-MOB-17).
- **Auth model and listener:** any new authentication or identity model, any listener beyond `127.0.0.1`, device pairing, a change to approval semantics, or STOP from the phone (FA-MOB-3, FA-MOB-4, FA-MOB-7, FA-MOB-8).
- **Protected files:** any protected-file change or trust-root reseal (FA-MOB-6, FA-MOB-9, FA-MOB-10, FA-MOB-11, FA-MOB-12, FA-MOB-23). Builders may not modify protected paths (`config/protected-paths.json:4-157`, `:162`).
- **CI:** any CI workflow, or any change to the merge-gate required contexts or the ruleset (FA-MOB-13).
- **Dependencies:** root `package.json`, `package-lock.json` or `.npmrc`; any mobile dependency tree or lockfile; any Gradle or Maven artifact source (FA-MOB-12, FA-MOB-14).
- **External services and accounts:** a VPN or overlay network, a push provider, an LLM provider, a GitHub token, a Play or Android developer account, a device farm (FA-MOB-2, FA-MOB-15, FA-MOB-18, FA-MOB-19, FA-MOB-20, FA-MOB-22).
- **Signing:** APK release signing keys and their custody (FA-MOB-20).
- **Paid resources:** any paid resource of any kind.
- **Voice:** microphone capture or speech-to-text (FA-MOB-16).
- **Host configuration:** a headless or service mode, or a Windows firewall rule (FA-MOB-21).
- **Not grantable at all under this record:** a cloud relay, or any cloud service that stores or forwards UASCO state or commands. The decision itself excludes these as a second backend and a second Project Memory.
- **Dev shortcut:** the development-only `adb reverse` path. It would put a full-authority control token on a phone. It is research-inferred and was not run (UNVERIFIED).
- **Cloud production:** any change to Cloud production, or stopping it.

## 3. Relation to existing authority and inventory

- **D-2026-10-19-A:** its READY rule covers only `apps/desktop/renderer/**`, the registered tests and `docs/ux` (`FD-2026-10-19-MAX-CLOUD-PRODUCTION.md:57-67`, rule 1 at `:61`). It explicitly excludes new endpoints, protected files, policy, trust-root and allow-list changes, and paid resources (`:30-35`).
- **Dispatch rule:** `docs/planning/dispatch.mjs:95-109` selects a task only if it is READY, owned by CLOUD, has a non-blank authorizedBy, has all dependencies DONE, and has `protectedEdit===false` and `requiresNewAuthority===false`. MOB backlog entries must therefore stay non-READY with `requiresNewAuthority:true` and owner FOUNDER.
- **Existing gate:** `docs/planning/BACKLOG_CHECKPOINT.json:245-256` (FD-REL-1-GATED-SET) already lists WP-MOBILE-COMPANION as owner FOUNDER, BLOCKED, risk 5.
- **Inventory:**
  - G-SCR-MOBILE has 18 members (`docs/inventory/2026-10-19/dependency-map.json:898`): UI-097..104, UI-173..180, UI-249 and UI-250.
  - Every member has frontend NONE, backend NONE and status AUTHORITY_REQUIRED (`docs/inventory/2026-10-19/SCREEN_AUDIT_252.csv:98-105, 174-181, 250-251`).
  - UI-144 (`SCREEN_AUDIT_252.csv:145`) belongs to F-LAB-02 Mobile Device Lab, which is AUTHORITY_REQUIRED and NOT_DELIVERABLE (`docs/inventory/2026-10-19/MASTER_WORK_INVENTORY.md:126`).
- **FD-REL-1 mismatch:**
  - The mobile inventory rows name FD-REL-1 as the blocker. In code, FD-REL-1 is the sandbox / no-host-execution gate (`apps/control-api/src/server.ts:245`).
  - Whether this decision clears that blocker is UNVERIFIED. This record settles only platform, technology and location scope.
  - This record does not edit the dated 2026-10-19 inventory.

## 4. Current-state facts that constrain the design

**Transport**
- Both entry points listen on `127.0.0.1` only (`apps/control-api/src/server.ts:736-739`; `apps/control-api/src/packaged-entry.ts:79`).
- An `onRequest` hook returns 421 unless the Host header is exactly `127.0.0.1:<port>` (`server.ts:97-98`; `automation/lib/control-boundary.mjs:8,29`).
- Traffic is plain HTTP (`server.ts:66`). The only runtime dependencies are ajv, ajv-formats and fastify (`package.json:38-42`), so there is no TLS, CORS or rate limiting.
- In the installed app the port is random (`apps/desktop/main.mjs:279,288`). The backend exits when the desktop app's stdin closes (`packaged-entry.ts:74-77`).
- A phone cannot reach the API as built.

**Identity**
- Authentication is one shared `x-uasco-control-token` (`server.ts:70,77,99-101`). It is regenerated at every launch (`main.mjs:14`) and delivered over stdin (`main.mjs:295`).
- Every request runs as the fixed actor `FOUNDER_LOCAL` in tenant `local` (`server.ts:156`).
- There is no device identity, scope, expiry or revocation.
- `/health` is unauthenticated and returns an HMAC proof derived from the token (`server.ts:104`; `control-boundary.mjs:22-25`).

**Authority gate**
- `workosPolicy` hard-codes actionClass MUTATION, `production:false`, `reversible:true` and an all-true policy context (`server.ts:164-167`).
- As a result, no route ever reaches the approval classes. The inventory records this as PT-035, AUTHORITY_REQUIRED (`MASTER_WORK_INVENTORY.md:279`).
- `ApprovalAttestation` has no signature, nonce, single-use record or maximum lifetime (`core/authority/approval.ts:2-10,19-38`).
- The mission transition body is only `{to, reason}` (`core/workos/schemas.ts:49-52`). It carries no expected state, item digest or idempotency key.
- `/v1/control/stop`, `/resume` and `/retry-blocked` bypass `workosWrite` and need only the token (`server.ts:142-152`).
- GLOBAL_STOP is local. The cloud routines do not read local state ("Neither reads local state", `docs/cloud-production/CLOUD_MIGRATION_MANIFEST.md:22`).

**Data and feeds**
- There is no SSE, WebSocket or notification endpoint (research grep found no match).
- The journal sequence number exists (`core/workos/store.ts:131`, `lastSeq` getter) but is not exposed.
- `/v1/work-runs` and `/v1/projects` are unpaginated and return full objects (`docs/inventory/2026-10-19/FRONTEND_BACKEND_MATRIX.csv` lines 60, 146).
- The approval inbox is derived only in the desktop client (`apps/desktop/renderer/work-core.js:294-313`).
- The mission create schema accepts `testCommand` (`core/workos/schemas.ts:36-40`).

**Project Memory**
- There is no API, store or screen. I-DP-039 is DESIGN_ONLY (`MASTER_WORK_INVENTORY.md:219`).
- The canonical sources are Git, the repository and `.ai/` (`ARCHITECTURE-CONSTITUTION.md:34-36`). The Work OS journal is the only store the API reads.
- So the phone may read only through the Control API, and may hold at most a read-only cache.

**Repository integration**
- `apps/mobile/**` matches no protected path or merge-gate floor entry (`config/protected-paths.json:4-157`; `docs/planning/merge-gate.mjs:15-29`). The exact-match rule at `merge-gate.mjs:206` is research-reported.
- A naive scaffold would still collide with existing checks:
  - Root `tsconfig.json` includes `apps/**/*.ts` and has no exclude (`tsconfig.json:17-22`).
  - The TR-comment and secret-sanity walkers skip `node_modules/` and `build/` only at the repository root (`scripts/validate-tr-comments.mjs:5,7`; `scripts/secret-sanity.mjs:13,16`).
  - The supply-chain and change guards read only the root lockfile (`automation/lib/supply-chain.mjs:14`; `automation/lib/change-guard.mjs:13-14`; `scripts/dependency-supply-chain.mjs:3-5`).
  - The supply-chain policy allows only `registry.npmjs.org` (`config/supply-chain-policy.json:4`).
  - CI runs only the root install plus explicit test lists (`.github/workflows/ci.yml:31-41`; `config/validation.json:263-445`).
  - The merge gate trusts only `validate (ubuntu-latest)` and `validate (windows-latest)` from `ci.yml` (`merge-gate.mjs:10,31`).
  - Every new `tests/*.test.ts` must be registered (`tests/pkg-vs-validation-sharding.test.ts:13-27`).
- Root `.gitignore` does not ignore `*.keystore`, `*.jks`, `.gradle`, `local.properties` or `google-services.json` (`.gitignore:2-15`).
- The repository is PUBLIC (PT-012, `MASTER_WORK_INVENTORY.md:256`).
- Every relevant `knowledge/technologies` entry is NOT_RESEARCHED and NOT_CERTIFIED. The activation rule requires researched and certified facets (`knowledge/technologies/react-native.json:118`).
- No knowledge entries exist for FCM, Android Keystore, BiometricPrompt or SpeechRecognizer (directory listing, research).

## 5. API-fit summary

Each function also depends on the transport and identity work: FA-MOB-2, FA-MOB-3 and FA-MOB-4.

| Fn | Existing (read / write) | Gap | PROPOSED | Authority |
|---|---|---|---|---|
| F1 Dashboard | `GET /v1/cockpit` (`server.ts:728-731`); `/v1/control/status` (`:120`); `/health` (`:104`) | No run counts by status. Delivery decisions are derived only in the client. No change marker (`store.ts:131` not exposed). Orchestrator block probably UNAVAILABLE in the installed app (UNVERIFIED) | `GET /v1/mobile/summary` with ETag or since-cursor | FA-MOB-5, FA-MOB-6 |
| F2 Multi-project | `GET /v1/projects` (`:194`); `/v1/missions?projectId` (`:207-210`); `/v1/deliveries` (`:287-290`) | No per-project rollup, no pagination, single tenant (`:156`), no server-side scope (UI-180) | `GET /v1/mobile/projects?cursor&limit` | FA-MOB-5, FA-MOB-6 |
| F3 Agents/workers | `/v1/agents` (`:110-113`); `/v1/roles` (`:549-571`); `cockpit.workforce` (`:710-723`); `/v1/crew/:id` (`:592-601`); lease fields (`core/workos/types.ts:131-143`) | No liveness or stuck-lease flag. Cloud sessions invisible. `GET /v1/system/executors` writes `settings.json` (MATRIX line 142), so it must be excluded | `GET /v1/mobile/workers` | FA-MOB-5, FA-MOB-6 |
| F4 Tasks/workflow | missions, work-runs, predev, crew reads (`:207-282`, `:587-601`) | `tasks[]` always empty (`store.ts:570`; MATRIX line 59). Work-runs unpaginated with full evidence (MATRIX line 146) | `GET /v1/mobile/runs`; `GET /v1/mobile/missions/:id/timeline` | FA-MOB-5, FA-MOB-6 |
| F5 Approve/reject | `POST /v1/missions/:id/transition` with `{to, reason}`; delivery prepare/accept (`:295-315`); inbox computed in the client | No expected state, digest, nonce, device binding or server-side queue. PT-035. Unsigned attestation | `GET /v1/mobile/inbox`; `POST /v1/mobile/approvals/challenge`; `POST /v1/mobile/approvals/:itemId/decision` (device-signed) | FA-MOB-4, FA-MOB-6, FA-MOB-7, FA-MOB-9 |
| F6 Push | None. Audit file `control-api-events.jsonl` is not served (`server.ts:78`) | No feed, no stream, no sender | `GET /v1/mobile/changes?since`; `GET /v1/mobile/notifications`; push-token register/delete; content-free sender inside the same process | FA-MOB-5, FA-MOB-6, FA-MOB-15 |
| F7 Voice/assistant | None. `POST /v1/founder/commands` does not exist (SCREEN_AUDIT line 5). `POST /v1/missions` creates an inert DRAFT (`store.ts:548`) but accepts `testCommand` | No drafts, no assistant, no STT | `POST/GET /v1/mobile/drafts`; `POST /v1/mobile/drafts/:id/promote` (step-up, `testCommand` forbidden); read-only Q&A | FA-MOB-16, FA-MOB-17, FA-MOB-18 |
| F8 CI/QA/Security | `/v1/reviews` (`:637-659`); `/v1/evidence` (`:440-458`); work-run evidence kinds; `cockpit.evidence` (`:724-727`) | GitHub Actions CI not served (no GitHub client; `CLOUD_MIGRATION_MANIFEST.md:28`). Some evidence UNAVAILABLE in the installed app, and every request re-hashes all evidence (MATRIX line 147) | `GET /v1/mobile/reports`; optional `GET /v1/ci/status` (proxy or cloud-published report) | FA-MOB-5, FA-MOB-6, FA-MOB-19 |
| F9 Ops/recovery | `/v1/control/status` journal health (`:120`, `:661-667`); run recovery statuses (`types.ts:67-69`); stop/resume/retry-blocked (`:142-152`) | No per-scope stop, no blast-radius preview, no quarantine view. STOP is local only. RESUME has no extra check | `GET /v1/mobile/ops`; `POST /v1/mobile/control/stop` (step-up). Resume and torn-tail repair stay desktop-only | FA-MOB-6, FA-MOB-8 |
| Project Memory | None (DESIGN_ONLY, `MASTER_WORK_INVENTORY.md:219`) | Not defined anywhere | Nothing until the desktop/backend defines it | Founder decision (open question) |

## 6. Security conditions that must hold before coding

These conditions are proposed. They become binding only when the Founder accepts them as part of FA-MOB-1.

- **SC-1** The phone never holds the desktop control token. Mobile uses only a per-device credential issued at pairing. Pairing is started from the desktop (physical presence), uses a single-use secret, and needs FA-MOB-4.
- **SC-2** No listener beyond `127.0.0.1` exists until all of the following exist: TLS with a pinned certificate; per-device authentication; a mobile route allow-list in a protected location; rate limits on pairing and authentication; and audit of allowed and denied calls that records the device id. `/health` is not exposed on the mobile listener.
- **SC-3** The mobile allow-list excludes:
  - file content, git diff, raw logs and exports
  - project import, executor enable/settings, dev-runs and journal repair
  - company finance and legal writes
  - mission creation with `testCommand`
- **SC-4** Every mobile approval is bound to all of the following:
  - a request created by the server
  - `expectedStatus` and `itemDigest`
  - a single-use nonce
  - a short maximum lifetime enforced by the server
  - a signature from a non-exportable Android Keystore key that requires biometric unlock
  The server records consumption in the hash-chained Work OS journal (`store.ts:194-203`) with the device id as actor.
- **SC-5** PT-035 (`server.ts:164-167`) is fixed before any approve centre is built. R3/R4 decisions, COMPLETE, delivery acceptance and finance/legal classes stay desktop-only unless the Founder grants otherwise.
- **SC-6** STOP is allowed from the phone only with step-up and a required reason. RESUME stays desktop-only unless granted. The UI states that STOP halts only local Work OS and dev-runs, not Cloud production.
- **SC-7** No second backend or store. The phone keeps only an encrypted read-only cache labelled STALE. Nothing is queued offline for later sending: no approvals and no STOP.
- **SC-8** Push messages carry no content, only an opaque reference. Lock-screen visibility is private. Provider credentials never enter the public repository.
- **SC-9** Voice:
  - Speech-to-text runs on the device only and fails closed when it cannot.
  - Transcripts are untrusted PII and stay LOCAL (`core/policy/data-routing.ts:5-18`).
  - Voice may create only inert drafts. It can never approve, and it can never set `testCommand`.
- **SC-10** Free text is never parsed as authority. This covers titles, reasons and PR text. Free text is shown with its provenance (`core/authority/autonomous-authority.mjs:214-215`).
- **SC-11** Keystores, `google-services.json`, pairing secrets and the device registry are never committed. A nested `apps/mobile/.gitignore` exists before the first scaffold commit.
- **SC-12** Mobile dependencies are governed before any of them enters the repository:
  - exact pins
  - `ignore-scripts`
  - an audit gate
  - lockfile integrity
  - Gradle dependency verification and a wrapper checksum
- **SC-13** No validator, typecheck or scan is silently weakened. Any scoping change for `apps/mobile` is an explicit, Founder-authorised protected edit followed by a reseal.
- **SC-14** These security-boundary files are added to protected paths before they are changed: `packaged-entry.ts`, `core/authority/approval.ts`, `core/action-gateway/policy.ts`, and the new gateway and auth modules.
- **SC-15** The Founder holds the release signing key. The template's public debug keystore is never used for a release. The signing job never runs on `pull_request`.
- **SC-16** Technology knowledge for the chosen stack is researched, with pinned versions, before primary implementation (`react-native.json:118`).

## 7. Remote connectivity options (Founder choice, FA-MOB-2)

- **A. Same-LAN + desktop QR pairing + pinned self-signed TLS.**
  - No outside service.
  - Lowest exposure.
  - Unusable away from home.
- **B. User-run VPN or overlay network** (Tailscale-like, or self-hosted WireGuard), with the same app-level authentication as A.
  - Works from anywhere without a public port.
  - Needs an outside account, or a network change such as port-forwarding and dynamic DNS.
- **C. Public tunnel.** Not recommended: the endpoint is public and the provider can usually see TLS-terminated traffic.
- **D. Cloud relay.** Excluded by the decision itself.

In every option the PC must be on and the backend must be running. Today that means the desktop app is open (`packaged-entry.ts:74-77`), unless FA-MOB-21 grants a headless mode. While the PC is off, the phone shows only a STALE cache and cannot STOP or approve anything.

## 8. Technology and build baseline (external facts, UNVERIFIED in the repository)

These facts were reported by the 2026-10-20 research. They came from npm registry metadata and GitHub-hosted sources through the agent proxy. None of them is repository evidence. All must be re-verified and pinned by MOB-9 before use, and this record does not pin, certify or approve any of them.

- **React Native:** 0.88.0 is the npm `latest` tag, published 2026-10-15. The previous line is 0.87.1.
- **0.88 template:**
  - Android: minSdk 24, compileSdk 37, targetSdk 36.
  - Build tools: AGP 9.2.1, Gradle 9.4.1, Kotlin 2.2.0, NDK 27.1.12297006.
  - Runtimes: JDK 17; Node `^22.13 || ^24.3`, which is compatible with the repo's Node 24 (`package.json:7-9`; `.github/workflows/ci.yml:29`).
- **Template hygiene:**
  - The template ships `ios/` and a public `debug.keystore`.
  - Its release build type signs with the debug key.
  - For Android-only, `ios/` and the iOS tooling must be removed.
- **Build path:** bare RN CLI with a local Gradle build. No EAS, because even `eas build --local` needs an Expo login.
- **Tests:**
  - Unit/component: Jest 29.7.0, pinned because the preset depends on Jest 29, plus RN Testing Library 14.1.0.
  - End-to-end: Maestro on a KVM emulator on a free standard Linux runner.
  - Detox officially supports only RN 0.77-0.84.
- **Secure storage:** Android Keystore, for example through react-native-keychain 10.0.0. EncryptedSharedPreferences is deprecated.
- **Approval signing:** probably needs a small custom Kotlin TurboModule using BiometricPrompt with a CryptoObject.
- **Push options:**
  - FCM: needs a Firebase project, `google-services.json` and an HTTP v1 service credential.
  - UnifiedPush: no maintained RN binding was found.
  - Polling plus WorkManager: minimum interval 15 minutes.
- **Speech:** Android SpeechRecognizer may stream audio to remote servers. An on-device recognizer exists from API 31.
- **CI runner:** pin `ubuntu-24.04` with JDK 17, because `ubuntu-latest` moves to 26.04 (default JDK 25) in November 2026.

## 9. Authority list

| Id | Item | Kind | Risk | Blocks |
|---|---|---|---|---|
| FA-MOB-1 | Founder confirmation of this decision through a non-agent channel, plus an `apps/mobile/**` build-scope / READY rule (D-2026-10-19-A does not cover it) | GOVERNANCE | 2 | MOB-11..MOB-31 |
| FA-MOB-2 | Remote connectivity model: LAN-only, user-run VPN, or none (cloud relay excluded) | EXTERNAL_SERVICE | 4 | MOB-18, MOB-20, MOB-21, MOB-22, MOB-24..MOB-29 |
| FA-MOB-3 | TLS mobile gateway listener inside the existing Control API process: non-loopback bind, Host policy, certificate pinning, new selftests | AUTH_MODEL | 5 | MOB-18 |
| FA-MOB-4 | Device pairing, device registry, per-device sessions and scopes (read / stop / approve), revocation, device id as audit actor | AUTH_MODEL | 5 | MOB-17, MOB-19, MOB-20 |
| FA-MOB-5 | New read-only `/v1/mobile/*` projections (summary, projects, workers, runs, timeline, reports, ops, changes, notifications) | NEW_API | 4 | MOB-16, MOB-22, MOB-26, MOB-29 |
| FA-MOB-6 | Protected edits: `server.ts` route registration and per-request principal; mobile allow-list under `automation/lib/`; allow-list selftests; trust-root reseal | PROTECTED_FILE | 4 | MOB-16, MOB-17, MOB-18, MOB-22, MOB-23, MOB-25..MOB-29 |
| FA-MOB-7 | Signed single-use approvals: extend `approval.ts`; fix PT-035; server inbox with `expectedStatus` and `itemDigest`; the set of decision classes allowed from the phone; the Founder identity in `trustedApproverIdentityIds` | AUTH_MODEL | 5 | MOB-23, MOB-24 |
| FA-MOB-8 | Remote STOP from the phone, and whether RESUME is allowed from it | AUTH_MODEL | 5 | MOB-25 |
| FA-MOB-9 | Add `packaged-entry.ts`, `core/authority/approval.ts`, `core/action-gateway/policy.ts` and the new gateway/auth modules to protected paths; reseal | PROTECTED_FILE | 4 | MOB-15 (and through it MOB-17, MOB-18, MOB-23) |
| FA-MOB-10 | `tsconfig.json` exclude for `apps/mobile/**`; scoping of root test discovery; `config/validation.json` registration of mobile contract tests; reseal | PROTECTED_FILE | 3 | MOB-11 |
| FA-MOB-11 | TR-comment and secret-sanity walkers: skip nested `node_modules`, `android/**/build`, `.gradle` and `.cxx`; add keystore and Firebase-key patterns; committed-source scanning must not weaken | PROTECTED_FILE | 3 | MOB-11 |
| FA-MOB-12 | Supply-chain governance for the `apps/mobile` lockfile (supply-chain, change-guard, package-policy, audit), `apps/mobile/.npmrc`, and admission of the RN dependency tree | PROTECTED_FILE | 4 | MOB-12, MOB-13, MOB-20, MOB-22, MOB-24, MOB-27, MOB-28 |
| FA-MOB-13 | Mobile CI workflow (new workflow file or job), merge-gate `REQUIRED_CONTEXTS`, GitHub ruleset (owner action) | CI_WORKFLOW | 3 | MOB-14, MOB-30 |
| FA-MOB-14 | Build-time egress for the Android toolchain (services.gradle.org, Google Maven, Maven Central, SDK/NDK, Maestro release) with checksums and dependency verification | EXTERNAL_SERVICE | 3 | MOB-12, MOB-13, MOB-14 |
| FA-MOB-15 | Push provider (FCM, UnifiedPush or none), credential custody, content-free payload policy | EXTERNAL_SERVICE | 4 | MOB-27 |
| FA-MOB-16 | Voice privacy: RECORD_AUDIO permission, on-device speech-to-text only, no audio storage, transcripts kept LOCAL | PRIVACY | 3 | MOB-28 |
| FA-MOB-17 | Voice/text draft endpoints, with promotion only through step-up and `testCommand` forbidden | NEW_API | 4 | MOB-28 |
| FA-MOB-18 | AI assistant LLM provider egress (cost, read-only, no write tools, DLP) | PAID_OR_ACCOUNT | 4 | MOB-29 |
| FA-MOB-19 | CI/PR status source: GitHub read-only token on the host, or a report published from the cloud side | EXTERNAL_SERVICE | 3 | MOB-26 (CI part) |
| FA-MOB-20 | Release signing-key custody and distribution channel (sideload, limited distribution or Play) | PAID_OR_ACCOUNT | 4 | MOB-30 |
| FA-MOB-21 | Host configuration: headless or service mode for the Control API; Windows firewall rule | HOST_CONFIG | 3 | MOB-18 |
| FA-MOB-22 | Physical-device or paid device-farm testing (UI-144, F-LAB-02) | PAID_OR_ACCOUNT | 2 | MOB-31 |
| FA-MOB-23 | Desktop pairing QR and device management UI in protected `main.mjs`, `preload.mjs`, `renderer/app.js` and `index.html` | PROTECTED_FILE | 4 | MOB-19 |

## 10. Work-package order

Phases run in this order. A package starts only when its grants exist and its dependencies are DONE.

| Phase | Packages | Status |
|---|---|---|
| 0 Docs/spec (no new authority; no protected, renderer, BACKLOG or dispatch files) | MOB-0 decision record; MOB-1 threat model and security conditions; MOB-2 connectivity and pairing design; MOB-3 mobile API contract spec; MOB-4 approval and STOP design; MOB-5 RN architecture ADR; MOB-6 read-screen specs; MOB-7 action/security/voice screen specs; MOB-8 test/build/release strategy; MOB-9 technology knowledge research | DRAFT_NOT_READY |
| 0b Backlog registration | MOB-10 (delivered in the same coordinator write-back PR as this record) | IN THIS PR |
| 1 Repo guards | MOB-11 validators/typecheck scope; MOB-12 supply-chain governance; MOB-15 protect boundary files | AUTHORITY_REQUIRED |
| 2 Scaffold and CI | MOB-13 Android-only scaffold with mock data; MOB-14 mobile CI job | AUTHORITY_REQUIRED |
| 3 Server read models and identity | MOB-16 read projections (loopback, inject tests); MOB-17 pairing and sessions; MOB-18 TLS gateway; MOB-19 desktop pairing UI | AUTHORITY_REQUIRED |
| 4 App read surfaces | MOB-20 app security shell; MOB-21 monitoring screens; MOB-22 notification feed and alarms; MOB-26 reports | AUTHORITY_REQUIRED |
| 5 Write paths | MOB-23 server approval centre with PT-035 fix; MOB-24 approval client; MOB-25 mobile STOP | AUTHORITY_REQUIRED |
| 6 External services | MOB-27 push; MOB-28 voice drafts; MOB-29 assistant | AUTHORITY_REQUIRED |
| 7 Release and lab | MOB-30 release signing and distribution; MOB-31 real-device runs | AUTHORITY_REQUIRED |

## 11. Screen mapping

| Screen | Title (inventory) | Fn | Spec | Build |
|---|---|---|---|---|
| UI-097 | Mobil Ana Sayfa | F1 | MOB-6 | MOB-16, MOB-21 |
| UI-098 | Mobil Onay Gelen Kutusu | F5 | MOB-7 | MOB-23, MOB-24 |
| UI-099 | Mobil Görev Akışı | F4 | MOB-6 | MOB-16, MOB-21 |
| UI-100 | Mobil Bildirimler | F6 | MOB-7 | MOB-22 (in-app), MOB-27 (push) |
| UI-101 | Mobil Sesli Taslak | F7 | MOB-7 | MOB-28 |
| UI-102 | Mobil Ajan Takibi | F3 | MOB-6 | MOB-16, MOB-21 |
| UI-103 | Mobil Şirket Özeti | F1/F2 | MOB-6 | MOB-16, MOB-21 |
| UI-104 | Mobil Güvenli Profil | security | MOB-7 | MOB-17, MOB-20 |
| UI-144 | Mobil Gerçek Cihaz Koşusu | lab | MOB-7 | MOB-31 |
| UI-173 | Mobil Güvenli Cihaz Eşleştirme | security | MOB-7 | MOB-17, MOB-19, MOB-20 |
| UI-174 | Mobil Biyometrik Kilit | security | MOB-7 | MOB-20 |
| UI-175 | Mobil Kritik Onay Ayrıntısı | F5 | MOB-7 | MOB-23, MOB-24 |
| UI-176 | Mobil STOP_ALL Güvenli Akışı | F9 | MOB-7 | MOB-25 |
| UI-177 | Mobil Ağ Kesintisi / Çevrimdışı | F9 | MOB-6 | MOB-21 |
| UI-178 | Mobil Ajan Alarm ve Olay İnceleme | F3/F9 | MOB-6 | MOB-22 |
| UI-179 | Mobil Ses Gizliliği ve İzin | F7 | MOB-7 | MOB-28 |
| UI-180 | Mobil Scope / Proje Değiştirme | F2 | MOB-6 | MOB-21 |
| UI-249 | Mobil Companion Session Sürdürme | security | MOB-6 | MOB-17, MOB-20 |
| UI-250 | Mobil Sesli Komut ve Bekleyen Taslak | F7 | MOB-7 | MOB-28 |

- **No screen ID yet:** F8 reports (MOB-26) and the F7 assistant (MOB-29) have no mobile screen ID in the inventory (GAP).
- **UI-177 conflict:** its design note says "offline queue" (`SCREEN_AUDIT_252.csv:178`). This conflicts with SC-7 and is a Founder question.

## 12. In-flight work this plan avoids

- **Files touched by phase 0:** MOB-0..MOB-9 add new files only, under `docs/planning/authority/` (MOB-0), `docs/mobile/**` (MOB-1..MOB-8), and `knowledge/technologies/` plus `registries/technologies.json` (MOB-9). They touch no `apps/desktop/renderer/**`, no `BACKLOG_CHECKPOINT.json`, no `dispatch.mjs`, no `merge-gate.mjs` and no protected file.
- **Backlog state:** the PR that adds this record also writes back UI-047 and UI-201 as DONE (merged in `0d0b2b9`), reconciles the stale IN_REVIEW entries of the 2026-10-19T20:45Z snapshot against git ancestry, and records the P0 blocker DESIGN-EVIDENCE-UNAVAILABLE. UI-025 and UI-133 are claimed by the heartbeat dispatcher and have open draft PRs (#83, #84). MOB entries never compete with them because none is READY.
- **PR #75:** the coordinator named it. Open PRs cannot be discovered from repository content (`docs/planning/DISPATCH.md:54`), and no MOB package touches `dispatch.mjs`.
- **MOB-10:** must be serialized with the coordinator's next `BACKLOG_CHECKPOINT.json` write-back and never run in parallel with it.
- **MOB-19 and MOB-23:**
  - MOB-19 touches renderer and protected desktop files.
  - MOB-23 changes `workosPolicy`, which also affects desktop writes.
  - Schedule both only when no renderer lane holds the same files.

## 13. UNVERIFIED items

- Whether this decision clears the FD-REL-1 blocker named in the G-SCR-MOBILE rows.
- That the orchestrator block of the cockpit is always UNAVAILABLE in the installed app.
- The `adb reverse` dev path, and whether Host and token checks pass through it (not run).
- Whether npm honours the root `.npmrc` when run inside `apps/mobile`.
- Whether root vitest picks up `apps/mobile` tests, and the substring-filter collision in CI shards (inferred, not executed).
- Whether a `.ts` file importing `.tsx` breaks the root `tsc` run (inferred).
- Whether a nested `.gitattributes` handles `gradlew.bat` correctly.
- Whether Metro `watchFolders` can import renderer cores.
- Whether Network Security Config matches IP-literal hosts.
- Whether AGP 9.2.1 needs KGP 2.2.10 against the template's Kotlin 2.2.0.
- Whether the NDK is auto-downloaded.
- CI build and emulator duration.
- FCM cost.
- Whether the founder's region is subject to developer verification before 2027.
- Every external version and tooling fact in section 8.

## 14. Open questions for the Founder

Questions 1, 2, 3, 4, 5, 8, 9, 10, 12 and 15 decide the order of work.

1. Connectivity for v1: same-Wi-Fi LAN pairing only (no outside service), a user-run VPN (which provider, or self-hosted WireGuard), or nothing beyond USB/emulator development? A cloud relay is excluded by your decision.
2. Should the phone work only while the desktop app is open (today the backend exits with it: apps/control-api/src/packaged-entry.ts:74-77), or do you want a headless/service mode on the PC (FA-MOB-21)?
3. Which decisions may be made from the phone: FOUNDER_ATTENTION_REQUIRED retry/reject, PREFLIGHT to AUTHORIZED, delivery acceptance, retry-blocked? Do R3/R4 risk, COMPLETE and every finance/legal class stay desktop-only?
4. Is STOP allowed from the phone with biometric step-up? Is RESUME ever allowed from the phone, or desktop-only?
5. Should PT-035 (the permissive policy context at apps/control-api/src/server.ts:164-167) be fixed as its own package before any approval centre work starts?
6. Which identity record is authoritative for mobile approvals in trustedApproverIdentityIds? Only a proposed policy exists (docs/authority/autonomous-authority-policy.proposed.json:8,11).
7. Approval parameters: the maximum lifetime of a mobile approval challenge (minutes), and is a rejection also signed and journaled?
8. Push: is Firebase Cloud Messaging acceptable (Google account dependency, metadata leaves the device), or UnifiedPush/self-hosted, or no push in v1 (in-app polling only)?
9. Voice: on-device speech recognition only, failing closed otherwise? What is the minimum Android version? This decides on-device STT (API 31+) and hardware-backed Keystore.
10. AI assistant: is it in v1 at all? If yes, which LLM provider, what cost ceiling, and limited to read-only Q&A plus pending drafts?
11. CI reports: should the PC read GitHub Actions with a read-only token you issue, or should Cloud production publish a CI report into the repo or journal? Should the phone show anything while the PC is off besides a STALE cache?
12. Where will canonical Project Memory live? It is DESIGN_ONLY today (docs/inventory/2026-10-19/MASTER_WORK_INVENTORY.md:219). Until it exists the mobile app cannot show it.
13. Does this decision clear the 'FD-REL-1' blocker named in the 18 G-SCR-MOBILE inventory rows (in code FD-REL-1 is the sandbox gate, server.ts:245)? Should the inventory be re-baselined?
14. Is UI-144 (real-device runs, F-LAB-02) in scope, and may physical devices or a paid device farm be used?
15. Do you want a READY rule for apps/mobile/** similar to D-2026-10-19-A? If so, for which package classes (e.g. docs-only MOB-0..MOB-9 and later mock-data UI)?
16. React Native version: pin 0.88.x (released 2026-10-15, five days old) or 0.87.1? Bare React Native only, or bare RN plus the Expo Modules runtime (no EAS) for secure-store, local-authentication and speech-recognition?
17. apps/mobile as a standalone npm project with its own lockfile and an extended supply-chain guard (recommended), or root npm workspaces (blocked today: 'workspaces' is a protected field, config/package-policy.json)?
18. Mobile CI: a separate workflow file or a job in the protected ci.yml, pinned to ubuntu-24.04? Which check name becomes merge-gating?
19. Distribution: debug APK sideload to your device only, an Android developer limited-distribution account, or Google Play internal testing? Who generates and backs up the upload signing key, and should Play App Signing be used?
20. Will mobile dependencies ever be installed in the supervisor or local working tree? If yes, the protected scanner-scope fix (FA-MOB-11) must land before the first scaffold.
21. Should the mobile app vendor copies of the desktop renderer's pure logic modules with a parity test (recommended, no coupling), or import them read-only (coupled to every renderer PR)?
22. UI-177's design note mentions an 'offline queue'. Do you confirm that nothing (approvals, STOP) is ever queued offline for later sending?
23. F8 reports and the AI assistant have no mobile screen IDs in the inventory. Should new IDs be created?
24. Should the MOB backlog entries ride in the coordinator's next BACKLOG write-back PR (Writeback-5), or a separate PR serialized after it? Coordinator choice (the Founder may override): they ride in Writeback-5, the PR that adds this record, because a second PR would conflict on `BACKLOG_CHECKPOINT.json`.
25. May a development-only path (adb reverse to a dev-mode API with a dev token) be used for local UI work before the gateway exists? It would place a full-authority token on a test device.
