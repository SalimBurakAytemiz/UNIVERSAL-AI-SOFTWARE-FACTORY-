<!-- //TR: Factory V2 korumalı değişiklik talebi: kanonik merge yürütücüsünün (docs/planning/autonomy/executor.mjs) her yazıdan önce doğrulanmış otorite kaydını kontrol etmesi ve automation/factory-v2/'nin yönetişim yoluna alınması; Founder yetkisi gerekir, bu dalda UYGULANMADI. -->
# FV2 protected request: authority fence in the canonical merge path

**Status:** prepared, not applied. It touches `docs/planning/autonomy/executor.mjs` and `docs/planning/autonomy/autonomy.mjs`, which are governance and trust files, so it needs a Founder-approved PR.

## Why
After a handover, V4.1 must not merge, even if the V4.1 session or one of its builders keeps running. A check that lives only on the V2 side is not enough. The fence therefore goes into the merge path that V4.1 itself uses (FD-2026-11-03 standing autonomy), so V4.1's cooperation is not required.

## Exact change
The full diff is in `FV2-PROTECTED-EXECUTOR-AUTHORITY-FENCE.diff`.
1. **`executor.mjs` (`executeMerge`):** after the existing base re-read and before the only write (`PUT pulls/<n>/merge`), it calls `mergeAuthority()` from `automation/factory-v2/v41-guard.mjs`.
   - **No authority record exists:** V4.1 merges as it does today (unchanged behaviour).
   - **Record verified and phase is `V41_AUTHORITATIVE`:** V4.1 merges. A V2 intent is refused.
   - **Phase is `HANDOVER_PREPARED` / `V41_DRAINED`:** no merge by anyone.
   - **Phase is `V2_AUTHORITATIVE`:**
     - A V4.1 merge is refused (`V41_FENCED_BY_V2_AUTHORITY`).
     - A V2 merge needs `--v2-intent <file>`: a MERGE envelope signed by the holder's registered key and bound to this PR, head SHA and epoch.
   - **Record is unverifiable or the check throws:** `BLOCK`. Nothing is written.
2. **`autonomy.mjs`:** adds `automation/factory-v2/` to `GOVERNANCE_PREFIXES`. The guard and identity code become Founder-protected, so a routine PR cannot weaken the fence.

## Prerequisites (Founder, before or with this PR)
- **Canonical keyring** `docs/planning/authority/FACTORY-V2-ROLE-KEYS.json`.
  - Contents: schema `uasco.factory-v2.role-keys/1`, domain `uasco-v7`, mode `LIVE`. One entry per role session: `V41_OWNER` = the V4.1 coordinator, `V2_CANDIDATE` = the V2 supervisor session, and `FOUNDER`.
  - Each session generates its own key with `node automation/factory-v2/cli.mjs bridge keygen --role <ROLE> --session <its id> --out <private file>`. Only the printed public entry goes into the PR.
  - Without this file, no signed authority action verifies, so any handover attempt fails closed.
- **Registry branch** `uasco/registry` that both supervisor sessions may push (set through `create_session` `outcome_branch`).
- **Required (enforced in code):** a ruleset on `uasco/registry` with the `non_fast_forward` and `deletion` rules.
  - The bridge refuses `prepare` and `commit`, and the guard refuses every merge once any authority exists, unless the GitHub rules API reports both rules (`REGISTRY_NOT_PROTECTED`).
  - Reason: the anti-rewind check walks the registry's history, which is trustworthy only if nobody can force-push or delete it.
  - All factory writes are plain fast-forward pushes, so they work under this protection.
- **The patched executor** passes its own `curlApi` to the guard for this rules check.

## Evidence
- `tests/factory-v2/security.test.mjs`, test "the prepared executor.mjs patch blocks the real merge call before any write when V2 is authoritative". It applies this diff in a temporary worktree and drives the patched `executeMerge`:
  - under V2 authority it returns `BLOCK AUTHORITY:V41_FENCED_BY_V2_AUTHORITY` with zero writes;
  - when the check fails it returns `BLOCK` with zero writes;
  - with no record it proceeds to the write.
- The guard's decisions are covered in all phases, including forged, rewound and edited records.
