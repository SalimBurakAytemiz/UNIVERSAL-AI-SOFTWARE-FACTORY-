// //TR: Bu dosya Work OS kanonik store'unu uygular: append-only hash zincirli JSONL journal tek otoritedir, snapshot journal'dan türetilir; bozuk zincir fail-closed olur ve yazmayı reddeder.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// //TR: automation/lib korumalı olduğundan atomic-json.mjs için .d.mts eklenemez; yeniden kullanılan helper dar bir yerel tiple bağlanır, kopyalanmaz.
// @ts-expect-error TS7016: atomic-json.mjs tip bildirimi yok
import {sha256 as sha256Untyped, writeJsonAtomic as writeJsonAtomicUntyped} from "../../automation/lib/atomic-json.mjs";
import {assertTransition, isMissionStatus} from "../mission/state-machine.js";
import type {MissionStatus} from "../mission/types.js";
import {WorkOsError} from "./types.js";
import type {JournalEntry, JournalType, Project, RiskLevel, Scope, TaskStatus, WorkMission, WorkTask} from "./types.js";

const sha256 = sha256Untyped as (value: unknown) => string;
const writeJsonAtomic = writeJsonAtomicUntyped as (file: string, value: unknown) => void;
const GENESIS = "0".repeat(64);
const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
export const newTraceId = () => newId("trc");

interface State {
  projects: Record<string, Project>; missions: Record<string, WorkMission>; tasks: Record<string, WorkTask>;
  idempotency: Record<string, string>; lastSeq: number; lastHash: string;
}
const emptyState = (): State => ({projects: {}, missions: {}, tasks: {}, idempotency: {}, lastSeq: 0, lastHash: GENESIS});
const entryHash = (body: Omit<JournalEntry, "hash">): string => sha256(body);
const idemKey = (tenantId: string, kind: string, key: string) => `${tenantId}|${kind}|${key}`;
const tampered = (detail: string) => new WorkOsError("WORKOS_JOURNAL_TAMPERED", detail);

