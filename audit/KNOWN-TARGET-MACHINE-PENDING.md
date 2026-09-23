<!-- //TR: Bu dosya source audit ile sahte PASS verilemeyecek, yalnız Founder'ın Windows hedef makinesinde gerçek runtime/credential/remote ile doğrulanabilecek acceptance maddelerini ayrı tutar. -->
# Known Target-Machine Pending

Aşağıdakiler source ZIP üretim ortamında tamamlanmış sayılamaz:

- Windows PowerShell installer state machine
- Node >=24 exact runtime
- npm registry/network + generated `package-lock.json`
- `npm ci`
- full TypeScript typecheck
- full Vitest suite
- Claude CLI authenticated smoke
- Codex CLI authenticated smoke
- real model/provider provenance
- Electron desktop smoke on Windows
- Windows process lock / kill / crash / restart / resume tests
- Task Scheduler/autostart
- Git remote privacy + branch protection provider API
- real merge/push/remote-SHA verification
- OmniRoute installed CLI/version/provider compatibility
- physical/cloud mobile-device adapters

Target-machine `PHASE0_ACCEPTANCE.json` CLEAN olmadan autonomous roadmap build başlamamalıdır.
