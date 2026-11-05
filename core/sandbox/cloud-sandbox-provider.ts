// //TR: Bu dosya CLOUD-T0002 bulut worker'ını uygular: CLOUD-T0003 kuyruğundan lease+heartbeat ile iş alır, her işi YALNIZ mevcut SandboxProvider soyutlamasıyla (core/workos/execution-gate.ts; yeni sandbox mekanizması yok) çalıştırır, çıktıları CLOUD-T0008 artifact deposuna işin tenant'ı adına yazar ve işi bitirir/başarısız eder. Doğrulanmış sandbox yoksa iş ALINMAZ (fail-closed); iş türü izin listesi, ağ reddi, imzalı kapsam-tenant eşleşmesi, iş başına tenant/deneme çalışma alanı, çalışma alanı sınırı (symlink/kaçış reddi), minimum ortam (gizli yok); lease kaybı/STOP/iptal sandbox'ı durdurur ve hiçbir çıktı kaydedilmez; yeniden deneme kuyruğun maxAttempts kuralına bırakılır.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {ExecutionGate, type SandboxProvider} from "../workos/execution-gate.js";
import {DEFAULT_MAX_ARTIFACT_BYTES, HARD_MAX_ARTIFACT_BYTES, isSafeArtifactName, type CloudArtifactStore} from "../cloud/artifacts.js";
import {MAX_INPUT_ARTIFACTS} from "../cloud/contracts.js";
import type {ArtifactRef, CloudJobKind, CloudJobRequest} from "../cloud/contracts.js";

/** Worker'ın kuyruk yüzü. İmzalı worker kanıtını (anahtar) çağıranın bağdaştırıcısı üretir; worker gizli anahtar tutmaz. CLOUD-T0003 CloudJobQueue + signWorkerAuth ile sağlanır. */
export interface WorkerQueuePort {
  claim(): {ok: true; job: CloudJobRequest; lease: {leaseId: string}; attempt: number} | {ok: false; reason: string};
  heartbeat(jobId: string, leaseId: string): {ok: true} | {ok: false; reason: string};
  complete(jobId: string, leaseId: string, result: CloudJobResult): {ok: true; status: string} | {ok: false; reason: string};
}
export interface CloudJobResult {status: "SUCCEEDED" | "FAILED"; artifacts?: ArtifactRef[]; message?: string}
/** İzinli iş türü başına yürütme planı: sabit argv (model/iş içeriği seçemez) ve çalışma alanına göreli çıktı yolları. */
export interface CloudJobPlan {argv: string[]; outputs: string[]}
export type CloudJobHandlers = Partial<Record<CloudJobKind, (job: CloudJobRequest, inputs: readonly string[]) => CloudJobPlan>>;

/** Worker'ın depo yüzü (yalnız get/put): testler sarmalayıcı enjekte edebilir; CloudArtifactStore yapısal olarak sağlar. */
export type WorkerArtifactStore = Pick<CloudArtifactStore, "get" | "put">;
/** #344 B-1: çıktılar iş+deneme kapsamlı adlarla saklanır; iptal edilmiş bir deneme başka bir denemenin/işin adını asla işgal etmez. */
export const scopedArtifactName = (jobId: string, attempt: number, rel: string) => `jobs/${jobId}/a${attempt}/${rel}`;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
// //TR: #344 N-3: sınırlar CLOUD-T0008/T0001 değerlerine bağlıdır (değiştirilmez): çıktı sayısı <= MAX_INPUT_ARTIFACTS (sonuç referansları bir sonraki işin girdisi olabilir),
// tek çıktı <= depo tavanı (HARD_MAX_ARTIFACT_BYTES), toplam bellekte okunan <= DEFAULT_MAX_ARTIFACT_BYTES (varsayılan).
export const MAX_OUTPUTS = MAX_INPUT_ARTIFACTS;
export const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = DEFAULT_MAX_ARTIFACT_BYTES;

