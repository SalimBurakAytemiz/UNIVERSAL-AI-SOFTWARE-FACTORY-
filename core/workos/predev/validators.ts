// //TR: Bu dosya pre-dev artefakt içeriklerinin SAF doğrulayıcılarını sağlar: yalnız yapı (biçim) ve izlenebilirlik (referential integrity) denetlenir; doğrulayıcılar içeriği ASLA uydurmaz, varsayılan/örnek veri üretmez ve dosya sistemine dokunmaz. Hata mesajları sabit kodlardır (değer/yol/PII taşımaz).
import {placeholderProblem} from "./placeholder.js";
import type {
  ArchitectureContent, ArtifactContent, ArtifactKind, BusinessAnalysisContent, Component, Goal, Milestone,
  PlanContent, Requirement, RequirementsContent, ScopeItem, TechChoice, UxSpecContent, WorkPackage
} from "./types.js";

export type Validation = {ok: true} | {ok: false; errors: string};
const OK: Validation = {ok: true};
const err = (code: string): Validation => ({ok: false, errors: code});

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isStrArr = (x: unknown, min = 0): x is string[] => Array.isArray(x) && x.length >= min && x.every(isStr);
const uniqueIds = (ids: string[]): boolean => new Set(ids).size === ids.length;
const subset = (a: string[], b: readonly string[]): boolean => a.every(x => b.includes(x));
// Yalnız beklenen anahtarlar bulunmalı (ne eksik ne fazla); fazladan alan reddedilir (sessiz veri taşımacılığı yok).
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every(x => Object.prototype.hasOwnProperty.call(o, x));
};

const isGoal = (x: unknown): x is Goal => isObj(x) && exactKeys(x, ["id", "statement"]) && isStr(x.id) && isStr(x.statement);
function isRequirement(x: unknown): x is Requirement {
  return isObj(x) && exactKeys(x, ["id", "statement", "acceptanceCriteria", "tracesTo"]) && isStr(x.id) && isStr(x.statement)
    && isStrArr(x.acceptanceCriteria, 1) && isStrArr(x.tracesTo, 1);
}
const isScopeItem = (x: unknown): x is ScopeItem => isObj(x) && exactKeys(x, ["id", "statement"]) && isStr(x.id) && isStr(x.statement);
const isWorkPackage = (x: unknown): x is WorkPackage => isObj(x) && exactKeys(x, ["id", "title", "dependsOn", "estimate", "satisfies"])
  && isStr(x.id) && isStr(x.title) && isStrArr(x.dependsOn) && isStr(x.estimate) && isStrArr(x.satisfies, 1);
const isMilestone = (x: unknown): x is Milestone => isObj(x) && exactKeys(x, ["id", "title", "workPackageIds"]) && isStr(x.id) && isStr(x.title) && isStrArr(x.workPackageIds);
const isTechChoice = (x: unknown): x is TechChoice => isObj(x) && exactKeys(x, ["choice", "rationale", "alternativesConsidered"]) && isStr(x.choice) && isStr(x.rationale) && isStrArr(x.alternativesConsidered);
const isComponent = (x: unknown): x is Component => isObj(x) && exactKeys(x, ["id", "name", "responsibility", "covers"]) && isStr(x.id) && isStr(x.name) && isStr(x.responsibility) && isStrArr(x.covers, 1);

// ---- BusinessAnalysis: yalnız biçim (üst artefaktı yok) ----
export function validateBusinessAnalysis(c: unknown): Validation {
  if (!isObj(c) || !exactKeys(c, ["problem", "stakeholders", "goals", "constraints", "successMetrics", "assumptions", "risks"])) return err("BA_SHAPE");
  const b = c as unknown as BusinessAnalysisContent;
  if (!isStr(b.problem) || !isStrArr(b.stakeholders, 1)) return err("BA_SHAPE");
  if (!Array.isArray(b.goals) || b.goals.length < 1 || !b.goals.every(isGoal)) return err("BA_GOALS_SHAPE");
  if (!uniqueIds(b.goals.map(g => g.id))) return err("BA_GOAL_IDS_NOT_UNIQUE");
  if (!isStrArr(b.constraints) || !isStrArr(b.successMetrics) || !isStrArr(b.assumptions) || !isStrArr(b.risks)) return err("BA_SHAPE");
  return OK;
}
export const businessAnalysisGoalIds = (b: BusinessAnalysisContent): string[] => b.goals.map(g => g.id);

