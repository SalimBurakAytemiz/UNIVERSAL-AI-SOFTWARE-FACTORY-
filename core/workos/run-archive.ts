// //TR: Bu dosya SONLANMIŞ run'ların çalışma alanını (runs/<id>/work) YALNIZ arşivlendikten ve doğrulandıktan sonra, bekleme süresi dolunca siler (varsayılan KAPALI; açık bir bekleme süresi verilmedikçe hiçbir şey silinmez). Sıra: run sonlanmış + bekleme süresi dolmuş + proje yönetilen depolu + secret bulgusu YOK -> run'ın KAYITLI commit kümesi (headSha + IMPLEMENT kanıtlarının commitSha'ları) yönetilen depoya arşivlenir (ProjectStudio.archiveRunCommit, çalışma alanının config/hook'ları yüklenmeden) -> her arşiv ALTERNATES OLMADAN bağımsız doğrulanır -> denetim kaydı yazılır -> türetilmiş klon dizinleri ve çalışma alanı silinir. Kanıt günlükleri, güvenlik raporları, rapor ve journal asla silinmez. Yönetilen deposu olmayan projelerin (kullanıcının kendi deposu) ve secret bulgulu run'ların çalışma alanı ASLA otomatik silinmez. Her geçişteki iş sınırlıdır (event loop'u uzun süre tutmaz). Model/ağ/shell yok.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {TERMINAL_RUN_STATUSES} from "./run-state.js";
import type {Project, WorkRun} from "./types.js";

const RUN_ID = /^run_[0-9a-f]{24}$/;
const SHA = /^[0-9a-f]{40}$/;
export const RUN_ARCHIVE_RECORD = "workspace-archive.json";
// //TR: Runner'ın work'ten türettiği tek kullanımlık TAM klon dizinleri (her kullanımdan önce yeniden kurulur); work ile birlikte silinir. security/ (raporlar) ve logs/ ASLA silinmez.
const DERIVED_CLONE_DIRS = /^(?:scan-c\d+|review-c\d+|security-c\d+|security-gl-c\d+\.git)$/;

// //TR: Dar portlar: WorkOsStore ve ProjectStudio bunları yapısal olarak karşılar (store.ts DEĞİŞMEZ).
export interface ArchiveStorePort { engineListRuns(): WorkRun[]; getProject(scope: {tenantId: string}, id: string): Project | undefined }
export interface ArchiveStudioPort {
  managedRepoRoot(project: Project): string;
  archiveRunCommit(project: Project, run: WorkRun, sha: string, ref: string): void;
  isRunCommitArchived(project: Project, run: WorkRun, sha: string, ref: string): boolean;
}
export interface RunArchiveOptions {
  dataDir: string; store: ArchiveStorePort; studio: ArchiveStudioPort; retentionMs: number; now?: () => number;
  /** Bir geçişte arşivlenip/silinen en çok run sayısı (varsayılan 3): senkron git/fs işi event loop'u ve runner lease'lerini uzun süre bloklamasın. */
  maxRunsPerSweep?: number;
  /** Başarısız bir run'ın yeniden denenmeden önce beklenen süre (varsayılan 1 saat; süreç içi). */
  retryBackoffMs?: number;
}

export type RunArchiveStatus =
  | "PRUNED" | "PRUNED_NO_COMMIT" | "RECORD_FINALIZED"
  | "KEPT_NOT_TERMINAL" | "KEPT_RETENTION" | "KEPT_PROJECT_UNKNOWN" | "KEPT_NOT_MANAGED" | "KEPT_SECRET_FINDING"
  | "KEPT_ARCHIVE_FAILED" | "KEPT_ARCHIVE_UNVERIFIED" | "KEPT_UNSAFE_PATH" | "KEPT_PRUNE_FAILED" | "KEPT_BACKOFF";
export interface RunArchiveResult { runId: string; status: RunArchiveStatus; detail?: string; archiveRef?: string }
export interface RunArchiveReport { results: RunArchiveResult[]; deferred: number; error?: string }
interface ArchivedCommit { sha: string; ref: string }

// //TR: Bekleme süresi yapılandırması: UASCO_RUN_WORKSPACE_RETENTION_HOURS yalnız 1..8760 arası TAM sayı olabilir; tanımsız veya geçersiz = KAPALI (sessizce 0'a/varsayılana düşmez; neden döner).
export function retentionMsFromEnv(env: NodeJS.ProcessEnv): {enabled: true; retentionMs: number} | {enabled: false; reason: "NOT_CONFIGURED" | "INVALID"} {
  const raw = env.UASCO_RUN_WORKSPACE_RETENTION_HOURS;
  if (raw === undefined || raw === "") return {enabled: false, reason: "NOT_CONFIGURED"};
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return {enabled: false, reason: "INVALID"};
  const h = Number(raw);
  return h >= 1 && h <= 8760 ? {enabled: true, retentionMs: h * 3_600_000} : {enabled: false, reason: "INVALID"};
}

