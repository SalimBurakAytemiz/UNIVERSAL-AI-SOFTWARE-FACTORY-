// //TR: Factory V2 paylaşımlı belge deposu: JSON belgeleri git ref'lerinde tutar ve compare-and-swap ile günceller; uzak (origin) backend `push --force-with-lease=<ref>:<beklenen-sha>` kullanır, yani atomiklik ortak sunucunun ref kilidinden gelir ve farklı bulut ortamları arasında geçerlidir. Yerel dosya kilidi bu deponun sahiplik garantisinin parçası değildir.
import {spawnSync} from "node:child_process";
const ZERO = "0".repeat(40);
const NAME = /^refs\/(uasco|heads\/uasco)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const checkRef = r => { if (!NAME.test(r) || r.includes("..") || r.endsWith(".lock") || r.endsWith("/")) throw new Error(`REFDOC_REF_INVALID:${r}`); return r; };

// Each version is a commit (tree: doc.json) whose parent is the previous version, so the same store works on refs/uasco/* and on
// a dedicated branch (GitHub refuses non-commit objects under refs/heads/), and the full authority history stays auditable.
const AUTHOR = ["-c", "user.name=uasco-factory-v2", "-c", "user.email=uasco-factory-v2@invalid"];
function makeDocStore(ops, kind) {
  const ok = r => { if (r.status !== 0) throw new Error("REFDOC_GIT_FAILED"); return r.stdout.trim(); };
  const commitOf = (doc, parent) => {
    const blob = ok(ops.git(["hash-object", "-w", "--stdin"], JSON.stringify(doc, null, 2) + "\n"));
    const tree = ok(ops.git(["mktree"], `100644 blob ${blob}\tdoc.json\n`));
    return ok(ops.git([...AUTHOR, "commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `uasco doc ${doc?.phase ?? doc?.schema ?? "update"}`]));
  };
  const read = ref => {
    const sha = ops.sha(checkRef(ref)); if (!sha) return {sha: null, doc: null};
    const r = ops.git(["show", `${sha}:doc.json`]); if (r.status !== 0) throw new Error("REFDOC_READ_FAILED");
    try { return {sha, doc: JSON.parse(r.stdout)}; } catch { throw new Error("REFDOC_UNPARSEABLE"); } // unreadable shared state fails closed
  };
  return {
    kind, read,
    /** CAS: expectedSha null = must not exist. Returns {ok, sha, current}. */
    cas(ref, expectedSha, doc) {
      checkRef(ref);
      if (expectedSha && ops.git(["cat-file", "-e", `${expectedSha}^{commit}`]).status !== 0) return {ok: false, sha: null, current: read(ref)}; // unknown expectation is never a write
      const n = commitOf(doc, expectedSha);
      if (ops.put(ref, n, expectedSha)) return {ok: true, sha: n};
      return {ok: false, sha: null, current: read(ref)};
    },
    remove(ref, expectedSha) { return ops.del(checkRef(ref), expectedSha); },
    /** Every version of the document reachable from the ref, oldest first (first-parent chain; at most `max`). Fails closed. */
    history(ref, max = 2000) {
      const sha = ops.sha(checkRef(ref)); if (!sha) return [];
      const r = ops.git(["rev-list", "--first-parent", `--max-count=${max}`, sha]); if (r.status !== 0) throw new Error("REFDOC_HISTORY_FAILED");
      const shas = r.stdout.split("\n").filter(Boolean);
      if (shas.length >= max) throw new Error("REFDOC_HISTORY_TOO_LONG");
      return shas.reverse().map(c => { const s = ops.git(["show", `${c}:doc.json`]); if (s.status !== 0) throw new Error("REFDOC_HISTORY_UNREADABLE"); try { return {sha: c, doc: JSON.parse(s.stdout)}; } catch { throw new Error("REFDOC_HISTORY_UNPARSEABLE"); } });
    }
  };
}

export function createLocalDocStore(repoDir) {
  const git = (args, input) => { const r = spawnSync("git", args, {cwd: repoDir, input, encoding: "utf8"}); return {status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? ""}; };
  return makeDocStore({git, sha: ref => { const r = git(["rev-parse", "--verify", "-q", ref]); return r.status === 0 ? r.stdout.trim() : null; },
    put: (ref, n, o) => git(["update-ref", ref, n, o ?? ZERO]).status === 0, del: (ref, o) => git(["update-ref", "-d", ref, o]).status === 0}, "LOCAL_GIT_REF");
}

/** runGit(args,input) runs git in a local clone whose `remote` is the shared origin. */
export function createRemoteDocStore({runGit, remote = "origin"}) {
  if (typeof runGit !== "function") throw new Error("REFDOC_RUNGIT_REQUIRED");
  const sha = ref => {
    const r = runGit(["ls-remote", remote, ref]); if (r.status !== 0) throw new Error("REFDOC_REMOTE_UNREACHABLE"); // unreachable != absent
    const l = r.stdout.split("\n").map(x => x.trim().split(/\s+/)).find(p => p[1] === ref);
    if (!l) return null;
    if (runGit(["fetch", "--no-tags", "-q", remote, `+${ref}:${ref}`]).status !== 0) throw new Error("REFDOC_REMOTE_FETCH_FAILED");
    return l[0];
  };
  return makeDocStore({git: runGit, sha,
    put: (ref, n, o) => runGit(["push", "-q", remote, `${n}:${ref}`, `--force-with-lease=${ref}:${o ?? ""}`]).status === 0,
    del: (ref, o) => runGit(["push", "-q", remote, `:${ref}`, `--force-with-lease=${ref}:${o}`]).status === 0}, "REMOTE_GIT_REF");
}

export const gitRunner = cwd => (args, input) => { const r = spawnSync("git", args, {cwd, input, encoding: "utf8"}); return {status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? ""}; };
