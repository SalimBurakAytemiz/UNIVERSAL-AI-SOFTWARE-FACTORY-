// //TR: Factory V2 kalıcı durum günlüğü: append-only JSONL (fsync) + replay ile yeniden kurulan görev durum makinesi; geçişler monotonik ve izin listesine bağlıdır, her yazı idempotency anahtarı taşır (tekrar = yeni etki yok) ve Supervisor fence epoch'u daha düşük olan (eski/bölünmüş beyin) yazar reddedilir. Supervisor çökmesinden sonra kabul edilmiş iş kaybolmaz.
import fs from "node:fs";
import path from "node:path";

export const STATES = Object.freeze(["QUEUED", "CLAIMED", "BUILDING", "BUILT", "REVIEWING", "CHANGES_REQUESTED", "REMEDIATING", "REVIEW_CLEAN",
  "PREPARING", "READY_TO_MERGE", "MERGING", "MERGED", "VERIFIED", "RETRY_WAIT", "BLOCKED", "FAILED"]);
export const TERMINAL = Object.freeze(["VERIFIED", "FAILED"]);
const T = {
  QUEUED: ["CLAIMED", "BLOCKED"],
  CLAIMED: ["BUILDING", "RETRY_WAIT", "QUEUED"],
  BUILDING: ["BUILT", "RETRY_WAIT", "BLOCKED", "FAILED"],
  BUILT: ["REVIEWING"],
  REVIEWING: ["REVIEW_CLEAN", "CHANGES_REQUESTED", "BUILT", "BLOCKED"], // BUILT = review attempt failed (auth/rate limit): re-review, never CLEAN
  CHANGES_REQUESTED: ["REMEDIATING", "BLOCKED"],
  REMEDIATING: ["BUILT", "RETRY_WAIT", "BLOCKED", "FAILED"],
  REVIEW_CLEAN: ["PREPARING", "BUILT"], // BUILT = head moved: stale review is void
  PREPARING: ["READY_TO_MERGE", "BUILT", "CHANGES_REQUESTED", "BLOCKED", "REVIEW_CLEAN"],
  READY_TO_MERGE: ["MERGING", "PREPARING"],
  MERGING: ["MERGED", "PREPARING", "BLOCKED"],
  MERGED: ["VERIFIED", "BLOCKED"],
  RETRY_WAIT: ["QUEUED", "FAILED"],
  BLOCKED: ["QUEUED"], // only via explicit unblock
  VERIFIED: [], FAILED: []
};
export const canTransition = (from, to) => (T[from] ?? []).includes(to);

export class JournalError extends Error { constructor(code, detail) { super(`${code}${detail ? ":" + detail : ""}`); this.code = code; } }

