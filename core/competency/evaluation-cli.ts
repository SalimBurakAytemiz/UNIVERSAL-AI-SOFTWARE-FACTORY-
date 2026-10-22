// //TR: Bu dosya scripts/run-role-evaluation.mjs komut satırı mantığıdır (test edilebilir olsun diye TS'te). VARSAYILAN KURU ÇALIŞTIRMADIR: hiçbir süreç başlatmaz, hiçbir dosya/dizin yazmaz. Gerçek çalıştırma yalnız --execute ile ve yalnız: CI ortamı değilse, config/automation.json allowPaidApi=false ise, LOCAL_CLAUDE Founder tarafından etkinleştirilmişse ve provenance PASS ise (aynı ExecutorSetup durumu) yapılır. Staging yeri sabittir (<veri dizini>/evaluations/staging); serbest çıktı yolu bayrağı YOKTUR.
import fs from "node:fs";
import path from "node:path";
import {ExecutorSetup} from "../workos/executor-setup.js";
import {LocalClaudeExecutors} from "../workos/executors.js";
import {claudeProfileStatus} from "../workos/claude-profiles.js";
import type {ClaudeProfileRole} from "../workos/claude-profiles.js";
import type {ExecutorPair} from "../workos/executors.js";
import {EVALUATION_NOTE, EvaluationStaging, EvaluationStagingError, GIT_REPO_ENV, planFor, registrySpec, runRoleEvaluation} from "./evaluation-pipeline.js";

export interface CliOptions {
  repoRoot: string; env: NodeJS.ProcessEnv; out: (s: string) => void; err: (s: string) => void;
  // //TR: Yalnız testler için programatik enjeksiyon (komut satırından seçilemez).
  makePair?: (a: {repoRoot: string; controlRoot: string; dataDir: string}) => ExecutorPair;
  findClaudeCli?: () => string | null;
}
export interface ParsedArgs { role: string; evaluation: string; dataDir: string; controlRoot: string | null; execute: boolean }
const USAGE = "usage: run-role-evaluation --role UASCO-NNNN [--evaluation EV-01] --data-dir <work os data dir> [--control-root <dir>] [--execute]";

export function parseArgs(argv: string[]): ParsedArgs | {error: string} {
  const a: ParsedArgs = {role: "", evaluation: "EV-01", dataDir: "", controlRoot: null, execute: false};
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--execute") a.execute = true;
    else if (f === "--role" || f === "--evaluation" || f === "--data-dir" || f === "--control-root") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return {error: `MISSING_VALUE:${f}`};
      if (f === "--role") a.role = v; else if (f === "--evaluation") a.evaluation = v; else if (f === "--data-dir") a.dataDir = v; else a.controlRoot = v;
    } else return {error: `UNKNOWN_ARGUMENT:${String(f).slice(0, 40)}`};
  }
  if (!a.role) return {error: "MISSING_ROLE"};
  if (!a.dataDir || !path.isAbsolute(a.dataDir)) return {error: "DATA_DIR_MUST_BE_ABSOLUTE"};
  if (a.controlRoot !== null && !path.isAbsolute(a.controlRoot)) return {error: "CONTROL_ROOT_MUST_BE_ABSOLUTE"};
  return a;
}

const truthy = (v: string | undefined) => v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
// //TR: Gerçek çalıştırma kapıları (hepsi salt okunur kontrol). ok=false => neden kodu; hiçbir süreç başlatılmaz.
// //TR: Kontrol kökü sunucuyla AYNI kuralla çözülür (apps/control-api/src/server.ts: controlRoot ?? UASCO_CONTROL_ROOT ?? repoRoot): önce --control-root, sonra UASCO_CONTROL_ROOT, sonra depo kökü. Boş değer "yok" sayılır.
export function resolveControlRoot(flag: string | null, env: NodeJS.ProcessEnv, repoRoot: string): string {
  if (flag !== null && flag !== "") return flag;
  const fromEnv = env.UASCO_CONTROL_ROOT;
  return typeof fromEnv === "string" && fromEnv !== "" ? fromEnv : repoRoot;
}
// //TR: Gerçek çalıştırmada kullanılacak Claude profilleri (implementer rotası -> implementer profili; reviewer rotası -> reviewer profili).
export type NeededProfiles = readonly ClaudeProfileRole[];
export function executeBlockers(o: {repoRoot: string; dataDir: string; controlRoot: string; env: NodeJS.ProcessEnv; findClaudeCli?: () => string | null; profiles?: NeededProfiles}): string[] {
  const blockers: string[] = [];
  if (truthy(o.env.CI) || truthy(o.env.GITHUB_ACTIONS)) blockers.push("CI_ENVIRONMENT");
  // //TR: Ortamda GIT_DIR / GIT_WORK_TREE vb. varsa adaptörlerin git komutları gerçek checkout'a yönelebilir: gerçek çalıştırma reddedilir.
  if (Object.keys(o.env).some(k => GIT_REPO_ENV.test(k) && o.env[k] !== undefined && o.env[k] !== "")) blockers.push("GIT_ENVIRONMENT_OVERRIDE");
  let paid: unknown = undefined;
  try { paid = JSON.parse(fs.readFileSync(path.join(o.repoRoot, "config", "automation.json"), "utf8")).allowPaidApi; } catch { /* okunamazsa fail-closed */ }
  if (paid !== false) blockers.push("PAID_API_NOT_DISABLED");
  try {
    const st = new ExecutorSetup({repoRoot: o.repoRoot, controlRoot: o.controlRoot, dataDir: o.dataDir, envPolicyFile: path.join(o.repoRoot, "config", "environment-policy.json"), env: o.env, ...(o.findClaudeCli ? {findClaudeCli: o.findClaudeCli} : {})}).status().LOCAL_CLAUDE;
    if (!st.enabled) blockers.push("EXECUTOR_NOT_ENABLED");
    else if (st.state !== "READY") blockers.push(`EXECUTOR_${st.state}`);
  } catch { blockers.push("EXECUTOR_STATUS_UNAVAILABLE"); }
  // //TR: Rolün kullanacağı Claude profilleri hazır olmalı (salt-okunur durum): kontrol kökü bir git çalışma ağacının içindeyse (ör. depo kökü) profil yolu reddedilir (PROFILE_PATH_INSIDE_GIT_WORKTREE), oturum yoksa LOGIN_REQUIRED; ikisi de gerçek çalıştırmayı baştan engeller ve kuru çalıştırmada görünür.
  for (const role of o.profiles ?? []) {
    try {
      const ps = claudeProfileStatus(o.controlRoot, role, {forbiddenRoots: [o.dataDir]});
      if (ps.state === "REFUSED") blockers.push(`CLAUDE_PROFILE_${role.toUpperCase()}_REFUSED:${ps.reason ?? "UNKNOWN"}`);
      else if (ps.state === "LOGIN_REQUIRED") blockers.push(`CLAUDE_PROFILE_${role.toUpperCase()}_LOGIN_REQUIRED`);
    } catch { blockers.push(`CLAUDE_PROFILE_${role.toUpperCase()}_STATUS_UNAVAILABLE`); }
  }
  return blockers;
}

