<!-- //TR: LANE-C yetki talebi (S-REG): C-CTX-1 yeni test dosyası tests/v7-core-role-context.test.ts CI'da yalnız config/validation.json tests-8 adımına eklenirse koşar; bu iki korumalı değişiklik (liste eklemesi + güven kökü mührü) ve iki sıra-bekçisi düzenli ifadesinin genişletilmesi koordinatörün tek korumalı commit'idir, Lane C bu dosyaları DEĞİŞTİRMEZ. -->
# LANE-C authority request: C-CTX-1 test registration (step S-REG)

Status of the package until this request is carried out: `CODE_COMPLETE_NOT_CI_REGISTERED` (not DONE). The PR is "validation red, not mergeable" until the protected commit below lands on the same branch; that is expected.

## What is requested

Two protected changes, both in the Founder's `TEST_REGISTRATION_APPEND` / `TRUST_ROOT_RESEAL` tier (the same R1 PREAUTHORIZED tier the coordinator used for C-RDY-1 `1dd7597` and C-RDY-2a `ad5971a`). Lane C does not perform them.

1. **TEST_REGISTRATION_APPEND** in `config/validation.json`: append `"tests/v7-core-role-context.test.ts"` as the LAST element of the `command` array of step `tests-8`, and change nothing else. The anchor is whichever entry is last when this is carried out: at the base `459205c` it is `"tests/v7-core-readiness-audit.test.ts"` (and `"tests/v7-core-readiness-adapter-reality.test.ts"` once C-RDY-2a #264 has merged), so the edit is exactly:

   ```diff
   -        "<previous last entry>"
   +        "<previous last entry>",
   +        "tests/v7-core-role-context.test.ts"
          ],
          "requiresDependencies": true
   ```

2. **TRUST_ROOT_RESEAL** of the `config/validation.json` entry in `config/trust-root-manifest.json`: replace its `sha256` with the sha256 of the real head bytes of `config/validation.json` after change 1. Other open PRs may also touch `config/trust-root-manifest.json`, so recompute on the base that is current when this is carried out.

## Order guards (as agreed in the coordinator message of 22:11Z)

The two tests-step order guards (`tests/v7-ps1b-project-studio-ui.test.ts` ~:915 and `tests/v7-b5-work-screens.test.ts` ~:1040) only accept a trailing entry matching `^tests/v7-(?:b([6-9]|\d{2,})[a-z]?|ps\d+[a-z]?|m1a|core-predev|core-readiness|ux)-[a-z0-9-]+\.test\.ts$`. The dispatch file name `v7-core-role-context` is kept as agreed, so the family alternation needs `core-role` added (it then matches `core-role` + `-context`), exactly the way `9abe30c` added `core-readiness`. Lane C does not edit those two files.

## Exact file

The only new test file of this package, and the file to register: `tests/v7-core-role-context.test.ts` (one `describe("C-CTX-1 role-context")`). It is not hosted in any other file on purpose.

## How to check the change (read-only; nothing is written)

At the base `459205c`, `config/validation.json` has sha256 `53c4b295d4fe430485bce64941d897681029a21549565568cd75e0dc9d969483`. The same file with change 1 applied in memory (anchor occurs exactly once, the result parses as JSON) has sha256 `60559bde79daa7b8ee37304247f188a66adb3861967f5fc17a98838d8baa78fd`, from:

```sh
node -e 'const fs=require("fs"),c=require("crypto");let s=fs.readFileSync("config/validation.json","utf8");const a="\"tests/v7-core-readiness-audit.test.ts\"\n      ],";if(s.split(a).length!==2)throw new Error("anchor");s=s.replace(a,"\"tests/v7-core-readiness-audit.test.ts\",\n        \"tests/v7-core-role-context.test.ts\"\n      ],");JSON.parse(s);console.log(c.createHash("sha256").update(s).digest("hex"))'
```

That hash is informational: it is only valid while `config/validation.json` on the base is unchanged (it does not include the C-RDY-2a append), so the reseal must use the real head bytes at carry-out time.

## Why it is safe to register

- The test reads `registries/{role-definitions,skills-v2,technologies,agent-skill-matrix,role-execution-profiles}.json` read-only and writes only inside `fs.mkdtempSync(os.tmpdir())` directories that it removes; it spawns no process, opens no port and needs no network.
- Linux measurement (4 CPU, Node 22): the whole file takes about 2-3 s, so the default vitest timeouts are kept.
- It depends on the counts of `v7/integration` (599 roles, 51 guilds, 425 skills, 415 technologies, 363 legacy agents, 599 profiles; 197 roles with proposed skills; 41 unresolved technology references; UASCO-0085 with 72 proposed skills). A change to any of these is a deliberate measurement change and must update the assertions in the same PR.

## Not part of this request

No other protected path, no `registries/**` or `knowledge/**` edit, no `core/workos/**` or `apps/**` change, no alias approval (FD-1), no verified or certified technology status (FD-9), no prompt or runtime wiring (C-CTX-2 / C-CTX-3 / B2 consume the context later).
