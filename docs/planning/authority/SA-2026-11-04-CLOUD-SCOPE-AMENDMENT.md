<!-- //TR: Bu kayıt dondurulmuş V4.1 matrisini (docs/planning/v41/*.zip, SHA256SUMS) DEĞİŞTİRMEDEN üç açık görev kapsamı uyuşmazlığını (CLOUD-T0005, CLOUD-T0012, Cloud chain-host) tek, izlenebilir bir kapsam genişletme önerisinde toplar. Merge'ü Founder kararıdır; kendi başına hiçbir kapıyı sağlamaz ve standing-authority.json'u değiştirmez. -->
# SA-2026-11-04-CLOUD-SCOPE-AMENDMENT: V4.1 cloud task write-set amendment

- **Status:** Proposal. It takes effect only when the Founder merges this file into `v7/integration`. This PR touches `docs/planning/authority/**`, so it is `FOUNDER_REQUIRED:GOVERNANCE_PATH`.
- **Basis:** the Founder's 2026-11-04 directive "MASTER CI RECOVERY, FOUNDER SCOPE AUTHORIZATION & CLOUD PRODUCT INTEGRATION", §5. That directive authorizes proposing this amendment and continuing development within existing authority. Merging the amendment still needs the Founder.
- **What it does not do:**
  - It does not edit the frozen matrix `docs/planning/v41/UASCO_V4_1_CLOUD_MERGED.zip` or its `SHA256SUMS`.
  - It does not edit `docs/planning/autonomy/task-index.json`, `standing-authority.json`, `merge-gate.mjs` or `autonomy.mjs`.
  - It does not change tiers, merge gates, doneMerge criteria or acceptance states.
  - It does not satisfy any review, CI or environment gate.
- **How it is used:**
  - An independent reviewer judging `TASK_SCOPE_MISMATCH` for a PR in §2 reads the matrix `targetFiles` plus the additions in this record, once it is merged.
  - A PR that is merged under this record still reports only `CODE_MERGED`. It does not count as acceptance of its task.

## 1. Why
The matrix lists one file per task. Building the honest Desktop → Control API → Cloud chain needs a few companion files beside each declared file. Three PRs were correctly flagged `TASK_SCOPE_MISMATCH` by independent reviewers:
- #335, CLOUD-T0005;
- the code half of the #308 split, CLOUD-T0012;
- the planned Cloud chain host.

This record makes each extension explicit and traceable, so it is neither hidden nor used to stall the Cloud work.

## 2. Amendments

### A. CLOUD-T0005: Windows .exe remote cloud client / Control UI (T1)
- **Matrix targetFiles:** `NEW:apps/desktop/renderer/views/cloud-connection.js`.
- **Added:**
  - `apps/control-api/src/cloud/jobs.ts`: the read-only `list()` and `summary()` methods only. The queue semantics stay owned by CLOUD-T0003.
  - `NEW:apps/control-api/src/routes/cloud-jobs.ts`
  - `NEW:tests/support/cloud-jobs-status.cases.ts`
  - The 2-line registration in `tests/v7-cloud-contracts.test.ts`.
- **Rationale:** the Desktop panel can show real job state only if the server exposes it. Without these files the panel can only show sample data, which is forbidden.
- **Dependencies:** CLOUD-T0003 (queue) and CLOUD-T0004 (gateway). The protected wiring in `server.ts` and the `main.mjs` GET allow-list is a separate Founder-tier PR.
- **Risk:** T1 to T2. The change is read-only and tenant-scoped. Lease, worker, scope, signature and idempotency data are never returned. Requirements:
  - server-side redaction of worker messages;
  - negative tests showing that forged tenant headers and query parameters are ignored.
- **Acceptance unchanged:** the doneMerge criterion (install, login, command, event streaming, download and stop on a Windows runner) is not met by this PR.
- **PR:** #335.

### B. CLOUD-T0012: cloud staging/production separation, health and secret rotation (T2)
- **Matrix targetFiles:** `NEW:docs/cloud/DEPLOYMENT-RUNBOOK.md`.
- **Added:**
  - `NEW:apps/control-api/src/cloud/deployment.ts`
  - `NEW:tests/support/cloud-deploy.cases.ts`
  - The 2-line registration in `tests/v7-cloud-contracts.test.ts`.
- **Rationale:** the task's name covers staging/production separation and health/secret rotation, and the runbook refers to code that enforces it. Shipping the runbook alone would leave those references dangling.
- **Risk:** T2, security-sensitive. The code is pure logic:
  - It separates environments by key ring, endpoint and secret.
  - It refuses non-public production endpoints.
  - It applies a trusted-clock skew check.
  - Deploy approvals are bound to Founder approval.
  - It has no network calls and provisions no infrastructure.
- **Acceptance unchanged:** "Staging gerçek health/auth test PASS" needs real staging, which is a Founder decision under D-03/D-29. Under D-08 there is no paid resource.
- **PRs:** the two branches split from #308, `claude/builder-g-cloud-t0012-deploy-core` and `claude/builder-g-cloud-t0012-runbook`. Code first, then the runbook.

### C. Cloud chain host: proposed new task CLOUD-T0016 (T2)
- **Proposed:** a new task, CLOUD-T0016 "Local single-process cloud chain host". It does not relabel an existing task, because no existing task owns these files:
  - CLOUD-T0003 owns the queue;
  - CLOUD-T0002 owns the sandbox worker;
  - CLOUD-T0010 owns the orchestrator;
  - CLOUD-T0011 owns the acceptance suite;
  - UASCO-T0078 is BLOCKED/T3 and cloud-only.
- **targetFiles:**
  - `NEW:apps/control-api/src/cloud/chain-host.ts`
  - `NEW:scripts/cloud-chain-host.mts`
  - the related cases under `tests/`.
- **Dependencies:** CLOUD-T0002, CLOUD-T0003, CLOUD-T0010 and CLOUD-T0015 (code delivered or stacked).
- **Scope:** compose the existing real components in one local process:
  command intake → task DAG → cloud job queue → worker → sandbox adapter → artefact store → verified delivery.
- **Fail-closed rules:**
  - Keys come only from environment-variable names; with no keys, the host does not start.
  - No HTTP job-start route.
  - The in-process confirmation signer is labelled supervisor-test only and is never treated as a human Founder confirmation.
  - The planner reports `LOCAL_STUB`.
  - On Windows, the worker reports `UNAVAILABLE`.
- **doneMerge:** deterministic local loopback run evidence, at most `LOCAL_E2E_VERIFIED`. It is explicitly **not** cloud E2E. CLOUD-T0011's "6 real cloud runs" remains open.
- **Risk:** T2. The server wiring (`server.ts`, P1–P4) is a separate Founder-tier PR.
- **Until this record is merged,** the chain-host PR declares `UASCO-TASK: CLOUD-T0016`. That id is not yet in the task index, so the PR is `FOUNDER_REQUIRED` and is never auto-merged.

## 3. Founder decisions requested
One decision covers all three: merge this record, which accepts A, B and C, or reject the parts you do not accept. Rejecting a part leaves the matching PR `FOUNDER_REQUIRED`.

Unchanged and still open:
- D-03/D-29 real staging or cloud provider (CLOUD-T0009, CLOUD-T0012 acceptance);
- D-08 paid services, which stay at 0 USD.
