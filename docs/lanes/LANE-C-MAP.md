<!-- //TR: LANE-C haritası: rol tanımı ile çalışan ajanın ayrımı, ilk teslim akışı bağlamaları ve dürüst NOT_EXECUTABLE durumları. -->
# LANE-C map (agents / Work OS / tools)

- Definition vs running agent: `core/agents/role-execution.ts` — `RoleExecutionProfile` (data on a role definition) vs `RunningAgent` (needs EXECUTABLE resolution + runId; tool gate; trace envelope).
- Bindings: `core/agents/first-delivery-bindings.ts` — pre-dev primaries business analyst UASCO-0022, requirements engineer 0023, UX designer 0031, then planner 0019, architect 0043, developer 0085, tester 0313, security reviewer 0252, delivery 0232. All other roles: `NOT_EXECUTABLE:ROLE_HAS_NO_BINDING`.
- Certification: never granted; `EVALUATED_PASS` only if all catalog evaluationSpecs PASSED with evidence (today 0/3594).
- Tools: only `config/builder-execution-policy.json` allowedTools; reviewer-route read-only; delivery uses no model tools (ProjectStudio).
- Wired: `crewDevExecutors` (core/workos/crew/dev-review.ts) is fail-closed via `assertRoleExecutes` (developer / security-reviewer). Team summary reports per-role executability (read-only). Runner IMPLEMENT step blocks a run whose roleId has no executable developer binding (roleId null = unchanged). Next: widen guild by guild.
- Routing/recovery: `core/agents/agent-routing.ts` — read-only provider route readiness (no login => NOT_READY, never personal profile) and agent checkpoint/restore (fail-closed on corruption, missing/changed/incomplete binding).
- Runner IMPLEMENT gate accepts implementer-route roles (developer 0085, tester 0313) via `assertImplementerRole`.
- Run evidence: IMPLEMENT step of a role-assigned run also writes an `AGENT_TRACE` evidence (agentInstanceId != roleId, route, allowed tools, state; per-call tool trace stated NOT_OBSERVABLE_FROM_ADAPTER).
- Sandbox (v2, after adversarial review): minimal pivot_root root, project never pid 1, per-run mountinfo audit, canary-based selfTest; v1 (#168) was unsafe and never wired - see docs/authority-requests/LANE-C-linux-sandbox-provider.md.
- Tests: tests/v7-b3a-runner.test.ts (LANE-C role gate + AGENT_TRACE); `tests/v7-core-predev-team-composer.test.ts` ("LANE-C role execution resolver").
