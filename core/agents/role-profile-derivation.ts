// //TR: Bu dosya 599 rol için YÜRÜTME PROFİLİ ÖNERİLERİNİ (rota, izinli araçlar, aday beceriler, işçi kapsamı, en-az-yetki izinleri, inceleme zinciri, limitler, bilgi kaynakları, değerlendirme referansları) yalnız depo içi kaynaklardan, SAF ve DETERMINISTIK olarak türetir. Her alan PROPOSED_DERIVED durumunu ve kaynak/kural izini taşır; kaynak bir şey söylemiyorsa alan boştur ve gap kimliği yazılır. İsim/rol UYDURULMAZ, hiçbir rol yürütülebilir/certified ilan edilmez, üretim mutasyonu/ağ/sır/ödeme yetkisi ASLA verilmez. Bu öneriler bağlama (FIRST_DELIVERY_BINDINGS) DEĞİLDİR; yürütme yalnız tam bağlamayla (resolveRoleExecution) mümkündür.
import {FIRST_DELIVERY_BINDINGS, bindingForFunction} from "./first-delivery-bindings.js";
import {BUILDER_ALLOWED_TOOLS, REVIEWER_ALLOWED_TOOLS} from "./role-execution.js";
import type {ProviderRoute, RoleExecutionProfile, TaskLimits} from "./role-execution.js";

export const PROFILE_STATUS = "PROPOSED_DERIVED" as const;
export const PROFILE_SCHEMA_VERSION = "1.0.0";
export const PERMISSION_READ = "READ_WORKSPACE", PERMISSION_WRITE_SCRATCH = "WRITE_WORKSPACE_SCRATCH";
export const SCOPE_READ = "WORKSPACE_READ", SCOPE_WRITE_SCRATCH = "WORKSPACE_SCRATCH_WRITE";
/** Bu profillerde ASLA verilmeyen yetkiler (üretim mutasyonu, ağ, sır, ödeme, dağıtım, Risk-5). */
export const NEVER_GRANTED: readonly string[] = ["DEPLOYMENT", "NETWORK_EGRESS", "PAYMENT", "PRODUCTION_MUTATION", "RISK_5_ACTION", "SECRET_ACCESS"];
/** Rota başına izinli araç kümesi (mevcut config/builder-execution-policy.json allow-list'inden). */
export const ROUTE_TOOL_ALLOWLIST: Readonly<Record<ProviderRoute, readonly string[]>> = {
  CLAUDE_IMPLEMENTER: BUILDER_ALLOWED_TOOLS, CLAUDE_REVIEWER: REVIEWER_ALLOWED_TOOLS, DETERMINISTIC_STUDIO: [], NONE: []
};
export const DERIVED_ROUTES: readonly ProviderRoute[] = ["CLAUDE_IMPLEMENTER", "CLAUDE_REVIEWER", "DETERMINISTIC_STUDIO"];

export interface Provenance { source: string; ref: string; rule: string }
export interface Derived<T> { value: T; status: typeof PROFILE_STATUS; provenance: Provenance[]; gapId: string | null }

export interface DerivationRole {
  roleId: string; guildId: string; clusterId: string; title: string;
  requiredTechnologies: readonly {technologyId: string}[]; optionalTechnologies: readonly {technologyId: string}[];
  evaluationSpecs: readonly {evaluationId: string; status: string}[];
  legacyAliases: readonly {legacyId: string; status: string}[]; gapIds: readonly string[];
}
export interface LegacyLayers {
  technicalAgent: ReadonlyMap<string, boolean>;
  requiredSkills: ReadonlyMap<string, readonly string[]>;
  candidateAdapters: ReadonlyMap<string, readonly string[]>;
  principalReviewers: ReadonlyMap<string, readonly string[]>;
  evaluationFiles: ReadonlySet<string>;
}
export interface DerivationInputs {
  roles: readonly DerivationRole[]; skillIds: ReadonlySet<string>; technologySlugToId: ReadonlyMap<string, string>; legacy: LegacyLayers;
  bindings?: readonly RoleExecutionProfile[];
}
export interface EvaluationRef { evaluationId: string; status: string; ref: string }
export interface RoleProfileProposal {
  roleId: string; guildId: string; clusterId: string; title: string; bound: boolean; semanticVerifiedLegacyIds: string[];
  route: Derived<ProviderRoute>; allowedTools: Derived<string[]>; candidateToolAdapterIds: Derived<string[]>; candidateSkills: Derived<string[]>;
  workerScope: Derived<string[]>; permissionGrants: Derived<string[]>; reviewChain: Derived<string[]>; limits: Derived<TaskLimits>;
  knowledgeSources: Derived<string[]>; evaluationRefs: Derived<EvaluationRef[]>;
}

