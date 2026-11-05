// //TR: Bu dosya (CLOUD-T0016, kanıt sınıfı LOCAL_E2E) bulut zincirini TEK yerel süreçte barındırır (korumalı satır yok; HTTP başlatma yolu yok; server.ts bağlantısı ayrı COORD paketidir): CLOUD-T0003 iş kuyruğu + CLOUD-T0008 artifact deposu (dosya sistemi) + CLOUD-T0010 orkestratör (imzalı tek kullanımlık Founder onayı) + PlannerModel (CLOUD-T0015 yönlendirici ya da LOCAL_STUB) + CLOUD-T0002 CloudWorker. Anahtarlar YALNIZ ortam değişkeni adlarıyla dolaylı okunur (değer repoda yok); eksik/kısa anahtarda host kurulmaz (fail-closed). GLOBAL_STOP dosyası kuyruğu durdurur. İçerideki imzalayıcı yalnız SUPERVISOR_TEST_ONLY'dir: bir Founder onayı DEĞİLDİR. Bu bir bulut E2E değildir.
import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {CloudJobQueue, signWorkerAuth, type WorkerAuth} from "./jobs.js";
import {CloudArtifactStore, FileSystemArtifactBackend} from "../../../../core/cloud/artifacts.js";
import {signScope, verifyScopeSignature, type SignedScope, type UnsignedScope} from "../../../../core/cloud/contracts.js";
import {
  InMemoryConfirmationReplayStore, TaskOrchestrator, dispatchIntakeCommand, signFounderConfirmation,
  type ConfirmationAuditRecord, type IntakeDispatchResult, type PlannerModel, type TaskDag, type UnsignedFounderConfirmation,
} from "../../../../core/cloud/task-orchestrator.js";
import {CloudWorker, resolveDeliverable, type CloudJobHandlers, type WorkerQueuePort, type WorkerStep} from "../../../../core/sandbox/cloud-sandbox-provider.js";
import type {ArtifactRef} from "../../../../core/cloud/contracts.js";
import type {SandboxProvider} from "../../../../core/workos/execution-gate.js";

/** Ortam değişkeni ADLARI (değerler asla repoda/günlükte değildir). */
export const CHAIN_HOST_ENV = Object.freeze({
  scopeKeyId: "UASCO_CLOUD_SCOPE_KEY_ID", scopeKey: "UASCO_CLOUD_SCOPE_KEY", workerKey: "UASCO_CLOUD_WORKER_KEY",
  artifactKey: "UASCO_CLOUD_ARTIFACT_KEY", deliveryKey: "UASCO_CLOUD_DELIVERY_KEY",
});
export interface ChainHostKeys {scopeKeyId: string; scopeKey: string; workerKey: string; artifactKey: Buffer; deliveryKey: string}
const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Anahtarları ortamdan okur; eksik ya da 32 bayttan kısa her ad listelenir (değer asla döndürülmez/yazılmaz). */
export function cloudKeysFromEnv(env: Readonly<Record<string, string | undefined>>): {ok: true; keys: ChainHostKeys} | {ok: false; missing: string[]} {
  const missing: string[] = [];
  const get = (name: string, min = 32) => { const v = env[name]; if (typeof v !== "string" || v.length < min) { missing.push(name); return ""; } return v; };
  const scopeKeyId = env[CHAIN_HOST_ENV.scopeKeyId];
  if (typeof scopeKeyId !== "string" || !KEY_ID_RE.test(scopeKeyId)) missing.push(CHAIN_HOST_ENV.scopeKeyId);
  const scopeKey = get(CHAIN_HOST_ENV.scopeKey), workerKey = get(CHAIN_HOST_ENV.workerKey), artifact = get(CHAIN_HOST_ENV.artifactKey), deliveryKey = get(CHAIN_HOST_ENV.deliveryKey);
  if (missing.length > 0) return {ok: false, missing};
  return {ok: true, keys: {scopeKeyId: scopeKeyId as string, scopeKey, workerKey, artifactKey: Buffer.from(artifact, "utf8").subarray(0, 32), deliveryKey}};
}

