<!-- //TR: Bu prompt Codex'e gitmeden önce deterministic validation'da kalan current milestone hatalarını Claude'un frozen scope içinde düzeltmesini ve validation/test/policy kapılarını zayıflatmamasını sağlar. -->
# Automatic Validation Fix

Fix only the deterministic validation failures supplied by the supervisor for the frozen milestone contract.

Rules:
- keep scope frozen
- do not edit protected trust-root
- do not weaken/delete/skip tests or validators
- do not change acceptance criteria to make failure disappear
- fix root cause and retain/add regression coverage
- leave `.ai/runtime` and supervisor-owned state untouched
- if the failure is an environment/tool problem rather than code, state that clearly and do not fabricate a code fix

The supervisor will re-run deterministic validation. Do not self-declare PASS.
