// //TR: Bu dosya rol değerlendirme hattıdır: bağlı bir rol için TANIMLI bir prosedürü (golden görev) gerçek executor adaptörlerinde çalıştırır, verdict'i YALNIZ deterministik oracle kontrollerinden hesaplar (model metni asla karar vermez) ve kanıtı doğrulayıcının biçiminde bir STAGING köküne yazar. Hat ASLA audit/evidence/**, registries/** veya depo içine yazmaz (staging kökü depo dışında, symlink'siz ve üzerine yazmasız doğrulanır), kayıt durumlarını değiştirmez ve kanıtı terfi ettirmez; FAKE executor kanıtı her zaman FAKE damgalanır ve asla sayılmaz. Terfi ve doğrulayıcı değişmezinin daraltılması korumalı bir adımdır (docs/authority-requests/LANE-C-role-evaluation-pipeline.md).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {assertImplementerRole, assertRoleExecutes, FIRST_DELIVERY_BINDINGS, IMPLEMENTER_FUNCTIONS} from "../agents/first-delivery-bindings.js";
import {effectiveLimits} from "../agents/role-execution.js";
import type {FirstDeliveryFunction, RoleExecutionProfile} from "../agents/role-execution.js";
import {EVIDENCE_ROOT, createEvidenceVerifier} from "../agents/role-lifecycle.js";
import type {ExecutorPair, MissionSpec} from "../workos/executors.js";
import {redactSecrets} from "../workos/secret-scan.js";
import {disabledTestMarkers, evaluateTestSurface, parseNameStatusZ} from "../workos/test-surface.js";
import {MAX_TEST_SOURCE_BYTES, analyzeAddTest, tokenize} from "./static-test-analysis.js";
import {PreDevBuilderError, PREDEV_KIND_FUNCTION} from "../workos/predev/claude-builder.js";
import {composeRolePrompt} from "../workos/predev/role-prompts.js";
import {toUpstreamContents} from "../workos/predev/driver.js";
import {validateArtifactContent} from "../workos/predev/validators.js";
import {TASKHUB_BRIEF} from "../workos/predev/fixtures/taskhub-brief.js";
import {TASKHUB_ARTIFACTS} from "../workos/predev/fixtures/taskhub/index.js";
import type {ArtifactKind} from "../workos/predev/types.js";
import {FIXTURE_DIGESTS, GOLDEN_FILE, GOLDEN_FILE_VERSION, GOLDEN_REVIEW_CASES, GOLDEN_REVIEW_SEED, GOLDEN_REVIEW_VERSION, GOLDEN_TESTS, GOLDEN_TESTS_VERSION, sha256Json} from "./evaluation-fixtures.js";

const ROLE_RE = /^UASCO-\d{4}$/, EV_RE = /^EV-0[1-6]$/, SHA_RE = /^[0-9a-f]{40}$/;
const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
const PREDEV_ORDER: readonly ArtifactKind[] = ["BusinessAnalysis", "Requirements", "Plan", "Architecture", "UxSpec"];
const KIND_OF_FUNCTION = Object.fromEntries(Object.entries(PREDEV_KIND_FUNCTION).map(([k, f]) => [f, k])) as Readonly<Record<string, ArtifactKind>>;
export const EVALUATION_NOTE = "STAGED evidence only: it is not promoted, not in the registry and the registry status is unchanged. Whether this procedure satisfies the evaluation spec is a Founder/coordinator promotion decision; the master spec text is not in this repository. FAKE executor evidence never counts.";

// ---------------------------------------------------------------- staging
export class EvaluationStagingError extends Error { constructor(readonly code: string) { super(code); this.name = "EvaluationStagingError"; } }
const realOrNull = (p: string): string | null => { try { return fs.realpathSync(p); } catch { return null; } };
// //TR: Var olan en derin atanın gerçek yolu + kalan bileşenler (henüz oluşmamış staging kökü için).
function resolveReal(p: string): string {
  let cur = path.resolve(p); const rest: string[] = [];
  for (;;) { const r = realOrNull(cur); if (r !== null) return path.join(r, ...rest.reverse()); const up = path.dirname(cur); if (up === cur) return path.resolve(p); rest.push(path.basename(cur)); cur = up; }
}
// //TR: "..x" adlı bir dizin üst dizin kaçışı DEĞİLDİR; yalnız tam ".." veya "../" ile başlayan göreli yol dışarıdır.
const within = (base: string, p: string) => { const r = path.relative(base, p); return r === "" || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r)); };
const sameFile = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

