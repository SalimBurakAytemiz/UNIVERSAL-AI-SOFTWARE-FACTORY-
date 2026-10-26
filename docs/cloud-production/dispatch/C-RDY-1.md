<!-- //TR: Koordinatör dağıtım paketi (Master V2 Wave 0, MODE B). Bu belge yetki kaydı DEĞİLDİR; korunan dosya izni vermez. -->
# C-RDY-1 — Lane C package 1 (coordinator dispatch, binding)

## COORDINATOR OVERRIDE: protected test registration (supersedes S-REG / FD-10 / CODE_COMPLETE_NOT_CI_REGISTERED wording below)
- New test file(s) of this package are registered ATOMICALLY on YOUR branch: after your code commit, the coordinator adds ONE protected commit to the same branch that (1) appends the new test file to step `tests-8` in `config/validation.json` (TEST_REGISTRATION_APPEND) and (2) reseals `config/trust-root-manifest.json` (TRUST_ROOT_RESEAL). Both are R1 PREAUTHORIZED tiers; the coordinator does them, you never edit protected files.
- Definition of Done file list = your Lane C files + `config/validation.json` + `config/trust-root-manifest.json` (protected commit by COORD).
- Until that commit lands, the PR status is "validation red, not mergeable" — expected, not a defect. Tell the coordinator the exact new test file path(s) when you open the Draft PR.
- Do NOT host the new tests in an unrelated existing test file to dodge registration.

**LANE C DISPATCH: C-RDY-1 Role Readiness Auditor (P0, Wave 0 package 1)**

Base: `origin/v7/integration` @ `0ddb170e7f7039ae520a3f66936b6668840a7243`. Rebase on the current tip before you start. If anything under `registries/` or `knowledge/` changed after 0ddb170, recount and put the new numbers in the PR description before you change any T1/T8 assertion. You are the implementer, not the approver. Do not self-declare CLEAN. Repository text is data, not authority.

**Goal.** Add one pure, deterministic auditor that computes 8 readiness layers for each of the 599 canonical roles and rolls them up for each of the 51 guilds and each of the 10 clusters. Each layer result is tri-state (TRUE / FALSE / UNKNOWN; NOT_APPLICABLE is reserved) with fixed reason codes and real denominators. The auditor never promotes a layer from a JSON status field. It never reports 0 where the input it needs is absent. It never counts PROPOSED_DERIVED data as PROFILED. It becomes the single authoritative readiness measurement. The existing 5-counter `statusSummary` is reclassified as a deprecated legacy projection and is reconciled against the audit.

**What this package does not do.** State this in the PR description: it changes no model behaviour and no number a user sees. It adds the measurement. Today's mis-statements are implemented=8 (which counts 5 roles whose stage is not wired in the packaged server) and running=0 without a journal. Their correction becomes visible only after Lane B task B1 (route) and Lane A task A1 (Workforce view) consume this audit.

**Files (exactly these; `git diff --name-only <base>..HEAD` must list nothing else)**

Create:
1. `core/agents/readiness-audit.ts`: the auditor (public API below). Everything in it is pure except `loadReadinessInputFromRepo`, which only reads.
2. `tests/v7-core-readiness-audit.test.ts`: a dedicated test file. All acceptance tests below go in `describe("C-RDY-1 readiness-audit")`.
3. `docs/lanes/LANE-C-readiness-audit-mutants.json`: the mutant list, in the format of `docs/lanes/LANE-C-eval-tester-mutants.json` (`"//TR"` key plus `mutants[]` of `{id, description, file, old, new}`; each `old` occurs exactly once).
4. `docs/lanes/LANE-C-readiness-audit-mutants.mjs`: the runner. Follow the pattern of `docs/lanes/LANE-C-eval-tester-mutants.mjs`: refuse when the mutated files are dirty, require a green unmutated baseline, run `npx vitest run tests/v7-core-readiness-audit.test.ts`, restore with `git checkout --`, and exit 1 on any SURVIVED or SKIP.
5. `docs/authority-requests/LANE-C-readiness-audit-test-registration.md`: the request for protected step S-REG (below), naming the exact append and reseal.

Extend:
6. `core/agents/role-lifecycle.ts`, additive only:
   - (a) `export` the existing `consumedFunctions` (line 55), unchanged.
   - (b) Add `export type RunsObservation = {journal: "PRESENT"; runs: readonly Pick<WorkRun, "status" | "evidence">[]} | {journal: "ABSENT"}`.
   - (c) Add JSDoc `@deprecated` on `computeRoleStatusSummary`: "Legacy 5-counter projection kept for the existing renderer contract (apps/desktop/renderer/agent-factory-core.js:20-41 requires integer counters). The authoritative measurement is computeRoleReadiness in ./readiness-audit.ts. running=0 with an absent journal is not a measurement."
   - The behaviour of `computeRoleStatusSummary`, `roleLifecycle`, `runningRoleIdsFromRuns` and `createEvidenceVerifier` must not change. The existing tests in `tests/v7-wfr03-role-registry.test.ts` must stay green unedited.
