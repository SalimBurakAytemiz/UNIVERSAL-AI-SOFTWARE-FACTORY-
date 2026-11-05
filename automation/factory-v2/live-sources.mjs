// //TR: Factory V2 canlı kaynaklar: kabul kapısı doğrulaması ve manifest tazeliği için veriyi çağırandan DEĞİL, doğrudan kanonik git deposundan (origin/v7/integration, salt-okunur fetch) ve GitHub REST API'den (salt-okunur) okur. Köprü bu sağlayıcıları kendisi çağırır; bir çağıran bayat/sahte "güncel durum" veremez.
import {spawnSync} from "node:child_process";
import {snapshotV41} from "./bridge.mjs";
import {client} from "../../scripts/ci/uasco-review/github.mjs";

export const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-";
export const BASE = "v7/integration";
/** The repository's code-backed GitHub REST adapter (adapter-reality "github"): fixed error codes, bounded retries, rate-limit waits. */
export const githubClient = ({token = process.env.GITHUB_TOKEN, repo = REPO} = {}) => client({token, repo});
const repoPath = (gh, p) => `/repos/${gh.repo}/${p}`;
export const ghGet = (gh, p) => gh.req("GET", repoPath(gh, p));
/** Server-enforced protection of a branch (rulesets): force-push (non_fast_forward) and deletion both forbidden. */
export async function branchProtected(gh, branch) {
  const rules = await ghGet(gh, `rules/branches/${encodeURIComponent(branch)}`);
  const types = new Set((Array.isArray(rules) ? rules : []).map(r => r?.type));
  return types.has("non_fast_forward") && types.has("deletion");
}
/** All open PRs, read live through the adapter. */
export const openPrsLive = gh => gh.paginate(repoPath(gh, "pulls?state=open"));
export const closedPrsLive = (gh, maxPages = 10) => gh.paginate(repoPath(gh, "pulls?state=closed"), {maxPages});
/**
 * Fetch, right now and through the adapter, every GitHub document gate-verifier needs for these gates (keyed by the relative path
 * verifyGates asks for). A failed fetch is stored as an error and re-thrown when the verifier reads it: nothing is supplied by the caller.
 */
export async function prefetchGateEvidence(gh, gates) {
  const paths = [];
  const pr = gates?.reviewClean?.pr, head = gates?.ciPassed?.headSha, merge = gates?.migrationAcceptance?.mergeSha;
  if (Number.isInteger(pr)) paths.push(`pulls/${pr}`, `pulls/${pr}/files?per_page=100`, `pulls/${pr}/reviews?per_page=100`, `pulls/${pr}/commits?per_page=100`);
  if (/^[0-9a-f]{40}$/.test(head ?? "")) paths.push(`commits/${head}/check-runs?per_page=100`);
  if (/^[0-9a-f]{40}$/.test(merge ?? "")) paths.push(`actions/runs?head_sha=${merge}&event=push&per_page=50`);
  const out = {};
  for (const p of paths) { try { out[p] = {ok: await ghGet(gh, p)}; } catch (e) { out[p] = {err: String(e?.code ?? e?.message ?? e)}; } }
  return p => { const v = out[p]; if (!v) throw new Error(`GH_NOT_FETCHED:${p}`); if (v.err) throw new Error(`GH_${v.err}:${p}`); return v.ok; };
}

export function liveGit({repoRoot, remote = "origin", baseRef = BASE}) {
  const run = a => spawnSync("git", a, {cwd: repoRoot, encoding: "utf8", maxBuffer: 64 << 20});
  const canonicalSha = () => {
    const r = run(["ls-remote", remote, `refs/heads/${baseRef}`]); const sha = r.stdout.split(/\s+/)[0];
    if (r.status !== 0 || !/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("CANONICAL_UNREADABLE");
    if (run(["cat-file", "-e", `${sha}^{commit}`]).status !== 0 && run(["fetch", "-q", "--no-tags", remote, `+refs/heads/${baseRef}:refs/uasco-live/base`]).status !== 0) throw new Error("CANONICAL_FETCH_FAILED");
    return sha;
  };
  return {
    canonicalSha,
    isAncestor: (a, b) => run(["merge-base", "--is-ancestor", a, b]).status === 0,
    show: (sha, p) => { const r = run(["show", `${sha}:${p}`]); return r.status === 0 ? r.stdout : null; }
  };
}


/**
 * Freshness provider for AuthorityBridge.commit(): canonical SHA and the STATE.json digest at that SHA are read from git at call time;
 * `openPrs` is the list this process fetched through the adapter immediately before the commit (refresh() re-fetches it).
 */
export function liveFreshness({repoRoot, gh = githubClient()}) {
  const g = liveGit({repoRoot});
  let prs = null;
  return {
    async refresh() { prs = await openPrsLive(gh); return prs; },
    canonicalSha: () => g.canonicalSha(),
    openPrs: () => { if (!prs) throw new Error("OPEN_PRS_NOT_FETCHED"); return prs; },
    stateDigest: sha => { const t = g.show(sha, "docs/planning/autonomy/STATE.json"); if (t == null) throw new Error("STATE_UNREADABLE"); return snapshotV41({baseRef: BASE, baseSha: sha, autonomyState: JSON.parse(t), taskIndex: {tasks: []}}).stateDigest; }
  };
}

/** Deps for gate-verifier.verifyGates(): prefetched GitHub reader (prefetchGateEvidence) + canonical git + trusted logins from canonical policy. */
export function liveGateDeps({repoRoot, gh, builderSessions = new Set()}) {
  if (typeof gh !== "function") throw new Error("GH_READER_REQUIRED");
  const g = liveGit({repoRoot});
  const policyText = g.show(g.canonicalSha(), "docs/planning/autonomy/standing-authority.json");
  const policy = policyText ? JSON.parse(policyText) : {};
  return {gh, git: g, trustedReviewerLogins: policy.trustedReviewerLogins ?? [], builderSessions, baseRef: BASE};
}
