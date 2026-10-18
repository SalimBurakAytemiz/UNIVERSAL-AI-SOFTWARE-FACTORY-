<!-- //TR: Canonical backlog TASLAK dosyalarinin aciklamasi; hicbir gorev READY degildir, kuyruk aktif degildir, lease wiring ve yetki karari olmadan devreye alinmaz. -->

# Canonical backlog — DRAFTS (NOT activated)

Priority-3 deliverable. `BACKLOG_CHECKPOINT.json` and `PRODUCTION_QUEUE.json` here are **drafts** re-derived
from git state at `v7/integration @ e12dbdd`. They are intentionally kept under `docs/` (non-protected) and
are **not** the live queue. Do not point any runtime at them, and do not treat any task as READY from these
files alone.

**Hard invariants in these drafts (verify before any activation):**
- **Nothing is `READY`.** No task carries an `authorizedBy`. The production queue must not be activated until
  the atomic lease is wired (`../FA-LEASE2-AUTHORIZATION-REQUEST.md`) and a Founder/Local authority record
  marks specific tasks READY.
- Ownership split and status are drafts, not contract values.

## Snapshot (26 checkpoint tasks)

| Group | Count |
|---|---|
| DONE (merged to canonical only) | 10 |
| IN_REVIEW | 1 (UI-074, PR #8 — open, old base, file-level overlap with sealed config) |
| BLOCKED | 9 |
| DRAFT_NOT_READY | 6 |

| Owner | Count |
|---|---|
| LOCAL | 15 |
| FOUNDER | 8 |
| CLOUD | 3 |

- **DONE (10):** UI-236, UI-049, UI-211, CI-GREEN, UI-227, UI-037+046, UI-205, UI-071, UI-248, pkg-lease1.
  "DONE" = merged to canonical; **no** CLEAN verdict on the merged head was re-verified for this draft.
- **Only one CLOUD-candidate is a concrete task: `UI-023`** (currently DRAFT_NOT_READY, not READY). The other
  two CLOUD items (`P0-REMAINDER-AUDIT`, `P1-P2-BACKLOG-AUDIT`) are placeholders for a fresh per-screen audit
  and must NOT be dispatched as they stand — each says so in its `blockedBy`.
- `pkg-lease1-wiring` is BLOCKED: the lease is a mechanism only; the remote store is not active and it is not
  wired (that is FA-LEASE2). `BACKLOG-SOURCE-REBASELINE` depends on it.

## Open judgement calls to confirm before this becomes canonical

1. **Owner when a task has both `requiresLocalWindows` and `requiresNewAuthority`** (7 of 18 inventory items):
   drafted as FOUNDER (authority-first), each noting "also requires Local Windows maintainer". Strict
   LOCAL-first would make it LOCAL 14 / FOUNDER 1 within the inventory.
2. **Owner for the 8 earlier merges** (no inventory flags): set LOCAL by landing path (each went through the
   Local re-seal + coded gate).
3. **UI-074 / PR #8** is NOT merged: head `76c9a57` on old base `cd4b104`, 1 ahead / 11 behind, touches 16
   files that also changed on trunk incl. sealed `config/validation.json` and `config/trust-root-manifest.json`
   — a file-level overlap; textual conflict not tested here.
4. `riskLevel` values are draft assessments on the repo's 1–5 scale (company write, FD-REL-1 set, release
   signing = 5), not contract values.

Promotion to a canonical, activatable queue is a separate authorized step after FA-LEASE2 and an explicit
READY/authority decision — not something this branch does.
