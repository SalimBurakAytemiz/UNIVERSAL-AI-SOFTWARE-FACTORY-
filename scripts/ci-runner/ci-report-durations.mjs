//TR: Canonical validation raporundaki adim surelerini yazdirir; korunan scripts/run-validation.mjs icindeki sabit 600 sn adim limitine 60 sn'den yakin veya zaman asimina ugramis adimlari isaretler. --require ile FAIL-CLOSED: rapor yoksa/okunamazsa, durum PASS/PASS_PLATFORM_FILTERED degilse veya PASS/NOT_RUN_PLATFORM disinda bir adim varsa cikis 1. --leg <windows|linux> bu check context'in yalniz o platformu kapsadigini acikca yazdirir (tam kapsam = iki context de yesil). Salt-okunur; raporu degistirmez.
import fs from "node:fs";

const argv = process.argv.slice(2);
const requireReport = argv.includes("--require");
const legIdx = argv.indexOf("--leg");
const leg = legIdx >= 0 ? argv[legIdx + 1] : null;
const file = ".ai/runtime/VALIDATION_REPORT.json";
const fail = (msg) => { console.log(`FAIL: ${msg}`); process.exitCode = 1; };

if (leg) console.log(`COVERAGE: this context covers the ${leg} platform only; full coverage requires BOTH "validate (windows)" and "validate (linux)" green on the same SHA.`);
if (!fs.existsSync(file)) {
  console.log("no VALIDATION_REPORT.json (validation did not run or stopped before writing it)");
  if (requireReport) fail("validation report missing");
  process.exit(process.exitCode ?? 0);
}
let report;
try { report = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) { console.log(`VALIDATION_REPORT.json unreadable: ${e.message}`); if (requireReport) fail("validation report unreadable"); process.exit(process.exitCode ?? 0); }

const CAP_MS = 600000;
const WARN_MS = CAP_MS - 60000;
const steps = Array.isArray(report.steps) ? report.steps : [];
console.log(`status=${report.status} platform=${report.platform} steps=${steps.length}`);
let near = 0;
for (const s of steps) {
  const ms = Number(s.durationMs) || 0;
  const flag = s.timedOut ? "  <-- TIMED OUT at the 600s per-step cap" : ms >= WARN_MS ? "  <-- within 60s of the 600s per-step cap" : "";
  if (s.timedOut || ms >= WARN_MS) near++;
  console.log(`${String(s.status).padEnd(18)} ${String(ms).padStart(8)}ms  ${s.id}${flag}`);
}
const notRun = steps.filter((s) => String(s.status).startsWith("NOT_RUN")).map((s) => s.id);
if (notRun.length) console.log(`NOT_RUN on this platform (filtered, never a PASS): ${notRun.join(", ")}`);
if (near) console.log(`WARN: ${near} step(s) at/near the hardcoded 600s per-step cap (protected scripts/run-validation.mjs). Real fix: shard the step in config/validation.json (protected -> maintainer edit + trust-root reseal).`);

if (requireReport) {
  if (report.status !== "PASS" && report.status !== "PASS_PLATFORM_FILTERED") fail(`validation status ${report.status}`);
  const unexpected = steps.filter((s) => s.status !== "PASS" && s.status !== "NOT_RUN_PLATFORM").map((s) => `${s.id}=${s.status}`);
  if (unexpected.length) fail(`non-PASS step status: ${unexpected.join(", ")}`);
  if (!steps.length) fail("report has no steps");
}
