<!-- //TR: Bu closure notu V2 re-audit fixlerinden sonra yapılan ikinci hardening turunda dependency-scope, Git refs, filesystem symlink boundary, provider credential separation, reviewer evidence/finding identity ve signing-key ACL açıklarının nasıl kapatıldığını kaydeder. -->
> **HISTORICAL_HARDENING_NOTE_NOT_CURRENT_AUTHORITY** — //TR: Bu belge geçmiş audit/specification bağlamını korur; current PASS/CLEAN/closure/release authority değildir. Current truth için `CANONICAL-STATUS.md` ve `audit/V6-FULL-SCAN-PROGRESS.json` kullanılır.
# V3 Hardening Additions

- package dependency section/scope changes are tracked; lifecycle/workspace/override metadata protected.
- Git refs/HEAD/worktrees/.git pointer are included in builder pre/post metadata snapshot.
- worktree symbolic-link/junction escape is fail-closed for autonomous builder.
- Claude and Codex child environments use provider-specific credential namespaces.
- captured CLI launcher digest is re-verified by each broker before invocation.
- prior blocker RESOLVED evidence must reference the frozen review evidence catalog.
- finding IDs cannot silently change semantic fingerprint across review cycles.
- generic invariant-only blockers require P0/P1 + evidence.
- frozen review bundle is schema-validated before Codex egress.
- evidence signing private-key ACL is hardened during Windows installation.
