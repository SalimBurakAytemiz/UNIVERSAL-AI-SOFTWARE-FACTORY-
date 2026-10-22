<!-- //TR: LANE-C yetki talebi: rol değerlendirme hattı kanıtının terfisi ve scripts/validate-role-registry.mjs FA-WFR-03 değişmezinin daraltılması korumalı bir koordinatör toplu PR'ı gerektirir. -->
# LANE-C authority request: governed role evaluation pipeline (C-EVAL-PIPELINE)

Coordinator-approved package. It builds the pipeline whose absence the protected validator names (`FA_WFR03_EVALUATIONS_EXECUTED: no governed evaluation pipeline exists`). **It does not raise TESTED.** Today the registry says tested 0 / certified 0 and that stays true until the two protected steps below are taken on purpose.

## What exists after this package
- `core/competency/evaluation-pipeline.ts`: `runRoleEvaluation(deps, roleId, "EV-01")`. It checks the role binding, runs ONE defined procedure on the real executor adapters, computes the verdict only from deterministic oracle checks (model text never decides), and stages the evidence in the verifier's exact format.
- `scripts/run-role-evaluation.mjs` (+ `core/competency/evaluation-cli.ts`): the operator CLI.
- Procedures (all `EV-01 ROLE_SPECIFIC_GOLDEN_MISSION`; the registry spec text is NOT in this repository, so each procedure states what it covers and does not cover and says so in the evidence):
  - `golden-file-v1` (developer UASCO-0085): follow a precise single-file mission. Oracle: the engine-owned commit exists, only `greeting.txt` was added, its bytes are exactly `hello\n`, regular file, within the role's file limit.
  - `golden-review-v1` (security-reviewer UASCO-0252): CLEAN with no findings for a trivially correct diff, BLOCKED with at least one finding for a planted command injection, review clone left untouched.
  - `golden-predev-v1` (pre-dev primaries 0022, 0023, 0019, 0043, 0031; uses the #205 `ClaudePreDevBuilder`): the existing artifact validators accept the output for the TaskHub reference brief and approved upstream.
  - Every other role/evaluation (tester, delivery, 590 unbound roles, EV-02..EV-06) is refused with `NO_PROCEDURE` / `ROLE_NOT_EXECUTABLE`: there is nothing honest to run.
- Outcomes: `EVALUATED` (PASSED/FAILED, evidence staged), `NOT_EXECUTED` (infrastructure: timeout, abort, non-zero exit, profile/provenance/workspace refusal, no builder, invalid review; **nothing is staged**, the role is neither lifted nor penalised) or `REFUSED`. Builder refusals that are the role's own behaviour (no change, touched `.git` or agent config, forbidden path) are `FAILED`.

## Safety properties (each pinned by a test and a mutation check)
- Staging root is `<Work OS data dir>/evaluations/staging` (fixed; the CLI has no output-path flag). It must resolve **outside** the repository and not be an ancestor of it; symlinks (root, any component below it, the role dir, a pre-existing target file) are refused; names are fixed (`EV-0n.json`, `EV-0n.artifact.json`), role/evaluation ids are validated, nothing is ever overwritten (atomic `link`; an existing or partial pair is refused BEFORE the executor starts). The pipeline never writes to `audit/evidence/**`, `registries/**` or any repo path, and never edits a registry status.
- `executorKind` is the pair's own kind, never a caller input. A FAKE pair always produces `executorKind:"FAKE", fake:true`, which `createEvidenceVerifier` rejects (`FAKE_EVIDENCE`); the pipeline reports `verifier.countsIfPromoted`.
- Artifact and evidence files are secret-redacted (hash binds the redacted bytes).
- CLI: dry run by default (prints plan + `executeBlockers`; no process, no file, not even the staging dir). `--execute` is refused unless: not in `CI` / `GITHUB_ACTIONS`; `config/automation.json` `allowPaidApi` is exactly `false`; LOCAL_CLAUDE is enabled by the Founder (persisted setting or the explicit env selection, same `ExecutorSetup` state) and READY (provenance PASS, launcher sha256 unchanged). Then it builds the pair only from `LocalClaudeExecutors` (reviewer profile, no personal-profile fallback). CI never runs it.

## Operator run (Founder; real model; never in CI)
```
node scripts/run-role-evaluation.mjs --role UASCO-0085 --data-dir <Work OS data dir>            # dry run
node scripts/run-role-evaluation.mjs --role UASCO-0085 --data-dir <Work OS data dir> --execute  # real run
```
Evidence lands in `<data dir>/evaluations/staging/audit/evidence/role-evaluations/<roleId>/EV-01.json` (+ `.artifact.json`). To re-run, the staged pair must be moved away deliberately.

## Protected changes requested (NOT made by Lane C)
1. **Promotion** (reviewed evidence only): copy `<staging>/audit/evidence/role-evaluations/<roleId>/` verbatim into the repo's `audit/evidence/role-evaluations/<roleId>/` (the artifact path inside the evidence is already the final repo path, so the hashes stay valid), then in `registries/role-definitions.json` set that spec's `status` to the evidence verdict (`PASSED`/`FAILED`) and `evaluatorEvidenceRef` to the staged `evidenceRef`, and update the header `counts.evaluationSpecsExecuted`. Review the evidence `procedure.covers/doesNotCover` and decide whether it satisfies the spec; the spec text is not available to the pipeline.
2. **Narrow the validator invariant** in `scripts/validate-role-registry.mjs`: today `faWfr03Invariants.evaluationSpecsExecuted: 0` rejects ANY executed spec. Replace it by: an executed spec is allowed only when its evidence passes `evidenceProblem` **and is not FAKE**. NOTE `evidenceProblem` in that script does **not** reject `executorKind:"FAKE"` / `fake:true` today (only `createEvidenceVerifier` in `core/agents/role-lifecycle.ts` does): add the same rejection there, otherwise FAKE-stamped evidence would pass the validator once the invariant is lifted. The `certified` and `runtimeReadyOrRunning` invariants stay at 0.
3. Reading of the counter after promotion: `tested` = a spec that is not `NOT_EXECUTED` with verified, non-FAKE evidence. It means "executed", not "passed" (a verified FAILED run also counts as tested); the verdict is in the spec status. `certified` is unaffected and still needs all six specs PASSED plus a reviewer approval.

## Residual: NOT_VERIFIED
- No real model has run any procedure. Real implementer/reviewer/builder behaviour (including the edit-only implementer's workspace scan and the reviewer profile) is exercised only through injected fakes in CI.
- Each procedure is a small golden mission; a PASS shows precise single-file following / one planted defect found / schema-valid reference artifact, not general competence, recall or quality. `doesNotCover` is written into every evidence file.
- The pre-dev procedure uses the TaskHub reference fixtures (test-grade, not a verified project).
- Windows symlink refusal is not tested (symlink tests are skipped on win32).

## Tests that prove it
`tests/v7-wfr03-role-registry.test.ts`, describe "LANE-C C-EVAL-PIPELINE ..." (verdict oracles, FAKE stamping, infrastructure vs role failures, refusals, no-overwrite, staging confinement incl. symlinks, redaction, lifecycle counting with the real verifier and tamper cases, CLI dry run / blockers / execute).
