// //TR: Bu dosya Work OS kanonik store'unu uygular: append-only hash zincirli JSONL journal tek otoritedir, snapshot journal'dan türetilir; bozuk zincir fail-closed olur ve yazmayı reddeder.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// //TR: automation/lib korumalı olduğundan atomic-json.mjs için .d.mts eklenemez; yeniden kullanılan helper dar bir yerel tiple bağlanır, kopyalanmaz.
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok
import {sha256 as sha256Untyped, writeJsonAtomic as writeJsonAtomicUntyped} from "../../automation/lib/atomic-json.mjs";
// //TR: Süreçler arası journal kilidi için mevcut process-lock helper'ı yeniden kullanılır, kopyalanmaz.
import {acquireProcessLock} from "../../automation/lib/process-lock.mjs";
import {assertTransition, isMissionStatus} from "../mission/state-machine.js";
import type {MissionStatus} from "../mission/types.js";
import {TASK_TRANSITIONS, WorkOsError, isTaskStatus, urlHasUserinfo} from "./types.js";
import type {DeliveryArtifactRecord, JournalEntry, JournalType, Project, ProjectExport, ProjectTemplate, ProjectType, RiskLevel, RunCheckpoint, RunCompletionRecord, RunEvidence, RunStatus, RunStep, Scope, TaskStatus, WorkMission, WorkRun, WorkTask} from "./types.js";
// //TR: B11A: Company OS domainleri ikinci bir store kurmaz; girdileri bu journal'a yazar ve replay'de core/company apply fonksiyonlarına devredilir.
import {applyCompanyEntry} from "../company/apply.js";
import {emptyCompanyState, isCompanyJournalType} from "../company/types.js";
import type {CompanyJournalType, CompanyRecord, CompanyState, CompanyTx, CompanyView} from "../company/types.js";
// //TR: WFR-04a: Skill Academy öğrenme kayıtları da ikinci store kurmaz; aynı journal'a domain ad alanlı (ACADEMY_*) girdiler olarak yazılır ve replay'de core/academy apply fonksiyonuna devredilir.
import {applyAcademyEntry} from "../academy/apply.js";
import {emptyAcademyState, isAcademyJournalType} from "../academy/types.js";
import type {AcademyJournalType, AcademyState, AcademyTx, AcademyView} from "../academy/types.js";
// //TR: CORE pre-dev artefakt sözleşmeleri + PRE_DEV faz dizisi: ikinci store kurmaz; girdiler aynı journal'a yazılır ve replay'de applyPreDevEntry'ye devredilir (Company/Academy ile aynı desen).
import {applyPreDevEntry} from "./predev/apply.js";
import {derivePreDevReadModel} from "./predev/read-model.js";
import {PREDEV_OPEN_MISSION_STATUSES, emptyPreDevState, isPreDevJournalType} from "./predev/types.js";
import type {ArtifactContent, ArtifactKind, ArtifactState, PreDevArtifact, PreDevJournalType, PreDevPhase, PreDevSequence, PreDevState} from "./predev/types.js";
import type {PreDevReadModel} from "./predev/read-model.js";
import {ACTIVE_WORKER_STATUSES, LEASED_RUN_STATUSES, UNLEASED_RUN_STATUSES, assertRunTransition, isOpenRun, isRunStatus, isRunStep} from "./run-state.js";
import {completionEvidence, deliveryPrepareCheck, sourceDeliveryAcceptanceCheck, validDeliveryArtifactRecord} from "./outcomes.js";
import {RISK_REFUSAL, riskAdmitted} from "./risk-admission.js";

const sha256 = sha256Untyped as (value: unknown) => string;
const writeJsonAtomic = writeJsonAtomicUntyped as (file: string, value: unknown) => void;
const LOCK_WAIT_MS = 10_000;
// //TR: C-PAR03-DIAG-1 (YALNIZ ölçüm; davranış, kilit, journal, snapshot ve zaman aşımı değişmez): Windows CI'da relfx-c3:200 PAR-03 fence'inin ENGELLEYEN ÇAĞRISI bilinmiyor. Her store yazısının süresi aşamalara bölünür (kilit bekleme + yeniden deneme sayısı, yeniden yükleme/doğrulama, journal ekleme+fsync, snapshot yeniden yazımları (süresi ve sayısı; yükleme VE ekleme birer yazım yapar, süre hangi aşamada olursa olsun snapshotMs'ye yazılır, reloadMs'den çıkarılır), kilit bırakma) ve test başarısızlık iletisi bunları, `performance.now()` ile aynı saatte, stallProbe boşluklarıyla eşleştirebilsin diye başlangıç zamanlarıyla birlikte yazar. Salt okunur: `writeStats()` kopya döndürür; halka tamponu en çok WRITE_RING yazı tutar.
export interface StoreWriteTiming { type: string; startedAtWall: number; startedAtPerf: number; totalMs: number; lockWaitMs: number; lockRetries: number; reloadMs: number; journalMs: number; snapshotMs: number; snapshotWrites: number; releaseMs: number }
export interface StoreWriteStats { writes: number; lockAcquisitions: number; lockRetries: number; lockWaitMsTotal: number; lockWaitMsMax: number; slowest: StoreWriteTiming | null; recent: StoreWriteTiming[] }
const WRITE_RING = 64;
const ms1 = (n: number): number => Math.round(n * 10) / 10;
const GENESIS = "0".repeat(64);
const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
export const newTraceId = () => newId("trc");

interface IdemRecord { id: string; digest?: string }
interface State {
  projects: Record<string, Project>; missions: Record<string, WorkMission>; tasks: Record<string, WorkTask>; runs: Record<string, WorkRun>;
  exports: Record<string, ProjectExport>;
  idempotency: Record<string, IdemRecord>; lastSeq: number; lastHash: string; company: CompanyState; academy: AcademyState; predev: PreDevState;
}
const emptyState = (): State => ({projects: {}, missions: {}, tasks: {}, runs: {}, exports: {}, idempotency: {}, lastSeq: 0, lastHash: GENESIS, company: emptyCompanyState(), academy: emptyAcademyState(), predev: emptyPreDevState()});
const entryHash = (body: Omit<JournalEntry, "hash">): string => sha256(body);
// //TR: F-B1-001: anahtar JSON dizisidir; ayırıcı karakter içeren tenant/anahtar değerleri çarpışamaz.
const idemKey = (tenantId: string, kind: string, key: string) => JSON.stringify([tenantId, kind, key]);
const tampered = (detail: string) => new WorkOsError("WORKOS_JOURNAL_TAMPERED", detail);
// //TR: Görev geçişinin reddedilme nedeni (null = izinli); yazma ve replay aynı kuralı kullanır, böylece journal'daki her geçiş yeniden doğrulanır.
function taskTransitionRefusal(st: {tasks: Record<string, WorkTask>; missions: Record<string, WorkMission>}, t: WorkTask, to: TaskStatus): {code: "WORKOS_INVALID_TRANSITION" | "WORKOS_CONFLICT"; detail: string} | null {
  if (!(TASK_TRANSITIONS[t.status] ?? []).includes(to)) return {code: "WORKOS_INVALID_TRANSITION", detail: `${t.status}->${to}`};
  if (st.missions[t.missionId]?.status === "COMPLETE") return {code: "WORKOS_CONFLICT", detail: "MISSION_COMPLETE"};
  if (to === "IN_PROGRESS" && t.dependsOn.some(d => st.tasks[d]?.status !== "DONE")) return {code: "WORKOS_CONFLICT", detail: "TASK_DEPENDENCIES_NOT_DONE"};
  return null;
}
const malformed = (detail: string) => new WorkOsError("WORKOS_UNAVAILABLE", detail);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const sleepSync = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export function defaultDataDir(repoRoot: string = process.cwd()): string {
  return process.env.UASCO_DATA_DIR ? path.resolve(process.env.UASCO_DATA_DIR) : path.join(repoRoot, ".ai", "runtime", "workos");
}

export interface CreateProjectInput {
  tenantId: string; orgId: string; customerId?: string; name: string; repository?: {path?: string; url?: string};
  environmentId: string; createdBy: string; idempotencyKey?: string; testCommand?: string[];
  // PS-1A Project Studio alanları (verilmezse eski davranış ve eski idempotency özeti aynen kalır).
  template?: ProjectTemplate; projectType?: ProjectType; techStack?: string[]; targetOS?: string[]; acceptanceCriteria?: string[];
  budget?: {maxRuns?: number; maxTokens?: number}; devCommand?: string[];
  // Yönetilen depo: journal kilidi altında, idempotency kontrolünden SONRA ve kayıt yazılmadan ÖNCE çağrılır; hata kayıt yazmaz. discard, append başarısız olursa çağrılır.
  prepareManagedRepository?: (projectId: string) => {path: string; discard: () => void};
}
export interface CreateMissionInput {
  tenantId: string; projectId: string; title: string; objective: string; acceptanceCriteria: string[];
  riskLevel: RiskLevel; createdBy: string; idempotencyKey?: string; testCommand?: string[];
}
export interface CreateTaskInput {
  tenantId: string; missionId: string; title: string; dependsOn?: string[]; status?: TaskStatus; actor: string; idempotencyKey?: string;
}

export interface WriteResult<T> { entity: T; replayed: boolean }
// //TR: B3a run yazma girdileri. Engine sistem aktörüdür ve run'ın kendi tenant'ında yazar; API okumaları her zaman scope ile filtrelenir.
export interface CreateRunInput {
  tenantId: string; missionId: string; roleId?: string | null; executor: {implementer: string; reviewer: string}; createdBy: string; idempotencyKey?: string;
}
export interface RunPatch {
  step?: RunStep; remediationCycle?: number; retryCount?: number; retryAt?: string | null; baseSha?: string | null; headSha?: string | null; workBranch?: string | null;
}
export interface RunWriteOptions { patch?: RunPatch; mission?: {to: MissionStatus; reason: string} }
// //TR: REL-FX-4 fs seam'i: yalnız test enjeksiyonu (ENOSPC/kısa yazma); verilmezse fs.writeSync kullanılır.
export interface WorkOsStoreOptions { now?: () => number; io?: {writeSync?: (fd: number, data: Buffer) => number} }
// //TR: REL-FX-4: geçerli zincir üzerinde tek sonlandırılmamış son satır (yırtık append). quarantineFile dataDir'e görelidir (mutlak yol sızmaz).
export interface TornTail { offset: number; bytes: number; sha256: string; fileSha256: string; expectedSeq: number; lastSeq: number; quarantineFile: string; quarantined: boolean }
export interface JournalHealth { state: "OK" | "ABSENT" | "TORN_TAIL" | "TAMPERED" | "UNAVAILABLE"; reason: string | null; tornTail: TornTail | null }
export interface TornTailRepair { truncatedBytes: number; tailSha256: string; quarantineFile: string; lastSeq: number }
const hexSha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const RUN_PATCH_KEYS = new Set(["step", "remediationCycle", "retryCount", "retryAt", "baseSha", "headSha", "workBranch"]);
const isNat = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const isStrOrNull = (x: unknown) => x === null || (typeof x === "string" && x.length > 0 && x.length <= 200);
function validRunPatch(p: unknown): p is RunPatch {
  if (!isObj(p)) return false;
  for (const [k, v] of Object.entries(p)) {
    if (!RUN_PATCH_KEYS.has(k)) return false;
    if (k === "step" ? !isRunStep(v) : k === "remediationCycle" || k === "retryCount" ? !isNat(v) : !isStrOrNull(v)) return false;
  }
  return true;
}
const clone = <T>(x: T): T => structuredClone(x);

