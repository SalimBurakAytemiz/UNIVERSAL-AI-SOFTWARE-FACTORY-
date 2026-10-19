//TR: CI-PARALLEL fail-closed kabuk birleştiricisi: tüm VALIDATION_SHARD_<i>.json raporlarını okur ve yalnız tam n rapor, aynı beklenen commit SHA'sı ve aynı GitHub run id/attempt, checkout edilmiş config/validation.json ile aynı sha256 özeti, her adımın tam bir kez ve doğru kabukta raporlanması, platformda zorunlu her adımın PASS (yalnız başka platforma ait adımın NOT_RUN_PLATFORM) olması ve hiçbir zaman aşımı olmaması halinde PASS verir; aksi halde neden kodlarını yazar ve çıkış 1. PASS'ta ci-evidence için birleşik VALIDATION_REPORT.json yazar, FAIL'de bayat raporu siler. Hiçbir PASS uydurmaz.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const count = Number(opt("--count", ""));
const expectedSha = opt("--sha", "");
const runId = opt("--run-id", process.env.GITHUB_RUN_ID ?? "");
const runAttempt = opt("--run-attempt", process.env.GITHUB_RUN_ATTEMPT ?? "");
const platform = opt("--platform", process.platform);
const dir = opt("--dir", ".ai/runtime");
const out = opt("--out", ".ai/runtime/VALIDATION_REPORT.json");
const reasons = [];
const fail = (r) => reasons.push(r);

function finish() {
  if (reasons.length) {
    try { fs.rmSync(out, {force: true}); } catch { /* best effort; ci-evidence still fails closed on a stale FAIL */ }
    for (const r of reasons) console.error(`SHARD_AGGREGATION_REASON ${r}`);
    console.error(`SHARD_AGGREGATION: FAIL reasons=${reasons.length}`);
    process.exit(1);
  }
}

if (!Number.isInteger(count) || count < 1) fail(`INVALID_ARG_COUNT:${JSON.stringify(opt("--count", null))}`);
if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "")) fail(`INVALID_ARG_SHA:${JSON.stringify(expectedSha ?? null)}`);
if (!/^[1-9]\d*$/.test(runId ?? "")) fail(`INVALID_ARG_RUN_ID:${JSON.stringify(runId ?? null)}`);
if (!/^[1-9]\d*$/.test(runAttempt ?? "")) fail(`INVALID_ARG_RUN_ATTEMPT:${JSON.stringify(runAttempt ?? null)}`);
finish();

let cfgRaw, cfg;
try { cfgRaw = fs.readFileSync("config/validation.json"); cfg = JSON.parse(cfgRaw.toString("utf8")); } catch (e) { fail(`CONFIG_UNREADABLE:${e.message}`); finish(); }
const digest = crypto.createHash("sha256").update(cfgRaw).digest("hex");
const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
if (!steps.length) fail("CONFIG_NO_STEPS");
const plan = cfg.shardPlan?.[platform];
if (!plan || typeof plan !== "object" || !plan.assign || typeof plan.assign !== "object" || Array.isArray(plan.assign)) fail(`NO_SHARD_PLAN:${platform}`);
else if (plan.count !== count) fail(`PLAN_COUNT_MISMATCH:${plan.count}!=${count}`);
else for (const [id, v] of Object.entries(plan.assign)) {
  if (!steps.some((s) => s.id === id)) fail(`PLAN_UNKNOWN_STEP:${id}`);
  if (!Number.isInteger(v) || v < 1 || v > count) fail(`PLAN_INVALID_SHARD:${id}=${JSON.stringify(v)}`);
}
finish();

let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.startsWith("VALIDATION_SHARD_")).sort(); } catch (e) { fail(`DIR_UNREADABLE:${e.message}`); }
const byIndex = new Map();
for (const f of files) {
  const m = /^VALIDATION_SHARD_([1-9]\d*)\.json$/.exec(f);
  if (!m) { fail(`EXTRA_REPORT:${f}`); continue; }
  const idx = Number(m[1]);
  if (idx > count) { fail(`EXTRA_REPORT:${f}`); continue; }
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { fail(`UNPARSABLE_REPORT:${f}`); continue; }
  if (!r || typeof r !== "object" || Array.isArray(r) || !Array.isArray(r.steps)) { fail(`MALFORMED_REPORT:${f}`); continue; }
  if (r.shard?.index !== idx || r.shard?.count !== count) { fail(`SHARD_HEADER_MISMATCH:${f}:${JSON.stringify(r.shard ?? null)}`); continue; }
  if (byIndex.has(idx)) { fail(`DUPLICATE_SHARD:${idx}`); continue; }
  byIndex.set(idx, r);
}
for (let i = 1; i <= count; i++) if (!byIndex.has(i)) fail(`MISSING_SHARD:${i}`);

