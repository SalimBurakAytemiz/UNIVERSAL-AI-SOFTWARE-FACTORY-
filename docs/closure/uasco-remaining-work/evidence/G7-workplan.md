<!-- //TR: UASCO kapanış denetimi kanıt dosyası — G7 iş planı analizi (2026-11-02, salt-okunur denetçi çıktısı) -->
# G7 - Work-plan analysis (Phase 8)

Auditor: g7-workplan (read-only). As of 2026-11-02 ~03:35Z. Base: v7/integration @ 0b71650fa88b9802968562c63ca33f8b56e9648b (VERIFIED: audit-wt HEAD). Queue/ledger branch: uasco/production-queue @ afe2f9b (2026-11-02T03:20:53Z; moved from 3074ec2 during the audit).

Evidence tags. **V** = I recomputed it from a primary source (file, git, GitHub REST API) and cite it. **C** = a document or another auditor says so, I did not re-verify. **E** = my inference (method given). **UNKNOWN** = not measurable from here. "COORD-VERIFIED" = fact given by the coordinator on 2026-11-02. Ladder: PLANNED > DESIGNED > CODED > INTEGRATED > TESTED(unit) > VERIFIED_REAL_ENV > USABLE_BY_END_USER.

Primary data and scripts are in `closure-2026-11-02/g7raw/` (S = `/tmp/claude-0/-home-user-UNIVERSAL-AI-SOFTWARE-FACTORY-/2b112f87-31d8-5a52-96d5-8b4fa41b948c/scratchpad`): `closed-slim.json` (284 closed PRs, `gh api repos/SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-/pulls?state=closed&per_page=100&page=1..3`), `open.jsonl` (9 open PRs), `files/<n>.json` (per-PR file lists from `/pulls/<n>/files`, 259 merged PRs, 1,751 file rows), `runs.jsonl` (1,745 workflow runs, `/actions/runs?per_page=100&page=1..18`), `classify.mjs` / `cycle.mjs` / `ledger.mjs` / `ci.mjs` (the calculations), `last100-classification.tsv` (per-PR table for the last 100 merged PRs).

---

## 1. Headline facts

