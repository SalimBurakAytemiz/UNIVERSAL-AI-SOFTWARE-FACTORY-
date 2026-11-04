// //TR: Bu dosya (güven sınırı: kuyruk dizini sunucunun kendi diskidir ve tek PID ad alanındaki tek süreç tarafından kullanılır; journal'a MAC uygulanmaz ve maskeli scope imzaları replay'de yeniden doğrulanmaz) CLOUD-T0003 bulut iş kuyruğunu uygular: imzalı istek kabulü (CLOUD-T0001 sözleşmesi), kimliği doğrulanmış worker lease'i, heartbeat, iptal, global STOP, dayanıklı (append-only journal) yeniden deneme ve aynı işin iki kez yürütülmemesi; her karar audit kaydına yazılır.
import fs from "node:fs";
import path from "node:path";
import {createHash, createHmac, randomUUID, timingSafeEqual} from "node:crypto";
import {
  auditRecordFor, canonicalJson, validateCloudJobRequest, verifyEventStream, TERMINAL_EVENT_TYPES,
  type ArtifactRef, type CloudJobEvent, type CloudJobEventType, type CloudJobRequest,
} from "../../../../core/cloud/contracts.js";
import {acquireQueueLock, type QueueLock} from "./queue-lock.js";
import {redactSecrets} from "../../../../core/workos/secret-scan.js";

export const WORKER_AUTH_MAX_SKEW_MS = 2 * 60 * 1000;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export type QueueDenyReason =
  | "WORKER_AUTH_INVALID" | "WORKER_AUTH_REPLAYED" | "GLOBAL_STOP_ACTIVE" | "JOB_NOT_FOUND" | "LEASE_MISMATCH" | "LEASE_EXPIRED"
  | "JOB_CANCELLED" | "JOB_TERMINAL" | "JOB_TIMED_OUT" | "RESULT_INVALID";

/** Worker her çağrıda imzalı bir kanıt gönderir: HMAC-SHA256(secret, `${workerId}\n${action}\n${jobId}\n${at}\n${nonce}\n${bodyDigest}`).
 *  bodyDigest = sha256(canonicalJson(body)); body claim için {}, heartbeat için {leaseId}, complete için {leaseId, result}. Böylece yoldaki biri lease'i ya da sonucu değiştiremez. */
export interface WorkerAuth {workerId: string; action: "claim" | "heartbeat" | "complete"; jobId: string; at: string; nonce: string; signature: string}
export interface Lease {leaseId: string; workerId: string; expiresAt: number}
export interface JobResult {status: "SUCCEEDED" | "FAILED"; artifacts?: ArtifactRef[]; message?: string}

export interface JobState {
  job: CloudJobRequest; requestDigest: string; events: CloudJobEvent[]; attempt: number;
  status: "QUEUED" | "RUNNING" | CloudJobEventType; lease: Lease | null; notBefore: number; startedAt: number | null;
}

export interface CloudJobQueueOptions {
  dir: string;                                   // journal + audit dizini (dayanıklılık)
  scopeKeys: ReadonlyMap<string, string | Buffer>;
  workerKeys: ReadonlyMap<string, string | Buffer>;
  now?: () => Date;
  leaseMs?: number;
}

type JournalLine = {kind: "submit"; job: CloudJobRequest; requestDigest: string} | {kind: "event"; event: CloudJobEvent} | {kind: "stop"; at: string} | {kind: "nonce"; key: string; exp: number};

export const workerBodyDigest = (body: unknown): string => createHash("sha256").update(canonicalJson(body ?? {})).digest("hex");

export function signWorkerAuth(a: Omit<WorkerAuth, "signature">, secret: string | Buffer, body: unknown = {}): WorkerAuth {
  return {...a, signature: createHmac("sha256", secret).update(`${a.workerId}\n${a.action}\n${a.jobId}\n${a.at}\n${a.nonce}\n${workerBodyDigest(body)}`).digest("hex")};
}

export {pidAlive} from "./queue-lock.js";

const isTerminal = (t: string) => (TERMINAL_EVENT_TYPES as readonly string[]).includes(t);