7. `docs/lanes/LANE-C-MAP.md`: one C-RDY-1 entry (files, API, test file, mutant command, S-REG status, and the open RUNNING/AWAITING_APPROVAL question below).

Reuse by import. Do not copy any logic from these:
- `resolveRoleExecution` (`core/agents/role-execution.ts:77`)
- `PRODUCTION_EXECUTOR_ROUTES` (`core/agents/role-lifecycle.ts:13`)
- `STAGE_CONSUMERS` (`core/agents/first-delivery-bindings.ts:58`)
- `roleLifecycle` (`role-lifecycle.ts:57`)
- `runningRoleIdsFromRuns` (`:73`)
- `createEvidenceVerifier` (`:24`)
- `FIRST_DELIVERY_BINDINGS` (`first-delivery-bindings.ts:10`)

**Public API (`core/agents/readiness-audit.ts`)**

```ts
export const READINESS_LAYERS = ["DEFINED","PROFILED","KNOWLEDGE_READY","TOOL_READY","EXECUTABLE","EVALUATED","INTERNALLY_CERTIFIED","RUNNING"] as const;
export type ReadinessLayer = typeof READINESS_LAYERS[number];
export type LayerState = "TRUE" | "FALSE" | "UNKNOWN" | "NOT_APPLICABLE";
export type ReadinessReason = /* the closed union under "Reason codes" */;
export interface LayerResult { state: LayerState; reasons: readonly ReadinessReason[] } // sorted, de-duplicated; [] iff state === "TRUE"
export interface LayerCount { TRUE: number; FALSE: number; UNKNOWN: number; NOT_APPLICABLE: number; denominator: number; measured: boolean } // the four states sum to denominator; measured === (UNKNOWN === 0)
export interface AdapterRealityEntry { adapterId: string; codePath: "PRESENT" | "ABSENT"; probe: "READY" | "FAILED" | "NOT_OBSERVED" }
export interface KnowledgeUnitLike { facet: string; state: string; sourceRefs: readonly unknown[]; lastValidatedAt: string | null }
export interface ReadinessRole extends LifecycleRole { clusterId: string; requiredSkillIds: readonly string[]; requiredTechnologies: readonly {technologyId: string; status: string}[]; knowledgeSourceRefs: readonly unknown[]; runtimeStatus?: string }
export interface ProposedProfileLike { roleId: string; candidateSkills: {value: readonly string[]}; candidateToolAdapterIds: {value: readonly string[]} }
export const PROMOTED_TECHNOLOGY_STATUSES: ReadonlySet<string>; // = new Set<string>(): see the PROFILED rule
export interface ReadinessInput {
  roles: readonly ReadinessRole[];
  guilds: readonly {guildId: string; clusterId: string}[];
  clusters: readonly {clusterId: string}[];
  roleDefinitionsSha256: string;
  bindings: readonly RoleExecutionProfile[];
  verify: EvidenceVerifier;
  runs: RunsObservation;
  skillIds: ReadonlySet<string>;                                         // registries/skills-v2.json skills[].id
  technologies: ReadonlyMap<string, {status: string; knowledgeState: string}>; // key = technologies[].slug
  knowledgeProfiles: ReadonlyMap<string, readonly KnowledgeUnitLike[]>;  // key = slug; knowledge/technologies/<slug>.json knowledgeUnits
  sourceProvenance: {requiredFields: readonly string[]; certifiableClasses: ReadonlySet<string>}; // registries/technology-source-registry.json
  proposedProfiles?: readonly ProposedProfileLike[];                     // registries/role-execution-profiles.json profiles[]; ONLY proposedOnly
  adapterReality?: ReadonlyMap<string, AdapterRealityEntry>;             // absent => bound roles get TOOL_READY UNKNOWN
  reachableStages?: ReadonlySet<string>;                                 // absent => stageWired UNKNOWN
  promotedTechnologyStatuses?: ReadonlySet<string>;                      // default PROMOTED_TECHNOLOGY_STATUSES; tests only
  now: Date;
}
export type ReadinessAnomaly =
  | {kind: "LAYER_ORDER"; detail: string}
  | {kind: "REGISTRY_CLAIM_EXCEEDS_EVIDENCE"; field: "runtimeStatus" | "proficiencyStatus" | "evaluationSpecs.status"; value: string};
export interface RoleReadiness {
  roleId: string; guildId: string; clusterId: string;
  layers: Readonly<Record<ReadinessLayer, LayerResult>>;                 // layers.EXECUTABLE === executable.codePath
  executable: {codePath: LayerResult; stageWired: LayerResult; consumingStages: readonly string[]};
  proposedOnly: {candidateSkills: number; candidateToolAdapterIds: number};
  anomalies: readonly ReadinessAnomaly[];
}
export interface ReadinessGroupRow {
  id: string; kind: "GUILD" | "CLUSTER"; clusterId: string | null; roles: number;
  layers: Readonly<Record<ReadinessLayer, LayerCount>>; stageWired: LayerCount;
  proposedOnly: {withCandidateSkills: number; withCandidateToolAdapters: number};
}
export interface ReadinessAudit {
  schemaVersion: "1.0.0"; authority: "AUTHORITATIVE_READINESS_MEASUREMENT";
  denominator: number;
  totals: Readonly<Record<ReadinessLayer, LayerCount>>; stageWired: LayerCount;
  byGuild: readonly ReadinessGroupRow[];      // one row per guild in guilds[] ∪ roles' guildIds, sorted by id
  byCluster: readonly ReadinessGroupRow[];    // one row per cluster in clusters[] ∪ roles' clusterIds, sorted by id
  reasonCounts: Readonly<Record<string, Readonly<Record<string, number>>>>; // keys: each layer + "EXECUTABLE.stageWired"
  proposedOnly: {source: "PROPOSED_DERIVED_NOT_RUNTIME" | "ABSENT"; profiles: number; withCandidateSkills: number; withCandidateToolAdapters: number};
  inputs: {journal: "PRESENT" | "ABSENT"; adapterReality: "SUPPLIED" | "NOT_SUPPLIED"; reachableStages: "SUPPLIED" | "NOT_SUPPLIED"; backendEnabled: "UNKNOWN";
           roleDefinitionsSha256: string; bindingsCount: number; skillIds: number; technologies: number; knowledgeProfiles: number};
  anomalies: number;
  roles: readonly RoleReadiness[];            // sorted by roleId
  computedAt: string;                         // now.toISOString()
  digest: string;                             // sha256 hex of stable (sorted-key) JSON of the audit without computedAt and digest
}
export function computeRoleReadiness(i: ReadinessInput): ReadinessAudit;
export function loadReadinessInputFromRepo(repoRoot: string, o: {runs: RunsObservation; adapterReality?: ReadonlyMap<string, AdapterRealityEntry>; reachableStages?: ReadonlySet<string>; now: Date}): ReadinessInput;
export interface LegacyReconciliation {
  status: "DEPRECATED_LEGACY_PROJECTION"; authority: "readiness"; consistent: boolean; mismatches: readonly string[];
  runningMeasured: boolean; implementedMeaning: "EXECUTABLE_CODE_PATH_INCLUDES_UNWIRED_STAGES"; implementedStageWired: number | "UNKNOWN";
}
export function reconcileLegacyStatusSummary(legacy: RoleStatusSummary, audit: ReadinessAudit): LegacyReconciliation;
```

