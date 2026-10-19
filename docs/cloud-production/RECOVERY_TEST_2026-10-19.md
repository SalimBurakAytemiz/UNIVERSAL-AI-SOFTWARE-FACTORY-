<!-- //TR: Gerçek GitHub origin üzerinde dispatcher sahiplik/kurtarma testi (2026-10-19 ~22:00Z): sahiplenme, çift yürütme reddi, yarış, terk, devralma ve bayat üzerine yazma reddi; geçici test ref'leri silme isteği proxy tarafından reddedildi (403) ve etkisiz kaldı. -->
# Live recovery test of the dispatcher claim on the GitHub origin (2026-10-19, around 22:00Z)

- **Tool:** `docs/planning/dispatch.mjs` @ `v7/integration` d38f87c, with `--no-lease`.
- **Origin:** github.com, the live repository. The earlier proof only covered local bare repos.
- **Setup:**
  - Three separate worktrees simulate three sessions: `session-one`, `session-two` and `session-three`.
  - A temporary test backlog holds three READY test tasks, `RTEST-20261019-A`, `-B` and `-C`. They have no files and change no product.
  - Deleting the test refs `claude/rtest-20261019-{a,b,c}` after the test was **denied** by this session's git egress policy (HTTP 403), so they remain. They are inert: no PR, no CI (CI runs only on PRs and on `master`/`v7/integration` pushes), and not in the canonical backlog. Owner action: delete them in the GitHub UI if wanted.

| # | Scenario | Observed result | Verdict |
|---|---|---|---|
| T1 | session-one claims | START `RTEST-A`, `claimed:true`, claim 969bf94 | PASS |
| T2 | session-two runs while one holds A | `RTEST-A:ALREADY_CLAIMED`. Session-two takes the next eligible task (START `RTEST-B`, claim e5b0472). No double execution. | PASS |
| T3 | two sessions claim unclaimed `RTEST-C` at the same instant | exactly one START (claim 904039f); the other gets `RTEST-C:CLAIM_RACE_LOST` | PASS (atomic create-only ref on the server) |
| T4 | session-one abandons; dry run with `--stale-hours 0` | A and B reported `RECLAIMABLE`; nothing deleted, nothing auto-taken | PASS (detection) |
| T5 | authorized takeover: session-three resumes the abandoned A | fast-forward work commit da519ca on top of claim 969bf94; plain push, no force | PASS |
| T6 | dry run after takeover | A reported `HAS_WORK_COMMITS`, so it is not offered for reclaim again; B and C still `RECLAIMABLE` | PASS |
| T7 | the stale session-one tries to push its old claim over the resumed branch | `! [rejected] … (non-fast-forward)` | PASS |

**Limits, stated honestly:**
- The resume decision itself is not atomic. Two resumers acting at the same moment are told apart only by git's non-fast-forward rejection, which makes the slower one fail; nothing reserves the resume in advance.
- The heartbeat lowers that risk by resuming only when no active `lane-a-builder` session carries the task's tag.
- RECLAIMABLE depends on the claimer's commit clock.
- FA-LEASE2 is not exercised. This test covers only the D-2026-10-19-A claim mechanism.