// //TR: Run'ın KAYITLI commit kümesi: headSha + IMPLEMENT/diğer kanıtların commitSha'ları (engine'in kendi journal kaydı). headSha yalnız başarılı IMPLEMENT sonunda yazılır; TASK_LIMIT_FILES_EXCEEDED, IMPLEMENT_COMMIT_MISMATCH gibi BLOCK yollarında veya başarısız bir remediation döngüsünde commit YALNIZ kanıtta ve çalışma alanında bulunur: yalnız headSha'yı arşivlemek o commit'in tek kopyasını silerdi.
export function recordedCommitSet(run: WorkRun): string[] {
  const out: string[] = [];
  for (const c of [run.headSha, ...run.evidence.map(e => e.commitSha)]) if (typeof c === "string" && SHA.test(c) && !out.includes(c)) out.push(c);
  return out;
}
// //TR: Secret bulgulu run: nesneleri yönetilen depoya girerse sonraki her çalışma alanı klonuna (git clone depoyu nesne dizini dahil kopyalar) taşınır; bu yüzden bu run'lar ARŞİVLENMEZ ve çalışma alanları otomatik SİLİNMEZ (operatör elle ele alır).
export function hasSecretFinding(run: WorkRun): boolean {
  if (typeof run.reason === "string" && /^SECRET/i.test(run.reason)) return true;
  return run.evidence.some(e => (e.secretHits?.length ?? 0) > 0 || e.security?.blockReason === "SECRET_DETECTED" || (e.security?.secrets?.builtin?.hits ?? 0) > 0 || (e.security?.secrets?.gitleaks?.findings ?? 0) > 0);
}

