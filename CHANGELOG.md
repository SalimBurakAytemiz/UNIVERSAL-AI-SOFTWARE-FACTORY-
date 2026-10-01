<!-- //TR: Bu dosya V3 mekanik closure ve re-audit düzeltmelerini geçmiş sürümlerden ayrıştırarak kaydeder. -->
# Changelog

## 2026-09-29 — V6 PKG-R4 Phase0 git-baseline native probes (branch)

- The second target-machine Phase0 attempt (release `ca21e83`) stopped at git-baseline: under `$ErrorActionPreference="Stop"` Windows PowerShell 5.1 turned the redirected stderr of `git remote get-url origin` on a fresh repository into a terminating NativeCommandError (PHASE0-F4); nothing was pushed.
- `scripts/init-private-git.ps1` now runs the origin and `gh repo view` probes with a scoped `Continue` restored in `finally` and decides only by the exit code; the probe output is discarded; every privacy refusal, Git isolation, the push check and the remote SHA verification are unchanged. Trust root resealed in the same commit.
- Regression on Windows PowerShell 5.1 with a real temporary repository and a local bare remote (negative control, fresh push with SHA verification, set-url rerun, refusal without the override); the original script fails it.
- Status documents record the reviews of 2026-09-30: PKG-AUT1B cycle 2 CLEAN and merged; PKG-T2 closed without merge and succeeded by PKG-T2B (Founder decision), whose cycle 1 was BLOCKED (F-T2B-001) and cycle 2 is pending; PKG-T1, PKG-T3, PKG-T4 and PKG-AUT2 re-applied on it.

## 2026-09-29 — V6 Autonomy Hardening: UASCO-Autonomous-Supervisor (branch)

- The repository-native supervisor runs as a durable daemon: Task Scheduler (`UASCO-Autonomous-Supervisor`: logon, periodic heartbeat, restart on failure, single instance, no time limit, user level, no stored password; startup only for an elevated S4U registration) -> narrow launcher -> `uasco-orchestrator.mjs --daemon`.
- Between ticks the daemon waits in `WAITING` until the nearest of ready work, provider retry, dependency backoff or the heartbeat; the wake file and Global Stop end the sleep; an atomic heartbeat records its state; `--self-check` verifies an activation.
- A committed builder round is adopted after a crash (no second builder call or commit); Git command contracts run with the repository Git isolation; Phase0 registers the installed system's autostart as `UASCO-Installed-Supervisor`.
- The supervisor maintains `.ai/runtime/WATCHDOG_STATUS.json` atomically (supervisor state, heartbeat, master, active package, queue counts, blocked lanes, Codex quota, signer, Phase0, last and next action, Founder decisions, overall health) from its own read-only discovery of git refs, worktrees, scheduled tasks, the transition log and provider retry state; the Claude app routine runs no command and only reads that file (Founder directive 2026-09-30).
- A wake request that arrives while a tick runs is no longer lost; Git contract isolation now comes from PKG-AUT1B cycle 2.
- Governed self-upgrade (Founder decision 2026-10-01): the supervisor switches the scheduled task's `control\current` link to a newer control plane only for a governed-CLEAN fast-forward merge that changes the control plane and whose sealed trust root verifies; the previous plane is kept.
- Tests A-L, N plus lifecycle with real processes (autonomy-hardening selftest 17/17); the Claude app routine is a passive display only.
- Review cycle-1 remediation (F-AUT2-001..004):
  - A committed builder round is recognised from git before the implementation clone is reset: single parent equal to the base, the orchestrator committer and the round subject. A crash before or during the round-marker write, or a torn marker, no longer causes a second builder call. The marker is written atomically.
  - The scheduled task runs a stable entry, `control\uasco-supervisor-entry.mjs`. It repairs an interrupted `control\current` switch, which is journaled in `SWITCH.json` with the old link kept as `current.prev`, and then loads the launcher through the link.
  - Global Stop is rechecked live right before activation, and an upgrade is `DEFERRED` while it is active.
  - A failed installed-autostart registration is retried on its own lane (bounded backoff, `AUTOSTART` action, no reinstall). It becomes `REGISTRATION_BLOCKED_RETRIES_EXHAUSTED` after 5 attempts, and the accepted installation is kept.
  - New regression scenarios: autonomy-hardening selftest F-AUT2-001/002/003, plus the executor-integration Phase0 registration scenario.

