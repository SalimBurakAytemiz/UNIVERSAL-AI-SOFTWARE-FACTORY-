<!-- //TR: Lane B yetki talebi: intake template (yönetilen depo) için isteğe bağlı server.ts yaması; Electron izin listesi değişikliği gerekmez -->
# LANE-B-intake-template: intake creates a runnable project (managed repository) — first-delivery link B-FLOW-1

Gap (first MISSING backend link on idea -> project -> plan -> run): a project created by `POST /v1/intakes` had no repository, so the first run was BLOCKED at the runner with `REPOSITORY_NOT_CONFIGURED` (readiness showed it). `POST /v1/projects` already creates a managed git repository when `template` is given; intake did not.

`POST /v1/intakes` now accepts optional `template` (`web-node` | `node-lib` | `empty`, the same enum as projects). With a template the project is created through the same store method and `ProjectStudio.createTemplateRepository`: a managed git repository with an initial commit, the template's `testCommand` / `devCommand` / `projectType` as defaults (a Founder-given `testCommand` / `projectType` wins). `template` and `repository` are mutually exclusive (400). Idempotent replay returns the same project and creates no second repository; a different template under the same key is 409. A repository setup failure answers its fixed code (`PROJECT_REPOSITORY_INIT_FAILED` 500) and leaves no project, mission or intake behind. No path is returned.

No registration change is needed (`registerIntakeRoutes` is already in server.ts) and `POST /v1/intakes` is already in the Desktop allow-list; the body stays well under the 32 KiB limit. The renderer (Lane A) has to send `template` to use it.

## Optional patch (server.ts, one instance instead of a route-local one)
Without it the route builds its own `ProjectStudio` with the same `dataDir` and `config/environment-policy.json` (resolved from the working directory, like `repoRoot` default). To share the server's single instance:
```diff
-const laneDeps={ ... };
+const laneDeps={ ..., studio:()=>getStudio() };
```
(`studio?: () => {createTemplateRepository(...)}` is an optional field of `RouteDeps`. Pass a closure, `studio:()=>getStudio()`, not the bare `getStudio`: `laneDeps` is built before `getStudio` is initialised, so the bare reference is a TDZ error (TS2448/TS2454).)

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 120 passed (+4 in "LANE-B project intake"). Mutations: base intake.ts (3 of the 4 new tests fail), managed-repo wiring removed (3 fail), template testCommand default ignored (1), exclusivity dropped (1), template left out of the idempotency digest (1), StudioError mapping removed (1) — all killed.
Honest limit: the generated project is only as real as the template; "one real generated web+API project" needs Lane C's implementer run on top of this repository.
