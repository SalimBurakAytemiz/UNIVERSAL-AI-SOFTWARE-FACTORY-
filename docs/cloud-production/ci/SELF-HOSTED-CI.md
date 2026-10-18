<!-- //TR: Ucretsiz self-hosted CI entegrasyonu: guvenlik modeli (guvenilmeyen PR kodunu kisisel runner'da OTOMATIK kosturmama), runner sertlestirme, 600sn Windows timeout analizi, Linux ucretsiz secenekleri, zorunlu test kapsami + branch protection + SHA-bound bagimsiz review korunumu, ve kademeli rollout. GitHub-hosted kota 2000/2000 dolu; ek ucret YASAK. Korunan .github/workflows/ci.yml'i degistirmez; ci-selfhosted'i AYRI dosya olarak ekler. -->

# Free self-hosted CI integration (quota 2000/2000 exhausted; no extra billing)

GitHub-hosted Actions minutes are exhausted, so every `ci.yml` run dies in ~3–6s at startup. A Windows self-hosted runner is now registered (runner smoke test SUCCEEDED). This integrates **free** self-hosted CI **safely** — without running untrusted PR code on the personal machine, without extra billing, and without weakening any gate.

## Security model — the #1 risk and how it's closed
A self-hosted runner executes workflow code **on the host machine**. If an untrusted PR ever triggers a self-hosted job, its code runs on the personal Windows box (full-compromise risk). This integration closes that:

1. **`validate-selfhosted.yml` triggers on `workflow_dispatch` ONLY.** No `pull_request`, no `push`. Adding the file is **inert** — opening this PR runs nothing on the runner. It executes only when a human clicks "Run workflow."
2. **`environment: self-hosted-ci` with a required reviewer.** Every run pauses for one-click Founder approval before any code executes on the runner. Create it first (below).
3. **Least privilege:** `permissions: contents: read`, no secrets exposed to the job, `persist-credentials: false`, `clean: true`, `submodules: false`.
4. **Runner-side isolation (Founder machine — do before enabling PR triggers):**
   - Run the runner as a **dedicated low-privilege local account**, not your user/admin.
   - Prefer an **ephemeral** runner (`./config.cmd --ephemeral`) so each job gets a fresh registration (no cross-job persistence).
   - Prefer a **throwaway VM or Windows container** for the runner so a hostile job cannot touch your real machine; snapshot/revert between jobs.
   - Restrict outbound network to what validation needs; block the runner from your LAN/secrets.
   - GitHub repo **Settings → Actions → General**: set "Require approval for all outside collaborators" (defense in depth; the environment gate is the real control for same-repo branches).

**Do NOT** use `pull_request_target` (runs with base secrets — worse). PR coverage is added later only behind the environment gate (Phase 3).

## Required test coverage — preserved
The workflow runs the exact canonical set from `ci.yml`: `ensure-dependencies` → `run-validation.mjs` → `secret-sanity.mjs` → `bootstrap-kernel-selftest.mjs`, on Node 24. `run-validation.mjs` already **platform-filters** (Windows-only steps report `NOT_RUN_PLATFORM`, never PASS), so **full coverage needs both a Windows and a Linux self-hosted runner** — same as the old `ubuntu+windows` matrix.

## Windows 600s timeout (directive #4)
The per-step cap is **hardcoded** at `timeoutMs: 600000` in `scripts/run-validation.mjs:6` (protected; not env-tunable). On github-hosted `windows-latest` (slow) the `tests` step overran it → `VALIDATION_STEP_TIMEOUT`. A real self-hosted Windows machine is typically much faster, so the **expected fix is simply running on the faster runner** — the workflow's final step prints every step's `durationMs` and flags any within 60s of the cap. **Honest:** this is confirmed only when a real self-hosted run shows the `tests` step under 600s. If it still overruns, the fix is to **shard that step in `config/validation.json`** (protected → maintainer edit + trust-root reseal) or raise the constant in `run-validation.mjs` (protected). Neither is a builder step.

## Linux free options (directive #5)
The Founder has a Windows runner; the Linux leg needs a free Linux runner. In order of preference, all **free**:
1. **WSL2 Linux self-hosted runner on the same Windows machine** — install a second runner inside WSL2 Ubuntu, label it `[self-hosted, linux]`. Zero extra cost/hardware.
2. **Linux container on the Windows runner** (Docker Desktop + WSL2 backend) — run the Linux leg in a container job.
3. **A spare/old Linux box or a free-tier VM** you already own (no new paid subscription).
4. **Interim:** until a Linux runner exists, Linux validation continues as the cloud **CP-CI** evidence (`docs/cloud-production/ci-equivalent.*`), which is explicitly **not** a governance verdict — so a merge still needs a real Linux check before CLEAN.

## Branch protection + SHA-bound review — preserved (directive #7)
- The merge gate (`scripts/merge-via-gate.mjs`), the governed SHA/session/identity-bound independent review, and branch protection are **unchanged**. This only changes **where** the validate jobs run.
- Required status-check contexts are named `validate (windows-latest)` / `validate (ubuntu-latest)` (the dead github-hosted matrix). The self-hosted jobs are named `validate (windows)` / `validate (linux)`. To make merges satisfy branch protection, an **admin** updates the required-check contexts to the self-hosted job names once they're proven green. The coded merge gate + independent CLEAN verdict remain mandatory.

## Rollout phases (prepare safe runner → then run real CI; directive "run after safe")
- **Phase 0 (this PR):** add `validate-selfhosted.yml` (dispatch-only, inert) + this runbook on branch `claude/ci-selfhosted-integration`. Nothing runs on the runner.
- **Phase 1 (Founder, machine-side):** harden the runner (dedicated account + ephemeral + VM/container + network limits), confirm Node ≥24 on it, add labels `self-hosted,windows` (and a `self-hosted,linux` runner per the Linux options). Create the `self-hosted-ci` **Environment** with yourself as a **required reviewer**.
- **Phase 2 (merge this PR):** land the workflow (infra; non-protected new file). `workflow_dispatch` becomes available on the default branch.
- **Phase 3 (run real CI):** dispatch `CI (self-hosted)` → approve the environment gate → it runs validation on the runner(s). Read the per-step durations (600s check). Iterate until **green on both legs**. Only then is a CLEAN verdict + merge honest — **do not declare CLEAN/MERGED before this**.
- **Phase 4 (admin):** point branch-protection required checks at the self-hosted contexts; optionally disable the dead github-hosted `ci.yml` (a protected-file change → maintainer + reseal) to stop it producing failing required checks.

## No extra billing (directive #8)
Self-hosted runners are **free** (your hardware). This adds **no** GitHub billing, no subscription, no paid action. The exhausted github-hosted minutes are not used by self-hosted jobs.