`loadReadinessInputFromRepo` reads exactly these files and nothing else:
- `registries/role-definitions.json`: roles, guilds and clusters, plus the sha256 of the raw bytes.
- `registries/skills-v2.json`: `skills[].id`.
- `registries/technologies.json`: `technologies[]` slug, status and knowledgeState.
- `knowledge/technologies/<slug>.json`: `knowledgeUnits`, for every slug (415 files at 0ddb170).
- `registries/technology-source-registry.json`: `requiredProvenance`, and the `sourceClasses[]` whose `allowedForCertification === true`.
- `registries/role-execution-profiles.json`: `profiles[]`.

It sets `bindings = FIRST_DELIVERY_BINDINGS` and `verify = createEvidenceVerifier(repoRoot)`. On a missing or unparsable file it throws `READINESS_INPUT_UNAVAILABLE:<repo-relative path>`; it never substitutes empty data. It never writes.

**Authority and reconciliation (single source of truth)**
- `computeRoleReadiness` is the authoritative readiness measurement.
- There is one rule implementation. EXECUTABLE (code path), EVALUATED and INTERNALLY_CERTIFIED are derived by calling `roleLifecycle()` for each role, not by re-implementing it, so they cannot drift from the legacy counters.
- `computeRoleStatusSummary` stays, with byte-compatible output: the renderer's strict mapper rejects a non-integer `running`. It is marked `@deprecated` and classified `DEPRECATED_LEGACY_PROJECTION`.
- `reconcileLegacyStatusSummary(legacy, audit)` on identical input returns `consistent === true` iff all of these hold, in total and for every `byGuild` row:
  - `legacy.registered === totals.DEFINED.TRUE`
  - `legacy.implemented === totals.EXECUTABLE.TRUE`
  - `legacy.tested === totals.EVALUATED.TRUE`
  - `legacy.certified === totals.INTERNALLY_CERTIFIED.TRUE`
  - `legacy.running === totals.RUNNING.TRUE`

  Each failed equality appears in `mismatches` as `"<total|guildId>.<counter>:<legacy>!=<audit>"`. `runningMeasured === (audit.inputs.journal === "PRESENT")`. `implementedStageWired` is `audit.stageWired.TRUE` when reachableStages was supplied, else `"UNKNOWN"`.
- Consumers:
  - Lane B (B1) returns `readiness`, `statusSummaryStatus: "DEPRECATED_LEGACY_PROJECTION"` and `reconciliation` next to the unchanged `statusSummary`.
  - Lane A (A1) renders only `readiness`, and never shows `statusSummary.running` as a number while `runningMeasured` is false.
  - Removing `statusSummary` from the response is a later B/A package, once no consumer reads it.
  - Do not edit `role-status.ts` or any renderer file in this package.

