// //TR: Bu dosya 599 rol için yaşam döngüsünü YALNIZ kanıttan hesaplar: REGISTERED (kayıtta), IMPLEMENTED (yürütülebilir bağlama + bir adımın tükettiği + üretim executor rotası), TESTED (en az bir değerlendirme gerçek ve doğrulanmış kanıtla koşmuş), CERTIFIED (validator ile aynı sertifika kanıt kuralı), RUNNING (açık bir run'da AGENT_TRACE). Beş sayaç BİRBİRİNDEN bağımsızdır; hiçbiri diğerinden terfi almaz. FAKE etiketli kanıt TESTED/CERTIFIED sayılmaz. Saf hesap; dosya okuma yalnız enjekte edilen kanıt doğrulayıcısındadır.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {resolveRoleExecution} from "./role-execution.js";
import type {CatalogRoleLike, ProviderRoute, RoleExecutionProfile} from "./role-execution.js";
import {STAGE_CONSUMERS} from "./first-delivery-bindings.js";
import {TERMINAL_RUN_STATUSES} from "../workos/run-state.js";
import type {WorkRun} from "../workos/types.js";

export const TARGET_ROLE_COUNT = 599;
// Gerçek (FAKE olmayan) bir üretim executor'ı olan rotalar: yerel Claude broker'ı (implementer) ve bağımsız reviewer. DETERMINISTIC_STUDIO bir rol çalıştırmaz.
export const PRODUCTION_EXECUTOR_ROUTES: readonly ProviderRoute[] = ["CLAUDE_IMPLEMENTER", "CLAUDE_REVIEWER"];
export const EVIDENCE_ROOT = "audit/evidence/role-evaluations";
const EVIDENCE_REF = /^audit\/evidence\/role-evaluations\/(UASCO-\d{4})\/(EV-0[1-6]|REVIEWER)\.json#sha256=([0-9a-f]{64})$/;
const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

/** null = geçerli kanıt; aksi halde neden. Doğrulayıcı bir ref'in biçimini, dosyayı, bayt hash'ini ve içeriğini kontrol eder. */
export type EvidenceVerifier = (ref: unknown, roleId: string, evaluationId: string, verdict: string) => string | null;

const realOrNull = (p: string): string | null => { try { return fs.realpathSync(p); } catch { return null; } };
const inside = (base: string, p: string): boolean => { const r = path.relative(base, p); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };
// //TR: scripts/validate-role-registry.mjs evidenceProblem ile AYNI kural (sembolik bağ kaçışı yok, kök içinde gerçek dosya, hash eşleşmesi, içerik roleId/evaluationId/verdict'i adlandırır, aynı rol dizininde bağlı artefakt) + FAKE etiketi reddi.
export function createEvidenceVerifier(repoRoot: string): EvidenceVerifier {
  const base = realOrNull(path.resolve(repoRoot, EVIDENCE_ROOT));
  return (ref, roleId, evaluationId, verdict) => {
    if (typeof ref !== "string" || !ref) return "missing";
    const m = EVIDENCE_REF.exec(ref);
    if (!m) return "bad_form";
    if (m[1] !== roleId || m[2] !== evaluationId) return "names_other_role_or_evaluation";
    const real = realOrNull(path.resolve(repoRoot, ref.split("#")[0]));
    if (!base || !real) return "file_missing";
    if (!inside(base, real)) return "outside_evidence_root";
    let raw: Buffer; try { if (!fs.statSync(real).isFile()) return "not_a_file"; raw = fs.readFileSync(real); } catch { return "unreadable"; }
    if (sha256(raw) !== m[3]) return "hash_mismatch";
    let j: any; try { j = JSON.parse(raw.toString("utf8")); } catch { return "not_json"; }
    if (j?.roleId !== roleId || j?.evaluationId !== m[2] || j?.verdict !== verdict) return "content_mismatch";
    if (j?.executorKind === "FAKE" || j?.fake === true) return "FAKE_EVIDENCE";
    const roleDir = realOrNull(path.resolve(base, roleId));
    const art = typeof j.artifactPath === "string" ? realOrNull(path.resolve(repoRoot, j.artifactPath)) : null;
    if (!roleDir || !art || !inside(roleDir, art) || art === real) return "artifact_not_in_role_dir";
    try { if (sha256(fs.readFileSync(art)) !== j.artifactSha256) return "artifact_hash_mismatch"; } catch { return "artifact_unreadable"; }
    return null;
  };
}

export interface LifecycleRole extends CatalogRoleLike {
  proficiencyStatus?: string; certifiedScope?: unknown; expiresAt?: string | null; evaluatorEvidenceRefs?: readonly unknown[]; reviewerEvidenceRef?: unknown;
}
export interface RoleLifecycle { roleId: string; guildId: string; registered: true; implemented: boolean; tested: boolean; certified: boolean; running: boolean }