## 2026-09-29 — V6 PowerShell Safety and Verifier Differential Tests (branch)

- Every PowerShell script is parsed with the Windows PowerShell 5.1 parser (no errors, no Invoke-Expression) and checked against safety rules (no EncodedCommand, DownloadString/DownloadFile or persistent Set-ExecutionPolicy; entry scripts stop on error; web requests only where allowlisted and without redirects).
- Differential test of the two install-time artifact verifiers: both reject content tamper, a missing file, a manifest without the lockfile and an unsafe path; an unlisted file is rejected by the Node verifier (the PowerShell verifier does not check it; recorded as LOW finding F-T4-001).
- Positive control for the parse-error and Invoke-Expression detectors: synthetic scripts written to a temporary directory (a syntax error, Invoke-Expression, the iex alias) must be reported by the same parser detector that scans the real scripts, and a compliant script must report nothing; a blinded detector now fails the selftest (F-CLAUDE-T4-C1-001).
- Safety rules take compliance evidence only from parsed code (F-T4-C1-001, F-T4-C1-002): the PowerShell 5.1 parser now also returns each command with its parameters and argument values and each assignment. A web request in the allowlisted script needs a real `-MaximumRedirection` parameter whose value is the integer literal `0`, so `01`, `0x0`, `$x`, `'0'`, a comment, or text inside another parameter's string no longer count. `Set-ExecutionPolicy` needs a real `-Scope Process` parameter. An entry script needs an unconditional top-level `$ErrorActionPreference = "Stop"` (or `'Stop'`); an assignment in a comment, a string or a function body no longer counts. Request or policy names that appear only in comments or strings are reported. The prohibited-text rules (EncodedCommand, DownloadString/DownloadFile, pipe to Invoke-Expression) still scan the raw source, so they still catch code passed to child shells as strings. A new regression scenario runs the Codex reproductions, variants from the same family and positive controls for EncodedCommand, DownloadString/DownloadFile and pipe to Invoke-Expression (all must be reported), plus compliant controls (none may be reported); the selftest now reports PASS 7/7.

## 2026-09-29 — V6 OmniRoute Install Compatibility Test (branch)

- Read-only verification of the installed OmniRoute against config/omniroute-policy.json on the target machine (identity, license, repository, Node engines range, launcher location, local-only endpoint); OmniRoute is not started and a stopped endpoint is reported as NOT_RUNNING; machines without OmniRoute skip honestly.
- F-T3-003: a failure of the selftest's own `npm root -g` measurement (non-zero exit, unresolvable or unspawnable npm, timeout, signal, or output that is not exactly one absolute existing directory) now reports `FAIL NPM_ROOT_UNAVAILABLE` with a non-zero exit instead of `SKIP NOT_INSTALLED`; the honest skip is kept only for a working npm whose resolved global root has no OmniRoute package.

## 2026-09-29 — V6 Windows Crash/Resume Tests (branch)

- Real child processes on the target Windows machine prove process-lock takeover after a kill, a single winner among concurrent invocations, fail-closed unreadable/foreign-host locks, orchestrator resume after a worker is killed mid-action (lease expiry, in-flight recovery, no duplicate provider call) and auditable recovery from a corrupted state file.

## 2026-09-29 — V6 Orchestrator Executor Integration Tests (branch)

- The unattended orchestrator executors are exercised against real temporary git repositories: fast-forward merge with CLEAN evidence (non-FF, missing, mismatched and BLOCKED evidence refused), adoption of completed reviews, releases, signatures and installations without provider or script calls, signer waits, Phase0 guards and builder-round rejection of out-of-scope, unauthorized protected and trust-manifest edits.

## 2026-09-29 — V6 Unattended Orchestration (branch, activation after review)

