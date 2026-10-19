<!-- //TR: CI-PARALLEL teknik notu (PR #69): Windows dogrulamasinin 3 kabuga bolunmesi, fail-closed birlestirici, kabuk modunun canonical rapor yazmamasi ve "re-run ALL jobs" kurali. Bu bir yetki kaydi degildir; korunan dosya degisikligi ve trust-root reseal Founder yetkisi gerektirir. -->

# CI-PARALLEL: Windows validation shards

Status: proposal (PR #69). This note is not an authority record. The protected-file change and the trust-root reseal need Founder authority.

## Shape

- `validate (ubuntu-latest)`: unchanged. One job runs `node scripts/run-validation.mjs`.
- `validate-windows-shard (1..3)`: each job runs `node scripts/run-validation.mjs --shard <i>/3`. Steps are split by `config/validation.json` → `shardPlan.win32`, and unlisted steps go to shard 1. Each step runs with the same exec code and the same fixed 600 s per-step cap.
- `validate (windows-latest)`: the required context. It is the aggregator job:
  1. It fails unless every shard job succeeded.
  2. It downloads the shard reports of **this run attempt only**.
  3. It runs `node scripts/validate-shards.mjs`.
  4. It runs `secret-sanity`, `bootstrap-kernel-selftest` and `ci-evidence --require`.

  It installs **no** npm dependencies: everything it runs uses Node built-ins only.

## Partial passes are never canonical

`--shard` mode writes only `.ai/runtime/VALIDATION_SHARD_<i>.json`. It never writes the canonical `.ai/runtime/VALIDATION_REPORT.json`, and it deletes a stale canonical report at start, so a shard run cannot leave one behind. The consumers of the canonical report are factory-supervisor, review-pipeline, phase0, install-report and ci-evidence. They only ever see a report from:

- a full (non-shard) run, or
- `validate-shards.mjs` after it has verified the complete shard set.

## Aggregator (fail-closed)

The aggregator returns PASS only when all of these hold:

- exactly reports `1..n` exist, once each;
- every report carries the same expected head sha, the current `GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT`, a config sha256 equal to the checked-out `config/validation.json`, and platform win32;
- every config step appears exactly once, in its planned shard;
- required steps are `PASS`, and only steps for other platforms are `NOT_RUN_PLATFORM`;
- no step timed out.

Anything else prints `SHARD_AGGREGATION_REASON <code>` lines and exits 1.

## Re-runs: use "Re-run all jobs"

The aggregator accepts only shard reports from the current run attempt. With "Re-run failed jobs", the shards that passed are not re-run, so their reports belong to the earlier attempt and the aggregator **fails closed** with `MISSING_SHARD` / `RUN_MISMATCH`. Always use **"Re-run all jobs"**.

## Cost

Windows runner minutes go from about 37 to about 44 per run: 3 shard setups plus the aggregator job. That is $0 for a public repo on standard GitHub-hosted runners. Each PR uses about 5 concurrent jobs, so the free tier's limit of 20 concurrent jobs allows about 4 PRs at a time. The expected Windows wall time is about 15–16 min, down from 37.3 min.
