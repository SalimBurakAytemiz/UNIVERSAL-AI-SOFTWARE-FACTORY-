// //TR: Bu script B3B canlı LOCAL_CLAUDE mission smoke'udur: %TEMP% altında küçük bir Node örnek deposu kurar, Control API (in-process, app.inject, ağ dinlemesi yok) üzerinden Founder gibi proje + mission oluşturup AUTHORIZED'a taşır, UASCO_WORKOS_EXECUTOR=local-claude ile tek run başlatır, engine tick'lerini terminal/AWAITING_APPROVAL durumuna kadar izler ve sırlardan/mutlak kullanıcı yollarından arındırılmış JSON kanıt özetini data dizinine ve audit/checkpoints altına yazar. Gerçek sağlayıcı (yerel Claude CLI) çağırır; bu yüzden vitest paketinde değildir ve yalnız UASCO_LIVE_SMOKE=1 ile çalışır. Asla push/merge/COMPLETE yapmaz.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import cp from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {tsImport} from "tsx/esm/api";
import {spawnGitSync} from "../automation/lib/git-isolation.mjs";
import {globalStopState} from "../automation/lib/global-stop.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARD_TIMEOUT_MS = 25 * 60_000;
const EXECUTOR_TIMEOUT_MS = 15 * 60_000;
const TERMINAL = new Set(["AWAITING_APPROVAL", "SUCCEEDED", "BLOCKED", "FAILED", "CANCELLED", "QUARANTINED", "RECOVERY_FAILED"]);
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
// --fake-plumbing: sağlayıcısız kuru prova (FAKE executor programatik enjekte edilir); kanıt yalnız data dizinine yazılır, checkpoint'e değil.
const FAKE = process.argv.includes("--fake-plumbing");
const evidenceOutArg = arg("--evidence-out", FAKE ? null : "audit/checkpoints/V7-PKG-B3B-LIVE-SMOKE-EVIDENCE-2026-10-14.json");
const evidenceOut = evidenceOutArg ? path.resolve(REPO, evidenceOutArg) : null;
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");

if (!FAKE && process.env.UASCO_LIVE_SMOKE !== "1") {
  console.error("LIVE_SMOKE_REFUSED: this script runs the real local Claude CLI (provider usage). Set UASCO_LIVE_SMOKE=1 to run it deliberately.");
  process.exit(2);
}
if (globalStopState(path.join(REPO, ".ai", "runtime", "GLOBAL_STOP.json"))) { console.error("LIVE_SMOKE_REFUSED: GLOBAL_STOP active in control root"); process.exit(2); }

const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "uasco-b3b-live-"));
const sampleRepo = path.join(tmpRoot, "sample-repo"), dataDir = path.join(tmpRoot, "data"), runtime = path.join(tmpRoot, "runtime");
fs.mkdirSync(runtime, {recursive: true});

// Kanıt redaksiyonu: geçici kök yalnız dizin adıyla, kontrol kökü/ev dizini/node yolu yer tutucu ile görünür; sonra secret desenleri maskelenir.
const variants = p => { const a = path.resolve(p); return [...new Set([a, a.replaceAll("\\", "/"), a.replaceAll("/", "\\")])].sort((x, y) => y.length - x.length); };
const replacements = [
  ...variants(tmpRoot).map(v => [v, `%TEMP%/${path.basename(tmpRoot)}`]),
  ...variants(REPO).map(v => [v, "<CONTROL_ROOT>"]),
  ...variants(path.dirname(process.execPath)).map(v => [v, "<NODE_DIR>"]),
  ...variants(os.homedir()).map(v => [v, "<HOME>"])
];
let redactSecrets = s => s;
const replacementRes = replacements.map(([from, to]) => [new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to]);
const redactStr = s => { let out = s; for (const [re, to] of replacementRes) out = out.replace(re, to); return redactSecrets(out); };
const redact = v => typeof v === "string" ? redactStr(v) : Array.isArray(v) ? v.map(redact) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)])) : v;

