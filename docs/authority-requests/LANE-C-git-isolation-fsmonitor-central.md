<!-- //TR: LANE-C yetki talebi (UYGULANMADI): her izole git çağrısına (spawnGitSync, runGitAsync, isolatedGitArgs) core.fsmonitor=false ve core.untrackedCache=false eklenmesi, korumalı automation/lib/git-isolation.mjs dosyasında tek satırlık bir değişikliktir ve güven kökü mührünün yenilenmesini gerektirir; Lane C bu dosyaları DEĞİŞTİRMEZ, talep Kurucu'ya koordinatör aracılığıyla gider. -->
# LANE-C authority request: central `core.fsmonitor=false` / `core.untrackedCache=false` in `automation/lib/git-isolation.mjs`

Status: **NOT APPLIED**. Lane C does not edit protected files. This is a docs-only request for the Founder, carried by the coordinator. Base used for every number below: `v7/integration` `1426004`.

## Why

Every production git call goes through `isolatedGitArgs` (via `spawnGitSync`, `runGitAsync`, `command-contracts`). That helper neutralises hooks, global/system config, credentials, askpass and the `ext` protocol, but it still lets the **repository's own `.git/config`** decide `core.fsmonitor` and `core.untrackedCache`. A command-line `-c` outranks repository config, so two more pairs close the gap for every caller at once.

Measured with git 2.43 on a repository whose `.git/config` has `core.fsmonitor = <executable script>` and `core.untrackedCache = true` (script appends to a marker file):

| git call (isolated) | script runs |
|---|---|
| `rev-parse --show-toplevel`, `--absolute-git-dir`, `--is-bare-repository`, `--git-dir`, `HEAD HEAD^{commit}` | no |
| `status --porcelain`, `diff --stat`, `ls-files -o`, `update-index --refresh` | **yes** |
| the same `status` with `-c core.fsmonitor=false -c core.untrackedCache=false` | no |

So today only callers that add the pairs themselves are safe for index-refreshing commands. C-GIT-FSMON-1 (#279) fixes only the two repository-HEAD probe drivers locally; this request is the central fix.

## The exact change (one line of `automation/lib/git-isolation.mjs`, line 22)

```diff
-export function isolatedGitArgs(args){const s=isolationState();return ["-c",`core.hooksPath=${s.hooks}`,"-c","credential.helper=","-c","core.askPass=","-c","protocol.ext.allow=never",...args]}
+export function isolatedGitArgs(args){const s=isolationState();return ["-c",`core.hooksPath=${s.hooks}`,"-c","credential.helper=","-c","core.askPass=","-c","protocol.ext.allow=never","-c","core.fsmonitor=false","-c","core.untrackedCache=false",...args]}
```

Deliberately NOT included: `protocol.allow=never` (the HEAD probes use it, but clone/fetch callers need local transports). `automation/lib/git-isolation.d.mts` is unchanged (same signature).

## Callers covered (non-test sources that use `spawnGitSync` / `runGitAsync` / `isolatedGitArgs` on `1426004`)

- Already add the pairs themselves (become redundant, harmless): `core/workos/builder-output.ts` (`HARDEN`), `core/workos/executors.ts` (`REVIEW_GIT_HARDEN`), `core/workos/project-studio.ts` (`core.fsmonitor=false`), `core/competency/evaluation-pipeline.ts`, `core/workos/runner.ts` (diff calls), and, after #279, the two HEAD probe drivers (`HEAD_GIT_HARDEN`; kept as defence in depth with its own argument test).
- Gain the protection: `core/evidence/index.ts`, `apps/control-api/src/server.ts` (`isAncestor`), `automation/lib/change-guard.mjs`, `git-metadata-guard.mjs`, `git-ops.mjs`, `package-policy.mjs`, `phase0-contract.mjs`, `command-contracts.mjs` (program `git`), `core/workos/git-async.ts` (`runGitAsync`, so every other runner git call), `core/workos/fake-executor.mjs`, and the scripts `phase0-acceptance.mjs`, `uasco-supervisor-entry.mjs`, `verify-remote-protection.mjs`, `workos-live-smoke.mjs`, `validate-mechanical-closure.mjs`, `validate-runtime-contracts.mjs` plus the selftests that import the helper.
- Not covered (own isolation arrays): `scripts/bootstrap-uasco-autonomy.ps1` and `scripts/init-private-git.ps1`. Optional follow-up, same tier.

## Behaviour and risk

No semantic change for any caller except that repo-local fsmonitor and untracked-cache settings can no longer take effect. Cost: no untracked-cache speed-up on `status` in a huge repository (the callers that already pass the pairs have accepted this). A caller that passes the same `-c` again is harmless (last value wins, identical). Nothing pins the exact isolation argument list today (`scripts/validate-mechanical-closure.mjs` only requires the tokens `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, `core.hooksPath`, `GIT_TERMINAL_PROMPT` in the file; adding `core.fsmonitor=false` to that list is a protected follow-up).

## Trust-root reseal needed

`config/trust-root-manifest.json` entry `automation/lib/git-isolation.mjs`: replace `sha256` `4a206716d8272bd82bd6ea639025547eeba6732dc789a140e8dde38cff6556f9` with the sha256 of the real head bytes after the change (on `1426004` the one-line edit above gives `98019430a8bd99e3c42ccdbc878dbaf567df969ff2c79398bef3dd03732f832f`; informational only, recompute at carry-out because other protected PRs touch the same manifest). No other manifest entry changes (`git-isolation.d.mts` stays `1bcdc286b5e694f9a0eb496671001bfc098710918f3555cfdf4a350a4d9dfdfe`). After the reseal `node scripts/verify-trust-root.mjs` must print `TRUST_ROOT_VERIFY: PASS`.

Check without writing anything:

```sh
node -e 'const fs=require("fs"),c=require("crypto");let s=fs.readFileSync("automation/lib/git-isolation.mjs","utf8");const a="\"-c\",\"protocol.ext.allow=never\",...args]";if(s.split(a).length!==2)throw new Error("anchor");console.log(c.createHash("sha256").update(s.replace(a,"\"-c\",\"protocol.ext.allow=never\",\"-c\",\"core.fsmonitor=false\",\"-c\",\"core.untrackedCache=false\",...args]")).digest("hex"))'
```

## Tests to add when it is carried out (no new test file, so no S-REG)

In an already-registered test that imports the helper, for example `tests/pkg-r4-init-private-git.test.ts` (imports `isolatedGitArgs`, `isolatedGitEnv`):

1. `isolatedGitArgs(["status"])` equals `[...<the existing isolation prefix>, "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status"]` and the two pairs sit before the first caller argument.
2. Behaviour (POSIX): a repository with an executable `core.fsmonitor` script in `.git/config`; `spawnGitSync(repo, ["status","--porcelain"])` must NOT create the marker file, while a plain `git status` through the same repository does (positive control, as in `tests/v7-relfx-c3-remediation.test.ts` "C-GIT-FSMON-1").
3. Mutants (Lane C can write the list on request): drop each pair, wrong value (`=true`), pair order, pairs appended after `...args`.

## Rule check

Protected paths touched by the carry-out: `automation/lib/git-isolation.mjs` (protected prefix `automation/lib/`) and `config/trust-root-manifest.json` (protected prefix `config/`). Lane C changes neither.
