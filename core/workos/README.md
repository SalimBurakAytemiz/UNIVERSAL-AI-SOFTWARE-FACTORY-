<!-- //TR: Bu dosya Work OS store'unun veri modelini, journal biçimini ve hata modlarını belgeler. -->
# Work OS store (V7 B1)

One canonical store for user work: projects, missions, tasks. The Control API intake routes are the only writers today.

## Data model
- Project: `projectId (prj_*), orgId, tenantId, customerId?, name, repository?{path|url}, environmentId, createdAt, createdBy`
- Mission: `missionId (msn_*), projectId, tenantId, title, objective, acceptanceCriteria[], riskLevel R0-R4, status, createdAt, createdBy, traceId (trc_*)`. Status follows `core/mission/state-machine.ts`; new missions start `DRAFT`.
- Task: `taskId (tsk_*), missionId, projectId, tenantId, title, status, dependsOn[]`
- IDs are a prefix plus 24 hex chars from `crypto.randomBytes(12)`.
- Every read takes a scope `{tenantId}`; other tenants' entities are never returned.

## Persistence
Data root: `UASCO_DATA_DIR`, default `<repo>/.ai/workos`.
- `journal.jsonl`: append-only, one JSON object per line: `{seq, prevHash, hash, type, actor, at, payload}`. `hash = sha256(stableStringify(entry without hash))`; `seq` starts at 1 and `prevHash` of entry 1 is 64 zeros. Types: `PROJECT_CREATED`, `MISSION_CREATED`, `TASK_CREATED`, `MISSION_TRANSITIONED`. Appends are fsynced. The journal is the only authority.
- `snapshot.json`: derived state plus `lastSeq`/`lastHash`, written atomically (`writeJsonAtomic`). It can be deleted and is rebuilt from the journal on load. It may lag the journal (crash between the two writes) but may not be ahead of it or point to a hash that is not in the journal.
- Idempotency: create calls may carry `idempotencyKey` (per tenant and entity kind). A repeated key returns the existing entity and writes no entry.

## Failure modes
- Broken hash, sequence or `prevHash`, non-JSON line, unterminated last line, illegal replayed transition, or a snapshot ahead of / inconsistent with the journal: the store is marked tampered. Reads and writes throw `WORKOS_JOURNAL_TAMPERED` (API: 503). Nothing is repaired automatically.
- Before every write the journal is re-read and re-verified, so a second process or an out-of-band edit is detected.
- Invalid mission transition: `WORKOS_INVALID_TRANSITION` (API 409), nothing written. Unknown or other-tenant entity: `WORKOS_NOT_FOUND` (404). Bad input: `WORKOS_INVALID_INPUT` / schema failure (400).
- API write gates, in order: Global Stop active (423 `GLOBAL_STOP_ACTIVE`), action-gateway deny (403 with reason), strict body schema (400). The stop file is only read, never written.