**Layer rules (per role r; binding = `bindings.find(b => b.roleId === r.roleId)`)**
- **DEFINED.** TRUE iff all of these hold:
  - `r.roleId` matches `^UASCO-\d{4}$` and occurs exactly once in roles[];
  - `r.guildId` is a `guilds[].guildId`;
  - `r.clusterId` equals that guild's clusterId.

  Otherwise FALSE with every applicable reason of BAD_ROLE_ID, DUPLICATE_ROLE_ID, GUILD_NOT_IN_REGISTRY and CLUSTER_MISMATCH. Never UNKNOWN.
- **PROFILED (canonical record only).** TRUE iff all of these hold:
  - `requiredSkillIds` is non-empty, and every id is in `skillIds`;
  - `requiredTechnologies` is non-empty;
  - every `requiredTechnologies[].technologyId` is in `technologies`;
  - every `requiredTechnologies[].status` is in `promotedTechnologyStatuses`.

  Otherwise FALSE with every applicable reason of NO_CANONICAL_SKILLS, SKILL_NOT_IN_SK2, NO_REQUIRED_TECHNOLOGIES, TECHNOLOGY_NOT_IN_REGISTRY and TECHNOLOGY_STATUS_NOT_PROMOTED. `proposedProfiles` never influence this layer.

  This layer is structurally 0. `PROMOTED_TECHNOLOGY_STATUSES` is the empty set because only two status values exist, CANDIDATE_NOT_VERIFIED and NAME_NOT_VERIFIED_IN_REGISTRY. Both are emitted by `scripts/build-role-definitions.mjs:218-219`, and no schema, code path or authority defines a verified status. PROFILED is therefore FALSE for 599/599 by construction until both of these happen:
  - FD-1 (alias approval) makes canonical `requiredSkillIds` non-empty;
  - FD-9 (the Founder / Lane S technology-verification authority) names the promoted status value.

  Adding a value to the set needs that decision recorded under `docs/authority-requests/`, and is out of scope here. Production callers must not pass `promotedTechnologyStatuses`; tests may.
- **KNOWLEDGE_READY.** If `requiredTechnologies` is empty, the state is UNKNOWN (NO_REQUIRED_TECHNOLOGIES), never TRUE. Otherwise TRUE iff `knowledgeSourceRefs` is non-empty AND every required technology slug has a knowledge profile with at least one unit where all of these hold:
  - `state !== "NOT_RESEARCHED"`;
  - `lastValidatedAt` is an ISO-8601 UTC timestamp;
  - `sourceRefs` is non-empty, and every sourceRef is an object that has every key of `sourceProvenance.requiredFields`. At 0ddb170 those keys are sourceId, uriOrLocator, sourceClass, effectiveVersion, fetchedAt, digestOrRevision and supersedes;
  - in each sourceRef, sourceId, uriOrLocator, effectiveVersion (the pinned version) and digestOrRevision are non-empty strings, fetchedAt (the retrieval date) is ISO-8601, and sourceClass is in `certifiableClasses`.

  Otherwise FALSE with every applicable reason of ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY, KNOWLEDGE_PROFILE_MISSING and NO_RESEARCHED_SOURCED_UNIT.
- **TOOL_READY.**
  - No binding: FALSE (ROLE_HAS_NO_BINDING).
  - `binding.adapters` is empty: FALSE (ADAPTERS_MISSING).
  - `adapterReality` absent: UNKNOWN (ADAPTER_REALITY_NOT_SUPPLIED).
  - Otherwise each adapter id is checked:
    - no entry: FALSE (ADAPTER_UNRESOLVED);
    - `codePath` "ABSENT": FALSE (ADAPTER_CODE_ABSENT);
    - `probe` "FAILED": FALSE (PROBE_FAILED);
    - `probe` "NOT_OBSERVED": UNKNOWN (PROBE_NOT_OBSERVED);
    - PRESENT and READY: the adapter passes.
  - Combining: any FALSE gives FALSE with all reasons; otherwise any UNKNOWN gives UNKNOWN; otherwise TRUE.

  Non-empty adapter strings never make this layer TRUE. The `implementation` field of `registries/tool-adapters.json` is never read.
- **EXECUTABLE (code path).** TRUE iff `roleLifecycle(r, roles, ctx).implemented`. That means `resolveRoleExecution` returns EXECUTABLE AND `binding.providerRoute` is in `PRODUCTION_EXECUTOR_ROUTES` (CLAUDE_IMPLEMENTER, CLAUDE_REVIEWER) AND `binding.function` is in `consumedFunctions()`. Otherwise FALSE with either the NotExecutableReason that `resolveRoleExecution` returned (for example ROLE_HAS_NO_BINDING), or ROUTE_NOT_PRODUCTION_EXECUTOR and/or STAGE_NOT_CONSUMED. UASCO-0232 (delivery, DETERMINISTIC_STUDIO) gets both. Never UNKNOWN. The resolver label EXECUTABLE (9 roles today) is not this layer.
- **EXECUTABLE.stageWired** (reported separately, never merged into EXECUTABLE).
  - Code path not TRUE: FALSE (NO_CODE_PATH).
  - `reachableStages` absent: UNKNOWN (REACHABLE_STAGES_NOT_SUPPLIED).
  - Otherwise TRUE iff some stage s with `binding.function` in `STAGE_CONSUMERS[s]` is in `reachableStages`, else FALSE (STAGE_NOT_WIRED).

  Backend enablement (LOCAL_CLAUDE ON/READY on a machine) is never computed: `inputs.backendEnabled` is the constant "UNKNOWN".
