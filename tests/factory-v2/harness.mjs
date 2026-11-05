// //TR: Factory V2 test düzeneği: geçici gerçek git deposu, gerçek alt-süreç yürütücüsü (demo-worker) ve yerel git entegrasyonu ile Supervisor kurar; ağ, model veya ücretli kaynak kullanmaz.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {FactorySupervisor} from "../../automation/factory-v2/supervisor.mjs";
import {LocalProcessExecutor} from "../../automation/factory-v2/executors.mjs";
import {createLocalGitIntegration} from "../../automation/factory-v2/merge-git.mjs";
import {createGitStore} from "../../automation/factory-v2/ownership.mjs";

export const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../automation/factory-v2/demo-worker.mjs");
export const git = (cwd, ...a) => { const r = spawnSync("git", a, {cwd, encoding: "utf8"}); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

export function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "integ");
  fs.writeFileSync(path.join(repo, "README.txt"), "base\n");
  git(repo, "add", "README.txt");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-q", "-m", "base");
  return {root, repo, base: git(repo, "rev-parse", "HEAD")};
}

export function tasks(n, extra = {}) {
  return Array.from({length: n}, (_, i) => ({id: `FV2-T${String(i + 1).padStart(4, "0")}`, tier: "T0", status: "PROPOSED", deps: [], startGates: [], name: `demo ${i + 1}`, paths: [`work/FV2-T${String(i + 1).padStart(4, "0")}.txt`], ...(extra[i] ?? {})}));
}

export function makeSupervisor(env, o = {}) {
  const {repo, root, base} = env;
  const evidence = o.evidence ?? [];
  const executor = new LocalProcessExecutor({repoDir: repo, worktreeRoot: path.join(root, "wt"), baseSha: base, command: () => [process.execPath, [WORKER]], evidence});
  const integ = createLocalGitIntegration({repoDir: repo, branch: "integ", scratchDir: path.join(root, "integration")});
  const backlog = o.backlog ?? tasks(8);
  const sup = new FactorySupervisor({
    repoDir: repo, domain: o.domain ?? "test", mode: o.mode ?? "SHADOW", sessionId: o.sessionId ?? "session_supervisorA1", journalDir: o.journalDir ?? path.join(root, "journal"),
    leaseStore: o.leaseStore ?? createGitStore(repo, "SHADOW"), executor, backlog: () => backlog, leaseTtlMs: o.leaseTtlMs ?? 60_000, target: o.target,
    liveOwned: o.liveOwned, quota: o.quota, now: o.now,
    mergeFacts: t => ({
      candidate: {taskId: t.taskId, headSha: t.data.headSha, baseSha: t.data.baseSha, changedPaths: t.data.changedPaths ?? [], allowedPaths: ["work/"], builderIdentity: t.data.builderIdentity,
        priorBlockers: t.data.priorBlockers ?? [], required: t.data.required ?? []},
      canonicalSha: integ.readCanonical(), conflicts: false, baseDeltaOverlaps: false, verdicts: t.data.verdicts ?? [],
      // local deterministic check bound to the head SHA (a stand-in for required CI in this harness; never reported as GitHub CI)
      ci: {sha: t.data.headSha, requiredContexts: {"local-check": spawnSync("git", ["cat-file", "-e", `${t.data.headSha}:${(t.data.changedPaths ?? ["missing"])[0]}`], {cwd: repo}).status === 0 ? "success" : "failure"}},
      protectedPaths: {exactPaths: [], protectedPrefixes: ["config/"]}
    }),
    git: o.git ?? integ,
    postMergeVerify: async t => spawnSync("git", ["cat-file", "-e", `integ:${t.data.changedPaths[0]}`], {cwd: repo}).status === 0
  });
  return {sup, executor, evidence, integ};
}

export async function runUntil(sup, pred, {timeoutMs = 60_000, everyMs = 100} = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { await sup.tick(); if (pred()) return true; await new Promise(r => setTimeout(r, everyMs)); }
  return false;
}