// ---- Requirements: biçim + BA hedeflerine izlenebilirlik ----
export function validateRequirements(c: unknown, ba: BusinessAnalysisContent): Validation {
  if (!isObj(c) || !exactKeys(c, ["functional", "nonFunctional"])) return err("REQ_SHAPE");
  const r = c as unknown as RequirementsContent;
  if (!Array.isArray(r.functional) || r.functional.length < 1 || !r.functional.every(isRequirement)) return err("REQ_FUNCTIONAL_SHAPE");
  if (!Array.isArray(r.nonFunctional) || !r.nonFunctional.every(isRequirement)) return err("REQ_NONFUNCTIONAL_SHAPE");
  const all = [...r.functional, ...r.nonFunctional];
  if (!uniqueIds(all.map(x => x.id))) return err("REQ_IDS_NOT_UNIQUE");
  const baValid = validateBusinessAnalysis(ba);
  if (!baValid.ok) return err("REQ_BA_INVALID");
  const goalIds = businessAnalysisGoalIds(ba);
  for (const req of all) if (!subset(req.tracesTo, goalIds)) return err("REQ_TRACEABILITY_BROKEN");
  return OK;
}
export const requirementIds = (r: RequirementsContent): string[] => [...r.functional, ...r.nonFunctional].map(x => x.id);

// ---- Plan: biçim + iş paketleri Requirements'a referans + kapsam kimlikleri benzersiz ----
export function validatePlan(c: unknown, requirements: RequirementsContent): Validation {
  if (!isObj(c) || !exactKeys(c, ["scope", "workPackages", "milestones", "outOfScope"])) return err("PLAN_SHAPE");
  const p = c as unknown as PlanContent;
  if (!Array.isArray(p.scope) || p.scope.length < 1 || !p.scope.every(isScopeItem) || !uniqueIds(p.scope.map(s => s.id))) return err("PLAN_SCOPE_SHAPE");
  if (!Array.isArray(p.workPackages) || p.workPackages.length < 1 || !p.workPackages.every(isWorkPackage)) return err("PLAN_WP_SHAPE");
  const wpIds = p.workPackages.map(w => w.id);
  if (!uniqueIds(wpIds)) return err("PLAN_WP_IDS_NOT_UNIQUE");
  if (!Array.isArray(p.milestones) || !p.milestones.every(isMilestone)) return err("PLAN_MILESTONE_SHAPE");
  if (!isStrArr(p.outOfScope)) return err("PLAN_SHAPE");
  if (p.milestones.length && !uniqueIds(p.milestones.map(m => m.id))) return err("PLAN_MILESTONE_IDS_NOT_UNIQUE");
  for (const w of p.workPackages) { if (w.dependsOn.includes(w.id) || !subset(w.dependsOn, wpIds)) return err("PLAN_WP_DEPENDS_BROKEN"); }
  for (const m of p.milestones) if (!subset(m.workPackageIds, wpIds)) return err("PLAN_MILESTONE_WP_BROKEN");
  const reqValid = validateRequirementsShape(requirements);
  if (!reqValid.ok) return err("PLAN_REQUIREMENTS_INVALID");
  const reqIds = requirementIds(requirements);
  const satisfied = new Set<string>();
  for (const w of p.workPackages) { if (!subset(w.satisfies, reqIds)) return err("PLAN_WP_REQUIREMENT_BROKEN"); for (const id of w.satisfies) satisfied.add(id); }
  // Her gereksinim en az bir iş paketince referans alınmalı (tam izlenebilirlik; uydurma kapsama yok).
  for (const id of reqIds) if (!satisfied.has(id)) return err("PLAN_REQUIREMENT_NOT_COVERED");
  return OK;
}
export const scopeIds = (p: PlanContent): string[] => p.scope.map(s => s.id);

// ---- Architecture: biçim + bileşenler Plan kapsamını kapsar ----
export function validateArchitecture(c: unknown, plan: PlanContent): Validation {
  if (!isObj(c) || !exactKeys(c, ["components", "techChoices", "dataModel", "integrations", "infraNeeds", "risks"])) return err("ARCH_SHAPE");
  const a = c as unknown as ArchitectureContent;
  if (!Array.isArray(a.components) || a.components.length < 1 || !a.components.every(isComponent) || !uniqueIds(a.components.map(x => x.id))) return err("ARCH_COMPONENTS_SHAPE");
  if (!Array.isArray(a.techChoices) || a.techChoices.length < 1 || !a.techChoices.every(isTechChoice)) return err("ARCH_TECHCHOICES_SHAPE");
  if (!isStr(a.dataModel) || !isStrArr(a.integrations) || !isStrArr(a.infraNeeds) || !isStrArr(a.risks)) return err("ARCH_SHAPE");
  const planValid = validatePlanShape(plan);
  if (!planValid.ok) return err("ARCH_PLAN_INVALID");
  const ids = scopeIds(plan);
  const covered = new Set<string>();
  for (const comp of a.components) { if (!subset(comp.covers, ids)) return err("ARCH_SCOPE_REFERENCE_BROKEN"); for (const id of comp.covers) covered.add(id); }
  // Plan kapsamındaki her madde en az bir bileşence kapsanmalı (Architecture Plan kapsamını kapsar).
  for (const id of ids) if (!covered.has(id)) return err("ARCH_SCOPE_NOT_COVERED");
  return OK;
}

