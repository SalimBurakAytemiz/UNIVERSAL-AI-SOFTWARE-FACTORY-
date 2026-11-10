// //TR: Bu betik V4.1 yürütme matrisinden (docs/planning/v41/UASCO_V4_1_CLOUD_MERGED.zip içindeki 02_V4_1_EXECUTION_MATRIX.json) ve Founder onaylı Factory V2 görev kaydından (docs/planning/autonomy/factory-v2-tasks.json) otonom döngünün okuduğu küçük görev dizinini (id, kademe, bağımlılık, kapılar, durum) üretir; her kaynağın SHA-256'sı kayda geçer, görev uydurulmaz, kimlik çakışması veya geçersiz FV2 kaydı üretimi durdurur.
// Usage: node docs/planning/autonomy/build-task-index.mjs [--check]
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ZIP = "docs/planning/v41/UASCO_V4_1_CLOUD_MERGED.zip";
const ENTRY = "UASCO_V4_1_CLOUD/02_V4_1_EXECUTION_MATRIX.json";
const OUT = "docs/planning/autonomy/task-index.json";
const FV2 = "docs/planning/autonomy/factory-v2-tasks.json";
const FV2_ID = /^FV2-T\d{4}$/;
const TIERS = ["T0", "T1", "T2", "T3"];
// No done-counting status (ASSET_DONE/DONE_OBSERVED): an FV2 task is done only through a verified STATE.json entry of a merged PR.
const FV2_STATUSES = ["VERIFY_PENDING", "DEFERRED", "BLOCKED"];
const FV2_KEYS = ["id", "tier", "status", "wave", "deps", "startGates", "mergeGates", "exec", "name"];
const GATE = /^D-\d{2}$/;

/** Factory V2 tasks (hand-written, Founder-approved source). Fail-closed: any malformed entry or id collision stops the build. */
export function fv2Tasks(raw, matrixIds) {
  const f = JSON.parse(raw);
  if (f?.schemaVersion !== "1.0.0" || !Array.isArray(f.tasks)) throw new Error("FV2_TASKS_SCHEMA");
  const seen = new Set();
  for (const t of f.tasks) {
    const keys = t && typeof t === "object" ? Object.keys(t) : [];
    if (keys.length !== FV2_KEYS.length || !FV2_KEYS.every(k => keys.includes(k))) throw new Error(`FV2_TASK_KEYS:${t?.id}`);
    if (typeof t.id !== "string" || !FV2_ID.test(t.id)) throw new Error(`FV2_TASK_ID:${t.id}`);
    if (seen.has(t.id) || matrixIds.has(t.id)) throw new Error(`FV2_TASK_ID_COLLISION:${t.id}`);
    if (!TIERS.includes(t.tier)) throw new Error(`FV2_TASK_TIER:${t.id}`);
    if (!FV2_STATUSES.includes(t.status)) throw new Error(`FV2_TASK_STATUS:${t.id}`);
    if (t.wave !== "FV2" || t.exec !== "CLOUD" || typeof t.name !== "string" || !t.name.trim()) throw new Error(`FV2_TASK_FIELDS:${t.id}`);
    if (![t.startGates, t.mergeGates].every(g => Array.isArray(g) && g.every(x => typeof x === "string" && GATE.test(x)))) throw new Error(`FV2_TASK_GATES:${t.id}`);
    // Typed deps only, on an earlier FV2 task or a matrix task: no forward reference, so the dependency graph stays acyclic.
    if (!Array.isArray(t.deps) || !t.deps.every(d => Array.isArray(d) && d.length === 2 && d[1] === "MERGED" && (seen.has(d[0]) || matrixIds.has(d[0])))) throw new Error(`FV2_TASK_DEPS:${t.id}`);
    seen.add(t.id);
  }
  return f.tasks.map(t => Object.fromEntries(FV2_KEYS.map(k => [k, t[k]])));
}

export function buildIndex(raw, fv2Raw) {
  if (typeof fv2Raw !== "string") throw new Error("FV2_TASKS_MISSING"); // the registry is never silently dropped
  const m = JSON.parse(raw);
  const tasks = m.tasks.map(t => ({
    id: t.id, tier: t.authorityTier, status: t.v31Status, wave: t.wave ?? null,
    deps: Array.isArray(t.deps) ? t.deps : Array.isArray(t.dependsOn) ? t.dependsOn : [],
    startGates: t.startGates ?? [], mergeGates: t.mergeGates ?? [],
    exec: t.executionLocation ?? null, name: t.name,
  }));
  const sha = x => createHash("sha256").update(x).digest("hex");
  const extra = fv2Tasks(fv2Raw, new Set(tasks.map(t => t.id)));
  return {
    "//TR": "build-task-index.mjs tarafından V4.1 yürütme matrisinden ve factory-v2-tasks.json kaydından türetilir; elle düzenlenmez.",
    source: {zip: ZIP, entry: ENTRY, sha256: sha(raw)},
    extraSources: [{path: FV2, sha256: sha(fv2Raw), count: extra.length}],
    count: tasks.length + extra.length, tasks: [...tasks, ...extra],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = execFileSync("unzip", ["-p", ZIP, ENTRY], {maxBuffer: 64 << 20}).toString("utf8");
  const text = JSON.stringify(buildIndex(raw, fs.readFileSync(FV2, "utf8")), null, 1) + "\n";
  if (process.argv.includes("--check")) {
    const ok = fs.readFileSync(OUT, "utf8") === text;
    console.log(ok ? "TASK_INDEX_OK" : "TASK_INDEX_STALE");
    process.exit(ok ? 0 : 2);
  }
  fs.writeFileSync(OUT, text);
  console.log(`TASK_INDEX_WRITTEN ${JSON.parse(text).count}`);
}
