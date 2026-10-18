<!-- //TR: UASCO CLOUD-FIRST uretim motorunun calisma sozlesmesi: kalici kuyruk, paralel implementer dispatch (create_session), atomic-lease tekil sahiplik, bagimsiz Cloud reviewer, kalici zamanlanmis yurutuculer (recovery + 60dk rapor), ve mevcut yetki disindaki keystone kararlarin eskalasyonu. Guvenlik/governance kapilari ZAYIFLATILMAZ; ayni ajan kendi kodunu onaylamaz; Cloud'a reseal/merge yetkisi verilmez. -->

# UASCO Cloud-First Production Engine

**Directive:** MAXIMUM CLOUD PARALLEL PRODUCTION OVERRIDE (Founder, 2026-10-18).
**Base:** `v7/integration @ e12dbdd`. **Primary production environment: CLOUD.** Local PC/Claude/Supervisor are no longer a mandatory dependency in the routine development/delivery flow; their mandatory steps are being replaced by non-protected Cloud equivalents, **without removing the old security controls until an explicit, separate-identity governance transfer is authorized.**

This engine is a **non-protected coordination layer**. It does not touch the supervisor-owned scheduler state (`.ai/runtime/`), does not edit any protected trust-root path, does not grant Cloud merge/reseal/approval authority, and does not weaken any validation/review/CI/security gate.

## Honest state (the governing finding)

Every **feature/screen** task in the full inventory (`docs/autonomy/backlog-drafts/BACKLOG_CHECKPOINT.json`) is gated by at least one of:
1. a **sealed-file reseal** (a new screen registers its test in sealed `config/validation.json` → a Local maintainer trust-root reseal), or
2. a **new Founder authority** (a new POST endpoint / desktop allow-list entry in exact-protected `apps/control-api/src/server.ts` / `apps/desktop/main.mjs`; money/risk-5), or
3. a dependency on **FA-LEASE2** (`pkg-lease1-wiring`) and **BACKLOG-SOURCE-REBASELINE**, both BLOCKED on the Founder D3 record.

So **no feature task is honestly READY under current authority.** Declaring one READY would be fabricating authority — forbidden by the builder contract.

What **is** genuinely authorized, non-protected, independent, and evidence-backed is the **Cloud production infrastructure itself**, which this directive explicitly orders built (items #8, #11, #12). That is the real READY queue (`QUEUE.json`): `CP-QUEUE`, `CP-REPORT`, `CP-CI`, plus the orchestration tasks `CP-DISPATCH` / `CP-RECOVERY` performed by this session.

## Operating model (how parallel cloud production runs)

- **Queue** (`QUEUE.json`): the persistent canonical operational view. READY = authorized + non-protected + dependency-clear. It carries the gated feature backlog as BLOCKED with exact blockers (honest, not cherry-picked).
- **Dispatch** (`CP-DISPATCH`): the orchestrator (this cloud session) spawns **one implementer per independent READY task** via `create_session`, each on **its own branch → its own PR**. Maximum *safe* parallelism, scaled to cloud capacity/tokens/budget — not a single implementer.
- **Single ownership** (directive #4): enforced by the merged **atomic lease** (`automation/lib/task-lease.mjs`). A task already claimed is never re-dispatched. Ownership is the lease, never branch/commit presence.
- **Non-blocking pipelines** (directive #5, #6, #10, "a PR waiting never makes an implementer wait"): an implementer that finishes + opens a PR advances to the next READY task immediately. Review, CI, merge, bug-fix and new-feature dev run on independent lines. A BLOCKED task never stops the others.
- **Independent reviewer** (directive #7, #9): the governed Cloud reviewer runs in a **separate session** from any implementer. The implementer that wrote the code never approves it. The merge gate (`scripts/merge-via-gate.mjs`, PR #11) stays fail-closed; merge/reseal remain an authorized-operator action, never Cloud's.
- **Persistence/recovery** (directive #12): scheduled executors (routines) re-arm production after this session ends and emit the 60-minute report. See `RECOVERY.md`.

## Guardrails every implementer carries

- Edit only non-protected paths (not `automation/lib/`, `config/`, `scripts/validate-*`, `scripts/run-validation.mjs`, `prompts/`, `roadmap/contracts/`, the exact-protected list, or `schemas/`). Confirm against `config/protected-paths.json`.
- Add the `//TR` marker to every new file (build gate).
- Provide a standalone `node` proof (Node ≥24); do **not** register tests in sealed `config/validation.json`.
- Open a PR; do **not** merge, reseal, approve, self-declare CLEAN, or broaden scope.
- Import only already-merged modules from `v7/integration`.

## Keystone escalation (directive #15 — separate Founder decision, does not stop other work)

The single highest-leverage unblock is **FA-LEASE2's D3 sealed authority record** in a cloud-only world (Local is being removed as a dependency). It activates the lease wiring → Cloud Developer A consuming the backlog → the entire feature backlog. Companion out-of-scope items: restore GitHub **Actions** billing/runners (admin), the **trust-root reseal / separate-identity Cloud governance transfer** (critical security, #9), and any **paid/production/risk-5** authority. These are presented as one Founder/admin decision; all other work continues meanwhile.
