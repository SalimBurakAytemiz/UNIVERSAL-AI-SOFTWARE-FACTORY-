# UASCO Master V2 MODE B - Wave 0 baseline

Revision: fix-pass-1: all 13 critic issues of workflow wf_0abafbaa-424 (verdict NEEDS_FIX) applied; JSON and MD rendered from the same data by one script.

Inspected: requested base `5dd3614`, integration tip `0ddb170`. 10 commits after 5dd3614 (merges #254 and #255, Lane A); 5 files changed: apps/desktop/renderer/locales/tr.js, docs/authority-requests/LANE-A-win-e2e.md, scripts/e2e/desktop-journey.e2e.mjs, tests/v7-b5-work-screens.test.ts, tests/v7-ux-journey.test.ts. No change under registries/, core/agents, core/competency, core/knowledge, core/academy, core/capabilities.

Recount: Synthesizer recounted with node at 0ddb170; results match the area reports: roles 599, guilds 51, clusters 10, specs 3594 (all NOT_EXECUTED), requiredSkillIds/toolAdapterIds/knowledgeSourceRefs non-empty 0/0/0, technologies 415 (all SEED_PROFILE, 0 officialSourceRefs), tool adapters 194 (all NOT_IMPLEMENTED), skills-v2 425 (all NOT_CERTIFIED), skills v1 1186, binders 16 and capabilities 110 (all NOT_IMPLEMENTED), fabrics 45, profiles 599 PROPOSED_DERIVED_NOT_RUNTIME, knowledge profiles 415 holding 6225 units (all NOT_RESEARCHED), genomes 363, agents.json 363, evaluations/agents 363, audit/evidence absent.

Fix pass: 2026-10-26: counts re-derived with python3 over `git show 0ddb170:<file>` extracts (registries/role-definitions.json, role-execution-profiles.json, technologies.json, tool-adapters.json, skills-v2.json, agent-skill-matrix.json, agent-tool-policy-v2.json, capabilities.json, execution-fabrics.json, execution-binders.json, implementation-reality.json, technology-source-registry.json, config/validation.json, config/protected-paths.json, config/trust-root-manifest.json, knowledge/technologies/ file list) and GitHub REST /pulls?state=open&base=v7/integration plus /pulls/<n>/files for all 9 open PRs, fetched 2026-10-26T19:04:39Z. No repository file was modified.

Rule: a JSON record is never evidence of execution. UNKNOWN means the input needed to decide is not in the repository. Every number carries its source.

## 1. Readiness layers

| Layer | Meaning |
|---|---|
| DEFINED | A record exists in a registry. |
| PROFILED | A normalized role/skill/technology mapping exists in the canonical record. PROPOSED_DERIVED data is counted separately and never as PROFILED. |
| KNOWLEDGE_READY | Knowledge is source-backed and researched: official source, pinned version, retrieval date, research state above NOT_RESEARCHED. |
| TOOL_READY | A real adapter code path exists and a probe of it succeeds. |
| EXECUTABLE | Code can run the role or tool through a real backend (static code path; reachability reported separately). |
| EVALUATED | A real, non-FAKE executed evaluation produced verifiable evidence. |
| INTERNALLY_CERTIFIED | A scoped qualification record backed by verified evidence. |
| RUNNING | Observed running in a real mission (AGENT_TRACE in an open run of a live journal). |

State semantics: Every layer is TRUE, FALSE, UNKNOWN or NOT_APPLICABLE per entity. A count reports TRUE only, always with its denominator; UNKNOWN is shown next to it and is never added to TRUE or FALSE. "0 (structural)" means no code path exists that could make the layer TRUE. UNKNOWN means code exists but the observation needed (a run journal, a probe result, machine state) is not in the repository. No layer is TRUE for an empty input list (no vacuous truth).

Evidence classes (never counted as a layer):

- PROPOSED_DERIVED: Generated proposals (registries/role-execution-profiles.json, status PROPOSED_DERIVED_NOT_RUNTIME). Reported under proposedOnly; never counted as PROFILED.
- LEGACY_REFERENCE: Referenced by frozen legacy records (registries/agents.json, agent-skill-matrix.json, agent-tool-policy-v2.json). Never counted as PROFILED for canonical roles.
- CI_EXERCISED: Exercised by unit tests in CI; no evaluation record exists in the repository (audit/evidence absent). Never counted as EVALUATED.
- FAKE_ONLY: Only a fake binary or test double has been run. Never counted as EVALUATED or TOOL_READY.
- RESOLVER_LABEL: resolveRoleExecution returns EXECUTABLE. Not the EXECUTABLE layer: the layer also needs a production executor route and a consuming stage (role-lifecycle.ts:12-13,59).

## 2. Baseline (real denominators)

| Entity | Denominator | DEFINED | PROFILED | KNOWLEDGE_READY | TOOL_READY | EXECUTABLE | EVALUATED | INTERNALLY_CERTIFIED | RUNNING |
|---|---|---|---|---|---|---|---|---|---|
| Canonical roles | 599 | 599/599 | 0/599 canonical (requiredSkillIds and toolAdapterIds empty 599/599). PROPOSED_DERIVED (not counted): 599/599 profiles, candidate skills 197/599, candidate adapters 164/599 | 0/599 (knowledgeSourceRefs empty 599/599) | TRUE 0/599. UNKNOWN 9/599 (the 9 bound roles: adapter code exists, no probe was ever observed; C-RDY-1 reason ADAPTER_REALITY_NOT_SUPPLIED). FALSE 590/599 (ROLE_HAS_NO_BINDING). The 10 distinct binding adapter ids resolve to 0/194 registry adapters; their tools are the Claude Code allowlists only | EXECUTABLE (code path) 8/599. Reachability, reported separately: stage-wired IMPLEMENT/REVIEW 3/599 (UASCO-0085, UASCO-0313, UASCO-0252); in the packaged Desktop default flow 2/599 (0085 IMPLEMENT, 0252 REVIEW; 0313 only via an API roleId); PREDEV_PRODUCE 0/5 (not wired, server.ts:258); backend LOCAL_CLAUDE enabled/READY: UNKNOWN per machine. Note: the resolver label EXECUTABLE is 9/599 because it includes UASCO-0232 (delivery, DETERMINISTIC_STUDIO, consumed by no stage); that label is not this layer | 0/599 | 0/599 | UNKNOWN 599/599 (no live run journal is read by this baseline; .ai/runtime is not in git). computeRoleStatusSummary reports running=0 when runs=[] (role-status.ts:19); that 0 is not a measurement |
| Guilds | 51 | 51/51 (0 role-count mismatches, 0 empty) | ownerRoleId set 0/51 (51 WFR-GAP-GUILD-OWNER gaps). Guilds holding a canonical PROFILED role: 0/51 (role level 0/599). Per-guild proposed-only counts in the guild table | Guilds holding a KNOWLEDGE_READY role: 0/51 | Guilds holding a TOOL_READY role: 0/51. 7/51 hold a bound role whose TOOL_READY is UNKNOWN (G03, G04, G05, G08, G20, G22, G27) | EXECUTABLE (code path): 6/51 guilds hold such a role (G03 3, G04 1, G05 1, G08 1, G22 1, G27 1). Stage-wired IMPLEMENT/REVIEW: 3/51 (G08, G22, G27). Note: 7/51 hold a bound role; the 7th is G20 (delivery UASCO-0232, not consumed, not counted) | 0/51 | 0/51 | UNKNOWN 51/51 (no run journal read) |
| Clusters | 10 | 10/10 (guildCount and roleCount fields match the guilds[]/roles[] data for 10/10; sums 51 guilds, 599 roles) | Clusters holding a canonical PROFILED role: 0/10 | Clusters holding a KNOWLEDGE_READY role: 0/10 | Clusters holding a TOOL_READY role: 0/10. 4/10 hold a bound role whose TOOL_READY is UNKNOWN (CL01, CL02, CL04, CL05) | EXECUTABLE (code path): 3/10 clusters (CL01 4 roles, CL02 2, CL05 2). Stage-wired IMPLEMENT/REVIEW: 2/10 (CL02 1, CL05 2). CL04 holds only the delivery binding (not counted) | 0/10 | 0/10 | UNKNOWN 10/10 (no run journal read) |
| Gaming guilds G35-G38 (cluster CL07) | 53 | 53/53 (G35 13, G36 13, G37 14, G38 13; all CL07, which is exactly these 4 guilds / 53 roles) | 0/53 canonical (requiredSkillIds and toolAdapterIds empty 53/53). PROPOSED_DERIVED (not counted): candidate skills 13/53 via SV aliases, candidate adapters 9/53; proposed routes CLAUDE_REVIEWER 40/53 (rule DEFAULT_LEAST_PRIVILEGE_READ_ONLY) and CLAUDE_IMPLEMENTER 13/53 (rule SEMANTIC_VERIFIED_ALIAS) | 0/53 (knowledgeSourceRefs empty 53/53). 35 distinct required technologies over 296 required entries, 296/296 CANDIDATE_NOT_VERIFIED; all 35 are in technologies.json with knowledgeState SEED_PROFILE (0 researched units) | TRUE 0/53; FALSE 53/53 (ROLE_HAS_NO_BINDING) | EXECUTABLE (code path) 0/53; stage-wired 0/53 (bound roles 0/53) | 0/53 (318 specs = 53 x 6, all NOT_EXECUTED) | 0/53 (proficiencyStatus NOT_EVALUATED 53/53) | UNKNOWN 53/53 (no run journal read) |
| Legacy genomes | 363 | 363/363 (organization/agents 363 = registries/agents.json 363 = evaluations/agents 363; frozen LEGACY_REFERENCE_ONLY) | 363/363 legacy-profiled with SK2 skills (19980 refs, 100% resolve, 20/44/156 per agent). Mapping to canonical roles (best status): SEMANTIC_VERIFIED 214, SUSPECTED 61, CONFLICT-only 55, REJECTED-only 2, none 31, EXACT 0. All 443 aliases approval=PROPOSED | 0/363 | 0/363 (363/363 DENY_BY_DEFAULT policies; 5670 candidate refs over 102 distinct adapter ids; 194/194 adapters NOT_IMPLEMENTED by registry) | N/A (legacy reference only) | 0/363 (NOT_EVALUATED; contracts name the retired Codex reviewer) | 0/363 | 0 (structural: LEGACY_REFERENCE_ONLY; no code path runs a legacy genome) |
| Role execution profiles | 599 | 599/599 | 0/599 PROFILED (PROPOSED_DERIVED is never PROFILED). PROPOSED_DERIVED (not counted): 599/599 profiles, 5990/5990 fields; route provenance 9/599 FIRST_DELIVERY_BINDING, 155/599 SEMANTIC_VERIFIED_ALIAS, 435/599 DEFAULT_LEAST_PRIVILEGE_READ_ONLY | 0/599 (knowledgeSources point only at SEED_PROFILE technologies) | 0/599 | 0/599 via profiles (structural: no runtime consumer; only a test and scripts/build-role-execution-profiles.mjs read the file) | 0/599 | 0/599 | 0 (structural: no runtime consumer) |
| Real execution bindings | 9 | 9/9 bindings exist (static table core/agents/first-delivery-bindings.ts:10-30) | 0/9 (binding has capability strings, no SK2 skill or verified technology mapping; requiredSkillIds empty for 9/9 bound roles) | 0/9 (knowledgeSources = the same 3 policy/inventory files for 9/9, no technology knowledge) | TRUE 0/9; UNKNOWN 9/9 (code paths exist for the binding adapter ids per the C-RDY-2a initial map; no probe was ever observed). Tools are fixed Claude Code allowlists (builder Read/Edit/Write/Glob/Grep; reviewer Read/Glob/Grep); 0/10 distinct binding adapter ids exist in tool-adapters.json | EXECUTABLE (code path) 8/9: IMPLEMENT 0085/0313, REVIEW 0252, PREDEV_PRODUCE 0019/0022/0023/0031/0043. Stage-wired 3/9 (IMPLEMENT/REVIEW). Note: resolver label 9/9 includes delivery 0232 (DETERMINISTIC_STUDIO, consumed by no stage) | 0/9 (8/9 have an EV-01 procedure and are plannable; 0 executed) | 0/9 | UNKNOWN 9/9; 1 historical LOCAL_CLAUDE smoke (2026-10-14) that predates roles and the SECURITY step |
| Technologies | 415 | 415/415 | 415/415 records carry type, group and ecosystem (46/46 groups exact). Taxonomy defects: 138 distinct types over 415 records; 73/138 types are singletons (1 record each) | 0/415 | N/A (data record) | 0 (structural: no runtime reader of technology data) | 0/415 | 0/415 | 0 (structural: no runtime reader of technology data) |
| Source-backed technologies | 415 | 415/415 | N/A (knowledge record) | 0/415 (0 official source URIs, 0 pinned versions, 0 retrieval dates) | N/A (knowledge record) | N/A (knowledge record) | 0/415 | 0/415 | N/A (knowledge record) |
| Technology knowledge profiles | 415 files / 6225 units | 415/415 files, 6225/6225 units (15 per file) | 415/415 files structurally consistent with the registry (0 field mismatches); structure only | 0/415 files; 0/6225 units (NOT_RESEARCHED 6225, NOT_CERTIFIED 6225, sourceRefs non-empty 0, lastValidatedAt set 0) | N/A (knowledge record) | N/A (knowledge record) | 0/6225 units | 0/6225 units | N/A (knowledge record) |
| Skills (skills-v2 SK2, canonical runtime ontology) | 425 | 425/425 | 0/425 canonical (0/599 roles declare requiredSkillIds). LEGACY_REFERENCE (not PROFILED): 402/425 referenced by the 363 legacy agents (19980 refs, 19980/19980 resolve), 23/425 unreferenced. PROPOSED_DERIVED (not PROFILED): candidate skills for 197/599 roles via SV aliases (397 distinct, 11041 refs) | 0/425 (freshness UNVERIFIED_UNTIL_EVALUATED 425/425; no source refs) | N/A | 0 (structural: no prompt or executor receives skill data, G10) | 0/425 | 0/425 (NOT_CERTIFIED 425/425) | 0 (structural: no prompt, executor or selector reads skill data, G10) |
| Skills v1 (legacy) and competency packs | 1186 skills / 40 packs | 1186/1186 skills LEGACY_REFERENCE_ONLY; 40/40 packs with 588 refs | 0/588 pack refs resolve in SK2 (588/588 are V1 SKILL-*); dependency graph 9 edges, 9/9 V1 | 0/1186 | N/A | 0 (structural: LEGACY_REFERENCE_ONLY) | 0/1186 | 0/1186 | 0 (structural: LEGACY_REFERENCE_ONLY) |
| Evaluation specs | 3594 | 3594/3594 (599 roles x 6 kinds) | N/A | UNKNOWN (the spec source text, the master V2 .md, is absent from the repo; FD-6) | N/A | 8/3594 have a procedure (EV-01 of the 8 code-path roles; 1 of 6 kinds). Refusals: ROLE_HAS_NO_BINDING 3540/3594, NO_PROCEDURE EV-02..EV-06 40/3594, delivery 6/3594 (8 + 3540 + 40 + 6 = 3594) | 0/3594 (NOT_EXECUTED 3594, evidenceRef null 3594) | 0/3594 | N/A |
| Executable evaluations | 8 | 8/8 plans | N/A | N/A | UNKNOWN (needs a Founder-enabled READY LOCAL_CLAUDE plus logged-in profiles; refused in CI) | 8/8 code paths (dry run by default) | 0/8 in the repo; staged evidence outside the repo is UNKNOWN | 0/8 | N/A |
| Certification records | 599 | No record file; certification = inline role fields + audit/evidence/role-evaluations/<role>/*.json#sha256 | N/A | N/A | N/A | 0 (structural: core/competency/certification.ts has a 9-state table but no runtime caller) | 0/599 | 0/599 meet the rule (proficiencyStatus NOT_EVALUATED 599, certifiedScope null 599) | N/A |
| Registered tool adapters | 194 | 194/194 (REGISTERED, requiresCertification=true) | 0/194 canonical (toolAdapterIds empty 599/599). LEGACY_REFERENCE (not PROFILED): 102/194 referenced by at least 1 of 363 legacy agent policies (5670 candidate refs); 92/194 never referenced | N/A | 0/194 by registry (implementation NOT_IMPLEMENTED 194/194). Code-level reality: next row | 0/194 by registry | 0/194 | 0/194 | 189/194: 0 (structural: no code path). 5/194 code-backed ids (gitleaks, trivy, ajv, ajv-formats, playwright): UNKNOWN (no run journal; .ai/runtime is not in git) |
| Adapters really executing in code | 9 tools examined (5 code-backed registry ids + 4 unregistered real tools); registry total 194 | 5/194 registry ids have real code (gitleaks, trivy, ajv, ajv-formats, playwright partial); 4 real but unregistered tools: git, npm, node, claude CLI (plus the linux unshare sandbox as an execution resource) | 0 (canonical toolAdapterIds empty 599/599). LEGACY_REFERENCE policy refs (not PROFILED): gitleaks 0/363, trivy 0/363, ajv 0/363, ajv-formats 0/363, playwright 5/363 policies. Correction: the synthesis said all code-backed ids had 0 refs | N/A | TRUE 0 observed. Probe code is present for gitleaks and trivy (discovery, version probe, sha256 re-check: security-tools.ts:39,68,79), but probe success is UNKNOWN (never observed: CI uses a fake binary; the real-gitleaks tests skip, tests/v7-b3c-security-stage.test.ts:443-446; .github/workflows has 0 gitleaks/trivy refs). semgrep, docker and 11 others: discovery only | Code path present for 8/9: gitleaks and trivy (SECURITY stage, runner.ts:990,1001,1019), ajv and ajv-formats (in-process production request validation), git, npm, node (real), claude CLI (via the broker when provenance PASSes). playwright: harness only, not run in CI (partial). Backend/run reachability: UNKNOWN | 0 for every tool (no evaluation record exists; audit/evidence absent). Evidence classes (not EVALUATED): CI_EXERCISED git, npm, node, ajv (unit tests); FAKE_ONLY gitleaks (fake binary; 5 real tests skipped) and trivy; not CI-executed: playwright harness | 0/9 | UNKNOWN for all of them (.ai/runtime is not in git; no run journal read) |
| Execution binders / capabilities / fabrics | 16 / 110 / 45 | 16/16, 110/110, 45/45 (status REGISTERED) | N/A | N/A | 0/16, 0/110, 0/45 by registry (implementation NOT_IMPLEMENTED 16/16, 110/110, 45/45) | 0 by registry. Name-matched partial code (inferred from names only; git grep finds 0 code references to these registry ids): capabilities 2/110 (UASCO-CAP-001 Mission OS, UASCO-CAP-032 Data Routing Policy), fabrics 3/45 (UASCO-FAB-003 Source Control & Workspace, UASCO-FAB-007 Universal Test Environment & Sandbox, UASCO-FAB-013 Security Engineering Lab), binders 0/16. The capability resolver core/capabilities/resolver.ts is dead code (no importer) | 0/16, 0/110, 0/45 | 0/16, 0/110, 0/45 | 0 (structural: no code) for binders 16/16, capabilities 108/110 and fabrics 42/45. UNKNOWN (partial code, no journal) for CAP-001, CAP-032, FAB-003, FAB-007 and FAB-013 |
| Execution backends | 2 | 2/2 | N/A | N/A | TRUE 0/2 observed. LOCAL_CLAUDE: UNKNOWN (dispatch CONFIGURED in config/execution-backends.json is a config field, not a probe; READY is runtime state). CLAUDE_CLOUD_SESSION: FALSE (NOT_CONFIGURED, adapter null) | Code path 1/2 (LOCAL_CLAUDE: real code, OFF by default; enabled/READY UNKNOWN per machine); CLAUDE_CLOUD_SESSION 0 (structural: adapter null) | 0/2 (the FAKE pair is TEST_ONLY; the 1 historical LOCAL_CLAUDE live smoke of 2026-10-14 is an execution record, not an evaluation) | 0/2 | LOCAL_CLAUDE UNKNOWN (no run journal read); CLAUDE_CLOUD_SESSION 0 (structural: no adapter) |

Evidence and notes per row:

- Canonical roles: registries/role-definitions.json:1807 roles[]; core/agents/role-execution.ts:77-86; core/agents/first-delivery-bindings.ts:10-30,55-58; core/agents/role-lifecycle.ts:57-70; apps/control-api/src/server.ts:78,258,313; apps/desktop/renderer/work-core.js:370; core/agents/role-lifecycle.ts:12-13,55,59 (production route + consuming stage)
- Guilds: registries/role-definitions.json guilds[] (:180-742) and roles[].guildId; core/agents/first-delivery-bindings.ts:10-30,58; per-guild table below
- Clusters: registries/role-definitions.json clusters[] (:118), guilds[].clusterId, roles[].clusterId; per-cluster table below
- Gaming guilds G35-G38 (cluster CL07): registries/role-definitions.json guilds[] G35-G38 (roleCount; G35 sourceLine 1578) and roles[]; registries/role-execution-profiles.json profiles[] (candidateSkills, candidateToolAdapterIds, route.value, route.provenance[0].rule); registries/technologies.json; knowledge/technologies/<slug>.json Notes: Gaps G02, G14 and G19 apply to this row; detail in gamingDetail
- Legacy genomes: registries/role-definitions.json:51-103,743; registries/agent-skill-matrix.json:4; registries/agent-tool-policy-v2.json; evaluations/agents/001.json:95
- Role execution profiles: registries/role-execution-profiles.json:4,23-37; core/agents/role-profile-derivation.ts:73-116
- Real execution bindings: core/agents/first-delivery-bindings.ts:5,10-30,58; core/agents/role-execution.ts:33-34,53; audit/checkpoints/V7-PKG-B3B-LIVE-SMOKE-EVIDENCE-2026-10-14.json; core/agents/role-lifecycle.ts:12-13,59
- Technologies: registries/technologies.json:4,17 technologies[] (type, group); registries/technology-groups.json; core/knowledge/technology-discovery.ts (test-only import)
- Source-backed technologies: registries/technologies.json key scan; registries/technology-source-registry.json requiredProvenance (sourceId, uriOrLocator, sourceClass, effectiveVersion, fetchedAt, digestOrRevision, supersedes)
- Technology knowledge profiles: knowledge/technologies/*.json (e.g. ruby.json:14,118)
- Skills (skills-v2 SK2, canonical runtime ontology): registries/skills-v2.json:4,8932 skills[]; registries/agent-skill-matrix.json agents[].requiredSkillIds; registries/role-execution-profiles.json candidateSkills; registries/skill-ontology-authority.json; core/workos/predev/role-prompts.ts (no skill reference)
- Skills v1 (legacy) and competency packs: registries/skills.json:4,46313; registries/competency-packs.json; registries/skill-dependency-graph.json
- Evaluation specs: registries/role-definitions.json:86-89; core/competency/evaluation-pipeline.ts:345-369,419
- Executable evaluations: core/competency/evaluation-cli.ts:47-69,87-93; core/competency/evaluation-pipeline.ts:44-62
- Certification records: core/agents/role-lifecycle.ts:15,24-45,63-68; scripts/validate-role-registry.mjs:200-214; core/competency/certification.ts:6-35
- Registered tool adapters: registries/tool-adapters.json:2 adapters[] (implementation field); registries/agent-tool-policy-v2.json policies[].candidateToolAdapterIds
- Adapters really executing in code: core/workos/security-tools.ts:22,68,77,136-139,228-236,283; automation/lib/git-isolation.mjs:23; scripts/claude-builder-broker.mjs:25-31; tests/v7-b3c-security-stage.test.ts:443-446; .github/workflows (0 gitleaks/trivy refs) Notes: evidenceClass: CI_EXERCISED (unit tests, no evaluation record) = git, npm, node, ajv; FAKE_ONLY = gitleaks, trivy; NOT_CI_EXECUTED = playwright
- Execution binders / capabilities / fabrics: registries/execution-binders.json:4-86; registries/capabilities.json:7,224; registries/execution-fabrics.json:21,49,91; core/capabilities/resolver.ts:14
- Execution backends: config/execution-backends.json:29-70; core/workos/executors.ts:148-174,301-359; apps/control-api/src/server.ts:278-285

Conflations found in the current counters and registries:

- role-lifecycle 'implemented'=8 counts 5 pre-dev roles whose stage (PREDEV_PRODUCE) is unreachable in the packaged server (no preDevBuilder, server.ts:258).
- GET /v1/roles/status-summary reports running=0 when no journal exists (role-status.ts:19 runs=[]); the honest value is UNKNOWN.
- Registry statuses under-report code (gitleaks, trivy, ajv, ajv-formats, playwright marked NOT_IMPLEMENTED) and over-report it (implementation-reality.json:10 lists the dead capability resolver as implemented; :40 lists the live action-gateway as not implemented).
- Binding adapter ids such as workos-predev-plan and local-claude-implementer exist only as strings; profileDefect checks only that the list is non-empty (role-execution.ts:53).
- The resolver label EXECUTABLE (9) is not the EXECUTABLE layer (8): UASCO-0232 delivery is DETERMINISTIC_STUDIO and is consumed by no stage (role-lifecycle.ts:12-13,59). Headline counts use the code path.
- Legacy-policy references (102/194 adapters, 402/425 skills) are LEGACY_REFERENCE and PROPOSED_DERIVED profiles are proposals; neither is PROFILED.
- Unit tests passing in CI (git, npm, node, ajv) leave no evaluation record; they are CI_EXERCISED, not EVALUATED.

### 2a. Gaming guilds G35-G38 (denominator 53)

| Guild | Name | Roles | Candidate skills (proposed) | Candidate adapters (proposed) | Proposed route IMPLEMENTER / REVIEWER | Bound | EXECUTABLE (code path) | RUNNING |
|---|---|---|---|---|---|---|---|---|
| G35 | Game Design Narrative World & Gameplay | 13 | 2/13 | 2/13 | 2 / 11 | 0/13 | 0/13 | UNKNOWN |
| G36 | Game Engine Graphics Physics & Simulation | 13 | 3/13 | 3/13 | 3 / 10 | 0/13 | 0/13 | UNKNOWN |
| G37 | Multiplayer Game Backend Netcode & LiveOps | 14 | 4/14 | 4/14 | 4 / 10 | 0/14 | 0/14 | UNKNOWN |
| G38 | Game Art Audio Animation & Asset Pipeline | 13 | 4/13 | 0/13 | 4 / 9 | 0/13 | 0/13 | UNKNOWN |
| Total |  | 53 | 13/53 | 9/53 | 13 / 40 | 0/53 | 0/53 | UNKNOWN |

- Required technologies: 35 distinct over 296 entries, status CANDIDATE_NOT_VERIFIED 296/296; in registry 35/35, all knowledgeState SEED_PROFILE, status REGISTERED. List: 3ds-max, airflow, autosar, axe-core, axum, blender, cpp, directx, dotnet, envoy, ffmpeg, figma, github, godot, grpc, k6, kafka, maya, nginx, openapi, opengl, opentelemetry, playwright, postgresql, prometheus, pytorch, redis, rust, syft, tokio, unity, unreal-engine, vulkan, webgpu, websocket
- Engine/graphics present only as SEED_PROFILE: unity, unreal-engine, godot, vulkan, directx, opengl, webgpu, blender, maya, 3ds-max, metal (in the registry; required by 0/53 gaming roles)
- Absent from registries/technologies.json: bevy, gamemaker, three.js / threejs, hlsl, glsl, wgsl, gdscript, lua, luau, c# / csharp, fmod, wwise, houdini (Case-insensitive match against technologies[].slug, name and aliases, plus a substring scan of the same fields; 0 hits for each listed name)
- Optional technologies: 55 entries, CANDIDATE_NOT_VERIFIED for all entries
- Anomalies: UASCO-0450 (G37, Principal Game Trust & Safety Expert) lists autosar (an automotive standard) as a required technology; UASCO-0424 (G36, Principal Game Engine Architect) gets the proposed route CLAUDE_REVIEWER from the read-only default (G19)
- Related gaps: G02 (53/53 have no binding); G14 (engine, shader and scripting technologies absent; validators pin the universe at 415); G19 (40/53 proposed routes are the read-only default)
- Evidence: registries/role-definitions.json guilds[] and roles[] (guildId G35-G38); registries/role-execution-profiles.json profiles[]; registries/technologies.json technologies[]

### 2b. Per-guild table (51 rows)

Source: registries/role-definitions.json guilds[] (guildId, name, clusterId, roleCount, ownerRoleId) and roles[] (guildId, requiredSkillIds, knowledgeSourceRefs, evaluationSpecs[].status, proficiencyStatus); registries/role-execution-profiles.json profiles[] (candidateSkills, candidateToolAdapterIds, route.value); core/agents/first-delivery-bindings.ts:10-30 (bindings), :58 (STAGE_CONSUMERS); core/agents/role-lifecycle.ts:13,59 (production routes, consumed stage); apps/control-api/src/server.ts:258 (PREDEV_PRODUCE not wired). Computed with python3 at 0ddb170.

Column rules:

- PROFILED: canonical requiredSkillIds non-empty (0/599 roles); proposed counts are separate
- KNOWLEDGE_READY: role knowledgeSourceRefs non-empty is necessary and is 0/599, so 0 in every guild
- TOOL_READY: TRUE never observed; UNKNOWN = bound roles (adapter code exists, probe not observed); FALSE = no binding
- EXECUTABLE_codePath: binding + production executor route + consuming stage (role-lifecycle.ts:59); delivery 0232 excluded
- stageWired_IMPLEMENT_REVIEW: code-path roles whose consuming stage is IMPLEMENT or REVIEW (the stages wired in the packaged server); backend enablement UNKNOWN
- EVALUATED: a spec not NOT_EXECUTED with verified evidence (0/3594 specs executed)
- RUNNING: UNKNOWN: no run journal is read

| Guild | Name | Cl | DEFINED | Owner | Bound roles | PROFILED | KNOWLEDGE_READY | TOOL_READY TRUE (UNKNOWN) | EXECUTABLE (code path) | Stage-wired IMPLEMENT/REVIEW | EVALUATED | INTERNALLY_CERTIFIED | RUNNING | Proposed skills / adapters | Proposed route IMPL/REV/STUDIO |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G01 | Founder Office & Corporate Governance | CL01 | 8/8 | null | - | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | UNKNOWN | 1/8 / 0/8 | 0/8/0 |
| G02 | Portfolio Program & Delivery | CL01 | 9/9 | null | - | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | UNKNOWN | 0/9 / 0/9 | 0/9/0 |
| G03 | Product Strategy Discovery & Requirements | CL01 | 13/13 | null | 0019, 0022, 0023 | 0/13 | 0/13 | 0/13 (UNKNOWN 3) | 3/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 8/13 / 2/13 | 0/13/0 |
| G04 | UX UI Design & Accessibility | CL01 | 11/11 | null | 0031 | 0/11 | 0/11 | 0/11 (UNKNOWN 1) | 1/11 | 0/11 | 0/11 | 0/11 | UNKNOWN | 6/11 / 2/11 | 6/5/0 |
| G05 | Enterprise Solution & Application Architecture | CL02 | 12/12 | null | 0043 | 0/12 | 0/12 | 0/12 (UNKNOWN 1) | 1/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 5/12 / 5/12 | 4/8/0 |
| G06 | Systems Languages Compilers & Runtime | CL02 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 0/12 / 0/12 | 0/12/0 |
| G07 | Frontend & Web Engineering | CL02 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 4/12 / 4/12 | 4/8/0 |
| G08 | Backend API & Application Services | CL02 | 14/14 | null | 0085 | 0/14 | 0/14 | 0/14 (UNKNOWN 1) | 1/14 | 1/14 | 0/14 | 0/14 | UNKNOWN | 7/14 / 7/14 | 7/7/0 |
| G09 | Distributed Realtime & Messaging Systems | CL02 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 3/12 / 3/12 | 3/9/0 |
| G10 | Desktop Native & Cross Platform | CL02 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 2/12 / 2/12 | 2/10/0 |
| G11 | Mobile Wearables & Device Engineering | CL02 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 6/13 / 6/13 | 6/7/0 |
| G12 | Database Storage & Data Engineering | CL03 | 14/14 | null | - | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | UNKNOWN | 5/14 / 5/14 | 5/9/0 |
| G13 | Analytics BI & Decision Science | CL03 | 10/10 | null | - | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | UNKNOWN | 2/10 / 2/10 | 1/9/0 |
| G14 | Search Recommendations & Information Retrieval | CL03 | 8/8 | null | - | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | UNKNOWN | 0/8 / 0/8 | 0/8/0 |
| G15 | AI ML & Model Engineering | CL03 | 16/16 | null | - | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | UNKNOWN | 1/16 / 1/16 | 1/15/0 |
| G16 | Agent Systems & Model Operations | CL03 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 3/13 / 3/13 | 3/10/0 |
| G17 | AI Safety Security & Assurance | CL03 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 2/12 / 2/12 | 2/10/0 |
| G18 | Internal Developer Platform & DX | CL04 | 10/10 | null | - | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | UNKNOWN | 1/10 / 1/10 | 1/9/0 |
| G19 | Cloud Infrastructure Networking & Compute | CL04 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 0/12 / 0/12 | 0/12/0 |
| G20 | DevOps CI CD Supply Chain & Release | CL04 | 14/14 | null | 0232 | 0/14 | 0/14 | 0/14 (UNKNOWN 1) | 0/14 | 0/14 | 0/14 | 0/14 | UNKNOWN | 4/14 / 4/14 | 4/9/1 |
| G21 | SRE Observability Reliability & Incident | CL04 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 7/13 / 7/13 | 6/7/0 |
| G22 | Application Product & SDLC Security | CL05 | 13/13 | null | 0252 | 0/13 | 0/13 | 0/13 (UNKNOWN 1) | 1/13 | 1/13 | 0/13 | 0/13 | UNKNOWN | 3/13 / 3/13 | 3/10/0 |
| G23 | Cloud IAM Cryptography & Platform Security | CL05 | 11/11 | null | - | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | UNKNOWN | 2/11 / 2/11 | 2/9/0 |
| G24 | Security Operations Offensive & Forensics | CL05 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 0/12 / 0/12 | 0/12/0 |
| G25 | Privacy Compliance Audit & Trust | CL05 | 11/11 | null | - | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | UNKNOWN | 3/11 / 1/11 | 0/11/0 |
| G26 | QA Functional & Quality Architecture | CL05 | 15/15 | null | - | 0/15 | 0/15 | 0/15 | 0/15 | 0/15 | 0/15 | 0/15 | UNKNOWN | 12/15 / 12/15 | 12/3/0 |
| G27 | QA Automation Devices & Frameworks | CL05 | 14/14 | null | 0313 | 0/14 | 0/14 | 0/14 (UNKNOWN 1) | 1/14 | 1/14 | 0/14 | 0/14 | UNKNOWN | 11/14 / 11/14 | 11/3/0 |
| G28 | Performance Resilience Compatibility & Specialized QA | CL05 | 14/14 | null | - | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | UNKNOWN | 4/14 / 4/14 | 4/10/0 |
| G29 | Integration Middleware & Protocols | CL02 | 11/11 | null | - | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | UNKNOWN | 3/11 / 3/11 | 3/8/0 |
| G30 | Enterprise SaaS CRM ERP & Business Systems | CL06 | 11/11 | null | - | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | UNKNOWN | 6/11 / 6/11 | 3/8/0 |
| G31 | FinTech Banking Payments & Ledger | CL06 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 11/13 / 11/13 | 11/2/0 |
| G32 | Capital Markets Trading & Risk | CL06 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 10/12 / 10/12 | 10/2/0 |
| G33 | Commerce Marketplace & Logistics | CL06 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 8/12 / 8/12 | 7/5/0 |
| G34 | Streaming Video Audio & Digital Media | CL06 | 11/11 | null | - | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | 0/11 | UNKNOWN | 10/11 / 10/11 | 10/1/0 |
| G35 | Game Design Narrative World & Gameplay | CL07 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 2/13 / 2/13 | 2/11/0 |
| G36 | Game Engine Graphics Physics & Simulation | CL07 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 3/13 / 3/13 | 3/10/0 |
| G37 | Multiplayer Game Backend Netcode & LiveOps | CL07 | 14/14 | null | - | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | 0/14 | UNKNOWN | 4/14 / 4/14 | 4/10/0 |
| G38 | Game Art Audio Animation & Asset Pipeline | CL07 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 4/13 / 0/13 | 4/9/0 |
| G39 | Embedded Firmware IoT & Robotics | CL08 | 13/13 | null | - | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | 0/13 | UNKNOWN | 6/13 / 6/13 | 6/7/0 |
| G40 | XR Spatial Computing & Digital Twin | CL08 | 10/10 | null | - | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | UNKNOWN | 1/10 / 1/10 | 1/9/0 |
| G41 | Telecommunications Edge & Network Services | CL08 | 8/8 | null | - | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | UNKNOWN | 0/8 / 0/8 | 0/8/0 |
| G42 | Automotive Aerospace & Safety Critical Systems | CL08 | 10/10 | null | - | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | UNKNOWN | 0/10 / 0/10 | 0/10/0 |
| G43 | HealthTech Clinical & Regulated Platforms | CL08 | 8/8 | null | - | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | UNKNOWN | 0/8 / 0/8 | 0/8/0 |
| G44 | Geo Gov Education & Public Systems | CL08 | 8/8 | null | - | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | UNKNOWN | 0/8 / 0/8 | 0/8/0 |
| G45 | Blockchain Web3 & Cryptographic Systems | CL08 | 8/8 | null | - | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | UNKNOWN | 0/8 / 0/8 | 0/8/0 |
| G46 | Autonomous Research Knowledge & Continuous Learning | CL09 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 6/12 / 1/12 | 5/7/0 |
| G47 | Documentation Localization & Developer Relations | CL09 | 9/9 | null | - | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | 0/9 | UNKNOWN | 2/9 / 0/9 | 0/9/0 |
| G48 | Customer Support Success & Managed Services | CL09 | 10/10 | null | - | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | UNKNOWN | 4/10 / 1/10 | 0/10/0 |
| G49 | Sales Partnerships Marketing & Growth | CL09 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 6/12 / 3/12 | 0/12/0 |
| G50 | Finance Legal Procurement & Corporate Control | CL09 | 12/12 | null | - | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | 0/12 | UNKNOWN | 8/12 / 5/12 | 0/12/0 |
| G51 | Control Plane Trust Kernel & Agent Operations | CL10 | 16/16 | null | - | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | UNKNOWN | 1/16 / 1/16 | 1/15/0 |
| Total | 51 guilds |  | 599/599 | null 51/51 | 9 roles in 7/51 guilds | 0/599 | 0/599 | 0/599 (UNKNOWN 9) | 8/599 (6/51 guilds) | 3/599 (3/51 guilds) | 0/599 | 0/599 | UNKNOWN 599/599 | 197/599 / 164/599 | 157/441/1 |

Checks: roleCount mismatches 0/51, empty guilds 0/51, sum of guild roles 599.

### 2c. Per-cluster table (10 rows)

Source: registries/role-definitions.json clusters[] (clusterId, name, guildCount, roleCount) plus the guild table; same rules as the guild table

| Cluster | Name | Guilds | DEFINED (roles) | Bound | PROFILED | KNOWLEDGE_READY | TOOL_READY TRUE (UNKNOWN) | EXECUTABLE (code path) | Stage-wired | EVALUATED | INTERNALLY_CERTIFIED | RUNNING | Proposed skills / adapters | Guilds with code path |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CL01 | Yönetim ve Ürün | 4 | 41/41 | 4 | 0/41 | 0/41 | 0/41 (UNKNOWN 4) | 4/41 | 0/41 | 0/41 | 0/41 | UNKNOWN | 15/41 / 4/41 | 2/4 |
| CL02 | Mühendislik | 8 | 98/98 | 2 | 0/98 | 0/98 | 0/98 (UNKNOWN 2) | 2/98 | 1/98 | 0/98 | 0/98 | UNKNOWN | 30/98 / 30/98 | 2/8 |
| CL03 | Veri ve AI | 6 | 73/73 | 0 | 0/73 | 0/73 | 0/73 | 0/73 | 0/73 | 0/73 | 0/73 | UNKNOWN | 13/73 / 13/73 | 0/6 |
| CL04 | Platform ve Operasyon | 4 | 49/49 | 1 | 0/49 | 0/49 | 0/49 (UNKNOWN 1) | 0/49 | 0/49 | 0/49 | 0/49 | UNKNOWN | 12/49 / 12/49 | 0/4 |
| CL05 | Güvenlik ve Kalite | 7 | 90/90 | 2 | 0/90 | 0/90 | 0/90 (UNKNOWN 2) | 2/90 | 2/90 | 0/90 | 0/90 | UNKNOWN | 35/90 / 33/90 | 2/7 |
| CL06 | Sektörel Uzmanlık | 5 | 59/59 | 0 | 0/59 | 0/59 | 0/59 | 0/59 | 0/59 | 0/59 | 0/59 | UNKNOWN | 45/59 / 45/59 | 0/5 |
| CL07 | Oyun ve Simülasyon | 4 | 53/53 | 0 | 0/53 | 0/53 | 0/53 | 0/53 | 0/53 | 0/53 | 0/53 | UNKNOWN | 13/53 / 9/53 | 0/4 |
| CL08 | Donanım ve Özel Alanlar | 7 | 65/65 | 0 | 0/65 | 0/65 | 0/65 | 0/65 | 0/65 | 0/65 | 0/65 | UNKNOWN | 7/65 / 7/65 | 0/7 |
| CL09 | Öğrenme ve Şirket | 5 | 55/55 | 0 | 0/55 | 0/55 | 0/55 | 0/55 | 0/55 | 0/55 | 0/55 | UNKNOWN | 26/55 / 10/55 | 0/5 |
| CL10 | UASCO Çekirdek | 1 | 16/16 | 0 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | 0/16 | UNKNOWN | 1/16 / 1/16 | 0/1 |
| Total | 10 clusters | 51 | 599/599 | 9 | 0/599 | 0/599 | 0/599 (UNKNOWN 9) | 8/599 | 3/599 | 0/599 | 0/599 | UNKNOWN | 197/599 / 164/599 | 6/51 |

Checks: clusters with code path 3/10, with stage-wired roles 2/10, with a bound role 4/10; guildCount/roleCount field mismatches 0.

## 3. Gap matrix (25)

| Id | Sev | Gap | Evidence | Owner | Protected needs |
|---|---|---|---|---|---|
| G01 | P0 | There is no auditor for the 8 readiness layers. The existing 5-counter summary conflates them: implemented=8 counts 5 roles whose stage (PREDEV_PRODUCE) is not wired, running is 0 rather than UNKNOWN without a journal, PROPOSED profiles are not separated, and the resolver label (9) differs from the code path (8). | core/agents/role-lifecycle.ts:55-59,93-104; apps/control-api/src/routes/role-status.ts:19; apps/control-api/src/server.ts:258 | LANE_C (compute) -> LANE_B (route) -> LANE_A (display) | none (core/agents unprotected; /v1/roles/status-summary already registered (server.ts:272) and on the Desktop allow-list (main.mjs:72)) |
| G02 | P0 | 590/599 roles have no execution binding and resolve NOT_EXECUTABLE:ROLE_HAS_NO_BINDING. The static table has 9 roles. Includes all 53/53 gaming roles (G35-G38). | core/agents/role-execution.ts:80-81; core/agents/first-delivery-bindings.ts:10-30 | LANE_C | none in files; widening is gated by FD-1 (alias approval) |
| G03 | P0 | The role never reaches the model in IMPLEMENT/REVIEW: MissionSpec and the prompts carry no role, skill or knowledge text, so a different binding changes only limits and the evidence label. | core/workos/executors.ts:14-21,178-205; core/workos/runner.ts:712-720,817-818 | LANE_C | none; file-level blocked by in-flight #231 (core/workos/executors.ts +2/-1) and #256 (core/workos/runner.ts) |
| G04 | P0 | There is no executable tool-adapter layer: 194/194 NOT_IMPLEMENTED, 16/16 binders NOT_IMPLEMENTED, resolveCapability is dead code, binding adapter ids are unresolved strings, and the action-gateway call site hard-codes adapterCertified=true. | registries/tool-adapters.json; registries/execution-binders.json:4-86; core/capabilities/resolver.ts:14; core/agents/role-execution.ts:53; apps/control-api/src/server.ts:188-190 | LANE_C (code) + LANE_S (registry, STANDBY) + COORD (server.ts) | scripts/validate-paste4c-doc-truth.mjs:59 pins adapters at 194; apps/control-api/src/server.ts is protected and in flight in #231 (+4/-4) and #242 (+14/-3); any COORD batch touching it is sequenced after both merge |
| G05 | P0 | No technology knowledge is source-backed: 0/415 official sources, pinned versions or retrieval dates; 0/6225 knowledge units researched. | registries/technologies.json; knowledge/technologies/*.json | LANE_B (core/knowledge by routing) + LANE_S (registries) + FOUNDER (acquisition authority) | NETWORK_EGRESS is never granted (FD-5) |
| G06 | P0 | The pre-dev/analysis step cannot be reached in the packaged app: the produce route has no preDevBuilder, analysis routes are unregistered, and the Desktop POST allow-list lacks the paths. The 5 pre-dev bindings are EXECUTABLE on paper only. | apps/control-api/src/server.ts:258,271; apps/control-api/src/routes/predev-decisions.ts:107-108; apps/desktop/main.mjs:157-167; docs/authority-requests/LANE-C-predev-produce.md:26 | COORD -> FOUNDER | apps/control-api/src/server.ts is protected and in flight in #231 (+4/-4) and #242 (+14/-3); any COORD batch touching it is sequenced after both merge; apps/desktop/main.mjs is protected and in flight in #242 (+6/-2) |
| G07 | P1 | Canonical role records hold no skills or tool adapters (599/599 empty). Skills exist only as PROPOSED_DERIVED copies through unapproved SV aliases (197 roles); 402 roles have none. | registries/role-definitions.json roles[]; registries/role-execution-profiles.json:23-37; registries/role-definitions.json:51-80 (approval PROPOSED) | LANE_C (role-definitions.json) + FOUNDER (FD-1) | none for the file; scripts/validate-role-registry.mjs only requires a gap id when empty (:219) |
| G08 | P1 | Only 8/3594 specs have an executable procedure (EV-01 only). EV-02..EV-06 have 0 procedures and delivery has none. | core/competency/evaluation-pipeline.ts:345-365 | LANE_C | none; spec text missing (FD-6) |
| G09 | P1 | No EVALUATED or INTERNALLY_CERTIFIED evidence exists. The protected validator pins executed=0 and certified=0, and promotion of staged evidence is a protected step. | scripts/validate-role-registry.mjs:24,272-273; core/agents/role-lifecycle.ts:14; audit/evidence absent | FOUNDER/COORD | scripts/validate-role-registry.mjs (prefix-protected); audit/evidence promotion (FD-2) |
| G10 | P1 | Skill data has no runtime consumer: no prompt, executor or selector reads skills-v2 or candidateSkills. | grep of apps/ and core/: only core/competency/types.ts and core/agents/role-profile-derivation.ts; core/workos/predev/role-prompts.ts | LANE_C | none |
| G11 | P1 | Registry status disagrees with code. gitleaks, trivy, ajv, ajv-formats and playwright are NOT_IMPLEMENTED despite real code; git, npm and node have no adapter records; implementation-reality marks the dead capability resolver implemented and the live action-gateway not implemented. | registries/tool-adapters.json:7,168,175,476,483; registries/implementation-reality.json:10,40; core/workos/security-tools.ts:136,228 | LANE_C (reality map) + LANE_S (registry correction) | validate-paste4c-doc-truth.mjs:59 if records are added |
| G12 | P1 | The planned task graph never reaches execution: tasks have no roleId, there is at most one open run per mission, and tasks are linked to runs only after the run. | core/workos/types.ts:41-43; core/workos/store.ts:692; core/workos/runner.ts:712-720; apps/control-api/src/routes/task-runs.ts:32-42 | LANE_B (types/plan) + LANE_Z (store.ts) + LANE_C (runner) | server.ts:313 for run creation per task; apps/control-api/src/server.ts is protected and in flight in #231 (+4/-4) and #242 (+14/-3); any COORD batch touching it is sequenced after both merge |
| G13 | P1 | No real security-tool evaluation exists: real-gitleaks tests are skipped in CI, trivy has never run with a real DB, and no workflow installs either. | tests/v7-b3c-security-stage.test.ts:443-446; .github/workflows (0 refs); audit/checkpoints/V7-PKG-B3C-2026-10-15.json:156,237 | FOUNDER (.github authority path) | .github/workflows/* (FD-8) |
| G14 | P1 | Language and engine coverage has holes: C#, Bash, PowerShell, COBOL, Fortran, and for the 53 gaming roles bevy, gamemaker, three.js, hlsl/glsl/wgsl, gdscript, lua/luau, fmod, wwise and houdini are absent from technologies.json (0 slug/name/alias matches). The validators hard-pin the universe at 415. Applies to the gaming row (G35-G38). | registries/technologies.json (17 LANGUAGE records); scripts/validate-technology-graph.mjs:5,9; scripts/validate-paste3-technology-domain-registry.mjs:34,36 | LANE_S (STANDBY) + FOUNDER | scripts/validate-* prefix (FD-7) |
| G15 | P1 | Technology data has no mission-time consumer: requireKnownOrGap, assertHighRiskCompetencyReady and technology-decision are test-only, and the runtime knowledgeSources check is a non-empty test over 3 policy files. | core/knowledge/technology-discovery.ts:32-41; core/competency/certification.ts:22; core/agents/role-execution.ts:56; core/agents/first-delivery-bindings.ts:5 | LANE_C (consumer) + LANE_B (core/knowledge) | none |
| G16 | P2 | Ontology split-brain: competency-packs (588 refs) and skill-dependency-graph use only V1 SKILL-* ids, while the authority file says only SK2 is runtime. | registries/competency-packs.json; registries/skill-dependency-graph.json; registries/skill-ontology-authority.json | LANE_S (STANDBY) | none known |
| G17 | P2 | Evidence records the fixture digest and binding sha256 but the verifier does not check them, so changed fixtures do not invalidate old evidence. | core/competency/evaluation-fixtures.ts:39-44; docs/authority-requests/LANE-C-role-evaluation-pipeline.md:38 | LANE_C | parity in scripts/validate-role-registry.mjs (protected) |
| G18 | P2 | Skill Academy has no real source acquisition or lab execution, its write API is not exposed (GET only), and it has no non-test caller. | core/academy/academy.ts:212-255; apps/control-api/src/server.ts:621-623 | LANE_B (core/academy by routing) + COORD | server.ts, main.mjs; apps/control-api/src/server.ts is protected and in flight in #231 (+4/-4) and #242 (+14/-3); any COORD batch touching it is sequenced after both merge; main.mjs in flight in #242 |
| G19 | P2 | 435/599 profile routes are the read-only default, not role-derived. In the gaming guilds 40/53 are the default; for example UASCO-0424 Principal Game Engine Architect gets CLAUDE_REVIEWER. 13/53 gaming roles get CLAUDE_IMPLEMENTER via an unapproved SV alias. | core/agents/role-profile-derivation.ts:80-84 | LANE_C (+ scripts/build-role-execution-profiles.mjs) | none |
| G20 | P2 | Guild ownership is missing (ownerRoleId null 51/51), the legacy 40-department hierarchy is not mapped to guilds, and 438 review chains fall back to UASCO-0252. | registries/role-definitions.json:186-188; registries/organization-hierarchy.json | LANE_C + FOUNDER (org model) | none |
| G21 | P2 | The legacy alias mapping is unresolved: 0 EXACT, 61 SUSPECTED-only, 55 CONFLICT-only and 31 with no mapping; all 443 are PROPOSED. | registries/role-definitions.json:51-80,90-103,743 | FOUNDER | registries/agents.json frozen byte-identical |
| G22 | P2 | Polyglot test commands (pytest, go, cargo, dotnet, mvn, gradle) are allowlisted but never exercised. The sandbox binds only /usr, /bin, /lib* and the node prefix (toolchains elsewhere likely invisible; inferred). | core/workos/schemas.ts:14; core/agents/linux-unshare-sandbox.ts:40-42 | LANE_C (sandbox; core/agents/linux-unshare-sandbox.ts is in flight in #231 +83/-1) + LANE_B | FD-REL-1 host-exec decision (core/workos/execution-gate.ts:1) |
| G23 | P2 | scripts/validate-role-registry.mjs, which guards anti-fake-green on roles, is prefix-protected but not hash-sealed: it is the only one of 29 scripts/validate-* files missing from the trust-root manifest. | config/protected-paths.json:146; config/trust-root-manifest.json files[] | COORD | config/trust-root-manifest.json reseal |
| G24 | P2 | The strict JSON validator is not wired to any API-QA path, there is no Newman/OpenAPI runner, the Postman template placeholders are never filled, and the template and validator differ on empty-string policy. | core/qa/api/strict-json-validator.ts:44; templates/postman/strict-ajv-post-response.js:6-8,22 | LANE_B (core/qa) | none |
| G25 | P2 | The Desktop role surface is misleading or narrow: the 'no expert' option sends {} and the server assigns UASCO-0085; only UASCO-0085 is offered; the crew timeline is labelled with executor identities, not role ids. | apps/desktop/renderer/work-core.js:370-379; apps/control-api/src/server.ts:313,643 | LANE_A + COORD | server.ts:643 for the crew labels; apps/control-api/src/server.ts is protected and in flight in #231 (+4/-4) and #242 (+14/-3); any COORD batch touching it is sequenced after both merge |

## 4. Lane C package plan (ordered)

| # | Id | Pri | Title | Integration point | Depends on | Protected needs | Test host |
|---|---|---|---|---|---|---|---|
| 1 | C-RDY-1 | P0 | Role Readiness Auditor: 8 strict layers, authoritative over the legacy 5-counter summary | core/agents/role-lifecycle.ts:roleLifecycle (shared per-role rule) and computeRoleStatusSummary (legacy projection, reconciled); consumer apps/control-api/src/routes/role-status.ts:registerRoleStatusRoutes (Lane B task B1) | - | none for code; S-REG (TEST_REGISTRATION_APPEND + TRUST_ROOT_RESEAL on config/validation.json) for CI registration of the dedicated test file | tests/v7-core-readiness-audit.test.ts (new, dedicated). It replaces the earlier plan to put the tests in tests/v7-core-predev-team-composer.test.ts, a file about the pre-dev team composer, which was chosen only to avoid the protected test list. |
| 2 | C-CTX-1 | P0 | Role Context Resolver (role genome / skill / technology / knowledge resolver) | Pure module; consumers: core/agents/readiness-audit.ts PROFILED (C-RDY-2b), core/workos/predev/role-prompts.ts:composeRolePrompt (C-CTX-2), core/workos/executors.ts implementPrompt/reviewPrompt (C-CTX-3), Lane B B2 route | - | none for code; S-REG for its test file | tests/v7-core-role-context.test.ts (new, dedicated), replacing the earlier plan to use tests/v7-core-predev-team-composer.test.ts |
| 3 | C-RDY-2a | P0 | Adapter Reality Map, registry-vs-code reconciliation and the TOOL_READY input | core/agents/readiness-audit.ts computeRoleReadiness({adapterReality}) and core/capabilities/resolver.ts:resolveCapability | C-RDY-1 | none for code. Later registry corrections need Lane S staffing or a coordinator grant; adding adapter records trips scripts/validate-paste4c-doc-truth.mjs:59 (protected, FD-7); S-REG for its test file | tests/v7-core-adapter-reality.test.ts (new, dedicated). Earlier plan: tests/v7-b3c-security-stage.test.ts, which is related only for gitleaks/trivy. |
| 4 | C-RDY-2b | P1 | Skill and technology entity readiness audit; PROFILED through the role context | core/agents/readiness-audit.ts (entity section of ReadinessAudit) | C-RDY-1, C-CTX-1 | none (the test file is registered by C-RDY-1 S-REG) | tests/v7-core-readiness-audit.test.ts (dedicated; registered by C-RDY-1 S-REG) |
| 5 | C-CTX-2 | P1 | Canonical role context in pre-dev prompts | core/workos/predev/claude-builder.ts:ClaudePreDevBuilder.produce | C-CTX-1 | none for files; rebase after #257 (same predev area, different file) | tests/v7-core-predev-driver.test.ts (registered at config/validation.json:437; it is the existing test file for the pre-dev driver and claude-builder, so it is the related host) |
| 6 | C-EVAL-2 | P1 | Bind evaluation evidence to the current fixture and binding digests | core/agents/role-lifecycle.ts:createEvidenceVerifier (used by role-status.ts and readiness-audit.ts) | C-RDY-1 (both extend core/agents/role-lifecycle.ts; land after it or rebase) | validator parity in scripts/validate-role-registry.mjs (prefix-protected); requested through the authority-request doc only | tests/certification.test.ts (registered at config/validation.json:294; certification/evidence tests live there) |
| 7 | C-EVAL-3 | P2 | EV-06 BOUNDARY_AND_COST procedure for the 8 consumed bindings | core/competency/evaluation-pipeline.ts:planFor / runRoleEvaluation; scripts/run-role-evaluation.mjs (dry run by default) | C-EVAL-2 | none for code; TESTED stays 0 until FD-2 | tests/certification.test.ts (registered :294); tests/v7-wfr03-role-registry.test.ts only after #231 merges |
| 8 | C-CTX-3 | P2 | Role context in IMPLEMENT/REVIEW model input | core/workos/runner.ts:MissionRunner.stepImplement / stepReview | C-CTX-1, #231 merged, #256 merged | none; BLOCKED until #231 (executors.ts) and #256 (runner.ts) merge | tests/v7-b3a-runner.test.ts (registered at config/validation.json:354; the runner test file) |
| 9 | C-BIND-1 | P2 | Evidence-gated binding widening and run-role suggestion | core/agents/first-delivery-bindings.ts FIRST_DELIVERY_BINDINGS / assertImplementerRole; consumer apps/control-api/src/server.ts:313 (protected, COORD) | C-CTX-1, FD-1 | none in files; S-REG for its test file; Founder decision FD-1 before any real binding; server.ts consumption is protected and in flight (#231, #242) | tests/v7-core-derived-bindings.test.ts (new, dedicated), replacing tests/v7-core-predev-team-composer.test.ts |

### Package comparison: which first?

Which package first: C-RDY-1 (measurement), C-CTX-1 (role context, first step toward G03) or C-CTX-2 (first model-input change)?

| Package | Value | Unblocked | User-visible | Depends on |
|---|---|---|---|---|
| C-RDY-1 | Measures all 8 layers with denominators. Prerequisite for honest acceptance of every later package. No model-behaviour change. | Code: yes (0 in-flight file overlaps, 0 protected code paths). CI registration: S-REG (protected). | No, until B1 (route) + A1 (view). | none |
| C-CTX-1 | First step toward G03: a typed, provenance-labelled role context for 599/599 roles. No model-behaviour change by itself. | Code: yes (0 in-flight overlaps, 0 protected). CI registration: S-REG. | No, until B2 + A3 (needs the protected main.mjs allow-list, in flight #242) or C-CTX-2. | none (the old C-RDY-1 dependency was artificial and is removed) |
| C-CTX-2 | First real model-input change: the 5 pre-dev roles get canonical role text. | Code: yes (no shared file with open PRs; #257 is adjacent in core/workos/predev/). | No in the packaged app: PREDEV_PRODUCE is not wired (server.ts:258, FD-4; server.ts in flight #231/#242). The model effect is unverifiable without real-model evidence (FD-3). | C-CTX-1 |

Decision: Run C-RDY-1 and C-CTX-1 in parallel as packages 1 and 2. C-RDY-1 is package 1 because every later acceptance check needs its measurement, not because it has the highest product value: C-CTX-1 is closer to the real capability gap (G03). C-CTX-2 waits for C-CTX-1 and cannot become user-visible before FD-4.

### 1. C-RDY-1 (P0): Role Readiness Auditor: 8 strict layers, authoritative over the legacy 5-counter summary

Goal: One pure function computes the 8 readiness layers per canonical role (599), per guild (51) and per cluster (10). Each result is TRUE/FALSE/UNKNOWN with fixed reason codes and real denominators. It never promotes a layer from a JSON status field, never reports 0 where the input is absent, and keeps PROPOSED_DERIVED data in proposedOnly. It is the single authoritative readiness measurement; the 5-counter statusSummary becomes a deprecated legacy projection, reconciled against it.

Why first: Adds the measurement; the correction becomes visible only after B1 + A1. On its own it changes no model behaviour and no number a user sees. It is package 1 because (1) every later acceptance criterion (C-CTX-2 "pre-dev roles differ in model input", C-BIND-1 "implemented rises only for stage-consumed roles", C-EVAL-3 "16 plannable specs") needs a denominator-carrying baseline, and today's only counter conflates layers; (2) its code has 0 in-flight file overlaps and 0 protected code dependencies (only the protected registration step S-REG); (3) it reuses roleLifecycle() instead of adding a parallel status system. It is not the highest product-value package: C-CTX-1 is closer to the real capability gap (G03) and runs in parallel (see packageComparison).

Status-summary policy (single source of truth):

- authoritative: core/agents/readiness-audit.ts computeRoleReadiness (authority AUTHORITATIVE_READINESS_MEASUREMENT)
- legacy: core/agents/role-lifecycle.ts computeRoleStatusSummary: output unchanged (the renderer mapper apps/desktop/renderer/agent-factory-core.js:20-41 rejects a non-integer running), marked @deprecated, classified DEPRECATED_LEGACY_PROJECTION
- singleRuleSource: EXECUTABLE (code path), EVALUATED and INTERNALLY_CERTIFIED are derived by calling roleLifecycle() per role, so the two outputs cannot drift
- reconciliation: reconcileLegacyStatusSummary(legacy, audit) checks the 5 equalities in total and per guild, lists mismatches, and reports runningMeasured (false when the journal is absent) and implementedStageWired (number or UNKNOWN)
- deprecationPath: B1 returns readiness + statusSummaryStatus "DEPRECATED_LEGACY_PROJECTION" + reconciliation next to the unchanged statusSummary; A1 renders readiness only and never shows statusSummary.running as a number while runningMeasured is false; a later B/A package removes statusSummary once no consumer reads it

- Create: `core/agents/readiness-audit.ts`; `tests/v7-core-readiness-audit.test.ts (dedicated; needs S-REG to run in CI)`; `docs/lanes/LANE-C-readiness-audit-mutants.json`; `docs/lanes/LANE-C-readiness-audit-mutants.mjs`; `docs/authority-requests/LANE-C-readiness-audit-test-registration.md`
- Extend: `core/agents/role-lifecycle.ts (additive: export consumedFunctions; add RunsObservation; @deprecated JSDoc on computeRoleStatusSummary; no behaviour change)`; `docs/lanes/LANE-C-MAP.md`
- Reuse: `core/agents/role-execution.ts:77 resolveRoleExecution`; `core/agents/first-delivery-bindings.ts:58 STAGE_CONSUMERS`; `core/agents/role-lifecycle.ts:24 createEvidenceVerifier, :57 roleLifecycle, :73 runningRoleIdsFromRuns`; `core/agents/role-lifecycle.ts:13 PRODUCTION_EXECUTOR_ROUTES`; `core/agents/first-delivery-bindings.ts:10 FIRST_DELIVERY_BINDINGS`
- Protected step files: `config/validation.json (S-REG append)`; `config/trust-root-manifest.json (S-REG reseal)`

Layer rules:

- DEFINED: TRUE iff roleId matches ^UASCO-\d{4}$, occurs exactly once, guildId is in guilds[] and clusterId equals that guild's clusterId; else FALSE (BAD_ROLE_ID / DUPLICATE_ROLE_ID / GUILD_NOT_IN_REGISTRY / CLUSTER_MISMATCH). Never UNKNOWN.
- PROFILED: TRUE iff requiredSkillIds is non-empty with every id in skills-v2, requiredTechnologies is non-empty with every technologyId in technologies.json, and every requiredTechnologies status is in PROMOTED_TECHNOLOGY_STATUSES. Otherwise FALSE (NO_CANONICAL_SKILLS / SKILL_NOT_IN_SK2 / NO_REQUIRED_TECHNOLOGIES / TECHNOLOGY_NOT_IN_REGISTRY / TECHNOLOGY_STATUS_NOT_PROMOTED). PROPOSED_DERIVED goes to proposedOnly only. Structurally 0: PROMOTED_TECHNOLOGY_STATUSES is empty, because only CANDIDATE_NOT_VERIFIED and NAME_NOT_VERIFIED_IN_REGISTRY exist (both emitted by scripts/build-role-definitions.mjs:218-219; no schema enum, no code path, no authority defines a verified status; 3359/3359 required entries are CANDIDATE_NOT_VERIFIED). PROFILED becomes possible only after FD-1 (canonical skills) and FD-9 (the Founder / Lane S technology-verification authority names the promoted status).
- KNOWLEDGE_READY: requiredTechnologies empty: UNKNOWN (NO_REQUIRED_TECHNOLOGIES), never TRUE. Otherwise TRUE iff knowledgeSourceRefs is non-empty and every required technology has a knowledge profile with at least 1 unit whose state is not NOT_RESEARCHED, whose lastValidatedAt is ISO-8601, and whose sourceRefs are non-empty objects carrying every registries/technology-source-registry.json requiredProvenance field. In each sourceRef, sourceId, uriOrLocator, effectiveVersion and digestOrRevision are non-empty, fetchedAt is ISO-8601, and sourceClass has allowedForCertification true. Otherwise FALSE (ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY / KNOWLEDGE_PROFILE_MISSING / NO_RESEARCHED_SOURCED_UNIT). Today 0 roles have zero required technologies (minimum 3), so the UNKNOWN branch is guarded by a fixture test and mutant M8.
- TOOL_READY: No binding: FALSE (ROLE_HAS_NO_BINDING). Adapters empty: FALSE (ADAPTERS_MISSING). No adapterReality map: UNKNOWN (ADAPTER_REALITY_NOT_SUPPLIED). Per adapter: missing entry FALSE (ADAPTER_UNRESOLVED); codePath ABSENT FALSE (ADAPTER_CODE_ABSENT); probe FAILED FALSE (PROBE_FAILED); probe NOT_OBSERVED UNKNOWN (PROBE_NOT_OBSERVED). Any FALSE gives FALSE, else any UNKNOWN gives UNKNOWN, else TRUE. Registry implementation fields are never read.
- EXECUTABLE: Code path: TRUE iff roleLifecycle().implemented (resolveRoleExecution EXECUTABLE, providerRoute in PRODUCTION_EXECUTOR_ROUTES and function in consumedFunctions()). Otherwise FALSE with the NotExecutableReason, or ROUTE_NOT_PRODUCTION_EXECUTOR and/or STAGE_NOT_CONSUMED (UASCO-0232 gets both). Never UNKNOWN. stageWired is reported separately: no code path FALSE (NO_CODE_PATH); reachableStages absent UNKNOWN (REACHABLE_STAGES_NOT_SUPPLIED); else TRUE iff a consuming stage is in reachableStages, otherwise FALSE (STAGE_NOT_WIRED). backendEnabled is always UNKNOWN.
- EVALUATED: No specs: FALSE (NO_EVALUATION_SPECS). TRUE iff roleLifecycle().tested (a spec not NOT_EXECUTED with verify()===null; FAKE rejected). Otherwise FALSE (NO_SPEC_EXECUTED / EVIDENCE_REJECTED). CI test runs never feed this layer.
- INTERNALLY_CERTIFIED: TRUE iff roleLifecycle().certified (6/6 specs PASSED and verified, reviewer APPROVED, scope, not expired). Otherwise FALSE (NOT_CERTIFIED_STATUS / CERTIFICATION_EVIDENCE_INVALID).
- RUNNING: Journal ABSENT: UNKNOWN (NO_RUN_JOURNAL) for every role, aggregate measured:false, never shown as 0. Journal PRESENT: TRUE iff in runningRoleIdsFromRuns, else FALSE (NOT_IN_OPEN_RUN). Open question, not changed: runningRoleIdsFromRuns treats AWAITING_APPROVAL as open (role-lifecycle.ts:76 vs core/workos/run-state.ts:40).
- noVacuousTruth: An empty list never yields TRUE: PROFILED needs non-empty skills and technologies; KNOWLEDGE_READY is UNKNOWN with no technologies; TOOL_READY is FALSE with no adapters; EVALUATED is FALSE with no specs; CERTIFIED needs 6/6 specs.
- anomalies: LAYER_ORDER (EVALUATED without EXECUTABLE, CERTIFIED without EVALUATED, RUNNING without EXECUTABLE) and REGISTRY_CLAIM_EXCEEDS_EVIDENCE (runtimeStatus not UNKNOWN while RUNNING is not TRUE; proficiencyStatus not NOT_EVALUATED while EVALUATED is not TRUE; proficiencyStatus CERTIFIED while CERTIFIED is not TRUE; spec status not NOT_EXECUTED while EVALUATED is not TRUE). Anomalies never change a layer.
- aggregation: byGuild has a row for every guild in guilds[] (also 0-role guilds); byCluster for every cluster; for every layer and state the group sums equal the totals; denominators are role counts.

Reason codes: DEFINED: BAD_ROLE_ID, DUPLICATE_ROLE_ID, GUILD_NOT_IN_REGISTRY, CLUSTER_MISMATCH; PROFILED: NO_CANONICAL_SKILLS, SKILL_NOT_IN_SK2, NO_REQUIRED_TECHNOLOGIES, TECHNOLOGY_NOT_IN_REGISTRY, TECHNOLOGY_STATUS_NOT_PROMOTED; KNOWLEDGE_READY: NO_REQUIRED_TECHNOLOGIES, ROLE_KNOWLEDGE_SOURCE_REFS_EMPTY, KNOWLEDGE_PROFILE_MISSING, NO_RESEARCHED_SOURCED_UNIT; TOOL_READY: ROLE_HAS_NO_BINDING, ADAPTERS_MISSING, ADAPTER_REALITY_NOT_SUPPLIED, ADAPTER_UNRESOLVED, ADAPTER_CODE_ABSENT, PROBE_FAILED, PROBE_NOT_OBSERVED; EXECUTABLE: <every NotExecutableReason of core/agents/role-execution.ts:8-10>, ROUTE_NOT_PRODUCTION_EXECUTOR, STAGE_NOT_CONSUMED; EXECUTABLE.stageWired: NO_CODE_PATH, REACHABLE_STAGES_NOT_SUPPLIED, STAGE_NOT_WIRED; EVALUATED: NO_EVALUATION_SPECS, NO_SPEC_EXECUTED, EVIDENCE_REJECTED; INTERNALLY_CERTIFIED: NOT_CERTIFIED_STATUS, CERTIFICATION_EVIDENCE_INVALID; RUNNING: NO_RUN_JOURNAL, NOT_IN_OPEN_RUN

Public API: computeRoleReadiness(input): ReadinessAudit; loadReadinessInputFromRepo(repoRoot, {runs, adapterReality?, reachableStages?, now}): ReadinessInput; reconcileLegacyStatusSummary(legacy, audit): LegacyReconciliation; READINESS_LAYERS; PROMOTED_TECHNOLOGY_STATUSES (empty); types LayerState, LayerResult, LayerCount, ReadinessReason, AdapterRealityEntry, RoleReadiness, ReadinessGroupRow, ReadinessAudit, LegacyReconciliation (full signatures in dispatchText)

Acceptance tests:

- T1 "real registries: layer totals at the branch tip": DEFINED 599; PROFILED TRUE 0/FALSE 599 (NO_CANONICAL_SKILLS 599, TECHNOLOGY_STATUS_NOT_PROMOTED 599); KNOWLEDGE_READY FALSE 599; TOOL_READY TRUE 0, UNKNOWN 9, FALSE 590; EXECUTABLE TRUE 8, FALSE 591; stageWired UNKNOWN 8, FALSE 591; EVALUATED FALSE 599; INTERNALLY_CERTIFIED FALSE 599; RUNNING UNKNOWN 599 (measured false); proposedOnly 599/197/164; anomalies 0
- T2 "legacy parity and reconciliation": legacy 599/8/0/0/0; consistent true; runningMeasured false; implementedStageWired UNKNOWN; mismatch strings "total.implemented:9!=8" and "G08.implemented:0!=1"
- T3 "stage wiring is separate and never defaulted": {IMPLEMENT, REVIEW} gives TRUE 3 (0085, 0252, 0313), FALSE 596; {} gives 0; undefined gives UNKNOWN 8; EXECUTABLE stays 8
- T4 "evaluation evidence": verified non-FAKE EV-01 for UASCO-0085 TRUE; fake:true FALSE (EVIDENCE_REJECTED); hash mismatch FALSE; all NOT_EXECUTED FALSE (NO_SPEC_EXECUTED)
- T5 "running needs a journal": PRESENT open run with role=UASCO-0085 TRUE 1; terminal run 0; ABSENT UNKNOWN 599
- T6 "knowledge: no vacuous truth and full provenance": empty sourceRefs, missing effectiveVersion and REPUTABLE_SECONDARY are FALSE; a complete sourceRef is TRUE; requiredTechnologies [] is UNKNOWN; empty knowledgeSourceRefs FALSE; missing profile FALSE
- T7 "profiled: canonical only, no vacuous truth": SK2-NOPE FALSE; 72 proposed skills still FALSE (NO_CANONICAL_SKILLS); FIXTURE_VERIFIED FALSE with the default set and TRUE with an explicit promoted set; requiredTechnologies [] FALSE; unknown slug FALSE
- T8 "groups, denominators, determinism": 51 guild rows and 10 cluster rows whose sums equal the totals (599); G35-G38 13/13/14/13 and CL07 53; EXECUTABLE TRUE by guild G03 3, G04 1, G05 1, G08 1, G22 1, G27 1, else 0; a 0-role guild row is present; the digest is stable across now and role order and changes on data change
- T9 "tool readiness needs code and an observed probe": all PRESENT+READY gives 9; NOT_OBSERVED gives UNKNOWN; a missing entry ADAPTER_UNRESOLVED; ABSENT ADAPTER_CODE_ABSENT; adapters [] ADAPTERS_MISSING
- T10 "anomalies are flagged, never promote": runtimeStatus RUNNING, proficiencyStatus CERTIFIED and spec PASSED without evidence are flagged and do not raise layers
- T11 "input loader fails closed": a missing registries/skills-v2.json throws READINESS_INPUT_UNAVAILABLE:registries/skills-v2.json

Mutants (each must be KILLED):

- M1 EXECUTABLE from the resolver label (TRUE 9): killed by T1/T2/T8
- M2 proposed skills counted as canonical: killed by T1/T7
- M3 drop verify()/FAKE in EVALUATED: killed by T4/T10
- M4 RUNNING FALSE instead of UNKNOWN when ABSENT: killed by T1/T5
- M5 accept empty sourceRefs: killed by T6
- M6 TOOL_READY from adapter strings without a map: killed by T1/T9
- M7 stageWired defaults to the code path: killed by T3
- M8 KNOWLEDGE_READY TRUE with empty requiredTechnologies: killed by T6
- M9 PROFILED TRUE with empty requiredTechnologies: killed by T7
- M10 PROMOTED_TECHNOLOGY_STATUSES contains CANDIDATE_NOT_VERIFIED: killed by T1/T7
- M11 byGuild ignores guilds[]: killed by T8
- M12 digest includes computedAt: killed by T8
- M13 reconciliation ignores byGuild: killed by T2

Test host: tests/v7-core-readiness-audit.test.ts (new, dedicated). It replaces the earlier plan to put the tests in tests/v7-core-predev-team-composer.test.ts, a file about the pre-dev team composer, which was chosen only to avoid the protected test list.

Protected step S-REG (performed by COORD / Founder tier, not Lane C; tier: Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED (label as stated by the supervisor; not found in the repo by git grep -i preauthori)):

- TEST_REGISTRATION_APPEND: append "tests/v7-core-readiness-audit.test.ts" as the last element of the command array of step tests-8 (config/validation.json:429-467; last tests shard per core/authority/autonomous-authority.mjs:391-392 isShard); nothing else changes
- TRUST_ROOT_RESEAL: update the config/validation.json sha256 in config/trust-root-manifest.json from the real head bytes
- Why: CI runs only test files listed in config/validation.json steps (explicit vitest file lists run by scripts/run-validation.mjs; the Windows shards are aggregated by scripts/validate-shards.mjs). config/validation.json is a protected exact path, is under the protected config/ prefix and is sealed in config/trust-root-manifest.json.
- Authority note: docs/authority/autonomous-authority-policy.proposed.json:40 grants this class to MAINTAINER, but its //TR (:2) says it is not yet an authority source and config/autonomous-authority-policy.json does not exist at 0ddb170, so the autonomous engine cannot authorize it; it goes through the Founder-tier protected path
- Sequencing: config/trust-root-manifest.json is also modified by open PRs #231, #242, #247 and #251; recompute the reseal on the then-current base. Several S-REG appends may be batched in one protected change if every file exists at head (TEST_FILE_NOT_AT_HEAD check, autonomous-authority.mjs:422-426).
- Until merged: package status CODE_COMPLETE_NOT_CI_REGISTERED, not DONE

Out of scope: Editing registries/** or knowledge/** (any status field); apps/control-api/** (B1; server.ts protected and in flight #231/#242); apps/desktop/** (A1); Writing or promoting evidence; core/workos/runner.ts, executors.ts, predev/**; Adapter reality map (C-RDY-2a), entity audits (C-RDY-2b), role context (C-CTX-1); config/validation.json and config/trust-root-manifest.json (S-REG, protected); Changing computeRoleStatusSummary output or roleLifecycle/runningRoleIdsFromRuns semantics; Defining a verified technology status (FD-9) or approving aliases (FD-1).

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: #251: config/trust-root-manifest.json (+3/-3); #247: config/trust-root-manifest.json (+2/-2); #242: config/trust-root-manifest.json (+3/-3); #231: config/trust-root-manifest.json (+2/-2)
- Read/import dependencies: none
- Shared with other Lane C packages: C-CTX-1: docs/lanes/LANE-C-MAP.md; C-RDY-2a: docs/lanes/LANE-C-MAP.md; C-RDY-2b: core/agents/readiness-audit.ts, docs/lanes/LANE-C-MAP.md, docs/lanes/LANE-C-readiness-audit-mutants.json, tests/v7-core-readiness-audit.test.ts; C-EVAL-2: core/agents/role-lifecycle.ts
- Note: S-REG: config/validation.json is touched by 0 open PRs; config/trust-root-manifest.json by #231, #242, #247 and #251

Definition of Done: CODE_COMPLETE: exactly the 7 files changed; T1-T11 pass; tests/v7-wfr03-role-registry.test.ts passes unedited; mutants M1-M13 KILLED (0 survivors, 0 skipped); tsc --noEmit and validate-tr-comments pass; the PR states "adds the measurement; no user-visible number changes until B1 + A1". DONE (supervisor): validation and governed CLAUDE_REVIEWER review CLEAN on the exact commit, S-REG merged, CI runs the file in tests-8 on Linux and Windows and it passes.

#### Package 1 dispatch text (verbatim copy of packages[0].dispatchText)

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

### 2. C-CTX-1 (P0): Role Context Resolver (role genome / skill / technology / knowledge resolver)

Goal: A pure resolver gives any of the 599 roles a typed, provenance-labelled, byte-capped context. It holds canonical role text (title, guild, responsibilities, forbiddenActions and specializationBoundaries, present for 599/599), technologies with registry status and knowledgeState, skills split into canonical (0 today) and PROPOSED_DERIVED via SV alias (197 roles), the review chain, binding status and gap ids, with verifiedKnowledge=false. Later consumers: readiness-audit PROFILED (C-RDY-2b, with a parity test) and prompt wiring (C-CTX-2, C-CTX-3).

Why parallel: Independent of C-RDY-1. The old dependsOn C-RDY-1 existed only because PROFILED was to be computed through readiness-audit.ts; that consumption moves to C-RDY-2b. C-CTX-1 has no protected code dependency and no in-flight file, and is the first step toward G03 (the role reaching the model). It runs in parallel with C-RDY-1.

- Create: `core/agents/role-context.ts`; `tests/v7-core-role-context.test.ts (dedicated; needs S-REG to run in CI)`; `docs/lanes/LANE-C-role-context-mutants.json`; `docs/lanes/LANE-C-role-context-mutants.mjs`; `docs/authority-requests/LANE-C-role-context-test-registration.md`
- Extend: `docs/lanes/LANE-C-MAP.md`
- Protected step files: `config/validation.json (S-REG append)`; `config/trust-root-manifest.json (S-REG reseal)`

Acceptance tests:

- T1 all 599 roles resolve without throwing; title and guildId equal the registry
- T2 UASCO-0085: proposed skills = 72 (= profile candidateSkills), canonical 0, binding resolver status EXECUTABLE (resolver label, not the EXECUTABLE layer)
- T3 UASCO-0424: proposed 0, gap WFR-GAP-SKILLS-UASCO-0424 present, binding ROLE_HAS_NO_BINDING
- T4 UASCO-0450: autosar is surfaced as CANDIDATE_NOT_VERIFIED (data anomaly visible, not hidden)
- T5 an unknown role gives ROLE_NOT_IN_CATALOG
- T6 proposed skills never appear under canonical, for any of the 599
- T7 deterministic digest: same inputs give the same digest; changing one responsibility changes it
- T8 the 41 unresolved technology refs (schemathesis, openxr, postgis, qgis) give registryId null and status NAME_NOT_VERIFIED_IN_REGISTRY

Mutants (each must be KILLED):

- M1 merge proposed skills into canonical: killed by T6
- M2 drop unresolved technologies: killed by T8
- M3 also resolve through SUSPECTED aliases: killed by T2/T3
- M4 digest excludes the canonical text: killed by T7

Test host: tests/v7-core-role-context.test.ts (new, dedicated), replacing the earlier plan to use tests/v7-core-predev-team-composer.test.ts

Protected step S-REG (performed by COORD / Founder tier, not Lane C; tier: Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED (label as stated by the supervisor; not found in the repo by git grep -i preauthori)):

- TEST_REGISTRATION_APPEND: append "tests/v7-core-role-context.test.ts" as the last element of the command array of step tests-8 (config/validation.json:429-467; last tests shard per core/authority/autonomous-authority.mjs:391-392 isShard); nothing else changes
- TRUST_ROOT_RESEAL: update the config/validation.json sha256 in config/trust-root-manifest.json from the real head bytes
- Why: CI runs only test files listed in config/validation.json steps (explicit vitest file lists run by scripts/run-validation.mjs; the Windows shards are aggregated by scripts/validate-shards.mjs). config/validation.json is a protected exact path, is under the protected config/ prefix and is sealed in config/trust-root-manifest.json.
- Authority note: docs/authority/autonomous-authority-policy.proposed.json:40 grants this class to MAINTAINER, but its //TR (:2) says it is not yet an authority source and config/autonomous-authority-policy.json does not exist at 0ddb170, so the autonomous engine cannot authorize it; it goes through the Founder-tier protected path
- Sequencing: config/trust-root-manifest.json is also modified by open PRs #231, #242, #247 and #251; recompute the reseal on the then-current base. Several S-REG appends may be batched in one protected change if every file exists at head (TEST_FILE_NOT_AT_HEAD check, autonomous-authority.mjs:422-426).
- Until merged: package status CODE_COMPLETE_NOT_CI_REGISTERED, not DONE

Out of scope: Editing role-definitions.json or aliases; Approving aliases; Prompt or runtime wiring; core/agents/readiness-audit.ts (consumption moves to C-RDY-2b).

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: #251: config/trust-root-manifest.json (+3/-3); #247: config/trust-root-manifest.json (+2/-2); #242: config/trust-root-manifest.json (+3/-3); #231: config/trust-root-manifest.json (+2/-2)
- Read/import dependencies: none
- Shared with other Lane C packages: C-RDY-1: docs/lanes/LANE-C-MAP.md; C-RDY-2a: docs/lanes/LANE-C-MAP.md; C-RDY-2b: docs/lanes/LANE-C-MAP.md; C-BIND-1: core/agents/role-context.ts
- Note: S-REG: config/validation.json is touched by 0 open PRs; config/trust-root-manifest.json by #231, #242, #247 and #251

### 3. C-RDY-2a (P0): Adapter Reality Map, registry-vs-code reconciliation and the TOOL_READY input

Goal: A code-backed map from adapter ids (registry ids and binding logical ids) to the real module/export, production callers, CI-evidence class and probe state. It computes the registry-vs-code reconciliation (UNDER_REPORTED / OVER_REPORTED / UNREGISTERED_REAL / DEAD_CODE / ADAPTER_UNRESOLVED) and supplies C-RDY-1's adapterReality input (AdapterRealityEntry). Probes default to NOT_OBSERVED; no binary is installed or run.

- Create: `core/capabilities/adapter-reality.ts`; `tests/v7-core-adapter-reality.test.ts (dedicated; needs S-REG)`; `docs/lanes/LANE-C-adapter-reality-mutants.json`; `docs/lanes/LANE-C-adapter-reality-mutants.mjs`; `docs/authority-requests/LANE-C-adapter-reality-test-registration.md`
- Extend: `core/capabilities/resolver.ts (add resolveCapabilityFromReality; healthy comes from the reality map, not a caller boolean)`; `docs/lanes/LANE-C-MAP.md`
- Protected step files: `config/validation.json (S-REG append)`; `config/trust-root-manifest.json (S-REG reseal)`

Initial map evidence:

- gitleaks: core/workos/security-tools.ts:136-139 runGitleaks; callers core/workos/runner.ts:990,1001; ci FAKE_BINARY_ONLY
- trivy: core/workos/security-tools.ts:228-236 runTrivy; caller runner.ts:1019; ci FAKE_ONLY
- ajv / ajv-formats: in-process: apps/control-api/src/routes/{analysis,memory,predev-decisions,product-run,task-runs,tasks}.ts, core/workos/{intake,plan,schemas}.ts; strict validator core/qa/api/strict-json-validator.ts:44 is test-only
- playwright: scripts/e2e/desktop-journey.e2e.mjs:86-93 HARNESS_NOT_CI
- semgrep: DISCOVERY_ONLY core/workos/security-tools.ts:77,283
- git (unregistered): automation/lib/git-isolation.mjs:23, core/workos/git-async.ts:24
- npm/node (unregistered): automation/lib/dependency-install.mjs:73, scripts/dependency-supply-chain.mjs:7
- claude-cli (unregistered): scripts/claude-builder-broker.mjs:25-31 via core/workos/executors.ts:211-238,301-342
- binding ids: local-claude-implementer and local-claude-reviewer -> core/workos/executors.ts; workos-runner and workos-security-stage -> core/workos/runner.ts; workos-predev-* (5) -> core/workos/predev/claude-builder.ts ClaudePreDevBuilder; project-studio-prepare-run-delivery -> core/workos/project-studio.ts:485 ProjectStudio.prepareRunDelivery

Acceptance tests:

- T1 every map entry: the module file exists, a dynamic import exposes the named export (function/class), and each declared production caller file references it; a fixture entry with a non-existent export fails
- T2 reconciliation on real registries: 194 DEFINED, 0 registry-implemented; code-backed registry ids are exactly {gitleaks, trivy, ajv, ajv-formats, playwright}, all UNDER_REPORTED; unregistered real tools are {git, npm, node, claude-cli}; the capability resolver is DEAD_CODE while it has no production importer
- T3 CI honesty: if no .github/workflows file references gitleaks/trivy/playwright, their ciEvidence is not REAL (the test scans the workflows)
- T4 all 10 distinct adapter ids of the 9 FIRST_DELIVERY_BINDINGS resolve in the map; an unknown id gives ADAPTER_UNRESOLVED
- T5 with this map and every probe NOT_OBSERVED, C-RDY-1 TOOL_READY is UNKNOWN 9 (never TRUE 9); with a READY probe stub for every binding adapter it is TRUE 9

Mutants (each must be KILLED):

- M1 mark trivy ciEvidence REAL: killed by T3
- M2 skip the production-caller check: killed by T1 (fabricated caller fixture)
- M3 resolveCapabilityFromReality uses the registry implementation field: killed by T2
- M4 silently drop ADAPTER_UNRESOLVED: killed by T4
- M5 probe defaults to READY: killed by T5

Test host: tests/v7-core-adapter-reality.test.ts (new, dedicated). Earlier plan: tests/v7-b3c-security-stage.test.ts, which is related only for gitleaks/trivy.

Protected step S-REG (performed by COORD / Founder tier, not Lane C; tier: Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED (label as stated by the supervisor; not found in the repo by git grep -i preauthori)):

- TEST_REGISTRATION_APPEND: append "tests/v7-core-adapter-reality.test.ts" as the last element of the command array of step tests-8 (config/validation.json:429-467; last tests shard per core/authority/autonomous-authority.mjs:391-392 isShard); nothing else changes
- TRUST_ROOT_RESEAL: update the config/validation.json sha256 in config/trust-root-manifest.json from the real head bytes
- Why: CI runs only test files listed in config/validation.json steps (explicit vitest file lists run by scripts/run-validation.mjs; the Windows shards are aggregated by scripts/validate-shards.mjs). config/validation.json is a protected exact path, is under the protected config/ prefix and is sealed in config/trust-root-manifest.json.
- Authority note: docs/authority/autonomous-authority-policy.proposed.json:40 grants this class to MAINTAINER, but its //TR (:2) says it is not yet an authority source and config/autonomous-authority-policy.json does not exist at 0ddb170, so the autonomous engine cannot authorize it; it goes through the Founder-tier protected path
- Sequencing: config/trust-root-manifest.json is also modified by open PRs #231, #242, #247 and #251; recompute the reseal on the then-current base. Several S-REG appends may be batched in one protected change if every file exists at head (TEST_FILE_NOT_AT_HEAD check, autonomous-authority.mjs:422-426).
- Until merged: package status CODE_COMPLETE_NOT_CI_REGISTERED, not DONE

Re-check after merge: T1 dynamically imports core/workos/runner.ts (in flight #256) and core/workos/executors.ts (in flight #231, +2/-1). Re-check the export names and caller lines after #256 and #231 merge, and rebase before landing. T3 scans .github/workflows: #251 modifies ci.yml and #66 adds desktop-e2e.yml, so re-run T3 after either merges.

Out of scope: Editing registries/tool-adapters.json or implementation-reality.json (Lane S, STANDBY): the package emits a reconciliation report only; Installing or running real binaries; .github workflows; Skill and technology entity audits (C-RDY-2b).

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: #251: config/trust-root-manifest.json (+3/-3); #247: config/trust-root-manifest.json (+2/-2); #242: config/trust-root-manifest.json (+3/-3); #231: config/trust-root-manifest.json (+2/-2)
- Read/import dependencies: #256: core/workos/runner.ts (+3/-1); #251: .github/workflows/ci.yml (+34/-6); #231: core/workos/executors.ts (+2/-1); #66: .github/workflows/desktop-e2e.yml (+49/-0)
- Shared with other Lane C packages: C-RDY-1: docs/lanes/LANE-C-MAP.md; C-CTX-1: docs/lanes/LANE-C-MAP.md; C-RDY-2b: docs/lanes/LANE-C-MAP.md
- Note: Imports/scans in flight: runner.ts (#256), executors.ts (#231), .github/workflows ci.yml (#251) and desktop-e2e.yml (#66); see recheckAfterMerge
- Note: S-REG: config/validation.json is touched by 0 open PRs; config/trust-root-manifest.json by #231, #242, #247 and #251

### 4. C-RDY-2b (P1): Skill and technology entity readiness audit; PROFILED through the role context

Goal: Entity-level layers for 425 SK2 skills and 415 technologies / 6225 knowledge units, with LEGACY_REFERENCE and PROPOSED_DERIVED kept out of PROFILED. PROFILED in readiness-audit.ts is recomputed through resolveRoleContext (C-CTX-1), with a 599/599 parity assertion. Entity RUNNING is "0 (structural)" while no consumer exists.

- Extend: `core/agents/readiness-audit.ts (auditSkills, auditTechnologies; PROFILED via resolveRoleContext)`; `tests/v7-core-readiness-audit.test.ts (registered by C-RDY-1 S-REG; no new registration)`; `docs/lanes/LANE-C-readiness-audit-mutants.json`; `docs/lanes/LANE-C-MAP.md`

Acceptance tests:

- T1 skills: 425 DEFINED; PROFILED 0/425 canonical; LEGACY_REFERENCE 402/425, unreferenced 23/425; KNOWLEDGE_READY 0/425; INTERNALLY_CERTIFIED 0/425 (NOT_CERTIFIED 425); competency-pack refs resolving in SK2 0/588, flagged ONTOLOGY_SPLIT
- T2 technologies: 415 DEFINED; sourceBacked 0/415; units 6225 NOT_RESEARCHED; KNOWLEDGE_READY 0/415; RUNNING 0 (structural)
- T3 PROFILED parity: for 599/599 roles, PROFILED from readiness-audit equals the value derived from resolveRoleContext (canonical skills only)

Mutants (each must be KILLED):

- M1 count legacy-referenced skills as PROFILED: killed by T1
- M2 count SEED_PROFILE as source-backed: killed by T2
- M3 PROFILED reads proposed skills from the context: killed by T3

Test host: tests/v7-core-readiness-audit.test.ts (dedicated; registered by C-RDY-1 S-REG)

Out of scope: Editing skills-v2.json, competency-packs.json or technologies.json (Lane S); Ontology migration (G16).

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: none
- Read/import dependencies: none
- Shared with other Lane C packages: C-RDY-1: core/agents/readiness-audit.ts, docs/lanes/LANE-C-MAP.md, docs/lanes/LANE-C-readiness-audit-mutants.json, tests/v7-core-readiness-audit.test.ts; C-CTX-1: docs/lanes/LANE-C-MAP.md; C-RDY-2a: docs/lanes/LANE-C-MAP.md

### 5. C-CTX-2 (P1): Canonical role context in pre-dev prompts

Goal: composeRolePrompt adds a bounded Role-definition block from resolveRoleContext for PRE_DEV_ROLE_MAP[kind][0]. The block holds canonical responsibilities, forbiddenActions and boundaries; technologies appear only as labelled unverified candidates; PROPOSED skills are excluded by default. The 5 pre-dev roles then differ in model input, and golden-predev evidence can tell prompt versions apart.

User visibility: Not user-visible in the packaged app until FD-4 wires PREDEV_PRODUCE (server.ts:258; server.ts in flight #231/#242); the model effect needs real-model evidence (FD-3)

- Create: `docs/lanes/LANE-C-role-prompt-mutants.json`; `docs/lanes/LANE-C-role-prompt-mutants.mjs`
- Extend: `core/workos/predev/role-prompts.ts (composeRolePrompt)`; `core/workos/predev/claude-builder.ts (ClaudePreDevBuilder.produce :94-105 passes the resolved context)`; `core/competency/evaluation-pipeline.ts (golden-predev-v2 -> golden-predev-v3; fixtureDigest includes the role-context digest)`; `tests/v7-core-predev-driver.test.ts (listed at config/validation.json:437; no open PR)`

Acceptance tests:

- T1 for each of the 5 kinds the prompt contains the role title, the role id, at least 1 canonical responsibility and the forbiddenActions
- T2 prompt growth stays within a fixed cap (for example 4 KiB)
- T3 no SK2 id and no PROPOSED skill appears by default
- T4 technologies appear only with the literal 'unverified candidate' label
- T5 the existing skeleton/placeholder rejection tests stay green
- T6 the golden-predev-v3 fixtureDigest differs from v2 and changes when the role context changes

Mutants (each must be KILLED):

- M1 omit forbiddenActions: killed by T1
- M2 include proposed skills: killed by T3
- M3 drop the unverified label: killed by T4
- M4 fixtureDigest ignores the context: killed by T6

Test host: tests/v7-core-predev-driver.test.ts (registered at config/validation.json:437; it is the existing test file for the pre-dev driver and claude-builder, so it is the related host)

Out of scope: Wiring preDevBuilder in server.ts (COORD batch, #242 / LANE-C-predev-produce.md); IMPLEMENT/REVIEW prompts; Real-model verification (FD-3).

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: none
- Read/import dependencies: #257: core/workos/predev/placeholder.ts (+2/-2); #231: core/workos/executors.ts (+2/-1)
- Shared with other Lane C packages: C-EVAL-2: core/competency/evaluation-pipeline.ts; C-EVAL-3: core/competency/evaluation-pipeline.ts
- Note: #257 modifies core/workos/predev/placeholder.ts, which role-prompts.ts:3 and evaluation-pipeline.ts:18 import (no shared modified file); rebase after #257
- Note: #231 modifies core/workos/executors.ts, imported as types by claude-builder.ts:9 and evaluation-pipeline.ts:12; re-run typecheck after #231 merges

### 6. C-EVAL-2 (P1): Bind evaluation evidence to the current fixture and binding digests

Goal: The lifecycle evidence verifier can reject evidence whose procedure version/fixtureDigest or bindingSha256 differs from the current procedure or binding (STALE_FIXTURE / STALE_BINDING). It is stricter than the protected validator and fail-closed.

- Create: `docs/authority-requests/LANE-C-evidence-digest.md (validator parity request)`; `docs/lanes/LANE-C-evidence-digest-mutants.json`; `docs/lanes/LANE-C-evidence-digest-mutants.mjs`
- Extend: `core/competency/evaluation-pipeline.ts (export currentProcedureDigests, bindingDigest)`; `core/agents/role-lifecycle.ts (createEvidenceVerifier optional currentDigests)`; `tests/certification.test.ts (listed at config/validation.json:294; avoids the #231 wfr03 file)`

Acceptance tests:

- T1 evidence with matching digests verifies (null)
- T2 changed fixtureDigest gives STALE_FIXTURE
- T3 changed binding limits give STALE_BINDING
- T4 without currentDigests the behaviour is byte-identical to today (parity with the protected validator)
- T5 FAKE is still rejected

Mutants (each must be KILLED):

- M1 skip the fixture compare: killed by T2
- M2 compare the evidence against its own field: killed by T2
- M3 binding digest excludes limits: killed by T3

Test host: tests/certification.test.ts (registered at config/validation.json:294; certification/evidence tests live there)

Out of scope: Promotion into audit/evidence; Editing scripts/validate-role-registry.mjs.

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: none
- Read/import dependencies: #257: core/workos/predev/placeholder.ts (+2/-2); #231: core/workos/executors.ts (+2/-1)
- Shared with other Lane C packages: C-RDY-1: core/agents/role-lifecycle.ts; C-CTX-2: core/competency/evaluation-pipeline.ts; C-EVAL-3: core/competency/evaluation-pipeline.ts, tests/certification.test.ts
- Note: evaluation-pipeline.ts imports placeholder.ts (in flight #257, :18) and executor types (in flight #231, :12); no shared modified file

### 7. C-EVAL-3 (P2): EV-06 BOUNDARY_AND_COST procedure for the 8 consumed bindings

Goal: A second evaluation kind with a deterministic oracle. The bound role runs on a golden mission that tempts it beyond its binding limits; the verdict checks files changed <= maxFilesWritten, cycles <= maxCycles, timeout respected, and reviewer/scratch untouched. Plannable specs go from 8 to 16. Evidence is staged only.

- Extend: `core/competency/evaluation-pipeline.ts (EVALUATION_PROCEDURES; planFor :365 checks evaluationId per procedure instead of EV-01 only)`; `core/competency/evaluation-fixtures.ts (new fixture + FIXTURE_DIGESTS entry)`; `tests/certification.test.ts (or tests/v7-wfr03-role-registry.test.ts after #231 merges)`

Acceptance tests:

- T1 planFor sweep over all 3594 role/EV pairs: 16 plans; refusals ROLE_HAS_NO_BINDING 3540, NO_PROCEDURE EV-02..EV-05 32, delivery 6 (sum 3594)
- T2 a FAKE pair run is stamped FAKE and the verifier rejects it
- T3 the oracle FAILs when a fake implementer writes more than maxFilesWritten and PASSes within the limit
- T4 infrastructure failure gives NOT_EXECUTED and stages nothing
- T5 the plan output states specTextAvailableInRepository:false

Mutants (each must be KILLED):

- M1 oracle ignores maxFilesWritten: killed by T3
- M2 planFor admits EV-02: killed by T1
- M3 FAKE not stamped: killed by T2

Test host: tests/certification.test.ts (registered :294); tests/v7-wfr03-role-registry.test.ts only after #231 merges

Out of scope: EV-02..EV-05; Promotion; Claiming the procedure satisfies the master V2 spec text (not in the repo, FD-6).

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: none
- Read/import dependencies: #257: core/workos/predev/placeholder.ts (+2/-2); #231: core/workos/executors.ts (+2/-1)
- Shared with other Lane C packages: C-CTX-2: core/competency/evaluation-pipeline.ts; C-EVAL-2: core/competency/evaluation-pipeline.ts, tests/certification.test.ts
- Note: evaluation-pipeline.ts imports placeholder.ts (#257) and executor types (#231); evaluation-cli.ts:5 imports LocalClaudeExecutors (#231); no shared modified file

### 8. C-CTX-3 (P2): Role context in IMPLEMENT/REVIEW model input

Goal: MissionSpec carries the run role's resolved context; implementPrompt and reviewPrompt include the canonical role block; developer 0085 and tester 0313 get different model input; AGENT_TRACE records the role-context digest.

- Extend: `core/workos/executors.ts (MissionSpec :14-21, implementPrompt :178-186, reviewPrompt :195-205)`; `core/workos/runner.ts (missionSpec :712-720, recordAgentTrace :842)`; `tests/v7-b3a-runner.test.ts (listed at config/validation.json:354; no open PR)`

Acceptance tests:

- T1 FakeExecutors captures the prompt: roleId 0085 and 0313 give different prompt bytes, each with its own title
- T2 roleId null gives a prompt byte-identical to today
- T3 the AGENT_TRACE note contains roleContextDigest=<sha>
- T4 the reviewer prompt contains the 0252 forbiddenActions; reviewer tools stay Read/Glob/Grep
- T5 prompt size cap

Mutants (each must be KILLED):

- M1 ignore roleId: killed by T1
- M2 add context when roleId is null: killed by T2
- M3 omit the digest: killed by T3

Test host: tests/v7-b3a-runner.test.ts (registered at config/validation.json:354; the runner test file)

Out of scope: server.ts role selection; New bindings.

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: #256: core/workos/runner.ts (+3/-1); #231: core/workos/executors.ts (+2/-1)
- Protected-step files: none
- Read/import dependencies: none
- Shared with other Lane C packages: none
- Note: BLOCKED: both modified files are in flight (#231 executors.ts, #256 runner.ts)

### 9. C-BIND-1 (P2): Evidence-gated binding widening and run-role suggestion

Goal: Derive extra RoleExecutionProfile bindings only for roles that pass explicit gates: a Founder-approved alias makes their skills canonical, the route basis is a technical legacy genome, and limits never exceed the function template. Only the existing developer, tester and security-reviewer functions are used, and STAGE_CONSUMERS is unchanged. Add a pure suggestRunRoles(missionText, contexts) that ranks bound roles with reasons, consumed by Lane B run creation.

- Create: `core/agents/derived-bindings.ts`; `tests/v7-core-derived-bindings.test.ts (dedicated; needs S-REG)`; `docs/authority-requests/LANE-C-derived-bindings-test-registration.md`
- Extend: `core/agents/first-delivery-bindings.ts (merge derived bindings into the binding source)`; `core/agents/role-context.ts`; `registries/role-execution-profiles.json (rebuild via scripts/build-role-execution-profiles.mjs; --check byte-identical)`
- Protected step files: `config/validation.json (S-REG append)`; `config/trust-root-manifest.json (S-REG reseal)`

Acceptance tests:

- T1 with no approved aliases there are 0 new bindings and today's 9 are unchanged
- T2 a fixture approval for 1 SV technical role gives exactly 1 new EXECUTABLE binding with limits <= the developer template
- T3 the lifecycle implemented count rises only for stage-consumed functions
- T4 suggestRunRoles never returns an unbound role
- T5 build-role-execution-profiles --check rebuilds byte-identically

Mutants (each must be KILLED):

- M1 bind via SUSPECTED aliases: killed by T1
- M2 limits exceed the template: killed by T2
- M3 suggest an unbound role: killed by T4

Test host: tests/v7-core-derived-bindings.test.ts (new, dedicated), replacing tests/v7-core-predev-team-composer.test.ts

Protected step S-REG (performed by COORD / Founder tier, not Lane C; tier: Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED (label as stated by the supervisor; not found in the repo by git grep -i preauthori)):

- TEST_REGISTRATION_APPEND: append "tests/v7-core-derived-bindings.test.ts" as the last element of the command array of step tests-8 (config/validation.json:429-467; last tests shard per core/authority/autonomous-authority.mjs:391-392 isShard); nothing else changes
- TRUST_ROOT_RESEAL: update the config/validation.json sha256 in config/trust-root-manifest.json from the real head bytes
- Why: CI runs only test files listed in config/validation.json steps (explicit vitest file lists run by scripts/run-validation.mjs; the Windows shards are aggregated by scripts/validate-shards.mjs). config/validation.json is a protected exact path, is under the protected config/ prefix and is sealed in config/trust-root-manifest.json.
- Authority note: docs/authority/autonomous-authority-policy.proposed.json:40 grants this class to MAINTAINER, but its //TR (:2) says it is not yet an authority source and config/autonomous-authority-policy.json does not exist at 0ddb170, so the autonomous engine cannot authorize it; it goes through the Founder-tier protected path
- Sequencing: config/trust-root-manifest.json is also modified by open PRs #231, #242, #247 and #251; recompute the reseal on the then-current base. Several S-REG appends may be batched in one protected change if every file exists at head (TEST_FILE_NOT_AT_HEAD check, autonomous-authority.mjs:422-426).
- Until merged: package status CODE_COMPLETE_NOT_CI_REGISTERED, not DONE

Out of scope: Certification; New FirstDeliveryFunction kinds; server.ts wiring.

In-flight overlaps (9 open PRs, GitHub REST at 2026-10-26T19:04:39Z):

- Package files: none
- Protected-step files: #251: config/trust-root-manifest.json (+3/-3); #247: config/trust-root-manifest.json (+2/-2); #242: config/trust-root-manifest.json (+3/-3); #231: config/trust-root-manifest.json (+2/-2)
- Read/import dependencies: #242: apps/control-api/src/server.ts (+14/-3); #231: apps/control-api/src/server.ts (+4/-4)
- Shared with other Lane C packages: C-CTX-1: core/agents/role-context.ts
- Note: Its consumer apps/control-api/src/server.ts:313 is protected and in flight in #231 and #242 (out of scope here)
- Note: S-REG: config/validation.json is touched by 0 open PRs; config/trust-root-manifest.json by #231, #242, #247 and #251

## 5. Cross-lane integration tasks

| Id | Lane | Consumes | Task | Protected needs | Test host |
|---|---|---|---|---|---|
| B1 | LANE_B | C-RDY-1, C-RDY-2a (adapterReality, optional) | Extend apps/control-api/src/routes/role-status.ts:registerRoleStatusRoutes so GET /v1/roles/status-summary returns {statusSummary (unchanged), statusSummaryStatus: "DEPRECATED_LEGACY_PROJECTION", readiness: computeRoleReadiness(...), reconciliation: reconcileLegacyStatusSummary(statusSummary, readiness)}. runs = st.hasJournal ? {journal: "PRESENT", runs: st.listRuns(d.scope)} : {journal: "ABSENT"} (role-status.ts:18-19). adapterReality from C-RDY-2a once merged (absent before: TOOL_READY UNKNOWN). reachableStages stays unsupplied (stageWired UNKNOWN): registerRoleStatusRoutes receives {...laneDeps, repoRoot} (server.ts:258,272), and RouteDeps (routes/deps.ts) carries no preDevBuilder and no executor/backend state. Single-source rule: the route computes no counter itself and never sends statusSummary.running without reconciliation.runningMeasured (false when !st.hasJournal); legacy implemented is labelled EXECUTABLE_CODE_PATH_INCLUDES_UNWIRED_STAGES. | none for role-status.ts (the route is already registered at server.ts:272 and allow-listed at main.mjs:72; the renderer mapper ignores unknown top-level keys, agent-factory-core.js:21-23). Passing preDevBuilder presence or executor state needs apps/control-api/src/server.ts, which is protected and in flight in #231 (+4/-4) and #242 (+14/-3): a separate COORD step sequenced after both merge. | Existing route tests: tests/support/protected-batch-3b.cases.ts:142 (imported by tests/v7-b4-desktop-shell.test.ts:579) and tests/v7-wfr03-role-registry.test.ts (in flight #231). A new dedicated test file needs an S-REG step (TEST_REGISTRATION_APPEND tier). |
| B2 | LANE_B | C-CTX-1 | Add GET /v1/roles/:roleId/context inside registerRoleStatusRoutes, returning resolveRoleContext with provenance labels (no server.ts change). | apps/desktop/main.mjs GET allow-list regex (protected; COORD batch; main.mjs is in flight in #242, so sequence after #242) | - |
| B3 | LANE_B | C-CTX-1, C-BIND-1 | Work OS task role: add an optional roleId to WorkTask (core/workos/types.ts:41-43), validate it in submitPlan (core/workos/plan.ts:48) with resolveRoleExecution, persist it via store.ts (Lane Z), and let run creation use the task's role. | apps/control-api/src/server.ts:313 (run creation) is protected and in flight in #231 and #242; core/workos/store.ts is Lane Z-owned (unprotected) | - |
| B4 | LANE_B | C-CTX-1 | Mission-time technology gap: call core/knowledge/technology-discovery.ts requireKnownOrGap with technologies.json names/aliases during intake/analysis, and record DETECTED gaps with knowledgeState SEED_PROFILE as 'not knowledge-ready'. | none (core/knowledge and core/workos/intake.ts are Lane B) | - |
| B5 | LANE_B | - | Wire core/qa/api/strict-json-validator.ts into an API-QA execution path and reconcile the Postman template's empty-string policy (templates/postman/strict-ajv-post-response.js:22 vs strict-json-validator.ts:45). | none | - |
| A1 | LANE_A | B1 | Workforce view: add an 8-layer readiness panel (apps/desktop/renderer/views/workforce.js) with a strict mapReadiness in apps/desktop/renderer/agent-factory-core.js that reads response.readiness and response.reconciliation. Render readiness as the only truth. Show UNKNOWN as "Unknown - no run journal". Show every LayerCount with measured:false as "TRUE k, UNKNOWN u of n", never as a bare 0. While reconciliation.runningMeasured is false, never show statusSummary.running as a number. Label legacy implemented as "code path (includes unwired stages)". Never sum layers or turn them into percentages. Show the denominator next to every count and keep proposedOnly visibly separate. | none | tests/v7-ux-wp-agents.test.ts (listed at config/validation.json:447; no open PR) |
| A2 | LANE_A | B1 (adapterReality from C-RDY-2a) | Tools panel: show registered (194), code-backed, CI-evidence class and probe state separately, with UNDER_REPORTED/DEAD_CODE badges. Do not claim 'installed' without a probe. | none | - |
| A3 | LANE_A | B2 | Role detail card: show canonical responsibilities and forbidden actions, PROPOSED skills labelled 'Proposed - not approved', and technologies labelled 'Seed only - not researched'. | needs the B2 allow-list entry in apps/desktop/main.mjs (COORD; main.mjs in flight #242) | - |
| A4 | LANE_A | - | Run expert selector: replace the misleading 'none' option (work-core.js:374-379 sends {}, and the server assigns UASCO-0085 at server.ts:313) with an explicit 'Developer UASCO-0085 (default)' label. | none; rebase after #258/#242 if they share the test host | - |
| Z1 | COORD | C-RDY-2a | Staff Lane S or grant Lane C a scoped write to correct registries/tool-adapters.json and registries/implementation-reality.json statuses from the C-RDY-2a reconciliation (46 of 52 top-level registries route to the STANDBY Lane S). | validate-paste4c-doc-truth.mjs:59 if counts change | - |
| Z2 | COORD | - | Seal scripts/validate-role-registry.mjs in config/trust-root-manifest.json; it is the only unsealed scripts/validate-* file. | config/trust-root-manifest.json reseal (Founder protected PR) | - |
| Z3 | COORD | C-RDY-1, C-CTX-1, C-RDY-2a, C-BIND-1 | Protected registration batch S-REG: append the dedicated Lane C test files (tests/v7-core-readiness-audit.test.ts, tests/v7-core-role-context.test.ts, tests/v7-core-adapter-reality.test.ts, tests/v7-core-derived-bindings.test.ts; each only once it exists at head) to the end of step tests-8 in config/validation.json (:429-467), changing nothing else, and reseal config/validation.json in config/trust-root-manifest.json from the real bytes. | config/validation.json and config/trust-root-manifest.json; Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED (per supervisor). The manifest is also modified by open PRs #231, #242, #247 and #251: sequence after them or recompute the reseal on the then-current base. | - |

## 6. Founder decisions needed

- FD-1 Legacy alias approval: all 443 aliases are approval=PROPOSED (214 SEMANTIC_VERIFIED covering 197 roles, 61 SUSPECTED, 133 CONFLICT, 35 REJECTED; registries/role-definitions.json:51-80). Decide whether the SV set may become the source of canonical requiredSkillIds, and resolve the CONFLICT/SUSPECTED items. This blocks canonical PROFILED > 0 and C-BIND-1.
- FD-2 Protected evaluation authority: narrow the scripts/validate-role-registry.mjs:24,272-273 invariant (evaluationSpecsExecuted=0, certified=0) to admit verified non-FAKE evidence, and authorize promotion of staged evidence into audit/evidence/role-evaluations (docs/authority-requests/LANE-C-role-evaluation-pipeline.md:32-35). This blocks EVALUATED and INTERNALLY_CERTIFIED > 0.
- FD-3 Real model runs on a Founder machine: run scripts/run-role-evaluation.mjs --execute for the 8 plannable EV-01 specs with Founder-enabled LOCAL_CLAUDE and logged-in implementer/reviewer Claude profiles (subscription usage; allowPaidApi stays false; refused in CI). It is the only path to non-FAKE evidence.
- FD-4 Protected wiring batch (#242 batch-4b-r2 and docs/authority-requests/LANE-C-predev-produce.md): inject preDevBuilder (server.ts:258/271), register the analysis routes, pass reviewerRoleId, and add main.mjs POST allow-list entries for /predev/produce and /analysis/step|plan. Later, also add a GET allow-list entry for /v1/roles/:roleId/context. This blocks reachable EXECUTABLE for the 5 pre-dev roles. Sequencing: apps/control-api/src/server.ts is also modified by #231 (WIN-4 sandbox, +4/-4), so the FD-4 batch (and any other COORD batch touching server.ts) must be sequenced after both #231 and #242 merge.
- FD-5 Knowledge acquisition authority: NETWORK_EGRESS is never granted, so KNOWLEDGE_READY for 415 technologies / 6225 units needs an approved acquisition path (who fetches official sources, version pinning, retrieval date, storage) or Founder-supplied source snapshots.
- FD-6 Supply the master spec document UASCO_NIHAI_TEK_SISTEM_MASTER_V2_DESKTOP_UX001-071_2026-10-14.md (sha256-pinned), which is absent from the repo. It is needed to verify the 3594 specRefs and to design EV-02..EV-06 against real spec text.
- FD-7 Protected validator count pins: scripts/validate-technology-graph.mjs:5,9 and scripts/validate-paste3-technology-domain-registry.mjs:34,36 (415 technologies) and scripts/validate-paste4c-doc-truth.mjs:59 (194 adapters) must change before C#, COBOL, GameMaker and similar records, or git/npm/node adapter records, can be added.
- FD-8 CI security tooling: a .github/workflows change to install pinned gitleaks/trivy (the trivy DB download is network egress) is needed to produce real, non-fake evidence for the SECURITY stage.
- FD-9 Technology verification authority: requiredTechnologies/optionalTechnologies have only two status values, CANDIDATE_NOT_VERIFIED (3359/3359 required entries) and NAME_NOT_VERIFIED_IN_REGISTRY. Both are emitted by scripts/build-role-definitions.mjs:218-219, and no schema enum, code path or authority defines a verified status. Decide who may promote a technology mapping (Lane S / Founder) and the exact promoted status value. Together with FD-1, this blocks canonical PROFILED > 0 (C-RDY-1 PROMOTED_TECHNOLOGY_STATUSES stays empty until then).
- FD-10 Test registration (pre-authorized per supervisor: Founder's TEST_REGISTRATION_APPEND tier, R1 PREAUTHORIZED): execute S-REG (append to step tests-8 + reseal config/validation.json) for each dedicated Lane C test file. This is execution under an existing tier, not a new decision. The tier label is not in the repo, and the proposed autonomous-authority policy is not active at 0ddb170.

## 7. In-flight PRs and overlaps

Source: GitHub REST: GET /repos/salimburakaytemiz/universal-ai-software-factory-/pulls?state=open&base=v7/integration and /pulls/<n>/files?per_page=100, fetched 2026-10-26T19:04:39Z. Open PR count is 9, not 8: #259 (COORD ps1a PID identity; 4 test files) opened after the synthesis; it overlaps no package file.

| PR | Head | Branch | Draft | Files | Protected/shared files of note | Title |
|---|---|---|---|---|---|---|
| #259 | 97c88003f855 | claude/coord-ps1a-pid-identity | False | 4 | - | COORD test(ps1a): verify dead processes by pid + start time, not bare pid (Windows PID reuse) |
| #258 | 689f49af2a57 | claude/lane-a-flow-task-run-link-1 | False | 1 | - | LANE-A A-FLOW-2: fake-DOM journey test for the task to run link step (real control-api) |
| #257 | 661ebd00a1a6 | claude/lane-c-flow-analysis-lows-1 | True | 4 | core/workos/predev/placeholder.ts | C-FLOW-ANALYSIS-2 LOWs (#237 delta review): marks/decomposition in the placeholder guard, honest authority note |
| #256 | 698b83832b0d | claude/lane-c-reviewer-blocked | True | 3 | core/workos/runner.ts | C-PAR-1 follow-up: Founder-fixable reviewer refusals BLOCK the run instead of failing it |
| #251 | f40bea3b8cb3 | claude/coord-protected-ci-tep1 | True | 4 | .github/workflows/ci.yml, config/trust-root-manifest.json, scripts/validate-shards.mjs | COORD PROTECTED CI-TEP1: Linux preflight before the Windows shards + same-run shard reuse across re-run attempts (fixes COORD-001) |
| #247 | 323c14f680c9 | claude/coord-protected-aut2-tmp-cleanup | True | 3 | config/trust-root-manifest.json | [FOUNDER-TIER] COORD PROTECTED: autonomy-hardening selftest removes its temp dirs (16.8 GB leak); pkg-aut2 asserts no leak; trust-root reseal |
| #242 | 8c5e768ba547 | claude/coord-protected-batch-4b-r2 | True | 5 | apps/control-api/src/server.ts, apps/desktop/main.mjs, config/trust-root-manifest.json | [FOUNDER-TIER] COORD PROTECTED batch 4b: analysis + product-run route registration; API-001 (AUD-004) control token deny-by-default |
| #231 | d642963e35af | claude/lane-b-sbx-win-4 | True | 42 | apps/control-api/src/server.ts, config/trust-root-manifest.json, core/agents/linux-unshare-sandbox.ts, core/workos/executors.ts, tests/v7-wfr03-role-registry.test.ts | [FOUNDER-TIER] LANE-B+C sandbox: WSL2 provider (WIN-4), dev-run hardening, Lane C sandbox exports + loopback |
| #66 | ffeaf7950709 | claude/e2e-desktop-verify | True | 4 | .github/workflows/desktop-e2e.yml | E2E-DESKTOP: fail-closed, SHA-bound real Electron route verification (supersedes #50 fixes) |

- #231 (d642963e, 42 files): apps/control-api/src/server.ts (+4/-4): #231 also modifies apps/control-api, not only core/ and tests/; also core/workos/executors.ts (+2/-1), core/agents/linux-unshare-sandbox.ts (+83/-1), tests/v7-wfr03-role-registry.test.ts (+3/-2), config/trust-root-manifest.json (+2/-2), core/workos/devrun.ts (+288/-37), core/workos/execution-gate.ts (+19/-3)
- #242 (8c5e768b, 5 files): apps/control-api/src/server.ts (+14/-3), apps/desktop/main.mjs (+6/-2), config/trust-root-manifest.json (+3/-3), tests/v7-b1-workos.test.ts (+220/-1), tests/v7-b5-work-screens.test.ts (+66/-12)
- server.ts rule: Any COORD batch touching apps/control-api/src/server.ts (FD-4, B1 executor state, B3, G04, G06, G12, G18, G25) is sequenced after both #231 and #242 merge.
- Manifest rule: config/trust-root-manifest.json is modified by #231, #242, #247 and #251; every reseal (S-REG, Z2) is recomputed on the then-current base.

Per-package overlap matrix (package files / protected-step files / read-or-import dependencies):

| Package | #259 | #258 | #257 | #256 | #251 | #247 | #242 | #231 | #66 |
|---|---|---|---|---|---|---|---|---|---|
| C-RDY-1 | - | - | - | - | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | - |
| C-CTX-1 | - | - | - | - | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | - |
| C-RDY-2a | - | - | - | DEP: core/workos/runner.ts | S-REG: config/trust-root-manifest.json; DEP: .github/workflows/ci.yml | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json; DEP: core/workos/executors.ts | DEP: .github/workflows/desktop-e2e.yml |
| C-RDY-2b | - | - | - | - | - | - | - | - | - |
| C-CTX-2 | - | - | DEP: core/workos/predev/placeholder.ts | - | - | - | - | DEP: core/workos/executors.ts | - |
| C-EVAL-2 | - | - | DEP: core/workos/predev/placeholder.ts | - | - | - | - | DEP: core/workos/executors.ts | - |
| C-EVAL-3 | - | - | DEP: core/workos/predev/placeholder.ts | - | - | - | - | DEP: core/workos/executors.ts | - |
| C-CTX-3 | - | - | - | FILE: core/workos/runner.ts | - | - | - | FILE: core/workos/executors.ts | - |
| C-BIND-1 | - | - | - | - | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json | S-REG: config/trust-root-manifest.json; DEP: apps/control-api/src/server.ts | S-REG: config/trust-root-manifest.json; DEP: apps/control-api/src/server.ts | - |

## 8. Sources and unknowns

Area reports: org, skills, tech, tools, exec, ownership.

Synthesizer verification:

- git fetch origin v7/integration -> tip 0ddb170; git diff --stat 5dd3614..tip (5 files, none in initiative paths)
- node recount of registries and knowledge at the tip (counts listed in baseline.inspectedRef.recount)
- read core/agents/role-lifecycle.ts, first-delivery-bindings.ts, role-execution.ts, agent-routing.ts; core/capabilities/resolver.ts; core/knowledge/technology-discovery.ts; apps/control-api/src/routes/role-status.ts; apps/desktop/renderer/agent-factory-core.js:1-40; apps/desktop/main.mjs:35-151 (allow-list); docs/lanes/LANE-C-MAP.md
- config/validation.json test list (host files: :294 certification, :354 v7-b3a-runner, :367 v7-b3c-security-stage, :437 v7-core-predev-driver, :447 v7-ux-wp-agents, :456 v7-core-predev-team-composer)
- config/protected-paths.json: exact server.ts, main.mjs, preload.mjs, renderer app.js and index.html; prefixes include config/ and scripts/validate-; core/agents, core/capabilities, core/competency, core/workos/{runner,executors}.ts and apps/control-api/src/routes/* not protected
- GitHub REST open PRs to v7/integration (8): #258, #257, #256, #251, #247, #242, #231, #66 with their file lists; #255 has merged since the area reports (superseded by inFlight: 9 open PRs at 2026-10-26T19:04:39Z)

Fix-pass verification:

- git show 0ddb170:<file> extracts for the registries and config files listed in baseline.inspectedRef.fixPass; python3 recount: roles 599, guilds 51 (0 roleCount mismatches), clusters 10 (0 guildCount/roleCount mismatches), G35-G38 13/13/14/13 = 53 = CL07
- Per-guild and per-cluster layer counts: bound 9, code path 8 (6 guilds, 3 clusters), stage-wired IMPLEMENT/REVIEW 3 (3 guilds, 2 clusters), candidate skills 197, candidate adapters 164, canonical skills 0, knowledgeSourceRefs 0, specs executed 0/3594, proficiencyStatus NOT_EVALUATED 599
- Gaming: 35 distinct required technologies / 296 entries all CANDIDATE_NOT_VERIFIED, 35/35 in technologies.json (SEED_PROFILE); 13 absent names with 0 slug/name/alias/substring hits; proposed routes 40 DEFAULT_LEAST_PRIVILEGE_READ_ONLY / 13 SEMANTIC_VERIFIED_ALIAS
- Denominators: required technology entries 3359/3359 CANDIDATE_NOT_VERIFIED; roles with 0 required technologies 0 (distribution 3:5, 4:77, 5:66, 6:451); technology types 138 over 415 records, 73/138 singletons; skills referenced by legacy agents 402/425 (19980/19980 refs resolve); adapters referenced 102/194 (5670 refs), 92 never; playwright referenced by 5/363 policies, gitleaks/trivy/ajv/ajv-formats 0/363; capabilities 110/110, fabrics 45/45, binders 16/16 NOT_IMPLEMENTED; 0 code references to UASCO-CAP-001/032 or UASCO-FAB-003/007/013
- Test registration: config/validation.json steps list vitest files explicitly (120 test file args over 49 steps); tests-8 at :429-467 is the last tests shard; config/validation.json is in protected exactPaths, under the config/ prefix and sealed in config/trust-root-manifest.json; core/authority/autonomous-authority.mjs:391-428 defines TEST_REGISTRATION_APPEND; config/autonomous-authority-policy.json absent; scripts/validate-tr-comments.mjs requires //TR in the first 60 lines
- Layer-rule inputs: knowledge/technologies has 415 files named <slug>.json with 15 knowledgeUnits each (facet, state, sourceRefs, lastValidatedAt, certification); registries/technology-source-registry.json requiredProvenance has 7 fields; scripts/build-role-definitions.mjs:218-219 emits the only two technology status values
- GitHub REST at 2026-10-26T19:04:39Z: 9 open PRs to v7/integration with file lists (inFlight); #231 (d642963e, 42 files) modifies apps/control-api/src/server.ts +4/-4; #242 (8c5e768b, 5 files) modifies server.ts +14/-3 and main.mjs +6/-2

Unknowns:

- RUNNING for every role, guild, cluster, binding and code-backed tool: needs a live Work OS run journal, which is not in the repo; reported UNKNOWN everywhere code exists, never 0
- Probe success for gitleaks/trivy and every binding adapter (never observed): TOOL_READY UNKNOWN for the 9 bound roles
- Whether LOCAL_CLAUDE is enabled/READY on any Founder machine (PROVIDER_PROVENANCE is runtime state)
- Staged evaluation evidence outside the repo (<data-dir>/evaluations/staging)
- Whether the master V2 specRefs are accurate (document absent, FD-6)
- Where the tier label "R1 PREAUTHORIZED" is recorded (supplied by the supervisor; not found in the repo)

## 9. Critic fix log (13 issues)

| # | Issue | Change |
|---|---|---|
| 1 | Gaming G35-G38 missing | Added the row "Gaming guilds G35-G38 (cluster CL07)" (denominator 53) and gamingDetail (per-guild 13/13/14/13, 35 technologies, 13 absent names, anomalies); G02, G14 and G19 tied to it; C-RDY-1 T8 asserts 53 and CL07. |
| 2 | No per-guild / per-cluster tables | Added guildTable (51 rows) and clusterTable (10 rows) with DEFINED, PROFILED, KNOWLEDGE_READY, TOOL_READY (TRUE/UNKNOWN/FALSE), EXECUTABLE code path, stage-wired, EVALUATED, INTERNALLY_CERTIFIED, RUNNING and proposed-only counts, all with denominators summing to 599; C-RDY-1 T8 asserts 51 and 10 rows. |
| 3 | Bindings counted as PROFILED | Real execution bindings: PROFILED 0/9 with the reason "capability strings, no SK2 skill or verified technology mapping"; "9 bindings exist" moved to DEFINED. Legacy-policy refs (adapters 102/194, skills 402/425) relabelled LEGACY_REFERENCE, not PROFILED. |
| 4 | Unit tests counted as EVALUATED; TOOL_READY overstated | Adapters row: EVALUATED 0 for every tool; new evidence classes CI_EXERCISED (git, npm, node, ajv), FAKE_ONLY (gitleaks, trivy), NOT_CI_EXECUTED (playwright); TOOL_READY "probe code present; probe success UNKNOWN (never observed)", 0 observed. |
| 5 | Delivery role mixed into EXECUTABLE headline | Headlines now lead with "EXECUTABLE (code path) 8/599; guilds 6/51". The resolver label (9) is only a note; stage-wired 3/599, packaged default 2/599 and backend UNKNOWN are reported separately in the roles, guilds, clusters and bindings rows and the tables. |
| 6 | RUNNING inconsistent | Rule stated in layerStateSemantics. "0 (structural)" only where no code exists (189 registry adapters, skills, legacy genomes, profiles, technologies, binders, 108 capabilities, 42 fabrics). UNKNOWN for the 5 code-backed adapter ids, CAP-001/032, FAB-003/007/013, roles, guilds, clusters, bindings and backends. |
| 7 | Competing truth in C-RDY-1 | whyFirst says "adds the measurement; the correction becomes visible only after B1 + A1". The new statusSummaryPolicy makes computeRoleReadiness authoritative; statusSummary becomes DEPRECATED_LEGACY_PROJECTION computed from the same roleLifecycle rule and checked by reconcileLegacyStatusSummary. B1 and A1 tasks carry the single-source and display rules, with a removal path. |
| 8 | C-RDY-2 too large | Split into C-RDY-2a (adapter reality map, reconciliation, TOOL_READY input; 5 tests, 5 mutants) and C-RDY-2b (skill and technology entity audit plus PROFILED parity via role context); 2a records the re-check of runner.ts/executors.ts imports after #256/#231 and of workflow scans after #251/#66. |
| 9 | Priority rationale | Added packageComparison (C-RDY-1 vs C-CTX-1 vs C-CTX-2: value, unblocked, user-visible, dependsOn). C-CTX-1 is now independent (dependsOn []) and runs in parallel as package 2; readiness-audit consumes it later in C-RDY-2b. |
| 10 | layerRules gaps | Precise tri-state rules with closed reason codes. KNOWLEDGE_READY with no technologies is UNKNOWN (mutant M8); PROFILED needs non-empty skills and technologies (M9); PROFILED is structurally 0 because PROMOTED_TECHNOLOGY_STATUSES is empty until FD-1 + new FD-9 (M10); KNOWLEDGE_READY requires the 7 requiredProvenance fields; noVacuousTruth stated for every layer. |
| 11 | #231 also modifies server.ts | Verified via the GitHub API: #231 modifies apps/control-api/src/server.ts +4/-4 (and executors.ts, linux-unshare-sandbox.ts, wfr03, trust-root manifest). Recorded in G04, G06, G12, G18, G25, FD-4, B1 and B3, plus the serverTsRule; per-package in-flight overlaps are computed for all 9 open PRs. |
| 12 | Missing denominators | Capabilities partial code 2/110, fabrics 3/45, binders 0/16 (name-matched only, 0 code references); skills 402/425 (23 unreferenced); adapters 102/194 (92 never); technology types 138 over 415 records with 73/138 singletons. x/n was also added to the other count cells in the baseline table (descriptive cells such as certification-record structure stay text). Correction found while counting: playwright is referenced by 5/363 legacy policies, not 0. |
| 13 | Tests hidden in an unrelated file | C-RDY-1, C-CTX-1, C-RDY-2a and C-BIND-1 get dedicated test files. Their CI registration is protected step S-REG (TEST_REGISTRATION_APPEND to tests-8 plus a TRUST_ROOT_RESEAL of config/validation.json), marked as needing the Founder tier R1 PREAUTHORIZED, with crossLane Z3 and FD-10. C-RDY-2b reuses the dedicated readiness file. |
