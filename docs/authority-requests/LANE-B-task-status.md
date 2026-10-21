<!-- //TR: Lane B yetki talebi: görev durum geçişleri için korumalı store.ts ve types.ts yaması (yalnız Founder uygular) -->
# LANE-B-task-status: task status transitions need a store.ts change (forbidden to Lane B)

Why: tasks are created (`TASK_CREATED`) but nothing can ever change their status; the journal has no task-transition event, so PENDING -> IN_PROGRESS -> DONE / BLOCKED has no durable path. The flow read model (LANE-B-flow) and Desktop task boards show tasks that can never advance. Adding it in a side file would create a second source of truth, so the canonical store must own it.

Consumer screens: task board / mission detail (SCREEN_AUDIT_252 task screens), `GET /v1/projects/:id/flow` PLAN stage.

## Patch 1: core/workos/types.ts
```diff
-export type JournalType = "PROJECT_CREATED" | "MISSION_CREATED" | "TASK_CREATED" | "MISSION_TRANSITIONED"
+export type JournalType = "PROJECT_CREATED" | "MISSION_CREATED" | "TASK_CREATED" | "TASK_TRANSITIONED" | "MISSION_TRANSITIONED"
```

## Patch 2: core/workos/store.ts (replay + write; mirrors transitionMission)
```diff
+      case "TASK_TRANSITIONED": {
+        const t = isStr(p.taskId) ? st.tasks[p.taskId] : undefined;
+        if (!t || t.tenantId !== p.tenantId || !isTaskStatus(p.to) || t.status !== p.from) throw tampered(`TASK_TRANSITION_INCONSISTENT:${e.seq}`);
+        t.status = p.to; break;
+      }
@@ after createTask
+  transitionTask(scope: Scope, taskId: string, to: TaskStatus, reason: string, actor: string): WorkTask {
+    return this.write(() => {
+      const t = this.state.tasks[taskId];
+      if (!t || t.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "task");
+      if (typeof reason !== "string" || reason.trim().length === 0) throw new WorkOsError("WORKOS_INVALID_INPUT", "reason");
+      if (!(TASK_TRANSITIONS[t.status] ?? []).includes(to)) throw new WorkOsError("WORKOS_INVALID_TRANSITION", `${t.status}->${to}`);
+      // IN_PROGRESS only when every dependsOn task is DONE.
+      if (to === "IN_PROGRESS" && t.dependsOn.some(d => this.state.tasks[d]?.status !== "DONE")) throw new WorkOsError("WORKOS_CONFLICT", "TASK_DEPENDENCIES_NOT_DONE");
+      this.append("TASK_TRANSITIONED", actor, {taskId, tenantId: t.tenantId, from: t.status, to, reason: reason.slice(0, 1000)});
+      return this.state.tasks[taskId];
+    });
+  }
```
`TASK_TRANSITIONS = {PENDING:[IN_PROGRESS,BLOCKED], IN_PROGRESS:[DONE,BLOCKED,PENDING], BLOCKED:[PENDING], DONE:[]}`; `isTaskStatus` guards the replay.

## Follow-up Lane B work once applied
`POST /v1/tasks/:id/transition` in `routes/tasks.ts` (same gates: Global Stop 423, policy 403, strict body `{to, reason}`, tenant scope, audit), `GET /v1/missions/:id/tasks` already exists in LANE-B-plan. Tests: positive transition chain, invalid transition 409, dependency gate 409, replay after restart, tamper detection of an inconsistent TASK_TRANSITIONED, tenant isolation, route 400/403/404/423.