export interface ChainHostOptions {
  dataDir: string;
  keys: ChainHostKeys;
  /** server.ts'deki ExecutionGate ile AYNI örnek verilmelidir; doğrulanmış sandbox yoksa worker iş almaz. */
  sandbox: SandboxProvider | null;
  planner: PlannerModel;
  /** Orkestratörün planlayıcıdan istediği yetenek/model adı. */
  plannerModel: string;
  handlers: CloudJobHandlers;
  globalStopFile?: string;
  workerId?: string;
  now?: () => Date;
  audit?: (r: ConfirmationAuditRecord) => void;
}
export interface CloudChainHost {
  readonly queue: CloudJobQueue;
  readonly store: CloudArtifactStore;
  dispatch(text: unknown, confirmation: unknown, scope: SignedScope, approvals?: ReadonlySet<string>): Promise<IntakeDispatchResult>;
  /**
   * #344 B-1 teslim değişmezi: teslim AD ile değil İŞ ile yapılır. Artifact yalnız kuyruğun kabul ettiği (SUCCEEDED) iş sonucunun son denemesinde
   * referans verdiği kapsamlı ad ise (resolveDeliverable) imzalı URL üretilir; içerik özeti kabul edilen sonuç, depolanan manifest ve URL özetiyle eşleşmelidir.
   * İptal/STOP/lease kaybıyla depoda kalan yetim çıktılar buradan asla teslim edilmez.
   */
  deliver(tenantId: string, projectId: string, jobId: string, rel: string, subject?: string): Promise<DeliveryCheck>;
  /** Kuyruğun kabul ettiği iş sonucunun artifact referansları (SUCCEEDED değilse boş). */
  resultArtifacts(jobId: string): ArtifactRef[];
  /** GLOBAL_STOP denetimi + bir worker adımı. */
  runWorkerOnce(): Promise<WorkerStep>;
  startWorker(intervalMs: number): void;
  stop(): Promise<void>;
}

export interface DeliveryCheck {issued: boolean; redeemed: boolean; sha256: string | null; verified: boolean; reason?: string}

export function createCloudChainHost(o: ChainHostOptions): CloudChainHost {
  const now = o.now ?? (() => new Date());
  const workerId = o.workerId ?? "local-worker-1";
  const root = path.resolve(o.dataDir);
  fs.mkdirSync(path.join(root, "queue"), {recursive: true});
  fs.mkdirSync(path.join(root, "artifacts"), {recursive: true});
  const scopeKeys = new Map([[o.keys.scopeKeyId, o.keys.scopeKey]]);
  const queue = new CloudJobQueue({dir: path.join(root, "queue"), scopeKeys, workerKeys: new Map([[workerId, o.keys.workerKey]]), now});
  const store = new CloudArtifactStore({backend: new FileSystemArtifactBackend(path.join(root, "artifacts")), masterKey: o.keys.artifactKey,
    deliveryKeys: new Map([["d-1", o.keys.deliveryKey]]), activeDeliveryKeyId: "d-1", deliveryBaseUrl: "https://loopback.invalid/deliver"});
  const replay = new InMemoryConfirmationReplayStore();
  const planCache = new Map<string, TaskDag>();
  const orchestrators = new Map<string, TaskOrchestrator>();
  const auth = (action: WorkerAuth["action"], jobId: string, body: unknown = {}) => signWorkerAuth({workerId, action, jobId, at: now().toISOString(), nonce: randomUUID()}, o.keys.workerKey, body);
  const port: WorkerQueuePort = {
    claim: () => queue.claim(auth("claim", "*")),
    heartbeat: (jobId, leaseId) => queue.heartbeat(auth("heartbeat", jobId, {leaseId}), jobId, leaseId),
    complete: (jobId, leaseId, result) => queue.complete(auth("complete", jobId, {leaseId, result}), jobId, leaseId, result),
  };
  const worker = new CloudWorker({queue: port, sandbox: o.sandbox, store, workRoot: path.join(root, "work"), handlers: o.handlers, workerId});
  let timer: NodeJS.Timeout | null = null, busy = false, stopped = false;
  const stopRequested = () => {
    if (!o.globalStopFile) return false;
    try { return JSON.parse(fs.readFileSync(o.globalStopFile, "utf8"))?.active === true; } catch { return false; }
  };
  const host: CloudChainHost = {
    queue, store,
    async dispatch(text, confirmation, scope, approvals = new Set()) {
      if (stopRequested()) queue.stopAll();
      // #350 dersi (v4): çağıranın kapsamı her dispatch'te imzasıyla doğrulanır (fail-closed) ve orkestratör tenant/proje/ortam üçlüsüyle DEĞİL, tam imzalı
      // kapsamla (imza = kapsamın tüm alanları + keyId üzerinden MAC) anahtarlanır: aynı üçlüye ait sahte/genişletilmiş ya da başka bir imzalı kapsam,
      // ilk önbelleğe alınan kapsamın orkestratörüne (ve onun imzasıyla kuyruğa) asla sızmaz.
      let sk: string | Buffer | undefined, valid = false;
      try { sk = scopeKeys.get(scope.keyId); valid = sk !== undefined && verifyScopeSignature(scope, sk); } catch { valid = false; }
      if (!valid) return {ok: false, stage: "INTAKE", reason: "SCOPE_SIGNATURE_INVALID"};
      const k = scope.signature;
      let orch = orchestrators.get(k);
      if (!orch) { orch = new TaskOrchestrator({queue, scope, now}); orchestrators.set(k, orch); }
      return dispatchIntakeCommand(text, confirmation, {keys: scopeKeys, scope, now, replay, ...(o.audit ? {audit: o.audit} : {})}, o.planner,
        {model: o.plannerModel, maxOutputTokens: 2000, maxCostUsd: 0.1}, orch, approvals, planCache);
    },
    resultArtifacts(jobId) {
      const v = queue.get(jobId);
      if (!v || v.status !== "SUCCEEDED") return [];
      return v.events.filter(e => e.type === "ARTIFACT" && e.attempt === v.attempt && e.artifact).map(e => ({...e.artifact!}));
    },
    async deliver(tenantId, projectId, jobId, rel, subject = "chain-host") {
      const none = {issued: false, redeemed: false, sha256: null, verified: false};
      const view = queue.get(jobId);
      const name = host.resultArtifacts(jobId).find(a => a.name.endsWith(`/${rel}`))?.name;
      if (!view || !name) return {...none, reason: view && view.status !== "SUCCEEDED" ? "JOB_NOT_SUCCEEDED" : "NOT_A_RESULT_ARTIFACT"};
      const d = resolveDeliverable(view, tenantId, projectId, name);
      if (!d.ok) return {...none, reason: d.reason};
      const url = await store.issueDeliveryUrl({tenantId, subject}, {tenantId, projectId, name: d.ref.name});
      if (!url.ok) return {...none, reason: url.reason};
      const red = await store.redeemDeliveryUrl(url.url);
      if (!red.ok) return {issued: true, redeemed: false, sha256: null, verified: false, reason: red.reason};
      const sha = createHash("sha256").update(red.content).digest("hex");
      const verified = sha === d.ref.sha256 && sha === red.manifest.sha256 && sha === url.sha256;
      return {issued: true, redeemed: true, sha256: sha, verified, ...(verified ? {} : {reason: "HASH_MISMATCH"})};
    },
    async runWorkerOnce() {
      if (stopRequested()) queue.stopAll();
      return worker.runOnce();
    },
    startWorker(intervalMs) {
      if (timer || stopped) return;
      timer = setInterval(() => { if (busy) return; busy = true; host.runWorkerOnce().catch(() => undefined).finally(() => { busy = false; }); }, Math.max(100, intervalMs));
    },
    async stop() {
      stopped = true;
      if (timer) { clearInterval(timer); timer = null; }
      for (let i = 0; busy && i < 600; i++) await new Promise(r => setTimeout(r, 50));
      queue.close();
    },
  };
  return host;
}

