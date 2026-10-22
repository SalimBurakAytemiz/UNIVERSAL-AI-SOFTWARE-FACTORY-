// //TR: Bu dosya SONLANMIŞ run'ların çalışma alanını (runs/<id>/work) YALNIZ arşivlendikten ve doğrulandıktan sonra, bekleme süresi dolunca siler (varsayılan KAPALI; açık bir bekleme süresi verilmedikçe hiçbir şey silinmez). Sıra: run sonlanmış + bekleme süresi dolmuş + proje yönetilen depolu -> run commit'i yönetilen depoya refs/uasco/runs/<runId> olarak arşivlenir (ProjectStudio.archiveRunObjects, çalışma alanının config/hook'ları yüklenmeden) -> arşiv ALTERNATES OLMADAN bağımsız doğrulanır -> denetim kaydı yazılır -> çalışma alanı silinir. Kanıt günlükleri, rapor ve journal asla silinmez. Yönetilen deposu olmayan projelerin (kullanıcının kendi deposu) çalışma alanı, commit'in başka yerde kopyası olmadığı için ASLA silinmez. Model/ağ/shell yok.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {TERMINAL_RUN_STATUSES} from "./run-state.js";
import type {Project, WorkRun} from "./types.js";

const RUN_ID = /^run_[0-9a-f]{24}$/;
export const RUN_ARCHIVE_RECORD = "workspace-archive.json";

// //TR: Dar portlar: WorkOsStore ve ProjectStudio bunları yapısal olarak karşılar (store.ts DEĞİŞMEZ).
export interface ArchiveStorePort { engineListRuns(): WorkRun[]; getProject(scope: {tenantId: string}, id: string): Project | undefined }
export interface ArchiveStudioPort {
  managedRepoRoot(project: Project): string;
  archiveRunObjects(project: Project, run: WorkRun): string;
  isRunArchived(project: Project, run: WorkRun): boolean;
}
export interface RunArchiveOptions { dataDir: string; store: ArchiveStorePort; studio: ArchiveStudioPort; retentionMs: number; now?: () => number }

export type RunArchiveStatus =
  | "PRUNED" | "PRUNED_NO_COMMIT"
  | "KEPT_NOT_TERMINAL" | "KEPT_RETENTION" | "KEPT_PROJECT_UNKNOWN" | "KEPT_NOT_MANAGED" | "KEPT_ARCHIVE_FAILED" | "KEPT_ARCHIVE_UNVERIFIED" | "KEPT_UNSAFE_PATH" | "KEPT_PRUNE_FAILED";
export interface RunArchiveResult { runId: string; status: RunArchiveStatus; detail?: string; archiveRef?: string }
export interface RunArchiveReport { results: RunArchiveResult[] }

// //TR: Bekleme süresi yapılandırması: UASCO_RUN_WORKSPACE_RETENTION_HOURS yalnız 1..8760 arası TAM sayı olabilir; tanımsız veya geçersiz = KAPALI (sessizce 0'a/varsayılana düşmez; neden döner).
export function retentionMsFromEnv(env: NodeJS.ProcessEnv): {enabled: true; retentionMs: number} | {enabled: false; reason: "NOT_CONFIGURED" | "INVALID"} {
  const raw = env.UASCO_RUN_WORKSPACE_RETENTION_HOURS;
  if (raw === undefined || raw === "") return {enabled: false, reason: "NOT_CONFIGURED"};
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return {enabled: false, reason: "INVALID"};
  const h = Number(raw);
  return h >= 1 && h <= 8760 ? {enabled: true, retentionMs: h * 3_600_000} : {enabled: false, reason: "INVALID"};
}

export class RunWorkspaceArchiver {
  private readonly now: () => number;
  constructor(private readonly o: RunArchiveOptions) {
    if (!Number.isFinite(o.retentionMs) || !Number.isInteger(o.retentionMs) || o.retentionMs < 0) throw new Error("RUN_ARCHIVE_RETENTION_INVALID");
    this.now = o.now ?? Date.now;
  }

  private runDir(runId: string): string | null {
    if (!RUN_ID.test(runId)) return null;
    const root = path.resolve(this.o.dataDir, "runs"), dir = path.resolve(root, runId), rel = path.relative(root, dir);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? dir : null;
  }
  private writeRecord(dir: string, rec: Record<string, unknown>): void {
    const digest = crypto.createHash("sha256").update(JSON.stringify(rec, null, 2)).digest("hex"); // kaydın (digest alanı hariç) sha256'sı
    const out = JSON.stringify({...rec, digest}, null, 2) + "\n";
    const tmp = path.join(dir, `${RUN_ARCHIVE_RECORD}.tmp`);
    fs.writeFileSync(tmp, out); fs.renameSync(tmp, path.join(dir, RUN_ARCHIVE_RECORD));
  }