const git = (cwd, args) => { const r = spawnGitSync(cwd, args); if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr).slice(0, 300)}`); return String(r.stdout).trim(); };
const runNode = (cwd, args) => { const r = cp.spawnSync(process.execPath, args, {cwd, encoding: "utf8", windowsHide: true, timeout: 60_000, env: {PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? ""}}); return {exitCode: r.status, stdout: String(r.stdout ?? "").slice(0, 2000), stderr: String(r.stderr ?? "").slice(0, 2000)}; };

function createSampleRepo() {
  fs.mkdirSync(path.join(sampleRepo, "src"), {recursive: true});
  fs.writeFileSync(path.join(sampleRepo, "package.json"), JSON.stringify({name: "b3b-live-sample", version: "1.0.0", private: true, scripts: {test: "node test.js"}}, null, 2) + "\n");
  fs.writeFileSync(path.join(sampleRepo, "src", "add.js"), "// add(a, b) must return the numeric sum of a and b.\nfunction add(a, b) {\n  throw new Error(\"add is not implemented\");\n}\n\nmodule.exports = add;\n");
  fs.writeFileSync(path.join(sampleRepo, "test.js"), "const assert = require(\"node:assert\");\nconst add = require(\"./src/add.js\");\n\nassert.strictEqual(add(2, 3), 5);\nassert.strictEqual(add(-1, 1), 0);\nassert.strictEqual(add(0.5, 0.25), 0.75);\nassert.strictEqual(add(0, 0), 0);\nconsole.log(\"add tests passed\");\n");
  fs.writeFileSync(path.join(sampleRepo, "README.md"), "# B3B live smoke sample\n\nImplement `add(a, b)` in `src/add.js` so that `node test.js` passes.\n");
  git(sampleRepo, ["init", "-q", "-b", "main"]);
  git(sampleRepo, ["add", "-A"]);
  git(sampleRepo, ["-c", "user.name=B3B Smoke Seed", "-c", "user.email=seed@local.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed: add() stub and failing test"]);
  return git(sampleRepo, ["rev-parse", "HEAD"]);
}

const t0 = Date.now(), startedAt = new Date(t0).toISOString();
const seedSha = createSampleRepo();
const testBefore = runNode(sampleRepo, ["test.js"]);
const testJsSha = sha256(fs.readFileSync(path.join(sampleRepo, "test.js")));

if (!FAKE) process.env.UASCO_WORKOS_EXECUTOR = "local-claude";
let fakeExecutors;
if (FAKE) {
  const {FakeExecutors} = await tsImport(pathToFileURL(path.join(REPO, "core/workos/executors.ts")).href, import.meta.url);
  fakeExecutors = new FakeExecutors({implement: () => ({files: {"src/add.js": "function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = add;\n"}}), review: () => ({verdict: "CLEAN"})}).pair();
}
const {buildServer} = await tsImport(pathToFileURL(path.join(REPO, "apps/control-api/src/server.ts")).href, import.meta.url);
({redactSecrets} = await tsImport(pathToFileURL(path.join(REPO, "core/workos/secret-scan.ts")).href, import.meta.url));
const token = crypto.randomBytes(32).toString("hex"), port = 3210;
const app = buildServer({controlToken: token, runtime, repoRoot: REPO, dataDir, tenantId: "t_live_smoke", port, logger: false, ...(FAKE ? {executors: fakeExecutors} : {}),
  runner: {enabled: true, intervalMs: 1000, maxRemediations: 1, maxRetries: 0, retryBackoffMs: [0], testTimeoutMs: 60_000, executorTimeoutMs: EXECUTOR_TIMEOUT_MS}});
const hdr = {"x-uasco-control-token": token, host: `127.0.0.1:${port}`};
const api = async (method, url, payload) => { const r = await app.inject({method, url, headers: hdr, ...(payload ? {payload} : {})}); let body = null; try { body = r.json(); } catch { body = r.body; } return {status: r.statusCode, body}; };
const apiCalls = [];
const call = async (label, method, url, payload, okStatus) => {
  const r = await api(method, url, payload);
  apiCalls.push({label, method, route: url.replace(/(prj|msn|run)_[0-9a-f]{24}/g, "$1_*"), status: r.status});
  if (!okStatus.includes(r.status)) throw new Error(`API_${label}_FAILED status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};

