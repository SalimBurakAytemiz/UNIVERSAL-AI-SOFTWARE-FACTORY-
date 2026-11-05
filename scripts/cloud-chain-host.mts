// //TR: Yerel tek süreçli bulut zinciri koşucusu (CLOUD-T0016, kanıt sınıfı LOCAL_E2E): Founder komutu -> intake -> SUPERVISOR_TEST_ONLY imzalı onay -> LOCAL_STUB planlayıcı -> DAG -> CloudJobQueue -> CloudWorker -> linux-unshare-v2 sandbox (yalnız öz-testi geçerse) -> CloudArtifactStore. Anahtarlar yalnız ortam değişkeni adlarıyla okunur; eksikse çıkış 2 (fail-closed). Sandbox doğrulanamazsa (Windows/macOS/unshare yok) çıkış 3 ve SKIPPED gerekçesi; asla sahte PASS yok. Ağ yok, ücretli API yok; bu bir bulut E2E değildir.
// Kullanım: node --import tsx scripts/cloud-chain-host.mts --supervisor-test [--data-dir DIR] [--command "Ayarlar sayfasını geliştir"]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {CHAIN_HOST_ENV, cloudKeysFromEnv, createCloudChainHost, supervisorTestSigner, SUPERVISOR_TEST_SIGNER_LABEL} from "../apps/control-api/src/cloud/chain-host.js";
import {LinuxUnshareSandboxProvider} from "../core/agents/linux-unshare-sandbox.js";
import type {PlannerModel} from "../core/cloud/task-orchestrator.js";
import type {CloudJobHandlers} from "../core/sandbox/cloud-sandbox-provider.js";

const args = process.argv.slice(2);
const arg = (name: string, def: string) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const out = (o: unknown) => process.stdout.write(JSON.stringify(o, null, 2) + "\n");

const keys = cloudKeysFromEnv(process.env);
if (!keys.ok) { out({result: "FAIL_CLOSED", reason: "KEYS_MISSING", missingEnv: keys.missing, expectedEnv: Object.values(CHAIN_HOST_ENV)}); process.exit(2); }
if (!args.includes("--supervisor-test")) { out({result: "FAIL_CLOSED", reason: "NO_CONFIRMATION_SIGNER", detail: "only --supervisor-test signing exists locally; a real Founder confirmation flow is not wired (K2)"}); process.exit(2); }

const dataDir = arg("--data-dir", fs.mkdtempSync(path.join(os.tmpdir(), "uasco-chain-host-")));
const command = arg("--command", "Ayarlar sayfasını geliştir");
const tenantId = "tenant-local", projectId = "proj-local";

/** LOCAL_STUB planlayıcı: deterministik; gerçek/ücretli sağlayıcı yok (K3). */
const planner: PlannerModel = {name: "LOCAL_STUB", async invoke() {
  const t = (key: string, kind: string, deps: string[]) => ({key, kind, title: `LOCAL_STUB ${key}`, deps, needsNetwork: false, estimatedCostUsd: 0, timeoutMs: 120_000, retry: {maxAttempts: 2, backoffMs: 0}});
  return {text: JSON.stringify({tasks: [t("build", "BUILD", []), t("test", "TEST", ["build"]), t("package", "PACKAGE", ["test"])]}), inputTokens: 0, outputTokens: 0, costUsd: 0};
}};
/** Sabit argv; gerçek komutlar yalnız sandbox içinde koşar. */
const handlers: CloudJobHandlers = {
  BUILD: () => ({argv: ["sh", "-c", "mkdir -p out && printf 'built by sandbox\\n' > out/build.txt"], outputs: ["out/build.txt"]}),
  TEST: () => ({argv: ["sh", "-c", "mkdir -p out && test \"$(printf ok)\" = ok && printf 'tests ok\\n' > out/test.txt"], outputs: ["out/test.txt"]}),
  PACKAGE: () => ({argv: ["sh", "-c", "mkdir -p dist && printf 'package\\n' > dist/app.txt"], outputs: ["dist/app.txt"]}),
};

const sandbox = process.platform === "linux" ? new LinuxUnshareSandboxProvider((process.getuid?.() ?? 1) === 0 ? {acceptUnenforcedProcessLimit: true} : {}) : null;
const st = sandbox ? await sandbox.selfTest().catch(e => ({ok: false, detail: String(e)})) : {ok: false, detail: `no sandbox provider on ${process.platform}`};