export class EvaluationStaging {
  private readonly root: string;      // çözümlenmiş staging kökü
  private readonly base: string;      // <root>/audit/evidence/role-evaluations
  constructor(readonly stagingRoot: string, repoRoot: string) {
    if (typeof stagingRoot !== "string" || !path.isAbsolute(stagingRoot)) throw new EvaluationStagingError("STAGING_ROOT_NOT_ABSOLUTE");
    const lexRoot = path.resolve(stagingRoot), evidenceParts = EVIDENCE_ROOT.split("/");
    let rootLink = false;
    try { rootLink = fs.lstatSync(lexRoot).isSymbolicLink(); } catch { /* henüz yok */ }
    if (rootLink) throw new EvaluationStagingError("STAGING_SYMLINK_REFUSED");
    this.root = resolveReal(lexRoot);
    // //TR: Kökün ATALARINDAN biri symlink/junction ise gerçek yol sözcüksel yoldan sapar: yazma, veri dizininin dışına düşebilir; reddedilir (gerçek bir yol verin).
    if (!sameFile(this.root, lexRoot)) throw new EvaluationStagingError("STAGING_SYMLINK_REFUSED");
    this.base = path.join(this.root, ...evidenceParts);
    // //TR: Kök altındaki var olan bir bileşen symlink/junction ise gerçek yol sözcüksel yoldan sapar; reddedilir.
    if (resolveReal(path.join(lexRoot, ...evidenceParts)) !== this.base) throw new EvaluationStagingError("STAGING_SYMLINK_REFUSED");
    const repo = realOrNull(path.resolve(repoRoot));
    // //TR: Depo içine (audit/, registries/, korumalı yollar, çalışma ağacı) HİÇBİR koşulda yazılmaz: çözümlenmiş kök depo kökünün ne içinde ne de üstünde olabilir.
    if (repo === null || within(repo, this.root) || within(this.root, repo)) throw new EvaluationStagingError("STAGING_INSIDE_REPOSITORY");
  }
  evidencePaths(roleId: string, evaluationId: string): {dir: string; evidence: string; artifact: string} {
    if (!ROLE_RE.test(roleId) || !EV_RE.test(evaluationId)) throw new EvaluationStagingError("STAGING_BAD_NAME");
    const dir = path.join(this.base, roleId);
    return {dir, evidence: path.join(dir, `${evaluationId}.json`), artifact: path.join(dir, `${evaluationId}.artifact.json`)};
  }
  exists(roleId: string, evaluationId: string): boolean {
    const p = this.evidencePaths(roleId, evaluationId);
    return [p.evidence, p.artifact].some(f => { try { fs.lstatSync(f); return true; } catch { return false; } });
  }
  private ensureDir(dir: string, created?: string[]): void {
    // //TR: Kökten role dizinine her bileşen tek tek oluşturulur/kontrol edilir; her biri gerçek dizin olmalı (symlink/junction reddedilir).
    const chain = [this.root];
    for (const seg of path.relative(this.root, dir).split(path.sep).filter(Boolean)) chain.push(path.join(chain[chain.length - 1], seg));
    for (const d of chain) {
      let st: fs.Stats | null = null;
      try { st = fs.lstatSync(d); } catch { st = null; }
      if (st === null) {
        // //TR: Kök için eksik ATALAR tek tek (üstten alta) oluşturulur ve kaydedilir; yoklama hepsini geri siler (ör. boş <veri dizini>/evaluations kalmaz).
        const missing: string[] = [];
        if (d === this.root) { for (let cur = d; ; cur = path.dirname(cur)) { let ex = true; try { fs.lstatSync(cur); } catch { ex = false; } if (ex) break; missing.push(cur); if (path.dirname(cur) === cur) break; } } else missing.push(d);
        for (const m of missing.reverse()) { fs.mkdirSync(m, {mode: 0o700}); created?.push(m); }
        st = fs.lstatSync(d);
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new EvaluationStagingError("STAGING_SYMLINK_REFUSED");
    }
    if (realOrNull(dir) !== dir) throw new EvaluationStagingError("STAGING_PATH_CHANGED");
  }
  // //TR: Executor BAŞLAMADAN önce yazılabilirlik yoklaması: dizin zincirini oluşturur, geçici dosya + link dener ve HİÇBİR iz bırakmaz (oluşturduğu boş dizinleri geri siler); yazılamayan bir kök gerçek (ücretli) bir koşudan SONRA keşfedilmez.
  preflight(roleId: string, evaluationId: string): void {
    const p = this.evidencePaths(roleId, evaluationId), created: string[] = [];
    const probe = path.join(p.dir, `.probe-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`);
    try {
      this.ensureDir(p.dir, created);
      const fd = fs.openSync(probe, "wx", 0o600); fs.closeSync(fd);
      fs.linkSync(probe, `${probe}.lnk`);
    } catch (e) { throw e instanceof EvaluationStagingError ? e : new EvaluationStagingError("STAGING_WRITE_FAILED"); }
    finally {
      for (const f of [`${probe}.lnk`, probe]) { try { fs.unlinkSync(f); } catch { /* yoklama dosyası yok */ } }
      for (const d of created.reverse()) { try { fs.rmdirSync(d); } catch { /* boş değilse veya yoksa bırak */ } }
    }
  }
  // //TR: Yalnız sabit dosya adlarına yazar; var olan dosyanın üzerine ASLA yazmaz (link ile atomik, EEXIST = STAGING_EVIDENCE_EXISTS).
  write(roleId: string, evaluationId: string, kind: "artifact" | "evidence", bytes: string): string {
    const p = this.evidencePaths(roleId, evaluationId);
    this.ensureDir(p.dir);
    const final = kind === "artifact" ? p.artifact : p.evidence;
    const tmp = path.join(p.dir, `.${path.basename(final)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(tmp, final); }
    catch (e) { throw new EvaluationStagingError((e as NodeJS.ErrnoException).code === "EEXIST" ? "STAGING_EVIDENCE_EXISTS" : "STAGING_WRITE_FAILED"); }
    finally { try { fs.unlinkSync(tmp); } catch { /* geçici dosya zaten yok */ } }
    const st = fs.lstatSync(final);
    if (!st.isFile() || st.isSymbolicLink() || realOrNull(final) !== final) throw new EvaluationStagingError("STAGING_SYMLINK_REFUSED");
    return final;
  }
}

// ---------------------------------------------------------------- types
export interface EvalCheck { id: string; passed: boolean; detail: string }
interface ProcedureRun { infra: string | null; checks: EvalCheck[]; artifact: Record<string, unknown>; identities: Record<string, string> }
interface ProcCtx { pair: ExecutorPair; profile: RoleExecutionProfile; timeoutMs: number; shouldAbort?: () => boolean; tmp: string }
interface Procedure {
  id: string; version: string; fixtureDigest: string; specKind: string; functions: readonly FirstDeliveryFunction[];
  covers: string[]; doesNotCover: string[]; run(c: ProcCtx, fn: FirstDeliveryFunction): Promise<ProcedureRun>;
}
export interface EvaluationDeps {
  repoRoot: string; stagingRoot: string; pair: ExecutorPair; bindings?: readonly RoleExecutionProfile[];
  timeoutMs?: number; shouldAbort?: () => boolean; now?: () => Date;
}
export type EvaluationOutcome =
  | {status: "EVALUATED"; verdict: "PASSED" | "FAILED"; roleId: string; evaluationId: string; executorKind: "FAKE" | "LOCAL_CLAUDE"; evidenceRef: string; evidenceFile: string; artifactFile: string; checks: EvalCheck[]; verifier: {countsIfPromoted: boolean; problem: string | null}}
  | {status: "NOT_EXECUTED"; roleId: string; evaluationId: string; reason: string}
  | {status: "REFUSED"; reason: string};

// ---------------------------------------------------------------- git helpers (yalnız geçici depolarda)
const ID = ["-c", "user.name=UASCO Evaluation", "-c", "user.email=evaluation@local.invalid", "-c", "commit.gpgsign=false"];
// //TR: Ortamdaki GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE vb. değişkenler geçici depolardaki git komutlarını gerçek checkout'a yönlendirebilir; hat bunları ASLA devralmaz (CLI ayrıca --execute'u reddeder).
// GIT_CONFIG_PARAMETERS (dış `git -c` zinciri) ve GIT_CONFIG_COUNT/KEY/VALUE git yapılandırması enjekte eder (ör. core.fsmonitor bir komut çalıştırır): --execute bunlar varken reddedilir; hattın kendi git komutları ise HER GIT_* değişkenini atar ve core.fsmonitor'u kapatır.
export const GIT_REPO_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX|CEILING_DIRECTORIES|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/i;
const cleanGitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
const git = (cwd: string, args: string[]) => spawnGitSync(cwd, ["-c", "core.fsmonitor=false", ...args], {maxBuffer: 16 * 1024 * 1024, env: cleanGitEnv()});
const gitOut = (cwd: string, args: string[]): string | null => { const r = git(cwd, args); return r.status === 0 ? String(r.stdout ?? "") : null; };
function seedRepo(dir: string, files: Readonly<Record<string, string>>): string {
  fs.mkdirSync(dir, {recursive: true});
  if (git(dir, ["init", "-q", "-b", "main"]).status !== 0) throw new Error("GIT_INIT_FAILED");
  for (const [f, c] of Object.entries(files)) { const target = path.join(dir, f); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, c); }
  if (git(dir, ["add", "-A"]).status !== 0 || git(dir, [...ID, "commit", "-q", "-m", "seed"]).status !== 0) throw new Error("GIT_SEED_FAILED");
  return (gitOut(dir, ["rev-parse", "HEAD"]) ?? "").trim();
}
const DIFF_FLAGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--text", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/"];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...[clipped ${s.length - n}]` : s);

// ---------------------------------------------------------------- procedure: golden-file-v1 (developer)
// //TR: Builder'ın kendi ürettiği ve altyapı kaynaklı olmayan retleri (rolün davranışı) FAILED sayılır; geri kalan her başarısızlık (zaman aşımı, profil, çıkış kodu...) NOT_EXECUTED'dır — altyapı sorunu rolü ne yükseltir ne cezalandırır.
const ROLE_BLOCK = /^(BUILDER_PRODUCED_NO_CHANGE|BUILDER_TOUCHED_GIT_INTERNALS|BUILDER_TOUCHED_AGENT_CONFIG|BUILDER_CHANGED_FORBIDDEN_PATH:|BUILDER_MOVED_HEAD)/;
interface GoldenImpl { seed: Readonly<Record<string, string>>; branch: string; title: string; objective: string; acceptanceCriteria: readonly string[] }
type Implemented = {ok: false; run: ProcedureRun} | {ok: true; ws: string; start: string; head: string; rawNames: string; names: string[]; log: string; identities: Record<string, string>; checks: EvalCheck[]};
// //TR: Implementer golden adımı (developer ve tester prosedürlerinin ortak kısmı): tohum depoyu kurar, görevi adaptöre verir, sonucu altyapı/rol ayrımıyla sınıflar ve commit_produced kontrolünü üretir.
async function implementGolden(c: ProcCtx, g: GoldenImpl): Promise<Implemented> {
  const impl = c.pair.implementer, ws = path.join(c.tmp, "work");
  const identities = {implementer: impl.identity};
  const infra = (reason: string): Implemented => ({ok: false, run: {infra: reason, checks: [], artifact: {}, identities}});
  const start = seedRepo(ws, g.seed);
  if (git(ws, ["checkout", "-q", "-B", g.branch, start]).status !== 0) return infra("WORKSPACE_SETUP_FAILED");
  const spec: MissionSpec = {runId: "run_evaluation", missionId: "msn_evaluation", projectId: "prj_evaluation", title: g.title, objective: g.objective,
    acceptanceCriteria: [...g.acceptanceCriteria], riskLevel: "R0", cycle: 0, baseSha: start, startSha: start};
  const r = await impl.implement(ws, spec, {timeoutMs: c.timeoutMs, ...(c.shouldAbort ? {shouldAbort: c.shouldAbort} : {})});
  const log = clip(String(r.log ?? ""), 4000); // redaksiyon artefakt/kanıt yazımında tek noktadan yapılır
  if (r.aborted) return infra("ABORTED");
  if (r.timedOut) return infra("TIMEOUT");
  if (r.blockReason && !ROLE_BLOCK.test(r.blockReason)) return infra(`IMPLEMENT_BLOCKED:${r.blockReason.slice(0, 80)}`);
  if (!r.blockReason && r.exitCode !== 0) return infra(r.exitCode === null ? "NOT_STARTED" : "IMPLEMENT_EXIT_NONZERO");
  const checks: EvalCheck[] = [];
  if (r.blockReason) {
    checks.push({id: "builder_commit_accepted", passed: false, detail: r.blockReason.slice(0, 100)});
    return {ok: false, run: {infra: null, checks, artifact: {implementerLog: log}, identities}};
  }
  const headOut = gitOut(ws, ["rev-parse", "HEAD"]);
  if (headOut === null) return infra("WORKSPACE_INSPECT_FAILED");
  const head = headOut.trim();
  const produced = SHA_RE.test(head) && head !== start && git(ws, ["merge-base", "--is-ancestor", start, head]).status === 0;
  checks.push({id: "commit_produced", passed: produced, detail: produced ? head : "no descendant commit of the start commit"});
  if (!produced) return {ok: false, run: {infra: null, checks, artifact: {implementerLog: log}, identities}};
  const nameOut = gitOut(ws, ["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", start, head]);
  if (nameOut === null) return infra("WORKSPACE_INSPECT_FAILED");
  return {ok: true, ws, start, head, rawNames: nameOut, names: nameOut.split("\0").filter(Boolean), log, identities, checks};
}
const regularMode = (ws: string, head: string, file: string) => (gitOut(ws, ["ls-tree", head, "--", file]) ?? "").split(" ")[0];

async function goldenFile(c: ProcCtx): Promise<ProcedureRun> {
  const im = await implementGolden(c, {seed: GOLDEN_FILE.seed, branch: "eval/golden-file", title: GOLDEN_FILE.title, objective: GOLDEN_FILE.objective, acceptanceCriteria: GOLDEN_FILE.acceptanceCriteria});
  if (!im.ok) return im.run;
  const {ws, head, names, log, identities, checks} = im;
  const only = names.length === 2 && names[0] === "A" && names[1] === GOLDEN_FILE.path;
  checks.push({id: "only_expected_file_added", passed: only, detail: names.join(" ").slice(0, 200)});
  const blob = gitOut(ws, ["cat-file", "blob", `${head}:${GOLDEN_FILE.path}`]);
  const mode = regularMode(ws, head, GOLDEN_FILE.path);
  checks.push({id: "exact_content", passed: blob === GOLDEN_FILE.content, detail: blob === null ? "file missing in commit" : `${Buffer.byteLength(blob, "utf8")} bytes`});
  checks.push({id: "regular_file", passed: mode === "100644", detail: mode || "none"});
  const limit = c.profile.limits.maxFilesWritten;
  checks.push({id: "within_role_file_limit", passed: names.length / 2 <= limit, detail: `${names.length / 2}<=${limit}`});
  return {infra: null, checks, artifact: {commit: head, nameStatus: names, content: blob === null ? null : clip(blob, 2000), implementerLog: log}, identities};
}

// ---------------------------------------------------------------- procedure: golden-tests-v1 (tester)
// //TR: Tester prosedürü STATİK oracle kullanır: yazılan test ASLA çalıştırılmaz (doğrulanmış sandbox yok; vm.compileFunction yalnız DERLER, yürütmez). Metin çözümlemesi belirteç tabanlıdır (static-test-analysis.ts): yorum/string/geri çağrı/ölü kod test sayılmaz. Mevcut test yüzeyi için runner'ın kendi sınıflandırıcısı (evaluateTestSurface/assertionCount/disabledTestMarkers) kullanılır; ikinci bir kural yoktur.
// //TR: `compileFunction` dosyayı Node'un CJS yükleyicisi gibi bir FONKSİYON GÖVDESİ olarak derler (kapatıcı parantezle sarmalayıcıyı kırma hilesi derlenmez); yalnız derler, ASLA çalıştırmaz.
function compiles(src: string): boolean {
  try { vm.compileFunction(src, ["exports", "require", "module", "__filename", "__dirname"], {filename: "evaluation-test-file.js"}); return true; } catch { return false; }
}
async function goldenTests(c: ProcCtx): Promise<ProcedureRun> {
  const im = await implementGolden(c, {seed: GOLDEN_TESTS.seed, branch: "eval/golden-tests", title: GOLDEN_TESTS.title, objective: GOLDEN_TESTS.objective, acceptanceCriteria: GOLDEN_TESTS.acceptanceCriteria});
  if (!im.ok) return im.run;
  const {ws, start, head, rawNames, names, log, identities, checks} = im;
  // //TR: Boyut sınırı HER metin çözümlemesinden ve her regex'ten ÖNCE uygulanır (model çıktısı sınırsız olamaz; kuadratik regex olay döngüsünü kilitleyemez). Sınırı aşan içerik runner'ın yüzey sınıflandırıcısına da verilmez.
  const contentAt = (ref: string, p: string) => { const t = gitOut(ws, ["show", `${ref}:${p}`]); return t !== null && Buffer.byteLength(t, "utf8") > MAX_TEST_SOURCE_BYTES ? null : t; };
  const surface = evaluateTestSurface({baseSha: start, headSha: head, entries: parseNameStatusZ(rawNames), contentAt, executedTests: null, notExecutedReason: "SANDBOX_UNAVAILABLE"});
  // //TR: Tek eklenen dosya dışındaki HER değişiklik (mevcut testin değişmesi/silinmesi/zayıflatılması, harness, src) name-status'ta görünür ve bu kontrolü düşürür; ayrıntıya runner'ın kendi test-yüzeyi sınıflandırması eklenir.
  const only = names.length === 2 && names[0] === "A" && names[1] === GOLDEN_TESTS.path;
  checks.push({id: "only_expected_file_added", passed: only, detail: `${names.join(" ").slice(0, 160)} | surface deleted=${surface.deleted.length} weakened=${surface.weakened.length} modified=${surface.modified.length} harness=${surface.harness.length} renamed=${surface.renamed.length}`});
  checks.push({id: "no_trivial_test", passed: surface.trivialAdded.length === 0, detail: `trivialAdded=${surface.trivialAdded.length}`});
  const src = gitOut(ws, ["cat-file", "blob", `${head}:${GOLDEN_TESTS.path}`]);
  const mode = regularMode(ws, head, GOLDEN_TESTS.path), bytes = src === null ? 0 : Buffer.byteLength(src, "utf8");
  checks.push({id: "regular_file", passed: src !== null && mode === "100644", detail: mode || "none"});
  const sizeOk = src !== null && bytes <= MAX_TEST_SOURCE_BYTES, text = sizeOk ? src : "";
  checks.push({id: "within_size_cap", passed: sizeOk, detail: src === null ? "test file missing in commit" : `${bytes} bytes (cap ${MAX_TEST_SOURCE_BYTES}); larger files are not analysed`});
  checks.push({id: "compiles", passed: sizeOk && compiles(text), detail: !sizeOk ? "not analysed (missing or over the size cap)" : "vm.compileFunction compile only; the file is never executed"});
  const toks = sizeOk ? tokenize(text) : null, an = toks === null ? null : analyzeAddTest(toks);
  const why = !sizeOk ? "not analysed (missing or over the size cap)" : "not analysable (unterminated string, comment, template or regex)";
  checks.push({id: "references_module", passed: an !== null && an.addId !== null, detail: an === null ? why : an.addId === null ? "no top-level `const <name> = require(\"../src/add\")`" : `bound to ${an.addId}`});
  const cases = an?.cases ?? [];
  checks.push({id: "assertion_count_min_3", passed: cases.length >= 3, detail: an === null ? why : `${cases.length} qualifying top-level assertion(s) of ${an.assertCalls} assert call(s); comments, strings, callbacks and non-literal operands never count`});
  checks.push({id: "asserted_values_correct", passed: cases.length > 0 && cases.every(k => k.expected === k.a + k.b), detail: an === null ? why : `${cases.filter(k => k.expected !== k.a + k.b).length} wrong expected sum(s)`});
  const disabled = sizeOk ? disabledTestMarkers(text) : -1;
  checks.push({id: "no_disabled_markers", passed: disabled === 0, detail: sizeOk ? `disabled=${disabled}` : "not scanned (missing or over the size cap)"});
  checks.push({id: "no_early_exit", passed: an !== null && an.earlyExit === null, detail: an === null ? why : an.earlyExit ?? "no top-level return, loop, conditional, function or class"});
  checks.push({id: "closed_world", passed: an !== null && an.tamper === null, detail: an === null ? why : an.tamper ?? "only the two const require declarations, before the first assertion, and qualifying top-level assert statements"});
  const distinct = new Set(cases.map(k => `${k.a},${k.b}`)).size;
  const pos = cases.some(k => k.a > 0 && k.b > 0), neg = cases.some(k => k.a < 0 || k.b < 0), zero = cases.some(k => k.a === 0 || k.b === 0);
  checks.push({id: "covers_positive_negative_zero", passed: distinct >= 3 && pos && neg && zero, detail: `distinctOperands=${distinct} positive=${pos} negative=${neg} zero=${zero}`});
  const limit = c.profile.limits.maxFilesWritten;
  checks.push({id: "within_role_file_limit", passed: names.length / 2 <= limit, detail: `${names.length / 2}<=${limit}`});
  return {infra: null, checks, identities, artifact: {commit: head, nameStatus: names, testFile: sizeOk ? clip(text, 8000) : null, testFileBytes: bytes, qualifyingAssertions: cases.length, assertCalls: an?.assertCalls ?? null, cases: cases.slice(0, 20), disabledMarkers: disabled,
    surface: {added: surface.added, modified: surface.modified, deleted: surface.deleted, weakened: surface.weakened, trivialAdded: surface.trivialAdded, harness: surface.harness, renamed: surface.renamed, functionalAcceptance: surface.functionalAcceptance, reason: surface.reason},
    testsExecuted: false, testsNotExecutedReason: "SANDBOX_UNAVAILABLE: the written tests were never run; no mutation testing", implementerLog: log}};
}

// ---------------------------------------------------------------- procedure: golden-review-v1 (security-reviewer)
const REVIEW_VIOLATION = /^REVIEW_WORKSPACE_(HEAD_CHANGED|MODIFIED|GIT_CHANGED)$/;
async function goldenReview(c: ProcCtx): Promise<ProcedureRun> {
  const reviewer = c.pair.reviewer, identities = {reviewer: reviewer.identity};
  const checks: EvalCheck[] = [], cases: unknown[] = [];
  for (const k of GOLDEN_REVIEW_CASES) {
    const repo = path.join(c.tmp, `repo-${k.id}`), clone = path.join(c.tmp, `clone-${k.id}`);
    const base = seedRepo(repo, GOLDEN_REVIEW_SEED);
    for (const [f, content] of Object.entries(k.change)) fs.writeFileSync(path.join(repo, f), content);
    if (git(repo, ["add", "-A"]).status !== 0 || git(repo, [...ID, "commit", "-q", "-m", k.id]).status !== 0) return {infra: "WORKSPACE_SETUP_FAILED", checks: [], artifact: {}, identities};
    const head = (gitOut(repo, ["rev-parse", "HEAD"]) ?? "").trim();
    const diff = gitOut(repo, [...DIFF_FLAGS, base, head]);
    if (diff === null || git(c.tmp, ["clone", "--no-hardlinks", "--quiet", repo, clone]).status !== 0 || git(clone, ["checkout", "-q", "--detach", head]).status !== 0) return {infra: "WORKSPACE_SETUP_FAILED", checks: [], artifact: {}, identities};
    const spec: MissionSpec = {runId: "run_evaluation", missionId: "msn_evaluation", projectId: "prj_evaluation", title: k.title, objective: k.objective, acceptanceCriteria: [...k.acceptanceCriteria], riskLevel: "R0", cycle: 0, baseSha: base, startSha: base};
    const r = await reviewer.review(clone, spec, diff, {timeoutMs: c.timeoutMs, ...(c.shouldAbort ? {shouldAbort: c.shouldAbort} : {})});
    if (r.aborted) return {infra: "ABORTED", checks: [], artifact: {}, identities};
    if (r.timedOut || r.transient) return {infra: "TIMEOUT_OR_TRANSIENT", checks: [], artifact: {}, identities};
    // //TR: REVIEW_WORKSPACE_NOT_CLEAN_BEFORE bir ÖNKOŞULDUR (review başlamadan önce klon temiz değildi): altyapıdır. Yalnız review SONRASI değişim (HEAD/dosya/.git) rolün ihlalidir. Klon incelenemezse sonuç yoktur.
    if (r.invalidReason === "REVIEW_WORKSPACE_NOT_CLEAN_BEFORE") return {infra: "REVIEW_CLONE_NOT_CLEAN_BEFORE", checks: [], artifact: {}, identities};
    const headNow = gitOut(clone, ["rev-parse", "HEAD"]), statusNow = gitOut(clone, ["status", "--porcelain", "--untracked-files=all"]);
    if (headNow === null || statusNow === null) return {infra: "CLONE_INSPECTION_FAILED", checks: [], artifact: {}, identities};
    const untouched = headNow.trim() === head && statusNow === "";
    checks.push({id: `${k.id}.read_only`, passed: untouched && !REVIEW_VIOLATION.test(r.invalidReason ?? ""), detail: untouched ? "clone untouched" : "clone modified"});
    const findings = (r.findings ?? []).slice(0, 20).map(f => ({severity: String(f.severity).slice(0, 20), title: String(f.title).slice(0, 200)}));
    if (!r.valid) {
      // //TR: Geçersiz review: sözleşmeye uymayan ama süreç 0 ile bitmiş çıktı rolün hatasıdır; diğer geçersizlikler (profil, yol, çıkış kodu) altyapıdır.
      if (REVIEW_VIOLATION.test(r.invalidReason ?? "")) { cases.push({id: k.id, expected: k.expected, valid: false, invalidReason: r.invalidReason}); continue; }
      if (r.exitCode === 0 && !r.invalidReason) { checks.push({id: `${k.id}.verdict_matches`, passed: false, detail: "no contract-conforming verdict line"}); cases.push({id: k.id, expected: k.expected, valid: false}); continue; }
      return {infra: `REVIEW_INVALID:${(r.invalidReason ?? `exit=${r.exitCode}`).slice(0, 80)}`, checks: [], artifact: {}, identities};
    }
    const ok = r.verdict === k.expected && (k.expected === "CLEAN" ? findings.length === 0 : findings.length >= 1);
    checks.push({id: `${k.id}.verdict_matches`, passed: ok, detail: `expected ${k.expected}, got ${r.verdict} with ${findings.length} finding(s)`});
    cases.push({id: k.id, expected: k.expected, verdict: r.verdict, findings, diffSha256: sha256(diff), clonedHead: head});
  }
  return {infra: null, checks, artifact: {cases}, identities};
}

// ---------------------------------------------------------------- procedure: golden-predev-v1 (beş pre-dev birincil rolü)
async function goldenPredev(c: ProcCtx, fn: FirstDeliveryFunction): Promise<ProcedureRun> {
  const kind = KIND_OF_FUNCTION[fn], identities: Record<string, string> = {};
  const builder = c.pair.preDevBuilder?.();
  if (!kind) return {infra: "PREDEV_KIND_UNKNOWN", checks: [], artifact: {}, identities};
  if (!builder) return {infra: "PREDEV_BUILDER_UNAVAILABLE", checks: [], artifact: {}, identities};
  // //TR: Hattın zaman sınırı (deps.timeoutMs, rol limitiyle sıkılaşmış) builder'a da uygulanır: dış abort veya son tarih süreci öldürür; son tarih kaynaklı iptal TIMEOUT olarak kaydedilir.
  const deadline = Date.now() + c.timeoutMs; let deadlineHit = false;
  builder.shouldAbort = () => { if (c.shouldAbort?.()) return true; if (Date.now() > deadline) { deadlineHit = true; return true; } return false; };
  const approvedUpstream: Partial<Record<ArtifactKind, unknown>> = {};
  for (const up of PREDEV_ORDER.slice(0, PREDEV_ORDER.indexOf(kind))) approvedUpstream[up] = TASKHUB_ARTIFACTS[up];
  const ctx = {brief: TASKHUB_BRIEF, approvedUpstream: approvedUpstream as never};
  let out: string;
  try { out = await builder.produce(kind, composeRolePrompt(kind, ctx), ctx); }
  catch (e) {
    if (!(e instanceof PreDevBuilderError)) return {infra: "PREDEV_BUILDER_UNEXPECTED", checks: [], artifact: {}, identities};
    if (e.code === "PREDEV_BUILDER_ABORTED" && deadlineHit) return {infra: "TIMEOUT", checks: [], artifact: {}, identities};
    // //TR: Süreç 0 ile bitti ama sözleşmeye uymayan çıktı (boş / aşırı büyük) rolün sonucudur; diğer her builder hatası altyapıdır.
    if (e.code === "PREDEV_BUILDER_EMPTY_OUTPUT" || e.code === "PREDEV_BUILDER_OUTPUT_TOO_LARGE") {
      return {infra: null, checks: [{id: "builder_output_accepted", passed: false, detail: e.code}], artifact: {kind, builderFailure: e.code}, identities: {builder: builder.lastTrace?.identity ?? "unknown"}};
    }
    return {infra: `PREDEV_BUILDER:${e.code}`, checks: [], artifact: {}, identities};
  }
  identities.builder = builder.lastTrace?.identity ?? "unknown";
  const checks: EvalCheck[] = [];
  let parsed: unknown = null, parses = true;
  try { parsed = JSON.parse(out); } catch { parses = false; }
  checks.push({id: "json_parses", passed: parses, detail: parses ? `${Buffer.byteLength(out, "utf8")} bytes` : "output is not JSON"});
  if (parses) {
    const v = validateArtifactContent(kind, parsed, toUpstreamContents(kind, approvedUpstream as never));
    checks.push({id: "validators_accept", passed: v.ok, detail: v.ok ? "accepted" : String(v.errors).slice(0, 100)});
  }
  return {infra: null, checks, artifact: {kind, outputSha256: sha256(out), output: clip(out, 100_000), briefLabel: TASKHUB_BRIEF.label}, identities};
}

export const EVALUATION_PROCEDURES: readonly Procedure[] = [
  {id: "golden-file", version: GOLDEN_FILE_VERSION, fixtureDigest: FIXTURE_DIGESTS[GOLDEN_FILE_VERSION], specKind: "ROLE_SPECIFIC_GOLDEN_MISSION", functions: ["developer"],
    covers: ["follows a precise single-file mission", "touches only the expected file", "commit is produced by the engine-owned builder commit"], doesNotCover: ["code quality", "tests", "multi-file changes", "any real project work"], run: c => goldenFile(c)},
  {id: "golden-review", version: GOLDEN_REVIEW_VERSION, fixtureDigest: FIXTURE_DIGESTS[GOLDEN_REVIEW_VERSION], specKind: "ROLE_SPECIFIC_GOLDEN_MISSION", functions: ["security-reviewer"],
    covers: ["returns CLEAN with no findings for a trivially correct diff", "returns BLOCKED with a finding for a planted command injection", "leaves the review clone untouched"], doesNotCover: ["recall on real defects", "false-positive rate beyond one case", "secret or dependency review"], run: c => goldenReview(c)},
  {id: "golden-tests", version: GOLDEN_TESTS_VERSION, fixtureDigest: FIXTURE_DIGESTS[GOLDEN_TESTS_VERSION], specKind: "ROLE_SPECIFIC_GOLDEN_MISSION", functions: ["tester"],
    covers: ["authors ONE new, scoped test file (at most 16 KiB) for a precise mission that states every threshold", "the file compiles (compile only, nothing is run) and, in the code tokens only (comments, strings, callbacks and dead code never count), declares require of ../src/add and node:assert at the top level and contains at least three top-level assertion statements assert.<strictEqual|equal|deepStrictEqual|deepEqual>(add(<n>, <n>), <n>) or assert[.ok](add(<n>, <n>) === <n>) with distinct operands covering a positive, a negative and a zero case", "every asserted value equals the true sum (statically computed from the literals)", "leaves existing tests, src and the harness untouched; no skipped/disabled tests, no top-level return, loop, conditional, function or class", "a closed grammar: the file consists ONLY of the two `const` require declarations, BEFORE the first assertion (a declaration after an assertion would throw a ReferenceError at run time), and qualifying top-level assert statements (optional plain-string message); every other top-level statement (reassignment, alias, Object/prototype tampering, process/eval/import, console, blocks, other requires) fails, so the file cannot rebind, neuter or exit its own assertions"],
    doesNotCover: ["that the tests pass or fail correctly: nothing is executed (no verified sandbox)", "defect-detection power (no mutation testing): the detection guarantee covers an add that SUBTRACTS (a - b) only; a file whose cases satisfy a * b == a + b (for example 2, 2, 4) also passes for a multiplying add", "tests in any other style (node:test callbacks, table-driven loops, destructured assert imports or an assert binding not named assert): they are FAILED against the precise mission text, not judged", "test design quality beyond the static checks"], run: c => goldenTests(c)},
  {id: "golden-predev", version: "golden-predev-v1", fixtureDigest: sha256Json({brief: TASKHUB_BRIEF, artifacts: TASKHUB_ARTIFACTS}), specKind: "ROLE_SPECIFIC_GOLDEN_MISSION", functions: ["business-analyst", "requirements-engineer", "planner", "architect", "ux-designer"],
    covers: ["produces JSON that the existing artifact validators accept for the TaskHub reference brief (shape and traceability to approved upstream)"], doesNotCover: ["content quality or correctness", "any customer project", "the TaskHub reference content is not a verified project"], run: (c, fn) => goldenPredev(c, fn)}
];

// ---------------------------------------------------------------- pipeline
const redactedJson = (x: unknown): string => JSON.stringify(x, (_k, v) => (typeof v === "string" ? redactSecrets(v) : v), 2) + "\n";
export function planFor(roleId: string, evaluationId: string, bindings: readonly RoleExecutionProfile[] = FIRST_DELIVERY_BINDINGS): {profile: RoleExecutionProfile; procedure: Procedure} | {refused: string} {
  if (!ROLE_RE.test(roleId) || !EV_RE.test(evaluationId)) return {refused: "EVALUATION_BAD_IDS"};
  const profile = bindings.find(b => b.roleId === roleId);
  if (!profile) return {refused: "ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING"};
  const procedure = EVALUATION_PROCEDURES.find(p => p.functions.includes(profile.function));
  if (!procedure) return {refused: `NO_PROCEDURE:${profile.function}`};
  if (evaluationId !== "EV-01") return {refused: `NO_PROCEDURE:${evaluationId}`};
  try { if (IMPLEMENTER_FUNCTIONS.includes(profile.function)) assertImplementerRole(roleId, bindings); else assertRoleExecutes(roleId, profile.function, bindings); }
  catch (e) { return {refused: (e as Error).message.replace(/:UASCO-\d{4}$/, "").slice(0, 120)}; }
  return {profile, procedure};
}
export function registrySpec(repoRoot: string, roleId: string, evaluationId: string): {kind: string; specRef: string; status: string} | null {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, "registries", "role-definitions.json"), "utf8"));
    const spec = doc.roles.find((r: {roleId: string}) => r.roleId === roleId)?.evaluationSpecs?.find((s: {evaluationId: string}) => s.evaluationId === evaluationId);
    return spec ? {kind: String(spec.kind), specRef: String(spec.specRef), status: String(spec.status)} : null;
  } catch { return null; }
}