export class WorkOsStore {
  readonly dataDir: string; readonly journalFile: string; readonly snapshotFile: string; readonly lockFile: string;
  // //TR: C-PAR03-DIAG-1: yalnız ölçüm durumu (bkz. StoreWriteStats); iş mantığı bunlara bağlı DEĞİLDİR.
  private diag = {writes: 0, lockAcquisitions: 0, lockRetries: 0, lockWaitMsTotal: 0, lockWaitMsMax: 0, slowest: null as StoreWriteTiming | null, recent: [] as StoreWriteTiming[]};
  private frame: StoreWriteTiming | null = null;
  writeStats(): StoreWriteStats {
    const d = this.diag;
    return {writes: d.writes, lockAcquisitions: d.lockAcquisitions, lockRetries: d.lockRetries, lockWaitMsTotal: ms1(d.lockWaitMsTotal), lockWaitMsMax: ms1(d.lockWaitMsMax), slowest: d.slowest === null ? null : {...d.slowest}, recent: d.recent.map(r => ({...r}))};
  }
  private noteLock(waitMs: number, retries: number): void {
    const d = this.diag;
    d.lockAcquisitions += 1; d.lockRetries += retries; d.lockWaitMsTotal += waitMs; d.lockWaitMsMax = Math.max(d.lockWaitMsMax, waitMs);
    if (this.frame) { this.frame.lockWaitMs += waitMs; this.frame.lockRetries += retries; }
  }
  private noteWrite(f: StoreWriteTiming, totalMs: number): void {
    const t: StoreWriteTiming = {type: f.type === "" ? "?" : f.type, startedAtWall: f.startedAtWall, startedAtPerf: ms1(f.startedAtPerf), totalMs: ms1(totalMs), lockWaitMs: ms1(f.lockWaitMs), lockRetries: f.lockRetries, reloadMs: ms1(f.reloadMs), journalMs: ms1(f.journalMs), snapshotMs: ms1(f.snapshotMs), snapshotWrites: f.snapshotWrites, releaseMs: ms1(f.releaseMs)};
    const d = this.diag;
    d.writes += 1;
    if (d.slowest === null || t.totalMs > d.slowest.totalMs) d.slowest = t;
    d.recent.push(t); if (d.recent.length > WRITE_RING) d.recent.shift();
  }
  private state: State = emptyState();
  private tamperReason: string | null = null;
  // F-B1-002: IO/format hataları da fail-closed bayrağı kurar; guard() okuma ve yazmayı reddeder.
  private unavailableReason: string | null = null;
  private sig: string | null = null;
  // REL-FX-4: yırtık kuyruk varsa store salt-okunurdur; yazılar WORKOS_READ_ONLY ile reddedilir, okumalar geçerli önekten sunulur.
  private tornTail: TornTail | null = null;
  private readonly writeSyncFn: (fd: number, data: Buffer) => number;
  // B3a: lease süresi ve fencing için saat; testler crash/recovery senaryosunda ileri saatli ikinci bir örnek kurar.
  private readonly now: () => number;

  constructor(dataDir: string = defaultDataDir(), options: WorkOsStoreOptions = {}) {
    this.dataDir = dataDir;
    this.now = options.now ?? Date.now;
    this.writeSyncFn = options.io?.writeSync ?? ((fd, data) => fs.writeSync(fd, data));
    this.journalFile = path.join(dataDir, "journal.jsonl");
    this.snapshotFile = path.join(dataDir, "snapshot.json");
    this.lockFile = path.join(dataDir, "journal.lock");
    this.refresh();
  }

  get isTampered(): boolean { this.refresh(); return this.tamperReason !== null; }
  get isUnavailable(): boolean { this.refresh(); return this.unavailableReason !== null; }
  get hasJournal(): boolean { return fs.existsSync(this.journalFile); }
  get lastSeq(): number { this.refresh(); return this.state.lastSeq; }
  get isReadOnly(): boolean { this.refresh(); return this.tornTail !== null; }
  // Sistem durumu için journal sağlığı (yol/stack içermez).
  journalHealth(): JournalHealth {
    this.refresh();
    if (this.tamperReason) return {state: "TAMPERED", reason: this.tamperReason.replace(/^WORKOS_JOURNAL_TAMPERED: /, ""), tornTail: null};
    if (this.unavailableReason) return {state: "UNAVAILABLE", reason: this.unavailableReason, tornTail: null};
    if (this.tornTail) return {state: "TORN_TAIL", reason: "JOURNAL_TORN_TAIL", tornTail: {...this.tornTail}};
    return {state: this.hasJournal ? "OK" : "ABSENT", reason: null, tornTail: null};
  }