// ---- UxSpec: yalnız biçim ----
export function validateUxSpec(c: unknown): Validation {
  if (!isObj(c) || !exactKeys(c, ["screens", "flows", "components", "a11yNotes"])) return err("UX_SHAPE");
  const u = c as unknown as UxSpecContent;
  if (!Array.isArray(u.screens) || u.screens.length < 1 || !u.screens.every(s => isObj(s) && exactKeys(s, ["id", "name"]) && isStr(s.id) && isStr(s.name)) || !uniqueIds(u.screens.map(s => s.id))) return err("UX_SCREENS_SHAPE");
  if (!Array.isArray(u.flows) || !u.flows.every(f => isObj(f) && exactKeys(f, ["id", "name", "steps"]) && isStr(f.id) && isStr(f.name) && isStrArr(f.steps, 1))) return err("UX_FLOWS_SHAPE");
  if (u.flows.length && !uniqueIds(u.flows.map(f => f.id))) return err("UX_FLOW_IDS_NOT_UNIQUE");
  if (!Array.isArray(u.components) || !u.components.every(k => isObj(k) && exactKeys(k, ["id", "name"]) && isStr(k.id) && isStr(k.name))) return err("UX_COMPONENTS_SHAPE");
  if (u.components.length && !uniqueIds(u.components.map(k => k.id))) return err("UX_COMPONENT_IDS_NOT_UNIQUE");
  if (!isStrArr(u.a11yNotes)) return err("UX_SHAPE");
  return OK;
}

// Yalnız biçim denetimi (üst artefakt tutarlılığını bozmadan alt doğrulayıcıların yeniden kullandığı).
const validateRequirementsShape = (c: unknown): Validation => {
  if (!isObj(c) || !exactKeys(c, ["functional", "nonFunctional"])) return err("REQ_SHAPE");
  const r = c as unknown as RequirementsContent;
  if (!Array.isArray(r.functional) || r.functional.length < 1 || !r.functional.every(isRequirement)) return err("REQ_FUNCTIONAL_SHAPE");
  if (!Array.isArray(r.nonFunctional) || !r.nonFunctional.every(isRequirement)) return err("REQ_NONFUNCTIONAL_SHAPE");
  return uniqueIds([...r.functional, ...r.nonFunctional].map(x => x.id)) ? OK : err("REQ_IDS_NOT_UNIQUE");
};
const validatePlanShape = (c: unknown): Validation => {
  if (!isObj(c) || !exactKeys(c, ["scope", "workPackages", "milestones", "outOfScope"])) return err("PLAN_SHAPE");
  const p = c as unknown as PlanContent;
  if (!Array.isArray(p.scope) || p.scope.length < 1 || !p.scope.every(isScopeItem) || !uniqueIds(p.scope.map(s => s.id))) return err("PLAN_SCOPE_SHAPE");
  if (!Array.isArray(p.workPackages) || p.workPackages.length < 1 || !p.workPackages.every(isWorkPackage) || !uniqueIds(p.workPackages.map(w => w.id))) return err("PLAN_WP_SHAPE");
  return OK;
};

// //TR: Tek giriş noktası: artefakt türüne göre içerik doğrulaması. İzlenebilirlik gerektiren türler üst içeriklerini ister (yoksa doğrulama başarısızdır; eksik üst veri uydurulmaz).
export interface UpstreamContents { businessAnalysis?: BusinessAnalysisContent; requirements?: RequirementsContent; plan?: PlanContent }
export function validateArtifactContent(kind: ArtifactKind, content: unknown, upstream: UpstreamContents = {}): Validation {
  // //TR: #237 incelemesi: yer tutucu koruması BURADADIR (her çağıran alır: driver, store yazma kapısı/apply.ts, CrewCoordinator rework, yetkinlik değerlendirmesi) ve şekil denetiminden ÖNCE çalışır; iskeleti (ya da işaretin herhangi bir varyantını) yankılayan içerik şekil olarak geçerli olsa bile kabul edilmez. Çok derin içerik tipli bir retle (CONTENT_TOO_DEEP) reddedilir.
  const problem = placeholderProblem(content);
  if (problem !== null) return err(problem);
  switch (kind) {
    case "BusinessAnalysis": return validateBusinessAnalysis(content);
    case "Requirements": return upstream.businessAnalysis ? validateRequirements(content, upstream.businessAnalysis) : err("REQ_BA_MISSING");
    case "Plan": return upstream.requirements ? validatePlan(content, upstream.requirements) : err("PLAN_REQUIREMENTS_MISSING");
    case "Architecture": return upstream.plan ? validateArchitecture(content, upstream.plan) : err("ARCH_PLAN_MISSING");
    case "UxSpec": return validateUxSpec(content);
    default: return err("UNKNOWN_ARTIFACT_KIND");
  }
}
export type { ArtifactContent };
