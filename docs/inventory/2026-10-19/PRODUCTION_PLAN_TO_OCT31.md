<!-- //TR: 31 Ekim uretim plani: mevcut kaynaklarla gercekci kapsam; yeni yetki gerektirmeyen isler ile Kurucu/yonetici eylemi gerektiren isler ayri / Production plan to Oct 31 with realistic scope, split by authority -->

# Production plan to 2026-10-31

Today is 2026-10-19; 12 calendar days remain. The Oct-31 target is the M2 "operational Desktop" milestone of the stale `UASCO_DESKTOP_DELIVERY_ETA_2026-10-15.md`, which itself was P50 with low confidence. **Nothing is DELIVERABLE on current evidence**: 0 items PRODUCT_VERIFIED, 0 green Windows CI runs ever, 0 merges since 2026-10-18T05:09Z, 38 open PRs.

## Starting position (computed)

| Measure | Now |
|---|---:|
| Screens working today (integrated, unverified) | 85 of 246 |
| Screens fully wired on v7 | 23 |
| Screens product-verified | 0 |
| Screens on open PRs awaiting CI | 9 |
| Screens needing authority | 145 |
| Open PRs / awaiting CI or review | 38 / 35 |
| Platform tasks remaining | 90 of 107 |

## Resources and constraints

- Cloud Claude sessions (implementers, maintainer, hourly reviewer routine, orchestrator). No local PC, no new VM, no local runner, no paid resources (relayed directive).
- GitHub-hosted runners work at $0 only because the repository is public. If the Founder restores private visibility, the GitHub Free private-repo quota (2000/2000 used since about 2026-10-18 13:30Z) is exhausted for the current billing cycle and CircleCI Free becomes the only CI path; its limits and Windows availability were **not verified** by any auditor.
- One GitHub identity; no ruleset. Protected paths need Founder authority and a reseal.

## Track A: no new authority needed (cloud team can do now)