export class RunWorkspaceArchiver {
  private readonly now: () => number;
  private readonly maxRuns: number;
  private readonly backoffMs: number;
  private readonly failedAt = new Map<string, number>();
  private readonly finalized = new Set<string>();
  constructor(private readonly o: RunArchiveOptions) {
    if (!Number.isFinite(o.retentionMs) || !Number.isInteger(o.retentionMs) || o.retentionMs < 0) throw new Error("RUN_ARCHIVE_RETENTION_INVALID");
    this.maxRuns = o.maxRunsPerSweep ?? 3;
    this.backoffMs = o.retryBackoffMs ?? 3_600_000;
    if (!Number.isInteger(this.maxRuns) || this.maxRuns < 1 || !Number.isInteger(this.backoffMs) || this.backoffMs < 0) throw new Error("RUN_ARCHIVE_LIMITS_INVALID");
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
  private readRecord(dir: string): Record<string, unknown> | null {
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, RUN_ARCHIVE_RECORD), "utf8")); return j && typeof j === "object" ? j as Record<string, unknown> : null; } catch { return null; }
  }

  /** Bir geçişte en çok maxRunsPerSweep run için arşivler/siler; her run için dürüst bir sonuç döner. Hata fırlatmaz (store hatası dahil report.error olur). */
  sweep(): RunArchiveReport {
    const results: RunArchiveResult[] = [];
    let heavy = 0, deferred = 0, runs: WorkRun[];
    try { runs = this.o.store.engineListRuns(); } catch (e) { return {results, deferred, error: `STORE_UNAVAILABLE:${String((e as Error)?.message ?? e).slice(0, 80)}`}; }
    for (const run of runs) {
      const dir = this.runDir(run.runId);
      if (!dir) continue;
      const work = path.join(dir, "work");
      let st: fs.Stats | null = null;
      try { st = fs.lstatSync(work); } catch { /* çalışma alanı yok */ }
      if (!st) {
        const fin = this.finalizeIfNeeded(run, dir);
        if (fin) results.push(fin);
        continue;
      }
      const failed = this.failedAt.get(run.runId);
      if (failed !== undefined && this.now() - failed < this.backoffMs) { results.push({runId: run.runId, status: "KEPT_BACKOFF"}); continue; }
      const pre = this.eligibility(run, st);
      if (pre) { results.push(pre); continue; }
      if (heavy >= this.maxRuns) { deferred += 1; continue; }
      heavy += 1;
      let r: RunArchiveResult;
      try { r = this.archiveAndPrune(run, dir, work); }
      catch (e) { r = {runId: run.runId, status: "KEPT_PRUNE_FAILED", detail: String((e as Error)?.message ?? e).slice(0, 120)}; }
      if (r.status.startsWith("KEPT_")) this.failedAt.set(run.runId, this.now()); else this.failedAt.delete(run.runId);
      results.push(r);
    }
    return {results, deferred};
  }

  // Yalnız hafif, yan etkisiz kontroller: ağır iş (git/rm) yok.
  private eligibility(run: WorkRun, st: fs.Stats): RunArchiveResult | null {
    const id = run.runId;
    if (!TERMINAL_RUN_STATUSES.includes(run.status)) return {runId: id, status: "KEPT_NOT_TERMINAL", detail: run.status};
    const updated = Date.parse(run.updatedAt);
    if (!Number.isFinite(updated) || this.now() - updated < this.o.retentionMs) return {runId: id, status: "KEPT_RETENTION"};
    // work gerçek bir dizin olmalı (sembolik bağ/junction ise başka yere işaret edebilir): dokunulmaz.
    if (st.isSymbolicLink() || !st.isDirectory()) return {runId: id, status: "KEPT_UNSAFE_PATH"};
    if (hasSecretFinding(run)) return {runId: id, status: "KEPT_SECRET_FINDING"};
    return null;
  }

  private archiveAndPrune(run: WorkRun, dir: string, work: string): RunArchiveResult {
    const id = run.runId;
    let project: Project | undefined;
    try { project = this.o.store.getProject({tenantId: run.tenantId}, run.projectId); } catch { project = undefined; }
    if (!project) return {runId: id, status: "KEPT_PROJECT_UNKNOWN"};
    try { this.o.studio.managedRepoRoot(project); } catch { return {runId: id, status: "KEPT_NOT_MANAGED"}; }

    const shas = recordedCommitSet(run);
    const wanted: ArchivedCommit[] = shas.map(sha => ({sha, ref: `refs/uasco/run-commits/${id}/${sha}`}));
    if (run.headSha && SHA.test(run.headSha)) wanted.push({sha: run.headSha, ref: `refs/uasco/runs/${id}`}); // teslim ref'i (ProjectStudio.prepareRunDelivery ile aynı ad)
    const base = {schemaVersion: 1, runId: id, status: run.status, headSha: run.headSha, commits: wanted};

    if (wanted.length > 0) {
      for (const c of wanted) {
        try { this.o.studio.archiveRunCommit(project, run, c.sha, c.ref); }
        catch (e) { return {runId: id, status: "KEPT_ARCHIVE_FAILED", detail: String((e as {code?: string; message?: string})?.code ?? (e as Error)?.message ?? e).slice(0, 80)}; }
      }
      // Silmeden ÖNCE her arşiv alternates olmadan bağımsız doğrulanır (ref == sha, commit, erişilebilir her nesne yönetilen depoda).
      for (const c of wanted) if (!this.o.studio.isRunCommitArchived(project, run, c.sha, c.ref)) return {runId: id, status: "KEPT_ARCHIVE_UNVERIFIED", detail: c.sha.slice(0, 12)};
    }
    const archivedAt = wanted.length > 0 ? new Date(this.now()).toISOString() : null;
    this.writeRecord(dir, {...base, archivedAt, prunedAt: null});
    this.prune(dir, work);
    const status: RunArchiveStatus = wanted.length > 0 ? "PRUNED" : "PRUNED_NO_COMMIT";
    const archiveRef = run.headSha && wanted.length > 0 ? `refs/uasco/runs/${id}` : undefined;
    try { this.writeRecord(dir, {...base, archivedAt, prunedAt: new Date(this.now()).toISOString()}); this.finalized.add(id); }
    catch { return {runId: id, status, detail: "RECORD_FINALIZE_PENDING", ...(archiveRef ? {archiveRef} : {})}; } // çalışma alanı silindi; kayıt sonraki geçişte tamamlanır
    return {runId: id, status, ...(archiveRef ? {archiveRef} : {})};
  }

  // Çalışma alanı silindikten sonra kaydın son yazımı başarısız olduysa (prunedAt null) sonraki geçişte tamamlanır.
  private finalizeIfNeeded(run: WorkRun, dir: string): RunArchiveResult | null {
    if (this.finalized.has(run.runId)) return null;
    const rec = this.readRecord(dir);
    if (!rec) return null;
    if (rec.prunedAt !== null) { this.finalized.add(run.runId); return null; }
    const {digest: _d, ...body} = rec;
    try { this.writeRecord(dir, {...body, prunedAt: new Date(this.now()).toISOString()}); this.finalized.add(run.runId); }
    catch (e) { return {runId: run.runId, status: "KEPT_PRUNE_FAILED", detail: `RECORD_FINALIZE:${String((e as Error)?.message ?? e).slice(0, 80)}`}; }
    return {runId: run.runId, status: "RECORD_FINALIZED"};
  }

  // Türetilmiş klon dizinleri ÖNCE (tek kullanımlıktır), work SON silinir: yarım kalırsa work durur ve sonraki geçiş her şeyi yeniden doğrulayıp devam eder. Sembolik bağlar izlenmez.
  private prune(dir: string, work: string): void {
    for (const name of fs.readdirSync(dir)) {
      if (!DERIVED_CLONE_DIRS.test(name)) continue;
      const p = path.join(dir, name);
      if (path.relative(dir, p) !== name) throw new Error("RUN_PATH_ESCAPE");
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("UNSAFE_CLONE_PATH");
      fs.rmSync(p, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
    }
    if (path.relative(dir, work) !== "work") throw new Error("RUN_PATH_ESCAPE");
    fs.rmSync(work, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
    if (fs.existsSync(work)) throw new Error("WORKSPACE_NOT_REMOVED");
  }
}
