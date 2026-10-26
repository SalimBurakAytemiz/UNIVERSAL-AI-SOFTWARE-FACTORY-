// //TR: Bu dosya B3a mission runner engine'idir: AUTHORIZED/PLANNED bir mission'ı izole workspace -> IMPLEMENT -> VERIFY (diff secret taraması + yalnız doğrulanmış sandbox'ta test; sandbox yoksa M1a: NOT_EXECUTED kanıtı ve devam) -> SECURITY (taze klonlarda gitleaks + trivy çevrimdışı, dürüst SAST/DB durumu) -> bağımsız REVIEW (ayrı kimlik, temiz klon, salt-okunur) -> REGRESSION -> REPORT adımlarıyla sürer ve REPORTING'de Founder teslim kararında durur (asla COMPLETE/merge/push yapmaz). Durum yalnız Work OS journal'ındadır; lease+fencing, checkpoint, sınırlı retry/remediation, GLOBAL_STOP ve crash-resume fail-closed çalışır.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {monitorEventLoopDelay, performance} from "node:perf_hooks";
import type {IntervalHistogram} from "node:perf_hooks";
import {acquireProcessLock} from "../../automation/lib/process-lock.mjs";
import {globalStopState} from "../../automation/lib/global-stop.mjs";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import type {MissionStatus} from "../mission/types.js";
import type {WorkOsStore, RunPatch, RunWriteOptions} from "./store.js";
import {WorkOsError} from "./types.js";
import type {RunEvidence, RunStatus, RunStep, SecurityStageSummary, WorkRun} from "./types.js";
import {LEASED_RUN_STATUSES} from "./run-state.js";
import {testCommandAllowed} from "./schemas.js";
import {canonicalPath, managedRepoCanonical, pathOverlapsDataDir} from "./path-guard.js";
import {runGitAsync} from "./git-async.js";
import type {GitRun} from "./git-async.js";
import {
  OWNER_FILE, WRITER_KILL_WAIT_MS, accessDeniedVerdict, bootId, bootTimeMs, installTerminationForwarding, isTerminating, killWriterGroup, leaderlessGroupProof, readOwner, sameBoot, startToken, startTokenLinux, sweepWriters,
  trackWriterGroup, untrackWriterGroup, writeOwner, writerEnvFor, writerState
} from "./writer-guard.js";
import type {WorkspaceOwner} from "./writer-guard.js";
import {redactSecrets, scanCommitMessagesForSecrets, scanDiffForSecrets} from "./secret-scan.js";
// INT-R4: runProcess (REL-FX ana-makine test çalıştırıcısı) ARTIK kullanılmaz; yürütme yalnız execution-gate sağlayıcısı (gate.provider.run) üzerinden gider, ana makinede asla.
import {assertIndependentExecutors} from "./executors.js";
import {ExecutionGate} from "./execution-gate.js";
import {assertImplementerRole, assertRoleExecutes, bindingForFunction, taskLimitsFor} from "../agents/first-delivery-bindings.js";
import {advanceAgent, agentTraceEnvelope, effectiveLimits, instantiateAgent} from "../agents/role-execution.js";
import type {RoleExecutionProfile} from "../agents/role-execution.js";
import type {GateDecision, ProjectExecutionKind} from "./execution-gate.js";
import {M1A_NOT_VERIFIED_LABEL, productVerificationOf, reviewAndSecurityFor} from "./outcomes.js";
import {RISK_REFUSAL, hostExecutionNotice, riskAdmitted} from "./risk-admission.js";
import {evaluateTestSurface, parseNameStatusZ, parseTestRunStreams, stripAnsi} from "./test-surface.js";
import type {NameStatusEntry, TestRunSummary} from "./test-surface.js";
import type {ReviewerTestSurface} from "./executors.js";
// //TR: REL-FX-4: sağlayıcı kota/hız sınırı sınıflandırması korumalı master sınıflandırıcıyla yapılır (kopyalanmaz); tip bildirimi olmadığı için dar yerel tiple bağlanır.
// @ts-expect-error TS7016: failure-classifier.mjs tip bildirimi yok
import {classifyFailure as classifyFailureUntyped} from "../../automation/lib/failure-classifier.mjs";
import type {ExecutorPair, MissionSpec, ProcResult, SpawnedChild} from "./executors.js";
import {DEFAULT_MAX_REPORT_BYTES, DEFAULT_MAX_TRIVY_DB_AGE_MS, DEFAULT_SECURITY_TIMEOUT_MS, buildAddedLineStream, defaultTrivyCacheDir, discoverSecurityTools, evaluateSecurityPolicy, gitRangeProblem, mergeGitleaksPasses, runGitleaks, runGitleaksAddedLines, runTrivy, toolInfo, verifyTool} from "./security-tools.js";
import type {GitleaksResult, PolicyInput, ResolvedTool, SecurityOptions, SecurityToolset} from "./security-tools.js";

export interface RunnerOptions {
  store: WorkOsStore; dataDir: string; globalStopFile: string; envPolicyFile: string; executors: ExecutorPair;
  // LANE-C: REVIEW adımının bağlı rol kimliği (tanımsız = bağlı security-reviewer varsayılanı).
  reviewerRoleId?: string;
  actor?: string; leaseTtlMs?: number; maxRemediations?: number; maxRetries?: number; maxRecoveries?: number; retryBackoffMs?: readonly number[];
  testTimeoutMs?: number; executorTimeoutMs?: number; maxStepsPerTick?: number; maxConcurrentRuns?: number; now?: () => number;
  // B3C: güvenlik araçları (tanımsız = PATH keşfi); override yalnız programatik enjeksiyondur.
  security?: SecurityOptions;
  // SBX-GATE: proje test komutları yalnız bu kapının izin verdiği doğrulanmış sandbox sağlayıcısında çalışır; tanımsız = sağlayıcı yok = VERIFY/REGRESSION NOT_EXECUTED (SANDBOX_UNAVAILABLE, M1a: run statik güvenlik + bağımsız review ile sürer).
  executionGate?: ExecutionGate;
  // PAR-03: olay döngüsü gecikmesinin (p99, ms; çözünürlük payı düşülmüş) programatik kaynağı; tanımsız = perf_hooks monitorEventLoopDelay. Yalnız test enjeksiyonudur.
  loopDelayP99Ms?: () => number;
}
export interface TickReport { skipped?: "BUSY" | "LOCKED"; recovered: string[]; claimed: string[]; cancelled: string[]; fenced: string[]; advanced: string[]; deferred: string[] }

type Outcome =
  | {kind: "DONE"; next: RunStep | "FINISHED"; data: Record<string, unknown>; patch?: RunPatch; mission?: MissionStatus; approvalReason?: string}
  | {kind: "REMEDIATE"; reason: string; data: Record<string, unknown>; findings: string[]}
  | {kind: "BLOCK"; reason: string; status?: "BLOCKED" | "FAILED" | "QUARANTINED"}
  | {kind: "RETRY"; reason: string}
  | {kind: "CANCEL"; reason: string};

const RUN_ID = /^run_[0-9a-f]{24}$/;
const SHA = /^[0-9a-f]{40}$/;
const NEXT: Record<RunStep, RunStep | "FINISHED"> = {WORKSPACE: "IMPLEMENT", IMPLEMENT: "VERIFY", VERIFY: "SECURITY", SECURITY: "REVIEW", REVIEW: "REGRESSION", REGRESSION: "REPORT", REPORT: "FINISHED"};
// Adım bittiğinde mission'ın gideceği durum (state machine allowlist'i store tarafından ayrıca uygulanır).
const MISSION_AFTER: Partial<Record<RunStep, MissionStatus>> = {IMPLEMENT: "VERIFYING", SECURITY: "REVIEWING", REVIEW: "REGRESSION", REGRESSION: "REPORTING"};
const stepStatus = (s: RunStep): RunStatus => (s === "VERIFY" || s === "SECURITY" || s === "REGRESSION" ? "VERIFYING" : "RUNNING");
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const classifyFailure = classifyFailureUntyped as (x: {status: number | null; error?: string; stdout?: string; stderr?: string; timedOut?: boolean}) => {class: string};
// REL-FX c2 (RV-RELFX-C1-004): başarısız executor çıktısının (ANSI temizlenmiş) son 8 KiB'ı satır satır incelenir. Sağlayıcı sınırı yalnız
// (a) yapılandırılmış işaret satırı `UASCO_PROVIDER_LIMIT: QUOTA_EXHAUSTED|RATE_LIMIT` veya (b) Claude CLI hata satırları (satır başında "API Error",
// "Claude AI usage limit reached", "usage limit reached", "You've hit your ... limit") üzerinde master sınıflandırıcı
// QUOTA_EXHAUSTED/RATE_LIMIT verdiğinde sayılır; keyfi stderr (ör. "TypeError: rateLimiter is not a function") sağlayıcı sınırı değildir.
// Disk dolu/kotası (ENOSPC, EDQUOT, "disk quota exceeded", "no space left on device") DISK_FULL ailesidir, asla PROVIDER_QUOTA değildir.
export type ExecutorLimit = "QUOTA_EXHAUSTED" | "RATE_LIMIT" | "DISK_FULL";
const PROVIDER_MARKER_RE = /^UASCO_PROVIDER_LIMIT[:=]\s*(QUOTA_EXHAUSTED|RATE_LIMIT)\s*$/;
const CLAUDE_CLI_ERROR_RE = /^(?:error:\s*)?(?:api error\b|claude(?: ai)? usage limit reached\b|usage limit reached\b|you(?:'|’)ve hit your (?:[\w-]+ )*limit\b|you have (?:hit|reached) your (?:[\w-]+ )*limit\b)/i;
const DISK_FULL_RE = /\b(?:ENOSPC|EDQUOT)\b|no space left on device|disk quota exceeded|not enough space on the disk/i;
export function executorLimit(exitCode: number | null, log: string): ExecutorLimit | null {
  const lines = stripAnsi(String(log ?? "").slice(-8192)).split("\n").map(l => l.trim()).filter(Boolean);
  for (const l of lines) { const m = PROVIDER_MARKER_RE.exec(l); if (m) return m[1] as ExecutorLimit; }
  const cli = lines.filter(l => CLAUDE_CLI_ERROR_RE.test(l) && !DISK_FULL_RE.test(l));
  if (cli.length) {
    const c = classifyFailure({status: exitCode ?? 1, stderr: cli.join("\n"), timedOut: false}).class;
    if (c === "QUOTA_EXHAUSTED" || c === "RATE_LIMIT") return c;
  }
  return lines.some(l => DISK_FULL_RE.test(l)) ? "DISK_FULL" : null;
}
export function providerLimit(exitCode: number | null, log: string): "QUOTA_EXHAUSTED" | "RATE_LIMIT" | null {
  const l = executorLimit(exitCode, log);
  return l === "QUOTA_EXHAUSTED" || l === "RATE_LIMIT" ? l : null;
}
const limitNote = (l: ExecutorLimit) => (l === "DISK_FULL" ? "RESOURCE_LIMIT: DISK_FULL" : `PROVIDER_LIMIT: ${l}`);
const limitBlock = (l: ExecutorLimit): Outcome => ({kind: "BLOCK", reason: l === "DISK_FULL" ? "DISK_FULL" : "PROVIDER_QUOTA"});
// //TR: Test komutu önceliği (mission komutu proje komutunu ezer) ve depo/workspace önkoşulu SAF fonksiyonlardır; runner aynı noktada aynı sırayla çağırır, readiness.ts (salt-okunur) aynı fonksiyonları içe aktarır — ikinci kural yoktur.
export const effectiveTestCommand = (m: {testCommand?: string[]} | undefined, p: {testCommand?: string[]} | undefined): string[] | undefined => m?.testCommand ?? p?.testCommand;
export type RepositoryPrecondition = {ok: true; src: string} | {ok: false; reason: string};
// PS1A-C2-F1 (derinlemesine savunma): yönetilen depo yalnız bu projenin <dataDir>/projects/<id>/repo kanonik yolundan; yönetilmeyen yol ise kanonik biçimi
// (8.3 kısa ad/junction açılmış) veri dizininin içinde/üstünde olmamalıdır (başka tenant'ın yönetilen deposu, journal). Aksi halde klonlanmaz.
export function repositoryPrecondition(project: {projectId: string; repository?: {path?: string; url?: string; managed?: boolean}}, dataDir: string): RepositoryPrecondition {
  const repo = project.repository;
  if (!repo?.path) return {ok: false, reason: repo?.url ? "REMOTE_REPO_NOT_SUPPORTED_YET" : "REPOSITORY_NOT_CONFIGURED"};
  let src: string;
  if (repo.managed === true) {
    const m = managedRepoCanonical(dataDir, project.projectId, repo.path);
    if (!m) return {ok: false, reason: "REPOSITORY_NOT_MANAGED"};
    src = m;
  } else {
    const g = pathOverlapsDataDir(repo.path, dataDir);
    if (g.forbidden) return {ok: false, reason: "REPOSITORY_PATH_FORBIDDEN"};
    src = g.canonical;
  }
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return {ok: false, reason: "REPOSITORY_PATH_NOT_FOUND"};
  return {ok: true, src};
}

export type {WorkspaceOwner} from "./writer-guard.js";

// //TR: recovered: bu lease devralma ile alındı (önceki lease'in yazarı durdurulmadan workspace'e dokunulmaz, cancel dahil); reap: durdurma sonucu (sürüşün ilk adımında bir kez hesaplanır).
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
interface OwnedRun { leaseId: string; drive: Promise<void> | null; renewedAt: number; lost: boolean; recovered: boolean; reap: {problem: string | null; note: string} | null }
const LOOP_RESOLUTION_MS = 20;
const STALL_SAMPLE_MS = 1_000;
const STALL_MEMORY_MS = 5_000;
const DRIFT_TICK_MS = 50;
// //TR: Okunamayan/yırtık sahiplik kaydı, dosya önyüklemeden bu kadar ESKİYSE "yazar yok" sayılır (süreçler yeniden başlatmadan sağ çıkmaz; saat sapması payı).
const BOOT_GRACE_MS = 2_000;

export type RepositoryHead = {ok: true; baseSha: string} | {ok: false; reason: "REPOSITORY_NOT_WORKTREE_ROOT" | "REPOSITORY_HEAD_UNRESOLVED"};
// //TR: Depo kökü ve HEAD kararı TEK saf fonksiyondur (runner WORKSPACE adımı çağırır; readiness.ts çağıracaktır: LANE-B-REQUEST, #218; sonuç çağıranın ortamına bağlı değildir). `git rev-parse` yukarı doğru keşfeder: düz bir alt dizin üst deponun HEAD'ini çözerdi. Bu yüzden: (1) süreç ortamından YALNIZ sabit bir izin listesi geçer (safeChildEnv'in alwaysAllow'u + TMPDIR; Windows'ta libuv, eksik HOMEDRIVE, HOMEPATH, LOGONSERVER, SYSTEMDRIVE, USERDOMAIN, USERNAME ve WINDIR'i ebeveynden kendisi doldurur: bunlar GIT_* ya da gizli değildir): GIT_* (GIT_DIR başka bir depoyu gösterebilir), SUDO_UID (git'in sahiplik kararını değiştirir) ve gizli değerler (API anahtarları) git'e ASLA ulaşmaz; repo-yerel config'in çalıştırabileceği bir komut sırları göremez, çağıran (runner/readiness) sonucu değiştiremez ve çok büyük ortam E2BIG üretmez; keşif GIT_CEILING_DIRECTORIES=<fiziksel üst dizin> ile yukarı çıkamaz, ancak ceiling'e GÜVENİLMEZ (':' içeren yol listeyi böler, göreli yol yok sayılır): kök kararı her kolda bağımsız kanıt ister, (2) kök: `.git` (dizin veya gitfile) src'nin kendisinde VAR ve `--show-toplevel` src'ye EŞİT; veya `--absolute-git-dir` == src/.git (core.bare/core.worktree ayarlı depolar dahil); veya çıplak depo (`--is-bare-repository` ve git dizini src'nin kendisi); karşılaştırma kanonik anahtarla (path-guard), `.git` dizininin kendisi kök değildir, (3) HEAD yalnız bir commit nesnesine çözülmelidir (`HEAD` ile `HEAD^{commit}` aynı 40-hex SHA; etiket nesnesi reddedilir). `ok:true` YALNIZ ceiling'li, GIT_*'siz sondajlardan türer; ceiling'siz sondaj yalnız iki red nedeni arasında seçer (REPOSITORY_NOT_WORKTREE_ROOT: başka bir deponun/.git'in içinde). Her sondaj `protocol.allow=never` ile çalışır (kısmi klonda eksik HEAD nesnesi için tembel fetch repo-yerel config'teki komutları çalıştırır/ağa çıkar), toplam süre sınırlıdır (varsayılan 10 sn, SIGKILL; okunamayan HEAD/config sunucuyu sonsuza dek bloke etmez) ve fonksiyon ASLA fırlatmaz (zararlı girdi = red). Nesne grafiğinin bütünlüğü doğrulanmaz: eksik tree/parent clone adımında WORKSPACE_CLONE_FAILED olur.
const GIT_PROBE_ENV = new Set(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "SYSTEMROOT", "COMSPEC", "PATHEXT", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]);
function gitProbeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {GIT_NO_LAZY_FETCH: "1"};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && !v.includes("\0") && GIT_PROBE_ENV.has(k.toUpperCase())) env[k] = v;
  return env;
}
// //TR: Karar prosedürü TEK yerde (jeneratör): her `yield` bir git probu ister ve çıktısını (başarısızsa null) geri alır. Eşzamanlı sürücü (repositoryHead: readiness.ts, Lane B) ve eşzamansız sürücü (repositoryHeadAsync: runner) aynı prosedürü, aynı `-c protocol.allow=never` önekini, aynı tavanı (GIT_CEILING_DIRECTORIES) ve aynı son tarihi uygular; test iki sürücüyü aynı depo matrisinde karşılaştırır.
interface HeadProbe { args: string[]; ceiling: boolean }
function* headDecision(root: string): Generator<HeadProbe, RepositoryHead, string | null> {
  const same = (p: string | null, to: string = root): boolean => { if (!p) return false; const a = canonicalPath(p), b = canonicalPath(to); return a.ok && b.ok && a.key === b.key; };
  const own = path.join(root, ".git");
  const isRoot = (fs.existsSync(own) && same(yield {args: ["rev-parse", "--show-toplevel"], ceiling: true})) || same(yield {args: ["rev-parse", "--absolute-git-dir"], ceiling: true}, own)
    || ((yield {args: ["rev-parse", "--is-bare-repository"], ceiling: true}) === "true" && same(yield {args: ["rev-parse", "--absolute-git-dir"], ceiling: true}));
  if (!isRoot) return {ok: false, reason: (yield {args: ["rev-parse", "--git-dir"], ceiling: false}) !== null ? "REPOSITORY_NOT_WORKTREE_ROOT" : "REPOSITORY_HEAD_UNRESOLVED"};
  const ids = ((yield {args: ["rev-parse", "HEAD", "HEAD^{commit}"], ceiling: true}) ?? "").split("\n").map(x => x.trim());
  return ids.length === 2 && SHA.test(ids[0]) && ids[0] === ids[1] ? {ok: true, baseSha: ids[0]} : {ok: false, reason: "REPOSITORY_HEAD_UNRESOLVED"};
}
const PROBE_REFUSED: RepositoryHead = {ok: false, reason: "REPOSITORY_HEAD_UNRESOLVED"};
export function repositoryHead(src: string, opts: {timeoutMs?: number} = {}): RepositoryHead {
  try {
    const c = canonicalPath(src);
    if (!c.ok) return PROBE_REFUSED;
    const root = c.path, env = gitProbeEnv();
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
    let exhausted = false;
    const run = (p: HeadProbe): string | null => {
      const left = deadline - Date.now();
      if (exhausted || left <= 0) { exhausted = true; return null; }
      try {
        const r = spawnGitSync(root, ["-c", "protocol.allow=never", ...p.args], {env: p.ceiling ? {...env, GIT_CEILING_DIRECTORIES: path.dirname(root)} : env, maxBuffer: 1024 * 1024, timeout: left, killSignal: "SIGKILL"});
        if (r.error) { exhausted = true; return null; }
        return r.status === 0 ? String(r.stdout ?? "").replace(/\n$/, "") : null;
      } catch { return null; }
    };
    const g = headDecision(root);
    let step = g.next();
    while (!step.done) step = g.next(run(step.value));
    return step.value;
  } catch { return PROBE_REFUSED; }
}
// //TR: Eşzamansız sürücü (runner WORKSPACE adımı): aynı karar, olay döngüsünü bloklamadan. runGitAsync spawnGitSync ile aynı yalıtımı (isolatedGitArgs/isolatedGitEnv) uygular; geçirilen ortam gitProbeEnv'dir (process.env değil, runner'ın safeChildEnv'i de değil), yani sonuç iki sürücüde ve her çağıranda aynıdır. Zaman aşımı ve spawn hatası = status null = süre tükendi (eşzamanlı sürücüdeki r.error ile aynı).
export async function repositoryHeadAsync(src: string, opts: {timeoutMs?: number} = {}): Promise<RepositoryHead> {
  try {
    const c = canonicalPath(src);
    if (!c.ok) return PROBE_REFUSED;
    const root = c.path, env = gitProbeEnv();
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
    let exhausted = false;
    const run = async (p: HeadProbe): Promise<string | null> => {
      const left = deadline - Date.now();
      if (exhausted || left <= 0) { exhausted = true; return null; }
      try {
        const r = await runGitAsync(root, ["-c", "protocol.allow=never", ...p.args], p.ceiling ? {...env, GIT_CEILING_DIRECTORIES: path.dirname(root)} : env, undefined, {timeoutMs: left});
        if (r.status === null) { exhausted = true; return null; }
        return r.status === 0 ? r.stdout.replace(/\n$/, "") : null;
      } catch { return null; }
    };
    const g = headDecision(root);
    let step = g.next();
    while (!step.done) step = g.next(await run(step.value));
    return step.value;
  } catch { return PROBE_REFUSED; }
}