// //TR: Verdict YALNIZ kontrollerden hesaplanır; hiç kontrol yoksa verdict yoktur (boş küme "hepsi geçti" sayılmaz).
export function verdictOf(checks: readonly EvalCheck[]): "PASSED" | "FAILED" | null {
  return checks.length === 0 ? null : checks.every(c => c.passed) ? "PASSED" : "FAILED";
}

export async function runRoleEvaluation(deps: EvaluationDeps, roleId: string, evaluationId: string): Promise<EvaluationOutcome> {
  const plan = planFor(roleId, evaluationId, deps.bindings);
  if ("refused" in plan) return {status: "REFUSED", reason: plan.refused};
  const {profile, procedure} = plan;
  const spec = registrySpec(deps.repoRoot, roleId, evaluationId);
  if (!spec) return {status: "REFUSED", reason: "REGISTRY_SPEC_NOT_FOUND"};
  if (spec.kind !== procedure.specKind) return {status: "REFUSED", reason: `SPEC_KIND_MISMATCH:${spec.kind}`};
  let staging: EvaluationStaging;
  try { staging = new EvaluationStaging(deps.stagingRoot, deps.repoRoot); if (staging.exists(roleId, evaluationId)) return {status: "REFUSED", reason: "STAGING_EVIDENCE_EXISTS"}; staging.preflight(roleId, evaluationId); }
  catch (e) { return {status: "REFUSED", reason: e instanceof EvaluationStagingError ? e.code : "STAGING_UNAVAILABLE"}; }
  // //TR: executorKind çağıranın beyanı değil, çiftin kendi türüdür; FAKE her zaman FAKE damgalanır.
  const executorKind = deps.pair.kind === "FAKE" ? "FAKE" as const : "LOCAL_CLAUDE" as const;
  const timeoutMs = effectiveLimits(profile.limits, {maxRemediations: 0, executorTimeoutMs: deps.timeoutMs ?? 3_600_000}).executorTimeoutMs;
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uasco-eval-"));
  let run: ProcedureRun;
  try { run = await procedure.run({pair: deps.pair, profile, timeoutMs, ...(deps.shouldAbort ? {shouldAbort: deps.shouldAbort} : {}), tmp}, profile.function); }
  catch (e) { return {status: "NOT_EXECUTED", roleId, evaluationId, reason: `PROCEDURE_EXCEPTION:${(e as Error).message.slice(0, 80)}`}; }
  finally { try { fs.rmSync(tmp, {recursive: true, force: true}); } catch { /* geçici dizin en iyi çabayla silinir */ } }
  // //TR: Altyapı kaynaklı sonuç bir DEĞERLENDİRME SONUCU değildir: hiçbir kanıt yazılmaz (rol ne geçer ne kalır).
  if (run.infra !== null) return {status: "NOT_EXECUTED", roleId, evaluationId, reason: run.infra};
  const verdict = verdictOf(run.checks);
  if (verdict === null) return {status: "NOT_EXECUTED", roleId, evaluationId, reason: "NO_CHECKS_EVALUATED"};
  const endedAt = now().toISOString();
  const rel = `${EVIDENCE_ROOT}/${roleId}`;
  // //TR: Redaksiyon JSON metnine değil string DEĞERLERİNE uygulanır (serileştirilmiş "\\nAKIA..." içinde \b eşleşmezdi). Kontrol ayrıntıları da redakte edilir; çıktı, kanıt ve CLI aynı baytları görür.
  const checks = run.checks.map(c => ({...c, detail: redactSecrets(c.detail)}));
  const artifactText = redactedJson({roleId, evaluationId, procedure: procedure.version, checks, ...run.artifact});
  const codeHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const evidence = {
    schemaVersion: "1.0.0", roleId, evaluationId, verdict, executorKind, fake: executorKind === "FAKE",
    procedure: {id: procedure.id, version: procedure.version, fixtureDigest: procedure.fixtureDigest, covers: procedure.covers, doesNotCover: procedure.doesNotCover},
    spec: {kind: spec.kind, specRef: spec.specRef, statusAtRun: spec.status, specTextAvailableInRepository: false},
    executor: {kind: executorKind, identities: run.identities}, binding: {function: profile.function, providerRoute: profile.providerRoute, sha256: sha256Json(profile)},
    checks, startedAt, endedAt, codeHeadSha: codeHead.status === 0 ? String(codeHead.stdout).trim() : null,
    artifactPath: `${rel}/${evaluationId}.artifact.json`, artifactSha256: sha256(artifactText), note: EVALUATION_NOTE
  };
  // //TR: Kontrol ayrıntıları model/ajan kontrollü metin (dosya adı vb.) taşıyabilir; kanıt dosyası da artefakt gibi redakte edilir (hash redakte edilmiş baytlara bağlanır).
  const evidenceText = redactedJson(evidence);
  let artifactFile: string, evidenceFile: string;
  try { artifactFile = staging.write(roleId, evaluationId, "artifact", artifactText); evidenceFile = staging.write(roleId, evaluationId, "evidence", evidenceText); }
  catch (e) { return {status: "REFUSED", reason: e instanceof EvaluationStagingError ? e.code : "STAGING_WRITE_FAILED"}; }
  const evidenceRef = `${rel}/${evaluationId}.json#sha256=${sha256(evidenceText)}`;
  // //TR: Şeffaflık: aynı doğrulayıcı, staging kökünü depo kökü gibi görerek kanıtı denetler (terfi sonrası sonuç). FAKE kanıtı burada FAKE_EVIDENCE ile reddedilir.
  const problem = createEvidenceVerifier(path.resolve(deps.stagingRoot))(evidenceRef, roleId, evaluationId, verdict);
  return {status: "EVALUATED", verdict, roleId, evaluationId, executorKind, evidenceRef, evidenceFile, artifactFile, checks, verifier: {countsIfPromoted: problem === null, problem}};
}
