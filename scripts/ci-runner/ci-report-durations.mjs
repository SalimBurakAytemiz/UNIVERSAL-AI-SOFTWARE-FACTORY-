//TR: Canonical validation raporundaki adim surelerini yazdirir; korunan scripts/run-validation.mjs icindeki sabit 600 sn adim limitine 60 sn'den yakin veya zaman asimina ugramis adimlari isaretler (Windows sharding ihtiyacini kanitla gormek icin). Salt-okunur; raporu degistirmez; rapor yoksa bilgi verip 0 ile cikar.
import fs from "node:fs";

const file = ".ai/runtime/VALIDATION_REPORT.json";
if (!fs.existsSync(file)) { console.log("no VALIDATION_REPORT.json (validation did not run or stopped before writing it)"); process.exit(0); }
let report;
try { report = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.log(`VALIDATION_REPORT.json unreadable: ${e.message}`); process.exit(0); }

const CAP_MS = 600000;
const WARN_MS = CAP_MS - 60000;
console.log(`status=${report.status} platform=${report.platform}`);
let near = 0;
for (const s of Array.isArray(report.steps) ? report.steps : []) {
  const ms = Number(s.durationMs) || 0;
  const flag = s.timedOut ? "  <-- TIMED OUT at the 600s per-step cap" : ms >= WARN_MS ? "  <-- within 60s of the 600s per-step cap" : "";
  if (s.timedOut || ms >= WARN_MS) near++;
  console.log(`${String(s.status).padEnd(18)} ${String(ms).padStart(8)}ms  ${s.id}${flag}`);
}
if (near) console.log(`WARN: ${near} step(s) at/near the hardcoded 600s per-step cap (protected scripts/run-validation.mjs). Real fix: shard the step in config/validation.json (protected -> maintainer edit + trust-root reseal).`);
