<!-- //TR: Founder'a tek seferde sunulan, kod kanitiyla dogrulanmis bagimsiz gorev adaylari; hicbiri onay olmadan READY degildir. Kaynak: eski SCREEN_TRACEABILITY CSV (veri, yetki degil) e12dbdd kodu ile karsilastirildi. -->

# Founder batch approval request — 2026-10-18

**Status 2026-10-18: Founder APPROVED all four lanes (in-session); now IN_PROGRESS, see BACKLOG_CHECKPOINT.json.**

Source: stale `SCREEN_TRACEABILITY_252_PLUS.csv` (data only) cross-checked against `v7/integration @ e12dbdd` by three read-only audits (47 rows examined). **Nothing below is READY**; approval = Founder writes "APPROVED: <lane ids>" and the dispatcher records `authorizedBy`.

Result of the audit: of 47 rows, ~19 are already implemented, ~21 need new endpoints / write actions / protected-file edits / backend data (not startable), and **7 rows are genuine, read-only, non-protected gaps**, grouped into 4 file-disjoint lanes. All lanes touch `locales/en.js`+`tr.js`+`styles.css` in separate hunks, so merge order must be serialized by the reviewer, not the implementers.

| Lane | Rows | Files | Test file (already registered) | Risk | Notes |
|---|---|---|---|---|---|
| L-WORKFORCE | UI-197 cluster→guild taxonomy | views/workforce.js, locales, styles.css | tests/v7-ux-wp-agents.test.ts | 2 | derived only from `clusterId/guildId` in `/v1/roles`; no "genome" fields invented |
| L-TOWER-TRACE | UI-226 stage timeline | views/tower.js, new trace-core.js, locales, styles.css | tests/v7-ux-wp4-tower.test.ts | 2 | labelled "stage timeline", not a trace; events without timestamp listed as unplaced |
| L-ASSURANCE | UI-049 → UI-050 → UI-051 (sequential, same files) | views/assurance.js, assurance-core.js, api.js, locales, styles.css | tests/v7-ux-wp-qasec.test.ts (registration to be confirmed by implementer) | 2–3 | UI-049 `GET /v1/reviews[/:id]`; 051 shows NOT_EXECUTED unless evidence exists |
| L-ROUTES | UI-070 audit trail → UI-078 integrations (sequential: both edit routes.js/planned.js/api.js) | new views/audit.js, audit-core.js, views/integrations.js, integrations-core.js, routes.js, planned.js, api.js, locales, styles.css | tests/v7-ux-operations.test.ts / v7-ux-matrix.test.ts | 3 | UI-078: response shapes of `/v1/capabilities`,`/v1/adapters`,`/v1/fabrics` not yet verified; route-count tests may need updates |

Honest limits: new routes (L-ROUTES) may need nav/test registration in sealed files (`app.js`, `config/validation.json`) which are protected — the implementer must stop and report instead of editing them. Tests live in existing vitest files; they are not part of the sealed validation until a Local reseal.

## Not startable (need authority/backend; listed once, not dispatched)
New endpoint / write / protected: UI-017, 039, 159, 210, 242, 003 (protected state), 251 (app.js), 172, 178, 180. Missing backend data: UI-038, 062, 136, 154, 164, 170, 181, 191, 194, 206, 221, 222, 231. Conflict: UI-074 / UI-191 / UI-164 with open PR #8.

## Infrastructure items (tracked separately, do not block lanes above)
FA-LEASE2 D3 record (separate-identity governance) · BACKLOG-SOURCE-REBASELINE · GitHub Actions outage (admin) · Windows 600 s `tests` timeout (Local sharding PR) · DEPENDENCY_AUDIT egress (Local D2) · Cloud env Node 24 (PR for `.nvmrc` + `scripts/cloud-ensure-node24.sh`; environment setup-script setting is the owner's).

## PR relationships (recorded, none closed)
- #17 (`claude/cp-queue-remediation`, 21f4094) supersedes #14 (`claude/cp-queue`, 86b6648): same task CP-QUEUE + fixes for review findings 1–5.
- #18 (`claude/cp-report-remediation`, d100910) supersedes #13 (`claude/cp-report`, b08e319): same task CP-REPORT + fixes for findings 1–5.
- #13/#14 stay open until their owner or an independent reviewer decides; no close/invalidate without verified ownership.
