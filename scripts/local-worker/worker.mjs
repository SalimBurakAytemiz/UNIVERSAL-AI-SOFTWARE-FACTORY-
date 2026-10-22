// //TR: UASCO Local Windows Test Worker komut satırı: probe (salt-okunur donanım ölçümü), status (dürüst durum: meşgul/çevrimdışı/izolasyon yok), selftest (Windows Sandbox izolasyon doğrulaması), make-job (PR başı + güvenilir base SHA), prepare-deps (güvenilir base lockfile'dan bağımlılık), run (tek ağır iş: tekil kilit, tekrar önleme, korumalı dosya kayması kontrolü, sandbox içinde süre sınırlı koşu, kanıt), recover (çökme kurtarma) ve publish (yalnız --dry-run; kendi bağlamında commit status yükü). İzolasyon doğrulanmadan hiçbir PR kodu çalıştırılmaz; her altyapı hatası görevi GITHUB_HOSTED_WINDOWS'a devreder.
// Usage: node scripts/local-worker/worker.mjs <probe|status|selftest|make-job|prepare-deps|run|recover|publish> [--state-dir d] [--work-root d] ...
// Exit: 0 OK (incl. honest NOT_ACCEPTED / fallback outcomes), 2 refused or invalid input, 3 internal error. Prints exactly one JSON line.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import * as C from "./core.mjs";
import * as SB from "./sandbox.mjs";
import {probeHost} from "./probe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ORIGIN = `https://github.com/${C.REPO}.git`;
const BASE_BRANCH = "v7/integration";
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
const tryJson = f => { try { return readJson(f); } catch { return null; } };
const nowMs = () => Date.now();

export function defaults(env = process.env) {
  const root = process.platform === "win32" && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "UASCO", "local-worker") : path.join(os.homedir(), ".uasco", "local-worker");
  return {stateDir: path.join(root, "state"), workRoot: path.join(root, "work")};
}
export function parse(argv) {
  const [cmd, ...rest] = argv, o = {cmd, flags: new Set(), ...defaults()};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (["--execute", "--dry-run"].includes(a)) o.flags.add(a);
    else if (["--state-dir", "--work-root", "--job", "--pr", "--base-sha", "--evidence", "--sha", "--plan"].includes(a) && i + 1 < rest.length) o[a.slice(2).replace(/-(.)/g, (_, c) => c.toUpperCase())] = rest[++i];
    else throw new C.WorkerError(`ARG_INVALID:${String(a).slice(0, 40)}`);
  }
  return o;
}
const loadPlan = (o, validationConfig) => C.validatePlan(readJson(o.plan ?? path.join(HERE, "test-plan.json")), validationConfig);
const git = (cwd, args, opts = {}) => spawnSync("git", args, {cwd, encoding: opts.encoding ?? "utf8", maxBuffer: 256 * 2 ** 20, timeout: opts.timeout ?? 300000, windowsHide: true});
const gitOk = (cwd, args, code) => { const r = git(cwd, args); if (r.status !== 0) throw new C.WorkerError(code); return r.stdout.trim(); };
const mirrorOf = o => path.join(o.workRoot, "mirror.git");

// Honest status: what this host can do now, and what the cloud can see (nothing is published in this package: the cloud sees OFFLINE).
export function status(o, {probe = probeHost(), now = nowMs()} = {}) {
  const f = C.stateFiles(o.stateDir);
  const plan = loadPlan(o, readJson(path.join(HERE, "../../config/validation.json")));
  const isolation = tryJson(f.isolation);
  const host = C.assessHost(probe, plan, {isolation, now});
  const lock = C.inspectLock(f.lock, {now});
  let ledger = new Map(), ledgerError = null;
  try { ledger = C.readLedger(f.ledger); } catch (e) { ledgerError = e.code; }
  const state = lock ? (lock.stale ? "STALE_LOCK" : "RUNNING") : ledgerError ? "LEDGER_CORRUPT" : host.state;
  return {outcome: "STATUS", state, reasons: host.reasons, fallback: state === "READY" ? null : C.FALLBACK, planVersion: plan.version, phase: plan.phase,
    isolationVerified: C.isolationValid(isolation, probe, now), lock: lock ? {key: lock.rec.key ?? null, stale: lock.stale, why: lock.why} : null,
    jobs: [...ledger.values()].slice(-5).map(e => ({key: e.key, state: e.state, sha: e.sha ?? null})), cloudVisibility: "NOT_PUBLISHED_CLOUD_SEES_OFFLINE",
    host: {platform: probe.platform, cpu: probe.cpu?.name ?? null, logical: probe.cpu?.logical ?? null, memory: probe.memory ?? null, disk: probe.disk ?? null, sandbox: probe.sandbox ?? null}};
}

