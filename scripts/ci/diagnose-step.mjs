//TR: YALNIZ TANI (merge edilmez, ci/diagnose-shards dalinda): config/validation.json icindeki TEK bir canonical adimi kimligiyle bulur ve ayni komutla dogrudan calistirir; adim baska platforma aitse SKIP yazar. Amac run-validation ilk hatada durdugu icin gizli kalan TUM test hatalarini iki isletim sisteminde tek turda gormektir. Kapi veya PASS kaniti DEGILDIR.
import fs from "node:fs";
import cp from "node:child_process";
const id = process.argv[2];
const cfg = JSON.parse(fs.readFileSync("config/validation.json", "utf8"));
if (id === "post") {
  let rc = 0;
  for (const s of ["scripts/secret-sanity.mjs", "scripts/bootstrap-kernel-selftest.mjs"]) { const r = cp.spawnSync(process.execPath, [s], {stdio: "inherit"}); console.log(`DIAG_STEP ${s} exit=${r.status}`); rc ||= r.status ?? 1; }
  process.exit(rc);
}
const step = cfg.steps.find((s) => s.id === id);
if (!step) { console.log(`DIAG_STEP ${id} MISSING`); process.exit(1); }
if (step.platforms && !step.platforms.includes(process.platform)) { console.log(`DIAG_STEP ${id} SKIP platform=${process.platform}`); process.exit(0); }
const t = Date.now();
const r = cp.spawnSync(step.command[0] === "node" ? process.execPath : step.command[0], step.command.slice(1), {stdio: "inherit", timeout: 1500000});
console.log(`DIAG_STEP ${id} platform=${process.platform} exit=${r.status} signal=${r.signal} durationMs=${Date.now() - t} files=${step.command.length - 3}`);
process.exit(r.status ?? 1);
