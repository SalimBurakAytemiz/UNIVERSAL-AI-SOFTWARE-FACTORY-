<!-- //TR: Lane A yetki talebi: "Çalışan ürün" kartının B-RUN-1 rotalarına bağımlılığı; yalnız hâlâ eksik olanlar / Lane A authority request: what the running-product card still needs (B-RUN-1 routes) -->
# LANE-A-devrun-allowlist: running product after delivery (A-FLOW-4), what is still missing

The Overview "Running product" card (`apps/desktop/renderer/views/product-card.js`) is built on Lane B's B-RUN-1 contract (branch `claude/lane-b-run-1`, `routes/product-run.ts`). The protected pieces are specified by Lane B, not repeated here:

- **`server.ts` registration** (`registerProductRunRoutes`) and the **Electron regexes**
  `GET /^\/v1\/work-runs\/run_[0-9a-f]{24}\/product$/` and `POST /^\/v1\/work-runs\/run_[0-9a-f]{24}\/product\/(?:start|stop)$/`: see `docs/authority-requests/LANE-B-devrun-bridge.md` on that branch.

## Nothing else is requested from the coordinator
The card reads only `GET /v1/work-runs/:id/product`, `GET /v1/projects/:id/flow` and `GET /v1/system/executors` (the last two are already admitted) and posts only the two product routes with an empty body.

## Until those two protected changes land
The card shows an honest `UNAVAILABLE` ("not available to the desktop yet… nothing is assumed"); it never falls back to the older project dev-run route and never offers a host-run path.

## Rules the card follows (asserted in `tests/v7-ps1b-project-studio-ui.test.ts`, "LANE-A A-FLOW-4")
- Start is offered only when the server's flow reports DELIVERY DONE, the product record has a delivered commit, no other delivery's product is running, and after the existing confirmation. Stop only for this delivery's own product.
- The local address is shown only for this delivery's product with status RUNNING, `bridged=true`, an AVAILABLE preview and exactly `http://127.0.0.1:<port>/` (port equal to the reported one).
- A refusal shows the server's exact reason (`DEVRUN_SANDBOX_UNAVAILABLE:<reason>`, `SANDBOX_UNAVAILABLE`, `PRODUCT_RUN_NOT_DELIVERABLE`, `PRODUCT_RUN_NOT_THIS_DELIVERY`); unknown codes stay raw and flagged.
- `BLOCKED` is retryable (`devRunActions("BLOCKED").start === true`): the server re-asks the sandbox gate on every start.
- The mapper rejects the whole read if the answer is for another run, the delivered commit is not 40 lowercase hex or null, or `tiedToThisRun` contradicts `deliveryRunId`.
