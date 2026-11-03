<!-- //TR: Bu runbook CLOUD-T0012 kapsamında bulut staging/production ayrımını, terfi kapısını, sağlık denetimini, geri dönüşü, yedeklemeyi, redakte loglamayı, keyId örtüşmeli secret rotasyonunu ve olay adımlarını tanımlar; gerçek altyapı gerektiren adımlar açıkça işaretlenir ve hiçbir ücretli kaynak otomatik açılmaz. -->
# Runbook: cloud deployment, staging/production separation, health and secret rotation (CLOUD-T0012)

This runbook covers how the UASCO cloud Control API is configured, promoted from staging to production, checked, rolled back and how its session secrets are rotated.

The code that enforces the rules is in `apps/control-api/src/cloud/deployment.ts`. It wraps `apps/control-api/src/cloud/remote-gateway.ts` (CLOUD-T0004) and does not change it. The tests are in `tests/support/cloud-deploy.cases.ts`, run through `tests/v7-cloud-contracts.test.ts`.

## 0. Honest status: what is real and what is not

| Area | Status in this repository | Needs real infrastructure (D-03 / D-29) |
| --- | --- | --- |
| Environment separation rules (separate host, disjoint key ids, no shared secret) | **Enforced in code and tested** (`checkEnvironmentSeparation`) | No |
| Session key ring with overlapping rotation and emergency revoke | **Enforced in code and tested** (`SessionKeyRing`) | No |
| Health aggregation (fail-closed, timeouts, redacted detail) | **Enforced in code and tested** (`evaluateHealth`) with fake probes | Real probes need a running staging host |
| Promotion decision (staging evidence + platform FOUNDER session + artifact-bound deploy approval) | **Enforced in code and tested** (`evaluatePromotion`, `issueDeployApproval`) | The actual deploy step needs a cloud account |
| Staging evidence authenticity | **Not enforced.** Smoke result and health report are values the caller supplies; they are not signed. Trust rests on the Founder approval (section 4). | Signing evidence needs a real staging service |
| Cloud account, hosting, DNS, TLS certificates, secret manager, log store, backups | **Not provisioned.** No cloud account is configured (D-03 cloud runtime UNKNOWN, D-29 external provider/account). | **Yes** |
| "Staging real health/auth test PASS" (merge condition) | **Open.** It cannot pass without a real staging host. Unit tests do not count as this evidence. | **Yes** |

Rule: nothing in this runbook or in the code creates paid infrastructure automatically. Every step that costs money or touches a real account is a manual step that needs Founder approval.

## 1. Environments

There are exactly two cloud environments: `staging` and `production` (`CloudEnvironment` in `core/cloud/contracts.ts`).

| Setting | staging | production |
| --- | --- | --- |
| `UASCO_CLOUD_ENVIRONMENT` | `staging` (also the default when unset) | must be set **explicitly** to `production`. An unset value is never treated as production. |
| `UASCO_CLOUD_ENDPOINT` | `https://` URL, own host | `https://` URL, **different host** from staging. Loopback/localhost is refused. |
| Session key ring | its own key ids and secrets | its own key ids and secrets. **No key id or secret may ever appear in both**, including keys that were rotated out. |
| Session key secret length | at least 32 bytes | at least 32 bytes |
| Who may deploy | OPERATOR or FOUNDER. **Manual policy rule, not enforced by code.** | **FOUNDER of the platform tenant only** (optionally restricted to a founder subject allow-list), with a session signed by the **production** key ring **and** a short-lived deploy approval for the exact artifact. Enforced by `evaluatePromotion`. |
| Data | synthetic or anonymised only | real tenant data |

`checkEnvironmentSeparation(staging, production)` returns one of these refusals. Any refusal blocks deployment.

| Refusal | Meaning | Fix |
| --- | --- | --- |
| `STAGING_NOT_CONFIGURED` / `PRODUCTION_NOT_CONFIGURED` | Endpoint missing, not `https`, has credentials/query/fragment, or production points at loopback | Fix the environment variables |
| `ENVIRONMENT_MISLABELLED` | Staging is labelled production, or production is not explicitly labelled `production` | Set `UASCO_CLOUD_ENVIRONMENT` correctly |
| `KEYRING_ENVIRONMENT_MISMATCH` | A key ring built for one environment is given to the other | Load the right key ring |
| `ENDPOINT_SHARED` | Staging and production use the same host (case and trailing dot are ignored) | Give each environment its own host |
| `KEY_ID_SHARED` | A key id is (or was) used in both rings | Rotate one side to a new key id |
| `SECRET_SHARED` | A secret is (or was) used in both rings (constant-time digest compare) | Rotate one side to a fresh secret; treat it as an incident (section 7) |

Limits of the separation check (state them, do not assume them away):

