// //TR: Bu dosya yalnız dosya düzenleyebilen (shell'siz) builder'ın çıktısını engine adına commit eder: builder öncesi/sonrası .git kontrol dosyaları özetlenir (değiştiyse red), index engine tarafından HEAD'den yeniden kurulur, değişen yollar sınıflandırılır (.git iç dosyası, workspace dışı, symlink, gitlink reddedilir), değişiklik yoksa BUILDER_PRODUCED_NO_CHANGE döner, aksi halde izole git ile sabit builder kimliğiyle run dalına commit atılır.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnGitSync} from "../../automation/lib/git-isolation.mjs";
import {safeChildEnv} from "../../automation/lib/env-policy.mjs";
import {runGitAsync} from "./git-async.js";
import type {SpawnedChild} from "./executors.js";
import {agentConfigPattern} from "./agent-config-paths.js";

export const BUILDER_GIT_IDENTITY = {name: "UASCO Builder (CLAUDE_BUILDER)", email: "builder@local.invalid"} as const;
const SHA = /^[0-9a-f]{40}$/;
// Repo config'i engine'in git çağrılarında komut çalıştıramasın diye fsmonitor her çağrıda kapatılır.
const HARDEN = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];

// .git altındaki kontrol dosyalarının (objects/ ve engine'in yeniden kurduğu index hariç) özeti; .git dizin değilse (gitdir yönlendirmesi) null.
export function gitControlDigest(workspace: string): string | null {
  const root = path.join(workspace, ".git");
  let st: fs.Stats;
  try { st = fs.lstatSync(root); } catch { return null; }
  if (!st.isDirectory()) return null;
  const h = crypto.createHash("sha256");
  const walk = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === "objects" || r === "index") continue;
      const abs = path.join(dir, name), s = fs.lstatSync(abs);
      if (s.isSymbolicLink()) h.update(`L ${r} ${fs.readlinkSync(abs)}\n`);
      else if (s.isDirectory()) { h.update(`D ${r}\n`); walk(abs, r); }
      else h.update(`F ${r} ${crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex")}\n`);
    }
  };
  walk(root, "");
  return h.digest("hex");
}

// SBX-8: builder başlamadan önce çalışma alanında (sıfırlanmış + temizlenmiş, yalnız izlenen dosyalar) ajan yapılandırması aranır; bulunursa builder hiç başlatılmaz.
export function agentConfigInWorkspace(workspace: string, envPolicyFile: string): string[] | null {
  const env = safeChildEnv(envPolicyFile, {provider: "DETERMINISTIC"});
  const r = spawnGitSync(workspace, [...HARDEN, "-c", "core.quotePath=false", "ls-files", "-z", "--cached", "--others"], {env, maxBuffer: 64 * 1024 * 1024});
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\0").filter(Boolean).filter(f => agentConfigPattern(f) !== null).sort();
}

export type BuilderCommitResult =
  | {ok: true; commitSha: string; changed: string[]; log: string}
  | {ok: false; reason: string; changed: string[]; log: string; transient?: boolean};

// `git status --porcelain=v1 -z` girdilerinden yol listesi (rename/copy kaydının ikinci alanı da yoldur).
function parseStatusZ(out: string): string[] {
  const parts = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e || e.length < 4) continue;
    paths.push(e.slice(3));
    if (e[0] === "R" || e[0] === "C") { const orig = parts[++i]; if (orig) paths.push(orig); }
  }
  return paths;
}

// Yol workspace içinde kalmalı, hiçbir segmenti .git olmamalı, gömülü repo (sonu "/") veya symlink olmamalı.
export function forbiddenChange(workspace: string, rel: string): string | null {
  if (!rel || rel.endsWith("/")) return "EMBEDDED_REPOSITORY";
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return "ABSOLUTE_PATH";
  const segs = rel.split(/[\\/]/);
  if (segs.some(s => s === "..")) return "OUTSIDE_WORKSPACE";
  if (segs.some(s => /^\.git[. ]*$/i.test(s) || /^git~\d+$/i.test(s))) return "GIT_INTERNALS";
  const abs = path.resolve(workspace, rel), rootReal = fs.realpathSync(workspace);
  const rootAbs = path.resolve(workspace);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return "OUTSIDE_WORKSPACE";
  let st: fs.Stats | null = null;
  try { st = fs.lstatSync(abs); } catch { st = null; }
  if (st?.isSymbolicLink()) return "SYMLINK";
  let parent = path.dirname(abs);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const parentReal = fs.realpathSync(parent);
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) return "OUTSIDE_WORKSPACE";
  return null;
}

