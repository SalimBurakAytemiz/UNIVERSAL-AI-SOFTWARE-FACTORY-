// //TR: Bu modül UASCO Independent Review için GitHub REST G/Ç katmanıdır: PR, diff, check-run, review, ruleset ve commit kanıtını toplar, CI'ın head SHA üzerinde bitmesini sınırlı süre bekler ve kontrolü yalnız reviewer App token'ı ile yazar; fetch enjekte edilebilir, token hiçbir çıktıya yazılmaz.
import {REQUIRED_CONTEXTS} from "../../../docs/planning/merge-gate.mjs";
import {CHECK_NAME} from "./review-gate.mjs";

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const SESSION_TRAILER_RE = /^Claude-Session:\s*https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})\s*$/gm;

export class GitHubError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }

// Minimal REST client. Errors carry a fixed code and the HTTP status only: response bodies are never echoed (they can hold untrusted text).
export function client({token, repo, fetchImpl = globalThis.fetch, apiUrl = "https://api.github.com", sleep = ms => new Promise(r => setTimeout(r, ms)), retries = 3}) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo))) throw new GitHubError("REPO_INVALID", 0);
  async function req(method, path, {body, accept = "application/vnd.github+json", raw = false} = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${apiUrl}${path}`, {method, headers: {Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "uasco-independent-review",
          ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000)});
      } catch {
        if (attempt < retries) { await sleep(2000 * 2 ** attempt); continue; }
        throw new GitHubError("NETWORK", 0);
      }
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

const r = gh => `/repos/${gh.repo}`;
const enc = s => encodeURIComponent(s);

// Required CI contexts on the head SHA with their workflow provenance (path and event of the Actions run behind each check suite).
export async function ciCheckRuns(gh, headSha) {
  const runs = await gh.paginate(`${r(gh)}/commits/${headSha}/check-runs`, {key: "check_runs"});
  const suites = new Map(), out = [];
  for (const c of runs) {
    if (!REQUIRED_CONTEXTS.includes(c?.name)) continue;
    const sid = c.check_suite?.id;
    if (!suites.has(sid)) {
      let wr = null;
      if (Number.isSafeInteger(sid)) { const j = await gh.req("GET", `${r(gh)}/actions/runs?check_suite_id=${sid}&per_page=1`); wr = Array.isArray(j?.workflow_runs) ? j.workflow_runs[0] ?? null : null; }
      suites.set(sid, wr);
    }
    const wr = suites.get(sid);
    out.push({name: c.name, status: c.status, conclusion: c.conclusion, head_sha: c.head_sha, app_slug: c.app?.slug ?? null, completed_at: c.completed_at,
      workflowPath: wr?.path ?? null, workflowRunEvent: wr?.event ?? null});
  }
  return out;
}

// Bounded wait for the required CI contexts to finish on this head. A context never reported, or still running at the deadline, is TIMEOUT.
export async function waitForCi(gh, headSha, {timeoutMs = 100 * 60_000, intervalMs = 60_000, sleep = ms => new Promise(res => setTimeout(res, ms)), now = () => Date.now()} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const runs = await ciCheckRuns(gh, headSha);
    const done = REQUIRED_CONTEXTS.every(ctx => { const n = runs.filter(c => c.name === ctx && c.head_sha === headSha); return n.length > 0 && n.every(c => c.status === "completed"); });
    if (done) return {state: "COMPLETED", checkRuns: runs};
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
  return {
    pr: {number: pr.number, state: pr.state, draft: pr.draft, merged: pr.merged, head: {sha: pr.head?.sha, ref: pr.head?.ref, repo: pr.head?.repo?.full_name ?? null},
      base: {ref: baseRef, sha: pr.base?.sha}, user: {login: pr.user?.login}, changed_files: pr.changed_files},
    currentBaseSha: baseRefObj?.object?.sha ?? null,
    checkRuns: checkRuns ?? await ciCheckRuns(gh, pr.head?.sha),
    reviews: reviews.map(x => ({id: x.id, user: {login: x.user?.login ?? null}, state: x.state, commit_id: x.commit_id, body: x.body ?? "", submitted_at: x.submitted_at})),
    issueComments: issueComments.map(x => ({body: x.body ?? "", user: {login: x.user?.login ?? null}})),
    diffFiles: diffFiles.map(f => ({filename: f.filename, status: f.status, ...(f.previous_filename ? {previous_filename: f.previous_filename} : {})})),
    protectedPaths, rules, implementerSessions,
  };
}

export async function prDiff(gh, prNumber, maxBytes = 600_000) {
  const t = await gh.req("GET", `${r(gh)}/pulls/${prNumber}`, {accept: "application/vnd.github.v3.diff", raw: true});
  return Buffer.byteLength(t) > maxBytes ? {text: Buffer.from(t).subarray(0, maxBytes).toString("utf8"), truncated: true} : {text: t, truncated: false};
}

export const currentHead = async (gh, prNumber) => (await gh.req("GET", `${r(gh)}/pulls/${prNumber}`))?.head?.sha ?? null;
export const runApprovals = (gh, runId) => gh.req("GET", `${r(gh)}/actions/runs/${runId}/approvals`);

// Check-run writes. Only the reviewer App's installation token can create a check that the ruleset pins to the App's integration id.
export const createCheck = (gh, {headSha, title, summary, externalId, detailsUrl}) => gh.req("POST", `${r(gh)}/check-runs`, {body: {name: CHECK_NAME, head_sha: headSha, status: "in_progress",
  ...(externalId ? {external_id: externalId} : {}), ...(detailsUrl ? {details_url: detailsUrl} : {}), output: {title, summary}}});
export const concludeCheck = (gh, id, {conclusion, title, summary, externalId}) => gh.req("PATCH", `${r(gh)}/check-runs/${id}`, {body: {status: "completed", conclusion,
  ...(externalId ? {external_id: externalId} : {}), output: {title, summary}}});
// Optional: an APPROVE review by the reviewer App, pinned to the reviewed commit, so require_last_push_approval can be met without a human.
export const approve = (gh, prNumber, headSha, body) => gh.req("POST", `${r(gh)}/pulls/${prNumber}/reviews`, {body: {commit_id: headSha, event: "APPROVE", body}});
