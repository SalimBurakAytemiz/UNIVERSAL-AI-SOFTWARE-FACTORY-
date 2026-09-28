<!-- //TR: Bu dosya builder işinin LOCAL_CLAUDE ve CLAUDE_CLOUD_SESSION arasında fail-closed yönlendirildiği çift yürütme dokusunu, host'a bağlı işlerin LOCAL_ONLY kuralını, cloud çıktısının aynı validation/review/merge hattına girişini ve yürütme provenance sözleşmesini tanımlar. -->
# Execution Backends — Dual Execution Fabric

The supervisor can route builder work to one of two registered execution backends. The existing local path stays the default executor; cloud execution is optional and never mandatory.

| Backend | Kind | Dispatch | Host-bound work |
|---|---|---|---|
| `LOCAL_CLAUDE` | local CLI process through `scripts/claude-builder-broker.mjs` | `CONFIGURED` | allowed |
| `CLAUDE_CLOUD_SESSION` | product-managed Claude cloud session | `NOT_CONFIGURED` | never |

Policy lives in the protected `config/execution-backends.json`; the routing engine is the protected `automation/lib/execution-routing.mjs`. The registry is validated at supervisor start and the supervisor refuses to start if a security invariant is missing.

## Extension status

`CLAUDE_CLOUD_SESSION` is at the `REGISTER` step of the extension flow in `ARCHITECTURE-FREEZE.md`. Activation needs a documented Claude product method to start a cloud session on a given repository branch, Founder approval for the cloud workspace to reach the private repository, and a reviewed dispatch adapter. Until then the backend reports `NOT_CONFIGURED`, its availability is unknown and treated as unavailable, and no work is ever reported as cloud-executed.

Cloud-session capacity is product-managed capacity, not API credits. No billing or credit-consumption API is assumed (`billingApi: NONE_ASSUMED`, `capacitySignal: NONE_DOCUMENTED`). Local usage is observed only through signals the repository already has: the run ledger usage records and classified provider quota failures.

## Routing modes

`AUTO` (default), `LOCAL_ONLY`, `CLOUD_PREFERRED`, `CLOUD_ONLY`.

Inputs: task type, local availability, local quota pressure when observable, cloud-session availability, cloud capacity when observable, required host resources, filesystem boundary, network boundary, expected duration, parallelism and security classification.

1. **Founder-only work** (`RELEASE_SIGNING_PRIVATE_KEY`): `FOUNDER_ACTION_REQUIRED` in every mode. No automated backend receives it, local or cloud. Release signing stays with the Founder's external key.
2. **Host-bound work** runs on `LOCAL_CLAUDE` or is queued; the mode does not move it to the cloud. Work is host-bound when any of these hold:
   - its type is local-only: Windows ACL changes, Task Scheduler changes, target-machine Phase0, final local install validation, host hardware checks, local credential or device operations, evidence key operations, release packaging;
   - it needs a host-bound resource;
   - it carries a cloud-forbidden data class: private signing key, evidence signing key, local credential, provider auth token, customer or production secret;
   - it needs local credentials;
   - it needs more than the isolated worktree;
   - its classification is above `INTERNAL`;
   - its type is unclassified.
3. **Cloud-eligible work** covers repository analysis, implementation packages, documentation, test generation, static analysis and isolated branch work:
   - `LOCAL_ONLY`: local, else queued.
   - `CLOUD_ONLY`: cloud, else queued. There is no local fallback.
   - `CLOUD_PREFERRED`: cloud, else local if policy allows, else queued.
   - `AUTO`: cloud is preferred for long-running (at least 30 minutes), parallelizable or local-pressure work. Otherwise local is preferred, and the other backend is used only if policy allows it.
4. Unknown availability counts as unavailable. A queued package returns `RETRY_WAIT` and is re-evaluated on the next run. Any decision that cannot be dispatched escalates to the Founder.

## Pipeline and merge gate

Work from either backend enters the same pipeline: deterministic validation → evidence → independent Codex review → remediation/re-review → merge gate. The producer (Anthropic Claude, local or cloud) never reviews its own output.

The merge gate (`assertExecutionMergeGate`) runs before every fast-forward merge, including the crash-safe resume path. It requires all of the following:
- a valid execution provenance record;
- a governed `CLEAN` result;
- a reviewer from the independent provider (`OPENAI`), different from the producer;
- an isolated run branch (never the default branch);
- a result commit.

Cloud work may produce only a branch under the run branch prefix. It never mutates the reviewed default branch.

## Runtime contracts

- **Route decision** (`ROUTE_DECISION_VERSION` 1.0.0), written to `evidence/<package>-execution-route.json`. It holds the mode, task type, classification, host-bound and founder-only flags, the decision and backend, whether a fallback was used, the reasons, the observations, isolation, `mayMutateDefaultBranch: false`, the forbidden cloud inputs and the pipeline requirements.
- **Execution provenance** (`EXECUTION_PROVENANCE_VERSION` 1.0.0), written to `evidence/<package>-execution-provenance.json` after the build and `...-execution-provenance-final.json` at the merge gate. It holds the execution backend, session type, provider, tool, tool version, branch, workspace identity, source commit, result commit, start and finish timestamps, evidence digest (builder log), route digest, route mode, fallback flag, review status, reviewer provider and review digest.

Both are validated in code (`validateExecutionProvenance`), fail closed on missing or malformed fields, and are stored with the run evidence.
