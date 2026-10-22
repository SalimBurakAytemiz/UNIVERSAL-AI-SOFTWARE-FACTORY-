// //TR: İlk teslim akışının dokuz fonksiyonu (business analyst, requirements engineer, UX designer, planner, architect, developer, tester, security reviewer, delivery) için MEVCUT kataloğun gerçek rol kimliklerine veri bağlamaları. Hiçbir rol eklenmez/certified edilmez; araçlar yalnız mevcut builder allow-list'idir; tester için test YÜRÜTME araçları yoktur (doğrulanmış sandbox yok) ve bu dürüstçe değerlendirme ölçütünde belirtilir.
import {BUILDER_ALLOWED_TOOLS, REVIEWER_ALLOWED_TOOLS, profileDefect} from "./role-execution.js";
import type {FirstDeliveryFunction, RoleExecutionProfile, TaskLimits} from "./role-execution.js";

const KNOWLEDGE = ["config/builder-execution-policy.json", "registries/role-definitions.json", "docs/inventory/2026-10-19/MASTER_WORK_INVENTORY.md"];
const lim = (maxCycles: number, maxFilesWritten: number): TaskLimits => ({maxCycles, timeoutMs: 600_000, maxFilesWritten});
const READ_ONLY = REVIEWER_ALLOWED_TOOLS;

export const FIRST_DELIVERY_BINDINGS: readonly RoleExecutionProfile[] = [
  // //TR: Pre-dev zincirinin birincil rolleri (PRE_DEV_ROLE_MAP[kind][0]): iş analizi, gereksinim, UX spesifikasyonu. Hepsi salt-okunur rota; artefakt yazımı store/predev kapılarındadır.
  {roleId: "UASCO-0022", function: "business-analyst", capabilities: ["business-analysis", "stakeholder-needs", "scope-definition"], providerRoute: "CLAUDE_REVIEWER", allowedTools: READ_ONLY,
    adapters: ["workos-predev-business-analysis"], limits: lim(2, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["needs trace to the founder brief", "no invented stakeholders or metrics", "scope boundaries stated"]},
  {roleId: "UASCO-0023", function: "requirements-engineer", capabilities: ["requirements-specification", "acceptance-criteria", "traceability"], providerRoute: "CLAUDE_REVIEWER", allowedTools: READ_ONLY,
    adapters: ["workos-predev-requirements"], limits: lim(2, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["each requirement testable", "ids unique and traced to analysis", "no unverified technology claims"]},
  {roleId: "UASCO-0031", function: "ux-designer", capabilities: ["ux-specification", "screen-and-flow-design", "accessibility-notes"], providerRoute: "CLAUDE_REVIEWER", allowedTools: READ_ONLY,
    adapters: ["workos-predev-uxspec"], limits: lim(2, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["screens map to requirements", "states include empty/error/offline", "a11y notes present"]},
  {roleId: "UASCO-0019", function: "planner", capabilities: ["requirements-tracing", "task-planning", "acceptance-criteria"], providerRoute: "CLAUDE_REVIEWER", allowedTools: READ_ONLY,
    adapters: ["workos-predev-plan"], limits: lim(2, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["plan covers every requirement id", "each task has acceptance criteria", "no invented scope"]},
  {roleId: "UASCO-0043", function: "architect", capabilities: ["architecture-decision", "component-design", "threat-modelling"], providerRoute: "CLAUDE_REVIEWER", allowedTools: READ_ONLY,
    adapters: ["workos-predev-architecture"], limits: lim(2, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["components map to requirements", "decisions recorded as ADRs", "no unverified technology claims"]},
  {roleId: "UASCO-0085", function: "developer", capabilities: ["source-generation", "backend-implementation"], providerRoute: "CLAUDE_IMPLEMENTER", allowedTools: BUILDER_ALLOWED_TOOLS,
    adapters: ["local-claude-implementer", "workos-runner"], limits: lim(3, 200), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["change committed by supervisor", "scope respected", "independent review CLEAN"]},
  {roleId: "UASCO-0313", function: "tester", capabilities: ["test-authoring", "test-surface-review"], providerRoute: "CLAUDE_IMPLEMENTER", allowedTools: BUILDER_ALLOWED_TOOLS,
    adapters: ["local-claude-implementer", "workos-runner"], limits: lim(2, 100), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["tests added for each acceptance criterion", "no weakened or skipped tests", "execution NOT_EXECUTED without verified sandbox"]},
  {roleId: "UASCO-0252", function: "security-reviewer", capabilities: ["secure-code-review", "diff-review"], providerRoute: "CLAUDE_REVIEWER", allowedTools: READ_ONLY,
    adapters: ["local-claude-reviewer", "workos-security-stage"], limits: lim(1, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["reviewer identity differs from implementer", "findings carry severity", "invalid review is never CLEAN"]},
  {roleId: "UASCO-0232", function: "delivery", capabilities: ["delivery-packaging", "evidence-bundling"], providerRoute: "DETERMINISTIC_STUDIO", allowedTools: [],
    adapters: ["project-studio-prepare-run-delivery"], limits: lim(1, 0), knowledgeSources: KNOWLEDGE, evaluationCriteria: ["delivery only after SOURCE_GENERATION_COMPLETE", "evidence chain recorded"]}
];
export const FIRST_DELIVERY_FUNCTIONS: readonly FirstDeliveryFunction[] = ["business-analyst", "requirements-engineer", "ux-designer", "planner", "architect", "developer", "tester", "security-reviewer", "delivery"];
export const bindingForFunction = (fn: FirstDeliveryFunction): RoleExecutionProfile => FIRST_DELIVERY_BINDINGS.find(b => b.function === fn)!;

// //TR: Fail-closed kapı: rol, istenen ilk-teslim fonksiyonuna bağlı ve profili tam değilse çalıştırma başlamaz (NOT_EXECUTABLE nedeni hata mesajına taşınır). Katalog varlığı bağlama verisinin testiyle güvence altındadır.
export function assertRoleExecutes(roleId: string, fn: FirstDeliveryFunction, bindings: readonly RoleExecutionProfile[] = FIRST_DELIVERY_BINDINGS): RoleExecutionProfile {
  const p = bindings.find(b => b.roleId === roleId);
  if (!p) throw new Error(`ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING:${roleId}`);
  if (p.function !== fn) throw new Error(`ROLE_NOT_EXECUTABLE:BINDING_ROLE_MISMATCH:${roleId}:${fn}`);
  const d = profileDefect(p);
  if (d) throw new Error(`ROLE_NOT_EXECUTABLE:${d.reason}:${roleId}`);
  return p;
}

// //TR: IMPLEMENT adımını sürebilen (dosya yazan, CLAUDE_IMPLEMENTER rotalı) fonksiyonlar: developer ve tester. Reviewer/pre-dev rolleri bu adımı sürmez.
export const IMPLEMENTER_FUNCTIONS: readonly FirstDeliveryFunction[] = ["developer", "tester"];
export function assertImplementerRole(roleId: string, bindings: readonly RoleExecutionProfile[] = FIRST_DELIVERY_BINDINGS): RoleExecutionProfile {
  const p = bindings.find(b => b.roleId === roleId);
  if (!p) throw new Error(`ROLE_NOT_EXECUTABLE:ROLE_HAS_NO_BINDING:${roleId}`);
  if (!IMPLEMENTER_FUNCTIONS.includes(p.function) || p.providerRoute !== "CLAUDE_IMPLEMENTER") throw new Error(`ROLE_NOT_EXECUTABLE:BINDING_ROLE_MISMATCH:${roleId}:implementer`);
  return assertRoleExecutes(roleId, p.function, bindings);
}