- **EVALUATED.**
  - `evaluationSpecs` empty: FALSE (NO_EVALUATION_SPECS).
  - TRUE iff `roleLifecycle(...).tested`: at least one spec has `status !== "NOT_EXECUTED"` and its `evaluatorEvidenceRef` passes `verify(ref, roleId, evaluationId, status) === null`. The verifier rejects FAKE evidence.
  - Otherwise FALSE: NO_SPEC_EXECUTED when every spec is NOT_EXECUTED; EVIDENCE_REJECTED when at least one spec claims execution and no claim verifies.

  CI test runs never feed this layer.
- **INTERNALLY_CERTIFIED.** TRUE iff `roleLifecycle(...).certified`. Otherwise FALSE: NOT_CERTIFIED_STATUS when `proficiencyStatus !== "CERTIFIED"`; CERTIFICATION_EVIDENCE_INVALID when it claims CERTIFIED and the lifecycle rule fails. The lifecycle rule already excludes vacuity (`specs.length === 6`, `refs.length > 0`).
- **RUNNING.**
  - Journal ABSENT: UNKNOWN (NO_RUN_JOURNAL) for every role. The aggregate then has `measured: false` and must never be presented as 0.
  - Journal PRESENT: TRUE iff `r.roleId` is in `runningRoleIdsFromRuns(runs.runs, knownRoleIds)`, else FALSE (NOT_IN_OPEN_RUN).

  Open question (do not change it here): `runningRoleIdsFromRuns` treats every non-terminal status as open, including AWAITING_APPROVAL (`role-lifecycle.ts:76` vs `core/workos/run-state.ts:40` `isOpenRun`). Record this in LANE-C-MAP.md.
- **No vacuous truth anywhere.** An empty list never yields TRUE:
  - PROFILED needs non-empty skills and technologies;
  - KNOWLEDGE_READY is UNKNOWN when there are no technologies;
  - TOOL_READY is FALSE when there are no adapters;
  - EVALUATED is FALSE when there are no specs;
  - INTERNALLY_CERTIFIED needs 6/6 specs.

  NOT_APPLICABLE is not used for canonical roles in this package; it is reserved for the entity audits in C-RDY-2b.
- **Anomalies.** Counted per role in `audit.anomalies`; they never change a layer.
  - LAYER_ORDER when any of these hold:
    - EVALUATED TRUE while EXECUTABLE is not TRUE;
    - INTERNALLY_CERTIFIED TRUE while EVALUATED is not TRUE;
    - RUNNING TRUE while EXECUTABLE is not TRUE.
  - REGISTRY_CLAIM_EXCEEDS_EVIDENCE when any of these hold:
    - `runtimeStatus` is present and `!== "UNKNOWN"` while RUNNING is not TRUE;
    - `proficiencyStatus !== "NOT_EVALUATED"` while EVALUATED is not TRUE;
    - `proficiencyStatus === "CERTIFIED"` while INTERNALLY_CERTIFIED is not TRUE;
    - any spec status `!== "NOT_EXECUTED"` while EVALUATED is not TRUE.
- **Aggregation.**
  - Each LayerCount counts roles by state; its denominator is the number of roles in the group, and the totals denominator is roles.length.
  - `byGuild` has a row for every guild in guilds[], including guilds with 0 roles; `byCluster` has a row for every cluster in clusters[].
  - For every layer and every state, the byGuild sum equals the total, and so does the byCluster sum.
- **Determinism.**
  - Roles are sorted by roleId and reasons are sorted.
  - The digest is the sha256 of stable sorted-key JSON of the audit with computedAt and digest removed.
  - Input array order and `now` do not change the digest.

**Reason codes (closed union; any other string is a type error)**
- DEFINED: BAD_ROLE_ID, DUPLICATE_ROLE_ID, GUILD_NOT_IN_REGISTRY, CLUSTER_MISMATCH
- PROFILED: NO_CANONICAL_SKILLS, SKILL_NOT_IN_SK2, NO_REQUIRED_TECHNOLOGIES, TECHNOLOGY_NOT_IN_REGISTRY, TECHNOLOGY_STATUS_NOT_PROMOTED
- KNOWLEDGE_READY: NO_REQUIRED_TECHNOLOGIES, ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY, KNOWLEDGE_PROFILE_MISSING, NO_RESEARCHED_SOURCED_UNIT
- TOOL_READY: ROLE_HAS_NO_BINDING, ADAPTERS_MISSING, ADAPTER_REALITY_NOT_SUPPLIED, ADAPTER_UNRESOLVED, ADAPTER_CODE_ABSENT, PROBE_FAILED, PROBE_NOT_OBSERVED
- EXECUTABLE: every NotExecutableReason of `core/agents/role-execution.ts:8-10`, plus ROUTE_NOT_PRODUCTION_EXECUTOR and STAGE_NOT_CONSUMED
- EXECUTABLE.stageWired: NO_CODE_PATH, REACHABLE_STAGES_NOT_SUPPLIED, STAGE_NOT_WIRED
- EVALUATED: NO_EVALUATION_SPECS, NO_SPEC_EXECUTED, EVIDENCE_REJECTED
- INTERNALLY_CERTIFIED: NOT_CERTIFIED_STATUS, CERTIFICATION_EVIDENCE_INVALID
- RUNNING: NO_RUN_JOURNAL, NOT_IN_OPEN_RUN