const killAllSandboxes = async () => { if (process.platform === "win32") for (const im of SB.SANDBOX_PROCESSES) spawnSync("taskkill", ["/F", "/T", "/IM", im], {windowsHide: true}); };
const launchSandbox = async wsb => { const c = spawn(SB.SANDBOX_EXE, [wsb], {detached: true, stdio: "ignore", windowsHide: false}); c.on("error", () => {}); c.unref(); };
const toolRoots = () => {
  const nodeDir = path.dirname(process.execPath);
  const w = spawnSync("where", ["git"], {encoding: "utf8", windowsHide: true});
  const gitExe = w.status === 0 ? w.stdout.split(/\r?\n/)[0].trim() : null;
  return {nodeDir, gitDir: gitExe ? path.resolve(path.dirname(gitExe), "..") : null};
};
const freshDir = d => { fs.rmSync(d, {recursive: true, force: true}); fs.mkdirSync(d, {recursive: true}); return d; };

export async function selftest(o, {probe = probeHost(), now = nowMs()} = {}) {
  if (probe.platform !== "win32" || probe.sandbox?.available !== true) return {outcome: "ISOLATION_NOT_VERIFIED", reasons: probe.sandbox?.reasons ?? ["PLATFORM_NOT_WINDOWS"], fallback: C.FALLBACK};
  const base = path.join(o.workRoot, "selftest"), src = freshDir(path.join(base, "src")), ctl = freshDir(path.join(base, "ctl")), out = freshDir(path.join(base, "out"));
  fs.writeFileSync(path.join(src, "README.txt"), "read-only probe target\n");
  fs.writeFileSync(path.join(ctl, "selftest.ps1"), SB.selftestScript({hostProfile: os.homedir()}));
  const wsb = SB.buildWsb({memoryMB: 2048, workRoot: o.workRoot, profile: os.homedir(), toolRoots: [], logonCommand: SB.logonFor("selftest.ps1"),
    mapped: [{host: src, sandbox: SB.IN.src, readOnly: true}, {host: ctl, sandbox: SB.IN.ctl, readOnly: true}, {host: out, sandbox: SB.IN.out, readOnly: false}]});
  const wsbFile = path.join(base, "selftest.wsb"); fs.writeFileSync(wsbFile, wsb);
  const run = await SB.runSandbox({wsbFile, outDir: out, timeoutMs: 300000, launch: launchSandbox, killAll: killAllSandboxes});
  const st = tryJson(path.join(out, "selftest.json"));
  const iso = C.buildIsolation({selftest: st, fingerprint: probe.fingerprint, now, wsbSha256: C.sha256(wsb)});
  if (run.outcome !== "DONE" || !iso.ok) return {outcome: "ISOLATION_NOT_VERIFIED", reasons: run.outcome !== "DONE" ? [`SANDBOX_${run.outcome}`] : iso.failed, fallback: C.FALLBACK};
  fs.mkdirSync(o.stateDir, {recursive: true}); fs.writeFileSync(C.stateFiles(o.stateDir).isolation, JSON.stringify(iso.record, null, 2) + "\n");
  return {outcome: "ISOLATION_VERIFIED", isolation: iso.record};
}

