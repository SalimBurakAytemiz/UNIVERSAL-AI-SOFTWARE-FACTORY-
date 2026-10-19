// //TR: Bu test V7-CORE-TASKHUB-CODEGEN dilimidir: TaskHub "tasks" domaini için ÜRETİLEN gerçek kaynak dikey dilimini (tests/fixtures/taskhub-generated) GERÇEK UASCO ürün kod yollarından geçirir ama ÜRETİLEN KODU HİÇ ÇALIŞTIRMAZ (FD-REL-1).
// //TR: Doğrulanan davranışlar: (1) üretilen dilim gerçek deterministik teslim koduyla (ProjectStudio.prepareRunDelivery, M1A-MODE) paketlenir; aynı girdi -> aynı exportArtifactHash ve artefakt runId + sourceCommit + hash'e bağlıdır; (2) gerçek secret-scan (core/workos/secret-scan.findSecretKinds) üretilen kaynakta sızıntı bulmaz ve gerçek security-tools (discoverSecurityTools/evaluateSecurityPolicy, gitleaks/trivy) durumu DÜRÜSTÇE (INSTALLED/NOT_INSTALLED/PARTIAL) kaydedilir — sahte PASS yoktur; (3) koşu durumu SOURCE_GENERATION_COMPLETE ve productVerification NOT_VERIFIED'dir (PRODUCT_VERIFIED DEĞİL), execution-gate her yürütme türü için BLOCKED(SANDBOX_UNAVAILABLE) kalır ve paketleme sırasında üretilen kodun hiçbir süreci başlatılmaz.
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
// //TR: Bu dosyadaki gerçek G/Ç'li testler (disk, alt süreç, HTTP, git) yoğun GitHub-hosted Windows runner'da vitest'in varsayılan 5 sn test / 10 sn kanca sınırını aşabiliyor (PR #55 Windows CI: v7-b2-workos-hardening ilk testi 5 sn'de zaman aşımına uğradı). Yalnız varsayılan süre bütçesi; açık test başı süreler önceliklidir, hiçbir iddia değişmez, korunan 600 sn adım sınırı geçerlidir.
vi.setConfig({testTimeout: 120_000, hookTimeout: 180_000});
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import {WorkOsStore} from "../core/workos/store.js";
import {ExecutionGate, SANDBOX_UNAVAILABLE, PROJECT_EXECUTION_KINDS} from "../core/workos/execution-gate.js";
import {FakeExecutors} from "../core/workos/executors.js";
import {ProjectStudio} from "../core/workos/project-studio.js";
import {completionEvidence, deliveryView, deriveOutcomes, productVerificationOf, sourceGenerationOf, M1A_LABELS} from "../core/workos/outcomes.js";
import {findSecretKinds, scanDiffForSecrets} from "../core/workos/secret-scan.js";
import {discoverSecurityTools, evaluateSecurityPolicy, runGitleaksAddedLines, trivyDbState, defaultTrivyCacheDir, toolInfo, DEFAULT_MAX_TRIVY_DB_AGE_MS, type AddedLineStream} from "../core/workos/security-tools.js";
import type {SecurityToolInfo} from "../core/workos/types.js";
import {setup, okScript, runner, api, HDR, journalEntries, tmpRoot, rmTmp, ENV_POLICY} from "./support/relfx.js";
import type {Ctx} from "./support/relfx.js";
import {TASKHUB_GENERATED_FILES, TASKHUB_GENERATED_SLICE, TASKHUB_GENERATED_MANIFEST} from "./fixtures/taskhub-generated/slice.js";

const T = 180_000;
const SG = M1A_LABELS.SOURCE_GENERATION_COMPLETE, NV = M1A_LABELS.NOT_VERIFIED_SANDBOX;

let tmp = "";
const apps: Array<{close: () => Promise<unknown>}> = [];
beforeEach(() => { tmp = tmpRoot("uasco-taskhub-codegen-"); });
afterEach(async () => { vi.restoreAllMocks(); for (const a of apps.splice(0)) { try { await a.close(); } catch { /* kapanış */ } } rmTmp(tmp); });

// //TR: M1a (sandbox'sız) control API; gerçek sağlayıcı yok => execution gate BLOCKED.
type App = ReturnType<typeof api>;
const noProviderApi = (c: Ctx): App => { const a = api(c, {sandbox: undefined}); apps.push(a); return a; };