let failurePoint = null, runId = null, missionId = null, projectId = null, finalRun = null, finalMission = null, hardTimeoutHit = false;
try {
  await app.ready();
  const p = await call("PROJECT_CREATE", "POST", "/v1/projects", {name: "B3B live smoke sample", environmentId: "local-dev", repository: {path: sampleRepo}, testCommand: ["node", "test.js"]}, [201]);
  projectId = p.project.projectId;
  const m = await call("MISSION_CREATE", "POST", "/v1/missions", {projectId, title: "Implement add(a,b)", objective: "Implement add(a,b) in src/add.js so node test.js passes; do not modify test.js",
    acceptanceCriteria: ["node test.js exits 0", "test.js is not modified", "only src/add.js needs to change"], riskLevel: "R1", testCommand: ["node", "test.js"]}, [201]);
  missionId = m.mission.missionId;
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) await call(`MISSION_${to}`, "POST", `/v1/missions/${missionId}/transition`, {to, reason: `B3B live smoke: Founder moves mission to ${to}`}, [200]);
  const r = await call("RUN_START", "POST", `/v1/missions/${missionId}/runs`, {}, [201]);
  runId = r.run.runId;
  const deadline = t0 + HARD_TIMEOUT_MS;
  let last = "";
  for (;;) {
    const cur = (await call("RUN_GET", "GET", `/v1/work-runs/${runId}`, undefined, [200])).run;
    const line = `${cur.status}/${cur.step}/c${cur.remediationCycle}`;
    if (line !== last) { console.log(`[${new Date().toISOString()}] run ${line}${cur.reason ? ` reason=${String(cur.reason).slice(0, 120)}` : ""}`); last = line; }
    if (TERMINAL.has(cur.status)) break;
    if (Date.now() > deadline && !hardTimeoutHit) {
      hardTimeoutHit = true;
      console.log("HARD_TIMEOUT: activating GLOBAL_STOP in the smoke runtime");
      await call("GLOBAL_STOP", "POST", "/v1/control/stop", {reason: "B3B live smoke hard timeout (25 min)"}, [200]);
    }
    if (hardTimeoutHit && Date.now() > deadline + 120_000) { failurePoint = "HARD_TIMEOUT_CANCEL_NOT_OBSERVED"; break; }
    await new Promise(res => setTimeout(res, 2000));
  }
} catch (e) {
  failurePoint = `SMOKE_DRIVER_ERROR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
} finally {
  try { await app.close(); } catch { /* kapanış hatası kanıtı değiştirmez */ }
}

// ---- Kanıt özeti (journal tek otoritedir) ----
const journalFile = path.join(dataDir, "journal.jsonl");
const journal = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
const runTimeline = [], missionTimeline = [];
for (const e of journal) {
  const pl = e.payload ?? {};
  if (pl.mission && (!missionId || pl.mission.missionId === missionId)) missionTimeline.push({at: e.at, from: pl.mission.from, to: pl.mission.to, via: e.type, reason: pl.mission.reason});
  if (e.type === "MISSION_TRANSITIONED" && pl.missionId === missionId) missionTimeline.push({at: e.at, from: pl.from, to: pl.to, via: e.type, actor: e.actor, reason: pl.reason});
  if (e.type === "MISSION_CREATED" && pl.entity?.missionId === missionId) missionTimeline.push({at: e.at, from: null, to: pl.entity.status, via: e.type});
  if (e.type === "RUN_CREATED" && pl.entity?.runId === runId) runTimeline.push({at: e.at, from: null, to: "CREATED"});
  if (e.type === "RUN_TRANSITION" && pl.runId === runId) runTimeline.push({at: e.at, from: pl.from, to: pl.to, reason: pl.reason});
  if (e.type === "RUN_LEASE" && pl.runId === runId && pl.kind !== "RENEW") runTimeline.push({at: e.at, lease: pl.kind});
  if (e.type === "RUN_CHECKPOINT" && pl.runId === runId) runTimeline.push({at: e.at, checkpoint: pl.checkpoint?.step, cycle: pl.checkpoint?.cycle, outcome: pl.checkpoint?.data?.outcome ?? "DONE"});
}
missionTimeline.sort((a, b) => a.at.localeCompare(b.at));
try {
  const {WorkOsStore} = await tsImport(pathToFileURL(path.join(REPO, "core/workos/store.ts")).href, import.meta.url);
  const store = new WorkOsStore(dataDir);
  if (runId) finalRun = store.getRun({tenantId: "t_live_smoke"}, runId) ?? null;
  if (missionId) finalMission = store.getMission({tenantId: "t_live_smoke"}, missionId) ?? null;
} catch (e) { failurePoint ??= `STORE_READ_ERROR: ${e instanceof Error ? e.message : String(e)}`; }

const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : null);
const runDir = runId ? path.join(dataDir, "runs", runId) : null;
const readLog = rel => { try { return fs.readFileSync(path.join(dataDir, rel), "utf8"); } catch { return null; } };
const evidenceItems = (finalRun?.evidence ?? []).map(e => {
  const log = e.logPath ? readLog(e.logPath) : null;
  return {evidenceId: e.evidenceId, step: e.step, cycle: e.cycle, kind: e.kind, argv0: e.argv?.[0] ? path.basename(e.argv[0]) : null, argvTail: (e.argv ?? []).slice(1, 12),
    exitCode: e.exitCode, timedOut: e.timedOut ?? false, durationMs: ms(e.startedAt, e.endedAt), logPath: e.logPath, logSha256: e.logSha256,
    logSha256Verified: log === null || e.logSha256 === null ? null : sha256(Buffer.from(log, "utf8")) === e.logSha256,
    ...(e.commitSha ? {commitSha: e.commitSha} : {}), ...(e.executorIdentity ? {executorIdentity: e.executorIdentity} : {}), ...(e.reviewerIdentity ? {reviewerIdentity: e.reviewerIdentity} : {}),
    ...(e.verdict ? {verdict: e.verdict, findingsCount: e.findingsCount} : {}), ...(e.note ? {note: e.note} : {})};
});
const reviews = (finalRun?.evidence ?? []).filter(e => e.kind === "REVIEW");
const reviewDetail = reviews.map(e => {
  const log = e.logPath ? readLog(e.logPath) ?? "" : "";
  const out = log.split("--- stdout ---")[1]?.split("--- stderr ---")[0] ?? "";
  const verdictLine = out.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith("{") && l.includes("\"verdict\"")).pop() ?? null;
  return {cycle: e.cycle, commitSha: e.commitSha, reviewerIdentity: e.reviewerIdentity, implementerIdentity: e.executorIdentity, verdict: e.verdict ?? "INVALID_OR_MISSING", findingsCount: e.findingsCount ?? null,
    exitCode: e.exitCode, durationMs: ms(e.startedAt, e.endedAt), verdictLine: verdictLine?.slice(0, 4000) ?? null, reviewerNarrative: out.trim().slice(0, 3000)};
});
const head = finalRun?.headSha ?? null, base = finalRun?.baseSha ?? null;
let produced = null;
if (head && base && runDir && fs.existsSync(path.join(runDir, "work", ".git"))) {
  const check = path.join(tmpRoot, "post-check");
  try {
    git(tmpRoot, ["clone", "--no-hardlinks", "--quiet", path.join(runDir, "work"), check]);
    git(check, ["checkout", "-q", "--detach", head]);
    const changed = git(check, ["diff", "--name-only", base, head]).split("\n").filter(Boolean);
    produced = {commitSha: head, parentSha: git(check, ["rev-parse", `${head}^1`]), author: git(check, ["log", "-1", "--format=%an <%ae>", head]),
      subject: git(check, ["log", "-1", "--format=%s", head]), changedFiles: changed, testJsUnchanged: sha256(fs.readFileSync(path.join(check, "test.js"))) === testJsSha,
      diff: git(check, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", base, head]).slice(0, 6000), independentTestRerun: runNode(check, ["test.js"])};
  } catch (e) { produced = {commitSha: head, postCheckError: e instanceof Error ? e.message.slice(0, 300) : String(e)}; }
}
const endedAt = new Date().toISOString();
const verifyEv = (finalRun?.evidence ?? []).filter(e => e.kind === "VERIFY_TESTS").map(e => ({cycle: e.cycle, exitCode: e.exitCode}));
const regressionEv = (finalRun?.evidence ?? []).filter(e => e.kind === "REGRESSION_TESTS").map(e => ({cycle: e.cycle, exitCode: e.exitCode}));
const outcome = finalRun?.status === "AWAITING_APPROVAL" && finalMission?.status === "REPORTING" ? "REPORTING_AWAITING_APPROVAL" : (failurePoint ? "SMOKE_FAILED" : `RUN_${finalRun?.status ?? "MISSING"}`);
const summary = redact({
  "//TR": "Bu dosya B3B canlı LOCAL_CLAUDE mission smoke'unun kanıt özetidir (scripts/workos-live-smoke.mjs üretir); yalnız gözlenen değerler içerir, mutlak kullanıcı yolları ve secret desenleri maskelenmiştir.",
  schemaVersion: "1.0.0", package: "V7-PKG-B3B", kind: "WORKOS_LIVE_SMOKE_EVIDENCE",
  startedAt, endedAt, durationMs: Date.now() - t0, hardTimeoutMs: HARD_TIMEOUT_MS, executorTimeoutMs: EXECUTOR_TIMEOUT_MS, hardTimeoutHit,
  outcome, failurePoint,
  mode: FAKE ? "FAKE_PLUMBING_NO_PROVIDER" : "LIVE_LOCAL_CLAUDE",
  environment: {node: process.version, platform: process.platform, tempDir: path.basename(tmpRoot), executorEnv: FAKE ? "FAKE (programmatic injection)" : "UASCO_WORKOS_EXECUTOR=local-claude", apiTransport: "in-process app.inject (no listening socket)",
    runnerOptions: {intervalMs: 1000, maxRemediations: 1, maxRetries: 0, testTimeoutMs: 60_000}},
  providerProvenance: (() => { try { const pv = JSON.parse(fs.readFileSync(path.join(REPO, ".ai/runtime/PROVIDER_PROVENANCE.json"), "utf8")); return {final: pv.final, capturedAt: pv.capturedAt, claudeVersion: pv.claude?.version, provenanceLevel: pv.claude?.provenanceLevel, launcherSha256: pv.claude?.launcherSha256}; } catch { return null; } })(),
  sample: {seedSha, testCommand: ["node", "test.js"], testJsSha256: testJsSha, testBefore},
  projectId, missionId, runId,
  mission: finalMission ? {status: finalMission.status, title: finalMission.title, objective: finalMission.objective} : null,
  run: finalRun ? {status: finalRun.status, step: finalRun.step, reason: finalRun.reason, attempt: finalRun.attempt, remediationCycle: finalRun.remediationCycle, retryCount: finalRun.retryCount,
    executor: finalRun.executor, baseSha: base, headSha: head, workBranch: finalRun.workBranch, createdAt: finalRun.createdAt, updatedAt: finalRun.updatedAt, durationMs: ms(finalRun.createdAt, finalRun.updatedAt)} : null,
  statusTimeline: {mission: missionTimeline, run: runTimeline},
  tests: {before: {exitCode: testBefore.exitCode}, verify: verifyEv, regression: regressionEv, independentRerunAfter: produced?.independentTestRerun ? {exitCode: produced.independentTestRerun.exitCode, stdout: produced.independentTestRerun.stdout} : null},
  producedCommit: produced,
  review: reviewDetail,
  evidence: evidenceItems,
  report: (() => { const rp = runDir ? path.join(runDir, "report.json") : null; return rp && fs.existsSync(rp) ? {path: path.relative(dataDir, rp).split(path.sep).join("/"), sha256: sha256(fs.readFileSync(rp))} : null; })(),
  journal: {entries: journal.length, lastSeq: journal.at(-1)?.seq ?? null, lastHash: journal.at(-1)?.hash ?? null},
  apiCalls,
  note: "Runner never merges, pushes or completes the mission; delivery decision stays with the Founder. Live provider run; not part of the vitest suite."
});
const text = JSON.stringify(summary, null, 2) + "\n";
fs.mkdirSync(dataDir, {recursive: true});
fs.writeFileSync(path.join(dataDir, "live-smoke-evidence.json"), text);
if (evidenceOut) { fs.mkdirSync(path.dirname(evidenceOut), {recursive: true}); fs.writeFileSync(evidenceOut, text); }
console.log(text);
console.log(`LIVE_SMOKE_EVIDENCE sha256=${sha256(text)} outcome=${outcome} tempDir=${path.basename(tmpRoot)}`);
process.exit(outcome === "REPORTING_AWAITING_APPROVAL" ? 0 : 1);
