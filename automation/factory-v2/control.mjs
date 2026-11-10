// //TR: Factory V2 tek ana kontrol oturumu komutları (cli.mjs factory ...): Supervisor her çağrıda paylaşımlı imzalı günlükten kurulur (Cloud konteyneri kapansa da durum kaybolmaz), kendi lease/epoch'unu sürdürür veya süresi dolmuşsa devralır; tick görev dağıtır ve doğrulanmış sonuçları işler, actions gerçek create_session isteklerini verir, bind gerçek oturum kimliğini bağlar, result işçi oturumunun platform transkriptinden gelen sonucu doğrular, lost kayıp oturumu yeniden atamaya gönderir, report tüm fabrikanın tek raporunu üretir. LIVE kip canlı geçiş kararı (CUTOVER-ACCEPTANCE) olmadan reddedilir.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRemoteDocStore, gitRunner} from "./ref-doc-store.mjs";
import {createSharedRegistry} from "./shared-registry.mjs";
import {registryLog} from "./ledger-log.mjs";
import {StateJournal, FACT_KINDS} from "./state-journal.mjs";
import {FactorySupervisor} from "./supervisor.mjs";
import {CloudOrchestrator, gitChecks} from "./cloud-orchestrator.mjs";
import {parseKeyring, loadCanonicalKeyring} from "./identity.mjs";
import {buildReport, renderMarkdown, parseAcceptance} from "./report.mjs";

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const out = v => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Keyring: probe domains may use a PROBE keyring file (never valid for the live domain); the live domain only the canonical governance file. */
export function controlKeyring({cfg, repoDir}) {
  if (String(cfg.domain).startsWith("probe-")) {
    const ring = parseKeyring(readJson(cfg.keyringFile), {kind: "PROBE_FILE", path: cfg.keyringFile});
    if (ring.mode !== "PROBE" || ring.domain !== cfg.domain) throw new Error("CONTROL_PROBE_KEYRING_MODE");
    return ring;
  }
  const r = spawnSync("git", ["ls-remote", "origin", "refs/heads/v7/integration"], {cwd: repoDir, encoding: "utf8"});
  const sha = r.stdout.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("CONTROL_CANONICAL_UNREACHABLE");
  spawnSync("git", ["fetch", "-q", "origin", sha], {cwd: repoDir});
  return loadCanonicalKeyring({repoDir, commitSha: sha});
}

/** Build the Supervisor stack from a control config (see docs/factory-v2/CONTROL-SESSION.md). */
export function controlStack(cfg, {repoDir}) {
  if (cfg.mode !== "SHADOW") throw new Error("CONTROL_LIVE_REQUIRES_CUTOVER"); // LIVE needs the Founder cutover (CUTOVER-ACCEPTANCE A5) and the bridge gate
  if (!/^uasco\/[A-Za-z0-9._/-]{1,80}$/.test(cfg.registryBranch ?? "")) throw new Error("CONTROL_REGISTRY_BRANCH_INVALID");
  const registry = createSharedRegistry({docStore: createRemoteDocStore({runGit: gitRunner(repoDir)}), ref: `refs/heads/${cfg.registryBranch}`});
  const ring = controlKeyring({cfg, repoDir});
  const signer = cfg.signerKeyFile ? readJson(cfg.signerKeyFile) : null;
  if (signer && signer.sessionId !== cfg.sessionId) throw new Error("CONTROL_SIGNER_NOT_THIS_SESSION");
  const journal = new StateJournal(registryLog({registry, ns: cfg.ledgerNs, signer, ring, domain: cfg.domain}));
  const leaseStore = {...registry.leaseStore(`shadow-${cfg.domain}`), shadowNamespace: true};
  const backlog = cfg.backlogFile ? readJson(cfg.backlogFile) : [];
  const orch = new CloudOrchestrator({repoUrl: cfg.repoUrl, domain: cfg.domain, git: gitChecks({repoDir}), capacity: cfg.capacity});
  const dispatchBase = () => { const r = spawnSync("git", ["ls-remote", "origin", `refs/heads/${cfg.dispatchRef}`], {cwd: repoDir, encoding: "utf8"}); const s = r.stdout.split(/\s+/)[0]; if (s) spawnSync("git", ["fetch", "-q", "origin", s], {cwd: repoDir}); return s || null; };
  const sup = new FactorySupervisor({domain: cfg.domain, mode: "SHADOW", sessionId: cfg.sessionId, journal, leaseStore, executor: orch, backlog: () => backlog, leaseTtlMs: cfg.leaseTtlMs ?? 3600_000,
    target: cfg.target, repoDir, dispatchBase, liveOwned: () => new Set(cfg.excludeTasks ?? [])});
  orch.attach(sup);
  return {registry, ring, journal, sup, orch, backlog};
}

