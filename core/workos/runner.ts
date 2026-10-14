// //TR: Bu dosya B3a mission runner engine'idir: AUTHORIZED/PLANNED bir mission'ı izole workspace -> IMPLEMENT -> VERIFY (test + diff secret taraması) -> bağımsız REVIEW (ayrı kimlik, temiz klon, salt-okunur) -> REGRESSION -> REPORT adımlarıyla sürer ve REPORTING'de Founder teslim kararında durur (asla COMPLETE/merge/push yapmaz). Durum yalnız Work OS journal'ındadır; lease+fencing, checkpoint, sınırlı retry/remediation, GLOBAL_STOP ve crash-resume fail-closed çalışır.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {acquireProcessLock} from "../../automation/lib/process-lock.mjs";
import {globalStopState} from "../../automation/lib/global-stop.mjs";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import type {MissionStatus} from "../mission/types.js";
import type {WorkOsStore, RunPatch, RunWriteOptions} from "./store.js";
import {WorkOsError} from "./types.js";
import type {RunEvidence, RunStatus, RunStep, WorkRun} from "./types.js";
import {LEASED_RUN_STATUSES} from "./run-state.js";
import {testCommandAllowed} from "./schemas.js";
import {redactSecrets, scanCommitMessagesForSecrets, scanDiffForSecrets} from "./secret-scan.js";
import {assertIndependentExecutors, runProcess} from "./executors.js";
import type {ExecutorPair, MissionSpec, ProcResult} from "./executors.js";

export interface RunnerOptions {
  store: WorkOsStore; dataDir: string; globalStopFile: string; envPolicyFile: string; executors: ExecutorPair;
  actor?: string; leaseTtlMs?: number; maxRemediations?: number; maxRetries?: number; maxRecoveries?: number; retryBackoffMs?: readonly number[];
  testTimeoutMs?: number; executorTimeoutMs?: number; maxStepsPerTick?: number; now?: () => number;
}
export interface TickReport { skipped?: "BUSY" | "LOCKED"; recovered: string[]; claimed: string[]; cancelled: string[]; fenced: string[]; advanced: string[] }

type Outcome =
  | {kind: "DONE"; next: RunStep | "FINISHED"; data: Record<string, unknown>; patch?: RunPatch; mission?: MissionStatus}
  | {kind: "REMEDIATE"; reason: string; data: Record<string, unknown>; findings: string[]}
  | {kind: "BLOCK"; reason: string; status?: "BLOCKED" | "FAILED" | "QUARANTINED"}
  | {kind: "RETRY"; reason: string}
  | {kind: "CANCEL"; reason: string};

const RUN_ID = /^run_[0-9a-f]{24}$/;
const SHA = /^[0-9a-f]{40}$/;
const NEXT: Record<RunStep, RunStep | "FINISHED"> = {WORKSPACE: "IMPLEMENT", IMPLEMENT: "VERIFY", VERIFY: "REVIEW", REVIEW: "REGRESSION", REGRESSION: "REPORT", REPORT: "FINISHED"};
// Adım bittiğinde mission'ın gideceği durum (state machine allowlist'i store tarafından ayrıca uygulanır).
const MISSION_AFTER: Partial<Record<RunStep, MissionStatus>> = {IMPLEMENT: "VERIFYING", VERIFY: "REVIEWING", REVIEW: "REGRESSION", REGRESSION: "REPORTING"};
const stepStatus = (s: RunStep): RunStatus => (s === "VERIFY" || s === "REGRESSION" ? "VERIFYING" : "RUNNING");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

