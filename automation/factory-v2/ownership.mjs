// //TR: Factory V2 sahiplik katmanı: Supervisor alanı, Merge Writer entegrasyon dalı ve görev claim'leri mevcut task-lease durum makinesi (git ref create-if-absent/CAS) üzerinde fencing token ile tek sahipli tutulur; süresi dolmuş sahip yazamaz (fence), yarışı kaybeden fail-closed HELD alır. Bu modül automation/lib'i yalnız okur/çağırır, değiştirmez.
import {claim, renew, release, isValidLeaseRecord, isExpired, leaseVersion} from "../lib/task-lease.mjs";
import {createLocalGitRefStore, createRemoteRefStore} from "../lib/task-lease-git-store.mjs";

// Isolated namespaces. SHADOW never touches the live claim namespace (refs/uasco/claims/) used by the canonical dispatcher.
export const NAMESPACES = Object.freeze({
  LIVE: "refs/uasco/claims/",
  SHADOW: "refs/uasco/factory-v2/shadow/"
});
// Store kinds. Only REMOTE_GIT_REF (CAS on the shared origin's ref lock) counts as cross-cloud exclusive ownership.
export const SHARED_KINDS = Object.freeze(["REMOTE_GIT_REF"]);
export function assertSharedStore(store, what = "store") { if (!SHARED_KINDS.includes(store?.kind)) throw new Error(`OWNERSHIP_STORE_NOT_SHARED:${what}:${store?.kind ?? "unknown"}`); return store; }

const safeId = s => String(s).replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_").replace(/(\.lock|\.)$/, "_").slice(0, 120);
export const supervisorLeaseId = domain => `supervisor--${safeId(domain)}`;
export const writerLeaseId = branch => `writer--${safeId(branch)}`;
export const taskLeaseId = taskId => `task--${safeId(taskId)}`;

/** Single-process atomic store (tests / one engine). Same contract as the git ref store. */
export function createMemoryStore() {
  const m = new Map();
  const clone = r => (r ? JSON.parse(JSON.stringify(r)) : null);
  return {
    read: id => clone(m.get(id)),
    createIfAbsent(id, rec) { if (m.has(id)) return {created: false, current: clone(m.get(id))}; m.set(id, clone(rec)); return {created: true, current: clone(rec)}; },
    cas(id, expected, rec) { const cur = m.get(id); if (!leaseVersion(expected) || leaseVersion(cur) !== leaseVersion(expected)) return {ok: false, current: clone(cur)}; m.set(id, clone(rec)); return {ok: true, current: clone(rec)}; },
    remove(id, expected) { const cur = m.get(id); if (!leaseVersion(expected) || leaseVersion(cur) !== leaseVersion(expected)) return {ok: false}; m.delete(id); return {ok: true}; },
    _dump: () => [...m.keys()],
    kind: "MEMORY"
  };
}

/** Cross-process atomic store over a local git repository's refs (git's ref lock gives atomicity). */
export function createGitStore(repoDir, mode = "SHADOW") {
  const refPrefix = NAMESPACES[mode];
  if (!refPrefix) throw new Error(`OWNERSHIP_MODE_INVALID:${mode}`);
  return Object.assign(createLocalGitRefStore({repoDir, refPrefix}), {kind: "LOCAL_GIT_REF", namespace: refPrefix});
}

/** Cross-cloud store: leases live as refs on the shared origin; runGit runs git in a local clone of it. */
export function createRemoteLeaseStore({runGit, remote = "origin", mode = "LIVE"}) {
  const refPrefix = NAMESPACES[mode];
  if (!refPrefix) throw new Error(`OWNERSHIP_MODE_INVALID:${mode}`);
  return Object.assign(createRemoteRefStore({runGit, remote, refPrefix}), {kind: "REMOTE_GIT_REF", namespace: refPrefix});
}

export class OwnershipLost extends Error { constructor(what, detail) { super(`OWNERSHIP_LOST:${what}`); this.code = "OWNERSHIP_LOST"; this.detail = detail; } }

/**
 * An exclusive, fenced ownership handle. `fence()` must be called immediately before any accepted side effect;
 * it throws once the lease is lost or within `safetyMarginMs` of expiry (so a slow writer cannot act on an expiring lease).
 */
export class Ownership {
  constructor(store, {leaseId, environment, workerId, sessionId, ttlMs = 60_000, safetyMarginMs = 5_000, now = Date.now}) {
    Object.assign(this, {store, leaseId, environment, workerId, sessionId, ttlMs, safetyMarginMs, now});
    this.record = null;
  }
  get token() { return this.record?.token ?? null; }
  get epoch() { return this.record?.epoch ?? 0; }
  acquire(headSha = null) {
    const r = claim(this.store, {taskId: this.leaseId, environment: this.environment, workerId: this.workerId, sessionId: this.sessionId, headSha, now: this.now(), ttlMs: this.ttlMs});
    if (r.status === "GRANTED") this.record = r.record;
    return {granted: r.status === "GRANTED", holder: r.status === "GRANTED" ? null : r.record, previous: r.previous ?? null};
  }
  renew() {
    if (!this.record) return false;
    const r = renew(this.store, {taskId: this.leaseId, environment: this.environment, workerId: this.workerId, sessionId: this.sessionId, token: this.record.token, now: this.now(), ttlMs: this.ttlMs});
    if (r.status === "RENEWED") { this.record = r.record; return true; }
    this.record = null; return false;
  }
  /** Fencing check against the authoritative store (not the local copy). */
  fence() {
    const held = this.record;
    if (!held) throw new OwnershipLost(this.leaseId, "NOT_HELD");
    const cur = this.store.read(this.leaseId);
    if (!isValidLeaseRecord(cur) || cur.token !== held.token) { this.record = null; throw new OwnershipLost(this.leaseId, "TOKEN_MISMATCH"); }
    const t = this.now();
    if (isExpired(cur, t) || cur.expiresAt - t < this.safetyMarginMs) { this.record = null; throw new OwnershipLost(this.leaseId, "EXPIRED_OR_EXPIRING"); }
    return {token: cur.token, epoch: cur.epoch};
  }
  release() { if (!this.record) return false; const r = release(this.store, {taskId: this.leaseId, environment: this.environment, workerId: this.workerId, sessionId: this.sessionId, token: this.record.token}); this.record = null; return r.status === "RELEASED"; }
  holder() { return this.store.read(this.leaseId); }
}
