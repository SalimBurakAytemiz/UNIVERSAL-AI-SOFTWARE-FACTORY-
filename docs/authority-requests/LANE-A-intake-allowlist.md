<!-- //TR: Lane A yetki talebi: intake rotalarını masaüstü GET/POST allow-list'ine ekleyen main.mjs yaması ve kanıtı / Lane A authority request: main.mjs patch adding the intake routes to the desktop GET and POST allow-lists -->
# LANE-A-intake-allowlist: allow `/v1/intakes` in the desktop main process (protected)

Why: `apps/desktop/main.mjs` is protected. The Projects screen now has a "Start from an idea" panel (`views/intake.js`, UI-126) that posts the Founder's idea to `POST /v1/intakes` (creates the project and its first mission in one step) and lists earlier ideas with `GET /v1/intakes`. The routes are Lane B's (`claude/lane-b-intake`; registration requested in `docs/authority-requests/LANE-B-intake.md`). Until this allow-list entry and Lane B's `server.ts` registration are applied, the bridge refuses the calls: the form shows the honest refusal and the list shows UNAVAILABLE. No new IPC or storage. The generic 32 KB body check already covers the renderer body (idea at most 4000 characters plus short optional fields).

## Patch (apps/desktop/main.mjs)
```diff
 // B4-ALLOWLIST block
+const INTAKES_LIST_RE=/^\/v1\/intakes$/;
@@ in desktopExtraGetPathAllowed(value), extend the final return chain with:
+||INTAKES_LIST_RE.test(value)
 // B5-POST-ALLOWLIST block
-const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,
+const POST_ROUTE_RES=[/^\/v1\/projects$/,/^\/v1\/missions$/,/^\/v1\/intakes$/,
```
Single-intake reads (`GET /v1/intakes/itk_<24 hex>`) are not used by the renderer yet, so they are deliberately not requested here.

## Tests that prove it (tests/v7-ps1b-project-studio-ui.test.ts, main.mjs allow-list describes)
- GET `/v1/intakes` allowed; `/v1/intakes?x=1`, `/v1/intakes/`, `/v1/intakes/itk_x`, `/v1/intakesX` rejected.
- POST `/v1/intakes` allowed; with a trailing slash, query, extra segment, or any other method rejected.
- Renderer side, tested in this PR: strict `buildIntakeRequest` (server schema), strict `mapIntake`/`mapIntakes` with sources carried verbatim, no request on validation errors, honest refusal and UNAVAILABLE states.
