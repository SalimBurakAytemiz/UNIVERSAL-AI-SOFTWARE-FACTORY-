// //TR: Factory V2 yerel git entegrasyon adaptörü: Exclusive Writer'ın birleştirmesi ayrık bir entegrasyon worktree'sinde --no-ff merge commit üretir ve kanonik dalı `update-ref <yeni> <beklenen-taban>` ile CAS'lar (taban hareket ettiyse BASE_MOVED, çakışma MERGE_CONFLICT); sonuç SHA'sı yeniden okunarak doğrulanır. Canlı GitHub yazısı bu adaptörle değil, mevcut yönetişimli executor (docs/planning/autonomy/executor.mjs) ile yapılır.
import fs from "node:fs";
import {spawnSync} from "node:child_process";
const run = (cwd, args) => { const r = spawnSync("git", args, {cwd, encoding: "utf8"}); return {ok: r.status === 0, out: (r.stdout ?? "").trim(), err: r.stderr ?? ""}; };
export function createLocalGitIntegration({repoDir, branch, scratchDir}) {
  const ref = `refs/heads/${branch}`;
  return {
    readCanonical: () => run(repoDir, ["rev-parse", ref]).out,
    async merge(cand, expectedBase) {
      fs.rmSync(scratchDir, {recursive: true, force: true});
      if (!run(repoDir, ["worktree", "add", "-q", "--detach", scratchDir, expectedBase]).ok) return {ok: false, reason: "INTEGRATION_WORKTREE_FAILED"};
      try {
        const m = run(scratchDir, ["-c", "user.name=factory-v2-writer", "-c", "user.email=factory-v2@invalid", "merge", "--no-ff", "-q", "-m", `Merge ${cand.taskId} (${cand.headSha})`, cand.headSha]);
        if (!m.ok) { run(scratchDir, ["merge", "--abort"]); return {ok: false, reason: "MERGE_CONFLICT"}; }
        const sha = run(scratchDir, ["rev-parse", "HEAD"]).out;
        return run(repoDir, ["update-ref", ref, sha, expectedBase]).ok ? {ok: true, resultSha: sha} : {ok: false, reason: "BASE_MOVED"};
      } finally { run(repoDir, ["worktree", "remove", "--force", scratchDir]); }
    },
    async verifyRemote(sha) { return run(repoDir, ["rev-parse", ref]).out === sha && run(repoDir, ["merge-base", "--is-ancestor", sha, ref]).ok; }
  };
}