export function ensureMirror(o) {
  const m = mirrorOf(o);
  if (!fs.existsSync(m)) { fs.mkdirSync(o.workRoot, {recursive: true}); gitOk(o.workRoot, ["clone", "--bare", "--no-tags", ORIGIN, m], "MIRROR_CLONE_FAILED"); }
  return m;
}
export function makeJob(o) {
  const pr = Number(o.pr);
  if (!Number.isSafeInteger(pr) || pr < 1) throw new C.WorkerError("ARG_INVALID:--pr");
  const plan = loadPlan(o, readJson(path.join(HERE, "../../config/validation.json")));
  const m = ensureMirror(o);
  gitOk(m, ["fetch", "--no-tags", "--force", "origin", `+refs/pull/${pr}/head:refs/uasco/pr/${pr}`, `+refs/heads/${BASE_BRANCH}:refs/heads/${BASE_BRANCH}`], "FETCH_FAILED");
  const job = {schema: C.JOB_SCHEMA, repo: C.REPO, pr, sha: gitOk(m, ["rev-parse", `refs/uasco/pr/${pr}`], "PR_HEAD_UNKNOWN"),
    baseSha: gitOk(m, ["rev-parse", `refs/heads/${BASE_BRANCH}`], "BASE_UNKNOWN"), planVersion: plan.version};
  const valid = C.validateJob(job, plan);
  if (o.job) fs.writeFileSync(o.job, JSON.stringify(job, null, 2) + "\n");
  return {outcome: "JOB", job: valid, written: o.job ?? null};
}
const lockBlob = (m, rev) => { const t = C.parseLsTree(git(m, ["ls-tree", "-r", "-z", "--full-tree", rev]).stdout); return t.get("package-lock.json") ?? null; };
// Dependencies come only from the TRUSTED base commit's lockfile (installed by the canonical installer, outside any PR code); a PR whose
// lockfile differs from the base is refused by the protected-drift check and runs on GitHub-hosted Windows instead.
export function prepareDeps(o) {
  const m = ensureMirror(o), rev = o.baseSha;
  if (!/^[0-9a-f]{40}$/.test(String(rev))) throw new C.WorkerError("ARG_INVALID:--base-sha");
  const blob = lockBlob(m, rev); if (!blob) throw new C.WorkerError("LOCKFILE_MISSING");
  const dir = path.join(o.workRoot, "deps", blob, "repo");
  if (fs.existsSync(path.join(dir, "node_modules"))) return {outcome: "DEPS_READY", lockBlob: blob, dir};
  fs.rmSync(dir, {recursive: true, force: true});
  gitOk(m, ["worktree", "add", "--detach", "--force", dir, rev], "WORKTREE_FAILED");
  const r = spawnSync(process.execPath, ["scripts/ensure-dependencies.mjs"], {cwd: dir, encoding: "utf8", timeout: 1800000, windowsHide: true});
  if (r.status !== 0) return {outcome: "DEPS_FAILED", lockBlob: blob, exitCode: r.status};
  return {outcome: "DEPS_READY", lockBlob: blob, dir};
}