const REGISTRY = "registries/role-definitions.json";
const uniqSorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
const d = <T>(value: T, provenance: Provenance[], gapId: string | null = null): Derived<T> => ({value, status: PROFILE_STATUS, provenance, gapId});
// Mevcut rol gap kimliğini yeniden kullanır; kayıtta yoksa YENİ bir gap kimliği yazar (kaynak bir şey söylemiyor).
function gapFor(role: DerivationRole, group: string, fallbackGroup = group): string {
  return role.gapIds.find(g => g === `WFR-GAP-${group}-${role.roleId}`) ?? `WFR-GAP-PROFILE-${fallbackGroup}-${role.roleId}`;
}
const READ_ONLY_LIMITS = (): TaskLimits => ({...bindingForFunction("planner").limits});
const IMPLEMENTER_LIMITS = (): TaskLimits => ({...bindingForFunction("developer").limits});

export function deriveRoleProfiles(i: DerivationInputs): RoleProfileProposal[] {
  const bindings = i.bindings ?? FIRST_DELIVERY_BINDINGS;
  const seen = new Set<string>();
  for (const r of i.roles) { if (seen.has(r.roleId)) throw new Error(`PROFILE_DERIVATION_DUPLICATE_ROLE:${r.roleId}`); seen.add(r.roleId); }
  const boundById = new Map(bindings.map(b => [b.roleId, b]));
  // Sözlük: SEMANTIC_VERIFIED eşleşmeden tersine arama (legacyId -> kanonik roller); yalnız bu durum kanıt sayılır.
  const legacyToRoles = new Map<string, string[]>();
  for (const r of i.roles) for (const a of r.legacyAliases) if (a.status === "SEMANTIC_VERIFIED") legacyToRoles.set(a.legacyId, [...(legacyToRoles.get(a.legacyId) ?? []), r.roleId]);
  const defaultReviewer = bindingForFunction("security-reviewer").roleId, fallbackReviewer = bindingForFunction("architect").roleId;
  return [...i.roles].sort((a, b) => a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0).map(role => {
    const legacyIds = uniqSorted(role.legacyAliases.filter(a => a.status === "SEMANTIC_VERIFIED").map(a => a.legacyId));
    const bound = boundById.get(role.roleId);
    const legacyProv = (file: string, rule: string): Provenance[] => legacyIds.map(id => ({source: file, ref: `${file}#${id}`, rule}));
    const aliasProv = legacyIds.map(id => ({source: REGISTRY, ref: `${REGISTRY}#roles[roleId=${role.roleId}].legacyAliases[legacyId=${id}]`, rule: "SEMANTIC_VERIFIED_ALIAS"}));

    // ---- rota / araçlar / limitler ----
    let route: Derived<ProviderRoute>, tools: string[], limits: Derived<TaskLimits>;
    if (bound) {
      const p: Provenance[] = [{source: "core/agents/first-delivery-bindings.ts", ref: `FIRST_DELIVERY_BINDINGS[${bound.function}]`, rule: "FIRST_DELIVERY_BINDING"}];
      route = d(bound.providerRoute, p); tools = [...bound.allowedTools]; limits = d({...bound.limits}, p);
    } else if (legacyIds.some(id => i.legacy.technicalAgent.get(id) === true)) {
      route = d("CLAUDE_IMPLEMENTER", [...aliasProv, ...legacyProv("registries/agent-competency-v2.json", "LEGACY_TECHNICAL_AGENT")]);
      tools = [...ROUTE_TOOL_ALLOWLIST.CLAUDE_IMPLEMENTER];
      limits = d(IMPLEMENTER_LIMITS(), [{source: "core/agents/first-delivery-bindings.ts", ref: "FIRST_DELIVERY_BINDINGS[developer].limits", rule: "ROUTE_DEFAULT_LIMITS"}]);
    } else {
      route = d("CLAUDE_REVIEWER", [{source: "config/builder-execution-policy.json", ref: "allowedTools (read-only subset)", rule: "DEFAULT_LEAST_PRIVILEGE_READ_ONLY"}]);
      tools = [...ROUTE_TOOL_ALLOWLIST.CLAUDE_REVIEWER];
      limits = d(READ_ONLY_LIMITS(), [{source: "core/agents/first-delivery-bindings.ts", ref: "FIRST_DELIVERY_BINDINGS[planner].limits", rule: "ROUTE_DEFAULT_LIMITS"}]);
    }
    const toolProv: Provenance[] = [{source: "config/builder-execution-policy.json", ref: `allowedTools ∩ route ${route.value}`, rule: "ROUTE_ALLOWLIST_SUBSET"}];
    const writes = tools.some(t => t === "Edit" || t === "Write");
    const reads = tools.length > 0;

    // ---- yetkiler / kapsam (en az yetki; sözlük sabit) ----
    const grants = uniqSorted([...(reads ? [PERMISSION_READ] : []), ...(writes ? [PERMISSION_WRITE_SCRATCH] : [])]);
    const scope = uniqSorted([...(reads ? [SCOPE_READ] : []), ...(writes ? [SCOPE_WRITE_SCRATCH] : [])]);
    const leastPriv: Provenance[] = [{source: "core/agents/role-profile-derivation.ts", ref: `route ${route.value}`, rule: "ROUTE_LEAST_PRIVILEGE"}];

    // ---- beceriler ----
    const skills = uniqSorted(legacyIds.flatMap(id => (i.legacy.requiredSkills.get(id) ?? []).filter(s => i.skillIds.has(s))));
    // ---- araç adaptörü adayları ----
    const adapters = uniqSorted(legacyIds.flatMap(id => i.legacy.candidateAdapters.get(id) ?? []));
    // ---- inceleme zinciri: eski inceleme grafiği (eşlenebiliyorsa) yoksa varsayılan bağımsız reviewer; kendisi asla ----
    const legacyReviewers = uniqSorted(legacyIds.flatMap(id => (i.legacy.principalReviewers.get(id) ?? []).flatMap(rid => legacyToRoles.get(rid) ?? [])).filter(rid => rid !== role.roleId));
    const chain = legacyReviewers.length > 0
      ? d(legacyReviewers, [...aliasProv, ...legacyProv("registries/agent-review-graph-v2.json", "LEGACY_REVIEW_GRAPH_MAPPED_VIA_SEMANTIC_VERIFIED_ALIAS")])
      : d([role.roleId === defaultReviewer ? fallbackReviewer : defaultReviewer], [{source: "core/agents/first-delivery-bindings.ts", ref: role.roleId === defaultReviewer ? "FIRST_DELIVERY_BINDINGS[architect]" : "FIRST_DELIVERY_BINDINGS[security-reviewer]", rule: "DEFAULT_INDEPENDENT_REVIEWER"}], gapFor(role, "REVIEW-CHAIN"));
    // ---- bilgi kaynakları: teknoloji kayıt girdileri ----
    const techIds = uniqSorted([...role.requiredTechnologies, ...role.optionalTechnologies].map(t => i.technologySlugToId.get(t.technologyId)).filter((x): x is string => typeof x === "string"));
    // ---- değerlendirme referansları ----
    const evalRefs: EvaluationRef[] = role.evaluationSpecs.map(s => ({evaluationId: s.evaluationId, status: s.status, ref: `${REGISTRY}#roles[roleId=${role.roleId}].evaluationSpecs[evaluationId=${s.evaluationId}]`}));
    const legacyEvals = legacyIds.filter(id => i.legacy.evaluationFiles.has(id)).map(id => ({evaluationId: `LEGACY-${id}`, status: "NOT_EXECUTED", ref: `evaluations/agents/${id}.json`}));

    return {
      roleId: role.roleId, guildId: role.guildId, clusterId: role.clusterId, title: role.title, bound: !!bound, semanticVerifiedLegacyIds: legacyIds,
      route, allowedTools: d(tools, toolProv),
      candidateToolAdapterIds: d(adapters, adapters.length ? legacyProv("registries/agent-tool-policy-v2.json", "LEGACY_TOOL_POLICY_CANDIDATES") : [], adapters.length ? null : gapFor(role, "TOOL-ADAPTERS")),
      candidateSkills: d(skills, skills.length ? legacyProv("registries/agent-skill-matrix.json", "LEGACY_SKILL_MATRIX_IN_SKILLS_V2") : [], skills.length ? null : gapFor(role, "SKILLS")),
      workerScope: d(scope, leastPriv, null), permissionGrants: d(grants, leastPriv, null),
      reviewChain: chain, limits,
      knowledgeSources: d(techIds.map(t => `registries/technologies.json#${t}`), techIds.length ? [{source: REGISTRY, ref: `${REGISTRY}#roles[roleId=${role.roleId}].requiredTechnologies/optionalTechnologies`, rule: "TECHNOLOGY_SLUG_IN_REGISTRY"}] : [], techIds.length ? null : gapFor(role, "KNOWLEDGE-SOURCES")),
      evaluationRefs: d([...evalRefs, ...legacyEvals], [{source: REGISTRY, ref: `${REGISTRY}#roles[roleId=${role.roleId}].evaluationSpecs`, rule: "ROLE_EVALUATION_SPECS"}], evalRefs.length ? null : gapFor(role, "EVALUATION"))
    };
  });
}