**Acceptance tests.** All in `tests/v7-core-readiness-audit.test.ts` under `describe("C-RDY-1 readiness-audit")`. Use these exact `it` names. Real-registry cases read the checked-out repo through `loadReadinessInputFromRepo`. Fixture cases build a `ReadinessInput` in memory. Evidence and loader cases use a tmp repo root.
- **T1 "real registries: layer totals at the branch tip".** Journal ABSENT, no adapterReality, no reachableStages.
  - denominator 599.
  - DEFINED: TRUE 599.
  - PROFILED: TRUE 0, FALSE 599 (reasonCounts NO_CANONICAL_SKILLS 599, TECHNOLOGY_STATUS_NOT_PROMOTED 599).
  - KNOWLEDGE_READY: TRUE 0, FALSE 599 (ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY 599, NO_RESEARCHED_SOURCED_UNIT 599).
  - TOOL_READY: TRUE 0, UNKNOWN 9 (ADAPTER_REALITY_NOT_SUPPLIED 9), FALSE 590 (ROLE_HAS_NO_BINDING 590).
  - EXECUTABLE: TRUE 8, FALSE 591 (ROLE_HAS_NO_BINDING 590; UASCO-0232 with ROUTE_NOT_PRODUCTION_EXECUTOR and STAGE_NOT_CONSUMED).
  - stageWired: UNKNOWN 8, FALSE 591 (NO_CODE_PATH 591).
  - EVALUATED: FALSE 599 (NO_SPEC_EXECUTED 599).
  - INTERNALLY_CERTIFIED: FALSE 599 (NOT_CERTIFIED_STATUS 599).
  - RUNNING: UNKNOWN 599, TRUE 0, measured false.
  - proposedOnly: profiles 599, withCandidateSkills 197, withCandidateToolAdapters 164.
  - anomalies 0.
- **T2 "legacy parity and reconciliation".**
  - On the same input, computeRoleStatusSummary gives registered 599, implemented 8, tested 0, certified 0, running 0.
  - reconcileLegacyStatusSummary returns consistent true, mismatches [], runningMeasured false, implementedStageWired "UNKNOWN".
  - A legacy copy with total implemented 9 gives consistent false and mismatch "total.implemented:9!=8".
  - A legacy copy with byGuild G08 implemented 0 gives mismatch "G08.implemented:0!=1".
- **T3 "stage wiring is separate and never defaulted".**
  - reachableStages {IMPLEMENT, REVIEW}: stageWired TRUE 3 (UASCO-0085, UASCO-0252, UASCO-0313), FALSE 596 (STAGE_NOT_WIRED 5, NO_CODE_PATH 591).
  - reachableStages {}: TRUE 0.
  - reachableStages undefined: UNKNOWN 8.
  - EXECUTABLE TRUE is 8 in all three cases.
- **T4 "evaluation evidence".** Tmp repo root with a verified non-FAKE EV-01 evidence file and artifact for UASCO-0085 (spec status PASSED, evaluatorEvidenceRef with the real sha256).
  - Verified evidence: EVALUATED TRUE for that role.
  - The same file with `fake: true`: FALSE (EVIDENCE_REJECTED).
  - A wrong sha256: FALSE (EVIDENCE_REJECTED).
  - All specs NOT_EXECUTED: FALSE (NO_SPEC_EXECUTED).
- **T5 "running needs a journal".**
  - Journal PRESENT with an open run whose AGENT_TRACE note contains `role=UASCO-0085`: RUNNING TRUE 1, FALSE 598, measured true.
  - The same run in a terminal status: TRUE 0, FALSE 599.
  - Journal ABSENT: UNKNOWN 599, measured false.
- **T6 "knowledge: no vacuous truth and full provenance".** Fixture role with knowledgeSourceRefs ["x"] and 1 technology.
  - Unit RESEARCHED with sourceRefs []: FALSE (NO_RESEARCHED_SOURCED_UNIT).
  - A sourceRef missing effectiveVersion: FALSE.
  - sourceClass REPUTABLE_SECONDARY: FALSE.
  - A complete sourceRef plus an ISO lastValidatedAt: TRUE.
  - requiredTechnologies []: UNKNOWN (NO_REQUIRED_TECHNOLOGIES), never TRUE.
  - knowledgeSourceRefs []: FALSE (ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY).
  - A slug without a profile: FALSE (KNOWLEDGE_PROFILE_MISSING).
