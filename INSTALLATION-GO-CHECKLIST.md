<!-- //TR: Bu checklist Founder'ın full autonomous build'i başlatmadan önce tek bakışta hangi Phase-0 kanıtlarının PASS olması gerektiğini gösterir. -->
# Installation GO Checklist

Full autonomous build ancak `scripts/install.ps1` sonunda `PHASE0_ACCEPTANCE.json` **CLEAN** veya explicit local-only kullanım için **CLEAN_LOCAL_ONLY** ürettiğinde başlatılır.

Required proof families:

- Artifact checksum consistency
- Node >=24 / npm / Git / PowerShell / disk / RAM / ports
- package-lock generated and tracked in initial Git baseline
- canonical static + semantic + mechanical validators
- mechanical kernel self-test
- TypeScript typecheck + Vitest
- trust-root hash verification
- Git `main`, clean worktree, exact initial commit
- Claude auth/network smoke
- Codex auth/network smoke
- Control API smoke
- Electron Control Tower smoke
- run logger / checkpoint / process lock / scheduler / review governance / Global Stop source gates

If any required proof is missing, autonomous build stays **BLOCKED**.
