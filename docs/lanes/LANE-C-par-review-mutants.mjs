// //TR: C-PAR-1 inceleme turu 1 (#224) mutasyon denetimi: LANE-C-par-review-mutants.json içindeki her mutantı (tam metin değiştirme, dosyada tam 1 kez bulunmalı) uygular, mutanta özgü testleri (testFile içinde -t filter) çalıştırır ve KILLED/SURVIVED yazar. Taban çizgisi (mutasyonsuz) iki dosyanın "parallel runs" gruplarının tümüdür ve yeşil olmalıdır. Kullanım: node docs/lanes/LANE-C-par-review-mutants.mjs [id ...]. Mutasyona uğrayan dosyalarda commit edilmemiş değişiklik varsa reddeder.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mutants = JSON.parse(fs.readFileSync(path.join(root, "docs", "lanes", "LANE-C-par-review-mutants.json"), "utf8")).mutants;
const only = process.argv.slice(2);
const git = (...a) => cp.spawnSync("git", a, {cwd: root, encoding: "utf8"});
const files = [...new Set(mutants.map(m => m.file))];
if (git("status", "--porcelain", "--", ...files).stdout.trim() !== "") { console.error("REFUSED: the mutated files have uncommitted changes"); process.exit(2); }
const vitest = (testFiles, filter) => cp.spawnSync("npx", ["vitest", "run", ...testFiles, "-t", filter], {cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 1_200_000});
const tests = out => /Tests\s+([^\n]+)/.exec(out)?.[1]?.trim() ?? "no summary";
const base = vitest([...new Set(mutants.map(m => m.testFile))], "parallel runs"), baseOut = String(base.stdout) + String(base.stderr);
if (base.status !== 0) { console.error(`REFUSED: the unmutated baseline is not green (exit ${base.status}): ${tests(baseOut)}`); process.exit(2); }
console.log(`BASELINE green: ${tests(baseOut)}`);
let survived = 0, skipped = 0;
for (const m of mutants) {
  if (only.length > 0 && !only.includes(m.id)) continue;
  const file = path.join(root, m.file), src = fs.readFileSync(file, "utf8"), edits = m.edits ?? [{old: m.old, new: m.new}];
  if (edits.some(e => src.split(e.old).length - 1 !== 1)) { console.log(`${m.id}: SKIP (every pattern must occur exactly once)`); skipped++; continue; }
  fs.writeFileSync(file, edits.reduce((acc, e) => acc.replace(e.old, () => e.new), src));
  try {
    const t0 = Date.now(), r = vitest([m.testFile], m.filter), out = String(r.stdout) + String(r.stderr), killed = r.status !== 0;
    if (!killed) survived++;
    console.log(`${m.id} ${killed ? "KILLED" : "SURVIVED"} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${tests(out)}): ${m.description}`);
  } finally { git("checkout", "--", m.file); }
}
console.log(`DONE survivors=${survived} skipped=${skipped}`);
process.exit(survived + skipped === 0 ? 0 : 1);