// //TR: Üretilen dilim teslim yollarında "taskhub/..." altına yerleştirilir (teslim artefaktında source/taskhub/...).
const GENERATED_UNDER_PREFIX: Record<string, string> = Object.fromEntries(
  Object.entries(TASKHUB_GENERATED_FILES).map(([p, content]) => ["taskhub/" + p, content])
);

async function studioProject(app: App, key: string): Promise<string> {
  const created = await app.inject({method: "POST", url: "/v1/projects", headers: HDR, payload: {name: "TaskHub codegen", environmentId: "dev", template: "web-node", idempotencyKey: key}});
  expect(created.statusCode, created.body).toBe(201);
  return created.json().project.projectId as string;
}

// //TR: Üretilen dilimi gerçek FakeExecutors.implement üzerinden yazdırıp gerçek runner ile SOURCE_GENERATION_COMPLETE'e kadar sürer (ÜRETİLEN KOD ÇALIŞMAZ: yalnız sahte executor + git).
async function generateSliceRun(c: Ctx, app: App, pid: string) {
  const mc = await app.inject({method: "POST", url: "/v1/missions", headers: HDR, payload: {projectId: pid, title: "Generate TaskHub tasks slice", objective: "tasks domain vertical slice", acceptanceCriteria: ["reviewed"], riskLevel: "R1"}});
  const missionId = mc.json().mission.missionId as string;
  for (const to of ["PREFLIGHT", "AUTHORIZED"]) expect((await app.inject({method: "POST", url: `/v1/missions/${missionId}/transition`, headers: HDR, payload: {to, reason: "go"}})).statusCode).toBe(200);
  const fake = new FakeExecutors(okScript({implement: () => ({files: GENERATED_UNDER_PREFIX})})), pair = fake.pair(), store = new WorkOsStore(c.dataDir);
  const r0 = store.createRun({tenantId: "tA", missionId, executor: {implementer: pair.implementer.identity, reviewer: pair.reviewer.identity}, createdBy: "FOUNDER_LOCAL"});
  await runner({...c, store, missionId}, fake, {executionGate: new ExecutionGate(null)}).tick();
  const run = store.getRun({tenantId: "tA"}, r0.runId)!;
  expect(run.status, run.reason ?? "").toBe("AWAITING_APPROVAL");
  return {missionId, run, store};
}

const prepare = (app: App, runId: string) => app.inject({method: "POST", url: `/v1/work-runs/${runId}/delivery/prepare`, headers: HDR, payload: {}});