export function defaultDataDir(repoRoot: string = process.cwd()): string {
  return process.env.UASCO_DATA_DIR ? path.resolve(process.env.UASCO_DATA_DIR) : path.join(repoRoot, ".ai", "workos");
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

export class WorkOsStore {
  readonly dataDir: string; readonly journalFile: string; readonly snapshotFile: string;
  private state: State = emptyState();
  private tamperReason: string | null = null;

  constructor(dataDir: string = defaultDataDir()) {
    this.dataDir = dataDir;
    this.journalFile = path.join(dataDir, "journal.jsonl");
    this.snapshotFile = path.join(dataDir, "snapshot.json");
    this.load();
  }

  get isTampered(): boolean { return this.tamperReason !== null; }
  get lastSeq(): number { return this.state.lastSeq; }

  // Journal tek otoritedir: zinciri baştan doğrular ve state'i yeniden oynatır.
  private load(): void {
    this.tamperReason = null; this.state = emptyState();
    try {
      const entries = this.readVerifiedEntries();
      const st = emptyState();
      for (const e of entries) this.apply(st, e);
      this.checkSnapshotAgainst(entries);
      this.state = st;
      this.writeSnapshot();
    } catch (e) {
      if (e instanceof WorkOsError && e.code === "WORKOS_JOURNAL_TAMPERED") { this.tamperReason = e.message; this.state = emptyState(); return; }
      throw e;
    }
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
    const p = e.payload as any;
    switch (e.type) {
      case "PROJECT_CREATED": st.projects[p.entity.projectId] = p.entity; if (p.idempotencyKey) st.idempotency[idemKey(p.entity.tenantId, "project", p.idempotencyKey)] = p.entity.projectId; break;
      case "MISSION_CREATED": st.missions[p.entity.missionId] = p.entity; if (p.idempotencyKey) st.idempotency[idemKey(p.entity.tenantId, "mission", p.idempotencyKey)] = p.entity.missionId; break;
      case "TASK_CREATED": st.tasks[p.entity.taskId] = p.entity; if (p.idempotencyKey) st.idempotency[idemKey(p.entity.tenantId, "task", p.idempotencyKey)] = p.entity.taskId; break;
      case "MISSION_TRANSITIONED": {
        const m = st.missions[p.missionId];
        if (!m || m.status !== p.from || !isMissionStatus(p.to)) throw tampered(`TRANSITION_INCONSISTENT:${e.seq}`);
        try { assertTransition(m.status, p.to); } catch { throw tampered(`TRANSITION_ILLEGAL:${e.seq}`); }
        m.status = p.to; break;
      }
      default: throw tampered(`UNKNOWN_TYPE:${e.seq}`);
    }
    st.lastSeq = e.seq; st.lastHash = e.hash;
  }
  private guard(): void { if (this.tamperReason) throw new WorkOsError("WORKOS_JOURNAL_TAMPERED", this.tamperReason.replace(/^WORKOS_JOURNAL_TAMPERED: /, "")); }
  // Her yazıdan önce disk yeniden doğrulanır: başka bir örnek veya dış değişiklik varsa fail-closed.
  private beginWrite(): void { this.guard(); this.load(); this.guard(); }
  private append(type: JournalType, actor: string, payload: Record<string, unknown>): JournalEntry {
    const body = {seq: this.state.lastSeq + 1, prevHash: this.state.lastHash, type, actor, at: new Date().toISOString(), payload};
    const entry: JournalEntry = {...body, hash: entryHash(body)};
    fs.mkdirSync(this.dataDir, {recursive: true});
    const fd = fs.openSync(this.journalFile, "a");
    try { fs.writeSync(fd, JSON.stringify(entry) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.apply(this.state, entry);
    this.writeSnapshot();
    return entry;
  }
  private findIdem<T>(table: Record<string, T>, tenantId: string, kind: string, key?: string): T | undefined {
    if (!key) return undefined;
    const id = this.state.idempotency[idemKey(tenantId, kind, key)];
    return id ? table[id] : undefined;
  }

  createProject(input: CreateProjectInput): Project {
    this.beginWrite();
    const prior = this.findIdem(this.state.projects, input.tenantId, "project", input.idempotencyKey);
    if (prior) return prior;
    const project: Project = {
      projectId: newId("prj"), orgId: input.orgId, tenantId: input.tenantId, ...(input.customerId ? {customerId: input.customerId} : {}),
      name: input.name, ...(input.repository ? {repository: input.repository} : {}), environmentId: input.environmentId,
      createdAt: new Date().toISOString(), createdBy: input.createdBy
    };
    this.append("PROJECT_CREATED", input.createdBy, {entity: project, ...(input.idempotencyKey ? {idempotencyKey: input.idempotencyKey} : {})});
    return project;
  }
  createMission(input: CreateMissionInput): WorkMission {
    this.beginWrite();
    const prior = this.findIdem(this.state.missions, input.tenantId, "mission", input.idempotencyKey);
    if (prior) return prior;
    const project = this.state.projects[input.projectId];
    if (!project || project.tenantId !== input.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "project");
    const mission: WorkMission = {
      missionId: newId("msn"), projectId: input.projectId, tenantId: input.tenantId, title: input.title, objective: input.objective,
      acceptanceCriteria: [...input.acceptanceCriteria], riskLevel: input.riskLevel, status: "DRAFT",
      createdAt: new Date().toISOString(), createdBy: input.createdBy, traceId: newTraceId()
    };
    this.append("MISSION_CREATED", input.createdBy, {entity: mission, ...(input.idempotencyKey ? {idempotencyKey: input.idempotencyKey} : {})});
    return mission;
  }
  createTask(input: CreateTaskInput): WorkTask {
    this.beginWrite();
    const prior = this.findIdem(this.state.tasks, input.tenantId, "task", input.idempotencyKey);
    if (prior) return prior;
    const mission = this.state.missions[input.missionId];
    if (!mission || mission.tenantId !== input.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
    const dependsOn = [...(input.dependsOn ?? [])];
    for (const d of dependsOn) { const t = this.state.tasks[d]; if (!t || t.missionId !== mission.missionId) throw new WorkOsError("WORKOS_INVALID_INPUT", `dependsOn:${d}`); }
    const task: WorkTask = {taskId: newId("tsk"), missionId: mission.missionId, projectId: mission.projectId, tenantId: mission.tenantId, title: input.title, status: input.status ?? "PENDING", dependsOn};
    this.append("TASK_CREATED", input.actor, {entity: task, ...(input.idempotencyKey ? {idempotencyKey: input.idempotencyKey} : {})});
    return task;
  }
  transitionMission(scope: Scope, missionId: string, to: MissionStatus, reason: string, actor: string): WorkMission {
    this.beginWrite();
    const m = this.state.missions[missionId];
    if (!m || m.tenantId !== scope.tenantId) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
    if (typeof reason !== "string" || reason.trim().length === 0) throw new WorkOsError("WORKOS_INVALID_INPUT", "reason");
    try { assertTransition(m.status, to); } catch (e) { throw new WorkOsError("WORKOS_INVALID_TRANSITION", (e as Error).message); }
    this.append("MISSION_TRANSITIONED", actor, {missionId, from: m.status, to, reason: reason.slice(0, 1000)});
    return this.state.missions[missionId];
  }

  listProjects(scope: Scope): Project[] { this.guard(); return Object.values(this.state.projects).filter(p => p.tenantId === scope.tenantId); }
  getProject(scope: Scope, id: string): Project | undefined { this.guard(); const p = this.state.projects[id]; return p && p.tenantId === scope.tenantId ? p : undefined; }
  listMissions(scope: Scope, projectId?: string): WorkMission[] {
    this.guard();
    return Object.values(this.state.missions).filter(m => m.tenantId === scope.tenantId && (projectId === undefined || m.projectId === projectId));
  }
  getMission(scope: Scope, id: string): WorkMission | undefined { this.guard(); const m = this.state.missions[id]; return m && m.tenantId === scope.tenantId ? m : undefined; }
  listTasks(scope: Scope, missionId: string): WorkTask[] { this.guard(); return Object.values(this.state.tasks).filter(t => t.tenantId === scope.tenantId && t.missionId === missionId); }
}