export class MissionRunner {
  readonly engineId = `engine_${crypto.randomBytes(6).toString("hex")}`;
  private readonly o: Required<Omit<RunnerOptions, "now">> & {now: () => number};
  private readonly owned = new Map<string, string>();
  private busy = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: RunnerOptions) {
    assertIndependentExecutors(opts.executors);
    this.o = {
      actor: "WORKOS_RUNNER", leaseTtlMs: 120_000, maxRemediations: 2, maxRetries: 2, maxRecoveries: 2, retryBackoffMs: [2_000, 8_000], testTimeoutMs: 10 * 60_000,
      executorTimeoutMs: 60 * 60_000, maxStepsPerTick: Number.POSITIVE_INFINITY, now: Date.now,
      ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined))
    } as unknown as Required<Omit<RunnerOptions, "now">> & {now: () => number};
  }

  // In-process zamanlayıcı (control API): single-flight; tick içindeki süreç kilidi ikinci bir süreç/engine'i dışarıda tutar.
  start(intervalMs = 2_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, Math.max(250, intervalMs));
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private stopActive(): string | null {
    try { const s = globalStopState(this.o.globalStopFile); return s ? String(s.reason ?? "GLOBAL_STOP_ACTIVE") : null; } catch { return "GLOBAL_STOP_STATE_UNSAFE"; }
  }
  private runDir(runId: string): string {
    if (!RUN_ID.test(runId)) throw new WorkOsError("WORKOS_INVALID_INPUT", "runId");
    const root = path.resolve(this.o.dataDir, "runs"), dir = path.resolve(root, runId), rel = path.relative(root, dir);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new WorkOsError("WORKOS_INVALID_INPUT", "runId");
    return dir;
  }
  private rmUnderRun(runId: string, target: string): void {
    const rel = path.relative(this.runDir(runId), target);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("RUN_PATH_ESCAPE");
    fs.rmSync(target, {recursive: true, force: true});
  }
  private git(cwd: string, args: string[]) { return spawnGitSync(cwd, args, {env: safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}), maxBuffer: 64 * 1024 * 1024}); }
  private gitOk(cwd: string, args: string[]): string | null { const r = this.git(cwd, args); return r.status === 0 ? String(r.stdout ?? "").trim() : null; }
  // Heartbeat setInterval'i senkron git işi sırasında çalışamaz: uzun senkron işlerden sonra lease açıkça yenilenir. Süresi dolmuşsa WORKOS_LEASE_FENCED fırlar ve adım yan etkili/ücretli işe geçmeden durur.
  private renew(runId: string, leaseId: string): void { this.o.store.renewRunLease(runId, leaseId, this.o.leaseTtlMs, this.o.actor); }

  async tick(): Promise<TickReport> {
    const rep: TickReport = {recovered: [], claimed: [], cancelled: [], fenced: [], advanced: []};
    if (this.busy) return {...rep, skipped: "BUSY"};
    this.busy = true;
    let release: (() => void) | null = null;
    try {
      try { release = acquireProcessLock(path.join(this.o.dataDir, "runner.lock"), this.engineId); } catch { return {...rep, skipped: "LOCKED"}; }
      const store = this.o.store, stop = this.stopActive();
      for (const run of store.engineListRuns()) {
        try {
          if (run.status === "CREATED" || run.status === "QUEUED") {
            if (stop) { this.cancelUnleased(run, stop); rep.cancelled.push(run.runId); continue; }
            const queued = run.status === "CREATED" ? store.transitionRun(run.runId, null, "QUEUED", "queued for runner", this.o.actor) : run;
            const leased = store.acquireRunLease(queued.runId, this.o.leaseTtlMs, this.o.actor);
            this.owned.set(run.runId, leased.leaseId!); rep.claimed.push(run.runId);
          } else if (LEASED_RUN_STATUSES.includes(run.status) && run.leaseId && Date.parse(run.leaseExpiresAt ?? "") <= this.o.now()) {
            // Süresi dolmuş lease: crash/askıda kalma -> devral, RECOVERING (yeni leaseId eski sahibi fence eder).
            const taken = store.takeoverRunLease(run.runId, this.o.leaseTtlMs, this.o.actor);
            this.owned.set(run.runId, taken.leaseId!); rep.recovered.push(run.runId);
          }
        } catch (e) { if (e instanceof WorkOsError && e.code === "WORKOS_LEASE_FENCED") { rep.fenced.push(run.runId); continue; } throw e; }
      }
      for (const [runId, leaseId] of [...this.owned]) {
        try {
          const r = await this.drive(runId, leaseId);
          if (r === "CANCELLED") rep.cancelled.push(runId); else if (r) rep.advanced.push(runId);
        } catch (e) {
          this.owned.delete(runId);
          if (e instanceof WorkOsError && e.code === "WORKOS_LEASE_FENCED") { rep.fenced.push(runId); continue; }
          this.failClosed(runId, leaseId, e);
        }
      }
      return rep;
    } finally {
      try { release?.(); } catch { /* kilit sahipliği değiştiyse yazılar zaten fence edilir */ }
      this.busy = false;
    }
  }

  // Beklenmeyen engine hatası: run FAILED, mission BLOCKED (sessiz devam yok). Fence edilmişse hiçbir şey yazılmaz.
  private failClosed(runId: string, leaseId: string, e: unknown): void {
    try {
      const run = this.o.store.engineGetRun(runId);
      if (!run || run.leaseId !== leaseId || !LEASED_RUN_STATUSES.includes(run.status) || run.status === "CANCELLING") return;
      const reason = `ENGINE_ERROR: ${e instanceof WorkOsError ? e.code : "UNEXPECTED"}`;
      this.o.store.transitionRun(runId, leaseId, "FAILED", reason, this.o.actor, {mission: {to: "BLOCKED", reason}});
    } catch { /* yazılamıyorsa lease dolunca recovery devralır */ }
  }

  private cancelUnleased(run: WorkRun, reason: string): void {
    const s = this.o.store;
    s.transitionRun(run.runId, null, "CANCELLING", `GLOBAL_STOP_ACTIVE: ${reason}`, this.o.actor);
    s.transitionRun(run.runId, null, "CANCELLED", `GLOBAL_STOP_ACTIVE: ${reason}`, this.o.actor, {mission: {to: "BLOCKED", reason: `GLOBAL_STOP_ACTIVE: ${reason}`}});
  }
  private cancelLeased(run: WorkRun, leaseId: string, reason: string): void {
    const s = this.o.store, at = new Date(this.o.now()).toISOString(), why = `GLOBAL_STOP_ACTIVE: ${reason}`;
    if (run.status !== "CANCELLING") s.transitionRun(run.runId, leaseId, "CANCELLING", why, this.o.actor);
    s.addRunEvidence(run.runId, leaseId, {step: "CANCEL", cycle: run.remediationCycle, kind: "CANCEL", argv: [], startedAt: at, endedAt: at, exitCode: null, logPath: null, logSha256: null, note: why.slice(0, 500)}, this.o.actor);
    s.transitionRun(run.runId, leaseId, "CANCELLED", why, this.o.actor, {mission: {to: "BLOCKED", reason: why}});
    this.owned.delete(run.runId);
  }

  private async drive(runId: string, leaseId: string): Promise<"CANCELLED" | boolean> {
    const s = this.o.store;
    let steps = 0;
    for (;;) {
      const run = s.engineGetRun(runId);
      if (!run || run.leaseId !== leaseId || !LEASED_RUN_STATUSES.includes(run.status)) { this.owned.delete(runId); return steps > 0; }
      const stop = this.stopActive();
      if (stop || run.status === "CANCELLING") { this.cancelLeased(run, leaseId, stop ?? run.reason ?? "CANCEL_REQUESTED"); return "CANCELLED"; }
      if (run.status === "RETRY_SCHEDULED" && Date.parse(run.retryAt ?? "") > this.o.now()) { s.renewRunLease(runId, leaseId, this.o.leaseTtlMs, this.o.actor); return steps > 0; }
      if (steps >= this.o.maxStepsPerTick) { s.renewRunLease(runId, leaseId, this.o.leaseTtlMs, this.o.actor); return steps > 0; }
      if (run.status === "RECOVERING" && !this.recoverCheck(run, leaseId)) { this.owned.delete(runId); return true; }
      this.renew(runId, leaseId); // her adımın başında (yani adımlar arasında da) lease yenilenir
      await this.executeStep(run, leaseId);
      steps += 1;
    }
  }

  // Crash-resume: son tamamlanmış checkpoint'ten devam; workspace/commit tutarsızsa RECOVERY_FAILED + kanıt (tahmin yok).
  // Recovery bütçesi: son checkpoint'ten beri yapılan devralma sayısı = attempt - son checkpoint'teki attempt (checkpoint yoksa ilk lease = 1). Her TAKEOVER attempt'i journal'da artırır,
  // bu yüzden recovery kanıtı yazılamasa bile sayım ilerler. maxRecoveries aşılırsa adım tekrar edilmez: RECOVERY_FAILED + mission BLOCKED (RECOVERY_BUDGET_EXHAUSTED).
  private recoverCheck(run: WorkRun, leaseId: string): boolean {
    const at = new Date(this.o.now()).toISOString();
    const work = path.join(this.runDir(run.runId), "work");
    const problems: string[] = [];
    const last = run.checkpoints[run.checkpoints.length - 1];
    const baseline = last && typeof last.data.attempt === "number" && Number.isSafeInteger(last.data.attempt) ? last.data.attempt : 1;
    const recoveries = run.attempt - baseline;
    const exhausted = recoveries > this.o.maxRecoveries;
    if (exhausted) problems.push("RECOVERY_BUDGET_EXHAUSTED");
    else if (run.step !== "WORKSPACE") {
      if (!run.baseSha || !SHA.test(run.baseSha) || !fs.existsSync(path.join(work, ".git"))) problems.push("WORKSPACE_MISSING");
      else {
        if (this.gitOk(work, ["cat-file", "-e", `${run.baseSha}^{commit}`]) === null) problems.push("BASE_COMMIT_MISSING");
        const needsHead = run.step !== "IMPLEMENT";
        if (needsHead && (!run.headSha || this.gitOk(work, ["cat-file", "-e", `${run.headSha}^{commit}`]) === null)) problems.push("HEAD_COMMIT_MISSING");
      }
    }
    const note = `takeover attempt ${run.attempt}; resume step ${run.step} cycle ${run.remediationCycle}; completed checkpoints ${run.checkpoints.length}; recovery ${recoveries} of budget ${this.o.maxRecoveries}${problems.length ? `; problems ${problems.join(",")}` : ""}`;
    this.o.store.addRunEvidence(run.runId, leaseId, {step: "RECOVERY", cycle: run.remediationCycle, kind: "RECOVERY", argv: [], startedAt: at, endedAt: at, exitCode: problems.length ? 1 : 0, logPath: null, logSha256: null, note}, this.o.actor);
    if (!problems.length) return true;
    const reason = exhausted ? "RECOVERY_BUDGET_EXHAUSTED" : `RECOVERY_FAILED: ${problems.join(",")}`;
    this.o.store.transitionRun(run.runId, leaseId, "RECOVERY_FAILED", reason, this.o.actor, {mission: {to: "BLOCKED", reason}});
    return false;
  }

  private async executeStep(run: WorkRun, leaseId: string): Promise<void> {
    const s = this.o.store, step = run.step, want = stepStatus(step);
    const startMission: RunWriteOptions["mission"] = step === "IMPLEMENT" && run.remediationCycle === 0 ? {to: "EXECUTING", reason: `run ${run.runId} implementing`} : undefined;
    let cur = run;
    if (cur.status !== want) cur = s.transitionRun(run.runId, leaseId, want, `step ${step} started`, this.o.actor, {mission: startMission});
    let lost = false;
    // Heartbeat: uzun adımlarda lease yenilenir; yenileme fence edilirse süreç durdurulur ve sonraki yazı reddedilir.
    const hb = setInterval(() => { try { s.renewRunLease(run.runId, leaseId, this.o.leaseTtlMs, this.o.actor); } catch { lost = true; } }, Math.max(50, Math.floor(this.o.leaseTtlMs / 3)));
    let out: Outcome;
    try { out = await this.performStep(cur, leaseId, () => lost || this.stopActive() !== null); } finally { clearInterval(hb); }
    await this.applyOutcome(cur, leaseId, out);
  }

  private async applyOutcome(run: WorkRun, leaseId: string, out: Outcome): Promise<void> {
    const s = this.o.store, a = this.o.actor, id = run.runId, step = run.step;
    switch (out.kind) {
      case "DONE": {
        s.transitionRun(id, leaseId, "CHECKPOINTING", `step ${step} completed`, a);
        const next = out.next === "FINISHED" ? "REPORT" : out.next;
        const mission = MISSION_AFTER[step];
        s.checkpointRun(id, leaseId, {step, data: {...out.data, attempt: run.attempt}}, a, {patch: {...(out.patch ?? {}), step: next, retryCount: 0, retryAt: null}, mission: mission ? {to: mission, reason: `run ${id}: ${step} completed`} : undefined});
        if (out.next === "FINISHED") s.transitionRun(id, leaseId, "AWAITING_APPROVAL", "DELIVERY_DECISION_PENDING_FOUNDER", a);
        return;
      }
      case "REMEDIATE": {
        if (run.remediationCycle >= this.o.maxRemediations) {
          const reason = `${out.reason}_REMEDIATION_EXHAUSTED`;
          s.transitionRun(id, leaseId, "BLOCKED", reason, a, {mission: {to: "BLOCKED", reason}});
          return;
        }
        s.transitionRun(id, leaseId, "CHECKPOINTING", `step ${step} rejected: ${out.reason}`, a);
        s.checkpointRun(id, leaseId, {step, data: {...out.data, attempt: run.attempt, outcome: "REMEDIATE", reason: out.reason, findings: out.findings.slice(0, 50)}}, a,
          {patch: {step: "IMPLEMENT", remediationCycle: run.remediationCycle + 1, retryCount: 0, retryAt: null}, mission: {to: "REMEDIATING", reason: `run ${id}: ${out.reason}`}});
        return;
      }
      case "RETRY": {
        if (run.retryCount >= this.o.maxRetries) {
          const reason = `${out.reason}_RETRY_EXHAUSTED`;
          s.transitionRun(id, leaseId, "FAILED", reason, a, {mission: {to: "BLOCKED", reason}});
          return;
        }
        const backoff = this.o.retryBackoffMs[Math.min(run.retryCount, this.o.retryBackoffMs.length - 1)] ?? 0;
        s.transitionRun(id, leaseId, "RETRY_SCHEDULED", out.reason, a, {patch: {retryCount: run.retryCount + 1, retryAt: new Date(this.o.now() + backoff).toISOString()}});
        return;
      }
      case "BLOCK": {
        s.transitionRun(id, leaseId, out.status ?? "BLOCKED", out.reason, a, {mission: {to: "BLOCKED", reason: out.reason}});
        return;
      }
      case "CANCEL": {
        const cur = s.engineGetRun(id);
        if (cur && cur.leaseId === leaseId) this.cancelLeased(cur, leaseId, out.reason);
        return;
      }
    }
  }

  private writeLog(run: WorkRun, name: string, text: string): {logPath: string; logSha256: string} {
    const dir = path.join(this.runDir(run.runId), "logs");
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, `${run.step.toLowerCase()}-c${run.remediationCycle}-a${run.attempt}-${name}-${crypto.randomBytes(3).toString("hex")}.log`);
    const bytes = Buffer.from(redactSecrets(text), "utf8");
    fs.writeFileSync(file, bytes);
    return {logPath: path.relative(this.o.dataDir, file).split(path.sep).join("/"), logSha256: sha256(bytes)};
  }
  private evidence(run: WorkRun, leaseId: string, ev: Omit<RunEvidence, "evidenceId" | "step" | "cycle">): void {
    this.o.store.addRunEvidence(run.runId, leaseId, {step: run.step, cycle: run.remediationCycle, ...ev}, this.o.actor);
  }
  private procEvidence(run: WorkRun, leaseId: string, kind: string, r: ProcResult, extra: Partial<RunEvidence> = {}): void {
    const log = this.writeLog(run, kind.toLowerCase(), `$ ${r.argv.join(" ")}\n[exit=${r.exitCode} timedOut=${r.timedOut} aborted=${r.aborted}]\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
    this.evidence(run, leaseId, {kind, argv: r.argv, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, timedOut: r.timedOut, ...log, ...extra});
  }
  private missionSpec(run: WorkRun): MissionSpec {
    const m = this.o.store.getMission({tenantId: run.tenantId}, run.missionId);
    if (!m) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
    const last = [...run.checkpoints].reverse().find(c => c.data.outcome === "REMEDIATE");
    return {
      runId: run.runId, missionId: m.missionId, projectId: m.projectId, title: m.title, objective: m.objective, acceptanceCriteria: [...m.acceptanceCriteria],
      riskLevel: m.riskLevel, cycle: run.remediationCycle, baseSha: run.baseSha ?? "",
      ...(run.remediationCycle > 0 && last ? {remediation: {reason: String(last.data.reason ?? ""), findings: (Array.isArray(last.data.findings) ? last.data.findings : []).map(String)}} : {})
    };
  }
  private testArgv(run: WorkRun): string[] | null {
    const m = this.o.store.getMission({tenantId: run.tenantId}, run.missionId), p = this.o.store.getProject({tenantId: run.tenantId}, run.projectId);
    const argv = m?.testCommand ?? p?.testCommand;
    if (!testCommandAllowed(argv)) return null;
    return argv[0] === "node" ? [process.execPath, ...argv.slice(1)] : [...argv];
  }
  private runTests(argv: string[], cwd: string, abort: () => boolean): Promise<ProcResult> {
    return runProcess(argv, {cwd, env: safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}), timeoutMs: this.o.testTimeoutMs, shouldAbort: abort});
  }

  private async performStep(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    switch (run.step) {
      case "WORKSPACE": return this.stepWorkspace(run, leaseId);
      case "IMPLEMENT": return this.stepImplement(run, leaseId, abort);
      case "VERIFY": return this.stepVerify(run, leaseId, abort);
      case "REVIEW": return this.stepReview(run, leaseId, abort);
      case "REGRESSION": return this.stepRegression(run, leaseId, abort);
      case "REPORT": return this.stepReport(run, leaseId);
    }
  }

  // İzole workspace: proje deposunun yerel yolundan --no-hardlinks klon, HEAD base SHA olarak kaydedilir, run branch'i açılır. Yeniden girişte sıfırdan kurulur.
  private stepWorkspace(run: WorkRun, leaseId: string): Outcome {
    const project = this.o.store.getProject({tenantId: run.tenantId}, run.projectId);
    if (!project) return {kind: "BLOCK", reason: "PROJECT_NOT_FOUND"};
    const repo = project.repository;
    if (!repo?.path) return {kind: "BLOCK", reason: repo?.url ? "REMOTE_REPO_NOT_SUPPORTED_YET" : "REPOSITORY_NOT_CONFIGURED"};
    const src = path.resolve(repo.path);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return {kind: "BLOCK", reason: "REPOSITORY_PATH_NOT_FOUND"};
    const base = this.gitOk(src, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!base || !SHA.test(base)) return {kind: "BLOCK", reason: "REPOSITORY_HEAD_UNRESOLVED"};
    const dir = this.runDir(run.runId), work = path.join(dir, "work"), branch = `uasco/run/${run.runId}`;
    fs.mkdirSync(dir, {recursive: true});
    this.rmUnderRun(run.runId, work);
    const startedAt = new Date().toISOString();
    const clone = this.git(dir, ["clone", "--no-hardlinks", "--quiet", src, work]);
    const co = clone.status === 0 ? this.git(work, ["checkout", "-q", "-B", branch, base]) : null;
    const head = co?.status === 0 ? this.gitOk(work, ["rev-parse", "HEAD"]) : null;
    this.renew(run.runId, leaseId);
    const log = this.writeLog(run, "workspace", `$ git clone --no-hardlinks ${src} <run>/work\n${clone.stdout ?? ""}${clone.stderr ?? ""}\n$ git checkout -B ${branch} ${base}\n${co?.stdout ?? ""}${co?.stderr ?? ""}\nHEAD=${head}\n`);
    const ok = head === base;
    this.evidence(run, leaseId, {kind: "WORKSPACE", argv: ["git", "clone", "--no-hardlinks", src, `runs/${run.runId}/work`], startedAt, endedAt: new Date().toISOString(), exitCode: ok ? 0 : (clone.status ?? 1), ...log, baseSha: base});
    if (!ok) return {kind: "BLOCK", reason: "WORKSPACE_CLONE_FAILED"};
    return {kind: "DONE", next: "IMPLEMENT", data: {baseSha: base, workBranch: branch}, patch: {baseSha: base, headSha: null, workBranch: branch}};
  }

  // IMPLEMENT yeniden girişte idempotenttir: workspace önce döngü başlangıç commit'ine sıfırlanır (kör tekrar yok).
  private async stepImplement(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const work = path.join(this.runDir(run.runId), "work"), branch = run.workBranch ?? `uasco/run/${run.runId}`;
    const start = run.remediationCycle === 0 ? run.baseSha : (run.headSha ?? run.baseSha);
    if (!start || !SHA.test(start) || !fs.existsSync(path.join(work, ".git"))) return {kind: "BLOCK", reason: "WORKSPACE_MISSING", status: "FAILED"};
    for (const args of [["checkout", "-q", "-B", branch, start], ["reset", "-q", "--hard", start], ["clean", "-qfdx"]]) {
      if (this.gitOk(work, args) === null) return {kind: "BLOCK", reason: "WORKSPACE_RESET_FAILED", status: "FAILED"};
    }
    this.renew(run.runId, leaseId);
    const spec: MissionSpec = {...this.missionSpec(run), startSha: start};
    const r = await this.o.executors.implementer.implement(work, spec, {timeoutMs: this.o.executorTimeoutMs, shouldAbort: abort});
    const head = this.gitOk(work, ["rev-parse", "HEAD"]);
    const log = this.writeLog(run, "implement", r.log);
    const produced = r.exitCode === 0 && !r.blockReason && head && SHA.test(head) && head !== start ? head : undefined;
    this.evidence(run, leaseId, {kind: "IMPLEMENT", argv: r.argv, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, timedOut: r.timedOut, ...log, baseSha: start, ...(produced ? {commitSha: produced} : {}), executorIdentity: this.o.executors.implementer.identity, ...(r.blockReason ? {note: r.blockReason.slice(0, 200)} : {})});
    if (r.aborted) return {kind: "CANCEL", reason: this.stopActive() ?? "LEASE_LOST"};
    if (r.exitCode !== 0) return r.transient ? {kind: "RETRY", reason: "IMPLEMENT_TRANSIENT_FAILURE"} : {kind: "BLOCK", reason: "IMPLEMENT_FAILED", status: "FAILED"};
    // Edit-only builder çıktısını engine commit etmeyi reddettiyse (değişiklik yok, .git/workspace dışı değişiklik) run BLOCKED olur.
    if (r.blockReason) return {kind: "BLOCK", reason: r.blockReason.slice(0, 200)};
    if (!produced) return {kind: "BLOCK", reason: "NO_COMMIT_PRODUCED", status: "FAILED"};
    if (r.commitSha !== undefined && r.commitSha !== produced) return {kind: "BLOCK", reason: "IMPLEMENT_COMMIT_MISMATCH", status: "FAILED"};
    if (this.git(work, ["merge-base", "--is-ancestor", start, produced]).status !== 0) return {kind: "BLOCK", reason: "IMPLEMENT_HISTORY_REWRITTEN", status: "FAILED"};
    return {kind: "DONE", next: "VERIFY", data: {commitSha: produced, startSha: start}, patch: {headSha: produced}};
  }

  // Diff her zaman engine'in taze klonunda alınır: --text (binary/-diff attribute gizleyemez), --no-textconv/--no-ext-diff (sürücü çalışmaz),
  // boş attributes dosyası (global attributes yok sayılır) ve sabit a/ b/ önekleri; implementer'ın .git/config veya .gitattributes'ı taramayı atlatamaz.
  private emptyAttributes(run: WorkRun): string {
    const f = path.join(this.runDir(run.runId), "empty-attributes");
    fs.writeFileSync(f, "");
    return f;
  }
  private diff(run: WorkRun, cwd: string, base: string, head: string): string | null {
    const r = this.git(cwd, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--text", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", base, head]);
    return r.status === 0 ? String(r.stdout ?? "") : null;
  }
  private commitMessages(run: WorkRun, cwd: string, base: string, head: string): string | null {
    const r = this.git(cwd, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "log", "--no-color", "--no-show-signature", "--format=commit %H%n%B", `${base}..${head}`]);
    return r.status === 0 ? String(r.stdout ?? "") : null;
  }

  // VERIFY: önce diff secret taraması (hit -> BLOCKED, testler hiç çalışmaz), sonra allowlist'teki argv test komutu safeChildEnv + timeout ile.
  private async stepVerify(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const work = path.join(this.runDir(run.runId), "work");
    if (!run.baseSha || !run.headSha) return {kind: "BLOCK", reason: "HEAD_COMMIT_MISSING", status: "FAILED"};
    if (this.gitOk(work, ["rev-parse", "HEAD"]) !== run.headSha) {
      if (this.gitOk(work, ["checkout", "-q", "-B", run.workBranch ?? `uasco/run/${run.runId}`, run.headSha]) === null) return {kind: "BLOCK", reason: "WORKSPACE_DIVERGED", status: "FAILED"};
    }
    const startedAt = new Date().toISOString();
    // Tarama implementer workspace'inde değil, üretilen commit'in taze klonunda yapılır (workspace .git/config textconv'u etkisizdir).
    const scanClone = this.freshClone(run, `scan-c${run.remediationCycle}`);
    if (!scanClone) return {kind: "BLOCK", reason: "SCAN_CLONE_FAILED", status: "FAILED"};
    const diff = this.diff(run, scanClone, run.baseSha, run.headSha);
    const messages = this.commitMessages(run, scanClone, run.baseSha, run.headSha);
    if (diff === null || messages === null) return {kind: "BLOCK", reason: "DIFF_UNAVAILABLE", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const hits = [...scanDiffForSecrets(diff), ...scanCommitMessagesForSecrets(messages)];
    const scanLog = this.writeLog(run, "secret-scan", `secret scan ${run.baseSha}..${run.headSha} (fresh clone, --text --no-textconv --no-ext-diff, empty attributes; diff + commit messages): ${hits.length} hit(s)\n${hits.map(h => `${h.kind} ${h.file}:${h.line}`).join("\n")}\n`);
    this.evidence(run, leaseId, {kind: "SECRET_SCAN", argv: ["git", "diff", "--text", "--no-textconv", "--no-ext-diff", run.baseSha, run.headSha], startedAt, endedAt: new Date().toISOString(), exitCode: hits.length ? 1 : 0, ...scanLog, baseSha: run.baseSha, commitSha: run.headSha, secretHits: hits.slice(0, 100)});
    if (hits.length) return {kind: "BLOCK", reason: "SECRET_IN_DIFF"};
    const argv = this.testArgv(run);
    if (!argv) return {kind: "BLOCK", reason: "TEST_COMMAND_NOT_CONFIGURED"};
    const r = await this.runTests(argv, work, abort);
    this.procEvidence(run, leaseId, "VERIFY_TESTS", r, {commitSha: run.headSha});
    if (r.aborted) return {kind: "CANCEL", reason: this.stopActive() ?? "LEASE_LOST"};
    if (r.spawnError) return {kind: "BLOCK", reason: "TEST_COMMAND_SPAWN_FAILED"};
    if (r.exitCode === 0) return {kind: "DONE", next: "REVIEW", data: {tests: "PASSED", secretHits: 0}};
    return {kind: "REMEDIATE", reason: r.timedOut ? "TESTS_TIMED_OUT" : "TESTS_FAILED", data: {tests: "FAILED", exitCode: r.exitCode}, findings: [`test command exited ${r.exitCode}`]};
  }

  private freshClone(run: WorkRun, name = `review-c${run.remediationCycle}`): string | null {
    const work = path.join(this.runDir(run.runId), "work"), dir = path.join(this.runDir(run.runId), name);
    this.rmUnderRun(run.runId, dir);
    if (this.git(this.runDir(run.runId), ["clone", "--no-hardlinks", "--quiet", work, dir]).status !== 0) return null;
    if (this.gitOk(dir, ["checkout", "-q", "--detach", run.headSha!]) === null) return null;
    return this.gitOk(dir, ["rev-parse", "HEAD"]) === run.headSha ? dir : null;
  }

  // REVIEW: farklı kimlikli reviewer, üretilen commit'in taze temiz klonunda salt-okunur çalışır; klon değişirse fail-closed BLOCKED.
  private async stepReview(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const reviewer = this.o.executors.reviewer;
    if (reviewer.identity === run.executor.implementer || reviewer.identity !== run.executor.reviewer) return {kind: "BLOCK", reason: "REVIEWER_IDENTITY_MISMATCH"};
    if (!run.baseSha || !run.headSha) return {kind: "BLOCK", reason: "HEAD_COMMIT_MISSING", status: "FAILED"};
    const clone = this.freshClone(run);
    if (!clone) return {kind: "BLOCK", reason: "REVIEW_CLONE_FAILED", status: "FAILED"};
    const diff = this.diff(run, clone, run.baseSha, run.headSha);
    if (diff === null) return {kind: "BLOCK", reason: "DIFF_UNAVAILABLE", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const r = await reviewer.review(clone, this.missionSpec(run), diff, {timeoutMs: this.o.executorTimeoutMs, shouldAbort: abort});
    const untouched = this.gitOk(clone, ["rev-parse", "HEAD"]) === run.headSha && this.gitOk(clone, ["status", "--porcelain", "--untracked-files=all"]) === "";
    const log = this.writeLog(run, "review", r.log);
    this.evidence(run, leaseId, {kind: "REVIEW", argv: r.argv, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, timedOut: r.timedOut, ...log, commitSha: run.headSha,
      reviewerIdentity: reviewer.identity, executorIdentity: run.executor.implementer, ...(r.valid ? {verdict: r.verdict, findingsCount: r.findings.length} : {}), ...(untouched ? {} : {note: "REVIEW_CLONE_MUTATED"})});
    if (r.aborted) return {kind: "CANCEL", reason: this.stopActive() ?? "LEASE_LOST"};
    if (!untouched) return {kind: "BLOCK", reason: "REVIEWER_MUTATED_CLONE"};
    if (!r.valid) return r.transient ? {kind: "RETRY", reason: "REVIEW_TRANSIENT_FAILURE"} : {kind: "BLOCK", reason: "REVIEW_FAILED", status: "FAILED"};
    if (r.verdict === "CLEAN") return {kind: "DONE", next: "REGRESSION", data: {verdict: "CLEAN", reviewerIdentity: reviewer.identity, commitSha: run.headSha}};
    return {kind: "REMEDIATE", reason: "REVIEW_BLOCKED", data: {verdict: "BLOCKED", reviewerIdentity: reviewer.identity}, findings: r.findings.map(f => `${f.severity}: ${f.title}`)};
  }

  // REGRESSION: test komutu reviewer'ın gördüğü commit'in yeni ve temiz bir klonunda yeniden çalışır (yalnız commit'lenmiş içerik).
  private async stepRegression(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const clone = this.freshClone(run);
    if (!clone) return {kind: "BLOCK", reason: "REGRESSION_CLONE_FAILED", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const argv = this.testArgv(run);
    if (!argv) return {kind: "BLOCK", reason: "TEST_COMMAND_NOT_CONFIGURED"};
    const r = await this.runTests(argv, clone, abort);
    this.procEvidence(run, leaseId, "REGRESSION_TESTS", r, {commitSha: run.headSha ?? undefined});
    if (r.aborted) return {kind: "CANCEL", reason: this.stopActive() ?? "LEASE_LOST"};
    if (r.spawnError) return {kind: "BLOCK", reason: "TEST_COMMAND_SPAWN_FAILED"};
    if (r.exitCode === 0) return {kind: "DONE", next: "REPORT", data: {tests: "PASSED"}};
    return {kind: "REMEDIATE", reason: "REGRESSION_FAILED", data: {tests: "FAILED", exitCode: r.exitCode}, findings: [`regression test command exited ${r.exitCode}`]};
  }

  // REPORT: kanıt özeti dosyası + sha256; teslim kararı Founder'da kalır (merge/push/COMPLETE yok).
  private stepReport(run: WorkRun, leaseId: string): Outcome {
    const startedAt = new Date().toISOString();
    const review = [...run.evidence].reverse().find(e => e.kind === "REVIEW" && e.verdict === "CLEAN");
    const report = {
      runId: run.runId, missionId: run.missionId, projectId: run.projectId, tenantId: run.tenantId, baseSha: run.baseSha, headSha: run.headSha, workBranch: run.workBranch,
      executor: run.executor, review: review ? {reviewerIdentity: review.reviewerIdentity, verdict: review.verdict, commitSha: review.commitSha} : null,
      remediationCycles: run.remediationCycle, attempt: run.attempt,
      evidence: run.evidence.map(e => ({evidenceId: e.evidenceId, step: e.step, cycle: e.cycle, kind: e.kind, exitCode: e.exitCode, logPath: e.logPath, logSha256: e.logSha256, commitSha: e.commitSha ?? null})),
      deliveryDecision: "PENDING_FOUNDER", delivered: false, note: "No merge, push or COMPLETE transition was performed by the runner."
    };
    if (!review || review.commitSha !== run.headSha) return {kind: "BLOCK", reason: "REVIEW_EVIDENCE_MISSING", status: "FAILED"};
    const file = path.join(this.runDir(run.runId), "report.json"), bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8");
    fs.writeFileSync(file, bytes);
    const rel = path.relative(this.o.dataDir, file).split(path.sep).join("/");
    this.evidence(run, leaseId, {kind: "REPORT", argv: [], startedAt, endedAt: new Date().toISOString(), exitCode: 0, logPath: rel, logSha256: sha256(bytes), commitSha: run.headSha ?? undefined, reviewerIdentity: review.reviewerIdentity, verdict: "CLEAN"});
    return {kind: "DONE", next: "FINISHED", data: {reportPath: rel, reportSha256: sha256(bytes)}};
  }
}
