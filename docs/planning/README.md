<!-- //TR: Kanonik backlog dosyasinin dogru durumu ve saatlik Cloud rutininin sonuc semantigi: hicbir gorev READY degil, bu nedenle rutin BLOCKED degil NO_ACTION ile kapanir; gorev uydurulmaz. -->

# Canonical planning source (bootstrap)

`BACKLOG_CHECKPOINT.json` exists so the hourly Cloud Developer routine can read a canonical backlog at
`v7/integration` instead of dead-ending on a missing file. It is derived from the draft in PR #11
(`docs/autonomy/backlog-drafts/`) and is **honest**: no task is `READY`. Two Founder-authorized tasks (HOME-DELIVERY-STATE, PLANNED-SCAFFOLD-CLEANUP) are `IN_REVIEW`; every other task is unauthorized.

## Routine outcome semantics

| Condition | Outcome |
|---|---|
| File missing / unparseable | `BLOCKED` (fail-closed) |
| File valid, no task READY + authorized + dependency-clear + lease-free | `NO_ACTION` (report reason; not a failure) |
| A task READY + `authorizedBy` + deps DONE + lease granted | start it on `claude/<task-id>` |

## What makes a task READY

1. A Founder/Local authority record naming the task (`authorizedBy`).
2. FA-LEASE2 wired (needs the sealed D3 record; not creatable by a builder).
3. All `dependsOn` DONE; no protected-path edit required.

Until then, independent cloud-infrastructure work is tracked in `docs/cloud-production/QUEUE.json` (PR #15).
Editing this file to mark a task READY without those records is fabrication of authority.
