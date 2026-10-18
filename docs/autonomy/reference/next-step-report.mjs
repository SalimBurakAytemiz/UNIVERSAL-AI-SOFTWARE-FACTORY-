//TR: CANLI pipeline durum raporu: gercek next-step engine'i gercek backlog taslagina karsi, gercek git-ref lease store (gecici repo) ile calistirir ve Cloud'un su an ne yapmasi gerektigini SINIFLANDIRILMIS olarak basar (START / NO_READY_WORK / AUTHORITY_REQUIRED / BLOCKED / RECOVERABLE_FAILURE). Hicbir gorevi READY ilan etmez, hicbir seyi uretime almaz; yalniz okur ve raporlar. Kanit: taskId, lease ref durumu, HEAD SHA, zaman damgasi.
// Live next-step pipeline-state report. Runs the REAL selectNext against the REAL backlog draft over a REAL
// git-ref lease store in a throwaway repo, and prints the classified decision + evidence. Read-only: it never
// declares a task READY, never writes to the backlog, and takes no lease in the real repo.
// Run (Node 24):  node docs/autonomy/reference/next-step-report.mjs
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {selectNext} from "./next-step-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_LIB = path.join(HERE, "../../../automation/lib");
const {createLocalGitRefStore} = await import(path.join(REPO_LIB, "task-lease-git-store.mjs"));

const backlog = JSON.parse(readFileSync(path.join(HERE, "../backlog-drafts/BACKLOG_CHECKPOINT.json"), "utf8"));
const tasks = backlog.tasks ?? [];
// Map the draft schema to the engine's selectable shape (id, owner, status, authorizedBy, dependsOn).
const engineTasks = tasks.map((t) => ({
  id: t.id, owner: t.owner, status: t.status, authorizedBy: t.authorizedBy ?? null, dependsOn: t.dependsOn ?? [],
}));
const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

const tmpRoot = mkdtempSync(path.join(HERE, ".nextstep-report-"));
process.on("exit", () => { try { rmSync(tmpRoot, {recursive: true, force: true}); } catch {} });
const git = (args) => spawnSync("git", args, {encoding: "utf8"});
const init = spawnSync("git", ["init", "-q", tmpRoot], {encoding: "utf8"});
if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
const store = createLocalGitRefStore({repoDir: tmpRoot});
const leaseRefs = () => git(["-C", tmpRoot, "for-each-ref", "--format=%(refname)", "refs/uasco/claims/"]).stdout.split("\n").filter(Boolean);

const repoRoot = path.join(HERE, "../../..");
const headSha = (spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {encoding: "utf8"}).stdout || "").trim();
const nowIso = new Date().toISOString();
const owner = {environment: "CLOUD", workerId: "cloud-report", sessionId: "report-session"};

const outcome = selectNext(engineTasks, {store, owner, ttlMs: 900_000, headSha});

// Richer analysis for the DRAFT_NOT_READY / dependency-blocked cloud candidates the bare engine skips.
const statusOf = (id) => byId[id]?.status ?? "ABSENT";
const cloudCandidates = tasks.filter((t) => t.owner === "CLOUD").map((t) => ({
  id: t.id, status: t.status, authorizedBy: t.authorizedBy ?? null,
  dependsOn: (t.dependsOn ?? []).map((d) => `${d}=${statusOf(d)}`),
  startable: t.status === "READY" && !!t.authorizedBy && (t.dependsOn ?? []).every((d) => statusOf(d) === "DONE"),
  blockers: [
    t.status !== "READY" ? `NOT_READY(${t.status})` : null,
    !t.authorizedBy ? "NO_FOUNDER_AUTHORIZATION" : null,
    ...(t.dependsOn ?? []).filter((d) => statusOf(d) !== "DONE").map((d) => `DEP_NOT_DONE:${d}(${statusOf(d)})`),
  ].filter(Boolean),
}));

const report = {
  "//TR": "Canli pipeline durum raporu ciktisi; READY ilani veya uretim degil, yalniz okuma+siniflandirma.",
  generatedAt: nowIso,
  backlogSource: backlog.head ?? backlog.source ?? null,
  repoHeadSha: headSha,
  taskCounts: tasks.reduce((a, t) => ((a[t.status] = (a[t.status] ?? 0) + 1), a), {}),
  owners: tasks.reduce((a, t) => ((a[t.owner] = (a[t.owner] ?? 0) + 1), a), {}),
  engineOutcome: outcome.action,
  engineReason: outcome.reason ?? null,
  leaseRefsTakenInRealRepo: 0,
  leaseRefsInTempProbe: leaseRefs().length,
  readyCloudTasks: engineTasks.filter((t) => t.status === "READY" && t.owner === "CLOUD" && t.authorizedBy).map((t) => t.id),
  cloudCandidates,
  classification:
    outcome.action === "START" ? "WORK_AVAILABLE"
    : cloudCandidates.some((c) => c.startable) ? "WORK_AVAILABLE"
    : cloudCandidates.length && cloudCandidates.every((c) => c.blockers.includes("NO_FOUNDER_AUTHORIZATION")) ? "AUTHORITY_REQUIRED"
    : "NO_READY_WORK",
};

console.log(JSON.stringify(report, null, 2));
console.log(`\nDECISION: engine=${report.engineOutcome} (${report.engineReason ?? "-"}); operator-classification=${report.classification}`);
console.log(`EVIDENCE: HEAD=${headSha} at ${nowIso}; no lease taken in the real repo (temp-probe refs=${report.leaseRefsInTempProbe}).`);
if (report.classification === "AUTHORITY_REQUIRED") {
  console.log("CLOUD capacity is not blocked by the engine: every cloud candidate needs Founder READY authorization and/or its dependencies (FA-LEASE2 wiring) to land. No task is self-declared READY.");
}
