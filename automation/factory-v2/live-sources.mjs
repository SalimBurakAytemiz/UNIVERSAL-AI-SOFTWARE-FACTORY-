// //TR: Factory V2 canlı kaynaklar: kabul kapısı doğrulaması ve manifest tazeliği için veriyi çağırandan DEĞİL, doğrudan kanonik git deposundan (origin/v7/integration, salt-okunur fetch) ve GitHub REST API'den (salt-okunur) okur. Köprü bu sağlayıcıları kendisi çağırır; bir çağıran bayat/sahte "güncel durum" veremez.
import {execFileSync, spawnSync} from "node:child_process";
import {snapshotV41} from "./bridge.mjs";

export const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-";
export const BASE = "v7/integration";
export const githubApi = (repo = REPO) => p => JSON.parse(execFileSync("curl", ["-sSf", "-H", "Accept: application/vnd.github+json", `https://api.github.com/repos/${repo}/${p}`], {maxBuffer: 64 << 20}).toString("utf8"));

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

const listOpen = gh => { const out = []; for (let page = 1; page <= 10; page++) { const r = gh(`pulls?state=open&per_page=100&page=${page}`); out.push(...r); if (r.length < 100) break; } return out; };

/** Freshness provider for AuthorityBridge.commit(): canonical SHA, open PRs and the STATE.json digest at that SHA, all read live. */
export function liveFreshness({repoRoot, gh = githubApi()}) {
  const g = liveGit({repoRoot});
  return {
    canonicalSha: () => g.canonicalSha(),
    openPrs: () => listOpen(gh),
    stateDigest: sha => { const t = g.show(sha, "docs/planning/autonomy/STATE.json"); if (t == null) throw new Error("STATE_UNREADABLE"); return snapshotV41({baseRef: BASE, baseSha: sha, autonomyState: JSON.parse(t), taskIndex: {tasks: []}}).stateDigest; }
  };
}

/** Deps for gate-verifier.verifyGates(): GitHub + canonical git + trusted logins from the canonical standing-authority policy. */
export function liveGateDeps({repoRoot, gh = githubApi(), builderSessions = new Set()}) {
  const g = liveGit({repoRoot});
  const policyText = g.show(g.canonicalSha(), "docs/planning/autonomy/standing-authority.json");
  const policy = policyText ? JSON.parse(policyText) : {};
  return {gh, git: g, trustedReviewerLogins: policy.trustedReviewerLogins ?? [], builderSessions, baseRef: BASE};
}
