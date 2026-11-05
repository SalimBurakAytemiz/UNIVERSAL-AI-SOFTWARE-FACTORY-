<!-- //TR: Factory V2 rol anahtarları için yönetişim kaydı ve kayıt prosedürü: hangi rollerin, hangi oturumların, hangi kapsamla imza yetkisi aldığını ve anahtarların nasıl eklendiğini/döndürüldüğünü tanımlar; özel anahtarlar depoya girmez. -->
# Factory V2 role keys (governance record)

**File:** `docs/planning/authority/FACTORY-V2-ROLE-KEYS.json` (schema `uasco.factory-v2.role-keys/1`, mode `LIVE`, domain `uasco-v7`).

**Status:** the list is empty. While it stays empty, no signed authority transition (prepare, drain ack, commit, rollback, reset, V2 merge intent) can verify. Every handover attempt therefore fails closed, and V4.1 keeps working exactly as today.

## Who reads it
Factory V2 (`automation/factory-v2/identity.mjs`, `loadCanonicalKeyring`) reads this file only at an exact commit of the canonical branch `v7/integration`, and never from the registry branch. So a registry writer cannot add or change a key. This path is under `docs/planning/authority/`, a governance prefix, so any change here needs a Founder-approved PR.

## Roles and what each may sign

| Role | Session | May sign |
|---|---|---|
| `V41_OWNER` | the live V4.1 coordinator session | `DRAIN_ACK` (only as the manifest's outgoing owner), `ROLLBACK`, reset of an invalid record |
| `V2_CANDIDATE` | the V2 Supervisor session that will hold authority | `PREPARE`, `COMMIT` (only as the manifest's candidate), `MERGE` intents while it is the V2 holder |
| `FOUNDER` | a Founder-controlled session | `ROLLBACK`, reset of an invalid record |

## Adding a key (one Founder-approved PR per change)
1. The session that will hold the role generates its own key **inside its own container**:
   `node automation/factory-v2/cli.mjs bridge keygen --role <ROLE> --session <its session id> --out <private file outside the repository>`
2. The command prints only the public entry, `{keyId, role, sessionId, publicKeyPem}`. Only that entry goes into `keys`. The private key never leaves that container and is never committed, posted or pasted.
3. The keyring loader recomputes `keyId` from the public key and refuses any mismatch, duplicate, unknown role or malformed session id.
4. Optional `validUntil` (epoch ms) bounds a key's lifetime.

## Rotation and revocation
- **Remove or replace an entry:** use a Founder-approved PR. Envelopes already in an authority chain are verified against the keyring at the canonical commit the reader uses, so removing a key also invalidates chains that depend on it. Rotate only together with a fresh handover or a rollback.
- **Lost V4.1 or V2 session:** a `FOUNDER` key can roll back or reset to V4.1.

## Not in this record
- Private keys.
- Cutover authorization. That is a separate Founder record with the line `AUTHORIZES: FACTORY_V2_CUTOVER domain=uasco-v7 candidate=<session> manifest-version=<n>`. This file must never contain that line, because it is also the canonical anchor.