export async function runCli(argv: string[], o: CliOptions): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) { o.err(JSON.stringify({status: "USAGE", error: args.error, usage: USAGE}) + "\n"); return 2; }
  const controlRoot = resolveControlRoot(args.controlRoot, o.env, o.repoRoot), stagingRoot = path.join(args.dataDir, "evaluations", "staging");
  const plan = planFor(args.role, args.evaluation);
  if ("refused" in plan) { o.err(JSON.stringify({status: "REFUSED", reason: plan.refused}) + "\n"); return 2; }
  const spec = registrySpec(o.repoRoot, args.role, args.evaluation);
  if (!spec) { o.err(JSON.stringify({status: "REFUSED", reason: "REGISTRY_SPEC_NOT_FOUND"}) + "\n"); return 2; }
  const profiles: NeededProfiles = plan.profile.providerRoute === "CLAUDE_IMPLEMENTER" ? ["implementer"] : ["reviewer"];
  // //TR: Enjekte (test) çiftinde gerçek profiller kullanılmaz; yalnız gerçek LocalClaudeExecutors yolunda profil durumu engel sayılır.
  const blockers = executeBlockers({repoRoot: o.repoRoot, dataDir: args.dataDir, controlRoot, env: o.env, ...(o.findClaudeCli ? {findClaudeCli: o.findClaudeCli} : {}), ...(o.makePair ? {} : {profiles})});
  let staging: {exists: boolean; error: string | null} = {exists: false, error: null};
  try { staging = {exists: new EvaluationStaging(stagingRoot, o.repoRoot).exists(args.role, args.evaluation), error: null}; }
  catch (e) { staging = {exists: false, error: e instanceof EvaluationStagingError ? e.code : "STAGING_UNAVAILABLE"}; }
  if (!args.execute) {
    // //TR: KURU ÇALIŞTIRMA: yalnız plan yazdırılır; süreç yok, dosya yok.
    o.out(JSON.stringify({mode: "DRY_RUN", willSpawn: false, willWrite: false, role: args.role, function: plan.profile.function, evaluation: args.evaluation, spec,
      procedure: {id: plan.procedure.id, version: plan.procedure.version, fixtureDigest: plan.procedure.fixtureDigest, covers: plan.procedure.covers, doesNotCover: plan.procedure.doesNotCover},
      staging: {root: stagingRoot, existingEvidence: staging.exists, problem: staging.error}, controlRoot, executeBlockers: blockers, note: EVALUATION_NOTE}, null, 2) + "\n");
    return 0;
  }
  if (blockers.length > 0) { o.err(JSON.stringify({status: "REFUSED", reason: "EXECUTE_NOT_ALLOWED", blockers}) + "\n"); return 2; }
  if (staging.error) { o.err(JSON.stringify({status: "REFUSED", reason: staging.error}) + "\n"); return 2; }
  const pair = o.makePair ? o.makePair({repoRoot: o.repoRoot, controlRoot, dataDir: args.dataDir}) : new LocalClaudeExecutors(o.repoRoot, controlRoot, {profile: {forbiddenRoots: [args.dataDir]}}).pair();
  const r = await runRoleEvaluation({repoRoot: o.repoRoot, stagingRoot, pair}, args.role, args.evaluation);
  o.out(JSON.stringify({mode: "EXECUTED", ...r, note: EVALUATION_NOTE}, null, 2) + "\n");
  return r.status === "EVALUATED" ? 0 : r.status === "REFUSED" ? 2 : 1;
}
