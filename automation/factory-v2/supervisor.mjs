// //TR: Factory V2 tek yetkili Supervisor: alan lease'i (fencing) olmadan STANDBY kalır; kalıcı günlükten kurtarır, kota/geri basınca göre Builder kapasitesini belirler, hazır görevleri task lease ile atomik claim edip bağımsız Builder slotlarına dağıtır, bitenleri risk-farkındalıklı bağımsız review'a, temiz olanları paralel merge hazırlığına ve tek Exclusive Writer'a yollar. Lease'i kaybetmiş işçinin sonucu kabul edilmez; bloklu görev diğer hatları durdurmaz.
import {buildTopology, reconfigure, INITIAL_TARGET} from "./topology.mjs";
import {Ownership, supervisorLeaseId, taskLeaseId, writerLeaseId} from "./ownership.mjs";
import {StateJournal} from "./state-journal.mjs";
import {readyTasks, assign} from "./scheduler.mjs";
import {riskOf, requiredFocuses, allocateReviewers, reviewAuthorizes, FAILURE_VERDICTS} from "./review.mjs";
import {prepareAll, writeMerges, prepareCandidate} from "./merge.mjs";
import {decideBuilders, quotaMode} from "./quota-governor.mjs";
import {nextRetry} from "./failures.mjs";
import {NAMESPACES} from "./ownership.mjs";
import {spawnSync} from "node:child_process";

const BUILDER_BUSY = ["CLAIMED", "BUILDING", "REMEDIATING"];