- **T7 "profiled: canonical only, no vacuous truth".**
  - requiredSkillIds ["SK2-NOPE"]: FALSE (SKILL_NOT_IN_SK2).
  - requiredSkillIds [] with a proposed profile holding 72 candidate skills: FALSE (NO_CANONICAL_SKILLS) and proposedOnly.candidateSkills 72.
  - A valid SK2 id plus technology status "FIXTURE_VERIFIED", default promoted set: FALSE (TECHNOLOGY_STATUS_NOT_PROMOTED).
  - The same with promotedTechnologyStatuses {"FIXTURE_VERIFIED"}: TRUE.
  - requiredTechnologies [] with that promoted set: FALSE (NO_REQUIRED_TECHNOLOGIES).
  - An unknown technology slug: FALSE (TECHNOLOGY_NOT_IN_REGISTRY).
- **T8 "groups, denominators, determinism".**
  - Real registries: byGuild has 51 rows and byCluster 10.
  - For every layer and state, the byGuild sum and the byCluster sum equal the totals, and every totals denominator is 599.
  - Guild denominators G35/G36/G37/G38 are 13/13/14/13 (sum 53), and CL07 is 53.
  - EXECUTABLE TRUE by guild is G03 3, G04 1, G05 1, G08 1, G22 1, G27 1, and 0 in every other guild, including G20.
  - A fixture with an extra guild G99 holding 0 roles yields a G99 row with denominator 0.
  - Two runs with different `now` give the same digest, and reversing roles[] gives the same digest.
  - Changing one role's proficiencyStatus changes the digest.
- **T9 "tool readiness needs code and an observed probe".** Fixture adapterReality.
  - Every adapter of the 9 bindings PRESENT + READY: TOOL_READY TRUE 9.
  - One adapter NOT_OBSERVED: that role is UNKNOWN (PROBE_NOT_OBSERVED).
  - One adapter missing from the map: FALSE (ADAPTER_UNRESOLVED).
  - codePath ABSENT: FALSE (ADAPTER_CODE_ABSENT).
  - A binding with adapters []: FALSE (ADAPTERS_MISSING).
- **T10 "anomalies are flagged, never promote".**
  - runtimeStatus "RUNNING" with the journal ABSENT: RUNNING stays UNKNOWN, plus anomaly REGISTRY_CLAIM_EXCEEDS_EVIDENCE(runtimeStatus).
  - proficiencyStatus "CERTIFIED" without evidence: INTERNALLY_CERTIFIED FALSE (CERTIFICATION_EVIDENCE_INVALID), plus the anomaly.
  - A spec with status "PASSED" and no ref: EVALUATED FALSE (EVIDENCE_REJECTED), plus the anomaly.
- **T11 "input loader fails closed".** A tmp repo root without `registries/skills-v2.json` throws `READINESS_INPUT_UNAVAILABLE:registries/skills-v2.json`; the loader never returns empty sets.

**Mutants.** Listed in `docs/lanes/LANE-C-readiness-audit-mutants.json`. Each must be KILLED by `node docs/lanes/LANE-C-readiness-audit-mutants.mjs`.

| Mutant | Change | Killed by |
|---|---|---|
| M1 | EXECUTABLE from the resolver label: drop the PRODUCTION_EXECUTOR_ROUTES / STAGE_CONSUMERS condition, so TRUE becomes 9 | T1, T2, T8 |
| M2 | Count proposedProfiles candidate skills as canonical skills | T1, T7 |
| M3 | Drop the verify() / FAKE check in EVALUATED | T4, T10 |
| M4 | RUNNING FALSE instead of UNKNOWN when the journal is ABSENT | T1, T5 |
| M5 | Accept empty sourceRefs in KNOWLEDGE_READY | T6 |
| M6 | TOOL_READY TRUE from non-empty adapter strings when adapterReality is absent | T1, T9 |
| M7 | stageWired defaults to the code path when reachableStages is undefined | T3 |
| M8 | KNOWLEDGE_READY TRUE with empty requiredTechnologies (vacuous every()) | T6 |
| M9 | PROFILED TRUE with empty requiredTechnologies | T7 |
| M10 | PROMOTED_TECHNOLOGY_STATUSES contains "CANDIDATE_NOT_VERIFIED" | T1, T7 |
| M11 | byGuild built only from roles' guildIds (guilds[] union dropped) | T8 (G99) |
| M12 | Digest includes computedAt | T8 |
| M13 | Reconciliation ignores byGuild | T2 (G08) |

