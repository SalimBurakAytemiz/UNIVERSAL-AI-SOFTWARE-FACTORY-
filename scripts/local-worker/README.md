<!-- //TR: UASCO Local Windows Test Worker kısa çalışma kılavuzu: Founder PC'sinde salt-okunur ölçüm, Windows Sandbox izolasyon doğrulaması, pilot koşu, kurtarma ve güven sınırları. Faz SHADOW: zorunlu GitHub kontrolleri değişmez. -->
# UASCO Local Windows Test Worker (package 1, phase SHADOW)

One worker that runs the heavy Windows test steps of one commit at a time on the Founder PC, inside Windows Sandbox. It never replaces a GitHub check: in phase SHADOW the required checks `validate (ubuntu-latest)` and `validate (windows-latest)` still run on GitHub-hosted runners for every commit, and any local infrastructure problem hands the commit to `GITHUB_HOSTED_WINDOWS`.

| File | Role |
|---|---|
| `test-plan.json` | Every step of `config/validation.json`, in order. `LOCAL_PRIMARY` = the 15 test steps measured at 60 s or more on GitHub-hosted Windows; the other 33 stay `CLOUD_SMOKE`. Limits: 6144 MB sandbox, 2048 MB host reserve, host CPU at most 40 %, 20 GB free disk, 90 min per job, 600 s per step, 1 job at a time. |
| `probe.mjs` | Read-only host measurement (Windows edition and build, CPU, virtualization, hypervisor, RAM, disk, SSD, Windows Sandbox readiness). Writes nothing, needs no admin. |
| `core.mjs` | Plan coverage check, job validation, host acceptance (busy / RAM / CPU / disk / isolation), create-only lock, append-only ledger (a job is never run twice), crash recovery, protected-file drift check, sealed evidence, status payload. |
| `sandbox.mjs` | `.wsb` builder (network, vGPU, clipboard, printer, audio/video input off; ProtectedClient on; only worker folders mapped, source read-only, only the output folder writable; profile and secret folders refused), sandbox entry scripts, bounded wait and kill. |
| `run-steps.mjs` | Runs the planned steps inside the sandbox with the commit's protected `automation/lib/command-runner.mjs` and the same fixed 600 s step limit as `scripts/run-validation.mjs`. |
| `worker.mjs` | CLI: `probe`, `status`, `selftest`, `make-job`, `prepare-deps`, `run`, `recover`, `publish`. |

## Founder PC runbook (PowerShell, from a checkout of `v7/integration`)

1. `node scripts/local-worker/probe.mjs`: read-only. Look at `sandbox.available` and `sandbox.reasons`. If it says `SANDBOX_FEATURE_NOT_ENABLED`, turn on the optional feature "Windows Sandbox" and restart (Founder action; it needs Windows Pro/Enterprise/Education and virtualization on in the BIOS).
2. `node scripts/local-worker/worker.mjs selftest`: starts one throw-away sandbox and checks, from inside it, that the network is blocked, the host profile is invisible, the source folder is read-only, the output folder is writable and no token or `.ssh` folder is present. Only `ISOLATION_VERIFIED` enables execution, for 30 days, on this machine only.
3. `node scripts/local-worker/worker.mjs make-job --pr <N> --job job.json`: fetches the PR head and the current `v7/integration` into the worker's own bare mirror (no code runs).
4. `node scripts/local-worker/worker.mjs prepare-deps --base-sha <baseSha from job.json>`: installs dependencies once per lockfile with the canonical installer on the trusted base commit (never on PR code).
5. `node scripts/local-worker/worker.mjs run --job job.json`: dry run (checks everything, runs nothing). Then add `--execute` for the pilot. Compare `durationMs` per step in the evidence file with the same commit's GitHub-hosted shard durations.
6. `status` at any time; `recover` after a crash or a power loss (the crashed job becomes `ABANDONED` and is not re-run locally).

State lives in `%LOCALAPPDATA%\UASCO\local-worker` (`state` and `work`); nothing is written elsewhere.

## Trust boundaries

- PR code runs only inside Windows Sandbox with networking disabled. The host only runs git (mirror, archive) and, for `prepare-deps`, the canonical installer on the trusted base commit.
- A job is refused (fallback to GitHub-hosted Windows) when any trust-root file, the trust-root manifest, `package.json` or `package-lock.json` differs from the base, when the base is not on `v7/integration`, when the host is busy, short of RAM or disk, or when isolation is not verified on this machine.
- The result is derived from the step report, and the evidence is sealed with a SHA-256 digest over every field and bound to the full commit SHA, the plan version and the host fingerprint. A local PASS is still only as trustworthy as a GitHub-hosted run of the same PR code: it is advisory (SHADOW).
- Publishing is not enabled: `publish --dry-run` prints the commit-status request on its own context `uasco/local-windows (shadow)`, never a required context. Turning it on needs a Founder decision on a least-privilege credential (a GitHub App with commit-status write only, or a fine-grained token limited to this repository's commit statuses), kept by a separate publisher process, never inside the sandbox. Making it a required check needs a ruleset change bound to that App, which only the Founder can make.
