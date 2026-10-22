// //TR: UASCO Local Windows Test Worker çekirdeği (saf, deterministik): test planı kapsam doğrulaması, iş doğrulama, ana makine uygunluğu (meşgul/RAM/CPU/disk/izolasyon), tekil kilit + tekrar önleyen defter, çökme kurtarma, korumalı dosya kayması kontrolü, değiştirilemez kanıt özeti ve en az yetkili durum yayımlayıcısı için yük. Yerel sonuç yalnız SHADOW (danışma) aşamasındadır; GitHub'ın zorunlu kontrolleri değişmez. Hata durumunda görev kaybolmaz, GITHUB_HOSTED_WINDOWS'a devredilir.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {REQUIRED_CONTEXTS} from "../../docs/planning/merge-gate.mjs";

export const REPO = "SalimBurakAytemiz/UNIVERSAL-AI-SOFTWARE-FACTORY-";
export const PLAN_SCHEMA = "uasco.local-test-plan/1";
export const JOB_SCHEMA = "uasco.local-test-job/1";
export const EVIDENCE_SCHEMA = "uasco.local-test-evidence/1";
export const ISOLATION_SCHEMA = "uasco.local-isolation/1";
export const STATUS_CONTEXT = "uasco/local-windows (shadow)";
export const FALLBACK = "GITHUB_HOSTED_WINDOWS";
export const REQUIRED_CHECK_CONTEXTS = Object.freeze([...REQUIRED_CONTEXTS]); // the merge gate required checks, never replaced in phase SHADOW
export const ISOLATION_CHECKS = Object.freeze(["networkBlocked", "hostProfileHidden", "sourceReadOnly", "outputWritable", "secretsAbsent"]);
export const ISOLATION_MAX_AGE_DAYS = 30;
// Results that are a real test outcome; every other result is an infrastructure outcome and the commit falls back to GitHub-hosted Windows.
export const TEST_RESULTS = Object.freeze(["PASS", "FAIL"]);
export const RESULTS = Object.freeze(["PASS", "FAIL", "TIMEOUT", "ERROR", "ABANDONED"]);
const SHA40 = /^[0-9a-f]{40}$/;
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOCK_GRACE_MS = 120000;

export class WorkerError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new WorkerError(code); };
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = v => typeof v === "string";
const intIn = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const iso = ms => new Date(ms).toISOString();

export const sha256 = data => crypto.createHash("sha256").update(data).digest("hex");
// Canonical JSON: object keys sorted at every level, so a digest never depends on key order.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const sealed = body => ({...body, digest: sha256(canonical(body))});
const digestOk = rec => isObj(rec) && isStr(rec.digest) && (() => { const {digest, ...body} = rec; return sha256(canonical(body)) === digest; })();

// ---- Test plan: the local plan must cover EVERY canonical validation step exactly once, in order (no silent coverage reduction).
export function validatePlan(plan, validationConfig) {
  if (!isObj(plan) || plan.schema !== PLAN_SCHEMA) fail("PLAN_SCHEMA_INVALID");
  if (!isStr(plan.version) || !/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/.test(plan.version)) fail("PLAN_VERSION_INVALID");
  if (plan.phase !== "SHADOW") fail("PLAN_PHASE_NOT_SHADOW");
  if (plan.replacesRequiredCheck !== false) fail("PLAN_REPLACES_REQUIRED_CHECK");
  if (!Array.isArray(plan.requiredChecksUnchanged) || canonical(plan.requiredChecksUnchanged) !== canonical([...REQUIRED_CONTEXTS])) fail("PLAN_REQUIRED_CHECKS_CHANGED");
  const L = plan.limits;
  if (!isObj(L) || !intIn(L.sandboxMemoryMB, 2048, 12288) || !intIn(L.hostReserveMB, 1024, 8192) || !intIn(L.maxHostCpuLoadPct, 10, 95)
    || !intIn(L.minFreeDiskGB, 5, 500) || !intIn(L.jobTimeoutSec, 60, 14400) || !intIn(L.stepTimeoutSec, 30, 3600) || L.maxConcurrentJobs !== 1) fail("PLAN_LIMITS_INVALID");
  if (!isObj(validationConfig) || !Array.isArray(validationConfig.steps)) fail("VALIDATION_CONFIG_INVALID");
  const ids = validationConfig.steps.map(s => s.id);
  if (!Array.isArray(plan.steps) || plan.steps.length !== ids.length || plan.steps.some((s, i) => !isObj(s) || s.id !== ids[i])) fail("PLAN_COVERAGE_MISMATCH");
  for (const s of plan.steps) {
    if (!["LOCAL_PRIMARY", "CLOUD_SMOKE"].includes(s.windows)) fail(`PLAN_STEP_INVALID:${s.id}`);
    if (s.fallback !== FALLBACK) fail(`PLAN_STEP_FALLBACK_INVALID:${s.id}`);
    if (!STEP_ID.test(s.id)) fail(`PLAN_STEP_ID_INVALID:${s.id}`);
  }
  if (!localSteps(plan).length) fail("PLAN_HAS_NO_LOCAL_STEPS");
  return plan;
}
export const localSteps = plan => plan.steps.filter(s => s.windows === "LOCAL_PRIMARY").map(s => s.id);

