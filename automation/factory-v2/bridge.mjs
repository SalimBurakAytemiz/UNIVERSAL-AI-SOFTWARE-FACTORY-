// //TR: UASCO Entegrasyon Köprüsü: V4.1 otoritatif durumunu (STATE.json done/inFlight/blocked, task-index, açık/merge edilmiş PR'lar ve head/base SHA'ları) salt-okunur aynalar, versiyonlu ve digest'li handover manifesti üretir, tek bir paylaşımlı otorite kaydını (origin git ref, CAS + epoch) deterministik faz makinesiyle V4.1 -> V2 geçirir. Kabul kapıları (review, CI, Founder yetkisi, migration kabulü) ve V4.1 drenaj onayı olmadan geçiş yoktur; uçuştaki her iş tamamlanmış, PR'ı ile sahiplenilmiş ya da açıkça fence edilmiş olmalıdır. Geri dönüş epoch'u artırarak V4.1'e döner. Tek yürütme sistemi: V2 yalnız otorite kaydı kendisini gösterirken iş dağıtır.
import crypto from "node:crypto";
import {assertSharedStore} from "./ownership.mjs";
import {liveOwnedTasks, DONE_STATUSES} from "./scheduler.mjs";
import {signAction, verifyAction, canonDigest} from "./identity.mjs";

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
// Authority record: one shared doc, CAS on the shared store. Every transition is a signed envelope bound to the digest of the
// previous core state (hash chain from the implicit V4.1 genesis). Readers re-verify the whole chain against the canonical
// keyring, so a registry writer without a registered role key can neither forge nor replay a transition.
// ---------------------------------------------------------------------------------------------------------------
const CORE_KEYS = ["domain", "authority", "phase", "epoch", "holder", "candidate", "outgoing", "manifest", "gatesDigest", "drainDigest"];
export const coreOf = d => Object.fromEntries(CORE_KEYS.map(k => [k, d?.[k] ?? null]));
const GENESIS = d => coreOf({...IMPLICIT_V41, domain: d});
const ACTION_OF = {HANDOVER_PREPARED: "PREPARE", V41_DRAINED: "DRAIN_ACK", V2_AUTHORITATIVE: "COMMIT", V41_AUTHORITATIVE: "ROLLBACK"};

/** Pure transition rules over cores; `signer` is the verified signer. Throws on any illegal step. */
export function checkTransition(prev, next, signer) {
  const action = ACTION_OF[next.phase];
  if (!action) throw new BridgeError("PHASE_UNKNOWN", next.phase);
  if (next.domain !== prev.domain) throw new BridgeError("DOMAIN_CHANGED");
  if (action === "PREPARE") {
    if (prev.phase !== "V41_AUTHORITATIVE") throw new BridgeError("PHASE_INVALID", `${prev.phase}->HANDOVER_PREPARED`);
    if (signer.sessionId !== next.candidate) throw new BridgeError("PREPARE_SIGNER_NOT_CANDIDATE");
    if (!next.outgoing || next.outgoing === next.candidate || !next.manifest?.digest || !next.gatesDigest) throw new BridgeError("PREPARE_FIELDS_INVALID");
    if (next.epoch !== prev.epoch || next.authority !== "V4.1" || next.holder !== null) throw new BridgeError("PREPARE_AUTHORITY_CHANGED");
  } else if (action === "DRAIN_ACK") {
    if (prev.phase !== "HANDOVER_PREPARED") throw new BridgeError("PHASE_INVALID", `${prev.phase}->V41_DRAINED`);
    if (signer.sessionId !== prev.outgoing || signer.sessionId === prev.candidate) throw new BridgeError("DRAIN_ACK_SIGNER_INVALID", signer.sessionId);
    if (!next.drainDigest) throw new BridgeError("DRAIN_FIELDS_INVALID");
    for (const k of ["authority", "epoch", "holder", "candidate", "outgoing", "manifest", "gatesDigest"]) if (canonDigest(next[k] ?? null) !== canonDigest(prev[k] ?? null)) throw new BridgeError("DRAIN_CHANGED_FIELD", k);
  } else if (action === "COMMIT") {
    if (prev.phase !== "V41_DRAINED") throw new BridgeError("PHASE_INVALID", `${prev.phase}->V2_AUTHORITATIVE`);
    if (signer.sessionId !== prev.candidate || next.holder !== prev.candidate) throw new BridgeError("COMMIT_CANDIDATE_MISMATCH");
    if (next.authority !== "V2" || next.epoch !== prev.epoch + 1) throw new BridgeError("COMMIT_EPOCH_INVALID");
    for (const k of ["candidate", "outgoing", "manifest", "gatesDigest", "drainDigest"]) if (canonDigest(next[k] ?? null) !== canonDigest(prev[k] ?? null)) throw new BridgeError("COMMIT_CHANGED_FIELD", k);
  } else if (action === "ROLLBACK") {
    // A reset (first link from genesis) may jump to any higher epoch so it never collides with a replaced chain's epochs.
    const epochOk = next.epoch === prev.epoch + 1 || (prev.epoch === 0 && prev.phase === "V41_AUTHORITATIVE" && prev.manifest === null && Number.isInteger(next.epoch) && next.epoch >= 1);
    if (next.authority !== "V4.1" || !epochOk || next.holder !== null || next.candidate !== null) throw new BridgeError("ROLLBACK_FIELDS_INVALID");
  }
  return action;
}

