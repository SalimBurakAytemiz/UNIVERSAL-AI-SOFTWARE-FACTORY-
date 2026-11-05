# Open PR consolidation (2026-11-05 ~22:15Z, main 8378d083)

Source: Founder directive "PR BACKLOG CONSOLIDATION". Method: for each open PR, `git merge-tree` against main (does it conflict, and what does it add?), the `patch-id --stable` of its diff, its changed-file list, and pairwise `merge-tree` (main+A ⊕ B) for every PR pair sharing a file. Script: coordinator scratchpad `prscan.py`; raw data `prscan.json`.

## Result: duplicates / superseded
- **No PR adds zero changes to main** (every PR leaves a residual diff), and **no two PRs share a patch-id**. So no PR can be closed with a proof of "fully contained / duplicate". **No PR was closed** (closing without proof would risk losing code).
- **#282 ↔ #339 (PAR-03 diagnostics):** they overlap, but NOT as duplicates. #339 (T0042, routine) only touches the test side (`tests/support/par.ts` gap/blocker attribution). #282 (LANE-C, 2026-11-02, 334 commits behind, conflicts with main in store.ts / par-engine / relfx-c3) adds store-level `StoreWriteTiming`/`LockTimeoutInfo` and `tests/support/lock-diag.ts`, and those are not in main. The PAR-03 fence cause is now known (D WIN-1: slow fsync, not a fencing bug), so #282's PAR-03 purpose is satisfied; its LOCK_TIMEOUT (relfx-1 PAR04) diagnostics are unique. Recommendation: Founder/LANE decision: either port only the LOCK_TIMEOUT part onto main (fresh PR, with permit), or close #282 accepting that this part is lost. Not closed automatically.
- **#351 ↔ handover ledger:** #351 changes only `docs/planning/autonomy/STATE.json`; its tracking notes are stale (#345 merged, #343 needs a base merge). Its V2-authority note (handoff.status is not an authority source) is also in this ledger in content, but the ledger is NOT on main. Not a duplicate; Founder-tier (supervisor state).
- **#341 ↔ OAuth 401 diagnosis:** #341 (draft, Founder-tier) is a manual (`workflow_dispatch`) workflow that distinguishes the repo vs environment secret. It is not a code duplicate. If the Founder disables the review workflow (FOUNDER-QUEUE #1), #341 becomes unnecessary; if the token is rotated, it stays useful as a diagnostic. Its fate depends on that decision.

## Real conflicts
- With main: only #282 (above) and **#390**.
- **#390 fixed:** an EOF append conflict in `tests/v7-ux-delivery.test.ts` with #392's RW-053 block. Kept both (main's block, then #390's import+register). Held branch `claude/builder-e-export-fix-test-resolved` @ cf491ac0 (on main 8378d083; prepr ok, v7-ux-delivery 26/26, AUD-022 and RW-053 cases both run). The PR branch was not pushed (no CI): #390 is FOUNDER_REQUIRED because of the TASK_LINE_RE suffix bug; when that is fixed, fast-forward it onto the PR branch.
- **#396** stays Supervisor-only (V4.1 matrix T0124 "EXT: register branch (supervisor)"): no automatic merge.

## Pairwise conflicts (main+A ⊕ B; 131 pairs, 19 conflicting)
The locale files (`locales/en.js`, `tr.js`; 16 PRs) **do not conflict.** The conflicts are almost all EOF/register-line appends to the same test file:
| cluster | PRs | file | resolution |
|---|---|---|---|
| desktop-shell | 366, 373, 379, 383 | tests/v7-b4-desktop-shell.test.ts | Builder H `-ready` branches (all 24 orders conflict-free) |
| project-studio | 370, 371, 372, 375 | tests/v7-ps1b-project-studio-ui.test.ts | keep-both at each merge; 371 is stacked on 370 |
| operations | 371, 397, 403 | tests/v7-ux-operations.test.ts | keep-both |
| qasec | 393, 395 | tests/v7-ux-wp-qasec.test.ts | keep-both after #395 (Builder I is waiting) |
| shell.js | 364, 372 | apps/desktop/renderer/shell.js | 372 goes via E's `command-field-on-364` (948f354e) after 364 |
| styles.css | 363, 385 | apps/desktop/renderer/styles.css | decide on the second merge |
| workos tests | 367, 380 | tests/v7-b1-workos.test.ts | 380 (routine) first |
| mobile README | 367, 400 | apps/mobile/README.md | both Founder-tier |

## Routine merge order (window ≤ 2; each slot = base merge + CI + re-bind)
1. window: #404, #405 (T0006)
2. #402, #401 (T0006; no conflict)
3. #394, #395 (G) → #393 (keep-both with #395)
4. #387 (H tour, 1 file) · #339 + D WIN-1 (`claude/builder-d-win1-ttl-calibration`) · #369 (D)
5. #380 (C; +`v3-t1032-nb-held`) · #384 (G) · #364 (E; T0005)
6. #366 → #373 (heads from the H `-ready` branches) · #327 (A)

Founder-tier (order once approved): I chain #370 → #371 → #377 → #382 → #397 (→ #403); #375 after the ps1b cluster; #372 after #364; #379/#383 via `-ready`; #363 ↔ #385 styles.css.

## V2 integration line
#347, #354, #355, #356, #388, #389 are outside this analysis and the merge loop; touching them requires the V2 line + signed handover. V4.1 remains the only live authority.