1. V: **The roadmap that governs day-to-day work is not the 149-phase ROADMAP.md.** ROADMAP.md and `roadmap/` have 0 commits since 2026-10-17 (last: 707c2aa, 2026-09-23); all 149 phase contracts and all 34 review packages have `state: PLANNED` (python count over `roadmap/contracts/*.json`, `roadmap/review-packages.json`); `.ai/MASTER_STATE.json` still says `V6_AUDIT_REMEDIATION_IN_PROGRESS`, phase 0, `TARGET_MACHINE_PHASE0_PENDING` (last write f0a4f0a, 2026-09-28). Meanwhile 259 PRs merged. 0 of the last 100 merged PR titles cite a ROADMAP phase.
2. V: **The work actually follows a chain of short-lived task lists:** BACKLOG_CHECKPOINT (102 tasks, last write 2026-10-20T15:58Z, 157 PRs merged after it) > PRODUCTION-QUEUE.json tasks[] (16 PQ tasks, `checkpoint.at` 2026-10-22T18:59Z, 74 PRs merged after it) > coordinator-dispatched lane tasks A/B/C (names like `A-277-LOWS`, only in PR titles and lane maps) > **Master V2 Wave 0 baseline** (9 packages + 12 cross-lane tasks + 10 Founder decisions, generated 2026-10-26).
3. V: **Master V2 progress when the limit hit (about 16 h after the first package PR #260 was opened at 2026-10-26T20:00:00Z): 6 of 21 plan items merged** (C-RDY-1 #260, C-CTX-1 #265, C-RDY-2a #264, B1 #262, A1 #263, A4 #261), 3 open (C-RDY-2b #288 draft, B2 #291 draft, A2 #292), **12 with no PR title or remote branch name** (C-CTX-2, C-EVAL-2, C-EVAL-3, C-CTX-3, C-BIND-1, A3, B3, B4, B5, Z1, Z2, Z3). All Wave 0 packages measure readiness; the plan itself says C-RDY-1 "changes no model behaviour".
4. V: **55.2% of the calendar had zero activity.** Two gaps with no commit on any ref: 77.4 h (2026-10-22T21:12:59Z to 2026-10-26T02:39:48Z) and 134.4 h (2026-10-27T11:54:55Z to 2026-11-02T02:15:57Z) = 211.8 h of 383.9 h between first PR (2026-10-17T03:33:35Z) and now. The second is the COORD-VERIFIED weekly limit; the first is unexplained in the repo (E: consistent with an earlier weekly window, section 8.5).
5. V: **Merge speed is not the bottleneck.** PR open-to-merge (created_at to merged_at): last 40 merged median 1.85 h, p90 8.25 h; last 100 median 1.62 h, p90 14.09 h; all 259 median 1.93 h, p90 23.81 h. Slow PRs are the Founder-tier ones: 12 protected-tier PRs median 11.8 h, p90 87.3 h, versus 126 other non-bundle PRs (#143 and later) median 1.41 h, p90 4.47 h.
6. V: **Review does not converge quickly.** COORD-LEDGER.json (afe2f9b): 127 review records on 54 PRs; 45 BLOCKERS, 64 NO_BLOCKERS, 16 BASE_MERGE_ONLY, 2 ROUND_LIMIT. Of 47 merged PRs with ledger records, 22 (46.8%) had at least one BLOCKERS head before merge. 13 PRs reached 3 or more substantively reviewed heads; #231 reached 9 and is still open. Policy cap `maxReviewRounds: 3` (coord-ledger.mjs POLICY).
7. V: **Only 16.1% of changed lines in the last 100 merged PRs are product code** (apps/desktop 3,775 + core 4,947 + control-api 573 = 9,295 of 57,716 a+d lines, vehicles excluded); tests 34.4%; CI/governance/lane-evidence/authority files 49.5%. By PR count: PRODUCT 68, TEST_ONLY 13, META_CI 9, META_GOV 9 (99 PRs, vehicle #225 excluded). The median PRODUCT PR changes 40.5 product lines; 37 of 68 change fewer than 50.
8. V: **Real vs reported:** 0 of 1,364 inventory rows have product_verified != NO; 0 of 16 queue tasks are PRODUCT_ACCEPTED (15 INTEGRATED, 1 TESTED); highest ladder level I can prove for the product pipeline is TESTED(unit); the only VERIFIED_REAL_ENV artefact I verified is the Windows Installer workflow run 40497319565 (success, head 0b71650, 2026-10-27T11:35:42Z-11:41:03Z, GitHub-hosted runner). Nothing is USABLE_BY_END_USER (V: `gh api .../releases` and `.../tags` both return 0 entries on 2026-11-02; C: G3 lines 15-16, no signed build).
9. V: **Oct-31 target was missed and was never credible on the plan's own words.** `docs/inventory/2026-10-19/PRODUCTION_PLAN_TO_OCT31.md` (2026-10-19): "Nothing is DELIVERABLE on current evidence", "Judgement, confidence LOW", 145 of 246 screens need authority, 18 mobile screens and 24 of 25 labs "Not deliverable by Oct 31".
10. V: **Coordination dominates cost** (COORD-VERIFIED platform cost): coordinator session $4,436.40 vs lanes A $212.57 + B $129.46 + C $429.60 = $771.63; the coordinator is 85.2% of the four named sessions' $5,208.03 (E: $17.13 per merged PR for the coordinator, $6.32 per lane-prefix merged PR for the lanes; API-equivalent cost, not billed cost; excludes at least 84 other sessions created since 2026-10-17).
11. V: **Open Founder-dependent items are old:** #66 13.2 d (created 2026-10-19T22:05Z), 15 `founderQueue` entries 12.0-12.1 d (queued 2026-10-21T01:39-03:17Z), Independent Review run 39687649214 `waiting` 11.2 d, #231 6.8 d, #247 6.5 d, #251 6.5 d, git-isolation request 5.7 d. #293 (0 d) now blocks #292, #291 and every base CI run.
12. V: **Bundling hides how many integration events there are:** the 259 merged PRs map to only 175 unique merge commits; 16 wave PRs absorbed 84 member PRs (e.g. #64 = 27 PRs, one merge commit d2ba4f0). A G2-style attribution (diff of `merge^1..merge` per PR) credits the whole wave diff to each member and yields 189 product PRs; per-PR file lists give 165 (section 11.4).

---

## 2. Which roadmap is actually used

| Artefact | Path / location | Content | Last write | State / evidence of use |
| --- | --- | --- | --- | --- |
| FINAL Canonical Roadmap | `ROADMAP.md` (485 lines), `roadmap/*.json` | 149 phases in periods A-P, each exit `PHASE_NNN_VERIFIED`; 12 build waves, 34 review packages | 707c2aa 2026-09-23 | **Not used.** 149/149 contracts PLANNED; `git log --since=2026-10-17 -- ROADMAP.md roadmap` = 0 commits; `PHASE_NNN_VERIFIED` appears outside roadmap files only in two inventory CSVs. Phases cited in merged PR titles: 4 of 259 (regex, titles+branches), 0 of the last 100. |
| Canonical machine state | `.ai/MASTER_STATE.json` (+ CURRENT_PHASE.md, NEXT_ACTIONS.md) | `state V6_AUDIT_REMEDIATION_IN_PROGRESS`, `currentPhase 0`, blockers `TARGET_MACHINE_PHASE0_PENDING` | f0a4f0a 2026-09-28 | **Frozen.** Not advanced by any v7 PR. The phase-0 target-machine acceptance it names never became the work driver. |
| Backlog checkpoint | `docs/planning/BACKLOG_CHECKPOINT.json` | 102 tasks (DONE 50, AUTHORITY_REQUIRED 32, BLOCKED 10, DRAFT_NOT_READY 5, IN_REVIEW 3, READY 2) | 7f4c858 2026-10-20T15:58Z (generatedAt 2026-10-19T20:45Z) | **Used 2026-10-18 to 2026-10-21** (dispatch.mjs reads it; ids `UI-NNN` cited by 59 merged PR titles/branches), then abandoned: 157 PRs merged after its last write. |
| Master work inventory | `docs/inventory/2026-10-19/` | 1,364 rows, 10 dimensions; DESIGN_ONLY 730, AUTHORITY_REQUIRED 240, INTEGRATED_NOT_VERIFIED 231 | e12dbdd era 2026-10-19 | **Snapshot, not a tracker.** product_verified = NO for 1,364/1,364. |
| Oct-31 production plan | `docs/inventory/2026-10-19/PRODUCTION_PLAN_TO_OCT31.md` | Track A (no authority) / Track B (Founder), "Realistic scope by 2026-10-31" | 2026-10-19 | Target date passed; see headline 9. |
| Production queue | `PRODUCTION-QUEUE.json` on uasco/production-queue | 16 `tasks[]`, 15 `founderQueue`, `productionLanes`, `integrationBoard`, 68 `autoMergeEvidence` | file 71d0123 2026-10-27T11:35Z; `tasks[]` content 2026-10-22 | **Used as bookkeeping**: lane definitions (A/B/C owners, paths), merge evidence, Founder queue. Its `mergeLane` text still reads "SUSPENDED (Founder)" (written 2026-10-21T01:39Z) although 259 PRs merged. |
| Lane registry | `docs/planning/LANES.json` | 26 lanes A-Z; 4 ACTIVE (A, B, C, Z coordinator), 22 STANDBY; capacity builderCap 4, ciSlots 6 | e7399db 2026-10-22 | Registry of intent; queue file says builderCap 3 (contradiction, V). |
| Lane maps | `docs/lanes/LANE-{A,B,C}-MAP.md` | "first-delivery flow" step table per lane | A 2026-10-21, B 2026-10-27, C 2026-10-27 | **Used**: lane sessions pick "the weakest wired step first" (queue `productionLanes.lanes.*.firstFocus`). |
| **Master V2 Wave 0 baseline** | `WAVE0-BASELINE.json/.md` (generated 2026-10-26; `docs/cloud-production/dispatch/WAVE0-BASELINE.md`) | 9 Lane-C packages with `priority` P0/P1/P2 + `order` 1-9 + `dependsOn`; 12 cross-lane tasks (A1-A4, B1-B5, Z1-Z3); 10 Founder decisions FD-1..FD-10; 25 gaps | 2026-10-26 | **The active plan since 2026-10-26.** Dispatch text of C-RDY-1 is in `dispatch/C-RDY-1.md`. The Master V2 *spec* itself (`UASCO_NIHAI_TEK_SISTEM_MASTER_V2_DESKTOP_UX001-071_2026-10-14.md`) is **absent** from the repo (git ls-files has no such file; WAVE0 FD-6 asks the Founder to supply it). |

**Conclusion (V + E):** four planning layers have been used in sequence, each replacing the last without closing it. The only plan with an explicit order, priorities and dependencies in force on 2026-10-27 was Master V2 Wave 0; the first-delivery flow (idea > intake > analysis > plan > run > delivery, the "31 Oct vertical flow") was the lane-level driver from 2026-10-21 (docs/lanes maps, authority requests `LANE-B-vertical-flow-wiring.md`, `LANE-C-flow-analysis.md`). No document states which layer is authoritative; there is no single roadmap.

---

## 3. Phase order and completion criteria

| Plan | Phase / wave order | Completion criterion as written | Evidence it was applied |
| --- | --- | --- | --- |
| ROADMAP.md | Periods A (trust, phases 0-8) then B..P up to phase 148; real order set by `roadmap/dependency-graph.json` (V: file exists) | Each phase: `PHASE_NNN_VERIFIED` | 0 phases verified (149 PLANNED); scheduler runtime state `.ai/runtime` is not in git = UNKNOWN |
| Oct-31 plan | Track A (no new authority) vs Track B (10 ordered Founder decisions), P0/P1/P2 | "Done when" per row (e.g. "each shard green on ubuntu and windows") | First green CI run 2026-10-19T11:27:37Z (run 39244783499); 250 CI runs failed before 2026-10-19T02:46Z; Track B partly resolved (ruleset and protected batches landed per queue text, C; #195 and #242 merged by Founder) and partly open (self-hosted runner removal AUD-003, reviewer App/identity FQ-REVIEW-SETUP, sandbox substrate AUD-005 and #231; section 10) |
| Queue statusVocabulary | QUEUED > CLAIMED > IN_PROGRESS > CODE_IMPLEMENTED > TESTED > INTEGRATED > PRODUCT_ACCEPTED | "DESIGN_ONLY, CODE_IMPLEMENTED, TESTED, INTEGRATED and PRODUCT_ACCEPTED are separate states" (queue `statusNotes`) | 15/16 tasks INTEGRATED; **0 PRODUCT_ACCEPTED** (V, node count over tasks[]) |
| Master V2 Wave 0 | C-RDY-1 (order 1) > C-CTX-1 > C-RDY-2a > C-RDY-2b > C-CTX-2 > C-EVAL-2 > C-EVAL-3 > C-CTX-3 > C-BIND-1; cross-lane B1/A1/A4 consume package 1-2 | per package `definitionOfDone` (e.g. C-RDY-1 "CODE_COMPLETE: exactly the 7 files changed; T1-T11 pass") and 8-layer readiness semantics (DEFINED..RUNNING) | Done-of-done = code + tests + review; no package is EVALUATED/RUNNING by design (0/599 roles PROFILED, 0/3594 evaluations executed, WAVE0 baseline) |
| Merge gate (all lanes) | PR > CI (ubuntu+windows) > review > auto-merge > "post-merge VERIFIED" (tree identical + probe counts) | `merge-gate` exit 0 (OPEN) bound to head SHA | "VERIFIED" in this vocabulary means tree/test identity on the base, not product verification (queue lines "post-merge VERIFIED probe 1590/1590") |

Gap: the criteria all stop at merge + unit/probe pass. No plan layer has a criterion that a *user* completes a task end to end on Windows with a real model and a sandbox; that criterion exists only as the unmet Oct-31 "M2 operational Desktop" milestone.

---

## 4. Prioritisation method

| Layer | Method (V from the files) | Weakness (E) |
| --- | --- | --- |
| dispatch.mjs (docs/planning, e7399db) | "First task in file order" with status READY, owner CLOUD, authorizedBy non-blank, all `dependsOn` exactly DONE, `protectedEdit false`, `requiresNewAuthority false` (DISPATCH.md). FIFO, no scoring. Its own authority note says the cited "Founder directive 2026-10-18" has no repository record. | Only meaningful while the BACKLOG list was current (until 2026-10-21). |
| Inventory | P0-P3 per dimension (Oct-31 plan Track A tables: P0 CI fixes, P1 merge waves, P2 renderer-only screens) | Static snapshot. |
| Queue | numeric `priority` on founderQueue (0 = urgent: FQ-REVIEW-SETUP, FQ-PQ-009; 2 = routine cleanup); `maxOpenPrs 10`; "BRANCH_ONLY at capacity" | Founder queue items carry no owner/due date; FQ-PQ-009 ("Merge #128") is still listed although #128 merged 2026-10-21T13:24:56Z. |
| Lanes | "weakest wired step first" in the first-delivery flow (queue lanes.*.firstFocus); lane sessions choose, coordinator corrects | Judgement-based; follow-ups (LOWs) displace new capability work (section 9). |
| Master V2 | explicit `priority` P0/P1/P2, `order` 1-9, `dependsOn`, `packageComparison` decision "Which package first?" (measurement before behaviour change) | Packages are ordered by risk-of-misreporting, not by user value; 12/21 items not started. |
| Review | TEP-1: routine = 2 lenses + 1 skeptic per finding; Founder/security = 3 lenses + 2 skeptics; max 3 rounds (coord-ledger.mjs) | 10 PRs ran beyond 3 distinct reviewed heads incl. base merges (V, ledger.mjs). |

---

## 5. Parallelism: lanes, coordinator, routines

| Item | Count | Evidence |
| --- | --- | --- |
| Lane registry | 26 lanes A-Z, 4 ACTIVE (A desktop UI, B backend/API, C agents/Work OS/tools, Z coordinator), 22 STANDBY | V LANES.json |
| Persistent lane sessions | 3 (A session_01MApoJPisUKhZdWpTJmcnY3, B session_01VaHcvhtW9yjHAsFktdTn5f, C session_01Vf5LYEF7vPGkRwL6X5AeGT), created 2026-10-21 (C: 07:23Z) + 1 coordinator session_01DmTHw4gBA3wvY1tKM9bk2e (since 2026-10-17) | queue `productionLanes.lanes`; g6_sessions_p1.json (C) |
| Builder cap | queue says 3, LANES.json says 4 (A+B+C+coordinator); `maxOpenPrs` 10; `ciSlots` 6 | V (contradictory documents) |
| Routines (triggers) before closure | 7 enabled (controller tick :41, Lane A :13, B :33, C :53 hourly; heartbeat every 3 h; Independent Cloud Reviewer :38 hourly; UASCO Cloud Development :29 hourly) + 5 already disabled | COORD-VERIFIED 2026-11-02 |
| Other sessions | >= 84 sessions created 2026-10-17..21 on the first listing page (builders 46, reviewers 9, lane 10, audit 1, other 18 by title heuristic); listing has_more = true | E (g6_sessions_p1.json; lower bound) |
| Bookkeeping branches | uasco/production-queue + uasco/production-reports hold 691 of 1,854 commits made since 2026-10-17 on any ref (37.3%); 28 heartbeat report commits | V `git rev-list --all --since=2026-10-17 [^queue ^reports]` (1,854 vs 1,163) |
| Open PRs now | 9 (#293, #292, #291, #288, #282, #251, #247, #231, #66) vs `maxOpenPrs 10` | V `gh api pulls?state=open` 2026-11-02 ~03:30Z |

Peak productive concurrency is therefore 3 builders + 1 coordinator + hourly routine sessions; total merged PR throughput in productive hours (V): 259 merges in 170.9 h of active time = 1.52 per hour (window 1 2026-10-17 03:33Z to 10-22 21:13Z: 185 merges / 137.7 h = 1.34 per h; window 2 2026-10-26 02:40Z to 10-27 11:55Z: 74 merges / 33.2 h = 2.23 per h).

---

## 6. Dependency handling

V (files): dependencies are modelled by hand, not enforced by a scheduler.
- Master V2: `dependsOn` arrays per package and `consumes` per cross-lane task; example B2 needs the `apps/desktop/main.mjs` GET allow-list (protected; "in flight in #242"), B3 needs `server.ts` (protected, in flight #231 and #242). `inFlightOverlaps` lists file collisions with open PRs.
- Protected paths serialize everything that touches `server.ts`, `main.mjs`, `preload.mjs`, `config/validation.json`, `config/trust-root-manifest.json`, `config/protected-paths.json`: 24 of the 259 merged PRs touch one of these files (V, files/*.json), 9 of the last 100 (#195, #199, #211, #214, #221, #242, #260, #264, #265). New tests must be registered in `config/validation.json` (S-REG, a pre-authorized TEST_REGISTRATION_APPEND tier) or CI cannot run them (queue `testRule`).
- Authority requests are the dependency carrier: 47 files under `docs/authority-requests/` (dated 2026-10-21 x11, 10-22 x17, 10-26 x19) and 35 of the last 99 non-vehicle PRs add or change one.
- Stacking: PRs wait on parents ("A2 branch-only until #287"; #199 stacked on #195; #192 stacked on #195/#199 and waited 97.8 h).
- Order rules in the queue: `capacityRule` (6 h staleness window), `claimRule` (nonce claim commit; 32 `dispatch-claim` commits on the queue branch since 2026-10-17).

Weak points (E): (1) a dependency discovered late forces a base-sync merge or a repair PR (section 9); (2) no machine check that `dependsOn` targets exist as PRs: 12 Master V2 items have no PR yet; (3) the Master V2 spec that defines the evaluation work (FD-6) is not in the repo, so EV-02..EV-06 cannot be designed against it.

---

## 7. Task distribution

Last 100 merged PRs by head-ref prefix (V, classify.mjs; PR class = PRODUCT / META (CI+governance) / TEST_ONLY):

| Owner | PRs | PRODUCT | META | TEST_ONLY |
| --- | ---: | ---: | ---: | ---: |
| lane-a (desktop UI) | 32 | 25 | 5 | 2 |
| lane-b (backend/API) | 27 | 15 | 7 | 5 |
| lane-c (agents/Work OS) | 25 | 23 | 1 | 1 |
| coord (CI, governance, protected batches) | 16 | 6 | 5 | 5 |

All 259 merged PRs: lane-a 53, lane-b 36, lane-c 33, ui-builder 28 (2026-10-18..21), coord 21, "claude/..." generic 66 (the 2026-10-17..21 wave era), mob 9 (docs only), pq 5, other 8. Costs (COORD-VERIFIED + E): lane A $4.01 per merged lane-a PR, B $3.60, C $13.02 (Lane C carries mutation-test harnesses and heavier review; its docs/lanes mutant files are 8,953 changed lines in the last 100 PRs).

Assignment mechanism: coordinator sends task packages to lane sessions (session messages and hourly lane ticks, not recorded in git; UNKNOWN beyond PR titles), claims via nonce commits. The queue `tasks[]` list stopped at 2026-10-22, so since then the **distribution is invisible in any file**: G2 reports 119 of 259 merged PRs appear in no task/merge/evidence structure (C).

---

## 8. PR and merge cycle

### 8.1 Open-to-merge time (created_at to merged_at; V, cycle.mjs over `closed-slim.json`)

| Population | N | median | p25 | p75 | p90 | mean | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Last 40 merged (by merged_at) | 40 | 1.85 h | 0.91 | 3.02 | **8.25 h** | 3.02 | 14.69 |
| Last 100 merged | 100 | 1.62 h | 0.75 | 3.74 | **14.09 h** | 10.15 | 97.83 |
| Last 100, vehicles/members excluded | 94 | 1.58 h | 0.75 | 3.42 | 8.35 h | 7.07 | 97.83 |
| All 259 merged | 259 | 1.93 h | 0.83 | 5.71 | **23.81 h** | 8.55 | 97.83 |
| Last 100, PRODUCT class | 69 | 2.20 h | 0.95 | 4.14 | 12.33 h | 9.36 | 97.83 |
| Last 100, META (CI+governance) | 18 | 1.08 h | 0.57 | 2.38 | 82.82 h | 15.12 | 87.59 |
| Last 100, TEST_ONLY | 13 | 0.75 h | 0.49 | 1.58 | 3.87 h | 7.43 | 82.78 |
| 12 protected-tier PRs (#69 #146 #167 #178 #195 #199 #211 #214 #220 #221 #225 #242) | 12 | 11.8 h | - | - | 87.3 h | 33.0 | 93.2 |
| Other non-bundle PRs from #143 on | 126 | 1.41 h | - | - | 4.47 h | - | - |

Caveats (V/E): `created_at` is the PR-open time, usually after the builder finished (queue checkpoint: claim 04:51:55Z to draft PR 04:58Z, about 7 min, for one worker task), so this is **not** idea-to-merge lead time (UNKNOWN: session transcripts). Draft periods are included (the API shows only today's draft flag). Wave members are merged when the wave merges, so member times include waiting for the wave.

Recent PR list for the last 40 (merged order) is in `g7raw/last100-classification.tsv` (rows 61-100). The slowest of the last 40: #242 14.7 h and #224 14.0 h (both Founder-tier or protected-adjacent), #264 11.1 h and #265 8.4 h (review rounds, section 8.2), #276 8.2 h.

### 8.2 Review rounds per PR (V, COORD-LEDGER.json @afe2f9b, ledger.mjs)

| Measure | Value |
| --- | --- |
| Records / PRs | 127 records on 54 PRs (47 merged, 7 open); 2026-10-26T14:05:57Z to 2026-11-02T03:20:53Z; kind full 53, delta 74 |
| Verdicts | NO_BLOCKERS* 64 (incl. 1 NO_CODE_BLOCKERS_TRAILER), BLOCKERS* 45, BASE_MERGE_ONLY 16, ROUND_LIMIT* 2 |
| Records per PR | median 2, mean 2.35, max 9 (#231) |
| Distinct substantively reviewed heads (BASE_MERGE_ONLY excluded) | 1 head 22 PRs; 2 heads 19; 3 heads 7; 4 heads 4; 5 heads 1; 9 heads 1 (#231) |
| PRs with >= 3 heads | 13 substantive (24%); 15 incl. base-merge heads; 10 incl. base merges went past the cap of 3 |
| Merged PRs with >= 1 BLOCKERS head before merge | 22 of 47 (46.8%) |
| First ledger record to merge | N=46, median 0.88 h, p90 3.64 h, max 14.2 h |
| Cases hitting the round limit | #262 (2M test gaps), #263 (2M), #264 (2M overreport), #265 (NO_BLOCKERS at limit, 4 LOW), #276 (1M process leak): all merged after the limit decision |
| Ledger coverage | 47 of the 62 merged PRs numbered #224 and up (15 without any record: #225-#230, #232-#236, #238-#240, #248) and 0 of the 197 earlier merges (the ledger starts 2026-10-26) |

Review cost (E, method: policy lenses x records): TEP-1 routine review = 2 lenses + 1 skeptic per finding; Founder/security = 3 lenses + 2 skeptics, so 127 records imply at least 254 lens executions plus skeptic passes. Per-record token cost is not in the ledger (UNKNOWN).

### 8.3 CI behaviour (V, ci.mjs over runs.jsonl, 1,745 runs)

| Measure | Value |
| --- | --- |
| Workflows | CI 1,039; UASCO Independent Review 506 (300 skipped, 179 success, 23 cancelled, 2 failure, 2 waiting); Windows Installer 182 (168 success); Desktop E2E 4; diagnosis workflows 11 |
| CI before 2026-10-19T02:46Z | 250 completed, **250 failed, 0 success** (bring-up) |
| CI since 2026-10-19T02:46Z | 788 completed: 432 success, 190 failure, 166 cancelled; **non-success 45.2%**, fail-only 24.1%; wall-clock 347.8 h, of which fail+cancel 105.8 h (30.4%) |
| PR-event CI since then | 581: 337 success / 127 failure / 117 cancelled; pass rate of non-cancelled 72.6% (matches G1) |
| CI runs per merged PR | median 2, p90 4.2, max 13 (605 PR-event runs over 259 PRs); 99 of 259 merged PRs had >= 1 failed CI run on their branch |
| Last 100 merged | 251 PR-event CI runs = 95.0 h wall-clock; 50 failures; 31 PRs with >= 1 failed run |
| Success run latency | median 26.9 min (n=337) |
| Re-runs | 47 runs with run_attempt > 1 (51 extra attempts) |
| Why red (C, G1 6.6, E by G1) | Windows validate dominates (185 of 190 failed CI runs); dependency-audit blockers 47 runs (vite Oct 21-22, glob/minimatch Nov 2: 11 advisories, COORD-VERIFIED); no discriminating signature 59 |

### 8.4 Base-merge churn and wave bundling (V, git)

- Merge commits reachable from HEAD since 2026-10-17 (`git log --since=2026-10-17 --merges`, g7raw/merges.txt): 536; 155 are "Merge pull request"; 381 are not. Of those 381: 221 name `v7/integration` in the subject and are base-into-branch syncs (e.g. 72 "Merge remote-tracking branch 'origin/v7/integration'", 43 "Merge v7/integration", 15 "Merge branch 'v7/integration'", 10 "Merge origin/v7/integration"), 72 are `wave:` commits, and 88 are other cross-branch merges (stacked-PR syncs such as "Merge remote-tracking branch 'origin/claude/coord-first-delivery-wiring' into ..."). Non-merge commits in the same period: 741. So there are 0.30 base-sync merge commits per real commit, and 0.42 if stacked-PR syncs are added. Ledger `BASE_MERGE_ONLY`: 16 of 127 records (12.6%) re-validate a head only because the base moved.
- 16 wave PRs (#64, #71, #77, #78, #80, #86, #93, #101, #105, #107, #111, #117, #124, #143, #174, #225) merged 84 member PRs; 175 unique merge commits for 259 merged PRs. The wave mechanism existed because merges were serialized behind CI and the Founder; after auto-merge (2026-10-21) the practice largely stopped (last wave #225, 2026-10-26).

### 8.5 Calendar: when work ran (V)

| Date (UTC) | Merged | PRs created | Commits (any ref) |
| --- | ---: | ---: | ---: |
| 10-17 | 7 | 10 | 27 |
| 10-18 | 2 | 23 | 82 |
| 10-19 | 40 | 39 | 211 |
| 10-20 | 59 | 52 | 224 |
| 10-21 | 17 | 29 | 224 |
| 10-22 | 60 | 67 | 343 |
| **10-23, 10-24, 10-25** | **0** | **0** | **0 / 0 / 0** (UTC; one commit carries a +03:00 committer date of 10-23 but is 2026-10-22T21:12:59Z) |
| 10-26 | 46 | 47 | 496 |
| 10-27 | 28 | 25 | 242 |
| 10-28 to 11-01 | 0 | 0 | 0 |
| 11-02 | 0 | 1 (#293) | 7 |

Commit counts are `git log --all --since=2026-10-15 --format=%cs` (committer-local date, so days near midnight can shift by the committer offset); merged and created counts are UTC from the API.

E (method: weekly resets are 7 days apart; the verified reset is Monday 2026-11-02 02:00Z, so the previous one is Monday 2026-10-26 02:00Z, and the first commit after gap 1 is at 02:39:48Z): gap 1 is consistent with an earlier weekly-limit window. If windows are anchored at Monday 02:00Z, the weekly budget lasted about 91 h (2026-10-19 02:00Z to 10-22 21:13Z) in the first week of multi-lane operation and about 34 h (10-26 02:00Z to 10-27 11:55Z) in the next, i.e. consumption rose about 2.7x after lanes, hourly ticks and two hourly routines were added on 2026-10-21/22. No repo document states the cause of gap 1; treat as UNKNOWN-cause.

---

## 9. Why work repeats

| Mechanism | Quantification (V unless marked) | Evidence |
| --- | --- | --- |
| Repair rounds after review | 22 of 47 reviewed merged PRs had >= 1 BLOCKERS head; 45 BLOCKERS records of 127; 13 PRs with >= 3 reviewed heads; #231 has 9 heads and is still open | ledger.mjs |
| LOW follow-up packages | 15 of the last 100 merged PRs are explicit LOW/nit follow-ups (title/branch regex `LOWs|nits|follow-up`; PR numbers #230 #240 #244 #250 #254 #256 #257 #272 #274 #277 #281 #283 #284 #289 #290); they change 1,188 lines (2.0% of 59,342) but each cost a PR, CI (21 PR-event runs, 8.2 h wall-clock) and 18 ledger records on 13 PRs. Chains: #269 > #277 > #283; #273 > #281 > #284; #285 > #290; #262 > #272 > #274. | classify.json, ci.mjs |
| Base-merge churn | 221 base-into-branch merge commits + 88 stacked-PR cross-branch merges since 10-17 vs 741 non-merge commits (0.30-0.42 sync merges per real commit); 16 BASE_MERGE_ONLY ledger records (12.6%) | git log --merges (merges.txt) |
| CI flake / base-wide red | 45.2% of CI runs since 10-19 not green; 105.8 h wall-clock in failed/cancelled runs; 47 re-run attempts; Windows `lv1` liveness flake (C: 4/82 Windows runs, COORD-VERIFIED) and PAR03/relfx timing tests produced a test-stability/CI-split PR family (13 of the last 100 match the title/branch regex `diag|flake|stabil|robust|watchdog|timeout|ci|sharding|split`, not hand-verified: #204 #210 #211 #214 #220 #221 #249 #252 #253 #266 #267 #270 #275; some of these are protected CI splits, #220 is a deps bump); base-wide dependency-audit red on 2026-11-02 (11 advisories) blocks all PRs | runs.jsonl; COORD facts |
| Governance/authority waits | 47 authority-request files; 12 protected-tier PRs median 11.8 h (p90 87.3 h) vs 1.41 h; 4 Oct-22 PRs (#199 #211 #214 #220) waited 82.0-93.2 h of which 77.4 h is gap 1 (E: #199's wait excluding the gap is 15.7 h; it merged 2.5 h after activity resumed) | cycle.mjs, git |
| Superseded work | 25 closed-unmerged PRs (10 of them in #8-#46, the CI bring-up era); waves absorbed 84 member PRs; queue/backlog lists rewritten 4 times (section 2) | closed-slim.json |
| Evidence artefacts | docs/lanes: 15,101 lines of maps/audit JSON + 8,953 lines of mutation harnesses in the last 100 PRs (41.7% of changed lines) | files/*.json |
| Idle/no-op firing | UASCO Cloud Development routine "NO_ACTION by design every hour" (queue FQ-ROUTINE-CLEANUP, dated 2026-10-21T03:17Z), still enabled at 02:27Z 2026-11-02; Independent Review workflow: 300 of 506 runs skipped | E: about 153 hourly firings between 2026-10-21T03:17Z and 10-27T12Z if continuously enabled (6.36 d x 24); not counted from run logs |

---

## 10. Blockers waiting on the Founder (ages at 2026-11-02T03:30Z)

| # | Item | Raised (date source) | Age | Status evidence |
| --- | --- | --- | ---: | --- |
| 1 | **#293** base-wide dependency override (`package.json` overrides is a protectedField; lockfile CI floor) blocks #292, #291, all base CI | 2026-11-02T03:04:50Z (PR created) | 0.0 d | V ledger afe2f9b `BLOCKERS_GOV_FOUNDER_AUTHORITY`; merge-gate exit 5 (COORD) |
| 2 | Protected CI-files authority (`.github/workflows/**`, `scripts/ensure-dependencies.mjs`, `package*.json`, `scripts/ci/**` + trust-root reseal) | first gate BLOCK on #68 2026-10-19T22:36Z, closed 10-20T07:13Z | about 13 d (E) | COORD-VERIFIED still pending; #293 is the newest symptom |
| 3 | #66 E2E desktop verify (draft, "Founder-held") | created 2026-10-19T22:05:04Z; last update 10-20T14:43Z | 13.2 d | V open PR list |
| 4 | FQ-REVIEW-SETUP: reviewer GitHub App, environments, secrets, `UASCO_FOUNDER_LOGIN`; IR run 39687649214 `waiting` on environment approval | queued 2026-10-21T03:17Z (git pickaxe); run created 2026-10-21T22:35:58Z | 12.0 d / 11.2 d | V queue + `gh api actions/runs/39687649214` status waiting |
| 5 | FQ-ROUTINE-CLEANUP: disable "UASCO Cloud Development" (and AUD-133 Independent Cloud Reviewer pull_request trigger) - http_api routines the agent cannot change | 2026-10-21T03:17Z / 01:39Z | 12.0 / 12.1 d | COORD-VERIFIED both still enabled 02:27Z |
| 6 | Audit-derived Founder queue (AUD-001 identities/ruleset, AUD-002 protected-paths extension, AUD-003 self-hosted runner removal, AUD-004 API-001 fix, AUD-005 sandbox substrate, new endpoints/POST allow-list, store.ts read-clone fix, MOB-11..31 authority, test-file registration, RN/Android dependencies, raise 2-builder cap): 12 entries | 2026-10-21T01:39-01:45Z | 12.1 d | V queue pickaxe; entries have no resolution field (C: the list is not maintained, e.g. FQ-PQ-009 resolved by #128 merge on 10-21) so some may be resolved out of band: UNKNOWN |
| 7 | Local Windows test worker: Founder-PC pilot + publisher credential | #190 merged 2026-10-22T06:06:41Z | 10.9 d | C (coordinator task text) |
| 8 | #231 WSL2 sandbox provider (Founder-tier; 9 reviewed heads) | created 2026-10-26T07:32:40Z | 6.8 d | V open PR list, ledger |
| 9 | #247 aut2 tmp cleanup (Founder-tier), #251 CI-TEP1 (protected) | created 2026-10-26T15:30:04Z / 16:09:37Z | 6.5 d | V open PR list |
| 10 | git-isolation central fsmonitor authority request (branch claude/lane-c-fsmon-central-authreq-1) | branch tip 2026-10-27T11:02:51Z | 5.7 d | V git; docs only, protected trust-root + reseal |
| 11 | FD-LV1 liveness flake grant (4/82 Windows runs) | PR #221 "COORD PROTECTED FD-LV1 + deps(security)" merged 2026-10-26T05:11:00Z | - | V merge; the *residual* grant named by COORD is UNKNOWN (not in repo) |
| 12 | Reviewer OAuth token renewal (REVIEWER_AUTH_REJECTED) | UNKNOWN | UNKNOWN | COORD-VERIFIED; no repo date |
| 13 | Master V2 FD-1..FD-10 (alias approval, evaluation authority, real model runs on Founder machine, protected wiring batch, knowledge acquisition, **supply the Master V2 spec file**, validator pins, CI tooling, technology verification, S-REG) | 2026-10-26 (WAVE0 generatedAt) | 7 d | V WAVE0-BASELINE.json founderDecisions (9 pending per G2, C) |

---

## 11. Real vs reported progress

### 11.1 Ladder by claim

| Claim in a plan or report | Source | What I can prove | Ladder |
| --- | --- | --- | --- |
| "49 of the 50 capabilities VERIFIED" | Final Audit v1.0 (2026-10-20), 01 report line 18 | V in the audit = component-level; the same report says "0 of 17 subsystems production-ready" | TESTED(unit) / INTEGRATED |
| 15 of 16 queue tasks INTEGRATED | PRODUCTION-QUEUE.json tasks[] | statuses counted; 0 PRODUCT_ACCEPTED | INTEGRATED |
| BACKLOG DONE 50/102 | BACKLOG_CHECKPOINT.json | file self-declares "DONE means merged"; strict re-grade by G2 gives 12 DONE (C) | CODED/INTEGRATED |
| "85 of 246 screens working today" | MASTER_WORK_INVENTORY.md (2026-10-19) | same document: product_verified NO for 1,364/1,364 (V recount) | INTEGRATED_NOT_VERIFIED |
| "post-merge VERIFIED probe N/N" | queue evidence strings | tree identity + probe/unit counts on Linux | TESTED(unit) |
| Windows app builds, installs, launches | G3 A1-A5; run 40497319565 | V run success on GitHub-hosted windows-latest at 0b71650; silent install into %TEMP% | VERIFIED_REAL_ENV (CI only) |
| Product pipeline with a real model | G4/G5 (C) | single toy run 2026-10-14 (32 s, `add(a,b)`), predates SBX-GATE; installed app cannot run project code (`SANDBOX_UNAVAILABLE`) | TESTED(unit) with fakes; one toy VERIFIED_REAL_ENV |
| Master V2 Wave 0 readiness | WAVE0 baseline | roles PROFILED 0/599, KNOWLEDGE_READY 0/599, EVALUATED 0/3594, tool adapters NOT_IMPLEMENTED 194/194 (counts C from WAVE0, re-derived there at 0ddb170) | CODED measurement of absence |
| End-user usable product | Oct-31 M2 | no signed build, 0 releases/tags (C: G3 line 16) | **not USABLE_BY_END_USER** |

### 11.2 Reporting-vocabulary drift (V)
The words DONE, VERIFIED, CLEAN, NO_BLOCKERS and INTEGRATED describe process states (merged, CI green, reviewer lens found no defect, tree identical), not product verification. The ledger's 64 NO_BLOCKERS are LLM-review verdicts (reviews not re-run here). Queue `statusNotes` states the distinction, but the coordinator's PR evidence lines use "post-merge VERIFIED" as the terminal word.

### 11.3 Stale or contradictory records (V)
- Queue `mergeLane` "SUSPENDED (Founder)" vs 259 merged PRs; `builderCap 3` vs LANES builderCap 4.
- `integrationBoard.prs` still lists #224, #229, #237, #239 as DRAFT although merged (G2, C).
- BACKLOG last write 2026-10-20T15:58Z; 157 merged PRs newer (V).
- `founderQueue` FQ-PQ-009 open although #128 merged 2026-10-21T13:24:56Z (V).
- The coordinator session task list changes between reminders (17 tasks flipped to completed with "superseded/folded" labels, G2 section 2, C).

### 11.4 Reconciliation note for the coordinator
G2 counts 189 of 259 merged PRs as "touching product code" using `git diff merge^1 merge`; for the 84 wave members that diff is the whole wave, which inflates the figure. Using each PR's own file list (`/pulls/<n>/files`) the number is **165** (153 non-vehicle PRs + 12 vehicles). Both agree on the direction (about 64-73% of PRs touch apps/ or core/).

---

## 12. Meta-infrastructure share (classification of the last 100 merged PRs)

Rule (V, classify.mjs): each changed file is classed by path. PRODUCT = `apps/desktop|control-api|mobile` (non-md), `core/**`. TEST = `tests/**`. META_CI = `.github/**`, `scripts/**`, `package*.json`, `.nvmrc`, `docs/cloud-production/ci/**`. META_GOV = `config/**`, `registries/**`, `audit/**`, `automation/**`, `docs/{cloud-production,planning,lanes,authority-requests,authority,governance,inventory}/**`. DOC_PRODUCT = other docs. A PR is PRODUCT if it touches any PRODUCT file; else META_CI if any META_CI file; else META_GOV; else TEST_ONLY; else DOC_ONLY. Window = last 100 by merged_at: #190 (2026-10-22T06:06:41Z) to #290 (2026-10-27T11:34:55Z).

### 12.1 By PR count

| Class | All 100 | Excl. wave vehicle #225 (99) | All 259 merged | 243 excl. 16 vehicles |
| --- | ---: | ---: | ---: | ---: |
| PRODUCT (any apps/core file) | 69 | 68 | 165 | 153 |
| META_CI | 9 | 9 | 17 | 17 |
| META_GOV | 9 | 9 | 38 | 34 |
| TEST_ONLY | 13 | 13 | 30 | 30 |
| DOC_PRODUCT_ONLY | 0 | 0 | 9 (mobile docs) | 9 |
| **CI/governance/docs-only share (META)** | **18%** | **18.2%** | **21.2%** | **21.0%** |
| META + TEST_ONLY share | 31% | 31.3% | 32.8% | 33.3% |

Mixed PRs: 59 of the 99 non-vehicle PRs also touch at least one META file (41 PRODUCT PRs carry meta files); 35 add or change an authority-request document; 31 touch `docs/lanes`.

### 12.2 By changed lines (additions + deletions; last 100 excl. vehicle, total 57,716)

| Bucket | Lines | Share |
| --- | ---: | ---: |
| Tests (`tests/**`) | 19,843 | 34.4% |
| **Product code** (core 4,947; apps/desktop 3,775; control-api 573) | **9,295** | **16.1%** |
| docs/lanes maps + audit/evidence JSON | 15,101 | 26.2% |
| docs/lanes mutation harnesses (`LANE-*-mutants.{mjs,json}`) | 8,953 | 15.5% |
| docs/authority-requests | 1,527 | 2.6% |
| scripts/local-worker | 1,078 | 1.9% |
| registries | 955 | 1.7% |
| scripts/e2e | 649 | 1.1% |
| scripts (root), config, root files, docs/ux, docs/architecture | 314 | 0.5% |

All 243 non-vehicle merged PRs: product-code lines 22,343 of 136,677 = 16.3%.

### 12.3 How big is a "product" PR
Of the 68 PRODUCT PRs (last 100, excl. vehicle): product-code lines median 40.5, p25 13.75, p75 151.5, max 1,699 (#226 desktop flow chain); 37 below 50 lines, 47 below 100; 25 have more than 5x as many non-product lines; 2 have product code at 50% or more of their changed lines (tests dominate, which is normal for this repo's test-per-change rule). Across all 153 non-vehicle PRODUCT PRs: median 73.

### 12.4 Interpretation (E)
By count the project is not mostly meta (about 1 PR in 5), but by weight it is: roughly half the changed lines are CI, governance, lane maps/audits, authority requests, mutation harnesses and registries, and only one in six lines is product code. The product work that does merge is mostly small hardening increments (LOW follow-ups, L10N, busy-state notes, readiness measurement) rather than new user-facing capability.

---

## 13. Biggest time and resource sinks (ranked by measured size)

| Rank | Sink | Size (V unless E) |
| ---: | --- | --- |
| 1 | Account usage-limit stalls | 211.8 h zero-commit time = 55.2% of 383.9 h; 1 of 2 gaps COORD-VERIFIED |
| 2 | Coordinator session cost | $4,436.40 = 85.2% of the four named sessions; 53.2M output tokens, 10.19B cache-read tokens (COORD-VERIFIED) |
| 3 | CI: failed + cancelled runs | 105.8 h of 347.8 h wall-clock since 10-19 (30.4%); 45.2% of runs not green; plus 250 failed runs (0 green) before 10-19 |
| 4 | Review/repair loops | 127 ledger records; 45 BLOCKERS, 16 base-merge-only; >= 254 lens executions (E); 13 PRs with >= 3 heads |
| 5 | Meta artefacts | 49.5% of changed lines are CI/governance/lane-evidence; 35 of 99 PRs add authority requests |
| 6 | Founder-gated waits | median 11.8 h / p90 87.3 h for 12 protected-tier PRs; 4 PRs waited 82-93 h; 13 open items aged 6-13 d |
| 7 | Base-merge churn and waves | 221 base-into-branch merges + 88 stacked-PR syncs; 72 wave commits; 16 BASE_MERGE_ONLY re-reviews |
| 8 | LOW follow-up chains | 15 of 100 PRs, 2.0% of lines, each a full PR+CI+review cycle |
| 9 | No-op hourly routines | about 153 firings of "NO_ACTION by design" (E); ~115 stale controller ticks queued during the freeze (COORD-VERIFIED) |
| 10 | Mutation-harness and audit evidence | 8,953 + 15,101 changed lines in docs/lanes (41.7%) |

---

## 14. Why the project is late, and plan-vs-reality drift

### 14.1 Why late (E, each backed by a V fact above)
1. **The target was set against the plan's own findings.** The 2026-10-19 plan already stated that nothing was deliverable by 2026-10-31 and that the main blockers were Founder-gated (decisions 1-10). On 2026-11-02 parts of Track B are still open (AUD-003 self-hosted runner removal, FQ-REVIEW-SETUP, AUD-005 sandbox substrate with #231), while others were resolved after 2026-10-21 (protected batches #195, #242; ruleset per queue text, C).
2. **Half the calendar had no execution** (55.2%), because of usage limits, not because of merge friction.
3. **Throughput went into hardening and process, not capability.** 16.1% product-code lines; median product PR 40 lines; 15% of recent PRs are LOW follow-ups; 18% of PRs are CI/governance only.
4. **The product's decisive capabilities are blocked on authority or environment:** no sandbox on Windows for the installed app (C), no signed installer, 0 releases; Windows journey E2E and WSL2 sandbox (#231) wait on the Founder; reviewer identity/App setup waits since 2026-10-21.
5. **Scope is far larger than the delivery unit.** 149 phases, 599 roles, 252 screens, 3,594 evaluation specs vs 21 Master V2 items of which 6 merged in the roughly 16 productive hours between the first package PR and the limit.
6. **Quality gating works but multiplies cycles**: 46.8% of reviewed merged PRs needed at least one repair head; CI green rate 54.8% of runs.

### 14.2 Drift table

| Plan statement | Reality (V) |
| --- | --- |
| ROADMAP.md: 149 phases, `PHASE_NNN_VERIFIED` exits, 12 build waves | 0 verified; file untouched 2026-09-23 |
| `.ai/MASTER_STATE.json`: phase 0, target-machine acceptance pending | not advanced since 2026-09-28; 259 PRs ignore it |
| Queue: merge lane SUSPENDED; builderCap 3; maxOpenPrs 10 | 259 merged; LANES builderCap 4; 9 open |
| Queue: 16 tasks, statuses up to PRODUCT_ACCEPTED | 15 INTEGRATED, 0 accepted; list static since 2026-10-22 |
| Backlog: 102 tasks, `dispatch.mjs` FIFO | abandoned 2026-10-21; 157 PRs landed after |
| Oct-31 M2 "operational Desktop" | missed; 0 verified rows; 0 releases |
| Master V2: ordered, dependency-aware packages | 6/21 merged, 3 open, 12 not started after about 16 productive hours; spec doc absent |
| Founder queue items (15) with priority | no owners/due dates/resolutions; oldest 12.1 d |
| TEP-1 `maxReviewRounds 3` | 10 PRs beyond it (incl. base merges) |

---

## 15. Remaining-work items surfaced by this phase

Priorities: P0 blocks everything or the Founder's stated goal; P1 high; P2 medium; P3 low.

| ID hint | Module | Prio | Item | Evidence |
| --- | --- | --- | --- | --- |
| WP-FOUNDER-293 | governance | P0 | Founder authority for `package.json` overrides (#293) or alternative; until then #292 and #291 cannot merge and all base CI is red | ledger afe2f9b; run 41377356505 (COORD) |
| WP-VERIFY-REAL | product | P0 | First real-environment end-to-end run of the first-delivery flow on a Founder Windows PC with a sandbox; today only TESTED(unit) plus a CI install/launch smoke | G3/G4/G5 (C); run 40497319565 |
| WP-LIMIT-BUDGET | operations | P0 | Usage-budget governance before any resume: 211.8 h lost to limits; consumption rose about 2.7x per week (E) | git gaps; COORD |
| WP-ROADMAP-ONE | planning | P1 | Declare one authoritative roadmap and retire the others (ROADMAP.md, MASTER_STATE, BACKLOG, queue tasks, Oct-31 plan, Master V2) | section 2 |
| WP-MASTERV2-REST | master-v2 | P1 | 12 of 21 Master V2 items have no PR: C-CTX-2, C-EVAL-2, C-EVAL-3, C-CTX-3, C-BIND-1, A3, B3, B4, B5, Z1, Z2, Z3; 3 more open (#288, #291, #292) | WAVE0-BASELINE.json; PR titles/branches |
| WP-MASTERV2-SPEC | master-v2 | P1 | Supply the Master V2 spec file (FD-6); EV-02..EV-06 cannot be designed without it | WAVE0 FD-6; git ls-files |
| WP-FOUNDER-CIFILES | governance | P1 | Protected CI-files authority + reseal (about 13 d) | COORD; #68 |
| WP-FOUNDER-ROUTINES | operations | P1 | Founder to disable Cloud Development and Independent Cloud Reviewer routines | COORD; queue FQ-ROUTINE-CLEANUP |
| WP-FOUNDER-IR | governance | P1 | Independent Review bootstrap (App, environments); run 39687649214 waiting 11.2 d; reviewer OAuth renewal | gh api; COORD |
| WP-FOUNDER-HELD | governance | P1 | Decide #66 (13.2 d), #231 (6.8 d), #247 and #251 (6.5 d) and the git-isolation request (5.7 d) | open PR list; git |
| WP-CI-STABILITY | CI | P1 | 45.2% of CI runs not green since 10-19; Windows validate dominates; lv1/PAR03/relfx flakes; dependency audit drift | runs.jsonl; G1 |
| WP-PR-OPEN | delivery | P1 | #288 (BLOCKERS 2M+14L), #282 (delta BLOCKERS 1M+2L, round limit risk) unresolved | COORD |
| WP-SCOPE-BALANCE | planning | P2 | Product-code share 16.1% and 49.5% meta lines; set a per-package product-lines and meta budget; stop LOW chains (15 of 100 PRs) by batching LOWs | classify.mjs |
| WP-TRACKING-TRUTH | tracking | P2 | One machine-readable task register fed by PR merges (119 merged PRs in no register per G2; queue and backlog stale; vocabulary conflates process and product states) | G2 (C); section 11 |
| WP-FOUNDERQ-OWNERS | governance | P2 | Add owner, due date and resolution to each of the 15 founderQueue items; remove resolved ones (FQ-PQ-009) | queue JSON |
| WP-CAP-CONTRADICTION | planning | P3 | Reconcile builderCap 3 vs 4 and mergeLane text in the queue | PRODUCTION-QUEUE.json; LANES.json |

---

## 16. Not verifiable by me

- Dispatch-to-PR lead time and builder effort per PR (session transcripts and routine logs not read; PR `created_at` is only the PR phase).
- The cause of the 77.4 h gap of 2026-10-22/26 (no document states it; the weekly-window explanation is an inference).
- Actual billed cost (only platform-reported API-equivalent usage was given) and per-routine token share; cost of other sessions (>= 84 created since 10-17).
- Whether the 12 audit-derived `founderQueue` entries were resolved out of band; date of the reviewer OAuth rejection; the content of the residual FD-LV1 grant.
- Review-lens counts and token cost per ledger record (only verdicts are stored).
- Draft-to-ready timestamps (timeline events not fetched); thus draft time inside the open-to-merge figures.
- Local scheduler runtime state `.ai/runtime` (not in git); the Master V2 spec document (absent); whether any local Founder-PC run exists (none recorded in the repo).
- G1/G2/G3/G4/G5 figures cited as C were not re-verified here, except those marked V (CI totals and pass rate, merged/closed/open counts, ledger statistics, merged-per-day, installer run).
- The 9 open PRs were read at about 03:30Z; #282 head was b13e23d (not 658095e) at that time, so Lane C pushed again after the COORD-VERIFIED state.