export class StateJournal {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, "journal.jsonl");
    fs.mkdirSync(dir, {recursive: true});
    this.reload();
  }
  reload() {
    this.tasks = new Map(); this.keys = new Map(); this.seq = 0; this.maxFenceEpoch = 0; this.events = [];
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; if (!l.trim()) continue;
      let e; try { e = JSON.parse(l); } catch { if (i === lines.length - 1 || lines.slice(i + 1).every(x => !x.trim())) break; throw new JournalError("JOURNAL_CORRUPT", String(i + 1)); } // torn tail write is dropped
      this.apply(e);
    }
  }
  apply(e) {
    this.seq = Math.max(this.seq, e.seq); this.maxFenceEpoch = Math.max(this.maxFenceEpoch, e.fenceEpoch ?? 0);
    this.keys.set(e.idempotencyKey, e); this.events.push(e);
    if (e.kind === "ENQUEUE") this.tasks.set(e.taskId, {taskId: e.taskId, state: "QUEUED", attempt: 0, data: {...e.data}, history: [e.seq]});
    else if (e.kind === "TRANSITION") { const t = this.tasks.get(e.taskId); t.state = e.to; t.attempt = e.attempt; t.data = {...t.data, ...e.data}; t.history.push(e.seq); }
    else if (e.kind === "VERDICT") { const t = this.tasks.get(e.taskId); if (t) t.data = {...t.data, verdicts: [...(t.data.verdicts ?? []), e.data.verdict]}; }
    else if (e.kind === "NOTE") { const t = this.tasks.get(e.taskId); if (t) t.data = {...t.data, ...e.data}; }
  }
  // Cross-process exclusion for the read-check-append window (O_EXCL lock file; a crashed holder's lock is broken after lockStaleMs).
  withLock(fn, lockStaleMs = 10_000) {
    const lock = this.file + ".lock";
    for (let i = 0; ; i++) {
      try { fs.closeSync(fs.openSync(lock, "wx")); break; } catch (e) {
        if (e.code !== "EEXIST") throw e;
        try { if (Date.now() - fs.statSync(lock).mtimeMs > lockStaleMs) { fs.rmSync(lock, {force: true}); continue; } } catch {}
        if (i > 2000) throw new JournalError("JOURNAL_LOCK_TIMEOUT");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      }
    }
    try { return fn(); } finally { fs.rmSync(lock, {force: true}); }
  }
  append(entry, fence) {
    return this.withLock(() => {
      this.reload(); // another process may have appended (e.g. a newer Supervisor epoch)
      if (this.keys.has(entry.idempotencyKey)) return {duplicate: true, entry: this.keys.get(entry.idempotencyKey)};
      const fenceEpoch = fence?.epoch ?? 0;
      if (fenceEpoch < this.maxFenceEpoch) throw new JournalError("JOURNAL_STALE_FENCE", `${fenceEpoch}<${this.maxFenceEpoch}`);
      if (entry.kind === "TRANSITION") { const t = this.tasks.get(entry.taskId); if (!t || t.state !== entry.from) throw new JournalError("JOURNAL_STATE_CONFLICT", `${entry.taskId}:${t?.state}!=${entry.from}`); }
      const e = {...entry, seq: this.seq + 1, fenceEpoch, fenceToken: fence?.token ?? null, at: entry.at ?? Date.now()};
      const fd = fs.openSync(this.file, "a");
      try { fs.writeSync(fd, JSON.stringify(e) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.apply(e);
      return {duplicate: false, entry: e};
    });
  }
  /** Journal-level fencing epoch for a newly acquired Supervisor: strictly greater than any epoch ever written. */
  openEpoch(supervisorId, leaseToken) {
    return this.withLock(() => {
      this.reload();
      const epoch = this.maxFenceEpoch + 1;
      const e = {kind: "SUPERVISOR_EPOCH", idempotencyKey: `epoch:${epoch}`, data: {supervisorId, leaseToken}, seq: this.seq + 1, fenceEpoch: epoch, fenceToken: leaseToken, at: Date.now()};
      const fd = fs.openSync(this.file, "a");
      try { fs.writeSync(fd, JSON.stringify(e) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.apply(e);
      return {epoch, token: leaseToken};
    });
  }
  enqueue(taskId, data, fence) {
    if (this.tasks.has(taskId)) return {duplicate: true, entry: null};
    return this.append({kind: "ENQUEUE", taskId, idempotencyKey: `enqueue:${taskId}`, data}, fence);
  }
  /** Monotonic transition. `expect` guards against acting on a stale read (compare-and-set on state+attempt). */
  transition(taskId, to, {fence, data = {}, key, expectFrom, bumpAttempt = false} = {}) {
    const t = this.tasks.get(taskId);
    if (!t) throw new JournalError("JOURNAL_UNKNOWN_TASK", taskId);
    const idempotencyKey = key ?? `${taskId}:${t.history.length}:${to}`;
    if (this.keys.has(idempotencyKey)) return {duplicate: true, entry: this.keys.get(idempotencyKey)};
    if (expectFrom && t.state !== expectFrom) throw new JournalError("JOURNAL_STATE_CONFLICT", `${taskId}:${t.state}!=${expectFrom}`);
    if (!canTransition(t.state, to)) throw new JournalError("JOURNAL_ILLEGAL_TRANSITION", `${taskId}:${t.state}->${to}`);
    return this.append({kind: "TRANSITION", taskId, from: t.state, to, attempt: t.attempt + (bumpAttempt ? 1 : 0), idempotencyKey, data}, fence);
  }
  get(taskId) { return this.tasks.get(taskId) ?? null; }
  inState(...states) { return [...this.tasks.values()].filter(t => states.includes(t.state)); }
  /** Durable per-task annotation without a state change (VERDICT accumulates review verdicts; NOTE merges data). */
  annotate(taskId, kind, data, fence, idempotencyKey) { if (!this.tasks.has(taskId)) throw new JournalError("JOURNAL_UNKNOWN_TASK", taskId); return this.append({kind, taskId, idempotencyKey, data}, fence); }
  record(kind, data, fence, idempotencyKey) { return this.append({kind, idempotencyKey: idempotencyKey ?? `${kind}:${this.seq + 1}`, data}, fence); }
}
