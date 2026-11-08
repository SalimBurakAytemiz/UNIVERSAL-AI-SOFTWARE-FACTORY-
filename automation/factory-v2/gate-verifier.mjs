// //TR: Factory V2 kabul kapısı doğrulayıcısı: prepare() kanıtları dolu metin olarak KABUL EDİLMEZ. Her kapı canlı GitHub ve kanonik git verisinden doğrulanır: review = V2 kodunu getiren PR merge edilmiş, merge commit'i kanonik geçmişte, PR dosyaları kapsamda, güvenilir login'den tam head/base'e bağlı VERDICT-BINDING CLEAN (builder oturumu değil); CI = PR head SHA'sında zorunlu bağlamlar ci.yml'den success; Founder yetkisi = kanonik dalda docs/planning/authority/ altında alan+aday+manifest sürümüne bağlı AUTHORIZES satırı; migration kabulü = merge commit'i için kanonik dalda ci.yml push koşusu success. Kaynak, SHA, kapsam ve yetki her kapıda ayrı kontrol edilir; doğrulanamayan kanıt reddedilir.
import {parseBinding, REQUIRED_CONTEXTS, CI_WORKFLOW_PATH, CHECK_APP} from "../../docs/planning/merge-gate.mjs";

const SHA = /^[0-9a-f]{40}$/;
export const FACTORY_SCOPE_PREFIX = "automation/factory-v2/";
export const FOUNDER_AUTH_PREFIX = "docs/planning/authority/";
// Same trailer the independent-review pipeline uses to identify implementer sessions (scripts/ci/uasco-review/github.mjs).
const SESSION_TRAILER_RE = /^Claude-Session:\s*https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})\s*$/gm;
const AUTH_LINE = /^AUTHORIZES: FACTORY_V2_CUTOVER domain=([a-z0-9-]{1,64}) candidate=(session_[A-Za-z0-9]{8,}) manifest-version=(\d{1,6})$/m;

export class GateError extends Error { constructor(gate, code, detail) { super(`GATE_${gate}:${code}${detail ? ":" + detail : ""}`); this.code = code; this.gate = gate; } }

/**
 * deps: {gh(path)->json  (GitHub REST, read-only), git: {isAncestor(a,b)->bool, show(sha,path)->string|null, canonicalSha()->sha},
 *        trustedReviewerLogins:[...], builderSessions:Set, baseRef}
 * gates: {reviewClean:{pr, headSha}, ciPassed:{headSha}, founderAuthorization:{path}, migrationAcceptance:{mergeSha}}
 * context: {domain, candidate, manifestVersion}
 * Returns normalised, verified evidence (what was actually checked) for the authority record.
 */
/**
 * The review part of the review gate, usable BEFORE merge (e.g. Founder merge readiness): scope, implementer sessions from commit
 * trailers, and exactly one trusted-login COMMENTED/APPROVED review whose VERDICT-BINDING is CLEAN for this exact head and the PR's base,
 * by a session that is not an implementer (case-insensitive). Throws GateError otherwise.
 */
export function reviewBinding(pr, prNumber, headSha, deps) {
  const rv = {pr: prNumber, headSha};
  const files = deps.gh(`pulls/${rv.pr}/files?per_page=100`).map(f => f.filename);
  if (!files.some(f => f.startsWith(FACTORY_SCOPE_PREFIX))) throw new GateError("REVIEW", "OUT_OF_SCOPE");
  // Builder sessions come from the PR's own commits (Claude-Session trailers), not from the caller: every session posts as the same
  // GitHub login, so the login alone cannot separate a builder's self-review from an independent one.
  const commits = deps.gh(`pulls/${rv.pr}/commits?per_page=100`);
  if (!Array.isArray(commits) || commits.length === 0 || commits.length >= 100) throw new GateError("REVIEW", "PR_COMMITS_UNVERIFIABLE");
  const implementers = new Set(commits.flatMap(c => [...String(c?.commit?.message ?? "").matchAll(SESSION_TRAILER_RE)].map(m => m[1])));
  if (implementers.size === 0) throw new GateError("REVIEW", "IMPLEMENTER_SESSIONS_UNKNOWN");
  const builders = new Set([...implementers, ...(deps.builderSessions ?? [])].map(x => String(x).toLowerCase())); // case-insensitive: no case-variant bypass
  const trusted = new Set((deps.trustedReviewerLogins ?? []).map(l => l.toLowerCase()));
  const reviews = deps.gh(`pulls/${rv.pr}/reviews?per_page=100`);
  const binding = reviews.map(r => ({r, b: parseBinding(r.body ?? "")}))
    .find(({r, b}) => b && !b.code && b.verdict === "CLEAN" && b.head === rv.headSha && b.base === pr.base?.sha && trusted.has(String(r.user?.login ?? "").toLowerCase())
      && ["COMMENTED", "APPROVED"].includes(r.state) && !builders.has(String(b.session).toLowerCase()));
  if (!binding) throw new GateError("REVIEW", "NO_TRUSTED_CLEAN_BINDING_AT_HEAD");
  return {reviewId: binding.r.id, reviewerSession: binding.b.session, reviewer: binding.r.user?.login, headSha, baseSha: pr.base?.sha, implementerSessions: [...implementers].sort()};
}

