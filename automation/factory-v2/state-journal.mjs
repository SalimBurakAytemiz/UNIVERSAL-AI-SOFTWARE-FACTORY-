// //TR: Factory V2 kalıcı durum günlüğü: değiştirilebilir arka uçlu (yerel JSONL ya da paylaşımlı imzalı registry günlüğü) append-only olay günlüğü + replay ile yeniden kurulan görev durum makinesi; geçişler monotonik ve izin listesine bağlıdır, her yazı idempotency anahtarı taşır (tekrar = yeni etki yok), eşzamanlı yazar CAS ile yeniden okumaya zorlanır ve Supervisor fence epoch'u daha düşük olan (eski/bölünmüş beyin) yazar reddedilir. PR/CI/review/merge/ürün kanıtı ve işçi oturum kayıtları da aynı günlükte tutulur.
import crypto from "node:crypto";
import {fileLog} from "./ledger-log.mjs";

const canonKey = v => crypto.createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16);

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

export const FACT_KINDS = Object.freeze(["PR", "CI", "REVIEW", "MERGE", "EVIDENCE"]);
const isLog = x => x && typeof x === "object" && typeof x.load === "function" && typeof x.tryAppend === "function";

export class StateJournal {
  /** dirOrLog: a directory (local JSONL, single machine) or a log backend from ledger-log.mjs (shared, survives the container). */
  constructor(dirOrLog) {
    this.log = isLog(dirOrLog) ? dirOrLog : fileLog(dirOrLog);
    this.dir = typeof dirOrLog === "string" ? dirOrLog : null; this.file = this.log.file ?? null;
    this.reload();
  }
  reload() {
    this.tasks = new Map(); this.keys = new Map(); this.seq = 0; this.maxFenceEpoch = 0; this.events = []; this.workers = new Map(); this.lastEpoch = null;
    for (const e of this.log.load()) this.apply(e);
  }
  apply(e) {
    this.seq = Math.max(this.seq, e.seq); this.maxFenceEpoch = Math.max(this.maxFenceEpoch, e.fenceEpoch ?? 0);
    this.keys.set(e.idempotencyKey, e); this.events.push(e);
    if (e.kind === "ENQUEUE") this.tasks.set(e.taskId, {taskId: e.taskId, state: "QUEUED", attempt: 0, data: {...e.data}, history: [e.seq]});
    else if (e.kind === "TRANSITION") { const t = this.tasks.get(e.taskId); t.state = e.to; t.attempt = e.attempt; t.data = {...t.data, ...e.data}; t.history.push(e.seq); }
    else if (e.kind === "IMPORT") { if (!this.tasks.has(e.taskId)) this.tasks.set(e.taskId, {taskId: e.taskId, state: e.to, attempt: e.data?.attemptBump ? 1 : 0, data: {...e.data}, history: [e.seq]}); }
    else if (e.kind === "VERDICT") { const t = this.tasks.get(e.taskId); if (t) t.data = {...t.data, verdicts: [...(t.data.verdicts ?? []), e.data.verdict]}; }
    else if (e.kind === "NOTE") { const t = this.tasks.get(e.taskId); if (t) t.data = {...t.data, ...e.data}; }
    else if (e.kind === "FACT") { const t = this.tasks.get(e.taskId); if (t) { const f = {...(t.facts ?? {})}; f[e.data.fact] = e.data.fact === "EVIDENCE" ? [...(f.EVIDENCE ?? []), e.data.value] : e.data.value; t.facts = f; } }
    else if (e.kind === "WORKER") { const w = this.workers.get(e.data.intentId) ?? {}; this.workers.set(e.data.intentId, {...w, ...e.data, updatedAt: e.at, history: [...(w.history ?? []), {status: e.data.status, at: e.at, seq: e.seq}]}); }
    else if (e.kind === "SUPERVISOR_EPOCH") this.lastEpoch = {epoch: e.fenceEpoch, token: e.fenceToken, supervisorId: e.data?.supervisorId ?? null};
  }
  /** Append with optimistic concurrency against the backend; a concurrent writer forces a reload and a re-check (never a blind write). */
  writeEntry(build) {
    for (let i = 0; i < 20; i++) {
      this.reload();
      const r = build(); if (r.done) return r.done;
      const e = {...r.entry, seq: this.seq + 1, at: r.entry.at ?? Date.now()};
      if (this.log.tryAppend(this.seq, e).ok) { this.apply(e); return {duplicate: false, entry: e}; }
    }
    throw new JournalError("JOURNAL_CONTENDED");
  }
  append(entry, fence) {
    return this.writeEntry(() => {
      if (this.keys.has(entry.idempotencyKey)) return {done: {duplicate: true, entry: this.keys.get(entry.idempotencyKey)}};
      const fenceEpoch = fence?.epoch ?? 0;
      if (fenceEpoch < this.maxFenceEpoch) throw new JournalError("JOURNAL_STALE_FENCE", `${fenceEpoch}<${this.maxFenceEpoch}`);
      if (entry.kind === "TRANSITION") { const t = this.tasks.get(entry.taskId); if (!t || t.state !== entry.from) throw new JournalError("JOURNAL_STATE_CONFLICT", `${entry.taskId}:${t?.state}!=${entry.from}`); }
      return {entry: {...entry, fenceEpoch, fenceToken: fence?.token ?? null}};
    });
  }
  /** Journal-level fencing epoch for a newly acquired Supervisor: strictly greater than any epoch ever written. */
  openEpoch(supervisorId, leaseToken) {
    const r = this.writeEntry(() => { const epoch = this.maxFenceEpoch + 1; return {entry: {kind: "SUPERVISOR_EPOCH", idempotencyKey: `epoch:${epoch}`, data: {supervisorId, leaseToken}, fenceEpoch: epoch, fenceToken: leaseToken}}; });
    return {epoch: r.entry.fenceEpoch, token: leaseToken};
  }
  /** The latest Supervisor epoch, if it was opened by `supervisorId` with `leaseToken` (a restarted process of the same holder resumes it). */
  resumeEpoch(supervisorId, leaseToken) {
    this.reload();
    const l = this.lastEpoch;
    return l && l.supervisorId === supervisorId && l.token === leaseToken && l.epoch === this.maxFenceEpoch ? {epoch: l.epoch, token: l.token} : null;
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
  /** Bridge import of a V4.1 task in a reconciled state. Only for unknown tasks; never overwrites V2 progress. */
  importTask(taskId, to, data, fence, idempotencyKey) {
    if (!STATES.includes(to)) throw new JournalError("JOURNAL_IMPORT_STATE", to);
    if (this.tasks.has(taskId) && !this.keys.has(idempotencyKey)) return {duplicate: true, entry: null, existing: this.tasks.get(taskId).state};
    return this.append({kind: "IMPORT", taskId, to, idempotencyKey, data}, fence);
  }
  /** Durable per-task annotation without a state change (VERDICT accumulates review verdicts; NOTE merges data). */
  annotate(taskId, kind, data, fence, idempotencyKey) { if (!this.tasks.has(taskId)) throw new JournalError("JOURNAL_UNKNOWN_TASK", taskId); return this.append({kind, taskId, idempotencyKey, data}, fence); }
  /** Durable PR / CI / REVIEW / MERGE / EVIDENCE fact for a task (EVIDENCE accumulates). */
  fact(taskId, fact, value, fence, idempotencyKey) {
    if (!FACT_KINDS.includes(fact)) throw new JournalError("JOURNAL_FACT_KIND", fact);
    if (!this.tasks.has(taskId)) throw new JournalError("JOURNAL_UNKNOWN_TASK", taskId);
    return this.append({kind: "FACT", taskId, idempotencyKey: idempotencyKey ?? `fact:${taskId}:${fact}:${canonKey(value)}`, data: {fact, value}}, fence);
  }
  /** Worker session record (intent lifecycle: PENDING_SPAWN -> RUNNING -> COMPLETED | FAILED | LOST). */
  worker(intentId, data, fence, idempotencyKey) { return this.append({kind: "WORKER", idempotencyKey: idempotencyKey ?? `worker:${intentId}:${data.status}`, data: {...data, intentId}}, fence); }
  record(kind, data, fence, idempotencyKey) { return this.append({kind, idempotencyKey: idempotencyKey ?? `${kind}:${this.seq + 1}`, data}, fence); }
}
