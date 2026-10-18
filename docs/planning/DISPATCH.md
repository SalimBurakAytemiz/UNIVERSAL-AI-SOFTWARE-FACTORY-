<!-- //TR: Bu not Cloud-only dispatch.mjs için kısa işletim kılavuzudur ve atomikliğin ne olduğunu/olmadığını dürüstçe belirtir. -->
# Cloud next-task dispatcher (operating note)

Authority: Founder directive 2026-10-18 (Cloud-only dispatch infrastructure, non-protected files). This is NOT FA-LEASE2 wiring and does not touch protected orchestrator files.

```
node docs/planning/dispatch.mjs [--claim] [--owner <id>] [--backlog <path>] [--remote <name>]
                                [--base-branch v7/integration] [--stale-hours 6] [--open-prs a,b] [--no-lease]
```

Prints one JSON line `{outcome, taskId, branch, claimRef, reasons[], ...}`. Exit: 0 START/NO_ACTION, 2 BLOCKED, 3 RECOVERABLE_FAILURE.

## Selection (fail-closed)
First task in file order with: `status === "READY"`, `owner === "CLOUD"`, `authorizedBy` a non-blank string, `dependsOn` an array of strings all present and `DONE`, `protectedEdit` absent or `false`, `requiresNewAuthority` absent or `false` (strict booleans; `"true"`, `null`, `0` are malformed and rejected), no remote branch `claude/<id-lowercase>`, no remote branch equal to `task.branch`, and not in `--open-prs`. Every rejected task gets machine-readable reasons (`NOT_READY:<s>`, `NO_AUTHORIZED_BY`, `UNMET_DEP:<id>`, `PROTECTED_EDIT`, `REQUIRES_NEW_AUTHORITY`, `ALREADY_CLAIMED`, `BRANCH_EXISTS:<b>`, `OPEN_PR:<b>`, `MALFORMED_*`). Missing/unparseable/non-array backlog or duplicate ids => BLOCKED. Unreachable remote => RECOVERABLE_FAILURE (never "no work").

## Claim
`--claim` pushes a one-commit claim (parent = remote `--base-branch` tip, subject `dispatch-claim: ...`) to `refs/heads/claude/<id-lowercase>` with `--force-with-lease=<ref>:` (create-only). If that ref already exists the push fails, the claim is lost and the next selectable task is tried (auto-advance). It also records the claim via the merged `automation/lib/task-lease.mjs` + `task-lease-git-store.mjs` remote ref store (`refs/uasco/claims/<id>`, TTL = `--stale-hours`), imported read-only. If the lease is held by someone else the task is skipped; if the lease layer is unavailable the branch claim still proceeds and `lease.status` says `UNAVAILABLE`/`SKIPPED`. `--no-lease` disables the lease record.

## Recovery
A claim is `RECLAIMABLE` (reported only, never deleted) when its ref has no commits beyond base other than `dispatch-claim` commits, the newest is older than `--stale-hours`, and its branch is not in `--open-prs`. States also reported: `FRESH`, `OPEN_PR`, `HAS_WORK_COMMITS`, `UNKNOWN`. An operator must delete the ref (and `refs/uasco/claims/<id>`) by hand to release it.

## Exact limitations
- What IS atomic: the git server's create-if-absent on the single claim ref. Two concurrent dispatchers can never both create it; the loser sees a rejected push. Likewise the lease ref create.
- What is NOT: this is a branch-ref claim, not the merged atomic lease protocol as scheduler authority and not FA-LEASE2 wiring. Nothing in the orchestrator reads these claims, and the branch-ref claim and the lease ref are two separate pushes (not one transaction): a crash between them can leave a lease without a claim branch or the reverse. A lost-race lease is released best-effort.
- No heartbeat/renewal, no auto-reclaim, no GitHub API: open PRs must be passed in via `--open-prs`. Stale age uses the claim commit's committer date (clock of the claimer), falling back to the lease `acquiredAt`.
- Read-only dry run (no `--claim`) reports START with `claimed:false`; it reserves nothing.
- Backlog edits (status changes) are still done by humans/PRs; the dispatcher never writes the backlog.
- Proof: `node docs/planning/dispatch.proof.mjs` (temp git repos only). The remote lease path was exercised only against local bare repos, not a live GitHub origin.