- Repository-native unattended supervisor `scripts/uasco-orchestrator.mjs` under Windows Task Scheduler (`scripts/register-orchestrator-autostart.ps1`, user level, single instance).
- Durable `control` state with a hash-chained transition log, lease/heartbeat, in-flight recovery and idempotent executors (no duplicate reviews, merges, packaging or signing after a restart).
- Codex quota automation: verbatim evidence, parsed retry time, no cycle consumption, one controlled probe at the due time, Founder manual reset support, independent work continues.
- Narrow command contracts, review pipeline moved into reviewed code, dependency-aware lanes, Founder decisions scoped to the affected item.
- Release packaging, ssh-agent-only signing (`WAITING_FOR_SECURE_SIGNER` until the key is loaded) and Phase0 with preserved failed attempts; honest GitHub and cloud status.

## 2026-09-29 — V6 Dual Execution Fabric (branch, merge held)

- Execution backend registry (`config/execution-backends.json`) with `LOCAL_CLAUDE` and `CLAUDE_CLOUD_SESSION` and routing modes `AUTO` (default), `LOCAL_ONLY`, `CLOUD_PREFERRED`, `CLOUD_ONLY`.
- Fail-closed routing engine (`automation/lib/execution-routing.mjs`): host-bound work stays local, private-key release signing is Founder-only, unknown availability counts as unavailable, fallback only where policy allows, otherwise queued; no invented billing or credit API.
- The supervisor routes before the builder, records execution provenance and runs a merge gate (independent non-producer CLEAN review, isolated branch) before every fast-forward merge.
- Cloud dispatch stays `NOT_CONFIGURED` until a documented Claude product method is approved; cloud execution is never faked.

## 2026-09-28 — V6 Phase0 Attempt 1 Fixes

- The first target-machine Phase0 attempt stopped at bootstrap; nothing was pushed.
- `validate-runtime-contracts.mjs` isolates its fixture from the installer's `UASCO_INSTALL_ID` and still asserts that an env/ledger mismatch is rejected.
- `install-report.mjs` imports `node:crypto`, so `INSTALL_REPORT.json` is written.
- The builder policy uses `acceptEdits` for edits inside the working directory only; the tool set stays Read/Edit/Write/Glob/Grep and shell, web, subagents and MCP stay denied.
- New reseal and release candidate; the previous ZIP and signature are superseded.

## 2026-09-28 — V6 Sealed Release Candidate

- PKGR-F1: the doc-truth validators rejected every sealed release although `install.ps1` validates inside the extract; they now follow the trust-root seal status with a fail-closed `SEALED` release-candidate mode (in-process trust-root re-verification, `SHA256SUMS.txt` bound to the sealed manifest, no signature anywhere in the tree, no PASS values).
- Protected release tools: `release-sha256sums.mjs`, deterministic `build-release-zip.mjs` and `verify-release-extract.mjs` (Windows Expand-Archive, unchanged artifact verifiers, optional reviewed-lock install and canonical validation in the fresh extract).
- Final trust-root reseal in the release-candidate commit. Next: SHA256SUMS, ZIP, fresh-extract verification, Founder signature, target-machine Phase0.

## 2026-09-28 — V6 Target-Machine Phase0 Prerequisites

- Every canonical validation script is protected by exact path in `config/protected-paths.json`, and mechanical closure fails if one is not (TRUST-F1).
- Windows preflight measures installed physical RAM (`Win32_PhysicalMemory`) with the 16 GB threshold unchanged; with the Windows Time service running, target preflight PASS (PKGA-F8).
- Live provider smoke PASS through the Claude builder and Codex reviewer brokers.
- Open P0/P1/P2 findings: 0. Next: final reseal, SHA256SUMS, external signature, final ZIP, fresh-extract verification, then target-machine Phase0.

## 2026-09-28 — V6 Dependency-Aware Environment Gate