/**
 * SUPERVISOR_TEST_ONLY: süreç içi kapsam/onay imzalayıcısı. Aynı süreç hem imzalar hem doğrular; bu yalnız jetonun BU süreçten geldiğini kanıtlar,
 * bir insan Founder onayı DEĞİLDİR. Yalnız yerel betik (--supervisor-test) ve testler kullanır; hiçbir HTTP/Desktop yolu buna bağlanmaz.
 */
export const SUPERVISOR_TEST_SIGNER_LABEL = "SUPERVISOR_TEST_ONLY (not a Founder confirmation)" as const;
export function supervisorTestSigner(keys: ChainHostKeys, now: () => Date = () => new Date()) {
  return {
    label: SUPERVISOR_TEST_SIGNER_LABEL,
    scope(s: Omit<UnsignedScope, "keyId" | "issuedAt" | "expiresAt">): SignedScope {
      const t = now().getTime();
      return signScope({...s, keyId: keys.scopeKeyId, issuedAt: new Date(t - 60_000).toISOString(), expiresAt: new Date(t + 60 * 60_000).toISOString()}, keys.scopeKey);
    },
    confirmation(c: Pick<UnsignedFounderConfirmation, "objectiveSha256" | "tenantId" | "projectId" | "environment"> & {confirmedBy?: string}) {
      const t = now().getTime();
      return signFounderConfirmation({type: "FOUNDER_INTAKE_CONFIRMATION", confirmationId: `conf-${randomUUID()}`, confirmedBy: c.confirmedBy ?? "supervisor-test",
        objectiveSha256: c.objectiveSha256, tenantId: c.tenantId, projectId: c.projectId, environment: c.environment,
        issuedAt: new Date(t - 1_000).toISOString(), expiresAt: new Date(t + 5 * 60_000).toISOString(), keyId: keys.scopeKeyId}, keys.scopeKey);
    },
  };
}