export class MissionRunner {
  readonly engineId = `engine_${crypto.randomBytes(6).toString("hex")}`;
  private readonly o: Required<Omit<RunnerOptions, "now">> & {now: () => number};
  private readonly owned = new Map<string, OwnedRun>();
  readonly securityTools: SecurityToolset;
  private readonly securityOpts: SecurityOptions;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  // //TR: Süreç kilidi engine'in sahip olduğu run'ların sürüşü boyunca tutulur (sürüş tick'ten ayrıldığı için tick sonunda bırakılamaz); son sürüş bitince bırakılır.
  private lockRelease: (() => void) | null = null;
  private loopHist: IntervalHistogram | null = null;
  private stallSampler: NodeJS.Timeout | null = null;
  private driftSampler: NodeJS.Timeout | null = null;
  private stallAt = 0;
  // //TR: stop() sonrası sürüşler yeni ücretli adım başlatmaz ve çalışan çocukları durdurur; run terminal İPTAL edilmez (sonraki engine devralır).
  private stopping = false;
  private stopEpoch = 0; // //TR: R2: her stop() bir tur sayar; stop()->start() sırasında bitmemiş bir sürüş hâlâ "durduruldu" sayılır (stopping bayrağı start() ile sıfırlanır, tur sayısı sıfırlanmaz)
  private forwardOff: (() => void) | null = null;
  private readonly boot = bootId();
  private readonly loopDelay: (() => number) | undefined;

