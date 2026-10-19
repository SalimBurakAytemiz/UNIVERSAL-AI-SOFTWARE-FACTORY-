//TR: GitHub-hosted CI kanit baglayicisi (salt-okunur girdi): canonical .ai/runtime/VALIDATION_REPORT.json raporunu okur, her adimin suresini korunan scripts/run-validation.mjs icindeki sabit 600 sn limitine karsi yazdirir ve sonucu commit SHA'sina bagli .ai/runtime/CI_EVIDENCE.json olarak yazar (sha, PR head sha, run id/attempt, runner OS, github-hosted/self-hosted ortami). --require ile FAIL-CLOSED: rapor yok/okunamaz/bos, durum PASS/PASS_PLATFORM_FILTERED degil veya PASS/NOT_RUN_PLATFORM disinda adim var ise cikis 1. Tek bir platform context'i asla tam kapsam degildir: tam kapsam = ayni SHA'da Linux VE Windows yesil. Hicbir PASS uydurmaz; yalniz raporu ozetler.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const requireReport = argv.includes("--require");
const legIdx = argv.indexOf("--leg");
const leg = legIdx >= 0 ? argv[legIdx + 1] : process.platform;
const runtime = ".ai/runtime";
const reportFile = path.join(runtime, "VALIDATION_REPORT.json");
const evidenceFile = path.join(runtime, "CI_EVIDENCE.json");
const CAP_MS = 600000;
const WARN_MS = CAP_MS - 60000;
const env = process.env;
const reasons = [];

const binding = {
  sha: env.GITHUB_SHA ?? null,
  headSha: env.UASCO_HEAD_SHA || env.GITHUB_SHA || null,
  ref: env.GITHUB_REF ?? null,
  event: env.GITHUB_EVENT_NAME ?? null,
  repository: env.GITHUB_REPOSITORY ?? null,
  workflow: env.GITHUB_WORKFLOW ?? null,
  job: env.GITHUB_JOB ?? null,
  runId: env.GITHUB_RUN_ID ?? null,
  runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
  runnerOs: env.RUNNER_OS ?? null,
  runnerEnvironment: env.RUNNER_ENVIRONMENT ?? null,
};

let report = null;
if (!fs.existsSync(reportFile)) reasons.push("validation report missing (validation did not run or stopped before writing it)");
else {
  let parsed = false;
  try { report = JSON.parse(fs.readFileSync(reportFile, "utf8")); parsed = true; }
  catch (e) { reasons.push(`validation report unreadable: ${e.message}`); }
  // //TR: Gecerli JSON ama nesne olmayan rapor (null, dizi, sayi, metin) kanit degildir; denetimler atlanmasin diye fail-closed reddedilir.
  if (parsed && (report === null || typeof report !== "object" || Array.isArray(report))) {
    reasons.push(`validation report is not a JSON object (${report === null ? "null" : Array.isArray(report) ? "array" : typeof report})`);
    report = null;
  }
}

const steps = Array.isArray(report?.steps) ? report.steps : [];
if (report) {
  if (report.status !== "PASS" && report.status !== "PASS_PLATFORM_FILTERED") reasons.push(`validation status ${report.status}`);
  const unexpected = steps.filter((s) => s.status !== "PASS" && s.status !== "NOT_RUN_PLATFORM").map((s) => `${s.id}=${s.status}`);
  if (unexpected.length) reasons.push(`non-PASS step status: ${unexpected.join(", ")}`);
  if (!steps.length) reasons.push("report has no steps");
}

console.log(`CI_EVIDENCE_BINDING sha=${binding.sha} headSha=${binding.headSha} event=${binding.event} run=${binding.runId}/${binding.runAttempt} runner=${binding.runnerOs}/${binding.runnerEnvironment}`);
console.log(`COVERAGE: this context covers the ${leg} platform only; full coverage requires BOTH the Linux and the Windows CI context green on the same SHA.`);
if (report) console.log(`status=${report.status} platform=${report.platform} steps=${steps.length}`);
let near = 0;
for (const s of steps) {
  const ms = Number(s.durationMs) || 0;
  const flag = s.timedOut ? "  <-- TIMED OUT at the 600s per-step cap" : ms >= WARN_MS ? "  <-- within 60s of the 600s per-step cap" : "";
  if (s.timedOut || ms >= WARN_MS) near++;
  console.log(`${String(s.status).padEnd(18)} ${String(ms).padStart(8)}ms  ${s.id}${flag}`);
}
const notRun = steps.filter((s) => String(s.status).startsWith("NOT_RUN")).map((s) => s.id);
if (notRun.length) console.log(`NOT_RUN on this platform (filtered, never a PASS): ${notRun.join(", ")}`);
if (near) console.log(`WARN: ${near} step(s) at/near the hardcoded 600s per-step cap; split the step further in config/validation.json (protected -> maintainer edit + trust-root reseal).`);

const verdict = reasons.length ? "CI_EVIDENCE_FAIL" : "CI_EVIDENCE_PASS";
const evidence = {
  "//TR": "Bu kanit tek bir CI isinin (tek platform) canonical dogrulama sonucunu commit SHA'sina baglar; tam kapsam icin Linux ve Windows kanitlari ayni SHA'da birlikte PASS olmalidir. Governance verdict'i DEGILDIR.",
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  leg,
  binding,
  validation: report ? {
    status: report.status ?? null,
    platform: report.platform ?? null,
    startedAt: report.startedAt ?? null,
    finishedAt: report.finishedAt ?? null,
    platformFiltered: Array.isArray(report.platformFiltered) ? report.platformFiltered : [],
    steps: steps.map((s) => ({id: s.id, status: s.status, durationMs: Number(s.durationMs) || 0, timedOut: s.timedOut === true})),
  } : null,
  verdict,
  reasons,
};
fs.mkdirSync(runtime, {recursive: true});
fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
for (const r of reasons) console.log(`FAIL: ${r}`);
console.log(`${verdict} leg=${leg} sha=${binding.sha}`);
if (requireReport && reasons.length) process.exitCode = 1;