async function githubFacts(root) {
  const {githubClient, ghGet, openPrsLive} = await import("./live-sources.mjs");
  const gh = githubClient();
  const prs = await openPrsLive(gh);
  const rows = [];
  for (const p of prs) {
    const cr = await ghGet(gh, `commits/${p.head.sha}/check-runs?per_page=100`).catch(() => null);
    const checks = cr ? Object.fromEntries(cr.check_runs.map(c => [c.name, c.status === "completed" ? c.conclusion : c.status])) : "UNKNOWN";
    // binding line on the exact head/base (as the reviewer posted it); the full independence check stays with gate-verifier / merge-gate
    const revs = await ghGet(gh, `pulls/${p.number}/reviews?per_page=100`).catch(() => []);
    const m = revs.map(r => new RegExp(`^VERDICT-BINDING: verdict=(\\w+) head=${p.head.sha} base=${p.base.sha} `, "m").exec(r.body ?? "")).filter(Boolean).at(-1);
    const binding = m ? {verdict: m[1], head: p.head.sha} : null;
    rows.push({number: p.number, title: p.title, headSha: p.head.sha, baseRef: p.base.ref, draft: !!p.draft, checks, binding, founderWaiting: checks !== "UNKNOWN" && checks["founder-authority"] === "waiting"});
  }
  return {openPrs: rows};
}

export async function factoryCommand(argv, {root}) {
  const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i > 0 ? argv[i + 1] : d; };
  const sub = argv[0];
  const cfg = readJson(arg("config") ?? process.env.FACTORY_CONTROL_CONFIG ?? "");
  const repoDir = cfg.repoDir ?? root;
  const s = controlStack(cfg, {repoDir});
  if (sub === "report") {
    const acceptancePath = path.join(repoDir, "docs/factory-v2/CUTOVER-ACCEPTANCE.md");
    const r = buildReport({journal: s.journal, backlog: s.backlog, supervisor: {mode: "SHADOW", sessionId: s.journal.lastEpoch?.supervisorId, epoch: s.journal.lastEpoch?.epoch, state: "SEE_LEASE", target: s.sup.topology.target},
      github: argv.includes("--github") ? await githubFacts(repoDir) : null, quota: arg("quota") ? readJson(arg("quota")) : null,
      acceptance: fs.existsSync(acceptancePath) ? parseAcceptance(fs.readFileSync(acceptancePath, "utf8")) : null});
    if (arg("json")) fs.writeFileSync(arg("json"), JSON.stringify(r, null, 2));
    return out(renderMarkdown(r));
  }
  const st = s.sup.start();
  if (!st.owner) { out({state: "STANDBY", reason: st.holder ? `SUPERVISOR_LEASE_HELD_BY:${st.holder.sessionId}` : st.authority ?? "UNKNOWN"}); process.exitCode = 3; return; }
  if (sub === "tick") { const t = await s.sup.tick(); return out({epoch: st.epoch, state: t.state, dispatched: t.dispatched?.map(a => a.taskId) ?? [], tasks: s.sup.report().tasks, actions: s.orch.actions()}); }
  if (sub === "actions") return out(s.orch.actions());
  if (sub === "bind") return out(s.orch.bind(arg("intent"), arg("session")));
  if (sub === "lost") return out(s.orch.lost(arg("intent"), arg("reason", "SESSION_LOST")));
  if (sub === "result") return out(s.orch.submitResult(arg("intent"), {sessionId: arg("session"), text: fs.readFileSync(arg("text-file"), "utf8")}));
  if (sub === "fact") {
    if (!FACT_KINDS.includes(arg("fact"))) throw new Error("FACT_KIND_INVALID");
    return out(s.journal.fact(arg("task"), arg("fact"), JSON.parse(arg("value")), s.sup.fence()));
  }
  if (sub === "workers") return out(s.orch.workers());
  throw new Error("usage: factory tick|actions|bind --intent --session|result --intent --session --text-file|lost --intent [--reason]|fact --task --fact --value|workers|report [--github] [--quota f] [--json f] --config c.json");
}
