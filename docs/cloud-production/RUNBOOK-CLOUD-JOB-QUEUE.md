<!-- //TR: Bu runbook bulut iş kuyruğunun (apps/control-api/src/cloud/jobs.ts + queue-lock.ts) açılış hatalarında operatörün güvenli kurtarma adımlarını tanımlar; kilit dosyası yalnız hiçbir kuyruk süreci çalışmadığı doğrulandıktan sonra elle silinir. -->
# Runbook: cloud job queue (CLOUD-T0003)

The queue directory (`jobs.journal.jsonl`, `jobs.audit.jsonl`, `jobs.lock`) belongs to exactly one server process. It must be on the server's own disk, in a single PID namespace. A second instance never opens it.

## Start-up errors

| Error | Meaning | Operator action |
| --- | --- | --- |
| `QUEUE_LOCKED` | Another live process holds `jobs.lock`, or is taking over a stale lock right now. | Expected while another instance runs. Stop the other instance. Do **not** delete the lock while a queue process is running. |
| `QUEUE_TAKEOVER_STALE` | A process crashed while taking over a stale lock and left `jobs.lock.takeover` behind. The queue fails closed instead of guessing. | 1. Confirm that no queue process is running on this host (check the process list for the control API).<br>2. Delete `jobs.lock.takeover` in the queue directory. Leave `jobs.lock` in place: its owner is dead, so the next start takes it over safely.<br>3. Start the service again. |
| `JOURNAL_CORRUPT: …` | The journal has a torn, unparseable or inconsistent line. The queue refuses to start rather than replay unknown state. | Do not edit the journal in place. Keep a copy for analysis and restore it from the last good backup. The lock is released on this failure, so a restart after the restore works. |
| `leaseMs invalid` | The configuration is wrong. No lock is taken. | Fix the configuration and start again. |

## Never do

- Do not delete `jobs.lock` while any queue process may still be running. That would allow two writers and duplicate execution.
- Do not share the queue directory between containers or hosts. Pid liveness is only meaningful within one PID namespace.