  // Journal dosyasının parmak izi: başka bir örnek/süreç yazınca veya dosya değişince okuma yeniden doğrular (bayat veri sessizce sunulmaz).
  private signature(): string {
    try { const st = fs.statSync(this.journalFile); return `${st.size}:${st.mtimeMs}:${st.ino}`; } catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? "ABSENT" : `ERR:${(e as NodeJS.ErrnoException).code ?? "?"}`; }
  }
  // F-B1-006: journal append ve doğrulamalı yükleme süreçler arası tek lock ile serileşir (process-lock.mjs yeniden kullanılır).
  private withLock<T>(fn: () => T): T {
    const runId = `workos-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const deadline = Date.now() + LOCK_WAIT_MS; let release: (() => void) | null = null;
    const lockStart = performance.now(); let retries = 0;
    for (;;) {
      try { release = acquireProcessLock(this.lockFile, runId); break; } catch {
        if (Date.now() >= deadline) { this.noteLock(performance.now() - lockStart, retries); throw new WorkOsError("WORKOS_UNAVAILABLE", "LOCK_TIMEOUT"); }
        retries += 1;
        sleepSync(15);
      }
    }
    this.noteLock(performance.now() - lockStart, retries);
    try { return fn(); } finally { const releaseStart = performance.now(); try { release?.(); } catch { /* lock sahipliği değişmişse yazma zaten tamamlandı */ } if (this.frame) this.frame.releaseMs += performance.now() - releaseStart; }
  }
  private fail(e: unknown): void {
    this.sig = null; this.tornTail = null;
    if (e instanceof WorkOsError && e.code === "WORKOS_JOURNAL_TAMPERED") { this.tamperReason = e.message; this.unavailableReason = null; return; }
    // Yol/stack sızmasın: yalnız sabit sebep saklanır.
    this.tamperReason = null; this.unavailableReason = e instanceof WorkOsError ? e.message.replace(/^WORKOS_UNAVAILABLE: ?/, "") || "UNAVAILABLE" : "LOAD_FAILED";
  }
  private refresh(): void {
    const s = this.signature();
    if (s === this.sig) return;
    try {
      if (s === "ABSENT" && this.state.lastSeq === 0 && !fs.existsSync(this.snapshotFile)) { this.tamperReason = null; this.unavailableReason = null; this.sig = s; return; }
      this.withLock(() => this.load());
    } catch (e) { this.fail(e); }
  }

  // Journal tek otoritedir: zinciri baştan doğrular ve state'i yeniden oynatır. Atomiktir: yerel değişkenlere kurar, yalnız başarıda atar.
  private load(): void {
    const sigBefore = this.signature();
    try {
      const {entries, torn} = this.readVerifiedEntries();
      const st = emptyState();
      for (const e of entries) this.apply(st, e);
      this.checkSnapshotAgainst(entries);
      this.state = st; this.tamperReason = null; this.unavailableReason = null; this.sig = sigBefore;
      // REL-FX-4: yırtık kuyrukta hiçbir şey yazılmaz (snapshot dahil); yalnız karantina kopyası alınır.
      this.tornTail = torn ? this.quarantine(torn, st.lastSeq) : null;
      if (!torn && entries.length > 0) this.writeSnapshotBestEffort();
    } catch (e) { this.fail(e); }
  }
  // //TR: REL-FX-4: dosya "\n" ile bitmiyorsa son satır ayrılır; önek tam zincir doğrulamasından geçer. Kuyruk yalnız zincirin beklenen SONRAKİ girdisinin baş baytlarıysa
  // TORN_TAIL'dır (tek yırtık append); önek bozuksa, kuyruk yabancıysa veya snapshot ileride ise tamper/fail-closed kalır.
  private readVerifiedEntries(): {entries: JournalEntry[]; torn: {offset: number; tail: Buffer; full: Buffer} | null} {
    if (!fs.existsSync(this.journalFile)) return {entries: [], torn: null};
    const buf = fs.readFileSync(this.journalFile);
    const cut = buf.length > 0 && buf[buf.length - 1] !== 0x0a ? buf.lastIndexOf(0x0a) + 1 : buf.length;
    const raw = buf.subarray(0, cut).toString("utf8");
    const out: JournalEntry[] = []; let prev = {seq: 0, hash: GENESIS};
    for (const line of raw.split("\n").filter(Boolean)) {
      let e: JournalEntry;
      try { e = JSON.parse(line) as JournalEntry; } catch { throw tampered("LINE_NOT_JSON"); }
      if (!e || typeof e !== "object" || typeof e.hash !== "string") throw tampered(`ENTRY_SHAPE:${out.length + 1}`);
      const {hash, ...body} = e;
      if (entryHash(body) !== hash) throw tampered(`HASH_MISMATCH:${e.seq}`);
      if (e.seq !== prev.seq + 1) throw tampered(`SEQUENCE_BROKEN:${e.seq}`);
      if (e.prevHash !== prev.hash) throw tampered(`CHAIN_BROKEN:${e.seq}`);
      out.push(e); prev = {seq: e.seq, hash: e.hash};
    }
    if (cut === buf.length) return {entries: out, torn: null};
    const tail = buf.subarray(cut), expected = Buffer.from(`{"seq":${prev.seq + 1},"prevHash":"${prev.hash}","type":"`, "utf8");
    const n = Math.min(expected.length, tail.length);
    if (n === 0 || !tail.subarray(0, n).equals(expected.subarray(0, n))) throw tampered("JOURNAL_TRUNCATED_LINE");
    return {entries: out, torn: {offset: cut, tail, full: buf}};
  }
  // Karantina kopyası: yırtık dosyanın bayt bayt kopyası (adı tam dosya sha256'sından); atomik yazılır, aynı içerik tekrar yazılmaz.
  private quarantine(t: {offset: number; tail: Buffer; full: Buffer}, lastSeq: number): TornTail {
    const fileSha256 = hexSha(t.full), rel = `quarantine/journal-torn-${fileSha256.slice(0, 16)}.jsonl`, file = path.join(this.dataDir, rel);
    let quarantined = false;
    try {
      if (!fs.existsSync(file) || hexSha(fs.readFileSync(file)) !== fileSha256) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
        fs.writeFileSync(tmp, t.full); fs.renameSync(tmp, file);
      }
      quarantined = hexSha(fs.readFileSync(file)) === fileSha256;
    } catch { quarantined = false; }
    return {offset: t.offset, bytes: t.tail.length, sha256: hexSha(t.tail), fileSha256, expectedSeq: lastSeq + 1, lastSeq, quarantineFile: rel, quarantined};
  }
  // //TR: REL-FX-4 onaylı onarım: yalnız TORN_TAIL durumunda, kuyruğun tam sha256'sı onaylanırsa ve karantina kopyası doğrulanmışsa journal yırtık satırdan önceye kesilir.
  // Tamper/bozuk zincir asla kesilmez (guard fırlatır). Onarım kaydı karantina kopyasının yanına yazılır.
  repairTornTail(confirmTailSha256: string, actor: string): TornTailRepair {
    return this.withLock(() => {
      this.load(); this.guard();
      const t = this.tornTail;
      if (!t) throw new WorkOsError("WORKOS_CONFLICT", "JOURNAL_NOT_TORN");
      if (typeof confirmTailSha256 !== "string" || confirmTailSha256.length !== t.sha256.length || !crypto.timingSafeEqual(Buffer.from(confirmTailSha256), Buffer.from(t.sha256)))
        throw new WorkOsError("WORKOS_CONFLICT", "TORN_TAIL_CONFIRMATION_MISMATCH");
      const buf = fs.readFileSync(this.journalFile);
      if (buf.length !== t.offset + t.bytes || hexSha(buf) !== t.fileSha256) throw new WorkOsError("WORKOS_CONFLICT", "JOURNAL_CHANGED");
      const q = path.join(this.dataDir, t.quarantineFile);
      if (!t.quarantined || !fs.existsSync(q) || hexSha(fs.readFileSync(q)) !== t.fileSha256) throw new WorkOsError("WORKOS_UNAVAILABLE", "QUARANTINE_COPY_MISSING");
      writeJsonAtomic(`${q}.repair.json`, {"//TR": "REL-FX-4 onaylı yırtık kuyruk onarım kaydı; kesilen baytlar karantina kopyasında durur.", schemaVersion: 1, repairedAt: new Date().toISOString(), actor: String(actor).slice(0, 100),
        offset: t.offset, truncatedBytes: t.bytes, tailSha256: t.sha256, fileSha256: t.fileSha256, lastSeq: t.lastSeq});
      const fd = fs.openSync(this.journalFile, "r+");
      try { fs.ftruncateSync(fd, t.offset); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.sig = null; this.load(); this.guard(true);
      return {truncatedBytes: t.bytes, tailSha256: t.sha256, quarantineFile: t.quarantineFile, lastSeq: this.state.lastSeq};
    });
  }
  // Snapshot geride kalabilir (çökme), ama journal'dan ileri veya farklı bir geçmişe işaret edemez (kuyruk silme tespiti).
  private checkSnapshotAgainst(entries: JournalEntry[]): void {
    if (!fs.existsSync(this.snapshotFile)) return;
    let snap: {lastSeq?: unknown; lastHash?: unknown};
    try { snap = JSON.parse(fs.readFileSync(this.snapshotFile, "utf8")); } catch { return; /* türetilmiş dosya; yeniden yazılır */ }
    const s = snap.lastSeq;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0) return;
    if (s > entries.length) throw tampered("JOURNAL_SHORTER_THAN_SNAPSHOT");
    const expected = s === 0 ? GENESIS : entries[s - 1].hash;
    if (snap.lastHash !== expected) throw tampered("SNAPSHOT_HASH_NOT_IN_JOURNAL");
  }
  // Snapshot türetilmiştir: yazılamaması (ör. disk dolu) journal'ı veya okumaları bozmaz; sonraki yüklemede yeniden yazılır.
  private writeSnapshotBestEffort(): void {
    const snapshotStart = performance.now();
    try { this.writeSnapshot(); } catch { /* türetilmiş dosya */ } finally { if (this.frame) { this.frame.snapshotMs += performance.now() - snapshotStart; this.frame.snapshotWrites += 1; } }
  }
  private writeSnapshot(): void {
    writeJsonAtomic(this.snapshotFile, {"//TR": "Bu snapshot journal.jsonl dosyasından türetilir; otorite journal'dır, bu dosya silinip yeniden üretilebilir.", schemaVersion: "1.0.0", ...this.state});
  }
  private apply(st: State, e: JournalEntry): void {
    const p = e.payload;
    if (!isObj(p)) throw malformed(`PAYLOAD_SHAPE:${e.seq}`);
    const idem = (kind: string, ent: {tenantId: string}, id: string) => {
      if (p.idempotencyKey === undefined) return;
      if (!isStr(p.idempotencyKey)) throw malformed(`IDEM_SHAPE:${e.seq}`);
      st.idempotency[idemKey(ent.tenantId, kind, p.idempotencyKey)] = {id, ...(typeof p.payloadDigest === "string" ? {digest: p.payloadDigest} : {})};
    };
    switch (e.type) {
      case "PROJECT_CREATED": {
        const ent = p.entity as Project;
        if (!isObj(ent) || !isStr(ent.projectId) || !isStr(ent.tenantId)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
        st.projects[ent.projectId] = ent; idem("project", ent, ent.projectId); break;
      }
      case "MISSION_CREATED": {
        const ent = p.entity as WorkMission;
        if (!isObj(ent) || !isStr(ent.missionId) || !isStr(ent.tenantId) || !isStr(ent.projectId) || !isMissionStatus(ent.status)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
        st.missions[ent.missionId] = ent; idem("mission", ent, ent.missionId); break;
      }
      case "TASK_CREATED": {
        const ent = p.entity as WorkTask;
        if (!isObj(ent) || !isStr(ent.taskId) || !isStr(ent.tenantId) || !isStr(ent.missionId)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
        st.tasks[ent.taskId] = ent; idem("task", ent, ent.taskId); break;
      }
      case "TASK_TRANSITIONED": {
        // Replay applies the same rules as the write (allowlist, dependency gate, tenant, frozen mission): a well-hashed but inconsistent entry is tamper.
        if (!isStr(p.taskId) || !isTaskStatus(p.to) || !isStr(p.reason)) throw malformed(`TASK_TRANSITION_SHAPE:${e.seq}`);
        const t = st.tasks[p.taskId];
        if (!t || t.tenantId !== p.tenantId || t.status !== p.from || taskTransitionRefusal(st, t, p.to) !== null) throw tampered(`TASK_TRANSITION_INCONSISTENT:${e.seq}`);
        t.status = p.to; break;
      }
      case "PROJECT_REPOSITORY_SET": {
        const proj = isStr(p.projectId) ? st.projects[p.projectId] : undefined;
        const repo = p.repository as Project["repository"];
        if (!isObj(repo) || !isStr(repo.path) || repo.managed !== true) throw malformed(`REPOSITORY_SHAPE:${e.seq}`);
        if (!proj || proj.tenantId !== p.tenantId || proj.repository?.managed) throw tampered(`PROJECT_REPOSITORY_INCONSISTENT:${e.seq}`);
        proj.repository = {path: repo.path, managed: true}; break;
      }
      case "PROJECT_EXPORT_RECORDED": {
        const ex = p.entity as ProjectExport;
        if (!isObj(ex) || !isStr(ex.exportId) || !isStr(ex.projectId) || !isStr(ex.tenantId) || !isStr(ex.sha256) || !isStr(ex.commit)) throw malformed(`EXPORT_SHAPE:${e.seq}`);
        const proj = st.projects[ex.projectId];
        if (!proj || proj.tenantId !== ex.tenantId || st.exports[ex.exportId]) throw tampered(`EXPORT_INCONSISTENT:${e.seq}`);
        st.exports[ex.exportId] = ex; break;
      }
      case "MISSION_TRANSITIONED": {
        if (!isStr(p.missionId)) throw malformed(`TRANSITION_SHAPE:${e.seq}`);
        const m = st.missions[p.missionId];
        if (!m || m.status !== p.from || !isMissionStatus(p.to)) throw tampered(`TRANSITION_INCONSISTENT:${e.seq}`);
        try { assertTransition(m.status, p.to); } catch { throw tampered(`TRANSITION_ILLEGAL:${e.seq}`); }
        m.status = p.to; break;
      }
      case "RUN_CREATED": {
        const ent = p.entity as WorkRun;
        if (!isObj(ent) || !isStr(ent.runId) || !isStr(ent.tenantId) || !isStr(ent.missionId) || ent.status !== "CREATED" || !isObj(ent.executor)
          || !isStr(ent.executor.implementer) || !isStr(ent.executor.reviewer) || !Array.isArray(ent.checkpoints) || !Array.isArray(ent.evidence)) throw malformed(`ENTITY_SHAPE:${e.seq}`);
        if (ent.executor.implementer === ent.executor.reviewer) throw tampered(`RUN_REVIEWER_NOT_INDEPENDENT:${e.seq}`);
        const m = st.missions[ent.missionId];
        if (!m || m.tenantId !== ent.tenantId || st.runs[ent.runId]) throw tampered(`RUN_INCONSISTENT:${e.seq}`);
        st.runs[ent.runId] = {...ent, updatedAt: e.at};
        this.applyMissionMove(st, p.mission, ent.missionId, e.seq);
        idem("run", ent, ent.runId); break;
      }
      case "RUN_LEASE": {
        const r = this.runFor(st, p, e.seq);
        if (!isStr(p.leaseId) || typeof p.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(p.leaseExpiresAt))) throw malformed(`LEASE_SHAPE:${e.seq}`);
        if (p.kind === "ACQUIRE") {
          if (r.status !== "QUEUED" || r.leaseId !== null) throw tampered(`LEASE_ILLEGAL:${e.seq}`);
          r.status = "LEASED"; r.attempt += 1;
        } else if (p.kind === "RENEW") {
          if (r.leaseId === null || r.leaseId !== p.leaseId) throw tampered(`LEASE_ILLEGAL:${e.seq}`);
        } else if (p.kind === "TAKEOVER") {
          if (r.leaseId === null || r.leaseId !== p.previousLeaseId || !LEASED_RUN_STATUSES.includes(r.status)) throw tampered(`LEASE_ILLEGAL:${e.seq}`);
          if (r.status !== "RECOVERING" && r.status !== "CANCELLING") { try { assertRunTransition(r.status, "RECOVERING"); } catch { throw tampered(`RUN_TRANSITION_ILLEGAL:${e.seq}`); } r.status = "RECOVERING"; }
          r.attempt += 1;
        } else throw malformed(`LEASE_KIND:${e.seq}`);
        r.leaseId = p.leaseId; r.leaseExpiresAt = p.leaseExpiresAt; r.updatedAt = e.at; break;
      }
      case "RUN_TRANSITION": {
        const r = this.runFor(st, p, e.seq);
        if (!isRunStatus(p.to) || r.status !== p.from || (p.leaseId ?? null) !== r.leaseId) throw tampered(`RUN_TRANSITION_INCONSISTENT:${e.seq}`);
        try { assertRunTransition(r.status, p.to); } catch { throw tampered(`RUN_TRANSITION_ILLEGAL:${e.seq}`); }
        if (p.patch !== undefined && !validRunPatch(p.patch)) throw malformed(`RUN_PATCH:${e.seq}`);
        // REL-FX-1: run SUCCEEDED ve mission COMPLETE yalnız birlikte ve yalnız kanıt yüklemi replay anında da sağlanıyorsa geçerlidir (tek journal girdisi).
        // D-M1A-STATE-MODEL-2026-10-15: kapı replay anında yeniden çalışır (FX-1 + PRODUCT_VERIFIED); tamamlama kaydı yeniden türetilenle birebir aynı olmalıdır. Onay alanı taşıyan
        // (cycle-1 NOT_EXECUTED onaylı veya REL-FX c4 test-değişikliği onaylı) ya da PRODUCT_VERIFIED kanıtı olmayan bir tamamlama kaydı artık türetilemez ve tamper'dır.
        const toComplete = isObj(p.mission) && p.mission.to === "COMPLETE";
        let completion: RunCompletionRecord | undefined;
        if (p.to === "SUCCEEDED" || toComplete) {
          const chk = completionEvidence(r, r.evidence);
          if (p.to !== "SUCCEEDED" || !toComplete || p.patch !== undefined || !chk.ok || !isObj(p.completion) || JSON.stringify(p.completion) !== JSON.stringify(chk.refs)) throw tampered(`COMPLETION_UNSUPPORTED:${e.seq}`);
          completion = chk.refs;
        }
        this.applyMissionMove(st, p.mission, r.missionId, e.seq);
        Object.assign(r, p.patch ?? {});
        r.status = p.to; r.reason = typeof p.reason === "string" ? p.reason : null; r.updatedAt = e.at;
        if (completion) r.completion = completion;
        if (UNLEASED_RUN_STATUSES.includes(r.status)) { r.leaseId = null; r.leaseExpiresAt = null; }
        break;
      }
      case "DELIVERY_ARTIFACT_PREPARED": {
        // M1a c2: teslim artefaktı kaydı replay'de yeniden doğrulanır: biçim birebir, run SOURCE_GENERATION_COMPLETE ve kabul edilmemiş, sourceCommit === run.headSha, mission eşleşir.
        // Aynı hash'in tekrar kaydı yazma yolunda üretilmez (yeniden hazırlama idempotenttir) ve tamper'dır.
        const r = this.runFor(st, p, e.seq);
        if (!validDeliveryArtifactRecord(p)) throw malformed(`DELIVERY_ARTIFACT_SHAPE:${e.seq}`);
        if (p.missionId !== r.missionId || p.sourceCommit !== r.headSha || !deliveryPrepareCheck(r).ok || r.deliveryArtifact?.exportArtifactHash === p.exportArtifactHash) throw tampered(`DELIVERY_ARTIFACT_INCONSISTENT:${e.seq}`);
        r.deliveryArtifact = {runId: p.runId, missionId: p.missionId, sourceCommit: p.sourceCommit, treeSha: p.treeSha, exportArtifactHash: p.exportArtifactHash, artifactPath: p.artifactPath};
        break;
      }
      case "SOURCE_DELIVERY_ACCEPTED": {
        // M1a c2: NOT_VERIFIED kaynak teslimi kabulü replay'de yeniden türetilir: kayıtlı alanlar kabul girdisine çevrilir, kapı o anki durumla (güncel artefakt kaydı, run, mission) yeniden
        // çalıştırılır ve kayıt birebir karşılaştırılır (farklı run/artefakt/bayat kayıt/ikinci kullanım tamper'dır). Run ve mission durumu değişmez; productVerification değişmez.
        const r = this.runFor(st, p, e.seq);
        const acks = isObj(p.acknowledgements) ? p.acknowledgements : null, tc = acks && isObj(acks.testChanges) ? acks.testChanges : undefined;
        if (!acks || !isObj(acks.notExecuted)) throw malformed(`SOURCE_DELIVERY_SHAPE:${e.seq}`);
        if (p.acceptedAt !== e.at) throw tampered(`SOURCE_DELIVERY_UNSUPPORTED:${e.seq}`);
        const input = {runId: p.runId, missionId: p.missionId, sourceCommit: p.sourceCommit, exportArtifactHash: p.exportArtifactHash, acknowledgeNotExecuted: acks.notExecuted.acknowledgeNotExecuted,
          ...(acks.testChanges !== undefined ? {testChangesAcknowledgement: tc ? {acknowledgeTestChanges: tc.acknowledgeTestChanges, testSurfaceSha256: tc.testSurfaceSha256} : acks.testChanges} : {})};
        const chk = sourceDeliveryAcceptanceCheck({run: r, missionStatus: st.missions[r.missionId]?.status ?? null, latestRunId: this.latestRunId(st, r.missionId, r.tenantId)}, input);
        if (!chk.ok || JSON.stringify({...chk.record, acceptedAt: e.at}) !== JSON.stringify(p)) throw tampered(`SOURCE_DELIVERY_UNSUPPORTED:${e.seq}`);
        r.sourceDelivery = {...chk.record, acceptedAt: e.at};
        break;
      }
      case "RUN_CHECKPOINT": {
        const r = this.runFor(st, p, e.seq);
        const c = p.checkpoint as RunCheckpoint;
        if (r.status !== "CHECKPOINTING" || (p.leaseId ?? null) !== r.leaseId) throw tampered(`RUN_CHECKPOINT_INCONSISTENT:${e.seq}`);
        if (!isObj(c) || !isRunStep(c.step) || !isNat(c.cycle) || !isObj(c.data) || (p.patch !== undefined && !validRunPatch(p.patch))) throw malformed(`CHECKPOINT_SHAPE:${e.seq}`);
        this.applyMissionMove(st, p.mission, r.missionId, e.seq);
        r.checkpoints.push(c); Object.assign(r, p.patch ?? {}); r.updatedAt = e.at; break;
      }
      case "RUN_EVIDENCE": {
        const r = this.runFor(st, p, e.seq);
        const ev = p.evidence as RunEvidence;
        if ((p.leaseId ?? null) !== r.leaseId) throw tampered(`RUN_EVIDENCE_INCONSISTENT:${e.seq}`);
        if (!isObj(ev) || !isStr(ev.evidenceId) || !isStr(ev.kind) || !Array.isArray(ev.argv)) throw malformed(`EVIDENCE_SHAPE:${e.seq}`);
        r.evidence.push(ev); r.updatedAt = e.at; break;
      }
      default: {
        if (isPreDevJournalType(e.type)) {
          const applied = applyPreDevEntry(st.predev, {seq: e.seq, type: e.type, at: e.at, actor: e.actor, payload: p});
          if (applied.idem) idem(applied.idem.kind, applied.idem, applied.idem.id);
          break;
        }
        if (isAcademyJournalType(e.type)) {
          const applied = applyAcademyEntry(st.academy, {seq: e.seq, type: e.type, at: e.at, actor: e.actor, payload: p});
          if (applied.idem) idem(applied.idem.kind, applied.idem, applied.idem.id);
          break;
        }
        if (!isCompanyJournalType(e.type)) throw tampered(`UNKNOWN_TYPE:${e.seq}`);
        const applied = applyCompanyEntry(st.company, {seq: e.seq, type: e.type, at: e.at, actor: e.actor, payload: p});
        if (applied.idem) idem(applied.idem.kind, applied.idem, applied.idem.id);
      }
    }
    st.lastSeq = e.seq; st.lastHash = e.hash;
  }
  // Mission'ın en son run'ı (oluşturma sırası); COMPLETE ve kaynak teslimi kabulü yalnız bu run için geçerlidir.
  private latestRunId(st: State, missionId: string, tenantId: string): string | null {
    const runs = Object.values(st.runs).filter(r => r.missionId === missionId && r.tenantId === tenantId);
    return runs.length ? runs[runs.length - 1].runId : null;
  }
  private runFor(st: State, p: Record<string, unknown>, seq: number): WorkRun {
    if (!isStr(p.runId)) throw malformed(`RUN_SHAPE:${seq}`);
    const r = st.runs[p.runId];
    if (!r) throw tampered(`RUN_UNKNOWN:${seq}`);
    return r;
  }
  // Run kaydına gömülü mission geçişi: aynı journal girdisinde atomik uygulanır ve yine mission state machine allowlist'inden geçer.
  private applyMissionMove(st: State, mv: unknown, missionId: string, seq: number): void {
    if (mv === undefined) return;
    if (!isObj(mv) || mv.missionId !== missionId || !isMissionStatus(mv.to)) throw malformed(`MISSION_MOVE_SHAPE:${seq}`);
    const m = st.missions[missionId];
    if (!m || m.status !== mv.from) throw tampered(`TRANSITION_INCONSISTENT:${seq}`);
    try { assertTransition(m.status, mv.to); } catch { throw tampered(`TRANSITION_ILLEGAL:${seq}`); }
    m.status = mv.to;
  }
  private guard(write = false): void {
    if (this.tamperReason) throw new WorkOsError("WORKOS_JOURNAL_TAMPERED", this.tamperReason.replace(/^WORKOS_JOURNAL_TAMPERED: /, ""));
    if (this.unavailableReason) throw new WorkOsError("WORKOS_UNAVAILABLE", this.unavailableReason);
    if (write && this.tornTail) throw new WorkOsError("WORKOS_READ_ONLY", "JOURNAL_TORN_TAIL");
  }
  private readGuard(): void { this.refresh(); this.guard(); }
  // Her yazı lock altında disk yeniden doğrulanarak yapılır: başka örnek/süreç yazdıysa onun yazıları görülür, bozuk disk fail-closed.
  private write<T>(fn: () => T): T {
    const frame: StoreWriteTiming = {type: "", startedAtWall: Date.now(), startedAtPerf: performance.now(), totalMs: 0, lockWaitMs: 0, lockRetries: 0, reloadMs: 0, journalMs: 0, snapshotMs: 0, snapshotWrites: 0, releaseMs: 0};
    this.frame = frame; // //TR: write() yeniden girişli DEĞİLDİR (iç içe çağrı süreç kilidinde 10 sn takılır), bu yüzden çerçeve tek ve bitince sıfırlanır
    try {
      return this.withLock(() => { const reloadStart = performance.now(), snapshotBefore = frame.snapshotMs; try { this.load(); } finally { frame.reloadMs = performance.now() - reloadStart - (frame.snapshotMs - snapshotBefore); } this.guard(true); return fn(); });
    } finally { this.frame = null; this.noteWrite(frame, performance.now() - frame.startedAtPerf); }
  }
  // WFR04A-C1-F3: at verilirse (academy ön-denemesinde kullanılan zaman) aynen yazılır; ön-deneme ile diske yazılan girdi aynı zamanı taşır.
  private append(type: JournalType, actor: string, payload: Record<string, unknown>, at?: string): JournalEntry {
    const body = {seq: this.state.lastSeq + 1, prevHash: this.state.lastHash, type, actor, at: at ?? new Date().toISOString(), payload};
    const entry: JournalEntry = {...body, hash: entryHash(body)};
    const line = Buffer.from(JSON.stringify(entry) + "\n", "utf8");
    const journalStart = performance.now();
    fs.mkdirSync(this.dataDir, {recursive: true});
    const fd = fs.openSync(this.journalFile, "a");
    try {
      const size = fs.fstatSync(fd).size;
      try {
        const n = this.writeSyncFn(fd, line);
        if (n !== line.length) throw Object.assign(new Error("SHORT_WRITE"), {code: "ESHORTWRITE"});
        fs.fsyncSync(fd);
      } catch (e) {
        // REL-FX-4: yarım satır bırakılmaz: dosya yazı öncesi boyuta geri kesilir; geri kesme de başarısızsa sonraki açılış TORN_TAIL görür (sessiz PASS yok).
        // Windows'ta "a" kipindeki tanıtıcı kesemez (EPERM); geri kesme ayrı bir "r+" tanıtıcıyla yapılır.
        try { const rfd = fs.openSync(this.journalFile, "r+"); try { fs.ftruncateSync(rfd, size); fs.fsyncSync(rfd); } finally { fs.closeSync(rfd); } } catch { /* sonraki yükleme TORN_TAIL/tamper ayrımını yapar */ }
        this.sig = null;
        const code = (e as NodeJS.ErrnoException).code;
        throw code === "ENOSPC" || code === "EDQUOT" || code === "ESHORTWRITE" ? new WorkOsError("WORKOS_DISK_FULL", "JOURNAL_APPEND") : new WorkOsError("WORKOS_UNAVAILABLE", "JOURNAL_APPEND_FAILED");
      }
    } finally { fs.closeSync(fd); }
    const journalEnd = performance.now();
    this.apply(this.state, entry);
    this.sig = this.signature();
    this.writeSnapshotBestEffort();
    if (this.frame) {
      this.frame.type = this.frame.type === "" || this.frame.type === type ? type : `${this.frame.type}+${type}`;
      this.frame.journalMs += journalEnd - journalStart;
    }
    return entry;
  }
  // F-B1-001/005: aynı tenant+kind+key için önceki varlık döner; yük özeti farklıysa çakışma hatası.
  private findIdem<T extends {tenantId: string}>(table: Record<string, T>, tenantId: string, kind: string, key: string | undefined, digest: string): T | undefined {
    if (!key) return undefined;
    const rec = this.state.idempotency[idemKey(tenantId, kind, key)];
    const ent = rec ? table[rec.id] : undefined;
    if (!rec || !ent || ent.tenantId !== tenantId) return undefined;
    if (rec.digest !== undefined && rec.digest !== digest) throw new WorkOsError("WORKOS_IDEMPOTENCY_CONFLICT", kind);
    return ent;
  }
  private idemFields(key: string | undefined, digest: string) { return key ? {idempotencyKey: key, payloadDigest: digest} : {}; }

  createProjectDetailed(input: CreateProjectInput): WriteResult<Project> {
    if (input.repository?.url !== undefined && urlHasUserinfo(input.repository.url)) throw new WorkOsError("WORKOS_INVALID_INPUT", "repository.url userinfo");
    return this.write(() => {
      // B3a: testCommand yalnız verildiğinde özete girer; eski journal'lardaki özetler değişmez.
      // PS-1A alanları yalnız verildiğinde özete girer; yönetilen depo yolu istemciden gelmediği için özete girmez (replay aynı özeti üretir).
      const studio = {
        ...(input.template ? {template: input.template} : {}), ...(input.projectType ? {projectType: input.projectType} : {}), ...(input.techStack ? {techStack: [...input.techStack]} : {}),
        ...(input.targetOS ? {targetOS: [...input.targetOS]} : {}), ...(input.acceptanceCriteria ? {acceptanceCriteria: [...input.acceptanceCriteria]} : {}),
        ...(input.budget ? {budget: {...input.budget}} : {}), ...(input.devCommand ? {devCommand: [...input.devCommand]} : {})
      };
      const digest = sha256({orgId: input.orgId, customerId: input.customerId ?? null, name: input.name, repository: input.repository ?? null, environmentId: input.environmentId, ...(input.testCommand ? {testCommand: input.testCommand} : {}), ...studio});
      const prior = this.findIdem(this.state.projects, input.tenantId, "project", input.idempotencyKey, digest);
      if (prior) return {entity: prior, replayed: true};
      if (input.prepareManagedRepository && input.repository) throw new WorkOsError("WORKOS_INVALID_INPUT", "repository and managed repository are exclusive");
      const projectId = newId("prj");
      const managed = input.prepareManagedRepository ? input.prepareManagedRepository(projectId) : null;
      const repository = managed ? {path: managed.path, managed: true as const} : input.repository;
      const project: Project = {
        projectId, orgId: input.orgId, tenantId: input.tenantId, ...(input.customerId ? {customerId: input.customerId} : {}),
        name: input.name, ...(repository ? {repository} : {}), environmentId: input.environmentId, ...(input.testCommand ? {testCommand: [...input.testCommand]} : {}), ...studio,
        createdAt: new Date().toISOString(), createdBy: input.createdBy
      };
      try { this.append("PROJECT_CREATED", input.createdBy, {entity: project, ...this.idemFields(input.idempotencyKey, digest)}); }
      catch (e) { try { managed?.discard(); } catch { /* en iyi çaba temizlik */ } throw e; }
      return {entity: project, replayed: false};
    });
  }
  createProject(input: CreateProjectInput): Project { return this.createProjectDetailed(input).entity; }
  // PS-1A: içe aktarma sonrası proje deposu yönetilen depoya işaret eder; açık run varken veya depo zaten yönetiliyorken değiştirilemez (çalışan run'ın kaynağı sessizce değişmez).
  setProjectRepository(scope: Scope, projectId: string, repository: {path: string; managed: true}, actor: string, source: {kind: string; headSha: string}): Project {
    if (!isStr(repository?.path) || repository.managed !== true) throw new WorkOsError("WORKOS_INVALID_INPUT", "repository");
    return this.write(() => {
      const p = this.state.projects[projectId];
      if (!p || p.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "project");
      if (p.repository?.managed) throw new WorkOsError("WORKOS_CONFLICT", "PROJECT_REPOSITORY_ALREADY_MANAGED");
      if (Object.values(this.state.runs).some(r => r.projectId === projectId && isOpenRun(r.status))) throw new WorkOsError("WORKOS_CONFLICT", "RUN_ALREADY_ACTIVE");
      this.append("PROJECT_REPOSITORY_SET", actor, {projectId, tenantId: p.tenantId, repository: {path: repository.path, managed: true}, source: {kind: String(source.kind).slice(0, 16), headSha: String(source.headSha).slice(0, 64)}});
      return this.state.projects[projectId];
    });
  }
  hasOpenProjectRun(scope: Scope, projectId: string): boolean { this.readGuard(); return Object.values(this.state.runs).some(r => r.tenantId === scope.tenantId && r.projectId === projectId && isOpenRun(r.status)); }
  // PS-1A export kanıtı: aynı journal/zincir; tenant ve proje sahipliği yazmada ve replay'de doğrulanır.
  recordProjectExport(scope: Scope, ex: Omit<ProjectExport, "tenantId">, actor: string): ProjectExport {
    return this.write(() => {
      const p = this.state.projects[ex.projectId];
      if (!p || p.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "project");
      if (!/^exp_[0-9a-f]{24}$/.test(ex.exportId) || this.state.exports[ex.exportId]) throw new WorkOsError("WORKOS_INVALID_INPUT", "exportId");
      const entity: ProjectExport = {...ex, tenantId: p.tenantId};
      this.append("PROJECT_EXPORT_RECORDED", actor, {entity});
      return clone(entity);
    });
  }
  listProjectExports(scope: Scope, projectId: string): ProjectExport[] {
    this.readGuard();
    return Object.values(this.state.exports).filter(x => x.tenantId === scope.tenantId && x.projectId === projectId).map(clone);
  }
  getProjectExport(scope: Scope, projectId: string, exportId: string): ProjectExport | undefined {
    this.readGuard(); const x = this.state.exports[exportId];
    return x && x.tenantId === scope.tenantId && x.projectId === projectId ? clone(x) : undefined;
  }
  createMissionDetailed(input: CreateMissionInput): WriteResult<WorkMission> {
    return this.write(() => {
      const digest = sha256({projectId: input.projectId, title: input.title, objective: input.objective, acceptanceCriteria: input.acceptanceCriteria, riskLevel: input.riskLevel, ...(input.testCommand ? {testCommand: input.testCommand} : {})});
      const prior = this.findIdem(this.state.missions, input.tenantId, "mission", input.idempotencyKey, digest);
      if (prior) return {entity: prior, replayed: true};
      const project = this.state.projects[input.projectId];
      if (!project || project.tenantId !== input.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "project");
      const mission: WorkMission = {
        missionId: newId("msn"), projectId: input.projectId, tenantId: input.tenantId, title: input.title, objective: input.objective,
        acceptanceCriteria: [...input.acceptanceCriteria], riskLevel: input.riskLevel, status: "DRAFT", ...(input.testCommand ? {testCommand: [...input.testCommand]} : {}),
        createdAt: new Date().toISOString(), createdBy: input.createdBy, traceId: newTraceId()
      };
      this.append("MISSION_CREATED", input.createdBy, {entity: mission, ...this.idemFields(input.idempotencyKey, digest)});
      return {entity: mission, replayed: false};
    });
  }
  createMission(input: CreateMissionInput): WorkMission { return this.createMissionDetailed(input).entity; }
  createTaskDetailed(input: CreateTaskInput): WriteResult<WorkTask> {
    return this.write(() => {
      const digest = sha256({missionId: input.missionId, title: input.title, dependsOn: input.dependsOn ?? [], status: input.status ?? "PENDING"});
      const prior = this.findIdem(this.state.tasks, input.tenantId, "task", input.idempotencyKey, digest);
      if (prior) return {entity: prior, replayed: true};
      const mission = this.state.missions[input.missionId];
      if (!mission || mission.tenantId !== input.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
      const dependsOn = [...(input.dependsOn ?? [])];
      for (const d of dependsOn) { const t = this.state.tasks[d]; if (!t || t.missionId !== mission.missionId) throw new WorkOsError("WORKOS_INVALID_INPUT", `dependsOn:${d}`); }
      const task: WorkTask = {taskId: newId("tsk"), missionId: mission.missionId, projectId: mission.projectId, tenantId: mission.tenantId, title: input.title, status: input.status ?? "PENDING", dependsOn};
      this.append("TASK_CREATED", input.actor, {entity: task, ...this.idemFields(input.idempotencyKey, digest)});
      return {entity: task, replayed: false};
    });
  }
  createTask(input: CreateTaskInput): WorkTask { return this.createTaskDetailed(input).entity; }
  // //TR: Görev durumu yalnız bu yoldan değişir (TASK_TRANSITIONED); izinsiz geçiş, tamamlanmış mission veya bitmemiş bağımlılık yazmadan reddedilir.
  transitionTask(scope: Scope, taskId: string, to: TaskStatus, reason: string, actor: string): WorkTask {
    if (!isTaskStatus(to)) throw new WorkOsError("WORKOS_INVALID_INPUT", "to");
    if (typeof reason !== "string" || reason.trim().length === 0) throw new WorkOsError("WORKOS_INVALID_INPUT", "reason");
    return this.write(() => {
      const t = this.state.tasks[taskId];
      if (!t || t.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "task");
      const refusal = taskTransitionRefusal(this.state, t, to);
      if (refusal) throw new WorkOsError(refusal.code, refusal.detail);
      this.append("TASK_TRANSITIONED", actor, {taskId, tenantId: t.tenantId, from: t.status, to, reason: reason.slice(0, 1000)});
      return clone(this.state.tasks[taskId]);
    });
  }
  transitionMission(scope: Scope, missionId: string, to: MissionStatus, reason: string, actor: string): WorkMission {
    // REL-FX-1: COMPLETE hiçbir yoldan kanıt kapısını atlayamaz; store çağrısı da aynı birleşik yazıya yönlenir.
    if (to === "COMPLETE") return this.completeMission(scope, missionId, reason, actor).mission;
    return this.write(() => {
      const m = this.state.missions[missionId];
      if (!m || m.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
      if (typeof reason !== "string" || reason.trim().length === 0) throw new WorkOsError("WORKOS_INVALID_INPUT", "reason");
      try { assertTransition(m.status, to); } catch (e) { throw new WorkOsError("WORKOS_INVALID_TRANSITION", (e as Error).message); }
      this.append("MISSION_TRANSITIONED", actor, {missionId, from: m.status, to, reason: reason.slice(0, 1000)});
      return this.state.missions[missionId];
    });
  }

  // //TR: REL-FX-1 kanıta bağlı tamamlama: mission REPORTING olmalı, mission'ın EN SON run'ı AWAITING_APPROVAL olmalı ve run.headSha için REPORT + CLEAN REVIEW + BLOCKED olmayan
  // SECURITY_REPORT kanıtı bulunmalıdır. Tek journal girdisi (RUN_TRANSITION + gömülü mission hareketi) run'ı SUCCEEDED, mission'ı COMPLETE yapar; aksi halde 409 sabit sebep, journal değişmez.
  // D-M1A-STATE-MODEL-2026-10-15: ürün düzeyi COMPLETE ayrıca productVerification === PRODUCT_VERIFIED ister; hiçbir onay parametresi yoktur (M1a'da erişilemez).
  completeMission(scope: Scope, missionId: string, reason: string, actor: string): {mission: WorkMission; run: WorkRun} {
    if (typeof reason !== "string" || reason.trim().length === 0) throw new WorkOsError("WORKOS_INVALID_INPUT", "reason");
    return this.write(() => {
      const m = this.state.missions[missionId];
      if (!m || m.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
      try { assertTransition(m.status, "COMPLETE"); } catch (e) { throw new WorkOsError("WORKOS_INVALID_TRANSITION", (e as Error).message); }
      const runs = Object.values(this.state.runs).filter(r => r.missionId === missionId && r.tenantId === m.tenantId);
      const run = runs[runs.length - 1];
      const chk = completionEvidence(run, run?.evidence ?? []);
      if (!chk.ok) throw new WorkOsError("WORKOS_CONFLICT", chk.reason);
      const why = reason.slice(0, 1000);
      this.append("RUN_TRANSITION", actor, {runId: run.runId, leaseId: null, from: "AWAITING_APPROVAL", to: "SUCCEEDED", reason: `FOUNDER_ACCEPTED: ${why}`.slice(0, 1000),
        mission: {missionId, from: m.status, to: "COMPLETE", reason: why}, completion: chk.refs});
      return {mission: this.state.missions[missionId], run: clone(this.state.runs[run.runId])};
    });
  }
  // //TR: M1a c2 (Founder koşulu 1): SOURCE_GENERATION_COMPLETE run için deterministik teslim artefaktının kaydı (artefakt kilit dışında studio tarafından run.headSha'dan üretilir; burada kilit altında
  // kapı yeniden denetlenir ve kayıt run'a birebir bağlanır);
  // aynı kayıt zaten günceldiyse journal'a yeni girdi yazılmaz (yeniden hazırlama idempotent). Kabulden sonra yeni artefakt reddedilir (409 DELIVERY_ALREADY_ACCEPTED).
  recordDeliveryArtifact(scope: Scope, runId: string, rec: DeliveryArtifactRecord, actor: string): {record: DeliveryArtifactRecord; run: WorkRun; recorded: boolean} {
    return this.write(() => {
      const r = this.state.runs[runId];
      if (!r || r.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "run");
      const pre = deliveryPrepareCheck(r);
      if (!pre.ok) throw new WorkOsError("WORKOS_CONFLICT", pre.reason);
      if (!validDeliveryArtifactRecord(rec) || rec.runId !== r.runId || rec.missionId !== r.missionId || rec.sourceCommit !== r.headSha) throw new WorkOsError("WORKOS_INVALID_INPUT", "delivery record");
      const norm: DeliveryArtifactRecord = {runId: rec.runId, missionId: rec.missionId, sourceCommit: rec.sourceCommit, treeSha: rec.treeSha, exportArtifactHash: rec.exportArtifactHash, artifactPath: rec.artifactPath};
      if (r.deliveryArtifact && JSON.stringify(r.deliveryArtifact) === JSON.stringify(norm)) return {record: norm, run: clone(r), recorded: false};
      this.append("DELIVERY_ARTIFACT_PREPARED", actor, {...norm});
      return {record: norm, run: clone(this.state.runs[runId]), recorded: true};
    });
  }
  // //TR: M1a c2 (Founder koşulu 2): NOT_VERIFIED kaynak teslimi kabulü; kabul nesnesi güncel DELIVERY_ARTIFACT_PREPARED kaydı ve run ile birebir eşleşmeli ve tek kullanımlıktır.
  // Kayıt tek journal girdisidir (SOURCE_DELIVERY_ACCEPTED); mission REPORTING, run AWAITING_APPROVAL kalır, productVerification NOT_VERIFIED kalır (COMPLETE değildir). Aksi halde 409, journal değişmez.
  acceptSourceDelivery(scope: Scope, runId: string, acceptance: unknown, actor: string): {run: WorkRun; mission: WorkMission} {
    return this.write(() => {
      const r = this.state.runs[runId];
      if (!r || r.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "run");
      const m = this.state.missions[r.missionId];
      const chk = sourceDeliveryAcceptanceCheck({run: r, missionStatus: m?.status ?? null, latestRunId: this.latestRunId(this.state, r.missionId, r.tenantId)}, acceptance);
      if (!chk.ok) throw new WorkOsError("WORKOS_CONFLICT", chk.reason);
      const at = new Date().toISOString();
      this.append("SOURCE_DELIVERY_ACCEPTED", actor, {...chk.record, acceptedAt: at}, at);
      return {run: clone(this.state.runs[runId]), mission: clone(this.state.missions[r.missionId])};
    });
  }

  // ---- B3a worker runs (aynı journal, aynı lock, aynı hash zinciri) ----
  private nowIso(): string { return new Date(this.now()).toISOString(); }
  private missionMove(runMissionId: string, mv: RunWriteOptions["mission"]): Record<string, unknown> | undefined {
    if (!mv) return undefined;
    const m = this.state.missions[runMissionId];
    if (!m) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
    if (m.status === mv.to) return undefined; // idempotent yeniden giriş: hedefte zaten
    if (mv.to === "COMPLETE") throw new WorkOsError("WORKOS_CONFLICT", "COMPLETION_REQUIRES_EVIDENCE_GUARD");
    try { assertTransition(m.status, mv.to); } catch (e) { throw new WorkOsError("WORKOS_INVALID_TRANSITION", (e as Error).message); }
    return {missionId: runMissionId, from: m.status, to: mv.to, reason: String(mv.reason).slice(0, 1000)};
  }
  // Fencing: lease taşıyan run'a yalnız geçerli ve süresi dolmamış leaseId ile yazılabilir; bayat lease sahibi hiçbir şey yazamaz.
  private fencedRun(runId: string, leaseId: string | null): WorkRun {
    const r = this.state.runs[runId];
    if (!r) throw new WorkOsError("WORKOS_NOT_FOUND", "run");
    if (r.leaseId === null ? leaseId !== null : leaseId !== r.leaseId || Date.parse(r.leaseExpiresAt ?? "") <= this.now()) throw new WorkOsError("WORKOS_LEASE_FENCED", runId);
    return r;
  }
  private checkPatch(patch: RunPatch | undefined): void { if (patch !== undefined && !validRunPatch(patch)) throw new WorkOsError("WORKOS_INVALID_INPUT", "patch"); }
  createRunDetailed(input: CreateRunInput): WriteResult<WorkRun> {
    if (!isStr(input.executor?.implementer) || !isStr(input.executor?.reviewer) || input.executor.implementer === input.executor.reviewer)
      throw new WorkOsError("WORKOS_INVALID_INPUT", "EXECUTOR_IDENTITY_NOT_INDEPENDENT");
    return this.write(() => {
      const digest = sha256({missionId: input.missionId, roleId: input.roleId ?? null, executor: input.executor});
      const prior = this.findIdem(this.state.runs, input.tenantId, "run", input.idempotencyKey, digest);
      if (prior) return {entity: clone(prior), replayed: true};
      const mission = this.state.missions[input.missionId];
      if (!mission || mission.tenantId !== input.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
      if (mission.status !== "AUTHORIZED" && mission.status !== "PLANNED") throw new WorkOsError("WORKOS_CONFLICT", "MISSION_NOT_RUNNABLE");
      // REL-FX-3 (D-REL-2): R3/R4 run'ı Founder kararı ve OS sandbox olmadan oluşturulamaz; düzey yalnız mission kaydından okunur.
      if (!riskAdmitted(mission.riskLevel)) throw new WorkOsError("WORKOS_CONFLICT", RISK_REFUSAL);
      if (Object.values(this.state.runs).some(r => r.missionId === mission.missionId && isOpenRun(r.status))) throw new WorkOsError("WORKOS_CONFLICT", "RUN_ALREADY_ACTIVE");
      // PS-1A bütçe: budget.maxRuns projenin toplam run sayısını sınırlar (maxTokens yalnız kaydedilir; bu tabanda token ölçümü yoktur).
      const maxRuns = this.state.projects[mission.projectId]?.budget?.maxRuns;
      if (typeof maxRuns === "number" && Object.values(this.state.runs).filter(r => r.projectId === mission.projectId).length >= maxRuns) throw new WorkOsError("WORKOS_CONFLICT", "PROJECT_RUN_BUDGET_EXHAUSTED");
      const at = this.nowIso();
      const run: WorkRun = {
        runId: newId("run"), missionId: mission.missionId, projectId: mission.projectId, tenantId: mission.tenantId, roleId: input.roleId ?? null,
        executor: {implementer: input.executor.implementer, reviewer: input.executor.reviewer}, leaseId: null, leaseExpiresAt: null, attempt: 0,
        status: "CREATED", step: "WORKSPACE", remediationCycle: 0, retryCount: 0, retryAt: null, reason: null, baseSha: null, headSha: null, workBranch: null,
        checkpoints: [], evidence: [], createdAt: at, createdBy: input.createdBy, updatedAt: at
      };
      const mv = this.missionMove(mission.missionId, mission.status === "AUTHORIZED" ? {to: "PLANNED", reason: `run ${run.runId} created`} : undefined);
      this.append("RUN_CREATED", input.createdBy, {entity: run, ...(mv ? {mission: mv} : {}), ...this.idemFields(input.idempotencyKey, digest)});
      this.append("RUN_TRANSITION", input.createdBy, {runId: run.runId, leaseId: null, from: "CREATED", to: "QUEUED", reason: "queued for runner"});
      return {entity: clone(this.state.runs[run.runId]), replayed: false};
    });
  }
  createRun(input: CreateRunInput): WorkRun { return this.createRunDetailed(input).entity; }
  acquireRunLease(runId: string, ttlMs: number, actor: string): WorkRun {
    return this.write(() => {
      const r = this.state.runs[runId];
      if (!r) throw new WorkOsError("WORKOS_NOT_FOUND", "run");
      if (r.status !== "QUEUED" || r.leaseId !== null) throw new WorkOsError("WORKOS_LEASE_FENCED", runId);
      this.append("RUN_LEASE", actor, {runId, kind: "ACQUIRE", leaseId: newId("lse"), previousLeaseId: null, leaseExpiresAt: new Date(this.now() + ttlMs).toISOString()});
      return clone(this.state.runs[runId]);
    });
  }
  renewRunLease(runId: string, leaseId: string, ttlMs: number, actor: string): WorkRun {
    return this.write(() => {
      this.fencedRun(runId, leaseId);
      this.append("RUN_LEASE", actor, {runId, kind: "RENEW", leaseId, previousLeaseId: leaseId, leaseExpiresAt: new Date(this.now() + ttlMs).toISOString()});
      return clone(this.state.runs[runId]);
    });
  }
  // Recovery devri: yalnız süresi dolmuş lease devralınır; yeni leaseId eski sahibin bütün yazılarını fence eder.
  takeoverRunLease(runId: string, ttlMs: number, actor: string): WorkRun {
    return this.write(() => {
      const r = this.state.runs[runId];
      if (!r) throw new WorkOsError("WORKOS_NOT_FOUND", "run");
      if (r.leaseId === null || !LEASED_RUN_STATUSES.includes(r.status) || Date.parse(r.leaseExpiresAt ?? "") > this.now()) throw new WorkOsError("WORKOS_LEASE_FENCED", runId);
      this.append("RUN_LEASE", actor, {runId, kind: "TAKEOVER", leaseId: newId("lse"), previousLeaseId: r.leaseId, leaseExpiresAt: new Date(this.now() + ttlMs).toISOString()});
      return clone(this.state.runs[runId]);
    });
  }
  transitionRun(runId: string, leaseId: string | null, to: RunStatus, reason: string, actor: string, opts: RunWriteOptions = {}): WorkRun {
    this.checkPatch(opts.patch);
    return this.write(() => {
      const r = this.fencedRun(runId, leaseId);
      try { assertRunTransition(r.status, to); } catch (e) { throw new WorkOsError("WORKOS_INVALID_TRANSITION", (e as Error).message); }
      if (to === "SUCCEEDED") throw new WorkOsError("WORKOS_CONFLICT", "COMPLETION_REQUIRES_EVIDENCE_GUARD");
      const mv = this.missionMove(r.missionId, opts.mission);
      this.append("RUN_TRANSITION", actor, {runId, leaseId, from: r.status, to, reason: String(reason).slice(0, 1000), ...(opts.patch ? {patch: opts.patch} : {}), ...(mv ? {mission: mv} : {})});
      return clone(this.state.runs[runId]);
    });
  }
  checkpointRun(runId: string, leaseId: string, checkpoint: {step: RunStep; data: Record<string, unknown>}, actor: string, opts: RunWriteOptions = {}): WorkRun {
    this.checkPatch(opts.patch);
    return this.write(() => {
      const r = this.fencedRun(runId, leaseId);
      if (r.status !== "CHECKPOINTING") throw new WorkOsError("WORKOS_INVALID_TRANSITION", "checkpoint requires CHECKPOINTING");
      const mv = this.missionMove(r.missionId, opts.mission);
      const c: RunCheckpoint = {step: checkpoint.step, cycle: r.remediationCycle, at: this.nowIso(), data: checkpoint.data};
      this.append("RUN_CHECKPOINT", actor, {runId, leaseId, checkpoint: c, ...(opts.patch ? {patch: opts.patch} : {}), ...(mv ? {mission: mv} : {})});
      return clone(this.state.runs[runId]);
    });
  }
  addRunEvidence(runId: string, leaseId: string, evidence: Omit<RunEvidence, "evidenceId">, actor: string): RunEvidence {
    return this.write(() => {
      this.fencedRun(runId, leaseId);
      const ev: RunEvidence = {evidenceId: newId("evd"), ...evidence};
      this.append("RUN_EVIDENCE", actor, {runId, leaseId, evidence: ev});
      return clone(ev);
    });
  }
  getRun(scope: Scope, id: string): WorkRun | undefined { this.readGuard(); const r = this.state.runs[id]; return r && r.tenantId === scope.tenantId ? clone(r) : undefined; }
  listRuns(scope: Scope, missionId?: string): WorkRun[] {
    this.readGuard();
    return Object.values(this.state.runs).filter(r => r.tenantId === scope.tenantId && (missionId === undefined || r.missionId === missionId)).map(clone);
  }
  countActiveWorkerRuns(scope: Scope): number { this.readGuard(); return Object.values(this.state.runs).filter(r => r.tenantId === scope.tenantId && ACTIVE_WORKER_STATUSES.includes(r.status)).length; }
  // Engine-only (sistem aktörü) okumalar: tenant'lar arası run kuyruğunu görür; API yolları bunları kullanmaz.
  engineListRuns(): WorkRun[] { this.readGuard(); return Object.values(this.state.runs).map(clone); }
  engineGetRun(runId: string): WorkRun | undefined { this.readGuard(); const r = this.state.runs[runId]; return r ? clone(r) : undefined; }

  // ---- B11A Company OS: aynı journal, aynı lock, aynı hash zinciri; domain kuralları core/company altındadır ----
  // Yazma lock altında disk yeniden doğrulanarak yapılır; geçersiz işlem append'ten önce hata verir ve hiçbir şey yazmaz.
  companyWrite<T>(fn: (tx: CompanyTx) => T): T {
    return this.write(() => {
      const st = this.state;
      const tx: CompanyTx = {
        get records() { return st.company.records; }, get reversals() { return st.company.reversals; }, get invoiceSeq() { return st.company.invoiceSeq; },
        now: () => this.nowIso(), newId,
        idem: (kind, tenantId, key, digest) => this.findIdem<CompanyRecord>(st.company.records, tenantId, kind, key, digest),
        idemFields: (key, digest) => this.idemFields(key, digest),
        append: (type: CompanyJournalType, actor: string, payload: Record<string, unknown>) => { this.append(type, actor, payload); }
      };
      return fn(tx);
    });
  }
  companyRead<T>(fn: (view: CompanyView) => T): T { this.readGuard(); return fn(this.state.company); }

  // ---- WFR-04a Skill Academy: aynı journal, aynı lock, aynı hash zinciri; domain kuralları core/academy altındadır ----
  // Her academy girdisi önce state kopyası üzerinde replay kurallarıyla denenir; geçersiz girdi diske hiç yazılmaz (journal bozulamaz).
  academyWrite<T>(fn: (tx: AcademyTx) => T): T {
    return this.write(() => {
      const st = this.state;
      const tx: AcademyTx = {
        get sources() { return st.academy.sources; }, get learnings() { return st.academy.learnings; }, get reuses() { return st.academy.reuses; },
        now: () => this.nowIso(), newId,
        idem: (table, kind, tenantId, key, digest) => this.findIdem(table as Record<string, {tenantId: string}>, tenantId, kind, key, digest) as never,
        idemFields: (key, digest) => this.idemFields(key, digest),
        append: (type: AcademyJournalType, actor: string, payload: Record<string, unknown>, at?: string) => {
          // WFR04A-C1-F3: zaman bir kez belirlenir; ön-deneme ve kalıcı girdi aynı gövdeyi (aynı at) kullanır, saat sınırında yarış journal'ı bozamaz.
          const entryAt = at ?? this.nowIso();
          if (!Number.isFinite(Date.parse(entryAt))) throw new WorkOsError("WORKOS_INVALID_INPUT", "ACADEMY_ENTRY_REJECTED:AT");
          try { applyAcademyEntry(clone(st.academy), {seq: st.lastSeq + 1, type, at: entryAt, actor, payload}); } catch (e) {
            throw new WorkOsError("WORKOS_INVALID_INPUT", `ACADEMY_ENTRY_REJECTED:${(e as Error).message.replace(/^WORKOS_[A-Z_]+: /, "")}`);
          }
          this.append(type, actor, payload, entryAt);
        }
      };
      return fn(tx);
    });
  }
  academyRead<T>(fn: (view: AcademyView) => T): T { this.readGuard(); return fn(this.state.academy); }

  // ---- CORE pre-dev artefakt sözleşmeleri + PRE_DEV faz dizisi (aynı journal, aynı lock, aynı hash zinciri; replay kuralları core/workos/predev altındadır) ----
  // //TR: Her pre-dev girdisi önce state kopyası üzerinde replay kurallarıyla denenir (at bir kez belirlenir); geçersiz girdi diske hiç yazılmaz (journal bozulamaz). Mevcut mission lifecycle ve hiçbir mevcut kapı değiştirilmez: bu katman tamamen eklemeli ve geriye dönük uyumludur.
  private predevAppend(type: PreDevJournalType, actor: string, payload: Record<string, unknown>): void {
    const at = this.nowIso();
    try { applyPreDevEntry(clone(this.state.predev), {seq: this.state.lastSeq + 1, type, at, actor, payload}); }
    catch (e) { throw new WorkOsError("WORKOS_INVALID_INPUT", `PREDEV_ENTRY_REJECTED:${(e as Error).message.replace(/^WORKOS_[A-Z_]+: /, "")}`); }
    this.append(type, actor, payload, at);
  }
  private predevSequenceFor(tenantId: string, missionId: string): PreDevSequence | undefined {
    return Object.values(this.state.predev.sequences).find(q => q.missionId === missionId && q.tenantId === tenantId);
  }
  // //TR: Pre-dev isteği: mission için faz dizisini açar (mevcut path'i etkilemeyen ek katman). Yalnız pre-execution mission durumunda ve mission başına bir kez.
  openPreDevSequence(scope: Scope, missionId: string, createdBy: string, idempotencyKey?: string): PreDevSequence {
    return this.write(() => {
      const digest = sha256({missionId});
      const prior = this.findIdem(this.state.predev.sequences, scope.tenantId, "predev.sequence", idempotencyKey, digest);
      if (prior) return clone(prior);
      const m = this.state.missions[missionId];
      if (!m || m.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
      if (!PREDEV_OPEN_MISSION_STATUSES.includes(m.status)) throw new WorkOsError("WORKOS_CONFLICT", "MISSION_NOT_PREDEV_ELIGIBLE");
      if (this.predevSequenceFor(m.tenantId, missionId)) throw new WorkOsError("WORKOS_CONFLICT", "PREDEV_SEQUENCE_EXISTS");
      const at = this.nowIso();
      const seq: PreDevSequence = {preDevId: newId("pdv"), missionId, tenantId: m.tenantId, phase: "AUTHORIZED", artifacts: {}, createdAt: at, createdBy, updatedAt: at, lifecycleActors: [createdBy]};
      this.predevAppend("PREDEV_SEQUENCE_OPENED", createdBy, {entity: seq, ...this.idemFields(idempotencyKey, digest)});
      return clone(this.state.predev.sequences[seq.preDevId]);
    });
  }
  // //TR: Artefaktı DRAFT olarak kaydeder. Sürüm/supersedes store'da türetilir, replay'de yeniden doğrulanır. İçerik yalnız yapı+izlenebilirlik kapısından geçer (uydurma veri reddedilir).
  recordPreDevArtifact(scope: Scope, preDevId: string, input: {kind: ArtifactKind; authorRoleId: string; content: ArtifactContent; supersedes?: string | null; evidenceRefs?: string[]}, actor: string, idempotencyKey?: string): PreDevArtifact {
    return this.write(() => {
      const seq = this.state.predev.sequences[preDevId];
      if (!seq || seq.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "predev sequence");
      const prevId = seq.artifacts[input.kind];
      const prev = prevId ? this.state.predev.artifacts[prevId] : undefined;
      const supersedes = input.supersedes ?? null;
      const version = supersedes && prev ? prev.version + 1 : 1;
      const evidenceRefs = [...(input.evidenceRefs ?? [])];
      const digest = sha256({preDevId, kind: input.kind, version, authorRoleId: input.authorRoleId, supersedes, evidenceRefs, content: input.content});
      const prior = this.findIdem(this.state.predev.artifacts, scope.tenantId, "predev.artifact", idempotencyKey, digest);
      if (prior) return clone(prior);
      const at = this.nowIso();
      const art: PreDevArtifact = {id: newId("pda"), missionId: seq.missionId, tenantId: seq.tenantId, kind: input.kind, version, authorRoleId: input.authorRoleId,
        createdAt: at, state: "DRAFT", supersedes, evidenceRefs, content: input.content, recordedBy: actor, approvedBy: null, rejectedBy: null, updatedAt: at};
      this.predevAppend("PREDEV_ARTIFACT_RECORDED", actor, {preDevId, entity: art, ...this.idemFields(idempotencyKey, digest)});
      return clone(this.state.predev.artifacts[art.id]);
    });
  }
  // //TR: Artefakt durum geçişi (DRAFT->SUBMITTED->APPROVED|REJECTED). APPROVED yalnız kanıta bağlı (evidenceRefs boş olamaz) ve kaydedenden bağımsız aktörle olur.
  transitionPreDevArtifact(scope: Scope, preDevId: string, artifactId: string, to: ArtifactState, opts: {reason?: string; evidenceRefs?: string[]}, actor: string): PreDevArtifact {
    return this.write(() => {
      const art = this.state.predev.artifacts[artifactId];
      if (!art || art.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "predev artifact");
      const seq = this.state.predev.sequences[preDevId];
      if (!seq || seq.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "predev sequence");
      this.predevAppend("PREDEV_ARTIFACT_TRANSITIONED", actor, {preDevId, artifactId, tenantId: art.tenantId, from: art.state, to,
        ...(opts.reason !== undefined ? {reason: String(opts.reason).slice(0, 1000)} : {}), ...(opts.evidenceRefs !== undefined ? {evidenceRefs: [...opts.evidenceRefs]} : {})});
      return clone(this.state.predev.artifacts[artifactId]);
    });
  }
  // //TR: PRE_DEV fazını ilerletir. O ANKİ fazın artefaktı APPROVED değilse replay kapısı reddeder (advance only on APPROVED).
  advancePreDevPhase(scope: Scope, preDevId: string, to: PreDevPhase, actor: string): PreDevSequence {
    return this.write(() => {
      const seq = this.state.predev.sequences[preDevId];
      if (!seq || seq.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "predev sequence");
      this.predevAppend("PREDEV_PHASE_ADVANCED", actor, {preDevId, tenantId: seq.tenantId, from: seq.phase, to});
      return clone(this.state.predev.sequences[preDevId]);
    });
  }
  getPreDevSequence(scope: Scope, missionId: string): PreDevSequence | undefined { this.readGuard(); const s = this.predevSequenceFor(scope.tenantId, missionId); return s ? clone(s) : undefined; }
  getPreDevArtifact(scope: Scope, artifactId: string): PreDevArtifact | undefined { this.readGuard(); const a = this.state.predev.artifacts[artifactId]; return a && a.tenantId === scope.tenantId ? clone(a) : undefined; }
  listPreDevArtifacts(scope: Scope, preDevId: string): PreDevArtifact[] {
    this.readGuard();
    const seq = this.state.predev.sequences[preDevId];
    if (!seq || seq.tenantId !== scope.tenantId) return [];
    return Object.values(this.state.predev.artifacts).filter(a => a.tenantId === scope.tenantId && a.missionId === seq.missionId).map(clone);
  }
  // //TR: Kokpit-tüketilebilir salt-okunur özet: pre-dev fazı ve her artefaktın dürüst durumu (dizi yoksa NOT_STARTED). Render yoktur; yalnız okuma modeli alanları.
  preDevReadModel(scope: Scope, missionId: string): PreDevReadModel {
    this.readGuard();
    const seq = this.predevSequenceFor(scope.tenantId, missionId) ?? null;
    return derivePreDevReadModel(missionId, seq, this.state.predev.artifacts);
  }

  listProjects(scope: Scope): Project[] { this.readGuard(); return Object.values(this.state.projects).filter(p => p.tenantId === scope.tenantId); }
  getProject(scope: Scope, id: string): Project | undefined { this.readGuard(); const p = this.state.projects[id]; return p && p.tenantId === scope.tenantId ? p : undefined; }
  listMissions(scope: Scope, projectId?: string): WorkMission[] {
    this.readGuard();
    return Object.values(this.state.missions).filter(m => m.tenantId === scope.tenantId && (projectId === undefined || m.projectId === projectId));
  }
  getMission(scope: Scope, id: string): WorkMission | undefined { this.readGuard(); const m = this.state.missions[id]; return m && m.tenantId === scope.tenantId ? m : undefined; }
  getTask(scope: Scope, taskId: string): WorkTask | undefined { this.readGuard(); const t = this.state.tasks[taskId]; return t && t.tenantId === scope.tenantId ? clone(t) : undefined; }
  listTasks(scope: Scope, missionId: string): WorkTask[] { this.readGuard(); return Object.values(this.state.tasks).filter(t => t.tenantId === scope.tenantId && t.missionId === missionId); }
}