/** Verify a whole authority document. Absent = genesis (V4.1). Any invalid link => throws (callers fail closed). */
export function verifyAuthorityDoc(doc, {ring, domain}) {
  if (!doc) return {core: GENESIS(domain), epoch: 0};
  if (doc.schema !== AUTHORITY_SCHEMA || doc.domain !== domain || !Array.isArray(doc.chain) || doc.chain.length === 0) throw new BridgeError("AUTHORITY_DOC_INVALID");
  let prev = GENESIS(domain);
  for (const link of doc.chain) {
    const action = ACTION_OF[link.core?.phase];
    const signer = verifyAction(link.envelope, {ring, action, domain, prev: canonDigest(prev), payload: link.core, checkTime: false});
    checkTransition(prev, link.core, signer);
    prev = link.core;
  }
  if (canonDigest(prev) !== canonDigest(coreOf(doc))) throw new BridgeError("AUTHORITY_CORE_MISMATCH");
  return {core: prev, epoch: prev.epoch};
}

/**
 * Anti-rewind: the current record must extend the most advanced VALID chain ever stored (registry history), or be a signed reset to a
 * strictly higher epoch. Deleting the record, writing back an older signed record, or truncating the chain to a prefix all fail —
 * a registry writer cannot roll authority back without a V41_OWNER/FOUNDER key. `anchored` (canonical cutover record exists, or a
 * reader's persisted high-water mark) also makes an absent record unverifiable rather than genesis.
 */
export function verifyAuthorityHistory({current, history = [], ring, domain, anchored = false, hwm = null}) {
  let best = null;
  for (const d of history) {
    if (!d) continue;
    let v; try { v = verifyAuthorityDoc(d, {ring, domain}); } catch { continue; } // invalid historical versions carry no authority
    if (!best || v.epoch > best.epoch || (v.epoch === best.epoch && d.chain.length > best.chain.length)) best = {epoch: v.epoch, chain: d.chain};
  }
  const floor = Math.max(best?.epoch ?? 0, hwm?.epoch ?? 0);
  if (!current) {
    if (best || anchored || (hwm?.epoch ?? 0) > 0) throw new BridgeError("AUTHORITY_RECORD_REMOVED");
    return {core: GENESIS(domain), epoch: 0};
  }
  const v = verifyAuthorityDoc(current, {ring, domain});
  const sig = c => c.map(l => l.envelope?.signature);
  const extendsBest = !best || (best.chain.length <= current.chain.length && sig(best.chain).every((s, i) => s === sig(current.chain)[i]));
  const isReset = ACTION_OF[current.chain[0]?.core?.phase] === "ROLLBACK" && current.chain[0].core.epoch > (best?.epoch ?? 0);
  if (!extendsBest && !isReset) throw new BridgeError("AUTHORITY_REGRESSION", `epoch ${v.epoch} does not extend stored epoch ${best.epoch}`);
  if (v.epoch < floor && !(isReset && v.epoch >= floor)) throw new BridgeError("AUTHORITY_REGRESSION", `epoch ${v.epoch} < ${floor}`);
  return v;
}

