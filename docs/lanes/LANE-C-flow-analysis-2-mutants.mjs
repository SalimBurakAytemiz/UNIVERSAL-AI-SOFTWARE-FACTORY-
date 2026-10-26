// //TR: C-FLOW-ANALYSIS-2 mutasyon denetimi: LANE-C-flow-analysis-2-mutants.json içindeki her mutantı (tam metin değiştirme, dosyada tam 1 kez bulunmalı) uygular, tests/v7-core-predev-crew-coordination.test.ts dosyasını (mutant başına testFile/filter ile değiştirilebilir) çalıştırır ve KILLED/SURVIVED yazar. Kullanım: node docs/lanes/LANE-C-flow-analysis-2-mutants.mjs [id ...]. Mutasyona uğrayan dosyada commit edilmemiş değişiklik varsa reddeder (önce commit).
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mutants = JSON.parse(fs.readFileSync(path.join(root, "docs", "lanes", "LANE-C-flow-analysis-2-mutants.json"), "utf8")).mutants;
const only = process.argv.slice(2);
const git = (...a) => cp.spawnSync("git", a, {cwd: root, encoding: "utf8"});
const files = [...new Set(mutants.map(m => m.file))];
if (git("status", "--porcelain", "--", ...files).stdout.trim() !== "") { console.error("REFUSED: the mutated files have uncommitted changes"); process.exit(2); }
// //TR: #237 incelemesi: mutant başına isteğe bağlı testFile/filter (varsayılan: coordination dosyası + "C-FLOW-ANALYSIS"); taban çizgisi her ayrı (dosya, filtre) grubu için ÖNCE koşar ve yeşil olmalıdır; değilse her "KILLED" anlamsızdır, bu yüzden reddedilir.
const DEFAULT_FILE = "tests/v7-core-predev-crew-coordination.test.ts", DEFAULT_FILTER = "C-FLOW-ANALYSIS";
const groupOf = m => ({testFile: m.testFile ?? DEFAULT_FILE, filter: m.filter ?? DEFAULT_FILTER});
// //TR: win32'de shell:true argümanları TIRNAKLAMAZ: `|` ve boşluk içeren bir -t süzgeci cmd.exe'de boru/ayrı argüman olur (taban çizgisi REFUSED). Bu yüzden win32'de süzgeç çift tırnak içinde verilir.
const quoteFilter = f => process.platform === "win32" ? `"${f}"` : f;
const vitest = g => cp.spawnSync("npx", ["vitest", "run", g.testFile, "-t", quoteFilter(g.filter)], {cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 900_000});
const summary = out => /Tests\s+([^\n]+)/.exec(out)?.[1]?.trim() ?? "no summary";
const groups = [...new Map(mutants.filter(m => only.length === 0 || only.includes(m.id)).map(groupOf).map(g => [`${g.testFile}|${g.filter}`, g])).values()];
for (const g of groups) {
  const base = vitest(g), baseOut = String(base.stdout) + String(base.stderr);
  if (base.status !== 0) { console.error(`REFUSED: the unmutated baseline is not green for ${g.testFile} -t ${g.filter} (exit ${base.status}): ${summary(baseOut)}`); process.exit(2); }
  console.log(`BASELINE green (${g.testFile} -t ${g.filter}): ${summary(baseOut)}`);
}
let survived = 0, skipped = 0;
for (const m of mutants) {
  if (only.length > 0 && !only.includes(m.id)) continue;
  const file = path.join(root, m.file), src = fs.readFileSync(file, "utf8"), edits = m.edits ?? [{old: m.old, new: m.new}];
  if (edits.some(e => src.split(e.old).length - 1 !== 1)) { console.log(`${m.id}: SKIP (every pattern must occur exactly once)`); skipped++; continue; }
  fs.writeFileSync(file, edits.reduce((acc, e) => acc.replace(e.old, () => e.new), src));
  try {
    const t0 = Date.now();
    const r = vitest(groupOf(m));
    const out = String(r.stdout) + String(r.stderr), tests = summary(out);
    const killed = r.status !== 0;
    if (!killed) survived++;
    console.log(`${m.id} ${killed ? "KILLED" : "SURVIVED"} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${tests}): ${m.description}`);
  } finally { git("checkout", "--", m.file); }
}
console.log(`DONE survivors=${survived} skipped=${skipped}`);
process.exit(survived + skipped === 0 ? 0 : 1);