- It compares host **names** only. Two different names that resolve to the same host or IP are not detected, and private or metadata ranges (10/8, 172.16/12, 192.168/16, 169.254/16) are not refused, only loopback is. Check DNS and network placement by hand when you configure the endpoints.
- `rotate()`, `describe()` and every check take `now` from the caller. Always pass the server clock (NTP-synchronised). A clock that runs ahead can extend a retired key's verify window, but never beyond the 24 h overlap cap.

Secrets never live in the repository, in `.env` files that are committed, or in logs. They come from the platform's secret manager (to be chosen under D-29) and are passed to the process at start.

## 2. Configuration checklist (manual, needs real infrastructure)

1. Founder approves the provider and the monthly cost ceiling (D-03 / D-29). Without this approval nothing below is done.
2. Create two separate projects/accounts or at least two separate namespaces: one for staging, one for production. Separate IAM, separate secret stores.
3. Give each environment its own DNS name and TLS certificate.
4. Generate session secrets with a CSPRNG (at least 32 bytes, for example `openssl rand -base64 48`), one per environment, and store them only in that environment's secret manager.
5. Choose key ids that show the environment and date, for example `stg-2026-11` and `prd-2026-11`.
6. Set `UASCO_CLOUD_ENDPOINT` and `UASCO_CLOUD_ENVIRONMENT` per environment.
7. Set the tenant budget limits (`TenantBudget`) and keep the provider credential inside the provider (it is passed to the gateway only as `knownSecrets` for redaction).
8. Run `checkEnvironmentSeparation` with both configurations before the first production deploy.

## 3. Health checks

`evaluateHealth` gives one of four states:

| State | When | Action |
| --- | --- | --- |
| `HEALTHY` | runtime config valid, key ring matches the environment, every probe passed | none |
| `DEGRADED` | only non-critical probes failed | investigate, no promotion from a degraded staging |
| `UNHEALTHY` | runtime config missing/insecure, key ring mismatch, or any critical probe failed, threw or timed out | do not promote; in production follow section 7 |
| `UNKNOWN` | no probes were configured | treated as **not healthy**; promotion is refused |

Suggested probes once a host exists: API `/health` over https (critical), session verify of a short-lived health token signed with the current key (critical), queue journal readable (critical), model provider reachability with a zero-cost call or a ping (non-critical), log sink reachable (non-critical).

Probe timeout defaults to 5 s (allowed 10 ms – 60 s). Probe errors are redacted before they enter the report. Without a redactor, error detail is replaced by `[REDACTED]`. To keep useful, safe detail, pass the gateway's redactor **bound to the instance**: `redact: s => gw.redact(s)`. Do not pass `gw.redact` unbound, because it uses the gateway instance. If a redactor throws anyway, the report is still produced and the detail becomes `[REDACTED]`.

Pass `artifactSha256` to `evaluateHealth` when checking staging for a candidate. The report then carries the sha, and the promotion gate refuses a health report for any other artifact. Limitation: the report is not signed. It records what the caller measured, it does not prove it.

## 4. Staging smoke and promotion to production

Promotion is a decision first and a deploy second. `evaluatePromotion` allows promotion only when **all** of the following hold:

1. `checkEnvironmentSeparation` passes.
2. The candidate artifact has a valid sha256, and the staging evidence is for **the same** sha256.
3. Staging health is `HEALTHY`, was measured on `staging`, and the health report carries the same artifact sha256.
4. The staging smoke test passed.
5. Smoke and health evidence are not older than 24 h and not in the future.
6. The deploy token verifies against the **production** key ring and carries the `FOUNDER` role. A staging token never works in production because the key rings are disjoint.
7. The session belongs to the configured platform tenant (`DeployPolicy.platformTenantId`). A FOUNDER of a customer tenant is refused (`DEPLOY_TENANT_DENIED`). If `founderSubjects` is set, the subject must be on it (`DEPLOY_SUBJECT_DENIED`).
8. A deploy approval from `issueDeployApproval` is present. It is created on the server when the Founder explicitly approves, signed with the production ACTIVE key, bound to **this session id and this artifact sha256**, and valid for at most 15 minutes. A stolen session token alone cannot deploy, and an approval cannot be reused for another artifact.

Limitation: the staging evidence (smoke result, health report) is supplied by the caller and is not signed. The gate checks that it is consistent, fresh and for the same artifact. It cannot check that it is true. Until a real staging service signs its evidence, the Founder must look at the evidence before approving.

Staging smoke (manual until a host exists):

1. Deploy the artifact to staging. Record its sha256.
2. Run `evaluateHealth` against staging with real probes. It must be `HEALTHY`.
3. Run the auth smoke: issue a short session with the staging ring; check that a valid token is accepted, a tampered token is `SESSION_INVALID`, an expired token is `SESSION_EXPIRED`, another tenant is `TENANT_DENIED` and a VIEWER cannot `job.submit` (`ROLE_DENIED`).
4. Submit one `TEST` job with the smallest budget and check that its events and artifact sha256 verify.
5. Save the evidence: artifact sha256, health report, smoke result, timestamps.

