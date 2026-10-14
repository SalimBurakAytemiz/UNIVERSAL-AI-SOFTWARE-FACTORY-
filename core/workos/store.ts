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
import {WorkOsError, urlHasUserinfo} from "./types.js";
import type {JournalEntry, JournalType, Project, RiskLevel, Scope, TaskStatus, WorkMission, WorkTask} from "./types.js";

const sha256 = sha256Untyped as (value: unknown) => string;
const writeJsonAtomic = writeJsonAtomicUntyped as (file: string, value: unknown) => void;
const LOCK_WAIT_MS = 10_000;
const GENESIS = "0".repeat(64);
const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
export const newTraceId = () => newId("trc");

interface IdemRecord { id: string; digest?: string }
interface State {
  projects: Record<string, Project>; missions: Record<string, WorkMission>; tasks: Record<string, WorkTask>;
  idempotency: Record<string, IdemRecord>; lastSeq: number; lastHash: string;
}
const emptyState = (): State => ({projects: {}, missions: {}, tasks: {}, idempotency: {}, lastSeq: 0, lastHash: GENESIS});
const entryHash = (body: Omit<JournalEntry, "hash">): string => sha256(body);
// //TR: F-B1-001: anahtar JSON dizisidir; ayırıcı karakter içeren tenant/anahtar değerleri çarpışamaz.
const idemKey = (tenantId: string, kind: string, key: string) => JSON.stringify([tenantId, kind, key]);
const tampered = (detail: string) => new WorkOsError("WORKOS_JOURNAL_TAMPERED", detail);
const malformed = (detail: string) => new WorkOsError("WORKOS_UNAVAILABLE", detail);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const sleepSync = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

export function defaultDataDir(repoRoot: string = process.cwd()): string {
  return process.env.UASCO_DATA_DIR ? path.resolve(process.env.UASCO_DATA_DIR) : path.join(repoRoot, ".ai", "runtime", "workos");
}

export interface CreateProjectInput {
  tenantId: string; orgId: string; customerId?: string; name: string; repository?: {path?: string; url?: string};
  environmentId: string; createdBy: string; idempotencyKey?: string;
}
export interface CreateMissionInput {
  tenantId: string; projectId: string; title: string; objective: string; acceptanceCriteria: string[];
  riskLevel: RiskLevel; createdBy: string; idempotencyKey?: string;
}
export interface CreateTaskInput {
  tenantId: string; missionId: string; title: string; dependsOn?: string[]; status?: TaskStatus; actor: string; idempotencyKey?: string;
}

export interface WriteResult<T> { entity: T; replayed: boolean }

export class WorkOsStore {
  readonly dataDir: string; readonly journalFile: string; readonly snapshotFile: string; readonly lockFile: string;
  private state: State = emptyState();
  private tamperReason: string | null = null;
  // F-B1-002: IO/format hataları da fail-closed bayrağı kurar; guard() okuma ve yazmayı reddeder.
  private unavailableReason: string | null = null;
  private sig: string | null = null;

  constructor(dataDir: string = defaultDataDir()) {
    this.dataDir = dataDir;
    this.journalFile = path.join(dataDir, "journal.jsonl");
    this.snapshotFile = path.join(dataDir, "snapshot.json");
    this.lockFile = path.join(dataDir, "journal.lock");
    this.refresh();
  }

  get isTampered(): boolean { this.refresh(); return this.tamperReason !== null; }
  get isUnavailable(): boolean { this.refresh(); return this.unavailableReason !== null; }
  get hasJournal(): boolean { return fs.existsSync(this.journalFile); }
  get lastSeq(): number { this.refresh(); return this.state.lastSeq; }

