// //TR: Bu dosya bir rol TANIMINI (registries/role-definitions.json) çalışan bir AJANDAN ayırır: resolveRoleExecution yalnız tam ve yürütülebilir bir RoleExecutionProfile (yetenek, sağlayıcı rotası, izinli araçlar, adaptörler, limitler, bilgi kaynakları, değerlendirme ölçütleri) varsa EXECUTABLE döner; aksi halde sabit neden kodlu NOT_EXECUTABLE. Hiçbir rol certified yapılmaz: sertifika yalnız katalogdaki TÜM değerlendirmeler kanıtlı PASSED ise raporlanır (bugün 0). Saf veri/mantık; model/ağ/shell yok.
import {CLAUDE_PROFILE_DENY_BOTH, CLAUDE_PROFILE_DENY_REVIEWER_EXTRA} from "../workos/claude-profiles.js";
import type {ClaudeProfileRole} from "../workos/claude-profiles.js";

// //TR: Sağlayıcı rotası: mevcut executor yüzeyleri. CLAUDE_IMPLEMENTER/CLAUDE_REVIEWER claude-profiles.ts profilleri; DETERMINISTIC_STUDIO model kullanmayan teslim hattı (ProjectStudio.prepareRunDelivery); NONE rota yok.
export type ProviderRoute = "CLAUDE_IMPLEMENTER" | "CLAUDE_REVIEWER" | "DETERMINISTIC_STUDIO" | "NONE";
// //TR: Yürütülebilirlik neden kodları (sabit, makine-okunur).
export type NotExecutableReason =
  | "ROLE_NOT_IN_CATALOG" | "ROLE_HAS_NO_BINDING" | "BINDING_ROLE_MISMATCH" | "PROVIDER_ROUTE_MISSING" | "TOOL_NOT_ALLOWED"
  | "TOOL_ALLOWLIST_MISSING" | "KNOWLEDGE_SOURCES_MISSING" | "LIMITS_INVALID" | "EVALUATION_CRITERIA_MISSING" | "CAPABILITIES_MISSING" | "ADAPTERS_MISSING";
export type CertificationState = "NOT_CERTIFIED" | "EVALUATED_PASS";

export interface TaskLimits { maxCycles: number; timeoutMs: number; maxFilesWritten: number }
// //TR: Bir rol için tam yürütme bağlaması (veri). Bu bir rol TANIMI üzerindeki bağlamadır, çalışan ajan DEĞİLDİR.
export interface RoleExecutionProfile {
  readonly roleId: string;
  readonly function: FirstDeliveryFunction;
  readonly capabilities: readonly string[];
  readonly providerRoute: ProviderRoute;
  readonly allowedTools: readonly string[];
  readonly adapters: readonly string[];
  readonly limits: TaskLimits;
  readonly knowledgeSources: readonly string[];
  readonly evaluationCriteria: readonly string[];
}
export type FirstDeliveryFunction = "planner" | "architect" | "developer" | "tester" | "security-reviewer" | "delivery";

// //TR: Salt-okunur katalog yüzeyi (registries/role-definitions.json alanları). Hiçbir alan yazılmaz.
export interface CatalogEvaluationSpec { evaluationId: string; status: string; evaluatorEvidenceRef?: string | null }
export interface CatalogRoleLike { roleId: string; title: string; guildId: string; evaluationSpecs?: readonly CatalogEvaluationSpec[]; knowledgeSourceRefs?: readonly unknown[] }

// //TR: Mevcut builder allow-list'i (config/builder-execution-policy.json allowedTools) — yeni araç eklenmez. Reviewer ek olarak yazma araçlarından yoksundur.
export const BUILDER_ALLOWED_TOOLS: readonly string[] = ["Read", "Edit", "Write", "Glob", "Grep"];
export const REVIEWER_ALLOWED_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];
const DENIED = new Set<string>([...CLAUDE_PROFILE_DENY_BOTH]);
const REVIEWER_DENIED = new Set<string>([...CLAUDE_PROFILE_DENY_BOTH, ...CLAUDE_PROFILE_DENY_REVIEWER_EXTRA]);

