// //TR: Bu betik masaüstü uçtan uca testinin (desktop-journey.e2e.mjs) arka ucudur: gerçek Control API'yi (buildServer) geçici veri dizininde, FAKE yürütücüyle (gerçek Claude ve ağ YOK) ve etkin runner ile 127.0.0.1'de başlatır. Sandbox enjekte EDİLMEZ: varsayılan sağlayıcı yoksa testler dürüstçe NOT_EXECUTED kalır, proje kodu host'ta çalıştırılmaz. Yalnız test içindir; üretim yolu değildir.
import path from "node:path";
import fs from "node:fs";
import {buildServer} from "../../apps/control-api/src/server.js";
import {FakeExecutors} from "../../core/workos/executors.js";
import {WorkOsStore} from "../../core/workos/store.js";
import {AnalysisFlow} from "../../core/workos/crew/analysis.js";
import {TASKHUB_ARTIFACTS} from "../../core/workos/predev/fixtures/taskhub/index.js";

const need = (k: string): string => { const v = process.env[k]; if (!v) { process.stderr.write(`E2E_BACKEND_ENV_MISSING:${k}\n`); process.exit(2); } return v; };
const root = path.resolve(need("E2E_DATA_ROOT")), port = Number(need("CONTROL_API_PORT")), token = need("UASCO_CONTROL_TOKEN");
const runtime = path.join(root, "runtime"), dataDir = path.join(root, "workos"), controlRoot = path.join(root, "control");
for (const d of [runtime, dataDir, controlRoot]) fs.mkdirSync(d, {recursive: true});
const fake = new FakeExecutors({implement: () => ({files: {"feature.txt": "e2e\n"}, message: "e2e: fake implementation"}), review: () => ({verdict: "CLEAN"})});
const app = buildServer({controlToken: token, runtime, dataDir, controlRoot, port, repoRoot: process.cwd(), logger: false, executors: fake.pair(), runner: {enabled: true, intervalMs: 500}});
// //TR: Yalnız bu test arka ucuna özgü iki kontrol rotası (gerçek sunucu kodunda YOKTUR; masaüstü izin listesi bu yolları zaten reddeder, çağıran yalnız E2E betiğidir ve aynı belirteçle kimlik doğrular): (1) istek günlüğü, (2) "onay yazıldı ama faz ilerlemedi" durumunun tohumu.
const requests: Array<{method: string; url: string; status: number}> = [];
app.addHook("onResponse", async (req: any, reply: any) => { if (!String(req.url).startsWith("/__e2e/")) requests.push({method: req.method, url: String(req.url), status: reply.statusCode}); });
app.get("/__e2e/requests", async () => ({requests}));
// Tohum: sunucunun AYNI veri dizininde ikinci bir depo örneği kullanılır (yazılanlar API'den görünür, doğrulandı); taslak sabit TaskHub örneğinden üretilir (gerçek Claude YOK), sonra onay yazılır ama faz ilerletilmez (kesintiye uğramış onay).
app.post("/__e2e/seed-stuck-artefact", async (req: any, reply: any) => {
  const missionId = String(req.body?.missionId ?? "");
  if (!/^msn_[0-9a-f]{24}$/.test(missionId)) return reply.code(400).send({error: "INVALID_MISSION_ID"});
  const scope = {tenantId: "local"}, store = new WorkOsStore(dataDir);
  const flow = new AnalysisFlow({store, scope, builder: {async produce(kind: any) { return JSON.stringify((TASKHUB_ARTIFACTS as any)[kind]); }}, readiness: () => ({ready: true, blockers: [], blocker: null, founderAction: null, profiles: null})});
  const draft: any = await flow.step(missionId);
  if (draft.status !== "DRAFT_READY") return reply.code(409).send({error: "SEED_NOT_DRAFT_READY", status: draft.status});
  const preDevId = store.preDevReadModel(scope, missionId).preDevId!, art = store.getPreDevArtifact(scope, draft.artifactId)!;
  store.transitionPreDevArtifact(scope, preDevId, draft.artifactId, "SUBMITTED", {}, art.recordedBy);
  store.transitionPreDevArtifact(scope, preDevId, draft.artifactId, "APPROVED", {evidenceRefs: ["ev-seed-1"]}, "FOUNDER_LOCAL");
  return {kind: draft.kind, artifactId: draft.artifactId, phase: store.preDevReadModel(scope, missionId).phase};
});
await app.listen({host: "127.0.0.1", port});
process.stdout.write(`E2E_BACKEND_READY port=${port}\n`);
const stop = async () => { try { await app.close(); } finally { process.exit(0); } };
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