// One heavy job. Everything up to the sandbox launch is checked first; without --execute nothing is locked, recorded or run (dry run).
// probe/now/launch/killAll/tools/buildWsb/sleep are injectable so the whole flow is testable off Windows; the CLI always uses the real ones.
export async function runJob(o, {probe = probeHost(), now = nowMs, launch = launchSandbox, killAll = killAllSandboxes, tools = null, buildWsb = SB.buildWsb, sleep} = {}) {
  const f = C.stateFiles(o.stateDir), m = mirrorOf(o);
  if (!fs.existsSync(m)) return {outcome: "NOT_ACCEPTED", reason: "MIRROR_MISSING", fallback: C.FALLBACK};
  const jobIn = readJson(o.job);
  // SHAs are checked before any git call (no option injection); the base must be on the trusted base branch of the mirror.
  if (!/^[0-9a-f]{40}$/.test(String(jobIn?.baseSha)) || !/^[0-9a-f]{40}$/.test(String(jobIn?.sha))) throw new C.WorkerError("JOB_SHA_INVALID");
  if (git(m, ["merge-base", "--is-ancestor", jobIn.baseSha, `refs/heads/${BASE_BRANCH}`]).status !== 0) return {outcome: "NOT_ACCEPTED", reason: "BASE_NOT_ON_TRUSTED_BRANCH", fallback: C.FALLBACK};
  const baseCfg =(() => { const r = git(m, ["show", `${jobIn.baseSha}:config/validation.json`]); if (r.status !== 0) throw new C.WorkerError("BASE_CONFIG_UNAVAILABLE"); return JSON.parse(r.stdout); })();
  let plan;
  try { plan = loadPlan(o, baseCfg); } catch (e) { return {outcome: "NOT_ACCEPTED", reason: `PLAN_OUTDATED:${e.code}`, fallback: C.FALLBACK}; }
  const job = C.validateJob(jobIn, plan);
  const isolation = tryJson(f.isolation);
  const host = C.assessHost(probe, plan, {isolation, now: now()});
  const decision = C.decideAccept({job, host, ledger: C.readLedger(f.ledger), lock: C.inspectLock(f.lock, {now: now()})});
  if (!decision.accept) return {outcome: "NOT_ACCEPTED", reason: decision.reason, fallback: decision.fallback, sha: job.sha};
  const manifest = JSON.parse(gitOk(m, ["show", `${job.baseSha}:config/trust-root-manifest.json`], "BASE_MANIFEST_UNAVAILABLE"));
  const drift = C.protectedDrift({tree: rev => C.parseLsTree(git(m, ["ls-tree", "-r", "-z", "--full-tree", rev]).stdout), sha: job.sha, baseSha: job.baseSha, manifest});
  if (drift.length) return {outcome: "NOT_ACCEPTED", reason: "PROTECTED_FILES_CHANGED", changed: drift.slice(0, 20), fallback: C.FALLBACK, sha: job.sha};
  const deps = path.join(o.workRoot, "deps", lockBlob(m, job.baseSha) ?? "none", "repo");
  if (!fs.existsSync(path.join(deps, "node_modules"))) return {outcome: "NOT_ACCEPTED", reason: "DEPS_NOT_PREPARED", fallback: C.FALLBACK, sha: job.sha};
  tools ??= toolRoots();
  if (!tools.gitDir) return {outcome: "NOT_ACCEPTED", reason: "GIT_NOT_FOUND", fallback: C.FALLBACK, sha: job.sha};
  const jdir = path.join(o.workRoot, "jobs", job.key), src = path.join(jdir, "src"), ctl = path.join(jdir, "ctl"), out = path.join(jdir, "out");
  const steps = C.localSteps(plan);
  const wsbFor = () => buildWsb({memoryMB: plan.limits.sandboxMemoryMB, workRoot: o.workRoot, profile: os.homedir(), toolRoots: [tools.nodeDir, tools.gitDir], logonCommand: SB.logonFor("job.ps1"),
    mapped: [{host: src, sandbox: SB.IN.src, readOnly: true}, {host: deps, sandbox: SB.IN.deps, readOnly: true}, {host: tools.nodeDir, sandbox: `${SB.IN.tools}\\node`, readOnly: true},
      {host: tools.gitDir, sandbox: `${SB.IN.tools}\\git`, readOnly: true}, {host: HERE, sandbox: SB.IN.worker, readOnly: true}, {host: ctl, sandbox: SB.IN.ctl, readOnly: true},
      {host: out, sandbox: SB.IN.out, readOnly: false}]});
  if (!o.flags.has("--execute")) return {outcome: "DRY_RUN", sha: job.sha, key: job.key, steps, limits: plan.limits, wouldMap: [src, deps, tools.nodeDir, tools.gitDir, HERE, ctl, out]};

  const lock = C.acquireLock(f.lock, {key: job.key, now: now(), timeoutSec: plan.limits.jobTimeoutSec});
  if (!lock.acquired) return {outcome: "NOT_ACCEPTED", reason: "WORKER_BUSY", fallback: C.FALLBACK, sha: job.sha};
  const t0 = now();
  C.appendLedger(f.ledger, {key: job.key, state: "RUNNING", sha: job.sha, pr: job.pr, at: new Date(t0).toISOString()});
  let result = "ERROR", report = null, sbx = null;
  try {
    freshDir(src); freshDir(ctl); freshDir(out);
    const tar = path.join(jdir, "src.tar");
    gitOk(m, ["archive", "--format=tar", "-o", tar, job.sha], "ARCHIVE_FAILED");
    if (spawnSync("tar", ["-xf", tar, "-C", src], {windowsHide: true}).status !== 0) throw new C.WorkerError("EXTRACT_FAILED");
    fs.writeFileSync(path.join(ctl, "job.ps1"), SB.jobScript({steps}));
    const wsb = wsbFor(), wsbFile = path.join(jdir, "job.wsb"); fs.writeFileSync(wsbFile, wsb);
    fs.writeFileSync(f.heartbeat, JSON.stringify({key: job.key, sha: job.sha, state: "RUNNING", at: new Date(now()).toISOString()}) + "\n");
    sbx = await SB.runSandbox({wsbFile, outDir: out, timeoutMs: plan.limits.jobTimeoutSec * 1000, launch, killAll, now, ...(sleep ? {sleep} : {})});
    report = tryJson(path.join(out, "STEP_REPORT.json"));
    result = sbx.outcome === "TIMEOUT" ? "TIMEOUT" : sbx.outcome !== "DONE" ? "ERROR" : C.resultFromReport(report, plan);
  } catch { result = "ERROR"; }
  const logFile = path.join(out, "run.log");
  const ev = C.buildEvidence({job, plan, probe, isolation, startedAt: t0, finishedAt: now(), result, report, logSha256: fs.existsSync(logFile) ? C.sha256(fs.readFileSync(logFile)) : null});
  fs.mkdirSync(f.evidence, {recursive: true}); fs.writeFileSync(path.join(f.evidence, `${job.key}.json`), JSON.stringify(ev, null, 2) + "\n");
  C.appendLedger(f.ledger, {key: job.key, state: result, sha: job.sha, pr: job.pr, at: ev.finishedAt, digest: ev.digest, fallback: ev.fallback});
  C.releaseLock(f.lock, job.key);
  return {outcome: "RAN", result, sha: job.sha, key: job.key, durationMs: ev.durationMs, digest: ev.digest, fallback: ev.fallback, sandbox: sbx?.outcome ?? null};
}

