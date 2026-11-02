<!-- //TR: UASCO kapanış denetimi kanıt dosyası — G6 ajanlar, otomasyon ve maliyet (2026-11-02, salt-okunur denetçi çıktısı) -->
# G6 - Agents, Automation, Cost, Quota, Performance (closure audit, Phases 7 and 9)

Repo `SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-` (public, default branch `v7/integration`). Audit time 2026-11-02, queries 02:45Z-03:45Z. Read-only: no push, comment, merge, label, PR, message to another session, or trigger/setting change. No vitest, no npm install. Base checkout `audit-wt` @ `0b71650fa88b9802968562c63ca33f8b56e9648b`; ledger checkout `pqw` @ `afe2f9b` (2026-11-02T03:20:53Z).

Evidence tags: **V** = I checked it against a primary source (cited). **C** = a document or the coordinator says so, not re-verified (the brief's facts are cited "COORD-VERIFIED 2026-11-02"). **E** = my estimate, method stated. **UNKNOWN** = not measurable from here. Ladder: PLANNED > DESIGNED > CODED > INTEGRATED > TESTED(unit) > VERIFIED_REAL_ENV > USABLE_BY_END_USER. `NOT_RUN_ENV_UNAVAILABLE` is never a pass.

**Cost caveat.** Every `cost_usd` below is the platform's API-equivalent figure at list price: the routine-run result event I read carries `"costBasis":"list"`, `"provider":"firstParty"` (V: `list_events` session_015dYwazh73udPPzMJ3g1DG2). It is not necessarily what was billed. The subscription plan and its caps are not visible to me (UNKNOWN). All sampled sessions report `isUsingOverage:false` (V, `get_session` rate_limit_info), so no paid overage is evidenced.

Method and coverage are in section 9; reproduction commands in section 10.

---

## 1. Headline facts

| # | Fact | Tag | Evidence |
|--:|------|-----|----------|
| 1 | Product agents: **599 TARGET roles**, 0 runtime-ready, 0 certified, 3,594 evaluation specs with 0 executed; 363 legacy agents `REGISTERED`/`ON_DEMAND`, 363/363 `NOT_EVALUATED`; 599 execution profiles are `PROPOSED_DERIVED`; **9 roles bound** (first-delivery), 0 running. Only real-environment artefact is one 32 s toy run on 2026-10-14. | V | `registries/role-definitions.json` `counts`; `registries/agents.json`; `evaluations/agents/*.json` (363 files, state counted); `registries/role-execution-profiles.json` `counts.boundRoles=9`; `audit/checkpoints/V7-PKG-B3B-LIVE-SMOKE-EVIDENCE-2026-10-14.json` (durationMs 32114) |
| 2 | Development agents: **105 sessions** in the account list (86 cloud, 19 local-bridge). Now: 2 RUNNING (coordinator, Lane C), 84 IDLE (82 untouched for 7 days or more), 19 ARCHIVED. | V | `list_sessions` page 1 (100) + `after_id` page 2 (5, no more) |
| 3 | **60 triggers**: 10 recurring + 50 one-shot reminders. Enabled now: heartbeat (every 3 h), Independent Cloud Reviewer (hourly), Cloud Development (hourly), plus one one-shot at 03:56Z. All three recurring ran successfully today after the 02:00Z reset. | V | `list_triggers` (3 pages, `has_more:false`); `last_run` fields |
| 4 | Measured session cost: coordinator **$4,481.05** (Opus 5.5, xhigh, ultracode), Lane A $212.61, Lane B $131.93, Lane C $429.60. These 4 sessions are **96.0%** of $5,476.68 measured over 28 sessions. | V | `get_session` usage.cost_usd, 2026-11-02T03:2xZ |
| 5 | Cache-read tokens are 97.3-99.2% of all tokens in the four long-lived sessions (coordinator 10.34 B cache-read vs 53.95 M output). The cost is a context-re-read tax, not output volume. | V (arithmetic) | usage fields, `g6_costs.json` |
| 6 | Coordinator spend grew from $1,129.16 (2026-10-20 16:44Z, prior audit) to $4,481.05 (+$3,351.89, 3.97x in 12.4 days). Over the GitHub-active hours in that span (about 86 h) that is about $39 per active hour. Last 55 min: +$44.65. | C start, V end, E rate | prior audit `04 ... AUDIT.md` section 7.2; `get_session` |
| 7 | Routine fires are cheap but pointless: measured $0.23 (Cloud Development, 22.7 s, result NO_ACTION against a backlog generated 2026-10-19), $0.31 (Independent Cloud Reviewer, duplicate of a coordinator review), $0.37 (heartbeat). About $16 per day if all fire on schedule (n=1 each). | V per run, E for daily | `get_session` + `list_events` on the three routine-run sessions |
| 8 | GitHub Actions: 1,740 runs, only GitHub-hosted `ubuntu-latest` and `windows-latest` (370 sampled jobs, 0 self-hosted). About **47,000 runner-minutes** (bootstrap 95% range 44.9k-54.6k rounded-up), about 83% Windows. Billable ms = 0 on 3 sampled runs because the repo is public; a private repo would need about 90,000 billable-equivalent minutes. | E (V inputs) | 110-run stratified sample of `/jobs`; `get_workflow_run_usage` x3 |
| 9 | Free Actions minutes ran out once already: on 2026-10-18 the coordinator recorded "GitHub-hosted quota 2000/2000" with jobs dying in about 5 s; CI now runs on a public repo with free hosted runners (`ci.yml` line 1, FD-PUBLIC-CI-2026-10-19). Never treat free runners as unlimited. | C (+V 215 early failures) | trigger `trig_01EJnVSL9xQzJnc4gxNnXKmH` prompt; `ci.yml` line 1; G1 sec 6.2 |
| 10 | Weekly cap pattern: activity window 1 ran 3.8 days (Oct 19 02Z - Oct 22 21Z, 79 active hours), window 2 only 1.4 days (Oct 26 02:46Z - Oct 27 11:42Z, 34 active hours), then silence until Nov 2 02:22Z. Merges per active hour were equal (2.2). | V (timeline), E (cause) | GitHub runs/merges timestamps; sessions' `seven_day allowed_warning` reset 2026-10-26T02:00Z |
| 11 | Review load: 127 ledger records on 54 PRs in 7 days (53 full, 74 delta); 45 BLOCKERS, 63 NO_BLOCKERS, 17 base-merge-only, 2 verdicts that start with ROUND_LIMIT (5 mention it). First full review of a later-merged PR returned BLOCKERS 21 of 46 times, so reviews do find defects. | V | `COORD-LEDGER.json` @ `afe2f9b` |
| 12 | No second model provider exists in code: 0 files mention OpenRouter, Groq, NVIDIA or Gemini; `models/router/router.ts` `chooseProvider` has no production caller; OmniRoute is discovery-only and nothing listens on 127.0.0.1:20128 here. All 259 merged PRs carry one author identity. | V | `git grep`; `curl` exit 7; `pulls_closed_slim.json` |

---

## 2. Phase 7A - Product agents (the 599-role catalogue)

Separate **target**, **registered**, **configured**, **usable**, **running**. Counts below are read from the registries at `0b71650`; none of the registry statuses is treated as proof.

| Stage | Count | What it means | Tag | Source |
|---|--:|---|---|---|
| TARGET | **599** roles (51 guilds, 10 clusters, lifecycle `TARGET` x599, `runtimeStatus` `UNKNOWN` x599) | Canonical inventory, "not runtime" by its own header | V | `registries/role-definitions.json` (`roles` len 599; `counts`) |
| Legacy registry | **363** agents (`REGISTERED` x363, activation `ON_DEMAND` x363); 40 departments, 18 subteams, 10 councils; 443 legacy aliases to the 599 (214 SEMANTIC_VERIFIED, 61 SUSPECTED, 133 CONFLICT, 35 REJECTED); 88 legacy ids unmapped | The old catalogue, "registered does not mean active" | V | `registries/agents.json`, `organization-hierarchy.json`, `subteams.json`, `councils.json`, `role-definitions.json` `counts.legacyAliases` |
| REGISTERED (new) | 599 (same rows) | Present in the registry | V | as above |
| CONFIGURED | **599** execution-profile proposals, all `PROPOSED_DERIVED` ("not binding, not certification"); route split CLAUDE_REVIEWER 441, CLAUDE_IMPLEMENTER 157, DETERMINISTIC_STUDIO 1; 164 with candidate tool adapters; 197 with SEMANTIC_VERIFIED legacy evidence; canonical `toolAdapterIds` = 0 and `permissionGrants` = 0 for all 599; 4,843 open gap ids | Derived data only | V | `registries/role-execution-profiles.json` `counts`; role-definitions `counts.gapIds`; per-role field counts |
| BOUND (usable path in code) | **9**: business-analyst UASCO-0022, requirements-engineer -0023, ux-designer -0031, planner -0019, architect -0043 (all read-only reviewer route), developer -0085 and tester -0313 (implementer route, Read/Edit/Write/Glob/Grep), security-reviewer -0252, delivery -0232 (deterministic studio) | A role is "executable" only with a full binding; adapters are `local-claude-implementer`, `local-claude-reviewer`, `workos-*`, `project-studio-prepare-run-delivery` | V (code), no execution | `core/agents/first-delivery-bindings.ts`; `core/agents/role-execution.ts` |
| EVALUATED / CERTIFIED | **0 / 0** (3,594 evaluation specs, 0 executed) | | V | role-definitions `counts` |
| RUNNING (product process) | **0** observed. No product runtime is running in this environment; the Founder PC state is UNKNOWN. | | V (here), UNKNOWN (Founder PC) | local process check not applicable; G4 |
| USABLE_BY_END_USER | **0** | No release exists; Windows has no sandbox provider (PR #231 open) | V (code), C (PR state) | G4 sec 2.4; `apps/control-api/src/server.ts:299-301` |

**Highest provable ladder level for the 9 bound roles: INTEGRATED + TESTED(unit) with fake executors** (G4 states no AI-executor path has CI evidence beyond a fake; adapter-reality records 22, only npm and node `REAL` in CI). One historical VERIFIED_REAL_ENV artefact exists at toy scale (one-line edit, Windows, local Claude, self-reported, 2026-10-14) and pre-dates the host-execution ban. The 590 other roles are DESIGNED at best (specification data, `lifecycle=TARGET`).

Doc/runtime drift worth knowing: `registries/implementation-reality.json` still claims `starterRuntimeImplemented: 16`; the live truth source is `core/agents/readiness-audit.ts` (eight layers DEFINED..RUNNING, three-valued, never 0 for missing input), which I did not execute (needs the test toolchain; NOT_RUN).

---

## 3. Phase 7B - Development agents (Claude Code sessions, routines)

### 3.1 Session census (105 sessions, V)

| Class | Count | Notes |
|---|--:|---|
| Long-lived coordinator | 1 | `session_01DmTHw4gBA3wvY1tKM9bk2e`, desktop app origin, created 2026-10-17T20:52Z |
| Long-lived lanes A/B/C | 3 | created 2026-10-21T07:22-07:23Z, origin `claude_code_mcp_seed`, parent = coordinator |
| Persistent reviewer | 1 | `session_01WADpCYPEVM9eThTSwD7CzY` (binding reviewer, Opus 5.5, 74 worker epochs), last update 2026-10-20T16:29Z |
| Reviewers / audit sessions (short) | 6 | PR #115, #135, final-audit review, pre-reviews, desktop audit |
| Task builders (one task each) | 49 | tags: `lane-a-builder` 40, `lane-c-builder` 3, `lane-e-builder` 3, `lane-b-builder` 2, other 1 |
| Other task sessions | 16 | remediation, E2E-1, test-coverage, CP-GOV/CI/REPORT/QUEUE, maintainer reseal, lane-b sync |
| Production builder worker | 1 | `session_01K2PYQ7...` persistent, hourly BUILD_TICK (trigger now disabled) |
| Smoke tests / manual | 9 | 4 cloud smoke tests of 2026-10-17, 5 manual |
| Local bridge sessions | 19 | 2026-08-31 to 2026-09-04, other repo (`AI-SOFTWARE-ORGAN-ZAT-ON-COMPANY`), no usage field |

Creation by day (cloud sessions on page 1): Oct 17: 5, Oct 18: 6, Oct 19: 22, Oct 20: 40, Oct 21: 11, then none. **No new session was created after the three lane sessions on 2026-10-21 07:23Z**: the model changed from disposable per-task builders to three persistent lanes plus the coordinator.

Tag reliability gap: 40 of 49 task builders are tagged `lane-a-builder`, including docs (MOB-1..9), security (SEC-IMPORT-GUARD) and control-plane work (CP-DISPATCH-RECOVERY, CP-GOV-PR31). The lane tag does not describe ownership (V, `list_sessions` tags).

### 3.2 The live development agents

| Agent | Session / trigger | Role | Model, effort | Last activity | Work done (merged PRs, V) | Measured cost | Cost per merged PR (E) | Open PRs now | Failures | Missing config / gap |
|---|---|---|---|---|---|--:|--:|---|---|---|
| Coordinator | `session_01DmTHw4gBA3wvY1tKM9bk2e` | Plans, reviews (127 ledger records), merges, queue/ledger writer, audits | served `claude-opus-5-5` (configured `claude-opus-4-8`, user-switched), effort xhigh, ultracode on, auto-permission | 2026-11-02T03:21:52Z WORKING; context 611,986 of 1,000,000, autocompact at 901,600 | coord PRs 21 + wave PRs 14 merged; gate-merged almost everything | **$4,481.05**; out 53.95 M; cache-read 10.34 B | all-time $17.3 per merged PR (259 merged, E) | #293, #251, #247 | Weekly-limit stalls (C) | Single point of failure (AUD-032); configured model differs from served model |
| Lane A (frontend/UX/desktop) | `session_01MApoJPisUKhZdWpTJmcnY3`, tick `trig_01BMrSHJ...` (13 * * * *, disabled) | Renderer/desktop builder | `claude-sonnet-5-5`, high, no ultracode | 2026-11-02T02:29:16Z IDLE; disconnected | **53** (#136..#290) | **$212.61**; out 3.08 M; cache-read 1.42 B | $4.01 | #292 | Pushed #292 at 02:18Z right after the reset; weekly-limit stall before that (C) | 462 cache-read tokens per output token: tick-driven re-reading |
| Lane B (backend/API/DB/integration) | `session_01VaHcvhtW9yjHAsFktdTn5f`, tick `trig_01XN7KFT...` (33 *, disabled) | Backend builder | `claude-sonnet-5-5`, no effort recorded | 2026-11-02T02:30:33Z IDLE; disconnected | **36** | **$131.93**; out 1.98 M; cache-read 0.92 B | $3.66 | #291 (draft), #231 (frozen) | Last turn failed with 'weekly limit' (COORD-VERIFIED) | Production queue says lane B is "Opus"; live session is Sonnet 5.5 |
| Lane C (AI agents/Work OS/tools/frameworks) | `session_01Vf5LYEF7vPGkRwL6X5AeGT`, tick `trig_01LtND1P...` (53 *, disabled) | Agents/eval/mutation builder | `claude-sonnet-5-5`, xhigh, ultracode on | 2026-11-02T03:21:46Z **RUNNING**; connected; `task_summary` mutants 28/151 at 02:42Z, 76/151 at 03:21Z | **33** | **$429.60** (cost not yet refreshed mid-turn); out 11.58 M; cache-read 2.12 B | $13.02 | #288 (draft), #282 (draft) | Last turn failed with 'weekly limit' (COORD-VERIFIED) | Queue defines lane C as "Mobile app core logic and QA"; live title differs |
| Binding reviewer | `session_01WADpCYPEVM9eThTSwD7CzY` | Wave "binding CLEAN" reviews (#64..#124) | `claude-opus-5-5` | 2026-10-20T16:29Z, idle 12.4 days; context 771,143 | n/a (reviews) | **$156.99** (unchanged since the Oct 20 reading) | n/a | none | none | Superseded in practice by coordinator workflows (ledger starts 2026-10-26) |
| Heartbeat routine | `trig_01QEwrSwCvd8UCbKFn97MiHh`, `11 */3 * * *`, **enabled**, meta_mcp | Report-only recovery classification | default | fired 03:11:26Z, SUCCEEDED, 62 s, report commit `52e826ce` at 03:12:19Z | 90 report commits 2026-10-18..11-02 | $0.37/fire (1 run) | n/a | n/a | Two silent gaps of 77.4 h and 138.0 h | Output branch `uasco/production-reports`; no visible consumer other than the coordinator |
| Independent Cloud Reviewer | `trig_01NJCi2PSTJxh6rMMLewLvGM`, `38 * * * *`, **enabled**, **http_api**, push on | "Temporary" read-only preliminary review | Sonnet 5.5 (from run record) | fired 02:38:39Z, SUCCEEDED, 45 s | one INCONCLUSIVE on #292 + a phone push | $0.31/fire (1 run) | n/a | n/a | n/a | Agent cannot disable it (COORD-VERIFIED); same SHA already reviewed by coordinator |
| Cloud Development | `trig_018vLbG82sUcp6ncPhRurka5`, `29 * * * *`, **enabled**, **http_api**, push on | Continuous builder V2 | `claude-sonnet-5-5` | fired 02:29:54Z, SUCCEEDED, 23 s | NO_ACTION (0 tasks) | $0.23/fire (1 run) | n/a | n/a | n/a | Agent cannot disable it; backlog `BACKLOG_CHECKPOINT.json` generated 2026-10-19 @ e12dbdd, so it can never find a task |

Also in the trigger set: Lane/controller ticks and both Production Builder routines are disabled (V `enabled:false`), the probe routine is disabled, and the queue executor routine last fired 2026-10-21T02:47Z (30 s run) before being paused.

### 3.3 Trigger inventory (V, 60 triggers)

| Group | Count | State |
|---|--:|---|
| Recurring routines | 10 | 3 enabled (heartbeat, Independent Cloud Reviewer, Cloud Development); 7 disabled: controller tick `trig_01Ln2KUz...` (41 *), Lane A/B/C ticks, Production Builder tick (47 *) and queue executor (47 *), probe `trig_017MW7Ln...` ("probe") |
| One-shot reminders into the coordinator session | 37 | all fired once and ended (`run_once_fired`) except `trig_0137JfTiM...` (due 03:56Z) |
| One-shot reminders into the reviewer session `01WADpCY` | 10 | fired and ended |
| One-shot reminders into Lane A | 2 | fired and ended |
| One-shot fresh-session routine | 1 | 05:00 TRT morning report 2026-10-19, ran 18 s |
| Created via | meta_mcp 57, **http_api 3**: the live Cloud Development routine, the Independent Cloud Reviewer, and the disabled "probe" (also named Cloud Development) | |

### 3.4 What the weekly cap did to the agents

Timeline from GitHub (V): CI runs and merges stop after 2026-10-22T21:14Z, resume 2026-10-26T02:46Z, stop after 2026-10-27T11:42Z (last merge #290 11:34:55Z), resume 2026-11-02T02:22Z. Heartbeat commits show the same gaps (77.4 h, 138.0 h). Sessions already carried `seven_day ... allowed_warning` with reset 2026-10-26T02:00Z on 2026-10-21 (V `get_session` rate_limit_info of the PQ-010, Production Builder and #135 reviewer sessions), and `five_hour` reset today is 07:10Z. The Oct 27-Nov 2 stall is COORD-VERIFIED as a weekly limit; for Oct 23-25 no document names the cause, so "weekly limit" is an inference there (E). Lane C kept running through the freeze (see G6-18).

---

## 4. Findings: waste, overlap, loops, blocks, ownership

Each finding is evidence-backed; recommendations are in section 5.

**4.1 Unused or duplicate agents**
- 82 of 84 IDLE sessions have not moved for 7 days or more; 14+5 are ARCHIVED. Nothing in them consumes quota, but 4 are BLOCKED and 3 REVIEW_READY with open questions to the Founder dated 2026-10-17..21: `01831yAg` (post two CLEAN drafts on PR #115), `015MqXBf` (UI-194 scope decision), `014aT3Ba` (liveness-selftest authority), `01Kc6FYq` (needs repo and GH_TOKEN). V, `list_sessions` + `needs_action`.
- Four review mechanisms overlap: governed reviewer workflows inside the coordinator (87 workflow-ref ledger records), the persistent binding reviewer (idle since Oct 20), the GitHub `UASCO Independent Review` workflow (504 runs, 179 success, 299 skipped), and the hourly Independent Cloud Reviewer routine. V.
- Dispatch is dead but three agents still describe it: Cloud Development says "heartbeat is primary dispatcher"; the heartbeat says "you dispatch nothing"; the Production Builders are disabled; the queue holds 16 tasks, all INTEGRATED or TESTED (V, `PRODUCTION-QUEUE.json`). No routine can start work.
- Lane definitions drift: queue `lanes` text says B = Backend (Opus), C = Mobile/QA (Sonnet); live sessions are B = Sonnet 5.5 and C = AI Agents/Work OS/Tools. V.

**4.2 Repeated tasks and stalled automations**
- 50 one-shot reminders, many are re-arms of one watch: PR #11 safety-net x5 (PR #11 was closed unmerged on 2026-10-20), FA-LEASE2 D3 detector x3 (polled for a record that never landed), PR #49 safety-net x4, "re-check #143/#144" x2, "#279/#286" x3, "#221" x2, "#72 CI" x2, "#114" x2. Each wake costs a turn in a 600K-token session. V (prompts), E (cost).
- The Cloud Development routine returned NO_ACTION in its sampled run and stated its input is stale ("generated 2026-10-19 at head e12dbdd ... far behind"); it also could not check rulesets (tools unavailable). 24 fires per day produce no output. V.
- A GitHub run is stuck: `39687649214` (UASCO Independent Review, `founder-authority` job waiting since 2026-10-21T22:36Z, about 11 days). V (G1).
- The heartbeat report branch is written but not consumed by any other automation I could find (UNKNOWN consumer): 90 report commits, one per fire. V (commits), UNKNOWN (use).

**4.3 Wasted calls**
- The hourly controller and lane ticks run a full persistent session turn even when the first step prints `TICK UNCHANGED`. Lane A and B have 462 cache-read tokens per output token (coordinator 192, Lane C 183, one-task builders about 136), consistent with many low-output, tick-driven turns (E, from V ratios).
- Idle timer-driven fires during the weekly limit queued instead of stopping: about 115 controller ticks piled up (COORD-VERIFIED) and were drained by about 02:55Z (COORD-STATE). The whole coordinator interval 02:27-03:22Z cost $44.65, which bounds the drain (V arithmetic).
- Independent Cloud Reviewer re-reviewed PR #292 @ `43776e1` for which the coordinator already recorded a delta `NO_BLOCKERS` (ledger `47d46b0`), returned INCONCLUSIVE ("could not tell why" CI was red), and pushed a phone notification. V (`list_events` session_015dYwb59mnv1Ynn4WBQGva8; ledger).
- IR workflow `collect` job waits on a Linux runner for CI to finish (`CI_WAIT_MINUTES: "100"`): median 16.3 min over 176 successful runs, about 2,900 Linux runner-minutes; and in my 10-run sample of "success" runs the `ai-review` job executed in 3 and was skipped in 7, the executed ones lasting 30-32 s (so a real model review is not proven; the reviewer credential is on the Founder-pending list as REVIEWER_AUTH_REJECTED). V sample, C for the credential state.

**4.4 Retry loops**
- CI: 47 runs have more than one attempt (51 extra attempts); 190 failed + 166 cancelled CI runs in 14 days (G1, V). PR-triggered CI cancels superseded runs by design (`cancel-in-progress` for pull_request).
- Review repair loops: 6 PRs absorbed 37 of 127 ledger records (#231: 9, #264: 7, #265: 6, #262: 5, #263: 5, #276: 5); #231 is still unmerged after 9 heads. V. The policy caps at 2 repair rounds and 3 review heads; `ROUND_LIMIT` appears in 5 ledger verdicts. V.
- Base-wide red CI is a loop generator: 11 moderate npm advisories (DEPENDENCY_AUDIT) keep #292 and #291 red until a protected change lands; #293 carries it but is itself BLOCKED on governance (ledger `afe2f9b`, `BLOCKERS_GOV_FOUNDER_AUTHORITY`). C+V.

**4.5 Supervisor blocks (agents cannot proceed without a human)**
- Founder-held PRs #251, #247, #231, #66; protected CI-files authority; FD-LV1 flake grant (4 of 82 Windows runs); fsmonitor central authority request; reviewer OAuth renewal; Independent Review bootstrap; local Windows worker pilot (COORD-VERIFIED list). Two routines (http_api) cannot be disabled by an agent.
- 4 BLOCKED sessions waiting on the Founder (4.1).

**4.6 Ownership gaps**
- One identity: all 259 merged PRs have `user = SalimBurakAytemiz` (V, `pulls_closed_slim.json`); author, builder, reviewer and merger are not technically separate (prior AUD-001, C).
- Reviewer independence is process only: the Independent Cloud Reviewer itself reports "author and implementer are the same account, no independence" (V, event text).
- The routine set has no owner of record for outputs: Cloud Development has no visible output (AUD-121, C); IR routine output is a transient notification; heartbeat output goes to a branch.
- Coordinator is a single point of failure holding 612K tokens of context and every merge/queue/ledger write (V context; AUD-032 C).

**4.7 Reviews that look unnecessary (judgement, E)**
- 17 of 127 records are `BASE_MERGE_ONLY*` (13.4%): about 20 records are coordinator-inline checks (cheap), the rest workflow-based. TEP-1 says base merges are excluded from review, yet they are still recorded as delta entries.
- Duplicate review of one SHA by 2-3 mechanisms (4.3).
- Not wasteful: first full reviews of merged PRs found BLOCKERS in 21 of 46 cases, and 14 of 63 delta records on merged PRs still found blockers (V counts).

---

## 5. Recommendations (keep / merge / reorganise; recommendation only)

| Item | Recommendation | Reason (evidence) |
|---|---|---|
| Cloud Development routine | **Retire** (Founder must disable at claude.ai/code/routines; http_api) | NO_ACTION with stale backlog, about $5.6 per day, push notifications on |
| Independent Cloud Reviewer routine | **Merge into one governed reviewer path or retire**; if kept, run on demand per new SHA only | Duplicates coordinator ledger and IR workflow; INCONCLUSIVE; http_api, undisable-able by agents |
| Heartbeat routine | **Reorganise**: daily or on-demand, or fold into the ledger; or disable | 90 reports, no consumer found, $0.37/fire |
| Controller + lane hourly ticks | **Reorganise** to event-driven wakeups (PR subscriptions already used) with a hard stop on `USAGE_LIMIT`; keep disabled during pause | ~115 ticks queued through the stall; lane cache-read ratio 462:1 |
| One-shot reminders | **Reorganise**: one standing watch per PR; stop re-arming when a PR is closed | 50 reminders; PR #11 x5 on a PR that closed unmerged |
| Coordinator session | **Keep the role, change the shape**: periodic fresh session with state in files (`COORD-STATE.md`, ledger) instead of one 600K context; record per-day cost in the ledger | 97% of tokens are cache reads; $4,481 in 15 days; SPOF |
| Lane A and B | **Keep** (lowest cost per merged PR: $4.01, $3.66) | measured |
| Lane C | **Keep, but test effort level**: the xhigh + ultracode setting coincides with $13.02 per merged PR (3x A/B); the cause is not proven (different work) | measured correlation only |
| Binding reviewer session `01WADpCY` | **Archive** (idle since Oct 20, 771K context) once the ledger is the only record | no activity for 12.4 days |
| Task-builder sessions (49+16) and 82 stale idle sessions | **Archive**; answer or close the 4 BLOCKED questions first | orphaned questions dated Oct 17-21 |
| IR GitHub workflow | **Reorganise**: stop the 100-minute CI wait on a runner (use `workflow_run`/status trigger), and do not count a skipped `ai-review` as a review | 2.9k Linux-min of waiting; 7 of 10 skipped |
| Repo visibility | **Do not make it private without a budget**; keep CI minutes under watch | free minutes ran out on 2026-10-18; private-equivalent about 90k billable min |

---

## 6. Phase 9 - Cost, quota, performance

### 6.1 Measured session cost (V, `get_session`, 2026-11-02 03:2xZ)

Coverage: 105 sessions listed; 86 cloud, 19 local-bridge (the bridge ones expose no usage field). I read usage for **28 cloud sessions** (33% of the 86 by count, but about 98% of the estimated cost, because all four long-lived sessions are included) and 3 routine-run sessions that the list does not show. Raw rows: `closure-2026-11-02/g6_costs.json`.

| Session group | n | cost_usd | Notes |
|---|--:|--:|---|
| Coordinator | 1 | 4,481.05 | Opus 5.5 xhigh; in 2.11 M, out 53.95 M, cache-read 10,342,960,222, cache-write 235,324,552 |
| Lane A / B / C | 3 | 212.61 / 131.93 / 429.60 (774.14) | Sonnet 5.5 |
| Binding reviewer + governance pre-review | 2 | 156.99 + 16.30 | Opus 5.5 |
| Short sessions (builders, reviewers, audits) | 22 | 48.20 total, mean 2.19, median 1.36, min 0.24, max 8.05 | Opus mean 3.58 (n=9), Sonnet mean 1.23 (n=13); task mix differs, not a controlled comparison |
| **Measured subtotal** | **28** | **5,476.68** | 4 long-lived sessions = 5,255.19 (96.0%) |
| Unmeasured cloud sessions | 58 | **E 79-127** | 58 x (median 1.36 to mean 2.19). Prior audit reported 58 child sessions at $73.10 total (C) |
| Routine-run sessions | 3 measured | 0.2316 + 0.3144 + 0.3702 = 0.92 | Not in the list; every fire creates one |
| Local-bridge sessions (Sep) | 19 | UNKNOWN | no usage field |
| Estimated total of listed cloud sessions | | **about 5,560-5,610** | E; excludes routine fires of the past 15 days and any subagent cost that the platform may not roll into the parent (UNKNOWN) |

Cost drivers (E): fitting the four token types to cost across the 12 Opus and 16 Sonnet sessions (unconstrained least squares, max relative error 15% and 6%) puts cache reads plus cache writes at roughly 80-85% of the cost of the large sessions and output at roughly 16-18%. The fit uses few distinct points and is collinear, so treat the split as indicative only. The tokens themselves are exact (V): 97.3% (coordinator), 99.1% (Lane A), 99.2% (Lane B), 98.0% (Lane C) of all tokens are cache reads.

Trend: coordinator $1,129.16 (2026-10-20 16:44Z, prior audit, C) to $4,436.40 (02:27Z today, COORD-VERIFIED) to $4,481.05 (03:22Z, V). Output tokens grew from 13.75 M to 53.95 M. Average since creation: $293 per calendar day (V arithmetic over 15.27 days); about $39 per GitHub-active hour since Oct 20 (E, 86 h); the last measured 55 minutes ran at $48.7 per hour (V arithmetic, includes the drain of queued ticks and the closure audit).

Value ratio (V arithmetic, E interpretation): $5,255.19 for the four long-lived sessions against 259 merged PRs all-time is $20.3 per merged PR; lane-only: A $4.01, B $3.66, C $13.02 per merged PR (merged PR counts per lane: 53, 36, 33 from head-branch prefixes). Merge counts say nothing about value per PR.

### 6.2 Routine fire cost (V per run, n=1 each)

| Routine | Duration | Turns | Output tokens | cost_usd | Per day if on schedule (E) |
|---|--:|--:|--:|--:|--:|
| Cloud Development | 22.7 s | 7 | 1,706 | 0.2316 | 24 x = 5.56 |
| Independent Cloud Reviewer | 37.4 s | 11 | 3,698 | 0.3144 | 24 x = 7.55 |
| Heartbeat | 61 s | not read | 5,672 | 0.3702 | 8 x = 2.96 |
| Total | | | | | about 16.1 per day, about 113 per week |

These sessions do not appear in `list_sessions`; the real total over the 15 days is not recoverable (UNKNOWN). Sample size is 1 per routine, so the daily figures are order-of-magnitude.

### 6.3 Weekly quota behaviour (V timeline, E cause)

| Window | Span | Active hours (distinct hours with a CI run) | Merges | CI runs | Result |
|---|---|--:|--:|--:|---|
| 1 | 2026-10-19 02:00Z to 10-26 02:00Z | 79 (first Oct 19 02Z, last Oct 22 21Z) | 176 | 832 | 3.2 days silent at the end |
| 2 | 2026-10-26 02:00Z to 11-02 02:00Z | 34 (first Oct 26 02Z, last Oct 27 11Z) | 74 | 653 | 5.6 days silent at the end |
| 3 | from 2026-11-02 02:00Z | 1 so far | 0 | 2 | running |

The cap was reached about 2.8 times sooner in window 2 than in window 1 (91 h versus 33 h of activity span), while merges per active hour stayed 2.2. Consumption per hour rose; lane effort settings (Lane C xhigh + ultracode, coordinator xhigh + ultracode) and heavier review workflows are candidate causes, not proven. No cloud-chain quota handling exists (prior AUD-084, C); in code only the local `automation/` orchestrator (V6 supervisor path, mostly retired) classifies `QUOTA_EXHAUSTED` (`automation/lib/failure-classifier.mjs:6`) and the reviewer gate has quota codes.

### 6.4 GitHub Actions minutes (E from a V sample)

Runner types (V): workflows on base use `ubuntu-latest` and `windows-latest` only (`runs-on` in `ci.yml`, `windows-installer.yml`, `uasco-independent-review.yml`); `ci.yml` line 1 states "no self-hosted, larger or paid runner". In 110 sampled runs / 370 jobs the labels were `windows-latest` 209 and `ubuntu-latest` 161, runner group "GitHub Actions"; 0 self-hosted. The self-hosted workflows are historical (3 smoke runs, none on base).

Method: stratified random sample (seed 20261102) of 110 of 1,740 runs across 12 strata (workflow x event x conclusion), each run's `/jobs?filter=all` (all attempts) pulled with `gh api`; job time = `completed_at - started_at` (skipped jobs excluded); per-stratum mean times the stratum population; total with a 2,000-resample bootstrap. Files: `g6_sample_jobs.py`, `g6_analyze_jobs.py`, `g6raw/sample_jobs.json`, `g6raw/strata_means.json` in `closure-2026-11-02/`.

| Stratum (N runs all-time, n sampled) | Mean Linux min | Mean Windows min |
|---|--:|--:|
| CI pull_request success (336, 20) | 6.6 | 62.4 |
| CI pull_request failure (233, 15) | 2.4 | 25.5 |
| CI pull_request cancelled (117, 10) | 3.7 | 26.5 |
| CI push success (95, 12) | 6.3 | 65.3 |
| CI push failure (202, 12) | 2.4 | 9.7 |
| CI push cancelled (49, 6) | 0 | 0 |
| IR success (176, 10) | 16.3 | 0 |
| IR skipped (299, 5) | 0 | 0 |
| IR cancelled (23, 3) | 37.3 | 0 |
| Installer push success (112, 8) / PR success (55, 6) | 0 | 4.2 / 4.2 |

Results (E):
- Raw runner time: Linux about 8,000 min (134 h), Windows about 38,900 min (648 h), total about **46,900 min** over all 1,740 runs (1,486 of them in the last 14 days). Rounded up per job (GitHub bills per job-minute): 9,086 Linux + 40,449 Windows = 49,535; bootstrap 95% range **44,860-54,586**.
- By workflow: CI 90.6%, UASCO Independent Review 7.9%, Windows Installer 1.5%. By conclusion: success 71.6%, failure 19.0%, cancelled 9.4%. Push CI on the base (post-merge re-validation of an already validated tree) is 9,228 min, 19.7%.
- About 181 runner-minutes per merged PR (46,900 / 259).
- A single successful CI run costs about 62 Windows minutes plus 6.6 Linux minutes (4 Windows jobs and 1 Linux job, matches the usage record: 1 UBUNTU job, 4 WINDOWS jobs).
- Latency (V, G1 section 6.4): PR CI success median 26.9 min, p90 54.2 min, max 77.1 min; Windows shards median 20-22 min each.

Billing (V + knowledge): `get_workflow_run_usage` for runs 41377356505, 40497319565 and 40403559608 returned `billable` total_ms **0** for every UBUNTU and WINDOWS job (run durations 25.7, 5.4 and 22.6 min) because the repo is public. **Illustrative private-repo exposure (E, not billed; the 2x Windows multiplier and 2026 price list are from general knowledge and not verifiable here):** about 9,086 + 2 x 40,449 = 90k billable-equivalent minutes in 15 days against the 2,000 free minutes that were exhausted once already on 2026-10-18 (C). Treat that as roughly 45x the free allowance.

### 6.5 Models, providers, gateway configuration

| Item | Finding | Tag | Evidence |
|---|---|---|---|
| Model used for work | Claude only: coordinator Opus 5.5; lanes and routines Sonnet 5.5; many reviewers/security/docs builders Opus 5.5 (28-session sample: Opus 12, Sonnet 16) | V | `get_session` model fields |
| Non-Claude providers in code | **None**: 0 files mention openrouter, groq, nvidia or gemini outside audit logs; `openai` appears only in the retired Codex (OpenAI) reviewer scripts, env-stripping lists and secret-scan patterns (`scripts/codex-reviewer-broker.mjs`, `automation/`, `core/workos/secret-scan.ts` regex); `ollama` only in registry/organization text (23 files) | V | `git grep -i` on base excluding `audit`, `docs`, `knowledge`, `evaluations`, `tests` |
| Earlier multi-provider work | September local-bridge sessions in a different repo (`AI-SOFTWARE-ORGAN-ZAT-ON-COMPANY`) record OpenRouter/Groq/NVIDIA experiments: "Groq probe passed; qa stage hit HTTP 400 tool_use_failed", "provide OpenRouter key with at least $10 credit". Cost UNKNOWN (no usage on bridge sessions). Not in this repo. | C | `get_session` post_turn_summary of `01KUwZR2...`, `01RpyDSh...`, `01V5Cywi...` |
| OmniRoute gateway | `models/omniroute/client.ts` (23 lines) only discovers `/v1/models` on loopback or approved hosts; `config/omniroute-policy.json` pins `127.0.0.1:20128`, MIT licence, global install. Its adapter record is `DISCOVERY_ONLY`. No listener on 127.0.0.1:20128 in this environment: `NOT_RUN_ENV_UNAVAILABLE`. Whether it was ever called on the Founder PC: **UNKNOWN**. | V (code, no listener), UNKNOWN (past calls) | `curl` exit 7; `adapter-reality.ts:40` |
| Model routing | `models/router/router.ts` `chooseProvider` (LOCAL < FREE < SUBSCRIPTION < PAID) is referenced by no production code (`git grep chooseProvider` finds only the definition) and the prior audit says routing and budgets are prompt-only (AUD-098, C) | V | `git grep` |
| Paid API policy | `config/automation.json`: `allowPaidApi:false`, `allowProduction:false`, `allowRisk5:false`; `ANTHROPIC_API_KEY` is stripped by `config/environment-policy.json`; the product drives the Claude CLI, so spend lands on the Claude subscription quota, not a metered API key | V | the two config files |
| Token/cost control in product | token cap stored but not enforced; no FinOps (AUD-067, C); UI-190 "Token Budget and Quota Map" NOT_IMPLEMENTED | C | prior audit 03 / 09 |
| Cloud quota handling | `ReviewerGate` has `REVIEWER_QUOTA_OR_RATE_LIMIT` codes; three historical Codex reviews were `quota-block` records (2026-09-26, 09-28) | V | `scripts/ci/uasco-review/review-gate.mjs:106`; `audit/reviews/*quota-block*.json` |

### 6.6 Performance observations

| Measure | Value | Tag |
|---|---|---|
| Merge throughput | 259 merged PRs in 11 calendar days of history; 151 after the lanes started; 2.2 merges per active hour in both weekly windows | V |
| Merged per lane (heads) | A 53, B 36, C 33, coordinator 21, waves 14, per-task builder PRs 55 | V |
| Review turnaround | 127 ledger records in 7 days; mean 2.32 records per merged PR (max 7) | V |
| CI wall time | success median 26.9 min, p90 54.2 min | V (G1) |
| Session concurrency | prior audit: average 0.89 builders at once, cap 2-3 (C); today 2 sessions running | C / V |
| Coordinator context | 611,986 of 1,000,000 tokens used; autocompact threshold 901,600 | V |
| Heartbeat reliability | 90 report commits 2026-10-18 to 11-02; max gap 138 h (outage), median 1 h (hourly era) | V |

---

## 7. Corrections to the brief (COORD-VERIFIED items I could check)

- "heartbeat report last written 2026-10-27 09:14Z" is out of date: a new report `52e826ce` was committed to `uasco/production-reports` at **2026-11-02T03:12:19Z** by the enabled heartbeat routine (V `gh api commits`). It is not a commit on `v7/integration`, which still stops at `0b71650`.
- The three recurring routines that "failed with USAGE_LIMIT_REACHED" are succeeding again after the 02:00Z reset (Cloud Development 02:29Z, Independent Cloud Reviewer 02:38Z, heartbeat 03:11Z; V `last_run`). Lane C is RUNNING (03:21Z) on `claude/lane-c-eval-tester`; that branch is on origin at `dc85a9f` and is 0 commits ahead of `v7/integration`, so the mutation run is unpublished local work; its relation to the freeze is UNKNOWN.
- Open PRs are now 9 including #293 (coordinator dependency fix, head `ee2facb`, BLOCKED on governance); #282's head SHA on origin is `b13e23d`, updated 03:30:46Z.

---

## 8. Gaps / remaining work found

| ID | Module | Pri | One line | Evidence |
|---|---|---|---|---|
| G6-01 | automation | P1 | Founder must disable the two http_api routines (Cloud Development, Independent Cloud Reviewer); they still fire hourly with push notifications | `list_triggers`; COORD-VERIFIED |
| G6-02 | automation | P1 | Decide keep/disable for the heartbeat routine (enabled, agent-disablable, writes reports every 3 h) | trigger `trig_01QEwrSw...`; commit `52e826ce` |
| G6-03 | cost | P1 | No repo-side cost/token telemetry or budget enforcement; cost exists only in platform session records | no file; `get_session`; AUD-067/098 |
| G6-04 | cost | P1 | Coordinator context tax: 97% cache-read, $4,481 in 15 days, one 612K-token session | usage fields |
| G6-05 | quota | P1 | No USAGE_LIMIT backoff in the cloud chain; crons queued ~115 ticks across two multi-day outages | timeline; AUD-084 |
| G6-06 | ci-cost | P1 | CI is free only because the repo is public; about 47k runner-minutes (about 90k billable-equivalent) in 15 days; a prior quota exhaustion on 2026-10-18 | sample; `ci.yml` line 1; trigger prompt |
| G6-07 | ci-cost | P2 | IR workflow waits up to 100 min for CI on a Linux runner (about 2.9k min) and its `ai-review` ran in 3 of 10 sampled success runs | job sample; workflow lines 70-102 |
| G6-08 | ci-cost | P2 | About 28% of runner-minutes are on failed or cancelled runs; 19.7% on post-merge push CI | strata totals |
| G6-09 | review | P2 | Four overlapping review mechanisms; the hourly routine duplicated a coordinator verdict on the same SHA | events; ledger `47d46b0` |
| G6-10 | review | P2 | 17 of 127 ledger records are base-merge-only; 6 PRs absorbed 37 records (#231: 9 heads, unmerged) | ledger analysis |
| G6-11 | ownership | P1 | One GitHub identity authored 259/259 merged PRs; builder, reviewer and merger are not separable | `pulls_closed_slim.json`; AUD-001 |
| G6-12 | config | P2 | Queue lane definitions and models do not match live sessions (B Sonnet vs "Opus"; C mobile vs AI-agents); session lane tags unreliable (40/49 `lane-a-builder`) | queue JSON; `get_session`; tags |
| G6-13 | backlog | P2 | Cloud Development cannot find work: `BACKLOG_CHECKPOINT.json` dated 2026-10-19; queue has 16 tasks all INTEGRATED/TESTED | run events; queue |
| G6-14 | hygiene | P3 | 82 idle sessions stale 7+ days; 4 BLOCKED + 3 REVIEW_READY sessions with unanswered Founder questions since Oct 17-21 | `list_sessions` |
| G6-15 | hygiene | P3 | 50 one-shot reminders, repeated watches (PR #11 x5, D3 detector x3, PR #49 x4); no cleanup rule | `list_triggers` |
| G6-16 | product-agents | P0 | 0 of 599 roles runtime-ready/certified/evaluated; 9 bound; no AI-executor path with CI evidence beyond fakes | `role-definitions.json` counts; G4 |
| G6-17 | providers | P2 | No second provider path; `chooseProvider` dead code; OmniRoute discovery-only, no local gateway present | `git grep`; `curl` |
| G6-18 | freeze | P2 | Lane C kept running a 151-mutant run (28 to 76 in 39 min, about 74 per hour) on an unpublished branch during the freeze; scope vs "one push each" unknown | `get_session` task_summary; branch check |
| G6-19 | resilience | P1 | Coordinator is a single point of failure for builds, waves, queue and merges | context 612K; AUD-032 |
| G6-20 | heartbeat | P3 | 90 heartbeat reports with two outage gaps (77.4 h, 138.0 h) and no identified consumer | commits TSV |

---

## 9. Method, coverage, limits

- Sessions: `list_sessions` page 1 (100, cached file) + `after_id=session_01V5Cywid...` page 2 (5, end). `get_session` on **33** sessions: coordinator, three lanes, binding reviewer, governance pre-review, 21 short builder/reviewer/audit/remediation/E2E sessions (2 of them local-bridge sessions without usage), and 3 routine-run sessions (found by replacing the `cse_` prefix of the trigger's `last_run.session_id` with `session_`). 2 `list_events` calls read the Cloud Development and Independent Cloud Reviewer runs.
- Triggers: `list_triggers` all pages (recurring set complete; one-shot set paged to `has_more:false`).
- GitHub: `gh api` (read-only GET) for runs/jobs/commits/pulls; `get_workflow_run_usage` via the GitHub MCP tool x3. Existing G1 raw dumps (`g1raw/runs_all_slim.json`, `pulls_closed_slim.json`) were reused as inputs; the population counts (1,740 runs, 259 merged) are G1's, re-used here and not re-fetched.
- Registry counts were recomputed from the files at `0b71650`; nothing was executed. The test suite, `readiness-audit`, and any live model call were not run.
- Limits: sample sizes (n=20 for the largest stratum, n=1 per routine cost) set the confidence; subagent costs inside the coordinator may or may not be included in its `usage` (UNKNOWN); bridge sessions and routine fires are only partly measurable.

## 10. Reproduction

```
# sessions and costs
mcp list_sessions ; mcp list_sessions after_id=session_01V5CywidXzfGMwHjW9G3oua ; mcp get_session <id>   # usage.cost_usd, cache_read_tokens, output_tokens
# triggers
mcp list_triggers recurring=true include_completed=true ; mcp list_triggers include_completed=true recurring=false cursor=<next_cursor>
# Actions sample
python3 closure-2026-11-02/g6_sample_jobs.py   # gh api repos/.../actions/runs/<id>/jobs?filter=all
python3 closure-2026-11-02/g6_analyze_jobs.py  # strata means, totals, bootstrap
gh api repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-/commits?sha=uasco/production-reports&per_page=100&page=N
# registries
python3 -c "import json;d=json.load(open('registries/role-definitions.json'));print(d['counts'])"   # in audit-wt @0b71650
git grep -n -i -e openrouter -e groq -e nvidia -e gemini -- ':!audit' ':!docs' ':!knowledge' ':!evaluations' ':!tests' ':!package-lock.json'
git grep -n chooseProvider -- ':!tests'
curl -s -m 2 http://127.0.0.1:20128/v1/models   # exit 7 here
```