/** CLOUD-T0005: masaüstüne giden redaksiyon güvenli iş özeti (izin verilen alanların kapalı listesi). */
export interface JobSummary {
  jobId: string; projectId: string; environment: string; kind: string; status: JobState["status"]; attempt: number; maxAttempts: number;
  requestedAt: string; updatedAt: string | null; lastEventType: CloudJobEventType | null; message: string | null; artifacts: ArtifactRef[];
}
const REASON_EVENTS: readonly string[] = ["RETRYING", "FAILED", "TIMED_OUT"];
export const JOB_MESSAGE_MAX = 200;
/** CLOUD-T0005 sunucu tarafı redaksiyon: worker'ın yeniden deneme/hata metni API'den çıkmadan önce temizlenir (masaüstü temizleyicisine güvenilmez).
 *  Sıra: bilinen secret desenleri (redactSecrets) -> kimlik bilgili URL -> anahtar=değer -> kısa Bearer/Basic -> anahtar biçimli uzun diziler -> mutlak yollar -> kontrol karakterleri; en son 200'e kırpılır.
 *  Tüm nicelikler sınırlıdır (doğrusal süre). */
export function redactJobMessage(text: string): string {
  let s = redactSecrets(String(text).slice(0, 4096));
  s = s
    .replace(/\b([A-Za-z][A-Za-z0-9+.-]{0,16}):\/\/[^\s/?#@]{1,512}@/g, "$1://[REDACTED:URL_CREDENTIALS]@")
    // JSON biçimi: "<..anahtar..>" : "<değer>" (anahtar kelime bir tanımlayıcının parçası olabilir: "db_password", "authToken")
    .replace(/"([A-Za-z0-9_.-]{0,64}?(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|auth|credentials?|session|cookie)[A-Za-z0-9_.-]{0,64})"(\s{0,8}:\s{0,8})"(?:[^"\\\r\n]|\\.){0,4096}"/gi, '"$1"$2"[REDACTED:KEY_VALUE]"')
    // anahtar=değer / anahtar: değer; anahtar kelime ön ek veya son ek alabilir (DB_PASSWORD, GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY)
    .replace(/\b([A-Za-z0-9_-]{0,64}?(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|auth|credentials?|session|cookie)[A-Za-z0-9_-]{0,64})(\s{0,8}[:=]\s{0,8})("?)(?:(?:Bearer|Basic)[ \t]{1,16})?[^\s",;&]{1,4096}/gi, "$1$2$3[REDACTED:KEY_VALUE]")
    .replace(/\b(Bearer|Basic)[ \t]{1,16}(?!\[REDACTED)(?=[^\s,;]{0,4096}[0-9._~+/=-])[^\s,;]{6,4096}/gi, "$1 [REDACTED:AUTH_TOKEN]")
    .replace(/(?<![A-Za-z0-9_\[-])(?=[A-Za-z0-9+/_-]{0,4096}\d)(?=[A-Za-z0-9+/_-]{0,4096}[A-Za-z])[A-Za-z0-9+/_-]{32,4096}={0,2}/g, "[REDACTED:KEY_SHAPED]")
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]{0,4096}/g, "[path]")
    .replace(/(?<![A-Za-z0-9._:/~-])\/(?:[^\s/"'<>]{1,256}\/){1,64}[^\s"'<>]{0,256}/g, "[path]")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  return s.slice(0, JOB_MESSAGE_MAX);
}
function summarize(s: JobState): JobSummary {
  const last = s.events.length ? s.events[s.events.length - 1]! : null;
  const reason = [...s.events].reverse().find(e => REASON_EVENTS.includes(e.type) && typeof e.message === "string");
  return {
    jobId: s.job.jobId, projectId: s.job.projectId, environment: s.job.environment, kind: s.job.kind, status: s.status, attempt: s.attempt,
    maxAttempts: s.job.retry.maxAttempts, requestedAt: s.job.requestedAt, updatedAt: last ? last.at : null, lastEventType: last ? last.type : null,
    message: reason ? redactJobMessage(String(reason.message)) : null,
    artifacts: s.events.filter(e => e.type === "ARTIFACT" && e.artifact).map(e => ({name: e.artifact!.name, sha256: e.artifact!.sha256, sizeBytes: e.artifact!.sizeBytes})),
  };
}

export class CloudJobQueue {
  private readonly jobs = new Map<string, JobState>();
  private readonly idem = new Map<string, string>();      // tenant\0key -> requestDigest
  private readonly idemJob = new Map<string, string>();   // tenant\0key -> jobId
  private readonly nonces = new Map<string, number>();    // worker nonce -> expiry (replay koruması)
  private stopped = false;
  private readonly journal: string;
  private readonly audit: string;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  private readonly lockPath: string;
  private lock: QueueLock | null = null;

  constructor(private readonly opts: CloudJobQueueOptions) {
    this.leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1000) throw new Error("leaseMs invalid");   // kilitten önce (N-2)
    fs.mkdirSync(opts.dir, {recursive: true});
    this.lockPath = path.join(opts.dir, "jobs.lock");
    this.lock = acquireQueueLock(this.lockPath);   // L-3/NB-1: tek yazıcı (queue-lock.ts); aynı dizinde ikinci kuyruk örneği açılmaz
    this.journal = path.join(opts.dir, "jobs.journal.jsonl");
    this.audit = path.join(opts.dir, "jobs.audit.jsonl");
    this.now = opts.now ?? (() => new Date());
    try { this.replay(); } catch (e) { this.close(); throw e; }
  }

  /** Kilidi bırakır. Kapatılan örnek bir daha kullanılmaz. */
  close(): void {
    this.closed = true;
    if (this.lock) { this.lock.release(); this.lock = null; }
  }
  private closed = false;
  private assertOpen(): void { if (this.closed) throw new Error("QUEUE_CLOSED"); }   // N-4

  // ---------- persistence ----------
  /** Birden çok satır tek write + fsync ile yazılır (submit + QUEUED aynı kayıtta: arada çökme boş akış bırakmaz). */
  private append(...lines: JournalLine[]): void {
    const fd = fs.openSync(this.journal, "a");
    try { fs.writeSync(fd, lines.map(l => JSON.stringify(l) + "\n").join("")); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  private auditLog(rec: Record<string, unknown>): void {
    const fd = fs.openSync(this.audit, "a");
    try { fs.writeSync(fd, JSON.stringify({at: this.now().toISOString(), ...rec}) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  /** Journal'dan durumu yeniden kurar. Bozuk satır ya da bütünlüğü bozuk olay akışı: fail-closed (kurucu hata atar). */
  private replay(): void {
    if (!fs.existsSync(this.journal)) return;
    const text = fs.readFileSync(this.journal, "utf8");
    if (text.length > 0 && !text.endsWith("\n")) throw new Error("JOURNAL_CORRUPT: torn trailing line");
    const lines = text.split("\n").filter(Boolean);
    for (const raw of lines) {
      let l: JournalLine;
      try { l = JSON.parse(raw) as JournalLine; } catch { throw new Error("JOURNAL_CORRUPT: unparseable line"); }
      if (l.kind === "submit") this.indexSubmit(l.job, l.requestDigest);
      else if (l.kind === "nonce") { if (typeof l.key === "string" && Number.isFinite(l.exp)) this.nonces.set(l.key, l.exp); }
      else if (l.kind === "stop") this.stopped = true;
      else if (l.kind === "event") {
        const s = this.jobs.get(l.event.jobId);
        if (!s) throw new Error("JOURNAL_CORRUPT: event for unknown job");
        this.applyEvent(s, l.event);
      } else throw new Error("JOURNAL_CORRUPT: unknown line");
    }
    for (const s of this.jobs.values()) {
      const v = verifyEventStream(s.events, s.job);
      if (!v.ok) throw new Error(`JOURNAL_CORRUPT: ${s.job.jobId} ${v.reason}`);
      // Yeniden başlatma: önceki süreçteki lease'ler geçersizdir; çalışan iş yeniden denenir ya da zaman aşımına düşer.
      if (s.status === "RUNNING") s.lease = {...(s.lease as Lease), expiresAt: 0};
    }
  }
  private indexSubmit(job: CloudJobRequest, requestDigest: string): void {
    const k = `${job.tenantId}\u0000${job.idempotencyKey}`;
    this.idem.set(k, requestDigest); this.idemJob.set(k, job.jobId);
    this.jobs.set(job.jobId, {job, requestDigest, events: [], attempt: 1, status: "QUEUED", lease: null, notBefore: 0, startedAt: null});
  }
  private applyEvent(s: JobState, e: CloudJobEvent): void {
    s.events.push(e); s.attempt = e.attempt;
    switch (e.type) {
      case "QUEUED": s.status = "QUEUED"; break;
      case "STARTED": s.status = "RUNNING"; s.startedAt ??= Date.parse(e.at); s.lease = e.message ? JSON.parse(e.message) as Lease : s.lease; break;
      case "HEARTBEAT": if (s.lease && e.message) s.lease.expiresAt = Number(e.message); break;
      case "RETRYING": s.status = "QUEUED"; s.lease = null; s.notBefore = Date.parse(e.at) + s.job.retry.backoffMs; break;
      default: if (isTerminal(e.type)) { s.status = e.type; s.lease = null; }
    }
  }
  private emit(s: JobState, type: CloudJobEventType, extra: Partial<CloudJobEvent> = {}): CloudJobEvent {
    const e: CloudJobEvent = {jobId: s.job.jobId, seq: s.events.length, type, at: this.now().toISOString(), attempt: type === "RETRYING" ? s.attempt + 1 : s.attempt, ...extra};
    const check = verifyEventStream([...s.events, e], s.job);
    if (!check.ok) throw new Error(`EVENT_STREAM_VIOLATION ${check.reason}`);   // programlama hatası: asla sessiz yazılmaz
    this.append({kind: "event", event: e});
    this.applyEvent(s, e);
    return e;
  }

  // ---------- worker authentication ----------
  private authWorker(a: WorkerAuth, action: WorkerAuth["action"], jobId: string, body: unknown = {}): QueueDenyReason | null {
    const deny = (r: QueueDenyReason) => { this.auditLog({decision: "WORKER_DENIED", reason: r, workerId: typeof a?.workerId === "string" ? a.workerId.slice(0, 64) : null, action}); return r; };
    if (!a || typeof a !== "object" || a.action !== action || a.jobId !== jobId || typeof a.nonce !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(a.nonce)) return deny("WORKER_AUTH_INVALID");
    const key = typeof a.workerId === "string" ? this.opts.workerKeys.get(a.workerId) : undefined;
    const at = typeof a.at === "string" ? Date.parse(a.at) : Number.NaN;
    const now = this.now().getTime();
    if (key === undefined || !Number.isFinite(at) || Math.abs(now - at) > WORKER_AUTH_MAX_SKEW_MS || typeof a.signature !== "string" || !/^[0-9a-f]{64}$/.test(a.signature)) return deny("WORKER_AUTH_INVALID");
    let expected: Buffer;
    try { expected = Buffer.from(signWorkerAuth({workerId: a.workerId, action, jobId, at: a.at, nonce: a.nonce}, key, body).signature, "hex"); } catch { return deny("WORKER_AUTH_INVALID"); }
    if (!timingSafeEqual(expected, Buffer.from(a.signature, "hex"))) return deny("WORKER_AUTH_INVALID");
    for (const [n, exp] of this.nonces) if (exp < now) this.nonces.delete(n);
    const nk = createHash("sha256").update(`${a.workerId}\u0000${a.nonce}`).digest("hex");
    if (this.nonces.has(nk)) return deny("WORKER_AUTH_REPLAYED");
    const exp = now + 2 * WORKER_AUTH_MAX_SKEW_MS;
    this.append({kind: "nonce", key: nk, exp});   // kalıcı: yeniden başlatmadan sonra da replay reddedilir
    this.nonces.set(nk, exp);
    return null;
  }

  // ---------- API ----------
  /** İş kabulü: CLOUD-T0001 sözleşmesiyle doğrulanır; aynı idempotency anahtarı + aynı içerik = aynı iş (replay). */
  submit(input: unknown): {ok: true; jobId: string; replay: boolean} | {ok: false; reason: string} {
    this.assertOpen();
    if (this.stopped) { this.auditLog({decision: "DENIED", reason: "GLOBAL_STOP_ACTIVE"}); return {ok: false, reason: "GLOBAL_STOP_ACTIVE"}; }
    const d = validateCloudJobRequest(input, {scopeKeys: this.opts.scopeKeys, now: this.now(), idempotencyIndex: new Map(this.idem)});
    if (d.ok && !d.replay && this.jobs.has(d.job.jobId)) { this.auditLog({decision: "DENIED", reason: "JOB_ID_REUSED", jobId: d.job.jobId}); return {ok: false, reason: "JOB_ID_REUSED"}; }
    this.auditLog({...auditRecordFor(input, d, this.now())});
    if (!d.ok) return {ok: false, reason: d.reason};
    const k = `${d.job.tenantId}\u0000${d.job.idempotencyKey}`;
    if (d.replay) return {ok: true, jobId: this.idemJob.get(k) as string, replay: true};
    const job = {...d.job, scope: {...d.job.scope, signature: "[stored-verified]"}};   // imza journal'a yazılmaz; doğrulama kabulde yapıldı
    const queued: CloudJobEvent = {jobId: job.jobId, seq: 0, type: "QUEUED", at: this.now().toISOString(), attempt: 1};
    this.append({kind: "submit", job, requestDigest: d.requestDigest}, {kind: "event", event: queued});
    this.indexSubmit(job, d.requestDigest);
    this.applyEvent(this.jobs.get(job.jobId) as JobState, queued);
    return {ok: true, jobId: job.jobId, replay: false};
  }

  /** Bir worker en eski hazır işi alır. Bir işin aynı anda tek geçerli lease'i olur (çift yürütme yok). */
  claim(auth: WorkerAuth): {ok: true; job: CloudJobRequest; lease: Lease; attempt: number} | {ok: false; reason: QueueDenyReason | "NO_JOB"} {
    this.assertOpen();
    // claim kanıtında jobId her zaman "*"
    const bad = this.authWorker(auth, "claim", "*"); if (bad) return {ok: false, reason: bad};
    if (this.stopped) { this.auditLog({decision: "WORKER_DENIED", reason: "GLOBAL_STOP_ACTIVE", workerId: auth.workerId, action: "claim"}); return {ok: false, reason: "GLOBAL_STOP_ACTIVE"}; }
    this.reap();
    const now = this.now().getTime();
    const s = [...this.jobs.values()].find(x => x.status === "QUEUED" && x.notBefore <= now);
    if (!s) { this.auditLog({decision: "NO_JOB", workerId: auth.workerId}); return {ok: false, reason: "NO_JOB"}; }
    const lease: Lease = {leaseId: randomUUID(), workerId: auth.workerId, expiresAt: Math.min(now + this.leaseMs, (s.startedAt ?? now) + s.job.timeoutMs)};
    this.emit(s, "STARTED", {message: JSON.stringify(lease)});
    this.auditLog({decision: "CLAIMED", jobId: s.job.jobId, workerId: auth.workerId, attempt: s.attempt});
    return {ok: true, job: s.job, lease: {...lease}, attempt: s.attempt};
  }

  private holder(auth: WorkerAuth, action: WorkerAuth["action"], jobId: string, leaseId: string, body: unknown): {s: JobState} | {reason: QueueDenyReason} {
    const bad = this.authWorker(auth, action, jobId, body); if (bad) return {reason: bad};
    const s = this.jobs.get(jobId); if (!s) return {reason: "JOB_NOT_FOUND"};
    if (s.status === "CANCELLED") return {reason: "JOB_CANCELLED"};
    if (s.status === "STOPPED") return {reason: "GLOBAL_STOP_ACTIVE"};
    if (isTerminal(s.status)) return {reason: "JOB_TERMINAL"};
    if (!s.lease || s.lease.leaseId !== leaseId || s.lease.workerId !== auth.workerId) return {reason: "LEASE_MISMATCH"};
    const now = this.now().getTime();
    if (s.startedAt !== null && now - s.startedAt > s.job.timeoutMs) {   // B-1: toplam süre heartbeat/complete'te de uygulanır
      this.emit(s, "TIMED_OUT"); this.auditLog({decision: "TIMED_OUT", jobId}); return {reason: "JOB_TIMED_OUT"};
    }
    if (s.lease.expiresAt <= now) return {reason: "LEASE_EXPIRED"};
    return {s};
  }

  /** Lease'i uzatır. İş iptal edildiyse JOB_CANCELLED, STOP varsa GLOBAL_STOP_ACTIVE döner: worker durur ve çıktı üretmez. */
  heartbeat(auth: WorkerAuth, jobId: string, leaseId: string): {ok: true} | {ok: false; reason: QueueDenyReason} {
    this.assertOpen();
    const h = this.holder(auth, "heartbeat", jobId, leaseId, {leaseId});
    if ("reason" in h) { this.auditLog({decision: "HEARTBEAT_REJECTED", jobId, reason: h.reason}); return {ok: false, reason: h.reason}; }
    const exp = Math.min(this.now().getTime() + this.leaseMs, (h.s.startedAt as number) + h.s.job.timeoutMs);   // lease toplam süreyi aşamaz
    this.emit(h.s, "HEARTBEAT", {message: String(exp)});
    return {ok: true};
  }

  /** Sonuç yalnız geçerli lease sahibinden kabul edilir; iptal/STOP/süresi geçmiş işin çıktısı asla kaydedilmez. */
  complete(auth: WorkerAuth, jobId: string, leaseId: string, result: JobResult): {ok: true; status: CloudJobEventType} | {ok: false; reason: QueueDenyReason} {
    this.assertOpen();
    const h = this.holder(auth, "complete", jobId, leaseId, {leaseId, result});
    if ("reason" in h) { this.auditLog({decision: "RESULT_REJECTED", jobId, reason: h.reason}); return {ok: false, reason: h.reason}; }
    const s = h.s;
    const invalid = () => { this.auditLog({decision: "RESULT_REJECTED", jobId, reason: "RESULT_INVALID"}); return {ok: false as const, reason: "RESULT_INVALID" as const}; };
    if (!result || (result.status !== "SUCCEEDED" && result.status !== "FAILED") || (result.artifacts !== undefined && !Array.isArray(result.artifacts))
      || (result.message !== undefined && (typeof result.message !== "string" || result.message.length > 2000))) return invalid();   // L-1
    // L-2: worker'ın artifact nesnesindeki fazladan alanlar journal'a yazılmaz.
    const artifacts: ArtifactRef[] = (result.artifacts ?? []).map(a => ({name: (a as ArtifactRef)?.name, sha256: (a as ArtifactRef)?.sha256, sizeBytes: (a as ArtifactRef)?.sizeBytes}));
    if (result.status === "SUCCEEDED") {
      // Artifact'lar tek tek doğrulanır (emit içinde verifyEventStream); biri bozuksa hiçbiri yazılmaz.
      const probe = [...s.events];
      for (const a of artifacts) probe.push({jobId, seq: probe.length, type: "ARTIFACT", at: this.now().toISOString(), attempt: s.attempt, artifact: a});
      if (!verifyEventStream(probe, s.job).ok) return invalid();
      for (const a of artifacts) this.emit(s, "ARTIFACT", {artifact: a});
      this.emit(s, "SUCCEEDED");
    } else this.failOrRetry(s, result.message);
    this.auditLog({decision: "RESULT_ACCEPTED", jobId, status: s.status, attempt: s.attempt});
    return {ok: true, status: s.status as CloudJobEventType};
  }

  private failOrRetry(s: JobState, why?: string): void {
    if (s.attempt < s.job.retry.maxAttempts) this.emit(s, "RETRYING", why ? {message: why.slice(0, 200)} : {});
    else this.emit(s, "FAILED", why ? {message: why.slice(0, 200)} : {});
  }

  /** İptal: iş hemen CANCELLED (terminal). Çalışan worker'ın heartbeat ve sonucu JOB_CANCELLED ile reddedilir; çıktısı asla kaydedilmez. */
  cancel(jobId: string): {ok: true} | {ok: false; reason: QueueDenyReason} {
    this.assertOpen();
    const s = this.jobs.get(jobId);
    if (!s) { this.auditLog({decision: "CANCEL_REJECTED", jobId: String(jobId).slice(0, 128), reason: "JOB_NOT_FOUND"}); return {ok: false, reason: "JOB_NOT_FOUND"}; }
    if (isTerminal(s.status)) { this.auditLog({decision: "CANCEL_REJECTED", jobId, reason: "JOB_TERMINAL"}); return {ok: false, reason: "JOB_TERMINAL"}; }
    this.emit(s, "CANCELLED");
    this.auditLog({decision: "CANCELLED", jobId});
    return {ok: true};
  }

  /** Global STOP: yeni kabul ve claim yok; terminal olmayan bütün işler STOPPED. Kalıcıdır (journal). */
  stopAll(): void {
    this.assertOpen();
    if (!this.stopped) { this.stopped = true; this.append({kind: "stop", at: this.now().toISOString()}); }
    for (const s of this.jobs.values()) if (!isTerminal(s.status)) this.emit(s, "STOPPED");
    this.auditLog({decision: "GLOBAL_STOP"});
  }

  /** Süresi geçen lease'ler: deneme hakkı varsa RETRYING, yoksa TIMED_OUT. İşin toplam süresi timeoutMs'i aşarsa TIMED_OUT. */
  reap(): void {
    this.assertOpen();
    const now = this.now().getTime();
    for (const s of this.jobs.values()) {
      if (isTerminal(s.status)) continue;
      if (s.startedAt !== null && now - s.startedAt > s.job.timeoutMs) { this.emit(s, "TIMED_OUT"); this.auditLog({decision: "TIMED_OUT", jobId: s.job.jobId}); continue; }
      if (s.status === "RUNNING" && s.lease && s.lease.expiresAt <= now) {
        if (s.attempt < s.job.retry.maxAttempts) this.emit(s, "RETRYING", {message: "LEASE_EXPIRED"});
        else this.emit(s, "TIMED_OUT", {message: "LEASE_EXPIRED"});
        this.auditLog({decision: s.status, jobId: s.job.jobId, reason: "LEASE_EXPIRED"});
      }
    }
  }

  get(jobId: string): Readonly<JobState> | undefined { return this.jobs.get(jobId); }

  /** CLOUD-T0005 salt-okunur durum özeti: yalnız çağıranın tenant'ındaki işler, en yeni önce, en çok `limit` (1..100). Lease, worker kimliği, imza/scope,
   *  idempotency anahtarı ve olay mesajları (STARTED/HEARTBEAT lease taşır) ASLA dönmez; yalnız terminal/yeniden deneme olaylarının kısa nedeni (≤200) döner. */
  list(tenantId: string, limit = 100): JobSummary[] {
    if (typeof tenantId !== "string" || tenantId.length === 0) return [];
    const max = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 100;
    const out: JobSummary[] = [];
    for (const s of [...this.jobs.values()].reverse()) {
      if (s.job.tenantId !== tenantId) continue;
      out.push(summarize(s));
      if (out.length >= max) break;
    }
    return out;
  }
  /** Tek iş özeti; başka tenant'ın işi bulunmamış gibi davranır (varlık sızdırılmaz). */
  summary(tenantId: string, jobId: string): JobSummary | null {
    const s = this.jobs.get(jobId);
    return s && s.job.tenantId === tenantId ? summarize(s) : null;
  }
  get isStopped(): boolean { return this.stopped; }
}
