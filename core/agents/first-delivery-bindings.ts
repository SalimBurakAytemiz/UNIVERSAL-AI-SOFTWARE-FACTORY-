// //TR: İlk teslim akışının altı fonksiyonu (planner, architect, developer, tester, security reviewer, delivery) için MEVCUT kataloğun gerçek rol kimliklerine veri bağlamaları. Hiçbir rol eklenmez/certified edilmez; araçlar yalnız mevcut builder allow-list'idir; tester için test YÜRÜTME araçları yoktur (doğrulanmış sandbox yok) ve bu dürüstçe değerlendirme ölçütünde belirtilir.
import {BUILDER_ALLOWED_TOOLS, REVIEWER_ALLOWED_TOOLS} from "./role-execution.js";
import type {FirstDeliveryFunction, RoleExecutionProfile, TaskLimits} from "./role-execution.js";

const KNOWLEDGE = ["config/builder-execution-policy.json", "registries/role-definitions.json", "docs/inventory/2026-10-19/MASTER_WORK_INVENTORY.md"];
const lim = (maxCycles: number, maxFilesWritten: number): TaskLimits => ({maxCycles, timeoutMs: 600_000, maxFilesWritten});
const READ_ONLY = REVIEWER_ALLOWED_TOOLS;

export const FIRST_DELIVERY_BINDINGS: readonly RoleExecutionProfile[] = [
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
export const FIRST_DELIVERY_FUNCTIONS: readonly FirstDeliveryFunction[] = ["planner", "architect", "developer", "tester", "security-reviewer", "delivery"];
export const bindingForFunction = (fn: FirstDeliveryFunction): RoleExecutionProfile => FIRST_DELIVERY_BINDINGS.find(b => b.function === fn)!;