Then the Founder signs in to production, reviews the evidence, and approves the artifact sha256 (this issues the deploy approval). The promotion decision is computed. Only an `ok: true` result may be followed by the real deploy, which is a manual step.

## 5. Rollback

1. Keep the previous production artifact sha256 and its staging evidence.
2. Rollback means promoting the previous artifact again. It goes through the same gate. If the old evidence is older than 24 h, re-run the staging smoke on the old artifact first. In an emergency the Founder decides; record the decision.
3. Do **not** roll back secrets. A key id or secret that was used once can never be reused (`KEY_ID_REUSED`, `KEY_REUSED`). If a rollback needs a key change, rotate to a new key.
4. After rollback, run `evaluateHealth` on production and record the result.
5. Queue state is not rolled back by hand. See `docs/cloud-production/RUNBOOK-CLOUD-JOB-QUEUE.md`.

## 6. Secret rotation with key-id overlap

Session tokens look like `v1.<keyId>.<payload>.<hmac>`. Verification looks up the key by id and compares the HMAC in constant time (`verifySession`). This makes overlap simple:

1. Generate a new secret (at least 32 bytes) and a new key id. Store it in the secret manager of **that environment only**.
2. Call `ring.rotate(newKeyId, newSecret, now)`. The new key becomes `ACTIVE` and signs all new sessions. The old key becomes `VERIFY_ONLY` until `now + overlap`.
3. Default overlap is `MAX_SESSION_TTL_MS` (12 h), which is the longest session lifetime. Every session issued before the rotation therefore ends naturally before its key is dropped. Allowed overlap: 1 min – 24 h.
4. After the overlap the old key is dropped from `verificationKeys` automatically. **Before** removing it from the secret manager (irreversible), verify: `ring.describe(now)` shows the new key as `ACTIVE`, a health token freshly signed with the new key verifies on the running service, and `evaluateHealth` is `HEALTHY`. Only then remove the old key from the secret manager.
5. Run `checkEnvironmentSeparation` again: the new secret must not match any secret of the other environment, now or in the past.
6. Check `ring.describe(now)` (it shows key ids and states, never secrets).

Schedule: rotate every 90 days, and at once after a suspected leak, a staff change, or a provider incident. Rotate staging and production on different days so one mistake cannot hit both.

Failed rotations change nothing: the old key stays `ACTIVE`.

## 7. Incidents

**Secret leak (session key):**

1. Rotate the affected environment at once (section 6).
2. **Before** revoking (irreversible: every session on the old key is logged out), verify that the new key is `ACTIVE` in `ring.describe(now)` and that a health token signed with it verifies on the running service. Then call `ring.revoke(oldKeyId)` to drop the leaked key without waiting for the overlap. All sessions signed with it fail at once (`SESSION_INVALID`). Users sign in again.
3. If the leaked secret could also be in the other environment, `checkEnvironmentSeparation` reports `SECRET_SHARED`. Rotate the other environment too.
4. Look at the gateway audit log for activity with the leaked key id. Audit reasons are already redacted.
5. Record the incident with times, key ids (never secrets) and actions.

**Production unhealthy:**

1. Stop new submissions if needed (`system.stop` is FOUNDER only).
2. Run `evaluateHealth` and read which probe failed.
3. If the last deploy caused it, roll back (section 5).
4. Do not point production at the staging host or the staging key ring as a workaround. The separation check refuses it.

**Provider or budget incident:** the gateway refuses calls with `BUDGET_EXCEEDED`, `PROVIDER_TIMEOUT` or `PROVIDER_ERROR`. Do not raise budget limits without the Founder. Provider error text is redacted.

## 8. Logs, monitoring and backup

- Logs: only the gateway audit records and health reports. Both are redacted (known secrets, session tokens, secret patterns). Never log request bodies with prompts from real tenants in staging.
- Monitoring: run `evaluateHealth` on a schedule (for example every 5 minutes) once a host exists. Alert on `UNHEALTHY` or `UNKNOWN` in production.
- Backup: the queue journal and audit files (`jobs.journal.jsonl`, `jobs.audit.jsonl`) are backed up daily to storage in the **same** environment. Staging backups never go into production storage. Restore steps are in the queue runbook. Backups of secrets are kept only in the secret manager, never in a file backup.

## 9. Never do

- Do not create paid cloud resources from a script or CI job. Every such step is manual and needs Founder approval.
- Do not share a host, key id or secret between staging and production.
- Do not deploy to production with a staging session or without staging evidence for the same artifact.
- Do not reuse an old key id or secret, also not for rollback.
- Do not treat `UNKNOWN` health as healthy.
- Do not commit secrets, `.env` files with secrets, or real health tokens.
