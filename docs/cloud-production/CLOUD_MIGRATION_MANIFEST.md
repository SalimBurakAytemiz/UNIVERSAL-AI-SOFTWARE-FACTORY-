<!-- //TR: Bulut-yalnız yürütme geçiş manifestosu: yerel Windows bilgisayarına, yerel oturuma, zamanlayıcıya veya dosyaya bağlı her yürütme bağımlılığının kaynağı, bulut hedefi, güvenlik sınıfı ve durumu; gizli değer, token veya hassas güvenlik ayrıntısı içermez. -->

# Cloud-only execution migration manifest (2026-10-19)

- **Authority:** Founder directive "MAXIMUM CLOUD PRODUCTION, CONTINUOUS AUTONOMY & THROUGHPUT RECOVERY", §2.
- **Base:** `v7/integration` @ `1128c15`.
- **Scope:** only the execution chain: development, review, CI, merge coordination, backlog and next-task selection.
- **What does NOT change:** the Windows autonomy bootstrap is a product feature, not a cloud dependency. It stays in scope and keeps being tested on GitHub's `windows-latest` runner (the BS1 steps).

**Status vocabulary:**
- `CLOUD_OK`: already runs without the Founder PC.
- `MIGRATED`: moved to cloud by this change.
- `OWNER_ACTION`: needs one Founder action.
- `CLOUD_UNVERIFIABLE`: cannot be proven in cloud; this is said honestly.

**Security classes:**
- `PUBLIC_OK`: may live in this public repo.
- `PRIVATE`: must not be committed (secrets, personal data or sensitive security detail).

| # | Local dependency | Source today | Cloud target | Class | Status |
|---|---|---|---|---|---|
| L1 | Local supervisor and recovery loop | `scripts/uasco-supervisor-{launcher,entry,watchdog}.mjs` and `automation/lib/orchestrator-*.mjs`, run by a Windows Scheduled Task (`scripts/bootstrap-uasco-autonomy.ps1`) with state under `%LOCALAPPDATA%\UASCO` | The hourly heartbeat routine (dispatch, recovery of abandoned claims, report) and the hourly Cloud Development routine. Neither reads local state. | PUBLIC_OK | MIGRATED (heartbeat dispatch and recovery, 2026-10-19). The local loop stays a product feature. |
| L2 | Local builder and reviewer sessions | Backlog tasks with `owner: LOCAL` | Cloud builder sessions (tag `lane-a-builder`) and a separate cloud reviewer session. The `UASCO Independent Cloud Reviewer` routine adds supplementary reviews. | PUBLIC_OK | CLOUD_OK |
| L3 | PR merge executor | `scripts/merge-via-gate.mjs` (PR #11, unmerged). Today merges are run by the coordinator session. | A coordinator session doing SHA-bound merges: CI green on both OSes plus an independent reviewer verdict on the same SHA. A coded executor is still missing. | PUBLIC_OK | CLOUD_OK (manual); a coded executor is pending |
| L4 | Task lease and checkpoint | `automation/lib/task-lease*.mjs` (FA-LEASE2, unwired) and local state | `docs/planning/dispatch.mjs --claim`: an atomic create-only `refs/heads/claude/<id>` claim. Claims persist because merged branches are kept. | PUBLIC_OK | MIGRATED, pending Founder decision D-2026-10-19-A (see `docs/planning/authority/FD-2026-10-19-MAX-CLOUD-PRODUCTION.md`). First claims, `claude/ui-030` fb54c4c and `claude/ui-113` 97431ab, were made before this backlog merged, under directive item 11.4 (a process finding recorded by the reviewer). FA-LEASE2 stays unwired (Founder D3). |
| L5 | Queue divergence | `docs/autonomy/backlog-drafts/{PRODUCTION_QUEUE,BACKLOG_CHECKPOINT}.json` (PR #11 drafts) and `docs/cloud-production/QUEUE.json` (PR #15 branch) | **Canonical:** `docs/planning/BACKLOG_CHECKPOINT.json` on `v7/integration`. QUEUE.json only lists `docs/cloud-production` tasks. The drafts are not authoritative. | PUBLIC_OK | MIGRATED (canonical source stated in the backlog `_doc`) |
| L6 | GitHub sync poller (`UASCO-LOOP-RECORD`, "uasco-github-sync") | Off-repo, Founder-side. It posts "result CLEAN" while CI is pending or failed. | None; never used as merge evidence | PUBLIC_OK | OWNER_ACTION: disable it, or fix it to never say CLEAN without both CI results and a reviewer verdict |
| L7 | Local CI / Windows validation | `node scripts/run-validation.mjs` on the Founder PC | GitHub Actions `validate (ubuntu-latest)` and `validate (windows-latest)` on every push and PR | PUBLIC_OK | CLOUD_OK |
| L8 | Real desktop interaction (Electron UI on Windows) | Founder PC only | A Windows runner E2E harness (PR #50, label `uasco-needs-fix`) | PUBLIC_OK | CLOUD_UNVERIFIABLE today: no screen is PRODUCT_VERIFIED |
| L9 | Master prompt, project memory, skills | `prompts/` (protected, in repo), `CLAUDE.md` (in repo). Founder-side Claude project memory is not in the repo. | The repo copies only. Nothing outside the repo is assumed to exist. | PUBLIC_OK (repo) / PRIVATE (personal memory) | CLOUD_OK for the repo copies. Off-repo memory: UNKNOWN; do not assume it. |
| L10 | UI/UX reference designs (252-screen package) | Founder PC (UNKNOWN_SOURCE) | `docs/ux/reference/`, if the Founder agrees to publish it, or another Founder-chosen private location | PUBLIC_OK only if the Founder decides | OWNER_ACTION: provide the package. Until then no design parity is claimed. |
| L11 | Installer, `.exe` and release artifacts | `scripts/build-installer.mjs` and `build-release-zip.mjs`; no GitHub Release exists | A Windows runner build job (not yet in CI) | PUBLIC_OK | CLOUD_UNVERIFIABLE today: no `.exe` evidence |
| L12 | Node 24 in cloud sessions | Cloud sessions have Node 22 | `.nvmrc` and `scripts/cloud-ensure-node24.sh` (PR #21) | PUBLIC_OK | OWNER_ACTION: set the environment setup script after #21 merges |
| L13 | Branch protection and required checks | None: `v7/integration` and `master` are unprotected | A ruleset on both branches requiring both `validate` contexts, with no force-push and no deletion | PUBLIC_OK | OWNER_ACTION (P0-G1). Full autonomy is NOT READY until this is verified. |

## Acceptance check: "the PC is off"

- **Development:** CLOUD_OK. Builder sessions and the hourly routines need no local file, scheduler or session.
- **Review:** CLOUD_OK. There is a separate reviewer session and routine.
- **CI:** CLOUD_OK (GitHub Actions).
- **Merge coordination:** CLOUD_OK, but manual, through the coordinator session. A coded merge executor is still missing.
- **Backlog and next-task selection:** MIGRATED to the dispatcher plus the heartbeat. A task becomes eligible only when an authorized READY entry is merged to `v7/integration`.
- **Recovery:** an abandoned claim older than 6 h with no PR is resumed by the heartbeat (step 2b). There is no auto-delete.
- **Not cloud-verifiable:** a real Windows desktop interaction, a signed or built `.exe`, and design parity.