// //TR: HB-1: engine-owned commit adımları TEK yerde (jeneratör): her `yield` bir git çağrısı ister ve sonucunu geri alır. Eşzamanlı sürücü (commitBuilderOutput: testler, eşzamanlı çağıranlar) ve eşzamansız sürücü (commitBuilderOutputAsync: EditOnlyImplementer, crew geliştirme adaptörü) aynı sırayı, aynı HARDEN öneğini ve aynı ortamı uygular. Eşzamansız yol, birden çok run'ın aynı süreçte sürüldüğü servis kipinde `git status --untracked-files=all` gibi büyük ağaç taramalarının olay döngüsünü bloklayıp diğer run'ların lease'ini aç bırakmasını önler (PAR-03).
interface GitReq { args: string[] }
interface GitRes { status: number | null; stdout: string; stderr: string }
function* commitSteps(workspace: string, opts: {startSha: string; gitDigestBefore: string | null; message: string}, span: <T>(fn: () => T) => T): Generator<GitReq, BuilderCommitResult, GitRes> {
  const lines: string[] = [];
  let recordFailed = false; // //TR: R2: yazar kaydı yazılamadığı için öldürülen git çocuğu (SPAWN_RECORD_FAILED) geçici bir diskhatasıdır: sonuç kalıcı BUILDER_* bloğu DEĞİL, yeniden denemedir.
  const git = function* (args: string[]): Generator<GitReq, {ok: boolean; out: string}, GitRes> {
    const r = yield {args};
    if (r.status === null && String(r.stderr ?? "").startsWith("SPAWN_RECORD_FAILED")) recordFailed = true;
    lines.push(`$ git ${args.join(" ")}\n[exit=${r.status}]${r.status === 0 ? "" : `\n${String(r.stderr ?? "").slice(0, 2000)}`}`);
    return {ok: r.status === 0, out: String(r.stdout ?? "")};
  };
  const fail = (reason: string, changed: string[] = []): BuilderCommitResult => ({ok: false, reason, changed, log: `${lines.join("\n")}\nBUILDER_COMMIT_REFUSED ${reason}\n`, ...(recordFailed ? {transient: true} : {})});
  if (!SHA.test(opts.startSha)) return fail("BUILDER_START_SHA_INVALID");
  // Builder'ın .git'e dokunması (config, HEAD, refs, info/attributes, hooks) engine git çağrısından ÖNCE yakalanır.
  const after = span(() => gitControlDigest(workspace));
  if (!opts.gitDigestBefore || after !== opts.gitDigestBefore) return fail("BUILDER_TOUCHED_GIT_INTERNALS");
  // Index builder'dan devralınmaz: silinip HEAD'den yeniden kurulur (skip-worktree/assume-unchanged gibi bayraklar düşer).
  try { fs.rmSync(path.join(workspace, ".git", "index"), {force: true}); } catch { return fail("BUILDER_INDEX_RESET_FAILED"); }
  if (!(yield* git(["read-tree", opts.startSha])).ok) return fail("BUILDER_INDEX_RESET_FAILED");
  const head = yield* git(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!head.ok || head.out.trim() !== opts.startSha) return fail("BUILDER_MOVED_HEAD");
  const st = yield* git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no", "--no-renames"]);
  if (!st.ok) return fail("BUILDER_STATUS_FAILED");
  const changed = [...new Set(parseStatusZ(st.out))].sort();
  lines.push(`changed (${changed.length}):\n${changed.map(f => `  ${f}`).join("\n")}`);
  if (!changed.length) return fail("BUILDER_PRODUCED_NO_CHANGE");
  for (const f of changed) {
    const why = span(() => forbiddenChange(workspace, f));
    if (why) return fail(`BUILDER_CHANGED_FORBIDDEN_PATH:${why}`, changed);
  }
  // SBX-8: builder ajan yapılandırmasına (.claude/**, .mcp.json, .claude.json, CLAUDE.md, CLAUDE.local.md) dokunamaz; .gitignore ile gizlenmiş olanlar da sayılır. Böylece bu dosyalar asla reviewer klonuna ulaşmaz.
  const ign = yield* git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--no-renames"]);
  if (!ign.ok) return fail("BUILDER_STATUS_FAILED", changed);
  // RV-SBX8-C1-F1: `status --ignored=matching` yoksayılan bir DİZİNİ (ör. dist/) tek girişe daraltır; içindeki dist/.claude/settings.json gibi ajan yapılandırması gizli kalır. Bu yüzden yoksayılanlar dahil izlenmeyen dosyalar `ls-files -z --others` ile (--exclude-standard YOK) TEK TEK sayılır ve her biri ajan yapılandırması desenine göre denetlenir.
  const others = yield* git(["-c", "core.quotePath=false", "ls-files", "-z", "--others"]);
  if (!others.ok) return fail("BUILDER_STATUS_FAILED", changed);
  const othersPaths = String(others.out).split("\0").filter(Boolean);
  const touched = [...new Set([...changed, ...parseStatusZ(ign.out), ...othersPaths])].filter(f => agentConfigPattern(f) !== null).sort();
  if (touched.length) { lines.push(`agent config touched:\n${touched.map(f => `  ${f}`).join("\n")}`); return fail("BUILDER_TOUCHED_AGENT_CONFIG", changed); }
  if (!(yield* git(["add", "-A"])).ok) return fail("BUILDER_STAGE_FAILED", changed);
  const raw = yield* git(["diff", "--cached", "--raw", "-z", "--no-renames", opts.startSha]);
  if (!raw.ok) return fail("BUILDER_STAGE_FAILED", changed);
  if (!raw.out.trim()) return fail("BUILDER_PRODUCED_NO_CHANGE", changed);
  if (/(^|\0):\d{6} 160000 |(^|\0):160000 /.test(raw.out)) return fail("BUILDER_CHANGED_FORBIDDEN_PATH:GITLINK", changed);
  const msg = opts.message.replace(/\r/g, "").slice(0, 4000);
  if (!(yield* git(["-c", `user.name=${BUILDER_GIT_IDENTITY.name}`, "-c", `user.email=${BUILDER_GIT_IDENTITY.email}`, "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", msg])).ok) return fail("BUILDER_COMMIT_FAILED", changed);
  const sha = (yield* git(["rev-parse", "--verify", "HEAD^{commit}"])).out.trim();
  const parent = (yield* git(["rev-parse", "--verify", "HEAD^1"])).out.trim();
  if (!SHA.test(sha) || parent !== opts.startSha) return fail("BUILDER_COMMIT_FAILED", changed);
  lines.push(`BUILDER_COMMIT ${sha} parent=${parent} author=${BUILDER_GIT_IDENTITY.name}`);
  return {ok: true, commitSha: sha, changed, log: `${lines.join("\n")}\n`};
}
type CommitOpts = {envPolicyFile: string; startSha: string; gitDigestBefore: string | null; message: string};
const NO_SPAN = <T,>(fn: () => T): T => fn();
export function commitBuilderOutput(workspace: string, opts: CommitOpts): BuilderCommitResult {
  const env = safeChildEnv(opts.envPolicyFile, {provider: "DETERMINISTIC"});
  const g = commitSteps(workspace, opts, NO_SPAN);
  let step = g.next();
  while (!step.done) {
    const r = spawnGitSync(workspace, [...HARDEN, ...step.value.args], {env, maxBuffer: 64 * 1024 * 1024});
    step = g.next({status: r.status, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "")});
  }
  return step.value;
}
// //TR: span: küçük senkron .git/yol denetimleri (gitControlDigest, forbiddenChange) çağıranın span'ına sarılır (runner: TÜM lease'ler önce/sonra yenilenir). onSpawn: engine commit'inin git çocukları da workspace'i DEĞİŞTİRİR; çağıranın onSpawn'ı (runner'ın yazar kaydı) her git çocuğu için çağrılır, böylece engine commit sırasında çökerse devralan bu çocuğu da durdurur.
export async function commitBuilderOutputAsync(workspace: string, opts: CommitOpts, o: {span?: <T>(fn: () => T) => T; extraEnv?: Record<string, string>; onSpawn?: (c: SpawnedChild) => void} = {}): Promise<BuilderCommitResult> {
  const env = {...safeChildEnv(opts.envPolicyFile, {provider: "DETERMINISTIC"}), ...(o.extraEnv ?? {})};
  const g = commitSteps(workspace, opts, o.span ?? NO_SPAN);
  let step = g.next();
  while (!step.done) step = g.next(await runGitAsync(workspace, [...HARDEN, ...step.value.args], env, o.onSpawn));
  return step.value;
}
