<!-- //TR: Lane B yetki talebi: Control API hata sözleşmesi (sabit kodlu çerçeve hataları) için server.ts yaması ve tarama kanıtı -->
# LANE-B-error-contract: fixed-code framework errors (protected server.ts change)

Finding (contract sweep over 21 first-delivery routes x malformed ids x 7 bad bodies, real server): **zero 5xx, zero leaked paths or stacks**. The gap is consistency: errors raised by Fastify itself (bad JSON, wrong content type, oversize body, malformed or over-long URL parameter, unknown route, any uncaught exception) use Fastify's own body (`{statusCode, code:"FST_ERR_...", error:"Bad Request", message}`) instead of the API's fixed-code contract `{error:"UPPER_SNAKE_CODE"}`. 126 of the probed responses had the wrong shape. An uncaught exception would also put its raw `message` in a 500 body.

`apps/control-api/src/routes/error-contract.ts` provides `registerErrorContract(app)` (sets the error and not-found handlers) and `frameworkErrors` (Fastify constructor option; router-level errors never reach `setErrorHandler`). Mapping: INVALID_JSON 400, UNSUPPORTED_MEDIA_TYPE 415, BODY_TOO_LARGE 413, BAD_URL 400, URL_TOO_LONG 414, NOT_FOUND 404, other 4xx INVALID_REQUEST (status kept), everything else INTERNAL_ERROR 500 with the detail only in the server log.

## Patch (server.ts)
```diff
+import {registerErrorContract,frameworkErrors} from "./routes/error-contract.js";
-const app=Fastify({logger:opts.logger??true,requestIdHeader:"x-request-id",genReqId:()=>crypto.randomUUID(),bodyLimit:64*1024});
+const app=Fastify({logger:opts.logger??true,requestIdHeader:"x-request-id",genReqId:()=>crypto.randomUUID(),bodyLimit:64*1024,frameworkErrors});
+registerErrorContract(app);
```
Route-level handlers are untouched (their `{error:"CODE"}` bodies and `wos`/`workosFail` mapping win). Only errors that previously fell through to Fastify's defaults change shape. The Electron bridge treats any non-2xx as failure; clients that parsed Fastify's `message` for these framework errors (none found in the repo) would see only the code.

## Evidence
`npx vitest run tests/v7-b1-workos.test.ts`: 53 passed (2 new "LANE-B first-delivery 4xx/5xx contract sweep"). The sweep runs against the real `buildServer` with `registerErrorContract` applied (it failed with 126 shape violations before the handler existed) and a separate test proves the router-level errors, unknown route and a thrown exception on a standalone Fastify with `frameworkErrors`. Mutations (change the 415 mapping; pass a 5xx status through; leak the error message) each made a test fail.