// ---- Job: one commit (full 40-hex SHA) of this repository, tested against a trusted base SHA, under one plan version.
export const jobKey = j => sha256(`${j.repo}\n${j.sha}\n${j.planVersion}`).slice(0, 32);
export function validateJob(job, plan) {
  if (!isObj(job) || job.schema !== JOB_SCHEMA) fail("JOB_SCHEMA_INVALID");
  if (job.repo !== REPO) fail("JOB_REPO_INVALID");
  if (!isStr(job.sha) || !SHA40.test(job.sha)) fail("JOB_SHA_INVALID");
  if (!isStr(job.baseSha) || !SHA40.test(job.baseSha)) fail("JOB_BASE_SHA_INVALID");
  if (job.planVersion !== plan.version) fail("JOB_PLAN_VERSION_MISMATCH");
  if (job.pr !== null && !intIn(job.pr, 1, 1e7)) fail("JOB_PR_INVALID");
  return {schema: JOB_SCHEMA, repo: REPO, sha: job.sha, baseSha: job.baseSha, planVersion: plan.version, pr: job.pr, key: jobKey(job)};
}

// ---- Isolation record (written only from a passing Windows Sandbox self-test on THIS host).
export function buildIsolation({selftest, fingerprint, now, wsbSha256}) {
  const checks = Object.fromEntries(ISOLATION_CHECKS.map(k => [k, isObj(selftest) && selftest[k] === true]));
  const failed = ISOLATION_CHECKS.filter(k => !checks[k]);
  if (!isObj(selftest) || selftest.user !== "WDAGUtilityAccount") failed.push("sandboxUser");
  return {ok: failed.length === 0, failed, record: sealed({schema: ISOLATION_SCHEMA, backend: "windows-sandbox", fingerprint, checks, wsbSha256, verifiedAt: iso(now)})};
}
export function isolationValid(rec, probe, now) {
  if (!digestOk(rec) || rec.schema !== ISOLATION_SCHEMA || rec.backend !== "windows-sandbox") return false;
  if (!isObj(probe) || rec.fingerprint !== probe.fingerprint || !ISOLATION_CHECKS.every(k => rec.checks?.[k] === true)) return false;
  const age = now - Date.parse(rec.verifiedAt);
  return Number.isFinite(age) && age >= 0 && age <= ISOLATION_MAX_AGE_DAYS * 864e5;
}

// ---- Host assessment: a busy or unsuitable machine accepts nothing; missing measurements count as unsuitable (fail closed).
export function assessHost(probe, plan, {isolation = null, now = Date.now()} = {}) {
  if (!isObj(probe) || probe.platform !== "win32") return {state: "UNSUPPORTED", reasons: ["PLATFORM_NOT_WINDOWS"], fallback: FALLBACK};
  const L = plan.limits, r = [];
  if (!(probe.memory?.freeMB >= L.sandboxMemoryMB + L.hostReserveMB)) r.push("RAM_INSUFFICIENT");
  if (!(probe.cpu?.loadPct <= L.maxHostCpuLoadPct)) r.push("CPU_BUSY");
  if (!(probe.disk?.freeGB >= L.minFreeDiskGB)) r.push("DISK_INSUFFICIENT");
  if (probe.sandbox?.available !== true) r.push("SANDBOX_UNAVAILABLE");
  if (r.length) return {state: r.includes("SANDBOX_UNAVAILABLE") && r.length === 1 ? "UNSUPPORTED" : "BUSY", reasons: r, fallback: FALLBACK};
  if (!isolationValid(isolation, probe, now)) return {state: "ISOLATION_NOT_VERIFIED", reasons: ["ISOLATION_NOT_VERIFIED"], fallback: FALLBACK};
  return {state: "READY", reasons: [], fallback: null};
}

// ---- State: one create-only lock (single heavy job) and an append-only ledger (a job key is never run twice).
export const stateFiles = dir => ({lock: path.join(dir, "lock.json"), ledger: path.join(dir, "ledger.jsonl"), evidence: path.join(dir, "evidence"),
  isolation: path.join(dir, "isolation.json"), heartbeat: path.join(dir, "heartbeat.json")});
