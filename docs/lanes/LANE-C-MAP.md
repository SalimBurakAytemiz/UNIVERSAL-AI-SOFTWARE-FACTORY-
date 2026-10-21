<!-- //TR: LANE-C haritası: rol tanımı ile çalışan ajanın ayrımı, ilk teslim akışı bağlamaları ve dürüst NOT_EXECUTABLE durumları. -->
# LANE-C map (agents / Work OS / tools)

- Definition vs running agent: `core/agents/role-execution.ts` — `RoleExecutionProfile` (data on a role definition) vs `RunningAgent` (needs EXECUTABLE resolution + runId; tool gate; trace envelope).
- Bindings: `core/agents/first-delivery-bindings.ts` — planner UASCO-0019, architect 0043, developer 0085, tester 0313, security reviewer 0252, delivery 0232. All other roles: `NOT_EXECUTABLE:ROLE_HAS_NO_BINDING`.
- Certification: never granted; `EVALUATED_PASS` only if all catalog evaluationSpecs PASSED with evidence (today 0/3594).
- Tools: only `config/builder-execution-policy.json` allowedTools; reviewer-route read-only; delivery uses no model tools (ProjectStudio).
- Wired: `crewDevExecutors` (core/workos/crew/dev-review.ts) is fail-closed via `assertRoleExecutes` (developer / security-reviewer). Not yet wired: team-composer selections, runner role gate; widening guild by guild.
- Tests: `tests/v7-core-predev-team-composer.test.ts` ("LANE-C role execution resolver").