  /** Bir geçişte uygun her run için (çalışma alanı hâlâ varsa) en fazla bir kez arşivler/siler; her run için dürüst bir sonuç döner. Hata fırlatmaz (run başına yakalanır). */
  sweep(): RunArchiveReport {
    const results: RunArchiveResult[] = [];
    for (const run of this.o.store.engineListRuns()) {
      const dir = this.runDir(run.runId);
      if (!dir) continue;
      const work = path.join(dir, "work");
      let st: fs.Stats;
      try { st = fs.lstatSync(work); } catch { continue; } // çalışma alanı yok: yapılacak bir şey yok
      try { results.push(this.one(run, dir, work, st)); }
      catch (e) { results.push({runId: run.runId, status: "KEPT_PRUNE_FAILED", detail: String((e as Error)?.message ?? e).slice(0, 120)}); }
    }
    return {results};
  }

  private one(run: WorkRun, dir: string, work: string, st: fs.Stats): RunArchiveResult {
    const id = run.runId;
    if (!TERMINAL_RUN_STATUSES.includes(run.status)) return {runId: id, status: "KEPT_NOT_TERMINAL", detail: run.status};
    const updated = Date.parse(run.updatedAt);
    if (!Number.isFinite(updated) || this.now() - updated < this.o.retentionMs) return {runId: id, status: "KEPT_RETENTION"};
    // work gerçek bir dizin olmalı (sembolik bağ/junction ise başka yere işaret edebilir): dokunulmaz.
    if (st.isSymbolicLink() || !st.isDirectory()) return {runId: id, status: "KEPT_UNSAFE_PATH"};
    const project = this.o.store.getProject({tenantId: run.tenantId}, run.projectId);
    if (!project) return {runId: id, status: "KEPT_PROJECT_UNKNOWN"};
    try { this.o.studio.managedRepoRoot(project); } catch { return {runId: id, status: "KEPT_NOT_MANAGED"}; }

    const archiveRef = `refs/uasco/runs/${id}`;
    if (run.headSha === null) {
      // Commit üretilmemiş: korunacak bir şey yok (kanıt günlükleri kalır). Yine de denetim kaydı yazılır.
      this.writeRecord(dir, {schemaVersion: 1, runId: id, status: run.status, headSha: null, archiveRef: null, archivedAt: null, prunedAt: null});
      this.prune(dir, work);
      this.writeRecord(dir, {schemaVersion: 1, runId: id, status: run.status, headSha: null, archiveRef: null, archivedAt: null, prunedAt: new Date(this.now()).toISOString()});
      return {runId: id, status: "PRUNED_NO_COMMIT"};
    }
    try { this.o.studio.archiveRunObjects(project, run); }
    catch (e) { return {runId: id, status: "KEPT_ARCHIVE_FAILED", detail: String((e as {code?: string; message?: string})?.code ?? (e as Error)?.message ?? e).slice(0, 80)}; }
    // Silmeden ÖNCE arşiv alternates olmadan bağımsız doğrulanır (ref == headSha, commit, erişilebilir her nesne yönetilen depoda).
    if (!this.o.studio.isRunArchived(project, run)) return {runId: id, status: "KEPT_ARCHIVE_UNVERIFIED"};
    const archivedAt = new Date(this.now()).toISOString();
    this.writeRecord(dir, {schemaVersion: 1, runId: id, status: run.status, headSha: run.headSha, archiveRef, archivedAt, prunedAt: null});
    this.prune(dir, work);
    this.writeRecord(dir, {schemaVersion: 1, runId: id, status: run.status, headSha: run.headSha, archiveRef, archivedAt, prunedAt: new Date(this.now()).toISOString()});
    return {runId: id, status: "PRUNED", archiveRef};
  }

  private prune(dir: string, work: string): void {
    const rel = path.relative(dir, work);
    if (rel !== "work") throw new Error("RUN_PATH_ESCAPE");
    fs.rmSync(work, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
    if (fs.existsSync(work)) throw new Error("WORKSPACE_NOT_REMOVED");
  }
}
