<!-- //TR: PR darboğaz analizi (#1-#48): birleştirme sırası, yığılmış PR'lar, ortak dosya çakışma riski ve en çok PR'ı açan tekil müdahaleler / PR bottleneck analysis -->
# PR bottlenecks: merge order, stacks, conflict risk, single interventions

Scope O of the 2026-10-19 inventory. This file is evidence-based. It makes no CLEAN, PASS or MERGED claim that the cited sources do not support. Rows are in `prs.csv` in this folder, one per PR #1-#48.

## 0. Sources and snapshot drift

- Snapshot: `inv-src/prs.json` (generated 03:02Z) and `inv-src/branch-diff-index.json`.
- Live reads: about 04:20-04:30Z on 2026-10-19 through GitHub MCP `pull_request_read` (`get_reviews`), plus REST `gh api` for pulls, files, check-runs, branches and rulesets.
- Code base: `origin/v7/integration` is at `e12dbdd`. GitHub reports `v7/integration` as `protected:false` and `master` (`061f78d`) as `protected:false`. `GET /repos/.../rulesets` returns `[]`, and `GET .../branches/v7%2Fintegration/protection` returns 403 (not readable).

The live state differs from the snapshot in these ways:

| Change since the snapshot | Evidence |
|---|---|
| #13 and #14 were closed unmerged at 03:56Z as superseded by #18 and #17. | Issue comments at 03:56:27Z and 03:56:25Z. |
| #30 was closed unmerged at 03:24:58Z as superseded by #49. | Issue comment: "Superseded by #49. Closing without merge." |
| Six PR heads moved after BLOCKED pre-reviews: #11 → `60cc112`, #16 → `3c2bfee`, #26 → `0a60c14`, #33 → `b8d2f51`, #38 → `d8a4fcc`, #42 → `1b4e6a3`. None of these new heads has a review yet. | `pulls/{n}/commits` and `pulls/{n}/reviews` (the last review is bound to the old SHA). |
| New PRs #49 (`claude/public-cloud-ci`, `498e2eb`) and #50 (`claude/e2e-desktop-product-verification`, `ba775b82`) were opened. They are **not** rows in `prs.csv`, which keeps the #1-#48 scope. | `gh api pulls?state=all` |
| **The repository is now PUBLIC** (`private:false`, `visibility:public`). The #30 close comment says "The repo is now PUBLIC, so the standard GitHub-hosted ... runners are free." The only `PublicEvent` in the events feed is dated 2026-09-25T22:41:37Z (actor SalimBurakAytemiz). When and by whom the repo was last made public is **UNKNOWN**. | `gh api repos/...`; `/events` |

The Founder's 2026-10-19 directive says to keep the existing *private* GitHub repo, use CircleCI Free first, and enable no paid resources. The repo being public and #49 depending on free public GitHub-hosted runners conflict with "keep private". This needs an explicit Founder decision (**AUTHORITY_REQUIRED**). The inventory did not change it.

## 1. Status of the 48 PRs (counts equal the `prs.csv` rows)

| Status | Count | PRs |
|---|---:|---|
| INTEGRATED_NOT_VERIFIED | 8 | #1, #2, #3, #4, #5, #6, #7, #9 |
| MERGED_NOT_INTEGRATED | 1 | #10 (lease mechanism, not wired; FA-LEASE2) |
| PENDING_CI | 29 | #12, #15, #17-#25, #27-#29, #31, #32, #34-#37, #39-#41, #43-#48 |
| PENDING_REVIEW | 6 | #11, #16, #26, #33, #38, #42 (remediation pushed after BLOCKED; no review on the new head) |
| AUTHORITY_REQUIRED | 1 | #8 (dirty conflict, 11 commits behind; edits protected `config/validation.json` and `config/trust-root-manifest.json`, so it needs a maintainer reseal after the rebase) |
| DUPLICATE | 2 | #13 (→ #18), #14 (→ #17) |
| OBSOLETE | 1 | #30 (self-hosted runner; superseded by the no-local-CI decision and #49) |
| **Total** | **48** | 9 merged, 36 open, 3 closed unmerged |

