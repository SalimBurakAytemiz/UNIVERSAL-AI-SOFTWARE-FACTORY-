<!-- //TR: Ikinci toplu Founder karar listesi: dogrulanmis ama yetkisiz bagimsiz gorevler. Hicbiri READY degildir; Founder yazili onay verene kadar dispatch edilmez. Kaynak: e12dbdd koduna karsi 3 salt-okunur denetim (160 UI satiri + backend/test/tooling taramasi). -->

# Founder batch 2 — AUTHORITY_REQUIRED (nothing here is READY)

Recorded 2026-10-18 under "unattended maximum autonomy": these are verified, independent, non-protected, no-spend candidates, kept apart until the Founder approves by id. Approval = a written "APPROVED: <ids>"; the dispatcher then records `authorizedBy` and starts them. All were checked against `origin/v7/integration @ e12dbdd` (open PRs #22–#28 treated as taken).

## A. UI rows (read-only renderer, existing registered test files, no protected edit)
| Id | Task | Files | Test file | Risk | Notes |
|---|---|---|---|---|---|
| B2-UI-023 | Read-only mission/run status board toggle in `#/work` | `work-core.js` (pure groupByStatus), `views/work.js`, locales, `styles.css` | `tests/v7-b5-work-screens.test.ts` | 3 | uses GET `/v1/missions`,`/v1/work-runs`; no drag/transition POST; unknown status kept in its own column. Auditor caveat: queue/matrix already group by status → confirm intent |
| B2-UI-124 | Stop dialog shows live impact counts (active runs, blocked items) | `shell.js`, `model.js`, locales, `styles.css` | `tests/v7-ux-shell.test.ts` | 3 | GET `/v1/control/status`,`/v1/work-runs`,`/v1/founder-attention`; unreadable source shows "—" not 0; stop IPC unchanged; `index.html` not edited |
| B2-UI-246 | Contrast/token preview panel in Settings | `views/settings.js`, locales, `styles.css` | `tests/v7-ux-settings.test.ts` (registration to verify) | 3 | scope uncertain (design spec not in repo); local state only |

## B. Test / tooling gaps (no new authority, risk 1–2; each cites real file:line)
| Id | Task | File to add | Evidence |
|---|---|---|---|
| B2-T-APPROVAL | Unit tests for `assertApprovalValid` (≈10 throw branches) | `tests/authority-approval.test.ts` | `core/authority/approval.ts:19-37`; no direct test importer |
| B2-T-RESOLVER | Unit tests for `resolveCapability` | `tests/capability-resolver.test.ts` | `core/capabilities/resolver.ts:14-22` |
| B2-T-TEMPLATES | Unit tests for `renderTemplate` (every template, name sanitisation) | `tests/workos-project-templates.test.ts` | `core/workos/project-templates.ts:10` |
| B2-T-PREDEV | Unit tests for `applyPreDevEntry`/`phaseForKind`/`derivePreDevReadModel` | `tests/v7-core-predev-apply-readmodel.test.ts` | `core/workos/predev/apply.ts:21,56`; `read-model.ts:20` |
| B2-T-ACADEMY | Unit tests for academy `apply.ts` tamper/malformed paths | `tests/v7-academy-apply.test.ts` | `core/academy/apply.ts:13,60,86` |
| B2-T-COMPANY | Unit tests for `company/common.ts` + `apply.ts` | `tests/v7-company-common.test.ts` | `core/company/common.ts:14-20`; `apply.ts:8` |
| B2-T-SELFTESTS | vitest wrapper that runs the orphan `scripts/*selftest*.mjs` | `tests/selftest-orphans.test.ts` | scripts not referenced by package.json/CI (pre-check each passes first) |

Caveat for all new test files: `config/validation.json` (sealed) lists registered test files by name; a brand-new test file is **not** part of the sealed gate until a Local/governed reseal — it still runs under plain vitest. Extending an already-registered file avoids this.

## C. Larger / lower confidence
- B2-SBOM: offline CycloneDX SBOM step replacing `NOT_IMPLEMENTED` in `core/workos/security-tools.ts:284` (risk 3; Founder-visible stage contract).

## D. Infrastructure that needs authority (tracked separately; do not block A–C)
FA-LEASE2 D3 sealed record (separate-identity governance) · BACKLOG-SOURCE-REBASELINE · GitHub Actions: jobs die ~3 s after start with no steps/logs (never get a runner; likely billing/spending limit or runner policy — admin must check Settings → Billing and Actions → Runners/Policies) · Windows 600 s `tests` timeout (needs sharding change in sealed `config/validation.json`) · DEPENDENCY_AUDIT egress (Local/real-network D2) · Node 24 permanent: environment setup script must run `scripts/cloud-ensure-node24.sh` (PR #21).

## E. Rejected by audits (need endpoints/writes/protected files/backend data/spend/mobile — not startable)
~96 UI rows (e.g. UI-004 chat, 017, 039, 159, 210, 242, 251 app.js, mobile 097–104/174–179, finops 075/190/196, knowledge 063–069, tenancy 168/184) — listed per-row in the audit reports; none invented.