| Pri | Work | Tasks | Done when |
|---|---|---|---|
| P0 | Fix the Linux tests-2 hang and the 9 failing Windows steps in non-protected test/source files; keep diagnosis on `ci/diagnose-shards` | PT-004, PT-005, PT-018 | Each shard green on ubuntu and windows in a diagnosis run, logs attached |
| P0 | Fix the `/root` evidence redaction gap (`core/evidence/index.ts`) and make `pkg-t3` skip honestly | PT-017, PT-019 | Tests pass as root and without a global npm root |
| P0 | Re-review moved heads #11 `60cc112` and #16 `3c2bfee`; fix and re-review #50 (fail-open exit, head SHA binding) | PT-021, PT-051, PT-015 | Reviews bound to the current heads |
| P1 | Prepare `.circleci/config.yml` (Linux + Windows, Node 24, canonical `npm ci`, ordered shards, SHA-bound evidence) on a branch so that it is ready the moment the Founder connects CircleCI; it stays IMPLEMENTED_NOT_TESTED until a real run | PT-007 | File reviewed; no PASS claimed before a real run |
| P1 | Prepare merge waves (rebase plans, conflict resolutions for the route cluster, locale resolution #19/#20, studio test appends) without merging | PT-016 | Each wave's branch state documented with SHAs |
| P1 | Extend desktop-e2e from route render to live-data flows (create project, mission, run, evidence) as the product-verification protocol | PT-015 | Protocol reviewed; first screens with recorded evidence |
| P2 | Renderer-only screens (UI-003, 023, 077, 112, 126, 247, 252) behind `views/planned.js` delegates | screens DESIGN_ONLY | PRs with tests; parity still UNKNOWN_SOURCE |
| P2 | Dead-code cleanup and LOW advisories | PT-105, PT-104, PT-103 | PRs pending CI |

## Track B: needs Founder or admin action (decision first, then cloud work)

| Order | Decision / action | Unblocks | Tasks |
|---|---|---|---|
| 1 | Choose: keep the repo public with GitHub-hosted CI at $0, or restore private and connect CircleCI Free (install the CircleCI GitHub App with access to this repository only) | all CI, rulesets availability, #49 admissibility | PT-012, PT-007, PT-002 |
| 2 | Confirm or reissue `FD-PUBLIC-CI-2026-10-19` (protected `ci.yml`, `validation.json`, `trust-root-manifest.json`, `phase0-acceptance.mjs` reseal) or authorize the CircleCI equivalent | landing sharded CI | PT-003, PT-029 |
| 3 | Deregister self-hosted runner 21; set fork-PR workflow approval for the public repo | security | PT-011 |
| 4 | Apply a ruleset on `v7/integration` (required both-OS contexts, no bypass, no force-push) and approve the merge-gate CI-context binding | enforced merges | PT-023, PT-022 |
| 5 | Create a second approver identity (GitHub App or machine user, free) | independent approval | PT-024 |
| 6 | Name a reseal owner and serialize protected changes (#8, #49, FA-LEASE2, validation registrations) | protected changes | PT-029, PT-026, PT-032, PT-034, PT-079..086 |
| 7 | FA-V2-PRODUCT batch for `main.mjs` allow-list and `server.ts` endpoints: company writes, the 2 broken export IPCs, Work OS founder-attention, permissive gateway defaults | ~114 authority screens, G-EP-AR | PT-035, PT-106 |
| 8 | Confirm `authorizedBy` strings of the canonical backlog and issue the FA-LEASE2 D3 record | Cloud Development routine, dispatch | PT-051, PT-026, PT-039, PT-050 |
| 9 | Put the 252-screen design package, UX-DEC texts and SC blueprint in the repo (or an accessible store) | design parity for every screen | K-DESIGN |
| 10 | FD-REL-1 sandbox provider decision within the no-VM / no-billing rules | labs, dev-run, preview, mission COMPLETE | K-SBX |

## Status of the relayed request's first deliverables

See `PR_REVIEW_CI_MERGE_BOTTLENECKS.md`, section "The relayed request's first-delivery items". In short: no passing Windows cloud run exists (CircleCI not connected; GitHub-hosted windows fails everywhere); Linux passes on 7 PR heads but not on the v7 head; no head has a matching green pair; GitHub-hosted runs cost 0 ms billable because the repo is public; the merge-gate changes are PT-021..PT-024 and PT-029; runs already execute without the local PC, but runner 21 should be deregistered. The CI conversion therefore cannot be declared complete, and no pilot PR has passed on both OSes.

## Realistic scope by 2026-10-31

Judgement, confidence LOW. It assumes Track B decisions 1-6 land by about 2026-10-22 and the CI defects are fixable in non-protected files.

- **Likely achievable:** green `validate` on ubuntu and windows on `v7/integration` (via #49 or CircleCI); an enforced ruleset if the repo stays public; merge waves 1-4 (isolated PRs, docs stack, small renderer pairs, assurance stack), about 25-30 of the 38 open PRs, each with a final CLEAN bound to its head; post-merge verification of #1-#10; route-level desktop-e2e evidence on both OSes for the 19 v7 routes plus the merged PR routes.
- **Possible, not likely:** the full route cluster (#27, #28, #32, #33, #8) because it must be serialized with rebases and #8 needs a reseal; a first handful of screens moved to PRODUCT_VERIFIED if a live-data verification protocol is accepted and recorded.
- **Not deliverable by Oct 31:** the 145 AUTHORITY_REQUIRED screens unless decision 7 is granted early (even then only the allow-list subset); the 18 mobile screens; 24 of 25 labs; any role certification (0 of 3594 evaluations); phase closure (Phase 0 gate); CP-GOV Phase 1+ (paid KMS conflicts with the no-billing rule); Authenticode signing; design parity for any screen while the design package is off-repo.

## Risks

- Windows failures may need protected-path changes, which would serialize behind the reseal owner.
- Restoring private visibility removes the $0 GitHub-hosted path; CircleCI Free limits are unverified.
- The reviewer routine cannot run canonical validation (Node 22, no dependencies), so final verdicts depend on CI evidence.
- Legacy surfaces (`/v1/scheduler`, `/v1/runs`, `/v1/retry`) are OBSOLETE but PRs #27 and #33 build on them; a Founder keep/migrate/remove decision is pending.
