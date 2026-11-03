<!-- //TR: Bu runbook bulut iş kuyruğunun (apps/control-api/src/cloud/jobs.ts + queue-lock.ts) açılış hatalarında operatörün güvenli kurtarma adımlarını tanımlar; kilit dosyası yalnız hiçbir kuyruk süreci çalışmadığı doğrulandıktan sonra elle silinir. -->
# Runbook: cloud job queue (CLOUD-T0003)

The queue directory (`jobs.journal.jsonl`, `jobs.audit.jsonl`, `jobs.lock`) belongs to exactly one server process. It must be on the server's own disk, in a single PID namespace. A second instance never opens it.

## Start-up errors

| Error | Meaning | Operator action |
| --- | --- | --- |
| `QUEUE_LOCKED` | Another live process holds `jobs.lock`, or a live process is taking over a stale lock right now. After a crash, the next start takes over the dead owner's lock automatically. | Expected while another instance runs. Stop the other instance. Do **not** delete the lock while a queue process is running. |
| `QUEUE_TAKEOVER_STALE` | 16 takeover attempts in a row on the same stale lock all crashed. Each left its own `jobs.lock.takeover.<hash>.<n>` token behind. A single crash during a takeover **recovers on its own**: the next start uses the next token generation and never deletes a token, then clears the old tokens. | 1. Investigate why takeovers keep crashing (disk full, permissions, OOM).<br>2. Confirm that no queue process is running.<br>3. Delete the `jobs.lock.takeover.*` files and start again. |
| `JOURNAL_CORRUPT: …` | The journal has a torn, unparseable or inconsistent line. The queue refuses to start rather than replay unknown state. | Do not edit the journal in place. Keep a copy for analysis and restore it from the last good backup. The lock is released on this failure, so a restart after the restore works. |
| `leaseMs invalid` | The configuration is wrong. No lock is taken. | Fix the configuration and start again. |

## Never do

- Do not delete `jobs.lock` while any queue process may still be running. That would allow two writers and duplicate execution.
- Do not share the queue directory between containers or hosts. Pid liveness is only meaningful within one PID namespace.
