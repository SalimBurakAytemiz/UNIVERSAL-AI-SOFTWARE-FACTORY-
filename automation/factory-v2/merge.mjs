// //TR: Factory V2 birleştirme hattı: 3 Merge Preparer bağımsız PR'ları paralel hazırlar (taban tazeliği, çakışma, kapsam, review kanıtı, SHA'ya bağlı CI, korumalı yol), yalnız tek Exclusive Merge Writer fenced entegrasyon lease'i ile kanonik dala yazar; yazı beklenen taban SHA'sına CAS'tır, sonuç SHA'sı uzaktan doğrulanır. Bloklu aday kuyruğu durdurmaz; GitHub "mergeable" etiketi tek başına yetki değildir.
import {reviewAuthorizes} from "./review.mjs";
import {OwnershipLost} from "./ownership.mjs";

const SHA = /^[0-9a-f]{40}$/;
const isProtected = (p, protectedPaths) => {
  const n = String(p).replaceAll("\\", "/");
  return (protectedPaths?.exactPaths ?? []).includes(n) || (protectedPaths?.protectedPrefixes ?? []).some(x => n.startsWith(x));
};

/**
 * Preparer: pure readiness evaluation over observed facts (no writes). Facts:
 * {candidate:{taskId,pr,headSha,baseSha,changedPaths,allowedPaths,builderIdentity,priorBlockers,required},
 *  canonicalSha, mergeBaseIsCanonical, conflicts, verdicts, ci:{sha,status,requiredContexts:{name:status}}, protectedPaths, founderAuthorizedPaths}
 */
export function prepareCandidate(f) {
  const c = f.candidate, reasons = [];
  if (!SHA.test(c?.headSha ?? "")) reasons.push("HEAD_SHA_INVALID");
  if (!SHA.test(f.canonicalSha ?? "")) reasons.push("CANONICAL_SHA_UNKNOWN");
  if (f.conflicts) reasons.push("MERGE_CONFLICT");
  const stale = f.canonicalSha !== c.baseSha;
  // A stale base is only a blocker when the canonical delta touches this candidate's files; otherwise merge-commit onto the new base.
  if (stale && f.baseDeltaOverlaps) reasons.push("BASE_STALE_OVERLAPPING");
  const outOfScope = (c.changedPaths ?? []).filter(p => !(c.allowedPaths ?? []).some(a => a.endsWith("/") ? p.startsWith(a) : p === a));
  if (outOfScope.length) reasons.push(`SCOPE_VIOLATION:${outOfScope.join(",")}`);
  const prot = (c.changedPaths ?? []).filter(p => isProtected(p, f.protectedPaths) && !(f.founderAuthorizedPaths ?? []).includes(p));
  if (prot.length) reasons.push(`PROTECTED_PATH_FOUNDER_REQUIRED:${prot.join(",")}`);
  const rv = reviewAuthorizes({verdicts: f.verdicts, required: c.required ?? [], baseSha: c.baseSha, headSha: c.headSha, builderIdentity: c.builderIdentity, priorBlockers: c.priorBlockers ?? []});
  reasons.push(...rv.reasons);
  if (f.ci?.sha !== c.headSha) reasons.push("CI_NOT_BOUND_TO_HEAD");
  const ctx = f.ci?.requiredContexts ?? {};
  if (!Object.keys(ctx).length) reasons.push("CI_REQUIRED_CONTEXTS_MISSING");
  for (const [k, v] of Object.entries(ctx)) if (v !== "success") reasons.push(`CI_${String(v).toUpperCase()}:${k}`);
  return {taskId: c.taskId, pr: c.pr, headSha: c.headSha, ready: reasons.length === 0, reasons, staleBase: stale};
}

/** Run up to `workers` preparations concurrently (each is independent). */
export async function prepareAll(factsList, workers = 3, prepareFn = async f => prepareCandidate(f)) {
  const out = new Array(factsList.length); let next = 0; const spans = [];
  const run = async w => { while (next < factsList.length) { const i = next++; const s = Date.now(); out[i] = await prepareFn(factsList[i]); spans.push({worker: `preparer-${w + 1}`, i, start: s, end: Date.now()}); } };
  await Promise.all(Array.from({length: Math.min(workers, factsList.length)}, (_, w) => run(w)));
  return {results: out, spans};
}

/**
 * Exclusive Merge Writer. git: {readCanonical()->sha, merge(candidate, expectedBaseSha)->{ok,resultSha,reason}, verifyRemote(sha)->bool}.
 * Each candidate: acquire/renew writer lease -> read canonical -> re-check readiness -> fence -> CAS merge -> verify -> record.
 */
export async function writeMerges(readyList, {ownership, git, recheck, record = () => {}}) {
  const results = [];
  const a = ownership.record ? {granted: ownership.renew()} : ownership.acquire();
  if (!a.granted) return {held: true, holder: ownership.holder(), results};
  try {
    for (const cand of readyList) {
      try {
        const base = git.readCanonical();
        const check = recheck ? await recheck(cand, base) : {ready: true, reasons: []};
        if (!check.ready) { results.push({taskId: cand.taskId, status: "SKIPPED_NOT_READY", reasons: check.reasons}); continue; }
        if (!ownership.renew()) throw new OwnershipLost(ownership.leaseId, "RENEW_FAILED");
        ownership.fence();
        const m = await git.merge(cand, base);
        if (!m.ok) { results.push({taskId: cand.taskId, status: m.reason === "BASE_MOVED" ? "RETRY_BASE_MOVED" : "MERGE_REFUSED", reasons: [m.reason]}); continue; }
        const verified = await git.verifyRemote(m.resultSha);
        const r = {taskId: cand.taskId, status: verified ? "MERGED" : "MERGE_UNVERIFIED", resultSha: m.resultSha, baseSha: base, token: ownership.token};
        results.push(r); record(r);
      } catch (e) {
        if (e?.code === "OWNERSHIP_LOST") { results.push({taskId: cand.taskId, status: "FENCED", reasons: [e.detail]}); break; }
        results.push({taskId: cand.taskId, status: "ERROR", reasons: [String(e?.message ?? e)]});
      }
    }
  } finally { ownership.release(); }
  return {held: false, results};
}
