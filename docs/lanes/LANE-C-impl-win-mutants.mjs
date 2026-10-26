// //TR: C-IMPL-WIN-1 mutasyon denetimi: LANE-C-impl-win-mutants.json içindeki her mutantı (tam metin değiştirme, dosyada tam 1 kez bulunmalı) uygular, tests/v7-lane-c-claude-readiness.test.ts dosyasını çalıştırır ve KILLED/SURVIVED yazar. Kullanım: node docs/lanes/LANE-C-impl-win-mutants.mjs [id ...]. Mutasyona uğrayan dosyalarda commit edilmemiş değişiklik varsa reddeder (önce commit).
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mutants = JSON.parse(fs.readFileSync(path.join(root, "docs", "lanes", "LANE-C-impl-win-mutants.json"), "utf8")).mutants;
const only = process.argv.slice(2);
const git = (...a) => cp.spawnSync("git", a, {cwd: root, encoding: "utf8"});
const files = [...new Set(mutants.map(m => m.file))];
if (git("status", "--porcelain", "--", ...files).stdout.trim() !== "") { console.error("REFUSED: the mutated files have uncommitted changes"); process.exit(2); }
// //TR: Taban çizgisi: mutasyonsuz grup ÖNCE koşar; yeşil değilse (hata, çökme, zaman aşımı) her "KILLED" anlamsızdır, bu yüzden reddedilir.
const runGroup = () => cp.spawnSync("npx", ["vitest", "run", "tests/v7-lane-c-claude-readiness.test.ts"], {cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 900_000});
const base = runGroup(), baseOut = String(base.stdout) + String(base.stderr);
if (base.status !== 0) { console.error(`REFUSED: the unmutated baseline is not green (exit ${base.status}): ${/Tests\s+([^\n]+)/.exec(baseOut)?.[1]?.trim() ?? "no summary"}`); process.exit(2); }
console.log(`BASELINE green: ${/Tests\s+([^\n]+)/.exec(baseOut)?.[1]?.trim()}`);
let survived = 0, skipped = 0;
for (const m of mutants) {
  if (only.length > 0 && !only.includes(m.id)) continue;
  const file = path.join(root, m.file), src = fs.readFileSync(file, "utf8"), edits = m.edits ?? [{old: m.old, new: m.new}];
  if (edits.some(e => src.split(e.old).length - 1 !== 1)) { console.log(`${m.id}: SKIP (every pattern must occur exactly once)`); skipped++; continue; }
  fs.writeFileSync(file, edits.reduce((acc, e) => acc.replace(e.old, () => e.new), src));
  try {
    const t0 = Date.now();
    const r = cp.spawnSync("npx", ["vitest", "run", "tests/v7-lane-c-claude-readiness.test.ts"], {cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 900_000});
    const out = String(r.stdout) + String(r.stderr), tests = /Tests\s+([^\n]+)/.exec(out)?.[1]?.trim() ?? "no summary";
    const killed = r.status !== 0;
    if (!killed) survived++;
    console.log(`${m.id} ${killed ? "KILLED" : "SURVIVED"} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${tests}): ${m.description}`);
  } finally { git("checkout", "--", m.file); }
}
console.log(`DONE survivors=${survived} skipped=${skipped}`);
process.exit(survived + skipped === 0 ? 0 : 1);
