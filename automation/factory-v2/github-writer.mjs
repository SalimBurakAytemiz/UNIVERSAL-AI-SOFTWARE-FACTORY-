// //TR: Factory V2 canlı Merge Writer adaptörü: kanonik dala kendi yazmaz; FD-2026-11-03 yönetişimli yürütücüsünü (docs/planning/autonomy/executor.mjs merge) çağırır — o da autonomy kararını, beklenen head SHA ile merge'ü ve ebeveyn doğrulamasını uygular. Adaptör yalnız Writer lease'i fence'lenmiş ve otorite kaydı V2'yi gösterirken çağrılır; FOUNDER_REQUIRED/BLOCK asla merge sayılmaz.
import {spawnSync} from "node:child_process";
import path from "node:path";
const SHA = /^[0-9a-f]{40}$/;
export function createGovernedGithubWriter({repoRoot, baseRef = "v7/integration", remote = "origin", run = (f, a, o) => spawnSync(f, a, {encoding: "utf8", ...o})}) {
  return {
    readCanonical() { const r = run("git", ["ls-remote", remote, `refs/heads/${baseRef}`], {cwd: repoRoot}); const sha = r.stdout?.split(/\s+/)[0]; if (r.status !== 0 || !SHA.test(sha ?? "")) throw new Error("CANONICAL_UNREADABLE"); return sha; },
    async merge(cand) {
      if (!Number.isInteger(cand.pr)) return {ok: false, reason: "NO_PR"};
      const sessions = (cand.implementerSessions ?? []).flatMap(s => ["--implementer-session", s]);
      if (!sessions.length) return {ok: false, reason: "IMPLEMENTER_SESSION_MISSING"};
      const r = run(process.execPath, [path.join(repoRoot, "docs/planning/autonomy/executor.mjs"), "merge", "--pr", String(cand.pr), ...sessions], {cwd: repoRoot});
      let out; try { out = JSON.parse((r.stdout ?? "").trim().split("\n").at(-1)); } catch { return {ok: false, reason: "EXECUTOR_OUTPUT_INVALID"}; }
      if (out.decision === "MERGED_VERIFIED" && SHA.test(out.mergeSha ?? "") && out.expectedHeadSha === cand.headSha) return {ok: true, resultSha: out.mergeSha};
      return {ok: false, reason: out.decision === "FOUNDER_REQUIRED" ? "FOUNDER_REQUIRED" : `EXECUTOR_${out.decision ?? "UNKNOWN"}`};
    },
    async verifyRemote(sha) { const r = run("git", ["fetch", "-q", remote, baseRef], {cwd: repoRoot}); if (r.status !== 0) return false; return run("git", ["merge-base", "--is-ancestor", sha, `${remote}/${baseRef}`], {cwd: repoRoot}).status === 0; }
  };
}