/** Kuyruğun bir iş için tuttuğu görünüm (CloudJobQueue.get yapısal olarak sağlar). */
export interface AcceptedJobView {
  status: string; attempt: number;
  job: {jobId: string; tenantId: string; projectId: string};
  events: readonly {type: string; attempt: number; artifact?: ArtifactRef}[];
}
export type DeliverableDecision = {ok: true; ref: ArtifactRef} | {ok: false; reason: "JOB_UNKNOWN" | "JOB_NOT_SUCCEEDED" | "TENANT_MISMATCH" | "NOT_A_RESULT_ARTIFACT"};
/**
 * Teslim değişmezi: bir artifact YALNIZ kuyruğun kabul ettiği (SUCCEEDED) iş sonucunun son denemesinde referans verdiği ad+sha ise teslim edilebilir.
 * İptal/STOP/lease kaybı/başarısızlık nedeniyle depoda kalan ara (yetim) çıktılar hiçbir zaman buradan geçmez. Teslim eden katman (ör. chain host) ad ile
 * değil bu kararla teslim etmek ZORUNDADIR.
 */
export function resolveDeliverable(view: AcceptedJobView | undefined, tenantId: string, projectId: string, name: string): DeliverableDecision {
  if (!view) return {ok: false, reason: "JOB_UNKNOWN"};
  if (view.job.tenantId !== tenantId || view.job.projectId !== projectId) return {ok: false, reason: "TENANT_MISMATCH"};
  if (view.status !== "SUCCEEDED") return {ok: false, reason: "JOB_NOT_SUCCEEDED"};
  const ref = view.events.find(e => e.type === "ARTIFACT" && e.attempt === view.attempt && e.artifact?.name === name)?.artifact;
  return ref ? {ok: true, ref: {name: ref.name, sha256: ref.sha256, sizeBytes: ref.sizeBytes}} : {ok: false, reason: "NOT_A_RESULT_ARTIFACT"};
}
/** `jobs/<jobId>/a<n>/...` adından üretici işin kimliği (değilse null). */
export const producerJobOf = (name: string): string | null => { const m = /^jobs\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/a\d+\//.exec(name); return m ? m[1] : null; };

type OutputRead = {ok: true; content: Buffer} | {ok: false; reason: string};
/** Çıktıyı güvenli okur: kaçış/symlink/hardlink/takas/boyut reddi; okuma AÇILAN aynı fd'den yapılır (lstat->readFile TOCTOU yok). */
function readOutputSafely(wsReal: string, rel: string, maxBytes: number): OutputRead {
  const p = path.join(wsReal, rel);
  if (!within(wsReal, p)) return {ok: false, reason: "OUTPUT_INVALID"};
  let lst: fs.Stats;
  try { lst = fs.lstatSync(p); } catch { return {ok: false, reason: "OUTPUT_MISSING"}; }
  if (lst.isSymbolicLink() || !lst.isFile()) return {ok: false, reason: "OUTPUT_INVALID"};
  try { if (!within(wsReal, fs.realpathSync(p))) return {ok: false, reason: "OUTPUT_INVALID"}; } catch { return {ok: false, reason: "OUTPUT_INVALID"}; }   // ara dizin symlink kaçışı
  let fd: number;
  // N-2: O_NOFOLLOW reddi (ELOOP) bir symlink'tir = OUTPUT_INVALID; diğer açılış hataları (EACCES/EIO/EMFILE...) G/Ç hatasıdır = WORKER_IO_ERROR.
  try { fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); } catch (e) { return {ok: false, reason: (e as NodeJS.ErrnoException)?.code === "ELOOP" ? "OUTPUT_INVALID" : "WORKER_IO_ERROR"}; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.dev !== lst.dev || st.ino !== lst.ino) return {ok: false, reason: "OUTPUT_INVALID"};   // lstat ile open arasında takas
    if (st.nlink !== 1) return {ok: false, reason: "OUTPUT_HARDLINKED"};   // N-1: çalışma alanı dışındaki bir dosyaya sabit bağ
    if (st.size > maxBytes) return {ok: false, reason: "OUTPUT_TOO_LARGE"};
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = fs.readSync(fd, buf, off, st.size - off, off); if (n <= 0) break; off += n; }
    if (off !== st.size || fs.readSync(fd, Buffer.alloc(1), 0, 1, st.size) !== 0) return {ok: false, reason: "OUTPUT_CHANGED"};
    return {ok: true, content: buf};
  } catch { return {ok: false, reason: "WORKER_IO_ERROR"}; }   // fstat/read hatası (EISDIR/EIO...) = G/Ç hatası
  finally { try { fs.closeSync(fd); } catch { /* yut */ } }
}

