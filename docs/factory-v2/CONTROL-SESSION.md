<!-- //TR: Factory V2 tek ana kontrol oturumu çalışma kılavuzu: Founder'ın tek konuştuğu Supervisor Cloud oturumunun gerçek işçi oturumlarını nasıl açtığı, bağladığı, sonuçlarını kimliği doğrulanmış kanaldan nasıl aldığı, kayıpta nasıl yeniden atadığı ve tek komutla nasıl rapor verdiği; durum paylaşımlı imzalı günlükte tutulur. -->
# Factory V2 single control session

The Founder talks only to the V2 Supervisor Cloud session, called the control session. Every Builder and Reviewer is a real Claude Cloud session that works in the background. The control session creates and binds those sessions and collects their results.

All state lives in the shared ledger: a Supervisor-signed, hash-chained event log on a registry branch. Nothing depends on the control session's container, and a restarted or new Supervisor continues from the ledger.

## Loop (each step is one command or tool call in the control session)

1. `node automation/factory-v2/cli.mjs factory tick --config <cfg>`
   - Adopts or acquires the Supervisor lease and epoch, re-attaches in-flight work, and consumes verified results.
   - Dispatches ready tasks within capacity and quota.
   - Prints `actions`, the exact `create_session` requests.
2. For each action:
   - call `create_session` with exactly those parameters;
   - then run `factory bind --intent <id> --session <the returned session id>`. One session serves exactly one intent.
3. When a worker session is idle, read its final message with `list_events(session_id=<bound id>, kinds=["result"])`. Save the text and run `factory result --intent <id> --session <bound id> --text-file <file>`.
   - The platform attests that the text came from that session.
   - The result is accepted only if all of these hold: it comes from the bound session; it carries the intent nonce; its task and attempt are current; its head is the branch tip and descends from the dispatch base; and the commit's `Claude-Session` trailer is the bound session.
   - Reviews must name the exact head and base.
   - Everything else is recorded as `RESULT_REJECTED`.
4. If a session failed, was archived or ran out of quota, run `factory lost --intent <id> --reason <r>`.
   - The task goes back through bounded retry and is reassigned to a **new** session as attempt+1.
   - A late result from the lost session is refused.
   - Spawn and run timeouts mark sessions lost automatically.
5. `factory fact --task <id> --fact PR|CI|REVIEW|MERGE|EVIDENCE --value '<json>'` records PR, CI, merge and product evidence (screenshots, E2E results) for the report.
6. `factory report [--github] [--quota q.json]` produces one Founder report. It covers:
   - sessions and capacity;
   - tasks with PR, review, CI and merge;
   - the queue and dependencies;
   - quota (`UNKNOWN` unless measured);
   - Founder decisions;
   - product evidence;
   - blockers.

## Config (never committed when it names a private key)

`{domain, mode: "SHADOW", registryBranch: "uasco/<name>", ledgerNs, keyringFile (probe-* domains only), signerKeyFile (outside any git tree), sessionId, repoUrl, backlogFile, target, leaseTtlMs, dispatchRef}`

- Keyring per domain:
  - The live domain `uasco-v7` only uses the canonical keyring at `v7/integration`. That keyring is empty today, so the live ledger cannot be written; this fails closed.
  - `probe-*` domains may use a PROBE keyring file.
- `mode: "LIVE"` is refused until the Founder cutover (see `CUTOVER-ACCEPTANCE.md`).
- Merge Preparers and the Merge Writer are deterministic, in-process roles of the Supervisor under the exclusive writer lease. They are not model sessions.

## Verified with real Cloud sessions (2026-11-05, domain `probe-control`, ledger `uasco/fv2-ledger-probe`)

**Builder:**
- Session `session_015dYwb4nkjtpNd57C6VAFFQ` was created from intent `intent_a4099e9aec52` and bound to it.
- It pushed `8ef00d2e` to its outcome branch.
- Its result was taken from that session's transcript and accepted after the git checks.
- The same text attributed to another session was refused with `SESSION_NOT_BOUND_TO_INTENT`. Binding the intent to a second session was refused with `INTENT_NOT_PENDING`.

**Recovery:**
- The next tick ran from a fresh clone with no local state. It rebuilt everything from the ledger, moved the task to `REVIEWING`, and created two reviewer intents bound to head `8ef00d2e`.

**Reviewers:** results are listed in `CONTROL-SESSION-EVIDENCE.json`.
