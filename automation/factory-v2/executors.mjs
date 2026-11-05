// //TR: Factory V2 yürütücüleri: (1) LocalProcessExecutor her işi ayrı git worktree + ayrı görev dalında gerçek bir alt süreçte çalıştırır (PID/zaman damgası kanıtı; Builder'lar birbirinin commit edilmemiş değişikliğine dokunamaz); (2) CloudSessionIntentExecutor model-destekli işçiler için kalıcı "spawn intent" kaydı üretir — Claude Code Cloud oturumunu yalnız yetkili Supervisor oturumu create_session ile açar ve gerçek session id'yi bağlar; Node bu oturumu uyduramaz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, spawnSync} from "node:child_process";

const git = (cwd, args) => { const r = spawnSync("git", args, {cwd, encoding: "utf8", windowsHide: true}); if (r.status !== 0) throw new Error(`GIT_FAILED:${args[0]}:${(r.stderr || "").trim().slice(0, 200)}`); return r.stdout.trim(); };
const safe = s => String(s).replace(/[^A-Za-z0-9._-]/g, "_");

/** Isolated worktree per (task, attempt) on its own branch, created from an exact base SHA. */
export function createWorktree(repoDir, rootDir, {taskId, slotId, attempt = 0, baseSha, tag = "build"}) {
  const branch = `factory-v2/${safe(taskId)}-${tag}-a${attempt}`;
  const dir = path.join(rootDir, `${safe(slotId)}--${safe(taskId)}-${tag}-a${attempt}`);
  if (!fs.existsSync(dir)) git(repoDir, ["worktree", "add", "-q", "-B", branch, dir, baseSha]);
  return {dir, branch};
}
export function removeWorktree(repoDir, dir) { try { git(repoDir, ["worktree", "remove", "--force", dir]); } catch {} }

/**
 * Real child-process executor. command(job, worktree) -> [file, args]. The child receives the job as JSON on argv/env, runs in its
 * worktree, and prints one JSON line result on stdout. Result evidence: pid, start/end timestamps.
 */
export class LocalProcessExecutor {
  constructor({repoDir, worktreeRoot, baseSha, command, timeoutMs = 120_000, evidence = []}) { Object.assign(this, {repoDir, worktreeRoot, baseSha, command, timeoutMs, evidence}); }
  start(job) {
    const jobId = `job_${crypto.randomBytes(6).toString("hex")}`;
    const wt = job.kind === "REVIEW" ? null : createWorktree(this.repoDir, this.worktreeRoot, {taskId: job.taskId, slotId: job.slotId, attempt: job.attempt ?? 0, baseSha: job.fromSha ?? this.baseSha, tag: String(job.kind).toLowerCase()});
    const [file, args] = this.command(job, wt);
    const startedAt = Date.now();
    const child = spawn(file, args, {cwd: wt?.dir ?? this.repoDir, env: {...process.env, FACTORY_JOB: JSON.stringify({...job, jobId, worktree: wt})}, stdio: ["ignore", "pipe", "pipe"], windowsHide: true});
    const worker = {kind: "LOCAL_PROCESS", pid: child.pid, jobId, slotId: job.slotId};
    const done = new Promise((resolve, reject) => {
      let out = ""; let err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, this.timeoutMs);
      child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { err += d; });
      child.on("error", e => { clearTimeout(timer); reject(e); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const endedAt = Date.now();
        this.evidence.push({jobId, pid: child.pid, slotId: job.slotId, role: job.role, taskId: job.taskId, startedAt, endedAt, code, signal});
        if (code !== 0) return reject(Object.assign(new Error(signal ? `WORKER_CRASH:${signal}` : `WORKER_EXIT_${code}:${err.slice(-200)}`), {code: signal ? "WORKER_CRASH" : "WORKER_EXIT"}));
        try { const line = out.trim().split("\n").at(-1); resolve({ok: true, ...JSON.parse(line), branch: wt?.branch}); } catch { reject(new Error("WORKER_OUTPUT_INVALID")); }
      });
    });
    return {jobId, worker, done};
  }
}

/**
 * Model-backed worker bridge for Claude Code Cloud. start() persists an intent; it does NOT pretend a session exists.
 * The authorized Supervisor session actuates it (create_session), then calls bind(intentId, sessionId) and later complete(intentId, result).
 */
export class CloudSessionIntentExecutor {
  constructor({dir, repoUrl, baseBranch = "v7/integration", promptFor}) { Object.assign(this, {dir, repoUrl, baseBranch, promptFor}); fs.mkdirSync(dir, {recursive: true}); this.waiters = new Map(); }
  file(id) { return path.join(this.dir, `${id}.json`); }
  write(id, rec) { const f = this.file(id), tmp = `${f}.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(rec, null, 2)); fs.renameSync(tmp, f); }
  read(id) { try { return JSON.parse(fs.readFileSync(this.file(id), "utf8")); } catch { return null; } }
  start(job) {
    const jobId = `intent_${crypto.randomBytes(6).toString("hex")}`;
    const role = job.role === "REVIEWER" ? "CLAUDE_REVIEWER" : "BUILDER";
    this.write(jobId, {schema: "uasco.factory-v2.spawn-intent/1", intentId: jobId, status: "PENDING_SPAWN", role, slotId: job.slotId, taskId: job.taskId,
      createSession: {title: `${role} ${job.slotId} ${job.taskId}`, source_url: this.repoUrl, source_revision: job.kind === "REVIEW" ? job.headSha : this.baseBranch,
        tags: ["uasco-factory-v2", `slot:${job.slotId}`, `task:${job.taskId}`], prompt: this.promptFor(job)}, createdAt: Date.now(), sessionId: null});
    const done = new Promise((resolve, reject) => this.waiters.set(jobId, {resolve, reject}));
    return {jobId, worker: {kind: "CLOUD_SESSION_INTENT", intentId: jobId, sessionId: null}, done};
  }
  pending() { return fs.readdirSync(this.dir).filter(f => f.endsWith(".json")).map(f => this.read(f.slice(0, -5))).filter(r => r?.status === "PENDING_SPAWN"); }
  bind(intentId, sessionId) {
    if (!/^session_[A-Za-z0-9]{8,}$/.test(sessionId)) throw new Error("SESSION_ID_INVALID");
    const r = this.read(intentId); if (!r || r.status !== "PENDING_SPAWN") throw new Error("INTENT_NOT_PENDING");
    this.write(intentId, {...r, status: "RUNNING", sessionId, boundAt: Date.now()});
  }
  complete(intentId, result) {
    const r = this.read(intentId); if (!r || r.status !== "RUNNING") throw new Error("INTENT_NOT_RUNNING");
    this.write(intentId, {...r, status: result.ok === false ? "FAILED" : "COMPLETED", result, completedAt: Date.now()});
    const w = this.waiters.get(intentId); this.waiters.delete(intentId);
    if (w) result.ok === false ? w.reject(new Error(result.error ?? "WORKER_FAILED")) : w.resolve(result);
  }
}