export function verifyGates(gates, context, deps) {
  const out = {}, canonical = deps.git.canonicalSha();
  if (!SHA.test(canonical ?? "")) throw new GateError("ALL", "CANONICAL_UNKNOWN");
  // --- review: source = merged PR on the canonical branch; sha = exact head; scope = factory files; authority = trusted login + CLEAN binding
  const rv = gates?.reviewClean;
  if (!Number.isInteger(rv?.pr) || !SHA.test(rv?.headSha ?? "")) throw new GateError("REVIEW", "EVIDENCE_SHAPE");
  const pr = deps.gh(`pulls/${rv.pr}`);
  if (!pr?.merged || !SHA.test(pr.merge_commit_sha ?? "")) throw new GateError("REVIEW", "PR_NOT_MERGED", String(rv.pr));
  if (pr.base?.ref !== deps.baseRef) throw new GateError("REVIEW", "WRONG_BASE", pr.base?.ref);
  if (pr.head?.sha !== rv.headSha) throw new GateError("REVIEW", "HEAD_MISMATCH");
  if (!deps.git.isAncestor(pr.merge_commit_sha, canonical)) throw new GateError("REVIEW", "MERGE_NOT_IN_CANONICAL");
  const binding = reviewBinding(pr, rv.pr, rv.headSha, deps);
  out.reviewClean = {pr: rv.pr, headSha: rv.headSha, baseSha: pr.base.sha, mergeSha: pr.merge_commit_sha, reviewId: binding.reviewId, reviewerSession: binding.reviewerSession, implementerSessions: binding.implementerSessions};
  // --- CI on the reviewed head: required contexts, from the required workflow, by the Actions app, all success
  const ci = gates?.ciPassed;
  if (ci?.headSha !== rv.headSha) throw new GateError("CI", "SHA_NOT_REVIEWED_HEAD");
  const runs = deps.gh(`commits/${ci.headSha}/check-runs?per_page=100`).check_runs ?? [];
  for (const ctx of REQUIRED_CONTEXTS) {
    const r = runs.filter(x => x.name === ctx && x.app?.slug === CHECK_APP && x.head_sha === ci.headSha);
    if (!r.length) throw new GateError("CI", "CONTEXT_MISSING", ctx);
    if (!r.every(x => x.status === "completed" && x.conclusion === "success")) throw new GateError("CI", "CONTEXT_NOT_SUCCESS", ctx);
  }
  out.ciPassed = {headSha: ci.headSha, contexts: [...REQUIRED_CONTEXTS]};
  // --- Founder authority: a governance-path file present in canonical history, naming this domain, candidate and manifest version
  const fa = gates?.founderAuthorization;
  if (typeof fa?.path !== "string" || !fa.path.startsWith(FOUNDER_AUTH_PREFIX) || fa.path.includes("..")) throw new GateError("FOUNDER", "PATH_NOT_GOVERNANCE");
  const text = deps.git.show(canonical, fa.path);
  if (text == null) throw new GateError("FOUNDER", "NOT_IN_CANONICAL");
  const m = AUTH_LINE.exec(text);
  if (!m) throw new GateError("FOUNDER", "NO_AUTHORIZES_LINE");
  if (m[1] !== context.domain || m[2] !== context.candidate || Number(m[3]) !== context.manifestVersion) throw new GateError("FOUNDER", "SCOPE_MISMATCH", `${m[1]}/${m[2]}/${m[3]}`);
  out.founderAuthorization = {path: fa.path, canonicalSha: canonical, domain: m[1], candidate: m[2], manifestVersion: Number(m[3])};
  // --- migration acceptance: the post-merge push CI of the merge commit on the canonical branch passed (tests incl. factory-v2)
  const ma = gates?.migrationAcceptance;
  if (ma?.mergeSha !== pr.merge_commit_sha) throw new GateError("MIGRATION", "NOT_THE_REVIEWED_MERGE");
  const wr = (deps.gh(`actions/runs?head_sha=${ma.mergeSha}&event=push&per_page=50`).workflow_runs ?? [])
    .filter(r => r.path === CI_WORKFLOW_PATH && r.head_branch === deps.baseRef && r.head_sha === ma.mergeSha);
  if (!wr.length) throw new GateError("MIGRATION", "NO_PUSH_RUN");
  // Deliberately "any completed run succeeded": a failed push run followed by a successful re-run of the SAME merge commit passes
  // (re-runs are how flakes are retried); the commit, branch and workflow file are pinned above. The PR-head CI gate is stricter (every run).
  if (!wr.some(r => r.status === "completed" && r.conclusion === "success")) throw new GateError("MIGRATION", "PUSH_RUN_NOT_SUCCESS");
  out.migrationAcceptance = {mergeSha: ma.mergeSha, runIds: wr.map(r => r.id)};
  return {verified: out, canonicalSha: canonical};
}
