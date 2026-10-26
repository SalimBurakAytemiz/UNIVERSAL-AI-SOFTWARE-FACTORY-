<!-- //TR: Lane A yetki talebi: "Çalışan ürün" kartı için dev-run allow-list gereksinimi / Lane A authority request: dev-run allow-list needs of the running-product card -->
# LANE-A-devrun-allowlist: running product after delivery (A-FLOW-4)

## Today: no protected change needed
The Overview "Running product" card (`apps/desktop/renderer/views/product-card.js`) uses only paths the desktop already admits:
- `GET /v1/projects/prj_<24hex>/devrun` (`PS_GET_ROUTE_RE` in `apps/desktop/main.mjs`)
- `GET /v1/projects/prj_<24hex>/flow` (`PROJECT_FLOW_RE`)
- `GET /v1/system/executors` (`main.mjs` GET allow-list)
- `POST /v1/projects/prj_<24hex>/devrun/(start|stop)` (POST allow-list; empty body)

Rules the card follows (also asserted in `tests/v7-ps1b-project-studio-ui.test.ts`, "LANE-A A-FLOW-4"):
- Start is offered only when the server's flow reports the DELIVERY stage DONE, and only after the existing confirmation. Stop is always offered for a live process.
- A refusal (BLOCKED + reason, e.g. `SANDBOX_UNAVAILABLE`, `DEVRUN_SANDBOX_UNAVAILABLE`) is shown with the server's reason; unknown codes stay raw and flagged. There is no "run anyway on the host" path.
- The local address is shown only when the server reports RUNNING with an AVAILABLE preview on exactly `http://127.0.0.1:<port>/` (port matches the reported port).
- `BLOCKED` is retryable in the UI (`devRunActions("BLOCKED").start === true`); the server re-asks the sandbox gate on every start.

## Pending: B-RUN-1 (Lane B, `core/workos/devrun.ts`)
When B-RUN-1 changes route shapes (a "listening" status, a bridged-port field, a new refusal body), the coordinator sends them and I make one alignment commit. If B-RUN-1 adds a new path (for example a separate bridge status route), the exact main.mjs diff will be added here as:
```diff
+const PROJECT_DEVRUN_BRIDGE_RE=/^\/v1\/projects\/prj_[0-9a-f]{24}\/devrun\/<new-segment>$/;
```
Nothing is requested until that route exists.