describe("V7 CORE TaskHub code-gen: generated slice driven through real packaging + scan, never executed", () => {
  it("the generated slice is a coherent, traceable vertical slice (schema + guarded API + one screen) with a CMP/FR manifest and no secrets", () => {
    // //TR: STEP 1 doğrulaması — üretilen dilimin kapsamı ve iz düşümü (gerçek kod, lorem yok, uydurma kütüphane yok, sır yok).
    const paths = TASKHUB_GENERATED_SLICE.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["db/migrations/0001_init.sql", "src/auth.ts", "src/authorization.ts", "src/tasks.repo.ts", "src/tasks.routes.ts", "src/board.ts", "web/TaskBoard.tsx", "tests/tasks.api.test.ts"]));
    // Her Architecture bileşeni (CMP1..CMP6) en az bir üretilen dosyaca gerçeklenir.
    const covered = new Set(TASKHUB_GENERATED_SLICE.map((f) => f.component));
    for (const cmp of ["CMP1", "CMP2", "CMP3", "CMP4", "CMP5", "CMP6"]) expect(covered.has(cmp as never), cmp).toBe(true);
    // Güvenlik/yetkilendirme gerçekten kodda: auth guard + workspace izolasyonu (NFR2/NFR3) ve bcrypt hash (NFR1).
    expect(TASKHUB_GENERATED_FILES["src/authorization.ts"]).toMatch(/assertWorkspaceMember|AuthorizationError/);
    expect(TASKHUB_GENERATED_FILES["src/tasks.routes.ts"]).toMatch(/requireSession|workspaceOfProject/);
    expect(TASKHUB_GENERATED_FILES["src/auth.ts"]).toMatch(/bcrypt/);
    expect(TASKHUB_GENERATED_FILES["db/migrations/0001_init.sql"]).toMatch(/password_hash/);
    // Manifest her dosyayı eşler.
    expect(TASKHUB_GENERATED_MANIFEST.map((m) => m.path).sort()).toEqual(paths.slice().sort());
    // //TR: STEP 2a — GERÇEK secret-scan (ürün modülü) üretilen kaynağın her satırında; hiçbir sızıntı yok.
    const secretHits: Array<{path: string; line: number; kinds: string[]}> = [];
    for (const f of TASKHUB_GENERATED_SLICE) {
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) { const kinds = findSecretKinds(lines[i]); if (kinds.length) secretHits.push({path: f.path, line: i + 1, kinds}); }
    }
    expect(secretHits).toEqual([]);
  });

  it("packages the generated slice through the REAL delivery code: deterministic exportArtifactHash bound to runId + sourceCommit; no generated code is executed", { timeout: T }, async () => {
    const c = setup(tmp), app = noProviderApi(c), pid = await studioProject(app, "codegen-det");
    const {missionId, run} = await generateSliceRun(c, app, pid);

    // //TR: STEP 3 — teslimden önce durum: SOURCE_GENERATION_COMPLETE + NOT_VERIFIED, artefakt yok.
    const dv0 = (await app.inject({method: "GET", url: `/v1/work-runs/${run.runId}/delivery`, headers: HDR})).json().delivery;
    expect(dv0).toMatchObject({runId: run.runId, missionId, sourceCommit: run.headSha, sourceGeneration: {state: "SOURCE_GENERATION_COMPLETE", label: SG}, productVerification: {state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: NV}, testsExecuted: false, artifact: null});

    // //TR: prepare GERÇEK ProjectStudio.prepareRunDelivery'yi çağırır; yalnız git çalışır, üretilen kod (node/paket script) ASLA başlatılmaz.
    const spawnSync = vi.spyOn(cp, "spawnSync"), spawn = vi.spyOn(cp, "spawn");
    const n0 = journalEntries(c).length;
    const p1 = await prepare(app, run.runId);
    expect(p1.statusCode, p1.body).toBe(201);
    const art = p1.json().artifact;
    for (const call of spawnSync.mock.calls) expect(String(call[0])).toBe("git");
    expect(spawn).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    // //TR: artefakt runId + sourceCommit + exportArtifactHash'e bağlı ve yolu hash'i taşır.
    expect(art).toEqual({runId: run.runId, missionId, sourceCommit: run.headSha, treeSha: expect.stringMatching(/^[0-9a-f]{40}$/), exportArtifactHash: expect.stringMatching(/^[0-9a-f]{64}$/), artifactPath: `deliveries/${run.runId}/${art.exportArtifactHash}.zip`});
    const file = path.join(c.dataDir, art.artifactPath), bytes = fs.readFileSync(file);
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(art.exportArtifactHash);

    // //TR: DETERMINISTIK — aynı koşu tekrar paketlenince AYNI hash (yeni journal yok), ve taze ProjectStudio baytları birebir yeniden üretir.
    const p2 = await prepare(app, run.runId);
    expect(p2.statusCode).toBe(200);
    expect(p2.json()).toMatchObject({recorded: false, artifact: art});
    expect(journalEntries(c).length).toBe(n0 + 1);
    fs.rmSync(file);
    const st = new ProjectStudio({dataDir: c.dataDir, envPolicyFile: ENV_POLICY});
    const project = new WorkOsStore(c.dataDir).getProject({tenantId: "tA"}, pid)!;
    const rebuilt = st.prepareRunDelivery(project, new WorkOsStore(c.dataDir).getRun({tenantId: "tA"}, run.runId)!);
    expect(rebuilt).toEqual(art);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);

    // //TR: teslim artefaktı üretilen gerçek dosyaları source/taskhub/... altında taşır (çalıştırılmadan paketlendi).
    const text = bytes.toString("latin1");
    expect(text).toContain("source/taskhub/src/auth.ts");
    expect(text).toContain("source/taskhub/db/migrations/0001_init.sql");

    // //TR: STEP 2c — durum ekseni: SOURCE_GENERATION_COMPLETE ama PRODUCT_VERIFIED DEĞİL; mission COMPLETE değil.
    const fresh = new WorkOsStore(c.dataDir).getRun({tenantId: "tA"}, run.runId)!;
    expect(sourceGenerationOf(fresh)).toMatchObject({state: "SOURCE_GENERATION_COMPLETE", label: SG});
    expect(productVerificationOf(fresh.headSha, fresh.evidence)).toMatchObject({state: "NOT_VERIFIED", reason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE", label: NV});
    expect(deriveOutcomes(fresh).completionMode).not.toBe("COMPLETE");
    expect(completionEvidence(fresh)).toEqual({ok: false, reason: "COMPLETION_PRODUCT_NOT_VERIFIED"});
    expect(deliveryView(fresh).testsExecuted).toBe(false);

    // //TR: kanıt için exportArtifactHash kayıt altına.
    console.log("TASKHUB_CODEGEN_EVIDENCE " + JSON.stringify({kind: "delivery", runId: art.runId, sourceCommit: art.sourceCommit, treeSha: art.treeSha, exportArtifactHash: art.exportArtifactHash, artifactPath: art.artifactPath, bytes: bytes.length, sourceGeneration: "SOURCE_GENERATION_COMPLETE", productVerification: "NOT_VERIFIED", productVerificationReason: "NOT_EXECUTED:SANDBOX_UNAVAILABLE"}));
  });

  it("the execution gate stays BLOCKED(SANDBOX_UNAVAILABLE) for every project-code execution kind (the generated code is never run/previewed/tested)", { timeout: T }, async () => {
    // //TR: Üretimde sağlayıcı yoktur; ExecutionGate(null) her yürütme türünü reddeder.
    const gate = new ExecutionGate(null);
    expect(gate.registered).toBe(false);
    for (const kind of PROJECT_EXECUTION_KINDS) {
      const decision = await gate.authorize(kind);
      expect(decision, kind).toMatchObject({allowed: false, reason: SANDBOX_UNAVAILABLE, detail: "NO_VERIFIED_PROVIDER"});
    }
    const status = await gate.status();
    expect(status).toMatchObject({state: "UNAVAILABLE", reason: SANDBOX_UNAVAILABLE, detail: "NO_VERIFIED_PROVIDER", providerId: null});
    console.log("TASKHUB_CODEGEN_EVIDENCE " + JSON.stringify({kind: "execution-gate", registered: gate.registered, decision: "BLOCKED", reason: SANDBOX_UNAVAILABLE, detail: "NO_VERIFIED_PROVIDER", kinds: PROJECT_EXECUTION_KINDS}));
  });

  it("records the REAL static-security tool status honestly (gitleaks/trivy INSTALLED or NOT_INSTALLED; never a fabricated PASS) and finds no secret in the generated source", { timeout: T }, async () => {
    // //TR: STEP 2b — GERÇEK security-tools: araç keşfi (PATH -> --version) ve politika; durum ne ise dürüstçe kaydedilir.
    const toolset = discoverSecurityTools({}, process.env);
    const tools: SecurityToolInfo[] = [toolInfo(toolset.gitleaks), toolInfo(toolset.trivy), toolInfo(toolset.semgrep)];
    for (const t of tools) expect(["INSTALLED", "NOT_INSTALLED", "ERROR"]).toContain(t.status);

    // //TR: GERÇEK secret-scan ürün modülü: üretilen kaynağın her satırı + sentetik bir diff üzerinden; sızıntı yok.
    let builtinHits = 0;
    const diffParts: string[] = [];
    for (const f of TASKHUB_GENERATED_SLICE) {
      for (const line of f.content.split("\n")) builtinHits += findSecretKinds(line).length;
      const lines = f.content.split("\n");
      diffParts.push("+++ b/taskhub/" + f.path, "@@ -0,0 +1," + lines.length + " @@", ...lines.map((l) => "+" + l));
    }
    expect(builtinHits).toBe(0);
    expect(scanDiffForSecrets(diffParts.join("\n"))).toEqual([]);

    // //TR: trivy yerel DB durumu (asla indirilmez) — yoksa PARTIAL olarak dürüstçe raporlanır.
    const trivyDb = toolset.trivy.status === "INSTALLED" ? trivyDbState(defaultTrivyCacheDir(), Date.now(), DEFAULT_MAX_TRIVY_DB_AGE_MS).state : "N/A";

    // //TR: GERÇEK gitleaks (kuruluysa) üretilen kaynağın eklenen-satır akışında: sızıntı varsa FINDINGS olurdu; kod temiz olduğundan FINDINGS beklenmez (ERROR dürüstçe kaydedilir, sahte PASS yok).
    let gitleaksRun: {status: string; reason?: string; count: number} = {status: "SKIPPED", count: 0};
    if (toolset.gitleaks.status === "INSTALLED") {
      const secDir = fs.mkdtempSync(path.join(tmp, "gl-"));
      const configFile = path.join(secDir, "gitleaks.toml"), ignoreFile = path.join(secDir, "gitleaks.ignore"), cwd = path.join(secDir, "cwd");
      fs.writeFileSync(configFile, "[extend]\nuseDefault = true\n");
      fs.writeFileSync(ignoreFile, "");
      fs.mkdirSync(cwd, {recursive: true});
      const outLines: string[] = []; const refs: Array<{commit: string; file: string; line: number} | null> = [];
      for (const f of TASKHUB_GENERATED_SLICE) { const ls = f.content.split("\n"); for (let i = 0; i < ls.length; i++) { outLines.push(ls[i]); refs.push({commit: "", file: "taskhub/" + f.path, line: i + 1}); } }
      const stream: AddedLineStream = {text: outLines.join("\n") + "\n", refs};
      const ctx = {env: process.env, timeoutMs: 120_000, maxReportBytes: 32 * 1024 * 1024, abort: () => false};
      const g = await runGitleaksAddedLines(toolset.gitleaks, {stream, configFile, ignoreFile, reportFile: path.join(secDir, "raw.json"), cwd}, ctx);
      gitleaksRun = {status: g.status, ...(g.reason ? {reason: g.reason} : {}), count: g.count};
      // //TR: gerçek sızıntı (FINDINGS) olmamalı; CLEAN veya (araç/ortam) ERROR kabul edilir ama asla uydurma CLEAN yazılmaz.
      expect(g.status, JSON.stringify(gitleaksRun)).not.toBe("FINDINGS");
      expect(g.count).toBe(0);
    }

    // //TR: GERÇEK politika motoru: üretilen durumlardan dürüst bir özet (NOT_INSTALLED -> PARTIAL gap). secret yoksa BLOCKED(SECRET) değildir.
    const policy = evaluateSecurityPolicy({
      baseSha: "0".repeat(40), headSha: "1".repeat(40), cycle: 0, tools, builtinHits,
      gitleaks: {status: toolset.gitleaks.status === "INSTALLED" ? (gitleaksRun.status === "CLEAN" ? "CLEAN" : gitleaksRun.status === "FINDINGS" ? "FINDINGS" : "ERROR") : toolset.gitleaks.status === "NOT_INSTALLED" ? "NOT_INSTALLED" : "ERROR", count: gitleaksRun.count, items: [], rawReportSha256: null},
      trivy: {status: toolset.trivy.status === "INSTALLED" ? (trivyDb === "FRESH" ? "CLEAN" : "PARTIAL") : toolset.trivy.status === "NOT_INSTALLED" ? "NOT_INSTALLED" : "ERROR", ...(trivyDb !== "FRESH" && trivyDb !== "N/A" ? {reason: "TRIVY_DB_UNAVAILABLE", dbState: trivyDb} : {}), counts: {}, blocking: 0, findings: [], truncated: false, rawReportSha256: null},
      semgrep: toolInfo(toolset.semgrep)
    });
    expect(policy.blockReason).not.toBe("SECRET_DETECTED");
    expect(policy.secrets.builtin).toEqual({status: "CLEAN", hits: 0});
    // Durum, araçların gerçek varlığına göre PASSED veya PARTIAL'dır; asla sahte değildir.
    expect(["PASSED", "PARTIAL", "BLOCKED"]).toContain(policy.status);

    console.log("TASKHUB_CODEGEN_EVIDENCE " + JSON.stringify({kind: "security", tools: tools.map((t) => ({tool: t.tool, status: t.status, version: t.version})), trivyDb, gitleaksRun, builtinSecretHits: builtinHits, policyStatus: policy.status, policyBlockReason: policy.blockReason, gaps: policy.gaps}));
  });
});