export interface LifecycleContext {
  bindings: readonly RoleExecutionProfile[]; verify: EvidenceVerifier; runningRoleIds: ReadonlySet<string>; nowMs: number;
}
const consumedFunctions = (): ReadonlySet<string> => new Set(Object.values(STAGE_CONSUMERS).flat());

export function roleLifecycle(role: LifecycleRole, catalog: readonly CatalogRoleLike[], ctx: LifecycleContext): RoleLifecycle {
  const res = resolveRoleExecution(role.roleId, catalog, ctx.bindings);
  const implemented = res.status === "EXECUTABLE" && PRODUCTION_EXECUTOR_ROUTES.includes(res.profile.providerRoute) && consumedFunctions().has(res.profile.function);
  const specs = role.evaluationSpecs ?? [];
  // TESTED: en az bir spec NOT_EXECUTED değil VE doğrulanmış (FAKE olmayan) kanıta bağlı.
  const tested = specs.some(s => s.status !== "NOT_EXECUTED" && ctx.verify(s.evaluatorEvidenceRef, role.roleId, s.evaluationId, s.status) === null);
  // CERTIFIED: validator'ın iddia kuralı — CERTIFIED + scope + kanıtlar + reviewer APPROVED + altı spec PASSED/doğrulanmış + süresi dolmamış.
  const refs = Array.isArray(role.evaluatorEvidenceRefs) ? role.evaluatorEvidenceRefs : [];
  const certified = role.proficiencyStatus === "CERTIFIED" && !!role.certifiedScope && typeof role.certifiedScope === "object" && refs.length > 0
    && ctx.verify(role.reviewerEvidenceRef, role.roleId, "REVIEWER", "APPROVED") === null
    && specs.length === 6 && specs.every(s => s.status === "PASSED" && ctx.verify(s.evaluatorEvidenceRef, role.roleId, s.evaluationId, "PASSED") === null)
    && typeof role.expiresAt === "string" && Date.parse(role.expiresAt) > ctx.nowMs;
  return {roleId: role.roleId, guildId: role.guildId, registered: true, implemented, tested, certified, running: ctx.runningRoleIds.has(role.roleId)};
}

/** Açık (terminal olmayan) bir run'daki AGENT_TRACE kanıtından rol kimlikleri; yalnız kayıtlı rol kimlikleri sayılır. */
export function runningRoleIdsFromRuns(runs: readonly Pick<WorkRun, "status" | "evidence">[], knownRoleIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const r of runs) {
    if (TERMINAL_RUN_STATUSES.includes(r.status)) continue;
    for (const e of r.evidence) {
      if (e.kind !== "AGENT_TRACE") continue;
      const m = /(?:^|\s)role=(UASCO-\d{4})(?:\s|$)/.exec(String(e.note ?? ""));
      if (m && knownRoleIds.has(m[1])) out.add(m[1]);
    }
  }
  return out;
}

export interface GuildCounts { guildId: string; registered: number; implemented: number; tested: number; certified: number; running: number }
export interface RoleStatusSummary {
  target: number; registered: number; implemented: number; tested: number; certified: number; running: number;
  byGuild: GuildCounts[]; computedAt: string; basis: {roleDefinitionsSha256: string; bindingsCount: number};
}
export interface SummaryInput { roles: readonly LifecycleRole[]; guildIds: readonly string[]; roleDefinitionsSha256: string; bindings: readonly RoleExecutionProfile[]; verify: EvidenceVerifier; runs: readonly Pick<WorkRun, "status" | "evidence">[]; now: Date }

export function computeRoleStatusSummary(i: SummaryInput): RoleStatusSummary {
  const known = new Set(i.roles.map(r => r.roleId));
  const ctx: LifecycleContext = {bindings: i.bindings, verify: i.verify, runningRoleIds: runningRoleIdsFromRuns(i.runs, known), nowMs: i.now.getTime()};
  const guilds = new Map<string, GuildCounts>();
  for (const g of [...new Set([...i.guildIds, ...i.roles.map(r => r.guildId)])].sort()) guilds.set(g, {guildId: g, registered: 0, implemented: 0, tested: 0, certified: 0, running: 0});
  const total = {registered: 0, implemented: 0, tested: 0, certified: 0, running: 0};
  for (const role of i.roles) {
    const l = roleLifecycle(role, i.roles, ctx), g = guilds.get(role.guildId)!;
    for (const k of ["registered", "implemented", "tested", "certified", "running"] as const) if (l[k]) { total[k]++; g[k]++; }
  }
  return {target: TARGET_ROLE_COUNT, ...total, byGuild: [...guilds.values()], computedAt: i.now.toISOString(), basis: {roleDefinitionsSha256: i.roleDefinitionsSha256, bindingsCount: i.bindings.length}};
}
