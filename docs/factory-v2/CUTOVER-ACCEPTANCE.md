<!-- //TR: Factory V2 canlı geçiş kabul koşulları: Founder'ın "tek ana yönetim oturumu" yönergesi dahil, devir öncesi karşılanması gereken her koşulun bugünkü gerçek durumu ve kanıtı. Durum NOT_MET olan tek bir koşul bile bridge prepare / drain ack / commit adımlarını yasaklar; yerel süreçler gerçek Cloud oturumu sayılmaz. -->
# Factory V2 live cutover — acceptance conditions

**Status:** Factory V2 is NOT live. V4.1 (`session_015dYwazi7LHFCg3dABbSW2P`) is the only execution authority.

**Rule:** do not run `bridge prepare`, drain ack or `bridge commit` while any condition below is `NOT_MET` or `PARTIAL`. A separate Founder cutover decision is also required.

While V4.1 is authoritative, **no second live Supervisor is created.** V2 sessions may run only in SHADOW mode or in a probe namespace.

**What counts as evidence:**
- Each row needs evidence from real Claude Cloud sessions. Local child processes (`LocalProcessExecutor`) prove the mechanics only, never the cloud condition.
- Status values: `MET` (verified with evidence), `PARTIAL` (implemented, not verified live) and `NOT_MET`.

## A. Atomic, signed handover

| # | Condition | Status | Evidence / gap |
|---|---|---|---|
| A1 | Signed, hash-chained authority record on a protected shared registry; CAS and fencing verified by two real Cloud sessions | MET (probe namespace) | `PROTECTED-REGISTRY-EVIDENCE.json`: ruleset `UASCO-REGISTRY-PROTECTION`, linear fast-forward CAS, lease A→B at epoch 2, stale lease fenced, stale write refused |
| A2 | Canonical role keyring holds only public keys of the real V41_OWNER, V2_CANDIDATE and FOUNDER holders | NOT_MET | `docs/planning/authority/FACTORY-V2-ROLE-KEYS.json` is empty (PR #356). Each holder runs `bridge keygen` in its own container; the private key goes to a new 0600 file outside any git tree. Only the printed public entry is added, through a Founder-approved PR |
| A3 | The V4.1 merge path refuses merges once authority is not V41_AUTHORITATIVE | PARTIAL | PR #355 (`executor.mjs` fence through `v41-guard` `mergeAuthority`) is stacked on #347 and not merged |
| A4 | V4.1 new-work dispatch stops at handover | NOT_MET | `bridge.v41MayDispatch()` exists, but the V4.1 coordinator's dispatch step does not call it in code. It must be fenced the same way as merge, through a protected governance change |
| A5 | Founder cutover record (`AUTHORIZES: FACTORY_V2_CUTOVER …`) plus a verified V4.1 drain acknowledgement | NOT_MET | Requires a Founder decision and the V4.1 session's signed drain ack (relay protocol) |

## B. Single control session (Founder directive "SINGLE CONTROL SESSION")

After cutover, the V2 Supervisor Cloud session is the only session the Founder talks to. Every other session is a background production worker bound to it.

| # | Condition | Status | Evidence / gap |
|---|---|---|---|
| B1 | After handover V4.1 has no dispatch or merge authority | NOT_MET | Needs A3 and A4 merged and verified live |
| B2 | V2 is the only authorised Supervisor (exclusive Supervisor lease + `assertV2` on every tick) | PARTIAL | Implemented and tested with local processes, and two-session lease exclusivity proven in the probe namespace. Not exercised as the live holder |
| B3 | 8 Builder, 4 Reviewer, 3 Merge Preparer and 1 Merge Writer run as **real Cloud sessions** bound to the control session (create, real session id bound, identity, lease, dispatch, crash recovery) | NOT_MET | `CloudSessionIntentExecutor` records spawn intents and binds real session ids, but there is no automated actuation loop. The 16-worker chain has not been run with real sessions; it needs separate Founder approval because of session cost |
| B4 | All Builder, Reviewer and Writer outputs are collected in the control session (results arrive back; no worker transcript reading needed) | NOT_MET | The worker → Supervisor result channel (registry result section or `send_message` to the parent, verified against the bound session id) is not implemented |
| B5 | The Founder never has to open another Cloud session to follow work | NOT_MET | Depends on B4 and B7 |
| B6 | New tasks are dispatched automatically within capacity and quota | PARTIAL | `scheduler.mjs` and `quota-governor.mjs` exist. There is no real quota telemetry yet; reported values are estimates |
| B7 | Per task, the ledger records task id, owning session, progress, PR, review, CI, merge and product evidence | PARTIAL | `StateJournal` records states, VERDICT and IMPORT. PR, CI, merge and product-evidence fields are not yet a fixed schema |
| B8 | One command produces the full current factory report | NOT_MET | `cli.mjs plan` and `evidence` exist. A single `report` (sessions, tasks, PR/review/CI/merge, quotas, blockers, Founder decisions) is not implemented |
| B9 | All domains (UI/UX, backend, desktop, mobile, QA, security, …) are managed from the same centre | PARTIAL | `topology.domainOfTask` and reviewer focus allocation cover the domains. Not exercised live |
| B10 | No task state is lost on a session or quota interruption; restart resumes from durable records | NOT_MET (cloud) | The journal is a local JSONL file, which is ephemeral in a Cloud container. Task state must also be held on the protected shared registry. Leases already are |
| B11 | Routine work uses the existing autonomy rules; Founder-tier decisions are presented from the control session only | PARTIAL | V4.1's `autonomy.mjs` classification (FOUNDER_REQUIRED, etc.) exists. V2 does not yet route its decisions through it |
| B12 | Running software, screenshots, test results and product progress are part of the main report | NOT_MET | No product-evidence collector exists yet |

## Hard blockers before live activation

1. PRs #347, #354, #356 and then #355 merged after an independent binding CLEAN review and required CI on exact HEAD/BASE.
2. A2: real public keys registered in the canonical keyring.
3. A3 + A4: V4.1 dispatch and merge fenced in code.
4. B3, B4, B8 and B10 implemented, then the full 8/4/3/1/1 real-session chain verified, including crash recovery.
5. A5: Founder cutover record and a verified V4.1 drain acknowledgement.

Only after all five does the control session run `bridge prepare` → V4.1 `ack` → `bridge commit`.
