// //TR: Tester golden-tests-v1 mutasyon denetimi: LANE-C-eval-tester-mutants.json içindeki her mutantı (tam metin değiştirme, dosyada tam 1 kez bulunmalı) uygular, ilgili test grubunu çalıştırır ve KILLED/SURVIVED yazar; dosyayı her zaman git'ten geri yükler. Kullanım: node docs/lanes/LANE-C-eval-tester-mutants.mjs [id ...]. Yalnız temiz (commit edilmiş) çalışma ağacında çalışır.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mutants = JSON.parse(fs.readFileSync(path.join(root, "docs", "lanes", "LANE-C-eval-tester-mutants.json"), "utf8")).mutants;
const only = process.argv.slice(2);
const git = (...a) => cp.spawnSync("git", a, {cwd: root, encoding: "utf8"});
const files = [...new Set(mutants.map(m => m.file))];
if (git("status", "--porcelain", "--", ...files).stdout.trim() !== "") { console.error("REFUSED: the mutated files have uncommitted changes"); process.exit(2); }
// //TR: Taban çizgisi: mutasyonsuz grup ÖNCE koşar; yeşil değilse (hata, çökme, zaman aşımı) her "KILLED" anlamsızdır, bu yüzden reddedilir.
const runGroup = () => cp.spawnSync("npx", ["vitest", "run", "tests/v7-wfr03-role-registry.test.ts", "-t", "C-EVAL-PIPELINE"], {cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 900_000});
const base = runGroup(), baseOut = String(base.stdout) + String(base.stderr);
if (base.status !== 0) { console.error(`REFUSED: the unmutated baseline is not green (exit ${base.status}): ${/Tests\s+([^\n]+)/.exec(baseOut)?.[1]?.trim() ?? "no summary"}`); process.exit(2); }
console.log(`BASELINE green: ${/Tests\s+([^\n]+)/.exec(baseOut)?.[1]?.trim()}`);
let survived = 0, skipped = 0;
for (const m of mutants) {
  if (only.length > 0 && !only.includes(m.id)) continue;
  const file = path.join(root, m.file), src = fs.readFileSync(file, "utf8");
  if (src.split(m.old).length - 1 !== 1) { console.log(`${m.id}: SKIP (pattern must occur exactly once)`); skipped++; continue; }
  fs.writeFileSync(file, src.replace(m.old, () => m.new));
  try {
    const t0 = Date.now();
    const r = cp.spawnSync("npx", ["vitest", "run", "tests/v7-wfr03-role-registry.test.ts", "-t", "C-EVAL-PIPELINE"], {cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 900_000});
    const out = String(r.stdout) + String(r.stderr), tests = /Tests\s+([^\n]+)/.exec(out)?.[1]?.trim() ?? "no summary";
    const killed = r.status !== 0;
    if (!killed) survived++;
    console.log(`${m.id} ${killed ? "KILLED" : "SURVIVED"} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${tests}): ${m.description}`);
  } finally { git("checkout", "--", m.file); }
}
console.log(`DONE survivors=${survived} skipped=${skipped}`);
process.exit(survived + skipped === 0 ? 0 : 1);
