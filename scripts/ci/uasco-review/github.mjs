// //TR: Bu modül UASCO Independent Review için GitHub REST G/Ç katmanıdır: PR, diff, check-run, review, ruleset ve commit kanıtını toplar, CI'ın head SHA üzerinde bitmesini sınırlı süre bekler ve kontrolü yalnız reviewer App token'ı ile yazar; fetch enjekte edilebilir, token hiçbir çıktıya yazılmaz.
import {REQUIRED_CONTEXTS} from "../../../docs/planning/merge-gate.mjs";
import {CHECK_NAME} from "./review-gate.mjs";

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const SESSION_TRAILER_RE = /^Claude-Session:\s*https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})\s*$/gm;

export class GitHubError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }

// Minimal REST client. Errors carry a fixed code and the HTTP status only: response bodies are never echoed (they can hold untrusted text).
export function client({token, repo, fetchImpl = globalThis.fetch, apiUrl = "https://api.github.com", sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 3, now = () => Date.now(), maxWaitMs = 15 * 60_000}) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo))) throw new GitHubError("REPO_INVALID", 0);
  async function req(method, path, {body, accept = "application/vnd.github+json", raw = false} = {}) {
    for (let attempt = 0, waits = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${apiUrl}${path}`, {method, headers: {Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "uasco-independent-review",
          ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000)});
      } catch {
        if (attempt < retries) { await sleep(2000 * 2 ** attempt); continue; }
        throw new GitHubError("NETWORK", 0);
      }
      // Rate limit (403/429 with retry-after or x-ratelimit-remaining: 0): wait as GitHub asks, at most maxWaitMs (15 min by default; short jobs pass less so a
      // wait can never outlast their timeout) and twice per request. A plain 403 stays ACCESS_DENIED.
      const limited = rateLimitWait(res, now(), maxWaitMs);
      if (limited !== null && waits < 2) { waits++; attempt--; await sleep(limited); continue; }
      if (RETRY_STATUS.has(res.status) && attempt < retries) { await sleep(2000 * 2 ** attempt); continue; }
      if (!res.ok) throw new GitHubError(res.status === 401 || res.status === 403 ? "ACCESS_DENIED" : res.status === 404 ? "NOT_FOUND" : "HTTP_ERROR", res.status);
      return raw ? res.text() : res.status === 204 ? null : res.json();
    }
  }
  // Pages of 100 up to maxPages; key picks the array out of wrapped responses (check-runs, workflow_runs).
  async function paginate(path, {key = null, maxPages = 30} = {}) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const j = await req("GET", `${path}${sep}per_page=100&page=${page}`);
      const items = key ? j?.[key] : j;
      if (!Array.isArray(items)) throw new GitHubError("SHAPE_INVALID", 0);
      out.push(...items);
      if (items.length < 100) return out;
    }
    throw new GitHubError("TOO_MANY_PAGES", 0);
  }
  return {req, paginate, repo};
}

function rateLimitWait(res, nowMs, maxMs) {
  if (res.status !== 403 && res.status !== 429) return null;
  const h = k => res.headers?.get?.(k) ?? null, after = Number(h("retry-after")), reset = Number(h("x-ratelimit-reset"));
  if (Number.isFinite(after) && after > 0) return Math.min(Math.max(60, after) * 1000, maxMs);
  if (h("x-ratelimit-remaining") === "0" && Number.isFinite(reset) && reset > 0) return Math.min(Math.max(1000, reset * 1000 - nowMs + 1000), maxMs);
  return null;
}

const r = gh => `/repos/${gh.repo}`;
const SHA_RE = /^[0-9a-f]{40}$/;
const enc = s => encodeURIComponent(s);

// Required CI contexts on the head SHA with their workflow provenance (path and event of the Actions run behind each check suite).
export async function ciCheckRuns(gh, headSha, suites = new Map()) {
  const runs = await gh.paginate(`${r(gh)}/commits/${headSha}/check-runs`, {key: "check_runs"});
  const out = [];
  for (const c of runs) {
    if (!REQUIRED_CONTEXTS.includes(c?.name)) continue;
    const sid = c.check_suite?.id;
    // Only a found workflow run is cached: a lookup that returned nothing (run not indexed yet) is asked again on the next poll.
    if (!suites.has(sid) && Number.isSafeInteger(sid)) {
      const j = await gh.req("GET", `${r(gh)}/actions/runs?check_suite_id=${sid}&per_page=1`), found = Array.isArray(j?.workflow_runs) ? j.workflow_runs[0] ?? null : null;
      if (found) suites.set(sid, found);
    }
    const wr = suites.get(sid) ?? null;
    out.push({name: c.name, status: c.status, conclusion: c.conclusion, head_sha: c.head_sha, app_slug: c.app?.slug ?? null, completed_at: c.completed_at,
      workflowPath: wr?.path ?? null, workflowRunEvent: wr?.event ?? null});
  }
  return out;
}

// Bounded wait for the required CI contexts to finish on this head. A context never reported, or still running at the deadline, is TIMEOUT.
// A transient poll error (network, 5xx, rate limit) counts as "not done yet"; ACCESS_DENIED still throws. A PR with a merge conflict gets no pull_request CI,
// so two consecutive "mergeable: false" reads on this exact head end the wait early as MERGE_CONFLICT instead of holding a runner for the whole timeout.
export async function waitForCi(gh, headSha, {prNumber = null, timeoutMs = 100 * 60_000, intervalMs = 60_000, sleep = ms => new Promise(res => setTimeout(res, ms)), now = () => Date.now()} = {}) {
  const deadline = now() + timeoutMs, suites = new Map();
  let runs = [], conflicts = 0;
  for (;;) {
    try { runs = await ciCheckRuns(gh, headSha, suites); } catch (e) { if (!(e instanceof GitHubError) || e.code === "ACCESS_DENIED" || e.code === "REPO_INVALID") throw e; }
    const done = REQUIRED_CONTEXTS.every(ctx => { const n = runs.filter(c => c.name === ctx && c.head_sha === headSha); return n.length > 0 && n.every(c => c.status === "completed"); });
    if (done) return {state: "COMPLETED", checkRuns: runs};
    if (Number.isSafeInteger(prNumber) && !runs.some(c => c.head_sha === headSha)) {
      let pr = null;
      try { pr = await gh.req("GET", `${r(gh)}/pulls/${prNumber}`); } catch (e) { if (!(e instanceof GitHubError) || e.code === "ACCESS_DENIED") throw e; }
      conflicts = pr?.head?.sha === headSha && pr?.mergeable === false ? conflicts + 1 : 0;
      if (conflicts >= 2) return {state: "MERGE_CONFLICT", checkRuns: runs};
    }
    if (now() >= deadline) return {state: "TIMEOUT", checkRuns: runs};
    await sleep(intervalMs);
  }
}

// Every input the deterministic gate needs, in the shape docs/planning/merge-gate.mjs evaluates.
export async function collectEvidence(gh, prNumber, {protectedPaths, checkRuns}) {
  const pr = await gh.req("GET", `${r(gh)}/pulls/${prNumber}`);
  const baseRef = pr?.base?.ref;
  const [baseRefObj, reviews, issueComments, diffFiles, rules, commits] = await Promise.all([
    gh.req("GET", `${r(gh)}/git/ref/heads/${enc(baseRef)}`),
    gh.paginate(`${r(gh)}/pulls/${prNumber}/reviews`),
    gh.paginate(`${r(gh)}/issues/${prNumber}/comments`),
    gh.paginate(`${r(gh)}/pulls/${prNumber}/files`),
    gh.req("GET", `${r(gh)}/rules/branches/${enc(baseRef)}`),
    gh.paginate(`${r(gh)}/pulls/${prNumber}/commits`, {maxPages: 3}),
  ]);
  const implementerSessions = [...new Set(commits.flatMap(c => [...String(c?.commit?.message ?? "").matchAll(SESSION_TRAILER_RE)].map(m => m[1])))];
  const commitShas = commits.map(c => c?.sha).filter(x => typeof x === "string" && SHA_RE.test(x));
  return {
    pr: {number: pr.number, state: pr.state, draft: pr.draft, merged: pr.merged, head: {sha: pr.head?.sha, ref: pr.head?.ref, repo: pr.head?.repo?.full_name ?? null},
      base: {ref: baseRef, sha: pr.base?.sha}, user: {login: pr.user?.login}, changed_files: pr.changed_files, commits: pr.commits},
    currentBaseSha: baseRefObj?.object?.sha ?? null,
    checkRuns: checkRuns ?? await ciCheckRuns(gh, pr.head?.sha),
    reviews: reviews.map(x => ({id: x.id, user: {login: x.user?.login ?? null}, state: x.state, commit_id: x.commit_id, body: x.body ?? "", submitted_at: x.submitted_at})),
    issueComments: issueComments.map(x => ({body: x.body ?? "", user: {login: x.user?.login ?? null}})),
    diffFiles: diffFiles.map(f => ({filename: f.filename, status: f.status, ...(f.previous_filename ? {previous_filename: f.previous_filename} : {})})),
    protectedPaths, rules, implementerSessions, commitShas,
  };
}

// The reviewed diff is bound to two validated SHAs (three-dot compare, the same merge-base semantics as the PR view), never to the PR's live base, which the
// shared account can change during a run. GitHub refuses very large diffs (406); that is reported as too large, never as an empty diff.
export async function prDiff(gh, baseSha, headSha, maxBytes = 600_000) {
  if (!SHA_RE.test(String(baseSha)) || !SHA_RE.test(String(headSha))) throw new GitHubError("SHA_INVALID", 0);
  let t;
  try { t = await gh.req("GET", `${r(gh)}/compare/${baseSha}...${headSha}`, {accept: "application/vnd.github.v3.diff", raw: true}); }
  catch (e) { if (e instanceof GitHubError && e.status === 406) return {text: "", truncated: true}; throw e; }
  return Buffer.byteLength(t) > maxBytes ? {text: Buffer.from(t).subarray(0, maxBytes).toString("utf8"), truncated: true} : {text: t, truncated: false};
}

// git's C-style quoted path ("a/\303\244", core.quotePath): returns [decoded, rest] or null when the quoting is malformed.
const ESC = {"\"": 0x22, "\\": 0x5c, a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13};
function unquote(s) {
  if (!s.startsWith("\"")) return null;
  const bytes = [];
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === "\"") return [Buffer.from(bytes).toString("utf8"), s.slice(i + 1)];
    if (c !== "\\") { bytes.push(...Buffer.from(c, "utf8")); continue; }
    const e = s[++i];
    if (e !== undefined && Object.hasOwn(ESC, e)) bytes.push(ESC[e]);
    else if (/^[0-3][0-7]{2}$/.test(s.slice(i, i + 3))) { bytes.push(parseInt(s.slice(i, i + 3), 8)); i += 2; }
    else return null;
  }
  return null;
}
// One path operand: quoted (decoded, nothing may follow) or plain.
const operand = s => { if (!s.startsWith("\"")) return s; const q = unquote(s); return q && q[1] === "" ? q[0] : null; };

// Paths of a unified git diff: every section's new-side path (headers "diff --git a/X b/X", or the "rename to"/"copy to" line) and every rename or copy
// with its source. Quoted names are decoded. Returns null when any section cannot be read unambiguously: the caller then fails closed.
export function diffPaths(text) {
  const newPaths = new Set(), oldPaths = new Set(), moves = [], lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("diff --git ")) continue;
    const h = lines[i].slice("diff --git ".length);
    let from = null, to = null, kind = null;
    // Extended header lines only: they end where the patch body (or a binary marker) begins.
    for (let j = i + 1; j < lines.length && !/^(?:diff --git |@@|--- |\+\+\+ |Binary files )/.test(lines[j]); j++) {
      const m = /^(rename|copy) (from|to) (.+)$/.exec(lines[j]);
      if (!m) continue;
      const p = operand(m[3]);
      if (p === null || (kind !== null && kind !== m[1])) return null;
      kind = m[1];
      if (m[2] === "from") from = p; else to = p;
    }
    let p = null;
    if (kind !== null) { if (from === null || to === null) return null; p = to; moves.push({kind, from, to}); oldPaths.add(from); }
    else if (h.startsWith("\"")) { const qa = unquote(h), qb = qa && qa[1].startsWith(" ") ? operand(qa[1].slice(1)) : null; if (qa && qb !== null && qa[0].startsWith("a/") && qb === `b/${qa[0].slice(2)}`) p = qa[0].slice(2); }
    else if (h.length % 2 === 1) { const mid = (h.length - 1) / 2, a = h.slice(0, mid), b = h.slice(mid + 1); if (h[mid] === " " && a.startsWith("a/") && b === `b/${a.slice(2)}`) p = a.slice(2); }
    if (p === null || p === "") return null;
    newPaths.add(p);
  }
  return {newPaths, oldPaths, moves};
}

// The SHA-bound diff and the PR file list (which drives the protected-path decision) describe the same change on BOTH sides: the same new paths, and every
// rename or copy with the same source. A protected file renamed away therefore cannot hide behind a file list that shows only its new name.
export function sameChange(dp, files) {
  if (dp === null || !Array.isArray(files)) return false;
  const names = new Set(files.map(f => f?.filename));
  if (names.size !== files.length || names.size !== dp.newPaths.size || [...names].some(x => !dp.newPaths.has(x))) return false;
  const moved = files.filter(f => f?.status === "renamed" || f?.status === "copied" || (f?.previous_filename !== undefined && f?.previous_filename !== null));
  if (moved.length !== dp.moves.length) return false;
  const byName = new Map(files.map(f => [f.filename, f]));
  return dp.moves.every(m => { const f = byName.get(m.to); return f !== undefined && f.previous_filename === m.from && f.status === (m.kind === "rename" ? "renamed" : "copied"); });
}

export const commitTree = async (gh, sha) => { const t = (await gh.req("GET", `${r(gh)}/git/commits/${sha}`))?.tree?.sha; return SHA_RE.test(String(t)) ? t : null; };
// Earlier review checks by THIS App (slug) that ended in a substantive negative verdict, on any of the PR's commits. The App alone writes external_id
// ("v2:<0|1>:<tree>:<digest>"), so a same-named check from another source can neither create nor hide such a record.
export async function priorNegativeVerdicts(gh, {appSlug, shas}) {
  if (typeof appSlug !== "string" || appSlug === "") throw new GitHubError("APP_SLUG_MISSING", 0);
  const found = [];
  for (const sha of [...new Set(shas)].filter(x => SHA_RE.test(String(x))).slice(-50)) {
    const runs = await gh.paginate(`${r(gh)}/commits/${sha}/check-runs?check_name=${enc(CHECK_NAME)}&filter=all`, {key: "check_runs", maxPages: 3});
    for (const c of runs) {
      const m = /^v2:1:([0-9a-f]{40}):/.exec(String(c?.external_id ?? ""));
      if (c?.app?.slug === appSlug && c?.conclusion === "failure" && m) found.push({sha, tree: m[1]});
    }
  }
  return found;
}

export const getCheck = (gh, id) => gh.req("GET", `${r(gh)}/check-runs/${id}`);
export const currentHead = async (gh, prNumber) => (await gh.req("GET", `${r(gh)}/pulls/${prNumber}`))?.head?.sha ?? null;
export const runApprovals = (gh, runId) => gh.req("GET", `${r(gh)}/actions/runs/${runId}/approvals`);

// Check-run writes. Only the reviewer App's installation token can create a check that the ruleset pins to the App's integration id.
export const createCheck = (gh, {headSha, title, summary, externalId, detailsUrl}) => gh.req("POST", `${r(gh)}/check-runs`, {body: {name: CHECK_NAME, head_sha: headSha, status: "in_progress",
  ...(externalId ? {external_id: externalId} : {}), ...(detailsUrl ? {details_url: detailsUrl} : {}), output: {title, summary}}});
export const concludeCheck = (gh, id, {conclusion, title, summary, externalId}) => gh.req("PATCH", `${r(gh)}/check-runs/${id}`, {body: {status: "completed", conclusion,
  ...(externalId ? {external_id: externalId} : {}), output: {title, summary}}});
// Optional: an APPROVE review by the reviewer App, pinned to the reviewed commit, so require_last_push_approval can be met without a human.
export const approve = (gh, prNumber, headSha, body) => gh.req("POST", `${r(gh)}/pulls/${prNumber}/reviews`, {body: {commit_id: headSha, event: "APPROVE", body}});
