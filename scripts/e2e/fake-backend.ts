// //TR: Bu betik masaüstü uçtan uca testinin (desktop-journey.e2e.mjs) arka ucudur: gerçek Control API'yi (buildServer) geçici veri dizininde, FAKE yürütücüyle (gerçek Claude ve ağ YOK) ve etkin runner ile 127.0.0.1'de başlatır. Sandbox enjekte EDİLMEZ: varsayılan sağlayıcı yoksa testler dürüstçe NOT_EXECUTED kalır, proje kodu host'ta çalıştırılmaz. Yalnız test içindir; üretim yolu değildir.
import path from "node:path";
import fs from "node:fs";
import {buildServer} from "../../apps/control-api/src/server.js";
import {FakeExecutors} from "../../core/workos/executors.js";

const need = (k: string): string => { const v = process.env[k]; if (!v) { process.stderr.write(`E2E_BACKEND_ENV_MISSING:${k}\n`); process.exit(2); } return v; };
const root = path.resolve(need("E2E_DATA_ROOT")), port = Number(need("CONTROL_API_PORT")), token = need("UASCO_CONTROL_TOKEN");
const runtime = path.join(root, "runtime"), dataDir = path.join(root, "workos"), controlRoot = path.join(root, "control");
for (const d of [runtime, dataDir, controlRoot]) fs.mkdirSync(d, {recursive: true});
const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "e2e\n"}, message: "e2e: fake implementation"}), review: () => ({verdict: "CLEAN"})});
const app = buildServer({controlToken: token, runtime, dataDir, controlRoot, port, repoRoot: process.cwd(), logger: false, executors: fake.pair(), runner: {enabled: true, intervalMs: 500}});
await app.listen({host: "127.0.0.1", port});
process.stdout.write(`E2E_BACKEND_READY port=${port}\n`);
const stop = async () => { try { await app.close(); } finally { process.exit(0); } };
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