export class FactorySupervisor {
  /**
   * opts: {domain, mode, sessionId, environment, journalDir, leaseStore, executor, backlog()->tasks, liveOwned()->Set,
   *        target, now, leaseTtlMs, quota()->usage, queues()->{ciQueue}, mergeFacts(task)->facts, git, maxReviewFailures}
   */
  constructor(o) {
    this.o = {mode: "SHADOW", environment: "cloud", target: INITIAL_TARGET, now: Date.now, leaseTtlMs: 60_000, maxReviewFailures: 3, quota: () => ({}), queues: () => ({}), liveOwned: () => new Set(),
      ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))};
    if (!["SHADOW", "LIVE"].includes(this.o.mode)) throw new Error("SUPERVISOR_MODE_INVALID");
    this.topology = buildTopology(this.o.target);
    this.journal = new StateJournal(this.o.journalDir);
    this.lease = new Ownership(this.o.leaseStore, {leaseId: supervisorLeaseId(`${this.o.mode}-${this.o.domain}`), environment: this.o.environment, workerId: "supervisor", sessionId: this.o.sessionId, ttlMs: this.o.leaseTtlMs, safetyMarginMs: Math.min(5_000, this.o.leaseTtlMs / 4), now: this.o.now});
    this.handles = new Map(); // jobId -> {taskId, kind, slotId, startedAt, ...}
    this.taskLeases = new Map();
    this.state = "STANDBY"; this.fenceRef = null; this.decisions = []; this.spans = [];
  }
  // ---- ownership -------------------------------------------------------------------------------------------
  /** LIVE mode: the shared authority record must name this session (one UASCO execution system, never two factories). */
  authorityOk() {
    if (this.o.mode !== "LIVE") return true;
    if (typeof this.o.authority !== "function") throw new Error("LIVE_REQUIRES_AUTHORITY_GATE");
    try { this.authorityEpoch = this.o.authority(this.o.sessionId, this.authorityEpoch ?? null); return true; } catch (e) { this.authorityRefusal = String(e?.message ?? e); return false; }
  }
  start() {
    if (this.o.mode === "LIVE" && this.o.leaseStore?.kind !== "REMOTE_GIT_REF") throw new Error("LIVE_REQUIRES_SHARED_LEASE_STORE");
    // SHADOW may only ever claim in its own namespace (or an in-process store): never in the live claim refs.
    if (this.o.mode === "SHADOW" && this.o.leaseStore?.kind !== "MEMORY" && this.o.leaseStore?.namespace !== NAMESPACES.SHADOW) throw new Error("SHADOW_REQUIRES_SHADOW_NAMESPACE");
    if (!this.authorityOk()) { this.state = "STANDBY"; return {owner: false, authority: this.authorityRefusal}; }
    const a = this.lease.acquire();
    if (!a.granted) { this.state = "STANDBY"; return {owner: false, holder: a.holder}; }
    this.fenceRef = this.journal.openEpoch(this.o.sessionId, this.lease.token);
    this.state = "ACTIVE";
    this.recover();
    return {owner: true, epoch: this.fenceRef.epoch};
  }
  fence() { this.lease.fence(); return this.fenceRef; }
  stop() { this.lease.release(); this.state = "STOPPED"; }
  // ---- slots -----------------------------------------------------------------------------------------------
  slots(role) { return this.topology.slots.filter(s => s.role === role && !s.draining); }
  busySlotIds() { return new Set([...this.handles.values()].map(h => h.slotId)); }
  idle(role) { const b = this.busySlotIds(); return this.slots(role).filter(s => !b.has(s.id)); }
  scale(nextTarget) {
    this.fence();
    const r = reconfigure(this.topology, {...this.topology.target, ...nextTarget}, this.busySlotIds());
    this.topology = {target: r.target, slots: r.slots};
    this.journal.record("SCALE", {target: r.target, added: r.added, removed: r.removed, draining: r.draining}, this.fenceRef);
    return r;
  }
  // ---- recovery --------------------------------------------------------------------------------------------
  /** Restart recovery: work whose task lease is still validly held elsewhere is left alone; orphaned work is retried (bounded). */
  recover() {
    const now = this.o.now();
    for (const t of this.journal.inState("CLAIMED", "BUILDING", "REMEDIATING", "REVIEWING", "MERGING")) {
      if ([...this.handles.values()].some(h => h.taskId === t.taskId)) continue;
      const holder = this.o.leaseStore.read(taskLeaseId(t.taskId));
      if (holder && holder.expiresAt > now && holder.sessionId !== this.o.sessionId) continue; // another valid worker owns it
      if (t.state === "REVIEWING") { this.journal.transition(t.taskId, "BUILT", {fence: this.fenceRef, data: {verdicts: [], recovered: true}}); continue; }
      if (t.state === "MERGING") { this.journal.transition(t.taskId, "PREPARING", {fence: this.fenceRef, data: {recovered: true}}); continue; }
      this.journal.transition(t.taskId, "RETRY_WAIT", {fence: this.fenceRef, bumpAttempt: true, data: {recovered: true, retryAt: now}});
    }
  }
  // ---- main loop -------------------------------------------------------------------------------------------
  async tick() {
    if (this.state !== "ACTIVE") return {state: this.state};
    if (!this.lease.renew()) { this.state = "STANDBY"; return {state: "LOST_OWNERSHIP"}; }
    if (!this.authorityOk()) { this.state = "STANDBY"; this.lease.release(); return {state: "AUTHORITY_REVOKED", reason: this.authorityRefusal}; }
    this.fence();
    const now = this.o.now();
    for (const [, l] of this.taskLeases) l.renew();
    // release retry waits whose delay elapsed
    for (const t of this.journal.inState("RETRY_WAIT")) if ((t.data.retryAt ?? 0) <= now) this.journal.transition(t.taskId, "QUEUED", {fence: this.fenceRef});
    const backlog = await this.o.backlog();
    for (const task of backlog) this.journal.enqueue(task.id, {paths: task.paths ?? [], tier: task.tier, name: task.name}, this.fenceRef);
    const quota = quotaMode(await this.o.quota(), now);
    const done = new Set(this.journal.inState("VERIFIED", "MERGED").map(t => t.taskId));
    const inFlight = this.journal.inState(...BUILDER_BUSY, "BUILT", "REVIEWING", "CHANGES_REQUESTED", "REVIEW_CLEAN", "PREPARING", "READY_TO_MERGE", "MERGING")
      .map(t => ({id: t.taskId, paths: t.data.paths}));
    const queuedIds = new Set(this.journal.inState("QUEUED").map(t => t.taskId));
    const live = await this.o.liveOwned(); // excluded in SHADOW as well: a test run never touches live-owned tasks
    const ready = readyTasks(backlog.filter(t => queuedIds.has(t.id)), {done, excluded: live, inFlight});
    const q = await this.o.queues();
    const busyBuilders = this.journal.inState(...BUILDER_BUSY).length;
    const decision = decideBuilders({target: this.topology.target.builders, current: this.lastBuilders ?? this.topology.target.builders, readyBacklog: ready.length + busyBuilders,
      reviewQueue: this.journal.inState("BUILT").length, ciQueue: q.ciQueue ?? 0, mergeQueue: this.journal.inState("REVIEW_CLEAN", "PREPARING", "READY_TO_MERGE").length,
      reviewerSlots: this.slots("REVIEWER").length, quota});
    this.lastBuilders = Math.max(decision.builders, 1);
    this.decisions.push({at: now, ...decision, quota: quota.mode});
    const dispatched = [];
    if (decision.modelCallsAllowed) {
      const capacity = Math.max(0, decision.builders - busyBuilders);
      const idleBuilders = this.idle("BUILDER");
      for (const a of assign(ready, idleBuilders, {inFlight, capacity})) if (this.dispatchBuild(a)) dispatched.push(a);
      this.dispatchRemediations();
      this.dispatchReviews();
    }
    await this.prepareAndMerge();
    return {state: this.state, dispatched, decision, quota: quota.mode};
  }
  // ---- builders --------------------------------------------------------------------------------------------
  dispatchBuild(a, kind = "BUILD") {
    const lease = new Ownership(this.o.leaseStore, {leaseId: taskLeaseId(a.taskId), environment: this.o.environment, workerId: a.slotId, sessionId: this.o.sessionId, ttlMs: this.o.leaseTtlMs, safetyMarginMs: Math.min(5_000, this.o.leaseTtlMs / 4), now: this.o.now});
    if (!lease.acquire().granted) return false; // somebody else owns this task: never duplicate
    try { return this.startBuild(a, kind, lease); } catch (e) { lease.release(); throw e; }
  }
  startBuild(a, kind, lease) {
    this.fence();
    if (kind === "BUILD") this.journal.transition(a.taskId, "CLAIMED", {fence: this.fenceRef, data: {slotId: a.slotId, leaseToken: lease.token}});
    const t = this.journal.get(a.taskId);
    const handle = this.o.executor.start({kind, role: "BUILDER", slotId: a.slotId, taskId: a.taskId, attempt: t.attempt, paths: a.paths, findings: t.data.findings ?? [], fromSha: kind === "REMEDIATE" ? t.data.headSha : undefined});
    this.taskLeases.set(a.taskId, lease);
    this.handles.set(handle.jobId, {taskId: a.taskId, kind, slotId: a.slotId, jobId: handle.jobId, startedAt: this.o.now(), worker: handle.worker});
    if (kind === "BUILD") this.journal.transition(a.taskId, "BUILDING", {fence: this.fenceRef, data: {jobId: handle.jobId, worker: handle.worker ?? null}});
    handle.done.then(r => this.onBuildDone(handle.jobId, r), e => this.onBuildDone(handle.jobId, {ok: false, error: e}));
    return true;
  }
  dispatchRemediations() {
    for (const t of this.journal.inState("CHANGES_REQUESTED")) {
      const slot = this.idle("BUILDER").find(s => s.id === t.data.slotId) ?? this.idle("BUILDER")[0];
      if (!slot) return;
      this.fence();
      this.journal.transition(t.taskId, "REMEDIATING", {fence: this.fenceRef, data: {slotId: slot.id}});
      if (!this.dispatchBuild({taskId: t.taskId, slotId: slot.id, paths: t.data.paths}, "REMEDIATE")) this.journal.transition(t.taskId, "RETRY_WAIT", {fence: this.fenceRef, data: {retryAt: this.o.now() + 1000}});
    }
  }
  onBuildDone(jobId, r) {
    const h = this.handles.get(jobId); if (!h) return;
    this.handles.delete(jobId);
    const lease = this.taskLeases.get(h.taskId);
    this.spans.push({role: "BUILDER", slotId: h.slotId, taskId: h.taskId, jobId, worker: h.worker ?? null, start: h.startedAt, end: this.o.now(), ok: !!r.ok});
    try { lease?.fence(); this.fence(); } catch (e) {
      // A6: the worker (or this supervisor) lost ownership: its result is never accepted.
      try { this.journal.record("FENCED_RESULT_DISCARDED", {taskId: h.taskId, jobId, reason: e.detail ?? e.message}, this.fenceRef); } catch {}
      this.taskLeases.delete(h.taskId);
      // free the slot: the task goes back through RETRY_WAIT; re-dispatch must win the task lease again, so a valid other owner is never duplicated
      try { this.fence(); const cur = this.journal.get(h.taskId); if (["BUILDING", "REMEDIATING"].includes(cur?.state)) this.journal.transition(h.taskId, "RETRY_WAIT", {fence: this.fenceRef, key: `fenced:${jobId}`, data: {retryAt: this.o.now() + this.o.leaseTtlMs, lastError: "LEASE_LOST"}}); } catch {}
      return;
    }
    const t = this.journal.get(h.taskId);
    if (r.ok) {
      this.journal.transition(h.taskId, "BUILT", {fence: this.fenceRef, key: `built:${jobId}`, data: {headSha: r.headSha, baseSha: h.kind === "REMEDIATE" ? t.data.baseSha : r.baseSha, branch: r.branch, changedPaths: this.diff(h.kind === "REMEDIATE" ? t.data.baseSha : r.baseSha, r.headSha), builderIdentity: h.slotId, verdicts: []}});
    } else {
      const n = nextRetry(r.error, t.attempt + 1);
      if (n.action === "RETRY") this.journal.transition(h.taskId, "RETRY_WAIT", {fence: this.fenceRef, bumpAttempt: true, data: {retryAt: this.o.now() + n.delayMs, lastError: String(r.error?.message ?? r.error)}});
      else this.journal.transition(h.taskId, n.action === "BLOCK" ? "BLOCKED" : "FAILED", {fence: this.fenceRef, bumpAttempt: true, data: {lastError: String(r.error?.message ?? r.error), errorKind: n.kind}});
    }
    lease?.release(); this.taskLeases.delete(h.taskId);
  }
  // ---- reviewers -------------------------------------------------------------------------------------------
  dispatchReviews() {
    for (const t of this.journal.inState("BUILT")) {
      const paths = this.diff(t.data.baseSha, t.data.headSha);
      if (!paths) { this.journal.transition(t.taskId, "BLOCKED", {fence: this.fenceRef, data: {reason: "DIFF_UNVERIFIABLE"}}); continue; }
      const risk = riskOf({paths, tier: t.data.tier});
      const required = requiredFocuses(risk);
      const idle = this.idle("REVIEWER").map(s => ({...s, identity: s.id}));
      const alloc = allocateReviewers(required, idle, t.data.builderIdentity);
      if (!alloc.complete) continue; // wait for reviewer capacity; other tasks proceed
      this.fence();
      this.journal.transition(t.taskId, "REVIEWING", {fence: this.fenceRef, data: {required, risk, verdicts: [], reviewers: alloc.picks.map(p => p.id)}});
      for (const p of alloc.picks) {
        const handle = this.o.executor.start({kind: "REVIEW", role: "REVIEWER", slotId: p.id, focus: p.focus, taskId: t.taskId, attempt: t.attempt, headSha: t.data.headSha, baseSha: t.data.baseSha});
        this.handles.set(handle.jobId, {taskId: t.taskId, kind: "REVIEW", slotId: p.id, jobId: handle.jobId, focus: p.focus, startedAt: this.o.now(), worker: handle.worker});
        handle.done.then(v => this.onReviewDone(handle.jobId, v), e => this.onReviewDone(handle.jobId, {status: "ERROR", error: String(e)}));
      }
    }
  }
  onReviewDone(jobId, v) {
    const h = this.handles.get(jobId); if (!h) return;
    this.handles.delete(jobId);
    this.spans.push({role: "REVIEWER", slotId: h.slotId, taskId: h.taskId, jobId, worker: h.worker ?? null, start: h.startedAt, end: this.o.now(), ok: v.status === "CLEAN"});
    try { this.fence(); } catch { return; }
    const t = this.journal.get(h.taskId); if (t.state !== "REVIEWING") return;
    const verdict = {reviewerId: h.slotId, reviewerIdentity: h.slotId, focus: h.focus, status: v.status, baseSha: v.baseSha, headSha: v.headSha, blockers: v.blockers ?? [], resolves: v.resolves ?? []};
    this.journal.annotate(h.taskId, "VERDICT", {verdict}, this.fenceRef, `verdict:${jobId}`);
    const verdicts = this.journal.get(h.taskId).data.verdicts;
    const pending = t.data.reviewers.filter(r => !verdicts.some(x => x.reviewerId === r));
    if (pending.length) return;
    const auth = reviewAuthorizes({verdicts, required: t.data.required, baseSha: t.data.baseSha, headSha: t.data.headSha, builderIdentity: t.data.builderIdentity, priorBlockers: t.data.priorBlockers ?? []});
    if (auth.authorized) return this.journal.transition(h.taskId, "REVIEW_CLEAN", {fence: this.fenceRef, key: `clean:${jobId}`, data: {verdicts}});
    if (verdicts.some(x => FAILURE_VERDICTS.includes(x.status))) {
      const fails = (t.data.reviewFailures ?? 0) + 1;
      // A9: auth/rate-limit/model failures are never CLEAN; bounded re-review, then BLOCKED (other tasks continue).
      return this.journal.transition(h.taskId, fails >= this.o.maxReviewFailures ? "BLOCKED" : "BUILT", {fence: this.fenceRef, key: `revfail:${jobId}`, data: {verdicts: [], reviewFailures: fails, lastReviewReasons: auth.reasons}});
    }
    const blockers = verdicts.flatMap(x => x.blockers);
    this.journal.transition(h.taskId, "CHANGES_REQUESTED", {fence: this.fenceRef, key: `changes:${jobId}`, data: {verdicts: [], findings: blockers, priorBlockers: [...(t.data.priorBlockers ?? []), ...blockers]}});
  }
  // ---- merge -----------------------------------------------------------------------------------------------
  async prepareAndMerge() {
    if (!this.o.mergeFacts || !this.o.git) return;
    const clean = this.journal.inState("REVIEW_CLEAN");
    for (const t of clean) this.journal.transition(t.taskId, "PREPARING", {fence: this.fenceRef});
    const preparing = this.journal.inState("PREPARING");
    const facts = await Promise.all(preparing.map(t => this.facts(t)));
    const {results, spans} = await prepareAll(facts, this.slots("MERGE_PREPARER").length);
    this.spans.push(...spans.map(s => ({role: "MERGE_PREPARER", slotId: s.worker, taskId: preparing[s.i].taskId, start: s.start, end: s.end})));
    for (const r of results) {
      if (r.ready) this.journal.transition(r.taskId, "READY_TO_MERGE", {fence: this.fenceRef, data: {preparedHead: r.headSha}});
      else if (r.reasons.some(x => x.startsWith("PROTECTED_PATH") || x.startsWith("SCOPE_VIOLATION"))) this.journal.transition(r.taskId, "BLOCKED", {fence: this.fenceRef, data: {mergeBlock: r.reasons}});
      else this.journal.annotate(r.taskId, "NOTE", {mergeWait: r.reasons}, this.fenceRef, `prep-wait:${r.taskId}:${this.journal.seq}`);
    }
    const ready = this.journal.inState("READY_TO_MERGE");
    if (!ready.length || !this.authorityOk()) return;
    for (const t of ready) this.journal.transition(t.taskId, "MERGING", {fence: this.fenceRef});
    const writer = new Ownership(this.o.leaseStore, {leaseId: writerLeaseId(`${this.o.mode}-${this.o.domain}`), environment: this.o.environment, workerId: "merge-writer", sessionId: this.o.sessionId, ttlMs: this.o.leaseTtlMs, safetyMarginMs: Math.min(5_000, this.o.leaseTtlMs / 4), now: this.o.now});
    const cands = ready.map(t => ({taskId: t.taskId, headSha: t.data.headSha, branch: t.data.branch, pr: t.data.pr ?? null, implementerSessions: t.data.implementerSessions ?? []}));
    const recheck = async (c, base) => prepareCandidate({...(await this.facts(this.journal.get(c.taskId))), canonicalSha: base});
    const out = await writeMerges(cands, {ownership: writer, git: this.o.git, recheck, beforeWrite: () => { this.fence(); if (!this.authorityOk()) throw Object.assign(new Error("AUTHORITY_REVOKED"), {code: "OWNERSHIP_LOST", detail: "AUTHORITY_REVOKED"}); }});
    if (out.held) { for (const t of ready) this.journal.transition(t.taskId, "PREPARING", {fence: this.fenceRef, data: {mergeWait: ["WRITER_HELD"]}}); return; }
    for (const r of out.results) {
      if (r.status === "MERGED") { this.journal.transition(r.taskId, "MERGED", {fence: this.fenceRef, data: {resultSha: r.resultSha}}); }
      else this.journal.transition(r.taskId, "PREPARING", {fence: this.fenceRef, data: {mergeWait: r.reasons ?? [r.status]}});
    }
    for (const t of this.journal.inState("MERGED")) {
      const ok = this.o.postMergeVerify ? await this.o.postMergeVerify(t) : false;
      if (ok) this.journal.transition(t.taskId, "VERIFIED", {fence: this.fenceRef, data: {postMerge: "PASS"}});
    }
  }
  /** Changed paths from git itself (never from worker output). null = cannot be verified. */
  diff(baseSha, headSha) {
    if (typeof this.o.diffPaths === "function") return this.o.diffPaths(baseSha, headSha);
    if (!this.o.repoDir || !/^[0-9a-f]{40}$/.test(baseSha ?? "") || !/^[0-9a-f]{40}$/.test(headSha ?? "")) return null;
    const r = spawnSync("git", ["diff", "--name-only", "--no-renames", baseSha, headSha], {cwd: this.o.repoDir, encoding: "utf8"});
    return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : null;
  }
  /** Merge facts with supervisor-owned fields overriding the provider: trusted diff, required focuses, assigned identity. */
  async facts(t) {
    const f = await this.o.mergeFacts(t);
    return {...f, candidate: {...f.candidate, taskId: t.taskId, headSha: t.data.headSha, baseSha: t.data.baseSha, changedPaths: this.diff(t.data.baseSha, t.data.headSha), diffSource: "GIT_DIFF",
      required: t.data.required, builderIdentity: t.data.builderIdentity ?? `V41:${t.data.pr ?? "unknown"}`, priorBlockers: t.data.priorBlockers ?? []}, verdicts: t.data.verdicts ?? []};
  }
  // ---- observability ---------------------------------------------------------------------------------------
  report() {
    const by = r => this.slots(r).length;
    const busy = r => new Set([...this.handles.values()].filter(h => this.topology.slots.find(s => s.id === h.slotId)?.role === r).map(h => h.slotId)).size;
    return {
      mode: this.o.mode, supervisor: {state: this.state, owner: this.o.sessionId, epoch: this.fenceRef?.epoch ?? null},
      target: this.topology.target,
      configured: {builders: by("BUILDER"), reviewers: by("REVIEWER"), mergePreparers: by("MERGE_PREPARER")},
      busy: {builders: busy("BUILDER"), reviewers: busy("REVIEWER")},
      tasks: Object.fromEntries(["QUEUED", "BUILDING", "BUILT", "REVIEWING", "CHANGES_REQUESTED", "REVIEW_CLEAN", "PREPARING", "READY_TO_MERGE", "MERGED", "VERIFIED", "BLOCKED", "FAILED", "RETRY_WAIT"].map(s => [s, this.journal.inState(s).length])),
      lastDecision: this.decisions.at(-1) ?? null
    };
  }
}

/** Max number of simultaneously open spans of a role (measured overlap, not configuration). */
export function maxOverlap(spans) {
  const ev = spans.flatMap(s => [[s.start, 1], [s.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0; for (const [, d] of ev) { cur += d; max = Math.max(max, cur); } return max;
}