export function readLedger(file) {
  const m = new Map();
  let raw = "";
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return m; fail("LEDGER_UNREADABLE"); }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { fail("LEDGER_CORRUPT"); }
    if (!isObj(e) || !isStr(e.key) || !RESULTS.concat(["RUNNING"]).includes(e.state)) fail("LEDGER_CORRUPT");
    m.set(e.key, e);
  }
  return m;
}
export const appendLedger = (file, entry) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.appendFileSync(file, JSON.stringify(entry) + "\n"); };
export const pidAlive = pid => { if (!intIn(pid, 1, 2 ** 31)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
export function readLock(file) {
  let raw; try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return e.code === "ENOENT" ? null : {malformed: true}; }
  try { const r = JSON.parse(raw); return isObj(r) && isStr(r.key) && intIn(r.pid, 1, 2 ** 31) && isStr(r.deadline) ? r : {malformed: true}; } catch { return {malformed: true}; }
}
// A lock is stale when it is malformed, past its deadline, or its owner process is gone (crash).
export function inspectLock(file, {now = Date.now(), isAlive = pidAlive} = {}) {
  const rec = readLock(file);
  if (!rec) return null;
  if (rec.malformed) return {rec, stale: true, why: "LOCK_MALFORMED"};
  if (!(now <= Date.parse(rec.deadline))) return {rec, stale: true, why: "LOCK_DEADLINE_PASSED"};
  if (!isAlive(rec.pid)) return {rec, stale: true, why: "LOCK_OWNER_DEAD"};
  return {rec, stale: false, why: null};
}
export function acquireLock(file, {key, pid = process.pid, now = Date.now(), timeoutSec}) {
  const rec = {key, pid, startedAt: iso(now), deadline: iso(now + timeoutSec * 1000 + LOCK_GRACE_MS)};
  fs.mkdirSync(path.dirname(file), {recursive: true});
  let fd;
  try { fd = fs.openSync(file, "wx"); } catch (e) { if (e.code === "EEXIST") return {acquired: false, current: readLock(file)}; throw e; }
  try { fs.writeSync(fd, JSON.stringify(rec)); } finally { fs.closeSync(fd); }
  return {acquired: true, rec};
}
export function releaseLock(file, key) { const r = readLock(file); if (r && !r.malformed && r.key === key) { fs.rmSync(file, {force: true}); return true; } return false; }

// Crash recovery: a stale lock becomes an ABANDONED ledger entry (handed to GitHub-hosted Windows) and is removed; a live lock is left alone.
export function recover(dir, {now = Date.now(), isAlive = pidAlive} = {}) {
  const f = stateFiles(dir), st = inspectLock(f.lock, {now, isAlive});
  if (!st) return {recovered: false, why: "NO_LOCK"};
  if (!st.stale) return {recovered: false, why: "LOCK_LIVE", key: st.rec.key};
  const key = isStr(st.rec.key) ? st.rec.key : null;
  if (key) appendLedger(f.ledger, {key, state: "ABANDONED", at: iso(now), why: st.why, fallback: FALLBACK});
  fs.rmSync(f.lock, {force: true});
  return {recovered: true, why: st.why, key, fallback: FALLBACK};
}

// ---- Acceptance: deterministic, one job at a time, never the same job twice.
export function decideAccept({job, host, ledger, lock}) {
  if (lock && lock.stale) return {accept: false, reason: "STALE_LOCK_RECOVER_FIRST", fallback: FALLBACK};
  if (lock && !lock.stale) return {accept: false, reason: lock.rec.key === job.key ? "JOB_ALREADY_RUNNING" : "WORKER_BUSY", fallback: lock.rec.key === job.key ? null : FALLBACK};
  const prev = ledger.get(job.key);
  if (prev) return {accept: false, reason: `DUPLICATE_JOB:${prev.state}`, fallback: TEST_RESULTS.includes(prev.state) ? null : FALLBACK};
  if (host.state !== "READY") return {accept: false, reason: host.reasons[0] ?? host.state, fallback: FALLBACK};
  return {accept: true, reason: "ACCEPTED", fallback: null};
}

// ---- Protected drift: the local run executes the commit's own runner and config, so it is only meaningful when every trust-root file,
// the trust-root manifest itself and the npm manifests are byte-identical (same git blob) to the trusted base. tree(rev) => Map(path -> blob).
export function protectedDrift({tree, sha, baseSha, manifest}) {
  if (!isObj(manifest) || !Array.isArray(manifest.files) || !manifest.files.every(f => isObj(f) && isStr(f.path))) fail("TRUST_MANIFEST_INVALID");
  const base = tree(baseSha), head = tree(sha);
  const paths = [...new Set(["config/trust-root-manifest.json", "package.json", "package-lock.json", ...manifest.files.map(f => f.path)])];
  return paths.filter(p => base.get(p) !== head.get(p)).sort();
}
export function parseLsTree(out) {
  const m = new Map();
  for (const rec of out.split("\0")) { if (!rec) continue; const tab = rec.indexOf("\t"); const meta = rec.slice(0, tab).split(" "); if (meta[1] === "blob") m.set(rec.slice(tab + 1), meta[2]); }
  return m;
}

// ---- Step report (written by run-steps.mjs) -> evidence. The evidence digest covers every field; any edit breaks it.
export function buildEvidence({job, plan, probe, isolation, startedAt, finishedAt, result, report, logSha256}) {
  if (!RESULTS.includes(result)) fail("RESULT_INVALID");
  const steps = Array.isArray(report?.steps) ? report.steps.map(s => ({id: s.id, status: s.status, durationMs: s.durationMs, timedOut: s.timedOut === true, exitCode: s.exitCode ?? null})) : [];
  return sealed({schema: EVIDENCE_SCHEMA, repo: job.repo, sha: job.sha, baseSha: job.baseSha, pr: job.pr, planVersion: plan.version, jobKey: job.key,
    mode: "LOCAL_PRIMARY_STEPS", configSha256: report?.configSha256 ?? null, requestedSteps: localSteps(plan),
    environment: {platform: probe?.platform ?? null, os: probe?.os ?? null, cpu: probe?.cpu?.name ?? null, logicalCpus: probe?.cpu?.logical ?? null,
      memoryTotalMB: probe?.memory?.totalMB ?? null, fingerprint: probe?.fingerprint ?? null,
      isolation: isolation ? {backend: isolation.backend, digest: isolation.digest, verifiedAt: isolation.verifiedAt} : null},
    startedAt: iso(startedAt), finishedAt: iso(finishedAt), durationMs: finishedAt - startedAt, result, steps, logSha256: logSha256 ?? null,
    fallback: TEST_RESULTS.includes(result) ? null : FALLBACK});
}
// The result is derived from the step report, never trusted as written: PASS needs every planned local step exactly once, PASS, not timed out.
export function resultFromReport(report, plan) {
  const want = localSteps(plan);
  if (!isObj(report) || !Array.isArray(report.steps)) return "ERROR";
  const got = report.steps.map(s => s?.id);
  if (got.length !== want.length || want.some((id, i) => got[i] !== id)) return "ERROR";
  if (report.steps.some(s => s.timedOut === true)) return "TIMEOUT";
  if (report.steps.every(s => s.status === "PASS")) return "PASS";
  return report.steps.every(s => s.status === "PASS" || s.status === "FAIL") ? "FAIL" : "ERROR";
}
export function verifyEvidence(ev, {plan, sha}) {
  const p = [];
  if (!isObj(ev) || ev.schema !== EVIDENCE_SCHEMA) return ["SCHEMA"];
  if (!digestOk(ev)) p.push("DIGEST");
  if (ev.repo !== REPO) p.push("REPO");
  if (!SHA40.test(String(ev.sha)) || ev.sha !== sha) p.push("SHA");
  if (ev.planVersion !== plan.version) p.push("PLAN_VERSION");
  if (canonical(ev.requestedSteps) !== canonical(localSteps(plan))) p.push("PLAN_STEPS");
  if (!RESULTS.includes(ev.result)) p.push("RESULT");
  else if (TEST_RESULTS.includes(ev.result) && resultFromReport({steps: ev.steps}, plan) !== ev.result) p.push("RESULT_INCONSISTENT");
  return p;
}
// Least-privilege publisher payload: a commit status on its OWN context, never one of the required contexts. Built only from verified evidence.
export function statusPayload(ev, {plan, sha}) {
  const problems = verifyEvidence(ev, {plan, sha});
  if (problems.length) fail(`EVIDENCE_INVALID:${problems.join("+")}`);
  if (REQUIRED_CONTEXTS.includes(STATUS_CONTEXT)) fail("CONTEXT_COLLIDES_WITH_REQUIRED_CHECK");
  const state = ev.result === "PASS" ? "success" : ev.result === "FAIL" ? "failure" : "error";
  const description = `${ev.result}: ${ev.steps.length} local steps, plan ${ev.planVersion}, evidence ${ev.digest.slice(0, 12)}`.slice(0, 140);
  return {method: "POST", path: `/repos/${REPO}/statuses/${ev.sha}`, body: {state, context: STATUS_CONTEXT, description}};
}