export type RoleResolution =
  | {status: "EXECUTABLE"; roleId: string; profile: RoleExecutionProfile; certification: CertificationState; evaluation: {executed: number; total: number}}
  | {status: "NOT_EXECUTABLE"; roleId: string; reason: NotExecutableReason; detail?: string; certification: "NOT_CERTIFIED"};

const notExec = (roleId: string, reason: NotExecutableReason, detail?: string): RoleResolution => ({status: "NOT_EXECUTABLE", roleId, reason, ...(detail ? {detail} : {}), certification: "NOT_CERTIFIED"});

// //TR: Profil kendi içinde tutarlı mı? İlk ihlalin neden kodu döner (null = tam). Araçlar sağlayıcı rotasının allow-list'inin alt kümesi olmalı ve yasaklı araç içermemeli.
export function profileDefect(p: RoleExecutionProfile): {reason: NotExecutableReason; detail?: string} | null {
  if (!p.capabilities.length) return {reason: "CAPABILITIES_MISSING"};
  if (p.providerRoute === "NONE") return {reason: "PROVIDER_ROUTE_MISSING"};
  const allow = p.providerRoute === "CLAUDE_REVIEWER" ? REVIEWER_ALLOWED_TOOLS : p.providerRoute === "CLAUDE_IMPLEMENTER" ? BUILDER_ALLOWED_TOOLS : [];
  const denied = p.providerRoute === "CLAUDE_REVIEWER" ? REVIEWER_DENIED : DENIED;
  if (p.providerRoute === "DETERMINISTIC_STUDIO" && p.allowedTools.length > 0) return {reason: "TOOL_NOT_ALLOWED", detail: p.allowedTools[0]};
  if (p.providerRoute !== "DETERMINISTIC_STUDIO" && p.allowedTools.length === 0) return {reason: "TOOL_ALLOWLIST_MISSING"};
  for (const t of p.allowedTools) if (denied.has(t) || !allow.includes(t)) return {reason: "TOOL_NOT_ALLOWED", detail: t};
  if (!p.adapters.length) return {reason: "ADAPTERS_MISSING"};
  const l = p.limits;
  if (!l || !(l.maxCycles >= 1) || !(l.timeoutMs >= 1000) || !(l.maxFilesWritten >= 0) || (p.providerRoute === "CLAUDE_REVIEWER" && l.maxFilesWritten !== 0)) return {reason: "LIMITS_INVALID"};
  if (!p.knowledgeSources.length) return {reason: "KNOWLEDGE_SOURCES_MISSING"};
  if (!p.evaluationCriteria.length) return {reason: "EVALUATION_CRITERIA_MISSING"};
  return null;
}

// //TR: Sertifika yalnız katalogda ALTI/ALTI (hepsi) değerlendirme PASSED ve kanıt referanslıysa raporlanır; aksi halde NOT_CERTIFIED (sahte sertifika yok).
export function evaluationState(role: CatalogRoleLike): {certification: CertificationState; executed: number; total: number} {
  const specs = role.evaluationSpecs ?? [];
  const passed = specs.filter(s => s.status === "PASSED" && typeof s.evaluatorEvidenceRef === "string" && s.evaluatorEvidenceRef !== "").length;
  return {certification: specs.length > 0 && passed === specs.length ? "EVALUATED_PASS" : "NOT_CERTIFIED", executed: passed, total: specs.length};
}

