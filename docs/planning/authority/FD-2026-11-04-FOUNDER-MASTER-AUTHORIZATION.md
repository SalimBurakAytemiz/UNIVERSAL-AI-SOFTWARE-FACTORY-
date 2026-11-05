<!-- //TR: Bu kayıt Founder'ın 2026-11-04 "FOUNDER MASTER AUTHORIZATION & AUTONOMOUS EXECUTION DIRECTIVE" kararını kalıcı denetim kaydı olarak saklar: mevcut görevlerin GELİŞTİRİLMESİ önceden onaylıdır; korumalı/governance/CI-executed merge kapıları, GitHub environment onayı ve SHA'ya bağlı bağımsız review aynen kalır. Bu kayıt standing-authority.json'u değiştirmez ve kendi yetkisini genişletemez. -->
# FD-2026-11-04-FOUNDER-MASTER-AUTHORIZATION: development authorization for the open V4.1 inventory

- **Decision by:** the Founder (repository owner), in Claude Code cloud session `session_015dYwazi7LHFCg3dABbSW2P`, on 2026-11-04.
- **Title of the decision:** "UASCO V4.1 — FOUNDER MASTER AUTHORIZATION & AUTONOMOUS EXECUTION DIRECTIVE".
- **Status:** effective once this file is merged into `v7/integration`. This PR touches `docs/planning/authority/**`, so it is `FOUNDER_REQUIRED:GOVERNANCE_PATH` and is merged by the Founder. It is not auto-merged.
- **Relation to existing authority:** this record builds on `FD-2026-11-03-STANDING-AUTONOMY`.
  - It does **not** modify `docs/planning/autonomy/standing-authority.json`.
  - It does not add tiers, satisfied gates or trusted logins.
  - It does not change `merge-gate.mjs` or `autonomy.mjs`.
  - Routine T0/T1/T2 merges keep working exactly as defined there.

## 1. What it grants: development, not merge
Pre-granted Founder authority to **develop** the work already in the V4.1 task inventory and in the open PRs. Development here means analysis, coding, tests, fixes of review findings, rebases, and resubmission for independent review. It covers:
- Desktop, Cloud and AI work;
- CI and Windows test infrastructure;
- security work;
- executor reliability;
- reviewer-authentication diagnosis.

It also covers **preparing** narrow changes to protected, governance and CI-executed paths, and presenting them at the required Founder gate.

## 2. What it does not satisfy
This record is not a substitute for any of these:
- The GitHub `uasco-founder-authority` environment approval for protected or CI-executed PRs.
- Branch protection or the ruleset.
- The required checks `validate (ubuntu-latest)` and `validate (windows-latest)`.
- The SHA-bound `VERDICT-BINDING: verdict=CLEAN` from an independent reviewer session.
- The Founder's merge of a protected, governance or CI-executed PR.

The following remain `FOUNDER_REQUIRED`, per task. They never stop the rest of the work:
1. A new paid service, API subscription, credit or payment. D-08 stays at 0 USD.
2. A new external service account or credential.
3. Changing or rotating a secret value.
4. Destructive or hard-to-reverse production actions, including production data changes.
5. Loosening GitHub security rules or authority boundaries.
6. Final Founder acceptance of a product that has not been proven (D-23).
7. Any operation for which GitHub itself requires a separate user action.

## 3. Per-PR decisions recorded
| PR | Decision | Still required before merge |
|---|---|---|
| #328 `POST /v1/command-intake` allow-list in `apps/desktop/main.mjs` and the trust-root reseal | Development approved | Green CI on the exact head, an independent CLEAN review bound to the exact head and base, the protected-path checks, then a Founder merge |
| #306 executor reliability (governance) | Development approved; current Windows CI failures to be fixed first | Base-drift, lost-response, verify-main and merge-integrity checks preserved; green CI; independent CLEAN review; then a Founder governance merge |
| #333 reviewer-auth classifier (`scripts/ci/uasco-review/**`, CI-executed) | Development approved | Independent review, Founder merge, then one real GitHub Actions run whose secret-free subcode selects the actual auth fix. No OAuth token request without that proof |
| #308 cloud deployment | Development approved | Resolve `TASK_SCOPE_MISMATCH`, splitting docs and security code if needed. Any real cloud account, paid resource or production access is presented first with concrete requirements and cost. Not merged until the scope matches |
| #247, #251 protected automation and CI | Update, fix and resubmission approved | No merge on stale evidence. Protected-path, CI and trust-root checks apply |
| T0116, T0117, V3-T1034 and the other Founder-gated items in the V4.1 matrix | To be triaged by scope and risk | Development and merge or deployment authority are evaluated separately for T3 and protected tasks |

## 4. Non-escalation
This record cannot be cited to widen its own authority or anyone else's. Any change to `standing-authority.json`, the merge gate, rulesets or environments is a separate governance PR, reviewed and approved under the rules in force at that time.