- Reviewed `package-lock.json` generated on Node 24.19.0 / npm 11.17.0; pins corrected (typescript 5.9.0 did not exist) and bumped to clear all moderate+ advisories; `npm audit` 0 findings.
- Windows `npm.cmd` EINVAL fixed with a shell-free node + bundled npm-cli.js invocation; missing `.d.mts` declarations and Ajv NodeNext interop fixed; canonical validation 34/34 PASS on the target machine.
- Release supply-chain accepts only host-excluded, lock-optional platform packages with integrity, registry and license evidence.
- `.gitattributes` pins LF so Windows `autocrlf` clones keep committed digests; Electron smokes launch shell-free.
- Provider provenance accepts verified `STANDALONE_LAUNCHER` installs; the canonical Codex reviewer broker now runs on this machine.
- Explicit checksum-verified Electron provisioning step: the binary is bound file by file to the archive pinned by the locked `checksums.json`; Desktop and Control Tower smokes PASS.
- The `//TR` source scan skips the gitignored `.ai/cache/` machine cache.
- Every package was reviewed independently by Codex through a frozen milestone contract and review bundle; records are in `audit/reviews/`.

## 2026-09-20 — V3 Mechanically Closed / Re-Audited

- V2 re-audit P0 bulguları source starter seviyesinde kapatıldı.
- Builder tool-policy sandbox + boundary canary, Action Broker, Git metadata guard, per-worktree dependency tree, package lifecycle guard eklendi/sertleştirildi.
- Codex prior-blocker omission, moving-goalpost causal proof, stable finding fingerprint, accepted-debt/waiver ledger ve governed signed attestation eklendi.
- V3 re-auditte bulunan yeni bypass kapatıldı: current BLOCKER yalnız `OPEN` olabilir; aynı cycle içinde `RESOLVED/DOWNGRADED/DUPLICATE` ile CLEAN üretilemez.
- 258/258 technical agent primary technology mapping taşıyor; 363-role semantic validator genişletildi.
- 22 physical domain pack seed profile eklendi.
- Technology universe 415, depth assignments 6114, schema 152.
- Evidence key Windows ACL hardening, provider-specific env policy, exact launcher provenance, filesystem boundary, secret/supply-chain baseline ve remote protection refresh eklendi.
- Source re-audit sonucu: yeni source-level P0 mekanik blocker bulunmadı; target-machine Phase0 hâlâ zorunlu.

## 2026-09-20 — Mechanically-Closed V2

- 149 phase contract'ın generic deliverable/validation/evidence/review/exit alanları phase-specific hale getirildi.
- One-click installer step ledger + INSTALL_REPORT eklendi.
- Control API/Control Tower install state ve package retry görünürlüğü eklendi.
- Dependency-free mechanical kernel self-test canonical validation zincirine eklendi.
- Phase0 acceptance mechanical self-test, review-package scheduler ve install ledger'i fail-closed kontrol ediyor.
- Mechanical closure validator install/report/selftest/review-package wiring'i çapraz doğruluyor.
- Latest mechanical red-team audit + fix ledger + Installation GO checklist canonical artifact'e eklendi.


## 2026-09-20 — Full Woven Canonical Starter

- 363 stable agent korunuyor.
- 363 canonical V2 agent genome yeniden üretildi.
- 363 agent evaluation contract oluşturuldu.
- 40 department technical charter oluşturuldu.
- 425 gerçek engineering/business skill içeren V2 skill ontology oluşturuldu.
- 393 seed technology profile içeren Technology Knowledge Graph oluşturuldu.
- Her teknoloji için ayrı knowledge-unit contract dosyası oluşturuldu.
- 194 tool/provider adapter kayıtlı.
- Multi-pack competency model eklendi.
- 12 eksenli agent↔technology depth modeli eklendi.
- Specialist→Lead→Principal→Head→Council→Independent review graph eklendi.
- Dynamic Unknown Technology Discovery lifecycle eklendi.
- 149 roadmap phase'ın tamamına entry/deliverable/test/evidence/review/exit contract eklendi.
- Schema baseline strict `additionalProperties:false` hale getirildi; toplam 141 schema.
- Role semantic validator eklendi.
- Woven model validator eklendi.
- Flutter/React Native/iOS generic Android inheritance hataları canonical V2 matrix'te kaldırıldı.
- Action Gateway, approval binding, DLP ve competency certification Day-0 runtime skeleton'ları eklendi.
- CI ilk private commit öncesi lockfile üretimi modeline göre sertleştirildi.

## Truth

Bu sürüm full runtime implementation iddiası taşımaz.
`REGISTERED != KNOWN != SKILLED != CERTIFIED != CURRENT != AUTHORIZED != VERIFIED`.
