<!-- //TR: Ucretsiz self-hosted CI entegrasyonu (VM yok, ek ucret yok): runner UASCO-CI standart Windows hesabi altinda calisir; kurulum betigi resmi paketi SHA-256 + Authenticode ile dogrular; token/parola gizli istemle alinir ve hicbir yere yazilmaz. Guvenilmeyen PR kodu otomatik CALISMAZ (pull_request tetikleyicisi yok). Bu belge PR #30'daki iki yanlis varsayimi duzeltir (varsayilan branch master; Free planda environment onay kapisi yok) ve kalan riskleri durustce listeler. -->

# Free self-hosted CI — UASCO-CI runner (no VM, no extra billing)

GitHub-hosted Actions minutes are exhausted (2000/2000 → GitHub **Free** plan), so `ci.yml` dies in ~3–6 s at startup. This integrates **free** self-hosted CI on the Founder's Windows machine with the runner running as the **standard local account `UASCO-CI`** — no VM, no paid service, no weakened gate.

## Corrections to the first version of PR #30 (found on re-review)
1. **Default branch is `master`.** `workflow_dispatch` only triggers workflows that exist on the default branch, so a dispatch-only workflow merged into `v7/integration` could never be started. Both workflows now also trigger on a **push to a dedicated branch** (`ci/selfhosted-smoke`, `ci/selfhosted-run`), which uses that branch's workflow file — no change to `master` needed.
2. **Free plan has no environment protection rules for private repos.** The earlier claim "every run is gated by an `environment` required reviewer" was **wrong for this plan** and the `environment:` reference was removed. The human gate is the deliberate trigger itself (dispatch or a push to the dedicated branch); both require repo write access.
3. **Job-level `if` cannot read `matrix`** (only `github/needs/vars/inputs`), so the old matrix workflow would not have loaded. It is now two explicit jobs, `validate (windows)` and `validate (linux)`.
4. **`shell: bash` steps** would fail if Git Bash is not on the service account's PATH; they moved to cross-platform Node helpers in `scripts/ci-runner/`.

## Security model
- **Isolation by standard account (Founder's choice, no VM):** the runner service runs as `UASCO-CI` — not Administrator, not SYSTEM, not the Founder's account. Default Windows profile ACLs keep other users' profiles unreadable to it; the smoke test proves this from the runner's real identity.
- **No automatic PR execution:** no workflow added here triggers on `pull_request`. Jobs are pinned to the label `uasco-ci`, so the old runner never receives them.
- **Least privilege in workflows:** smoke = `permissions: {}`, no checkout, no secrets; validate = `contents: read`, `persist-credentials: false`, no secrets.
- **Secrets never persisted:** `setup-uasco-ci-runner.ps1` reads the registration/removal token and the `UASCO-CI` password via `Read-Host -AsSecureString`, redacts them from captured output, never reads `.credentials*`, never starts a transcript.
- **Official package only:** latest `actions/runner` release, `actions-runner-win-x64-<ver>.zip`; SHA-256 must match the release-notes hash and/or the API asset digest (both must agree if both exist; none → refuse); `Runner.Listener.exe` Authenticode must be Valid (GitHub/Microsoft).

### Residual risks (honest)
- **Any branch with write access can add its own workflow** with `runs-on: [self-hosted, ...]` and `on: push`, and it would run as `UASCO-CI` on this machine. A personal-account repo cannot restrict which workflows use a repo-level runner (runner groups with workflow allow-lists need an organization). The blast radius is bounded by the standard account (no admin, no other profiles, no stored secrets). Optional hardening: set the runner service to **Manual** start and start it only for CI windows.
- **Process command lines:** the token/password are passed to `Runner.Listener.exe configure` on its command line for a moment; with command-line process auditing enabled, an admin-readable event log could capture them. The registration token is single-use and expires in 1 hour; change the `UASCO-CI` password afterwards if that auditing is on.
- **github-hosted `ci.yml` (protected)** runs on every push/PR. When the monthly quota resets, the ~20 open cloud PRs will burn it quickly again. Fix (maintainer, protected edit + reseal): retarget `ci.yml` to self-hosted labels or add `branches-ignore`.

## Procedure (run in a Claude session ON the Windows machine; no VM)
Human-only points are marked **[YOU]**; everything else the local session runs itself.
1. `powershell -ExecutionPolicy Bypass -File scripts\ci-runner\setup-uasco-ci-runner.ps1` — **audit, read-only**: lists existing `actions.runner.*` services and the account each runs as, confirms `UASCO-CI` exists and is **not** in Administrators (by SID, locale-independent), checks git/node, checks the invoking user's profile ACL.
2. **[YOU]** Repo **Settings → Actions → Runners → New self-hosted runner** → copy the registration token (keep it out of chat).
3. **[YOU, UAC]** elevated: `...\setup-uasco-ci-runner.ps1 -Install` → paste the token and the `UASCO-CI` password into the hidden prompts. The script downloads + verifies the package, installs it in `C:\uasco-ci\actions-runner` (ACL: Administrators/SYSTEM full, `UASCO-CI` modify, nobody else), registers `uasco-ci-win` with labels `self-hosted,Windows,X64,uasco-ci` as a service running as `.\UASCO-CI`, and verifies the service account.
4. **Smoke:** `git push origin claude/ci-selfhosted-integration:ci/selfhosted-smoke` → "Runner smoke (self-hosted, safe)" must print `RUNNER_SMOKE: PASS (account UASCO-CI, not admin, not SYSTEM, other user profiles not readable)`.
5. **Full validation:** `git push origin <branch-to-validate>:ci/selfhosted-run` → `validate (windows)` runs the canonical set on Node 24 and prints per-step durations against the 600 s cap. **No CLEAN/MERGED before this is green.**
6. **[YOU, approval + UAC]** only after step 4 PASS: **Settings → Actions → Runners → old runner → Remove** → copy the removal token → `...\setup-uasco-ci-runner.ps1 -RemoveOld -OldRunnerDir <old runner folder>`. The script refuses unless the new `UASCO-CI` runner is installed and running. The old folder is not deleted automatically.

## Coverage, 600 s, Linux
- Coverage is unchanged: `ensure-dependencies` → `run-validation.mjs` → `secret-sanity.mjs` → `bootstrap-kernel-selftest.mjs`. `run-validation.mjs` platform-filters (Windows-only steps `NOT_RUN_PLATFORM` on Linux, never PASS), so full coverage still needs a Linux leg.
- **600 s** is hardcoded (`timeoutMs: 600000`, protected `scripts/run-validation.mjs:6`). A real machine is usually much faster than github-hosted `windows-latest`; `ci-report-durations.mjs` shows each step against the cap. If `tests` still overruns, sharding it in `config/validation.json` is a **maintainer edit + trust-root reseal** (not a builder step).
- **Linux (free):** a second runner inside **WSL2 Ubuntu** on the same machine (label `self-hosted,linux,uasco-ci`, its own unprivileged Linux user), or a spare Linux box. Until then, Linux evidence is the cloud CP-CI result, which is **not** a governance verdict.

## Branch protection and review — unchanged
The coded merge gate, the SHA-bound independent review and branch protection are untouched. Making self-hosted results count for merges requires an **admin** to switch the required-check contexts to `validate (windows)` / `validate (linux)` once they are green, plus the open items already recorded (second approver identity, protection apply).