export interface CloudWorkerOptions {
  queue: WorkerQueuePort;
  /** Doğrulanmış (öz-testi geçen) sağlayıcı; null/geçersiz/öz-test başarısız => worker hiç iş almaz. */
  sandbox: SandboxProvider | null;
  store: WorkerArtifactStore;
  /** Tek çıktının üst sınırı (varsayılan 64 MiB; depo tavanı HARD_MAX_ARTIFACT_BYTES ile sınırlanır). */
  maxOutputBytes?: number;
  /** Bir denemenin tüm çıktılarının toplam üst sınırı (varsayılan DEFAULT_MAX_ARTIFACT_BYTES). */
  maxTotalOutputBytes?: number;
  /** `jobs/` ad alanındaki girdiler için köken kapısı: üretici iş kuyrukta SUCCEEDED ve ad onun sonucunda olmalı. Yoksa böyle girdiler reddedilir. */
  inputGate?: (tenantId: string, projectId: string, name: string) => DeliverableDecision;
  /** İş çalışma alanlarının kökü (her iş: <kök>/<tenant>/<jobId>-<deneme>, iş sonunda silinir). */
  workRoot: string;
  handlers: CloudJobHandlers;
  workerId: string;
  heartbeatMs?: number;
  /** Sandbox'a verilecek PATH (yalnız bu; host ortamı ve gizler aktarılmaz). */
  sandboxPath?: string;
}
export type WorkerStep =
  | {state: "UNAVAILABLE"; reason: "SANDBOX_UNAVAILABLE"; detail: string | null}
  | {state: "IDLE"}
  | {state: "STOPPED"; reason: string}
  | {state: "DONE"; jobId: string; status: string; result: CloudJobResult}
  | {state: "ABANDONED"; jobId: string; reason: string};

const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUT_RE = /^(?!.*\.\.)(?![/\\])[A-Za-z0-9._/-]{1,255}$/;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const within = (root: string, p: string) => { const rel = path.relative(root, p); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };

export class CloudWorker {
  private readonly gate: ExecutionGate;
  private readonly hbMs: number;
  constructor(private readonly o: CloudWorkerOptions) {
    if (!SAFE_SEG.test(o.workerId)) throw new Error("workerId invalid");
    // N-3: sınırlar depo tavanını aşamaz (yapılandırma hatası kurulumda reddedilir)
    for (const [k, v] of [["maxOutputBytes", o.maxOutputBytes], ["maxTotalOutputBytes", o.maxTotalOutputBytes]] as const) {
      if (v !== undefined && (!Number.isSafeInteger(v) || v < 1 || v > HARD_MAX_ARTIFACT_BYTES)) throw new Error(`${k} invalid`);
    }
    this.gate = new ExecutionGate(o.sandbox);
    this.hbMs = o.heartbeatMs ?? 1_000;
  }

