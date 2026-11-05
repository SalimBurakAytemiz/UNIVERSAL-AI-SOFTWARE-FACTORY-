// //TR: Factory V2 komut satırı: `plan` kanonik backlog'u (task-index.json) canlı V4.1 sahipliğini (STATE.json inFlight + açık PR UASCO-TASK satırları) dışlayarak 8 Builder'a salt-okunur planlar (claim yazmaz); `evidence` geçici izole depoda gerçek alt süreçlerle SHADOW teslim hattını koşar ve PID/zaman damgası/örtüşme kanıtı yazar; `intents` bulut oturum köprüsünün bekleyen/bağlı kayıtlarını yönetir.
// Usage:
//   node automation/factory-v2/cli.mjs plan [--builders 8] [--open-prs prs.json]
//   node automation/factory-v2/cli.mjs evidence [--out file.json] [--builders 8] [--hold-ms 1500]
//   node automation/factory-v2/cli.mjs intents list|bind <intentId> <sessionId>|complete <intentId> <result.json> --dir <dir>
//   node automation/factory-v2/cli.mjs bridge snapshot [--out manifest.json] [--version n]   (read-only: origin + GitHub API)
//   node automation/factory-v2/cli.mjs bridge status                                         (read-only: shared authority record)
//   node automation/factory-v2/cli.mjs bridge probe-store                                    (capability check: CAS create+delete of one probe ref)
//   node automation/factory-v2/cli.mjs bridge prepare --manifest f --gates f | ack --manifest f --drain f | commit --manifest f | rollback --reason r
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
import {createRemoteDocStore, gitRunner} from "./ref-doc-store.mjs";
import {AuthorityBridge, snapshotV41, buildManifest, reconcile} from "./bridge.mjs";
import {execFileSync} from "node:child_process";

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
  const sup = new FactorySupervisor({repoDir: repo, domain: "evidence", mode: "SHADOW", sessionId: `session_evidence${process.pid}`, journalDir: path.join(root, "journal"), leaseStore: createGitStore(repo, "SHADOW"),
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

const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-", BASE = "v7/integration", DOMAIN = "uasco-v7";
const api = p => JSON.parse(execFileSync("curl", ["-sSf", "-H", "Accept: application/vnd.github+json", `https://api.github.com/repos/${REPO}/${p}`], {maxBuffer: 64 << 20}).toString("utf8"));
const listPrs = state => { const out = []; for (let page = 1; page <= 10; page++) { const r = api(`pulls?state=${state}&per_page=100&page=${page}`); out.push(...r); if (r.length < 100) break; } return out; };
async function bridge() {
  const sub = process.argv[3];
  const docs = createRemoteDocStore({runGit: gitRunner(ROOT)});
  const b = () => new AuthorityBridge({docStore: docs, domain: DOMAIN});
  const actor = process.env.CLAUDE_SESSION_ID ?? arg("actor", "unknown");
  if (sub === "snapshot") {
    const g = a => execFileSync("git", a, {cwd: ROOT, maxBuffer: 64 << 20}).toString("utf8");
    g(["fetch", "-q", "origin", BASE]);
    const baseSha = g(["rev-parse", `origin/${BASE}`]).trim();
    const show = f => JSON.parse(g(["show", `${baseSha}:${f}`]));
    const open = listPrs("open");
    const merged = listPrs("closed").filter(p => p.merged_at && p.base?.ref === BASE);
    const snapshot = snapshotV41({baseRef: BASE, baseSha, autonomyState: show("docs/planning/autonomy/STATE.json"), taskIndex: show("docs/planning/autonomy/task-index.json"), openPrs: open, mergedPrs: merged});
    const cur = b().read().doc;
    const m = buildManifest({domain: DOMAIN, version: Number(arg("version", (cur.manifest?.version ?? 0) + 1)), snapshot, fromSession: arg("from", "V4.1"), toSession: arg("to", "UNASSIGNED")});
    const rec = reconcile(m, {acks: {}});
    if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(m, null, 2) + "\n");
    console.log(JSON.stringify({mode: "READ_ONLY_SYNC", authority: cur.authority, phase: cur.phase, baseSha, digest: m.digest, done: snapshot.done.length, mergedPrTasks: snapshot.mergedPrTasks.length,
      openPrs: snapshot.openPrs.map(p => `${p.pr}:${p.task ?? "-"}@${p.headSha.slice(0, 8)}${p.baseRef === BASE ? "" : ` (stacked on ${p.baseRef})`}`), inFlight: snapshot.inFlight.map(f => f.task), blocked: snapshot.blocked.map(f => f.task),
      reconcile: {planned: rec.plan.length, unresolvedWithoutDrainAck: rec.unresolved}}, null, 2));
  } else if (sub === "status") console.log(JSON.stringify(b().read(), null, 2));
  else if (sub === "probe-store") {
    const ref = `refs/uasco/factory-v2/probe/${String(actor).replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const c = docs.cas(ref, null, {probe: true, at: Date.now()});
    const race = c.ok ? docs.cas(ref, null, {probe: "second"}) : null;
    const del = c.ok ? docs.remove(ref, c.sha) : false;
    console.log(JSON.stringify({ref, created: c.ok, secondCreateRefused: race ? !race.ok : null, deleted: del}));
    process.exit(c.ok && race && !race.ok && del ? 0 : 2);
  } else if (sub === "prepare") console.log(JSON.stringify(b().prepare({manifest: readJson(arg("manifest")), gates: readJson(arg("gates")), actor}).doc, null, 2));
  else if (sub === "ack") console.log(JSON.stringify(b().drainAck({manifestDigest: readJson(arg("manifest")).digest, drain: readJson(arg("drain")), actor}).doc, null, 2));
  else if (sub === "commit") console.log(JSON.stringify(b().commit({manifest: readJson(arg("manifest")), currentOpenPrs: listPrs("open"), v2Session: arg("session"), actor}), null, 2));
  else if (sub === "rollback") console.log(JSON.stringify(b().rollback({reason: arg("reason", "manual"), actor}).doc, null, 2));
  else { console.error("bridge snapshot|status|probe-store|prepare|ack|commit|rollback"); process.exit(1); }
}

const cmd = process.argv[2];
if (cmd === "plan") plan();
else if (cmd === "evidence") await evidence();
else if (cmd === "intents") intents();
else if (cmd === "bridge") await bridge();
else { console.error("usage: cli.mjs plan|evidence|intents"); process.exit(1); }
