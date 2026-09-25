<!-- //TR: Bu dosya dependency-free full-system re-audit tamamlandıktan sonraki canonical environment/dependency/release sırasını verir; final closure iddiası taşımaz. -->
# Next Actions
1. Current scope: `ENVIRONMENT_GATE_NODE24_NPM11_REGISTRY_REVIEWED_LOCK_DEPENDENCY_AWARE_VALIDATION`.
2. Require Node >=24, npm >=11 and reachable `registry.npmjs.org`; do not generate the reviewed lock on an unqualified environment.
3. Create and independently review `package-lock.json`, then run canonical `npm ci`, dependency supply-chain checks, `npm audit`, SBOM generation/review, Ajv2020 runtime-schema conformance, typecheck, Vitest and full dependency-aware regression.
4. Remediate every newly discovered P0/P1/P2 with adversarial proof and regression before any closure claim.
5. Only after dependency-aware closure: final trust-root reseal -> SHA256SUMS -> external-key detached release signature -> FINAL ZIP -> fresh-extract verification -> target-machine Phase0.
6. Keep `SOURCE_LEVEL_CLOSURE=false`, `TARGET_MACHINE_PHASE0=PENDING`, `FINAL_TRUST_ROOT_SEAL=STALE_PENDING_FINAL_RESEAL`, and `FINAL_ZIP=NOT_DONE` until their physical gates complete.
