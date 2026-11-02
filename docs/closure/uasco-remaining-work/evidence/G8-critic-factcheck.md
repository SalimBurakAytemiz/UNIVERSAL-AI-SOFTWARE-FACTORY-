<!-- //TR: G8 eleştirmen ve olgu kontrolü raporu (UASCO_REMAINING_WORK taslağı) -->
# G8: completeness critic and fact check of UASCO_REMAINING_WORK (draft)

| Field | Value |
| --- | --- |
| Target | `closure-2026-11-02/UASCO_REMAINING_WORK.md` (62,787 B before, 67,777 B after) and `.json` (203,128 B before, ~210 KB after) |
| Inputs | G1-G7, COORD-STATE.md, synthesis prompt (wf_06594e98-74b synthesis agent, directive phases 5/10/11) |
| Evidence window | 2026-11-02T04:16Z - 04:40Z (re-checks done at about 04:25-04:35Z) |
| Mode | Read-only against repo/GitHub/sessions. Only the two draft files were edited (all `{{CLOSURE_*}}` placeholders kept, 53/53 in both files). No test suite run, no npm install. |
| Backups | `scratchpad/g8-fix/UASCO_REMAINING_WORK.{md,json}.bak` (pre-correction). Edit scripts: `scratchpad/g8-fix/fix-md.mjs`, `fix-json.mjs`, `fix-json-q3.mjs` |
| JSON validity | `node -e 'JSON.parse(require("fs").readFileSync(p))'` passes after the edits |

Labels: VERIFIED = I checked it against the primary source in this pass. CLAIMED = a document says so and I did not re-check it. ESTIMATE = inference, with method. COORD-VERIFIED = the coordinator's facts of 2026-11-02.

**Warning:** `scratchpad/rw-build/build.mjs` (with `inventory.mjs` and `roadmap.mjs`) writes both target files from scratch (`build.mjs:390`, `:668`). If anyone re-runs it, every correction below is lost. Either port the corrections into `rw-build/*.mjs` or do not regenerate.

## 1. Fact check of load-bearing claims (31 claims)