export class AuthorityBridge {
  /**
   * keyring(): canonical keyring (identity.loadCanonicalKeyring); gateVerifier(gates, ctx) -> {verified}; live: {canonicalSha(), openPrs(), stateDigest(sha)}
   * — freshness and gate evidence come from live canonical sources, never from the caller.
   */
  /** anchored(): true once the canonical branch carries a cutover authorization for this domain; hwm: {get()->{epoch}|null, set({epoch})} persisted by the reader. */
  constructor({docStore, domain, now = Date.now, requireShared = true, keyring, gateVerifier, live, anchored = () => false, hwm = null}) {
    if (requireShared) assertSharedStore(docStore, "authority");
    if (typeof keyring !== "function") throw new BridgeError("KEYRING_REQUIRED");
    Object.assign(this, {docStore, domain, now, keyring, gateVerifier, live, anchored, hwm});
  }
  /** Raw read + full verification. */
  read() {
    const r = this.docStore.read(authorityRef(this.domain));
    const history = this.docStore.history ? this.docStore.history(authorityRef(this.domain)) : [];
    const hw = this.hwm?.get() ?? null;
    const needRing = r.doc || history.some(Boolean);
    const v = needRing || this.anchored() || (hw?.epoch ?? 0) > 0
      ? verifyAuthorityHistory({current: r.doc, history, ring: needRing ? this.keyring() : null, domain: this.domain, anchored: this.anchored(), hwm: hw})
      : {core: GENESIS(this.domain), epoch: 0}; // nothing ever recorded and nothing anchored: V4.1 genesis
    if (this.hwm && v.core.epoch > (hw?.epoch ?? 0)) this.hwm.set({epoch: v.core.epoch});
    return {sha: r.sha, doc: r.doc ?? {...IMPLICIT_V41, domain: this.domain, chain: []}, core: v.core};
  }
  /** Apply one transition: next core -> envelope (supplied pre-signed for relay, or signed here) -> verify -> rules -> CAS. */
  apply(cur, nextCore, {signer, envelope, extra = {}}) {
    const action = ACTION_OF[nextCore.phase];
    const prev = canonDigest(cur.core);
    const env = envelope ?? (signer ? signAction({...signer, domain: this.domain, action, prev, payload: nextCore, now: this.now()}) : null);
    if (!env) throw new BridgeError("SIGNATURE_REQUIRED");
    const who = verifyAction(env, {ring: this.keyring(), action, domain: this.domain, prev, payload: nextCore, now: this.now()});
    checkTransition(cur.core, nextCore, who);
    const doc = {...cur.doc, ...extra, ...nextCore, schema: AUTHORITY_SCHEMA, chain: [...(cur.doc.chain ?? []), {core: nextCore, envelope: env}], updatedAt: this.now(), updatedBy: who};
    const r = this.docStore.cas(authorityRef(this.domain), cur.sha, doc);
    if (!r.ok) throw new BridgeError("AUTHORITY_CAS_LOST", `expected ${cur.sha ?? "absent"}`);
    return {sha: r.sha, doc, core: nextCore, signer: who};
  }
  /** Publish the manifest (immutable versioned section) and move to HANDOVER_PREPARED. Gates are verified from live sources. */
  prepare({manifest, gates, signer, envelope}) {
    verifyManifest(manifest);
    if (!manifest.fromSession || manifest.fromSession === manifest.toSession) throw new BridgeError("MANIFEST_SESSIONS_INVALID");
    if (typeof this.gateVerifier !== "function") throw new BridgeError("GATE_VERIFIER_REQUIRED");
    const cur = this.read();
    const {verified} = this.gateVerifier(gates, {domain: this.domain, candidate: manifest.toSession, manifestVersion: manifest.version});
    const mref = manifestRef(this.domain, manifest.version);
    const nextCore = {...cur.core, phase: "HANDOVER_PREPARED", authority: "V4.1", holder: null, candidate: manifest.toSession, outgoing: manifest.fromSession,
      manifest: {ref: mref, version: manifest.version, digest: manifest.digest}, gatesDigest: canonDigest(verified), drainDigest: null};
    const m = this.docStore.cas(mref, null, manifest);
    if (!m.ok && digest(m.current?.doc ?? {}) !== digest(manifest)) throw new BridgeError("MANIFEST_VERSION_TAKEN", mref);
    return this.apply(cur, nextCore, {signer, envelope, extra: {gates: verified, drain: null}});
  }
  /** Next core for a drain ack — deterministic, so the V4.1 owner can sign it offline and anyone can relay it. */
  drainCore(cur, {manifestDigest, drain}) {
    if (cur.core.manifest?.digest !== manifestDigest) throw new BridgeError("DRAIN_MANIFEST_MISMATCH");
    if (!Array.isArray(drain?.builderSessionsStopped)) throw new BridgeError("DRAIN_ACK_INCOMPLETE", "builderSessionsStopped");
    return {...cur.core, phase: "V41_DRAINED", drainDigest: canonDigest(drain)};
  }
  drainAck({manifestDigest, drain, signer, envelope}) {
    const cur = this.read();
    if (cur.core.phase !== "HANDOVER_PREPARED") throw new BridgeError("PHASE_INVALID", `${cur.core.phase}->V41_DRAINED`);
    return this.apply(cur, this.drainCore(cur, {manifestDigest, drain}), {signer, envelope, extra: {drain}});
  }
  /** Commit: freshness is read from the live canonical branch and GitHub (never from the caller); reconciliation must be complete. */
  commit({manifest, signer, envelope}) {
    const cur = this.read();
    if (cur.core.phase !== "V41_DRAINED") throw new BridgeError("PHASE_INVALID", `${cur.core.phase}->V2_AUTHORITATIVE`);
    verifyManifest(manifest);
    if (manifest.digest !== cur.core.manifest?.digest) throw new BridgeError("COMMIT_MANIFEST_MISMATCH");
    if (!this.live) throw new BridgeError("LIVE_SOURCE_REQUIRED");
    const currentBaseSha = this.live.canonicalSha();
    const fr = manifestFresh(manifest, this.live.openPrs(), {currentBaseSha, currentStateDigest: this.live.stateDigest(currentBaseSha)});
    if (!fr.fresh) throw new BridgeError("MANIFEST_STALE", fr.stale.join(","));
    if (canonDigest(cur.doc.drain ?? null) !== cur.core.drainDigest) throw new BridgeError("DRAIN_RECORD_TAMPERED");
    const rec = reconcile(manifest, cur.doc.drain);
    if (rec.unresolved.length) throw new BridgeError("RECONCILE_UNRESOLVED", rec.unresolved.map(u => `${u.task}:${u.reason}`).join(","));
    const nextCore = {...cur.core, phase: "V2_AUTHORITATIVE", authority: "V2", epoch: cur.core.epoch + 1, holder: cur.core.candidate};
    return {...this.apply(cur, nextCore, {signer, envelope}), plan: rec.plan};
  }
  /** Rollback to V4.1 from any phase: only a registered V41_OWNER or FOUNDER key; epoch strictly increases so a V2 holder is fenced. */
  rollbackCore(cur) { return {...cur.core, phase: "V41_AUTHORITATIVE", authority: "V4.1", epoch: cur.core.epoch + 1, holder: null, candidate: null, outgoing: null, manifest: null, gatesDigest: null, drainDigest: null}; }
  rollback({reason, signer, envelope}) {
    const cur = this.read();
    return this.apply(cur, this.rollbackCore(cur), {signer, envelope, extra: {rollbackReason: String(reason ?? "")}});
  }
  /**
   * Recovery when the stored record does not verify (e.g. a registry writer overwrote it): a V41_OWNER or FOUNDER key restarts the chain
   * from genesis with a signed ROLLBACK to V4.1. Only allowed while the record is unverifiable; a V2 holder that remembers its epoch stops.
   */
  resetInvalid({reason, signer, envelope}) {
    const raw = this.docStore.read(authorityRef(this.domain));
    try { this.read(); throw new BridgeError("RESET_NOT_NEEDED"); } catch (e) { if (e?.code === "RESET_NOT_NEEDED") throw e; } // invalid, rewound or removed
    const genesis = GENESIS(this.domain);
    const ring = this.keyring();
    let maxEpoch = this.hwm?.get()?.epoch ?? 0;
    for (const d of (this.docStore.history ? this.docStore.history(authorityRef(this.domain)) : [])) { try { maxEpoch = Math.max(maxEpoch, verifyAuthorityDoc(d, {ring, domain: this.domain}).epoch); } catch {} }
    const cur = {sha: raw.sha, doc: {schema: AUTHORITY_SCHEMA, ...genesis, chain: [], invalidRecordReplaced: canonDigest(raw.doc ?? null)}, core: genesis};
    return this.apply(cur, {...genesis, phase: "V41_AUTHORITATIVE", authority: "V4.1", epoch: maxEpoch + 1}, {signer, envelope, extra: {rollbackReason: `RESET_INVALID:${String(reason ?? "")}`}});
  }
  /** The V2 Supervisor gate: verified chain, V2 phase, this holder, this epoch. */
  assertV2(session, epoch) {
    const {core} = this.read();
    if (core.authority !== "V2" || core.phase !== "V2_AUTHORITATIVE") throw new BridgeError("V2_NOT_AUTHORITATIVE", core.phase);
    if (core.holder !== session) throw new BridgeError("V2_HOLDER_MISMATCH", core.holder);
    if (epoch != null && core.epoch !== epoch) throw new BridgeError("V2_EPOCH_MISMATCH", `${core.epoch}!=${epoch}`);
    return core.epoch;
  }
  /** V4.1 side: dispatch/merge only while the VERIFIED record says V4.1 is authoritative; an unverifiable record halts it too. */
  v41MayDispatch() { try { return this.read().core.phase === "V41_AUTHORITATIVE"; } catch { return false; } }
}
