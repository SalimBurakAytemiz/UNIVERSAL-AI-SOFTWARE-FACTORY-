# Factory V2 / governance Founder decision file (independently verified by the V4.1 coordinator), 2026-11-10 ~06:05Z

main = e81ac373176247cd32e6c4ff9e82339c6c427ac1, verify-main **MAIN_PASS**. The coordinator did not write to the V2 branches.

## #355: FV2-T0002, T3, "authority fence in the canonical merge path" (Founder merge)
- head **083a78fe22e9314b1d9e7a191a9bae2d63bbf663**, base **e81ac373176247cd32e6c4ff9e82339c6c427ac1** (= main), base.ref v7/integration, not a draft.
- Required CI (on head): preflight, validate (ubuntu-latest), windows shard 1/2/3, validate (windows-latest) = **all success**.
- Independent review **5837178618** (session_015dYwb2tVU1fHo6ss2zAjRB): CLEAN, binding = exact head/base, `reviewAttestation` = **none**.
- Non-required "UASCO Independent Review" = FAIL (401 token, the known issue; not required).
- Scope (5 files): `docs/planning/autonomy/autonomy.mjs` (+6/-2), `docs/planning/autonomy/executor.mjs` (+14/-2), tests (+62).
- **Real authority effect (exact):**
  1. Every `executor merge` asks `mergeAuthority` (automation/factory-v2/v41-guard.mjs) before writing. No authority record (today: `uasco/registry` has only the lease doc.json, no `uasco-v7` authority file) → **V4.1 merges as today** (`NO_AUTHORITY_RECORD`). Once a record exists: the registry ruleset must be protected (today **26607801 UASCO-REGISTRY-PROTECTION: active, non_fast_forward + deletion, 0 bypass, current_user_can_bypass=never ✓**) + the signed history must verify. `V41_AUTHORITATIVE` → V4.1 merges; HANDOVER phase → **nobody merges**; `V2_AUTHORITATIVE` → V4.1 is fenced and only a merge with a signed V2 intent from the holder passes. If the registry is unreadable → BLOCK (fail-closed).
  2. `automation/factory-v2/` is added to `GOVERNANCE_PREFIXES` (+ v41-guard and its import closure join the trust files) → **from then on every PR touching `automation/factory-v2/` is FOUNDER_REQUIRED (GOVERNANCE_PATH).**
- Remaining blocker: none (only the Founder merge decision). After the merge: verify-main MAIN_PASS → #389 (stacked) is prepared.

## #408: FV2-T0005, T3, "LIVE wiring gated by the signed authority record (fail-closed, STANDBY)" (Founder merge)
- head **16c81f5b3ce559d5bde206706032bfb07035ffea**, base **e81ac373176247cd32e6c4ff9e82339c6c427ac1** (= main), base.ref v7/integration (retargeted), not a draft, **no STATE.json entry** (A′ cancelled).
- Required CI: **all success** (same 6 checks).
- Independent review **5837211650** (session_015dYwb2YWw7uqBRygTTbbGZ): CLEAN, exact head/base binding, attestation **none**.
- Scope (5 files): automation/factory-v2/{cli,control,identity}.mjs, docs/factory-v2/CONTROL-SESSION.md, tests/factory-v2/control.test.mjs. LIVE wiring opens only with a signed authority record; default STANDBY (does not start cutover by itself).
- Dependency FV2-T0004 (#388): actually merged (e81ac373, MAIN_PASS); STATE.json entry → via FV2-T0008 (#417).
- Remaining blocker: none (only the Founder merge decision).

## #417: governance, FV2-T0008 ledger writeback task (Founder merge)
- head **b4deaa0fead5e95e5c0c9e6cfbab77c7e3b5eb40**, base e81ac373 (= main). Independent review **5837339796** (session_015dYwb4kWZKWcEzz1FUWT2V) CLEAN, attestation none. **Required CI: running** → not yet "mergeable".

## Sequencing note
- **#409 (FV2-T0006, T2) changes 6 files under `automation/factory-v2/`. After #355 merges it can NO LONGER be routine AUTO_MERGE: GOVERNANCE_PATH → FOUNDER_REQUIRED.** That is the natural result of #355's design, not a gate loosening; #409 then also becomes a Founder merge decision.
