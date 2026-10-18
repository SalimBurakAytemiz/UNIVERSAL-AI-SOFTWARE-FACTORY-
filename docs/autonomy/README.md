<!-- //TR: Otonomi kurtarma hazırlık paketinin (P1-P6) korunmayan teslimat dizini; Founder yetkisi / Local re-seal gerektiren işler işaretlidir, uygulanmamıştır. -->

# Autonomy recovery — prep bundle (P0: "OTONOMİ SİSTEMİNİ TAMAMLAMA")

Non-protected deliverables for the 6-priority autonomy directive, based on `v7/integration @ e12dbdd`
(PR #9 UI-248 and PR #10 atomic lease both merged). **No protected trust-root file is modified by this
bundle.** Items that require Founder authority, Local re-seal, or admin apply are flagged, not executed.

| Priority | Deliverable | File(s) | Apply gate |
|---|---|---|---|
| P1 Merge gate | root cause + fix + Windows-600 s analysis; **coded merge gate (B4) implemented** | `MERGE-GATE-FIX.md`, `../../scripts/configure-integration-branch-protection.mjs`, `../../scripts/merge-via-gate.mjs` | **Local/admin** applies protection + runs the gate with `--apply` (Cloud never merges). |
| P2 Lease wiring | authority ask + **final line-anchored change scope** + **draft authority record** + **Local delegation** | `FA-LEASE2-AUTHORIZATION-REQUEST.md`, `FA-LEASE2-CHANGE-SCOPE.md`, `FA-LEASE2-AUTHORIZATION.DRAFT.json`, `LOCAL-MAINTAINER-DELEGATION.md` | **Founder** authority record (via governance) + **Local** re-seal/apply. |
| P3 Canonical backlog | DRAFT checkpoint + queue (nothing READY) | `backlog-drafts/` | promote only after FA-LEASE2 + READY/authority decision. |
| P4 Next-step engine | reference impl + executable proof (65/65 PASS) | `reference/` | import into core = FA-LEASE2. |
| P5 Parallel / single ownership | enforced by the lease's `createIfAbsent`/CAS; proven in P4 | `reference/README.md`, `FA-LEASE2-…` §4.2 | same as P4. |
| P6 72 h endurance | plan + entry gate + metrics (design only) | `ENDURANCE-72H-TEST-PLAN.md` | start only after P1–P5 verified. |

## Standing constraints honored

- Cloud does **not** get maintainer-only re-seal authority; `scripts/generate-trust-root.mjs` stays Local.
- No protected file edited, no branch-protection applied, no production queue activated, no task declared
  READY, no CLEAN self-declared, no test/validation/security rule weakened.
- No second implementer is assigned to a task Local owns; ownership is decided by the atomic lease, never by
  branch/commit presence alone.
- Nothing here is reported as working automation; the next-step engine is a reference with a passing proof,
  not wired production behavior.

## Evidence

- Next-step proof: `node docs/autonomy/reference/proof.mjs` (Node 24) → `SUMMARY: 65 passed, 0 failed`.
- End-to-end auto-advance loop proof (P0 success criterion): `node docs/autonomy/reference/loop-proof.mjs`
  (Node 24) → `SUMMARY: 19 passed, 0 failed` (start → hand to Local → auto-advance → dependent recovers → terminal AUTHORITY_REQUIRED; two-worker single ownership).
- FA-LEASE2 wiring acceptance proof (pre-staged red→green target for the gated wiring): `node docs/autonomy/reference/fa-lease2-wiring-acceptance.mjs` (Node 24) → `SUMMARY: 23 passed, 0 failed`. Exercises all six integration seams from `FA-LEASE2-CHANGE-SCOPE.md` (claim-before-dispatch/HELD-skip, renew/LOST-aborts-commit, release-on-terminal, verdict bind+rejections, `validateControl` claim-shape, token-never-logged) against the real lease + verdict modules. The protected-core wiring that makes these live is FA-LEASE2 (blocked on the Local D3 record).
- Live pipeline-state report: `node docs/autonomy/reference/next-step-report.mjs` (Node 24) → runs the real engine against the real backlog over a real git-ref store. Currently `engine=NO_READY_WORK`, `operator-classification=AUTHORITY_REQUIRED` — all 3 CLOUD candidates are `DRAFT_NOT_READY`, unauthorized, and dependency-blocked on FA-LEASE2 wiring. Read-only: takes no lease, declares nothing READY.
- Coded merge gate (B4): `node docs/autonomy/reference/merge-gate-proof.mjs` (Node 24) → `SUMMARY: 19 passed, 0 failed`. Proves `scripts/merge-via-gate.mjs` fail-closed: REFUSE unless both required CI contexts are `success` on the exact head SHA, the governed verdict is SHA/session/identity-bound CLEAN, the head is fast-forward over base, and there is no conflict. Evaluate-only by default; `--apply` (operator authority) performs the merge — Cloud never runs `--apply`.
- Canonical-backlog fail-closed validator (B5 safety): `node docs/autonomy/reference/backlog-validator-proof.mjs` (Node 24) → `SUMMARY: 14 passed, 0 failed`. `backlog-validator.mjs` enforces that a task may be `READY` only with a non-empty `authorizedBy` and all `dependsOn` DONE (else `UNAUTHORIZED_READY` / `READY_WITH_UNMET_DEP`), plus structure/owner/status/dup-id/dangling-dep integrity. It declares nothing READY; it only rejects unauthorized/invalid READY.
- Backlog drafts: valid JSON; re-derived from `e12dbdd`; nothing READY; no `authorizedBy`.
- Merge-gate script: syntax-checked; writes `.ai/runtime/INTEGRATION_BRANCH_PROTECTION.json` when a Local
  admin runs it.
