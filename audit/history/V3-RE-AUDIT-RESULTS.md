<!-- //TR: Bu audit V3 worktree üzerinde V2 re-audit bulgularının gerçekten kapatılıp kapatılmadığını, yeni source-level P0 mekanik bypass bulunup bulunmadığını ve target-machine'e bırakılan dürüst runtime sınırlarını kaydeder. -->
# UASCO V3 Re-Audit Results

## Hüküm

V2 re-audit'te bulunan source-level P0 mekanik açıklar V3'te karşılık buldu. V3 re-audit sırasında bir yeni Codex governance bypass'ı bulundu: current review finding içinde BLOCKER'ın `RESOLVED/DOWNGRADED/DUPLICATE` status ile gelmesi effective CLEAN'e kapı açabiliyordu. Bu açık kapatıldı; current BLOCKER artık yalnız `OPEN` olabilir, resolution yalnız sonraki cycle `priorBlockerDispositions` + gerçek retest evidence ile yapılabilir. Self-test eklendi ve PASS aldı.

V3 packaging re-audit sırasında ikinci bir trust-root bug da bulundu: generator protected exact-path listesinden `config/trust-root-manifest.json` dosyasını kendisi içine alabiliyordu. Böylece manifest yazıldıktan sonra kendi hash'i doğal olarak değişiyor ve `verify-trust-root` HASH_MISMATCH veriyordu. Generator self-reference dışlayacak şekilde düzeltildi ve mechanical validator'a kalıcı regression gate eklendi.

Bu düzeltmelerden sonra **yeni bir source-level P0 mechanical blocker bulunmadı**. Bu, target machine üzerinde bütün runtime'ın doğrulandığı anlamına gelmez.

## V2 P0 closure durumu

- Builder tool-policy sandbox + Phase0 host-boundary canary: CLOSED at starter level.
- Action Broker wiring for model egress / local merge / remote push: CLOSED at starter level.
- package.json lifecycle/workspace/override bypass: CLOSED.
- Git metadata mutation guard: CLOSED.
- shared writable node_modules: CLOSED; per-worktree `npm ci --ignore-scripts`.
- prior blocker omission: CLOSED.
- moving-goalpost causal evidence: CLOSED.
- stable finding identity/fingerprint: CLOSED.
- blocker lifecycle / retest evidence: CLOSED + V3 additional hardening.
- governed review attestation digests: CLOSED.
- accepted debt / waiver / limitation ledgers: CLOSED.
- FAIL/ART review bases: CLOSED.
- reviewer launcher/model provenance baseline: CLOSED as far as CLI exposes it.
- child environment allowlist: CLOSED at starter level.
- secret baseline and dependency-change supply-chain gate: CLOSED at starter baseline level.
- detached artifact authenticity: release signature added at packaging time.
- remote URL redaction: CLOSED.
- signed/hash-chained evidence ledger: CLOSED at local starter level.
- atomic checkpoint previous-state recovery: CLOSED at starter level.
- corrupt process lock fail-closed: CLOSED.
- installer PowerShell steps scope/correlation: CLOSED.
- provider smoke nonce echo false-positive: CLOSED with exact arithmetic response strategy.
- 363-agent semantic technology mapping: CLOSED for starter seed model; all 258 technical agents carry primary technology mapping.
- 22 domain packs: physical seed profiles added and validator-covered.

## V3 source-level validation expectations

Final packaging must pass:

- JSON parse all
- MJS syntax all
- registry validation
- architecture validation
- TR validation
- competency V2 validation
- organization validation
- exact schema catalog validation
- technology graph validation
- 363-agent semantic validation
- domain pack validation
- phase contract / wave / lane / critical path validation
- review graph validation
- schema strictness validation
- woven model validation
- mechanical closure validation
- mechanical kernel self-test
- supervisor state-machine self-test
- trust-root verification
- artifact checksum verification
- fresh ZIP extraction + key validator rerun

## Target-machine gates still pending by design

The artifact environment is not the target Windows runtime and currently does not provide Node 24 + installed dependency tree + authenticated Claude/Codex + Electron/PowerShell target validation. Therefore the following remain `TARGET_MACHINE_PENDING`, never fake PASS:

- Node >=24 exact target runtime
- generated/committed `package-lock.json`
- `npm ci`
- TypeScript typecheck
- Vitest suite
- Claude authenticated provider smoke
- Codex authenticated provider smoke
- Claude host-boundary canary on target machine
- Windows process-tree/global-stop behavior
- PowerShell one-click installer end-to-end
- Electron Control Tower smoke
- real private remote visibility/protection
- actual remote push SHA verification
- OmniRoute target compatibility/entitlement
- restart/resume/crash E2E under target OS

## Known P1/P2 limitations, not hidden P0 starter defects

1. Real concurrent package execution is not yet enabled; `maxParallelLanes=1`. Wave/lane/DAG metadata exists, scheduler runtime remains serial until its implementation phase.
2. Token/cost metrics are approximate unless provider CLI exposes authoritative usage. Exact subscription reset/usage cannot be invented.
3. GitHub remote protection adapter is provider-specific and intentionally falls back local-only when protection cannot be verified.
4. Local Ed25519 evidence key is ACL-hardened but not hardware-backed. Same-user/admin compromise remains a production maturity concern.
5. 415 technology profiles and 22 domain packs are seed knowledge contracts; mission-time official-source research/certification is still required.
6. 194 tool adapters, 110 capabilities, 45 fabrics and 16 binders remain runtime implementation backlog unless explicitly marked implemented later.
7. Control Tower governance workflows beyond stop/resume/retry/founder-attention remain product-roadmap work.
8. Multi-repo/multi-mission parallel portfolio orchestration remains later control-plane runtime work.
9. Full OS/container sandbox for production/Risk-5/customer-secret execution remains mandatory before such missions; current self-build uses restricted Claude tool policy plus boundary smoke and fail-closed rules.
10. Signed self-update, full DR, hardware-backed keying and remote tamper-resistant audit are production maturity phases.

## Installation decision

Source artifact can be packaged as the **V3 target-machine validation candidate**.

`INSTALLATION_GO` is not granted by this static audit alone. It is granted only when target-machine Phase0 produces `PHASE0_ACCEPTANCE.json` with final `CLEAN` or explicitly allowed `CLEAN_LOCAL_ONLY` under the local-only policy.
