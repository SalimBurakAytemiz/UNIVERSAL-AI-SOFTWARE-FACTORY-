<!-- //TR: LANE-C yetki talebi (S-REG): C-RDY-2a yeni test dosyası tests/v7-core-readiness-adapter-reality.test.ts CI'da yalnız config/validation.json tests-8 adımına eklenirse koşar; bu iki korumalı değişiklik (liste eklemesi + güven kökü mührü) koordinatörün tek korumalı commit'idir, Lane C bu dosyaları DEĞİŞTİRMEZ. -->
# LANE-C authority request: C-RDY-2a test registration (step S-REG)

Status of the package until this request is carried out: `CODE_COMPLETE_NOT_CI_REGISTERED` (not DONE). The PR is "validation red, not mergeable" until the protected commit below lands on the same branch; that is expected.

## What is requested

Two protected changes, both in the Founder's `TEST_REGISTRATION_APPEND` / `TRUST_ROOT_RESEAL` tier (the same R1 PREAUTHORIZED tier the coordinator used for C-RDY-1, commit `1dd7597`). Lane C does not perform them.

1. **TEST_REGISTRATION_APPEND** in `config/validation.json`: append `"tests/v7-core-readiness-adapter-reality.test.ts"` as the LAST element of the `command` array of step `tests-8`, and change nothing else. `tests-8` currently ends with `"tests/v7-core-readiness-audit.test.ts"` (the C-RDY-1 registration); the edit is exactly:

   ```diff
   -        "tests/v7-core-readiness-audit.test.ts"
   +        "tests/v7-core-readiness-audit.test.ts",
   +        "tests/v7-core-readiness-adapter-reality.test.ts"
          ],
          "requiresDependencies": true
   ```

2. **TRUST_ROOT_RESEAL** of the `config/validation.json` entry in `config/trust-root-manifest.json`: replace its `sha256` with the sha256 of the real head bytes of `config/validation.json` after change 1. Other open PRs may also touch `config/trust-root-manifest.json`, so recompute on the base that is current when this is carried out.

## Why the file is named `v7-core-readiness-adapter-reality.test.ts` (deviation from the dispatch name)

The Wave 0 baseline names the host `tests/v7-core-adapter-reality.test.ts`. The two tests-step order guards (`tests/v7-ps1b-project-studio-ui.test.ts` and `tests/v7-b5-work-screens.test.ts`) only allow a trailing entry that matches `^tests/v7-(?:b([6-9]|\d{2,})[a-z]?|ps\d+[a-z]?|m1a|core-predev|core-readiness|ux)-[a-z0-9-]+\.test\.ts$`. `v7-core-adapter-reality` does not match, so appending it would fail both guards and need a second edit of those two files. `v7-core-readiness-adapter-reality` matches the existing `core-readiness` family (the coordinator widened the guards for C-RDY-1 in `9abe30c`), so S-REG is the same one-line append plus reseal and the guards stay untouched. If the coordinator prefers the dispatch name, the rename is `git mv` of one file plus its two references in `docs/lanes/LANE-C-adapter-reality-mutants.{mjs,json}` and a widened guard regex.

## Exact file

The only new test file of this package, and the file to register: `tests/v7-core-readiness-adapter-reality.test.ts` (one `describe("C-RDY-2a adapter-reality")`). It is not hosted in any other file on purpose.

## How to check the change (read-only; nothing is written)

At the base `459205c`, `config/validation.json` has sha256 `53c4b295d4fe430485bce64941d897681029a21549565568cd75e0dc9d969483`. The same file with change 1 applied in memory (anchor occurs exactly once, the result parses as JSON) has sha256 `8aab18528634694ef93e99672341824c306e552fef1e91ddf537cae9edca953b`, from:

```sh
node -e 'const fs=require("fs"),c=require("crypto");let s=fs.readFileSync("config/validation.json","utf8");const a="\"tests/v7-core-readiness-audit.test.ts\"\n      ],";if(s.split(a).length!==2)throw new Error("anchor");s=s.replace(a,"\"tests/v7-core-readiness-audit.test.ts\",\n        \"tests/v7-core-readiness-adapter-reality.test.ts\"\n      ],");JSON.parse(s);console.log(c.createHash("sha256").update(s).digest("hex"))'
```

That hash is informational: it is only valid while `config/validation.json` on the base is unchanged, so the reseal must use the real head bytes at carry-out time.

## Why it is safe to register

- The test reads source files (including a read-only census over the production sources of `apps`, `core`, `scripts` and `automation`; no test file and no `node_modules`), `registries/tool-adapters.json`, `.github/workflows/*.yml` and `node_modules/<package>/package.json` read-only and writes only inside `fs.mkdtempSync(os.tmpdir())` directories that it removes; it spawns no process, installs and runs no binary (probes default to NOT_OBSERVED) and needs no network.
- It dynamically imports `core/workos/{runner,executors,security-tools,git-async,project-studio}.ts`, `core/workos/predev/claude-builder.ts`, `automation/lib/dependency-install.mjs`, `scripts/ci/uasco-review/github.mjs`, `ajv` and `ajv-formats` (import only; nothing is called). It never imports the scripts it checks by literal (`scripts/e2e/desktop-journey.e2e.mjs`, `scripts/claude-builder-broker.mjs`).
- Linux measurement (4 CPU, Node 22): the whole file takes about 5-6 s and the slowest test about 1.2 s (the production-source census about 0.5 s), so the default vitest timeouts are kept.
- It depends on the counts of `v7/integration` (194 registry adapters, none implemented; no workflow referencing gitleaks/trivy/playwright/semgrep, the exact workflow mention set is pinned; no production importer of `core/capabilities/resolver.ts`; every registry id or spawned command named in production code is a record or a justified census exclusion). A change to any of these is a deliberate measurement change and must update the T2/T3 assertions in the same PR (for example when #251 adds a workflow step for one of the tools, or when B1 imports the resolver).
- It reads the in-flight surfaces `core/workos/runner.ts` (#256, merged) and `core/workos/executors.ts` (#231, Founder-pending): export names and caller literals are asserted, so a change to those names fails this test loudly instead of silently staling the map.

## Not part of this request

No other protected path, no `registries/**` or `knowledge/**` edit (the reconciliation only REPORTS), no `.github` change, no `apps/control-api/**` change (B1 consumes the map later).