const seen = new Map();
for (const [idx, r] of [...byIndex].sort((a, b) => a[0] - b[0])) {
  if (r.sha !== expectedSha) fail(`SHA_MISMATCH:shard${idx}:${JSON.stringify(r.sha ?? null)}`);
  if (r.runId !== runId || r.runAttempt !== runAttempt) fail(`RUN_MISMATCH:shard${idx}:${JSON.stringify(r.runId ?? null)}/${JSON.stringify(r.runAttempt ?? null)}`);
  if (r.configSha256 !== digest) fail(`DIGEST_MISMATCH:shard${idx}`);
  if (r.platform !== platform) fail(`PLATFORM_MISMATCH:shard${idx}:${JSON.stringify(r.platform ?? null)}`);
  if (r.status !== "PASS" && r.status !== "PASS_PLATFORM_FILTERED") fail(`SHARD_STATUS:shard${idx}:${JSON.stringify(r.status ?? null)}`);
  for (const s of r.steps) {
    const id = s?.id;
    if (typeof id !== "string") { fail(`MALFORMED_STEP:shard${idx}`); continue; }
    if (seen.has(id)) { fail(`DUPLICATE_STEP:${id}`); continue; }
    seen.set(id, {...s, shard: idx});
  }
}
for (const step of steps) {
  const s = seen.get(step.id);
  if (!s) { fail(`MISSING_STEP:${step.id}`); continue; }
  const want = plan.assign[step.id] ?? 1;
  if (s.shard !== want) fail(`STEP_WRONG_SHARD:${step.id}:${s.shard}!=${want}`);
  const required = step.platforms === undefined || (Array.isArray(step.platforms) && step.platforms.includes(platform));
  if (required && s.status !== "PASS") fail(s.status === "NOT_RUN_PLATFORM" ? `NOT_RUN_REQUIRED_PLATFORM:${step.id}` : `STEP_NOT_PASS:${step.id}:${JSON.stringify(s.status ?? null)}`);
  if (!required && s.status !== "NOT_RUN_PLATFORM") fail(`STEP_NOT_NOT_RUN_PLATFORM:${step.id}:${JSON.stringify(s.status ?? null)}`);
  if (s.timedOut !== false) fail(`TIMED_OUT:${step.id}`);
  if (!Number.isFinite(s.durationMs) || s.durationMs < 0) fail(`INVALID_DURATION:${step.id}`);
}
for (const id of seen.keys()) if (!steps.some((s) => s.id === id)) fail(`EXTRA_STEP:${id}`);
finish();

const merged = steps.map((step) => { const s = seen.get(step.id); return {id: step.id, status: s.status, durationMs: s.durationMs, timedOut: s.timedOut, shard: s.shard}; });
const platformFiltered = merged.filter((s) => s.status === "NOT_RUN_PLATFORM").map((s) => s.id);
const status = platformFiltered.length ? "PASS_PLATFORM_FILTERED" : "PASS";
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify({"//TR": "Bu birleşik rapor validate-shards tarafından tüm kabuklar tam, tek, SHA/config özetine bağlı ve PASS olduğunda yazılır; ci-evidence bunu tek platform kanıtı olarak okur.", schemaVersion: "1.1.0", platform, sha: expectedSha, runId, runAttempt, configSha256: digest, shards: count, steps: merged, platformFiltered, status}, null, 2) + "\n");
const perShard = [...byIndex].sort((a, b) => a[0] - b[0]).map(([i, r]) => `${i}:${r.steps.reduce((t, s) => t + (Number(s.durationMs) || 0), 0)}ms`).join(",");
console.log(`SHARD_AGGREGATION: ${status} shards=${count} steps=${merged.length} sha=${expectedSha} stepTime=${perShard}`);
