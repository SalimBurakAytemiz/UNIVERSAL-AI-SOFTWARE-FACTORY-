<!-- //TR: UASCO kapanış denetimi kanıt dosyası — G2 kayıt baseline (2026-11-02, salt-okunur denetçi çıktısı) -->
# G2 - Records baseline and task inventory (Phase 1)
Auditor: g2-baseline-records (read-only). As of 2026-11-02 ~03:05Z. Base: v7/integration @ 0b71650fa88b9802968562c63ca33f8b56e9648b (VERIFIED: origin/v7/integration == 0b71650, HEAD of audit-wt). Queue/ledger branch uasco/production-queue @ 3074ec2 (2026-11-02T02:52:02Z; moved from 47d46b0 during this audit, so ledger counts below are at 3074ec2).
Companion file: G2-records.json (1477 records: {id,source,title,status,pr,commit,lastUpdate,owner,evidence} + rawStatus, dedupKey, kind, flags). Build scripts are in this folder (_build.mjs, _analyze.mjs, _report.mjs) so every number can be recomputed.

Evidence tags: **V** = I recomputed it from a primary source (file, git object, GitHub REST API on 2026-11-02); **C** = a document says so, not re-verified; **E** = my inference (method stated). Where a number is E it says so.

## 1. Headline facts
1. V: GitHub has 292 PRs, all against v7/integration: 259 merged, 25 closed unmerged, 8 open (gh api repos/.../pulls?state=all, pages 1-3; ids 1..292 unique). Every merge_commit_sha is an ancestor of 0b71650; 256 of 259 PR heads are ancestors (the other 3, #2 #3 #5, landed as content-identical commits, per BACKLOG notes C).
2. V: 245 of 259 merged PRs have validate(ubuntu)+validate(windows) = success on the PR head or the merge commit (check-runs API); 14 do not (#1, #2, #3, #4, #5, #6, #7, #9, #10, #99, #199, #211, #214, #220). 189 of 259 merged PRs touch apps/ core/ domain-packs/ models/ (product code); the rest are docs/tests/infra only.
3. V: No record anywhere is VERIFIED_REAL_ENV or higher. inventory rows with product_verified != NO: 0 of 1364 (V recount of the 2026-10-19 JSON, a C-dated snapshot). Registry recount (V): roles 599 all proficiencyStatus NOT_EVALUATED/runtimeStatus UNKNOWN, skills-v2 425 NOT_CERTIFIED, technologies 415 SEED_PROFILE, tool-adapters 194 + capabilities 110 + fabrics 45 all NOT_IMPLEMENTED, evaluation specs 3594 all NOT_EXECUTED. Strict DONE therefore = only non-product records (docs/tests/infra) that are merged with CI evidence.
4. V: BACKLOG_CHECKPOINT.json holds 102 tasks (101 unique; B2-UI-023 duplicateOf UI-023); raw DONE 50, AUTHORITY_REQUIRED 32, BLOCKED 10, DRAFT_NOT_READY 5, IN_REVIEW 3, READY 2. Last written 2026-10-20T15:58:29Z (git log), i.e. 157 merged PRs are newer than the file. 6 of its records contradict GitHub today (section 6).
5. V: PRODUCTION-QUEUE.json tasks[] has 16 records (15 INTEGRATED, 1 TESTED) last written 2026-10-22; integrationBoard.merges has 69 entries (#225..#290); autoMergeEvidence 68. 119 of 259 merged PRs appear in none of tasks/merges/autoMergeEvidence (112 pre-#143 PRs and 7 later ones; section 8). The board's prs[] still lists #224 #229 #237 #239 as DRAFT although all four are merged (V).
6. V: 187 of 292 PRs are cited by no BACKLOG/queue/Master-V2/inventory record; 168 of those are merged. Delivered work is recorded mostly in PR titles, not in the task registers.
7. V: Roadmap = 149 phase contracts + 34 review packages, every one state=PLANNED (roadmap/contracts/*.json, review-packages.json), scheduler-state.template.json 149 PENDING; the runtime scheduler state (.ai/runtime) is not in git = UNKNOWN. The 2026-10-19 inventory (C) says phases are DESIGN_ONLY 100 / IN_PROGRESS 33 / MERGED_NOT_INTEGRATED 9 / INTEGRATED_NOT_VERIFIED 3 / AUTHORITY_REQUIRED 4 = status conflict (section 6).
8. V: Master V2 (WAVE0-BASELINE.json, 2026-10-26): 9 Lane-C packages (3 merged: C-RDY-1 #260, C-CTX-1 #265+#289, C-RDY-2a #264; 1 open: C-RDY-2b #288 draft with BLOCKERS 2M+14L; 5 with no PR or branch), 12 cross-lane tasks (4 done-unverified, 2 open PR, 6 not started), 10 Founder decisions (9 pending), 25 gaps (findings).
9. V: Ledger (COORD-LEDGER.json @3074ec2): 126 review records on 53 PRs, 2026-10-26T14:05Z..2026-11-02T02:52Z; full 52 / delta 74; 64 NO_BLOCKERS*, 44 BLOCKERS*, 16 BASE_MERGE_ONLY, 2 ROUND_LIMIT_*. 15 PRs reached >=3 distinct reviewed heads (the policy cap maxReviewRounds=3); 10 went beyond it. Ledger covers 53 of 292 PRs; 15 PRs merged in #224..#290 have no ledger record.
10. V: Lane registry LANES.json: 26 lanes A..Z (4 ACTIVE, 22 STANDBY), builderCap 4, ciSlots 6; merged via #189 (3dd5f77). Agent/role registries recounted in section 9.
11. V: Merge cadence: 0 PRs merged on 2026-10-23/24/25 (merged-per-day: 10-17=7 10-18=2 10-19=40 10-20=59 10-21=17 10-22=60 10-26=46 10-27=28); last merge #290 2026-10-27T11:34:55Z.
12. E: De-duplicated delivery-task universe = 241 keys (16 DONE, 81 DBU, 17 IP, 24 NS, 91 BL, 5 UK, 7 excluded) plus 168 merged PR-only work items with no task record; screens 252 keys (246 unique); roadmap 183 keys all NS. Method in section 4.

## 2. Sources, as-of dates and trust
| Id | Source (path) | Records | Last write / as-of | Staleness vs base | Trust |
| --- | --- | --- | --- | --- | --- |
| S1 | docs/planning/BACKLOG_CHECKPOINT.json @0b71650 | 102 tasks (+2 relations) | file generatedAt 2026-10-19T20:45Z; last git write 2026-10-20T15:58Z | 157 merged PRs newer | V file content; statuses C (self-declared "DONE means merged"), re-graded by me against GitHub |
| S2 | pqw/docs/cloud-production/PRODUCTION-QUEUE.json @3074ec2 | tasks 16, coordinatorBuild 17, founderQueue 15, integrationBoard.merges 69 + prs 8, autoMergeEvidence 68 | last commit 2026-10-27T11:35Z; tasks[] last 2026-10-22 | board.at 2026-10-26T21:00Z, 29 merges newer | V content; statuses C |
| S3 | pqw/docs/cloud-production/COORD-LEDGER.json @3074ec2 | 126 review records (tests[] = 0) | 2026-11-02T02:52Z | live | V content; verdicts C (review workflow not re-run) |
| S4 | GitHub REST pulls?state=all + check-runs + local git | 292 PRs | 2026-11-02 | live | V (primary) |
| S5 | docs/planning/LANES.json @0b71650 | 26 lanes | e7399db 2026-10-22 | - | V (registry, not work items) |
| S6 | master-v2/WAVE0-BASELINE.json (scratchpad) | 9 pkgs, 12 cross-lane, 10 FD, 25 gaps | 2026-10-26 (base 0ddb170) | PR state re-checked by me | C plan; PR evidence V |
| S7 | roadmap/contracts/*.json + review-packages.json + build-waves.json | 149 phases, 34 packages, 12 waves | 2026-09-28 (V6 era) | untouched since | V file content (state=PLANNED) |
| S8 | docs/inventory/2026-10-19/master-work-inventory.json | 1364 rows / 10 dimensions | 2026-10-19T05:00Z @e12dbdd | 250 merged PRs newer | C snapshot; re-graded where cited PRs merged (E) |
| S9 | UASCO-FINAL-AUDIT-v1.0/09 MASTER FINDINGS.json | 133 findings (P0 6/P1 32/P2 64/P3 31 recounted V) | 2026-10-20 | pre-dates 157+ merges | C (treated as findings, not work items) |
| S10 | docs/authority-requests/* | 47 files | 2026-10-21..27 | - | free text; no machine status |
| - | registries/*.json (52 files) | see section 9 | various | - | V counts |
| - | coordinator session task list (visible to me in system reminders only) | 133 tasks | changed between two reminders (17 tasks flipped in_progress -> completed with "superseded/folded" labels) | - | C, NOT used for counts; shown only as evidence that in-session lists churn |

## 3. Normalisation rules (how raw status maps to the 7 classes)
- **DONE** (strict) = merge verified (PR merged per API and head/merge commit is an ancestor of 0b71650) AND CI evidence (validate ubuntu+windows success on head or merge commit) AND no product-code change needing real-environment proof (docs/tests/infra/governance-only PR). Only 67 PRs and 12 BACKLOG records qualify.
- **DONE_BUT_UNVERIFIED (DBU)** = recorded done/merged/integrated but (a) no merge evidence, or (b) no CI evidence, or (c) product code merged with no real-environment/product verification (ladder stops at INTEGRATED/TESTED(unit)). 189 of 259 merged PRs are product-code PRs, so DBU is the honest ceiling for them.
- **IN_PROGRESS** = open PR or active branch with no merge. **NOT_STARTED** = planned/design/READY/DRAFT with no code on base and no open PR (a PR closed unmerged with nothing landed counts here). **BLOCKED** = BLOCKED, AUTHORITY_REQUIRED, FOUNDER_ONLY, Founder-held/tier PRs. **UNKNOWN** = evidence missing or contradictory (e.g. authority-request free text).
- Inventory mapping (S8): INTEGRATED_NOT_VERIFIED/IMPLEMENTED_NOT_TESTED>DBU; DESIGN_ONLY/NOT_STARTED>NS; IN_PROGRESS/PENDING_CI/PENDING_REVIEW/MERGED_NOT_INTEGRATED>IP; AUTHORITY_REQUIRED/BLOCKED>BL; DUPLICATE/OBSOLETE>EXCLUDED. Rows whose cited PRs are all merged now were re-graded to DBU (E; 34 rows, flag REGRADED). Rows whose cited PRs are all closed unmerged became UNKNOWN.
- Records evidence is recomputed: PR numbers from pr/prs fields or notes, commit SHAs from notes (ancestor test + first-parent landing merge), then GitHub PR state and check-runs. Notes-derived evidence is E.

## 4. Counts per source (normalised, recomputed)
| Source | Total | DONE | DBU | IP | NS | BL | UK | Excl | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1:BACKLOG_CHECKPOINT | 102 | 12 | 43 | 0 | 5 | 41 | 0 | 1 | 0 |
| S2:PRODUCTION-QUEUE.tasks | 16 | 4 | 11 | 0 | 0 | 0 | 0 | 1 | 0 |
| S2:PRODUCTION-QUEUE.coordinatorBuild | 17 | 0 | 16 | 0 | 0 | 0 | 1 | 0 | 0 |
| S2:PRODUCTION-QUEUE.founderQueue | 15 | 0 | 1 | 0 | 0 | 14 | 0 | 0 | 0 |
| S6:MASTER-V2.packages | 9 | 0 | 3 | 1 | 5 | 0 | 0 | 0 | 0 |
| S6:MASTER-V2.crossLane | 12 | 0 | 4 | 2 | 6 | 0 | 0 | 0 | 0 |
| S6:MASTER-V2.founderDecisions | 10 | 0 | 1 | 0 | 0 | 9 | 0 | 0 | 0 |
| S6:MASTER-V2.gaps | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 25 |
| S7:ROADMAP.contracts | 149 | 0 | 0 | 0 | 149 | 0 | 0 | 0 | 0 |
| S7:ROADMAP.review-packages | 34 | 0 | 0 | 0 | 34 | 0 | 0 | 0 | 0 |
| S8:INVENTORY-2026-10-19.screens | 252 | 0 | 90 | 3 | 7 | 145 | 1 | 6 | 0 |
| S8:INVENTORY-2026-10-19.workspaces | 18 | 0 | 14 | 0 | 0 | 4 | 0 | 0 | 0 |
| S8:INVENTORY-2026-10-19.ux-decisions | 71 | 0 | 38 | 0 | 3 | 30 | 0 | 0 | 0 |
| S8:INVENTORY-2026-10-19.labs | 25 | 0 | 0 | 1 | 15 | 9 | 0 | 0 | 0 |
| S8:INVENTORY-2026-10-19.endpoints | 85 | 0 | 60 | 0 | 0 | 17 | 0 | 8 | 0 |
| S8:INVENTORY-2026-10-19.data-persistence | 43 | 0 | 24 | 6 | 4 | 6 | 0 | 3 | 0 |
| S8:INVENTORY-2026-10-19.tasks | 107 | 0 | 41 | 14 | 9 | 32 | 4 | 7 | 0 |
| S8:INVENTORY-2026-10-19.requirement-sets | 15 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 |
| S9:AUDIT-V1.0.findings | 133 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 133 |
| S10:docs/authority-requests | 47 | 0 | 0 | 0 | 0 | 0 | 47 | 0 | 0 |
| S4:GITHUB-PRS | 292 | 67 | 192 | 3 | 0 | 5 | 0 | 25 | 0 |

Not in the table (aggregated only): inventory roles 599 (DESIGN_ONLY 584, MERGED_NOT_INTEGRATED 15; = registries/role-definitions.json roles[599], all NOT_EVALUATED) and inventory phases 149 (duplicate of S7 PH-000..148, key PH-nnn). Raw inventory status counts (C, from JSON): INTEGRATED_NOT_VERIFIED 231, DESIGN_ONLY 730, AUTHORITY_REQUIRED 240, IN_PROGRESS 42, PENDING_CI 36, MERGED_NOT_INTEGRATED 38, OBSOLETE 18, BLOCKED 7, NOT_STARTED 7, DUPLICATE 6, IMPLEMENTED_NOT_TESTED 5, PENDING_REVIEW 4 = 1364.

**Owner flow (S1, V file owner field):** CLOUD 57 (DONE-class 45, BL 10, NS 1, excl 1), FOUNDER 30 (all BLOCKED), LOCAL 15 (DONE-class 10, NS 4, BL 1). requiresNewAuthority=true on 41 of 102, protectedEdit=true on 17 (V).

### 4.1 De-duplication
**Key (canonical id) per record**: screens = UI-nnn (S1 id incl. composites "UI-037+046", "UI-027+UI-220"; S1 B2-UI-nnn; S2 queue "source" mapping PQ-003>UI-050, PQ-004>UI-246, PQ-005>UI-034 and tasks UI-110/UI-105; S8 screens UI-nnn); aliases L-WORKFORCE>UI-197, L-TOWER-TRACE>UI-226, L-ASSURANCE>UI-049/050/051, L-ROUTES>UI-070/078; phases PH-nnn (S7 == S8 phases); MOB-n; PQ-nnn (PQ-008-R1 is the repair of PQ-008, same PR #159); V2-<id> (S6); other S1/S2 ids as-is. PRs are evidence, not work items, except PR-only work (below). Evidence-type links (shared PR, wave PR) are NOT used to merge, because one wave PR carries 6-26 tasks.
Status of a key = most advanced evidence-checked record among S1/S2/S6 (if none, S8, then S7). 1477 records > 987 record-key entries > **933 unique keys** (multi-record keys 48; keys seen in >1 source 47). Within-source duplicates: B2-UI-023>UI-023 (S1), PQ-008-R1>PQ-008 (S2), 6 inventory screen rows DUPLICATE.
| Key type | Keys | DONE | DBU | IP | NS | BL | UK | Excl |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SCREEN | 252 | 0 | 92 | 1 | 7 | 147 | 0 | 5 |
| TASK_DELIVERY | 88 | 16 | 31 | 0 | 4 | 36 | 1 | 0 |
| FOUNDER_ITEM | 15 | 0 | 1 | 0 | 0 | 14 | 0 | 0 |
| PLAN_PACKAGE | 21 | 0 | 7 | 3 | 11 | 0 | 0 | 0 |
| FOUNDER_DECISION | 10 | 0 | 1 | 0 | 0 | 9 | 0 | 0 |
| ROADMAP | 183 | 0 | 0 | 0 | 183 | 0 | 0 | 0 |
| SURFACE_OTHER | 242 | 0 | 136 | 7 | 22 | 66 | 0 | 11 |
| TASK_INV_PT | 107 | 0 | 41 | 14 | 9 | 32 | 4 | 7 |
| REQUIREMENT_SET | 15 | 0 | 0 | 0 | 15 | 0 | 0 | 0 |
| **ALL KEYS** | 933 | 16 | 309 | 25 | 251 | 304 | 5 | 23 |
| subtotal delivery tasks (TASK_DELIVERY+PLAN_PACKAGE+FOUNDER_ITEM+FOUNDER_DECISION+TASK_INV_PT) | 241 | 16 | 81 | 17 | 24 | 91 | 5 | 7 |

Caveats (E): (1) the inventory README forbids adding screens, workspaces, UX decisions, endpoints and data rows (they describe the same code from different angles), so 933 is an upper bound of distinct listed things, not a work estimate; the safe headline pair is screens 252 keys + delivery tasks 241 keys. (2) S8 PT-* (107) cannot be linked to S1/S2 ids; only 10 of 45 PT rows that cite PRs share a PR with an S1/S2 record, so the delivery-task universe may overstate unique work by about 10. (3) 187 PRs have no planning record (merged 168); 15 merged PRs are integration waves that re-carry earlier member PRs, so merged PR count 259 double-counts roughly 15 wave carriers (E).

## 5. GitHub PR truth by lane (S4, V)
| Branch family / lane | PRs | DONE | DBU | IP | BL | Excl (closed unmerged) |
| --- | --- | --- | --- | --- | --- | --- |
| LANE_A | 58 | 8 | 45 | 0 | 1 | 4 |
| CLOUD-PROD/GOV/CI | 39 | 16 | 18 | 0 | 1 | 4 |
| LANE_B | 38 | 14 | 22 | 1 | 1 | 0 |
| LANE_C | 35 | 4 | 29 | 2 | 0 | 0 |
| UI-BUILDER | 30 | 0 | 28 | 0 | 0 | 2 |
| COORD | 24 | 10 | 11 | 0 | 2 | 1 |
| WAVE(integration) | 19 | 5 | 9 | 0 | 0 | 5 |
| TEST-BUILDER | 15 | 0 | 14 | 0 | 0 | 1 |
| L-BUILDER | 9 | 0 | 5 | 0 | 0 | 4 |
| MOBILE-DOCS | 9 | 8 | 1 | 0 | 0 | 0 |
| LOCAL | 8 | 0 | 7 | 0 | 0 | 1 |
| PQ-BUILDER | 8 | 2 | 3 | 0 | 0 | 3 |
Merged kind (git diff merge^1..merge, V): PRODUCT 189, INFRA 15, DOC 28, TEST 19, DOC_TEST 8. Open PRs CI at head (V, API 2026-11-02): #66 green, #247 green, #251 green, #288 green, #291 green+mergeable clean, #231 windows shards 1+3 red, #292 validate ubuntu + windows red (base-wide dependency audit, C), #282 no validate check ran. Closed unmerged (25): #8 #11 #13 #14 #23 #28 #30 #32 #33 #46 #50 #68 #104 #114 #116 #125 #126 #127 #129 #132 #141 #142 #154 #171 #197.

## 6. Duplicates and status conflicts
**Raw-status vs primary-evidence conflicts (27 records, V/E):**
| Record | Source says | Evidence says | Evidence |
| --- | --- | --- | --- |
| UI-074 (S1) | IN_REVIEW, PR #8 "OPEN" | NS: #8 closed unmerged 2026-10-22; "Provider Hub"/UI-074 not in code (git grep apps/ tests/ = 0) | API + git grep |
| L-TOWER-TRACE (S1) | IN_REVIEW #23 | DBU: #23 closed unmerged but UI-226 landed via #169 (merge 870e20d) | git log --grep UI-226 |
| L-ROUTES (S1) | IN_REVIEW #27/#28 | DBU: #27 merged; #28 closed unmerged; UI-078 landed as 9721fad (ancestor of base) | git |
| UI-110, UI-105 (S1) | READY | DBU: S2 says INTEGRATED; #163 (fc53bcc) and #164 (4d93cde) merged 2026-10-22 | API + S2 |
| P0-REMAINDER-AUDIT (S1) | DRAFT_NOT_READY ("do not dispatch") | DONE: #268 "A-P0-AUDIT ... INV-17" merged 2026-10-27, CI ok, docs-only | API |
| PQ-007 (S2) | TESTED, review NOT_REVIEWED | DBU: #161 merged | API |
| coordinatorBuild x 14 (S2) | TESTED / TESTED_BRANCH_ONLY / PR_OPEN / IN_PROGRESS / BUILDER_REPORTED | DBU: heads are ancestors of base (mostly via #143 or #147-#151, #153, #160); only COORD-REVIEWER-DIAGNOSTICS/INTEGRATION-L1 say MERGED/VERIFIED | git ancestry |
| FQ-PQ-009 (S2) | FOUNDER_ONLY "merge #128" | DBU: #128 merged 430e6c4 2026-10-21T13:24Z | API |
| Master V2 C-RDY-1, C-CTX-1, C-RDY-2a, B1, A1, A4 (S6) | plan, not started (baseline of 10-26) | DBU: #260, #265+#289, #264, #262+#276, #263, #261 merged | API |
| board.prs 229/224/237/239 (S2) | DRAFT | MERGED 2026-10-26 (API) | API |
| 3 authority-request docs (S10) | CODE_COMPLETE_NOT_CI_REGISTERED | tests are registered: config/validation.json lists 123 of 123 tests/*.test.ts files incl. readiness-audit, readiness-adapter-reality, role-context | git show base:config/validation.json |
| Roadmap PH-000..148 (S7) | state=PLANNED for 149/149 | S8 (C): 33 IN_PROGRESS, 9 MERGED_NOT_INTEGRATED, 3 INTEGRATED_NOT_VERIFIED; I could not find phase-id tracking in the contracts, so S7 stays NS and S8 is a different (module-level) reading | files |

**Cross-source key conflicts (11):** UI-074 [stale-snapshot: S1=NOT_STARTED | S8(10-19)=BLOCKED]; UI-023 [stale-snapshot: S1=DONE_BUT_UNVERIFIED | S8(10-19)=NOT_STARTED]; UI-016 [stale-snapshot: S1=BLOCKED | S8(10-19)=DONE_BUT_UNVERIFIED]; UI-027 [stale-snapshot: S1=BLOCKED | S8(10-19)=DONE_BUT_UNVERIFIED]; UI-220 [stale-snapshot: S1=BLOCKED | S8(10-19)=DONE_BUT_UNVERIFIED]; UI-197 [stale-snapshot: S1=DONE_BUT_UNVERIFIED | S8(10-19)=IN_PROGRESS]; UI-226 [stale-snapshot: S1=DONE_BUT_UNVERIFIED | S8(10-19)=IN_PROGRESS]; UI-078 [stale-snapshot: S1=DONE_BUT_UNVERIFIED | S8(10-19)=UNKNOWN]; UI-124 [stale-snapshot: S1=BLOCKED | S8(10-19)=DONE_BUT_UNVERIFIED]; UI-246 [CONFLICT: S1=BLOCKED | S2=DONE_BUT_UNVERIFIED | S8(10-19)=DONE_BUT_UNVERIFIED]; UI-034 [stale-snapshot: S2=DONE_BUT_UNVERIFIED | S8(10-19)=BLOCKED]. Reading (E): UI-016/027/220/124 differ in scope (S1 tracks the missing remainder, S8 the existing screen), not in fact; UI-246 is a true conflict: S1 B2-UI-246 AUTHORITY_REQUIRED vs S2 PQ-004 INTEGRATED (#155 merged).
**Overlaps (duplicates by meaning):** B2-UI-023 = UI-023; PQ-008-R1 = PQ-008; PQ-008 (mobile core code) is the code behind MOB-6 screens/UI-097/099/102/177 but is a different item; UI-110/UI-105 are in S1 and S2; PQ-003/004/005 are inventory screens UI-050/246/034; S8 phases = S7 phases (149 identical keys); S6 gaps G01-G25 overlap S9 audit findings (e.g. G01 role readiness vs AUD capability rows) (E, not key-linkable); S2 founderQueue items repeat S9 UASCO-AUD-001/002/003/004/005/133 in prose.

## 7. Review ledger statistics (S3 @3074ec2, V recomputed)
- Records 126 on 53 PRs (earliest 2026-10-26T14:05:57Z = TEP-1 start; PRs reviewed before that are not in the ledger). By day: 10-26=55, 10-27=69, 11-02=2. The #291 full review (NO_BLOCKERS_4LOW, 02:52Z) arrived while I was auditing; at 47d46b0 the file had 125 records / 52 PRs.
- Verdict classes: BLOCKERS* 44, NO_BLOCKERS* 64, BASE_MERGE_ONLY 16, ROUND_LIMIT_* 2. By kind: full/BLOCKERS* 24, delta/BLOCKERS* 20, full/NO_BLOCKERS* 28, delta/NO_BLOCKERS* 36, delta/BASE_MERGE_ONLY 16, delta/ROUND_LIMIT_* 2.
- Rounds per PR (distinct reviewed head SHAs): 1 round(s): 18 PRs; 2 round(s): 20 PRs; 3 round(s): 5 PRs; 4 round(s): 4 PRs; 5 round(s): 3 PRs; 6 round(s): 1 PRs; 7 round(s): 1 PRs; 9 round(s): 1 PRs. Substantive rounds (excluding BASE_MERGE_ONLY records): 1: 21; 2: 19; 3: 7; 4: 4; 5: 1; 9: 1.
- ROUND_LIMIT: policy maxReviewRounds=3 (coord-ledger.mjs POLICY). 15 PRs reached >=3 distinct heads: 224(3), 231(9), 242(4), 252(4), 256(3), 262(5), 263(5), 264(7), 265(6), 267(3), 268(4), 273(3), 276(5), 278(4), 279(3). 10 PRs have records past 3 heads (review-record always allows it; security exception or base-merge records): 231(9), 242(4), 252(4), 262(5), 263(5), 264(7), 265(6), 268(4), 276(5), 278(4). Verdict text explicitly names ROUND_LIMIT on #262, #263, #264, #265, #276 (#262 #263 recorded as ROUND_LIMIT_*; #264 #276 BLOCKERS_..._ROUND_LIMIT; #265 NO_BLOCKERS_ROUND_LIMIT then merged with 4 LOW test gaps). Largest: #231 with 9 heads (6 BLOCKERS*, 3 NO_BLOCKERS*, last record NO_BLOCKERS_MECHANICAL_BASE_MERGE), #264 7, #265 6.
- Last record per PR is not clean for #282 open, #288 open. For every merged PR that is in the ledger, the merged head has a NO_BLOCKERS* or BASE_MERGE_ONLY record (0 exceptions, V; BASE_MERGE_ONLY is clean only through its base chain, per mergeGate). Merged PRs #224..#290 with no ledger record: 15 (225,226,227,228,229,230,232,233,234,235,236,238,239,240,248) - 14 were merged on 2026-10-26 before the first ledger record (14:05:57Z), plus #248 (auto-merge 16:03Z, no record: V). Open PRs not in ledger: #66, #247.
- ciOutcome field is populated on 1 of 126 records (#249 cd95758); tests[] in the ledger is empty (0), so the test-reuse half of TEP-1 holds no data (V).

## 8. Queue, board and ledger completeness
- Queue evidence lists: 259 merged PRs; 140 appear in merges/autoMergeEvidence/tasks; 119 do not. After #143 (queue era) the unmentioned ones are #144, #172, #199, #211, #214, #220, #221: #199 #211 #214 #221 are listed under mergedVia225, #220 under closedOrSuperseded; #144 and #172 are genuinely absent (V).
- Queue tasks[] stops at PQ-013 (2026-10-22). Everything after is tracked only in prose (board, checkpoint.next) and PR titles; the lane packages A-xxx/B-xxx/C-xxx (the ~131 claude/lane-* PRs) have no record id.
- Queue statuses (C): tasks INTEGRATED 15 / TESTED 1; coordinatorBuild TESTED 5, TESTED_BRANCH_ONLY 7, VERIFIED 1, MERGED 1, PR_OPEN 1, IN_PROGRESS 1, BUILDER_REPORTED 1. Vocabulary has PRODUCT_ACCEPTED; used by 0 records (V).
- V: apps/mobile/src/core/monitoring.test.ts is the only test file outside tests/ and config/validation.json does not reference it (0 hits), so the PQ-008 'TESTED' claim (Mobile Companion core) is a local builder run (C), not CI-executed. The other 123 tests/*.test.ts files equal the 123 registered paths (set comparison, 0 differences).
- V: build-waves.json defines 12 waves (BOOTSTRAP_TRUST_KERNEL 0 phases, FOUNDATION_TRUST 9, ORGANIZATION_COMPETENCY 9, MISSION_INTELLIGENCE 20, RESOURCES_EVIDENCE 9, STUDIOS 8, EXECUTION_LABS 23, ASSURANCE_SECURITY_RELIABILITY 26, SPECIALIZED_DOMAINS 20, BUSINESS_COMMUNICATION 9, ACCEPTANCE_DOGFOOD 14, FINAL_REVIEW_RELEASE 2 = 149) and review-packages.json 34 packages over Phase 1..148; neither carries any status other than PLANNED.

## 9. Registries and lane/agent baselines (V recount at 0b71650)
| Registry | Count | State distribution |
| --- | --- | --- |
| role-definitions.json | roles 599, guilds 51, clusters 10, legacyUnmapped 88, conflicts 19 | proficiencyStatus NOT_EVALUATED 599; runtimeStatus UNKNOWN 599; lifecycle TARGET 599; evaluationSpecs 3594 all NOT_EXECUTED |
| agents.json (+ agent-* matrices) | 363 (matrix/policy/overlay/competency/review/context each 363) | REGISTERED/ON_DEMAND 363 |
| organization-hierarchy.json / organization/departments | departments 40 (files 40), subteams 18, councils 10 | registered |
| skills.json (v1) / skills-v2.json | 1186 / 425 | v2 certificationState NOT_CERTIFIED 425 |
| technologies.json (+knowledge/technologies/*.json) | 415 (415 files) | knowledgeState SEED_PROFILE 415 |
| tool-adapters / capabilities / execution-fabrics / execution-binders | 194 / 110 / 45 / 16 | implementation NOT_IMPLEMENTED for all 194/110/45 |
| competency-packs / playbooks(+v2) / domain-packs / framework-packs | 40 / 12(+18) / 22 / 41 | domain-packs REGISTERED 22 |
| schema-catalog / phase-contracts-index / technical-standards(+v2) | 152 / 149 / 23(+18) | - |
| LANES.json | 26 lanes (4 ACTIVE, 22 STANDBY); model field sonnet 17, opus 3, haiku 6 | builderCap 4, ciSlots 6 |
Repo size at base (V): 1517 commits (366 on first-parent), 2688 tracked files, 123 tests/*.test.ts files all registered in config/validation.json; docs/authority-requests 47 files.

## 10. Per-record list (169 detail rows; remaining records aggregated)
Legend: DN done, DBU done-but-unverified, IP in progress, NS not started, BL blocked, UK unknown, EX excluded; raw codes: AR AUTHORITY_REQUIRED, IR IN_REVIEW, DNR DRAFT_NOT_READY, RDY READY. upd = MM-DD of the source file last write (S1 10-20, S2 10-27 unless task-specific, S6 10-26) or of the PR. Full detail for every record, including all 292 PRs and 616 inventory rows, is in G2-records.json.

**R1. Open PRs (S4, GitHub API 2026-11-02)**

| ID | src | upd | PR/commit | raw>norm | owner | title ~ flags |
| --- | --- | --- | --- | --- | --- | --- |
| PR#66 | S4 | 10-20 | #66 | open/draft>BL | CLOUD-PROD/GOV | E2E-DESKTOP: fail-closed, SHA-boun |
| PR#231 | S4 | 10-26 | #231 | open/draft>BL | LANE_B | [FOUNDER-TIER] LANE-B+C sandbox: W |
| PR#247 | S4 | 10-26 | #247 | open/draft>BL | COORD | [FOUNDER-TIER] COORD PROTECTED: au |
| PR#251 | S4 | 10-26 | #251 | open/draft>BL | COORD | COORD PROTECTED CI-TEP1: Linux pre |
| PR#282 | S4 | 10-27 | #282 | open/draft>IP | LANE_C | C-PAR03-DIAG-1: the next Windows P |
| PR#288 | S4 | 10-27 | #288 | open/draft>IP | LANE_C | C-RDY-2b: entity readiness audit ( |
| PR#291 | S4 | 10-27 | #291 | open/draft>IP | LANE_B | LANE-B: GET /v1/roles/:roleId/cont |
| PR#292 | S4 | 11-02 | #292 | open>BL | LANE_A | feat(ui): A2a Tools panel — TOOL_R |

**R2. Master V2 plan: packages, cross-lane, founder decisions (S6)**

| ID | src | upd | PR/commit | raw>norm | owner | title ~ flags |
| --- | --- | --- | --- | --- | --- | --- |
| C-RDY-1 | S6 | 10-26 | #260 | PLAN>DBU | Lane C | Role Readiness Auditor: 8 strict l ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| C-CTX-1 | S6 | 10-26 | #265,#289 | PLAN>DBU | Lane C | Role Context Resolver (role genome ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| C-RDY-2a | S6 | 10-26 | #264 | PLAN>DBU | Lane C | Adapter Reality Map, registry-vs-c ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| C-RDY-2b | S6 | 10-26 | #288 | PLAN>IP | Lane C | Skill and technology entity readin ~ PR_OPEN |
| C-CTX-2 | S6 | 10-26 |  | PLAN>NS | Lane C | Canonical role context in pre-dev  ~ NO_PR_NO_BRANCH_FOUND |
| C-EVAL-2 | S6 | 10-26 |  | PLAN>NS | Lane C | Bind evaluation evidence to the cu ~ NO_PR_NO_BRANCH_FOUND |
| C-EVAL-3 | S6 | 10-26 |  | PLAN>NS | Lane C | EV-06 BOUNDARY_AND_COST procedure  ~ NO_PR_NO_BRANCH_FOUND |
| C-CTX-3 | S6 | 10-26 |  | PLAN>NS | Lane C | Role context in IMPLEMENT/REVIEW m ~ NO_PR_NO_BRANCH_FOUND |
| C-BIND-1 | S6 | 10-26 |  | PLAN>NS | Lane C | Evidence-gated binding widening an ~ NO_PR_NO_BRANCH_FOUND |
| V2-B1 | S6 | 10-26 | #262,#276 | PLAN>DBU | LANE_B | Extend apps/control-api/src/routes ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| V2-B2 | S6 | 10-26 | #291 | PLAN>IP | LANE_B | Add GET /v1/roles/:roleId/context  ~ PR_OPEN;PR_OPEN_REVIEW_PENDING |
| V2-B3 | S6 | 10-26 |  | PLAN>NS | LANE_B | Work OS task role: add an optional ~ NO_PR_NO_BRANCH_FOUND |
| V2-B4 | S6 | 10-26 |  | PLAN>NS | LANE_B | Mission-time technology gap: call  ~ NO_PR_NO_BRANCH_FOUND |
| V2-B5 | S6 | 10-26 |  | PLAN>NS | LANE_B | Wire core/qa/api/strict-json-valid ~ NO_PR_NO_BRANCH_FOUND |
| V2-A1 | S6 | 10-26 | #263 | PLAN>DBU | LANE_A | Workforce view: add an 8-layer rea ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| V2-A2 | S6 | 10-26 | #292 | PLAN>IP | LANE_A | Tools panel: show registered (194) ~ PR_OPEN;PR_OPEN_REVIEW_PENDING |
| V2-A3 | S6 | 10-26 |  | PLAN>NS | LANE_A | Role detail card: show canonical r ~ NO_PR_NO_BRANCH_FOUND |
| V2-A4 | S6 | 10-26 | #261 | PLAN>DBU | LANE_A | Run expert selector: replace the m ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| V2-Z1 | S6 | 10-26 |  | PLAN>NS | COORD | Staff Lane S or grant Lane C a sco ~ NO_PR_NO_BRANCH_FOUND |
| V2-Z2 | S6 | 10-26 |  | PLAN>NS | COORD | Seal scripts/validate-role-registr ~ validate-role-registry.mjs in trust-ro |
| V2-Z3 | S6 | 10-26 |  | PLAN>DBU | COORD | Protected registration batch S-REG ~ REGISTERED_IN_validation.json=true |
| V2-FD-1 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-1 Legacy alias approval: all 44 |
| V2-FD-2 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-2 Protected evaluation authorit |
| V2-FD-3 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-3 Real model runs on a Founder  |
| V2-FD-4 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-4 Protected wiring batch (#242  |
| V2-FD-5 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-5 Knowledge acquisition authori |
| V2-FD-6 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-6 Supply the master spec docume |
| V2-FD-7 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-7 Protected validator count pin |
| V2-FD-8 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-8 CI security tooling: a .githu |
| V2-FD-9 | S6 | 10-26 |  | FDN>BL | FOUNDER | FD-9 Technology verification autho |
| V2-FD-10 | S6 | 10-26 |  | FDN>DBU | FOUNDER | FD-10 Test registration (pre-autho ~ EXECUTED_PREAUTHORIZED |

**R3. Production queue tasks (S2)**

| ID | src | upd | PR/commit | raw>norm | owner | title ~ flags |
| --- | --- | --- | --- | --- | --- | --- |
| UI-110 | S2t | 10-22 | #163 | INT>DBU | coordinator-pr | UI-110 ~  |
| UI-105 | S2t | 10-22 | #164 | INT>DBU | coordinator-pr | UI-105 ~  |
| PQ-007 | S2t | 10-21 | #161 | TST>DBU | Lane B / coord | Project Memory core module: persis ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| PQ-001 | S2t | 10-22 | #162 | INT>DBU | Lane A / coord | Renderer product-verification hone ~  |
| PQ-002 | S2t | 10-21 | #133 | INT>DN | production-bui | Asserting test for the Tower sched |
| PQ-003 | S2t | 10-27 | #156 | INT>DBU | Lane A (Lane A | Evidence lineage as a navigable gr ~  |
| PQ-004 | S2t | 10-27 | #155 | INT>DBU | Lane A (Lane A | Theme contrast lab in #/settings:  ~  |
| PQ-005 | S2t | 10-22 | #157 | INT>DBU | Lane A (Lane A | Provider & model routing view (rea ~  |
| PQ-006 | S2t | 10-21 | #135 | INT>DN | coordinator ht | Make the two host-sensitive tests  |
| PQ-008 | S2t | 10-21 | #159 | INT>DBU | Lane C / coord | Mobile Companion core: read-only m ~ TESTS_NOT_CI_REGISTERED:apps/mobile/sr |
| PQ-009 | S2t | 10-22 | #128 | INT>DN | Lane C / coord | Bump transitive vite 8.3.1 -> 8.3. |
| PQ-010 | S2t | 10-21 | #130 | INT>DBU | Lane B / coord | Model routing decision core: pure  ~  |
| PQ-011 | S2t | 10-27 | #134 | INT>DBU | Lane B / produ | Command intake core: Founder text  ~  |
| PQ-012 | S2t | 10-22 | #140 | INT>DBU | Lane A (Lane A | Next-task selector core: determini ~  |
| PQ-008-R1 | S2t | 10-21 | #159 | INT>EX | Lane C / origi | Repair PQ-008: no cached data afte ~ TESTS_NOT_CI_REGISTERED:apps/mobile/sr |
| PQ-013 | S2t | 10-22 | #131 | INT>DN | Lane B / coord | UASCO Independent Review: fail-clo |

**R4. Production queue coordinatorBuild (S2)**

| ID | src | upd | PR/commit | raw>norm | owner | title ~ flags |
| --- | --- | --- | --- | --- | --- | --- |
| COORD-TASK-STATUS | S2c | 10-27 | #143 | TST>DBU | coordinator | Store-owned task status transition ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| COORD-INTEGRATION-L1 | S2c | 10-27 | #143 | VERIFIED>DBU | coordinator | integrated into PR #143 ~  |
| COORD-TASK-UI | S2c | 10-27 | #143 | TST>DBU | coordinator | Desktop task status controls in mi ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-B-TASK-ROUTES | S2c | 10-27 | #143 | TST>DBU | lane-b | integrated into PR #143 ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| COORD-RUN-EXPERT | S2c | 10-27 | #143 | TST>DBU | coordinator | expert developer picker on run sta ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| COORD-FIRST-DELIVERY-WIRING | S2c | 10-27 | #143 | PRO>DBU | coordinator | Founder approval in principle 2026 ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| COORD-REVIEWER-DIAGNOSTICS | S2c | 10-27 | #144 | MERGED>DBU | coordinator | bootstrap = governance doc step 7  ~  |
| COORD-SCOPE-GRANTS | S2c | 10-27 | 39fb3b4 | TBO>UK | coordinator | governance proposal (PROPOSED gran ~ STALE_IN_PROGRESS_NO_EVIDENCE_SINCE_20 |
| LANE-C-PREDEV-ROLE-BINDINGS | S2c | 10-27 | #153 | TST>DBU | lane-c | LANE-C-PREDEV-ROLE-BINDINGS ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| COORD-INTAKE-TEST-COMMAND | S2c | 10-27 | #143 | TBO>DBU | coordinator | optional testCommand on POST /v1/i ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-A-TASK-DONE-CONFIRM | S2c | 10-27 | #143,#160 | TBO>DBU | lane-a | DONE confirm dialog; E2E script up ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| COORD-INTAKE-TEMPLATE | S2c | 10-27 | #143 | TBO>DBU | coordinator | managed template repository for in ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-A-FLOW-DETAIL | S2c | 10-27 | #143,#148 | TBO>DBU | lane-a | state-aware flow details (MISSION. ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-B-TASK-RUN-LINK | S2c | 10-27 | #151 | IP>DBU | lane-b | task -> run link; not yet reported ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-A-RUN-READINESS | S2c | 10-27 | #143,#147 | TBO>DBU | lane-a | 'Before you start a run' note from ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-A-RUN-STEPS | S2c | 10-27 | #143,#149 | TBO>DBU | lane-a | run steps table from the run's own ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |
| LANE-A-TASK-RUNS-UI | S2c | 10-27 | #150 | BRP>DBU | lane-a | task inspector 'Runs for this task ~ CLAIM_STALE:IN_PROGRESS_BUT_MERGED |

**R5. Production queue founderQueue (S2)**

| ID | src | upd | PR/commit | raw>norm | owner | title ~ flags |
| --- | --- | --- | --- | --- | --- | --- |
| FQ-REVIEW-SETUP | S2f | 10-27 |  | FO>BL | FOUNDER | Set up UASCO Independent Review (d ~ FQ_STALE_CHECK |
| FQ-PQ-009 | S2f | 10-27 | #128 | FO>DBU | FOUNDER | Merge #128 (lockfile-only vite fix ~ FQ_STALE_CHECK;CLAIM_STALE:FOUNDER_QUE |
| FQ-ROUTINE-CLEANUP | S2f | 10-27 |  | FO>BL | FOUNDER | Disable routine UASCO Cloud Develo |
| FQ-ITEM-04 | S2f | 10-27 |  | FO>BL | FOUNDER | UASCO-AUD-003 self-hosted runner r |
| FQ-ITEM-05 | S2f | 10-27 |  | FO>BL | FOUNDER | UASCO-AUD-133 remove the pull_requ |
| FQ-ITEM-06 | S2f | 10-27 |  | FO>BL | FOUNDER | UASCO-AUD-001 builder/reviewer ide |
| FQ-ITEM-07 | S2f | 10-27 |  | FO>BL | FOUNDER | UASCO-AUD-004 API-001 fix (server. |
| FQ-ITEM-08 | S2f | 10-27 |  | FO>BL | FOUNDER | UASCO-AUD-002 protected-paths exte |
| FQ-ITEM-09 | S2f | 10-27 |  | FO>BL | FOUNDER | Backend/central-brain work that ne |
| FQ-ITEM-10 | S2f | 10-27 |  | FO>BL | FOUNDER | core/workos/store.ts read-clone fi |
| FQ-ITEM-11 | S2f | 10-27 |  | FO>BL | FOUNDER | Mobile implementation MOB-11..31 ( |
| FQ-ITEM-12 | S2f | 10-27 |  | FO>BL | FOUNDER | UASCO-AUD-005 sandbox substrate de |
| FQ-ITEM-13 | S2f | 10-27 |  | FO>BL | FOUNDER | Raise the 2-builder cap |
| FQ-ITEM-14 | S2f | 10-27 |  | FO>BL | FOUNDER | Register new test files in config/ |
| FQ-ITEM-15 | S2f | 10-27 |  | FO>BL | FOUNDER | React Native / Android dependencie |

**R6. BACKLOG_CHECKPOINT tasks (S1); MOB-11..31 aggregated in the last row**

| ID | src | upd | PR/commit | raw>norm | owner | title ~ flags |
| --- | --- | --- | --- | --- | --- | --- |
| UI-236 | S1 | 10-20 | d04039f | DN>DBU | LOCAL / WP-COC | Founder Executive Summary + Execut ~ DIRECT_COMMIT_NO_PR_NO_CI_RECORD |
| UI-049 | S1 | 10-20 | 2bc852d | DN>DBU | LOCAL / WP-QA- | Read-only independent-review verdi ~ DIRECT_COMMIT_NO_PR_NO_CI_RECORD |
| UI-211 | S1 | 10-20 | #1 | DN>DBU | LOCAL / WP-INB | Human-Approval Queue (#/queue) ~  |
| CI-GREEN | S1 | 10-20 | #2,#1 | DN>DBU | LOCAL / PLATFO | POSIX process-leak fix + platform- ~  |
| UI-227 | S1 | 10-20 | #3 | DN>DBU | LOCAL / WP-QA- | Quality Gate & Release Readiness ( ~  |
| UI-037+046 | S1 | 10-20 | #4 | DN>DBU | LOCAL / WP-QA- | Assurance Command Center & Securit ~  |
| UI-205 | S1 | 10-20 | #5 | DN>DBU | LOCAL / WP-COC | Multi-Project Command Matrix (#/ma ~  |
| UI-071 | S1 | 10-20 | #6,#7 | DN>DBU | LOCAL / WP-TOW | Operations & Recovery runbook (#/o ~  |
| UI-074 | S1 | 10-20 | e12dbdd | IR>NS | LOCAL / WP-SET | Provider Hub (routing/health) - la ~ PR_CLOSED_UNMERGED_NOT_LANDED |
| UI-248 | S1 | 10-20 | #9,#10 | DN>DBU | LOCAL / WP-FIR | First-run install verification (me ~  |
| pkg-lease1 | S1 | 10-20 | #10 | DN>DBU | LOCAL / AUTONO | Atomic task lease + SHA/session-bo ~  |
| pkg-lease1-wiring | S1 | 10-20 |  | BL>BL | FOUNDER / AUTO | Wire the atomic lease into orchest |
| RESEAL-SERIALIZATION | S1 | 10-20 | e12dbdd | BL>BL | LOCAL / GOVERN | Serialize merge + trust-root resea |
| BACKLOG-SOURCE-REBASELINE | S1 | 10-20 | e12dbdd | BL>BL | FOUNDER / AUTO | Land an authoritative re-baselined |
| UI-023 | S1 | 10-20 | #56,#10,#82+ | DN>DBU | CLOUD / WP-WOR | Read-only mission/run status board ~  |
| UI-016 | S1 | 10-20 | e12dbdd | BL>BL | FOUNDER / WP-I | Final Analysis Approval (pre-dev a |
| UI-004 | S1 | 10-20 |  | BL>BL | FOUNDER / WP-S | Founder Command Center (chat / com |
| UI-027+UI-220 | S1 | 10-20 |  | BL>BL | FOUNDER / WP-T | Autonomy-level/budget controls (UI |
| WP-COMPANY-WRITE | S1 | 10-20 | e12dbdd | BL>BL | FOUNDER / WP-C | Company OS write/management screen |
| FD-REL-1-GATED-SET | S1 | 10-20 |  | BL>BL | FOUNDER / WP-Q | FD-REL-1 / Founder-gated set: UI-0 |
| RELEASE-SIGNATURE-PHASE0 | S1 | 10-20 | e12dbdd | BL>BL | FOUNDER / RELE | Release packaging, Founder detache |
| DESIGN-EVIDENCE-UNAVAILABLE | S1 | 10-20 | 0d0b2b9 | BL>BL | FOUNDER / DESI | P0 blocker: approved UI/UX design  |
| UI-002 | S1 | 10-20 | #86,#93 | DN>DBU | CLOUD / WP-FIR | First-run wizard Verify step: show ~  |
| UI-007 | S1 | 10-20 | #86,#93 | DN>DBU | CLOUD / WP-SHE | Require an explicit confirmation b ~  |
| UI-125 | S1 | 10-20 | #86,#101 | DN>DBU | CLOUD / WP-PRO | Brownfield import: show the server ~  |
| UI-109 | S1 | 10-20 | #86,#101 | DN>DBU | CLOUD / WP-WOR | Show the server's ACTION_DENIED re ~  |
| UI-146 | S1 | 10-20 | #86,#101 | DN>DBU | CLOUD / WP-QA- | Security re-scan history by remedi ~  |
| UI-182 | S1 | 10-20 | #86,#101 | DN>DBU | CLOUD / WP-DEL | Delivery card: explicit stale-vers ~  |
| UI-233 | S1 | 10-20 | #86,#101 | DN>DBU | CLOUD / WP-COM | Company OS CRM tab: per-account ex ~  |
| UI-194 | S1 | 10-20 | #106,#86,#107 | DN>DBU | CLOUD / WP-TOW | Control Tower retry fact: honest r ~  |
| SEC-IMPORT-GUARD | S1 | 10-20 | #106,#107,#115+ | DN>DBU | CLOUD / WP-TOW | Import guard hardening: AST-based  ~  |
| SEC-IMPORT-GUARD-2 | S1 | 10-20 | #115,#117,#124 | DN>DBU | CLOUD / WP-TOW | Import guard follow-up: model scri ~  |
| UI-035 | S1 | 10-20 | #86,#101 | DN>DBU | CLOUD / WP-ACA | Academy: read-only learning lifecy ~  |
| MOB-1 | S1 | 10-20 | #105 | DN>DN | CLOUD / MOBILE | Mobile threat model and pre-coding |
| MOB-2 | S1 | 10-20 | #105 | DN>DN | CLOUD / MOBILE | Connectivity, pairing and device-s |
| MOB-3 | S1 | 10-20 | #111 | DN>DN | CLOUD / MOBILE | Mobile API contract specification  |
| MOB-4 | S1 | 10-20 | #111 | DN>DN | CLOUD / MOBILE | Approval, attestation and STOP des |
| MOB-5 | S1 | 10-20 | #105 | DN>DN | CLOUD / MOBILE | React Native Android architecture  |
| MOB-6 | S1 | 10-20 | #117 | DN>DN | CLOUD / MOBILE | Screen specifications: monitoring  |
| MOB-7 | S1 | 10-20 | #117 | DN>DN | CLOUD / MOBILE | Screen specifications: action, sec |
| MOB-8 | S1 | 10-20 | #111 | DN>DN | CLOUD / MOBILE | Test, build and release strategy |
| MOB-9 | S1 | 10-20 | #105 | DN>DN | CLOUD / MOBILE | Technology knowledge research for  |
| DOC-TRUTH-CANONICAL-STATUS | S1 | 10-20 | e12dbdd | DNR>NS | LOCAL / GOVERN | CANONICAL-STATUS.md is stale on pa |
| ADVISORIES-F-PKGE-002-F-PKGR-001 | S1 | 10-20 | e12dbdd | DNR>NS | LOCAL / PACKAG | Durable P3 advisories F-PKGE-002 a |
| SCREEN-EVIDENCE-DEBT | S1 | 10-20 | ec105b7 | DNR>NS | LOCAL / SCREEN | Per-screen verification evidence d |
| P0-REMAINDER-AUDIT | S1 | 10-20 | #268 | DNR>DN | CLOUD / P0-SCR | Remaining P0 screen rows with unkn ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| P1-P2-BACKLOG-AUDIT | S1 | 10-20 |  | DNR>NS | CLOUD / P1-P2- | P1 (122 rows) and P2 (87 rows) scr |
| HOME-DELIVERY-STATE | S1 | 10-20 | #19,#82,#64 | DN>DBU | CLOUD | Home shows true Delivery state (re ~  |
| PLANNED-SCAFFOLD-CLEANUP | S1 | 10-20 | #20,#82,#77 | DN>DBU | CLOUD | Remove unused plannedPanel partial ~  |
| L-WORKFORCE | S1 | 10-20 | #22,#82,#77 | DN>DBU | CLOUD | UI-197 cluster->guild taxonomy ~  |
| L-TOWER-TRACE | S1 | 10-20 | #169 | IR>DBU | CLOUD | UI-226 stage timeline ~ CLAIM_STALE:REVIEW_BUT_MERGED |
| L-ASSURANCE | S1 | 10-20 | #24,#25,#26+ | DN>DBU | CLOUD | UI-049 -> UI-050 -> UI-051 (sequen ~  |
| L-ROUTES | S1 | 10-20 | #27 | IR>DBU | CLOUD | UI-070 -> UI-078 (sequential) ~ CLAIM_STALE:REVIEW_BUT_MERGED |
| B2-UI-023 | S1 | 10-20 | e12dbdd | AR>EX | CLOUD | Read-only mission/run status board ~ DUPLICATE_OF:UI-023 |
| B2-UI-124 | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | Stop dialog live impact counts |
| B2-UI-246 | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | Settings contrast/token preview |
| B2-T-APPROVAL | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | assertApprovalValid unit tests |
| B2-T-RESOLVER | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | resolveCapability unit tests |
| B2-T-TEMPLATES | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | renderTemplate unit tests |
| B2-T-PREDEV | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | predev apply/read-model unit tests |
| B2-T-ACADEMY | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | academy apply unit tests |
| B2-T-COMPANY | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | company common/apply unit tests |
| B2-T-SELFTESTS | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | orphan selftest vitest wrapper |
| B2-SBOM | S1 | 10-20 | e12dbdd | AR>BL | CLOUD | Offline SBOM step in security-tool |
| CP-DISPATCH-IMPL | S1 | 10-20 | #29 | DN>DN | CLOUD | Cloud-only dispatcher with claim r |
| CP-NODE24-ENV | S1 | 10-20 | #21,#82,#64 | DN>DN | CLOUD | .nvmrc + Node 24 setup script |
| UI-030 | S1 | 10-20 | #22,#48,#64 | DN>DBU | CLOUD / WP-AGE | Active worker fleet grid on #/work ~  |
| UI-113 | S1 | 10-20 | #39,#64 | DN>DBU | CLOUD / WP-INB | Approval-required state panel with ~  |
| UI-132 | S1 | 10-20 | #40,#72 | DN>DBU | CLOUD / WP-PRO | Read-only project closure and hand ~  |
| UI-032 | S1 | 10-20 | #80 | DN>DBU | CLOUD / WP-AGE | Worker detail panel from the fleet ~  |
| UI-026 | S1 | 10-20 | #80 | DN>DBU | CLOUD / WP-WOR | Read-only task detail inspector on ~  |
| UI-025 | S1 | 10-20 | #86 | DN>DBU | CLOUD / WP-WOR | Read-only task and work-run timeli ~  |
| UI-133 | S1 | 10-20 | #22,#48,#86 | DN>DBU | CLOUD / WP-AGE | Read-only agent identity card with ~  |
| UI-047 | S1 | 10-20 | #24,#25,#26+ | DN>DBU | CLOUD / WP-QA- | Read-only security finding detail  ~  |
| UI-201 | S1 | 10-20 | #38,#64,#82 | DN>DBU | CLOUD / WP-ACA | Read-only per-learning evidence li ~  |
| UI-111 | S1 | 10-20 | #107,#115,#112+ | DN>DBU | CLOUD / WP-WOR | Show the server-recorded retry fac ~  |
| UI-114 | S1 | 10-20 | #112,#113,#115+ | DN>DBU | CLOUD / WP-SET | Add a read-only state legend to Se ~  |
| UI-028 | S1 | 10-20 | #112,#113,#115+ | DN>DBU | CLOUD / WP-AGE | Add previous/next paging to the #/ ~  |
| UI-106 | S1 | 10-20 | #112,#113,#115+ | DN>DBU | CLOUD / WP-SHE | Give the #/journey zero-mission st ~  |
| UI-110 | S1 | 10-20 | #163 | RDY>DBU | CLOUD / WP-WOR | Show the server-recorded stop/fail ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| UI-105 | S1 | 10-20 | #164 | RDY>DBU | CLOUD / WP-SHE | Add a route-titled, number-free lo ~ CLAIM_STALE:NOT_STARTED_BUT_MERGED |
| MOB-11..MOB-31 (21) | S1 |  |  | BL 21 | FOUNDER | Android RN implementation, all AUTHORITY_REQUIRED; no MOB-10 id exists (ids jump 9>11) |

**Aggregated (not listed row by row):**

| Group | Records | DN | DBU | IP | NS | BL | UK | EX | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S4 merged+closed PRs (284) | 284 | 67 | 192 | 0 | 0 | 0 | 0 | 25 | one row per PR in G2-records.json (PR#n) |
| S6:MASTER-V2.gaps | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | findings; 25 FINDING_OPEN (not work items) |
| S7:ROADMAP.contracts | 149 | 0 | 0 | 0 | 149 | 0 | 0 | 0 |  |
| S7:ROADMAP.review-packages | 34 | 0 | 0 | 0 | 34 | 0 | 0 | 0 |  |
| S8:INVENTORY-2026-10-19.screens | 252 | 0 | 90 | 3 | 7 | 145 | 1 | 6 |  |
| S8:INVENTORY-2026-10-19.workspaces | 18 | 0 | 14 | 0 | 0 | 4 | 0 | 0 |  |
| S8:INVENTORY-2026-10-19.ux-decisions | 71 | 0 | 38 | 0 | 3 | 30 | 0 | 0 |  |
| S8:INVENTORY-2026-10-19.labs | 25 | 0 | 0 | 1 | 15 | 9 | 0 | 0 |  |
| S8:INVENTORY-2026-10-19.endpoints | 85 | 0 | 60 | 0 | 0 | 17 | 0 | 8 |  |
| S8:INVENTORY-2026-10-19.data-persistence | 43 | 0 | 24 | 6 | 4 | 6 | 0 | 3 |  |
| S8:INVENTORY-2026-10-19.tasks | 107 | 0 | 41 | 14 | 9 | 32 | 4 | 7 |  |
| S8:INVENTORY-2026-10-19.requirement-sets | 15 | 0 | 0 | 0 | 15 | 0 | 0 | 0 |  |
| S9:AUDIT-V1.0.findings | 133 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | findings; 133 FINDING_OPEN (not work items) |
| S10:docs/authority-requests | 47 | 0 | 0 | 0 | 0 | 0 | 47 | 0 |  |

## 11. Remaining-work register (records level)
| ID | Module | Pri | Item | Evidence |
| --- | --- | --- | --- | --- |
| REC-01 | records/backlog | P1 | BACKLOG_CHECKPOINT (canonical) last written 2026-10-20; re-baseline needed: 157 merged PRs newer, 6 records contradict GitHub (UI-074, L-TOWER-TRACE, L-ROUTES, UI-110, UI-105, P0-REMAINDER-AUDIT); BACKLOG-SOURCE-REBASELINE is itself BLOCKED/FOUNDER | S1 file; git log; G2-records.json flags CLAIM_STALE |
| REC-02 | records/queue | P1 | PRODUCTION-QUEUE tasks[] ends at PQ-013 (2026-10-22); 14 of 17 coordinatorBuild entries are stale vs git; 187 PRs (168 merged) have no task record; board.prs lists 4 merged PRs as DRAFT | S2 file; section 6 and 8 |
| REC-03 | records/roadmap | P1 | Two unreconciled planning universes: 149-phase/34-package roadmap (100% PLANNED, no per-phase status field in use, .ai/runtime not in git) vs backlog/lanes/queue/inventory; no phase-to-task mapping | S7 vs S8; CANONICAL-STATUS.md still V6-era (INV-14) |
| REC-04 | records/inventory | P2 | 2026-10-19 inventory (1364 rows) is 14 days and 250 merged PRs old; 34 rows re-graded by estimate only; needs regeneration or retirement | S8 JSON; A.invRegraded=34 |
| REC-05 | records/authority-requests | P2 | 47 free-text authority-request docs without machine status; 3 carry stale CODE_COMPLETE_NOT_CI_REGISTERED although tests are registered; no register of which were granted/applied | docs/authority-requests; config/validation.json |
| REC-06 | records/ledger | P2 | Ledger covers 53 of 292 PRs (since 2026-10-26), tests[] empty, ciOutcome on 1 of 126, 15 PRs merged (#225-#248) with no record; pre-TEP-1 review verdicts live only in GitHub comments; deferred LOW findings are tracked only in PR titles | COORD-LEDGER.json @3074ec2 |
| REC-07 | records/status-vocabulary | P2 | Vocabulary has PRODUCT_ACCEPTED but 0 records use it and no record can reach VERIFIED_REAL_ENV; DONE/INTEGRATED mean "merged" only; no criteria linking done to CI + product evidence | PRODUCTION-QUEUE.statusVocabulary; BACKLOG _doc |
| REC-08 | records/mobile | P2 | MOB-10 id missing; MOB-11..31 (21 tasks) AUTHORITY_REQUIRED; only pure TS core exists (PQ-008, #159) and its test file is not CI-registered | S1; apps/mobile (6 files) |
| REC-09 | records/duplicates | P3 | Duplicates/overlaps: B2-UI-023=UI-023, PQ-008-R1=PQ-008, 6 DUPLICATE + 18 OBSOLETE inventory rows, S8 phases=S7 phases, PT-* vs S1/S2 (about 10 overlaps by shared PR) | section 4.1 and 6 |
| WORK-01 | master-v2 | P1 | 5 of 9 Lane-C packages (C-CTX-2, C-EVAL-2, C-EVAL-3, C-CTX-3, C-BIND-1) and 6 cross-lane tasks (B3, B4, B5, A3, Z1, Z2) have no PR or branch; 9 Founder decisions FD-1..FD-9 pending | WAVE0-BASELINE.json + PR list |
| WORK-02 | open-PRs | P1 | 8 open PRs: #292 red (base-wide dependency audit, C), #291 CI green + ledger NO_BLOCKERS_4LOW awaiting undraft/merge, #288 BLOCKERS 2M+14L repair pending, #282 no validate run + BLOCKERS 1M+2L, #251 #247 #231 #66 Founder-tier/held (#231 windows shards red) | GitHub API 2026-11-02; ledger |
| WORK-03 | founder-authority | P1 | Blocked on Founder: 14 queue items, 9 FD decisions, 21 MOB tasks, 41 BLOCKED backlog tasks (10 raw BLOCKED + 32 AUTHORITY_REQUIRED minus the B2-UI-023 duplicate; 30 of them FOUNDER-owned), protected-CI authority, FD-LV1, fsmon central authreq | S1, S2, S6 |
| WORK-04 | product-verification | P0 | 0 records VERIFIED_REAL_ENV or higher; 189 merged product PRs and 92 screens are DBU; no end-to-end real-environment evidence is attached to any record | A.keyUniverse, KIND, inventory product_verified |
| WORK-05 | registries | P1 | 599 roles 0 evaluated/certified, 425 skills NOT_CERTIFIED, 415 technologies SEED_PROFILE, 194 adapters/110 capabilities/45 fabrics NOT_IMPLEMENTED, 3594 specs NOT_EXECUTED | registries recount (section 9) |
| WORK-06 | screens | P1 | 252 screen keys: 147 BLOCKED (mostly AUTHORITY_REQUIRED), 92 DBU, 7 NS, 1 IP, 5 excluded | section 4.1 table |
| WORK-07 | roadmap | P2 | 149 phases + 34 packages (183 keys) all NOT_STARTED at record level | S7 |
| WORK-08 | mobile-ci | P2 | apps/mobile/src/core/monitoring.test.ts not in config/validation.json (protected path; needs Founder registration) | git show 0b71650:config/validation.json |

## 12. Not verifiable by me
- Truth of review verdicts and "CLEAN/NO_BLOCKERS" statements in notes (S1/S2/S3): reviews were not re-run; only the ledger structure and GitHub PR/CI state were recomputed.
- Any VERIFIED_REAL_ENV or USABLE_BY_END_USER claim: needs a real Windows/Electron/Android environment; tests and installs were forbidden here (NOT_RUN_ENV_UNAVAILABLE). The installer check-run is success on base (V) but only proves INSTALLER_CREATED on a GitHub runner, not an end-user install.
- Runtime scheduler/run state (.ai/runtime is not in git): phase attempts, run journals, role RUNNING state = UNKNOWN.
- Whether the required-checks ruleset (not read) was what gated each merge; I used "validate ubuntu+windows success on head or merge commit" as the CI evidence test.
- Review activity before 2026-10-26 (ledger starts then); sessions, routines/triggers and cost figures (not queried; given by the coordinator as COORD-VERIFIED).
- The master V2 spec document (UASCO_NIHAI_TEK_SISTEM_MASTER_V2_DESKTOP_UX001-071_2026-10-14.md) is absent from the repo (WAVE0 FD-6); items 1-71 UX001 mapping cannot be checked.
- Code on closed-unmerged branches (e.g. UI-074 Provider Hub on #8): branches were not fetched or inspected; I only know the PR was never merged and the feature is absent on base.
- Notes-derived commit/PR evidence for S1 DONE records is E (SHAs and #n tokens parsed from free text); G2-records.json keeps the evidence string per record so each can be re-checked.
