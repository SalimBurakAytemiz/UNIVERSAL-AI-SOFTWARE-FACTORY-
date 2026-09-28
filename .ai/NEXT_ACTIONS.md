<!-- //TR: Bu dosya dependency-aware environment gate kapandıktan sonraki canonical target-machine/provider/release sırasını verir; final closure iddiası taşımaz. -->
# Next Actions
1. Current scope: `TARGET_MACHINE_PHASE0_ACCEPTANCE_AND_LIVE_PROVIDER_SMOKE`.
2. Resolve open P1 `TRUST-F1` (Founder decision; protected `automation/lib/trust-root.mjs`): protected filename prefixes such as `scripts/validate-` must actually protect the validators in the change guard and the trust-root manifest.
3. Resolve PKGA-F8 on the target machine: start the Windows Time service and decide the 16 GB preflight memory threshold (Founder decision; the policy is protected).
4. Run the live provider smoke (`scripts/provider-smoke.mjs`) through the Claude builder and Codex reviewer brokers with `STANDALONE_LAUNCHER` provenance.
5. Run `scripts/install.ps1` end to end on the target machine, including evidence signing key initialization and ACL hardening, remote protection, Electron provisioning and Control Tower smoke, and obtain a CLEAN or CLEAN_LOCAL_ONLY `PHASE0_ACCEPTANCE.json`; steps that change system settings, credentials or remotes require explicit Founder approval.
6. Only after Phase0: final trust-root reseal -> SHA256SUMS -> external-key detached release signature -> FINAL ZIP -> fresh-extract verification.
7. Keep `SOURCE_LEVEL_CLOSURE=false`, `TARGET_MACHINE_PHASE0=PENDING`, `FINAL_TRUST_ROOT_SEAL=STALE_PENDING_FINAL_RESEAL`, and `FINAL_ZIP=NOT_DONE` until their physical gates complete.