/** Girdi dosyalarından türetim girdilerini kurar (script ve testler aynı yolu kullanır). */
export function buildDerivationInputs(src: {
  roleDefinitions: any; skills: any; technologies: any; competency: any; skillMatrix: any; toolPolicy: any; reviewGraph: any; evaluationFileNames: readonly string[];
}): DerivationInputs {
  const byId = <T extends {agentId: string}>(xs: readonly T[]) => new Map(xs.map(x => [x.agentId, x]));
  const comp = byId<any>(src.competency.agents), skillM = byId<any>(src.skillMatrix.agents), tool = byId<any>(src.toolPolicy.policies), rev = byId<any>(src.reviewGraph.reviews);
  return {
    roles: src.roleDefinitions.roles,
    skillIds: new Set<string>(src.skills.skills.map((s: any) => s.id)),
    technologySlugToId: new Map<string, string>(src.technologies.technologies.map((t: any) => [t.slug, t.id])),
    legacy: {
      technicalAgent: new Map([...comp].map(([k, v]) => [k, v.technicalAgent === true])),
      requiredSkills: new Map([...skillM].map(([k, v]) => [k, v.requiredSkillIds ?? []])),
      candidateAdapters: new Map([...tool].map(([k, v]) => [k, v.candidateToolAdapterIds ?? []])),
      principalReviewers: new Map([...rev].map(([k, v]) => [k, v.principalReviewerAgentIds ?? []])),
      evaluationFiles: new Set(src.evaluationFileNames.map(n => n.replace(/\.json$/, "")))
    }
  };
}

export function summarizeProfiles(ps: readonly RoleProfileProposal[]): Record<string, unknown> {
  const count = (f: (p: RoleProfileProposal) => boolean) => ps.filter(f).length;
  const byRoute: Record<string, number> = {};
  for (const p of ps) byRoute[p.route.value] = (byRoute[p.route.value] ?? 0) + 1;
  return {
    roles: ps.length, byRoute: Object.fromEntries(Object.entries(byRoute).sort()), boundRoles: count(p => p.bound),
    withSemanticVerifiedLegacyEvidence: count(p => p.semanticVerifiedLegacyIds.length > 0),
    withCandidateSkills: count(p => p.candidateSkills.value.length > 0), withCandidateToolAdapters: count(p => p.candidateToolAdapterIds.value.length > 0),
    withKnowledgeSources: count(p => p.knowledgeSources.value.length > 0), withLegacyMappedReviewChain: count(p => p.reviewChain.gapId === null),
    gapIdsWritten: ps.reduce((n, p) => n + [p.candidateToolAdapterIds, p.candidateSkills, p.reviewChain, p.knowledgeSources, p.evaluationRefs].filter(f => f.gapId !== null).length, 0)
  };
}
