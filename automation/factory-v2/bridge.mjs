// //TR: UASCO Entegrasyon Köprüsü: V4.1 otoritatif durumunu (STATE.json done/inFlight/blocked, task-index, açık/merge edilmiş PR'lar ve head/base SHA'ları) salt-okunur aynalar, versiyonlu ve digest'li handover manifesti üretir, tek bir paylaşımlı otorite kaydını (origin git ref, CAS + epoch) deterministik faz makinesiyle V4.1 -> V2 geçirir. Kabul kapıları (review, CI, Founder yetkisi, migration kabulü) ve V4.1 drenaj onayı olmadan geçiş yoktur; uçuştaki her iş tamamlanmış, PR'ı ile sahiplenilmiş ya da açıkça fence edilmiş olmalıdır. Geri dönüş epoch'u artırarak V4.1'e döner. Tek yürütme sistemi: V2 yalnız otorite kaydı kendisini gösterirken iş dağıtır.
import crypto from "node:crypto";
import {assertSharedStore} from "./ownership.mjs";
import {liveOwnedTasks, DONE_STATUSES} from "./scheduler.mjs";

export const AUTHORITY_SCHEMA = "uasco.factory-v2.authority/1";
export const MANIFEST_SCHEMA = "uasco.factory-v2.handover-manifest/1";
export const PHASES = Object.freeze(["V41_AUTHORITATIVE", "HANDOVER_PREPARED", "V41_DRAINED", "V2_AUTHORITATIVE"]);
export const REQUIRED_GATES = Object.freeze(["reviewClean", "ciPassed", "founderAuthorization", "migrationAcceptance"]);
const TASK_RE = /^UASCO-TASK: ([A-Z0-9]+-T\d{4}(?:\.[a-z0-9]+)?)\s*$/m;
const SHA = /^[0-9a-f]{40}$/;
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v);
export const digest = v => crypto.createHash("sha256").update(canon(v)).digest("hex");
export const authorityRef = domain => `refs/uasco/authority/${domain}`;
export const manifestRef = (domain, version) => `refs/uasco/handover/${domain}/v${version}`;

export class BridgeError extends Error { constructor(code, detail) { super(`${code}${detail ? ":" + detail : ""}`); this.code = code; this.detail = detail; } }

/** Absent authority record = V4.1 is authoritative (the status quo before the bridge ever wrote). */
export const IMPLICIT_V41 = Object.freeze({schema: AUTHORITY_SCHEMA, authority: "V4.1", phase: "V41_AUTHORITATIVE", epoch: 0, holder: null, manifest: null, gates: null, drain: null});

// ---------------------------------------------------------------------------------------------------------------
// Read-only synchronisation: a deterministic snapshot of V4.1's canonical state. Writes nothing.
// ---------------------------------------------------------------------------------------------------------------
/**
 * input: {baseRef, baseSha, autonomyState(STATE.json), taskIndex, openPrs:[{number,body,head:{sha,ref},base:{sha,ref}}], mergedPrs:[...same + merge_commit_sha]}
 */
export function snapshotV41({baseRef, baseSha, autonomyState, taskIndex, openPrs = [], mergedPrs = []}) {
  if (!SHA.test(baseSha ?? "")) throw new BridgeError("SNAPSHOT_BASE_SHA_INVALID");
  const taskOf = pr => TASK_RE.exec(pr?.body ?? "")?.[1] ?? null;
  const done = new Map();
  for (const d of autonomyState?.done ?? []) done.set(d.task, {task: d.task, source: "STATE.done", pr: d.pr ?? null});
  for (const t of taskIndex?.tasks ?? []) if (DONE_STATUSES.includes(t.status) && !done.has(t.id)) done.set(t.id, {task: t.id, source: `task-index:${t.status}`, pr: null});
  const merged = mergedPrs.map(p => ({pr: p.number, task: taskOf(p), mergeSha: p.merge_commit_sha ?? null})).filter(p => p.task);
  const open = openPrs.map(p => ({pr: p.number, task: taskOf(p), headSha: p.head?.sha, headRef: p.head?.ref, baseSha: p.base?.sha, baseRef: p.base?.ref}))
    .sort((a, b) => a.pr - b.pr);
  const inFlight = (autonomyState?.inFlight ?? []).map(f => ({task: f.task, prs: f.prs ?? [], note: f.note ?? null}));
  const blocked = (autonomyState?.blocked ?? []).map(b => ({task: b.task, prs: b.prs ?? [], reason: b.reason ?? null}));
  return {baseRef, baseSha, done: [...done.values()].sort((a, b) => a.task.localeCompare(b.task)), mergedPrTasks: merged, openPrs: open, inFlight, blocked,
    liveOwned: [...liveOwnedTasks({autonomyState, openPrs})].sort(), taskIndexDigest: digest(taskIndex?.tasks ?? []), stateDigest: digest(autonomyState ?? {})};
}

