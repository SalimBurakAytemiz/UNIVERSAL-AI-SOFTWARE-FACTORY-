<!-- //TR: Bu dosya açık P0/P1/P2 bulgusu kalmadıktan sonraki canonical final reseal/paketleme/target-machine Phase0 sırasını verir; final closure iddiası taşımaz. -->
# Next Actions
1. Current scope: `FINAL_RESEAL_PACKAGING_THEN_TARGET_MACHINE_PHASE0`.
2. Release packaging package (Founder-authorized, protected, independent Codex review): a `SHA256SUMS.txt` generator, a deterministic final ZIP and fresh-extract verification with the existing `scripts/verify-artifact.mjs` / `scripts/verify-artifact.ps1`.
3. Final trust-root reseal inside that package with the maintainer-only `scripts/generate-trust-root.mjs`, only after every source change is committed and CLEAN.
4. Generate `SHA256SUMS.txt` over the resealed tree.
5. Founder signs the release with their external key (detached signature); Claude never holds or uses that key.
6. Build the final ZIP and verify a fresh extract (artifact integrity, trust root, lockfile membership).
7. Run `scripts/install.ps1` on the fresh extract for target-machine Phase0, including evidence signing key initialization and ACL hardening, remote protection, Electron provisioning, Control Tower smoke and autostart, and obtain a CLEAN or CLEAN_LOCAL_ONLY `PHASE0_ACCEPTANCE.json`. `install.ps1` starts with `verify-artifact.ps1`, which requires `SHA256SUMS.txt`, so Phase0 cannot run before packaging. Steps that change system settings, credentials or remotes require explicit Founder approval.
8. Keep `SOURCE_LEVEL_CLOSURE=false`, `TARGET_MACHINE_PHASE0=PENDING`, `FINAL_TRUST_ROOT_SEAL=STALE_PENDING_FINAL_RESEAL`, `FINAL_SHA256SUMS=NOT_DONE`, `FINAL_RELEASE_AUTHENTICITY=NOT_DONE` and `FINAL_ZIP=NOT_DONE` until their physical gates complete.