  // Journal dosyasının parmak izi: başka bir örnek/süreç yazınca veya dosya değişince okuma yeniden doğrular (bayat veri sessizce sunulmaz).
  private signature(): string {
    try { const st = fs.statSync(this.journalFile); return `${st.size}:${st.mtimeMs}:${st.ino}`; } catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? "ABSENT" : `ERR:${(e as NodeJS.ErrnoException).code ?? "?"}`; }
  }
  // F-B1-006: journal append ve doğrulamalı yükleme süreçler arası tek lock ile serileşir (process-lock.mjs yeniden kullanılır).
  private withLock<T>(fn: () => T): T {
    const runId = `workos-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const deadline = Date.now() + LOCK_WAIT_MS; let release: (() => void) | null = null;
    for (;;) {
      try { release = acquireProcessLock(this.lockFile, runId); break; } catch {
        if (Date.now() >= deadline) throw new WorkOsError("WORKOS_UNAVAILABLE", "LOCK_TIMEOUT");
        sleepSync(15);
      }
    }
    try { return fn(); } finally { try { release?.(); } catch { /* lock sahipliği değişmişse yazma zaten tamamlandı */ } }
  }
  private fail(e: unknown): void {
    this.sig = null;
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
      const entries = this.readVerifiedEntries();
      const st = emptyState();
      for (const e of entries) this.apply(st, e);
      this.checkSnapshotAgainst(entries);
      this.state = st; this.tamperReason = null; this.unavailableReason = null; this.sig = sigBefore;
      if (entries.length > 0) this.writeSnapshot();
    } catch (e) { this.fail(e); }
  }
  private readVerifiedEntries(): JournalEntry[] {
    if (!fs.existsSync(this.journalFile)) return [];
    const raw = fs.readFileSync(this.journalFile, "utf8");
    if (raw.length > 0 && !raw.endsWith("\n")) throw tampered("JOURNAL_TRUNCATED_LINE");
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
    return out;
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
      case "MISSION_TRANSITIONED": {
        if (!isStr(p.missionId)) throw malformed(`TRANSITION_SHAPE:${e.seq}`);
        const m = st.missions[p.missionId];
        if (!m || m.status !== p.from || !isMissionStatus(p.to)) throw tampered(`TRANSITION_INCONSISTENT:${e.seq}`);
        try { assertTransition(m.status, p.to); } catch { throw tampered(`TRANSITION_ILLEGAL:${e.seq}`); }
        m.status = p.to; break;
      }
      default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
    }
    st.lastSeq = e.seq; st.lastHash = e.hash;
  }
  private guard(): void {
    if (this.tamperReason) throw new WorkOsError("WORKOS_JOURNAL_TAMPERED", this.tamperReason.replace(/^WORKOS_JOURNAL_TAMPERED: /, ""));
    if (this.unavailableReason) throw new WorkOsError("WORKOS_UNAVAILABLE", this.unavailableReason);
  }
  private readGuard(): void { this.refresh(); this.guard(); }
  // Her yazı lock altında disk yeniden doğrulanarak yapılır: başka örnek/süreç yazdıysa onun yazıları görülür, bozuk disk fail-closed.
  private write<T>(fn: () => T): T {
    return this.withLock(() => { this.load(); this.guard(); return fn(); });
  }
  private append(type: JournalType, actor: string, payload: Record<string, unknown>): JournalEntry {
    const body = {seq: this.state.lastSeq + 1, prevHash: this.state.lastHash, type, actor, at: new Date().toISOString(), payload};
    const entry: JournalEntry = {...body, hash: entryHash(body)};
    fs.mkdirSync(this.dataDir, {recursive: true});
    const fd = fs.openSync(this.journalFile, "a");
    try { fs.writeSync(fd, JSON.stringify(entry) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.apply(this.state, entry);
    this.sig = this.signature();
    this.writeSnapshot();
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
      const digest = sha256({orgId: input.orgId, customerId: input.customerId ?? null, name: input.name, repository: input.repository ?? null, environmentId: input.environmentId});
      const prior = this.findIdem(this.state.projects, input.tenantId, "project", input.idempotencyKey, digest);
      if (prior) return {entity: prior, replayed: true};
      const project: Project = {
        projectId: newId("prj"), orgId: input.orgId, tenantId: input.tenantId, ...(input.customerId ? {customerId: input.customerId} : {}),
        name: input.name, ...(input.repository ? {repository: input.repository} : {}), environmentId: input.environmentId,
        createdAt: new Date().toISOString(), createdBy: input.createdBy
      };
      this.append("PROJECT_CREATED", input.createdBy, {entity: project, ...this.idemFields(input.idempotencyKey, digest)});
      return {entity: project, replayed: false};
    });
  }
  createProject(input: CreateProjectInput): Project { return this.createProjectDetailed(input).entity; }
  createMissionDetailed(input: CreateMissionInput): WriteResult<WorkMission> {
    return this.write(() => {
      const digest = sha256({projectId: input.projectId, title: input.title, objective: input.objective, acceptanceCriteria: input.acceptanceCriteria, riskLevel: input.riskLevel});
      const prior = this.findIdem(this.state.missions, input.tenantId, "mission", input.idempotencyKey, digest);
      if (prior) return {entity: prior, replayed: true};
      const project = this.state.projects[input.projectId];
      if (!project || project.tenantId !== input.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "project");
      const mission: WorkMission = {
        missionId: newId("msn"), projectId: input.projectId, tenantId: input.tenantId, title: input.title, objective: input.objective,
        acceptanceCriteria: [...input.acceptanceCriteria], riskLevel: input.riskLevel, status: "DRAFT",
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
  transitionMission(scope: Scope, missionId: string, to: MissionStatus, reason: string, actor: string): WorkMission {
    return this.write(() => {
      const m = this.state.missions[missionId];
      if (!m || m.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
      if (typeof reason !== "string" || reason.trim().length === 0) throw new WorkOsError("WORKOS_INVALID_INPUT", "reason");
      try { assertTransition(m.status, to); } catch (e) { throw new WorkOsError("WORKOS_INVALID_TRANSITION", (e as Error).message); }
      this.append("MISSION_TRANSITIONED", actor, {missionId, from: m.status, to, reason: reason.slice(0, 1000)});
      return this.state.missions[missionId];
    });
  }

  listProjects(scope: Scope): Project[] { this.readGuard(); return Object.values(this.state.projects).filter(p => p.tenantId === scope.tenantId); }
  getProject(scope: Scope, id: string): Project | undefined { this.readGuard(); const p = this.state.projects[id]; return p && p.tenantId === scope.tenantId ? p : undefined; }
  listMissions(scope: Scope, projectId?: string): WorkMission[] {
    this.readGuard();
    return Object.values(this.state.missions).filter(m => m.tenantId === scope.tenantId && (projectId === undefined || m.projectId === projectId));
  }
  getMission(scope: Scope, id: string): WorkMission | undefined { this.readGuard(); const m = this.state.missions[id]; return m && m.tenantId === scope.tenantId ? m : undefined; }
  listTasks(scope: Scope, missionId: string): WorkTask[] { this.readGuard(); return Object.values(this.state.tasks).filter(t => t.tenantId === scope.tenantId && t.missionId === missionId); }
}