// //TR: Çözümleyici: rol katalogda olmalı, bir bağlaması olmalı, bağlama o role ait olmalı ve tam olmalı. Bağlama yoksa EXECUTABLE ASLA dönmez (tüm 599 rolün büyük çoğunluğu bu yüzden NOT_EXECUTABLE kalır).
export function resolveRoleExecution(roleId: string, catalog: readonly CatalogRoleLike[], bindings: readonly RoleExecutionProfile[]): RoleResolution {
  const role = catalog.find(r => r.roleId === roleId);
  if (!role) return notExec(roleId, "ROLE_NOT_IN_CATALOG");
  const profile = bindings.find(b => b.roleId === roleId);
  if (!profile) return notExec(roleId, "ROLE_HAS_NO_BINDING");
  const defect = profileDefect(profile);
  if (defect) return notExec(roleId, defect.reason, defect.detail);
  const ev = evaluationState(role);
  return {status: "EXECUTABLE", roleId, profile, certification: ev.certification, evaluation: {executed: ev.executed, total: ev.total}};
}

export const claudeProfileRoleOf = (route: ProviderRoute): ClaudeProfileRole | null => route === "CLAUDE_IMPLEMENTER" ? "implementer" : route === "CLAUDE_REVIEWER" ? "reviewer" : null;

// ---- Çalışan ajan (rol tanımından AYRI) ----
export type AgentState = "ASSIGNED" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
const AGENT_TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = {ASSIGNED: ["RUNNING", "ABORTED"], RUNNING: ["COMPLETED", "FAILED", "ABORTED"], COMPLETED: [], FAILED: [], ABORTED: []};
export interface ToolUseTrace { tool: string; at: string; allowed: boolean }
// //TR: Çalışan ajan örneği: yalnız EXECUTABLE çözümlemeden ve bir Work OS run kimliğiyle oluşturulur; araç kullanımı izlenir (Work OS olay/kanıt için).
export interface RunningAgent {
  readonly agentInstanceId: string; readonly roleId: string; readonly runId: string; readonly profile: RoleExecutionProfile;
  state: AgentState; readonly toolTrace: ToolUseTrace[];
}
export class AgentError extends Error { constructor(message: string) { super(message); this.name = "AgentError"; } }

export function instantiateAgent(resolution: RoleResolution, runId: string, agentInstanceId: string): RunningAgent {
  if (resolution.status !== "EXECUTABLE") throw new AgentError(`AGENT_ROLE_NOT_EXECUTABLE:${resolution.reason}`);
  if (!runId || !agentInstanceId) throw new AgentError("AGENT_RUN_BINDING_MISSING");
  return {agentInstanceId, roleId: resolution.roleId, runId, profile: resolution.profile, state: "ASSIGNED", toolTrace: []};
}
export function advanceAgent(a: RunningAgent, to: AgentState): void {
  if (!AGENT_TRANSITIONS[a.state].includes(to)) throw new AgentError(`AGENT_ILLEGAL_TRANSITION:${a.state}->${to}`);
  a.state = to;
}
// //TR: Araç kapısı: yalnız RUNNING ajan, yalnız izinli araçları kullanabilir; her deneme (reddedilen dahil) izlenir.
export function authorizeToolUse(a: RunningAgent, tool: string, now: () => string = () => new Date().toISOString()): boolean {
  const ok = a.state === "RUNNING" && a.profile.allowedTools.includes(tool);
  a.toolTrace.push({tool, at: now(), allowed: ok});
  return ok;
}
// //TR: Work OS olay/kanıt için izlenebilir özet (rol tanımı kimliği ile ajan örneği kimliği ayrı alanlardır).
export function agentTraceEnvelope(a: RunningAgent): {agentInstanceId: string; roleId: string; runId: string; providerRoute: ProviderRoute; state: AgentState; toolUses: number; deniedToolUses: number} {
  return {agentInstanceId: a.agentInstanceId, roleId: a.roleId, runId: a.runId, providerRoute: a.profile.providerRoute, state: a.state, toolUses: a.toolTrace.length, deniedToolUses: a.toolTrace.filter(t => !t.allowed).length};
}
