// //TR: DSK-T0001 E2E yardımcısı: GERÇEK Control API'yi (apps/control-api/src/server.ts buildServer) FAKE_EXECUTOR (core/workos/executors.ts FakeExecutors) + FAKE güvenlik tarayıcıları ile, sandbox AÇIKÇA yok (sandbox:null) ve runner açık olarak başlatır. Ücretli API/gerçek model çağrısı YOKTUR; kanıt yalnız FAKE_EXECUTOR kanıtıdır, gerçek model veya gerçek sandbox kanıtı değildir.
// Usage (run through tsx so server.ts can be imported): node node_modules/tsx/dist/cli.mjs scripts/e2e-fake-executor-api.mjs
// Env: CONTROL_API_PORT, UASCO_CONTROL_TOKEN, UASCO_DATA_DIR (required); UASCO_E2E_RUNTIME (runtime dir, default <UASCO_DATA_DIR>/../runtime).
// server.ts listens only when it is the entry script, so importing it here opens no port by itself; this file calls listen once.
import fs from "node:fs";
import path from "node:path";
import {buildServer} from "../apps/control-api/src/server.ts";
import {FakeExecutors} from "../core/workos/executors.ts";
import {fakeSecurity} from "../core/workos/security-tools.ts";

const need = k => { const v = process.env[k]; if (!v) { console.error(`E2E_FAKE_API: missing ${k}`); process.exit(2); } return v; };
const port = Number(need("CONTROL_API_PORT")), controlToken = need("UASCO_CONTROL_TOKEN"), dataDir = path.resolve(need("UASCO_DATA_DIR"));
const runtime = path.resolve(process.env.UASCO_E2E_RUNTIME ?? path.join(path.dirname(dataDir), "runtime"));
fs.mkdirSync(runtime, {recursive: true});

// FAKE_EXECUTOR: deterministic implementer writes two files (marked as fake) and the reviewer answers CLEAN; nothing calls a model.
export const FAKE_FILES = Object.freeze({
  "src/streak.js": "// FAKE_EXECUTOR output (DSK-T0001 E2E): not written by a model.\nexport const streak = days => days.length;\n",
  "FAKE_EXECUTOR.md": "This change was produced by the UASCO FAKE_EXECUTOR in an automated end-to-end test. It is not real-model output.\n"
});
const fake = new FakeExecutors({implement: () => ({files: {...FAKE_FILES}, message: "FAKE_EXECUTOR: e2e change"}), review: () => ({verdict: "CLEAN"})});
// Fake security scanners (gitleaks/trivy stand-ins) so the run does not need those tools installed; their output is fake too.
const security = fakeSecurity(path.join(path.dirname(dataDir), "fake-security")).options;

const app = buildServer({controlToken, runtime, dataDir, port, logger: false, executors: fake.pair(), sandbox: null,
  runner: {enabled: true, intervalMs: 500, security}});
await app.listen({host: "127.0.0.1", port});
console.log(JSON.stringify({status: "LISTENING", port, executor: "FAKE_EXECUTOR", sandbox: "NONE", security: "FAKE_SECURITY_TOOLS"}));
const stop = async () => { try { await app.close(); } finally { process.exit(0); } };
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, stop);
