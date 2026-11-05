// //TR: Factory V2 komut satırı: `plan` kanonik backlog'u (task-index.json) canlı V4.1 sahipliğini (STATE.json inFlight + açık PR UASCO-TASK satırları) dışlayarak 8 Builder'a salt-okunur planlar (claim yazmaz); `evidence` geçici izole depoda gerçek alt süreçlerle SHADOW teslim hattını koşar ve PID/zaman damgası/örtüşme kanıtı yazar; `intents` bulut oturum köprüsünün bekleyen/bağlı kayıtlarını yönetir.
// Usage:
//   node automation/factory-v2/cli.mjs plan [--builders 8] [--open-prs prs.json]
//   node automation/factory-v2/cli.mjs evidence [--out file.json] [--builders 8] [--hold-ms 1500]
//   node automation/factory-v2/cli.mjs intents list|bind <intentId> <sessionId>|complete <intentId> <result.json> --dir <dir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {buildTopology, INITIAL_TARGET} from "./topology.mjs";
import {readyTasks, assign, liveOwnedTasks} from "./scheduler.mjs";
import {FactorySupervisor, maxOverlap} from "./supervisor.mjs";
import {LocalProcessExecutor, CloudSessionIntentExecutor} from "./executors.mjs";
import {createLocalGitIntegration} from "./merge-git.mjs";
import {createGitStore} from "./ownership.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));

function plan() {
  const builders = Number(arg("builders", INITIAL_TARGET.builders));
  const index = readJson(path.join(ROOT, "docs/planning/autonomy/task-index.json"));
  const state = readJson(path.join(ROOT, "docs/planning/autonomy/STATE.json"));
  const openPrs = arg("open-prs") ? readJson(arg("open-prs")) : [];
  const done = new Set((state.done ?? []).map(d => d.task));
  const live = liveOwnedTasks({autonomyState: state, openPrs});
  const ready = readyTasks(index.tasks, {done, excluded: live, allowedTiers: ["T0", "T1", "T2"]});
  const slots = buildTopology({...INITIAL_TARGET, builders}).slots.filter(s => s.role === "BUILDER");
  const a = assign(ready, slots);
  const out = {mode: "PLAN_ONLY_NO_CLAIMS", builders, backlog: index.tasks.length, liveOwnedExcluded: [...live].sort(), readyIndependent: ready.length, assignments: a.map(x => ({...x, name: index.tasks.find(t => t.id === x.taskId)?.name}))};
  console.log(JSON.stringify(out, null, 2));
}

async function evidence() {
  const builders = Number(arg("builders", 8));
  process.env.FACTORY_HOLD_MS = arg("hold-ms", "1500");
  delete process.env.FACTORY_FAIL;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fv2-evidence-"));
  const repo = path.join(root, "repo"); fs.mkdirSync(repo);
  const g = (...a) => { const r = spawnSync("git", a, {cwd: repo, encoding: "utf8"}); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  g("init", "-q", "-b", "integ"); fs.writeFileSync(path.join(repo, "README.txt"), "base\n"); g("add", "."); g("-c", "user.name=e", "-c", "user.email=e@invalid", "commit", "-q", "-m", "base");
  const base = g("rev-parse", "HEAD");
  const ev = [];
  const executor = new LocalProcessExecutor({repoDir: repo, worktreeRoot: path.join(root, "wt"), baseSha: base, command: () => [process.execPath, [path.join(HERE, "demo-worker.mjs")]], evidence: ev});
  const integ = createLocalGitIntegration({repoDir: repo, branch: "integ", scratchDir: path.join(root, "integration")});
  const backlog = Array.from({length: builders}, (_, i) => ({id: `EV-T${String(i + 1).padStart(4, "0")}`, tier: "T1", status: "PROPOSED", deps: [], paths: [`work/EV-T${String(i + 1).padStart(4, "0")}.txt`]}));
  const sup = new FactorySupervisor({domain: "evidence", mode: "SHADOW", sessionId: `session_evidence${process.pid}`, journalDir: path.join(root, "journal"), leaseStore: createGitStore(repo, "SHADOW"),
    executor, backlog: () => backlog, target: {...INITIAL_TARGET, builders: Math.max(builders, 1)},
    mergeFacts: t => ({candidate: {taskId: t.taskId, headSha: t.data.headSha, baseSha: t.data.baseSha, changedPaths: t.data.changedPaths, allowedPaths: ["work/"], builderIdentity: t.data.builderIdentity, priorBlockers: [], required: t.data.required},
      canonicalSha: integ.readCanonical(), conflicts: false, baseDeltaOverlaps: false, verdicts: t.data.verdicts, ci: {sha: t.data.headSha, requiredContexts: {"local-check": "success"}}, protectedPaths: readJson(path.join(ROOT, "config/protected-paths.json"))}),
    git: integ, postMergeVerify: async t => spawnSync("git", ["cat-file", "-e", `integ:${t.data.changedPaths[0]}`], {cwd: repo}).status === 0});
  const started = sup.start();
  const t0 = Date.now();
  while (sup.journal.inState("VERIFIED").length < builders && Date.now() - t0 < 120_000) { await sup.tick(); await new Promise(r => setTimeout(r, 100)); }
  const role = r => sup.spans.filter(s => s.role === r);
  const out = {
    "//TR": "Factory V2 SHADOW kanıtı: geçici izole depoda gerçek alt süreçler (model çağrısı yok); canlı fabrika aktivasyonu DEĞİLDİR.",
    kind: "SHADOW_LOCAL_PROCESS_EVIDENCE", isLiveActivation: false, startedAt: new Date(t0).toISOString(), supervisor: {sessionId: sup.o.sessionId, epoch: started.epoch},
    measured: {maxConcurrentBuilders: maxOverlap(role("BUILDER")), maxConcurrentReviewers: maxOverlap(role("REVIEWER")), preparerWorkersUsed: new Set(role("MERGE_PREPARER").map(s => s.slotId)).size, // local preparation is synchronous here; overlap is proven by test A3
      distinctReviewerSlots: new Set(role("REVIEWER").map(s => s.slotId)).size,
      distinctBuilderPids: new Set(ev.filter(e => e.role === "BUILDER").map(e => e.pid)).size, verified: sup.journal.inState("VERIFIED").length, mergeCommits: g("log", "--merges", "--format=%H", "integ").split("\n").filter(Boolean).length},
    processes: ev.map(e => ({role: e.role, slotId: e.slotId, taskId: e.taskId, pid: e.pid, startedAt: new Date(e.startedAt).toISOString(), endedAt: new Date(e.endedAt).toISOString(), exit: e.code})),
    report: sup.report()
  };
  sup.stop();
  const file = arg("out");
  if (file) fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out.measured));
  fs.rmSync(root, {recursive: true, force: true});
  if (out.measured.verified !== builders) process.exit(2);
}

function intents() {
  const ex = new CloudSessionIntentExecutor({dir: arg("dir"), promptFor: () => ""});
  const [, , , sub, a, b] = process.argv;
  if (sub === "list") console.log(JSON.stringify(ex.pending(), null, 2));
  else if (sub === "bind") { ex.bind(a, b); console.log("BOUND"); }
  else if (sub === "complete") { ex.complete(a, readJson(b)); console.log("COMPLETED"); }
  else { console.error("intents list|bind|complete"); process.exit(1); }
}

const cmd = process.argv[2];
if (cmd === "plan") plan();
else if (cmd === "evidence") await evidence();
else if (cmd === "intents") intents();
else { console.error("usage: cli.mjs plan|evidence|intents"); process.exit(1); }
