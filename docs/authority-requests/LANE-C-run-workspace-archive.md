<!-- //TR: LANE-C yetki talebi: sonlanmış run çalışma alanlarının (runs/<id>/work) arşivlenip bekleme süresi sonunda silinmesi için korumalı server.ts kancası. Varsayılan KAPALI; yalnız UASCO_RUN_WORKSPACE_RETENTION_HOURS tanımlıysa açılır. -->
# LANE-C authority request: archive then prune terminal run workspaces (default OFF)

## Why
Every run keeps a full git clone under `<dataDir>/runs/<runId>/work` (plus derived clones) forever. `ProjectStudio` reads a run's commits from that clone (`alternatesEnv`) and `prepareRunDelivery` imports them into the managed repo, so deleting the clone naively would lose the only copy of the commits. Design approved by the coordinator: archive first, then prune after a retention period, default OFF. An independent read-only review of the first implementation found two HIGH and several MEDIUM problems; this document describes the corrected design.

## What the code does (`core/workos/run-archive.ts`, no protected file touched)
`RunWorkspaceArchiver.sweep()` looks at runs whose `runs/<id>/work` still exists and, per run:
1. skips unless the run is **terminal** (`SUCCEEDED/BLOCKED/FAILED/CANCELLED/QUARANTINED/RECOVERY_FAILED`; `AWAITING_APPROVAL` and every open status keep their workspace) and `updatedAt` is older than the retention period; `work` must be a real directory (a symlink or junction is never followed: `KEPT_UNSAFE_PATH`);
2. skips (workspace kept, `KEPT_SECRET_FINDING`) any run with a **secret finding** (`SECRET_*` reason, `secretHits`, security stage `SECRET_DETECTED`): archiving would put those objects into the managed repo, and every later workspace is a `git clone` of it, which copies the whole object directory to later builders and reviewers. Such workspaces are never pruned automatically; the operator handles them by hand;
3. skips (workspace kept) unless the project has a **managed** repository (a user's own repository is never written; its commits exist nowhere else);
4. archives the run's **recorded commit set**, not just `headSha`: `headSha` plus every `commitSha` named by the run's evidence. `headSha` is written only at the end of a successful IMPLEMENT; after `TASK_LIMIT_FILES_EXCEEDED`, `IMPLEMENT_COMMIT_MISMATCH`, `IMPLEMENT_HISTORY_REWRITTEN` or a failed later remediation cycle the commit exists only in the evidence and in `work/`. Each commit gets `refs/uasco/run-commits/<runId>/<sha>`; the head also gets `refs/uasco/runs/<runId>` (the name `prepareRunDelivery` uses). Import is the existing `ProjectStudio` path (workspace object dir read only via `GIT_ALTERNATE_OBJECT_DIRECTORIES`, no workspace config/hooks, `pack-objects`, connectivity re-check);
5. **re-verifies every archive without alternates** (`ProjectStudio.isRunCommitArchived`: ref == sha, commit, every reachable object present), writes `runs/<id>/workspace-archive.json` (commit list, digest), removes the derived clones (`scan-c*`, `review-c*`, `security-c*`, `security-gl-c*.git`) and then `work/`. `logs/`, `security/` (reports), `report.json`, the record and the journal are never touched. A symlinked clone aborts before `work/` is touched;
6. a terminal run whose evidence names no commit has nothing to archive: pruned after retention, the record says so (`PRUNED_NO_COMMIT`);
7. if the final record write fails after the workspace is gone, the pass reports `PRUNED` with `RECORD_FINALIZE_PENDING` and a later pass finalizes the record (`RECORD_FINALIZED`).
Work per pass is **bounded** (`maxRunsPerSweep`, default 3; the rest are `deferred`) because the git/fs work is synchronous, and a failed run is not retried before `retryBackoffMs` (default 1 hour, in memory). `sweep()` never throws (a store failure is `report.error`).

Cross-lane touch (additive): `core/workos/project-studio.ts` gains `archiveRunCommit` / `isRunCommitArchived` (refs restricted to the two run-owned namespaces, sha/project/run validated) and the private `importRunObjects` takes an optional `ref` (default unchanged, so `prepareRunDelivery` behaves as before). `core/workos/store.ts` is NOT touched.

## Protected hook (coordinator applies; nothing happens without the env var)
`apps/control-api/src/server.ts`, next to the runner start:
```ts
import {RunWorkspaceArchiver, retentionMsFromEnv} from "../../../core/workos/run-archive.js";
// ...
const retention = retentionMsFromEnv(process.env); // UASCO_RUN_WORKSPACE_RETENTION_HOURS: integer 1..8760, otherwise OFF
if (retention.enabled) {
  const archiver = new RunWorkspaceArchiver({dataDir, store, studio, retentionMs: retention.retentionMs});
  const t = setInterval(() => {
    const rep = archiver.sweep();
    if (rep.error) app.log.warn({error: rep.error}, "run-archive");
    for (const r of rep.results) if (r.status !== "KEPT_NOT_TERMINAL" && r.status !== "KEPT_RETENTION" && r.status !== "KEPT_BACKOFF") app.log.info({run: r.runId, status: r.status, detail: r.detail}, "run-archive");
  }, 10 * 60_000);
  t.unref?.();
  app.addHook("onClose", async () => { clearInterval(t); });
}
```
Default OFF means: no env var, no archiver, no deletion. Suggested first use: a long retention (for example 168 hours) on a copy of real data.

## Residual risks / not done
- Not run against the Founder's real data. The symlink tests are skipped on Windows (junction behaviour is covered only by the refusal rule).
- The archive adds objects and refs to the managed repo (the delivery path already does this for accepted runs). Archived non-secret objects of rejected runs are copied into later workspace clones like any other object; secret-flagged runs are excluded for exactly that reason.
- Only commits the engine recorded are preserved; uncommitted files or unrecorded commits in `work/` are not part of the run's audit record and are deleted with it.
- Even when bounded, one pass blocks the event loop while it archives and removes a few workspaces (like other Studio operations).