const host = createCloudChainHost({dataDir, keys: keys.keys, sandbox, planner, plannerModel: "LOCAL_STUB", handlers, globalStopFile: path.join(dataDir, "GLOBAL_STOP.json")});
const signer = supervisorTestSigner(keys.keys);
const scope = signer.scope({tenantId, projectId, environment: "staging", jobKinds: ["BUILD", "TEST", "PACKAGE"], allowNetwork: false, maxCostUsd: 1});
const steps: unknown[] = [];
let report: unknown = null, exit = 0, dagTasks: {key: string; taskId: string}[] = [];
try {
  for (let round = 0; round < 10; round++) {
    const conf = signer.confirmation({objectiveSha256: createHash("sha256").update(command).digest("hex"), tenantId, projectId, environment: "staging"});
    const d = await host.dispatch(command, conf, scope);
    if (!d.ok) { report = {dispatch: d}; exit = 1; break; }
    dagTasks = d.dag.order.map(id => ({key: d.dag.tasks.get(id)!.key, taskId: id}));
    report = {namespace: d.namespace, statuses: Object.fromEntries(d.dag.order.map(id => [d.dag.tasks.get(id)!.key, d.report.statuses[id]])), complete: d.report.complete, failed: d.report.failed, plannerCached: d.plannerCached};
    if (d.report.complete || d.report.failed) break;
    if (!st.ok) break;
    for (let i = 0; i < 10; i++) { const s = await host.runWorkerOnce(); steps.push(s); if (s.state !== "DONE") break; }
  }
  // #344 B-1: artifact'lar AD ile değil, kuyruğun kabul ettiği iş sonuçlarından listelenir (iş+deneme kapsamlı adlar).
  const artifacts = [];
  for (const t of dagTasks) for (const ref of host.resultArtifacts(t.taskId)) {
    const g = await host.store.get({tenantId, subject: "chain-host"}, {tenantId, projectId, name: ref.name});
    const rel = ref.name.split("/").slice(3).join("/");
    artifacts.push(g.ok ? {job: t.key, name: rel, storedAs: ref.name, sha256: g.manifest.sha256, sizeBytes: g.manifest.sizeBytes, content: g.content.toString().trim()} : {job: t.key, name: rel, storedAs: ref.name, missing: g.reason});
  }
  // İş başına kuyruk durum geçişleri (QUEUED -> STARTED -> HEARTBEAT* -> ARTIFACT* -> SUCCEEDED/RETRYING/FAILED/STOPPED)
  const jobs = dagTasks.map(t => { const j = host.queue.get(t.taskId); return {key: t.key, status: j?.status ?? "NOT_SUBMITTED", attempt: j?.attempt ?? 0, transitions: (j?.events ?? []).map(e => e.type)}; });
  // Doğrulanmış teslim: paket için sha'ya bağlı imzalı URL üretilir, geri alınır ve içerik özeti manifestle karşılaştırılır.
  let delivery: unknown = {skipped: "no accepted package result"};
  const pkg = dagTasks.find(t => t.key === "package");
  if (pkg && host.resultArtifacts(pkg.taskId).length > 0) {
    delivery = {job: "package", ...(await host.deliver(tenantId, projectId, pkg.taskId, "dist/app.txt"))};
    if (!(delivery as {verified: boolean}).verified) exit = exit || 1;
  }
  const detail = String((st as {detail?: unknown}).detail ?? "self-test failed").slice(0, 200);
  const sandboxState = st.ok ? "REAL (linux-unshare-v2 self-test passed)" : process.platform === "linux" ? `SKIPPED: ${detail}` : `UNAVAILABLE (SKIPPED) on ${process.platform}: no verified sandbox provider`;
  if (!st.ok) exit = 3;
  else if (!(report as {complete?: boolean})?.complete) exit = exit || 1;
  out({result: exit === 0 ? "PASS" : exit === 3 ? "SKIPPED" : "FAIL", evidenceClass: "LOCAL_E2E", label: "LOCAL_E2E: single local process; NOT a cloud E2E",
    httpStartRoute: "NONE", confirmationSigner: SUPERVISOR_TEST_SIGNER_LABEL, planner: "LOCAL_STUB", sandbox: sandboxState, dataDir, report, jobs, workerSteps: steps, artifacts, delivery});
} finally {
  await host.stop();
}
process.exit(exit);
