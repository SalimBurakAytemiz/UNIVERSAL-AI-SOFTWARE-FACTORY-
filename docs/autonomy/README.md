<!-- //TR: Otonomi kurtarma hazırlık paketinin (P1-P6) korunmayan teslimat dizini; Founder yetkisi / Local re-seal gerektiren işler işaretlidir, uygulanmamıştır. -->

# Autonomy recovery — prep bundle (P0: "OTONOMİ SİSTEMİNİ TAMAMLAMA")

Non-protected deliverables for the 6-priority autonomy directive, based on `v7/integration @ e12dbdd`
(PR #9 UI-248 and PR #10 atomic lease both merged). **No protected trust-root file is modified by this
bundle.** Items that require Founder authority, Local re-seal, or admin apply are flagged, not executed.

| Priority | Deliverable | File(s) | Apply gate |
|---|---|---|---|
| P1 Merge gate | root cause + fix + Windows-600 s analysis | `MERGE-GATE-FIX.md`, `../../scripts/configure-integration-branch-protection.mjs` | **Local/admin** runs the script (not Cloud). |
| P2 Lease wiring | exact protected files + wiring contract + authority ask | `FA-LEASE2-AUTHORIZATION-REQUEST.md` | **Founder** authority + **Local** re-seal. |
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
- Backlog drafts: valid JSON; re-derived from `e12dbdd`; nothing READY; no `authorizedBy`.
- Merge-gate script: syntax-checked; writes `.ai/runtime/INTEGRATION_BRANCH_PROTECTION.json` when a Local
  admin runs it.
