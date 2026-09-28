<!-- //TR: Bu dosya source audit ile sahte PASS verilemeyecek, yalnız Founder'ın Windows hedef makinesinde gerçek runtime/credential/remote ile doğrulanabilecek acceptance maddelerini ayrı tutar. -->
# Known Target-Machine Pending

## Verified on the target Windows machine (win32 10.0.19045 x64)

Bu maddeler target makinede gerçek runtime ile çalıştırılmış ve bağımsız Codex review'dan geçmiştir; Phase0 acceptance yerine geçmez:

- Node >=24 exact runtime (v24.19.0)
- npm registry/network + reviewed `package-lock.json` (npm 11.17.0)
- `npm ci` through the reviewed-lock gate
- full TypeScript typecheck
- full Vitest suite
- real provider launcher provenance (Claude and Codex `STANDALONE_LAUNCHER`)
- Codex CLI invoked through the canonical reviewer broker (independent reviews)
- Electron desktop / Control Tower smoke on Windows (explicit checksum-verified Electron provisioning)
- Claude CLI authenticated smoke through the builder broker and live provider smoke (`scripts/provider-smoke.mjs`, both brokers, `STANDALONE_LAUNCHER`)
- target preflight (`scripts/preflight.mjs`): installed physical memory 16.00 GB, Windows Time service running (PKGA-F8 closed)

## Still pending

Aşağıdakiler hâlâ tamamlanmış sayılamaz:

- Windows PowerShell installer state machine end to end (`scripts/install.ps1`); the first attempt stopped at bootstrap (PHASE0-F1..F3, fixed in PKG-R3)
- Windows process lock / kill / crash / restart / resume tests: verified on this target machine for the process lock and the unattended orchestrator with real child processes (killed holder taken over as stale, one winner among concurrent invocations, unreadable/foreign-host locks fail closed, a worker killed mid-action resumed after lease expiry without a duplicate provider call, corrupted state recovered from its previous copy); the installed supervisor's own crash/resume is still covered only by Phase0
- Task Scheduler/autostart
- Git remote privacy + branch protection provider API
- real merge/push/remote-SHA verification
- OmniRoute installed CLI/version/provider compatibility: installed package identity, MIT license, expected repository, Node engines range, launcher inside the npm global prefix and local-only endpoint verified read-only on this target machine (omniroute 3.8.50); provider routing through a running OmniRoute with credentials is still pending
- physical/cloud mobile-device adapters

Target-machine `PHASE0_ACCEPTANCE.json` CLEAN olmadan autonomous roadmap build başlamamalıdır.
