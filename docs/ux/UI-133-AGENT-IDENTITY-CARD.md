<!-- //TR: UI-133 "Ajan Kimlik Kartı" teslim kaydı: kapsam, dürüstlük kuralları, test kanıtı ve çalıştırılmayan (NOT_RUN) doğrulamalar. -->

# UI-133 Read-only agent identity card

- **Where:** inside the role definition panel on `#/workforce` (shown after a role is selected from the catalog).
- **Authority:** none needed. Renderer-only; data comes from `GET /v1/roles/:roleId` and `GET /v1/agents`, both already served and allow-listed. No new endpoint, allow-list entry, POST, IPC, storage or protected-file change.

## Honesty rules (tested)

- The 599 roles are definitions (registry status NOT_EVALUATED), not live or certified agents. The card says so.
- "Certified" is shown only when `proficiencyStatus` is CERTIFIED **and** a certified scope is present **and** the evaluation-spec evidence trail is non-empty, from a VERIFIED read. Otherwise "Not certified", with the missing parts shown as UNKNOWN.
- Runtime stays UNKNOWN unless the read reports a status. A failed `/v1/agents` read shows the registry line as UNKNOWN, never a count.
- New names: `data-identity-card-for`, `data-identity-certified`, `data-identity-evidence`, `data-identity-unknown`, CSS `wf-idcard*`, locale keys `workforce.idcard.*`.

## NOT_RUN

Windows run and the full run-validation were not run.
