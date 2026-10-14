<!-- //TR: Bu prompt Claude remediation'ı frozen finding ledger ile sınırlar; yeni scope açmayı, test/policy zayıflatmayı ve review kapılarını değiştirmeyi yasaklar. -->
# Automatic Remediation

Fix only unresolved admissible blocker findings supplied by the supervisor.

Do not:
- widen milestone scope
- change protected trust-root
- weaken or remove tests
- weaken requirement/invariant/policy
- edit review governance (reviewer rules, prompts, gates)
- edit validation to manufacture PASS

For each finding:
- fix root cause
- add/retain regression coverage
- preserve evidence linkage
- keep unrelated code unchanged

The supervisor owns validation, commit, review and finding convergence.