  /** Bir iş alır ve sonuna kadar yürütür. Sandbox doğrulanmamışsa kuyruğa dokunmaz. */
  async runOnce(): Promise<WorkerStep> {
    const st = await this.gate.status();
    if (st.state !== "AVAILABLE" || !this.o.sandbox) return {state: "UNAVAILABLE", reason: "SANDBOX_UNAVAILABLE", detail: st.detail};
    const c = this.o.queue.claim();
    if (!c.ok) return c.reason === "NO_JOB" ? {state: "IDLE"} : {state: "STOPPED", reason: c.reason};
    const {job} = c, leaseId = c.lease.leaseId;
    const finish = (result: CloudJobResult): WorkerStep => {
      const r = this.o.queue.complete(job.jobId, leaseId, result);
      return r.ok ? {state: "DONE", jobId: job.jobId, status: r.status, result} : {state: "ABANDONED", jobId: job.jobId, reason: r.reason};
    };
    const fail = (message: string) => finish({status: "FAILED", message});
    // Yürütme öncesi reddler (hiçbir şey çalışmaz)
    if (!SAFE_SEG.test(job.tenantId) || !SAFE_SEG.test(job.jobId) || job.scope?.tenantId !== job.tenantId || job.scope?.projectId !== job.projectId) return fail("SCOPE_MISMATCH");
    if (job.needsNetwork) return fail("NETWORK_DENIED");
    const handler = this.o.handlers[job.kind];
    if (!handler) return fail("JOB_KIND_NOT_ALLOWED");

    const ws = path.join(path.resolve(this.o.workRoot), job.tenantId, `${job.jobId}-${c.attempt}`);
    let lost: string | null = null;
    const beat = () => { if (lost) return; const h = this.o.queue.heartbeat(job.jobId, leaseId); if (!h.ok) lost = h.reason; };
    const timer = setInterval(beat, this.hbMs);
    try {
      fs.rmSync(ws, {recursive: true, force: true});
      fs.mkdirSync(path.join(ws, "inputs"), {recursive: true});
      const wsReal = fs.realpathSync(ws);
      // Girdiler yalnız işin kendi tenant'ı adına alınır (depo başka tenant'a erişimi reddeder) ve özetleri işteki referansla eşleşmek zorundadır.
      const inputs: string[] = [];
      for (const a of job.inputArtifacts) {
        // #344 B-1: iptal edilmiş/başarısız bir denemenin depoda kalan ara çıktısı başka bir işe girdi olarak sızamaz.
        if (producerJobOf(a.name) !== null) {
          const gate = this.o.inputGate?.(job.tenantId, job.projectId, a.name);
          if (!gate || !gate.ok || gate.ref.sha256 !== a.sha256 || gate.ref.sizeBytes !== a.sizeBytes) return fail("INPUT_PROVENANCE_UNVERIFIED");
        }
        const g = await this.o.store.get({tenantId: job.tenantId, subject: this.o.workerId}, {tenantId: job.tenantId, projectId: job.projectId, name: a.name});
        if (!g.ok) return fail(`INPUT_${g.reason}`);
        if (sha(g.content) !== a.sha256 || g.content.length !== a.sizeBytes) return fail("INPUT_HASH_MISMATCH");
        const dest = path.join(wsReal, "inputs", a.name);
        if (!within(wsReal, dest)) return fail("INPUT_PATH_INVALID");
        fs.mkdirSync(path.dirname(dest), {recursive: true});
        fs.writeFileSync(dest, g.content);
        inputs.push(path.relative(wsReal, dest));
      }
      let plan: CloudJobPlan;
      try { plan = handler(job, inputs); } catch { return fail("PLAN_FAILED"); }
      if (!Array.isArray(plan?.argv) || plan.argv.length === 0 || !plan.argv.every(x => typeof x === "string") || !Array.isArray(plan.outputs) || !plan.outputs.every(x => typeof x === "string" && OUT_RE.test(x))) return fail("PLAN_INVALID");
      beat();
      if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
      const res = await this.o.sandbox.run(plan.argv, {cwd: wsReal, env: {PATH: this.o.sandboxPath ?? "/usr/bin:/bin"}, timeoutMs: job.timeoutMs, shouldAbort: () => lost !== null});
      beat();
      // Lease kaybı / STOP / iptal: sonuç ve çıktı asla kaydedilmez.
      if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
      if (res.aborted) return {state: "ABANDONED", jobId: job.jobId, reason: "ABORTED"};
      if (res.spawnError || res.timedOut || res.exitCode !== 0) return fail(res.timedOut ? "SANDBOX_TIMEOUT" : res.spawnError ? "SANDBOX_SPAWN_ERROR" : `EXIT_${res.exitCode}`);
      // #344 B-1 (a): TÜM çıktılar herhangi bir put'tan ÖNCE doğrulanır ve okunur; tek bir ret depoya hiçbir şey yazdırmaz.
      const staged: {name: string; content: Buffer; ref: ArtifactRef}[] = [];
      const seen = new Set<string>();
      if (plan.outputs.length > MAX_OUTPUTS) return fail("OUTPUT_COUNT_EXCEEDED");
      const perMax = Math.min(this.o.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, HARD_MAX_ARTIFACT_BYTES), totalMax = this.o.maxTotalOutputBytes ?? DEFAULT_MAX_TOTAL_OUTPUT_BYTES;
      let total = 0;
      for (const rel of plan.outputs) {
        if (seen.has(rel)) return fail("OUTPUT_DUPLICATE");
        seen.add(rel);
        const name = scopedArtifactName(job.jobId, c.attempt, rel);   // (b) iş+deneme kapsamlı ad
        if (!isSafeArtifactName(name)) return fail("OUTPUT_NAME_INVALID");
        const budget = Math.min(perMax, totalMax - total);
        const r = readOutputSafely(wsReal, rel, budget);
        if (!r.ok) return fail(r.reason === "OUTPUT_TOO_LARGE" && budget < perMax ? "OUTPUT_TOTAL_TOO_LARGE" : r.reason);
        total += r.content.length;
        staged.push({name, content: r.content, ref: {name, sha256: sha(r.content), sizeBytes: r.content.length}});
      }
      // (c) put aşamasından hemen önce lease denetimi
      beat();
      if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
      const artifacts: ArtifactRef[] = [];
      for (const s2 of staged) {
        const put = await this.o.store.put({tenantId: job.tenantId, subject: this.o.workerId}, {tenantId: job.tenantId, projectId: job.projectId, ...s2.ref, content: s2.content, jobId: job.jobId, producer: this.o.workerId});
        if (!put.ok) return fail(`OUTPUT_${put.reason}`);
        artifacts.push(s2.ref);
        beat();
        if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
      }
      // (c) son put'tan sonra, complete()'ten hemen önce lease denetimi
      beat();
      if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
      return finish({status: "SUCCEEDED", artifacts});
    } catch {
      // //TR: #344 N-2: dosya sistemi/sandbox/depo aşamasındaki beklenmeyen hata (EISDIR/EACCES/ENOTDIR, realpath, girdi yazımı) runOnce'tan kaçmaz:
      // lease kaybolduysa ABANDONED (sonuç yazılmaz), değilse iş WORKER_IO_ERROR ile başarısız olur (yeniden deneme kuyruğun maxAttempts kuralıyla).
      beat();
      if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
      return fail("WORKER_IO_ERROR");
    } finally {
      clearInterval(timer);
      try { fs.rmSync(ws, {recursive: true, force: true}); } catch { /* en iyi çaba */ }
    }
  }

  /** IDLE/STOPPED/UNAVAILABLE görülene dek (ya da `max` iş) çalışır. */
  async runUntilIdle(max = 100): Promise<WorkerStep[]> {
    const out: WorkerStep[] = [];
    for (let i = 0; i < max; i++) {
      const s = await this.runOnce();
      out.push(s);
      if (s.state === "IDLE" || s.state === "STOPPED" || s.state === "UNAVAILABLE") break;
    }
    return out;
  }
}