  constructor(opts: RunnerOptions) {
    assertIndependentExecutors(opts.executors);
    this.o = {
      actor: "WORKOS_RUNNER", leaseTtlMs: 120_000, maxRemediations: 2, maxRetries: 2, maxRecoveries: 2, retryBackoffMs: [2_000, 8_000], testTimeoutMs: 10 * 60_000,
      executorTimeoutMs: 60 * 60_000, maxStepsPerTick: Number.POSITIVE_INFINITY, maxConcurrentRuns: 1, now: Date.now,
      ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined))
    } as unknown as Required<Omit<RunnerOptions, "now">> & {now: () => number};
    // //TR: Eş zamanlı sahiplik sınırı yalnız 1..16 tam sayı olabilir (geçersiz değer sessizce 1'e düşmez: kurulum hatası).
    if (!Number.isInteger(this.o.maxConcurrentRuns) || this.o.maxConcurrentRuns < 1 || this.o.maxConcurrentRuns > 16) throw new Error("RUNNER_MAX_CONCURRENT_RUNS_INVALID");
    // SBX-GATE: yalnız gerçek bir ExecutionGate örneği kabul edilir; başka her değer (eksik, düz nesne) sağlayıcısız kapıdır (fail-closed).
    if (!(this.o.executionGate instanceof ExecutionGate)) this.o.executionGate = new ExecutionGate(null);
    // Araçlar motor başlangıcında bir kez çözülür (PATH -> mutlak yol, sürüm, sha256); her çalıştırmadan önce ikili dosya yeniden doğrulanır.
    this.loopDelay = opts.loopDelayP99Ms;
    this.securityOpts = opts.security ?? {};
    this.securityTools = discoverSecurityTools(this.securityOpts, safeChildEnv(opts.envPolicyFile, {provider: "DETERMINISTIC"}));
  }

  // In-process zamanlayıcı (control API): talep bölümü tek uçuşludur ve sürüşleri BEKLEMEZ (PAR-05); süreç kilidi ikinci bir süreç/engine'i dışarıda tutar.
  start(intervalMs = 2_000): void {
    if (this.timer) return;
    this.stopping = false;
    this.forwardOff ??= installTerminationForwarding(); // TK-5: engine sonlanırken kayıtlı yazar grupları da öldürülür (çocuk kendi oturumundadır; terminalin Ctrl+C'si ona ulaşmaz)
    this.timer = setInterval(() => this.pump(false), Math.max(250, intervalMs));
    this.timer.unref?.();
  }
  // //TR: stop() sürüşleri DURDURUR ve bekletir: yeni adım başlamaz, çalışan çocuk grupları öldürülür (shouldAbort), dönen söz tüm sürüşler bitince çözülür (onClose beklenebilir). Eski çağıranlar dönüş değerini yok sayabilir.
  stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // //TR: R2: sonlanma kancaları (exit/SIGINT/SIGTERM/SIGHUP) sürüşler bitene kadar TAKILI kalır: çağıran dönen sözü beklemeyip hemen process.exit yaparsa (server.ts onClose) yazar grupları exit kancasıyla öldürülür.
    const off = this.forwardOff; this.forwardOff = null;
    const epoch = ++this.stopEpoch;
    this.stopping = true;
    const drives = [...this.owned.values()].map(o => o.drive).filter((d): d is Promise<void> => d !== null);
    return Promise.allSettled(drives).then(() => { off?.(); if (this.timer === null && this.stopEpoch === epoch) this.stopping = false; });
  }
  // //TR: R2: motor durduruldu mu (stop() çağrıldı, süreç sonlanıyor ya da bu adım/sürüş başladığından beri bir stop() geçti)? start() stopping'i sıfırlasa bile tur sayısı farklıysa o sürüş durdurulmuş sayılır.
  private halted(epoch: number): boolean { return this.stopping || isTerminating() || this.stopEpoch !== epoch; }
  // //TR: İptal nedeni: GLOBAL_STOP, motor kapanışı (run iptal EDİLMEZ) ya da lease kaybı.
  private cancelReason(): string { return this.stopActive() ?? (this.stopping ? "ENGINE_STOPPING" : "LEASE_LOST"); }

  private stopActive(): string | null {
    try { const s = globalStopState(this.o.globalStopFile); return s ? String(s.reason ?? "GLOBAL_STOP_ACTIVE") : null; } catch { return "GLOBAL_STOP_STATE_UNSAFE"; }
  }
  private runDir(runId: string): string {
    if (!RUN_ID.test(runId)) throw new WorkOsError("WORKOS_INVALID_INPUT", "runId");
    const root = path.resolve(this.o.dataDir, "runs"), dir = path.resolve(root, runId), rel = path.relative(root, dir);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new WorkOsError("WORKOS_INVALID_INPUT", "runId");
    return dir;
  }
  // //TR: HB-2: büyük klon dizinlerinin silinmesi olay döngüsünü bloklamaz (eşzamansız rm); Windows'ta antivirüs/dizin kilidi altında dakikalar sürebilir.
  private async rmUnderRun(runId: string, target: string): Promise<void> {
    const rel = path.relative(this.runDir(runId), target);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("RUN_PATH_ESCAPE");
    await fs.promises.rm(target, {recursive: true, force: true});
  }
  private gitEnv() { return safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}); }
  // //TR: PAR-03: workspace/klon/diff git işleri EŞZAMANSIZdır (olay döngüsü akar); gitSync yalnız eşzamanlı geri çağrı gerektiren küçük okumalarda (test yüzeyi dosya içeriği, aralık denetimi) ve span() içinde kullanılır.
  private git(cwd: string, args: string[], onSpawn?: (c: SpawnedChild) => void, extraEnv?: Record<string, string>): Promise<GitRun> { return runGitAsync(cwd, args, extraEnv ? {...this.gitEnv(), ...extraEnv} : this.gitEnv(), onSpawn); }
  // Workspace/klon DEĞİŞTİREN git (clone/checkout/reset/clean): çocuk sahiplik kaydına yazılır, devirde implementer gibi durdurulur; kayıt yazılamazsa çocuk öldürülür (status null).
  // //TR: Git çocuğuna lease işareti verilir (TK-1) ve Windows'ta PowerShell kimlik çağrısı yapılmaz (identify=false; TK-8): kısa ömürlüdür, devirde hâlâ canlıysa fail-closed.
  private async gitW(run: WorkRun, leaseId: string, cwd: string, args: string[]): Promise<GitRun> { return this.withChild(run, leaseId, onSpawn => this.git(cwd, args, onSpawn, writerEnvFor(run.runId, leaseId)), false); }
  private async gitWOk(run: WorkRun, leaseId: string, cwd: string, args: string[]): Promise<string | null> { const r = await this.gitW(run, leaseId, cwd, args); return r.status === 0 ? r.stdout.trim() : null; }
  private async gitOk(cwd: string, args: string[]): Promise<string | null> { const r = await this.git(cwd, args); return r.status === 0 ? r.stdout.trim() : null; }
  private gitSync(cwd: string, args: string[]) { return spawnGitSync(cwd, args, {env: this.gitEnv(), maxBuffer: 64 * 1024 * 1024}); }
  // Heartbeat setInterval'i senkron iş sırasında çalışamaz: uzun senkron işlerden sonra lease açıkça yenilenir. Süresi dolmuşsa WORKOS_LEASE_FENCED fırlar ve adım yan etkili/ücretli işe geçmeden durur.
  private renew(runId: string, leaseId: string): void {
    this.o.store.renewRunLease(runId, leaseId, this.o.leaseTtlMs, this.o.actor);
    const o = this.owned.get(runId);
    if (o && o.leaseId === leaseId) o.renewedAt = this.o.now();
  }
  // //TR: PAR-03: olay döngüsünü bloklayan her senkron aralıktan (dizin silme, büyük diff taraması, küçük senkron git) ÖNCE ve SONRA sahip olunan BÜTÜN lease'ler yenilenir (bir run'ın senkron işi diğerinin heartbeat'ini aç bırakamaz). Yakın zamanda yenilenmiş lease atlanır (journal şişmez); fence edilen run işaretlenir ve adımı kısa sürede durur.
  private renewAllOwned(): void {
    const t = this.o.now(), min = this.o.leaseTtlMs / 10;
    for (const [runId, o] of this.owned) {
      if (o.lost || t - o.renewedAt < min) continue;
      try { this.renew(runId, o.leaseId); } catch (e) { if (e instanceof WorkOsError && e.code === "WORKOS_LEASE_FENCED") o.lost = true; }
    }
  }
  private span<T>(fn: () => T): T {
    this.renewAllOwned();
    try { return fn(); } finally { this.renewAllOwned(); }
  }
  private own(runId: string, leaseId: string, recovered = false): void { this.owned.set(runId, {leaseId, drive: null, renewedAt: this.o.now(), lost: false, recovered, reap: null}); }

  // //TR: PAR-03: olay döngüsü gecikmesi (p99) lease TTL/6'yı aşıyorsa İKİNCİ (ve sonraki) run için lease alınmaz; zaten stall olan döngüde yeni lease'in heartbeat'i aç kalır. Pencere her okumada sıfırlanır; tick() adımlama kipinde (kilit tick başına alınır) pencere boştur.
  private startLoopMonitor(): void {
    if (this.loopDelay) return;
    this.loopHist ??= monitorEventLoopDelay({resolution: LOOP_RESOLUTION_MS});
    this.loopHist.reset(); this.loopHist.enable();
    this.stallAt = 0;
    this.stallSampler = setInterval(() => this.sampleLoop(), STALL_SAMPLE_MS);
    this.stallSampler.unref?.();
    // //TR: HB-3: perf_hooks histogramı reset() sonrası ilk örneği atar; bir JS zamanlayıcısı stall'dan sonra ELD zamanlayıcısından ÖNCE çalışırsa (ve sampleLoop reset ederse) stall hiç kaydedilmezdi. Sürüklenme nöbetçisi her stall'dan sonra, zamanlayıcı sırası ne olursa olsun çalışır ve beklenen 50 ms'yi aşan gecikmeyi doğrudan ölçer.
    let last = performance.now();
    this.driftSampler = setInterval(() => { const n = performance.now(), drift = n - last - DRIFT_TICK_MS; last = n; if (drift > this.o.leaseTtlMs / 6) this.stallAt = Date.now(); }, DRIFT_TICK_MS);
    this.driftSampler.unref?.();
  }
  private stopLoopMonitor(): void {
    this.loopHist?.disable();
    if (this.stallSampler) clearInterval(this.stallSampler);
    if (this.driftSampler) clearInterval(this.driftSampler);
    this.stallSampler = null; this.driftSampler = null;
  }
  // //TR: Pencere KISADIR (1 sn): uzun ömürlü tek bir histogramda tek bir stall p99'a gömülürdü. perf_hooks reset() sonrası ilk örneği atar (pencere başındaki ~20 ms'lik stall kaçabilir; bu kapı derinlemesine savunmadır, asıl koruma async git + renewAllOwned). Her pencerenin p99'u (çözünürlük payı düşülmüş) TTL/6'yı aşarsa son stall zamanı kaydedilir ve STALL_MEMORY_MS boyunca yeni lease verilmez.
  private sampleLoop(): void {
    const h = this.loopHist;
    if (!h || h.count === 0) return;
    const ms = Math.max(0, h.percentile(99) / 1e6 - LOOP_RESOLUTION_MS);
    h.reset();
    if (ms > this.o.leaseTtlMs / 6) this.stallAt = Date.now();
  }
  private loopStalled(): boolean {
    if (this.loopDelay) return this.loopDelay() > this.o.leaseTtlMs / 6;
    this.sampleLoop();
    return this.stallAt > 0 && Date.now() - this.stallAt < STALL_MEMORY_MS;
  }
  private releaseLockIfIdle(): void {
    if (!this.lockRelease) return;
    for (const o of this.owned.values()) if (o.drive) return;
    const release = this.lockRelease;
    this.lockRelease = null; this.stopLoopMonitor();
    try { release(); } catch { /* kilit sahipliği değiştiyse yazılar zaten fence edilir */ }
  }

  // ---- PAR-04: workspace sahiplik kaydı (mekanizma: writer-guard.ts) ----
  private ownerPath(runId: string): string { return path.join(this.runDir(runId), OWNER_FILE); }
  private ownerOf(runId: string): WorkspaceOwner | null {
    const r = readOwner(this.ownerPath(runId));
    return r.kind === "OK" ? r.rec : null;
  }
  // Atomik + dayanıklı: fsync'li geçici dosya, .prev kopyası, rename (başarısızsa kopya), dizin fsync (TK-4).
  private writeOwner(runId: string, rec: WorkspaceOwner): void { writeOwner(this.ownerPath(runId), rec); }
  private ownerRecord(run: WorkRun, leaseId: string, extra: Partial<WorkspaceOwner> = {}): WorkspaceOwner {
    return {leaseId, engineId: this.engineId, hostname: os.hostname(), pid: process.pid, childPgid: null, childStart: null, step: run.step, at: new Date(this.o.now()).toISOString(), bootId: this.boot, ...extra};
  }
  // Workspace'i DEĞİŞTİREN her git işleminden önce kayıt bu lease'e ait olmalı; değilse başka bir engine devralmıştır: hiçbir şey yazılmaz (WORKOS_LEASE_FENCED).
  private guardWorkspace(run: WorkRun, leaseId: string): void {
    const o = this.ownerOf(run.runId);
    if (!o || o.leaseId !== leaseId) throw new WorkOsError("WORKOS_LEASE_FENCED", run.runId);
  }
  // Çocuk doğar doğmaz (eşzamanlı) süreç grubu kayda yazılır; yazılamazsa executors.ts çocuğu öldürür: kayıtsız yazar bırakılmaz. identify=false: kısa ömürlü git çocukları için Windows'ta PowerShell kimlik çağrısı YAPILMAZ (childStart null kalır; devirde hâlâ canlıysa kimlik kanıtlanamadığından fail-closed).
  private recordChild(run: WorkRun, leaseId: string, c: SpawnedChild, identify = true): void {
    const o = this.ownerOf(run.runId);
    if (!o || o.leaseId !== leaseId) throw new WorkOsError("WORKOS_LEASE_FENCED", run.runId);
    const pgid = c.pgid ?? c.pid;
    if (o.childPgid !== null && o.childPgid !== pgid) untrackWriterGroup(o.childPgid); // aynı adımda art arda doğan çocuklar (implementer, sonra engine commit'inin git çocukları): önceki grup artık kayıtlı değil
    this.writeOwner(run.runId, {...o, childPgid: pgid, childStart: process.platform === "linux" ? startTokenLinux(c.pid) : null, at: new Date(this.o.now()).toISOString()});
    trackWriterGroup(pgid);
    if (process.platform !== "linux" && identify && c.short !== true) void startToken(c.pid).then(t => { const cur = this.ownerOf(run.runId); if (t && cur && cur.leaseId === leaseId && cur.childPgid === pgid) this.writeOwner(run.runId, {...cur, childStart: t}); }).catch(() => undefined); // yazılamazsa kimlik belirteci eksik kalır: devirde fail-closed
  }
  private clearChild(run: WorkRun, leaseId: string): void {
    const o = this.ownerOf(run.runId);
    if (o && o.leaseId === leaseId && o.childPgid !== null) this.writeOwner(run.runId, {...o, childPgid: null, childStart: null});
  }
  // Çocuk bitince grup kaydı temizlenir; adapter fırlatsa bile.
  private async withChild<T>(run: WorkRun, leaseId: string, call: (onSpawn: (c: SpawnedChild) => void) => Promise<T>, identify = true): Promise<T> {
    let pgid: number | null = null;
    try { return await call(c => { this.recordChild(run, leaseId, c, identify); pgid = c.pgid ?? c.pid; }); } finally {
      if (pgid !== null) untrackWriterGroup(pgid);
      try { this.clearChild(run, leaseId); } catch { /* sonraki devir kaydı okur */ }
    }
  }
  // Kaydedilmiş yazar grubunu durdurur (kimliği kanıtlanırsa): ölü -> sorun yok; kimlik belirteci farklı -> pid yeniden kullanılmış, öldürülecek yazar yok; kanıtlanamıyorsa fail-closed.
  private async stopRecordedGroup(prev: WorkspaceOwner, pgid: number): Promise<{problem: string | null; note: string}> {
    const alive = (note: string) => ({problem: "WORKSPACE_WRITER_ALIVE", note});
    if (prev.hostname !== os.hostname()) return alive(`writer group ${pgid} belongs to host ${prev.hostname.slice(0, 64)} and cannot be checked`);
    const st = writerState(pgid);
    if (st === "GONE") return {problem: null, note: `writer group ${pgid} was already gone`}; // //TR: kanıt notu "durdurulacak yazar yoktu" der: yazarın devirden ÖNCE öldüğü (ya da hiç yaşamadığı) not'tan okunur
    if (st === "UNKNOWN") return alive(`writer group ${pgid} state unknown`);
    const now = await startToken(pgid);
    // //TR: TK-3: kimlik belirteci EPERM'den ÖNCE karşılaştırılır. Kayıtlı pid başka bir kullanıcının sürecine geçtiyse (kill -> EPERM) belirteç farklıdır: bizim yazarımız yoktur, devir fail-closed OLMAZ. Linux /proc/<pid>/stat dünya okunurdur.
    if (prev.childStart !== null && now !== null && now !== prev.childStart) return {problem: null, note: `pid ${pgid} was reused by another process; no writer to stop`};
    // //TR: Erişim reddi: karar accessDeniedVerdict'te (belirteç okunabilir ve yukarıda kayıtla eşit bulunduysa fail-closed; yalnız Windows'ta belirteç de okunamıyorsa yazar yok).
    if (st === "OTHER_USER") return accessDeniedVerdict(process.platform, now) === "NOT_OUR_WRITER" ? {problem: null, note: `pid ${pgid} is not accessible to this user and its start time is unreadable; it cannot be the recorded writer`} : alive(`writer group ${pgid} state unknown`);
    if (prev.childStart === null || (now === null && process.platform !== "linux")) return alive(`writer group ${pgid} is alive but its identity cannot be proven`);
    // Lider yok ama grup canlı (Linux): TK-7: aynı önyükleme + her üye lider kaydından sonra başlamış olmalı.
    if (now === null) { const proof = leaderlessGroupProof(pgid, prev); if (!proof.ok) return alive(proof.why); }
    await killWriterGroup(pgid, prev.childStart);
    for (const until = Date.now() + WRITER_KILL_WAIT_MS; writerState(pgid) !== "GONE" && Date.now() < until;) await sleep(50);
    if (writerState(pgid) !== "GONE") return alive(`writer group ${pgid} survived the kill`);
    return {problem: null, note: `stopped writer group ${pgid} of engine ${prev.engineId}${process.platform === "linux" ? "" : "; descendants that left the process group are not swept on this platform"}`};
  }
  // Devir: önceki lease'in yazarı (varsa) ölmeden workspace'e dokunulmaz. (1) Kayıt: yırtık/okunamayan kayıt önyüklemeden ESKİYSE yazar yok (TK-4), değilse fail-closed; farklı önyükleme = yazar yok. (2) Kayıtlı grup: aynı makinede canlıysa ve kimliği kanıtlanırsa öldürülür ve ölmesi beklenir (TK-3/7). (3) TK-1: grubu terk eden (setsid) torunlar lease işaretiyle/çalışma dizinine göre taranır ve öldürülür; biri bile ölmezse fail-closed. Not yazılır: yalnız tarama temizse "stopped".
  private async reapPriorWriter(run: WorkRun, leaseId: string): Promise<{problem: string | null; note: string}> {
    const alive = (note: string) => ({problem: "WORKSPACE_WRITER_ALIVE", note});
    const rec = readOwner(this.ownerPath(run.runId));
    let note = "", previousBoot = false;
    if (rec.kind === "INVALID") {
      if (rec.mtimeMs !== null && rec.mtimeMs + BOOT_GRACE_MS < bootTimeMs()) { note = "owner record from before the current boot ignored"; previousBoot = true; }
      else return alive(rec.why);
    } else if (rec.kind === "OK") {
      const prev = rec.rec;
      if (prev.bootId !== null && this.boot !== null && !sameBoot(prev.bootId, this.boot)) { note = "previous boot: no earlier writer can be alive"; previousBoot = true; }
      else if (prev.childPgid !== null) {
        const g = await this.stopRecordedGroup(prev, prev.childPgid);
        if (g.problem) return g;
        note = g.note;
      }
    }
    if (!previousBoot && process.platform === "linux") {
      const sw = await sweepWriters({runDir: this.runDir(run.runId), runId: run.runId, currentLeaseId: leaseId});
      if (sw.survivors.length) return alive(`${sw.survivors.length} detached writer process(es) of an earlier lease survived the sweep`);
      if (sw.killed.length) note = `${note ? `${note}; ` : ""}swept ${sw.killed.length} detached writer process(es)`;
    }
    this.renew(run.runId, leaseId);
    // //TR: R2: kayıt yenilenemezse (geçici disk/rename hatası) devir bundan ETKİLENMEZ: iptal ve bütçe-tükendi kararları bu yazıya bağlı olmamalı; sonraki adımın başındaki yazı (hatası RETRY) kaydı yeniler.
    try { this.writeOwner(run.runId, this.ownerRecord(run, leaseId)); } catch { note = `${note ? `${note}; ` : ""}owner record not refreshed`; }
    return {problem: null, note};
  }
  // //TR: R2: implementer çocuğu bittiğinde (başarı, hata, abort, zaman aşımı fark etmez) bu lease'in işaretini taşıyan ya da run dizininde çalışan artıklar (setsid ile gruptan kaçan torunlar) öldürülür: yoksa sonraki deneme/adım onlar yazarken başlar ve engine commit'i onların dosyasını da alırdı. Yalnız Linux (diğerlerinde eşdeğeri yoktur: bilinen kalıntı).
  private async sweepOwnWriters(run: WorkRun, leaseId: string): Promise<boolean> {
    if (process.platform !== "linux") return true;
    const sw = await sweepWriters({runDir: this.runDir(run.runId), runId: run.runId, currentLeaseId: leaseId, includeCurrent: true}, 2_000);
    return sw.survivors.length === 0;
  }

  // //TR: tick() deterministik adımlama sözleşmesidir (testler/araçlar): talep + sahip olunan run'ları sür + BU çağrının başlattığı sürüşlerin bitmesini bekle; tick içinde yeniden doldurma yoktur. Servis kipi (start) beklemez: pump().
  async tick(): Promise<TickReport> {
    const rep: TickReport = {recovered: [], claimed: [], cancelled: [], fenced: [], advanced: [], deferred: []};
    if (this.busy) return {...rep, skipped: "BUSY"};
    this.busy = true;
    try {
      const drives = this.claimAndDrive(rep, false);
      if (drives === "LOCKED") return {...rep, skipped: "LOCKED"};
      await Promise.all(drives);
      return rep;
    } finally { this.busy = false; }
  }
  // PAR-05: servis kipi geçişi; sürüşleri beklemez. freshOnly=true: bir sürüş bitince boşalan yuvayı hemen doldurur (yalnız yeni talep edilen run'ları sürer; bekleyen sahip olunanlar zamanlayıcıyla yeniden sürülür).
  private pump(freshOnly: boolean): void {
    try { this.claimAndDrive({recovered: [], claimed: [], cancelled: [], fenced: [], advanced: [], deferred: []}, freshOnly); } catch { /* sonraki geçiş yeniden dener */ }
  }
  // Talep bölümü SENKRONDUR (await yok): tek uçuşludur; sürüşler sahip olunan kaydında (owned) tutulur ve beklenmez.
  private claimAndDrive(rep: TickReport, freshOnly: boolean): Promise<void>[] | "LOCKED" {
    if (!this.lockRelease) {
      try { this.lockRelease = acquireProcessLock(path.join(this.o.dataDir, "runner.lock"), this.engineId); } catch { return "LOCKED"; }
      this.startLoopMonitor();
    }
    const drives: Promise<void>[] = [], fresh = new Set<string>();
    try {
      const store = this.o.store, stop = this.stopActive();
      let stalled: boolean | null = null;
      const full = () => this.owned.size >= this.o.maxConcurrentRuns || (this.owned.size >= 1 && (stalled ??= this.loopStalled()));
      for (const run of store.engineListRuns()) {
        if (this.owned.get(run.runId)?.drive) continue; // sürüşü süren run'a dokunulmaz: kendi heartbeat'i yönetir, kendi kendini devralma yok
        try {
          if (run.status === "CREATED" || run.status === "QUEUED") {
            if (stop) { this.cancelUnleased(run, stop); rep.cancelled.push(run.runId); continue; }
            // //TR: Sahiplik sınırı: sınır doluysa run'a lease ALINMAZ (sırasını beklerken lease'i yenilenmeden dolup sahte fence/recovery yaşamasın); QUEUED kalır, sonraki geçiş alır.
            if (full()) { rep.deferred.push(run.runId); continue; }
            const queued = run.status === "CREATED" ? store.transitionRun(run.runId, null, "QUEUED", "queued for runner", this.o.actor) : run;
            const leased = store.acquireRunLease(queued.runId, this.o.leaseTtlMs, this.o.actor);
            this.own(run.runId, leased.leaseId!); rep.claimed.push(run.runId); fresh.add(run.runId);
          } else if (LEASED_RUN_STATUSES.includes(run.status) && run.leaseId && Date.parse(run.leaseExpiresAt ?? "") <= this.o.now()) {
            if (full()) { rep.deferred.push(run.runId); continue; }
            // Süresi dolmuş lease: crash/askıda kalma -> devral, RECOVERING (yeni leaseId eski sahibi fence eder).
            const taken = store.takeoverRunLease(run.runId, this.o.leaseTtlMs, this.o.actor);
            this.own(run.runId, taken.leaseId!, true); rep.recovered.push(run.runId); fresh.add(run.runId);
          }
        } catch (e) { if (e instanceof WorkOsError && e.code === "WORKOS_LEASE_FENCED") { rep.fenced.push(run.runId); continue; } throw e; }
      }
      // //TR: Sahip olunan run'lar (en çok maxConcurrentRuns) birlikte sürülür; sınır 1 iken davranış eski sıralı akışla aynıdır.
      for (const [runId, o] of this.owned) if (o.drive === null && (!freshOnly || fresh.has(runId))) { o.drive = this.runDrive(runId, o.leaseId, rep); drives.push(o.drive); }
      return drives;
    } finally { this.releaseLockIfIdle(); }
  }
  private runDrive(runId: string, leaseId: string, rep: TickReport): Promise<void> {
    return (async () => {
      try {
        const r = await this.drive(runId, leaseId);
        if (r === "CANCELLED") rep.cancelled.push(runId); else if (r) rep.advanced.push(runId);
      } catch (e) {
        this.owned.delete(runId);
        if (e instanceof WorkOsError && e.code === "WORKOS_LEASE_FENCED") rep.fenced.push(runId); else this.failClosed(runId, leaseId, e);
      } finally {
        // yuva serbest: run hâlâ bizdeyse (retry bekleme/adım sınırı) sonraki geçiş yeniden sürer; değilse owned'dan zaten düşmüştür
        const o = this.owned.get(runId);
        if (o && o.leaseId === leaseId) o.drive = null;
        this.releaseLockIfIdle();
        if (this.timer && this.owned.size < this.o.maxConcurrentRuns) setImmediate(() => { if (this.timer) this.pump(true); }); // stop() sonrası yeniden doldurma yok
      }
    })();
  }

  // Beklenmeyen engine hatası: run FAILED, mission BLOCKED (sessiz devam yok). Fence edilmişse hiçbir şey yazılmaz.
  private failClosed(runId: string, leaseId: string, e: unknown): void {
    try {
      const run = this.o.store.engineGetRun(runId);
      if (!run || run.leaseId !== leaseId || !LEASED_RUN_STATUSES.includes(run.status) || run.status === "CANCELLING") return;
      const reason = `ENGINE_ERROR: ${e instanceof WorkOsError ? e.code : "UNEXPECTED"}`;
      this.o.store.transitionRun(runId, leaseId, "FAILED", reason, this.o.actor, {mission: {to: "BLOCKED", reason}});
    } catch { /* yazılamıyorsa lease dolunca recovery devralır */ }
  }

  private cancelUnleased(run: WorkRun, reason: string): void {
    const s = this.o.store;
    s.transitionRun(run.runId, null, "CANCELLING", `GLOBAL_STOP_ACTIVE: ${reason}`, this.o.actor);
    s.transitionRun(run.runId, null, "CANCELLED", `GLOBAL_STOP_ACTIVE: ${reason}`, this.o.actor, {mission: {to: "BLOCKED", reason: `GLOBAL_STOP_ACTIVE: ${reason}`}});
  }
  private cancelLeased(run: WorkRun, leaseId: string, reason: string, writerNote = ""): void {
    const s = this.o.store, at = new Date(this.o.now()).toISOString(), why = `GLOBAL_STOP_ACTIVE: ${reason}`;
    if (run.status !== "CANCELLING") s.transitionRun(run.runId, leaseId, "CANCELLING", why, this.o.actor);
    s.addRunEvidence(run.runId, leaseId, {step: "CANCEL", cycle: run.remediationCycle, kind: "CANCEL", argv: [], startedAt: at, endedAt: at, exitCode: null, logPath: null, logSha256: null, note: `${why}${writerNote ? `; writer ${writerNote}` : ""}`.slice(0, 500)}, this.o.actor);
    s.transitionRun(run.runId, leaseId, "CANCELLED", why, this.o.actor, {mission: {to: "BLOCKED", reason: why}});
    this.owned.delete(run.runId);
  }

  private async drive(runId: string, leaseId: string): Promise<"CANCELLED" | boolean> {
    const s = this.o.store, epoch = this.stopEpoch;
    let steps = 0;
    for (;;) {
      const run = s.engineGetRun(runId);
      if (!run || run.leaseId !== leaseId || !LEASED_RUN_STATUSES.includes(run.status)) { this.owned.delete(runId); return steps > 0; }
      // //TR: PAR04-GSTOP-NO-REAP / TK-2: devralınan run'ın önceki yazarı HER yolda (iptal, GLOBAL_STOP, bütçe tükenmesi, normal devam) workspace'e dokunulmadan ve run terminal olmadan ÖNCE durdurulur; sonuç sürüşün ilk iterasyonunda bir kez hesaplanır. Yazar ölmese bile iptal yine yapılır (not'a yazılır).
      const own = this.owned.get(runId);
      if (own && own.recovered && own.reap === null) own.reap = await this.reapPriorWriter(run, leaseId);
      if (this.halted(epoch)) { this.owned.delete(runId); return steps > 0; } // motor kapanıyor: yeni adım yok, run bırakılır (lease dolunca sonraki engine devralır)
      const stop = this.stopActive();
      if (stop || run.status === "CANCELLING") { const w = own?.reap; this.cancelLeased(run, leaseId, stop ?? run.reason ?? "CANCEL_REQUESTED", w ? `${w.problem ? `${w.problem}: ` : ""}${w.note}`.replace(/: $/, "") : ""); return "CANCELLED"; }
      if (run.status === "RETRY_SCHEDULED" && Date.parse(run.retryAt ?? "") > this.o.now()) { this.renew(runId, leaseId); return steps > 0; }
      if (steps >= this.o.maxStepsPerTick) { this.renew(runId, leaseId); return steps > 0; }
      if (run.status === "RECOVERING" && !(await this.recoverCheck(run, leaseId, own?.reap ?? null))) { this.owned.delete(runId); return true; }
      this.renew(runId, leaseId); // her adımın başında (yani adımlar arasında da) lease yenilenir
      await this.executeStep(run, leaseId);
      steps += 1;
    }
  }

  // Crash-resume: son tamamlanmış checkpoint'ten devam; workspace/commit tutarsızsa RECOVERY_FAILED + kanıt (tahmin yok).
  // Recovery bütçesi: son checkpoint'ten beri yapılan devralma sayısı = attempt - son checkpoint'teki attempt (checkpoint yoksa ilk lease = 1). Her TAKEOVER attempt'i journal'da artırır,
  // bu yüzden recovery kanıtı yazılamasa bile sayım ilerler. maxRecoveries aşılırsa adım tekrar edilmez: RECOVERY_FAILED + mission BLOCKED (RECOVERY_BUDGET_EXHAUSTED).
  private async recoverCheck(run: WorkRun, leaseId: string, reap: {problem: string | null; note: string} | null): Promise<boolean> {
    const at = new Date(this.o.now()).toISOString();
    const work = path.join(this.runDir(run.runId), "work");
    const problems: string[] = [];
    const last = run.checkpoints[run.checkpoints.length - 1];
    const baseline = last && typeof last.data.attempt === "number" && Number.isSafeInteger(last.data.attempt) ? last.data.attempt : 1;
    const recoveries = run.attempt - baseline;
    const exhausted = recoveries > this.o.maxRecoveries;
    // //TR: PAR-04: önceki lease'in yazar çocuğu ölmeden (veya durumu bilinmeden) workspace'e bakılmaz/dokunulmaz. Durdurma drive()'ın başında YAPILMIŞTIR (bütçe tükenmiş devirde de: TK-2); burada yalnız sonucu okunur.
    const w = reap ?? {problem: null, note: ""};
    const writer = w.problem ? `${w.problem}: ${w.note}` : w.note;
    if (exhausted) problems.push("RECOVERY_BUDGET_EXHAUSTED");
    else {
      if (w.problem) problems.push(w.problem);
      else if (run.step !== "WORKSPACE") {
        if (!run.baseSha || !SHA.test(run.baseSha) || !fs.existsSync(path.join(work, ".git"))) problems.push("WORKSPACE_MISSING");
        else {
          if ((await this.gitOk(work, ["cat-file", "-e", `${run.baseSha}^{commit}`])) === null) problems.push("BASE_COMMIT_MISSING");
          const needsHead = run.step !== "IMPLEMENT";
          if (needsHead && (!run.headSha || (await this.gitOk(work, ["cat-file", "-e", `${run.headSha}^{commit}`])) === null)) problems.push("HEAD_COMMIT_MISSING");
        }
      }
    }
    const note = `takeover attempt ${run.attempt}; resume step ${run.step} cycle ${run.remediationCycle}; completed checkpoints ${run.checkpoints.length}; recovery ${recoveries} of budget ${this.o.maxRecoveries}${writer ? `; writer ${writer}` : ""}${problems.length ? `; problems ${problems.join(",")}` : ""}`;
    this.o.store.addRunEvidence(run.runId, leaseId, {step: "RECOVERY", cycle: run.remediationCycle, kind: "RECOVERY", argv: [], startedAt: at, endedAt: at, exitCode: problems.length ? 1 : 0, logPath: null, logSha256: null, note}, this.o.actor);
    if (!problems.length) return true;
    const reason = exhausted ? "RECOVERY_BUDGET_EXHAUSTED" : `RECOVERY_FAILED: ${problems.join(",")}`;
    this.o.store.transitionRun(run.runId, leaseId, "RECOVERY_FAILED", reason, this.o.actor, {mission: {to: "BLOCKED", reason}});
    return false;
  }

  private async executeStep(run: WorkRun, leaseId: string): Promise<void> {
    const s = this.o.store, step = run.step, want = stepStatus(step);
    const startMission: RunWriteOptions["mission"] = step === "IMPLEMENT" && run.remediationCycle === 0 ? {to: "EXECUTING", reason: `run ${run.runId} implementing`} : undefined;
    let cur = run;
    if (cur.status !== want) cur = s.transitionRun(run.runId, leaseId, want, `step ${step} started`, this.o.actor, {mission: startMission});
    // //TR: PAR-04: adım başında (lease doğrulandıktan sonra) workspace sahiplik kaydı bu lease için atomik yazılır. WORKSPACE adımında kayıt, run dizinini açan stepWorkspace'te (risk/depo kabulünden SONRA) yazılır: reddedilen run'ın dizini hiç oluşmaz (REL-FX-3).
    // //TR: TK-4: kayıt yazılamazsa (geçici Windows rename EPERM, disk) adım ENGINE_ERROR ile ölmez: RETRY (bütçe dahilinde) olur.
    if (step !== "WORKSPACE") {
      try { this.writeOwner(run.runId, this.ownerRecord(cur, leaseId)); } catch { await this.applyOutcome(cur, leaseId, {kind: "RETRY", reason: "OWNER_RECORD_WRITE_FAILED"}); return; }
    }
    const entry = this.owned.get(run.runId);
    if (entry) entry.lost = false; // işaret adım başınadır: önceki adımın geçici heartbeat hatası sonraki adımları zehirlemez (gerçek fence zaten bir sonraki renew'da yakalanır)
    let lost = false;
    // Heartbeat: uzun adımlarda lease yenilenir; yenileme fence edilirse süreç durdurulur ve sonraki yazı reddedilir.
    const hb = setInterval(() => { try { this.renew(run.runId, leaseId); } catch { lost = true; if (entry) entry.lost = true; } }, Math.max(50, Math.floor(this.o.leaseTtlMs / 3)));
    let out: Outcome;
    const epoch = this.stopEpoch;
    try { out = await this.performStep(cur, leaseId, () => lost || entry?.lost === true || this.halted(epoch) || this.stopActive() !== null); } finally { clearInterval(hb); }
    // //TR: R2: motor durdurulurken (stop(), SIGTERM/SIGINT/SIGHUP, exit) çocuk bizim tarafımızdan öldürülmüş olabilir: bu "başarısız" bir adım DEĞİLDİR. Tamamlanmış sonuçlar (DONE, REMEDIATE) ve GLOBAL_STOP iptali işlenir; başarısızlık/engel/yeniden-dene/lease-kaybı iptali kaydedilmez, run kilitli kalır ve sonraki engine devralır (terminal FAILED/CANCELLED olmaz).
    if (this.halted(epoch) && out.kind !== "DONE" && out.kind !== "REMEDIATE" && !(out.kind === "CANCEL" && this.stopActive() !== null)) return;
    await this.applyOutcome(cur, leaseId, out);
  }

  // //TR: Rol atanmış run için rol bağlamasının TaskLimits'i run varsayılanlarıyla birleşir (yalnız sıkılaştırır: maxCycles -> remediation üst sınırı, timeoutMs -> executor zaman aşımı, maxFilesWritten -> IMPLEMENT sonrası dosya sayısı). Rolsüz run (roleId null) değişmez.
  private limitsOf(run: WorkRun) { return effectiveLimits(taskLimitsFor(run.roleId), {maxRemediations: this.o.maxRemediations, executorTimeoutMs: this.o.executorTimeoutMs}); }

  private async applyOutcome(run: WorkRun, leaseId: string, out: Outcome): Promise<void> {
    const s = this.o.store, a = this.o.actor, id = run.runId, step = run.step;
    switch (out.kind) {
      case "DONE": {
        s.transitionRun(id, leaseId, "CHECKPOINTING", `step ${step} completed`, a);
        const next = out.next === "FINISHED" ? "REPORT" : out.next;
        const mission = MISSION_AFTER[step];
        s.checkpointRun(id, leaseId, {step, data: {...out.data, attempt: run.attempt}}, a, {patch: {...(out.patch ?? {}), step: next, retryCount: 0, retryAt: null}, mission: mission ? {to: mission, reason: `run ${id}: ${step} completed`} : undefined});
        if (out.next === "FINISHED") s.transitionRun(id, leaseId, "AWAITING_APPROVAL", out.approvalReason ?? "DELIVERY_DECISION_PENDING_FOUNDER", a);
        return;
      }
      case "REMEDIATE": {
        const lim = this.limitsOf(run);
        if (run.remediationCycle >= lim.maxRemediations) {
          const reason = `${out.reason}_${lim.cycleCapped ? "TASK_LIMIT_MAX_CYCLES" : "REMEDIATION"}_EXHAUSTED`;
          s.transitionRun(id, leaseId, "BLOCKED", reason, a, {mission: {to: "BLOCKED", reason}});
          return;
        }
        s.transitionRun(id, leaseId, "CHECKPOINTING", `step ${step} rejected: ${out.reason}`, a);
        s.checkpointRun(id, leaseId, {step, data: {...out.data, attempt: run.attempt, outcome: "REMEDIATE", reason: out.reason, findings: out.findings.slice(0, 50)}}, a,
          {patch: {step: "IMPLEMENT", remediationCycle: run.remediationCycle + 1, retryCount: 0, retryAt: null}, mission: {to: "REMEDIATING", reason: `run ${id}: ${out.reason}`}});
        return;
      }
      case "RETRY": {
        if (run.retryCount >= this.o.maxRetries) {
          const reason = `${out.reason}_RETRY_EXHAUSTED`;
          s.transitionRun(id, leaseId, "FAILED", reason, a, {mission: {to: "BLOCKED", reason}});
          return;
        }
        const backoff = this.o.retryBackoffMs[Math.min(run.retryCount, this.o.retryBackoffMs.length - 1)] ?? 0;
        s.transitionRun(id, leaseId, "RETRY_SCHEDULED", out.reason, a, {patch: {retryCount: run.retryCount + 1, retryAt: new Date(this.o.now() + backoff).toISOString()}});
        return;
      }
      case "BLOCK": {
        s.transitionRun(id, leaseId, out.status ?? "BLOCKED", out.reason, a, {mission: {to: "BLOCKED", reason: out.reason}});
        return;
      }
      case "CANCEL": {
        if (out.reason === "ENGINE_STOPPING") return; // motor kapanıyor: run iptal edilmez, lease dolunca sonraki engine devralır
        const cur = s.engineGetRun(id);
        if (cur && cur.leaseId === leaseId) this.cancelLeased(cur, leaseId, out.reason);
        return;
      }
    }
  }

  private writeLog(run: WorkRun, name: string, text: string): {logPath: string; logSha256: string} {
    const dir = path.join(this.runDir(run.runId), "logs");
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, `${run.step.toLowerCase()}-c${run.remediationCycle}-a${run.attempt}-${name}-${crypto.randomBytes(3).toString("hex")}.log`);
    const bytes = Buffer.from(redactSecrets(text), "utf8");
    fs.writeFileSync(file, bytes);
    return {logPath: path.relative(this.o.dataDir, file).split(path.sep).join("/"), logSha256: sha256(bytes)};
  }
  private evidence(run: WorkRun, leaseId: string, ev: Omit<RunEvidence, "evidenceId" | "step" | "cycle">): void {
    this.o.store.addRunEvidence(run.runId, leaseId, {step: run.step, cycle: run.remediationCycle, ...ev}, this.o.actor);
  }
  private procEvidence(run: WorkRun, leaseId: string, kind: string, r: ProcResult, extra: Partial<RunEvidence> = {}): {logPath: string; logSha256: string} {
    const log = this.writeLog(run, kind.toLowerCase(), `$ ${r.argv.join(" ")}\n[exit=${r.exitCode} timedOut=${r.timedOut} aborted=${r.aborted}]\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`);
    this.evidence(run, leaseId, {kind, argv: r.argv, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, timedOut: r.timedOut, ...log, ...extra});
    return log;
  }
  private missionSpec(run: WorkRun): MissionSpec {
    const m = this.o.store.getMission({tenantId: run.tenantId}, run.missionId);
    if (!m) throw new WorkOsError("WORKOS_NOT_FOUND", "mission");
    const last = [...run.checkpoints].reverse().find(c => c.data.outcome === "REMEDIATE");
    return {
      runId: run.runId, missionId: m.missionId, projectId: m.projectId, title: m.title, objective: m.objective, acceptanceCriteria: [...m.acceptanceCriteria],
      riskLevel: m.riskLevel, cycle: run.remediationCycle, baseSha: run.baseSha ?? "",
      ...(run.remediationCycle > 0 && last ? {remediation: {reason: String(last.data.reason ?? ""), findings: (Array.isArray(last.data.findings) ? last.data.findings : []).map(String)}} : {})
    };
  }
  private rawTestCommand(run: WorkRun): string[] | undefined {
    const m = this.o.store.getMission({tenantId: run.tenantId}, run.missionId), p = this.o.store.getProject({tenantId: run.tenantId}, run.projectId);
    return effectiveTestCommand(m, p);
  }
  // REL-FX-2: reviewer'a verilen test yüzeyi, run.headSha için en son TEST_SURFACE kanıtından.
  private reviewerTestSurface(run: WorkRun): ReviewerTestSurface | undefined {
    const ev = [...run.evidence].reverse().find(e => e.kind === "TEST_SURFACE" && e.commitSha === run.headSha && e.testSurface);
    const t = ev?.testSurface;
    return t ? {added: t.added, modified: t.modified, deleted: t.deleted, renamed: t.renamed, weakened: t.weakened, trivialAdded: t.trivialAdded, harness: t.harness ?? [], executedTests: t.executedTests, skippedTests: t.testRun?.skipped ?? null, todoTests: t.testRun?.todo ?? null, functionalAcceptance: t.functionalAcceptance, reason: t.reason} : undefined;
  }
  private testArgv(run: WorkRun): string[] | null {
    const argv = this.rawTestCommand(run);
    if (!testCommandAllowed(argv)) return null;
    return argv[0] === "node" ? [process.execPath, ...argv.slice(1)] : [...argv];
  }
  // SBX-GATE: test komutu proje kodudur; yalnız kapının verdiği sağlayıcıda (sandbox) çalışır, ana makinede asla.
  // //TR: PAR-04 SINIRI: VERIFY test süreci (cwd = work) workspace yazarı olarak İZLENMEZ; SandboxRunOptions'ta onSpawn yoktur (execution-gate.ts ve sağlayıcılar Lane C dosyası değil). Çözüm talebi: docs/authority-requests/LANE-C-par-tests.md "Residual".
  private runTests(gate: Extract<GateDecision, {allowed: true}>, argv: string[], cwd: string, abort: () => boolean): Promise<ProcResult> {
    return gate.provider.run(argv, {cwd, env: safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"}), timeoutMs: this.o.testTimeoutMs, shouldAbort: abort});
  }
  // SBX-GATE + M1a (D-SBX1-PATH-2026-10-15): sandbox yoksa test HİÇ çalıştırılmaz (kapı değişmez, fail-closed; ana makinede çocuk süreç yok); kanıt NOT_EXECUTED olarak yazılır (PASS/FAILED değil).
  // Run BLOCKED olmaz: M1a ilerlemesi statik SECURITY -> bağımsız REVIEW -> REPORT -> AWAITING_APPROVAL ile sürer; functionalAcceptance NOT_EXECUTED olur (asla VERIFIED değil).
  // Yeniden deneme/remediation bütçesi tüketilmez (DONE checkpoint'i retryCount'u 0 bırakır).
  private sandboxNotExecuted(run: WorkRun, leaseId: string, kind: "VERIFY_TESTS" | "REGRESSION_TESTS", argv: string[], d: Extract<GateDecision, {allowed: false}>): void {
    const at = new Date().toISOString(), note = `NOT_EXECUTED: ${d.reason} (${d.detail}); project code is never run on the host without a verified sandbox (FD-REL-1-REJECT-HOST-EXEC-2026-10-15); M1a: run continues to static security and independent review, result NOT_VERIFIED`;
    const log = this.writeLog(run, `${kind.toLowerCase()}-not-executed`, `$ ${argv.join(" ")}
[${note}]
`);
    this.evidence(run, leaseId, {kind: `${kind}_NOT_EXECUTED`, argv, startedAt: at, endedAt: at, exitCode: null, ...log, commitSha: run.headSha ?? undefined, note});
  }
  // M1a: run.headSha için testler sandbox yokluğundan çalıştırılmadıysa (NOT_EXECUTED kanıtı) reviewer'a ve rapora bu bilgi açıkça verilir.
  private testsNotExecuted(run: WorkRun): boolean {
    return !!run.headSha && run.evidence.some(e => (e.kind === "VERIFY_TESTS_NOT_EXECUTED" || e.kind === "REGRESSION_TESTS_NOT_EXECUTED") && e.commitSha === run.headSha);
  }
  private authorizeTests(kind: ProjectExecutionKind): Promise<GateDecision> { return this.o.executionGate.authorize(kind); }

  private async performStep(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    switch (run.step) {
      case "WORKSPACE": return this.stepWorkspace(run, leaseId);
      case "IMPLEMENT": return this.stepImplement(run, leaseId, abort);
      case "VERIFY": return this.stepVerify(run, leaseId, abort);
      case "SECURITY": return this.stepSecurity(run, leaseId, abort);
      case "REVIEW": return this.stepReview(run, leaseId, abort);
      case "REGRESSION": return this.stepRegression(run, leaseId, abort);
      case "REPORT": return this.stepReport(run, leaseId);
    }
  }

  // İzole workspace: proje deposunun yerel yolundan --no-hardlinks klon, HEAD base SHA olarak kaydedilir, run branch'i açılır. Yeniden girişte sıfırdan kurulur.
  private async stepWorkspace(run: WorkRun, leaseId: string): Promise<Outcome> {
    // REL-FX-3 derinlemesine savunma: journal'a enjekte edilmiş run bile R3/R4 mission için klon veya alt süreç başlatamaz; düzey yalnız mission kaydından okunur.
    const mission = this.o.store.getMission({tenantId: run.tenantId}, run.missionId);
    if (!mission) return {kind: "BLOCK", reason: "MISSION_NOT_FOUND"};
    if (!riskAdmitted(mission.riskLevel)) {
      const at = new Date().toISOString();
      this.evidence(run, leaseId, {kind: "RISK_ADMISSION", argv: [], startedAt: at, endedAt: at, exitCode: 1, logPath: null, logSha256: null, note: `riskLevel=${String(mission.riskLevel).slice(0, 8)}; ${RISK_REFUSAL} (D-REL-2)`});
      return {kind: "BLOCK", reason: RISK_REFUSAL};
    }
    const notice = hostExecutionNotice(mission.riskLevel);
    const project = this.o.store.getProject({tenantId: run.tenantId}, run.projectId);
    if (!project) return {kind: "BLOCK", reason: "PROJECT_NOT_FOUND"};
    const pre = repositoryPrecondition(project, this.o.dataDir);
    if (!pre.ok) return {kind: "BLOCK", reason: pre.reason};
    const src = pre.src;
    // //TR: PAR-03 + #218: depo kökü/HEAD kararı #218'in TEK karar prosedürüdür (headDecision); burada EŞZAMANSIZ sürücüyle çalışır, böylece bir depo probu sürerken diğer run'ların lease yenilemesi bloklanmaz. Ortam izin listesi (gitProbeEnv) sürücüden bağımsız aynıdır.
    const repoHead = await repositoryHeadAsync(src);
    if (!repoHead.ok) return {kind: "BLOCK", reason: repoHead.reason};
    const base = repoHead.baseSha;
    const dir = this.runDir(run.runId), work = path.join(dir, "work"), branch = `uasco/run/${run.runId}`;
    fs.mkdirSync(dir, {recursive: true});
    try { this.writeOwner(run.runId, this.ownerRecord(run, leaseId)); } catch { return {kind: "RETRY", reason: "OWNER_RECORD_WRITE_FAILED"}; } // TK-4
    this.guardWorkspace(run, leaseId);
    await this.rmUnderRun(run.runId, work);
    const startedAt = new Date().toISOString();
    const clone = await this.gitW(run, leaseId, dir, ["clone", "--no-hardlinks", "--quiet", src, work]);
    const co = clone.status === 0 ? await this.gitW(run, leaseId, work, ["checkout", "-q", "-B", branch, base]) : null;
    const head = co?.status === 0 ? await this.gitOk(work, ["rev-parse", "HEAD"]) : null;
    this.renew(run.runId, leaseId);
    const log = this.writeLog(run, "workspace", `$ git clone --no-hardlinks ${src} <run>/work\n${clone.stdout ?? ""}${clone.stderr ?? ""}\n$ git checkout -B ${branch} ${base}\n${co?.stdout ?? ""}${co?.stderr ?? ""}\nHEAD=${head}\n`);
    const ok = head === base;
    this.evidence(run, leaseId, {kind: "WORKSPACE", argv: ["git", "clone", "--no-hardlinks", src, `runs/${run.runId}/work`], startedAt, endedAt: new Date().toISOString(), exitCode: ok ? 0 : (clone.status ?? 1), ...log, baseSha: base, note: `${notice.code} riskLevel=${notice.riskLevel} (${notice.decision} ${notice.decisionStatus})`});
    if (!ok) return {kind: "BLOCK", reason: "WORKSPACE_CLONE_FAILED"};
    return {kind: "DONE", next: "IMPLEMENT", data: {baseSha: base, workBranch: branch}, patch: {baseSha: base, headSha: null, workBranch: branch}};
  }

  // IMPLEMENT yeniden girişte idempotenttir: workspace önce döngü başlangıç commit'ine sıfırlanır (kör tekrar yok).
  // //TR: Rol atanmış run için izlenebilir ajan kaydı: rol tanımı kimliği ile ajan örneği kimliği ayrı; araç izinleri profilden gelir. Çağrı-başına araç izi bu adapter'dan GÖZLENEMEZ (araç kısıtı claude bayraklarıyla uygulanır) — bu açıkça yazılır, uydurma sayaç yok. Kanıt adımı run.step'tir (IMPLEMENT veya REVIEW).
  private recordAgentTrace(run: WorkRun, leaseId: string, profile: RoleExecutionProfile, finalState: "COMPLETED" | "FAILED" | "ABORTED", r: {startedAt: string; endedAt: string; exitCode: number | null}, executorIdentity: string, noteExtra: string): void {
    const agent = instantiateAgent({status: "EXECUTABLE", roleId: profile.roleId, profile, certification: "NOT_CERTIFIED", evaluation: {executed: 0, total: 0}}, run.runId, `agent-${run.runId}-${run.step.toLowerCase()}-c${run.remediationCycle}`);
    advanceAgent(agent, "RUNNING"); advanceAgent(agent, finalState);
    const env = {...agentTraceEnvelope(agent), allowedTools: profile.allowedTools, perCallToolTrace: "NOT_OBSERVABLE_FROM_ADAPTER", certification: "NOT_CERTIFIED"};
    this.evidence(run, leaseId, {kind: "AGENT_TRACE", argv: [], startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, ...this.writeLog(run, `agent-trace-${run.step.toLowerCase()}`, JSON.stringify(env, null, 2) + "\n"), executorIdentity, note: `agent=${agent.agentInstanceId} role=${profile.roleId} state=${agent.state}${noteExtra}`.slice(0, 200)});
  }
  private async stepImplement(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    // //TR: Run'a bir rol atanmışsa (roleId != null) o rol TANIMI implementer rotalı (developer/tester) yürütülebilir olmalıdır; değilse run yazmadan BLOCKED (ROLE_NOT_EXECUTABLE:<neden>). roleId null = rol atanmamış eski/rolsüz run (davranış değişmez).
    if (run.roleId !== null) {
      try { assertImplementerRole(run.roleId); } catch (e) { return {kind: "BLOCK", reason: (e as Error).message.slice(0, 200)}; }
    }
    const work = path.join(this.runDir(run.runId), "work"), branch = run.workBranch ?? `uasco/run/${run.runId}`;
    const start = run.remediationCycle === 0 ? run.baseSha : (run.headSha ?? run.baseSha);
    if (!start || !SHA.test(start) || !fs.existsSync(path.join(work, ".git"))) return {kind: "BLOCK", reason: "WORKSPACE_MISSING", status: "FAILED"};
    // //TR: PAR-04: sıfırlama workspace'i değiştirir; kayıt bu lease'e ait değilse (başka engine devraldı) hiçbir şey değiştirilmez. Beklenen HEAD yoktur: sıfırlamanın amacı HEAD'i start'a getirmektir.
    this.guardWorkspace(run, leaseId);
    for (const args of [["checkout", "-q", "-B", branch, start], ["reset", "-q", "--hard", start], ["clean", "-qfdx"]]) {
      if ((await this.gitWOk(run, leaseId, work, args)) === null) return {kind: "BLOCK", reason: "WORKSPACE_RESET_FAILED", status: "FAILED"};
    }
    this.renew(run.runId, leaseId);
    const spec: MissionSpec = {...this.missionSpec(run), startSha: start};
    const lim = this.limitsOf(run);
    const r = await this.withChild(run, leaseId, onSpawn => this.o.executors.implementer.implement(work, spec, {timeoutMs: lim.executorTimeoutMs, shouldAbort: abort, onSpawn, writerEnv: writerEnvFor(run.runId, leaseId), span: fn => this.span(fn)}));
    if (!(await this.sweepOwnWriters(run, leaseId))) return {kind: "BLOCK", reason: "WORKSPACE_WRITER_ALIVE", status: "FAILED"};
    const head = await this.gitOk(work, ["rev-parse", "HEAD"]);
    const log = this.writeLog(run, "implement", r.log);
    const produced = r.exitCode === 0 && !r.blockReason && head && SHA.test(head) && head !== start ? head : undefined;
    const limit = r.exitCode !== 0 && !r.aborted && !r.timedOut ? executorLimit(r.exitCode, r.log) : null;
    this.evidence(run, leaseId, {kind: "IMPLEMENT", argv: r.argv, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, timedOut: r.timedOut, ...log, baseSha: start, ...(produced ? {commitSha: produced} : {}), executorIdentity: this.o.executors.implementer.identity,
      ...(limit ? {note: limitNote(limit)} : r.blockReason ? {note: r.blockReason.slice(0, 200)} : {})});
    // //TR: Rol atanmış run için izlenebilir ajan kaydı (ayrıntı: recordAgentTrace).
    if (run.roleId !== null) this.recordAgentTrace(run, leaseId, assertImplementerRole(run.roleId), r.aborted ? "ABORTED" : produced ? "COMPLETED" : "FAILED", r, this.o.executors.implementer.identity, "");
    if (r.aborted) return {kind: "CANCEL", reason: this.cancelReason()};
    // REL-FX-4: sağlayıcı kota/hız sınırı kör retry ile bütçe tüketmez: run BLOCKED(PROVIDER_QUOTA), retryCount değişmez; disk dolu/kotası BLOCKED(DISK_FULL).
    if (limit) return limitBlock(limit);
    // Edit-only builder çıktısını engine commit etmeyi reddettiyse (değişiklik yok, .git/workspace dışı değişiklik) veya builder hiç başlatılmadıysa (SBX-8: profil oturumu yok) run BLOCKED olur.
    // INT-R4 kompozisyon: blockReason, exitCode!=0 dalından ÖNCE kalır; profil oturumu yok refüzü exitCode=null + blockReason=CLAUDE_PROFILE_LOGIN_REQUIRED ile gelir ve null!==0 doğru olduğundan generic IMPLEMENT_FAILED'e düşmemelidir (SBX-8 v7-sbx8-reviewer).
    if (r.blockReason) return {kind: "BLOCK", reason: r.blockReason.slice(0, 200)};
    if (r.exitCode !== 0) return r.transient ? {kind: "RETRY", reason: "IMPLEMENT_TRANSIENT_FAILURE"} : {kind: "BLOCK", reason: "IMPLEMENT_FAILED", status: "FAILED"};
    if (!produced) return {kind: "BLOCK", reason: "NO_COMMIT_PRODUCED", status: "FAILED"};
    if (r.commitSha !== undefined && r.commitSha !== produced) return {kind: "BLOCK", reason: "IMPLEMENT_COMMIT_MISMATCH", status: "FAILED"};
    if ((await this.git(work, ["merge-base", "--is-ancestor", start, produced])).status !== 0) return {kind: "BLOCK", reason: "IMPLEMENT_HISTORY_REWRITTEN", status: "FAILED"};
    // //TR: Rol limiti maxFilesWritten: run'ın BASE'e göre değiştirdiği dosya sayısı (döngüler toplamı) sınırı aşarsa VERIFY'a geçilmez. Sayım okunamazsa fail-closed (limit doğrulanamaz).
    if (lim.maxFilesWritten !== null) {
      const base = run.baseSha ?? start;
      const names = await this.git(work, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", base, produced]);
      if (names.status !== 0) return {kind: "BLOCK", reason: "TASK_LIMIT_FILES_UNVERIFIABLE", status: "FAILED"};
      const files = names.stdout.split("\0").filter(Boolean).length;
      if (files > lim.maxFilesWritten) return {kind: "BLOCK", reason: `TASK_LIMIT_FILES_EXCEEDED:${files}>${lim.maxFilesWritten}`};
    }
    return {kind: "DONE", next: "VERIFY", data: {commitSha: produced, startSha: start}, patch: {headSha: produced}};
  }

  // Diff her zaman engine'in taze klonunda alınır: --text (binary/-diff attribute gizleyemez), --no-textconv/--no-ext-diff (sürücü çalışmaz),
  // boş attributes dosyası (global attributes yok sayılır) ve sabit a/ b/ önekleri; implementer'ın .git/config veya .gitattributes'ı taramayı atlatamaz.
  private emptyAttributes(run: WorkRun): string {
    const f = path.join(this.runDir(run.runId), "empty-attributes");
    fs.writeFileSync(f, "");
    return f;
  }
  private async diff(run: WorkRun, cwd: string, base: string, head: string): Promise<string | null> {
    const r = await this.git(cwd, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--text", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", base, head]);
    return r.status === 0 ? r.stdout : null;
  }
  // B3C-C2-F1: gitleaks git geçişinin gördüğü yamaların aynısı (--text --no-textconv --no-ext-diff, merge'ler first-parent'a göre), boş attributes ile; yalnız eklenen satırlar akışını kurmak için.
  private async patchLog(run: WorkRun, cwd: string, base: string, head: string): Promise<string | null> {
    const r = await this.git(cwd, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "log", "-p", "--no-color", "--no-ext-diff", "--no-textconv", "--text", "--no-renames", "--diff-merges=first-parent",
      "--no-show-signature", "--src-prefix=a/", "--dst-prefix=b/", "--format=commit %H", `${base}..${head}`]);
    return r.status === 0 ? r.stdout : null;
  }
  private async commitMessages(run: WorkRun, cwd: string, base: string, head: string): Promise<string | null> {
    const r = await this.git(cwd, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "log", "--no-color", "--no-show-signature", "--format=commit %H%n%B", `${base}..${head}`]);
    return r.status === 0 ? r.stdout : null;
  }

  // VERIFY: önce diff secret taraması (hit -> BLOCKED, testler hiç çalışmaz), sonra allowlist'teki argv test komutu safeChildEnv + timeout ile.
  private async stepVerify(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const work = path.join(this.runDir(run.runId), "work");
    if (!run.baseSha || !run.headSha) return {kind: "BLOCK", reason: "HEAD_COMMIT_MISSING", status: "FAILED"};
    // //TR: PAR-04: workspace'i değiştirmeden önce kayıt bu lease'e ait olmalı VE HEAD kayıtlı headSha olmalı; sahipsiz bir yazar HEAD'i oynattıysa onarılmaz, fail-closed (eski "checkout -B" onarımı kaldırıldı).
    this.guardWorkspace(run, leaseId);
    if ((await this.gitOk(work, ["rev-parse", "HEAD"])) !== run.headSha) return {kind: "BLOCK", reason: "WORKSPACE_DIVERGED", status: "FAILED"};
    const startedAt = new Date().toISOString();
    // Tarama implementer workspace'inde değil, üretilen commit'in taze klonunda yapılır (workspace .git/config textconv'u etkisizdir).
    const scanClone = await this.freshClone(run, leaseId, `scan-c${run.remediationCycle}`);
    if (!scanClone) return {kind: "BLOCK", reason: "SCAN_CLONE_FAILED", status: "FAILED"};
    const diff = await this.diff(run, scanClone, run.baseSha, run.headSha);
    const messages = await this.commitMessages(run, scanClone, run.baseSha, run.headSha);
    if (diff === null || messages === null) return {kind: "BLOCK", reason: "DIFF_UNAVAILABLE", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const hits = this.span(() => [...scanDiffForSecrets(diff), ...scanCommitMessagesForSecrets(messages)]);
    const scanLog = this.writeLog(run, "secret-scan", `secret scan ${run.baseSha}..${run.headSha} (fresh clone, --text --no-textconv --no-ext-diff, empty attributes; diff + commit messages): ${hits.length} hit(s)\n${hits.map(h => `${h.kind} ${h.file}:${h.line}`).join("\n")}\n`);
    this.evidence(run, leaseId, {kind: "SECRET_SCAN", argv: ["git", "diff", "--text", "--no-textconv", "--no-ext-diff", run.baseSha, run.headSha], startedAt, endedAt: new Date().toISOString(), exitCode: hits.length ? 1 : 0, ...scanLog, baseSha: run.baseSha, commitSha: run.headSha, secretHits: hits.slice(0, 100)});
    if (hits.length) return {kind: "BLOCK", reason: "SECRET_IN_DIFF"};
    // REL-FX-2: test yüzeyi de aynı taze klonda base..head name-status ile alınır (implementer workspace'i/config'i etkisizdir).
    const ns = await this.git(scanClone, ["-c", `core.attributesFile=${this.emptyAttributes(run)}`, "-c", "core.fsmonitor=false", "diff", "--name-status", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", run.baseSha, run.headSha]);
    if (ns.status !== 0) return {kind: "BLOCK", reason: "DIFF_UNAVAILABLE", status: "FAILED"};
    const touched = parseNameStatusZ(ns.stdout);
    const argv = this.testArgv(run);
    if (!argv) return {kind: "BLOCK", reason: "TEST_COMMAND_NOT_CONFIGURED"};
    const base = run.baseSha, head = run.headSha;
    // INT-R4 kompozisyon: yürütme SBX kapısına tabidir; TEST_SURFACE (REL-FX-2) ise statik git analizidir (name-status + değişen test dosyası metni) ve kapıdan bağımsız hesaplanıp kaydedilir.
    const gate = await this.authorizeTests("RUNNER_VERIFY_TESTS");
    if (!gate.allowed) {
      // SBX kapısı önceliklidir ve koşulsuzdur: doğrulanmış sağlayıcı yoksa proje kodu HİÇ çalıştırılmaz (ana makinede çocuk süreç yok). Statik TEST_SURFACE yine de kaydedilir (executedTests=null, uydurma sayı yok;
      // functionalAcceptance NOT_EXECUTED, silinen/zayıflatılan test yine BLOCKED), sonra NOT_EXECUTED kanıtı yazılır ve M1a ilerlemesiyle SECURITY adımına geçilir; yeniden deneme bütçesi tüketilmez.
      this.recordTestSurface(run, leaseId, base, head, touched, scanClone, null, gate.reason);
      this.sandboxNotExecuted(run, leaseId, "VERIFY_TESTS", argv, gate);
      return {kind: "DONE", next: "SECURITY", data: {tests: "NOT_EXECUTED", testsReason: gate.reason, secretHits: 0}};
    }
    const r = await this.runTests(gate, argv, work, abort);
    // M1a c2: kanıt, kapı kararındaki doğrulanmış sağlayıcının kimliğini taşır (PRODUCT_VERIFIED için sandbox tanığı; kapı semantiği değişmez).
    this.procEvidence(run, leaseId, "VERIFY_TESTS", r, {commitSha: run.headSha, sandboxProviderId: gate.providerId});
    if (r.aborted) return {kind: "CANCEL", reason: this.cancelReason()};
    if (r.spawnError) return {kind: "BLOCK", reason: "TEST_COMMAND_SPAWN_FAILED"};
    // RV-RELFX-C2-002: stdout ve stderr akış kuralına göre ayrı okunur (birleştirilip son satır seçilmez; stderr'e basılan sahte özet gerçeğini ezemez, çelişki UNKNOWN). executedTests yalnız doğrulanmış sandbox içindeki gerçek koşudan gelir.
    const testRun = parseTestRunStreams(String(r.stdout ?? ""), String(r.stderr ?? ""));
    this.recordTestSurface(run, leaseId, base, head, touched, scanClone, testRun);
    if (r.exitCode === 0) return {kind: "DONE", next: "SECURITY", data: {tests: "PASSED", secretHits: 0}};
    return {kind: "REMEDIATE", reason: r.timedOut ? "TESTS_TIMED_OUT" : "TESTS_FAILED", data: {tests: "FAILED", exitCode: r.exitCode}, findings: [`test command exited ${r.exitCode}`]};
  }
  // REL-FX-2 + INT-R4: TEST_SURFACE statik git analizidir (taze klonda base..head name-status + değişen test dosyası metni) ve SBX kapısından bağımsız kaydedilir. executedTests/functionalAcceptance gerçek koşu yalnız doğrulanmış sandbox içinde olduğunda (testRun != null) dolar; yürütme bloklandığında testRun=null ve sayı uydurulmaz (UNKNOWN/BLOCKED).
  private recordTestSurface(run: WorkRun, leaseId: string, base: string, head: string, touched: NameStatusEntry[], scanClone: string, testRun: TestRunSummary | null, notExecutedReason?: "SANDBOX_UNAVAILABLE"): void {
    const surfaceStart = new Date().toISOString();
    // //TR: HB-2: her dosya için ayrı senkron `git show`; toplam süre span'ın 0.9 x TTL sınırını aşabileceğinden HER çağrıdan önce TÜM lease'ler yenilenir (TTL/10'a kısıtlı, ucuz).
    const contentAt = (ref: string, p: string): string | null => { this.renewAllOwned(); const x = this.gitSync(scanClone, ["show", `${ref}:${p}`]); return x.status === 0 ? String(x.stdout ?? "") : null; };
    const surface = this.span(() => evaluateTestSurface({baseSha: base, headSha: head, entries: touched, contentAt, executedTests: testRun?.executed ?? null, testRun, testCommand: this.rawTestCommand(run), ...(notExecutedReason ? {notExecutedReason} : {})}));
    this.renew(run.runId, leaseId);
    // Her kanıt gibi TEST_SURFACE de log dosyası + sha256 taşır (tam sınıflama JSON'u; dosya içeriği yazılmaz).
    const surfaceLog = this.writeLog(run, "test-surface", `${JSON.stringify(surface, null, 2)}\n`);
    this.evidence(run, leaseId, {kind: "TEST_SURFACE", argv: ["git", "diff", "--name-status", "--find-renames", base, head], startedAt: surfaceStart, endedAt: new Date().toISOString(), exitCode: surface.functionalAcceptance === "BLOCKED" ? 1 : 0,
      ...surfaceLog, baseSha: base, commitSha: head, testSurface: surface, note: `functionalAcceptance=${surface.functionalAcceptance} ${surface.reason}; added=${surface.added.length} modified=${surface.modified.length} deleted=${surface.deleted.length} renamed=${surface.renamed.length} weakened=${surface.weakened.length} harness=${surface.harness.length} executed=${surface.executedTests ?? "unknown"} skipped=${testRun?.skipped ?? "unknown"} todo=${testRun?.todo ?? "unknown"}`});
  }

  // Bare taze klon (çalışma ağacı yok): gitleaks yalnız git geçmişini okur; repodaki .gitleaksignore / .gitleaks.toml okunabilecek bir yer bulunmaz.
  private async bareClone(run: WorkRun, leaseId: string, name: string): Promise<string | null> {
    const work = path.join(this.runDir(run.runId), "work"), dir = path.join(this.runDir(run.runId), name);
    await this.rmUnderRun(run.runId, dir);
    if ((await this.gitW(run, leaseId, this.runDir(run.runId), ["clone", "--no-hardlinks", "--quiet", "--bare", work, dir])).status !== 0) return null;
    for (const sha of [run.baseSha, run.headSha]) if (!sha || (await this.gitOk(dir, ["cat-file", "-e", `${sha}^{commit}`])) === null) return null;
    return dir;
  }

  // SECURITY (Master §07: QA -> Security -> review): üretilen commit'in taze klonlarında (implementer workspace'inde asla) yerleşik diff taraması + gitleaks (base..head, redakte) + trivy (çevrimdışı, DB indirilmez).
  // Araç yoksa dürüst durum (TOOL_NOT_INSTALLED), DB yok/eskiyse PARTIAL (TRIVY_DB_UNAVAILABLE), SAST her zaman NOT_AVAILABLE kaydedilir. Adım durumsuzdur: yeniden girişte klonlar sıfırdan kurulur, tarama baştan yapılır.
  private async stepSecurity(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const base = run.baseSha, head = run.headSha;
    if (!base || !head || !SHA.test(base) || !SHA.test(head)) return {kind: "BLOCK", reason: "HEAD_COMMIT_MISSING", status: "FAILED"};
    const startedAt = new Date().toISOString();
    const secDir = path.join(this.runDir(run.runId), "security"), tag = `c${run.remediationCycle}-a${run.attempt}`;
    fs.mkdirSync(secDir, {recursive: true});
    const clone = await this.freshClone(run, leaseId, `security-c${run.remediationCycle}`);
    if (!clone) return {kind: "BLOCK", reason: "SECURITY_CLONE_FAILED", status: "FAILED"};
    const diff = await this.diff(run, clone, base, head), messages = await this.commitMessages(run, clone, base, head);
    if (diff === null || messages === null) return {kind: "BLOCK", reason: "DIFF_UNAVAILABLE", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const builtinHits = this.span(() => scanDiffForSecrets(diff).length + scanCommitMessagesForSecrets(messages).length);
    const env = safeChildEnv(this.o.envPolicyFile, {provider: "DETERMINISTIC"});
    const so = this.securityOpts, ctx = {env, timeoutMs: so.timeoutMs ?? DEFAULT_SECURITY_TIMEOUT_MS, maxReportBytes: so.maxReportBytes ?? DEFAULT_MAX_REPORT_BYTES, abort};
    const logs: Record<string, {logPath: string | null; logSha256: string | null}> = {};
    // Kurulu araç her çalıştırmadan önce yeniden doğrulanır (sha256); ERROR durumundaki araç fail-closed hata sayılır.
    const problem = (t: ResolvedTool): string | null => t.status === "INSTALLED" ? verifyTool(t) : (t.status === "ERROR" ? (t.reason ?? "TOOL_ERROR") : null);

    // ---- gitleaks ----
    const gt = this.securityTools.gitleaks;
    let gitleaks: PolicyInput["gitleaks"] = {status: "NOT_INSTALLED", reason: "TOOL_NOT_INSTALLED", count: 0, items: [], rawReportSha256: null};
    const gProblem = this.span(() => problem(gt));
    if (gt.status !== "NOT_INSTALLED" && gProblem) gitleaks = {status: "ERROR", reason: gProblem, count: 0, items: [], rawReportSha256: null};
    else if (gt.status === "INSTALLED") {
      const bare = await this.bareClone(run, leaseId, `security-gl-c${run.remediationCycle}.git`);
      if (!bare) return {kind: "BLOCK", reason: "SECURITY_CLONE_FAILED", status: "FAILED"};
      // B3C-C2-F2: aralık gitleaks'ten önce doğrulanır (gitleaks iç git hatasında exit 0 + "[]" verebilir); sorun varsa tarayıcı hiç çalışmaz, sonuç SECURITY_TOOL_ERROR olur.
      const rangeProblem = this.span(() => gitRangeProblem(args => { this.renewAllOwned(); return this.gitSync(bare, args); }, base, head));
      if (rangeProblem) gitleaks = {status: "ERROR", reason: rangeProblem, count: 0, items: [], rawReportSha256: null};
      else {
        const cwd = path.join(secDir, "gitleaks-cwd"), configFile = path.join(secDir, "gitleaks.toml"), ignoreFile = path.join(secDir, "gitleaks.ignore");
        fs.mkdirSync(cwd, {recursive: true});
        fs.writeFileSync(configFile, "[extend]\nuseDefault = true\n");
        fs.writeFileSync(ignoreFile, "");
        const g = await runGitleaks(gt, {bareRepo: bare, base, head, configFile, ignoreFile, reportFile: path.join(secDir, `gitleaks-raw-${tag}.json`), cwd}, ctx);
        logs.gitleaks = this.procEvidence(run, leaseId, "SECURITY_GITLEAKS", g.proc, {commitSha: head, baseSha: base, note: `gitleaks ${gt.version ?? ""}: ${g.status}${g.reason ? ` ${g.reason}` : ""} findings=${g.count}`.slice(0, 300)});
        if (g.proc.aborted || abort()) return {kind: "CANCEL", reason: this.cancelReason()};
        if (g.transient) return {kind: "RETRY", reason: "SECURITY_TOOL_TRANSIENT_FAILURE"};
        // B3C-C2-F1: varsayılan global YOL allowlist'i (node_modules/, kilit dosyaları, *.png ...) git geçişinde kapatılamaz; eklenen satırlar yolsuz stdin geçişiyle yeniden taranır.
        let added: GitleaksResult | null = null, addedProblem: string | null = null;
        if (g.status !== "ERROR") {
          const patch = await this.patchLog(run, bare, base, head);
          this.renew(run.runId, leaseId);
          if (patch === null) addedProblem = "ADDED_LINES_UNAVAILABLE";
          else {
            added = await runGitleaksAddedLines(gt, {stream: buildAddedLineStream(patch), configFile, ignoreFile, reportFile: path.join(secDir, `gitleaks-raw-added-${tag}.json`), cwd}, ctx);
            logs.gitleaksAddedLines = this.procEvidence(run, leaseId, "SECURITY_GITLEAKS_ADDED_LINES", added.proc, {commitSha: head, baseSha: base, note: `gitleaks ${gt.version ?? ""} added-lines (stdin, no path allowlist): ${added.status}${added.reason ? ` ${added.reason}` : ""} findings=${added.count}`.slice(0, 300)});
            if (added.proc.aborted || abort()) return {kind: "CANCEL", reason: this.cancelReason()};
            if (added.transient) return {kind: "RETRY", reason: "SECURITY_TOOL_TRANSIENT_FAILURE"};
          }
        }
        gitleaks = mergeGitleaksPasses(g, added, addedProblem);
      }
    }

    // ---- trivy (çevrimdışı; DB indirilmez) ----
    const tt = this.securityTools.trivy;
    let trivy: PolicyInput["trivy"] = {status: "NOT_INSTALLED", reason: "TOOL_NOT_INSTALLED", counts: {}, blocking: 0, findings: [], truncated: false, rawReportSha256: null};
    const tProblem = this.span(() => problem(tt));
    if (tt.status !== "NOT_INSTALLED" && tProblem) trivy = {...trivy, status: "ERROR", reason: tProblem};
    else if (tt.status === "INSTALLED") {
      const cwd = path.join(secDir, "trivy-cwd");
      fs.mkdirSync(cwd, {recursive: true});
      const r = await runTrivy(tt, {target: clone, cacheDir: so.trivyCacheDir ?? defaultTrivyCacheDir(), reportFile: path.join(secDir, `trivy-${tag}.json`), cwd, nowMs: (so.now ?? Date.now)(), maxDbAgeMs: so.maxTrivyDbAgeMs ?? DEFAULT_MAX_TRIVY_DB_AGE_MS}, ctx);
      if (r.proc) {
        logs.trivy = this.procEvidence(run, leaseId, "SECURITY_TRIVY", r.proc, {commitSha: head, baseSha: base, note: `trivy ${tt.version ?? ""}: ${r.status}${r.reason ? ` ${r.reason}` : ""} db=${r.dbState} blocking=${r.blocking}`.slice(0, 300)});
        if (r.proc.aborted || abort()) return {kind: "CANCEL", reason: this.cancelReason()};
        if (r.transient) return {kind: "RETRY", reason: "SECURITY_TOOL_TRANSIENT_FAILURE"};
      }
      trivy = {status: r.status, ...(r.reason ? {reason: r.reason} : {}), dbState: r.dbState, counts: r.counts, blocking: r.blocking, findings: r.findings, truncated: r.truncated, rawReportSha256: r.rawReportSha256};
    }
    if (abort()) return {kind: "CANCEL", reason: this.cancelReason()};

    const tools = this.securityTools;
    const summary = evaluateSecurityPolicy({baseSha: base, headSha: head, cycle: run.remediationCycle, tools: [toolInfo(tools.gitleaks), toolInfo(tools.trivy), toolInfo(tools.semgrep)], builtinHits, gitleaks, trivy, semgrep: toolInfo(tools.semgrep)});
    const reportObj = {runId: run.runId, cycle: run.remediationCycle, attempt: run.attempt, generatedAt: new Date().toISOString(), summary, toolLogs: logs, note: "Secret values are never recorded; raw gitleaks reports are deleted after parsing and only their sha256 is kept."};
    const bytes = Buffer.from(redactSecrets(JSON.stringify(reportObj, null, 2)) + "\n", "utf8"), file = path.join(secDir, `security-report-${tag}.json`);
    fs.writeFileSync(file, bytes);
    const rel = path.relative(this.o.dataDir, file).split(path.sep).join("/");
    // Journal'daki özet sınırlı tutulur (en fazla 50 zafiyet); tam liste rapor dosyasındadır.
    const evSummary: SecurityStageSummary = {...summary, sca: {...summary.sca, findings: summary.sca.findings.slice(0, 50), truncated: summary.sca.truncated || summary.sca.findings.length > 50}};
    this.evidence(run, leaseId, {kind: "SECURITY_REPORT", argv: [], startedAt, endedAt: new Date().toISOString(), exitCode: summary.status === "BLOCKED" ? 1 : 0, logPath: rel, logSha256: sha256(bytes), baseSha: base, commitSha: head, security: evSummary,
      note: `security=${summary.status}${summary.blockReason ? ` ${summary.blockReason}` : ""}; ${summary.gaps.join(",")}`.slice(0, 500)});
    if (summary.blockReason) return {kind: "BLOCK", reason: summary.blockReason};
    return {kind: "DONE", next: "REVIEW", data: {security: summary.status, gaps: summary.gaps, scaCounts: summary.sca.counts, reportPath: rel, reportSha256: sha256(bytes)}};
  }

  private async freshClone(run: WorkRun, leaseId: string, name = `review-c${run.remediationCycle}`): Promise<string | null> {
    const work = path.join(this.runDir(run.runId), "work"), dir = path.join(this.runDir(run.runId), name);
    await this.rmUnderRun(run.runId, dir);
    if ((await this.gitW(run, leaseId, this.runDir(run.runId), ["clone", "--no-hardlinks", "--quiet", work, dir])).status !== 0) return null;
    if ((await this.gitWOk(run, leaseId, dir, ["checkout", "-q", "--detach", run.headSha!])) === null) return null;
    return (await this.gitOk(dir, ["rev-parse", "HEAD"])) === run.headSha ? dir : null;
  }

  // REVIEW: farklı kimlikli reviewer, üretilen commit'in taze temiz klonunda salt-okunur çalışır; klon değişirse fail-closed BLOCKED.
  private async stepReview(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const reviewer = this.o.executors.reviewer;
    if (reviewer.identity === run.executor.implementer || reviewer.identity !== run.executor.reviewer) return {kind: "BLOCK", reason: "REVIEWER_IDENTITY_MISMATCH"};
    // //TR: Rol atanmış run'ın REVIEW adımı bağlı security-reviewer rolü üzerinden yürür (varsayılan: bağlı UASCO-0252); bağlama yoksa/tam değilse hiçbir review çağrısı yapılmadan BLOCKED. roleId null = eski davranış.
    let reviewerProfile: RoleExecutionProfile | null = null;
    if (run.roleId !== null) {
      try { reviewerProfile = assertRoleExecutes(this.o.reviewerRoleId ?? bindingForFunction("security-reviewer").roleId, "security-reviewer"); } catch (e) { return {kind: "BLOCK", reason: (e as Error).message.slice(0, 200)}; }
    }
    if (!run.baseSha || !run.headSha) return {kind: "BLOCK", reason: "HEAD_COMMIT_MISSING", status: "FAILED"};
    const clone = await this.freshClone(run, leaseId);
    if (!clone) return {kind: "BLOCK", reason: "REVIEW_CLONE_FAILED", status: "FAILED"};
    const diff = await this.diff(run, clone, run.baseSha, run.headSha);
    if (diff === null) return {kind: "BLOCK", reason: "DIFF_UNAVAILABLE", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const testSurface = this.reviewerTestSurface(run);
    // M1a: testler çalıştırılmadıysa reviewer'a açıkça söylenir (istem metni executors.ts reviewPrompt); TEST_SURFACE listesi yine verilir.
    const testExecution = this.testsNotExecuted(run) ? {executed: false as const, reason: "SANDBOX_UNAVAILABLE" as const} : undefined;
    // //TR: Rol atanmış run'da reviewer zaman aşımı = min(run varsayılanı, bağlı security-reviewer limiti); profil run varsayılanını yalnız SIKILAŞTIRIR. (maxFilesWritten 0 aşağıdaki untouched-clone kapısıdır; maxCycles 1 = bu adımda tek review geçişi.) Rolsüz run değişmez.
    const reviewTimeoutMs = reviewerProfile ? effectiveLimits(reviewerProfile.limits, {maxRemediations: this.o.maxRemediations, executorTimeoutMs: this.o.executorTimeoutMs}).executorTimeoutMs : this.o.executorTimeoutMs;
    const r = await this.withChild(run, leaseId, onSpawn => reviewer.review(clone, {...this.missionSpec(run), ...(testSurface ? {testSurface} : {}), ...(testExecution ? {testExecution} : {})}, diff, {timeoutMs: reviewTimeoutMs, shouldAbort: abort, onSpawn, writerEnv: writerEnvFor(run.runId, leaseId), span: fn => this.span(fn)}));
    const untouched = (await this.gitOk(clone, ["rev-parse", "HEAD"])) === run.headSha && (await this.gitOk(clone, ["status", "--porcelain", "--untracked-files=all"])) === "";
    const log = this.writeLog(run, "review", r.log);
    const limit = !r.valid && !r.aborted && !r.timedOut ? executorLimit(r.exitCode, r.log) : null;
    // INT-R4 kompozisyon: REVIEW kanıt notu SBX-8 anlambilimini birebir korur (çalışma alanı değişti -> REVIEW_CLONE_MUTATED; geçersiz -> REVIEW_INVALID <neden>), REL-FX provider kota/hız sınırı notunu (limitNote) ekler. Test yüzeyi reviewer'a ayrıca verilir (reviewer.review) ve VERIFY'de ayrı TEST_SURFACE kanıtı olarak kaydedilir; notta tekrarlanmaz.
    const reviewNote = !untouched ? "REVIEW_CLONE_MUTATED"
      : limit ? limitNote(limit)
      : r.invalidReason ? `REVIEW_INVALID ${r.invalidReason}`.slice(0, 200)
      : "";
    this.evidence(run, leaseId, {kind: "REVIEW", argv: r.argv, startedAt: r.startedAt, endedAt: r.endedAt, exitCode: r.exitCode, timedOut: r.timedOut, ...log, commitSha: run.headSha,
      reviewerIdentity: reviewer.identity, executorIdentity: run.executor.implementer, ...(r.valid ? {verdict: r.verdict, findingsCount: r.findings.length} : {}), ...(reviewNote ? {note: reviewNote} : {})});
    if (reviewerProfile) this.recordAgentTrace(run, leaseId, reviewerProfile, r.aborted ? "ABORTED" : r.valid && untouched ? "COMPLETED" : "FAILED", r, reviewer.identity, r.valid ? ` verdict=${r.verdict}` : " verdict=INVALID");
    if (r.aborted) return {kind: "CANCEL", reason: this.cancelReason()};
    if (!untouched) return {kind: "BLOCK", reason: "REVIEWER_MUTATED_CLONE"};
    // REL-FX: reviewer sağlayıcı kota/hız sınırına çarptıysa BLOCKED(PROVIDER_QUOTA/DISK_FULL), yeniden deneme bütçesi tüketilmez; SBX-8 geçersizlik dalından önce.
    if (limit) return limitBlock(limit);
    // SBX-8: adapter'ın geçersizlik nedeni (profil oturumu yok -> BLOCKED; çalışma alanı değişti -> FAILED) korunur; geçersiz review asla CLEAN değildir.
    if (!r.valid) return r.transient ? {kind: "RETRY", reason: "REVIEW_TRANSIENT_FAILURE"} : {kind: "BLOCK", reason: (r.invalidReason ?? "REVIEW_FAILED").slice(0, 200), status: r.invalidReason?.startsWith("CLAUDE_PROFILE_") ? "BLOCKED" : "FAILED"};
    if (r.verdict === "CLEAN") return {kind: "DONE", next: "REGRESSION", data: {verdict: "CLEAN", reviewerIdentity: reviewer.identity, commitSha: run.headSha}};
    return {kind: "REMEDIATE", reason: "REVIEW_BLOCKED", data: {verdict: "BLOCKED", reviewerIdentity: reviewer.identity}, findings: r.findings.map(f => `${f.severity}: ${f.title}`)};
  }

  // REGRESSION: test komutu reviewer'ın gördüğü commit'in yeni ve temiz bir klonunda yeniden çalışır (yalnız commit'lenmiş içerik).
  private async stepRegression(run: WorkRun, leaseId: string, abort: () => boolean): Promise<Outcome> {
    const clone = await this.freshClone(run, leaseId);
    if (!clone) return {kind: "BLOCK", reason: "REGRESSION_CLONE_FAILED", status: "FAILED"};
    this.renew(run.runId, leaseId);
    const argv = this.testArgv(run);
    if (!argv) return {kind: "BLOCK", reason: "TEST_COMMAND_NOT_CONFIGURED"};
    const gate = await this.authorizeTests("RUNNER_REGRESSION_TESTS");
    // M1a: sandbox yoksa regresyon komutu HİÇ çalışmaz; NOT_EXECUTED kanıtı yazılır ve REPORT'a geçilir (BLOCKED değil, bütçe tüketilmez).
    if (!gate.allowed) { this.sandboxNotExecuted(run, leaseId, "REGRESSION_TESTS", argv, gate); return {kind: "DONE", next: "REPORT", data: {tests: "NOT_EXECUTED", testsReason: gate.reason}}; }
    const r = await this.runTests(gate, argv, clone, abort);
    this.procEvidence(run, leaseId, "REGRESSION_TESTS", r, {commitSha: run.headSha ?? undefined, sandboxProviderId: gate.providerId});
    if (r.aborted) return {kind: "CANCEL", reason: this.cancelReason()};
    if (r.spawnError) return {kind: "BLOCK", reason: "TEST_COMMAND_SPAWN_FAILED"};
    if (r.exitCode === 0) return {kind: "DONE", next: "REPORT", data: {tests: "PASSED"}};
    return {kind: "REMEDIATE", reason: "REGRESSION_FAILED", data: {tests: "FAILED", exitCode: r.exitCode}, findings: [`regression test command exited ${r.exitCode}`]};
  }

  // REPORT: kanıt özeti dosyası + sha256; teslim kararı Founder'da kalır (merge/push/COMPLETE yok).
  private stepReport(run: WorkRun, leaseId: string): Outcome {
    const startedAt = new Date().toISOString();
    const cleanReview = [...run.evidence].reverse().find(e => e.kind === "REVIEW" && e.verdict === "CLEAN");
    const report = {
      runId: run.runId, missionId: run.missionId, projectId: run.projectId, tenantId: run.tenantId, baseSha: run.baseSha, headSha: run.headSha, workBranch: run.workBranch,
      executor: run.executor, review: cleanReview ? {reviewerIdentity: cleanReview.reviewerIdentity, verdict: cleanReview.verdict, commitSha: cleanReview.commitSha} : null,
      remediationCycles: run.remediationCycle, attempt: run.attempt,
      evidence: run.evidence.map(e => ({evidenceId: e.evidenceId, step: e.step, cycle: e.cycle, kind: e.kind, exitCode: e.exitCode, logPath: e.logPath, logSha256: e.logSha256, commitSha: e.commitSha ?? null})),
      deliveryDecision: "PENDING_FOUNDER", delivered: false, note: "No merge, push or COMPLETE transition was performed by the runner."
    };
    // REL-FX-1: bu yüklem COMPLETE kapısıyla paylaşılır (outcomes.ts reviewAndSecurityFor); B3C: güvenlik kanıtı üretilen commit için zorunludur, PARTIAL kapsam Founder'a açıkça bildirilir.
    const rs = reviewAndSecurityFor(run.headSha, run.evidence);
    if (!rs.ok) return {kind: "BLOCK", reason: rs.reason, status: "FAILED"};
    const review = rs.review, secEv = rs.security, sec = secEv.security;
    const ts = this.reviewerTestSurface(run);
    const notExecuted = this.testsNotExecuted(run);
    // M1a: rapor, testlerin sandbox yokluğundan çalıştırılmadığını ve sonucun NOT_VERIFIED olduğunu açıkça taşır (kanıttan türetilir).
    // M1a c2: ürün doğrulaması ekseni (productVerification) aynı saf yüklemden gelir; kaynak üretimi ekseni REPORT kanıtından sonra türetilir ve rapora yazılmaz.
    const pv = productVerificationOf(run.headSha, run.evidence);
    (report as Record<string, unknown>).testExecution = notExecuted
      ? {testsExecuted: false, notExecutedReason: "SANDBOX_UNAVAILABLE", functionalAcceptance: "NOT_EXECUTED", productVerification: pv.state, productVerificationReason: pv.reason, label: M1A_NOT_VERIFIED_LABEL}
      : {testsExecuted: run.evidence.some(e => (e.kind === "VERIFY_TESTS" || e.kind === "REGRESSION_TESTS") && e.commitSha === run.headSha), notExecutedReason: null, functionalAcceptance: ts?.functionalAcceptance ?? "UNKNOWN", productVerification: pv.state, productVerificationReason: pv.reason, label: pv.label};
    (report as Record<string, unknown>).testSurface = ts ? {functionalAcceptance: ts.functionalAcceptance, reason: ts.reason, deleted: ts.deleted, weakened: ts.weakened, added: ts.added, modified: ts.modified, executedTests: ts.executedTests} : null;
    (report as Record<string, unknown>).security = {status: sec.status, founderNotice: sec.founderNote, gaps: sec.gaps, secrets: {builtin: sec.secrets.builtin.status, gitleaks: sec.secrets.gitleaks.status}, sca: {status: sec.sca.status, reason: sec.sca.reason ?? null, dbState: sec.sca.dbState ?? null, counts: sec.sca.counts}, sast: sec.sast, sbom: sec.sbom, tools: sec.tools, evidenceId: secEv.evidenceId, reportLogPath: secEv.logPath, reportLogSha256: secEv.logSha256};
    const file = path.join(this.runDir(run.runId), "report.json"), bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n", "utf8");
    fs.writeFileSync(file, bytes);
    const rel = path.relative(this.o.dataDir, file).split(path.sep).join("/");
    this.evidence(run, leaseId, {kind: "REPORT", argv: [], startedAt, endedAt: new Date().toISOString(), exitCode: 0, logPath: rel, logSha256: sha256(bytes), commitSha: run.headSha ?? undefined, reviewerIdentity: review.reviewerIdentity, verdict: "CLEAN", note: `security=${sec.status}`});
    const approval = ["DELIVERY_DECISION_PENDING_FOUNDER", ...(sec.status === "PARTIAL" ? ["SECURITY_COVERAGE_PARTIAL"] : []), ...(notExecuted ? ["TESTS_NOT_EXECUTED_SANDBOX_UNAVAILABLE"] : [])];
    return {kind: "DONE", next: "FINISHED", data: {reportPath: rel, reportSha256: sha256(bytes), security: sec.status, ...(notExecuted ? {tests: "NOT_EXECUTED"} : {})}, ...(approval.length > 1 ? {approvalReason: approval.join("; ")} : {})};
  }
}
