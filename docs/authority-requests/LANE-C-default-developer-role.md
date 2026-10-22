<!-- //TR: LANE-C yetki talebi: korumalı server.ts içindeki run başlatma rotası roleId'yi gövdeden alır; yoksa null kalır ve rol kapısı/AGENT_TRACE ürün akışında hiç devreye girmez. -->
# LANE-C authority request: default the run's role to the bound developer role

## Why
`POST /v1/work/missions/:id/runs` (apps/control-api/src/server.ts, protected) creates the run with `roleId: b.roleId ?? null`. The Desktop does not send a role today, so product runs are role-less: the runner's implementer role gate and the `AGENT_TRACE` evidence (core/workos/runner.ts) never run for them. A role-less run is honest but untraceable to an agent role.

## Proposed patch (apps/control-api/src/server.ts, run-start route)
```diff
-  const r=getStore().createRunDetailed({tenantId:scope.tenantId,missionId:req.params.id,roleId:b.roleId??null,executor:{...
+  const r=getStore().createRunDetailed({tenantId:scope.tenantId,missionId:req.params.id,roleId:b.roleId??"UASCO-0085",executor:{...
```
`UASCO-0085` is the developer binding in core/agents/first-delivery-bindings.ts. An explicit `roleId` still wins; an unbound or non-implementer role is BLOCKED by the runner gate with `ROLE_NOT_EXECUTABLE:<reason>` before any builder call.

## Risk / notes
- Changes only the default for new runs; existing runs and explicit roleIds are untouched. Idempotency digest includes roleId, so a replayed key created earlier with no role would no longer match (409/new run); coordinator to decide if acceptable.
- Does not mark anything certified; the trace states `certification: NOT_CERTIFIED`.

## Tests that prove it
- Route test: run started with no roleId has `roleId === "UASCO-0085"` and, after a tick, one `AGENT_TRACE` evidence.
- Route test: explicit `roleId: "UASCO-0252"` run ends BLOCKED with `ROLE_NOT_EXECUTABLE:BINDING_ROLE_MISMATCH:UASCO-0252:implementer`.
- Existing runner role-gate test (tests/v7-b3a-runner.test.ts) already covers the engine side.