/** Versioned manifest: the snapshot plus per-in-flight dispositions supplied by the V4.1 owner during drain. */
export function buildManifest({domain, version, snapshot, fromSession, toSession}) {
  const body = {schema: MANIFEST_SCHEMA, domain, version, fromSession, toSession, snapshot};
  return {...body, digest: digest(body)};
}
export function verifyManifest(m) {
  if (m?.schema !== MANIFEST_SCHEMA) throw new BridgeError("MANIFEST_SCHEMA");
  const {digest: d, ...body} = m;
  if (digest(body) !== d) throw new BridgeError("MANIFEST_DIGEST_MISMATCH");
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Reconciliation: manifest + drain disposition -> deterministic plan. UNRESOLVED items refuse the transition.
// ---------------------------------------------------------------------------------------------------------------
/**
 * drain: {acks:{[task]: "COMPLETED"|"FENCED"|"ADOPT_PR"}, builderSessionsStopped:[sessionId]} from the V4.1 owner.
 * Rules: done/merged -> VERIFIED (import, never rebuilt). Open PR with a task line -> ADOPT at its exact head/base SHA (no rebuild).
 * In-flight without an open PR -> only with an explicit FENCED/COMPLETED ack; otherwise UNRESOLVED.
 */
export function reconcile(manifest, drain = {acks: {}}) {
  const s = manifest.snapshot, plan = [], unresolved = [];
  // Completion comes only from V4.1's own done records. A merged PR is an increment, not task completion (doneMerge criteria live in V4.1).
  const doneIds = new Set(s.done.map(d => d.task));
  for (const id of doneIds) plan.push({task: id, action: "IMPORT_VERIFIED", evidence: {...s.done.find(d => d.task === id), mergedPrs: s.mergedPrTasks.filter(m => m.task === id).map(m => m.pr)}});
  // Every task-labelled open PR is its own work item (V4.1 lands tasks as several increment PRs), adopted at its exact SHAs, never rebuilt.
  const adoptedTasks = new Set();
  for (const pr of s.openPrs) {
    if (!pr.task) { plan.push({pr: pr.pr, action: "FOREIGN_PR_UNTOUCHED"}); continue; }
    if (!SHA.test(pr.headSha ?? "") || !SHA.test(pr.baseSha ?? "")) { unresolved.push({task: pr.task, reason: `PR_${pr.pr}_SHA_UNKNOWN`}); continue; }
    adoptedTasks.add(pr.task);
    const item = {task: `${pr.task}#pr${pr.pr}`, canonicalTask: pr.task, pr: pr.pr, headSha: pr.headSha, baseSha: pr.baseSha, headRef: pr.headRef, implementerSessions: drain.implementerSessions?.[pr.task] ?? []};
    // A PR stacked on another branch is tracked but never merged into the canonical branch automatically.
    plan.push(pr.baseRef === s.baseRef ? {...item, action: "ADOPT_PR"} : {...item, action: "IMPORT_BLOCKED", reason: `STACKED_ON:${pr.baseRef}`});
  }
  // A not-done task with open PRs stays owned by those PRs: it is not requeued until a decision marks it done or reopens it.
  for (const t of adoptedTasks) if (!doneIds.has(t)) plan.push({task: t, action: "IMPORT_BLOCKED", reason: "AWAITING_ADOPTED_PRS"});
  for (const f of [...s.inFlight, ...s.blocked]) {
    if (doneIds.has(f.task) || adoptedTasks.has(f.task)) continue;
    const ack = drain.acks?.[f.task];
    if (s.blocked.some(b => b.task === f.task)) { plan.push({task: f.task, action: "IMPORT_BLOCKED", reason: f.reason ?? "V41_BLOCKED"}); continue; }
    if (ack === "COMPLETED") plan.push({task: f.task, action: "IMPORT_VERIFIED", evidence: {source: "V41_DRAIN_ACK"}});
    else if (ack === "FENCED") plan.push({task: f.task, action: "REQUEUE_FENCED"});
    else unresolved.push({task: f.task, reason: "IN_FLIGHT_NOT_DRAINED"});
  }
  return {plan: plan.sort((a, b) => String(a.task ?? a.pr).localeCompare(String(b.task ?? b.pr))), unresolved};
}

/** Live re-check before commit: every adopted PR must still be open at the manifest's head/base SHA. */
export function manifestFresh(manifest, currentOpenPrs, {currentBaseSha, currentStateDigest} = {}) {
  const stale = [];
  // The canonical branch and V4.1's STATE.json must be exactly what the manifest captured (no dispatch/merge after the snapshot).
  if (currentBaseSha !== manifest.snapshot.baseSha) stale.push("CANONICAL_BASE_MOVED");
  if (currentStateDigest !== manifest.snapshot.stateDigest) stale.push("STATE_CHANGED");
  const cur = new Map(currentOpenPrs.map(p => [p.number, p]));
  for (const pr of manifest.snapshot.openPrs) {
    const c = cur.get(pr.pr);
    if (!c) stale.push(`PR_${pr.pr}_NO_LONGER_OPEN`);
    else if (c.head?.sha !== pr.headSha) stale.push(`PR_${pr.pr}_HEAD_MOVED`);
    else if ((c.base?.ref ?? null) !== (pr.baseRef ?? null)) stale.push(`PR_${pr.pr}_BASE_CHANGED`);
  }
  for (const c of currentOpenPrs) if (!manifest.snapshot.openPrs.some(p => p.pr === c.number)) stale.push(`PR_${c.number}_OPENED_AFTER_MANIFEST`);
  return {fresh: stale.length === 0, stale};
}

/** Apply a reconciliation plan into the V2 journal (idempotent per manifest digest). */
export function applyPlan(journal, manifest, plan, fence) {
  const out = [];
  for (const p of plan) {
    if (!p.task) continue;
    const key = `import:${manifest.digest}:${p.task}`;
    const state = {IMPORT_VERIFIED: "VERIFIED", ADOPT_PR: "BUILT", IMPORT_BLOCKED: "BLOCKED", REQUEUE_FENCED: "QUEUED"}[p.action];
    if (!state) continue;
    out.push(journal.importTask(p.task, state, {origin: "V41", pr: p.pr ?? null, headSha: p.headSha ?? null, baseSha: p.baseSha ?? null, branch: p.headRef ?? null, canonicalTask: p.canonicalTask ?? p.task, implementerSessions: p.implementerSessions ?? [], verdicts: [], evidence: p.evidence ?? null, reason: p.reason ?? null, attemptBump: p.action === "REQUEUE_FENCED"}, fence, key));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Authority record: one shared doc, CAS on the origin ref. Deterministic phase machine.
// ---------------------------------------------------------------------------------------------------------------
export class AuthorityBridge {
  constructor({docStore, domain, now = Date.now, requireShared = true}) {
    if (requireShared) assertSharedStore(docStore, "authority");
    Object.assign(this, {docStore, domain, now});
  }
  read() { const r = this.docStore.read(authorityRef(this.domain)); return {sha: r.sha, doc: r.doc ?? IMPLICIT_V41}; }
  write(expected, next) {
    const r = this.docStore.cas(authorityRef(this.domain), expected.sha, next);
    if (!r.ok) throw new BridgeError("AUTHORITY_CAS_LOST", `expected ${expected.sha ?? "absent"}`);
    return {sha: r.sha, doc: next};
  }
  step(cur, phase, patch, actor) {
    const hist = [...(cur.doc.history ?? []), {phase: cur.doc.phase, epoch: cur.doc.epoch, at: cur.doc.updatedAt ?? null, by: cur.doc.updatedBy ?? null}].slice(-20);
    return {...cur.doc, ...patch, schema: AUTHORITY_SCHEMA, domain: this.domain, phase, updatedAt: this.now(), updatedBy: actor, history: hist};
  }
  /** Publish the manifest (immutable versioned ref) and move to HANDOVER_PREPARED. All acceptance gates are required here. */
  prepare({manifest, gates, actor}) {
    verifyManifest(manifest);
    const missing = REQUIRED_GATES.filter(g => !gates?.[g] || !gates[g].evidence);
    if (missing.length) throw new BridgeError("ACCEPTANCE_GATES_MISSING", missing.join(","));
    const cur = this.read();
    if (cur.doc.phase !== "V41_AUTHORITATIVE") throw new BridgeError("PHASE_INVALID", `${cur.doc.phase}->HANDOVER_PREPARED`);
    const mref = manifestRef(this.domain, manifest.version);
    const m = this.docStore.cas(mref, null, manifest);
    if (!m.ok && digest(m.current?.doc ?? {}) !== digest(manifest)) throw new BridgeError("MANIFEST_VERSION_TAKEN", mref);
    if (!manifest.fromSession || manifest.fromSession === manifest.toSession) throw new BridgeError("MANIFEST_SESSIONS_INVALID");
    return this.write(cur, this.step(cur, "HANDOVER_PREPARED", {authority: "V4.1", manifest: {ref: mref, version: manifest.version, digest: manifest.digest}, gates, candidate: manifest.toSession, outgoing: manifest.fromSession, drain: null}, actor));
  }
  /** V4.1 owner acknowledges: no new dispatch, in-flight dispositions given, manifest digest equals its own state. */
  drainAck({manifestDigest, drain, actor}) {
    const cur = this.read();
    if (cur.doc.phase !== "HANDOVER_PREPARED") throw new BridgeError("PHASE_INVALID", `${cur.doc.phase}->V41_DRAINED`);
    if (cur.doc.manifest?.digest !== manifestDigest) throw new BridgeError("DRAIN_MANIFEST_MISMATCH");
    if (!Array.isArray(drain?.builderSessionsStopped)) throw new BridgeError("DRAIN_ACK_INCOMPLETE", "builderSessionsStopped");
    // Only the outgoing V4.1 owner named in the manifest may acknowledge; the incoming candidate can never ack its own handover.
    if (actor !== cur.doc.outgoing || actor === cur.doc.candidate) throw new BridgeError("DRAIN_ACK_ACTOR_INVALID", actor);
    return this.write(cur, this.step(cur, "V41_DRAINED", {drain: {...drain, by: actor}}, actor));
  }
  /** Deterministic commit: reconciliation must have no UNRESOLVED and the manifest must still be fresh. Epoch strictly increases. */
  commit({manifest, currentOpenPrs, currentBaseSha, currentStateDigest, v2Session, actor}) {
    const cur = this.read();
    if (cur.doc.phase !== "V41_DRAINED") throw new BridgeError("PHASE_INVALID", `${cur.doc.phase}->V2_AUTHORITATIVE`);
    verifyManifest(manifest);
    if (manifest.digest !== cur.doc.manifest?.digest) throw new BridgeError("COMMIT_MANIFEST_MISMATCH");
    if (cur.doc.candidate !== v2Session) throw new BridgeError("COMMIT_CANDIDATE_MISMATCH");
    const fr = manifestFresh(manifest, currentOpenPrs, {currentBaseSha, currentStateDigest});
    if (!fr.fresh) throw new BridgeError("MANIFEST_STALE", fr.stale.join(","));
    const rec = reconcile(manifest, cur.doc.drain);
    if (rec.unresolved.length) throw new BridgeError("RECONCILE_UNRESOLVED", rec.unresolved.map(u => `${u.task}:${u.reason}`).join(","));
    const next = this.write(cur, this.step(cur, "V2_AUTHORITATIVE", {authority: "V2", epoch: cur.doc.epoch + 1, holder: v2Session}, actor));
    return {...next, plan: rec.plan};
  }
  /** Rollback from any phase to V4.1, with a strictly greater epoch so a V2 holder is fenced. */
  rollback({reason, actor}) {
    const cur = this.read();
    return this.write(cur, this.step(cur, "V41_AUTHORITATIVE", {authority: "V4.1", epoch: cur.doc.epoch + 1, holder: null, candidate: null, rollbackReason: reason}, actor));
  }
  /** Gate the V2 Supervisor checks before every dispatch/merge: authority must name this session at this epoch. */
  assertV2(session, epoch) {
    const {doc} = this.read();
    if (doc.authority !== "V2" || doc.phase !== "V2_AUTHORITATIVE") throw new BridgeError("V2_NOT_AUTHORITATIVE", doc.phase);
    if (doc.holder !== session) throw new BridgeError("V2_HOLDER_MISMATCH", doc.holder);
    if (epoch != null && doc.epoch !== epoch) throw new BridgeError("V2_EPOCH_MISMATCH", `${doc.epoch}!=${epoch}`);
    return doc.epoch;
  }
  /** What V4.1 checks before each new dispatch/merge once the bridge exists. */
  v41MayDispatch() { const {doc} = this.read(); return doc.phase === "V41_AUTHORITATIVE"; }
}
