<!-- //TR: LANE-C yetki talebi (S-REG): C-RDY-1 yeni test dosyası tests/v7-core-readiness-audit.test.ts CI'da yalnız config/validation.json tests-8 adımına eklenirse koşar; bu iki korumalı değişiklik (liste eklemesi + güven kökü mührü) koordinatörün tek korumalı commit'idir, Lane C bu dosyaları DEĞİŞTİRMEZ. -->
# LANE-C authority request: C-RDY-1 test registration (step S-REG)

Status of the package until this request is carried out: `CODE_COMPLETE_NOT_CI_REGISTERED` (not DONE). The PR is "validation red, not mergeable" until the protected commit below lands on the same branch; that is expected.

## What is requested

Two protected changes, both in the Founder's `TEST_REGISTRATION_APPEND` / `TRUST_ROOT_RESEAL` tier (labelled R1 PREAUTHORIZED by the supervisor; the label lives in the supervisor's dispatch, `git grep -i preauthori` finds it nowhere in the repository, and `config/autonomous-authority-policy.json` does not exist, so the autonomous engine cannot authorize it). Lane C does not perform them.

1. **TEST_REGISTRATION_APPEND** in `config/validation.json`: append `"tests/v7-core-readiness-audit.test.ts"` as the LAST element of the `command` array of step `tests-8`, and change nothing else. `tests-8` ends today with `"tests/v7-ux-install.test.ts"`; the edit is exactly:

   ```diff
   -        "tests/v7-ux-install.test.ts"
   +        "tests/v7-ux-install.test.ts",
   +        "tests/v7-core-readiness-audit.test.ts"
          ],
          "requiresDependencies": true
   ```

   `tests-8` is the last tests shard by `isShard` (`core/authority/autonomous-authority.mjs:391-431`) and runs on Windows shard 1 per `shardPlan.win32.assign`; no other step, `assign` entry or shard plan changes.

2. **TRUST_ROOT_RESEAL** of the `config/validation.json` entry in `config/trust-root-manifest.json`: replace its `sha256` with the sha256 of the real head bytes of `config/validation.json` after change 1. `config/trust-root-manifest.json` is also touched by other open PRs, so the value MUST be recomputed on the base that is current when this is carried out.

## Exact file

The only new test file of this package, and the file to register:

- `tests/v7-core-readiness-audit.test.ts` (one `describe("C-RDY-1 readiness-audit")`: T1-T11 under their dispatch names plus extra tests added by the author and by the #260 review repair; the file name is the only registration key).

It is not hosted in any other file on purpose (a test hidden in an unrelated registered file would dodge this review).

## How to check the change (read-only; nothing is written)

At the base `56694bf`, `config/validation.json` has sha256 `70980b61ef86dbda8d29cedf0a132c68629a36576f58cb345a288b6a83fa8d63`. The same file with change 1 applied in memory (anchor occurs exactly once, the result parses as JSON) has sha256 `53c4b295d4fe430485bce64941d897681029a21549565568cd75e0dc9d969483`, from:

```sh
node -e 'const fs=require("fs"),c=require("crypto");let s=fs.readFileSync("config/validation.json","utf8");const a="\"tests/v7-ux-install.test.ts\"\n      ],";if(s.split(a).length!==2)throw new Error("anchor");s=s.replace(a,"\"tests/v7-ux-install.test.ts\",\n        \"tests/v7-core-readiness-audit.test.ts\"\n      ],");JSON.parse(s);console.log(c.createHash("sha256").update(s).digest("hex"))'
```

That hash is informational: it is only valid while `config/validation.json` on the base is unchanged, so the reseal must use the real head bytes at carry-out time.

## Why it is safe to register

- The test reads the checked-out registries and `knowledge/technologies/*.json` (415 files) read-only through `loadReadinessInputFromRepo` and writes only inside `fs.mkdtempSync(os.tmpdir())` directories that it removes; it spawns no process, opens no port and needs no network.
- Linux measurement (4 CPU, Node 22): the whole file takes about 3-4 s, the slowest test well under 1 s, so the default vitest timeouts are kept.
- Status: carried out by the coordinator in commits `1dd7597` (append + reseal) and `9abe30c` (order-guard whitelists); this note is kept as the record.
- It depends on the registry numbers of `v7/integration` (599 roles, 51 guilds, 10 clusters, 415 technologies, 425 skills, `requiredSkillIds` empty for every role, no promoted technology status). A change to any of these is a deliberate measurement change and must update the T1 assertions in the same PR (the dispatch says to recount first).

## Not part of this request

No other protected path (`config/protected-paths.json` prefixes, schemas, `scripts/validate-*`), no `registries/**` or `knowledge/**` edit, no change to `apps/control-api/**` (B1 consumes the audit later) and no promoted technology status (FD-9) or alias approval (FD-1).
