// //TR: Bu dosya CLOUD-T0002 bulut worker'ını uygular: CLOUD-T0003 kuyruğundan lease+heartbeat ile iş alır, her işi YALNIZ mevcut SandboxProvider soyutlamasıyla (core/workos/execution-gate.ts; yeni sandbox mekanizması yok) çalıştırır, çıktıları CLOUD-T0008 artifact deposuna işin tenant'ı adına yazar ve işi bitirir/başarısız eder. Doğrulanmış sandbox yoksa iş ALINMAZ (fail-closed); iş türü izin listesi, ağ reddi, imzalı kapsam-tenant eşleşmesi, iş başına tenant/deneme çalışma alanı, çalışma alanı sınırı (symlink/kaçış reddi), minimum ortam (gizli yok); lease kaybı/STOP/iptal sandbox'ı durdurur ve hiçbir çıktı kaydedilmez; yeniden deneme kuyruğun maxAttempts kuralına bırakılır.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {ExecutionGate, type SandboxProvider} from "../workos/execution-gate.js";
import type {CloudArtifactStore} from "../cloud/artifacts.js";
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

export interface CloudWorkerOptions {
  queue: WorkerQueuePort;
  /** Doğrulanmış (öz-testi geçen) sağlayıcı; null/geçersiz/öz-test başarısız => worker hiç iş almaz. */
  sandbox: SandboxProvider | null;
  store: CloudArtifactStore;
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
      const artifacts: ArtifactRef[] = [];
      for (const rel of plan.outputs) {
        const p = path.join(wsReal, rel);
        let st2: fs.Stats;
        try { st2 = fs.lstatSync(p); } catch { return fail("OUTPUT_MISSING"); }
        if (!st2.isFile() || st2.isSymbolicLink() || !within(wsReal, p) || !within(wsReal, fs.realpathSync(p))) return fail("OUTPUT_INVALID");
        const content = fs.readFileSync(p), ref = {name: rel, sha256: sha(content), sizeBytes: content.length};
        beat();
        if (lost) return {state: "ABANDONED", jobId: job.jobId, reason: lost};
        const put = await this.o.store.put({tenantId: job.tenantId, subject: this.o.workerId}, {tenantId: job.tenantId, projectId: job.projectId, ...ref, content, jobId: job.jobId, producer: this.o.workerId});
        if (!put.ok) return fail(`OUTPUT_${put.reason}`);
        artifacts.push(ref);
      }
      return finish({status: "SUCCEEDED", artifacts});
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
