<!-- //TR: V4.1 → Factory V2 devir defteri. Açık PR'lar, HELD dallar, Builder oturumları ve görev sahiplikleri tam SHA ile kayıtlıdır; V2 yalnız imzalı devirden sonra bu kayıttan devralır. -->
# V4.1 → Factory V2 handover ledger

- Recorded at: 2026-11-05 ~19:30Z by the V4.1 coordinator (session_015dYwazi7LHFCg3dABbSW2P). It remains the only Supervisor until a signed handover.
- Base: `v7/integration` = `59c06dd76934585e57e160967200f4b8fc472aa9` (after #362).
- Files:
  - `open-prs.json`: every open PR with its head SHA, task, owner, owner session, reviewer session and gate classification.
  - `held-branches.json`: HELD branches with remote SHAs.
  - `CI-BOTTLENECK-AND-REVIEW-401.md`: CI measurements and the review-workflow proposal.
- Classification:
  - ROUTINE: the task ID passes the executor gate (`autonomy.mjs decideAutoMerge`); it auto-merges after CI plus an exact HEAD/BASE CLEAN binding.
  - FOUNDER_REQUIRED: no ID, an uppercase subtask ID, or a task that is SPLIT/BLOCKED/DEFERRED/UNVERIFIABLE or has an unmerged dep.
  - V2_OWNED: Factory V2 PRs. V4.1 does not touch them.

## Builder sessions and ownership

| Builder | Session | Open PRs | HELD branches |
|---|---|---|---|
| A | session_015dYwb21d58Ys4LtirPo4Mz | #363, #327 | 5 |
| C | session_015dYwazZccTReW5Rs2mAhq3 | #403, #400, #399, #396, #380, #367, #360 | 10 |
| D | session_015dYwb2SnQF4VdDrbv6gC6n | #398, #391, #378, #369, #361, #339 | 4 |
| E | session_015dYwb251iBPt3c4oBT7zpK | #390, #386, #381, #374, #372, #364 | 3 |
| F | session_015dYwazjbdD1dqxxCrYSpgh | #385 | 3 |
| G | session_015dYwb1WPfNEE3SrZ52qm7F | #402, #395, #394, #392, #384, #368 | 7 |
| H | session_015dYwb57pxAry59xkxbE6NL | #387, #383, #379, #373, #366 | 3 |
| I | session_015dYwb2F7BNWaAJn1Uad5FN | #401, #397, #393, #382, #377, #375, #371, #370 | 7 |

## Open PRs

| PR | Owner | Task | Head | Classification |
|---|---|---|---|---|
| #282 | COORD/LANE | none | `5d66b0336fab` | FOUNDER_REQUIRED (no task id) |
| #327 | A | V3-T1012.a | `6d388ceed6e8` | ROUTINE |
| #339 | D | UASCO-T0042 | `c6cde35690c2` | ROUTINE |
| #341 | COORD/LANE | V3-T1034 | `011abbb5cbbb` | DRAFT |
| #343 | COORD/LANE | CLOUD-T0005 | `5bd65a397c4a` | FOUNDER_REQUIRED (dep CLOUD-T0004) |
| #347 | V2 | none | `89b95f75565d` | V2_OWNED (not V4.1) |
| #351 | COORD/LANE | none | `6ad7e0893b99` | FOUNDER_REQUIRED (no task id) |
| #354 | V2 | none | `f43c679432d1` | V2_OWNED (not V4.1) |
| #355 | V2 | none | `bbcf4edeb8ad` | V2_OWNED (not V4.1) |
| #356 | V2 | none | `1a73bf66d7d8` | V2_OWNED (not V4.1) |
| #360 | C | V3-T1016 | `ee770cc2e336` | ROUTINE |
| #361 | D | CLOUD-T0016 | `140d3fd73f7e` | FOUNDER_REQUIRED (task unknown) |
| #363 | A | V3-T1027 | `5ec09add0b6b` | FOUNDER_REQUIRED (task SPLIT) |
| #364 | E | UASCO-T0005 | `136acf69b8c5` | ROUTINE |
| #366 | H | UASCO-T0012 | `bfd994ddbd56` | ROUTINE |
| #367 | C | UASCO-T0083 | `41b4461e1730` | FOUNDER_REQUIRED (task SPLIT) |
| #368 | G | none | `03208b24fb09` | FOUNDER_REQUIRED (no task id) |
| #369 | D | UASCO-T0042 | `95f2f58fef95` | ROUTINE |
| #370 | I | UASCO-T0007 | `f00b2c55a549` | FOUNDER_REQUIRED (task SPLIT) |
| #371 | I | none | `b05d71fad5a5` | FOUNDER_REQUIRED (no task id) |
| #372 | E | UASCO-T0011 | `55d7f1d24d8f` | FOUNDER_REQUIRED (task SPLIT) |
| #373 | H | UASCO-T0013 | `3272b78a1e1f` | ROUTINE |
| #374 | E | UASCO-T0020 | `6e67dc4758e0` | FOUNDER_REQUIRED (task SPLIT) |
| #375 | I | none | `c335e604fbc3` | FOUNDER_REQUIRED (no task id) |
| #377 | I | none | `a462d629d28f` | FOUNDER_REQUIRED (no task id) |
| #378 | D | UASCO-T0067 | `2d0f5b550779` | ROUTINE (re-review #4) |
| #379 | H | none | `0e3d099c23f7` | FOUNDER_REQUIRED (no task id) |
| #380 | C | V3-T1032 | `8a496aa11036` | ROUTINE |
| #381 | E | UASCO-T0011 | `24f914bf69d8` | FOUNDER_REQUIRED (task SPLIT) |
| #382 | I | none | `aa4e0e056539` | FOUNDER_REQUIRED (no task id) |
| #383 | H | none | `e58179c0302b` | FOUNDER_REQUIRED (no task id) |
| #384 | G | UASCO-T0015 | `b0020bab3df2` | ROUTINE |
| #385 | F | none | `aff946279eeb` | FOUNDER_REQUIRED (no task id) |
| #386 | E | UASCO-T0004.A | `97e8935c3b30` | FOUNDER_REQUIRED (id UASCO-T0004.A refused by gate regex) |
| #387 | H | UASCO-T0006 | `a9315518e628` | ROUTINE |
| #388 | V2 | none | `8f2a561e4c5d` | V2_OWNED (not V4.1) |
| #389 | V2 | none | `ac187d662df5` | V2_OWNED (not V4.1) |
| #390 | E | UASCO-T0016.A | `6c3933c9cbeb` | FOUNDER_REQUIRED (id UASCO-T0016.A refused by gate regex) |
| #391 | D | UASCO-T0129 | `d15ed7170345` | ROUTINE |
| #392 | G | UASCO-T0006 | `2f16b8e50213` | ROUTINE |
| #393 | I | UASCO-T0006 | `6776947cea64` | ROUTINE |
| #394 | G | UASCO-T0006 | `7c48985b087e` | ROUTINE |
| #395 | G | UASCO-T0006 | `0b70484a2992` | ROUTINE |
| #396 | C | UASCO-T0124 | `7e7d0158e086` | FOUNDER_REQUIRED (V4.1 matrix: supervisor register task) |
| #397 | I | none | `df2f0d3c2f2a` | FOUNDER_REQUIRED (no task id) |
| #398 | D | UASCO-T0088 | `1ded4b6d7059` | FOUNDER_REQUIRED (dep V3-T1001,V3-T1002) |
| #399 | C | UASCO-T0083 | `00aeffede3f7` | FOUNDER_REQUIRED (task SPLIT) |
| #400 | C | UASCO-T0081 | `3916b44f2378` | FOUNDER_REQUIRED (task BLOCKED) |
| #401 | I | UASCO-T0006 | `be33322036f6` | ROUTINE |
| #402 | G | UASCO-T0006 | `fcdfce9897cd` | ROUTINE |
| #403 | C | UASCO-T0111 | `9b5740a2e7c2` | DRAFT |
| #404 | G | UASCO-T0006 | `d548583451e0` | ROUTINE (CLEAN, merge loop) |

## HELD branches

| Owner | Branch | Task | Head | Note |
|---|---|---|---|---|
| A | `claude/builder-a-v3-t1027-skip` | V3-T1027 | `df7af076c653` | skip-links (on L2 64dd102f); SPLIT→Founder |
| A | `claude/builder-a-uasco-t0019-titles` | UASCO-T0019 | `9eb159b9fb1a` | mission titles (on skip df7af076) |
| A | `claude/builder-a-uasco-t0019-bell` | UASCO-T0019 | `2297c3410245` | shell bell (on titles 9eb159b9) |
| A | `claude/builder-a-uasco-t0019-notify` | UASCO-T0019 | `5d6907de3784` | notifications (on #363) |
| A | `claude/builder-a-v3-t1027-l2` | V3-T1027 | `64dd102f46ce` | L2 |
| C | `claude/builder-c-t0049-attention` | UASCO-T0049 | `55c0bef9878b` | RESUME_RUN nextAction (dep V3-T1016) |
| C | `claude/builder-c-t0083-resume-run-parse` | UASCO-T0083 | `6e3da0ad9b78` | mobile parse (on #367) |
| C | `claude/builder-c-t0083-connection-state` | UASCO-T0083 | `c87c31f33c15` | mobile connection state (on parse) |
| C | `claude/builder-c-v3-t1027-kpi-honesty` | V3-T1027 | `4dfac9beaa9f` | cockpit KPI tests (on A titles) |
| C | `claude/builder-c-cockpit-kpi-honesty` | superseded-by | `5e553d73045b` | kpi-honesty (same tree) |
| D | `claude/builder-d-t0067-sameline` | UASCO-T0067 | `b3ae8f2cd17a` | folded into #378 |
| G | `claude/builder-g-t0006-real-bridge` | UASCO-T0006 | `9a3693d34e56` | shared real-bridge helper (on workforce-f1) |
| G | `claude/builder-g-t0006-real-bridge-migrate` | UASCO-T0006 | `3e0fbcbe2859` | migration (merge of assurance-f1+rw053-f1) |
| G | `claude/builder-g-v3-t1012-delivery-lockfile` | V3-T1012 | `4b96758d0f73` | Founder-tier (PROPOSED); was local-only, patch-id 7aa51b6c |
| G | `claude/builder-g-v3-t1012-pm-lockfiles` | V3-T1012 | `1a3a0536692e` | Founder-tier; on 4b96758d (original parent 3b8e5398 not on any remote), patch-id d649737d |
| G | `claude/builder-g-t0006-provider-config` | UASCO-T0006 | `9f065e0d8b2c` | AI provider NOT_CONFIGURED (on #368) |
| I | `claude/builder-i-374-safe` | none | `7dbc56fa235b` | raw-sink superset (merge last) |
| I | `claude/builder-i-approval-gate` | none | `9d21537e4d9d` | approval gate (on 374-safe) |
| I | `claude/builder-i-cloud-sink-guard` | none | `1f195e72859c` | static guard (on approval-gate) |
| I | `claude/builder-i-t0006-wizard` | UASCO-T0006 | `293d01fbbebe` | wizard environmentId fix (PR pending basemerge) |
| C | `claude/builder-c-t0043-quota-classify` | UASCO-T0043 | `2ecd36dcb81e` |  |
| C | `claude/builder-c-t0048-global-stop` | UASCO-T0048 | `e56b9f173733` |  |
| C | `claude/builder-c-t0049-pause` | UASCO-T0049 | `93cfcf079370` | dep V3-T1016 |
| C | `claude/builder-c-t0049-resume` | UASCO-T0049 | `998c0ef67fd8` | dep V3-T1016 |
| C | `claude/builder-c-v3-t1016-n1` | V3-T1016 | `2bed3b758522` | on #360 |
| D | `claude/builder-d-intake-product-profile` | ? | `17b16f05fde5` | on #381 |
| D | `claude/builder-d-par03-scenario-fire` | ? | `6d2d44d23f0a` | on #339 |
| E | `claude/builder-e-attention-flags` | ? | `a5b1a18b4b29` | INTAKE_AUTHORITY_FLAGGED; follow-up: ATTENTION_GROUP mapping (A) |
| E | `claude/builder-e-command-field-on-364` | ? | `232088716935` | #372 merged into #364 |
| E | `claude/builder-e-reconnect-f1` | UASCO-T0004.A | `3bb7bf21bf52` | on #386 |
| F | `claude/builder-f-a11y-2` | ? | `32eb0aba865c` |  |
| F | `claude/builder-f-polish-2-2` | ? | `a9f48863284d` |  |
| F | `claude/builder-f-polish-3-2` | ? | `11c08cad0af6` |  |
| G | `claude/builder-g-e2e-delivery` | ? | `6f96e70afd62` | on #384 |
| G | `claude/builder-g-rw053-f1` | UASCO-T0006 | `39fd8561181c` | on #392 |
| G | `claude/builder-g-t0006-assurance-f1` | UASCO-T0006 | `3abd8fd4f353` | on #395 |
| G | `claude/builder-g-t0006-workforce-f1` | UASCO-T0006 | `bbcf64cc7980` | on #394 |
| H | `claude/builder-h-373-f1` | ? | `80ce14b9a76b` | on #373 |
| H | `claude/builder-h-379-nb` | ? | `a386d43ec8ec` | on #379 |
| H | `claude/builder-h-tour-a11y` | ? | `bf2fed4bc184` | on #387 |
| I | `claude/builder-i-371-safe` | none | `cc3db0cb342a` | on #371 |
| I | `claude/builder-i-377-safe` | none | `f8ff0ae1487f` | on #377 |
| I | `claude/builder-i-382-safe` | none | `c2297f457418` | on #382 |
| D | `(not pushed; patch held by coordinator)` | UASCO-T0117 | `71acc4cf (builder local), code patch sha256 d9e380ad, expected tree 26eec82b` | routine prompts; coordinator to read prompts before capture; exclude trig_01BiCM (contains e-mail) |

## In-flight at record time
- Merge loop (serial, single writer): #360 #391 #387 #392 #393 #394 #395 #401 (#396 removed: supervisor register task per the V4.1 matrix). Base-merged onto 59c06dd7; re-binds requested from each reviewer; waiting on Windows CI.
- #378: 82a82662 CLEAN; the 1/17 ratio-test flake was fixed by D's de-flake → 2d0f5b55 (patch-id b126253e, relfx-2 16/16 ×5), re-review #4 requested.
- #402: CLEAN on 3c824257; needs a base merge and a re-bind.
- The I wizard fix (claude/builder-i-t0006-wizard): needs a base merge, then a PR and a review.
- D T0117 routine prompts: held. The coordinator must read the prompts before capture, and exclude trig_01BiCM.
- Older ROUTINE PRs not in the loop (#327, #339, #364, #366, #369, #373, #380, #384): CLEAN on older bases. They are base-merged lazily, one or two at a time (Windows CI budget).
- Known defect follow-ups:
  - The classic project-register form claims 'optional env / server default'; it needs a fix after #375.
  - The tools-panel data attribute (LOW).
  - Above 500 runs, work-core keeps the oldest 500 (#402 review note; G's assurance work in progress).

## Handover protocol (proposed)
1. When the signed handover starts, the coordinator stops new work distribution. In-progress builder work is recorded with SHAs (push or patch). Anything not pushed is listed as at risk.
2. The coordinator stops the merge loop. Nothing merges during the transfer.
3. V2 verifies every SHA in this ledger against the remote (`git ls-remote`) and acknowledges.
4. Authority transfers only on the Founder's signed instruction. Until then V4.1 remains the only Supervisor.