**Protected paths.**
- This package's code, test and doc files are outside `config/protected-paths.json` exactPaths and protectedPrefixes at 0ddb170. The protected prefixes are automation/lib/, scripts/validate-, scripts/run-validation.mjs, the listed schemas/*, prompts/, roadmap/contracts/ and config/.
- Do not modify any protected path, any file under `registries/` or `knowledge/`, `apps/control-api/**`, `apps/desktop/**`, `core/workos/runner.ts` or `core/workos/executors.ts`.
- **Step S-REG is protected. Lane C does not perform it.** CI runs only the test files listed in `config/validation.json` steps. Each step carries an explicit vitest file list; `scripts/run-validation.mjs` runs the steps (on Windows per shard, `--shard N/3`) and `scripts/validate-shards.mjs` aggregates the Windows shards. `tests/v7-core-readiness-audit.test.ts` therefore runs in CI only after it is appended. `config/validation.json` is a protected exact path, sits under the protected `config/` prefix, and is sealed in `config/trust-root-manifest.json`.
- S-REG has two parts:
  - (1) TEST_REGISTRATION_APPEND: append `"tests/v7-core-readiness-audit.test.ts"` as the last element of the `command` array of step `tests-8` (`config/validation.json:429-467`), and change nothing else. tests-8 is the last tests shard by `isShard`, `core/authority/autonomous-authority.mjs:391-431`, and runs on Windows shard 1 per `shardPlan.win32.assign`.
  - (2) TRUST_ROOT_RESEAL of the `config/validation.json` entry in `config/trust-root-manifest.json`, computed from the real head bytes.
- Tier: the Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED. The tier label is the supervisor's; `git grep -i preauthori` finds it nowhere in the repo at 0ddb170. The class's structural check is defined at `core/authority/autonomous-authority.mjs:22,391-428`. It is granted to MAINTAINER only in `docs/authority/autonomous-authority-policy.proposed.json:40`, whose own `//TR` line (:2) says it is not yet an authority source. `config/autonomous-authority-policy.json` does not exist at 0ddb170, so the autonomous engine cannot authorize S-REG today. S-REG goes through the Founder-tier protected path.
- Sequencing: `config/trust-root-manifest.json` is also modified by open PRs #231, #242, #247 and #251, so the reseal must be recomputed on the base that is current when S-REG runs.
- Lane C writes the request in `docs/authority-requests/LANE-C-readiness-audit-test-registration.md` and stops there.

**In-flight overlap.** Open PRs to v7/integration at 2026-10-26T19:04:39Z, from GitHub REST `/pulls/<n>/files`: #259, #258, #257, #256, #251, #247, #242, #231, #66.
- Package files: no open PR touches `core/agents/readiness-audit.ts`, `core/agents/role-lifecycle.ts`, `tests/v7-core-readiness-audit.test.ts`, `docs/lanes/LANE-C-MAP.md`, `docs/lanes/LANE-C-readiness-audit-mutants.*` or `docs/authority-requests/LANE-C-readiness-audit-test-registration.md`.
- Imported modules: no open PR touches `core/agents/role-execution.ts`, `core/agents/first-delivery-bindings.ts` or `core/workos/run-state.ts`. #231 touches `core/agents/linux-unshare-sandbox.ts`, which is in the same directory but is not imported.
- S-REG: no open PR touches `config/validation.json`. `config/trust-root-manifest.json` is touched by #231, #242, #247 and #251.

**Out of scope**
- Any edit under `registries/**` or `knowledge/**`, including any status field.
- `apps/control-api/**`: `routes/role-status.ts` is Lane B task B1; `server.ts` is protected and in flight in #231 and #242.
- `apps/desktop/**` (Lane A task A1).
- Writing or promoting evidence (`audit/evidence/**`).
- `core/workos/runner.ts`, `core/workos/executors.ts`, `core/workos/predev/**`.
- The adapter reality map and probes (C-RDY-2a), the skill and technology entity audits (C-RDY-2b), and the role context resolver (C-CTX-1).
- `config/validation.json` and `config/trust-root-manifest.json` (S-REG, protected).
- Changing `computeRoleStatusSummary` output, `roleLifecycle` semantics or `runningRoleIdsFromRuns` semantics.
- Defining a verified technology status (FD-9) or approving aliases (FD-1).

**Definition of Done**
- CODE_COMPLETE (the Lane C PR):
  1. `git diff --name-only <base>..HEAD` lists exactly the 7 files above.
  2. `npx vitest run tests/v7-core-readiness-audit.test.ts` passes T1-T11 under the names above, and `npx vitest run tests/v7-wfr03-role-registry.test.ts` passes with that file unedited (legacy parity).
  3. `node docs/lanes/LANE-C-readiness-audit-mutants.mjs` prints KILLED for M1-M13 and exits 0 (baseline green, 0 survivors, 0 skipped). Its output goes in the PR description.
  4. `node node_modules/typescript/bin/tsc --noEmit` and `node scripts/validate-tr-comments.mjs` pass. Every new .ts, .mjs, .md and .json file carries a literal `//TR` purpose line in its first 60 lines.
  5. The PR description says "adds the measurement; no user-visible number changes until B1 + A1", lists the T1 numbers with their source (file and field), and links the S-REG request.
- DONE (supervisor-owned):
  - the supervisor's validation and the governed CLAUDE_REVIEWER review are CLEAN on the exact commit;
  - S-REG has merged;
  - CI on v7/integration runs `tests/v7-core-readiness-audit.test.ts` in step tests-8 on Linux and Windows, and it passes.

  Until S-REG merges, the package status is CODE_COMPLETE_NOT_CI_REGISTERED, not DONE.