Result: **22 confirmed as written**, **9 corrected** (3 of them material: A.4 "all new CI red", the protected-prefix count, and 2 roadmap tasks marked COMPLETE against the report's own rule).

| # | Claim in draft | Primary source and method (this pass) | Result |
| --- | --- | --- | --- |
| 1 | v7/integration HEAD 0b71650 (merge #290, 2026-10-27T11:34:54Z) | `git ls-remote origin refs/heads/v7/integration` at 04:25:53Z gives 0b71650fa88b...; last merged PR in `gh api pulls` is #290 at 2026-10-27T11:34:55Z | VERIFIED |
| 2 | About 136.3 h since the last merge (to 03:50:46Z) | python: 2026-10-27T11:34:55Z to 2026-11-02T03:50:46Z = 136.26 h | VERIFIED |
| 3 | 9 open PRs with heads ee2facb, 43776e1, 4b4eee0, 7bf22e5, b13e23d, f40bea3, 323c14f, c9a3e2d, ffeaf79 | `git ls-remote refs/pull/N/head` plus `mcp__github__list_pull_requests state=open`: all 9 heads match. Draft flags match (#293 and #292 not draft, the other 7 draft) | VERIFIED |
| 4 | PRs total / open / merged / closed-unmerged = 293 / 9 / 259 / 25 | `gh api repos/.../pulls?state=all` pages 1-4 into `scratchpad/g8_prs.tsv`; awk count | VERIFIED |
| 5 | Merged PRs per lane 53 / 36 / 33, giving $/merged PR 4.01 / 3.66 / 13.02, fleet $20.3 | head-ref prefixes `claude/lane-a|b|c` among merged PRs = 53/36/33; 212.61/53 = 4.01, 131.93/36 = 3.66, 429.60/33 = 13.02, 5255.19/259 = 20.29 | VERIFIED |
| 6 | Session cost_usd: Lane A $212.61, Lane B $131.93; coordinator $4,481.05 (03:22Z); four sessions $5,255.19; 28 sessions $5,476.68; coordinator 85% | `get_session` 04:28Z: A 212.614 and B 131.927 (exact); coordinator now 4516.63 and Lane C now 438.27 (both higher, so the 03:22Z values are consistent). Sums recomputed from `g6_costs.json`: 5255.19 / 5476.68; 4481.05/5255.19 = 85.3% | VERIFIED (current values added) |
| 7 | Cache-read share of tokens 97.3-99.2% | `g6_costs.json`: coordinator 97.3%, A 99.1%, B 99.2%, C 98.0% | VERIFIED |
| 8 | Lane C runs Sonnet 5.5 at xhigh + ultracode; Lane A at high, no ultracode | `get_session`: Lane C `effortLevel xhigh, ultracode true`; Lane A `high, ultracode false`; coordinator Opus 5.5 xhigh + ultracode | VERIFIED |
| 9 | Ledger @afe2f9b: 127 records / 54 PRs; 53 full / 74 delta; 45 BLOCKERS / 64 clean family / 16 base-merge-only / 2 round-limit; tests[] empty; first record 2026-10-26 | `pqw` HEAD = afe2f9b = origin (ls-remote 04:25Z). node over COORD-LEDGER.json: 127/54, kind 53/74, prefix families 45/64/16/2, top-level `tests` length 0, no record has tests, first `at` 2026-10-26T14:05:57Z | VERIFIED |
| 10 | #293 full = BLOCKERS_GOV_FOUNDER_AUTHORITY; #292 delta NO_BLOCKERS @43776e1; #291 full NO_BLOCKERS_4LOW @4b4eee0; #288 BLOCKERS 2M+14L @73fa26e | per-PR ledger records (sha + verdict) | VERIFIED |
| 11 | Prior audit: 133 findings (P0 6, P1 32, P2 64, P3 31); 4 P0 security findings AUD-001..004 | node over `09 MASTER FINDINGS.json`: 133, 6/32/64/31; P0 domains: governance/identity, protected-paths, ci/runner, api-security, work-os/verification, product-acceptance | VERIFIED |
| 12 | 599 roles (0 evaluated), 9 bound, 3594 eval specs (0 run), 194/110/45 NOT_IMPLEMENTED, 363 legacy agents, profiles PROPOSED_DERIVED_NOT_RUNTIME | node over `registries/role-definitions.json` (599 roles, runtimeStatus UNKNOWN 599, proficiency NOT_EVALUATED 599, 3594 specs all NOT_EXECUTED), `role-execution-profiles.json` (bound=true 9, status PROPOSED_DERIVED_NOT_RUNTIME), tool-adapters 194, capabilities 110, execution-fabrics 45 (all `implementation: NOT_IMPLEMENTED`), agents.json 363 | VERIFIED |
| 13 | "All 9 bound roles go to one CLI and one quota" (G) | `core/agents/first-delivery-bindings.ts:12-28`: 6 CLAUDE_REVIEWER, 2 CLAUDE_IMPLEMENTER, 1 DETERMINISTIC_STUDIO (UASCO-0232 delivery) | **CORRECTED** to 8 of 9 |
| 14 | Protected paths: 138 exact + 10 prefixes; core/* 0; only ci.yml among workflows | `config/protected-paths.json` @0b71650: exactPaths 138, **protectedPrefixes 13**, stateOwnedBySupervisor 1 (`.ai/runtime/`); no `core/` entry; only `.github/workflows/ci.yml` | **CORRECTED** (13, not 10; the 10 comes from G4) |
| 15 | Trust root SEALED, 373 files, unsigned | `config/trust-root-manifest.json`: sealStatus SEALED, files 373; no sign code in `scripts/verify-trust-root.mjs` or `automation/lib/trust-root.mjs` | VERIFIED |
| 16 | AUD-004 fixed by a deny-by-default hook (server.ts:126-131) | `apps/control-api/src/server.ts:126-131` onRequest hook: only exact `/health` is token-free | VERIFIED (code; tests not run) |
| 17 | Action-gateway policy context hard-coded ALLOW (server.ts:193-196) | `server.ts:194`: `scopeAllowed:true, dataPolicyAllowed:true, budgetAllowed:true, adapterCertified:true, ...(opts.policyContext??{})` | VERIFIED |
| 18 | Installed app cannot run project code; non-Linux provider null (packaged-entry.ts:54; server.ts:299-301) | `packaged-entry.ts:54` ("sandbox seçeneği YOKTUR ... SANDBOX_UNAVAILABLE"); `server.ts:300` returns null when `process.platform!=="linux"` | VERIFIED |
| 19 | Flow step 9 PLAN: routeModel / chooseProvider used only in tests | `git grep routeModel\|chooseProvider`: defined in core/policy/model-routing.ts and models/router/router.ts; used in tests/*; no importer under apps/, core/ or models/ | VERIFIED (label made explicit: CODED core, not wired) |
| 20 | Flow steps 14-16: 0 PR/merge/deploy code in the product; deployPanel always BLOCKED (delivery.js:86) | `git grep` for api.github.com, octokit, /pulls and git push in apps, core, models = 0; `apps/desktop/renderer/views/delivery.js:86` deployPanel is Founder-gated | VERIFIED |
| 21 | Flow step 1 evidence routes/intake.ts:29 | line 29 = `app.post("/v1/intakes", ...)` | VERIFIED |
| 22 | Flow summary REAL 5 / REAL-code-SIM 8 / PARTIAL 2 / PLAN 5 | recount of the draft table and mermaid classes; matches G5 §5 lines 118-139 | VERIFIED as transcription (classification itself is ESTIMATE in G5). The draft had no definition of REAL, so a definition was added |
| 23 | Zero-commit share 55.2% (211.8 / 383.9 h); gaps 77.4 h and 134.4 h | `git log --all --format=%ct` over all fetched refs: gaps 2026-10-22T21:12:59Z to 10-26T02:39:48Z (77.4 h) and 2026-10-27T11:54:55Z to 11-02T02:15:57Z (134.4 h) | VERIFIED; **cause wording corrected** (only gap 2 is COORD-VERIFIED weekly limit; gap 1 cause is ESTIMATE in G7) |
| 24 | Quota windows: window 1 = 79 active h, 176 merges; window 2 = 34 h, 74 merges | merged_at counts: 2026-10-19T02Z-10-26T02Z = 176; 10-26T02:39Z-10-27T11:55Z = 74; 9 earlier merges (Oct 17-18) sit outside window 1 | VERIFIED; window definition added |
| 25 | Cycle time: last-40 median 1.85 h (p90 8.25); all 259 median 1.93 h | python over created_at / merged_at from `gh api pulls` | VERIFIED (p90 8.24 by nearest-rank) |
| 26 | 1277 commits / 536 merge commits since 2026-10-17 on v7/integration | `git rev-list --count [--merges] --since=2026-10-17 origin/v7/integration` = 1277 / 536 | VERIFIED |
| 27 | Release / tag 0 / 0; installer artifact 12730997533, 111,344,297 B, expires 2026-11-26 | `list_releases` = [], `list_tags` = []; `list_workflow_run_artifacts 40497319565`: id 12730997533, 111344297 B, expires 2026-11-26T11:40:54Z, head 0b71650 | VERIFIED |
| 28 | A.4 / metric baseCi: "all new CI runs are red" | `get_check_runs #293`: validate ubuntu, windows, shards 1-3 success (run 41381085868); installer success (41381085966); founder-authority job `waiting` (run 41381085962). Run 41377356505 (#292) = failure | **CORRECTED**: red only without the fix; #293's own CI is green |
| 29 | Triggers: 10 recurring, 3 http_api, 3 enabled (heartbeat, ICR, Cloud Dev) + 1 one-shot planned | `list_triggers recurring=true include_completed=true` = 10 (3 created_via http_api: ICR, Cloud Dev, probe); `enabled=true` = 3; `get_trigger trig_0137JfTiMWXAbqVQNaPSMVmF`: fired 03:56:44Z, enabled false, ended_reason run_once_fired. ICR last fired 03:39:10Z, Cloud Dev 03:29:53Z. Controller and 3 lane ticks: enabled false, updated 02:27:25Z | VERIFIED; **safety-net state corrected** ("planned (CLAIMED)" was stale) |
| 30 | Sessions 105 (86 cloud, 19 bridge), 2 RUNNING, 82 idle for 7+ days, 4 blocked, 3 review-ready, newest created 2026-10-21T07:23Z | `list_sessions` p1 (100) + p2 (5): 86 anthropic_cloud + 19 bridge = 105; at 04:30Z RUNNING = 0 (IDLE 86, ARCHIVED 19; buckets completed 92, review_ready 3, blocked 4, working 1); idle >7 d = 82; newest created 2026-10-21T07:23:03Z | VERIFIED; **RUNNING timestamped** (2 at about 03:2xZ per G6, 0 at 04:30Z) |
| 31 | Actions 0 queued / 0 in_progress / 1 waiting (39687649214) | `actions_list` 04:27Z: queued 0; in_progress 1 (CI 41386006766 on #288); waiting 2 (39687649214 since 2026-10-21T22:35:58Z; 41381085962 #293) | **CORRECTED** (baseline value timestamped to about 02:55Z; current value added) |

Also checked and confirmed: ruleset (`gh api .../rules/branches/v7%2Fintegration`: 0 approvals, `require_last_push_approval false`, required checks validate ubuntu/windows, strict false); EV11 file `audit/checkpoints/V7-PKG-B3B-LIVE-SMOKE-EVIDENCE-2026-10-14.json` contains durationMs 32114; BACKLOG_CHECKPOINT last commit 7f4c858 2026-10-20T15:58:29Z; PRODUCTION-QUEUE tasks: 16 (15 INTEGRATED, 1 TESTED), latest date 2026-10-22T03:50Z; LANES.json 26 lanes, builderCap 4 (queue builderCap 3); ROADMAP.md 149 phase headings; mobile = 5 TS files, 548 lines (+ an 11-line README); `tests/*.test.ts` = 123 files, and all 123 appear in `config/validation.json`, while `apps/mobile/src/core/monitoring.test.ts` does not; C5 conflict: the 259 merged PRs have 175 unique `merge_commit_sha` values, all ancestors of v7/integration.

Not re-verified (left as in the draft, CLAIMED from the auditor files): the 50 one-shot triggers, CI pass rates and durations (G1), runner-minute estimate (G6), 168 merged PRs with no record (G2), product-line share 16.1% (G7), Founder-pending 13 groups (G7), security recheck 16 (G4), npm audit run locally (G1/G4; the CI log and the #293 commit message are consistent), and mergeable_state `dirty` for #251/#247/#231 (the MCP list did not return the field).

## 2. Completeness against the directive (synthesis prompt phases 5, 10 and 11)

| Requirement | Present? | Notes |
| --- | --- | --- |
| MD line 1 `<!-- //TR: UASCO kalan iş ve kapanış raporu (kanonik) -->` | Yes | |
| Sections A-J in Turkish | Yes | A Yönetici Özeti ... J Yeniden Başlatma Stratejisi |
| B with `{{CLOSURE_*}}` placeholders | Yes | 53 distinct placeholders, the same set in MD and JSON, unchanged by this pass |
| D prioritised table | Yes | 80 open rows + 7 CLOSED listed |
| E 20-step flow table + mermaid | Yes | 20 rows; mermaid classes match the table. **Added:** class definitions (REAL is not VERIFIED_REAL_ENV) |
| Baseline vs Closure table | Yes | 18 rows with placeholders |
| Evidence index | Yes | EV01-EV44 before, **EV45-EV46 added**; every EV reference in MD and JSON resolves (0 dangling) |
| 12 restart questions | Yes | J.1 1-12 and JSON `plans.restartQuestions` (12) |
| Plans A/B/C: scope, work items, dependencies, order, effort, cost assumptions, risk, acceptance | Mostly | Missing before: an explicit per-plan **dependencies** field and per-plan cost assumptions (there was only one global formula); the J.2 table did not say its PR/cost/runner/Founder columns are cumulative. **Added:** "Dış bağımlılıklar" + "Maliyet varsayımı" bullets in MD; `dependencies` + `costAssumptions` in JSON; "(kümülatif)" column labels |
| Plan item coverage | Yes | Plan A order covers all 28 ids, B all 30, C all 17 (checked id by id). No dependency points to a later plan (script check: 0 issues) |
| Plan arithmetic | Yes | Recomputed: A 139-385 h, B +308.5-816, C +810-2106; non-Founder items 23/52/68 cumulative, giving PR 23-69 / 52-156 / 68-204, $92-1401 / $208-3167 / $272-4141, runner-min 4163-12489 / 9412-28236 / 12308-36924; Founder-involved 15/37/46 |
| Inventory fields (id, name, description, module, department, priority, status, completionCriteria, dependencies, links, risk, needs, testNeeds, effort S-XL + hours, verificationMethod) | Yes | 87/87 items carry all fields; ids UASCO-RW-001..087, unique; links non-empty. `mergedFrom` on all 87 |
| Inventory counts | Yes | P0 8, P1 33, P2 30, P3 9; BLOCKED 24, OPEN 53, UNKNOWN 3, CLOSED 7; plans A 28, B 30, C 17, DEFER 5, DONE 7: all recomputed. **Corrected:** "254 ids" = 254 references, 248 unique (6 ids appear in two items) |
| Epic/Feature/Task ids | Yes | E01-E09, F001-F049, T0001-T0129, all unique and well formed; every task has links and a valid feature; every feature has evidence |
| JSON top-level keys | Yes | //TR, schemaVersion, generatedAt (2026-11-02T02:50:00Z), integrationHead, baseline, inventory, roadmap, agents, cost, plans, evidence, closure |
| Missing auditors marked INCOMPLETE | n/a | none missing (G1-G7 present) |

## 3. Unverified presented as VERIFIED/PASS, and fabricated numbers

- No fabricated numbers found. Every number I recomputed matched its source, or differed only by time (costs, session states) or by definition (window 1).
- No PASS claim for tests that were not run. The full suite 3251/10/24 stays CLAIMED (EV40). Sandbox, Windows and Electron tests stay NOT_RUN_ENV_UNAVAILABLE.
- Over-strong tags corrected:
  - Baseline metric `verifiedRealEnv` was tagged VERIFIED as a whole, but its "1 toy live run" is self-reported. It is now VERIFIED (installer CI) / CLAIMED (live-run content).
  - Metric `baseCi` and A.4 ("all new CI red"): false for #293 (see claim 28).
  - The cause of the whole 55.2% was stated as the weekly limit (A.5, J.1 Q3). Only the second gap is COORD-VERIFIED.
  - Roadmap tasks marked COMPLETE against the report's own rule (COMPLETE = merged + CI-tested in its own scope):
    - UASCO-T0080 (mobile core, PR #159): its test `apps/mobile/src/core/monitoring.test.ts` is not in `config/validation.json` (RW-064).
    - UASCO-T0094 (desktop journey harness, PR #234/#245): no workflow runs it on base, which has only ci.yml, uasco-independent-review.yml and windows-installer.yml; its results are CLAIMED (EV41).
    - Both are now PARTIAL. Task counts go from COMPLETE 38 / PARTIAL 5 to COMPLETE 36 / PARTIAL 7. Feature statuses are unchanged (F035 PARTIAL, F041 BLOCKED).
- Stale baseline facts timestamped rather than silently overwritten: Lane C RUNNING (now IDLE since 04:02Z), RUNNING sessions 2 (now 0), Actions 0/0/1 (now 0/1/2), safety-net one-shot "planned" (it fired at 03:56:44Z).

## 4. Does the inventory re-open finished work?

Method: I compared open items against the 259 merged PR titles (`gh api pulls`, grep for command/pause/resume/restart/notif/fuse/mobile/journey/sign/budget/routing/lease/crew/update/sast and similar), against the CLOSED items RW-081..087, and against code on base.

| Item | Finding | Action |
| --- | --- | --- |
| RW-025 command field | Core #134 merged; `git grep command-intake` gives only tests/mission-state.test.ts. Wiring is really missing, and the item already says do not rewrite | none |
| RW-036 model routing | #130 merged; no product importer; the Desktop read-only routing view (#157) exists, and the item asks only for a selector and wiring | none |
| RW-004 Windows sandbox | Linux provider merged (#168/#184/#227, CLOSED RW-085); item scoped to Windows | none |
| RW-051 backend lifecycle | `main.mjs:350` only nulls the backend on exit; no restart or crash handler (#204 is dev-run restart, a different thing) | none |
| RW-064 mobile test in CI | Confirmed not in validation.json | none |
| RW-024 Windows desktop E2E CI | Harness merged (#234/#239/#245/#246) but no workflow on base | none |
| RW-013 Windows CI stability | **#221 FD-LV1 v4 already merged (via #225 wave-P1)**; the item did not say so | added `alreadyDoneDoNotRedo` |
| RW-061 CI minute efficiency | **#251 CI-TEP1 (Linux preflight + same-run shard reuse) is already implemented in a Founder-held PR**; the item did not link it | added link, dependency RW-012, `alreadyDoneDoNotRedo` |
| RW-076 #288 | Repair r1 already pushed (7bf22e5, 04:01Z); the item says so (DEFER) | none |
| RW-045 Lane C freeze | Lane C IDLE since 04:02Z; `claude/lane-c-eval-tester` = dc85a9f, 0 commits ahead of base | description updated |

No open item duplicates a CLOSED item. The 6 shared `mergedFrom` ids are partial overlaps that the "(kısım)" tags already mark, or core-versus-wiring splits (PQ-011 in RW-025 and RW-087).

## 5. Corrections applied (both files unless noted)

1. A.2: "4. adımda" clarified. It is step 4 of G3 §2.4's five-step user loop, which is steps 10 and 12 of the 20-step flow.
2. A.4 + metric `baseCi` + Baseline-vs-Closure "Base CI": runs without the fix are red; #293's CI is green (41381085868, installer 41381085966); its IR founder-authority job is waiting (41381085962). New EV45.
3. A.5 and J.1 Q3: weekly-limit cause limited to gap 2 (COORD-VERIFIED); gap 1 cause marked ESTIMATE.
4. A.9 and D header: 254 mergedFrom references = 248 unique ids (JSON `mergedFromUniqueIds`, `mergedFromNote`); `alreadyDoneDoNotRedo` exists on 5 items, not on every item.
5. B.1 #293 row and JSON `openPrs`: CI-green and founder-authority-waiting state added.
6. B.2 ICR and Cloud Dev: later fires 03:39:10Z / 03:29:53Z added (they keep firing during the pause).
7. B.2 safety-net one-shot: "planned (CLAIMED)" → fired 03:56:44Z, enabled=false, run_once_fired (VERIFIED).
8. B.2 Lane C: RUNNING timestamped to about 03:21Z; IDLE since 04:02Z.
9. B.2 Actions and Baseline-vs-Closure Actions: 0/0/1 timestamped to about 02:55Z; 04:27Z = 0/1/2.
10. D table and JSON: RW-061 dependencies 013 → 012,013; link to #251; alreadyDone note. RW-013 alreadyDone note (#221/#225).
11. JSON: RW-001, RW-002 and RW-045 descriptions updated with the current CI, fire and freeze state.
12. D.2 and JSON roadmap: T0080 and T0094 COMPLETE → PARTIAL (statusNote); counts COMPLETE 36 / PARTIAL 7; JSON `roadmap.taskStatusCounts` added.
13. E: classification definitions added (REAL is not VERIFIED_REAL_ENV); step 9 → "PLAN (CODED core, not wired)".
14. F and metric `sessions` and Baseline-vs-Closure: RUNNING 2 timestamped; 04:30Z = 0 (EV46).
15. G: provider concentration corrected to 8 of 9 bound roles (1 DETERMINISTIC_STUDIO).
16. H: coordinator $4,516.63 and Lane C $438.27 at 04:28Z added; window-1 definition added (JSON `quotaWindows[].definition`, `cost.trend` entry).
17. I: C5 resolved (175 unique merge_commit_sha, verified); new C14 (#293 CI) and C15 (13 protected prefixes).
18. J.1 Q6: "builderCap 4" is pinned to LANES.json (queue builderCap 3).
19. J.2: "(kümülatif)" labels on the Founder/PR/cost/runner columns; per-plan "Dış bağımlılıklar" and "Maliyet varsayımı" bullets (JSON `plans.*.dependencies`, `plans.*.costAssumptions`).
20. Baseline-vs-Closure: enabled triggers (one-shot fired); VERIFIED_REAL_ENV row split into VERIFIED / CLAIMED; RUNNING and Actions rows timestamped.
21. Evidence index: EV14 (13 prefixes), EV21 (5 TS files + README), EV22 (one-shot fired; recount scope), EV44 (RUNNING timestamp, recount); new EV45 and EV46; "G8" marker defined.

## 6. Unresolved / for the coordinator

- The regeneration risk from `rw-build/build.mjs` (see the warning at the top).
- G4-factory-qa-security.md still says "138 exact paths + 10 prefixes" (an input file, not edited).
- Live items move while the closure runs. The #282 r3 and #288 r1 delta reviews are running (ledger head is still afe2f9b at 04:25Z), the #288 CI run 41386006766 is in progress, and the ICR and Cloud Development routines fire hourly until the Founder disables them. The `{{CLOSURE_*}}` fields must capture the final state.
- The not-re-verified CLAIMED numbers listed at the end of section 1.