There are 45 distinct work items: 48 rows minus 2 DUPLICATE minus 1 OBSOLETE. #6 and #7 are counted as two rows because both merged, but they are one UI-071 work item, so the number of distinct live work items is 44.

`PRODUCT_VERIFIED` = 0. No PR has recorded evidence of the real desktop app and live backend exercising the screen. #50 adds a desktop-e2e harness whose `desktop-e2e (ubuntu-latest)` and `desktop-e2e (windows-latest)` check runs succeeded on `ba775b82`. That is the first candidate for such evidence, but it is unmerged and unreviewed (0 reviews), and its `validate (windows-latest)` is red. It is not product verification yet.

## 2. Facts that gate every merge

1. **Windows validation has never been green on any PR head.** `validate (windows-latest)` = failure on all 50 PR heads read (check-runs per head SHA, `checkruns.txt` method).
   - Heads pushed up to about 10:40Z on 10-18 got real runs: ubuntu mostly success, windows failure after about 11-12 minutes. The last such head is #11 `9f978b6` at 10:39Z (review 5562577474).
   - Heads pushed from about 11:38Z on 10-18 (#11 `1fb038a`, review 5562778812) until 03:30Z on 10-19 (for example #30 `c960949` at 02:55Z) got runs that died in 1 minute or less. Those runs give no test result, which matches the exhausted Actions quota.
   - Heads pushed from about 03:36Z on 10-19, after the repo went public, again got real runs. These are #49, #50, #11, #16, #26, #33, #38 and #42. ubuntu was green on #11, #16, #26, #33, #38 and #42, and windows was red on all of them.
2. **All 9 merged PRs went in with `validate (windows-latest)` = failure on their head**, for example #1 `44777ad`, #9 `6db12a5` and #10 `9469494`.
   - **#9 and #10 were merged without any CLEAN verdict bound to their final head.** #9's last verdict is BLOCKED @`9f0018d`. #10's last verdict is INCONCLUSIVE @`a77e082`. Both still carry `uasco-needs-fix`.
   - #1-#7 have no GitHub review object. Their "local CLEAN" claims have no V7 review file under `audit/reviews/` on v7.
3. **The current reviewer protocol defers every final verdict.** Every 2026-10-19 CLAUDE_REVIEWER PRE-REVIEW ends with: "Final verdict pending: merge of v7/integration (incl. PR #49) + green validate (ubuntu-latest) and validate (windows-latest) on the final head SHA. Not CLEAN." So **no open PR is CLEAN_NOT_MERGED today**. Earlier CLEAN comment verdicts on #12, #15, #17, #18, #21, #29, #31, #32 and the test-states PRs are content-only, and the later pre-review explicitly supersedes them.
4. **No enforced merge gate.** There is no branch protection, no rulesets, and no second GitHub identity: all reviews are COMMENT reviews under `SalimBurakAytemiz`. The coded gate `scripts/merge-via-gate.mjs` exists only on #11, and its latest reviewed head `7c5e68b` was BLOCKED for two MEDIUM issues: a self-attested verdict file, and `--apply` not being bound to the live base.

## 3. Stacks and supersession (merge-order dependencies)

| Chain | Evidence | Required order |
|---|---|---|
| #24 (UI-049) → #25 (UI-050) → #26 (UI-051) | `pr/24` is an ancestor of `pr/25`, and `pr/25` of `pr/26` (pre-reviews 5566711978, 5566713226). | Merge #24, then #25, then #26. #26 needs a re-review of `0a60c14` first. |
| #27 (UI-070 #/audit) → #28 (UI-078 #/integrations) | `merge-base(pr/27,pr/28)=326f04b` (#27 head). | Merge #27, then #28. |
| #15 (cloud-production docs) ⊂ #31 (CP-GOV scaffold) | #31 contains #15's commits `88a4469..ed5cfb9`, and the shared files are byte-identical. | Merge #15 first, or close #15 as subsumed by #31. |
| #14 → #17 (CP-QUEUE) | `86b6648` is an ancestor of #17. #14 is closed. | #17 only. Its merge-base `cd4b104` is behind v7, so the branch needs updating. |
| #13 → #18 (CP-REPORT) | `b08e319` is an ancestor of #18. #13 is closed. | #18 only. Import `STATUSES` from #17's `queue.mjs` after #17 lands. |
| #6 → #7 (UI-071) | Both merged. | Done. |
| #30 → #49 (CI) | #30 was closed and superseded. | #49 is the CI vehicle, pending the Founder decision in §0. |
| #49 → all open PRs | The pre-review footer on every open PR requires merging v7 including #49. | #49 first. It is not CLEAN: verdict INCONCLUSIVE @`498e2eb`, and both validate jobs failed on that head (03:36-03:47Z). |

## 4. Shared-file conflict risk among open PRs (from `branch-diff-index.json`)

There are 36 open PRs and **102 overlapping pairs**: 104 pairs in the index minus the two closed pairs #13/#18 and #14/#17.

**Hot files**, with the number of open PRs that touch each one:

| File | Open PRs |
|---|---|
| `apps/desktop/renderer/locales/en.js` and `tr.js` | 13: #8, #19, #20, #22-#28, #32-#34 |
| `apps/desktop/renderer/styles.css` | 10: #8, #22-#28, #32, #33 |
| `apps/desktop/renderer/api.js` | 8: #8, #24-#28, #32, #33 |
| `tests/v7-ps1b-project-studio-ui.test.ts` | 8: #8, #27, #28, #32, #33, #35, #44, #46. #35, #44 and #46 are append/append, and `git merge-tree` confirmed #35×#44 per the pre-review. |
| `apps/desktop/renderer/routes.js` | 6: #8, #20, #27, #28, #32, #33 |
| `views/planned.js` (REAL) plus 8 exact-order route-list tests (queue, journey, operations, posture, executive, b4-desktop-shell, readiness, matrix) | 5 each: #8, #27, #28, #32, #33 |
| `views/assurance.js` and `tests/v7-ux-wp-qasec.test.ts` | 4: #24, #25, #26, #41 |
| `assurance-core.js` | 3: #24, #25, #26 |

**Certain conflicts.** The pre-reviews name these explicitly:

- #19 × #20 in the locales: keep `map.delivery` and drop `projects.list`.
- #27/#28 × #32 × #33 in `routes.js`, `planned.js` REAL, the `api.js` hunk around line 170, and the route lists. Whichever lands later must carry all route ids and bump `slice(-N)`.
- #35 × #44 × #46 in the shared studio test file.

**Same-file pairs in otherwise small PRs:**

- #19 × #36 (`views/home.js`, cockpit test)
- #22 × #48 (`views/workforce.js`, wp-agents test)
- #23 × #34 (`views/tower.js`, wp4-tower test)
- #24-#26 × #41 (`views/assurance.js`, qasec test)

**Isolated PRs.** These 15 open PRs share no file with any other open PR, so they can merge in any order once CI is green: #11, #12, #16, #17, #18, #21, #29, #37, #38, #39, #40, #42, #43, #45, #47.

**Highest conflict degree**, as the number of other open PRs sharing a file:

- 15: #8, #27, #28, #32, #33
- 13: #19, #22, #24, #25, #26
- 12: #20, #23, #34
- 7: #35, #44, #46

## 5. Suggested merge waves (after green CI on both OSes and a final CLEAN per head)

1. **Wave 0, CI vehicle:** #49, or the CircleCI equivalent, once the Founder decides the visibility and CI-platform question (§0). Without it no PR can get a final verdict.
2. **Wave 1, isolated and no conflicts:** #12, #17, #18, #21, #29, #37, #39, #40, #43, #45, #47.
   - After a re-review of their moved heads: #16, #38 and #42.
   - #11 is security-critical. It needs a re-review of `60cc112` and a Founder decision before branch protection is applied.
3. **Wave 2, docs stack:** #15, then #31, or close #15 as subsumed.
4. **Wave 3, renderer small pairs, serialised:**
   - #19, then #20 with the locale resolution, then #36.
   - #23, then #34.
   - #22, then #48.
5. **Wave 4, assurance stack:** #24, #25, then #26 (re-review `0a60c14`), then #41.
6. **Wave 5, route cluster, strictly one at a time with a rebase between each:** #27, #28, #32, then #33 (re-review `b8d2f51`). #8 is last: it needs a rebase onto `e12dbdd`, conflict resolution and a maintainer trust-root reseal.
7. **Wave 6, studio test appends:** #35, #44, #46, merged one at a time, keeping every block.

## 6. Single interventions that unblock the most PRs

| # | Intervention | PRs unblocked | Notes |
|---|---|---:|---|
| 1 | **A Windows + Linux validate that passes for real on a head that every PR can merge in.** This means #49, or CircleCI per the Founder directive. | **36** (all open) | Windows validate has never been green on any PR head. #49 also edits protected `.github/workflows/ci.yml`, `config/validation.json`, `config/trust-root-manifest.json` and `scripts/phase0-acceptance.mjs` under a claimed authority `FD-PUBLIC-CI-2026-10-19` (docs/cloud-production/ci/public-ci/AUTHORITY-FD-PUBLIC-CI-2026-10-19.md), which cannot be verified from the repo. |
| 2 | **A Founder decision on repo visibility and CI platform** (public GitHub-hosted versus private + CircleCI Free). | 36, indirectly | This decides whether the #49 path is admissible at all. |
| 3 | **One reviewer pass over the six moved heads:** #11 `60cc112`, #16 `3c2bfee`, #26 `0a60c14`, #33 `b8d2f51`, #38 `d8a4fcc`, #42 `1b4e6a3`. | 6 | This moves them from PENDING_REVIEW to PENDING_CI. #26 also unblocks the tail of the assurance stack. |
| 4 | **A merge gate with real enforcement:** #11 `merge-via-gate.mjs` CLEAN, branch protection or rulesets applied with the Founder's decision, and a second identity or signed verdict (CP-GOV #31). | All future merges | This stops a repeat of #9 and #10, which were merged without a CLEAN verdict on their final head and with `uasco-needs-fix` attached. |
| 5 | **Route-cluster serialisation owner:** one rebase owner for #27→#28→#32→#33→#8. | 5 | This is the highest conflict degree (15 each). |
| 6 | **Maintainer trust-root reseal for #8 after the rebase.** | 1 | This is the only open PR whose own diff edits protected `config/*`. |
| 7 | **Founder confirmation of authority strings** (#16 `authorizedBy`, #15 Decision 3, FA-LEASE2 for #10 wiring). | 3 plus dispatch safety (#29) | #29's dispatcher accepts any non-empty `authorizedBy`. |

## 7. Not verified or UNKNOWN

- The root cause of the Windows `validate` failures on the new public-runner heads was not confirmed. Job-log blob download returned Forbidden through the proxy. Only "Process completed with exit code 1" on step `Run node scripts/run-validation.mjs` was visible, for job 117883101349 on #33 `b8d2f51`.
- Local "CLEAN, independent-reviewed" claims for merged #1-#7 are UNKNOWN, because no recorded artifact exists.
- Design and pixel parity for every UI PR is UNKNOWN_SOURCE. The 252-screen package and UX-DEC texts are on the Founder's PC.
- Whether #49's `FD-PUBLIC-CI-2026-10-19` authority and the visibility change were Founder-approved is UNKNOWN.
