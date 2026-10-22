<!-- //TR: LANE-C yetki talebi: sonlanmış run çalışma alanlarının (runs/<id>/work) arşivlenip bekleme süresi sonunda silinmesi için korumalı server.ts kancası. Varsayılan KAPALI; yalnız UASCO_RUN_WORKSPACE_RETENTION_HOURS tanımlıysa açılır. -->
# LANE-C authority request: archive then prune terminal run workspaces (default OFF)

## Why
Every run keeps a full git clone under `<dataDir>/runs/<runId>/work` forever. `ProjectStudio` reads a run's commits from that clone (`alternatesEnv`) and `prepareRunDelivery` imports them into the managed repo, so deleting the clone naively would lose the only copy of the commits. Design approved by the coordinator: archive first, then prune after a retention period, default OFF.

## What the code does (`core/workos/run-archive.ts`, no protected file touched)
`RunWorkspaceArchiver.sweep()` looks at runs whose `runs/<id>/work` still exists and, per run:
1. skips unless the run is **terminal** (`SUCCEEDED/BLOCKED/FAILED/CANCELLED/QUARANTINED/RECOVERY_FAILED`; `AWAITING_APPROVAL` keeps its workspace) and `updatedAt` is older than the retention period;
2. skips (workspace kept) unless the project has a **managed** repository (a user's own repository is never written; its commits exist nowhere else);
3. archives the run commit into the managed repo as `refs/uasco/runs/<runId>` with the existing `ProjectStudio` import (reads the workspace object dir only via `GIT_ALTERNATE_OBJECT_DIRECTORIES`, no workspace config/hooks, `pack-objects`, connectivity re-check);
4. **re-verifies the archive without alternates** (`ProjectStudio.isRunArchived`: ref == `headSha`, commit, every reachable object present) and only then writes `runs/<id>/workspace-archive.json` (sha256 digest) and removes `work/` (never a symlink or junction; never anything else). Evidence logs, `report.json` and the journal are never touched;
5. a terminal run that never produced a commit (`headSha` null) has nothing to archive: pruned after retention, record says so.
Any failure keeps the workspace and reports why (`KEPT_*`). `sweep()` never throws.

Cross-lane touch (additive, 2 public methods, no behaviour change): `core/workos/project-studio.ts` `archiveRunObjects` / `isRunArchived`, thin wrappers over the existing private `importRunObjects`. `core/workos/store.ts` is NOT touched.

## Protected hook (coordinator applies; nothing happens without the env var)
`apps/control-api/src/server.ts`, next to the runner start:
```ts
import {RunWorkspaceArchiver, retentionMsFromEnv} from "../../../core/workos/run-archive.js";
// ...
const retention = retentionMsFromEnv(process.env); // UASCO_RUN_WORKSPACE_RETENTION_HOURS: integer 1..8760, otherwise OFF
if (retention.enabled) {
  const archiver = new RunWorkspaceArchiver({dataDir, store, studio, retentionMs: retention.retentionMs});
  const t = setInterval(() => { try { archiver.sweep(); } catch { /* sweep never throws; belt and braces */ } }, 10 * 60_000);
  t.unref?.();
  app.addHook("onClose", async () => { clearInterval(t); });
}
```
Default OFF means: no env var, no archiver, no deletion. Suggested first use: a long retention (for example 168 hours) on a copy of real data.

## Residual risks / not done
- Not run against the Founder's real data; Windows junction behaviour of the prune is covered only by the symlink-refusal rule (the symlink test is skipped on Windows).
- The archive adds objects and a ref to the managed repo (ProjectStudio's own delivery path already does this); it does not touch the work tree or branches.
- `sweep()` is synchronous git/fs work (like other Studio operations); a large workspace blocks the event loop while it is removed.
