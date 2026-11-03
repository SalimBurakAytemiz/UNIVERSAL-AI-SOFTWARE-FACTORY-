// //TR: Bu betik V4.1 yürütme matrisinden (docs/planning/v41/UASCO_V4_1_CLOUD_MERGED.zip içindeki 02_V4_1_EXECUTION_MATRIX.json) otonom döngünün okuduğu küçük görev dizinini (id, kademe, bağımlılık, kapılar, durum) üretir; kaynak SHA-256 kayda geçer, görev uydurulmaz.
// Usage: node docs/planning/autonomy/build-task-index.mjs [--check]
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ZIP = "docs/planning/v41/UASCO_V4_1_CLOUD_MERGED.zip";
const ENTRY = "UASCO_V4_1_CLOUD/02_V4_1_EXECUTION_MATRIX.json";
const OUT = "docs/planning/autonomy/task-index.json";

export function buildIndex(raw) {
  const m = JSON.parse(raw);
  const tasks = m.tasks.map(t => ({
    id: t.id, tier: t.authorityTier, status: t.v31Status, wave: t.wave ?? null,
    deps: Array.isArray(t.deps) ? t.deps : Array.isArray(t.dependsOn) ? t.dependsOn : [],
    startGates: t.startGates ?? [], mergeGates: t.mergeGates ?? [],
    exec: t.executionLocation ?? null, name: t.name,
  }));
  return {
    "//TR": "build-task-index.mjs tarafından V4.1 yürütme matrisinden türetilir; elle düzenlenmez.",
    source: {zip: ZIP, entry: ENTRY, sha256: createHash("sha256").update(raw).digest("hex")},
    count: tasks.length, tasks,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = execFileSync("unzip", ["-p", ZIP, ENTRY], {maxBuffer: 64 << 20}).toString("utf8");
  const text = JSON.stringify(buildIndex(raw), null, 1) + "\n";
  if (process.argv.includes("--check")) {
    const ok = fs.readFileSync(OUT, "utf8") === text;
    console.log(ok ? "TASK_INDEX_OK" : "TASK_INDEX_STALE");
    process.exit(ok ? 0 : 2);
  }
  fs.writeFileSync(OUT, text);
  console.log(`TASK_INDEX_WRITTEN ${JSON.parse(text).count}`);
}
