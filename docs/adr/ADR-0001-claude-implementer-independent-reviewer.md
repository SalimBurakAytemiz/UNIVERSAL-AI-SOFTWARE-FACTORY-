<!-- //TR: Bu ADR, Master V2 §00.6 "yalnız Claude reviewer" kuralının Founder kararı FD-ROLE-CLAUDE-IMPL-2026-10-14 ile nasıl yerine geçildiğini ekleme-yalnız (append-only) bir kayıt olarak belgeler; tarihî metin yeniden yazılmaz. -->
# ADR-0001: Claude implementer + independent isolated Claude reviewer (supersession record)

- Status: Accepted (supersedes the role clause of Master V2 §00.6 for development work from 2026-10-14)
- Record type: append-only. Entries below are only ever added; existing entries are never edited or removed. A later change of roles needs a new ADR that supersedes this one.
- Work item: WK-01 (PS-1A package)

## Context

Master V2 §00.6 states the historical rule "Claude reviewer only": Claude performs reviews, and implementation was assigned to a separate implementer (Codex CLI in FA-V2-PRODUCT-2026-10-14). That text is historical. It is preserved as written in the Master V2 document and is **not** rewritten by this ADR. The Master V2 document itself is not stored in this repository; this ADR refers to it by section only.

On 2026-10-14 the Founder recorded decision FD-ROLE-CLAUDE-IMPL-2026-10-14. It amends FA-V2-PRODUCT-2026-10-14: Codex CLI is not used for UASCO code development, Claude Code performs implementation and review as separate, independent and isolated agents, and Codex Review is strictly forbidden.

## Decision

1. Implementer: a separate Claude agent with the identity CLAUDE_BUILDER. It writes only in a standalone clone, never in the Founder's working copy, and it never declares its own work clean.
2. Reviewer: a separate, fresh Claude agent with read-only tools, running in a separate clean clone at the exact commit under review, with no access to the implementer's transcript. It never contributes to the implementation it reviews.
3. Merge gate: the governed CLAUDE_REVIEWER broker. The builder identity must differ from the reviewer identity (in the product runtime this is enforced by `assertIndependentExecutors` in `core/workos/executors.ts` and by `config/execution-backends.json` `pipeline.producerMayReviewOwnOutput = false`).
4. Codex Review is forbidden. No Codex review path may be started (the legacy supervisor path in `apps/control-api/src/server.ts` stays retired: `LEGACY_CODEX_REVIEW_PATH_RETIRED`).
5. The protected-file scope of FA-V2-PRODUCT-2026-10-14 is unchanged.

Known residual risk (from the decision record): implementer and reviewer share one model provider and quota. Independence rests on identity, process, workspace and information separation, not on provider diversity.

## Supersession ledger

| # | Date (UTC) | Superseded rule | Superseded by | Ledger reference |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-14 | Master V2 §00.6 "Claude reviewer only" (historical text preserved) and the FA-V2-PRODUCT-2026-10-14 implementer clause (Codex CLI) and clause "Claude writes no code" | FD-ROLE-CLAUDE-IMPL-2026-10-14: Claude implementer (CLAUDE_BUILDER) + independent isolated Claude reviewer; Codex Review forbidden | Founder ledger `governed-review/FOUNDER-AUTHORIZATIONS.jsonl` line 7 (`type: FOUNDER_DECISION`, `id: FD-ROLE-CLAUDE-IMPL-2026-10-14`, recordedAt 2026-10-14T18:23:38Z, not backdated; the amended authorization FA-V2-PRODUCT-2026-10-14 is line 6); repository record `audit/checkpoints/V7-PKG-B0A-ROLE-AMENDMENT-2026-10-14.json` |

The ledger file lives outside this repository in the Founder's recovery area (`UASCO-recovery/governed-review/`). The sha256 of ledger line 7 (without its line terminator) at the time this ADR was written was `59350305dbad3420258896e9b742c562d92ab7da628c9adbe8e1d3c943219593`.

## Consequences

- Every package is implemented by CLAUDE_BUILDER and reviewed by a separate fresh Claude reviewer; the implementer's checkpoint never claims CLEAN.
- The product runtime mirrors the rule: a run whose implementer identity equals its reviewer identity is refused (`EXECUTOR_CONFIG_REFUSED`), and the journal treats such a run as tampered.
- Historical documents that describe the "Claude reviewer only" rule stay unchanged; readers follow this ledger to find the rule that is in force.