export function publish(o) {
  const plan = loadPlan(o, readJson(path.join(HERE, "../../config/validation.json")));
  const payload = C.statusPayload(readJson(o.evidence), {plan, sha: o.sha});
  if (!o.flags.has("--dry-run")) return {outcome: "PUBLISHER_NOT_ENABLED", reason: "status publishing needs a least-privilege GitHub App or fine-grained token decided by the Founder", payload};
  return {outcome: "DRY_RUN", payload};
}

export async function main(argv) {
  const o = parse(argv);
  switch (o.cmd) {
    case "probe": return {outcome: "PROBE", probe: probeHost()};
    case "status": return status(o);
    case "selftest": return selftest(o);
    case "make-job": return makeJob(o);
    case "prepare-deps": return prepareDeps(o);
    case "run": if (!o.job) throw new C.WorkerError("ARG_MISSING:--job"); return runJob(o);
    case "recover": { const r = C.recover(o.stateDir); if (r.recovered) await killAllSandboxes(); return {outcome: "RECOVER", ...r}; }
    case "publish": if (!o.evidence || !o.sha) throw new C.WorkerError("ARG_MISSING:--evidence/--sha"); return publish(o);
    default: throw new C.WorkerError("COMMAND_UNKNOWN");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let out, code = 0;
  try { out = await main(process.argv.slice(2)); if (out.outcome === "PUBLISHER_NOT_ENABLED") code = 2; }
  catch (e) { out = {outcome: "REFUSED", reason: e instanceof C.WorkerError || e instanceof SB.SandboxError ? e.code : "INTERNAL_ERROR"}; code = out.reason === "INTERNAL_ERROR" ? 3 : 2; }
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exitCode = code;
}
